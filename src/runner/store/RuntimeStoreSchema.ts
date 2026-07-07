/**
 * Durable runtime store schema. The store is a real SQLite database file (via the pure-WASM
 * `sql.js` driver — no native ABI, works in Node 18 tsx verifiers AND Electron 33's Node 20
 * main process, offline once installed). Any external SQLite tool can open the file.
 *
 * Versioned migrations: each entry runs once, recorded in `runtime_migrations`.
 */

export const RUNTIME_DB_FILENAME = "runtime.sqlite";

export interface RuntimeStoreMigration {
  version: number;
  name: string;
  statements: string[];
}

export const RUNTIME_STORE_MIGRATIONS: RuntimeStoreMigration[] = [
  {
    version: 1,
    name: "initial-schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS runtime_migrations (
         version INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         appliedAt TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS runtime_runs (
         instanceId TEXT PRIMARY KEY,
         executionId TEXT NOT NULL,
         scenarioId TEXT,
         status TEXT NOT NULL,
         flowRunStatus TEXT,
         appInstanceId TEXT,
         pid INTEGER,
         startedAt TEXT,
         endedAt TEXT,
         lastHeartbeatAt TEXT,
         lastKnownUrl TEXT,
         error TEXT,
         errorClass TEXT,
         recoverable INTEGER,
         recoveryNote TEXT,
         updatedAt TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS runtime_node_attempts (
         attemptId TEXT PRIMARY KEY,
         instanceId TEXT NOT NULL,
         executionId TEXT NOT NULL,
         flowId TEXT,
         nodeId TEXT NOT NULL,
         tryNumber INTEGER NOT NULL,
         status TEXT NOT NULL,
         sideEffectLevel TEXT,
         startedAt TEXT,
         completedAt TEXT,
         durationMs INTEGER,
         currentUrl TEXT,
         error TEXT,
         errorClass TEXT,
         retryDecision TEXT,
         tracePath TEXT,
         screenshotPath TEXT
       )`,
      `CREATE TABLE IF NOT EXISTS runtime_heartbeats (
         instanceId TEXT PRIMARY KEY,
         executionId TEXT NOT NULL,
         nodeId TEXT,
         browserWorkerId TEXT,
         currentUrl TEXT,
         status TEXT,
         timestamp TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS runtime_locks (
         key TEXT NOT NULL,
         ownerId TEXT NOT NULL,
         mode TEXT NOT NULL,
         units INTEGER NOT NULL,
         version INTEGER NOT NULL,
         pid INTEGER,
         appInstanceId TEXT,
         reason TEXT,
         acquiredAt TEXT NOT NULL,
         expiresAt TEXT,
         releasedAt TEXT,
         stale INTEGER DEFAULT 0,
         staleReason TEXT,
         PRIMARY KEY (key, ownerId, version)
       )`,
      `CREATE TABLE IF NOT EXISTS runtime_leases (
         leaseId TEXT PRIMARY KEY,
         instanceId TEXT NOT NULL,
         kind TEXT NOT NULL,
         ownerId TEXT NOT NULL,
         version INTEGER NOT NULL,
         acquiredAt TEXT NOT NULL,
         expiresAt TEXT,
         releasedAt TEXT
       )`,
      `CREATE TABLE IF NOT EXISTS runtime_artifacts (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         instanceId TEXT NOT NULL,
         executionId TEXT NOT NULL,
         nodeId TEXT,
         attemptId TEXT,
         kind TEXT NOT NULL,
         path TEXT NOT NULL,
         createdAt TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS runtime_cancellations (
         instanceId TEXT PRIMARY KEY,
         executionId TEXT NOT NULL,
         requestedAt TEXT NOT NULL,
         reason TEXT,
         source TEXT,
         completedAt TEXT
       )`,
      `CREATE TABLE IF NOT EXISTS runtime_watchdog_events (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         instanceId TEXT,
         kind TEXT NOT NULL,
         reason TEXT,
         at TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS runtime_capacity_snapshots (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         timestamp TEXT NOT NULL,
         activeBrowsers INTEGER,
         activeFlows INTEGER,
         activePages INTEGER,
         queueDepth INTEGER,
         freeMemoryMb INTEGER,
         processRssMb INTEGER,
         systemMemoryPercent REAL,
         cpuPercent REAL,
         recentCrashes INTEGER,
         dispatchBlocked INTEGER,
         blockedReason TEXT
       )`,
      `CREATE INDEX IF NOT EXISTS idx_attempts_instance ON runtime_node_attempts (instanceId)`,
      `CREATE INDEX IF NOT EXISTS idx_runs_status ON runtime_runs (status)`
    ]
  },
  {
    version: 2,
    name: "reporting-extensions",
    // Additive only: nullable columns + a new samples table + read indexes. v1 databases upgrade in
    // place; readers treat NULL as "Unavailable". See docs/ai/ui-reports-refactor/04_*.
    statements: [
      `ALTER TABLE runtime_runs ADD COLUMN scenarioName TEXT`,
      `ALTER TABLE runtime_runs ADD COLUMN triggerType TEXT`,
      `ALTER TABLE runtime_runs ADD COLUMN queueWaitMs INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN durationMs INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN retryCount INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN recoveryCount INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN reportCategory TEXT`,
      `CREATE TABLE IF NOT EXISTS runtime_process_samples (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         timestamp TEXT NOT NULL,
         chromiumProcessCount INTEGER,
         chromiumMemoryMb INTEGER,
         chromiumCpuPercent REAL,
         electronMainMemoryMb INTEGER,
         browserContextCount INTEGER,
         pageCount INTEGER,
         activeBrowsers INTEGER,
         idleBrowsers INTEGER,
         launchesWindow INTEGER,
         restartsWindow INTEGER,
         crashesWindow INTEGER,
         availability TEXT
       )`,
      `CREATE INDEX IF NOT EXISTS idx_runs_scenario ON runtime_runs (scenarioId, startedAt)`,
      `CREATE INDEX IF NOT EXISTS idx_capacity_ts ON runtime_capacity_snapshots (timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_process_ts ON runtime_process_samples (timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_attempts_errorclass ON runtime_node_attempts (errorClass)`
    ]
  }
];

/** Durable run row (subset the engine reads back for recovery). */
export interface DurableRunRecord {
  instanceId: string;
  executionId: string;
  scenarioId?: string;
  status: string;
  flowRunStatus?: string;
  appInstanceId?: string;
  pid?: number;
  startedAt?: string;
  endedAt?: string;
  lastHeartbeatAt?: string;
  lastKnownUrl?: string;
  error?: string;
  errorClass?: string;
  recoverable?: boolean;
  recoveryNote?: string;
  /** Reporting extensions (migration v2; all nullable for pre-v2 rows). */
  scenarioName?: string;
  triggerType?: string;
  queueWaitMs?: number;
  durationMs?: number;
  retryCount?: number;
  recoveryCount?: number;
  reportCategory?: string;
  updatedAt: string;
}

/** Chrome/Playwright + host consumption sample (migration v2 `runtime_process_samples`). */
export interface DurableProcessSampleRecord {
  id?: number;
  timestamp: string;
  chromiumProcessCount?: number;
  chromiumMemoryMb?: number;
  chromiumCpuPercent?: number;
  electronMainMemoryMb?: number;
  browserContextCount?: number;
  pageCount?: number;
  activeBrowsers?: number;
  idleBrowsers?: number;
  launchesWindow?: number;
  restartsWindow?: number;
  crashesWindow?: number;
  availability?: "full" | "partial" | "unavailable";
}

export interface DurableAttemptRecord {
  attemptId: string;
  instanceId: string;
  executionId: string;
  flowId?: string;
  nodeId: string;
  tryNumber: number;
  status: string;
  sideEffectLevel?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  currentUrl?: string;
  error?: string;
  errorClass?: string;
  retryDecision?: string;
  tracePath?: string;
  screenshotPath?: string;
}

/** Durable artifact row (trace/screenshot/log paths recorded during the run). */
export interface DurableArtifactRecord {
  id?: number;
  instanceId: string;
  executionId: string;
  nodeId?: string;
  attemptId?: string;
  kind: string;
  path: string;
  createdAt: string;
}

export interface DurableCancellationRecord {
  instanceId: string;
  executionId: string;
  requestedAt: string;
  reason?: string;
  source?: string;
  completedAt?: string;
}
