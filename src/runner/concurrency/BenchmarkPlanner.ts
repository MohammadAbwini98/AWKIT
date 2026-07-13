/**
 * Machine-relative benchmark planner + calibration (Concurrency Capacity plan — Phase A10).
 *
 * Pure decision core for the (heavy, opt-in) benchmark harness `scripts/benchmark-concurrency.mts`:
 *
 *  1. **Dynamic stage generation** — concurrency stages scale RELATIVE to this machine's provisional
 *     recommendation `R` and its safety `ceiling`, never a fixed 4→32 sequence. Small machines run e.g.
 *     `1 → 2 → 3 → 4`; larger machines run higher. Always distinct integers in `[1, ceiling]`.
 *  2. **Stop conditions** — a stage is only "sustainable" if none of the configurable health thresholds
 *     trip (sustained/P95 CPU, free-memory reserve, memory %, event-loop delay, error rate, browser /
 *     renderer crash rate, queue delay, P95-latency regression). Missing telemetry never trips a stop.
 *  3. **Production-approved capacity** — NOT the highest attempted stage: apply `productionApprovalMargin`
 *     BELOW the highest *sustainable* stage, so real production caps keep headroom.
 *
 * Pure `src/` core (no Electron/React, no I/O). See docs/ai/CONCURRENCY_CAPACITY_AND_REPORTS_PLAN.md §A10.
 */
import type { MachineCapacityProfile } from "./MachineCapacityProfileStore";

// ── Stage generation ───────────────────────────────────────────────────────────

export interface BenchmarkStageConfig {
  /** Multipliers of R for the initial ramp. */
  rampFactors: number[];
  /** Overshoot multiplier attempted only if the machine stayed healthy at R. */
  overshootFactor: number;
  /** Absolute step for gradual growth beyond the overshoot, up to the ceiling. */
  growthStep: number;
  /** Safety bound on how many distinct stages to generate. */
  maxStages: number;
}

export const DEFAULT_BENCHMARK_STAGE_CONFIG: BenchmarkStageConfig = {
  rampFactors: [0.25, 0.5, 0.75, 1.0],
  overshootFactor: 1.25,
  growthStep: 1,
  maxStages: 12
};

/** Clamp to distinct ascending integers within `[1, ceiling]`, capped at `maxStages`. */
export function normalizeStages(raw: number[], ceiling: number, maxStages: number): number[] {
  const cap = Math.max(1, Math.floor(ceiling));
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of raw) {
    if (!Number.isFinite(value)) continue;
    const n = Math.min(cap, Math.max(1, Math.ceil(value)));
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= maxStages) break;
  }
  return out.sort((a, b) => a - b);
}

/**
 * Generate the concurrency stages for THIS machine. `R` is the provisional recommendation (conservative,
 * pre-benchmark); `ceiling` the absolute safety ceiling. Stages scale with both — computed, never a fixed
 * profile. The overshoot + gradual growth only extend when the ceiling leaves room above R.
 */
export function generateBenchmarkStages(
  R: number,
  ceiling: number,
  config: BenchmarkStageConfig = DEFAULT_BENCHMARK_STAGE_CONFIG
): number[] {
  const cap = Math.max(1, Math.floor(ceiling));
  const base = Math.min(cap, Math.max(1, Math.floor(R)));

  const raw: number[] = config.rampFactors.map((f) => f * base);
  raw.push(config.overshootFactor * base);

  // Gradual growth beyond the overshoot, never exceeding the ceiling.
  let next = Math.ceil(config.overshootFactor * base) + config.growthStep;
  while (next <= cap && raw.length < config.maxStages * 2) {
    raw.push(next);
    next += config.growthStep;
  }

  return normalizeStages(raw, cap, config.maxStages);
}

// ── Stop conditions ─────────────────────────────────────────────────────────────

