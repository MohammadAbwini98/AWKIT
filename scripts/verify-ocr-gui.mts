/**
 * verify:ocr-gui — Phase N, N7.5 (awkit-vra.9.6): observe-only OCR assertions in the REAL Electron app with the REAL
 * offline engine (the N7.4 host and the N7.1a-qualified assets), the real Designer and the real run-detail drawer,
 * against the mock-site Image Text Assertion Lab (`/visual-intelligence/ocr`).
 *
 * The assets are staged by the production scripts/prepare-ocr-assets.mjs into a local temporary folder that the
 * development build reads through AWKIT_OCR_DEV_ASSET_DIR (this checkout's shared folder cannot initialise the engine,
 * KNOWN_ISSUES). Source build, not the packaged app: the packaged load is N7.8 / N7.1b and stays BLOCKED.
 *
 * One isolated profile, three launches:
 *   1. AWKIT_VISUAL_OCR=observe: a seeded flow (an expected label and a wrong expectation on the same element) runs
 *      headless; the real engine reads the label: matched and differs, codes only in the stored report; the OCR
 *      utility host ran; the drawer shows the Image text section as text; the Designer section shows the latest
 *      result, refuses a card number without quoting it, is reachable and operable by keyboard; an edit (match
 *      contains, expected "Payment", case sensitive) is saved through the Designer's own Save, unknown config kept;
 *   2. restart (observe): the Designer reloads the saved edit; after a warming run, the edited step reads differs on
 *      the warm host (the saved original would read matched, so the verdict proves the edit ran);
 *   3. AWKIT_VISUAL_OCR unset: the run records not evaluated (disabled) and no OCR host process exists;
 *   4-5. an altered engine byte (checksum-mismatch) and missing assets (ocr-unavailable): inconclusive, run completes.
 * Throughout: no expected or recognized text reaches a report, log, audit or other stored file outside the flow.
 *
 * Run: npm run build && npm run verify:ocr-gui
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import {
  DEFAULT_CREDS,
  isolatedLaunchEnv,
  resolveMainWindow,
  signInFirstRun
  // @ts-expect-error Shared GUI helper is intentionally plain ESM JavaScript.
} from "./lib/gui-verify-harness.mjs";
import {
  navClick,
  watchConsole
  // @ts-expect-error Shared E2E helper is intentionally plain ESM JavaScript.
} from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The Parallels share cannot start Electron's GPU process (KNOWN_ISSUES); the local copy is used when present, exactly
// as `verify:visual-assertion-gui` does, and must match the installed version.
const KNOWN_LOCAL_DIST = "C:\\electron-dist";
const dist = process.env.ELECTRON_OVERRIDE_DIST_PATH ?? (process.platform === "win32" && existsSync(path.join(KNOWN_LOCAL_DIST, "electron.exe")) ? KNOWN_LOCAL_DIST : undefined);
const installedVersion = readFileSync(path.join(root, "node_modules/electron/dist/version"), "utf8").trim();
if (dist && existsSync(path.join(dist, "version")) && readFileSync(path.join(dist, "version"), "utf8").trim() !== installedVersion) {
  console.error(`BLOCKED: the local Electron copy at ${dist} is not the installed ${installedVersion}; refresh it (KNOWN_ISSUES).`);
  process.exit(1);
}
const executablePath = dist ? path.join(dist, "electron.exe") : undefined;
const { env: baseEnv, electronArgs, dataRoot, cleanup } = isolatedLaunchEnv("awkit-ocr-gui");
const installedBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : undefined);
const browsersEnv = installedBrowsers && existsSync(installedBrowsers) ? { PLAYWRIGHT_BROWSERS_PATH: installedBrowsers } : {};
const offEnv: NodeJS.ProcessEnv = { ...baseEnv, ...browsersEnv };
delete offEnv.AWKIT_VISUAL_OCR;
delete offEnv.AWKIT_OCR_DEV_ASSET_DIR;
// Staged on local disk: on this workspace's shared folder the engine cannot initialise (KNOWN_ISSUES), so the
// development build is pointed at a local staging through its development-only override.
const STAGE = mkdtempSync(path.join(tmpdir(), "awkit-ocr-gui-assets-"));
const ASSET_DIR = path.join(STAGE, "ocr");
const TAMPERED_DIR = path.join(STAGE, "tampered");
const observeEnv: NodeJS.ProcessEnv = { ...offEnv, AWKIT_VISUAL_OCR: "observe", AWKIT_OCR_DEV_ASSET_DIR: ASSET_DIR };
const appData = path.join(dataRoot, "SpecterStudio");
const PASSWORD: string = DEFAULT_CREDS.password;
const FLOW_ID = "ocr-gui-flow";
const WORKFLOW_ID = "ocr-gui-workflow";
const LABEL_STEP = "ocr-label";
const WRONG_STEP = "ocr-wrong";
/** The step the Designer edits; it runs after the host is warm. */
const AGAIN_STEP = "ocr-again";
const AGAIN_NAME = "Observe the label again";
const EXPECTED = "Order 4521 shipped";
const WRONG = "Payment declined today";
const DEBUG = path.join(tmpdir(), "awkit-ocr-gui-debug");

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string | null): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    try {
      if (statSync(p).isDirectory()) out.push(...files(p));
      else out.push(p);
    } catch {
      // An atomic write's temporary file can vanish between the listing and the stat.
    }
  }
  return out;
}

