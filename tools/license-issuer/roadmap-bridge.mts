/**
 * Trusted issuer bridge for the Program Status dashboard's "Licenses Issue" page.
 *
 * This is the ONLY thing that stands between the local dashboard server and the real
 * `LicenseIssuerService`. It exists because the dashboard server is plain Node and cannot import
 * TypeScript, and because putting signing anywhere nearer the browser would be wrong regardless of
 * language: the private key is read here, in a short-lived child process, and never crosses back
 * out — not in the result, not in an error, not in a log line.
 *
 * Contract, deliberately narrow:
 *   argv[2] is a command from a fixed allowlist. NOTHING else is read from argv, so no
 *   operator-controlled value — request, fingerprint, timestamp, path — is ever part of a command
 *   line. The single JSON payload arrives on stdin, which is stronger than passing it as an argv
 *   element: there is no command line to quote, truncate, or log.
 *
 *   stdout is exactly one JSON line: {"ok":true,"value":…} or {"ok":false,"reason":CODE}. `reason`
 *   is always an `IssuerReasonCode` or `BRIDGE_FAILED` — never a message, path, or stack.
 *
 * Usage (the dashboard server; not intended to be typed by hand):
 *   node node_modules/tsx/dist/cli.mjs tools/license-issuer/roadmap-bridge.mts issue < payload.json
 */
import { readFile } from "node:fs/promises";
import { LICENSING_PRODUCT, type ActivationRequest, type LicenseDocument } from "../../src/licensing/LicenseTypes";
import {
  DEFAULT_ISSUER_KEY_ID,
  issuerKeyPathFor,
  issuerOutputDirectoryFor,
  nonElectronRuntimeRoot
} from "../../src/licensing/issuer/IssuerLocations";
import {
  ISSUER_ENTITLEMENTS,
  ISSUER_LICENSE_TYPES,
  ISSUER_MAX_FUTURE_START_DAYS,
  ISSUER_MAX_VALIDITY_DAYS,
  ISSUER_MIN_VALIDITY_MINUTES,
  type IssueLicenseInput
} from "../../src/licensing/issuer/LicenseIssuerContracts";
import {
  LicenseIssuerError,
  LicenseIssuerService,
  isActivationRequest
} from "../../src/licensing/issuer/LicenseIssuerService";

const COMMANDS = ["readiness", "parse", "issue", "history"] as const;
type Command = (typeof COMMANDS)[number];

/** Hard ceiling on the stdin payload. An activation request is well under 2 KB. */
const MAX_PAYLOAD_BYTES = 64 * 1024;
/** How many issuance records the history view returns, newest first. */
const HISTORY_LIMIT = 25;
/** Only read the tail of the history file; it grows without bound over a key's lifetime. */
const HISTORY_TAIL_BYTES = 512 * 1024;

const runtimeRoot = nonElectronRuntimeRoot();
const keyPath = issuerKeyPathFor(runtimeRoot, DEFAULT_ISSUER_KEY_ID);
const outputDirectory = issuerOutputDirectoryFor(runtimeRoot);

function service(): LicenseIssuerService {
  return new LicenseIssuerService({
    keyId: DEFAULT_ISSUER_KEY_ID,
    keyPath,
    outputDirectory,
    product: LICENSING_PRODUCT
  });
}

function emit(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function fail(reason: string): never {
  emit({ ok: false, reason });
  process.exit(0);
}

async function readPayload(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_PAYLOAD_BYTES) fail("ISSUER_OPTIONS_INVALID");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "").trim();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    fail("ACTIVATION_REQUEST_INVALID");
  }
}

/**
 * The safe projection of an activation request. Everything here is already privacy-safe by
 * construction (the request itself carries no raw hardware value), but the fingerprint is echoed in
 * full only because the operator must be able to match it against what the requesting machine
 * showed them. The page shortens it for display.
 */
function safeRequestView(request: ActivationRequest) {
  return {
    product: request.product,
    appVersion: request.appVersion,
    fingerprintHash: request.fingerprintHash,
    fingerprintAlgorithmVersion: request.fingerprintAlgorithmVersion,
    confidenceLevel: request.confidenceLevel,
    availableSignals: [...request.availableSignals],
    requestId: request.requestId,
    generatedAtUtc: request.generatedAtUtc,
    schemaVersion: request.schemaVersion
  };
}

/** Issuance history lives next to the external key and is read here, never copied into the repo. */
async function readHistory(): Promise<Array<Record<string, unknown>>> {
  const historyPath = keyPath.replace(/[^\/]+$/, "issuance-history.jsonl");
  let text: string;
  try {
    const handle = await readFile(historyPath, { encoding: "utf8" });
    text = handle.length > HISTORY_TAIL_BYTES ? handle.slice(handle.length - HISTORY_TAIL_BYTES) : handle;
  } catch {
    return [];
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      rows.push({
        at: row.at ?? null,
        serialNumber: row.serialNumber ?? null,
        licenseId: row.licenseId ?? null,
        licenseType: row.licenseType ?? null,
        machineFingerprintHash: typeof row.machineFingerprintHash === "string" ? row.machineFingerprintHash : null,
        validFromUtc: row.validFromUtc ?? null,
        expiresAtUtc: row.expiresAtUtc ?? null,
        entitlements: Array.isArray(row.entitlements) ? row.entitlements : [],
        keyId: row.keyId ?? null
      });
    } catch {
      /* a truncated tail line is expected; skip it rather than failing the whole view */
    }
  }
  return rows.slice(-HISTORY_LIMIT).reverse();
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) fail("ISSUER_OPTIONS_INVALID");

  if (command === "readiness") {
    const readiness = await service().readiness();
    emit({
      ok: true,
      value: {
        ...readiness,
        product: LICENSING_PRODUCT,
        licenseTypes: [...ISSUER_LICENSE_TYPES],
        entitlements: [...ISSUER_ENTITLEMENTS],
        limits: {
          maxValidityDays: ISSUER_MAX_VALIDITY_DAYS,
          minValidityMinutes: ISSUER_MIN_VALIDITY_MINUTES,
          maxFutureStartDays: ISSUER_MAX_FUTURE_START_DAYS
        }
      }
    });
    return;
  }

  if (command === "history") {
    emit({ ok: true, value: { records: await readHistory() } });
    return;
  }

  const payload = (await readPayload()) as Record<string, unknown>;

  if (command === "parse") {
    // The SAME predicate the signing path uses. A request that parses here and is then refused at
    // issue time would make the review step a lie, so there is exactly one validator.
    if (!isActivationRequest(payload.activationRequest, LICENSING_PRODUCT)) fail("ACTIVATION_REQUEST_INVALID");
    emit({ ok: true, value: safeRequestView(payload.activationRequest as ActivationRequest) });
    return;
  }

  try {
    const issued = await service().issue(payload as unknown as IssueLicenseInput);
    // Read the signed file back rather than re-serialising what we think we wrote: what the operator
    // downloads is then provably the same bytes that landed in the confined output folder.
    const document = JSON.parse(await readFile(issued.outputPath, { encoding: "utf8" })) as LicenseDocument;
    emit({ ok: true, value: { result: issued, document } });
  } catch (error) {
    fail(error instanceof LicenseIssuerError ? error.reason : "BRIDGE_FAILED");
  }
}

main().catch(() => fail("BRIDGE_FAILED"));
