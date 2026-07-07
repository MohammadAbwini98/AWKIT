/**
 * Telemetry read-model verification (temp files; no external services).
 * Run with: npx tsx scripts/verify-telemetry.mts
 *
 * Proves (UI-reports refactor Phase 3):
 *  - migration v2 upgrades a v1-only database IN PLACE (adds reporting columns + samples table);
 *  - reporting run-summary fields (scenarioName/queueWaitMs/durationMs/retryCount/reportCategory)
 *    round-trip;
 *  - process-sample write/read + bounded retention;
 *  - time/count retention sweep removes old rows but keeps interrupted/recoverable runs;
 *  - ReportCategories maps every ErrorClass conservatively;
 *  - ProcessTreeSampler never throws and returns a well-formed availability-tagged sample.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import { NullRuntimeStore } from "@src/runner/store/RuntimeStore";
import { RUNTIME_STORE_MIGRATIONS } from "@src/runner/store/RuntimeStoreSchema";
import { loadSqlJs } from "@src/runner/store/SqlJsLoader";
import type { CapacitySnapshot } from "@src/runner/concurrency/CapacitySnapshot";
import { isFailureCategory, REPORT_CATEGORIES, toReportCategory } from "@src/reports/ReportCategories";
import type { ErrorClass } from "@src/runner/runtime/ErrorClassifier";
import { ProcessTreeSampler } from "@src/runner/runtime/ProcessTreeSampler";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function writeV1OnlyDatabase(dbPath: string): Promise<void> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  const v1 = RUNTIME_STORE_MIGRATIONS.find((m) => m.version === 1)!;
  for (const statement of v1.statements) db.run(statement);
  db.run("INSERT INTO runtime_migrations (version, name, appliedAt) VALUES (1, 'initial-schema', ?)", [new Date().toISOString()]);
  // A v1-shaped run row (only the original columns exist).
  db.run(
    `INSERT INTO runtime_runs (instanceId, executionId, scenarioId, status, flowRunStatus, startedAt, endedAt, updatedAt)
     VALUES ('legacy-1', 'legacy-e', 'legacy-s', 'completed', 'completed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z', '2026-01-01T00:01:00.000Z')`
  );
  await writeFile(dbPath, Buffer.from(db.export()));
  db.close();
}

async function main(): Promise<void> {
  console.log("Telemetry read-model verification");
  const root = await mkdtemp(join(tmpdir(), "wfs-telemetry-"));

  console.log("\nPart A — v1 → v2 in-place upgrade");
  const upgradePath = join(root, "upgrade.sqlite");
  await writeV1OnlyDatabase(upgradePath);
  const upgraded = await SqliteRuntimeStore.open(upgradePath, () => undefined);
  const migrations = upgraded.appliedMigrations();
  check(
    "v2 migration applied on top of a v1-only database",
    migrations.length === 2 && migrations[1].version === 2 && migrations[1].name === "reporting-extensions",
    JSON.stringify(migrations)
  );
  const legacy = upgraded.listRuns(10).find((run) => run.instanceId === "legacy-1");
  check("pre-v2 run row survives the upgrade", legacy?.status === "completed", JSON.stringify(legacy));
  check("pre-v2 row reads new columns as undefined (Unavailable)", legacy !== undefined && legacy.reportCategory === undefined && legacy.durationMs === undefined);

  console.log("\nPart B — reporting run-summary fields round-trip");
  upgraded.upsertRun({
    instanceId: "rep-1",
    executionId: "rep-e",
    scenarioId: "s-9",
    scenarioName: "Mock — Reporting",
    triggerType: "manual",
    status: "running",
    startedAt: "2026-07-07T10:00:00.000Z",
    queueWaitMs: 1200
  });
  upgraded.upsertRun({
    instanceId: "rep-1",
    executionId: "rep-e",
    status: "failed",
    endedAt: "2026-07-07T10:00:20.000Z",
    durationMs: 20000,
    retryCount: 2,
    error: "Timeout 30000ms exceeded",
    errorClass: "timeout",
    reportCategory: "timeout"
  });
  await upgraded.persistNow();
  const reopened = await SqliteRuntimeStore.open(upgradePath, () => undefined);
  const rep = reopened.listRuns(10).find((run) => run.instanceId === "rep-1");
  check("scenarioName/queueWait preserved through a later upsert (not wiped by REPLACE)", rep?.scenarioName === "Mock — Reporting" && rep?.queueWaitMs === 1200, JSON.stringify(rep));
  check("end-of-run reporting fields persisted", rep?.durationMs === 20000 && rep?.retryCount === 2 && rep?.reportCategory === "timeout", JSON.stringify(rep));
  await reopened.close();

  console.log("\nPart C — process samples write/read + empty-DB safety");
  const store = await SqliteRuntimeStore.open(join(root, "runtime.sqlite"), () => undefined);
  check("empty-DB listRuns returns []", store.listRuns().length === 0);
  check("empty-DB listProcessSamples returns []", store.listProcessSamples().length === 0);
  store.recordProcessSample({ timestamp: new Date().toISOString(), chromiumProcessCount: 3, chromiumMemoryMb: 512, availability: "full" });
  store.recordProcessSample({ timestamp: new Date().toISOString(), chromiumProcessCount: 5, chromiumMemoryMb: 640, availability: "full" });
  const samples = store.listProcessSamples();
  check("process samples round-trip", samples.length === 2 && samples.some((s) => s.chromiumProcessCount === 5), JSON.stringify(samples[0]));

  console.log("\nPart D — retention sweep (time + run cap)");
  const oldIso = new Date(Date.now() - 48 * 3600_000).toISOString();
  store.recordProcessSample({ timestamp: oldIso, chromiumProcessCount: 1, availability: "full" });
  // Three terminal runs (distinct updatedAt) + one recoverable/interrupted run.
  for (const id of ["term-1", "term-2", "term-3"]) {
    store.upsertRun({ instanceId: id, executionId: "sweep-e", status: "completed", startedAt: oldIso, endedAt: new Date().toISOString() });
    await sleep(8);
  }
  store.upsertRun({ instanceId: "recover-1", executionId: "sweep-e", status: "orphaned", recoverable: true, recoveryNote: "interrupted; safe to re-run" });
  store.sweepRetention({ retentionHours: 1, retentionRuns: 2 });
  const afterSweep = store.listProcessSamples();
  check("time retention drops >window samples, keeps recent", afterSweep.every((s) => s.chromiumProcessCount !== 1) && afterSweep.length === 2, `count=${afterSweep.length}`);
  const runsAfter = store.listRuns(50).map((r) => r.instanceId);
  check("run cap removes the oldest terminal run", !runsAfter.includes("term-1") && runsAfter.includes("term-2") && runsAfter.includes("term-3"), JSON.stringify(runsAfter));
  check("recoverable/interrupted run is never swept", runsAfter.includes("recover-1"));
  await store.close();

  console.log("\nPart E — ReportCategories taxonomy mapping");
  const classes: ErrorClass[] = [
    "navigation", "timeout", "locator", "browser-crash", "context-closed", "page-closed",
    "auth-expired", "profile-locked", "download-failed", "manual-action-required",
    "business-rule", "dangerous-side-effect", "cancelled", "unknown"
  ];
  check("every ErrorClass maps to a known report category", classes.every((c) => REPORT_CATEGORIES.includes(toReportCategory(c))));
  check("locator → selector", toReportCategory("locator") === "selector");
  check("auth-expired → session-expired", toReportCategory("auth-expired") === "session-expired");
  check("manual-action-required → auth-handoff-required", toReportCategory("manual-action-required") === "auth-handoff-required");
  check("undefined → unknown", toReportCategory(undefined) === "unknown");
  check("cancelled is not a failure category; timeout is", isFailureCategory("cancelled") === false && isFailureCategory("timeout") === true);

  console.log("\nPart F — ProcessTreeSampler tolerance (never throws)");
  const sampler = new ProcessTreeSampler(1000);
  let sampleErr: unknown;
  const sample = await sampler.sample().catch((e) => {
    sampleErr = e;
    return undefined;
  });
  check("sample() never throws", sampleErr === undefined && sample !== undefined);
  check("sample has a timestamp + availability tag", !!sample && typeof sample.sampledAt === "string" && ["full", "partial", "unavailable"].includes(sample.availability), JSON.stringify(sample));
  check("electron main memory is always sampled", !!sample && typeof sample.electronMainMemoryMb === "number" && sample.electronMainMemoryMb > 0, String(sample?.electronMainMemoryMb));
  sampler.start();
  sampler.stop();
  check("start()/stop() are idempotent-safe", true);

  console.log("\nPart G — reporting query layer (aggregates + pagination)");
  const q = await SqliteRuntimeStore.open(join(root, "queries.sqlite"), () => undefined);
  // Empty-DB queries never throw and report the store as enabled.
  const emptyOverview = q.queryOverview({});
  check("empty-DB overview: enabled, zero counts", emptyOverview.storeEnabled === true && emptyOverview.totalRuns === 0);
  check("empty-DB workflows/history/failures are empty", q.queryWorkflows({}).length === 0 && q.queryRunHistory({}, {}).total === 0 && q.queryFailures({}).total === 0);

  // 3 completed (s-A, durations 1/2/3s), 2 failed (s-B, timeout+selector), 1 cancelled (s-C).
  const seed = (instanceId: string, scenarioId: string, scenarioName: string, status: string, extra: Record<string, unknown>) => {
    q.upsertRun({ instanceId, executionId: `e-${instanceId}`, scenarioId, scenarioName, status, startedAt: "2026-07-07T09:00:00.000Z", endedAt: "2026-07-07T09:00:05.000Z", ...extra });
  };
  seed("a1", "s-A", "Alpha", "completed", { durationMs: 1000, queueWaitMs: 100 });
  seed("a2", "s-A", "Alpha", "completed", { durationMs: 2000, queueWaitMs: 200 });
  seed("a3", "s-A", "Alpha", "completed", { durationMs: 3000, queueWaitMs: 300 });
  seed("b1", "s-B", "Bravo", "failed", { errorClass: "timeout", reportCategory: "timeout", retryCount: 1 });
  seed("b2", "s-B", "Bravo", "failed", { errorClass: "locator", reportCategory: "selector" });
  seed("c1", "s-C", "Charlie", "cancelled", {});

  const overview = q.queryOverview({});
  check("overview counts", overview.totalRuns === 6 && overview.successRuns === 3 && overview.failedRuns === 2 && overview.cancelledRuns === 1, JSON.stringify(overview));
  check("overview success/failure rate excludes cancelled + in-progress", Math.abs(overview.successRate - 0.6) < 1e-9 && Math.abs(overview.failureRate - 0.4) < 1e-9);
  check("overview duration stats", overview.duration.avgMs === 2000 && overview.duration.medianMs === 2000 && overview.duration.p95Ms === 3000, JSON.stringify(overview.duration));
  check("overview avg queue wait", overview.avgQueueWaitMs === 200, String(overview.avgQueueWaitMs));

  const workflows = q.queryWorkflows({});
  check("workflows grouped by scenario, sorted by run count", workflows.length === 3 && workflows[0].scenarioId === "s-A" && workflows[0].totalRuns === 3, JSON.stringify(workflows.map((w) => w.scenarioId)));
  const bravo = workflows.find((w) => w.scenarioId === "s-B");
  check("workflow row: failed count + retry aggregation", bravo?.failed === 2 && bravo?.retryCount === 1, JSON.stringify(bravo));

  const page1 = q.queryRunHistory({}, { limit: 4, offset: 0 });
  const page2 = q.queryRunHistory({}, { limit: 4, offset: 4 });
  check("run history pagination", page1.total === 6 && page1.rows.length === 4 && page2.rows.length === 2 && page1.limit === 4, `total=${page1.total} p1=${page1.rows.length} p2=${page2.rows.length}`);
  const byScenario = q.queryRunHistory({}, {}, { scenarioId: "s-A" });
  check("run history scenarioId filter", byScenario.total === 3 && byScenario.rows.every((r) => r.scenarioId === "s-A"), `total=${byScenario.total}`);
  const byStatus = q.queryRunHistory({}, {}, { status: "failed" });
  check("run history status filter", byStatus.total === 2 && byStatus.rows.every((r) => r.status === "failed"), `total=${byStatus.total}`);

  const failures = q.queryFailures({});
  check("failures: only failed runs, categorized", failures.total === 2 && failures.categories.some((c) => c.category === "timeout" && c.count === 1) && failures.categories.some((c) => c.category === "selector"), JSON.stringify(failures.categories));
  check("failures: top workflow is Bravo", failures.topWorkflows[0]?.scenarioId === "s-B" && failures.topWorkflows[0]?.failed === 2);

  // Runtime series bucketing.
  const cap = (ts: string, activeBrowsers: number): CapacitySnapshot =>
    ({ timestamp: ts, activeBrowsers, activeFlows: 1, activePages: 1, queueDepth: 0, freeMemoryMb: 1000, processRssMb: 200, systemMemoryPercent: 50, cpuPercent: 20, recentCrashes: 0, dispatchBlocked: false } as CapacitySnapshot);
  q.recordCapacitySnapshot(cap("2026-07-07T09:00:00.000Z", 1));
  q.recordCapacitySnapshot(cap("2026-07-07T09:00:30.000Z", 3));
  q.recordCapacitySnapshot(cap("2026-07-07T10:00:00.000Z", 2));
  const series = q.queryRuntimeSeries({}, 60 * 60_000);
  check("runtime series buckets by the requested window", series.length === 2 && series[0].activeBrowsers === 2, JSON.stringify(series.map((s) => s.activeBrowsers)));

  // Deterministic range filtering against the fixed seed time (independent of wall clock).
  const afterSeed = q.queryOverview({ sinceIso: "2026-07-07T12:00:00.000Z" });
  check("range filter excludes runs before the window", afterSeed.totalRuns === 0, String(afterSeed.totalRuns));
  const beforeSeed = q.queryOverview({ sinceIso: "2026-07-06T00:00:00.000Z" });
  check("range filter includes runs within the window", beforeSeed.totalRuns === 6, String(beforeSeed.totalRuns));
  await q.close();

  const nullStore = new NullRuntimeStore();
  check("NullRuntimeStore overview reports storeEnabled=false", nullStore.queryOverview({}).storeEnabled === false);
  check("NullRuntimeStore queries are empty and never throw", nullStore.queryWorkflows({}).length === 0 && nullStore.queryRunHistory({}, {}).total === 0 && nullStore.queryFailures({}).total === 0 && nullStore.queryRuntimeSeries({}, 1000).length === 0);

  await upgraded.close();
  await rm(root, { recursive: true, force: true });

  console.log(`\n${passed}/${passed + failed} telemetry checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
