import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConcurrentRunProfile } from "../../instances/ConcurrentRunProfile";
import type { StorageDirs } from "../../instances/InstanceManager";
import type { InstanceRuntimeState } from "../../instances/InstanceRuntimeState";
import { workflowToScenarioProfile } from "../../profiles/WorkflowProfile";
import type { CapacitySnapshot } from "../../runner/concurrency/CapacitySnapshot";
import type { MachineCapabilities } from "../../runner/concurrency/MachineCapabilityDetector";
import { planCapacity, type CapacityRecommendation, type WorkloadClass } from "../../runner/concurrency/CapacityPlanner";
import { ExecutionEngine } from "../../runner/ExecutionEngine";
import { SAFE_UPLOAD_FIXTURE } from "../fixtures/SafeTestData";
import { assertAllowedTarget, DEFAULT_ALLOWED_HOSTS } from "../random/GenerationConstraints";
import type { GeneratedWorkflow } from "../random/RandomWorkflowGenerator";
import { RuntimeInvariantChecker, type RuntimeInvariantResult } from "./RuntimeInvariantChecker";

export type RandomRunOutcome = "completed" | "failed" | "cancelled" | "labTimeout";

export interface RandomExecutionEngine {
  startRun: ExecutionEngine["startRun"];
  getInstances(): InstanceRuntimeState[];
  getCapacitySnapshot(): CapacitySnapshot;
  stopInstance(instanceId: string): void;
  drainIdleSharedBrowsers(): Promise<void>;
}

export interface RandomTestRunRequest {
  readonly generated: GeneratedWorkflow;
  readonly dirs: StorageDirs;
  readonly capabilities: MachineCapabilities;
  readonly baseUrl: string;
  readonly allowedHosts?: readonly string[];
  readonly instanceCount?: number;
  readonly deadlineMs: number;
  readonly pollIntervalMs?: number;
  readonly workloadClass?: WorkloadClass;
  readonly runtimeInputs?: Record<string, unknown>;
  readonly secretCanaries?: readonly string[];
  readonly executionId?: string;
}

export interface RandomTestRunResult {
  readonly executionId: string;
  readonly outcome: RandomRunOutcome;
  readonly durationMs: number;
  readonly capacityPlan: CapacityRecommendation;
  readonly selectedConcurrency: number;
  readonly baselineCapacity: CapacitySnapshot;
  readonly finalCapacity: CapacitySnapshot;
  /** Raw, chronological engine snapshots. Reporting computes peaks from these, never aggregates. */
  readonly capacitySamples: readonly CapacitySnapshot[];
  readonly instances: readonly InstanceRuntimeState[];
  readonly invariants: RuntimeInvariantResult;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runProfile(
  executionId: string,
  scenarioId: string,
  baseUrl: string,
  selectedConcurrency: number
): ConcurrentRunProfile {
  return {
    id: executionId,
    scenarioId,
    runMode: selectedConcurrency === 1 ? "single" : "fixedConcurrent",
    maxConcurrentInstances: selectedConcurrency,
    browserWindowMode: "headless",
    instanceTemplate: {
      browser: "chromium",
      headless: true,
      isolationMode: "browserContext",
      baseUrl,
      timeoutMs: 30_000
    },
    resourceControls: {
      maxBrowserContextsPerProcess: selectedConcurrency,
      delayBetweenInstanceStartsMs: 50
    },
    failurePolicy: {
      stopAllOnCriticalFailure: false,
      continueOtherInstancesOnFailure: true,
      retryFailedInstance: false,
      retryCount: 0
    }
  };
}

async function readArtifactTexts(instances: readonly InstanceRuntimeState[], reportPath: string): Promise<string[]> {
  const paths = [
    reportPath,
    ...instances.flatMap((instance) => [instance.paths.logs, instance.paths.reports])
  ];
  const texts: string[] = [];
  for (const path of paths) {
    try {
      texts.push(await readFile(path, "utf8"));
    } catch {
      // Some failures legitimately produce no per-instance file; report consistency owns that result.
    }
  }
  return texts;
}

async function prepareLiveFlows(
  generated: GeneratedWorkflow,
  dirs: StorageDirs,
  allowedHosts: readonly string[]
): Promise<GeneratedWorkflow["flows"][number]["profile"][]> {
  const flows = generated.flows.map((flow) => structuredClone(flow.profile));
  let uploadFixturePath: string | undefined;
  for (const flow of flows) {
    for (const node of flow.nodes) {
      if (node.type === "goto") {
        const target = node.url ?? node.value;
        if (!target) throw new Error(`Generated goto step ${node.id} has no literal live target.`);
        assertAllowedTarget(target, allowedHosts);
      }
      if (node.type === "uploadFile" && node.value === SAFE_UPLOAD_FIXTURE.filename) {
        if (!uploadFixturePath) {
          const fixtureDir = join(dirs.root, "random-test-fixtures");
          await mkdir(fixtureDir, { recursive: true });
          uploadFixturePath = join(fixtureDir, SAFE_UPLOAD_FIXTURE.filename);
          try {
            await writeFile(uploadFixturePath, SAFE_UPLOAD_FIXTURE.content, { encoding: "utf8", flag: "wx" });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            const existing = await readFile(uploadFixturePath, "utf8");
            if (existing !== SAFE_UPLOAD_FIXTURE.content) {
              throw new Error(`Refusing to reuse a modified random-test upload fixture at ${uploadFixturePath}.`);
            }
          }
        }
        node.value = uploadFixturePath;
        node.valueSource = { type: "static", value: uploadFixturePath };
      }
    }
  }
  return flows;
}

export class RandomTestRunner {
  constructor(
    private readonly engine: RandomExecutionEngine = new ExecutionEngine(),
    private readonly invariantChecker = new RuntimeInvariantChecker(),
    private readonly now: () => number = () => Date.now()
  ) {}

