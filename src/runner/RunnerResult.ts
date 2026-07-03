import type { StructuredLog } from "@src/reports/StructuredLog";
import { SecretMasker } from "@src/reports/SecretMasker";
import type { HandoffInfo } from "@src/security/ProtectedLoginHandoff";

export type StepExecutionStatus = "passed" | "failed" | "skipped" | "manualHandoff";

export interface StepExecutionResult {
  stepId: string;
  status: StepExecutionStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outputs: Record<string, unknown>;
  screenshotPath?: string;
  downloadedFilePath?: string;
  error?: string;
  /** Optional machine-readable error code for conditional connector routing. */
  errorCode?: string;
  nextStepId?: string;
  /** Semantic outcome for connector routing (e.g. sessionAlreadyExists, sessionCaptured, sessionLoaded). */
  outcome?: string;
  /** Set by Auto Secure Login after a capture: the flow should restart from Start (guarded by a counter). */
  restartRequired?: boolean;
  /** Set when the step paused for a manual / protected-login handoff (no secrets). */
  manualHandoff?: HandoffInfo;
}

export interface FlowExecutionResult {
  flowId: string;
  status: "passed" | "failed" | "manualHandoff";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  steps: StepExecutionResult[];
  outputs: Record<string, unknown>;
  error?: string;
  manualHandoff?: HandoffInfo;
}

export interface ScenarioExecutionResult {
  scenarioId: string;
  executionId: string;
  instanceId: string;
  status: "passed" | "failed" | "manualHandoff";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  flows: FlowExecutionResult[];
  logs: StructuredLog[];
  error?: string;
  manualHandoff?: HandoffInfo;
}

export interface RunnerLogger {
  log(entry: StructuredLog): void;
}

export class MemoryRunnerLogger implements RunnerLogger {
  readonly entries: StructuredLog[] = [];
  private readonly masker = new SecretMasker();

  log(entry: StructuredLog): void {
    this.entries.push({
      ...entry,
      message: this.masker.maskText(entry.message),
      data: entry.data ? this.masker.maskRecord(entry.data) : undefined
    });
  }
}
