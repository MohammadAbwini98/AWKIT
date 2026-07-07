import type { InstanceExecutionContext } from "@src/runner/InstanceExecutionContext";
import type { LiveExecutionSnapshot } from "@src/runner/RunnerProgress";
import type { HandoffInfo } from "@src/security/ProtectedLoginHandoff";
import type { InstanceConfig } from "./InstanceConfig";
import type { InstanceResourcePolicy } from "./InstanceResourcePolicy";
import type { InstanceStatus } from "./InstanceStatus";

export interface InstanceRuntimePaths {
  downloads: string;
  screenshots: string;
  logs: string;
  reports: string;
  storage: string;
  /** Failure-trace output dir (arms per-step trace capture when present). */
  traces?: string;
  userDataDir?: string;
}

export interface InstanceRuntimeState {
  executionId: string;
  instanceId: string;
  scenarioId: string;
  /** 1-based order of this instance within the run. */
  instanceOrderNumber?: number;
  totalInstances?: number;
  config: InstanceConfig;
  status: InstanceStatus;
  currentFlow?: string;
  currentStep?: string;
  currentDataRowIndex?: number;
  currentDataRow?: unknown;
  queuePosition?: number;
  startedAt?: string;
  endedAt?: string;
  durationMs: number;
  retryAttempt: number;
  manualHandoff?: {
    message: string;
    requestedAt: string;
    /** Protected-login detail (provider/reason/url/allowedActions) — never contains secrets. */
    detail?: HandoffInfo;
  };
  /** Bounded live per-flow/per-step progress snapshot (updated by the runner during execution). */
  liveProgress?: LiveExecutionSnapshot;
  /**
   * Concurrency-layer runtime detail (additive; the UI-facing `status` above is unchanged).
   * `flowRunStatus` is the richer explicit state (incl. crashed/orphaned), `heartbeatAt` is
   * updated on every progress event so the watchdog can tell slow from stuck.
   */
  runtime?: {
    flowRunStatus: string;
    heartbeatAt?: string;
    browserWorkerId?: string;
    watchdogNote?: string;
  };
  paths: InstanceRuntimePaths;
  resourcePolicy: InstanceResourcePolicy;
  runtimeInputs: Record<string, unknown>;
  instanceInputs: Record<string, unknown>;
  flowOutputs: Record<string, unknown>;
}

export function toExecutionContext(state: InstanceRuntimeState): InstanceExecutionContext {
  return {
    executionId: state.executionId,
    instanceId: state.instanceId,
    scenarioId: state.scenarioId,
    instanceOrderNumber: state.instanceOrderNumber ?? (state.currentDataRowIndex ?? 0) + 1,
    totalInstances: state.totalInstances ?? 1,
    runtimeInputs: state.runtimeInputs,
    instanceInputs: state.instanceInputs,
    currentRow: state.currentDataRow,
    flowOutputs: state.flowOutputs,
    paths: {
      downloads: state.paths.downloads,
      screenshots: state.paths.screenshots,
      logs: state.paths.logs,
      reports: state.paths.reports,
      traces: state.paths.traces
    }
  };
}