/** Every stored file of the app's own data outside the flow store (where the schema keeps the expected text). */
function leakedTextFiles(): string[] {
  const flowStores = [path.join(appData, "flows"), path.join(appData, "workflows")];
  return files(appData)
    .filter((f) => !flowStores.some((store) => f.startsWith(store + path.sep)) && !/[\\/](Cache|Code Cache|GPUCache|Service Worker|blob_storage|browser-profiles?|chromium)[\\/]/i.test(f))
    .filter((f) => {
      try {
        if (statSync(f).size > 64 * 1024 * 1024) return false;
        const text = readFileSync(f).toString("latin1");
        return text.includes("4521") || text.includes("declined");
      } catch {
        return false;
      }
    });
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

const port = await freePort();
const LAB = `http://127.0.0.1:${port}/visual-intelligence/ocr`;

function flowProfile() {
  const now = new Date().toISOString();
  const observeStep = (id: string, name: string, value: string) => ({
    id,
    type: "assertImageText",
    name,
    locator: { strategy: "testId", value: "oc-label" },
    value,
    valueSource: { type: "static", value },
    timeoutMs: 15000,
    // An unknown config key from a newer build: the Designer must carry it through a save.
    config: { ocrMatch: "normalized", futureOcrSetting: 7 }
  });
  return {
    id: FLOW_ID,
    name: "OCR GUI flow",
    description: "N7.5 acceptance: observe-only image text assertions on the Image Text Assertion Lab label.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: "start", type: "start", name: "Start" },
      { id: "open-lab", type: "goto", name: "Open the lab", url: LAB, valueSource: { type: "static", value: LAB }, timeoutMs: 30000 },
      observeStep(LABEL_STEP, "Observe the label", EXPECTED),
      observeStep(WRONG_STEP, "Observe a wrong text", WRONG),
      observeStep(AGAIN_STEP, AGAIN_NAME, EXPECTED),
      { id: "end", type: "end", name: "End" }
    ],
    edges: [
      { id: "e1", source: "start", target: "open-lab", type: "success" },
      { id: "e2", source: "open-lab", target: LABEL_STEP, type: "success" },
      { id: "e3", source: LABEL_STEP, target: WRONG_STEP, type: "success" },
      { id: "e4", source: WRONG_STEP, target: AGAIN_STEP, type: "success" },
      { id: "e5", source: AGAIN_STEP, target: "end", type: "success" }
    ]
  };
}
function writeJson(dir: string, name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
writeJson(path.join(appData, "flows"), `${FLOW_ID}.json`, flowProfile());
writeJson(path.join(appData, "workflows"), `${WORKFLOW_ID}.json`, {
  id: WORKFLOW_ID,
  name: "OCR GUI workflow",
  description: "Runs the N7.5 acceptance flow once.",
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  nodes: [{ id: "ref", type: "flowRef", flowId: FLOW_ID, alias: "OCR flow", order: 1, required: true, inputBindings: {}, retryPolicy: { count: 0, delayMs: 0 }, failurePolicy: "stop", position: { x: 0, y: 0 } }],
  edges: [],
  runtimeInputs: [],
  execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true }
});

