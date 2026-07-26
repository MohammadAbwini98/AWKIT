/**
 * Deterministic populated System Reports gate.
 *
 * This is intentionally broader than `verify-reports-gui.mjs`: that verifier proves fresh-profile
 * terminal states, while this one seeds the real SQLite/runtime-report stores with independently
 * known rows and drives the real Electron renderer, preload and IPC boundary.
 */
import { randomBytes } from "node:crypto";
import { _electron as electron, type ConsoleMessage, type ElectronApplication, type Page } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import type {
  DurableAdmissionBucketRecord,
  DurableAnomalyRecord,
  DurableCapacityBucketRecord,
  DurableProcessSampleRecord,
  DurableRunRecord
} from "@src/runner/store/RuntimeStoreSchema";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import type {} from "../app/renderer/types/preload.d.ts";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceRoot = join(root, "test-artifacts", "reports-populated-gui", stamp);
const dataRoot = join(evidenceRoot, "profile");
const runtimeRoot = join(dataRoot, "SpecterStudio");
const runtimeDir = join(runtimeRoot, "runtime");
const reportDir = join(runtimeRoot, "reports");
const screenshotDir = join(runtimeRoot, "screenshots", "reports-fixture");
const logDir = join(runtimeRoot, "logs", "reports-fixture");
const screenshots = join(evidenceRoot, "screenshots");
const exportsDir = join(evidenceRoot, "exports");
for (const dir of [runtimeDir, reportDir, screenshotDir, logDir, screenshots, exportsDir]) {
  mkdirSync(dir, { recursive: true });
}

