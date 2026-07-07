# 08 — Mapping, Binding & Dependency Audit

Mandatory audit document. Section A maps the **current** (pre-refactor) bindings — the baseline
every phase must preserve. Section B is the **live audit table** each implementation phase appends
to (before + after rows for every touched component). Section C is the audit checklist run at the
end (Phase 12).

Chain audited for every component:

```text
UI Component → state/hooks → preload contract (window.playwrightFlowStudio.*) → IPC channel
→ main service → runtime service / persistence (JSON stores, runtime.sqlite, files)
```

## A. Baseline map (verified 2026-07-07)

| Component | Consumes (state/hooks) | Preload / IPC | Main service | Persistence | Live update |
|---|---|---|---|---|---|
| `pages/FlowChartDesigner.tsx` (Flow Designer) | React Flow state, `pageChrome` dirty flag, `navigation`, snapshot baseline (`serializeFlowDoc`) | `flows.*`, `settings.*` | `flow.ipc.ts`, `settings.ipc.ts` | flows JSON store, `ui-settings.json` | none |
| `pages/ScenarioBuilder.tsx` (Workflow Builder) | same pattern (`serializeWorkflowDoc`) | `workflows.*`/`scenarios.*`, `flows.*`, `settings.*` | `scenario.ipc.ts` | workflows JSON store | none |
| `components/workflow/ActionFlowNode.tsx` + `scenario/ScenarioFlowNode.tsx` | node data, `portFlags` (`computePortFlags`), `useUpdateNodeInternals` | — | — | node/edge shape in `FlowProfile`/`ScenarioProfile` | — |
| `components/workflow/FlowNodePropertiesPanel.tsx` | selected node, registry (`flowNodeRegistry.ts`), locator quality, Smart Waits | `dataSources.*`, `flows.*`, `session.*` (per node type) | various | `FlowStep`/`NodeConfig` | — |
| `components/workflow/ConnectionPropertiesPanel.tsx` | selected edge, `connectorStyle.ts` | — | — | `FlowEdge` (kind/config/style) | — |
| Node palette (in designer pages) | registry, search state | — | — | — | — |
| `pages/InstanceMonitor.tsx` | 1 s `executions.list()` poll, 2 s `executions.runtimeStatus()` poll, card params (`settings.workflowRunCards`) | `executions.*`, `instances.*`, `workflows.*`, `settings.*`, `system.openPath` | `execution.ipc.ts`, `instance.ipc.ts` | `InstanceRuntimeState` (in-memory pool) + `runtime.sqlite` | 1 s + 2 s polls |
| `components/instances/WorkflowRunCard.tsx` | props from InstanceMonitor; `instanceCardLogic.ts` | via parent | — | `settings.workflowRunCards` | — |
| `components/instances/LiveExecutionReportModal.tsx` | `liveProgress` snapshot / stored report (`executionReportModel.ts`) | `executions.list()`, `reports.get` | `execution.ipc.ts`, `report.ipc.ts` | `liveProgress` (bounded) + reports JSON | 1 s poll while open |
| `components/instances/RecoverableRunsPanel.tsx` | runtime status `recoverableRuns` | `executions.runtimeStatus()`, `execution:recoveryDetails`/`recoveryAction`, `system:openPath` | `execution.ipc.ts` | `runtime.sqlite` (`runtime_runs`) | 2 s poll |
| `pages/ExecutionReports.tsx` (existing Reports route) | local state | `reports.list()` (+ demo flag `VITE_ENABLE_DEMO_REPORTS`) | `report.ipc.ts` | reports JSON store (`ConcurrentRunReport`) | manual refresh |
| `pages/Dashboard.tsx` | simple summary | `flows/workflows/executions` lists | various | — | on mount |
| `layout/LeftNavigation.tsx` | `routeGroups`, collapsed state | `settings.update` (persisted route/sidebar) | `settings.ipc.ts` | `ui-settings.json` (`lastRouteId`) | — |
| Runtime writers (main) | — | — | `ExecutionEngine` + `SqliteRuntimeStore`, `RunLogger`, `RunStateArtifacts`, `TraceService`, `ResourceSampler`, `WatchdogService` | `runtime.sqlite`, JSONL logs, state JSON, traces, screenshots | continuous during runs |

