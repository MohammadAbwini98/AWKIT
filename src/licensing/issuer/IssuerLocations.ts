/**
 * Where the issuer's external private key and its confined output folder live.
 *
 * Four runtimes need the same answer: the Electron main process (which resolves its data root through
 * `app`/`%LOCALAPPDATA%`), the developer-tooling bridge that the Program Status dashboard drives under
 * plain Node, the offline CLI, and `keygen`. Rather than let each spell the path out, all of them call
 * {@link resolveIssuerKeyLocation} — the ONE canonical resolver. A drift between any two would mean one
 * surface reporting "ready" against a key another would never use, or worse, signing with one the
 * operator did not intend.
 *
 * ## Why the resolver can fail
 *
 * It used to be impossible for this module to say "I cannot tell you where the key is". The default
 * root fell back to `"."` when no profile variable was set, so the key silently became
 * `./SpecterStudio/issuer-keys/<id>…` — relative to whatever directory the process happened to start
 * in, which for the dashboard bridge is the REPOSITORY ROOT. That turns a configuration accident into
 * a private key resolved inside the source tree, and makes the answer depend on the caller's cwd.
 * Resolution now fails closed with an {@link IssuerLocationProblem} instead, which readiness reports
 * as `CONFIGURATION_ERROR`.
 *
 * Path reasoning only: nothing is read, created, or probed here.
 */
import { isAbsolute, join } from "node:path";
import { redactKeyPath } from "../../security/keyCustody";

/**
 * The key the issuer signs with. It must be one of `TRUSTED_KEYS` — `LicenseIssuerService` refuses to
 * load a key this list does not name, and refuses one whose private half does not match the public
 * half recorded there.
 *
 * `key2` since 2026-08-19. `key1` remains trusted for VERIFICATION of licenses it already signed, but
 * its private half is not on this issuer workstation, so it can no longer sign. Rotating this constant
 * is the whole of "start issuing with the next key" — but the new public half must ship in a build
 * first, or every license it signs is `UNKNOWN_KEY` in the field.
 */
export const DEFAULT_ISSUER_KEY_ID = "key2";

/** Operator override for the external key location. Never set this to a repository path. */
export const ISSUER_KEY_PATH_ENV = "SPECTER_ISSUER_KEY";

/** The per-user folder holding external private signing keys and the issuance history beside them. */
export const ISSUER_KEY_DIRECTORY_NAME = "issuer-keys";
/** The only folder a signed license is ever written to. */
export const ISSUER_OUTPUT_DIRECTORY_NAME = "issuer-output";
/** Suffix of an external key file, so no caller composes one by hand. */
export const ISSUER_KEY_FILE_SUFFIX = ".ed25519.pkcs8.b64";

/** A key id has to be a single safe path segment — it is interpolated into a file name. */
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Which of the two legitimate sources produced the resolved path. Carries no path itself. */
export type IssuerKeySource = "environment-override" | "default-location";

/**
 * Why the location could not be resolved. Distinct from "the key is not there": nothing was looked
 * for, because there was no defensible place to look.
 */
export type IssuerLocationProblem =
  /** No `%LOCALAPPDATA%` / `%APPDATA%` / `$HOME`, so the per-user runtime root is unknown. */
  | "RUNTIME_ROOT_UNRESOLVED"
  /** The configured key id is not a usable file-name segment. */
  | "KEY_ID_INVALID"
  /** A relative path was configured. Env vars cross processes with different cwds; refuse. */
  | "KEY_PATH_RELATIVE";

export interface IssuerKeyLocation {
  keyId: string;
  /** Absolute when `problem` is undefined; empty string otherwise. */
  keyPath: string;
  /** Folder holding the key and `issuance-history.jsonl`. Empty when `problem` is set. */
  keyDirectory: string;
  /** Default confined output folder, or `null` when the runtime root is unknown. */
  outputDirectory: string | null;
  source: IssuerKeySource;
  /**
   * Profile-relative rendering of `keyPath` (`%LOCALAPPDATA%\…`), safe to show an operator or write
   * to a support transcript. NEVER key material — this module never opens the file.
   */
  displayPath: string;
  problem?: IssuerLocationProblem;
}

