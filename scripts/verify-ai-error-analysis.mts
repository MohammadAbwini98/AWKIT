/**
 * verify:ai-error-analysis — Phase L L5b: coalescing and the post-run failure-analysis contract.
 *
 * Real layers: L5a's real `ExecutionEvidenceBuffer` (so every event is redacted, id-stripped and
 * capped exactly as a run produces it), the real `deriveFailureCause` (so every baseline is the
 * product's own conclusion and not a fixture's), the real `AiService` with the real `AiOutputContract`
 * over `FakeAiHostTransport`, and the real `coalesceFailures` / `buildFailureAnalysisRequest` /
 * `parseFailureAnalysis` / `AiAutonomyPolicy`.
 *
 * L5b's load-bearing claims, and how each is made to fail here:
 *   - **500 identical failures cost one analysis.** The signature excludes instance, row, timing and
 *     repeat count; a batch of 500 must coalesce to one group and one planned call.
 *   - **Distinct failures stay distinct.** A 409 and a 422 on the same route, and the same status on
 *     two routes, must not be merged — the labelled set depends on that.
 *   - **The budget is a budget.** Past `maxAnalyses` a group keeps its deterministic baseline and says
 *     so, rather than being silently dropped.
 *   - **A conclusion must cite evidence**, `insufficient` is a first-class answer, and an answer that
 *     does both is refused rather than half-believed.
 *   - **Nothing can change the run.** The schema has no field for a status, retry, policy or edit.
 *
 * Run: npm run verify:ai-error-analysis
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { AiService, type AiServiceSettings } from "@src/ai/AiService";
import { FakeAiHostTransport, type FakeInferStep } from "@src/ai/FakeAiHostTransport";
import {
  FAILURE_ANALYSIS_LIMITS,
  buildFailureAnalysisRequest,
  coalesceFailures,
  failureAnalysisDecision,
  failureSignature,
  parseFailureAnalysis,
  type FailureAnalysisRequest,
  type FailureBatchEntry
} from "@src/ai/failureAnalysis";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { EvidenceBuffer, EvidenceRunBudget, type ExecutionEvidenceEvent } from "@src/runner/evidence/ExecutionEvidence";
import { deriveFailureCause } from "@src/runner/evidence/FailureCauseBaseline";
import { INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, type InstanceDiagnostics } from "@src/runner/evidence/FailureEvidenceCollector";
import type { ConcurrentRunReport, InstanceReport } from "@src/reports/ExecutionReport";
import type { AiPolicyConfig } from "@src/security/authz/AiAutonomyPolicy";

import { analyzeFailure, failureBatch, type FailureAssistDeps } from "../app/main/ai/aiAssist";

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

const work = await mkdtemp(join(tmpdir(), "awkit-l5b-"));
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

function harness(script: Array<FakeInferStep | string>) {
  const fake = new FakeAiHostTransport({ modelRoot: MODEL_ROOT, respond: (_r, index) => script[Math.min(index, script.length - 1)] ?? "{}" });
  const service = new AiService({
    transport: () => fake,
    model: async () => ({ ok: true, modelId: "fake-l5b-model", modelPath: join(MODEL_ROOT, "model.gguf"), contextTokens: 8192 }),
    settings: async () => ({ enabled: true, yieldDuringRuns: true, idleUnloadMs: 0, minFreeMemoryMb: 0 } as AiServiceSettings),
    admission: () => IDLE,
    threads: 2,
    limits: { yieldCheckMs: 5, admissionRetryMs: 10 },
    nonce: () => "0123456789abcdef"
  });
  return { fake, service };
}

/**
 * Build one instance's failure through L5a's REAL buffer and REAL cause baseline.
 *
 * Nothing here hand-writes an `ExecutionEvidenceEvent` or a `FailureCauseBaseline`: a fixture that
 * asserted its own redaction and its own cause would test the fixture. The distinctive strings are
 * deliberately the kind L5a is supposed to strip, so the later privacy assertions cannot pass by luck.
 */
