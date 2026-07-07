# 00 — Review Summary: AWKIT UI/UX Refactor + Reports Prompt Pack

Reviewed: 2026-07-07, by Claude (Fable 5), locally, against the real AWKIT working tree
(branch `feature/smart-wait-engine`, heavily modified + uncommitted Phase 5.x release-hardening work).

## Files reviewed (original prompt pack)

Source: `C:\Users\moham\Downloads\awkit-ui-reports-prompt-pack\mnt\data\awkit-ui-reports-prompt-pack\`
(outside the repo — originals preserved, nothing overwritten):

- `00_README_RUN_ORDER.md`
- `01_MASTER_GOAL_PROMPT.md`
- `02_DESIGN_SYSTEM_AND_MOTION.md`
- `03_WORKFLOW_BUILDER_CANVAS_NODES.md`
- `04_REPORTING_TELEMETRY_DATA_CONTRACT.md`
- `05_REPORTS_DASHBOARDS_WORKFLOWS_INSTANCES.md`
- `06_LIVE_RUNTIME_CHROME_CONSUMPTION_RPM.md`
- `07_ANALYTICS_FAILURE_SUCCESS_AND_SERVER_PERFORMANCE.md`
- `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md`
- `09_FINAL_QA_VERIFICATION_AND_HANDOFF.md`

## Codebase areas inspected

- `package.json` (scripts, deps — **no chart lib, no motion lib, no test/lint script**)
- `AGENTS.md`, `CLAUDE.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/ARCHITECTURE.md`,
  `docs/ai/RULES.md`, `docs/ai/HANDOFF.md`
- Renderer: `app/renderer/routes.tsx`, `app/renderer/layout/LeftNavigation.tsx` (nav groups
  Build/Data/Run/System), `AppShell.tsx`, `pages/*` (incl. `ExecutionReports.tsx`, `Dashboard.tsx`,
  `InstanceMonitor.tsx`, `FlowChartDesigner.tsx`, `ScenarioBuilder.tsx`),
  `components/shared/MetricCard.tsx`, `styles/global.css` (single 4,980-line plain-CSS file with
  existing `--space-*` / `--radius-*` tokens)
- Main/IPC: `app/main/ipc/report.ipc.ts`, `execution.ipc.ts` and the full `ipc/` list,
  `app/main/preload.ts` (14 API groups on `window.playwrightFlowStudio`), `app/main/uiSettings.ts`
  (persisted `lastRouteId`)
- Runtime core: `src/reports/ExecutionReport.ts` (`ConcurrentRunReport`),
  `src/runner/store/RuntimeStoreSchema.ts` (durable SQLite schema + versioned migrations),
  `src/runner/concurrency/RuntimeStatus.ts` (`RuntimeStatusSnapshot`),
  `src/runner/concurrency/ResourceSampler.ts`, `src/runner/RunnerProgress.ts`
  (live progress events + bounded snapshot), plus the documented locations of
  `ErrorClassifier`, `BrowserWorkerPool`, `BackpressureController`, `CapacitySnapshot`

## The single biggest correction

The original pack (Prompt 04) assumes the telemetry/persistence foundation must be **created**.
It largely **already exists**:

- `runtime.sqlite` (sql.js WASM, `src/runner/store/SqliteRuntimeStore.ts` +
  `RuntimeStoreSchema.ts`) already durably records **runs** (`runtime_runs` — status, timestamps,
  heartbeat, errorClass, recoverable), **node attempts** (`runtime_node_attempts` — per-step status,
  duration, errorClass, retryDecision, tracePath, screenshotPath), **heartbeats**, **locks/leases**,
  **artifacts**, **cancellations**, **watchdog events**, and **capacity snapshots**
  (`runtime_capacity_snapshots` — activeBrowsers/activeFlows/activePages/queueDepth/freeMemoryMb/
  processRssMb/systemMemoryPercent/cpuPercent/recentCrashes/dispatchBlocked/blockedReason).
- A live runtime status API already exists end-to-end: `ExecutionEngine.getRuntimeStatus()` →
  IPC `execution:runtimeStatus` → preload `executions.runtimeStatus()` → the read-only
  Instance Monitor strip (2 s poll).
- Live per-step progress already exists: `RunnerProgressEvent` → bounded
  `InstanceRuntimeState.liveProgress` (≤500 steps / ≤200 events) → 1 s `executions.list()` poll →
  `LiveExecutionReportModal.tsx`.
- Host resource sampling already exists (`ResourceSampler` — system memory %, process RSS,
  system CPU %, process CPU %) and already gates dispatch.
- Error classification already exists (`src/runner/runtime/ErrorClassifier.ts`, incl. the
  `cancelled` class) and drives the retry policy.
- Final run reports already persist as JSON (`ConcurrentRunReport` via `report.ipc.ts` +
  `createReportStore`), consumed by `app/renderer/pages/ExecutionReports.tsx`.

**Consequence:** the telemetry phase becomes *extend + query*, not *invent*. New work is:
an additive migration (v2) for run-summary/report-query needs (e.g. `queueWaitMs`, workflow name,
error category at run level), a reporting error-category mapping layered on the existing
`ErrorClassifier`, bounded retention for high-frequency samples, per-Chromium-process sampling,
and read-side windowed query IPC.

## Main gaps found in the original prompt pack

1. **No repo-state precondition.** The working tree has extensive uncommitted Phase 5.x work on
   `feature/smart-wait-engine`. Starting a cross-cutting UI refactor on top of that is the highest
   practical risk in the whole initiative. Enhanced plan adds Phase 0: land/commit current work first.
2. **Wrong/ungrounded file paths.** The pack names no real files. Enhanced files name the actual
   routes, pages, IPC channels, stores, and schema files (see per-file docs).
3. **Duplicated-infrastructure risk.** Prompt 04's "create durable entities" would duplicate
   `RuntimeStoreSchema.ts`; Prompt 04's "add a centralized classifier" would duplicate
   `ErrorClassifier`. Corrected to extend both.
4. **Theme contradiction.** Prompt 01 prescribes a **light** surface palette (`#DBDCE0…#F4F4F4`,
   white cards, purple/blue accents) while the run-order message's fallback interpretation says
   "Dark modern SaaS automation UI". The current app is light (`#f4f6f9` background). Enhanced
   design doc makes this an explicit token-first decision: keep light as default, dark becomes an
   optional token theme later. **This needs user confirmation before Phase 2.**
5. **Chart/motion dependency rules too loose.** `docs/ai/RULES.md` forbids new UI frameworks
   without explicit instruction, and offline packaging forbids CDN assets. Enhanced docs default to
   **hand-rolled SVG chart primitives** (sparkline, bar, donut, gauge) and **CSS
   transitions/keyframes** — no new dependency unless explicitly approved.
6. **Administrator-access framing is mostly wrong for Windows.** Enumerating/sampling the app's
   *own* child Chromium processes (the bundled browser is launched by AWKIT) does **not** require
   admin on Windows. The real constraints are *cost* (per-PID CPU sampling via CIM/PowerShell) and
   *no native deps*. Enhanced docs replace "admin required" with an `availability` status
   (`full | partial | unavailable`) and keep a graceful notice.
7. **No pagination/retention specifics.** `runtime_capacity_snapshots` and any new sample tables
   need bounded retention; enhanced telemetry doc specifies windows and a sweep.
8. **Missing verification-script reality.** The pack guesses at scripts. The real ones are the
   `verify:*` family (runner 82, waits 21, concurrency 78, runtime-status 15, flow-designer 19,
   workflow-builder 13, recorder 57, mock-site 28, durable-store 11, packaged-runtime 25,
   packaged-walkthrough 70, …), `npm run build`, `npm run validate:offline`, `npm run ai:memory`.
   There is **no** `npm test` / `npm run lint`.
9. **Mock-site duty omitted.** AGENTS.md requires mock-site scenarios + verifiers for Instance
   Monitor / designer / execution feature changes. Added to phases and QA plan.
10. **Route/navigation mechanics unspecified.** New report pages must extend the `RouteId` union in
    `app/renderer/routes.tsx`, the `routes` array, and `routeGroups` in `LeftNavigation.tsx`;
    persisted `lastRouteId` (`app/main/uiSettings.ts`) must tolerate old/new ids both ways.
11. **Recorder/secure-login safety already stricter than the pack.** The repo has a mandatory
    protected-login handoff model (never automate protected pages); enhanced master goal restates
    it so the UI refactor can't regress those panels.
12. **Order risk: visual canvas refactor placed early.** The Flow Designer / Workflow Builder are
    the most fragile, most-verified surfaces (GUI verifiers exist). Enhanced execution plan moves
    the canvas visual refactor **after** the reports stack is stable, and keeps it token-driven.

## UI design alignment notes

- Dribbble URLs were **not** fetched (offline/local rule); design direction proceeds from the
  pack's palette + the written interpretation. Recorded as a limitation, not a blocker.
- The existing UI is closer to the reference than the pack assumes: white cards, light background,
  left nav with grouped sections, right properties panels, dotted React Flow canvas. The refactor
  is an upgrade (tokens, depth, motion, density), not a rebuild.

## Dependency risks

- Any new npm package must work offline in packaged app.asar and be vetted by
  `npm run validate:offline`; default is **zero new dependencies**.
- Renderer bundle is already ~900 KB with no code-splitting (KNOWN technical debt) — chart pages
  should be mindful; hand-rolled SVG keeps this manageable.

## Final recommendation

**Proceed, with the enhanced pack in this folder, in the order of `09_EXECUTION_PLAN.md`.**
Preconditions before any implementation phase:

1. Land/commit the current `feature/smart-wait-engine` work (Phase 0).
2. User confirms the theme decision (light-first, dark later — recommended) and the
   zero-new-dependency chart/motion approach.
3. Implement telemetry read-model (Phases 2–4) before any dashboard visuals that consume it.
