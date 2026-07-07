# 11 — Implementation Phases

Each phase: **Objective / Files / Tasks / Do-not-touch / Acceptance / Verify commands / Manual GUI / Rollback.**
**Each phase STOPS and reports. Do not auto-continue.** Work on a branch per `.claude/skills/git-full-cycle`.

## Phase 1 — Baseline screenshots + code audit
- **Objective:** capture "before" state + confirm hotspots.
- **Files:** none (read-only) + `docs/ai/TASK_LOG.md`, `docs/ai/CURRENT_STATE.md`.
- **Tasks:** run app, screenshot every page/state; grep hardcoded colors; list inline styles.
- **Do-not-touch:** all source.
- **Acceptance:** baseline images saved (`mockups/screenshots/before/`), audit appended to task log.
- **Verify:** `npm run build`. **Rollback:** n/a.

## Phase 2 — Token / global.css foundation
- **Objective:** dark token set live; base backdrop dark.
- **Files:** `global.css` (`:root`/theme, `body`, `.app-shell`).
- **Tasks:** add dark tokens + new node/connector/chart tokens; set backdrop; set `[data-theme]`.
- **Do-not-touch:** component markup, IPC.
- **Acceptance:** app boots dark, no white flash, tokenized surfaces upgrade.
- **Verify:** `npm run build`. **Manual:** open 3–4 pages. **Rollback:** revert token block.

## Phase 3 — App shell re-skin
- **Files:** `.top-header/.left-navigation/.status-bar/.brand-*` in `global.css`.
- **Acceptance:** shell fully dark/glass, active nav rail, collapse works.
- **Verify:** `npm run build`. **Manual:** nav all groups, collapse, header actions.

## Phase 4 — Shared cards/forms/buttons/tables
- **Files:** `global.css` card/panel/button/input/select/table/badge/tab/modal rules.
- **Acceptance:** primitives consistent across pages; focus rings visible.
- **Verify:** `npm run build`. **Manual:** Settings form, a table, buttons.

## Phase 5 — Dashboard, Reports, Instances
- **Files:** `Dashboard.tsx`, `Reports*.tsx`, `components/reports/*`, `ExecutionMonitor.tsx`, css.
- **Acceptance:** metrics/charts/tables re-skinned, numbers unchanged, gauge bands correct.
- **Verify:** `npm run build`, `npm run verify:reports`. **Manual:** each report tab, instances table.

## Phase 6 — Flow Designer + Workflow Builder pages
- **Files:** `FlowChartDesigner.tsx`, `WorkflowDesigner.tsx`, `ScenarioBuilder.tsx`, palette/props css.
- **Do-not-touch:** RF geometry, canvas route transform rule.
- **Acceptance:** page chrome + palette + property panels re-skinned; canvas still measures correctly.
- **Verify:** `npm run build`, `npm run verify:flow-designer`, `npm run verify:workflow-builder`.

## Phase 7 — Canvas, nodes, connectors
- **Files:** `ActionFlowNode.tsx`, `CanvasZoomControl.tsx`, `connectorStyle.ts`, `ConnectorPorts.tsx`, `.react-flow__*`, node/edge css.
- **Do-not-touch:** handle IDs, resize/loop, coordinate math, edge schema.
- **Acceptance:** dot-grid, tokened nodes/states, gradient connectors; add/move/connect/resize/loop/save all work.
- **Verify:** `npm run build`, `verify:flow-designer`, `verify:workflow-builder`, `verify:runner`.

## Phase 8 — Motion & animation
- **Files:** `global.css` keyframes/transitions + small count-up JS.
- **Acceptance:** hover/entrance/pulse/connector-flow/skeleton; reduced-motion kills them.
- **Verify:** `npm run build`. **Manual:** toggle OS reduced-motion; check fps on busy canvas.

## Phase 9 — Simplification pass
- **Files:** property panels, recorder, instance cards (className/structure-light).
- **Do-not-touch:** any field/action.
- **Acceptance:** advanced grouped, nothing removed, dangerous actions visible.
- **Verify:** relevant `verify:*` + manual field-presence check.

## Phase 10 — Binding regression pass
- **Tasks:** exercise every IPC-bound surface; confirm saves/loads/live subs.
- **Verify:** `verify:runner`, `verify:recorder`, `verify:instance-monitor`, `verify:reports`, `verify:flow-designer`, `verify:workflow-builder`.

## Phase 11 — Performance / accessibility
- **Tasks:** contrast audit, keyboard nav, focus order, canvas fps, memory/subscription leak check.
- **Verify:** `npm run build` + manual AA contrast + `verify:instance-monitor` (leak).

## Phase 12 — Final QA + screenshots
- **Tasks:** "after" screenshots, side-by-side vs baseline, update `CURRENT_STATE.md` + `TASK_LOG.md`.
- **Verify:** full `verify:*` suite green (see 12), `validate:offline`.
