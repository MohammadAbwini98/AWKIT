/**
 * End-to-end Oracle Data Source -> workflow -> current row -> real Chromium validation.
 *
 * This is intentionally database-free, but it does not stub AWKIT's integration boundaries:
 * it builds and spawns the real Java bridge in its explicit development mock mode, runs the
 * persisted read-only Oracle Data Source through OracleQueryService + DataSourceResolver, and
 * executes the persisted workflow/flow in real Chromium against the local Feature Test Lab.
 *
 * The live Oracle 19c rerun is a separate credential-gated acceptance gate. This verifier never
 * reads, invents, prints, or persists a database password and never represents mock mode as live DB.
 *
 * Run: `npm run verify:oracle-mock-ui-workflow`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import { DataSourceResolver } from "@src/data/DataSourceResolver";
import type { OracleDataSourceProfile } from "@src/data/DataSourceProfile";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import type { StorageDirs } from "@src/instances/InstanceManager";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "@src/oracle/OracleJdbcBridgeManager";
import { OracleQueryService } from "@src/oracle/OracleQueryService";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { workflowToScenarioProfile } from "@src/profiles/WorkflowProfile";
import { PreRunValidator, isRunBlocked } from "@src/reports/PreRunValidator";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import {
  materializeDataSourceRows,
  type InstanceExecutionContext,
  type ResolvedDataSource
} from "@src/runner/InstanceExecutionContext";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { PlaywrightRunner } from "@src/runner/PlaywrightRunner";
import type { FlowExecutionResult, ScenarioExecutionResult } from "@src/runner/RunnerResult";
import { MemoryRunnerLogger } from "@src/runner/RunnerResult";
import { StepExecutor } from "@src/runner/StepExecutor";
import { ValueResolver } from "@src/runner/ValueResolver";
import { validateFlowSet } from "@src/validation/FlowValidator";

type Status = "PASS" | "FAIL" | "BLOCKED" | "NOT RUN";

interface ValidationCase {
  id: string;
  title: string;
  status: Status;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  details: string;
  evidence: string[];
  error?: string;
}

type OracleRow = Record<string, unknown>;

const ROOT = process.cwd();
const RESOURCES_ROOT = join(ROOT, "resources");
const FLOW_PATH = join(RESOURCES_ROOT, "test-fixtures", "mock-site", "flows", "mock-oracle-form-flow.json");
const WORKFLOW_PATH = join(
  RESOURCES_ROOT,
  "test-fixtures",
  "mock-site",
  "workflows",
  "mock-oracle-form-workflow.json"
);
const DATA_SOURCE_PATH = join(
  RESOURCES_ROOT,
  "test-fixtures",
  "mock-site",
  "data-sources",
  "mock-oracle-form-cases.json"
);
const PORT = 4321;
// mock-site binds explicitly to 127.0.0.1; using localhost can resolve to ::1 first on Windows.
const BASE = `http://127.0.0.1:${PORT}`;
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const ARTIFACT_ROOT = resolve(
  process.env.AWKIT_ORACLE_MOCK_UI_ARTIFACT_ROOT ??
    join(ROOT, "test-artifacts", "oracle-mock-ui-workflow", runStamp)
);
const RESULT_PATH = join(ARTIFACT_ROOT, "execution-summary.json");
const RUNNER_LOG_PATH = join(ARTIFACT_ROOT, "runner-logs.json");
const BRIDGE_LOG_PATH = join(ARTIFACT_ROOT, "oracle-bridge.log");
const SERVICE_LOG_PATH = join(ARTIFACT_ROOT, "oracle-service.log");
const VALIDATION_PATH = join(ARTIFACT_ROOT, "pre-run-validation.json");

const cases: ValidationCase[] = [];
const runnerLogs: unknown[] = [];
const bridgeLogs: string[] = [];
const serviceLogs: string[] = [];
let server: ChildProcess | undefined;
let startedServer = false;
let serverLogs = "";
let bridge: OracleJdbcBridgeManager | undefined;
let directBrowser: Browser | undefined;
let fatalError: string | undefined;

const instanceConfig: InstanceConfig = {
  id: "oracle-mock-ui-workflow",
  name: "Oracle mock UI workflow",
  browser: "chromium",
  headless: true,
  isolationMode: "browserContext",
  timeoutMs: 30_000,
  viewport: { width: 1440, height: 1000 }
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function ensureDirs(paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => mkdir(path, { recursive: true })));
}

async function filesBelow(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await filesBelow(path)));
    else out.push(path);
  }
  return out;
}

async function runCase<T>(
  id: string,
  title: string,
  run: () => Promise<{ value: T; details: string; evidence?: string[] }>
): Promise<T> {
  const startedAt = new Date().toISOString();
  try {
    const result = await run();
    const endedAt = new Date().toISOString();
    cases.push({
      id,
      title,
      status: "PASS",
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      details: result.details,
      evidence: result.evidence ?? []
    });
    console.log(`PASS ${id} ${title}`);
    return result.value;
  } catch (error) {
    const endedAt = new Date().toISOString();
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    cases.push({
      id,
      title,
      status: "FAIL",
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      details: "The case did not meet its expected result.",
      evidence: [],
      error: message
    });
    console.error(`FAIL ${id} ${title}: ${message}`);
    throw error;
  }
}

function addLiveOracleBlock(): void {
  if (cases.some((item) => item.id === "ORA-LIVE-001")) return;
  const now = new Date().toISOString();
  cases.push({
    id: "ORA-LIVE-001",
    title: "Live Oracle 19c execution of the same persisted workflow",
    status: "BLOCKED",
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    details:
      "Not executed: requires an authorized operator to unlock SPECTER_READER, mint an ephemeral password, " +
      "supply AWKIT_ORACLE_LIVE_URL/AWKIT_ORACLE_LIVE_USER/AWKIT_ORACLE_LIVE_PASSWORD, run the gate, then rotate and lock the account.",
    evidence: [join(ROOT, "docs", "ai", "ORACLE_JDBC_VALIDATION_GATES.md")]
  });
}

async function serverReady(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/form`)).ok;
  } catch {
    return false;
  }
}

async function ensureMockSite(): Promise<void> {
  if (await serverReady()) {
    serverLogs = "Reused an already-running mock site.\n";
    return;
  }
  server = spawn(process.execPath, ["mock-site/server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  startedServer = true;
  server.stdout?.on("data", (chunk) => {
    serverLogs += chunk.toString("utf8");
  });
  server.stderr?.on("data", (chunk) => {
    serverLogs += chunk.toString("utf8");
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await serverReady()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Mock site did not become ready at ${BASE}.`);
}

function rowLabel(row: OracleRow): string {
  return `${String(row.CASE_ID).padStart(2, "0")}-${String(row.CASE_LABEL)}`;
}

async function makeContext(
  row: OracleRow,
  index: number,
  label: string,
  dataSource: ResolvedDataSource
): Promise<InstanceExecutionContext> {
  const root = join(ARTIFACT_ROOT, "runs", label);
  const paths = {
    downloads: join(root, "downloads"),
    screenshots: join(root, "screenshots"),
    logs: join(root, "logs"),
    reports: join(root, "reports"),
    sessions: join(root, "sessions"),
    traces: join(root, "traces")
  };
  await ensureDirs(Object.values(paths));
  return {
    executionId: `oracle-mock-ui-${runStamp}`,
    instanceId: `row-${String(index + 1).padStart(2, "0")}`,
    scenarioId: "mock-oracle-form-workflow",
    instanceOrderNumber: index + 1,
    totalInstances: 8,
    runtimeInputs: {},
    instanceInputs: {},
    currentRow: row,
    jsonData: {},
    workflowDataSource: dataSource,
    dataSources: { [dataSource.id]: dataSource },
    flowOutputs: {},
    secrets: {},
    paths
  };
}

function calendarDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  assert(!Number.isNaN(parsed.getTime()), `Fixture date is not parseable: ${text}`);
  return [
    String(parsed.getFullYear()).padStart(4, "0"),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0")
  ].join("-");
}

async function executeOnPage(
  page: Page,
  flow: FlowProfile,
  context: InstanceExecutionContext
): Promise<FlowExecutionResult> {
  const logger = new MemoryRunnerLogger();
  const stepExecutor = new StepExecutor(
    page,
    new LocatorFactory(page),
    new ValueResolver(context),
    context,
    undefined,
    logger
  );
  const result = await new FlowExecutor(stepExecutor, logger).executeFlow(flow, context);
  runnerLogs.push(...logger.entries);
  return result;
}

function inspectionFlow(source: FlowProfile, includeNavigation = true): FlowProfile {
  const removed = includeNavigation ? new Set<string>() : new Set(["start", "open-form", "wait-form"]);
  const nodes = source.nodes.filter((node) => !removed.has(node.id) && node.id !== "end-inspect");
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...source,
    id: `${source.id}-${includeNavigation ? "inspect" : "inspect-reused-page"}`,
    name: `${source.name} - inspect before submit`,
    nodes: [...nodes, { id: "end-inspect", type: "end", name: "End - inspect populated form" }],
    edges: [
      ...source.edges.filter(
        (edge) =>
          edge.source !== "capture-filled-form" &&
          nodeIds.has(edge.source) &&
          nodeIds.has(edge.target)
      ),
      {
        id: `oracle-form-inspect-end-${includeNavigation ? "fresh" : "reused"}`,
        source: "capture-filled-form",
        target: "end-inspect",
        type: "success"
      }
    ]
  };
}

async function assertFormValues(page: Page, row: OracleRow): Promise<void> {
  const expectedText: Record<string, unknown> = {
    firstName: row.FIRST_NAME,
    lastName: row.LAST_NAME,
    email: row.EMAIL,
    age: row.AGE,
    salary: row.SALARY,
    birthDate: calendarDate(row.BIRTH_DATE),
    country: row.COUNTRY,
    accountType: row.ACCOUNT_TYPE,
    description: row.DESCRIPTION
  };
  for (const [id, raw] of Object.entries(expectedText)) {
    const expected = raw === null || raw === undefined ? "" : String(raw);
    const actual = await page.locator(`#${id}`).inputValue();
    assert(actual === expected, `${rowLabel(row)}: #${id} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
    assert(actual !== "null", `${rowLabel(row)}: #${id} rendered the string "null".`);
  }

  const selectedSkills = await page.locator("#skills option:checked").evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value)
  );
  const expectedSkills = String(row.SKILLS ?? "").split(",").filter(Boolean);
  assert(
    JSON.stringify(selectedSkills) === JSON.stringify(expectedSkills),
    `${rowLabel(row)}: skills expected ${expectedSkills.join(",")}, received ${selectedSkills.join(",")}.`
  );

  const selectedGenderLocator = page.locator('input[name="gender"]:checked');
  const selectedGender =
    (await selectedGenderLocator.count()) === 0 ? null : await selectedGenderLocator.first().getAttribute("value");
  assert(
    selectedGender === (row.GENDER == null ? null : String(row.GENDER)),
    `${rowLabel(row)}: gender expected ${String(row.GENDER)}, received ${String(selectedGender)}.`
  );
  assert(
    (await page.locator("#interestAutomation").isChecked()) === (Number(row.INTEREST_AUTOMATION) === 1),
    `${rowLabel(row)}: automation checkbox mismatch.`
  );
  assert(
    (await page.locator("#interestTesting").isChecked()) === (Number(row.INTEREST_TESTING) === 1),
    `${rowLabel(row)}: testing checkbox mismatch.`
  );
  assert(
    (await page.locator("#acceptTerms").isChecked()) === (Number(row.ACCEPT_TERMS) === 1),
    `${rowLabel(row)}: terms checkbox mismatch.`
  );
  assert((await page.locator("#password").inputValue()) === "", `${rowLabel(row)}: unmapped password field was modified.`);
  assert((await page.locator("#attachment").inputValue()) === "", `${rowLabel(row)}: unmapped file field was modified.`);
}

async function executeInspection(
  browser: Browser,
  flow: FlowProfile,
  row: OracleRow,
  index: number,
  dataSource: ResolvedDataSource
): Promise<{ screenshot: string; steps: string[] }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const executionContext = await makeContext(row, index, `field-matrix-${rowLabel(row)}`, dataSource);
    const result = await executeOnPage(page, inspectionFlow(flow), executionContext);
    assert(result.status === "passed", result.error ?? `${rowLabel(row)} inspection flow failed.`);
    assert(
      result.steps.some((step) => step.stepId === "end-inspect"),
      `${rowLabel(row)} inspection flow did not reach End.`
    );
    await assertFormValues(page, row);
    const screenshot = result.steps.find((step) => step.stepId === "capture-filled-form")?.screenshotPath;
    assert(screenshot && existsSync(screenshot), `${rowLabel(row)} populated-form screenshot is missing.`);
    return { screenshot, steps: result.steps.map((step) => step.stepId) };
  } finally {
    await context.close();
  }
}

async function executeStaleCheckboxProbe(
  browser: Browser,
  flow: FlowProfile,
  row: OracleRow,
  index: number,
  dataSource: ResolvedDataSource
): Promise<string> {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/form`);
    await page.locator("#interestAutomation").check();
    await page.locator("#interestTesting").check();
    const executionContext = await makeContext(row, index, `stale-checkbox-${rowLabel(row)}`, dataSource);
    const result = await executeOnPage(page, inspectionFlow(flow, false), executionContext);
    assert(result.status === "passed", result.error ?? "Reused-page checkbox probe failed.");
    assert(
      result.steps.some((step) => step.stepId === "uncheck-automation") &&
        result.steps.some((step) => step.stepId === "uncheck-testing"),
      "The explicit zero-value uncheck branches were not executed."
    );
    await assertFormValues(page, row);
    const screenshot = result.steps.find((step) => step.stepId === "capture-filled-form")?.screenshotPath;
    assert(screenshot && existsSync(screenshot), "Reused-page checkbox screenshot is missing.");
    return screenshot;
  } finally {
    await context.close();
  }
}

async function executeBlockedProbe(
  browser: Browser,
  flow: FlowProfile,
  row: OracleRow,
  index: number,
  dataSource: ResolvedDataSource
): Promise<string> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const executionContext = await makeContext(row, index, `blocked-${rowLabel(row)}`, dataSource);
    const result = await executeOnPage(page, flow, executionContext);
    assert(result.status === "passed", result.error ?? "Expected-block workflow branch failed.");
    const stepIds = result.steps.map((step) => step.stepId);
    assert(stepIds.includes("assert-blocked-url") && stepIds.includes("end-blocked"), "Blocked branch did not reach its assertions and End.");
    assert(!stepIds.includes("assert-success-url"), "Blocked row incorrectly entered the success branch.");
    assert(new URL(page.url()).pathname === "/form", `Blocked row navigated to ${page.url()}.`);
    assert(!(await page.locator("#acceptTerms").isChecked()), "Terms-declined row ended checked.");
    const valueMissing = await page.locator("#acceptTerms").evaluate(
      (element) => (element as HTMLInputElement).validity.valueMissing
    );
    assert(valueMissing, "Native required-checkbox validation did not report valueMissing.");
    await assertFormValues(page, row);
    const screenshot = result.steps.find((step) => step.stepId === "capture-blocked")?.screenshotPath;
    assert(screenshot && existsSync(screenshot), "Native-validation blocked screenshot is missing.");
    return screenshot;
  } finally {
    await context.close();
  }
}

async function runWorkflowInstances(
  flow: FlowProfile,
  workflow: WorkflowProfile,
  rows: OracleRow[],
  dataSource: ResolvedDataSource
): Promise<{ results: ScenarioExecutionResult[]; maxObserved: number; screenshots: string[] }> {
  const scenario = workflowToScenarioProfile(workflow);
  const limit = workflow.execution.maxConcurrentInstances;
  assert(limit === 2, `Persisted workflow concurrency expected 2, received ${limit}.`);
  let cursor = 0;
  let active = 0;
  let maxObserved = 0;
  const results = new Array<ScenarioExecutionResult>(rows.length);

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= rows.length) return;
      active += 1;
      maxObserved = Math.max(maxObserved, active);
      try {
        const context = await makeContext(rows[index], index, `workflow-${rowLabel(rows[index])}`, dataSource);
        const runner = new PlaywrightRunner({
          flows: [flow],
          productionOffline: false,
          resourcesRoot: RESOURCES_ROOT
        });
        results[index] = await runner.executeScenario(scenario, context, instanceConfig);
        runnerLogs.push(...results[index].logs);
        await writeFile(
          join(ARTIFACT_ROOT, `workflow-row-${String(index + 1).padStart(2, "0")}.json`),
          JSON.stringify(results[index], null, 2),
          "utf8"
        );
      } finally {
        active -= 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, () => worker()));
  assert(maxObserved === 2, `Expected two concurrent instances, observed ${maxObserved}.`);
  assert(results.every((result) => result?.status === "passed"), "At least one row-driven workflow instance failed.");

  for (let index = 0; index < results.length; index += 1) {
    const row = rows[index];
    const stepIds = results[index].flows.flatMap((flowResult) => flowResult.steps.map((step) => step.stepId));
    const expectedEnd = row.EXPECTED_OUTCOME === "BLOCKED" ? "end-blocked" : "end-success";
    const wrongEnd = expectedEnd === "end-blocked" ? "end-success" : "end-blocked";
    assert(stepIds.includes(expectedEnd), `${rowLabel(row)} did not reach ${expectedEnd}.`);
    assert(!stepIds.includes(wrongEnd), `${rowLabel(row)} reached the wrong terminal branch.`);
  }

  const screenshots = results.flatMap((result) =>
    result.flows.flatMap((flowResult) =>
      flowResult.steps.flatMap((step) => (step.screenshotPath ? [step.screenshotPath] : []))
    )
  );
  assert(screenshots.length === 16, `Expected 16 workflow screenshots (two per row), received ${screenshots.length}.`);
  assert(screenshots.every((path) => existsSync(path)), "At least one workflow screenshot path does not exist.");
  return { results, maxObserved, screenshots };
}

async function runThroughExecutionEngine(
  flow: FlowProfile,
  workflow: WorkflowProfile,
  rows: OracleRow[],
  dataSource: ResolvedDataSource
): Promise<{ reports: string[]; screenshots: string[]; maxObserved: number }> {
  process.env.AWKIT_DURABLE_STORE = "0";
  process.env.AWKIT_PROCESS_SAMPLING = "0";
  const root = join(ARTIFACT_ROOT, "execution-engine");
  const dirs: StorageDirs = {
    root,
    downloads: join(root, "downloads"),
    screenshots: join(root, "screenshots"),
    logs: join(root, "logs"),
    reports: join(root, "reports")
  };
  await ensureDirs(Object.values(dirs));

  const scenario = workflowToScenarioProfile(workflow);
  const profile: ConcurrentRunProfile = {
    id: "oracle-mock-ui-engine",
    scenarioId: scenario.id,
    runMode: "dataDrivenConcurrent",
    maxConcurrentInstances: workflow.execution.maxConcurrentInstances,
    browserWindowMode: "headless",
    instanceTemplate: {
      browser: "chromium",
      headless: true,
      isolationMode: "browserContext",
      timeoutMs: 30_000,
      viewport: { width: 1440, height: 1000 }
    },
    resourceControls: {
      maxBrowserContextsPerProcess: 1,
      delayBetweenInstanceStartsMs: 0
    },
    failurePolicy: {
      stopAllOnCriticalFailure: false,
      continueOtherInstancesOnFailure: true,
      retryFailedInstance: false,
      retryCount: 0
    }
  };

  const engine = new ExecutionEngine();
  engine.configureConcurrency({
    maxBrowsersPerHost: 2,
    maxActiveFlows: 2,
    useSharedBrowserPool: false,
    workloadWeights: false
  });
  const executionId = `oracle-engine-${runStamp}`;
  let maxObserved = 0;
  try {
    await engine.startRun(
      executionId,
      profile,
      rows,
      dirs,
      {},
      scenario,
      [flow],
      dataSource,
      { [dataSource.id]: dataSource }
    );
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const instances = engine.getInstances().filter((instance) => instance.executionId === executionId);
      maxObserved = Math.max(
        maxObserved,
        instances.filter((instance) => instance.status === "starting" || instance.status === "running").length
      );
      if (
        instances.length === rows.length &&
        instances.every((instance) => ["completed", "failed", "cancelled"].includes(instance.status))
      ) {
        assert(
          instances.every((instance) => instance.status === "completed"),
          `ExecutionEngine terminal states: ${instances.map((instance) => `${instance.instanceOrderNumber}:${instance.status}`).join(", ")}.`
        );
        break;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }

    const settled = engine.getInstances().filter((instance) => instance.executionId === executionId);
    assert(settled.length === rows.length, `ExecutionEngine created ${settled.length}/${rows.length} instances.`);
    assert(settled.every((instance) => instance.status === "completed"), "ExecutionEngine did not settle every row as completed.");
    assert(maxObserved === 2, `ExecutionEngine expected two active instances, observed ${maxObserved}.`);

    let reports: string[] = [];
    const reportDeadline = Date.now() + 10_000;
    while (Date.now() < reportDeadline) {
      reports = (await filesBelow(dirs.reports)).filter((path) => path.endsWith(".json"));
      if (reports.length > 0) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    const report = reports.length
      ? (JSON.parse(await readFile(reports[0], "utf8")) as {
          status?: string;
          passedFlows?: number;
          failedFlows?: number;
          instances?: unknown[];
        })
      : undefined;
    const logs = (await filesBelow(dirs.logs)).filter((path) => path.endsWith(".jsonl"));
    const screenshots = (await filesBelow(dirs.screenshots)).filter((path) => path.endsWith(".png"));
    assert(reports.length === 1, `ExecutionEngine wrote ${reports.length} run-level reports.`);
    assert(
      report?.status === "passed" &&
        report.passedFlows === rows.length &&
        report.failedFlows === 0 &&
        report.instances?.length === rows.length,
      "ExecutionEngine run-level report does not record 8 passed instances."
    );
    assert(logs.length === rows.length, `ExecutionEngine wrote ${logs.length}/${rows.length} JSONL logs.`);
    assert(screenshots.length === 16, `ExecutionEngine expected 16 screenshots, found ${screenshots.length}.`);
    return { reports: [...reports, ...logs], screenshots, maxObserved };
  } finally {
    engine.stopAll();
  }
}

async function writeSummary(): Promise<void> {
  addLiveOracleBlock();
  const totals = {
    pass: cases.filter((item) => item.status === "PASS").length,
    fail: cases.filter((item) => item.status === "FAIL").length,
    blocked: cases.filter((item) => item.status === "BLOCKED").length,
    notRun: cases.filter((item) => item.status === "NOT RUN").length
  };
  await ensureDirs([ARTIFACT_ROOT]);
  await Promise.all([
    writeFile(RUNNER_LOG_PATH, JSON.stringify(runnerLogs, null, 2), "utf8"),
    writeFile(BRIDGE_LOG_PATH, `${bridgeLogs.join("\n")}${bridgeLogs.length ? "\n" : ""}`, "utf8"),
    writeFile(SERVICE_LOG_PATH, `${serviceLogs.join("\n")}${serviceLogs.length ? "\n" : ""}`, "utf8"),
    writeFile(join(ARTIFACT_ROOT, "mock-site.log"), serverLogs, "utf8")
  ]);
  await writeFile(
    RESULT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: "database-free-real-bridge-real-browser",
        liveOracleExecuted: false,
        readiness:
          totals.fail === 0
            ? "DB-FREE ORACLE-TO-UI PATH READY; LIVE ORACLE ACCEPTANCE REQUIRES MANUAL CREDENTIAL HANDOFF"
            : "NOT READY",
        artifactRoot: ARTIFACT_ROOT,
        fixtures: {
          dataSource: DATA_SOURCE_PATH,
          flow: FLOW_PATH,
          workflow: WORKFLOW_PATH
        },
        totals,
        cases,
        fatalError
      },
      null,
      2
    ),
    "utf8"
  );
}

async function main(): Promise<void> {
  await ensureDirs([ARTIFACT_ROOT]);
  await ensureMockSite();

  const { flow, workflow, dataSourceProfile } = await runCase(
    "ORA-WF-001",
    "Persisted Oracle Data Source, flow, workflow, and production pre-run gate",
    async () => {
      const loadedFlow = await readJson<FlowProfile>(FLOW_PATH);
      const loadedWorkflow = await readJson<WorkflowProfile>(WORKFLOW_PATH);
      const loadedDataSource = await readJson<OracleDataSourceProfile>(DATA_SOURCE_PATH);
      assert(loadedDataSource.type === "oracle" && loadedDataSource.mode === "runtime", "Data Source is not Oracle runtime mode.");
      assert(loadedDataSource.query.binds.length === 0, "Fixture query unexpectedly contains binds.");
      assert(!/password|secret/i.test(JSON.stringify(loadedDataSource)), "Persisted Data Source contains a secret-shaped field.");
      const flowReport = validateFlowSet([loadedFlow]);
      const scenario = workflowToScenarioProfile(loadedWorkflow);
      const preRunIssues = new PreRunValidator().validate({
        scenario,
        flows: [loadedFlow],
        productionOffline: false,
        bundledBrowserExists: true,
        runtimeFoldersWritable: true
      });
      const validationEvidence = {
        flowIssues: flowReport.reports.flatMap((report) => report.issues),
        setIssues: flowReport.issues,
        preRunIssues,
        blocked: isRunBlocked(preRunIssues)
      };
      await writeFile(VALIDATION_PATH, JSON.stringify(validationEvidence, null, 2), "utf8");
      assert(validationEvidence.flowIssues.length === 0, "Flow definition validation reported issues.");
      assert(validationEvidence.setIssues.length === 0, "Flow-set validation reported issues.");
      assert(!validationEvidence.blocked, "Production pre-run validation blocked the persisted workflow.");
      return {
        value: { flow: loadedFlow, workflow: loadedWorkflow, dataSourceProfile: loadedDataSource },
        details: "All three persisted fixtures loaded; shared flow validation and the production pre-run gate reported zero issues.",
        evidence: [FLOW_PATH, WORKFLOW_PATH, DATA_SOURCE_PATH, VALIDATION_PATH]
      };
    }
  );

  const build = buildOracleBridge({ quiet: true });
  const launchSpec: BridgeLaunchSpec = {
    javaPath: build.jdk.java,
    jarPath: build.jarPath,
    env: { AWKIT_ORACLE_BRIDGE_MOCK: "1" }
  };
  bridge = new OracleJdbcBridgeManager({
    resolveLaunchSpec: () => launchSpec,
    handshakeTimeoutMs: 20_000,
    onStderr: (line) => bridgeLogs.push(line),
    logger: (level, message) => bridgeLogs.push(`${level.toUpperCase()} ${message}`)
  });

  let executeQueryRpcs = 0;
  const rpcCount = (): number => executeQueryRpcs;
  const originalCall = bridge.call.bind(bridge);
  (bridge as unknown as { call: typeof bridge.call }).call = ((op, params, options) => {
    if (op === "executeQuery") executeQueryRpcs += 1;
    return originalCall(op, params, options);
  }) as typeof bridge.call;

  const queryService = new OracleQueryService({
    bridge,
    resolveDescriptor: async () => ({
      descriptor: { poolKey: "database-free-mock-form-fixture" },
      redactedUrl: "mock://database-free-form-fixture"
    }),
    log: (level, message) => serviceLogs.push(`${level.toUpperCase()} ${message}`),
    maxConcurrency: 2
  });
  const resolver = new DataSourceResolver({
    readJsonRows: async () => {
      throw new Error("The Oracle fixture must not fall back to JSON rows.");
    },
    runOracleRuntimeQuery: async (profile) => {
      const result = await queryService.execute(
        {
          connectionProfileId: profile.connectionProfileId,
          sql: profile.query.sql,
          binds: [],
          timeoutMs: profile.query.timeoutMs,
          maxRows: profile.query.maxRows,
          fetchSize: profile.query.fetchSize
        },
        { source: "runtime-query" }
      );
      return result.rows;
    }
  });

  const { resolvedDataSource, rows } = await runCase(
    "ORA-WF-002",
    "Real Java bridge materialization and per-workflow single-flight cache",
    async () => {
      const resolved = resolver.resolve(dataSourceProfile);
      assert(rpcCount() === 0 && !bridge?.isRunning(), "Oracle runtime was not lazy before first consumption.");
      const materialized = await Promise.all([
        materializeDataSourceRows(resolved),
        materializeDataSourceRows(resolved),
        materializeDataSourceRows(resolved)
      ]);
      assert(rpcCount() === 1, `Three concurrent consumers dispatched ${rpcCount()} executeQuery RPCs.`);
      assert(materialized.every((value) => value === materialized[0]), "Concurrent consumers did not share one result array.");
      const materializedRows = materialized[0] as OracleRow[];
      assert(materializedRows.length === 8, `Expected 8 rows, received ${materializedRows.length}.`);
      assert(materializedRows[0].CASE_LABEL === "happy-path-all-fields", "Bridge did not return the form fixture.");
      assert(bridge?.helloInfo()?.executionMode === "mock", "Evidence did not identify the bridge as mock mode.");
      assert(queryService.getMetrics().successes === 1, "OracleQueryService did not record one successful query.");
      return {
        value: { resolvedDataSource: resolved, rows: materializedRows },
        details:
          "Three concurrent consumers shared one real executeQuery RPC; the explicit mock bridge returned all 8 Oracle-shaped rows.",
        evidence: [build.jarPath, BRIDGE_LOG_PATH, SERVICE_LOG_PATH]
      };
    }
  );

  directBrowser = await chromium.launch({ headless: true });
  const inspectionEvidence = await runCase(
    "ORA-WF-003",
    "All Oracle columns map into compatible live form controls",
    async () => {
      const evidence: string[] = [];
      const routes: Record<string, string[]> = {};
      for (let index = 0; index < rows.length; index += 1) {
        const result = await executeInspection(directBrowser!, flow, rows[index], index, resolvedDataSource);
        evidence.push(result.screenshot);
        routes[rowLabel(rows[index])] = result.steps;
      }
      const routePath = join(ARTIFACT_ROOT, "field-mapping-routes.json");
      await writeFile(routePath, JSON.stringify(routes, null, 2), "utf8");
      evidence.push(routePath);
      return {
        value: evidence,
        details:
          "8/8 rows matched text, nullable text, integer, decimal, local calendar date, selects, multi-select, radio, checkboxes, textarea, and untouched controls.",
        evidence
      };
    }
  );

  await runCase("ORA-WF-004", "Zero-valued checkboxes clear stale state on a reused page", async () => {
    const index = rows.findIndex((row) => row.CASE_LABEL === "interests-unchecked");
    assert(index >= 0, "The interests-unchecked row is missing.");
    const screenshot = await executeStaleCheckboxProbe(directBrowser!, flow, rows[index], index, resolvedDataSource);
    return {
      value: screenshot,
      details: "Both interest controls began checked; the row's two zero values executed explicit uncheck branches and left both clear.",
      evidence: [screenshot]
    };
  });

  const workflowResult = await runCase(
    "ORA-WF-005",
    "Eight isolated row-driven workflow instances with a concurrency limit of two",
    async () => {
      const result = await runWorkflowInstances(flow, workflow, rows, resolvedDataSource);
      return {
        value: result,
        details:
          "8/8 scenario instances passed; 7 reached the success terminal, 1 reached the expected-block terminal, and observed concurrency was exactly 2.",
        evidence: [
          ...result.screenshots,
          ...rows.map((_, index) => join(ARTIFACT_ROOT, `workflow-row-${String(index + 1).padStart(2, "0")}.json`))
        ]
      };
    }
  );

  await runCase(
    "ORA-ENG-001",
    "Production ExecutionEngine carries each scheduled current row into the workflow",
    async () => {
      const result = await runThroughExecutionEngine(flow, workflow, rows, resolvedDataSource);
      return {
        value: result,
        details:
          "The complete production dispatch path created 8 data-driven instances, never exceeded 2 active runs, and every instance completed with its row-specific branch and artifacts.",
        evidence: [...result.reports, ...result.screenshots]
      };
    }
  );

  await runCase("ORA-WF-006", "Terms-declined row is stopped by native required-field validation", async () => {
    const index = rows.findIndex((row) => row.EXPECTED_OUTCOME === "BLOCKED");
    assert(index >= 0, "The expected BLOCKED row is missing.");
    const screenshot = await executeBlockedProbe(directBrowser!, flow, rows[index], index, resolvedDataSource);
    return {
      value: screenshot,
      details:
        "The terms checkbox remained unchecked and validity.valueMissing=true; the page stayed on /form and the persisted blocked branch reached End.",
      evidence: [screenshot]
    };
  });

  assert(rpcCount() === 1, `The complete workflow campaign dispatched ${rpcCount()} Oracle queries instead of one cached query.`);
  assert(workflowResult.results.length === 8 && inspectionEvidence.length === 9, "Campaign evidence counts are incomplete.");
}

main()
  .catch((error) => {
    fatalError = error instanceof Error ? error.stack ?? error.message : String(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await directBrowser?.close().catch(() => undefined);
    await bridge?.dispose().catch(() => undefined);
    if (startedServer && server && !server.killed) server.kill();
    await writeSummary().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
    console.log(`Execution summary: ${RESULT_PATH}`);
    console.log(`Runner logs: ${RUNNER_LOG_PATH}`);
  });
