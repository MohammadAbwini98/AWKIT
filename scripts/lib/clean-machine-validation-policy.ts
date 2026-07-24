/**
 * Canonical clean-machine validation policy (Track 4 — owner policy 2026-07-24).
 *
 * WHY THIS MODULE EXISTS. There is **no** executable release-promotion resolver in this repository:
 * the clean-machine validation gate has always been enforced by the runbook + the `docs/ai/` prose,
 * not by code or CI. (Verified during Track 4 Phase 1: `.github/workflows/ci.yml` runs only
 * typecheck + build; every `promote*` symbol under `src/` is workflow-instance queue / branch-pair
 * logic, unrelated to release; and the `clean-machine-acceptance` verifier class in
 * `verifier-classification.ts` has no npm script and blocks nothing.) This module is therefore the
 * SINGLE canonical definition of the policy that the documentation and the
 * `verify:clean-machine-policy` consistency verifier both derive from — it is a source of truth for
 * a documentation-enforced policy, **not** a new runtime gate that blocks anything at app runtime.
 *
 * OWNER POLICY (2026-07-24). Clean-machine validation is OPTIONAL and NON-BLOCKING for release
 * promotion. Execution status stays truthful:
 *   - not executed stays NOT EXECUTED (non-blocking),
 *   - a successful execution MAY be recorded as PASSED,
 *   - a FAILED execution stays FAILED and BLOCKING,
 *   - an explicit owner waiver is recorded as OWNER WAIVED / NON-BLOCKING.
 * The policy waives *execution* as a mandatory prerequisite; it does NOT convert a failed validation
 * into a non-blocking result, and it does NOT waive the checksum, offline-bundle, packaged-startup,
 * artifact-integrity, dependency-manifest, or security gates.
 */

/** The four truthful dispositions a clean-machine validation can hold. */
export type CleanMachineValidationStatus =
  | "passed"
  | "failed"
  | "not-executed-non-blocking"
  | "owner-waived-non-blocking";

export const CLEAN_MACHINE_VALIDATION_STATUSES: readonly CleanMachineValidationStatus[] = [
  "passed",
  "failed",
  "not-executed-non-blocking",
  "owner-waived-non-blocking"
] as const;

/** Whether the validation was actually run — kept separate from the policy disposition. */
export type CleanMachineExecutionStatus = "passed" | "failed" | "not-executed";
/** How policy treats the (non-)execution — separate from whether it ran. */
export type CleanMachinePolicyDisposition = "recorded" | "owner-waived" | "none";
/** UI/report indicator. `pass` (green) is reserved for an actually-executed pass. */
export type CleanMachineIndicator = "pass" | "blocked" | "neutral";

export interface CleanMachineGateResolution {
  status: CleanMachineValidationStatus;
  /** Whether validation actually ran, and its result. `not-executed` for unexecuted/waived. */
  executionStatus: CleanMachineExecutionStatus;
  /** The policy disposition, kept separate from execution state. */
  policyDisposition: CleanMachinePolicyDisposition;
  /** True ONLY when an actually-executed validation FAILED. Unexecuted/waived is never blocking. */
  blocking: boolean;
  /** Truthful human label. Never contains "PASSED" unless executionStatus === "passed". */
  label: string;
  /** UI indicator. Never "pass" (green) unless executionStatus === "passed". */
  indicator: CleanMachineIndicator;
}

/** Thrown when a clean-machine status is unknown/malformed — never silently treated as a waiver. */
export class CleanMachineValidationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanMachineValidationPolicyError";
  }
}

/** Type guard for the fixed status set. */
export function isCleanMachineValidationStatus(value: unknown): value is CleanMachineValidationStatus {
  return typeof value === "string" && (CLEAN_MACHINE_VALIDATION_STATUSES as readonly string[]).includes(value);
}

/**
 * Coerce untyped (e.g. JSON) input to a known status, FAILING SAFE on anything unrecognised.
 * A corrupt or unknown value must never be interpreted as an owner waiver.
 */
export function coerceCleanMachineValidationStatus(input: unknown): CleanMachineValidationStatus {
  if (isCleanMachineValidationStatus(input)) return input;
  throw new CleanMachineValidationPolicyError(
    `Unknown or malformed clean-machine validation status: ${JSON.stringify(input)} (expected one of ${CLEAN_MACHINE_VALIDATION_STATUSES.join(", ")})`
  );
}

/**
 * Resolve a clean-machine status into its truthful execution/policy/blocking/label facts.
 * Blocking matrix:
 *   passed                     → non-blocking (indicator: pass)
 *   failed                     → BLOCKING     (indicator: blocked)
 *   not-executed-non-blocking  → non-blocking (indicator: neutral)
 *   owner-waived-non-blocking  → non-blocking (indicator: neutral)
 * Unknown/malformed input fails safe (throws) — never a silent waiver.
 */
