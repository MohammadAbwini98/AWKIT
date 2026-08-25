/**
 * Hard-cancellation verification (live Chromium, local only — no external websites).
 * Run with: npx tsx scripts/verify-cancellation.mts
 *
 * Proves: cancelling mid-wait closes the live browser and ends the run in seconds (not after
 * the wait's timeout), the profile lock is released after a cancelled persistent-context run,
 * cancelled steps/errors are classified non-retryable (incl. dangerous steps), pre-cancelled
 * tokens refuse to start steps, and manual-handoff cancellation resolves the waiting promise.
 * (Browser-slot release on cancel is enforced by the engine's `finally` — the release path
 * itself is covered by verify-browser-pool; the engine cannot run under tsx/Electron-free.)
 */
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlaywrightRunner } from "@src/runner/PlaywrightRunner";
import { CancellationTokenSource, CancelledError } from "@src/runner/concurrency/CancellationToken";
import { classifyError } from "@src/runner/runtime/ErrorClassifier";
import { RetryPolicy } from "@src/runner/runtime/RetryPolicy";
import { ManualHandoffController } from "@src/runner/ManualHandoffController";
import { InstancePauseController } from "@src/runner/runtime/ExecutionPauseGate";
import { globalProfileLocks } from "@src/profiles/ProfileLockManager";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Flow: open about:blank, then a 30s fixed wait — the cancellation target. */
const longWaitFlow = {
  id: "flow-cancel",
  name: "Cancel flow",
  nodes: [
    { id: "start", type: "start", name: "Start" },
    { id: "open", type: "goto", name: "Open blank", url: "about:blank" },
    { id: "long-wait", type: "wait", name: "Long wait", config: { waitType: "time" }, timeoutMs: 30_000 },
    { id: "end", type: "end", name: "End" }
  ],
  edges: [
    { id: "e1", source: "start", target: "open", type: "success" },
    { id: "e2", source: "open", target: "long-wait", type: "success" },
    { id: "e3", source: "long-wait", target: "end", type: "success" }
  ]
} as unknown as FlowProfile;

const scenario = {
  id: "scen-cancel",
  name: "Cancel scenario",
  executionMode: "sequential",
  maxParallelFlows: 1,
  flows: [{ flowId: "flow-cancel", order: 1, required: true }],
  links: [],
  failurePolicy: { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: false, takeScreenshotOnFailure: false }
} as unknown as ScenarioProfile;

function makeContext(root: string, instanceId: string): InstanceExecutionContext {
  return {
    executionId: "e-cancel",
    instanceId,
    scenarioId: "scen-cancel",
    instanceOrderNumber: 1,
    totalInstances: 1,
    runtimeInputs: {},
    instanceInputs: {},
    flowOutputs: {},
    paths: {
      downloads: join(root, "dl", instanceId),
      screenshots: join(root, "shots", instanceId),
      logs: join(root, `${instanceId}.jsonl`),
      reports: join(root, `${instanceId}.json`)
    }
  } as unknown as InstanceExecutionContext;
}

function makeConfig(id: string, userDataDir?: string): InstanceConfig {
  return {
    id,
    name: id,
    browser: "chromium",
    headless: true,
    isolationMode: userDataDir ? "persistentContext" : "browserContext",
    userDataDir,
    timeoutMs: 60_000,
    viewport: { width: 800, height: 600 }
  };
}

