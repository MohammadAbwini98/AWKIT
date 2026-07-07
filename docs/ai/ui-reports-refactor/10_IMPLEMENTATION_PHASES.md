# 10 — Implementation-Ready Phase Prompts

Copy-paste one phase per agent session (Claude Code / Codex / Gemini). Every phase prompt inherits
this preamble:

> **Preamble (include with every phase):** You are working locally in the AWKIT / WebFlow Studio
> repo. Read `AGENTS.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`, `docs/ai/RULES.md`,
> and `docs/ai/ui-reports-refactor/01_ENHANCED_MASTER_GOAL.md` first, then inspect the actual
> files you will touch (they change between sessions — never trust memory). Make minimal, scoped
> diffs. Do not break existing behavior, required fields, the `window.playwrightFlowStudio`
> contract, offline-first rules, or protected-login safety. Mock/demo data only behind an explicit
> dev flag. After finishing: run the phase's verification commands and report real results; append
> before/after rows to `docs/ai/ui-reports-refactor/08_MAPPING_BINDING_DEPENDENCY_AUDIT.md`
> Section B; update `docs/ai/CURRENT_STATE.md` and append to `docs/ai/TASK_LOG.md`; list files
> changed; list tests not run and why; do NOT continue to the next phase unless asked. Do not
> commit unless the user asks (then use `.claude/skills/git-full-cycle`).

---

## Phase 1 prompt — Baseline audit

Perform the read-only baseline for the UI/reports refactor. Launch the dev app (`npm run dev`;
if launch fails with a blank/odd process, check `ELECTRON_RUN_AS_NODE` is not set in your env —
known gotcha). Capture screenshots of every route in `app/renderer/routes.tsx` into
`docs/ai/ui-reports-refactor/baseline/`. Run and record pass counts: `npm run build`,
`npm run verify:runner`, `verify:flow-designer`, `verify:workflow-builder`,
`verify:instance-monitor`, `verify:runtime-status`. Verify Section A of 08 against the current
code and correct any drift. No code changes.

## Phase 2 prompt — Design tokens + primitives + shell

Implement `02_ENHANCED_DESIGN_SYSTEM_AND_MOTION.md` exactly: add the `--awkit-*` token block to
`app/renderer/styles/global.css` (keep existing `--space-*`/`--radius-*`); create `StatusBadge`,
`SectionHeader`, `SkeletonCard`, `EmptyState`, `TrendDelta`, `AnimatedCounter` in
`app/renderer/components/shared/`; extend `MetricCard.tsx` with optional props only; restyle
`AppShell`/`TopHeader`/`LeftNavigation`/`StatusBar` visually (no behavior change); add the global
reduced-motion block. Plain CSS only; no new dependencies. Verify: `npm run build`, manual
walkthrough of all routes, `verify:flow-designer`, `verify:workflow-builder`.

## Phase 3 prompt — Telemetry read-model

Implement `04_ENHANCED_REPORTING_TELEMETRY_CONTRACT.md` §1–5: additive migration v2 in
`src/runner/store/RuntimeStoreSchema.ts`; retention sweep in `SqliteRuntimeStore.ts`
(env `AWKIT_REPORT_RETENTION_HOURS`/`_RUNS`, document in `.env.example`);
`src/reports/ReportCategories.ts` mapping the existing `ErrorClassifier` classes (never a second
classifier); `src/runner/runtime/ProcessTreeSampler.ts` (PowerShell CIM, throttled, never-throw,
flag `AWKIT_PROCESS_SAMPLING`); wire run-level `queueWaitMs`/`durationMs`/`scenarioName`/
`reportCategory`/`retryCount` writes into `ExecutionEngine` at existing lifecycle seams; add
optional `processes` to `RuntimeStatusSnapshot`. Telemetry failures must never affect runs.
Create `scripts/verify-telemetry.mts` + npm script `verify:telemetry` (temp store: v1→v2 upgrade,
empty-DB queries, retention bounds, taxonomy mapping, sampler tolerance). Verify: `npm run build`,
`verify:telemetry`, `verify:durable-store`, `verify:runner`, `verify:runtime-status`,
`verify:cancellation`, `verify:concurrency`.

## Phase 4 prompt — Report query IPC

Implement the `telemetry:*` channels from 04 in a new `app/main/ipc/telemetry.ipc.ts`, register
in `app/main/ipc/index.ts`, expose a typed `telemetry` group in `app/main/preload.ts` (do not
rename the global). Shared response types in `src/reports/TelemetryContracts.ts`. All queries
windowed/paginated with SQL-side aggregation/bucketing; handle empty DB, `AWKIT_DURABLE_STORE=0`
(`storeDisabled` flag), and per-handler error returns. Extend `verify:telemetry` to cover the
query layer. Verify: `npm run build`, `verify:telemetry`, dev-tools smoke of two channels.

## Phase 5 prompt — Reports shell + Overview

