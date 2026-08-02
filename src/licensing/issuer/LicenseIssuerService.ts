/**
 * Trusted offline license issuance service.
 *
 * The renderer may submit a privacy-safe activation request, but it never receives the private key or
 * chooses an arbitrary write path. The signing key stays in an external per-user file and generated
 * licenses are confined to the configured issuer output directory.
 */
import { createPrivateKey, createPublicKey, randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { LicensePayload } from "../LicenseCanonical";
import {
  LICENSE_SCHEMA_VERSION,
  type ActivationRequest,
  type LicenseDocument
} from "../LicenseTypes";
import { signLicensePayload } from "../crypto/LicenseSignature";
import { findTrustedKey, TRUSTED_KEYS, type TrustedKey } from "../crypto/TrustedKeys";
import { evaluateKeyCustody } from "../../security/keyCustody";
import {
  ISSUER_ENTITLEMENTS,
  ISSUER_LICENSE_TYPES,
  type IssueLicenseInput,
  type IssuedLicenseResult,
  type IssuerReadiness,
  type IssuerReasonCode
} from "./LicenseIssuerContracts";

export class LicenseIssuerError extends Error {
  constructor(public readonly reason: IssuerReasonCode) {
    super(reason);
    this.name = "LicenseIssuerError";
  }
}

export interface LicenseIssuerServiceOptions {
  keyId: string;
  keyPath: string;
  outputDirectory: string;
  product: string;
  issuerLabel?: string;
  trustedKeys?: readonly TrustedKey[];
  now?: () => number;
  idFactory?: () => string;
}

const MAX_KEY_BYTES = 16 * 1024;
const FINGERPRINT_HASH = /^[a-f0-9]{64}$/i;
const CONFIDENCE_LEVELS = new Set(["high", "medium", "limited"]);
const ENTITLEMENT_SET = new Set<string>(ISSUER_ENTITLEMENTS);
const LICENSE_TYPE_SET = new Set<string>(ISSUER_LICENSE_TYPES);

function toMinuteIso(ms: number): string {
  const date = new Date(ms);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

function serialNumber(): string {
  const block = () => randomBytes(2).toString("hex").toUpperCase();
  return `SPEC-${block()}-${block()}-${block()}`;
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** Strict main-process validation for the renderer-supplied activation request. */
export function isActivationRequest(value: unknown, product: string): value is ActivationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<ActivationRequest>;
  if (request.schemaVersion !== LICENSE_SCHEMA_VERSION || request.product !== product) return false;
  if (!isShortString(request.appVersion, 64) || !/^\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(request.appVersion)) return false;
  if (!Number.isInteger(request.fingerprintAlgorithmVersion) || Number(request.fingerprintAlgorithmVersion) < 1) return false;
  if (typeof request.fingerprintHash !== "string" || !FINGERPRINT_HASH.test(request.fingerprintHash)) return false;
  if (!Array.isArray(request.availableSignals) || request.availableSignals.length > 32) return false;
  if (!request.availableSignals.every((signal) => isShortString(signal, 64))) return false;
  if (typeof request.confidenceLevel !== "string" || !CONFIDENCE_LEVELS.has(request.confidenceLevel)) return false;
  if (!isShortString(request.requestId, 128)) return false;
  if (!isShortString(request.generatedAtUtc, 64) || Number.isNaN(Date.parse(request.generatedAtUtc))) return false;
  return true;
}

function validateIssueInput(input: unknown, product: string): asserts input is IssueLicenseInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new LicenseIssuerError("ACTIVATION_REQUEST_INVALID");
  }
  const candidate = input as Partial<IssueLicenseInput>;
  if (!isActivationRequest(candidate.activationRequest, product)) {
    throw new LicenseIssuerError("ACTIVATION_REQUEST_INVALID");
  }
  if (typeof candidate.licenseType !== "string" || !LICENSE_TYPE_SET.has(candidate.licenseType)) {
    throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");
  }
  if (!Number.isInteger(candidate.validityDays) || Number(candidate.validityDays) < 1 || Number(candidate.validityDays) > 3650) {
    throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");
  }
  if (!Array.isArray(candidate.entitlements) || candidate.entitlements.length === 0) {
    throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");
  }
  const unique = new Set(candidate.entitlements);
  if (unique.size !== candidate.entitlements.length || candidate.entitlements.some((item) => typeof item !== "string" || !ENTITLEMENT_SET.has(item))) {
    throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");
  }
}

