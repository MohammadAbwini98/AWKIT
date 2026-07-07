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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlaywrightRunner } from "@src/runner/PlaywrightRunner";
import { CancellationTokenSource, CancelledError } from "@src/runner/concurrency/CancellationToken";
import { classifyError } from "@src/runner/runtime/ErrorClassifier";
import { RetryPolicy } from "@src/runner/runtime/RetryPolicy";
import { ManualHandoffController } from "@src/runner/ManualHandoffController";
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

  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-cancellation crashed:", error);
  process.exit(1);
});
