/**
 * Pure aggregation for the observability read models (Phases 04 & 05). Framework-agnostic — operates on
 * plain durable records so it is unit-testable without SQLite and reusable by the store. No renderer-side
 * full-history calculation: the store calls these over a bounded windowed row set.
 *
 * Percentiles use the complete windowed set the caller passes (not a single paginated page). Where a
 * window-level percentile is derived from per-bucket percentiles (capacity series), the value is a bucketed
 * upper bound — documented in the report as such.
 */
import { durationStats, percentile, type DurationStats } from "./TelemetryContracts";
import {
  ADMISSION_REASON_LABELS,
  normalizeAdmissionReason,
  normalizePressureState,
  type AdmissionReason,
  type AdmissionReasonStat,
  type BrowserPoolEffectiveness,
  type CapacityAnalytics,
  type CapacityMetricStats,
  type DistributionEntry,
  type FailureAtPressure,
  type PressureState,
  type RunVsHistoryComparison,
  type TrendBucketWidth,
  type WorkflowHistoricalStats,
  type WorkflowHistoricalTrend,
  type WorkflowRanking,
  type WorkflowRankingMetric,
  type WorkflowRankingRow,
  type WorkflowTrendBucket
} from "./ObservabilityContracts";
import type {
  DurableAdmissionBucketRecord,
  DurableBrowserLifecycleBucketRecord,
  DurableCapacityBucketRecord,
  DurableRunRecord
} from "@src/runner/store/RuntimeStoreSchema";

/**
 * A run whose measured queue wait exceeds this is counted as a queue-delayed run (per-workflow proxy).
 * This is a per-workflow QUEUE-DELAY signal from each run's own `queueWaitMs` — NOT a per-workflow
 * admission-*reason* (admission reasons are a global runtime decision; see `computeCapacityAnalytics`).
 */
export const QUEUE_DELAY_PROXY_MS = 250;

// ── Phase 04: per-workflow historical analytics ──────────────────────────────

export function computeWorkflowHistoricalStats(
  scenarioId: string | undefined,
  scenarioName: string | undefined,
  runs: DurableRunRecord[]
): WorkflowHistoricalStats {
  let success = 0;
  let failed = 0;
  let cancelled = 0;
  let retried = 0;
  let queueDelayed = 0;
  const durations: number[] = [];
  const queueWaits: number[] = [];
  const cpuMeans: number[] = [];
  const memoryMeans: number[] = [];
  const chromiumMeans: number[] = [];
  const weights: number[] = [];
  const headed = new Map<string, number>();
  const profile = new Map<string, number>();
  const isolation = new Map<string, number>();

  for (const run of runs) {
    const bucket = statusBucket(run.status);
    if (bucket === "success") success += 1;
    else if (bucket === "failed") failed += 1;
    else if (bucket === "cancelled") cancelled += 1;
    if ((run.retryCount ?? 0) > 0) retried += 1;
    if (typeof run.queueWaitMs === "number") {
      queueWaits.push(run.queueWaitMs);
      if (run.queueWaitMs > QUEUE_DELAY_PROXY_MS) queueDelayed += 1;
    }
    if (typeof run.durationMs === "number") durations.push(run.durationMs);
    pushIfNumber(cpuMeans, run.obsSystemCpuMean);
    pushIfNumber(memoryMeans, run.obsSystemMemoryMean);
    pushIfNumber(chromiumMeans, run.obsChromiumRssMeanMb);
    pushIfNumber(weights, run.workloadWeight);
    increment(headed, run.headed === undefined ? "unknown" : run.headed ? "headed" : "headless");
    increment(profile, run.resourceProfile ?? "unknown");
    increment(isolation, run.isolationClass ?? "unknown");
  }

  const total = runs.length;
  const denom = success + failed;
  return {
    scenarioId,
    scenarioName,
    totalRuns: total,
    success,
    failed,
    cancelled,
    successRate: denom ? success / denom : 0,
    failureRate: denom ? failed / denom : 0,
    retryRate: total ? retried / total : 0,
    duration: durationStats(durations),
    queueWait: durationStats(queueWaits),
    observedSystemCpu: durationStats(cpuMeans),
    observedSystemMemory: durationStats(memoryMeans),
    observedChromiumRssMb: durationStats(chromiumMeans),
    avgWorkloadWeight: weights.length ? round2(weights.reduce((a, b) => a + b, 0) / weights.length) : undefined,
    queueDelayRunRate: total ? queueDelayed / total : 0,
    headedDistribution: toDistribution(headed),
    resourceProfileDistribution: toDistribution(profile),
    isolationClassDistribution: toDistribution(isolation)
  };
}

