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
 *   - **The grammar cannot write a refused answer.** The runtime's grammar writes every property, so
 *     every answer it can decode must be accepted and classified — except an id listed twice, which no
 *     grammar expresses. v1 failed this: every real 0.8B answer declined AND concluded (2026-09-22).
 *   - **Nothing can change the run.** The schema has no field for a status, retry, policy or edit.
 *   - **An answer is saved with its run report** (a real `JsonProfileStore`): one per signature,
 *     redacted and rescanned first, never resurrecting a report deleted meanwhile, and deletable
 *     through any coalesced member back to the report the run wrote, byte for byte.
 *
 * The last section audits the labelled set `verify:ai-error-quality-live` sends to the real model, and
 * runs its judge's controls.
 *
 * Run: npm run verify:ai-error-analysis
 */
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { validateAiOutput, type AiOutputSchema } from "@src/ai/AiOutputContract";
import { AiService, type AiJobRequest, type AiServiceSettings } from "@src/ai/AiService";
import { FakeAiHostTransport, type FakeInferStep } from "@src/ai/FakeAiHostTransport";
import {
  FAILURE_ANALYSIS_LIMITS,
  buildFailureAnalysisRequest,
  coalesceFailures,
  failureAnalysisDecision,
  failureSignature,
  parseFailureAnalysis,
  stepRelations,
  type FailureAnalysisRequest,
  type FailureBatchEntry
} from "@src/ai/failureAnalysis";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import { REDACTED, SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { EvidenceBuffer, EvidenceRunBudget, type ExecutionEvidenceEvent, type RequestProvenance } from "@src/runner/evidence/ExecutionEvidence";
import { deriveFailureCause } from "@src/runner/evidence/FailureCauseBaseline";
import { INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, type InstanceDiagnostics } from "@src/runner/evidence/FailureEvidenceCollector";
import type { ConcurrentRunReport, InstanceReport } from "@src/reports/ExecutionReport";
import type { AiPolicyConfig } from "@src/security/authz/AiAutonomyPolicy";

import { storedFailureAnalysisFor } from "@src/ai/contracts/AiApi";
import { redactFailureAnalysis, withoutStoredFailureAnalysis } from "@src/ai/failureAnalysis";
import { JsonProfileStore } from "@src/storage/ProfileStore";

import { analyzeFailure, deleteFailureAnalysis, failureBatch, type FailureAssistDeps, type FailureReportAccess } from "../app/main/ai/aiAssist";
import { LARGEST_FAILURE, failedRun, failureAnalysisPacket } from "./ai-harness/failureAnalysisPacket";
import {
  ANCHORING_ITEMS,
  CANARY as ERROR_CANARY,
  ERROR_SET,
  L5_LABELLED_ITEMS,
  PROVENANCE_ITEMS,
  REQUEST_PROVENANCE_ITEMS,
  baselineCorrect,
  buildCase,
  capturedFailure,
  capturedStoredCause,
  errorControlFailures,
  noCauseControlFailures,
  requestFor as labelledRequestFor,
  withoutProvenance
} from "./ai-harness/errorQualitySet";

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

/** A timeout with no direct evidence, through the same real buffer and baseline: the runner's own record, plus any console errors. */
function runnerOnly(instanceId: string, nodeId: string, consoleMessages: string[] = []): FailureBatchEntry {
  let clock = 0;
  const buffer = new EvidenceBuffer({ executionId: "exec-l5b", instanceId }, new EvidenceRunBudget(), { redactor: new SemanticRedactor(), now: () => clock });
  const step = { flowId: "flow-l5b", nodeId, stepIndex: 4 };
  for (const message of consoleMessages) {
    clock += 100;
    buffer.add({ source: "console.error", severity: "error", context: step, payload: { message } });
  }
  clock = 5_000;
  buffer.add({ source: "runner.failure", severity: "error", context: step, payload: { kind: "timeout", message: "Timed out waiting for the confirmation heading." } });
  const events = [...buffer.list()];
  const runnerEvent = events.find((event) => event.source === "runner.failure");
  const baseline = deriveFailureCause(events, { kind: "timeout", stepStartOffsetMs: 0, failedAtOffsetMs: 5_000, ...(runnerEvent ? { evidenceId: runnerEvent.id } : {}) });
  return { instanceId, flowId: "flow-l5b", nodeId, stepIndex: 4, baseline, events };
}
const requestFor = (entry: FailureBatchEntry) =>
  buildFailureAnalysisRequest({ signature: failureSignature(entry), instanceIds: [entry.instanceId], count: 1, representative: entry, analyse: true }) as FailureAnalysisRequest;

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
check(
  "...offering every event the baseline cited, shown newest first rather than in the baseline's order",
  group.representative.baseline.evidenceIds.every((id) => request.evidence.some((event) => event.id === id)) &&
    request.evidence.every((event, index, all) => index === 0 || all[index - 1].offsetMs >= event.offsetMs) &&
    request.evidence[0].source === "runner.failure"
);
type ObjectSchema = Extract<AiOutputSchema, { type: "object" }>;
type ArraySchema = Extract<AiOutputSchema, { type: "array" }>;
const conclusionSchema = ((request.schema as ObjectSchema).properties.conclusion as ArraySchema).items as ObjectSchema;
const idEnum = (field: string) => ((conclusionSchema.properties[field] as ArraySchema).items as { enum: readonly string[] }).enum;
check("the secondary id enum is exactly the evidence offered", JSON.stringify(idEnum("secondaryEvidenceIds")) === JSON.stringify(request.evidence.map((e) => e.id)));
check(
  "...and the primary one is the evidence offered less the runner's own failure record",
  JSON.stringify(idEnum("primaryEvidenceIds")) === JSON.stringify(request.evidence.filter((e) => e.source !== "runner.failure").map((e) => e.id)) &&
    request.evidence.some((e) => e.source === "runner.failure"),
  JSON.stringify(idEnum("primaryEvidenceIds"))
);
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
// Told the conclusion first, the real 0.8B only ever agreed with it, even where it was wrong.
check(
  "...but NOT the deterministic conclusion, so the model reads the evidence itself",
  !promptText.includes("httpError") && !promptText.includes(group.representative.baseline.reason) && !/deterministic conclusion|rests on/i.test(promptText)
);
check("...and the affected-instance COUNT, never the instances", promptText.includes("500"));

// ── 4b. The request's size: one block, whole lines, bounded answers ────────────────────────────
// Qwen3.5-0.8B's tokenizer (verify:ai-failure-analysis-budget): every DATA block costs ~45 prompt tokens
// of nonce delimiters, and the output cap is honest only if the longest acceptable answer fits it.
console.log("\n4b — one data block, every offered line whole, a bounded answer");
const failureText = request.prompt.fields.find((field) => field.name === "Failure")?.text ?? "";
check(
  "the prompt is ONE text block, plus the routes in the unredacted ids channel",
  JSON.stringify(request.prompt.fields.map((field) => field.name)) === JSON.stringify(["Failure", "EvidenceRoutes"]),
  JSON.stringify(request.prompt.fields.map((field) => field.name))
);
check(
  "...carrying the instance count and the evidence newest first, and neither the conclusion nor the ids it rests on",
  failureText.includes("Instances that failed the same way: 500") &&
    failureText.includes("Evidence, newest first:") &&
    !failureText.includes("Deterministic conclusion") &&
    !failureText.includes("rests on"),
  failureText.slice(0, 300)
);
const shownWhole = (of: FailureAnalysisRequest, user: string) => {
  const lines = (of.prompt.fields.find((field) => field.name === "Failure")?.text ?? "").split("\n");
  return of.evidence.every((event) => lines.some((line) => line.startsWith(`${event.id}: ${event.source} `) && user.includes(`\n${line}\n`)));
};
check("every offered event's line reaches the model whole", shownWhole(request, rendered.user));
check("a single-instance failure carries no count line", !requestFor(sample).prompt.fields[0].text?.includes("Instances that failed"));

// Twelve long console errors beside a timeout: far more than the evidence budget holds.
const crowdEntry = runnerOnly("i-crowd", "n-crowd", Array.from({ length: 12 }, (_, i) => `Widget ${i} failed: ${"the inventory service answered with an unexpected payload shape ".repeat(4)}`));
const crowded = requestFor(crowdEntry);
const crowdedPrompt = buildAiPrompt(crowded.prompt, new SemanticRedactor(), "0123456789abcdef");
const crowdedLines = (crowded.prompt.fields[0].text ?? "").split("\n").filter((line) => /^ev\d+: /.test(line));
check("(precondition) the crowded failure has more evidence than the budget holds", crowdEntry.events.length > crowded.evidence.length && crowdedLines.join("\n").length > FAILURE_ANALYSIS_LIMITS.maxEvidenceChars / 2);
check("...so only whole lines are offered, within the evidence budget", crowdedLines.join("\n").length <= FAILURE_ANALYSIS_LIMITS.maxEvidenceChars, String(crowdedLines.join("\n").length));
check("...each offered id's line whole in the prompt the model gets", crowdedPrompt.ok && shownWhole(crowded, crowdedPrompt.user));
check("...and no id offered whose line was left out", JSON.stringify(crowded.evidence.map((event) => event.id)) === JSON.stringify(crowdedLines.map((line) => line.split(":")[0])));
check("...still offering the event the baseline rests on", crowded.evidence.some((event) => event.id === crowdEntry.baseline.evidenceIds[0]));
const crowdedConclusion = ((crowded.schema as ObjectSchema).properties.conclusion as ArraySchema).items as ObjectSchema;
const listOf = (schema: ObjectSchema, field: string) => schema.properties[field] as ArraySchema;
check(
  "each citation list holds at most maxCitedIds, however many causes are offered",
  crowded.evidence.filter((event) => event.source !== "runner.failure").length > FAILURE_ANALYSIS_LIMITS.maxCitedIds &&
    listOf(crowdedConclusion, "primaryEvidenceIds").maxItems === FAILURE_ANALYSIS_LIMITS.maxCitedIds &&
    listOf(crowdedConclusion, "secondaryEvidenceIds").maxItems === FAILURE_ANALYSIS_LIMITS.maxCitedIds
);
check(
  "...and the answer's texts and steps are bounded by the same limits the parser applies",
  listOf(crowdedConclusion, "investigationSteps").maxItems === FAILURE_ANALYSIS_LIMITS.maxSteps &&
    JSON.stringify(crowdedConclusion.properties.explanation) === JSON.stringify({ type: "string", maxLength: FAILURE_ANALYSIS_LIMITS.maxExplanationChars })
);
// One event whose line alone exceeds the budget: the lead is still shown, cut, and nothing else fits.
let hugeClock = 0;
const hugeBuffer = new EvidenceBuffer({ executionId: "exec-l5b", instanceId: "i-huge" }, new EvidenceRunBudget(), { redactor: new SemanticRedactor(), now: () => hugeClock });
const hugeStep = { flowId: "flow-l5b", nodeId: "n-huge", stepIndex: 1 };
hugeClock = 1_000;
hugeBuffer.add({ source: "page.error", severity: "error", context: hugeStep, payload: Object.fromEntries(["a", "b", "c", "d"].map((key) => [`detail${key}`, `${key} `.repeat(240)])) });
hugeClock = 1_500;
hugeBuffer.add({ source: "runner.failure", severity: "error", context: hugeStep, payload: { kind: "assertion", message: "The receipt did not appear." } });
const hugeEvents = [...hugeBuffer.list()];
const hugeRunner = hugeEvents.find((event) => event.source === "runner.failure");
const hugeEntry: FailureBatchEntry = {
  instanceId: "i-huge",
  baseline: deriveFailureCause(hugeEvents, { kind: "assertion", stepStartOffsetMs: 500, failedAtOffsetMs: 1_500, ...(hugeRunner ? { evidenceId: hugeRunner.id } : {}) }),
  events: hugeEvents
};
const huge = requestFor(hugeEntry);
const hugeLines = (huge.prompt.fields[0].text ?? "").split("\n").filter((line) => /^ev\d+: /.test(line));
check("(precondition) the lead event's line alone exceeds the evidence budget", hugeEntry.baseline.cause === "scriptError" && hugeEvents[0].id === hugeEntry.baseline.evidenceIds[0]);
check(
  "a lead line longer than the budget is still offered, cut to the budget, and nothing past it",
  JSON.stringify(huge.evidence.map((event) => event.id)) === JSON.stringify([hugeEvents[0].id]) && hugeLines.length === 1 && hugeLines[0].length === FAILURE_ANALYSIS_LIMITS.maxEvidenceChars,
  JSON.stringify({ offered: huge.evidence.map((event) => event.id), chars: hugeLines.map((line) => line.length) })
);

// The benchmark measures THIS request: `packets:failureAnalysis` is the job `analyzeFailure` submits.
const benchReport = failedRun("exec-bench-largest", LARGEST_FAILURE, "timeout");
let benchJob: AiJobRequest | undefined;
await analyzeFailure(4, { requestId: "bench-1", executionId: benchReport.executionId, instanceId: benchReport.instances[0].instanceId }, {
  submit: async (job) => {
    benchJob = job;
    return { status: "cancelled", yields: 0 };
  },
  policy: async () => POLICY,
  report: async () => benchReport,
  updateReport: async () => undefined
});
const benchPacket = failureAnalysisPacket();
check(
  "benchmark:ai-model's failureAnalysis packet is the job analyzeFailure submits: prompt, schema and output cap",
  benchJob !== undefined && JSON.stringify([benchJob.prompt, benchJob.schema, benchJob.maxOutputTokens]) === JSON.stringify([benchPacket.spec, benchPacket.schema, benchPacket.maxOutputTokens])
);
check("...at the product's own output cap", benchJob?.maxOutputTokens === FAILURE_ANALYSIS_LIMITS.maxOutputTokens && benchPacket.maxOutputTokens === FAILURE_ANALYSIS_LIMITS.maxOutputTokens);

// ── 5. A valid answer through the real output contract ──────────────────────────────────────────
console.log("\n5 — a valid analysis");
// By source, not position: the list is newest first, so the runner's own record leads it.
const causeIdOf = (of: FailureAnalysisRequest) => of.evidence.find((event) => event.source !== "runner.failure")!.id;
const good = JSON.stringify({
  version: 1,
  conclusion: [
    {
      primaryEvidenceIds: [causeIdOf(request)],
      secondaryEvidenceIds: [request.evidence.find((event) => event.source === "runner.failure")!.id],
      category: "server-error",
      explanation: "The submit endpoint answered 500, so the confirmation the step waited for never appeared.",
      investigationSteps: ["Check the submit endpoint's server logs for this route."]
    }
  ]
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
  check("...with its primary evidence", JSON.stringify(analysis.primaryEvidenceIds) === JSON.stringify([causeIdOf(request)]));
  check("...its secondary consequence", analysis.secondaryEvidenceIds.length === 1);
  check("...a category and an investigation step", analysis.category === "server-error" && analysis.investigationSteps.length === 1);
  check("...and it is not marked insufficient", analysis.insufficient === false);
}
await h.service.shutdown();

// ── 6. "Insufficient evidence" is a first-class answer ──────────────────────────────────────────
console.log("\n6 — declining to conclude is a correct answer, where it is true");
// Three tiers, decided from the evidence: a direct cause (the HTTP 500 above), a runner timeout with
// console errors beside it, and a bare runner timeout, whose only evidence is its own failure record.
const indirectEntry = runnerOnly("i-console", "n-console", ["Uncaught TypeError: the payment widget failed to load"]);
const quietEntry = runnerOnly("i-quiet", "n-quiet");
const indirect = requestFor(indirectEntry);
const quiet = requestFor(quietEntry);
check("(precondition) the HTTP 500's baseline is direct, so it must conclude", request.mustConclude && group.representative.baseline.cause === "httpError");
check("(precondition) the console-error timeout is the runner's own cause, with cause evidence beside it", !indirect.mustConclude && indirectEntry.baseline.cause === "timeout" && indirect.evidence.some((e) => e.source === "console.error"));
check("(precondition) the bare timeout offers nothing but the runner's own record", !quiet.mustConclude && quiet.evidence.length === 1 && quiet.evidence[0].source === "runner.failure");
const DECLINE_VALUE = { version: 1, conclusion: [] };
const declined = parseFailureAnalysis(DECLINE_VALUE, indirect);
check("an empty conclusion list is accepted as insufficient", declined.ok === true && declined.insufficient === true, JSON.stringify(declined));
check("...and carries no conclusion: no text, no citation, no step", declined.ok === true && declined.category === "" && declined.explanation === "" && declined.primaryEvidenceIds.length === 0 && declined.investigationSteps.length === 0);
const quietDeclined = parseFailureAnalysis(DECLINE_VALUE, quiet);
check("a bare runner timeout is accepted as insufficient", quietDeclined.ok === true && quietDeclined.insufficient === true, JSON.stringify(quietDeclined));
const directDeclined = parseFailureAnalysis(DECLINE_VALUE, request);
check(
  "declining beside a DIRECT cause is refused as contradictory: the drawer shows that cause right above the answer",
  !directDeclined.ok && directDeclined.code === "CONTRADICTORY" && directDeclined.field === "conclusion",
  JSON.stringify(directDeclined)
);
const instructions = request.prompt.instructions;
check("the prompt tells the model to decline with an empty conclusion list", /leave the conclusion list empty/.test(instructions), instructions);
check("...and never names v1's `insufficient` flag, which the schema no longer has", !/insufficient/i.test(instructions));

// ── 6b. The grammar and the parser agree ────────────────────────────────────────────────────────
// node-llama-cpp 3.21.1 writes EVERY property of an object, in schema order, whatever `required` says:
// `getGbnfJsonTerminalForGbnfJsonSchema` marks each field required and `GbnfObjectMap` emits them all.
// v1 left `insufficient` a free boolean beside `category` and `explanation`, so a model that declined
// still had to write both — and the parser refused exactly that. Every real 0.8B answer did it.
console.log("\n6b — every answer the grammar can decode is one the parser accepts and classifies");
/** Every answer the grammar lets a model write, up to the words: each array empty and non-empty where allowed, each boolean either way, each free string written in, as a model writes it. */
function grammarAnswers(schema: AiOutputSchema): unknown[] {
  switch (schema.type) {
    case "object":
      return Object.entries(schema.properties).reduce<Record<string, unknown>[]>(
        (partials, [key, child]) => partials.flatMap((partial) => grammarAnswers(child).map((value) => ({ ...partial, [key]: value }))),
        [{}]
      );
    case "array": {
      const min = schema.minItems ?? 0;
      const lengths = [...new Set([min, Math.min(schema.maxItems, Math.max(min, 1))])];
      return lengths.flatMap((length) => (length === 0 ? [[]] : grammarAnswers(schema.items).map((item) => Array.from({ length }, () => item))));
    }
    case "string":
      return ["enum" in schema ? schema.enum[0] : "prose"];
    case "integer":
    case "number":
      return [schema.minimum ?? 0];
    case "boolean":
      return [true, false];
  }
}
const requiredEverywhere = (schema: AiOutputSchema): boolean =>
  schema.type === "object"
    ? Object.keys(schema.properties).every((key) => schema.required?.includes(key)) && Object.values(schema.properties).every(requiredEverywhere)
    : schema.type === "array"
      ? requiredEverywhere(schema.items)
      : true;
for (const [tier, tierRequest, declines, concludes] of [
  ["a direct cause", request, false, true],
  ["a runner timeout with console errors", indirect, true, true],
  ["a bare runner timeout", quiet, true, false]
] as Array<[string, FailureAnalysisRequest, boolean, boolean]>) {
  console.log(`  — ${tier}`);
  check("the schema marks every property required, as the grammar writes them all", requiredEverywhere(tierRequest.schema));
  const reachable = grammarAnswers(tierRequest.schema).map((answer) => ({ answer, parsed: parseFailureAnalysis(answer, tierRequest) }));
  check("(precondition) every enumerated answer passes the output contract", reachable.length > 0 && reachable.every(({ answer }) => validateAiOutput(answer, tierRequest.schema).length === 0));
  const refusedReachable = reachable.flatMap(({ parsed }) => (parsed.ok || parsed.code === "DUPLICATE_EVIDENCE" ? [] : [parsed]));
  check("every decodable answer is accepted, or refused only for an id listed twice — the one rule no grammar expresses", refusedReachable.length === 0, JSON.stringify(refusedReachable));
  const declinesReachable = reachable.some(({ parsed }) => parsed.ok && parsed.insufficient && parsed.explanation === "" && parsed.primaryEvidenceIds.length === 0);
  const concludesReachable = reachable.some(({ parsed }) => parsed.ok && !parsed.insufficient && parsed.primaryEvidenceIds.length > 0 && parsed.explanation.length > 0);
  check(declines ? "...a decline is decodable, with nothing beside it" : "...a decline is NOT decodable", declinesReachable === declines);
  check(concludes ? "...a conclusion citing cause evidence is decodable" : "...a conclusion is NOT decodable", concludesReachable === concludes);
}

// ── 7. Refusals ─────────────────────────────────────────────────────────────────────────────────
console.log("\n7 — refusals: an interpretation must be supported, and bounded");
const otherId = "evt-from-another-run";
const e0 = causeIdOf(request);
const runnerIdOf = (of: FailureAnalysisRequest) => of.evidence.find((event) => event.source === "runner.failure")!.id;
const V1_SHAPE = { version: 1, insufficient: true, category: "server-error", explanation: "It broke.", primaryEvidenceIds: [e0], secondaryEvidenceIds: [], investigationSteps: [] };
const conclude = (fields: Record<string, unknown>) => ({
  version: 1,
  conclusion: [{ primaryEvidenceIds: [e0], secondaryEvidenceIds: [], category: "server-error", explanation: "It broke.", investigationSteps: [], ...fields }]
});
const refusals: Array<[string, unknown, string, string]> = [
  ["an evidence id from another run is refused", conclude({ primaryEvidenceIds: [otherId] }), "UNKNOWN_EVIDENCE", "conclusion.0.primaryEvidenceIds.0"],
  ["the same id listed twice is refused", conclude({ primaryEvidenceIds: [e0, e0] }), "DUPLICATE_EVIDENCE", "conclusion.0.primaryEvidenceIds.1"],
  ["an id that is both primary AND secondary is refused", conclude({ secondaryEvidenceIds: [e0] }), "DUPLICATE_EVIDENCE", "conclusion.0.secondaryEvidenceIds.0"],
  ["a conclusion with NO supporting evidence is refused as a guess", conclude({ primaryEvidenceIds: [] }), "UNSUPPORTED_CONCLUSION", "conclusion.0.primaryEvidenceIds"],
  ["a conclusion resting on the runner's own failure record is refused as a guess", conclude({ primaryEvidenceIds: [runnerIdOf(request)] }), "UNSUPPORTED_CONCLUSION", "conclusion.0.primaryEvidenceIds.0"],
  ["a conclusion that explains nothing is refused", conclude({ explanation: "  " }), "MALFORMED", "conclusion.0.explanation"],
  ["claiming insufficient AND concluding is refused as contradictory", { ...conclude({}), insufficient: true }, "CONTRADICTORY", "insufficient"],
  ["claiming a conclusion AND declining is refused as contradictory", { version: 1, insufficient: false, conclusion: [] }, "CONTRADICTORY", "insufficient"],
  ["the v1 shape every real 0.8B answer took — insufficient, with a conclusion beside it — is refused", V1_SHAPE, "MALFORMED", "conclusion"],
  ["a missing conclusion list is refused", { version: 1 }, "MALFORMED", "conclusion"],
  ["two conclusions are refused", { version: 1, conclusion: [conclude({}).conclusion[0], conclude({}).conclusion[0]] }, "MALFORMED", "conclusion"],
  ["a key the schema does not name is refused, and not echoed", { version: 1, conclusion: [], verdict: "passed" }, "MALFORMED", "$"],
  ["...inside a conclusion too", conclude({ setStatus: "passed" }), "MALFORMED", "conclusion.0"],
  ["a wrong version is refused", { version: 9, conclusion: [] }, "MALFORMED", "version"],
  ["a non-object answer is refused", "insufficient", "MALFORMED", "$"],
  ["control characters in prose are refused", conclude({ explanation: `bad${String.fromCharCode(7)}text` }), "UNSAFE_TEXT", "conclusion.0.explanation"],
  ["an over-long explanation is refused", conclude({ explanation: "x".repeat(FAILURE_ANALYSIS_LIMITS.maxExplanationChars + 1) }), "MALFORMED", "conclusion.0.explanation"],
  [
    "too many investigation steps are refused",
    conclude({ investigationSteps: Array.from({ length: FAILURE_ANALYSIS_LIMITS.maxSteps + 1 }, () => "look") }),
    "MALFORMED",
    "conclusion.0.investigationSteps"
  ],
  ["an empty investigation step is refused", conclude({ investigationSteps: ["  "] }), "MALFORMED", "conclusion.0.investigationSteps.0"],
  ["an over-long investigation step is refused", conclude({ investigationSteps: ["x".repeat(FAILURE_ANALYSIS_LIMITS.maxStepChars + 1)] }), "MALFORMED", "conclusion.0.investigationSteps.0"]
];
for (const [label, value, code, field] of refusals) {
  const result = parseFailureAnalysis(value, request);
  check(label, !result.ok && result.code === code && result.field === field, JSON.stringify(result));
}
// The parser re-checks the citation caps the grammar enforces, on a request with more causes than a list holds.
const crowdedCauses = crowded.evidence.filter((event) => event.source !== "runner.failure").map((event) => event.id);
for (const [label, fields, field] of [
  ["more primary ids than a citation list holds are refused", { primaryEvidenceIds: crowdedCauses.slice(0, FAILURE_ANALYSIS_LIMITS.maxCitedIds + 1) }, "conclusion.0.primaryEvidenceIds"],
  ["...and more secondary ids", { secondaryEvidenceIds: [runnerIdOf(crowded), ...crowdedCauses.slice(1, FAILURE_ANALYSIS_LIMITS.maxCitedIds + 1)] }, "conclusion.0.secondaryEvidenceIds"]
] as Array<[string, Record<string, unknown>, string]>) {
  const value = { version: 1, conclusion: [{ primaryEvidenceIds: [crowdedCauses[0]], secondaryEvidenceIds: [], category: "timeout", explanation: "It broke.", investigationSteps: [], ...fields }] };
  const result = parseFailureAnalysis(value, crowded);
  check(label, !result.ok && result.code === "MALFORMED" && result.field === field && validateAiOutput(value, crowded.schema).length > 0, JSON.stringify(result));
}
const quietConclusion = { version: 1, conclusion: [{ primaryEvidenceIds: [runnerIdOf(quiet)], secondaryEvidenceIds: [], category: "timeout", explanation: "The heading never appeared.", investigationSteps: [] }] };
const quietRefused = parseFailureAnalysis(quietConclusion, quiet);
check("on a bare runner timeout, a conclusion — the one real 0.8B wrote — is refused as a guess", !quietRefused.ok && quietRefused.code === "UNSUPPORTED_CONCLUSION", JSON.stringify(quietRefused));
const withConsequence = parseFailureAnalysis(conclude({ secondaryEvidenceIds: [runnerIdOf(request)] }), request);
check("...while the runner's record may still be cited as a consequence", withConsequence.ok && withConsequence.secondaryEvidenceIds[0] === runnerIdOf(request), JSON.stringify(withConsequence));
// The output contract mirrors the grammar, so these never reach the parser in the product.
for (const [label, value, schema] of [
  ["the v1 contradictory shape is refused by the output contract, before the parser", V1_SHAPE, request.schema],
  ["...as is a conclusion carrying an `insufficient` flag", { ...conclude({}), insufficient: true }, request.schema],
  ["...a conclusion citing nothing", conclude({ primaryEvidenceIds: [] }), request.schema],
  ["...a conclusion resting on the runner's own record", conclude({ primaryEvidenceIds: [runnerIdOf(request)] }), request.schema],
  ["...a decline beside a direct cause", DECLINE_VALUE, request.schema],
  ["...and any conclusion on a bare runner timeout", quietConclusion, quiet.schema]
] as Array<[string, unknown, AiOutputSchema]>) {
  check(label, validateAiOutput(value, schema).length > 0);
}

// ── 8. A model that tries to change the run ─────────────────────────────────────────────────────
console.log("\n8 — a model that tries to act rather than interpret");
const acting = harness(['{"version":1,"conclusion":[],"setStatus":"passed","retry":true}']);
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

// ── 12. Step relevance: the step each event was captured in ───────────────────────────────────
console.log("\n12 — step relevance: provenance from the collector's step stamp, never from text, status or URL");
{
  type Spec = { at: number; step: number | undefined; source: "http.error" | "page.error" | "console.error" | "runner.failure"; payload: Record<string, string | number> };
  /** Through the real buffer and baseline, each event stamped with the step it was captured in. */
  const stepped = (specs: Spec[], stepStartOffsetMs: number): FailureBatchEntry => {
    let clock = 0;
    const buffer = new EvidenceBuffer({ executionId: "exec-steps", instanceId: "i-steps" }, new EvidenceRunBudget(), { redactor: new SemanticRedactor(), now: () => clock });
    for (const spec of specs) {
      clock = spec.at;
      buffer.add({ source: spec.source, severity: "error", payload: spec.payload, context: { flowId: "flow-steps", nodeId: `n-${spec.step ?? "x"}`, ...(spec.step === undefined ? {} : { stepIndex: spec.step }) } });
    }
    const all = [...buffer.list()];
    const runner = [...all].reverse().find((event) => event.source === "runner.failure");
    const failedAt = specs.find((spec) => spec.source === "runner.failure")?.at ?? 0;
    const baseline = deriveFailureCause(all, { kind: "assertion", stepStartOffsetMs, failedAtOffsetMs: failedAt, ...(runner ? { evidenceId: runner.id } : {}) });
    return { instanceId: "i-steps", flowId: "flow-steps", nodeId: "n-6", stepIndex: 6, baseline, events: all };
  };
  const idOf = (entry: FailureBatchEntry, source: string, at: number) => entry.events.find((event) => event.source === source && event.offsetMs === at)!.id;
  const lineFor = (of: FailureAnalysisRequest, id: string) => (of.prompt.fields[0].text ?? "").split("\n").find((line) => line.startsWith(`${id}: `)) ?? "";
  const enumOf = (of: FailureAnalysisRequest, field: string) => {
    const conclusion = (of.schema as ObjectSchema).properties.conclusion as ArraySchema;
    return (((conclusion.items as ObjectSchema).properties[field] as ArraySchema).items as { enum: readonly string[] }).enum;
  };
  const primaryEnum = (of: FailureAnalysisRequest) => enumOf(of, "primaryEvidenceIds");
  const secondaryEnum = (of: FailureAnalysisRequest) => enumOf(of, "secondaryEvidenceIds");
  const conclusionOn = (primary: string[], secondary: string[] = []) => ({
    version: 1,
    conclusion: [{ primaryEvidenceIds: primary, secondaryEvidenceIds: secondary, category: "script error", explanation: "The save button was never bound.", investigationSteps: [] }]
  });

  // An unrelated 503 in the step before, the real cause in the failed step, and an error-handler step after it.
  const spans = stepped(
    [
      { at: 300, step: 5, source: "http.error", payload: { method: "GET", url: `https://${ERROR_CANARY.toLowerCase()}:pw@shop.example/api/recommendations?token=${ERROR_CANARY}`, status: 503, resourceType: "fetch" } },
      { at: 1_400, step: 6, source: "page.error", payload: { name: "TypeError", message: "Cannot read properties of null (reading 'addEventListener')" } },
      { at: 1_900, step: 6, source: "runner.failure", payload: { kind: "assertion", message: "The address saved banner did not appear." } },
      { at: 2_600, step: 7, source: "http.error", payload: { method: "POST", url: "https://shop.example/api/audit/errors", status: 500, resourceType: "fetch" } }
    ],
    1_400
  );
  const [earlier, inStep, runnerId, after] = [idOf(spans, "http.error", 300), idOf(spans, "page.error", 1_400), idOf(spans, "runner.failure", 1_900), idOf(spans, "http.error", 2_600)];
  const relations = stepRelations(spans);
  check(
    "each event's relation is read from its step stamp: earlier, failed, failed (the runner's own), after",
    relations.get(earlier) === "earlierStep" && relations.get(inStep) === "failedStep" && relations.get(runnerId) === "failedStep" && relations.get(after) === "afterFailure",
    JSON.stringify([...relations])
  );
  const spanRequest = requestFor(spans);
  check("the request carries each offered event's relation", JSON.stringify(spanRequest.stepRelations) === JSON.stringify(Object.fromEntries(spanRequest.evidence.map((event) => [event.id, relations.get(event.id)]))));
  check("an event from after the failed step is never primary evidence in the grammar", !primaryEnum(spanRequest).includes(after) && primaryEnum(spanRequest).includes(inStep), JSON.stringify(primaryEnum(spanRequest)));
  check("...an earlier step's event still may be (a precondition, as the baseline's preceding window allows)", primaryEnum(spanRequest).includes(earlier));
  check("...and the after-failure event may still be cited as a consequence", secondaryEnum(spanRequest).includes(after));
  check(
    "with more than one step offered, every line states its step in product words",
    lineFor(spanRequest, earlier).includes("[during an earlier step]") &&
      lineFor(spanRequest, inStep).includes("[during the failed step]") &&
      lineFor(spanRequest, runnerId).includes("[during the failed step]") &&
      lineFor(spanRequest, after).includes("[after the failed step]"),
    spanRequest.prompt.fields[0].text
  );
  const parsed = (value: unknown) => parseFailureAnalysis(value, spanRequest);
  const onAfter = parsed(conclusionOn([after]));
  check("a conclusion resting on an event from after the failed step is refused as unsupported", !onAfter.ok && onAfter.code === "UNSUPPORTED_CONCLUSION", JSON.stringify(onAfter));
  check("...and the output contract refuses it before the parser", validateAiOutput(conclusionOn([after]), spanRequest.schema).length > 0);
  const onCause = parsed(conclusionOn([inStep], [after]));
  check("the failed step's own event as primary, the later one as a consequence, is accepted", onCause.ok && !onCause.insufficient, JSON.stringify(onCause));
  const onEarlier = parsed(conclusionOn([earlier]));
  check("an earlier step's event as primary is accepted: provenance informs, it does not decide", onEarlier.ok && !onEarlier.insufficient, JSON.stringify(onEarlier));
  const onRunner = parsed(conclusionOn([runnerId]));
  check("the runner's own record is still refused as primary", !onRunner.ok && onRunner.code === "UNSUPPORTED_CONCLUSION");
  const spanPrompt = buildAiPrompt(spanRequest.prompt, new SemanticRedactor(), "0123456789abcdef");
  check(
    "the earlier step's route keeps no canary, userinfo or query, and the prompt passes the residual rescan",
    spanPrompt.ok && !`${spanPrompt.system}\n${spanPrompt.user}`.toUpperCase().includes(ERROR_CANARY) && !spanPrompt.user.includes("token="),
    spanPrompt.ok ? "" : JSON.stringify(spanPrompt)
  );
  check(
    "a step label is product text: nothing between the brackets but the four labels",
    (spanRequest.prompt.fields[0].text ?? "")
      .split("\n")
      .filter((line) => /^ev\d+: /.test(line))
      .every((line) => /^ev\d+: \S+ \((?:error|warning|info)\) at \d+ms \[(?:during the failed step|during an earlier step|after the failed step|step unknown)\] /.test(line))
  );

  // Under a tight budget the failed step outranks what came after it, which "closest to the failure" alone put first.
  const tight = buildFailureAnalysisRequest(
    { signature: failureSignature(spans), instanceIds: [spans.instanceId], count: 1, representative: spans, analyse: true },
    { ...FAILURE_ANALYSIS_LIMITS, maxEvidencePerAnalysis: 3 }
  )!;
  check(
    "(precondition) the baseline cites the failed step's page error and the runner's record, not the later 500",
    spans.baseline.evidenceIds[0] === inStep && spans.baseline.evidenceIds.includes(runnerId) && !spans.baseline.evidenceIds.includes(after)
  );
  check(
    "with room for one more event, the earlier step's is offered over the later, closer one",
    tight.evidence.some((event) => event.id === earlier) && !tight.evidence.some((event) => event.id === after),
    JSON.stringify(tight.evidence.map((event) => event.id))
  );

  // One step only: nothing to say, so the request is exactly what it was before relevance existed.
  const oneStep = stepped(
    [
      { at: 300, step: 6, source: "http.error", payload: { method: "GET", url: "https://shop.example/api/recommendations", status: 503, resourceType: "fetch" } },
      { at: 1_400, step: 6, source: "page.error", payload: { name: "TypeError", message: "Cannot read properties of null" } },
      { at: 1_900, step: 6, source: "runner.failure", payload: { kind: "assertion", message: "The address saved banner did not appear." } }
    ],
    300
  );
  const oneStepRequest = requestFor(oneStep);
  check("ambiguous: two errors in the failed step are both failed-step events", Object.values(oneStepRequest.stepRelations).every((relation) => relation === "failedStep"));
  check("...both stay primary candidates: provenance cannot choose between them, so the request does not", primaryEnum(oneStepRequest).length === 2);
  check("...and no line carries a step label, so a one-step prompt is unchanged", !(oneStepRequest.prompt.fields[0].text ?? "").includes("["), oneStepRequest.prompt.fields[0].text);

  // No step stamp (a report written before steps were stamped): unknown, and nothing is excluded.
  const unstamped = stepped(
    [
      { at: 300, step: undefined, source: "http.error", payload: { method: "GET", url: "https://shop.example/api/recommendations", status: 503, resourceType: "fetch" } },
      { at: 1_900, step: undefined, source: "runner.failure", payload: { kind: "assertion", message: "The banner did not appear." } }
    ],
    300
  );
  const unstampedRequest = requestFor(unstamped);
  check(
    "missing context: an unstamped event is unknown, never excluded, and no label is shown",
    Object.values(unstampedRequest.stepRelations).every((relation) => relation === "unknown") &&
      primaryEnum(unstampedRequest).length === 1 &&
      !(unstampedRequest.prompt.fields[0].text ?? "").includes("[")
  );
  const runnerUnstamped = stepped(
    [
      { at: 300, step: 5, source: "http.error", payload: { method: "GET", url: "https://shop.example/api/recommendations", status: 503, resourceType: "fetch" } },
      { at: 1_900, step: undefined, source: "runner.failure", payload: { kind: "assertion", message: "The banner did not appear." } }
    ],
    300
  );
  check("...and with no step on the failure record, every relation is unknown", [...stepRelations(runnerUnstamped).values()].every((relation) => relation === "unknown"));

  // Everything but the runner's record came after the failed step: nothing can be the cause.
  const onlyAfter = stepped(
    [
      { at: 1_900, step: 6, source: "runner.failure", payload: { kind: "assertion", message: "The banner did not appear." } },
      { at: 2_600, step: 7, source: "http.error", payload: { method: "POST", url: "https://shop.example/api/audit/errors", status: 500, resourceType: "fetch" } }
    ],
    1_000
  );
  const onlyAfterRequest = requestFor(onlyAfter);
  check("(precondition) the baseline does not rest on the later event", onlyAfter.baseline.cause === "assertionFailed", onlyAfter.baseline.cause);
  check("insufficient: with only after-failure evidence beside the runner's record, declining is the only decodable answer", !onlyAfterRequest.mustConclude && ((onlyAfterRequest.schema as ObjectSchema).properties.conclusion as ArraySchema).maxItems === 0);
  const declined = parseFailureAnalysis({ version: 1, conclusion: [] }, onlyAfterRequest);
  check("...a decline is accepted as insufficient", declined.ok && declined.insufficient);
  const forced = parseFailureAnalysis(conclusionOn([idOf(onlyAfter, "http.error", 2_600)]), onlyAfterRequest);
  check("...and a conclusion on the later event is refused as unsupported", !forced.ok && forced.code === "UNSUPPORTED_CONCLUSION", JSON.stringify(forced));
}

// ── 13. Request provenance: what the runner observed of each request ──────────────────────────
console.log("\n13 — request provenance: the runner's own record of each request, never co-occurrence");
{
  type Spec = {
    name: string;
    at: number;
    step?: number;
    source: "http.error" | "network.failed" | "runner.failure";
    payload: Record<string, string | number>;
    frame?: "main" | "child";
    request?: RequestProvenance;
  };
  /**
   * Through the real buffer and baseline, as the collector writes them: step stamp, page, frame, provenance.
   * The baseline is the one a report written between 3699617f and the baseline reading provenance stores:
   * provenance recorded, the cause derived without it. That is the case where selection alone must offer
   * the step's own request; the current baseline cites it itself (checked below).
   */
  const built = (specs: Spec[], stepStartOffsetMs: number) => {
    let clock = 0;
    const buffer = new EvidenceBuffer({ executionId: "exec-requests", instanceId: "i-requests" }, new EvidenceRunBudget(), { redactor: new SemanticRedactor(), now: () => clock });
    const ids = new Map<string, string>();
    for (const spec of specs) {
      clock = spec.at;
      const stored = buffer.add({
        source: spec.source,
        severity: "error",
        payload: spec.payload,
        context: { flowId: "flow-requests", nodeId: `n-${spec.step ?? "x"}`, pageId: "p1", ...(spec.step === undefined ? {} : { stepIndex: spec.step }), ...(spec.frame ? { frame: spec.frame } : {}) },
        ...(spec.request ? { request: spec.request } : {})
      });
      if (stored) ids.set(spec.name, stored.id);
    }
    const all = [...buffer.list()];
    const runner = [...all].reverse().find((event) => event.source === "runner.failure");
    const failedAt = specs.find((spec) => spec.source === "runner.failure")?.at ?? 0;
    const failure = { kind: "assertion" as const, stepStartOffsetMs, failedAtOffsetMs: failedAt, ...(runner ? { evidenceId: runner.id } : {}) };
    const baseline = deriveFailureCause(withoutProvenance(all), failure);
    const entry: FailureBatchEntry = { instanceId: "i-requests", flowId: "flow-requests", nodeId: "n-6", stepIndex: 6, baseline, events: all };
    return { entry, id: (name: string) => ids.get(name) ?? `missing:${name}`, current: deriveFailureCause(all, failure) };
  };
  const http = (path: string, status: number) => ({ method: "GET", url: `https://shop.example${path}`, status, resourceType: "fetch" });
  const issued = (id: string, at: number, step: number, link?: { link: "navigation" | "responseWait"; linkStepIndex: number }): RequestProvenance => ({
    id,
    redirects: 0,
    issuedAtOffsetMs: at,
    issuedStepIndex: step,
    ...link
  });
  // Step 6 fails on page p1's main frame. Five errors from elsewhere come first, so the baseline cites them
  // and not the step's own request; the save is the one the step waited for.
  const specs: Spec[] = [
    { name: "moved", at: 300, step: 4, source: "http.error", payload: http("/api/moved", 500), frame: "main", request: issued("rq1", 250, 4, { link: "responseWait", linkStepIndex: 4 }) },
    { name: "heartbeat", at: 900, step: 6, source: "http.error", payload: http("/api/heartbeat", 503), frame: "main", request: issued("rq2", 880, 6) },
    { name: "widget", at: 1_000, step: 6, source: "http.error", payload: http("/api/widget", 500), frame: "child", request: issued("rq3", 950, 6) },
    { name: "inventory", at: 1_100, step: 6, source: "http.error", payload: http("/api/inventory", 502), frame: "main", request: issued("rq4", 400, 5) },
    // One request, answered with a 500 and then cut off: one identity, issued in step 5.
    { name: "exportHttp", at: 1_150, step: 6, source: "http.error", payload: http("/api/export", 500), frame: "main", request: issued("rq5", 420, 5) },
    { name: "exportNet", at: 1_160, step: 6, source: "network.failed", payload: { method: "GET", url: "https://shop.example/api/export", failure: "net::ERR_CONTENT_LENGTH_MISMATCH", resourceType: "fetch" }, frame: "main", request: issued("rq5", 420, 5) },
    { name: "save", at: 1_200, step: 6, source: "http.error", payload: http("/api/save", 500), frame: "main", request: issued("rq6", 1_190, 6, { link: "responseWait", linkStepIndex: 6 }) },
    // Its start was never seen (a page that loaded before the collector attached): unknown, never guessed.
    { name: "lookup", at: 1_300, step: 6, source: "http.error", payload: http("/api/lookup", 500), frame: "main", request: { id: "rq7", redirects: 0 } },
    { name: "runner", at: 2_000, step: 6, source: "runner.failure", payload: { kind: "assertion", message: "The saved banner did not appear." }, frame: "main" },
    // Issued after the failure was recorded, though still stamped with the failed step.
    { name: "late", at: 2_100, step: 6, source: "http.error", payload: http("/api/audit", 500), frame: "main", request: issued("rq8", 2_050, 6) }
  ];
  const { entry, id, current } = built(specs, 800);
  const roomy = { ...FAILURE_ANALYSIS_LIMITS, maxEvidenceChars: 10_000, maxDataChars: 12_000 };
  const build = (of: FailureBatchEntry, limits = roomy) =>
    buildFailureAnalysisRequest({ signature: failureSignature(of), instanceIds: [of.instanceId], count: 1, representative: of, analyse: true }, limits)!;
  const request = build(entry);
  const lineOf = (of: FailureAnalysisRequest, eventId: string) => (of.prompt.fields[0].text ?? "").split("\n").find((line) => line.startsWith(`${eventId}: `)) ?? "";
  const labelOf = (of: FailureAnalysisRequest, name: string) => /\[([^\]]+)\]/.exec(lineOf(of, id(name)))?.[1];
  const primaryEnum = (of: FailureAnalysisRequest) =>
    ((((of.schema as ObjectSchema).properties.conclusion as ArraySchema).items as ObjectSchema).properties.primaryEvidenceIds as ArraySchema).items as { enum: readonly string[] };
  const conclusionOn = (primary: string[], secondary: string[] = []) => ({
    version: 1,
    conclusion: [{ primaryEvidenceIds: primary, secondaryEvidenceIds: secondary, category: "save failed", explanation: "The save the step waited for answered 500.", investigationSteps: [] }]
  });

  check("(precondition) every event is offered and the runner record is the failed step's", request.evidence.length === specs.length && request.stepRelations[id("runner")] === "failedStep");
  check(
    "(precondition) the baseline cites the five earlier errors and the runner record, not the step's own request",
    entry.baseline.evidenceIds.length === 6 && !entry.baseline.evidenceIds.includes(id("save")) && entry.baseline.evidenceIds[0] === id("heartbeat"),
    JSON.stringify(entry.baseline.evidenceIds)
  );
  check(
    "the current baseline, reading the same provenance, rests on the step's own request and keeps the five as context, never the after-failure one",
    JSON.stringify(current.evidenceIds) === JSON.stringify([id("save"), id("heartbeat"), id("widget"), id("inventory"), id("exportHttp"), id("runner")]),
    JSON.stringify(current.evidenceIds)
  );
  const sorted = (relations: Record<string, string>) => JSON.stringify(Object.entries(relations).sort(([a], [b]) => a.localeCompare(b)));
  check(
    "the request carries each request event's runtime relation, and none for the runner's own record",
    sorted(request.requestRelations) ===
      sorted({
        [id("moved")]: "linkedToOtherStep",
        [id("heartbeat")]: "duringFailedStep",
        [id("widget")]: "offTargetDuringFailedStep",
        [id("inventory")]: "issuedBeforeFailedStep",
        [id("exportHttp")]: "issuedBeforeFailedStep",
        [id("exportNet")]: "issuedBeforeFailedStep",
        [id("save")]: "linkedToFailedStep",
        [id("lookup")]: "unknown",
        [id("late")]: "issuedAfterFailure"
      }),
    JSON.stringify(request.requestRelations)
  );
  const expectedLabels: Record<string, string> = {
    save: "the failed step waited for this request",
    heartbeat: "requested during the failed step, not linked to it",
    widget: "requested during the failed step by another page or frame",
    inventory: "requested before the failed step began",
    exportHttp: "requested before the failed step began",
    exportNet: "requested before the failed step began",
    moved: "an earlier step waited for this request",
    late: "requested after the failure",
    lookup: "during the failed step",
    runner: "during the failed step"
  };
  const actualLabels = Object.fromEntries(Object.keys(expectedLabels).map((name) => [name, labelOf(request, name)]));
  check("a confirmed link is stated: the save line says the failed step waited for it", actualLabels.save === expectedLabels.save, lineOf(request, id("save")));
  check(
    "unrelated activity is never promoted: only the step's own request is stated as the step's, background and off-target requests say they are not linked",
    actualLabels.heartbeat === expectedLabels.heartbeat &&
      actualLabels.widget === expectedLabels.widget &&
      (request.prompt.fields[0].text ?? "").split("\n").filter((line) => line.includes("[the failed step")).length === 1,
    JSON.stringify(actualLabels)
  );
  check(
    "an earlier-issued request answered during the failed step is stated as requested before it, where its step stamp alone says the failed step",
    actualLabels.inventory === expectedLabels.inventory && request.stepRelations[id("inventory")] === "failedStep",
    JSON.stringify({ label: actualLabels.inventory, step: request.stepRelations[id("inventory")] })
  );
  check("an earlier step's own request is stated as that step's, never the failed step's", actualLabels.moved === expectedLabels.moved, lineOf(request, id("moved")));
  check(
    "one request identity across its response and its transfer failure: both events carry the same relation and say the same",
    request.requestRelations[id("exportHttp")] === request.requestRelations[id("exportNet")] && actualLabels.exportHttp === expectedLabels.exportHttp && actualLabels.exportNet === expectedLabels.exportNet,
    JSON.stringify({ http: actualLabels.exportHttp, net: actualLabels.exportNet })
  );
  check(
    "unknown provenance is never stated as confirmed: the unobserved request falls back to its step stamp",
    actualLabels.lookup === expectedLabels.lookup && request.requestRelations[id("lookup")] === "unknown",
    lineOf(request, id("lookup"))
  );
  check("every line states its relation exactly as the product words it", JSON.stringify(actualLabels) === JSON.stringify(expectedLabels), JSON.stringify(actualLabels));
  check(
    "where a request's provenance is stated, the instructions say what a link is and that timing alone is not one",
    request.prompt.instructions.includes("one the failed step waited for or navigated to is that step's own request") && request.prompt.instructions.includes("that timing alone does not make it the step's")
  );

  check(
    "the grammar never rests a conclusion on a request issued after the failure, though its step stamp is the failed step",
    !primaryEnum(request).enum.includes(id("late")) && !primaryEnum(request).enum.includes(id("runner")),
    JSON.stringify(primaryEnum(request).enum)
  );
  check(
    "...while every other request stays a candidate: the step's own, the uncertain ones, the off-target one, the earlier ones (a precondition) and the unknown one",
    ["save", "heartbeat", "widget", "inventory", "exportHttp", "exportNet", "moved", "lookup"].every((name) => primaryEnum(request).enum.includes(id(name))),
    JSON.stringify(primaryEnum(request).enum)
  );
  const onLate = parseFailureAnalysis(conclusionOn([id("late")]), request);
  check("a conclusion resting on a request issued after the failure is refused as unsupported", !onLate.ok && onLate.code === "UNSUPPORTED_CONCLUSION", JSON.stringify(onLate));
  check("...and the output contract refuses it before the parser", validateAiOutput(conclusionOn([id("late")]), request.schema).length > 0);
  const lateAsConsequence = parseFailureAnalysis(conclusionOn([id("save")], [id("late")]), request);
  check("...it may still be cited as a consequence", lateAsConsequence.ok && !lateAsConsequence.insufficient, JSON.stringify(lateAsConsequence));
  for (const name of ["heartbeat", "inventory", "moved"]) {
    const accepted = parseFailureAnalysis(conclusionOn([id(name)]), request);
    check(`a conclusion on the ${name} request is accepted: provenance informs, it does not decide`, accepted.ok && !accepted.insufficient, JSON.stringify(accepted));
  }

  // Selection: room for one event past the baseline's six. The step's own request is offered, though an
  // unobserved request in the same step is closer to the failure, which is what decided before.
  const tight = build(entry, { ...roomy, maxEvidencePerAnalysis: 7 });
  const tightIds = tight.evidence.map((event) => event.id);
  check(
    "a confirmed link outranks the rest of the failed step: with room for one more event, the save is offered over the closer unobserved request",
    tightIds.includes(id("save")) && !tightIds.includes(id("lookup")) && !tightIds.includes(id("late")),
    JSON.stringify(tightIds)
  );

  // Legacy: the same failure as an older report stores it. Nothing is stated, carried or excluded from provenance.
  const legacyEntry: FailureBatchEntry = { ...entry, events: withoutProvenance(entry.events) };
  const legacy = build(legacyEntry);
  check(
    "an older report without provenance carries no request relation and states only steps",
    Object.keys(legacy.requestRelations).length === 0 &&
      (legacy.prompt.fields[0].text ?? "")
        .split("\n")
        .filter((line) => /^ev\d+: /.test(line))
        .every((line) => / \[(?:during the failed step|during an earlier step|after the failed step|step unknown)\] /.test(line)),
    legacy.prompt.fields[0].text
  );
  check("...its instructions are the ones every request without provenance gets", !legacy.prompt.instructions.includes("A request line may say") && request.prompt.instructions.startsWith(legacy.prompt.instructions));
  check("...and the late request, now only stamped with the failed step, is a candidate again: nothing is inferred", primaryEnum(legacy).enum.includes(id("late")));

  // Every request unobserved: nothing is stated, and a one-step failure is sent exactly as before provenance existed.
  const unobserved = built(
    [
      { name: "lookup", at: 1_300, step: 6, source: "http.error", payload: http("/api/lookup", 500), frame: "main", request: { id: "rq1", redirects: 0 } },
      { name: "runner", at: 2_000, step: 6, source: "runner.failure", payload: { kind: "assertion", message: "The saved banner did not appear." }, frame: "main" }
    ],
    800
  );
  const unobservedRequest = build(unobserved.entry);
  check(
    "with only unobserved requests, no line carries a label and the instructions are unchanged",
    !(unobservedRequest.prompt.fields[0].text ?? "").includes("[") && !unobservedRequest.prompt.instructions.includes("A request line may say") && unobservedRequest.requestRelations[unobserved.id("lookup")] === "unknown",
    unobservedRequest.prompt.fields[0].text
  );
  const unstampedRunner = built(
    specs.map((spec) => (spec.source === "runner.failure" ? { ...spec, step: undefined } : spec)),
    800
  );
  check(
    "a failure record without a step makes every request relation unknown, so none is stated or excluded",
    Object.values(build(unstampedRunner.entry).requestRelations).every((relation) => relation === "unknown") && primaryEnum(build(unstampedRunner.entry)).enum.includes(unstampedRunner.id("late"))
  );
}

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
// No direct cause: a timeout with a console error beside it (the model may decline), and a bare one (it may only).
const consoleTimeout = runnerOnly("run-f", "n-console-main", ["Uncaught TypeError: the payment widget failed to load"]);
const bareTimeout = runnerOnly("run-g", "n-quiet-main");
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
    ...[sameA, sameB, sameC, different, insufficientEntry, ...crowd, lastSignature, consoleTimeout, bareTimeout].map(asInstance),
    { instanceId: "run-passed", status: "passed", durationMs: 900, screenshots: [], downloadedFiles: [] }
  ],
  runtimeInputs: {}
};
const auto = coalesceFailures(failureBatch(storedRun));
check("(precondition) the automatic batch would NOT analyse run-z's signature", auto.groups.find((g) => g.instanceIds.includes("run-z"))?.analyse === false);
// A REAL report store in a temp folder: saving goes through the production folder lane, `updateWith`
// and the atomic replace, exactly as `ai.ipc.ts` wires it.
type StoredRun = ConcurrentRunReport & { id: string };
const reportStore = new JsonProfileStore<StoredRun>({ folder: join(work, "reports") });
const seedJson = JSON.stringify({ ...storedRun, id: storedRun.executionId });
await reportStore.create(JSON.parse(seedJson));
const reportAccess: FailureReportAccess = {
  report: (id) => reportStore.get(id),
  updateReport: (id, change) =>
    reportStore.updateWith(id, (current) => {
      const next = change(current);
      return next && { ...next, id };
    })
};
const reportDeps = (service: AiService, policy: AiPolicyConfig = POLICY): FailureAssistDeps => ({
  submit: (job) => service.submit(job),
  policy: async () => policy,
  ...reportAccess
});
const citing = (ids: string[]) =>
  JSON.stringify({
    version: 1,
    conclusion: [{ primaryEvidenceIds: ids, secondaryEvidenceIds: [], category: "server error", explanation: "The submit request returned 500.", investigationSteps: ["Check the order service logs."] }]
  });
