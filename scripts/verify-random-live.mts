import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { StepType } from "@src/profiles/FlowProfile";
import { detectMachineCapabilities } from "@src/runner/concurrency/MachineCapabilityDetector";
import { CoverageTracker } from "@src/testing/random/CoverageTracker";
import { resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { NODE_CATALOG } from "@src/testing/random/NodeCatalog";
import { generateWorkflow, type GeneratedWorkflow } from "@src/testing/random/RandomWorkflowGenerator";
import { SeededRandom } from "@src/testing/random/SeededRandom";
import { SECRET_LEAK_CANARY } from "@src/testing/fixtures/SafeTestData";
import { RandomTestRunner, type RandomExecutionEngine } from "@src/testing/runtime/RandomTestRunner";
import type { StorageDirs } from "@src/instances/InstanceManager";
import type { InstanceRuntimeState } from "@src/instances/InstanceRuntimeState";
import type { CapacitySnapshot } from "@src/runner/concurrency/CapacitySnapshot";

const PORT = 4491;
const BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcess | undefined;
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

async function serverReady(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/`)).ok;
  } catch {
    return false;
  }
}

async function startServer(): Promise<void> {
  if (await serverReady()) return;
  server = spawn(process.execPath, ["mock-site/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, MOCK_SITE_PORT: String(PORT) },
    stdio: "ignore",
    windowsHide: true
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await serverReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mock site did not start at ${BASE}.`);
}

async function buildDirs(): Promise<{ root: string; dirs: StorageDirs }> {
  const root = await mkdtemp(join(tmpdir(), "awkit-random-live-"));
  const dirs: StorageDirs = {
    root,
    downloads: join(root, "downloads"),
    screenshots: join(root, "screenshots"),
    logs: join(root, "logs"),
    reports: join(root, "reports")
  };
  await Promise.all(Object.values(dirs).map((path) => mkdir(path, { recursive: true })));
  return { root, dirs };
}

function onlyWeights(selected: StepType): Partial<Record<StepType, number>> {
  return Object.fromEntries(
    Object.keys(NODE_CATALOG).map((type) => [type, type === selected ? 100 : 0])
  ) as Partial<Record<StepType, number>>;
}

function generated(
  seed: string,
  pattern: "linear" | "parallelWaitAll",
  nodeCount: number,
  nodeType: StepType = "goto"
): GeneratedWorkflow {
  const constraints = resolveConstraints({
    seed,
    workflowCount: 1,
    minFlowsPerWorkflow: 1,
    maxFlowsPerWorkflow: 1,
    minNodesPerFlow: nodeCount,
    maxNodesPerFlow: nodeCount,
    patterns: [pattern],
    nodeTypeWeights: onlyWeights(nodeType),
    concurrencyLevels: [2],
    executionModes: ["parallel"],
    baseUrl: BASE
  });
  const result = generateWorkflow({
    workflowId: `${seed}-workflow`,
    workflowName: `${seed} workflow`,
    rng: new SeededRandom(seed),
    constraints,
    coverage: new CoverageTracker()
  });
  for (const flow of result.flows) {
    flow.profile.edges.forEach((edge) => {
      if (edge.kind === "normal") edge.type = "success";
      if (edge.kind === "parallel" && edge.parallel) {
        edge.parallel.isolation = "isolatedPage";
        edge.parallel.joinMode = "waitAll";
        edge.parallel.maxConcurrency = 2;
      }
    });
  }
  return result;
}

class NeverTerminalEngine implements RandomExecutionEngine {
  private instances: InstanceRuntimeState[] = [];
  public capturedFlows: Parameters<RandomExecutionEngine["startRun"]>[6] = [];
  private readonly capacity: CapacitySnapshot = {
    timestamp: new Date(0).toISOString(),
    activeBrowsers: 0,
    maxBrowsers: 1,
    activeContexts: 0,
    activePages: 0,
    activeFlows: 0,
    maxActiveFlows: 1,
    queueDepth: 0,
    freeMemoryMb: 8_192,
    processRssMb: 100,
    recentCrashes: 0,
    dispatchBlocked: false
  };

  async startRun(
    executionId: string,
    profile: Parameters<RandomExecutionEngine["startRun"]>[1],
    rows: unknown[],
    dirs: StorageDirs,
    _runtimeInputs: Record<string, unknown>,
    _scenario: Parameters<RandomExecutionEngine["startRun"]>[5],
    flows: Parameters<RandomExecutionEngine["startRun"]>[6]
  ): Promise<void> {
    this.capturedFlows = structuredClone(flows);
    this.instances = rows.map((_, index) => ({
      executionId,
      instanceId: `${executionId}-${index}`,
      scenarioId: profile.scenarioId,
      config: {
        id: `${executionId}-${index}`,
        name: "Never terminal",
        browser: "chromium",
        headless: true,
        isolationMode: "browserContext",
        baseUrl: profile.instanceTemplate.baseUrl ?? BASE,
        timeoutMs: 30_000,
        viewport: { width: 1280, height: 720 },
        ignoreHttpsErrors: false,
        ignoreHttpsErrorsSource: "default"
      },
      status: "pending",
      durationMs: 0,
      retryAttempt: 0,
      paths: {
        downloads: dirs.downloads,
        screenshots: dirs.screenshots,
        logs: join(dirs.logs, `${executionId}-${index}.jsonl`),
        reports: join(dirs.reports, `${executionId}-${index}.json`),
        storage: dirs.root
      },
      resourcePolicy: {
        downloadsPath: dirs.downloads,
        screenshotsPath: dirs.screenshots,
        logsPath: join(dirs.logs, `${executionId}-${index}.jsonl`)
      },
      runtimeInputs: {},
      instanceInputs: {},
      flowOutputs: {}
    }));
  }

