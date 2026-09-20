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
 *
 * Run: npm run verify:ai-authoring
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { AiService, type AiServiceSettings } from "@src/ai/AiService";
import { FakeAiHostTransport, type FakeInferStep } from "@src/ai/FakeAiHostTransport";
import {
  AUTHORING_LIMITS,
  authoringExplanationDecision,
  authoringRankingDecision,
  buildAuthoringRequest,
  parseAuthoringAnswer,
  type AuthoringRequest
} from "@src/ai/authoringExplanation";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { validateFlowDefinition, type FlowValidationReport } from "@src/validation/FlowValidator";

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

function harness(script: Array<FakeInferStep | string>, options: { settings?: Partial<AiServiceSettings> } = {}) {
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
    limits: { yieldCheckMs: 5, admissionRetryMs: 10 },
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
check("every issue in the report is addressable by id", request.issues.length === Math.min(report.issues.length, AUTHORING_LIMITS.maxIssues));
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
check("...and the anchors, which are generated ids", promptText.includes("n-click"));
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
  explanations: ids.slice(0, 3).map((id) => ({ issueId: id, text: `This step cannot run as configured (${id}).` })),
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
  check("...with one explanation per named issue", parsed.explanations.length === 3);
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
const invented = harness(['{"version":1,"explanations":[],"ranking":[],"newFix":{"kind":"reconnectOrphan","nodeId":"n-click"}}']);
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
const lowerCap = buildAuthoringRequest(bigReport, { maxIssues: 3 }) as AuthoringRequest;
check("a caller may ask for fewer", lowerCap.issues.length === 3);
const raisedCap = buildAuthoringRequest(bigReport, { maxIssues: 500 }) as AuthoringRequest;
check("...but never more than the documented maximum", raisedCap.issues.length === AUTHORING_LIMITS.maxIssues);

// ── 8. The validator's own verdict is untouched ─────────────────────────────────────────────────
console.log("\n8 — the AI path changes nothing about validation");
const afterAll = validateFlowDefinition(brokenFlow);
check("re-validating the same profile gives the same issue codes", JSON.stringify(afterAll.issues.map((i) => i.code)) === JSON.stringify(report.issues.map((i) => i.code)));
check("...the same severities", JSON.stringify(afterAll.issues.map((i) => i.severity)) === JSON.stringify(report.issues.map((i) => i.severity)));
check("...and the same emitted fixes", JSON.stringify(afterAll.issues.map((i) => i.safeFix?.kind ?? null)) === JSON.stringify(report.issues.map((i) => i.safeFix?.kind ?? null)));

console.log(`\nL4b authoring explanations and fix ranking: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