const DECLINE = JSON.stringify({ version: 1, conclusion: [] });
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

const guess = harness([
  JSON.stringify({ version: 1, conclusion: [{ primaryEvidenceIds: [], secondaryEvidenceIds: [], category: "guess", explanation: "MODEL-GUESS-TEXT", investigationSteps: [] }] })
]);
const guessView = await analyzeFailure(4, { requestId: "ui-12", executionId: "exec-main", instanceId: "run-a" }, reportDeps(guess.service));
check("a conclusion citing no evidence is OUTPUT_REJECTED", guessView.code === "OUTPUT_REJECTED" && guessView.analysis === null, JSON.stringify(guessView));
check("...and none of its text reaches the renderer", !JSON.stringify(guessView).includes("MODEL-GUESS-TEXT"));
await guess.service.shutdown();

// The shape every real v1 answer on Qwen3.5-0.8B took (2026-09-22): declined, then concluded anyway.
const v1Answer = JSON.stringify({ version: 1, insufficient: true, category: "server error", explanation: "V1-BOTH-HALVES", primaryEvidenceIds: [primaryOf(sameA)], secondaryEvidenceIds: [], investigationSteps: ["Check it."] });
const both = harness([v1Answer]);
const bothView = await analyzeFailure(4, { requestId: "ui-12b", executionId: "exec-main", instanceId: "run-a" }, reportDeps(both.service));
check("an answer that declines AND concludes is OUTPUT_REJECTED — neither half is shown", bothView.code === "OUTPUT_REJECTED" && bothView.analysis === null, JSON.stringify(bothView));
check("...and none of its text reaches the renderer", !JSON.stringify(bothView).includes("V1-BOTH-HALVES"));
await both.service.shutdown();

