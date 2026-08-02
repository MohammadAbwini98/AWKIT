/** Dependency-free contracts shared by the issuer renderer, preload, and trusted main process. */
import type { ActivationRequest, Entitlement, LicenseType } from "../LicenseTypes";

export const ISSUER_LICENSE_TYPES = ["trial", "standard", "enterprise"] as const;
export const ISSUER_ENTITLEMENTS = [
  "workflow.execute",
  "workflow.concurrent",
  "workflow.scheduled",
  "automation.browser"
] as const satisfies readonly Entitlement[];

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

export interface IssueLicenseInput {
  activationRequest: ActivationRequest;
  licenseType: (typeof ISSUER_LICENSE_TYPES)[number];
  validityDays: number;
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
  validFromUtc: string;
  expiresAtUtc: string;
  entitlements: Entitlement[];
  fileName: string;
  outputPath: string;
}
