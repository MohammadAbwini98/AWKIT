/**
 * Signing-key custody: refuse a private key that lives in a cloud-synced folder (awkit-5ea).
 *
 * A key under OneDrive/Dropbox/Google Drive/iCloud/Box is continuously copied to somebody's cloud
 * account — including that provider's version history and recycle bin — so "local and git-ignored"
 * is not the same as "in custody". The rule first shipped for the offline dependency-manifest key
 * (`awkit-2l1`); this module is the canonical statement of it, used by the ISSUER key too, which
 * signs licences for other machines and therefore has the wider blast radius.
 *
 * Path reasoning only: no key is read, no filesystem is touched, nothing beyond `node:path` is
 * imported. That is what lets the app, the packaging script and the verifiers share one contract.
 *
 * NOTE ON DUPLICATION. `scripts/lib/release-key-custody.mjs` carries an equivalent implementation
 * because the packaging script runs under plain `node` and cannot import TypeScript (`allowJs` is
 * false, so the reverse direction is closed too). The two are held to the SAME behaviour by
 * `verify:release-key-custody`, which drives one shared fixture table through both and fails on any
 * divergence. Change this table and that one together, or the parity check will say so.
 */

import { resolve, sep } from "node:path";

/** Deliberate, owner-acknowledged exception. Never set this in a script or CI configuration. */
export const SYNCED_KEY_OVERRIDE_ENV = "AWKIT_ALLOW_SYNCED_SIGNING_KEY";

/**
 * Directory names meaning "this tree is continuously copied to a cloud account".
 * Matched as a WHOLE path segment, case-insensitively: `C:\work\onedriveclone` is not OneDrive, and
 * a substring match would refuse to sign there for no reason.
 */
const SYNC_SEGMENTS: ReadonlyArray<{ pattern: RegExp; provider: string }> = [
  { pattern: /^onedrive(\s*-.*)?$/i, provider: "OneDrive" },
  { pattern: /^dropbox$/i, provider: "Dropbox" },
  { pattern: /^google drive$/i, provider: "Google Drive" },
  { pattern: /^my drive$/i, provider: "Google Drive" },
  { pattern: /^googledrive$/i, provider: "Google Drive" },
  { pattern: /^iclouddrive$/i, provider: "iCloud Drive" },
  { pattern: /^box$/i, provider: "Box" },
  { pattern: /^pcloudrive$/i, provider: "pCloud" },
  { pattern: /^creative cloud files$/i, provider: "Adobe Creative Cloud" }
];

/** Environment variables the sync clients set themselves, pointing at their root. */
const SYNC_ENV_VARS: ReadonlyArray<{ name: string; provider: string }> = [
  { name: "OneDrive", provider: "OneDrive" },
  { name: "OneDriveConsumer", provider: "OneDrive" },
  { name: "OneDriveCommercial", provider: "OneDrive" }
];

/** Every provider this module can name — the parity check compares this against the script side. */
export const SYNC_PROVIDERS: readonly string[] = Array.from(
  new Set([...SYNC_SEGMENTS.map((s) => s.provider), ...SYNC_ENV_VARS.map((s) => s.provider)])
).sort();

export interface SyncedRootVerdict {
  synced: boolean;
  provider: string | null;
  /** Why it matched, for an actionable message: `inside %OneDrive%` or `path segment "Dropbox"`. */
  reason: string | null;
}

type Env = Record<string, string | undefined>;

function normalizeForCompare(value: string): string {
  return resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}

/** True when `child` is `parent` or sits underneath it. */
function isWithin(child: string, parent: string): boolean {
  const c = normalizeForCompare(child);
  const p = normalizeForCompare(parent);
  return c === p || c.startsWith(p + sep.toLowerCase()) || c.startsWith(p + "/");
}

/**
 * Is this path inside a cloud-synced tree? Checks the sync clients' own environment variables first
 * (authoritative when present), then whole path segments (catches a relocated or secondary root).
 */
export function detectSyncedRoot(keyPath: string, env: Env = process.env): SyncedRootVerdict {
  const absolute = resolve(keyPath);

  for (const candidate of SYNC_ENV_VARS) {
    const root = env[candidate.name];
    if (root && root.trim() && isWithin(absolute, root)) {
      return { synced: true, provider: candidate.provider, reason: `inside %${candidate.name}%` };
    }
  }

  for (const segment of absolute.split(/[\\/]+/)) {
    for (const rule of SYNC_SEGMENTS) {
      if (rule.pattern.test(segment)) {
        return { synced: true, provider: rule.provider, reason: `path segment "${segment}"` };
      }
    }
  }

  return { synced: false, provider: null, reason: null };
}

/**
 * Replace a home / LOCALAPPDATA prefix with the variable name, so a message can name a location
 * without printing somebody's account name into a log, a toast or a support transcript.
 */
export function redactKeyPath(value: string, env: Env = process.env): string {
  const candidates = [
    { root: env.LOCALAPPDATA, token: "%LOCALAPPDATA%" },
    { root: env.USERPROFILE, token: "%USERPROFILE%" },
    { root: env.HOME, token: "$HOME" }
  ].filter((c): c is { root: string; token: string } => !!c.root && c.root.trim().length > 0);
  // Longest root first, so %LOCALAPPDATA% wins over the %USERPROFILE% it sits inside.
  candidates.sort((a, b) => b.root.length - a.root.length);
  let out = resolve(value);
  for (const candidate of candidates) {
    const root = resolve(candidate.root);
    if (isWithin(out, root)) {
      out = candidate.token + out.slice(root.length);
      break;
    }
  }
  return out;
}

export interface KeyCustodyDecision {
  /** True when the key may be used. */
  allowed: boolean;
  /** True when it was only allowed because the operator set the override. */
  overridden: boolean;
  provider: string | null;
  reason: string | null;
  /** Redacted path, safe to show or log. */
  redactedPath: string;
}

/**
 * Decide whether a private key at `keyPath` may be used.
 *
 * Fails CLOSED. A warning would be ignored by the next issuance or release build, which is exactly
 * how the material ends up in a cloud account in the first place.
 */
export function evaluateKeyCustody(keyPath: string, env: Env = process.env): KeyCustodyDecision {
  const verdict = detectSyncedRoot(keyPath, env);
  const redactedPath = redactKeyPath(keyPath, env);
  if (!verdict.synced) {
    return { allowed: true, overridden: false, provider: null, reason: null, redactedPath };
  }
  const overridden = env[SYNCED_KEY_OVERRIDE_ENV] === "1";
  return {
    allowed: overridden,
    overridden,
    provider: verdict.provider,
    reason: verdict.reason,
    redactedPath
  };
}
