/**
 * verify:visual-assertion-gui — Phase N, N6.5 (awkit-vra.15.5): the pending-baseline approval surface in the real
 * Electron app, with the real Electron `safeStorage` key protector, the real `visualAssertion:*` channels and the real
 * Designer section, against the mock-site Visual Assertion Lab (`/visual-intelligence/assertion`).
 *
 * One isolated profile, five launches:
 *   1. first run: capabilities, a real observe run makes a candidate, Designer preview and approval through the
 *      re-authentication dialog, the first key file, replay, a matching re-run, stale epoch (import), stale content
 *      (edit), rejection, reset through the confirmation dialog and key rotation, approval under the new key;
 *   2. restart: the approval and key survive, a matching run makes no candidate;
 *   3. key loss (key file removed, marker kept): no candidate is approvable, reset through the Designer recovers;
 *   4. a tampered baseline record: the run reports it unreadable and a new approval replaces it;
 *   5. a tampered key: integrity is unavailable until a reset; the audit trail; signed out, every channel refuses.
 * Throughout: no digest, token or key reaches the renderer, and no preview pixels are written to disk.
 *
 * The packaged build (observe only, an imported enforce step shown unavailable) cannot be launched from source; it
 * is pinned statically by `verify:visual-assertion-candidates` and its run-time refusal by
 * `verify:visual-assertion-runtime`.
 *
 * Run: npm run build && npm run verify:visual-assertion-gui
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
// as `verify:visual-key-protector-live` does, and must match the installed version.
const KNOWN_LOCAL_DIST = "C:\\electron-dist";
const dist = process.env.ELECTRON_OVERRIDE_DIST_PATH ?? (process.platform === "win32" && existsSync(path.join(KNOWN_LOCAL_DIST, "electron.exe")) ? KNOWN_LOCAL_DIST : undefined);
const installedVersion = readFileSync(path.join(root, "node_modules/electron/dist/version"), "utf8").trim();
if (dist && existsSync(path.join(dist, "version")) && readFileSync(path.join(dist, "version"), "utf8").trim() !== installedVersion) {
  console.error(`BLOCKED: the local Electron copy at ${dist} is not the installed ${installedVersion}; refresh it (KNOWN_ISSUES).`);
  process.exit(1);
}
const executablePath = dist ? path.join(dist, "electron.exe") : undefined;
const { env: baseEnv, electronArgs, dataRoot, cleanup } = isolatedLaunchEnv("awkit-visual-assertion-gui");
// The isolated LOCALAPPDATA hides the installed Playwright browsers (`%LOCALAPPDATA%\ms-playwright`); point the run at
// them so the instance launches the same Chromium a developer run would.
const installedBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : undefined);
const env = {
  ...baseEnv,
  AWKIT_VISUAL_ASSERTIONS: "observe",
  ...(installedBrowsers && existsSync(installedBrowsers) ? { PLAYWRIGHT_BROWSERS_PATH: installedBrowsers } : {})
};
const appData = path.join(dataRoot, "SpecterStudio");
const PASSWORD: string = DEFAULT_CREDS.password;
const FLOW_ID = "va-gui-flow";
const WORKFLOW_ID = "va-gui-workflow";
const STEP_ID = "va-assert";
/** Failure diagnostics (the last report, a Designer screenshot) land here, outside the profile that is cleaned up. */
const DEBUG = path.join(tmpdir(), "awkit-va-gui-debug");

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
const baselineFiles = () => files(dataRoot).filter((f) => f.includes(`${path.sep}visual-baselines${path.sep}`));
const keyFile = () => baselineFiles().find((f) => f.endsWith(`${path.sep}master-key.json`));
const markerGeneration = (): number | null => {
  const marker = baselineFiles().find((f) => f.endsWith(`${path.sep}key-state.json`));
  return marker ? (JSON.parse(readFileSync(marker, "utf8")) as { generation: number }).generation : null;
};
const reportCount = () => files(path.join(appData, "reports")).filter((f) => f.endsWith(".json")).length;
const previewFilesOnDisk = () => files(dataRoot).filter((f) => /\.(png|jpe?g|webp|bmp)$/i.test(f) && !f.includes(`${path.sep}Roaming${path.sep}`));

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
const LAB = `http://127.0.0.1:${port}/visual-intelligence/assertion`;