function instanceFailure(input: {
  instanceId: string;
  nodeId: string;
  stepIndex?: number;
  url: string;
  status: number;
  extra?: Array<{ source: "console.error" | "ui.alert"; payload: Record<string, string | number | boolean> }>;
}): FailureBatchEntry {
  // A driven clock, so the buffer stamps the offsets this fixture means rather than whatever the
  // process happened to take. `atOffsetMs` is only honoured when it is not in the future.
  let clock = 0;
  const buffer = new EvidenceBuffer(
    { executionId: "exec-l5b", instanceId: input.instanceId },
    new EvidenceRunBudget(),
    { redactor: new SemanticRedactor(), now: () => clock }
  );
  const step = { flowId: "flow-l5b", nodeId: input.nodeId, ...(input.stepIndex === undefined ? {} : { stepIndex: input.stepIndex }) };
  clock = 1_000;
  buffer.add({
    source: "http.error",
    severity: "error",
    context: step,
    payload: { method: "POST", url: input.url, status: input.status, resourceType: "xhr" }
  });
  for (const event of input.extra ?? []) {
    clock += 100;
    buffer.add({ source: event.source, severity: "error", context: step, payload: event.payload });
  }
  clock = 1_500;
  buffer.add({
    source: "runner.failure",
    severity: "error",
    context: step,
    payload: { kind: "assertion", message: "The order confirmation did not appear." }
  });
  const events = [...buffer.list()];
  const runnerEvent = events.find((event) => event.source === "runner.failure");
  const baseline = deriveFailureCause(events, {
    kind: "assertion",
    stepStartOffsetMs: 500,
    failedAtOffsetMs: 1_500,
    ...(runnerEvent ? { evidenceId: runnerEvent.id } : {})
  });
  return { instanceId: input.instanceId, flowId: "flow-l5b", nodeId: input.nodeId, stepIndex: input.stepIndex, baseline, events };
}

// Identifiers L5a must strip, and a secret its redactor must mask.
const ROW_URL = (row: number) => `https://shop.example/orders/${40000 + row}/submit?token=abc123secret&row=${row}`;

// ── 0. The fixture is the product's own output ──────────────────────────────────────────────────
console.log("\n0 — the evidence and the baseline come from L5a, not from this file");
const sample = instanceFailure({ instanceId: "i-1", nodeId: "n-submit", stepIndex: 3, url: ROW_URL(1), status: 500 });
check("the real buffer produced events", sample.events.length >= 2, String(sample.events.length));
check("the real baseline concluded httpError, not the runner's assertion", sample.baseline.cause === "httpError", sample.baseline.cause);
const httpEvent = sample.events.find((event) => event.source === "http.error")!;
check("...citing the HTTP event first", sample.baseline.evidenceIds[0] === httpEvent.id);
check("L5a stripped the row id from the URL", String(httpEvent.payload.url).includes("/orders/:id/submit"), String(httpEvent.payload.url));
check("...and dropped the query entirely, token and all", !String(httpEvent.payload.url).includes("token") && !String(httpEvent.payload.url).includes("abc123secret"), String(httpEvent.payload.url));

// ── 1. The signature: what makes two failures the same failure ──────────────────────────────────
console.log("\n1 — the coalescing signature");
const rowA = instanceFailure({ instanceId: "i-a", nodeId: "n-submit", stepIndex: 3, url: ROW_URL(1), status: 500 });
const rowB = instanceFailure({ instanceId: "i-b", nodeId: "n-submit", stepIndex: 3, url: ROW_URL(2), status: 500 });
check("two data rows hitting the same route and status share a signature", failureSignature(rowA) === failureSignature(rowB), `${failureSignature(rowA)}\n${failureSignature(rowB)}`);
check("...and the signature carries no instance id", !failureSignature(rowA).includes("i-a"));
check("...and no row identifier", !failureSignature(rowA).includes("40001"));

