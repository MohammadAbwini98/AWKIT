/**
 * N6.5 (awkit-vra.15.5): the candidate approval surface behind the `visualAssertion:*` IPC channels (plan "Pending
 * candidates", VA-13, VA-14; owner amendment A5). Electron-free, so `verify:visual-assertion-candidates` drives this
 * exact code; the IPC handlers only authorize (WORKFLOW_EDIT, plus fresh re-authentication for preview, approval,
 * rejection and reset) and pass the authorized actor in.
 *
 *  - LIST returns the renderer-safe summaries only: no digest, token, commitment, key or pixels.
 *  - PREVIEW reads a live candidate without consuming it and returns a PNG of its transient element crop. Candidates
 *    exist only after a protected-guarded capture, so no protected-login pixels can be in one.
 *  - APPROVE consumes the candidate atomically (single use, even when the store then refuses it) and writes the
 *    approval through `approveUnchecked`, which re-checks the flow epoch, current step digest, key generation and
 *    existence inside the flows folder's critical section. The run user is the candidate's authenticated initiator;
 *    the approver is the actor who approved.
 *  - REJECT discards the candidate.
 *  - RESET rotates the key generation (every approval and grant of the mode is gone) and drops stale candidates.
 *
 * Every decision is audited with the approver, the run user, the flow, the step, the conditions key and the outcome;
 * nothing secret is audited. Answers are `{ ok, code }` with fixed lowercase codes.
 */
import { createHash } from "node:crypto";

import { encodePreviewPng, VISUAL_PREVIEW_MAX_PIXELS } from "./candidatePreviewPng";
import type { VisualAssertionCandidate, VisualAssertionCandidates, VisualCandidateSummary } from "./visualAssertionCandidates";
import { visualConditionsKey, type VisualBaselineStore } from "./VisualBaselineStore";

export interface VisualApprovalActor {
  userId: string;
  username: string;
}

export interface VisualApprovalAuditEntry {
  eventType: "VISUAL_CANDIDATE_PREVIEWED" | "VISUAL_CANDIDATE_APPROVED" | "VISUAL_CANDIDATE_APPROVAL_REFUSED" | "VISUAL_CANDIDATE_REJECTED" | "VISUAL_BASELINES_RESET";
  result: "success" | "failure";
  actor: VisualApprovalActor;
  reasonCode: string;
  detail: Record<string, string | number | boolean>;
}

export interface VisualApprovalDeps {
  store: VisualBaselineStore;
  candidates: VisualAssertionCandidates;
  appVersion: string;
  audit: (entry: VisualApprovalAuditEntry) => Promise<void>;
}

export type VisualApprovalResponse<T extends object = object> = ({ ok: true; code: string } & T) | { ok: false; code: string };

/** The renderer-safe view of one candidate, with who started its run (a name, never a token). */
export interface VisualCandidateView extends VisualCandidateSummary {
  runUsername: string;
}

const ID = /^[0-9a-f]{32}$/;

const auditDetail = (c: VisualAssertionCandidate): Record<string, string | number | boolean> => ({
  candidateId: c.candidateId,
  flowId: c.flowId,
  stepId: c.stepId,
  mode: c.mode,
  reason: c.reason,
  runUserId: c.initiator.userId,
  runUsername: c.initiator.username,
  // The conditions key is a hash of the conditions envelope, not a secret.
  conditionsKey: createHash("sha256").update(visualConditionsKey(c.conditions), "utf8").digest("hex").slice(0, 16),
  keyGeneration: c.keyGeneration
});

async function safeAudit(deps: VisualApprovalDeps, entry: VisualApprovalAuditEntry): Promise<void> {
  try {
    await deps.audit(entry);
  } catch {
    // An unwritable audit trail never turns a decision into a different error.
  }
}

export function listVisualCandidates(deps: VisualApprovalDeps, filter: { flowId?: string; stepId?: string } = {}): VisualCandidateView[] {
  return deps.candidates
    .summaries()
    .filter((s) => (!filter.flowId || s.flowId === filter.flowId) && (!filter.stepId || s.stepId === filter.stepId))
    .map((s) => ({ ...s, runUsername: deps.candidates.peek(s.candidateId)?.initiator.username ?? "" }));
}