const REPORT_ID = "rep-populated-001";
const DETAIL_RUN_ID = "run-alpha-00";
const FORBIDDEN_SENTINEL = "REPORT_SECRET_MUST_NOT_APPEAR";
const DEFAULT_CREDS = {
  displayName: "Reports Verifier",
  username: "reportsverifier",
  password: "Str0ng!Passw0rd"
};
const viewer = {
  username: "reportsviewer",
  temporary: genPassword("RVT"),
  final: genPassword("RVF")
};
const noRole = {
  username: "reportsnorole",
  temporary: genPassword("NRT"),
  final: genPassword("NRF")
};

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const results: CheckResult[] = [];
function check(name: string, pass: unknown, detail?: unknown): void {
  const item = { name, pass: Boolean(pass), detail: detail === undefined ? undefined : String(detail) };
  results.push(item);
  console.log(`  ${item.pass ? "✓" : "✗"} ${name}${item.detail ? ` — ${item.detail}` : ""}`);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function genPassword(tag: string): string {
  return `E2e!${tag}${randomBytes(6).toString("base64url")}9a`;
}

async function resolveMainWindow(app: ElectronApplication, timeoutMs = 40_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow().catch(() => undefined);
  while (Date.now() < deadline) {
    for (const mainWindow of app.windows()) {
      try {
        if (await mainWindow.evaluate(() => typeof window.playwrightFlowStudio !== "undefined")) return mainWindow;
      } catch {
        // Splash/main-window transition; keep polling.
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("main Electron window did not expose the preload bridge");
}

async function signInFirstRun(win: Page): Promise<void> {
  await win.waitForSelector(".awkit-login-card", { timeout: 20_000 });
  await win.fill("#awkit-setup-display", DEFAULT_CREDS.displayName);
  await win.fill("#awkit-setup-username", DEFAULT_CREDS.username);
  const passwords = win.locator('.awkit-login-form input[type="password"]');
  await passwords.nth(0).fill(DEFAULT_CREDS.password);
  await passwords.nth(1).fill(DEFAULT_CREDS.password);
  await win.getByRole("button", { name: "Create account" }).click();
  await win.waitForSelector(".app-shell", { timeout: 25_000 });
}

async function navClick(win: Page, label: string): Promise<void> {
  await win.evaluate((wanted: string) => {
    const target = [...document.querySelectorAll<HTMLButtonElement>("button.nav-item")].find(
      (button) => (button.textContent ?? "").trim() === wanted
    );
    target?.click();
  }, label);
  await win.waitForTimeout(400);
}

async function navLabels(win: Page): Promise<string[]> {
  return win.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>("button.nav-item")]
      .map((button) => (button.textContent ?? "").trim())
      .filter(Boolean)
  );
}

async function createUser(
  win: Page,
  input: { username: string; displayName: string; password: string; roles: string[] }
): Promise<void> {
  const form = win.locator(".awkit-admin-create-form");
  await form.locator("label", { hasText: "Username" }).locator("input").first().fill(input.username);
  await form.locator("label", { hasText: "Display name" }).locator("input").first().fill(input.displayName);
  await form.locator('input[type="password"]').first().fill(input.password);
  const roleOptions = form.locator(".awkit-admin-role-option");
  for (let index = 0; index < (await roleOptions.count()); index += 1) {
    const option = roleOptions.nth(index);
    await option.locator('input[type="checkbox"]').setChecked(input.roles.includes((await option.innerText()).trim()));
  }
  await form.getByRole("button", { name: "Create user", exact: true }).click();
  await win.waitForTimeout(750);
}

async function signOut(win: Page): Promise<void> {
  await win.locator(".awkit-account-trigger").click();
  await win.getByRole("menuitem", { name: "Sign out" }).click();
  await win.waitForSelector("#awkit-login-username", { timeout: 15_000 });
}

async function loginAs(win: Page, username: string, password: string): Promise<void> {
  await win.fill("#awkit-login-username", username);
  await win.locator('.awkit-login-form input[type="password"]').first().fill(password);
  await win.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function submitForcedChange(win: Page, currentPassword: string, nextPassword: string): Promise<void> {
  const fields = win.locator('.awkit-login-form input[type="password"]');
  await fields.nth(0).fill(currentPassword);
  await fields.nth(1).fill(nextPassword);
  await fields.nth(2).fill(nextPassword);
  await win.getByRole("button", { name: "Update password", exact: true }).click();
}

function runRecord(
  instanceId: string,
  scenarioId: string,
  scenarioName: string,
  status: string,
  startedMs: number,
  durationMs: number,
  queueWaitMs: number,
  index: number,
  reportCategory?: string
): Partial<DurableRunRecord> & { instanceId: string; executionId: string } {
  const endedAt = iso(startedMs + durationMs);
  const onMachineA = index % 2 === 0;
  return {
    instanceId,
    executionId: `exec-${instanceId}`,
    scenarioId,
    scenarioName,
    triggerType: "manual",
    status,
    flowRunStatus: status,
    startedAt: iso(startedMs),
    endedAt,
    updatedAt: endedAt,
    durationMs,
    queueWaitMs,
    retryCount: status === "failed" ? 1 : 0,
    reportCategory,
    errorClass: status === "failed" ? reportCategory : undefined,
    error: status === "failed" ? `Synthetic ${reportCategory ?? "unknown"} failure [REDACTED]` : undefined,
    machineId: onMachineA ? "fixture-machine-A" : "fixture-machine-B",
    logicalCpuCount: onMachineA ? 8 : 16,
    totalMemoryMb: onMachineA ? 8192 : 16384,
    executionMode: onMachineA ? "auto" : "manual",
    browserPoolMode: onMachineA ? "shared" : "dedicated",
    configuredConcurrency: onMachineA ? 4 : 2,
    observedPeakConcurrency: onMachineA ? 3 : 2,
    workloadClass: onMachineA ? "light" : "heavy",
    headed: false,
    resourceProfile: "balanced",
    isolationClass: onMachineA ? "SHARED_CONTEXT" : "DEDICATED_BROWSER",
    workloadWeight: onMachineA ? 1 : 2,
    pressureStateAtRun: onMachineA ? "healthy" : "pressure",
    obsSampleCount: 4,
    obsSystemCpuMean: onMachineA ? 30 : 70,
    obsSystemCpuP95: onMachineA ? 45 : 85,
    obsSystemMemoryMean: onMachineA ? 40 : 72,
    obsSystemMemoryP95: onMachineA ? 55 : 88,
    obsChromiumRssMeanMb: onMachineA ? 420 : 820,
    obsChromiumRssP95Mb: onMachineA ? 600 : 1100,
    obsAwkitRssMeanMb: 180,
    obsAwkitRssP95Mb: 240
  };
}

async function seedFixture(): Promise<{
  currentRuns: Array<Partial<DurableRunRecord> & { instanceId: string; executionId: string }>;
  expected: { total: number; success: number; failed: number; cancelled: number; avgQueueWait: number };
  storedReport: ConcurrentRunReport & { id: string };
}> {
  const store = await SqliteRuntimeStore.open(join(runtimeDir, "runtime.sqlite"), () => undefined);
  const now = Date.now();
  const alphaStatuses = [
    "failed",
    ...Array.from({ length: 14 }, () => "completed"),
    "failed",
    "failed",
    "failed",
    "cancelled",
    "cancelled"
  ];
  const betaStatuses = [
    ...Array.from({ length: 9 }, () => "completed"),
    "failed",
    "failed",
    "cancelled"
  ];
  const failureCategories = ["timeout", "selector", "network", "assertion", "session-expired", "auth-handoff-required"];
  let failureIndex = 0;
  let globalIndex = 0;
  const currentRuns: Array<Partial<DurableRunRecord> & { instanceId: string; executionId: string }> = [];

  for (const [scenarioId, scenarioName, statuses] of [
    ["wf-alpha", "Fixture Workflow Alpha", alphaStatuses],
    ["wf-beta", "Fixture Workflow Beta", betaStatuses]
  ] as const) {
    for (let i = 0; i < statuses.length; i += 1) {
      const status = statuses[i];
      const category = status === "failed" ? failureCategories[failureIndex++] : undefined;
      const record = runRecord(
        `run-${scenarioId.slice(3)}-${String(i).padStart(2, "0")}`,
        scenarioId,
        scenarioName,
        status,
        now - (globalIndex + 1) * 120_000,
        1_000 + globalIndex * 100,
        50 + globalIndex * 10,
        globalIndex,
        category
      );
      currentRuns.push(record);
      store.upsertRun(record);
      globalIndex += 1;
    }
  }

  // Previous 24-hour window: deterministic deltas for Workflow Reports.
  for (let i = 0; i < 10; i += 1) {
    const alpha = i < 6;
    store.upsertRun(
      runRecord(
        `previous-${i}`,
        alpha ? "wf-alpha" : "wf-beta",
        alpha ? "Fixture Workflow Alpha" : "Fixture Workflow Beta",
        i % 3 === 0 ? "failed" : "completed",
        now - 30 * 60 * 60_000 - i * 60_000,
        2_000 + i * 50,
        100 + i,
        i,
        i % 3 === 0 ? "timeout" : undefined
      )
    );
  }

  // Exact attempts/artifacts for the newest run opened by both Workflow and Instance reports.
  store.recordAttempt({
    attemptId: "attempt-alpha-1",
    instanceId: DETAIL_RUN_ID,
    executionId: `exec-${DETAIL_RUN_ID}`,
    flowId: "flow-alpha",
    nodeId: "submit-order",
    tryNumber: 1,
    status: "failed",
    startedAt: iso(now - 119_000),
    completedAt: iso(now - 118_500),
    durationMs: 500,
    errorClass: "timeout",
    error: "Synthetic timeout [REDACTED]",
    retryDecision: "retry"
  });
  store.recordAttempt({
    attemptId: "attempt-alpha-2",
    instanceId: DETAIL_RUN_ID,
    executionId: `exec-${DETAIL_RUN_ID}`,
    flowId: "flow-alpha",
    nodeId: "submit-order",
    tryNumber: 2,
    status: "succeeded",
    startedAt: iso(now - 118_400),
    completedAt: iso(now - 117_900),
    durationMs: 500,
    retryDecision: "completed"
  });
  const artifactPath = join(screenshotDir, "run-alpha-timeout.png");
  const tracePath = join(logDir, "run-alpha-trace.zip");
  writeFileSync(artifactPath, "synthetic screenshot evidence", "utf8");
  writeFileSync(tracePath, "synthetic trace evidence", "utf8");
  store.recordArtifact({
    instanceId: DETAIL_RUN_ID,
    executionId: `exec-${DETAIL_RUN_ID}`,
    nodeId: "submit-order",
    attemptId: "attempt-alpha-1",
    kind: "screenshot",
    path: artifactPath,
    createdAt: iso(now - 118_500)
  });
  store.recordArtifact({
    instanceId: DETAIL_RUN_ID,
    executionId: `exec-${DETAIL_RUN_ID}`,
    nodeId: "submit-order",
    attemptId: "attempt-alpha-1",
    kind: "trace",
    path: tracePath,
    createdAt: iso(now - 118_500)
  });

  for (let i = 0; i < 12; i += 1) {
    const bucket: DurableCapacityBucketRecord = {
      bucketStart: iso(now - i * 60_000),
      bucketEnd: iso(now - i * 60_000 + 30_000),
      sampleCount: 10,
      cpuMean: 35 + i,
      cpuP95: 50 + i,
      cpuMax: 60 + i,
      memoryMean: 45,
      memoryP95: 55,
      memoryMax: 65,
      awkitRssMeanMb: 180,
      awkitRssP95Mb: 220,
      awkitRssMaxMb: 250,
      chromiumRssMeanMb: 500,
      chromiumRssP95Mb: 650,
      chromiumRssMaxMb: 800,
      adaptiveTargetMean: 4,
      adaptiveTargetMin: 3,
      adaptiveTargetMax: 5,
      weightedBudgetMean: 6,
      weightedBudgetMin: 6,
      weightedBudgetMax: 6,
      activeWeightMean: 3,
      activeWeightP95: 4,
      activeWeightMax: 5,
      activeFlowsMean: 3,
      activeFlowsP95: 4,
      activeFlowsMax: 5,
      queuedFlowsMean: 1,
      queuedFlowsP95: 2,
      queuedFlowsMax: 3,
      sharedBrowsersMean: 2,
      sharedBrowsersMax: 3,
      contextCountMean: 3,
      contextCountMax: 4,
      pageCountMean: 3,
      pageCountMax: 4,
      weightedAdmissionActive: true
    };
    store.recordCapacityBucket(bucket);
    const admission: DurableAdmissionBucketRecord = {
      bucketStart: bucket.bucketStart,
      reason: i % 2 === 0 ? "cpu-pressure" : "weighted-budget",
      pressureState: i % 2 === 0 ? "pressure" : "stable",
      count: i + 1
    };
    store.recordAdmissionBucket(admission);
    const processSample: DurableProcessSampleRecord = {
      timestamp: bucket.bucketStart,
      chromiumProcessCount: 2 + (i % 3),
      chromiumMemoryMb: 500 + i * 10,
      chromiumCpuPercent: 20 + i,
      electronMainMemoryMb: 180 + i,
      browserContextCount: 3,
      pageCount: 3,
      activeBrowsers: 2,
      idleBrowsers: 1,
      launchesWindow: 1,
      restartsWindow: 0,
      crashesWindow: 0,
      availability: "full"
    };
    store.recordProcessSample(processSample);
  }
  const anomaly: DurableAnomalyRecord = {
    workflowId: "wf-alpha",
    runId: DETAIL_RUN_ID,
    detectedAt: iso(now - 60_000),
    scope: "regression",
    signalType: "failure-rate",
    severity: "warning",
    currentValue: 0.2,
    baselineValue: 0.05,
    thresholdRule: "fixture-threshold",
    windowLabel: "24h",
    sampleCount: 20,
    state: "active",
    note: "Synthetic, independently seeded regression"
  };
  store.recordAnomaly(anomaly);
  await store.persistNow();
  await store.close();

  const storedReport: ConcurrentRunReport & { id: string } = {
    id: REPORT_ID,
    executionId: REPORT_ID,
    scenarioId: "wf-alpha",
    scenarioName: "Fixture Workflow Alpha",
    runMode: "single",
    maxConcurrentInstances: 1,
    status: "failed",
    startedAt: iso(now - 120_000),
    endedAt: iso(now - 117_900),
    durationMs: 2_100,
    passedFlows: 0,
    failedFlows: 1,
    skippedFlows: 0,
    instances: [
      {
        instanceId: DETAIL_RUN_ID,
        status: "failed",
        durationMs: 2_100,
        error: "Synthetic timeout [REDACTED]",
        screenshots: [artifactPath],
        downloadedFiles: []
      }
    ],
    runtimeInputs: {
      apiKey: "[REDACTED]",
      token: "***",
      fixtureLabel: "safe synthetic report"
    },
    security: {
      ignoreHttpsErrors: false,
      ignoreHttpsErrorsSource: "default"
    }
  };
  writeFileSync(join(reportDir, `${REPORT_ID}.json`), JSON.stringify(storedReport, null, 2), "utf8");
  writeFileSync(join(reportDir, "corrupt-report.json"), "{ definitely not valid JSON", "utf8");

  const success = currentRuns.filter((run) => run.status === "completed" || run.status === "passed").length;
  const failed = currentRuns.filter((run) => run.status === "failed" || run.status === "crashed").length;
  const cancelled = currentRuns.filter((run) => run.status === "cancelled").length;
  const queueWaits = currentRuns.map((run) => run.queueWaitMs ?? 0);
  return {
    currentRuns,
    expected: {
      total: currentRuns.length,
      success,
      failed,
      cancelled,
      avgQueueWait: Math.round(queueWaits.reduce((sum, value) => sum + value, 0) / queueWaits.length)
    },
    storedReport
  };
}

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

async function metricMap(win: Page): Promise<Record<string, { value: string; detail: string }>> {
  return win.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>(".metric-card")].map((card) => {
        const label = card.querySelector("div > span")?.textContent?.trim() ?? "";
        const value = card.querySelector("div > strong")?.textContent?.trim() ?? "";
        const detail = card.querySelector("p")?.textContent?.trim() ?? "";
        return [label, { value, detail }];
      })
    )
  );
}

