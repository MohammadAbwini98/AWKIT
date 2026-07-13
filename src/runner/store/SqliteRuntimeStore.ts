/**
 * SQLite-backed durable runtime store.
 *
 * Driver: `sql.js` (SQLite compiled to WASM) — chosen deliberately for this repo: it produces a
 * REAL SQLite database file (openable by any SQLite tool) with zero native ABI, so the same
 * module works in the Node 18 tsx verifiers and Electron 33's Node 20 main process, fully
 * offline. Trade-off (documented): the database lives in memory and is persisted with
 * atomic-rename writes (debounced + on critical transitions + on close), and the store is
 * SINGLE-WRITER — cross-process mutual exclusion comes from `DurableLockStore`'s atomic
 * filesystem locks, not from SQLite file locking.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Database } from "sql.js";
import type { CapacitySnapshot } from "../concurrency/CapacitySnapshot";
import { APP_INSTANCE_ID, APP_PID } from "./AppInstance";
import type { RuntimeStore } from "./RuntimeStore";
import {
  durationStats,
  machineContextFromRun,
  percentile,
  type FailureBreakdown,
  type MachineFilter,
  type MachineSummary,
  type RunHistoryFilter,
  type RunHistoryPage,
  type RunHistoryRow,
  type RunsSeriesPoint,
  type RuntimeSeriesPoint,
  type TelemetryOverview,
  type TelemetryPage,
  type TelemetryRange,
  type WorkflowComparisonRow,
  type WorkflowReportRow,
  type WorkflowTrend,
  type WorkflowTrendPoint
} from "@src/reports/TelemetryContracts";
import { toReportCategory, type ReportCategory } from "@src/reports/ReportCategories";
import type { ErrorClass } from "../runtime/ErrorClassifier";
import { loadSqlJs } from "./SqlJsLoader";
import {
  RUNTIME_STORE_MIGRATIONS,
  type DurableArtifactRecord,
  type DurableAttemptRecord,
  type DurableCancellationRecord,
  type DurableProcessSampleRecord,
  type DurableRunRecord
} from "./RuntimeStoreSchema";

const PERSIST_DEBOUNCE_MS = 300;
/** Active-looking statuses that indicate a run was interrupted if its app instance is gone. */
const INTERRUPTED_STATUSES = new Set(["pending", "starting", "running", "waitingForManualAction", "paused", "leased", "waiting"]);

export class SqliteRuntimeStore implements RuntimeStore {
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private persistChain: Promise<void> = Promise.resolve();
  private dirty = false;
  private closed = false;

  private constructor(
    private readonly db: Database,
    private readonly dbPath: string,
    private readonly warn: (message: string) => void
  ) {}

  /** Open (or create) the database file and apply pending migrations. */
  static async open(dbPath: string, warn: (message: string) => void = (m) => console.warn(`[runtime-store] ${m}`)): Promise<SqliteRuntimeStore> {
    // Explicit WASM resolution (Phase 4A): works in dev, tsx verifiers, and packaged app.asar.
    const SQL = await loadSqlJs();
    let db: Database;
    try {
      const bytes = await readFile(dbPath);
      db = new SQL.Database(bytes);
    } catch {
      db = new SQL.Database();
    }
    const store = new SqliteRuntimeStore(db, dbPath, warn);
    store.migrate();
    await store.persistNow();
    return store;
  }

  /** Apply every migration not yet recorded in runtime_migrations (idempotent). */
  private migrate(): void {
    // Bootstrap: the migrations table itself is created by migration 1's first statement, but we
    // need it to check versions — create defensively first.
    this.db.run(`CREATE TABLE IF NOT EXISTS runtime_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL)`);
    const applied = new Set<number>();
    const result = this.db.exec("SELECT version FROM runtime_migrations");
    if (result.length) for (const row of result[0].values) applied.add(Number(row[0]));

    for (const migration of RUNTIME_STORE_MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      for (const statement of migration.statements) this.db.run(statement);
      this.db.run("INSERT INTO runtime_migrations (version, name, appliedAt) VALUES (?, ?, ?)", [
        migration.version,
        migration.name,
        new Date().toISOString()
      ]);
    }
    this.dirty = true;
  }

  appliedMigrations(): Array<{ version: number; name: string }> {
    const result = this.db.exec("SELECT version, name FROM runtime_migrations ORDER BY version");
    if (!result.length) return [];
    return result[0].values.map((row) => ({ version: Number(row[0]), name: String(row[1]) }));
  }

  // ── Writes (all best-effort: a store problem must never fail a run) ────────

