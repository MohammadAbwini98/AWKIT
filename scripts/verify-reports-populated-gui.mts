/**
 * Deterministic populated System Reports gate.
 *
 * This is intentionally broader than `verify-reports-gui.mjs`: that verifier proves fresh-profile
 * terminal states, while this one seeds the real SQLite/runtime-report stores with independently
 * known rows and drives the real Electron renderer, preload and IPC boundary.
 */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { _electron as electron, type ConsoleMessage, type ElectronApplication, type Page } from "playwright";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const deniedDir = join(logDir, "denied-subtree");
const screenshots = join(evidenceRoot, "screenshots");
const exportsDir = join(evidenceRoot, "exports");
for (const dir of [runtimeDir, reportDir, screenshotDir, logDir, screenshots, exportsDir]) {
  mkdirSync(dir, { recursive: true });
}

const REPORT_ID = "rep-populated-001";
const DETAIL_RUN_ID = "run-alpha-00";
const FORBIDDEN_SENTINEL = "REPORT_SECRET_MUST_NOT_APPEAR";
const RECOVERED_ANOMALY_NOTE = "Synthetic regression that has since recovered";
/**
 * SYS-REP-012 sizing payloads, in whole MiB so the reported figure is exact rather than
 * approximately-right. `dirSizeMb` rounds to one decimal, and the few bytes of pre-existing fixture
 * evidence in these folders are far below that resolution.
 */
const LOGS_PAYLOAD_MIB = 3;
/** One past `dirSizeMb`'s 20,000-entry bound — the smallest directory that forces truncation. */
const DIR_BOUND_ENTRIES = 20_001;
const SCREENSHOTS_PAYLOAD_MIB = 1.5;
const CACHE_PROBE_PAYLOAD_MIB = 2;
/** Written into a directory whose read access is then revoked, so it must NOT reach any total. */
const DENIED_PAYLOAD_MIB = 4;
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
  /** NOT RUN is its own state: neither a pass nor a defect, and never counted as either. */
  notRun?: boolean;
  detail?: string;
}

const results: CheckResult[] = [];
/**
 * An unmet precondition is neither a pass nor a defect — record it as such.
 *
 * This used to push `pass: true`, so every NOT RUN was tallied into the headline PASS count: the
 * suite reported "158 PASS / 0 FAIL" while six of those had run nothing. A NOT RUN that reads as a
 * PASS is the same failure mode as a check that cannot fail — see docs/ai/KNOWN_ISSUES.md.
 */
function notRunCheck(name: string, why: string): void {
  results.push({ name, pass: false, notRun: true, detail: `NOT RUN: ${why}` });
  console.log(`  - ${name} — NOT RUN: ${why}`);
}

