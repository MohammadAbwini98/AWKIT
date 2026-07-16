/**
 * Phase 3 — SQLite storage-growth + query-performance benchmark for the Runtime Observability layer.
 * Replaces projections with MEASURED evidence: builds deterministic benchmark databases at multiple run
 * scales (default 5k / 25k / 50k) plus a fixed observability set (14 days of capacity/admission/lifecycle
 * buckets at the documented 30 s cadence + 90 days of sparse anomalies), then measures:
 *
 *  - real on-disk file size + per-category contribution (runs / capacity / admission / lifecycle / anomaly);
 *  - bytes per run and per bucket/anomaly;
 *  - projected 1 / 7 / 30 / 90-day growth from the measured per-unit costs + a stated throughput assumption;
 *  - cold + warm P50/P95/max latency for every analytics query at each scale, with returned-row counts;
 *  - query plans (EXPLAIN QUERY PLAN) + index coverage for the important queries;
 *  - retention cutoff-boundary correctness (24 h raw / 14 d buckets / 90 d anomalies) + interrupted-run safety.
 *
 * Uses the REAL SqliteRuntimeStore write + read paths and the same schema/indexes as production. No Chromium,
 * no network. Deterministic (seeded PRNG) so runs are comparable.
 *
 *   npm run benchmark:observability-storage
 *   AWKIT_STORAGE_SIZES=5000,25000 AWKIT_STORAGE_QUERY_REPS=25 npm run benchmark:observability-storage
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import { loadSqlJs } from "@src/runner/store/SqlJsLoader";
import { RUNTIME_DB_FILENAME } from "@src/runner/store/RuntimeStoreSchema";
import type {
  DurableAnomalyRecord,
  DurableCapacityBucketRecord,
  DurableRunRecord
} from "@src/runner/store/RuntimeStoreSchema";
import type { TelemetryRange } from "@src/reports/TelemetryContracts";
import type { WorkflowRankingMetric } from "@src/reports/ObservabilityContracts";

const SIZES = (process.env.AWKIT_STORAGE_SIZES ?? "5000,25000,50000").split(",").map((s) => Number.parseInt(s.trim(), 10)).filter((n) => n > 0);
const CAP_BUCKETS = Number.parseInt(process.env.AWKIT_STORAGE_CAP_BUCKETS ?? "40320", 10); // 14 d @ 30 s
const ADM_BUCKETS = Number.parseInt(process.env.AWKIT_STORAGE_ADM_BUCKETS ?? "3000", 10);
const LIFE_BUCKETS = Number.parseInt(process.env.AWKIT_STORAGE_LIFE_BUCKETS ?? "2000", 10);
const ANOMALIES = Number.parseInt(process.env.AWKIT_STORAGE_ANOMALIES ?? "900", 10); // ~90 d sparse
const QUERY_REPS = Number.parseInt(process.env.AWKIT_STORAGE_QUERY_REPS ?? "25", 10);
const WORKFLOWS = Number.parseInt(process.env.AWKIT_STORAGE_WORKFLOWS ?? "12", 10);
const RUNS_PER_DAY = Number.parseInt(process.env.AWKIT_STORAGE_RUNS_PER_DAY ?? "5000", 10); // projection assumption
const DAY_MS = 86_400_000;

// Deterministic PRNG (mulberry32) so datasets are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(rng: () => number, xs: T[]): T => xs[Math.floor(rng() * xs.length)];

const STATUSES = ["completed", "completed", "completed", "completed", "completed", "completed", "failed", "cancelled"]; // ~75/12.5/12.5
const PROFILES = ["balanced", "balanced", "low-resource", "maximum-compatibility"];
const ISOLATIONS = ["SHARED_CONTEXT", "SHARED_CONTEXT", "SHARED_CONTEXT", "DEDICATED_BROWSER", "PERSISTENT_BROWSER", "HANDOFF_BROWSER"];
const PRESSURES = ["healthy", "healthy", "stable", "stable", "pressure", "critical"];
const REASONS = ["active-flow-limit", "weighted-budget", "cpu-pressure", "browser-pool-saturated", "system-memory-pressure", "origin-account-limit"];
const CLOSE_REASONS = ["CONTEXT_COUNT_RECYCLE", "IDLE_DRAIN", "UNHEALTHY", "CRASH", "POOL_SHUTDOWN"];
const MACHINES = ["mach-A", "mach-B"];

function buildRun(rng: () => number, i: number, nowMs: number): Partial<DurableRunRecord> & { instanceId: string; executionId: string } {
  const wf = i % WORKFLOWS;
  const startedMs = nowMs - Math.floor(rng() * 90 * DAY_MS); // spread over 90 days
  const duration = 500 + Math.floor(rng() * 4500) + wf * 40;
  const status = pick(rng, STATUSES);
  const queueWait = rng() < 0.35 ? Math.floor(rng() * 3000) : Math.floor(rng() * 200); // ~35% > proxy
  const started = new Date(startedMs).toISOString();
  const ended = new Date(startedMs + duration).toISOString();
  return {
    instanceId: `run-${i}`,
    executionId: `exec-${wf}-${Math.floor(i / WORKFLOWS)}`,
    scenarioId: `wf-${wf}`,
    scenarioName: `Workflow ${wf}`,
    triggerType: "manual",
    status,
    flowRunStatus: status,
    startedAt: started,
    endedAt: ended,
    updatedAt: ended,
    durationMs: duration,
    queueWaitMs: queueWait,
    retryCount: status === "failed" ? 1 + Math.floor(rng() * 2) : 0,
    reportCategory: status === "failed" ? "flow-error" : undefined,
    errorClass: status === "failed" ? pick(rng, ["timeout", "navigation", "assertion", "browser-crash"]) : undefined,
    machineId: pick(rng, MACHINES),
    logicalCpuCount: 12,
    totalMemoryMb: 16000,
    executionMode: "auto",
    browserPoolMode: rng() < 0.8 ? "shared" : "dedicated",
    configuredConcurrency: 6,
    observedPeakConcurrency: 1 + Math.floor(rng() * 6),
    workloadClass: pick(rng, ["light", "medium", "heavy", "waiting"]),
    headed: rng() < 0.2,
    resourceProfile: pick(rng, PROFILES),
    isolationClass: pick(rng, ISOLATIONS),
    workloadWeight: Number((0.8 + rng() * 1.6).toFixed(2)),
    pressureStateAtRun: pick(rng, PRESSURES),
    obsSampleCount: 3 + Math.floor(rng() * 20),
    obsSystemCpuMean: Number((20 + rng() * 60).toFixed(1)),
    obsSystemCpuP95: Number((40 + rng() * 55).toFixed(1)),
    obsSystemMemoryMean: Number((40 + rng() * 40).toFixed(1)),
    obsSystemMemoryP95: Number((50 + rng() * 45).toFixed(1)),
    obsChromiumRssMeanMb: 300 + Math.floor(rng() * 700),
    obsChromiumRssP95Mb: 500 + Math.floor(rng() * 900),
    obsAwkitRssMeanMb: 150 + Math.floor(rng() * 120),
    obsAwkitRssP95Mb: 180 + Math.floor(rng() * 160)
  };
}

function buildCapacityBucket(rng: () => number, startMs: number): DurableCapacityBucketRecord {
  const iso = new Date(startMs).toISOString();
  const active = rng() * 6;
  return {
    bucketStart: iso,
    bucketEnd: new Date(startMs + 30_000).toISOString(),
    sampleCount: 5 + Math.floor(rng() * 12),
    cpuMean: Number((20 + rng() * 60).toFixed(1)), cpuP95: Number((40 + rng() * 55).toFixed(1)), cpuMax: Number((50 + rng() * 50).toFixed(1)),
    memoryMean: Number((40 + rng() * 40).toFixed(1)), memoryP95: Number((50 + rng() * 45).toFixed(1)), memoryMax: Number((60 + rng() * 40).toFixed(1)),
    awkitRssMeanMb: 150 + Math.floor(rng() * 100), awkitRssP95Mb: 180 + Math.floor(rng() * 130), awkitRssMaxMb: 200 + Math.floor(rng() * 150),
    chromiumRssMeanMb: 300 + Math.floor(rng() * 600), chromiumRssP95Mb: 500 + Math.floor(rng() * 800), chromiumRssMaxMb: 600 + Math.floor(rng() * 1000),
    nodeHeapMeanMb: 80 + Math.floor(rng() * 60), nodeHeapMaxMb: 100 + Math.floor(rng() * 90),
    adaptiveTargetMean: Number((3 + rng() * 3).toFixed(2)), adaptiveTargetMin: 2, adaptiveTargetMax: 6,
    weightedBudgetMean: 6, weightedBudgetMin: 6, weightedBudgetMax: 6,
    activeWeightMean: Number((active * 0.5).toFixed(2)), activeWeightP95: Number((active * 0.7).toFixed(2)), activeWeightMax: Number(active.toFixed(2)),
    activeFlowsMean: Number(active.toFixed(2)), activeFlowsP95: Number((active + 1).toFixed(2)), activeFlowsMax: Math.ceil(active + 1),
    queuedFlowsMean: Number((rng() * 20).toFixed(2)), queuedFlowsP95: Number((rng() * 40).toFixed(2)), queuedFlowsMax: Math.floor(rng() * 60),
    sharedBrowsersMean: Number((1 + rng() * 2).toFixed(2)), sharedBrowsersMax: 3,
    contextCountMean: Number((active).toFixed(2)), contextCountMax: Math.ceil(active + 1),
    pageCountMean: Number((active).toFixed(2)), pageCountMax: Math.ceil(active + 1),
    weightedAdmissionActive: true
  };
}

interface PhaseSizes { schema: number; runs: number; capacity: number; admission: number; lifecycle: number; anomalies: number }

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

/** Time a synchronous query fn `reps` times; return cold + warm P50/P95/max + row count. */
function timeQuery(label: string, fn: () => unknown, reps: number): { label: string; coldMs: number; warmP50Ms: number; warmP95Ms: number; maxMs: number; rows: number } {
  const times: number[] = [];
  let rows = 0;
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    const out = fn();
    const t1 = performance.now();
    times.push(t1 - t0);
    if (i === 0) rows = rowCount(out);
  }
  const cold = times[0];
  const warm = times.slice(1).sort((a, b) => a - b);
  const p = (arr: number[], q: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(q * arr.length))] : 0);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return { label, coldMs: r3(cold), warmP50Ms: r3(p(warm, 0.5)), warmP95Ms: r3(p(warm, 0.95)), maxMs: r3(Math.max(...times)), rows };
}
function rowCount(out: unknown): number {
  if (Array.isArray(out)) return out.length;
  if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    if (Array.isArray(o.rows)) return o.rows.length;
    if (Array.isArray(o.buckets)) return o.buckets.length;
    return 1;
  }
  return out === undefined ? 0 : 1;
}