const unknownCite = harness([citing(["ev-999"])]);
check("citing evidence the run did not capture is OUTPUT_REJECTED", (await analyzeFailure(4, { requestId: "ui-13", executionId: "exec-main", instanceId: "run-a" }, reportDeps(unknownCite.service))).code === "OUTPUT_REJECTED");
await unknownCite.service.shutdown();

const declines = harness([DECLINE]);
const declineView = await analyzeFailure(4, { requestId: "ui-14", executionId: "exec-main", instanceId: "run-f" }, reportDeps(declines.service));
check("'insufficient' is a first-class answer where the cause is not direct, shown as such", declineView.ok && declineView.analysis?.insufficient === true, JSON.stringify(declineView));
check(
  "...with no cause, citation or step beside it",
  declineView.analysis?.category === "" && declineView.analysis.explanation === "" && declineView.analysis.primaryEvidenceIds.length === 0 && declineView.analysis.investigationSteps.length === 0
);
await declines.service.shutdown();

const beside = harness([DECLINE]);
const besideView = await analyzeFailure(4, { requestId: "ui-14b", executionId: "exec-main", instanceId: "run-a" }, reportDeps(beside.service));
check("declining beside the report's own DIRECT cause is OUTPUT_REJECTED, never shown", besideView.code === "OUTPUT_REJECTED" && besideView.analysis === null, JSON.stringify(besideView));
await beside.service.shutdown();

