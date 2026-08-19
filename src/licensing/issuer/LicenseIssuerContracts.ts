/** Dependency-free contracts shared by the issuer renderer, preload, and trusted main process. */
import type { ActivationRequest, Entitlement, LicenseType, SignatureAlgorithm } from "../LicenseTypes";

export const ISSUER_LICENSE_TYPES = ["trial", "standard", "enterprise"] as const;
export const ISSUER_ENTITLEMENTS = [
  "workflow.execute",
  "workflow.concurrent",
  "workflow.scheduled",
  "automation.browser"
] as const satisfies readonly Entitlement[];

/** Upper bound on any issued validity window, however it was expressed. */
export const ISSUER_MAX_VALIDITY_DAYS = 3650;
/**
 * Lower bound on an explicit window. One minute is the finest the signed format records
 * (`toMinuteIso` strips seconds), so anything shorter would round to a zero-length license.
 */
export const ISSUER_MIN_VALIDITY_MINUTES = 1;
/** How far ahead of now a window may start. A far-future start is far more likely a typo than intent. */
export const ISSUER_MAX_FUTURE_START_DAYS = 365;

export type IssuerReasonCode =
  | "ACTIVATION_REQUEST_INVALID"
  | "ISSUER_OPTIONS_INVALID"
  | "ISSUER_KEY_MISSING"
  /** The key is in a cloud-synced folder, so its custody cannot be assured (awkit-5ea). */
  | "ISSUER_KEY_UNSAFE_LOCATION"
  | "ISSUER_KEY_INVALID"
  | "ISSUER_KEY_MISMATCH"
  | "ISSUER_KEY_RETIRED"
  | "ISSUER_WRITE_FAILED";

/**
 * An explicit UTC validity window, to minute precision.
 *
 * The signed schema stores `validFromUtc`/`expiresAtUtc`, not a day count, so a caller that needs an
 * exact expiry — "expires 18 Sep 2026 19:30", or a one-hour evaluation license — states it here
 * rather than approximating with `validityDays`. Both forms end up in the same signed fields; this
 * one simply does not lose precision on the way.
 */
export interface IssueLicenseWindow {
  validFromUtc: string;
  expiresAtUtc: string;
}

export interface IssueLicenseInput {
  activationRequest: ActivationRequest;
  licenseType: (typeof ISSUER_LICENSE_TYPES)[number];
  /** Whole days from issuance. Mutually exclusive with `validityWindow` — supply exactly one. */
  validityDays?: number;
  /** Exact UTC boundaries. Mutually exclusive with `validityDays` — supply exactly one. */
  validityWindow?: IssueLicenseWindow;
  entitlements: Entitlement[];
}

export interface IssuerReadiness {
  ready: boolean;
  keyId: string;
  outputDirectory: string;
  reason?: IssuerReasonCode;
}

export interface IssuedLicenseResult {
  licenseId: string;
  serialNumber: string;
  licenseType: LicenseType;
  machineFingerprintHash: string;
  /** When the license was signed — distinct from `validFromUtc` for a post-dated window. */
  issuedAtUtc: string;
  validFromUtc: string;
  expiresAtUtc: string;
  entitlements: Entitlement[];
  product: string;
  issuer: string;
  signingKeyId: string;
  signatureAlgorithm: SignatureAlgorithm;
  fileName: string;
  outputPath: string;
}
