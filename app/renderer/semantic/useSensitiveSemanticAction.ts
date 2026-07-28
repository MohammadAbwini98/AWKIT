import { useCallback, useState } from "react";

import type { SemanticAdminResponse } from "@src/semantic/contracts/SemanticApi";

import { semanticReasonMessage } from "./semanticMessages";

type AdminCall = () => Promise<SemanticAdminResponse>;

/** What the caller should do with a response. Separated from React so it can be tested directly. */
export type SensitiveOutcome =
  | { kind: "success"; notice: string }
  | { kind: "prompt-reauth" }
  | { kind: "error"; message: string };

/**
 * The whole retry rule, as a pure function.
 *
 * It lives outside the hook because this is the part with a contract worth pinning, and a rule buried
 * in `useState` calls can only be tested by mounting React. `verify:semantic-store` drives every
 * branch of this directly.
 *
 * **The retry is capped at one deliberately.** A second `REAUTH_REQUIRED` arriving immediately after
 * a successful re-authentication does not mean the user mistyped — they already proved the password —
 * so prompting again would produce an unbounded prompt→retry→prompt loop that presents as a hung
 * button. It is reported instead.
 */
export function decideSensitiveOutcome(
  response: SemanticAdminResponse,
  isRetry: boolean,
  successNotice: string
): SensitiveOutcome {
  if (response.code === "REAUTH_REQUIRED") {
    return isRetry
      ? { kind: "error", message: "Re-authentication did not unlock this action. Sign out and back in, then try again." }
      : { kind: "prompt-reauth" };
  }
  if (!response.ok) {
    return { kind: "error", message: semanticReasonMessage(response.code, response.message) };
  }
  return { kind: "success", notice: successNotice };
}

export interface SensitiveActionState {
  busy: boolean;
  error: string | null;
  notice: string | null;
  /** True while a re-authentication is owed; the caller renders `ReauthDialog` on this. */
  needsReauth: boolean;
}

/**
 * Runs a re-auth-gated semantic call and implements the retry contract exactly.
 *
 *   `REAUTH_REQUIRED` → hold the call, prompt, retry **once** after a successful re-auth.
 *   `NOT_AUTHORIZED`  → message, no retry (retrying cannot change the answer).
 *   any other code    → its typed message.
 *   a thrown error    → propagates. It is not an authorization outcome and must not be shown as one.
 *
 * **The retry is capped at one deliberately.** A second `REAUTH_REQUIRED` immediately after a
 * successful re-auth means something is wrong with the session, not that the user mistyped — so it
 * surfaces as an error instead of reopening the dialog. Without that cap the pair
 * (prompt → retry → prompt) is an unbounded loop that looks like a hung button.
 */
export function useSensitiveSemanticAction() {
  const [state, setState] = useState<SensitiveActionState>({ busy: false, error: null, notice: null, needsReauth: false });
  const [pending, setPending] = useState<{ call: AdminCall; successNotice: string } | null>(null);

  /**
   * @param isRetry when true this is the post-re-auth attempt, so a further `REAUTH_REQUIRED` is
   *                reported rather than prompting again.
   */
  const invoke = useCallback(async (call: AdminCall, successNotice: string, isRetry: boolean): Promise<void> => {
    setState({ busy: true, error: null, notice: null, needsReauth: false });

    // Not wrapped in try/catch: an unexpected rejection is a fault, and swallowing it here would
    // turn a bug into a silent no-op button. It propagates to the caller's error boundary.
    const response = await call();
    const outcome = decideSensitiveOutcome(response, isRetry, successNotice);

    if (outcome.kind === "prompt-reauth") {
      setPending({ call, successNotice });
      setState({ busy: false, error: null, notice: null, needsReauth: true });
      return;
    }

    setPending(null);
    setState({
      busy: false,
      error: outcome.kind === "error" ? outcome.message : null,
      notice: outcome.kind === "success" ? outcome.notice : null,
      needsReauth: false
    });
  }, []);

  const run = useCallback(
    (call: AdminCall, successNotice: string) => invoke(call, successNotice, false),
    [invoke]
  );

  /** Called by `ReauthDialog` after the password is confirmed. */
  const onReauthConfirmed = useCallback(() => {
    if (!pending) {
      setState((prev) => ({ ...prev, needsReauth: false }));
      return;
    }
    void invoke(pending.call, pending.successNotice, true);
  }, [invoke, pending]);

  const onReauthCancelled = useCallback(() => {
    setPending(null);
    setState({ busy: false, error: null, notice: null, needsReauth: false });
  }, []);

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, error: null, notice: null }));
  }, []);

  return { ...state, run, onReauthConfirmed, onReauthCancelled, dismiss };
}
