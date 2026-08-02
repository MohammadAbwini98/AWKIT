/**
 * verify:release-key-custody — the offline-manifest signing key must not live in a synced tree.
 *
 * What regression makes this fail?
 *   - the sync detector stops recognising a provider, or starts matching a directory that merely
 *     contains a provider name as a substring (which would refuse to sign for no reason);
 *   - the key-path resolution order changes, so an explicit flag or the approved location is no
 *     longer preferred over the legacy in-repo path;
 *   - the custody gate degrades from a refusal to a warning, or the deliberate override stops being
 *     an override;
 *   - an error message starts printing the operator's real home directory into a log;
 *   - the read-only `verify` command acquires a dependency on the private key.
 *
 * Holds no key material and reads no key file: every case is a path plus an injected environment, so
 * this runs anywhere, including on a machine that has never had a release key.
 *
 * Deliberately .mjs — it exercises `scripts/lib/release-key-custody.mjs`, which must stay .mjs
 * because plain `node` runs the signing CLI that imports it.
 *
 * Run: node scripts/verify-release-key-custody.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  KEY_PATH_ENV,
  OVERRIDE_ENV,
  approvedKeyPath,
  assertKeyCustody,
  detectSyncedRoot,
  legacyKeyPath,
  redactPath,
  resolvePrivateKeyLocation
} from "./lib/release-key-custody.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

/** A fixed, fake Windows-shaped environment. Never the real one. */
const ENV = {
  LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local",
  USERPROFILE: "C:\\Users\\fixture",
  OneDrive: "C:\\Users\\fixture\\OneDrive"
};

console.log("Sync detection - positives:");
const SYNCED = [
  ["C:\\Users\\fixture\\OneDrive\\Desktop\\AWTKIT\\.release-local\\k.pem", "OneDrive"],
  ["C:\\Users\\other\\OneDrive - Contoso\\repo\\k.pem", "OneDrive"],
  ["C:\\Users\\other\\Dropbox\\keys\\k.pem", "Dropbox"],
  ["C:\\Users\\other\\Google Drive\\k.pem", "Google Drive"],
  ["C:\\Users\\other\\My Drive\\k.pem", "Google Drive"],
  ["C:\\Users\\other\\iCloudDrive\\k.pem", "iCloud Drive"],
  ["C:\\Users\\other\\Box\\k.pem", "Box"]
];
// Cardinality first: an empty table would make every loop below vacuously true.
check("the synced fixture table is populated", SYNCED.length >= 7, `${SYNCED.length} cases`);
for (const [path, provider] of SYNCED) {
  const got = detectSyncedRoot(path, ENV);
  check(`${provider}: ${path.slice(0, 46)}… is refused`, got.synced && got.provider === provider, JSON.stringify(got));
}

console.log("\nSync detection - negatives (a substring is not a sync root):");
const NOT_SYNCED = [
  "C:\\work\\onedriveclone\\repo\\k.pem",
  "C:\\dev\\boxes\\k.pem",
  "C:\\dev\\dropboxed\\k.pem",
  "C:\\Users\\fixture\\AppData\\Local\\SpecterStudio\\release-keys\\k.pem",
  "D:\\release\\keys\\k.pem"
];
check("the non-synced fixture table is populated", NOT_SYNCED.length >= 5, `${NOT_SYNCED.length} cases`);
for (const path of NOT_SYNCED) {
  const got = detectSyncedRoot(path, ENV);
  check(`allowed: ${path}`, got.synced === false, JSON.stringify(got));
}

console.log("\nResolution order:");
const never = () => false;
const always = () => true;
check(
  "an explicit --private-key wins",
  resolvePrivateKeyLocation({ explicit: "D:\\keys\\k.pem", env: ENV, repoRoot: ROOT, exists: always }).source === "flag"
);
check(
  `${KEY_PATH_ENV} wins over the approved default`,
  resolvePrivateKeyLocation({
    env: { ...ENV, [KEY_PATH_ENV]: "D:\\keys\\env.pem" },
    repoRoot: ROOT,
    exists: always
  }).source === "env"
);
{
  const approved = resolvePrivateKeyLocation({ env: ENV, repoRoot: ROOT, exists: (p) => p === approvedKeyPath(ENV) });
  check("the approved location is used when a key is there", approved.source === "approved", approved.source);
  check("the approved location is not synced", approved.synced === false);
}
{
  const legacy = resolvePrivateKeyLocation({ env: ENV, repoRoot: ROOT, exists: never });
  check("falls back to the legacy in-repo path when nothing else exists", legacy.source === "legacy", legacy.source);
  check("the legacy path is the historical one", legacy.path === legacyKeyPath(ROOT));
}

