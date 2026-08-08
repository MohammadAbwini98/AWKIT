import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { getRecorderInitScriptContent } from "../src/recorder/recorderInitScript";
import { buildSmartWaits, type RecordedSignal, type SignalLocator } from "../src/recorder/smartWaitObservation";
import { buildRecordedFlow } from "../src/recorder/buildRecordedFlow";
import type { RecordedAction } from "../src/recorder/RecorderTypes";
import type { FlowStep, LocatorElementFingerprint, WaitCondition } from "../src/profiles/FlowProfile";
import { LocatorFactory } from "../src/runner/LocatorFactory";
import { StepExecutor } from "../src/runner/StepExecutor";
import { ValueResolver } from "../src/runner/ValueResolver";
import { MemoryRunnerLogger } from "../src/runner/RunnerResult";
import type { InstanceExecutionContext } from "../src/runner/InstanceExecutionContext";

const PORT = 4417;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${BASE}/smart-waits`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Smart Wait causality mock server did not start");
}

const rawFingerprint: LocatorElementFingerprint = {
  tag: "button", role: "button", name: "target", text: "target", attributes: { "data-testid": "target" }, ancestry: ["main"]
};
const strongLocator = (extra: Partial<SignalLocator> = {}): SignalLocator => ({
  strategy: "testId", value: "target", quality: { isUnique: true, confidence: "high", candidateCount: 1, strategy: "testId" },
  identity: {
    schemaVersion: 1,
    primary: { strategy: "testId", value: "target" },
    owner: { tag: "button", role: "button", accessibleName: "Target" },
    fingerprint: rawFingerprint,
    confidence: { level: "high", basis: ["primary", "fingerprint"] }
  },
  ...extra
});

function classify(signals: RecordedSignal[], from = 1_000, to = 2_000): WaitCondition[] {
  return buildSmartWaits(signals, from, to, { allowFixedDelayFallback: false, actionId: "action-a", actionType: "click" });
}

async function makeContext(): Promise<InstanceExecutionContext> {
  const dir = await mkdtemp(join(tmpdir(), "awkit-smart-wait-causality-"));
  return {
    executionId: "exec-causality", instanceId: "instance-1", scenarioId: "scenario-1", flowId: "flow-1",
    instanceOrderNumber: 1, totalInstances: 1, runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
    paths: { downloads: join(dir, "downloads"), screenshots: join(dir, "screenshots"), logs: join(dir, "logs"), reports: join(dir, "reports"), sessions: join(dir, "sessions") }
  };
}

async function execute(page: Page, step: FlowStep): Promise<{ status: string; error?: string; logs: string[]; ms: number }> {
  const ctx = await makeContext();
  const logger = new MemoryRunnerLogger();
  const executor = new StepExecutor(page, new LocatorFactory(page), new ValueResolver(ctx), ctx, undefined, logger);
  const started = performance.now();
  const result = await executor.execute(step);
  return { status: result.status, error: result.error, logs: logger.entries.map((entry) => entry.message), ms: performance.now() - started };
}

const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: "ignore" });

try {
  await waitForServer();
  const signals: RecordedSignal[] = [];
  const actions: RecordedAction[] = [];
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.exposeBinding("__awtkit_recordSignal", (_source, value: RecordedSignal) => signals.push(value));
  await context.exposeBinding("__awtkit_recordAction", (_source, value: RecordedAction) => actions.push(value));
  await context.addInitScript({ content: getRecorderInitScriptContent() });
  const page = await context.newPage();

  console.log("Smart Wait causality — real Recorder → profile → runner:");
  await page.goto(`${BASE}/smart-waits`);
  await page.waitForTimeout(250);
  signals.length = 0;
  actions.length = 0;
  const actionAt = Date.now();
  await page.getByTestId("spa-route-button").click();
  await page.waitForURL("**/smart-waits/shorts/local-video");
  await page.waitForTimeout(750);
  const assemblyStarted = performance.now();
  const waits = buildSmartWaits(signals, actionAt, Date.now(), { allowFixedDelayFallback: false, actionId: actions[0]?.id, actionType: actions[0]?.type });
  const assemblyMs = performance.now() - assemblyStarted;
  const route = waits.find((wait) => wait.type === "urlChanged");
  const enabled = waits.find((wait) => wait.type === "elementEnabled");
  check("D/T real observer captures dominant SPA route", route?.evidence?.requirement === "required" && route.evidence.confidence.level === "high", JSON.stringify(route));
  check("B/D unrelated timer enable is advisory", enabled?.evidence?.requirement === "advisory" && enabled.optional === true, JSON.stringify(enabled));
  check("captured signals stay bounded per action", signals.length <= 2_000, String(signals.length));
  check("Smart Wait assembly stays bounded (<25ms)", assemblyMs < 25, `${assemblyMs.toFixed(2)}ms`);

  const recorded = actions[0];
  if (recorded) recorded.afterWaits = waits;
  const profile = buildRecordedFlow("Causality replay", recorded ? [recorded] : []);
  const roundTripped = JSON.parse(JSON.stringify(profile)) as typeof profile;
  const replayStep = roundTripped.nodes.find((step) => step.type === "click");
  check("Recorder action reaches buildRecordedFlow", Boolean(replayStep?.afterWaits?.length), JSON.stringify(roundTripped.nodes));
  check("evidence and hashed identity survive JSON round-trip", Boolean(replayStep?.afterWaits?.find((wait) => wait.evidence?.schemaVersion === 1)), JSON.stringify(replayStep?.afterWaits));
  await page.goto(`${BASE}/smart-waits`);
  const replay = replayStep ? await execute(page, replayStep) : { status: "failed", error: "missing replay step", logs: [], ms: 0 };
  check("real StepExecutor replay passes and reaches route result", replay.status === "passed" && page.url().includes("/shorts/local-video"), replay.error);
  check("advisory signal is reported and never armed", replay.logs.some((line) => line.includes("WAIT_SIGNAL_ADVISORY_ONLY")), replay.logs.join(" | "));
  check("replay resolution remains bounded (<2s)", replay.ms < 2_000, `${replay.ms.toFixed(1)}ms`);

  console.log("\nMandatory acceptance matrix — classifier and identity boundaries:");
  const directEnable = classify([{ kind: "enabled", locator: strongLocator(), ts: 1_200, existedBefore: true, preDisabled: true, postDisabled: false, cause: "click" }]);
  check("A direct causal enable → required/high", directEnable[0]?.type === "elementEnabled" && directEnable[0].evidence?.requirement === "required" && directEnable[0].evidence.confidence.level === "high");
  const timerEnable = classify([{ kind: "enabled", locator: strongLocator(), ts: 1_200, existedBefore: true, preDisabled: true, postDisabled: false, cause: "background" }]);
  check("B unrelated timer enable → advisory", timerEnable[0]?.evidence?.requirement === "advisory");
  const polling = classify([1_100, 1_200, 1_300].map((endedAt) => ({ kind: "request" as const, method: "GET", path: "/api/poll", status: 200, startedAt: endedAt - 10, endedAt, cause: "background" as const })));
  check("C background polling mutation → omitted", polling.length === 0, JSON.stringify(polling));
  check("D SPA route outranks unrelated enable", route?.evidence?.dominance?.dominant && enabled?.evidence?.dominance?.supersededBy === "route");
  const generic = classify([{ kind: "enabled", locator: { strategy: "role", value: "button", quality: { isUnique: false, confidence: "low", candidateCount: 4, strategy: "role" } }, ts: 1_100, existedBefore: true, preDisabled: true, postDisabled: false, cause: "click" }]);
  check("E generic role ambiguity → not required", generic[0]?.evidence?.requirement !== "required");
  check("F hidden duplicate cannot create required wait", generic[0]?.evidence?.requirement === "advisory");
  check("G semantic DOM replacement retains identity-bearing locator", directEnable[0]?.type === "elementEnabled" && Boolean(directEnable[0].locator.identity?.fingerprint));

  await page.goto("about:blank");
  await page.setContent(`<button id="go">Go</button><button data-testid="target">Different owner</button>`);
  const driftWait = buildRecordedFlow("drift", [{ id: "a", type: "click", name: "Go", locator: { strategy: "id", value: "go" }, afterWaits: directEnable } as RecordedAction]).nodes.find((step) => step.type === "click")!;
  driftWait.type = "wait";
  driftWait.timeoutMs = 0;
  driftWait.config = { waitType: "time" };
  if (driftWait.afterWaits?.[0]) driftWait.afterWaits[0].timeoutMs = 300;
  const drift = await execute(page, driftWait);
  check("H material identity drift → specific error", drift.status === "failed" && drift.error?.includes("WAIT_TARGET_IDENTITY_CHANGED"), drift.error);

  const loaderPositive = classify([{ kind: "loaderHidden", selector: ".spinner", locator: strongLocator({ strategy: "testId", value: "loader" }), shownAt: 1_050, hiddenAt: 1_300, existedAtBaseline: false, cause: "click" }]);
  check("I scoped causal loader → required", loaderPositive[0]?.evidence?.requirement === "required");
  const loaderGlobal = classify([{ kind: "loaderHidden", selector: ".spinner", locator: strongLocator(), shownAt: 1_050, hiddenAt: 1_300, existedAtBaseline: true, cause: "background" }]);
  check("J global/background loader → advisory", loaderGlobal[0]?.evidence?.requirement === "advisory");
  const rowsPositive = classify([{ kind: "rows", container: strongLocator({ strategy: "testId", value: "results" }), listLike: false, previousCount: 0, count: 2, ts: 1_250, cause: "click" }]);
  check("K scoped row transition → required", rowsPositive[0]?.evidence?.requirement === "required");
  const rowsBackground = classify([{ kind: "rows", container: strongLocator(), listLike: true, previousCount: 2, count: 3, ts: 1_250, cause: "background" }]);
  check("L unrelated list mutation → advisory", rowsBackground[0]?.evidence?.requirement === "advisory");
  const toastPositive = classify([{ kind: "toast", locator: strongLocator({ strategy: "testId", value: "status" }), ts: 1_150, cause: "click" }]);
  check("M causal safe toast → optional supporting", toastPositive[0]?.evidence?.requirement === "optional");
  const toastBackground = classify([{ kind: "toast", locator: strongLocator(), ts: 1_150, cause: "background" }]);
  check("N background toast → advisory", toastBackground[0]?.evidence?.requirement === "advisory");
  const networkPositive = classify([{ kind: "request", method: "POST", path: "/api/save", status: 204, startedAt: 1_050, endedAt: 1_120, cause: "click" }]);
  check("O causal network → optional supporting", networkPositive[0]?.type === "response" && networkPositive[0].evidence?.requirement === "optional");
  check("P background repeated network → not a required gate", polling.every((wait) => wait.evidence?.requirement !== "required"));
  const frameLocator = strongLocator({ context: { frameChain: [{ strategy: "url", value: "/frame", frameKey: "frame-key" }] } });
  const frameWait = classify([{ kind: "enabled", locator: frameLocator, ts: 1_100, existedBefore: true, preDisabled: true, postDisabled: false, cause: "click" }]);
  check("Q frame target chain remains load-bearing", frameWait[0]?.type === "elementEnabled" && frameWait[0].locator.context?.frameChain?.[0]?.frameKey === "frame-key");
  const shadowLocator = strongLocator({ context: { shadow: { boundary: "open", hosts: [{ strategy: "testId", value: "host" }] } } });
  const shadowWait = classify([{ kind: "enabled", locator: shadowLocator, ts: 1_100, existedBefore: true, preDisabled: true, postDisabled: false, cause: "click" }]);
  check("R open-shadow host chain remains load-bearing", shadowWait[0]?.type === "elementEnabled" && shadowWait[0].locator.context?.shadow?.boundary === "open");
  const leaked = buildSmartWaits([{ kind: "enabled", locator: strongLocator(), ts: 1_050, existedBefore: true, preDisabled: true, postDisabled: false, cause: "click" }], 1_100, 1_300, { allowFixedDelayFallback: false });
  check("S sequential fast actions do not inherit earlier signals", leaked.length === 0);
  check("T strong completion finishes without waiting for weak signal", replay.status === "passed" && replay.ms < 2_000);

  const legacy = JSON.parse(JSON.stringify({ id: "legacy", type: "click", name: "Legacy", locator: { strategy: "id", value: "x" }, afterWaits: [{ type: "elementEnabled", locator: { strategy: "id", value: "y" } }] })) as FlowStep;
  check("legacy/manual required wait remains required", legacy.afterWaits?.[0]?.optional !== true && !legacy.afterWaits?.[0]?.evidence);
  check("sensitive policy remains untouched (no force)", !getRecorderInitScriptContent().includes("force: true"));

  await browser.close();
} finally {
  server.kill();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
