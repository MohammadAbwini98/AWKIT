import { LicenseStatus } from "./LicenseTypes";

export type LicenseAttentionTone = "warning" | "danger";

export interface LicenseAttention {
  readonly label: string;
  readonly tone: LicenseAttentionTone;
}

/** Background refresh cadence; focus/visibility changes also trigger immediate revalidation. */
export const LICENSE_REVALIDATE_INTERVAL_MS = 15 * 60 * 1000;

const ATTENTION_BY_STATUS: Readonly<Partial<Record<LicenseStatus, LicenseAttention>>> = {
  [LicenseStatus.NOT_ACTIVATED]: { label: "Not activated", tone: "warning" },
  [LicenseStatus.EXPIRING_SOON]: { label: "Expiring soon", tone: "warning" },
  [LicenseStatus.EXPIRED]: { label: "Expired", tone: "danger" },
  [LicenseStatus.INVALID_SIGNATURE]: { label: "Invalid signature", tone: "danger" },
  [LicenseStatus.MACHINE_MISMATCH]: { label: "Machine mismatch", tone: "danger" },
  [LicenseStatus.NOT_YET_VALID]: { label: "Not yet valid", tone: "warning" },
  [LicenseStatus.REVOKED]: { label: "Revoked", tone: "danger" },
  [LicenseStatus.CORRUPTED]: { label: "Corrupted", tone: "danger" },
  [LicenseStatus.CLOCK_INTEGRITY_WARNING]: { label: "Clock warning", tone: "danger" },
  [LicenseStatus.UNSUPPORTED_VERSION]: { label: "Unsupported license", tone: "danger" }
};

/** Healthy licenses stay silent; every status requiring attention maps to a compact global label. */
export function licenseAttentionFor(status: LicenseStatus): LicenseAttention | null {
  if (status === LicenseStatus.VALID) return null;
  return ATTENTION_BY_STATUS[status] ?? { label: "Needs attention", tone: "danger" };
}
