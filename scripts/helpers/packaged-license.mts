/**
 * Packaged-build licensing support for the release gates (owner decision 2026-07-29, bd `awkit-1cc`).
 *
 * Licensing enforcement is ON by default and a packaged build has NO bypass — `app.isPackaged` is
 * consulted before any environment variable, so `AWKIT_TEST_LICENSE_BYPASS` is inert there. That is
 * deliberate: the shipped artifact must contain no way to run unlicensed. It also means the packaged
 * gates can only execute a workflow by being **genuinely licensed**, which is what this module does.
 *
 * The rejected alternatives, recorded so nobody re-opens them cheaply:
 *   - a second trusted key for "test" licenses → enlarges the shipped trust boundary;
 *   - asserting `licenseBlocked` instead of `completed` → the packaged gate stops proving the engine
 *     executes in a packaged build, which is most of what it exists for;
 *   - letting the migration grace window carry the walkthrough → grace is a courtesy for upgraded
 *     installs, not an execution-rights mechanism, and using it would mean the gate never exercises
 *     the import → validate → run path at all.
 *
 * ## The private key never comes near the application
 *
 * The signing key is read ONLY by the external issuer process (`tools/license-issuer`), which this
 * module spawns with the key PATH on argv. The key material itself never enters an environment
 * variable, never enters the repository, and never enters `resources/`, `app.asar`, an installer, a
 * report, or a test artifact. `sanitizeAppEnv()` additionally strips the path variable from the
 * packaged application's environment, so the app cannot even observe where the key lives.
 *
 * ## Presence of a key is not authorization
 *
 * `AWKIT_PACKAGED_LICENSE_ISSUER_KEY` must be set explicitly to a readable path. There is
 * deliberately NO fallback to the issuer's own default discovery location
 * (`%LOCALAPPDATA%/SpecterStudio/issuer-keys/key1…`) — a developer who happens to have a key sitting
 * there must not silently arm a gate that signs with the production release key. Unset or unreadable
 * ⇒ {@link resolveIssuerKey} reports unavailable, and callers must record **BLOCKED**, never skip and
 * never pass.
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { LicenseDocument } from "@src/licensing/LicenseTypes";
import { LICENSE_FILE_NAME, buildEnvelope } from "@src/licensing/store/LicenseStore";
import { redactKeyPath } from "@src/security/keyCustody";

const execFileAsync = promisify(execFile);

/** Explicitly-configured path to the offline issuer's private signing key. Never the key itself. */
export const ISSUER_KEY_ENV = "AWKIT_PACKAGED_LICENSE_ISSUER_KEY";

/**
 * `licenseType` on a verification-issued license. Nothing in `LicenseValidator` branches on this
 * field — it is structurally required to be a string and is otherwise only copied into the display
 * view — so this marks the license as verification-issued in the signature-covered payload and in the
 * issuer's history WITHOUT changing validation semantics.
 */
export const VERIFICATION_LICENSE_TYPE = "packaged-verification";

/**
 * The licence type a MINTED (genuinely signed) verification license carries.
 *
 * It cannot be {@link VERIFICATION_LICENSE_TYPE}: that string is not in the issuer's allowlist, and
 * signing now goes through `LicenseIssuerService`, which refuses anything outside
 * `ISSUER_LICENSE_TYPES` (`awkit-vf9r`). `trial` is also the truthful description of a licence that
 * lives for minutes. The forged/unsigned document keeps the marker string precisely because it never
 * touches the issuer.
 */
export const MINTED_LICENSE_TYPE = "trial";

/** Only the entitlement the gate actually needs. */
export const VERIFICATION_ENTITLEMENTS = ["workflow.execute"] as const;

export interface IssuerKeyResolution {
  readonly available: boolean;
  readonly keyPath?: string;
  /** Operator-facing explanation, used verbatim in the BLOCKED record. */
  readonly reason?: string;
}

