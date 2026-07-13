/**
 * Shared read-model contracts for the reporting UI. These are the shapes the renderer receives
 * from the `telemetry:*` IPC channels (Phase 4). All queries are windowed/paginated; aggregation
 * happens in the store (SQL + bounded JS), never in the renderer.
 * See docs/ai/ui-reports-refactor/04_*.md and 05_*.md.
 */
import type { ReportCategory } from "./ReportCategories";
import type { DurableArtifactRecord, DurableAttemptRecord, DurableProcessSampleRecord, DurableRunRecord } from "@src/runner/store/RuntimeStoreSchema";

/** Time window for a query. `sinceIso` undefined = all-time. */
export interface TelemetryRange {
  sinceIso?: string;
}

/** Preset ranges the UI offers (converted to `sinceIso` at the IPC boundary). */
export type TelemetryRangePreset = "15m" | "1h" | "24h" | "7d" | "all";

export interface TelemetryPage {
  limit?: number;
  offset?: number;
}

/**
 * Per-run machine context (migration v3). Lets reports label + filter runs by the machine they ran on,
 * so runs from different machines are never silently compared. All fields optional (pre-v3 rows / partial
 * detection read back as "Unknown").
 */
export interface MachineRunContext {
  machineId?: string;
  logicalCpuCount?: number;
  totalMemoryMb?: number;
  availableMemoryMbAtStart?: number;
  executionMode?: string; // sequential | auto | manual
  browserPoolMode?: string; // shared | dedicated
  configuredConcurrency?: number;
  observedPeakConcurrency?: number;
  workloadClass?: string;
  capacityRecommendationAtRun?: number;
}

/** Machine/mode/pool/class filter shared by comparison, trend, and run-history queries. */
export interface MachineFilter {
  machineId?: string;
  executionMode?: string;
  browserPoolMode?: string;
  workloadClass?: string;
}

/** Optional filters for run-history queries (workflow drill-down, status + machine filtering). */
export interface RunHistoryFilter extends MachineFilter {
  scenarioId?: string;
  status?: string;
}

export interface DurationStats {
  avgMs?: number;
  medianMs?: number;
  p95Ms?: number;
}

export interface TelemetryOverview {
  /** False when the durable store is disabled (AWKIT_DURABLE_STORE=0) — UI shows a notice. */
  storeEnabled: boolean;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  otherRuns: number;
  successRate: number;
  failureRate: number;
  duration: DurationStats;
  avgQueueWaitMs?: number;
  /** Coarse runs-over-time series for a sparkline (bucketed server-side). */
  runsSeries: RunsSeriesPoint[];
}

export interface RunsSeriesPoint {
  bucketIso: string;
  total: number;
  failed: number;
}

export interface WorkflowReportRow {
  scenarioId?: string;
  scenarioName?: string;
  totalRuns: number;
  success: number;
  failed: number;
  cancelled: number;
  successRate: number;
  duration: DurationStats;
  avgQueueWaitMs?: number;
  retryCount: number;
  lastRunStatus?: string;
  lastRunAt?: string;
}

/** Per-metric change of a workflow vs the previous window (undefined when there is no prior data). */
export interface WorkflowDelta {
  successRate?: number;
  avgMs?: number;
  p95Ms?: number;
  totalRuns?: number;
}

/**
 * One workflow's current-window stats plus its previous-window comparison. `previous` is undefined when
 * the workflow had no runs in the prior window (then `trend` is `new`). Deltas are `current − previous`.
 */
export interface WorkflowComparisonRow extends WorkflowReportRow {
  previous?: WorkflowReportRow;
  delta: WorkflowDelta;
  trend: "up" | "down" | "flat" | "new";
  /** Representative machine context (from this workflow's most recent run in the current window). */
  machineContext?: MachineRunContext;
}

/** One time-bucket of a single workflow's run-over-run trend. */
export interface WorkflowTrendPoint {
  bucketIso: string;
  totalRuns: number;
  success: number;
  failed: number;
  successRate: number;
  avgMs?: number;
  p95Ms?: number;
}

export interface WorkflowTrend {
  scenarioId?: string;
  scenarioName?: string;
  points: WorkflowTrendPoint[];
}

/** A machine seen in run history (for the reports machine filter). */
export interface MachineSummary extends MachineRunContext {
  runs: number;
  lastRunAt?: string;
}

export interface RunHistoryRow {
  instanceId: string;
  executionId: string;
  scenarioId?: string;
  scenarioName?: string;
  status: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  queueWaitMs?: number;
  reportCategory?: string;
  errorClass?: string;
}

export interface RunHistoryPage {
  rows: RunHistoryRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface RunDetail {
  run?: DurableRunRecord;
  attempts: DurableAttemptRecord[];
  artifacts: DurableArtifactRecord[];
}

export interface FailureCategoryCount {
  category: ReportCategory;
  count: number;
}

export interface FailureBreakdown {
  total: number;
  categories: FailureCategoryCount[];
  /** Scenarios with the most failed runs in range. */
  topWorkflows: Array<{ scenarioId?: string; scenarioName?: string; failed: number }>;
}

export interface RuntimeSeriesPoint {
  bucketIso: string;
  activeBrowsers: number;
  activeFlows: number;
  activePages: number;
  queueDepth: number;
  systemMemoryPercent?: number;
  cpuPercent?: number;
}

export interface ProcessHistoryPoint {
  timestamp: string;
  chromiumProcessCount?: number;
  chromiumMemoryMb?: number;
  electronMainMemoryMb?: number;
  activeBrowsers?: number;
  pageCount?: number;
  availability?: string;
}

export interface StorageUsage {
  reportsMb: number;
  screenshotsMb: number;
  logsMb: number;
  downloadsMb: number;
  runtimeDbMb: number;
  totalMb: number;
}

export interface ServerReport {
  storage: StorageUsage;
  systemMemoryPercent?: number;
  cpuPercent?: number;
  processRssMb: number;
  processCpuPercent?: number;
  chromiumMemoryMb?: number;
  electronMainMemoryMb?: number;
  backpressureBlocked: boolean;
  backpressureReason?: string;
  processAvailability?: string;
}

export function processSampleToHistoryPoint(sample: DurableProcessSampleRecord): ProcessHistoryPoint {
  return {
    timestamp: sample.timestamp,
    chromiumProcessCount: sample.chromiumProcessCount,
    chromiumMemoryMb: sample.chromiumMemoryMb,
    electronMainMemoryMb: sample.electronMainMemoryMb,
    activeBrowsers: sample.activeBrowsers,
    pageCount: sample.pageCount,
    availability: sample.availability
  };
}

/** Project a durable run row's machine-context columns into a MachineRunContext (undefined fields dropped). */
export function machineContextFromRun(run: DurableRunRecord): MachineRunContext {
  return {
    machineId: run.machineId,
    logicalCpuCount: run.logicalCpuCount,
    totalMemoryMb: run.totalMemoryMb,
    availableMemoryMbAtStart: run.availableMemoryMbAtStart,
    executionMode: run.executionMode,
    browserPoolMode: run.browserPoolMode,
    configuredConcurrency: run.configuredConcurrency,
    observedPeakConcurrency: run.observedPeakConcurrency,
    workloadClass: run.workloadClass,
    capacityRecommendationAtRun: run.capacityRecommendationAtRun
  };
}

/** Percentile helper (nearest-rank) used by the store aggregates. Undefined for empty input. */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function durationStats(values: number[]): DurationStats {
  if (values.length === 0) return {};
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    avgMs: Math.round(sum / values.length),
    medianMs: percentile(values, 50),
    p95Ms: percentile(values, 95)
  };
}
