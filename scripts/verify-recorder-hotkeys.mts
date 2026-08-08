/** Real-browser capture â†’ save/reload â†’ production StepExecutor replay for Recorder shortcuts. */
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type BrowserContext } from "playwright";
import { getRecorderInitScriptContent } from "@src/recorder/recorderInitScript";
import { RecorderService } from "@src/recorder/RecorderService";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { StepExecutor } from "@src/runner/StepExecutor";
import { ValueResolver } from "@src/runner/ValueResolver";
import type { FlowStep } from "@src/profiles/FlowProfile";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

const PORT = 4391;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` â€” ${detail}` : ""}`);
  }
}

async function waitForSite(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${BASE_URL}/recorder-lab`)).ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Mock Site did not start.");
}

function executionContext(): InstanceExecutionContext {
  return {
    executionId: "hotkey-exec",
    instanceId: "hotkey-instance",
    scenarioId: "hotkey-scenario",
    flowId: "hotkey-flow",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: "", screenshots: "", logs: "", reports: "", sessions: "" }
  };
}

async function main(): Promise<void> {
  let server: ChildProcess | undefined;
  let context: BrowserContext | undefined;
  const browser = await chromium.launch({ headless: true });
  try {
    server = spawn(process.execPath, ["mock-site/server.mjs"], {
      env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
      stdio: "ignore",
      windowsHide: true
    });
    await waitForSite();

    context = await browser.newContext();
    const recorder = new RecorderService() as any;
    recorder.isRecording = true;
    recorder.captureWaitTime = false;
    recorder.captureSmartWaits = false;
    recorder.actions = [];
    recorder.lastActionAt = 0;
    await context.exposeBinding("__awtkit_recordAction", (source, action) => {
      recorder.recordActionFromPage(source.page, action, source.frame);
    });
    await context.exposeBinding("__awtkit_recordSignal", () => undefined);
    await context.addInitScript({ content: getRecorderInitScriptContent() });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/recorder-lab`, { waitUntil: "domcontentloaded" });

    console.log("Recorder keyboard capture");
    await page.getByTestId("shortcut-text").pressSequentially("ordinary text");
    await page.getByTestId("shortcut-focus").click();
    await page.keyboard.press("Control+s");
    await page.keyboard.press("Control+Alt+Shift+k");
    await page.keyboard.press("F6");
    await page.getByTestId("shortcut-focus").focus();
    await page.keyboard.press("Shift+Tab");
    await page.waitForTimeout(100);

    const actions = recorder.getActions() as Array<{ type: string; name: string; valueSource?: { value: string } }>;
    const presses = actions.filter((action) => action.type === "press");
    const fills = actions.filter((action) => action.type === "fill");
    check("ordinary typing compacts to one Fill action", fills.length === 1 && fills[0]?.valueSource?.value === "ordinary text", JSON.stringify(fills));
    check("ordinary characters never become Press actions", !presses.some((action) => action.valueSource?.value === "O" || action.valueSource?.value === "T"), JSON.stringify(presses));
    check("Ctrl+S canonicalizes once", presses.filter((action) => action.valueSource?.value === "Control+S").length === 1, JSON.stringify(presses));
    check("modifier order is deterministic", presses.some((action) => action.valueSource?.value === "Control+Alt+Shift+K"), JSON.stringify(presses));
    check("F1-F12 capture includes F6", presses.some((action) => action.valueSource?.value === "F6"), JSON.stringify(presses));
    check("Shift+Tab is a single shortcut", presses.some((action) => action.valueSource?.value === "Shift+Tab"), JSON.stringify(presses));

    const beforeUntrusted = recorder.getActions().length;
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "F9", bubbles: true })));
    await page.waitForTimeout(50);
    check("untrusted synthetic keyboard events are ignored", recorder.getActions().length === beforeUntrusted);

    await page.setContent('<input data-testid="secret" type="password" value="">');
    await page.getByTestId("secret").focus();
    const beforeSensitive = recorder.getActions().length;
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(50);
    check("shortcuts on protected inputs are not captured", recorder.getActions().length === beforeSensitive);

    const flow = JSON.parse(JSON.stringify(buildRecordedFlow("Keyboard replay", recorder.getActions()))) as { nodes: FlowStep[] };
    const savedPress = flow.nodes.find((step) => step.type === "press" && step.valueSource?.value === "Control+S");
    check("save/reload preserves canonical Press Shortcut", savedPress?.valueSource?.value === "Control+S", JSON.stringify(savedPress));

    const replayContext = await browser.newContext();
    const replayPage = await replayContext.newPage();
    await replayPage.goto(`${BASE_URL}/recorder-lab`, { waitUntil: "domcontentloaded" });
    await replayPage.getByTestId("shortcut-focus").focus();
    const runtime = executionContext();
    const executor = new StepExecutor(replayPage, new LocatorFactory(replayPage), new ValueResolver(runtime), runtime);
    const result = savedPress ? await executor.execute(savedPress) : { status: "failed", error: "missing Press step" };
    check("production StepExecutor replays the saved shortcut", result.status === "passed", result.error ?? result.status);
    check("replay reaches the fixture oracle", await replayPage.getByTestId("shortcut-result").textContent() === "Shortcut received: Control+S");
    await replayContext.close();
  } finally {
    await context?.close();
    await browser.close();
    if (server && !server.killed) server.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
