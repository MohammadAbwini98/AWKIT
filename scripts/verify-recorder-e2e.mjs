// REC-018 — real Electron Recorder → save → restart/reopen → production replay.
//
// This verifier deliberately uses:
//   - the rendered Recorder controls for Start / Stop / Save;
//   - an isolated %LOCALAPPDATA% and the real SecurityGate;
//   - the Flow Library and Flow Designer UI for reopen + no-op save;
//   - the app's execution IPC, which enters the production ExecutionEngine.
//
// It does NOT attach to the Recorder browser over CDP or add test launch arguments. Replay honesty
// comes from `/recorder-lab?rec018=1`: that harness is inert without the Recorder-only binding.
// A resettable mock-site oracle is cleared after capture, so only the production replay can create
// the subsequently asserted submission.
//
// Run after `npm run build`:
//   npm run verify:recorder-e2e
import { _electron as electron } from "playwright";
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DEFAULT_CREDS,
  isolatedLaunchEnv,
  resolveMainWindow,
  signInFirstRun
} from "./lib/gui-verify-harness.mjs";
import { loginAs, navClick } from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.AWKIT_RECORDER_E2E_PORT ?? 4418);
const baseUrl = `http://127.0.0.1:${port}`;
const targetUrl = `${baseUrl}/recorder-lab?rec018=1`;
const flowName = "REC-018 Recorded Replay";
const workflowId = "rec-018-replay-workflow";
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = path.join(root, "test-artifacts", "recorder-e2e", runStamp);
const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-recorder-e2e", {
  // Isolation also changes Playwright's developer cache location. Force the app's supported
  // production-offline path so Recorder and ExecutionEngine both use resources/browsers/chromium.
  PRODUCTION_OFFLINE: "true",
  AWKIT_MAX_BROWSERS: "1",
  AWKIT_MAX_ACTIVE_FLOWS: "1"
});
const appRoot = path.join(dataRoot, "SpecterStudio");
const serverLogPath = path.join(evidenceDir, "mock-site.log");
const results = [];
const rendererErrors = [];
const mockOutcomes = [];
let app;
let server;

function printable(value) {
  return String(value ?? "")
    .replaceAll(DEFAULT_CREDS.password, "[MASKED]")
    .slice(0, 1200);
}

function check(name, pass, detail = "") {
  const status = pass ? "PASS" : "FAIL";
  results.push({ name, status, detail: printable(detail) });
  console.log(`  ${status} ${name}${detail ? ` — ${printable(detail)}` : ""}`);
  return Boolean(pass);
}

function requireCheck(name, pass, detail = "") {
  if (!check(name, pass, detail)) throw new Error(`Required check failed: ${name}`);
}

async function poll(label, probe, timeoutMs = 30_000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const suffix = lastError ? ` Last error: ${printable(lastError instanceof Error ? lastError.message : lastError)}` : "";
  throw new Error(`${label} did not reach the expected state within ${timeoutMs} ms.${suffix}`);
}

async function httpJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function resetReplayOracle() {
  const state = await httpJson(`${baseUrl}/api/rec018/reset`, { method: "POST" });
  requireCheck("REC-018 replay oracle resets to zero", state.count === 0, JSON.stringify(state));
}

function expectedSubmission(state) {
  return state?.count === 1 &&
    state.latest?.fullName === "Rec018 Operator" &&
    state.latest?.email === "rec018@example.test" &&
    state.latest?.plan === "Enterprise" &&
    state.latest?.newsletter === true;
}

function recorderMetadataFromAction(action) {
  return {
    type: action.type,
    name: action.name,
    locator: action.locator,
    valueSource: action.valueSource,
    beforeWaits: action.beforeWaits,
    afterWaits: action.afterWaits,
    pageAlias: action.pageAlias,
    opensPopup: action.opensPopup,
    popupExpectation: action.popupExpectation
  };
}

function recorderMetadataFromStep(step) {
  return {
    type: step.type,
    name: step.name,
    locator: step.locator,
    valueSource: step.valueSource,
    beforeWaits: step.beforeWaits,
    afterWaits: step.afterWaits,
    pageAlias: step.pageAlias,
    opensPopup: step.opensPopup,
    popupExpectation: step.popupExpectation
  };
}

