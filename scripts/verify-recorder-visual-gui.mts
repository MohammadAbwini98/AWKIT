// Phase N, N4.4 (awkit-vra.13.4): the Recorder's per-step visual reference UI, driven in the real Electron window.
//
// Plan: docs/plans/ai-upgrade-v5/N4-recorder-visual-intelligence.md (N4.4 UI spec). What this proves, against the
// rendered controls and the real `recorder:captureVisualReference` channel (no IPC shortcut drives a capture):
//   - feature OFF (`AWKIT_VISUAL_RECORDER` unset): no capture button, no status line and no live region, on a
//     recording that does hold eligible steps (asserted first, so the absence is not vacuous);
//   - feature ON (flipped in the main process, RV-6 is read per call): exactly one real <button> per eligible
//     step (RV-2: the check and the click, never the fills or the select), named "Capture visual reference for
//     step n", each described by a status line of text plus an icon;
//   - a capture driven by real Tab then Enter: the outcome is read from the polite live region (never from a
//     fallback element's text), focus stays on the button by CONTAINMENT (never <body>), the button is
//     aria-disabled while the capture runs and the status reads capturing, then "Visual reference captured";
//   - a repeated capture clears the live region first, so the same result is announced again;
//   - a real refusal (`/recorder-lab?rec018=1&visualDetach=1` removes the recorded submit button) reads
//     "Not captured — <fixed text>" in the status and in the live region, focus again contained in the button;
//   - reduced motion measured BOTH ways: the status colour transition and the capturing icon's pulse run under
//     no-preference and are off under reduce (sampled by a MutationObserver while the capture runs);
//   - after Stop the buttons go and the statuses stay (the pending references are kept for the save).
//
// Not driven here: the "Stale — locator changed" status needs the step's locator edited mid-recording, which the
// GUI can only do through Element Spy on the recorded browser. The service read that feeds it is proven by
// `verify:recorder-visual-capture` section E (a locator edit reads "stale" through getStatus).
//
// Mutation contract (run 2026-10-14 against a rebuilt bundle, each reverted; baseline 55 PASS / 0 FAIL):
//   M1 the capture button uses `disabled={visualBusy}` instead of aria-disabled -> 10 FAIL, all focus/busy: every
//      button aria-disabled while capturing, no `disabled` attribute, focus in the button while capturing and after
//      the capture, the repeated capture observed in flight, the capturing icon off under reduce, the live region
//      cleared and re-announced, focus after the repeated capture and after a refusal (focus fell to <body>).
//      The re-announce check first PASSED on text left from the previous capture; `captureByEnter` now requires a
//      cleared sample followed by new text.
//   M2 the `prefers-reduced-motion: reduce` guard on `.recorder-visual-status` neutralised -> 2 FAIL: the status
//      transition off under reduce (0.12s) and the capturing icon still pulsing under reduce.
//   M3 + M4 in one build (eligibility no longer gated on the feature flag; the handler no longer clears the live
//      region) -> 6 FAIL: no capture button and no status line while off (M3), the polite region absent at rest
//      (M3: the feature-on wait was already satisfied), the region cleared before the repeated result, the
//      repeated result announced, and the refusal announced (M4: no cleared sample precedes the new text).
//   M5 `assertSenderPermission` dropped from the capture handler: NOT visible here (the GUI signs in with the
//      permission); `verify:recorder-authz` goes 62/3 (pre-auth, Viewer and post-sign-out all "allowed").
//   M6 the response spreads the service result: NOT visible here; `verify:recorder-visual-capture` 118/1 (H).
//
// Run after `npm run build`:
//   npm run verify:recorder-visual-gui
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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
const port = Number(process.env.AWKIT_RECORDER_VISUAL_GUI_PORT ?? 4438);
const baseUrl = `http://127.0.0.1:${port}`;
const targetUrl = `${baseUrl}/recorder-lab?rec018=1&visualDetach=1`;
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = join(root, "test-artifacts", "recorder-visual-gui", runStamp);
mkdirSync(evidenceDir, { recursive: true });

