/**
 * The L1.8 `failureAnalysis` workload: the product's own request, not a stand-in for it.
 *
 * `bench.ts` used to measure a synthetic packet written before L5b existed: generated prose in four DATA
 * blocks and a schema the product never sends, at a 256-token cap while the product asked for 512. It
 * passed while every real request projected past the ceiling at its own cap (L1 plan, 2026-09-22).
 *
 * This packet is built the way `app/main/ai/aiAssist.ts#analyzeFailure` builds its job: a stored run
 * report whose evidence and cause come from L5a's real `EvidenceBuffer` and `deriveFailureCause`, then
 * `failureBatch`, `buildFailureAnalysisRequest` and `FAILURE_ANALYSIS_LIMITS`. The fixtures are the ones
 * `verify:ai-failure-analysis-live` sends through the product path, so the two measure the same requests.
 *
 * Electron-free, so the launcher can compute `identity` and measure the scenario again whenever the
 * product's request changes, instead of judging a new request by an old one's numbers.
 */

import { createHash } from "node:crypto";

import { failureBatch } from "@main/ai/aiAssist";
import { validateAiOutput } from "@src/ai/AiOutputContract";
import { buildAiPrompt } from "@src/ai/AiPromptBuilder";
import {
  FAILURE_ANALYSIS_LIMITS,
  buildFailureAnalysisRequest,
  failureSignature,
  parseFailureAnalysis,
  redactFailureAnalysis,
  type FailureAnalysisRequest
} from "@src/ai/failureAnalysis";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { EvidenceBuffer, EvidenceRunBudget, type EvidenceInput } from "@src/runner/evidence/ExecutionEvidence";
import { deriveFailureCause, type RunnerFailureKind } from "@src/runner/evidence/FailureCauseBaseline";
import { INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, type InstanceDiagnostics } from "@src/runner/evidence/FailureEvidenceCollector";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";

/** The length `AiService` generates (`randomBytes(8)`, 16 hex), fixed so the prompt is byte-identical per run. */
export const NONCE = "0f1e2d3c4b5a6978";

export type FixtureEvent = Omit<EvidenceInput, "context"> & { atMs: number };

/** A stored run report whose one failed instance carries L5a's real evidence and cause. */
export function failedRun(executionId: string, events: FixtureEvent[], kind: RunnerFailureKind): ConcurrentRunReport & { id: string } {
  const instanceId = `${executionId}-row1`;
  let clock = 0;
  const buffer = new EvidenceBuffer({ executionId, instanceId }, new EvidenceRunBudget(), { redactor: new SemanticRedactor(), now: () => clock });
  const context = { flowId: "flow-checkout", nodeId: "n-confirm", stepIndex: 6 };
  for (const { atMs, ...event } of events) {
    clock = atMs;
    buffer.add({ ...event, context });
  }
  const evidence = [...buffer.list()];
  const runner = evidence.find((event) => event.source === "runner.failure");
  const failedAt = events[events.length - 1].atMs;
  const cause = deriveFailureCause(evidence, { kind, stepStartOffsetMs: events[0].atMs, failedAtOffsetMs: failedAt, ...(runner ? { evidenceId: runner.id } : {}) });
  const diagnostics: InstanceDiagnostics = { schemaVersion: INSTANCE_DIAGNOSTICS_SCHEMA_VERSION, evidence, summary: buffer.summary(), cause };
  const started = Date.parse("2026-09-21T09:00:00.000Z");
  return {
    id: executionId,
    executionId,
    scenarioId: "wf-checkout",
    scenarioName: "Checkout",
    runMode: "dataDrivenConcurrent",
    maxConcurrentInstances: 1,
    status: "failed",
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(started + failedAt).toISOString(),
    durationMs: failedAt,
    passedFlows: 0,
    failedFlows: 1,
    skippedFlows: 0,
    instances: [{ instanceId, status: "failed", durationMs: failedAt, error: "The order confirmation did not appear.", screenshots: [], downloadedFiles: [], diagnostics }],
    runtimeInputs: {}
  } as ConcurrentRunReport & { id: string };
}

