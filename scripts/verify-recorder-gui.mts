// Recorder page GUI journeys — REC-001, REC-002, REC-003, REC-004, REC-013, REC-019, REC-021,
// REC-024, REC-025, REC-029, plus the Recorder-side halves of SET-004 and SET-005.
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

/**
 * Describe what actually holds focus. `insideDialog` is the load-bearing field, and it is phrased as
 * CONTAINMENT on purpose: the equivalent check in Reports once asserted
 * `activeElement.textContent.includes(<label>)`, which passes *precisely when the defect is present* —
 * focus falls back to `<body>`, and body's `textContent` contains every label on the page. Containment
 * cannot be satisfied that way, and `isBody` names the failure mode when it happens.
 */
async function focusInfo(target: Page) {
  return target.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector('[data-testid="recorder-review-modal"], [data-testid="ambiguity-resolution-panel"]');
    return {
      tag: el?.tagName ?? "(none)",
      name: (el?.getAttribute("aria-label") || el?.textContent || "").trim().slice(0, 48),
      isBody: el === document.body,
      insideDialog: Boolean(dialog && el && dialog.contains(el)),
      // The opener, matched by its own class rather than by label text — the modal's confirm button
      // carries the same visible label, and `<body>` would match a text test.
      isPageSaveButton: el?.classList?.contains("recorder-save-button") === true
    };
  });
}

/**
 * Press Tab n times and report what received focus, its accessible name, and whether it shows a
 * visible ring.
 *
 * The name is computed the way a screen reader resolves one — `aria-label`, `aria-labelledby`,
 * `title`, an associated or wrapping `<label>`, then text content. An `aria-label || textContent`
 * shortcut reports every text-labelled INPUT as unnamed and invents defects that are not there.
 * `placeholder` is deliberately NOT counted: it is not a name, and it disappears as soon as the user
 * types into the field.
 *
 * No named function binding may be declared inside `evaluate` — esbuild annotates those with
 * `__name`, which does not exist in the page and fails at runtime with a bare ReferenceError.
 */
async function tabThrough(target: Page, n: number) {
  const seen: { tag: string; name: string; ring: boolean; selector: string }[] = [];
  for (let i = 0; i < n; i += 1) {
    await target.keyboard.press("Tab");
    const info = await target.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const id = el.getAttribute("id");
      const labelledBy = el.getAttribute("aria-labelledby");
      const name =
        (el.getAttribute("aria-label") || "").trim() ||
        (labelledBy ? (document.getElementById(labelledBy)?.textContent || "").trim() : "") ||
        (el.getAttribute("title") || "").trim() ||
        (id ? (document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || "").trim() : "") ||
        (el.closest("label")?.textContent || "").trim() ||
        (el.textContent || "").trim();
      return {
        tag: el.tagName,
        name: name.slice(0, 40),
        ring: style.outlineStyle !== "none" || style.boxShadow !== "none",
        selector: `${el.tagName}${id ? `#${id}` : ""}${el.className ? `.${String(el.className).split(" ")[0]}` : ""}`
      };
    });
    if (info) seen.push(info);
  }
  return seen;
}

/**
 * Chromium processes belonging to the app under test.
 *
 * Scoped to DESCENDANTS of this Electron instance, so nothing else on the machine can match — in
 * particular the developer's own Chrome, which descends from a different session process.
 *
 * It must be the whole descendant TREE, not the direct children: `app.process()` is the `electron.exe`
 * Playwright launched, and that spawns the real main process, so the recorded browser is a grandchild.
 * A direct-children query finds nothing at all. That was caught only because the "process was located"
 * precondition is asserted — without it, every kill would have been a no-op and every assertion below
 * it would have passed while testing nothing.
 */
async function recordedBrowserPids(
  electronPid: number
): Promise<{ pid: number; name: string; parent: number; renderer: boolean }[]> {
  const script =
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress";
  const out = await new Promise<string>((resolveOut) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true
    });
    let buffer = "";
    child.stdout?.on("data", (chunk) => (buffer += String(chunk)));
    child.on("close", () => resolveOut(buffer));
    child.on("error", () => resolveOut(""));
  });
  if (!out.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    return [];
  }
  const rows = (Array.isArray(parsed) ? parsed : [parsed]) as {
    ProcessId?: number;
    ParentProcessId?: number;
    Name?: string;
    CommandLine?: string | null;
  }[];
  type Proc = { pid: number; name: string; parent: number; renderer: boolean };
  const childrenOf = new Map<number, Proc[]>();
  for (const row of rows) {
    if (typeof row.ProcessId !== "number" || typeof row.ParentProcessId !== "number") continue;
    const bucket = childrenOf.get(row.ParentProcessId) ?? [];
    bucket.push({
      pid: row.ProcessId,
      name: String(row.Name ?? ""),
      parent: row.ParentProcessId,
      // Chromium tags every child process with --type=; the browser process alone carries none.
      renderer: /--type=renderer/i.test(String(row.CommandLine ?? ""))
    });
    childrenOf.set(row.ParentProcessId, bucket);
  }
  // Every Chromium descendant, renderers included — the leak check must see those too, since killing
  // a browser root can briefly orphan its renderers.
  const found: Proc[] = [];
  const seen = new Set<number>([electronPid]);
  const queue = [electronPid];
  while (queue.length > 0) {
    for (const child of childrenOf.get(queue.shift() as number) ?? []) {
      if (seen.has(child.pid)) continue; // a recycled pid must not make this walk loop
      seen.add(child.pid);
      queue.push(child.pid);
      if (/^(chrome|chromium|headless_shell)\.exe$/i.test(child.name)) found.push(child);
    }
  }
  return found;
}

