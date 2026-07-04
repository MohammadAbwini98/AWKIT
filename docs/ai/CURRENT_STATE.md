# CURRENT_STATE

**Last updated:** 2026-07-04 (Codex - Mock Site upgraded into the local Feature Test Lab. Added stable
offline scenarios for Smart Wait/Runner timing, Recorder/locator/saved URL flows, and
Flow Designer/Workflow Builder/Instance Monitor surfaces; added `npm run verify:mock-site` (28/28).
Agent guidance and skills now require future feature work to consider/update mock-site scenarios.)

## What currently works (Confirmed)

- **Build & typecheck:** `npm run build` (`tsc --noEmit` + electron-vite main/preload/renderer) passes.
- **AI memory handoff/takeoff:** `docs/ai/HANDOFF.md` is the active generic handoff note for Claude Code,
  Codex, Gemini, Antigravity, future agents, and human developers. `/HANDOFF` command/workflow files
  prepare the repo for the next agent; `/TAKEOFF` command/workflow files resume from the handoff by reading
  memory and inspecting actual repo state before editing. The AI memory checker requires `HANDOFF.md` and
  warns if important handoff sections are missing.
- **AI agent architecture:** Shared source of truth is `AGENTS.md` + `docs/ai/` (indexed by
  `docs/ai/README.md`); Claude Code uses `CLAUDE.md`, `.claude/commands`, and `.claude/skills`
  (`ai-memory-maintainer`, `codebase-review`, `feature-implementation`, `bug-fix`,
  `test-and-verify`, `docs-sync`, `refactor-safe`, `pr-review`, `mock-site-maintainer`);
  Codex/Antigravity/future agents use `.agents/skills` + `.agents/workflows` (including
  `mock-site-maintainer`); Gemini uses `.gemini/commands` and `.gemini/skills/mock-site-maintainer`;
  Cursor uses `.cursor/rules`.
  A cross-agent **`git-full-cycle`** skill (safe Git lifecycle: status, dirty-tree handling, branching,
  commit, push, PRs, protected `main`, stacked PRs) is mirrored byte-identically under
  `.claude/skills/`, `.codex/skills/`, `.gemini/skills/`, and a canonical `docs/ai/skills/` copy, and is
  referenced from `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`.
  `node scripts/ai-memory/check-memory.mjs` validates required memory files and warns for optional
  adapter/skill gaps.
- **Offline packaging:** `npm run package:portable` and `npm run package:nsis` produce
  `dist/WebFlow Studio 0.1.0.exe` (portable, ~307 MB) and `dist/WebFlow Studio Setup 0.1.0.exe`
  (per-user NSIS, ~351 MB) — both re-verified after the handoff/connector runtime changes (unsigned;
  test-fixtures excluded). Strict offline validation (`validate:offline`) passes; bundled Chromium at
  `resources/browsers/chromium/chrome.exe`; dependency manifest is BOM-free and valid.
- **Offline startup gate:** packaged app validates required assets before opening a window
  (`app/main/main.ts` + `evaluateOfflineStartupGate`); shows a styled blocking dialog if missing.
- **Runner execution (live-verified, `npm run verify:runner` → 76/76):** goto, click, fill
  (+clearBeforeFill), select (single/multiple), check/uncheck/radio, wait (time/selector/
  navigation/networkIdle/textVisible), assertion (visible/text/value/count/url × operators),
  scroll (direction/element), screenshot (full-page/element), upload, download, loop
  (fixed/elements/dataRows with guard), runFlow with recursion guard (direct/indirect/max-depth),
  **routeChange** (switchToUrl / switchToLatestTab / waitForNewTab / navigateCurrentPage — switches
  the active page so later steps target the new tab), **saveSession** (writes Playwright `storageState`
  — cookies + localStorage/origins — to `<runtimeRoot>/sessions/<name>.json`; never logs secret values),
  and manual/protected-login handoff pause/resume (the runner stays alive and continues the next browser
  step after `ManualHandoffController.resume`).