export function resolveCleanMachineGate(status: CleanMachineValidationStatus): CleanMachineGateResolution {
  if (!isCleanMachineValidationStatus(status)) {
    throw new CleanMachineValidationPolicyError(
      `Unknown or malformed clean-machine validation status: ${JSON.stringify(status)}`
    );
  }
  switch (status) {
    case "passed":
      return {
        status,
        executionStatus: "passed",
        policyDisposition: "recorded",
        blocking: false,
        label: "Clean-machine validation: PASSED",
        indicator: "pass"
      };
    case "failed":
      return {
        status,
        executionStatus: "failed",
        policyDisposition: "recorded",
        blocking: true,
        label: "Clean-machine validation: FAILED — BLOCKING",
        indicator: "blocked"
      };
    case "not-executed-non-blocking":
      return {
        status,
        executionStatus: "not-executed",
        policyDisposition: "none",
        blocking: false,
        label: "Clean-machine validation: NOT EXECUTED — NON-BLOCKING",
        indicator: "neutral"
      };
    case "owner-waived-non-blocking":
      return {
        status,
        executionStatus: "not-executed",
        policyDisposition: "owner-waived",
        blocking: false,
        label: "Clean-machine validation: OWNER WAIVED — NON-BLOCKING",
        indicator: "neutral"
      };
    default: {
      // Defensive: unreachable for the typed union, but a runtime bad value must fail safe.
      const bad: never = status;
      throw new CleanMachineValidationPolicyError(`Unhandled clean-machine validation status: ${JSON.stringify(bad)}`);
    }
  }
}

/**
 * The protected release gates this policy does NOT waive. Each remains mandatory and blocking on
 * failure, independent of the clean-machine disposition.
 */
export const PROTECTED_RELEASE_GATES = [
  "checksum",
  "offline-bundle",
  "packaged-startup",
  "artifact-integrity",
  "dependency-manifest",
  "security"
] as const;
export type ProtectedReleaseGate = (typeof PROTECTED_RELEASE_GATES)[number];

export interface ReleasePromotionInput {
  /** Current clean-machine disposition. */
  cleanMachine: CleanMachineValidationStatus;
  /** Protected gates that were ACTUALLY EXECUTED AND FAILED (empty means none failed). */
  failedProtectedGates?: readonly ProtectedReleaseGate[];
}

export interface ReleasePromotionDecision {
  blocked: boolean;
  blockingReasons: string[];
  cleanMachine: CleanMachineGateResolution;
}

/**
 * Aggregate release-promotion decision. Demonstrates — and is the canonical statement of — the fact
 * that a non-blocking clean-machine disposition contributes NO blocking reason, while a failed
 * clean-machine run and any failed protected gate each DO block. This is the reporting helper a
 * future real release script would import; it introduces no runtime app gate.
 */
export function resolveReleasePromotion(input: ReleasePromotionInput): ReleasePromotionDecision {
  const cleanMachine = resolveCleanMachineGate(input.cleanMachine);
  const blockingReasons: string[] = [];
  if (cleanMachine.blocking) blockingReasons.push(cleanMachine.label);
  for (const gate of input.failedProtectedGates ?? []) {
    if (!(PROTECTED_RELEASE_GATES as readonly string[]).includes(gate)) {
      throw new CleanMachineValidationPolicyError(`Unknown protected release gate: ${JSON.stringify(gate)}`);
    }
    blockingReasons.push(`Protected release gate FAILED — BLOCKING: ${gate}`);
  }
  return { blocked: blockingReasons.length > 0, blockingReasons, cleanMachine };
}

/** The current, dated owner decision — surfaced in generated release reports. */
export interface CleanMachineOwnerDecision {
  date: string;
  status: CleanMachineValidationStatus;
  decidedBy: string;
  note: string;
}

export const CLEAN_MACHINE_OWNER_DECISION: CleanMachineOwnerDecision = {
  date: "2026-07-24",
  status: "owner-waived-non-blocking",
  decidedBy: "project owner",
  note:
    "Owner waived clean-machine validation EXECUTION as a mandatory prerequisite for release " +
    "promotion. It is optional and non-blocking. Execution status stays truthful (currently NOT " +
    "EXECUTED — nothing is recorded as PASSED). A failed clean-machine execution would remain blocking."
};

/**
 * The canonical non-blocking policy statement. Documentation and reports MUST reproduce this text so
 * the `verify:clean-machine-policy` consistency check can confirm docs agree with this source.
 */
export const CLEAN_MACHINE_POLICY_STATEMENT = [
  "Clean-machine validation is optional and non-blocking by owner policy.",
  "Its execution status remains truthful:",
  "- not executed remains NOT EXECUTED;",
  "- successful execution may be recorded as PASSED;",
  "- failed execution remains FAILED and blocking;",
  "- an explicit owner waiver is recorded as OWNER WAIVED / NON-BLOCKING.",
  "",
  "This policy does not waive checksum, offline-bundle, packaged-startup,",
  "artifact-integrity, dependency-manifest, or security validation."
].join("\n");

/** Render the current owner decision as a single truthful report line. */
export function renderCleanMachineReportLine(
  decision: CleanMachineOwnerDecision = CLEAN_MACHINE_OWNER_DECISION
): string {
  const resolved = resolveCleanMachineGate(decision.status);
  return `${resolved.label} (owner decision ${decision.date}, by ${decision.decidedBy})`;
}