async function main(): Promise<void> {
  console.log("Hard-cancellation verification");
  const root = await mkdtemp(join(tmpdir(), "wfs-cancel-"));
  const resourcesRoot = join(process.cwd(), "resources");

  console.log("\nPart A — cancel mid-wait closes the browser and ends the run fast");
  const source = new CancellationTokenSource();
  const runner = new PlaywrightRunner({ flows: [longWaitFlow], productionOffline: false, resourcesRoot, cancellation: source.token });
  const startedAt = Date.now();
  const runPromise = runner.executeScenario(scenario, makeContext(root, "i-cancel-1"), makeConfig("i-cancel-1"));
  await sleep(2_000); // let it reach the 30s wait
  await source.cancel("user requested stop");
  const result = await runPromise;
  const elapsedMs = Date.now() - startedAt;
  check("run ended long before the 30s wait timeout", elapsedMs < 15_000, `elapsed ${elapsedMs}ms`);
  check("run did not pass (cancelled → failed at runner level)", result.status === "failed");
  check(
    "error names the closed/cancelled interruption",
    /cancel|closed/i.test(result.error ?? "") || result.flows.some((flow) => flow.steps.some((step) => /cancel|closed/i.test(step.error ?? ""))),
    result.error
  );

  console.log("\nPart B — cancelled persistent-context run releases the profile lock");
  const userDataDir = join(root, "profile-cancel");
  const source2 = new CancellationTokenSource();
  const runner2 = new PlaywrightRunner({ flows: [longWaitFlow], productionOffline: false, resourcesRoot, cancellation: source2.token });
  const run2 = runner2.executeScenario(scenario, makeContext(root, "i-cancel-2"), makeConfig("i-cancel-2", userDataDir));
  await sleep(2_500);
  check("profile lock held while the cancelled run is alive", globalProfileLocks.isLocked(userDataDir));
  await source2.cancel("stop persistent run");
  await run2;
  check("profile lock released after cancellation", !globalProfileLocks.isLocked(userDataDir));

  console.log("\nPart C — pre-cancelled token refuses to start browser work");
  const source3 = new CancellationTokenSource();
  await source3.cancel("cancelled before start");
  const runner3 = new PlaywrightRunner({ flows: [longWaitFlow], productionOffline: false, resourcesRoot, cancellation: source3.token });
  const started3 = Date.now();
  const result3 = await runner3.executeScenario(scenario, makeContext(root, "i-cancel-3"), makeConfig("i-cancel-3"));
  check("pre-cancelled run fails immediately with a cancellation error", result3.status === "failed" && /cancelled/i.test(result3.error ?? ""), result3.error);
  check("no long browser work happened", Date.now() - started3 < 20_000);

  console.log("\nPart D — cancellation is never retried (incl. dangerous steps)");
  check("CancelledError classifies as 'cancelled'", classifyError(new CancelledError("stop")) === "cancelled");
  const policy = new RetryPolicy();
  const cancelDecision = policy.decide({ step: { type: "click", name: "Open list", retry: { count: 3 } }, error: "Execution cancelled: user stop.", attempt: 0 });
  check("cancelled failure not retried", !cancelDecision.retry && cancelDecision.errorClass === "cancelled");
  const dangerousAfterCancel = policy.decide({ step: { type: "click", name: "Submit Order", retry: { count: 3 } }, error: "Execution cancelled: user stop.", attempt: 0 });
  check("dangerous step after cancellation not retried", !dangerousAfterCancel.retry);

  console.log("\nPart E — manual-handoff cancellation resolves the waiting promise safely");
  const controller = new ManualHandoffController();
  controller.pause({ executionId: "e-x", instanceId: "i-x", message: "waiting for human" });
  const waitPromise = controller.waitForAction("e-x", "i-x");
  controller.cancel("e-x", "i-x");
  const action = await waitPromise;
  check("waiting handoff resolves with the cancel action (no hang, no corruption)", action === "cancel", String(action));
  check("pending handoff cleared after cancel", controller.getPending("e-x", "i-x") === undefined);

  console.log("\nPart F — between-step pause gate halts dispatch; Stop interrupts a parked pause (AWKIT-RUN-001)");
  {
    // Controller semantics.
    const gate = new InstancePauseController();
    check("gate starts unpaused", gate.isPaused === false);
    gate.setPaused(true);
    // Observed state lives on a holder object, not a bare `let`. TypeScript's control-flow analysis
    // narrows `let released = false` to the literal `false` and does not track the assignment inside
    // the `.then()` callback, so `released === true` was a compile error (TS2367) — the assertion was
    // correct and the compiler could not see it. A property read is not narrowed that way, so the
    // check is unchanged and the gate type-checks.
    const wait = { released: false };
    const parked = gate.waitWhilePaused().then(() => { wait.released = true; });
    await sleep(400);
    check("waitWhilePaused stays parked while the pause holds", wait.released === false);
    gate.setPaused(false);
    await parked;
    check("waitWhilePaused releases on resume", wait.released === true);
    const gate2 = new InstancePauseController();
    gate2.setPaused(true);
    const cancel = { released: false };
    const parked2 = gate2.waitWhilePaused(() => true).then(() => { cancel.released = true; });
    await parked2;
    check("a cancel during the pause breaks the wait without a resume", cancel.released === true);
    gate2.setPaused(false);

    // LIVE wiring: a paused run executes nothing, and Stop ends it promptly. Two goto steps so
    // the pre-step gate is the only thing that can hold dispatch.
    const twoGotoFlow = {
      id: "flow-pause",
      name: "Pause flow",
      nodes: [
        { id: "s1", type: "start", name: "Start" },
        { id: "g1", type: "goto", name: "Open blank", url: "about:blank" },
        { id: "g2", type: "goto", name: "Open blank again", url: "about:blank" },
        { id: "e", type: "end", name: "End" }
      ],
      edges: [
        { id: "p1", source: "s1", target: "g1", type: "success" },
        { id: "p2", source: "g1", target: "g2", type: "success" },
        { id: "p3", source: "g2", target: "e", type: "success" }
      ]
    } as unknown as FlowProfile;
    const pauseScenario = {
      ...scenario,
      flows: [{ flowId: "flow-pause", order: 1, required: true }]
    } as unknown as ScenarioProfile;

    const stopDuringPause = new CancellationTokenSource();
    const heldGate = new InstancePauseController();
    heldGate.setPaused(true);
    const pausedRunner = new PlaywrightRunner({
      flows: [twoGotoFlow],
      productionOffline: false,
      resourcesRoot,
      cancellation: stopDuringPause.token,
      pauseGate: heldGate
    });
    let finishedWhilePaused = false;
    const parkedRun = pausedRunner
      .executeScenario(pauseScenario, makeContext(root, "i-pause-stop"), makeConfig("i-pause-stop"))
      .then((r) => { finishedWhilePaused = true; return r; });
    await sleep(2_500);
    check("a paused run executes no further work (run still unsettled after 2.5s)", finishedWhilePaused === false);
    const pauseStartedAt = Date.now();
    await stopDuringPause.cancel("stop while paused");
    const stoppedResult = await parkedRun;
    const stopElapsedMs = Date.now() - pauseStartedAt;
    check("Stop interrupts a parked pause promptly (no 10-minute hang)", stopElapsedMs < 15_000, `elapsed ${stopElapsedMs}ms`);
    check("the interrupted pause fails the run as cancelled work", stoppedResult.status === "failed");

    const resumeGate = new InstancePauseController();
    resumeGate.setPaused(true);
    const resumedRunner = new PlaywrightRunner({
      flows: [twoGotoFlow],
      productionOffline: false,
      resourcesRoot,
      cancellation: new CancellationTokenSource().token,
      pauseGate: resumeGate
    });
    const resumedRun = resumedRunner.executeScenario(pauseScenario, makeContext(root, "i-pause-resume"), makeConfig("i-pause-resume"));
    await sleep(800);
    resumeGate.setPaused(false);
    const resumedResult = await resumedRun;
    check("resume releases the gate and the run completes normally", resumedResult.status === "passed", resumedResult.error);
  }

  console.log("\nPart G — engine/IPC wiring source guards (RUN-001/003/006/007)");
  {
    const engineSource = await readFile("src/runner/ExecutionEngine.ts", "utf8");
    const stepExecutorSource = await readFile("src/runner/StepExecutor.ts", "utf8");
    const runnerSource = await readFile("src/runner/PlaywrightRunner.ts", "utf8");
    const ipcSource = await readFile("app/main/ipc/execution.ipc.ts", "utf8");

    // RUN-001 wiring.
    check(
      "StepExecutor awaits the pause gate at the between-step seam (right after throwIfCancelled)",
      /throwIfCancelled\(\);\s*\n\s*\/\/ AWKIT-RUN-001[\s\S]{0,200}?await this\.pauseGate\?\.waitWhilePaused/.test(stepExecutorSource)
    );
    check("PlaywrightRunner wires options.pauseGate into both StepExecutor constructions", (runnerSource.match(/this\.options\.pauseGate/g) ?? []).length === 2);
    check("ExecutionEngine owns per-instance pause gates", engineSource.includes("private readonly pauseGates = new Map<string, InstancePauseController>()"));
    check("pauseInstance holds the gate before relabelling", /setPaused\(true\)/.test(engineSource));
    check("resumeInstance releases the gate", /setPaused\(false\)/.test(engineSource));
    check("the gate is dropped in the instance finally", engineSource.includes("this.pauseGates.delete(instance.instanceId);"));

    // RUN-003.
    check(
      "cancelOne leaves terminal instances untouched (no retroactive relabel)",
      /includes\(instance\.status\) && !this\.activeInstanceRunners\.has\(instanceId\)\)\s*\{\s*\n\s*\/\/ AWKIT-RUN-003[\s\S]{0,420}?return;/.test(engineSource)
    );
    check("execution.ipc refuses Stop on terminal instances", ipcSource.includes("already-${instance.status}"));

    // RUN-007.
    check(
      "admission counts manual-handoff/paused instances as capacity-occupying",
      /\["starting", "running", "waitingForManualAction", "paused"\]/.test(engineSource)
    );

    // RUN-006: fallible setup must sit INSIDE the try whose finally releases the slot.
    const innerStart = engineSource.indexOf("private async runInstanceInner");
    const nextMethod = engineSource.indexOf("private createProgressReporter", innerStart) > 0 ? engineSource.indexOf("\n  private ", innerStart + 10) : -1;
    const body = engineSource.slice(innerStart, nextMethod > 0 ? nextMethod : undefined);
    const tryAt = body.indexOf("try {");
    const upsertInSetup = body.indexOf("this.durableStore.upsertRun({");
    const runLoggerAt = body.indexOf("runLogger = new RunLogger");
    const finallyAt = body.indexOf("} finally {");
    check("runInstanceInner has its setup try BEFORE any durable upsert", tryAt > -1 && upsertInSetup > tryAt && runLoggerAt > tryAt && finallyAt > upsertInSetup, `try@${tryAt} logger@${runLoggerAt} upsert@${upsertInSetup} finally@${finallyAt}`);
    check("setup-failure guard: RunLogger construction is optional-chained at every use site", !/(?<![?.])runLogger\.log\(/.test(body.slice(runLoggerAt)));
    check("the finally flushes the optional run logger", body.includes("await runLogger?.flush();"));
  }

    // AWKIT-RUN-008: the manual-login poll must be cancellable and must not relaunch after cancel.
    {
      const stepExecutorSource2 = await readFile("src/runner/StepExecutor.ts", "utf8");
      const pollStart = stepExecutorSource2.indexOf("4. Poll until the user finishes and closes the browser");
      const relaunchAt = stepExecutorSource2.indexOf("6. Resume automation against the newly captured profile directory");
      const waitBody = stepExecutorSource2.slice(pollStart, relaunchAt > 0 ? relaunchAt : undefined);
      const throwCount = (waitBody.match(/throwIfCancelled\(\)/g) ?? []).length;
      check(
        "manual-login wait checks cancellation inside the poll loop (before and after each tick)",
        throwCount >= 3 && /for \(;;\)\s*\{[\s\S]*?throwIfCancelled/.test(waitBody),
        `throwIfCancelled occurrences in wait+verify region: ${throwCount}`
      );
      check(
        "cancellation is re-checked BEFORE the post-wait browser relaunch",
        /throwIfCancelled\(\);\s*\n\s*await new Promise\(\(resolve\) => setTimeout\(resolve, 500\)\);\s*\n\s*this\.cancellation\?\.throwIfCancelled\(\);/.test(stepExecutorSource2)
      );
    }

    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-cancellation crashed:", error);
  process.exit(1);
});
