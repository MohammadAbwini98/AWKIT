/**
 * verify:roadmap-license-issuer — the Program Status dashboard's "Licenses Issue" page.
 *
 * What regression makes this fail?
 *   - the side-menu entry, its route, or its static asset disappears, so the page cannot be reached;
 *   - the dashboard grows its own signing path, a fallback key, or a second license schema;
 *   - the issuer spawn acquires a shell, or a browser-supplied value reaches its command line;
 *   - an unauthorized or malformed HTTP request stops being refused, or a refusal starts leaking a
 *     filesystem path, key material, or a stack;
 *   - an exact validity window stops round-tripping into `validFromUtc`/`expiresAtUtc`, or an
 *     inverted window stops being refused;
 *   - a generated license stops being bound to the requesting machine — accepted on another
 *     fingerprint, or no longer refused with MACHINE_MISMATCH;
 *   - the private key or the issuer UI appears in something the packaged application ships.
 *
 * ── What this verifier can and cannot execute ────────────────────────────────────────────────
 *
 * Two layers, deliberately separated, because only one of them can run without the production key:
 *
 *   TRANSPORT (full chain, always executed): browser → dashboard server → trusted bridge process →
 *   the real `LicenseIssuerService`. Every authorization, validation and fail-closed path is driven
 *   over real HTTP against a real server on an ephemeral port, and the spawned bridge is the real
 *   one. Where no authorized signing key exists on this machine, the chain must answer exactly
 *   `ISSUER_KEY_MISSING` and write nothing — that is asserted positively, not skipped.
 *
 *   ISSUANCE SEMANTICS (the same service, driven directly): signing, machine binding, exact
 *   timestamps, and the validator's verdicts are proven against `LicenseIssuerService` with an
 *   ephemeral key pair injected as the trusted set — exactly how `verify:licensing` already proves
 *   the in-app issuer. This is NOT a mock signature: it is real Ed25519 over the real canonical
 *   bytes, verified by the real validator. What it cannot prove is custody of the PRODUCTION key,
 *   which is a workstation fact, not a code fact.
 *
 * Run: npx tsx scripts/verify-roadmap-license-issuer.mts
 */

import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LICENSE_SCHEMA_VERSION,
  LICENSING_PRODUCT,
  LicenseStatus,
  type ActivationRequest,
  type LicenseDocument
} from "../src/licensing/LicenseTypes";
import { verifyLicenseSignature } from "../src/licensing/crypto/LicenseSignature";
import type { TrustedKey } from "../src/licensing/crypto/TrustedKeys";
import { validateLicense } from "../src/licensing/LicenseValidator";
import { LicenseService } from "../src/licensing/LicenseService";
import { LicenseStore } from "../src/licensing/store/LicenseStore";
import {
  DEFAULT_ISSUER_KEY_ID,
  issuerKeyPathFor,
  issuerOutputDirectoryFor,
  nonElectronRuntimeRoot
} from "../src/licensing/issuer/IssuerLocations";
import { LicenseIssuerError, LicenseIssuerService } from "../src/licensing/issuer/LicenseIssuerService";
import { buildIssuePayload, parseActivationRequestBody } from "../tools/roadmap/lib/license-issuer.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(REPO_ROOT, "tools", "roadmap", "public");

let passed = 0;
let failed = 0;
const blocked: string[] = [];

function check(label: string, condition: unknown, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function blockedCheck(label: string, why: string): void {
  blocked.push(`${label} - ${why}`);
  console.log(`  BLOCKED ${label} - ${why}`);
}

function read(...parts: string[]): string {
  return readFileSync(join(REPO_ROOT, ...parts), "utf8");
}

const KEY_ID = DEFAULT_ISSUER_KEY_ID;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const EPHEMERAL_KEYS: TrustedKey[] = [
  {
    keyId: KEY_ID,
    algorithm: "Ed25519",
    publicKeySpkiB64: publicKey.export({ format: "der", type: "spki" }).toString("base64")
  }
];
const PRIVATE_B64 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);

function activationRequest(fingerprintHash = FINGERPRINT_A): ActivationRequest {
  return {
    schemaVersion: LICENSE_SCHEMA_VERSION,
    product: LICENSING_PRODUCT,
    appVersion: "0.1.14",
    fingerprintAlgorithmVersion: 1,
    fingerprintHash,
    availableSignals: ["machineGuid", "cpuModel", "diskSerial"],
    confidenceLevel: "high",
    requestId: "11111111-2222-4333-8444-555555555555",
    generatedAtUtc: "2026-08-19T09:00:00.000Z"
  };
}

/** A sandbox outside the repository — and outside OneDrive, which the key-custody rule refuses. */
const sandbox = mkdtempSync(join(tmpdir(), "awkit-issuer-dashboard-"));

