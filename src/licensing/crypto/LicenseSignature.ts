/**
 * License signature verification (and an issuer-side signing helper).
 *
 * The app uses ONLY `verifyLicenseSignature`, which needs public keys alone. `signLicensePayload` is used
 * exclusively by the offline issuer, which supplies its own private key — it is never called from the
 * packaged app runtime, and no private key is imported here.
 */
import { createPublicKey, createPrivateKey, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { canonicalPayloadBytes, type LicensePayload } from "../LicenseCanonical";
import type { LicenseDocument, SignatureAlgorithm } from "../LicenseTypes";
import { findTrustedKey, type TrustedKey } from "./TrustedKeys";

const SUPPORTED_ALGORITHMS: ReadonlySet<SignatureAlgorithm> = new Set(["Ed25519"]);

function publicKeyFromSpkiB64(b64: string): KeyObject {
  return createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" });
}

export interface SignatureCheck {
  ok: boolean;
  /** Set when verification cannot even be attempted (unknown key / unsupported algorithm). */
  reason?: "UNKNOWN_KEY" | "UNSUPPORTED_ALGORITHM" | "BAD_SIGNATURE_ENCODING";
}

/**
 * Verify a license's signature over its canonical payload using the trusted key it references. Returns a
 * structured result: `ok:false` covers modified payloads, wrong keys, unsupported algorithms, and
 * malformed signatures — the caller maps these to INVALID_SIGNATURE / UNSUPPORTED_VERSION.
 */
export function verifyLicenseSignature(
  license: LicenseDocument,
  keys?: readonly TrustedKey[]
): SignatureCheck {
  if (!SUPPORTED_ALGORITHMS.has(license.signatureAlgorithm)) {
    return { ok: false, reason: "UNSUPPORTED_ALGORITHM" };
  }
  const trusted = findTrustedKey(license.signingKeyId, keys ?? undefined);
  if (!trusted) return { ok: false, reason: "UNKNOWN_KEY" };
  if (trusted.algorithm !== license.signatureAlgorithm) return { ok: false, reason: "UNSUPPORTED_ALGORITHM" };

  let signature: Buffer;
  try {
    signature = Buffer.from(license.signature, "base64");
    if (signature.length === 0) return { ok: false, reason: "BAD_SIGNATURE_ENCODING" };
  } catch {
    return { ok: false, reason: "BAD_SIGNATURE_ENCODING" };
  }

  try {
    const publicKey = publicKeyFromSpkiB64(trusted.publicKeySpkiB64);
    // Ed25519 uses a null digest algorithm in Node's one-shot sign/verify.
    const ok = cryptoVerify(null, canonicalPayloadBytes(license), publicKey, signature);
    return { ok };
  } catch {
    return { ok: false, reason: "BAD_SIGNATURE_ENCODING" };
  }
}

/**
 * Issuer-only: sign a payload with a private key (PKCS8 DER, base64). NOT used by the app runtime.
 * Kept here so the canonical-bytes function is shared between signing and verifying (one source of truth).
 */
export function signLicensePayload(payload: LicensePayload, privateKeyPkcs8B64: string): string {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8B64, "base64"),
    format: "der",
    type: "pkcs8"
  });
  const signature = cryptoSign(null, canonicalPayloadBytes(payload), privateKey);
  return signature.toString("base64");
}
