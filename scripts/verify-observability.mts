/**
 * Runtime Observability & Historical Analytics verification (temp files; no external services).
 * Run with: npx tsx scripts/verify-observability.mts
 *
 * Proves:
 *  A — migration v4 applies on a fresh DB and upgrades a v3 DB in place; null-safe empty aggregates.
 *  B — admission-reason + pressure-state normalization (the single mapping from runtime free-text).
 *  C — RuntimeObservationCollector: per-run summary, capacity bucket roll, admission counts, lifecycle deltas.
 *  D — pure aggregation: per-workflow stats, capacity analytics, run-vs-history, rankings, trend width.
 *  E — store round-trip: buckets/anomalies write+read, queryCapacityAnalytics/…HistoricalStats/…Anomalies.
 *  F — deterministic anomaly/regression rules: min-history, normal variation, duration + failure regression,
 *      recovery clears, duplicate-storm dedup (the Phase 06 required proofs).
 *  G — per-table retention sweep.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import { RUNTIME_STORE_MIGRATIONS, type DurableRunRecord } from "@src/runner/store/RuntimeStoreSchema";
import { loadSqlJs } from "@src/runner/store/SqlJsLoader";
import { normalizeAdmissionReason, normalizePressureState } from "@src/reports/ObservabilityContracts";
import { RuntimeObservationCollector } from "@src/runner/runtime/RuntimeObservationCollector";
import {
  computeCapacityAnalytics,
  computeRunVsHistory,
  computeWorkflowHistoricalStats,
  computeWorkflowRankings,
  selectTrendBucketWidth
} from "@src/reports/observabilityAggregation";
import {
  DEFAULT_ANOMALY_CONFIG,
  detectRegressions,
  detectRunAnomalies,
  reconcileRegressions,
  type RegressionInput
} from "@src/runner/runtime/AnomalyDetector";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ISO = (ms: number) => new Date(ms).toISOString();

/** Build a durable run patch (status defaults to completed). */
function run(overrides: Partial<DurableRunRecord> & { instanceId: string }): Partial<DurableRunRecord> & { instanceId: string; executionId: string } {
  return { executionId: "exec", scenarioId: "wf-1", status: "completed", ...overrides };
}

async function writeV3Database(dbPath: string): Promise<void> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  for (const migration of RUNTIME_STORE_MIGRATIONS.filter((m) => m.version <= 3)) {
    for (const statement of migration.statements) db.run(statement);
    db.run("INSERT INTO runtime_migrations (version, name, appliedAt) VALUES (?, ?, ?)", [migration.version, migration.name, new Date().toISOString()]);
  }
  db.run(
    `INSERT INTO runtime_runs (instanceId, executionId, scenarioId, status, flowRunStatus, startedAt, endedAt, updatedAt)
     VALUES ('v3-run', 'v3-e', 'v3-s', 'completed', 'completed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z', '2026-01-01T00:01:00.000Z')`
  );
  await writeFile(dbPath, Buffer.from(db.export()));
  db.close();
}

