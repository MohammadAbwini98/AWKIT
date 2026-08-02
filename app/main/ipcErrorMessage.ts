/**
 * Strip Electron's remote-method wrapper off an IPC rejection message (awkit-x48).
 *
 * `ipcRenderer.invoke` rejects with a message shaped like:
 *
 *   Error invoking remote method 'validation:undoMigration': Error: Flow seed-fixable-operator was
 *   edited after this migration — undo would destroy those changes.
 *
 * The domain sentence after the wrapper is the message a handler deliberately wrote for the user.
 * Everything before it is transport plumbing: it names an internal channel, which is meaningless to
 * the operator and leaks an implementation detail into a toast.
 *
 * Kept deliberately narrow:
 *   - Only the `Error invoking remote method '<channel>': ` preamble is removed, and only from the
 *     START of the message, so a domain sentence that happens to quote that text is untouched.
 *   - Only the GENERIC `Error: ` name is dropped afterwards. `TypeError: `, `RangeError: ` and
 *     friends are preserved: those indicate a bug rather than a considered refusal, and hiding them
 *     would make a crash read like a policy decision.
 *   - An empty result falls back rather than showing the user a blank toast.
 */

/** Electron's wrapper. Anchored, so it can only ever be stripped from the front. */
const REMOTE_METHOD_PREAMBLE = /^Error invoking remote method '[^']*':[ \t]*/;
/** The generic error name only — never a specific subclass. */
const GENERIC_ERROR_NAME = /^Error:[ \t]*/;
/** A handler that itself invoked another channel can nest the preamble. Bounded, not while(true). */
const MAX_NESTED_PREAMBLES = 4;

export const DEFAULT_IPC_ERROR_MESSAGE = "The operation could not be completed.";

export function unwrapIpcErrorMessage(error: unknown, fallback: string = DEFAULT_IPC_ERROR_MESSAGE): string {
  let message = "";
  if (error instanceof Error) message = error.message;
  else if (typeof error === "string") message = error;
  message = message.trim();

  for (let depth = 0; depth < MAX_NESTED_PREAMBLES && REMOTE_METHOD_PREAMBLE.test(message); depth += 1) {
    message = message.replace(REMOTE_METHOD_PREAMBLE, "").trim();
  }
  if (GENERIC_ERROR_NAME.test(message)) message = message.replace(GENERIC_ERROR_NAME, "").trim();

  return message.length > 0 ? message : fallback;
}

/**
 * Rebuild an IPC rejection with the cleaned message, keeping the original as `cause` so diagnostics
 * do not lose the channel that failed.
 */
export function toDisplayableIpcError(error: unknown, fallback: string = DEFAULT_IPC_ERROR_MESSAGE): Error {
  const cleaned = new Error(unwrapIpcErrorMessage(error, fallback));
  (cleaned as Error & { cause?: unknown }).cause = error;
  return cleaned;
}
