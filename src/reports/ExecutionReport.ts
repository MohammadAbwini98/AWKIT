import type { OfflineRuntimeStatus } from "@src/offline/OfflineRuntimeValidator";
import type { InstanceDiagnostics } from "@src/runner/evidence/FailureEvidenceCollector";
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
  /**
   * Phase L L5a run-lifetime failure evidence and its deterministic cause baseline. Optional: absent
   * on reports written before L5a, on clean passed runs, and when `AWKIT_FAILURE_EVIDENCE=0`.
   */
  diagnostics?: InstanceDiagnostics;
}

/** A T0 failure interpretation, as shown and as stored. Evidence ids name the analysed instance's own events. */
export interface FailureAnalysisBody {
  insufficient: boolean;
  category: string;
  explanation: string;
  primaryEvidenceIds: string[];
  secondaryEvidenceIds: string[];
  investigationSteps: string[];
}

/**
 * Phase L L5b: one stored AI interpretation per failure signature. Kept apart from every instance's L5a
 * evidence and baseline, which it never changes; it lives and dies with this report, and is deletable
 * and recomputable (DECISIONS, 2026-09-19 privacy policy). Its text was redacted and rescanned first.
 */
export interface StoredFailureAnalysis {
  version: 1;
  signature: string;
  /** The instance analysed: the evidence ids refer to ITS captured events. */
  instanceId: string;
  /** Coalesced references: every failed instance in the run sharing the signature when it was analysed. */
  instanceIds: string[];
  createdAt: string;
  modelId?: string;
  analysis: FailureAnalysisBody;
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
  /** Phase L L5b stored analyses. Optional: absent on every report nobody asked AI about. */
  diagnostics?: { analyses: StoredFailureAnalysis[] };
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
