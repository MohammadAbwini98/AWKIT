import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstanceRuntimeState } from "../../instances/InstanceRuntimeState";
import type { FlowEdge, FlowProfile } from "../../profiles/FlowProfile";
import type { ConcurrentRunReport } from "../../reports/ExecutionReport";
import type { CapacitySnapshot } from "../../runner/concurrency/CapacitySnapshot";

export type RuntimeInvariantCode =
  | "terminalStateReached"
  | "exclusiveOutcome"
  | "dependencyOrder"
  | "parallelWaitAll"
  | "loopBound"
  | "cancelledStopsScheduling"
  | "resourcesReleased"
  | "recordsPersistedOnce"
  | "reportTotalsMatch"
  | "artifactSecretSafety";

export interface RuntimeInvariantFinding {
  readonly code: RuntimeInvariantCode;
  readonly passed: boolean;
  readonly message: string;
}

export interface RuntimeInvariantInput {
  readonly executionId: string;
  readonly instances: readonly InstanceRuntimeState[];
  readonly flows: readonly FlowProfile[];
  readonly report?: ConcurrentRunReport;
  readonly baselineCapacity: CapacitySnapshot;
  readonly finalCapacity: CapacitySnapshot;
  readonly artifactTexts?: readonly string[];
  readonly secretCanaries?: readonly string[];
}