const status422 = instanceFailure({ instanceId: "i-c", nodeId: "n-submit", stepIndex: 3, url: ROW_URL(1), status: 422 });
check("a different status on the same route is a DIFFERENT failure", failureSignature(rowA) !== failureSignature(status422));
const otherRoute = instanceFailure({ instanceId: "i-d", nodeId: "n-submit", stepIndex: 3, url: "https://shop.example/payments/9/capture", status: 500 });
check("the same status on a different route is a different failure", failureSignature(rowA) !== failureSignature(otherRoute));
const otherNode = instanceFailure({ instanceId: "i-e", nodeId: "n-confirm", stepIndex: 3, url: ROW_URL(1), status: 500 });
check("the same failure at a different step is a different failure", failureSignature(rowA) !== failureSignature(otherNode));

// ── 2. 500 identical failures cost one analysis ─────────────────────────────────────────────────
console.log("\n2 — coalescing a data-driven run");
const bigBatch = Array.from({ length: 500 }, (_, i) => instanceFailure({ instanceId: `i-${i}`, nodeId: "n-submit", stepIndex: 3, url: ROW_URL(i), status: 500 }));
const coalesced = coalesceFailures(bigBatch);
check("500 identical failures collapse to one group", coalesced.groups.length === 1, String(coalesced.groups.length));
check("...counted, so the report can say how many rows it hit", coalesced.groups[0].count === 500);
check("...listing every affected instance", coalesced.groups[0].instanceIds.length === 500);
check("...and costing exactly ONE planned model call", coalesced.stats.analyses === 1, String(coalesced.stats.analyses));
check("the stats report the coalescing ratio L5b's metrics ask for", coalesced.stats.failures === 500 && coalesced.stats.signatures === 1);
check("the representative is the first instance, so the plan is deterministic", coalesced.groups[0].representative.instanceId === "i-0");
check("a repeated run of the same batch produces the same plan", JSON.stringify(coalesceFailures(bigBatch).groups.map((g) => g.signature)) === JSON.stringify(coalesced.groups.map((g) => g.signature)));

// ── 3. Several signatures in one batch, and the budget ──────────────────────────────────────────
console.log("\n3 — several signatures, and the per-batch budget");
const mixed: FailureBatchEntry[] = [
  ...Array.from({ length: 10 }, (_, i) => instanceFailure({ instanceId: `big-${i}`, nodeId: "n-submit", stepIndex: 1, url: ROW_URL(i), status: 500 })),
  ...Array.from({ length: 3 }, (_, i) => instanceFailure({ instanceId: `mid-${i}`, nodeId: "n-submit", stepIndex: 1, url: ROW_URL(i), status: 422 })),
  instanceFailure({ instanceId: "one", nodeId: "n-pay", stepIndex: 2, url: "https://shop.example/payments/1/capture", status: 503 })
];
const mixedPlan = coalesceFailures(mixed);
check("three distinct signatures are found", mixedPlan.groups.length === 3, JSON.stringify(mixedPlan.groups.map((g) => g.count)));
check("...ordered by impact, most instances first", JSON.stringify(mixedPlan.groups.map((g) => g.count)) === JSON.stringify([10, 3, 1]));
check("...and every one fits the default budget", mixedPlan.groups.every((g) => g.analyse) && mixedPlan.stats.analyses === 3);

const tight = coalesceFailures(mixed, { ...FAILURE_ANALYSIS_LIMITS, maxAnalyses: 2 });
check("a tighter budget analyses only the most impactful", tight.groups.filter((g) => g.analyse).map((g) => g.count).join(",") === "10,3");
check("...and the one it declines keeps its deterministic baseline", tight.groups[2].analyse === false && tight.groups[2].representative.baseline.cause === "httpError");
check("...saying WHY it was declined, rather than vanishing", tight.groups[2].skipped === "BATCH_BUDGET");
check("a declined group is still reported with its count", tight.groups[2].count === 1 && tight.groups.length === 3);

const manySignatures = Array.from({ length: 30 }, (_, i) => instanceFailure({ instanceId: `s-${i}`, nodeId: `n-${i}`, stepIndex: i, url: ROW_URL(i), status: 500 }));
const capped = coalesceFailures(manySignatures);
check("distinct signatures are capped", capped.groups.length === FAILURE_ANALYSIS_LIMITS.maxSignatures, String(capped.groups.length));
check("...and the overflow is counted, not silently dropped", capped.overflow === 30 - FAILURE_ANALYSIS_LIMITS.maxSignatures, String(capped.overflow));
check("...while the analysis budget still binds", capped.stats.analyses === FAILURE_ANALYSIS_LIMITS.maxAnalyses);