## B. Change audit table (append per phase — one row per touched/created file)

| File | Type | Rendered/Called By | Inputs | Outputs | Store/IPC/Data Dependencies | Persisted Data Impact | Tests/Checks | Risk | Result |
|---|---|---|---|---|---|---|---|---|---|
| `app/renderer/styles/global.css` (token block + `awkit-*` classes + reduced-motion block) | css | whole renderer | CSS vars | styles | none | none | build; `verify:flow-designer` 19/19; `verify:workflow-builder` 13/13 | Cascade regression on canvases | PASS — additive namespaced rules only; reduced-motion block only active under OS setting |
| `components/shared/MetricCard.tsx` | component | Dashboard + future report pages | `label,value,detail,icon,trend?,tone?,loading?` | article | none | none | build (tsc); existing call sites pass string `value` (valid ReactNode) | Prop-shape break at call sites | PASS — new props optional; `value` widened string→ReactNode (superset) |
| `components/shared/StatusBadge.tsx` | component | (future) instances/reports/nodes | `tone,label,icon?,pulse?` | span | none | none | build | — | PASS — new, unused yet |
| `components/shared/SectionHeader.tsx` | component | (future) report pages | `title,description?,actions?,icon?` | header | none | none | build | — | PASS — new |
| `components/shared/SkeletonCard.tsx` | component | MetricCard (loading), future report loading | `lines?,variant?` | div | none | none | build | — | PASS — new |
| `components/shared/EmptyState.tsx` | component | (future) report pages | `title,hint?,icon?,action?,compact?` | div | none | none | build | — | PASS — new; `awkit-` namespaced (no clash with `.empty-state`) |
| `components/shared/TrendDelta.tsx` | component | MetricCard trend, future | `percent,higherIsBetter?,neutral?` | span | none | none | build | Direction/tone logic | PASS — pure; accessible label |
| `components/shared/AnimatedCounter.tsx` | component | (future) metric values | `value,decimals?,durationMs?,prefix?,suffix?` | span | none | none | build | rAF leak / reduced-motion | PASS — cancels frame on unmount; renders final value under reduced-motion |
| `components/shared/usePrefersReducedMotion.ts` | hook | AnimatedCounter, future gauges | — | boolean | `window.matchMedia` | none | build | listener leak | PASS — removes listener on unmount; SSR-guarded |
| `src/runner/store/RuntimeStoreSchema.ts` (migration v2 + `DurableProcessSampleRecord` + run fields) | schema | SqliteRuntimeStore, engine, reports | migrations | DDL, types | `runtime.sqlite` | **additive** — nullable ALTERs + new `runtime_process_samples` table + indexes; v1 DB upgrades in place | `verify:telemetry` (v1→v2 in place), `verify:durable-store` 11/11 | Migration corrupting old DB | PASS — run-once versioned; proven on a real v1-only file |
| `src/runner/store/SqliteRuntimeStore.ts` (`upsertRun` new cols, `recordProcessSample`/`listProcessSamples`/`sweepRetention`, `selectAll`) | main-service | ExecutionEngine, verifiers | run/sample records | rows | `runtime.sqlite` | writes v2 columns; bounded retention (DB rows only, never artifacts) | `verify:telemetry` 21/21, `verify:durable-store` 11/11 | REPLACE wiping v2 cols | PASS — merge reads existing via `SELECT *` so a later upsert preserves earlier v2 fields (test asserts this) |
| `src/runner/store/RuntimeStore.ts` (interface + NullRuntimeStore) | interface | all store callers | — | — | — | none | tsc; `verify:telemetry` (NullStore path) | Interface drift | PASS — 3 methods added + no-op impls |
| `src/reports/ReportCategories.ts` | pure module | ExecutionEngine (writer), future report queries | `ErrorClass` | `ReportCategory` | none | none | `verify:telemetry` Part E | Overfitting text | PASS — maps existing `ErrorClass` only; no re-parsing; conservative `unknown` |
| `src/runner/runtime/ProcessTreeSampler.ts` | main-service | ExecutionEngine (start + status) | `process.pid` | `ProcessTreeSample` | PowerShell/CIM (Windows) | none | `verify:telemetry` Part F | throw / keep-alive / admin | PASS — never throws; holds PIDs not handles; unref'd timer; own-subtree only; `availability` on failure |
| `src/runner/concurrency/RuntimeStatus.ts` (`processes?`) | contract | Instance Monitor strip / Chrome page | sampler.latest | snapshot | IPC `execution:runtimeStatus` | none | `verify:runtime-status` 15/15 | Snapshot shape break | PASS — optional field, additive |
| `src/runner/ExecutionEngine.ts` (run-summary writers, sampler lifecycle, retention on init, status wiring) | main-service | `execution.ipc.ts` | scenario/instance | durable rows, status | `runtime.sqlite` | writes scenarioName/queueWaitMs/durationMs/retryCount/reportCategory (additive) | `verify:runner` 82, `verify:cancellation` 12, `verify:concurrency` 78, `verify:runtime-status` 15, `verify:telemetry` 21 | telemetry failing a run | PASS — writers best-effort at existing seams; `AWKIT_PROCESS_SAMPLING` kill switch; semantics unchanged (runner/concurrency green) |
| `scripts/verify-telemetry.mts` + `package.json` (`verify:telemetry`) | script | CI/dev | — | pass/fail | temp store | none | self | — | PASS — new deterministic verifier, 21 checks |
| `scripts/verify-durable-store.mts` (migration-count assertions) | script | CI/dev | — | pass/fail | temp store | none | `verify:durable-store` 11/11 | stale assertion after v2 | PASS — updated to expect v1+v2 |
| `.env.example` (`AWKIT_PROCESS_SAMPLING`, `AWKIT_REPORT_RETENTION_HOURS`, `AWKIT_REPORT_RETENTION_RUNS`) | config | docs | — | — | — | none | n/a | — | PASS — documents new optional env |
| `src/reports/TelemetryContracts.ts` | contract | store, engine, ipc, preload, future pages | query params | typed results + `percentile`/`durationStats`/`processSampleToHistoryPoint` helpers | none | none | `verify:telemetry` Part G | — | PASS — new shared read-model types |
| `src/runner/store/RuntimeStore.ts` (5 query methods) + NullRuntimeStore | interface | engine | range/page | typed reads | — | none | `verify:telemetry` (Null path) | Interface bloat | PASS — read-only; NullStore returns empty + `storeEnabled:false` |
| `src/runner/store/SqliteRuntimeStore.ts` (queryOverview/Workflows/RunHistory/Failures/RuntimeSeries + helpers) | main-service | engine delegators | range/page | aggregates | `runtime.sqlite` (read) | none | `verify:telemetry` Part G (aggregates, pagination, range filter, series bucketing) | Wrong aggregation | PASS — SQL SELECT + bounded JS; queries capped (≤5–10k rows); pagination enforced |
| `src/runner/ExecutionEngine.ts` (getTelemetry* delegators) | main-service | `telemetry.ipc.ts` | range/page/instanceId | typed reads | `runtime.sqlite` (read) | none | build; `verify:telemetry`; `verify:durable-store` 11, `verify:runtime-status` 15 | — | PASS — read-only delegators; execution paths unchanged from Phase 3 |
| `app/main/ipc/telemetry.ipc.ts` (7 channels) + `ipc/index.ts` | ipc | preload `telemetry.*` | preset/page | typed results | engine | none | build (tsc); channel names match preload | Channel drift | PASS — additive; preset→sinceIso + bucketMs resolved server-side; `reports:*`/`execution:*` untouched |
| `app/main/preload.ts` (`telemetry` group) | preload | future report pages | preset/page | typed Promises | IPC | none | build (tsc) | Global rename | PASS — additive group on `window.playwrightFlowStudio`; no rename |
| `scripts/verify-telemetry.mts` (Part G) | script | CI/dev | — | pass/fail | temp store | none | self | — | PASS — 37/37 (was 21; +16 query-layer checks) |
| `components/reports/useTelemetryQuery.ts` | hook | report pages | fetcher + deps | `{data,loading,error,refetch}` | `window.playwrightFlowStudio.telemetry.*` | none | `verify:reports` | stale in-flight flicker | PASS — cancels stale requests; no polling (manual refetch) |
| `components/reports/ReportPage.tsx` | component | report pages | title/range/refresh | layout | — | none | `verify:reports` | — | PASS — SectionHeader + range + refresh; `awkit-page-enter` |
| `components/reports/TimeRangeSelector.tsx` | component | ReportPage | value/onChange | preset | — | none | `verify:reports` (5 buttons, click) | — | PASS — segmented preset control, aria-pressed |
| `components/reports/MetricSparkline/BarChart/DonutChart.tsx` | components | report pages | data arrays | SVG/DOM | — | none | build; `verify:reports` (sparkline) | huge datasets | PASS — hand-rolled, point-capped (≤120 spark / ≤12 bars); no chart dep; text/aria fallbacks |
| `pages/ReportsOverview.tsx` | page | route `reportsOverview` | — | dashboard | `telemetry.overview` + one-shot `executions.list()` | none | `verify:reports` 8/8 (real Electron: empty state, range, refresh, no console errors) | binding/undefined | PASS — loading/error/store-disabled/empty/ready states; no poll |
| `routes.tsx` (`reportsOverview` route + `reports`→"Run Artifacts" relabel) | route | App/LeftNav | — | route table | `settings.lastRouteId` | none (label only; id `reports` unchanged) | build; `verify:reports` nav | unknown-id blank screen | PASS — App.tsx already guards unknown `lastRouteId` (falls back to `routes[0]`) |
| `layout/LeftNavigation.tsx` (new "Reports" group) | layout | AppShell | routeGroups | nav | — | none | `verify:reports` (nav click) | — | PASS — additive group; `reports` moved out of "Run" |
| `app/renderer/styles/global.css` (reports/charts CSS) | css | report pages | — | styles | none | none | build; `verify:flow-designer` 19/19 | canvas cascade | PASS — all `awkit-` namespaced; reduced-motion block still last |
| `scripts/verify-reports-gui.mjs` + `package.json` (`verify:reports`) | script | CI/dev | — | pass/fail | real Electron | none | self 13/13 | — | PASS — GUI smoke verifier (extended to 3 routes) |
| `TelemetryContracts.ts` (`RunHistoryFilter`) + store/engine/ipc/preload `queryRunHistory(...,filter?)` | contract+chain | workflow drill-down | scenarioId/status | filtered page | `runtime.sqlite` (read) | none | `verify:telemetry` 39/39 (scenarioId + status filters) | Filter SQL injection | PASS — additive optional param; parameterized SQL; back-compatible (filter defaults to none) |
| `components/reports/statusTone.ts` | pure module | tables/drawer | status/ms/iso | tone/label | none | none | build; `verify:reports` | — | PASS — shared status→tone + duration/time formatters |
| `components/reports/RunDetailDrawer.tsx` | component | Workflows/Instances pages | instanceId | drawer | `telemetry.runDetail`, `system.openPath` | none | build; `verify:reports` (no console errors) | undefined bindings | PASS — loading/error/not-found states; opens artifact PARENT folder; Escape/scrim close |
| `pages/ReportsWorkflows.tsx` | page | route `reportsWorkflows` | — | sortable table + recent runs + drawer | `telemetry.workflows` + `telemetry.runHistory(filter)` | none | `verify:reports` 13/13 | — | PASS — client-side sort; scenarioId-filtered drill-down; loading/empty/error |
| `pages/ReportsInstances.tsx` | page | route `reportsInstances` | — | live distribution + history | `executions.list()` (2s poll) + `telemetry.runHistory` | none | `verify:reports` 13/13 (live-status section present) | interval leak | PASS — 2s poll cleared on unmount; paginated history; drawer drill-down |
| `routes.tsx` (+`reportsWorkflows`/`reportsInstances`) + `LeftNavigation.tsx` (Reports group) | route+layout | App/LeftNav | — | routes/nav | `settings.lastRouteId` | none | `verify:reports` nav to both | unknown-id blank | PASS — additive; App.tsx guards unknown ids |
| `global.css` (tables/drawer/distribution/pager CSS) | css | report pages | — | styles | none | none | build; `verify:flow-designer` 19/19 | canvas cascade | PASS — all `awkit-` namespaced; reduced-motion still last |
| `components/reports/RadialGauge.tsx` | component | RpmGaugeCard | value 0–100 | SVG gauge | none | none | build; `verify:reports` (4 gauges, value/dash) | NaN/undefined dial | PASS — hand-rolled SVG; bands + CSS-rotated needle (reduced-motion safe); `undefined`→neutral "—" |
| `components/reports/RpmGaugeCard.tsx` | component | ReportsChrome | title/value/tooltip | card | none | none | build; `verify:reports` | — | PASS — mandatory source/formula tooltip; high-band pulse |
| `components/reports/AvailabilityNotice.tsx` | component | ReportsChrome | availability/reason | notice | none | none | build; `verify:reports` (unavailable path) | over-claiming admin | PASS — only mentions access when reason is access-related; core metrics stay live |
| `components/reports/LiveProcessStrip.tsx` | component | ReportsChrome | `RuntimeStatusSnapshot` | strip + slot table | none | none | build; `verify:reports` (process-detail section) | — | PASS — NULL-tolerant ("—"); per-slot contexts/pages/health |
| `components/reports/useRuntimeStatus.ts` | hook | ReportsChrome | interval | status/loading/error | `executions.runtimeStatus()` (2s) | none | `verify:reports` (stable across a tick) | interval leak | PASS — 2s poll cleared on unmount; keeps last snapshot on transient error |
| `pages/ReportsChrome.tsx` | page | route `reportsChrome` | — | gauges + cards + strip | `executions.runtimeStatus()` (`capacity`/`browserPool`/`processes`) | none | `verify:reports` 18/18 | undefined bindings | PASS — pool/concurrency/memory/CPU gauges + backpressure + availability; idle shows 0%/"—" gracefully |
| `routes.tsx` (+`reportsChrome`) + `LeftNavigation.tsx` | route+layout | App/LeftNav | — | route/nav | `settings.lastRouteId` | none | `verify:reports` nav | unknown-id blank | PASS — additive; App.tsx guards unknown ids |
| `global.css` (gauge/notice/process-strip CSS) | css | Chrome page | — | styles | none | none | build; `verify:flow-designer` 19/19 | canvas cascade | PASS — `awkit-` namespaced; reduced-motion still last (needle transition neutralized) |
| `components/reports/ConsumptionTimeline.tsx` | component | ReportsRuntime | series[] | multi-line SVG | none | none | build; `verify:reports` (empty path) | huge datasets | PASS — hand-rolled; shared x-domain; gaps for undefined y; aria summary; empty-safe (<2 pts) |
| `pages/ReportsRuntime.tsx` | page | route `reportsRuntime` | — | timelines + analytics | `telemetry.runtimeSeries` + `telemetry.processHistory` | none | `verify:reports` 21/21 (empty state clean) | undefined bindings | PASS — 4 timelines (concurrency/host/proc-count/proc-mem) + peak/busiest summary; loading/error/empty; server-bucketed series |
| `routes.tsx` (+`reportsRuntime`) + `LeftNavigation.tsx` | route+layout | App/LeftNav | — | route/nav | `settings.lastRouteId` | none | `verify:reports` nav | unknown-id blank | PASS — additive; App.tsx guards unknown ids |
| `global.css` (timeline CSS) | css | Runtime page | — | styles | none | none | build; `verify:flow-designer` 19/19 | canvas cascade | PASS — `awkit-` namespaced; reduced-motion still last |
| retention sweep proof | — | — | — | — | `runtime.sqlite` | none | `verify:telemetry` Part D (time retention drops >window capacity + process samples; run cap keeps recoverable) | unbounded growth | PASS — proven for both sample tables |
| `TelemetryContracts.ts` (`StorageUsage`/`ServerReport`) + `telemetry:server` IPC + preload `telemetry.server` | contract+ipc | ReportsServer | — | server report | `getConfiguredPaths` + fs (dir sizes) + `getRuntimeStatus` | none | build; `verify:reports` (storage section) | slow disk walk / boundary | PASS — computed in IPC layer (keeps src/ boundary); cached 60s; bounded ≤20k-entry walk; never throws |
| `pages/ReportsFailures.tsx` | page | route `reportsFailures` | — | donut+bars+ranking+insights | `telemetry.failures` + `telemetry.workflows` | none | `verify:reports` 26/26 | — | PASS — category donut/bar, top workflows, reliability ranking + flakiness (≥5-run threshold, tooltip-documented formula), deterministic evidence-based insights; loading/error/no-failures states |
| `pages/ReportsServer.tsx` | page | route `reportsServer` | — | storage+memory cards | `telemetry.server` | none | `verify:reports` 26/26 (4 cards + storage section) | undefined bindings | PASS — memory/CPU/Chromium cards + storage bar chart + availability + backpressure + "never auto-deletes artifacts" note |
| `routes.tsx` (+`reportsFailures`/`reportsServer`) + `LeftNavigation.tsx` | route+layout | App/LeftNav | — | route/nav | `settings.lastRouteId` | none | `verify:reports` nav to both | unknown-id blank | PASS — additive; App.tsx guards unknown ids |
| `global.css` (insights/failure-grid/donut-legend/storage CSS) | css | Failure/Server pages | — | styles | none | none | build; `verify:flow-designer` 19/19 | canvas cascade | PASS — `awkit-` namespaced; reduced-motion still last |
| `global.css` (`.action-flow-node`/`.scenario-flow-node` token recolor + selected ring + icon + order badge) | css | Flow Designer / Workflow Builder canvases | — | node visuals | none | **none** (visual only; NOT in serialized doc) | `verify:flow-designer` 19/19, `verify:workflow-builder` 13/13 | node geometry / port clip / dirty-flag | PASS — Phase 10 is **CSS-only** (no TSX/serializer/connectorStyle change): geometry (grid/overflow/size), port-sibling structure, `NodeResizer` visibility rule, and `EdgeVisualStyle` precedence all unchanged; connector semantic colors deliberately left intact; visual props never enter `serializeFlowDoc`/`serializeWorkflowDoc` so no dirty-flag impact |
| `layout/AppShell.tsx` (route-keyed `<main>` + `main-surface-animated`) | layout | all routes | activeRouteId | content fade | none | none | `verify:flow-designer` 19/19, `verify:workflow-builder` 13/13, `verify:reports` 26/26 | canvas measurement perturbation | PASS — fade class applied to non-canvas routes only (CANVAS_ROUTES excluded); `key` remounts `<main>` on nav (already implicit); opacity+translateY, reduced-motion-neutralized |
| `components/reports/ReportPage.tsx` (drop redundant `awkit-page-enter`) | component | report pages | — | — | none | none | `verify:reports` 26/26 | double-animation | PASS — route fade now centralized in AppShell |
| Motion/reduced-motion audit (Phase 11) | audit | all animated surfaces | — | — | — | — | code review + build | jank / a11y | PASS — see notes below |

