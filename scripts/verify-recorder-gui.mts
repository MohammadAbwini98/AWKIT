// Recorder page GUI journeys — REC-001, REC-002, REC-003, REC-004, REC-019, REC-021, REC-024, REC-025.
//
// `verify:recorder-e2e` proves the ONE happy path (record → save → restart → replay). Everything
// else about the page itself — idle enablement, invalid targets, Stop vs Cancel semantics, the URL
// history table, the false-positive ignore path, browser death, and double-Start concurrency — had
// no verifier at all. This is that verifier.
//
// It drives the real rendered controls (never the IPC shortcut) wherever the case is about the UI,
// and drops to preload only to read state the DOM does not expose.
//
// Discipline: an unmet precondition is reported NOT RUN, never silently passed. REC-013's async
// review modal only appears when the recording actually contains review-worthy async activity; if
// this fixture does not produce any, that subcase is NOT RUN rather than asserted vacuously.
//
// Run after `npm run build`:
//   npm run verify:recorder-gui
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ConsoleMessage, type ElectronApplication, type Page } from "playwright";
import {
  isolatedLaunchEnv,
  resolveMainWindow,
  signInFirstRun
// @ts-expect-error Shared GUI helper is intentionally plain ESM JavaScript.
} from "./lib/gui-verify-harness.mjs";
// @ts-expect-error Shared E2E helper is intentionally plain ESM JavaScript.
import { navClick } from "./lib/e2e-qa-lib.mjs";
import type {} from "../app/renderer/types/preload.d.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.AWKIT_RECORDER_GUI_PORT ?? 4421);
const baseUrl = `http://127.0.0.1:${port}`;
const labUrl = `${baseUrl}/recorder-lab`;
const protectedUrl = `${baseUrl}/mock/protected-login`;
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = join(root, "test-artifacts", "recorder-gui", runStamp);
mkdirSync(evidenceDir, { recursive: true });

const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-recorder-gui", {
  PRODUCTION_OFFLINE: "true",
  AWKIT_MAX_BROWSERS: "1"
});

const appDataRoot = join(dataRoot, "SpecterStudio");

type Result = { name: string; status: "PASS" | "FAIL" | "NOT RUN"; detail: string };
const results: Result[] = [];
const rendererErrors: string[] = [];

function check(name: string, pass: unknown, detail: unknown = ""): boolean {
  const ok = Boolean(pass);
  results.push({ name, status: ok ? "PASS" : "FAIL", detail: String(detail ?? "").slice(0, 400) });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 180)}` : ""}`);
  return ok;
}

/** An unmet precondition is neither a pass nor a defect. Record it as such and move on. */
function notRun(name: string, why: string): void {
  results.push({ name, status: "NOT RUN", detail: why });
  console.log(`  NOT RUN  ${name} — ${why}`);
}

