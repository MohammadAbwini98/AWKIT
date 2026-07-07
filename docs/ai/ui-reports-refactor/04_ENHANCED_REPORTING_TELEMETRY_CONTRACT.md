# 04 — Enhanced Reporting Telemetry & Data Contract

The original Prompt 04 assumed this foundation must be created. **Most of it exists.** This file
re-scopes the phase to: extend the existing durable store additively, layer a reporting taxonomy on
the existing classifier, add bounded sampling + retention, and expose read-only windowed queries.

## What already exists (verified — reuse, do not duplicate)

| Pack requirement | Existing implementation |
|---|---|
| Workflow run summary | `runtime_runs` table (`src/runner/store/RuntimeStoreSchema.ts`): instanceId, executionId, scenarioId, status, flowRunStatus, pid, startedAt/endedAt, lastHeartbeatAt, lastKnownUrl, error, errorClass, recoverable, recoveryNote. Plus JSON `ConcurrentRunReport` (`src/reports/ExecutionReport.ts`) with instances, passed/failed/skipped flows, durations, screenshots/downloads. |
| Step/node execution summary | `runtime_node_attempts`: nodeId, tryNumber, status, sideEffectLevel, durations, currentUrl (sanitized), errorClass, retryDecision, tracePath, screenshotPath. |
| Instance sample / heartbeat | `runtime_heartbeats` + `InstanceRuntimeState` (+ `liveProgress` ≤500 steps/≤200 events). |
| Concurrency sample | `runtime_capacity_snapshots`: activeBrowsers/activeFlows/activePages/queueDepth/freeMemoryMb/processRssMb/systemMemoryPercent/cpuPercent/recentCrashes/dispatchBlocked/blockedReason. |
| Server/process sample (host-level) | `ResourceSampler` (`src/runner/concurrency/ResourceSampler.ts`): systemMemoryPercent, processRssMb, cpuPercent, processCpuPercent — never throws. |
| Error classification | `src/runner/runtime/ErrorClassifier.ts` (+ `cancelled`); safety metadata via `StepSafetyPolicy`. |
| Artifacts | `runtime_artifacts` + `RunStateArtifacts` + `TraceService` + screenshots. |
| Live status API | `RuntimeStatusSnapshot` (`src/runner/concurrency/RuntimeStatus.ts`) via IPC `execution:runtimeStatus`. |
| Migrations | `RUNTIME_STORE_MIGRATIONS` (versioned, run-once, recorded in `runtime_migrations`). |

## New work (additive only)

### 1. Migration v2 — reporting extensions (`RuntimeStoreSchema.ts`)

Add a `version: 2, name: "reporting-extensions"` entry:

- `runtime_runs` new columns (SQLite `ALTER TABLE ... ADD COLUMN`, nullable):
  `scenarioName TEXT`, `queueWaitMs INTEGER`, `durationMs INTEGER`, `retryCount INTEGER`,
  `recoveryCount INTEGER`, `reportCategory TEXT` (see taxonomy), `triggerType TEXT`.
  Writers: `ExecutionEngine` at dispatch (queueWait = dispatchedAt − enqueuedAt) and at run end.
- New table `runtime_process_samples` (Chrome/Playwright consumption history, §3):
  `id INTEGER PK`, `timestamp TEXT`, `chromiumProcessCount INTEGER`, `chromiumMemoryMb INTEGER`,
  `chromiumCpuPercent REAL NULL`, `electronMainMemoryMb INTEGER`, `browserContextCount INTEGER`,
  `pageCount INTEGER`, `activeBrowsers INTEGER`, `idleBrowsers INTEGER`,
  `launchesWindow INTEGER`, `restartsWindow INTEGER`, `crashesWindow INTEGER`,
  `availability TEXT` (`full|partial|unavailable`).
- Indexes: `idx_runs_scenario ON runtime_runs (scenarioId, startedAt)`,
  `idx_capacity_ts ON runtime_capacity_snapshots (timestamp)`,
  `idx_process_ts ON runtime_process_samples (timestamp)`,
  `idx_attempts_errorclass ON runtime_node_attempts (errorClass)`.

Backward compatibility: v1 databases upgrade in place; all new columns nullable; readers treat
NULL as "Unavailable". Old JSON reports (`ConcurrentRunReport`) keep loading unchanged —
`ExecutionReports.tsx` compatibility is mandatory.

### 2. Reporting failure taxonomy (map, don't re-classify)

New pure module `src/reports/ReportCategories.ts`: maps existing `ErrorClassifier` classes +
step/node context onto the report taxonomy:
`navigation | selector | timeout | assertion | browser-crash | context-closed | profile-lock |
session-expired | auth-handoff-required | network | download-upload | data-binding | cancelled | unknown`.
Conservative: unmappable → `unknown`. Original error text stays in existing logs/artifacts; reports
store only the category + a truncated safe message (reuse `SecretMasker` from `src/reports/`).

### 3. Per-Chromium-process sampling (new, Windows-first, no native deps)

