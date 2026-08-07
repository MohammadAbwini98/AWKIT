/**
 * Real-browser acceptance for Recorder action-owner normalization.
 *
 * It drives the exact injected capture script against the local Recorder Lab, rather than
 * constructing RecordedAction JSON directly. The saved flow is JSON-round-tripped before its
 * recorded click locator is replayed through the production StepExecutor.
 */
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

const PORT = 4387;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function waitForMockSite() {
  let lastError = "not started";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/recorder-lab`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mock Site did not start: ${lastError}`);
}

function replayContext(): InstanceExecutionContext {
  return {
    executionId: "custom-owner-exec",
    instanceId: "custom-owner-instance",
    scenarioId: "custom-owner-scenario",
    flowId: "custom-owner-flow",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: "", screenshots: "", logs: "", reports: "", sessions: "" }
  };
}

async function main() {
  let server: ChildProcess | undefined;
  let context: BrowserContext | undefined;
  const browser = await chromium.launch({ headless: true });
  try {
    server = spawn(process.execPath, ["mock-site/server.mjs"], {
      env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
      stdio: "ignore",
      windowsHide: true
    });
    await waitForMockSite();

    context = await browser.newContext();
    const captured: any[] = [];
    const recorder = new RecorderService() as any;
    recorder.isRecording = true;
    recorder.captureWaitTime = false;
    recorder.captureSmartWaits = false;
    recorder.actions = [];
    recorder.lastActionAt = 0;
    await context.exposeBinding("__awtkit_recordAction", (source, action) => {
      recorder.recordActionFromPage(source.page, action, source.frame);
      const stored = recorder.getAmbiguityState()?.action ?? recorder.getActions().at(-1);
      if (stored) captured.push(stored);
    });
    await context.addInitScript({ content: getRecorderInitScriptContent() });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/recorder-lab`, { waitUntil: "domcontentloaded" });

    async function capture(testId: string) {
      captured.length = 0;
      recorder.actions = [];
      recorder.ambiguityState = null;
      recorder.isRecording = true;
      recorder.lastActionAt = 0;
      await page.evaluate(() => {
        document.addEventListener("click", (event) => {
          const leaf = event.composedPath().find((item) => item instanceof Element) as Element | undefined;
          (window as any).__customOwnerRawLeaf = leaf?.tagName.toLowerCase() ?? "";
        }, { capture: true, once: true });
      });
      await page.getByTestId(testId).click({ force: true });
      await page.waitForTimeout(50);
      return { action: captured.at(-1), rawLeaf: await page.evaluate(() => (window as any).__customOwnerRawLeaf) };
    }

    console.log("Recorder action-owner capture");
    const subscriptions = await capture("custom-owner-subscriptions-icon");
    const subscriptionsLocator = subscriptions.action?.locator;
    check("nested link click begins at the inner SVG leaf", subscriptions.rawLeaf === "svg", String(subscriptions.rawLeaf));
    check("nested link click normalizes to its named link", subscriptionsLocator?.strategy === "role" && subscriptionsLocator?.value === "link" && subscriptionsLocator?.name === "Subscriptions", JSON.stringify(subscriptions.action));
    check("nested link owner wins with high unique quality", subscriptionsLocator?.quality?.isUnique === true && subscriptionsLocator?.quality?.matchCount === 1 && subscriptionsLocator?.quality?.confidence === "high", JSON.stringify(subscriptionsLocator?.quality));
    check("nested link needs no manual review or positional selector", subscriptionsLocator?.resolution !== "needs-review" && !subscriptionsLocator?.reviewReason && !/#icon|x-nav-icon|:nth-/.test(String(subscriptionsLocator?.value)), JSON.stringify(subscriptionsLocator));

    const settings = await capture("custom-owner-settings-icon");
    check("nested button click normalizes to its named button", settings.action?.locator?.strategy === "role" && settings.action?.locator?.value === "button" && settings.action?.locator?.name === "Open settings", JSON.stringify(settings.action));

    const command = await capture("custom-owner-command-inner");
    check("explicit actionable custom control remains the owner", command.action?.locator?.strategy === "testId" && command.action?.locator?.value === "custom-owner-command", JSON.stringify(command.action));

    const bare = await capture("custom-owner-bare-inner");
    check("bare custom control remains a conservative custom-element fallback", bare.action?.locator?.strategy === "testId" && bare.action?.locator?.value === "custom-owner-bare", JSON.stringify(bare.action));

    const ambiguous = await capture("custom-owner-ambiguous-icon");
    check("duplicate semantic owners are promoted but remain review-required", ambiguous.action?.locator?.resolution === "needs-review" && ambiguous.action?.locator?.alternatives?.some((candidate: any) => candidate.strategy === "role" && candidate.value === "button" && candidate.name === "Duplicate owner"), JSON.stringify(ambiguous.action));

    const flow = buildRecordedFlow("Custom owner replay", [{ type: "click", name: subscriptions.action?.name, locator: subscriptionsLocator }] as any[]);
    const reloaded = JSON.parse(JSON.stringify(flow));
    const savedClick = reloaded.nodes.find((node: FlowStep) => node.type === "click") as FlowStep | undefined;
    check("built flow preserves the semantic locator through save/reload", savedClick?.locator?.strategy === "role" && savedClick.locator.name === "Subscriptions" && savedClick.locator.resolution === "resolved", JSON.stringify(savedClick?.locator));

    const replayBrowserContext = await browser.newContext();
    const replayPage = await replayBrowserContext.newPage();
    await replayPage.goto(`${BASE_URL}/recorder-lab`, { waitUntil: "domcontentloaded" });
    await replayPage.evaluate(() => {
      const target = document.querySelector('a[href="#custom-subscriptions"]');
      if (!target) throw new Error("Custom-owner replay target is missing.");
      target.addEventListener("click", (event) => {
        event.preventDefault();
        document.querySelector('[data-testid="custom-owner-result"]')!.textContent = "Replayed subscriptions";
      });
    });
    const executionContext = replayContext();
    const executor = new StepExecutor(replayPage, new LocatorFactory(replayPage), new ValueResolver(executionContext), executionContext);
    const replay = savedClick ? await executor.execute(savedClick) : { status: "failed", error: "Missing saved click" };
    check("saved semantic locator replays through StepExecutor", replay.status === "passed", replay.error ?? replay.status);
    await replayPage.waitForTimeout(50);
    const replayResult = await replayPage.getByTestId("custom-owner-result").textContent();
    check("replay reaches the intended observable result", replayResult === "Replayed subscriptions", String(replayResult));
    await replayBrowserContext.close();
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
