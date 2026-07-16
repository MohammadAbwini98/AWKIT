/**
 * Pure, framework-agnostic accumulator for the Runtime Observability & Historical Analytics phase.
 *
 * It is fed by the ENGINE's already-existing sampler ticks (ResourceSampler + ProcessTreeSampler + pool /
 * capacity snapshots) — it starts NO timers and does NO OS/process scanning of its own (Phase 03: "reuse
 * the existing sampler; no independent CPU/RAM polling loop"). Responsibilities:
 *
 *  1. Per-run ENVIRONMENTAL observation summary — for each active run, aggregate the shared host samples
 *     taken during that run's window into mean/P95/… These are correlations with the run, never exclusive
 *     per-workflow ownership under a shared browser pool.
 *  2. Bounded capacity time buckets — periodic aggregate of CPU/mem/Chromium-RSS + capacity context
 *     (adaptive target, weighted budget, active weight, active/queued flows, browsers/contexts/pages).
 *  3. Admission-delay reason buckets — counts of REAL dispatch-loop block episodes by normalized reason.
 *  4. Browser lifecycle (retirement) buckets — periodic deltas of the pool's cumulative close-reason counts.
 *
 * All buffers are bounded. Percentiles are exact over the (small, short-window) bucket/run sample sets.
 */
import { percentile } from "@src/reports/TelemetryContracts";
import type { AdmissionReason, PressureState, RunObservationSummary } from "@src/reports/ObservabilityContracts";
import type {
  DurableAdmissionBucketRecord,
  DurableBrowserLifecycleBucketRecord,
  DurableCapacityBucketRecord
} from "../store/RuntimeStoreSchema";

/** A shared host resource sample (from the existing ResourceSampler + ProcessTreeSampler). */
export interface ObservationSample {
  systemCpuPercent?: number;
  systemMemoryPercent?: number;
  chromiumRssMb?: number;
  awkitRssMb?: number;
  nodeHeapMb?: number;
}

/** Capacity/pressure context captured alongside a sample (from the engine's live state). */
export interface CapacityContextSample {
  adaptiveTarget?: number;
  weightedBudget?: number;
  activeWeight?: number;
  activeFlows: number;
  queuedFlows: number;
  sharedBrowsers?: number;
  contextCount?: number;
  pageCount?: number;
  /** Whether A8 weighted admission was active (capacity utilization is only meaningful then). */
  weightedAdmissionActive: boolean;
}

/** Bounded stats produced from a numeric set. */
interface NumericStats {
  mean?: number;
  p95?: number;
  min?: number;
  max?: number;
}

const MAX_RUN_SAMPLES = 1200; // e.g. ~40 min at 2s cadence; guards a runaway long run.
const MAX_BUCKET_SAMPLES = 2000;

class Series {
  private readonly values: number[] = [];
  push(value: number | undefined, cap: number): void {
    if (typeof value !== "number" || Number.isNaN(value)) return;
    if (this.values.length >= cap) return;
    this.values.push(value);
  }
  get length(): number {
    return this.values.length;
  }
  stats(): NumericStats {
    if (this.values.length === 0) return {};
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const v of this.values) {
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { mean: sum / this.values.length, p95: percentile(this.values, 95), min, max };
  }
  meanRounded(): number | undefined {
    const s = this.stats();
    return s.mean === undefined ? undefined : Math.round(s.mean);
  }
  p95Rounded(): number | undefined {
    const s = this.stats();
    return s.p95 === undefined ? undefined : Math.round(s.p95);
  }
}

interface RunAccumulator {
  cpu: Series;
  memory: Series;
  chromiumRss: Series;
  awkitRss: Series;
  sampleCount: number;
}

interface CapacityAccumulator {
  cpu: Series;
  memory: Series;
  awkitRss: Series;
  chromiumRss: Series;
  nodeHeap: Series;
  adaptiveTarget: Series;
  weightedBudget: Series;
  activeWeight: Series;
  activeFlows: Series;
  queuedFlows: Series;
  sharedBrowsers: Series;
  contextCount: Series;
  pageCount: Series;
  sampleCount: number;
  weightedAdmissionActive: boolean;
}

function newCapacityAccumulator(): CapacityAccumulator {
  return {
    cpu: new Series(),
    memory: new Series(),
    awkitRss: new Series(),
    chromiumRss: new Series(),
    nodeHeap: new Series(),
    adaptiveTarget: new Series(),
    weightedBudget: new Series(),
    activeWeight: new Series(),
    activeFlows: new Series(),
    queuedFlows: new Series(),
    sharedBrowsers: new Series(),
    contextCount: new Series(),
    pageCount: new Series(),
    sampleCount: 0,
    weightedAdmissionActive: false
  };
}

export interface RolledBuckets {
  capacity?: DurableCapacityBucketRecord;
  admission: DurableAdmissionBucketRecord[];
  lifecycle: DurableBrowserLifecycleBucketRecord[];
}

