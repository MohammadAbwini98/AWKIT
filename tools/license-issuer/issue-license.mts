/**
 * Offline issuer CLI: sign a per-machine license from a machine's activation request.
 *
 * This is an ARGV ADAPTER, not an issuer. Every rule that decides whether a license may be signed —
 * activation-request validation, licence type and entitlement allowlists, validity bounds, key
 * custody, key/trusted-list matching, the atomic write and the issuance-history record — lives in
 * {@link LicenseIssuerService}, which the in-app Issuer console and the dashboard bridge also call.
 * Three front ends, one issuer.
 *
 * It used to re-implement all of that (`awkit-vf9r`), and had drifted into the looser of the two:
 * it accepted any `--type` and any `--entitlements` string, enforced no validity bounds, ran no
 * custody check, never verified the key matched `TRUSTED_KEYS`, wrote non-atomically, defaulted to
 * the now verification-only `key1`, and generated serial numbers with `Math.random()`.
 *
 * Usage:
 *   npx tsx tools/license-issuer/issue-license.mts --request req.json \
 *     --type standard --entitlements workflow.execute,automation.browser --days 365
 *
 *   # exact window instead of a day count (minute precision)
 *   npx tsx tools/license-issuer/issue-license.mts --request req.json \
 *     --valid-from 2026-09-01T09:00 --expires 2026-09-01T17:00
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { LICENSING_PRODUCT } from "../../src/licensing/LicenseTypes";
import {
  DEFAULT_ISSUER_KEY_ID,
  ISSUER_KEY_PATH_ENV,
  issuerOutputDirectoryFor,
  nonElectronRuntimeRoot,
  resolveIssuerKeyLocation
} from "../../src/licensing/issuer/IssuerLocations";
import {
  ISSUER_ENTITLEMENTS,
  ISSUER_LICENSE_TYPES,
  type IssueLicenseInput
} from "../../src/licensing/issuer/LicenseIssuerContracts";
import { LicenseIssuerError, LicenseIssuerService } from "../../src/licensing/issuer/LicenseIssuerService";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Human-readable guidance per refusal. The service answers in codes; the operator needs a sentence. */
const REASON_HELP: Record<string, string> = {
  ACTIVATION_REQUEST_INVALID:
    "The activation request is not a valid request for this product. Check it is the unmodified file the\n" +
    "requesting machine produced, and that its `product` matches this build.",
  ISSUER_OPTIONS_INVALID:
    "The licence options are out of bounds. Type must be one of " +
    ISSUER_LICENSE_TYPES.join(", ") +
    ";\nentitlements must be a unique, non-empty subset of " +
    ISSUER_ENTITLEMENTS.join(", ") +
    ";\nand the validity window must be at least a minute, at most 3650 days, and start no more than\n" +
    "365 days from now.",
  ISSUER_KEY_MISSING: "No signing key at that path. Run keygen.mts, or point " + ISSUER_KEY_PATH_ENV + " at the key.",
  ISSUER_KEY_UNSAFE_LOCATION:
    "The signing key sits in a cloud-synced folder, so its custody cannot be assured. Move it to\n" +
    "non-synced storage (awkit-5ea).",
  ISSUER_KEY_INACCESSIBLE:
    "The signing key exists but could not be opened — check the file permissions, that the path is a\n" +
    "file rather than a folder, and that nothing else holds it open.",
  ISSUER_KEY_INVALID: "The signing key could not be read as a PKCS8 Ed25519 private key.",
  ISSUER_KEY_MISMATCH:
    "The key does not match the trusted list for that key id. A license signed with it would be\n" +
    "UNKNOWN_KEY in the field.",
  ISSUER_KEY_RETIRED: "That key id is retired and must not sign anything further.",
  ISSUER_KEY_UNKNOWN_ID:
    "This build does not trust that key id, so nothing it signed could ever validate. Check --keyId\n" +
    "against TRUSTED_KEYS, and remember that a rotation ships in a build before it can issue.",
  ISSUER_KEY_LOCATION_INVALID:
    "The signing-key location could not be resolved. " + ISSUER_KEY_PATH_ENV + " must be an ABSOLUTE\n" +
    "path, the key id must be a plain file-name segment, and a per-user profile directory must exist.",
  ISSUER_WRITE_FAILED: "The license could not be written to the output folder."
};

