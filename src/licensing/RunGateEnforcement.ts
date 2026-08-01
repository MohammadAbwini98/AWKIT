/**
 * Pure enforcement latch for the licensing run gate.
 *
 * `RunGatePolicy` decides *what* the disposition is; this module decides *what changed since the
 * last evaluation*, so a periodic or focus-triggered revalidation can act on `cancel-pending`
 * without waiting for a new run request (bd `awkit-f3l`).
 *
 * The distinction that matters:
 *
 * - `shouldCancelPending` is true on EVERY blocking evaluation, not only on transitions. Suppressing
 *   the sweep on repeats would be wrong — instances can be queued between two passes, which is
 *   precisely the dispatch race this work exists to close. The sweep is inherently idempotent:
 *   `cancelPendingInstances` returns an empty list once nothing is pending.
 * - `shouldAudit` is transition-gated. "Repeated blocked revalidation is idempotent" is a statement
 *   about observable side effects — audit rows and log lines — not about re-running a no-op sweep.
 *
 * Kept Electron-free and clock-free (`nowMs` is a parameter) so the verifier can drive the exact
 * production rule across folded time without a timer.
 */
import { LicenseStatus } from "./LicenseTypes";
import type { ActiveRunDisposition, RunGateReason } from "./RunGatePolicy";

/** Why enforcement was evaluated. Recorded in the audit detail so provenance is never inferred. */
export type EnforcementTrigger =
  | "startup"
  | "interval"
  | "window-focus"
  | "revalidate-ipc"
  | "license-changed"
  | "run-request"
  | "pre-run";

/** The full trigger set, so a verifier can assert cardinality instead of spot-checking members. */
export const ENFORCEMENT_TRIGGERS: readonly EnforcementTrigger[] = [
  "startup",
  "interval",
  "window-focus",
  "revalidate-ipc",
  "license-changed",
  "run-request",
  "pre-run"
];

export type EnforcementAuditEvent = "LICENSE_ENFORCEMENT_ENGAGED" | "LICENSE_ENFORCEMENT_CLEARED";

/**
 * The last observed enforcement state. `evaluatedAtMs` lets the dispatch gate bound how stale a
 * cached verdict may be before it re-reads the license store.
 */
export interface EnforcementLatchState {
  readonly blocking: boolean;
  readonly reason: RunGateReason | null;
  readonly status: LicenseStatus | null;
  readonly evaluatedAtMs: number;
}

/** The starting state: nothing observed yet, nothing blocked. */
export const CLEARED_ENFORCEMENT_STATE: EnforcementLatchState = {
  blocking: false,
  reason: null,
  status: null,
  evaluatedAtMs: 0
};

/** The subset of a `RunGateDecision` this module needs — keeps it free of the Electron-side type. */
export interface EnforcementInput {
  readonly activeRunDisposition: ActiveRunDisposition;
  readonly reason: RunGateReason;
  readonly status: LicenseStatus;
}

export interface EnforcementTransition {
  readonly next: EnforcementLatchState;
  /** Sweep pending/queued work. True on every blocking pass — see the module note. */
  readonly shouldCancelPending: boolean;
  /** Write an audit row. True only when the enforcement state actually changed. */
  readonly shouldAudit: boolean;
  readonly auditEvent: EnforcementAuditEvent | null;
}

/**
 * Fold one gate decision into the latch.
 *
 * | previous.blocking | disposition       | cancel | audit | event   |
 * |-------------------|-------------------|--------|-------|---------|
 * | false             | `cancel-pending`  | yes    | yes   | ENGAGED |
 * | true, same cause  | `cancel-pending`  | yes    | no    | —       |
 * | true, new cause   | `cancel-pending`  | yes    | yes   | ENGAGED |
 * | true              | `allow-to-finish` | no     | yes   | CLEARED |
 * | false             | `allow-to-finish` | no     | no    | —       |
 *
 * A changed reason or status while already blocking re-audits: "MACHINE_MISMATCH replaced
 * INVALID_SIGNATURE" is a different security event, not a repeat of the same one.
 */
export function nextEnforcementState(
  previous: EnforcementLatchState,
  decision: EnforcementInput,
  nowMs: number
): EnforcementTransition {
  const blocking = decision.activeRunDisposition === "cancel-pending";
  const next: EnforcementLatchState = {
    blocking,
    reason: blocking ? decision.reason : null,
    status: blocking ? decision.status : null,
    evaluatedAtMs: nowMs
  };

  if (!blocking) {
    return {
      next,
      shouldCancelPending: false,
      shouldAudit: previous.blocking,
      auditEvent: previous.blocking ? "LICENSE_ENFORCEMENT_CLEARED" : null
    };
  }

  const sameCause =
    previous.blocking && previous.reason === decision.reason && previous.status === decision.status;
  return {
    next,
    shouldCancelPending: true,
    shouldAudit: !sameCause,
    auditEvent: sameCause ? null : "LICENSE_ENFORCEMENT_ENGAGED"
  };
}

/**
 * How long a cached enforcement verdict may back the dispatch gate before it is re-derived.
 *
 * The gate is consulted at least twice a second per active run, and `evaluateRunGate()` reads the
 * license store from disk and recomputes the machine fingerprint — doing that per tick is both a
 * real cost and a new failure surface inside dispatch. Refreshing on this bound keeps a queued
 * instance's exposure to a newly-invalid license at 30s without any renderer involvement.
 */
export const DISPATCH_LATCH_MAX_AGE_MS = 30_000;

/** True when a cached verdict is too old to back a dispatch decision. */
export function isEnforcementStateStale(state: EnforcementLatchState, nowMs: number): boolean {
  return nowMs - state.evaluatedAtMs >= DISPATCH_LATCH_MAX_AGE_MS;
}
