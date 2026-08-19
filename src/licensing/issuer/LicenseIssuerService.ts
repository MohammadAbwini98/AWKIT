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
  ISSUER_MAX_FUTURE_START_DAYS,
  ISSUER_MAX_VALIDITY_DAYS,
  ISSUER_MIN_VALIDITY_MINUTES,
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
const DAY_MS = 24 * 60 * 60 * 1000;
/** The window boundaries a caller may state. Anything looser would not round-trip to minute ISO. */
const WINDOW_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function toMinuteIso(ms: number): string {
  const date = new Date(ms);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

/**
 * Resolve the requested validity into the two timestamps the signed schema actually carries.
 *
 * Both accepted forms converge here so there is one place where a window can be rejected, and one
 * definition of "too long" regardless of how the caller expressed it. Bounds are applied AFTER
 * minute-truncation, because truncation is what the license will really say — checking the
 * caller's un-truncated values would let a 90-second request through as a 1-minute license, or
 * reject a window that truncates to a legal one.
 */
function resolveValidity(input: IssueLicenseInput, nowMs: number): { validFromUtc: string; expiresAtUtc: string } {
  const hasDays = input.validityDays !== undefined;
  const hasWindow = input.validityWindow !== undefined;
  if (hasDays === hasWindow) throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");

  if (hasDays) {
    const days = input.validityDays as number;
    if (!Number.isInteger(days) || days < 1 || days > ISSUER_MAX_VALIDITY_DAYS) {
      throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");
    }
    const validFromUtc = toMinuteIso(nowMs);
    return { validFromUtc, expiresAtUtc: toMinuteIso(Date.parse(validFromUtc) + days * DAY_MS) };
  }

  const window = input.validityWindow as { validFromUtc?: unknown; expiresAtUtc?: unknown };
  if (!window || typeof window !== "object" || Array.isArray(window)) {
    throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");
  }
  const from = window.validFromUtc;
  const until = window.expiresAtUtc;
  if (typeof from !== "string" || typeof until !== "string") throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");
  if (!WINDOW_TIMESTAMP.test(from) || !WINDOW_TIMESTAMP.test(until)) {
    throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");
  }
  const fromMs = Date.parse(from);
  const untilMs = Date.parse(until);
  if (Number.isNaN(fromMs) || Number.isNaN(untilMs)) throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");

  const validFromUtc = toMinuteIso(fromMs);
  const expiresAtUtc = toMinuteIso(untilMs);
  const spanMs = Date.parse(expiresAtUtc) - Date.parse(validFromUtc);
  if (spanMs < ISSUER_MIN_VALIDITY_MINUTES * 60_000) throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");
  if (spanMs > ISSUER_MAX_VALIDITY_DAYS * DAY_MS) throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");
  // A window may legitimately start in the past (back-dating cover for an already-elapsed period —
  // the result is simply a license that is already partly or wholly spent), but a start far in the
  // future is much more likely a typed year than an intent, so it is refused rather than signed.
  if (Date.parse(validFromUtc) > nowMs + ISSUER_MAX_FUTURE_START_DAYS * DAY_MS) {
    throw new LicenseIssuerError("ISSUER_OPTIONS_INVALID");
  }
  return { validFromUtc, expiresAtUtc };
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
    const nowMs = this.now();
    // Resolve the window BEFORE reading the key: a request that cannot produce a legal license must
    // not cause the private key to be opened at all.
    const { validFromUtc, expiresAtUtc } = resolveValidity(input, nowMs);
    const privateKey = await this.loadSigningKey();
    const issuedAtUtc = toMinuteIso(nowMs);
    const licenseId = this.idFactory();
    const payload: LicensePayload = {
      schemaVersion: LICENSE_SCHEMA_VERSION,
      licenseId,
      serialNumber: serialNumber(),
      product: this.options.product,
      machineFingerprintHash: input.activationRequest.fingerprintHash,
      issuedAtUtc,
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
          licenseType: license.licenseType,
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
      issuedAtUtc,
      validFromUtc,
      expiresAtUtc,
      entitlements: [...license.entitlements],
      product: license.product,
      issuer: license.issuer,
      signingKeyId: license.signingKeyId,
      signatureAlgorithm: license.signatureAlgorithm,
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
