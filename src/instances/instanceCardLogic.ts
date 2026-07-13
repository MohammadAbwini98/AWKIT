/**
 * Framework-agnostic logic for the Concurrent Instance Monitor's workflow cards.
 * Kept free of React/DOM so it can be unit-verified (scripts/verify-instance-monitor.mts)
 * and reused by the renderer (app/renderer/pages/InstanceMonitor.tsx).
 */

export interface CardRunParams {
  totalRuns: number;
  concurrentInstances: number;
  runMode: "headed" | "headless";
  isolationMode: "browserContext" | "persistentContext";
  screenshotOnFailure: boolean;
  stopOnError: boolean;
}

export interface CardParamLimits {
  maxRuns: number;
  maxConcurrentRuns: number;
}

export type WorkflowRunSummaryStatus = "queued" | "running" | "attention" | "stopping" | "completed" | "failed" | "cancelled" | "mixed";

export interface WorkflowRunSummary {
  executionId: string;
  scenarioId: string;
  total: number;
  pending: number;
  running: number;
  paused: number;
  stopping: number;
  completed: number;
  failed: number;
  cancelled: number;
  progressPercent: number;
  status: WorkflowRunSummaryStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs: number;
}

interface WorkflowInstanceLike {
  executionId: string;
  scenarioId: string;
  status: string;
  startedAt?: string;
  endedAt?: string;
  durationMs: number;
}

const STOPPABLE_INSTANCE_STATUSES = new Set(["pending", "queued", "starting", "running", "waitingForManualAction", "paused"]);

/** True when Stop All or the per-instance stop control can still cancel useful work. */
export function isInstanceStoppable(status: string): boolean {
  return STOPPABLE_INSTANCE_STATUSES.has(status);
}

/** Group live instance-pool rows into one summary record per workflow execution. */
export function summarizeWorkflowRuns(instances: WorkflowInstanceLike[]): WorkflowRunSummary[] {
  const groups = new Map<string, WorkflowInstanceLike[]>();
  for (const instance of instances) {
    const current = groups.get(instance.executionId);
    if (current) current.push(instance);
    else groups.set(instance.executionId, [instance]);
  }

  return [...groups.values()]
    .map((group): WorkflowRunSummary => {
      const count = (statuses: string[]) => group.filter((instance) => statuses.includes(instance.status)).length;
      const pending = count(["pending", "queued"]);
      const running = count(["starting", "running"]);
      const paused = count(["paused", "waitingForManualAction"]);
      const stopping = count(["stopping", "cleaningUp"]);
      const completed = count(["completed"]);
      const failed = count(["failed"]);
      const cancelled = count(["cancelled", "stopped"]);
      const terminal = completed + failed + cancelled;
      const starts = group
        .filter((instance) => instance.startedAt)
        .map((instance) => instance.startedAt as string)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      const ends = group
        .filter((instance) => instance.endedAt)
        .map((instance) => instance.endedAt as string)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

      let status: WorkflowRunSummaryStatus;
      if (running > 0) status = "running";
      else if (paused > 0) status = "attention";
      else if (pending > 0) status = "queued";
      else if (stopping > 0) status = "stopping";
      else if (failed > 0) status = "failed";
      else if (completed === group.length) status = "completed";
      else if (cancelled === group.length) status = "cancelled";
      else status = "mixed";

      return {
        executionId: group[0].executionId,
        scenarioId: group[0].scenarioId,
        total: group.length,
        pending,
        running,
        paused,
        stopping,
        completed,
        failed,
        cancelled,
        progressPercent: group.length ? Math.round((terminal / group.length) * 100) : 0,
        status,
        startedAt: starts[0],
        endedAt: pending + running + paused + stopping === 0 ? ends[0] : undefined,
        durationMs: Math.max(0, ...group.map((instance) => instance.durationMs || 0))
      };
    })
    .sort((a, b) => {
      const rank = (status: WorkflowRunSummaryStatus) => (["running", "attention", "queued", "stopping"].includes(status) ? 0 : 1);
      const rankDelta = rank(a.status) - rank(b.status);
      if (rankDelta) return rankDelta;
      const aTime = new Date(a.startedAt ?? a.endedAt ?? 0).getTime();
      const bTime = new Date(b.startedAt ?? b.endedAt ?? 0).getTime();
      return bTime - aTime;
    });
}

/** Case-insensitive filter by workflow name and description. */
export function filterWorkflows<T extends { name: string; description?: string }>(workflows: T[], query: string): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return workflows;
  return workflows.filter(
    (workflow) => workflow.name.toLowerCase().includes(normalized) || (workflow.description ?? "").toLowerCase().includes(normalized)
  );
}

/** Visible card count from the responsive column count × the number of shown rows (≥1 column). */
export function visibleCardCount(columns: number, rows: number): number {
  return Math.max(Math.floor(columns), 1) * Math.max(Math.floor(rows), 0);
}

/** Per-card run-parameter validation. Returns human-readable error strings (empty when valid). */
export function validateCardParams(
  params: Pick<CardRunParams, "totalRuns" | "concurrentInstances">,
  limits: CardParamLimits,
  requiresDataSource: boolean,
  dataSourceAvailable: boolean
): string[] {
  const errors: string[] = [];
  if (params.totalRuns < 1) errors.push("Total runs must be ≥ 1.");
  if (params.concurrentInstances < 1) errors.push("Concurrent must be ≥ 1.");
  if (params.concurrentInstances > params.totalRuns) errors.push("Concurrent cannot exceed total runs.");
  if (params.totalRuns > limits.maxRuns) errors.push(`Total runs cannot exceed ${limits.maxRuns}.`);
  if (params.concurrentInstances > limits.maxConcurrentRuns) errors.push(`Concurrent cannot exceed ${limits.maxConcurrentRuns}.`);
  if (requiresDataSource && !dataSourceAvailable) errors.push("Required data source is missing.");
  return errors;
}

/** Resolve an instance's workflow display name from its scenarioId (handles deleted/unknown). */
export function resolveWorkflowName(nameById: Map<string, string>, scenarioId: string): { name: string; missing: boolean } {
  const name = nameById.get(scenarioId);
  if (name) return { name, missing: false };
  return { name: scenarioId ? "Deleted workflow" : "Unknown workflow", missing: true };
}