export interface RuntimeInvariantResult {
  readonly passed: boolean;
  readonly findings: readonly RuntimeInvariantFinding[];
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function finding(code: RuntimeInvariantCode, passed: boolean, message: string): RuntimeInvariantFinding {
  return { code, passed, message };
}

function nonLoopEdges(edges: readonly FlowEdge[]): FlowEdge[] {
  return edges.filter(
    (edge) =>
      edge.type !== "loop" &&
      edge.type !== "loopBack" &&
      edge.kind !== "loop" &&
      edge.source !== edge.target
  );
}

export class RuntimeInvariantChecker {
  check(input: RuntimeInvariantInput): RuntimeInvariantResult {
    const findings: RuntimeInvariantFinding[] = [];
    const terminal = input.instances.length > 0 && input.instances.every((instance) => TERMINAL.has(instance.status));
    findings.push(finding("terminalStateReached", terminal, terminal ? "Every instance reached a product terminal state." : "At least one instance remained non-terminal."));

    const reports = input.report?.instances ?? [];
    const exclusive = reports.every((instance) => ["passed", "failed", "manualHandoff", "skipped"].includes(instance.status));
    findings.push(finding("exclusiveOutcome", exclusive, exclusive ? "Every persisted instance has exactly one outcome." : "An instance carried an invalid or conflicting outcome."));

    let orderOkay = true;
    let waitAllOkay = true;
    let loopOkay = true;
    for (const instance of reports) {
      for (const flowResult of instance.scenarioResult?.flows ?? []) {
        const definition = input.flows.find((flow) => flow.id === flowResult.flowId);
        if (!definition) continue;
        const positions = new Map<string, number[]>();
        flowResult.steps.forEach((step, index) => {
          const list = positions.get(step.stepId) ?? [];
          list.push(index);
          positions.set(step.stepId, list);
        });
        for (const edge of nonLoopEdges(definition.edges)) {
          const source = positions.get(edge.source)?.[0];
          const target = positions.get(edge.target)?.[0];
          if (source !== undefined && target !== undefined && source > target) orderOkay = false;
        }
        const parallelGroups = new Map<string, FlowEdge[]>();
        definition.edges
          .filter((edge) => edge.kind === "parallel" || edge.type === "parallel")
          .forEach((edge) => {
            const group = parallelGroups.get(edge.source) ?? [];
            group.push(edge);
            parallelGroups.set(edge.source, group);
          });
        for (const [source, edges] of parallelGroups) {
          if (!edges.some((edge) => (edge.parallel?.joinMode ?? "waitAll") === "waitAll")) continue;
          const mustSettleEveryBranch = edges.some(
            (edge) =>
              edge.parallel?.isolation === "isolatedPage" ||
              edge.parallel?.failMode === "collectErrors"
          );
          if (!mustSettleEveryBranch) continue;
          if (!positions.has(source)) continue;
          const anyBranchRan = edges.some((edge) => positions.has(edge.target));
          if (anyBranchRan && edges.some((edge) => !positions.has(edge.target))) waitAllOkay = false;
        }
        for (const edge of definition.edges.filter((candidate) => candidate.kind === "loop" || candidate.type === "loop" || candidate.type === "loopBack")) {
          const targetExecutions = positions.get(edge.target)?.length ?? 0;
          const limit = edge.loop?.maxIterations ?? edge.maxLoopCount ?? 1;
          if (targetExecutions > limit + 1) loopOkay = false;
        }
      }
    }
    findings.push(finding("dependencyOrder", orderOkay, orderOkay ? "Observed node order respects non-loop dependencies." : "A target completed before its dependency."));
    findings.push(finding("parallelWaitAll", waitAllOkay, waitAllOkay ? "Observed waitAll groups included every branch once entered." : "A waitAll group omitted an observed sibling branch."));
    findings.push(finding("loopBound", loopOkay, loopOkay ? "Observed loop executions stayed within configured bounds." : "A loop exceeded its configured maximum."));

    const cancelledOkay = input.instances
      .filter((instance) => instance.status === "cancelled")
      .every(
        (instance) =>
          instance.liveProgress === undefined ||
          !instance.liveProgress.steps.some((step) => ["running", "waiting"].includes(step.status))
      );
    findings.push(finding("cancelledStopsScheduling", cancelledOkay, cancelledOkay ? "Cancelled instances are not still schedulable." : "A cancelled instance remained active."));

    const released =
      input.finalCapacity.activeBrowsers <= input.baselineCapacity.activeBrowsers &&
      input.finalCapacity.activeContexts <= input.baselineCapacity.activeContexts &&
      input.finalCapacity.activePages <= input.baselineCapacity.activePages;
    findings.push(finding("resourcesReleased", released, released ? "Browser resources returned to the measured baseline." : "Browser resources remained above baseline."));

    const instanceIds = reports.map((instance) => instance.instanceId);
    const persistedOnce =
      reports.length === input.instances.length &&
      new Set(instanceIds).size === instanceIds.length &&
      input.instances.every((instance) => instanceIds.includes(instance.instanceId));
    findings.push(finding("recordsPersistedOnce", persistedOnce, persistedOnce ? "Every runtime instance has one persisted report record." : "Persisted report records are missing or duplicated."));

    const passedFlows = reports.reduce((count, instance) => count + (instance.scenarioResult?.flows.filter((flow) => flow.status === "passed").length ?? 0), 0);
    const failedFlows = reports.reduce((count, instance) => count + (instance.scenarioResult?.flows.filter((flow) => flow.status === "failed").length ?? 0), 0);
    const skippedFlows = reports.reduce((count, instance) => count + (instance.scenarioResult?.flows.flatMap((flow) => flow.steps).filter((step) => step.status === "skipped").length ?? 0), 0);
    const totalsOkay =
      input.report !== undefined &&
      input.report.passedFlows === passedFlows &&
      input.report.failedFlows === failedFlows &&
      input.report.skippedFlows === skippedFlows;
    findings.push(finding("reportTotalsMatch", totalsOkay, totalsOkay ? "Report totals match the persisted instance records." : "Report totals disagree with instance records."));

    const text = (input.artifactTexts ?? []).join("\n");
    const secretSafe = (input.secretCanaries ?? []).every((canary) => !text.includes(canary));
    findings.push(finding("artifactSecretSafety", secretSafe, secretSafe ? "No supplied secret canary appears in artifacts." : "A secret canary appears in an artifact."));

    return { passed: findings.every((item) => item.passed), findings };
  }

  static async readReport(reportsRoot: string, executionId: string): Promise<ConcurrentRunReport | undefined> {
    try {
      return JSON.parse(await readFile(join(reportsRoot, executionId, "report.json"), "utf8")) as ConcurrentRunReport;
    } catch {
      return undefined;
    }
  }
}
