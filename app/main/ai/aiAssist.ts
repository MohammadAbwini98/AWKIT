/**
 * User-requested AI assists in the main process (Phase L: L4b explanations, L5b failure analysis on
 * demand, L6 fragment summaries).
 *
 * The renderer names data; this module decides everything else. For L4b it re-validates the flow the
 * renderer has open with the real `FlowValidator`, builds the request with `buildAuthoringRequest`,
 * submits it to the one `AiService`, and checks the answer with `parseAuthoringAnswer` against that same
 * report. No renderer string becomes prompt text, and nothing here writes a flow: applying a ranked fix
 * stays the existing preview → confirm → `SafeFixApplier` path.
 *
 * Electron-free on purpose (its deps are injected by `ai.ipc.ts`), so `verify:ai-authoring` drives it
 * with the real `AiService` over the deterministic transport.
 */

import type { AiJobOutcome, AiJobRequest } from "@src/ai/AiService";
import {
  AUTHORING_LIMITS,
  authoringExplanationDecision,
  authoringRankingDecision,
  buildAuthoringRequest,
  parseAuthoringAnswer
} from "@src/ai/authoringExplanation";
import {
  sanitizeAssistRequestId,
  sanitizeAuthoringAssistRequest,
  sanitizeFailureAnalysisRequest,
  sanitizeFailureAnalysisTarget,
  sanitizeFragmentSummaryRequest,
  sanitizeInspectionLocatorRequest,
  type AiAdminResponse,
  type AiAssistCode,
  type AiAssistStatus,
  type AuthoringAssistView,
  type FailureAnalysisView,
  type FragmentSummaryView,
  type InspectionLocatorView
} from "@src/ai/contracts/AiApi";
import {
  FAILURE_ANALYSIS_LIMITS,
  buildFailureAnalysisRequest,
  coalesceFailures,
  failureAnalysisDecision,
  failureSignature,
  parseFailureAnalysis,
  redactFailureAnalysis,
  withStoredFailureAnalysis,
  withoutStoredFailureAnalysis,
  type FailureBatchEntry
} from "@src/ai/failureAnalysis";
import { FRAGMENT_ASSIST_LIMITS, buildFragmentSummaryRequest, fragmentSummaryDecision, parseFragmentSummary } from "@src/ai/fragmentAssist";
import { runLocatorUpgradeAttempts, type LocatorUpgradeProvider } from "@src/ai/locatorUpgradeAttempts";
import type { FlowFragment } from "@src/fragments/FlowFragment";
import type { FlowStep, PendingLocatorUpgrade } from "@src/profiles/FlowProfile";
import type { ElementInspection } from "@src/recorder/RecorderTypes";
import type { ConcurrentRunReport, StoredFailureAnalysis } from "@src/reports/ExecutionReport";
import type { LocatorProofResult } from "@src/runner/locatorProof";
import { SemanticRedactor } from "@src/semantic/SemanticRedactor";
import { decideAiAction, type AiPolicyConfig, type AiPolicyDecision } from "@src/security/authz/AiAutonomyPolicy";
import { validateFlowDefinition, type FlowValidationReport } from "@src/validation/FlowValidator";

export interface AiAssistDeps {
  submit: (job: AiJobRequest) => Promise<AiJobOutcome>;
  policy: () => Promise<AiPolicyConfig>;
  /** Saved flow ids, so a `runFlow` reference validates exactly as the designer validates it. */
  savedFlowIds: () => Promise<string[]>;
}

const MESSAGES: Readonly<Record<AiAssistCode, string>> = Object.freeze({
  OK: "",
  NOTHING_TO_ASK: "There is nothing here for local AI to explain.",
  FORBIDDEN: "This AI feature is turned off in Local AI settings.",
  DISABLED: "Local AI is turned off.",
  UNAVAILABLE: "Local AI is not available on this machine right now.",
  BUSY: "Local AI is busy. Try again when running flows have finished.",
  CANCELLED: "Cancelled.",
  TIMEOUT: "Local AI took too long to answer.",
  FAILED: "Local AI could not answer this request.",
  OUTPUT_REJECTED: "The AI answer did not match this flow's findings, so it was discarded.",
  INVALID_REQUEST: "The request could not be read.",
  NOT_FOUND: "It no longer exists.",
  REAUTH_REQUIRED: "Confirm your password to continue.",
  NOT_AUTHORIZED: "You are not authorized to use local AI.",
  PROTECTED: "Local AI never proposes locators for sensitive or sign-in elements.",
  NOT_PROVEN: "No proposal could be proven on this page, so none is shown."
});

