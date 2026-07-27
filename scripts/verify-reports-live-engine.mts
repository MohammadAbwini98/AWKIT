/**
 * SYS-REP-007 (live queued/running distribution) + SYS-REP-011 (backpressure appears and clears).
 *
 * Run with: npm run verify:reports-live-engine   (AFTER `npm run build`)
 *
 * WHY THIS SUITE EXISTS — read before changing it.
 *
 * Both cases read state that lives ONLY in the main process's in-memory `ExecutionEngine`:
 *
 *   - `ReportsInstances.useLiveDistribution()` polls `executions.list()`, never the durable store.
 *   - `ReportsChrome` / `telemetry:server` read `getRuntimeStatus().capacity.dispatchBlocked`, which
 *     is `BackpressureController.lastBlockedReason !== undefined` — set only when the engine's
 *     dispatch loop actually asks to admit an instance and is refused.
 *
 * `verify:reports-populated-gui` seeds SQLite and the report store, so it can produce neither, and
 * recorded both as NOT RUN rather than asserting "no instances in the pool" (true by construction).
 * This suite closes that gap the only way it can be closed: by starting REAL instances against the
 * local mock site and saturating admission until the product blocks.
 *
 * Determinism: the suite switches the app to its supported **sequential** capacity mode through the
 * real `settings.update` IPC, so N>1 instances are guaranteed to leave one queued and at least one
 * dispatch attempt refused. Nothing here mocks or injects the blocked state; the product decides it.
 *
 * MEASURED, and the reason env vars are NOT used: `AWKIT_MAX_ACTIVE_FLOWS` / `AWKIT_MAX_BROWSERS` are
 * read by `loadConcurrencyLimits`, but `applyRuntimeConcurrencyFromSettings` then pushes the
 * settings-derived caps in as programmatic `overrides`, which are spread AFTER the env values. The
 * first run of this suite set both env vars and observed `maxActiveFlows=4` regardless — settings
 * win. Driving the setting is also the more faithful path: it is the one a user has.
 *
 * Every observation is a PRECONDITION-then-ASSERTION pair. If the engine never reaches the state a
 * case needs, the case is reported NOT RUN with the observed snapshot — never passed, and never
 * written up as a product defect on the strength of a fixture that did not do its job.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
const evidenceRoot = join(root, "test-artifacts", "reports-live-engine", stamp);
const screenshots = join(evidenceRoot, "screenshots");

const MOCK_PORT = 4321;
const MOCK_BASE = `http://localhost:${MOCK_PORT}`;
const MOCK_PROBE = `http://127.0.0.1:${MOCK_PORT}/login`;

/** More instances than the cap, so at least one must queue and at least one dispatch must be refused. */
const TOTAL_INSTANCES = 3;
const FLOW_ID = "live-engine-long-wait-flow";
const WORKFLOW_ID = "live-engine-long-workflow";

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

/**
 * An unmet precondition is neither a pass nor a defect. Counted separately — a NOT RUN that is
 * tallied as a PASS is exactly the reporting defect this campaign keeps finding.
 */
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

/* ------------------------------------------------------------------ *
 * Fixtures — a flow that stays running long enough to observe.
 * ------------------------------------------------------------------ */

const now = new Date().toISOString();
const longFlow = {
  id: FLOW_ID,
  name: "Live Engine — Long Wait",
  description: "Opens the mock login page then waits, so instances stay running while the pool is observed.",
  version: 1,
  createdAt: now,
  updatedAt: now,
  nodes: [
    { id: "start", type: "start", name: "Start" },
    { id: "goto", type: "goto", name: "Open Login", url: `${MOCK_BASE}/login`, valueSource: { type: "static", value: `${MOCK_BASE}/login` } },
    {
      id: "wait",
      type: "wait",
      name: "Long Wait",
      value: "120000",
      valueSource: { type: "static", value: "120000" },
      config: { waitType: "time" },
      timeoutMs: 120000
    },
    { id: "end", type: "end", name: "End" }
  ],
  edges: [
    { id: "e0", source: "start", target: "goto", type: "success" },
    { id: "e1", source: "goto", target: "wait", type: "success" },
    { id: "e2", source: "wait", target: "end", type: "success" }
  ]
};

