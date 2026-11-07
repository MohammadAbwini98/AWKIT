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
 *     shipped host is byte-identical to native-hosts/ocr/ocr-host.cjs and blocks every network entry point before it
 *     loads the engine; the shipped dependency manifest verifies against the shipped Ed25519 public key and lists the
 *     same engine, data, files and host with the same SHA-256, optional for startup.
 *  B. Startup (unlicensed): the packaged app starts with AWKIT_VISUAL_OCR=observe and forks no OCR host until a step
 *     needs one (lazy, zero mandatory model dependency).
 *  C. Real runs on the packaged app (licensed through the walkthrough's verification-license path):
 *     C1 OCR off (flag unset): every OCR step is recorded `disabled` with no verdict, the run completes, no OCR host;
 *        a flow without OCR steps completes with no OCR block (disabled mode identical to a build without OCR).
 *     C2 OCR observe: the packaged engine runs in the utility host and reads the lab label (matched) and a wrong
 *        expectation (differs), or reports budget-exhausted honestly, never a wrong verdict; observe only — the run
 *        completes and no OCR step fails, retries or changes the flow; card text (sensitive-input), a cvv wrapper
 *        (sensitive-step) and a protected sign-in page (protected-surface) are refused; the OCR host holds no TCP or
 *        UDP endpoint; no engine or language file is downloaded into the profile; the flow without OCR steps still
 *        completes with no OCR block.
 *     C3 Cancellation: a run stopped mid-way settles stopped/cancelled and the next run completes.
 *     C4 Shutdown: after the app closes, no OCR host process it started is still alive.
 *  Throughout: no expected or recognized text reaches a report, log, audit or other stored file outside the flow store.
 *
 * Network: section A proves the shipped host replaces Node's and Electron's network entry points before the engine
 * loads (the runtime proof of that block is verify:ocr-host); C2 samples the live host's sockets. Strict offline
 * validation of the release itself is `validate:offline -- -Strict`, run inside package:portable.
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
  let signatureOk = false;
  try {
    await verifyManifestSignature({ manifestPath, signaturePath, publicKeyPath });
    signatureOk = true;
  } catch (error) {
    check("the shipped dependency manifest verifies against the shipped Ed25519 public key", false, error instanceof Error ? error.message : String(error));
  }
  if (signatureOk) check("the shipped dependency manifest verifies against the shipped Ed25519 public key", true);

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

const OCR_STEPS = ["ocr-label", "ocr-wrong", "ocr-card", "ocr-cvv", "ocr-protected"] as const;

function seed(localAppData: string, lab: string): void {
  const data = join(localAppData, "SpecterStudio");
  const now = new Date().toISOString();
  const goto = (id: string, url: string) => ({ id, type: "goto", name: `Open ${id}`, url, valueSource: { type: "static", value: url }, timeoutMs: 30000 });
  const observe = (id: string, testId: string, value: string) => ({
    id,
    type: "assertImageText",
    name: `Observe ${id}`,
    locator: { strategy: "testId", value: testId },
    value,
    valueSource: { type: "static", value },
    timeoutMs: 15000,
    config: { ocrMatch: "normalized" }
  });
  const flow = (id: string, name: string, nodes: { id: string }[]) => ({
    id,
    name,
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [{ id: "start", type: "start", name: "Start" }, ...nodes, { id: "end", type: "end", name: "End" }],
    edges: ["start", ...nodes.map((n) => n.id)].map((source, i, all) => ({ id: `e${i}`, source, target: all[i + 1] ?? "end", type: "success" }))
  });
  writeJson(
    join(data, "flows", "ocr-pkg-flow.json"),
    flow("ocr-pkg-flow", "OCR packaged flow", [
      goto("open-lab", lab),
      observe("ocr-label", "oc-label", EXPECTED),
      observe("ocr-wrong", "oc-label", WRONG),
      observe("ocr-card", "oc-card-text", CARD),
      observe("ocr-cvv", "oc-payment", "Security code"),
      goto("open-protected", `${lab}?protected=1`),
      observe("ocr-protected", "oc-label", EXPECTED)
    ])
  );
  writeJson(
    join(data, "flows", "plain-ocr-pkg-flow.json"),
    flow("plain-ocr-pkg-flow", "Plain packaged flow", [goto("open-lab", lab), { id: "see-label", type: "assertVisible", name: "The label is visible", locator: { strategy: "testId", value: "oc-label" }, timeoutMs: 15000 } as { id: string }])
  );
  for (const [id, flowId] of [
    ["ocr-pkg-workflow", "ocr-pkg-flow"],
    ["plain-ocr-pkg-workflow", "plain-ocr-pkg-flow"]
  ]) {
    writeJson(join(data, "workflows", `${id}.json`), {
      id,
      name: id,
      version: 1,
      createdAt: now,
      updatedAt: now,
      nodes: [{ id: "ref", type: "flowRef", flowId, alias: flowId, order: 1, required: true, inputBindings: {}, retryPolicy: { count: 0, delayMs: 0 }, failurePolicy: "stop", position: { x: 0, y: 0 } }],
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

type OcrRecord = { stepId: string; mode?: string; status?: string; verdict?: string; code: string; durationMs?: number };
type Run = { status: string; records: OcrRecord[]; hasBlock: boolean; stepStatuses: string; raw: string } | { refused: string };
const SETTLED = ["passed", "failed", "cancelled", "stopped", "completed", "error"];
const completed = (status: string) => status === "completed" || status === "passed";

async function start(win: Page, workflowId: string): Promise<string | { refused: string }> {
  const started = (await win.evaluate(
    async (id) =>
      (window as any).playwrightFlowStudio.executions.runWorkflow({ workflowId: id, dryRun: false, headless: true, totalInstances: 1, maxConcurrentInstances: 1, stopOnError: true, screenshotOnFailure: false }),
    workflowId
  )) as any;
  return started?.executionId ? String(started.executionId) : { refused: String(started?.status ?? JSON.stringify(started)).slice(0, 200) };
}

async function settle(win: Page, executionId: string, limitMs = 150_000): Promise<string> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const list = (await win.evaluate(async () => (window as any).playwrightFlowStudio.executions.list())) as any[];
    const mine = list.filter((i) => i.executionId === executionId);
    if (mine.length > 0 && mine.every((i) => SETTLED.includes(String(i.status)))) return String(mine[0].status);
    if (Date.now() > deadline) throw new Error(`execution ${executionId} did not settle within ${limitMs / 1000} s`);
    await sleep(1_000);
  }
}

async function run(win: Page, workflowId: string): Promise<Run> {
  const id = await start(win, workflowId);
  if (typeof id !== "string") return id;
  const status = await settle(win, id);
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
  const steps = (instance.steps ?? instance.stepResults ?? []) as any[];
  const stepStatuses = JSON.stringify(steps.map((s) => `${s.stepId ?? s.nodeId ?? s.id}:${s.status}`));
  return { status, records, hasBlock: instance.ocrAssertions !== undefined, stepStatuses, raw: JSON.stringify(records).slice(0, 1500) };
}

async function ocrHostPids(app: ElectronApplication): Promise<number[]> {
  return app.evaluate(({ app: electronApp }) =>
    electronApp
      .getAppMetrics()
      .filter((m) => m.type === "Utility" && /SpecterStudio OCR/.test(`${String((m as { serviceName?: string }).serviceName ?? "")} ${String(m.name ?? "")}`))
      .map((m) => m.pid)
  );
}

/** TCP connections plus UDP endpoints owned by a process, from Windows' own tables. */
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

    // ── B. Startup ────────────────────────────────────────────────────────────────────────────────────────────────
    console.log("\nB. Startup with AWKIT_VISUAL_OCR=observe");
    let launched = await launch(localAppData, { AWKIT_VISUAL_OCR: "observe" });
    app = launched.app;
    let sessionRef = await signIn(launched.win);
    check("the packaged app starts and signs in with OCR observe on", true);
    check("no OCR host is forked at startup (lazy; OCR is never a startup dependency)", (await ocrHostPids(app)).length === 0);

    console.log("\nC. Real runs on the packaged app");
    const unlicensed = await license(launched.win, sessionRef, workDir);
    if (unlicensed) {
      for (const label of [
        "C1 OCR off: disabled records, no host, a flow without OCR unchanged",
        "C2 OCR observe: the packaged engine reads the label, observe only, refusals, no host sockets, no download",
        "C3 cancellation",
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
        "every OCR step is recorded disabled with no verdict, and the run completes",
        completed(off.status) && off.records.length === OCR_STEPS.length && off.records.every((r) => r.code === "disabled" && !r.verdict),
        `${off.status} ${off.raw}`
      );
    }
    check("no OCR host was started with OCR off", (await ocrHostPids(app)).length === 0);
    const plainOff = await run(launched.win, "plain-ocr-pkg-workflow");
    if ("refused" in plainOff) check("the flow without OCR is admitted with OCR off", false, plainOff.refused);
    else check("a flow without OCR completes with no OCR block", completed(plainOff.status) && !plainOff.hasBlock, `${plainOff.status} ${plainOff.raw}`);
    await app.close().catch(() => undefined);
    app = undefined;

    // ── C2. OCR observe ───────────────────────────────────────────────────────────────────────────────────────────
    console.log("\nC2. OCR observe on the packaged engine");
    const before = new Set(files(dataRoot));
    launched = await launch(localAppData, { AWKIT_VISUAL_OCR: "observe" });
    app = launched.app;
    sessionRef = await signIn(launched.win);
    // The first run warms the host; verdicts from both runs are pooled (budget-exhausted is honest, never wrong).
    const runs: Run[] = [];
    for (let i = 0; i < 2; i += 1) {
      const r = await run(launched.win, "ocr-pkg-workflow");
      runs.push(r);
      for (const pid of await ocrHostPids(app)) seenHosts.add(pid);
    }
    const okRuns = runs.filter((r): r is Exclude<Run, { refused: string }> => !("refused" in r));
    check("both observe runs are admitted", okRuns.length === 2, runs.filter((r) => "refused" in r).map((r) => (r as { refused: string }).refused).join(" | "));
    if (okRuns.length > 0) {
      const all = okRuns.flatMap((r) => r.records);
      check(
        "observe only: every run completes, with one OCR record per step and no step failed by OCR",
        okRuns.every((r) => completed(r.status) && r.records.length === OCR_STEPS.length && r.records.every((rec) => rec.status !== "failed")),
        okRuns.map((r) => `${r.status} ${r.stepStatuses}`).join(" | ")
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
        ["ocr-card", "sensitive-input", "an expectation of card text"],
        ["ocr-cvv", "sensitive-step", "a wrapper around a cvv field"],
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
    const hosts = await ocrHostPids(app);
    check("the packaged OCR utility host ran", seenHosts.size > 0);
    const sockets = hosts.map((pid) => ({ pid, count: socketsOwnedBy(pid) }));
    check(
      "the live OCR host owns no TCP connection or UDP endpoint",
      sockets.length > 0 && sockets.every((s) => s.count === 0),
      JSON.stringify(sockets)
    );
    const plainObserve = await run(launched.win, "plain-ocr-pkg-workflow");
    if ("refused" in plainObserve) check("the flow without OCR is admitted with OCR observe", false, plainObserve.refused);
    else check("with OCR on, a flow without OCR still completes with no OCR block", completed(plainObserve.status) && !plainObserve.hasBlock, `${plainObserve.status} ${plainObserve.raw}`);
    const downloaded = files(dataRoot).filter((f) => !before.has(f) && /\.(wasm|traineddata(\.gz)?)$|tesseract/i.test(f));
    check("no engine or language data was downloaded into the profile", downloaded.length === 0, downloaded.join(", "));

    // ── C3. Cancellation ──────────────────────────────────────────────────────────────────────────────────────────
    console.log("\nC3. Cancellation");
    const cancelId = await start(launched.win, "ocr-pkg-workflow");
    if (typeof cancelId !== "string") check("the run to cancel is admitted", false, cancelId.refused);
    else {
      const visibleBy = Date.now() + 30_000;
      while (Date.now() < visibleBy) {
        const list = (await launched.win.evaluate(async () => (window as any).playwrightFlowStudio.executions.list())) as any[];
        if (list.some((i) => i.executionId === cancelId)) break;
        await sleep(200);
      }
      await launched.win.evaluate(async () => (window as any).playwrightFlowStudio.executions.stopAll());
      const stopped = await settle(launched.win, cancelId, 60_000);
      check("a stopped OCR run settles stopped or cancelled", stopped === "stopped" || stopped === "cancelled", stopped);
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

    const flowStores = [join(dataRoot, "flows"), join(dataRoot, "workflows")];
    const leaks = files(dataRoot)
      .filter((f) => !flowStores.some((store) => f.startsWith(store + sep)) && !/[\\/](Cache|Code Cache|GPUCache|Service Worker|blob_storage|browser-profiles?|chromium)[\\/]/i.test(f))
      .filter((f) => {
        try {
          if (statSync(f).size > 64 * 1024 * 1024) return false;
          const text = readFileSync(f).toString("latin1");
          return text.includes("4521") || text.includes("declined") || text.includes("4111");
        } catch {
          return false;
        }
      });
    check("no report, log, audit or other stored file outside the flow store holds an expected or recognized text", leaks.length === 0, leaks.map((f) => f.slice(dataRoot.length)).join(", "));
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