// ── 4. The request ──────────────────────────────────────────────────────────────────────────────
console.log("\n4 — the request offers bounded evidence and a closed id space");
const group = coalesced.groups[0];
const request = buildFailureAnalysisRequest(group) as FailureAnalysisRequest;
check("a selected group builds a request", request !== undefined);
check("a DECLINED group builds none, so a caller cannot analyse past the budget", buildFailureAnalysisRequest(tight.groups[2]) === undefined);
check("the evidence offered is bounded", request.evidence.length <= FAILURE_ANALYSIS_LIMITS.maxEvidencePerAnalysis);
check("...and leads with the events the baseline cited", request.evidence[0].id === group.representative.baseline.evidenceIds[0]);
const idEnum = (request.schema as { properties: Record<string, { items?: { enum?: string[] } }> }).properties.primaryEvidenceIds.items!.enum;
check("the id enum is exactly the evidence offered", JSON.stringify(idEnum) === JSON.stringify(request.evidence.map((e) => e.id)));
const schemaText = JSON.stringify(request.schema);
check("the schema has no field for a run status", !/"status"/.test(schemaText));
check("...no field for a retry", !/retry/i.test(schemaText));
check("...and no field for a policy or workflow edit", !/policy|workflow|apply/i.test(schemaText));

const rendered = buildAiPrompt(request.prompt, new SemanticRedactor(), "0123456789abcdef");
if (!rendered.ok) throw new Error(`the L5b prompt did not build: ${rendered.code} ${rendered.detail}`);
const promptText = `${rendered.system}\n${rendered.user}`;
check("no row identifier reaches the prompt", !promptText.includes("40001") && !promptText.includes("40002"), promptText.slice(0, 200));
check("no query token reaches the prompt", !promptText.includes("abc123secret"));
check("no instance id reaches the prompt", !promptText.includes("i-0") && !promptText.includes("exec-l5b"));
check("the path TEMPLATE does, which is what makes the analysis useful", promptText.includes("/orders/:id/submit"));
check("...as does the deterministic conclusion the model must not contradict", promptText.includes("httpError"));
check("...and the affected-instance COUNT, never the instances", promptText.includes("500"));

// ── 5. A valid answer through the real output contract ──────────────────────────────────────────
console.log("\n5 — a valid analysis");
const good = JSON.stringify({
  version: 1,
  insufficient: false,
  category: "server-error",
  explanation: "The submit endpoint answered 500, so the confirmation the step waited for never appeared.",
  primaryEvidenceIds: [request.evidence[0].id],
  secondaryEvidenceIds: [request.evidence[1].id],
  investigationSteps: ["Check the submit endpoint's server logs for this route."]
});
const h = harness([good]);
const outcome = await h.service.submit({
  requestId: "l5b-good",
  feature: "failureAnalysis",
  priority: "background",
  prompt: request.prompt,
  schema: request.schema,
  maxOutputTokens: FAILURE_ANALYSIS_LIMITS.maxOutputTokens,
  timeoutMs: FAILURE_ANALYSIS_LIMITS.timeoutMs
});
check("the job completes", outcome.status === "ok", JSON.stringify(outcome));
const analysis = outcome.status === "ok" ? parseFailureAnalysis(outcome.value, request) : undefined;
check("the analysis parses", analysis?.ok === true, JSON.stringify(analysis));
if (analysis?.ok) {
  check("...with its primary evidence", JSON.stringify(analysis.primaryEvidenceIds) === JSON.stringify([request.evidence[0].id]));
  check("...its secondary consequence", analysis.secondaryEvidenceIds.length === 1);
  check("...a category and an investigation step", analysis.category === "server-error" && analysis.investigationSteps.length === 1);
  check("...and it is not marked insufficient", analysis.insufficient === false);
}
await h.service.shutdown();

