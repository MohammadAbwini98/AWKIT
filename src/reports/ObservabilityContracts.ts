/**
 * Read-model contracts for the Runtime Observability & Historical Analytics phase. These extend — never
 * replace — the existing `TelemetryContracts`. All queries are windowed and aggregated in the durable
 * store (SQL + bounded JS); the renderer never loads full history to compute totals/percentiles.
 *
 * Naming rule (Phase 02): every environmental resource field is named so it is unmistakably an observation
 * AROUND a run/window, never exclusive per-workflow ownership under a shared browser pool.
 *
 * See docs/ai/RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md.
 */
import type { DurationStats } from "./TelemetryContracts";

// ── Bounded enums ────────────────────────────────────────────────────────────

/**
 * Normalized admission-delay reasons. Bounded, low-cardinality; the SINGLE mapping from the runtime's
 * actual (free-text, number-laden) dispatch-loop block strings. Never inferred later from CPU values.
 */
export type AdmissionReason =
  | "browser-pool-saturated"
  | "active-flow-limit"
  | "host-memory-floor"
  | "browser-crash-rate"
  | "system-memory-pressure"
  | "process-memory-pressure"
  | "cpu-pressure"
  | "weighted-budget"
  | "origin-account-limit"
  | "other";

export const ADMISSION_REASONS: AdmissionReason[] = [
  "browser-pool-saturated",
  "active-flow-limit",
  "host-memory-floor",
  "browser-crash-rate",
  "system-memory-pressure",
  "process-memory-pressure",
  "cpu-pressure",
  "weighted-budget",
  "origin-account-limit",
  "other"
];

/** Human labels for the reason enum (UI). */
export const ADMISSION_REASON_LABELS: Record<AdmissionReason, string> = {
  "browser-pool-saturated": "Browser pool saturated",
  "active-flow-limit": "Active-flow limit",
  "host-memory-floor": "Host memory floor",
  "browser-crash-rate": "Browser crash rate",
  "system-memory-pressure": "System memory pressure",
  "process-memory-pressure": "Process memory pressure",
  "cpu-pressure": "CPU pressure",
  "weighted-budget": "Weighted budget",
  "origin-account-limit": "Origin/account limit",
  other: "Other"
};

/**
 * Map a runtime block reason string (from `BackpressureController.block()` / the engine's weighted +
 * origin/account block strings) to the bounded enum. Matching is on the leading phrase the runtime emits —
 * the trailing "(… numbers …)" is ignored. Unknown → "other" (never dropped).
 */
export function normalizeAdmissionReason(raw: string | undefined): AdmissionReason {
  if (!raw) return "other";
  // Idempotent: an already-normalized enum value (e.g. re-aggregating stored buckets) maps to itself.
  if ((ADMISSION_REASONS as readonly string[]).includes(raw)) return raw as AdmissionReason;
  const s = raw.toLowerCase();
  if (s.includes("browser pool saturated")) return "browser-pool-saturated";
  if (s.includes("active flow limit")) return "active-flow-limit";
  if (s.includes("low host memory")) return "host-memory-floor";
  if (s.includes("crash rate")) return "browser-crash-rate";
  if (s.includes("system memory pressure")) return "system-memory-pressure";
  if (s.includes("process memory pressure")) return "process-memory-pressure";
  if (s.includes("cpu pressure")) return "cpu-pressure";
  if (s.includes("weighted budget")) return "weighted-budget";
  if (s.includes("origin") || s.includes("account")) return "origin-account-limit";
  return "other";
}

/** Adaptive-controller / machine pressure state (reuses the controller's own state names). */
export type PressureState = "healthy" | "stable" | "pressure" | "critical" | "unknown";

export function normalizePressureState(raw: string | undefined): PressureState {
  switch (raw) {
    case "healthy":
    case "stable":
    case "pressure":
    case "critical":
      return raw;
    default:
      return "unknown";
  }
}

/** Shared-browser retirement reasons (mirrors `SharedBrowserCloseReason`). */
export type BrowserCloseReasonName =
  | "CONTEXT_COUNT_RECYCLE"
  | "MEMORY_THRESHOLD"
  | "IDLE_DRAIN"
  | "UNHEALTHY"
  | "CRASH"
  | "POOL_SHUTDOWN"
  | "LAUNCH_FAILURE"
  | "OTHER";

// ── Per-run environmental observation summary (Phase 02/04) ──────────────────

/**
 * Environmental resource observations aggregated over ONE run's window. These are correlations with the
 * run, not exclusive ownership — the `observed…DuringRun` naming is deliberate.
 */
export interface RunObservationSummary {
  sampleCount: number;
  observedSystemCpuMeanDuringRun?: number;
  observedSystemCpuP95DuringRun?: number;
  observedSystemMemoryMeanDuringRun?: number;
  observedSystemMemoryP95DuringRun?: number;
  observedChromiumRssMeanMbDuringRun?: number;
  observedChromiumRssP95MbDuringRun?: number;
  observedAwkitRssMeanMbDuringRun?: number;
  observedAwkitRssP95MbDuringRun?: number;
}

// ── Per-workflow historical analytics (Phase 04) ─────────────────────────────

export interface DistributionEntry {
  key: string;
  count: number;
}