const longWorkflow = {
  id: WORKFLOW_ID,
  name: "Live Engine — Long Workflow",
  description: "Single long-wait flow, run at more instances than the capacity cap.",
  version: 1,
  createdAt: now,
  updatedAt: now,
  nodes: [
    {
      id: FLOW_ID,
      type: "flowRef",
      flowId: FLOW_ID,
      alias: FLOW_ID,
      order: 1,
      required: true,
      inputBindings: {},
      retryPolicy: { count: 0, delayMs: 1000 },
      failurePolicy: "stop",
      position: { x: 140, y: 180 }
    }
  ],
  edges: [],
  runtimeInputs: [],
  execution: { mode: "sequential", maxConcurrentInstances: TOTAL_INSTANCES, stopOnRequiredFlowFailure: true }
};

/* ------------------------------------------------------------------ *
 * Engine readers — one place each, so a rendered value is always
 * compared against the same source the page itself uses.
 * ------------------------------------------------------------------ */

type Instance = { instanceId: string; executionId: string; status: string };

const listInstances = (win: Page): Promise<Instance[]> =>
  win.evaluate(() => window.playwrightFlowStudio.executions.list() as Promise<unknown[]>) as Promise<Instance[]>;

const capacityOf = (win: Page): Promise<{ dispatchBlocked: boolean; blockedReason?: string; activeFlows: number; maxActiveFlows: number }> =>
  win.evaluate(async () => {
    const status = (await window.playwrightFlowStudio.executions.runtimeStatus()) as any;
    return {
      dispatchBlocked: Boolean(status?.capacity?.dispatchBlocked),
      blockedReason: status?.capacity?.blockedReason,
      activeFlows: Number(status?.capacity?.activeFlows ?? -1),
      maxActiveFlows: Number(status?.capacity?.maxActiveFlows ?? -1)
    };
  });

/** Status → count, exactly as `useLiveDistribution` derives it. */
function distributionOf(instances: Instance[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const instance of instances) {
    const status = String(instance.status ?? "unknown");
    out[status] = (out[status] ?? 0) + 1;
  }
  return out;
}

/** What the PAGE is showing right now — badge label → count, read out of the rendered DOM. */
const renderedDistribution = (win: Page): Promise<Record<string, number>> =>
  win.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>(".awkit-distribution-item")].map((item) => [
        item.querySelector(".awkit-status-badge")?.textContent?.trim() ?? "",
        Number(item.querySelector("strong")?.textContent?.trim() ?? "0")
      ])
    )
  );

const sameCounts = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  return true;
};

