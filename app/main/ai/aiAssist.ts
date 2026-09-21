/**
 * User-requested AI assists in the main process (Phase L, L4b).
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
  type AiAdminResponse,
  type AiAssistCode,
  type AiAssistStatus,
  type AuthoringAssistView
} from "@src/ai/contracts/AiApi";
import type { AiPolicyConfig, AiPolicyDecision } from "@src/security/authz/AiAutonomyPolicy";
import { validateFlowDefinition, type FlowValidationReport } from "@src/validation/FlowValidator";

export interface AiAssistDeps {
  submit: (job: AiJobRequest) => Promise<AiJobOutcome>;
  policy: () => Promise<AiPolicyConfig>;
  /** Saved flow ids, so a `runFlow` reference validates exactly as the designer validates it. */
  savedFlowIds: () => Promise<string[]>;
}

const MESSAGES: Readonly<Record<AiAssistCode, string>> = Object.freeze({
  OK: "",
  NOTHING_TO_ASK: "There are no validation findings to explain.",
  FORBIDDEN: "This AI feature is turned off in Local AI settings.",
  DISABLED: "Local AI is turned off.",
  UNAVAILABLE: "Local AI is not available on this machine right now.",
  BUSY: "Local AI is busy. Try again when running flows have finished.",
  CANCELLED: "Cancelled.",
  TIMEOUT: "Local AI took too long to answer.",
  FAILED: "Local AI could not answer this request.",
  OUTPUT_REJECTED: "The AI answer did not match this flow's findings, so it was discarded.",
  INVALID_REQUEST: "The request could not be read.",
  REAUTH_REQUIRED: "Confirm your password to continue.",
  NOT_AUTHORIZED: "You are not authorized to use local AI."
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
    explanations: answer.explanations.map(({ issue, text }) => ({ issue, text })),
    ranking: ranked.map((id) => issueById.get(id)!),
    truncated: job.truncated
  };
}

export function cancelAssist(senderId: number, input: unknown, cancel: (jobId: string) => boolean): AiAdminResponse {
  const requestId = sanitizeAssistRequestId(input);
  if (!requestId) return { code: "INVALID_REQUEST", ok: false, message: "Unknown request." };
  return cancel(assistJobId(senderId, requestId)) ? { code: "OK", ok: true } : { code: "NOT_FOUND", ok: false };
}