export class LicenseIssuerService {
  private readonly trustedKeys: readonly TrustedKey[];
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(private readonly options: LicenseIssuerServiceOptions) {
    this.trustedKeys = options.trustedKeys ?? TRUSTED_KEYS;
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async readiness(): Promise<IssuerReadiness> {
    try {
      await this.loadSigningKey();
      return {
        ready: true,
        keyId: this.options.keyId,
        outputDirectory: this.options.outputDirectory
      };
    } catch (error) {
      return {
        ready: false,
        keyId: this.options.keyId,
        outputDirectory: this.options.outputDirectory,
        reason: error instanceof LicenseIssuerError ? error.reason : "ISSUER_KEY_INVALID"
      };
    }
  }

  async issue(input: unknown): Promise<IssuedLicenseResult> {
    validateIssueInput(input, this.options.product);
    const privateKey = await this.loadSigningKey();
    const nowMs = this.now();
    const validFromUtc = toMinuteIso(nowMs);
    const expiresAtUtc = toMinuteIso(Date.parse(validFromUtc) + input.validityDays * 24 * 60 * 60 * 1000);
    const licenseId = this.idFactory();
    const payload: LicensePayload = {
      schemaVersion: LICENSE_SCHEMA_VERSION,
      licenseId,
      serialNumber: serialNumber(),
      product: this.options.product,
      machineFingerprintHash: input.activationRequest.fingerprintHash,
      issuedAtUtc: validFromUtc,
      validFromUtc,
      expiresAtUtc,
      licenseType: input.licenseType,
      entitlements: [...input.entitlements],
      issuer: this.options.issuerLabel ?? "SpecterStudio Licensing",
      signingKeyId: this.options.keyId,
      signatureAlgorithm: "Ed25519"
    };
    const license: LicenseDocument = {
      ...payload,
      signature: signLicensePayload(payload, privateKey)
    };

    const fileName = `specterstudio-license-${licenseId}.dat`;
    const outputPath = join(this.options.outputDirectory, fileName);
    const tempPath = join(this.options.outputDirectory, `.${fileName}.${randomUUID()}.tmp`);
    try {
      await mkdir(this.options.outputDirectory, { recursive: true, mode: 0o700 });
      await writeFile(tempPath, JSON.stringify(license, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(tempPath, outputPath);
      await mkdir(dirname(this.options.keyPath), { recursive: true, mode: 0o700 });
      await appendFile(
        join(dirname(this.options.keyPath), "issuance-history.jsonl"),
        `${JSON.stringify({
          at: new Date(nowMs).toISOString(),
          licenseId,
          serialNumber: license.serialNumber,
          product: license.product,
          requestId: input.activationRequest.requestId,
          machineFingerprintHash: license.machineFingerprintHash,
          validFromUtc,
          expiresAtUtc,
          entitlements: license.entitlements,
          keyId: this.options.keyId,
          outputFile: basename(outputPath)
        })}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
    } catch {
      await rm(tempPath, { force: true }).catch(() => undefined);
      await rm(outputPath, { force: true }).catch(() => undefined);
      throw new LicenseIssuerError("ISSUER_WRITE_FAILED");
    }

    return {
      licenseId,
      serialNumber: license.serialNumber,
      licenseType: license.licenseType,
      machineFingerprintHash: license.machineFingerprintHash,
      validFromUtc,
      expiresAtUtc,
      entitlements: [...license.entitlements],
      fileName,
      outputPath
    };
  }

  private async loadSigningKey(): Promise<string> {
    const trusted = findTrustedKey(this.options.keyId, this.trustedKeys);
    if (!trusted) throw new LicenseIssuerError("ISSUER_KEY_MISMATCH");
    if (trusted.retired) throw new LicenseIssuerError("ISSUER_KEY_RETIRED");

    // Custody BEFORE the read (awkit-5ea). `SPECTER_ISSUER_KEY` can point anywhere, and a key in a
    // cloud-synced folder is continuously copied to an account outside the offline boundary — worse
    // here than for the release manifest, because this key signs licences for other machines.
    // Checked ahead of `readFile` on purpose: a key we must not use is not one we should open.
    // Every path into signing funnels through here, so `readiness()` reports it too.
    const custody = evaluateKeyCustody(this.options.keyPath);
    if (!custody.allowed) throw new LicenseIssuerError("ISSUER_KEY_UNSAFE_LOCATION");

    let encoded: string;
    try {
      encoded = (await readFile(this.options.keyPath, { encoding: "utf8" })).trim();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new LicenseIssuerError(code === "ENOENT" ? "ISSUER_KEY_MISSING" : "ISSUER_KEY_INVALID");
    }
    if (!encoded || Buffer.byteLength(encoded, "utf8") > MAX_KEY_BYTES) {
      throw new LicenseIssuerError("ISSUER_KEY_INVALID");
    }

    try {
      const privateKey = createPrivateKey({ key: Buffer.from(encoded, "base64"), format: "der", type: "pkcs8" });
      const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64");
      if (publicKey !== trusted.publicKeySpkiB64) throw new LicenseIssuerError("ISSUER_KEY_MISMATCH");
    } catch (error) {
      if (error instanceof LicenseIssuerError) throw error;
      throw new LicenseIssuerError("ISSUER_KEY_INVALID");
    }
    return encoded;
  }
}
