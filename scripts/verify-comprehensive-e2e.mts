/**
 * Persisted comprehensive end-to-end validation against the local AWKIT mock site.
 *
 * This verifier complements the focused subsystem verifiers by loading the same JSON
 * flow/workflow fixtures that users can inspect in the designers, executing their safe
 * browser paths, and emitting one machine-readable evidence ledger.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ManualHandoffController } from "@src/runner/ManualHandoffController";
import { PlaywrightRunner } from "@src/runner/PlaywrightRunner";
import type { FlowExecutionResult } from "@src/runner/RunnerResult";
import { MemoryRunnerLogger } from "@src/runner/RunnerResult";
import type { StructuredLog } from "@src/reports/StructuredLog";
import { StepExecutor } from "@src/runner/StepExecutor";
import type { FlowEdgeType, FlowProfile, StepType, ValueSourceType } from "@src/profiles/FlowProfile";
import { connectorKind } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import { workflowToScenarioProfile } from "@src/profiles/WorkflowProfile";
import type { InstanceExecutionContext, ResolvedDataSource } from "@src/runner/InstanceExecutionContext";
import { ValueResolver } from "@src/runner/ValueResolver";

type CaseStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT RUN" | "N/A";

interface CaseResult {
  id: string;
  title: string;
  status: CaseStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  evidence: string[];
  details?: string;
  error?: string;
}

const ROOT = process.cwd();
const RESOURCES_ROOT = join(ROOT, "resources");
const FLOW_ROOT = join(RESOURCES_ROOT, "test-fixtures", "mock-site", "flows");
const WORKFLOW_ROOT = join(RESOURCES_ROOT, "test-fixtures", "mock-site", "workflows");
const DATA_SOURCE_ROOT = join(RESOURCES_ROOT, "test-fixtures", "mock-site", "data-sources");
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const ARTIFACT_ROOT = resolve(process.env.AWKIT_E2E_ARTIFACT_ROOT || join(ROOT, "test-artifacts", "comprehensive-e2e", runStamp));

const expectedStepTypes: StepType[] = [
  "start",
  "goto",
  "click",
  "fill",
  "select",
  "check",
  "uncheck",
  "radio",
  "scroll",
  "wait",
  "uploadFile",
  "downloadFile",
  "readText",
  "assertText",
  "assertVisible",
  "screenshot",
  "manualHandoff",
  "condition",
  "loop",
  "runFlow",
  "routeChange",
  "saveSession",
  "protectedLoginHandoff",
  "autoSecureLogin",
  "reuseSession",
  "switchToPopup",
  "closePopup",
  "switchToMainPage",
  "oracle",
  "end"
];

const expectedEdgeTypes: FlowEdgeType[] = [
  "success",
  "failure",
  "always",
  "conditional",
  "outcome",
  "manualApproval",
  "loop",
  "loopBack",
  "parallel"
];

const expectedValueSourceTypes: ValueSourceType[] = [
  "static",
  "dynamic",
  "json",
  "runtimeInput",
  "env",
  "flowOutput",
  "generated",
  "currentRow",
  "instanceVariable",
  "secret"
];

const comprehensiveFlowFiles = [
  "mock-comprehensive-core-flow.json",
  "mock-comprehensive-data-consumer-flow.json",
  "mock-comprehensive-io-flow.json",
  "mock-comprehensive-popup-flow.json",
  "mock-comprehensive-manual-session-flow.json",
  "mock-comprehensive-oracle-flow.json",
  "mock-comprehensive-connectors-flow.json"
];

const caseResults: CaseResult[] = [];
const allLogs: StructuredLog[] = [];
let server: ChildProcess | undefined;
let startedServer = false;

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function ensureDirectories(paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => mkdir(path, { recursive: true })));
}

async function makeContext(label: string): Promise<InstanceExecutionContext> {
  const root = join(ARTIFACT_ROOT, "runs", label);
  const paths = {
    downloads: join(root, "downloads"),
    screenshots: join(root, "screenshots"),
    logs: join(root, "logs"),
    reports: join(root, "reports"),
    sessions: join(root, "sessions"),
    traces: join(root, "traces")
  };
  await ensureDirectories(Object.values(paths));
  const users = await readJson<Record<string, unknown>[]>(join(DATA_SOURCE_ROOT, "mock-users.json"));
  const dataSource: ResolvedDataSource = {
    id: "mock-users",
    name: "Mock users",
    file: join(DATA_SOURCE_ROOT, "mock-users.json"),
    rootArrayPath: "$",
    rows: users
  };
  return {
    executionId: `comprehensive-${label}-${Date.now()}`,
    instanceId: `${label}-instance`,
    scenarioId: `${label}-scenario`,
    flowId: label,
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {
      firstName: "Runtime Alice",
      connectorItem: "seed"
    },
    instanceInputs: {
      salary: 2450.75
    },
    currentRow: users[0],
    jsonData: {},
    workflowDataSource: dataSource,
    dataSources: {
      "mock-users": dataSource
    },
    flowOutputs: {},
    secrets: {
      "mock-e2e-form-value": "local-only-synthetic-secret"
    },
    paths
  };
}

const instanceConfig: InstanceConfig = {
  id: "comprehensive-e2e",
  name: "Comprehensive E2E",
  browser: "chromium",
  headless: true,
  isolationMode: "browserContext",
  timeoutMs: 30_000,
  viewport: { width: 1440, height: 900 }
};

async function withCase(id: string, title: string, run: () => Promise<{ evidence?: string[]; details?: string }>): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    const result = await run();
    const endedAt = new Date().toISOString();
    caseResults.push({
      id,
      title,
      status: "PASS",
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      evidence: result.evidence ?? [],
      details: result.details
    });
    console.log(`✓ ${id} ${title}`);
  } catch (error) {
    const endedAt = new Date().toISOString();
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    caseResults.push({
      id,
      title,
      status: "FAIL",
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      evidence: [],
      error: message
    });
    console.error(`✗ ${id} ${title}: ${message}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function serverIsReady(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/runner-lab`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureMockServer(): Promise<void> {
  if (await serverIsReady()) return;
  server = spawn(process.execPath, ["mock-site/server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore",
    windowsHide: true
  });
  startedServer = true;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await serverIsReady()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Mock site did not become ready at ${BASE}.`);
}

async function executePersistedFlow(
  browser: Browser,
  flow: FlowProfile,
  context: InstanceExecutionContext,
  page?: Page
): Promise<{ result: FlowExecutionResult; page: Page }> {
  const activePage = page ?? (await browser.newPage());
  const logger = new MemoryRunnerLogger();
  const executor = new StepExecutor(activePage, new LocatorFactory(activePage), new ValueResolver(context), context, undefined, logger);
  const result = await new FlowExecutor(executor, logger).executeFlow(flow, context);
  allLogs.push(...logger.entries);
  return { result, page: activePage };
}

function executedStepCount(result: FlowExecutionResult, stepId: string): number {
  return result.steps.filter((step) => step.stepId === stepId).length;
}

async function validateInventory(flows: FlowProfile[]): Promise<{ evidence: string[]; details: string }> {
  const stepTypes = new Set<StepType>();
  const edgeTypes = new Set<FlowEdgeType>();
  const valueSourceTypes = new Set<ValueSourceType>();
  const connectorKinds = new Set<string>();
  for (const flow of flows) {
    for (const node of flow.nodes) {
      stepTypes.add(node.type);
      if (node.valueSource) valueSourceTypes.add(node.valueSource.type);
      if (node.loop?.valueSource) valueSourceTypes.add(node.loop.valueSource.type);
    }
    for (const edge of flow.edges) {
      edgeTypes.add(edge.type);
      connectorKinds.add(connectorKind(edge));
    }
  }
  const missingSteps = expectedStepTypes.filter((type) => !stepTypes.has(type));
  const missingEdges = expectedEdgeTypes.filter((type) => !edgeTypes.has(type));
  const missingSources = expectedValueSourceTypes.filter((type) => !valueSourceTypes.has(type));
  const missingKinds = ["normal", "conditional", "parallel", "loop"].filter((kind) => !connectorKinds.has(kind));
  assert(!missingSteps.length, `Missing persisted step types: ${missingSteps.join(", ")}`);
  assert(!missingEdges.length, `Missing persisted edge types: ${missingEdges.join(", ")}`);
  assert(!missingSources.length, `Missing persisted value-source types: ${missingSources.join(", ")}`);
  assert(!missingKinds.length, `Missing persisted connector kinds: ${missingKinds.join(", ")}`);
  const path = join(ARTIFACT_ROOT, "inventory.json");
  await writeFile(
    path,
    JSON.stringify(
      {
        fixtureFiles: comprehensiveFlowFiles,
        stepTypes: [...stepTypes].sort(),
        edgeTypes: [...edgeTypes].sort(),
        connectorKinds: [...connectorKinds].sort(),
        valueSourceTypes: [...valueSourceTypes].sort()
      },
      null,
      2
    ),
    "utf8"
  );
  return {
    evidence: [path],
    details: `${stepTypes.size} step types; ${edgeTypes.size} edge types; ${connectorKinds.size} connector kinds; ${valueSourceTypes.size} value-source types.`
  };
}

async function runCoreAndCrossFlow(browser: Browser, flows: Map<string, FlowProfile>): Promise<{ evidence: string[]; details: string }> {
  process.env.AWKIT_E2E_DESCRIPTION = "Environment-backed comprehensive run";
  const context = await makeContext("core-cross-flow");
  const core = flows.get("mock-comprehensive-core-flow");
  const consumer = flows.get("mock-comprehensive-data-consumer-flow");
  assert(core && consumer, "Core or consumer fixture is missing.");
  const coreRun = await executePersistedFlow(browser, core, context);
  assert(coreRun.result.status === "passed", coreRun.result.error ?? "Core flow failed.");
  assert(coreRun.result.outputs["mock-comprehensive-core-flow.headingText"] === "Customer Form", "Core flow did not publish headingText.");
  Object.assign(context.flowOutputs, coreRun.result.outputs);
  const consumerRun = await executePersistedFlow(browser, consumer, context, coreRun.page);
  assert(consumerRun.result.status === "passed", consumerRun.result.error ?? "Consumer flow failed.");
  assert(
    consumerRun.result.outputs["mock-comprehensive-data-consumer-flow.consumedHeading"] === "Customer Form",
    "Consumer did not publish the prior flow output."
  );
  const screenshot = coreRun.result.steps.find((step) => step.stepId === "screenshot-form")?.screenshotPath;
  assert(screenshot && existsSync(screenshot), "Core full-page screenshot was not written.");
  const firstName = await coreRun.page.inputValue("#firstName");
  assert(firstName === "Customer Form", `Cross-flow value was not visible in the DOM (received ${firstName}).`);
  await coreRun.page.close();
  return {
    evidence: [screenshot],
    details: "Static, runtime, row, JSON, environment, generated, secret, instance, dynamic, and cross-flow values reached the live DOM."
  };
}

async function runIoFlow(browser: Browser, flows: Map<string, FlowProfile>): Promise<{ evidence: string[]; details: string }> {
  const flow = flows.get("mock-comprehensive-io-flow");
  assert(flow, "I/O fixture is missing.");
  const context = await makeContext("io-flow");
  const { result, page } = await executePersistedFlow(browser, flow, context);
  assert(result.status === "passed", result.error ?? "I/O flow failed.");
  const download = result.steps.find((step) => step.stepId === "download-csv")?.downloadedFilePath;
  assert(download && existsSync(download), "Downloaded CSV was not written.");
  const csv = await readFile(download, "utf8");
  assert(csv.includes("lab-alpha") && csv.includes("lab-charlie"), "Downloaded CSV content was not the deterministic mock payload.");
  assert(result.outputs["mock-comprehensive-io-flow.uploadResult"], "Upload result was not mapped into flow outputs.");
  await page.close();
  return {
    evidence: [download],
    details: "Multipart upload, pre-armed response wait, UI wait, output mapping, download event, filename confinement, and file content passed."
  };
}

async function runConnectorFlow(browser: Browser, flows: Map<string, FlowProfile>): Promise<{ evidence: string[]; details: string }> {
  const flow = flows.get("mock-comprehensive-connectors-flow");
  assert(flow, "Connector fixture is missing.");
  const context = await makeContext("connector-flow");
  const { result, page } = await executePersistedFlow(browser, flow, context);
  assert(result.status === "passed", result.error ?? "Connector flow failed.");
  assert(executedStepCount(result, "parallel-a") === 1, "Parallel branch A did not run exactly once.");
  assert(executedStepCount(result, "parallel-b") === 1, "Parallel branch B did not run exactly once.");
  assert(executedStepCount(result, "loop-fill") === 2, "Structured count loop did not run twice.");
  assert(executedStepCount(result, "loopback-a") === 2, "Loop-back did not run its target twice.");
  assert(executedStepCount(result, "failure-recovery") === 0, "Positive connector path unexpectedly entered recovery.");
  await page.close();
  return {
    evidence: [join(FLOW_ROOT, "mock-comprehensive-connectors-flow.json")],
    details: "Structured conditional priority, shared-page parallel fan-out, count loop injection, outcome routing, and bounded loop-back passed."
  };
}

async function runFlowManualApprovalConnector(browser: Browser): Promise<{ evidence: string[]; details: string }> {
  const flow: FlowProfile = {
    id: "comprehensive-manual-approval-edge",
    name: "Manual approval edge",
    version: 1,
    nodes: [
      { id: "start", type: "start", name: "Start" },
      { id: "approval", type: "manualHandoff", name: "Approve", message: "Approve the synthetic local continuation." },
      { id: "end", type: "end", name: "End" }
    ],
    edges: [
      { id: "approval-e1", source: "start", target: "approval", type: "success" },
      { id: "approval-e2", source: "approval", target: "end", type: "manualApproval" }
    ]
  };
  const context = await makeContext("manual-approval-edge");
  const controller = new ManualHandoffController();
  const page = await browser.newPage();
  const logger = new MemoryRunnerLogger();
  const stepExecutor = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(context), context, controller, logger);
  const execution = new FlowExecutor(stepExecutor, logger).executeFlow(flow, context);
  await Promise.all([execution, autoResumeHandoffs(controller, context, 1)]);
  const result = await execution;
  allLogs.push(...logger.entries);
  await page.close();
  assert(result.status === "passed", result.error ?? "Manual approval flow failed.");
  assert(
    executedStepCount(result, "end") === 1,
    "The flow reported passed but silently stopped before End: FlowExecutor does not route a manualApproval edge."
  );
  return {
    evidence: [join(FLOW_ROOT, "mock-comprehensive-connectors-flow.json")],
    details: "The approved handoff continued through the manualApproval connector to End."
  };
}

async function runPopupFlow(flows: Map<string, FlowProfile>): Promise<{ evidence: string[]; details: string }> {
  const flow = flows.get("mock-comprehensive-popup-flow");
  assert(flow, "Popup fixture is missing.");
  const context = await makeContext("popup-flow");
  const scenario: ScenarioProfile = {
    id: "comprehensive-popup-scenario",
    name: "Comprehensive popup scenario",
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: [{ order: 1, flowId: flow.id, required: true }],
    links: [],
    failurePolicy: {
      stopOnRequiredFlowFailure: true,
      continueOnOptionalFlowFailure: true,
      takeScreenshotOnFailure: true
    }
  };
  const runner = new PlaywrightRunner({ flows: [flow], productionOffline: false, resourcesRoot: RESOURCES_ROOT });
  const result = await runner.executeScenario(scenario, context, instanceConfig);
  allLogs.push(...result.logs);
  assert(result.status === "passed", result.error ?? "Popup scenario failed.");
  const stepIds = result.flows[0]?.steps.map((step) => step.stepId) ?? [];
  assert(stepIds.includes("open-terms") && stepIds.includes("switch-timer-popup") && stepIds.includes("close-timer-popup"), "Popup lifecycle steps did not all execute.");
  return {
    evidence: [join(FLOW_ROOT, "mock-comprehensive-popup-flow.json")],
    details: "Fast opener popup capture, timer popup discovery, alias targeting, main-page restoration, popup action, and close behavior passed."
  };
}

async function runWorkflow(flows: FlowProfile[]): Promise<{ evidence: string[]; details: string }> {
  const workflowPath = join(WORKFLOW_ROOT, "mock-comprehensive-workflow.json");
  const workflow = await readJson<WorkflowProfile>(workflowPath);
  const scenario = workflowToScenarioProfile(workflow);
  scenario.failurePolicy = {
    stopOnRequiredFlowFailure: true,
    continueOnOptionalFlowFailure: true,
    takeScreenshotOnFailure: true
  };
  const context = await makeContext("workflow");
  process.env.AWKIT_E2E_DESCRIPTION = "Environment-backed workflow run";
  const requiredIds = new Set(workflow.nodes.filter((node) => node.type === "flowRef").map((node) => node.flowId));
  const workflowFlows = flows.filter((flow) => requiredIds.has(flow.id));
  const runner = new PlaywrightRunner({ flows: workflowFlows, productionOffline: false, resourcesRoot: RESOURCES_ROOT });
  const result = await runner.executeScenario(scenario, context, instanceConfig);
  allLogs.push(...result.logs);
  assert(result.status === "passed", result.error ?? "Persisted workflow failed.");
  const ran = result.flows.map((flow) => flow.flowId);
  assert(ran.length === 4, `Expected four workflow flows, received ${ran.join(", ")}.`);
  assert(ran[0] === "mock-comprehensive-core-flow" && ran[3] === "mock-comprehensive-popup-flow", `Unexpected workflow route: ${ran.join(" -> ")}`);
  const resultPath = join(ARTIFACT_ROOT, "workflow-result.json");
  await writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
  return {
    evidence: [workflowPath, resultPath],
    details: `Workflow passed: ${ran.join(" → ")}.`
  };
}

async function autoResumeHandoffs(
  controller: ManualHandoffController,
  context: InstanceExecutionContext,
  expectedCount: number
): Promise<void> {
  let resumed = 0;
  const deadline = Date.now() + 15_000;
  while (resumed < expectedCount && Date.now() < deadline) {
    if (controller.getPending(context.executionId, context.instanceId)) {
      controller.resume(context.executionId, context.instanceId);
      resumed += 1;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  assert(resumed === expectedCount, `Expected ${expectedCount} local manual handoffs, resumed ${resumed}.`);
}

async function runManualSessionSubset(flows: Map<string, FlowProfile>): Promise<{ evidence: string[]; details: string }> {
  const source = flows.get("mock-comprehensive-manual-session-flow");
  assert(source, "Manual/session fixture is missing.");
  const safeNodeIds = new Set(["start", "open-session-lab", "manual-handoff", "protected-handoff", "save-session", "end"]);
  const safeFlow: FlowProfile = {
    ...source,
    id: "mock-comprehensive-manual-session-safe-subset",
    nodes: source.nodes.filter((node) => safeNodeIds.has(node.id)),
    edges: [
      ...source.edges.filter((edge) => safeNodeIds.has(edge.source) && safeNodeIds.has(edge.target) && edge.source !== "save-session"),
      { id: "session-safe-end", source: "save-session", target: "end", type: "success" }
    ]
  };
  const context = await makeContext("manual-session");
  const controller = new ManualHandoffController();
  const scenario: ScenarioProfile = {
    id: "manual-session-safe",
    name: "Manual and session safe subset",
    executionMode: "manual",
    maxParallelFlows: 1,
    flows: [{ order: 1, flowId: safeFlow.id, required: true }],
    links: [],
    failurePolicy: {
      stopOnRequiredFlowFailure: true,
      continueOnOptionalFlowFailure: false,
      takeScreenshotOnFailure: true
    }
  };
  const runner = new PlaywrightRunner({
    flows: [safeFlow],
    productionOffline: false,
    resourcesRoot: RESOURCES_ROOT,
    manualHandoffController: controller
  });
  const execution = runner.executeScenario(scenario, context, instanceConfig);
  await Promise.all([execution, autoResumeHandoffs(controller, context, 2)]);
  const result = await execution;
  allLogs.push(...result.logs);
  assert(result.status === "passed", result.error ?? "Manual/session safe subset failed.");
  const sessionStep = result.flows[0]?.steps.find((step) => step.stepId === "save-session");
  assert(sessionStep?.status === "passed", "Save Session did not pass.");
  const sessionPath = sessionStep.screenshotPath || String(sessionStep.outputs.savedSessionPath ?? "");
  const knownSessionFiles = existsSync(context.paths.sessions ?? "") ? [context.paths.sessions!] : [];
  assert(sessionPath || knownSessionFiles.length, "No session evidence path was produced.");
  return {
    evidence: [context.paths.sessions!],
    details: "Two explicit local manual handoffs were resumed through the controller; storage state was saved. No CAPTCHA, MFA, OTP, or protected login was automated."
  };
}

async function runRecoveryFlow(browser: Browser): Promise<{ evidence: string[]; details: string }> {
  const context = await makeContext("recovery");
  const flow: FlowProfile = {
    id: "comprehensive-retry-recovery",
    name: "Retry and recovery",
    version: 1,
    nodes: [
      { id: "start", type: "start", name: "Start" },
      { id: "goto", type: "goto", name: "Open form", url: `${BASE}/form` },
      {
        id: "failing-assert",
        type: "click",
        name: "Open missing local list",
        locator: { strategy: "id", value: "missing-retry-target" },
        timeoutMs: 150,
        retry: { count: 2, delayMs: 25 },
        onFailure: { action: "goToFailureEdge", screenshot: true },
        safety: { sideEffectLevel: "read", retryable: true }
      },
      { id: "recover", type: "fill", name: "Recover", locator: { strategy: "id", value: "firstName" }, value: "Recovered" },
      { id: "end", type: "end", name: "End" }
    ],
    edges: [
      { id: "recovery-e1", source: "start", target: "goto", type: "success" },
      { id: "recovery-e2", source: "goto", target: "failing-assert", type: "success" },
      { id: "recovery-e3", source: "failing-assert", target: "recover", type: "failure" },
      { id: "recovery-e4", source: "recover", target: "end", type: "success" }
    ]
  };
  const { result, page } = await executePersistedFlow(browser, flow, context);
  assert(result.status === "passed", result.error ?? "Recovery flow did not recover.");
  const failed = result.steps.find((step) => step.stepId === "failing-assert");
  assert(failed?.status === "failed", "Controlled assertion was not recorded as failed.");
  const attempts = new Set((failed.evidence ?? []).map((item) => item.attempt));
  assert(attempts.has(0) && attempts.has(1), `Expected evidence for retry attempts 0 and 1; received ${[...attempts].join(", ")}.`);
  assert((await page.inputValue("#firstName")) === "Recovered", "Failure edge did not perform recovery.");
  const evidence = (failed.evidence ?? []).flatMap((item) => (item.path ? [item.path] : []));
  await page.close();
  return {
    evidence,
    details: "A deterministic read-only failure retried once, retained per-attempt evidence, followed the failure connector, and recovered."
  };
}

async function writeLedger(): Promise<void> {
  const summary = {
    generatedAt: new Date().toISOString(),
    repositoryRoot: ROOT,
    artifactRoot: ARTIFACT_ROOT,
    baseUrl: BASE,
    totals: {
      pass: caseResults.filter((item) => item.status === "PASS").length,
      fail: caseResults.filter((item) => item.status === "FAIL").length,
      blocked: caseResults.filter((item) => item.status === "BLOCKED").length,
      notRun: caseResults.filter((item) => item.status === "NOT RUN").length
    },
    cases: caseResults
  };
  await writeFile(join(ARTIFACT_ROOT, "campaign-results.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(join(ARTIFACT_ROOT, "runner-logs.json"), JSON.stringify(allLogs, null, 2), "utf8");
}

async function main(): Promise<void> {
  await ensureDirectories([ARTIFACT_ROOT]);
  await ensureMockServer();
  const flows = await Promise.all(comprehensiveFlowFiles.map((file) => readJson<FlowProfile>(join(FLOW_ROOT, file))));
  const flowMap = new Map(flows.map((flow) => [flow.id, flow]));
  const allFixtureFiles = (await readdir(FLOW_ROOT)).filter((file) => file.endsWith(".json"));
  const allFixtureFlows = await Promise.all(allFixtureFiles.map((file) => readJson<FlowProfile>(join(FLOW_ROOT, file))));

  await withCase("CMP-INV-001", "Persisted node, edge, connector, and value-source inventory", () => validateInventory(allFixtureFlows));

  const browser = await chromium.launch({ headless: true });
  try {
    await withCase("CMP-FLOW-001", "Core node and cross-flow data propagation", () => runCoreAndCrossFlow(browser, flowMap));
    await withCase("CMP-IO-001", "Upload, async waits, output mapping, and download", () => runIoFlow(browser, flowMap));
    await withCase("CMP-CON-001", "Structured and legacy connector routing", () => runConnectorFlow(browser, flowMap));
    await withCase("CMP-CON-002", "Flow manual-approval connector continuation", () => runFlowManualApprovalConnector(browser));
    await withCase("CMP-ERR-001", "Retry, evidence retention, failure edge, and recovery", () => runRecoveryFlow(browser));
  } finally {
    await browser.close();
  }

  await withCase("CMP-POP-001", "Multi-window and popup lifecycle", () => runPopupFlow(flowMap));
  await withCase("CMP-WF-001", "Persisted multi-flow workflow", () => runWorkflow(flows));
  await withCase("CMP-MAN-001", "Manual handoff, protected handoff, and local session save", () => runManualSessionSubset(flowMap));

  await writeLedger();
  console.log(`Evidence ledger: ${join(ARTIFACT_ROOT, "campaign-results.json")}`);
  console.log(`Runner logs: ${join(ARTIFACT_ROOT, "runner-logs.json")}`);
  if (caseResults.some((item) => item.status === "FAIL")) process.exitCode = 1;
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    await writeLedger().catch(() => undefined);
  })
  .finally(() => {
    if (startedServer && server && !server.killed) server.kill();
  });
