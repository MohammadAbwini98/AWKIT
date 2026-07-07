/**
 * Live execution progress. The runner emits lightweight per-step events; the ExecutionEngine folds
 * them into a bounded snapshot stored on the instance runtime state so the renderer (which already
 * polls instances every ~1s) can show true live per-flow/per-step progress before the final report
 * is written. No secrets are carried — messages are produced from step names/types only.
 */
import type { HandoffInfo } from "@src/security/ProtectedLoginHandoff";

export type LiveStepStatus =
  | "pending"
  | "running"
  | "waiting"
  | "waitingForManualAction"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

/** One emitted progress event from the runner (per step lifecycle transition). */
export interface RunnerProgressEvent {
  instanceId: string;
  flowId?: string;
  flowLabel?: string;
  stepId?: string;
  stepLabel?: string;
  stepType?: string;
  status: LiveStepStatus;
  message?: string;
  manualHandoff?: HandoffInfo;
  error?: string;
  retryCount?: number;
  timestamp: string;
  durationMs?: number;
  /** Saved failure-trace zip for this step attempt (engine-run failures only). */
  tracePath?: string;
  /** Sanitized page URL at failure time (origin + path only — never query/fragment). */
  currentUrl?: string;
  /** Side-effect classification of the step (Phase 3 safety metadata; set on `running` events). */
  sideEffectLevel?: string;
}

export interface RunnerProgressReporter {
  report(event: RunnerProgressEvent): void;
}

/** Per-step state accumulated in the live snapshot (bounded). */
export interface LiveStepSnapshot {
  flowId?: string;
  flowLabel?: string;
  stepId: string;
  stepLabel?: string;
  stepType?: string;
  status: LiveStepStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  error?: string;
  retryCount?: number;
}

export interface LiveEventSnapshot {
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  stepId?: string;
}

/** Bounded live snapshot kept on `InstanceRuntimeState.liveProgress`. */
export interface LiveExecutionSnapshot {
  currentFlowId?: string;
  currentFlowLabel?: string;
  currentStepId?: string;
  currentStepLabel?: string;
  currentStatus?: LiveStepStatus;
  updatedAt: string;
  steps: LiveStepSnapshot[];
  events: LiveEventSnapshot[];
  errorSummary?: string;
}

export const LIVE_PROGRESS_MAX_EVENTS = 200;
export const LIVE_PROGRESS_MAX_STEPS = 500;