async function main(): Promise<void> {
  console.log("Runtime Observability & Historical Analytics verification");
  const root = await mkdtemp(join(tmpdir(), "wfs-observability-"));

  // ── Part A — schema / migration ─────────────────────────────────────────────
  console.log("\nPart A — migration v4 + null-safe aggregates");
  const freshStore = await SqliteRuntimeStore.open(join(root, "fresh.sqlite"), () => undefined);
  const migs = freshStore.appliedMigrations();
  check("fresh DB applies migration v4", migs.some((m) => m.version === 4 && m.name === "observability-analytics"), JSON.stringify(migs));

  const upgradePath = join(root, "v3.sqlite");
  await writeV3Database(upgradePath);
  const upgraded = await SqliteRuntimeStore.open(upgradePath, () => undefined);
  check("v3 DB upgrades to v4 in place", upgraded.appliedMigrations().some((m) => m.version === 4));
  check("pre-v4 run survives upgrade + reads NULL obs columns", upgraded.getRun("v3-run")?.obsSampleCount === undefined);

  const emptyCap = freshStore.queryCapacityAnalytics({});
  check("empty capacity analytics is null-safe", emptyCap.bucketCount === 0 && emptyCap.admissionReasons.length === 0 && emptyCap.capacityUtilizationApplicable === false);
  const emptyStats = freshStore.queryWorkflowHistoricalStats("nope", {});
  check("empty per-workflow stats is null-safe", emptyStats.totalRuns === 0 && emptyStats.successRate === 0);
  await upgraded.close();

  // ── Part B — normalization ──────────────────────────────────────────────────
  console.log("\nPart B — admission-reason + pressure-state normalization");
  check("browser pool saturated → enum", normalizeAdmissionReason("browser pool saturated (2/2 browsers)") === "browser-pool-saturated");
  check("active flow limit → enum", normalizeAdmissionReason("active flow limit reached (4/4)") === "active-flow-limit");
  check("low host memory → enum", normalizeAdmissionReason("low host memory (100MB free < 512MB floor)") === "host-memory-floor");
  check("crash rate → enum", normalizeAdmissionReason("browser crash rate high (5 crashes in window) — pausing new dispatch") === "browser-crash-rate");
  check("system memory pressure → enum", normalizeAdmissionReason("system memory pressure (90% used > 85% cap)") === "system-memory-pressure");
  check("process memory pressure → enum", normalizeAdmissionReason("process memory pressure (3000MB RSS > 2048MB cap)") === "process-memory-pressure");
  check("cpu pressure → enum", normalizeAdmissionReason("CPU pressure (96% > 85% cap)") === "cpu-pressure");
  check("weighted budget → enum", normalizeAdmissionReason("weighted budget reached (active 3.00 + 1.50 > 4.00)") === "weighted-budget");
  check("origin/account → enum", normalizeAdmissionReason("origin/account semaphore saturated (origin:example.com)") === "origin-account-limit");
  check("unknown → other", normalizeAdmissionReason("something new") === "other");
  check("pressure state normalized", normalizePressureState("critical") === "critical" && normalizePressureState("weird") === "unknown");

  // ── Part C — collector ──────────────────────────────────────────────────────
  console.log("\nPart C — RuntimeObservationCollector");
  const t0 = 1_000_000_000_000;
  const collector = new RuntimeObservationCollector(t0);
  collector.startRun("run-a");
  for (let i = 0; i < 10; i++) {
    collector.observeTick(
      { systemCpuPercent: 50 + i, systemMemoryPercent: 60, chromiumRssMb: 800 + i * 10, awkitRssMb: 200, nodeHeapMb: 120 },
      { adaptiveTarget: 4, weightedBudget: 4, activeWeight: 2 + i * 0.1, activeFlows: 3, queuedFlows: i, sharedBrowsers: 2, contextCount: 4, pageCount: 4, weightedAdmissionActive: true }
    );
  }
  collector.recordAdmissionDelay("cpu-pressure", "pressure");
  collector.recordAdmissionDelay("cpu-pressure", "pressure");
  collector.recordAdmissionDelay("weighted-budget", "stable");
  collector.observeRetirements({ CONTEXT_COUNT_RECYCLE: 3, IDLE_DRAIN: 1 });
  collector.observeRetirements({ CONTEXT_COUNT_RECYCLE: 5, IDLE_DRAIN: 1 }); // delta +2 recycle

  const summary = collector.finalizeRun("run-a");
  check("run summary has 10 samples", summary?.sampleCount === 10);
  check("run summary CPU mean sane", (summary?.observedSystemCpuMeanDuringRun ?? 0) >= 50 && (summary?.observedSystemCpuMeanDuringRun ?? 0) <= 60);
  check("run summary Chromium P95 present", typeof summary?.observedChromiumRssP95MbDuringRun === "number");
  check("finalize unknown run → undefined", collector.finalizeRun("missing") === undefined);

  const rolled = collector.maybeRollBuckets(t0 + 40_000, 30_000);
  check("capacity bucket rolled with samples", rolled?.capacity?.sampleCount === 10, JSON.stringify(rolled?.capacity?.sampleCount));
  check("capacity bucket weighted-admission flagged", rolled?.capacity?.weightedAdmissionActive === true);
  check("admission buckets rolled (2 reasons)", rolled?.admission.length === 2);
  const cpuAdmission = rolled?.admission.find((a) => a.reason === "cpu-pressure");
  check("cpu-pressure admission counted twice", cpuAdmission?.count === 2, JSON.stringify(cpuAdmission));
  const recycle = rolled?.lifecycle.find((l) => l.reason === "CONTEXT_COUNT_RECYCLE");
  check("lifecycle delta counted (5 cumulative → 5 total)", recycle?.count === 5, JSON.stringify(rolled?.lifecycle));
  check("no roll before window elapses", collector.maybeRollBuckets(t0 + 45_000, 30_000) === undefined);

  // ── Part D — pure aggregation ───────────────────────────────────────────────
  console.log("\nPart D — pure aggregation");
  const runs: DurableRunRecord[] = [
    fullRun({ instanceId: "r1", status: "completed", durationMs: 1000, queueWaitMs: 100, headed: true, resourceProfile: "balanced", isolationClass: "SHARED_CONTEXT", obsSystemCpuMean: 40, obsChromiumRssMeanMb: 700, workloadWeight: 1 }),
    fullRun({ instanceId: "r2", status: "completed", durationMs: 2000, queueWaitMs: 500, headed: true, resourceProfile: "balanced", isolationClass: "SHARED_CONTEXT", obsSystemCpuMean: 45, obsChromiumRssMeanMb: 720, workloadWeight: 1 }),
    fullRun({ instanceId: "r3", status: "failed", durationMs: 8000, queueWaitMs: 50, headed: false, resourceProfile: "low-resource", isolationClass: "DEDICATED_BROWSER", obsSystemCpuMean: 90, obsChromiumRssMeanMb: 1500, workloadWeight: 2, retryCount: 2 })
  ];
  const stats = computeWorkflowHistoricalStats("wf-1", "Workflow One", runs);
  check("stats total runs = 3", stats.totalRuns === 3);
  check("stats success rate = 2/3", Math.abs(stats.successRate - 2 / 3) < 1e-9);
  check("stats retry rate = 1/3", Math.abs(stats.retryRate - 1 / 3) < 1e-9);
  check("stats duration P95 present", typeof stats.duration.p95Ms === "number");
  check("stats headed distribution", stats.headedDistribution.find((d) => d.key === "headed")?.count === 2);
  check("stats isolation distribution", stats.isolationClassDistribution.find((d) => d.key === "SHARED_CONTEXT")?.count === 2);
  check("stats queue-delay proxy (queueWait>250) = 1/3", Math.abs((stats.queueDelayRunRate ?? 0) - 1 / 3) < 1e-9);

  const capBuckets = [
    { bucketStart: ISO(t0), bucketEnd: ISO(t0 + 30_000), sampleCount: 10, cpuMean: 50, cpuP95: 70, cpuMax: 80, activeWeightMean: 2, weightedBudgetMean: 4, activeFlowsMean: 3, adaptiveTargetMean: 4, queuedFlowsMean: 1, queuedFlowsMax: 3, sharedBrowsersMean: 2, contextCountMean: 4, weightedAdmissionActive: true },
    { bucketStart: ISO(t0 + 30_000), bucketEnd: ISO(t0 + 60_000), sampleCount: 20, cpuMean: 80, cpuP95: 95, cpuMax: 99, activeWeightMean: 3.5, weightedBudgetMean: 4, activeFlowsMean: 4, adaptiveTargetMean: 4, queuedFlowsMean: 2, queuedFlowsMax: 5, sharedBrowsersMean: 2, contextCountMean: 5, weightedAdmissionActive: true }
  ];
  const admBuckets = [
    { bucketStart: ISO(t0), reason: "cpu-pressure", count: 6 },
    { bucketStart: ISO(t0), reason: "weighted-budget", count: 4 }
  ];
  const lifeBuckets = [{ bucketStart: ISO(t0), reason: "CONTEXT_COUNT_RECYCLE", count: 7 }];
  const analytics = computeCapacityAnalytics(capBuckets as never, admBuckets as never, lifeBuckets as never, runs);
  check("capacity CPU weighted mean = 70", analytics.systemCpu.mean === 70, JSON.stringify(analytics.systemCpu));
  check("capacity CPU bucketed-P95 ceiling = 95", analytics.systemCpu.p95 === 95);
  check("capacity utilization applicable (weights active)", analytics.capacityUtilizationApplicable === true && analytics.capacityUtilization !== undefined);
  check("admission reasons percentages sum ~100", Math.round(analytics.admissionReasons.reduce((s, r) => s + r.percentage, 0)) === 100);
  check("cpu-pressure is 60% of admission delays", analytics.admissionReasons.find((r) => r.reason === "cpu-pressure")?.percentage === 60);
  check("failure-at-pressure grouped by pressureStateAtRun", analytics.failureAtPressure.length >= 1);
  check("pool effectiveness shared/dedicated ratio", analytics.effectiveness.sharedRatio !== undefined && analytics.effectiveness.dedicatedRatio !== undefined);

  const rankRuns = computeWorkflowRankings([stats], "slowest-p95", 5);
  check("ranking returns rows", rankRuns.rows.length === 1 && rankRuns.rows[0].scenarioId === "wf-1");
  check("trend width auto-selects hour for short range", selectTrendBucketWidth(3_600_000) === "hour");
  check("trend width auto-selects week for long range", selectTrendBucketWidth(60 * 86_400_000) === "week");

  const vsHistory = computeRunVsHistory(runs[2], runs);
  check("run-vs-history ratio computed", vsHistory.durationVsP95Ratio !== undefined && vsHistory.historicalSampleCount === 2);

  // ── Part E — store round-trip ───────────────────────────────────────────────
  console.log("\nPart E — store round-trip");
  const store = await SqliteRuntimeStore.open(join(root, "rt.sqlite"), () => undefined);
  for (const r of runs) store.upsertRun(fullRun(r) as never);
  store.recordCapacityBucket(capBuckets[0] as never);
  store.recordCapacityBucket(capBuckets[1] as never);
  store.recordAdmissionBucket(admBuckets[0] as never);
  store.recordAdmissionBucket(admBuckets[1] as never);
  store.recordBrowserLifecycleBucket(lifeBuckets[0] as never);
  check("capacity buckets round-trip", store.listCapacityBuckets().length === 2);
  check("admission buckets round-trip", store.listAdmissionBuckets().length === 2);
  const storeAnalytics = store.queryCapacityAnalytics({});
  check("store capacity analytics computes", storeAnalytics.bucketCount === 2 && storeAnalytics.totalAdmissionDelays === 10);
  const storeStats = store.queryWorkflowHistoricalStats("wf-1", {});
  check("store per-workflow stats round-trip", storeStats.totalRuns === 3 && storeStats.headedDistribution.length >= 1);
  check("run dimensions round-trip (headed boolean)", store.getRun("r1")?.headed === true);
  check("listRunsForScenario returns runs", store.listRunsForScenario("wf-1").length === 3);

  store.recordAnomaly({ workflowId: "wf-1", runId: "r3", detectedAt: ISO(t0), scope: "run", signalType: "duration-slow", severity: "warning", state: "active" });
  check("anomaly round-trip", store.queryAnomalies({}).length === 1 && store.queryAnomalies({})[0].signalType === "duration-slow");
  check("latestAnomaly keyed lookup", store.latestAnomaly("wf-1", "duration-slow", "run")?.severity === "warning");

  // ── Part F — deterministic anomaly / regression rules ───────────────────────
  console.log("\nPart F — anomaly / regression rules");
  const history = Array.from({ length: 12 }, (_, i) => fullRun({ instanceId: `h${i}`, durationMs: 1000, queueWaitMs: 100, status: "completed" }));

  check("insufficient history → no run anomaly", detectRunAnomalies(fullRun({ instanceId: "x", durationMs: 9999 }), history.slice(0, 3)).length === 0);
  check("normal variation → no run anomaly", detectRunAnomalies(fullRun({ instanceId: "x", durationMs: 1100 }), history).length === 0);
  const slow = detectRunAnomalies(fullRun({ instanceId: "x", durationMs: 5000 }), history);
  check("slow run flagged (≥2.5× median)", slow.some((a) => a.signalType === "duration-slow"));
  const veryslow = detectRunAnomalies(fullRun({ instanceId: "x", durationMs: 6000 }), history);
  check("very slow run is critical (≥4× median)", veryslow.find((a) => a.signalType === "duration-slow")?.severity === "critical");
  const rareFail = detectRunAnomalies(fullRun({ instanceId: "x", status: "failed", durationMs: 1000 }), history);
  check("failure when normally-succeeds flagged", rareFail.some((a) => a.signalType === "unexpected-failure"));

  const prev = Array.from({ length: 12 }, (_, i) => fullRun({ instanceId: `p${i}`, durationMs: 1000, status: "completed" }));
  const recentSlow = Array.from({ length: 12 }, (_, i) => fullRun({ instanceId: `c${i}`, durationMs: 2000, status: "completed" }));
  const durReg = detectRegressions({ recent: recentSlow, previous: prev, recentQueueDelays: 0, previousQueueDelays: 0, windowLabel: "7d" });
  check("duration P95 regression detected", durReg.some((a) => a.signalType === "duration-p95"));
  check("regression needs min runs in both windows", detectRegressions({ recent: recentSlow.slice(0, 3), previous: prev, recentQueueDelays: 0, previousQueueDelays: 0, windowLabel: "7d" }).length === 0);

  const prevOk = Array.from({ length: 12 }, (_, i) => fullRun({ instanceId: `po${i}`, status: "completed", durationMs: 1000 }));
  const recentFail = [
    ...Array.from({ length: 6 }, (_, i) => fullRun({ instanceId: `rf${i}`, status: "failed", durationMs: 1000 })),
    ...Array.from({ length: 6 }, (_, i) => fullRun({ instanceId: `rs${i}`, status: "completed", durationMs: 1000 }))
  ];
  const failReg = detectRegressions({ recent: recentFail, previous: prevOk, recentQueueDelays: 0, previousQueueDelays: 0, windowLabel: "7d" });
  check("failure-rate regression detected", failReg.some((a) => a.signalType === "failure-rate"));

  // dedup / cooldown
  const nowIso = ISO(t0 + 100_000);
  const firstRows = reconcileRegressions(durReg, [], "wf-1", nowIso);
  check("first regression inserts active row", firstRows.length === 1 && firstRows[0].state === "active");
  const activeExisting = [{ ...firstRows[0], id: 1, detectedAt: nowIso }];
  const dupRows = reconcileRegressions(durReg, activeExisting as never, "wf-1", ISO(t0 + 200_000));
  check("duplicate regression suppressed within cooldown", dupRows.length === 0);
  const recovered = reconcileRegressions([], activeExisting as never, "wf-1", ISO(t0 + 999_999_999));
  check("recovery emits a recovered transition row", recovered.length === 1 && recovered[0].state === "recovered");

  // ── Part G — retention (real now-relative timestamps) ───────────────────────
  console.log("\nPart G — per-table retention");
  const retStore = await SqliteRuntimeStore.open(join(root, "ret.sqlite"), () => undefined);
  const now = Date.now();
  const recentIso = ISO(now - 60_000); // 1 minute ago — within every window
  const oldBucketIso = ISO(now - 40 * 86_400_000); // 40 days ago — past the 14-day bucket window
  const oldAnomalyIso = ISO(now - 120 * 86_400_000); // 120 days ago — past the 90-day anomaly window
  retStore.recordCapacityBucket({ bucketStart: recentIso, bucketEnd: recentIso, sampleCount: 5 } as never);
  retStore.recordCapacityBucket({ bucketStart: oldBucketIso, bucketEnd: oldBucketIso, sampleCount: 1 } as never);
  retStore.recordAnomaly({ workflowId: "wf-1", detectedAt: recentIso, scope: "regression", signalType: "duration-p95", severity: "warning", state: "active" });
  retStore.recordAnomaly({ workflowId: "wf-1", detectedAt: oldAnomalyIso, scope: "regression", signalType: "queue-wait-p95", severity: "info", state: "active" });
  retStore.sweepRetention({ observabilityBucketDays: 14, anomalyDays: 90 });
  const caps = retStore.listCapacityBuckets();
  check("retention drops old capacity bucket but keeps recent", caps.length === 1 && caps[0].bucketStart === recentIso, `${caps.length}`);
  const anoms = retStore.queryAnomalies({});
  check("retention keeps recent anomaly, drops old", anoms.length === 1 && anoms[0].signalType === "duration-p95", JSON.stringify(anoms.map((a) => a.signalType)));
  await retStore.close();

  await store.close();
  await freshStore.close();
  await rm(root, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

/** Build a full DurableRunRecord for the pure aggregation/detection tests. */
function fullRun(overrides: Partial<DurableRunRecord> & { instanceId: string }): DurableRunRecord {
  const at = "2026-07-16T00:00:00.000Z";
  return {
    executionId: "exec",
    scenarioId: "wf-1",
    status: "completed",
    startedAt: at,
    endedAt: at,
    updatedAt: at,
    ...overrides
  } as DurableRunRecord;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