// ── 6. "Insufficient evidence" is a first-class answer ──────────────────────────────────────────
console.log("\n6 — declining to conclude is a correct answer");
const declined = parseFailureAnalysis({ version: 1, insufficient: true }, request);
check("an insufficient answer with nothing else is accepted", declined.ok === true && declined.insufficient === true, JSON.stringify(declined));
check("...and carries no conclusion", declined.ok === true && declined.category === "" && declined.explanation === "");

// ── 7. Refusals ─────────────────────────────────────────────────────────────────────────────────
console.log("\n7 — refusals: an interpretation must be supported, and bounded");
const otherId = "evt-from-another-run";
const refusals: Array<[string, unknown, string, string]> = [
  ["an evidence id from another run is refused", { version: 1, insufficient: false, primaryEvidenceIds: [otherId] }, "UNKNOWN_EVIDENCE", "primaryEvidenceIds.0"],
  ["the same id listed twice is refused", { version: 1, insufficient: false, primaryEvidenceIds: [request.evidence[0].id, request.evidence[0].id] }, "DUPLICATE_EVIDENCE", "primaryEvidenceIds.1"],
  [
    "an id that is both primary AND secondary is refused",
    { version: 1, insufficient: false, primaryEvidenceIds: [request.evidence[0].id], secondaryEvidenceIds: [request.evidence[0].id] },
    "DUPLICATE_EVIDENCE",
    "secondaryEvidenceIds.0"
  ],
  [
    "a conclusion with NO supporting evidence is refused as a guess",
    { version: 1, insufficient: false, category: "server-error", explanation: "It broke." },
    "UNSUPPORTED_CONCLUSION",
    "primaryEvidenceIds"
  ],
  [
    "claiming insufficient AND concluding is refused as contradictory",
    { version: 1, insufficient: true, category: "server-error", explanation: "It broke.", primaryEvidenceIds: [request.evidence[0].id] },
    "CONTRADICTORY",
    "insufficient"
  ],
  ["a missing insufficient flag is refused", { version: 1, primaryEvidenceIds: [] }, "MALFORMED", "insufficient"],
  ["a wrong version is refused", { version: 9, insufficient: true }, "MALFORMED", "version"],
  ["a non-object answer is refused", "insufficient", "MALFORMED", "$"],
  [
    "control characters in prose are refused",
    { version: 1, insufficient: false, explanation: `bad${String.fromCharCode(7)}text`, primaryEvidenceIds: [request.evidence[0].id] },
    "UNSAFE_TEXT",
    "explanation"
  ],
  [
    "an over-long explanation is refused",
    { version: 1, insufficient: false, explanation: "x".repeat(FAILURE_ANALYSIS_LIMITS.maxExplanationChars + 1), primaryEvidenceIds: [request.evidence[0].id] },
    "MALFORMED",
    "explanation"
  ],
  [
    "too many investigation steps are refused",
    { version: 1, insufficient: true, investigationSteps: Array.from({ length: FAILURE_ANALYSIS_LIMITS.maxSteps + 1 }, () => "look") },
    "MALFORMED",
    "investigationSteps"
  ],
  ["an empty investigation step is refused", { version: 1, insufficient: true, investigationSteps: ["  "] }, "MALFORMED", "investigationSteps.0"]
];
for (const [label, value, code, field] of refusals) {
  const result = parseFailureAnalysis(value, request);
  check(label, !result.ok && result.code === code && result.field === field, JSON.stringify(result));
}

// ── 8. A model that tries to change the run ─────────────────────────────────────────────────────
console.log("\n8 — a model that tries to act rather than interpret");
const acting = harness(['{"version":1,"insufficient":true,"setStatus":"passed","retry":true}']);
const actingOutcome = await acting.service.submit({
  requestId: "l5b-acting",
  feature: "failureAnalysis",
  priority: "background",
  prompt: request.prompt,
  schema: request.schema,
  maxOutputTokens: FAILURE_ANALYSIS_LIMITS.maxOutputTokens,
  timeoutMs: FAILURE_ANALYSIS_LIMITS.timeoutMs
});
check("an answer that tries to set a status or a retry is refused by the output contract", actingOutcome.status === "failed" && actingOutcome.code === "SCHEMA_REJECTED", JSON.stringify(actingOutcome));
check("...and no value reaches the caller", !("value" in actingOutcome));
await acting.service.shutdown();