export class RuntimeObservationCollector {
  private readonly runs = new Map<string, RunAccumulator>();
  private capacity = newCapacityAccumulator();
  private admissionCounts = new Map<string, { reason: AdmissionReason; pressureState?: PressureState; count: number }>();
  private lifecycleCounts = new Map<string, number>();
  private lastCloseReasonTotals = new Map<string, number>();
  private bucketStartMs: number;

  constructor(nowMs: number = Date.now()) {
    this.bucketStartMs = nowMs;
  }

  // ── Per-run environmental summary ──────────────────────────────────────────

  startRun(instanceId: string): void {
    if (this.runs.has(instanceId)) return;
    this.runs.set(instanceId, { cpu: new Series(), memory: new Series(), chromiumRss: new Series(), awkitRss: new Series(), sampleCount: 0 });
  }

  /** Finalize + drop a run's accumulator. Returns undefined if the run was never registered. */
  finalizeRun(instanceId: string): RunObservationSummary | undefined {
    const acc = this.runs.get(instanceId);
    if (!acc) return undefined;
    this.runs.delete(instanceId);
    return {
      sampleCount: acc.sampleCount,
      observedSystemCpuMeanDuringRun: round1(acc.cpu.stats().mean),
      observedSystemCpuP95DuringRun: round1(acc.cpu.stats().p95),
      observedSystemMemoryMeanDuringRun: round1(acc.memory.stats().mean),
      observedSystemMemoryP95DuringRun: round1(acc.memory.stats().p95),
      observedChromiumRssMeanMbDuringRun: acc.chromiumRss.meanRounded(),
      observedChromiumRssP95MbDuringRun: acc.chromiumRss.p95Rounded(),
      observedAwkitRssMeanMbDuringRun: acc.awkitRss.meanRounded(),
      observedAwkitRssP95MbDuringRun: acc.awkitRss.p95Rounded()
    };
  }

  get activeRunCount(): number {
    return this.runs.size;
  }

  // ── Sampling tick (called from the engine's existing sampler cadence) ───────

  /** Push one shared host sample + capacity context. Feeds every active run AND the current capacity bucket. */
  observeTick(sample: ObservationSample, ctx: CapacityContextSample): void {
    for (const acc of this.runs.values()) {
      acc.sampleCount += 1;
      acc.cpu.push(sample.systemCpuPercent, MAX_RUN_SAMPLES);
      acc.memory.push(sample.systemMemoryPercent, MAX_RUN_SAMPLES);
      acc.chromiumRss.push(sample.chromiumRssMb, MAX_RUN_SAMPLES);
      acc.awkitRss.push(sample.awkitRssMb, MAX_RUN_SAMPLES);
    }
    const c = this.capacity;
    c.sampleCount += 1;
    c.cpu.push(sample.systemCpuPercent, MAX_BUCKET_SAMPLES);
    c.memory.push(sample.systemMemoryPercent, MAX_BUCKET_SAMPLES);
    c.awkitRss.push(sample.awkitRssMb, MAX_BUCKET_SAMPLES);
    c.chromiumRss.push(sample.chromiumRssMb, MAX_BUCKET_SAMPLES);
    c.nodeHeap.push(sample.nodeHeapMb, MAX_BUCKET_SAMPLES);
    c.adaptiveTarget.push(ctx.adaptiveTarget, MAX_BUCKET_SAMPLES);
    c.weightedBudget.push(ctx.weightedBudget, MAX_BUCKET_SAMPLES);
    c.activeWeight.push(ctx.activeWeight, MAX_BUCKET_SAMPLES);
    c.activeFlows.push(ctx.activeFlows, MAX_BUCKET_SAMPLES);
    c.queuedFlows.push(ctx.queuedFlows, MAX_BUCKET_SAMPLES);
    c.sharedBrowsers.push(ctx.sharedBrowsers, MAX_BUCKET_SAMPLES);
    c.contextCount.push(ctx.contextCount, MAX_BUCKET_SAMPLES);
    c.pageCount.push(ctx.pageCount, MAX_BUCKET_SAMPLES);
    if (ctx.weightedAdmissionActive) c.weightedAdmissionActive = true;
  }

  // ── Admission-delay episodes ────────────────────────────────────────────────

  /** Record one real admission-delay episode by normalized reason (counts, not per-500ms ticks). */
  recordAdmissionDelay(reason: AdmissionReason, pressureState?: PressureState): void {
    const key = `${reason}|${pressureState ?? ""}`;
    const entry = this.admissionCounts.get(key) ?? { reason, pressureState, count: 0 };
    entry.count += 1;
    this.admissionCounts.set(key, entry);
  }

  // ── Browser lifecycle deltas ────────────────────────────────────────────────

