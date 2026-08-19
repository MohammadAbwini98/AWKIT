/**
 * Where the issuer's external private key and its confined output folder live.
 *
 * Two runtimes need the same answer: the Electron main process (which resolves its data root through
 * `app`/`%LOCALAPPDATA%`) and the developer-tooling bridge that the Program Status dashboard drives
 * under plain Node. Rather than let each spell the path out, both pass their own runtime root here.
 * A drift between the two would mean the dashboard reported "ready" against a key the app would
 * never use — or worse, signed with one the operator did not intend.
 *
 * Path reasoning only: nothing is read, created, or probed here.
 */
import { join } from "node:path";

/** The initial (and today only) trusted signing key. See crypto/TrustedKeys.ts. */
export const DEFAULT_ISSUER_KEY_ID = "key1";

/** Operator override for the external key location. Never set this to a repository path. */
export const ISSUER_KEY_PATH_ENV = "SPECTER_ISSUER_KEY";

/**
 * The external private key for `keyId`. `SPECTER_ISSUER_KEY` wins when set, which is how an issuer
 * workstation points at removable or otherwise non-synced custody storage.
 */
export function issuerKeyPathFor(
  runtimeRoot: string,
  keyId: string = DEFAULT_ISSUER_KEY_ID,
  env: NodeJS.ProcessEnv = process.env
): string {
  const override = env[ISSUER_KEY_PATH_ENV];
  if (typeof override === "string" && override.trim().length > 0) return override;
  return join(runtimeRoot, "issuer-keys", `${keyId}.ed25519.pkcs8.b64`);
}

/** The only folder a signed license is ever written to. Never taken from caller input. */
export function issuerOutputDirectoryFor(runtimeRoot: string): string {
  return join(runtimeRoot, "issuer-output");
}

/**
 * The per-user runtime data root as seen from OUTSIDE Electron (the issuer CLI and the dashboard
 * bridge). The Electron main process has its own resolver in `app/main/appPaths.ts`; both land on
 * `%LOCALAPPDATA%\SpecterStudio` on Windows, which is what keeps the two views of the key identical.
 */
export function nonElectronRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.LOCALAPPDATA ?? env.APPDATA ?? env.HOME ?? ".", "SpecterStudio");
}