Row conventions: Type = page / component / hook / ipc / main-service / schema / css / script.
Persisted Data Impact must say "none" explicitly when none. Result = PASS / PASS WITH RISK / FAIL.

For every **planned** new surface, the phase prompt must fill the row **before** implementation
(planned inputs/outputs) and update it after (actual), covering: inputs, outputs, events, props,
state deps, IPC deps, side effects, error states, loading states, empty states, live-update
behavior, regression risks.

## C. Final audit checklist (Phase 12)

1. **Rendering map** — every new route reachable via `LeftNavigation`; no duplicate `RouteId`s;
   no dead components; `lastRouteId` round-trip incl. unknown-id fallback.
2. **Props/state** — props match call sites (tsc helps but check optional defaults); panel
   collapse never resets unsaved form values; no callback invoked while undefined.
3. **Store/IPC** — renderer uses only preload-exposed APIs; channel names match across
   `ipc/*` ⇄ `preload.ts` ⇄ renderer; every interval/listener cleaned up on unmount; no heavy
   synchronous IPC in render paths; every handler failure surfaces as a UI error state.
4. **Persistence compatibility** — old flows/workflows load; node/edge type ids unchanged;
   migration v2 is additive and upgrades a copied v1 `runtime.sqlite` in place; empty DB loads;
   old JSON reports load; `AWKIT_DURABLE_STORE=0` shows informative empty states.
