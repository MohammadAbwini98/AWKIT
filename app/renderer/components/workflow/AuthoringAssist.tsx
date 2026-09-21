import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Sparkles, X } from "lucide-react";

import type { AiStatusView, AuthoringAssistView } from "@src/ai/contracts/AiApi";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { Permission } from "@src/security/authz/Permissions";

import { usePermissions } from "../../security/usePermissions";
import { validationFindingKey } from "./flowValidationPresentation";

const api = () => window.playwrightFlowStudio.ai;

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; requestId: string }
  | { kind: "done"; view: AuthoringAssistView; snapshot: string }
  | { kind: "failed"; view: Pick<AuthoringAssistView, "code" | "message"> };

export interface AuthoringAssist {
  /** Only a user with AI_USE sees any of this. */
  visible: boolean;
  status: AiStatusView | null;
  phase: Phase;
  /** The flow changed after the answer arrived, so its explanations are withheld rather than misattributed. */
  stale: boolean;
  explain: () => void;
  cancel: () => void;
  explanationsFor: (findingKey: string) => string[];
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
  const { can } = usePermissions();
  const visible = can(Permission.AI_USE);
  const [status, setStatus] = useState<AiStatusView | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /** Newest-wins token: a superseded, cancelled or other-flow answer is never painted. */
  const token = useRef(0);
  const sequence = useRef(0);
  const inFlight = useRef<string | null>(null);

  const refreshStatus = useCallback(() => {
    if (!visible) return;
    api()
      .getStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [visible]);

  useEffect(refreshStatus, [refreshStatus]);

  const abandon = useCallback(() => {
    token.current += 1;
    const pending = inFlight.current;
    inFlight.current = null;
    if (pending) void api().cancelAssist(pending).catch(() => undefined);
  }, []);

  // A different flow: drop the answer and stop paying for a job nobody will read.
  useEffect(() => {
    abandon();
    setPhase({ kind: "idle" });
    return abandon;
  }, [flowId, abandon]);

  const explain = useCallback(() => {
    const current = (token.current += 1);
    const requestId = `l4b-${Date.now().toString(36)}-${(sequence.current += 1)}`;
    const asked = snapshot;
    inFlight.current = requestId;
    setPhase({ kind: "loading", requestId });
    api()
      .explainValidation({ requestId, profile })
      .catch((): AuthoringAssistView => ({ code: "FAILED", ok: false, message: "Local AI could not answer this request.", explanations: [], ranking: [], truncated: 0 }))
      .then((view) => {
        if (inFlight.current === requestId) inFlight.current = null;
        if (current !== token.current) return;
        setPhase(view.ok ? { kind: "done", view, snapshot: asked } : { kind: "failed", view });
        refreshStatus();
      });
  }, [profile, snapshot, refreshStatus]);

  // Cancelled at once in the UI, whatever main answers: a late result is ignored by the token.
  const cancel = useCallback(() => {
    abandon();
    setPhase({ kind: "failed", view: { code: "CANCELLED", message: "Cancelled." } });
  }, [abandon]);

  const current = phase.kind === "done" && phase.snapshot === snapshot ? phase.view : null;
  const explanations = useMemo(() => {
    const byKey = new Map<string, string[]>();
    for (const { issue, text } of current?.explanations ?? []) {
      const key = validationFindingKey(issue);
      byKey.set(key, [...(byKey.get(key) ?? []), text]);
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
    visible,
    status,
    phase,
    stale: phase.kind === "done" && !current,
    explain,
    cancel,
    explanationsFor: (key) => explanations.get(key) ?? [],
    rankOf: (key) => ranks.get(key) ?? null
  };
}

function unavailableSentence(status: AiStatusView | null): string | null {
  if (!status) return null;
  if (!status.enabled) return "Local AI is turned off. Validation and safe fixes work without it.";
  if (status.state === "unavailable") return "Local AI is not available on this machine. Validation and safe fixes work without it.";
  return null;
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
  const unavailable = unavailableSentence(assist.status);
  const state = unavailable ? "unavailable" : stale ? "stale" : phase.kind === "failed" && phase.view.code === "CANCELLED" ? "cancelled" : phase.kind;
  const done = phase.kind === "done" && !stale ? phase.view : null;

  let message: string | null = unavailable;
  if (!message && phase.kind === "loading") message = "Asking local AI to explain these findings…";
  if (!message && stale) message = "The flow changed after this explanation, so it is hidden. Explain again for the current findings.";
  if (!message && phase.kind === "failed") message = phase.view.message ?? "Local AI could not answer this request.";
  if (!message && done) {
    message = done.explanations.length
      ? `AI explained ${done.explanations.length} finding${done.explanations.length === 1 ? "" : "s"}. These are interpretations — the findings above are what the validator reports.`
      : "AI returned no explanation for these findings.";
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
      <span className={`ai-assist-message${phase.kind === "failed" && phase.view.code !== "CANCELLED" ? " error" : ""}`} role="status" data-testid="ai-assist-message">
        {phase.kind === "failed" && phase.view.code !== "CANCELLED" ? <AlertTriangle size={12} aria-hidden="true" /> : null} {message}
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
