/**
 * Types for the plain-JS packaging-side custody module.
 *
 * `release-key-custody.mjs` must stay `.mjs` because `scripts/offline-manifest-signature.mjs` runs
 * under plain `node` during packaging and cannot import TypeScript. This declaration exists purely
 * so `verify-release-key-custody.mts` can import it under the typecheck gate and drive it through
 * the same fixture table as the canonical `src/security/keyCustody.ts`.
 */

export interface SyncedRootVerdict {
  synced: boolean;
  provider: string | null;
  reason: string | null;
}

export interface KeyLocation {
  path: string;
  source: "flag" | "env" | "approved" | "legacy";
  synced: boolean;
  provider: string | null;
  reason: string | null;
}

export const APPROVED_KEY_DIRNAME: string;
export const PRIVATE_KEY_FILENAME: string;
export const OVERRIDE_ENV: string;
export const KEY_PATH_ENV: string;

export function detectSyncedRoot(keyPath: string, env?: Record<string, string | undefined>): SyncedRootVerdict;
export function approvedKeyDirectory(env?: Record<string, string | undefined>): string;
export function approvedKeyPath(env?: Record<string, string | undefined>): string;
export function legacyKeyPath(repoRoot: string): string;
export function resolvePrivateKeyLocation(options: {
  explicit?: string | null;
  env?: Record<string, string | undefined>;
  repoRoot: string;
  exists?: (path: string) => boolean;
}): KeyLocation;
export function redactPath(value: string, env?: Record<string, string | undefined>): string;
export function assertKeyCustody(
  location: KeyLocation,
  env?: Record<string, string | undefined>
): { ok: boolean; overridden: boolean };
