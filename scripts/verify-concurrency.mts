/**
 * Verification of the concurrency & stability layer.
 * Run with: npx tsx scripts/verify-concurrency.mts
 *
 * Covers: resource locks (exclusive/shared/semaphore, atomic multi-acquire, TTL + fencing),
 * semaphore capacity/FIFO/timeout, browser pool saturation + health + crash window,
 * backpressure admission, retry policy + error classifier (incl. the dangerous-mutation
 * guard), runtime state machines, node attempts, watchdog stale/orphan detection, the JSONL
 * run logger, FlowExecutor classified-retry integration (stubbed step executor), and a live
 * BrowserContextFactory profile-lock + cleanup check with real Chromium.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResourceLockManager } from "@src/runner/concurrency/ResourceLockManager";
import { profileKey, downloadDirKey } from "@src/runner/concurrency/ResourceKey";
import { Semaphore } from "@src/runner/concurrency/Semaphore";
import { BrowserWorkerPool } from "@src/runner/browser/BrowserWorkerPool";
import { BackpressureController } from "@src/runner/concurrency/BackpressureController";
import { loadConcurrencyLimits } from "@src/runner/concurrency/ConcurrencyConfig";
import { classifyError, isDangerousMutationStep } from "@src/runner/runtime/ErrorClassifier";
import { RetryPolicy } from "@src/runner/runtime/RetryPolicy";
import { FlowRunStateMachine, canTransitionNode } from "@src/runner/runtime/RuntimeStateMachine";
import { NodeAttemptLog } from "@src/runner/runtime/NodeAttempt";
import { WatchdogService, type WatchdogFinding, type WatchdogInstanceView } from "@src/runner/runtime/WatchdogService";
import { RunLogger } from "@src/runner/artifacts/RunLogger";
import { writeRunStateArtifacts } from "@src/runner/artifacts/RunStateArtifacts";
import { ProfileLockedError } from "@src/profiles/ProfileLockManager";
import { BrowserContextFactory } from "@src/runner/BrowserContextFactory";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import type { StepExecutor } from "@src/runner/StepExecutor";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { InstanceConfig } from "@src/instances/InstanceConfig";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── A. ResourceLockManager ───────────────────────────────────────────────────
async function partA(): Promise<void> {
  console.log("\nPart A — ResourceLockManager");
  const locks = new ResourceLockManager({ "origin:example.test": 2 });

  // Exclusive profile lock: no double acquire.
  const key = profileKey("C:\\Users\\x\\Profiles\\p1");
  const a = locks.tryAcquire("inst-1", { key, mode: "exclusive" });
  check("exclusive profile lock acquired", a !== null);
  check("same profile cannot be acquired twice", locks.tryAcquire("inst-2", { key, mode: "exclusive" }) === null);
  check("path normalization collides same dir", locks.tryAcquire("inst-3", { key: profileKey("c:/users/x/profiles/p1/"), mode: "exclusive" }) === null);
  locks.releaseMany([a!]);
  check("released profile lock is re-acquirable", locks.tryAcquire("inst-2", { key, mode: "exclusive" }) !== null);

  // Download dir exclusivity.
  const dl = downloadDirKey("D:\\runs\\r1\\downloads");
  const dlTok = locks.tryAcquire("inst-1", { key: dl, mode: "exclusive" });
  check("download dir lock exclusive", dlTok !== null && locks.tryAcquire("inst-2", { key: dl, mode: "exclusive" }) === null);

  // Shared mode.
  const s1 = locks.tryAcquire("r1", { key: "flow:shared-read", mode: "shared" });
  const s2 = locks.tryAcquire("r2", { key: "flow:shared-read", mode: "shared" });
  check("shared mode allows multiple readers", s1 !== null && s2 !== null);
  check("mixed mode on shared key denied", locks.tryAcquire("w1", { key: "flow:shared-read", mode: "exclusive" }) === null);

  // Semaphore capacity (configured 2 for origin:example.test).
  const sem1 = locks.tryAcquire("o1", { key: "origin:example.test", mode: "semaphore" });
  const sem2 = locks.tryAcquire("o2", { key: "origin:example.test", mode: "semaphore" });
  const sem3 = locks.tryAcquire("o3", { key: "origin:example.test", mode: "semaphore" });
  check("semaphore capacity honored (2 of 3)", sem1 !== null && sem2 !== null && sem3 === null);
  locks.releaseMany([sem1!]);
  check("semaphore unit freed on release", locks.tryAcquire("o3", { key: "origin:example.test", mode: "semaphore" }) !== null);

  // Atomic multi-acquire: all-or-nothing.
  const held = locks.tryAcquire("holder", { key: "account:acme", mode: "exclusive" });
  const multi = locks.tryAcquireMany("wanter", [
    { key: "account:fresh", mode: "exclusive" },
    { key: "account:acme", mode: "exclusive" }
  ]);
  check("multi-acquire is atomic (null on partial conflict)", held !== null && multi === null);
  check("no partial grant leaked", !locks.isHeld("account:fresh"));

  // TTL expiry + fencing.
  const ttlTok = locks.tryAcquire("ttl-owner", { key: "instance:ttl", mode: "exclusive", ttlMs: 40 });
  check("ttl lease acquired", ttlTok !== null);
  await sleep(80);
  const swept = locks.cleanupStale();
  check("stale lease swept after ttl", swept.some((t) => t.key === "instance:ttl"));
  const successor = locks.tryAcquire("new-owner", { key: "instance:ttl", mode: "exclusive" });
  check("key re-acquirable after sweep", successor !== null);
  locks.releaseMany([ttlTok!]); // stale owner's release must NOT evict the new holder (fencing)
  check("fencing: stale release ignored", locks.isHeld("instance:ttl") && locks.holdersOf("instance:ttl")[0] === "new-owner");

  // withLocks releases in finally even on throw.
  let threw = false;
  try {
    await locks.withLocks("wl-owner", [{ key: "flow:wl", mode: "exclusive" }], async () => {
      check("withLocks holds inside fn", locks.isHeld("flow:wl"));
      throw new Error("boom");
    });
  } catch {
    threw = true;
  }
  check("withLocks releases in finally on throw", threw && !locks.isHeld("flow:wl"));

  // Snapshot.
  const snapshot = locks.snapshot();
  check("snapshot lists held keys with owners", snapshot.some((e) => e.key === "instance:ttl" && e.holders[0]?.ownerId === "new-owner"));
}

// ── B. Semaphore ─────────────────────────────────────────────────────────────
async function partB(): Promise<void> {
  console.log("\nPart B — Semaphore");
  const sem = new Semaphore(1);
  check("tryAcquire within capacity", sem.tryAcquire());
  check("tryAcquire over capacity fails", !sem.tryAcquire());

  let secondResolved = false;
  const secondAcquire = sem.acquire().then(() => {
    secondResolved = true;
  });
  let timedOut = false;
  await sem.acquire(1, 50).catch(() => {
    timedOut = true;
  });
  check("acquire timeout rejects", timedOut);
  check("waiter not resolved before release", !secondResolved);
  sem.release();
  await secondAcquire;
  check("FIFO waiter resolved on release", secondResolved);
  sem.release(); // free the FIFO waiter's permit before the withPermit case below

  let releasedAfterError = false;
  await sem
    .withPermit(async () => {
      throw new Error("x");
    })
    .catch(() => undefined);
  releasedAfterError = sem.tryAcquire();
  check("withPermit releases on error", releasedAfterError);
  sem.release();
}

// ── C. BrowserWorkerPool ─────────────────────────────────────────────────────
async function partC(): Promise<void> {
  console.log("\nPart C — BrowserWorkerPool");
  const pool = new BrowserWorkerPool({ maxBrowsersPerHost: 2, crashWindowMs: 60_000 });
  const s1 = pool.tryAcquireSlot("i1");
  const s2 = pool.tryAcquireSlot("i2");
  const s3 = pool.tryAcquireSlot("i3");
  check("pool grants up to maxBrowsersPerHost", s1 !== null && s2 !== null);
  check("pool refuses work when saturated", s3 === null);
  check("snapshot reflects saturation", pool.snapshot().activeSlots === 2 && pool.snapshot().totalRejected === 1);

  pool.markUnhealthy(s2!, "browser disconnected");
  check("unhealthy slot recorded with reason", s2!.unhealthy && s2!.unhealthyReason === "browser disconnected");
  check("crash window counts the disconnect", pool.recentCrashCount() === 1);

  pool.releaseSlot(s1!);
  pool.releaseSlot(s1!); // double release must be safe
  check("released slot frees capacity (double-release safe)", pool.tryAcquireSlot("i4") !== null);
}

// ── D. BackpressureController ────────────────────────────────────────────────
async function partD(): Promise<void> {
  console.log("\nPart D — BackpressureController");
  const base = { minFreeMemoryMb: 0, maxRecentCrashes: 5, crashWindowMs: 60_000 };

  const satPool = new BrowserWorkerPool({ ...base, maxBrowsersPerHost: 1 });
  satPool.tryAcquireSlot("i1");
  const satBp = new BackpressureController(satPool);
  const satDecision = satBp.admit(1, 3);
  check("blocks when browser pool saturated", !satDecision.allow && /pool saturated/.test(satDecision.reason ?? ""));
  check("capacity snapshot exposes blocked state + reason", satBp.snapshot(1, 3).dispatchBlocked && satBp.snapshot(1, 3).blockedReason !== undefined);

  const flowPool = new BrowserWorkerPool({ ...base, maxBrowsersPerHost: 8, maxActiveFlows: 2 });
  const flowBp = new BackpressureController(flowPool);
  check("blocks at maxActiveFlows", !flowBp.admit(2, 0).allow);
  check("allows under all limits", flowBp.admit(1, 0).allow);

  const memPool = new BrowserWorkerPool({ ...base, maxBrowsersPerHost: 8, minFreeMemoryMb: 100_000_000 });
  const memBp = new BackpressureController(memPool);
  const memDecision = memBp.admit(0, 0);
  check("blocks on low host memory", !memDecision.allow && /low host memory/.test(memDecision.reason ?? ""));

  const crashPool = new BrowserWorkerPool({ ...base, maxBrowsersPerHost: 8, maxRecentCrashes: 0 });
  const crashSlot = crashPool.tryAcquireSlot("c1");
  crashPool.markUnhealthy(crashSlot!, "page crashed");
  crashPool.releaseSlot(crashSlot!);
  const crashBp = new BackpressureController(crashPool);
  const crashDecision = crashBp.admit(0, 0);
  check("blocks on high crash rate", !crashDecision.allow && /crash rate/.test(crashDecision.reason ?? ""));
}

// ── E. ErrorClassifier + RetryPolicy ─────────────────────────────────────────
async function partE(): Promise<void> {
  console.log("\nPart E — ErrorClassifier + RetryPolicy");
  check("classifies timeout", classifyError("Timeout 30000ms exceeded.") === "timeout");
  check("classifies locator strict-mode", classifyError('strict mode violation: locator("button") resolved to 3 elements') === "locator");
  check("classifies closed target as context-closed", classifyError("Target page, context or browser has been closed") === "context-closed");
  check("classifies navigation failure", classifyError("page.goto: net::ERR_CONNECTION_REFUSED at http://x/") === "navigation");
  check("classifies profile lock", classifyError(new Error("ProfileLockedError: The saved session profile is already in use by another running instance in this app (profile: x)")) === "profile-locked");
  check("classifies manual handoff", classifyError("Manual action is required before this run can continue.") === "manual-action-required");

  check("dangerous mutation detected (Submit Order)", isDangerousMutationStep({ type: "click", name: "Click Submit Order" }));
  check("dangerous mutation detected (payment)", isDangerousMutationStep({ type: "click", name: "Confirm payment" }));
  check("read step not dangerous", !isDangerousMutationStep({ type: "click", name: "Open reports" }));
  check("non-mutating type not dangerous", !isDangerousMutationStep({ type: "goto", name: "Go to submit page" }));

  const policy = new RetryPolicy({ initialDelayMs: 100, backoffCoefficient: 2, maxDelayMs: 1000 });
  const retryable = policy.decide({ step: { type: "click", name: "Open list", retry: { count: 3 } }, error: "Timeout 5000ms exceeded", attempt: 0 });
  check("retryable timeout allowed", retryable.retry && retryable.errorClass === "timeout");
  const backoff2 = policy.decide({ step: { type: "click", name: "Open list", retry: { count: 3 } }, error: "Timeout 5000ms exceeded", attempt: 2 });
  check("exponential backoff grows", backoff2.delayMs === 400);
  const exhausted = policy.decide({ step: { type: "click", name: "Open list", retry: { count: 2 } }, error: "Timeout", attempt: 2 });
  check("retries exhausted at configured count", !exhausted.retry && /exhausted/.test(exhausted.reason));
  const dangerous = policy.decide({ step: { type: "click", name: "Submit order", retry: { count: 3 } }, error: "Timeout", attempt: 0 });
  check("dangerous step never auto-retried", !dangerous.retry && dangerous.errorClass === "dangerous-side-effect");
  const dead = policy.decide({ step: { type: "click", name: "Open list", retry: { count: 3 } }, error: "Target page, context or browser has been closed", attempt: 0 });
  check("dead browser/context not retried", !dead.retry);
}

// ── F. Runtime state machines + NodeAttemptLog ───────────────────────────────
async function partF(): Promise<void> {
  console.log("\nPart F — Runtime state machines + node attempts");
  const machine = new FlowRunStateMachine("queued");
  machine.transition("running", "start");
  machine.transition("waitingForManualAction", "handoff");
  machine.transition("running", "resumed");
  machine.transition("completed", "done");
  check("legal flow transitions applied", machine.status === "completed" && machine.isTerminal);
  check("transitions recorded with reasons", machine.transitions.length === 4 && machine.transitions[1].reason === "handoff");

  const forcedMachine = new FlowRunStateMachine("completed");
  const forced = forcedMachine.transition("running", "impossible");
  check("illegal transition flagged as forced (not thrown)", forced.applied && forced.forced);

  check("node transition running→failedRetryable legal", canTransitionNode("running", "failedRetryable"));
  check("node transition succeeded→running illegal", !canTransitionNode("succeeded", "running"));

  const log = new NodeAttemptLog();
  const attempt = log.start({ runId: "r1", flowId: "f1", nodeId: "n1", workerId: "i1", browserWorkerId: "bw-1" });
  log.heartbeat(attempt);
  log.finish(attempt, "failedRetryable", { error: "Timeout", errorClass: "timeout" });
  const second = log.start({ runId: "r1", flowId: "f1", nodeId: "n1", tryNumber: 2, workerId: "i1" });
  log.finish(second, "succeeded");
  const entries = log.list();
  check("every attempt has explicit ids and status", entries.length === 2 && entries[0].attemptId !== entries[1].attemptId);
  check("failed attempt carries error + class + duration", entries[0].status === "failedRetryable" && entries[0].errorClass === "timeout" && entries[0].durationMs !== undefined);
  check("retry recorded as separate attempt (tryNumber 2)", entries[1].tryNumber === 2 && entries[1].status === "succeeded");
}

// ── G. WatchdogService ───────────────────────────────────────────────────────
async function partG(): Promise<void> {
  console.log("\nPart G — WatchdogService");
  const locks = new ResourceLockManager();
  locks.tryAcquire("dead-owner", { key: "instance:dead", mode: "exclusive", ttlMs: 1 });
  await sleep(10);
  const now = Date.now(); // after the TTL lease above has expired
  const views: WatchdogInstanceView[] = [
    { instanceId: "ok", executionId: "e", status: "running", heartbeatAt: new Date(now - 1000).toISOString(), runnerActive: true },
    { instanceId: "stale", executionId: "e", status: "running", heartbeatAt: new Date(now - 10 * 60_000).toISOString(), runnerActive: true },
    { instanceId: "orphan", executionId: "e", status: "running", heartbeatAt: new Date(now - 1000).toISOString(), runnerActive: false },
    { instanceId: "done", executionId: "e", status: "completed", runnerActive: false }
  ];
  const findings: WatchdogFinding[] = [];
  const logs: string[] = [];

  const watchdog = new WatchdogService(
    { listActiveInstances: () => views, onFinding: (f) => findings.push(f), log: (m) => logs.push(m) },
    { staleHeartbeatMs: 120_000, watchdogIntervalMs: 15_000 },
    locks
  );

  const first = watchdog.scan(now);
  check("stale heartbeat detected", first.some((f) => f.instanceId === "stale" && f.kind === "staleHeartbeat"));
  check("orphaned instance detected", first.some((f) => f.instanceId === "orphan" && f.kind === "orphaned"));
  check("healthy + terminal instances untouched", !first.some((f) => f.instanceId === "ok" || f.instanceId === "done"));
  check("watchdog logs exact reason", logs.some((l) => l.includes("no heartbeat for")) && logs.some((l) => l.includes("no active runner promise")));
  check("stale lock swept and logged", !locks.isHeld("instance:dead") && logs.some((l) => l.includes("released stale lock instance:dead")));

  const second = watchdog.scan(now + 1000);
  check("findings deduped across scans", second.length === 0);
  watchdog.clearInstance("stale");
  const third = watchdog.scan(now + 2000);
  check("cleared instance re-evaluated", third.some((f) => f.instanceId === "stale"));
}

// ── H. RunLogger + state artifacts ───────────────────────────────────────────
async function partH(): Promise<void> {
  console.log("\nPart H — RunLogger + run state artifacts");
  const dir = await mkdtemp(join(tmpdir(), "wfs-conc-log-"));
  const file = join(dir, "logs", "inst.jsonl");
  const logger = new RunLogger(file);
  logger.log({ runId: "r1", workerId: "i1", event: "instance.start", message: "started" });
  logger.log({ runId: "r1", workerId: "i1", nodeId: "n1", event: "step.failed", message: "boom", errorStack: "Error: boom\n  at x" });
  await logger.flush();
  const lines = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  check("JSONL log written (one JSON object per line)", lines.length === 2);
  check("log lines carry ids + event + timestamp", lines[1].runId === "r1" && lines[1].nodeId === "n1" && lines[1].event === "step.failed" && typeof lines[0].timestamp === "string");

  const machine = new FlowRunStateMachine("queued");
  machine.transition("running");
  machine.transition("failed", "boom");
  const attempts = new NodeAttemptLog();
  attempts.finish(attempts.start({ runId: "r1", nodeId: "n1" }), "failedTerminal", { error: "boom" });
  const stateDir = join(dir, "state");
  const artifactError = await writeRunStateArtifacts(stateDir, {
    runId: "r1",
    instanceId: "i1",
    flowRunStatus: machine.status,
    transitions: machine.transitions,
    nodeAttempts: attempts.list(),
    locks: [],
    error: "boom"
  });
  const flowState = JSON.parse(await readFile(join(stateDir, "flow-state.json"), "utf8"));
  const nodeAttempts = JSON.parse(await readFile(join(stateDir, "node-attempts.json"), "utf8"));
  check("flow-state.json written with transitions", artifactError === undefined && flowState.status === "failed" && flowState.transitions.length === 2);
  check("node-attempts.json written", nodeAttempts.length === 1 && nodeAttempts[0].status === "failedTerminal");
  await rm(dir, { recursive: true, force: true });
}

// ── I. FlowExecutor classified-retry integration (stubbed executor) ─────────
async function partI(): Promise<void> {
  console.log("\nPart I — FlowExecutor classified retry integration");

  const makeFlow = (action: Partial<FlowStep>): FlowProfile =>
    ({
      id: "flow-1",
      name: "Retry flow",
      nodes: [
        { id: "start", type: "start", name: "Start" },
        { id: "act", type: "click", name: "Action", retry: { count: 2, delayMs: 10 }, ...action },
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "e1", source: "start", target: "act", type: "success" },
        { id: "e2", source: "act", target: "end", type: "success" }
      ]
    }) as unknown as FlowProfile;

  const context = {
    executionId: "e1",
    instanceId: "i1",
    scenarioId: "s1",
    flowId: "flow-1",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: { downloads: tmpdir(), screenshots: tmpdir(), logs: join(tmpdir(), "x.jsonl"), reports: join(tmpdir(), "x.json") }
  } as unknown as InstanceExecutionContext;

  const run = async (flow: FlowProfile, failuresBeforePass: number, error: string) => {
    let actCalls = 0;
    const stub = {
      execute: async (step: FlowStep) => {
        const base = { stepId: step.id, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 0, outputs: {} };
        if (step.id !== "act") return { ...base, status: "passed" as const };
        actCalls += 1;
        if (actCalls <= failuresBeforePass) return { ...base, status: "failed" as const, error };
        return { ...base, status: "passed" as const };
      },
      captureFailureScreenshot: async () => undefined
    } as unknown as StepExecutor;
    const result = await new FlowExecutor(stub).executeFlow(flow, context);
    return { actCalls, result };
  };

  const transient = await run(makeFlow({ name: "Open data list" }), 2, "Timeout 5000ms exceeded");
  check("transient timeout retried up to configured count then passes", transient.actCalls === 3 && transient.result.status === "passed");

  const exhausted = await run(makeFlow({ name: "Open data list" }), 99, "Timeout 5000ms exceeded");
  check("retries stop at configured count (3 total tries)", exhausted.actCalls === 3 && exhausted.result.status === "failed");

  const dangerous = await run(makeFlow({ name: "Click Submit Order" }), 99, "Timeout 5000ms exceeded");
  check("dangerous mutation executed once (no blind retry)", dangerous.actCalls === 1 && dangerous.result.status === "failed");

  const deadBrowser = await run(makeFlow({ name: "Open data list" }), 99, "Target page, context or browser has been closed");
  check("dead-browser failure not retried", deadBrowser.actCalls === 1 && deadBrowser.result.status === "failed");
}

// ── J. Live: profile lock + context cleanup with real Chromium ──────────────
async function partJ(): Promise<void> {
  console.log("\nPart J — Live profile lock + cleanup (real Chromium)");
  const root = await mkdtemp(join(tmpdir(), "wfs-conc-live-"));
  const userDataDir = join(root, "profile");
  const factory = new BrowserContextFactory({ productionOffline: false, resourcesRoot: join(process.cwd(), "resources") });

  const makeConfig = (id: string): InstanceConfig => ({
    id,
    name: id,
    browser: "chromium",
    headless: true,
    isolationMode: "persistentContext",
    userDataDir,
    timeoutMs: 30_000,
    viewport: { width: 800, height: 600 }
  });
  const makeContext = (instanceId: string): InstanceExecutionContext =>
    ({
      executionId: "e-live",
      instanceId,
      scenarioId: "s-live",
      instanceOrderNumber: 1,
      totalInstances: 1,
      runtimeInputs: {},
      instanceInputs: {},
      flowOutputs: {},
      paths: { downloads: join(root, "dl", instanceId), screenshots: join(root, "shots", instanceId), logs: join(root, "l.jsonl"), reports: join(root, "r.json") }
    }) as unknown as InstanceExecutionContext;

  const runtime1 = await factory.create(makeConfig("live-1"), makeContext("live-1"));
  check("persistent context launched with profile lock", runtime1.context.pages !== undefined);

  let lockError: unknown;
  try {
    await factory.create(makeConfig("live-2"), makeContext("live-2"));
  } catch (error) {
    lockError = error;
  }
  check(
    "second launch on the same userDataDir rejected by in-process profile lock",
    lockError instanceof ProfileLockedError,
    lockError instanceof Error ? `${lockError.name}: ${lockError.message}` : String(lockError)
  );

  await runtime1.close();
  // Re-launch on the same dir must succeed: proof the lock is released in the close path.
  const runtime2 = await factory.create(makeConfig("live-3"), makeContext("live-3"));
  check("same profile re-usable after clean close (lock released in finally)", runtime2.context.pages().length >= 0);
  await runtime2.close();

  // Isolated (non-persistent) context cleanup: browser fully closed after runtime.close().
  const isoConfig: InstanceConfig = { ...makeConfig("iso-1"), isolationMode: "browserContext", userDataDir: undefined };
  const isoRuntime = await factory.create(isoConfig, makeContext("iso-1"));
  const isoBrowser = isoRuntime.browser!;
  const isoPage = await isoRuntime.context.newPage();
  await isoRuntime.close();
  check("isolated context + browser closed after release", isoPage.isClosed() && !isoBrowser.isConnected());

  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

async function main(): Promise<void> {
  console.log("Concurrency & stability layer verification");
  console.log(`Limits in effect: ${JSON.stringify(loadConcurrencyLimits())}`);
  await partA();
  await partB();
  await partC();
  await partD();
  await partE();
  await partF();
  await partG();
  await partH();
  await partI();
  await partJ();

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-concurrency crashed:", error);
  process.exit(1);
});
