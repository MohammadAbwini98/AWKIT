/**
 * Pure licensing run-gate policy used by the Electron execution gate and randomized lifecycle
 * campaigns.
 *
 * Owner decision 2026-07-29 (bd `awkit-1cc`): enforcement is ON by default. This module is the
 * single place the allow/block table lives, so the Electron gate, the packaged negative-case suite
 * and the lifecycle campaigns all decide identically. Keeping it separate from status discovery lets
 * tests drive the exact production rule without Electron or fabricated license files.
 *
 * | Status                        | New runs | Active runs      | Grace |
 * |-------------------------------|----------|------------------|-------|
 * | VALID / EXPIRING_SOON         | allow    | allow            | n/a   |
 * | NOT_ACTIVATED                 | block    | allow to finish  | yes   |
 * | EXPIRED                       | block    | allow to finish  | no    |
 * | INVALID_SIGNATURE             | block    | cancel pending   | no    |
 * | MACHINE_MISMATCH              | block    | cancel pending   | no    |
 * | CORRUPTED                     | block    | cancel pending   | no    |
 * | REVOKED / NOT_YET_VALID /     | block    | cancel pending   | no    |
 * | UNSUPPORTED_VERSION /         |          |                  |       |
 * | CLOCK_INTEGRITY_WARNING       |          |                  |       |
 * | evaluation failed             | block    | allow to finish  | no    |
 *
 * The integrity states cancel pending work because the license material itself cannot be trusted;
 * the two "user simply has not licensed yet" states do not interrupt work already in flight.
 * Evaluation failure blocks new runs but never kills a running one — a transient internal fault is
 * not evidence of a licensing violation.
 */
import { LicenseStatus } from "./LicenseTypes";

/**
 * What must happen to work that is already dispatched.
 * - `allow-to-finish`: running instances complete; only NEW runs are refused.
 * - `cancel-pending`: instances that have not started executing are cancelled before they start.
 */
export type ActiveRunDisposition = "allow-to-finish" | "cancel-pending";

export type RunGateReason =
  | "ENFORCEMENT_DISABLED"
  | "LICENSE_OPERABLE"
  | "MIGRATION_GRACE"
  | "NOT_LICENSED"
  | "LICENSE_EXPIRED"
  | "LICENSE_INTEGRITY_FAILURE"
  | "EVALUATION_FAILED";

export interface LicenseRunGateInput {
  readonly status: LicenseStatus;
  /** As computed by the validator — VALID / EXPIRING_SOON. */
  readonly operable: boolean;
  /** True when licensing could not be evaluated at all (store/fingerprint fault). */
  readonly evaluationFailed?: boolean;
}

export interface LicenseRunGateGrace {
  readonly inGrace: boolean;
  readonly graceEndsAtUtc?: string | null;
}

export interface LicenseRunGatePolicyDecision {
  readonly allowed: boolean;
  readonly blockedByLicense: boolean;
  readonly activeRunDisposition: ActiveRunDisposition;
  /** True when the run was admitted ONLY because the migration window is open. */
  readonly graceApplied: boolean;
  readonly reason: RunGateReason;
}

/**
 * Statuses where the license material cannot be trusted. Grace never applies to these, and pending
 * work is cancelled rather than allowed to drain.
 */
export const INTEGRITY_FAILURE_STATUSES: ReadonlySet<LicenseStatus> = new Set([
  LicenseStatus.INVALID_SIGNATURE,
  LicenseStatus.MACHINE_MISMATCH,
  LicenseStatus.CORRUPTED,
  LicenseStatus.REVOKED,
  LicenseStatus.NOT_YET_VALID,
  LicenseStatus.UNSUPPORTED_VERSION,
  LicenseStatus.CLOCK_INTEGRITY_WARNING
]);

/** The only status the one-time migration window can rescue. */
export const GRACE_ELIGIBLE_STATUSES: ReadonlySet<LicenseStatus> = new Set([LicenseStatus.NOT_ACTIVATED]);

export function applyLicenseRunGatePolicy(
  status: LicenseRunGateInput,
  enforcementEnabled: boolean,
  grace: LicenseRunGateGrace = { inGrace: false }
): LicenseRunGatePolicyDecision {
  if (!enforcementEnabled) {
    return {
      allowed: true,
      blockedByLicense: false,
      activeRunDisposition: "allow-to-finish",
      graceApplied: false,
      reason: "ENFORCEMENT_DISABLED"
    };
  }

  // Checked before `operable` so a fault that also happens to report operable can never admit a run.
  if (status.evaluationFailed) {
    return {
      allowed: false,
      blockedByLicense: true,
      activeRunDisposition: "allow-to-finish",
      graceApplied: false,
      reason: "EVALUATION_FAILED"
    };
  }

  // Integrity precedes everything else: a forged, foreign or corrupt license is never graced and
  // never allowed to drain pending work, regardless of what `operable` claims.
  if (INTEGRITY_FAILURE_STATUSES.has(status.status)) {
    return {
      allowed: false,
      blockedByLicense: true,
      activeRunDisposition: "cancel-pending",
      graceApplied: false,
      reason: "LICENSE_INTEGRITY_FAILURE"
    };
  }

  if (status.operable) {
    return {
      allowed: true,
      blockedByLicense: false,
      activeRunDisposition: "allow-to-finish",
      graceApplied: false,
      reason: "LICENSE_OPERABLE"
    };
  }

  if (grace.inGrace && GRACE_ELIGIBLE_STATUSES.has(status.status)) {
    return {
      allowed: true,
      blockedByLicense: false,
      activeRunDisposition: "allow-to-finish",
      graceApplied: true,
      reason: "MIGRATION_GRACE"
    };
  }

  return {
    allowed: false,
    blockedByLicense: true,
    activeRunDisposition: "allow-to-finish",
    graceApplied: false,
    reason: status.status === LicenseStatus.EXPIRED ? "LICENSE_EXPIRED" : "NOT_LICENSED"
  };
}