/** The Feature Test Lab's L5b failure: one server error, then the runner's assertion. */
export const TYPICAL_FAILURE: FixtureEvent[] = [
  { atMs: 1_000, source: "http.error", severity: "error", payload: { method: "POST", url: "https://shop.example/orders/40001/submit", status: 500, resourceType: "xhr" } },
  { atMs: 1_500, source: "runner.failure", severity: "error", payload: { kind: "assertion", message: "The order confirmation did not appear." } }
];

/** A noisy checkout failure: more distinct events than the request offers, so its evidence is capped. */
export const LARGEST_FAILURE: FixtureEvent[] = [
  { atMs: 200, source: "ui.toast", severity: "warning", payload: { text: "Your session will expire in two minutes. Save your work to keep it." } },
  { atMs: 900, source: "network.failed", severity: "warning", payload: { method: "GET", url: "https://cdn.shop.example/js/recommendations.js", failure: "net::ERR_CONNECTION_RESET", resourceType: "script" } },
  { atMs: 1_400, source: "console.error", severity: "error", payload: { text: "Failed to load resource: the recommendations widget could not be initialised because its script did not load." } },
  { atMs: 2_100, source: "ui.fieldInvalid", severity: "warning", payload: { field: "postal-code", label: "Postal code", reason: "patternMismatch" } },
  { atMs: 2_600, source: "ui.fieldInvalid", severity: "warning", payload: { field: "card-expiry", label: "Card expiry date", reason: "rangeUnderflow" } },
  { atMs: 3_300, source: "http.error", severity: "error", payload: { method: "POST", url: "https://shop.example/api/cart/validate", status: 422, resourceType: "fetch" } },
  { atMs: 3_900, source: "ui.alert", severity: "error", payload: { text: "Some items in your cart are no longer available in the quantity you selected." } },
  { atMs: 4_700, source: "http.error", severity: "error", payload: { method: "POST", url: "https://shop.example/api/payments/authorize", status: 502, resourceType: "fetch" } },
  { atMs: 5_200, source: "console.error", severity: "error", payload: { text: "Uncaught (in promise) PaymentError: authorization gateway returned an invalid response." } },
  { atMs: 5_300, source: "page.error", severity: "error", payload: { name: "TypeError", message: "Cannot read properties of undefined (reading 'confirmationNumber') at renderReceipt" } },
  { atMs: 5_900, source: "ui.alert", severity: "error", payload: { text: "We could not process your payment. You have not been charged. Please try again." } },
  { atMs: 6_400, source: "http.error", severity: "error", payload: { method: "GET", url: "https://shop.example/api/orders/40001/status", status: 404, resourceType: "fetch" } },
  { atMs: 7_000, source: "ui.status", severity: "info", payload: { text: "Retrying payment authorization, attempt 2 of 3." } },
  { atMs: 8_800, source: "http.error", severity: "error", payload: { method: "POST", url: "https://shop.example/api/payments/authorize", status: 504, resourceType: "fetch" } },
  { atMs: 9_500, source: "runner.failure", severity: "error", payload: { kind: "timeout", message: "Timed out after 30000 ms waiting for the order confirmation heading to be visible." } }
];

/** Only the runner's own timeout: the evidence shows THAT the step failed, and nothing about why. */
export const RUNNER_ONLY_FAILURE: FixtureEvent[] = [
  { atMs: 31_000, source: "runner.failure", severity: "error", payload: { kind: "timeout", message: "Timed out after 30000 ms waiting for the order confirmation heading to be visible." } }
];

/**
 * The request `analyzeFailure` builds for a one-instance report. `verify:ai-error-analysis` proves it
 * equal to the job `analyzeFailure` submits for the same report.
 */