// The feature starts OFF: the variable is removed, so the first half proves the hidden state.
const { env, electronArgs, cleanup } = isolatedLaunchEnv("awkit-recorder-visual-gui", {
  PRODUCTION_OFFLINE: "true",
  AWKIT_MAX_BROWSERS: "1"
});
delete env.AWKIT_VISUAL_RECORDER;

// Pinned independently of the renderer's eligibility set: the REC-018 harness records two eligible steps.
const EXPECTED_ELIGIBLE_TYPES = ["check", "click"];
const REFUSAL_MESSAGE = "The step's element is not on the page.";

type Result = { name: string; status: "PASS" | "FAIL" | "NOT RUN"; detail: string };
const results: Result[] = [];
const rendererErrors: string[] = [];

function check(name: string, pass: unknown, detail: unknown = ""): boolean {
  const ok = Boolean(pass);
  results.push({ name, status: ok ? "PASS" : "FAIL", detail: String(detail ?? "").slice(0, 400) });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 180)}` : ""}`);
  return ok;
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

const captureButtons = (win: Page) => win.locator(".recorder-visual-capture");
const statusLines = (win: Page) => win.locator(".recorder-visual-status");
const liveRegion = (win: Page) => win.locator('[data-testid="recorder-visual-live"]');
const captureLabel = (stepNumber: number) => `Capture visual reference for step ${stepNumber}`;

/**
 * What holds focus, phrased as CONTAINMENT in the named capture button. A text test would pass on <body>, whose
 * text contains every label on the page; `isBody` names that failure when it happens.
 */
async function focusOn(win: Page, label: string) {
  return win.evaluate((name) => {
    const el = document.activeElement as HTMLElement | null;
    const button = document.querySelector(`.recorder-visual-capture[aria-label="${CSS.escape(name)}"]`);
    return { inButton: Boolean(button && el && button.contains(el)), isBody: el === document.body, tag: el?.tagName ?? "(none)" };
  }, label);
}

/** Press Tab (or Shift+Tab) until the named capture button holds focus, at most `limit` presses. */
async function tabTo(win: Page, label: string, key: "Tab" | "Shift+Tab", limit = 10): Promise<number> {
  for (let presses = 1; presses <= limit; presses += 1) {
    await win.keyboard.press(key);
    if ((await focusOn(win, label)).inButton) return presses;
  }
  return -1;
}

// A string, so no bundler helper (`__name`) reaches the page. Samples the visual UI on every DOM mutation while a
// capture runs: the busy state, focus, the capturing icon's computed animation and the live region's text.
const INSTALL_SAMPLER = `(() => {
  if (window.__visualSampler) window.__visualSampler.disconnect();
  window.__visualSamples = [];
  const observer = new MutationObserver(() => {
    const live = document.querySelector('[data-testid="recorder-visual-live"]');
    const capturing = document.querySelector('.recorder-visual-status[data-status="capturing"]');
    const icon = capturing ? capturing.querySelector(".recorder-visual-status-icon") : null;
    const active = document.activeElement;
    window.__visualSamples.push({
      live: live ? live.textContent : null,
      capturing: Boolean(capturing),
      capturingText: capturing ? capturing.textContent : "",
      iconAnimation: icon ? getComputedStyle(icon).animationName : "",
      busyButtons: document.querySelectorAll('.recorder-visual-capture[aria-disabled="true"]').length,
      disabledButtons: document.querySelectorAll(".recorder-visual-capture:disabled").length,
      activeInCapture: Boolean(active && active.closest && active.closest(".recorder-visual-capture")),
      activeIsBody: active === document.body
    });
  });
  observer.observe(document.querySelector(".recorder-page") || document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  window.__visualSampler = observer;
  return true;
})()`;

