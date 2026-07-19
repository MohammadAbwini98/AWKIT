/**
 * Canonical byte encoding for license payloads. The signature is computed and verified over EXACTLY
 * these bytes, so signing and verifying must use this single function. Any change here is a wire-format
 * change and requires bumping LICENSE_SCHEMA_VERSION.
 */
import { randomUUID } from "node:crypto";
import {
  LICENSE_SCHEMA_VERSION,
  type ActivationRequest,
  type LicenseDocument,
  type MachineFingerprint
} from "./LicenseTypes";

/** The signed payload = the license document without its `signature` field. */
export type LicensePayload = Omit<LicenseDocument, "signature">;

/**
 * Deterministically serialise a value with object keys sorted, so equal payloads always produce equal
 * bytes regardless of property insertion order. Arrays keep their order (entitlement order is meaningful
 * only as data, not for equality here, but we preserve it to keep issuance stable).
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** The exact UTF-8 bytes covered by the signature. */
export function canonicalPayloadBytes(license: LicenseDocument | LicensePayload): Buffer {
  const { signature: _ignored, ...payload } = license as LicenseDocument;
  return Buffer.from(stableStringify(payload), "utf8");
}

/** Build a privacy-safe, exportable activation request from a machine fingerprint. */
export function buildActivationRequest(
  fingerprint: MachineFingerprint,
  product: string,
  appVersion: string
): ActivationRequest {
  return {
    schemaVersion: LICENSE_SCHEMA_VERSION,
    product,
    appVersion,
    fingerprintAlgorithmVersion: fingerprint.algorithmVersion,
    fingerprintHash: fingerprint.fingerprintHash,
    availableSignals: fingerprint.availableSignals,
    confidenceLevel: fingerprint.confidenceLevel,
    requestId: randomUUID(),
    generatedAtUtc: new Date().toISOString()
  };
}