- **Connector routing (live-verified):** flow-level success/failure/conditional/always; workflow-level
  link routing (success/failure/conditional/always) with strict traversal + linear fallback.
- **Structured connectors (Checkpoint B, live-verified):** every connector has a `kind` —
  `normal` / `conditional` / `parallel` / `loop` — with structured config on `FlowEdge`
  (`conditional`/`parallel`/`loop`). **Conditional** connectors (`ConditionalConnectorConfig`) route by a
  `sourceField` (outcome / status / errorCode / variable / dataSourceValue) + operator (equals, contains,
  exists, greaterThan, truthy, …) + `expectedValue`, with `priority` breaking ties (highest wins; no match
  → safe stop). **Parallel** connectors (`ParallelConnectorConfig`) honor `joinMode` (waitAll/waitAny) and
  `failMode` (failFast/collectErrors) plus an **`isolation`** mode: `sharedPage` (default) runs branches as
  sequential fan-out on the current page (safe, no concurrent UI mutation); `isolatedPage` runs branches
  **concurrently**, each on its own page in the shared browser context (shared session, independent DOM),
  bounded by `maxConcurrency`. **Loop**
  connectors (`LoopConnectorConfig`) are **self-loops only** — source and target must be the same node
  (Point 4) — and repeat that node in `count` / `staticList` / `dataSource` / `whileCondition` mode, bounded
  by `maxIterations` (hard cap 1000), injecting the loop value under `parameterName` (read via a
  `runtimeInput` value source); the node's own (Conditional-only, Point 3) exit edge then continues the flow.
  Evaluation lives in `src/runner/ConnectorConditionEvaluator.ts`; routing in `FlowExecutor`
  (`executeFlow` detects a self-loop edge on the current node and runs the whole loop in place via
  `executeLoopConnector` before any exit routing). The legacy `loopBack` edge type (Enhanced Connectors,
  Phase 1) remains an intentional **cross-node** back-edge and is exempt from the self-loop rule. Legacy
  edges (no `kind`) derive a kind from their `type` and keep executing via the expression-based paths (fully
  backward compatible). **Connector-structure safeguards (AWKIT points 1–5):** `validateConnectorStructure`
  (`src/profiles/FlowProfile.ts`) — reused by `FlowExecutor.executeFlow` as a runtime guard and mirrored by
  `connectorStructureIssues`/`scenarioConnectorStructureIssues` in the Flow Designer/Workflow Builder — blocks
  execution/Save when: a loop connector doesn't return to the same node; a node has more than one standard
  (non-conditional/non-parallel) outgoing connector; or a node with a self-loop has a non-Conditional
  additional outgoing connector. Both canvases' kind/link-type selectors disable the disallowed options with
  explanatory helper text. **Branch-pair ports (Rules 3/4):** the source (right) side is a single centered
  `normal-out` port by default; once a **conditional** or **parallel** connector leaves the node it becomes
  a two-port **branch pair** — exactly two same-kind ports `<kind>-out-0/1` (evenly centered via
  `portPositions(2)`), so each of the (max 2) branch connectors aligns to its own port instead of sharing
  one handle (`ConnectorPortFlags.sourceKind`, `branchSourceHandle`, `reconcileBranchConnectors` in
  `connectorStyle.ts`). `reconcileBranchConnectors` slots each pair and, on deletion (`revertSources`),
  reverts a lone surviving branch connector back to **Normal** (single centered port). `ActionFlowNode` and
  `ScenarioFlowNode` call `useUpdateNodeInternals` when `portFlags` change so newly rendered dynamic handles
  are draggable, not only visible. Target (left) side
  keeps a `normal-in` port plus a `conditional-in`/`parallel-in` port for incoming branch connectors. Ports
  render as **siblings of the node card** (not children) so React Flow positions them against the
  un-clipped `.react-flow__node` wrapper (the card's `overflow: hidden` would otherwise clip the
  edge-hugging handles). **Kind changes only in the properties panel (Rule 1):** a `normal` connector's
  kind list offers Normal/Conditional/Parallel (Loop shown disabled — it's created only by the node's loop
  button); once conditional/parallel, the kind **and** type selects are **locked** until a connector is
  removed. `onConnect` in both `FlowChartDesigner.tsx`/`ScenarioBuilder.tsx` caps branch connectors at 2
  and reconciles; if the source already has a self-loop, a new connector is forced to Conditional.
  **Loop connector creation:** a small circular loop button
  (top-right of each node, `ActionFlowNode.tsx`/`ScenarioFlowNode.tsx`) is an **add/remove toggle** —
  clicking it creates the self-loop edge (source=target=that node, kind/type `loop`, circular shape), and
  once a loop exists the button turns filled and removes it on click (the loop is also selectable +
  deletable as a normal edge). **Top loop port + semicircle:** loop connectors attach to a dedicated
  `loop-out`/`loop-in` handle pair on the node's **top** edge (`ConnectorLoopPort`, always present so the
  edge attaches immediately, visible only when a loop exists — `.connector-port-loop.active`); the shared
  `SelfLoopEdge.tsx` detects a self-loop via `source === target` (node identity, not coordinates) and draws
  a visible **semicircle arcing above** the node. **Circular shape:** `EdgeVisualStyle.shape` includes
  `"circular"`, rendered by `SelfLoopEdge` (registered edge type `circular`, also used as the general
  "curved" option for distinct-node edges); loop connectors default to it automatically. The Flow Designer
  Connection Properties panel has a **kind selector + per-kind fields** (incl. a **data-source dropdown** for
  loop `dataSource` mode); `validateFlow` checks conditional expected-value/variable, loop bounds/config,
  ambiguous same-priority conditionals, and the connector-structure rules above. Connector routing also emits
  **live-report timeline events** (conditional matched, parallel fan-out, loop iteration, Auto Secure Login
  restart) via the `RunnerProgressReporter` — no secrets. **Workflow Builder runtime guard:** the same
  connector-structure rules now run through `FlowDependencyResolver` / `ScenarioOrchestrator.createExecutionPlan`
  before workflow execution, so a saved or externally edited invalid workflow graph that bypasses the
  renderer Save gate is blocked at runtime (verified by `verify:runner`).
