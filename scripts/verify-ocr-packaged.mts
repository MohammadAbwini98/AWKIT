/**
 * verify:ocr-packaged — Phase N, N7.8 packaged OCR acceptance (awkit-vra.9.9), also the executed N7.1b proof
 * (awkit-vra.9.3). Verifier class: packaged-application.
 *
 * Runs ONLY against the exact payload `npm run package:portable` produced (`dist/win-unpacked`). It never falls back to
 * the source build or to development-staged assets: a missing or stale payload is NOT RUN (exit 2), and the licensed
 * runs without the issuer key are BLOCKED (exit 3), never passed. OCR accuracy is not claimed here (N7.10).
 *
 *  A. Packaged assets (N7.1b): the three pinned files of src/offline/ocr-runtime.json are in resources/resources/ocr
 *     with their pinned SHA-256, outside the ASAR, within the OC-9 byte target, with the Apache licence text; the
 *     shipped host is byte-identical to native-hosts/ocr/ocr-host.cjs and replaces every network entry point before it
 *     loads the engine; the shipped dependency manifest verifies against the shipped Ed25519 public key and lists the
 *     same engine, data, files and host with the same SHA-256, optional for startup.
 *  B. Startup and validation (unlicensed): the packaged app starts with AWKIT_VISUAL_OCR=observe and forks no OCR host
 *     (lazy, no mandatory model dependency); the run flow validates; an OCR step expecting a card number is refused
 *     before any run as a blocking OC-8 issue that does not repeat the number.
 *  C. Real runs on the packaged app (licensed through the walkthrough's verification-license path):
 *     C1 OCR off (flag unset): every OCR step is recorded `disabled` with no verdict, the run completes, no OCR host;
 *        a flow without OCR steps completes with no OCR block (disabled mode identical to running without OCR).
 *     C2 OCR observe: the packaged engine runs in the utility host and reads the lab label (matched) and a wrong
 *        expectation (differs), or reports budget-exhausted honestly, never a wrong verdict. Observe only: with
 *        stopOnError the instance report passes, every OCR step is recorded in flow order and the flow reaches its end.
 *        A cvv wrapper (sensitive-step) and a protected sign-in page (protected-surface) are refused. While the runs
 *        execute, the live OCR host is sampled for TCP and UDP endpoints (a supporting sample; the runtime proof of the
 *        host's network block is verify:ocr-host). No engine or language file is downloaded into the profile, and a
 *        flow without OCR steps still completes with no OCR block.
 *     C3 Cancellation: a run stopped while an OCR step is in progress settles stopped/cancelled and the next run
 *        completes.
 *     C4 Shutdown: after the app closes, no OCR host process it started is still alive.
 *  Throughout: no expected or recognized text reaches any stored file of the isolated profile outside the flow store.
 *
 * Strict offline validation of the release itself is `validate:offline -- -Strict`, run inside package:portable.
 *
 * Run: npm run package:portable && npm run verify:ocr-packaged
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listPackage } from "@electron/asar";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { cleanupMintedArtifacts, mintVerificationLicense, resolveIssuerKey, sanitizeAppEnv } from "./helpers/packaged-license.mts";
import { stalePackagedPayload } from "./helpers/packaged-artifacts.mjs";
// @ts-expect-error The manifest signature module is plain ESM JavaScript.
import { verifyManifestSignature } from "./offline-manifest-signature.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const unpacked = join(root, "dist", "win-unpacked");
const exePath = join(unpacked, "SpecterStudio.exe");
const asarPath = join(unpacked, "resources", "app.asar");
const shippedResources = join(unpacked, "resources", "resources");
const shippedOcr = join(shippedResources, "ocr");
const ACCOUNT = { displayName: "Packaged OCR", username: "pkgocr", password: "Ocr!Packaged2026" };

type PinFile = { role: string; target: string; sha256: string };
type Pin = {
  engine: { package: string; version: string; flavor: string };
  data: { package: string; version: string; variant: string };
  files: PinFile[];
  license: { target: string; mustContain: string };
  budget: { maxTotalBytes: number };
};
const pin = JSON.parse(readFileSync(join(root, "src", "offline", "ocr-runtime.json"), "utf8")) as Pin;

// The lab's own texts. They exist in the flow store (the expectation) and nowhere else the app writes.
const EXPECTED = "Order 4521 shipped";
const WRONG = "Payment declined today";
const CARD = "4111 1111 1111 1111";
const LEAK_PHRASES = [EXPECTED, WRONG, CARD];

let passed = 0;
let failed = 0;
let blocked = 0;
const check = (label: string, cond: unknown, detail?: string): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const block = (label: string, reason: string): void => {
  blocked += 1;
  console.log(`  ⊘ ${label} — BLOCKED: ${reason}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (address && typeof address === "object" ? ok(address.port) : fail(new Error("no port"))));
    });
  });
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    try {
      if (statSync(p).isDirectory()) out.push(...files(p));
      else out.push(p);
    } catch {
      // An atomic write's temporary file can vanish between the listing and the stat.
    }
  }
  return out;
}

// ── A. Packaged assets (N7.1b) ──────────────────────────────────────────────────────────────────────────────────────
async function inspectPackage(): Promise<void> {
  console.log("\nA. Packaged OCR assets, host and signed manifest");
  check("resources/ocr is shipped as an extra resource", existsSync(shippedOcr), shippedOcr);
  if (!existsSync(shippedOcr)) return;

  let pinnedBytes = 0;
  for (const file of pin.files) {
    const shipped = join(shippedOcr, file.target);
    const present = existsSync(shipped);
    if (present) pinnedBytes += statSync(shipped).size;
    check(`${file.role} ${file.target} is shipped with its pinned SHA-256`, present && sha256(shipped) === file.sha256, present ? sha256(shipped) : "missing");
  }
  check(`the pinned engine and data total ${pinnedBytes} bytes, within the OC-9 target of ${pin.budget.maxTotalBytes}`, pinnedBytes > 0 && pinnedBytes <= pin.budget.maxTotalBytes);
  const licence = join(shippedOcr, pin.license.target);
  check("the engine licence text is shipped", existsSync(licence) && readFileSync(licence, "utf8").includes(pin.license.mustContain));

  const asarEntries = listPackage(asarPath, { isPack: false }).map((e) => e.replace(/\\/g, "/"));
  check("the ASAR was listed", asarEntries.length > 100, String(asarEntries.length));
  const inAsar = asarEntries.filter((e) => [...pin.files.map((f) => f.target), "ocr-host.cjs"].some((name) => e.endsWith(`/${name}`)));
  check("no OCR engine, data or host file is inside the ASAR (the host loads them from resources/ocr)", inAsar.length === 0, inAsar.join(", "));

  const hostShipped = join(shippedOcr, "ocr-host.cjs");
  const hostSource = join(root, "native-hosts", "ocr", "ocr-host.cjs");
  check("the shipped OCR host is byte-identical to native-hosts/ocr/ocr-host.cjs", existsSync(hostShipped) && sha256(hostShipped) === sha256(hostSource));
  if (existsSync(hostShipped)) {
    // The same anchors verify:ocr-host pins on the source host, here on the shipped bytes.
    const code = readFileSync(hostShipped, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const blockAt = code.indexOf("(function blockNetwork()");
    const engineAt = code.indexOf("require(path.join(dir, ENGINE_JS))");
    check("the shipped host blocks the network before it loads the engine", blockAt > 0 && engineAt > blockAt);
    const entries = ["mod.request = refuse", "net.connect = refuse", '"node:tls").connect = refuse', "dns[name] = refuse", "globalThis.fetch", "electronNet[name] = refuse"];
    const missing = entries.filter((entry) => !code.includes(entry));
    check("the shipped host replaces the http, net, tls, dns, fetch and Electron net entry points", missing.length === 0, missing.join(", "));
  }

  const manifestPath = join(shippedResources, "dependency-manifest.json");
  const signaturePath = join(shippedResources, "dependency-manifest.sig");
  const publicKeyPath = join(shippedResources, "trust", "offline-manifest-public.pem");
  const shippedTrio = existsSync(manifestPath) && existsSync(signaturePath) && existsSync(publicKeyPath);
  check("the dependency manifest, its signature and the public key are shipped", shippedTrio);
  if (!shippedTrio) return;
  check(
    "the shipped public key is the repository's release key",
    sha256(publicKeyPath) === sha256(join(root, "resources", "trust", "offline-manifest-public.pem"))
  );
  let signatureError = "";
  try {
    await verifyManifestSignature({ manifestPath, signaturePath, publicKeyPath });
  } catch (error) {
    signatureError = error instanceof Error ? error.message : String(error);
  }
  check("the shipped dependency manifest verifies against the shipped Ed25519 public key", signatureError === "", signatureError);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    ocrRuntime?: {
      enabled?: boolean;
      requiredForAppStartup?: boolean;
      totalBytes?: number;
      engine?: { package?: string; version?: string; flavor?: string };
      data?: { package?: string; version?: string; variant?: string };
      assets?: { relativePath?: string; sha256?: string }[];
    };
  };
  const ocr = manifest.ocrRuntime;
  check("the signed manifest declares OCR included and not required for startup", ocr?.enabled === true && ocr.requiredForAppStartup === false, JSON.stringify({ enabled: ocr?.enabled, requiredForAppStartup: ocr?.requiredForAppStartup }));
  check(
    "the signed manifest names the pinned engine and language data",
    ocr?.engine?.package === pin.engine.package && ocr.engine.version === pin.engine.version && ocr.engine.flavor === pin.engine.flavor &&
      ocr.data?.package === pin.data.package && ocr.data.version === pin.data.version && ocr.data.variant === pin.data.variant
  );
  const listed = (name: string) => (ocr?.assets ?? []).find((a) => a.relativePath === `ocr/${name}`);
  const mismatched = [...pin.files.map((f) => f.target), "ocr-host.cjs"].filter((name) => {
    const shipped = join(shippedOcr, name);
    return !existsSync(shipped) || String(listed(name)?.sha256 ?? "").toLowerCase() !== sha256(shipped);
  });
  check("the signed manifest lists every shipped OCR file and the host with the shipped SHA-256", mismatched.length === 0, mismatched.join(", "));
  check("the signed manifest's OCR total is within the OC-9 target", typeof ocr?.totalBytes === "number" && ocr.totalBytes <= pin.budget.maxTotalBytes, String(ocr?.totalBytes));
}

// ── The packaged app ────────────────────────────────────────────────────────────────────────────────────────────────
function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** The OCR steps of the run flow, in flow order. */
const OCR_STEPS = ["ocr-label", "ocr-wrong", "ocr-wrapper", "ocr-protected"] as const;
const CANCEL_STEPS = 8;

