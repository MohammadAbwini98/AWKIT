# 12 — Verification, QA & Regression Plan

All commands below are **real scripts from `package.json`** (verified this pass).

## Build / typecheck / test
- `npm run build`  — `tsc --noEmit && electron-vite build` (typecheck + bundle). **Primary gate.**
- `npm run typecheck` — `tsc --noEmit`.
- **Tests/lint:** there is **no** `npm test` and **no** lint script (confirmed). Do not invent them.

## Existing verify scripts (relevant to a UI re-skin)
- `npm run verify:flow-designer`  (GUI)
- `npm run verify:workflow-builder` (GUI)
- `npm run verify:reports` (GUI)
- `npm run verify:recorder`
- `npm run verify:instance-monitor`
- `npm run verify:runner`
- `npm run verify:mock-site` (+ feature verifiers)
- `npm run verify:data-editor`, `verify:waits`, `verify:popup`
- `npm run validate:offline` (offline/packaging integrity)

## GUI verifier commands to run per phase
Phase 5 → `verify:reports`; Phase 6/7 → `verify:flow-designer`, `verify:workflow-builder`, `verify:runner`;
Phase 9/10 → `verify:recorder`, `verify:instance-monitor`. Rebuild (`npm run build`) before each.

## Manual screenshot checklist
Dashboard, Flow Designer (empty + populated + running + error), Workflow Builder, Recorder (idle + recording),
Instances (list + running + cancelled), Instance Monitor (live), each Reports tab, Settings, a modal, an empty
state, a loading state. Capture light-vs-dark before/after.

## Functional regression checklist
- **Workflow creation:** add nodes from palette, connect, edit props, save, reload → identical.
- **Workflow execution:** run to completed; artifacts produced; node/connector run states animate.
- **Recorder:** record → draft → save; locator preview; protected-login path.
- **Instances:** start/cancel; cancel frees slot/locks; filters; artifact open.
- **Reports:** every tab renders; numbers match pre-reskin; Chrome-usage RPM gauge bands correct.
- **Settings:** every field saves; toggles persist; dangerous actions confirm.
- **Canvas drag/drop:** add/move/resize node; connect edge; loop add/remove; minimap/zoom/pan.
- **Node properties save:** edit → save → persists after reload.
- **Connector save:** color/shape/line/thickness/arrow → save → renders correctly.

## Reduced-motion verification
Enable OS "reduce motion" → confirm connector flow, pulses, count-up, shimmer, transforms are disabled and
states still change instantly.

## Performance verification
Busy canvas (many nodes/edges, several running) stays smooth (~50fps); no runaway CPU from infinite animations.

## Memory / subscription leak check
Open/close Instance Monitor and canvas routes repeatedly; confirm live subscriptions unsubscribe (no growing
listener count / heap). Use `verify:instance-monitor` + manual devtools check.

## Exit criteria
`npm run build` clean; all relevant `verify:*` green; `validate:offline` pass; manual checklist + reduced-motion
+ perf/leak checks pass; before/after screenshots attached; docs updated.
