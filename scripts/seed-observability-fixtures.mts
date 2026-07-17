/**
 * Phase 5 — seed persistent Runtime-Analytics fixture databases for the packaged/dev Electron walkthrough.
 *
 * Writes real `SqliteRuntimeStore` databases into per-state roots laid out exactly like the app expects, so
 * launching Electron with `LOCALAPPDATA` pointed at a state root makes the app read that fixture:
 *
 *   <root>/<state>/SpecterStudio/runtime/runtime.sqlite   ← engine opens join(LOCALAPPDATA, "SpecterStudio", "runtime", "runtime.sqlite")
 *
 * States produced (default all): normal, empty, migration, high-data. Deterministic (seeded PRNG).
 *
 *   npx tsx scripts/seed-observability-fixtures.mts [--root <dir>] [--states normal,high-data] [--high-runs 25000]
 *
 * No Chromium, no network. Prints each state root so the walkthrough can set LOCALAPPDATA to it.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import { loadSqlJs } from "@src/runner/store/SqlJsLoader";
import {
  RUNTIME_DB_FILENAME,
  RUNTIME_STORE_MIGRATIONS,
  type DurableAnomalyRecord,
  type DurableCapacityBucketRecord,
  type DurableRunRecord
} from "@src/runner/store/RuntimeStoreSchema";

const RUNTIME_DATA_FOLDER = "SpecterStudio";
const DAY_MS = 86_400_000;
const WORKFLOWS = 10;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

// Deterministic PRNG (mulberry32) so fixtures are reproducible.
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

const STATUSES = ["completed", "completed", "completed", "completed", "completed", "completed", "failed", "cancelled"];
const PROFILES = ["balanced", "balanced", "low-resource", "maximum-compatibility"];
const ISOLATIONS = ["SHARED_CONTEXT", "SHARED_CONTEXT", "SHARED_CONTEXT", "DEDICATED_BROWSER", "PERSISTENT_BROWSER", "HANDOFF_BROWSER"];
const PRESSURES = ["healthy", "healthy", "stable", "stable", "pressure", "critical"];
const REASONS = ["active-flow-limit", "weighted-budget", "cpu-pressure", "browser-pool-saturated", "system-memory-pressure", "origin-account-limit"];
const CLOSE_REASONS = ["CONTEXT_COUNT_RECYCLE", "IDLE_DRAIN", "UNHEALTHY", "CRASH", "POOL_SHUTDOWN"];
const MACHINES = ["mach-A", "mach-B"];

function buildRun(rng: () => number, i: number, nowMs: number): Partial<DurableRunRecord> & { instanceId: string; executionId: string } {
  const wf = i % WORKFLOWS;
  const startedMs = nowMs - Math.floor(rng() * 90 * DAY_MS);
  const duration = 500 + Math.floor(rng() * 4500) + wf * 40;
  const status = pick(rng, STATUSES);
  const queueWait = rng() < 0.35 ? Math.floor(rng() * 3000) : Math.floor(rng() * 200);
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

/** Seed a real v4 store with realistic runs + 14 d of buckets + sparse anomalies. */
async function seedPopulated(dbPath: string, runs: number, seed: number): Promise<void> {
  const store = await SqliteRuntimeStore.open(dbPath, () => undefined);
  const rng = mulberry32(seed);
  const nowMs = Date.now();
  // UI fixture only needs enough recent buckets to populate the capacity panel across the default 24 h range
  // (3000 × 30 s ≈ 25 h). Full 14-day bucket depth is measured by the storage benchmark, not needed here — and
  // seeding 40 k buckets costs ~19 min, so cap it to keep fixture generation to a few seconds.
  const capBuckets = Math.min(3_000, Math.max(200, runs * 4));
  const admBuckets = Math.min(3_000, Math.max(50, Math.floor(runs / 8)));
  const lifeBuckets = Math.min(2_000, Math.max(40, Math.floor(runs / 12)));
  const anomalies = Math.min(900, Math.max(6, Math.floor(runs / 30)));

  for (let i = 0; i < runs; i++) store.upsertRun(buildRun(rng, i, nowMs));
  for (let i = 0; i < capBuckets; i++) store.recordCapacityBucket(buildCapacityBucket(rng, nowMs - i * 30_000));
  for (let i = 0; i < admBuckets; i++) {
    store.recordAdmissionBucket({ bucketStart: new Date(nowMs - i * 30_000).toISOString(), reason: pick(rng, REASONS), pressureState: pick(rng, PRESSURES), count: 1 + Math.floor(rng() * 8) });
  }
  for (let i = 0; i < lifeBuckets; i++) {
    store.recordBrowserLifecycleBucket({ bucketStart: new Date(nowMs - i * 60_000).toISOString(), reason: pick(rng, CLOSE_REASONS), count: 1 + Math.floor(rng() * 4) });
  }
  for (let i = 0; i < anomalies; i++) {
    const rec: DurableAnomalyRecord = {
      workflowId: `wf-${i % WORKFLOWS}`,
      runId: `run-${Math.floor(rng() * runs)}`,
      detectedAt: new Date(nowMs - Math.floor(rng() * 90 * DAY_MS)).toISOString(),
      scope: rng() < 0.7 ? "run" : "regression",
      signalType: pick(rng, ["duration-median", "queue-wait-p95", "failure-rare", "duration-p95", "failure-rate", "queue-delays"]),
      severity: pick(rng, ["info", "warning", "critical"]),
      currentValue: Number((rng() * 5000).toFixed(1)),
      baselineValue: Number((rng() * 3000).toFixed(1)),
      thresholdRule: "seed-fixture",
      windowLabel: "30d",
      state: rng() < 0.85 ? "active" : "recovered",
      note: "synthetic anomaly for Phase 5 UI fixture"
    };
    store.recordAnomaly(rec);
  }
  await store.persistNow();
  await store.close();
}

