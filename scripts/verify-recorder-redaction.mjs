// REC-007 — sensitive input and signal redaction, end to end.
//
// `verify:recorder` and `verify:protected-login-recorder` already prove the capture script's
// redaction rules and the safe-signal contract at component level. What was never executed is the
// claim that matters operationally: after a REAL recording of secret-shaped fields, no typed value
// exists in ANY artifact the app persists.
//
// So this drives the real Recorder page against `/recorder-lab?rec007=1`, whose double-gated
// self-driving harness types fixed canary constants into password / one-time-code / card / CVC /
// PIN / SSN / token / shared-secret controls and submits — putting the token in a query string, an
// Authorization header and a JSON body — then scans, for every canary:
//
//   in-memory actions · the on-disk recorder draft · the saved flow JSON · the recorder URL history
//   · the production run's JSONL log · the stored run report · the recorder status/diagnostics
//
// A non-sensitive display name is recorded alongside as a positive control: if NOTHING survives the
// scan the test could be passing because nothing was captured at all, so the safe value must be
// present in exactly the places the canaries are absent from.
//
// Run after `npm run build`:
//   npm run verify:recorder-redaction
import { _electron as electron } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";
import { navClick } from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.AWKIT_REC007_PORT ?? 4419);
const baseUrl = `http://127.0.0.1:${port}`;
const targetUrl = `${baseUrl}/recorder-sensitive?rec007=1`;
const flowName = "REC-007 Redaction Capture";
const workflowId = "rec-007-redaction-workflow";
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = path.join(root, "test-artifacts", "recorder-redaction", runStamp);
const { env, electronArgs, dataRoot, cleanup } = isolatedLaunchEnv("awkit-rec007", {
  PRODUCTION_OFFLINE: "true",
  AWKIT_MAX_BROWSERS: "1",
  AWKIT_MAX_ACTIVE_FLOWS: "1"
});
const appRoot = path.join(dataRoot, "SpecterStudio");

// MUST match `window.__AWKIT_REC007_CANARIES` in mock-site/public/recorder-lab.html.
// Synthetic markers, not credentials — they authenticate nothing.
const CANARIES = {
  password: "CANARY-PASSWORD-8f2a1c7d4b6e",
  otp: "CANARY-OTP-3d9e5a1f8c2b",
  card: "CANARY-CARD-6b4f2e9d7a3c",
  cvc: "CANARY-CVC-1a8c4e2f9d5b",
  pin: "CANARY-PIN-7e3b9f1d6a4c",
  ssn: "CANARY-SSN-2c6a8d4b1f9e",
  token: "CANARY-TOKEN-9d5f3a7c2e8b",
  shared: "CANARY-SHARED-4f1e6b8a3d7c"
};
const SAFE_VALUE = "Rec007 Display Name";

const results = [];
const rendererErrors = [];
let app;
let server;

function check(name, pass, detail = "") {
  const status = pass ? "PASS" : "FAIL";
  results.push({ name, status, detail: String(detail ?? "").slice(0, 600) });
  console.log(`  ${status}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`);
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
  throw new Error(`Timed out waiting for ${label}. ${lastError instanceof Error ? lastError.message : ""}`);
}

async function waitForServer() {
  return poll("mock site", async () => {
    const response = await fetch(`${baseUrl}/`).catch(() => null);
    return response?.ok ? true : null;
  }, 30_000, 200);
}

/**
 * Start one recording against the fixture with detection at its secure default, let it settle, and
 * return the status. Always cancels, so a paused/handed-off session never leaks into the next phase.
 */