function check(name: string, pass: unknown, detail?: unknown): void {
  const item = { name, pass: Boolean(pass), detail: detail === undefined ? undefined : String(detail) };
  results.push(item);
  console.log(`  ${item.pass ? "✓" : "✗"} ${name}${item.detail ? ` — ${item.detail}` : ""}`);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Revoke read access to a directory this process owns. An owner may always rewrite an object's DACL,
 * so this needs no elevation. Paired with `restoreDirectoryRead` in the script's `finally` — an
 * un-restored deny would leave an undeletable directory in `test-artifacts/`.
 */
function denyDirectoryRead(dir: string): void {
  execFileSync("icacls", [dir, "/deny", `${userdomainAccount()}:(OI)(CI)(RX)`], { stdio: "ignore" });
}

function restoreDirectoryRead(dir: string): void {
  execFileSync("icacls", [dir, "/remove:d", userdomainAccount()], { stdio: "ignore" });
}

function userdomainAccount(): string {
  const domain = process.env.USERDOMAIN;
  const user = process.env.USERNAME ?? "";
  return domain ? `${domain}\\${user}` : user;
}

/** True when this process genuinely cannot enumerate the directory — the precondition, not the claim. */
function directoryIsUnreadable(dir: string): boolean {
  try {
    readdirSync(dir);
    return false;
  } catch {
    return true;
  }
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
  await win.getByRole("heading", { name: "Save your recovery code" }).waitFor({ timeout: 20_000 });
  await win.getByRole("checkbox", { name: "I saved this recovery code in a secure place." }).check();
  await win.getByRole("button", { name: "Continue to SpecterStudio" }).click();
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
  reportCategory?: string,
  // SYS-REP-004 needs rows that differ along EACH filter dimension independently. Without this the
  // whole corpus is a single A/B parity split, and "filter by machine" and "filter by pool mode"
  // select the same rows — a filter matrix that cannot distinguish a working filter from a broken one.
  overrides: Partial<DurableRunRecord> = {}
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
    obsAwkitRssP95Mb: 240,
    ...overrides
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

  // SYS-REP-005 needs MORE than four workflows to prove the four-selection cap refuses a fifth, and
  // SYS-REP-004 needs each filter dimension to select a different set. These three pin their own
  // machine / execution mode / pool mode / workload class rather than inheriting the A/B parity.
  const extraWorkflows = [
    ["wf-gamma", "Fixture Workflow Gamma", { machineId: "fixture-machine-C", executionMode: "auto", browserPoolMode: "dedicated", workloadClass: "heavy" }],
    ["wf-delta", "Fixture Workflow Delta", { machineId: "fixture-machine-A", executionMode: "manual", browserPoolMode: "dedicated", workloadClass: "light" }],
    ["wf-epsilon", "Fixture Workflow Epsilon", { machineId: "fixture-machine-C", executionMode: "manual", browserPoolMode: "shared", workloadClass: "heavy" }]
  ] as const;
  for (const [scenarioId, scenarioName, overrides] of extraWorkflows) {
    for (let i = 0; i < 2; i += 1) {
      const status = i === 0 ? "completed" : "failed";
      const record = runRecord(
        `run-${scenarioId.slice(3)}-${String(i).padStart(2, "0")}`,
        scenarioId,
        scenarioName,
        status,
        now - (globalIndex + 1) * 120_000,
        1_000 + globalIndex * 100,
        50 + globalIndex * 10,
        globalIndex,
        status === "failed" ? "unknown" : undefined,
        overrides as Partial<DurableRunRecord>
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
  // SYS-REP-012 — known-byte payloads so the rendered figure can be checked against arithmetic
  // rather than against itself. Written into sub-folders to also prove the walk recurses.
  writeFileSync(join(logDir, "sizing-payload.bin"), Buffer.alloc(LOGS_PAYLOAD_MIB * 1024 * 1024));
  writeFileSync(join(screenshotDir, "sizing-payload.bin"), Buffer.alloc(SCREENSHOTS_PAYLOAD_MIB * 1024 * 1024));
  // SYS-REP-012 denied-path injection. A real ACL denial, not a simulated one: `dirSizeMb` catches a
  // failing `readdir` and continues, so the denied sub-tree's bytes must be excluded while the rest
  // of the report still renders. Denied BEFORE the app starts so the very first storage read already
  // exercises the branch — no cache-TTL dance, and no window in which the app sees it readable.
  mkdirSync(deniedDir, { recursive: true });
  writeFileSync(join(deniedDir, "unreadable-payload.bin"), Buffer.alloc(DENIED_PAYLOAD_MIB * 1024 * 1024));
  denyDirectoryRead(deniedDir);
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
    // SYS-REP-010 neutral-vs-zero: process samples are deliberately seeded 40-51 minutes back, OUTSIDE
    // the narrowest range preset but inside the rest. That makes "Peak Chromium memory" genuinely
    // unavailable at 15m and populated at 1h — so the neutral "—" can be shown to be range-driven
    // absence rather than a hardcoded dash, while the capacity buckets above (0-11 min) keep
    // "Peak system memory" populated in the SAME 15m render.
    const processSample: DurableProcessSampleRecord = {
      timestamp: iso(now - (40 + i) * 60_000),
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

    // Runtime capacity SNAPSHOTS, which are a different table from the capacity BUCKETS above:
    // `queryRuntimeSeries` reads `runtime_capacity_snapshots`, while `queryCapacityAnalytics` reads
    // `runtime_capacity_buckets`. The fixture seeded only the latter, so the concurrency/host
    // timelines and three of the four Runtime Analytics metric cards ("Busiest window", "Peak active
    // browsers", "Peak system memory") had never rendered anything but "—" and no check noticed.
    // Seeded in the recent window so they stay available at 15m, which is what makes the
    // neutral-vs-zero matrix a contrast rather than an empty page.
    store.recordCapacitySnapshot({
      timestamp: bucket.bucketStart,
      activeBrowsers: 2 + (i % 3),
      maxBrowsers: 6,
      activeFlows: 3 + (i % 2),
      maxActiveFlows: 8,
      activeContexts: 4,
      activePages: 4,
      queueDepth: i % 4,
      freeMemoryMb: 4_096,
      processRssMb: 180 + i,
      systemMemoryPercent: 40 + i,
      cpuPercent: 30 + i,
      recentCrashes: 0,
      dispatchBlocked: false
    });
  }
  // SYS-REP-010 — the twelve buckets above all sit inside 15 minutes, so every range preset returns
  // the same data and a range selector that ignored its argument entirely would pass. These four sit
  // in exactly one preset band each, which makes the expected bucket count per preset a derivable
  // number rather than an assertion that "something changed".
  const agedBucketMinutes = [40, 6 * 60, 3 * 24 * 60, 10 * 24 * 60];
  for (const ageMinutes of agedBucketMinutes) {
    const start = now - ageMinutes * 60_000;
    store.recordCapacityBucket({
      bucketStart: iso(start),
      bucketEnd: iso(start + 30_000),
      sampleCount: 10,
      cpuMean: 30,
      cpuP95: 40,
      cpuMax: 50,
      memoryMean: 40,
      memoryP95: 50,
      memoryMax: 60,
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
    } satisfies DurableCapacityBucketRecord);
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
  // SYS-REP-010 — a regression that recovered is a state transition an operator needs to see. The
  // durable layer stores and returns `state: "recovered"` faithfully (verify:observability 65/65),
  // so this asks the same question of the GUI.
  store.recordAnomaly({
    ...anomaly,
    runId: "run-alpha-01",
    detectedAt: iso(now - 90_000),
    signalType: "duration-p95",
    severity: "info",
    state: "recovered",
    note: RECOVERED_ANOMALY_NOTE
  } satisfies DurableAnomalyRecord);
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
  // SYS-REP-012 cache probe, opened here and closed at Server Performance much later. Storage sizing
  // is cached for 60s (STORAGE_TTL_MS). Reading it, then adding a known payload, then reading again
  // must return the STALE figure — otherwise the cache does not exist and the "cached for up to a
  // minute" promise on the page is false. The matching expiry assertion runs after the rest of the
  // suite has elapsed past the TTL, so no dead wait is spent here.
  const storageBaseline = await win.evaluate(() => window.playwrightFlowStudio.telemetry.server());
  check(
    `SYS-REP-012 first storage read sees the ${LOGS_PAYLOAD_MIB} MiB seeded into Logs`,
    storageBaseline.storage.logsMb === LOGS_PAYLOAD_MIB,
    `${storageBaseline.storage.logsMb} vs ${LOGS_PAYLOAD_MIB}`
  );
  writeFileSync(join(logDir, "cache-probe.bin"), Buffer.alloc(CACHE_PROBE_PAYLOAD_MIB * 1024 * 1024));
  const cacheProbeWrittenAt = Date.now();
  const storageCached = await win.evaluate(() => window.playwrightFlowStudio.telemetry.server());
  check(
    "SYS-REP-012 a second read inside the TTL returns the cached figure, not a fresh walk",
    storageCached.storage.logsMb === LOGS_PAYLOAD_MIB,
    `${storageCached.storage.logsMb} (a fresh walk would report ${LOGS_PAYLOAD_MIB + CACHE_PROBE_PAYLOAD_MIB})`
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
  // Rates use TERMINAL runs as the denominator (completed + failed); cancelled runs are excluded.
  // Derived from the seeded corpus rather than hardcoded, so this asserts the denominator rule and
  // not the fixture's current size.
  const terminal = fixture.expected.success + fixture.expected.failed;
  const expectedSuccessRate = `${((fixture.expected.success / terminal) * 100).toFixed(1)}%`;
  const expectedFailureRate = `${((fixture.expected.failed / terminal) * 100).toFixed(1)}%`;
  check(`SYS-REP-003 visible Success rate is ${expectedSuccessRate} (terminal-only denominator)`, overviewMetrics["Success rate"]?.value === expectedSuccessRate, `${overviewMetrics["Success rate"]?.value} vs ${expectedSuccessRate}`);
  check(`SYS-REP-003 visible Failure rate is ${expectedFailureRate} (terminal-only denominator)`, overviewMetrics["Failure rate"]?.value === expectedFailureRate, `${overviewMetrics["Failure rate"]?.value} vs ${expectedFailureRate}`);
  check("SYS-REP-003 cancelled runs are excluded from the rate denominator", terminal === fixture.expected.total - fixture.expected.cancelled, `${terminal} of ${fixture.expected.total}`);
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
  check("SYS-REP-004 all five populated workflow rows render", (await workflowRows.count()) === 5, `${await workflowRows.count()} rows`);
  const visibleWorkflowText = await workflowRows.allTextContents();
  check("SYS-REP-004 workflow totals are visible", visibleWorkflowText.some((row) => row.includes("Fixture Workflow Alpha") && row.includes("20")) && visibleWorkflowText.some((row) => row.includes("Fixture Workflow Beta") && row.includes("12")), visibleWorkflowText.join(" | "));
  await win.getByRole("button", { name: "Workflow", exact: true }).click();
  const ascending = await workflowRows.allTextContents();
  await win.getByRole("button", { name: "Workflow", exact: true }).click();
  const descending = await workflowRows.allTextContents();
  // Assert that the two directions are actual REVERSES of each other, rather than naming which
  // workflow lands first — that depends on how many workflows the fixture seeds.
  check(
    "SYS-REP-004 workflow sort reverses the row order",
    ascending.length === descending.length &&
      ascending.length > 1 &&
      ascending[0] !== descending[0] &&
      JSON.stringify(ascending) === JSON.stringify([...descending].reverse()),
    `${ascending[0]?.slice(0, 30)} / ${descending[0]?.slice(0, 30)}`
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
  // SYS-REP-004 — every sortable column, both directions. Asserting only that the order CHANGES
  // would pass for a column that shuffles randomly; assert instead that both directions hold the
  // same row SET, and that the header reports a definite direction each time.
  const sortableLabels = await win.evaluate(() =>
    Array.from(document.querySelectorAll("button.awkit-sort-header")).map((b) => (b.textContent || "").trim())
  );
  check("SYS-REP-004 the workflow table exposes several sortable columns", sortableLabels.length >= 3, sortableLabels.join(" | "));
  for (const label of sortableLabels) {
    const header = win.getByRole("button", { name: label, exact: true });
    await header.click();
    await win.waitForTimeout(250);
    const first = await workflowRows.allTextContents();
    await header.click();
    await win.waitForTimeout(250);
    const second = await workflowRows.allTextContents();
    check(
      `SYS-REP-004 sorting by "${label}" keeps every row across both directions`,
      first.length === 5 && second.length === 5 &&
        JSON.stringify([...first].sort()) === JSON.stringify([...second].sort()),
      `${first.length}/${second.length}`
    );
    const direction = await win.evaluate((name: string) => {
      const b = Array.from(document.querySelectorAll("button.awkit-sort-header")).find((x) => (x.textContent || "").trim() === name);
      return b?.closest("th")?.getAttribute("aria-sort") ?? null;
    }, label);
    check(`SYS-REP-004 sorting by "${label}" exposes a definite aria-sort direction`, direction === "ascending" || direction === "descending", String(direction));
  }

  // The two checks above would both pass for a column that reports a direction and then orders rows
  // arbitrarily: the row SET is preserved either way, and `aria-sort` is just an attribute. The case
  // asks for "stable correct order", so assert the order against the column's OWN values. "Runs" is
  // used because its cell begins with a bare integer. Ties are expected (20, 12, 2, 2, 2), so the
  // invariant is monotonicity per direction — NOT that the two directions are exact reverses, which
  // a stable sort correctly violates when values repeat.
  const runsHeader = win.getByRole("button", { name: "Runs", exact: true });
  const readRunsColumn = async (): Promise<number[]> =>
    win.evaluate(() =>
      Array.from(document.querySelectorAll(".awkit-report-panel .awkit-table tbody tr")).map((tr) =>
        Number.parseInt((tr.children[1]?.textContent || "").trim(), 10)
      )
    );
  const readRunsDirection = async (): Promise<string | null> =>
    win.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button.awkit-sort-header")).find((x) => (x.textContent || "").trim() === "Runs");
      return b?.closest("th")?.getAttribute("aria-sort") ?? null;
    });
  const sortedRuns: Array<{ values: number[]; direction: string | null }> = [];
  for (let i = 0; i < 2; i += 1) {
    await runsHeader.click();
    await win.waitForTimeout(250);
    sortedRuns.push({ values: await readRunsColumn(), direction: await readRunsDirection() });
  }
  for (const { values, direction } of sortedRuns) {
    const monotonic =
      direction === "ascending"
        ? values.every((n, i) => i === 0 || values[i - 1] <= n)
        : direction === "descending"
          ? values.every((n, i) => i === 0 || values[i - 1] >= n)
          : false;
    check(
      `SYS-REP-004 sorting by "Runs" ${direction} orders the column's own values`,
      values.length === 5 && values.every((n) => Number.isFinite(n)) && new Set(values).size >= 2 && monotonic,
      `${direction}: ${values.join(",")}`
    );
  }
  check(
    "SYS-REP-004 the two Runs directions are genuinely opposite",
    sortedRuns[0].direction !== sortedRuns[1].direction &&
      (sortedRuns[0].direction === "ascending" || sortedRuns[0].direction === "descending"),
    `${sortedRuns[0].direction} then ${sortedRuns[1].direction}`
  );

  // Each filter dimension independently. The seeded corpus differs along each axis separately, so a
  // filter that quietly ignored its input would return all five rows and fail here.
  const rowsAfter = async () => {
    await win.waitForTimeout(400);
    return (await win.locator(".awkit-report-panel .awkit-table tbody tr").allTextContents()).filter(Boolean);
  };
  const filterMatrix: Array<[string, string]> = [
    ["Filter by machine", "fixture-machine-C"],
    ["Filter by execution mode", "manual"],
    ["Filter by browser pool mode", "dedicated"],
    ["Filter by workload class", "heavy"]
  ];
  for (const [label, value] of filterMatrix) {
    const control = win.getByLabel(label);
    if ((await control.count()) === 0) {
      notRunCheck(`SYS-REP-004 "${label}" narrows the table`, `no "${label}" control is rendered on this page`);
      continue;
    }
    await control.selectOption(value);
    const rows = await rowsAfter();
    check(`SYS-REP-004 "${label}" = ${value} narrows the table to a strict subset`, rows.length > 0 && rows.length < 5, `${rows.length} of 5`);
    await control.selectOption("");
    const cleared = await rowsAfter();
    check(`SYS-REP-004 clearing "${label}" restores every row`, cleared.length === 5, `${cleared.length} rows`);
  }

  await win.getByLabel("Filter by machine").selectOption("fixture-machine-A");
  const machineFiltered = await rowsAfter();
  check(
    "SYS-REP-004 machine filter keeps independently known rows and labels context",
    machineFiltered.length > 0 && machineFiltered.length < 5,
    machineFiltered.join(" | ").slice(0, 200)
  );
  await win.getByLabel("Filter by execution mode").selectOption("manual");
  const combined = await rowsAfter();
  check(
    "SYS-REP-004 combining two filters intersects, never unions",
    combined.length <= machineFiltered.length,
    `${machineFiltered.length} -> ${combined.length}`
  );
  await win.getByLabel("Filter by machine").selectOption("fixture-machine-C");
  await win.getByLabel("Filter by browser pool mode").selectOption("shared");
  await win.getByLabel("Filter by workload class").selectOption("light");
  await win.waitForTimeout(600);
  check("SYS-REP-004 contradictory combined filters show explicit empty state", await win.getByText("No workflow runs match this filter").isVisible());
  await win.getByLabel("Filter by machine").selectOption("");
  await win.getByLabel("Filter by execution mode").selectOption("");
  await win.getByLabel("Filter by browser pool mode").selectOption("");
  await win.getByLabel("Filter by workload class").selectOption("");
  check("SYS-REP-004 clearing all filters restores the full row set", (await rowsAfter()).length === 5);
  await win.getByRole("button", { name: /Compare/ }).click();
  const compareBoxes = win.locator('.awkit-td-select input[type="checkbox"]');
  check("SYS-REP-005 compare controls render for every populated row", (await compareBoxes.count()) === 5, `${await compareBoxes.count()}`);
  await compareBoxes.nth(0).check();
  await compareBoxes.nth(1).check();
  check("SYS-REP-005 two selected workflows render side by side", (await win.locator(".awkit-compare-card").count()) === 2);
  await compareBoxes.nth(2).check();
  await compareBoxes.nth(3).check();
  await win.waitForTimeout(400);
  check("SYS-REP-005 four selected workflows are all compared", (await win.locator(".awkit-compare-card").count()) === 4, `${await win.locator(".awkit-compare-card").count()} cards`);

  // The fifth selection must be refused. Accept EITHER a disabled control or a no-op check: both are
  // correct implementations of the cap, and pinning one would fail on a legitimate design choice.
  const fifth = compareBoxes.nth(4);
  const fifthDisabled = await fifth.isDisabled();
  if (!fifthDisabled) await fifth.check().catch(() => undefined);
  await win.waitForTimeout(400);
  const cardsAfterFifth = await win.locator(".awkit-compare-card").count();
  check(
    "SYS-REP-005 a fifth selection is refused (disabled control or no fifth card)",
    fifthDisabled || cardsAfterFifth === 4,
    `disabled=${fifthDisabled} cards=${cardsAfterFifth}`
  );
  check("SYS-REP-005 the four existing selections survive the refused fifth", cardsAfterFifth === 4, `${cardsAfterFifth}`);

  // Deselecting must free a slot again — a cap that latches would be a different bug.
  await compareBoxes.nth(0).uncheck();
  await win.waitForTimeout(400);
  check("SYS-REP-005 deselecting a workflow releases a comparison slot", (await win.locator(".awkit-compare-card").count()) === 3, `${await win.locator(".awkit-compare-card").count()}`);
  const compareText = await win.locator(".awkit-compare-card").first().innerText();
  check(
    "SYS-REP-005 each comparison card carries percentage and numeric figures",
    compareText.includes("%") && /[0-9]/.test(compareText),
    compareText.replace(/\s+/g, " ").slice(0, 160)
  );
  await win.getByRole("button", { name: /Compare/ }).click();
  await win.locator(".awkit-report-panel .awkit-table tbody tr").filter({ hasText: "Fixture Workflow Alpha" }).click();
  await win.getByRole("button", { name: "Details" }).first().click();
  await win.getByRole("dialog", { name: "Run detail" }).waitFor({ timeout: 15_000 });
  const detailText = await win.getByRole("dialog", { name: "Run detail" }).innerText();
  check("SYS-REP-006 run detail opens the selected durable run", detailText.includes(DETAIL_RUN_ID) && detailText.includes("Fixture Workflow Alpha") && detailText.includes("failed"), detailText.slice(0, 500));
  check("SYS-REP-006 attempts and artifacts match durable rows", detailText.includes("Node attempts (2)") && detailText.includes("Artifacts (2)") && detailText.includes("submit-order"), detailText.slice(0, 700));
  await win.getByRole("button", { name: "Close", exact: true }).click();
  check("SYS-REP-006 close button dismisses the drawer", (await win.getByRole("dialog", { name: "Run detail" }).count()) === 0);

  // SYS-REP-006 / SYS-REP-016 — a drawer must also close by Escape, and focus must come back to the
  // control that opened it. A keyboard user who opens a drawer and cannot get focus back is stranded,
  // and that is invisible to any assertion that only checks the drawer disappeared.
  const detailsOpener = win.getByRole("button", { name: "Details" }).first();
  await detailsOpener.focus();
  await detailsOpener.click();
  const drawer = win.getByRole("dialog", { name: "Run detail" });
  await drawer.waitFor({ timeout: 15_000 });
  const focusInsideDrawer = await win.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
  });
  check("SYS-REP-016 opening the run drawer moves focus into it", focusInsideDrawer);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
  const closedByEscape = (await win.getByRole("dialog", { name: "Run detail" }).count()) === 0;
  check("SYS-REP-006 Escape dismisses the run drawer", closedByEscape);
  if (closedByEscape) {
    // The tag name is asserted, not just the label: when focus is lost `document.activeElement`
    // falls back to `<body>`, whose textContent contains every button label on the page — including
    // "Details". A text-only assertion here would pass exactly when the defect is present.
    const focusReturned = await win.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return { tag: active?.tagName ?? "none", text: (active?.textContent || "").trim().slice(0, 40) };
    });
    check(
      "SYS-REP-016 focus returns to the control that opened the drawer",
      focusReturned.tag === "BUTTON" && focusReturned.text === "Details",
      `activeElement=<${focusReturned.tag}> "${focusReturned.text}"`
    );
  } else {
    notRunCheck("SYS-REP-016 focus returns to the control that opened the drawer", "the drawer did not close on Escape, so focus return had no precondition");
    await win.getByRole("button", { name: "Close", exact: true }).click().catch(() => undefined);
  }

  // A retained run that no longer exists must produce an explicit retention message, not a blank
  // drawer or a crash.
  const missingRunDetail = await win.evaluate(async () => {
    try {
      const detail = await window.playwrightFlowStudio.telemetry.runDetail("run-that-was-retained-away");
      return { threw: false, detail: JSON.stringify(detail ?? null).slice(0, 200) };
    } catch (error) {
      return { threw: true, detail: error instanceof Error ? error.message : String(error) };
    }
  });
  check(
    "SYS-REP-006 a missing retained run degrades safely rather than crashing or leaking",
    !missingRunDetail.detail.includes("Error") && !/[A-Za-z]:\\/.test(missingRunDetail.detail),
    JSON.stringify(missingRunDetail)
  );
  // The retention message itself is asserted near the end of this suite, against a run deleted by
  // the product's own retention sweep while its row is still on screen.
  await win.screenshot({ path: join(screenshots, "02-workflows-populated.png"), fullPage: true });

  // Instance history: >1 page, no duplicates and detail identity.
  await navClick(win, "Instance Reports");
  await waitForReportPage(win, "Instance Reports");
  const pagerText1 = await win.locator(".awkit-pager").innerText();
  const page1Ids = await win.evaluate(async () => (await window.playwrightFlowStudio.telemetry.runHistory("24h", { limit: 25, offset: 0 })).rows.map((row) => row.instanceId));
  check(`SYS-REP-007 first page reports 25 of ${fixture.expected.total}`, new RegExp(`1.*25.*${fixture.expected.total}`, "s").test(pagerText1) && page1Ids.length === 25, pagerText1);
  await win.getByRole("button", { name: "Next page" }).click();
  await win.waitForTimeout(500);
  const pagerText2 = await win.locator(".awkit-pager").innerText();
  const page2Ids = await win.evaluate(async () => (await window.playwrightFlowStudio.telemetry.runHistory("24h", { limit: 25, offset: 25 })).rows.map((row) => row.instanceId));
  check(`SYS-REP-007 second page reports 26-${fixture.expected.total} of ${fixture.expected.total}`, new RegExp(`26.*${fixture.expected.total}.*${fixture.expected.total}`, "s").test(pagerText2) && page2Ids.length === fixture.expected.total - 25, pagerText2);
  check("SYS-REP-007 pages contain no duplicate/missing IDs", new Set([...page1Ids, ...page2Ids]).size === fixture.expected.total, `${new Set([...page1Ids, ...page2Ids]).size}/${fixture.expected.total}`);
  check("SYS-REP-007 next button disables at boundary", await win.getByRole("button", { name: "Next page" }).isDisabled());
  await win.getByRole("button", { name: "Previous page" }).click();
  await win.getByRole("button", { name: "Details" }).first().click();
  await win.getByRole("dialog", { name: "Run detail" }).waitFor({ timeout: 15_000 });
  check("SYS-REP-007 first-row detail identity is correct", (await win.getByRole("dialog", { name: "Run detail" }).innerText()).includes(DETAIL_RUN_ID));
  // The live distribution polls `executions.list()` — the in-memory ExecutionEngine instance list —
  // and never reads the durable store this fixture seeds. Seeded history therefore cannot produce a
  // queued or running instance, and asserting "no instances in the pool" here would prove only that
  // the fixture seeds no live work, which is by construction.
  const liveStatusText = await win.locator(".awkit-report-page").innerText();
  notRunCheck(
    "SYS-REP-007 live queued/running distribution matches engine state",
    `useLiveDistribution reads executions.list() from the live ExecutionEngine, not the seeded store; the page correctly reports ${
      liveStatusText.includes("No instances in the pool right now") ? '"No instances in the pool right now"' : "an unexpected live state"
    }. PROVEN ELSEWHERE: npm run verify:reports-live-engine starts real instances and asserts the rendered distribution equals executions.list()`
  );
  await win.getByRole("button", { name: "Close", exact: true }).click();

  // Failure analytics populated categories + ranking.
  await navClick(win, "Failure Analytics");
  await waitForReportPage(win, "Failure Analytics");
  const failureText = await win.locator(".awkit-report-page").innerText();
  // Derived from the seeded corpus, not hardcoded — the count is the point, the fixture size is not.
  check(
    `SYS-REP-009 visible failure total matches the ${fixture.expected.failed} seeded failed rows`,
    failureText.includes(`${fixture.expected.failed} failed run(s)`) && failureText.includes(`${fixture.expected.failed}\nfailures`),
    failureText.slice(0, 400)
  );
  for (const label of ["Timeout", "Selector", "Network", "Assertion / validation", "Session expired", "Auth handoff required"]) {
    check(`SYS-REP-009 category visible: ${label}`, failureText.includes(label));
  }
  // The extra workflows seed failures with an `unknown` category on purpose: a taxonomy that only
  // ever sees named categories would never exercise its fallback, and an uncategorised failure
  // silently vanishing from the distribution is exactly the reporting lie this case guards against.
  check(
    "SYS-REP-009 an uncategorised failure is surfaced rather than dropped",
    /unknown|uncategori[sz]ed|other/i.test(failureText),
    failureText.slice(0, 400)
  );
  const categoryTotal = await win.evaluate(async () => {
    const failures = await window.playwrightFlowStudio.telemetry.failures("24h");
    const buckets = (failures as { categories?: Array<{ count?: number }> }).categories ?? [];
    return buckets.reduce((sum, bucket) => sum + (bucket.count ?? 0), 0);
  });
  check(
    "SYS-REP-009 the category distribution accounts for every failed run",
    categoryTotal === fixture.expected.failed,
    `${categoryTotal} categorised vs ${fixture.expected.failed} failed`
  );
  // Only FAILURES may enter failure views — a completed or cancelled run appearing here would
  // silently inflate every reliability figure downstream.
  //
  // This check used to read `failures.recent`, a field `FailureBreakdown` did not have. It resolved
  // to `undefined ?? []` every run, and the `length === 0 ||` escape hatch then passed it — so it sat
  // in the ledger having never tested anything. `recent` now exists (AWKIT-REP-006) and the escape
  // hatch is gone: an empty evidence list is a FAILURE here, because the fixture seeds failures.
  const failureRunIds = await win.evaluate(async () => {
    const failures = await window.playwrightFlowStudio.telemetry.failures("24h");
    return (failures.recent ?? []).map((row) => row.instanceId);
  });
  const seededFailedIds = new Set(fixture.currentRuns.filter((run) => run.status === "failed").map((run) => run.instanceId));
  check(
    "SYS-REP-009 the failure evidence list is populated",
    failureRunIds.length > 0,
    `${failureRunIds.length} evidence rows for ${fixture.expected.failed} seeded failures`
  );
  check(
    "SYS-REP-009 only failed runs appear in the failure evidence list",
    failureRunIds.length > 0 && failureRunIds.every((id) => seededFailedIds.has(id)),
    JSON.stringify(failureRunIds.filter((id) => !seededFailedIds.has(id)).slice(0, 5))
  );
  // Evidence must be REDACTED by construction: the contract carries identity, category and timings
  // only. A free-text error message here is how a secret reaches a report.
  const evidenceKeys = await win.evaluate(async () => {
    const failures = await window.playwrightFlowStudio.telemetry.failures("24h");
    return [...new Set((failures.recent ?? []).flatMap((row) => Object.keys(row)))].sort();
  });
  check(
    "SYS-REP-009 evidence rows carry no free-text error field",
    !evidenceKeys.some((key) => /message|error|stack|detail|output|log/i.test(key)),
    evidenceKeys.join(",")
  );

  check("SYS-REP-009 reliability table includes both workflows", failureText.includes("Fixture Workflow Alpha") && failureText.includes("Fixture Workflow Beta"));

  // ── SYS-REP-009 — low-sample flakiness suppression ─────────────────────────
  // Read per row, because "a — appears somewhere on the page" is satisfied by any empty cell.
  // Alpha/Beta have 20 and 12 runs; Gamma/Delta/Epsilon have 2 each, below the 5-run threshold.
  const reliabilityRows = await win.evaluate(() => {
    const out: { workflow: string; runs: number; success: string; flakiness: string }[] = [];
    document.querySelectorAll(".awkit-report-panel table.awkit-table tbody tr").forEach((tr) => {
      const cells = [...tr.querySelectorAll("td")].map((td) => (td.textContent || "").trim());
      if (cells.length === 5 && /^\d+$/.test(cells[1])) {
        out.push({ workflow: cells[0], runs: Number(cells[1]), success: cells[2], flakiness: cells[4] });
      }
    });
    return out;
  });
  const lowSample = reliabilityRows.filter((row) => row.runs < 5);
  const highSample = reliabilityRows.filter((row) => row.runs >= 5);
  check(
    "SYS-REP-009 the reliability table contains rows on BOTH sides of the 5-run threshold (control)",
    lowSample.length > 0 && highSample.length > 0,
    `low=${lowSample.map((r) => `${r.workflow}:${r.runs}`).join(" ")} | high=${highSample.map((r) => `${r.workflow}:${r.runs}`).join(" ")}`
  );
  check(
    "SYS-REP-009 a low-sample workflow reports no flakiness score",
    lowSample.length > 0 && lowSample.every((row) => row.flakiness === "—"),
    lowSample.map((r) => `${r.workflow}(${r.runs} runs)=${r.flakiness}`).join(" ")
  );
  // The other half, and the reason the check above is not satisfied by a column that is always "—".
  check(
    "SYS-REP-009 a sufficiently sampled workflow DOES report a score",
    highSample.length > 0 && highSample.every((row) => /^\d+$/.test(row.flakiness)),
    highSample.map((r) => `${r.workflow}(${r.runs} runs)=${r.flakiness}`).join(" ")
  );
  // The suppressed rows are not silently-zero rows. Asserted from the data BESIDE the blank cell:
  // each low-sample workflow is seeded 1 failed of 2 runs, so its success rate is under 100% and an
  // implementation that ignored the threshold would have printed 30 there, not 0. Without this,
  // "the cell is —" is equally satisfied by a workflow that simply never failed.
  check(
    "SYS-REP-009 the suppressed rows DID fail, so '—' is suppression rather than a zero score",
    lowSample.length > 0 && lowSample.every((row) => row.success !== "100%"),
    lowSample.map((r) => `${r.workflow}: ${r.runs} runs, ${r.success} success → ${r.flakiness}`).join(" | ")
  );

  // ── SYS-REP-009 — evidence navigation ──────────────────────────────────────
  const evidenceTable = win.getByTestId("failure-evidence-table");
  check("SYS-REP-009 the failure evidence table is rendered", await evidenceTable.isVisible());
  const firstEvidenceId = failureRunIds[0];
  await win.getByTestId(`failure-evidence-open-${firstEvidenceId}`).click();
  const evidenceDrawer = win.getByRole("dialog", { name: "Run detail" });
  await evidenceDrawer.waitFor({ state: "visible", timeout: 8_000 });
  const evidenceDetail = await evidenceDrawer.innerText();
  // Points at the CORRECT run — the id it was opened with, not merely "a run".
  check(
    "SYS-REP-009 evidence navigation opens the run it names",
    evidenceDetail.includes(firstEvidenceId),
    `expected ${firstEvidenceId} in drawer: ${evidenceDetail.slice(0, 200)}`
  );
  check(
    "SYS-REP-009 the navigated run is one of the seeded failures",
    seededFailedIds.has(firstEvidenceId),
    firstEvidenceId
  );
  await win.getByRole("button", { name: "Close", exact: true }).click();
  check("SYS-REP-009 the evidence drawer closes", (await win.getByRole("dialog", { name: "Run detail" }).count()) === 0);
  await win.screenshot({ path: join(screenshots, "03-failure-analytics.png"), fullPage: true });

  // Populated runtime analytics and server storage.
  await navClick(win, "Runtime Analytics");
  await waitForReportPage(win, "Runtime Analytics");
  const runtimeText = await win.locator(".awkit-report-page").innerText();
  check("SYS-REP-010 capacity samples, admission reasons and anomaly render", runtimeText.includes("Capacity & queue effectiveness") && runtimeText.includes("CPU pressure") && runtimeText.includes("failure-rate") && runtimeText.includes("Synthetic, independently seeded regression"));
  check("SYS-REP-010 environmental metrics are labelled", (await win.locator(".awkit-obs-env").count()) >= 4);

  // SYS-REP-010 — every preset, against counts derived from the seed. Twelve buckets sit inside
  // 15 minutes and one more sits in each wider band, so a range argument that was ignored, clamped,
  // or applied with the wrong sign produces a different sequence than this one.
  const expectedBuckets: Array<[string, number]> = [["15m", 12], ["1h", 13], ["24h", 14], ["7d", 15], ["all", 16]];
  const observedBuckets = await win.evaluate(async (presets: string[]) => {
    const out: Array<{ preset: string; bucketCount: number }> = [];
    for (const preset of presets) {
      const capacity = await window.playwrightFlowStudio.telemetry.capacityAnalytics(preset as never);
      out.push({ preset, bucketCount: capacity.bucketCount });
    }
    return out;
  }, expectedBuckets.map(([preset]) => preset));
  for (const [preset, expected] of expectedBuckets) {
    const observed = observedBuckets.find((entry) => entry.preset === preset)?.bucketCount;
    check(`SYS-REP-010 the "${preset}" range returns exactly its ${expected} seeded capacity buckets`, observed === expected, `${observed} vs ${expected}`);
  }
  check(
    "SYS-REP-010 widening the range never returns fewer buckets",
    observedBuckets.every((entry, i) => i === 0 || observedBuckets[i - 1].bucketCount <= entry.bucketCount),
    observedBuckets.map((entry) => `${entry.preset}=${entry.bucketCount}`).join(" ")
  );

  // Driving the selector proves the RENDERED page follows the range, not just the IPC call above.
  for (const preset of ["15m", "7d"]) {
    await win.getByRole("button", { name: preset, exact: true }).click();
    await waitForReportPage(win, "Runtime Analytics");
  }
  check("SYS-REP-010 the range selector re-renders without error", (await win.locator(".awkit-report-page").count()) === 1);

  // ── SYS-REP-010 — the neutral-vs-zero matrix ───────────────────────────────
  // "Unavailable" and "measured zero" must not look the same. A metric with no samples in range has
  // to read as UNKNOWN; rendering `0` there tells the operator the system measured no Chromium
  // memory, which is a different and false claim.
  //
  // Driven through the real range selector rather than by mutating data, so the dash is provably
  // range-driven absence: process samples sit 40-51 minutes back, capacity buckets 0-11 minutes back.
  const metricCardValues = async () =>
    win!.evaluate(() => {
      const out: Record<string, { value: string; detail: string }> = {};
      document.querySelectorAll(".metric-card").forEach((card) => {
        // MetricCard renders <div><span>label</span><strong>value</strong></div>{icon}<p>detail</p>.
        const label = card.querySelector("span")?.textContent?.trim() ?? "";
        const value = card.querySelector("strong")?.textContent?.trim() ?? "";
        const detail = card.querySelector("p")?.textContent?.trim() ?? "";
        if (label) out[label] = { value, detail };
      });
      return out;
    });

  await win.getByRole("button", { name: "15m", exact: true }).click();
  await waitForReportPage(win, "Runtime Analytics");
  const narrowCards = await metricCardValues();
  check(
    "SYS-REP-010 a metric with no samples in range reads as unknown, not as a measured 0",
    narrowCards["Peak Chromium memory"]?.value === "—",
    `Peak Chromium memory = ${JSON.stringify(narrowCards["Peak Chromium memory"])}`
  );
  check(
    "SYS-REP-010 the unavailable metric SAYS it is unavailable rather than showing a bare dash",
    /unavailable/i.test(narrowCards["Peak Chromium memory"]?.detail ?? ""),
    narrowCards["Peak Chromium memory"]?.detail ?? "(no detail)"
  );
  // Co-rendered control: another card in the SAME render is populated, so the dash above is not
  // simply "this page has no data at all".
  check(
    "SYS-REP-010 a metric that DOES have samples in the same range still reports a value",
    /^\d+%$/.test(narrowCards["Peak system memory"]?.value ?? ""),
    `Peak system memory = ${narrowCards["Peak system memory"]?.value ?? "(missing)"}`
  );

  await win.getByRole("button", { name: "1h", exact: true }).click();
  await waitForReportPage(win, "Runtime Analytics");
  const widerCards = await metricCardValues();
  // The other half: widening the range makes the SAME metric available. Without this, "renders —"
  // is equally satisfied by a card that is hardcoded to a dash.
  check(
    "SYS-REP-010 widening the range makes the same metric available, so the dash was absence",
    /MB$/.test(widerCards["Peak Chromium memory"]?.value ?? ""),
    `Peak Chromium memory at 1h = ${widerCards["Peak Chromium memory"]?.value ?? "(missing)"}`
  );
  check(
    "SYS-REP-010 the now-available metric reports its sampled process count rather than 'unavailable'",
    /peak \d+ process/i.test(widerCards["Peak Chromium memory"]?.detail ?? ""),
    widerCards["Peak Chromium memory"]?.detail ?? "(no detail)"
  );
  await win.getByRole("button", { name: "24h", exact: true }).click();
  await waitForReportPage(win, "Runtime Analytics");

  // A regression that recovered is a state transition, and the durable layer returns it faithfully.
  const anomalyStates = await win.evaluate(async () => {
    const rows = await window.playwrightFlowStudio.telemetry.anomalies("all" as never, undefined, 100);
    return rows.map((row) => ({ state: row.state, note: row.note ?? "" }));
  });
  check(
    "SYS-REP-010 the durable layer returns both an active and a recovered anomaly",
    anomalyStates.some((a) => a.state === "active") && anomalyStates.some((a) => a.state === "recovered"),
    JSON.stringify(anomalyStates)
  );
  const runtimeTextAll = await win.locator(".awkit-report-page").innerText();
  check(
    "SYS-REP-010 a recovered anomaly is surfaced rather than silently dropped",
    runtimeTextAll.includes(RECOVERED_ANOMALY_NOTE),
    `recovered note ${runtimeTextAll.includes(RECOVERED_ANOMALY_NOTE) ? "present" : "ABSENT"}`
  );
  check(
    "SYS-REP-010 the active anomaly is still shown alongside it",
    runtimeTextAll.includes("Synthetic, independently seeded regression"),
    `active note ${runtimeTextAll.includes("Synthetic, independently seeded regression") ? "present" : "ABSENT"}`
  );
  // Rendering both rows is not enough: the two states must be told apart. Showing everything as
  // "active" would satisfy the two checks above while still misreporting the workflow's health.
  const anomalyRowStates = await win.evaluate(() =>
    Array.from(document.querySelectorAll(".awkit-obs-table tr.is-recovered, .awkit-obs-table tbody tr")).length === 0
      ? []
      : Array.from(document.querySelectorAll(".awkit-obs-table tbody tr"))
          .map((tr) => (tr.querySelector(".awkit-status-badge")?.textContent || "").trim())
          .filter(Boolean)
  );
  check(
    "SYS-REP-010 each anomaly row carries its own labelled state, not colour alone",
    anomalyRowStates.includes("active") && anomalyRowStates.includes("recovered"),
    anomalyRowStates.join(",") || "no state badges rendered"
  );
  await win.screenshot({ path: join(screenshots, "04-runtime-analytics.png"), fullPage: true });

  await navClick(win, "Chrome Consumption");
  await waitForReportPage(win, "Chrome Consumption");
  check("SYS-REP-011 four live gauges render", (await win.locator(".awkit-gauge-card").count()) === 4);
  await win.waitForTimeout(2_500);
  check("SYS-REP-011 polling remains stable through a second cycle", (await win.locator(".awkit-gauge-card").count()) === 4);
  // `backpressureBlocked` is read from the LIVE ExecutionEngine's runtime status, not from the
  // durable store this fixture seeds, so no amount of seeding can produce it. Proving it needs a
  // harness that saturates a real engine with real instances. Recorded, not silently skipped.
  notRunCheck(
    "SYS-REP-011 backpressure appears and clears",
    "telemetry:server reads dispatchBlocked from the live ExecutionEngine, which this store-seeded fixture never populates. PROVEN ELSEWHERE: npm run verify:reports-live-engine saturates a real engine until dispatch is refused, then releases it (that run is what found AWKIT-REP-008)"
  );

  await navClick(win, "Server Performance");
  await waitForReportPage(win, "Server Performance");
  const serverText = await win.locator(".awkit-report-page").innerText();
  check("SYS-REP-012 four process metric cards render", (await win.locator(".metric-card").count()) >= 4);
  check("SYS-REP-012 storage sizing includes the seeded stores", serverText.includes("Storage usage") && serverText.includes("Reports") && serverText.includes("Runtime DB"), serverText.slice(0, 600));

  // SYS-REP-012 — exact bytes. "A number rendered" is not the claim; "the number equals what was
  // written" is. `dirSizeMb` rounds to 0.1 MB and the pre-existing fixture evidence in these folders
  // is a few dozen bytes, far below that resolution.
  // Close the cache probe opened at Overview. Only sleep for whatever is left of the TTL — the rest
  // of the suite has already consumed most of it.
  const ttlRemaining = 61_000 - (Date.now() - cacheProbeWrittenAt);
  if (ttlRemaining > 0) await win.waitForTimeout(ttlRemaining);
  const expectedLogsMb = LOGS_PAYLOAD_MIB + CACHE_PROBE_PAYLOAD_MIB;
  const storage = await win.evaluate(() => window.playwrightFlowStudio.telemetry.server());
  check(
    `SYS-REP-012 the cache expires and the recomputed Logs figure equals the ${expectedLogsMb} MiB on disk`,
    storage.storage.logsMb === expectedLogsMb,
    `${storage.storage.logsMb} vs ${expectedLogsMb} (elapsed ${Math.round((Date.now() - cacheProbeWrittenAt) / 1000)}s)`
  );
  check(
    `SYS-REP-012 Screenshots sizing equals the ${SCREENSHOTS_PAYLOAD_MIB} MiB written into a sub-folder`,
    storage.storage.screenshotsMb === SCREENSHOTS_PAYLOAD_MIB,
    `${storage.storage.screenshotsMb} vs ${SCREENSHOTS_PAYLOAD_MIB}`
  );
  check(
    "SYS-REP-012 the total is the sum of its parts",
    Math.abs(storage.storage.totalMb -
      (storage.storage.reportsMb + storage.storage.screenshotsMb + storage.storage.logsMb + storage.storage.downloadsMb + storage.storage.runtimeDbMb)) < 0.05,
    JSON.stringify(storage.storage)
  );
  check(
    "SYS-REP-012 a runtime folder that was never created reports 0 rather than failing the whole report",
    storage.storage.downloadsMb === 0,
    `downloads=${storage.storage.downloadsMb}`
  );
  // The denied sub-tree. The precondition is asserted first: if the ACL did not actually take, the
  // exclusion below would pass for the wrong reason (nothing to exclude) rather than proving
  // anything. The Logs figure above already equals the readable payload exactly, so the denied
  // 4 MiB is demonstrably excluded — and the rest of the report still rendered.
  check(
    `SYS-REP-012 the ${DENIED_PAYLOAD_MIB} MiB sub-tree is genuinely unreadable (precondition)`,
    directoryIsUnreadable(deniedDir),
    deniedDir.replace(root, "<repo>")
  );
  check(
    "SYS-REP-012 an unreadable sub-tree is skipped, not counted and not fatal",
    storage.storage.logsMb === expectedLogsMb && serverText.includes("Storage usage"),
    `logs=${storage.storage.logsMb}; a walk that ignored the denial would report ${expectedLogsMb + DENIED_PAYLOAD_MIB}`
  );
  // The other half of SYS-REP-010's neutral-vs-zero matrix, on the page that owns measured zeroes:
  // a folder that was never created is a MEASURED 0 and must render as `0`, not as the `—` that
  // means "unknown". Together with the Runtime Analytics assertions, both directions are pinned —
  // unknown never renders as 0, and 0 never renders as unknown.
  //
  // The previous form of this check read `chromiumMemoryMb === undefined ? … : true`. The fixture
  // always defines it, so the ternary evaluated to `true` and the check passed without testing
  // anything — the same escape-hatch shape as the `length === 0 ||` in SYS-REP-009.
  check(
    "SYS-REP-012 a measured zero renders as 0, not as the dash that means unknown",
    storage.storage.downloadsMb === 0 && /(^|\D)0(\D|$)/.test(serverText),
    `downloadsMb=${String(storage.storage.downloadsMb)} (a never-created folder: measured, not unknown)`
  );
  // Extract every Windows path the page renders and require each to sit under this run's evidence
  // root. A blanket "does not contain C:\" would also pass on a page that renders no paths at all,
  // so the count is reported either way rather than hidden.
  // The truncation flag must be FALSE for the folders measured above, or "at least" would be shown
  // permanently and the bound test below would prove nothing.
  check(
    "SYS-REP-012 a walk that completed reports an exact total, not a lower bound (control)",
    storage.storage.truncated === false,
    `truncated=${String(storage.storage.truncated)}`
  );

  const renderedPaths = serverText.match(/[A-Za-z]:\\[^\s"']+/g) ?? [];
  check(
    "SYS-REP-012 every path the page renders stays inside the runtime root",
    renderedPaths.every((path) => path.toLowerCase().startsWith(runtimeRoot.toLowerCase())),
    `${renderedPaths.length} path(s) rendered: ${renderedPaths.slice(0, 3).join(" | ") || "none"}`
  );

  // ── SYS-REP-012 — the large-directory bound ────────────────────────────────
  // `dirSizeMb` stops after 20,000 entries. That bound was documented in the source and had never
  // been exercised, so nothing proved either that it exists or that the figure it produces announces
  // itself as partial. Before this round it did not: the walk returned a silently truncated number
  // that read as a total, which is the same class of reporting lie as `AWKIT-SET-005`.
  //
  // The directory is created in the OS TEMP dir, never under the repo: this profile lives beneath
  // `test-artifacts/`, which sits inside the user's OneDrive, and 20k files there would be pushed
  // straight into cloud sync. `downloadsPath` is pointed at it through the same settings path SET-007
  // covers, and both are restored in a `finally`.
  const boundDir = mkdtempSync(join(tmpdir(), "awkit-dirbound-"));
  const previousDownloadsPath = await win.evaluate(async () => (await window.playwrightFlowStudio.settings.get()).paths?.downloadsPath ?? "");
  try {
    for (let i = 0; i < DIR_BOUND_ENTRIES; i += 1) writeFileSync(join(boundDir, `entry-${i}.bin`), "");
    check(
      `SYS-REP-012 the oversized directory really holds more than the 20,000-entry bound (precondition)`,
      readdirSync(boundDir).length === DIR_BOUND_ENTRIES && DIR_BOUND_ENTRIES > 20_000,
      `${readdirSync(boundDir).length} entries`
    );
    await win.evaluate(
      async (dir) => { await window.playwrightFlowStudio.settings.update({ paths: { downloadsPath: dir } }); },
      boundDir
    );
    // Storage is cached for 60 s and a settings change does not invalidate it, so the previous
    // reading has to expire before the new folder can be measured.
    await win.waitForTimeout(61_000);
    const bounded = await win.evaluate(() => window.playwrightFlowStudio.telemetry.server());
    check(
      "SYS-REP-012 a directory past the entry bound reports the walk as truncated",
      bounded.storage.truncated === true,
      `truncated=${String(bounded.storage.truncated)} downloadsMb=${bounded.storage.downloadsMb}`
    );
    await navClick(win, "Reports");
    await navClick(win, "Server Performance");
    await waitForReportPage(win, "Server Performance");
    const boundedText = await win.locator(".awkit-report-page").innerText();
    check(
      "SYS-REP-012 the truncated total presents itself as a lower bound, not as a total",
      /at least/i.test(await win.getByTestId("storage-total-summary").innerText()),
      (await win.getByTestId("storage-total-summary").innerText()).slice(0, 120)
    );
    check(
      "SYS-REP-012 the operator is told why the figure is partial",
      (await win.getByTestId("storage-truncated-note").count()) === 1 && /lower bound/i.test(boundedText),
      boundedText.slice(-320)
    );
  } finally {
    await win
      .evaluate(
        async (previous) => { await window.playwrightFlowStudio.settings.update({ paths: { downloadsPath: previous } }); },
        previousDownloadsPath
      )
      .catch(() => undefined);
    rmSync(boundDir, { recursive: true, force: true });
  }
  check("SYS-REP-012 the oversized directory is removed again", !existsSync(boundDir));

  // Stored run report list/export contract. A corrupt sibling must not crash or create a fake row.
  await navClick(win, "Run Artifacts");
  await win.waitForSelector("#reports-list", { timeout: 15_000 });
  const cards = win.locator(".report-card");
  check("SYS-REP-008 corrupt report is skipped and only the real report renders", (await cards.count()) === 1);
  const cardText = await cards.first().innerText();
  check("SYS-REP-008 report card uses the stored report contract", cardText.includes("Fixture Workflow Alpha") && cardText.includes("failed") && cardText.includes("1 instance"), cardText);
  /*
   * Scoped to the card and anchored, and no swallowed error.
   *
   * This was a page-wide `getByRole("button", { name: /Open/ })` with `.catch(() => false)`. The Run
   * Artifacts page carries other controls whose names contain "Open", so the unanchored pattern matched
   * more than one element and Playwright's strict mode threw — which the catch turned into a plain
   * failing check that could not say why. The counts are reported either way, so an ambiguity here
   * names itself instead of looking like a missing button.
   */
  const cardOpenAction = cards.first().getByRole("button", { name: /^Open$/ });
  const cardOpenMatches = await cardOpenAction.count();
  const pageWideOpenMatches = await win.getByRole("button", { name: /Open/ }).count();
  console.log(`    · Open controls: ${cardOpenMatches} in the report card, ${pageWideOpenMatches} page-wide matching /Open/`);
  check(
    "SYS-REP-008 Open action is available for a real stored report",
    cardOpenMatches === 1 && (await cardOpenAction.isVisible().catch(() => false)),
    `card matches=${cardOpenMatches}, page-wide /Open/ matches=${pageWideOpenMatches}`
  );

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

  // ── SYS-REP-006 — the retention message ────────────────────────────────────
  // Previously recorded as needing a telemetry contract change, on the grounds that `runDetail`
  // returns "an empty structure" a caller cannot tell apart from a retained run with no attempts.
  // That was a misreading of the evidence: `RunDetail.run` is OPTIONAL, and `JSON.stringify` omits
  // undefined properties — so the absence of `run` in that logged string WAS the signal, and
  // `RunDetailDrawer` already branches on it. No contract change was needed; what was missing was a
  // test. Both halves are asserted here.
  //
  // Runs LAST, immediately before the RBAC section, because it deletes real rows.
  const knownDetail = await win.evaluate(
    async (id) => JSON.parse(JSON.stringify((await window.playwrightFlowStudio.telemetry.runDetail(id)) ?? null)),
    DETAIL_RUN_ID
  );
  const unknownDetail = await win.evaluate(
    async () => JSON.parse(JSON.stringify((await window.playwrightFlowStudio.telemetry.runDetail("run-that-was-retained-away")) ?? null))
  );
  check(
    "SYS-REP-006 a retained run and an unretained one are distinguishable in the contract",
    knownDetail?.run !== undefined && unknownDetail?.run === undefined,
    `known.run=${knownDetail?.run === undefined ? "absent" : "present"} unknown.run=${unknownDetail?.run === undefined ? "absent" : "present"}`
  );

  // The drawer's own missing-run branch renders "Run not found — This run is no longer in the
  // durable history (retention may have removed it)." and is DEFENSIVE rather than reachable: every
  // control that opens the drawer (Instance Reports, Workflow Reports, and the new Failure evidence
  // table) takes its ids from the same store the drawer then queries, and `sweepRetention` runs only
  // at ExecutionEngine STARTUP — so within one session no on-screen row can outlive its run.
  //
  // Two routes were tried and MEASURED before this was written down, so they are not re-attempted:
  // driving `sweepRetention` from a second SqliteRuntimeStore connection does nothing to the running
  // app (the store is sql.js — an in-memory database that persists by rewriting the file — so the
  // app's copy is untouched and its next save overwrites the sweep); and restarting with
  // AWKIT_REPORT_RETENTION_RUNS=1 does delete the rows, but the relaunched app then renders only the
  // surviving run, so there is still no stale row to click.
  //
  // An earlier revision of this block swept the string in the row's FIRST cell, which is the workflow
  // NAME rather than an instance id. Its "the run is gone" precondition passed for exactly the wrong
  // reason — `runDetail` returns no run for a string that was never an id — and only the assertion
  // after it failing revealed that nothing had been deleted.
  notRunCheck(
    "SYS-REP-006 the drawer renders its retention message for a run deleted underneath a stale row",
    "unreachable in one session: retention sweeps only at engine startup and every drawer entry point re-reads the same store; measured — a second sql.js connection cannot mutate the running app's in-memory database"
  );

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
  check("SYS-REP-015 Viewer can read Reports data", viewerRead.totalRuns === fixture.expected.total && viewerRead.reportId === REPORT_ID, `${viewerRead.totalRuns}/${fixture.expected.total}`);
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

  // SYS-REP-015 — the denials above must be RECORDED, not just refused. Read the durable audit
  // trail back through the Super User's own AUDIT_VIEW surface, so this asserts what an operator
  // would actually be able to see rather than an internal call.
  const auditRows = await win.evaluate(async () => {
    const api = window.playwrightFlowStudio;
    const login = await api.security.login({
      providerId: "local",
      username: "reportsverifier",
      password: "Str0ng!Passw0rd"
    });
    if (!login.ok) return { ok: false as const, reason: login.reason, rows: [] };
    const listed = await api.security.admin.listAudit({ sessionRef: login.principal.sessionRef, limit: 200 });
    return { ok: listed.ok as boolean, reason: listed.reason, rows: listed.value ?? [] };
  });
  check("SYS-REP-015 audit trail is readable by an AUDIT_VIEW holder", auditRows.ok, auditRows.reason);

  const denials = auditRows.rows.filter(
    (row) => row.result === "failure" && (row.eventType === "TELEMETRY_READ_DENIED" || row.eventType.startsWith("REPORT_"))
  );
  // `report:list` (singular) is what the preload's `reports.list()` actually invokes — the plural
  // `reports:list` handler exists but no renderer path reaches it.
  for (const channel of ["telemetry:overview", "report:list", "reports:get", "reports:openFolder"]) {
    const row = denials.find((entry) => entry.targetId === channel);
    check(
      `SYS-REP-015 denied ${channel} is persisted in the audit trail`,
      Boolean(row) && row?.reasonCode === "NOT_AUTHORIZED",
      JSON.stringify(row ?? denials.map((entry) => entry.targetId))
    );
  }
  // A denial audit is only useful if it says WHO. The no-role user is the most recent denier.
  check(
    "SYS-REP-015 denial audit attributes the acting user",
    denials.some((row) => row.actorName === noRole.username),
    JSON.stringify(denials.slice(0, 4).map((row) => ({ t: row.targetId, actor: row.actorName })))
  );
  // The pre-auth probes ran with no session at all; those must still be recorded, without inventing
  // an identity for them.
  check(
    "SYS-REP-015 pre-auth denial is recorded with no attributed actor",
    denials.some((row) => !row.actorName),
    JSON.stringify(denials.map((row) => row.actorName).slice(0, 8))
  );
  // The audit must not become a place where caller-supplied text lands. The no-role user passed
  // REPORT_ID to the denied `reports:get` / `reports:openFolder` calls; it must not be echoed back.
  check(
    "SYS-REP-015 denial audit records no caller-supplied argument",
    !JSON.stringify(denials).includes(REPORT_ID),
    REPORT_ID
  );

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
  // Always give the denied sub-tree back its inherited permissions, or the evidence folder becomes
  // undeletable. Reported as a check so a silent failure to restore cannot go unnoticed.
  try {
    restoreDirectoryRead(deniedDir);
    check("SYS-REP-012 the injected ACL denial was restored", !directoryIsUnreadable(deniedDir), deniedDir.replace(root, "<repo>"));
  } catch (error) {
    check("SYS-REP-012 the injected ACL denial was restored", false, error instanceof Error ? error.message : String(error));
  }
}

writeFileSync(join(evidenceRoot, "execution-results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf8");
const passed = results.filter((result) => result.pass).length;
const notRunCount = results.filter((result) => result.notRun).length;
const failed = results.length - passed - notRunCount;
console.log(`\nPopulated Reports GUI: ${passed} PASS / ${failed} FAIL${notRunCount > 0 ? ` / ${notRunCount} NOT RUN` : ""}`);
console.log(`Evidence: ${relative(root, evidenceRoot)}`);
process.exit(failed === 0 ? 0 : 1);