export interface BenchmarkThresholds {
  maxAvgCpuPercent: number;
  maxP95CpuPercent: number;
  minFreeMemoryMb: number;
  maxSystemMemoryPercent: number;
  maxEventLoopDelayMs: number;
  /** 0..1 fraction of workflows that errored. */
  maxErrorRate: number;
  maxBrowserCrashes: number;
  maxRendererCrashes: number;
  /** Queue delay (ms) growth signalling the machine can't keep up. */
  maxQueueDelayMs: number;
  /** Trip if P95 latency exceeds baseline × this factor. */
  maxLatencyRegressionFactor: number;
}

export const DEFAULT_BENCHMARK_THRESHOLDS: BenchmarkThresholds = {
  maxAvgCpuPercent: 85,
  maxP95CpuPercent: 95,
  minFreeMemoryMb: 512,
  maxSystemMemoryPercent: 88,
  maxEventLoopDelayMs: 500,
  maxErrorRate: 0.05,
  maxBrowserCrashes: 1,
  maxRendererCrashes: 1,
  maxQueueDelayMs: 30_000,
  maxLatencyRegressionFactor: 1.5
};

/** Health readings for one stage's hold window. Any field may be absent (telemetry is best-effort). */
export interface BenchmarkHealthSample {
  avgCpuPercent?: number;
  p95CpuPercent?: number;
  freeMemoryMb?: number;
  systemMemoryPercent?: number;
  eventLoopDelayMs?: number;
  errorRate?: number;
  browserCrashes?: number;
  rendererCrashes?: number;
  queueDelayMs?: number;
  latencyP95Ms?: number;
  baselineLatencyP95Ms?: number;
}

export interface StopEvaluation {
  stop: boolean;
  reasons: string[];
}

/**
 * Evaluate the stop conditions against one stage's health sample. A missing reading is skipped (never a
 * false stop), so a machine with partial telemetry still benchmarks — it just relies on fewer signals.
 */
export function evaluateStopConditions(
  sample: BenchmarkHealthSample,
  thresholds: BenchmarkThresholds = DEFAULT_BENCHMARK_THRESHOLDS
): StopEvaluation {
  const reasons: string[] = [];
  const over = (v: number | undefined, limit: number, label: string) => {
    if (v !== undefined && v > limit) reasons.push(`${label} ${round(v)} > ${limit}`);
  };
  const under = (v: number | undefined, limit: number, label: string) => {
    if (v !== undefined && v < limit) reasons.push(`${label} ${round(v)} < ${limit}`);
  };

  over(sample.avgCpuPercent, thresholds.maxAvgCpuPercent, "sustained CPU%");
  over(sample.p95CpuPercent, thresholds.maxP95CpuPercent, "P95 CPU%");
  under(sample.freeMemoryMb, thresholds.minFreeMemoryMb, "free memory MB");
  over(sample.systemMemoryPercent, thresholds.maxSystemMemoryPercent, "system memory%");
  over(sample.eventLoopDelayMs, thresholds.maxEventLoopDelayMs, "event-loop delay ms");
  over(sample.errorRate, thresholds.maxErrorRate, "error rate");
  over(sample.browserCrashes, thresholds.maxBrowserCrashes, "browser crashes");
  over(sample.rendererCrashes, thresholds.maxRendererCrashes, "renderer crashes");
  over(sample.queueDelayMs, thresholds.maxQueueDelayMs, "queue delay ms");

  if (
    sample.latencyP95Ms !== undefined &&
    sample.baselineLatencyP95Ms !== undefined &&
    sample.baselineLatencyP95Ms > 0 &&
    sample.latencyP95Ms > sample.baselineLatencyP95Ms * thresholds.maxLatencyRegressionFactor
  ) {
    reasons.push(
      `P95 latency ${round(sample.latencyP95Ms)}ms > ${thresholds.maxLatencyRegressionFactor}× baseline ${round(sample.baselineLatencyP95Ms)}ms`
    );
  }

  return { stop: reasons.length > 0, reasons };
}

// ── Calibration summary ─────────────────────────────────────────────────────────

