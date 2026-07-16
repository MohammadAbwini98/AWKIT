# Runtime Observability & Historical Analytics Report

> Deliverable for the AWKIT Runtime Observability & Historical Analytics phase set
> (`AWKIT_RUNTIME_OBSERVABILITY_ANALYTICS_PHASES`). Built up phase by phase.
> **Status: Phases 01–09 implemented + verified; final production-validation complete (2026-07-16) —
> controlled A/B, full 30-min soak, measured storage/query benchmarks, packaged-renderer UI walkthrough.
> Decision: `PRODUCTION-CANDIDATE` (see §16–17). Remaining gate: fresh packaged-EXE build + walkthrough on a
> higher-memory host.**

---

## 1. Executive Summary

This phase extends AWKIT's **existing** durable-runtime telemetry (one SQLite store, one telemetry
contract, one IPC surface, store-side aggregation) with per-run environmental observation summaries,
periodic capacity time buckets, normalized admission-reason analytics, per-workflow historical analytics,
capacity/queue effectiveness indicators, and deterministic resource regression/anomaly detection —
**without** creating a second telemetry subsystem (migration v4 on the same store), per the master overview
and Phase 02. It answers, for each workflow: how often it runs, its success/failure/queue trends, its
duration/queue P50/P95, its environmental resource footprint, its isolation/profile mix, whether a run is
abnormal, and whether it has regressed; and for the runtime: current pressure, why work is queued, adaptive
target / weighted budget / active weight, pool/context counts, and whether the dynamic concurrency system is
near its intended envelope. Every metric is measured or explicitly labelled environmental; no fake or
estimated-as-measured values. New analytics surface through the **existing** Runtime Analytics page (no
redesign); all read models are store-side (the renderer never loads full history). Observability is ON by
default. Final validation (§17) measured its cost with a controlled A/B and a full 30-minute soak: the
per-tick collection cost is negligible (event-loop delay P95 +0.5 ms; CPU within noise), throughput overhead
is small (~1.5–2.5 %, at the boundary of the 2 % target and partly confounded with run-order drift), and the
30-min all-ON soak is leak-free (flat handles, RSS returns to baseline, clean teardown, durable == live).
Storage is ~3 MB/day uncapped and bounded in steady state by retention; analytics queries are tens-to-~500 ms
(not sub-millisecond) at 5 k–50 k runs — acceptable for an async, windowed page. The real
renderer/preload/IPC/store integration is verified across normal/empty/migration/high-data DB states.

---

## 2. Phase 01 — Audit of Existing Telemetry & Reporting

### 2.1 Architecture finding (proven from code)

AWKIT already has a **single authoritative** telemetry/reporting stack. There is **no** duplicated or
parallel telemetry model, and the renderer does **not** compute lifetime totals from paginated history.

| Concern | Location | Notes |
|---|---|---|
| One durable store | `src/runner/store/SqliteRuntimeStore.ts` (real SQLite via `sql.js`) | Single writer, atomic-rename persistence. |
| One schema + versioned migrations | `src/runner/store/RuntimeStoreSchema.ts` | v1 initial, v2 `reporting-extensions`, v3 `machine-run-context`. All additive/nullable. |
| One telemetry contract | `src/reports/TelemetryContracts.ts` | Read-model shapes + `percentile()`/`durationStats()` helpers. |
| One read model | `SqliteRuntimeStore.query*` | `queryOverview`, `queryWorkflows`, `queryWorkflowComparison`, `queryWorkflowTrend`, `queryRunHistory`, `queryFailures`, `queryRuntimeSeries`, `listProcessSamples`, `countRunsByStatus`, `listRunMachines`. SQL SELECT + bounded JS aggregation; windowed/paginated. |
| One IPC surface | `app/main/ipc/telemetry.ipc.ts` → preload `telemetry.*` | `overview/workflows/workflowComparison/workflowTrend/machines/runHistory/runDetail/failures/runtimeSeries/processHistory/server`. |
| Renderer read models | `app/renderer/components/reports/*`, `pages/Reports*.tsx` | Hooks `useTelemetryQuery`/`useRuntimeStatus`; hand-rolled SVG charts. **Totals come from `countRunsByStatus` (unbounded `GROUP BY`), not row pages.** |

**Conclusion:** extend this stack. A new analytics DB is unjustified.

### 2.2 Runtime sampling that already exists (reuse, do not duplicate)

- **`ResourceSampler`** (`src/runner/concurrency/`): system CPU %, system memory %, process RSS, process
  CPU %, **event-loop delay** — single unref'd timer (`AWKIT_RESOURCE_SAMPLE_INTERVAL_MS`, default 2000).
  Feeds `BackpressureController.admit` and `CapacitySnapshot`. Kept **in memory** (latest sample); not a
  persisted time series on its own.
- **`ProcessTreeSampler`** (`src/runner/runtime/ProcessTreeSampler.ts`): Chromium subtree process count +
  Chromium RSS + Electron-main RSS via one Windows CIM query, 5 s, unref'd, never-throws, skips overlapping
  ticks. Per-process CPU intentionally **not** collected (needs two spaced CIM reads — too expensive).
  **Persisted** every tick to `runtime_process_samples` via `ExecutionEngine` (`recordProcessSample`,
  `ExecutionEngine.ts:479–484`).
- **`SharedBrowserPool.snapshot()`** (`src/runner/browser/`): live browsers, contexts-per-browser,
  dedicated vs shared, `closeReasons` (`CONTEXT_COUNT_RECYCLE | MEMORY_THRESHOLD | IDLE_DRAIN | UNHEALTHY |
  CRASH | POOL_SHUTDOWN | LAUNCH_FAILURE | OTHER`), `launchFailures` — **in-memory counters only**.