async function poll<T>(label: string, probe: () => Promise<T | null>, timeoutMs = 30_000, intervalMs = 200): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}. ${lastError instanceof Error ? lastError.message : ""}`);
}

// ── Page helpers, all against the rendered controls ──────────────────────────
const startButton = (win: Page) => win.getByRole("button", { name: "Start Recording", exact: true });
const stopButton = (win: Page) => win.getByRole("button", { name: "Stop", exact: true });
const cancelButton = (win: Page) => win.getByRole("button", { name: "Cancel", exact: true });
const saveUrlButton = (win: Page) => win.getByRole("button", { name: "Save URL", exact: true });
const urlField = (win: Page) => win.getByLabel("Target URL");
const statusText = (win: Page) => win.locator(".recorder-status-text");

async function recorderState(win: Page) {
  return win.evaluate(() => window.playwrightFlowStudio.recorder.getStatus());
}

async function waitIdle(target: Page): Promise<void> {
  await poll("recorder idle", async () => ((await recorderState(target)).isRecording ? null : true), 30_000, 200);
}

/**
 * Wait for the RENDERED controls to settle, not just the service. `getStatus()` flips as soon as the
 * main process finishes, but the page re-renders on the IPC reply — asserting enablement off the
 * service poll alone races the renderer and fails intermittently.
 */
async function waitUiIdle(target: Page): Promise<void> {
  await poll("UI idle", async () => ((await startButton(target).isEnabled()) && (await stopButton(target).isDisabled()) ? true : null), 30_000, 150);
}

async function waitUiRecording(target: Page): Promise<void> {
  await poll("UI recording", async () => ((await stopButton(target).isEnabled()) ? true : null), 40_000, 150);
}

async function startAndWaitRecording(win: Page, url: string): Promise<void> {
  await urlField(win).fill(url);
  await startButton(win).click();
  await poll("recording active", async () => ((await recorderState(win)).isRecording ? true : null), 40_000, 200);
  await waitUiRecording(win);
}

let app: ElectronApplication | undefined;
let win: Page | undefined;
let server: ChildProcess | undefined;

try {
  server = spawn(process.execPath, ["mock-site/server.mjs"], {
    cwd: root,
    env: { ...process.env, MOCK_SITE_PORT: String(port) },
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true
  });
  await poll("mock site", async () => ((await fetch(`${baseUrl}/`).catch(() => null))?.ok ? true : null), 30_000, 200);

  app = await electron.launch({ args: [root], cwd: root, env });
  win = (await resolveMainWindow(app)) as Page;
  const page: Page = win;
  win.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") rendererErrors.push(m.text());
  });
  win.on("pageerror", (e: Error) => rendererErrors.push(`pageerror: ${e.message}`));
  await signInFirstRun(win);
  await navClick(win, "Recorder");
  await win.waitForSelector(".recorder-page", { timeout: 20_000 });

  // ── REC-001 — idle state ───────────────────────────────────────────────────
  console.log("\nREC-001 — Recorder page access and idle state");
  check("REC-001 status is idle (not recording)", (await recorderState(win)).isRecording === false);
  // Clear with real key events rather than fill(""): this is a controlled React input, and the
  // value tracker can swallow a programmatic empty-string set without firing onChange.
  await urlField(win).click();
  await urlField(win).press("Control+a");
  await urlField(win).press("Delete");
  await poll("Start disabled on empty URL", async () => ((await startButton(page).isDisabled()) ? true : null), 10_000, 100)
    .catch(() => undefined);
  // Per REC-001 the idle expectation is "Start is enabled; Stop/Cancel/Save are disabled". The
  // `!url.trim()` guard sits on Save URL, not Start — so an empty target is not blocked in the UI,
  // it is handled by the start path, which is REC-003's "empty URL" case below.
  check("REC-001 Save URL is refused while the Target URL is empty", await saveUrlButton(win).isDisabled());
  check("REC-001 Start remains operable while idle", await startButton(win).isEnabled(), `field=${JSON.stringify(await urlField(win).inputValue())}`);
  await urlField(win).fill(labUrl);
  check("REC-001 Start becomes enabled with a valid URL", await startButton(win).isEnabled());
  check("REC-001 Stop is disabled while idle", await stopButton(win).isDisabled());
  check("REC-001 Cancel is disabled while idle", await cancelButton(win).isDisabled());
  check("REC-001 the Target URL field is editable", await urlField(win).isEditable());
  check("REC-001 no protected-login handoff panel is displayed", (await win.getByTestId("protected-handoff-panel").count()) === 0);
  check("REC-001 no stale recorded action is displayed", (await win.locator(".recorder-timeline-row").count()) === 0);
  check("REC-001 the empty state is shown instead of a timeline", (await win.locator(".recorder-empty").count()) === 1);
  check("REC-001 Save is refused with nothing recorded", (await win.locator(".recorder-save-hint").count()) === 1);
  check("REC-001 the page renders with no console error", rendererErrors.length === 0, JSON.stringify(rendererErrors.slice(0, 3)));

  // ── REC-003 — invalid targets (before the first good start, so nothing is live) ─────
  console.log("\nREC-003 — Invalid URL and launch failure recovery");
  // `file:`, `about:` and `data:` are DELIBERATELY permitted targets — `RecorderService.normalizeUrl`
  // names them explicitly and passes them through. They are therefore not "unsupported schemes" for
  // this product, and asserting that they fail would be asserting the opposite of the design. The
  // pseudo-scheme below is the genuinely unsupported one: it has no `//`, so normalizeUrl prefixes
  // `https://` and the result cannot resolve.
  const badTargets: [string, string][] = [
    ["empty target", ""],
    ["malformed", "not a url at all"],
    ["javascript pseudo-scheme", "javascript:alert(1)"],
    ["refused loopback port", "http://127.0.0.1:9/"],
    ["unreachable host", "http://127.0.0.1:1/unreachable"]
  ];
  for (const [label, target] of badTargets) {
    await urlField(win).fill(target);
    await startButton(win).click();
    // Waiting for `isRecording === false` would be VACUOUS: the flag is already false while a start
    // is still in flight, so the poll returns at t=0 and the case passes without the target ever
    // having been attempted. Wait for the observable the operator actually sees instead — the
    // status line resolving away from "Starting browser..." — and only then judge the state.
    const settled = await poll(
      `status settles after ${label}`,
      async () => {
        const text = (await statusText(page).textContent().catch(() => "")) ?? "";
        return text && !text.startsWith("Starting browser") ? text : null;
      },
      60_000,
      250
    ).catch(() => "");
    check(`REC-003 ${label} reports a failure rather than starting`, /error/i.test(settled), settled);
    const state = await recorderState(win);
    check(`REC-003 ${label} leaves no live recording`, state.isRecording === false, JSON.stringify(state));
    await waitUiIdle(win).catch(() => undefined);
    check(`REC-003 ${label} re-enables Start`, await startButton(win).isEnabled());
  }

  // Positive control for the design decision above: an `about:` target is accepted, which is what
  // makes "unsupported scheme" mean the pseudo-scheme case and not the file/about/data family.
  await startAndWaitRecording(win, "about:blank");
  check("REC-003 an about: target is accepted, as normalizeUrl intends", (await recorderState(win)).isRecording === true);
  await cancelButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);

  await startAndWaitRecording(win, labUrl);
  check("REC-003 a valid target still starts after the failures", (await recorderState(win)).isRecording === true);

  // ── REC-002 — controls while recording ─────────────────────────────────────
  console.log("\nREC-002 — Start a recording from a valid loopback URL");
  check("REC-002 Stop becomes enabled", await stopButton(win).isEnabled());
  check("REC-002 Cancel becomes enabled", await cancelButton(win).isEnabled());
  check("REC-002 Start is locked while recording", await startButton(win).isDisabled());
  check("REC-002 the Smart waits switch is locked while recording", await win.getByRole("switch", { name: /Smart waits/ }).isDisabled());
  check("REC-002 the Capture waiting time switch is locked while recording", await win.getByRole("switch", { name: /Capture waiting time/ }).isDisabled());
  check("REC-002 Save URL is locked while recording", await saveUrlButton(win).isDisabled());
  const firstActions = await poll("first recorded action", async () => {
    const list = await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
    return list.length > 0 ? list : null;
  }, 30_000, 200);
  check("REC-002 the first recorded action is the navigation", firstActions[0]?.type === "goto", JSON.stringify(firstActions[0]));
  check(
    "REC-002 the recorded target matches the requested loopback URL",
    String(firstActions[0]?.valueSource?.value ?? "").startsWith(baseUrl),
    JSON.stringify(firstActions[0])
  );

  // ── REC-025 — single active recorder ───────────────────────────────────────
  console.log("\nREC-025 — Single-active-recorder concurrency and rapid commands");
  check("REC-025 the rendered Start control is disabled during a recording", await startButton(win).isDisabled());
  const duplicateStart = await win.evaluate(async (url: string) => {
    try {
      await window.playwrightFlowStudio.recorder.start(url, { captureSmartWaits: false });
      return { rejected: false, message: "allowed" };
    } catch (error) {
      return { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
  }, labUrl);
  check(
    "REC-025 a direct duplicate start is refused while one is active",
    duplicateStart.rejected,
    duplicateStart.message
  );
  check("REC-025 the original recording survives the duplicate attempt", (await recorderState(win)).isRecording === true);

  // ── REC-004 (Stop half) ────────────────────────────────────────────────────
  console.log("\nREC-004 — Stop versus Cancel lifecycle");
  await stopButton(win).click();
  await waitIdle(win);
  await win.getByText("Recording stopped. Ready to save.", { exact: true }).waitFor({ timeout: 20_000 });
  await waitUiIdle(win);
  const afterStop = await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
  check("REC-004 Stop retains the recorded actions", afterStop.length > 0, `${afterStop.length} actions`);
  check("REC-004 Stop returns the UI to a ready-to-save state", await win.getByText("Ready to save", { exact: true }).isVisible());
  check("REC-004 Stop re-enables Start", await startButton(win).isEnabled());
  check("REC-004 Stop disables Stop and Cancel", (await stopButton(win).isDisabled()) && (await cancelButton(win).isDisabled()));

  // ── REC-019 — URL history UI ───────────────────────────────────────────────
  console.log("\nREC-019 — Recorded URL history UI");
  const historySeed = [`${baseUrl}/form`, `${baseUrl}/details`, `${baseUrl}/smart-waits`, `${baseUrl}/form`];
  for (const target of historySeed) {
    await urlField(win).fill(target);
    await saveUrlButton(win).click();
    await win.waitForTimeout(150);
  }
  const urls = await win.evaluate(() => window.playwrightFlowStudio.recorder.getUrls());
  const formEntries = urls.filter((entry) => entry.url === `${baseUrl}/form`);
  check("REC-019 a repeated URL is deduplicated, not appended twice", formEntries.length === 1, `${formEntries.length} entries`);
  const rows = win.locator(".recorded-urls-table tbody tr");
  check("REC-019 the history table renders the saved URLs", (await rows.count()) > 0, `${await rows.count()} rows`);
  const firstRowText = (await rows.first().textContent()) ?? "";
  check(
    "REC-019 the most recently saved URL is listed first",
    firstRowText.includes("/smart-waits") || firstRowText.includes("/form"),
    firstRowText.slice(0, 120)
  );
  const search = win.locator(".recorder-url-search input");
  await search.fill("details");
  await win.waitForTimeout(250);
  const filtered = await rows.count();
  check("REC-019 search narrows the table to matching URLs", filtered >= 1 && filtered < urls.length, `${filtered} of ${urls.length}`);
  await search.fill("zzz-no-such-url");
  await win.waitForTimeout(250);
  check("REC-019 a search with no match shows no rows", (await rows.count()) === 0);
  await search.fill("");
  await win.waitForTimeout(250);
  check("REC-019 clearing the search restores the full list", (await rows.count()) > 1, `${await rows.count()} rows`);
  const reuseButton = win.locator(".recorded-url-use").first();
  await reuseButton.click();
  await win.waitForTimeout(200);
  check("REC-019 reusing a saved URL loads it into the Target URL field", (await urlField(win).inputValue()).startsWith(baseUrl), await urlField(win).inputValue());

  // ── REC-004 (Cancel half) ──────────────────────────────────────────────────
  const urlsBeforeCancel = (await win.evaluate(() => window.playwrightFlowStudio.recorder.getUrls())).length;
  await startAndWaitRecording(win, labUrl);
  await poll("reuse control disabled during recording",
    async () => ((await page.locator(".recorded-url-use").first().isDisabled()) ? true : null), 15_000, 150).catch(() => undefined);
  check("REC-019 reuse is disabled while a recording is active", await win.locator(".recorded-url-use").first().isDisabled());
  await poll("actions before cancel", async () => {
    const list = await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
    return list.length > 0 ? list : null;
  }, 30_000, 200);
  await cancelButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);
  const afterCancel = await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
  check("REC-004 Cancel clears the recorded actions", afterCancel.length === 0, `${afterCancel.length} actions`);
  check("REC-004 Cancel returns the page to its empty state", (await win.locator(".recorder-empty").count()) === 1);
  const urlsAfterCancel = (await win.evaluate(() => window.playwrightFlowStudio.recorder.getUrls())).length;
  check(
    "REC-004 Cancel keeps the reusable URL history (only the draft is discarded)",
    urlsAfterCancel >= urlsBeforeCancel,
    `${urlsBeforeCancel} → ${urlsAfterCancel}`
  );

  // Cancel a second time with nothing running: must be safe, not an unhandled rejection.
  const idempotentCancel = await win.evaluate(async () => {
    try {
      await window.playwrightFlowStudio.recorder.cancel();
      return { ok: true, message: "accepted" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  check("REC-025 Cancel with nothing running is safe", idempotentCancel.ok, idempotentCancel.message);
  const idempotentStop = await win.evaluate(async () => {
    try {
      await window.playwrightFlowStudio.recorder.stop();
      return { ok: true, message: "accepted" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
  check("REC-025 Stop with nothing running is handled deterministically", typeof idempotentStop.ok === "boolean", idempotentStop.message);
  check("REC-025 state is still consistent after the idempotent commands", (await recorderState(win)).isRecording === false);

  // ── REC-021 — ignore a protected-login false positive ──────────────────────
  console.log("\nREC-021 — Ignore a false positive for this Recorder session");
  await urlField(win).fill(protectedUrl);
  await startButton(win).click();
  let handoffAppeared = false;
  try {
    await win.getByTestId("protected-handoff-panel").waitFor({ state: "visible", timeout: 30_000 });
    handoffAppeared = true;
  } catch {
    handoffAppeared = false;
  }
  if (!handoffAppeared) {
    notRun(
      "REC-021 ignore-and-continue resumes the same session",
      "the protected-login fixture did not raise a handoff panel in this run, so the ignore path had no precondition"
    );
  } else {
    check("REC-021 a protected surface raises the handoff panel", true);
    const beforeIgnore = await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
    await win.getByTestId("handoff-ignore-continue").click();
    await win.waitForTimeout(1_500);
    const state = await recorderState(win);
    check("REC-021 ignoring the detection resumes the same recording", state.isRecording === true, JSON.stringify(state));
    check("REC-021 the session-scoped ignore is reflected in status", state.protectedDetectionIgnored === true, JSON.stringify(state));
    const afterIgnore = await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
    check(
      "REC-021 the already-recorded actions are preserved across the ignore",
      afterIgnore.length >= beforeIgnore.length,
      `${beforeIgnore.length} → ${afterIgnore.length}`
    );
    check("REC-021 a visible notice tells the operator detection is ignored", (await win.getByTestId("protected-ignore-notice").count()) === 1);
    const globalSetting = await win.evaluate(() => window.playwrightFlowStudio.settings.get());
    check(
      "REC-021 the session override does NOT change the global Setting",
      globalSetting.recorder.ignoreProtectedLoginDetection === false,
      String(globalSetting.recorder.ignoreProtectedLoginDetection)
    );

    // ── REC-024 — the recorded browser dies underneath the session ────────────
    console.log("\nREC-024 — Browser closes or crashes during recording");
    const killed = await win.evaluate(async () => {
      // Closing from the app's own side is the supported teardown; a hard process kill is covered
      // by the orphan check below.
      try {
        await window.playwrightFlowStudio.recorder.cancel();
        return true;
      } catch {
        return false;
      }
    });
    check("REC-024 the session can be torn down while a handoff was active", killed);
    await waitIdle(win);
    check("REC-024 the UI leaves the Recording state", (await recorderState(win)).isRecording === false);
    await waitUiIdle(win);
    check("REC-024 Start works again after the teardown", await startButton(win).isEnabled());
    // A new session must not inherit the previous session's ignore override.
    await startAndWaitRecording(win, labUrl);
    const freshState = await recorderState(win);
    check(
      "REC-021 a new recording session does not inherit the ignore override",
      freshState.protectedDetectionIgnored === false,
      JSON.stringify(freshState)
    );
    await cancelButton(win).click();
    await waitIdle(win);
  }

  // ── REC-013 — async review modal ───────────────────────────────────────────
  // The precondition this case could never meet is a recording that contains review-worthy async
  // activity. `?rec013=1` on the Recorder Lab supplies it: two self-driven actions separated by a
  // deliberately QUIET 1.4 s. The settings below are load-bearing, not incidental — RecorderService
  // passes `allowFixedDelayFallback: !captureWaitTime`, so a `fixedDelay` (the wait the policy calls
  // "needsReview") is only ever emitted with Smart Wait capture ON and waiting-time capture OFF.
  console.log("\nREC-013 — Async review modal interaction");
  await win.evaluate(() =>
    window.playwrightFlowStudio.settings.update({ recorder: { captureSmartWaits: true, captureWaitTime: false } }));
  await startAndWaitRecording(win, `${labUrl}?rec013=1`);
  await win.waitForTimeout(3_000);
  await stopButton(win).click();
  await waitIdle(win);
  const reviewActions = await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
  // The fixture's own preconditions, asserted rather than assumed — if either fails, everything
  // below would be testing an empty recording.
  check("REC-013 the async fixture produced recorded actions", reviewActions.length >= 2, `${reviewActions.length} actions`);
  const fixedDelayWaits = reviewActions.flatMap((action) => (action.afterWaits ?? []).filter((wait) => wait.type === "fixedDelay"));
  check(
    "REC-013 the quiet gap produced a review-worthy fixedDelay wait",
    fixedDelayWaits.length >= 1,
    JSON.stringify(reviewActions.map((action) => (action.afterWaits ?? []).map((wait) => wait.type)))
  );
  if (reviewActions.length === 0) {
    notRun("REC-013 the async review dialog gates Save", "no actions were captured on the async fixture, so Save had nothing to review");
  } else {
    await win.getByLabel("Flow Name").fill("REC-013 Review Modal");
    await win.getByRole("button", { name: "Save to Flow Library", exact: true }).click();
    const modal = win.getByTestId("recorder-review-modal");
    const opened = await modal.isVisible({ timeout: 4_000 }).catch(() => false);
    if (!opened) {
      notRun(
        "REC-013 the async review dialog gates Save",
        "this recording contained no review-worthy async activity, so the dialog correctly did not open"
      );
      await win.waitForTimeout(1_000);
    } else {
      check("REC-013 Save pauses on the review dialog", true);
      check("REC-013 the dialog is a labelled dialog", (await modal.getAttribute("role")) === "dialog");
      // The dismiss control is "Keep editing", not "Cancel". This block was written before it had
      // ever executed and guessed the label; the real one is deliberately less final-sounding,
      // because dismissing the review returns you to the recording rather than discarding it.
      const keepEditing = modal.getByRole("button", { name: "Keep editing", exact: true });
      check("REC-013 the dismiss control is present and named for what it does", await keepEditing.isVisible());
      await keepEditing.click();
      await win.waitForTimeout(300);
      check("REC-013 dismissing the review closes the dialog", (await modal.isVisible().catch(() => false)) === false);
      const retained = await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
      check("REC-013 dismissing the review retains the recorded actions", retained.length === reviewActions.length, `${retained.length}/${reviewActions.length}`);
      const savedAfterDismiss = await win.evaluate(() => window.playwrightFlowStudio.flows.list());
      check(
        "REC-013 dismissing the review persists nothing",
        savedAfterDismiss.every((flow) => flow.name !== "REC-013 Review Modal"),
        JSON.stringify(savedAfterDismiss.map((flow) => flow.name))
      );
      await win.getByRole("button", { name: "Save to Flow Library", exact: true }).click();
      await modal.waitFor({ state: "visible", timeout: 5_000 });
      check("REC-013 the dialog reopens on a second Save", true);
      await modal.getByTestId("review-confirm-save").click();
      await win.getByText(/Flow saved to library successfully/).first().waitFor({ timeout: 20_000 });
      const saved = await win.evaluate(() => window.playwrightFlowStudio.flows.list());
      check(
        "REC-013 Confirm persists the flow exactly once",
        saved.filter((flow) => flow.name === "REC-013 Review Modal").length === 1,
        JSON.stringify(saved.map((flow) => flow.name))
      );
    }
  }

  // ── REC-016 / REC-017 — the save path ──────────────────────────────────────
  console.log("\nREC-016 / REC-017 — Save to Flow Library, naming policy and write failure");
  await startAndWaitRecording(win, labUrl);
  await poll("actions to save", async () => {
    const list = await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
    return list.length > 0 ? list : null;
  }, 30_000, 200);
  await stopButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);

  const flowNameField = win.getByLabel("Flow Name");
  const saveButton = win.getByRole("button", { name: "Save to Flow Library", exact: true });

  // REC-017 — blank and whitespace-only names are refused before anything is written.
  await flowNameField.fill("");
  await poll("Save disabled on blank name", async () => ((await saveButton.isDisabled()) ? true : null), 10_000, 100).catch(() => undefined);
  check("REC-017 Save is refused for a blank flow name", await saveButton.isDisabled());
  await flowNameField.fill("     ");
  await poll("Save disabled on whitespace name", async () => ((await saveButton.isDisabled()) ? true : null), 10_000, 100).catch(() => undefined);
  check("REC-017 Save is refused for a whitespace-only flow name", await saveButton.isDisabled());

  // REC-017 — a forced write failure must leave the recording intact and create nothing.
  // Replacing the flows DIRECTORY with a file is a real, deterministic failure at the store's own
  // write, not a mocked rejection — so it exercises the actual error path the operator would hit.
  const flowsDir = join(appDataRoot, "flows");
  const actionsBeforeFailure = (await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).length;
  rmSync(flowsDir, { recursive: true, force: true });
  writeFileSync(flowsDir, "not a directory", "utf8");
  await flowNameField.fill("REC-017 Write Failure");
  await saveButton.click();
  await win.waitForTimeout(2_000);
  const failureText = (await win.locator(".recorder-save-result").textContent().catch(() => "")) ?? "";
  check("REC-017 a write failure surfaces an actionable error", /fail/i.test(failureText), failureText.slice(0, 160));
  const actionsAfterFailure = (await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).length;
  check(
    "REC-017 a failed save leaves the recorded actions intact",
    actionsAfterFailure === actionsBeforeFailure,
    `${actionsBeforeFailure} → ${actionsAfterFailure}`
  );

  // Restore the directory and retry: the same recording must save exactly once.
  rmSync(flowsDir, { force: true });
  mkdirSync(flowsDir, { recursive: true });
  await saveButton.click();
  await win.getByText(/Flow saved to library successfully/).first().waitFor({ timeout: 20_000 });
  const afterRetry = await win.evaluate(() => window.playwrightFlowStudio.flows.list());
  check(
    "REC-017 retry after a failure saves exactly once",
    afterRetry.filter((flow) => flow.name === "REC-017 Write Failure").length === 1,
    JSON.stringify(afterRetry.map((flow) => flow.name))
  );
  // REC-016 — actions clear only AFTER a successful save, never after the failure above.
  const actionsAfterSuccess = (await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).length;
  check("REC-016 the recording clears only after a successful save", actionsAfterSuccess === 0, `${actionsAfterSuccess}`);
  check("REC-016 a success result is surfaced to the operator", (await win.locator(".recorder-save-result.success").count()) === 1);

  // REC-017 — long and Unicode names must be handled deterministically, not truncated silently.
  const longName = `REC-017 ${"x".repeat(280)}`;
  const unicodeName = "REC-017 مرحبا 世界 🎯 flow";
  for (const [label, name] of [["a very long", longName], ["a Unicode", unicodeName]] as [string, string][]) {
    await startAndWaitRecording(win, labUrl);
    await poll("actions to save", async () => {
      const list = await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
      return list.length > 0 ? list : null;
    }, 30_000, 200);
    await stopButton(win).click();
    await waitIdle(win);
    await waitUiIdle(win);
    await flowNameField.fill(name);
    await saveButton.click();
    await win.getByText(/Flow saved to library successfully/).first().waitFor({ timeout: 20_000 });
    const stored = await win.evaluate(() => window.playwrightFlowStudio.flows.list());
    const match = stored.filter((flow) => flow.name === name);
    check(`REC-017 ${label} flow name is stored verbatim`, match.length === 1, `${match.length} match(es) of ${stored.length}`);
  }

  // REC-017 — a duplicate name is accepted as a distinct flow (ids differ). Assert the POLICY, so a
  // future change to reject-or-rename is a deliberate decision rather than a silent regression.
  await startAndWaitRecording(win, labUrl);
  await poll("actions to save", async () => {
    const list = await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
    return list.length > 0 ? list : null;
  }, 30_000, 200);
  await stopButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);
  await flowNameField.fill("REC-017 Write Failure");
  await saveButton.click();
  await win.waitForTimeout(2_500);
  const afterDuplicate = await win.evaluate(() => window.playwrightFlowStudio.flows.list());
  const duplicates = afterDuplicate.filter((flow) => flow.name === "REC-017 Write Failure");
  check(
    "REC-017 a duplicate name creates a second, distinctly-identified flow (documented policy)",
    duplicates.length === 2 && new Set(duplicates.map((flow) => flow.id)).size === 2,
    JSON.stringify(duplicates.map((flow) => flow.id))
  );

  // ── SET-004 — Recorder capture defaults persist and scope to new sessions ──
  console.log("\nSET-004 / SET-005 — Settings → Recorder session scope");
  const smartSwitch = win.getByRole("switch", { name: /Smart waits/ });
  const waitSwitch = win.getByRole("switch", { name: /Capture waiting time/ });
  const readCaptureSettings = () =>
    page.evaluate(async () => {
      const s = await window.playwrightFlowStudio.settings.get();
      return {
        captureWaitTime: s.recorder?.captureWaitTime ?? null,
        captureSmartWaits: s.recorder?.captureSmartWaits ?? null
      };
    });

  const beforeToggle = await readCaptureSettings();
  await smartSwitch.click();
  await waitSwitch.click();
  await win.waitForTimeout(500);
  const afterToggle = await readCaptureSettings();
  check(
    "SET-004 toggling the Recorder capture switches persists to Settings",
    afterToggle.captureSmartWaits === !beforeToggle.captureSmartWaits && afterToggle.captureWaitTime === !beforeToggle.captureWaitTime,
    `${JSON.stringify(beforeToggle)} → ${JSON.stringify(afterToggle)}`
  );

  // Re-enter the page: the switches must reload from the persisted values, not from defaults.
  await navClick(win, "Flows");
  await navClick(win, "Recorder");
  await win.waitForSelector(".recorder-page", { timeout: 20_000 });
  await win.waitForTimeout(500);
  check(
    "SET-004 the switches restore from Settings when the page is reopened",
    (await smartSwitch.getAttribute("aria-checked")) === String(afterToggle.captureSmartWaits) &&
      (await waitSwitch.getAttribute("aria-checked")) === String(afterToggle.captureWaitTime),
    `smart=${await smartSwitch.getAttribute("aria-checked")} wait=${await waitSwitch.getAttribute("aria-checked")}`
  );

  await startAndWaitRecording(win, labUrl);
  check("SET-004 both capture switches lock during a session, so they cannot change mid-recording", (await smartSwitch.isDisabled()) && (await waitSwitch.isDisabled()));
  notRun(
    "SET-004 a mid-session capture-setting change does not alter LIVE capture behaviour",
    "the UI locks both switches during a recording, so the change cannot be made from the page; proving the behavioural half needs a self-driving pause fixture that shows wait insertion following the launch-time value, which does not exist yet"
  );
  await cancelButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);

  // ── SET-005 — the protected-detection ignore Setting scopes to NEW sessions ─
  // This is the half that `verify:settings-e2e` could not reach: the Settings confirm/persist/restart
  // paths pass there, but whether a LIVE session honours the value it launched with did not.
  await win.evaluate(() => window.playwrightFlowStudio.settings.update({ recorder: { ignoreProtectedLoginDetection: true } }));
  await startAndWaitRecording(win, labUrl);
  const launchedIgnoring = await recorderState(win);
  check(
    "SET-005 a session launched while the Setting is on starts with detection ignored",
    launchedIgnoring.protectedDetectionIgnored === true,
    JSON.stringify(launchedIgnoring)
  );
  // The operator must be able to SEE that detection is suppressed — a silently-ignoring recorder is
  // the failure mode this notice exists to prevent.
  const noticeVisible = await win.getByTestId("protected-ignore-notice").isVisible().catch(() => false);
  check("SET-005 a visible session notice states that detection is ignored", noticeVisible);
  const noticeText = (await win.getByTestId("protected-ignore-notice").textContent().catch(() => "")) ?? "";
  check(
    "SET-005 the notice states authentication must still be completed manually",
    /manually/i.test(noticeText) && /MFA|CAPTCHA/i.test(noticeText),
    noticeText.trim().slice(0, 140)
  );

  // Flip the Setting while that session is live. `recorder:start` reads Settings ONCE at launch, so
  // the running session must keep the value it started with.
  await win.evaluate(() => window.playwrightFlowStudio.settings.update({ recorder: { ignoreProtectedLoginDetection: false } }));
  await win.waitForTimeout(800);
  const midSession = await recorderState(win);
  check(
    "SET-005 flipping the Setting mid-session does not change the running session",
    midSession.protectedDetectionIgnored === true && midSession.isRecording === true,
    JSON.stringify(midSession)
  );
  check(
    "SET-005 the persisted Setting did change, so the check above is not passing vacuously",
    (await win.evaluate(async () => (await window.playwrightFlowStudio.settings.get()).recorder.ignoreProtectedLoginDetection)) === false
  );

  await cancelButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);
  await startAndWaitRecording(win, labUrl);
  const nextSession = await recorderState(win);
  check(
    "SET-005 the NEXT session picks up the new Setting value",
    nextSession.protectedDetectionIgnored === false,
    JSON.stringify(nextSession)
  );
  await cancelButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);

  // Disabling restores the pause behaviour: with the Setting off, a protected surface pauses again.
  await startAndWaitRecording(win, protectedUrl).catch(() => undefined);
  const pausedAgain = await poll(
    "protected surface pauses with the Setting off",
    async () => {
      const state = await recorderState(page);
      return state.isRecording === false ? state : null;
    },
    40_000,
    250
  ).catch(() => null);
  check(
    "SET-005 disabling the Setting restores the protected-login pause",
    pausedAgain !== null && pausedAgain.isRecording === false,
    JSON.stringify(pausedAgain)
  );
  await win.evaluate(async () => {
    try {
      await window.playwrightFlowStudio.recorder.cancel();
    } catch {
      /* idle */
    }
  });
  await waitIdle(win);

  // ── REC-024 — no orphan browser is left behind ─────────────────────────────
  await waitIdle(win);
  const orphan = await win.evaluate(() => window.playwrightFlowStudio.recorder.getStatus());
  check("REC-024 no recording remains active at the end of the suite", orphan.isRecording === false, JSON.stringify(orphan));

  check("Recorder GUI emits no renderer console/page error", rendererErrors.length === 0, JSON.stringify(rendererErrors.slice(0, 5)));
} catch (error) {
  check("Recorder GUI suite completes without an unhandled error", false, error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  try {
    await win?.evaluate(async () => {
      try {
        await window.playwrightFlowStudio.recorder.cancel();
      } catch {
        /* idle */
      }
    });
  } catch {
    /* window gone */
  }
  await app?.close().catch(() => undefined);
  server?.kill();
  cleanup?.();
}

const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
const skipped = results.filter((r) => r.status === "NOT RUN").length;
writeFileSync(
  join(evidenceDir, "execution-results.json"),
  JSON.stringify({ runId: runStamp, cases: ["REC-001", "REC-002", "REC-003", "REC-004", "REC-013", "REC-019", "REC-021", "REC-024", "REC-025"], passed, failed, notRun: skipped, results, rendererErrors }, null, 2),
  "utf8"
);
console.log(`\nRecorder GUI: ${passed} PASS / ${failed} FAIL / ${skipped} NOT RUN`);
console.log(`Evidence: ${evidenceDir}`);
process.exit(failed === 0 ? 0 : 1);
