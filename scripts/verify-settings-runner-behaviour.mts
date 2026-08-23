/**
 * SET-009 — execution defaults persist and INFLUENCE A NEW RUN, plus SET-008's new-run-form half.
 *
 * Run with: npm run verify:settings-runner-behaviour   (AFTER `npm run build`)
 *
 * `verify:settings-e2e` already proves these defaults save, validate and survive a restart. That is
 * the easy half: a value can round-trip through the settings file perfectly and still reach nothing
 * that runs. This suite drives the other half — the rendered run card, and then a REAL run started
 * from that card's own Run button — because "the runner honors the selected flags" is the only part
 * of SET-009 a settings round-trip cannot show.
 *
 * Two values are used for every propagation check, never one. The defaults are ordinary numbers, so a
 * single value can agree by coincidence with a card that ignores settings entirely.
 *
 * The screenshot checks are two-sided on purpose. "No failure screenshot was written" is also what a
 * build where screenshots never work at all would produce, so the OFF assertion is only meaningful
 * beside an ON run that did produce one.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ConsoleMessage, type Page } from "playwright";
// @ts-expect-error Shared GUI helper is intentionally plain ESM JavaScript.
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";
// @ts-expect-error Shared E2E helper is intentionally plain ESM JavaScript.
import { navClick } from "./lib/e2e-qa-lib.mjs";
import type {} from "../app/renderer/types/preload.d.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceRoot = join(root, "test-artifacts", "settings-runner-behaviour", stamp);
const screenshots = join(evidenceRoot, "screenshots");

const MOCK_PORT = 4321;
const MOCK_BASE = `http://localhost:${MOCK_PORT}`;
const MOCK_PROBE = `http://127.0.0.1:${MOCK_PORT}/login`;

const FAIL_FLOW_ID = "set009-failing-flow";
const FAIL_WORKFLOW_ID = "set009-failing-workflow";
const SECOND_WORKFLOW_ID = "set009-second-workflow";

let passed = 0;
let failed = 0;
let notRun = 0;
const results: { name: string; state: "PASS" | "FAIL" | "NOT RUN"; detail: string }[] = [];

function check(name: string, condition: unknown, detail: unknown = ""): boolean {
  const pass = Boolean(condition);
  const text = detail === undefined ? "" : String(detail);
  results.push({ name, state: pass ? "PASS" : "FAIL", detail: text });
  if (pass) {
    passed += 1;
    console.log(`  PASS ${name}${text ? ` — ${text}` : ""}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${text ? ` — ${text}` : ""}`);
  }
  return pass;
}

function checkSkip(name: string, reason: string): void {
  notRun += 1;
  results.push({ name, state: "NOT RUN", detail: reason });
  console.log(`  ~ ${name} — NOT RUN: ${reason}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollUntil<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs: number, intervalMs = 500): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value !== null && value !== undefined && value !== false) return value as T;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

function httpOk(url: string): Promise<boolean> {
  return new Promise((resolveOk) => {
    const request = httpGet(url, (response) => {
      response.resume();
      resolveOk((response.statusCode ?? 500) < 500);
    });
    request.on("error", () => resolveOk(false));
    request.setTimeout(2000, () => {
      request.destroy();
      resolveOk(false);
    });
  });
}

/** Every file under `dir`, recursively. Missing directory = no files, never a throw. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (statSync(full).size > 0) out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Fixtures — a flow whose second step is GUARANTEED to fail.
 * ------------------------------------------------------------------ */

const now = new Date().toISOString();
const failingFlow = {
  id: FAIL_FLOW_ID,
  name: "SET-009 — Failing Flow",
  description: "Opens the mock login page then clicks an element that does not exist, so the step fails.",
  version: 1,
  createdAt: now,
  updatedAt: now,
  nodes: [
    { id: "start", type: "start", name: "Start" },
    { id: "goto", type: "goto", name: "Open Login", url: `${MOCK_BASE}/login`, valueSource: { type: "static", value: `${MOCK_BASE}/login` } },
    {
      id: "boom",
      type: "click",
      name: "Click a control that does not exist",
      // No `onFailure` on purpose: the per-step override wins over the run default (FlowExecutor:
      // `step.onFailure?.screenshot ?? this.screenshotOnFailureDefault`), so setting it here would
      // mask exactly the run-level default this case is about.
      locator: { strategy: "id", value: "set009-no-such-control" },
      timeoutMs: 3000
    },
    { id: "end", type: "end", name: "End" }
  ],
  edges: [
    { id: "e0", source: "start", target: "goto", type: "success" },
    { id: "e1", source: "goto", target: "boom", type: "success" },
    { id: "e2", source: "boom", target: "end", type: "success" }
  ]
};

