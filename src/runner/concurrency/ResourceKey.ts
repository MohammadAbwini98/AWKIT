/**
 * Schedulable-resource keys for the concurrency layer. Every contended runtime resource —
 * browser process, browser context, page, persistent profile, account, origin, download
 * directory, workflow/flow/instance — is identified by a namespaced string key so locks,
 * semaphores, and diagnostics all speak the same vocabulary.
 */

export type ResourceKind =
  | "browser"
  | "context"
  | "page"
  | "profile"
  | "account"
  | "origin"
  | "downloadDir"
  | "workflow"
  | "flow"
  | "instance";

export type ResourceKey = `${ResourceKind}:${string}`;

export type LockMode = "exclusive" | "shared" | "semaphore";

export interface ResourceClaim {
  key: ResourceKey | string;
  mode: LockMode;
  /** Semaphore capacity units to consume (semaphore mode only, default 1). */
  units?: number;
  /** Lease TTL; expired leases can be cleaned by the stale-lock sweep. */
  ttlMs?: number;
  /** Human-readable reason surfaced in lock diagnostics. */
  reason?: string;
}

/** Normalizes a raw identifier into a stable resource key (lower-cases nothing — paths matter). */
export function resourceKey(kind: ResourceKind, id: string): ResourceKey {
  return `${kind}:${id}`;
}

/** Profile keys normalize Windows path separators/case so the same dir always locks the same key. */
export function profileKey(userDataDir: string): ResourceKey {
  return resourceKey("profile", normalizePathId(userDataDir));
}

export function downloadDirKey(dir: string): ResourceKey {
  return resourceKey("downloadDir", normalizePathId(dir));
}

function normalizePathId(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  // Windows paths are case-insensitive; normalize so C:\Foo and c:\foo collide as intended.
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