async function benchmarkSize(n: number, root: string): Promise<{ size: number; file: PhaseSizes; perUnit: Record<string, number>; queries: ReturnType<typeof timeQuery>[]; sampleInstanceId: string; dbPath: string }> {
  const dir = join(root, `db-${n}`);
  await mkdir(dir, { recursive: true });
  const dbPath = join(dir, RUNTIME_DB_FILENAME);
  const store = await SqliteRuntimeStore.open(dbPath, () => undefined);
  const rng = mulberry32(0x9e3779b9 ^ n);
  const nowMs = Date.now();

  await store.persistNow();
  const sSchema = await fileSize(dbPath);

  // Runs
  for (let i = 0; i < n; i++) store.upsertRun(buildRun(rng, i, nowMs));
  await store.persistNow();
  const sRuns = await fileSize(dbPath);

  // Capacity buckets (14 d @ 30 s, most-recent-anchored so query windows see them)
  for (let i = 0; i < CAP_BUCKETS; i++) store.recordCapacityBucket(buildCapacityBucket(rng, nowMs - i * 30_000));
  await store.persistNow();
  const sCap = await fileSize(dbPath);

  // Admission buckets
  for (let i = 0; i < ADM_BUCKETS; i++) {
    store.recordAdmissionBucket({ bucketStart: new Date(nowMs - i * 30_000).toISOString(), reason: pick(rng, REASONS), pressureState: pick(rng, PRESSURES), count: 1 + Math.floor(rng() * 8) });
  }
  await store.persistNow();
  const sAdm = await fileSize(dbPath);

  // Lifecycle buckets
  for (let i = 0; i < LIFE_BUCKETS; i++) {
    store.recordBrowserLifecycleBucket({ bucketStart: new Date(nowMs - i * 60_000).toISOString(), reason: pick(rng, CLOSE_REASONS), count: 1 + Math.floor(rng() * 4) });
  }
  await store.persistNow();
  const sLife = await fileSize(dbPath);

  // Anomalies (90 d sparse)
  for (let i = 0; i < ANOMALIES; i++) {
    const rec: DurableAnomalyRecord = {
      workflowId: `wf-${i % WORKFLOWS}`,
      runId: `run-${Math.floor(rng() * n)}`,
      detectedAt: new Date(nowMs - Math.floor(rng() * 90 * DAY_MS)).toISOString(),
      scope: rng() < 0.7 ? "run" : "regression",
      signalType: pick(rng, ["duration-median", "queue-wait-p95", "failure-rare", "duration-p95", "failure-rate", "queue-delays"]),
      severity: pick(rng, ["info", "warning", "critical"]),
      currentValue: Number((rng() * 5000).toFixed(1)),
      baselineValue: Number((rng() * 3000).toFixed(1)),
      thresholdRule: "benchmark",
      windowLabel: "30d",
      state: rng() < 0.85 ? "active" : "recovered",
      note: "synthetic anomaly for storage benchmark"
    };
    store.recordAnomaly(rec);
  }
  await store.persistNow();
  const sAnom = await fileSize(dbPath);

  const file: PhaseSizes = {
    schema: sSchema,
    runs: sRuns - sSchema,
    capacity: sCap - sRuns,
    admission: sAdm - sCap,
    lifecycle: sLife - sAdm,
    anomalies: sAnom - sLife
  };
  const perUnit = {
    bytesPerRun: Math.round(file.runs / n),
    bytesPerCapacityBucket: Math.round(file.capacity / CAP_BUCKETS),
    bytesPerAdmissionBucket: Math.round(file.admission / ADM_BUCKETS),
    bytesPerLifecycleBucket: Math.round(file.lifecycle / LIFE_BUCKETS),
    bytesPerAnomaly: Math.round(file.anomalies / ANOMALIES),
    totalBytes: sAnom
  };

  // ── Query benchmarks ────────────────────────────────────────────────────────
  const all: TelemetryRange = {};
  const last30: TelemetryRange = { sinceIso: new Date(nowMs - 30 * DAY_MS).toISOString() };
  const sampleInstanceId = "run-0"; // wf-0 has the most history
  const deepOffset = Math.max(0, n - 50);
  const rankMetrics: WorkflowRankingMetric[] = ["most-executed", "highest-queue-delay"];
  const queries = [
    timeQuery("overview", () => store.queryOverview(all), QUERY_REPS),
    timeQuery("run-history first page", () => store.queryRunHistory(all, { limit: 50, offset: 0 }), QUERY_REPS),
    timeQuery("run-history deep page", () => store.queryRunHistory(all, { limit: 50, offset: deepOffset }), QUERY_REPS),
    timeQuery("status counts", () => store.countRunsByStatus(all), QUERY_REPS),
    timeQuery("workflow summary", () => store.queryWorkflowHistoricalStats("wf-3", all), QUERY_REPS),
    timeQuery("workflow 30-day trend", () => store.queryWorkflowHistoricalTrend("wf-3", last30), QUERY_REPS),
    timeQuery("workflow rankings (most-executed)", () => store.queryWorkflowRankings(all, rankMetrics[0], 10), QUERY_REPS),
    timeQuery("workflow rankings (queue-delay)", () => store.queryWorkflowRankings(all, rankMetrics[1], 10), QUERY_REPS),
    timeQuery("run-vs-history", () => store.queryRunVsHistory(sampleInstanceId), QUERY_REPS),
    timeQuery("capacity analytics", () => store.queryCapacityAnalytics(all), QUERY_REPS),
    timeQuery("admission-reason breakdown", () => store.listAdmissionBuckets(), QUERY_REPS),
    timeQuery("lifecycle breakdown", () => store.listBrowserLifecycleBuckets(), QUERY_REPS),
    timeQuery("anomalies list", () => store.queryAnomalies(all, undefined, 100), QUERY_REPS),
    timeQuery("workflow comparison", () => store.queryWorkflowComparison(all), QUERY_REPS),
    timeQuery("failure breakdown", () => store.queryFailures(all), QUERY_REPS)
  ];

  await store.close();
  return { size: n, file, perUnit, queries, sampleInstanceId, dbPath };
}

