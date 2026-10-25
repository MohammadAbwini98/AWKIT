/**
 * AWKIT-SEC-007: the session reference as security audit records hold it.
 *
 * A session reference is the session's id: 256 random bits (`SessionManager.create`), and while the session is live
 * it is a bearer value on the explicit-ref `security:admin:*` channels. The audit trail only ever needs to CORRELATE
 * rows of one session, so it stores a one-way digest instead: `sref1:` plus the first 32 hex characters (128 bits) of
 * SHA-256 over the reference. With a 256-bit random input the digest cannot be reversed or guessed, and the same
 * session always yields the same digest, so correlation across its LOGIN, REAUTH, LOGOUT and denial rows survives.
 *
 * Applied at the single audit sink (`SecurityStore.appendAudit`) and by the store migration that rewrites older rows,
 * so no audit writer can persist a raw reference, whatever it passes in.
 */
import { createHash } from "node:crypto";

export const AUDIT_SESSION_DIGEST_PREFIX = "sref1:";
const DIGEST = /^sref1:[0-9a-f]{32}$/;

/** True when the value is already a session digest (idempotent backfill, and the verifier's shape check). */
export function isAuditSessionDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

/** The audit representation of a session reference: null stays null; a digest stays as it is; anything else is hashed. */
export function auditSessionDigest(sessionRef: string | null | undefined): string | null {
  if (sessionRef === null || sessionRef === undefined || sessionRef === "") return null;
  if (isAuditSessionDigest(sessionRef)) return sessionRef;
  return AUDIT_SESSION_DIGEST_PREFIX + createHash("sha256").update(sessionRef, "utf8").digest("hex").slice(0, 32);
}
