/**
 * Core harness for the real-ExecutionEngine capacity benchmark. Drives workloads through the COMPLETE
 * production dispatch path (startRun → processQueue → Adaptive → Backpressure → weighted admission →
 * OperationLimiters → BrowserWorkerPool → BrowserIsolationResolver → BrowserContextFactory →
 * SharedBrowserPool → PlaywrightRunner) and samples System / AWKIT / Chromium / Scheduler / Workflow
 * metrics (Phase 5). Nothing here simulates admission — every decision is made by the real engine.
 *
 * A "stage" sustains a target number of concurrent workflows for a hold window by submitting one run per
 * workload class with a large instance count (so the run stays busy — never prematurely idle), letting the
 * GLOBAL scheduler bound actual concurrency, then `stopAll()` for a prompt, clean teardown. Concurrency is
 * whatever the engine actually sustains, measured from `getCapacitySnapshot()`.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import os from "node:os";
import { join } from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import type { StorageDirs } from "@src/instances/InstanceManager";
import type { ConcurrencyLimits } from "@src/runner/concurrency/ConcurrencyConfig";
import type { RunHistoryFilter, RunHistoryRow, TelemetryRange } from "@src/reports/TelemetryContracts";
import { computeWorkloadWeight, extractWorkloadFeatures, DEFAULT_WORKLOAD_WEIGHT_CONFIG } from "@src/runner/concurrency/WorkloadWeights";
import { chromiumPids, sampleChromium, stats, type Stats, type WorkloadServer } from "./lib.mts";
import { buildFlow, buildScenario, buildProfile, WORKLOAD_CLASSES, DEFAULT_MIX, type WorkloadClass } from "./workloads.mts";

export interface ConfigSpec {
  name: string; // "A" | "B" | "C" | "D" | custom
  sharedPool: boolean;
  workloadWeights: boolean;
  maxBrowsersPerHost: number;
  maxActiveFlows: number;
  /** Extra limit overrides (e.g. recycle thresholds) merged last. */
  extra?: Partial<ConcurrencyLimits>;
}

export interface StageSample {
  atMs: number;
  // system
  cpuPercent?: number;
  systemMemoryPercent?: number;
  freeMemoryMb: number;
  // awkit
  processRssMb: number;
  nodeHeapUsedMb: number;
  eventLoopDelayMs: number;
  // chromium (subtree, PID-baseline diff)
  chromiumProcs: number;
  chromiumRssMb: number;
  chromiumCpuUnits: number;
  // scheduler
  activeFlows: number;
  queueDepth: number;
  adaptiveTarget?: number;
  adaptiveState?: string;
  dispatchBlocked: boolean;
  blockedReason?: string;
  activeWeight: number;
  weightedBudget: number;
  // shared pool
  sharedBrowsers: number;
  sharedContexts: number;
  sharedLaunched: number;
  sharedClosed: number;
  recentCrashes: number;
}

export interface RunRecord {
  cls: WorkloadClass;
  status: string;
  durationMs: number;
  queueWaitMs: number;
  retryCount: number;
  errorClass?: string;
  error?: string;
}

export interface StageResult {
  config: string;
  targetActive: number;
  holdMs: number;
  headless: boolean;
  limits: { maxBrowsersPerHost: number; maxActiveFlows: number; sharedPool: boolean; workloadWeights: boolean };
  perClassWeight: Record<WorkloadClass, number>;
  samples: StageSample[];
  // aggregates
  sustainedActive: Stats | undefined; // actual concurrency sustained
  cpuPercent: Stats | undefined;
  chromiumProcs: Stats | undefined;
  chromiumRssMb: Stats | undefined;
  chromiumPeakRssMb: number;
  eventLoopDelayMs: Stats | undefined;
  processRssMb: Stats | undefined;
  nodeHeapUsedMb: Stats | undefined;
  sharedBrowsers: Stats | undefined;
  sharedContexts: Stats | undefined;
  queueDepth: Stats | undefined;
  dispatchBlockedFraction: number;
  blockedReasons: string[];
  // workflow
  completed: number;
  failed: number;
  cancelled: number;
  totalRuns: number;
  failureRate: number;
  throughputPerMin: number;
  durationP50Ms: number | undefined;
  durationP95Ms: number | undefined;
  queueWaitP95Ms: number | undefined;
  retries: number;
  crashes: number;
  failureSamples: string[];
  // teardown / leak
  teardown: TeardownReport;
}

