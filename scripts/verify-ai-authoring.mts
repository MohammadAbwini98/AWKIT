/**
 * verify:ai-authoring — Phase L L4b: AI authoring explanations (T0) and safe-fix ranking (T1).
 *
 * Real layers: the real `FlowValidator` over a real broken `FlowProfile`, so the emitted `safeFix` set
 * is the product's own and not a fixture's opinion of it; the real `AiService` (queue, admission,
 * `AiPromptBuilder` redaction, `AiOutputContract` grammar and parsing) over `FakeAiHostTransport`; and
 * the real `buildAuthoringRequest` / `parseAuthoringAnswer` / `AiAutonomyPolicy`. The only fake is the
 * provider TRANSPORT — a scripted table of model output text.
 *
 * L4b's two load-bearing rules, and how each is made to fail here:
 *   - **AI never adds a fix kind.** The answer schema has no `kind` field, and a ranking may contain
 *     only ids the validator emitted a fix for. An answer ranking an unfixable issue is refused
 *     `FIX_NOT_EMITTED`; an answer inventing a fix kind cannot even decode.
 *   - **AI never names something outside the report.** Ids are a closed enum in the grammar AND
 *     re-checked after decoding, so an id from another report is refused twice over.
 *
 * Also asserted: the validator stays the source of truth (no issue is invented, dropped or
 * re-severitied by the AI path), explanations are T0 whatever the configuration, ranking is refused
 * when the feature is off, and no prompt carries a validator message, step name, locator or typed value.
 * Section 10 holds the explanation to its OWN deadline on a virtual clock: an answer past the old
 * shared 30 s is delivered, one past `AUTHORING_LIMITS.timeoutMs` is not, and the fragment summary keeps
 * 30 s. Every feature's deadline side by side is `verify:ai-deadlines`. Section 11 audits the labelled set
 * `verify:ai-authoring-quality-live` sends to the real model (codes, fixes, which issue blocks the run,
 * truncation, blocking-first), and runs its judge's controls: subject, corrective action, the five
 * unsupported-claim screens each with a negative twin, and the ranking order. Section 12 holds the
 * owner's four L4b decisions (2026-09-22): each clause of the corrective-step instruction; a fix order
 * that puts a fix that can wait ahead of a blocking one withheld (never re-sorted) with the explanations
 * kept, through the adapter too; the review capture redacted before it is written, with a residual
 * secret withheld and nothing from the flow stored; verdicts validated and redacted; and the adopted
 * target, which can say MET and says PENDING or NOT MET for each way short of it, never counting an
 * unreviewed explanation as correct. Section 13 holds the corrective step to the product (2026-09-23):
 * every rule has one, a fix is named only where the validator emitted one, the designer gets the
 * product's step whatever the model wrote, and a sentence the character limit cut is never shown; §11
 * replays the reviewed failures (incorrect, inverted, irrelevant, unsupported, truncated) as controls.
 *
 * Run: npm run verify:ai-authoring
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";

import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { AI_SERVICE_LIMITS, AiService, type AiServiceLimits, type AiServiceSettings } from "@src/ai/AiService";
import { FakeAiHostTransport, type FakeInferStep } from "@src/ai/FakeAiHostTransport";
import { AI_HOST_TIMEOUTS } from "@src/ai/contracts/AiHostProtocol";
import { FRAGMENT_ASSIST_LIMITS } from "@src/ai/fragmentAssist";
import type { FlowFragment } from "@src/fragments/FlowFragment";
import {
  AUTHORING_LIMITS,
  authoringExplanationDecision,
  authoringRankingDecision,
  buildAuthoringRequest,
  correctiveStep,
  endAtCompleteSentence,
  parseAuthoringAnswer,
  rankingKeepsPriority,
  type AuthoringRequest
} from "@src/ai/authoringExplanation";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { parseAiOutput } from "@src/ai/AiOutputContract";
import { AI_ASSIST_MAX_NODES, type AuthoringAssistView } from "@src/ai/contracts/AiApi";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { AiPolicyConfig } from "@src/security/authz/AiAutonomyPolicy";
import { FLOW_VALIDATION_RULES, isExecutionBlocking, validateFlowDefinition, type FlowValidationReport } from "@src/validation/FlowValidator";

import { assistJobId, cancelAssist, explainFlowValidation, summarizeFragment, type AiAssistDeps } from "../app/main/ai/aiAssist";
import { virtualClock } from "./lib/virtual-clock.mts";
import {
  QUALITY_TARGET,
  buildReviewCapture,
  evaluateQualityTarget,
  instructionsSha256,
  loadReviewStore,
  recordVerdict,
  rereadCapture,
  writeReviewCapture,
  type ReviewCapture,
  type ReviewItem,
  type ReviewVerdict
} from "./ai-harness/authoringQualityReview";
import { CANARY, LABELLED_SET, REMEDY, SUBJECT, authoringControlFailures, causalClaimControlFailures, correctiveControlFailures, judgeAuthoringAnswer, literalControlFailures, rankingControlFailures } from "./ai-harness/authoringQualitySet";

let passed = 0;
let failed = 0;
/** Repeated at the end: a long run's output is often read from its tail. */
const failedLabels: string[] = [];
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failedLabels.push(`${label}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const work = await mkdtemp(join(tmpdir(), "awkit-l4b-"));
const MODEL_ROOT = resolvePath(join(work, "models"));

const IDLE: AiAdmissionView = {
  activeRuns: 0,
  queuedRuns: 0,
  pressureState: "healthy",
  dispatchBlocked: false,
  activeWeight: 0,
  weightedBudget: 4,
  freeMemoryMb: 8_000
};
const POLICY = { enabled: true, featureTiers: {} } as const;

function harness(script: Array<FakeInferStep | string>, options: { settings?: Partial<AiServiceSettings>; limits?: Partial<AiServiceLimits> } = {}) {
  let served = 0;
  const fake = new FakeAiHostTransport({
    modelRoot: MODEL_ROOT,
    respond: (_request, index) => {
      served += 1;
      return script[Math.min(index, script.length - 1)] ?? "{}";
    }
  });
  const service = new AiService({
    transport: () => fake,
    model: async () => ({ ok: true, modelId: "fake-l4b-model", modelPath: join(MODEL_ROOT, "model.gguf"), contextTokens: 8192 }),
    settings: async () => ({ enabled: true, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0, ...options.settings }),
    admission: () => IDLE,
    threads: 2,
    limits: { yieldCheckMs: 5, admissionRetryMs: 10, ...options.limits },
    nonce: () => "0123456789abcdef"
  });
  return { fake, service, calls: () => served };
}

/**
 * A flow that is broken in several distinct ways, including one the validator emits a `regenerateId`
 * fix for. Its step names, locator values and typed values are deliberately DISTINCTIVE strings, so a
 * later assertion that none of them reached the prompt cannot pass by accident.
 */
const SECRET_NAME = "Zebra-Quokka-StepName";
const SECRET_VALUE = "Zebra-Quokka-TypedValue";
const SECRET_LOCATOR = "Zebra-Quokka-Selector";

const brokenFlow: FlowProfile = {
  id: "flow-l4b",
  name: "Broken authoring flow",
  version: 1,
  nodes: [
    { id: "n-start", type: "start", name: "Start" },
    // Requires a locator and has none.
    { id: "n-click", type: "click", name: SECRET_NAME },
    // Requires a value and has none, and carries a distinctive locator we must never send.
    { id: "n-fill", type: "fill", name: "Fill the field", locator: { strategy: "css", value: SECRET_LOCATOR } },
    // A negative timeout, plus a typed value we must never send.
    { id: "n-wait", type: "click", name: "Late click", value: SECRET_VALUE, timeoutMs: -5, locator: { strategy: "testId", value: "ok" } },
    { id: "n-end", type: "end", name: "End" }
  ],
  edges: [
    { id: "e1", source: "n-start", target: "n-click" },
    { id: "e2", source: "n-click", target: "n-fill" },
    { id: "e3", source: "n-fill", target: "n-wait" },
    // Duplicate connector id: the validator emits a `regenerateId` safe fix for this one.
    { id: "e3", source: "n-wait", target: "n-end" }
  ]
} as FlowProfile;

const report: FlowValidationReport = validateFlowDefinition(brokenFlow);

// ── 0. The fixture is audited against the real validator, not assumed ───────────────────────────
console.log("\n0 — the report really is what the suite relies on");
check("the real validator found issues", report.issues.length > 0, String(report.issues.length));
const emitted = report.issues.filter((issue) => issue.safeFix !== undefined);
check("...at least one with a validator-emitted safe fix", emitted.length >= 1, JSON.stringify(emitted.map((i) => i.code)));
check("...and at least one WITHOUT, or 'ranked an unfixable issue' could never be tested", report.issues.length - emitted.length >= 1);
check("the emitted fix is one SafeFixApplier already supports", emitted.every((i) => i.safeFix!.kind === "normalizeEnumCasing" || i.safeFix!.kind === "regenerateId"), JSON.stringify(emitted.map((i) => i.safeFix!.kind)));

const request = buildAuthoringRequest(report);
if (!request) throw new Error("the broken fixture produced no request");
const ids = request.issues.map((ref) => ref.id);
const fixableId = request.fixableIds[0];
const unfixableId = request.issues.find((ref) => !ref.fixable)!.id;
check("every issue sent, up to the cap, is addressable by id", request.issues.length === Math.min(report.issues.length, AUTHORING_LIMITS.maxIssues));
check("the fixable ids are exactly the issues the validator emitted a fix for", request.fixableIds.length === emitted.length, `${request.fixableIds.length} vs ${emitted.length}`);

// ── 1. The prompt carries ids, enums and rule text — nothing from the profile ───────────────────
console.log("\n1 — what crosses to the model");
const rendered = buildAiPrompt(request.prompt, new SemanticRedactor(), "0123456789abcdef");
if (!rendered.ok) throw new Error(`the L4b prompt did not build: ${rendered.code} ${rendered.detail}`);
const promptText = `${rendered.system}\n${rendered.user}`;
check("the step name never reaches the prompt", !promptText.includes(SECRET_NAME), SECRET_NAME);
check("the typed value never reaches the prompt", !promptText.includes(SECRET_VALUE));
check("the locator value never reaches the prompt", !promptText.includes(SECRET_LOCATOR));
check("no validator message reaches the prompt", !report.issues.some((issue) => promptText.includes(issue.message)));
check("the rule summary DOES, because it is a product-authored constant", promptText.includes("The step has no locator, and its type needs one."));
check("...as does the product's corrective step for each issue sent, labelled an action, never 'Step:'", request.issues.every((ref) => promptText.includes(`Action: ${correctiveStep(ref.issue)}`)) && !promptText.includes("Step:"));
check("...as do the issue codes", promptText.includes("missingRequiredLocator"));
check("...and each anchor's KIND, so the model knows where an issue sits", promptText.includes("at a node") && promptText.includes("at a connector"));
// An anchor id is the user's (a recorded step's is a UUID, dozens of prompt tokens), and nothing maps
// an answer back through it: `request.issues` does.
const anchorIds = [...brokenFlow.nodes, ...(brokenFlow.edges ?? [])].map(({ id }) => id);
check("...but never an anchor ID", !anchorIds.some((id) => new RegExp(`\\b${id}\\b`).test(promptText)), anchorIds.filter((id) => new RegExp(`\\b${id}\\b`).test(promptText)).join(", "));
check("the issues travel in ONE data block: each costs two nonce delimiters in prompt tokens", (rendered.user.match(/<<<DATA /g) ?? []).length === 1, String((rendered.user.match(/<<<DATA /g) ?? []).length));

/**
 * The model may explain an id only when it saw that issue: every id the grammar offers must have its
 * whole line in the prompt. The builder's 1,200-character default cap used to cut the issue list while
 * the grammar still offered all 24 ids, so a model could explain issues it was never shown.
 */
function seesEveryOfferedIssue(req: AuthoringRequest): boolean {
  const built = buildAiPrompt(req.prompt, new SemanticRedactor(), "0123456789abcdef");
  if (!built.ok || built.omittedFields.length > 0) return false;
  const lines = built.user.split("\n");
  return req.issues.every((ref) => lines.some((line) => line.startsWith(`${ref.id}: ${ref.issue.code} `) && line.includes(FLOW_VALIDATION_RULES[ref.issue.code].summary) && line.endsWith(`Action: ${ref.step}`)));
}
check("every id the grammar offers has its whole line in the prompt", seesEveryOfferedIssue(request));

// The same flow as a recording would produce it: every node and connector id a UUID.
const uuidOf = new Map(brokenFlow.nodes.map((node, i) => [node.id, `3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b${String(i).padStart(2, "0")}`]));
const recordedFlow = {
  ...brokenFlow,
  nodes: brokenFlow.nodes.map((node) => ({ ...node, id: uuidOf.get(node.id)! })),
  edges: (brokenFlow.edges ?? []).map((edge) => ({ ...edge, id: `7c9e6679-7425-40de-944b-e07fc1f90a${edge.id}`, source: uuidOf.get(edge.source)!, target: uuidOf.get(edge.target)! }))
} as FlowProfile;
const recordedRequest = buildAuthoringRequest(validateFlowDefinition(recordedFlow));
const recordedPrompt = recordedRequest && buildAiPrompt(recordedRequest.prompt, new SemanticRedactor(), "0123456789abcdef");
check(
  "UUID anchors leave the prompt byte-identical, so its size never grows with the user's ids",
  recordedPrompt?.ok === true && recordedPrompt.system === rendered.system && recordedPrompt.user === rendered.user
);
// `safeFix.from`/`to` are withheld even though they are usually enum casing: "usually" is not a contract.
check("a fix's from/to literals are withheld", emitted.every((issue) => !promptText.includes(`${issue.safeFix!.from}"`)), JSON.stringify(emitted.map((i) => i.safeFix!.from)));
const lineOf = (ref: AuthoringRequest["issues"][number]) => promptText.split("\n").find((line) => line.startsWith(`${ref.id}: `)) ?? "";
check("an issue is marked fixable on its line exactly when the validator emitted a fix", request.issues.every((ref) => lineOf(ref).includes(", fixable)") === ref.fixable) && request.issues.some((ref) => ref.fixable));
check("...and a fixable issue's step is that fix through its preview, saying what it does", request.issues.filter((ref) => ref.fixable).every((ref) => ref.step.startsWith("Review and apply the offered safe fix, which ")));

// ── 2. The grammar itself closes the id space ───────────────────────────────────────────────────
console.log("\n2 — the decoding grammar cannot produce an id this report does not have");
const schema = request.schema as { properties: Record<string, { items?: { properties?: Record<string, { enum?: string[] }>; enum?: string[] } }> };
const explainEnum = schema.properties.explanations.items!.properties!.issueId.enum;
const rankEnum = schema.properties.ranking.items!.enum;
check("the explanation id enum is exactly this report's ids", JSON.stringify(explainEnum) === JSON.stringify(ids), JSON.stringify(explainEnum));
check("the ranking id enum is NARROWER — only the emitted-fix ids", JSON.stringify(rankEnum) === JSON.stringify(request.fixableIds), JSON.stringify(rankEnum));
check("the answer schema has no field through which a fix KIND could be returned", !JSON.stringify(request.schema).includes("kind"));

// ── 3. A good answer, end to end through the real AiService ─────────────────────────────────────
console.log("\n3 — a valid answer, decoded by the real output contract");
const good = JSON.stringify({
  version: 1,
  explanations: ids.map((id) => ({ issueId: id, text: `This step cannot run as configured (${id}).` })),
  ranking: [fixableId]
});
const h = harness([good]);
const outcome = await h.service.submit({
  requestId: "l4b-good",
  feature: "validationExplanation",
  priority: "interactive",
  prompt: request.prompt,
  schema: request.schema,
  maxOutputTokens: AUTHORING_LIMITS.maxOutputTokens,
  timeoutMs: AUTHORING_LIMITS.timeoutMs
});
check("the job completes", outcome.status === "ok", JSON.stringify(outcome));
const parsed = outcome.status === "ok" ? parseAuthoringAnswer(outcome.value, request) : undefined;
check("the answer parses", parsed?.ok === true, JSON.stringify(parsed));
if (parsed?.ok) {
  check("...with one explanation per sent issue", parsed.explanations.length === request.issues.length && request.issues.length === AUTHORING_LIMITS.maxIssues, String(parsed.explanations.length));
  check("...each carrying the validator's own issue, not a re-derived one", parsed.explanations.every((e, i) => e.issue === request.issues[i].issue));
  check("...and the ranking is the emitted-fix id", JSON.stringify(parsed.ranking) === JSON.stringify([fixableId]));
}
await h.service.shutdown();

// ── 4. Every way an answer can overreach ────────────────────────────────────────────────────────
console.log("\n4 — refusals: the validator stays the source of truth");
const refusals: Array<[string, unknown, string, string]> = [
  [
    "an id from another report is refused",
    { version: 1, explanations: [{ issueId: "i999", text: "x" }] },
    "UNKNOWN_ISSUE",
    "explanations.0.issueId"
  ],
  [
    "the same issue explained twice is refused",
    { version: 1, explanations: [{ issueId: ids[0], text: "a" }, { issueId: ids[0], text: "b" }] },
    "DUPLICATE_ISSUE",
    "explanations.1.issueId"
  ],
  [
    "ranking an issue the validator emitted NO fix for is refused",
    { version: 1, explanations: [], ranking: [unfixableId] },
    "FIX_NOT_EMITTED",
    "ranking.0"
  ],
  [
    "ranking an unknown id is refused",
    { version: 1, explanations: [], ranking: ["i999"] },
    "UNKNOWN_ISSUE",
    "ranking.0"
  ],
  [
    "the same fix ranked twice is refused",
    { version: 1, explanations: [], ranking: [fixableId, fixableId] },
    "DUPLICATE_ISSUE",
    "ranking.1"
  ],
  [
    "an empty explanation is refused",
    { version: 1, explanations: [{ issueId: ids[0], text: "   " }] },
    "EMPTY_EXPLANATION",
    "explanations.0.text"
  ],
  [
    "control characters in prose are refused",
    { version: 1, explanations: [{ issueId: ids[0], text: `bad${String.fromCharCode(7)}text` }] },
    "UNSAFE_TEXT",
    "explanations.0.text"
  ],
  [
    "an over-long explanation is refused",
    { version: 1, explanations: [{ issueId: ids[0], text: "x".repeat(AUTHORING_LIMITS.maxExplanationChars + 1) }] },
    "MALFORMED",
    "explanations.0.text"
  ],
  ["a wrong version is refused", { version: 2, explanations: [] }, "MALFORMED", "version"],
  ["a non-object answer is refused", ["not", "an", "object"], "MALFORMED", "$"],
  ["a non-array explanations field is refused", { version: 1, explanations: "all fine" }, "MALFORMED", "explanations"],
  ["a non-array ranking is refused", { version: 1, explanations: [], ranking: fixableId }, "MALFORMED", "ranking"]
];
for (const [label, value, code, field] of refusals) {
  const result = parseAuthoringAnswer(value, request);
  check(label, !result.ok && result.code === code && result.field === field, JSON.stringify(result));
}
check("no refusal echoes model text back to the caller", refusals.every(([, value]) => {
  const result = parseAuthoringAnswer(value, request);
  return result.ok || !JSON.stringify(result).includes("all fine");
}));

// ── 5. A fix kind the model invents cannot even decode ──────────────────────────────────────────
console.log("\n5 — a model that tries to propose a repair of its own");
// Otherwise valid, so the invented field is the ONLY thing the output contract can refuse it for.
const invented = harness([JSON.stringify({ ...JSON.parse(good), newFix: { kind: "reconnectOrphan", nodeId: "n-click" } })]);
const inventedOutcome = await invented.service.submit({
  requestId: "l4b-invented",
  feature: "validationExplanation",
  priority: "interactive",
  prompt: request.prompt,
  schema: request.schema,
  maxOutputTokens: AUTHORING_LIMITS.maxOutputTokens,
  timeoutMs: AUTHORING_LIMITS.timeoutMs
});
check("an invented fix field is refused by the output contract, before this module sees it", inventedOutcome.status === "failed" && inventedOutcome.code === "SCHEMA_REJECTED", JSON.stringify(inventedOutcome));
check("...and no value reaches the caller", !("value" in inventedOutcome));
await invented.service.shutdown();

// ── 6. Tiers ────────────────────────────────────────────────────────────────────────────────────
console.log("\n6 — explanations observe, ranking suggests, neither applies");
const explain = authoringExplanationDecision(POLICY);
check("an explanation is T0 observe", explain.decision === "observe" && explain.tier === "T0", JSON.stringify(explain));
const rank = authoringRankingDecision(POLICY);
check("a ranking is T1 suggest — never autoApply", rank.decision === "suggest" && rank.tier === "T1", JSON.stringify(rank));
const rankRaised = authoringRankingDecision({ enabled: true, featureTiers: { safeFixRanking: "T2" } });
check("configuration cannot raise ranking to auto-apply", rankRaised.decision === "suggest", JSON.stringify(rankRaised));
const off = authoringRankingDecision({ enabled: false });
check("the master switch off forbids the ranking", off.decision === "forbidden" && off.reason === "MASTER_SWITCH_OFF");
const explainOff = authoringExplanationDecision({ enabled: false });
check("...and the explanation too", explainOff.decision === "forbidden");
const lowered = authoringRankingDecision({ enabled: true, featureTiers: { safeFixRanking: "T0" } });
check("an administrator may lower ranking to observe", lowered.decision === "observe" && lowered.tier === "T0");

// ── 7. Bounds, and a report with nothing to ask about ───────────────────────────────────────────
console.log("\n7 — bounds");
const clean = validateFlowDefinition({
  id: "flow-clean",
  name: "Clean",
  version: 1,
  nodes: [
    { id: "s", type: "start", name: "Start" },
    { id: "c", type: "click", name: "Click ok", locator: { strategy: "testId", value: "ok" } },
    { id: "e", type: "end", name: "End" }
  ],
  edges: [
    { id: "a", source: "s", target: "c" },
    { id: "b", source: "c", target: "e" }
  ]
} as FlowProfile);
check("a clean flow really has no issues", clean.issues.length === 0, JSON.stringify(clean.issues.map((i) => i.code)));
check("...so there is nothing to ask, and no request is built", buildAuthoringRequest(clean) === undefined);

const big: FlowProfile = {
  ...brokenFlow,
  nodes: [
    { id: "n-start", type: "start", name: "Start" },
    ...Array.from({ length: 40 }, (_, i) => ({ id: `bad-${i}`, type: "click", name: `Step ${i}` })),
    { id: "n-end", type: "end", name: "End" }
  ],
  edges: [{ id: "only", source: "n-start", target: "n-end" }]
} as FlowProfile;
const bigReport = validateFlowDefinition(big);
check("the large fixture really exceeds the cap", bigReport.issues.length > AUTHORING_LIMITS.maxIssues, String(bigReport.issues.length));
const capped = buildAuthoringRequest(bigReport) as AuthoringRequest;
check("a large report is capped", capped.issues.length === AUTHORING_LIMITS.maxIssues, String(capped.issues.length));
check("...and says how many it left out, so a UI never implies the list was complete", capped.truncated === bigReport.issues.length - AUTHORING_LIMITS.maxIssues, String(capped.truncated));
check("...and its id enum matches what it actually sent", (capped.schema as { properties: Record<string, { items?: { properties?: Record<string, { enum?: string[] }> } }> }).properties.explanations.items!.properties!.issueId.enum!.length === AUTHORING_LIMITS.maxIssues);
check("...and the model saw every one of those issues in full", seesEveryOfferedIssue(capped));
const cappedProperties = (capped.schema as { properties: Record<string, { minItems?: number; maxItems?: number }> }).properties;
check("every sent issue must be explained: the grammar asks for exactly one explanation each", cappedProperties.explanations.minItems === capped.issues.length && cappedProperties.explanations.maxItems === capped.issues.length);
const skipped = parseAiOutput(JSON.stringify({ version: 1, explanations: [{ issueId: capped.issues[0].id, text: "Only one." }] }), capped.schema);
check("...so an answer that skips one is refused by the output contract", !skipped.ok && skipped.code === "SCHEMA_REJECTED", JSON.stringify(skipped));
check("with nothing fixable there is no ranking to decode at all, not a placeholder id", capped.fixableIds.length === 0 && !("ranking" in cappedProperties), JSON.stringify(Object.keys(cappedProperties)));
const placeholder = parseAiOutput(JSON.stringify({ version: 1, explanations: capped.issues.map((ref) => ({ issueId: ref.id, text: "Unreachable." })), ranking: ["none"] }), capped.schema);
check("...so the old placeholder ranking is refused by the output contract", !placeholder.ok && placeholder.code === "SCHEMA_REJECTED", JSON.stringify(placeholder));

// With room for two, the issue that stops the run must not lose its place to orphans that sort first.
const buried = validateFlowDefinition({
  id: "flow-buried",
  name: "Buried",
  version: 1,
  nodes: [
    { id: "s", type: "start", name: "Start" },
    { id: "n-live", type: "click", name: "Live click" },
    ...Array.from({ length: 3 }, (_, i) => ({ id: `n-orphan-${i}`, type: "click", name: `Orphan ${i}`, locator: { strategy: "testId", value: `orphan-${i}` } })),
    { id: "e", type: "end", name: "End" }
  ],
  edges: [
    { id: "x1", source: "s", target: "n-live" },
    { id: "x2", source: "n-live", target: "e" }
  ]
} as FlowProfile);
const blockingAt = buried.issues.findIndex(isExecutionBlocking);
check(
  "(precondition) the one blocking issue comes after more non-blocking ones than the cap",
  buried.issues.filter(isExecutionBlocking).length === 1 && blockingAt >= AUTHORING_LIMITS.maxIssues,
  JSON.stringify(buried.issues.map((i) => `${i.code}@${i.nodeId}`))
);
const buriedRequest = buildAuthoringRequest(buried) as AuthoringRequest;
check("the blocking issue is sent first", buriedRequest.issues[0].issue === buried.issues[blockingAt], JSON.stringify(buriedRequest.issues.map((ref) => ref.issue.code)));
check("...then the rest in report order", buriedRequest.issues[1].issue === buried.issues[0]);
check("...and the rest are counted, not lost", buriedRequest.truncated === buried.issues.length - AUTHORING_LIMITS.maxIssues);

const lowerCap = buildAuthoringRequest(bigReport, { maxIssues: 1 }) as AuthoringRequest;
check("a caller may ask for fewer", lowerCap.issues.length === 1);
const raisedCap = buildAuthoringRequest(bigReport, { maxIssues: 500 }) as AuthoringRequest;
check("...but never more than the documented maximum", raisedCap.issues.length === AUTHORING_LIMITS.maxIssues);

// ── 8. The validator's own verdict is untouched ─────────────────────────────────────────────────
console.log("\n8 — the AI path changes nothing about validation");
const afterAll = validateFlowDefinition(brokenFlow);
check("re-validating the same profile gives the same issue codes", JSON.stringify(afterAll.issues.map((i) => i.code)) === JSON.stringify(report.issues.map((i) => i.code)));
check("...the same severities", JSON.stringify(afterAll.issues.map((i) => i.severity)) === JSON.stringify(report.issues.map((i) => i.severity)));
check("...and the same emitted fixes", JSON.stringify(afterAll.issues.map((i) => i.safeFix?.kind ?? null)) === JSON.stringify(report.issues.map((i) => i.safeFix?.kind ?? null)));

// ── 9. The main-process adapter behind ai:explainValidation ─────────────────────────────────────
// `app/main/ai/aiAssist.ts` is what the IPC channel calls. Driven here with the real AiService over
// the deterministic transport, so every negative control below is the production decision.
console.log("\n9 — the main-process adapter behind ai:explainValidation");
const WINDOW = 7;
const OTHER_WINDOW = 8;
const assistDeps = (service: AiService, policy: AiPolicyConfig = POLICY, savedFlowIds: string[] = []): AiAssistDeps => ({
  submit: (job) => service.submit(job),
  policy: async () => policy,
  savedFlowIds: async () => savedFlowIds
});

const viaIpc = harness([good]);
const rendererProfile = structuredClone(brokenFlow);
const rendererBefore = JSON.stringify(rendererProfile);
const view = await explainFlowValidation(WINDOW, { requestId: "ui-1", profile: rendererProfile }, assistDeps(viaIpc.service));
check("a renderer request is answered", view.ok && view.code === "OK", JSON.stringify(view).slice(0, 300));
check(
  "...each explanation attached to the validator's own issue",
  view.explanations.length === request.issues.length && view.explanations.every((e, i) => e.issue.code === request.issues[i].issue.code && e.issue.message === request.issues[i].issue.message)
);
check("...the ranking is the validator-emitted fix, as an issue the UI can place", view.ranking.length === 1 && view.ranking[0].safeFix !== undefined, JSON.stringify(view.ranking));
check("...and the model is named", view.modelId === "fake-l4b-model");
check("the renderer's profile is never modified", JSON.stringify(rendererProfile) === rendererBefore);
const ipcPrompt = viaIpc.fake.inferRequests().map((r) => `${r.system}\n${r.user}`).join("\n");
check("exactly one model call was made", viaIpc.calls() === 1, String(viaIpc.calls()));
check("the IPC path sends no step name, typed value or locator either", ![SECRET_NAME, SECRET_VALUE, SECRET_LOCATOR].some((s) => ipcPrompt.includes(s)));
await viaIpc.service.shutdown();

// Ranking lowered to T0 by an administrator: explanations still arrive, the fix order does not.
const lowRank = harness([good]);
const lowView = await explainFlowValidation(WINDOW, { requestId: "ui-2", profile: brokenFlow }, assistDeps(lowRank.service, { enabled: true, featureTiers: { safeFixRanking: "T0" } }));
check("with ranking lowered to T0 the explanations still arrive", lowView.ok && lowView.explanations.length === request.issues.length, JSON.stringify(lowView).slice(0, 200));
check("...but the fix order is withheld, not shown as a plain interpretation", lowView.ranking.length === 0);
await lowRank.service.shutdown();

// The master switch refuses before the model is asked.
const switchedOff = harness([good]);
const offView = await explainFlowValidation(WINDOW, { requestId: "ui-3", profile: brokenFlow }, assistDeps(switchedOff.service, { enabled: false }));
check("AI switched off answers DISABLED", !offView.ok && offView.code === "DISABLED", JSON.stringify(offView));
check("...without asking the model", switchedOff.calls() === 0);
await switchedOff.service.shutdown();

// Malformed requests are refused before validation, and never reach the model.
const strict = harness([good]);
const malformed: Array<[string, unknown]> = [
  ["a non-object request", "flow-l4b"],
  ["a missing request id", { profile: brokenFlow }],
  ["a request id with a path separator", { requestId: "../x", profile: brokenFlow }],
  ["an over-long request id", { requestId: "r".repeat(65), profile: brokenFlow }],
  ["a profile id with a path separator", { requestId: "ui-4", profile: { ...brokenFlow, id: "a/b" } }],
  ["a profile without a node list", { requestId: "ui-5", profile: { ...brokenFlow, nodes: "all" } }],
  ["a profile over the node bound", { requestId: "ui-6", profile: { ...brokenFlow, nodes: Array.from({ length: AI_ASSIST_MAX_NODES + 1 }, (_, i) => ({ id: `n${i}`, type: "click", name: "x" })) } }]
];
for (const [label, input] of malformed) {
  const refused = await explainFlowValidation(WINDOW, input, assistDeps(strict.service));
  check(`${label} is refused as INVALID_REQUEST`, !refused.ok && refused.code === "INVALID_REQUEST", JSON.stringify(refused).slice(0, 200));
}
check("...and none of them reached the model", strict.calls() === 0, String(strict.calls()));
await strict.service.shutdown();

// A model answer that overreaches is discarded whole, and its text never reaches the renderer. Every
// issue is explained, so the ranking is the only thing it can be refused for.
const overreach = harness([JSON.stringify({ version: 1, explanations: ids.map((id) => ({ issueId: id, text: "MODEL-SAYS-Zebra" })), ranking: [unfixableId] })]);
const overView = await explainFlowValidation(WINDOW, { requestId: "ui-7", profile: brokenFlow }, assistDeps(overreach.service));
check("an answer ranking an unfixable issue is refused as OUTPUT_REJECTED", !overView.ok && overView.code === "OUTPUT_REJECTED", JSON.stringify(overView));
check("...with nothing from it shown, not even the valid-looking explanation", overView.explanations.length === 0 && !JSON.stringify(overView).includes("MODEL-SAYS"));
await overreach.service.shutdown();

// Nothing to ask about.
const idle = harness([good]);
const cleanProfile = { id: "flow-clean", name: "Clean", version: 1, nodes: [{ id: "s", type: "start", name: "Start" }, { id: "c", type: "click", name: "Click ok", locator: { strategy: "testId", value: "ok" } }, { id: "e", type: "end", name: "End" }], edges: [{ id: "a", source: "s", target: "c" }, { id: "b", source: "c", target: "e" }] };
const cleanView = await explainFlowValidation(WINDOW, { requestId: "ui-8", profile: cleanProfile }, assistDeps(idle.service));
check("a clean flow answers NOTHING_TO_ASK without a model call", cleanView.code === "NOTHING_TO_ASK" && idle.calls() === 0, JSON.stringify(cleanView));

// Main validates with the saved library, exactly like the designer: a reference to a saved flow is not a finding.
const refProfile = { ...cleanProfile, id: "flow-ref", nodes: [...cleanProfile.nodes.slice(0, 2), { id: "r", type: "runFlow", name: "Run child", flowId: "child-flow" }, cleanProfile.nodes[2]], edges: [{ id: "a", source: "s", target: "c" }, { id: "b", source: "c", target: "r" }, { id: "d", source: "r", target: "e" }] };
const refUnknown = await explainFlowValidation(WINDOW, { requestId: "ui-9", profile: refProfile }, assistDeps(idle.service, POLICY, []));
check("a run-flow target that is not saved is a finding to explain", refUnknown.code !== "NOTHING_TO_ASK", JSON.stringify(refUnknown).slice(0, 200));
const refKnown = await explainFlowValidation(WINDOW, { requestId: "ui-10", profile: refProfile }, assistDeps(idle.service, POLICY, ["child-flow"]));
check("...and with that flow saved there is nothing to ask", refKnown.code === "NOTHING_TO_ASK", JSON.stringify(refKnown).slice(0, 200));
await idle.service.shutdown();

// Cancellation reaches only the asking window's own job.
const slow = harness([{ hang: true }]);
const pendingView = explainFlowValidation(WINDOW, { requestId: "ui-hang", profile: brokenFlow }, assistDeps(slow.service));
const hangDeadline = Date.now() + 5_000;
while (slow.calls() === 0 && Date.now() < hangDeadline) await new Promise((r) => setTimeout(r, 10));
check("the hanging job reached the model (precondition for the cancel checks)", slow.calls() === 1);
const foreign = cancelAssist(OTHER_WINDOW, "ui-hang", (id) => slow.service.cancel(id));
check("another window cannot cancel it", !foreign.ok && foreign.code === "NOT_FOUND", JSON.stringify(foreign));
check("a malformed cancel id is refused", cancelAssist(WINDOW, "../ui-hang", (id) => slow.service.cancel(id)).code === "INVALID_REQUEST");
const own = cancelAssist(WINDOW, "ui-hang", (id) => slow.service.cancel(id));
check("the asking window can", own.ok, JSON.stringify(own));
const cancelledView = await pendingView;
check("...and the request answers CANCELLED", cancelledView.code === "CANCELLED" && cancelledView.explanations.length === 0, JSON.stringify(cancelledView));
await slow.service.shutdown();

// A timeout and a host failure are codes, never runtime text.
const failing = harness([{ fail: "AI_HOST_EXITED" }]);
const failView = await explainFlowValidation(WINDOW, { requestId: "ui-11", profile: brokenFlow }, assistDeps(failing.service));
check("a host failure answers FAILED with a product sentence", !failView.ok && failView.code === "FAILED" && !/AI_HOST/.test(JSON.stringify(failView)), JSON.stringify(failView));
await failing.service.shutdown();

// ── 10. The explanation's own deadline ──────────────────────────────────────────────────────────
// Qwen3.5-0.8B answers the product's request in 70–76 s (L1.8), and the shared 30 s deadline cancelled
// every answer. Driven through `explainFlowValidation` with the production AiService and its production
// limits; the fake transport applies each call's deadline as the manager does. On a virtual clock, so
// the timeline is the real one and a 125 s deadline costs milliseconds.
console.log("\n10 — the explanation's own deadline, on a virtual clock");

const clock = virtualClock();
const { settle } = clock;

/** `explanationAtCapMs` in scripts/benchmark-ai-model.mts: this feature's worst case at the output cap. */
const CEILING_MS = 120_000;
/** Measured beside the product's request (L1.8): wall minus prompt and generation ≤ 41 ms, main-loop delay ≤ 61 ms. */
const MEASURED_OVERHEAD_MS = 41 + 61;
const OLD_DEADLINE_MS = 30_000;
const DEADLINE = AUTHORING_LIMITS.timeoutMs;
/** Far past any deadline here, so a wrong deadline shows as a wrong outcome, never as work left pending. */
const BUDGET_MS = 10 * 60_000;
const PRODUCTION = { limits: AI_SERVICE_LIMITS };
const explainWith = (h: ReturnType<typeof harness>, requestId: string) => explainFlowValidation(WINDOW, { requestId, profile: brokenFlow }, assistDeps(h.service));
const countersOf = async (h: ReturnType<typeof harness>) => (await h.service.status()).counters;
/** Shutdown waits on timers too: off the clock it would never return. */
const stop = (h: ReturnType<typeof harness>) => settle(h.service.shutdown(), BUDGET_MS);
const brief = (value: unknown) => JSON.stringify(value)?.slice(0, 200);

check("the explanation has its own deadline: the L1.8 ceiling plus a 5 s allowance", DEADLINE === CEILING_MS + 5_000, String(DEADLINE));
check("...which the service accepts, where a longer one is refused as an invalid request", DEADLINE <= AI_SERVICE_LIMITS.maxJobTimeoutMs, `${DEADLINE} vs ${AI_SERVICE_LIMITS.maxJobTimeoutMs}`);
// Failure analysis and locator attempts now have deadlines of their own (verify:ai-deadlines); the
// fragment summary still shares the old 30 s, so it is the one this deadline must not have touched.
check("the fragment summary keeps its 30 s", FRAGMENT_ASSIST_LIMITS.timeoutMs === OLD_DEADLINE_MS, String(FRAGMENT_ASSIST_LIMITS.timeoutMs));

clock.install();
try {
  const late = harness([{ text: good, delayMs: OLD_DEADLINE_MS + 1_000 }], PRODUCTION);
  const lateStarted = clock.now();
  const lateView = await settle(explainWith(late, "dl-late"), BUDGET_MS);
  check("an answer arriving after the old 30 s deadline is delivered", lateView?.value.ok === true && lateView.value.code === "OK", brief(lateView?.value));
  check("...when it arrived, 31 s in: the clock really ran", (lateView?.atMs ?? 0) - lateStarted >= OLD_DEADLINE_MS + 1_000, String((lateView?.atMs ?? 0) - lateStarted));
  check(
    "...with every explanation attached to its validator issue",
    lateView?.value.explanations.length === request.issues.length && lateView.value.explanations.every((e, i) => e.issue.code === request.issues[i].issue.code)
  );
  check("...from exactly one model call", late.calls() === 1, String(late.calls()));
  await stop(late);

  const edge = harness([{ text: good, delayMs: CEILING_MS + MEASURED_OVERHEAD_MS }], PRODUCTION);
  const edgeView = await settle(explainWith(edge, "dl-edge"), BUDGET_MS);
  check("an answer at the 120 s ceiling plus the measured overhead is delivered", edgeView?.value.code === "OK", brief(edgeView?.value));
  await stop(edge);

  const stuck = harness([{ hang: true }], PRODUCTION);
  const stuckStarted = clock.now();
  const stuckView = await settle(explainWith(stuck, "dl-hang"), BUDGET_MS);
  const stuckMs = (stuckView?.atMs ?? 0) - stuckStarted;
  check("an answer that never comes fails TIMEOUT", stuckView?.value.code === "TIMEOUT" && !stuckView.value.ok, brief(stuckView?.value));
  check("...at the explanation's own deadline, not the old 30 s", stuckMs >= DEADLINE && stuckMs <= DEADLINE + AI_HOST_TIMEOUTS.cancelMs, `${stuckMs} ms`);
  check("...saying so in a product sentence, never runtime text", stuckView?.value.message === "Local AI took too long to answer." && !/AI_HOST/.test(JSON.stringify(stuckView?.value)));
  check("...and the inference it gave up on is cancelled on the host", stuck.fake.requests.some((r) => r.type === "cancel" && r.jobId.startsWith(`${assistJobId(WINDOW, "dl-hang")}#`)));
  await stop(stuck);

  // A user cancel after the old deadline, before the new one.
  const waiting = harness([{ hang: true }], PRODUCTION);
  let waitingView: AuthoringAssistView | undefined;
  const waitingPending = explainWith(waiting, "dl-cancel").then((view) => (waitingView = view));
  await clock.run(clock.now() + 2 * OLD_DEADLINE_MS);
  check(
    "(precondition) 60 s in, the explanation is still running rather than timed out",
    waitingView === undefined && waiting.calls() === 1 && (await waiting.service.status()).state.kind === "busy",
    brief(waitingView)
  );
  const cancelledAt = clock.now();
  check("the asking window cancels it", cancelAssist(WINDOW, "dl-cancel", (id) => waiting.service.cancel(id)).ok);
  const cancelled = await settle(waitingPending, BUDGET_MS);
  check("...and it answers CANCELLED, not TIMEOUT", cancelled?.value.code === "CANCELLED", brief(cancelled?.value));
  check("...promptly", cancelled !== undefined && cancelled.atMs - cancelledAt <= AI_HOST_TIMEOUTS.cancelMs, String(cancelled && cancelled.atMs - cancelledAt));
  await clock.run(clock.now() + DEADLINE);
  const waitingCounters = await countersOf(waiting);
  check("...counted once as a cancel; its deadline passing later adds nothing", waitingCounters.cancelled === 1 && waitingCounters.failed === 0 && waitingCounters.completed === 0, JSON.stringify(waitingCounters));
  await stop(waiting);

  // An answer that lands after the deadline must not complete anything, then or later.
  const STALE = JSON.stringify({ version: 1, explanations: ids.map((id) => ({ issueId: id, text: `STALE-${id}` })) });
  const overdue = harness([{ text: STALE, delayMs: DEADLINE + 5_000 }, good], PRODUCTION);
  const overdueView = await settle(explainWith(overdue, "dl-overdue"), BUDGET_MS);
  check("an answer due after the deadline is not waited for: TIMEOUT", overdueView?.value.code === "TIMEOUT", brief(overdueView?.value));
  await clock.run(clock.now() + 30_000);
  const overdueCounters = await countersOf(overdue);
  check("...counted once, as a failure: nothing completes when its answer was due", overdueCounters.failed === 1 && overdueCounters.completed === 0 && overdueCounters.cancelled === 0, JSON.stringify(overdueCounters));
  check("...and the request is gone, so a cancel for it finds nothing", cancelAssist(WINDOW, "dl-overdue", (id) => overdue.service.cancel(id)).code === "NOT_FOUND");
  const nextView = await settle(explainWith(overdue, "dl-after-overdue"), BUDGET_MS);
  check(
    "the next explanation gets its own answer, never the late one",
    nextView?.value.code === "OK" && nextView.value.explanations.length === ids.length && !JSON.stringify(nextView.value).includes("STALE-"),
    brief(nextView?.value)
  );
  await stop(overdue);

  // Stuck in prompt evaluation at the deadline: the cancel cannot be honoured, so the host is killed.
  const killed = harness([{ hang: true, killOnCancel: true }, good], PRODUCTION);
  const killedView = await settle(explainWith(killed, "dl-kill"), BUDGET_MS);
  check("a model stuck in prompt evaluation at the deadline still ends TIMEOUT", killedView?.value.code === "TIMEOUT", brief(killedView?.value));
  check("(precondition) the host was killed to free it, not crashed", killed.fake.kills === 1 && killed.fake.crashes === 0, `kills ${killed.fake.kills}, crashes ${killed.fake.crashes}`);
  const reloadedView = await settle(explainWith(killed, "dl-kill-next"), BUDGET_MS);
  check("the next explanation is answered", reloadedView?.value.code === "OK" && reloadedView.value.explanations.length === ids.length, brief(reloadedView?.value));
  check("...after a fresh handshake and model reload", killed.fake.requestTypes().join(",") === "hello,load,infer,cancel,hello,load,infer", killed.fake.requestTypes().join(","));
  const killedCounters = await countersOf(killed);
  check("...one timeout and one completion, nothing counted twice", killedCounters.failed === 1 && killedCounters.completed === 1 && killedCounters.cancelled === 0, JSON.stringify(killedCounters));
  await stop(killed);

  // Another feature through the same module and service: still its own 30 s.
  const fragment = {
    id: "frag-deadline",
    name: "Fill then click",
    kind: "fragment",
    version: 1,
    nodes: [
      { id: "fa", type: "fill", name: "Fill", value: "x", locator: { strategy: "css", value: "#x" } },
      { id: "fb", type: "click", name: "Go", locator: { strategy: "testId", value: "go" } }
    ],
    edges: [{ id: "fe", source: "fa", target: "fb", type: "success" }],
    inputs: []
  } as unknown as FlowFragment;
  const slowSummary = harness([{ text: JSON.stringify({ version: 1, summary: "Fills a field and clicks to continue." }), delayMs: OLD_DEADLINE_MS + 1_000 }], PRODUCTION);
  const summaryStarted = clock.now();
  const summaryView = await settle(
    summarizeFragment(WINDOW, { requestId: "dl-fragment", fragmentId: fragment.id }, { submit: (job) => slowSummary.service.submit(job), policy: async () => POLICY, fragment: async () => fragment }),
    BUDGET_MS
  );
  const summaryMs = (summaryView?.atMs ?? 0) - summaryStarted;
  check(
    "a fragment summary slower than 30 s still times out at its own 30 s",
    summaryView?.value.code === "TIMEOUT" && summaryMs >= FRAGMENT_ASSIST_LIMITS.timeoutMs && summaryMs <= FRAGMENT_ASSIST_LIMITS.timeoutMs + AI_HOST_TIMEOUTS.cancelMs,
    `${summaryView?.value.code} after ${summaryMs} ms`
  );
  await stop(slowSummary);
} finally {
  clock.uninstall();
}

console.log("\n11 — the labelled set verify:ai-authoring-quality-live sends, and its judge");
{
  const reportOf = (c: (typeof LABELLED_SET)[number]) => validateFlowDefinition(c.flow, { referenceableFlowIds: new Set([c.flow.id]) });
  check("the set has nine cases, each sending one or two issues", LABELLED_SET.length === 9 && LABELLED_SET.every((c) => c.sent.length >= 1 && c.sent.length <= 2));
  for (const labelled of LABELLED_SET) {
    const request = buildAuthoringRequest(reportOf(labelled));
    const sent = request?.issues.map((ref) => ({ code: ref.issue.code, fixable: ref.fixable, blocking: isExecutionBlocking(ref.issue) })) ?? [];
    check(`${labelled.id}: the report sends exactly its labelled codes, fixes and blocking as labelled`, JSON.stringify(sent) === JSON.stringify(labelled.sent), JSON.stringify(sent));
    check(`${labelled.id}: truncates what is labelled`, request?.truncated === (labelled.truncated ?? 0), `${request?.truncated}`);
    check(`${labelled.id}: blocking issues are sent first`, sent.every((s, i) => i === 0 || sent[i - 1].blocking || !s.blocking));
    check(`${labelled.id}: every sent code has a subject and a remedy to judge by`, sent.every((ref) => SUBJECT[ref.code] instanceof RegExp && REMEDY[ref.code] instanceof RegExp));
    const prompt = request ? buildAiPrompt(request.prompt, new SemanticRedactor(), "0123456789abcdef") : null;
    check(`${labelled.id}: the canary in its names and values never reaches the prompt`, Boolean(prompt?.ok) && prompt!.ok && !`${prompt!.system}\n${prompt!.user}`.toUpperCase().includes(CANARY));
  }
  // Non-vacuity: the canary really is in what the flows carry, or the check above proves nothing.
  check("(precondition) every case carries the canary in what it does not send", LABELLED_SET.every((c) => JSON.stringify(c.flow).includes(CANARY)));
  check("the families across the set are 14 distinct codes", new Set(LABELLED_SET.flatMap((c) => c.sent.map((s) => s.code))).size === 14);
  check("both fix kinds are sent", ["normalizeEnumCasing", "regenerateId"].every((kind) => LABELLED_SET.some((c) => buildAuthoringRequest(reportOf(c))?.issues.some((ref) => ref.issue.safeFix?.kind === kind))));
  // Blocking-first is only proven where the report's own order puts a non-blocking issue first.
  for (const id of ["locator-orphan", "priority"]) {
    const report = reportOf(LABELLED_SET.find((c) => c.id === id)!);
    check(`${id}: (precondition) the report itself lists a non-blocking issue first, so the builder reordered it`, report.issues.length > 0 && !isExecutionBlocking(report.issues[0]));
  }
  check("the set holds a warnings-only case, a lone issue and a truncated one", LABELLED_SET.some((c) => c.sent.every((s) => !s.blocking)) && LABELLED_SET.some((c) => c.sent.length === 1) && LABELLED_SET.some((c) => (c.truncated ?? 0) > 0));
  // R2 (owner, 2026-09-25): each line says whether its issue blocks the run, the run gate's own decision.
  const stated = LABELLED_SET.flatMap((c) => {
    const built = buildAuthoringRequest(reportOf(c));
    const lines = built?.prompt.fields.flatMap((f) => ("text" in f && typeof f.text === "string" ? f.text.split("\n") : [])) ?? [];
    return (built?.issues ?? []).map((ref, i) => {
      const line = lines.find((l) => l.startsWith(`${ref.id}: `)) ?? "";
      return { blocks: line.includes(", blocks the run, "), doesNot: line.includes(", does not block the run, "), labelled: c.sent[i]?.blocking };
    });
  });
  check(
    "every issue's line says whether it blocks the run, as labelled from the run gate, both ways across the set",
    stated.length === 17 && stated.every((s) => s.blocks === s.labelled && s.doesNot === !s.labelled) && stated.some((s) => s.labelled) && stated.some((s) => !s.labelled),
    JSON.stringify(stated)
  );
  const cycle = LABELLED_SET.find((c) => c.id === "cycle")!;
  const controls = authoringControlFailures(buildAuthoringRequest(reportOf(cycle))!);
  check("the judge's controls all hold (correct, swapped, vague, canary, partial, unemitted ranking; actionable, five unsupported screens and their negatives)", controls.length === 0, controls.join("; "));
  const priority = LABELLED_SET.find((c) => c.id === "priority")!;
  const ranking = rankingControlFailures(buildAuthoringRequest(reportOf(priority))!);
  check("the ranking-order controls all hold (blocking first, off-path first, blocking left out, none)", ranking.length === 0, ranking.join("; "));
  const labelledRequest = (id: string) => {
    const labelled = LABELLED_SET.find((c) => c.id === id);
    return labelled ? buildAuthoringRequest(reportOf(labelled)) : undefined;
  };
  const corrective = correctiveControlFailures(labelledRequest);
  check(
    "the reviewed failures are refused as controls: incorrect, inverted, irrelevant, unsupported and truncated guidance is never actionable, each correct twin is, and every product step restated clears the judge",
    corrective.length === 0,
    corrective.join("; ")
  );
  const literals = literalControlFailures(labelledRequest);
  check(
    "an invented value is fabricated in every quotation style and unquoted, and the request's own words quoted any way stay clear",
    literals.length === 0,
    literals.join("; ")
  );
  // R1 (owner, 2026-09-25): the seven displayed answers the AI evaluation found unsupported, verbatim.
  const causal = causalClaimControlFailures(labelledRequest);
  check(
    "the 7 displayed answers giving a non-blocking issue as a validation failure (2 with an invented 'first step') are defects and causal claims for a person; each twin stays clear",
    causal.length === 0,
    causal.join("; ")
  );
}

// ── 12. The owner's L4b decisions (2026-09-22) ──────────────────────────────────────────────────
// (1) the quality target adopted provisionally, (2) an evidence-grounded corrective step, (3) a local,
// redacted human review, (4) an optional fix order that keeps blocking fixes first.
console.log("\n12 — corrective step, fix priority, the review store and the adopted target");
{
  const reportOf = (c: (typeof LABELLED_SET)[number]) => validateFlowDefinition(c.flow, { referenceableFlowIds: new Set([c.flow.id]) });
  const requestFor = (id: string) => buildAuthoringRequest(reportOf(LABELLED_SET.find((c) => c.id === id)!))!;

  // (2) The instruction: each clause is a behaviour the owner asked for, so each is held on its own.
  const instructions = request.prompt.instructions;
  // R2 (owner, 2026-09-25): "You explain why an automation flow failed validation" was false for a warning,
  // and 7 displayed answers echoed it as a warning's cause.
  check("the task sentence presupposes no failure, which a warnings-only report never had", /^You explain each issue that validation found in an automation flow, for the person editing it\. /.test(instructions) && !/fail/i.test(instructions));
  check("...and each issue comes with whether it blocks the run", /severity, whether it blocks the run, where it is/.test(instructions));
  check("the instruction says each issue comes with the action that corrects it",/the rule's one-line summary and the action that corrects it/.test(instructions));
  check("...and asks for that action FIRST and as given, so the character limit cuts the explanation and not the action", /first its action as given, then what is wrong/.test(instructions));
  check("...and no other action: the action is the product's, grounded in the rule", /Never suggest another action/.test(instructions));
  check("...never inventing a step name, selector, value or connection", /never invent issues, ids, rules, step names, selectors, values or connections/.test(instructions));
  check("...nor a fix for an issue with no emitted fix", /Only an issue marked fixable has a safe fix the application can apply/.test(instructions));
  check("...and asks for fixes on the run path first when it orders them", /errors on the run path first/.test(instructions));
  check("the old ban on describing any repair stays gone: it forbade the corrective step itself", !/may not describe a repair/.test(instructions));
  check("the ranking is still limited to fixable ids", /You may not rank an id that is not marked fixable/.test(instructions));
  // L1.8's margin was 2.7 s at the slowest rates with the 97996c48 instruction (875 characters); the
  // step moved into each issue's line, so the instruction must not grow to pay for it.
  check("the instruction is shorter than the 97996c48 one it replaced", instructions.length < 875, String(instructions.length));

  // (4) The fix order: optional, and blocking fixes first where one fix is more urgent than another.
  const priority = requestFor("priority");
  const [blockingFix, offPathFix] = priority.issues;
  const texts = priority.issues.map((ref) => ({ issueId: ref.id, text: "Change the value to a legal one." }));
  const answerWith = (ranking?: string[]) => parseAuthoringAnswer({ version: 1, explanations: texts, ...(ranking ? { ranking } : {}) }, priority);
  check("(precondition) the priority case has a blocking fix and one that can wait", priority.fixableIds.length === 2 && isExecutionBlocking(blockingFix.issue) && !isExecutionBlocking(offPathFix.issue));
  const inOrder = answerWith([blockingFix.id, offPathFix.id]);
  check("a ranking with the blocking fix first is shown whole", inOrder.ok && JSON.stringify(inOrder.ranking) === JSON.stringify([blockingFix.id, offPathFix.id]) && inOrder.rankingWithheld === undefined, JSON.stringify(inOrder));
  const reversed = answerWith([offPathFix.id, blockingFix.id]);
  check("a ranking with the fix that can wait first is withheld: no fix order", reversed.ok && reversed.ranking.length === 0 && reversed.rankingWithheld === "PRIORITY_VIOLATION", JSON.stringify(reversed));
  check("...never re-sorted into the product's order and shown as the AI's", reversed.ok && !reversed.ranking.includes(blockingFix.id));
  check("...and the explanations still stand", reversed.ok && reversed.explanations.length === 2);
  const leftOut = answerWith([offPathFix.id]);
  check("ranking only the fix that can wait, leaving the blocking one out, is withheld too", leftOut.ok && leftOut.ranking.length === 0 && leftOut.rankingWithheld === "PRIORITY_VIOLATION");
  const blockingOnly = answerWith([blockingFix.id]);
  check("ranking only the blocking fix is kept", blockingOnly.ok && blockingOnly.ranking.length === 1 && blockingOnly.rankingWithheld === undefined);
  const none = answerWith();
  check("no ranking at all is an accepted answer with an empty fix order", none.ok && none.ranking.length === 0 && none.rankingWithheld === undefined);
  const casing = requestFor("casing");
  check("(precondition) the casing case's two fixes are equally urgent", casing.fixableIds.length === 2 && casing.issues.every((ref) => isExecutionBlocking(ref.issue)));
  const either = parseAuthoringAnswer({ version: 1, explanations: casing.issues.map((ref) => ({ issueId: ref.id, text: "Change the casing." })), ranking: [...casing.fixableIds].reverse() }, casing);
  check("with no documented priority between two fixes, any order is kept: none is invented", either.ok && either.ranking.length === 2 && either.rankingWithheld === undefined);
  check("rankingKeepsPriority has nothing to judge when nothing is ranked or nothing is more urgent", rankingKeepsPriority(priority, []) === null && rankingKeepsPriority(casing, casing.fixableIds) === null);

  // Through the adapter behind ai:explainValidation: a withheld order reaches the designer as no order.
  const priorityFlow = LABELLED_SET.find((c) => c.id === "priority")!.flow;
  const viewOf = async (ranking: string[]) => {
    const h = harness([JSON.stringify({ version: 1, explanations: texts, ranking })]);
    const v = await explainFlowValidation(WINDOW, { requestId: "p12", profile: priorityFlow }, assistDeps(h.service, POLICY, [priorityFlow.id]));
    await h.service.shutdown();
    return v;
  };
  const shownReversed = await viewOf([offPathFix.id, blockingFix.id]);
  check("the designer shows the explanations and NO fix order for a withheld ranking", shownReversed.code === "OK" && shownReversed.explanations.length === 2 && shownReversed.ranking.length === 0, JSON.stringify(shownReversed).slice(0, 200));
  const shownInOrder = await viewOf([blockingFix.id, offPathFix.id]);
  check("...and the model's order when it keeps the priority", shownInOrder.code === "OK" && shownInOrder.ranking.length === 2 && shownInOrder.ranking[0].code === blockingFix.issue.code);

  // (3) The review capture: redacted BEFORE it is written, and nothing from the flow in it.
  const reviewRoot = join(work, "review");
  const cycleRequest = requestFor("cycle");
  const PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----";
  const leaky = {
    version: 1,
    explanations: [
      { issueId: cycleRequest.issues[0].id, text: `Loop ${CANARY}; mail ops@example.com, token=abcd1234efgh, see https://x.test/a?b=c or C:\\Users\\bob\\f.` },
      // The key block before the full stop: an unfinished tail would be dropped before redaction ever saw it.
      { issueId: cycleRequest.issues[1].id, text: `${PRIVATE_KEY} Remove it.` }
    ]
  };
  const leakyAnswer = parseAuthoringAnswer(leaky, cycleRequest);
  if (!leakyAnswer.ok) throw new Error("the leaky scripted answer must parse");
  const capture = buildReviewCapture("fake-l4b-model", [
    { caseId: "cycle", request: cycleRequest, answer: leakyAnswer, judged: judgeAuthoringAnswer(cycleRequest, leakyAnswer), inferMs: 1 },
    { caseId: "single", request: requestFor("single"), answer: null, judged: null, inferMs: null }
  ]);
  const captureFile = await writeReviewCapture(reviewRoot, capture);
  const onDisk = readFileSync(captureFile, "utf8");
  check("the capture is written under the review directory given, and nowhere else", dirname(captureFile) === reviewRoot && readdirSync(reviewRoot).length === 1);
  check("no canary reaches the capture", !onDisk.toUpperCase().includes(CANARY));
  check("no email, token value, URL or user path reaches the capture", !/ops@example\.com|abcd1234efgh|x\.test|bob/.test(onDisk), onDisk.slice(0, 400));
  check("...they are redacted in place, so the rest of the text is still reviewable", capture.items[0].text?.includes("[redacted]") === true && capture.items[0].text.startsWith("Loop"));
  check("a text in which a secret survives redaction is not written at all", capture.items[1].text === null && capture.items[1].withheld === "RESIDUAL_SECRET" && !onDisk.includes("PRIVATE KEY"));
  // A text the limit cut is trimmed to its complete sentences; the capture must say so, or an action cut
  // and trimmed away reads as one the model never wrote.
  const cutAnswer = parseAuthoringAnswer(
    { version: 1, explanations: [{ issueId: cycleRequest.issues[0].id, text: "Connectors form a cycle. Change the connector that closes this cycle to a Loop" }, { issueId: cycleRequest.issues[1].id, text: "Remove this connector from the End step." }] },
    cycleRequest
  );
  if (!cutAnswer.ok) throw new Error("the cut scripted answer must parse");
  const cutItems = buildReviewCapture("fake-l4b-model", [{ caseId: "cycle", request: cycleRequest, answer: cutAnswer, judged: judgeAuthoringAnswer(cycleRequest, cutAnswer), inferMs: 1 }]).items;
  check("the capture marks a text the character limit cut, and only that one", cutItems[0]?.cut === true && cutItems[0].text === "Connectors form a cycle." && cutItems[1]?.cut === undefined, JSON.stringify(cutItems.map((i) => [i.text, i.cut])));
  check("each item carries the product's own Issues line as its evidence",capture.items.every((item) => item.evidence.startsWith(`${item.issueId}: ${item.code} `)));
  // A corrected judge reads what was captured again, in memory; the capture keeps the reading it was taken with.
  const offDomain = parseAuthoringAnswer({ version: 1, explanations: [{ issueId: cycleRequest.issues[0].id, text: "Restart the application to clear the loop." }, { issueId: cycleRequest.issues[1].id, text: "Remove this connector from the End step." }] }, cycleRequest);
  if (!offDomain.ok) throw new Error("the off-domain scripted answer must parse");
  const stale = buildReviewCapture("fake-l4b-model", [{ caseId: "cycle", request: cycleRequest, answer: offDomain, judged: judgeAuthoringAnswer(cycleRequest, offDomain), inferMs: 1 }]);
  stale.items[0].judged = { ...stale.items[0].judged, unsupported: [], category: "notActionable" };
  const staleBefore = JSON.stringify(stale);
  const reread = rereadCapture(stale, requestFor);
  check(
    "today's judge re-reads a capture: a reading it no longer gives is replaced and listed",
    reread.changed.length === 1 && reread.changed[0].itemId === stale.items[0].id && reread.capture.items[0].judged.category === "defect" && reread.capture.items[0].judged.unsupported.includes("OFF_DOMAIN") && reread.reread === 2,
    JSON.stringify(reread.changed)
  );
  check("...in memory: the capture keeps the model's text and the reading it was taken with", JSON.stringify(stale) === staleBefore);
  check(
    "...against its own request: the instructions only when its hash is today's, and a case whose ids carry other codes today keeps its reading",
    reread.instructionsRetained && !rereadCapture({ ...stale, instructionsSha256: "earlier" }, requestFor).instructionsRetained && rereadCapture(stale, () => requestFor("casing")).reread === 0
  );
  check("nothing from the flow is stored: no step name, flow name or connector id", !/Orders |click |"e[1-5]"/.test(onDisk));
  check("an undelivered case is captured with its sent issues and no answer, so it cannot raise a rate", capture.cases[1].delivered === false && capture.cases[1].sent === 1 && capture.items.every((i) => i.caseId === "cycle"));
  check("the capture is keyed to the product's instructions", capture.instructionsSha256 === instructionsSha256(request));

  // A person's verdict: validated, redacted, one per explanation.
  const item = capture.items[0].id;
  const verdict = { itemId: item, correct: true, actionable: true, grounded: true, unsupportedClaim: false, reviewer: "MA" };
  check("a verdict on an unknown explanation is refused", !(await recordVerdict(reviewRoot, { ...verdict, itemId: "nope/cycle/i0" })).ok);
  check("a verdict on a withheld explanation is refused: nothing to review", !(await recordVerdict(reviewRoot, { ...verdict, itemId: capture.items[1].id })).ok);
  check("a verdict with a missing yes/no is refused", !(await recordVerdict(reviewRoot, { ...verdict, grounded: undefined as unknown as boolean })).ok);
  check("a verdict without a reviewer label is refused", !(await recordVerdict(reviewRoot, { ...verdict, reviewer: "" })).ok);
  check("a note in which a secret survives redaction is refused", !(await recordVerdict(reviewRoot, { ...verdict, note: PRIVATE_KEY })).ok);
  check("a valid verdict is recorded", (await recordVerdict(reviewRoot, { ...verdict, note: "fine; mail ops@example.com" })).ok);
  check("...once per explanation: a second verdict replaces the first", (await recordVerdict(reviewRoot, { ...verdict, correct: false, note: "on reflection, wrong; ops@example.com" })).ok);
  const stored = loadReviewStore(reviewRoot);
  check("the store reads back one capture and one verdict", stored.captures.length === 1 && stored.verdicts.length === 1 && stored.malformed.length === 0, JSON.stringify({ c: stored.captures.length, v: stored.verdicts.length, m: stored.malformed }));
  check("...the latest verdict, with its note redacted", stored.verdicts[0].correct === false && !JSON.stringify(stored.verdicts).includes("ops@example.com"));
  // A placeholder is not a reviewer: `YOUR_LABEL`, the CLI's documented example, reached the real store (2026-09-23).
  const refusedLabels = ["YOUR_LABEL", "your label", "<label>", "<owner's label>", "Claude", "   "];
  const acceptedLabels: string[] = [];
  for (const reviewer of refusedLabels) if ((await recordVerdict(reviewRoot, { ...verdict, reviewer })).ok) acceptedLabels.push(reviewer);
  check("a verdict under a placeholder or an agent's label is refused: YOUR_LABEL, your label, <label>, <owner's label>, Claude, blank", acceptedLabels.length === 0, JSON.stringify(acceptedLabels));
  const placeholder: ReviewVerdict = { ...verdict, reviewer: "YOUR_LABEL", note: "optional", reviewedAt: "2026-09-23T08:27:19.233Z" };
  writeFileSync(join(reviewRoot, "reviews.json"), JSON.stringify({ version: 1, verdicts: [placeholder] }));
  await recordVerdict(reviewRoot, verdict);
  const revised = await recordVerdict(reviewRoot, { ...verdict, correct: false });
  const audited = loadReviewStore(reviewRoot).verdicts;
  check(
    "a stored placeholder verdict is kept for audit, unchanged, beside a person's verdict on the same item, which replaces only their own",
    revised.ok && audited.length === 2 && JSON.stringify(audited[0]) === JSON.stringify(placeholder) && audited[1].reviewer === "MA" && audited[1].correct === false,
    JSON.stringify(audited)
  );
  writeFileSync(join(reviewRoot, "capture-broken.json"), "{ not json");
  check("an unreadable capture is reported, never silently skipped", loadReviewStore(reviewRoot).malformed.includes("capture-broken.json"));

  // (1) The adopted target, on synthetic captures over the real labelled set: it can say MET, and
  // every way short of it says so.
  const caseIds = LABELLED_SET.map((c) => c.id);
  const sha = instructionsSha256(request);
  type Judged = ReviewItem["judged"];
  const clear: Judged = { onSubject: true, misattributed: false, actionable: true, unsupported: [], category: "unverified" };
  const synth = (capturedAt: string, o: { cases?: string[]; judged?: (index: number) => Partial<Judged>; undelivered?: string[]; orderViolation?: string; step?: string; text?: string; textOf?: (index: number) => string | undefined } = {}): ReviewCapture => {
    const captureId = `synthetic-${capturedAt}`;
    let index = 0;
    const cases = o.cases ?? caseIds;
    const items: ReviewItem[] = cases
      .filter((caseId) => !o.undelivered?.includes(caseId))
      .flatMap((caseId) =>
        LABELLED_SET.find((c) => c.id === caseId)!.sent.map((s, n) => ({
          id: `${captureId}/${caseId}/i${n}`,
          caseId,
          issueId: `i${n}`,
          code: s.code,
          blocking: s.blocking,
          fixable: s.fixable,
          evidence: "",
          ...(o.step ? { step: o.step } : {}),
          text: o.textOf?.(index) ?? o.text ?? "Add what the step needs.",
          judged: { ...clear, ...o.judged?.(index++) }
        }))
      );
    return {
      version: 1,
      captureId,
      capturedAt,
      modelId: "synthetic",
      instructionsSha256: sha,
      cases: cases.map((caseId) => ({
        caseId,
        sent: LABELLED_SET.find((c) => c.id === caseId)!.sent.length,
        delivered: !o.undelivered?.includes(caseId),
        ranking: [],
        rankingWithheld: caseId === o.orderViolation,
        rankingOrderCorrect: caseId === o.orderViolation ? false : null,
        inferMs: 1
      })),
      items
    };
  };
  const approve = (captures: ReviewCapture[], edit: (v: ReviewVerdict) => ReviewVerdict = (v) => v): ReviewVerdict[] =>
    captures.flatMap((c) => c.items.map((i) => edit({ itemId: i.id, correct: true, actionable: true, grounded: true, unsupportedClaim: false, reviewer: "MA", reviewedAt: "2026-09-22T00:00:00Z" })));
  const status = (e: ReturnType<typeof evaluateQualityTarget>, id: number) => e.criteria.find((c) => c.id === id)!.status;
  const twoRuns = [synth("2026-09-22T01"), synth("2026-09-22T02")];
  const passing = evaluateQualityTarget(twoRuns, approve(twoRuns), caseIds);
  check("two clean, fully reviewed runs meet the target: the evaluator can say MET", passing.verdict === "MET" && passing.completeRuns === 2, JSON.stringify(passing.criteria));
  check("the thresholds are the proposal's, unlowered", QUALITY_TARGET.minOnSubject === 0.9 && QUALITY_TARGET.minActionable === 0.8 && QUALITY_TARGET.minReviewedCorrectAndActionable === 0.8 && QUALITY_TARGET.minRuns === 2);
  const oneUnreviewed = approve(twoRuns).slice(1);
  const pendingOne = evaluateQualityTarget(twoRuns, oneUnreviewed, caseIds);
  check("one screen-clear explanation without a person's verdict is PENDING, never MET: unreviewed is not correct", status(pendingOne, 4) === "PENDING" && pendingOne.verdict === "PENDING");
  check("no verdicts at all is PENDING too", evaluateQualityTarget(twoRuns, [], caseIds).verdict === "PENDING");
  check("...and criterion 1 cannot be MET while a screen-clear answer is unread: a person may still confirm a claim", status(pendingOne, 1) === "PENDING");
  const underPlaceholder = evaluateQualityTarget(twoRuns, approve(twoRuns, (v) => ({ ...v, reviewer: "YOUR_LABEL" })), caseIds);
  check(
    "every answer 'approved' under YOUR_LABEL is unreviewed: 0 reviewed, criteria 1 and 4 PENDING, the target never MET",
    underPlaceholder.review.screenClearReviewed === 0 && status(underPlaceholder, 1) === "PENDING" && status(underPlaceholder, 4) === "PENDING" && underPlaceholder.verdict === "PENDING",
    JSON.stringify(underPlaceholder.review)
  );
  const onePlaceholder = evaluateQualityTarget(twoRuns, approve(twoRuns, (v) => (v.itemId === twoRuns[0].items[0].id ? { ...v, reviewer: "YOUR_LABEL" } : v)), caseIds);
  check("...and one among a person's verdicts leaves its answer unread: 33 of 34 reviewed, the target PENDING, not MET", onePlaceholder.review.screenClearReviewed === 33 && onePlaceholder.verdict === "PENDING");
  const judgedWrong = evaluateQualityTarget(twoRuns, approve(twoRuns).map((v, i) => (i < 7 ? { ...v, correct: false } : v)), caseIds);
  check("a person judging 7 of 34 screen-clear explanations wrong (79 %) fails criterion 4", status(judgedWrong, 4) === "NOT MET" && judgedWrong.verdict === "NOT MET");
  const oneRun = [synth("2026-09-22T01")];
  check("one run does not meet criterion 6", status(evaluateQualityTarget(oneRun, approve(oneRun), caseIds), 6) === "NOT MET");
  const parts = [synth("2026-09-22T01", { cases: caseIds.slice(0, 5) }), synth("2026-09-22T02", { cases: caseIds.slice(5) }), ...twoRuns];
  check("two parts over different cases make one run", evaluateQualityTarget(parts, approve(parts), caseIds).completeRuns === 3);
  const actionable = (misses: number) => {
    const runs = [synth("2026-09-22T01", { judged: (i) => (i < misses ? { actionable: false, category: "notActionable" } : {}) }), synth("2026-09-22T02")];
    return status(evaluateQualityTarget(runs, approve(runs), caseIds), 3);
  };
  check("13 of 17 actionable in one run (76 %) fails criterion 3; 14 of 17 (82 %) meets it", actionable(4) === "NOT MET" && actionable(3) === "MET");
  // Criterion 3, option B (owner, 2026-09-23): the explanation a person sees, with the product's action
  // beside the answer. The model's own rate is still reported, and never credited with the product's action.
  const action = "Set this step's timeout to a positive number of milliseconds.";
  const silent = () => ({ actionable: false, category: "notActionable" as const });
  const shownRuns = [synth("2026-09-22T01", { step: action, judged: silent }), synth("2026-09-22T02", { step: action, judged: silent })];
  const shown = evaluateQualityTarget(shownRuns, approve(shownRuns), caseIds);
  check(
    "the product's action beside every answer meets criterion 3 while the model's own text is reported at 0/17, uncredited",
    status(shown, 3) === "MET" && shown.runs.every((r) => r.visibleActionable === 17 && r.actionable === 0),
    JSON.stringify(shown.runs)
  );
  const defectBeside = (hits: number) => {
    const runs = [synth("2026-09-22T01", { step: action, judged: (i) => (i < hits ? { actionable: false, unsupported: ["WRONG_REMEDY"], category: "defect" } : silent()) }), synth("2026-09-22T02", { step: action, judged: silent })];
    return status(evaluateQualityTarget(runs, approve(runs), caseIds), 3);
  };
  check("an answer with a screen hit beside the product's action does not count: 4 of 17 fails criterion 3, 3 of 17 meets it", defectBeside(4) === "NOT MET" && defectBeside(3) === "MET");
  const misBeside = [synth("2026-09-22T01", { step: action, judged: (i) => (i < 4 ? { misattributed: true, onSubject: false, category: "defect" } : silent()) }), synth("2026-09-22T02", { step: action, judged: silent })];
  check("a misattributed answer beside the product's action does not count toward criterion 3", status(evaluateQualityTarget(misBeside, approve(misBeside), caseIds), 3) === "NOT MET");
  const lostShown = [synth("2026-09-22T01", { step: action, undelivered: ["values", "branch"], judged: silent }), synth("2026-09-22T02", { step: action, judged: silent })];
  const lostShownEval = evaluateQualityTarget(lostShown, approve(lostShown), caseIds);
  check("an undelivered answer shows no action, so its issues count against criterion 3", lostShownEval.runs[0].sent === 17 && lostShownEval.runs[0].visibleActionable === 13 && status(lostShownEval, 3) === "NOT MET");
  const copied = [synth("2026-09-22T01", { step: action, text: `Timeout is zero, negative or not a finite number. Action: ${action}` }), synth("2026-09-22T02", { step: action })];
  const copiedEval = evaluateQualityTarget(copied, approve(copied), caseIds);
  check("an answer repeating the product's action word for word is reported as such, and one of its own is not", copiedEval.runs[0].repeatsProductAction === 17 && copiedEval.runs[1].repeatsProductAction === 0 && copiedEval.runs[1].actionable === 17);
  const unread = evaluateQualityTarget(copied, [], caseIds);
  check("criterion 3 met with the product's action beside the answer leaves the target PENDING until a person reviews, never MET", status(unread, 3) === "MET" && unread.verdict === "PENDING");
  const onSubject = (misses: number) => {
    const runs = [synth("2026-09-22T01"), synth("2026-09-22T02", { judged: (i) => (i < misses ? { onSubject: false, category: "offSubject" } : {}) })];
    return status(evaluateQualityTarget(runs, approve(runs), caseIds), 2);
  };
  check("15 of 17 on subject in one run (88 %) fails criterion 2; 16 of 17 (94 %) meets it", onSubject(2) === "NOT MET" && onSubject(1) === "MET");
  const undelivered = [synth("2026-09-22T01", { undelivered: ["values"] }), synth("2026-09-22T02")];
  const lost = evaluateQualityTarget(undelivered, approve(undelivered), caseIds);
  check("an undelivered answer still counts its issues, so it lowers the rate instead of vanishing", lost.runs[0].sent === 17 && lost.runs[0].onSubject === 15 && status(lost, 2) === "NOT MET");
  const hit = [synth("2026-09-22T01", { judged: (i) => (i === 0 ? { unsupported: ["SEVERITY_OVERSTATED"], category: "defect" } : {}) }), synth("2026-09-22T02")];
  const hitItem = hit[0].items[0].id;
  check("an unconfirmed screen hit leaves criterion 1 PENDING", status(evaluateQualityTarget(hit, approve(hit).filter((v) => v.itemId !== hitItem), caseIds), 1) === "PENDING");
  check("...a person dismissing it meets criterion 1", status(evaluateQualityTarget(hit, approve(hit), caseIds), 1) === "MET");
  check("...a person confirming it fails criterion 1", status(evaluateQualityTarget(hit, approve(hit, (v) => (v.itemId === hitItem ? { ...v, unsupportedClaim: true } : v)), caseIds), 1) === "NOT MET");
  check("a person finding an answer ungrounded fails criterion 1 as well", status(evaluateQualityTarget(twoRuns, approve(twoRuns, (v) => (v.itemId === twoRuns[0].items[3].id ? { ...v, grounded: false } : v)), caseIds), 1) === "NOT MET");
  // R1 (owner, 2026-09-25): the Flow Designer shows every answer, so one that makes a causal claim needs a
  // person even when it is neither a screen hit nor screen-clear. Without a cause, reading it stays optional.
  const becauseText = "The flow failed because connectors form a cycle.";
  const causalRuns = (text: string) => [synth("2026-09-22T01", { judged: (i) => (i === 0 ? { actionable: false, category: "notActionable" } : {}), textOf: (i) => (i === 0 ? text : undefined) }), synth("2026-09-22T02")];
  const causalItem = (runs: ReviewCapture[]) => runs[0].items[0].id;
  const withCause = causalRuns(becauseText);
  const causalUnread = evaluateQualityTarget(withCause, approve(withCause).filter((v) => v.itemId !== causalItem(withCause)), caseIds);
  check(
    "an unread notActionable answer that makes a causal claim leaves criterion 1 PENDING, and is counted as one",
    status(causalUnread, 1) === "PENDING" && causalUnread.review.causalClaims === 1 && causalUnread.review.causalClaimsReviewed === 0,
    JSON.stringify(causalUnread.review)
  );
  check("...a person reading it meets criterion 1", status(evaluateQualityTarget(withCause, approve(withCause), caseIds), 1) === "MET");
  check("...a person confirming it unsupported fails criterion 1", status(evaluateQualityTarget(withCause, approve(withCause, (v) => (v.itemId === causalItem(withCause) ? { ...v, unsupportedClaim: true } : v)), caseIds), 1) === "NOT MET");
  const noCause = causalRuns("Connectors form a cycle here.");
  check("...and one without a causal claim stays optional: criterion 1 MET without it", status(evaluateQualityTarget(noCause, approve(noCause).filter((v) => v.itemId !== causalItem(noCause)), caseIds), 1) === "MET");
  const misattributed = [synth("2026-09-22T01", { judged: (i) => (i === 2 ? { misattributed: true, onSubject: false, category: "defect" } : {}) }), synth("2026-09-22T02")];
  check("a misattributed explanation fails criterion 1 whatever a person says", status(evaluateQualityTarget(misattributed, approve(misattributed), caseIds), 1) === "NOT MET");
  const violated = [synth("2026-09-22T01", { orderViolation: "priority" }), synth("2026-09-22T02")];
  check("a fix order that breaks the priority fails criterion 5", status(evaluateQualityTarget(violated, approve(violated), caseIds), 5) === "NOT MET");
  check("nothing ranked meets criterion 5: an empty fix order is acceptable", status(passing, 5) === "MET" && passing.runs.every((r) => r.ranked === 0));
  const nothingClear = [synth("2026-09-22T01", { judged: () => ({ actionable: false, category: "notActionable" }) }), synth("2026-09-22T02", { judged: () => ({ actionable: false, category: "notActionable" }) })];
  check("with nothing screen-clear there is nothing a person could accept: criterion 4 is NOT MET, not vacuously MET", status(evaluateQualityTarget(nothingClear, [], caseIds), 4) === "NOT MET");
}

// ── 13. The corrective step is the product's, and a cut sentence is never shown ─────────────────
// The 97996c48 captures: steps cut off by the 160-character limit, a connector added INTO End, the value
// rule read backwards. The step now comes from the rule, and only complete sentences reach the person.
console.log("\n13 — the product's corrective step, and complete sentences only");
{
  const codes = Object.keys(FLOW_VALIDATION_RULES) as Array<keyof typeof FLOW_VALIDATION_RULES>;
  const stepOf = (code: (typeof codes)[number]) => correctiveStep({ code, severity: FLOW_VALIDATION_RULES[code].severity, onActivePath: true, flowId: "f", message: "m" });
  const oneSentence = (step: string) => /^[A-Z][^.!?]*[.]$/.test(step);
  const reportOf13 = (id: string) => {
    const labelled = LABELLED_SET.find((c) => c.id === id)!;
    return validateFlowDefinition(labelled.flow, { referenceableFlowIds: new Set([labelled.flow.id]) });
  };
  check(`every one of the ${codes.length} rules has a corrective step: one sentence, an instruction, room to spare in an answer`, codes.every((code) => oneSentence(stepOf(code)) && stepOf(code).length <= 120), codes.filter((code) => !oneSentence(stepOf(code)) || stepOf(code).length > 120).join(", "));
  check("...none of which offers a fix the validator did not emit", codes.every((code) => !/\bfix|automatic|repair/i.test(stepOf(code))), codes.filter((code) => /\bfix|automatic|repair/i.test(stepOf(code))).join(", "));
  check("...and each is tied to its node or connector, never to a name, selector or value", codes.every((code) => !/["'`](?!s\b)/.test(stepOf(code))));
  const fixableIssue = report.issues.find((issue) => issue.safeFix !== undefined)!;
  check("an issue the validator emitted a fix for gets that fix, through its preview", correctiveStep(fixableIssue) === "Review and apply the offered safe fix, which gives this connector a new id.", correctiveStep(fixableIssue));
  check("the same issue always gets the same step", request.issues.every((ref) => ref.step === correctiveStep(ref.issue)));
  const casingSteps = buildAuthoringRequest(reportOf13("casing"))!.issues.map((ref) => ref.step);
  check("a casing fix names its own issue's subject: the operator for one, the setting for the other", /the operator's casing/.test(casingSteps[0]) && /this setting's casing/.test(casingSteps[1]), JSON.stringify(casingSteps));
  check("the value rule's summary names its subject first, so it cannot be read as 'the value is not required'", FLOW_VALIDATION_RULES.missingRequiredValue.summary === "The step has no value, and its type needs one.");

  // The step reaches the designer from the request, whatever the model wrote.
  const nonsense = harness([JSON.stringify({ version: 1, explanations: ids.map((id) => ({ issueId: id, text: "Add a connector into the End step." })) })]);
  const stepView = await explainFlowValidation(WINDOW, { requestId: "s13", profile: brokenFlow }, assistDeps(nonsense.service));
  check("the designer receives the product's step beside each explanation, not the model's", stepView.code === "OK" && stepView.explanations.length === request.issues.length && stepView.explanations.every((e, i) => e.step === correctiveStep(request.issues[i].issue) && e.text === "Add a connector into the End step."), JSON.stringify(stepView).slice(0, 300));
  await nonsense.service.shutdown();
  const withStep = parseAiOutput(JSON.stringify({ version: 1, explanations: ids.map((id) => ({ issueId: id, text: "Fine.", step: "Delete the flow." })) }), request.schema);
  check("a model cannot supply a step: the answer schema has no field for one", !withStep.ok && withStep.code === "SCHEMA_REJECTED", JSON.stringify(withStep));

  // Complete sentences only.
  const ends = (text: string) => endAtCompleteSentence(text);
  check("a complete text is kept as written", JSON.stringify(ends("Add a locator. The step has none.")) === JSON.stringify({ text: "Add a locator. The step has none.", cut: false }));
  check("...as is one ending in a question mark or a closing parenthesis", !ends("Is the value set?").cut && !ends("Set the value (the text to type).").cut);
  check("an unfinished tail is dropped, never completed", JSON.stringify(ends("Add a Loop Back connector to break the cycle. The connectors repeat the same st")) === JSON.stringify({ text: "Add a Loop Back connector to break the cycle.", cut: true }));
  check("...and an abbreviation before a lower-case word is not a sentence end", ends("Set the value, e.g. the text to type. It has no value and the step nee").text === "Set the value, e.g. the text to type." && ends("Set the value, e.g. the text to ty").text === "Set the value, e.g. the text to ty…");
  const lone = ends(`The person should add a Loop Back connector to break ${"the cycle ".repeat(20)}`.slice(0, AUTHORING_LIMITS.maxExplanationChars));
  check("a text with no complete sentence keeps its fragment, marked with an ellipsis, inside the limit", lone.cut && lone.text.endsWith("…") && lone.text.length <= AUTHORING_LIMITS.maxExplanationChars, `${lone.text.length}: ${lone.text}`);
  const cutAnswer = parseAuthoringAnswer({ version: 1, explanations: [{ issueId: ids[0], text: "Regenerate the duplicate's id. Two connectors share one id and the runner cannot tell which one the flow me" }, { issueId: ids[1], text: "Add a locator to this step." }] }, request);
  check("the parser applies it and says so, and the step survives the cut", cutAnswer.ok && cutAnswer.explanations[0].text === "Regenerate the duplicate's id." && cutAnswer.explanations[0].cut === true && cutAnswer.explanations[0].step === request.issues[0].step && cutAnswer.explanations[1].cut === undefined, JSON.stringify(cutAnswer));
}

for (const label of failedLabels) console.error(`  ✗ ${label}`);
console.log(`\nL4b authoring explanations and fix ranking: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