console.log("\nCustody gate:");
const syncedLocation = {
  path: "C:\\Users\\fixture\\OneDrive\\repo\\.release-local\\k.pem",
  source: "legacy",
  synced: true,
  provider: "OneDrive",
  reason: "inside %OneDrive%"
};
const cleanLocation = { path: approvedKeyPath(ENV), source: "approved", synced: false, provider: null, reason: null };

let refusal = null;
try {
  assertKeyCustody(syncedLocation, ENV);
} catch (error) {
  refusal = error;
}
check("a synced key is REFUSED, not warned about", refusal instanceof Error, String(refusal));
check("the refusal names the provider", !!refusal && refusal.message.includes("OneDrive"));
check("the refusal names the approved destination", !!refusal && refusal.message.includes("release-keys"));
check("the refusal states that moving the key is owner action", !!refusal && /will not move or rotate/i.test(refusal.message));
check(
  "the refusal does not print the operator's real home directory",
  !!refusal && !refusal.message.includes(ENV.USERPROFILE),
  refusal ? refusal.message.split("\n")[1] : ""
);
check("a non-synced key is accepted", assertKeyCustody(cleanLocation, ENV).ok === true);
check("acceptance is not silently an override", assertKeyCustody(cleanLocation, ENV).overridden === false);
{
  const overridden = assertKeyCustody(syncedLocation, { ...ENV, [OVERRIDE_ENV]: "1" });
  check("the deliberate override is honoured", overridden.ok === true);
  check("…and reports itself as an override so the caller can warn", overridden.overridden === true);
}
{
  // A value other than exactly "1" must not disable the gate.
  let sloppy = null;
  try {
    assertKeyCustody(syncedLocation, { ...ENV, [OVERRIDE_ENV]: "true" });
  } catch (error) {
    sloppy = error;
  }
  check("a truthy-looking override value does not disable the gate", sloppy instanceof Error);
}

console.log("\nPath redaction:");
check(
  "LOCALAPPDATA is redacted in preference to the profile it sits inside",
  redactPath("C:\\Users\\fixture\\AppData\\Local\\SpecterStudio\\release-keys\\k.pem", ENV).startsWith("%LOCALAPPDATA%"),
  redactPath("C:\\Users\\fixture\\AppData\\Local\\SpecterStudio\\release-keys\\k.pem", ENV)
);
check(
  "a profile-relative path is redacted",
  redactPath("C:\\Users\\fixture\\OneDrive\\repo\\k.pem", ENV) === "%USERPROFILE%\\OneDrive\\repo\\k.pem",
  redactPath("C:\\Users\\fixture\\OneDrive\\repo\\k.pem", ENV)
);
check(
  "an unrelated path is left alone",
  redactPath("D:\\release\\keys\\k.pem", ENV) === "D:\\release\\keys\\k.pem",
  redactPath("D:\\release\\keys\\k.pem", ENV)
);

console.log("\nSource guards:");
const cliSource = readFileSync(resolve(HERE, "offline-manifest-signature.mjs"), "utf8");
const custodySource = readFileSync(resolve(HERE, "lib", "release-key-custody.mjs"), "utf8");
check("the source guard actually read the CLI", cliSource.includes("offline-manifest") && cliSource.length > 500);
check(
  "both key-using commands are gated",
  (cliSource.match(/assertKeyCustody\(keyLocation\)/g) || []).length === 2,
  `${(cliSource.match(/assertKeyCustody\(keyLocation\)/g) || []).length} call sites`
);
check(
  "the read-only verify path does not read the private key",
  !/verifyManifestSignature[\s\S]*?privateKey/.test(
    cliSource.slice(cliSource.indexOf("async function verifyManifestSignature"), cliSource.indexOf("async function main"))
  )
);
check(
  "the in-repo .release-local path is no longer a silent default constant",
  !cliSource.includes("const DEFAULT_PRIVATE_KEY")
);
check("no key material is embedded in the custody module", !custodySource.includes("BEGIN PRIVATE KEY"));
check("the custody module never reads a key file", !/readFile(Sync)?\s*\(/.test(custodySource));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
