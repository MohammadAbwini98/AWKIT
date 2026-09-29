/**
 * verify:ai-progress-gui — Phase L, L9 (`awkit-djnl.13`) in the REAL Electron app.
 *
 * The job-status contract, pushed from main to the asking window, rendered by the one shared progress
 * component, and the time budgets in Settings:
 *   1. a first (cold) explanation: an accessible progress bar that is DETERMINATE only while the runtime
 *      reports its load fraction (aria-valuenow present), then INDETERMINATE for prompt evaluation and
 *      generation (no aria-valuenow, never a percentage from elapsed time); stage names in its value text;
 *      "no estimate yet" with no history; polite announcements, throttled;
 *   2. a warm run with no warm history, then one WITH it: a measured range "from 1 earlier warm run";
 *   3. keyboard: Enter starts, Enter on the same control cancels, and focus never falls to the page;
 *   4. reduced motion stops the indeterminate sweep, and without it the sweep runs;
 *   5. inside the insert-fragment dialog the job's progress keeps the dialog's focus contract;
 *   6. Settings → Time limits: an old settings file loads with the defaults; an out-of-range value is
 *      refused with main's bounds as an alert tied to the field and nothing is written; a valid one is
 *      saved; a job then times out at THAT limit; "Use default" restores it; the speed row shows what was
 *      measured here;
 *   7. after a restart the ETA history is still there: a cold run shows "from 1 earlier cold run";
 *   8. the history file holds latency-class keys and numbers only: no step name or typed value.
 *
 * Deterministic provider (`AWKIT_TEST_AI_PROVIDER`, non-packaged builds only): the queue, prompt builder,
 * output contract, tracker and history are production; only the transport is scripted. Live-model and
 * packaged evidence is `verify:ai-progress-packaged`.
 *
 * Needs `npm run build` first (it launches `out/`). Run: npm run verify:ai-progress-gui
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { buildAuthoringRequest } from "@src/ai/authoringExplanation";
import type { FakeInferStep } from "@src/ai/FakeAiHostTransport";
import type { FlowFragment } from "@src/fragments/FlowFragment";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { validateFlowDefinition } from "@src/validation/FlowValidator";

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
const probe = isolatedLaunchEnv("awkit-ai-progress-gui");
const providerFile = path.join(probe.dataRoot, "test-ai-provider.json");
const env = { ...probe.env, AWKIT_TEST_AI_PROVIDER: providerFile };
const appData = path.join(probe.dataRoot, "SpecterStudio");
const settingsFile = path.join(appData, "ai", "ai-settings.json");
const historyFile = path.join(appData, "ai", "ai-eta-history.json");

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 500)}`}`);
  }
}

// ── Seed ──────────────────────────────────────────────────────────────────────────────────────────
const STEP_NAME = "Zebra-Quokka-Progress-Step";
const TYPED = "Zebra-Quokka-Typed-Value";
const FLOW_ID = "l9-progress-gui";
const FLOW_NAME = "L9 progress GUI";
const now = new Date().toISOString();
const flow = {
  id: FLOW_ID,
  name: FLOW_NAME,
  description: "Seeded for verify:ai-progress-gui",
  version: 1,
  createdAt: now,
  updatedAt: now,
  nodes: [
    { id: "start", type: "start", name: "Start", position: { x: 280, y: 80 } },
    { id: "click", type: "click", name: STEP_NAME, position: { x: 280, y: 220 } },
    { id: "fill", type: "fill", name: "Fill name", value: TYPED, locator: { strategy: "css", value: "#zq" }, position: { x: 280, y: 360 } },
    { id: "end", type: "end", name: "End", position: { x: 280, y: 500 } }
  ],
  edges: [
    { id: "e0", source: "start", target: "click", type: "success" },
    { id: "e1", source: "click", target: "fill", type: "success" },
    { id: "e2", source: "fill", target: "end", type: "success" }
  ]
} as unknown as FlowProfile;
mkdirSync(path.join(appData, "flows"), { recursive: true });
mkdirSync(path.join(appData, "ai"), { recursive: true });
writeFileSync(path.join(appData, "flows", `${FLOW_ID}.json`), `${JSON.stringify(flow, null, 2)}\n`);
// A settings file from before L9 (L8a era): no time budgets at all.
writeFileSync(settingsFile, `${JSON.stringify({ schemaVersion: 1, enabled: true, yieldDuringRuns: true, idleUnloadMinutes: 10, featureTiers: {}, executionMode: "cpu", vramReserveMb: null }, null, 2)}\n`);
const FRAGMENT_ID = "l9-fill-click";
const fragment: FlowFragment = {
  id: FRAGMENT_ID,
  name: "L9 fill then click",
  kind: "fragment",
  version: 1,
  nodes: [
    { id: "fa", type: "fill", name: "Fill", value: "x", locator: { strategy: "css", value: "#a" } },
    { id: "fb", type: "click", name: "Go", locator: { strategy: "testId", value: "go" } }
  ],
  edges: [{ id: "fe", source: "fa", target: "fb", type: "success" }],
  inputs: []
} as FlowFragment;
mkdirSync(path.join(appData, "fragments"), { recursive: true });
writeFileSync(path.join(appData, "fragments", `${FRAGMENT_ID}.json`), `${JSON.stringify(fragment, null, 2)}\n`);

const request = buildAuthoringRequest(validateFlowDefinition(flow, { referenceableFlowIds: new Set([FLOW_ID]) }));
if (!request) throw new Error("the seeded flow produced no findings");
// With no fixable finding the schema has no `ranking` at all (additionalProperties: false), so none is sent.
const goodAnswer = JSON.stringify({
  version: 1,
  explanations: request.issues.map((ref) => ({ issueId: ref.id, text: ref.step })),
  ...(request.fixableIds.length > 0 ? { ranking: request.fixableIds } : {})
});
const provide = (step: FakeInferStep & { loadDelayMs?: number }) => writeFileSync(providerFile, JSON.stringify(step), "utf8");
const SLOW = { text: goodAnswer, delayMs: 6_000, promptMs: 2_500, loadDelayMs: 4_000 };
provide(SLOW);

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────
interface Sample {
  state: string | null;
  stage: string | null;
  valueNow: string | null;
  valueText: string | null;
  name: string | null;
  eta: string | null;
  announce: string | null;
}

/** Sample the progress view every 50 ms in the page, so no short stage is missed between reads. */
async function startSampling(win: Page, testId: string): Promise<void> {
  await win.evaluate((id) => {
    const w = window as unknown as { __samples: unknown[]; __sampler?: number };
    w.__samples = [];
    if (w.__sampler) clearInterval(w.__sampler);
    w.__sampler = window.setInterval(() => {
      const box = document.querySelector(`[data-testid="${id}"]`);
      if (!box) return;
      const bar = box.querySelector('[role="progressbar"]');
      w.__samples.push({
        state: box.getAttribute("data-job-state"),
        stage: box.getAttribute("data-job-stage"),
        valueNow: bar?.getAttribute("aria-valuenow") ?? null,
        valueText: bar?.getAttribute("aria-valuetext") ?? null,
        name: bar?.getAttribute("aria-label") ?? null,
        eta: box.querySelector(`[data-testid="${id}-eta"]`)?.textContent ?? null,
        announce: box.querySelector(`[data-testid="${id}-announce"]`)?.textContent ?? null
      });
    }, 50);
  }, testId);
}