/** Auto-select a trend bucket width from the requested range length (ms). */
export function selectTrendBucketWidth(rangeMs: number | undefined): TrendBucketWidth {
  if (rangeMs === undefined) return "day";
  const days = rangeMs / 86_400_000;
  if (days <= 2) return "hour";
  if (days <= 45) return "day";
  return "week";
}

const BUCKET_WIDTH_MS: Record<TrendBucketWidth, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000
};

export function computeWorkflowHistoricalTrend(
  scenarioId: string | undefined,
  scenarioName: string | undefined,
  runs: DurableRunRecord[],
  bucketWidth: TrendBucketWidth
): WorkflowHistoricalTrend {
  const widthMs = BUCKET_WIDTH_MS[bucketWidth];
  const groups = new Map<number, DurableRunRecord[]>();
  for (const run of runs) {
    const t = runEpoch(run);
    if (Number.isNaN(t)) continue;
    const key = Math.floor(t / widthMs) * widthMs;
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  }
  const buckets: WorkflowTrendBucket[] = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, group]) => {
      let success = 0;
      let failed = 0;
      let cancelled = 0;
      let queueDelays = 0;
      const durations: number[] = [];
      const queueWaits: number[] = [];
      const chromium: number[] = [];
      for (const run of group) {
        const b = statusBucket(run.status);
        if (b === "success") success += 1;
        else if (b === "failed") failed += 1;
        else if (b === "cancelled") cancelled += 1;
        if (typeof run.durationMs === "number") durations.push(run.durationMs);
        if (typeof run.queueWaitMs === "number") {
          queueWaits.push(run.queueWaitMs);
          if (run.queueWaitMs > QUEUE_DELAY_PROXY_MS) queueDelays += 1;
        }
        pushIfNumber(chromium, run.obsChromiumRssMeanMb);
      }
      const denom = success + failed;
      return {
        bucketIso: new Date(key).toISOString(),
        totalRuns: group.length,
        success,
        failed,
        cancelled,
        successRate: denom ? success / denom : 0,
        duration: durationStats(durations),
        queueWait: durationStats(queueWaits),
        observedChromiumRssMb: durationStats(chromium),
        queueDelays
      };
    });
  return { scenarioId, scenarioName, bucketWidth, buckets };
}

/** Compare one run to its workflow's historical window (excluding the run itself). */
export function computeRunVsHistory(run: DurableRunRecord, history: DurableRunRecord[]): RunVsHistoryComparison {
  const others = history.filter((r) => r.instanceId !== run.instanceId);
  const durations = others.map((r) => r.durationMs).filter(isNumber);
  const queueWaits = others.map((r) => r.queueWaitMs).filter(isNumber);
  const durationP95 = percentile(durations, 95);
  const queueMedian = percentile(queueWaits, 50);
  const notes: string[] = [];
  const durationRatio = run.durationMs !== undefined && durationP95 ? run.durationMs / durationP95 : undefined;
  const queueRatio = run.queueWaitMs !== undefined && queueMedian ? run.queueWaitMs / queueMedian : undefined;
  if (others.length < 5) notes.push("Insufficient history for a confident comparison (fewer than 5 prior runs).");
  if (durationRatio !== undefined && durationRatio >= 2) notes.push(`Duration is ${round2(durationRatio)}× the historical P95.`);
  if (queueRatio !== undefined && queueRatio >= 3) notes.push(`Queue wait is ${round2(queueRatio)}× the historical median.`);
  return {
    instanceId: run.instanceId,
    scenarioId: run.scenarioId,
    historicalSampleCount: others.length,
    durationMs: run.durationMs,
    durationHistoricalP95Ms: durationP95,
    durationVsP95Ratio: durationRatio === undefined ? undefined : round2(durationRatio),
    queueWaitMs: run.queueWaitMs,
    queueWaitHistoricalMedianMs: queueMedian,
    queueWaitVsMedianRatio: queueRatio === undefined ? undefined : round2(queueRatio),
    notes
  };
}

