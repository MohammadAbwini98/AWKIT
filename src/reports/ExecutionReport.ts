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
  /**
   * Legacy Compatibility grants this run was admitted under (awkit-vbj).
   *
   * A run that only executed because a flow holds a grant used to report `passed` with nothing
   * anywhere to say so — the audit trail existed on the grant record, but an operator reading the
   * report could not tell. Same reasoning as `security` above: a run admitted by an exemption must
   * not look identical to one that passed the validator outright.
   *
   * Absent when no grant was involved, so its mere presence is the signal. Snapshotted from the
   * grants standing AT ADMISSION, not re-derived at read time: grants expire and are revoked, and a
   * historical report must keep saying what was true when the run started.
   */
  legacyCompatibility?: {
    flows: Array<{
      flowId: string;
      /** Flow name at admission, for a report a human can read without a lookup. */
      flowName?: string;
      /** When the grant lapses — the deadline the exemption is buying time against. */
      expiresAt?: string;
    }>;
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
