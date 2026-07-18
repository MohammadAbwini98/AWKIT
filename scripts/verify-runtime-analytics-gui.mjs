// Phase 5 — real packaged-renderer walkthrough of the Runtime Analytics page across seeded DB states.
//
// Launches the ACTUAL built Electron app (out/main + out/preload + out/renderer — the current, uncommitted
// observability code) via Playwright's _electron API, once per fixture state, pointing LOCALAPPDATA at a
// pre-seeded runtime DB so the app reads that fixture. Validates the real renderer + preload + IPC + SQLite
// store integration — not just typecheck/bundle. Captures page/console errors, screenshots, and drives the
// seven additive telemetry IPC channels (incl. malformed-input safety) through the real preload bridge.
//
// Prereq:  npx tsx scripts/seed-observability-fixtures.mts --root .fixtures-observability --fresh
// Run:     node scripts/verify-runtime-analytics-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.resolve(root, process.env.AWKIT_FIXTURE_ROOT ?? ".fixtures-observability");
const evidenceDir = path.join(root, "reports", "browser-performance", "phase5-ui-evidence");
mkdirSync(evidenceDir, { recursive: true });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// Benign console noise to ignore (dev-tools / autofill / favicon / Electron security warnings).
const BENIGN = [/Autofill/i, /devtools/i, /favicon/i, /Electron Security Warning/i, /Content-Security-Policy/i];

/** Drive every additive telemetry IPC channel through the real preload bridge; assert contract-safe results. */
async function probeIpc(win, range) {
  return win.evaluate(async (r) => {
    const t = window.playwrightFlowStudio?.telemetry;
    if (!t) return { ok: false, reason: "preload telemetry bridge missing" };
    const out = {};
    const safe = async (k, fn) => {
      try {
        const v = await fn();
        out[k] = { ok: true, type: Array.isArray(v) ? `array(${v.length})` : typeof v, hasValue: v !== undefined && v !== null };
      } catch (e) {
        out[k] = { ok: false, error: String(e && e.message ? e.message : e) };
      }
    };
    await safe("capacityAnalytics", () => t.capacityAnalytics(r));
    await safe("observabilitySummary", () => t.observabilitySummary());
    await safe("anomalies", () => t.anomalies(r, undefined, 50));
    await safe("workflowHistoricalStats", () => t.workflowHistoricalStats(undefined, r));
    await safe("workflowHistoricalTrend", () => t.workflowHistoricalTrend(undefined, r));
    await safe("workflowRankings", () => t.workflowRankings(r, "most-executed", 10));
    await safe("runVsHistory", () => t.runVsHistory("run-1", r));
    // Malformed / adversarial inputs must be handled safely (no throw across the IPC boundary).
    await safe("anomalies_malformed_range", () => t.anomalies("not-a-range", undefined, -5));
    await safe("rankings_bad_metric", () => t.workflowRankings(r, "nonsense-metric", 9999));
    await safe("capacity_undefined_range", () => t.capacityAnalytics(undefined));
    return { ok: true, out };
  }, range);
}

/** Text of the visible report body — used to catch NaN/undefined leaking into the UI. */
async function bodyText(win) {
  return win.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText ?? "");
}

