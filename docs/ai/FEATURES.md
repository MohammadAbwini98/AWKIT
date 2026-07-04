# FEATURES

Status legend: ✅ implemented · 🟡 partial/unverified · 🔭 planned/implied

## Confirmed (by module)

### Flow Designer — `app/renderer/pages/FlowChartDesigner.tsx`
- ✅ React Flow canvas with draggable nodes, connectors, minimap, controls.
- ✅ Node registry + type-specific properties — `components/workflow/flowNodeRegistry.ts`,
  `FlowNodePropertiesPanel.tsx` (click/fill/select/check/radio/wait/assert/screenshot/scroll/
  loop/runFlow/goto/condition/manualHandoff/**routeChange**).
- ✅ **Route Change node**: switches the active automation page/tab/URL — modes switchToUrl,
  switchToLatestTab, waitForNewTab, navigateCurrentPage (URL match exact/contains/regex; wait-until).
  Runtime switches `StepExecutor.activePage` + `LocatorFactory.setPage` so later steps target the new tab.
- ✅ **Protected Login Handoff**: detector (`src/security/ProtectedLoginDetector.ts`) + `protectedLoginHandoff`
  node + runner auto-pause + Instance Monitor handoff UI. Detects Google/Microsoft/Okta/Auth0/Duo and
  insecure-browser/CAPTCHA/MFA pages, pauses the live runner/browser (never bypasses), offers
  Cancel/Continue/Retry (+OAuth/saved/test disabled-with-reason). Continue resumes the same in-flight flow;
  Retry re-detects in place. Capability-gated OAuth via `WFS_OAUTH_*` + `shell.openExternal`. No secrets logged.
- ✅ **Save Session node**: saves Playwright `storageState` (cookies + localStorage/origins) to
  `<runtimeRoot>/sessions/<name>.json` for later reuse. Config: session name (file-safe), target folder,
  overwrite, capture scope (context | origin), mask-in-logs. Never logs cookie/token values.
- ✅ **Auto Secure Login node** (`autoSecureLogin`): reuses a saved session for the target URL (matched by
  **normalized origin**) → `sessionAlreadyExists`; otherwise closes the automation browser, launches the
  user's real Chrome (`SessionCaptureService`), waits for manual login, and relaunches Playwright on the
  captured profile → `sessionCaptured` + `restartRequired`. Never bypasses MFA/CAPTCHA; no secrets logged.
- ✅ **Reuse Session node** (`reuseSession`): loads a saved session and restarts the browser on its profile
  dir → `sessionLoaded`. Modes: **Auto detect** (by origin from node URL/current page) or **Selected**
  (dropdown of ready sessions).
- ✅ **Smart connectors** (structured `kind` on every edge): **Normal**; **Conditional**
  (`ConditionalConnectorConfig` — sourceField outcome/status/errorCode/variable/dataSourceValue + operator +
  expectedValue + priority); **Parallel** (`ParallelConnectorConfig` — join waitAll/waitAny, fail
  failFast/collectErrors, isolation sharedPage[sequential]/isolatedPage[concurrent, `maxConcurrency`]);
  **Loop** (`LoopConnectorConfig` — **self-loop only** (source===target), count/staticList/dataSource/
  whileCondition, `maxIterations`, `parameterName` injected as a runtimeInput). Kind selector + per-kind
  fields in Connection Properties; legacy `outcome`/`loopBack` (cross-node, exempt from the self-loop rule)
  expression edges still supported. Routing/eval in `FlowExecutor` + `ConnectorConditionEvaluator`; connector
  timeline events surface in the Live Report.
- ✅ **Connector-structure safeguards** (Flow Designer + Workflow Builder, block Save; Flow Designer
  re-validated at runtime by `FlowExecutor`; Workflow Builder re-validated at runtime by
  `ScenarioOrchestrator`/`FlowDependencyResolver`): a node may have at most one standard (non-conditional/
  non-parallel) outgoing connector; a loop connector must return to the same node; a node with a self-loop
  forces every other outgoing connector to be Conditional. `validateConnectorStructure`
  (`src/profiles/FlowProfile.ts`) is the shared rule set.
- ✅ **Dynamic connector ports:** `ActionFlowNode`/`ScenarioFlowNode` show a `normal` handle per side always,
  plus a conditional/parallel two-port source pair once an edge of that kind leaves the node (derived at
  render time via `computePortFlags`, not persisted). Node components refresh React Flow internals when
  port flags change so the dynamic branch handles support real drag-connections.
- ✅ **Circular self-loop connector shape:** `EdgeVisualStyle.shape` includes `circular`, rendered by
  `SelfLoopEdge.tsx` (custom React Flow edge type); loop connectors default to it.
- ✅ **Node Palette search** + searchable node-property dropdowns (`SearchableSelect` for JSON Data Source /
  Target flow / Saved Flow).
- ✅ **Connector style customization** (`ConnectorStyleEditor`, shared): per-connector color/line-style/
  thickness/shape/arrowhead in both designers, persisted on the edge; shared `buildConnectorVisual` makes
  Flow Designer and Workflow Builder connectors visually identical.
- ✅ Node resize + default size from Settings; size persisted (`FlowStep.size`). Resize handles/
  lines show **only on the selected node** (`NodeResizer isVisible={selected}` + CSS guard in
  `global.css`); selecting another node moves them, clearing selection hides them.
- ✅ Zoom % control (`CanvasZoomControl.tsx`), default 100%, persisted; collapsible Node Palette
  and Node Properties; compact header; auto-expand properties on node select.
- ✅ Save/Load/Export/Delete; validation chip; selection persistence. Flows table rows open the flow in
  the Designer on click (keyboard accessible; action buttons isolated).
- ✅ **Snapshot-based unsaved-changes detection** (`serializeFlowDoc`): the unsaved dialog appears
  only for real document edits (node add/remove/move/resize, property/connector/metadata change),
  not on open, selection, zoom/pan, node measurement, or after a successful save.

### Workflow Builder — `app/renderer/pages/ScenarioBuilder.tsx`
- ✅ Link saved flows into a `WorkflowProfile`; typed connectors (Connection Properties panel).
- ✅ Resizable "Workflow Definition" panel; collapsible data-source/connector sections; zoom.
- ✅ Workflow data-source binding; selection persistence.
- ✅ Snapshot-based unsaved-changes detection (`serializeWorkflowDoc`, includes execution +
  dataSource) — same rules as the Flow Designer.
- ✅ **Double-click a flow node → opens that flow in the Flow Designer** (via the unsaved-changes guard;
  Back restores the workflow).
- ✅ **Resizable workflow nodes** (`NodeResizer`, handles only on the selected node; size persisted in
  `WorkflowFlowNode.size`).
- ✅ **Saved Flows search by name + "Load More"** (10 initially, +10 per click).
- ✅ Save success/failure **toast** (`components/shared/Toast.tsx`).

### Libraries & data
- ✅ Flows library + Workflows library with pagination, page size, sorting, advanced filters,
  persisted table state (`components/table/*`).
- ✅ Data Source Manager (JSON sources, click a row to preview, validate, **Edit Table**, duplicate,
  export, **Create Data Source** from scratch); Runtime Input panel; Form Designer.
- ✅ **Data Source Editor** (`pages/DataSourceEditor.tsx`, hidden route `dataSourceEditor`):
  visual table editor for root-array JSON — inline cell editing (type-preserving), add/delete/
  duplicate rows, add/rename/delete columns, search, pagination (25/50/100/All), import/export,
  validate, revert, unsaved-changes dialog, id-binding warnings. Reads/writes real files via IPC;
  bundled samples migrate to the writable data-sources folder on save. Pure logic in
  `src/data/TableEditing.ts` (verified by `npm run verify:data-editor`).
- ✅ Recorder (records browser actions into a flow) — `src/recorder`, `pages/Recorder.tsx`.
  "Save to Flow Library" shows success/failure feedback (shared `Toast` + inline banner) with an
  `isSaving` guard against duplicate-click corruption. **Auto-captures visited URLs** (main-frame
  navigations + opened tabs) with sensitive query values masked, shown in a searchable/paginated
  "Recorded URLs" table (Time/Title/URL/Source/Session/copy) via `recorder.getUrls()`.
- ✅ **Unique, Playwright-safe recorder locators** (`src/recorder/recorderInitScript.ts`): for
  click/fill/select/check/uncheck/radio steps the injected capture script generates ranked candidate
  locators (getByRole/label/placeholder/text/testId → stable attributes → id → scoped → positional
  fallback), **never** utility/layout-class selectors (`flex`, `items-center`, …), validates each
  against the live DOM, and saves the highest-priority candidate that resolves to exactly one element.
  Each saved step carries `LocatorQuality` (`strategy`/`isUnique`/`matchCount`/`confidence`/`warning`/
  `candidateCount`) and (for role/text) an `exact` flag. Steps get human-readable names
  ("Click Log in", "Fill Email"). Password field values are never stored. Verified by
  `npm run verify:recorder`.
- ✅ **Locator-quality surfacing:** Flow Designer Node Properties shows a locator-quality readout and
  will not report a node as valid when its saved locator is non-unique (flow-level + node validation
  messages). At run time `StepExecutor` fails a known-non-unique step early with a friendly message and
  translates raw Playwright strict-mode violations into an end-user message (technical detail stays in
  the structured logs).

### Execution & reporting
- ✅ Generic Playwright runner: `StepExecutor`, `FlowExecutor`, `PlaywrightRunner`,
  `ExecutionEngine`, `LocatorFactory`, `ValueResolver`, `ExpressionEvaluator`.
- ✅ Connector routing at flow and workflow level (structured conditional/parallel/loop connectors +
  legacy success/failure/conditional/always/outcome/loopBack); Auto Secure Login engine restart guard
  (`MAX_AUTO_LOGIN_RESTART`); Run Another Flow with recursion guard (depth 5).
- ✅ Instance manager/pool/coordinator for concurrent isolated instances; manual handoff.
- ✅ Reports/logs/screenshots/downloads written under runtime data paths; Execution & Instance monitors.
- ✅ **Live Execution Report** (`components/instances/LiveExecutionReportModal.tsx`): the instance table's
  Live Report button opens a human-readable modal — summary banner with status pill + heartbeat, connected
  horizontal **per-step process flow** with numbered status nodes, real progress bar, active/running/waiting
  animation, statistics cards, and a masked activity timeline (no raw JSON). Failed nodes show a friendly
  message in the main UI and expose masked technical details only on hover/focus. Active runs show relative
  "Updated" time; terminal runs show a stable final update timestamp. Real live progress: `StepExecutor`
  emits per-step events → `ExecutionEngine` writes a bounded `InstanceRuntimeState.liveProgress` snapshot →
  renderer 1s poll renders it; finished runs use the stored report. Built via `executionReportModel.ts` +
  `src/runner/RunnerProgress.ts`.
- ✅ Concurrent Instance Monitor controls (Pause/Resume/Stop All/Clear Completed +
  per-instance Pause/Resume/Stop/**Repeat**/Remove) all map to real `executionEngine` methods. Clear
  Completed removes terminal instances from the backend pool. Repeat re-runs a single finished instance
  from its retained run context. Logs/Screenshots buttons are enabled only for `failed` instances that
  have an artifact path.
