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
 * unsupported-claim screens each with a negative twin, and the ranking order.
 *
 * Run: npm run verify:ai-authoring
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

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
  parseAuthoringAnswer,
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
import { CANARY, LABELLED_SET, REMEDY, SUBJECT, authoringControlFailures, rankingControlFailures } from "./ai-harness/authoringQualitySet";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
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
check("the rule summary DOES, because it is a product-authored constant", promptText.includes("Step type requires a locator and has none."));
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
  return req.issues.every((ref) => lines.some((line) => line.startsWith(`${ref.id}: ${ref.issue.code} `) && line.endsWith(FLOW_VALIDATION_RULES[ref.issue.code].summary)));
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
check("the fix KIND and field are sent, so the model knows what is repairable", promptText.includes(emitted[0].safeFix!.kind) && promptText.includes(emitted[0].safeFix!.field));

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
  const cycle = LABELLED_SET.find((c) => c.id === "cycle")!;
  const controls = authoringControlFailures(buildAuthoringRequest(reportOf(cycle))!);
  check("the judge's controls all hold (correct, swapped, vague, canary, partial, unemitted ranking; actionable, five unsupported screens and their negatives)", controls.length === 0, controls.join("; "));
  const priority = LABELLED_SET.find((c) => c.id === "priority")!;
  const ranking = rankingControlFailures(buildAuthoringRequest(reportOf(priority))!);
  check("the ranking-order controls all hold (blocking first, off-path first, blocking left out, none)", ranking.length === 0, ranking.join("; "));
}

console.log(`\nL4b authoring explanations and fix ranking: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
