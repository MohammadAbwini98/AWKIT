/**
 * Artifact-lifecycle verification (local Chromium + temp dirs; no external websites).
 * Run with: npx tsx scripts/verify-artifacts.mts
 *
 * Proves: JSONL run logs for success + failure events, run-state artifact files, failure
 * screenshots by default, per-step failure TRACE zips (saved before any cleanup, discarded on
 * success), trace-save failures never masking the step error, and node attempts carrying
 * trace/error-class/URL context.
 */
import { chromium } from "playwright";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocatorFactory } from "@src/runner/LocatorFactory";
import { ValueResolver } from "@src/runner/ValueResolver";
import { StepExecutor } from "@src/runner/StepExecutor";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import { TraceService } from "@src/runner/artifacts/TraceService";
import { PassiveCdpTrace } from "@src/runner/observation/PassiveCdpTrace";
import { RunLogger } from "@src/runner/artifacts/RunLogger";
import { writeRunStateArtifacts } from "@src/runner/artifacts/RunStateArtifacts";
import { NodeAttemptLog } from "@src/runner/runtime/NodeAttempt";
import { FlowRunStateMachine } from "@src/runner/runtime/RuntimeStateMachine";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("Artifact-lifecycle verification");
  const root = await mkdtemp(join(tmpdir(), "wfs-artifacts-"));
  const traceDir = join(root, "traces");

  const context = {
    executionId: "e-art",
    instanceId: "i-art",
    scenarioId: "s-art",
    flowId: "flow-art",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: {
      downloads: join(root, "downloads"),
      screenshots: join(root, "screenshots"),
      logs: join(root, "logs", "run.jsonl"),
      reports: join(root, "r.json"),
      traces: traceDir
    }
  } as unknown as InstanceExecutionContext;

  console.log("\nPart A — JSONL logs for success and failure");
  const logger = new RunLogger(context.paths.logs);
  logger.log({ runId: "e-art", workerId: "i-art", event: "step.succeeded", nodeId: "n1", message: "ok" });
  logger.log({ runId: "e-art", workerId: "i-art", event: "step.failed", nodeId: "n2", message: "boom", errorStack: "Error: boom" });
  logger.log({ runId: "e-art", workerId: "i-art", event: "instance.end", message: "done" });
  await logger.flush();
  const lines = (await readFile(context.paths.logs, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  check("success + failure + end events logged as JSONL", lines.length === 3 && lines[0].event === "step.succeeded" && lines[1].event === "step.failed");
  check("every line has timestamp + runId", lines.every((line) => line.timestamp && line.runId === "e-art"));

  console.log("\nPart B — live failure trace + default failure screenshot (real Chromium)");
  const browser = await chromium.launch({ headless: true });
  const browserContext = await browser.newContext();
  const page = await browserContext.newPage();

  const traceService = new TraceService(traceDir, "onFailure", () => undefined);
  await traceService.attach(browserContext);
  const stepExecutor = new StepExecutor(
    page,
    new LocatorFactory(page),
    new ValueResolver(context),
    context,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    traceService
  );

  // Successful step: trace chunk must be discarded (no zip written).
  const okStep: FlowStep = { id: "ok-goto", type: "goto", name: "Open blank", url: "about:blank" } as FlowStep;
  const okResult = await stepExecutor.execute(okStep);
  const tracesAfterSuccess = await readdir(traceDir).catch(() => []);
  check("successful step passes with no trace file", okResult.status === "passed" && okResult.tracePath === undefined && tracesAfterSuccess.length === 0);

  // Failing step (local connection refused — deterministic, offline).
  const failStep: FlowStep = { id: "fail-goto", type: "goto", name: "Open refused port", url: "http://127.0.0.1:9", timeoutMs: 5_000 } as FlowStep;
  const failResult = await stepExecutor.execute(failStep);
  check("failing step reports failed with error", failResult.status === "failed" && !!failResult.error);
  check("failure trace zip saved for the attempt", !!failResult.tracePath && failResult.tracePath!.startsWith(traceDir), failResult.tracePath);
  const traceStat = failResult.tracePath ? await stat(failResult.tracePath).catch(() => null) : null;
  check("trace file exists and is non-empty", traceStat !== null && traceStat.size > 0);

  // Default failure screenshot via FlowExecutor (no onFailure config on the step).
  const flow = {
    id: "flow-art",
    name: "Artifact flow",
    nodes: [
      { id: "start", type: "start", name: "Start" },
      { id: "fail-goto-2", type: "goto", name: "Open refused port", url: "http://127.0.0.1:9", timeoutMs: 5_000 },
      { id: "end", type: "end", name: "End" }
    ],
    edges: [
      { id: "e1", source: "start", target: "fail-goto-2", type: "success" },
      { id: "e2", source: "fail-goto-2", target: "end", type: "success" }
    ]
  } as unknown as FlowProfile;
  const flowResult = await new FlowExecutor(stepExecutor).executeFlow(flow, context);
  const failedStepResult = flowResult.steps.find((step) => step.stepId === "fail-goto-2");
  check("flow failed on the failing node", flowResult.status === "failed");
  check("failure screenshot captured by default (no onFailure config)", !!failedStepResult?.screenshotPath, JSON.stringify(failedStepResult));
  const screenshotStat = failedStepResult?.screenshotPath ? await stat(failedStepResult.screenshotPath).catch(() => null) : null;
  check("screenshot file exists", screenshotStat !== null && screenshotStat.size > 0);

  // Trace-save failure must not mask the step error: close the context, then fail a step.
  await browserContext.close();
  const deadResult = await stepExecutor.execute(failStep);
  check("trace problems never mask the original failure", deadResult.status === "failed" && !!deadResult.error);
  await browser.close();

  console.log("\nPart C — run-state artifacts");
  const machine = new FlowRunStateMachine("queued");
  machine.transition("running");
  machine.transition("failed", "boom");
  const attempts = new NodeAttemptLog();
  attempts.finish(attempts.start({ runId: "e-art", nodeId: "fail-goto" }), "failedTerminal", {
    error: "net::ERR_CONNECTION_REFUSED",
    errorClass: "navigation",
    tracePath: failResult.tracePath,
    currentUrl: "http://127.0.0.1/"
  });
  const stateDir = join(root, "state");
  const artifactError = await writeRunStateArtifacts(stateDir, {
    runId: "e-art",
    instanceId: "i-art",
    scenarioId: "s-art",
    flowRunStatus: machine.status,
    transitions: machine.transitions,
    nodeAttempts: attempts.list(),
    locks: [],
    error: "boom"
  });
  check("state artifacts written without error", artifactError === undefined);
  const stateFiles = await readdir(stateDir);
  check("flow-state + node-attempts + locks files exist", ["flow-state.json", "node-attempts.json", "locks.json"].every((name) => stateFiles.includes(name)));
  const attemptsJson = JSON.parse(await readFile(join(stateDir, "node-attempts.json"), "utf8"));
  check(
    "node attempt carries error class, trace path, and URL",
    attemptsJson[0].errorClass === "navigation" && attemptsJson[0].tracePath === failResult.tracePath && attemptsJson[0].currentUrl === "http://127.0.0.1/"
  );

  console.log("\nPart D — passive second-client CDP trace + bounded visual retention");
  const observationRoot = join(root, "observation");
  const observationBrowser = await chromium.launch({ headless: true });
  const observedContext = await observationBrowser.newContext();
  const observedPage = await observedContext.newPage();
  const observation = new PassiveCdpTrace({
    root: observationRoot,
    executionId: "e-art",
    instanceId: "i-art",
    scenarioId: "s-art",
    sampleIntervalMs: 60_000,
    maxRawBytes: 4_096,
    maxSamples: 2
  });
  await observation.startGeneration({ context: observedContext }, 1);
  await observedPage.setContent(
    `<button id="observed-action" onclick="window.__observedHit='yes'">Run observed action</button>`
  );
  const observedExecutor = new StepExecutor(
    observedPage,
    new LocatorFactory(observedPage),
    new ValueResolver(context),
    context
  );
  const observedResult = await observedExecutor.execute({
    id: "observed-click",
    type: "click",
    name: "Click through primary Playwright client",
    locator: { strategy: "id", value: "observed-action" }
  } as FlowStep);
  check(
    "second CDP client does not interfere with the runner action",
    observedResult.status === "passed" &&
      (await observedPage.evaluate(() => (window as any).__observedHit)) === "yes",
    observedResult.error
  );

  const secretCanary = "CDP-SECRET-CANARY-4A6";
  await observedPage.evaluate((secret) =>
    fetch(`http://127.0.0.1:9/observation-probe?token=${encodeURIComponent(secret)}`, {
      method: "POST",
      headers: { "x-api-key": secret },
      body: secret
    }).catch(() => undefined), secretCanary);
  await observedPage.evaluate((secret) => {
    for (let index = 0; index < 20; index += 1) console.log(secret, "x".repeat(300), index);
  }, secretCanary);
  await observedPage.waitForTimeout(150);
  await observation.sampleNow();
  await observation.sampleNow();
  await observation.sampleNow();
  await observation.stop();
  await observedContext.close();
  await observationBrowser.close();

  const observationFiles = await readdir(observationRoot);
  check(
    "observation trace writes manifest, index, root summary, CDP, screenshots, and DOM folders",
    ["manifest.json", "index.jsonl", "summary.json", "cdp", "screenshots", "dom"].every((name) =>
      observationFiles.includes(name)
    ),
    observationFiles.join(", ")
  );
  const observationManifest = JSON.parse(await readFile(join(observationRoot, "manifest.json"), "utf8"));
  check(
    "manifest records the read-only domains and bounded policy",
    ["Network", "Console", "Runtime", "Log", "Page"].every((domain) =>
      observationManifest.domains.includes(domain)
    ) &&
      observationManifest.captureDom === false &&
      observationManifest.maxRawBytes === 4_096 &&
      observationManifest.maxSamples === 2,
    JSON.stringify(observationManifest)
  );
  const rawTrace = await readFile(join(observationRoot, "cdp", "raw.ndjson"), "utf8");
  const rawRecords = rawTrace
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as any);
  const sanitizedProbe = rawRecords.find(
    (entry) =>
      entry.method === "Network.requestWillBeSent" &&
      entry.params?.request?.url === "http://127.0.0.1:9/observation-probe"
  );
  check(
    "raw CDP firehose captures the probe while redacting URL, headers, body, and console values",
    Boolean(sanitizedProbe) &&
      sanitizedProbe.params.request.postData === "[REDACTED]" &&
      sanitizedProbe.params.request.headers?.["x-api-key"] === "[REDACTED]" &&
      !rawTrace.includes(secretCanary)
  );
  check(
    "raw trace stops at the configured byte cap and reports truncation",
    (await stat(join(observationRoot, "cdp", "raw.ndjson"))).size <= 4_096 &&
      observation.snapshot().truncated,
    JSON.stringify(observation.snapshot())
  );
  const retainedScreenshots = await readdir(join(observationRoot, "screenshots"));
  const retainedIndex = (await readFile(join(observationRoot, "index.jsonl"), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean);
  check(
    "visual retention keeps at most the configured samples and matching index rows",
    retainedScreenshots.length > 0 &&
      retainedScreenshots.length <= 2 &&
      retainedIndex.length === retainedScreenshots.length,
    `${retainedScreenshots.length} screenshots / ${retainedIndex.length} index rows`
  );
  check(
    "live-view snapshot is an in-memory PNG data URL",
    observation.snapshot().screenshotDataUrl?.startsWith("data:image/png;base64,") === true
  );
  const domFiles = await readdir(join(observationRoot, "dom"));
  check("DOM capture is opt-in and stays empty by default", domFiles.length === 0, domFiles.join(", "));
  const cdpSummary = JSON.parse(await readFile(join(observationRoot, "cdp", "summary.json"), "utf8"));
  check(
    "summary is the analysis entry point with page and bucket counts",
    cdpSummary.eventCount > 0 && Array.isArray(cdpSummary.pages) && cdpSummary.buckets["console/logs"] > 0,
    JSON.stringify(cdpSummary)
  );
  check(
    "predictable session buckets exist even when empty",
    (
      await Promise.all(
        [
          "network/requests.jsonl",
          "console/logs.jsonl",
          "runtime/all.jsonl",
          "page/navigations.jsonl",
          "target/attached.jsonl",
          "target/detached.jsonl"
        ].map((relative) => stat(join(observationRoot, "cdp", relative)).then(() => true).catch(() => false))
      )
    ).every(Boolean)
  );

  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-artifacts crashed:", error);
  process.exit(1);
});
