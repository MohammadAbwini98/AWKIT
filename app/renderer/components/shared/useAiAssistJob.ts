import { useCallback, useEffect, useRef, useState } from "react";

import type { AiAssistStatus, AiStatusView } from "@src/ai/contracts/AiApi";
import { Permission } from "@src/security/authz/Permissions";

import { usePermissions } from "../../security/usePermissions";

export type AiAssistPhase<V> =
  | { kind: "idle" }
  | { kind: "loading" }
  /** `subject` is what was asked about; a caller compares it with the current one to detect staleness. */
  | { kind: "done"; view: V; subject: string }
  | { kind: "failed"; view: AiAssistStatus };

const failed = (message: string): AiAssistStatus => ({ code: "FAILED", ok: false, message });

/**
 * One user-requested local-AI job at a time, for any assist surface (L4b, L6).
 *
 * Newest wins: every answer carries a token, so a superseded, cancelled or other-subject answer is
 * never painted. Cancel is immediate in the UI and also reaches main, which releases the job; a late
 * answer is dropped by the token. `resetKey` changing (another flow, another fragment) abandons
 * whatever is in flight. Only a user with AI_USE sees any of it.
 */
export function useAiAssistJob<V extends AiAssistStatus>(resetKey: string) {
  const { can } = usePermissions();
  const visible = can(Permission.AI_USE);
  const [status, setStatus] = useState<AiStatusView | null>(null);
  const [phase, setPhase] = useState<AiAssistPhase<V>>({ kind: "idle" });
  const token = useRef(0);
  const sequence = useRef(0);
  const inFlight = useRef<string | null>(null);

  const refreshStatus = useCallback(() => {
    if (!visible) return;
    window.playwrightFlowStudio.ai
      .getStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [visible]);

  useEffect(refreshStatus, [refreshStatus]);

  const abandon = useCallback(() => {
    token.current += 1;
    const pending = inFlight.current;
    inFlight.current = null;
    if (pending) void window.playwrightFlowStudio.ai.cancelAssist(pending).catch(() => undefined);
  }, []);

  useEffect(() => {
    abandon();
    setPhase({ kind: "idle" });
    return abandon;
  }, [resetKey, abandon]);

  const start = useCallback(
    (prefix: string, subject: string, call: (requestId: string) => Promise<V>) => {
      const current = (token.current += 1);
      const requestId = `${prefix}-${Date.now().toString(36)}-${(sequence.current += 1)}`;
      inFlight.current = requestId;
      setPhase({ kind: "loading" });
      call(requestId)
        .then(
          (view): { view: V | AiAssistStatus; ok: boolean } => ({ view, ok: view.ok }),
          () => ({ view: failed("Local AI could not answer this request."), ok: false })
        )
        .then(({ view, ok }) => {
          if (inFlight.current === requestId) inFlight.current = null;
          if (current !== token.current) return;
          setPhase(ok ? { kind: "done", view: view as V, subject } : { kind: "failed", view });
          refreshStatus();
        });
    },
    [refreshStatus]
  );

  const cancel = useCallback(() => {
    abandon();
    setPhase({ kind: "failed", view: { code: "CANCELLED", ok: false, message: "Cancelled." } });
  }, [abandon]);

  return { visible, status, phase, start, cancel };
}

/** Why the control is disabled, or null when local AI can be asked. */
export function aiUnavailableSentence(status: AiStatusView | null, fallback: string): string | null {
  if (!status) return null;
  if (!status.enabled) return `Local AI is turned off. ${fallback}`;
  if (status.state === "unavailable") return `Local AI is not available on this machine. ${fallback}`;
  return null;
}