export function assistStatus(code: AiAssistCode, modelId?: string): AiAssistStatus {
  return code === "OK" ? { code, ok: true, ...(modelId ? { modelId } : {}) } : { code, ok: false, message: MESSAGES[code] };
}

/** One window's job id. The window id is main's, never the renderer's, so no window can cancel another's job. */
export const assistJobId = (senderId: number, requestId: string): string => `assist.${senderId}.${requestId}`;

/** Every outcome but `ok` as a code. The service's own reject and fail codes never reach the renderer raw. */
export function outcomeCode(outcome: Exclude<AiJobOutcome, { status: "ok" }>): AiAssistCode {
  if (outcome.status === "cancelled") return "CANCELLED";
  if (outcome.status === "rejected") {
    if (outcome.code === "DISABLED") return "DISABLED";
    if (outcome.code === "QUEUE_FULL" || outcome.code === "DUPLICATE_REQUEST") return "BUSY";
    if (outcome.code === "UNAVAILABLE" || outcome.code === "SHUTDOWN") return "UNAVAILABLE";
    return "FAILED";
  }
  if (outcome.code === "TIMEOUT") return "TIMEOUT";
  if (outcome.code === "YIELD_LIMIT") return "BUSY";
  if (outcome.code === "MALFORMED_OUTPUT" || outcome.code === "SCHEMA_REJECTED") return "OUTPUT_REJECTED";
  return "FAILED";
}

/** A forbidden policy decision as a code: the master switch is DISABLED, anything else FORBIDDEN. */
export function policyCode(decision: AiPolicyDecision): AiAssistCode | null {
  if (decision.decision !== "forbidden") return null;
  return decision.reason === "MASTER_SWITCH_OFF" ? "DISABLED" : "FORBIDDEN";
}

const authoringView = (code: AiAssistCode): AuthoringAssistView => ({ ...assistStatus(code), explanations: [], ranking: [], truncated: 0 });

export async function explainFlowValidation(senderId: number, input: unknown, deps: AiAssistDeps): Promise<AuthoringAssistView> {
  const request = sanitizeAuthoringAssistRequest(input);
  if (!request) return authoringView("INVALID_REQUEST");
  const policy = await deps.policy();
  const refused = policyCode(authoringExplanationDecision(policy));
  if (refused) return authoringView(refused);

  let report: FlowValidationReport;
  try {
    const referenceableFlowIds = new Set([...(await deps.savedFlowIds()), request.profile.id]);
    report = validateFlowDefinition(request.profile, { referenceableFlowIds });
  } catch {
    return authoringView("INVALID_REQUEST");
  }
  const job = buildAuthoringRequest(report);
  if (!job) return authoringView("NOTHING_TO_ASK");

  const outcome = await deps.submit({
    requestId: assistJobId(senderId, request.requestId),
    feature: "validationExplanation",
    priority: "interactive",
    prompt: job.prompt,
    schema: job.schema,
    maxOutputTokens: AUTHORING_LIMITS.maxOutputTokens,
    timeoutMs: AUTHORING_LIMITS.timeoutMs
  });
  if (outcome.status !== "ok") return authoringView(outcomeCode(outcome));
  const answer = parseAuthoringAnswer(outcome.value, job);
  if (!answer.ok) return authoringView("OUTPUT_REJECTED");

  // The ranking is shown only where the policy says "suggest" (T1). At T0 it is dropped, not shown
  // as if it were a plain interpretation: an order of repairs is advice about what to change.
  const ranked = authoringRankingDecision(policy).decision === "suggest" ? answer.ranking : [];
  const issueById = new Map(job.issues.map((ref) => [ref.id, ref.issue]));
  return {
    ...assistStatus("OK", outcome.modelId),
    explanations: answer.explanations.map(({ issue, text, step }) => ({ issue, text, step })),
    ranking: ranked.map((id) => issueById.get(id)!),
    truncated: job.truncated
  };
}

export interface FragmentAssistDeps extends Pick<AiAssistDeps, "submit" | "policy"> {
  /** The STORED fragment: the renderer names it, and its copy is never trusted. */
  fragment: (id: string) => Promise<FlowFragment | null | undefined>;
}

/**
 * L6 T0 summary. The core sends step TYPES and input KEYS only, never a step name, locator or typed
 * value, and main reads the fragment from the store itself, so a renderer cannot put words in it.
 */
