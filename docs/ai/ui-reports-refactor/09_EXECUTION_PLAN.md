# 09 — Execution Plan

Ordered so stable infrastructure precedes the visuals that depend on it, and so the fragile
canvases are refactored last. One phase per agent session. Copy-paste prompts live in
`10_IMPLEMENTATION_PHASES.md`.

## Phase 0 — Land current work (precondition, user decision)

- **Objective:** clean baseline. Branch `feature/smart-wait-engine` carries extensive uncommitted
  Phase 5.x work (see `git status`); starting a UI refactor on top of it makes regressions
  un-bisectable.
- **Tasks:** user decides: commit/PR the current work per `.claude/skills/git-full-cycle`, then
  branch `feature/ui-reports-refactor` from the landed state.
- **Acceptance:** `git status` clean before Phase 1.
- **Rollback:** n/a.

## Phase 1 — Baseline audit + screenshots

- **Objective:** recorded "before" state.
- **Files:** none (docs only + `docs/ai/ui-reports-refactor/baseline/` screenshots).
- **Tasks:** run the app (`npm run dev`; note: unset `ELECTRON_RUN_AS_NODE` — known agent-env
  gotcha), capture every page; record baseline verifier pass-counts; fill Section A deltas in 08
  if the code moved since this review.
- **Verification:** `npm run build`, `npm run verify:runner`, `verify:flow-designer`,
  `verify:workflow-builder`, `verify:instance-monitor`, `verify:runtime-status` — record counts.
- **Rollback:** n/a (read-only).

## Phase 2 — Design tokens + shared primitives + shell polish

- **Objective:** token layer + reusable primitives; app shell visual upgrade.
- **Files:** `app/renderer/styles/global.css` (tokens per 02), `components/shared/`
  (`StatusBadge`, `SectionHeader`, `SkeletonCard`, `EmptyState`, `TrendDelta`,
  `AnimatedCounter`; extend `MetricCard.tsx` additively), `layout/AppShell.tsx` /
  `TopHeader.tsx` / `LeftNavigation.tsx` / `StatusBar.tsx` (styling only).
- **Dependencies:** Phase 0/1. Theme decision confirmed (light-first).
- **Acceptance:** shell/nav/status visually refreshed; zero functional changes; all pages render;
  reduced-motion block present.
- **Verification:** `npm run build`; manual walkthrough of all 19 routes;
  `verify:flow-designer` + `verify:workflow-builder` (CSS may affect canvases).
- **Rollback:** revert `global.css` + new component files (no schema/IPC surface).

## Phase 3 — Telemetry read-model (04)

- **Objective:** migration v2, `ReportCategories`, retention sweep, `ProcessTreeSampler`,
  run-summary writers.
- **Files:** `src/runner/store/RuntimeStoreSchema.ts` (+`SqliteRuntimeStore.ts` sweep),
  `src/reports/ReportCategories.ts` (new), `src/runner/runtime/ProcessTreeSampler.ts` (new),
  `src/runner/ExecutionEngine.ts` (queueWait/duration/category writes — additive),
  `src/runner/concurrency/RuntimeStatus.ts` (+`processes?`), `.env.example` (new `AWKIT_REPORT_*`).
- **Dependencies:** Phase 0.
- **Acceptance:** v1 DB upgrades in place; runs get v2 fields; sampling bounded; execution
  semantics untouched.
- **Verification:** `npm run build`; `verify:durable-store` (extended); new `verify:telemetry`;
  `verify:runner` 82; `verify:runtime-status` 15; `verify:cancellation` 12; `verify:concurrency` 78.
- **Rollback:** migration v2 is additive — old builds ignore new columns; feature-flag the sampler
  (`AWKIT_PROCESS_SAMPLING=0`).

## Phase 4 — Report query IPC + preload

- **Objective:** windowed read-only `telemetry:*` channels (04 table) + typed preload group.
- **Files:** `app/main/ipc/telemetry.ipc.ts` (new), `app/main/ipc/index.ts`,
  `app/main/preload.ts` (+`telemetry` group), shared types in `src/reports/TelemetryContracts.ts`.
- **Dependencies:** Phase 3.
- **Acceptance:** all channels answer with empty DB, populated DB, and `AWKIT_DURABLE_STORE=0`;
  pagination enforced.
- **Verification:** `npm run build`; `verify:telemetry` (IPC-shape checks can run against the pure
  query layer); manual dev-tools smoke.
