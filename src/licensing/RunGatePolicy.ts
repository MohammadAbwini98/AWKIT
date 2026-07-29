/**
 * Pure policy used by the Electron execution gate and randomized lifecycle campaigns.
 *
 * Keeping the decision separate from machine/file-system status discovery lets tests drive the
 * exact production allow/block rule without importing Electron or fabricating license files.
 */
export interface LicenseRunGateInput {
  readonly operable: boolean;
}

export interface LicenseRunGatePolicyDecision {
  readonly allowed: boolean;
  readonly blockedByLicense: boolean;
}

export function applyLicenseRunGatePolicy(
  status: LicenseRunGateInput,
  enforcementEnabled: boolean
): LicenseRunGatePolicyDecision {
  if (!enforcementEnabled) return { allowed: true, blockedByLicense: false };
  return { allowed: status.operable, blockedByLicense: !status.operable };
}