type Record_ = { stepId: string; flowId: string; mode: string; status: string; verdict?: string; code: string; distanceBucket?: string; confidenceBucket?: string; charCount?: number; durationMs: number };

let lastInstances = "";
/** Run the workflow headless once; returns the instance status and the stored report's OCR block. */
async function run(win: Page): Promise<{ status: string; records: Record_[]; raw: string }> {
  const started = await win.evaluate(async (workflowId) => {
    const r = await window.playwrightFlowStudio.executions.runWorkflow({
      workflowId,
      dryRun: false,
      headless: true,
      totalInstances: 1,
      maxConcurrentInstances: 1,
      isolationMode: "browserContext",
      stopOnError: true,
      screenshotOnFailure: false
    });
    return JSON.stringify(r);
  }, WORKFLOW_ID);
  const executionId = (JSON.parse(started) as { executionId?: string } | null)?.executionId ?? "";
  const deadline = Date.now() + 120_000;
  let status = "";
  for (;;) {
    const seen = await win.evaluate(async () => JSON.stringify(await window.playwrightFlowStudio.executions.list()));
    const mine = (JSON.parse(seen) as { executionId?: string; status?: string }[]).filter((i) => i.executionId === executionId);
    if (mine.length > 0 && mine.every((i) => ["passed", "failed", "cancelled", "stopped", "completed", "error"].includes(String(i.status)))) {
      status = String(mine[0].status);
      lastInstances = JSON.stringify(mine.map((i) => Object.fromEntries(Object.entries(i).filter(([k]) => /status|step|error|reason|message|fail/i.test(k))))).slice(0, 1500);
      break;
    }
    if (Date.now() > deadline) throw new Error(`the workflow run did not finish within 120 s (started: ${started.slice(0, 300)})`);
    // Unhurried polling: the run shares the main process with this IPC.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const raw = await win.evaluate(async (id) => {
    const end = Date.now() + 15_000;
    for (;;) {
      const report = (await window.playwrightFlowStudio.reports.get(id)) as { instances?: { ocrAssertions?: unknown[] }[] } | null;
      const block = report?.instances?.[0]?.ocrAssertions;
      if (block || Date.now() > end) return JSON.stringify(block ?? null);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }, executionId);
  return { status, records: (JSON.parse(raw) as Record_[] | null) ?? [], raw };
}
const byStep = (records: Record_[], stepId: string) => records.find((r) => r.stepId === stepId);
/** An instance that ran to its end: the live list reports `completed` (older paths `passed`). */
const succeeded = (status: string) => status === "completed" || status === "passed";
const describe = (r?: Record_) => (r ? `${r.verdict ?? "-"}/${r.code} ${r.distanceBucket ?? ""} ${r.confidenceBucket ?? ""} chars=${r.charCount ?? "-"} ${r.durationMs}ms` : "no record");

async function ocrHosts(electronApp: ElectronApplication): Promise<number> {
  // The service name is the generic Node service; the host's own label is the process name.
  return electronApp.evaluate(({ app }) => app.getAppMetrics().filter((m) => m.type === "Utility" && /SpecterStudio OCR/.test(`${String((m as { serviceName?: string }).serviceName ?? "")} ${String(m.name ?? "")}`)).length);
}
/** Diagnostics for a failed check: the utility processes the app reports, and child-process exits it logged. */
async function hostDiagnostics(electronApp: ElectronApplication): Promise<string> {
  const utilities = await electronApp.evaluate(({ app }) =>
    app
      .getAppMetrics()
      .filter((m) => m.type === "Utility")
      .map((m) => `${m.pid}:${String((m as { serviceName?: string }).serviceName ?? "")}:${String(m.name ?? "")}`)
  );
  const gone = files(appData)
    .filter((f) => /debug|log/i.test(f) && /\.(log|jsonl?|txt)$/i.test(f))
    .flatMap((f) => {
      try {
        return readFileSync(f, "utf8").split("\n").filter((line) => /Electron child process terminated|SpecterStudio OCR/.test(line)).map((line) => line.slice(0, 400));
      } catch {
        return [];
      }
    })
    .slice(-6);
  const ocrLines = mainErrors.filter((line) => line.includes("[ocr]")).slice(-6);
  return `utilities=[${utilities.join(", ")}] exits=[${gone.join(" | ")}] ocr=[${ocrLines.join(" | ").slice(0, 600)}]`;
}