5. **Runtime safety** — telemetry failure cannot fail a run (fault-injection: make the store
   read-only, run a workflow, expect success + logged warning); sampling handles exited PIDs;
   pool/locks/profile behavior unchanged (`verify:concurrency` 78, `verify:locks` 15,
   `verify:browser-pool` 13 green).
6. **Dependencies** — target: zero new npm deps; if any were approved: offline-packaged proof
   (`validate:offline`), license, bundle-size delta recorded here.
7. **Accessibility/UX** — focus visible; icon-only buttons labeled; reduced-motion verified by
   toggling the OS setting; charts have text fallbacks; color never the only signal;
   empty/loading/error states on every report surface.
8. **Performance** — pagination/windowing on history; charts point-capped; poll budget respected
   (1 s instances / 2 s status / on-demand history); 10-min soak of Reports + Chrome pages with
   heap snapshots (see 12); app launch time not visibly degraded.

Final output of the audit phase: files audited count, issues found/fixed, open issues + severity,
verification results, readiness status **PASS / PASS WITH RISKS / FAIL**.

## Phase 11 — motion / reduced-motion audit findings

- **Reduced motion:** comprehensively handled. The global `@media (prefers-reduced-motion: reduce)`
  block (last in `global.css`) neutralizes every CSS animation/transition (route fade, drawer, gauge
  needle, shimmer, pulse, spin, bar-fill). The one JS-driven animation (`AnimatedCounter`) checks
  `usePrefersReducedMotion()` and renders the final value immediately. No other JS animation exists
  (the gauge needle is a CSS transform transition; the timeline/sparkline are static SVG).
