import type { InstanceRuntimeState } from "@src/instances/InstanceRuntimeState";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";

/**
 * Renderer-side adapter that turns the live instance state + workflow definition + (for finished
 * runs) the stored report into a human-readable execution-report model. No raw JSON is exposed; log
 * messages are already secret-masked by the runner's MemoryRunnerLogger.
 */

export type ExecutionStepStatus =
  | "pending"
  | "running"
  | "waiting"
  | "waitingForManualAction"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

export interface ExecutionReportStep {
  id: string;
  label: string;
  flowLabel?: string;
  type?: string;
  status: ExecutionStepStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  message?: string;
  error?: string;
  retryCount?: number;
  screenshotCount?: number;
}

export interface ExecutionReportProgress {
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  percent: number;
  label: string;
}

export interface ExecutionReportEvent {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  stepId?: string;
}

export interface ExecutionReportStats {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  pendingSteps: number;
  runningSteps: number;
  successRate?: number;
  elapsedMs?: number;
  averageStepDurationMs?: number;
  longestStepLabel?: string;
  longestStepDurationMs?: number;
  retryCount?: number;
  screenshotCount?: number;
  errorCount?: number;
}

export interface LiveExecutionReport {
  instanceId: string;
  instanceName: string;
  workflowName: string;
  status: string;
  /** True while the run is still active (running/queued/waiting). */
  live: boolean;
  currentStepId?: string;
  currentActivity?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
  steps: ExecutionReportStep[];
  events: ExecutionReportEvent[];
  stats: ExecutionReportStats;
  progress?: ExecutionReportProgress;
  hasDetailedResults: boolean;
}

type StoredReport = ConcurrentRunReport & { id: string };

const ACTIVE_STATUSES = new Set(["pending", "queued", "starting", "running", "paused", "waitingForManualAction", "stopping", "cleaningUp"]);
const TERMINAL_STATUSES = new Set(["completed", "done", "succeeded", "failed", "cancelled", "skipped", "stopped", "error"]);

export function isLiveExecutionStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status) && !TERMINAL_STATUSES.has(status);
}

function logLevel(level: string): ExecutionReportEvent["level"] {
  if (level === "error") return "error";
  if (level === "warn") return "warning";
  return "info";
}

function flowLabel(workflow: WorkflowProfile | undefined, flowId: string): string {
  const node = workflow?.nodes.find((n) => n.flowId === flowId);
  return node?.alias || flowId;
}