// ── 9. Tiers, and AI absence ────────────────────────────────────────────────────────────────────
console.log("\n9 — failure analysis observes, always");
const decision = failureAnalysisDecision(POLICY);
check("it is T0 observe", decision.decision === "observe" && decision.tier === "T0", JSON.stringify(decision));
const raised = failureAnalysisDecision({ enabled: true, featureTiers: { failureAnalysis: "T2" } });
check("configuration cannot raise it above observe", raised.decision === "observe", JSON.stringify(raised));
const switchedOff = failureAnalysisDecision({ enabled: false });
check("the master switch off forbids it", switchedOff.decision === "forbidden" && switchedOff.reason === "MASTER_SWITCH_OFF");
// The whole point of the baseline: with no AI at all, every failure still has a deterministic cause.
check("with AI off every failure still has its deterministic cause", mixed.every((entry) => entry.baseline.cause !== "insufficient"));
check("...and coalescing, which needs no model, still groups them", coalesceFailures(mixed).groups.length === 3);

// ── 10. A failure with no usable evidence is never analysed ─────────────────────────────────────
console.log("\n10 — nothing to reason over");
const bareBuffer = new EvidenceBuffer({ executionId: "exec-bare", instanceId: "bare" }, new EvidenceRunBudget(), { redactor: new SemanticRedactor(), now: () => 0 });
const bareEvents = [...bareBuffer.list()];
const bare: FailureBatchEntry = {
  instanceId: "bare",
  flowId: "flow-l5b",
  nodeId: "n-quiet",
  baseline: deriveFailureCause(bareEvents, { kind: "other", failedAtOffsetMs: 100 }),
  events: bareEvents
};
check("a failure with no evidence really is insufficient to the baseline", bare.baseline.cause === "insufficient", bare.baseline.cause);
const barePlan = coalesceFailures([bare]);
check("...so it is grouped but never analysed", barePlan.groups.length === 1 && barePlan.groups[0].analyse === false);
check("...and no request can be built for it", buildFailureAnalysisRequest(barePlan.groups[0]) === undefined);
check("...spending none of the batch budget", barePlan.stats.analyses === 0);

// ── 11. A passing run costs nothing ─────────────────────────────────────────────────────────────
console.log("\n11 — a run with no terminal failure");
const none = coalesceFailures([]);
check("an empty batch produces no groups", none.groups.length === 0);
check("...and no analyses", none.stats.analyses === 0 && none.stats.failures === 0);

const events: readonly ExecutionEvidenceEvent[] = sample.events;
check("the evidence this suite reasoned over was real, not empty", events.length > 0 && events.every((e) => typeof e.id === "string" && e.id.length > 0));

