/**
 * Domain tests for the licensing bounded context (Phase 4). Repo convention: assertion scripts under
 * `tsx`. Run: `npm run verify:licensing`.
 *
 * Uses an EPHEMERAL Ed25519 key pair injected as a trusted key, so no production private key is needed.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LICENSE_SCHEMA_VERSION,
  LicenseStatus,
  type LicenseDocument
} from "../src/licensing/LicenseTypes";
import type { LicensePayload } from "../src/licensing/LicenseCanonical";
import { signLicensePayload, verifyLicenseSignature } from "../src/licensing/crypto/LicenseSignature";
import type { TrustedKey } from "../src/licensing/crypto/TrustedKeys";
import { validateLicense } from "../src/licensing/LicenseValidator";
import { computeMachineFingerprint } from "../src/licensing/MachineFingerprint";
import { LicenseService } from "../src/licensing/LicenseService";
import { LicenseStore, buildEnvelope, computeChecksum, type LicenseMeta } from "../src/licensing/store/LicenseStore";

let passed = 0;
let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) passed += 1;
  else {
    failed += 1;
    console.error(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Key + trusted-key setup ──────────────────────────────────────────────────
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PRIV_B64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const KEY_ID = "testkey";
const KEYS: TrustedKey[] = [
  { keyId: KEY_ID, algorithm: "Ed25519", publicKeySpkiB64: publicKey.export({ type: "spki", format: "der" }).toString("base64") }
];

const MACHINE = "fp-this-machine";
const OTHER = "fp-other-machine";
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function makeLicense(overrides: Partial<LicensePayload> = {}): LicenseDocument {
  const now = Date.now();
  const payload: LicensePayload = {
    schemaVersion: LICENSE_SCHEMA_VERSION,
    licenseId: "lic-1",
    serialNumber: "SPEC-AAAA-BBBB-CCCC",
    product: "SpecterStudio",
    machineFingerprintHash: MACHINE,
    issuedAtUtc: new Date(now - DAY).toISOString(),
    validFromUtc: new Date(now - DAY).toISOString(),
    expiresAtUtc: new Date(now + 30 * DAY).toISOString(),
    licenseType: "standard",
    entitlements: ["workflow.execute", "automation.browser"],
    issuer: "SpecterStudio Licensing",
    signingKeyId: KEY_ID,
    signatureAlgorithm: "Ed25519",
    ...overrides
  };
  return { ...payload, signature: signLicensePayload(payload, PRIV_B64) };
}

function statusOf(license: LicenseDocument | null, opts: Partial<Parameters<typeof validateLicense>[0]> = {}): LicenseStatus {
  return validateLicense({
    license,
    currentFingerprintHash: MACHINE,
    nowMs: Date.now(),
    trustedKeys: KEYS,
    ...opts
  }).status;
}

// ── Signature & payload integrity ────────────────────────────────────────────
check("valid signature → VALID", statusOf(makeLicense()), LicenseStatus.VALID);

const tampered = makeLicense();
tampered.expiresAtUtc = new Date(Date.now() + 999 * DAY).toISOString(); // change after signing
check("payload modification → INVALID_SIGNATURE", statusOf(tampered), LicenseStatus.INVALID_SIGNATURE);

const badSig = makeLicense();
badSig.signature = Buffer.from("not-the-real-signature-bytes-000").toString("base64");
check("wrong signature → INVALID_SIGNATURE", statusOf(badSig), LicenseStatus.INVALID_SIGNATURE);

const unknownKey = makeLicense({ signingKeyId: "no-such-key" });
check("unknown signing key → INVALID_SIGNATURE", statusOf(unknownKey), LicenseStatus.INVALID_SIGNATURE);

check("verifyLicenseSignature ok on valid", verifyLicenseSignature(makeLicense(), KEYS).ok, true);

// ── Schema / algorithm ───────────────────────────────────────────────────────
check("unsupported schema → UNSUPPORTED_VERSION", statusOf(makeLicense({ schemaVersion: 999 })), LicenseStatus.UNSUPPORTED_VERSION);
const badAlg = makeLicense();
(badAlg as unknown as { signatureAlgorithm: string }).signatureAlgorithm = "RSA-PSS";
check("unsupported algorithm → UNSUPPORTED_VERSION", statusOf(badAlg), LicenseStatus.UNSUPPORTED_VERSION);

// ── Machine binding ──────────────────────────────────────────────────────────
check("matching fingerprint → VALID", statusOf(makeLicense(), { currentFingerprintHash: MACHINE }), LicenseStatus.VALID);
check("mismatched fingerprint → MACHINE_MISMATCH", statusOf(makeLicense(), { currentFingerprintHash: OTHER }), LicenseStatus.MACHINE_MISMATCH);

// ── Time boundaries (exact) ──────────────────────────────────────────────────
const t = Date.parse("2030-06-01T12:00:00.000Z");
const bounded = makeLicense({
  validFromUtc: "2030-06-01T12:00:00.000Z",
  expiresAtUtc: "2030-07-01T12:00:00.000Z"
});
check("just before valid-from → NOT_YET_VALID", statusOf(bounded, { nowMs: t - 1 }), LicenseStatus.NOT_YET_VALID);
check("exactly valid-from → VALID/soon (not NOT_YET_VALID)", statusOf(bounded, { nowMs: t }) !== LicenseStatus.NOT_YET_VALID, true);
const expMs = Date.parse("2030-07-01T12:00:00.000Z");
check("one ms before expiry → not EXPIRED", statusOf(bounded, { nowMs: expMs - 1 }) !== LicenseStatus.EXPIRED, true);
check("exactly at expiry → EXPIRED", statusOf(bounded, { nowMs: expMs }), LicenseStatus.EXPIRED);
check("after expiry → EXPIRED", statusOf(bounded, { nowMs: expMs + DAY }), LicenseStatus.EXPIRED);

// ── Expiring-soon threshold ──────────────────────────────────────────────────
const soon = makeLicense({ expiresAtUtc: new Date(Date.now() + 3 * DAY).toISOString() });
check("within 7-day window → EXPIRING_SOON", statusOf(soon), LicenseStatus.EXPIRING_SOON);
const notSoon = makeLicense({ expiresAtUtc: new Date(Date.now() + 20 * DAY).toISOString() });
check("outside window → VALID", statusOf(notSoon), LicenseStatus.VALID);

// ── Revocation ───────────────────────────────────────────────────────────────
check("locally revoked → REVOKED", statusOf(makeLicense(), { locallyRevoked: true }), LicenseStatus.REVOKED);

// ── Clock integrity ──────────────────────────────────────────────────────────
const highWater = Date.now() + 10 * DAY;
check(
  "clock rolled back beyond tolerance → CLOCK_INTEGRITY_WARNING",
  statusOf(makeLicense(), { nowMs: Date.now(), clockHighWaterMs: highWater }),
  LicenseStatus.CLOCK_INTEGRITY_WARNING
);
check(
  "small backward skew within tolerance → not a clock warning",
  statusOf(makeLicense(), { nowMs: Date.now(), clockHighWaterMs: Date.now() + HOUR }) !== LicenseStatus.CLOCK_INTEGRITY_WARNING,
  true
);

// ── Corruption / not activated ───────────────────────────────────────────────
check("no license → NOT_ACTIVATED", statusOf(null), LicenseStatus.NOT_ACTIVATED);
const corruptDoc = makeLicense();
(corruptDoc as unknown as { expiresAtUtc: string }).expiresAtUtc = "not-a-date";
check("bad timestamp structure → CORRUPTED", statusOf(corruptDoc), LicenseStatus.CORRUPTED);

// ── Machine fingerprint: missing-signal tolerance & confidence ───────────────
const fpFull = computeMachineFingerprint([
  { category: "machineGuid", value: "abc", strong: true },
  { category: "cpuModel", value: "cpu-x", strong: true },
  { category: "platform", value: "win32:x64", strong: false },
  { category: "cpuCount", value: "8", strong: false },
  { category: "hostname", value: "host-a", strong: false }
]);
check("fingerprint hash is 64 hex chars", /^[0-9a-f]{64}$/.test(fpFull.fingerprintHash), true);
check("high confidence with 2 strong + 5 signals", fpFull.confidenceLevel, "high");
const fpPartial = computeMachineFingerprint([
  { category: "machineGuid", value: null, strong: true },
  { category: "platform", value: "win32:x64", strong: false },
  { category: "hostname", value: "host-a", strong: false }
]);
check("tolerates missing signal (still hashes)", /^[0-9a-f]{64}$/.test(fpPartial.fingerprintHash), true);
check("availableSignals excludes null", fpPartial.availableSignals.includes("machineGuid"), false);
check("limited confidence when only weak signals", fpPartial.confidenceLevel, "limited");
check("different signals → different hash", fpFull.fingerprintHash !== fpPartial.fingerprintHash, true);
const fpRepeat = computeMachineFingerprint([
  { category: "cpuModel", value: "cpu-x", strong: true },
  { category: "machineGuid", value: "abc", strong: true },
  { category: "cpuCount", value: "8", strong: false },
  { category: "platform", value: "win32:x64", strong: false },
  { category: "hostname", value: "host-a", strong: false }
]);
check("fingerprint stable regardless of signal order", fpFull.fingerprintHash, fpRepeat.fingerprintHash);

// ── Store: atomic import / replacement / corruption / precedence ─────────────
const fixedFp = () => computeMachineFingerprint([{ category: "machineGuid", value: "abc", strong: true }, { category: "platform", value: "p", strong: false }, { category: "cpuModel", value: "c", strong: true }, { category: "cpuCount", value: "4", strong: false }]);
const FP_HASH = fixedFp().fingerprintHash;

const tmpRoot = mkdtempSync(join(tmpdir(), "specter-lic-"));
const localDir = join(tmpRoot, "local");
const sharedDir = join(tmpRoot, "shared");

function serviceFor(store: LicenseStore) {
  return new LicenseService({
    store,
    product: "SpecterStudio",
    appVersion: "0.1.0",
    fingerprintProvider: fixedFp,
    trustedKeys: KEYS
  });
}

try {
  const store = new LicenseStore(localDir, sharedDir);
  const svc = serviceFor(store);

  check("fresh store → NOT_ACTIVATED", svc.getStatus().status, LicenseStatus.NOT_ACTIVATED);

  const licA = makeLicense({ machineFingerprintHash: FP_HASH, licenseId: "A" });
  const imp = svc.importLicense(licA);
  check("import valid license ok", imp.ok, true);
  check("after import → VALID", svc.getStatus().status, LicenseStatus.VALID);
  check("import source is local", svc.getStatus().source, "local");

  // Replacement (atomic overwrite) with a new license id.
  const licB = makeLicense({ machineFingerprintHash: FP_HASH, licenseId: "B", serialNumber: "SPEC-ZZZZ-YYYY-XXXX" });
  const rep = svc.importLicense(licB);
  check("replace ok", rep.ok, true);
  check("replaced license id reflected", svc.peekEnvelope()?.license.licenseId, "B");

  // Reject import: product mismatch.
  const wrongProduct = makeLicense({ machineFingerprintHash: FP_HASH, product: "OtherApp" });
  check("import product mismatch rejected", svc.importLicense(wrongProduct).rejectedReason, "PRODUCT_MISMATCH");
  // Reject import: machine mismatch.
  const wrongMachine = makeLicense({ machineFingerprintHash: "different" });
  check("import machine mismatch rejected", svc.importLicense(wrongMachine).rejectedReason, "MACHINE_MISMATCH");
  // Reject import: bad signature.
  const badImport = makeLicense({ machineFingerprintHash: FP_HASH });
  badImport.signature = Buffer.from("garbage-signature-bytes-0000000").toString("base64");
  check("import bad signature rejected", svc.importLicense(badImport).rejectedReason, "SIGNATURE_INVALID");

  // Revoke local.
  check("revoke local ok", svc.revokeLocal().ok, true);
  check("after revoke → REVOKED", svc.getStatus().status, LicenseStatus.REVOKED);

  // Remove local → back to NOT_ACTIVATED.
  svc.removeLocal();
  check("after remove → NOT_ACTIVATED", svc.getStatus().status, LicenseStatus.NOT_ACTIVATED);

  // Corruption detection: write a valid envelope, then flip a byte in the checksum.
  const meta: LicenseMeta = { importedAtUtc: new Date().toISOString(), clockHighWaterUtc: new Date().toISOString(), locallyRevoked: false };
  const env = buildEnvelope(makeLicense({ machineFingerprintHash: FP_HASH }), meta);
  store.saveLocal(env);
  check("checksum verifies for good envelope", store.load().envelope?.checksum, env.checksum);
  const broken = { ...env, checksum: "deadbeef" };
  store.saveLocal(broken as typeof env);
  check("corrupted checksum → load corrupted", store.load().corrupted, true);
  check("service reports CORRUPTED", svc.getStatus().status, LicenseStatus.CORRUPTED);

  // Precedence: a valid shared (provisioned) license wins over a local one, and conflict is flagged.
  store.removeLocal();
  const sharedStore = new LicenseStore(localDir, sharedDir);
  const sharedSvc = serviceFor(sharedStore);
  // Write a local one via the service, then a shared one directly.
  sharedSvc.importLicense(makeLicense({ machineFingerprintHash: FP_HASH, licenseId: "LOCAL" }));
  const sharedEnv = buildEnvelope(makeLicense({ machineFingerprintHash: FP_HASH, licenseId: "SHARED" }), meta);
  // saveLocal targets localDir; write shared file manually to sharedDir.
  new LicenseStore(sharedDir).saveLocal(sharedEnv);
  const loaded = sharedStore.load();
  check("shared takes precedence over local", loaded.envelope?.license.licenseId, "SHARED");
  check("conflict flagged when both present", loaded.conflict, true);
  check("checksum helper stable", computeChecksum(sharedEnv.license, sharedEnv.meta), sharedEnv.checksum);

  // Activation request export.
  const req = sharedSvc.exportActivationRequest();
  check("activation request has fingerprint hash", req.fingerprintHash, FP_HASH);
  check("activation request carries no secrets", Object.prototype.hasOwnProperty.call(req, "signature"), false);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

// ── RBAC integration (Phase 5 permission mapping) ────────────────────────────
import { Permission, SENSITIVE_PERMISSIONS, effectivePermissions } from "../src/security/authz/Permissions";

const LICENSE_PERMS = [
  Permission.LICENSE_VIEW,
  Permission.LICENSE_EXPORT_REQUEST,
  Permission.LICENSE_IMPORT,
  Permission.LICENSE_REPLACE,
  Permission.LICENSE_REVOKE,
  Permission.LICENSE_AUDIT_VIEW,
  Permission.PAGE_LICENSE
];

const superUser = effectivePermissions({ roles: ["SuperUser"], isProtectedSuperUser: true });
check("Super User has every licensing permission", LICENSE_PERMS.every((p) => superUser.has(p)), true);

const admin = effectivePermissions({ roles: ["Administrator"] });
check("Administrator has NO licensing permission", LICENSE_PERMS.some((p) => admin.has(p)), false);

const operator = effectivePermissions({ roles: ["Operator"] });
check("Operator has NO licensing permission", LICENSE_PERMS.some((p) => operator.has(p)), false);

const viewer = effectivePermissions({ roles: ["Viewer"] });
check("Viewer has NO licensing permission", LICENSE_PERMS.some((p) => viewer.has(p)), false);

check("import is sensitive (reauth)", SENSITIVE_PERMISSIONS.has(Permission.LICENSE_IMPORT), true);
check("replace is sensitive (reauth)", SENSITIVE_PERMISSIONS.has(Permission.LICENSE_REPLACE), true);
check("revoke is sensitive (reauth)", SENSITIVE_PERMISSIONS.has(Permission.LICENSE_REVOKE), true);
check("view is NOT sensitive", SENSITIVE_PERMISSIONS.has(Permission.LICENSE_VIEW), false);

console.log(`\nlicensing: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