  /**
   * Fold the pool's CUMULATIVE close-reason counters into the current lifecycle bucket by diffing against
   * the last-seen totals. Idempotent between rolls; a decreasing total (pool reset) re-baselines safely.
   */
  observeRetirements(cumulativeCloseReasons: Record<string, number>): void {
    for (const [reason, total] of Object.entries(cumulativeCloseReasons)) {
      const last = this.lastCloseReasonTotals.get(reason) ?? 0;
      const delta = total - last;
      // Re-baseline to the latest cumulative total either way; a negative delta (pool reset) is ignored.
      this.lastCloseReasonTotals.set(reason, total);
      if (delta > 0) this.lifecycleCounts.set(reason, (this.lifecycleCounts.get(reason) ?? 0) + delta);
    }
  }

  // ── Bucket roll ─────────────────────────────────────────────────────────────

  /**
   * If the bucket window has elapsed, finalize the current capacity/admission/lifecycle buckets and reset.
   * Returns the records to persist (empty when nothing accumulated). Also rolls immediately when `force`.
   */
  maybeRollBuckets(nowMs: number, bucketMs: number, force = false): RolledBuckets | undefined {
    if (!force && nowMs - this.bucketStartMs < bucketMs) return undefined;
    const bucketStartIso = new Date(this.bucketStartMs).toISOString();
    const bucketEndIso = new Date(nowMs).toISOString();
    const result: RolledBuckets = { admission: [], lifecycle: [] };

    if (this.capacity.sampleCount > 0) {
      result.capacity = this.buildCapacityBucket(bucketStartIso, bucketEndIso);
    }
    for (const entry of this.admissionCounts.values()) {
      result.admission.push({ bucketStart: bucketStartIso, reason: entry.reason, pressureState: entry.pressureState, count: entry.count });
    }
    for (const [reason, count] of this.lifecycleCounts.entries()) {
      result.lifecycle.push({ bucketStart: bucketStartIso, reason, count });
    }

    this.capacity = newCapacityAccumulator();
    this.admissionCounts = new Map();
    this.lifecycleCounts = new Map();
    this.bucketStartMs = nowMs;

    if (!result.capacity && result.admission.length === 0 && result.lifecycle.length === 0) return undefined;
    return result;
  }

  private buildCapacityBucket(bucketStart: string, bucketEnd: string): DurableCapacityBucketRecord {
    const c = this.capacity;
    const cpu = c.cpu.stats();
    const mem = c.memory.stats();
    const awkit = c.awkitRss.stats();
    const chromium = c.chromiumRss.stats();
    const heap = c.nodeHeap.stats();
    const adaptive = c.adaptiveTarget.stats();
    const budget = c.weightedBudget.stats();
    const weight = c.activeWeight.stats();
    const active = c.activeFlows.stats();
    const queued = c.queuedFlows.stats();
    const browsers = c.sharedBrowsers.stats();
    const contexts = c.contextCount.stats();
    const pages = c.pageCount.stats();
    return {
      bucketStart,
      bucketEnd,
      sampleCount: c.sampleCount,
      cpuMean: round1(cpu.mean),
      cpuP95: round1(cpu.p95),
      cpuMax: round1(cpu.max),
      memoryMean: round1(mem.mean),
      memoryP95: round1(mem.p95),
      memoryMax: round1(mem.max),
      awkitRssMeanMb: roundInt(awkit.mean),
      awkitRssP95Mb: roundInt(awkit.p95),
      awkitRssMaxMb: roundInt(awkit.max),
      chromiumRssMeanMb: roundInt(chromium.mean),
      chromiumRssP95Mb: roundInt(chromium.p95),
      chromiumRssMaxMb: roundInt(chromium.max),
      nodeHeapMeanMb: roundInt(heap.mean),
      nodeHeapMaxMb: roundInt(heap.max),
      adaptiveTargetMean: round2(adaptive.mean),
      adaptiveTargetMin: roundInt(adaptive.min),
      adaptiveTargetMax: roundInt(adaptive.max),
      weightedBudgetMean: round2(budget.mean),
      weightedBudgetMin: round2(budget.min),
      weightedBudgetMax: round2(budget.max),
      activeWeightMean: round2(weight.mean),
      activeWeightP95: round2(weight.p95),
      activeWeightMax: round2(weight.max),
      activeFlowsMean: round2(active.mean),
      activeFlowsP95: round2(active.p95),
      activeFlowsMax: roundInt(active.max),
      queuedFlowsMean: round2(queued.mean),
      queuedFlowsP95: round2(queued.p95),
      queuedFlowsMax: roundInt(queued.max),
      sharedBrowsersMean: round2(browsers.mean),
      sharedBrowsersMax: roundInt(browsers.max),
      contextCountMean: round2(contexts.mean),
      contextCountMax: roundInt(contexts.max),
      pageCountMean: round2(pages.mean),
      pageCountMax: roundInt(pages.max),
      weightedAdmissionActive: c.weightedAdmissionActive
    };
  }
}

function round1(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 10) / 10;
}
function round2(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 100) / 100;
}
function roundInt(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.round(value);
}