// ── The main-process adapter behind ai:analyzeFailure ───────────────────────────────────────────
// `app/main/ai/aiAssist.ts#analyzeFailure` is what the IPC channel calls: the renderer names a stored
// run and one instance, main reads that report's own L5a diagnostics. Every negative is production.
console.log("\nmain — the adapter behind ai:analyzeFailure (on demand)");
const asInstance = (entry: FailureBatchEntry): InstanceReport => ({
  instanceId: entry.instanceId,
  status: "failed",
  durationMs: 1_500,
  screenshots: [],
  downloadedFiles: [],
  diagnostics: { schemaVersion: INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, evidence: [...entry.events], cause: entry.baseline } as InstanceDiagnostics
});
const sameA = instanceFailure({ instanceId: "run-a", nodeId: "n-submit", stepIndex: 3, url: ROW_URL(11), status: 500 });
// Same signature as run-a, plus one event run-a lacks: what makes "the NAMED instance is analysed,
// not the group's first member" observable, since identical failures otherwise carry identical ids.
const sameB = instanceFailure({
  instanceId: "run-b",
  nodeId: "n-submit",
  stepIndex: 3,
  url: ROW_URL(12),
  status: 500,
  extra: [{ source: "console.error", payload: { message: "Inventory lookup unavailable" } }]
});
const sameC = instanceFailure({ instanceId: "run-c", nodeId: "n-submit", stepIndex: 3, url: ROW_URL(13), status: 500 });
const different = instanceFailure({ instanceId: "run-d", nodeId: "n-submit", stepIndex: 3, url: ROW_URL(14), status: 422 });
const insufficientEntry: FailureBatchEntry = { instanceId: "run-e", baseline: deriveFailureCause([], { kind: "other", failedAtOffsetMs: 10 }), events: [] };
check("(precondition) the empty-evidence fixture really is an insufficient baseline", insufficientEntry.baseline.cause === "insufficient", insufficientEntry.baseline.cause);
// Six more distinct signatures, so the automatic batch budget (5) is exhausted before `run-z`.
const crowd = Array.from({ length: 6 }, (_, i) => instanceFailure({ instanceId: `crowd-${i}`, nodeId: `n-crowd-${i}`, stepIndex: i, url: ROW_URL(20 + i), status: 500 }));
const lastSignature = instanceFailure({ instanceId: "run-z", nodeId: "n-last", stepIndex: 9, url: ROW_URL(30), status: 503 });
const storedRun: ConcurrentRunReport = {
  executionId: "exec-main",
  scenarioId: "wf",
  scenarioName: "Workflow",
  runMode: "dataDrivenConcurrent",
  maxConcurrentInstances: 4,
  status: "failed",
  startedAt: "2026-09-21T10:00:00.000Z",
  endedAt: "2026-09-21T10:01:00.000Z",
  durationMs: 60_000,
  passedFlows: 1,
  failedFlows: 12,
  skippedFlows: 0,
  instances: [
    ...[sameA, sameB, sameC, different, insufficientEntry, ...crowd, lastSignature].map(asInstance),
    { instanceId: "run-passed", status: "passed", durationMs: 900, screenshots: [], downloadedFiles: [] }
  ],
  runtimeInputs: {}
};
const auto = coalesceFailures(failureBatch(storedRun));
check("(precondition) the automatic batch would NOT analyse run-z's signature", auto.groups.find((g) => g.instanceIds.includes("run-z"))?.analyse === false);
const reportDeps = (service: AiService, policy: AiPolicyConfig = POLICY): FailureAssistDeps => ({
  submit: (job) => service.submit(job),
  policy: async () => policy,
  report: async (id) => (id === storedRun.executionId ? storedRun : null)
});
const citing = (ids: string[]) => JSON.stringify({ version: 1, insufficient: false, category: "server error", explanation: "The submit request returned 500.", primaryEvidenceIds: ids, investigationSteps: ["Check the order service logs."] });
const primaryOf = (entry: FailureBatchEntry) => entry.baseline.evidenceIds[0];

const onDemand = harness([citing([primaryOf(sameB)])]);
const view = await analyzeFailure(4, { requestId: "ui-1", executionId: "exec-main", instanceId: "run-b" }, reportDeps(onDemand.service));
check("a named failed instance is analysed", view.ok && view.analysis?.explanation === "The submit request returned 500.", JSON.stringify(view).slice(0, 300));
check("...covering every instance with the same signature", view.coalescedCount === 3, String(view.coalescedCount));
check("(precondition) run-b really shares run-a's signature", failureSignature(sameA) === failureSignature(sameB));
const sent = onDemand.fake.inferRequests().map((r) => `${r.system}\n${r.user}`).join("\n");
check("...analysing the NAMED instance's evidence, not the group's first member", sent.includes("Inventory lookup unavailable"));
check("exactly one model call", onDemand.fake.inferRequests().length === 1);
check("the prompt carries no query secret, row id or instance id", !/abc123secret|4001[1-4]|run-b|exec-main/.test(sent));
await onDemand.service.shutdown();

const distinct = harness([citing([primaryOf(different)])]);
check("a different status is its own failure, covering one instance", (await analyzeFailure(4, { requestId: "ui-2", executionId: "exec-main", instanceId: "run-d" }, reportDeps(distinct.service))).coalescedCount === 1);
await distinct.service.shutdown();