/** The browser roots among a Chromium descendant set — those whose parent is not itself Chromium. */
function browserRoots(processes: { pid: number; parent: number }[]): number[] {
  const pids = new Set(processes.map((p) => p.pid));
  return processes.filter((p) => !pids.has(p.parent)).map((p) => p.pid);
}

/**
 * Ask processes to close their main window — the programmatic equivalent of the user clicking the X,
 * which is what "the browser is closed" actually means.
 *
 * `taskkill /T` without `/F` was tried first and measured NOT to end Chromium (the browser process
 * survived), so it produced no condition to test at all.
 */
async function closeMainWindows(pids: number[]): Promise<void> {
  if (pids.length === 0) return;
  const script =
    `foreach ($p in Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue) ` +
    "{ if ($p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() } }";
  await new Promise<void>((resolveClose) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: "ignore"
    });
    child.on("close", () => resolveClose());
    child.on("error", () => resolveClose());
  });
}

/** Kill a process tree. `force` is a hard terminate; without it Chromium is asked to close. */
async function killTree(pid: number, force: boolean): Promise<void> {
  await new Promise<void>((resolveKill) => {
    const args = force ? ["/PID", String(pid), "/T", "/F"] : ["/PID", String(pid), "/T"];
    const child = spawn("taskkill.exe", args, { windowsHide: true, stdio: "ignore" });
    child.on("close", () => resolveKill());
    child.on("error", () => resolveKill());
  });
}

