/**
 * Domain tests for the licensing bounded context (Phase 4). Repo convention: assertion scripts under
 * `tsx`. Run: `npm run verify:licensing`.
 *
 * Uses an EPHEMERAL Ed25519 key pair injected as a trusted key, so no production private key is needed.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LICENSE_SCHEMA_VERSION,
  LicenseStatus,
  OPERABLE_STATUSES,
  type LicenseDocument
} from "../src/licensing/LicenseTypes";
import { applyLicenseRunGatePolicy, INTEGRITY_FAILURE_STATUSES } from "../src/licensing/RunGatePolicy";
import {
  CLEARED_ENFORCEMENT_STATE,
  ENFORCEMENT_TRIGGERS,
  nextEnforcementState,
  type EnforcementLatchState
} from "../src/licensing/RunGateEnforcement";
import {
  MIGRATION_GRACE_DAYS,
  createMigrationGraceAnchor,
  evaluateMigrationGrace,
  graceDaysRemaining,
  markGraceConsumed,
  mergeGraceAnchors,
  touchGraceClock
} from "../src/licensing/MigrationGrace";
import type { LicensePayload } from "../src/licensing/LicenseCanonical";
import { signLicensePayload, verifyLicenseSignature } from "../src/licensing/crypto/LicenseSignature";
import type { TrustedKey } from "../src/licensing/crypto/TrustedKeys";
import { validateLicense } from "../src/licensing/LicenseValidator";
import { computeMachineFingerprint } from "../src/licensing/MachineFingerprint";
import { LicenseService } from "../src/licensing/LicenseService";
import {
  LICENSE_REVALIDATE_INTERVAL_MS,
  licenseAttentionFor
} from "../src/licensing/LicenseAttention";
import { LicenseStore, buildEnvelope, computeChecksum, type LicenseMeta } from "../src/licensing/store/LicenseStore";
import { LicenseIssuerError, LicenseIssuerService } from "../src/licensing/issuer/LicenseIssuerService";
import type { IssueLicenseInput } from "../src/licensing/issuer/LicenseIssuerContracts";

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

// ── Trusted offline issuer service ────────────────────────────────────────────
console.log("\nOffline issuer service:");
const issuerRoot = mkdtempSync(join(tmpdir(), "specter-issuer-"));
try {
  const keyDirectory = join(issuerRoot, "keys");
  const keyPath = join(keyDirectory, `${KEY_ID}.ed25519.pkcs8.b64`);
  const outputDirectory = join(issuerRoot, "output");
  mkdirSync(keyDirectory, { recursive: true });
  writeFileSync(keyPath, PRIV_B64, "utf8");
  const fixedNow = Date.parse("2026-08-02T15:20:45.000Z");
  const issuerService = new LicenseIssuerService({
    keyId: KEY_ID,
    keyPath,
    outputDirectory,
    product: "SpecterStudio",
    trustedKeys: KEYS,
    now: () => fixedNow,
    idFactory: () => "11111111-2222-4333-8444-555555555555"
  });
  const activationRequest = {
    schemaVersion: LICENSE_SCHEMA_VERSION,
    product: "SpecterStudio",
    appVersion: "0.1.2",
    fingerprintAlgorithmVersion: 1,
    fingerprintHash: "a".repeat(64),
    availableSignals: ["machineGuid", "cpuModel"],
    confidenceLevel: "high" as const,
    requestId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    generatedAtUtc: "2026-08-02T15:00:00.000Z"
  };
  const issueInput: IssueLicenseInput = {
    activationRequest,
    licenseType: "standard",
    validityDays: 365,
    entitlements: ["workflow.execute", "workflow.concurrent", "automation.browser"]
  };

  const ready = await issuerService.readiness();
  check("issuer readiness validates the external private key against the trusted public key", ready.ready, true);
  const issued = await issuerService.issue(issueInput);
  check("issuer saves the signed .dat automatically in its confined output folder", issued.outputPath, join(outputDirectory, issued.fileName));
  const issuedDocument = JSON.parse(readFileSync(issued.outputPath, "utf8")) as LicenseDocument;
  check("issued document is signed by the selected trusted key", verifyLicenseSignature(issuedDocument, KEYS).ok, true);
  check("issued document is bound to the request fingerprint", issuedDocument.machineFingerprintHash, activationRequest.fingerprintHash);
  check("issuer writes minute-precision validity", issuedDocument.validFromUtc, "2026-08-02T15:20:00.000Z");
  check("issuer applies the requested duration", issuedDocument.expiresAtUtc, "2027-08-02T15:20:00.000Z");
  check("no temporary license file remains after the atomic write", readdirSync(outputDirectory).some((name) => name.endsWith(".tmp")), false);
  const history = readFileSync(join(keyDirectory, "issuance-history.jsonl"), "utf8");
  check("issuance history records the request and license IDs", history.includes(activationRequest.requestId) && history.includes(issued.licenseId), true);
  check("issuance history never contains private key material", history.includes(PRIV_B64), false);

  let invalidRequestReason: string | null = null;
  try {
    await issuerService.issue({
      ...issueInput,
      activationRequest: { ...activationRequest, fingerprintHash: "not-a-hash" }
    });
  } catch (error) {
    invalidRequestReason = error instanceof LicenseIssuerError ? error.reason : null;
  }
  check("malformed activation requests fail closed before signing", invalidRequestReason, "ACTIVATION_REQUEST_INVALID");

  const { privateKey: wrongPrivateKey } = generateKeyPairSync("ed25519");
  const wrongKeyPath = join(keyDirectory, "wrong.pkcs8.b64");
  writeFileSync(wrongKeyPath, wrongPrivateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), "utf8");
  const wrongKeyReadiness = await new LicenseIssuerService({
    keyId: KEY_ID,
    keyPath: wrongKeyPath,
    outputDirectory,
    product: "SpecterStudio",
    trustedKeys: KEYS
  }).readiness();
  check("a private key that does not match the shipped public key fails closed", wrongKeyReadiness.reason, "ISSUER_KEY_MISMATCH");
  const missingKeyReadiness = await new LicenseIssuerService({
    keyId: KEY_ID,
    keyPath: join(keyDirectory, "missing.pkcs8.b64"),
    outputDirectory,
    product: "SpecterStudio",
    trustedKeys: KEYS
  }).readiness();
  check("a missing external private key is reported without creating one", missingKeyReadiness.reason, "ISSUER_KEY_MISSING");
} finally {
  rmSync(issuerRoot, { recursive: true, force: true });
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
check("Super User cannot cross the exclusive issuer permission boundary", superUser.has(Permission.LICENSE_ISSUE), false);

const admin = effectivePermissions({ roles: ["Administrator"] });
check("Administrator has NO licensing permission", LICENSE_PERMS.some((p) => admin.has(p)), false);

const operator = effectivePermissions({ roles: ["Operator"] });
check("Operator has NO licensing permission", LICENSE_PERMS.some((p) => operator.has(p)), false);

const viewer = effectivePermissions({ roles: ["Viewer"] });
check("Viewer has NO licensing permission", LICENSE_PERMS.some((p) => viewer.has(p)), false);

check("import is sensitive (reauth)", SENSITIVE_PERMISSIONS.has(Permission.LICENSE_IMPORT), true);
check("replace is sensitive (reauth)", SENSITIVE_PERMISSIONS.has(Permission.LICENSE_REPLACE), true);
check("revoke is sensitive (reauth)", SENSITIVE_PERMISSIONS.has(Permission.LICENSE_REVOKE), true);
check("issue is sensitive (reauth)", SENSITIVE_PERMISSIONS.has(Permission.LICENSE_ISSUE), true);
check("view is NOT sensitive", SENSITIVE_PERMISSIONS.has(Permission.LICENSE_VIEW), false);

const issuerPermissions = effectivePermissions({ roles: ["Issuer"] });
check("Issuer has the signing permission", issuerPermissions.has(Permission.LICENSE_ISSUE), true);
check("Issuer cannot import an installed license", issuerPermissions.has(Permission.LICENSE_IMPORT), false);

// ── Global attention policy + background cadence (awkit-x13) ─────────────────
check("healthy VALID status stays globally silent", licenseAttentionFor(LicenseStatus.VALID), null);
check("NOT_ACTIVATED surfaces warning attention", licenseAttentionFor(LicenseStatus.NOT_ACTIVATED)?.tone, "warning");
check("EXPIRING_SOON surfaces warning attention", licenseAttentionFor(LicenseStatus.EXPIRING_SOON)?.tone, "warning");
check(
  "every non-healthy status has a global attention label",
  Object.values(LicenseStatus)
    .filter((status) => status !== LicenseStatus.VALID)
    .every((status) => Boolean(licenseAttentionFor(status)?.label)),
  true
);
check(
  "invalid/mismatch/corrupted states use danger attention",
  [LicenseStatus.INVALID_SIGNATURE, LicenseStatus.MACHINE_MISMATCH, LicenseStatus.CORRUPTED].every(
    (status) => licenseAttentionFor(status)?.tone === "danger"
  ),
  true
);
check("background revalidation cadence is fifteen minutes", LICENSE_REVALIDATE_INTERVAL_MS, 15 * 60 * 1000);

// ── Run-gate decision table + one-time migration grace (owner decision 2026-07-29, awkit-1cc) ────
//
// These drive the PURE policy directly. The Electron wiring is covered by verify:e2e-licensing; what
// must be exhaustive here is the table itself, because every other surface reads it.
console.log("\nRun gate — decision table:");

const OPERABLE = [LicenseStatus.VALID, LicenseStatus.EXPIRING_SOON];
const GRACEABLE = [LicenseStatus.NOT_ACTIVATED];
const CANCEL_PENDING = [
  LicenseStatus.INVALID_SIGNATURE,
  LicenseStatus.MACHINE_MISMATCH,
  LicenseStatus.CORRUPTED,
  LicenseStatus.REVOKED,
  LicenseStatus.NOT_YET_VALID,
  LicenseStatus.UNSUPPORTED_VERSION,
  LicenseStatus.CLOCK_INTEGRITY_WARNING
];

const gateFor = (status: LicenseStatus, inGrace = false) =>
  applyLicenseRunGatePolicy({ status, operable: OPERABLE_STATUSES.has(status) }, true, { inGrace });

// Enumerate the WHOLE enum rather than a hand-picked list, so a status added later cannot slip
// through unclassified — the counts below are the cardinality guard on that enumeration.
const ALL_STATUSES = Object.values(LicenseStatus);
check("the enum under test is the full status list", ALL_STATUSES.length, 11);

for (const status of ALL_STATUSES) {
  const decision = gateFor(status);
  const shouldAllow = OPERABLE.includes(status);
  check(`${status}: new runs ${shouldAllow ? "allowed" : "blocked"}`, decision.allowed, shouldAllow);
  check(`${status}: blockedByLicense`, decision.blockedByLicense, !shouldAllow);
  check(
    `${status}: active-run disposition`,
    decision.activeRunDisposition,
    CANCEL_PENDING.includes(status) ? "cancel-pending" : "allow-to-finish"
  );
}
check("exactly two statuses admit runs", ALL_STATUSES.filter((s) => gateFor(s).allowed).length, 2);
check(
  "exactly seven statuses cancel pending work",
  ALL_STATUSES.filter((s) => gateFor(s).activeRunDisposition === "cancel-pending").length,
  7
);

console.log("\nRun gate — enforcement latch:");
const LATCH_T0 = Date.parse("2026-07-29T00:00:00.000Z");
check("integrity-failure set has exactly seven statuses", INTEGRITY_FAILURE_STATUSES.size, 7);
check("all statuses classify exactly seven integrity failures", ALL_STATUSES.filter((s) => INTEGRITY_FAILURE_STATUSES.has(s)).length, 7);
check("the enforcement trigger list has seven entries", ENFORCEMENT_TRIGGERS.length, 7);
check("every enforcement trigger is distinct", new Set(ENFORCEMENT_TRIGGERS).size, 7);

for (const status of ALL_STATUSES) {
  if (!INTEGRITY_FAILURE_STATUSES.has(status)) continue;
  const decision = gateFor(status);
  const transition = nextEnforcementState(
    CLEARED_ENFORCEMENT_STATE,
    { activeRunDisposition: decision.activeRunDisposition, reason: decision.reason, status },
    LATCH_T0
  );
  check(`${status}: every blocking evaluation requests a pending sweep`, transition.shouldCancelPending, true);
}

let folded: EnforcementLatchState = CLEARED_ENFORCEMENT_STATE;
let auditCount = 0;
let sweepCount = 0;
for (let i = 0; i < 24; i += 1) {
  const decision = gateFor(LicenseStatus.INVALID_SIGNATURE);
  const transition = nextEnforcementState(
    folded,
    { activeRunDisposition: decision.activeRunDisposition, reason: decision.reason, status: LicenseStatus.INVALID_SIGNATURE },
    LATCH_T0 + i
  );
  folded = transition.next;
  if (transition.shouldAudit) auditCount += 1;
  if (transition.shouldCancelPending) sweepCount += 1;
}
check("24 repeated blocking passes audit only the engagement", auditCount, 1);
check("24 repeated blocking passes still sweep 24 times", sweepCount, 24);

folded = CLEARED_ENFORCEMENT_STATE;
auditCount = 0;
for (let i = 0; i < 10; i += 1) {
  const status = i < 5 ? LicenseStatus.INVALID_SIGNATURE : LicenseStatus.MACHINE_MISMATCH;
  const decision = gateFor(status);
  const transition = nextEnforcementState(
    folded,
    { activeRunDisposition: decision.activeRunDisposition, reason: decision.reason, status },
    LATCH_T0 + i
  );
  folded = transition.next;
  if (transition.shouldAudit) auditCount += 1;
}
check("a blocking status change is audited as a new cause", auditCount, 2);

const validDecision = gateFor(LicenseStatus.VALID);
const recovery = nextEnforcementState(
  folded,
  { activeRunDisposition: validDecision.activeRunDisposition, reason: validDecision.reason, status: LicenseStatus.VALID },
  LATCH_T0 + 20
);
check("recovery emits the cleared event", recovery.auditEvent, "LICENSE_ENFORCEMENT_CLEARED");
check("recovery clears the latch", recovery.next.blocking, false);
check("recovery does not sweep pending work", recovery.shouldCancelPending, false);

const reblockDecision = gateFor(LicenseStatus.CORRUPTED);
const reblock = nextEnforcementState(
  recovery.next,
  { activeRunDisposition: reblockDecision.activeRunDisposition, reason: reblockDecision.reason, status: LicenseStatus.CORRUPTED },
  LATCH_T0 + 21
);
check("blocking again after recovery re-engages audit", reblock.auditEvent, "LICENSE_ENFORCEMENT_ENGAGED");

folded = recovery.next;
auditCount = 0;
sweepCount = 0;
for (let i = 0; i < 24; i += 1) {
  const transition = nextEnforcementState(
    folded,
    { activeRunDisposition: validDecision.activeRunDisposition, reason: validDecision.reason, status: LicenseStatus.VALID },
    LATCH_T0 + 30 + i
  );
  folded = transition.next;
  if (transition.shouldAudit) auditCount += 1;
  if (transition.shouldCancelPending) sweepCount += 1;
}
check("24 valid passes from cleared do not audit", auditCount, 0);
check("24 valid passes from cleared do not sweep", sweepCount, 0);

// Grace rescues NOT_ACTIVATED and nothing else. Asserting BOTH directions is what stops a grace
// implementation that simply allows everything from passing here.
for (const status of ALL_STATUSES) {
  const withGrace = gateFor(status, true);
  const expected = OPERABLE.includes(status) || GRACEABLE.includes(status);
  check(`${status}: with grace open, run ${expected ? "allowed" : "still blocked"}`, withGrace.allowed, expected);
}
check(
  "grace rescues exactly one otherwise-blocked status",
  ALL_STATUSES.filter((s) => !gateFor(s).allowed && gateFor(s, true).allowed).length,
  1
);
check("grace admission is labelled as such", gateFor(LicenseStatus.NOT_ACTIVATED, true).reason, "MIGRATION_GRACE");
check("grace admission sets graceApplied", gateFor(LicenseStatus.NOT_ACTIVATED, true).graceApplied, true);
check("a licensed run is NOT labelled grace", gateFor(LicenseStatus.VALID, true).graceApplied, false);
check("EXPIRED is never graced", gateFor(LicenseStatus.EXPIRED, true).allowed, false);
check("CORRUPTED is never graced", gateFor(LicenseStatus.CORRUPTED, true).allowed, false);

// Evaluation failure fails CLOSED — the pre-2026-07-29 behaviour failed open.
const failedEval = applyLicenseRunGatePolicy(
  { status: LicenseStatus.VALID, operable: true, evaluationFailed: true },
  true,
  { inGrace: true }
);
check("an evaluation fault blocks even a VALID+grace state", failedEval.allowed, false);
check("an evaluation fault is labelled", failedEval.reason, "EVALUATION_FAILED");
check("an evaluation fault does not kill running work", failedEval.activeRunDisposition, "allow-to-finish");

// The bypass still works when explicitly disabled — otherwise dev/test could not drive either path.
check(
  "enforcement disabled admits an unlicensed run",
  applyLicenseRunGatePolicy({ status: LicenseStatus.NOT_ACTIVATED, operable: false }, false).allowed,
  true
);
check(
  "enforcement disabled is labelled, not silently a licence",
  applyLicenseRunGatePolicy({ status: LicenseStatus.NOT_ACTIVATED, operable: false }, false).reason,
  "ENFORCEMENT_DISABLED"
);

console.log("\nMigration grace — one-time 14-day window:");

const T0 = Date.parse("2026-07-29T00:00:00.000Z");

check("the window is fourteen days", MIGRATION_GRACE_DAYS, 14);

const upgraded = createMigrationGraceAnchor({ installationKind: "upgraded", nowMs: T0 });
check("an upgraded install opens the window", evaluateMigrationGrace({ anchor: upgraded, nowMs: T0 }).inGrace, true);
check("day 13 is still inside", evaluateMigrationGrace({ anchor: upgraded, nowMs: T0 + 13 * DAY }).inGrace, true);
check("day 14 has closed", evaluateMigrationGrace({ anchor: upgraded, nowMs: T0 + 14 * DAY }).inGrace, false);
check(
  "closing is reported as expiry",
  evaluateMigrationGrace({ anchor: upgraded, nowMs: T0 + 14 * DAY }).reason,
  "GRACE_EXPIRED"
);
check(
  "expiry asks the caller to burn the window",
  evaluateMigrationGrace({ anchor: upgraded, nowMs: T0 + 14 * DAY }).shouldMarkConsumed,
  true
);
check(
  "days remaining counts down",
  graceDaysRemaining(evaluateMigrationGrace({ anchor: upgraded, nowMs: T0 + 10 * DAY })),
  4
);

const fresh = createMigrationGraceAnchor({ installationKind: "fresh", nowMs: T0 });
check("a FRESH install gets no window", evaluateMigrationGrace({ anchor: fresh, nowMs: T0 }).inGrace, false);
check(
  "a fresh install says why",
  evaluateMigrationGrace({ anchor: fresh, nowMs: T0 }).reason,
  "FRESH_INSTALL_NOT_ELIGIBLE"
);
check("a fresh anchor is born consumed", fresh.consumed, true);
check("no anchor is not a window", evaluateMigrationGrace({ anchor: null, nowMs: T0 }).inGrace, false);

// Tamper resistance. Each of these is a way someone could try to reopen or extend the window.
const consumedAnchor = markGraceConsumed(upgraded);
check("a consumed window never reopens", evaluateMigrationGrace({ anchor: consumedAnchor, nowMs: T0 }).inGrace, false);
check(
  "a consumed window says why",
  evaluateMigrationGrace({ anchor: consumedAnchor, nowMs: T0 }).reason,
  "GRACE_CONSUMED"
);

const advanced = touchGraceClock(upgraded, T0 + 5 * DAY);
check("the clock high-water advances", Date.parse(advanced.clockHighWaterUtc), T0 + 5 * DAY);
check("the clock high-water never moves backwards", touchGraceClock(advanced, T0).clockHighWaterUtc, advanced.clockHighWaterUtc);
check("moving the clock back closes the window", evaluateMigrationGrace({ anchor: advanced, nowMs: T0 - DAY }).inGrace, false);
check("a rolled-back clock is named", evaluateMigrationGrace({ anchor: advanced, nowMs: T0 - DAY }).reason, "CLOCK_ROLLBACK");
check(
  "a small backwards skew is tolerated, not treated as tampering",
  evaluateMigrationGrace({ anchor: advanced, nowMs: T0 + 5 * DAY - 60_000 }).inGrace,
  true
);

// Dual-location reconciliation: the earliest anchor and a sticky `consumed` both win.
const later = createMigrationGraceAnchor({ installationKind: "upgraded", nowMs: T0 + 10 * DAY });
check(
  "merging keeps the EARLIEST first launch (deleting one copy cannot restart it)",
  mergeGraceAnchors(later, upgraded)?.firstEnforcedLaunchUtc,
  upgraded.firstEnforcedLaunchUtc
);
check(
  "merging keeps the earliest regardless of argument order",
  mergeGraceAnchors(upgraded, later)?.firstEnforcedLaunchUtc,
  upgraded.firstEnforcedLaunchUtc
);
check("consumed is sticky across copies", mergeGraceAnchors(consumedAnchor, later)?.consumed, true);
check("fresh wins a disagreement", mergeGraceAnchors(fresh, upgraded)?.installationKind, "fresh");
check(
  "merging takes the highest clock seen anywhere",
  Date.parse(mergeGraceAnchors(upgraded, advanced)!.clockHighWaterUtc),
  T0 + 5 * DAY
);
check(
  "merging a missing copy returns the present one",
  mergeGraceAnchors(null, upgraded)?.firstEnforcedLaunchUtc,
  upgraded.firstEnforcedLaunchUtc
);
check("merging two missing copies is still nothing", mergeGraceAnchors(null, null), null);

// A malformed anchor must fail closed, not act as an unbounded grace.
const malformed = { ...upgraded, graceEndsAtUtc: "not-a-date" };
check("a malformed anchor grants no window", evaluateMigrationGrace({ anchor: malformed, nowMs: T0 }).inGrace, false);
check("a malformed anchor is burned", evaluateMigrationGrace({ anchor: malformed, nowMs: T0 }).shouldMarkConsumed, true);

console.log(`\nlicensing: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