export interface TeardownReport {
  clean: boolean;
  activeInstancesAtEnd: number;
  sharedContextsAtEnd: number;
  sharedBrowsersAtEnd: number;
  orphanChromiumProcsAtEnd: number;
  notes: string[];
}

export async function buildDirs(prefix = "awkit-engine-bench-"): Promise<{ dirs: StorageDirs; root: string }> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const dirs: StorageDirs = {
    root,
    downloads: join(root, "downloads"),
    screenshots: join(root, "screenshots"),
    logs: join(root, "logs"),
    reports: join(root, "reports")
  };
  await Promise.all(Object.values(dirs).map((d) => mkdir(d, { recursive: true })));
  return { dirs, root };
}

/** Real A8 weight per class (uses the production WorkloadWeights model on the built flow + config). */
export function perClassWeights(base: string, headless: boolean): Record<WorkloadClass, number> {
  const out = {} as Record<WorkloadClass, number>;
  for (const cls of WORKLOAD_CLASSES) {
    const flow = buildFlow(cls, base);
    const cfg = { id: "w", name: "w", browser: "chromium" as const, headless, isolationMode: "browserContext" as const, timeoutMs: 30000, viewport: { width: 1280, height: 720 } };
    const features = extractWorkloadFeatures(cfg, [flow], { traceOrVideo: false });
    out[cls] = Number(computeWorkloadWeight(features, DEFAULT_WORKLOAD_WEIGHT_CONFIG).toFixed(3));
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Instance-count-per-class so a run stays busy for the whole hold window (never prematurely idle). */
function instancesForHold(perClassTarget: number, holdMs: number): number {
  // Assume worst-case ~2s per light workflow → holdMs/2000 waves; generously over-provision, capped.
  const waves = Math.ceil(holdMs / 1500) + 2;
  return Math.min(2000, Math.max(8, perClassTarget * waves));
}

interface Lane {
  cls: WorkloadClass;
  executionId: string;
}

/**
 * Run ONE stage: sustain ~targetActive concurrent workflows of the given mix for holdMs, sampling
 * throughout, then stopAll + drain + assert clean teardown. Single-class stages pass mix = { [cls]: 1 }.
 */
export async function runStage(
  engine: ExecutionEngine,
  wl: WorkloadServer,
  dirs: StorageDirs,
  opts: {
    config: ConfigSpec;
    targetActive: number;
    holdMs: number;
    headless: boolean;
    mix?: Partial<Record<WorkloadClass, number>>;
    sampleIntervalMs?: number;
  }
): Promise<StageResult> {
  const { config, targetActive, holdMs, headless } = opts;
  const sampleIntervalMs = opts.sampleIntervalMs ?? 1000;
  const mix = normalizeMix(opts.mix ?? DEFAULT_MIX);

  engine.configureConcurrency({
    maxBrowsersPerHost: config.maxBrowsersPerHost,
    maxActiveFlows: config.maxActiveFlows,
    useSharedBrowserPool: config.sharedPool,
    workloadWeights: config.workloadWeights,
    ...config.extra
  });

  const perClassWeight = perClassWeights(wl.base, headless);
  const budgetPerFlow = 1.0;
  const baselinePids = await chromiumPids();

  // Per-class instance targets biased to the mix (sum ≈ targetActive); each run over-provisions instances.
  const classTargets: Array<{ cls: WorkloadClass; active: number }> = [];
  for (const cls of WORKLOAD_CLASSES) {
    const share = mix[cls] ?? 0;
    if (share <= 0) continue;
    classTargets.push({ cls, active: Math.max(1, Math.round(targetActive * share)) });
  }

  const execToClass = new Map<string, WorkloadClass>();
  const lanes: Lane[] = [];
  for (const { cls, active } of classTargets) {
    const executionId = `bench-${config.name}-${cls}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    execToClass.set(executionId, cls);
    lanes.push({ cls, executionId });
    const instanceCount = instancesForHold(active, holdMs);
    const flows = [buildFlow(cls, wl.base)];
    const scenario = buildScenario(cls, flows[0].id);
    const profile = buildProfile(cls, wl.base, { executionId, headless, maxConcurrentInstances: active });
    await engine.startRun(executionId, profile, Array.from({ length: instanceCount }), dirs, {}, scenario, flows);
  }

  // ── Sample loop ─────────────────────────────────────────────────────────────
  const eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();
  const samples: StageSample[] = [];
  let chromiumPeakRssMb = 0;
  const startedAt = performance.now();
  const deadline = Date.now() + holdMs;
  while (Date.now() < deadline) {
    const [chrom, cap] = await Promise.all([sampleChromium(baselinePids), Promise.resolve(engine.getCapacitySnapshot())]);
    const shared = engine.getSharedBrowserSnapshot();
    const mem = process.memoryUsage();
    const instances = engine.getInstances();
    let activeWeight = 0;
    for (const inst of instances) {
      if (!["starting", "running"].includes(inst.status)) continue;
      const cls = execToClass.get(inst.executionId);
      if (cls) activeWeight += perClassWeight[cls];
    }
    chromiumPeakRssMb = Math.max(chromiumPeakRssMb, chrom.rssMb);
    samples.push({
      atMs: Date.now(),
      cpuPercent: cap.cpuPercent,
      systemMemoryPercent: cap.systemMemoryPercent,
      freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
      processRssMb: Math.round(mem.rss / (1024 * 1024)),
      nodeHeapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      eventLoopDelayMs: Math.round((eld.mean / 1e6) * 10) / 10,
      chromiumProcs: chrom.count,
      chromiumRssMb: chrom.rssMb,
      chromiumCpuUnits: chrom.cpuUnits,
      activeFlows: cap.activeFlows,
      queueDepth: cap.queueDepth,
      adaptiveTarget: cap.adaptiveTarget,
      adaptiveState: cap.adaptiveState,
      dispatchBlocked: cap.dispatchBlocked,
      blockedReason: cap.blockedReason,
      activeWeight: Number(activeWeight.toFixed(2)),
      weightedBudget: config.maxActiveFlows * budgetPerFlow,
      sharedBrowsers: shared.totalBrowsers,
      sharedContexts: shared.activeContexts,
      sharedLaunched: shared.totalBrowsersLaunched,
      sharedClosed: shared.totalBrowsersClosed,
      recentCrashes: cap.recentCrashes
    });
    eld.reset();
    await sleep(sampleIntervalMs);
  }

  // ── Teardown ────────────────────────────────────────────────────────────────
  engine.stopAll();
  const runRecords = await drainRuns(engine, lanes.map((l) => l.executionId), execToClass);
  const teardown = await assertTeardown(engine, baselinePids);
  eld.disable();

  // ── Aggregate ───────────────────────────────────────────────────────────────
  const elapsedMin = (performance.now() - startedAt) / 60000;
  const completed = runRecords.filter((r) => r.status === "completed").length;
  const failed = runRecords.filter((r) => r.status === "failed").length;
  const cancelled = runRecords.filter((r) => r.status === "cancelled").length;
  const completedDurations = runRecords.filter((r) => r.status === "completed").map((r) => r.durationMs);
  const durStats = stats(completedDurations);
  const qStats = stats(runRecords.map((r) => r.queueWaitMs).filter((n) => n >= 0));
  const blockedCount = samples.filter((s) => s.dispatchBlocked).length;

  return {
    config: config.name,
    targetActive,
    holdMs,
    headless,
    limits: { maxBrowsersPerHost: config.maxBrowsersPerHost, maxActiveFlows: config.maxActiveFlows, sharedPool: config.sharedPool, workloadWeights: config.workloadWeights },
    perClassWeight,
    samples,
    sustainedActive: stats(samples.map((s) => s.activeFlows)),
    cpuPercent: stats(samples.map((s) => s.cpuPercent).filter((n): n is number => n !== undefined)),
    chromiumProcs: stats(samples.map((s) => s.chromiumProcs)),
    chromiumRssMb: stats(samples.map((s) => s.chromiumRssMb)),
    chromiumPeakRssMb,
    eventLoopDelayMs: stats(samples.map((s) => s.eventLoopDelayMs)),
    processRssMb: stats(samples.map((s) => s.processRssMb)),
    nodeHeapUsedMb: stats(samples.map((s) => s.nodeHeapUsedMb)),
    sharedBrowsers: stats(samples.map((s) => s.sharedBrowsers)),
    sharedContexts: stats(samples.map((s) => s.sharedContexts)),
    queueDepth: stats(samples.map((s) => s.queueDepth)),
    dispatchBlockedFraction: samples.length ? Number((blockedCount / samples.length).toFixed(3)) : 0,
    blockedReasons: [...new Set(samples.map((s) => s.blockedReason).filter((r): r is string => !!r))],
    completed,
    failed,
    cancelled,
    totalRuns: runRecords.length,
    failureRate: runRecords.length ? Number((failed / runRecords.length).toFixed(4)) : 0,
    throughputPerMin: elapsedMin > 0 ? Number((completed / elapsedMin).toFixed(1)) : 0,
    durationP50Ms: durStats?.median,
    durationP95Ms: durStats?.p95,
    queueWaitP95Ms: qStats?.p95,
    retries: runRecords.reduce((s, r) => s + r.retryCount, 0),
    crashes: runRecords.filter((r) => r.errorClass === "browser-crash" || r.errorClass === "page-crash").length,
    failureSamples: [...new Set(runRecords.filter((r) => r.status === "failed").map((r) => `${r.cls}:${r.errorClass ?? "?"}:${(r.error ?? "").slice(0, 160)}`))].slice(0, 8),
    teardown
  };
}

/**
 * Read EVERY run-history row for a range/filter by FOLLOWING PAGINATION. `queryRunHistory` clamps a single
 * page to 500 rows, so a large single-page request (`{ limit: 100_000 }`) silently truncates to ≤500 — the
 * exact cause of the historical "3822 live vs 495 durable" discrepancy. Paginating against `page.total`
 * (an unbounded `COUNT(*)`) reads the complete population.
 */
export function readAllRunHistory(engine: ExecutionEngine, range: TelemetryRange = {}, filter?: RunHistoryFilter): RunHistoryRow[] {
  const pageSize = 500;
  const rows: RunHistoryRow[] = [];
  let offset = 0;
  for (;;) {
    const page = engine.getTelemetryRunHistory(range, { limit: pageSize, offset }, filter);
    rows.push(...page.rows);
    offset += page.rows.length;
    if (page.rows.length === 0 || offset >= page.total) break;
  }
  return rows;
}

/**
 * After stopAll, wait for every instance of the given executions to reach a terminal state, then read the
 * accurate per-run records (durationMs / queueWaitMs / status / errorClass) from the durable store. Only
 * instances that actually STARTED get a durable row — instances cancelled while still pending never
 * dispatched and are (correctly) excluded from workflow throughput/duration metrics.
 */
async function drainRuns(engine: ExecutionEngine, executionIds: string[], execToClass: Map<string, WorkloadClass>): Promise<RunRecord[]> {
  const ids = new Set(executionIds);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const active = engine.getInstances().filter((i) => ids.has(i.executionId) && !["completed", "failed", "cancelled"].includes(i.status));
    if (active.length === 0) break;
    engine.stopAll();
    await sleep(300);
  }
  // Durable per-run truth — read ALL rows via pagination (NOT a single clamped 500-row page).
  const allRows = readAllRunHistory(engine, {});
  const records: RunRecord[] = [];
  for (const row of allRows) {
    if (!ids.has(row.executionId)) continue;
    const cls = execToClass.get(row.executionId) ?? "light";
    let retryCount = 0;
    let error: string | undefined;
    if (row.status === "failed") {
      const detail = engine.getTelemetryRunDetail(row.instanceId).run;
      retryCount = detail?.retryCount ?? 0;
      error = detail?.error;
    }
    records.push({
      cls,
      status: row.status,
      durationMs: row.durationMs ?? 0,
      queueWaitMs: row.queueWaitMs ?? -1,
      retryCount,
      errorClass: row.errorClass,
      error
    });
  }
  return records;
}

/**
 * Leak assert after stopAll. The REAL leak signals are: instances not terminal, orphan BrowserContexts
 * (shared.activeContexts > 0 once every instance settled), and orphan Chromium processes above baseline.
 * Retained IDLE shared browsers are NOT a leak (the pool reuses them between runs) — the harness drains
 * them explicitly here to reclaim the processes, mirroring an engine-idle drain.
 */
async function assertTeardown(engine: ExecutionEngine, baselinePids: Set<number>): Promise<TeardownReport> {
  const notes: string[] = [];
  // 1) Wait for every instance to settle + no active (leased) contexts remain.
  const settleDeadline = Date.now() + 30_000;
  while (Date.now() < settleDeadline) {
    const activeInstances = engine.getInstances().filter((i) => ["starting", "running", "pending", "queued"].includes(i.status)).length;
    const shared = engine.getSharedBrowserSnapshot();
    if (activeInstances === 0 && shared.activeContexts === 0) break;
    await sleep(500);
  }
  const contextsAfterSettle = engine.getSharedBrowserSnapshot().activeContexts;
  const activeInstancesAtEnd = engine.getInstances().filter((i) => ["starting", "running", "pending", "queued"].includes(i.status)).length;

  // 2) Drain idle shared browsers (retained-but-idle is not a leak) and let dedicated browsers exit.
  await engine.drainIdleSharedBrowsers().catch(() => undefined);

  // 3) No orphan Chromium may remain above the pre-run baseline.
  let orphan = 0;
  const orphanDeadline = Date.now() + 20_000;
  while (Date.now() < orphanDeadline) {
    orphan = (await sampleChromium(baselinePids)).count;
    if (orphan === 0) break;
    await engine.drainIdleSharedBrowsers().catch(() => undefined);
    await sleep(1000);
  }
  const shared = engine.getSharedBrowserSnapshot();

  if (activeInstancesAtEnd !== 0) notes.push(`instances not terminal: ${activeInstancesAtEnd}`);
  if (contextsAfterSettle !== 0) notes.push(`orphan BrowserContexts (leased, not released): ${contextsAfterSettle}`);
  if (orphan !== 0) notes.push(`orphan Chromium processes above baseline: ${orphan}`);
  return {
    clean: notes.length === 0,
    activeInstancesAtEnd,
    sharedContextsAtEnd: contextsAfterSettle,
    sharedBrowsersAtEnd: shared.totalBrowsers,
    orphanChromiumProcsAtEnd: orphan,
    notes
  };
}

function normalizeMix(mix: Partial<Record<WorkloadClass, number>>): Record<WorkloadClass, number> {
  const out = { light: 0, medium: 0, heavy: 0, waiting: 0 };
  let sum = 0;
  for (const cls of WORKLOAD_CLASSES) sum += mix[cls] ?? 0;
  if (sum <= 0) return { ...out, light: 1 };
  for (const cls of WORKLOAD_CLASSES) out[cls] = (mix[cls] ?? 0) / sum;
  return out;
}

export { buildDirs as _buildDirs };
export async function cleanupRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Long benchmarks must not die on a single stray async rejection (e.g. a Playwright listener rejecting as a
 * context closes during cancellation). Log + count them instead of crashing; a non-zero count is surfaced.
 */
export function installBenchGuards(): { count: () => number } {
  let n = 0;
  process.on("unhandledRejection", (reason) => {
    n += 1;
    console.warn(`[bench:unhandledRejection #${n}] ${reason instanceof Error ? reason.message : String(reason)}`);
  });
  return { count: () => n };
}
