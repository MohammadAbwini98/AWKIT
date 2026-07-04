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