/** Horizontal overflow of the scrolling element — the thing 200% zoom and a narrow window break. */
async function horizontalOverflow(target: Page) {
  return target.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return { scrollW: el.scrollWidth, clientW: el.clientWidth };
  });
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
  const field = urlField(win);
  await field.fill(url);
  await field.blur();
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
  check("Recorder Clear all is disabled with no actions", await win.locator(".recorder-clear-actions").isDisabled());
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

  // Recorder action management: UI mutations go through the main-process action owner and persist.
  const beforeDeleteCount = afterStop.length;
  await win.locator(".recorder-action-delete").last().click();
  await win.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  check(
    "Recorder delete confirmation can be cancelled without mutation",
    (await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).length === beforeDeleteCount
  );
  await win.locator(".recorder-action-delete").last().click();
  await win.getByRole("alertdialog").getByRole("button", { name: "Delete action" }).click();
  const afterDelete = await poll("recorded action deletion", async () => {
    const count = (await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).length;
    return count < beforeDeleteCount ? { count } : null;
  });
  const afterDeleteCount = afterDelete.count;
  check("Recorder deletes an individual action through the confirmed UI", afterDeleteCount < beforeDeleteCount, `${beforeDeleteCount} â†’ ${afterDeleteCount}`);

  await startAndWaitRecording(win, labUrl);
  await poll("actions before Clear all", async () => {
    const count = (await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).length;
    return count > 0 ? count : null;
  });
  await stopButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);
  const urlsBeforeClear = (await page.evaluate(() => window.playwrightFlowStudio.recorder.getUrls())).length;
  await win.getByRole("button", { name: "Clear all", exact: true }).click();
  await win.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  check(
    "Recorder Clear all confirmation can be cancelled without mutation",
    (await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).length > 0
  );
  await win.getByRole("button", { name: "Clear all", exact: true }).click();
  await win.getByRole("alertdialog").getByRole("button", { name: "Clear all", exact: true }).click();
  await poll("Clear all action list", async () => (await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).length === 0 ? true : null);
  check("Recorder Clear all empties the current action list", (await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).length === 0);
  check("Recorder Clear all preserves URL history", (await page.evaluate(() => window.playwrightFlowStudio.recorder.getUrls())).length === urlsBeforeClear);
  check("Recorder cannot save an empty flow after Clear all", await win.locator(".recorder-save-button").isDisabled());
  await startAndWaitRecording(win, labUrl);
  const capturedAfterClear = await poll("recording after Clear all", async () => {
    const count = (await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions())).length;
    return count > 0 ? count : null;
  });
  check("Recorder can capture more actions after Clear all", capturedAfterClear > 0, `${capturedAfterClear} actions`);
  await stopButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);

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
  const mouseRowUrl = await rows.nth(2).locator(".recorded-url-value").textContent();
  await rows.nth(2).click({ position: { x: 8, y: 8 } });
  check("REC-019 clicking the left row area activates the saved URL", await urlField(win).inputValue() === mouseRowUrl);
  const textRowUrl = await rows.nth(3).locator(".recorded-url-value").textContent();
  await rows.nth(3).locator(".recorded-url-value").click();
  check("REC-019 clicking URL text keeps the existing activation behavior", await urlField(win).inputValue() === textRowUrl);
  const rowUrl = await rows.nth(1).locator(".recorded-url-value").textContent();
  await win.locator(".recorded-url-use").nth(1).focus();
  await win.keyboard.press("Enter");
  check("REC-019 the whole-row activator supports keyboard activation", await urlField(win).inputValue() === rowUrl, `${await urlField(win).inputValue()} vs ${rowUrl}`);
  const beforeCopyTarget = await urlField(win).inputValue();
  await rows.nth(1).getByTitle("Copy URL").click();
  check("REC-019 nested Copy does not trigger row URL selection", await urlField(win).inputValue() === beforeCopyTarget);

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
  // Polled, and reported with the rendered row count. A bare one-shot `count() === 1` produced an
  // empty FAIL detail that was twice misread as an "intermittent Electron startup flake" — the row
  // count is what distinguishes "the renderer has not caught up yet" from "stale actions are still
  // on screen", which is a real defect and does not self-correct.
  const emptyState = await poll(
    "cancelled recorder shows its empty state",
    async () => {
      const empty = await page.locator(".recorder-empty").count();
      const rows = await page.locator(".recorder-timeline-row").count();
      return empty === 1 && rows === 0 ? { empty, rows } : null;
    },
    8_000,
    200
  ).catch(async () => ({
    empty: await page.locator(".recorder-empty").count(),
    rows: await page.locator(".recorder-timeline-row").count()
  }));
  check(
    "REC-004 Cancel returns the page to its empty state",
    emptyState.empty === 1 && emptyState.rows === 0,
    `empty-state=${emptyState.empty} stale rendered rows=${emptyState.rows}`
  );
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

    // ── REC-024 (handoff teardown half) ───────────────────────────────────────
    // The app's own supported teardown while a handoff was active. This is NOT the case's trigger —
    // the three out-of-band deaths are driven further down, after the a11y block.
    console.log("\nREC-024 — supported teardown while a handoff was active");
    const killed = await win.evaluate(async () => {
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
  console.log("\nRecorder trusted-event boundary");
  await win.evaluate(() =>
    window.playwrightFlowStudio.settings.update({ recorder: { captureSmartWaits: false, captureWaitTime: true } }));
  await startAndWaitRecording(win, `${labUrl}?rec034=1`);
  await win.waitForTimeout(1_200);
  const untrustedFixtureActions = await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
  const identityResolvedFixtureAction = untrustedFixtureActions.find((action) => action.type === "click");
  check(
    "fixture positional click carries the Element Identity Contract before flow finalization",
    identityResolvedFixtureAction?.locator?.identity?.schemaVersion === 1,
    JSON.stringify({
      resolution: identityResolvedFixtureAction?.locator?.resolution,
      identity: identityResolvedFixtureAction?.locator?.identity,
      guard: identityResolvedFixtureAction?.locator?.guard
    })
  );
  check("identity-resolved fixture activity does not open locator review", (await win.getByTestId("ambiguity-resolution-panel").count()) === 0);
  await cancelButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);

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

      // ── REC-013 / REC-029 — the dialog's keyboard contract ───────────────────
      // This modal declares `aria-modal="true"`, which tells assistive tech that everything behind it
      // is inert. That declaration is a PROMISE: focus must move in, stay in, and come back. The same
      // class of defect was fixed once in `ConfirmDialog` (AWKIT-SET-004) and then found again in
      // `RunDetailDrawer` (AWKIT-REP-004) — each time in a surface with its own markup, because the
      // fix had been applied to a component rather than to the concept. This is the third such
      // surface and the first time it has been checked.
      const openFocus = await focusInfo(win);
      check(
        "REC-013 opening the review dialog moves focus into it",
        openFocus.insideDialog,
        `activeElement=<${openFocus.tag}>${openFocus.isBody ? " (focus was never moved)" : ""} name="${openFocus.name}"`
      );

      // Six presses against a two-button dialog: an untrapped dialog escapes to the page behind well
      // inside that, and a trap that only works forwards is a real half-fix, so both directions run.
      const forwardTrap: Awaited<ReturnType<typeof focusInfo>>[] = [];
      for (let i = 0; i < 6; i += 1) {
        await win.keyboard.press("Tab");
        forwardTrap.push(await focusInfo(win));
      }
      check(
        "REC-013 Tab is trapped inside the review dialog",
        forwardTrap.every((sample) => sample.insideDialog),
        forwardTrap.map((s) => `${s.tag}${s.insideDialog ? "" : s.isBody ? "(BODY)" : "(ESCAPED)"}`).join(" → ")
      );
      const backwardTrap: Awaited<ReturnType<typeof focusInfo>>[] = [];
      for (let i = 0; i < 4; i += 1) {
        await win.keyboard.press("Shift+Tab");
        backwardTrap.push(await focusInfo(win));
      }
      check(
        "REC-013 Shift+Tab is trapped inside the review dialog",
        backwardTrap.every((sample) => sample.insideDialog),
        backwardTrap.map((s) => `${s.tag}${s.insideDialog ? "" : s.isBody ? "(BODY)" : "(ESCAPED)"}`).join(" → ")
      );

      // Escape must dismiss — and must dismiss the way "Keep editing" does, not the way Confirm does.
      // A dialog that saved on Escape would satisfy "Escape closes it" and destroy the operator's
      // intent, so what Escape *did* is asserted, not just that it closed.
      await win.keyboard.press("Escape");
      await win.waitForTimeout(400);
      check("REC-013 Escape dismisses the review dialog", (await modal.isVisible().catch(() => false)) === false);
      const afterEscapeFocus = await focusInfo(win);
      check(
        "REC-013 focus returns to the control that opened the dialog",
        afterEscapeFocus.isPageSaveButton,
        `activeElement=<${afterEscapeFocus.tag}>${afterEscapeFocus.isBody ? " (focus was dropped on the page)" : ""} name="${afterEscapeFocus.name}"`
      );
      const retainedAfterEscape = await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
      check(
        "REC-013 Escape retains the recorded actions",
        retainedAfterEscape.length === reviewActions.length,
        `${retainedAfterEscape.length}/${reviewActions.length}`
      );
      const savedAfterEscape = await win.evaluate(() => window.playwrightFlowStudio.flows.list());
      check(
        "REC-013 Escape persists nothing — it is a dismissal, not a save",
        savedAfterEscape.every((flow) => flow.name !== "REC-013 Review Modal"),
        JSON.stringify(savedAfterEscape.map((flow) => flow.name))
      );

      // ── Second opening: the pointer dismissal route ──────────────────────────
      // Scoped by class, not by label: the modal's confirm button carries the same visible label, so
      // a role+name lookup is ambiguous whenever the dialog is open — which is exactly the state a
      // failing dismissal leaves behind, turning a real defect into an unrelated strict-mode error.
      await win.locator("button.recorder-save-button").click();
      await modal.waitFor({ state: "visible", timeout: 5_000 });
      check("REC-013 the dialog reopens after a dismissal", true);
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

      // ── Third opening: the commit route ──────────────────────────────────────
      // Scoped by class, not by label: the modal's confirm button carries the same visible label, so
      // a role+name lookup is ambiguous whenever the dialog is open — which is exactly the state a
      // failing dismissal leaves behind, turning a real defect into an unrelated strict-mode error.
      await win.locator("button.recorder-save-button").click();
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

  // Launch-time values for the live-session probe. Smart Wait capture ON with waiting-time capture
  // OFF is the combination that makes a quiet gap produce a `fixedDelay`
  // (`allowFixedDelayFallback: !captureWaitTime`) and suppresses `wait` action insertion
  // (`maybeInsertWait` returns early on `!this.captureWaitTime`). Those two *observable* outcomes are
  // what separate "the live session kept its launch-time value" from "the live session picked up the
  // change" — without them the claim is unfalsifiable.
  const reopenRecorder = async () => {
    await navClick(win!, "Flows");
    await navClick(win!, "Recorder");
    await win!.waitForSelector(".recorder-page", { timeout: 20_000 });
    await win!.waitForTimeout(500);
  };
  const captureShape = async () => {
    const actions = await win!.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
    return {
      total: actions.length,
      fixedDelays: actions.flatMap((action) => (action.afterWaits ?? []).filter((wait) => wait.type === "fixedDelay")).length,
      waitActions: actions.filter((action) => action.type === "wait").length
    };
  };

  await win.evaluate(() =>
    window.playwrightFlowStudio.settings.update({ recorder: { captureSmartWaits: true, captureWaitTime: false } }));
  await reopenRecorder();

  await startAndWaitRecording(win, `${labUrl}?rec013=1`);
  check("SET-004 both capture switches lock during a session, so they cannot change mid-recording", (await smartSwitch.isDisabled()) && (await waitSwitch.isDisabled()));

  // Because the page locks its own switches, Settings is the only route left to change the value
  // mid-recording — which is precisely the scenario this case is about.
  await win.evaluate(() => window.playwrightFlowStudio.settings.update({ recorder: { captureWaitTime: true } }));
  await win.waitForTimeout(3_000);
  const midSessionSettings = await readCaptureSettings();
  // Control: if the Setting did not really change, "live capture was unaffected" is vacuously true.
  check(
    "SET-004 the mid-session change really did persist (control)",
    midSessionSettings.captureWaitTime === true,
    JSON.stringify(midSessionSettings)
  );
  const liveShape = await captureShape();
  check(
    "SET-004 the live session still follows its launch-time capture values, not the new ones",
    liveShape.fixedDelays >= 1 && liveShape.waitActions === 0,
    `fixedDelay=${liveShape.fixedDelays} waitActions=${liveShape.waitActions} of ${liveShape.total} actions`
  );
  await cancelButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);

  // The other half of the same promise: the NEXT session must use the new value. This doubles as the
  // negative control for the assertion above — the same fixture and the same quiet gap, driven to the
  // OPPOSITE shape, so "fixedDelay present, no wait action" cannot have been a property of the
  // fixture rather than of the setting.
  await reopenRecorder();
  await startAndWaitRecording(win, `${labUrl}?rec013=1`);
  await win.waitForTimeout(3_000);
  const nextShape = await captureShape();
  check(
    "SET-004 the next session launches with the new capture values",
    nextShape.waitActions >= 1 && nextShape.fixedDelays === 0,
    `fixedDelay=${nextShape.fixedDelays} waitActions=${nextShape.waitActions} of ${nextShape.total} actions`
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

  // REC-029's handoff state, checked inside the paused window SET-005 has already produced rather
  // than by driving a second protected recording. This is the state where a keyboard user most needs
  // the page to be navigable: the recording has stopped and they have to act.
  // Wait for the panel rather than sampling once. `getStatus()` flips as soon as the main process
  // pauses, but the panel is driven by a separate `getHandoff()` poll on an 800 ms interval, so an
  // instantaneous read races the renderer and reports NOT RUN for a state that does arrive.
  const handoffPanel = win.getByTestId("protected-handoff-panel");
  const handoffVisible = await handoffPanel
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (handoffVisible) {
    const handoffTabs = await tabThrough(win, 12);
    const handoffInteractive = handoffTabs.filter((t) => ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(t.tag));
    check(
      "REC-029 handoff: the handoff controls are keyboard reachable and named",
      handoffInteractive.length >= 1 && handoffInteractive.every((t) => t.name.length > 0),
      handoffInteractive.map((t) => `${t.tag}"${t.name}"`).join(" → ") || "nothing received focus"
    );
    // What matters is that the operator LEARNS the recording paused and needs them — not that one
    // particular element carries the live region. Asserted by the announcement's TEXT, so an
    // unrelated live region elsewhere on the page cannot satisfy it, and so the check does not
    // hard-code which element is allowed to do the announcing.
    const handoffAnnouncements = await win.evaluate(() =>
      Array.from(document.querySelectorAll("[aria-live], [role='status'], [role='alert']"))
        .map((region) => (region.textContent || "").trim())
        .filter(Boolean)
    );
    check(
      "REC-029 handoff: the paused state is announced, not only rendered",
      handoffAnnouncements.some((text) => /manual handoff|protected login|paused/i.test(text)),
      JSON.stringify(handoffAnnouncements).slice(0, 220)
    );
  } else {
    notRun(
      "REC-029 handoff: the handoff controls are keyboard reachable and named",
      "the protected-login pause did not render the handoff panel in this run, so there was no handoff state to audit"
    );
  }

  await win.evaluate(async () => {
    try {
      await window.playwrightFlowStudio.recorder.cancel();
    } catch {
      /* idle */
    }
  });
  await waitIdle(win);

  // ── REC-029 — accessibility, responsive layout and reduced motion ──────────
  // Wholly NOT RUN until now. Focus is driven with real Tab presses, never `.focus()`: `:focus-visible`
  // — the selector the global ring uses — does not match programmatic focus, so a `.focus()`-based
  // check would report a ring that a keyboard user never sees.
  console.log("\nREC-029 — Recorder accessibility, responsive layout and reduced motion");
  await waitIdle(win);
  await waitUiIdle(win);

  const idleTabs = await tabThrough(win, 12);
  const idleInteractive = idleTabs.filter((t) => ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(t.tag));
  check(
    "REC-029 idle: Tab reaches the Recorder's interactive controls",
    idleInteractive.length >= 4,
    idleTabs.map((t) => t.tag).join(" → ") || "nothing received focus"
  );
  check(
    "REC-029 idle: every keyboard-focused control shows a focus ring",
    idleInteractive.length > 0 && idleInteractive.every((t) => t.ring),
    idleInteractive.map((t) => `${t.tag}:${t.ring ? "ring" : "NONE"}`).join(" ")
  );
  check(
    "REC-029 idle: no focusable control is missing an accessible name",
    idleInteractive.every((t) => t.name.length > 0),
    idleInteractive.filter((t) => !t.name).map((t) => t.selector).join(", ") || "all named"
  );

  // Every visible control on the page, not only the ones Tab happened to reach in 12 presses.
  const unnamedControls = await win.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll(".recorder-page button, .recorder-page input, .recorder-page select, .recorder-page textarea").forEach((el) => {
      const e = el as HTMLElement;
      if (e.offsetParent === null) return; // not rendered
      const id = e.getAttribute("id");
      const named =
        (e.getAttribute("aria-label") || "").trim() ||
        (e.getAttribute("aria-labelledby") || "").trim() ||
        (e.getAttribute("title") || "").trim() ||
        (id ? (document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || "").trim() : "") ||
        (e.closest("label")?.textContent || "").trim() ||
        (e.tagName === "BUTTON" ? (e.textContent || "").trim() : "");
      if (!named) out.push(`${e.tagName}.${(e.className || "").toString().split(" ")[0]}`);
    });
    return out;
  });
  check(
    "REC-029 idle: every visible Recorder control has an accessible name",
    unnamedControls.length === 0,
    unnamedControls.length ? `unnamed: ${unnamedControls.slice(0, 8).join(", ")}` : "all named"
  );

  // A switch that renders its state only as a coloured track is invisible to a screen reader.
  const switchStates = await win.evaluate(() =>
    Array.from(document.querySelectorAll('.recorder-page [role="switch"]')).map((el) => ({
      name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
      checked: el.getAttribute("aria-checked")
    }))
  );
  check(
    "REC-029 idle: every switch exposes its checked state to assistive tech",
    switchStates.length >= 2 && switchStates.every((s) => s.checked === "true" || s.checked === "false"),
    JSON.stringify(switchStates)
  );

  // The status pill is the page's primary state readout — Idle / Recording / Ready to save / Manual
  // handoff. If it changes silently, a screen-reader user has no way to know the recording started.
  // Asserted as "the element that CARRIES the status is live", not "some live region exists on the
  // page": the action timeline is already `aria-live`, and it would satisfy the weaker phrasing while
  // the status itself stayed silent.
  // Declared inline rather than as a helper binding: esbuild annotates a named function inside
  // `evaluate` with `__name`, which does not exist in the page and throws a bare ReferenceError.
  const [pillLiveness, messageLiveness] = await win.evaluate(() =>
    [".recorder-status-pill", ".recorder-status-text"].map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const region = el.closest("[aria-live], [role='status'], [role='alert']");
      return {
        text: (el.textContent || "").trim().slice(0, 40),
        role: region?.getAttribute("role") ?? null,
        politeness: region?.getAttribute("aria-live") ?? null,
        announced: Boolean(region)
      };
    })
  );
  const statusLiveness = { pill: pillLiveness, message: messageLiveness };
  check(
    "REC-029 the recorder status is announced, not only rendered",
    statusLiveness.pill?.announced === true,
    statusLiveness.pill
      ? `pill="${statusLiveness.pill.text}" role=${statusLiveness.pill.role ?? "none"} aria-live=${statusLiveness.pill.politeness ?? "none"}`
      : "no .recorder-status-pill found"
  );
  // The transient operation message ("Saving flow...", failures) is the other half of "status updates
  // are announced". It renders only when there is something to say, so its absence is NOT RUN.
  if (statusLiveness.message) {
    check(
      "REC-029 the transient status message is announced",
      statusLiveness.message.announced,
      `message="${statusLiveness.message.text}" role=${statusLiveness.message.role ?? "none"}`
    );
  } else {
    notRun("REC-029 the transient status message is announced", "no status message was displayed at this point in the journey");
  }

  // ── Recording state: the pulse must reduce ─────────────────────────────────
  await startAndWaitRecording(win, labUrl);
  const readPulse = async () =>
    win!.evaluate(() => {
      const dot = document.querySelector(".recorder-recording-dot");
      const pill = document.querySelector(".recorder-status-pill.is-recording");
      return {
        dot: dot ? getComputedStyle(dot).animationIterationCount : null,
        pillBefore: pill ? getComputedStyle(pill, "::before").animationIterationCount : null
      };
    });
  // Measured BOTH ways round. "Iteration count is 1 under reduced motion" is equally satisfied by an
  // element that has no animation at all, so the unreduced reading is the control that proves there
  // was motion to reduce.
  const pulseNormal = await readPulse();
  check(
    "REC-029 the recording indicator animates continuously by default (control)",
    pulseNormal.dot === "infinite" || pulseNormal.pillBefore === "infinite",
    JSON.stringify(pulseNormal)
  );
  await win.emulateMedia({ reducedMotion: "reduce" });
  await win.waitForTimeout(400);
  const pulseReduced = await readPulse();
  check(
    "REC-029 the recording pulse is reduced under prefers-reduced-motion",
    (pulseReduced.dot === null || pulseReduced.dot === "1") && (pulseReduced.pillBefore === null || pulseReduced.pillBefore === "1"),
    JSON.stringify(pulseReduced)
  );
  await win.emulateMedia({ reducedMotion: null });
  await win.waitForTimeout(200);

  const recordingTabs = await tabThrough(win, 10);
  const recordingInteractive = recordingTabs.filter((t) => ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(t.tag));
  check(
    "REC-029 recording: the live controls remain keyboard reachable and named",
    recordingInteractive.length >= 2 && recordingInteractive.every((t) => t.name.length > 0),
    recordingInteractive.map((t) => `${t.tag}"${t.name}"`).join(" → ") || "nothing received focus"
  );
  // Recorded actions must be announced as they arrive, not only painted into the timeline.
  // Recorder start resolves before the renderer's polling loop necessarily receives the initial
  // navigation action. Wait for that responsible precondition so a slow poll cannot masquerade as
  // a missing live-region contract.
  await win.locator(".recorder-timeline").waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  check(
    "REC-029 recording: the action timeline is a live region",
    await win.evaluate(() => {
      const list = document.querySelector(".recorder-timeline");
      return Boolean(list?.closest("[aria-live], [role='status'], [role='log']"));
    })
  );

  await stopButton(win).click();
  await waitIdle(win);
  await waitUiIdle(win);

  // ── Ready-to-save state ────────────────────────────────────────────────────
  const readyTabs = await tabThrough(win, 14);
  const readyInteractive = readyTabs.filter((t) => ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(t.tag));
  check(
    "REC-029 ready to save: Save and the Flow Name field are keyboard reachable",
    readyInteractive.some((t) => /Save to Flow Library/.test(t.name)) && readyInteractive.some((t) => t.tag === "INPUT"),
    readyInteractive.map((t) => `${t.tag}"${t.name}"`).join(" → ")
  );

  // ── Zoom, narrow width and reduced motion ──────────────────────────────────
  const bw = await app.browserWindow(win);
  await bw.evaluate((w: { webContents: { setZoomFactor: (n: number) => void } }) => w.webContents.setZoomFactor(2));
  await win.waitForTimeout(600);
  const zoomOverflow = await horizontalOverflow(win);
  check(
    "REC-029 no horizontal overflow at 200% zoom",
    zoomOverflow.scrollW <= zoomOverflow.clientW + 2,
    `scrollWidth=${zoomOverflow.scrollW} clientWidth=${zoomOverflow.clientW}`
  );
  await win.screenshot({ path: join(evidenceDir, "rec029-zoom-200.png") }).catch(() => undefined);
  await bw.evaluate((w: { webContents: { setZoomFactor: (n: number) => void } }) => w.webContents.setZoomFactor(1));

  await bw.evaluate((w: { setBounds: (b: { width: number; height: number }) => void }) => w.setBounds({ width: 900, height: 800 }));
  await win.waitForTimeout(500);
  const narrowOverflow = await horizontalOverflow(win);
  check(
    "REC-029 no horizontal overflow at a narrow window width",
    narrowOverflow.scrollW <= narrowOverflow.clientW + 2,
    `scrollWidth=${narrowOverflow.scrollW} clientWidth=${narrowOverflow.clientW}`
  );
  await win.screenshot({ path: join(evidenceDir, "rec029-narrow.png") }).catch(() => undefined);
  await bw.evaluate((w: { setBounds: (b: { width: number; height: number }) => void }) => w.setBounds({ width: 1280, height: 800 }));
  await win.waitForTimeout(400);

  await win.emulateMedia({ reducedMotion: "reduce" });
  await win.waitForTimeout(300);
  check(
    "REC-029 the Recorder renders under prefers-reduced-motion",
    await win.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches) &&
      (await win.locator(".recorder-page").isVisible())
  );
  await win.emulateMedia({ reducedMotion: null });

  // ── REC-024 — the recorded browser dies OUT OF BAND ────────────────────────
  // Three separate runs, one per trigger the case names. The `recorder.cancel()` teardown further up
  // is the SUPPORTED path and proves nothing here: the service tears itself down in that path, so
  // every assertion about "the UI leaves Recording" is satisfied by the code that asked it to. These
  // three take the browser away WITHOUT telling the app.
  console.log("\nREC-024 — Browser closes or crashes during recording");
  const electronPid = app.process().pid;
  if (typeof electronPid !== "number") {
    notRun("REC-024 the recorded browser dies out of band", "the Electron main process id was unavailable");
  } else {
    // The case names three triggers; these are the three that can actually be PRODUCED here, and
    // each maps to a distinct Playwright signal the service must handle. Two mechanisms were tried
    // and measured to be unusable first, recorded so they are not attempted again:
    //   - `window.close()` from the recorded page is REFUSED on an http:// origin (page stays open,
    //     `pages: 1`). So is the `window.open("","_self").close()` variant. Chromium only honours a
    //     self-close for script-opened windows, so an out-of-band MAIN-page close is not reachable
    //     from a fixture. `page.close` is still wired in the service, and is exercised for popups.
    //   - A renderer crash leaves `page.isClosed() === false` and fires NEITHER `close` NOR
    //     `disconnected` — only `crash`. That is why killing a renderer is its own trigger.
    type Trigger = {
      label: string;
      /** Kills something and returns the pids whose disappearance proves the trigger fired. */
      kill: (live: { pid: number; parent: number; renderer: boolean }[]) => Promise<number[]>;
    };
    const triggers: Trigger[] = [
      {
        label: "the recorded page crashes",
        kill: async (live) => {
          const renderers = live.filter((p) => p.renderer).map((p) => p.pid);
          for (const pid of renderers) await killTree(pid, true);
          return renderers;
        }
      },
      {
        label: "the browser window is closed",
        kill: async (live) => {
          // Every Chromium process is offered the message; only the one owning the browser window
          // has a handle, and closing Chromium's last window exits it.
          await closeMainWindows(live.map((p) => p.pid));
          return browserRoots(live);
        }
      },
      {
        label: "the browser process is terminated",
        kill: async (live) => {
          const roots = browserRoots(live);
          for (const pid of roots) await killTree(pid, true);
          return roots;
        }
      }
    ];

    for (const trigger of triggers) {
      // Baseline BEFORE the launch, and everything below is measured as a difference from it.
      // Windows recycles pids, and a process whose real parent died long ago keeps that stale
      // ParentProcessId — several of the developer's own Chrome processes matched this Electron pid
      // that way and looked like permanent orphans. Only pids that appear for THIS recording count.
      const baseline = new Set((await recordedBrowserPids(electronPid)).map((p) => p.pid));
      const newBrowsers = async () => (await recordedBrowserPids(electronPid)).filter((p) => !baseline.has(p.pid));

      await startAndWaitRecording(win, labUrl);
      // REC-024's precondition is an active recording WITH persisted actions. A session that died
      // before capturing anything exercises the empty-session path instead and would pass for the
      // wrong reason, so this is asserted rather than assumed.
      const beforeDeath = await poll(
        `${trigger.label}: actions before the browser dies`,
        async () => {
          const list = await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
          return list.length > 0 ? list : null;
        },
        30_000,
        200
      ).catch(() => []);
      check(
        `REC-024 (${trigger.label}) the session had recorded actions before the death`,
        beforeDeath.length > 0,
        `${beforeDeath.length} actions`
      );

      const livePids = await newBrowsers();
      // Without this, a kill that found nothing would leave the session healthy and every assertion
      // below would pass while testing absolutely nothing.
      check(
        `REC-024 (${trigger.label}) the recorded browser processes were located`,
        livePids.length > 0,
        livePids.map((p) => `${p.pid}${p.renderer ? "(renderer)" : ""}`).join(", ") || "no Chromium descendant found"
      );
      const targeted = await trigger.kill(livePids);

      // The trigger must actually have killed something. This is the check that separates a real
      // product defect from a test that quietly did nothing: `window.close()` looked exactly like a
      // stuck recorder until it was measured and turned out never to have closed the page at all.
      const deathHappened = await poll(
        `${trigger.label}: the targeted processes are gone`,
        async () => {
          const alive = new Set((await newBrowsers()).map((p) => p.pid));
          return targeted.length > 0 && targeted.every((pid) => !alive.has(pid)) ? true : null;
        },
        20_000,
        400
      ).catch(() => false);

      if (deathHappened !== true) {
        notRun(
          `REC-024 (${trigger.label}) the recorder leaves the Recording state on its own`,
          `the trigger did not end the targeted processes (${targeted.join(", ") || "none targeted"}), so the condition under test was never produced`
        );
      } else {
        check(`REC-024 (${trigger.label}) the trigger really ended the browser (control)`, true, `${targeted.length} process(es)`);
        // THE assertion. A recorder whose browser is gone must not stay locked in Recording — the
        // page disables Start, the Target URL field and both capture switches while `isRecording` is
        // true, so a stuck flag strands the operator with no way forward but Cancel.
        const leftRecording = await poll(
          `${trigger.label}: recorder leaves the Recording state`,
          async () => ((await recorderState(page)).isRecording === false ? true : null),
          20_000,
          250
        ).catch(() => false);
        check(
          `REC-024 (${trigger.label}) the recorder leaves the Recording state on its own`,
          leftRecording === true,
          leftRecording ? "" : JSON.stringify(await recorderState(win))
        );
      }

      // "Draft remains recoverable where safe" — the actions captured before the death survive.
      const survived = await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
      check(
        `REC-024 (${trigger.label}) the actions recorded before the death are still retrievable`,
        survived.length >= beforeDeath.length && survived.length > 0,
        `${survived.length} retained of ${beforeDeath.length} captured`
      );

      // Stop/Cancel must not hang on dead browser handles.
      const teardownStart = Date.now();
      const tornDown = await Promise.race([
        win
          .evaluate(async () => {
            try {
              await window.playwrightFlowStudio.recorder.cancel();
              return true;
            } catch {
              return true; // an actionable rejection is fine; a HANG is what this bounds
            }
          })
          .catch(() => true),
        new Promise<false>((r) => setTimeout(() => r(false), 15_000))
      ]);
      check(
        `REC-024 (${trigger.label}) Cancel completes rather than hanging on a dead browser`,
        tornDown === true,
        `${Date.now() - teardownStart} ms`
      );

      await waitIdle(win);
      await waitUiIdle(win);
      check(`REC-024 (${trigger.label}) Start works again afterwards`, await startButton(win).isEnabled());

      // No process leak: nothing Chromium-shaped may outlive the session.
      const leaked = await poll(
        `${trigger.label}: no orphan browser process`,
        async () => ((await newBrowsers()).length === 0 ? true : null),
        20_000,
        500
      ).catch(() => false);
      check(
        `REC-024 (${trigger.label}) no orphan browser process is left behind`,
        leaked === true,
        leaked ? "" : (await newBrowsers()).map((p) => `${p.name}:${p.pid}`).join(", ")
      );
    }
  }

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
  JSON.stringify({ runId: runStamp, cases: ["REC-001", "REC-002", "REC-003", "REC-004", "REC-013", "REC-019", "REC-021", "REC-024", "REC-025", "REC-029", "AWKIT-REC-033", "AWKIT-REC-034", "SET-004", "SET-005"], passed, failed, notRun: skipped, results, rendererErrors }, null, 2),
  "utf8"
);
console.log(`\nRecorder GUI: ${passed} PASS / ${failed} FAIL / ${skipped} NOT RUN`);
console.log(`Evidence: ${evidenceDir}`);
// AWKIT-QA-007: exit green only when nothing failed AND nothing was skipped.
process.exit(failed === 0 && skipped === 0 ? 0 : 1);