export interface ResolveIssuerKeyLocationOptions {
  /**
   * Absolute per-user runtime data root. Electron passes its own (`app/main/appPaths.ts`); plain Node
   * passes {@link nonElectronRuntimeRoot}.
   */
  runtimeRoot?: string | null;
  keyId?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * The external private key for `keyId`, plus everything a caller needs to explain the answer.
 *
 * `SPECTER_ISSUER_KEY` wins when set, which is how an issuer workstation points at removable or
 * otherwise non-synced custody storage. It must be ABSOLUTE: an environment variable is inherited by
 * child processes that do not share the setter's working directory, so a relative override resolves
 * differently in the app, the bridge and the CLI — the exact divergence this module exists to prevent.
 */
export function resolveIssuerKeyLocation(
  options: ResolveIssuerKeyLocationOptions = {}
): IssuerKeyLocation {
  const env = options.env ?? process.env;
  const keyId = options.keyId ?? DEFAULT_ISSUER_KEY_ID;
  const runtimeRoot = options.runtimeRoot ?? null;
  const outputDirectory =
    typeof runtimeRoot === "string" && isAbsolute(runtimeRoot) ? issuerOutputDirectoryFor(runtimeRoot) : null;

  const rawOverride = env[ISSUER_KEY_PATH_ENV];
  const override =
    typeof rawOverride === "string" && rawOverride.trim().length > 0 ? rawOverride.trim() : null;
  const source: IssuerKeySource = override ? "environment-override" : "default-location";

  const unresolved = (problem: IssuerLocationProblem): IssuerKeyLocation => ({
    keyId,
    keyPath: "",
    keyDirectory: "",
    outputDirectory,
    source,
    displayPath: "",
    problem
  });

  if (!KEY_ID_PATTERN.test(keyId)) return unresolved("KEY_ID_INVALID");

  if (override) {
    if (!isAbsolute(override)) return unresolved("KEY_PATH_RELATIVE");
    return {
      keyId,
      keyPath: override,
      keyDirectory: parentOf(override),
      outputDirectory,
      source,
      displayPath: redactKeyPath(override, env)
    };
  }

  if (typeof runtimeRoot !== "string" || !isAbsolute(runtimeRoot)) {
    return unresolved("RUNTIME_ROOT_UNRESOLVED");
  }

  const keyDirectory = join(runtimeRoot, ISSUER_KEY_DIRECTORY_NAME);
  const keyPath = join(keyDirectory, `${keyId}${ISSUER_KEY_FILE_SUFFIX}`);
  return {
    keyId,
    keyPath,
    keyDirectory,
    outputDirectory,
    source,
    displayPath: redactKeyPath(keyPath, env)
  };
}

/** Parent folder of an already-absolute path, without normalising the caller's separators away. */
function parentOf(value: string): string {
  const index = Math.max(value.lastIndexOf("\\"), value.lastIndexOf("/"));
  return index > 0 ? value.slice(0, index) : value;
}

/**
 * The external private key for `keyId` — the raw path only, empty when it cannot be resolved.
 *
 * Kept for callers that already hold a resolved runtime root and want nothing else;
 * {@link resolveIssuerKeyLocation} is the contract every issuer front end uses, because it also
 * answers WHERE the answer came from and WHEN there is no answer at all.
 */
export function issuerKeyPathFor(
  runtimeRoot: string,
  keyId: string = DEFAULT_ISSUER_KEY_ID,
  env: NodeJS.ProcessEnv = process.env
): string {
  return resolveIssuerKeyLocation({ runtimeRoot, keyId, env }).keyPath;
}

/** The only folder a signed license is ever written to. Never taken from caller input. */
export function issuerOutputDirectoryFor(runtimeRoot: string): string {
  return join(runtimeRoot, ISSUER_OUTPUT_DIRECTORY_NAME);
}

/**
 * The per-user runtime data root as seen from OUTSIDE Electron (the issuer CLI, keygen and the
 * dashboard bridge). The Electron main process has its own resolver in `app/main/appPaths.ts`; both
 * land on `%LOCALAPPDATA%\SpecterStudio` on Windows, which is what keeps the views of the key
 * identical.
 *
 * Returns `null` rather than guessing. There used to be a `"."` fallback here; see the module header
 * for why a cwd-relative private key is the one answer this function must never give.
 */
export function nonElectronRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const base = firstAbsolute([env.LOCALAPPDATA, env.APPDATA, env.HOME, env.USERPROFILE]);
  return base === null ? null : join(base, "SpecterStudio");
}

function firstAbsolute(candidates: ReadonlyArray<string | undefined>): string | null {
  for (const candidate of candidates) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (trimmed.length > 0 && isAbsolute(trimmed)) return trimmed;
  }
  return null;
}