- **Enhanced Connectors (Phase 1, live-verified):** new flow edge types `outcome` (routes on the step's
  own result via `${stepResult.*}` scope), `loopBack` (controlled back-edge gated by `maxLoopCount`,
  default 2; exhaustion falls through to success/always instead of erroring), and `parallel` (sequential
  fan-out to multiple targets, then converge). `resolveNext` in `FlowExecutor` orders outcome →
  conditional → conditional loopBack → success → always → unconditional loopBack → legacy `next`.
  Workflow-level `chooseNextFlow` also honors `outcome` links. Colors/animations and the Connection
  Properties panels (Flow Designer + Workflow Builder) expose all new types. Backward compatible.
- **Auto Secure Login node:** `autoSecureLogin` reuses a saved session for the target URL when one is
  ready — matched by **normalized origin** (protocol+host+port), so different paths on the same site reuse
  the same login (`outcome: sessionAlreadyExists`). Otherwise it closes the automation browser, launches the
  user's real Chrome via `SessionCaptureService.startCapture(..., "autoSecureLogin")`, waits for the manual
  login, then relaunches Playwright with a `persistentContext` bound to the captured profile
  (`outcome: sessionCaptured`, `restartRequired: true`). Enabled by a `BrowserRestarter` callback in
  `PlaywrightRunner` (mutable browser holder that re-points the live `StepExecutor` at the new page) +
  `sessionService` injected from `ExecutionEngine`. **Restart:** two mechanisms — the engine-level guard in
  `FlowExecutor` restarts the flow from Start on `restartRequired` (bounded by `MAX_AUTO_LOGIN_RESTART = 1`,
  fails safely with a clear message if the session still can't be reused), AND a user-drawable `outcome`/
  `loopBack` edge back to Start still works for explicit flows.
- **Reuse Session node:** `reuseSession` loads a previously-captured session profile and restarts the
  automation browser on its `userDataDir` (`outcome: sessionLoaded`, marks the session used). Two modes:
  **Auto detect** (default) resolves a ready session by normalized origin from the node's optional Target
  URL or the current page URL; **Selected** uses a specific session chosen from a `SearchableSelect` of ready
  sessions. No-match in auto-detect fails safely with `outcome: sessionNotFound`.
- **Session registry metadata:** `SessionProfile` now carries `origin`, `loginUrl`, and `source`
  (`autoSecureLogin` | `manual` | `imported`); `SessionCaptureService.list()` backfills `origin`/`source`
  for legacy profiles. Sessions Manager shows a **Source** column + origin subtitle. Sessions live under a
  dedicated automation profile dir `%LOCALAPPDATA%/WebFlow Studio/profiles/<id>` (never the user's daily
  Chrome profile); session artifacts are git-ignored.
- **UI:** Flows & Workflows tables with pagination + advanced search/filter (persisted);
  Flow Designer with node registry/type-specific properties, node resizing, zoom % control,
  collapsible Node Palette/Properties; Workflow Builder with resizable Workflow Definition panel
  and collapsible sections; styled unsaved-changes dialog; full Settings screen.
- **Resize handles only on selected node:** the `NodeResizer` uses `isVisible={selected}`, and a
  CSS rule (`.react-flow__node:not(.selected) .react-flow__resize-control { display:none }` in
  `app/renderer/styles/global.css`) guarantees unselected nodes never show resize handles/lines.
  Selecting another node moves the handles; clearing selection hides them. Resize + persistence
  still work.
- **Protected Login Handoff:** the runner detects protected/automation-blocked login pages
  (`src/security/ProtectedLoginDetector.ts` — Google/Microsoft/Okta/Auth0/Duo URLs + Google
  "browser may not be secure"/CAPTCHA/MFA/security-check text) after navigation steps, **pauses** the
  live runner/browser (`waitingForManualAction`) instead of bypassing, and shows a handoff card in the
  Instance Monitor (provider/reason/URL + Cancel Run / Continue / Retry Detection; OAuth/saved/test-session
  disabled-with-reason). Continue resumes the same in-flight flow via the shared
  `ManualHandoffController`; Retry Detection re-runs protected-login detection in place instead of repeating
  the whole instance from step 1. Also a `protectedLoginHandoff` Flow Designer node. OAuth foundation
  (`src/auth/OAuthHandoffService.ts` + `auth.*` IPC) is capability-gated via `WFS_OAUTH_*` env and uses
  `shell.openExternal`; no bypass, no fake tokens, no secrets logged. See
  `docs/PROTECTED_LOGIN_HANDOFF.md`.
- **Session Capture Browser (manual login workaround):** a Sessions Manager page
  (`app/renderer/pages/SessionsManager.tsx`, route `sessions` in the Data nav group) lets users
  capture login sessions by launching the system's **real Chrome or Edge browser** via
  `child_process.spawn` with a custom `--user-data-dir` — no Playwright, no CDP, no automation
  flags. The core service (`src/session/SessionCaptureService.ts`) detects installed browsers at
  standard Windows paths, creates named profile directories under `%LOCALAPPDATA%/WebFlow Studio/
  profiles/`, monitors the browser process, and saves metadata to `session-profiles.json`. IPC:
  `session.ipc.ts` (`session:list`, `session:startCapture`, `session:getStatus`, `session:delete`,
  `session:rename`, `session:detectBrowser`, `session:stopCapture`, `session:getById`,
  `session:markUsed`); preload `session.*`. When a workflow run includes a `sessionProfileId`,
  `execution.ipc.ts` resolves the profile directory and forces `persistentContext` isolation mode
  (`BrowserContextFactory.launchPersistentContext` with the session's `userDataDir`). This lets
  automation runs reuse the full login state (cookies, IndexedDB, Service Workers, localStorage)
  without triggering automation detection. Build & runner verified: `npm run build` clean,
  `npm run verify:runner` → 44/44.
- **Shared connector visuals + style customization:** `components/shared/connectorStyle.ts`
  (`buildConnectorVisual`) is the single source for edge visuals in both the Flow Designer and Workflow
  Builder, so connectors look identical. A shared `ConnectorStyleEditor` in both Connection Properties
  panels customizes color/line-style/thickness/shape/arrowhead; the style persists on `FlowEdge`/
  `WorkflowEdge` (`EdgeVisualStyle`) and reloads. Legacy connectors (no style) render with type defaults.
- **Flow Designer UX:** Node Palette has a search box (filter by label/type/description/category); long
  node-property dropdowns (JSON Data Source, Target flow, Saved Flow) use a searchable combobox
  (`SearchableSelect`). Clicking a Flows-table row opens that flow in the Flow Designer.
- **Flow Designer Smart Wait editing (2026-07-04):** saved steps preserve `beforeWaits`/`afterWaits`.
  Node Properties shows a Smart Waits section when a selected node has waits, split by before/after phase,
  with type/condition/reason details plus timeout editing, per-wait remove, and clear-list controls.
- **Route Change node (Flow Designer):** palette item + Route Change properties section (mode, URL
  match, URL value, wait-until) with mode-aware validation (incl. invalid-regex). At run time
  `StepExecutor` keeps a mutable `activePage` (+`setActivePage`) and `LocatorFactory.setPage` so later
  steps target the switched tab/page.
- **Workflow Builder navigation + resize + search:** double-clicking a workflow flow node opens that
  flow in the Flow Designer (persists `selections.lastSelectedFlowId` + `selectedBuilderWorkflowId`,
  navigates via the unsaved-changes guard; Back restores the workflow). Workflow nodes are resizable
  (`NodeResizer`, size persisted in `WorkflowFlowNode.size`). Saved Flows list has a name search and a
  10-at-a-time "Load More".
- **Save success/failure toasts:** Flow Designer and Workflow Builder show an app-styled `Toast`
  (`components/shared/Toast.tsx`) on save ("… saved successfully: <name>" / "Failed to save changes").
  The Data Source Editor uses its existing success/error banner.
- **Instance Monitor (Concurrent Instance Monitor):** Clear Completed removes terminal instances from the
  backend pool (so the 1s poll can't re-add them); per-instance + toolbar controls all map to real
  `executionEngine` methods; file/artifact buttons (Logs/Screenshots) are enabled ONLY for `failed`
  instances that have a path (disabled for completed/others, with status-specific tooltips). A per-instance
  **Repeat** button (`executionEngine.repeatInstance`) re-runs a finished instance from its retained
  run context (enabled only for terminal instances).
- **Workflow cards grid (primary run UX):** the monitor shows saved workflows as an enterprise-styled card
  grid (`components/instances/WorkflowRunCard.tsx`). Each card shows status (Active/Inactive/Invalid),
  flows/connectors/mode/data-source/updated, and reveals per-card run parameters on hover/keyboard focus
  (independent per workflow, seeded from `settings.execution`, persisted to `settings.workflowRunCards`).
  Run launches that workflow; **multiple workflows can run concurrently** (instance ids are globally unique
  per execution). Search filters by name/description; the grid **always renders every card** and, once the
  cards exceed two rows, becomes a two-row-tall internal scroller (no "Load More" button). The old
  dropdown form is collapsed behind an "Advanced / Classic run form". The instance table has a **Workflow
  column** (resolves `scenarioId` → name; deleted/unknown handled). Card `isolationMode`/`stopOnError` are
  passed through to the run; screenshot-on-failure is shown disabled (it's a per-step flow setting).
  The instance table's **Live Report** button (replacing the open-JSONL button) opens a human-readable
  `LiveExecutionReportModal`: live banner + heartbeat, connected horizontal **per-step process flow** with
  numbered status nodes, real progress bar, statistics cards, and a masked activity timeline. Failed steps
  show a friendly end-user message in the node, with masked technical details available only via hover/focus
  tooltip. Active/running/waiting/manual-action nodes animate; terminal runs show a stable final update time
  instead of an endlessly advancing "Updated" counter. **Live progress is now real:** `StepExecutor` emits per-step events via a
  `RunnerProgressReporter`; `ExecutionEngine` folds them into a bounded `InstanceRuntimeState.liveProgress`
  snapshot (≤500 steps / ≤200 events), which the renderer's 1s poll renders live. Once finished, the stored
  report (`reports.get(executionId)`) supplies the per-step detail. JSONL/report generation and execution
  behavior are unchanged.
  Cards are **equal-height** (fixed `min-height`) on a stable **3-column grid**
  (`repeat(3, minmax(0,1fr))`; 2 cols ≤1080px, 1 col ≤680px) so cards-per-row and dimensions stay the same
  before/after Load More. They use a **two-layer cross-fade** (summary ⇄ params) on hover/focus that does
  **not** change card height (no grid reflow). Search bar and Load More button are full content width.
- **Snapshot-based unsaved-changes detection:** Flow Designer (`FlowChartDesigner.tsx`) and
  Workflow Builder (`ScenarioBuilder.tsx`) compute `isDirty` by comparing an order-independent
  JSON serialization of the *saveable* document against a baseline captured on load and on save
  (`serializeFlowDoc` / `serializeWorkflowDoc`). The dialog appears ONLY for real document changes
  (node add/remove/move/resize, property edit, connector add/remove/change, metadata/data-source/
  execution-settings change). It does NOT appear on open, selection, zoom/pan, React Flow's initial
  node measurement, or after a successful save (baseline is reset to the saved doc).
- **Settings & state persistence:** `app/main/uiSettings.ts` store under
  `%LOCALAPPDATA%/WebFlow Studio/storage/ui-settings.json`; persists route, sidebar, panels,
  widths, zoom, selections (node/connector/flow/workflow/data source), table state, run defaults,
  paths, lastLaunchedAt. Custom paths are consumed by writers (flows/workflows/data sources/
  reports/screenshots/downloads/logs).
- **Recorder & runner** launch the **bundled Chromium** in production-offline mode.
- **Recorder AWKIT extensions (2026-07-04):** (1) **Capture waiting time** toggle in Recorder Controls
  (default OFF, persisted `settings.recorder.captureWaitTime`) — when ON, `RecorderService` measures
  think-time between distinct actions and inserts `wait` actions for pauses ≥ 500 ms (capped 60 s), saved
  as fixed-time wait steps (`config.waitType:"time"`, `timeoutMs`). (2) Recorded flows always open with
  default **Start** and **End** nodes and actions wired between them (`Start → action… → End`, or
  `Start → End` when empty) via the pure `src/recorder/buildRecordedFlow.ts` (unit-verified). (3) **Reusable
  saved-URL history** now lives in its own deduped/canonicalized `recorder-urls.json` (survives
  save/cancel/restart, separate from the transient action draft); `recorder:saveUrl` IPC + a "Save URL"
  button persist a typed URL, and clicking a saved URL row fills the Controls URL field. Verified by
  `npm run verify:recorder-draft` (17/17) and `npm run verify:recorder-flow` (13/13). (4) **Smart Wait
  observation** (default ON via `settings.recorder.captureSmartWaits`, visible Recorder toggle) passively
  observes loaders, fetch/XHR completion, URL changes, table/list/card data growth, enabled controls,
  toasts, and fixed-delay fallback windows, then stores high-confidence `afterWaits` on the preceding
  recorded action. It records method + URL path/status/timing only for network signals; never headers,
  bodies, cookies, query tokens, or response contents. The Recorder action list summarizes captured Smart
  Wait types. Verified as part of `npm run verify:recorder` (57/57).
- **Designer empty-canvas collapse (2026-07-04):** Clicking empty canvas in the Flow Designer and Workflow
  Builder collapses the app side menu (`navigation.collapseSidebar()`), Node Palette / Workflow Definition,
  and Node Properties / Selected Connector panels (collapse-only, idempotent, persisted). Node selection
  still auto-opens the properties panel; connector selection opens the connector panel (Workflow Builder
  expands its right panel on edge click). Last-opened flow/workflow restore now clears a stale reference
  when the saved flow/workflow was deleted.
- **Instances two-row card scroller (2026-07-04):** The workflow-card grid always renders every card; the
  "Load More workflows" button was removed. Once the cards exceed two rows
  (`filteredWorkflows.length > visibleCardCount(gridColumns, 2)`), the grid becomes a **two-row internal
  scroller** (measured height + `.workflow-card-grid.is-scrolling`) so the rest of the Instances page stays
  put; at two rows or fewer it renders at natural height with no scroller.
- **Recorder unique locators + Smart Wait observation (live-verified, `npm run verify:recorder` → 57/57):** the injected capture
  script (`src/recorder/recorderInitScript.ts`) generates ranked candidate locators (role/label/
  placeholder/text/testId → stable attributes → id → scoped → positional fallback — never utility/layout
  classes like `flex`/`items-center`), validates uniqueness against the live DOM, and saves the best
  `count === 1` candidate with `LocatorQuality` metadata (`isUnique`/`matchCount`/`confidence`/`warning`/
  `candidateCount`) + an `exact` flag for role/text. The positional fallback (`structuralSelector`) is
  itself guaranteed unique: it walks up prepending one `:nth-child` segment per ancestor and stops at the
  shortest path that resolves to a single element (or an id-anchored path), so it no longer emits floating
  child-chains like `div > div > … > svg` that match many subtrees. Human-readable step names ("Click Log
  in"); password values are never stored. Node Properties shows locator quality and won't mark a non-unique
  node valid.
- **Smart Locator runtime fallback + context scoping (live-verified, part of `verify:recorder` 57/57):**
  `FlowStep.locator` is a structured `StepLocator` (`src/profiles/FlowProfile.ts`) with the primary plus
  optional `alternatives: LocatorCandidate[]` (ranked runtime fallbacks) and `context` (container/frame
  scope). The recorder emits both: up to 3 alternatives and a `context` for the nearest **visible dialog**
  (`visibleOnly`), **table row** (role=row + row text), **card/list item** (testId/role + `hasText`), or
  **iframe** (`frameLocator` selector, same-origin). At run time `LocatorFactory.resolve(step)` builds a
  scoped root from `context`, then tries primary → alternatives, returning a **single** element per
  candidate — a unique match wins, else the one *visible* match when several exist (**visibility
  disambiguation**, the fix for a hidden modal template + a visible modal). It auto-waits on the primary
  when nothing is present yet, and throws an actionable diagnostic (per-candidate count/visibleCount +
  context) when genuinely ambiguous. `StepExecutor` routes single-target actions through `resolve` (count
  assertions / element loops / `waitFor` keep the plain `create`); `guardLocatorQuality` defers to the
  resolver when a step has `context`/`alternatives`. Fully backward compatible — legacy steps (primary
  only) resolve unchanged. Playwright is 1.49 (no `filter({ visible })`); visibility is probed via
  `nth(i).isVisible()`. Not yet surfaced in the UI (no locator-quality badge / debug candidates table /
  manual override editor).
- **Data Source visual table editor:** edit root-array JSON data sources as a table
  (cells/rows/columns), create from scratch, save real files to the configured data-sources path
  (bundled samples migrate on save). Logic verified by `npm run verify:data-editor` (27/27) incl. a
  real file read→edit→save round-trip; GUI not exercised here.
- **Mock Site Feature Test Lab (2026-07-04):** `mock-site/` is the mandatory local offline test surface for
  Recorder, Runner, Smart Wait, Flow Designer, Workflow Builder, Instance Monitor, locator, node, wait, and
  execution work. Stable URLs: `/` (scenario index), `/login`, `/form`, `/details`, `/success`,
  `/smart-waits`, `/recorder-lab`, `/designer-lab`, and `/api/delay?ms=...`. New/changed scenarios must
  document title/description/expected behavior/related feature/stable selectors in `mock-site/README.md`
  and be covered by `npm run verify:mock-site` or a focused feature verifier. Current verifier:
  `npm run verify:mock-site` -> 28/28.
- **Test-only mock fixtures** (new): `npm run seed:mock-fixtures` imports 10 flows, 3 workflows, and
  1 data source (all `mock-` prefixed) that target the offline mock-site into the runtime userData
  folders. Source fixtures live in `resources/test-fixtures/mock-site/` (excluded from packaged
  builds). They do NOT auto-load — a fresh install still shows empty Flows/Workflows/Data Sources.
  See `resources/test-fixtures/mock-site/README.md`.

## Partially implemented / to verify

- **Both connector canvases are GUI-VERIFIED in the real app (2026-07-03).** The un-clipped ports,
  top loop port, semicircle self-loop, add/remove loop toggle, conditional-lock, and real second-branch
  drag/delete survivor-revert path were driven in the **real running Electron app** via
  `npm run verify:flow-designer` (Flow Designer, 19/19) and `npm run verify:workflow-builder` (Workflow
  Builder `.scenario-flow-node`, 13/13, on saved "Mock — Data-Driven Workflow") — both Playwright
  `_electron` scripts. `npm run build` (clean), `npm run verify:runner` (76/76), and
  `npm run validate:offline` also pass. The `npm run dev` launch blocker was root-caused and fixed (it was
  `ELECTRON_RUN_AS_NODE=1` in the agent env, not a version mismatch — see below).
- **Clean-machine GUI walkthrough not yet performed** — the human offline-VM test in
  `docs/OFFLINE_STANDALONE_PACKAGING.md` is still the final gate before declaring production-ready. Current
  portable and NSIS EXEs were rebuilt on 2026-07-03 and strict offline validation passed, but the required
  separate offline Windows VM walkthrough has not been performed in this checkout.
- **EXEs are unsigned** — Windows SmartScreen will warn on first launch (no code-signing configured).
- **`@playwright/test` runner** cannot load the TS/ESM config on Node 18.16 (needs Node ≥18.19);
  the committed `tests/runner.mocksite.spec.ts` runs there, but live verification here uses the
  `tsx` script `scripts/verify-runner.mts` instead.

## What must NOT be broken

- Offline-first guarantees (no runtime internet, no global Node/Playwright/Chromium, no writes to
  `resources/`/`app.asar`).
- The `window.playwrightFlowStudio` preload API contract (used across the renderer).
- The dependency-manifest must stay valid + BOM-free and reference `WebFlow Studio` paths, or the
  packaged startup gate / strict validation will fail.
- Bundled-Chromium resolution (`BundledBrowserResolver` → `resources/browsers/chromium/chrome.exe`).

## Current technical debt

- Renderer bundle is large (~900 KB JS) — no code-splitting.
- No automated lint; no unit-test suite beyond the runner verification script.
- Historical product spec docs (`playwright_flow_studio_updated_phases/`, some `change_requests/`)
  still say "Playwright Flow Studio".
- Runtime data root renamed to `WebFlow Studio`; data under the old `PlaywrightFlowStudio` folder
  is not migrated (acceptable pre-1.0).

## Next logical steps

1. Perform the clean-machine offline GUI walkthrough (then update this file + TASK_LOG).
2. Optional: code-signing for the installer/exe.
3. Optional: `lastSelectedNodeId/Connector` restore-on-open, renderer code-splitting.

## Unknown / Needs Verification

- Real behavior on a clean offline Windows VM (untested here).