type Sample = {
  live: string | null;
  capturing: boolean;
  capturingText: string;
  iconAnimation: string;
  busyButtons: number;
  disabledButtons: number;
  activeInCapture: boolean;
  activeIsBody: boolean;
};

async function samples(win: Page): Promise<Sample[]> {
  return (await win.evaluate("window.__visualSamples || []")) as Sample[];
}

async function statusOf(win: Page, index: number) {
  return win.evaluate((i) => {
    const el = document.getElementById(`recorder-visual-status-${i}`);
    if (!el) return null;
    return {
      status: el.getAttribute("data-status"),
      text: (el.textContent ?? "").trim(),
      svg: el.querySelectorAll("svg.recorder-visual-status-icon").length,
      svgHidden: el.querySelector("svg.recorder-visual-status-icon")?.getAttribute("aria-hidden") ?? null,
      live: el.getAttribute("aria-live"),
      transition: getComputedStyle(el).transitionDuration
    };
  }, index);
}

/**
 * Press Enter on the focused capture button and return the live region's NEW announcement: the first text it carries
 * after it was cleared. A leftover result from an earlier capture is never read as this one (a mutation that left
 * Enter inert once passed "the repeated result is announced" on exactly that leftover).
 */
async function captureByEnter(win: Page): Promise<string> {
  await win.evaluate(INSTALL_SAMPLER);
  await win.keyboard.press("Enter");
  return poll("a new live region announcement", async () => {
    const seen = await samples(win);
    const cleared = seen.findIndex((s) => s.live === "");
    const next = cleared < 0 ? undefined : seen.slice(cleared + 1).find((s) => (s.live ?? "") !== "");
    return next?.live ?? null;
  }, 10_000, 50).catch(() => "(no new announcement)");
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

  app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
  win = (await resolveMainWindow(app)) as Page;
  const page: Page = win;
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") rendererErrors.push(m.text());
  });
  page.on("pageerror", (e: Error) => rendererErrors.push(`pageerror: ${e.message}`));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await signInFirstRun(page);
  await navClick(page, "Recorder");
  await page.waitForSelector(".recorder-page", { timeout: 20_000 });

  // ── Record the REC-018 harness ─────────────────────────────────────────────────────────────
  const field = page.getByLabel("Target URL");
  await field.fill(targetUrl);
  await field.blur();
  await page.getByRole("button", { name: "Start Recording", exact: true }).click();
  await poll("recording active", async () => ((await page.evaluate(() => window.playwrightFlowStudio.recorder.getStatus())).isRecording ? true : null), 60_000, 200);
  const actions = await poll("REC-018 steps recorded", async () => {
    const list = await page.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
    return list.some((a) => a.type === "click") ? list : null;
  }, 40_000, 200);
  // The detach runs 300 ms after the last harness step; give the timeline one render past it.
  await poll("timeline rendered", async () => ((await page.locator(".recorder-timeline-row").count()) === actions.length ? true : null), 20_000, 150);
  await page.waitForTimeout(800);

  const eligible = actions
    .map((action, index) => ({ type: action.type, index, id: action.id, hasLocator: Boolean(action.locator) }))
    .filter((step) => EXPECTED_ELIGIBLE_TYPES.includes(step.type) && step.hasLocator);
  console.log("\nPreconditions");
  check(
    "the recording holds exactly the two eligible harness steps (check, click), in order",
    eligible.map((step) => step.type).join(",") === EXPECTED_ELIGIBLE_TYPES.join(","),
    actions.map((a) => a.type).join(",")
  );
  check(
    "the recording also holds non-eligible fill and select steps",
    actions.filter((a) => a.type === "fill").length >= 2 && actions.some((a) => a.type === "select"),
    actions.map((a) => a.type).join(",")
  );
  const checkStep = eligible.find((step) => step.type === "check");
  const clickStep = eligible.find((step) => step.type === "click");
  if (!checkStep || !clickStep) throw new Error("the eligible harness steps were not recorded");

  // ── Feature off ──────────────────────────────────────────────────────────────────────────────
  console.log("\nFeature off (AWKIT_VISUAL_RECORDER unset)");
  const offStatus = await page.evaluate(() => window.playwrightFlowStudio.recorder.getStatus());
  check("getStatus reports the capture unavailable", offStatus.visualCaptureAvailable === false, JSON.stringify(offStatus.visualCaptureAvailable));
  check("the timeline renders every recorded step while off", (await page.locator(".recorder-timeline-row").count()) === actions.length);
  check("no capture button is rendered while off", (await captureButtons(page).count()) === 0);
  check("no visual status line is rendered while off", (await statusLines(page).count()) === 0);
  check("no visual live region is rendered while off", (await liveRegion(page).count()) === 0);

  // ── Feature on ───────────────────────────────────────────────────────────────────────────────
  console.log("\nFeature on (AWKIT_VISUAL_RECORDER=manual in the main process)");
  await app.evaluate(() => {
    process.env.AWKIT_VISUAL_RECORDER = "manual";
  });
  await poll("capture buttons rendered", async () => ((await captureButtons(page).count()) === eligible.length ? true : null), 10_000, 100);
  check("getStatus reports the capture available", (await page.evaluate(() => window.playwrightFlowStudio.recorder.getStatus())).visualCaptureAvailable === true);
  check("exactly one capture button per eligible step", (await captureButtons(page).count()) === eligible.length, `${await captureButtons(page).count()} of ${eligible.length}`);
  check("exactly one status line per eligible step", (await statusLines(page).count()) === eligible.length);
  for (const step of eligible) {
    const n = step.index + 1;
    const button = page.getByRole("button", { name: captureLabel(n), exact: true });
    check(`step ${n} (${step.type}) has a real <button> named "${captureLabel(n)}"`, (await button.count()) === 1 && (await button.evaluate((el) => el.tagName)) === "BUTTON");
    check(`step ${n} capture button sits in its own timeline row`, (await page.locator(".recorder-timeline-row").nth(step.index).locator(".recorder-visual-capture").count()) === 1);
    check(`step ${n} capture button is described by its status line`, (await button.getAttribute("aria-describedby")) === `recorder-visual-status-${step.index}`);
    check(`step ${n} capture button is enabled and not aria-disabled at rest`, (await button.isEnabled()) && (await button.getAttribute("aria-disabled")) === null);
    const status = await statusOf(page, step.index);
    check(
      `step ${n} status reads "No visual reference" as text plus a hidden icon`,
      status?.status === "none" && status.text === "No visual reference" && status.svg === 1 && status.svgHidden === "true",
      JSON.stringify(status)
    );
    check(`step ${n} status line is not itself a live region (aria-live=off)`, status?.live === "off");
  }
  const ineligibleRows = actions.map((_, index) => index).filter((index) => !eligible.some((step) => step.index === index));
  let strayButtons = 0;
  for (const index of ineligibleRows) strayButtons += await page.locator(".recorder-timeline-row").nth(index).locator(".recorder-visual-capture, .recorder-visual-status").count();
  check(`no capture button or status on the ${ineligibleRows.length} ineligible rows (fill, select, navigation)`, ineligibleRows.length >= 3 && strayButtons === 0, `stray=${strayButtons}`);
  const live = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="recorder-visual-live"]');
    return el ? { role: el.getAttribute("role"), live: el.getAttribute("aria-live"), text: el.textContent, srOnly: el.classList.contains("sr-only") } : null;
  });
  check("one polite status live region, visually hidden and empty at rest", live?.role === "status" && live.live === "polite" && live.text === "" && live.srOnly, JSON.stringify(live));

  // ── Reduced motion, the status transition both ways ─────────────────────────────────────────
  console.log("\nReduced motion — status transition");
  const transitionMotion = (await statusOf(page, checkStep.index))?.transition ?? "";
  await page.emulateMedia({ reducedMotion: "reduce" });
  const transitionReduced = (await statusOf(page, checkStep.index))?.transition ?? "";
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check("the status colour transition runs under no-preference", Number.parseFloat(transitionMotion) > 0, transitionMotion);
  check("the status colour transition is off under reduced motion", transitionReduced === "0s", transitionReduced);

  // ── Capture by real Tab + Enter ──────────────────────────────────────────────────────────────
  console.log("\nCapture — real Tab, then Enter");
  const checkN = checkStep.index + 1;
  const clickN = clickStep.index + 1;
  // Start one row above the check step, then reach its capture button with real Tab presses only.
  await page.locator(".recorder-timeline-row").nth(checkStep.index - 1).locator(".recorder-action-delete").focus();
  const tabs = await tabTo(page, captureLabel(checkN), "Tab");
  check(`real Tab reaches the step ${checkN} capture button`, tabs > 0, `presses=${tabs}`);
  const announced = await captureByEnter(page);
  check(`the live region announces "Step ${checkN}: visual reference captured."`, announced === `Step ${checkN}: visual reference captured.`, announced);
  const run1 = await samples(page);
  const busy1 = run1.filter((s) => s.capturing);
  check("the capture was observed in flight (status capturing)", busy1.length >= 1, `samples=${run1.length}`);
  check("while capturing the status reads \"Capturing visual reference…\"", busy1.length >= 1 && busy1.every((s) => s.capturingText.trim() === "Capturing visual reference…"), busy1[0]?.capturingText);
  check("while capturing every capture button is aria-disabled", busy1.length >= 1 && busy1.every((s) => s.busyButtons === eligible.length), JSON.stringify(busy1[0]));
  check("while capturing no capture button uses the disabled attribute", busy1.length >= 1 && busy1.every((s) => s.disabledButtons === 0));
  check("while capturing focus stays in the capture button, never <body>", busy1.length >= 1 && busy1.every((s) => s.activeInCapture && !s.activeIsBody));
  check("the capturing icon pulses under no-preference", busy1.some((s) => s.iconAnimation === "awkit-loader-pulse"), busy1.map((s) => s.iconAnimation).join(","));
  const captured = await statusOf(page, checkStep.index);
  check(`step ${checkN} status reads "Visual reference captured" with an icon`, captured?.status === "captured" && captured.text === "Visual reference captured" && captured.svg === 1, JSON.stringify(captured));
  const after1 = await focusOn(page, captureLabel(checkN));
  check(`focus stays in the step ${checkN} capture button after the capture`, after1.inButton && !after1.isBody, JSON.stringify(after1));
  check(`step ${checkN} capture button is no longer aria-disabled`, (await page.getByRole("button", { name: captureLabel(checkN), exact: true }).getAttribute("aria-disabled")) === null);
  const serviceRefs = (await page.evaluate(() => window.playwrightFlowStudio.recorder.getStatus())).visualReferences ?? {};
  check("the service read holds the step as captured, and only it", serviceRefs[checkStep.id] === "captured" && Object.keys(serviceRefs).length === 1, JSON.stringify(Object.values(serviceRefs)));
  check(`step ${clickN} status still reads "No visual reference"`, (await statusOf(page, clickStep.index))?.status === "none");

  // ── A repeated capture under reduced motion ───────────────────────────────────────────────────
  console.log("\nRepeated capture — reduced motion, re-announced");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const announced2 = await captureByEnter(page);
  const run2 = await samples(page);
  const busy2 = run2.filter((s) => s.capturing);
  check("the repeated capture was observed in flight", busy2.length >= 1, `samples=${run2.length}`);
  check("the capturing icon does not animate under reduced motion", busy2.length >= 1 && busy2.every((s) => s.iconAnimation === "none"), busy2.map((s) => s.iconAnimation).join(","));
  const clearedAt = run2.findIndex((s) => s.live === "");
  const reannouncedAt = run2.findIndex((s, i) => i > clearedAt && s.live === `Step ${checkN}: visual reference captured.`);
  check("the live region is cleared before the repeated result, so it is announced again", clearedAt >= 0 && reannouncedAt > clearedAt, `cleared=${clearedAt} re=${reannouncedAt}`);
  check("the repeated result is announced", announced2 === `Step ${checkN}: visual reference captured.`, announced2);
  const after2 = await focusOn(page, captureLabel(checkN));
  check("focus stays in the capture button after the repeated capture", after2.inButton && !after2.isBody, JSON.stringify(after2));
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // ── A real refusal ───────────────────────────────────────────────────────────────────────────
  console.log("\nRefusal — the recorded submit button was removed from the page");
  const tabs2 = await tabTo(page, captureLabel(clickN), "Tab");
  check(`real Tab reaches the step ${clickN} capture button`, tabs2 > 0, `presses=${tabs2}`);
  const refused = await captureByEnter(page);
  check(`the live region announces "Step ${clickN}: not captured. ${REFUSAL_MESSAGE}"`, refused === `Step ${clickN}: not captured. ${REFUSAL_MESSAGE}`, refused);
  const refusedStatus = await statusOf(page, clickStep.index);
  check(
    `step ${clickN} status reads "Not captured — ${REFUSAL_MESSAGE}" with an icon`,
    refusedStatus?.status === "refused" && refusedStatus.text === `Not captured — ${REFUSAL_MESSAGE}` && refusedStatus.svg === 1,
    JSON.stringify(refusedStatus)
  );
  const after3 = await focusOn(page, captureLabel(clickN));
  check("focus stays in the capture button after a refusal", after3.inButton && !after3.isBody, JSON.stringify(after3));
  check(`step ${checkN} keeps its captured status after the other step's refusal`, (await statusOf(page, checkStep.index))?.status === "captured");
  const refusedRefs = (await page.evaluate(() => window.playwrightFlowStudio.recorder.getStatus())).visualReferences ?? {};
  check("the refused step holds no reference in the service read", refusedRefs[clickStep.id] === undefined && refusedRefs[checkStep.id] === "captured");
  check("Shift+Tab walks back to the earlier capture button", (await tabTo(page, captureLabel(checkN), "Shift+Tab")) > 0);

  // ── After Stop ──────────────────────────────────────────────────────────────────────────────
  console.log("\nAfter Stop — buttons go, statuses stay");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await poll("recording stopped", async () => ((await page.evaluate(() => window.playwrightFlowStudio.recorder.getStatus())).isRecording ? null : true), 30_000, 200);
  await poll("capture buttons removed", async () => ((await captureButtons(page).count()) === 0 ? true : null), 10_000, 100);
  check("no capture button remains after Stop", (await captureButtons(page).count()) === 0);
  check("the status lines remain after Stop", (await statusLines(page).count()) === eligible.length);
  check(`step ${checkN} still reads "Visual reference captured" after Stop`, (await statusOf(page, checkStep.index))?.status === "captured");

  check("no renderer console or page error", rendererErrors.length === 0, JSON.stringify(rendererErrors.slice(0, 5)));
} catch (error) {
  check("Recorder visual GUI suite completes without an unhandled error", false, error instanceof Error ? error.stack ?? error.message : String(error));
  await win?.screenshot({ path: join(evidenceDir, "unhandled-error.png") }).catch(() => undefined);
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
writeFileSync(join(evidenceDir, "execution-results.json"), JSON.stringify({ runId: runStamp, passed, failed, notRun: skipped, results, rendererErrors }, null, 2), "utf8");
console.log(`\nRecorder visual GUI: ${passed} PASS / ${failed} FAIL / ${skipped} NOT RUN`);
console.log(`Evidence: ${evidenceDir}`);
process.exit(failed === 0 && skipped === 0 ? 0 : 1);