// What Qwen3.5-0.8B wrote for a bare timeout: its own failure record, cited as its cause.
const circular = harness([citing([primaryOf(bareTimeout)])]);
check("(precondition) a bare timeout's baseline cites only the runner's own record", bareTimeout.baseline.evidenceIds.length === 1 && bareTimeout.events.length === 1);
const circularView = await analyzeFailure(4, { requestId: "ui-14c", executionId: "exec-main", instanceId: "run-g" }, reportDeps(circular.service));
check("a bare timeout 'explained' by its own failure record is OUTPUT_REJECTED", circularView.code === "OUTPUT_REJECTED" && circularView.analysis === null, JSON.stringify(circularView));
await circular.service.shutdown();
const bareDecline = harness([DECLINE]);
const bareView = await analyzeFailure(4, { requestId: "ui-14d", executionId: "exec-main", instanceId: "run-g" }, reportDeps(bareDecline.service));
check("...and answered insufficient, which is the only answer its grammar allows", bareView.ok && bareView.analysis?.insufficient === true, JSON.stringify(bareView));
await bareDecline.service.shutdown();

// ── Persistence: the optional run-report `diagnostics` extension ────────────────────────────────
// DECISIONS 2026-09-19: analyses live and die with their run report, and are deletable and
// recomputable; every stored AI artifact is redacted and rescanned first.
console.log("\nmain — the analysis is saved with its run report, deletable and recomputable");
const exec = storedRun.executionId;
const reseed = () => reportStore.update(exec, JSON.parse(seedJson));
const readBack = async () => (await reportStore.get(exec))!;
const analysesOnDisk = async () => (await readBack()).diagnostics?.analyses ?? [];
const withoutExtension = (report: ConcurrentRunReport) => {
  const { diagnostics: _extension, ...rest } = report;
  return JSON.stringify(rest);
};
const ask = async (answer: string, instanceId: string, requestId: string, deps?: (service: AiService) => FailureAssistDeps) => {
  const run = harness([answer]);
  const result = await analyzeFailure(4, { requestId, executionId: exec, instanceId }, (deps ?? reportDeps)(run.service));
  await run.service.shutdown();
  return result;
};
await reseed();
check("(precondition) the reseeded report carries no saved analysis", (await analysesOnDisk()).length === 0);