- **`AdaptiveController`** (`adaptiveTarget`, `adaptiveState`) and A8 weighted admission
  (`activeWeightedCost`, `weightedBudget`) — computed live in `ExecutionEngine`; **not persisted**.

### 2.3 Telemetry inventory

Legend: ✅ yes · ⚠️ partial · ❌ no.

| Metric / Statistic | Collected | Persisted | Aggregated | Displayed | Source |
|---|---|---|---|---|---|
| System CPU % | ✅ | ⚠️ run-end capacity snapshot + process-sample-adjacent | ✅ `queryRuntimeSeries` | ✅ Reports/server | `ResourceSampler` → `CapacitySnapshot.cpuPercent` |
| System memory pressure % | ✅ | ⚠️ run-end only | ✅ | ✅ | `ResourceSampler` |
| AWKIT (Electron main) RSS | ✅ | ✅ `runtime_process_samples.electronMainMemoryMb` | ⚠️ | ✅ process history | `ProcessTreeSampler` |
| Node heap | ❌ | ❌ | ❌ | ❌ | — (only `process.memoryUsage().rss`, not `heapUsed`) |
| Chromium RSS | ✅ | ✅ periodic `runtime_process_samples` | ⚠️ list only | ✅ process history | `ProcessTreeSampler` |
| Browser count | ✅ | ✅ (process samples `activeBrowsers`) + run-end snapshot | ✅ `queryRuntimeSeries` | ✅ | pool / capacity |
| BrowserContext count | ✅ (`CapacitySnapshot.activeContexts`) | ⚠️ run-end snapshot only; `runtime_process_samples.browserContextCount` column exists but is **not populated** | ⚠️ | ⚠️ | capacity snapshot |
| Page count | ✅ (`activePages`) | ⚠️ run-end + `pageCount` column often NULL | ⚠️ | ⚠️ | capacity snapshot |
| Adaptive target | ✅ (`CapacitySnapshot.adaptiveTarget`) | ❌ **no DB column** in `runtime_capacity_snapshots` | ❌ | ⚠️ live status strip only | `AdaptiveController` |
| Pressure state | ✅ (`adaptiveState`) | ❌ no column | ❌ | ⚠️ live only | `AdaptiveController` |
| Weighted budget | ⚠️ computed live, not on snapshot | ❌ | ❌ | ❌ | A8 (`ExecutionEngine`) |
| Active weight | ⚠️ computed live | ❌ | ❌ | ❌ | A8 (`ExecutionEngine`) |
| Admission block reason | ⚠️ **free-text** `lastBlockedReason` (numbers inlined) | ❌ not persisted as events/buckets | ❌ | ⚠️ live status only | `BackpressureController.block()` |
| Queue wait | ✅ `runtime_runs.queueWaitMs` | ✅ | ⚠️ avg only (no per-workflow P50/P95 yet) | ✅ | `ExecutionEngine` |
| Dispatch latency | ❌ (not separated from queue wait) | ❌ | ❌ | ❌ | — |
| Workflow duration | ✅ `durationMs` | ✅ | ✅ P50/P95 | ✅ | `ExecutionEngine` |
| Success/failure/cancel | ✅ `status` + `reportCategory` | ✅ | ✅ `countRunsByStatus` | ✅ | run lifecycle |
| Retry count | ✅ `retryCount` | ✅ | ✅ | ✅ | `ExecutionEngine` |
| Browser close reason | ✅ pool counters | ❌ in-memory only | ❌ | ❌ | `SharedBrowserPool` |
| Resource profile (balanced/low-resource/…) | ✅ resolved per run | ❌ not on run row | ❌ | ❌ | `BrowserRuntimeConfigurationResolver` |
| Isolation class (shared/dedicated/persistent/handoff) | ✅ resolved per run | ⚠️ only coarse `browserPoolMode` (shared/dedicated) on run row | ⚠️ | ⚠️ | `BrowserIsolationResolver` |
| Headed/headless | ✅ known per run | ❌ not a dedicated run column | ❌ | ❌ | run config |
| Workload class (light/medium/heavy) | ✅ | ✅ `runtime_runs.workloadClass` (v3) | ⚠️ | ⚠️ | A8 |
| Machine context (cpu/mem/mode/pool/cap) | ✅ | ✅ v3 columns | ✅ comparison/trend filters | ✅ | `buildMachineRunContext` |

### 2.4 Gap classification