const workflowFor = (id: string, name: string) => ({
  id,
  name,
  description: "SET-009 fixture.",
  version: 1,
  createdAt: now,
  updatedAt: now,
  nodes: [
    {
      id: FAIL_FLOW_ID,
      type: "flowRef",
      flowId: FAIL_FLOW_ID,
      alias: FAIL_FLOW_ID,
      order: 1,
      required: true,
      inputBindings: {},
      retryPolicy: { count: 0, delayMs: 500 },
      failurePolicy: "stop",
      position: { x: 140, y: 180 }
    }
  ],
  edges: [],
  runtimeInputs: [],
  execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true }
});

/* ------------------------------------------------------------------ *
 * Readers
 * ------------------------------------------------------------------ */

/** What a rendered workflow card is showing right now. */
const readCard = (win: Page, workflowName: string) =>
  win.evaluate((name: string) => {
    const card = [...document.querySelectorAll<HTMLElement>("article.workflow-card")].find(
      (el) => el.getAttribute("aria-label") === `Workflow ${name}`
    );
    if (!card) return null;
    const numbers = [...card.querySelectorAll<HTMLInputElement>('input[type="number"]')].map((i) => Number(i.value));
    const select = card.querySelector<HTMLSelectElement>("select");
    return { totalRuns: numbers[0] ?? -1, concurrent: numbers[1] ?? -1, runMode: select?.value ?? "", text: (card.textContent ?? "").slice(0, 200) };
  }, workflowName);

const updateSettings = (win: Page, patch: Record<string, unknown>) =>
  win.evaluate((p: Record<string, unknown>) => window.playwrightFlowStudio.settings.update(p as any), patch);

/** Remount InstanceMonitor so its mount effect re-reads settings — the path a user takes. */
async function reopenInstances(win: Page): Promise<void> {
  await navClick(win, "Dashboard");
  await win.waitForTimeout(400);
  await navClick(win, "Instances");
  await win.waitForSelector("article.workflow-card", { timeout: 20_000 });
  await win.waitForTimeout(400);
}

type Instance = { instanceId: string; executionId: string; status: string };
const listInstances = (win: Page): Promise<Instance[]> =>
  win.evaluate(() => window.playwrightFlowStudio.executions.list() as Promise<unknown[]>) as Promise<Instance[]>;

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

console.log("Settings → runner behaviour (SET-009, and SET-008's new-run-form half)");
mkdirSync(screenshots, { recursive: true });

if (!existsSync(join(root, "out", "main", "main.js"))) {
  console.error("  Build output missing (out/main/main.js). Run `npm run build` first.");
  process.exit(1);
}

let mockSite: ChildProcess | null = null;
const launch = isolatedLaunchEnv("awkit-set009", { PRODUCTION_OFFLINE: "true" });
const runtimeRoot = join(launch.dataRoot, "SpecterStudio");
const rendererErrors: string[] = [];

