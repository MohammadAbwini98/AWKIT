/**
 * License validation: given the installed license document, this machine's fingerprint, and the current
 * time, decide a single authoritative LicenseStatus. Pure and deterministic — all inputs are explicit, so
 * it is fully unit-verifiable. Enforcement lives in the trusted main process (Phase 5), which calls this.
 *
 * Status precedence (first match wins): CORRUPTED → UNSUPPORTED_VERSION → INVALID_SIGNATURE →
 * MACHINE_MISMATCH → REVOKED → CLOCK_INTEGRITY_WARNING → NOT_YET_VALID → EXPIRED → EXPIRING_SOON → VALID.
 */
import {
  DEFAULT_LICENSE_POLICY,
  LICENSE_SCHEMA_VERSION,
  LicenseStatus,
  OPERABLE_STATUSES,
  type LicenseDocument,
  type LicensePolicy,
  type LicenseReasonCode,
  type LicenseValidationResult,
  type SafeLicenseView
} from "./LicenseTypes";
import { verifyLicenseSignature } from "./crypto/LicenseSignature";
import type { TrustedKey } from "./crypto/TrustedKeys";

export interface ValidationInputs {
  license: LicenseDocument | null;
  /** Hash of the fingerprint computed on THIS machine right now. */
  currentFingerprintHash: string;
  /** Current wall-clock time (ms). Injected for testability. */
  nowMs: number;
  /** Highest time previously observed by the store, for rollback detection (ms). */
  clockHighWaterMs?: number;
  /** Set when the license was revoked/removed locally. */
  locallyRevoked?: boolean;
  policy?: LicensePolicy;
  /** Override trusted keys (tests inject an ephemeral key; the app uses the embedded defaults). */
  trustedKeys?: readonly TrustedKey[];
}

const ISO_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Defensive structural check — a malformed/tampered document is treated as CORRUPTED, not trusted. */
function isStructurallyValid(license: LicenseDocument): boolean {
  const stringFields: (keyof LicenseDocument)[] = [
    "licenseId",
    "serialNumber",
    "product",
    "machineFingerprintHash",
    "issuedAtUtc",
    "validFromUtc",
    "expiresAtUtc",
    "licenseType",
    "issuer",
    "signingKeyId",
    "signatureAlgorithm",
    "signature"
  ];
  for (const field of stringFields) {
    const value = license[field];
    if (typeof value !== "string" || value.length === 0) return false;
  }
  if (typeof license.schemaVersion !== "number") return false;
  if (!Array.isArray(license.entitlements)) return false;
  for (const ts of [license.issuedAtUtc, license.validFromUtc, license.expiresAtUtc]) {
    if (!ISO_MINUTE.test(ts) || Number.isNaN(Date.parse(ts))) return false;
  }
  return true;
}

