/** Dependency-free contracts shared by the issuer renderer, preload, and trusted main process. */
import type { ActivationRequest, Entitlement, LicenseType, SignatureAlgorithm } from "../LicenseTypes";
import type { IssuerKeySource } from "./IssuerLocations";

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
  /** Nothing at the expected path. The operator must provision the key there. */
  | "ISSUER_KEY_MISSING"
  /** The key is in a cloud-synced folder, so its custody cannot be assured (awkit-5ea). */
  | "ISSUER_KEY_UNSAFE_LOCATION"
  /** The file is there but this process cannot open it — permissions, a lock, or a directory. */
  | "ISSUER_KEY_INACCESSIBLE"
  /** The bytes were read but are not a PKCS8 Ed25519 private key. */
  | "ISSUER_KEY_INVALID"
  | "ISSUER_KEY_MISMATCH"
  | "ISSUER_KEY_RETIRED"
  /** The configured key id names no key in `TRUSTED_KEYS` — a build/config mismatch, not a bad file. */
  | "ISSUER_KEY_UNKNOWN_ID"
  /** No defensible path to look at: unresolvable runtime root, relative override, unusable key id. */
  | "ISSUER_KEY_LOCATION_INVALID"
  | "ISSUER_WRITE_FAILED";

/**
 * What the issuer can say about its signing key, coarse enough to drive a UI and precise enough to
 * tell an operator what to DO.
 *
 * A single `ready: boolean` could not distinguish "provision the key here" from "you cannot read the
 * key you already have" from "this build does not trust the key id you configured" — three different
 * actions that all rendered as "Key unavailable".
 */
export const ISSUER_READINESS_STATES = [
  "READY",
  "MISSING",
  "INACCESSIBLE",
  "INVALID_FORMAT",
  "CONFIGURATION_ERROR"
] as const;

export type IssuerReadinessState = (typeof ISSUER_READINESS_STATES)[number];

/**
 * The one mapping from refusal to state. Exhaustive by type, so a new reason code cannot be added
 * without deciding which state it belongs to.
 *
 * `ISSUER_KEY_MISMATCH` / `ISSUER_KEY_RETIRED` are CONFIGURATION_ERROR rather than INVALID_FORMAT on
 * purpose: the file parsed perfectly well, it is simply not the key this issuer is configured to use.
 */
export const ISSUER_READINESS_STATE_BY_REASON: Readonly<Record<IssuerReasonCode, IssuerReadinessState>> = {
  ACTIVATION_REQUEST_INVALID: "CONFIGURATION_ERROR",
  ISSUER_OPTIONS_INVALID: "CONFIGURATION_ERROR",
  ISSUER_KEY_MISSING: "MISSING",
  ISSUER_KEY_UNSAFE_LOCATION: "CONFIGURATION_ERROR",
  ISSUER_KEY_INACCESSIBLE: "INACCESSIBLE",
  ISSUER_KEY_INVALID: "INVALID_FORMAT",
  ISSUER_KEY_MISMATCH: "CONFIGURATION_ERROR",
  ISSUER_KEY_RETIRED: "CONFIGURATION_ERROR",
  ISSUER_KEY_UNKNOWN_ID: "CONFIGURATION_ERROR",
  ISSUER_KEY_LOCATION_INVALID: "CONFIGURATION_ERROR",
  ISSUER_WRITE_FAILED: "CONFIGURATION_ERROR"
};

export function issuerReadinessStateFor(reason: IssuerReasonCode | undefined): IssuerReadinessState {
  if (reason === undefined) return "READY";
  return ISSUER_READINESS_STATE_BY_REASON[reason] ?? "CONFIGURATION_ERROR";
}

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
  /** `true` exactly when `state === "READY"`. Kept so existing call sites keep reading correctly. */
  ready: boolean;
  state: IssuerReadinessState;
  keyId: string;
  outputDirectory: string;
  /** Which of the two legitimate sources the key path came from. Carries no path. */
  keySource: IssuerKeySource;
  /**
   * Redacted (`%LOCALAPPDATA%\…`) location where the external key is expected, so an operator can
   * provision it — or `null` where the surface must not learn a key path at all.
   *
   * Disclosed on the trusted Electron IPC boundary only. The Program Status dashboard is a BROWSER
   * surface served over HTTP, so its bridge leaves this `null`; `verify:roadmap-license-issuer`
   * asserts no HTTP readiness body ever contains one. It is a location, never key material.
   */
  expectedKeyLocation: string | null;
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