export async function summarizeFragment(senderId: number, input: unknown, deps: FragmentAssistDeps): Promise<FragmentSummaryView> {
  const request = sanitizeFragmentSummaryRequest(input);
  const view = (code: AiAssistCode): FragmentSummaryView => ({ ...assistStatus(code), fragmentId: request?.fragmentId ?? "", summary: null });
  if (!request) return view("INVALID_REQUEST");
  const refused = policyCode(fragmentSummaryDecision(await deps.policy()));
  if (refused) return view(refused);
  const fragment = await deps.fragment(request.fragmentId).catch(() => null);
  if (!fragment) return view("NOT_FOUND");
  const job = buildFragmentSummaryRequest(fragment);
  if (!job) return view("NOTHING_TO_ASK");

  const outcome = await deps.submit({
    requestId: assistJobId(senderId, request.requestId),
    feature: "fragmentSummary",
    priority: "interactive",
    prompt: job.prompt,
    schema: job.schema,
    maxOutputTokens: FRAGMENT_ASSIST_LIMITS.maxOutputTokens,
    timeoutMs: FRAGMENT_ASSIST_LIMITS.timeoutMs
  });
  if (outcome.status !== "ok") return view(outcomeCode(outcome));
  const answer = parseFragmentSummary(outcome.value);
  if (!answer.ok) return view("OUTPUT_REJECTED");
  return { ...assistStatus("OK", outcome.modelId), fragmentId: fragment.id, summary: answer.summary };
}

export interface FailureReportAccess {
  /** The STORED run report. The renderer names it; its own copy of the evidence is never trusted. */
  report: (executionId: string) => Promise<ConcurrentRunReport | null | undefined>;
  /**
   * Read-modify-write of that same stored report inside its folder lane (`JsonProfileStore.updateWith`):
   * `change` sees the report as it is NOW — null once deleted — and returns the next one, or `undefined`
   * to write nothing. That is what stops a late answer resurrecting a report deleted meanwhile.
   */
  updateReport: (executionId: string, change: (current: ConcurrentRunReport | null) => ConcurrentRunReport | undefined) => Promise<unknown>;
}

export interface FailureAssistDeps extends Pick<AiAssistDeps, "submit" | "policy">, FailureReportAccess {}

/**
 * A run's failures as L5b's batch: every instance whose L5a diagnostics carry a deterministic cause.
 * Flow, node and step come from the cause's primary event, which is where L5a recorded them.
 */
export function failureBatch(report: ConcurrentRunReport): FailureBatchEntry[] {
  return report.instances.flatMap((instance) => {
    const cause = instance.diagnostics?.cause;
    if (!cause) return [];
    const events = instance.diagnostics?.evidence ?? [];
    const context = events.find((event) => event.id === cause.evidenceIds[0])?.context;
    return [{ instanceId: instance.instanceId, flowId: context?.flowId, nodeId: context?.nodeId, stepIndex: context?.stepIndex, baseline: cause, events }];
  });
}

/**
 * L5b on demand: interpret one failed instance, T0, after the run.
 *
 * Coalescing still decides what the answer covers — the same signature across the run is one failure,
 * and the view says how many instances share it. The per-batch budget governs the AUTOMATIC analysis,
 * which is not built (it needs the live quality gate); here each call is one explicit request for one
 * failure, so the NAMED instance is analysed, which also keeps every cited evidence id one the user can
 * see beside it. An insufficient baseline is still never analysed: there is nothing to reason over.
 *
 * The answer is saved into the report's optional `diagnostics` extension, one per signature, so a slow
 * CPU-only answer is not lost when the drawer closes; asking again replaces it.
 */