export function resolveIssuerKey(): IssuerKeyResolution {
  const configured = process.env[ISSUER_KEY_ENV];
  if (!configured) {
    return {
      available: false,
      reason:
        `${ISSUER_KEY_ENV} is not set. Licensed packaged execution requires an authorized validation ` +
        `machine or CI runner with controlled access to the offline issuer key; set it to the key's ` +
        `path there. Presence of a key at the issuer's default location is deliberately NOT enough — ` +
        `do not sign with the production release key on an ordinary developer machine.`
    };
  }
  // Absolute or nothing, for the same reason `resolveIssuerKeyLocation` refuses a relative
  // `SPECTER_ISSUER_KEY`: this value is read here and then handed to a CHILD process, and a gate
  // whose signing key depends on the launching shell's working directory is not a gate.
  if (!isAbsolute(configured)) {
    return {
      available: false,
      reason: `${ISSUER_KEY_ENV} must be an absolute path; it is set to a relative one.`
    };
  }
  // Paths are reported through `redactKeyPath`, so a BLOCKED record naming the location does not
  // also print the operator's account name into a committed report or a CI log.
  const shown = redactKeyPath(configured);
  if (!existsSync(configured)) {
    return { available: false, reason: `${ISSUER_KEY_ENV} points at ${shown}, which does not exist.` };
  }
  try {
    if (readFileSync(configured, "utf8").trim().length === 0) {
      return { available: false, reason: `${ISSUER_KEY_ENV} points at ${shown}, which is empty.` };
    }
  } catch (error) {
    return {
      available: false,
      reason: `${ISSUER_KEY_ENV} points at ${shown}, which is unreadable: ${
        (error as NodeJS.ErrnoException)?.code ?? (error instanceof Error ? error.name : "unknown")
      }`
    };
  }
  return { available: true, keyPath: configured };
}

/**
 * Strip every issuer-related variable from an environment about to be handed to the packaged
 * application. The app must never see the key path, and `AWKIT_TEST_LICENSE_BYPASS` is stripped too —
 * it is already inert when packaged, but leaving it set would make the gate's evidence ambiguous
 * about *why* a run was admitted.
 */
export function sanitizeAppEnv<T extends Record<string, string | undefined>>(env: T): T {
  const next = { ...env };
  delete next[ISSUER_KEY_ENV];
  delete next.SPECTER_ISSUER_KEY;
  delete next.AWKIT_TEST_LICENSE_BYPASS;
  return next;
}

export interface MintedLicense {
  readonly licensePath: string;
  readonly license: LicenseDocument;
}

/**
 * Mint a short-lived license bound to `fingerprintHash`, by running the offline issuer as a SEPARATE
 * process outside the packaged application.
 *
 * `expiresInMinutes` keeps the credential alive only for the gate's own duration. Note the issuer
 * floors timestamps to whole minutes, so anything under ~2 minutes risks minting something already
 * expired; and because the "expiring soon" window is 7 days, a short-lived license legitimately
 * validates as `EXPIRING_SOON` rather than `VALID`. Both are operable — callers should assert
 * `operable`, not `status === "VALID"`.
 */
