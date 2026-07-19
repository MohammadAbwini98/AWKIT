/**
 * Offline issuer: sign a per-machine license from a machine's activation request.
 *
 * Reads the PRIVATE signing key from an external path (never the repo/app), copies the requesting
 * machine's fingerprint hash into the signed license, and writes a signed license file. Records each
 * issuance to `issuance-history.jsonl` next to the key.
 *
 * Usage:
 *   npx tsx tools/license-issuer/issue-license.mts --request req.json --type standard \
 *     --entitlements workflow.execute,automation.browser --days 365 --out license.dat
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  LICENSE_SCHEMA_VERSION,
  type ActivationRequest,
  type Entitlement,
  type LicenseDocument
} from "../../src/licensing/LicenseTypes";
import { signLicensePayload } from "../../src/licensing/crypto/LicenseSignature";
import type { LicensePayload } from "../../src/licensing/LicenseCanonical";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const requestPath = arg("request");
if (!requestPath) {
  console.error("Missing --request <activation-request.json>");
  process.exit(1);
}

const keyId = arg("keyId") ?? "key1";
const defaultDir = join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "SpecterStudio", "issuer-keys");
const keyPath = arg("key") ?? process.env.SPECTER_ISSUER_KEY ?? join(defaultDir, `${keyId}.ed25519.pkcs8.b64`);

let privateKeyB64: string;
try {
  privateKeyB64 = readFileSync(keyPath, "utf8").trim();
} catch {
  console.error(`Cannot read signing key at ${keyPath}. Run keygen.mts first or pass --key.`);
  process.exit(1);
}

const request = JSON.parse(readFileSync(requestPath, "utf8").replace(/^﻿/, "")) as ActivationRequest;
if (!request.fingerprintHash) {
  console.error("Activation request has no fingerprintHash — cannot bind a license.");
  process.exit(1);
}

const licenseType = arg("type") ?? "standard";
const product = arg("product") ?? request.product ?? "SpecterStudio";
const entitlements = (arg("entitlements") ?? "workflow.execute")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean) as Entitlement[];

/** Minute-precision UTC (strip seconds) so validity boundaries are exact to the minute. */
function toMinuteIso(ms: number): string {
  const d = new Date(ms);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

const now = Date.now();
const validFrom = arg("valid-from") ? new Date(`${arg("valid-from")}:00Z`.replace(/:00Z$/, "Z")).getTime() : now;
const days = Number(arg("days") ?? "365");
const expires = arg("expires")
  ? new Date(`${arg("expires")}Z`.replace(/Z+$/, "Z")).getTime()
  : validFrom + days * 24 * 60 * 60 * 1000;

function serialNumber(): string {
  const block = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SPEC-${block()}-${block()}-${block()}`;
}

const payload: LicensePayload = {
  schemaVersion: LICENSE_SCHEMA_VERSION,
  licenseId: randomUUID(),
  serialNumber: serialNumber(),
  product,
  machineFingerprintHash: request.fingerprintHash,
  issuedAtUtc: toMinuteIso(now),
  validFromUtc: toMinuteIso(validFrom),
  expiresAtUtc: toMinuteIso(expires),
  licenseType,
  entitlements,
  issuer: "SpecterStudio Licensing",
  signingKeyId: keyId,
  signatureAlgorithm: "Ed25519"
};

const signature = signLicensePayload(payload, privateKeyB64);
const license: LicenseDocument = { ...payload, signature };

const outPath = arg("out") ?? join(process.cwd(), "specterstudio-license.dat");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(license, null, 2), "utf8");

// Issuance history lives next to the key (external), never in the repo/app.
appendFileSync(
  join(dirname(keyPath), "issuance-history.jsonl"),
  JSON.stringify({
    at: new Date().toISOString(),
    licenseId: license.licenseId,
    serialNumber: license.serialNumber,
    product,
    machineFingerprintHash: license.machineFingerprintHash,
    validFromUtc: license.validFromUtc,
    expiresAtUtc: license.expiresAtUtc,
    entitlements,
    keyId
  }) + "\n",
  "utf8"
);

console.log(`Signed license written to ${outPath}`);
console.log(`  serial: ${license.serialNumber}  type: ${licenseType}  valid ${license.validFromUtc} → ${license.expiresAtUtc}`);