const savedView = await ask(citing([primaryOf(sameB)]), "run-b", "p-1");
let onDisk = await analysesOnDisk();
check("a successful answer is saved with the run's report", savedView.ok && savedView.stored === true && onDisk.length === 1, JSON.stringify(savedView).slice(0, 300));
check("...keyed by its coalescing signature, naming the instance analysed", onDisk[0]?.signature === failureSignature(sameB) && onDisk[0]?.instanceId === "run-b");
check("...with a coalesced reference for each instance that failed the same way", JSON.stringify([...(onDisk[0]?.instanceIds ?? [])].sort()) === JSON.stringify(["run-a", "run-b", "run-c"]), JSON.stringify(onDisk[0]?.instanceIds));
check("...holding exactly what the renderer was shown", JSON.stringify(onDisk[0]?.analysis) === JSON.stringify(savedView.analysis));
check("...with the model that wrote it and when", onDisk[0]?.modelId === "fake-l5b-model" && !Number.isNaN(Date.parse(onDisk[0]?.createdAt ?? "")));
check("the run's evidence and baselines are untouched: only the extension was added", withoutExtension(await readBack()) === withoutExtension(JSON.parse(seedJson)));
check("a coalesced member reads the saved analysis through its reference", storedFailureAnalysisFor(await readBack(), "run-a")?.instanceId === "run-b");
check("...and a different failure does not", storedFailureAnalysisFor(await readBack(), "run-d") === null);

