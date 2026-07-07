# 11 — Acceptance Criteria (measurable)

The initiative is DONE only when every row passes (or is explicitly waived by the user with a
recorded reason).

## Build & type safety

| # | Criterion | How measured |
|---|---|---|
| 1 | `npm run build` passes (tsc --noEmit + electron-vite bundles) | command exit 0 |
| 2 | No new TypeScript suppressions (`@ts-ignore`/`any` casts) beyond pre-existing ones | diff review |

## Existing behavior preserved

| # | Criterion | How measured |
|---|---|---|
| 3 | Workflow creation still works (Flows + Workflow Builder save/load) | `verify:flow-designer` 19/19, `verify:workflow-builder` 13/13, manual create/save/reload |
| 4 | Workflow execution still works, semantics unchanged | `verify:runner` 82/82, `verify:waits` 21/21, `verify:concurrency` 78/78, `verify:cancellation` 12/12 |
| 5 | Every existing required node/connector field still renders, validates, saves | field checklist vs `FlowNodePropertiesPanel.tsx` / `ConnectionPropertiesPanel.tsx` before/after |
| 6 | Instance monitoring still works (cards, controls, live report modal, runtime strip, Recoverable Runs panel) | `verify:instance-monitor`, `verify:runtime-status` 15/15, manual |
| 7 | Recorder incl. secure-login handoff unaffected | `verify:recorder` 57/57, `verify:protected-login` 16/16 |
| 8 | Existing saved flows/workflows/reports and v1 `runtime.sqlite` files load | open pre-refactor data copies; no errors |
| 9 | `window.playwrightFlowStudio` existing groups/channels unchanged | diff `preload.ts` — additive only |
| 10 | Offline/packaged behavior intact | `validate:offline` pass, `verify:packaged-runtime` pass, `verify:packaged-walkthrough` pass on fresh profile |

## Reports & telemetry

| # | Criterion | How measured |
|---|---|---|
| 11 | Reports show real data from completed runs (no fabricated values anywhere outside the dev flag) | run 2 mock-site workflows (1 pass, 1 fail) → Overview/Workflows/Failures reflect exactly those runs |
| 12 | Fresh install shows empty states on every report page, no crash | packaged walkthrough fresh profile |
| 13 | Old runs missing v2 fields show "Unavailable", never NaN/undefined/crash | seed v1-only rows, open all pages |
| 14 | `AWKIT_DURABLE_STORE=0` → informative empty states | manual with env set |
| 15 | Telemetry failure cannot fail a run | fault injection (read-only store) → run still completes |
| 16 | History queries paginated/windowed; charts point-capped (≤120 sparkline / ≤60 bars) | code review + large seeded dataset |
| 17 | Retention sweep bounds sample tables (24 h raw default, env-overridable) | `verify:telemetry` retention check |
| 18 | Every derived metric (efficiency, saturation, flakiness) has a tooltip documenting source + formula | manual sweep |

## Live metrics

| # | Criterion | How measured |
|---|---|---|
| 19 | Live pages update without freezing UI (1 s instances / 2 s status budget, no extra pollers per page) | code review + interaction during a 4-instance run |
| 20 | Gauges degrade gracefully when process metrics unavailable (availability notice, neutral gauge) | disable sampler flag / simulate CIM failure |
| 21 | Chromium exiting mid-sample never crashes the app | kill Chromium during a run with Chrome page open |
| 22 | No leaked intervals/listeners: heap + listener count stable after 10-min soak with Reports + Chrome pages open | DevTools heap snapshots (12 §Performance) |

## UI/UX quality

| # | Criterion | How measured |
|---|---|---|
| 23 | All new/updated surfaces implement loading, empty, error, ready states | manual state matrix per page |
| 24 | OS reduced-motion disables count-ups, sweeps, shimmer, pulses | toggle Windows animation setting |
| 25 | Animations compositor-only (transform/opacity); no canvas drag jank | DevTools performance trace on designer drag + dashboard |
| 26 | Keyboard focus visible on all interactive elements; icon-only buttons labeled | keyboard-only walkthrough |
| 27 | Charts have text equivalents; status never color-only | manual sweep |
| 28 | New routes reachable from left nav; `lastRouteId` unknown-id falls back to `dashboard` | set stale id in `ui-settings.json`, relaunch |
| 29 | Zero new npm dependencies (or each one user-approved + offline-validated + recorded in 08 §C.6) | `package.json` diff |
| 30 | `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`, `ARCHITECTURE.md`, `FEATURES.md` updated; 08 audit complete with readiness status | doc review |
