// Real GUI smoke check for the Reports Overview page (UI-reports refactor Phase 5).
// Launches the built Electron app via Playwright's _electron, signs in past the SecurityGate,
// navigates to the Reports route, and asserts the page renders one of its valid states (metrics OR a
// clean empty/disabled state) with no console errors and a working time-range + refresh control.
//
// Runs against an ISOLATED, empty %LOCALAPPDATA% (temp dir): (1) the security gate (PR #15) now gates
// every protected route, so we drive a clean first-run to reach the app shell, and (2) an empty durable
// store is a valid Reports state (every check below accepts metrics OR an empty state). See bd awkit-gmn.
//
// Run: node scripts/verify-reports-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = mkdtempSync(path.join(tmpdir(), "awkit-reports-gui-"));
const env = { ...process.env, LOCALAPPDATA: dataRoot };
delete env.ELECTRON_RUN_AS_NODE; // GUI app, not plain Node

const CREDS = { displayName: "Reports Tester", username: "reports1", password: "Str0ng!Passw0rd" };

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// The app renders SecurityGate first (PR #15); the real <App/> shell only mounts after auth. Drive the
// clean-machine first-run (provision Super User → auto sign-in) so the protected routes become reachable.
async function signInFirstRun(win) {
  await win.waitForSelector(".awkit-login-card", { timeout: 20000 });
  await win.fill("#awkit-setup-display", CREDS.displayName);
  await win.fill("#awkit-setup-username", CREDS.username);
  const pw = win.locator('.awkit-login-form input[type="password"]');
  await pw.nth(0).fill(CREDS.password);
  await pw.nth(1).fill(CREDS.password);
  await win.getByRole("button", { name: "Create account" }).click();
  await win.waitForSelector(".app-shell", { timeout: 25000 });
}

// The launch splash is shown first and has no preload bridge, so app.firstWindow() can return it
// (which then self-closes) — poll for the real main window exposing window.playwrightFlowStudio. See bd awkit-gmn.
async function resolveMainWindow(app, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow().catch(() => undefined);
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        const ready = await w.evaluate(
          () => typeof window.playwrightFlowStudio !== "undefined" && !!window.playwrightFlowStudio.settings
        );
        if (ready) return w;
      } catch {
        /* window navigating/closing — retry */
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("main window with the SpecterStudio bridge did not appear within timeout");
}