function maskSerial(serial: string): string {
  const trimmed = serial.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••-${trimmed.slice(-4)}`;
}

function toSafeView(license: LicenseDocument): SafeLicenseView {
  return {
    licenseId: license.licenseId,
    serialNumberMasked: maskSerial(license.serialNumber),
    product: license.product,
    licenseType: license.licenseType,
    entitlements: [...license.entitlements],
    issuer: license.issuer,
    signingKeyId: license.signingKeyId,
    issuedAtUtc: license.issuedAtUtc,
    validFromUtc: license.validFromUtc,
    expiresAtUtc: license.expiresAtUtc,
    machineFingerprintHash: license.machineFingerprintHash
  };
}

const REASON_ACTION: Record<LicenseStatus, { reasonCode: LicenseReasonCode; userAction: string }> = {
  [LicenseStatus.NOT_ACTIVATED]: {
    reasonCode: "NO_LICENSE_INSTALLED",
    userAction: "Export an activation request and import a signed license to activate this machine."
  },
  [LicenseStatus.VALID]: { reasonCode: "LICENSE_OK", userAction: "No action needed." },
  [LicenseStatus.EXPIRING_SOON]: {
    reasonCode: "LICENSE_EXPIRING_SOON",
    userAction: "Your license expires soon. Request and import a renewal to avoid interruption."
  },
  [LicenseStatus.EXPIRED]: {
    reasonCode: "LICENSE_EXPIRED",
    userAction: "This license has expired. Import a renewed license to resume licensed operations."
  },
  [LicenseStatus.INVALID_SIGNATURE]: {
    reasonCode: "SIGNATURE_INVALID",
    userAction: "The license could not be verified. Re-import the original signed license file."
  },
  [LicenseStatus.MACHINE_MISMATCH]: {
    reasonCode: "MACHINE_DOES_NOT_MATCH",
    userAction: "This license belongs to a different machine. Request a license for this machine."
  },
  [LicenseStatus.NOT_YET_VALID]: {
    reasonCode: "LICENSE_NOT_YET_VALID",
    userAction: "This license is not valid yet. It will activate at its valid-from time."
  },
  [LicenseStatus.REVOKED]: {
    reasonCode: "LICENSE_REVOKED",
    userAction: "This license was revoked. Import a new signed license to continue."
  },
  [LicenseStatus.CORRUPTED]: {
    reasonCode: "LICENSE_FILE_CORRUPTED",
    userAction: "The stored license is unreadable. Re-import the original signed license file."
  },
  [LicenseStatus.CLOCK_INTEGRITY_WARNING]: {
    reasonCode: "CLOCK_ROLLBACK_SUSPECTED",
    userAction: "The system clock appears to have moved backward. Correct the date/time and revalidate."
  },
  [LicenseStatus.UNSUPPORTED_VERSION]: {
    reasonCode: "SCHEMA_OR_ALGORITHM_UNSUPPORTED",
    userAction: "This license needs a newer version of SpecterStudio. Update the application."
  }
};

function result(
  status: LicenseStatus,
  nowMs: number,
  license?: LicenseDocument,
  remainingMinutes?: number
): LicenseValidationResult {
  const { reasonCode, userAction } = REASON_ACTION[status];
  return {
    status,
    reasonCode,
    userAction,
    operable: OPERABLE_STATUSES.has(status),
    license: license ? toSafeView(license) : undefined,
    remainingMinutes,
    checkedAtUtc: new Date(nowMs).toISOString()
  };
}

/** Validate the installed license against this machine and the current time. */
export function validateLicense(inputs: ValidationInputs): LicenseValidationResult {
  const policy = inputs.policy ?? DEFAULT_LICENSE_POLICY;
  const { license, nowMs } = inputs;

  if (!license) return result(LicenseStatus.NOT_ACTIVATED, nowMs);
  if (!isStructurallyValid(license)) return result(LicenseStatus.CORRUPTED, nowMs);
  if (license.schemaVersion !== LICENSE_SCHEMA_VERSION) return result(LicenseStatus.UNSUPPORTED_VERSION, nowMs, license);

  const sig = verifyLicenseSignature(license, inputs.trustedKeys);
  if (!sig.ok) {
    if (sig.reason === "UNSUPPORTED_ALGORITHM") return result(LicenseStatus.UNSUPPORTED_VERSION, nowMs, license);
    return result(LicenseStatus.INVALID_SIGNATURE, nowMs, license);
  }

  if (license.machineFingerprintHash !== inputs.currentFingerprintHash) {
    return result(LicenseStatus.MACHINE_MISMATCH, nowMs, license);
  }

  if (inputs.locallyRevoked) return result(LicenseStatus.REVOKED, nowMs, license);

  // Clock integrity: a "now" earlier than the highest previously-observed time (beyond tolerance) means the
  // clock may have been rolled back, so time-based checks cannot be trusted. Best-effort, not tamper-proof.
  if (
    inputs.clockHighWaterMs != null &&
    nowMs < inputs.clockHighWaterMs - policy.clockSkewToleranceMs
  ) {
    return result(LicenseStatus.CLOCK_INTEGRITY_WARNING, nowMs, license);
  }

  const validFromMs = Date.parse(license.validFromUtc);
  const expiresMs = Date.parse(license.expiresAtUtc);
  const remainingMinutes = Math.floor((expiresMs - nowMs) / 60000);

  if (nowMs < validFromMs) return result(LicenseStatus.NOT_YET_VALID, nowMs, license, remainingMinutes);
  // Expire AT the exact timestamp: now >= expiresAt is expired.
  if (nowMs >= expiresMs) return result(LicenseStatus.EXPIRED, nowMs, license, remainingMinutes);
  if (expiresMs - nowMs <= policy.expiringSoonMs) {
    return result(LicenseStatus.EXPIRING_SOON, nowMs, license, remainingMinutes);
  }
  return result(LicenseStatus.VALID, nowMs, license, remainingMinutes);
}

export const __test__ = { isStructurallyValid, maskSerial };