async function rejected(call: () => Promise<unknown>): Promise<{ rejected: boolean; message: string }> {
  try {
    await call();
    return { rejected: false, message: "allowed" };
  } catch (error) {
    return { rejected: true, message: error instanceof Error ? error.message : String(error) };
  }
}

const fixture = await seedFixture();
writeFileSync(join(evidenceRoot, "expected-fixture.json"), JSON.stringify(fixture, null, 2), "utf8");

const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
);
env.LOCALAPPDATA = dataRoot;
env.PRODUCTION_OFFLINE = "true";
delete env.ELECTRON_RUN_AS_NODE;

const rendererErrors: string[] = [];
const app = await electron.launch({ args: [root], cwd: root, env });
try {
  const win = await resolveMainWindow(app);
  win.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") rendererErrors.push(message.text());
  });
  win.on("pageerror", (error: Error) => rendererErrors.push(`pageerror: ${error.message}`));
  await win.waitForSelector(".awkit-login-card", { timeout: 20_000 });

  // Fail-closed proof before any session is bound to this renderer.
  const preAuth = await win.evaluate(async (reportId: string) => {
    const api = window.playwrightFlowStudio;
    let overview = { rejected: false, message: "allowed" };
    let reportList = { rejected: false, message: "allowed" };
    let reportGet = { rejected: false, message: "allowed" };
    let reportOpen = { rejected: false, message: "allowed" };
    try {
      await api.telemetry.overview("24h");
    } catch (error) {
      overview = { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
    try {
      await api.reports.list();
    } catch (error) {
      reportList = { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
    try {
      await api.reports.get(reportId);
    } catch (error) {
      reportGet = { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
    try {
      await api.reports.openFolder(reportId);
    } catch (error) {
      reportOpen = { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
    return { overview, reportList, reportGet, reportOpen };
  }, REPORT_ID);
  check("SYS-REP-015 unauthenticated telemetry is rejected", preAuth.overview.rejected, preAuth.overview.message);
  check("SYS-REP-015 unauthenticated report list is rejected", preAuth.reportList.rejected, preAuth.reportList.message);
  check("SYS-REP-015 unauthenticated report read is rejected", preAuth.reportGet.rejected, preAuth.reportGet.message);
  check("SYS-REP-015 unauthenticated report-folder open is rejected", preAuth.reportOpen.rejected, preAuth.reportOpen.message);

  await signInFirstRun(win);
  await win.waitForTimeout(700);

  // Seed Viewer + no-role accounts for UI/deep-link/direct-IPC authorization checks.
  await navClick(win, "Users");
  await win.getByRole("heading", { name: "Add a user" }).first().waitFor({ timeout: 15_000 });
  await createUser(win, {
    username: viewer.username,
    displayName: "Reports Viewer",
    password: viewer.temporary,
    roles: ["Viewer"]
  });
  const noRoleCreated = await win.evaluate(async ({ username, password }) => {
    const api = window.playwrightFlowStudio;
    const login = await api.security.login({
      providerId: "local",
      username: "reportsverifier",
      password: "Str0ng!Passw0rd"
    });
    if (!login.ok) return { ok: false, reason: login.reason };
    const created = await api.security.admin.createUser({
      sessionRef: login.principal.sessionRef,
      username,
      displayName: "Reports No Role",
      password,
      roles: []
    });
    return { ok: created.ok && created.value?.username === username, reason: created.reason };
  }, { username: noRole.username, password: noRole.temporary });
  check(
    "authorization fixture users were created",
    (await win.getByText(`@${viewer.username}`).count()) > 0 && noRoleCreated.ok,
    noRoleCreated.reason
  );

  // Super User populated Overview.
  await navClick(win, "Reports");
  await waitForReportPage(win, "Reports Overview");
  const traversalProbe = await win.evaluate(async () => {
    try {
      await window.playwrightFlowStudio.reports.openFolder("../../outside-report-root");
      return { rejected: false, message: "allowed" };
    } catch (error) {
      return { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
  });
  check(
    "SYS-REP-015 crafted report id cannot select an arbitrary folder",
    traversalProbe.rejected && traversalProbe.message.includes("Report not found"),
    traversalProbe.message
  );
  const overview = await win.evaluate(() => window.playwrightFlowStudio.telemetry.overview("24h"));
  check("SYS-REP-003 total matches independently seeded current rows", overview.totalRuns === fixture.expected.total, JSON.stringify(overview));
  check(
    "SYS-REP-003 terminal status counts/rates match source rows",
    overview.successRuns === fixture.expected.success &&
      overview.failedRuns === fixture.expected.failed &&
      overview.cancelledRuns === fixture.expected.cancelled &&
      overview.successRate === fixture.expected.success / (fixture.expected.success + fixture.expected.failed)
  );
  check("SYS-REP-003 average queue wait matches source rows", overview.avgQueueWaitMs === fixture.expected.avgQueueWait, overview.avgQueueWaitMs);
  const overviewMetrics = await metricMap(win);
  check("SYS-REP-003 visible Total runs matches source rows", overviewMetrics["Total runs"]?.value === String(fixture.expected.total), JSON.stringify(overviewMetrics["Total runs"]));
  check("SYS-REP-003 visible Success rate is 79.3%", overviewMetrics["Success rate"]?.value === "79.3%", overviewMetrics["Success rate"]?.value);
  check("SYS-REP-003 visible Failure rate is 20.7%", overviewMetrics["Failure rate"]?.value === "20.7%", overviewMetrics["Failure rate"]?.value);
  check("SYS-REP-003 visible Cancelled count is 3", overviewMetrics.Cancelled?.value === "3", overviewMetrics.Cancelled?.value);

  // Every range preset, rapid switching and refresh. The hook must expose only the final selection.
  const rangeButtons = win.locator(".awkit-range-selector button");
  check("SYS-REP-002 all five range presets render", (await rangeButtons.count()) === 5);
  for (const label of ["15m", "1h", "24h", "7d", "All"]) {
    await rangeButtons.filter({ hasText: label }).click();
    await win.waitForFunction(
      (wanted: string) => document.querySelector<HTMLButtonElement>(`.awkit-range-selector button[aria-pressed="true"]`)?.textContent?.trim() === wanted,
      label
    );
  }
  await rangeButtons.filter({ hasText: "15m" }).click();
  await rangeButtons.filter({ hasText: "7d" }).click();
  await rangeButtons.filter({ hasText: "24h" }).click();
  await win.getByRole("button", { name: "Refresh" }).click();
  await win.getByRole("button", { name: "Refresh" }).click();
  await waitForReportPage(win, "Reports Overview");
  check(
    "SYS-REP-002 rapid range/refresh settles on the newest 24h request",
    await win.locator('.awkit-range-selector button[aria-pressed="true"]', { hasText: "24h" }).isVisible()
  );
  await win.screenshot({ path: join(screenshots, "01-overview-populated.png"), fullPage: true });

  // Workflow reports: truth, machine filters, stable sort, compare cap and run detail.
  await navClick(win, "Workflow Reports");
  await waitForReportPage(win, "Workflow Reports");
  const workflowRows = win.locator(".awkit-report-panel .awkit-table tbody tr");
  check("SYS-REP-004 two populated workflow rows render", (await workflowRows.count()) === 2);
  const visibleWorkflowText = await workflowRows.allTextContents();
  check("SYS-REP-004 workflow totals are visible", visibleWorkflowText.some((row) => row.includes("Fixture Workflow Alpha") && row.includes("20")) && visibleWorkflowText.some((row) => row.includes("Fixture Workflow Beta") && row.includes("12")), visibleWorkflowText.join(" | "));
  await win.getByRole("button", { name: "Workflow", exact: true }).click();
  const ascending = await workflowRows.allTextContents();
  await win.getByRole("button", { name: "Workflow", exact: true }).click();
  const descending = await workflowRows.allTextContents();
  check(
    "SYS-REP-004 workflow sort toggles both directions",
    ascending[0]?.includes("Beta") && descending[0]?.includes("Alpha"),
    `${ascending[0]} / ${descending[0]}`
  );
  // SYS-REP-016: sort direction was previously conveyed ONLY by a chevron icon with no accessible
  // text, so a screen-reader user could not tell which column was sorted or which way. `aria-sort`
  // belongs on the header cell; every other sortable column must say "none" rather than omit it.
  const sortState = await win.evaluate(() =>
    Array.from(document.querySelectorAll("button.awkit-sort-header")).map((b) => ({
      label: (b.textContent || "").trim().slice(0, 20),
      ariaSort: b.closest("th")?.getAttribute("aria-sort") ?? null
    }))
  );
  // Assert a DEFINITE direction rather than a specific one: which of asc/desc this lands on depends
  // on the click bookkeeping above (toggleSort opens a new column at "desc"), and hardcoding it here
  // would make this check fail for a reason that has nothing to do with the ARIA contract.
  check(
    "SYS-REP-016 the sorted column exposes aria-sort, not an icon alone",
    sortState.some((c) => c.ariaSort === "ascending" || c.ariaSort === "descending"),
    sortState.map((c) => `${c.label}=${c.ariaSort ?? "MISSING"}`).join(" | ")
  );
  check(
    "SYS-REP-016 unsorted columns expose aria-sort=none rather than omitting it",
    sortState.length > 1 && sortState.filter((c) => c.ariaSort === "none").length === sortState.length - 1,
    sortState.map((c) => c.ariaSort ?? "MISSING").join(",")
  );
  await win.getByLabel("Filter by machine").selectOption("fixture-machine-A");
  await win.waitForTimeout(500);
  const filtered = await win.locator(".awkit-report-panel .awkit-table tbody tr").allTextContents();
  check("SYS-REP-004 machine filter keeps independently known rows and labels context", filtered.length === 2 && filtered.every((row) => row.includes("auto") && row.includes("shared") && row.includes("light")), filtered.join(" | "));
  await win.getByLabel("Filter by execution mode").selectOption("manual");
  await win.waitForTimeout(500);
  check("SYS-REP-004 contradictory combined filters show explicit empty state", await win.getByText("No workflow runs match this filter").isVisible());
  await win.getByLabel("Filter by machine").selectOption("");
  await win.getByLabel("Filter by execution mode").selectOption("");
  await win.getByRole("button", { name: /Compare/ }).click();
  const compareBoxes = win.locator('.awkit-td-select input[type="checkbox"]');
  check("SYS-REP-005 compare controls render for populated rows", (await compareBoxes.count()) === 2);
  await compareBoxes.nth(0).check();
  await compareBoxes.nth(1).check();
  check("SYS-REP-005 selected workflows render side by side", (await win.locator(".awkit-compare-card").count()) === 2);
  await win.getByRole("button", { name: /Compare/ }).click();
  await win.locator(".awkit-report-panel .awkit-table tbody tr").filter({ hasText: "Fixture Workflow Alpha" }).click();
  await win.getByRole("button", { name: "Details" }).first().click();
  await win.getByRole("dialog", { name: "Run detail" }).waitFor({ timeout: 15_000 });
  const detailText = await win.getByRole("dialog", { name: "Run detail" }).innerText();
  check("SYS-REP-006 run detail opens the selected durable run", detailText.includes(DETAIL_RUN_ID) && detailText.includes("Fixture Workflow Alpha") && detailText.includes("failed"), detailText.slice(0, 500));
  check("SYS-REP-006 attempts and artifacts match durable rows", detailText.includes("Node attempts (2)") && detailText.includes("Artifacts (2)") && detailText.includes("submit-order"), detailText.slice(0, 700));
  await win.getByRole("button", { name: "Close", exact: true }).click();
  check("SYS-REP-006 close button dismisses the drawer", (await win.getByRole("dialog", { name: "Run detail" }).count()) === 0);
  await win.screenshot({ path: join(screenshots, "02-workflows-populated.png"), fullPage: true });

  // Instance history: >1 page, no duplicates and detail identity.
  await navClick(win, "Instance Reports");
  await waitForReportPage(win, "Instance Reports");
  const pagerText1 = await win.locator(".awkit-pager").innerText();
  const page1Ids = await win.evaluate(async () => (await window.playwrightFlowStudio.telemetry.runHistory("24h", { limit: 25, offset: 0 })).rows.map((row) => row.instanceId));
  check("SYS-REP-007 first page reports 25 of 32", /1.*25.*32/s.test(pagerText1) && page1Ids.length === 25, pagerText1);
  await win.getByRole("button", { name: "Next page" }).click();
  await win.waitForTimeout(500);
  const pagerText2 = await win.locator(".awkit-pager").innerText();
  const page2Ids = await win.evaluate(async () => (await window.playwrightFlowStudio.telemetry.runHistory("24h", { limit: 25, offset: 25 })).rows.map((row) => row.instanceId));
  check("SYS-REP-007 second page reports 26–32 of 32", /26.*32.*32/s.test(pagerText2) && page2Ids.length === 7, pagerText2);
  check("SYS-REP-007 pages contain no duplicate/missing IDs", new Set([...page1Ids, ...page2Ids]).size === 32);
  check("SYS-REP-007 next button disables at boundary", await win.getByRole("button", { name: "Next page" }).isDisabled());
  await win.getByRole("button", { name: "Previous page" }).click();
  await win.getByRole("button", { name: "Details" }).first().click();
  await win.getByRole("dialog", { name: "Run detail" }).waitFor({ timeout: 15_000 });
  check("SYS-REP-007 first-row detail identity is correct", (await win.getByRole("dialog", { name: "Run detail" }).innerText()).includes(DETAIL_RUN_ID));
  await win.getByRole("button", { name: "Close", exact: true }).click();

  // Failure analytics populated categories + ranking.
  await navClick(win, "Failure Analytics");
  await waitForReportPage(win, "Failure Analytics");
  const failureText = await win.locator(".awkit-report-page").innerText();
  check("SYS-REP-009 visible failure total matches six failed rows", failureText.includes("6 failed run(s)") && failureText.includes("6\nfailures"), failureText.slice(0, 700));
  for (const label of ["Timeout", "Selector", "Network", "Assertion / validation", "Session expired", "Auth handoff required"]) {
    check(`SYS-REP-009 category visible: ${label}`, failureText.includes(label));
  }
  check("SYS-REP-009 reliability table includes both workflows", failureText.includes("Fixture Workflow Alpha") && failureText.includes("Fixture Workflow Beta"));
  await win.screenshot({ path: join(screenshots, "03-failure-analytics.png"), fullPage: true });

  // Populated runtime analytics and server storage.
  await navClick(win, "Runtime Analytics");
  await waitForReportPage(win, "Runtime Analytics");
  const runtimeText = await win.locator(".awkit-report-page").innerText();
  check("SYS-REP-010 capacity samples, admission reasons and anomaly render", runtimeText.includes("Capacity & queue effectiveness") && runtimeText.includes("CPU pressure") && runtimeText.includes("failure-rate") && runtimeText.includes("Synthetic, independently seeded regression"));
  check("SYS-REP-010 environmental metrics are labelled", (await win.locator(".awkit-obs-env").count()) >= 4);
  await win.screenshot({ path: join(screenshots, "04-runtime-analytics.png"), fullPage: true });

  await navClick(win, "Chrome Consumption");
  await waitForReportPage(win, "Chrome Consumption");
  check("SYS-REP-011 four live gauges render", (await win.locator(".awkit-gauge-card").count()) === 4);
  await win.waitForTimeout(2_500);
  check("SYS-REP-011 polling remains stable through a second cycle", (await win.locator(".awkit-gauge-card").count()) === 4);

  await navClick(win, "Server Performance");
  await waitForReportPage(win, "Server Performance");
  const serverText = await win.locator(".awkit-report-page").innerText();
  check("SYS-REP-012 four process metric cards render", (await win.locator(".metric-card").count()) >= 4);
  check("SYS-REP-012 storage sizing includes the seeded stores", serverText.includes("Storage usage") && serverText.includes("Reports") && serverText.includes("Runtime DB"), serverText.slice(0, 600));

  // Stored run report list/export contract. A corrupt sibling must not crash or create a fake row.
  await navClick(win, "Run Artifacts");
  await win.waitForSelector("#reports-list", { timeout: 15_000 });
  const cards = win.locator(".report-card");
  check("SYS-REP-008 corrupt report is skipped and only the real report renders", (await cards.count()) === 1);
  const cardText = await cards.first().innerText();
  check("SYS-REP-008 report card uses the stored report contract", cardText.includes("Fixture Workflow Alpha") && cardText.includes("failed") && cardText.includes("1 instance"), cardText);
  check("SYS-REP-008 Open action is available for a real stored report", await win.getByRole("button", { name: /Open/ }).isVisible().catch(() => false));

  // Electron's Playwright adapter does not consistently emit Page.download for renderer-created
  // blob URLs. Observe the same anchor click + Blob bytes without suppressing the actual click, then
  // persist those exact bytes into the evidence directory.
  await win.evaluate(`(() => {
    window.__awkitReportExportCapture = { filename: "", content: "" };
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      if (blob instanceof Blob) {
        blob.text().then(function (content) {
          window.__awkitReportExportCapture.content = content;
        });
      }
      return originalCreate(blob);
    };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.__awkitReportExportCapture.filename = this.download || "";
      return originalClick.call(this);
    };
  })()`);
  let exported: Record<string, unknown> | undefined;
  let exportError = "";
  try {
    await win.locator(`#report-export-${REPORT_ID}`).click();
    await win.waitForFunction(
      () => Boolean((window as unknown as { __awkitReportExportCapture?: { content?: string } }).__awkitReportExportCapture?.content),
      undefined,
      { timeout: 10_000 }
    );
    const captured = await win.evaluate(
      () => (window as unknown as { __awkitReportExportCapture: { filename: string; content: string } }).__awkitReportExportCapture
    );
    const exportPath = join(exportsDir, captured.filename || `report-${REPORT_ID}.json`);
    writeFileSync(exportPath, captured.content, "utf8");
    exported = JSON.parse(captured.content) as Record<string, unknown>;
    check("SYS-REP-008 export action uses the expected JSON filename", captured.filename === `report-${REPORT_ID}.json`, captured.filename);
  } catch (error) {
    exportError = error instanceof Error ? error.message : String(error);
  }
  check("SYS-REP-008 export action produces JSON bytes", exported !== undefined, exportError);
  check(
    "SYS-REP-008 export is the complete stored report, not a summary card",
    exported?.id === REPORT_ID && exported.executionId === REPORT_ID && Array.isArray(exported.instances),
    JSON.stringify(exported ?? null).slice(0, 400)
  );
  check("SYS-REP-008 exported report remains redacted", exported !== undefined && !JSON.stringify(exported).includes(FORBIDDEN_SENTINEL));
  await win.screenshot({ path: join(screenshots, "05-run-artifacts.png"), fullPage: true });

  // Viewer: report reads allowed, export action denied/hidden.
  await signOut(win);
  await loginAs(win, viewer.username, viewer.temporary);
  await win.getByRole("heading", { name: "Update your password" }).waitFor({ timeout: 15_000 });
  await submitForcedChange(win, viewer.temporary, viewer.final);
  await win.waitForSelector(".app-shell", { timeout: 20_000 });
  await navClick(win, "Reports");
  await waitForReportPage(win, "Reports Overview");
  const viewerRead = await win.evaluate(async (id: string) => {
    const api = window.playwrightFlowStudio;
    const overview = await api.telemetry.overview("24h");
    const report = await api.reports.get(id);
    const reportApi = api.reports as typeof api.reports & {
      export?: (reportId: string) => Promise<unknown>;
      openFolder?: (reportId: string) => Promise<string>;
    };
    let exportProbe = { available: false, rejected: false, message: "bridge missing" };
    let openProbe = { available: false, rejected: false, message: "bridge missing" };
    if (typeof reportApi.export === "function") {
      try {
        await reportApi.export(id);
        exportProbe = { available: true, rejected: false, message: "allowed" };
      } catch (error) {
        exportProbe = { available: true, rejected: true, message: error instanceof Error ? error.message : String(error) };
      }
    }
    if (typeof reportApi.openFolder === "function") {
      try {
        await reportApi.openFolder(id);
        openProbe = { available: true, rejected: false, message: "allowed" };
      } catch (error) {
        openProbe = { available: true, rejected: true, message: error instanceof Error ? error.message : String(error) };
      }
    }
    return { totalRuns: overview.totalRuns, reportId: (report as { id?: string } | null)?.id, exportProbe, openProbe };
  }, REPORT_ID);
  check("SYS-REP-015 Viewer can read Reports data", viewerRead.totalRuns === 32 && viewerRead.reportId === REPORT_ID);
  check(
    "SYS-REP-015 Viewer direct report export is denied",
    viewerRead.exportProbe.available && viewerRead.exportProbe.rejected,
    viewerRead.exportProbe.message
  );
  check(
    "SYS-REP-015 Viewer direct report-folder open is denied",
    viewerRead.openProbe.available && viewerRead.openProbe.rejected,
    viewerRead.openProbe.message
  );
  await navClick(win, "Run Artifacts");
  await win.waitForSelector("#reports-list", { timeout: 15_000 });
  check("SYS-REP-015 Viewer export control is hidden", (await win.locator(`#report-export-${REPORT_ID}`).count()) === 0);
  check("SYS-REP-015 Viewer open control is hidden", (await win.locator(`#report-open-${REPORT_ID}`).count()) === 0);

  // No-role user: nav and restored-route guard plus direct telemetry/report IPC denial.
  await signOut(win);
  await win.evaluate(() => window.playwrightFlowStudio.settings.update({ lastRouteId: "reportsOverview" }));
  await loginAs(win, noRole.username, noRole.temporary);
  await win.getByRole("heading", { name: "Update your password" }).waitFor({ timeout: 15_000 });
  await submitForcedChange(win, noRole.temporary, noRole.final);
  await win.waitForSelector(".app-shell", { timeout: 20_000 });
  const labels = await navLabels(win);
  check("SYS-REP-015 no-role user has no Reports navigation", !labels.includes("Reports") && !labels.includes("Run Artifacts"));
  check("SYS-REP-015 restored Reports route is blocked", (await win.locator(".awkit-not-authorized").count()) === 1);
  const noRoleDirect = await win.evaluate(async (id: string) => {
    const api = window.playwrightFlowStudio;
    let overview = { rejected: false, message: "allowed" };
    let list = { rejected: false, message: "allowed" };
    let get = { rejected: false, message: "allowed" };
    let open = { rejected: false, message: "allowed" };
    try {
      await api.telemetry.overview("24h");
    } catch (error) {
      overview = { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
    try {
      await api.reports.list();
    } catch (error) {
      list = { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
    try {
      await api.reports.get(id);
    } catch (error) {
      get = { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
    try {
      await api.reports.openFolder(id);
    } catch (error) {
      open = { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
    return { overview, list, get, open };
  }, REPORT_ID);
  check("SYS-REP-015 no-role direct telemetry is denied", noRoleDirect.overview.rejected, noRoleDirect.overview.message);
  check("SYS-REP-015 no-role direct report list is denied", noRoleDirect.list.rejected, noRoleDirect.list.message);
  check("SYS-REP-015 no-role direct report read is denied", noRoleDirect.get.rejected, noRoleDirect.get.message);
  check("SYS-REP-015 no-role direct report-folder open is denied", noRoleDirect.open.rejected, noRoleDirect.open.message);

  const outsidePath = resolve(root, "..");
  const outsideOpen = await win.evaluate((path: string) => window.playwrightFlowStudio.system.openPath(path), outsidePath);
  check(
    "SYS-REP-015 artifact/path opener rejects an existing out-of-root folder",
    outsideOpen.includes("outside SpecterStudio's data folders"),
    outsideOpen
  );

  check("Reports pages emitted no renderer errors", rendererErrors.length === 0, rendererErrors.slice(0, 3).join(" | "));
} finally {
  await app.close().catch(() => undefined);
}

writeFileSync(join(evidenceRoot, "execution-results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf8");
const passed = results.filter((result) => result.pass).length;
const failed = results.length - passed;
console.log(`\nPopulated Reports GUI: ${passed} PASS / ${failed} FAIL`);
console.log(`Evidence: ${relative(root, evidenceRoot)}`);
process.exit(failed === 0 ? 0 : 1);
