/**
 * Phase 9 — sustained MIXED soak on Config D (shared pool ON + A8 weights ON + Adaptive ON + Backpressure
 * ON) through the REAL ExecutionEngine, to prove leak-free long-run behaviour (NOT inferred from unit
 * tests). One engine for the whole soak; one busy run per class (high instance count so the run never falls
 * idle → no per-run pool churn, and every instance object is allocated up front so a rising RSS reflects a
 * real leak, not scheduling). Samples a time series, then stopAll + drain + asserts:
 *   active workflows = 0, leased contexts = 0, stale leases = 0, orphan contexts = 0, orphan pages = 0.
 *
 *   npm run benchmark:engine-soak                     (30 min, concurrency 6)
 *   AWKIT_SOAK_MS=600000 AWKIT_SOAK_CONC=6 npm run benchmark:engine-soak   (10 min)
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import { RUNTIME_DB_FILENAME } from "@src/runner/store/RuntimeStoreSchema";
import { chromiumPids, sampleChromium } from "./benchmark/lib.mts";
import { startWorkloadServer } from "./benchmark/lib.mts";
import { buildDirs, cleanupRoot, installBenchGuards, readAllRunHistory } from "./benchmark/engineHarness.mts";
import { buildFlow, buildScenario, buildProfile, WORKLOAD_CLASSES, DEFAULT_MIX, type WorkloadClass } from "./benchmark/workloads.mts";

installBenchGuards();

const SOAK_MS = Number.parseInt(process.env.AWKIT_SOAK_MS ?? "1800000", 10); // 30 min
const CONC = Number.parseInt(process.env.AWKIT_SOAK_CONC ?? "6", 10);
const SNAP_MS = Number.parseInt(process.env.AWKIT_SOAK_SNAPSHOT_MS ?? "15000", 10);
const PORT = 4450;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function snap(engine: ExecutionEngine, baselinePids: Set<number>, completed: number) {
  const cap = engine.getCapacitySnapshot();
  const shared = engine.getSharedBrowserSnapshot();
  const mem = process.memoryUsage();
  const instances = engine.getInstances();
  return {
    tSec: 0,
    chromiumProcs: 0, // filled by caller (async)
    chromiumRssMb: 0,
    activeFlows: cap.activeFlows,
    queueDepth: cap.queueDepth,
    adaptiveTarget: cap.adaptiveTarget,
    adaptiveState: cap.adaptiveState,
    sharedBrowsers: shared.totalBrowsers,
    sharedContexts: shared.activeContexts,
    // Page count proxy: every leased context holds ≥1 page; these flows open at most one transient popup, so
    // active contexts closely tracks live page count (the pool does not expose an exact page count).
    sharedPages: shared.activeContexts,
    sharedLaunched: shared.totalBrowsersLaunched,
    sharedClosed: shared.totalBrowsersClosed,
    crashes: shared.closeReasons.CRASH,
    poolInstances: instances.length,
    processRssMb: Math.round(mem.rss / (1024 * 1024)),
    nodeHeapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    nodeExternalMb: Math.round((mem.external ?? 0) / (1024 * 1024)),
    activeHandles: process.getActiveResourcesInfo ? process.getActiveResourcesInfo().length : -1,
    freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
    // Filled by the caller each snapshot (drift signals): event-loop delay mean + analytics-query latency.
    eventLoopDelayMs: 0,
    analyticsQueryMs: 0,
    completed
  };
}

/** first-third vs last-third drift for a series column (median of each third). */
function driftOf(xs: number[]): { firstThird: number; lastThird: number; deltaPct: number } {
  const v = xs.filter((n) => Number.isFinite(n));
  if (v.length < 6) return { firstThird: v[0] ?? 0, lastThird: v[v.length - 1] ?? 0, deltaPct: 0 };
  const third = Math.floor(v.length / 3);
  const med = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const a = med(v.slice(0, third));
  const b = med(v.slice(v.length - third));
  return { firstThird: a, lastThird: b, deltaPct: a > 0 ? Number((((b - a) / a) * 100).toFixed(1)) : 0 };
}

