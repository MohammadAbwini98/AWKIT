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
  },
  {
    version: 3,
    name: "machine-run-context",
    // Additive only: nullable per-run machine-context columns so reports can be filtered/compared BY
    // machine (cross-machine runs are never silently compared). v1/v2 databases upgrade in place; readers
    // treat NULL as "Unknown". See docs/ai/CONCURRENCY_CAPACITY_AND_REPORTS_PLAN.md §B1.
    statements: [
      `ALTER TABLE runtime_runs ADD COLUMN machineId TEXT`,
      `ALTER TABLE runtime_runs ADD COLUMN logicalCpuCount INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN totalMemoryMb INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN availableMemoryMbAtStart INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN executionMode TEXT`,
      `ALTER TABLE runtime_runs ADD COLUMN browserPoolMode TEXT`,
      `ALTER TABLE runtime_runs ADD COLUMN configuredConcurrency INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN observedPeakConcurrency INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN workloadClass TEXT`,
      `ALTER TABLE runtime_runs ADD COLUMN capacityRecommendationAtRun INTEGER`,
      `CREATE INDEX IF NOT EXISTS idx_runs_machine ON runtime_runs (machineId, startedAt)`
    ]
  },
  {
    version: 4,
    name: "observability-analytics",
    // Additive only (Runtime Observability & Historical Analytics phase). Extends the SINGLE existing store
    // — no separate analytics database (Phase 02). New per-run dimension + environmental-observation columns,
    // plus bounded time-bucket tables for capacity/admission/browser-lifecycle series and an anomaly table.
    // v1/v2/v3 databases upgrade in place; readers treat NULL as "Unavailable". Every environmental resource
    // field is named to make it clear it is an observation AROUND the run window, never exclusive per-workflow
    // ownership under a shared browser pool. See docs/ai/RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md §3.
    statements: [
      // Per-run dimensions resolved at dispatch (Phase 02 run dimensions).
      `ALTER TABLE runtime_runs ADD COLUMN headed INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN resourceProfile TEXT`,
      `ALTER TABLE runtime_runs ADD COLUMN isolationClass TEXT`,
      `ALTER TABLE runtime_runs ADD COLUMN workloadWeight REAL`,
      `ALTER TABLE runtime_runs ADD COLUMN dispatchLatencyMs INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN pressureStateAtRun TEXT`,
      // Per-run ENVIRONMENTAL observation summary (aggregated from the shared host samplers over the run
      // window; NOT exclusive per-workflow resource ownership — see the naming rule in Phase 02).
      `ALTER TABLE runtime_runs ADD COLUMN obsSampleCount INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN obsSystemCpuMean REAL`,
      `ALTER TABLE runtime_runs ADD COLUMN obsSystemCpuP95 REAL`,
      `ALTER TABLE runtime_runs ADD COLUMN obsSystemMemoryMean REAL`,
      `ALTER TABLE runtime_runs ADD COLUMN obsSystemMemoryP95 REAL`,
      `ALTER TABLE runtime_runs ADD COLUMN obsChromiumRssMeanMb INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN obsChromiumRssP95Mb INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN obsAwkitRssMeanMb INTEGER`,
      `ALTER TABLE runtime_runs ADD COLUMN obsAwkitRssP95Mb INTEGER`,
      // Capacity time buckets: bounded periodic aggregate of the capacity/pressure context (Phase 03/05).
      `CREATE TABLE IF NOT EXISTS runtime_capacity_buckets (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         bucketStart TEXT NOT NULL,
         bucketEnd TEXT NOT NULL,
         sampleCount INTEGER NOT NULL,
         cpuMean REAL, cpuP95 REAL, cpuMax REAL,
         memoryMean REAL, memoryP95 REAL, memoryMax REAL,
         awkitRssMeanMb INTEGER, awkitRssP95Mb INTEGER, awkitRssMaxMb INTEGER,
         chromiumRssMeanMb INTEGER, chromiumRssP95Mb INTEGER, chromiumRssMaxMb INTEGER,
         nodeHeapMeanMb INTEGER, nodeHeapMaxMb INTEGER,
         adaptiveTargetMean REAL, adaptiveTargetMin INTEGER, adaptiveTargetMax INTEGER,
         weightedBudgetMean REAL, weightedBudgetMin REAL, weightedBudgetMax REAL,
         activeWeightMean REAL, activeWeightP95 REAL, activeWeightMax REAL,
         activeFlowsMean REAL, activeFlowsP95 REAL, activeFlowsMax INTEGER,
         queuedFlowsMean REAL, queuedFlowsP95 REAL, queuedFlowsMax INTEGER,
         sharedBrowsersMean REAL, sharedBrowsersMax INTEGER,
         contextCountMean REAL, contextCountMax INTEGER,
         pageCountMean REAL, pageCountMax INTEGER,
         weightedAdmissionActive INTEGER
       )`,
      // Admission-delay reason buckets: bounded (time bucket × normalized reason enum). Counts real
      // dispatch-loop block episodes; never inferred later from CPU values (Phase 03/05).
      `CREATE TABLE IF NOT EXISTS runtime_admission_buckets (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         bucketStart TEXT NOT NULL,
         reason TEXT NOT NULL,
         pressureState TEXT,
         count INTEGER NOT NULL
       )`,
      // Browser lifecycle (retirement) reason buckets: periodic deltas of the pool's close-reason counters.
      `CREATE TABLE IF NOT EXISTS runtime_browser_lifecycle_buckets (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         bucketStart TEXT NOT NULL,
         reason TEXT NOT NULL,
         count INTEGER NOT NULL
       )`,
      // Deterministic anomaly/regression events (Phase 06). Only meaningful detections are stored — never a
      // "normal" row per run. `state` supports the dedup/cooldown transition model.
      `CREATE TABLE IF NOT EXISTS runtime_anomalies (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         workflowId TEXT,
         runId TEXT,
         detectedAt TEXT NOT NULL,
         scope TEXT NOT NULL,
         signalType TEXT NOT NULL,
         severity TEXT NOT NULL,
         currentValue REAL,
         baselineValue REAL,
         thresholdRule TEXT,
         windowLabel TEXT,
         sampleCount INTEGER,
         state TEXT NOT NULL,
         note TEXT
       )`,
      `CREATE INDEX IF NOT EXISTS idx_capacity_buckets_ts ON runtime_capacity_buckets (bucketStart)`,
      `CREATE INDEX IF NOT EXISTS idx_admission_buckets_ts ON runtime_admission_buckets (bucketStart)`,
      `CREATE INDEX IF NOT EXISTS idx_admission_buckets_reason ON runtime_admission_buckets (reason)`,
      `CREATE INDEX IF NOT EXISTS idx_lifecycle_buckets_ts ON runtime_browser_lifecycle_buckets (bucketStart)`,
      `CREATE INDEX IF NOT EXISTS idx_anomalies_workflow ON runtime_anomalies (workflowId, detectedAt)`,
      `CREATE INDEX IF NOT EXISTS idx_anomalies_detected ON runtime_anomalies (detectedAt)`
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
  /** Per-run machine context (migration v3; all nullable for pre-v3 rows). */
  machineId?: string;
  logicalCpuCount?: number;
  totalMemoryMb?: number;
  availableMemoryMbAtStart?: number;
  executionMode?: string; // sequential | auto | manual
  browserPoolMode?: string; // shared | dedicated
  configuredConcurrency?: number;
  observedPeakConcurrency?: number;
  workloadClass?: string;
  capacityRecommendationAtRun?: number;
  /**
   * Observability-analytics extensions (migration v4; all nullable for pre-v4 rows). The `obs*` fields are
   * ENVIRONMENTAL observations aggregated from the shared host samplers over this run's window — they are a
   * correlation with the run, NOT exclusive per-workflow resource ownership under a shared browser pool.
   */
  headed?: boolean;
  resourceProfile?: string; // maximum-compatibility | balanced | low-resource | custom
  isolationClass?: string; // SHARED_CONTEXT | DEDICATED_BROWSER | PERSISTENT_BROWSER | HANDOFF_BROWSER
  workloadWeight?: number;
  dispatchLatencyMs?: number;
  /** Adaptive-controller pressure state at dispatch (healthy|stable|pressure|critical) — failure-at-pressure. */
  pressureStateAtRun?: string;
  obsSampleCount?: number;
  obsSystemCpuMean?: number;
  obsSystemCpuP95?: number;
  obsSystemMemoryMean?: number;
  obsSystemMemoryP95?: number;
  obsChromiumRssMeanMb?: number;
  obsChromiumRssP95Mb?: number;
  obsAwkitRssMeanMb?: number;
  obsAwkitRssP95Mb?: number;
  updatedAt: string;
}

/** One bounded capacity time bucket (migration v4 `runtime_capacity_buckets`). Every field nullable-safe. */
export interface DurableCapacityBucketRecord {
  id?: number;
  bucketStart: string;
  bucketEnd: string;
  sampleCount: number;
  cpuMean?: number;
  cpuP95?: number;
  cpuMax?: number;
  memoryMean?: number;
  memoryP95?: number;
  memoryMax?: number;
  awkitRssMeanMb?: number;
  awkitRssP95Mb?: number;
  awkitRssMaxMb?: number;
  chromiumRssMeanMb?: number;
  chromiumRssP95Mb?: number;
  chromiumRssMaxMb?: number;
  nodeHeapMeanMb?: number;
  nodeHeapMaxMb?: number;
  adaptiveTargetMean?: number;
  adaptiveTargetMin?: number;
  adaptiveTargetMax?: number;
  weightedBudgetMean?: number;
  weightedBudgetMin?: number;
  weightedBudgetMax?: number;
  activeWeightMean?: number;
  activeWeightP95?: number;
  activeWeightMax?: number;
  activeFlowsMean?: number;
  activeFlowsP95?: number;
  activeFlowsMax?: number;
  queuedFlowsMean?: number;
  queuedFlowsP95?: number;
  queuedFlowsMax?: number;
  sharedBrowsersMean?: number;
  sharedBrowsersMax?: number;
  contextCountMean?: number;
  contextCountMax?: number;
  pageCountMean?: number;
  pageCountMax?: number;
  /** 1 when weighted admission (A8) was active during the bucket — capacity utilization is only meaningful then. */
  weightedAdmissionActive?: boolean;
}

/** One admission-delay reason bucket (migration v4 `runtime_admission_buckets`). */
export interface DurableAdmissionBucketRecord {
  id?: number;
  bucketStart: string;
  reason: string;
  pressureState?: string;
  count: number;
}

/** One browser-lifecycle (retirement) reason bucket (migration v4 `runtime_browser_lifecycle_buckets`). */
export interface DurableBrowserLifecycleBucketRecord {
  id?: number;
  bucketStart: string;
  reason: string;
  count: number;
}

/** One deterministic anomaly/regression event (migration v4 `runtime_anomalies`). */
export interface DurableAnomalyRecord {
  id?: number;
  workflowId?: string;
  runId?: string;
  detectedAt: string;
  scope: string; // run | regression
  signalType: string;
  severity: string; // info | warning | critical
  currentValue?: number;
  baselineValue?: number;
  thresholdRule?: string;
  windowLabel?: string;
  sampleCount?: number;
  state: string; // active | recovered
  note?: string;
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