const askedAgain = JSON.stringify({
  version: 1,
  conclusion: [{ primaryEvidenceIds: [primaryOf(sameA)], secondaryEvidenceIds: [], category: "server error", explanation: "Asked again for run-a.", investigationSteps: [] }]
});
await ask(askedAgain, "run-a", "p-2");
onDisk = await analysesOnDisk();
check(
  "asking again replaces the saved analysis rather than adding one",
  onDisk.length === 1 && onDisk[0]?.instanceId === "run-a" && onDisk[0]?.analysis.explanation === "Asked again for run-a.",
  JSON.stringify(onDisk).slice(0, 300)
);
await ask(citing([primaryOf(different)]), "run-d", "p-3");
check("a different signature is saved beside it", (await analysesOnDisk()).length === 2);

const beforeRefusal = JSON.stringify(await readBack());
check("(precondition) an answer citing uncaptured evidence is refused", (await ask(citing(["ev-999"]), "run-a", "p-4")).code === "OUTPUT_REJECTED");
check("...and leaves the saved analyses exactly as they were", JSON.stringify(await readBack()) === beforeRefusal);

// Redaction. The e-mail and the 7-digit id are what SemanticRedactor removes; a PEM private-key
// header is a shape it leaves (no rule names it) and only the independent rescan catches. Single
// line on purpose: the parser refuses control characters, a newline included, before the rescan.
// (`password: {…}` served here until 2026-09-21, when the redactor learned to remove it.)
const leak = (text: string) =>
  JSON.stringify({ version: 1, conclusion: [{ primaryEvidenceIds: [primaryOf(sameB)], secondaryEvidenceIds: [], category: "server error", explanation: text, investigationSteps: [text] }] });