try {
  console.log("\nPreconditions");
  if (!(await httpOk(MOCK_PROBE))) {
    mockSite = spawn(process.execPath, [join(root, "mock-site", "server.mjs")], {
      env: { ...process.env, MOCK_SITE_PORT: String(MOCK_PORT) },
      stdio: "ignore",
      windowsHide: true
    });
  }
  const mockUp = await pollUntil(async () => ((await httpOk(MOCK_PROBE)) ? true : null), 20_000, 500);
  if (!check("mock site is serving on loopback", mockUp === true, MOCK_PROBE)) {
    throw new Error("mock site never came up");
  }

  const app = await electron.launch({ args: [root], cwd: root, env: launch.env });
  try {
    const win = await resolveMainWindow(app);
    win.on("console", (message: ConsoleMessage) => {
      if (message.type() === "error") rendererErrors.push(message.text());
    });
    win.on("pageerror", (error: Error) => rendererErrors.push(`pageerror: ${error.message}`));
    await signInFirstRun(win);

    await win.evaluate(async (payload: { flow: unknown; a: unknown; b: unknown }) => {
      await window.playwrightFlowStudio.flows.import(payload.flow as any);
      await window.playwrightFlowStudio.workflows.import(payload.a as any);
      await window.playwrightFlowStudio.workflows.import(payload.b as any);
    }, { flow: failingFlow, a: workflowFor(FAIL_WORKFLOW_ID, "SET009 Primary"), b: workflowFor(SECOND_WORKFLOW_ID, "SET009 Second") });
    check("fixtures imported through the app's own IPC", true, `${FAIL_WORKFLOW_ID} + ${SECOND_WORKFLOW_ID}`);

    /* -------------------------------------------------------------- *
     * SET-008 / SET-009 — defaults reach a NEWLY OPENED run form.
     * -------------------------------------------------------------- */
    console.log("\nSET-009 — execution defaults reach a newly opened run form");
    const sets = [
      { defaultRuns: 7, defaultConcurrentRuns: 2, defaultRunMode: "headed" },
      { defaultRuns: 3, defaultConcurrentRuns: 1, defaultRunMode: "headless" }
    ];
    for (const [index, want] of sets.entries()) {
      await updateSettings(win, { execution: { maxRuns: 20, maxConcurrentRuns: 5, ...want } });
      await reopenInstances(win);
      const card = await readCard(win, "SET009 Primary");
      check(
        `SET-009 a new run card takes the Settings defaults (set ${index + 1} of ${sets.length})`,
        card !== null && card.totalRuns === want.defaultRuns && card.concurrent === want.defaultConcurrentRuns && card.runMode === want.defaultRunMode,
        `wanted ${JSON.stringify(want)} — card ${JSON.stringify(card && { totalRuns: card.totalRuns, concurrent: card.concurrent, runMode: card.runMode })}`
      );
    }

    /* -------------------------------------------------------------- *
     * SET-009 — a SAVED card value must not be silently overwritten.
     * -------------------------------------------------------------- */
    console.log("\nSET-009 — a saved card value survives a later Settings change");
    // Persist an explicit per-card value for the PRIMARY workflow only, through the card itself.
    const runsInput = win.locator('article.workflow-card[aria-label="Workflow SET009 Primary"] input[type="number"]').first();
    await runsInput.fill("9");
    await runsInput.dispatchEvent("change");
    await win.waitForTimeout(600);
    const savedCards = await win.evaluate(async () => (await window.playwrightFlowStudio.settings.get()).workflowRunCards ?? {});
    if (!check("the card's own value was persisted to workflowRunCards", (savedCards as any)[FAIL_WORKFLOW_ID]?.totalRuns === 9, JSON.stringify(savedCards).slice(0, 200))) {
      checkSkip(
        "SET-009 a saved card value is not overwritten by a later Settings change",
        "the card value never persisted, so there is nothing to protect from the Settings change"
      );
    } else {
      await updateSettings(win, { execution: { maxRuns: 20, maxConcurrentRuns: 5, defaultRuns: 4, defaultConcurrentRuns: 1, defaultRunMode: "headless" } });
      await reopenInstances(win);
      const primary = await readCard(win, "SET009 Primary");
      const second = await readCard(win, "SET009 Second");
      // Both halves matter: the saved card keeps its value AND the untouched card takes the new
      // default. Without the second, "nothing changed" would satisfy the first.
      check(
        "SET-009 a saved card value is not overwritten by a later Settings change",
        primary?.totalRuns === 9,
        `saved card totalRuns=${primary?.totalRuns} (expected 9, Settings default is now 4)`
      );
      check(
        "SET-009 ...while a card with no saved value does take the new default (control)",
        second?.totalRuns === 4,
        `untouched card totalRuns=${second?.totalRuns} (expected 4)`
      );
    }

    /* -------------------------------------------------------------- *
     * SET-009 — the RUNNER honours the flags. The half a settings
     * round-trip cannot show.
     * -------------------------------------------------------------- */
    console.log("\nSET-009 — the runner honours screenshot-on-failure");

    async function runFromCardAndCollect(label: string): Promise<{ failedRun: boolean; shots: string[]; names: string[] }> {
      const before = new Set(walk(join(runtimeRoot, "screenshots")));
      // Scope to THIS run's execution. `executions.list()` returns every instance ever started in the
      // session, so a poll for "some terminal instance" is satisfied instantly by a PREVIOUS run's
      // corpse — which is how the first version of this check sampled the artifact directory before
      // the run under test had written anything, and read that as "the setting suppressed it".
      const priorExecutions = new Set((await listInstances(win)).map((i) => i.executionId));
      await reopenInstances(win);
      // The card keeps its controls behind a hover/focus reveal ("Hover or focus to configure & run"),
      // whose hint span intercepts pointer events until then. Drive the real affordance rather than
      // forcing the click past it — a forced click would also pass on a card whose reveal was broken.
      const card = win.locator('article.workflow-card[aria-label="Workflow SET009 Primary"]');
      await card.hover();
      await win.waitForTimeout(300);
      await card.locator("button.workflow-card-run").click();
      // Wait for a NEW execution to appear, then for every instance of THAT execution to end.
      const terminal = await pollUntil(async () => {
        const list = await listInstances(win);
        const mine = list.filter((i) => !priorExecutions.has(i.executionId));
        if (mine.length === 0) return null;
        return mine.every((i) => ["failed", "completed", "cancelled"].includes(i.status)) ? mine : null;
      }, 90_000, 1000);
      // Artifacts are written as the instance winds down; give the writes a moment to land.
      await sleep(4000);
      const after = walk(join(runtimeRoot, "screenshots")).filter((f) => !before.has(f));
      const names = after.map((f) => f.slice(runtimeRoot.length + 1));
      console.log(
        `    ${label}: terminal=${terminal ? terminal.map((i) => i.status).join(",") : "none"} newScreenshots=${after.length}` +
          (names.length ? ` → ${names.join(", ")}` : "")
      );
      return { failedRun: Boolean(terminal?.some((i) => i.status === "failed")), shots: after, names };
    }

    // ON first: a positive control. "No screenshot" below is only evidence if screenshots work here.
    await updateSettings(win, {
      execution: { maxRuns: 20, maxConcurrentRuns: 5, defaultRuns: 1, defaultConcurrentRuns: 1, defaultRunMode: "headless", screenshotOnFailure: true, stopOnError: true }
    });
    await win.evaluate((id: string) => window.playwrightFlowStudio.settings.update({ workflowRunCards: { [id]: undefined } } as any), FAIL_WORKFLOW_ID).catch(() => undefined);
    await updateSettings(win, { workflowRunCards: { [FAIL_WORKFLOW_ID]: { totalRuns: 1, concurrentInstances: 1, runMode: "headless", isolationMode: "browserContext", screenshotOnFailure: true, stopOnError: true } } });
    const on = await runFromCardAndCollect("screenshotOnFailure=true");
    const controlOk = check(
      "SET-009 the fixture's step really fails, and a failure screenshot IS captured when enabled (control)",
      on.failedRun && on.shots.length > 0,
      `failedRun=${on.failedRun} screenshots=${on.shots.length}`
    );

    await updateSettings(win, {
      execution: { maxRuns: 20, maxConcurrentRuns: 5, defaultRuns: 1, defaultConcurrentRuns: 1, defaultRunMode: "headless", screenshotOnFailure: false, stopOnError: true }
    });
    await updateSettings(win, { workflowRunCards: { [FAIL_WORKFLOW_ID]: { totalRuns: 1, concurrentInstances: 1, runMode: "headless", isolationMode: "browserContext", screenshotOnFailure: false, stopOnError: true } } });
    const off = await runFromCardAndCollect("screenshotOnFailure=false");

    // A single ON→OFF pair cannot distinguish "the setting works" from "the second run of a profile
    // writes no screenshots for some unrelated reason". Turning it back ON is what makes the
    // difference attributable to the setting rather than to run order.
    await updateSettings(win, {
      execution: { maxRuns: 20, maxConcurrentRuns: 5, defaultRuns: 1, defaultConcurrentRuns: 1, defaultRunMode: "headless", screenshotOnFailure: true, stopOnError: true }
    });
    await updateSettings(win, { workflowRunCards: { [FAIL_WORKFLOW_ID]: { totalRuns: 1, concurrentInstances: 1, runMode: "headless", isolationMode: "browserContext", screenshotOnFailure: true, stopOnError: true } } });
    const onAgain = await runFromCardAndCollect("screenshotOnFailure=true (again)");

    if (!controlOk) {
      checkSkip(
        "SET-009 the runner honours screenshot-on-failure = OFF",
        "the ON control did not produce a failure screenshot, so an absent screenshot here would prove nothing"
      );
    } else {
      check(
        "SET-009 the runner honours screenshot-on-failure = OFF",
        off.failedRun && off.shots.length === 0,
        `failedRun=${off.failedRun} screenshots=${off.shots.length}` +
          (off.shots.length > 0
            ? " — the run still captured a failure screenshot with the setting OFF, so the control does not reach the runner"
            : "")
      );
      check(
        "SET-009 ...and turning it back ON captures again, so the difference is the setting and not run order",
        onAgain.failedRun && onAgain.shots.length > 0,
        `run3 failedRun=${onAgain.failedRun} screenshots=${onAgain.shots.length} → ${onAgain.names.join(", ") || "none"}`
      );
    }

    check("no renderer errors during the walkthrough", rendererErrors.length === 0, rendererErrors.slice(0, 3).join(" | "));
    await win.screenshot({ path: join(screenshots, "01-instances.png"), fullPage: true });
  } finally {
    await app.close().catch(() => undefined);
  }
} catch (error) {
  check("harness completed without throwing", false, error instanceof Error ? error.message : String(error));
} finally {
  if (mockSite) mockSite.kill();
  try {
    launch.cleanup();
  } catch {
    /* temp profile; a locked file must not fail the suite */
  }
}

