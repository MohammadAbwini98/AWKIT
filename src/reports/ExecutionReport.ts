import type { OfflineRuntimeStatus } from "@src/offline/OfflineRuntimeValidator";
import type { ScenarioExecutionResult } from "@src/runner/RunnerResult";

export interface InstanceReport {
  instanceId: string;
  status: "passed" | "failed" | "manualHandoff" | "skipped";
  durationMs: number;
  currentDataRowIndex?: number;
  error?: string;
  screenshots: string[];
  downloadedFiles: string[];
  scenarioResult?: ScenarioExecutionResult;
}

export interface ConcurrentRunReport {
  executionId: string;
  scenarioId: string;
  scenarioName: string;
  runMode: "single" | "concurrent" | "dataDrivenConcurrent" | "multipleScenarios";
  maxConcurrentInstances: number;
  status: "passed" | "failed" | "manualHandoff" | "completed";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  passedFlows: number;
  failedFlows: number;
  skippedFlows: number;
  instances: InstanceReport[];
  runtimeInputs: Record<string, unknown>;
  offlineRuntimeStatus?: OfflineRuntimeStatus;
}

export function collectEvidence(result: ScenarioExecutionResult): Pick<InstanceReport, "screenshots" | "downloadedFiles"> {
  const screenshots: string[] = [];
  const downloadedFiles: string[] = [];

  result.flows.forEach((flow) => {
    flow.steps.forEach((step) => {
      if (step.screenshotPath) screenshots.push(step.screenshotPath);
      if (step.downloadedFilePath) downloadedFiles.push(step.downloadedFilePath);
    });
  });

  return { screenshots, downloadedFiles };
}