/** Inspect index coverage + query plans on the largest persisted DB (raw sql.js). */
async function inspectPlans(dbPath: string): Promise<{ indexes: { name: string; table: string }[]; plans: { query: string; plan: string; usesIndex: boolean }[] }> {
  const SQL = await loadSqlJs();
  const { readFile } = await import("node:fs/promises");
  const db = new SQL.Database(await readFile(dbPath));
  const idxRes = db.exec("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name");
  const indexes = (idxRes[0]?.values ?? []).map((r) => ({ name: String(r[0]), table: String(r[1]) }));
  const q30 = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const queries = [
    `SELECT * FROM runtime_runs ORDER BY COALESCE(startedAt, updatedAt) DESC LIMIT 50 OFFSET 0`,
    `SELECT * FROM runtime_runs WHERE scenarioId = 'wf-3' AND COALESCE(startedAt, updatedAt) >= '${q30}' ORDER BY COALESCE(startedAt, updatedAt) DESC LIMIT 10000`,
    `SELECT * FROM runtime_capacity_buckets WHERE bucketStart >= '${q30}' ORDER BY bucketStart ASC LIMIT 5000`,
    `SELECT * FROM runtime_admission_buckets WHERE bucketStart >= '${q30}' ORDER BY bucketStart ASC LIMIT 20000`,
    `SELECT * FROM runtime_browser_lifecycle_buckets WHERE bucketStart >= '${q30}' ORDER BY bucketStart ASC LIMIT 20000`,
    `SELECT * FROM runtime_anomalies ORDER BY detectedAt DESC LIMIT 100`
  ];
  const plans = queries.map((q) => {
    const res = db.exec(`EXPLAIN QUERY PLAN ${q}`);
    const plan = (res[0]?.values ?? []).map((r) => String(r[r.length - 1])).join(" | ");
    return { query: q.slice(0, 80), plan, usesIndex: /USING INDEX|USING COVERING INDEX/i.test(plan) };
  });
  db.close();
  return { indexes, plans };
}