async function stopSampling(win: Page): Promise<Sample[]> {
  return win.evaluate(() => {
    const w = window as unknown as { __samples: unknown[]; __sampler?: number };
    if (w.__sampler) clearInterval(w.__sampler);
    w.__sampler = undefined;
    return w.__samples as never;
  });
}

async function assistSettles(win: Page, want: string, timeout = 30_000): Promise<string | null> {
  await win
    .waitForFunction((value) => document.querySelector('[data-testid="ai-assist-bar"]')?.getAttribute("data-assist-state") === value, want, { timeout })
    .catch(() => undefined);
  const state = await win.getByTestId("ai-assist-bar").getAttribute("data-assist-state");
  if (state !== want) console.error(`    (assist bar: ${state} — ${await win.getByTestId("ai-assist-message").innerText().catch(() => "")})`);
  return state;
}

async function openFlow(win: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await navClick(win, "Flow Designer");
    const picker = win.getByRole("button", { name: "Saved flow" });
    if (await picker.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) break;
  }
  await win.getByRole("button", { name: "Saved flow" }).click();
  await win.getByRole("option", { name: FLOW_NAME }).click();
  await win.getByTestId("flow-validation-chip").click();
  await win.getByTestId("ai-assist-bar").waitFor({ state: "visible", timeout: 20_000 });
}