const explicit = harness([citing([primaryOf(lastSignature)])]);
const lastView = await analyzeFailure(4, { requestId: "ui-3", executionId: "exec-main", instanceId: "run-z" }, reportDeps(explicit.service));
check("an explicit request past the AUTOMATIC budget is still answered — the budget governs the batch, not a user's click", lastView.ok, JSON.stringify(lastView));
await explicit.service.shutdown();

const silent = harness([citing([primaryOf(sameA)])]);
const silentCalls = () => silent.fake.inferRequests().length;
check("an insufficient baseline is never analysed", (await analyzeFailure(4, { requestId: "ui-4", executionId: "exec-main", instanceId: "run-e" }, reportDeps(silent.service))).code === "NOTHING_TO_ASK");
check("a passing instance has nothing to ask", (await analyzeFailure(4, { requestId: "ui-5", executionId: "exec-main", instanceId: "run-passed" }, reportDeps(silent.service))).code === "NOTHING_TO_ASK");
check("an instance not in the run is NOT_FOUND", (await analyzeFailure(4, { requestId: "ui-6", executionId: "exec-main", instanceId: "run-nope" }, reportDeps(silent.service))).code === "NOT_FOUND");
check("a run that is not stored is NOT_FOUND", (await analyzeFailure(4, { requestId: "ui-7", executionId: "exec-gone", instanceId: "run-a" }, reportDeps(silent.service))).code === "NOT_FOUND");
check("AI switched off answers DISABLED", (await analyzeFailure(4, { requestId: "ui-8", executionId: "exec-main", instanceId: "run-a" }, reportDeps(silent.service, { enabled: false }))).code === "DISABLED");
for (const [label, input] of [
  ["a non-object request", "run-a"],
  ["a missing execution id", { requestId: "ui-9", instanceId: "run-a" }],
  ["an execution id with a path separator", { requestId: "ui-10", executionId: "../exec-main", instanceId: "run-a" }],
  ["a request id with a path separator", { requestId: "a\\b", executionId: "exec-main", instanceId: "run-a" }]
] as Array<[string, unknown]>) {
  check(`${label} is refused as INVALID_REQUEST`, (await analyzeFailure(4, input, reportDeps(silent.service))).code === "INVALID_REQUEST");
}
// Evidence the renderer sends along is dropped by the sanitizer; only the stored report is read.
await analyzeFailure(4, { requestId: "ui-11", executionId: "exec-main", instanceId: "run-e", evidence: [{ id: "x", payload: { note: "FORGED-EVIDENCE" } }] }, reportDeps(silent.service));
check("...and none of those reached the model, forged evidence included", silentCalls() === 0, String(silentCalls()));
await silent.service.shutdown();

const guess = harness([JSON.stringify({ version: 1, insufficient: false, category: "guess", explanation: "MODEL-GUESS-TEXT" })]);
const guessView = await analyzeFailure(4, { requestId: "ui-12", executionId: "exec-main", instanceId: "run-a" }, reportDeps(guess.service));
check("a conclusion citing no evidence is OUTPUT_REJECTED", guessView.code === "OUTPUT_REJECTED" && guessView.analysis === null, JSON.stringify(guessView));
check("...and none of its text reaches the renderer", !JSON.stringify(guessView).includes("MODEL-GUESS-TEXT"));
await guess.service.shutdown();

const unknownCite = harness([citing(["ev-999"])]);
check("citing evidence the run did not capture is OUTPUT_REJECTED", (await analyzeFailure(4, { requestId: "ui-13", executionId: "exec-main", instanceId: "run-a" }, reportDeps(unknownCite.service))).code === "OUTPUT_REJECTED");
await unknownCite.service.shutdown();

const declines = harness([JSON.stringify({ version: 1, insufficient: true })]);
const declineView = await analyzeFailure(4, { requestId: "ui-14", executionId: "exec-main", instanceId: "run-a" }, reportDeps(declines.service));
check("'insufficient' is a first-class answer, shown as such", declineView.ok && declineView.analysis?.insufficient === true, JSON.stringify(declineView));
await declines.service.shutdown();

console.log(`\nL5b failure intelligence: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