Implement 05 §Navigation + §1: new `RouteId`s + routes (`reportsOverview` first; register the rest
only when their pages exist), new "Reports" group in `LeftNavigation.tsx` (keep the existing
`reports` route as "Run Artifacts" — id unchanged), unknown-`lastRouteId` fallback to `dashboard`
in `App.tsx` if missing. Build `app/renderer/components/reports/` scaffold (`ReportPage`,
`TimeRangeSelector`, `useTelemetryQuery`, `MetricSparkline`, `BarChart`, `DonutChart`) and
`pages/ReportsOverview.tsx` with loading/empty/error/ready states. Verify: `npm run build`;
manual: fresh empty state, then one mock-site run (`npm run mock-site` + a seeded workflow via
`npm run seed:mock-fixtures`) shows real numbers; no console errors.

## Phase 6 prompt — Workflow & instance reports

Implement 05 §2–5: `pages/ReportsWorkflows.tsx` (sortable table via existing
`components/table/TableUI.tsx` conventions, detail drawer, run drill-down with node attempts +
artifact links via `system:openPath`) and `pages/ReportsInstances.tsx` (live distribution reusing
the 1 s poll pattern, history, charts). Register their routes. Old runs missing v2 fields render
"Unavailable". Verify: `npm run build`; manual with successful + failed mock-site runs;
`verify:instance-monitor`; pagination + drawers.

## Phase 7 prompt — Live Chrome consumption

Implement 06: `pages/ReportsChrome.tsx` with `RadialGauge`, `RpmGaugeCard`, `LiveProcessStrip`,
`AvailabilityNotice`, threshold bands via `--awkit-band-*`; single shared 2 s
`executions.runtimeStatus()` poll; tooltips document each metric's source/formula; pulse only on
high band; reduced-motion fallback. No changes to browser launch/session/profile code. Verify:
`npm run build`; `verify:runtime-status`; manual: idle state, live run, kill Chromium mid-run
(no crash), 10-min soak (no leak); `verify:cancellation`.

## Phase 8 prompt — Consumption history + runtime analytics

Implement 06 §3–4 as `pages/ReportsRuntime.tsx` (+ history sections on the Chrome page):
`ConsumptionTimeline` series from `telemetry:runtimeSeries`/`processHistory` (server-side
bucketing), analytical summary (busiest window, peaks, average saturation), concurrency
efficiency + queue pressure charts. Prove retention: seed >24 h-old sample rows and confirm the
sweep removes them. Verify: `npm run build`, `verify:telemetry`, manual after several runs.

## Phase 9 prompt — Failure/success + server analytics

Implement 07: `pages/ReportsFailures.tsx` (outcome overview, category breakdown, reliability
ranking with flakiness score ≥5-run threshold, recovery effectiveness) and
`pages/ReportsServer.tsx` (host/process trends, storage sizes computed ≤1/min, backpressure
events, availability notice). Insight strings deterministic with inline evidence. Formulas as
pure functions unit-checked in `verify:telemetry`. Verify: `npm run build`, `verify:telemetry`,
manual incl. a controlled failing run (bad selector on mock-site `/form`).

## Phase 10 prompt — Designer/Builder visual refactor

Implement `03_ENHANCED_WORKFLOW_BUILDER_CANVAS_NODES.md` exactly, respecting every invariant in
its "Hard invariants" list (ports as card siblings, dirty-snapshot purity, loop button/handles,
`NodeResizer` CSS, saved `EdgeVisualStyle` precedence, required fields). Token-driven CSS +
component-visual changes only; **no** persisted-shape or serializer changes. Verify:
`verify:flow-designer` (19), `verify:workflow-builder` (13), `verify:runner` (82),
`verify:recorder` (57), `verify:mock-site` (28), `npm run build`, plus the manual designer
regression checklist in 12.

## Phase 11 prompt — Motion pass

Unify durations/easings to the motion tokens across new surfaces; add route-content fade; audit
every animation for reduced-motion compliance (OS toggle test) and compositor-only properties;
remove any always-running animation on idle dashboards. Verify: manual + `verify:flow-designer` +
`verify:workflow-builder` + `npm run build`.

## Phase 12 prompt — Mapping/binding audit

Execute `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section C in full against all changed files
(diff the branch to find them). Fix what you find or log it with severity. Deliver: completed
Section B table, issues found/fixed/open, full verifier sweep results, readiness status
PASS / PASS WITH RISKS / FAIL.

## Phase 13 prompt — Final QA + packaging

Run `12_VERIFICATION_AND_QA_PLAN.md` end to end, including `validate:offline`,
`verify:packaged-runtime`, and `verify:packaged-walkthrough` (fresh profile must show clean
empty-state reports). Update `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`, `ARCHITECTURE.md`
(new telemetry/IPC surfaces), `FEATURES.md`. Produce the final handoff report using the exact
structure from the original pack's `09_FINAL_QA_VERIFICATION_AND_HANDOFF.md`, with the honesty
rule: never mark PASS for anything not actually verified.