async function openSettings(win: Page) {
  const panel = win.locator(".settings-card").filter({ has: win.getByRole("heading", { name: "Local AI", exact: true }) });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await navClick(win, "Settings");
    if (await panel.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) return panel;
  }
  await panel.waitFor({ state: "visible", timeout: 5_000 });
  return panel;
}

async function signInExisting(win: Page): Promise<void> {
  await win.waitForSelector(".awkit-login-form", { timeout: 20_000 });
  await win.fill("#awkit-login-username", DEFAULT_CREDS.username);
  await win.locator('.awkit-login-form input[type="password"]').first().fill(DEFAULT_CREDS.password);
  await win.getByRole("button", { name: "Sign in", exact: true }).click();
  await win.waitForSelector(".app-shell", { timeout: 25_000 });
}

const distinct = <T,>(values: T[]) => values.filter((value, i) => i === 0 || values[i - 1] !== value);
const settingsOnDisk = () => JSON.parse(readFileSync(settingsFile, "utf8")) as { timeBudgetSeconds?: Record<string, number> };

let app: ElectronApplication | undefined;
async function launch(): Promise<Page> {
  app = await electron.launch({ args: [root, ...probe.electronArgs], cwd: root, env });
  const win: Page = await resolveMainWindow(app);
  watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  return win;
}