| Gap | Classification | Planned home |
|---|---|---|
| Per-run **environmental** CPU/mem/Chromium-RSS mean/P95 during the run window | needs new stored per-run summary (aggregate existing samples over `[startedAt, endedAt)`) | Phase 02/03 |
| Periodic **capacity time buckets** (snapshot persisted only at run end today) | needs periodic bucketed persistence | Phase 03/05 |
| **Adaptive target / pressure state / weighted budget / active weight** over time | needs snapshot columns + bucket fields | Phase 03/05 |
| **Admission reason** normalization + counts | needs bounded enum (map today's free-text) + reason buckets from the real dispatch loop | Phase 03/05 |
| **Browser lifecycle** close-reason history | needs bucketed counters (pool already produces them) | Phase 02/05 |
| Per-run **resource profile / isolation class / headed** columns | one new stored field each (already resolved per run) | Phase 02/04 |
| Node heap | needs one periodic sample field (`process.memoryUsage().heapUsed`) — cheap | Phase 03 |
| Per-workflow **queue-wait P50/P95**, isolation/profile distribution, admission-delay frequency | store-side read-model methods over existing + new columns | Phase 04 |
| **Anomaly / regression detection** | entirely new, deterministic rules over the above | Phase 06 |

### 2.5 Rejected / unreliable measurements (honesty constraints)

- **Per-workflow CPU/RAM ownership under shared browsers is NOT reliably attributable.** With the pool ON,
  many workflows share Chromium processes; the runtime cannot attribute a process's CPU/RSS to one
  workflow. Per Phase 02, run-level resource fields will be named as **environmental** observations
  (`observedSystemCpuDuringRun`, `observedChromiumRssDuringRun`, …), never `workflowCpu`.
- **Per-process Chromium CPU** is deliberately not sampled (cost). Host-level CPU from `ResourceSampler`
  is used instead — already documented in `ProcessTreeSampler`.
- **`MEMORY_THRESHOLD` browser recycling is inert** on Playwright 1.61 (no per-`Browser` `process()` →
  empty memory samples). Close-reason analytics must reflect that `MEMORY_THRESHOLD` ≈ 0 today.

### 2.6 Recommended minimal extension points

1. New migration **v4** (additive): per-run observation-summary columns on `runtime_runs` **or** a
   `runtime_run_observations` table; `resourceProfile`/`isolationClass`/`headed` run columns;
   `adaptiveTarget`/`adaptiveState`/`weightedBudget`/`activeWeight` columns on
   `runtime_capacity_snapshots`; new `runtime_capacity_buckets`, `runtime_admission_buckets`, and
   `runtime_browser_lifecycle_buckets` (or counters) tables; `runtime_anomalies` table (Phase 06).
2. Reuse the **existing samplers** — accumulate per-run summaries and periodic buckets from
   `ResourceSampler` / `ProcessTreeSampler` / pool + capacity snapshots. **No new polling loop.**
3. Add a normalized `AdmissionReason` enum and record decisions from the **real** dispatch loop
   (`ExecutionEngine.processQueue` + `BackpressureController`), not inferred later from CPU values.
4. Extend `TelemetryContracts.ts` + `SqliteRuntimeStore` read methods + `telemetry.ipc.ts`; surface via the
   **existing** Reports/Instance-Monitor UI (Phase 07). No new dashboards, no redesign.

### 2.7 Phase 01 completion

Complete: the current telemetry/reporting architecture is proven from code, the inventory and gaps are
classified, and **no new observability subsystem has been created** yet.

---

## 3. Observability Data Model (Phase 02)

One authoritative model, **extending the existing SQLite store** — migration **v4** (`observability-analytics`),
additive/nullable only (`src/runner/store/RuntimeStoreSchema.ts`). No separate analytics database.

**Run dimensions + environmental summary** — new nullable columns on `runtime_runs`: `headed`,
`resourceProfile`, `isolationClass`, `workloadWeight`, `dispatchLatencyMs`, `pressureStateAtRun`, and the
per-run environmental observation summary `obsSampleCount` + `obsSystemCpu{Mean,P95}` +
`obsSystemMemory{Mean,P95}` + `obsChromiumRss{Mean,P95}Mb` + `obsAwkitRss{Mean,P95}Mb`.

**Bounded time-bucket tables** — `runtime_capacity_buckets` (CPU/mem/Chromium-RSS/AWKIT-RSS/node-heap +
adaptive target, weighted budget, active weight, active/queued flows, shared browsers, contexts, pages —
mean/P95/min/max as applicable, `weightedAdmissionActive` flag), `runtime_admission_buckets`
(`bucketStart × reason × pressureState → count`), `runtime_browser_lifecycle_buckets`
(`bucketStart × closeReason → count`), and `runtime_anomalies`.

**Semantic honesty (measured vs environmental):** every host-resource field carries the
`observed…DuringRun` / environmental naming so it is unmistakably a **correlation around the run window**,
never exclusive per-workflow ownership under a shared browser pool. Direct per-workflow CPU/RSS attribution
is explicitly **not** claimed (Phase 01 §2.5). Bounded enums: `AdmissionReason` (10 values),
`PressureState`, `BrowserCloseReasonName` (`src/reports/ObservabilityContracts.ts`).

**Compatibility/migration:** v1/v2/v3 DBs upgrade in place; pre-v4 rows read the new columns as NULL
("Unavailable"/"Unknown"). Proven by `verify:observability` Part A + `verify:telemetry` (v1→v2→v3→v4 in-place).

## 4. Collection & Persistence Architecture (Phase 03)

**Reuses the existing samplers — no new polling loop.** `RuntimeObservationCollector`
(`src/runner/runtime/RuntimeObservationCollector.ts`, pure) is fed by the engine's existing
`ProcessTreeSampler` tick (every ~5 s). Each tick pushes one shared sample + live capacity context into
(a) every active run's accumulator and (b) the current capacity bucket. It starts no timers and does no OS
scan of its own.

- **Per-run summary** — `startRun` at dispatch, `finalizeRun` at terminal state (in the `runInstanceInner`
  `finally`, so completion/failure/cancel/crash all finalize). Written into the run row's `obs*` columns.
- **Capacity buckets** — rolled every `AWKIT_OBSERVABILITY_BUCKET_MS` (default **30 s**, clamped 5 s–5 min),
  and force-flushed on execution drain so teardown loses nothing.
- **Admission reasons** — recorded from the **real dispatch loop** (`ExecutionEngine.processQueue` +
  `BackpressureController`) on each block *episode* (transition), normalized to the enum — never inferred
  later from CPU. Covers backpressure, weighted-budget (A8), and origin/account blocks.
- **Browser lifecycle** — periodic deltas of `SharedBrowserPool.snapshot().closeReasons`.
- **Node heap** — `process.memoryUsage().heapUsed` added to the sample (cheap; was the one missing field).

**Failure safety:** all collection is wrapped best-effort (`collectObservationTick`, `recordAdmissionDelay`,
`finalizeRunObservation`, `runAnomalyChecks`) — a collector/store fault leaves columns NULL and never fails a
run. Persistence errors surface through the store's existing `warn` diagnostic.

## 5. Measured Runtime Overhead (Phase 03 + final A/B, §17.1)

Measured by a **controlled OFF-vs-ON A/B** (3×A + 3×B, Config D, MIXED, concurrency 6, interleaved
A→B→B→A→A→B; `AWKIT_RUNTIME_OBSERVABILITY=0` disables ONLY the incremental collection/persistence). The
per-tick collection cost — one bucket accumulation per existing sampler tick (O(active runs), bounded arrays)
plus one small SQLite insert per 30 s bucket window and one per admission episode — is **negligible**:
**event-loop delay P95 +0.5 ms** (the lowest-variance, most trustworthy signal) and **CPU P95 +2 pts**
(within run-to-run noise). **Throughput is ~1.5–2.5 % lower** with observability ON (median −1.53 %, mean
−2.5 %), at the boundary of the 2 % target and partly confounded with a monotone run-order decline. The
memory delta could **not** be cleanly isolated: within-config drift (the OFF config's own AWKIT-RSS P95 spans
180→344 MB across reps, SD 69 MB) is >6× the between-config mean delta (+10 MB), so the < 20 MB RSS target is
neither cleanly met nor missed by the A/B — the leak-free 30-min soak (§17.2) is the load-bearing memory
evidence. Do not call the overhead "negligible" without qualification: it is negligible per-tick, small on
throughput. Bucket cadence (30 s) keeps a 24 h window to ~2 880 rows. Full method + tables in §17.1.

## 6. Per-Workflow Historical Analytics (Phase 04)

`src/reports/observabilityAggregation.ts` (pure) + `SqliteRuntimeStore.queryWorkflowHistoricalStats /
…HistoricalTrend / queryRunVsHistory / queryWorkflowRankings`. Store-side, windowed — the renderer never
scans full history. Per workflow: total/success/failure/cancel, success/failure/retry rate, duration &
queue-wait P50/P95, environmental CPU/mem/Chromium-RSS summaries (labelled environmental), avg workload
weight, admission-delay run-rate (queue-wait proxy), and headed / resource-profile / isolation-class
distributions. Trend auto-selects hour/day/week from the range. Rankings: most-executed, slowest-P95,
highest-failure-rate, longest-queue-wait, highest-observed-Chromium-RSS, highest-admission-delay. Totals use
aggregate-exact counts; percentiles use the complete documented window.

## 7. Capacity & Queue Effectiveness Analytics (Phase 05)

`computeCapacityAnalytics` over the capacity/admission/lifecycle buckets + run rows. **Explainable, separate
indicators — no opaque 0–100 score:**

- **Adaptive-target utilization** = `activeFlows ÷ adaptiveTarget`.
- **Capacity utilization** = `activeWeight ÷ weightedBudget`, surfaced **only when weighted admission was
  active** (`weightedAdmissionActive`).
- **Queue pressure** = observed queue-depth mean/max.
- **Admission reason breakdown** = counts + percentages by normalized enum.
- **Failure-at-pressure** = failure rate grouped by the actual `pressureStateAtRun`.
- **Browser-pool effectiveness** = contexts per shared browser, shared/dedicated ratio, close-reason
  distribution, total retirements.

Window means are sampleCount-weighted across buckets; a window "P95" is the bucketed-P95 **ceiling** (max of
bucket P95s) — documented as such (raw per-sample percentiles aren't recoverable from aggregated buckets).
Environmental metrics are labelled `env` in the UI. No RAM-saved-per-workflow claim is made without a
comparable baseline.

## 8. Resource Regression & Anomaly Detection (Phase 06)

`src/runner/runtime/AnomalyDetector.ts` — **deterministic, no AI/LLM**, every rule documented and
config-driven (`DEFAULT_ANOMALY_CONFIG`).

- **Run-level** (vs the workflow's 30-day history, minimum 8 prior runs): duration ≥ 2.5× median (≥ 4× →
  critical), queue-wait ≥ 1.5× P95, failure when historical failure rate < 10 %, retry above P95, observed
  CPU mean ≥ history + 25 pts, observed Chromium RSS ≥ history × 1.4.
- **Regression** (recent 7 d vs previous 7 d, min 10 runs each window): duration P95 +30 %, failure rate
  +15 pp, queue-wait P95 +50 %, Chromium RSS P95 +40 %, admission delays +100 % & +10 abs.
- **Severity** info/warning/critical; CPU peaks never alone yield critical.
- **Dedup/cooldown/recovery:** `reconcileRegressions` suppresses duplicates within a 6 h cooldown and emits
  a single `recovered` transition when a signal clears — only meaningful events are stored (no per-run
  `normal` row). Fired after each run finalizes (run-level) + throttled to 5 min/workflow (regression).

All rules proven on synthetic datasets in `verify:observability` Part F (insufficient-history no-alert,
normal-variation no-alert, duration + failure regression, recovery clears, duplicate-storm suppressed).

## 9. Reporting / UI Integration (Phase 07)

Additive IPC (`telemetry:capacityAnalytics / workflowHistoricalStats / workflowHistoricalTrend / runVsHistory
/ workflowRankings / anomalies / observabilitySummary`) → preload `telemetry.*` → the **existing** Runtime
Analytics page (`app/renderer/pages/ReportsRuntime.tsx`). **No redesign, no new nav.** Added, using existing
panels + design tokens: a live **Current runtime** strip (pressure, adaptive target, weighted budget/active
weight, browsers/contexts/pages, current admission reason), a **Capacity & queue effectiveness** panel
(explainable metrics + admission-reason table + failure-at-pressure), and an **Anomalies & regressions**
panel. Queries are async, windowed, paginated store-side; loading/empty/error states reused. Environmental
metrics are visibly tagged.

## 10. Retention & Storage Growth (Phase 08)

Per-table windows (`SqliteRuntimeStore.sweepRetention`, on durable init) — **not one blanket unit**: raw
capacity/process samples keep the 24 h raw window (`AWKIT_REPORT_RETENTION_HOURS`); observability **buckets**
keep 14 days (`AWKIT_OBSERVABILITY_BUCKET_RETENTION_DAYS`, small aggregated rows → multi-week comparisons
stay possible); anomalies keep 90 days (`AWKIT_ANOMALY_RETENTION_DAYS`, sparse + high value). Insert-time
safety ceilings bound each table (capacity 60 000, admission/lifecycle 20 000). **Measured** growth (§17.3,
`benchmark:observability-storage`): ~465 bytes/run, 322 bytes/capacity-bucket, ~237 bytes/anomaly; at 5 000
runs/day + 30 s buckets the uncapped projection is **~3.1 MB/day** (not the earlier ~1 MB/day estimate), 22 MB
/ 7 d, 81 MB / 30 d, 214 MB / 90 d. **Retention bounds the steady-state size** far below those uncapped
projections (runs capped by `retentionRuns`, buckets 14 d, anomalies 90 d — all validated at their cutoff
boundaries, incl. interrupted-run survival). Indexes added for every measured query pattern
(`idx_capacity_buckets_ts`, `idx_admission_buckets_ts/_reason`, `idx_lifecycle_buckets_ts`,
`idx_anomalies_workflow/_detected`) and confirmed used by `EXPLAIN QUERY PLAN` (§17.3).

## 11. Query Performance (Phase 08 + final benchmark, §17.3)

All analytics are SQL SELECT over the bounded windowed row set + bounded JS aggregation. **Measured** warm
P95 (25 queries/size; §17.3): index-served lookups are sub-ms (anomalies list ~1 ms, status counts ~4–8 ms,
run-history first page 6–20 ms), but the **run-aggregating analytics are tens-to-~500 ms, not
sub-millisecond**: overview 149→250 ms, workflow summary 138→464 ms, capacity analytics 248→509 ms, workflow
rankings ~150→475 ms, run-history deep page 29→524 ms across 5 k→50 k runs. These are **aggregation-bound**
(JS over the windowed rows), not missing-index bound — `EXPLAIN QUERY PLAN` confirms the bucket/anomaly
queries use their indexes; adding indexes would not help JS-side aggregation, so none were added
speculatively. The latencies are acceptable for an **async, windowed** analytics page (all queries are
off-the-render-thread, paginated store-side, and bounded by retention), but the prior "sub-millisecond" claim
was wrong and is corrected. Totals come from unbounded `COUNT(*) … GROUP BY` aggregates; percentiles use the
complete window; no full-history load reaches the renderer.

## 12. Soak Test (Phase 09 + full 30-min gate, §17.2)

The **full 30-minute** Config-D soak (shared pool + A8 weights + Adaptive + Backpressure + observability ON,
MIXED, real `ExecutionEngine`, `AWKIT_SOAK_MS=1800000 npm run benchmark:engine-soak`, concurrency 6) is
complete (`reports/browser-performance/soak-30min.json`):

- completed **4661**, failed **0**, retries **0**, browser crashes **0**, page crashes **0**.
- AWKIT RSS 352→358 MB (+1.7 %, P95 394, peak 433); Node heap 250→187 MB (sawtooth); Chromium RSS 958→847 MB
  (**down**, P95 1426); active handles 52→53 (peak 99); event-loop delay P95 36.8 ms, peak 44.5 ms.
- observability: 58 capacity + 86 admission + 56 lifecycle buckets, 201 anomalies; **4666 run summaries == 4666
  durable terminal runs → MATCH**; 0 persistence/query errors; SQLite 0.6→25 MB.
- browsers 3→3 (peak 4); relaunched 95 = closed 95 (`CONTEXT_COUNT_RECYCLE` 92, `IDLE_DRAIN` 3); launch
  failures 0; stale leases 0.
- durable completed 4661 = live 4661; teardown **CLEAN** (active/leased/orphan-context/orphan-pages/
  orphan-Chromium all 0).

**Drift (first third → last third):** active handles flat (51→51), AWKIT RSS returns to baseline (end 358 ≈
start 352; the +27.9 % third-over-third is high-water + GC sawtooth, not monotone leak), Chromium RSS −10 %,
analytics-query latency 34→145 ms (grows with the accumulating table, **data-bounded not a time-leak**;
retention caps it in steady state). **Leak-free by every load-bearing signal.** Two soak-harness accounting
bugs were found and fixed (`durableTerminalRuns` omitted `cancelled`; a NaN event-loop sample poisoned the
max) and confirmed on a re-run — neither was an observability defect (§17.2).

## 13. Verification

Green: `npm run build` (tsc + 3 bundles); **`verify:observability` 65/65** (schema/migration/null-safe,
reason normalization, collector, aggregation, run-vs-history, capacity analytics, anomaly + regression rules,
store round-trip, retention); **`verify:telemetry` 61/61** (strengthened to assert v4 in-place upgrade);
`verify:runner` 82/82 (real Chromium through the observability-hooked lifecycle); `verify:concurrency` 78/78;
`verify:concurrency-defaults` 18/18; `verify:shared-browser-pool` 19/19; `verify:browser-isolation` 27/27.
No existing assertion was weakened.

**Final production-validation runs (2026-07-16):** controlled A/B `benchmark:observability-ab` (3A+3B, §17.1);
full 30-min `AWKIT_SOAK_MS=1800000 benchmark:engine-soak` (§17.2); `benchmark:observability-storage`
(5k/25k/50k + query plans + retention boundaries, §17.3); **`verify-runtime-analytics-gui.mjs` 36/36** — the
real built Electron (out/) driven across normal/empty/migration/high-data seeded DB states, all 7 IPC channels
(incl. malformed inputs) exercised through the live preload bridge, no page/console errors, no NaN/undefined,
screenshots captured (§17.5). The two soak-harness accounting bugs found here are fixed in
`scripts/benchmark-engine-soak.mts`.

## 14. Changed Files

- `src/runner/store/RuntimeStoreSchema.ts` — migration v4 + record types.
- `src/runner/store/SqliteRuntimeStore.ts` — v4 upsert columns, bucket/anomaly writes+reads, analytics
  queries, per-table retention.
- `src/runner/store/RuntimeStore.ts` — interface + NullRuntimeStore stubs.
- `src/reports/ObservabilityContracts.ts` *(new)* — contracts + admission-reason/pressure enums + normalizers.
- `src/reports/observabilityAggregation.ts` *(new)* — pure per-workflow + capacity aggregation.
- `src/runner/runtime/RuntimeObservationCollector.ts` *(new)* — pure streaming collector.
- `src/runner/runtime/AnomalyDetector.ts` *(new)* — deterministic anomaly/regression rules.
- `src/runner/ExecutionEngine.ts` — collector wiring, admission-reason capture, per-run finalize + dimensions,
  anomaly hooks, telemetry getters, observability summary, retention params.
- `app/main/ipc/telemetry.ipc.ts` + `app/main/preload.ts` — 7 additive channels.
- `app/renderer/pages/ReportsRuntime.tsx` + `app/renderer/styles/global.css` — Current-runtime strip,
  capacity-effectiveness panel, anomalies panel (token-only).
- `scripts/verify-observability.mts` *(new)* + `package.json` (`verify:observability`);
  `scripts/verify-telemetry.mts` (v4 assertion).

## 15. Remaining Risks

- Environmental resource attribution is a correlation, not ownership — clearly labelled (`ENV` tag, verified in
  the UI). Per-workflow **queue-delay** frequency uses a queue-wait proxy and is labelled as such; admission
  **reasons** are surfaced only as runtime-global ("Runtime admission delays … not per-workflow", verified in
  the UI). No metric or label claims per-workflow admission-reason attribution (§17.4).
- `MEMORY_THRESHOLD` browser recycling stays inert on Playwright 1.61 (no per-`Browser` PID); its lifecycle
  count reads 0 by design.
- **Packaged-EXE UI validation is a remaining gate.** The real renderer/preload/IPC/store integration is
  verified against the current-code **dev build** (`out/`, the production renderer bundle) via `_electron`
  (§17.5); the shippable `dist/` EXE is pre-observability (Jul 7) and a fresh package OOMs on this 16 GB host
  (`KNOWN_ISSUES`). Re-package on a higher-memory host and re-run the walkthrough against the EXE.
- **A/B RSS overhead is unresolved** (within-config drift ≫ between-config delta); the leak-free 30-min soak is
  the stronger memory evidence. A tighter A/B (more reps, fixed per-rep warm-up) would yield a precise RSS
  number — deferred, as the load-bearing per-tick signal (event-loop delay) is already clean.
- **Anomaly thresholds are heuristic defaults** (deterministic + unit-tested, but the numeric cutoffs — 2.5×
  median duration, etc. — are not yet calibrated against real production incident history).
- Capacity-window "P95" is a bucketed ceiling, not a raw percentile (documented).
- Analytics-query latency grows with accumulated data (data-bounded, retention-capped) — see §11/§17.3.

## 16. Production Recommendation

**Status: `PRODUCTION-CANDIDATE` — remaining gate: fresh packaged-EXE build + UI walkthrough on a
higher-memory host.** Everything else is validated with measured evidence (§17): controlled A/B overhead, a
clean full 30-min soak, measured storage/query behaviour, accurate workflow admission semantics, and the real
renderer/preload/IPC/store integration across five DB states. The feature is safe to ship ON by default;
the outstanding item is validating the same UI on a *packaged* EXE (the current package predates this work and
re-packaging OOMs on the 16 GB dev host — not an observability defect).

- **New observability is ON by default** (rides the existing process sampler; disable the incremental work
  with `AWKIT_RUNTIME_OBSERVABILITY=0`, or all process sampling with `AWKIT_PROCESS_SAMPLING=0`).
- **Sampling cadence:** existing ~5 s process-sampler tick (reused, no new loop).
- **Bucket size:** 30 s (`AWKIT_OBSERVABILITY_BUCKET_MS`, 5 s–5 min).
- **Retention:** raw samples 24 h; observability buckets 14 days; anomalies 90 days (all env-tunable) —
  boundary-validated (§17.3).
- **Anomaly minimum history:** 8 runs (run-level), 10 runs/window (regression); 6 h regression cooldown.
- **Overhead (measured, §17.1):** per-tick negligible (event-loop delay P95 +0.5 ms); throughput ~1.5–2.5 %;
  RSS not cleanly resolvable by the A/B but leak-free over 30 min.
- **Provisional / experimental items** (not "none"): (1) anomaly numeric thresholds are heuristic defaults
  pending calibration against real incident history; (2) a precise A/B RSS-overhead figure (variance-limited);
  (3) packaged-EXE UI walkthrough. None blocks default-ON operation; each is listed so the claim stays honest.

---

## 17. Final Production-Validation Evidence (2026-07-16)

Machine: 12 logical CPU / 16 GB, Windows. All runs use the real `ExecutionEngine` against the local mock site,
offline. Artifacts under `reports/browser-performance/` (gitignored): `observability-ab.json`,
`soak-30min.json`, `observability-storage.json`, `phase5-ui-evidence/*.png`.

### 17.1 Controlled Observability Overhead A/B

**Method.** Same workload run 6× with interleaved order **A→B→B→A→A→B** to cancel warm-up/thermal bias.
Config D (shared pool + A8 weights + Adaptive + Backpressure), MIXED, concurrency 6, 120 s hold/run.
Configuration **A (OFF)** sets `AWKIT_RUNTIME_OBSERVABILITY=0` — this disables **only** the incremental
observability collection/persistence (buckets, run summaries, anomalies); the essential resource samplers
required for backpressure stay on. Configuration **B (ON)** is the production default. Asserted each run:
OFF wrote **0** observability rows, ON wrote 444; flag resolved correctly every rep; all teardowns clean.

| Metric | OFF (A) mean · median | ON (B) mean · median | Mean Δ | Verdict |
|---|---:|---:|---:|---|
| Throughput/min | 190.4 · 183.3 | 185.7 · 180.5 | −4.7 (−2.5 %) | small; ≤~2.5 %, confounded w/ drift |
| Event-loop delay P95 (ms) | 25.7 · 26.1 | 26.2 · 26.0 | **+0.5** | **negligible** (lowest-variance signal) |
| CPU P95 (%) | 57.3 · 62.2 | 59.4 · 57.2 | +2.1 | within noise (SD 6–8) |
| AWKIT RSS P95 (MB) | 249.7 · 225 | 260 · 273 | +10.3 | **unresolvable** — see below |
| Node heap P95 (MB) | 188.7 · 164 | 226 · 202 | +37.3 | unresolvable — GC sawtooth |

**Variance caveat (why RSS is unresolvable).** Across its 3 reps the OFF config's own AWKIT-RSS P95 spanned
**180 → 344 MB** (SD 69 MB) and throughput declined monotonically in run order (212.7 → 200.7 → 180.5 → 183.3
→ 175.2 → 175.9 = machine warm-up/thermal drift). The between-config RSS mean delta (+10 MB) is well under one
SD of within-config drift, so the A/B **cannot certify** the < 20 MB RSS target either way. The dependable
conclusions: **per-tick cost is negligible** (event-loop delay +0.5 ms, CPU within noise) and **throughput
overhead is small (~1.5–2.5 %)**. The `observability-ab.json` "AWKIT RSS +48 MB" headline is a
median-of-reps artifact of where reps fell on the drift curve, not a real 48 MB cost.

### 17.2 Full 30-Minute Production Soak

Command `AWKIT_SOAK_MS=1800000 npm run benchmark:engine-soak` (Config D, observability ON, MIXED,
concurrency 6, 15 s snapshots). Full results in §12. Headlines: **4661 completed / 0 failed / 0 crashes**;
teardown CLEAN (active/leased/orphan-context/orphan-page/orphan-Chromium/stale-lease all 0); durable == live;
**4666 run summaries == 4666 terminal runs (MATCH)**; 0 persistence/query errors. Drift: active handles flat
(51→51), AWKIT RSS end ≈ start (352→358), Chromium RSS down — **leak-free**. Analytics-query latency rose
34→145 ms as the store grew 0.6→25 MB (data-bounded, retention-capped; not a leak).

**Two soak-harness accounting bugs found + fixed** (`scripts/benchmark-engine-soak.mts`; neither an
observability defect): (1) `durableTerminalRuns = completed+failed` omitted the `cancelled` runs produced by
teardown `stopAll()`, causing a spurious run-summary "MISMATCH" — now recomputed post-teardown incl.
`cancelled`; (2) a NaN event-loop-delay sample poisoned `Math.max` → `peak=NaN` — now a NaN-safe `peakOf()`.
Both fixes were confirmed on a 40 s re-run (`runSummaries=203/203 MATCH`, numeric peak) and the corrected
30-min figures (run summaries 4666/4666, event-loop peak 44.5 ms) are used above.

### 17.3 Storage Growth & Query Performance

`benchmark:observability-storage` builds deterministic DBs at 5 k / 25 k / 50 k runs (each + 14 d of
capacity/admission/lifecycle buckets @ 30 s + 90 d sparse anomalies, realistic distributions).

**Measured size / per-unit cost:** ~465 bytes/run, 322 bytes/capacity-bucket, ~237 bytes/anomaly. The
fixed 14-day capacity-bucket set is ~12.4 MB regardless of run count; total DB 15.6 MB (5 k) → 24.5 MB (25 k)
→ 35.7 MB (50 k). **Uncapped projection @ 5000 runs/day + 30 s buckets: ~3.1 MB/day**, 22 MB/7 d, 81 MB/30 d,
214 MB/90 d — **retention bounds the steady-state size** well below these. Retention cutoff boundaries all
validated (capacity 14 d, admission 14 d, anomaly 90 d, raw sample 24 h; interrupted run survives).

**Warm query P50/P95 (ms) by dataset size (25 reps):**

| Query | 5k P50/P95 | 25k P50/P95 | 50k P50/P95 | Rows |
|---|---:|---:|---:|---:|
| Overview | 137.6/149.0 | 207.7/224.6 | 232.9/249.7 | 1 |
| Run-history first page | 3.5/6.2 | 10.7/13.1 | 18.0/19.8 | 50 |
| Run-history deep page | 27.2/28.9 | 232.5/261.0 | 507.3/524.3 | 50 |
| Workflow summary | 129.4/138.2 | 359.7/377.1 | 433.5/463.8 | 1 |
| Workflow 30-day trend | 38.9/44.9 | 231.5/240.3 | 339.2/345.5 | ~30 |
| Workflow rankings | 141.7/150.0 | 399.3/438.7 | 445.2/475.7 | 10 |
| Capacity analytics | 208.6/248.4 | 447.5/462.3 | 503.7/509.2 | 1 |
| Admission-reason breakdown | 9.8/11.4 | 9.6/10.0 | 8.7/9.2 | 3000 |
| Lifecycle breakdown | 4.7/6.4 | 4.5/6.8 | 4.4/5.0 | 2000 |
| Anomalies list | 0.8/1.0 | 0.9/10.5 | 0.7/0.9 | 100 |
| Failure breakdown | 126.7/134.6 | 351.1/364.2 | 425.7/451.5 | 1 |

Index-served bucket/anomaly queries stay flat and fast; run-aggregating analytics scale with the run window
(JS aggregation) into the tens-to-~500 ms band — **acceptable for an async, windowed page, but not
sub-millisecond**. `EXPLAIN QUERY PLAN` confirms bucket/anomaly queries use `idx_*_ts` / `idx_anomalies_*`;
run-history `ORDER BY` uses a temp b-tree (the deep-page cost). No speculative indexes added — the cost is
aggregation-bound, not index-bound.

### 17.4 Workflow Admission Semantics

Outcome: **accurate renaming (the honest alternative), not fabricated per-workflow reason attribution.**
Admission *reasons* are a global runtime decision; the code surfaces them only as runtime-global
(`totalAdmissionDelays`, "Runtime admission delays … **not per-workflow**", verified in the UI, §17.5).
Per-workflow data is a **queue-delay** proxy — `queueDelayRunRate` / `queueDelays` / the `highest-queue-delay`
ranking — explicitly documented as "not admission-reason attribution" in `ObservabilityContracts.ts`. No API
contract, metric, or UI label claims per-workflow admission-reason causation. Environmental resource metrics
are `ENV`-tagged in the UI ("not exclusive per-workflow ownership").

### 17.5 Packaged-Renderer UI Validation

Method: `_electron.launch` on the **current-code built app** (`out/main` + `out/preload` + the production
`out/renderer` bundle) — the strongest available local method, since the shippable `dist/` EXE predates this
work and a fresh package OOMs on the 16 GB host. Each state points `LOCALAPPDATA` at a pre-seeded runtime DB
(`scripts/seed-observability-fixtures.mts`) and restores directly onto the Runtime Analytics route.

`node scripts/verify-runtime-analytics-gui.mjs` → **36/36 checks**:

| State | Result |
|---|---|
| **normal** (400 runs, 1600 buckets) | page renders; Capacity panel populated ("1600 buckets · 16824 samples"), admission-reason table + `ENV` tags + "not per-workflow" label present; no NaN/undefined; no page/console errors; all 7 IPC channels resolve (range=all & 24h); malformed inputs safe |
| **empty** (fresh DB) | clean empty-state copy ("No runtime history in this range yet"); no crash, no endless spinner, no NaN; IPC channels resolve on empty windows |
| **migration** (pre-v4 DB, 40 legacy runs) | v4 applied on open; legacy history visible; new fields render as unavailable, not failing; no errors |
| **high-data** (20 000 runs) | page responsive; Capacity panel populated ("2874 buckets · 30362 samples"); run lists paginate store-side (no full-history load); no layout break |

All four capture screenshots (`reports/browser-performance/phase5-ui-evidence/`). The seven additive IPC
channels were validated through the live preload bridge including malformed/adversarial inputs
(`anomalies("not-a-range", -5)`, `workflowRankings(range, "nonsense-metric", 9999)`,
`capacityAnalytics(undefined)`) — all handled safely with no throw across the IPC boundary and no internal
stack traces surfaced.

### 17.6 Production Status

**`PRODUCTION-CANDIDATE`.** Validated: controlled overhead (per-tick negligible, throughput ≤~2.5 %), a
leak-free full 30-min soak, measured storage (~3 MB/day, retention-bounded) and query performance
(tens-to-~500 ms, acceptable), accurate admission semantics, and the real UI/IPC/store integration across five
DB states. **Remaining gate:** fresh packaged-EXE build + the same walkthrough against the EXE on a
higher-memory host. **Provisional:** anomaly numeric thresholds (uncalibrated against real incidents) and a
precise A/B RSS-overhead figure. None blocks shipping observability ON by default.
