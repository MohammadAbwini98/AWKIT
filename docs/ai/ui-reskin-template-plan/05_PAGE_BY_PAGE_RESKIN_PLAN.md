# 05 — Page-by-Page Re-skin Plan

Per page: **Current → Must-keep controls → Visual changes → Motion → Simplification → Files → Regression risk → Manual checklist.**
Rule for all pages: **re-skin only.** No new pages, no removed pages, no removed fields, no changed data flow.

## Dashboard (`pages/Dashboard.tsx`)
- **Current:** light metric cards + panels, flat.
- **Must-keep:** all KPIs, links to workflows/instances, any live counts.
- **Visual:** dark cards w/ gradient top-line + sparkline; glass header; panel upgrade.
- **Motion:** metric count-up, card hover lift, staggered card entrance.
- **Simplify:** group secondary stats under one panel; no data removed.
- **Files:** `Dashboard.tsx` (classNames only), `global.css`.
- **Risk:** low. **Checklist:** counts match, links work, no white flash.

## Flow Designer (`pages/FlowChartDesigner.tsx` + workflow components)
- **Current:** React Flow canvas, light nodes, plain edges, node palette + properties.
- **Must-keep:** node palette items, all node config fields, connector config, zoom/pan/minimap, resize handles, loop button, port behavior.
- **Visual:** dot-grid dark canvas, tokened nodes, gradient/animated connectors, glass toolbars (see 06).
- **Motion:** node hover/selected/running/success/error, connector flow, palette drag ghost.
- **Simplify:** collapse advanced node props under "Advanced" (still present).
- **Files:** `FlowChartDesigner.tsx`, `ActionFlowNode.tsx`, `CanvasZoomControl.tsx`, `connectorStyle.ts`, `ConnectorPorts.tsx`, `global.css`.
- **Risk:** **high** (canvas geometry + React Flow). Keep AppShell canvas no-transform rule. **Checklist:** add/move/connect/delete node, resize, loop add/remove, save, run states.

## Workflow Builder (`pages/WorkflowDesigner.tsx` / `ScenarioBuilder.tsx`)
- Mirror Flow Designer changes; shares `connectorStyle.ts` + scenario node classes.
- **Must-keep:** parallel/conditional/manual node variants + fields.
- **Files:** `WorkflowDesigner.tsx`, `ScenarioBuilder.tsx`, `.scenario-flow-node*` in `global.css`.
- **Risk:** high. **Checklist:** build/run a scenario, variant styling correct, save round-trip.

## Recorder (`pages/Recorder.tsx`)
- **Must-keep:** start/stop/pause, locator preview, step list, draft save, protected-login flow.
- **Visual:** dark control bar, tokened step list, status chips; recording = live pulse.
- **Simplify:** primary controls prominent; advanced locator options grouped.
- **Files:** `Recorder.tsx`, `global.css`. **Risk:** med. **Checklist:** record→draft→save, locator picker works.

## Instances (`pages/ExecutionMonitor.tsx`)
- **Must-keep:** instance table, run/cancel, filters, artifacts links.
- **Visual:** dark table, status badges, cancel = danger ghost.
- **Motion:** row hover, new-row fade, status transitions.
- **Files:** `ExecutionMonitor.tsx`, `components/instances/*`, `global.css`. **Risk:** med. **Checklist:** start/cancel run, filter, open artifact.

## Instance Monitor (`pages/InstanceMonitor.tsx`)
- **Must-keep:** live tiles, resource/pressure gauges, per-instance detail.
- **Visual:** glass tiles, gauge bands via tokens, live pulse.
- **Files:** `InstanceMonitor.tsx`, `global.css`. **Risk:** med (live subscriptions). **Checklist:** live updates continue, gauges animate, no leak.

## Reports (`pages/Reports*.tsx`, `components/reports/*`)
- **Current:** already uses `.work-panel/.page-grid/.metric-card` — upgrades largely for free once base classes flip.
- **Must-keep:** all charts, tables, Chrome-usage RPM gauge, telemetry contract, sub-tabs.
- **Visual:** chart series → `--awkit-chart-*`, gradient fills, glass tooltips, sliding tab pill.
- **Files:** `Reports*.tsx`, `components/reports/*`, chart components, `global.css`. **Risk:** med. **Checklist:** every report tab renders, numbers unchanged, gauge bands correct.

## Settings (`pages/Settings.tsx`)
- **Must-keep:** every setting field + dangerous actions (visible, not hidden).
- **Visual:** sectioned panels, tokened inputs/toggles, danger zone tinted.
- **Files:** `Settings.tsx`, `global.css`. **Risk:** low. **Checklist:** all fields save, toggles persist.

## Other existing pages (re-skin, keep behavior)
DataSourceManager/Editor, RuntimeInputPanel, SessionsManager, FormDesigner, FlowLibrary/WorkflowsLibrary,
OfflineRuntimeStatus, ImplementationRoadmap, ProjectContract — apply shared card/form/table/badge tokens; no field/behavior changes.
