import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { ScenarioExecutionResult } from "@src/runner/RunnerResult";
import { SecretMasker } from "./SecretMasker";
import type { ConcurrentRunReport, InstanceReport } from "./ExecutionReport";
import { collectEvidence } from "./ExecutionReport";

export class ReportService {
  private readonly masker = new SecretMasker();

  constructor(private readonly reportsRoot: string) {}

  createInstanceReport(result: ScenarioExecutionResult, currentDataRowIndex?: number): InstanceReport {
    const evidence = collectEvidence(result);

    return {
      instanceId: result.instanceId,
      status: result.status,
      durationMs: result.durationMs,
      currentDataRowIndex,
      error: result.error ? this.masker.maskText(result.error) : undefined,
      screenshots: evidence.screenshots,
      downloadedFiles: evidence.downloadedFiles,
      scenarioResult: {
        ...result,
        logs: result.logs.map((log) => ({
          ...log,
          message: this.masker.maskText(log.message),
          data: log.data ? this.masker.maskRecord(log.data) : undefined
        }))
      }
    };
  }

  createConcurrentRunReport(
    scenario: ScenarioProfile,
    instances: InstanceReport[],
    options: {
      executionId: string;
      runMode: ConcurrentRunReport["runMode"];
      maxConcurrentInstances: number;
      startedAt: string;
      endedAt: string;
      runtimeInputs: Record<string, unknown>;
    }
  ): ConcurrentRunReport {
    const failed = instances.some((instance) => instance.status === "failed");
    const manual = instances.some((instance) => instance.status === "manualHandoff");
    const allPassed = instances.every((instance) => instance.status === "passed");

    return {
      executionId: options.executionId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      runMode: options.runMode,
      maxConcurrentInstances: options.maxConcurrentInstances,
      status: failed ? "failed" : manual ? "manualHandoff" : allPassed ? "passed" : "completed",
      startedAt: options.startedAt,
      endedAt: options.endedAt,
      durationMs: Date.parse(options.endedAt) - Date.parse(options.startedAt),
      passedFlows: instances.reduce((count, instance) => count + (instance.scenarioResult?.flows.filter((flow) => flow.status === "passed").length ?? 0), 0),
      failedFlows: instances.reduce((count, instance) => count + (instance.scenarioResult?.flows.filter((flow) => flow.status === "failed").length ?? 0), 0),
      skippedFlows: instances.reduce(
        (count, instance) => count + (instance.scenarioResult?.flows.flatMap((flow) => flow.steps).filter((step) => step.status === "skipped").length ?? 0),
        0
      ),
      instances,
      runtimeInputs: this.masker.maskRecord(options.runtimeInputs)
    };
  }

  async writeReport(report: ConcurrentRunReport): Promise<string> {
    const path = join(this.reportsRoot, report.executionId, "report.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(report, null, 2), "utf8");
    return path;
  }
}