async function walkState(state) {
  console.log(`\n── State: ${state} ──`);
  const stateRoot = path.join(fixtureRoot, state);
  // Keep the walkthrough idempotent: the seeded observability DB persists, but a prior run provisions a
  // Super User into <state>/SpecterStudio/security, so a re-run without a fresh seed would hit the login
  // form instead of first-run and signInFirstRun would time out. Clear only the security store so every
  // run is a clean first-run (the observability fixture the walkthrough asserts on is left untouched).
  rmSync(path.join(stateRoot, "SpecterStudio", "security"), { recursive: true, force: true });
  const env = { ...process.env, LOCALAPPDATA: stateRoot };
  delete env.ELECTRON_RUN_AS_NODE; // must run as a GUI app, not plain Node
  const app = await electron.launch({ args: [root], cwd: root, env });
  try {
    const win = await resolveMainWindow(app);
    const pageErrors = [];
    const consoleErrors = [];
    win.on("pageerror", (e) => pageErrors.push(e.message));
    win.on("console", (m) => {
      if (m.type() === "error" && !BENIGN.some((re) => re.test(m.text()))) consoleErrors.push(m.text());
    });
    await win.waitForLoadState("domcontentloaded");
    // Each seeded fixture root is a fresh profile with no security user — drive first-run sign-in past
    // the SecurityGate (PR #15) to reach the app shell before asserting on the page (bd awkit-gmn).
    await signInFirstRun(win);
    await win.waitForTimeout(1500); // let async telemetry queries resolve

    // Ensure we're on Runtime Analytics (seeded lastRouteId). Fall back to clicking the nav item.
    let title = await win.evaluate(() => document.body.innerText.includes("Runtime Analytics"));
    if (!title) {
      await win.evaluate(() => {
        const el = [...document.querySelectorAll("button, a, [role=button]")].find((b) => /Runtime Analytics|Runtime/i.test(b.textContent || ""));
        el?.click();
      });
      await win.waitForTimeout(1200);
      title = await win.evaluate(() => document.body.innerText.includes("Runtime Analytics"));
    }
    check(`[${state}] Runtime Analytics page rendered`, title);

    const text = await bodyText(win);
    check(`[${state}] no literal NaN in UI`, !/\bNaN\b/.test(text), /\bNaN\b/.test(text) ? "found 'NaN'" : undefined);
    check(`[${state}] no literal undefined in UI`, !/\bundefined\b/.test(text), /\bundefined\b/.test(text) ? "found 'undefined'" : undefined);
    check(`[${state}] no unhandled page errors`, pageErrors.length === 0, pageErrors[0]);

    // State-specific content expectations.
    if (state === "empty") {
      const emptyCopy = /No runtime history in this range|No capacity samples|Run a workflow/i.test(text);
      check(`[empty] shows empty-state copy (no crash, no spinner)`, emptyCopy);
    } else {
      const hasContent = /Capacity|pressure|admission|Anomal|runtime|Chromium|memory/i.test(text);
      check(`[${state}] populated content present`, hasContent);
    }

    // Range sweep — exercise every preset for query safety (no throw / no crash).
    const ipcAll = await probeIpc(win, "all");
    const ipc24 = await probeIpc(win, "24h");
    const channels = ["capacityAnalytics", "observabilitySummary", "anomalies", "workflowHistoricalStats", "workflowHistoricalTrend", "workflowRankings", "runVsHistory"];
    const allOk = ipcAll.ok && channels.every((c) => ipcAll.out[c]?.ok);
    check(`[${state}] all 7 IPC channels resolve (range=all)`, allOk, allOk ? undefined : JSON.stringify(ipcAll.out));
    const rangeOk = ipc24.ok && channels.every((c) => ipc24.out[c]?.ok);
    check(`[${state}] all 7 IPC channels resolve (range=24h)`, rangeOk);
    const malformedSafe = ipcAll.ok && ipcAll.out.anomalies_malformed_range?.ok && ipcAll.out.rankings_bad_metric?.ok && ipcAll.out.capacity_undefined_range?.ok;
    check(`[${state}] malformed/adversarial IPC inputs handled safely`, malformedSafe, malformedSafe ? undefined : JSON.stringify({ a: ipcAll.out.anomalies_malformed_range, b: ipcAll.out.rankings_bad_metric, c: ipcAll.out.capacity_undefined_range }));

    check(`[${state}] no unexpected console errors`, consoleErrors.length === 0, consoleErrors[0]);

    const shot = path.join(evidenceDir, `runtime-analytics-${state}.png`);
    await win.screenshot({ path: shot, fullPage: true }).catch(() => win.screenshot({ path: shot }));
    console.log(`    screenshot → ${path.relative(root, shot)}`);
  } finally {
    await app.close().catch(() => {});
  }
}

const STATES = (process.env.AWKIT_FIXTURE_STATES ?? "normal,empty,migration,high-data").split(",").map((s) => s.trim()).filter(Boolean);

(async () => {
  console.log(`Runtime Analytics GUI walkthrough — fixtures at ${path.relative(root, fixtureRoot)}`);
  for (const state of STATES) {
    try {
      await walkState(state);
    } catch (e) {
      check(`[${state}] walkthrough completed without launch error`, false, String(e && e.message ? e.message : e));
    }
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\nRuntime Analytics GUI: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