  getInstances(): InstanceRuntimeState[] {
    return structuredClone(this.instances);
  }

  getCapacitySnapshot(): CapacitySnapshot {
    return { ...this.capacity };
  }

  stopInstance(instanceId: string): void {
    this.instances = this.instances.map((instance) =>
      instance.instanceId === instanceId ? { ...instance, status: "cancelled" } : instance
    );
  }

  async drainIdleSharedBrowsers(): Promise<void> {}
}

const { root, dirs } = await buildDirs();
try {
  process.env.AWKIT_DURABLE_STORE = "0";
  process.env.AWKIT_CDP_OBSERVATION = "0";
  await startServer();
  const capabilities = detectMachineCapabilities("random-live-verifier");
  const runner = new RandomTestRunner();

  console.log("\nGenerated linear flow through the real ExecutionEngine");
  const linear = await runner.run({
    generated: generated("phase5-linear", "linear", 3),
    dirs,
    capabilities,
    baseUrl: BASE,
    instanceCount: 1,
    deadlineMs: 60_000,
    secretCanaries: [SECRET_LEAK_CANARY],
    executionId: "random-live-linear"
  });
  check("run reaches a product terminal state", linear.outcome === "completed", linear.outcome);
  check("concurrency is capacity-derived and bounded", linear.selectedConcurrency >= 1 && linear.selectedConcurrency <= linear.capacityPlan.conservativeRecommendedCapacity);
  check("all decidable runtime invariants pass", linear.invariants.passed, linear.invariants.findings.filter((item) => !item.passed).map((item) => item.code).join(", "));

  console.log("\nGenerated isolated waitAll topology through the production branch factory");
  const parallelDefinition = generated("phase5-parallel", "parallelWaitAll", 7);
  const parallelEdges = parallelDefinition.flows.flatMap((flow) => flow.profile.edges).filter((edge) => edge.kind === "parallel");
  check("generated topology has isolatedPage waitAll branches", parallelEdges.length >= 2 && parallelEdges.every((edge) => edge.parallel?.isolation === "isolatedPage" && edge.parallel.joinMode === "waitAll"));
  const parallel = await runner.run({
    generated: parallelDefinition,
    dirs,
    capabilities,
    baseUrl: BASE,
    instanceCount: 1,
    deadlineMs: 90_000,
    secretCanaries: [SECRET_LEAK_CANARY],
    executionId: "random-live-parallel"
  });
  check("isolated parallel run reaches terminal without lab timeout", parallel.outcome !== "labTimeout", parallel.outcome);
  check("isolated parallel runtime invariants pass", parallel.invariants.passed, parallel.invariants.findings.filter((item) => !item.passed).map((item) => item.code).join(", "));

  console.log("\nLab-owned timeout is distinct from product status");
  const timeout = await new RandomTestRunner(new NeverTerminalEngine()).run({
    generated: generated("phase5-timeout", "linear", 3),
    dirs,
    capabilities,
    baseUrl: BASE,
    instanceCount: 1,
    deadlineMs: 1,
    pollIntervalMs: 25,
    executionId: "random-live-timeout"
  });
  check("deadline reports labTimeout, never a fabricated product status", timeout.outcome === "labTimeout");
  check("timeout cancellation leaves the product instance cancelled", timeout.instances[0]?.status === "cancelled");
  check("live capacity limits selected concurrency without hardcoding", timeout.selectedConcurrency === 1);

  console.log("\nLive target and upload safety");
  let unauthorizedRejected = false;
  try {
    await new RandomTestRunner(new NeverTerminalEngine()).run({
      generated: generated("phase5-unauthorized", "linear", 3),
      dirs,
      capabilities,
      baseUrl: "https://example.com",
      instanceCount: 1,
      deadlineMs: 1
    });
  } catch (error) {
    unauthorizedRejected = error instanceof Error && error.message.includes("not authorized");
  }
  check("unauthorized live target is rejected before dispatch", unauthorizedRejected);

  const uploadDefinition = generated("phase5-upload", "linear", 3, "uploadFile");
  const originalUploadValue = uploadDefinition.flows[0]?.profile.nodes.find((node) => node.type === "uploadFile")?.value;
  const uploadEngine = new NeverTerminalEngine();
  await new RandomTestRunner(uploadEngine).run({
    generated: uploadDefinition,
    dirs,
    capabilities,
    baseUrl: BASE,
    instanceCount: 1,
    deadlineMs: 1,
    executionId: "random-live-upload"
  });
  const materializedUpload = uploadEngine.capturedFlows[0]?.nodes.find((node) => node.type === "uploadFile")?.value;
  check("upload fixture is materialized to an absolute campaign path", typeof materializedUpload === "string" && isAbsolute(materializedUpload));
  check("materialized upload contains only deterministic safe content", typeof materializedUpload === "string" && (await readFile(materializedUpload, "utf8")).includes("AWKIT lab upload fixture"));
  check("live preparation does not mutate generated originals", uploadDefinition.flows[0]?.profile.nodes.find((node) => node.type === "uploadFile")?.value === originalUploadValue);
  let exactFixtureReuse = true;
  try {
    await new RandomTestRunner(new NeverTerminalEngine()).run({
      generated: uploadDefinition,
      dirs,
      capabilities,
      baseUrl: BASE,
      instanceCount: 1,
      deadlineMs: 1,
      executionId: "random-live-upload-reuse"
    });
  } catch {
    exactFixtureReuse = false;
  }
  check("an existing byte-identical campaign fixture is reused without overwrite", exactFixtureReuse);

  console.log(`\nRandom live execution: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
} finally {
  server?.kill();
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}