export async function analyzeFailure(senderId: number, input: unknown, deps: FailureAssistDeps): Promise<FailureAnalysisView> {
  const request = sanitizeFailureAnalysisRequest(input);
  const view = (code: AiAssistCode, coalescedCount = 0): FailureAnalysisView => ({
    ...assistStatus(code),
    instanceId: request?.instanceId ?? "",
    coalescedCount,
    analysis: null
  });
  if (!request) return view("INVALID_REQUEST");
  const refused = policyCode(failureAnalysisDecision(await deps.policy()));
  if (refused) return view(refused);
  const report = await deps.report(request.executionId).catch(() => null);
  if (!report || !report.instances.some((instance) => instance.instanceId === request.instanceId)) return view("NOT_FOUND");

  const batch = failureBatch(report);
  const entry = batch.find((candidate) => candidate.instanceId === request.instanceId);
  if (!entry) return view("NOTHING_TO_ASK");
  const signature = failureSignature(entry);
  const group = coalesceFailures(batch).groups.find((candidate) => candidate.signature === signature);
  const coalescedCount = group?.count ?? 1;
  const job = buildFailureAnalysisRequest({
    signature,
    instanceIds: group?.instanceIds ?? [entry.instanceId],
    count: coalescedCount,
    representative: entry,
    analyse: entry.baseline.cause !== "insufficient" && entry.baseline.evidenceIds.length > 0
  });
  if (!job) return view("NOTHING_TO_ASK", coalescedCount);

  const outcome = await deps.submit({
    requestId: assistJobId(senderId, request.requestId),
    feature: "failureAnalysis",
    priority: "interactive",
    prompt: job.prompt,
    schema: job.schema,
    maxOutputTokens: FAILURE_ANALYSIS_LIMITS.maxOutputTokens,
    timeoutMs: FAILURE_ANALYSIS_LIMITS.timeoutMs
  });
  if (outcome.status !== "ok") return view(outcomeCode(outcome), coalescedCount);
  const answer = parseFailureAnalysis(outcome.value, job);
  if (!answer.ok) return view("OUTPUT_REJECTED", coalescedCount);
  const { insufficient, category, explanation, primaryEvidenceIds, secondaryEvidenceIds, investigationSteps } = answer;
  // What is shown is what is stored: redacted and rescanned like every stored AI artifact. A residual
  // secret shape the redactor could not remove refuses the answer, as a malformed one is refused.
  const analysis = redactFailureAnalysis({ insufficient, category, explanation, primaryEvidenceIds, secondaryEvidenceIds, investigationSteps }, new SemanticRedactor());
  if (!analysis) return view("OUTPUT_REJECTED", coalescedCount);

  const record: StoredFailureAnalysis = {
    version: 1,
    signature,
    instanceId: entry.instanceId,
    instanceIds: group?.instanceIds ?? [entry.instanceId],
    createdAt: new Date().toISOString(),
    ...(outcome.modelId ? { modelId: outcome.modelId } : {}),
    analysis
  };
  // Saving is best-effort: a failed write still shows the answer, and says it was not saved.
  let stored = false;
  await deps
    .updateReport(request.executionId, (current) => {
      if (!current?.instances.some((instance) => instance.instanceId === entry.instanceId)) return undefined;
      stored = true;
      return withStoredFailureAnalysis(current, record);
    })
    .catch(() => {
      stored = false;
    });
  return { ...assistStatus("OK", outcome.modelId), instanceId: entry.instanceId, coalescedCount, analysis, stored };
}

/**
 * Delete the stored analysis covering one instance. Deliberately no policy check: removing a stored AI
 * answer must work with local AI switched off. The permission gate is the one that can create it.
 */
export async function deleteFailureAnalysis(input: unknown, deps: Pick<FailureReportAccess, "updateReport">): Promise<AiAdminResponse> {
  const target = sanitizeFailureAnalysisTarget(input);
  if (!target) return { code: "INVALID_REQUEST", ok: false, message: "Unknown run or instance." };
  let removed = false;
  try {
    await deps.updateReport(target.executionId, (current) => {
      const next = current ? withoutStoredFailureAnalysis(current, target.instanceId) : undefined;
      removed = next !== undefined;
      return next;
    });
  } catch {
    return { code: "NOT_FOUND", ok: false, message: "The saved analysis could not be deleted." };
  }
  return removed ? { code: "OK", ok: true } : { code: "NOT_FOUND", ok: false, message: "There is no saved analysis for this failure." };
}

/** The live Element Spy target, read by main from its own RecorderService — never from the renderer. */
export interface InspectionTarget {
  inspection: ElementInspection;
  /** Values typed earlier in the recording: a proposal scoped by one is refused by the intent guard. */
  boundValues: readonly string[];
  /** L3 §4 capture-time proof on the inspection's live page (`proveLocatorPlan`). */
  prove: (step: FlowStep, plan: unknown) => Promise<LocatorProofResult>;
}

export interface InspectionLocatorDeps extends Pick<AiAssistDeps, "policy"> {
  ai: LocatorUpgradeProvider;
  target: () => InspectionTarget | null;
}

/** In-flight Element Spy jobs by assist job id. The §7 loop submits one host job per attempt, so cancel goes through its signal. */
const inspectionJobs = new Map<string, AbortController>();

/** A provider code from the §7 loop as the code every other assist answers with (`outcomeCode`). */
function providerCode(code: string): AiAssistCode {
  if (code === "DISABLED") return "DISABLED";
  if (code === "UNAVAILABLE" || code === "SHUTDOWN") return "UNAVAILABLE";
  if (code === "QUEUE_FULL" || code === "DUPLICATE_REQUEST" || code === "YIELD_LIMIT") return "BUSY";
  if (code === "TIMEOUT") return "TIMEOUT";
  return "FAILED";
}