- ✅ **Workflow cards grid** (`components/instances/WorkflowRunCard.tsx`): primary run UX — one card per
  saved workflow with status badge, summary metadata, and per-card run parameters revealed on
  hover/keyboard focus (independent per workflow; persisted to `settings.workflowRunCards`). Search by
  name/description; all cards always render, and the grid becomes a two-row-tall internal scroller once the
  cards overflow two rows (no "Load More" button). Classic dropdown form collapsed behind an "Advanced"
  `<details>`. Runs multiple workflows concurrently; instance table has a **Workflow column**.
  Cards are equal-height on a stable 3-column grid (`repeat(3, minmax(0,1fr))`; 2/1 cols on smaller
  widths) so cards-per-row and dimensions stay consistent whether or not the scroller is active; the
  hover/focus reveal cross-fades two equal-area layers so the card height (and grid) never moves; the
  search bar is full content width.

### Settings & offline
- ✅ Full Settings screen (Application, Paths, Designer Defaults, Execution Defaults, Data Storage,
  Advanced) wired to the persisted store; folder picker IPC; consumed by writers.
- ✅ Offline Runtime status page; bundled Chromium; dependency manifest; startup gate;
  portable + per-user NSIS packaging.

## Partial / unverified

- 🟡 Clean-machine offline GUI walkthrough (manual gate, pending).
- 🟡 `@playwright/test` spec runs only on Node ≥18.19 (use `verify:runner` otherwise).

## Planned / implied (from spec — not all built)

- 🔭 SQLite storage (spec allows; currently JSON files).
- 🔭 Advanced recorder locator suggestions; richer reporting gallery.

## Important dependencies

- Runner depends on the bundled Chromium (`resources/browsers/chromium`) in offline mode and on
  `playwright`/`playwright-core` being asar-unpacked in packaged builds.
- Settings store (`app/main/uiSettings.ts`) underpins state restore, table state, designer
  defaults, and custom paths; many features read/write it via `window.playwrightFlowStudio.settings`.

## Unknown / Needs Verification

- Completeness of Form Designer and Runtime Input flows end-to-end (not exercised in verification).
