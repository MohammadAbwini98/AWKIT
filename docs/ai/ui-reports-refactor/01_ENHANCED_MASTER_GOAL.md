# 01 — Enhanced Master Goal: AWKIT UI/UX Refactor + System Reports

Refined master prompt for the whole initiative. Use it as the umbrella context for every
implementation phase in `10_IMPLEMENTATION_PHASES.md`. Work locally only; no GitHub, no commits,
unless the user explicitly asks.

## Product context (verified)

AWKIT / **WebFlow Studio** is an offline-first Electron 33 + React 18 + TypeScript + Playwright 1.49
Windows desktop app. Renderer talks to main **only** via `window.playwrightFlowStudio.*`
(`app/main/preload.ts`, 14 groups: `system, auth, offlineRuntime, settings, flows, workflows,
scenarios, executions, instances, dataSources, runtimeInputs, reports, recorder, session`).
Styling is a single plain-CSS file `app/renderer/styles/global.css`. Canvases use `@xyflow/react`.
Icons are `lucide-react`. There is **no chart library and no motion library**.

A durable runtime layer already exists: `runtime.sqlite` (`src/runner/store/`) with runs, node
attempts, heartbeats, locks, artifacts, cancellations, watchdog events, and capacity snapshots;
live runtime status via `execution:runtimeStatus`; live per-step progress via
`InstanceRuntimeState.liveProgress`; host sampling via `ResourceSampler`; error classes via
`src/runner/runtime/ErrorClassifier.ts`; final run reports as JSON `ConcurrentRunReport`
(`src/reports/ExecutionReport.ts` + `app/main/ipc/report.ipc.ts`).

## Goal

1. **UI/UX refactor** to a premium automation-platform look (Dribbble-inspired; original AWKIT
   design system — no copied assets): design tokens, app shell polish, refined Flow Designer /
   Workflow Builder canvas/nodes/connectors/panels, consistent motion language.
2. **Professional reports & analytics** on top of the existing durable runtime data:
   - workflow run statistics + history; per-run drill-down (node attempts already exist);
   - instance reports and live status distribution;
   - concurrency/parallelism efficiency (from capacity snapshots + browser pool);
   - live Chrome/Playwright consumption with animated RPM-style gauges + history;
   - technical failure/success analytics on the existing error classes;
   - server/process performance (Electron main + Chromium processes) with graceful degradation.

## Hard constraints (all verified against the repo)

- **Keep every existing required field and behavior**: node config fields
  (`FlowNodePropertiesPanel.tsx` + `flowNodeRegistry.ts`), workflow definitions, connector
  structure rules (`validateConnectorStructure`), recorder controls, instance cards, run
  parameters, Recoverable Runs panel, runtime status strip, protected-login handoff panels.
- **Refactor UI without breaking automation logic.** Runner/orchestrator/locks/pool/durable-store
  semantics change only when a report metric strictly requires an additive, documented hook.
- **Reports show real runtime data only.** Mock/demo data exclusively behind an explicit dev flag
  (existing convention: `VITE_ENABLE_DEMO_REPORTS` in `ExecutionReports.tsx`); never mixed with
  real records. Empty states for fresh installs (RULES.md: no demo data as real records).
- **Offline-first**: no CDN/remote fonts/scripts; new dependencies only with explicit approval and
  `validate:offline` proof; mutable data only under `%LOCALAPPDATA%/WebFlow Studio/`
  (or configured Settings paths); never write to `resources/`/`app.asar`.
- **Do not rename `window.playwrightFlowStudio`** or existing IPC channel names. New channels are
  additive, registered in `app/main/ipc/*` **and** typed in `app/main/preload.ts`.
- **Additive schema changes only.** New durable tables/columns via a new entry in
  `RUNTIME_STORE_MIGRATIONS` (`src/runner/store/RuntimeStoreSchema.ts`). JSON profile schemas keep
  backward compatibility (optional fields + defaults on read). Old `runtime.sqlite` files and old
  JSON reports must still load; missing fields render as "Unavailable".
- **Never bypass CAPTCHA/MFA/bot-detection/security controls.** Preserve the protected-login and
  recorder secure-login handoff model exactly (see `docs/PROTECTED_LOGIN_HANDOFF.md`,
  `docs/ai/SECURITY.md`). Mask secrets everywhere; reports store short, safe error labels and link
  to existing artifacts instead of duplicating logs.
- **Telemetry must never block or fail execution.** Writers are best-effort, bounded, throttled;
  reporting failures are logged and swallowed (existing pattern: `ResourceSampler` never throws).
- **Keep TypeScript clean** — `npm run build` (= `tsc --noEmit` + electron-vite) must pass after
  every phase. There is no `npm test` / `npm run lint`.
- **Plain CSS only** in `global.css` (tokens + component classes). No CSS-in-JS, no Tailwind, no
  component framework. Motion via CSS transitions/keyframes with `prefers-reduced-motion` support.
- **Incremental and verifiable.** One phase per session; run the phase's verify commands
  (see `12_VERIFICATION_AND_QA_PLAN.md`); update `docs/ai/CURRENT_STATE.md` + `docs/ai/TASK_LOG.md`
  after every phase; update mock-site scenarios + verifiers when Instance Monitor / designer /
  execution surfaces change.

## Explicit decisions locked for this initiative

- **Theme:** token-first, light theme remains the default (matches the pack's reference palette
  and the current app); a dark theme becomes possible later purely by swapping token values.
  *Escalate to the user before Phase 2 if dark-first is actually wanted.*
- **Charts:** hand-rolled SVG primitives (`MetricSparkline`, `BarChart`, `DonutChart`,
  `RadialGauge`) in `app/renderer/components/reports/` — zero new dependencies.
- **Live updates:** keep the existing polling conventions (1 s instance poll, 2 s runtime-status
  poll); history queries are windowed/paginated over IPC; no new event bus.
- **Route model:** new report pages are new `RouteId`s in `app/renderer/routes.tsx` plus a new
  "Reports" (or extended "Run") group in `LeftNavigation.tsx` `routeGroups`; persisted
  `lastRouteId` must fall back to `dashboard` for unknown ids in both directions.

## Phase order (summary — details in 09/10)

0. Land current uncommitted work (precondition, user-driven).
1. Baseline audit + UI screenshots.
2. Design tokens + shared primitives + app-shell polish.
3. Telemetry read-model: additive migration v2, report categories over `ErrorClassifier`,
   retention, per-Chromium-process sampling.
4. Report query IPC + preload typings.
5. Reports navigation shell + Overview dashboard.
6. Workflow & instance reports + run drill-down.
7. Live Chrome consumption + RPM gauges.
8. Consumption history + concurrency analytics.
9. Failure/success + server performance analytics.
10. Flow Designer / Workflow Builder visual refactor.
11. Motion/animation pass + reduced-motion audit.
12. Mapping/binding regression audit (08).
13. Final QA, performance, packaging (12).

## Final report format per phase

Every phase ends with: summary; files changed; contracts added/changed; verification commands run
with real results (never claim success for a command that did not pass); mapping/binding audit rows
appended to `docs/ai/ui-reports-refactor/08_MAPPING_BINDING_DEPENDENCY_AUDIT.md`; remaining risks;
docs/ai updates made. Do not start the next phase automatically.