function assertStep(locator: Record<string, unknown>) {
  return { id: STEP_ID, type: "assertVisual", name: "Assert the card", mode: "observe", locator, timeoutMs: 15000 };
}
function flowProfile(locator: Record<string, unknown> = { strategy: "testId", value: "va-card" }) {
  const now = new Date().toISOString();
  return {
    id: FLOW_ID,
    name: "VA GUI flow",
    description: "N6.5 acceptance: one observe visual assertion on the Visual Assertion Lab card.",
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: "start", type: "start", name: "Start" },
      { id: "open-lab", type: "goto", name: "Open the lab", url: LAB, valueSource: { type: "static", value: LAB }, timeoutMs: 30000 },
      assertStep(locator),
      { id: "end", type: "end", name: "End" }
    ],
    edges: [
      { id: "e1", source: "start", target: "open-lab", type: "success" },
      { id: "e2", source: "open-lab", target: STEP_ID, type: "success" },
      { id: "e3", source: STEP_ID, target: "end", type: "success" }
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
  name: "VA GUI workflow",
  description: "Runs the N6.5 acceptance flow once.",
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  nodes: [{ id: "ref", type: "flowRef", flowId: FLOW_ID, alias: "VA flow", order: 1, required: true, inputBindings: {}, retryPolicy: { count: 0, delayMs: 0 }, failurePolicy: "stop", position: { x: 0, y: 0 } }],
  edges: [],
  runtimeInputs: [],
  execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true }
});

type Summary = { candidateId: string; flowId: string; stepId: string; reason: string; runUsername: string } & Record<string, unknown>;

const SECRET_KEYS = /"(contentDigest|stepContentDigest|epoch|commitment|rgba|preview|key|keyGeneration|initiator|conditions|geometry)"\s*:/;