async function openDesigner(win: Page, stepName: string): Promise<void> {
  await navClick(win, "Flow Designer");
  await win.getByRole("button", { name: "Saved flow" }).click();
  await win.getByRole("option", { name: "OCR GUI flow" }).click();
  const node = win.getByText(stepName, { exact: true }).first();
  const visible = await node.waitFor({ state: "visible", timeout: 15_000 }).then(
    () => true,
    () => false
  );
  if (!visible) {
    await win.screenshot({ path: `${DEBUG}.designer.png` });
    throw new Error(`the assertImageText node is not on the canvas (screenshot: ${DEBUG}.designer.png)`);
  }
  await node.click();
  await win.getByTestId("image-text-section").waitFor({ state: "visible", timeout: 20_000 });
}

async function openDrawer(win: Page): Promise<string> {
  await navClick(win, "Reports");
  await navClick(win, "Instance Reports");
  await win.getByRole("button", { name: "Details" }).first().click();
  const drawer = win.getByRole("dialog", { name: "Run detail" });
  await drawer.waitFor({ state: "visible", timeout: 15_000 });
  const section = drawer.getByTestId("image-text-report-section");
  const shown = await section.waitFor({ state: "visible", timeout: 15_000 }).then(
    () => true,
    () => false
  );
  return shown ? (await section.innerText()).replace(/\s+/g, " ") : "";
}

let electronApp: ElectronApplication | undefined;
let server: ChildProcess | undefined;
/** Every real-engine observation, for the measured OC-9 line (N7.6 owns the budget; this verifier only reports it). */
const measured: Record_[] = [];
let rightOrTimedOut: (r?: Record_) => boolean = () => false;
const mainErrors: string[] = [];

async function launch(first: boolean, env: NodeJS.ProcessEnv): Promise<Page> {
  electronApp = await electron.launch({ args: [root, ...electronArgs], cwd: root, env: env as Record<string, string>, ...(executablePath ? { executablePath } : {}) });
  electronApp.process().stderr?.on("data", (chunk: Buffer) => mainErrors.push(chunk.toString().trim()));
  electronApp.process().stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes("[ocr]")) mainErrors.push(text.trim());
  });
  const win: Page = await resolveMainWindow(electronApp, 120_000);
  await win.waitForLoadState("domcontentloaded");
  if (first) await signInFirstRun(win);
  else {
    await win.waitForSelector(".awkit-login-form", { timeout: 30_000 });
    await win.fill("#awkit-login-username", DEFAULT_CREDS.username);
    await win.locator('.awkit-login-form input[type="password"]').first().fill(PASSWORD);
    await win.getByRole("button", { name: "Sign in", exact: true }).click();
    await win.waitForSelector(".app-shell", { timeout: 25_000 });
  }
  return win;
}
async function close(): Promise<void> {
  await electronApp?.close().catch(() => undefined);
  electronApp = undefined;
}

