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
 * A .mts so it can import BOTH implementations: the canonical `src/security/keyCustody.ts` the
 * app uses, and the plain-JS `scripts/lib/release-key-custody.mjs` the packaging script needs. The
 * parity section drives one fixture table through both, because they cannot share a runtime module
 * (`allowJs` is false, and plain `node` cannot import TypeScript).
 *
 * Run: npx tsx scripts/verify-release-key-custody.mts
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LicenseIssuerService } from "@src/licensing/issuer/LicenseIssuerService";
import {
  SYNCED_KEY_OVERRIDE_ENV,
  SYNC_PROVIDERS,
  detectSyncedRoot,
  evaluateKeyCustody,
  redactKeyPath
} from "@src/security/keyCustody";
import {
  KEY_PATH_ENV,
  OVERRIDE_ENV,
  approvedKeyPath,
  assertKeyCustody,
  detectSyncedRoot as scriptDetectSyncedRoot,
  legacyKeyPath,
  redactPath as scriptRedactPath,
  resolvePrivateKeyLocation
} from "./lib/release-key-custody.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail = ""): void {
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
  const got = scriptDetectSyncedRoot(path, ENV);
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
  const got = scriptDetectSyncedRoot(path, ENV);
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
  source: "legacy" as const,
  synced: true,
  provider: "OneDrive",
  reason: "inside %OneDrive%"
};
const cleanLocation = { path: approvedKeyPath(ENV), source: "approved" as const, synced: false, provider: null, reason: null };

let refusal: Error | null = null;
try {
  assertKeyCustody(syncedLocation, ENV);
} catch (error) {
  refusal = error as Error;
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
  let sloppy: Error | null = null;
  try {
    assertKeyCustody(syncedLocation, { ...ENV, [OVERRIDE_ENV]: "true" });
  } catch (error) {
    sloppy = error as Error;
  }
  check("a truthy-looking override value does not disable the gate", sloppy instanceof Error);
}

