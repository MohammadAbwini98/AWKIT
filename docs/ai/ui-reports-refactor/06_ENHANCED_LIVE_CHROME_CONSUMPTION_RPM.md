# 06 — Enhanced Live Chrome/Playwright Consumption + RPM Gauges

Live consumption dashboard (`reportsChrome` route) + history, built on the existing runtime-status
pipeline plus the new `ProcessTreeSampler` (04 §3).

## Existing live pipeline (verified — extend, don't rebuild)

`ExecutionEngine.getRuntimeStatus()` → IPC `execution:runtimeStatus` → preload
`executions.runtimeStatus()` → Instance Monitor strip (2 s poll). `RuntimeStatusSnapshot` already
carries:

- `capacity` (`CapacitySnapshot`): activeBrowsers, activeFlows, activePages, queueDepth,
  freeMemoryMb, processRssMb, systemMemoryPercent, cpuPercent, recentCrashes, dispatchBlocked,
  blockedReason.
- `browserPool` (`BrowserPoolSnapshot`): slots, active/idle browsers, health/crash window.
- `locks` (`LockDebugSnapshot`): profile/origin/account/downloadDir lock counts + stale.
- `watchdog`, `durableLocks`, `recoverableRuns`, `environment` (runtime paths + appMode).

Config limits for saturation math: `ConcurrencyConfig` (`AWKIT_MAX_BROWSERS` default 2,
`AWKIT_MAX_ACTIVE_FLOWS`, `AWKIT_MAX_PER_ORIGIN`, `AWKIT_MAX_PER_ACCOUNT`).

**Additive change:** `RuntimeStatusSnapshot.processes?: ProcessTreeSample` (from
`ProcessTreeSampler`) — chromiumProcessCount, chromiumMemoryMb, chromiumCpuPercent (nullable),
electronMainMemoryMb, per-root breakdown when attributable (browser worker id → instance →
workflow), `availability: "full" | "partial" | "unavailable"`, `availabilityReason`.

## Hard constraints (repo-verified additions)

- Read-only instrumentation only — `BrowserContextFactory`, session/profile behavior, and the
  hardened Chromium launch args (`ChromiumHardening.ts`) are untouched.
- Sampler must never keep Chromium alive: hold PIDs, never process handles/streams; tolerate
  already-exited PIDs mid-sample (processes die during cancellation — proven by
  `verify:cancellation`).
- Polling budget: renderer keeps the existing 2 s runtime-status poll for this page (shared, not
  duplicated); process-tree sampling in main is 5 s active / 30 s idle and skips overlapping runs.
- No admin requirement for the base dashboard: own-child-process enumeration works unprivileged on
  Windows. `availability: partial` covers per-process CPU gaps; `unavailable` covers CIM/PowerShell
  failure — show the notice, keep every non-process metric live.

## Live metrics → sources map

| Metric | Source |
|---|---|
| Configured max concurrency / browsers | `ConcurrencyConfig` (surface in snapshot or env-derived) |
| Active/queued instances | `executions.list()` statuses + `capacity.queueDepth` |
| Pool size, active/idle browsers | `browserPool` |
| Contexts/pages | `capacity.activePages` + pool runtime tracking |
| Profile/origin/account locks | `locks` |
| Launch/restart/crash rates | `browserPool` health/crash window + watchdog events (rate = window count/min) |
| Chromium process count/memory/CPU | `processes` (new) |
| Electron main memory / host CPU+mem | `capacity` (`ResourceSampler`) |
| Saturation/pressure | derived: activeBrowsers/maxBrowsers, queueDepth vs maxActiveFlows, memory vs `AWKIT_MIN_FREE_MEMORY_MB` floor |

Every gauge tooltip states the metric source + formula (mandatory).

## UI components (new, `app/renderer/components/reports/`)

- `RadialGauge` — SVG arc, needle sweep via CSS transform transition; bands 0–60 normal /
  60–85 warning / 85–100 high (`--awkit-band-*` tokens); neutral gray state with reason when
  unavailable; reduced-motion = jump to value.
- `RpmGaugeCard` — gauge + `AnimatedCounter` value + label + tooltip.
- `LiveProcessStrip` — compact process table (kind, memory, CPU or "—", linked
  workflow/instance when attributable); PIDs behind a "technical details" toggle.
- `MetricSparkline` (from 02), `ConsumptionTimeline` (time-series area/line for history),
  `AvailabilityNotice` — replaces the pack's `PermissionNotice`; message: *"Some process-level
  metrics are currently unavailable (reason). Core runtime metrics remain live."* Only mention
  administrator access if the detected failure is actually access-denied.

## Dashboard sections (`reportsChrome`)

1. **Live overview** — active/queued/running cards; pool-saturation gauge; concurrency-usage
   gauge; memory-pressure gauge (system % with the backpressure floor marked); Chromium process
   count card; launch/restart/crash per-minute cards. Pulse animation only when a gauge enters the
   high band.
2. **Process detail** — `LiveProcessStrip`, availability status, environment line (runtime root /
   appMode from `environment` — read-only diagnostics).
3. **Consumption history** — `telemetry:processHistory` + `telemetry:runtimeSeries`: process
   count, memory, CPU, contexts/pages, active/queued instances, launch/restart/crash trend,
   saturation over time (server-side bucketing).
4. **Analytical summary** — busiest window, average saturation, peak memory, peak process count,
   top workflows by attributable consumption. **Observation only** — no automatic runtime tuning.

## Data flow

Live: single shared 2 s poll (`executions.runtimeStatus()`), values memoized; needle updates
CSS-transitioned so 2 s steps look continuous. History: `runtime_process_samples` +
`runtime_capacity_snapshots` with the 04 retention/dedup rules (write ≤1 row/15 s, skip
unchanged values).

## Verification

- `npm run build`; `npm run verify:runtime-status` (15) still green (snapshot additive).
- New checks in `verify:telemetry` (or a focused `verify:process-sampling`): sampler returns a
  shape with all-undefined tolerance, handles dead PIDs, respects throttle, never throws.
- Manual: dashboard with zero instances (all-idle states); during one mock-site workflow run
  (gauges move, process strip populates); kill Chromium mid-run (no crash, availability handled);
  10-minute soak with the page open (no leak — see 12).
- `npm run verify:cancellation` (12) unchanged — sampling doesn't interfere with hard-cancel.
