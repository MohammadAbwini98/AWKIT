/**
 * The run-completion observation seam (plan §14).
 *
 * Pure and dependency-free on purpose. `ExecutionEngine.ts` transitively imports Electron via
 * `app/main/appPaths`, so nothing in it can be exercised by a `tsx` verifier — and the one rule here
 * is the one plan §14.3 ends on: **an indexing fault must never propagate into workflow execution.**
 * A guarantee that cannot be tested is a comment, so the guard lives where a test can reach it and
 * the engine calls through it.
 */

import type { RunHistoryRow } from "../reports/TelemetryContracts";

/**
 * A finalized run, offered to whoever wants to observe one (today: incremental semantic indexing).
 *
 * `run` is deliberately a `RunHistoryRow` — the shape the semantic projections already consume, and
 * the one that carries no raw error string and no URL. Handing out the richer durable record would
 * put the burden of redaction on every future observer instead of on this contract.
 *
 * `locatorScopeKeys` are the recovery keys this run wrote, collected by the runner as it writes them.
 * They cannot be derived afterwards: a `LocatorRecoveryRecord` carries no run id, so the only
 * alternative is filtering the store by timestamp — which misattributes records whenever two runs
 * overlap.
 */
export interface RunCompletionEvent {
  run: RunHistoryRow;
  locatorScopeKeys: readonly string[];
}

export type RunCompletionObserver = (event: RunCompletionEvent) => void;

/**
 * Invoke an observer, swallowing everything it throws.
 *
 * The `catch` is total and silent by design. At the point this runs the run has already finished and
 * its outcome is already recorded, so there is nothing an observer failure could correct and nothing
 * it should change. Re-throwing — or even logging through a logger that might itself fail — would
 * make a semantic-index problem look like a workflow problem, which is precisely the confusion
 * §14.3 exists to prevent.
 *
 * Returns whether the observer completed, so a caller that cares (a verifier) can tell "no observer"
 * from "observer threw" — a distinction a bare void return erases.
 */
export function notifyRunCompletion(
  observer: RunCompletionObserver | undefined,
  event: RunCompletionEvent
): { notified: boolean; threw: boolean } {
  if (!observer) return { notified: false, threw: false };
  try {
    observer(event);
    return { notified: true, threw: false };
  } catch {
    return { notified: true, threw: true };
  }
}