export async function previewVisualCandidate(
  deps: VisualApprovalDeps,
  actor: VisualApprovalActor,
  candidateId: unknown
): Promise<VisualApprovalResponse<{ width: number; height: number; pngBase64: string }>> {
  const candidate = typeof candidateId === "string" && ID.test(candidateId) ? deps.candidates.peek(candidateId) : undefined;
  if (!candidate) return { ok: false, code: "candidate-unavailable" };
  const { width, height, rgba } = candidate.preview;
  if (width * height > VISUAL_PREVIEW_MAX_PIXELS) return { ok: false, code: "preview-too-large" };
  let png: Buffer;
  try {
    png = encodePreviewPng(width, height, rgba);
  } catch {
    return { ok: false, code: "preview-unavailable" };
  }
  await safeAudit(deps, { eventType: "VISUAL_CANDIDATE_PREVIEWED", result: "success", actor, reasonCode: "previewed", detail: auditDetail(candidate) });
  return { ok: true, code: "previewed", width, height, pngBase64: png.toString("base64") };
}

export async function approveVisualCandidate(deps: VisualApprovalDeps, actor: VisualApprovalActor, candidateId: unknown): Promise<VisualApprovalResponse<{ generation: number }>> {
  // Single use: removed before anything else, so a concurrent or replayed approval of the same id finds nothing.
  const candidate = typeof candidateId === "string" && ID.test(candidateId) ? deps.candidates.take(candidateId) : undefined;
  if (!candidate) return { ok: false, code: "candidate-unavailable" };
  let code: string;
  let generation = 0;
  // VA-13: approving over an unreadable baseline is audited as a replacement, not as an ordinary approval.
  let replacedUnreadable = candidate.reason === "baseline-unreadable";
  try {
    const result = await deps.store.approveUnchecked({
      flowId: candidate.flowId,
      stepId: candidate.stepId,
      stepContentDigest: candidate.stepContentDigest,
      conditions: { ...candidate.conditions },
      epoch: candidate.epoch,
      width: candidate.width,
      height: candidate.height,
      contentDigest: candidate.contentDigest,
      geometry: { ...candidate.geometry },
      boundEpoch: candidate.epoch,
      boundKeyGeneration: candidate.keyGeneration,
      approver: actor.userId,
      runUser: candidate.initiator.userId,
      runId: candidate.executionId,
      appVersion: deps.appVersion
    });
    code = result.ok ? "approved" : result.refusal;
    if (result.ok) {
      generation = result.generation;
      replacedUnreadable ||= result.replacedUnreadable;
    }
  } catch {
    code = "approval-failed";
  }
  const ok = code === "approved";
  await safeAudit(deps, {
    eventType: ok ? "VISUAL_CANDIDATE_APPROVED" : "VISUAL_CANDIDATE_APPROVAL_REFUSED",
    result: ok ? "success" : "failure",
    actor,
    reasonCode: code,
    detail: { ...auditDetail(candidate), approverId: actor.userId, approverName: actor.username, ...(ok ? { replacedUnreadable } : {}) }
  });
  return ok ? { ok: true, code, generation } : { ok: false, code };
}

export async function rejectVisualCandidate(deps: VisualApprovalDeps, actor: VisualApprovalActor, candidateId: unknown): Promise<VisualApprovalResponse> {
  const candidate = typeof candidateId === "string" && ID.test(candidateId) ? deps.candidates.take(candidateId) : undefined;
  if (!candidate) return { ok: false, code: "candidate-unavailable" };
  await safeAudit(deps, { eventType: "VISUAL_CANDIDATE_REJECTED", result: "success", actor, reasonCode: "rejected", detail: auditDetail(candidate) });
  return { ok: true, code: "rejected" };
}

export async function resetVisualBaselines(deps: VisualApprovalDeps, actor: VisualApprovalActor): Promise<VisualApprovalResponse<{ generation: number }>> {
  try {
    const { generation } = await deps.store.resetUnchecked();
    deps.candidates.dropBelowKeyGeneration(generation);
    await safeAudit(deps, { eventType: "VISUAL_BASELINES_RESET", result: "success", actor, reasonCode: "reset", detail: { generation, appMode: deps.store.appMode } });
    return { ok: true, code: "reset", generation };
  } catch {
    await safeAudit(deps, { eventType: "VISUAL_BASELINES_RESET", result: "failure", actor, reasonCode: "reset-unavailable", detail: { appMode: deps.store.appMode } });
    return { ok: false, code: "reset-unavailable" };
  }
}