const leakyView = await ask(leak("Order 4001123 for ops@shop.example failed."), "run-b", "p-5");
const leakyStored = storedFailureAnalysisFor(await readBack(), "run-b");
check("an e-mail or long id in the answer is redacted before it is shown", leakyView.ok && !/ops@shop|4001123/.test(JSON.stringify(leakyView)), JSON.stringify(leakyView.analysis));
check("...and before it is stored", Boolean(leakyStored?.analysis.explanation.includes("[redacted]")) && !/ops@shop|4001123/.test(JSON.stringify(leakyStored)), JSON.stringify(leakyStored?.analysis));
const pemHeader = "-----BEGIN RSA PRIVATE KEY-----";
check("(precondition) the redactor really leaves a PEM header", new SemanticRedactor().redactText(pemHeader).includes("PRIVATE KEY"));
const beforeResidual = JSON.stringify(await readBack());
const residualView = await ask(leak(`The page printed ${pemHeader} in an error.`), "run-b", "p-6");
check("an answer the rescan still flags is refused", residualView.code === "OUTPUT_REJECTED" && residualView.analysis === null, JSON.stringify(residualView));
check("...none of its text reaches the renderer", !JSON.stringify(residualView).includes("PRIVATE KEY"));
check("...and nothing of it is stored", JSON.stringify(await readBack()) === beforeResidual);
check("(pure) a clean answer passes the rescan", redactFailureAnalysis({ insufficient: true, category: "", explanation: "", primaryEvidenceIds: [], secondaryEvidenceIds: [], investigationSteps: [] }, new SemanticRedactor()) !== null);

// A report deleted while the model was answering must not come back.
const vanishing: (service: AiService) => FailureAssistDeps = (service) => ({
  ...reportDeps(service),
  report: async (id) => {
    const report = await reportStore.get(id);
    await reportStore.delete(id);
    return report;
  }
});
const lateView = await ask(citing([primaryOf(sameB)]), "run-b", "p-7", vanishing);
check("an answer for a report deleted meanwhile is still shown", lateView.ok && lateView.analysis !== null, JSON.stringify(lateView).slice(0, 200));
check("...says it was not saved", lateView.stored === false);
check("...and does NOT resurrect the deleted report", (await reportStore.get(exec)) === null);
await reportStore.import(JSON.parse(seedJson));

// Delete. Needs no policy: it must work with AI switched off, and its deps carry none.
await ask(citing([primaryOf(sameB)]), "run-b", "p-8");
await ask(citing([primaryOf(different)]), "run-d", "p-9");
check("(precondition) two analyses are saved", (await analysesOnDisk()).length === 2);
const byMember = await deleteFailureAnalysis({ executionId: exec, instanceId: "run-c" }, reportAccess);
onDisk = await analysesOnDisk();
check("deleting through a coalesced member removes the shared analysis", byMember.ok && onDisk.length === 1 && onDisk[0]?.instanceId === "run-d", JSON.stringify(byMember));
check("...and deleting it again is NOT_FOUND", (await deleteFailureAnalysis({ executionId: exec, instanceId: "run-b" }, reportAccess)).code === "NOT_FOUND");
check("deleting the last one restores the report the run wrote, byte for byte", (await deleteFailureAnalysis({ executionId: exec, instanceId: "run-d" }, reportAccess)).ok && JSON.stringify(await readBack()) === seedJson);
check("a malformed target is INVALID_REQUEST", (await deleteFailureAnalysis({ executionId: "../x", instanceId: "run-a" }, reportAccess)).code === "INVALID_REQUEST");
check("a missing report is NOT_FOUND, and is not created", (await deleteFailureAnalysis({ executionId: "exec-gone", instanceId: "run-a" }, reportAccess)).code === "NOT_FOUND" && (await reportStore.get("exec-gone")) === null);
const withFuture = { ...storedRun, diagnostics: { analyses: [{ ...onDisk[0]!, instanceIds: ["run-d"] }], futureField: 7 } } as unknown as ConcurrentRunReport;
check("an unknown extension field survives deleting the last analysis", JSON.stringify(withoutStoredFailureAnalysis(withFuture, "run-d")?.diagnostics) === JSON.stringify({ futureField: 7 }));
check("a malformed saved entry reads as none", storedFailureAnalysisFor({ diagnostics: { analyses: [{ ...onDisk[0]!, analysis: { insufficient: "no" } }] } }, "run-d") === null);

// ── A report written before L5a's rescan (80a135fe) ─────────────────────────────────────────────
// Such a report can hold evidence text the redactor left, and nothing re-sanitizes stored evidence,
// so the prompt's own rescan is the one layer left: the model must never see it. Its summary has no
// `residualSecrets`, and a clean report of that shape must still be analysed normally.
console.log("\nmain — a report written before the evidence rescan");
const legacyText = `config dump ${pemHeader} failed`;
const today = new EvidenceBuffer({ executionId: "exec-today", instanceId: "i" }, new EvidenceRunBudget());
check("(precondition) today's buffer would store that text as the redaction marker", today.add({ source: "console.error", severity: "error", payload: { message: legacyText } })?.payload.message === REDACTED);
const legacyEntry = instanceFailure({ instanceId: "run-legacy", nodeId: "n-legacy", stepIndex: 2, url: ROW_URL(40), status: 500, extra: [{ source: "console.error", payload: { message: "config dump failed" } }] });
const leakedEvents = legacyEntry.events.map((event) => (event.payload.message === "config dump failed" ? { ...event, payload: { ...event.payload, message: legacyText } } : event));
const legacyJob = buildFailureAnalysisRequest({ signature: failureSignature(legacyEntry), instanceIds: ["run-legacy"], count: 1, representative: { ...legacyEntry, events: leakedEvents }, analyse: true });
check("(precondition) the header is in the evidence the request offers the model", Boolean(legacyJob?.prompt.fields.some((field) => field.text?.includes("PRIVATE KEY"))));
const legacyPrompt = legacyJob && buildAiPrompt(legacyJob.prompt, new SemanticRedactor(), "0123456789abcdef");
check("(precondition) it survives the prompt's redactor, so only the rescan refuses it", legacyPrompt?.ok === false && legacyPrompt.code === "RESIDUAL_SECRET", JSON.stringify(legacyPrompt).slice(0, 200));
const legacyReport = async (executionId: string, evidence: ExecutionEvidenceEvent[]): Promise<string> => {
  const report: ConcurrentRunReport = {
    ...storedRun,
    executionId,
    instances: [
      {
        ...asInstance(legacyEntry),
        diagnostics: {
          schemaVersion: INSTANCE_DIAGNOSTICS_SCHEMA_VERSION,
          evidence,
          // The summary exactly as a pre-rescan buffer wrote it: no `residualSecrets`.
          summary: { accepted: evidence.length, repeats: 0, truncatedEvents: 0, dropped: { perSource: 0, perInstance: 0, instanceBytes: 0, runBytes: 0, eventBytes: 0, protected: 0 }, bytes: 0 },
          cause: legacyEntry.baseline
        }
      }
    ]
  };
  await reportStore.create({ ...report, id: executionId });
  return JSON.stringify(await reportStore.get(executionId));
};
const legacyAnswer = citing([primaryOf(legacyEntry)]);

const cleanBefore = await legacyReport("exec-legacy-clean", [...legacyEntry.events]);
const cleanHost = harness([legacyAnswer]);
const cleanView = await analyzeFailure(4, { requestId: "legacy-1", executionId: "exec-legacy-clean", instanceId: "run-legacy" }, reportDeps(cleanHost.service));
check("a clean report without summary.residualSecrets is analysed and saved as before", cleanView.ok && cleanView.stored === true && cleanHost.fake.inferRequests().length === 1, JSON.stringify(cleanView).slice(0, 200));
check("...its evidence left as the run wrote it", withoutExtension((await reportStore.get("exec-legacy-clean"))!) === withoutExtension(JSON.parse(cleanBefore)));
await cleanHost.service.shutdown();

const leakedBefore = await legacyReport("exec-legacy", leakedEvents);
const leakedHost = harness([legacyAnswer]);
const leakedView = await analyzeFailure(4, { requestId: "legacy-2", executionId: "exec-legacy", instanceId: "run-legacy" }, reportDeps(leakedHost.service));
check("stored evidence the rescan flags is refused before the model", leakedView.code === "FAILED" && leakedView.analysis === null, JSON.stringify(leakedView));
check("...the model is never called", leakedHost.fake.inferRequests().length === 0, String(leakedHost.fake.inferRequests().length));
check("...none of the header reaches the renderer", !JSON.stringify(leakedView).includes("PRIVATE KEY"));
check("...and the report is left exactly as it was, with nothing saved", JSON.stringify(await reportStore.get("exec-legacy")) === leakedBefore);
await leakedHost.service.shutdown();