async function list(win: Page): Promise<{ ok: boolean; code: string; candidates: Summary[]; raw: string }> {
  return win.evaluate(async (flowId) => {
    const r = await window.playwrightFlowStudio.visualAssertions.listCandidates({ flowId });
    return { ...(r as unknown as { ok: boolean; code: string; candidates: Summary[] }), raw: JSON.stringify(r) };
  }, FLOW_ID);
}
async function call(win: Page, method: "approveCandidate" | "rejectCandidate" | "previewCandidate", id: string): Promise<{ ok: boolean; code: string }> {
  return win.evaluate(
    async ([m, candidateId]) => {
      const r = await (window.playwrightFlowStudio.visualAssertions as unknown as Record<string, (id: string) => Promise<{ ok: boolean; code: string }>>)[m](candidateId);
      return { ok: r.ok, code: r.code };
    },
    [method, id] as const
  );
}
let lastInstances = "";
let lastExecutionId = "";
/** Run the workflow headless once and wait for its instance to settle. */
async function run(win: Page): Promise<void> {
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
  const executionId = (JSON.parse(started) as { executionId?: string } | null)?.executionId;
  lastExecutionId = executionId ?? "";
  // The report file is written at start with no instances; the live instance list is what settles.
  const deadline = Date.now() + 90_000;
  let seen = "[]";
  for (;;) {
    seen = await win.evaluate(async () => JSON.stringify(await window.playwrightFlowStudio.executions.list()));
    const mine = (JSON.parse(seen) as { executionId?: string; status?: string }[]).filter((i) => i.executionId === executionId);
    if (mine.length > 0 && mine.every((i) => ["passed", "failed", "cancelled", "stopped", "completed", "error"].includes(String(i.status)))) {
      lastInstances = JSON.stringify(
        mine.map((i) => {
          const log = (i as { paths?: { logs?: string } }).paths?.logs;
          const tail = log && existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").slice(-4).map((l) => l.slice(0, 400)) : [];
          return { ...Object.fromEntries(Object.entries(i).filter(([k]) => /status|step|error|reason|message|fail/i.test(k))), tail };
        })
      ).slice(0, 2500);
      return;
    }
    if (Date.now() > deadline) throw new Error(`the workflow run did not finish within 90 s (started: ${started.slice(0, 300)}; list: ${seen.slice(0, 600)})`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
/** The newest report's instance outcomes, for a failure message (no step payloads). */
function lastRunOutcome(): string {
  const reports = files(path.join(appData, "reports"))
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (reports.length === 0) return "no report";
  const text = readFileSync(reports[0], "utf8");
  writeFileSync(`${DEBUG}.report.json`, text, "utf8");
  const report = JSON.parse(text) as Record<string, unknown>;
  return `${path.basename(reports[0])} keys=${Object.keys(report).join(",")} status=${String(report.status)} error=${String(report.error ?? "").slice(0, 200)}`;
}
async function candidateAfterRun(win: Page): Promise<Summary | undefined> {
  await run(win);
  const found = (await list(win)).candidates.find((c) => c.stepId === STEP_ID);
  if (!found && lastInstances.includes('"status":"failed"')) console.log(`    (failed run: ${lastInstances})`);
  return found;
}

/** Settle any re-authentication the Designer asks for. */
async function reauthIfAsked(win: Page): Promise<boolean> {
  const dialog = win.locator(".awkit-reauth-modal");
  const shown = await dialog.waitFor({ state: "visible", timeout: 4_000 }).then(
    () => true,
    () => false
  );
  if (!shown) return false;
  await dialog.locator('input[type="password"]').fill(PASSWORD);
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await dialog.waitFor({ state: "detached", timeout: 15_000 });
  return true;
}
async function status(win: Page, text: string): Promise<boolean> {
  return win
    .getByTestId("visual-pending-status")
    .filter({ hasText: text })
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(
      () => true,
      () => false
    );
}
async function openDesigner(win: Page): Promise<void> {
  await navClick(win, "Flow Designer");
  await win.getByRole("button", { name: "Saved flow" }).click();
  await win.getByRole("option", { name: "VA GUI flow" }).click();
  const node = win.getByText("Assert the card", { exact: true }).first();
  const visible = await node.waitFor({ state: "visible", timeout: 15_000 }).then(
    () => true,
    () => false
  );
  if (!visible) {
    await win.screenshot({ path: `${DEBUG}.designer.png` });
    throw new Error(`the assertVisual node is not on the canvas (screenshot: ${DEBUG}.designer.png)`);
  }
  await node.click();
  await win.getByTestId("visual-assertion-section").waitFor({ state: "visible", timeout: 20_000 });
}
async function refreshPending(win: Page, count: number): Promise<boolean> {
  await win.getByTestId("visual-assertion-section").getByRole("button", { name: "Refresh" }).click();
  return win
    .waitForFunction((n) => document.querySelectorAll('[data-testid="visual-pending-item"]').length === n, count, { timeout: 10_000 })
    .then(
      () => true,
      () => false
    );
}
async function resetThroughDesigner(win: Page): Promise<boolean> {
  await win.getByTestId("visual-assertion-section").getByRole("button", { name: "Reset visual baselines" }).click();
  const confirm = win.getByRole("alertdialog").or(win.getByRole("dialog", { name: /Reset visual baselines/ }));
  await confirm.first().waitFor({ state: "visible", timeout: 10_000 });
  await confirm.first().getByRole("button", { name: "Reset baselines" }).click();
  await reauthIfAsked(win);
  return status(win, "Visual baselines reset.");
}

let app: ElectronApplication | undefined;
let server: ChildProcess | undefined;
const mainErrors: string[] = [];

async function launch(first: boolean): Promise<Page> {
  app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env, ...(executablePath ? { executablePath } : {}) });
  app.process().stderr?.on("data", (chunk: Buffer) => mainErrors.push(chunk.toString().trim()));
  const win: Page = await resolveMainWindow(app, 120_000);
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
  await app?.close().catch(() => undefined);
  app = undefined;
}

try {
  server = spawn(process.execPath, ["mock-site/server.mjs"], { cwd: root, env: { ...process.env, MOCK_SITE_PORT: String(port) }, stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 100; i += 1) {
    if (await fetch(LAB).then((r) => r.ok, () => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // ── Launch 1 ────────────────────────────────────────────────────────────────────────────────
  console.log("\n1. First run: capture, preview, approve, replay, stale, reject, reset");
  let win = await launch(true);
  const console_ = watchConsole(win);
  console_.setLabel("launch 1");
  const caps = await win.evaluate(() => window.playwrightFlowStudio.visualAssertions.capabilities());
  check("capabilities: this source build is dev and offers enforce", caps.appMode === "dev" && caps.enforceAvailable === true, JSON.stringify(caps));
  check("no visual baseline key exists before the first approval", keyFile() === undefined);
  const seeded = await win.evaluate(
    async ([flowId, workflowId]) => {
      const api = window.playwrightFlowStudio;
      const loaded = await api.flows.get(flowId);
      const admission = (await api.executions.validate(workflowId)) as { valid?: boolean; issues?: unknown[] };
      return { nodes: loaded?.nodes?.map((n) => `${n.id}:${n.type}`) ?? null, valid: admission?.valid, issues: JSON.stringify(admission?.issues ?? []).slice(0, 400) };
    },
    [FLOW_ID, WORKFLOW_ID] as const
  );
  check("the seeded flow loads with its assertVisual step and the workflow is runnable", seeded.valid === true && (seeded.nodes ?? []).includes(`${STEP_ID}:assertVisual`), JSON.stringify(seeded));

  const first = await candidateAfterRun(win);
  check("a real observe run with no baseline leaves one pending candidate for the step", first?.reason === "no-baseline", JSON.stringify(first));
  const listed = await list(win);
  check("the listing carries no digest, epoch token, key generation, pixels or user id", !SECRET_KEYS.test(listed.raw), listed.raw.slice(0, 300));
  check("the candidate names the authenticated user who started the run", first?.runUsername === DEFAULT_CREDS.username, first?.runUsername);

  // N6.7: the run's persisted report carries the codes-only block, and the run-detail drawer shows it as text.
  const persisted = await win.evaluate(async (executionId) => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const report = (await window.playwrightFlowStudio.reports.get(executionId)) as { instances?: { visualAssertions?: unknown[] }[] } | null;
      const block = report?.instances?.[0]?.visualAssertions;
      if (block || Date.now() > deadline) return JSON.stringify(block ?? null);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }, lastExecutionId);
  const block = JSON.parse(persisted) as Record<string, unknown>[] | null;
  check(
    "the stored report holds the step's codes-only record (observe, passed, candidate captured)",
    block?.length === 1 && block[0].stepId === STEP_ID && block[0].flowId === FLOW_ID && block[0].mode === "observe" && block[0].status === "passed" && block[0].candidate === true && !("failureClass" in block[0]),
    persisted
  );
  check("the stored record carries only allowlisted keys and no digest, token or selector", !SECRET_KEYS.test(persisted) && !/va-card|data-testid|http/.test(persisted), persisted);
  await navClick(win, "Reports");
  await navClick(win, "Instance Reports");
  await win.getByRole("button", { name: "Details" }).first().click();
  const drawer = win.getByRole("dialog", { name: "Run detail" });
  await drawer.waitFor({ state: "visible", timeout: 15_000 });
  const reportSection = drawer.getByTestId("visual-assertion-report-section");
  const shown = await reportSection.waitFor({ state: "visible", timeout: 15_000 }).then(
    () => true,
    () => false
  );
  const sectionText = shown ? (await reportSection.innerText()).replace(/\s+/g, " ") : "";
  check(
    "the run-detail drawer shows Visual assertions as text with totals, the exact code and the pending baseline",
    shown && /This instance: 1 visual assertion — 1 passed, 0 visual mismatch, 0 visual unverified/.test(sectionText) && /Reason code/.test(sectionText) && /pending baseline/.test(sectionText),
    sectionText.slice(0, 400)
  );
  const a11y = shown
    ? await reportSection.evaluate((section) => ({
        media: section.querySelectorAll("img, canvas, picture, video").length,
        unhidden: [...section.querySelectorAll("svg")].filter((icon) => icon.getAttribute("aria-hidden") !== "true").length,
        focusables: section.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').length
      }))
    : null;
  check("the section has no image, its icons are decorative and nothing in it is focusable", a11y?.media === 0 && a11y.unhidden === 0 && a11y.focusables === 0, JSON.stringify(a11y));
  await win.keyboard.press("Escape");

  await openDesigner(win);
  const section = win.getByTestId("visual-assertion-section");
  check("the Designer shows the Visual assertion section for the assertVisual step", (await section.count()) === 1);
  check("its mode reads observe", (await win.getByTestId("visual-assertion-mode").inputValue()) === "observe");
  check("enforce is offered and enabled in this dev build", await win.locator('[data-testid="visual-assertion-mode"] option[value="enforce"]').isEnabled());
  check("no unavailable warning in a build that allows enforce", (await win.getByTestId("visual-assertion-enforce-unavailable").count()) === 0);
  check("the pending candidate is listed in the section", await refreshPending(win, 1));
  const latestLine = win.getByTestId("visual-assertion-latest");
  check(
    "the Designer states the step's latest recorded result as text",
    await win
      .waitForFunction(() => document.querySelector('[data-testid="visual-assertion-latest"]')?.getAttribute("data-code") !== "none", undefined, { timeout: 10_000 })
      .then(
        () => true,
        () => false
      ),
    await latestLine.innerText().catch(() => "")
  );

  const imagesBeforePreview = new Set(previewFilesOnDisk());
  await win.getByTestId("visual-pending-item").first().getByRole("button", { name: "Preview" }).click();
  const reauthForPreview = await reauthIfAsked(win);
  const img = win.getByTestId("visual-pending-preview").locator("img");
  await img.waitFor({ state: "visible", timeout: 20_000 });
  const natural = await img.evaluate((el) => ({ w: (el as HTMLImageElement).naturalWidth, h: (el as HTMLImageElement).naturalHeight, alt: el.getAttribute("alt") ?? "" }));
  check("preview needs a fresh re-authentication (dialog shown or session fresh) and shows the decoded crop", natural.w > 0 && natural.h > 0, `${JSON.stringify(natural)} reauth=${reauthForPreview}`);
  check("the preview has a text alternative naming its size", /pixels/.test(natural.alt), natural.alt);
  // The run's own observation screenshots predate the preview; the preview must add no image file anywhere.
  const imagesFromPreview = previewFilesOnDisk().filter((f) => !imagesBeforePreview.has(f));
  check("previewing writes no image to disk", imagesFromPreview.length === 0, imagesFromPreview.join(", "));

  await win.getByTestId("visual-pending-item").first().getByRole("button", { name: "Approve" }).click();
  await reauthIfAsked(win);
  check("approving in the Designer reports the baseline approved", await status(win, "Baseline approved."));
  check("the first approval created the key file and key generation 1", keyFile() !== undefined && markerGeneration() === 1, `${keyFile()} gen=${markerGeneration()}`);
  const keyText = keyFile() ? readFileSync(keyFile()!, "utf8") : "";
  check("the key file holds no plaintext key material field", !/"(key|secret|raw)"\s*:\s*"[0-9a-f]{64}"/i.test(keyText));
  check("the approved candidate is gone from the list", (await list(win)).candidates.length === 0);
  check("replaying the approval of a consumed candidate is candidate-unavailable", (await call(win, "approveCandidate", first?.candidateId ?? "")).code === "candidate-unavailable");

  check("a re-run that matches the approved baseline leaves no candidate", (await candidateAfterRun(win)) === undefined);

  // Stale epoch: a different binding makes a candidate, then the flow is imported over itself.
  await win.evaluate(([id, profile]) => window.playwrightFlowStudio.flows.update(id, profile as never), [FLOW_ID, flowProfile({ strategy: "css", value: '[data-testid="va-card"]' })] as const);
  const changed = await candidateAfterRun(win);
  // A locator change purges that step's approval on save (N6.3 lifecycle), so the step has no baseline again.
  check("a locator change purged the step's approval: the run leaves a no-baseline candidate", changed?.reason === "no-baseline", JSON.stringify(changed));
  await win.evaluate((profile) => window.playwrightFlowStudio.flows.import(profile as never), flowProfile({ strategy: "css", value: '[data-testid="va-card"]' }));
  check("approving a candidate captured before an import is stale-epoch", (await call(win, "approveCandidate", changed?.candidateId ?? "")).code === "stale-epoch");

  // Stale content: capture, then edit the step.
  const beforeEdit = await candidateAfterRun(win);
  check("after the import the run leaves a no-baseline candidate", beforeEdit?.reason === "no-baseline", JSON.stringify(beforeEdit));
  await win.evaluate(([id, profile]) => window.playwrightFlowStudio.flows.update(id, profile as never), [FLOW_ID, flowProfile()] as const);
  check("approving a candidate captured before the step was edited is stale-content", (await call(win, "approveCandidate", beforeEdit?.candidateId ?? "")).code === "stale-content");

  const toReject = await candidateAfterRun(win);
  check("rejecting a candidate succeeds and consumes it", (await call(win, "rejectCandidate", toReject?.candidateId ?? "")).code === "rejected" && (await list(win)).candidates.length === 0);

  const pendingAtReset = await candidateAfterRun(win);
  await openDesigner(win);
  check("reset through the confirmation dialog reports success", await resetThroughDesigner(win));
  check("reset rotated the key to generation 2", markerGeneration() === 2, String(markerGeneration()));
  check("reset discarded the pending candidate of the old generation", (await call(win, "previewCandidate", pendingAtReset?.candidateId ?? "")).code === "candidate-unavailable");
  const afterReset = await candidateAfterRun(win);
  check("after reset the run finds no baseline again", afterReset?.reason === "no-baseline", JSON.stringify(afterReset));
  check("a capture after the reset approves under the new key", (await call(win, "approveCandidate", afterReset?.candidateId ?? "")).code === "approved");
  const errors1 = console_.errors ?? [];
  check("no renderer error was logged in launch 1", errors1.length === 0, JSON.stringify(errors1).slice(0, 400));
  await close();

  // ── Launch 2: restart ──────────────────────────────────────────────────────────────────────
  console.log("\n2. Restart: the key and the approval survive");
  win = await launch(false);
  check("after a restart a matching run leaves no candidate (the safeStorage key and approval were read back)", (await candidateAfterRun(win)) === undefined);
  check("the key generation is unchanged by the restart", markerGeneration() === 2);
  await close();

  // ── Launch 3: key loss ─────────────────────────────────────────────────────────────────────
  console.log("\n3. Key loss: nothing approvable until a reset");
  rmSync(keyFile()!);
  win = await launch(false);
  check("with the key file lost, a run leaves no approvable candidate", (await candidateAfterRun(win)) === undefined);
  check("...and no key was silently regenerated", keyFile() === undefined && markerGeneration() === 2);
  await openDesigner(win);
  check("reset through the Designer recovers from key loss", await resetThroughDesigner(win));
  check("...with a new key at generation 3", keyFile() !== undefined && markerGeneration() === 3, String(markerGeneration()));
  const recovered = await candidateAfterRun(win);
  check("after recovery a run leaves a candidate that approves", recovered !== undefined && (await call(win, "approveCandidate", recovered.candidateId)).code === "approved");
  await close();

  // ── Launch 4: tampered record ──────────────────────────────────────────────────────────────
  console.log("\n4. A tampered baseline record");
  const records = baselineFiles().filter((f) => !f.includes(`${path.sep}keys${path.sep}`) && f.endsWith(".json") && !/token/i.test(path.basename(f)));
  check("the approval wrote baseline records to tamper with", records.length > 0, String(records.length));
  for (const record of records) {
    const text = readFileSync(record, "utf8");
    writeFileSync(record, text.replace(/"([0-9a-f])/, (_m, c: string) => `"${c === "0" ? "1" : "0"}`), "utf8");
  }
  win = await launch(false);
  const unreadable = await candidateAfterRun(win);
  check("a tampered record is never accepted as a baseline: the run leaves a candidate", unreadable !== undefined && ["baseline-unreadable", "no-baseline", "binding-changed"].includes(unreadable.reason), JSON.stringify(unreadable));
  check("approving it replaces the tampered record", (await call(win, "approveCandidate", unreadable?.candidateId ?? "")).code === "approved");
  check("...after which a matching run leaves no candidate", (await candidateAfterRun(win)) === undefined);
  await close();

  // ── Launch 5: tampered key, audit, unauthorized ────────────────────────────────────────────
  console.log("\n5. A tampered key, the audit trail, and a signed-out renderer");
  const kf = keyFile()!;
  const sealed = JSON.parse(readFileSync(kf, "utf8")) as Record<string, unknown>;
  for (const [k, v] of Object.entries(sealed)) if (typeof v === "string" && v.length > 40) sealed[k] = `${v.slice(0, -8)}AAAAAAAA`;
  writeFileSync(kf, JSON.stringify(sealed), "utf8");
  win = await launch(false);
  check("with a tampered key, a run leaves no approvable candidate", (await candidateAfterRun(win)) === undefined);
  check("...and the key generation is not advanced without a reset", markerGeneration() === 3);
  await openDesigner(win);
  check("reset through the Designer recovers from a tampered key", (await resetThroughDesigner(win)) && markerGeneration() === 4);

  // Signed out FIRST: the renderer then holds no session at all. (A renderer-side `security.login` would add a second
  // session for this window that the UI's sign-out does not end, so the audit read below comes after this check.)
  await win.locator(".awkit-account-trigger").click();
  await win.getByRole("menuitem", { name: "Sign out" }).click();
  await win.waitForSelector("#awkit-login-username", { timeout: 15_000 });
  // Inline expressions only inside the page callback (tsx's `__name` wrapper does not exist in the page).
  const signedOut = await win.evaluate(async () => {
    const api = window.playwrightFlowStudio.visualAssertions;
    const settled = await Promise.allSettled([api.listCandidates({}), api.approveCandidate("0".repeat(32)), api.resetBaselines(), api.capabilities()]);
    const [list, approve, reset, capabilities] = settled.map((s) =>
      s.status === "rejected" ? "rejected" : s.value && typeof s.value === "object" && "code" in s.value ? String((s.value as { code: string }).code) : "answered"
    );
    return { list, approve, reset, capabilities };
  });
  check(
    "signed out, listing, approval and reset are refused and capabilities is unavailable",
    ["NOT_AUTHORIZED", "rejected"].includes(signedOut.list) &&
      ["NOT_AUTHORIZED", "REAUTH_REQUIRED", "rejected"].includes(signedOut.approve) &&
      ["NOT_AUTHORIZED", "REAUTH_REQUIRED", "rejected"].includes(signedOut.reset) &&
      signedOut.capabilities === "rejected",
    JSON.stringify(signedOut)
  );
  check("the refused reset rotated nothing", markerGeneration() === 4);

  await win.fill("#awkit-login-username", DEFAULT_CREDS.username);
  await win.locator('.awkit-login-form input[type="password"]').first().fill(PASSWORD);
  await win.getByRole("button", { name: "Sign in", exact: true }).click();
  await win.waitForSelector(".app-shell", { timeout: 25_000 });
  const audit = await win.evaluate(async ([username, password]) => {
    const api = window.playwrightFlowStudio;
    const login = await api.security.login({ providerId: "local", username, password });
    if (!login.ok) return { ok: false, second: "", rows: [] as { eventType: string; result: string; detail?: unknown }[] };
    const listed = await api.security.admin.listAudit({ sessionRef: login.principal.sessionRef, limit: 500 });
    return {
      ok: listed.ok as boolean,
      second: login.principal.sessionRef as string,
      rows: ((listed.value ?? []) as { eventType: string; result: string; detail?: unknown }[]).filter((r) => r.eventType.startsWith("VISUAL_"))
    };
  }, [DEFAULT_CREDS.username, PASSWORD] as const);
  const events = new Set(audit.rows.map((r) => `${r.eventType}:${r.result}`));
  check(
    "the audit trail records preview, approval, refusals, rejection and reset",
    audit.ok &&
      ["VISUAL_CANDIDATE_PREVIEWED:success", "VISUAL_CANDIDATE_APPROVED:success", "VISUAL_CANDIDATE_APPROVAL_REFUSED:failure", "VISUAL_CANDIDATE_REJECTED:success", "VISUAL_BASELINES_RESET:success"].every((e) => events.has(e)),
    [...events].join(", ")
  );
  check("no audit row carries a digest, token, commitment or key field", !audit.rows.some((r) => SECRET_KEYS.test(JSON.stringify(r.detail ?? {}).replace(/"keyGeneration"/g, '"gen"').replace(/"conditionsKey"/g, '"ck"'))));
  check("the signed-out refusals were audited as visual assertion denials", events.has("VISUAL_ASSERTION_DENIED:failure"), [...events].join(", "));

  // Security follow-up: the audit read above logged in a SECOND session from this window (the renderer-side
  // `security.login`). A visible Sign out must still leave the window with no authority and end that session.
  await win.locator(".awkit-account-trigger").click();
  await win.getByRole("menuitem", { name: "Sign out" }).click();
  await win.waitForSelector("#awkit-login-username", { timeout: 15_000 });
  const afterSecond = await win.evaluate(async () => {
    const api = window.playwrightFlowStudio.visualAssertions;
    const settled = await Promise.allSettled([api.listCandidates({}), api.previewCandidate("0".repeat(32)), api.approveCandidate("0".repeat(32)), api.resetBaselines()]);
    return settled.map((s) =>
      s.status === "rejected" ? "rejected" : s.value && typeof s.value === "object" && "code" in s.value ? String((s.value as { code: string }).code) : "answered"
    );
  });
  check(
    "after a second login from the same window, Sign out still refuses listing, preview, approval and reset",
    afterSecond.every((code) => ["NOT_AUTHORIZED", "REAUTH_REQUIRED", "rejected"].includes(code)),
    JSON.stringify(afterSecond)
  );
  check("...and the reset rotated nothing", markerGeneration() === 4);
  const secondAlive = await win.evaluate(async (ref) => (await window.playwrightFlowStudio.security.validateSession(ref)).valid, audit.second);
  check("...and the second session was ended by the Sign out (it no longer validates)", audit.second.length > 0 && secondAlive === false);
  await close();

  check("visual baselines never store pixels: no image file under visual-baselines", !baselineFiles().some((f) => /\.(png|jpe?g|webp|bmp)$/i.test(f)));
  check("no temporary file is left under visual-baselines", !baselineFiles().some((f) => /\.tmp$|\.partial$/i.test(f)));
} catch (error) {
  failed += 1;
  console.error(`  ✗ unexpected error — ${error instanceof Error ? error.stack : String(error)}`);
  const tail = mainErrors.filter(Boolean).slice(-8);
  if (tail.length) console.error(`    main process stderr (last ${tail.length}): ${tail.join(" | ").slice(0, 1200)}`);
} finally {
  await close();
  server?.kill();
  try {
    cleanup();
  } catch {
    /* a Windows file lock on the temp profile is not a product failure */
  }
}

console.log(`\nverify:visual-assertion-gui — ${passed} passed, ${failed} failed`);
if (passed === 0) failed += 1;
process.exit(failed === 0 ? 0 : 1);