async function probeDefaultDetection(win) {
  await navClick(win, "Recorder");
  await win.waitForSelector(".recorder-page", { timeout: 20_000 });
  await win.getByLabel("Target URL").fill(targetUrl);
  await win.getByRole("button", { name: "Start Recording", exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const status = await win.evaluate(async () => ({
    ...(await window.playwrightFlowStudio.recorder.getStatus()),
    handoff: await window.playwrightFlowStudio.recorder.getHandoff()
  }));
  await win.evaluate(async () => {
    try {
      await window.playwrightFlowStudio.recorder.cancel();
    } catch {
      /* already idle */
    }
  });
  return status;
}

/** Every file under a directory tree, so the scan cannot miss an artifact by not knowing its name. */
async function collectFiles(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

/**
 * Scan one blob of text for every canary. Returns the canary names found, so a failure names the
 * exact secret that leaked rather than just saying "something did".
 */
function canariesIn(text) {
  return Object.entries(CANARIES)
    .filter(([, value]) => text.includes(value))
    .map(([name]) => name);
}

await mkdir(evidenceDir, { recursive: true });
const serverLog = createWriteStream(path.join(evidenceDir, "mock-site.log"), { flags: "a" });
server = spawn(process.execPath, ["mock-site/server.mjs"], {
  cwd: root,
  env: { ...process.env, MOCK_SITE_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
server.stdout.pipe(serverLog);
server.stderr.pipe(serverLog);

try {
  await waitForServer();
  console.log(`REC-007 evidence: ${evidenceDir}\n`);

  app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
  const win = await resolveMainWindow(app);
  win.on("console", (message) => {
    if (message.type() === "error") rendererErrors.push(message.text());
  });
  win.on("pageerror", (error) => rendererErrors.push(`pageerror: ${error.message}`));
  await signInFirstRun(win);

  // A page carrying password and one-time-code inputs reads as a protected login surface, so with
  // detection at its secure default the Recorder PAUSES for a manual handoff. That is the safety
  // feature working (REC-020 covers detection itself at 45/45), and it is also exactly why these
  // fields live on their own page instead of on the shared /recorder-lab, where they would have
  // changed the security character of every other scenario recorded there.
  //
  // REC-007 is about redaction, which must hold regardless of detection, so the capture run below
  // disables detection through the supported Settings flag. Asserting the pause first makes that a
  // deliberate, evidenced configuration rather than a silent workaround.
  const defaultStatus = await probeDefaultDetection(win);
  check(
    "REC-007 the sensitive fixture pauses on protected-login detection by default (safety intact)",
    defaultStatus.isRecording === false && defaultStatus.actionCount <= 2,
    JSON.stringify(defaultStatus)
  );

  console.log("Capture: real Recorder page → sensitive fields → Stop → Save");
  await win.evaluate(() =>
    window.playwrightFlowStudio.settings.update({ recorder: { ignoreProtectedLoginDetection: true } })
  );
  await navClick(win, "Recorder");
  await win.waitForSelector(".recorder-page", { timeout: 20_000 });
  await win.getByLabel("Target URL").fill(targetUrl);
  await win.getByRole("button", { name: "Start Recording", exact: true }).click();
  await poll("Recorder running", async () => {
    const status = await win.evaluate(() => window.playwrightFlowStudio.recorder.getStatus());
    return status.isRecording ? status : null;
  }, 30_000, 200);

  // The harness ends with a click on the submit button, so waiting for a click means every fill
  // before it has already been captured.
  let actions;
  try {
    actions = await poll("REC-007 recorded actions", async () => {
      const current = await win.evaluate(() => window.playwrightFlowStudio.recorder.getActions());
      return current.some((action) => action.type === "click") ? current : null;
    }, 30_000, 200);
  } catch (error) {
    const diagnostic = await win.evaluate(async () => ({
      status: await window.playwrightFlowStudio.recorder.getStatus(),
      actions: await window.playwrightFlowStudio.recorder.getActions()
    })).catch(() => null);
    throw new Error(`${error instanceof Error ? error.message : error} Diagnostic=${JSON.stringify(diagnostic)}`);
  }

  const fills = actions.filter((action) => action.type === "fill");
  requireCheck(
    "REC-007 all nine sensitive-lab inputs were captured as steps",
    fills.length === 9,
    `${fills.length}: ${JSON.stringify(fills.map((action) => action.valueSource?.value ?? ""))}`
  );

  // Positive control FIRST — otherwise "no canaries anywhere" could mean "nothing was recorded".
  const safeFill = fills.find((action) => action.valueSource?.value === SAFE_VALUE);
  requireCheck(
    "REC-007 the non-sensitive control value IS captured (proves capture worked)",
    Boolean(safeFill),
    JSON.stringify(fills.map((action) => action.valueSource?.value))
  );

  const actionsText = JSON.stringify(actions);
  check(
    "REC-007 no canary appears in the in-memory recorded actions",
    canariesIn(actionsText).length === 0,
    canariesIn(actionsText).join(", ")
  );
  check(
    "REC-007 each sensitive step is recorded but carries no value",
    fills.filter((action) => action.valueSource?.value === "" || action.valueSource?.value === undefined).length === 8,
    JSON.stringify(fills.map((action) => ({ v: action.valueSource?.value })))
  );

  await win.getByRole("button", { name: "Stop", exact: true }).click();
  await win.getByText("Recording stopped. Ready to save.", { exact: true }).waitFor({ timeout: 20_000 });

  await win.getByLabel("Flow Name").fill(flowName);
  await win.getByRole("button", { name: "Save to Flow Library", exact: true }).click();
  const reviewModal = win.getByTestId("recorder-review-modal");
  if (await reviewModal.isVisible().catch(() => false)) {
    await reviewModal.getByTestId("review-confirm-save").click();
  }
  await win.getByText(`Flow saved to library successfully: ${flowName}`, { exact: true }).first().waitFor({ timeout: 20_000 });

  const flows = await win.evaluate(() => window.playwrightFlowStudio.flows.list());
  const savedFlow = flows.find((flow) => flow.name === flowName);
  requireCheck("REC-007 the recording saved as a flow", Boolean(savedFlow), flows.map((flow) => flow.name).join(", "));

  const flowText = JSON.stringify(savedFlow);
  check("REC-007 no canary appears in the saved flow JSON", canariesIn(flowText).length === 0, canariesIn(flowText).join(", "));
  check("REC-007 the saved flow retains the non-sensitive control value", flowText.includes(SAFE_VALUE));

  // Recorder status/diagnostics and the saved URL history.
  const diagnostics = await win.evaluate(async () => ({
    status: await window.playwrightFlowStudio.recorder.getStatus(),
    urls: await window.playwrightFlowStudio.recorder.getUrls(),
    handoff: await window.playwrightFlowStudio.recorder.getHandoff()
  }));
  const diagnosticsText = JSON.stringify(diagnostics);
  check(
    "REC-007 no canary appears in recorder status, URL history or handoff diagnostics",
    canariesIn(diagnosticsText).length === 0,
    canariesIn(diagnosticsText).join(", ")
  );

  // Production replay, purely to generate a real run log and stored report to scan.
  console.log("\nReplay: production ExecutionEngine (to produce a log and report to scan)");
  const now = new Date().toISOString();
  await win.evaluate(
    (profile) => window.playwrightFlowStudio.workflows.import(profile),
    {
      id: workflowId,
      name: "REC-007 Redaction Replay",
      description: "Replays the redacted recording so its log and report can be scanned.",
      version: 1,
      nodes: [{ id: "recorded-flow", type: "flowRef", flowId: savedFlow.id, alias: flowName, order: 1, required: true, inputBindings: {} }],
      edges: [],
      runtimeInputs: [],
      execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: false },
      createdAt: now,
      updatedAt: now
    }
  );
  const response = await win.evaluate(
    (id) => window.playwrightFlowStudio.executions.runWorkflow({
      workflowId: id,
      headless: true,
      dryRun: false,
      totalInstances: 1,
      maxConcurrentInstances: 1
    }),
    workflowId
  );
  requireCheck("REC-007 replay is accepted by the production run gate", response?.status === "started", JSON.stringify(response));

  const instance = await poll("REC-007 replay reaches a terminal state", async () => {
    const instances = await win.evaluate(() => window.playwrightFlowStudio.executions.list());
    const found = instances.find((candidate) => candidate.executionId === response.executionId);
    return found && ["completed", "failed", "cancelled"].includes(found.status) ? found : null;
  }, 120_000, 250);
  // Whether the replay PASSES is not the point — a redacted credential field legitimately submits an
  // empty value. What matters is that the artifacts it wrote contain no canary.
  check("REC-007 replay reached a terminal state", Boolean(instance.status), instance.status);

  // Whole-tree scan: every file the app wrote under the isolated data root.
  const files = await collectFiles(appRoot);
  const leaks = [];
  let scanned = 0;
  for (const file of files) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    scanned += 1;
    const found = canariesIn(text);
    if (found.length > 0) leaks.push({ file: path.relative(appRoot, file), canaries: found });
  }
  requireCheck("REC-007 the scan actually read the app's artifacts", scanned > 5, `${scanned} files under ${appRoot}`);
  check(
    "REC-007 no canary exists anywhere under the application data root",
    leaks.length === 0,
    JSON.stringify(leaks).slice(0, 500)
  );

  // Positive control on the same corpus: the safe value MUST be somewhere, or the scan is vacuous.
  let safeHits = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (text.includes(SAFE_VALUE)) safeHits += 1;
  }
  check(
    "REC-007 the non-sensitive value IS present on disk (the scan is not vacuous)",
    safeHits > 0,
    `${safeHits} file(s)`
  );

  check("REC-007 emits no renderer console/page error", rendererErrors.length === 0, JSON.stringify(rendererErrors.slice(0, 4)));

  await writeFile(
    path.join(evidenceDir, "execution-results.json"),
    `${JSON.stringify({ runId: runStamp, caseId: "REC-007", results, leaks, scannedFiles: scanned, rendererErrors }, null, 2)}\n`,
    "utf8"
  );
} catch (error) {
  check("REC-007 verifier completes without an unhandled error", false, error instanceof Error ? error.stack ?? error.message : String(error));
  await writeFile(
    path.join(evidenceDir, "execution-results.json"),
    `${JSON.stringify({ runId: runStamp, caseId: "REC-007", results, rendererErrors }, null, 2)}\n`,
    "utf8"
  ).catch(() => undefined);
} finally {
  try {
    await app?.windows()?.[0]?.evaluate(async () => {
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

const passed = results.filter((result) => result.status === "PASS").length;
const failed = results.length - passed;
console.log(`\nREC-007 redaction: ${passed} PASS / ${failed} FAIL`);
console.log(`Evidence: ${path.relative(root, evidenceDir)}`);
process.exit(failed === 0 ? 0 : 1);