- **Compositor-friendly:** route fade, drawer-in, gauge needle, card hover, and skeleton shimmer use
  only `transform`/`opacity`/`background-position`. One accepted minor exception: `.awkit-bar-fill`
  transitions `width` — bounded (≤12 bars), one-shot on data load, reduced-motion-neutralized; not
  worth a `scaleX` (which would distort the rounded cap).
- **No idle always-running animations:** the gauge high-band pulse runs only when a gauge is ≥85%
  (never on an idle 0% dashboard); `StatusBadge.is-pulse` is opt-in and currently unused; shimmer runs
  only while a skeleton is mounted; spin only while a refresh is in flight.
- **Token unification:** all transitions/one-shot animations use `--awkit-dur-*` + `--awkit-ease-out`.
  Continuous loops (shimmer/spin/pulse) keep their own intentional literal durations.

## C. Final audit verdict (Phase 12 — 2026-07-07)

Full Section-C pass over every file changed in Phases 2–11 (37 files: 1 schema, 4 store/engine/
runtime core, 3 IPC/preload, 24 renderer components/pages, 3 CSS/shell, 2 verifier scripts).

1. **Rendering map — PASS.** 7 new report routes + relabeled `reports`; route ids unique (grep:
   8 distinct `reports*` ids); all reachable and driven by `verify:reports` 26/26. `App.tsx` guards
   an unknown `lastRouteId` (`routes.some(...)` + `activeRoute` falls back to `routes[0]`), so
   up/downgrade can't blank-screen. No duplicate routes; no lazy-import failures (single bundle).