  upsertRun(record: Partial<DurableRunRecord> & { instanceId: string; executionId: string }): void {
    this.safeRun(() => {
      const existing = this.getRun(record.instanceId);
      const merged: DurableRunRecord = {
        status: "pending",
        ...existing,
        ...stripUndefined(record),
        appInstanceId: record.appInstanceId ?? existing?.appInstanceId ?? APP_INSTANCE_ID,
        pid: record.pid ?? existing?.pid ?? APP_PID,
        updatedAt: new Date().toISOString()
      } as DurableRunRecord;
      this.db.run(
        `INSERT OR REPLACE INTO runtime_runs
         (instanceId, executionId, scenarioId, status, flowRunStatus, appInstanceId, pid, startedAt, endedAt,
          lastHeartbeatAt, lastKnownUrl, error, errorClass, recoverable, recoveryNote,
          scenarioName, triggerType, queueWaitMs, durationMs, retryCount, recoveryCount, reportCategory,
          machineId, logicalCpuCount, totalMemoryMb, availableMemoryMbAtStart, executionMode, browserPoolMode,
          configuredConcurrency, observedPeakConcurrency, workloadClass, capacityRecommendationAtRun, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          merged.instanceId,
          merged.executionId,
          merged.scenarioId ?? null,
          merged.status,
          merged.flowRunStatus ?? null,
          merged.appInstanceId ?? null,
          merged.pid ?? null,
          merged.startedAt ?? null,
          merged.endedAt ?? null,
          merged.lastHeartbeatAt ?? null,
          merged.lastKnownUrl ?? null,
          merged.error ?? null,
          merged.errorClass ?? null,
          merged.recoverable === undefined ? null : merged.recoverable ? 1 : 0,
          merged.recoveryNote ?? null,
          merged.scenarioName ?? null,
          merged.triggerType ?? null,
          merged.queueWaitMs ?? null,
          merged.durationMs ?? null,
          merged.retryCount ?? null,
          merged.recoveryCount ?? null,
          merged.reportCategory ?? null,
          merged.machineId ?? null,
          merged.logicalCpuCount ?? null,
          merged.totalMemoryMb ?? null,
          merged.availableMemoryMbAtStart ?? null,
          merged.executionMode ?? null,
          merged.browserPoolMode ?? null,
          merged.configuredConcurrency ?? null,
          merged.observedPeakConcurrency ?? null,
          merged.workloadClass ?? null,
          merged.capacityRecommendationAtRun ?? null,
          merged.updatedAt
        ]
      );
    });
  }

  recordAttempt(attempt: DurableAttemptRecord): void {
    this.safeRun(() => {
      this.db.run(
        `INSERT OR REPLACE INTO runtime_node_attempts
         (attemptId, instanceId, executionId, flowId, nodeId, tryNumber, status, sideEffectLevel, startedAt,
          completedAt, durationMs, currentUrl, error, errorClass, retryDecision, tracePath, screenshotPath)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          attempt.attemptId,
          attempt.instanceId,
          attempt.executionId,
          attempt.flowId ?? null,
          attempt.nodeId,
          attempt.tryNumber,
          attempt.status,
          attempt.sideEffectLevel ?? null,
          attempt.startedAt ?? null,
          attempt.completedAt ?? null,
          attempt.durationMs ?? null,
          attempt.currentUrl ?? null,
          attempt.error ?? null,
          attempt.errorClass ?? null,
          attempt.retryDecision ?? null,
          attempt.tracePath ?? null,
          attempt.screenshotPath ?? null
        ]
      );
    });
  }

  recordHeartbeat(heartbeat: { instanceId: string; executionId: string; nodeId?: string; browserWorkerId?: string; currentUrl?: string; status?: string; timestamp: string }): void {
    this.safeRun(() => {
      this.db.run(
        `INSERT OR REPLACE INTO runtime_heartbeats (instanceId, executionId, nodeId, browserWorkerId, currentUrl, status, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          heartbeat.instanceId,
          heartbeat.executionId,
          heartbeat.nodeId ?? null,
          heartbeat.browserWorkerId ?? null,
          heartbeat.currentUrl ?? null,
          heartbeat.status ?? null,
          heartbeat.timestamp
        ]
      );
      this.db.run("UPDATE runtime_runs SET lastHeartbeatAt = ?, updatedAt = ? WHERE instanceId = ?", [
        heartbeat.timestamp,
        new Date().toISOString(),
        heartbeat.instanceId
      ]);
    });
  }

  recordCancellation(record: DurableCancellationRecord): void {
    this.safeRun(() => {
      this.db.run(
        `INSERT OR REPLACE INTO runtime_cancellations (instanceId, executionId, requestedAt, reason, source, completedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [record.instanceId, record.executionId, record.requestedAt, record.reason ?? null, record.source ?? null, record.completedAt ?? null]
      );
    }, true);
  }

  completeCancellation(instanceId: string, completedAt: string): void {
    this.safeRun(() => {
      this.db.run("UPDATE runtime_cancellations SET completedAt = ? WHERE instanceId = ?", [completedAt, instanceId]);
    }, true);
  }

  recordWatchdogEvent(event: { instanceId?: string; kind: string; reason?: string; at: string }): void {
    this.safeRun(() => {
      this.db.run("INSERT INTO runtime_watchdog_events (instanceId, kind, reason, at) VALUES (?, ?, ?, ?)", [
        event.instanceId ?? null,
        event.kind,
        event.reason ?? null,
        event.at
      ]);
    });
  }

  recordArtifact(artifact: { instanceId: string; executionId: string; nodeId?: string; attemptId?: string; kind: string; path: string; createdAt: string }): void {
    this.safeRun(() => {
      this.db.run(
        "INSERT INTO runtime_artifacts (instanceId, executionId, nodeId, attemptId, kind, path, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [artifact.instanceId, artifact.executionId, artifact.nodeId ?? null, artifact.attemptId ?? null, artifact.kind, artifact.path, artifact.createdAt]
      );
    });
  }

  recordCapacitySnapshot(snapshot: CapacitySnapshot): void {
    this.safeRun(() => {
      this.db.run(
        `INSERT INTO runtime_capacity_snapshots
         (timestamp, activeBrowsers, activeFlows, activePages, queueDepth, freeMemoryMb, processRssMb,
          systemMemoryPercent, cpuPercent, recentCrashes, dispatchBlocked, blockedReason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.timestamp,
          snapshot.activeBrowsers,
          snapshot.activeFlows,
          snapshot.activePages,
          snapshot.queueDepth,
          snapshot.freeMemoryMb,
          snapshot.processRssMb,
          snapshot.systemMemoryPercent ?? null,
          snapshot.cpuPercent ?? null,
          snapshot.recentCrashes,
          snapshot.dispatchBlocked ? 1 : 0,
          snapshot.blockedReason ?? null
        ]
      );
      // Keep the table bounded: retain the most recent 500 samples.
      this.db.run("DELETE FROM runtime_capacity_snapshots WHERE id NOT IN (SELECT id FROM runtime_capacity_snapshots ORDER BY id DESC LIMIT 500)");
    });
  }

  /** Chrome/host consumption sample (reporting; migration v2). Bounded to the most recent 500 rows. */
  recordProcessSample(sample: DurableProcessSampleRecord): void {
    this.safeRun(() => {
      this.db.run(
        `INSERT INTO runtime_process_samples
         (timestamp, chromiumProcessCount, chromiumMemoryMb, chromiumCpuPercent, electronMainMemoryMb,
          browserContextCount, pageCount, activeBrowsers, idleBrowsers, launchesWindow, restartsWindow,
          crashesWindow, availability)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sample.timestamp,
          sample.chromiumProcessCount ?? null,
          sample.chromiumMemoryMb ?? null,
          sample.chromiumCpuPercent ?? null,
          sample.electronMainMemoryMb ?? null,
          sample.browserContextCount ?? null,
          sample.pageCount ?? null,
          sample.activeBrowsers ?? null,
          sample.idleBrowsers ?? null,
          sample.launchesWindow ?? null,
          sample.restartsWindow ?? null,
          sample.crashesWindow ?? null,
          sample.availability ?? null
        ]
      );
      this.db.run("DELETE FROM runtime_process_samples WHERE id NOT IN (SELECT id FROM runtime_process_samples ORDER BY id DESC LIMIT 500)");
    });
  }

  listProcessSamples(sinceIso?: string, limit = 500): DurableProcessSampleRecord[] {
    const clause = sinceIso ? "WHERE timestamp >= ? ORDER BY id DESC LIMIT ?" : "ORDER BY id DESC LIMIT ?";
    const params = sinceIso ? [sinceIso, limit] : [limit];
    return this.selectAll("runtime_process_samples", clause, params) as unknown as DurableProcessSampleRecord[];
  }

  /**
   * Bounded time/count retention (reporting). Never touches user artifacts/screenshots on disk —
   * only DB rows. Terminal runs older than the cutoff (and beyond the run cap) are removed with
   * their attempts/heartbeats/artifacts; interrupted/recoverable runs are always kept. Never throws.
   */
  sweepRetention(opts: { retentionHours?: number; retentionRuns?: number } = {}): void {
    const retentionHours = opts.retentionHours ?? 24;
    const retentionRuns = opts.retentionRuns ?? 5000;
    this.safeRun(() => {
      const cutoffIso = new Date(Date.now() - retentionHours * 3600_000).toISOString();
      // High-frequency samples: drop anything older than the raw-retention window.
      this.db.run("DELETE FROM runtime_capacity_snapshots WHERE timestamp < ?", [cutoffIso]);
      this.db.run("DELETE FROM runtime_process_samples WHERE timestamp < ?", [cutoffIso]);
      // Runs: keep only the most recent `retentionRuns` TERMINAL runs; keep every interrupted/
      // recoverable run regardless (they still need review). Cascade to child rows.
      const doomed = this.db.exec(
        `SELECT instanceId FROM runtime_runs
         WHERE endedAt IS NOT NULL
           AND (recoverable IS NULL OR recoverable = 0)
           AND recoveryNote IS NULL
           AND instanceId NOT IN (
             SELECT instanceId FROM runtime_runs
             WHERE endedAt IS NOT NULL
             ORDER BY updatedAt DESC
             LIMIT ?
           )`,
        [retentionRuns]
      );
      const ids = doomed.length ? doomed[0].values.map((row) => String(row[0])) : [];
      for (const id of ids) {
        this.db.run("DELETE FROM runtime_node_attempts WHERE instanceId = ?", [id]);
        this.db.run("DELETE FROM runtime_heartbeats WHERE instanceId = ?", [id]);
        this.db.run("DELETE FROM runtime_artifacts WHERE instanceId = ?", [id]);
        this.db.run("DELETE FROM runtime_runs WHERE instanceId = ?", [id]);
      }
    }, true);
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  getRun(instanceId: string): DurableRunRecord | undefined {
    const rows = this.selectRuns("WHERE instanceId = ?", [instanceId]);
    return rows[0];
  }

  listRuns(limit = 100): DurableRunRecord[] {
    return this.selectRuns("ORDER BY updatedAt DESC LIMIT ?", [limit]);
  }

  listAttempts(instanceId: string): DurableAttemptRecord[] {
    const result = this.db.exec("SELECT * FROM runtime_node_attempts WHERE instanceId = ? ORDER BY startedAt", [instanceId]);
    if (!result.length) return [];
    const columns = result[0].columns;
    return result[0].values.map((row) => {
      const record: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        record[column] = row[index] ?? undefined;
      });
      return record as unknown as DurableAttemptRecord;
    });
  }

  listArtifacts(instanceId: string): DurableArtifactRecord[] {
    const result = this.db.exec("SELECT * FROM runtime_artifacts WHERE instanceId = ? ORDER BY createdAt", [instanceId]);
    if (!result.length) return [];
    const columns = result[0].columns;
    return result[0].values.map((row) => {
      const record: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        record[column] = row[index] ?? undefined;
      });
      return record as unknown as DurableArtifactRecord;
    });
  }

  // ── Reporting queries (read-only; SQL SELECT + bounded JS aggregation) ──────

  queryOverview(range: TelemetryRange): TelemetryOverview {
    const runs = this.selectRunsInRange(range, 5000);
    const durations = runs.map((r) => r.durationMs).filter((v): v is number => typeof v === "number");
    const queueWaits = runs.map((r) => r.queueWaitMs).filter((v): v is number => typeof v === "number");
    let successRuns = 0;
    let failedRuns = 0;
    let cancelledRuns = 0;
    for (const run of runs) {
      const bucket = statusBucket(run.status);
      if (bucket === "success") successRuns += 1;
      else if (bucket === "failed") failedRuns += 1;
      else if (bucket === "cancelled") cancelledRuns += 1;
    }
    const otherRuns = runs.length - successRuns - failedRuns - cancelledRuns;
    const denom = successRuns + failedRuns;
    return {
      storeEnabled: true,
      totalRuns: runs.length,
      successRuns,
      failedRuns,
      cancelledRuns,
      otherRuns,
      successRate: denom ? successRuns / denom : 0,
      failureRate: denom ? failedRuns / denom : 0,
      duration: durationStats(durations),
      avgQueueWaitMs: queueWaits.length ? Math.round(queueWaits.reduce((a, b) => a + b, 0) / queueWaits.length) : undefined,
      runsSeries: buildRunsSeries(runs)
    };
  }

  queryWorkflows(range: TelemetryRange): WorkflowReportRow[] {
    return aggregateWorkflows(this.selectRunsInRange(range, 10000));
  }

  /**
   * Per-workflow stats for the current window, each compared to the SAME workflow in the immediately
   * preceding window of equal length. Windows are half-open: current `[since, now)`, previous
   * `[since − len, since)`. All-time ranges (no `sinceIso`) have no prior window → `previous` undefined,
   * `trend` = `new`. An optional machine filter keeps cross-machine runs from being compared together.
   */
  queryWorkflowComparison(range: TelemetryRange, machineFilter: MachineFilter = {}): WorkflowComparisonRow[] {
    const now = Date.now();
    const sinceMs = range.sinceIso ? Date.parse(range.sinceIso) : undefined;
    const currentRuns = this.runsInWindow(range.sinceIso, undefined, machineFilter);
    const current = aggregateWorkflows(currentRuns);

    let previousByKey = new Map<string, WorkflowReportRow>();
    if (sinceMs !== undefined && Number.isFinite(sinceMs)) {
      const len = now - sinceMs;
      const prevSinceIso = new Date(sinceMs - len).toISOString();
      const previousRuns = this.runsInWindow(prevSinceIso, range.sinceIso, machineFilter);
      previousByKey = new Map(aggregateWorkflows(previousRuns).map((row) => [row.scenarioId ?? "(unknown)", row]));
    }

    // Representative machine context = the workflow's most recent run in the current window.
    const lastRunByKey = new Map<string, DurableRunRecord>();
    for (const run of currentRuns) {
      const key = run.scenarioId ?? "(unknown)";
      const prev = lastRunByKey.get(key);
      if (!prev || runTime(run) > runTime(prev)) lastRunByKey.set(key, run);
    }

    return current.map((row) => {
      const key = row.scenarioId ?? "(unknown)";
      const previous = previousByKey.get(key);
      const delta = previous
        ? {
            successRate: round4(row.successRate - previous.successRate),
            avgMs: subtract(row.duration.avgMs, previous.duration.avgMs),
            p95Ms: subtract(row.duration.p95Ms, previous.duration.p95Ms),
            totalRuns: row.totalRuns - previous.totalRuns
          }
        : {};
      const trend: WorkflowComparisonRow["trend"] = !previous
        ? "new"
        : row.successRate > previous.successRate
          ? "up"
          : row.successRate < previous.successRate
            ? "down"
            : "flat";
      const lastRun = lastRunByKey.get(key);
      return { ...row, previous, delta, trend, machineContext: lastRun ? machineContextFromRun(lastRun) : undefined };
    });
  }

  /**
   * Run-over-run trend for ONE workflow: its runs in range split into `buckets` equal time buckets, each
   * with success rate + duration stats. Empty when the workflow has no runs in range.
   */
  queryWorkflowTrend(scenarioId: string | undefined, range: TelemetryRange, buckets: number, machineFilter: MachineFilter = {}): WorkflowTrend {
    const runs = this.runsInWindow(range.sinceIso, undefined, machineFilter).filter((r) => (r.scenarioId ?? undefined) === scenarioId);
    const bucketCount = Math.max(1, Math.floor(buckets));
    const times = runs.map(runTime).filter((n) => !Number.isNaN(n));
    if (times.length === 0) return { scenarioId, scenarioName: undefined, points: [] };
    const min = Math.min(...times);
    const max = Math.max(...times);
    const span = Math.max(1, max - min);
    const width = Math.max(1, Math.ceil(span / bucketCount));
    const groups = new Map<number, DurableRunRecord[]>();
    let scenarioName: string | undefined;
    for (const run of runs) {
      scenarioName = scenarioName ?? run.scenarioName;
      const t = runTime(run);
      if (Number.isNaN(t)) continue;
      const key = Math.min(bucketCount - 1, Math.floor((t - min) / width));
      const list = groups.get(key) ?? [];
      list.push(run);
      groups.set(key, list);
    }
    const points: WorkflowTrendPoint[] = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([key, group]) => {
        let success = 0;
        let failed = 0;
        const durations: number[] = [];
        for (const run of group) {
          const bucket = statusBucket(run.status);
          if (bucket === "success") success += 1;
          else if (bucket === "failed") failed += 1;
          if (typeof run.durationMs === "number") durations.push(run.durationMs);
        }
        const denom = success + failed;
        return {
          bucketIso: new Date(min + key * width).toISOString(),
          totalRuns: group.length,
          success,
          failed,
          successRate: denom ? success / denom : 0,
          avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : undefined,
          p95Ms: percentile(durations, 95)
        };
      });
    return { scenarioId, scenarioName, points };
  }

  /** Distinct machines seen in run history within range (for the reports machine filter). */
  listRunMachines(range: TelemetryRange = {}): MachineSummary[] {
    const runs = this.runsInWindow(range.sinceIso, undefined, {}).filter((r) => r.machineId);
    const byMachine = new Map<string, { last: DurableRunRecord; runs: number }>();
    for (const run of runs) {
      const key = run.machineId as string;
      const entry = byMachine.get(key);
      if (!entry) byMachine.set(key, { last: run, runs: 1 });
      else {
        entry.runs += 1;
        if (runTime(run) > runTime(entry.last)) entry.last = run;
      }
    }
    return [...byMachine.values()]
      .map(({ last, runs: count }) => ({ ...machineContextFromRun(last), runs: count, lastRunAt: last.endedAt ?? last.startedAt ?? last.updatedAt }))
      .sort((a, b) => b.runs - a.runs);
  }

  /** Runs whose start/update falls in `[startIso, endIso)`, machine-filtered, newest first, bounded. */
  private runsInWindow(startIso: string | undefined, endIso: string | undefined, filter: MachineFilter): DurableRunRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (startIso) {
      conditions.push("COALESCE(startedAt, updatedAt) >= ?");
      params.push(startIso);
    }
    if (endIso) {
      conditions.push("COALESCE(startedAt, updatedAt) < ?");
      params.push(endIso);
    }
    if (filter.machineId) {
      conditions.push("machineId = ?");
      params.push(filter.machineId);
    }
    const clause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const runs = this.selectRuns(`${clause} ORDER BY COALESCE(startedAt, updatedAt) DESC LIMIT ?`, [...params, 10000]);
    // Low-cardinality mode/pool/class filters applied in JS (keeps the SQL + indexes simple).
    return runs.filter(
      (r) =>
        (!filter.executionMode || r.executionMode === filter.executionMode) &&
        (!filter.browserPoolMode || r.browserPoolMode === filter.browserPoolMode) &&
        (!filter.workloadClass || r.workloadClass === filter.workloadClass)
    );
  }

  queryRunHistory(range: TelemetryRange, page: TelemetryPage, filter: RunHistoryFilter = {}): RunHistoryPage {
    const limit = Math.min(500, Math.max(1, page.limit ?? 50));
    const offset = Math.max(0, page.offset ?? 0);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (range.sinceIso) {
      conditions.push("COALESCE(startedAt, updatedAt) >= ?");
      params.push(range.sinceIso);
    }
    if (filter.scenarioId) {
      conditions.push("scenarioId = ?");
      params.push(filter.scenarioId);
    }
    if (filter.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter.machineId) {
      conditions.push("machineId = ?");
      params.push(filter.machineId);
    }
    if (filter.executionMode) {
      conditions.push("executionMode = ?");
      params.push(filter.executionMode);
    }
    if (filter.browserPoolMode) {
      conditions.push("browserPoolMode = ?");
      params.push(filter.browserPoolMode);
    }
    if (filter.workloadClass) {
      conditions.push("workloadClass = ?");
      params.push(filter.workloadClass);
    }
    const clause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countResult = this.db.exec(`SELECT COUNT(*) FROM runtime_runs ${clause}`, params as never);
    const total = countResult.length ? Number(countResult[0].values[0][0]) : 0;
    const rowsRaw = this.selectAll(
      "runtime_runs",
      `${clause} ORDER BY COALESCE(startedAt, updatedAt) DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const rows: RunHistoryRow[] = rowsRaw.map((r) => ({
      instanceId: String(r.instanceId),
      executionId: String(r.executionId),
      scenarioId: r.scenarioId as string | undefined,
      scenarioName: r.scenarioName as string | undefined,
      status: String(r.status),
      startedAt: r.startedAt as string | undefined,
      endedAt: r.endedAt as string | undefined,
      durationMs: r.durationMs as number | undefined,
      queueWaitMs: r.queueWaitMs as number | undefined,
      reportCategory: r.reportCategory as string | undefined,
      errorClass: r.errorClass as string | undefined
    }));
    return { rows, total, limit, offset };
  }

  queryFailures(range: TelemetryRange): FailureBreakdown {
    const runs = this.selectRunsInRange(range, 10000).filter((run) => statusBucket(run.status) === "failed");
    const categoryCounts = new Map<ReportCategory, number>();
    const workflowCounts = new Map<string, { scenarioId?: string; scenarioName?: string; failed: number }>();
    for (const run of runs) {
      const category = (run.reportCategory as ReportCategory | undefined) ?? toReportCategory(run.errorClass as ErrorClass | undefined);
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      const key = run.scenarioId ?? "(unknown)";
      const entry = workflowCounts.get(key) ?? { scenarioId: run.scenarioId, scenarioName: run.scenarioName, failed: 0 };
      entry.failed += 1;
      entry.scenarioName = entry.scenarioName ?? run.scenarioName;
      workflowCounts.set(key, entry);
    }
    return {
      total: runs.length,
      categories: [...categoryCounts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      topWorkflows: [...workflowCounts.values()].sort((a, b) => b.failed - a.failed).slice(0, 10)
    };
  }

  queryRuntimeSeries(range: TelemetryRange, bucketMs: number): RuntimeSeriesPoint[] {
    const { clause, params } = rangeClause(range, "timestamp");
    const rows = this.selectAll("runtime_capacity_snapshots", `${clause} ORDER BY timestamp ASC LIMIT 5000`, params);
    const bucket = Math.max(1000, bucketMs);
    const buckets = new Map<number, { count: number; activeBrowsers: number; activeFlows: number; activePages: number; queueDepth: number; mem: number[]; cpu: number[] }>();
    for (const row of rows) {
      const ts = Date.parse(String(row.timestamp));
      if (Number.isNaN(ts)) continue;
      const key = Math.floor(ts / bucket) * bucket;
      const agg = buckets.get(key) ?? { count: 0, activeBrowsers: 0, activeFlows: 0, activePages: 0, queueDepth: 0, mem: [], cpu: [] };
      agg.count += 1;
      agg.activeBrowsers += Number(row.activeBrowsers ?? 0);
      agg.activeFlows += Number(row.activeFlows ?? 0);
      agg.activePages += Number(row.activePages ?? 0);
      agg.queueDepth += Number(row.queueDepth ?? 0);
      if (row.systemMemoryPercent !== undefined) agg.mem.push(Number(row.systemMemoryPercent));
      if (row.cpuPercent !== undefined) agg.cpu.push(Number(row.cpuPercent));
      buckets.set(key, agg);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([key, agg]) => ({
        bucketIso: new Date(key).toISOString(),
        activeBrowsers: Math.round(agg.activeBrowsers / agg.count),
        activeFlows: Math.round(agg.activeFlows / agg.count),
        activePages: Math.round(agg.activePages / agg.count),
        queueDepth: Math.round(agg.queueDepth / agg.count),
        systemMemoryPercent: agg.mem.length ? Math.round((agg.mem.reduce((a, b) => a + b, 0) / agg.mem.length) * 10) / 10 : undefined,
        cpuPercent: agg.cpu.length ? Math.round((agg.cpu.reduce((a, b) => a + b, 0) / agg.cpu.length) * 10) / 10 : undefined
      }));
  }

  /** Runs whose start (or update) falls in the window, newest first, bounded. */
  private selectRunsInRange(range: TelemetryRange, limit: number): DurableRunRecord[] {
    const { clause, params } = rangeClause(range);
    return this.selectRuns(`${clause} ORDER BY COALESCE(startedAt, updatedAt) DESC LIMIT ?`, [...params, limit]);
  }

  findInterruptedRuns(currentAppInstanceId: string): DurableRunRecord[] {
    return this.listRuns(1000).filter(
      (run) => INTERRUPTED_STATUSES.has(run.status) && run.appInstanceId !== currentAppInstanceId && run.recoveryNote === undefined
    );
  }

  markRunRecovery(instanceId: string, patch: { status: string; recoverable: boolean; recoveryNote: string }): void {
    this.safeRun(() => {
      this.db.run("UPDATE runtime_runs SET status = ?, recoverable = ?, recoveryNote = ?, updatedAt = ? WHERE instanceId = ?", [
        patch.status,
        patch.recoverable ? 1 : 0,
        patch.recoveryNote,
        new Date().toISOString(),
        instanceId
      ]);
    }, true);
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /** Atomic write: export → temp file → rename over the target. */
  async persistNow(): Promise<void> {
    if (this.closed && !this.dirty) return;
    this.persistChain = this.persistChain.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      try {
        const bytes = Buffer.from(this.db.export());
        await mkdir(dirname(this.dbPath), { recursive: true });
        const tempPath = join(dirname(this.dbPath), `.${Date.now()}-${process.pid}.tmp`);
        await writeFile(tempPath, bytes);
        await rename(tempPath, this.dbPath);
      } catch (error) {
        this.dirty = true;
        this.warn(`persist failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    await this.persistChain;
  }

  async close(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    await this.persistNow();
    this.closed = true;
    this.db.close();
  }

  /** Run a write; schedule persistence (immediate for critical transitions). Never throws. */
  private safeRun(fn: () => void, critical = false): void {
    if (this.closed) return;
    try {
      fn();
      this.dirty = true;
      if (critical) {
        void this.persistNow();
      } else {
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
          void this.persistNow();
        }, PERSIST_DEBOUNCE_MS);
        if (typeof this.persistTimer === "object" && "unref" in this.persistTimer) this.persistTimer.unref();
      }
    } catch (error) {
      this.warn(`write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Generic column-mapped SELECT for simple tables (NULL → undefined). */
  private selectAll(table: string, clause: string, params: unknown[]): Record<string, unknown>[] {
    const result = this.db.exec(`SELECT * FROM ${table} ${clause}`, params as never);
    if (!result.length) return [];
    const columns = result[0].columns;
    return result[0].values.map((row) => {
      const record: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        record[column] = row[index] ?? undefined;
      });
      return record;
    });
  }

  private selectRuns(clause: string, params: unknown[]): DurableRunRecord[] {
    const result = this.db.exec(`SELECT * FROM runtime_runs ${clause}`, params as never);
    if (!result.length) return [];
    const columns = result[0].columns;
    return result[0].values.map((row) => {
      const record: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        record[column] = row[index] ?? undefined;
      });
      if (record.recoverable !== undefined) record.recoverable = record.recoverable === 1;
      return record as unknown as DurableRunRecord;
    });
  }
}

function stripUndefined<T extends Record<string, unknown>>(record: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Group runs by scenario into WorkflowReportRows (shared by queryWorkflows + queryWorkflowComparison). */
function aggregateWorkflows(runs: DurableRunRecord[]): WorkflowReportRow[] {
  const groups = new Map<string, DurableRunRecord[]>();
  for (const run of runs) {
    const key = run.scenarioId ?? "(unknown)";
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  }
  const rows: WorkflowReportRow[] = [];
  for (const [scenarioId, group] of groups) {
    let success = 0;
    let failed = 0;
    let cancelled = 0;
    let retryCount = 0;
    const durations: number[] = [];
    const queueWaits: number[] = [];
    let last: DurableRunRecord | undefined;
    for (const run of group) {
      const bucket = statusBucket(run.status);
      if (bucket === "success") success += 1;
      else if (bucket === "failed") failed += 1;
      else if (bucket === "cancelled") cancelled += 1;
      if (typeof run.durationMs === "number") durations.push(run.durationMs);
      if (typeof run.queueWaitMs === "number") queueWaits.push(run.queueWaitMs);
      retryCount += run.retryCount ?? 0;
      if (!last || runTime(run) > runTime(last)) last = run;
    }
    const denom = success + failed;
    rows.push({
      scenarioId: scenarioId === "(unknown)" ? undefined : scenarioId,
      scenarioName: last?.scenarioName,
      totalRuns: group.length,
      success,
      failed,
      cancelled,
      successRate: denom ? success / denom : 0,
      duration: durationStats(durations),
      avgQueueWaitMs: queueWaits.length ? Math.round(queueWaits.reduce((a, b) => a + b, 0) / queueWaits.length) : undefined,
      retryCount,
      lastRunStatus: last?.status,
      lastRunAt: last ? last.endedAt ?? last.startedAt ?? last.updatedAt : undefined
    });
  }
  return rows.sort((a, b) => b.totalRuns - a.totalRuns);
}

/** current − previous for an optional metric; undefined when either side is missing. */
function subtract(current: number | undefined, previous: number | undefined): number | undefined {
  if (typeof current !== "number" || typeof previous !== "number") return undefined;
  return current - previous;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Coarse outcome bucket for reporting aggregates. */
function statusBucket(status: string): "success" | "failed" | "cancelled" | "other" {
  if (status === "completed" || status === "passed") return "success";
  if (status === "failed" || status === "crashed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "other";
}

/** Best available epoch for a run (ended → started → updated). */
function runTime(run: DurableRunRecord): number {
  const iso = run.endedAt ?? run.startedAt ?? run.updatedAt;
  return iso ? Date.parse(iso) : Number.NaN;
}

/** WHERE clause for a time window over a runs/timestamp column; empty when all-time. */
function rangeClause(range: TelemetryRange, column = "COALESCE(startedAt, updatedAt)"): { clause: string; params: unknown[] } {
  if (!range.sinceIso) return { clause: "", params: [] };
  return { clause: `WHERE ${column} >= ?`, params: [range.sinceIso] };
}

/** Bucket runs across their observed span into ≤24 points for a sparkline. */
function buildRunsSeries(runs: DurableRunRecord[]): RunsSeriesPoint[] {
  const times = runs.map(runTime).filter((n) => !Number.isNaN(n));
  if (times.length === 0) return [];
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(1, max - min);
  const bucketMs = Math.max(1, Math.ceil(span / 24));
  const buckets = new Map<number, { total: number; failed: number }>();
  for (const run of runs) {
    const t = runTime(run);
    if (Number.isNaN(t)) continue;
    const key = Math.floor((t - min) / bucketMs);
    const agg = buckets.get(key) ?? { total: 0, failed: 0 };
    agg.total += 1;
    if (statusBucket(run.status) === "failed") agg.failed += 1;
    buckets.set(key, agg);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, agg]) => ({ bucketIso: new Date(min + key * bucketMs).toISOString(), total: agg.total, failed: agg.failed }));
}