export async function mintVerificationLicense(input: {
  readonly repoRoot: string;
  readonly keyPath: string;
  readonly activationRequest: unknown;
  readonly workDir: string;
  readonly expiresInMinutes?: number;
  /** Override the machine binding — used only to produce a deliberate MACHINE_MISMATCH. */
  readonly fingerprintHashOverride?: string;
  /** Negative-case knob: mint something already expired. */
  readonly expiresAtOverrideIso?: string;
}): Promise<MintedLicense> {
  mkdirSync(input.workDir, { recursive: true });
  const requestPath = join(input.workDir, "activation-request.json");
  const licensePath = join(input.workDir, `license-${Date.now()}.dat`);

  const request = { ...(input.activationRequest as Record<string, unknown>) };
  if (input.fingerprintHashOverride) request.fingerprintHash = input.fingerprintHashOverride;
  writeFileSync(requestPath, JSON.stringify(request, null, 2), "utf8");

  const expiresAt =
    input.expiresAtOverrideIso ??
    new Date(Date.now() + (input.expiresInMinutes ?? 30) * 60_000).toISOString();

  // The issuer takes an explicit window — BOTH boundaries or neither — and enforces a minimum span
  // of one minute. An already-expired licence therefore cannot start "now": its start must precede
  // its own expiry, which is legal (the issuer allows a back-dated window; the result is simply a
  // licence that is already spent) but is not something the caller can leave implicit.
  const expiresMs = Date.parse(expiresAt);
  const validFromMs = Math.min(Date.now(), expiresMs - 60 * 60_000);
  const toIssuerUtc = (ms: number): string => new Date(ms).toISOString().replace(/:\d{2}\.\d{3}Z$/, "Z");

  // `--out` was removed when the CLI was folded onto the service: the service owns the output folder
  // AND the file name, and records that name in the append-only issuance history. So the mint gets a
  // private empty directory and reads back the one file that appears in it.
  const outDir = join(input.workDir, `issued-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });

  const issuerScript = join(input.repoRoot, "tools", "license-issuer", "issue-license.mts");
  const issuerArgs = [
    "--request",
    requestPath,
    "--key",
    input.keyPath,
    "--type",
    MINTED_LICENSE_TYPE,
    "--entitlements",
    VERIFICATION_ENTITLEMENTS.join(","),
    "--valid-from",
    toIssuerUtc(validFromMs),
    "--expires",
    toIssuerUtc(expiresMs),
    "--out-dir",
    outDir
  ];

  // The key path travels on argv to the issuer only. The issuer's own environment is the parent's,
  // which is fine — it is the process that is *supposed* to read the key — but the packaged app is
  // launched with `sanitizeAppEnv`, so it never inherits it.
  await execFileAsync(
    process.execPath,
    [join(input.repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), issuerScript, ...issuerArgs],
    { cwd: input.repoRoot, windowsHide: true }
  );

  const produced = readdirSync(outDir).filter((name) => name.endsWith(".dat"));
  if (produced.length !== 1) {
    throw new Error(`Issuer produced ${produced.length} licenses in ${outDir}; expected exactly 1.`);
  }
  const issuedPath = join(outDir, produced[0]);
  const license = JSON.parse(readFileSync(issuedPath, "utf8")) as LicenseDocument;
  // Callers were written against a stable per-mint path, so keep giving them one.
  copyFileSync(issuedPath, licensePath);
  rmSync(requestPath, { force: true });
  return { licensePath, license };
}

/**
 * Remove every artifact this module generated.
 *
 * Deliberately does NOT touch `issuance-history.jsonl` next to the key. That file is the issuer's
 * own audit ledger, lives outside the repository beside the private key, and records that a
 * verification license was minted — deleting it would destroy an intentional audit record, which is
 * a worse outcome than leaving one traceable line behind.
 *
 * The line is identifiable by `licenseType: "trial"` together with a validity window measured in
 * minutes. It used to be identifiable by the marker string `packaged-verification`, which the issuer
 * now refuses: signing goes through `LicenseIssuerService`, whose allowlist is the product's real
 * licence types (`awkit-vf9r`). A marker the production issuer would reject was only ever writable
 * because the CLI had its own, looser rules.
 */
export function cleanupMintedArtifacts(workDir: string): void {
  rmSync(workDir, { recursive: true, force: true });
}

/**
 * Write a license envelope straight into a profile's licensing directory, bypassing the import IPC.
 *
 * Required for the negative matrix: `licensing:import` deliberately REJECTS `INVALID_SIGNATURE`,
 * `MACHINE_MISMATCH`, `CORRUPTED` and `UNSUPPORTED_VERSION` before committing, so those states can
 * never be reached through the supported path. A machine whose stored license has decayed into one
 * of them is the real scenario, and this reproduces it. The checksum is computed the same way the
 * store computes it, so the envelope reads as authentic rather than as corruption — otherwise every
 * negative case would collapse into `CORRUPTED` and the matrix would prove nothing.
 */
export function writeStoredLicenseEnvelope(input: {
  readonly localAppData: string;
  readonly license: LicenseDocument;
  readonly importedAtUtc?: string;
}): string {
  const dir = join(input.localAppData, "SpecterStudio", "Licensing");
  mkdirSync(dir, { recursive: true });
  const nowIso = input.importedAtUtc ?? new Date().toISOString();
  // Built by the PRODUCTION `buildEnvelope`, never a local reimplementation. The store checksums
  // `stableStringify({license, meta})`, not `JSON.stringify`; a hand-rolled hash silently mismatched
  // and made every negative case load as CORRUPTED — so the whole matrix would have "passed" while
  // testing one state five times. Using the real builder makes that drift impossible.
  const envelope = buildEnvelope(input.license, {
    importedAtUtc: nowIso,
    lastValidatedUtc: nowIso,
    clockHighWaterUtc: nowIso,
    locallyRevoked: false
  });
  const target = join(dir, LICENSE_FILE_NAME);
  writeFileSync(target, JSON.stringify(envelope, null, 2), "utf8");
  return target;
}

/** Write a deliberately unreadable license file, producing the CORRUPTED state. */
export function writeCorruptStoredLicense(localAppData: string): string {
  const dir = join(localAppData, "SpecterStudio", "Licensing");
  mkdirSync(dir, { recursive: true });
  const target = join(dir, LICENSE_FILE_NAME);
  writeFileSync(target, "{ this is not a license envelope", "utf8");
  return target;
}

/** Delete a profile's stored license, returning it to NOT_ACTIVATED. */
export function removeStoredLicense(localAppData: string): void {
  rmSync(join(localAppData, "SpecterStudio", "Licensing", LICENSE_FILE_NAME), { force: true });
}

/**
 * A structurally-complete license whose signature is worthless. Reaches `INVALID_SIGNATURE` without
 * any access to a signing key, because the validator checks the signature before the fingerprint.
 */
export function forgeUnsignedLicense(fingerprintHash: string): LicenseDocument {
  const now = Date.now();
  return {
    schemaVersion: 1,
    licenseId: "packaged-negative-invalid-signature",
    serialNumber: "SPEC-FORG-EDXX-0001",
    product: "SpecterStudio",
    machineFingerprintHash: fingerprintHash,
    issuedAtUtc: new Date(now - 60_000).toISOString(),
    validFromUtc: new Date(now - 60_000).toISOString(),
    expiresAtUtc: new Date(now + 365 * 24 * 60 * 60_000).toISOString(),
    licenseType: VERIFICATION_LICENSE_TYPE,
    entitlements: [...VERIFICATION_ENTITLEMENTS],
    issuer: "SpecterStudio Licensing",
    signingKeyId: "key1",
    signatureAlgorithm: "Ed25519",
    signature: Buffer.alloc(64).toString("base64")
  };
}

/** Ensure a directory exists and is empty (used for per-scenario profiles). */
export function freshDir(path: string): string {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
  return path;
}

/** Seed workflow JSON into a profile BEFORE first launch so it classifies as an upgraded install. */
export function seedUpgradedProfile(localAppData: string, fixturesRoot: string, ids: readonly string[]): void {
  for (const kind of ["flows", "workflows"] as const) {
    const dir = join(localAppData, "SpecterStudio", kind);
    mkdirSync(dir, { recursive: true });
  }
  for (const id of ids) {
    const source = join(fixturesRoot, "workflows", `${id}.json`);
    if (!existsSync(source)) continue;
    const target = join(localAppData, "SpecterStudio", "workflows", `${id}.json`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(source, "utf8"), "utf8");
  }
}