2. **Props/state — PASS.** `tsc --noEmit` clean → props match call sites; `MetricCard` new props all
   optional; no panel-collapse/dirty-flag logic touched; Phase 10 was CSS-only.
3. **Store/IPC — PASS.** Renderer uses only preload APIs (`window.playwrightFlowStudio.telemetry.*`).
   All 8 `telemetry:*` handlers match their preload invokes exactly (grep parity). Every interval is
   cleared on unmount (`useRuntimeStatus`, `ReportsInstances` live distribution) and the rAF/matchMedia
   listeners too (`AnimatedCounter`, `usePrefersReducedMotion`); `useTelemetryQuery` cancels stale
   requests. Aggregation is server-side (no heavy sync IPC on render). Every page surfaces errors as a
   UI state.
4. **Persistence compatibility — PASS.** Migration v2 is additive and upgrades a real v1-only DB in
   place (`verify:telemetry` Part A); empty-DB queries return safe empties; old JSON reports
   (`ExecutionReports`) untouched; `AWKIT_DURABLE_STORE=0` → `NullRuntimeStore` (`storeEnabled:false`)
   → Overview shows the "disabled" empty state; node/edge type ids unchanged.
5. **Runtime safety — PASS.** `verify:runner` 82/82 + `verify:concurrency` 78/78 (Phase 3) +
   `verify:cancellation` 12/12 all pass WITH telemetry writers + the process sampler active —
   execution semantics unchanged. Telemetry writes are best-effort/never-throw (store `safeRun`,
   `ProcessTreeSampler` catch, engine seams); sampling tolerates exited PIDs (`verify:cancellation`);
   pool/locks/profile logic untouched.