async function main(): Promise<void> {
  const requestPath = arg("request");
  if (!requestPath) die("Missing --request <activation-request.json>");

  // `--out` named an arbitrary destination FILE. The service now owns both the confined output
  // folder and the file name, and records that exact name in the append-only issuance history, so
  // honouring `--out` would either bypass the atomic write or make the audit log name a file that no
  // longer exists. Refused loudly rather than silently ignored.
  if (has("out")) {
    die(
      "--out is no longer supported: the issuer writes into its own confined output folder and records\n" +
        "the file name it used in the issuance history. Use --out-dir to choose that folder; the full path\n" +
        "of the signed license is printed on success."
    );
  }

  const keyId = arg("keyId") ?? DEFAULT_ISSUER_KEY_ID;
  const runtimeRoot = nonElectronRuntimeRoot();
  // The canonical resolver — same call as the Electron main process, the dashboard bridge and keygen.
  const keyLocation = resolveIssuerKeyLocation({ runtimeRoot, keyId });
  // `--key` is an EXPLICIT operator argument in this one process, so a relative value is resolved
  // against this shell's cwd rather than refused. The resolver's own answers are never cwd-relative:
  // `SPECTER_ISSUER_KEY` crosses process boundaries, so a relative override there is a hard error.
  const keyOverride = arg("key");
  const keyPath = keyOverride === undefined ? keyLocation.keyPath : resolve(keyOverride);
  const outDirOverride = arg("out-dir");
  const outputDirectory =
    outDirOverride !== undefined
      ? resolve(outDirOverride)
      : keyLocation.outputDirectory ?? (runtimeRoot !== null ? issuerOutputDirectoryFor(runtimeRoot) : "");

  if (keyOverride === undefined && !isAbsolute(keyPath)) {
    die(
      `Cannot determine where the signing key lives (${keyLocation.problem ?? "UNRESOLVED"}).\n` +
        `Set ${ISSUER_KEY_PATH_ENV} to an ABSOLUTE key path, or pass --key <absolute path>.`
    );
  }
  if (!outputDirectory) {
    die("Cannot determine the issuer output folder. Pass --out-dir <absolute path>.");
  }

  let activationRequest: unknown;
  try {
    activationRequest = JSON.parse((await readFile(requestPath, { encoding: "utf8" })).replace(/^﻿/, ""));
  } catch {
    die(`Cannot read or parse the activation request at ${requestPath}.`);
  }

  // Exactly one of the two validity forms, mirroring IssueLicenseInput. Supplying both is a
  // contradiction rather than a precedence question, so it is refused instead of resolved.
  const days = arg("days");
  const validFrom = arg("valid-from");
  const expires = arg("expires");
  const windowGiven = validFrom !== undefined || expires !== undefined;
  if (days !== undefined && windowGiven) {
    die("Use either --days or --valid-from/--expires, not both.");
  }
  if (windowGiven && (validFrom === undefined || expires === undefined)) {
    die("An explicit window needs both --valid-from and --expires (UTC, e.g. 2026-09-01T09:00).");
  }

  const entitlements = (arg("entitlements") ?? "workflow.execute")
    .split(",")
    .map((entitlement) => entitlement.trim())
    .filter(Boolean);

  // Deliberately typed loosely and handed to the service unchecked: `validateIssueInput` is the one
  // place that decides what is acceptable, and duplicating any of it here is the defect this file
  // was rewritten to remove.
  const input = {
    activationRequest,
    licenseType: arg("type") ?? "standard",
    entitlements,
    ...(windowGiven
      ? { validityWindow: { validFromUtc: `${validFrom}Z`.replace(/Z+$/, "Z"), expiresAtUtc: `${expires}Z`.replace(/Z+$/, "Z") } }
      : { validityDays: Number(days ?? "365") })
  } as unknown as IssueLicenseInput;

  const service = new LicenseIssuerService({
    keyId,
    keyPath,
    outputDirectory,
    product: LICENSING_PRODUCT,
    keySource: keyLocation.source,
    // An explicit `--key` supersedes whatever the resolver could or could not work out.
    locationProblem: keyOverride === undefined ? keyLocation.problem : undefined
  });

  try {
    const issued = await service.issue(input);
    console.log(`Signed license written to ${issued.outputPath}`);
    console.log(
      `  serial: ${issued.serialNumber}  type: ${issued.licenseType}  key: ${issued.signingKeyId}\n` +
        `  machine: ${issued.machineFingerprintHash}\n` +
        `  valid ${issued.validFromUtc} → ${issued.expiresAtUtc}  (issued ${issued.issuedAtUtc})`
    );
  } catch (error) {
    if (error instanceof LicenseIssuerError) {
      die(`Refused to issue: ${error.reason}\n${REASON_HELP[error.reason] ?? ""}`);
    }
    // Never surface a raw error here: this process has the private key in memory.
    die("Refused to issue: the issuer failed unexpectedly.");
  }
}

main().catch(() => die("Refused to issue: the issuer failed unexpectedly."));
