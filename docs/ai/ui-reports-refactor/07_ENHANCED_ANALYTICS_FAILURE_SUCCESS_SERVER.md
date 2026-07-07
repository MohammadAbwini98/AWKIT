# 07 — Enhanced Failure/Success Analytics + Server Performance

Two routes: `reportsFailures` and `reportsServer`. Built entirely on 04's read model.

## Data sources (verified)

- Outcomes: `runtime_runs.status`/`errorClass`/`reportCategory` (+ legacy JSON
  `ConcurrentRunReport` for pre-v2 runs — join in the query layer, tolerate gaps).
- Step failures: `runtime_node_attempts` (errorClass, retryDecision, tryNumber, sideEffectLevel,
  tracePath/screenshotPath for evidence links).
- Recovery: `runtime_runs.recoverable`/`recoveryNote`, recovery watchdog events
  (`runtime_watchdog_events`, incl. Phase 4 `recoveryAction` rows), manual-handoff resolutions
  (progress events already record handoff waits).
- Retries: attempts with `tryNumber > 1`; retry success = a later attempt of the same node
  succeeded.
- Server: `runtime_capacity_snapshots` + `runtime_process_samples` + storage sizes computed in
  main (artifacts/screenshots/logs dirs from `getConfiguredPaths()`, `runtime.sqlite` file size,
  reports store size) — cached, computed at most once per minute.

## Failure taxonomy

From `src/reports/ReportCategories.ts` (04 §2), mapping the **existing** `ErrorClassifier`
classes; categories: navigation, selector, timeout, assertion, browser-crash, context-closed,
profile-lock, session-expired, auth-handoff-required, network, download-upload, data-binding,
cancelled, unknown. Conservative mapping; `cancelled` is reported as its own category, not a
failure-rate contributor (user intent), but shown in outcome distribution.

## Reports

### 1. Technical Outcome Overview
Cards: successful runs, failed runs, success rate, failure rate, timeout rate, recovered runs,
retry success rate, mean time between failures (per-workflow, in-range). Recovery timing only if
derivable from watchdog/run timestamps — otherwise omit rather than fake.

### 2. Failure Category Breakdown
Donut + trend per category; top workflows per category; top failing nodes/steps (nodeId + label
resolved from the saved flow when still present — deleted flows show the raw id); latest examples
with safe short message + artifact links (`system:openPath`). No raw error walls; truncated
messages, full detail stays in logs/traces.

### 3. Workflow Reliability Ranking
Table: workflow, total runs, success rate, p95 duration, p95 queue wait, retry count, failure
hotspot (top category), `flakinessScore = min(100, round(failureRate×60 + retryRate×25 +
timeoutRate×15))` (documented in tooltip), last failure. Minimum-run threshold (e.g. ≥5 runs)
before a score is shown — avoid branding a workflow flaky off one run.

### 4. Recovery Effectiveness
Recovery attempts vs successes; browser-restart recoveries (Reuse Session / Auto Secure Login
swap events are visible in progress timelines); manual-handoff resolutions; startup-recovery
outcomes (orphaned → re-run / reviewed / abandoned from the Phase 4 recovery actions).

### 5. Server / Process Performance (`reportsServer`)
Electron main memory, host CPU/memory trends, Chromium total memory, disk usage (artifacts / logs
/ screenshots / db / reports store), high-water marks in range, backpressure events
(dispatchBlocked + blockedReason frequency — this is real, already recorded). Availability notice
per 06 for process-level gaps.

### 6. Analytical Insights (deterministic, evidence-based)
Rule-based strings computed from the same aggregates, each with its evidence values inline, e.g.
"Most failures in this window are timeout-related (14 of 22)", "Queue wait rose while
concurrency stayed saturated (avg saturation 96%)". No AI/network calls. Insufficient data → no
insight (never speculate).

## Data safety

Short categories + truncated safe messages only (reuse `SecretMasker`); link to existing
logs/artifacts instead of copying; never store page content; sanitized URLs only (origin+path —
already the runner convention).

## UI style

Design-system cards/charts (02/05): filter chips (range, workflow, category), detail drawers,
subtle status colors, clear empty states, paginated tables.

## Verification

- `npm run build`; `verify:telemetry` extended with taxonomy-mapping and flakiness/insight
  formula unit checks (pure functions — test without Electron).
- Manual: empty state; ≥1 successful and ≥1 failed mock-site run (a failing selector on
  `/form` is an easy controlled failure); time-range filters; drawers + pagination;
  availability-degraded server metrics.
- `npm run verify:runner` (82) unchanged.