/** Retention cutoff-boundary + interrupted-run-safety validation on an isolated small store. */
async function validateRetention(root: string): Promise<Record<string, boolean>> {
  const dbPath = join(root, "retention", RUNTIME_DB_FILENAME);
  await mkdir(join(root, "retention"), { recursive: true });
  const store = await SqliteRuntimeStore.open(dbPath, () => undefined);
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  // Buckets straddling the 14-day cutoff (retention keeps >= now-14d).
  const bucketCutoff = now - 14 * DAY_MS;
  store.recordCapacityBucket(buildCapacityBucket(mulberry32(1), bucketCutoff + 60_000)); // inside (recent)
  store.recordCapacityBucket(buildCapacityBucket(mulberry32(2), bucketCutoff - 60_000)); // outside (old)
  // Admission/lifecycle straddling.
  store.recordAdmissionBucket({ bucketStart: iso(bucketCutoff + 60_000), reason: "cpu-pressure", count: 1 });
  store.recordAdmissionBucket({ bucketStart: iso(bucketCutoff - 60_000), reason: "cpu-pressure", count: 1 });
  // Anomalies straddling the 90-day cutoff.
  const anomCutoff = now - 90 * DAY_MS;
  store.recordAnomaly({ detectedAt: iso(anomCutoff + 60_000), scope: "run", signalType: "duration-p95", severity: "info", state: "active" });
  store.recordAnomaly({ detectedAt: iso(anomCutoff - 60_000), scope: "run", signalType: "duration-p95", severity: "info", state: "active" });
  // Process samples straddling the 24-hour raw cutoff.
  const rawCutoff = now - 24 * 3_600_000;
  store.recordProcessSample({ timestamp: iso(rawCutoff + 60_000), chromiumProcessCount: 2, chromiumMemoryMb: 500, electronMainMemoryMb: 150, browserContextCount: 2, pageCount: 2, activeBrowsers: 2, idleBrowsers: 0, crashesWindow: 0, availability: "full" });
  store.recordProcessSample({ timestamp: iso(rawCutoff - 60_000), chromiumProcessCount: 2, chromiumMemoryMb: 500, electronMainMemoryMb: 150, browserContextCount: 2, pageCount: 2, activeBrowsers: 2, idleBrowsers: 0, crashesWindow: 0, availability: "full" });
  // An interrupted/recoverable run older than the run-count window must survive retention.
  store.upsertRun({ instanceId: "recoverable-old", executionId: "e", scenarioId: "wf-0", status: "running", flowRunStatus: "running", recoverable: true, recoveryNote: "interrupted", startedAt: iso(now - 40 * DAY_MS), updatedAt: iso(now - 40 * DAY_MS) });
  await store.persistNow();

  store.sweepRetention({ retentionHours: 24, retentionRuns: 5000, observabilityBucketDays: 14, anomalyDays: 90 });
  await store.persistNow();

  const caps = store.listCapacityBuckets();
  const adms = store.listAdmissionBuckets();
  const anoms = store.listAnomalies(undefined, undefined, 100);
  const samples = store.listProcessSamples();
  const result = {
    capacityKeepsRecentDropsOld: caps.length === 1 && Date.parse(caps[0].bucketStart) > bucketCutoff,
    admissionKeepsRecentDropsOld: adms.length === 1 && Date.parse(adms[0].bucketStart) > bucketCutoff,
    anomalyKeepsRecentDropsOld: anoms.length === 1 && Date.parse(anoms[0].detectedAt) > anomCutoff,
    rawSampleKeepsRecentDropsOld: samples.length === 1 && Date.parse(samples[0].timestamp) > rawCutoff,
    interruptedRunSurvives: store.getRun("recoverable-old") !== undefined
  };
  await store.close();
  return result;
}

