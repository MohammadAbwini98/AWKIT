# 05 — Enhanced Reports Dashboards (Workflows, Runs, History, Instances)

Builds the report UI on the telemetry contract in 04. Zero new dependencies (hand-rolled SVG
charts per 02).

## Navigation & routing (grounded)

- Extend `RouteId` union + `routes` array in `app/renderer/routes.tsx` with:
  `reportsOverview`, `reportsWorkflows`, `reportsInstances`, `reportsRuntime`,
  `reportsChrome`, `reportsFailures`, `reportsServer`.
- Add a new **"Reports"** group to `routeGroups` in `app/renderer/layout/LeftNavigation.tsx`
  (between Run and System). The existing `reports` route (`ExecutionReports.tsx` — raw run
  reports/artifacts list) **stays** and moves into this group as "Run Artifacts" (label change
  only; route id unchanged so persisted `lastRouteId` keeps working).
- `app/main/uiSettings.ts` persists `lastRouteId` as a plain string; the renderer already needs a
  fallback for unknown ids — confirm `App.tsx` falls back to `dashboard` and add it if missing
  (downgrade safety: an old build reading `"reportsOverview"` must not blank-screen).

## Shared page scaffold

New `app/renderer/components/reports/` module:

- `ReportPage` scaffold: `SectionHeader` + `TimeRangeSelector` (15 m / 1 h / 24 h / 7 d — no
  custom range in v1; plain `Date`/`Intl` utilities, no date library) + content grid.
- `useTelemetryQuery(channel, params)` hook: loading/error/empty states, in-flight de-dupe,
  re-fetch on range change, **no polling** on historical pages (manual refresh button);
  live pages poll per 06 conventions.
- Chart primitives from 02 (`MetricSparkline`, `BarChart`, `DonutChart`, `StackedBars`,
  `DistributionBars`), all with text fallbacks.

## Pages

### 1. Reports Overview (`reportsOverview`)

Animated `MetricCard`s (extended per 02): total workflows (from `scenarios.list()` count), total
runs, success rate, failure rate, avg duration, p95 duration, active instances, queued instances,
pool usage, parallelism efficiency (tooltip documents the formula from 04), technical failures in
range. One sparkline row (runs over time). Data: `telemetry:overview` + one `executions.list()`
snapshot for live counts.

### 2. Workflow Reports (`reportsWorkflows`)

Sortable table (reuse `components/table/TableUI.tsx` + its persisted table-state conventions):
per workflow — total runs, success/failed/cancelled/timeout/recovered counts, success-rate trend
sparkline, avg/median/p95 duration, queue-wait trend, retry/recovery counts, last run status
(`StatusBadge`). Row click → Workflow Detail drawer/section (`telemetry:workflowDetail`), which
lists recent runs; run click → Run Detail.

### 3. Workflow Run Detail

For one run (`telemetry:runDetail`): metadata header (status, trigger, instance, duration, queue
wait); queued→started→ended timeline; **node attempts table** (from `runtime_node_attempts`:
nodeId, tryNumber, status, duration bar, errorClass/category, retryDecision); artifact links
(screenshots/traces/logs — open via existing `system:openPath`); failure category + safe short
message. Historical runs missing v2 fields render "Unavailable" cleanly.

### 4. Workflow History (within `reportsWorkflows` or Overview drill)

Run count over time (bars), success/failure stacked bars, duration distribution, queue-wait
distribution, top slow / top failing workflows, failure-category breakdown (donut). All bucketed
server-side (`telemetry:runHistory` / `telemetry:failures`).

### 5. Instance Reports (`reportsInstances`)

Live status distribution cards (data from the existing 1 s `executions.list()` poll — reuse the
Instance Monitor's poll cadence, do not add a second poller on the same page); instance history
table (`telemetry:instances`: durations, queue age, workflow attribution via scenarioId→name
resolve — the resolve helper already exists for the Instance Monitor's Workflow column); duration
and queue-age charts; per-workflow instance distribution; detail drawer linking to the existing
`LiveExecutionReportModal` model where applicable.

## Data-loading behavior (mandatory)

- Empty database → friendly EmptyState ("Run a workflow to see reports"), never a crash — the
  fresh-install packaged walkthrough (`verify:packaged-walkthrough`) must stay green.
- `AWKIT_DURABLE_STORE=0` → informational empty state (store disabled).
- Old records with NULL v2 columns → "Unavailable" placeholders.
- Pagination on all history tables (limit/offset from 04; default 50 rows).
- No aggressive polling: historical = fetch-on-demand; live cards ≤1 poll/s shared per page.
- All intervals/listeners cleaned up on unmount (`useEffect` teardown) — audited in 08.

## Animation

Counter count-up on cards, chart reveal (CSS), card hover lift, skeleton loading, drawer
transitions, route fade — all per 02, all reduced-motion-safe.

## Acceptance criteria

- `npm run build` clean; `npm run verify:telemetry` (new) passes.
- All report pages reachable from the left nav; no duplicate route ids; `lastRouteId` round-trips.
- Empty-data and real-data states verified with at least one completed mock-site run
  (`npm run seed:mock-fixtures` + a manual run, or the dev-mode fixture path).
- No console errors; no memory growth after 10 min open (see 12).
- `ExecutionReports.tsx` (existing reports route) still lists and opens stored reports.