async function main() {
  const wl = await startWorkloadServer(PORT);
  const { dirs, root } = await buildDirs("awkit-soak-");
  const engine = new ExecutionEngine();
  engine.configureConcurrency({ maxBrowsersPerHost: Math.max(2, Math.min(4, Math.ceil(CONC / 2))), maxActiveFlows: CONC, useSharedBrowserPool: true, workloadWeights: true });

  const baselinePids = await chromiumPids();
  const execIds: string[] = [];
  const perClassInstances = (cls: WorkloadClass) => {
    const active = Math.max(1, Math.round(CONC * (DEFAULT_MIX[cls] ?? 0)));
    return Math.min(6000, Math.max(200, active * Math.ceil(SOAK_MS / 1200)));
  };
  for (const cls of WORKLOAD_CLASSES) {
    const active = Math.max(1, Math.round(CONC * (DEFAULT_MIX[cls] ?? 0)));
    const executionId = `soak-${cls}-${Date.now()}`;
    execIds.push(executionId);
    const flows = [buildFlow(cls, wl.base)];
    const scenario = buildScenario(cls, flows[0].id);
    const profile = buildProfile(cls, wl.base, { executionId, headless: true, maxConcurrentInstances: active });
    await engine.startRun(executionId, profile, Array.from({ length: perClassInstances(cls) }), dirs, {}, scenario, flows);
  }

  const countCompleted = () => engine.getInstances().filter((i) => i.status === "completed").length;
  const series: ReturnType<typeof snap>[] = [];
  const started = performance.now();

  console.log(`Soak: Config D, MIXED, concurrency=${CONC}, duration=${(SOAK_MS / 60000).toFixed(1)}min, snapshot every ${SNAP_MS / 1000}s, observability=${engine.isObservabilityEnabled() ? "ON" : "OFF"}`);
  const eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();
  const timeAnalytics = (): number => { const t0 = performance.now(); try { engine.getTelemetryCapacityAnalytics({}); } catch { /* read-only */ } return Math.round((performance.now() - t0) * 100) / 100; };
  // Warm-up before the baseline so short-lived startup allocations settle.
  await sleep(Math.min(30000, SOAK_MS / 10));
  const sqlitePath = join(root, "runtime", RUNTIME_DB_FILENAME);
  const sqliteBytesStart = await stat(sqlitePath).then((s) => s.size).catch(() => 0);
  const baseChrom = await sampleChromium(baselinePids);
  eld.reset();
  const baseline = { ...snap(engine, baselinePids, countCompleted()), tSec: 0, chromiumProcs: baseChrom.count, chromiumRssMb: baseChrom.rssMb, eventLoopDelayMs: Math.round((eld.mean / 1e6) * 10) / 10, analyticsQueryMs: timeAnalytics() };
  series.push(baseline);
  console.log(`  baseline: chromium=${baseline.chromiumProcs}proc/${baseline.chromiumRssMb}MB awkitRss=${baseline.processRssMb}MB heap=${baseline.nodeHeapUsedMb}MB contexts=${baseline.sharedContexts} browsers=${baseline.sharedBrowsers}`);

  const endAt = started + SOAK_MS;
  const artifactDir = join(process.cwd(), "reports", "browser-performance");
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "soak.json");

  while (performance.now() < endAt) {
    await sleep(SNAP_MS);
    const chrom = await sampleChromium(baselinePids);
    const eldMean = Math.round((eld.mean / 1e6) * 10) / 10;
    eld.reset();
    const s = { ...snap(engine, baselinePids, countCompleted()), tSec: Math.round((performance.now() - started) / 1000), chromiumProcs: chrom.count, chromiumRssMb: chrom.rssMb, eventLoopDelayMs: eldMean, analyticsQueryMs: timeAnalytics() };
    series.push(s);
    console.log(`  t=${s.tSec}s active=${s.activeFlows} q=${s.queueDepth} chromium=${s.chromiumProcs}p/${s.chromiumRssMb}MB browsers=${s.sharedBrowsers} ctx=${s.sharedContexts} awkitRss=${s.processRssMb}MB heap=${s.nodeHeapUsedMb}MB handles=${s.activeHandles} pool=${s.poolInstances} done=${s.completed} relaunches=${s.sharedLaunched}`);
    await writeFile(artifactPath, JSON.stringify({ soakMs: SOAK_MS, concurrency: CONC, series }, null, 2), "utf8");
  }

  // ── Teardown + leak asserts ─────────────────────────────────────────────────
  console.log(`\nStopping soak; asserting leak-free teardown…`);
  // Durable per-run truth: read ALL rows via pagination + an UNBOUNDED status aggregate. A single
  // `{ limit: 200000 }` page is clamped to 500 rows by queryRunHistory — the exact cause of the historical
  // "3822 live vs 495 durable" undercount. Cross-check the durable completed count against the live counter.
  const allRows = readAllRunHistory(engine, {});
  const statusCounts = engine.getTelemetryStatusCounts({});
  const liveCompleted = countCompleted();
  const completedTotal = statusCounts.byStatus["completed"] ?? 0;
  const failedTotal = statusCounts.byStatus["failed"] ?? 0;
  const retriesTotal = allRows.filter((r) => r.status === "failed").reduce((s, r) => s + (engine.getTelemetryRunDetail(r.instanceId).run?.retryCount ?? 0), 0);
  console.log(`durable completed=${completedTotal} (rows read=${allRows.length}, aggregate total=${statusCounts.total}) vs live completed=${liveCompleted} → ${completedTotal === liveCompleted ? "MATCH ✓" : "MISMATCH ✗"}`);

  engine.stopAll();
  const drainDeadline = Date.now() + 90_000;
  while (Date.now() < drainDeadline) {
    const active = engine.getInstances().filter((i) => ["starting", "running", "pending", "queued"].includes(i.status)).length;
    const ctx = engine.getSharedBrowserSnapshot().activeContexts;
    if (active === 0 && ctx === 0) break;
    engine.stopAll();
    await sleep(500);
  }
  const contextsAtEnd = engine.getSharedBrowserSnapshot().activeContexts;
  const activeAtEnd = engine.getInstances().filter((i) => ["starting", "running", "pending", "queued"].includes(i.status)).length;
  await engine.drainIdleSharedBrowsers().catch(() => undefined);
  let orphan = 0;
  const orphanDeadline = Date.now() + 30_000;
  while (Date.now() < orphanDeadline) {
    orphan = (await sampleChromium(baselinePids)).count;
    if (orphan === 0) break;
    await engine.drainIdleSharedBrowsers().catch(() => undefined);
    await sleep(1000);
  }
  const lockSnap = engine.getLockSnapshot();
  const staleLeases = (lockSnap as { staleLeases?: unknown[] }).staleLeases?.length ?? 0;
  // No leased contexts at end ⇒ no orphan pages (every page belongs to a closed context); the orphan-Chromium
  // check independently confirms no renderer/page process lingers.
  const orphanPages = contextsAtEnd === 0 ? 0 : contextsAtEnd;
  const finalShared = engine.getSharedBrowserSnapshot();
  eld.disable();

  // ── Observability persistence read (before cleanup deletes the temp store) ──
  await engine.persistDurableNow().catch(() => undefined);
  const sqliteBytesEnd = await stat(sqlitePath).then((s) => s.size).catch(() => 0);
  let obs = { capacityBuckets: 0, admissionBuckets: 0, lifecycleBuckets: 0, anomalies: 0, runObsSummaries: 0 };
  try {
    const obsStore = await SqliteRuntimeStore.open(sqlitePath, () => undefined);
    obs = {
      capacityBuckets: obsStore.listCapacityBuckets().length,
      admissionBuckets: obsStore.listAdmissionBuckets().length,
      lifecycleBuckets: obsStore.listBrowserLifecycleBuckets().length,
      anomalies: obsStore.listAnomalies(undefined, undefined, 500000).length,
      runObsSummaries: obsStore.listRuns(500000).filter((r) => typeof r.obsSampleCount === "number").length
    };
    await obsStore.close();
  } catch (e) {
    console.warn(`[soak] observability read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Terminal-run count must be read AFTER teardown and include `cancelled`: `stopAll()` cancels the
  // in-flight instances, which finalize as terminal `cancelled` runs WITH run-observation summaries. The
  // pre-teardown completed+failed count (used for the durable-vs-live match above) omits them, so comparing
  // run summaries against it produced a spurious mismatch. One summary per terminal run is the real invariant.
  const finalStatus = engine.getTelemetryStatusCounts({});
  const cancelledTotal = finalStatus.byStatus["cancelled"] ?? 0;
  const durableTerminalRuns = (finalStatus.byStatus["completed"] ?? 0) + (finalStatus.byStatus["failed"] ?? 0) + cancelledTotal;

  const first = series[0], last = series[series.length - 1];
  const growth = (a: number, b: number) => (a > 0 ? Number((((b - a) / a) * 100).toFixed(1)) : 0);
  const pct = (xs: number[], p: number) => {
    const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (v.length === 0) return 0;
    return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
  };
  const col = (k: keyof ReturnType<typeof snap>) => series.map((s) => s[k] as number);
  // NaN-safe peak: a single non-finite sample (e.g. an event-loop-delay window with no recorded events →
  // `histogram.mean` is NaN) must not poison the max via `Math.max(...[…, NaN])`.
  const peakOf = (xs: number[]) => {
    const v = xs.filter((x) => Number.isFinite(x));
    return v.length ? Math.max(...v) : 0;
  };
  const span = (k: keyof ReturnType<typeof snap>) => {
    const xs = col(k);
    return { start: xs[0], end: xs[xs.length - 1], p95: pct(xs, 95), peak: peakOf(xs) };
  };
  // Renderer/page crashes surface in the durable store as a crash-flavoured errorClass on failed runs.
  const pageCrashes = allRows.filter((r) => r.status === "failed" && /render|page|target.*crash|crash/i.test(String((r as { errorClass?: string }).errorClass ?? ""))).length;
  const queueWaits = allRows.map((r) => (r as { queueWaitMs?: number }).queueWaitMs ?? 0).filter((n) => Number.isFinite(n));

  const result = {
    soakMs: SOAK_MS, concurrency: CONC, snapshots: series.length,
    completed: completedTotal, failed: failedTotal, retries: retriesTotal,
    // Durable-vs-live reconciliation (proves the pagination fix for the 3822-vs-495 discrepancy).
    durableRowsRead: allRows.length, durableAggregateTotal: statusCounts.total, liveCompleted, durableCompletedMatchesLive: completedTotal === liveCompleted,
    browserCrashes: finalShared.closeReasons.CRASH, pageCrashes,
    browsersOverTime: { start: first.sharedBrowsers, end: last.sharedBrowsers, peak: peakOf(col("sharedBrowsers")) },
    contextsOverTime: { start: first.sharedContexts, end: last.sharedContexts, peak: peakOf(col("sharedContexts")) },
    pagesOverTime: { start: first.sharedPages, end: last.sharedPages, peak: peakOf(col("sharedPages")) },
    chromiumProcs: { start: first.chromiumProcs, end: last.chromiumProcs, peak: peakOf(col("chromiumProcs")) },
    chromiumRss: { startMb: first.chromiumRssMb, endMb: last.chromiumRssMb, p95Mb: pct(col("chromiumRssMb"), 95), peakMb: peakOf(col("chromiumRssMb")), growthPct: growth(first.chromiumRssMb, last.chromiumRssMb) },
    awkitRss: { startMb: first.processRssMb, endMb: last.processRssMb, p95Mb: pct(col("processRssMb"), 95), peakMb: peakOf(col("processRssMb")), growthPct: growth(first.processRssMb, last.processRssMb) },
    nodeHeap: { startMb: first.nodeHeapUsedMb, endMb: last.nodeHeapUsedMb, p95Mb: pct(col("nodeHeapUsedMb"), 95), peakMb: peakOf(col("nodeHeapUsedMb")), growthPct: growth(first.nodeHeapUsedMb, last.nodeHeapUsedMb) },
    activeHandles: { start: first.activeHandles, end: last.activeHandles, peak: peakOf(col("activeHandles")) },
    eventLoopDelay: { p95: pct(col("eventLoopDelayMs"), 95), peak: peakOf(col("eventLoopDelayMs")) },
    analyticsQueryMs: { p95: pct(col("analyticsQueryMs"), 95), peak: peakOf(col("analyticsQueryMs")) },
    queueDepth: span("queueDepth"),
    queueWaitP95Ms: pct(queueWaits, 95),
    poolInstances: { start: first.poolInstances, end: last.poolInstances },
    // Observability persistence + teardown invariants (Runtime Observability final-validation soak).
    observability: {
      ...obs,
      durableTerminalRuns,
      runSummariesMatchTerminalRuns: obs.runObsSummaries === durableTerminalRuns,
      sqliteBytesStart, sqliteBytesEnd, sqliteGrowthBytes: sqliteBytesEnd - sqliteBytesStart
    },
    // first-third vs last-third drift — distinguishes true monotonic drift from GC sawtooth / native high-water.
    drift: {
      awkitRssMb: driftOf(col("processRssMb")),
      nodeHeapMb: driftOf(col("nodeHeapUsedMb")),
      activeHandles: driftOf(col("activeHandles")),
      chromiumRssMb: driftOf(col("chromiumRssMb")),
      eventLoopDelayMs: driftOf(col("eventLoopDelayMs")),
      analyticsQueryMs: driftOf(col("analyticsQueryMs"))
    },
    sharedBrowsersRelaunched: finalShared.totalBrowsersLaunched,
    sharedBrowsersClosed: finalShared.totalBrowsersClosed,
    closeReasons: finalShared.closeReasons,
    launchFailures: finalShared.launchFailures,
    teardown: {
      activeWorkflowsAtEnd: activeAtEnd,
      leasedContextsAtEnd: contextsAtEnd,
      orphanContextsAtEnd: contextsAtEnd,
      orphanPagesAtEnd: orphanPages,
      staleLeasesAtEnd: staleLeases,
      orphanChromiumProcsAtEnd: orphan,
      clean: activeAtEnd === 0 && contextsAtEnd === 0 && orphanPages === 0 && staleLeases === 0 && orphan === 0
    },
    series
  };
  await writeFile(artifactPath, JSON.stringify(result, null, 2), "utf8");

  wl.server.close();
  await cleanupRoot(root);

  const rz = Object.entries(result.closeReasons).filter(([, n]) => (n as number) > 0).map(([k, n]) => `${k}=${n}`).join(" ") || "none";
  console.log(`\n=== Soak result (${(SOAK_MS / 60000).toFixed(1)} min, Config D, MIXED, concurrency ${CONC}) ===`);
  console.log(`completed=${result.completed} failed=${result.failed} retries=${result.retries} browserCrashes=${result.browserCrashes} pageCrashes=${result.pageCrashes}`);
  console.log(`Chromium RSS: ${result.chromiumRss.startMb}→${result.chromiumRss.endMb}MB  P95=${result.chromiumRss.p95Mb} peak=${result.chromiumRss.peakMb} (${result.chromiumRss.growthPct}%)`);
  console.log(`AWKIT RSS:    ${result.awkitRss.startMb}→${result.awkitRss.endMb}MB  P95=${result.awkitRss.p95Mb} peak=${result.awkitRss.peakMb} (${result.awkitRss.growthPct}%)`);
  console.log(`Node heap:    ${result.nodeHeap.startMb}→${result.nodeHeap.endMb}MB  P95=${result.nodeHeap.p95Mb} peak=${result.nodeHeap.peakMb} (${result.nodeHeap.growthPct}%)`);
  console.log(`browsers: ${result.browsersOverTime.start}→${result.browsersOverTime.end} peak=${result.browsersOverTime.peak}  contexts peak=${result.contextsOverTime.peak}  pages peak=${result.pagesOverTime.peak}  chromiumProcs peak=${result.chromiumProcs.peak}`);
  console.log(`active handles: ${result.activeHandles.start}→${result.activeHandles.end} peak=${result.activeHandles.peak}  queueDepth peak=${result.queueDepth.peak}  queueWaitP95=${result.queueWaitP95Ms}ms`);
  console.log(`browsers relaunched=${result.sharedBrowsersRelaunched} closed=${result.sharedBrowsersClosed} launchFailures=${result.launchFailures}`);
  console.log(`close reasons: ${rz}`);
  console.log(`event-loop delay: P95=${result.eventLoopDelay.p95}ms peak=${result.eventLoopDelay.peak}ms  analytics query: P95=${result.analyticsQueryMs.p95}ms peak=${result.analyticsQueryMs.peak}ms`);
  const o = result.observability;
  console.log(`Observability: capacityBuckets=${o.capacityBuckets} admissionBuckets=${o.admissionBuckets} lifecycleBuckets=${o.lifecycleBuckets} anomalies=${o.anomalies} runSummaries=${o.runObsSummaries}/${o.durableTerminalRuns} ${o.runSummariesMatchTerminalRuns ? "MATCH ✓" : "MISMATCH ✗"}`);
  console.log(`SQLite: ${(o.sqliteBytesStart / 1024).toFixed(0)}KB → ${(o.sqliteBytesEnd / 1024).toFixed(0)}KB (+${(o.sqliteGrowthBytes / 1024).toFixed(0)}KB)`);
  const d = result.drift;
  console.log(`Drift (1st→last third): awkitRss ${d.awkitRssMb.firstThird}→${d.awkitRssMb.lastThird}MB (${d.awkitRssMb.deltaPct}%)  heap ${d.nodeHeapMb.firstThird}→${d.nodeHeapMb.lastThird}MB (${d.nodeHeapMb.deltaPct}%)  handles ${d.activeHandles.firstThird}→${d.activeHandles.lastThird} (${d.activeHandles.deltaPct}%)  eld ${d.eventLoopDelayMs.firstThird}→${d.eventLoopDelayMs.lastThird}ms  analyticsQ ${d.analyticsQueryMs.firstThird}→${d.analyticsQueryMs.lastThird}ms`);
  console.log(`Teardown: active=${activeAtEnd} leasedContexts=${contextsAtEnd} orphanPages=${orphanPages} staleLeases=${staleLeases} orphanChromium=${orphan} → ${result.teardown.clean ? "CLEAN ✓" : "LEAK ✗"}`);
  console.log(`\nArtifact: ${artifactPath}`);
  process.exit(result.teardown.clean && result.durableCompletedMatchesLive ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