export interface WorkflowHistoricalStats {
  scenarioId?: string;
  scenarioName?: string;
  totalRuns: number;
  success: number;
  failed: number;
  cancelled: number;
  successRate: number;
  failureRate: number;
  retryRate: number;
  duration: DurationStats;
  queueWait: DurationStats;
  /** Environmental observations across the window (labelled environmental, not workflow-owned). */
  observedSystemCpu: DurationStats;
  observedSystemMemory: DurationStats;
  observedChromiumRssMb: DurationStats;
  avgWorkloadWeight?: number;
  /**
   * Fraction of this workflow's runs whose measured queue wait exceeded the queue-delay proxy threshold.
   * This is a per-workflow QUEUE-DELAY frequency (derived from each run's own `queueWaitMs`), NOT a
   * per-workflow admission-*reason*: admission reasons are a global runtime decision (see the global
   * `CapacityAnalytics.admissionReasons`) and are correlated with, but not causally attributed to, a
   * specific workflow. See docs/ai/RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md § Workflow admission semantics.
   */
  queueDelayRunRate?: number;
  headedDistribution: DistributionEntry[];
  resourceProfileDistribution: DistributionEntry[];
  isolationClassDistribution: DistributionEntry[];
}

/** One historical bucket (hour/day/week) for a workflow's trend. */
export interface WorkflowTrendBucket {
  bucketIso: string;
  totalRuns: number;
  success: number;
  failed: number;
  cancelled: number;
  successRate: number;
  duration: DurationStats;
  queueWait: DurationStats;
  observedChromiumRssMb: DurationStats;
  /** Per-workflow queue-delay count (runs whose queueWait exceeded the proxy) — not admission-reason attribution. */
  queueDelays: number;
}

export type TrendBucketWidth = "hour" | "day" | "week";

export interface WorkflowHistoricalTrend {
  scenarioId?: string;
  scenarioName?: string;
  bucketWidth: TrendBucketWidth;
  buckets: WorkflowTrendBucket[];
}

/** A single run compared to its workflow's historical window. */
export interface RunVsHistoryComparison {
  instanceId: string;
  scenarioId?: string;
  historicalSampleCount: number;
  durationMs?: number;
  durationHistoricalP95Ms?: number;
  durationVsP95Ratio?: number;
  queueWaitMs?: number;
  queueWaitHistoricalMedianMs?: number;
  queueWaitVsMedianRatio?: number;
  notes: string[];
}

export type WorkflowRankingMetric =
  | "most-executed"
  | "slowest-p95"
  | "highest-failure-rate"
  | "longest-queue-wait"
  | "highest-observed-chromium-rss"
  | "highest-queue-delay";

export interface WorkflowRankingRow {
  scenarioId?: string;
  scenarioName?: string;
  totalRuns: number;
  value: number;
  /** Environmental resource metrics are correlations, not exclusive ownership. */
  environmental: boolean;
}

export interface WorkflowRanking {
  metric: WorkflowRankingMetric;
  rows: WorkflowRankingRow[];
}

// ── Capacity & queue effectiveness analytics (Phase 05) ──────────────────────

export interface CapacityMetricStats {
  mean?: number;
  p95?: number;
  min?: number;
  max?: number;
}

export interface AdmissionReasonStat {
  reason: AdmissionReason;
  label: string;
  count: number;
  percentage: number;
}

export interface CapacityAnalytics {
  windowSampleCount: number;
  bucketCount: number;
  systemCpu: CapacityMetricStats;
  systemMemory: CapacityMetricStats;
  chromiumRssMb: CapacityMetricStats;
  awkitRssMb: CapacityMetricStats;
  adaptiveTarget: CapacityMetricStats;
  weightedBudget: CapacityMetricStats;
  activeWeight: CapacityMetricStats;
  activeFlows: CapacityMetricStats;
  queuedFlows: CapacityMetricStats;
  sharedBrowsers: CapacityMetricStats;
  contextCount: CapacityMetricStats;
  pageCount: CapacityMetricStats;
  admissionReasons: AdmissionReasonStat[];
  totalAdmissionDelays: number;
  /** activeWeight / weightedBudget — only meaningful while weighted admission was active. */
  capacityUtilization?: number;
  capacityUtilizationApplicable: boolean;
  /** activeFlows / adaptiveTarget. */
  adaptiveTargetUtilization?: number;
  /** Mean & max observed queue depth (queue pressure). */
  queuePressure: CapacityMetricStats;
  effectiveness: BrowserPoolEffectiveness;
  failureAtPressure: FailureAtPressure[];
}

/** Failure rate grouped by the actual pressure state recorded at run time. */
export interface FailureAtPressure {
  pressureState: PressureState;
  runs: number;
  failed: number;
  failureRate: number;
}

export interface BrowserPoolEffectiveness {
  contextsPerSharedBrowser?: number;
  dedicatedRatio?: number;
  sharedRatio?: number;
  closeReasons: DistributionEntry[];
  totalRetirements: number;
}

// ── Anomaly / regression (Phase 06) ──────────────────────────────────────────

export type AnomalySeverity = "info" | "warning" | "critical";
export type AnomalyScope = "run" | "regression";

export interface AnomalyEvent {
  id?: number;
  workflowId?: string;
  runId?: string;
  detectedAt: string;
  scope: AnomalyScope;
  signalType: string;
  severity: AnomalySeverity;
  currentValue?: number;
  baselineValue?: number;
  thresholdRule?: string;
  windowLabel?: string;
  sampleCount?: number;
  state: "active" | "recovered";
  note?: string;
}

// ── Live runtime summary (Phase 07) ──────────────────────────────────────────

export interface RuntimeObservabilitySummary {
  pressureState: PressureState;
  activeWorkflows: number;
  queuedWorkflows: number;
  adaptiveTarget?: number;
  weightedBudget?: number;
  activeWeight?: number;
  weightedAdmissionActive: boolean;
  sharedBrowsers?: number;
  browserContexts?: number;
  pageCount?: number;
  cpuPercent?: number;
  systemMemoryPercent?: number;
  chromiumRssMb?: number;
  currentAdmissionReason?: AdmissionReason;
  currentAdmissionReasonLabel?: string;
}