export function productFailureRequest(report: ConcurrentRunReport): FailureAnalysisRequest {
  const [entry] = failureBatch(report);
  const request = entry && buildFailureAnalysisRequest({ signature: failureSignature(entry), instanceIds: [entry.instanceId], count: 1, representative: entry, analyse: true });
  if (!request) throw new Error("the fixture produced no failure-analysis request");
  return request;
}

const recordOf = (value: unknown) => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** A decoded answer's shape, as counts. Key names come from the schema, never the model. */
export function answerShape(value: unknown) {
  const raw = recordOf(value);
  if (!raw) return null;
  const count = (list: unknown) => (Array.isArray(list) ? list.length : null);
  const chars = (text: unknown) => (typeof text === "string" ? text.trim().length : null);
  // A text exactly at its `maxLength` was ended by the grammar, mid-sentence, not by the model.
  const atLimit = (text: unknown, max: number) => (typeof text === "string" && text.length === max ? 1 : 0);
  const first = Array.isArray(raw.conclusion) ? recordOf(raw.conclusion[0]) : null;
  const steps = Array.isArray(first?.investigationSteps) ? (first.investigationSteps as unknown[]) : [];
  const limits = FAILURE_ANALYSIS_LIMITS;
  return {
    keys: Object.keys(raw),
    conclusions: count(raw.conclusion),
    ...(first && {
      conclusionKeys: Object.keys(first),
      primary: count(first.primaryEvidenceIds),
      secondary: count(first.secondaryEvidenceIds),
      categoryChars: chars(first.category),
      explanationChars: chars(first.explanation),
      stepChars: steps.map((step) => chars(step) ?? -1),
      cutByGrammar:
        atLimit(first.category, limits.maxCategoryChars) +
        atLimit(first.explanation, limits.maxExplanationChars) +
        steps.reduce<number>((n, step) => n + atLimit(step, limits.maxStepChars), 0)
    })
  };
}

export function failureAnalysisPacket() {
  const request = productFailureRequest(failedRun("exec-bench-largest", LARGEST_FAILURE, "timeout"));
  const prompt = buildAiPrompt(request.prompt, new SemanticRedactor(), NONCE);
  if (!prompt.ok || prompt.omittedFields.length > 0) throw new Error("the product's failure-analysis request did not build whole");
  const maxOutputTokens = FAILURE_ANALYSIS_LIMITS.maxOutputTokens;
  const identity = createHash("sha256").update(JSON.stringify({ system: prompt.system, user: prompt.user, schema: request.schema, maxOutputTokens })).digest("hex");
  const causeId = request.group.representative.baseline.evidenceIds[0];
  return {
    name: "failureAnalysis" as const,
    spec: request.prompt,
    schema: request.schema,
    maxOutputTokens,
    nonce: NONCE,
    identity,
    /** The product's own verdict on a decoded answer — its output contract, parser, redaction and rescan — as counts and codes. */
    assess(value: unknown): Record<string, unknown> {
      const shape = answerShape(value);
      if (validateAiOutput(value, request.schema).length > 0) return { accepted: false, rejection: "SCHEMA_REJECTED", shape };
      const answer = parseFailureAnalysis(value, request);
      if (!answer.ok) return { accepted: false, rejection: answer.code, field: answer.field, shape };
      const { insufficient, category, explanation, primaryEvidenceIds, secondaryEvidenceIds, investigationSteps } = answer;
      const stored = redactFailureAnalysis({ insufficient, category, explanation, primaryEvidenceIds, secondaryEvidenceIds, investigationSteps }, new SemanticRedactor());
      if (!stored) return { accepted: false, rejection: "RESIDUAL_SECRET", shape };
      return {
        accepted: true,
        // The largest failure rests on direct evidence, so its grammar admits only a conclusion.
        classified: insufficient ? "insufficient" : "conclusion",
        // Recorded, not required: its earliest direct evidence is a failed CDN script, and the payment
        // gateway's 502 is an equally grounded reading of the same run.
        citesCause: primaryEvidenceIds.includes(causeId),
        offered: request.evidence.length,
        shape
      };
    }
  };
}