console.log("\nPath redaction:");
check(
  "LOCALAPPDATA is redacted in preference to the profile it sits inside",
  scriptRedactPath("C:\\Users\\fixture\\AppData\\Local\\SpecterStudio\\release-keys\\k.pem", ENV).startsWith("%LOCALAPPDATA%"),
  scriptRedactPath("C:\\Users\\fixture\\AppData\\Local\\SpecterStudio\\release-keys\\k.pem", ENV)
);
check(
  "a profile-relative path is redacted",
  scriptRedactPath("C:\\Users\\fixture\\OneDrive\\repo\\k.pem", ENV) === "%USERPROFILE%\\OneDrive\\repo\\k.pem",
  scriptRedactPath("C:\\Users\\fixture\\OneDrive\\repo\\k.pem", ENV)
);
check(
  "an unrelated path is left alone",
  scriptRedactPath("D:\\release\\keys\\k.pem", ENV) === "D:\\release\\keys\\k.pem",
  scriptRedactPath("D:\\release\\keys\\k.pem", ENV)
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


// ───────────────────────────────────────────────────────────────────────────────────────────────
// Parity: the app and the packaging script must agree (awkit-5ea).
//
// They cannot share a runtime module — `allowJs` is false, so the app cannot import the `.mjs`, and
// plain `node` (which runs the packaging signer) cannot import the `.ts`. Two implementations is
// therefore a fact of the build, and the risk is that one grows a provider the other does not know.
// This drives ONE table through BOTH and fails on any divergence, so the duplication cannot rot
// quietly.
// ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The provider names the PACKAGING side can produce, derived by asking it — not by reading its
 * table. A copied constant would agree with itself even after the real table lost an entry.
 */
const scriptProviders = (): string[] => {
  const probes = [
    "C:\\x\\OneDrive\\k",
    "C:\\x\\Dropbox\\k",
    "C:\\x\\Google Drive\\k",
    "C:\\x\\My Drive\\k",
    "C:\\x\\iCloudDrive\\k",
    "C:\\x\\Box\\k",
    "C:\\x\\pCloudrive\\k",
    "C:\\x\\Creative Cloud Files\\k"
  ];
  const found = probes
    .map((probe) => scriptDetectSyncedRoot(probe, {}).provider)
    .filter((provider): provider is string => !!provider);
  return Array.from(new Set(found)).sort();
};

console.log("\nApp ↔ packaging-script parity:");
check(
  "both sides name the same providers",
  JSON.stringify(SYNC_PROVIDERS) === JSON.stringify(scriptProviders()),
  `app=${SYNC_PROVIDERS.join(",")} script=${scriptProviders().join(",")}`
);

const PARITY_CASES = [...SYNCED.map(([path]) => path), ...NOT_SYNCED];
check("the parity table is populated", PARITY_CASES.length >= 12, `${PARITY_CASES.length} cases`);
const divergent = PARITY_CASES.filter((path) => {
  const app = detectSyncedRoot(path, ENV);
  const script = scriptDetectSyncedRoot(path, ENV);
  return app.synced !== script.synced || app.provider !== script.provider;
});
check(
  "both implementations return the same verdict for every case",
  divergent.length === 0,
  divergent.map((p) => `${p}: app=${JSON.stringify(detectSyncedRoot(p, ENV))} script=${JSON.stringify(scriptDetectSyncedRoot(p, ENV))}`).join(" | ")
);
const redactionDivergent = PARITY_CASES.filter((path) => redactKeyPath(path, ENV) !== scriptRedactPath(path, ENV));
check(
  "both implementations redact identically",
  redactionDivergent.length === 0,
  redactionDivergent.join(", ")
);
check(
  "both honour the same override variable name",
  SYNCED_KEY_OVERRIDE_ENV === OVERRIDE_ENV,
  `${SYNCED_KEY_OVERRIDE_ENV} vs ${OVERRIDE_ENV}`
);

console.log("\nThe canonical app-side decision:");
check(
  "a synced key is refused",
  evaluateKeyCustody("C:\\Users\\fixture\\OneDrive\\keys\\k.pem", ENV).allowed === false
);
check(
  "a non-synced key is allowed",
  evaluateKeyCustody("C:\\Users\\fixture\\AppData\\Local\\SpecterStudio\\issuer-keys\\k.b64", ENV).allowed === true
);
check(
  "the exact override admits it, and says it did",
  evaluateKeyCustody("C:\\Users\\fixture\\OneDrive\\k.pem", { ...ENV, [SYNCED_KEY_OVERRIDE_ENV]: "1" }).overridden === true
);
check(
  "a truthy-looking override value does not",
  evaluateKeyCustody("C:\\Users\\fixture\\OneDrive\\k.pem", { ...ENV, [SYNCED_KEY_OVERRIDE_ENV]: "true" }).allowed === false
);
check(
  "the decision carries a redacted path, never the raw one",
  !evaluateKeyCustody("C:\\Users\\fixture\\OneDrive\\k.pem", ENV).redactedPath.includes(ENV.USERPROFILE),
  evaluateKeyCustody("C:\\Users\\fixture\\OneDrive\\k.pem", ENV).redactedPath
);

// ───────────────────────────────────────────────────────────────────────────────────────────────
// The issuer console honours it (awkit-5ea).
//
// `SPECTER_ISSUER_KEY` can point anywhere, and this key signs licences for OTHER machines. The
// paths below do not exist and are never created: the point is that custody is decided BEFORE the
// read, which is exactly what distinguishes ISSUER_KEY_UNSAFE_LOCATION from ISSUER_KEY_MISSING for
// a file that is absent either way.
// ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * A placeholder trust root. `loadSigningKey` resolves the key id BEFORE it evaluates custody, so the
 * lookup has to succeed for these cases to reach the check under test — but the public key itself is
 * never used, because the refusal happens before any crypto and before the file is opened.
 */
const ISSUER_TRUSTED_KEYS = [
  { keyId: "key1", algorithm: "Ed25519" as const, publicKeySpkiB64: "unused-by-these-cases" }
];

console.log("\nIssuer console custody:");
{
  const syncedKey = resolve("C:\\Users\\fixture\\OneDrive\\SpecterStudio\\issuer-keys\\key1.ed25519.pkcs8.b64");
  const cleanKey = resolve("C:\\Users\\fixture\\AppData\\Local\\SpecterStudio\\issuer-keys\\key1.ed25519.pkcs8.b64");
  const previousOneDrive = process.env.OneDrive;
  process.env.OneDrive = ENV.OneDrive;
  try {
    const syncedReadiness = await new LicenseIssuerService({
      keyId: "key1",
      keyPath: syncedKey,
      outputDirectory: resolve("C:\\Users\\fixture\\AppData\\Local\\SpecterStudio\\issuer-output"),
      product: "SpecterStudio",
      trustedKeys: ISSUER_TRUSTED_KEYS
    }).readiness();
    check("a synced issuer key is not ready", syncedReadiness.ready === false);
    check(
      "…and the reason is the custody one, NOT 'missing' — so the check ran before the read",
      syncedReadiness.reason === "ISSUER_KEY_UNSAFE_LOCATION",
      String(syncedReadiness.reason)
    );

    // Control: the same absent file outside a synced tree reports MISSING, proving the custody
    // reason above is produced by the location and not by the file's absence.
    const cleanReadiness = await new LicenseIssuerService({
      keyId: "key1",
      keyPath: cleanKey,
      outputDirectory: resolve("C:\\Users\\fixture\\AppData\\Local\\SpecterStudio\\issuer-output"),
      product: "SpecterStudio",
      trustedKeys: ISSUER_TRUSTED_KEYS
    }).readiness();
    check(
      "an absent key OUTSIDE a synced tree still reports MISSING (control)",
      cleanReadiness.ready === false && cleanReadiness.reason === "ISSUER_KEY_MISSING",
      String(cleanReadiness.reason)
    );
  } finally {
    if (previousOneDrive === undefined) delete process.env.OneDrive;
    else process.env.OneDrive = previousOneDrive;
  }
}

console.log("\nIssuer wiring (source guards):");
{
  const serviceSource = readFileSync(resolve(ROOT, "src/licensing/issuer/LicenseIssuerService.ts"), "utf8");
  check("the source guard actually read the issuer service", serviceSource.includes("loadSigningKey") && serviceSource.length > 2000);
  check("the issuer evaluates custody", serviceSource.includes("evaluateKeyCustody"));
  const custodyAt = serviceSource.indexOf("evaluateKeyCustody(this.options.keyPath)");
  const readAt = serviceSource.indexOf("readFile(this.options.keyPath");
  check(
    "custody is evaluated BEFORE the key file is read",
    custodyAt > 0 && readAt > 0 && custodyAt < readAt,
    `custody@${custodyAt} read@${readAt}`
  );
  const reasonSource = readFileSync(resolve(ROOT, "src/licensing/issuer/LicenseIssuerContracts.ts"), "utf8");
  check("the refusal has its own reason code", reasonSource.includes("ISSUER_KEY_UNSAFE_LOCATION"));
  const pageSource = readFileSync(resolve(ROOT, "app/renderer/pages/admin/LicenseIssuerPage.tsx"), "utf8");
  check("the operator gets a specific message, not a fallback", pageSource.includes("ISSUER_KEY_UNSAFE_LOCATION"));
  check(
    "…that tells them what to do",
    /cloud-synced folder[\s\S]{0,120}non-synced/.test(pageSource)
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
