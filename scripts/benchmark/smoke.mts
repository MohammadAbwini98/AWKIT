/**
 * Harness smoke test — proves the benchmark can drive the COMPLETE real `ExecutionEngine.startRun` dispatch
 * path (scheduler → admission → pools → factory → PlaywrightRunner → real Chromium) under plain tsx via the
 * `electron` stub, BEFORE any heavy ramp/soak run. Two LIGHT instances against the offline workload server.
 *
 *   node --import tsx --import ./scripts/benchmark/electron-hook.mjs scripts/benchmark/smoke.mts
 */
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import type { StorageDirs } from "@src/instances/InstanceManager";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { startWorkloadServer } from "./lib.mts";

const PORT = 4419;

async function buildDirs(): Promise<{ dirs: StorageDirs; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "awkit-engine-smoke-"));
  const dirs: StorageDirs = {
    root,
    downloads: join(root, "downloads"),
    screenshots: join(root, "screenshots"),
    logs: join(root, "logs"),
    reports: join(root, "reports")
  };
  await Promise.all(Object.values(dirs).map((d) => mkdir(d, { recursive: true })));
  return { dirs, root };
}

function lightFlow(base: string): FlowProfile {
  return {
    id: "smoke-light",
    name: "Smoke Light",
    version: 1,
    nodes: [
      { id: "start", type: "start", name: "start" },
      { id: "goto", type: "goto", name: "goto form", url: `${base}/form` },
      { id: "f0", type: "fill", name: "fill 0", locator: { strategy: "id", value: "fld0" }, value: "tester" },
      { id: "f1", type: "fill", name: "fill 1", locator: { strategy: "id", value: "fld1" }, value: "abc" },
      { id: "go", type: "click", name: "click go", locator: { strategy: "id", value: "go" } },
      { id: "assert", type: "assertText", name: "assert title", locator: { strategy: "id", value: "title" }, config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "Form" } },
      { id: "end", type: "end", name: "end" }
    ],
    edges: [
      { id: "e0", source: "start", target: "goto", type: "success" },
      { id: "e1", source: "goto", target: "f0", type: "success" },
      { id: "e2", source: "f0", target: "f1", type: "success" },
      { id: "e3", source: "f1", target: "go", type: "success" },
      { id: "e4", source: "go", target: "assert", type: "success" },
      { id: "e5", source: "assert", target: "end", type: "success" }
    ]
  };
}

function scenario(flowId: string): ScenarioProfile {
  return {
    id: "smoke-scenario",
    name: "Smoke Scenario",
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: [{ order: 1, flowId, required: true }],
    links: [],
    failurePolicy: { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: false, takeScreenshotOnFailure: false }
  };
}

function profile(base: string): ConcurrentRunProfile {
  return {
    id: "smoke-exec",
    scenarioId: "smoke-scenario",
    runMode: "fixedConcurrent",
    maxConcurrentInstances: 2,
    browserWindowMode: "headless",
    instanceTemplate: { browser: "chromium", headless: true, isolationMode: "browserContext", baseUrl: base, timeoutMs: 30000, viewport: { width: 1280, height: 720 } },
    resourceControls: { maxBrowserContextsPerProcess: 5, delayBetweenInstanceStartsMs: 100 },
    failurePolicy: { stopAllOnCriticalFailure: false, continueOtherInstancesOnFailure: true, retryFailedInstance: false, retryCount: 0 }
  };
}

async function main() {
  const wl = await startWorkloadServer(PORT);
  const { dirs, root } = await buildDirs();
  const engine = new ExecutionEngine();
  engine.configureConcurrency({ maxBrowsersPerHost: 2, maxActiveFlows: 2, useSharedBrowserPool: false, workloadWeights: false });

  const flows = [lightFlow(wl.base)];
  const executionId = "smoke-exec";
  console.log("Starting 2-instance LIGHT run through the real ExecutionEngine…");
  const t0 = Date.now();
  await engine.startRun(executionId, profile(wl.base), Array.from({ length: 2 }), dirs, {}, scenario("smoke-light"), flows);

  // Poll to completion (bounded).
  const deadline = Date.now() + 120_000;
  let terminal = false;
  while (Date.now() < deadline) {
    const list = engine.getInstances().filter((i) => i.executionId === executionId);
    terminal = list.length > 0 && list.every((i) => ["completed", "failed", "cancelled"].includes(i.status));
    if (terminal) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const list = engine.getInstances().filter((i) => i.executionId === executionId);
  const summary = list.map((i) => `${i.instanceId}=${i.status}`).join(", ");
  const allCompleted = list.length === 2 && list.every((i) => i.status === "completed");
  console.log(`Instances (${Date.now() - t0}ms): ${summary}`);

  wl.server.close();
  await rm(root, { recursive: true, force: true }).catch(() => undefined);

  if (allCompleted) {
    console.log("\n✓ SMOKE PASS — real ExecutionEngine dispatch works under the electron stub.");
    process.exit(0);
  } else {
    console.error("\n✗ SMOKE FAIL — instances did not all complete.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