/* ------------------------------------------------------------------ *
 * SET-007 — a corrupt ui-settings.json is QUARANTINED, not destroyed
 * (AWKIT-SET-007). Runs against an ISOLATED LOCALAPPDATA so the real
 * settings store is never touched.
 * ------------------------------------------------------------------ */
console.log("\nSET-007 — corrupt ui-settings.json quarantine");
{
  const iso = isolatedLaunchEnv("awkit-set007", { PRODUCTION_OFFLINE: "true" });
  const settingsDir = join(iso.dataRoot, "SpecterStudio", "storage");
  const settingsFile = join(settingsDir, "ui-settings.json");
  const CORRUPT = '{ "app": { "lastLaunchedAt": "TRUNCATED';
  let app2: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(settingsFile, CORRUPT, "utf8");

    app2 = await electron.launch({ args: [root], cwd: root, env: iso.env });
    app2.process().stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.includes("ui-settings")) console.log(`  [app-stderr] ${text.trim().slice(0, 220)}`);
    });
    const win = await resolveMainWindow(app2);
    const bootedOnDefaults = await win.evaluate(() =>
      window.playwrightFlowStudio.settings.get().then((s) => typeof s.accent === "object" && typeof s.workflowBuilder === "object")
    );
    check("the app boots on defaults despite a corrupt settings file", bootedOnDefaults === true);

    const siblings = readdirSync(settingsDir).filter((f) => f.startsWith("ui-settings.json.corrupt-"));
    check("exactly one .corrupt-* sibling quarantines the original bytes", siblings.length === 1, JSON.stringify(readdirSync(settingsDir)));
    if (siblings.length === 1) {
      check(
        "the quarantined sibling preserves the original (corrupt) bytes verbatim",
        readFileSync(join(settingsDir, siblings[0]), "utf8") === CORRUPT
      );
    }

    // The startup lastLaunchedAt bookkeeping write must land on a FRESH valid file — never by
    // destroying the unrecoverable original.
    const freshValid = (() => {
      try {
        JSON.parse(readFileSync(settingsFile, "utf8"));
        return true;
      } catch {
        return false;
      }
    })();
    check("a fresh VALID ui-settings.json exists after startup", freshValid);

    // Positive control: subsequent VALID writes create no further quarantine siblings.
    await win.evaluate(() => window.playwrightFlowStudio.settings.update({ selectedBuilderWorkflowId: "set007-marker" }));
    await app2.close().catch(() => undefined);
    app2 = undefined;
    const siblingsAfter = readdirSync(settingsDir).filter((f) => f.startsWith("ui-settings.json.corrupt-")).length;
    check("valid writes create NO additional quarantine siblings", siblingsAfter === 1, String(siblingsAfter));
    check("the marker value written through the app persists", (() => {
      try {
        return JSON.parse(readFileSync(settingsFile, "utf8")).selectedBuilderWorkflowId === "set007-marker";
      } catch {
        return false;
      }
    })());
  } catch (error) {
    check("SET-007 harness completed without throwing", false, error instanceof Error ? error.message : String(error));
  } finally {
    if (app2) await app2.close().catch(() => undefined);
    iso.cleanup();
  }
}

writeFileSync(join(evidenceRoot, "execution-results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf8");
console.log(`\nSettings runner behaviour: ${passed} PASS / ${failed} FAIL${notRun > 0 ? ` / ${notRun} NOT RUN` : ""}`);
console.log(`Evidence: ${relative(root, evidenceRoot)}`);
// AWKIT-QA-007: NOT-RUN work must fail the suite like a failure would.
process.exit(failed === 0 && notRun === 0 ? 0 : 1);
