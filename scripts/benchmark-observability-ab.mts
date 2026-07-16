/**
 * Phase 1 — Controlled Observability OFF-vs-ON A/B overhead benchmark (Runtime Observability final
 * validation). Runs the EXACT SAME Config-D MIXED workload twice — Configuration A (observability collection
 * OFF, `AWKIT_RUNTIME_OBSERVABILITY=0`) and Configuration B (full observability ON) — through the REAL
 * ExecutionEngine, alternating run order (A B B A A B by default) to reduce warm-up / machine-state bias.
 *
 * Config A keeps every load-bearing runtime system on (shared pool, A8 weighted admission, adaptive,
 * backpressure, ResourceSampler, process-tree history). It disables ONLY the incremental observability work:
 * per-run environmental summaries, capacity/admission/lifecycle buckets, and anomaly/regression detection.
 * Config B is identical with that work enabled. This isolates the observability overhead precisely.
 *
 * Also serves as the flag-resolution + collector-disabled verifier: it asserts `isObservabilityEnabled()`
 * matches the env for each config, and that Config A persists ZERO observability rows (capacity/admission/
 * lifecycle buckets, anomalies, per-run obs summaries) while Config B persists a positive count.
 *
 *   npm run benchmark:observability-ab
 *   AWKIT_AB_HOLD_MS=120000 AWKIT_AB_CONC=6 AWKIT_AB_ORDER=ABBAAB npm run benchmark:observability-ab
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import { RUNTIME_DB_FILENAME } from "@src/runner/store/RuntimeStoreSchema";
import { chromiumPids, sampleChromium, stats, startWorkloadServer, type Stats } from "./benchmark/lib.mts";
import { buildDirs, cleanupRoot, installBenchGuards, readAllRunHistory } from "./benchmark/engineHarness.mts";
import { buildFlow, buildScenario, buildProfile, WORKLOAD_CLASSES, DEFAULT_MIX } from "./benchmark/workloads.mts";

installBenchGuards();

const HOLD_MS = Number.parseInt(process.env.AWKIT_AB_HOLD_MS ?? "120000", 10); // 2 min sustained per run
const CONC = Number.parseInt(process.env.AWKIT_AB_CONC ?? "6", 10); // Config-D proven operating point
const SAMPLE_MS = Number.parseInt(process.env.AWKIT_AB_SAMPLE_MS ?? "1000", 10);
const WARMUP_MS = Number.parseInt(process.env.AWKIT_AB_WARMUP_MS ?? "15000", 10);
const ORDER = (process.env.AWKIT_AB_ORDER ?? "ABBAAB").toUpperCase().split("") as ("A" | "B")[];
const PORT = 4460;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RepResult {
  config: "A" | "B";
  observabilityEnabled: boolean;
  // workflow
  completed: number;
  failed: number;
  retries: number;
  crashes: number;
  throughputPerMin: number;
  durationP50Ms?: number;
  durationP95Ms?: number;
  queueWaitP50Ms?: number;
  queueWaitP95Ms?: number;
  // runtime health (from sampled series)
  cpu?: Stats;
  systemMemory?: Stats;
  chromiumRssMb?: Stats;
  awkitRssMb?: Stats;
  nodeHeapMb?: Stats;
  eventLoopDelayMs?: Stats;
  // observability persistence
  capacityBuckets: number;
  admissionBuckets: number;
  lifecycleBuckets: number;
  anomalies: number;
  runObsSummaries: number;
  observabilityRowsWritten: number; // write proxy: incremental rows observability added
  sqliteBytes: number;
  sqliteBytesPerRun: number;
  // teardown
  teardownClean: boolean;
}

async function runRep(config: "A" | "B", wl: Awaited<ReturnType<typeof startWorkloadServer>>): Promise<RepResult> {
  const enabled = config === "B";
  // The flag is read at ExecutionEngine construction from env — set it BEFORE constructing the engine.
  process.env.AWKIT_RUNTIME_OBSERVABILITY = enabled ? "1" : "0";
  const { dirs, root } = await buildDirs(`awkit-ab-${config}-`);
  const engine = new ExecutionEngine();
  // Config D: shared pool ON + A8 weighted admission ON (adaptive + backpressure always on).
  engine.configureConcurrency({ maxBrowsersPerHost: Math.max(2, Math.min(4, Math.ceil(CONC / 2))), maxActiveFlows: CONC, useSharedBrowserPool: true, workloadWeights: true });

  if (engine.isObservabilityEnabled() !== enabled) {
    throw new Error(`flag resolution mismatch: config ${config} expected observability=${enabled}, engine reports ${engine.isObservabilityEnabled()}`);
  }

  const baselinePids = await chromiumPids();
  const perClassInstances = (share: number) => Math.min(4000, Math.max(200, Math.max(1, Math.round(CONC * share)) * Math.ceil(HOLD_MS / 1200)));
  for (const cls of WORKLOAD_CLASSES) {
    const share = DEFAULT_MIX[cls] ?? 0;
    if (share <= 0) continue;
    const executionId = `ab-${config}-${cls}-${Date.now()}`;
    const flows = [buildFlow(cls, wl.base)];
    const scenario = buildScenario(cls, flows[0].id);
    const active = Math.max(1, Math.round(CONC * share));
    const profile = buildProfile(cls, wl.base, { executionId, headless: true, maxConcurrentInstances: active });
    await engine.startRun(executionId, profile, Array.from({ length: perClassInstances(share) }), dirs, {}, scenario, flows);
  }

  const countCompleted = () => engine.getInstances().filter((i) => i.status === "completed").length;
  const eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();

  await sleep(Math.min(WARMUP_MS, HOLD_MS / 8)); // warm-up before the measured window
  const completedAtWarmup = countCompleted();
  eld.reset();

  const cpu: number[] = [], sysMem: number[] = [], chromRss: number[] = [], awkitRss: number[] = [], heap: number[] = [], elDelay: number[] = [];
  const startedAt = performance.now();
  const endAt = startedAt + HOLD_MS;
  while (performance.now() < endAt) {
    await sleep(SAMPLE_MS);
    const cap = engine.getCapacitySnapshot();
    const chrom = await sampleChromium(baselinePids);
    const mem = process.memoryUsage();
    if (typeof cap.cpuPercent === "number") cpu.push(cap.cpuPercent);
    if (typeof cap.systemMemoryPercent === "number") sysMem.push(cap.systemMemoryPercent);
    chromRss.push(chrom.rssMb);
    awkitRss.push(Math.round(mem.rss / (1024 * 1024)));
    heap.push(Math.round(mem.heapUsed / (1024 * 1024)));
    elDelay.push(Math.round((eld.mean / 1e6) * 10) / 10);
    eld.reset();
  }
  const measuredMin = (performance.now() - startedAt) / 60000;
  const completedInWindow = countCompleted() - completedAtWarmup;
  eld.disable();

  // ── Teardown ───────────────────────────────────────────────────────────────
  engine.stopAll();
  const drainDeadline = Date.now() + 90_000;
  while (Date.now() < drainDeadline) {
    const active = engine.getInstances().filter((i) => ["starting", "running", "pending", "queued"].includes(i.status)).length;
    const ctx = engine.getSharedBrowserSnapshot().activeContexts;
    if (active === 0 && ctx === 0) break;
    engine.stopAll();
    await sleep(500);
  }
  await engine.drainIdleSharedBrowsers().catch(() => undefined);
  let orphan = 0;
  const orphanDeadline = Date.now() + 30_000;
  while (Date.now() < orphanDeadline) {
    orphan = (await sampleChromium(baselinePids)).count;
    if (orphan === 0) break;
    await engine.drainIdleSharedBrowsers().catch(() => undefined);
    await sleep(1000);
  }
  const activeAtEnd = engine.getInstances().filter((i) => ["starting", "running", "pending", "queued"].includes(i.status)).length;
  const contextsAtEnd = engine.getSharedBrowserSnapshot().activeContexts;

  // Durable per-run truth (all rows via pagination).
  const allRows = readAllRunHistory(engine, {});
  const completedRows = allRows.filter((r) => r.status === "completed");
  const failedRows = allRows.filter((r) => r.status === "failed");
  const durs = completedRows.map((r) => (r as { durationMs?: number }).durationMs ?? 0).filter((n) => n > 0);
  const qwaits = allRows.map((r) => (r as { queueWaitMs?: number }).queueWaitMs ?? -1).filter((n) => n >= 0);
  const durStats = stats(durs);
  const qStats = stats(qwaits);
  const retries = failedRows.reduce((s, r) => s + (engine.getTelemetryRunDetail(r.instanceId).run?.retryCount ?? 0), 0);
  const crashes = failedRows.filter((r) => /crash/i.test(String((r as { errorClass?: string }).errorClass ?? ""))).length;

  // ── Read the persisted observability rows directly from the on-disk SQLite file ──
  await engine.persistDurableNow();
  const sqlitePath = join(root, "runtime", RUNTIME_DB_FILENAME);
  const store = await SqliteRuntimeStore.open(sqlitePath, () => undefined);
  const capacityBuckets = store.listCapacityBuckets().length;
  const admissionBuckets = store.listAdmissionBuckets().length;
  const lifecycleBuckets = store.listBrowserLifecycleBuckets().length;
  const anomalies = store.listAnomalies(undefined, undefined, 100000).length;
  const runObsSummaries = store.listRuns(100000).filter((r) => typeof r.obsSampleCount === "number").length;
  const sqliteBytes = (await stat(sqlitePath)).size;
  const totalRuns = completedRows.length + failedRows.length;

  await cleanupRoot(root);

  return {
    config,
    observabilityEnabled: enabled,
    completed: completedInWindow,
    failed: failedRows.length,
    retries,
    crashes,
    throughputPerMin: measuredMin > 0 ? Number((completedInWindow / measuredMin).toFixed(1)) : 0,
    durationP50Ms: durStats?.median,
    durationP95Ms: durStats?.p95,
    queueWaitP50Ms: qStats?.median,
    queueWaitP95Ms: qStats?.p95,
    cpu: stats(cpu),
    systemMemory: stats(sysMem),
    chromiumRssMb: stats(chromRss),
    awkitRssMb: stats(awkitRss),
    nodeHeapMb: stats(heap),
    eventLoopDelayMs: stats(elDelay),
    capacityBuckets,
    admissionBuckets,
    lifecycleBuckets,
    anomalies,
    runObsSummaries,
    observabilityRowsWritten: capacityBuckets + admissionBuckets + lifecycleBuckets + anomalies + runObsSummaries,
    sqliteBytes,
    sqliteBytesPerRun: totalRuns > 0 ? Math.round(sqliteBytes / totalRuns) : 0,
    teardownClean: activeAtEnd === 0 && contextsAtEnd === 0 && orphan === 0
  };
}

function median(xs: number[]): number | undefined {
  const v = xs.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
function mean(xs: number[]): number | undefined {
  const v = xs.filter((n) => Number.isFinite(n));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
}

async function main() {
  console.log(`Observability A/B: Config D, MIXED, concurrency=${CONC}, hold=${(HOLD_MS / 60000).toFixed(1)}min/run, order=${ORDER.join("")}`);
  const wl = await startWorkloadServer(PORT);
  const reps: RepResult[] = [];
  for (let i = 0; i < ORDER.length; i++) {
    const cfg = ORDER[i];
    console.log(`\n── Run ${i + 1}/${ORDER.length}: Config ${cfg} (observability ${cfg === "B" ? "ON" : "OFF"}) ──`);
    const r = await runRep(cfg, wl);
    reps.push(r);
    console.log(
      `  throughput=${r.throughputPerMin}/min durP95=${r.durationP95Ms}ms qWaitP95=${r.queueWaitP95Ms}ms ` +
      `cpuP95=${r.cpu?.p95} awkitRssP95=${r.awkitRssMb?.p95}MB heapP95=${r.nodeHeapMb?.p95}MB eldP95=${r.eventLoopDelayMs?.p95}ms ` +
      `sqlite=${(r.sqliteBytes / 1024).toFixed(0)}KB obsRows=${r.observabilityRowsWritten} (cap=${r.capacityBuckets} adm=${r.admissionBuckets} life=${r.lifecycleBuckets} anom=${r.anomalies} sum=${r.runObsSummaries}) teardown=${r.teardownClean ? "clean" : "LEAK"}`
    );
  }
  wl.server.close();

  const aRuns = reps.filter((r) => r.config === "A");
  const bRuns = reps.filter((r) => r.config === "B");

  // ── Collector-disabled assertions ──────────────────────────────────────────
  const offObsRows = aRuns.reduce((s, r) => s + r.observabilityRowsWritten, 0);
  const onCapacity = bRuns.reduce((s, r) => s + r.capacityBuckets, 0);
  const assertions = {
    offWritesZeroObservabilityRows: offObsRows === 0,
    onWritesCapacityBuckets: onCapacity > 0,
    allTeardownsClean: reps.every((r) => r.teardownClean),
    flagResolvedCorrectly: aRuns.every((r) => !r.observabilityEnabled) && bRuns.every((r) => r.observabilityEnabled)
  };

  const pick = (rs: RepResult[], f: (r: RepResult) => number | undefined) => rs.map(f).filter((n): n is number => typeof n === "number");
  const cmp = (label: string, f: (r: RepResult) => number | undefined, lowerIsBetter: boolean) => {
    const a = median(pick(aRuns, f)); // OFF
    const b = median(pick(bRuns, f)); // ON
    const delta = a !== undefined && b !== undefined ? b - a : undefined;
    const deltaPct = a !== undefined && b !== undefined && a !== 0 ? Number(((delta! / a) * 100).toFixed(2)) : undefined;
    return { label, off: a, on: b, delta: delta === undefined ? undefined : Number(delta.toFixed(2)), deltaPct, lowerIsBetter };
  };

  const table = [
    cmp("Throughput/min", (r) => r.throughputPerMin, false),
    cmp("Duration P95 (ms)", (r) => r.durationP95Ms, true),
    cmp("Queue wait P95 (ms)", (r) => r.queueWaitP95Ms, true),
    cmp("CPU P95 (%)", (r) => r.cpu?.p95, true),
    cmp("AWKIT RSS P95 (MB)", (r) => r.awkitRssMb?.p95, true),
    cmp("Node heap P95 (MB)", (r) => r.nodeHeapMb?.p95, true),
    cmp("Event-loop delay P95 (ms)", (r) => r.eventLoopDelayMs?.p95, true),
    cmp("Chromium RSS P95 (MB)", (r) => r.chromiumRssMb?.p95, true),
    cmp("SQLite size (KB)", (r) => Number((r.sqliteBytes / 1024).toFixed(1)), true),
    cmp("SQLite bytes/run", (r) => r.sqliteBytesPerRun, true),
    cmp("Observability rows written", (r) => r.observabilityRowsWritten, true)
  ];

  // Acceptance targets (current, not automatic pass): throughput degradation < 2%, AWKIT RSS increase < 20MB.
  const thr = table.find((t) => t.label === "Throughput/min")!;
  const rss = table.find((t) => t.label === "AWKIT RSS P95 (MB)")!;
  const throughputDegradationPct = thr.off && thr.on ? Number((((thr.off - thr.on) / thr.off) * 100).toFixed(2)) : undefined;
  const acceptance = {
    throughputDegradationPct,
    throughputTargetMet: throughputDegradationPct === undefined ? undefined : throughputDegradationPct < 2,
    awkitRssIncreaseMb: rss.delta,
    awkitRssTargetMet: rss.delta === undefined ? undefined : rss.delta < 20
  };

  const result = {
    config: "D", workload: "MIXED", concurrency: CONC, holdMsPerRun: HOLD_MS, order: ORDER.join(""),
    repetitions: { A: aRuns.length, B: bRuns.length },
    machine: { cpus: os.cpus().length, totalMemMb: Math.round(os.totalmem() / (1024 * 1024)) },
    assertions, acceptance, comparison: table,
    aggregates: {
      A: { throughput: { median: median(pick(aRuns, (r) => r.throughputPerMin)), mean: mean(pick(aRuns, (r) => r.throughputPerMin)) } },
      B: { throughput: { median: median(pick(bRuns, (r) => r.throughputPerMin)), mean: mean(pick(bRuns, (r) => r.throughputPerMin)) } }
    },
    reps
  };

  const artifactDir = join(process.cwd(), "reports", "browser-performance");
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "observability-ab.json");
  await writeFile(artifactPath, JSON.stringify(result, null, 2), "utf8");

  console.log(`\n=== Observability A/B result (Config D, MIXED, conc ${CONC}, ${aRuns.length}×A / ${bRuns.length}×B) ===`);
  console.log(`${"Metric".padEnd(28)} ${"OFF".padStart(12)} ${"ON".padStart(12)} ${"Delta".padStart(12)} ${"Delta %".padStart(10)}`);
  for (const t of table) {
    const d = t.deltaPct === undefined ? "—" : `${t.deltaPct > 0 ? "+" : ""}${t.deltaPct}%`;
    console.log(`${t.label.padEnd(28)} ${String(t.off ?? "—").padStart(12)} ${String(t.on ?? "—").padStart(12)} ${String(t.delta ?? "—").padStart(12)} ${d.padStart(10)}`);
  }
  console.log(`\nAcceptance: throughput degradation ${acceptance.throughputDegradationPct}% (<2% ${acceptance.throughputTargetMet ? "✓" : "✗"}); AWKIT RSS increase ${acceptance.awkitRssIncreaseMb}MB (<20MB ${acceptance.awkitRssTargetMet ? "✓" : "✗"})`);
  console.log(`Assertions: OFF wrote 0 observability rows=${assertions.offWritesZeroObservabilityRows ? "✓" : "✗"}; ON wrote capacity buckets=${assertions.onWritesCapacityBuckets ? "✓" : "✗"}; flag resolved=${assertions.flagResolvedCorrectly ? "✓" : "✗"}; teardown clean=${assertions.allTeardownsClean ? "✓" : "✗"}`);
  console.log(`\nArtifact: ${artifactPath}`);

  const ok = Object.values(assertions).every(Boolean);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