  async run(request: RandomTestRunRequest): Promise<RandomTestRunResult> {
    const startedAt = this.now();
    const allowedHosts = request.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
    assertAllowedTarget(request.baseUrl, allowedHosts);
    const baselineCapacity = this.engine.getCapacitySnapshot();
    const capacitySamples: CapacitySnapshot[] = [baselineCapacity];
    const workloadClass = request.workloadClass ?? "medium";
    const capacityPlan = planCapacity({
      capabilities: request.capabilities,
      workloadClass,
      liveAvailableMemoryMb: baselineCapacity.freeMemoryMb
    });
    const requestedConcurrency = Math.max(
      1,
      request.generated.profile.execution.maxConcurrentInstances
    );
    const liveCeiling = Math.max(
      1,
      Math.min(baselineCapacity.maxActiveFlows, baselineCapacity.maxBrowsers)
    );
    const selectedConcurrency = Math.max(
      1,
      Math.min(requestedConcurrency, capacityPlan.conservativeRecommendedCapacity, liveCeiling)
    );
    const instanceCount = Math.max(1, request.instanceCount ?? selectedConcurrency);
    const executionId =
      request.executionId ??
      `random-live-${request.generated.seed.replace(/[^a-zA-Z0-9._-]+/g, "-")}-${startedAt}`;
    const scenario = workflowToScenarioProfile(request.generated.profile);
    const flows = await prepareLiveFlows(request.generated, request.dirs, allowedHosts);
    const profile = runProfile(executionId, scenario.id, request.baseUrl, selectedConcurrency);

    await this.engine.startRun(
      executionId,
      profile,
      Array.from({ length: instanceCount }, (_, index) => ({ labInstance: index + 1 })),
      request.dirs,
      request.runtimeInputs ?? {},
      scenario,
      flows
    );

    const deadline = startedAt + request.deadlineMs;
    const pollIntervalMs = Math.max(25, request.pollIntervalMs ?? 250);
    let instances: InstanceRuntimeState[] = [];
    let timedOut = false;
    while (this.now() < deadline) {
      instances = this.engine.getInstances().filter((instance) => instance.executionId === executionId);
      capacitySamples.push(this.engine.getCapacitySnapshot());
      if (instances.length === instanceCount && instances.every((instance) => TERMINAL.has(instance.status))) break;
      await sleep(pollIntervalMs);
    }
    instances = this.engine.getInstances().filter((instance) => instance.executionId === executionId);
    if (instances.length !== instanceCount || instances.some((instance) => !TERMINAL.has(instance.status))) {
      timedOut = true;
      for (const instance of instances.filter((candidate) => !TERMINAL.has(candidate.status))) {
        this.engine.stopInstance(instance.instanceId);
      }
    }

    const cleanupDeadline = this.now() + Math.min(10_000, Math.max(1_000, request.deadlineMs / 4));
    await this.engine.drainIdleSharedBrowsers().catch(() => undefined);
    let finalCapacity = this.engine.getCapacitySnapshot();
    while (
      this.now() < cleanupDeadline &&
      (finalCapacity.activeBrowsers > baselineCapacity.activeBrowsers ||
        finalCapacity.activeContexts > baselineCapacity.activeContexts ||
        finalCapacity.activePages > baselineCapacity.activePages)
    ) {
      await sleep(pollIntervalMs);
      finalCapacity = this.engine.getCapacitySnapshot();
      capacitySamples.push(finalCapacity);
    }
    capacitySamples.push(finalCapacity);

    instances = this.engine.getInstances().filter((instance) => instance.executionId === executionId);
    let report = await RuntimeInvariantChecker.readReport(request.dirs.reports, executionId);
    const reportDeadline = this.now() + 5_000;
    while (!timedOut && !report && this.now() < reportDeadline) {
      await sleep(pollIntervalMs);
      report = await RuntimeInvariantChecker.readReport(request.dirs.reports, executionId);
    }
    const reportPath = join(request.dirs.reports, executionId, "report.json");
    const artifactTexts = await readArtifactTexts(instances, reportPath);
    const invariants = this.invariantChecker.check({
      executionId,
      instances,
      flows,
      report,
      baselineCapacity,
      finalCapacity,
      artifactTexts,
      secretCanaries: request.secretCanaries
    });
    const outcome: RandomRunOutcome = timedOut
      ? "labTimeout"
      : instances.some((instance) => instance.status === "failed")
        ? "failed"
        : instances.some((instance) => instance.status === "cancelled")
          ? "cancelled"
          : "completed";

    return {
      executionId,
      outcome,
      durationMs: this.now() - startedAt,
      capacityPlan,
      selectedConcurrency,
      baselineCapacity,
      finalCapacity,
      capacitySamples: structuredClone(capacitySamples),
      instances,
      invariants
    };
  }
}
