import { useMemo } from "react";
import { AlertTriangle, Sparkles, X } from "lucide-react";

import type { AiStatusView, AuthoringAssistView } from "@src/ai/contracts/AiApi";
import type { FlowProfile } from "@src/profiles/FlowProfile";

import { aiUnavailableSentence, useAiAssistJob, type AiAssistPhase } from "../shared/useAiAssistJob";
import { validationFindingKey } from "./flowValidationPresentation";

export interface AuthoringAssist {
  /** Only a user with AI_USE sees any of this. */
  visible: boolean;
  status: AiStatusView | null;
  phase: AiAssistPhase<AuthoringAssistView>;
  /** The flow changed after the answer arrived, so its explanations are withheld rather than misattributed. */
  stale: boolean;
  explain: () => void;
  cancel: () => void;
  /**
   * The AI's text, and the rule's own corrective step beside it (product text, not AI). `text` is null when
   * the product withheld it (R4); `withheld` says why.
   */
  explanationsFor: (findingKey: string) => AuthoringAssistView["explanations"];
  /** 1-based position in the AI's suggested fix order, or null. */
  rankOf: (findingKey: string) => number | null;
}

/**
 * L4b in the Flow Designer: ask local AI to explain the open flow's validation findings.
 *
 * The answer is attached to the snapshot it was asked about. Any edit afterwards withholds it — an
 * explanation of a finding that no longer exists, or of a different one under the same row, is worse
 * than none. Nothing here writes the flow: the ranking only orders fixes the validator already offers,
 * and applying them is the existing preview → confirm path.
 */
export function useAuthoringAssist(flowId: string, profile: FlowProfile, snapshot: string): AuthoringAssist {
  const job = useAiAssistJob<AuthoringAssistView>(flowId);
  const { phase } = job;

  const current = phase.kind === "done" && phase.subject === snapshot ? phase.view : null;
  const explanations = useMemo(() => {
    const byKey = new Map<string, AuthoringAssistView["explanations"]>();
    for (const explanation of current?.explanations ?? []) {
      const key = validationFindingKey(explanation.issue);
      byKey.set(key, [...(byKey.get(key) ?? []), explanation]);
    }
    return byKey;
  }, [current]);
  const ranks = useMemo(() => {
    const byKey = new Map<string, number>();
    current?.ranking.forEach((issue, index) => {
      const key = validationFindingKey(issue);
      if (!byKey.has(key)) byKey.set(key, index + 1);
    });
    return byKey;
  }, [current]);

  return {
    visible: job.visible,
    status: job.status,
    phase,
    stale: phase.kind === "done" && !current,
    explain: () => job.start("l4b", snapshot, (requestId) => window.playwrightFlowStudio.ai.explainValidation({ requestId, profile })),
    cancel: job.cancel,
    explanationsFor: (key) => explanations.get(key) ?? [],
    rankOf: (key) => ranks.get(key) ?? null
  };
}

export function AuthoringAssistBar({
  assist,
  canReviewFixes,
  reviewBlockedReason,
  onReviewFixes
}: {
  assist: AuthoringAssist;
  canReviewFixes: boolean;
  /** Why fixes cannot be reviewed now (unsaved edits), or null. */
  reviewBlockedReason: string | null;
  onReviewFixes: () => void;
}) {
  if (!assist.visible) return null;
  const { phase, stale } = assist;
  const unavailable = aiUnavailableSentence(assist.status, "Validation and safe fixes work without it.");
  const refused = phase.kind === "failed" && phase.view.code !== "CANCELLED";
  const state = unavailable ? "unavailable" : stale ? "stale" : phase.kind === "failed" && !refused ? "cancelled" : phase.kind;
  const done = phase.kind === "done" && !stale ? phase.view : null;

  let message: string | null = unavailable;
  if (!message && phase.kind === "loading") message = "Asking local AI to explain these findings…";
  if (!message && stale) message = "The flow changed after this explanation, so it is hidden. Explain again for the current findings.";
  if (!message && phase.kind === "failed") message = phase.view.message ?? "Local AI could not answer this request.";
  if (!message && done) {
    const withheld = done.explanations.filter((e) => e.withheld).length;
    const shown = done.explanations.length - withheld;
    message = shown
      ? `AI explained ${shown} finding${shown === 1 ? "" : "s"}. These are interpretations — the findings above are what the validator reports.`
      : withheld
        ? ""
        : "AI returned no explanation for these findings.";
    // Never silent (R4): a withheld explanation is counted here and marked under its finding.
    if (withheld) message = `${message} ${withheld} AI explanation${withheld === 1 ? " was" : "s were"} withheld: ${withheld === 1 ? "it" : "they"} claimed more than the validator's findings establish. The findings and corrective actions still apply.`.trim();
    if (done.truncated) message += ` ${done.truncated} further finding${done.truncated === 1 ? " was" : "s were"} not sent.`;
  }

  return (
    <div className="ai-assist-bar" data-testid="ai-assist-bar" data-assist-state={state}>
      <span className="ai-assist-label">
        <Sparkles size={13} aria-hidden="true" />
        Local AI
      </span>
      {phase.kind === "loading" ? (
        <button className="toolbar-button" type="button" data-testid="ai-assist-cancel" onClick={assist.cancel}>
          <X size={13} aria-hidden="true" />
          Cancel
        </button>
      ) : (
        <button className="toolbar-button" type="button" data-testid="ai-assist-explain" disabled={Boolean(unavailable)} onClick={assist.explain}>
          {done || stale ? "Explain again" : "Explain with AI"}
        </button>
      )}
      <span className={`ai-assist-message${refused ? " error" : ""}`} role="status" data-testid="ai-assist-message">
        {refused ? <AlertTriangle size={12} aria-hidden="true" /> : null} {message}
      </span>
      {done && done.ranking.length ? (
        <span className="ai-assist-fixes" data-testid="ai-assist-ranking">
          AI suggests an order for {done.ranking.length} safe fix{done.ranking.length === 1 ? "" : "es"}. Nothing is changed until you review and confirm.
          <button className="toolbar-button" type="button" data-testid="ai-assist-review-fixes" disabled={!canReviewFixes} title={reviewBlockedReason ?? undefined} onClick={onReviewFixes}>
            Review safe fixes…
          </button>
          {reviewBlockedReason ? <span className="ai-assist-note">{reviewBlockedReason}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
