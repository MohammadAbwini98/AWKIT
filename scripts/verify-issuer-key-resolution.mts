/**
 * Gate for the external signing-key contract: ONE resolver, five readiness states, and a key that
 * never crosses a boundary it should not (`awkit-uwfo`).
 *
 * Why this exists as its own verifier. The License Issuer reported "Signing key: Unavailable — the
 * external signing key was not found on this issuer workstation" and there was no way to act on it:
 * `IssuerReadiness` was a boolean plus one code, so "provision a key here", "fix this file's ACL"
 * and "this build does not trust that key id" all rendered identically, and the payload never named
 * the location the operator was supposed to provision. Underneath, each front end reached the key by
 * its own arithmetic — including a `"."` fallback that resolved a PRIVATE KEY relative to the
 * caller's working directory, and a history path built by rewriting the tail of the key path with a
 * forward-slash-only regex that consumed the whole of a Windows path.
 *
 * Everything here runs on an EPHEMERAL Ed25519 pair injected as the trusted set. No production
 * private key is read, and no assertion in this file depends on one existing.
 *
 * Run: `npm run verify:issuer-key-resolution`.
 */
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  LICENSE_SCHEMA_VERSION,
  LICENSING_PRODUCT,
  LicenseStatus,
  type LicenseDocument
} from "../src/licensing/LicenseTypes";
import { validateLicense } from "../src/licensing/LicenseValidator";
import { verifyLicenseSignature } from "../src/licensing/crypto/LicenseSignature";
import type { TrustedKey } from "../src/licensing/crypto/TrustedKeys";
import { LicenseStore } from "../src/licensing/store/LicenseStore";
import { LicenseService } from "../src/licensing/LicenseService";
import {
  DEFAULT_ISSUER_KEY_ID,
  ISSUER_KEY_FILE_SUFFIX,
  ISSUER_KEY_PATH_ENV,
  nonElectronRuntimeRoot,
  resolveIssuerKeyLocation
} from "../src/licensing/issuer/IssuerLocations";
import {
  ISSUER_READINESS_STATES,
  issuerReadinessStateFor,
  type IssueLicenseInput
} from "../src/licensing/issuer/LicenseIssuerContracts";
import {
  LicenseIssuerError,
  LicenseIssuerService,
  classifyKeyReadError
} from "../src/licensing/issuer/LicenseIssuerService";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Ephemeral trust anchor ───────────────────────────────────────────────────────────────────────
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PRIVATE_B64 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const KEY_ID = "verifykey";
const KEYS: TrustedKey[] = [
  { keyId: KEY_ID, algorithm: "Ed25519", publicKeySpkiB64: publicKey.export({ format: "der", type: "spki" }).toString("base64") },
  { keyId: "retiredkey", algorithm: "Ed25519", publicKeySpkiB64: publicKey.export({ format: "der", type: "spki" }).toString("base64"), retired: true }
];

const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);

function activationRequest(fingerprintHash = FINGERPRINT_A) {
  return {
    schemaVersion: LICENSE_SCHEMA_VERSION,
    product: LICENSING_PRODUCT,
    appVersion: "0.1.20",
    fingerprintAlgorithmVersion: 1,
    fingerprintHash,
    availableSignals: ["machineGuid", "cpuModel"],
    confidenceLevel: "high" as const,
    requestId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    generatedAtUtc: "2026-08-19T12:00:00.000Z"
  };
}

function issueInput(): IssueLicenseInput {
  return {
    activationRequest: activationRequest(),
    licenseType: "standard",
    validityDays: 30,
    entitlements: ["workflow.execute", "workflow.concurrent", "automation.browser"]
  };
}

const sandbox = mkdtempSync(join(tmpdir(), "awkit-issuer-key-"));
/** A key folder whose name has a space and every shell metacharacter that matters on win32. */
const HOSTILE_DIR_NAME = "Program Files (x86) & Co ^ %PATH% ;keys";

function service(overrides: Partial<ConstructorParameters<typeof LicenseIssuerService>[0]> = {}) {
  return new LicenseIssuerService({
    keyId: KEY_ID,
    keyPath: join(sandbox, "keys", `${KEY_ID}${ISSUER_KEY_FILE_SUFFIX}`),
    outputDirectory: join(sandbox, "output"),
    product: LICENSING_PRODUCT,
    trustedKeys: KEYS,
    ...overrides
  });
}