async function main(): Promise<void> {
  console.log(`Observability storage/query benchmark: sizes=[${SIZES.join(", ")}], capBuckets=${CAP_BUCKETS}, anomalies=${ANOMALIES}, queryReps=${QUERY_REPS}`);
  const root = await mkdtemp(join(tmpdir(), "awkit-storage-"));
  const results = [];
  let lastDbPath = "";
  for (const n of SIZES) {
    console.log(`\n── Building + benchmarking ${n.toLocaleString()} runs ──`);
    const t0 = performance.now();
    const r = await benchmarkSize(n, root);
    lastDbPath = r.dbPath;
    results.push(r);
    console.log(`  built in ${((performance.now() - t0) / 1000).toFixed(1)}s · total=${(r.perUnit.totalBytes / (1024 * 1024)).toFixed(2)}MB · bytes/run=${r.perUnit.bytesPerRun} · bytes/capBucket=${r.perUnit.bytesPerCapacityBucket} · bytes/anomaly=${r.perUnit.bytesPerAnomaly}`);
    for (const q of r.queries) console.log(`    ${q.label.padEnd(34)} cold=${q.coldMs}ms P50=${q.warmP50Ms}ms P95=${q.warmP95Ms}ms max=${q.maxMs}ms rows=${q.rows}`);
  }

  const plans = await inspectPlans(lastDbPath);
  const retention = await validateRetention(root);

  // Growth projections from the largest dataset's per-unit costs + throughput assumption.
  const largest = results[results.length - 1];
  const bpr = largest.perUnit.bytesPerRun;
  const bpc = largest.perUnit.bytesPerCapacityBucket;
  const capBucketsPerDay = 2 * 60 * 24; // 30 s cadence
  const projectDay = (days: number) => {
    const runBytes = RUNS_PER_DAY * days * bpr;
    const capBytes = Math.min(CAP_BUCKETS, capBucketsPerDay * Math.min(days, 14)) * bpc; // buckets retained 14 d
    return Math.round((runBytes + capBytes) / 1024); // KB
  };
  const projections = {
    assumptionRunsPerDay: RUNS_PER_DAY,
    assumptionBucketCadenceSec: 30,
    day1Kb: projectDay(1), day7Kb: projectDay(7), day30Kb: projectDay(30), day90Kb: projectDay(90),
    note: "runs grow unbounded with retentionRuns cap (default 5000); capacity buckets bounded to 14 d retention"
  };

  const out = {
    sizes: SIZES, capBuckets: CAP_BUCKETS, admBuckets: ADM_BUCKETS, lifeBuckets: LIFE_BUCKETS, anomalies: ANOMALIES, queryReps: QUERY_REPS,
    results: results.map((r) => ({ size: r.size, fileBytes: r.file, perUnit: r.perUnit, queries: r.queries })),
    indexes: plans.indexes, queryPlans: plans.plans, retention, projections
  };
  const artifactDir = join(process.cwd(), "reports", "browser-performance");
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "observability-storage.json");
  await writeFile(artifactPath, JSON.stringify(out, null, 2), "utf8");

  // ── Console summary tables ──────────────────────────────────────────────────
  console.log(`\n=== Storage growth (measured) ===`);
  console.log(`${"Runs".padStart(8)} ${"Total MB".padStart(10)} ${"Runs MB".padStart(9)} ${"Cap MB".padStart(8)} ${"bytes/run".padStart(10)}`);
  for (const r of results) {
    console.log(`${r.size.toLocaleString().padStart(8)} ${(r.perUnit.totalBytes / (1024 * 1024)).toFixed(2).padStart(10)} ${(r.file.runs / (1024 * 1024)).toFixed(2).padStart(9)} ${(r.file.capacity / (1024 * 1024)).toFixed(2).padStart(8)} ${String(r.perUnit.bytesPerRun).padStart(10)}`);
  }
  console.log(`\n=== Query P50/P95 by dataset size (ms) ===`);
  const keyQueries = ["overview", "workflow summary", "workflow 30-day trend", "capacity analytics", "anomalies list"];
  const header = ["Query", ...SIZES.map((s) => `${(s / 1000)}k P50/P95`)].map((h) => h.padStart(16)).join(" ");
  console.log(header);
  for (const label of keyQueries) {
    const cells = results.map((r) => { const q = r.queries.find((x) => x.label === label)!; return `${q.warmP50Ms}/${q.warmP95Ms}`.padStart(16); });
    console.log(`${label.padStart(16)} ${cells.join(" ")}`);
  }
  console.log(`\n=== Index coverage / query plans (largest DB) ===`);
  console.log(`indexes: ${plans.indexes.map((i) => i.name).join(", ")}`);
  for (const p of plans.plans) console.log(`  ${p.usesIndex ? "IDX " : "SCAN"} ${p.query} → ${p.plan}`);
  console.log(`\n=== Retention boundary validation ===`);
  for (const [k, v] of Object.entries(retention)) console.log(`  ${v ? "✓" : "✗"} ${k}`);
  console.log(`\n=== Projections (assume ${RUNS_PER_DAY} runs/day, 30 s buckets) ===`);
  console.log(`  1d=${projections.day1Kb}KB  7d=${projections.day7Kb}KB  30d=${projections.day30Kb}KB  90d=${projections.day90Kb}KB`);
  console.log(`\nArtifact: ${artifactPath}`);

  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  const retentionOk = Object.values(retention).every(Boolean);
  process.exit(retentionOk ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
