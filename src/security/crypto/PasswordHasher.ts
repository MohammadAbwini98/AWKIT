/**
 * Password hashing with scrypt (Node built-in `node:crypto`) — chosen for zero native ABI, consistent
 * with this repo's deliberate `sql.js` "no native module" philosophy, and available identically in the
 * Node tsx verifiers and Electron 33's Node 20 main process. Argon2id is a documented future upgrade
 * (would add a native/wasm dependency).
 *
 * Record format (self-describing so cost can be raised later with rehash-on-login):
 *   scrypt$<N>$<r>$<p>$<keylen>$<saltB64>$<hashB64>
 *
 * See docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md §10.3.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  keylen: number;
}

/** N=2^15 · r=8 · p=1 → ~32 MiB, a modern interactive-login cost. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 1 << 15, r: 8, p: 1, keylen: 64 };

const SALT_BYTES = 16;

/** scrypt's memory need is ~128·N·r bytes; give headroom so scryptSync does not throw on maxmem. */
function maxmemFor(params: ScryptParams): number {
  return 256 * params.N * params.r + 1024 * 1024;
}

function derive(password: string, salt: Buffer, params: ScryptParams): Buffer {
  return scryptSync(password.normalize("NFKC"), salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: maxmemFor(params)
  });
}

/** Hash a password into a self-describing record string. */
export function hashPassword(password: string, params: ScryptParams = DEFAULT_SCRYPT): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = derive(password, salt, params);
  return ["scrypt", params.N, params.r, params.p, params.keylen, salt.toString("base64"), hash.toString("base64")].join("$");
}

interface ParsedRecord {
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
}

function parse(record: string): ParsedRecord | null {
  const parts = record.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt") return null;
  const [, nStr, rStr, pStr, keylenStr, saltB64, hashB64] = parts;
  const params: ScryptParams = { N: Number(nStr), r: Number(rStr), p: Number(pStr), keylen: Number(keylenStr) };
  if (![params.N, params.r, params.p, params.keylen].every((n) => Number.isInteger(n) && n > 0)) return null;
  try {
    return { params, salt: Buffer.from(saltB64, "base64"), hash: Buffer.from(hashB64, "base64") };
  } catch {
    return null;
  }
}

/** Constant-time verification of a password against a stored record. */
export function verifyPassword(password: string, record: string): boolean {
  const parsed = parse(record);
  if (!parsed) return false;
  const candidate = derive(password, parsed.salt, parsed.params);
  if (candidate.length !== parsed.hash.length) return false;
  return timingSafeEqual(candidate, parsed.hash);
}

/** Whether a stored record used weaker parameters than the current target (→ rehash on next login). */
export function needsRehash(record: string, params: ScryptParams = DEFAULT_SCRYPT): boolean {
  const parsed = parse(record);
  if (!parsed) return true;
  return (
    parsed.params.N < params.N ||
    parsed.params.r < params.r ||
    parsed.params.p < params.p ||
    parsed.params.keylen < params.keylen
  );
}