console.log("\nThe labelled set verify:ai-error-quality-live sends, and its judge");
{
  const asked: Array<{ labelled: (typeof ERROR_SET)[number]; row: number; lead: string; label: { cause: string[]; unrelated: string[] }; digest: string }> = [];
  const covered = new Set(ERROR_SET.flatMap((c) => c.covers));
  const items = [...L5_LABELLED_ITEMS, ...ANCHORING_ITEMS, ...PROVENANCE_ITEMS, ...REQUEST_PROVENANCE_ITEMS];
  check(
    "the set realises every item of L5's labelled set, the anchoring cases, the step-provenance cases and the request-provenance cases",
    items.every((item) => covered.has(item)) && covered.size === items.length,
    JSON.stringify([...covered])
  );
  for (const labelled of ERROR_SET) {
    const { report, labels } = buildCase(labelled);
    const stats = coalesceFailures(failureBatch(report)).stats;
    check(`${labelled.id}: the batch coalesces as labelled`, JSON.stringify(stats) === JSON.stringify(labelled.batch), JSON.stringify(stats));
    for (const row of labelled.ask) {
      const instance = report.instances[row];
      const cause = instance.diagnostics?.cause?.cause ?? null;
      check(`${labelled.id} row ${row + 1}: L5a's deterministic cause is ${labelled.baselineCause}`, cause === labelled.baselineCause, String(cause));
      const request = labelledRequestFor(report, instance.instanceId);
      check(`${labelled.id} row ${row + 1}: it ${labelled.expectsCall ? "earns" : "never earns"} a model call`, Boolean(request) === labelled.expectsCall);
      if (!request) continue;
      const label = labels.get(instance.instanceId)!;
      asked.push({
        labelled,
        row,
        lead: instance.diagnostics?.cause?.evidenceIds[0] ?? "",
        label,
        digest: createHash("sha256").update(JSON.stringify([request.prompt, request.schema])).digest("hex").slice(0, 16)
      });
      const offered = new Set(request.evidence.map((event) => event.id));
      // A row with no cause event must leave declining decodable, or its right answer could not be written.
      check(
        `${labelled.id} row ${row + 1}: every labelled event is offered, so the model can cite it or be judged for not doing so`,
        (label.cause.length > 0 || (label.unrelated.length > 0 && !request.mustConclude)) && [...label.cause, ...label.unrelated].every((id) => offered.has(id)),
        JSON.stringify({ label, offered: [...offered] })
      );
      if (labelled.captured) {
        // A capture's labels come from its request names: every name must still find its request.
        const named = Object.keys(labelled.captured.labels).every((name) => request.evidence.some((event) => String(event.payload.url ?? "").endsWith(`/api/provenance/${name}`)));
        check(`${labelled.id} row ${row + 1}: every labelled request of the capture is present, and it has a cause and an unrelated event`, named && label.cause.length > 0 && label.unrelated.length > 0, JSON.stringify(label));
        // The harness derives the capture's cause again (the report does not keep the failure record). It must
        // be the one the production collector stored at capture: under the current rule, or, for a capture made
        // before the baseline read provenance, under the legacy rule, which is the current one without it.
        const events = instance.diagnostics?.evidence ?? [];
        const stripped = withoutProvenance(events);
        const stored = JSON.stringify(capturedStoredCause(labelled.captured.key));
        const derived = [deriveFailureCause(events, capturedFailure(events)), deriveFailureCause(stripped, capturedFailure(stripped))].map((cause) => JSON.stringify(cause));
        check(`${labelled.id} row ${row + 1}: the cause derived from the capture's evidence is the one the production collector stored`, derived.includes(stored), JSON.stringify({ stored, derived }));
      }
      const prompt = buildAiPrompt(request.prompt, new SemanticRedactor(), "0123456789abcdef");
      check(`${labelled.id} row ${row + 1}: the canary never reaches the prompt`, prompt.ok && !`${prompt.system}\n${prompt.user}`.toUpperCase().includes(ERROR_CANARY));
      const lead = instance.diagnostics?.cause?.evidenceIds[0] ?? "";
      if (prompt.ok) {
        // Nothing in the prompt may present the baseline's pick as the answer: it is offered, but unnamed
        // (a direct cause's code; a runner cause's code is its own record's kind), and listed where its time
        // puts it, newest first, not where the baseline ranks it. Oldest first is the baseline's own rule,
        // and the real 0.8B echoed it just the same.
        const shownIds = prompt.user.split("\n").filter((line) => /^ev\d+: /.test(line)).map((line) => line.split(":")[0]);
        const offsetOf = new Map(request.evidence.map((event) => [event.id, event.offsetMs]));
        const inTimeOrder = shownIds.length === request.evidence.length && shownIds.every((id, index) => index === 0 || (offsetOf.get(shownIds[index - 1]) ?? -1) >= (offsetOf.get(id) ?? Infinity));
        const named = request.mustConclude && prompt.user.includes(String(labelled.baselineCause));
        check(
          `${labelled.id} row ${row + 1}: the baseline's pick is offered but not presented: newest first, no "rests on", no cause code`,
          offered.has(lead) && !named && !/rests on/i.test(`${prompt.system}\n${prompt.user}`) && inTimeOrder,
          JSON.stringify(shownIds)
        );
        // Provenance from the step stamp only: a case whose events all share the failed step sends the
        // prompt it sent before relevance existed; a provenance case states each line's step. A real-runner
        // case states each request's runtime relation, and its legacy control, stripped of it, states none.
        const provenanceCase = labelled.covers.some((item) => PROVENANCE_ITEMS.includes(item));
        const requestCase = labelled.captured !== undefined && !labelled.captured.legacy;
        const labelledLines = prompt.user.split("\n").filter((line) => /^ev\d+: /.test(line));
        const requestLabel = / \[(?:the failed step waited for this request|the failed step's own navigation|an earlier step waited for this request|an earlier step's own navigation|requested before the failed step began|requested during the failed step, not linked to it|requested during the failed step by another page or frame)\] /;
        const requestLines = labelledLines.filter((line) => request.requestRelations[line.split(":")[0]] !== undefined);
        check(
          requestCase
            ? `${labelled.id} row ${row + 1}: every request line states its runtime relation, and the instructions say what one means`
            : provenanceCase
              ? `${labelled.id} row ${row + 1}: every line states the step it was captured in`
              : `${labelled.id} row ${row + 1}: no line carries a request relation, and ${labelled.captured ? "only steps are stated" : "every event is from the failed step, so no line carries a step label"}`,
          requestCase
            ? requestLines.length >= 2 && requestLines.every((line) => requestLabel.test(line)) && request.prompt.instructions.includes("A request line may say")
            : provenanceCase
              ? labelledLines.every((line) => / \[during (?:the failed|an earlier) step\] /.test(line)) && labelledLines.some((line) => line.includes("[during an earlier step]"))
              : Object.keys(request.requestRelations).length === 0 &&
                  !request.prompt.instructions.includes("A request line may say") &&
                  (labelled.captured !== undefined ||
                    (Object.values(request.stepRelations).every((relation) => relation === "failedStep") &&
                      labelledLines.every((line) => !/ \[(?:during the failed step|during an earlier step|after the failed step|step unknown)\] /.test(line)))),
          JSON.stringify(labelledLines)
        );
      }
    }
  }
  // What each row shows the model (its prompt and schema, sha256), as the live gate last measured it at
  // e27e15bd. A change to the baseline may change what a report concludes; this says whether it changed
  // what the model sees, so a recorded live result is reused only for the request it measured.
  const MEASURED_REQUESTS: Record<string, string> = {
    "toast-timeout#1": "a9ec6de1d7fa5742",
    "native-validation#1": "d294a8b4542a771d",
    "conflict-and-validation#1": "835eba25194f4d80",
    "conflict-and-validation#2": "1e29ad6a1987c1ba",
    "server-error-rows#1": "92767199db093855",
    "transport-noise#1": "dbadd738c571ce32",
    "pageerror-timeout#1": "e0ed5fb483a689f0",
    "burst#1": "24d4332f002adfb7",
    "unrelated-server-error-first#1": "10e4f7240695de5e",
    "cause-then-unrelated-console#1": "132a303aa6711ff0",
    "timeout-unrelated-console#1": "06ed21fc4c772d3c",
    "earlier-step-unrelated-error#1": "98874e86dd0cc68b",
    "earlier-step-cause#1": "a1761b75edc930c8",
    "rq-linked-vs-background#1": "28504e2bdf7b5490",
    "rq-linked-earlier-step#1": "4764be4cf397680c",
    "rq-issued-before#1": "c68b785d5f37f914",
    "rq-off-target#1": "b95e9b691cbdc729",
    "rq-uncertain#1": "03219bb555d0c050",
    "rq-legacy#1": "201b75eae52614fc"
  };
  const requests = Object.fromEntries(asked.map((entry) => [`${entry.labelled.id}#${entry.row + 1}`, entry.digest]));
  check(
    `every one of the ${asked.length} asked rows sends the model the request the live gate measured at e27e15bd, byte for byte`,
    asked.length === 19 && JSON.stringify(requests) === JSON.stringify(MEASURED_REQUESTS),
    JSON.stringify(requests)
  );

  // The deterministic baseline on the rows the live gate judges, measured without a model by the judge's own
  // rule. Which rows it gets right is fixed here: a baseline that ignores a confirmed request link, or that
  // promotes unrelated activity, fails by name. Not a label: the labels are the set's, fixed before inference.
  const BASELINE_RIGHT: Record<string, boolean> = {
    "toast-timeout": true,
    "native-validation": true,
    "conflict-and-validation": true,
    "server-error-rows": true,
    "transport-noise": false,
    "pageerror-timeout": true,
    burst: true,
    "unrelated-server-error-first": false,
    "cause-then-unrelated-console": true,
    "timeout-unrelated-console": true,
    "earlier-step-unrelated-error": true,
    "earlier-step-cause": true,
    "rq-linked-vs-background": true,
    "rq-linked-earlier-step": true,
    "rq-issued-before": true,
    "rq-off-target": true,
    "rq-uncertain": true,
    // The same events as `rq-linked-vs-background` without provenance: nothing tells the heartbeat apart.
    "rq-legacy": false
  };
  for (const entry of asked) {
    const right = baselineCorrect(entry.lead, entry.label);
    check(`${entry.labelled.id} row ${entry.row + 1}: the baseline is ${BASELINE_RIGHT[entry.labelled.id] ? "right" : "wrong"}`, right === BASELINE_RIGHT[entry.labelled.id], `rests on ${entry.lead}`);
  }
  const inGroup = (items: readonly string[]) => (entry: (typeof asked)[number]) => entry.labelled.covers.some((item) => items.includes(item));
  const tally = (rows: typeof asked) =>
    `${rows.filter((entry) => baselineCorrect(entry.lead, entry.label)).length}/${rows.length} right, ` +
    `${rows.filter((entry) => entry.label.unrelated.includes(entry.lead)).length} false attribution(s), ` +
    `${rows.filter((entry) => entry.label.cause.length === 0 && baselineCorrect(entry.lead, entry.label)).length} correct decline(s)`;
  const labelledSet = asked.filter((entry) => !inGroup(PROVENANCE_ITEMS)(entry) && !inGroup(REQUEST_PROVENANCE_ITEMS)(entry));
  const requestCases = asked.filter(inGroup(REQUEST_PROVENANCE_ITEMS));
  console.log(`  (measured) baseline, labelled set: ${tally(labelledSet)}`);
  console.log(`  (measured) baseline, request-provenance cases: ${tally(requestCases)}`);
  console.log(`  (measured) baseline, all ${labelledSet.length + requestCases.length} rows: ${tally([...labelledSet, ...requestCases])}`);
  console.log(`  (measured) baseline, step-provenance cases: ${tally(asked.filter(inGroup(PROVENANCE_ITEMS)))}`);
  check("the measurement covers the 11 labelled rows and the 6 request-provenance rows", labelledSet.length === 11 && requestCases.length === 6);

  check("(precondition) the canary really is in what the cases carry", ERROR_SET.filter((c) => JSON.stringify(c.rows).includes(ERROR_CANARY)).length >= 3);
  const burst = buildCase(ERROR_SET.find((c) => c.id === "burst")!);
  check("the duplicate burst folds into one event with a repeat count of 3", burst.report.instances[0].diagnostics?.evidence.some((event) => event.source === "ui.toast" && event.repeatCount === 3) === true);
  const noise = buildCase(ERROR_SET.find((c) => c.id === "transport-noise")!);
  const noiseRequest = labelledRequestFor(noise.report, noise.report.instances[0].instanceId)!;
  const noisePrompt = buildAiPrompt(noiseRequest.prompt, new SemanticRedactor(), "0123456789abcdef");
  const controls = noisePrompt.ok ? errorControlFailures(noiseRequest, noise.labels.get(noise.report.instances[0].instanceId)!, noisePrompt) : ["the prompt did not build"];
  check("the judge's controls all hold (right, wrong, mixed, wrong baseline, canary both ways, unknown id, runner as cause, decline)", controls.length === 0, controls.join("; "));
  const quiet = buildCase(ERROR_SET.find((c) => c.id === "timeout-unrelated-console")!);
  const quietRequest = labelledRequestFor(quiet.report, quiet.report.instances[0].instanceId)!;
  const quietPrompt = buildAiPrompt(quietRequest.prompt, new SemanticRedactor(), "0123456789abcdef");
  const quietControls = quietPrompt.ok ? noCauseControlFailures(quietRequest, quiet.labels.get(quiet.report.instances[0].instanceId)!, quietPrompt) : ["the prompt did not build"];
  check("the judge's no-cause controls hold (a decline is right and delivered, a conclusion on the unrelated event is a false attribution)", quietControls.length === 0, quietControls.join("; "));
}

console.log(`\nL5b failure intelligence: ${passed}/${passed + failed} checks passed.`);
process.exit(failed === 0 ? 0 : 1);