/** Production caps keep a margin BELOW the highest sustainable stage (never the peak attempted). */
export function productionApprovedCapacity(highestSustainableStage: number, margin: number): number {
  if (!(highestSustainableStage >= 1)) return 1;
  const m = Number.isFinite(margin) && margin > 0 && margin <= 1 ? margin : 1;
  return Math.max(1, Math.floor(highestSustainableStage * m));
}

export interface BenchmarkStageOutcome {
  stage: number;
  /** True when the stage held for the full window without tripping any stop condition. */
  sustained: boolean;
  sample: BenchmarkHealthSample;
  stopReasons?: string[];
  /** Measured per-instance cost observed at this stage (feeds the seed override). */
  measuredMemoryPerInstanceMb?: number;
  measuredCpuCoresPerInstance?: number;
}

export interface BenchmarkResult {
  benchmarkId: string;
  machineId: string;
  startedAt: string;
  endedAt: string;
  recommendationR: number;
  ceiling: number;
  stages: number[];
  outcomes: BenchmarkStageOutcome[];
  /** Highest stage that held (contiguous from the bottom — the first failure ends the ramp). */
  highestSustainableStage: number;
  benchmarkTestedCapacity: number;
  productionApprovedCapacity: number;
  estimatedMemoryPerInstanceMb?: number;
  estimatedCpuCostPerInstance?: number;
}

export interface SummarizeBenchmarkParams {
  benchmarkId: string;
  machineId: string;
  startedAt: string;
  endedAt?: string;
  recommendationR: number;
  ceiling: number;
  stages: number[];
  outcomes: BenchmarkStageOutcome[];
  productionApprovalMargin: number;
}

/**
 * Fold stage outcomes into a calibration result. The highest sustainable stage is the top of the
 * CONTIGUOUS run of sustained stages from the smallest — the first failed stage ends the ramp, so a
 * later lucky pass never inflates the capacity. Per-instance cost estimates come from that stage.
 */
export function summarizeBenchmark(params: SummarizeBenchmarkParams): BenchmarkResult {
  const ordered = [...params.outcomes].sort((a, b) => a.stage - b.stage);
  let highest = 0;
  let calibrationOutcome: BenchmarkStageOutcome | undefined;
  for (const outcome of ordered) {
    if (!outcome.sustained) break; // contiguous: stop at the first failure
    highest = outcome.stage;
    calibrationOutcome = outcome;
  }
  const tested = Math.max(1, highest || (ordered[0]?.stage ?? 1));
  return {
    benchmarkId: params.benchmarkId,
    machineId: params.machineId,
    startedAt: params.startedAt,
    endedAt: params.endedAt ?? new Date().toISOString(),
    recommendationR: params.recommendationR,
    ceiling: params.ceiling,
    stages: params.stages,
    outcomes: params.outcomes,
    highestSustainableStage: highest,
    benchmarkTestedCapacity: tested,
    productionApprovedCapacity: productionApprovedCapacity(tested, params.productionApprovalMargin),
    estimatedMemoryPerInstanceMb: calibrationOutcome?.measuredMemoryPerInstanceMb,
    estimatedCpuCostPerInstance: calibrationOutcome?.measuredCpuCoresPerInstance
  };
}

/**
 * Write a benchmark result onto a machine profile: adopts the measured capacity/estimates, records the
 * benchmark id + calibration time, and clears the recalibration flag. Pure — the caller persists it.
 */
export function applyBenchmarkToProfile(
  profile: MachineCapacityProfile,
  result: BenchmarkResult,
  now: Date = new Date()
): MachineCapacityProfile {
  return {
    ...profile,
    requiresRecalibration: false,
    benchmarkTestedCapacity: result.benchmarkTestedCapacity,
    productionApprovedCapacity: result.productionApprovedCapacity,
    estimatedMemoryPerInstanceMb: result.estimatedMemoryPerInstanceMb ?? profile.estimatedMemoryPerInstanceMb,
    estimatedCpuCostPerInstance: result.estimatedCpuCostPerInstance ?? profile.estimatedCpuCostPerInstance,
    lastBenchmarkId: result.benchmarkId,
    lastCalibratedAt: result.endedAt,
    updatedAt: now.toISOString()
  };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