function recorderMetadataMatches(actions, flow) {
  const steps = flow?.nodes?.slice(1, -1) ?? [];
  return steps.length === actions.length &&
    steps.every(
      (step, index) =>
        JSON.stringify(recorderMetadataFromStep(step)) === JSON.stringify(recorderMetadataFromAction(actions[index]))
    );
}

function businessActionSequence(actions) {
  return actions.map((action) => action.type).join(",");
}

function uniqueInOrder(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

async function walkFiles(folder) {
  const files = [];
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

async function waitForServer() {
  return poll("mock site", async () => {
    const response = await fetch(`${baseUrl}/`).catch(() => null);
    return response?.ok ? true : null;
  }, 15_000, 100);
}

function watchRenderer(win, phase) {
  win.on("console", (message) => {
    if (message.type() === "error") rendererErrors.push({ phase, type: "console", message: printable(message.text()) });
  });
  win.on("pageerror", (error) => {
    rendererErrors.push({ phase, type: "pageerror", message: printable(error.message) });
  });
}

async function launchMainWindow(phase, firstRun) {
  app = await electron.launch({ args: [root], cwd: root, env });
  const win = await resolveMainWindow(app);
  watchRenderer(win, phase);
  await win.waitForLoadState("domcontentloaded");
  if (firstRun) {
    await signInFirstRun(win);
  } else {
    const shellVisible = await win.locator(".app-shell").isVisible().catch(() => false);
    if (!shellVisible) {
      await loginAs(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
      await win.waitForSelector(".app-shell", { timeout: 25_000 });
    }
  }
  return win;
}

async function closeApp() {
  if (!app) return;
  const closing = app;
  app = undefined;
  await closing.close().catch(() => undefined);
}

function createWorkflow(flowId) {
  const now = new Date().toISOString();
  return {
    id: workflowId,
    name: "REC-018 Production Replay",
    description: "Runs the flow created by the real Recorder page through the production ExecutionEngine.",
    version: 1,
    nodes: [
      {
        id: "recorded-flow",
        type: "flowRef",
        flowId,
        alias: flowName,
        order: 1,
        required: true,
        inputBindings: {}
      }
    ],
    edges: [],
    runtimeInputs: [],
    execution: {
      mode: "sequential",
      maxConcurrentInstances: 1,
      stopOnRequiredFlowFailure: true
    },
    createdAt: now,
    updatedAt: now
  };
}

async function waitForTerminalInstance(win, executionId) {
  return poll(
    `execution ${executionId}`,
    async () => {
      const instances = await win.evaluate(() => window.playwrightFlowStudio.executions.list());
      const instance = instances.find((candidate) => candidate.executionId === executionId);
      return instance && ["completed", "failed", "cancelled"].includes(instance.status) ? instance : null;
    },
    120_000,
    250
  );
}

async function runProductionReplay(win, flow, label) {
  console.log(`\n${label}: production ExecutionEngine replay`);
  await resetReplayOracle();

  const response = await win.evaluate(
    (id) =>
      window.playwrightFlowStudio.executions.runWorkflow({
        workflowId: id,
        headless: true,
        dryRun: false,
        totalInstances: 1,
        maxConcurrentInstances: 1
      }),
    workflowId
  );
  requireCheck(`${label} is accepted by the production run gate`, response?.status === "started", JSON.stringify(response));

  const instance = await waitForTerminalInstance(win, response.executionId);
  requireCheck(`${label} completes`, instance.status === "completed", JSON.stringify({
    status: instance.status,
    currentStep: instance.currentStep,
    error: instance.error
  }));

  const state = await poll(
    `${label} mock business outcome`,
    async () => {
      const current = await httpJson(`${baseUrl}/api/rec018/state`);
      return expectedSubmission(current) ? current : null;
    },
    10_000,
    100
  );
  mockOutcomes.push({ label, state });
  check(`${label} reproduces the recorded target state while the fixture is inert`, expectedSubmission(state), JSON.stringify(state));

  const logPath = instance.paths?.logs;
  requireCheck(`${label} writes a structured run log`, typeof logPath === "string", logPath);
  const logText = await readFile(logPath, "utf8");
  const logLines = logText.trim().split(/\r?\n/).filter(Boolean);
  const parsedLog = [];
  for (const line of logLines) {
    try {
      parsedLog.push(JSON.parse(line));
    } catch {
      // Counted below.
    }
  }
  check(`${label} log is valid JSONL`, parsedLog.length === logLines.length && parsedLog.length > 0, `${parsedLog.length}/${logLines.length}`);

  const expectedNodeOrder = flow.nodes.map((node) => node.id);
  const succeededOrder = uniqueInOrder(
    parsedLog.filter((row) => row.event === "step.succeeded").map((row) => row.nodeId)
  );
  check(
    `${label} log records every node succeeding in order`,
    JSON.stringify(succeededOrder) === JSON.stringify(expectedNodeOrder),
    `expected=${expectedNodeOrder.join(">")} actual=${succeededOrder.join(">")}`
  );

  const reportPath = path.join(appRoot, "reports", response.executionId, "report.json");
  await poll(`${label} aggregate report`, async () => {
    const text = await readFile(reportPath, "utf8").catch(() => "");
    return text ? true : null;
  }, 15_000, 200);
  const reportText = await readFile(reportPath, "utf8");
  const report = JSON.parse(reportText);
  const reportSteps = report.instances?.[0]?.scenarioResult?.flows?.[0]?.steps ?? [];
  check(`${label} report status is passed`, report.status === "passed" && report.instances?.[0]?.status === "passed", JSON.stringify({
    report: report.status,
    instance: report.instances?.[0]?.status
  }));
  check(
    `${label} report contains every node once in order`,
    JSON.stringify(reportSteps.map((step) => step.stepId)) === JSON.stringify(expectedNodeOrder) &&
      reportSteps.every((step) => step.status === "passed"),
    JSON.stringify(reportSteps.map((step) => ({ id: step.stepId, status: step.status })))
  );
  check(
    `${label} report and log do not contain the authentication secret`,
    !reportText.includes(DEFAULT_CREDS.password) && !logText.includes(DEFAULT_CREDS.password)
  );

  const storedReport = await win.evaluate(
    (executionId) => window.playwrightFlowStudio.reports.get(executionId),
    response.executionId
  );
  check(`${label} report is available through the app report store`, storedReport?.executionId === response.executionId);

  await copyFile(logPath, path.join(evidenceDir, `${label}-run-log.jsonl`));
  await copyFile(reportPath, path.join(evidenceDir, `${label}-report.json`));

  const instanceRoot = path.dirname(instance.paths.storage);
  const stateFiles = (await walkFiles(instanceRoot)).filter((file) => file.endsWith("flow-state.json"));
  check(`${label} writes end-of-run recovery state`, stateFiles.length > 0, instanceRoot);
  if (stateFiles[0]) await copyFile(stateFiles[0], path.join(evidenceDir, `${label}-flow-state.json`));

  return { response, instance, report, state };
}

async function writeEvidence(extra = {}) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, "execution-results.json"),
    `${JSON.stringify(
      {
        runId: runStamp,
        caseId: "REC-018",
        status: results.some((result) => result.status === "FAIL") ? "FAIL" : "PASS",
        results,
        rendererErrors,
        mockOutcomes,
        ...extra
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(path.join(evidenceDir, "renderer-errors.json"), `${JSON.stringify(rendererErrors, null, 2)}\n`, "utf8");
}

await mkdir(evidenceDir, { recursive: true });
const serverLog = createWriteStream(serverLogPath, { flags: "a" });
server = spawn(process.execPath, ["mock-site/server.mjs"], {
  cwd: root,
  env: { ...process.env, MOCK_SITE_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
server.stdout.pipe(serverLog);
server.stderr.pipe(serverLog);

let capturedActions = [];
let savedFlow;
let firstReplay;
let secondReplay;

try {
  await waitForServer();
  console.log(`REC-018 evidence: ${evidenceDir}`);

  console.log("\nCapture: real Recorder page → launched browser → Stop → Save");
  const captureWin = await launchMainWindow("capture", true);
  await navClick(captureWin, "Recorder");
  await captureWin.waitForSelector(".recorder-page", { timeout: 20_000 });
  await captureWin.getByLabel("Target URL").fill(targetUrl);
  await captureWin.getByRole("button", { name: "Start Recording", exact: true }).click();
  try {
    await poll("Recorder running status", async () => {
      const status = await captureWin.evaluate(() => window.playwrightFlowStudio.recorder.getStatus());
      return status.isRecording ? status : null;
    }, 30_000, 200);
  } catch (error) {
    const diagnostic = await captureWin.evaluate(async () => ({
      status: await window.playwrightFlowStudio.recorder.getStatus(),
      message: document.querySelector(".recorder-status-text")?.textContent ?? "",
      target: document.querySelector(".recorder-url-field input")?.value ?? "",
      startDisabled: document.querySelector(".recorder-record-button")?.disabled ?? null
    })).catch(() => null);
    await captureWin.screenshot({ path: path.join(evidenceDir, "00-recorder-start-failure.png"), fullPage: true }).catch(() => undefined);
    throw new Error(`${error instanceof Error ? error.message : error} Diagnostic=${JSON.stringify(diagnostic)}`);
  }
  check("Recorder was started through its rendered controls", true);

  capturedActions = await poll("REC-018 recorded action sequence", async () => {
    const actions = await captureWin.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
    return actions.some((action) => action.type === "click") ? actions : null;
  }, 30_000, 200);
  requireCheck(
    "Recorder captures the deterministic business sequence",
    businessActionSequence(capturedActions) === "goto,fill,fill,select,check,click",
    businessActionSequence(capturedActions)
  );
  check(
    "Recorder captures the fixed synthetic field values",
    capturedActions.filter((action) => action.valueSource?.type === "static").map((action) => action.valueSource.value).join("|") ===
      `${targetUrl}|Rec018 Operator|rec018@example.test|Enterprise`,
    JSON.stringify(capturedActions.map((action) => ({ type: action.type, value: action.valueSource?.value })))
  );
  check(
    "Every recorded interaction has locator metadata",
    capturedActions.slice(1).every((action) => action.locator?.strategy && action.locator?.value),
    JSON.stringify(capturedActions.slice(1).map((action) => action.locator))
  );

  const captureState = await poll("capture-side mock outcome", async () => {
    const state = await httpJson(`${baseUrl}/api/rec018/state`);
    return expectedSubmission(state) ? state : null;
  }, 10_000, 100);
  mockOutcomes.push({ label: "capture", state: captureState });
  check("Recorder-attached positive control completes the fixture", expectedSubmission(captureState), JSON.stringify(captureState));

  await captureWin.getByRole("button", { name: "Stop", exact: true }).click();
  await captureWin.getByText("Recording stopped. Ready to save.", { exact: true }).waitFor({ timeout: 20_000 });
  await captureWin.screenshot({ path: path.join(evidenceDir, "01-recorder-stopped.png"), fullPage: true });
  check("Recorder Stop returns the UI to Ready to save", await captureWin.getByText("Ready to save", { exact: true }).isVisible());

  await captureWin.getByLabel("Flow Name").fill(flowName);
  await captureWin.getByRole("button", { name: "Save to Flow Library", exact: true }).click();
  const reviewModal = captureWin.getByTestId("recorder-review-modal");
  if (await reviewModal.isVisible().catch(() => false)) {
    await reviewModal.getByTestId("review-confirm-save").click();
  }
  await captureWin.getByText(`Flow saved to library successfully: ${flowName}`, { exact: true }).first().waitFor({ timeout: 20_000 });
  await captureWin.screenshot({ path: path.join(evidenceDir, "02-recorder-saved.png"), fullPage: true });

  const savedFlows = await captureWin.evaluate(() => window.playwrightFlowStudio.flows.list());
  savedFlow = savedFlows.find((flow) => flow.name === flowName);
  requireCheck("Recorder Save creates exactly one named Flow Library profile", Boolean(savedFlow), savedFlows.map((flow) => flow.name).join(", "));
  check(
    "Saved flow has Start → recorded actions → End and one connector per transition",
    savedFlow.nodes.length === capturedActions.length + 2 &&
      savedFlow.nodes[0].type === "start" &&
      savedFlow.nodes.at(-1).type === "end" &&
      savedFlow.edges.length === savedFlow.nodes.length - 1,
    `nodes=${savedFlow.nodes.length} edges=${savedFlow.edges.length}`
  );
  check("Recorder locator/value/wait metadata survives initial save", recorderMetadataMatches(capturedActions, savedFlow));
  await writeFile(
    path.join(evidenceDir, "recorded-actions-and-flow.json"),
    `${JSON.stringify({ capturedActions, savedFlow }, null, 2)}\n`,
    "utf8"
  );
  await closeApp();

  console.log("\nPersistence: restart on the same data root → Flow Library reopen");
  const replayWin = await launchMainWindow("restart-and-replay", false);
  const persisted = await replayWin.evaluate((id) => window.playwrightFlowStudio.flows.get(id), savedFlow.id);
  requireCheck("Recorded flow persists across a full Electron restart", Boolean(persisted), savedFlow.id);
  check("Persisted flow still carries Recorder metadata", recorderMetadataMatches(capturedActions, persisted));

  await navClick(replayWin, "Flows");
  const libraryRow = replayWin.locator(".wl-table tbody tr", { hasText: flowName });
  await libraryRow.waitFor({ state: "visible", timeout: 20_000 });
  check("Flow Library UI visibly reopens the recorded flow after restart", (await libraryRow.count()) === 1);
  await replayWin.screenshot({ path: path.join(evidenceDir, "03-flow-library-after-restart.png"), fullPage: true });

  const workflow = createWorkflow(savedFlow.id);
  const importedWorkflow = await replayWin.evaluate(
    (profile) => window.playwrightFlowStudio.workflows.import(profile),
    workflow
  );
  requireCheck("Replay workflow fixture is persisted through the app API", importedWorkflow?.id === workflowId, JSON.stringify(importedWorkflow));

  firstReplay = await runProductionReplay(replayWin, persisted, "run-1-before-designer-save");

  console.log("\nRound-trip: Flow Library row → Flow Designer → Save");
  await libraryRow.click();
  await replayWin.waitForSelector(".react-flow-shell", { timeout: 20_000 });
  await poll("recorded flow selected in Flow Designer", async () => {
    const text = await replayWin.locator(".searchable-select-trigger").textContent().catch(() => "");
    return text?.includes(flowName) ? true : null;
  }, 20_000, 200);
  await replayWin.screenshot({ path: path.join(evidenceDir, "04-designer-open.png"), fullPage: true });
  const beforeDesignerSave = await replayWin.evaluate((id) => window.playwrightFlowStudio.flows.get(id), savedFlow.id);
  await replayWin.locator(".top-header .header-actions").getByRole("button", { name: "Save", exact: true }).click();
  await replayWin.getByText(`Flow saved successfully: ${flowName}`, { exact: true }).waitFor({ timeout: 20_000 });
  const afterDesignerSave = await replayWin.evaluate((id) => window.playwrightFlowStudio.flows.get(id), savedFlow.id);
  await replayWin.screenshot({ path: path.join(evidenceDir, "05-designer-saved.png"), fullPage: true });
  check("Flow Designer no-op save preserves all Recorder-owned metadata", recorderMetadataMatches(capturedActions, afterDesignerSave));
  check(
    "Flow Designer no-op save preserves node and connector order",
    beforeDesignerSave.nodes.map((node) => node.id).join(",") === afterDesignerSave.nodes.map((node) => node.id).join(",") &&
      beforeDesignerSave.edges.map((edge) => `${edge.source}->${edge.target}`).join(",") ===
        afterDesignerSave.edges.map((edge) => `${edge.source}->${edge.target}`).join(",")
  );

  secondReplay = await runProductionReplay(replayWin, afterDesignerSave, "run-2-after-designer-save");

  await navClick(replayWin, "Reports");
  await replayWin.waitForSelector(".reports-page, .page", { timeout: 20_000 });
  await replayWin.screenshot({ path: path.join(evidenceDir, "06-populated-reports.png"), fullPage: true });
  check("Both production runs are stored for the Reports surface", Boolean(firstReplay.report && secondReplay.report));
  check("Recorder E2E emits no renderer console/page errors", rendererErrors.length === 0, JSON.stringify(rendererErrors));

  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;
  await writeEvidence({
    flowId: savedFlow.id,
    workflowId,
    executionIds: [firstReplay.response.executionId, secondReplay.response.executionId],
    evidenceDir
  });
  console.log(`\nREC-018: ${passed} PASS / ${failed} FAIL`);
  console.log(`Evidence: ${evidenceDir}`);
  process.exitCode = failed === 0 ? 0 : 1;
} catch (error) {
  const message = printable(error instanceof Error ? error.stack ?? error.message : error);
  console.error(`REC-018 verifier failed: ${message}`);
  check("REC-018 integrated journey completes without an unhandled verifier error", false, message);
  await writeEvidence({
    flowId: savedFlow?.id,
    workflowId,
    evidenceDir,
    error: message
  }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await closeApp();
  if (server?.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  serverLog.end();
  cleanup();
}