try {
  let win = await launch();
  await signInFirstRun(win);

  // ── 1. A cold first run ──────────────────────────────────────────────────────────────────────────
  console.log("\n1 — the first (cold) explanation");
  await openFlow(win);
  await startSampling(win, "ai-assist-progress");
  await win.getByTestId("ai-assist-explain").click();
  check("while it runs the bar shows one named progress bar", await win.getByRole("progressbar", { name: "Local AI explanation progress" }).waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false));
  check("the explanation completes", (await assistSettles(win, "done")) === "done");
  const cold = await stopSampling(win);
  const stages = distinct(cold.map((s) => s.stage));
  check("the stages seen include the load, prompt evaluation and generation, in that order", stages.indexOf("model-load") >= 0 && stages.indexOf("model-load") < stages.indexOf("prompt-evaluation") && stages.indexOf("prompt-evaluation") < stages.indexOf("generation"), stages);
  const loading = cold.filter((s) => s.stage === "model-load" && s.valueNow !== null);
  check("while the model loads the bar is determinate from the runtime's own fraction", loading.length > 0 && loading.every((s) => /^\d+$/.test(s.valueNow ?? "")), loading.map((s) => s.valueNow));
  const generating = cold.filter((s) => s.stage === "prompt-evaluation" || s.stage === "generation");
  check("prompt evaluation and generation are indeterminate: no aria-valuenow at all", generating.length > 0 && generating.every((s) => s.valueNow === null), generating.map((s) => s.valueNow));
  check("the value text names the stage and the elapsed time", generating.some((s) => /Writing the answer/.test(s.valueText ?? "")) && generating.some((s) => /\d+ s elapsed/.test(s.valueText ?? "")), generating.map((s) => s.valueText).slice(-2));
  check("the bar's accessible name is fixed", cold.every((s) => s.name === "Local AI explanation progress"));
  check("with no history it says there is no estimate yet, never a guess", cold.some((s) => /No time estimate yet/.test(s.eta ?? "")) && !cold.some((s) => /About .* left/.test(s.eta ?? "")), distinct(cold.map((s) => s.eta)));
  const announced = distinct(cold.map((s) => s.announce).filter((a): a is string => Boolean(a)));
  check("stage changes are announced politely, fewer times than they happen (throttled)", announced.length >= 1 && announced.length < stages.length, { announced, stages });
  check("the announcements are stage names only", announced.every((a) => /^(Queued|Starting|Preparing the request|Verifying the model file|Loading the model|Reading the request|Writing the answer|Checking the answer)/.test(a)), announced);
  check("the live region is polite", (await win.getByTestId("ai-assist-bar").count()) === 1 && (await win.evaluate(() => [...document.querySelectorAll('[data-testid$="-announce"]')].every((n) => n.getAttribute("aria-live") === "polite"))));
  check("once done, the progress view is gone", (await win.getByTestId("ai-assist-progress").count()) === 0);

  // ── 2. Warm runs ─────────────────────────────────────────────────────────────────────────────────
  console.log("\n2 — warm runs: no warm history, then one measured");
  provide({ ...SLOW, delayMs: 3_000, promptMs: 1_000 });
  await startSampling(win, "ai-assist-progress");
  await win.getByTestId("ai-assist-explain").click();
  check("the second run completes", (await assistSettles(win, "done")) === "done");
  const warm1 = await stopSampling(win);
  check("a warm run loads nothing", !warm1.some((s) => s.stage === "model-load"), distinct(warm1.map((s) => s.stage)));
  check("...and has no warm history yet, so no estimate", warm1.some((s) => /No time estimate yet/.test(s.eta ?? "")) && !warm1.some((s) => /left/.test(s.eta ?? "")), distinct(warm1.map((s) => s.eta)));
  await startSampling(win, "ai-assist-progress");
  await win.getByTestId("ai-assist-explain").click();
  check("the third run completes", (await assistSettles(win, "done")) === "done");
  const warm2 = await stopSampling(win);
  const etas = distinct(warm2.map((s) => s.eta).filter((e): e is string => Boolean(e)));
  check("now it shows a measured range from the one earlier warm run", etas.some((e) => /^About .* left \(from 1 earlier warm run here\)\.$/.test(e)), etas);

  // ── 3. Keyboard ──────────────────────────────────────────────────────────────────────────────────
  console.log("\n3 — keyboard");
  provide({ hang: true });
  await win.getByTestId("ai-assist-explain").focus();
  await win.keyboard.press("Enter");
  check("Enter on Explain starts the job", (await assistSettles(win, "loading")) === "loading");
  check("focus stays on the same control, now Cancel", (await win.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "ai-assist-cancel");
  await win.getByRole("progressbar", { name: "Local AI explanation progress" }).waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  await win.keyboard.press("Enter");
  check("Enter on Cancel cancels it", (await assistSettles(win, "cancelled")) === "cancelled");
  check("...and focus is still on the control, never dropped to the page", (await win.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "ai-assist-explain");

  // ── 4. Reduced motion ────────────────────────────────────────────────────────────────────────────
  console.log("\n4 — reduced motion");
  const sweep = async () =>
    win.evaluate(() => {
      const fill = document.querySelector('[data-testid="ai-assist-progress-bar"].indeterminate .ai-job-progress-fill');
      const track = document.querySelector('[data-testid="ai-assist-progress-bar"]');
      if (!fill || !track) return null;
      const style = getComputedStyle(fill);
      return { name: style.animationName, fillWidth: fill.getBoundingClientRect().width, trackWidth: track.getBoundingClientRect().width };
    });
  const indeterminate = () => win.waitForFunction(() => document.querySelector('[data-testid="ai-assist-progress-bar"].indeterminate') !== null, undefined, { timeout: 15_000 }).then(() => true, () => false);
  await win.emulateMedia({ reducedMotion: "reduce" });
  provide({ hang: true });
  await win.getByTestId("ai-assist-explain").click();
  const reduced = (await indeterminate()) ? await sweep() : null;
  check("with reduced motion the indeterminate bar does not sweep: a still, full track", reduced?.name === "none" && reduced.fillWidth >= reduced.trackWidth - 1, reduced);
  await win.getByTestId("ai-assist-cancel").click();
  await assistSettles(win, "cancelled");
  await win.emulateMedia({ reducedMotion: "no-preference" });
  await win.getByTestId("ai-assist-explain").click();
  const moving = (await indeterminate()) ? await sweep() : null;
  check("without it, the indeterminate sweep runs (so the check above is not vacuous)", moving?.name === "awkit-progress-sweep", moving);
  await win.getByTestId("ai-assist-cancel").click();
  await assistSettles(win, "cancelled");

  // ── 5. Inside a modal dialog ─────────────────────────────────────────────────────────────────────
  console.log("\n5 — the fragment dialog keeps its focus contract while a job runs");
  provide({ text: JSON.stringify({ version: 1, summary: "Fills a field and clicks to continue." }), delayMs: 4_000, promptMs: 1_000 });
  await win.getByTestId("fragment-insert-open").click();
  await win.getByTestId(`fragment-row-${FRAGMENT_ID}`).click();
  await win.getByTestId("fragment-ai-summarize").focus();
  await win.keyboard.press("Enter");
  check("the description shows its own named progress bar", await win.getByRole("progressbar", { name: "Local AI fragment description progress" }).waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false));
  const inDialog = () => win.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  check("...while focus stays inside the dialog", await inDialog());
  await win.keyboard.press("Tab");
  check("...and Tab keeps it inside (the trap holds while the job runs)", await inDialog());
  await win.waitForFunction(() => document.querySelector('[data-testid="fragment-ai-summary"]')?.getAttribute("data-assist-state") === "done", undefined, { timeout: 30_000 }).catch(() => undefined);
  check("the description completes and focus is still inside the dialog", (await win.getByTestId("fragment-ai-summary").getAttribute("data-assist-state")) === "done" && (await inDialog()));
  await win.getByTestId("fragment-insert-cancel").click();

  // ── 6. Settings → Time limits ────────────────────────────────────────────────────────────────────
  console.log("\n6 — Settings: time limits and measured speed");
  const panel = await openSettings(win);
  const limit = panel.getByRole("spinbutton", { name: "Validation explanation" });
  check("the pre-L9 settings file loads: every limit at its default (explanation 125 s)", (await limit.inputValue()) === "125" && (await panel.getByRole("table", { name: "Local AI time limits" }).getByRole("row").count()) === 8, await limit.inputValue());
  const before = readFileSync(settingsFile, "utf8");
  await limit.fill("5");
  await limit.press("Enter");
  const alert = panel.locator("#ai-budget-authoringExplanation-error");
  check("an out-of-range limit is refused with main's own bounds, as an alert", await alert.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false) && /from 15 to 600/.test(await alert.innerText()) && (await alert.getAttribute("role")) === "alert");
  check("...tied to the field (aria-describedby, aria-invalid)", (await limit.getAttribute("aria-invalid")) === "true" && ((await limit.getAttribute("aria-describedby")) ?? "").includes("ai-budget-authoringExplanation-error"));
  check("...and nothing was written or clamped", readFileSync(settingsFile, "utf8") === before);
  await limit.fill("15");
  await limit.press("Enter");
  const saved = await win.waitForFunction(() => true, undefined, { timeout: 100 }).then(async () => {
    for (let i = 0; i < 50; i += 1) {
      if (settingsOnDisk().timeBudgetSeconds?.authoringExplanation === 15) return true;
      await win.waitForTimeout(100);
    }
    return false;
  });
  check("a limit inside the bounds is saved as given", saved, settingsOnDisk().timeBudgetSeconds);
  check("...and the explanation feature's evidence no longer applies to it: nothing claims otherwise", !/Qualified on/.test(await panel.innerText()));
  const speed = panel.getByTestId("ai-measured-speed");
  check("the speed row shows what was measured on this machine, cold and warm", /Measured here: Validation explanation .*warm \(\d+ runs?\).*cold \(1 run\)/.test(await speed.innerText().catch(() => "")), await speed.innerText().catch(() => ""));

  await openFlow(win);
  provide({ hang: true });
  const started = Date.now();
  await win.getByTestId("ai-assist-explain").click();
  const outcome = await assistSettles(win, "failed", 45_000);
  const took = Date.now() - started;
  check("a job that never answers now ends at the 15 s limit, as a timeout", outcome === "failed" && /took too long/.test(await win.getByTestId("ai-assist-message").innerText()) && took >= 14_000 && took < 40_000, { outcome, took });

  const again = await openSettings(win);
  await again.getByRole("row").filter({ hasText: "Validation explanation" }).getByRole("button", { name: "Use default" }).click();
  const restored = await (async () => {
    for (let i = 0; i < 50; i += 1) {
      if (settingsOnDisk().timeBudgetSeconds?.authoringExplanation === undefined) return true;
      await win.waitForTimeout(100);
    }
    return false;
  })();
  // The file lands before Settings reloads its view, so wait for the field too rather than read it once.
  const shown = await win
    .waitForFunction(() => (document.getElementById("ai-budget-authoringExplanation") as HTMLInputElement | null)?.value === "125", undefined, { timeout: 10_000 })
    .then(() => true, () => false);
  check("Use default returns it to 125 s", restored && shown, await again.getByRole("spinbutton", { name: "Validation explanation" }).inputValue());

  // ── 7. Restart ───────────────────────────────────────────────────────────────────────────────────
  console.log("\n7 — the ETA history survives a restart");
  await app?.close();
  app = undefined;
  win = await launch();
  await signInExisting(win);
  await openFlow(win);
  provide(SLOW);
  await startSampling(win, "ai-assist-progress");
  await win.getByTestId("ai-assist-explain").click();
  check("the first run after the restart completes (cold again)", (await assistSettles(win, "done")) === "done");
  const restartedEtas = distinct((await stopSampling(win)).map((s) => s.eta).filter((e): e is string => Boolean(e)));
  check("...and its ETA comes from the cold run measured before the restart", restartedEtas.some((e) => /from 1 earlier cold run here/.test(e)), restartedEtas);

  // ── 8. What the history holds ───────────────────────────────────────────────────────────────────
  console.log("\n8 — the history file");
  const history = existsSync(historyFile) ? readFileSync(historyFile, "utf8") : "";
  const parsed = history ? (JSON.parse(history) as { schemaVersion: number; entries: Record<string, { cold: number[]; warm: number[] }> }) : null;
  check("it is versioned, under the app's data folder", parsed?.schemaVersion === 1 && historyFile.startsWith(probe.dataRoot));
  check("its keys are latency classes of this configuration (runtime build, CPU, the feature)", Object.keys(parsed?.entries ?? {}).some((k) => /\|cpu\|cpu\|ctx4096\|kv:runtime-default\|validationExplanation\|out176@cpu\d+-ram\d+g-novram$/.test(k)), Object.keys(parsed?.entries ?? {}));
  // Non-empty first: with no history at all every "none of these" would hold vacuously.
  check(
    "it holds durations only: no step name, typed value or answer text",
    Object.keys(parsed?.entries ?? {}).length > 0 &&
      !history.includes(STEP_NAME) &&
      !history.includes(TYPED) &&
      !history.includes("Fills a field") &&
      Object.values(parsed?.entries ?? {}).every((e) => [...e.cold, ...e.warm].length > 0 && [...e.cold, ...e.warm].every(Number.isInteger))
  );
} catch (error) {
  check("the GUI run completed", false, error instanceof Error ? error.stack : String(error));
} finally {
  await app?.close().catch(() => undefined);
  try {
    probe.cleanup();
  } catch {
    /* a Windows file lock on the temp profile is not a product failure */
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
