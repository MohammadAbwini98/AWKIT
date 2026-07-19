/**
 * Trusted PUBLIC verification keys embedded in SpecterStudio.
 *
 * PUBLIC keys only — safe to ship and commit. The matching PRIVATE signing keys live exclusively in the
 * offline issuer (tools/license-issuer), sourced from an external key file / env var, and are NEVER placed
 * in source control, application resources, `.env`, or the packaged app.
 *
 * Key rotation: add a new entry with a new `keyId` and start issuing licenses that reference it via
 * `signingKeyId`. Old keys remain here until every license they signed has expired, so both validate
 * during the overlap. Never remove a key while licenses signed by it are still in the field.
 */
import type { SignatureAlgorithm } from "../LicenseTypes";

export interface TrustedKey {
  keyId: string;
  algorithm: SignatureAlgorithm;
  /** SPKI DER public key, base64. */
  publicKeySpkiB64: string;
  /** Optional: keys past this date verify existing licenses but should not sign new ones. */
  retired?: boolean;
}

/**
 * Production trusted keys. `key1` is the initial SpecterStudio licensing key (Ed25519). The private half
 * was generated offline and stored outside the repo; only this public half ships.
 */
export const TRUSTED_KEYS: readonly TrustedKey[] = [
  {
    keyId: "key1",
    algorithm: "Ed25519",
    publicKeySpkiB64: "MCowBQYDK2VwAyEA4fwgg7+CJ2uSNVfy4XGtMoCkL3Zz+MqkP/4vfgag/JU="
  }
];

export function findTrustedKey(keyId: string, keys: readonly TrustedKey[] = TRUSTED_KEYS): TrustedKey | undefined {
  return keys.find((k) => k.keyId === keyId);
}