- **Rollback:** channels are additive; remove registration.

## Phase 5 — Reports shell + Overview dashboard

- **Objective:** Reports nav group, routes, page scaffold, `useTelemetryQuery`, chart primitives,
  Overview page.
- **Files:** `app/renderer/routes.tsx`, `layout/LeftNavigation.tsx`,
  `app/renderer/components/reports/*` (new), `app/renderer/pages/ReportsOverview.tsx` (new),
  `global.css` additions.
- **Dependencies:** Phases 2 + 4.
- **Acceptance:** Overview live with real + empty data; `lastRouteId` fallback safe.
- **Verification:** `npm run build`; manual (empty + after one mock-site run); no console errors.
- **Rollback:** remove routes/pages (additive).

## Phase 6 — Workflow & instance reports + run drill-down

- **Objective:** `reportsWorkflows` + `reportsInstances` + run detail (05 §2–5).
- **Files:** `pages/ReportsWorkflows.tsx`, `pages/ReportsInstances.tsx`, report components,
  reuse `components/table/TableUI.tsx`.
- **Dependencies:** Phase 5.
- **Acceptance:** drill-down to node attempts + artifacts works; pagination; old-record tolerance.
- **Verification:** `npm run build`; manual with seeded + failed runs; `verify:instance-monitor`.
- **Rollback:** additive pages.

## Phase 7 — Live Chrome consumption + RPM gauges (06)

- **Files:** `pages/ReportsChrome.tsx`, `RadialGauge`/`RpmGaugeCard`/`LiveProcessStrip`/
  `AvailabilityNotice`, shared 2 s poll hook.
- **Dependencies:** Phases 3 + 5.
- **Acceptance:** live gauges during a run; graceful availability degradation; no leak in 10-min soak.
- **Verification:** `npm run build`; `verify:runtime-status`; manual run + mid-run Chromium kill;
  `verify:cancellation`.
- **Rollback:** additive page; sampler flag off.

## Phase 8 — Consumption history + concurrency analytics (06 §3–4, `reportsRuntime`)

- **Files:** `pages/ReportsRuntime.tsx`, `ConsumptionTimeline`, history queries.
- **Dependencies:** Phase 7 (+ retention from Phase 3).
- **Acceptance:** bucketed series over 24 h window; retention sweep proven.
- **Verification:** `npm run build`; `verify:telemetry`; manual after several runs.

## Phase 9 — Failure/success + server performance analytics (07)

- **Files:** `pages/ReportsFailures.tsx`, `pages/ReportsServer.tsx`, insight/flakiness pure
  functions (unit-checked in `verify:telemetry`).
- **Dependencies:** Phase 6.
- **Acceptance:** taxonomy breakdown with real failed runs; deterministic insights; storage sizes.
- **Verification:** `npm run build`; `verify:telemetry`; manual incl. controlled failure run.

## Phase 10 — Flow Designer / Workflow Builder visual refactor (03)

- **Files:** per 03 table (canvases, node cards, panels, palette, `connectorStyle.ts` colors).
- **Dependencies:** Phase 2 tokens; Phases 5–9 done (reports stable first).
- **Acceptance:** 03 acceptance list; all invariants preserved.
- **Verification:** `verify:flow-designer` 19; `verify:workflow-builder` 13; `verify:runner` 82;
  `verify:recorder` 57 (recorded flows render); `verify:mock-site` 28; manual designer regression
  checklist (12).
- **Rollback:** CSS + component-visual diffs only; revert cleanly (no schema change permitted in
  this phase).

## Phase 11 — Motion/animation pass + reduced-motion audit

- **Files:** `global.css`, gauge/counter hooks.
- **Acceptance:** motion consistent; OS reduced-motion honored everywhere; no jank on canvas drag.
- **Verification:** manual + `verify:flow-designer`/`verify:workflow-builder`.

## Phase 12 — Mapping/binding regression audit (08 §C)

- **Output:** completed audit table + readiness status; fixes for found issues.
- **Verification:** full verifier sweep (12).

## Phase 13 — Final QA, performance, packaging (12)

- **Tasks:** full checklist in `12_VERIFICATION_AND_QA_PLAN.md`, `validate:offline`,
  `verify:packaged-runtime`, `verify:packaged-walkthrough` (fresh-profile — proves empty-state
  reports on first run), docs/ai updates, final handoff report (format from original Prompt 09).
- **Acceptance:** PASS / PASS WITH RISKS decision with evidence.