/**
 * L3 §1's explicit trigger: "Find stronger locator with AI" in Element Spy (owner's limited L1 GO,
 * 2026-09-23: on demand, browser-proven before use, never auto-promoted).
 *
 * The inspected element is treated as the click a recording would make on it, so T3 is decided exactly as
 * for that step. The bounded §7 loop proposes, compiles, guards intent and proves on the live page. Only a
 * `capture-proven` candidate is returned, and it is shown, not stored: nothing writes a flow, a draft or
 * the Recorder's candidates, so using it is a person's separate act.
 */
export async function proposeInspectionLocator(senderId: number, input: unknown, deps: InspectionLocatorDeps): Promise<InspectionLocatorView> {
  const request = sanitizeInspectionLocatorRequest(input);
  const view = (code: AiAssistCode, inspectedAt: string | null = null, attemptsUsed = 0): InspectionLocatorView => ({
    ...assistStatus(code),
    inspectedAt,
    proposal: null,
    attemptsUsed
  });
  if (!request) return view("INVALID_REQUEST");
  const target = deps.target();
  if (!target) return view("NOT_FOUND");
  const { inspection } = target;
  const step: FlowStep = { id: "element-spy", type: "click", name: inspection.owner.name, locator: inspection.locator };
  const decision = decideAiAction("locatorSemanticUpgrade", "locatorChange", { step }, await deps.policy());
  if (decision.decision === "forbidden") return view(decision.reason.startsWith("T3_") ? "PROTECTED" : policyCode(decision)!, inspection.inspectedAt);

  const jobId = assistJobId(senderId, request.requestId);
  if (inspectionJobs.has(jobId)) return view("BUSY", inspection.inspectedAt);
  const controller = new AbortController();
  inspectionJobs.set(jobId, controller);
  let proposal: PendingLocatorUpgrade | undefined;
  try {
    const result = await runLocatorUpgradeAttempts(
      {
        requestId: jobId,
        step,
        boundValues: target.boundValues,
        ...(inspection.upgradeContext ? { upgradeContext: inspection.upgradeContext } : {}),
        userRequested: true,
        priority: "interactive",
        signal: controller.signal
      },
      {
        ai: deps.ai,
        prove: (plan) => target.prove(step, plan),
        // Held for this answer only. The loop's compare-and-swap target is a saved step; the Spy has none.
        annotate: async (pending) => {
          proposal = pending;
          return { code: "OK" };
        }
      }
    );
    const at = inspection.inspectedAt;
    switch (result.outcome) {
      case "accepted":
        // `unprovable-now` is storable for a saved step, which replay settles later. The Spy has no replay.
        return proposal?.proof === "capture-proven"
          ? {
              ...assistStatus("OK", proposal.modelId),
              inspectedAt: at,
              proposal: { candidate: proposal.candidate, ...(proposal.context ? { context: proposal.context } : {}), meaningChange: proposal.meaningChange },
              attemptsUsed: result.attemptsUsed
            }
          : view("NOT_PROVEN", at, result.attemptsUsed);
      case "not-eligible":
      case "forbidden":
        return view(result.code.startsWith("T3_") ? "PROTECTED" : "NOTHING_TO_ASK", at, result.attemptsUsed);
      case "provider-unavailable":
        return view(providerCode(result.code), at, result.attemptsUsed);
      case "cancelled":
        return view("CANCELLED", at, result.attemptsUsed);
      case "context-expired":
        return view("NOT_FOUND", at, result.attemptsUsed);
      default:
        return view("NOT_PROVEN", at, result.attemptsUsed);
    }
  } finally {
    inspectionJobs.delete(jobId);
  }
}

/** Abort an in-flight Element Spy job by its assist job id. False when there is none. */
export function abortInspectionLocator(jobId: string): boolean {
  const controller = inspectionJobs.get(jobId);
  controller?.abort();
  return controller !== undefined;
}

export function cancelAssist(senderId: number, input: unknown, cancel: (jobId: string) => boolean): AiAdminResponse {
  const requestId = sanitizeAssistRequestId(input);
  if (!requestId) return { code: "INVALID_REQUEST", ok: false, message: "Unknown request." };
  return cancel(assistJobId(senderId, requestId)) ? { code: "OK", ok: true } : { code: "NOT_FOUND", ok: false };
}