try {
  // ══ 1. The canonical resolver ═══════════════════════════════════════════════════════════════
  console.log("\nCanonical signing-key resolver:");

  const WIN_ROOT = join("C:", "Users", "operator", "AppData", "Local", "SpecterStudio");
  const cleanEnv: NodeJS.ProcessEnv = { LOCALAPPDATA: join("C:", "Users", "operator", "AppData", "Local") };

  const defaultLocation = resolveIssuerKeyLocation({ runtimeRoot: WIN_ROOT, keyId: "key2", env: cleanEnv });
  check(
    "the default location is <runtimeRoot>/issuer-keys/<keyId>.ed25519.pkcs8.b64",
    defaultLocation.keyPath === join(WIN_ROOT, "issuer-keys", `key2${ISSUER_KEY_FILE_SUFFIX}`),
    defaultLocation.keyPath
  );
  check("the default location reports its source", defaultLocation.source === "default-location");
  check("the default location has no problem", defaultLocation.problem === undefined);
  check(
    "the key directory is the folder the issuance history lives in",
    defaultLocation.keyDirectory === join(WIN_ROOT, "issuer-keys"),
    defaultLocation.keyDirectory
  );
  check(
    "the output folder comes from the same runtime root",
    defaultLocation.outputDirectory === join(WIN_ROOT, "issuer-output"),
    String(defaultLocation.outputDirectory)
  );
  check(
    "the display path redacts the account name behind %LOCALAPPDATA%",
    defaultLocation.displayPath.startsWith("%LOCALAPPDATA%") && !defaultLocation.displayPath.includes("operator"),
    defaultLocation.displayPath
  );

  // Every front end must land on the same file for the same environment. This is the whole reason
  // the module exists: a dashboard that reports ready against a key the app would never open.
  const asElectron = resolveIssuerKeyLocation({ runtimeRoot: WIN_ROOT, keyId: "key2", env: cleanEnv });
  const asNode = resolveIssuerKeyLocation({
    runtimeRoot: nonElectronRuntimeRoot(cleanEnv),
    keyId: "key2",
    env: cleanEnv
  });
  check(
    "the Electron root and the plain-Node root resolve to the identical key file",
    asElectron.keyPath === asNode.keyPath && asNode.keyPath.length > 0,
    `${asElectron.keyPath} vs ${asNode.keyPath}`
  );

  const overridePath = join("D:", HOSTILE_DIR_NAME, `key2${ISSUER_KEY_FILE_SUFFIX}`);
  const overridden = resolveIssuerKeyLocation({
    runtimeRoot: WIN_ROOT,
    keyId: "key2",
    env: { ...cleanEnv, [ISSUER_KEY_PATH_ENV]: overridePath }
  });
  check("an absolute SPECTER_ISSUER_KEY override wins", overridden.keyPath === overridePath, overridden.keyPath);
  check("the override reports its source", overridden.source === "environment-override");
  check(
    "a key path with spaces and shell metacharacters survives verbatim",
    overridden.keyPath.includes(" ") &&
      overridden.keyPath.includes("&") &&
      overridden.keyPath.includes("(") &&
      overridden.keyPath.includes("%") &&
      !overridden.keyPath.includes('"'),
    overridden.keyPath
  );
  check(
    "the override's key directory is its parent, not a rewritten tail",
    overridden.keyDirectory === join("D:", HOSTILE_DIR_NAME).replace(/[\\/]+$/, ""),
    overridden.keyDirectory
  );

  const relativeOverride = resolveIssuerKeyLocation({
    runtimeRoot: WIN_ROOT,
    env: { ...cleanEnv, [ISSUER_KEY_PATH_ENV]: join("keys", "key2.b64") }
  });
  check(
    "a RELATIVE SPECTER_ISSUER_KEY is refused rather than resolved against a cwd",
    relativeOverride.problem === "KEY_PATH_RELATIVE" && relativeOverride.keyPath === "",
    String(relativeOverride.problem)
  );

  const noProfile = resolveIssuerKeyLocation({ runtimeRoot: nonElectronRuntimeRoot({}), env: {} });
  check(
    "with no profile variable the resolver refuses instead of guessing",
    noProfile.problem === "RUNTIME_ROOT_UNRESOLVED" && noProfile.keyPath === "",
    String(noProfile.problem)
  );
  check("nonElectronRuntimeRoot returns null rather than a cwd-relative root", nonElectronRuntimeRoot({}) === null);
  check(
    "a relative profile variable is not accepted as a runtime root either",
    nonElectronRuntimeRoot({ LOCALAPPDATA: "relative/appdata" }) === null
  );

  for (const badKeyId of ["", "..", "../evil", "a/b", "a\\b", "a".repeat(65)]) {
    check(
      `a key id that is not a plain file-name segment is refused (${JSON.stringify(badKeyId)})`,
      resolveIssuerKeyLocation({ runtimeRoot: WIN_ROOT, keyId: badKeyId, env: cleanEnv }).problem === "KEY_ID_INVALID"
    );
  }

  // No current-working-directory dependency: the answer must be byte-identical from two cwds.
  const originalCwd = process.cwd();
  const cwdA = mkdtempSync(join(tmpdir(), "awkit-cwd-a-"));
  const cwdB = mkdtempSync(join(tmpdir(), "awkit-cwd-b-"));
  try {
    process.chdir(cwdA);
    const fromA = resolveIssuerKeyLocation({ runtimeRoot: WIN_ROOT, keyId: "key2", env: cleanEnv });
    const rootFromA = nonElectronRuntimeRoot(cleanEnv);
    process.chdir(cwdB);
    const fromB = resolveIssuerKeyLocation({ runtimeRoot: WIN_ROOT, keyId: "key2", env: cleanEnv });
    const rootFromB = nonElectronRuntimeRoot(cleanEnv);
    check("the resolved key path does not depend on the working directory", fromA.keyPath === fromB.keyPath);
    check("the runtime root does not depend on the working directory", rootFromA === rootFromB);
    check(
      "no resolved path is ever relative to a working directory",
      isAbsolute(fromA.keyPath) && !fromA.keyPath.startsWith(cwdA) && !fromB.keyPath.startsWith(cwdB)
    );
  } finally {
    process.chdir(originalCwd);
    rmSync(cwdA, { recursive: true, force: true });
    rmSync(cwdB, { recursive: true, force: true });
  }

  // ══ 2. Readiness states ═════════════════════════════════════════════════════════════════════
  console.log("\nReadiness states:");

  const keyDirectory = join(sandbox, "keys");
  const goodKeyPath = join(keyDirectory, `${KEY_ID}${ISSUER_KEY_FILE_SUFFIX}`);
  mkdirSync(keyDirectory, { recursive: true });
  writeFileSync(goodKeyPath, PRIVATE_B64, "utf8");

  const ready = await service().readiness();
  check("a valid authorized key reports READY", ready.state === "READY" && ready.ready === true, JSON.stringify(ready));
  check("READY names the configured key id", ready.keyId === KEY_ID);
  check("READY carries no reason code", ready.reason === undefined);
  check("readiness reports where the key came from", ready.keySource === "default-location");

  const missing = await service({ keyPath: join(keyDirectory, `absent${ISSUER_KEY_FILE_SUFFIX}`) }).readiness();
  check(
    "a missing key reports MISSING / ISSUER_KEY_MISSING",
    missing.state === "MISSING" && missing.reason === "ISSUER_KEY_MISSING" && missing.ready === false,
    JSON.stringify(missing)
  );
  check(
    "a missing key is never created to make the issuer ready",
    !existsSync(join(keyDirectory, `absent${ISSUER_KEY_FILE_SUFFIX}`))
  );

  const asDirectory = join(sandbox, "key-as-directory");
  mkdirSync(asDirectory, { recursive: true });
  const inaccessible = await service({ keyPath: asDirectory }).readiness();
  check(
    "a key path that cannot be opened reports INACCESSIBLE, not MISSING",
    inaccessible.state === "INACCESSIBLE" && inaccessible.reason === "ISSUER_KEY_INACCESSIBLE",
    JSON.stringify(inaccessible)
  );
  // The whole classification table, because a denied ACL is not portably creatable in a gate.
  check("ENOENT classifies as missing", classifyKeyReadError("ENOENT") === "ISSUER_KEY_MISSING");
  check("EACCES classifies as inaccessible", classifyKeyReadError("EACCES") === "ISSUER_KEY_INACCESSIBLE");
  check("EPERM classifies as inaccessible", classifyKeyReadError("EPERM") === "ISSUER_KEY_INACCESSIBLE");
  check("EISDIR classifies as inaccessible", classifyKeyReadError("EISDIR") === "ISSUER_KEY_INACCESSIBLE");
  check("EBUSY classifies as inaccessible", classifyKeyReadError("EBUSY") === "ISSUER_KEY_INACCESSIBLE");
  check("an unrecognised code falls back to invalid, never to ready", classifyKeyReadError("EWHATEVER") === "ISSUER_KEY_INVALID");

  const malformedPath = join(keyDirectory, `malformed${ISSUER_KEY_FILE_SUFFIX}`);
  writeFileSync(malformedPath, "this is not a pkcs8 ed25519 private key", "utf8");
  const malformed = await service({ keyPath: malformedPath }).readiness();
  check(
    "a malformed key reports INVALID_FORMAT",
    malformed.state === "INVALID_FORMAT" && malformed.reason === "ISSUER_KEY_INVALID",
    JSON.stringify(malformed)
  );

  const emptyPath = join(keyDirectory, `empty${ISSUER_KEY_FILE_SUFFIX}`);
  writeFileSync(emptyPath, "   \n", "utf8");
  const empty = await service({ keyPath: emptyPath }).readiness();
  check("an empty key file reports INVALID_FORMAT", empty.state === "INVALID_FORMAT" && empty.reason === "ISSUER_KEY_INVALID");

  const wrongId = await service({ keyId: "no-such-key-id" }).readiness();
  check(
    "a key id this build does not trust reports CONFIGURATION_ERROR / ISSUER_KEY_UNKNOWN_ID",
    wrongId.state === "CONFIGURATION_ERROR" && wrongId.reason === "ISSUER_KEY_UNKNOWN_ID",
    JSON.stringify(wrongId)
  );
  check("the unknown key id is echoed back so the operator can see what was configured", wrongId.keyId === "no-such-key-id");

  const retired = await service({ keyId: "retiredkey" }).readiness();
  check(
    "a retired key id refuses to sign",
    retired.state === "CONFIGURATION_ERROR" && retired.reason === "ISSUER_KEY_RETIRED",
    JSON.stringify(retired)
  );

  const { privateKey: strangerKey } = generateKeyPairSync("ed25519");
  const strangerPath = join(keyDirectory, `stranger${ISSUER_KEY_FILE_SUFFIX}`);
  writeFileSync(strangerPath, strangerKey.export({ format: "der", type: "pkcs8" }).toString("base64"), "utf8");
  const mismatch = await service({ keyPath: strangerPath }).readiness();
  check(
    "a well-formed key that is not the trusted one reports CONFIGURATION_ERROR / ISSUER_KEY_MISMATCH",
    mismatch.state === "CONFIGURATION_ERROR" && mismatch.reason === "ISSUER_KEY_MISMATCH",
    JSON.stringify(mismatch)
  );

  const relativeKey = await service({ keyPath: join("keys", `${KEY_ID}${ISSUER_KEY_FILE_SUFFIX}`) }).readiness();
  check(
    "a relative key path is refused before any filesystem contact",
    relativeKey.state === "CONFIGURATION_ERROR" && relativeKey.reason === "ISSUER_KEY_LOCATION_INVALID",
    JSON.stringify(relativeKey)
  );

  const brokenLocation = await service({ locationProblem: "RUNTIME_ROOT_UNRESOLVED" }).readiness();
  check(
    "a resolver problem surfaces as CONFIGURATION_ERROR even when a readable key sits at the path",
    brokenLocation.state === "CONFIGURATION_ERROR" && brokenLocation.reason === "ISSUER_KEY_LOCATION_INVALID",
    JSON.stringify(brokenLocation)
  );

  check(
    "every readiness state the contract names is reachable from a reason code",
    ISSUER_READINESS_STATES.every((state) =>
      state === "READY"
        ? issuerReadinessStateFor(undefined) === "READY"
        : [ready, missing, inaccessible, malformed, wrongId].some((r) => r.state === state)
    ),
    ISSUER_READINESS_STATES.join(",")
  );

  // ══ 3. The private key never crosses a boundary ═════════════════════════════════════════════
  console.log("\nKey confinement (renderer / IPC / reports):");

  const readinessJson = JSON.stringify(ready);
  check("a readiness payload never carries key material", !readinessJson.includes(PRIVATE_B64));
  check(
    "a readiness payload never carries a key path unless the surface opted in",
    ready.expectedKeyLocation === null && !readinessJson.includes(sandbox),
    readinessJson
  );

  const disclosed = await service({ keyLocationDisclosure: "%LOCALAPPDATA%\\SpecterStudio\\issuer-keys\\k.b64" }).readiness();
  check(
    "the opted-in surface gets a REDACTED location, so a MISSING key can be provisioned",
    disclosed.expectedKeyLocation === "%LOCALAPPDATA%\\SpecterStudio\\issuer-keys\\k.b64" &&
      !JSON.stringify(disclosed).includes(PRIVATE_B64)
  );

  const issued = await service().issue(issueInput());
  const issuedJson = JSON.stringify(issued);
  check("an issuance result never carries key material", !issuedJson.includes(PRIVATE_B64));
  check("an issuance result never carries the key path", !issuedJson.includes(goodKeyPath) && !issuedJson.includes("issuer-keys"));
  const issuedDocumentJson = readFileSync(issued.outputPath, "utf8");
  check("the signed .dat never carries key material", !issuedDocumentJson.includes(PRIVATE_B64));
  const historyJson = readFileSync(join(keyDirectory, "issuance-history.jsonl"), "utf8");
  check("the issuance history never carries key material", !historyJson.includes(PRIVATE_B64));

  const source = (...segments: string[]): string => readFileSync(join(REPO_ROOT, ...segments), "utf8");
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

  const ipcCode = stripComments(source("app", "main", "ipc", "issuer.ipc.ts"));
  check(
    "the issuer IPC never reads a key or handles key material itself",
    !ipcCode.includes("readFile") && !ipcCode.includes("createPrivateKey") && !ipcCode.includes("pkcs8"),
    "signing belongs to LicenseIssuerService, behind the trusted composition root"
  );
  const preloadCode = stripComments(source("app", "main", "preload.ts"));
  check(
    "the preload bridge exposes no key surface at all",
    !preloadCode.includes("pkcs8") && !preloadCode.includes("SPECTER_ISSUER_KEY") && !preloadCode.includes("privateKey")
  );
  const pageCode = stripComments(source("app", "renderer", "pages", "admin", "LicenseIssuerPage.tsx"));
  check(
    "the renderer page never touches a key, a key path, or the filesystem",
    !pageCode.includes("pkcs8") &&
      !pageCode.includes("privateKey") &&
      !pageCode.includes("issuer-keys") &&
      !pageCode.includes("readFile"),
    "the renderer only renders what readiness told it"
  );
  check(
    "the renderer shows the expected provisioning location so a MISSING key is actionable",
    pageCode.includes("expectedKeyLocation")
  );
  check(
    "the renderer gates issuance on BOTH a loaded request and a READY key",
    pageCode.includes("!readiness?.ready") && pageCode.includes("!activationRequest"),
    "either one alone must not enable signing"
  );
  // Slice the request-loading handler out by its own top-level declaration boundaries, rather than
  // with a length-bounded regex that silently stops matching when the function grows.
  const handlerStart = pageCode.indexOf("const onRequestFile");
  const handlerEnd = pageCode.indexOf("\n  const ", handlerStart + 1);
  const requestHandler = handlerStart >= 0 ? pageCode.slice(handlerStart, handlerEnd > 0 ? handlerEnd : undefined) : "";
  check(
    "the renderer does not gate LOADING an activation request on the signing key",
    requestHandler.length > 0 && requestHandler.includes("setActivationRequest") && !requestHandler.includes("readiness"),
    "reviewing which machine a request came from must work before a key is provisioned"
  );

  // ══ 4. A missing key blocks issuance, and writes nothing ════════════════════════════════════
  console.log("\nIssuance requires a READY key:");

  const blockedOutput = join(sandbox, "blocked-output");
  mkdirSync(blockedOutput, { recursive: true });
  let blockedReason: string | null = null;
  try {
    await service({ keyPath: join(keyDirectory, `absent${ISSUER_KEY_FILE_SUFFIX}`), outputDirectory: blockedOutput }).issue(issueInput());
  } catch (error) {
    blockedReason = error instanceof LicenseIssuerError ? error.reason : "UNEXPECTED";
  }
  check("issuance with a missing key is refused", blockedReason === "ISSUER_KEY_MISSING", String(blockedReason));
  check("a refused issuance writes no license", readdirSync(blockedOutput).length === 0, readdirSync(blockedOutput).join(","));

  let unknownIdReason: string | null = null;
  try {
    await service({ keyId: "no-such-key-id", outputDirectory: blockedOutput }).issue(issueInput());
  } catch (error) {
    unknownIdReason = error instanceof LicenseIssuerError ? error.reason : "UNEXPECTED";
  }
  check("issuance with an untrusted key id is refused", unknownIdReason === "ISSUER_KEY_UNKNOWN_ID", String(unknownIdReason));
  check("still no license after the untrusted-id refusal", readdirSync(blockedOutput).length === 0);

  // ══ 5. Hostile key path, end to end, through the real CLI with no shell ═════════════════════
  console.log("\nArgv-only invocation with a hostile key path:");

  const hostileKeyDir = join(sandbox, HOSTILE_DIR_NAME);
  const hostileKeyPath = join(hostileKeyDir, `${DEFAULT_ISSUER_KEY_ID}${ISSUER_KEY_FILE_SUFFIX}`);
  const hostileOutDir = join(sandbox, "out with spaces & (parens)");
  mkdirSync(hostileKeyDir, { recursive: true });
  mkdirSync(hostileOutDir, { recursive: true });
  writeFileSync(hostileKeyPath, PRIVATE_B64, "utf8");

  const hostileService = service({ keyPath: hostileKeyPath, outputDirectory: hostileOutDir });
  const hostileReadiness = await hostileService.readiness();
  check(
    "a key in a folder with spaces and metacharacters reports READY",
    hostileReadiness.state === "READY",
    JSON.stringify(hostileReadiness)
  );
  const hostileIssued = await hostileService.issue(issueInput());
  check("issuance writes into a folder whose name has spaces and parentheses", existsSync(hostileIssued.outputPath));
  check(
    "the issuance history lands beside the key, in the hostile folder",
    existsSync(join(hostileKeyDir, "issuance-history.jsonl"))
  );

  // The real CLI, spawned exactly as the packaged gate spawns it: process.execPath + fixed argv,
  // no `shell`. If anything joined argv into a command line, `&` would terminate the command and
  // `%PATH%` would expand — so a signed licence appearing at all is the evidence.
  const cliRequestPath = join(hostileKeyDir, "activation request.json");
  writeFileSync(cliRequestPath, JSON.stringify(activationRequest()), "utf8");
  const cliOutDir = join(sandbox, "cli out & (dir)");
  mkdirSync(cliOutDir, { recursive: true });
  let cliSpawnDetail = "";
  let cliSigned = false;
  try {
    await execFileAsync(
      process.execPath,
      [
        join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
        join(REPO_ROOT, "tools", "license-issuer", "issue-license.mts"),
        "--request",
        cliRequestPath,
        "--key",
        hostileKeyPath,
        "--keyId",
        DEFAULT_ISSUER_KEY_ID,
        "--type",
        "standard",
        "--entitlements",
        "workflow.execute",
        "--days",
        "30",
        "--out-dir",
        cliOutDir
      ],
      { cwd: REPO_ROOT, windowsHide: true }
    );
    // The production key id is used on purpose: this asserts the ARGV path, and the CLI legitimately
    // refuses to sign because the ephemeral key is not the trusted `key2`. Either outcome proves the
    // arguments arrived intact — a shell would have failed differently, before the issuer ran.
    cliSigned = readdirSync(cliOutDir).some((name) => name.endsWith(".dat"));
  } catch (error) {
    cliSpawnDetail = String((error as { stderr?: string }).stderr ?? error).slice(0, 300);
  }
  check(
    "the CLI received a space-and-metacharacter key path as ONE argument",
    cliSigned || cliSpawnDetail.includes("ISSUER_KEY_MISMATCH"),
    cliSpawnDetail || "no .dat and no mismatch refusal"
  );
  check(
    "nothing was interpreted by a shell (no command-not-found, no %PATH% expansion)",
    !/is not recognized|command not found|ENOENT/i.test(cliSpawnDetail),
    cliSpawnDetail
  );

  const noShell = (...segments: string[]): boolean => !/shell:\s*true/.test(source(...segments));
  check("the packaged-license helper spawns the issuer without a shell", noShell("scripts", "helpers", "packaged-license.mts"));
  check("the packaged-license helper spawns process.execPath with fixed argv",
    source("scripts", "helpers", "packaged-license.mts").includes("execFileAsync(\n    process.execPath,"));
  check("the dashboard bridge caller spawns the issuer without a shell", noShell("tools", "roadmap", "lib", "license-issuer.mjs"));
  check(
    "the packaged-license helper refuses a relative configured key path",
    source("scripts", "helpers", "packaged-license.mts").includes("isAbsolute(configured)")
  );

  // ══ 6. A licence signed this way validates through production licensing ═════════════════════
  console.log("\nSigned licence through the production validator and store:");

  const document = JSON.parse(readFileSync(issued.outputPath, "utf8")) as LicenseDocument;
  check("the signature verifies against the trusted public key", verifyLicenseSignature(document, KEYS).ok);
  check("the licence is bound to the requesting machine", document.machineFingerprintHash === FINGERPRINT_A);
  check("the licence names the signing key id", document.signingKeyId === KEY_ID);
  const nowMs = Date.parse(document.validFromUtc) + 60_000;
  const verdict = validateLicense({
    license: document,
    currentFingerprintHash: FINGERPRINT_A,
    nowMs,
    trustedKeys: KEYS
  });
  check("the production validator accepts it on this machine", verdict.operable, verdict.status);
  check(
    "it reports MACHINE_MISMATCH on a different fingerprint",
    validateLicense({ license: document, currentFingerprintHash: FINGERPRINT_B, nowMs, trustedKeys: KEYS }).status ===
      LicenseStatus.MACHINE_MISMATCH
  );
  check(
    "a tampered entitlement breaks the signature rather than granting anything",
    validateLicense({
      license: { ...document, entitlements: [...document.entitlements, "workflow.scheduled"] },
      currentFingerprintHash: FINGERPRINT_A,
      nowMs,
      trustedKeys: KEYS
    }).status === LicenseStatus.INVALID_SIGNATURE
  );
  check(
    "the entitlements it was issued with are the ones it carries",
    document.entitlements.join(",") === "workflow.execute,workflow.concurrent,automation.browser",
    document.entitlements.join(",")
  );

  // A THROWAWAY profile root: the installation's own %LOCALAPPDATA%\SpecterStudio\Licensing is
  // deliberately never touched, so running this gate cannot install a licence anywhere real.
  const storeRoot = join(sandbox, "profile");
  mkdirSync(storeRoot, { recursive: true });
  const licenseService = new LicenseService({
    store: new LicenseStore(storeRoot, null),
    product: LICENSING_PRODUCT,
    appVersion: "0.1.20",
    fingerprintProvider: () => ({
      algorithmVersion: 1,
      fingerprintHash: FINGERPRINT_A,
      availableSignals: ["machineGuid"],
      confidenceLevel: "high",
      generatedAtUtc: "2026-08-19T09:00:00.000Z"
    }),
    trustedKeys: KEYS,
    now: () => nowMs
  });
  const imported = licenseService.importLicense(document);
  check("the signed .dat imports through the production LicenseService", imported.ok, imported.rejectedReason ?? imported.status.status);
  const reread = licenseService.getStatus();
  check("re-read from disk it is still operable", reread.operable, reread.status);
  check(
    "the entitlements survive the round trip through the store",
    (reread.entitlements ?? []).join(",") === document.entitlements.join(","),
    (reread.entitlements ?? []).join(",")
  );
  const storedFiles = readdirSync(storeRoot);
  check(
    "the stored envelope never contains key material",
    storedFiles.length > 0 &&
      storedFiles.every((name) => !readFileSync(join(storeRoot, name), "utf8").includes(PRIVATE_B64)),
    storedFiles.join(",")
  );
} finally {
  rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

console.log(`\nIssuer key resolution: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