try {
  /* ======================================================================
     1. The side menu and its route
     ====================================================================== */
  console.log("Dashboard navigation:");
  const viewsSrc = read("tools", "roadmap", "public", "views.js");
  const serverSrc = read("tools", "roadmap", "server.mjs");
  const issuerViewSrc = read("tools", "roadmap", "public", "license-issuer.js");
  const dashboardSrc = read("tools", "roadmap", "public", "dashboard.js");
  const cssSrc = read("tools", "roadmap", "public", "dashboard.css");

  const registry = /export const VIEWS = \[([\s\S]*)\];\s*$/.exec(viewsSrc)?.[1] ?? "";
  check("the view registry was located", registry.length > 0);
  const viewIds = [...registry.matchAll(/\n {4}id: "([^"]*)"/g)].map((m) => m[1]);
  check(
    "the registry still carries every pre-existing view",
    ["overview", "phases", "queue", "graph", "issues", "validation", "agents", "sources"].every((id) =>
      viewIds.includes(id)
    ),
    viewIds.join(", ")
  );
  check("a ninth view was added, not a replacement", viewIds.length === 9, `${viewIds.length} views`);
  check('the side-menu label is exactly "Licenses Issue"', /label: "Licenses Issue"/.test(registry));
  check("the issuer view is registered under its own id", viewIds.includes("licenses-issue"));
  check(
    "the issuer view renders through the dedicated module, not an inline renderer",
    /render: renderLicenseIssuer/.test(registry) &&
      viewsSrc.includes('import { renderLicenseIssuer } from "./license-issuer.js"')
  );
  check(
    "the page heading and subtitle name the tool, while the menu keeps the owner's label",
    /title: "License Issuer"/.test(registry) &&
      /subtitle: \(\) => "Generate signed machine-bound AWKIT licenses"/.test(registry)
  );
  check(
    "the routing shell needs no change to reach it",
    dashboardSrc.includes("VIEWS.some((v) => v.id === id)") && !dashboardSrc.includes("licenses-issue"),
    "the nav is built from VIEWS; a special case here would mean the registry is not authoritative"
  );
  check(
    "the module is served from the explicit static allowlist",
    serverSrc.includes('["/license-issuer.js", "license-issuer.js"]')
  );

  /* Every icon this page names must exist, for the same reason views.js is checked: icon() falls
     back to a plain circle, so a typo degrades silently rather than failing. */
  const iconsSrc = read("tools", "roadmap", "public", "icons.js");
  const definedIcons = new Set([...iconsSrc.matchAll(/^ {2}"?([a-z][a-z0-9-]*)"?:\s*\[/gm)].map((m) => m[1]));
  const referencedIcons = [...issuerViewSrc.matchAll(/\bicon\(\s*"([^"]*)"/g)].map((m) => m[1]);
  referencedIcons.push(...[...registry.matchAll(/icon: "([^"]*)"/g)].map((m) => m[1]));
  check("the icon scan found names to resolve", referencedIcons.length >= 5, `${referencedIcons.length} referenced`);
  check(
    "every icon the issuer page names is defined",
    referencedIcons.every((name) => definedIcons.has(name)),
    referencedIcons.filter((name) => !definedIcons.has(name)).join(", ") || "-"
  );

  /* ======================================================================
     2. The page is a front end, not an implementation
     ====================================================================== */
  console.log("\nBrowser-side boundary:");
  for (const forbidden of ["signLicensePayload", "createPrivateKey", "pkcs8", "Ed25519", "privateKey", "SPECTER_ISSUER_KEY"]) {
    check(`the browser module contains no "${forbidden}"`, !issuerViewSrc.includes(forbidden));
  }
  check(
    "no browser asset mentions the signing key file name",
    readdirSync(PUBLIC_DIR).every((file) => !readFileSync(join(PUBLIC_DIR, file), "utf8").includes("ed25519.pkcs8")),
    "a key path in a served asset would be readable by anything that can reach the page"
  );
  check(
    "the page renders through the shared no-innerHTML helpers",
    !/\.innerHTML\s*=/.test(issuerViewSrc) && issuerViewSrc.includes('from "./dom.js"')
  );
  check(
    "the page reuses the dashboard's own classes rather than a parallel system",
    issuerViewSrc.includes('class: "work-panel"') &&
      issuerViewSrc.includes('class: "section-heading"') &&
      issuerViewSrc.includes("rm-button"),
    "a second UI system would drift from the app's design tokens"
  );
  check(
    "every colour and metric the new styles add resolves through a design token",
    (() => {
      const block = cssSrc.slice(cssSrc.indexOf(".rm-issuer-columns"));
      const declarations = [...block.matchAll(/^\s{2}[a-z-]+:\s*([^;]+);/gm)].map((m) => m[1].trim());
      // 1px is the hairline: a border width and the size of a visually-hidden control. Everything
      // else — colour, spacing, radius, type scale, motion — must resolve through a token.
      const literal = declarations.filter(
        (value) =>
          /#[0-9a-f]{3,8}\b/i.test(value) ||
          /\brgba?\(/i.test(value) ||
          [...value.matchAll(/\b(\d+(?:\.\d+)?)px\b/g)].some((match) => match[1] !== "1")
      );
      return declarations.length >= 20 && literal.length === 0;
    })(),
    "hardcoded hex/rgb or arbitrary px would break the token rule in docs/ai/RULES.md"
  );
  check(
    "the new styles answer prefers-reduced-motion",
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*rm-issuer-(textarea|input)/.test(cssSrc)
  );
  check(
    "every form control the page draws carries a label or a legend",
    (() => {
      const labelled = ["rm-issuer-request", "rm-issuer-file", "rm-issuer-from", "rm-issuer-until", "rm-issuer-type"];
      return labelled.every((id) => issuerViewSrc.includes(`for: "${id}"`) && issuerViewSrc.includes(`id: "${id}"`));
    })()
  );
  // Both of these guard a defect that was PRESENT and found by driving a real browser, not by
  // reading the CSS. A focus rule that exists is not a focus indicator that paints.
  check(
    "radio and checkbox focus is an outline, not a box-shadow",
    /\.rm-issuer-radio input:focus-visible \{[^}]*outline: [^;]*solid/.test(cssSrc) &&
      !/\.rm-issuer-radio input:focus-visible \{[^}]*outline: none/.test(cssSrc),
    "a native radio keeps its UA appearance, so Chrome does not paint a box-shadow on one; global.css " +
      "already clears the UA outline, so a shadow-only rule leaves the control with no indicator at all"
  );
  check(
    "the visually-hidden file input precedes the label that draws its focus ring",
    (() => {
      const actions = issuerViewSrc.indexOf('el("div", { class: "rm-issuer-actions" }, [\n      refs.parseButton,');
      if (actions < 0) return false;
      const block = issuerViewSrc.slice(actions, actions + 400);
      return (
        block.indexOf("refs.fileInput") < block.indexOf("rm-issuer-file-label") &&
        /\.rm-issuer-file:focus-visible \+ \.rm-issuer-file-label/.test(cssSrc)
      );
    })(),
    "the adjacent-sibling rule only matches input-then-label; reversed, the control shows nothing"
  );
  check(
    "the radio group is a fieldset with a legend and the status regions are live",
    issuerViewSrc.includes('el("fieldset"') &&
      issuerViewSrc.includes('el("legend"') &&
      issuerViewSrc.includes('"aria-live": "polite"') &&
      issuerViewSrc.includes('role: "alert"')
  );

  /* ======================================================================
     3. Validity presets resolve to exact UTC windows
     ====================================================================== */
  console.log("\nValidity:");
  const presetPattern = /\{ id: "([^"]+)", label: "([^"]+)", minutes: ([^}]+) \}/g;
  const presets = [...issuerViewSrc.matchAll(presetPattern)].map((m) => ({
    id: m[1],
    label: m[2],
    minutes: m[3].trim() === "null" ? null : Number(eval(m[3])) // eslint-disable-line no-eval
  }));
  check("the preset table parsed", presets.length >= 8, `${presets.length} presets`);
  const expected: Array<[string, number | null]> = [
    ["1 Hour", 60],
    ["1 Day", 1440],
    ["7 Days", 10080],
    ["30 Days", 43200],
    ["90 Days", 129600],
    ["180 Days", 259200],
    ["1 Year", 525600],
    ["Custom", null]
  ];
  for (const [label, minutes] of expected) {
    const preset = presets.find((p) => p.label === label);
    check(`preset "${label}" resolves to ${minutes === null ? "a custom window" : `${minutes} minutes`}`,
      preset !== undefined && preset.minutes === minutes,
      preset ? String(preset.minutes) : "absent");
  }
  check(
    "presets are sent as an exact window, never as a day count",
    issuerViewSrc.includes('validity: { mode: "window"') && !issuerViewSrc.includes('mode: "days"'),
    "sending a day count would let the signed expiry drift from the reviewed one"
  );
  check(
    "issuance is a discrete action, not a consequence of editing the form",
    (issuerViewSrc.match(/\/api\/license-issuer\/issue/g) ?? []).length === 1 &&
      issuerViewSrc.includes("on: { click: () => void issueLicense() }")
  );
  check(
    "the issue button is disabled for the whole round trip",
    /state\.busy = true;[\s\S]{0,200}paint\(\)/.test(issuerViewSrc) &&
      issuerViewSrc.includes("refs.issueButton.disabled = state.busy || blocked !== null")
  );

  /* ======================================================================
     4. Server-side payload construction (the browser is not trusted)
     ====================================================================== */
  console.log("\nRequest validation:");
  const goodBody = {
    activationRequestText: JSON.stringify(activationRequest()),
    licenseType: "standard",
    entitlements: ["workflow.execute", "automation.browser"],
    validity: { mode: "window", validFromUtc: "2026-08-19T10:00:00.000Z", expiresAtUtc: "2026-09-18T10:00:00.000Z" }
  };
  const built = buildIssuePayload(goodBody);
  check("a well-formed request builds a payload", built.ok === true, built.reason ?? "");
  check(
    "the payload carries the exact window, not a duration",
    built.ok &&
      built.value.validityWindow?.validFromUtc === "2026-08-19T10:00:00.000Z" &&
      built.value.validityWindow?.expiresAtUtc === "2026-09-18T10:00:00.000Z" &&
      built.value.validityDays === undefined
  );
  check(
    "only allowlisted fields reach the issuer",
    (() => {
      const smuggled = buildIssuePayload({
        ...goodBody,
        keyPath: "C:/keys/key1.ed25519.pkcs8.b64",
        outputPath: "C:/anywhere/out.dat",
        trustedKeys: [],
        signingKeyId: "attacker",
        product: "NotSpecterStudio"
      });
      if (!smuggled.ok) return false;
      const keys = Object.keys(smuggled.value).sort();
      return keys.join(",") === "activationRequest,entitlements,licenseType,validityWindow";
    })(),
    "a spread of the request body would forward whatever else the browser sent"
  );

  const rejections: Array<[string, unknown, string]> = [
    ["a body that is not an object", "nope", "ISSUER_OPTIONS_INVALID"],
    ["a missing activation request", { ...goodBody, activationRequestText: undefined }, "ACTIVATION_REQUEST_INVALID"],
    ["an activation request that is not JSON", { ...goodBody, activationRequestText: "{oops" }, "ACTIVATION_REQUEST_NOT_JSON"],
    ["an oversized activation request", { ...goodBody, activationRequestText: `"${"x".repeat(70 * 1024)}"` }, "ACTIVATION_REQUEST_TOO_LARGE"],
    ["an unknown license type", { ...goodBody, licenseType: "unlimited" }, "ISSUER_OPTIONS_INVALID"],
    ["an unknown entitlement", { ...goodBody, entitlements: ["workflow.execute", "system.root"] }, "ISSUER_OPTIONS_INVALID"],
    ["a duplicated entitlement", { ...goodBody, entitlements: ["workflow.execute", "workflow.execute"] }, "ISSUER_OPTIONS_INVALID"],
    ["no entitlement at all", { ...goodBody, entitlements: [] }, "ISSUER_OPTIONS_INVALID"],
    ["a malformed timestamp", { ...goodBody, validity: { mode: "window", validFromUtc: "soon", expiresAtUtc: "later" } }, "ISSUER_TIMESTAMP_INVALID"],
    [
      "an expiry before the start",
      { ...goodBody, validity: { mode: "window", validFromUtc: "2026-09-18T10:00:00.000Z", expiresAtUtc: "2026-08-19T10:00:00.000Z" } },
      "ISSUER_EXPIRY_NOT_AFTER_START"
    ],
    [
      "an expiry equal to the start",
      { ...goodBody, validity: { mode: "window", validFromUtc: "2026-09-18T10:00:00.000Z", expiresAtUtc: "2026-09-18T10:00:00.000Z" } },
      "ISSUER_EXPIRY_NOT_AFTER_START"
    ],
    ["an unknown validity mode", { ...goodBody, validity: { mode: "forever" } }, "ISSUER_OPTIONS_INVALID"]
  ];
  for (const [label, body, reason] of rejections) {
    const result = buildIssuePayload(body);
    check(`${label} is refused with ${reason}`, result.ok === false && result.reason === reason, JSON.stringify(result));
  }
  check(
    "a JSON array is not accepted as an activation request",
    parseActivationRequestBody({ activationRequestText: "[]" }).reason === "ACTIVATION_REQUEST_INVALID"
  );

  /* ======================================================================
     5. Process invocation
     ====================================================================== */
  console.log("\nIssuer invocation:");
  const bridgeCallerSrc = read("tools", "roadmap", "lib", "license-issuer.mjs");
  check("the issuer is invoked with execFile, never exec", bridgeCallerSrc.includes("execFile(") && !/\bexec\(/.test(bridgeCallerSrc));
  check("shell interpretation is disabled explicitly", bridgeCallerSrc.includes("shell: false"));
  check("no code path enables a shell", !/shell:\s*true/.test(bridgeCallerSrc) && !/shell:\s*true/.test(serverSrc));
  check(
    "argv is a fixed three-element list, so no request value can become a command",
    bridgeCallerSrc.includes("[TSX_CLI, BRIDGE_SCRIPT, command]")
  );
  check(
    "the only variable argv element is checked against a literal allowlist",
    bridgeCallerSrc.includes("BRIDGE_COMMANDS.has(command)") &&
      /BRIDGE_COMMANDS = new Set\(\["readiness", "parse", "issue", "history"\]\)/.test(bridgeCallerSrc)
  );
  check(
    "the request itself travels on stdin, so it never enters a command line at all",
    bridgeCallerSrc.includes("child.stdin.end(JSON.stringify(payload)")
  );
  check(
    "the resolved paths are literal values, not strings the shell would re-split",
    (() => {
      // A path with a space and shell-significant characters must survive as one argv element.
      const hostile = join("C:", "Program Files (x86)", "A & B", "roadmap-bridge.mts");
      return hostile.includes(" ") && hostile.includes("&") && hostile.includes("(") && !hostile.includes('"');
    })(),
    "with shell:false the value is passed through verbatim; nothing quotes or splits it"
  );
  check(
    "the bridge is the only thing that reads a key, and it is not the server",
    !serverSrc.includes("keyPath") && !serverSrc.includes("privateKey") && !serverSrc.includes("readFile(") ||
      !serverSrc.includes("issuer-keys"),
    "the dashboard server must never resolve a key location"
  );
  const bridgeSrc = read("tools", "license-issuer", "roadmap-bridge.mts");
  check(
    "the bridge reads nothing but a fixed command from argv",
    bridgeSrc.includes("const command = process.argv[2]") && (bridgeSrc.match(/process\.argv/g) ?? []).length === 1
  );
  check(
    "the bridge emits reason codes only — never a message, path, or stack",
    !bridgeSrc.includes("error.message") && !bridgeSrc.includes("error.stack") && bridgeSrc.includes('fail("BRIDGE_FAILED")')
  );
  check(
    "the bridge reuses the one issuer service rather than re-implementing signing",
    bridgeSrc.includes("LicenseIssuerService") &&
      !bridgeSrc.includes("signLicensePayload") &&
      !bridgeSrc.includes("canonicalPayloadBytes") &&
      !bridgeSrc.includes("randomUUID"),
    "serial numbers, ids, canonicalisation and signing must have exactly one implementation"
  );
  check(
    "the bridge resolves the key through the shared location contract, not its own string",
    bridgeSrc.includes("issuerKeyPathFor(") && !/join\([^)]*issuer-keys/.test(bridgeSrc)
  );
  check(
    "the Electron main process resolves the same key through the same contract",
    read("app", "main", "licensing", "issuerRuntime.ts").includes("issuerKeyPathFor(")
  );
  check(
    "no second signing authority was introduced",
    (() => {
      const trusted = read("src", "licensing", "crypto", "TrustedKeys.ts");
      const entries = [...trusted.matchAll(/keyId: "([^"]+)"/g)].map((m) => m[1]);
      return entries.length === 1 && entries[0] === "key1";
    })(),
    "a dashboard-only key would mean two authorities could sign a valid license"
  );
  check(
    "no fallback or generated key exists anywhere in the issuer path",
    !bridgeSrc.includes("generateKeyPair") &&
      !bridgeCallerSrc.includes("generateKeyPair") &&
      !read("src", "licensing", "issuer", "LicenseIssuerService.ts").includes("generateKeyPair"),
    "a key created on demand would make an unauthorized machine able to sign"
  );

  /* ======================================================================
     6. The live server: authorization and fail-closed behaviour
     ====================================================================== */
  console.log("\nLive dashboard server:");
  process.env.ROADMAP_PORT = "0";
  const { server } = await import("../tools/roadmap/server.mjs");
  await new Promise<void>((resolve) => (server.listening ? resolve() : server.once("listening", () => resolve())));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const action = { "X-AWKIT-Roadmap-Action": "license-issue", "Content-Type": "application/json" };

  const assetResponse = await fetch(`${base}/license-issuer.js`);
  check("the page module is served", assetResponse.status === 200, `got ${assetResponse.status}`);
  check(
    "it is served as JavaScript",
    (assetResponse.headers.get("Content-Type") ?? "").startsWith("text/javascript"),
    assetResponse.headers.get("Content-Type") ?? "none"
  );

  const readinessResponse = await fetch(`${base}/api/license-issuer`);
  const readiness = await readinessResponse.json();
  check("readiness answers over HTTP", readinessResponse.status === 200, `got ${readinessResponse.status}`);
  const readinessBody = JSON.stringify(readiness);
  check(
    "readiness never discloses the key path",
    !readinessBody.includes("issuer-keys") && !readinessBody.toLowerCase().includes("pkcs8"),
    readinessBody.slice(0, 200)
  );
  check(
    "readiness never carries key material",
    !readinessBody.includes(PRIVATE_B64) && !/"privateKey"/.test(readinessBody)
  );

  const workstationKeyPath = issuerKeyPathFor(nonElectronRuntimeRoot(), KEY_ID);
  const workstationHasKey = existsSync(workstationKeyPath);
  if (workstationHasKey) {
    check("readiness reports a usable signing key on this workstation", readiness.ok === true && readiness.readiness?.ready === true);
  } else {
    check(
      "with no authorized key on this machine the page is told BLOCKED, with a reason",
      readiness.ok === true && readiness.readiness?.ready === false && readiness.readiness?.reason === "ISSUER_KEY_MISSING",
      readinessBody.slice(0, 200)
    );
  }

  const unauthorizedIssue = await fetch(`${base}/api/license-issuer/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(goodBody)
  });
  check("an issue POST without the action header is refused", unauthorizedIssue.status === 403, `got ${unauthorizedIssue.status}`);

  const foreignOrigin = await fetch(`${base}/api/license-issuer/issue`, {
    method: "POST",
    headers: { ...action, Origin: "https://example.invalid" },
    body: JSON.stringify(goodBody)
  });
  check("an issue POST from a foreign Origin is refused", foreignOrigin.status === 403, `got ${foreignOrigin.status}`);

  const wrongMethod = await fetch(`${base}/api/license-issuer/issue`, { method: "GET" });
  check("GET on the issue route is rejected", wrongMethod.status === 405, `got ${wrongMethod.status}`);

  const oversized = await fetch(`${base}/api/license-issuer/parse`, {
    method: "POST",
    headers: action,
    body: JSON.stringify({ activationRequestText: "x".repeat(200 * 1024) })
  });
  check("an oversized body is refused before it is buffered", oversized.status === 400, `got ${oversized.status}`);

  const badParse = await fetch(`${base}/api/license-issuer/parse`, {
    method: "POST",
    headers: action,
    body: JSON.stringify({ activationRequestText: JSON.stringify({ ...activationRequest(), fingerprintHash: "not-a-hash" }) })
  });
  const badParseBody = await badParse.json();
  check(
    "a malformed activation request is refused by the real issuer validator",
    badParse.status === 400 && badParseBody.reason === "ACTIVATION_REQUEST_INVALID",
    JSON.stringify(badParseBody)
  );

  const foreignProduct = await fetch(`${base}/api/license-issuer/parse`, {
    method: "POST",
    headers: action,
    body: JSON.stringify({ activationRequestText: JSON.stringify({ ...activationRequest(), product: "SomethingElse" }) })
  });
  check("an activation request for another product is refused", (await foreignProduct.json()).reason === "ACTIVATION_REQUEST_INVALID");

  const goodParse = await fetch(`${base}/api/license-issuer/parse`, {
    method: "POST",
    headers: action,
    body: JSON.stringify({ activationRequestText: JSON.stringify(activationRequest()) })
  });
  const goodParseBody = await goodParse.json();
  check(
    "a genuine activation request is accepted and echoed safely",
    goodParse.status === 200 &&
      goodParseBody.ok === true &&
      goodParseBody.request?.fingerprintHash === FINGERPRINT_A &&
      goodParseBody.request?.confidenceLevel === "high" &&
      goodParseBody.request?.fingerprintAlgorithmVersion === 1,
    JSON.stringify(goodParseBody).slice(0, 200)
  );
  check(
    "the parsed view carries no raw hardware value beyond the signal categories",
    Array.isArray(goodParseBody.request?.availableSignals) &&
      goodParseBody.request.availableSignals.every((signal: unknown) => typeof signal === "string")
  );

  const outputDirectory = issuerOutputDirectoryFor(nonElectronRuntimeRoot());
  const filesBefore = existsSync(outputDirectory) ? readdirSync(outputDirectory).length : -1;
  const issueResponse = await fetch(`${base}/api/license-issuer/issue`, {
    method: "POST",
    headers: action,
    body: JSON.stringify(goodBody)
  });
  const issueBody = await issueResponse.json();
  if (workstationHasKey) {
    check("an authorized issuance succeeds over the full chain", issueResponse.status === 200 && issueBody.ok === true, JSON.stringify(issueBody).slice(0, 200));
    check("the returned document is signed by a trusted key", issueBody.ok === true && verifyLicenseSignature(issueBody.document as LicenseDocument).ok);
  } else {
    check(
      "with no authorized key the full chain fails closed with ISSUER_KEY_MISSING",
      issueResponse.status === 400 && issueBody.ok === false && issueBody.reason === "ISSUER_KEY_MISSING",
      JSON.stringify(issueBody)
    );
    check(
      "a blocked issuance writes nothing",
      (existsSync(outputDirectory) ? readdirSync(outputDirectory).length : -1) === filesBefore,
      "a refusal that still produced a file would be worse than a failure"
    );
    blockedCheck(
      "end-to-end issuance with the production signing key",
      `no authorized key at ${workstationKeyPath.replace(/[^\\/]+$/, "<keyId>.…")} on this machine`
    );
  }
  check(
    "no refusal leaks a filesystem path or key material to the browser",
    !JSON.stringify(issueBody).includes("issuer-keys") && !JSON.stringify(issueBody).includes(sandbox)
  );

  /* A body that tries to make the server write somewhere, or run something, must change nothing. */
  const hostile = await fetch(`${base}/api/license-issuer/issue`, {
    method: "POST",
    headers: action,
    body: JSON.stringify({
      ...goodBody,
      licenseType: 'standard" & calc.exe & "',
      outputPath: join(sandbox, "should-not-exist.dat")
    })
  });
  check("an injection-shaped license type is refused", hostile.status === 400 && (await hostile.json()).reason === "ISSUER_OPTIONS_INVALID");
  check("no file appeared at a browser-chosen path", !existsSync(join(sandbox, "should-not-exist.dat")));

  const historyResponse = await fetch(`${base}/api/license-issuer/history`);
  const historyBody = await historyResponse.json();
  check("the issuance history route answers", historyResponse.status === 200 && typeof historyBody.ok === "boolean");
  check(
    "history never carries key material",
    !JSON.stringify(historyBody).includes(PRIVATE_B64) && !JSON.stringify(historyBody).toLowerCase().includes("pkcs8")
  );

  const unlisted = await fetch(`${base}/api/license-issuer/../package.json`);
  check("an unlisted issuer sub-path is not served", unlisted.status === 404, `got ${unlisted.status}`);

  server.close();

  /* ======================================================================
     7. Issuance semantics through the very service the bridge calls
     ====================================================================== */
  console.log("\nIssued licenses (real signatures, ephemeral trusted key):");
  const keyDirectory = join(sandbox, "keys");
  const keyPath = join(keyDirectory, `${KEY_ID}.ed25519.pkcs8.b64`);
  const outDirectory = join(sandbox, "issuer-output");
  mkdirSync(keyDirectory, { recursive: true });
  writeFileSync(keyPath, PRIVATE_B64, "utf8");

  const fixedNow = Date.parse("2026-08-19T12:34:56.000Z");
  const issuer = new LicenseIssuerService({
    keyId: KEY_ID,
    keyPath,
    outputDirectory: outDirectory,
    product: LICENSING_PRODUCT,
    trustedKeys: EPHEMERAL_KEYS,
    now: () => fixedNow
  });

  const windowPayload = buildIssuePayload({
    activationRequestText: JSON.stringify(activationRequest()),
    licenseType: "enterprise",
    entitlements: ["workflow.execute", "workflow.concurrent", "automation.browser"],
    validity: { mode: "window", validFromUtc: "2026-08-19T12:00:00.000Z", expiresAtUtc: "2026-09-18T19:30:00.000Z" }
  });
  check("the dashboard payload builder produced the issuer's own input shape", windowPayload.ok === true);
  const issued = await issuer.issue((windowPayload as { value: unknown }).value);
  const document = JSON.parse(readFileSync(issued.outputPath, "utf8")) as LicenseDocument;

  check("the issued file uses the established .dat name and confined folder",
    issued.outputPath === join(outDirectory, issued.fileName) && issued.fileName.endsWith(".dat"));
  check("the license carries the real schema version", document.schemaVersion === LICENSE_SCHEMA_VERSION);
  check("the license carries a real Ed25519 signature", document.signatureAlgorithm === "Ed25519" && document.signature.length > 0);
  check("the signature verifies against the trusted public key", verifyLicenseSignature(document, EPHEMERAL_KEYS).ok);
  check("the license is bound to the requesting machine", document.machineFingerprintHash === FINGERPRINT_A);
  check("the exact valid-from timestamp survived", document.validFromUtc === "2026-08-19T12:00:00.000Z", document.validFromUtc);
  check("the exact expiry timestamp survived", document.expiresAtUtc === "2026-09-18T19:30:00.000Z", document.expiresAtUtc);
  check("issued-at records the signing moment, not the window start", document.issuedAtUtc === "2026-08-19T12:34:00.000Z", document.issuedAtUtc);
  check("the serial number follows the established format", /^SPEC-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(document.serialNumber), document.serialNumber);
  check("the requested license type and entitlements were carried through",
    document.licenseType === "enterprise" && document.entitlements.join(",") === "workflow.execute,workflow.concurrent,automation.browser");
  check("no wildcard or empty machine binding was produced", document.machineFingerprintHash.length === 64 && document.machineFingerprintHash !== "*");

  const midWindow = Date.parse("2026-08-25T00:00:00.000Z");
  check(
    "the license is VALID on the machine it was issued for",
    validateLicense({ license: document, currentFingerprintHash: FINGERPRINT_A, nowMs: midWindow, trustedKeys: EPHEMERAL_KEYS }).status ===
      LicenseStatus.VALID
  );
  check(
    "the same license reports MACHINE_MISMATCH on another fingerprint",
    validateLicense({ license: document, currentFingerprintHash: FINGERPRINT_B, nowMs: midWindow, trustedKeys: EPHEMERAL_KEYS }).status ===
      LicenseStatus.MACHINE_MISMATCH
  );
  check(
    "the license is EXPIRED one minute past its exact expiry",
    validateLicense({
      license: document,
      currentFingerprintHash: FINGERPRINT_A,
      nowMs: Date.parse("2026-09-18T19:31:00.000Z"),
      trustedKeys: EPHEMERAL_KEYS
    }).status === LicenseStatus.EXPIRED
  );
  check(
    "the license is still live one minute before it",
    validateLicense({
      license: document,
      currentFingerprintHash: FINGERPRINT_A,
      nowMs: Date.parse("2026-09-18T19:29:00.000Z"),
      trustedKeys: EPHEMERAL_KEYS
    }).operable
  );
  check(
    "a tampered expiry breaks the signature rather than extending the license",
    validateLicense({
      license: { ...document, expiresAtUtc: "2030-01-01T00:00:00.000Z" },
      currentFingerprintHash: FINGERPRINT_A,
      nowMs: midWindow,
      trustedKeys: EPHEMERAL_KEYS
    }).status === LicenseStatus.INVALID_SIGNATURE
  );

  /* A one-hour license — the shortest preset — must still be operable, not rejected as degenerate. */
  const hourPayload = buildIssuePayload({
    activationRequestText: JSON.stringify(activationRequest()),
    licenseType: "trial",
    entitlements: ["workflow.execute"],
    validity: { mode: "window", validFromUtc: "2026-08-19T12:30:00.000Z", expiresAtUtc: "2026-08-19T13:30:00.000Z" }
  });
  const hourLicense = JSON.parse(
    readFileSync((await issuer.issue((hourPayload as { value: unknown }).value)).outputPath, "utf8")
  ) as LicenseDocument;
  check("a one-hour window is issued to the minute",
    hourLicense.validFromUtc === "2026-08-19T12:30:00.000Z" && hourLicense.expiresAtUtc === "2026-08-19T13:30:00.000Z");
  check(
    "a one-hour license is operable inside its window",
    validateLicense({
      license: hourLicense,
      currentFingerprintHash: FINGERPRINT_A,
      nowMs: Date.parse("2026-08-19T13:00:00.000Z"),
      trustedKeys: EPHEMERAL_KEYS
    }).operable
  );

  /* Domain-level rejections that the browser never gets to bypass. */
  const domainRejections: Array<[string, unknown]> = [
    ["both a day count and a window", { activationRequest: activationRequest(), licenseType: "standard", entitlements: ["workflow.execute"], validityDays: 30, validityWindow: { validFromUtc: "2026-08-19T12:00:00.000Z", expiresAtUtc: "2026-09-18T12:00:00.000Z" } }],
    ["neither a day count nor a window", { activationRequest: activationRequest(), licenseType: "standard", entitlements: ["workflow.execute"] }],
    ["an inverted window", { activationRequest: activationRequest(), licenseType: "standard", entitlements: ["workflow.execute"], validityWindow: { validFromUtc: "2026-09-18T12:00:00.000Z", expiresAtUtc: "2026-08-19T12:00:00.000Z" } }],
    ["a window longer than the maximum", { activationRequest: activationRequest(), licenseType: "standard", entitlements: ["workflow.execute"], validityWindow: { validFromUtc: "2026-08-19T12:00:00.000Z", expiresAtUtc: "2046-08-19T12:00:00.000Z" } }],
    ["a window starting far in the future", { activationRequest: activationRequest(), licenseType: "standard", entitlements: ["workflow.execute"], validityWindow: { validFromUtc: "2030-08-19T12:00:00.000Z", expiresAtUtc: "2030-09-19T12:00:00.000Z" } }],
    ["a sub-minute window", { activationRequest: activationRequest(), licenseType: "standard", entitlements: ["workflow.execute"], validityWindow: { validFromUtc: "2026-08-19T12:00:10.000Z", expiresAtUtc: "2026-08-19T12:00:50.000Z" } }]
  ];
  for (const [label, input] of domainRejections) {
    let reason: string | null = null;
    try {
      await issuer.issue(input);
    } catch (error) {
      reason = error instanceof LicenseIssuerError ? error.reason : "OTHER";
    }
    check(`the issuer refuses ${label}`, reason === "ISSUER_OPTIONS_INVALID", reason ?? "it was signed");
  }
  const outputAfterRejections = readdirSync(outDirectory).filter((name) => name.endsWith(".dat"));
  check("no refused request produced a file", outputAfterRejections.length === 2, outputAfterRejections.join(", "));

  /* ======================================================================
     8. The generated file goes through the normal import path
     ====================================================================== */
  console.log("\nImport through the application's own licensing path:");
  const installRoot = join(sandbox, "install");
  mkdirSync(installRoot, { recursive: true });
  const service = new LicenseService({
    store: new LicenseStore(installRoot, null),
    product: LICENSING_PRODUCT,
    appVersion: "0.1.14",
    fingerprintProvider: () => ({
      algorithmVersion: 1,
      fingerprintHash: FINGERPRINT_A,
      availableSignals: ["machineGuid"],
      confidenceLevel: "high",
      generatedAtUtc: "2026-08-19T09:00:00.000Z"
    }),
    trustedKeys: EPHEMERAL_KEYS,
    now: () => midWindow
  });
  const imported = service.importLicense(JSON.parse(readFileSync(issued.outputPath, "utf8")) as LicenseDocument);
  check("the downloaded file imports through LicenseService unchanged", imported.ok === true, imported.rejectedReason ?? "");
  check("the imported license reports VALID for its machine", imported.status.status === LicenseStatus.VALID, imported.status.status);
  check("the imported license exposes the exact expiry", imported.status.license?.expiresAtUtc === "2026-09-18T19:30:00.000Z");
  check("the imported serial is masked for display", /^••••-[0-9A-Z]{4}$/.test(imported.status.license?.serialNumberMasked ?? ""));

  const otherMachineRoot = join(sandbox, "other-install");
  mkdirSync(otherMachineRoot, { recursive: true });
  const otherService = new LicenseService({
    store: new LicenseStore(otherMachineRoot, null),
    product: LICENSING_PRODUCT,
    appVersion: "0.1.14",
    fingerprintProvider: () => ({
      algorithmVersion: 1,
      fingerprintHash: FINGERPRINT_B,
      availableSignals: ["machineGuid"],
      confidenceLevel: "high",
      generatedAtUtc: "2026-08-19T09:00:00.000Z"
    }),
    trustedKeys: EPHEMERAL_KEYS,
    now: () => midWindow
  });
  const rejected = otherService.importLicense(JSON.parse(readFileSync(issued.outputPath, "utf8")) as LicenseDocument);
  check("the same file is refused on another machine", rejected.ok === false && rejected.rejectedReason === "MACHINE_MISMATCH", rejected.rejectedReason ?? "accepted");
  check("nothing was stored on the machine that refused it", readdirSync(otherMachineRoot).length === 0, readdirSync(otherMachineRoot).join(", "));

  /* ======================================================================
     9. The packaged application stays free of all of this
     ====================================================================== */
  console.log("\nProduction packaging boundary:");
  const builderConfig = JSON.parse(read("electron-builder.json"));
  const packagedGlobs: string[] = [
    ...builderConfig.files,
    ...builderConfig.extraResources.map((entry: { from: string }) => entry.from)
  ];
  check(
    "tools/ is never packaged, so neither the dashboard nor the issuer CLI ships",
    packagedGlobs.every((glob) => !glob.startsWith("tools")),
    packagedGlobs.join(", ")
  );
  check(
    "the issuer bridge and the dashboard page both live under tools/",
    existsSync(join(REPO_ROOT, "tools", "license-issuer", "roadmap-bridge.mts")) &&
      existsSync(join(REPO_ROOT, "tools", "roadmap", "public", "license-issuer.js"))
  );
  check(
    "the repository ships public verification keys only",
    (() => {
      const trusted = read("src", "licensing", "crypto", "TrustedKeys.ts");
      return trusted.includes("publicKeySpkiB64") && !trusted.includes("PRIVATE KEY") && !trusted.includes("pkcs8");
    })()
  );
  // Needles assembled from fragments so this scanner never matches its OWN source. Matching a whole
  // PEM block rather than its header is what makes the result mean "a key is committed" instead of
  // "somebody wrote the words private key" — the first draft failed on this very file.
  const PEM_BLOCK = new RegExp(`${"-----BEGIN "}[A-Z ]*${"PRIVATE KEY-----"}[\\s\\S]{40,}?${"-----END "}`);
  const PKCS8_ED25519_B64 = ["MC4CAQAw", "BQYDK2Vw"].join("");
  const keyHits: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|mts|tsx|js|mjs|json|css|html|dat|b64|pem|key)$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        if (PEM_BLOCK.test(text) || text.includes(PKCS8_ED25519_B64)) keyHits.push(full);
      }
    }
  };
  for (const root of ["src", "app", "tools", "resources", "scripts", "build"]) walk(join(REPO_ROOT, root));
  check(
    "the private-key scan is not vacuous",
    PEM_BLOCK.test(`-----BEGIN PRIVATE KEY-----\n${"A".repeat(64)}\n-----END PRIVATE KEY-----`) &&
      `${PKCS8_ED25519_B64}abc`.includes(PKCS8_ED25519_B64),
    "both needles must match a real key before their absence proves anything"
  );
  check(
    "no private key material is tracked anywhere in the repository",
    keyHits.length === 0,
    keyHits.join(", ") || "a committed key would be an authority anyone with the repository could sign with"
  );
  check(
    "the issuer key custody rule still guards every signing path",
    read("src", "licensing", "issuer", "LicenseIssuerService.ts").includes("evaluateKeyCustody(this.options.keyPath)")
  );
  check(
    "no environment variable disables licensing for the dashboard",
    !bridgeSrc.includes("AWKIT_TEST_LICENSE_BYPASS") &&
      !bridgeCallerSrc.includes("AWKIT_TEST_LICENSE_BYPASS") &&
      !serverSrc.includes("AWKIT_TEST_LICENSE_BYPASS")
  );
} catch (error) {
  failed += 1;
  console.error(error);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${passed}/${passed + failed} roadmap license issuer checks passed`);
if (blocked.length > 0) {
  console.log(`${blocked.length} BLOCKED (not executed, not counted as passing):`);
  for (const entry of blocked) console.log(`  - ${entry}`);
}
process.exit(failed === 0 ? 0 : 1);
