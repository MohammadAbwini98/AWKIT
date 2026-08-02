/**
 * Release signing-key custody (awkit-2l1).
 *
 * The offline-manifest private key used to live at `<repo>/.release-local/offline-manifest-private.pem`.
 * It is git-ignored and has never been tracked — but this repository sits inside a OneDrive-synced
 * folder, so "local and ignored" still meant "continuously copied to a cloud account". That is
 * custody outside the documented offline release boundary, regardless of Git.
 *
 * This module decides WHERE the key is read from and REFUSES to use one that sits in a synced tree.
 * It holds no key material and never reads a key file; it reasons about paths only, so it can be
 * unit-tested without a real key existing anywhere.
 *
 * Moving or rotating the actual key is deliberately NOT automated — that is owner action, under
 * owner control, per the acceptance criteria on awkit-2l1.
 */

import { resolve, sep } from "node:path";

/** Where a release key is expected to live: outside the repo, outside any synced tree. */
export const APPROVED_KEY_DIRNAME = "release-keys";
export const PRIVATE_KEY_FILENAME = "offline-manifest-private.pem";

/** Escape hatch for a deliberate, owner-acknowledged exception. Never set this in a script. */
export const OVERRIDE_ENV = "AWKIT_ALLOW_SYNCED_SIGNING_KEY";
export const KEY_PATH_ENV = "AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY";

/**
 * Directory names that mean "this tree is continuously copied to somebody's cloud account".
 * Matched as a WHOLE path segment, case-insensitively — `C:\work\onedriveclone` is not OneDrive, and
 * a substring match would refuse to sign there for no reason.
 */
const SYNC_SEGMENTS = [
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

/** Environment variables the sync clients themselves set, pointing at their root. */
const SYNC_ENV_VARS = [
  { name: "OneDrive", provider: "OneDrive" },
  { name: "OneDriveConsumer", provider: "OneDrive" },
  { name: "OneDriveCommercial", provider: "OneDrive" }
];

function normalizeForCompare(value) {
  return resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}

/** True when `child` is the same path as `parent` or sits underneath it. */
function isWithin(child, parent) {
  const c = normalizeForCompare(child);
  const p = normalizeForCompare(parent);
  return c === p || c.startsWith(p + sep.toLowerCase()) || c.startsWith(p + "/");
}

/**
 * Is this path inside a cloud-synced tree? Checks the sync clients' own environment variables first
 * (authoritative when present), then whole path segments (catches a relocated or secondary root).
 *
 * @returns {{ synced: boolean, provider: string | null, reason: string | null }}
 */
export function detectSyncedRoot(keyPath, env = process.env) {
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

/** The approved, non-synced key directory: `%LOCALAPPDATA%\SpecterStudio\release-keys`. */
export function approvedKeyDirectory(env = process.env) {
  const base = env.LOCALAPPDATA || env.XDG_DATA_HOME || env.HOME || ".";
  return resolve(base, "SpecterStudio", APPROVED_KEY_DIRNAME);
}

export function approvedKeyPath(env = process.env) {
  return resolve(approvedKeyDirectory(env), PRIVATE_KEY_FILENAME);
}

/** The historical in-repo location, kept only so its use can be recognised and refused. */
export function legacyKeyPath(repoRoot) {
  return resolve(repoRoot, ".release-local", PRIVATE_KEY_FILENAME);
}

/**
 * Decide which private key path to use.
 *
 * Order: explicit `--private-key` flag → `AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY` → the approved
 * directory (when a key is actually there) → the legacy in-repo path. The legacy path is still
 * resolvable on purpose: resolving to it produces a precise, actionable refusal, whereas pretending
 * it does not exist would produce a confusing "key is missing".
 *
 * @param {{ explicit?: string|null, env?: NodeJS.ProcessEnv, repoRoot: string, exists?: (p: string) => boolean }} options
 */
export function resolvePrivateKeyLocation({ explicit = null, env = process.env, repoRoot, exists = () => false }) {
  if (explicit) return describe(resolve(explicit), "flag", env);

  const fromEnv = env[KEY_PATH_ENV];
  if (fromEnv && fromEnv.trim()) return describe(resolve(fromEnv), "env", env);

  const approved = approvedKeyPath(env);
  if (exists(approved)) return describe(approved, "approved", env);

  return describe(legacyKeyPath(repoRoot), "legacy", env);
}

function describe(path, source, env) {
  const sync = detectSyncedRoot(path, env);
  return { path, source, synced: sync.synced, provider: sync.provider, reason: sync.reason };
}

/**
 * Replace the user's home / LOCALAPPDATA prefix with the variable name, so an error message can name
 * a location without printing somebody's account name into a log or a CI transcript.
 */
export function redactPath(value, env = process.env) {
  const candidates = [
    { root: env.LOCALAPPDATA, token: "%LOCALAPPDATA%" },
    { root: env.USERPROFILE, token: "%USERPROFILE%" },
    { root: env.HOME, token: "$HOME" }
  ].filter((c) => c.root && c.root.trim());
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

/**
 * Refuse to use a signing key that lives in a synced tree.
 *
 * Fails CLOSED: signing from a cloud-synced folder is the exact custody problem awkit-2l1 exists to
 * end, and a warning would be ignored by the next release build. The override exists so an owner can
 * make a deliberate exception, and says so in the message rather than hiding.
 *
 * @param {{ path: string, source: string, synced: boolean, provider: string|null, reason: string|null }} location
 */
export function assertKeyCustody(location, env = process.env) {
  if (!location.synced) return { ok: true, overridden: false };
  if (env[OVERRIDE_ENV] === "1") return { ok: true, overridden: true };

  const where = redactPath(location.path, env);
  throw new Error(
    [
      `Refusing to use an offline-manifest signing key stored in a ${location.provider}-synced location (${location.reason}).`,
      `Resolved from: ${location.source}${location.source === "legacy" ? " (in-repo .release-local)" : ""} -> ${where}`,
      "",
      "A key in a synced folder is continuously copied to a cloud account, which puts release signing",
      "material outside the offline release boundary even though it is git-ignored.",
      "",
      "Owner action (do this yourself — the tooling will not move or rotate signing material):",
      `  1. Move or re-provision the key into ${redactPath(approvedKeyPath(env), env)}`,
      `     (or set ${KEY_PATH_ENV} to a non-synced path).`,
      "  2. Securely remove the synced copy, including the provider's cloud recycle bin / version history.",
      "  3. Re-run: node scripts/offline-manifest-signature.mjs verify",
      "",
      `Deliberate exception (not recommended): set ${OVERRIDE_ENV}=1 for this invocation.`
    ].join("\n")
  );
}
