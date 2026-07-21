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
  /**
   * Security posture this run executed under. Recorded so a report reader can tell whether HTTPS
   * certificate validation was in force — a passing run against an untrusted certificate must not look
   * identical to one against a trusted certificate. Contains no URLs, credentials, or host data.
   */
  security?: {
    /** True when the run's browser contexts were created with `ignoreHTTPSErrors`. */
    ignoreHttpsErrors: boolean;
    /** Which precedence tier supplied the value (run / workflow / app / default). */
    ignoreHttpsErrorsSource?: "run" | "workflow" | "app" | "default";
  };
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