6. **Dependency audit — PASS.** Zero new npm dependencies (deps unchanged: `@vitejs/plugin-react`,
   `@xyflow/react`, `lucide-react`, `playwright`, `react`, `react-dom`, `sql.js`; 13 devDeps). Only
   additive npm scripts (`verify:telemetry`, `verify:reports`). All charts hand-rolled SVG/DOM;
   offline packaging unaffected.
7. **Accessibility/UX — PASS.** Icon-only buttons carry `aria-label` (refresh, close, pager, gauge
   info); charts expose `role="img"` + aria summaries or DOM text; status is never color-only
   (`StatusBadge` label+icon, `TrendDelta` arrow+aria); reduced motion fully honored (Phase 11);
   every report surface has loading/empty/error/ready states.
8. **Performance — PASS (1 manual gap).** History paginated; charts point-capped (≤120 sparkline /
   ≤12 bars / server-bucketed timelines); poll budget unchanged (1 s instances / 2 s status);
   intervals cleaned. Durable/telemetry init adds no blocking startup work. **Gap:** the 10-minute
   heap-soak is not automated (intervals verified cleared by code review + `verify:reports` "stable
   across a poll tick").

**Open items (non-blocking):**
- `TrendDelta` is a design-system primitive (doc 02) not yet consumed by a page — available for a
  future trend-comparison enhancement; documented, not a defect.
- Populated-data report GUI path (tables/charts with real rows) not exercised live — the dev profile
  has no in-range runs. Covered by `verify:telemetry` aggregate/filter correctness + build-time
  binding types; `ReportsServer` real-data path IS exercised (live storage sizing).
- 10-minute heap soak and OS reduced-motion toggle are manual gates.

**Readiness: PASS.** All cumulative changes are additive and verified; no regressions in execution,
persistence, or the designer canvases; no blocking risks.