export function computeWorkflowRankings(stats: WorkflowHistoricalStats[], metric: WorkflowRankingMetric, limit = 10): WorkflowRanking {
  const environmental = metric === "highest-observed-chromium-rss";
  const rows: WorkflowRankingRow[] = stats
    .map((s) => ({
      scenarioId: s.scenarioId,
      scenarioName: s.scenarioName,
      totalRuns: s.totalRuns,
      value: rankingValue(s, metric),
      environmental
    }))
    .filter((r) => Number.isFinite(r.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  return { metric, rows };
}

function rankingValue(s: WorkflowHistoricalStats, metric: WorkflowRankingMetric): number {
  switch (metric) {
    case "most-executed":
      return s.totalRuns;
    case "slowest-p95":
      return s.duration.p95Ms ?? -1;
    case "highest-failure-rate":
      return s.failureRate;
    case "longest-queue-wait":
      return s.queueWait.p95Ms ?? -1;
    case "highest-observed-chromium-rss":
      return s.observedChromiumRssMb.p95Ms ?? -1;
    case "highest-queue-delay":
      return s.queueDelayRunRate ?? 0;
    default:
      return -1;
  }
}

// ── Phase 05: capacity & queue effectiveness analytics ───────────────────────

export function computeCapacityAnalytics(
  capacityBuckets: DurableCapacityBucketRecord[],
  admissionBuckets: DurableAdmissionBucketRecord[],
  lifecycleBuckets: DurableBrowserLifecycleBucketRecord[],
  runs: DurableRunRecord[]
): CapacityAnalytics {
  const windowSampleCount = capacityBuckets.reduce((sum, b) => sum + (b.sampleCount ?? 0), 0);

  const systemCpu = aggregate(capacityBuckets, "cpuMean", "cpuP95", "cpuMax");
  const systemMemory = aggregate(capacityBuckets, "memoryMean", "memoryP95", "memoryMax");
  const chromiumRssMb = aggregate(capacityBuckets, "chromiumRssMeanMb", "chromiumRssP95Mb", "chromiumRssMaxMb");
  const awkitRssMb = aggregate(capacityBuckets, "awkitRssMeanMb", "awkitRssP95Mb", "awkitRssMaxMb");
  const adaptiveTarget = aggregate(capacityBuckets, "adaptiveTargetMean", undefined, "adaptiveTargetMax", "adaptiveTargetMin");
  const weightedBudget = aggregate(capacityBuckets, "weightedBudgetMean", undefined, "weightedBudgetMax", "weightedBudgetMin");
  const activeWeight = aggregate(capacityBuckets, "activeWeightMean", "activeWeightP95", "activeWeightMax");
  const activeFlows = aggregate(capacityBuckets, "activeFlowsMean", "activeFlowsP95", "activeFlowsMax");
  const queuedFlows = aggregate(capacityBuckets, "queuedFlowsMean", "queuedFlowsP95", "queuedFlowsMax");
  const sharedBrowsers = aggregate(capacityBuckets, "sharedBrowsersMean", undefined, "sharedBrowsersMax");
  const contextCount = aggregate(capacityBuckets, "contextCountMean", undefined, "contextCountMax");
  const pageCount = aggregate(capacityBuckets, "pageCountMean", undefined, "pageCountMax");

  const weightedActive = capacityBuckets.some((b) => truthy(b.weightedAdmissionActive));
  const capacityUtilization =
    weightedActive && activeWeight.mean !== undefined && weightedBudget.mean ? round2(activeWeight.mean / weightedBudget.mean) : undefined;
  const adaptiveTargetUtilization =
    activeFlows.mean !== undefined && adaptiveTarget.mean ? round2(activeFlows.mean / adaptiveTarget.mean) : undefined;

  return {
    windowSampleCount,
    bucketCount: capacityBuckets.length,
    systemCpu,
    systemMemory,
    chromiumRssMb,
    awkitRssMb,
    adaptiveTarget,
    weightedBudget,
    activeWeight,
    activeFlows,
    queuedFlows,
    sharedBrowsers,
    contextCount,
    pageCount,
    admissionReasons: aggregateAdmissionReasons(admissionBuckets),
    totalAdmissionDelays: admissionBuckets.reduce((sum, b) => sum + (b.count ?? 0), 0),
    capacityUtilization,
    capacityUtilizationApplicable: weightedActive,
    adaptiveTargetUtilization,
    queuePressure: queuedFlows,
    effectiveness: computePoolEffectiveness(lifecycleBuckets, runs, contextCount.mean, sharedBrowsers.mean),
    failureAtPressure: computeFailureAtPressure(runs)
  };
}

function aggregateAdmissionReasons(buckets: DurableAdmissionBucketRecord[]): AdmissionReasonStat[] {
  const counts = new Map<AdmissionReason, number>();
  let total = 0;
  for (const b of buckets) {
    const reason = normalizeAdmissionReason(b.reason);
    counts.set(reason, (counts.get(reason) ?? 0) + (b.count ?? 0));
    total += b.count ?? 0;
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: ADMISSION_REASON_LABELS[reason], count, percentage: total ? round2((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
}

function computePoolEffectiveness(
  lifecycleBuckets: DurableBrowserLifecycleBucketRecord[],
  runs: DurableRunRecord[],
  contextCountMean: number | undefined,
  sharedBrowsersMean: number | undefined
): BrowserPoolEffectiveness {
  const closeReasons = new Map<string, number>();
  let totalRetirements = 0;
  for (const b of lifecycleBuckets) {
    closeReasons.set(b.reason, (closeReasons.get(b.reason) ?? 0) + (b.count ?? 0));
    totalRetirements += b.count ?? 0;
  }
  let dedicated = 0;
  let shared = 0;
  for (const run of runs) {
    if (run.isolationClass === "SHARED_CONTEXT") shared += 1;
    else if (run.isolationClass) dedicated += 1;
  }
  const classified = dedicated + shared;
  return {
    contextsPerSharedBrowser:
      contextCountMean !== undefined && sharedBrowsersMean && sharedBrowsersMean > 0 ? round2(contextCountMean / sharedBrowsersMean) : undefined,
    dedicatedRatio: classified ? round2(dedicated / classified) : undefined,
    sharedRatio: classified ? round2(shared / classified) : undefined,
    closeReasons: toDistribution(closeReasons),
    totalRetirements
  };
}

function computeFailureAtPressure(runs: DurableRunRecord[]): FailureAtPressure[] {
  const groups = new Map<PressureState, { runs: number; failed: number }>();
  for (const run of runs) {
    const state = normalizePressureState(run.pressureStateAtRun);
    const entry = groups.get(state) ?? { runs: 0, failed: 0 };
    entry.runs += 1;
    if (statusBucket(run.status) === "failed") entry.failed += 1;
    groups.set(state, entry);
  }
  const order: PressureState[] = ["healthy", "stable", "pressure", "critical", "unknown"];
  return [...groups.entries()]
    .map(([pressureState, e]) => ({ pressureState, runs: e.runs, failed: e.failed, failureRate: e.runs ? round4(e.failed / e.runs) : 0 }))
    .sort((a, b) => order.indexOf(a.pressureState) - order.indexOf(b.pressureState));
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Aggregate a per-bucket metric into window stats: sampleCount-weighted mean, bucketed-P95 ceiling, min/max. */
function aggregate(
  buckets: DurableCapacityBucketRecord[],
  meanKey: keyof DurableCapacityBucketRecord,
  p95Key?: keyof DurableCapacityBucketRecord,
  maxKey?: keyof DurableCapacityBucketRecord,
  minKey?: keyof DurableCapacityBucketRecord
): CapacityMetricStats {
  let weightSum = 0;
  let valueSum = 0;
  let p95 = -Infinity;
  let max = -Infinity;
  let min = Infinity;
  for (const b of buckets) {
    const w = b.sampleCount ?? 0;
    const mean = numOrUndef(b[meanKey]);
    if (mean !== undefined && w > 0) {
      weightSum += w;
      valueSum += mean * w;
    }
    if (p95Key) {
      const v = numOrUndef(b[p95Key]);
      if (v !== undefined && v > p95) p95 = v;
    }
    if (maxKey) {
      const v = numOrUndef(b[maxKey]);
      if (v !== undefined && v > max) max = v;
    }
    if (minKey) {
      const v = numOrUndef(b[minKey]);
      if (v !== undefined && v < min) min = v;
    }
  }
  return {
    mean: weightSum > 0 ? round2(valueSum / weightSum) : undefined,
    p95: p95 === -Infinity ? undefined : round2(p95),
    max: max === -Infinity ? undefined : round2(max),
    min: min === Infinity ? undefined : round2(min)
  };
}

function statusBucket(status: string): "success" | "failed" | "cancelled" | "other" {
  if (status === "completed" || status === "passed") return "success";
  if (status === "failed" || status === "crashed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "other";
}

function runEpoch(run: DurableRunRecord): number {
  const iso = run.endedAt ?? run.startedAt ?? run.updatedAt;
  return iso ? Date.parse(iso) : Number.NaN;
}

function toDistribution(map: Map<string, number>): DistributionEntry[] {
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function pushIfNumber(arr: number[], value: unknown): void {
  if (typeof value === "number" && !Number.isNaN(value)) arr.push(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

function numOrUndef(value: unknown): number | undefined {
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export type { DurationStats };