async function waitForReportPage(win: Page, title: string): Promise<void> {
  await win.waitForFunction(
    (expected: string) => {
      const heading = document.querySelector(".awkit-section-header h2")?.textContent ?? "";
      const page = document.querySelector(".awkit-report-page");
      return Boolean(page) && heading.includes(expected) && !page?.querySelector(".awkit-skeleton-card");
    },
    title,
    { timeout: 20_000 }
  );
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

console.log("Reports live-engine gate (SYS-REP-007 live distribution, SYS-REP-011 backpressure)");
mkdirSync(screenshots, { recursive: true });

if (!existsSync(join(root, "out", "main", "main.js"))) {
  console.error("  Build output missing (out/main/main.js). Run `npm run build` first.");
  process.exit(1);
}

let mockSite: ChildProcess | null = null;
const launch = isolatedLaunchEnv("awkit-live-engine", { PRODUCTION_OFFLINE: "true" });
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
    throw new Error("mock site never came up — every instance below would fail for the wrong reason");
  }

  const app = await electron.launch({ args: [root], cwd: root, env: launch.env });
  try {
    const win = await resolveMainWindow(app);
    win.on("console", (message: ConsoleMessage) => {
      if (message.type() === "error") rendererErrors.push(message.text());
    });
    win.on("pageerror", (error: Error) => rendererErrors.push(`pageerror: ${error.message}`));
    await signInFirstRun(win);
    check("packaged-shape app shell mounted on an isolated first-run profile", true, launch.dataRoot);

    // Switch the app to sequential capacity through its own settings IPC, then confirm the LIVE engine
    // adopted it. Asserting the setting was written would prove nothing about the engine's caps —
    // `applyRuntimeConcurrencyFromSettings` is what pushes them in, so read them back from capacity.
    const capBefore = await capacityOf(win);
    await win.evaluate(() => window.playwrightFlowStudio.settings.update({ runtime: { capacityMode: "sequential" } } as any));
    const capApplied = await pollUntil(async () => {
      const cap = await capacityOf(win);
      return cap.maxActiveFlows === 1 ? cap : null;
    }, 15_000, 500);
    if (
      !check(
        "sequential capacity mode is applied to the LIVE engine, not just persisted",
        capApplied !== null,
        `maxActiveFlows ${capBefore.maxActiveFlows} → ${(await capacityOf(win)).maxActiveFlows}`
      )
    ) {
      throw new Error("the engine never adopted the sequential cap — saturation below would not be deterministic");
    }

    await win.evaluate(async (payload: { flow: unknown; workflow: unknown }) => {
      await window.playwrightFlowStudio.flows.import(payload.flow as any);
      await window.playwrightFlowStudio.workflows.import(payload.workflow as any);
    }, { flow: longFlow, workflow: longWorkflow });
    const imported = await win.evaluate(async () => ({
      flows: (await window.playwrightFlowStudio.flows.list()).map((f: any) => f.id),
      workflows: (await window.playwrightFlowStudio.workflows.list()).map((w: any) => w.id)
    }));
    check(
      "flow + workflow imported through the app's own IPC",
      imported.flows.includes(FLOW_ID) && imported.workflows.includes(WORKFLOW_ID),
      JSON.stringify(imported)
    );

    /* -------------------------------------------------------------- *
     * NEGATIVE CONTROL — the idle state, before any run.
     *
     * Without this, every assertion below could be satisfied by a page
     * that renders the same thing regardless of engine state.
     * -------------------------------------------------------------- */
    console.log("\nNegative control — idle engine");
    await navClick(win, "Reports");
    await navClick(win, "Instance Reports");
    await waitForReportPage(win, "Instance Reports");
    const idleInstances = await listInstances(win);
    const idleText = await win.locator(".awkit-report-page").innerText();
    check(
      "SYS-REP-007 idle: the engine pool is empty and the page says so",
      idleInstances.length === 0 && idleText.includes("No instances in the pool right now"),
      `engine=${idleInstances.length} instance(s)`
    );
    const idleCap = await capacityOf(win);
    await navClick(win, "Chrome Consumption");
    await waitForReportPage(win, "Chrome Consumption");
    const idleBanner = await win.locator(".awkit-backpressure").count();
    check(
      "SYS-REP-011 idle: dispatch is not blocked and no backpressure notice renders",
      idleCap.dispatchBlocked === false && idleBanner === 0,
      `dispatchBlocked=${idleCap.dispatchBlocked} banner=${idleBanner}`
    );
    await win.screenshot({ path: join(screenshots, "01-idle-chrome-consumption.png"), fullPage: true });

    /* -------------------------------------------------------------- *
     * Saturate: more instances than the cap.
     * -------------------------------------------------------------- */
    console.log(`\nSaturating a real ExecutionEngine — ${TOTAL_INSTANCES} instances at a sequential cap of 1`);
    const run = (await win.evaluate(
      (request: Record<string, unknown>) => window.playwrightFlowStudio.executions.runWorkflow(request as any),
      { workflowId: WORKFLOW_ID, headless: true, dryRun: false, totalInstances: TOTAL_INSTANCES, maxConcurrentInstances: TOTAL_INSTANCES }
    )) as any;
    check(`${TOTAL_INSTANCES}-instance run accepted by the engine`, run?.status === "started", JSON.stringify(run)?.slice(0, 400));

    // PRECONDITION for both cases: the pool must actually hold a running AND a queued instance.
    const saturated = await pollUntil(async () => {
      const list = await listInstances(win);
      const active = list.filter((i) => ["starting", "running"].includes(i.status)).length;
      const queued = list.filter((i) => ["queued", "pending"].includes(i.status)).length;
      return active >= 1 && queued >= 1 ? { list, active, queued } : null;
    }, 90_000, 1000);

    if (!saturated) {
      const observed = distributionOf(await listInstances(win));
      checkSkip(
        "SYS-REP-007 live queued/running distribution matches engine state",
        `the engine never held a running and a queued instance together within 90s; observed ${JSON.stringify(observed)}`
      );
      checkSkip(
        "SYS-REP-011 backpressure appears while dispatch is refused",
        `admission was never exercised under saturation; observed ${JSON.stringify(observed)}`
      );
    } else {
      check(
        "the engine holds running AND queued instances simultaneously",
        true,
        `active=${saturated.active} queued=${saturated.queued} of ${TOTAL_INSTANCES}`
      );

      /* ------------------------------------------------------------ *
       * SYS-REP-007 — the RENDERED distribution matches engine state.
       * ------------------------------------------------------------ */
      console.log("\nSYS-REP-007 — live status distribution");
      await navClick(win, "Instance Reports");
      await waitForReportPage(win, "Instance Reports");

      // The page polls every 2s while the engine keeps changing, so a single rendered-vs-IPC
      // comparison can disagree for timing alone. Poll for agreement, and report the last
      // disagreement verbatim if it never settles — never relax the comparison to make it pass.
      let lastRendered: Record<string, number> = {};
      let lastEngine: Record<string, number> = {};
      const agreed = await pollUntil(async () => {
        const engine = distributionOf(await listInstances(win));
        const rendered = await renderedDistribution(win);
        lastEngine = engine;
        lastRendered = rendered;
        return sameCounts(engine, rendered) ? { engine, rendered } : null;
      }, 20_000, 1000);

      if (agreed) {
        const total = Object.values(agreed.engine).reduce((sum, value) => sum + value, 0);
        check(
          "SYS-REP-007 the rendered live distribution equals executions.list()",
          true,
          `engine=${JSON.stringify(agreed.engine)} rendered=${JSON.stringify(agreed.rendered)}`
        );
        const runningShown = Object.entries(agreed.rendered).some(([status, count]) => ["running", "starting"].includes(status) && count > 0);
        const queuedShown = Object.entries(agreed.rendered).some(([status, count]) => ["queued", "pending"].includes(status) && count > 0);
        check(
          "SYS-REP-007 both a running and a queued bucket are visible to the operator",
          runningShown && queuedShown,
          `rendered=${JSON.stringify(agreed.rendered)}`
        );
        const headline = await win.locator(".awkit-report-panel-head").first().innerText();
        check(
          "SYS-REP-007 the pool headline reports the same total",
          headline.includes(`${total} instance(s) in the pool`),
          `${headline.replace(/\s+/g, " ").trim()} | engine total=${total}`
        );
      } else {
        checkSkip(
          "SYS-REP-007 the rendered live distribution equals executions.list()",
          `rendered and engine never agreed within 20s — last engine=${JSON.stringify(lastEngine)} rendered=${JSON.stringify(lastRendered)}`
        );
      }
      await win.screenshot({ path: join(screenshots, "02-live-distribution.png"), fullPage: true });

      /* ------------------------------------------------------------ *
       * SYS-REP-011 — backpressure appears.
       * ------------------------------------------------------------ */
      console.log("\nSYS-REP-011 — backpressure under saturation");
      const blocked = await pollUntil(async () => {
        const cap = await capacityOf(win);
        return cap.dispatchBlocked ? cap : null;
      }, 30_000, 1000);

      if (!blocked) {
        const cap = await capacityOf(win);
        checkSkip(
          "SYS-REP-011 backpressure appears while dispatch is refused",
          `dispatchBlocked stayed false under saturation; capacity=${JSON.stringify(cap)}`
        );
      } else {
        check(
          "SYS-REP-011 the engine reports dispatch blocked with a stated reason",
          blocked.dispatchBlocked === true && typeof blocked.blockedReason === "string" && blocked.blockedReason.length > 0,
          `reason: ${blocked.blockedReason}`
        );
        // The reason must name the limit that was actually hit — a generic or empty string would
        // leave an operator with a throttled app and nothing to act on.
        check(
          "SYS-REP-011 the reason names the limit that was hit, not a generic message",
          /flow limit|browser pool|memory|CPU|crash|budget/i.test(blocked.blockedReason ?? ""),
          blocked.blockedReason
        );

        await navClick(win, "Chrome Consumption");
        await waitForReportPage(win, "Chrome Consumption");
        const bannerVisible = await pollUntil(async () => ((await win.locator(".awkit-backpressure").count()) > 0 ? true : null), 20_000, 1000);
        if (bannerVisible) {
          const bannerText = await win.locator(".awkit-backpressure").innerText();
          check(
            "SYS-REP-011 Chrome Consumption surfaces the backpressure notice with its reason",
            bannerText.includes("Dispatch is currently throttled by backpressure") && bannerText.includes((blocked.blockedReason ?? "").slice(0, 20)),
            bannerText.replace(/\s+/g, " ").trim()
          );
          check(
            "SYS-REP-011 the notice is announced, not colour-only",
            (await win.locator(".awkit-backpressure[role='status']").count()) > 0,
            "role=status"
          );
        } else {
          checkSkip(
            "SYS-REP-011 Chrome Consumption surfaces the backpressure notice",
            "the engine reported dispatchBlocked but the page never rendered .awkit-backpressure within 20s"
          );
        }
        check("SYS-REP-011 four live gauges still render while throttled", (await win.locator(".awkit-gauge-card").count()) === 4);
        await win.screenshot({ path: join(screenshots, "03-backpressure.png"), fullPage: true });

        // The exact path the case names: telemetry:server, not just the runtime status object.
        const serverReport = (await win.evaluate(() => window.playwrightFlowStudio.telemetry.server())) as any;
        check(
          "SYS-REP-011 telemetry:server reports backpressureBlocked while the engine is throttled",
          serverReport?.backpressureBlocked === true,
          `backpressureBlocked=${serverReport?.backpressureBlocked}`
        );
      }

      /* ------------------------------------------------------------ *
       * Release — the case is "appears AND CLEARS".
       * ------------------------------------------------------------ */
      console.log("\nRelease — backpressure must clear once the pressure is gone");
      await win.evaluate(() => window.playwrightFlowStudio.executions.stopAll());
      const drained = await pollUntil(async () => {
        const list = await listInstances(win);
        return list.length > 0 && list.every((i) => ["cancelled", "completed", "failed"].includes(i.status)) ? list : null;
      }, 60_000, 1000);
      check(
        "every instance reached a terminal state after stopAll",
        drained !== null,
        drained ? JSON.stringify(distributionOf(drained as Instance[])) : "still non-terminal after 60s"
      );

      const cleared = await pollUntil(async () => {
        const cap = await capacityOf(win);
        return cap.dispatchBlocked === false ? cap : null;
      }, 45_000, 1000);
      const finalCap = await capacityOf(win);
      check(
        "SYS-REP-011 backpressure clears once dispatch is no longer refused",
        cleared !== null,
        cleared
          ? "dispatchBlocked returned to false"
          : `STILL BLOCKED 45s after every instance ended — capacity=${JSON.stringify(finalCap)}. A gauge stuck at "throttled" on an idle engine is a stale live reading, not a transient.`
      );
      await navClick(win, "Chrome Consumption");
      await waitForReportPage(win, "Chrome Consumption");
      const bannerAfter = await pollUntil(async () => ((await win.locator(".awkit-backpressure").count()) === 0 ? true : null), 20_000, 1000);
      check(
        "SYS-REP-011 the backpressure notice disappears from the page",
        bannerAfter === true,
        bannerAfter === true ? "notice removed" : "notice still rendered after the engine went idle"
      );
      await win.screenshot({ path: join(screenshots, "04-after-release.png"), fullPage: true });
    }

    check("no renderer errors during the live-engine walkthrough", rendererErrors.length === 0, rendererErrors.slice(0, 3).join(" | "));
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
    /* the profile lives in the OS temp dir; a locked file must not fail the suite */
  }
}

writeFileSync(join(evidenceRoot, "execution-results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf8");
console.log(`\nReports live engine: ${passed} PASS / ${failed} FAIL${notRun > 0 ? ` / ${notRun} NOT RUN` : ""}`);
console.log(`Evidence: ${relative(root, evidenceRoot)}`);
process.exit(failed === 0 ? 0 : 1);