New `src/runner/runtime/ProcessTreeSampler.ts`:

- Roots: Playwright browser PIDs (`browser.process()?.pid` — already tracked around
  `BrowserProcessManager` / `BrowserWorkerPool`) + `process.pid` (Electron main).
- Enumerate descendants + working-set via one PowerShell CIM query
  (`Get-CimInstance Win32_Process` filtered on ParentProcessId chain) — **no admin needed for the
  app's own child processes**; per-process CPU is derived from two spaced samples of
  `KernelModeTime/UserModeTime` (best-effort, may stay `null`).
- Throttled: one sample per 5 s while ≥1 instance is active, per 30 s idle; skipped entirely if
  the previous sample is still running; failures set `availability: "partial"|"unavailable"` and
  never throw (same contract as `ResourceSampler`).
- Feeds both the live `RuntimeStatusSnapshot` (new optional `processes` field — additive) and
  `runtime_process_samples` (write at most 1 row / 15 s, and only when values changed materially).

### 4. Retention (new, config-ready)

`SqliteRuntimeStore` gains a bounded sweep (invoked from the existing watchdog tick or on init):

- `runtime_capacity_snapshots`, `runtime_process_samples`: keep 24 h raw; optionally roll up to
  per-5-minute aggregates kept 30 days (aggregate table can wait — start with the 24 h cap).
- `runtime_runs` / `runtime_node_attempts`: keep 90 days or last 5,000 runs (whichever smaller).
- Env overrides: `AWKIT_REPORT_RETENTION_HOURS`, `AWKIT_REPORT_RETENTION_RUNS`.
- Never delete user artifacts/screenshots (only DB rows); artifact disk usage is *reported*, not
  cleaned.

### 5. Derived metrics (computed in queries, documented in UI tooltips)

- `parallelismEfficiency = clamp(activeInstanceTimeMs / (maxConcurrency × wallClockWindowMs), 0, 1)`
  — from `runtime_runs` durations + `ConcurrencyConfig.maxActiveFlows` (`AWKIT_MAX_ACTIVE_FLOWS`).
- Pool saturation = activeBrowsers / maxBrowsersPerHost (`AWKIT_MAX_BROWSERS`, default 2).
- Throughput/min, queue-wait p50/p95, duration avg/median/p95 — SQL over `runtime_runs`.
- `flakinessScore = min(100, round(failureRate×60 + retryRate×25 + timeoutRate×15))` (07).

## IPC / preload contract (read-only, additive)

New `app/main/ipc/telemetry.ipc.ts` (registered in `app/main/ipc/index.ts`) + a new
`telemetry` group in `app/main/preload.ts` (typed; `window.playwrightFlowStudio.telemetry.*`):

| Channel | Purpose |
|---|---|
| `telemetry:overview` | `{ range }` → totals, success/failure rates, durations, live counts |
| `telemetry:workflows` | per-scenario aggregates, sortable, `{ range, limit, offset }` |
| `telemetry:workflowDetail` | one scenarioId → trend + recent runs |
| `telemetry:runDetail` | executionId/instanceId → run row + node attempts + artifacts |
| `telemetry:runHistory` | windowed run list `{ range, status?, scenarioId?, limit, offset }` |
| `telemetry:instances` | live distribution (from `executions.list()` data) + history |
| `telemetry:runtimeSeries` | capacity-snapshot time series, bucketed server-side |
| `telemetry:processLive` / `telemetry:processHistory` | Chrome consumption (06) |
| `telemetry:failures` | category breakdown + top workflows/nodes per category (07) |
| `telemetry:server` | host/process performance series + storage sizes (07) |

Rules: all queries windowed/paginated; aggregation in SQL (sql.js), not in the renderer; no
long synchronous work on the IPC thread; every handler catches and returns
`{ ok: false, error }`-style failures so report pages can render error states. Existing
`reports:*` channels remain untouched.

## Runtime safety rules (unchanged from pack, now with anchors)

- Writers hook only existing seams: `ExecutionEngine` run lifecycle, `createProgressReporter`,
  watchdog tick. No hooks inside `StepExecutor` hot paths beyond what exists.
- A telemetry failure must never fail a run — follow the `ResourceSampler` never-throw pattern.
- `AWKIT_DURABLE_STORE=0` (existing) must keep working: telemetry endpoints then return empty
  datasets with a clear `storeDisabled` flag; report pages show an informative empty state.

## Verification

- `npm run build`; `npm run verify:durable-store` (11) extended with: v1→v2 upgrade in place,
  empty-DB queries, retention sweep bounds, NULL-tolerant reads.
- `npm run verify:runtime-status` (15) still passes (snapshot shape is additive).
- New focused verifier `scripts/verify-telemetry.mts` (`npm run verify:telemetry`): seed a temp
  store, write runs/attempts/samples, assert aggregates + pagination + taxonomy mapping.
- One real mock-site workflow run producing a v2 run row end-to-end.
- `npm run verify:runner` (82) unchanged — proves execution semantics untouched.
