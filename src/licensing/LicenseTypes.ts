/**
 * Licensing bounded context — domain types.
 *
 * Licensing is INDEPENDENT of authentication and RBAC: it answers only "may this installation execute
 * licensed capabilities on THIS machine?" — never "who is the user?" or "what may the user do?". Nothing
 * in this module imports from `src/security/*`, and licensing failure must never mutate auth/RBAC data.
 *
 * Trust boundaries:
 * - The app ships ONLY public verification keys (see crypto/TrustedKeys.ts). Private signing keys live in
 *   the separate offline issuer (tools/license-issuer), never in the packaged app / source control / .env.
 * - Machine identity is a normalised, hashed fingerprint (MachineFingerprint.ts) — never an IP address,
 *   never a hostname alone, never a MAC alone, and raw signals are never persisted or displayed.
 */

/** Bump when the signed-license wire format changes in a non-backwards-compatible way. */
export const LICENSE_SCHEMA_VERSION = 1 as const;

/** Signature algorithms the runtime accepts. Ed25519 is offline, dependency-free (Node crypto), and fast. */
export type SignatureAlgorithm = "Ed25519";

/** Entitlement keys gate licensed capabilities. Extendable without coupling to authentication/RBAC. */
export type Entitlement =
  | "workflow.execute"
  | "workflow.concurrent"
  | "workflow.scheduled"
  | "automation.browser"
  | (string & {});

export type LicenseType = "trial" | "standard" | "enterprise" | (string & {});

/**
 * The signed license document. Every field except `signature` is covered by the signature over the
 * canonical payload bytes (see LicenseCanonical.ts). All timestamps are UTC ISO-8601 with minute
 * precision or finer.
 */
export interface LicenseDocument {
  schemaVersion: number;
  licenseId: string;
  serialNumber: string;
  product: string;
  /** Hash of the target machine fingerprint this license is bound to (never a raw hardware value). */
  machineFingerprintHash: string;
  issuedAtUtc: string;
  validFromUtc: string;
  expiresAtUtc: string;
  licenseType: LicenseType;
  entitlements: Entitlement[];
  /** Human/organisational issuer label (e.g. "SpecterStudio Licensing"). */
  issuer: string;
  /** Which trusted verification key signed this license — supports key rotation/versioning. */
  signingKeyId: string;
  signatureAlgorithm: SignatureAlgorithm;
  /** Base64 signature over the canonical payload (all fields except this one). */
  signature: string;
}

/** Explicit, exhaustive license status codes. Each maps to a safe reason + recommended user action. */
export enum LicenseStatus {
  NOT_ACTIVATED = "NOT_ACTIVATED",
  VALID = "VALID",
  EXPIRING_SOON = "EXPIRING_SOON",
  EXPIRED = "EXPIRED",
  INVALID_SIGNATURE = "INVALID_SIGNATURE",
  MACHINE_MISMATCH = "MACHINE_MISMATCH",
  NOT_YET_VALID = "NOT_YET_VALID",
  REVOKED = "REVOKED",
  CORRUPTED = "CORRUPTED",
  CLOCK_INTEGRITY_WARNING = "CLOCK_INTEGRITY_WARNING",
  UNSUPPORTED_VERSION = "UNSUPPORTED_VERSION"
}

/** Statuses under which new protected operations are permitted. */
export const OPERABLE_STATUSES: ReadonlySet<LicenseStatus> = new Set([
  LicenseStatus.VALID,
  LicenseStatus.EXPIRING_SOON
]);

export type ConfidenceLevel = "high" | "medium" | "limited";

/**
 * A machine fingerprint. `fingerprintHash` is the only value safe to persist/display; `availableSignals`
 * lists which signal CATEGORIES contributed (not their raw values) for diagnostics and confidence.
 */
export interface MachineFingerprint {
  algorithmVersion: number;
  fingerprintHash: string;
  availableSignals: string[];
  confidenceLevel: ConfidenceLevel;
  generatedAtUtc: string;
}

/** Exportable, privacy-safe activation request handed to the offline issuer. Contains no secrets. */
export interface ActivationRequest {
  schemaVersion: number;
  product: string;
  appVersion: string;
  fingerprintAlgorithmVersion: number;
  fingerprintHash: string;
  availableSignals: string[];
  confidenceLevel: ConfidenceLevel;
  requestId: string;
  generatedAtUtc: string;
}

/** Safe, machine-readable reason codes surfaced to the UI (never leak signatures/keys/raw hardware). */
export type LicenseReasonCode =
  | "NO_LICENSE_INSTALLED"
  | "LICENSE_OK"
  | "LICENSE_EXPIRING_SOON"
  | "LICENSE_EXPIRED"
  | "SIGNATURE_INVALID"
  | "MACHINE_DOES_NOT_MATCH"
  | "LICENSE_NOT_YET_VALID"
  | "LICENSE_REVOKED"
  | "LICENSE_FILE_CORRUPTED"
  | "CLOCK_ROLLBACK_SUSPECTED"
  | "SCHEMA_OR_ALGORITHM_UNSUPPORTED";

/** The result of validating the installed license against this machine and the current time. */
export interface LicenseValidationResult {
  status: LicenseStatus;
  reasonCode: LicenseReasonCode;
  /** Short, safe, actionable guidance for the user. Technical detail stays in structured logs. */
  userAction: string;
  /** Whether new protected operations may start under this result. */
  operable: boolean;
  /** Present when a license document was loaded (even if invalid) — for display, already de-secreted. */
  license?: SafeLicenseView;
  /** Whole-minutes remaining until expiry when known (negative if already expired). */
  remainingMinutes?: number;
  checkedAtUtc: string;
}

/** A display projection of a license with the serial masked and the signature omitted. */
export interface SafeLicenseView {
  licenseId: string;
  serialNumberMasked: string;
  product: string;
  licenseType: LicenseType;
  entitlements: Entitlement[];
  issuer: string;
  signingKeyId: string;
  issuedAtUtc: string;
  validFromUtc: string;
  expiresAtUtc: string;
  machineFingerprintHash: string;
}

/** Policy knobs for validation (expiring-soon window, allowed clock skew). */
export interface LicensePolicy {
  /** How far ahead of expiry to surface EXPIRING_SOON. */
  expiringSoonMs: number;
  /** Tolerated backward clock movement before flagging CLOCK_INTEGRITY_WARNING. */
  clockSkewToleranceMs: number;
}

export const DEFAULT_LICENSE_POLICY: LicensePolicy = {
  expiringSoonMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  clockSkewToleranceMs: 6 * 60 * 60 * 1000 // 6 hours
};