function seed(localAppData: string, lab: string): void {
  const data = join(localAppData, "SpecterStudio");
  const now = new Date().toISOString();
  const goto = (id: string, url: string) => ({ id, type: "goto", name: `Open ${id}`, url, valueSource: { type: "static", value: url }, timeoutMs: 30000 });
  // Neutral names: a step name is part of the OC-8 context, so none suggests a code, PIN or card.
  const observe = (id: string, name: string, testId: string, value: string) => ({
    id,
    type: "assertImageText",
    name,
    locator: { strategy: "testId", value: testId },
    value,
    valueSource: { type: "static", value },
    timeoutMs: 15000,
    config: { ocrMatch: "normalized" }
  });
  const visible = (id: string) => ({ id, type: "assertVisible", name: `Label visible ${id}`, locator: { strategy: "testId", value: "oc-label" }, timeoutMs: 15000 });
  const flow = (id: string, name: string, nodes: { id: string }[]) => ({
    id,
    name,
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [{ id: "start", type: "start", name: "Start" }, ...nodes, { id: "end", type: "end", name: "End" }],
    edges: ["start", ...nodes.map((n) => n.id)].map((source, i, all) => ({ id: `e${i}`, source, target: all[i + 1] ?? "end", type: "success" }))
  });
  const flows: [string, string, { id: string }[]][] = [
    [
      "ocr-pkg-flow",
      "OCR packaged flow",
      [
        goto("open-lab", lab),
        observe("ocr-label", "OCR label", "oc-label", EXPECTED),
        observe("ocr-wrong", "OCR wrong text", "oc-label", WRONG),
        observe("ocr-wrapper", "OCR wrapper", "oc-payment", "Security code"),
        goto("open-protected", `${lab}?protected=1`),
        observe("ocr-protected", "OCR protected page", "oc-label", EXPECTED),
        // Runs only if every OCR step let the flow continue: the flow reaches its end.
        visible("at-end")
      ]
    ],
    ["plain-ocr-pkg-flow", "Plain packaged flow", [goto("open-lab", lab), visible("plain")]],
    ["ocr-card-flow", "OCR card flow", [goto("open-lab", lab), observe("ocr-card", "OCR card label", "oc-card-text", CARD)]],
    [
      "ocr-cancel-flow",
      "OCR cancel flow",
      [goto("open-lab", lab), ...Array.from({ length: CANCEL_STEPS }, (_, i) => observe(`ocr-read-${i + 1}`, `OCR read ${i + 1}`, "oc-label", EXPECTED))]
    ]
  ];
  for (const [id, name, nodes] of flows) {
    writeJson(join(data, "flows", `${id}.json`), flow(id, name, nodes));
    const workflowId = id.replace(/-flow$/, "-workflow");
    writeJson(join(data, "workflows", `${workflowId}.json`), {
      id: workflowId,
      name: workflowId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      nodes: [{ id: "ref", type: "flowRef", flowId: id, alias: id, order: 1, required: true, inputBindings: {}, retryPolicy: { count: 0, delayMs: 0 }, failurePolicy: "stop", position: { x: 0, y: 0 } }],
      edges: [],
      runtimeInputs: [],
      execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true }
    });
  }
}