/** Write a pre-v4 (v1..v3) database with legacy runs so the app applies migration v4 in place on open. */
async function seedMigration(dbPath: string): Promise<void> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  for (const migration of RUNTIME_STORE_MIGRATIONS.filter((m) => m.version <= 3)) {
    for (const statement of migration.statements) db.run(statement);
    db.run("INSERT INTO runtime_migrations (version, name, appliedAt) VALUES (?, ?, ?)", [migration.version, migration.name, new Date().toISOString()]);
  }
  const nowMs = Date.now();
  for (let i = 0; i < 40; i++) {
    const wf = i % 5;
    const startedMs = nowMs - i * 3_600_000;
    const status = i % 7 === 0 ? "failed" : "completed";
    db.run(
      `INSERT INTO runtime_runs (instanceId, executionId, scenarioId, scenarioName, status, flowRunStatus, startedAt, endedAt, updatedAt, durationMs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`v3-run-${i}`, `v3-e-${i}`, `wf-${wf}`, `Legacy Workflow ${wf}`, status, status, new Date(startedMs).toISOString(), new Date(startedMs + 60_000).toISOString(), new Date(startedMs + 60_000).toISOString(), 60_000]
    );
  }
  await writeFile(dbPath, Buffer.from(db.export()));
  db.close();
}

async function stateDir(root: string, state: string): Promise<string> {
  const dbDir = join(root, state, RUNTIME_DATA_FOLDER, "runtime");
  await mkdir(dbDir, { recursive: true });
  return join(dbDir, RUNTIME_DB_FILENAME);
}

/** Seed ui-settings.json so the app restores directly onto the Runtime Analytics route for the walkthrough. */
async function writeSettings(root: string, state: string): Promise<void> {
  const storageDir = join(root, state, RUNTIME_DATA_FOLDER, "storage");
  await mkdir(storageDir, { recursive: true });
  await writeFile(join(storageDir, "ui-settings.json"), JSON.stringify({ lastRouteId: "reportsRuntime" }, null, 2), "utf8");
}

async function main(): Promise<void> {
  const root = arg("root", join(process.cwd(), ".fixtures-observability"))!;
  const states = (arg("states", "normal,empty,migration,high-data") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const highRuns = Number.parseInt(arg("high-runs", "25000")!, 10);
  const fresh = process.argv.includes("--fresh");

  if (fresh) await rm(root, { recursive: true, force: true });
  console.log(`Seeding observability fixtures → ${root}`);
  console.log(`States: ${states.join(", ")}\n`);

  for (const state of states) {
    const t0 = Date.now();
    await writeSettings(root, state); // open directly on Runtime Analytics
    if (state === "empty") {
      // Just the directory tree — the app initializes a fresh v4 DB on first launch.
      await mkdir(join(root, state, RUNTIME_DATA_FOLDER, "runtime"), { recursive: true });
      console.log(`  empty       → ${join(root, state)}  (no DB; app inits fresh)`);
      continue;
    }
    const dbPath = await stateDir(root, state);
    if (state === "migration") {
      await seedMigration(dbPath);
      console.log(`  migration   → ${join(root, state)}  (v3 DB, 40 legacy runs; v4 applied on open)  ${Date.now() - t0}ms`);
    } else if (state === "high-data") {
      await seedPopulated(dbPath, highRuns, 0x1234abcd);
      console.log(`  high-data   → ${join(root, state)}  (${highRuns} runs)  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else if (state === "normal") {
      await seedPopulated(dbPath, 400, 0x9e3779b9);
      console.log(`  normal      → ${join(root, state)}  (400 runs)  ${Date.now() - t0}ms`);
    } else {
      throw new Error(`unknown state: ${state}`);
    }
  }

  console.log(`\nLaunch the app against a state with:  set LOCALAPPDATA=${join(root, "<state>")} && npx electron .`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