function safeTechnicalError(error?: string): string | undefined {
  if (!error) return undefined;
  return error
    .replace(/((password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|session)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi, "$1[masked]")
    .replace(/((set-cookie|cookie|authorization)\s*:\s*)[^\r\n]+/gi, "$1[masked]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[masked]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[masked]");
}

function defaultStepMessage(status: ExecutionStepStatus): string {
  switch (status) {
    case "running":
      return "Waiting for this step to complete before continuing.";
    case "waiting":
      return "Waiting for page response.";
    case "waitingForManualAction":
      return "Complete the required action in the browser to continue.";
    case "succeeded":
      return "Completed.";
    case "failed":
      return "This step failed before the workflow could continue.";
    case "skipped":
      return "Skipped.";
    case "cancelled":
      return "Cancelled.";
    default:
      return "Ready when the workflow reaches this step.";
  }
}

function withFriendlyStepMessage(step: ExecutionReportStep): ExecutionReportStep {
  return {
    ...step,
    message: step.message ?? defaultStepMessage(step.status),
    error: step.status === "failed" ? safeTechnicalError(step.error) : undefined
  };
}

function resolveUpdatedAt(
  instance: InstanceRuntimeState,
  live: boolean,
  liveSnapshot: InstanceRuntimeState["liveProgress"],
  scenario: StoredReport["instances"][number]["scenarioResult"] | undefined,
  stored: StoredReport | undefined,
  now: string
): string {
  if (live) return liveSnapshot?.updatedAt ?? instance.startedAt ?? now;
  return scenario?.endedAt ?? instance.endedAt ?? stored?.endedAt ?? liveSnapshot?.updatedAt ?? instance.startedAt ?? now;
}

/** A friendly current-activity line for the banner. */
export function describeActivity(instance: InstanceRuntimeState): string {
  switch (instance.status) {
    case "running":
    case "starting":
      return instance.currentStep && instance.currentStep !== "Waiting to start"
        ? `Running: ${instance.currentStep}`
        : "Running… waiting for this step to complete before continuing.";
    case "waitingForManualAction":
      return instance.manualHandoff?.message ?? "Waiting for manual action…";
    case "paused":
      return "Paused.";
    case "queued":
      return "Queued — waiting for an available slot…";
    case "pending":
      return "Preparing to start…";
    case "completed":
      return "Completed successfully.";
    case "failed":
      return "Run failed — see the error and timeline below.";
    case "cancelled":
      return "Run was cancelled.";
    default:
      return (instance.status as string) === "stopped" ? "Run was cancelled." : instance.currentStep ?? "—";
  }
}

export function buildLiveExecutionReport(
  instance: InstanceRuntimeState,
  workflow: WorkflowProfile | undefined,
  stored: StoredReport | undefined,
  now: string
): LiveExecutionReport {
  const live = isLiveExecutionStatus(instance.status);
  const instanceReport = stored?.instances.find((i) => i.instanceId === instance.instanceId);
  const scenario = instanceReport?.scenarioResult;

  const liveSnapshot = instance.liveProgress;

  // ── Node map: per-step (finished report or live snapshot), else coarse per-flow ──
  let steps: ExecutionReportStep[] = [];
  let currentStepId: string | undefined;
  let hasDetailed = false;

  if (scenario && scenario.flows.length) {
    steps = scenario.flows.flatMap((flow) =>
      flow.steps.map((step) =>
        withFriendlyStepMessage({
          id: `${flow.flowId}:${step.stepId}`,
          label: step.stepId,
          flowLabel: flowLabel(workflow, flow.flowId),
          status: stepResultToStatus(step.status),
          startedAt: step.startedAt,
          finishedAt: step.endedAt,
          durationMs: step.durationMs,
          error: step.error,
          screenshotCount: step.screenshotPath ? 1 : undefined
        })
      )
    );
    currentStepId = steps.find((step) => step.status === "failed" || step.status === "waitingForManualAction")?.id;
    hasDetailed = true;
  } else if (liveSnapshot && liveSnapshot.steps.length) {
    steps = liveSnapshot.steps.map((step) =>
      withFriendlyStepMessage({
        id: `${step.flowId ?? ""}:${step.stepId}`,
        label: step.stepLabel ?? step.stepId,
        flowLabel: step.flowLabel,
        type: step.stepType,
        status: step.status,
        startedAt: step.startedAt,
        finishedAt: step.endedAt,
        durationMs: step.durationMs,
        error: step.error,
        retryCount: step.retryCount
      })
    );
    if (liveSnapshot.currentStepId) currentStepId = `${liveSnapshot.currentFlowId ?? ""}:${liveSnapshot.currentStepId}`;
    hasDetailed = true;
  } else if (workflow) {
    const ordered = [...workflow.nodes].sort((a, b) => a.order - b.order);
    steps = ordered.map((node, index) => {
      let status: ExecutionStepStatus = "pending";
      if (instance.status === "completed") status = "succeeded";
      else if (instance.status === "cancelled" || (instance.status as string) === "stopped") status = "cancelled";
      else if (instance.status === "failed") status = index === 0 ? "failed" : "skipped";
      else if (instance.status === "waitingForManualAction" && isActiveFlow(instance, node.flowId, index)) status = "waitingForManualAction";
      else if (instance.status === "running" && isActiveFlow(instance, node.flowId, index)) status = "running";
      if (status === "running" || status === "waitingForManualAction") currentStepId = node.flowId;
      return withFriendlyStepMessage({ id: node.flowId, label: node.alias || node.flowId, type: "flow", status });
    });
  }

  // ── Timeline ─────────────────────────────────────────────────────────────────
  let events: ExecutionReportEvent[];
  if (scenario && scenario.logs.length) {
    events = scenario.logs.map((log, index) => ({ id: `log-${index}`, timestamp: log.timestamp, level: logLevel(log.level), message: log.message, stepId: log.stepId }));
  } else if (liveSnapshot && liveSnapshot.events.length) {
    events = liveSnapshot.events.map((entry, index) => ({ id: `live-${index}`, timestamp: entry.timestamp, level: entry.level, message: entry.message, stepId: entry.stepId }));
  } else {
    events = synthesizeEvents(instance, now);
  }

  // ── Stats ────────────────────────────────────────────────────────────────────
  const stats = scenario
    ? statsFromScenario(scenario, instanceReport?.screenshots.length, instance)
    : liveSnapshot && liveSnapshot.steps.length
      ? statsFromSteps(steps, instance)
      : statsFromNodeMap(steps, instance);

  const updatedAt = resolveUpdatedAt(instance, live, liveSnapshot, scenario, stored, now);

  return {
    instanceId: instance.instanceId,
    instanceName: instance.config.name,
    workflowName: workflow?.name ?? instance.scenarioId,
    status: instance.status,
    live,
    currentStepId,
    currentActivity: describeActivity(instance),
    startedAt: instance.startedAt,
    endedAt: instance.endedAt,
    updatedAt,
    steps,
    events,
    stats,
    progress: progressFromSteps(steps),
    hasDetailedResults: hasDetailed
  };
}

function stepResultToStatus(status: string): ExecutionStepStatus {
  switch (status) {
    case "passed":
      return "succeeded";
    case "failed":
      return "failed";
    case "manualHandoff":
      return "waitingForManualAction";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

function statsFromSteps(steps: ExecutionReportStep[], instance: InstanceRuntimeState): ExecutionReportStats {
  const total = steps.length;
  const completed = steps.filter((s) => s.status === "succeeded").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const pending = steps.filter((s) => s.status === "pending").length;
  const running = steps.filter((s) => s.status === "running" || s.status === "waiting" || s.status === "waitingForManualAction").length;
  const durations = steps.filter((s) => typeof s.durationMs === "number");
  const longest = durations.reduce<{ label: string; ms: number } | null>((max, s) => (!max || (s.durationMs ?? 0) > max.ms ? { label: s.label, ms: s.durationMs ?? 0 } : max), null);
  const avg = durations.length ? Math.round(durations.reduce((sum, s) => sum + (s.durationMs ?? 0), 0) / durations.length) : undefined;
  const retries = steps.reduce((sum, s) => sum + (s.retryCount ?? 0), 0);
  return {
    totalSteps: total,
    completedSteps: completed,
    failedSteps: failed,
    pendingSteps: pending,
    runningSteps: running,
    successRate: total && !running && !pending ? Math.round((completed / total) * 100) : undefined,
    elapsedMs: instance.durationMs || undefined,
    averageStepDurationMs: avg,
    longestStepLabel: longest?.label,
    longestStepDurationMs: longest?.ms,
    retryCount: retries || undefined,
    errorCount: failed
  };
}

function isActiveFlow(instance: InstanceRuntimeState, flowId: string, index: number): boolean {
  if (instance.currentFlow) return instance.currentFlow === flowId;
  return index === 0; // best-effort when the engine hasn't reported a current flow
}

function synthesizeEvents(instance: InstanceRuntimeState, now: string): ExecutionReportEvent[] {
  const events: ExecutionReportEvent[] = [];
  if (instance.startedAt) events.push({ id: "started", timestamp: instance.startedAt, level: "info", message: "Run started." });
  if (instance.status === "waitingForManualAction") {
    events.push({ id: "handoff", timestamp: instance.manualHandoff?.requestedAt ?? now, level: "warning", message: instance.manualHandoff?.message ?? "Waiting for manual action." });
  }
  if (instance.status === "completed") events.push({ id: "done", timestamp: instance.endedAt ?? now, level: "success", message: "Run completed successfully." });
  if (instance.status === "failed") events.push({ id: "fail", timestamp: instance.endedAt ?? now, level: "error", message: "Run failed." });
  if (instance.status === "cancelled" || (instance.status as string) === "stopped") events.push({ id: "cancel", timestamp: instance.endedAt ?? now, level: "warning", message: "Run was cancelled." });
  if (!events.length) events.push({ id: "live", timestamp: now, level: "info", message: describeActivity(instance) });
  return events;
}

function statsFromScenario(
  scenario: NonNullable<NonNullable<StoredReport["instances"][number]["scenarioResult"]>>,
  screenshotCount: number | undefined,
  instance: InstanceRuntimeState
): ExecutionReportStats {
  const allSteps = scenario.flows.flatMap((flow) => flow.steps);
  const total = allSteps.length;
  const completed = allSteps.filter((s) => s.status === "passed").length;
  const failed = allSteps.filter((s) => s.status === "failed").length;
  const durations = allSteps.filter((s) => typeof s.durationMs === "number");
  const longest = durations.reduce<{ id: string; ms: number } | null>((max, s) => (!max || s.durationMs > max.ms ? { id: s.stepId, ms: s.durationMs } : max), null);
  const avg = durations.length ? Math.round(durations.reduce((sum, s) => sum + s.durationMs, 0) / durations.length) : undefined;
  return {
    totalSteps: total,
    completedSteps: completed,
    failedSteps: failed,
    pendingSteps: 0,
    runningSteps: 0,
    successRate: total ? Math.round((completed / total) * 100) : undefined,
    elapsedMs: instance.durationMs || scenario.durationMs,
    averageStepDurationMs: avg,
    longestStepLabel: longest?.id,
    longestStepDurationMs: longest?.ms,
    screenshotCount,
    errorCount: failed
  };
}

function statsFromNodeMap(steps: ExecutionReportStep[], instance: InstanceRuntimeState): ExecutionReportStats {
  const by = (s: ExecutionStepStatus) => steps.filter((step) => step.status === s).length;
  return {
    totalSteps: steps.length,
    completedSteps: by("succeeded"),
    failedSteps: by("failed"),
    pendingSteps: by("pending"),
    runningSteps: by("running") + by("waiting") + by("waitingForManualAction"),
    successRate: undefined,
    elapsedMs: instance.durationMs || undefined,
    errorCount: by("failed")
  };
}

function progressFromSteps(steps: ExecutionReportStep[]): ExecutionReportProgress | undefined {
  const total = steps.length;
  if (!total) return undefined;
  const failedIndex = steps.findIndex((step) => step.status === "failed");
  const countableSteps = failedIndex >= 0 ? steps.slice(0, failedIndex) : steps;
  const completed = countableSteps.filter((step) => step.status === "succeeded" || step.status === "skipped").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const running = steps.filter((step) => step.status === "running" || step.status === "waiting" || step.status === "waitingForManualAction").length;
  const pending = steps.filter((step) => step.status === "pending").length;
  const failedStep = failedIndex >= 0 ? steps[failedIndex] : undefined;
  const activeStep = steps.find((step) => step.status === "running" || step.status === "waiting" || step.status === "waitingForManualAction");
  const percent = Math.min(100, Math.max(0, Math.round((completed / total) * 100)));
  const label = failedStep
    ? `Stopped at ${failedStep.label}`
    : activeStep
      ? `Current: ${activeStep.label}`
      : completed === total
        ? "Complete"
        : `${completed} of ${total} steps complete`;
  return { total, completed, failed, running, pending, percent, label };
}
