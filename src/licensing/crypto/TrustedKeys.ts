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
 * Production trusted keys. Every private half was generated offline and stored outside the repo; only
 * these public halves ship.
 *
 * - `key1` — the initial SpecterStudio licensing key. **Verification only from 2026-08-19**: its
 *   private half is not present on the current issuer workstation, so nothing new is signed with it.
 *   It stays here because licenses it already signed must keep validating; remove it only once every
 *   one of those has expired.
 * - `key2` — the active signing key from 2026-08-19. `DEFAULT_ISSUER_KEY_ID` in
 *   `issuer/IssuerLocations.ts` names it, which is what makes it the one the issuer actually uses.
 *
 * A build must ship this list before it will accept anything signed by a key in it. An installation
 * running an older build does not know `key2` and reports `UNKNOWN_KEY` -> INVALID_SIGNATURE for
 * licenses signed with it — so a rotation is a release, not a local edit.
 */
export const TRUSTED_KEYS: readonly TrustedKey[] = [
  {
    keyId: "key1",
    algorithm: "Ed25519",
    publicKeySpkiB64: "MCowBQYDK2VwAyEA4fwgg7+CJ2uSNVfy4XGtMoCkL3Zz+MqkP/4vfgag/JU=",
    // AWKIT-LIC-002 (fold-in): key1 is verification-only since 2026-08-19 — the issuer already
    // refuses retired keys mechanically, so the flag belongs here too.
    retired: true
  },
  {
    keyId: "key2",
    algorithm: "Ed25519",
    publicKeySpkiB64: "MCowBQYDK2VwAyEAp3pA/iUPJVmWBvaTB9K77+QwYyANYqSAiaAd9AgbHuw="
  }
];

export function findTrustedKey(keyId: string, keys: readonly TrustedKey[] = TRUSTED_KEYS): TrustedKey | undefined {
  return keys.find((k) => k.keyId === keyId);
}