try {
  console.log("Staging the qualified OCR assets for the development build");
  const staged = spawnSync(process.execPath, [path.join(root, "scripts", "prepare-ocr-assets.mjs"), "--out", ASSET_DIR], { cwd: root, encoding: "utf8", timeout: 120_000 });
  check("the production staging script staged the qualified assets into a local folder", staged.status === 0, `${staged.stderr}`.trim().slice(0, 300));
  mkdirSync(TAMPERED_DIR);
  for (const file of readdirSync(ASSET_DIR)) copyFileSync(path.join(ASSET_DIR, file), path.join(TAMPERED_DIR, file));
  const wasm = readdirSync(TAMPERED_DIR).find((f) => f.endsWith(".wasm"));
  if (wasm) {
    const bytes = readFileSync(path.join(TAMPERED_DIR, wasm));
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(path.join(TAMPERED_DIR, wasm), bytes);
  }
  check("a copy with one altered engine byte was prepared for the fail-closed launch", !!wasm);

  server = spawn(process.execPath, ["mock-site/server.mjs"], { cwd: root, env: { ...process.env, MOCK_SITE_PORT: String(port) }, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 100; i += 1) {
    if (await fetch(LAB).then((r) => r.ok, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // ── Launch 1: observe, the real engine ───────────────────────────────────────────────────────
  console.log("\n1. OCR observe: the real engine, the stored report, the drawer and the Designer");
  let win = await launch(true, observeEnv);
  const console_ = watchConsole(win);
  console_.setLabel("launch 1");
  const admission = await win.evaluate(async (workflowId) => JSON.stringify(await window.playwrightFlowStudio.executions.validate(workflowId)), WORKFLOW_ID);
  check("the seeded flow with two assertImageText steps is runnable", (JSON.parse(admission) as { valid?: boolean }).valid === true, admission.slice(0, 400));
  check("no OCR host runs before the first assertion (lazy)", (await ocrHosts(electronApp!)) === 0);

  // A fresh app starts the host cold inside the first assertion's own 1.5 s deadline (OC-9: spawned on first use), and
  // in this VM the guarded capture alone takes 0.65-1.0 s: the warming run is reported as measured, never as a verdict
  // it did not reach. A verdict it does reach must be the right one.
  const warmup = await run(win);
  const expectedVerdict: Record<string, "matched" | "differs"> = { [LABEL_STEP]: "matched", [WRONG_STEP]: "differs", [AGAIN_STEP]: "matched" };
  rightOrTimedOut = (r?: Record_) => !!r && (r.verdict === expectedVerdict[r.stepId] || (r.verdict === "inconclusive" && r.code === "budget-exhausted"));
  check("the warming run completes: observe never fails it", succeeded(warmup.status), `${warmup.status} ${lastInstances}`);
  check(
    "every warming observation is the right verdict or honestly budget-exhausted, never a wrong one",
    warmup.records.length === 3 && warmup.records.every(rightOrTimedOut),
    `${warmup.records.map((r) => `${r.stepId} ${describe(r)}`).join(" | ")} ${await hostDiagnostics(electronApp!)}`
  );
  console.log(`    (warming run: ${warmup.records.map((r) => `${r.stepId} ${describe(r)}`).join(" | ")})`);

  const first = await run(win);
  check("the warm run completes: observe never fails it", succeeded(first.status), `${first.status} ${lastInstances}`);
  check(
    "on the warm host every observation is the right verdict or honestly budget-exhausted, never a wrong one",
    first.records.length === 3 && first.records.every(rightOrTimedOut),
    first.records.map((r) => `${r.stepId} ${describe(r)}`).join(" | ")
  );
  console.log(`    (warm run: ${first.records.map((r) => `${r.stepId} ${describe(r)}`).join(" | ")})`);
  const launch1 = [...warmup.records, ...first.records];
  check(
    "the real engine read the label as matched (text-matched) and the wrong expectation as differs (text-differs) in this launch",
    launch1.some((r) => r.stepId !== WRONG_STEP && r.code === "text-matched") && launch1.some((r) => r.stepId === WRONG_STEP && r.code === "text-differs"),
    launch1.map((r) => `${r.stepId} ${describe(r)}`).join(" | ")
  );
  check("each observation stayed within the 1.5 s deadline (plus the settle margin)", launch1.every((r) => r.durationMs <= 1_500 + 200), launch1.map((r) => r.durationMs).join(", "));
  measured.push(...launch1);
  check("the stored block is codes only (no expected or recognized text, selector or URL)", !/4521|Order|shipped|declined|Payment|oc-label|data-testid|http/.test(first.raw) && first.records.every((r) => Object.keys(r).every((k) => ["version", "stepId", "flowId", "mode", "status", "verdict", "code", "distanceBucket", "confidenceBucket", "charCount", "durationMs"].includes(k))), first.raw);
  check("the OCR utility host ran in its own process", (await ocrHosts(electronApp!)) === 1, await hostDiagnostics(electronApp!));

  const drawerText = await openDrawer(win);
  check(
    "the drawer shows Image text as text: totals, every observation and its exact code",
    new RegExp(
      `This instance: 3 image text assertions \\(observe only\\) — ${first.records.filter((r) => r.verdict === "matched").length} matched, ${first.records.filter((r) => r.verdict === "differs").length} different, ${first.records.filter((r) => r.verdict === "inconclusive").length} without a verdict`
    ).test(drawerText) && first.records.every((r) => drawerText.includes(`Reason code ${r.code}`)),
    drawerText.slice(0, 500)
  );
  check("the drawer never shows the expected or the recognized text", drawerText.length > 0 && !/4521|Order|shipped|declined|Payment/.test(drawerText), drawerText.slice(0, 300));
  const a11y = await win.getByTestId("image-text-report-section").evaluate((section) => ({
    media: section.querySelectorAll("img, canvas, picture, video").length,
    unhidden: [...section.querySelectorAll("svg")].filter((icon) => icon.getAttribute("aria-hidden") !== "true").length,
    focusables: section.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').length,
    headed: !!section.getAttribute("aria-labelledby") && !!document.getElementById(section.getAttribute("aria-labelledby") ?? "")
  }));
  check("the drawer section has a heading, no image, decorative icons and nothing focusable", a11y.headed && a11y.media === 0 && a11y.unhidden === 0 && a11y.focusables === 0, JSON.stringify(a11y));
  await win.keyboard.press("Escape");

  await openDesigner(win, AGAIN_NAME);
  const section = win.getByTestId("image-text-section");
  check("the Designer shows the Image text section for the step", (await section.count()) === 1);
  check("its match mode reads normalized and there is no enforce option", (await win.getByTestId("image-text-match").inputValue()) === "normalized" && (await win.locator('[data-testid="image-text-match"] option[value="enforce"]').count()) === 0);
  check("it explains observe only and names the switch", /Observe only/.test(await win.getByTestId("image-text-observe").innerText()) && /AWKIT_VISUAL_OCR=observe/.test(await win.getByTestId("image-text-observe").innerText()));
  const latestCode = byStep(first.records, AGAIN_STEP)?.code ?? "none";
  check(
    "it states the step's latest recorded result as text with its exact code",
    (await win
      .waitForFunction((code) => document.querySelector('[data-testid="image-text-latest"]')?.getAttribute("data-code") === code, latestCode, { timeout: 15_000 })
      .then(
        () => true,
        () => false
      )) && (await win.getByTestId("image-text-latest").innerText()).includes(`Reason code ${latestCode}`),
    `${latestCode}: ${await win.getByTestId("image-text-latest").innerText().catch(() => "")}`
  );
  check("the latest line never shows the expected or the recognized text", !/4521|Order|shipped/.test(await win.getByTestId("image-text-latest").innerText()));

  const textValue = win.getByLabel("Text Value");
  await textValue.fill("4111 1111 1111 1111");
  const problems = win.getByTestId("image-text-problems");
  const refused = await problems.waitFor({ state: "visible", timeout: 10_000 }).then(
    () => true,
    () => false
  );
  const problemText = refused ? await problems.innerText() : "";
  check("a card number as the expected text is refused in the section (OC-8), without quoting it", refused && /card number/.test(problemText) && !/4111/.test(problemText), problemText);
  check("the refusal is announced politely and is a list item with its code", (await problems.getAttribute("aria-live")) === "polite" && (await problems.locator('li[data-code="sensitive"]').count()) === 1);

  // Keyboard: from the expected text, Tab reaches the match control; arrows change it; Space toggles case.
  // The edit must be observable in a run: the saved expectation reads matched, the edited one (contains "Payment")
  // can only read differs.
  await textValue.fill("Payment");
  await textValue.focus();
  let reached = false;
  for (let i = 0; i < 20 && !reached; i += 1) {
    await win.keyboard.press("Tab");
    reached = await win.evaluate(() => document.activeElement?.getAttribute("data-testid") === "image-text-match");
  }
  check("the match control is reachable by Tab from the expected text", reached);
  for (let i = 0; i < 3 && (await win.getByTestId("image-text-match").inputValue()) !== "contains"; i += 1) await win.keyboard.press("ArrowDown");
  check("arrow keys set the match mode to contains", (await win.getByTestId("image-text-match").inputValue()) === "contains");
  await win.keyboard.press("Tab");
  const caseFocused = await win.evaluate(() => document.activeElement?.getAttribute("data-testid") === "image-text-case");
  const caseBefore = await win.getByTestId("image-text-case").isChecked();
  await win.keyboard.press("Space");
  check("Tab then Space turns case sensitivity on", caseFocused && !caseBefore && (await win.getByTestId("image-text-case").isChecked()));
  const motion = await section.evaluate((el) => [el, ...el.querySelectorAll("*")].every((n) => getComputedStyle(n).animationName === "none"));
  check("nothing in the section animates", motion);
  check("with a valid edit no validation message remains", (await win.getByTestId("image-text-problems").count()) === 0);

  await win.locator(".top-header .header-actions").getByRole("button", { name: "Save", exact: true }).click();
  const saved = await win.getByText(/Flow saved successfully/).first().waitFor({ state: "visible", timeout: 15_000 }).then(
    () => true,
    () => false
  );
  check("the Designer's own Save saves the flow", saved);
  const stored = await win.evaluate(async ([flowId, stepId]) => JSON.stringify((await window.playwrightFlowStudio.flows.get(flowId))?.nodes?.find((n) => n.id === stepId) ?? null), [FLOW_ID, AGAIN_STEP] as const);
  const storedStep = JSON.parse(stored) as { value?: string; mode?: string; valueSource?: { value?: string }; config?: Record<string, unknown> } | null;
  check(
    "the saved step holds the edit: contains, case sensitive, expected Payment",
    storedStep?.config?.ocrMatch === "contains" && storedStep.config.ocrCaseSensitive === true && storedStep.value === "Payment",
    stored
  );
  check("the save kept the unknown config key and wrote no mode", storedStep?.config?.futureOcrSetting === 7 && storedStep.mode === undefined, stored);
  const errors1 = console_.errors ?? [];
  check("no renderer error was logged in launch 1", errors1.length === 0, JSON.stringify(errors1).slice(0, 400));
  await close();

  // ── Launch 2: restart, reload the edit, run it ───────────────────────────────────────────────
  console.log("\n2. Restart: the Designer reloads the saved edit, and it runs");
  win = await launch(false, observeEnv);
  await openDesigner(win, AGAIN_NAME);
  check("after a restart the Designer shows contains and case sensitive", (await win.getByTestId("image-text-match").inputValue()) === "contains" && (await win.getByTestId("image-text-case").isChecked()));
  check("...and the expected text Payment", (await win.getByLabel("Text Value").inputValue()) === "Payment");
  // A fresh app starts the host cold: this first run warms it; a verdict it reaches must still be the edited one.
  const warming = await run(win);
  const warmingEdited = byStep(warming.records, AGAIN_STEP);
  check(
    "the warming run completes and the edited step reads differs or honestly budget-exhausted, never matched",
    succeeded(warming.status) && !!warmingEdited && (warmingEdited.code === "text-differs" || warmingEdited.code === "budget-exhausted"),
    describe(warmingEdited)
  );
  console.log(`    (warming run: ${warming.records.map((r) => `${r.stepId} ${describe(r)}`).join(" | ")})`);
  const second = await run(win);
  console.log(`    (warm run: ${second.records.map((r) => `${r.stepId} ${describe(r)}`).join(" | ")})`);
  const edited = [warmingEdited, byStep(second.records, AGAIN_STEP)].filter((r): r is Record_ => !!r);
  check(
    "the reloaded edit runs: contains Payment reads differs (the saved original would read matched), and never matched",
    succeeded(second.status) && edited.some((r) => r.code === "text-differs") && edited.every((r) => r.code === "text-differs" || r.code === "budget-exhausted"),
    edited.map((r) => describe(r)).join(" | ")
  );
  check(
    "the other steps' observations are the right verdict or honestly budget-exhausted",
    [...warming.records, ...second.records].filter((r) => r.stepId !== AGAIN_STEP).every(rightOrTimedOut),
    [...warming.records, ...second.records].map((r) => `${r.stepId} ${describe(r)}`).join(" | ")
  );
  measured.push(...warming.records, ...second.records);
  await close();

  // ── Launch 3: OCR off ────────────────────────────────────────────────────────────────────────
  console.log("\n3. OCR off: not evaluated, no host");
  win = await launch(false, offEnv);
  const third = await run(win);
  check("with AWKIT_VISUAL_OCR unset every step is recorded not evaluated (disabled) and the run completes", succeeded(third.status) && third.records.length === 3 && third.records.every((r) => r.code === "disabled" && !r.verdict), third.raw);
  check("no OCR host process was started", (await ocrHosts(electronApp!)) === 0);
  const offDrawer = await openDrawer(win);
  check("the drawer says the assertions were not evaluated because OCR is off", /3 not evaluated/.test(offDrawer) && /AWKIT_VISUAL_OCR/.test(offDrawer), offDrawer.slice(0, 400));
  await win.keyboard.press("Escape");
  await close();

  // ── Launches 4 and 5: the assets altered or missing, in the real app ─────────────────────────
  console.log("\n4. Altered and missing assets fail closed in the real app");
  win = await launch(false, { ...observeEnv, AWKIT_OCR_DEV_ASSET_DIR: TAMPERED_DIR });
  const tampered = await run(win);
  check(
    "an altered engine is refused (checksum-mismatch, inconclusive) and the run completes",
    succeeded(tampered.status) && tampered.records.length === 3 && tampered.records.every((r) => r.verdict === "inconclusive" && ["checksum-mismatch", "budget-exhausted"].includes(r.code)) && tampered.records.some((r) => r.code === "checksum-mismatch"),
    `${tampered.raw} ${await hostDiagnostics(electronApp!)}`
  );
  await close();
  win = await launch(false, { ...observeEnv, AWKIT_OCR_DEV_ASSET_DIR: path.join(STAGE, "absent") });
  const missing = await run(win);
  check(
    "missing assets mean OCR is not included: ocr-unavailable, inconclusive, and the run completes",
    succeeded(missing.status) && missing.records.length === 3 && missing.records.every((r) => r.verdict === "inconclusive" && r.code === "ocr-unavailable"),
    missing.raw
  );
  check("no OCR host process was started without assets", (await ocrHosts(electronApp!)) === 0);
  await close();

  const leaks = leakedTextFiles();
  check("no report, log, audit, telemetry or other stored file outside the flow store holds an expected or recognized text", leaks.length === 0, leaks.map((f) => path.relative(dataRoot, f)).join(", "));
} catch (error) {
  failed += 1;
  console.error(`  ✗ unexpected error — ${error instanceof Error ? error.stack : String(error)}`);
  const tail = mainErrors.filter(Boolean).slice(-8);
  if (tail.length) console.error(`    main process stderr (last ${tail.length}): ${tail.join(" | ").slice(0, 1200)}`);
} finally {
  await close();
  server?.kill();
  rmSync(STAGE, { recursive: true, force: true });
  try {
    cleanup();
  } catch {
    /* a Windows file lock on the temp profile is not a product failure */
  }
}

// The deadline contract (N7.5): a verdict is never recorded after 1500 ms, whatever the latency target says.
check(
  "no real-engine verdict was recorded after the 1500 ms deadline",
  measured.length > 0 && measured.every((r) => (r.verdict !== "matched" && r.verdict !== "differs") || r.durationMs <= 1_500),
  measured.filter((r) => r.verdict === "matched" || r.verdict === "differs").map((r) => `${r.stepId}:${r.durationMs}`).join(" ")
);
if (measured.length > 0) {
  const durations = measured.map((r) => r.durationMs).sort((a, b) => a - b);
  const at = (q: number) => durations[Math.min(durations.length - 1, Math.ceil(q * durations.length) - 1)];
  const verdicts = measured.filter((r) => r.code !== "budget-exhausted").length;
  // Reported, not gated: OC-9 targets are measured claims for N7.6 on the reference machine.
  console.log(
    `\nMEASURED (OC-9, source build in this VM, not a gate here): ${verdicts} of ${measured.length} real-engine observations reached a verdict within the 1500 ms deadline; ` +
      `${measured.length - verdicts} budget-exhausted; duration p50 ${at(0.5)} ms, p95 ${at(0.95)} ms (target p95 <= 1000 ms: ${at(0.95) <= 1000 ? "met" : "MISSED"}).`
  );
}
console.log(`\nverify:ocr-gui — ${passed} passed, ${failed} failed`);
if (passed === 0) failed += 1;
process.exit(failed === 0 ? 0 : 1);