async function launch(localAppData: string, extra: Record<string, string>): Promise<{ app: ElectronApplication; win: Page }> {
  const env = sanitizeAppEnv({
    ...process.env,
    LOCALAPPDATA: localAppData,
    APPDATA: join(localAppData, "Roaming"),
    AWKIT_VISUAL_OCR: undefined,
    AWKIT_OCR_DEV_ASSET_DIR: undefined,
    ELECTRON_RUN_AS_NODE: undefined,
    ...extra
  });
  const app = await electron.launch({ executablePath: exePath, args: [`--user-data-dir=${join(localAppData, "Roaming", "SpecterStudio")}`], env: env as never, timeout: 90_000 });
  const deadline = Date.now() + 90_000;
  await app.firstWindow({ timeout: 90_000 }).catch(() => undefined);
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      if (await candidate.evaluate(() => typeof (window as any).playwrightFlowStudio?.executions?.runWorkflow === "function").catch(() => false)) {
        return { app, win: candidate };
      }
    }
    await sleep(400);
  }
  throw new Error("the packaged main window with the preload bridge never appeared");
}

async function signIn(win: Page): Promise<string> {
  await win.waitForSelector(".awkit-login-card, .app-shell", { timeout: 30_000 });
  if ((await win.locator("#awkit-setup-username").count()) > 0) {
    await win.fill("#awkit-setup-display", ACCOUNT.displayName);
    await win.fill("#awkit-setup-username", ACCOUNT.username);
    const pw = win.locator('.awkit-login-form input[type="password"]');
    await pw.nth(0).fill(ACCOUNT.password);
    await pw.nth(1).fill(ACCOUNT.password);
    await win.getByRole("button", { name: "Create account" }).click();
    await win.getByRole("heading", { name: "Save your recovery code" }).waitFor({ timeout: 30_000 });
    await win.getByRole("checkbox", { name: "I saved this recovery code in a secure place." }).check();
    await win.getByRole("button", { name: "Continue to SpecterStudio" }).click();
  } else if ((await win.locator(".app-shell").count()) === 0) {
    await win.fill("#awkit-login-username", ACCOUNT.username);
    await win.locator('.awkit-login-form input[type="password"]').first().fill(ACCOUNT.password);
    await win.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await win.waitForSelector(".app-shell", { timeout: 30_000 });
  const res = (await win.evaluate(
    async (c) => (window as any).playwrightFlowStudio.security.login({ providerId: "local", username: c.username, password: c.password }),
    ACCOUNT
  )) as any;
  if (!res?.ok) throw new Error(`login failed: ${res?.reason}`);
  return res.principal.sessionRef as string;
}

/** Activate a short-lived verification license, as verify:packaged-walkthrough does; a reason when it cannot. */
async function license(win: Page, sessionRef: string, workDir: string): Promise<string | null> {
  const key = resolveIssuerKey();
  if (!key.available) return key.reason ?? "no issuer key";
  const activation = (await win.evaluate(async (r) => (window as any).playwrightFlowStudio.licensing.exportRequest(r), sessionRef)) as any;
  if (!activation?.ok || !activation.value?.fingerprintHash) return "the packaged app did not return an activation request";
  try {
    const minted = await mintVerificationLicense({ repoRoot: root, keyPath: key.keyPath as string, activationRequest: activation.value, workDir, expiresInMinutes: 45 });
    await win.evaluate(async (i) => (window as any).playwrightFlowStudio.security.reauth(i), { sessionRef, password: ACCOUNT.password });
    const imported = (await win.evaluate(async (i) => (window as any).playwrightFlowStudio.licensing.import(i), { sessionRef, license: minted.license })) as any;
    return imported?.ok === true && imported.value?.ok === true ? null : "the verification license was not accepted";
  } catch (error) {
    return `the external issuer failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

type OcrRecord = { stepId: string; verdict?: string; code: string; durationMs?: number };
type Done = { status: string; reportStatus: string; records: OcrRecord[]; hasBlock: boolean; raw: string };
type Run = Done | { refused: string };
const SETTLED = ["passed", "failed", "cancelled", "stopped", "completed", "error"];
const completed = (status: string) => status === "completed" || status === "passed";

async function start(win: Page, workflowId: string): Promise<string | { refused: string }> {
  const started = (await win.evaluate(
    async (id) =>
      (window as any).playwrightFlowStudio.executions.runWorkflow({
        workflowId: id,
        dryRun: false,
        headless: true,
        totalInstances: 1,
        maxConcurrentInstances: 1,
        isolationMode: "browserContext",
        stopOnError: true,
        screenshotOnFailure: false
      }),
    workflowId
  )) as any;
  return started?.executionId ? String(started.executionId) : { refused: String(started?.status ?? JSON.stringify(started)).slice(0, 200) };
}

async function instancesOf(win: Page, executionId: string): Promise<any[]> {
  const list = (await win.evaluate(async () => (window as any).playwrightFlowStudio.executions.list())) as any[];
  return list.filter((i) => i.executionId === executionId);
}

async function settle(win: Page, executionId: string, limitMs = 150_000, onPoll?: () => Promise<void>): Promise<string> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const mine = await instancesOf(win, executionId);
    if (mine.length > 0 && mine.every((i) => SETTLED.includes(String(i.status)))) return String(mine[0].status);
    if (Date.now() > deadline) throw new Error(`execution ${executionId} did not settle within ${limitMs / 1000} s`);
    await onPoll?.();
    await sleep(500);
  }
}

async function run(win: Page, workflowId: string, onPoll?: () => Promise<void>): Promise<Run> {
  const id = await start(win, workflowId);
  if (typeof id !== "string") return id;
  const status = await settle(win, id, 150_000, onPoll);
  const report = (await win.evaluate(async (executionId) => {
    const end = Date.now() + 15_000;
    for (;;) {
      const r = (await (window as any).playwrightFlowStudio.reports.get(executionId)) as any;
      if (r?.instances?.length || Date.now() > end) return r ?? null;
      await new Promise((res) => setTimeout(res, 250));
    }
  }, id)) as any;
  const instance = report?.instances?.[0] ?? {};
  const records = (instance.ocrAssertions ?? []) as OcrRecord[];
  return { status, reportStatus: String(instance.status ?? "none"), records, hasBlock: instance.ocrAssertions !== undefined, raw: JSON.stringify(records).slice(0, 1500) };
}

async function ocrHostPids(app: ElectronApplication): Promise<number[]> {
  return app.evaluate(({ app: electronApp }) =>
    electronApp
      .getAppMetrics()
      .filter((m) => m.type === "Utility" && /SpecterStudio OCR/.test(`${String((m as { serviceName?: string }).serviceName ?? "")} ${String(m.name ?? "")}`))
      .map((m) => m.pid)
  );
}

/** TCP connections plus UDP endpoints owned by a process, from Windows' own tables; null when the probe failed. */
function socketsOwnedBy(pid: number): number | null {
  const probe = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", `@(Get-NetTCPConnection -OwningProcess ${pid} -ErrorAction SilentlyContinue).Count + @(Get-NetUDPEndpoint -OwningProcess ${pid} -ErrorAction SilentlyContinue).Count`],
    { encoding: "utf8", timeout: 30_000, windowsHide: true }
  );
  const count = Number.parseInt(String(probe.stdout).trim(), 10);
  return probe.status === 0 && Number.isFinite(count) ? count : null;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const describe = (r?: OcrRecord) => (r ? `${r.stepId} ${r.verdict ?? "-"}/${r.code}${r.durationMs !== undefined ? ` ${r.durationMs}ms` : ""}` : "no record");
const byStep = (records: OcrRecord[], stepId: string) => records.find((r) => r.stepId === stepId);

async function packagedApp(): Promise<void> {
  const localAppData = mkdtempSync(join(tmpdir(), "awkit-ocr-packaged-"));
  const dataRoot = join(localAppData, "SpecterStudio");
  const port = await freePort();
  const lab = `http://127.0.0.1:${port}/visual-intelligence/ocr`;
  seed(localAppData, lab);
  const server: ChildProcess = spawn(process.execPath, ["mock-site/server.mjs"], { cwd: root, env: { ...process.env, MOCK_SITE_PORT: String(port) }, stdio: "ignore", windowsHide: true });
  const workDir = join(localAppData, "license-work");
  let app: ElectronApplication | undefined;
  const seenHosts = new Set<number>();
  try {
    for (let i = 0; i < 100 && !(await fetch(lab).then((r) => r.ok, () => false)); i += 1) await sleep(100);

    // ── B. Startup and validation ─────────────────────────────────────────────────────────────────────────────────
    console.log("\nB. Startup and validation with AWKIT_VISUAL_OCR=observe");
    let launched = await launch(localAppData, { AWKIT_VISUAL_OCR: "observe" });
    app = launched.app;
    let sessionRef = await signIn(launched.win);
    check("the packaged app starts and signs in with OCR observe on", true);
    check("no OCR host is forked at startup (lazy; OCR is never a startup dependency)", (await ocrHostPids(app)).length === 0);
    const validate = async (workflowId: string) => JSON.stringify(await launched.win.evaluate(async (id) => (window as any).playwrightFlowStudio.executions.validate(id), workflowId));
    const runFlow = await validate("ocr-pkg-workflow");
    check("the OCR run flow validates", (JSON.parse(runFlow) as { valid?: boolean }).valid === true, runFlow.slice(0, 400));
    const cardFlow = await validate("ocr-card-workflow");
    const cardIssues = ((JSON.parse(cardFlow) as { issues?: { blocking?: boolean; nodeId?: string; message?: string }[] }).issues ?? []).filter((i) => i.blocking);
    check(
      "an OCR step expecting a card number is refused before any run (blocking OC-8 issue on that step), and the issue does not repeat the number",
      (JSON.parse(cardFlow) as { valid?: boolean }).valid === false && cardIssues.some((i) => i.nodeId === "ocr-card" && /OC-8/.test(String(i.message))) && !cardFlow.includes("4111"),
      cardFlow.replace(/4111[\d ]*/g, "[card]").slice(0, 400)
    );

    console.log("\nC. Real runs on the packaged app");
    const unlicensed = await license(launched.win, sessionRef, workDir);
    if (unlicensed) {
      for (const label of [
        "C1 OCR off: disabled records, no host, a flow without OCR unchanged",
        "C2 OCR observe: the packaged engine reads the label, observe only, refusals, host sockets, no download",
        "C3 cancellation during an OCR step",
        "C4 shutdown leaves no OCR host"
      ]) {
        block(label, unlicensed);
      }
      return;
    }
    await app.close().catch(() => undefined);
    app = undefined;

    // ── C1. OCR off ───────────────────────────────────────────────────────────────────────────────────────────────
    console.log("\nC1. OCR off (AWKIT_VISUAL_OCR unset)");
    launched = await launch(localAppData, {});
    app = launched.app;
    sessionRef = await signIn(launched.win);
    const off = await run(launched.win, "ocr-pkg-workflow");
    if ("refused" in off) check("the OCR workflow is admitted with OCR off", false, off.refused);
    else {
      check(
        "every OCR step is recorded disabled with no verdict, and the run completes and passes",
        completed(off.status) && off.reportStatus === "passed" && off.records.length === OCR_STEPS.length && off.records.every((r) => r.code === "disabled" && !r.verdict),
        `${off.status}/${off.reportStatus} ${off.raw}`
      );
    }
    check("no OCR host was started with OCR off", (await ocrHostPids(app)).length === 0);
    const plainOff = await run(launched.win, "plain-ocr-pkg-workflow");
    if ("refused" in plainOff) check("the flow without OCR is admitted with OCR off", false, plainOff.refused);
    else check("a flow without OCR completes and passes with no OCR block", completed(plainOff.status) && plainOff.reportStatus === "passed" && !plainOff.hasBlock, `${plainOff.status}/${plainOff.reportStatus} ${plainOff.raw}`);
    await app.close().catch(() => undefined);
    app = undefined;

    // ── C2. OCR observe ───────────────────────────────────────────────────────────────────────────────────────────
    console.log("\nC2. OCR observe on the packaged engine");
    const before = new Set(files(localAppData));
    launched = await launch(localAppData, { AWKIT_VISUAL_OCR: "observe" });
    app = launched.app;
    sessionRef = await signIn(launched.win);
    const liveApp = app;
    const samples: { pid: number; count: number | null }[] = [];
    const sample = async () => {
      for (const pid of await ocrHostPids(liveApp)) {
        seenHosts.add(pid);
        samples.push({ pid, count: socketsOwnedBy(pid) });
      }
    };
    // The first run warms the host; verdicts from both runs are pooled (budget-exhausted is honest, never wrong).
    const runs: Run[] = [];
    for (let i = 0; i < 2; i += 1) runs.push(await run(launched.win, "ocr-pkg-workflow", sample));
    await sample();
    const okRuns = runs.filter((r): r is Done => !("refused" in r));
    check("both observe runs are admitted", okRuns.length === 2, runs.filter((r): r is { refused: string } => "refused" in r).map((r) => r.refused).join(" | "));
    if (okRuns.length > 0) {
      const all = okRuns.flatMap((r) => r.records);
      check(
        "observe only: with stopOnError each run completes and its report passes, every OCR step is recorded in flow order and the flow reaches its end",
        okRuns.every((r) => completed(r.status) && r.reportStatus === "passed" && r.records.map((rec) => rec.stepId).join() === OCR_STEPS.join()),
        okRuns.map((r) => `${r.status}/${r.reportStatus} [${r.records.map((rec) => rec.stepId).join(",")}]`).join(" | ")
      );
      const labels = okRuns.map((r) => byStep(r.records, "ocr-label"));
      const wrongs = okRuns.map((r) => byStep(r.records, "ocr-wrong"));
      check(
        "the packaged engine read the label: matched at least once, never anything but matched or budget-exhausted",
        labels.some((r) => r?.code === "text-matched") && labels.every((r) => r?.code === "text-matched" || r?.code === "budget-exhausted"),
        labels.map((r) => describe(r)).join(" | ")
      );
      check(
        "a wrong expectation reads differs at least once, never matched",
        wrongs.some((r) => r?.code === "text-differs") && wrongs.every((r) => r?.code === "text-differs" || r?.code === "budget-exhausted"),
        wrongs.map((r) => describe(r)).join(" | ")
      );
      for (const [stepId, code, what] of [
        ["ocr-wrapper", "sensitive-step", "a wrapper around a cvv field"],
        ["ocr-protected", "protected-surface", "a protected sign-in page"]
      ] as const) {
        const recs = okRuns.map((r) => byStep(r.records, stepId));
        check(`${what} is refused: inconclusive/${code} in every run`, recs.every((r) => r?.verdict === "inconclusive" && r.code === code), recs.map((r) => describe(r)).join(" | "));
      }
      check(
        "no real-engine verdict was recorded after the 1500 ms deadline",
        all.filter((r) => r.verdict === "matched" || r.verdict === "differs").every((r) => (r.durationMs ?? Infinity) <= 1_500),
        all.map((r) => describe(r)).join(" | ")
      );
    }
    check("the packaged OCR utility host ran", seenHosts.size > 0);
    check(
      "supporting sample: the live OCR host owned no TCP connection or UDP endpoint at any sample taken during and after the runs",
      samples.length > 0 && samples.every((s) => s.count === 0),
      `${samples.length} samples: ${JSON.stringify(samples.filter((s) => s.count !== 0).slice(0, 5))}`
    );
    const plainObserve = await run(launched.win, "plain-ocr-pkg-workflow");
    if ("refused" in plainObserve) check("the flow without OCR is admitted with OCR observe", false, plainObserve.refused);
    else check("with OCR on, a flow without OCR still completes and passes with no OCR block", completed(plainObserve.status) && plainObserve.reportStatus === "passed" && !plainObserve.hasBlock, `${plainObserve.status}/${plainObserve.reportStatus} ${plainObserve.raw}`);
    const downloaded = files(localAppData).filter((f) => !before.has(f) && /\.(wasm|traineddata(\.gz)?)$|tesseract/i.test(f));
    check("no engine or language data was downloaded into the profile", downloaded.length === 0, downloaded.join(", "));

    // ── C3. Cancellation during an OCR step ───────────────────────────────────────────────────────────────────────
    console.log("\nC3. Cancellation during an OCR step");
    const cancelId = await start(launched.win, "ocr-cancel-workflow");
    if (typeof cancelId !== "string") check("the run to cancel is admitted", false, cancelId.refused);
    else {
      let during = "";
      const watchUntil = Date.now() + 90_000;
      while (Date.now() < watchUntil && !during) {
        const mine = await instancesOf(launched.win, cancelId);
        if (mine.length > 0 && mine.every((i) => SETTLED.includes(String(i.status)))) break;
        const step = mine.map((i) => String(i.currentStep ?? "")).find((s) => /^OCR read \d+$/.test(s));
        if (step) during = step;
        else await sleep(50);
      }
      if (during) await launched.win.evaluate(async () => (window as any).playwrightFlowStudio.executions.stopAll());
      for (const pid of await ocrHostPids(app)) seenHosts.add(pid);
      const stopped = await settle(launched.win, cancelId, 60_000);
      check(
        "the stop was issued while an OCR step was in progress, and the run settled stopped or cancelled",
        !!during && (stopped === "stopped" || stopped === "cancelled"),
        `${during ? `stopped during "${during}"` : `no OCR step was observed in progress among ${CANCEL_STEPS}`}; settled ${stopped}`
      );
      const after = await run(launched.win, "ocr-pkg-workflow");
      check("the next OCR run completes after the cancellation", !("refused" in after) && completed(after.status), "refused" in after ? after.refused : after.status);
      for (const pid of await ocrHostPids(app)) seenHosts.add(pid);
    }

    // ── C4. Shutdown ──────────────────────────────────────────────────────────────────────────────────────────────
    console.log("\nC4. Shutdown");
    await app.close().catch(() => undefined);
    app = undefined;
    const goneBy = Date.now() + 15_000;
    while (Date.now() < goneBy && [...seenHosts].some(alive)) await sleep(250);
    check("no OCR host process the app started is alive after it closed", seenHosts.size > 0 && ![...seenHosts].some(alive), JSON.stringify([...seenHosts].filter(alive)));

    // The whole isolated profile (LOCALAPPDATA data, Roaming user data, logs), except the flow store that holds the
    // expectations by design, the minted licence work folder and Chromium's page caches of the lab itself.
    const flowStores = [join(dataRoot, "flows"), join(dataRoot, "workflows"), workDir];
    const leaks = files(localAppData)
      .filter((f) => !flowStores.some((store) => f.startsWith(store + sep)) && !/[\\/](Cache|Code Cache|GPUCache|Service Worker|blob_storage|browser-profiles?|chromium)[\\/]/i.test(f))
      .filter((f) => {
        try {
          if (statSync(f).size > 64 * 1024 * 1024) return false;
          const bytes = readFileSync(f);
          return LEAK_PHRASES.some((phrase) => bytes.includes(Buffer.from(phrase, "utf8")) || bytes.includes(Buffer.from(phrase, "utf16le")));
        } catch {
          return false;
        }
      });
    check("no stored file of the isolated profile outside the flow store holds an expected or recognized text", leaks.length === 0, leaks.map((f) => f.slice(localAppData.length)).join(", "));
  } finally {
    await app?.close().catch(() => undefined);
    server.kill();
    cleanupMintedArtifacts(workDir);
  }
}

async function main(): Promise<void> {
  console.log("N7.8 packaged OCR acceptance (dist/win-unpacked)\n\nPreconditions:");
  if (!existsSync(exePath) || !existsSync(asarPath)) {
    console.error(`  NOT RUN: ${exePath} is missing. Run npm run package:portable first (on a host where verify:packaging-host is READY).`);
    process.exit(2);
  }
  const stale = await stalePackagedPayload(root);
  if (stale) {
    console.error(`  NOT RUN: the packaged payload is older than the source (${stale}). Run npm run package:portable first.`);
    process.exit(2);
  }
  check("the packaged payload is current", true);
  try {
    await inspectPackage();
    await packagedApp();
  } catch (error) {
    failed += 1;
    console.error(`  ✗ unexpected error — ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`\nverify:ocr-packaged — ${passed} passed, ${failed} failed, ${blocked} blocked`);
  process.exit(failed > 0 ? 1 : blocked > 0 ? 3 : 0);
}

void main();
