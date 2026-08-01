/**
 * The contract by which something outside the runner can veto dispatch.
 *
 * `ExecutionEngine` lives in the Electron-free domain and must not import licensing or `app/main`,
 * so the licensing gate is INJECTED (`ExecutionEngine.setDispatchGate`) by the main process at
 * startup. The engine consults it every dispatch tick, which is what lets a license transition stop
 * queued work within ~500ms instead of only at the next run request (bd `awkit-f3l`).
 *
 * Synchronous by contract: the gate is evaluated inside the dispatch loop between a status read and
 * a status write, and introducing an `await` there would reopen the very race this closes.
 */

export interface DispatchGateVerdict {
  readonly admit: boolean;
  /** Stable, non-secret reason string — surfaced in cancellation reasons and admission telemetry. */
  readonly reason: string;
}

export type DispatchGate = () => DispatchGateVerdict;

/**
 * No gate installed — dispatch proceeds.
 *
 * This default is FAIL-OPEN, deliberately and narrowly: benchmark and verifier scripts construct
 * `ExecutionEngine` directly, outside Electron, where no licensing runtime exists; a fail-closed
 * default would deadlock every one of them at zero dispatched instances.
 *
 * The security therefore does NOT come from this default. It comes from the real application
 * refusing to start when `dispatchGateRegistered` is false (see `app/main/main.ts`), from
 * `setDispatchGate` accepting no nullable argument and offering no un-setter, and from the static
 * wiring assertions in `scripts/verify-license-dispatch-gate.mts`.
 */
export const DISPATCH_GATE_UNREGISTERED: DispatchGateVerdict = {
  admit: true,
  reason: "NO_GATE_REGISTERED"
};

/**
 * The gate itself threw. Fail CLOSED: a gate that cannot answer is not evidence that dispatch is
 * permitted, and "the check broke" must never become a way to run unlicensed.
 */
export const DISPATCH_GATE_FAULT: DispatchGateVerdict = {
  admit: false,
  reason: "DISPATCH_GATE_FAULT"
};