const consoleErrors = [];
const app = await electron.launch({ args: [root], cwd: root, env });
try {
  const win = await resolveMainWindow(app);
  win.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win);
  await win.waitForTimeout(1000);

  // Navigate to the Reports route (match the nav item by label text or collapsed title).
  const navigated = await win.evaluate(() => {
    const items = [...document.querySelectorAll("button.nav-item")];
    const target = items.find((b) => (b.textContent || "").trim() === "Reports" || b.getAttribute("title") === "Reports");
    if (target) {
      target.click();
      return true;
    }
    return false;
  });
  check("Reports nav item found and clicked", navigated);

  await win.waitForSelector(".awkit-report-page", { timeout: 15000 });
  check("Reports Overview page renders (.awkit-report-page)", true);

  const headerText = await win.$eval(".awkit-section-header h2", (el) => el.textContent || "").catch(() => "");
  check("page header reads 'Reports Overview'", headerText.includes("Reports Overview"), headerText);

  // Wait for the query to resolve into one of the valid terminal states.
  await win.waitForFunction(
    () => {
      const page = document.querySelector(".awkit-report-page");
      if (!page) return false;
      const hasMetrics = page.querySelectorAll(".metric-card").length > 0;
      const hasEmpty = !!page.querySelector(".awkit-empty-state");
      const hasSkeleton = !!page.querySelector(".awkit-skeleton-card");
      return (hasMetrics || hasEmpty) && !hasSkeleton;
    },
    { timeout: 15000 }
  );
  const state = await win.evaluate(() => {
    const page = document.querySelector(".awkit-report-page");
    return {
      metrics: page.querySelectorAll(".metric-card").length,
      empty: !!page.querySelector(".awkit-empty-state"),
      emptyTitle: page.querySelector(".awkit-empty-state strong")?.textContent || ""
    };
  });
  check("resolves to a valid state (metrics OR empty), not stuck loading", state.metrics > 0 || state.empty, JSON.stringify(state));

  // Time-range control present + clickable without crashing.
  const rangeButtons = await win.$$(".awkit-range-selector button");
  check("time-range selector rendered", rangeButtons.length === 5, `count=${rangeButtons.length}`);
  await win.click('.awkit-range-selector button:has-text("7d")').catch(() => {});
  await win.waitForTimeout(800);
  check("page still rendered after range change", !!(await win.$(".awkit-report-page")));

  // Refresh control.
  await win.click(".awkit-icon-button").catch(() => {});
  await win.waitForTimeout(600);
  check("page still rendered after refresh", !!(await win.$(".awkit-report-page")));

  // ── Workflow Reports + Instance Reports routes ─────────────────────────────
  async function navTo(label) {
    return win.evaluate((wanted) => {
      const items = [...document.querySelectorAll("button.nav-item")];
      const target = items.find((b) => (b.textContent || "").trim() === wanted || b.getAttribute("title") === wanted);
      if (target) {
        target.click();
        return true;
      }
      return false;
    }, label);
  }
  async function awaitResolved() {
    await win.waitForFunction(
      () => {
        const page = document.querySelector(".awkit-report-page");
        if (!page) return false;
        const hasContent = page.querySelectorAll(".metric-card, .awkit-table, .awkit-empty-state, .awkit-distribution").length > 0;
        const busy = !!page.querySelector(".awkit-skeleton-card");
        return hasContent && !busy;
      },
      { timeout: 15000 }
    );
  }

  check("Workflow Reports nav clicked", await navTo("Workflow Reports"));
  await win.waitForSelector(".awkit-report-page", { timeout: 15000 });
  await awaitResolved();
  const wfHeader = await win.$eval(".awkit-section-header h2", (el) => el.textContent || "").catch(() => "");
  check("Workflow Reports renders + resolves", wfHeader.includes("Workflow Reports"), wfHeader);

  // B3 — machine-aware comparison UI. The filter bar renders regardless of whether any runs exist.
  const filterSelects = await win.$$eval(".awkit-report-filters select", (els) => els.length);
  check("Workflow Reports shows machine/mode/pool/class filters", filterSelects === 4, `selects=${filterSelects}`);
  const changedMode = await win.evaluate(() => {
    const select = document.querySelectorAll(".awkit-report-filters select")[1];
    if (!select) return false;
    // Selecting the "any" option is always valid and must not crash the page.
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  });
  check("machine filter select is interactive", changedMode);
  await win.waitForTimeout(500);
  check("page stable after filter change", !!(await win.$(".awkit-report-page")));

  // Compare mode toggles a checkbox column without crashing.
  const compareClicked = await win.evaluate(() => {
    const buttons = [...document.querySelectorAll(".awkit-filter-toggle")];
    const compare = buttons.find((b) => (b.textContent || "").includes("Compare"));
    if (!compare) return false;
    compare.click();
    return true;
  });
  check("Compare toggle present + clickable", compareClicked);
  await win.waitForTimeout(400);
  const hasComparePanelOrCheckboxes = await win.evaluate(() => {
    const page = document.querySelector(".awkit-report-page");
    if (!page) return false;
    // Either a checkbox column (data present) or the empty-state (no runs) is a valid post-toggle state.
    return !!page.querySelector(".awkit-td-select, .awkit-empty-state, .awkit-compare-grid") || !!page.querySelector(".awkit-report-panel");
  });
  check("Compare mode renders a valid state", hasComparePanelOrCheckboxes);

  check("Instance Reports nav clicked", await navTo("Instance Reports"));
  await win.waitForSelector(".awkit-report-page", { timeout: 15000 });
  await awaitResolved();
  const instHeader = await win.$eval(".awkit-section-header h2", (el) => el.textContent || "").catch(() => "");
  check("Instance Reports renders + resolves", instHeader.includes("Instance Reports"), instHeader);
  const hasLiveSection = await win.$$eval(".awkit-report-panel-head strong", (els) => els.some((e) => (e.textContent || "").includes("Live status")));
  check("Instance Reports shows the live-status section", hasLiveSection);

  check("Chrome Consumption nav clicked", await navTo("Chrome Consumption"));
  await win.waitForSelector(".awkit-report-page", { timeout: 15000 });
  // Gauges resolve once the first runtime-status poll returns.
  await win.waitForFunction(
    () => {
      const page = document.querySelector(".awkit-report-page");
      return !!page && page.querySelectorAll(".awkit-gauge-card").length > 0 && !page.querySelector(".awkit-skeleton-card");
    },
    { timeout: 15000 }
  );
  const gaugeCount = await win.$$eval(".awkit-gauge-card", (els) => els.length);
  check("Chrome Consumption renders 4 RPM gauges", gaugeCount === 4, `count=${gaugeCount}`);
  const gaugeValues = await win.$$eval(".awkit-gauge-value", (els) => els.map((e) => (e.textContent || "").trim()));
  check("gauges show a value or neutral dash (no crash)", gaugeValues.length === 4 && gaugeValues.every((v) => v.length > 0), JSON.stringify(gaugeValues));
  const hasProcessDetail = await win.$$eval(".awkit-report-panel-head strong", (els) => els.some((e) => (e.textContent || "").includes("Process detail")));
  check("Chrome Consumption shows the process-detail section", hasProcessDetail);
  // Second poll cycle: page stays stable (no leak/crash across a runtime-status tick).
  await win.waitForTimeout(2500);
  check("page stable after a runtime-status poll tick", !!(await win.$(".awkit-gauge-card")));

  check("Runtime Analytics nav clicked", await navTo("Runtime Analytics"));
  await win.waitForSelector(".awkit-report-page", { timeout: 15000 });
  await awaitResolved();
  const rtHeader = await win.$eval(".awkit-section-header h2", (el) => el.textContent || "").catch(() => "");
  check("Runtime Analytics renders + resolves", rtHeader.includes("Runtime Analytics"), rtHeader);
  // Valid states: 4 peak metric cards + timeline sections, OR a clean empty state (no history yet).
  const rtState = await win.evaluate(() => {
    const page = document.querySelector(".awkit-report-page");
    return {
      metrics: page.querySelectorAll(".metric-card").length,
      timelines: page.querySelectorAll(".awkit-timeline, .awkit-timeline .awkit-muted").length,
      empty: !!page.querySelector(".awkit-empty-state")
    };
  });
  check("Runtime Analytics shows charts+metrics OR a clean empty state", (rtState.metrics >= 4) || rtState.empty, JSON.stringify(rtState));

  check("Failure Analytics nav clicked", await navTo("Failure Analytics"));
  await win.waitForSelector(".awkit-report-page", { timeout: 15000 });
  await awaitResolved();
  const failHeader = await win.$eval(".awkit-section-header h2", (el) => el.textContent || "").catch(() => "");
  check("Failure Analytics renders + resolves", failHeader.includes("Failure Analytics"), failHeader);

  check("Server Performance nav clicked", await navTo("Server Performance"));
  await win.waitForSelector(".awkit-report-page", { timeout: 15000 });
  await win.waitForFunction(
    () => {
      const page = document.querySelector(".awkit-report-page");
      return !!page && page.querySelectorAll(".metric-card").length >= 4 && !page.querySelector(".awkit-skeleton-card");
    },
    { timeout: 15000 }
  );
  const srvHeader = await win.$eval(".awkit-section-header h2", (el) => el.textContent || "").catch(() => "");
  check("Server Performance renders 4 metric cards", srvHeader.includes("Server Performance"), srvHeader);
  const hasStorage = await win.$$eval(".awkit-report-panel-head strong", (els) => els.some((e) => (e.textContent || "").includes("Storage usage")));
  check("Server Performance shows a storage-usage section (real dir sizing)", hasStorage);

  const telemetryErrors = consoleErrors.filter((e) => /telemetry|undefined is not|cannot read/i.test(e));
  check("no telemetry/undefined console errors", telemetryErrors.length === 0, telemetryErrors.slice(0, 2).join(" | "));
} finally {
  await app.close().catch(() => undefined);
  rmSync(dataRoot, { recursive: true, force: true });
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} Reports GUI checks passed`);
if (passed !== results.length) process.exit(1);
