# KNOWN_ISSUES

Evidence-based. Update when a task reveals a repeated bug, fragile area, or risky assumption.

## Confirmed (observed during development)

- **Conditional/parallel connectors are a two-port branch PAIR (2026-07-03) — invariant, now fully
  GUI-verified.** A node's source (right) side is either a single `normal-out` port or a same-kind branch
  pair (`<kind>-out-0/1`, max 2 connectors), never a mix — enforced by construction (the UI only exposes
  the current mode's ports) and `reconcileBranchConnectors` (`connectorStyle.ts`), which slots each pair and
  reverts a lone survivor to Normal on deletion. **Trap:** do NOT collapse the per-slot handles back to a
  single shared `conditional-out`/`parallel-out` handle — that reintroduces the old bug where two branch
  connectors overlapped and "only one worked". **React Flow dynamic-handle trap:** when port visibility
  changes, node components must call `useUpdateNodeInternals(id)`; without it the ports render visually but
  real drag-connections can miss the new handles. Verified by `npm run verify:flow-designer` **18/18**,
  including a real drag from `conditional-out-1` to create the second branch and deletion of one branch to
  confirm the survivor auto-reverts to Normal.
- **RESOLVED & ROOT-CAUSED (2026-07-03): the `npm run dev` "Electron launch crash" was `ELECTRON_RUN_AS_NODE=1`
  in the agent/sandbox environment — NOT a Node/Electron version mismatch or an ESM/CJS code bug.** Three
  earlier sessions misdiagnosed this. `ELECTRON_RUN_AS_NODE=1` makes the Electron binary boot as plain
  Node.js (skipping all Electron init): `require("electron")` returns the binary *path string* (no `app`/
  `BrowserWindow`), and an ESM main entry gets loaded by bare Node — which is what produced `TypeError:
  Cannot read properties of undefined (reading 'exports')` in `node:internal/modules/esm/translators` and
  the `Node.js v20.18.3` trace (Electron's bundled Node running as node). Diagnosis: `env | grep -i electron`
  → `ELECTRON_RUN_AS_NODE=1`; clearing it (`unset ELECTRON_RUN_AS_NODE` / `Remove-Item Env:ELECTRON_RUN_AS_NODE`)
  and launching makes the GUI window open normally. **Fix in-repo:** `npm run dev` now runs
  `node scripts/dev.mjs`, which deletes `ELECTRON_RUN_AS_NODE` from the child env before spawning
  `electron-vite dev` (a no-op on normal machines where it isn't set). Note: switching the main process
  to CommonJS was explored and then reverted — the ESM main launches fine once the env var is cleared, so
  the module format was never the problem. If you see this crash, check `ELECTRON_RUN_AS_NODE` first.
- **Node cards with `overflow: hidden` + `position: relative` clip child React Flow handles (2026-07-03,
  fixed).** The prior bugfix added `position: relative` to `.action-flow-node`/`.scenario-flow-node` (to
  anchor the loop button). Combined with the cards' pre-existing `overflow: hidden`, that made the card the
  offset parent for the `<Handle>` elements rendered *inside* it — and the edge-hugging handles (which sit
  half outside the card box via `translate(-50%, …)`) got **clipped**, i.e. "port rendering corrupted".
  Fix: render the handles as **siblings** of the `<article>` (not children) so they position against the
  un-clipped `.react-flow__node` wrapper. **Trap to remember:** custom React Flow node components must not
  put `<Handle>`s inside an element that both establishes a containing block (`position: relative/absolute`)
  and clips (`overflow: hidden`) — keep handles as siblings of the clipped card.
- **Loop connector redesigned to a top port + semicircle (2026-07-03) — supersedes the right-side loop
  anchors below; NOW GUI-VERIFIED (13/13).** After a GUI test, the previous invisible right-side co-located
  loop anchors were found not to reliably render/attach (they were gated behind `flags.loop`, which only
  becomes true *after* the edge exists) and the sideways arc overlapped the node so the loop read as "not
  created / not deletable". Replaced with a dedicated **top** `loop-out`/`loop-in` handle pair
  (`ConnectorLoopPort`, always present so the edge attaches immediately, visible only when a loop exists),
  and `SelfLoopEdge` now detects the self-loop via `source === target` and draws a **semicircle above** the
  node. The node loop button became an add/remove **toggle** (reliable delete path). `onConnect` in both
  canvases now forces new connectors to Conditional when the source node has a self-loop. Backward
  compatible (same handle ids). **Verified in the real Electron app on BOTH canvases** via
  `npm run verify:flow-designer` (Flow Designer 18/18, `scripts/verify-flow-designer-gui.mjs`) and
  `npm run verify:workflow-builder` (Workflow Builder `.scenario-flow-node`,
  `scripts/verify-workflow-builder-gui.mjs`) — Playwright `_electron`, **13/13 each**: ports render
  un-clipped as card siblings, Add Loop creates a visible edge, the top loop port becomes visible on the
  node's top edge, the loop draws as a semicircle above the node, the button toggles to Remove and deletes
  the edge (top port hides), and a loop node locks its outgoing connectors to Conditional (properties
  panel / Link Type selector).
- **[SUPERSEDED by the two entries above] Connector ports/loop button fixed after user-reported GUI bugs
  (2026-07-03) — still not visually confirmed.** A user manually testing the Flow Designer/Workflow Builder
  (after the AWKIT points 1–5 work below was merged typecheck/build-only) found three real bugs, now fixed
  in code but only
  typecheck/build/`verify:runner`-verified (see the Node 20 dev-launch issue above for why): (1) the
  Loop kind selector was unusable because it required a manual drag-connect of a node to itself —
  replaced with a dedicated "Add loop" button (small circular icon, top-right of the node) in both
  `ActionFlowNode.tsx` and `ScenarioFlowNode.tsx` that programmatically creates the self-loop edge;
  (2) dragging a new connector from a conditional/parallel port did nothing useful — both canvases'
  `onConnect` ignored `connection.sourceHandle`/`targetHandle` and always created a "normal" edge
  snapped to the normal port; fixed via `connectorPortKindFromHandle()` in `connectorStyle.ts`; (3)
  conditional/parallel ports on the same side were hardcoded to `top: 30%`/`70%` instead of centering
  as a group — fixed via `portPositions(count)`. Separately, `portHandlesForKind("loop")` used to reuse
  the always-present `normal-out`/`normal-in` handles, which sit on **opposite sides** of the node, so
  `SelfLoopEdge`'s `isSelf` check never fired and a self-loop rendered as a giant arc instead of a tight
  circular/retry-icon shape — fixed with a dedicated co-located `loop-out`/`loop-in` handle pair (both
  `Position.Right`, same offset, invisible/`pointer-events:none`). **The actual drag/click interactions
  and the rendered arc/port positions have not been eyeballed in a running app** — do the manual GUI
  check before calling this done.
- **Structured connector model implemented (checkpoint B) — with scoped limits.** `ConditionalConnectorConfig`,
  `ParallelConnectorConfig`, and `LoopConnectorConfig` now drive routing/execution/UI/validation. Remaining
  gaps: (a) parallel `sharedPage` mode (default) is sequential fan-out; `isolatedPage` mode runs branches
  concurrently but isolated `failFast` only reports failure after in-flight branches settle (no hard-abort);
  (b) loop connectors repeat a **single node** (themselves — see below), not an arbitrary multi-node branch.
  (The loop `dataSource` dropdown and live-report connector events are implemented.) Legacy expression-based
  edges remain fully supported.
- **Loop connectors are self-loops; connector-structure rules block Save (AWKIT points 1–5).** A `loop`-kind
  connector's source and target must now be the **same node** (`validateConnectorStructure` in
  `src/profiles/FlowProfile.ts`, enforced by `FlowExecutor.executeFlow` at the top of every run, and by
  `connectorStructureIssues`/`scenarioConnectorStructureIssues` in the Flow Designer/Workflow Builder, which
  block Save). The legacy `loopBack` edge type (Enhanced Connectors, Phase 1) is **exempt** — it remains an
  intentional cross-node back-edge; only the new structured `loop` kind is self-only. `FlowExecutor`'s main
  loop now detects a self-loop edge on the current node *before* its normal single execution and runs the
  whole loop in place via `executeLoopConnector`, then continues via the node's own (Conditional) exit edge.
  Two more structural rules are enforced the same way: a node may have **at most one standard
  (non-conditional/non-parallel) outgoing connector**, and a node with a self-loop **forces every other
  outgoing connector to be Conditional** (both the Flow Designer and Workflow Builder kind/link-type
  selectors disable the other options and explain why; both also block Save with a specific message).
  **Dynamic ports (Point 1):** `ActionFlowNode`/`ScenarioFlowNode` always show one `normal` handle per side;
  a `conditional`/`parallel` handle additionally renders on a node once an edge of that kind actually
  touches it (`computePortFlags` in `app/renderer/components/shared/connectorStyle.ts`, rendered by the
  shared `ConnectorPorts.tsx`). Ports are **derived at render time** from each edge's kind, not persisted —
  `portHandlesForKind` recomputes `sourceHandle`/`targetHandle` on edge create/kind-change/load, so no
  `FlowEdge`/`WorkflowEdge` schema change was needed. **Runtime guard parity:** the Workflow Builder's
  connector-structure rules now also run through `FlowDependencyResolver`/`ScenarioOrchestrator` before
  execution, so bypassed invalid workflow graphs fail validation at runtime. **Circular shape (Point 5):** `EdgeVisualStyle.shape`
  gained `"circular"`; a shared `SelfLoopEdge.tsx` (registered as React Flow edge type `circular` in both
  canvases) renders self-loops as an arc bulging outside the node. Loop connectors default to `circular`
  shape automatically when created. **Workflow Builder scope note:** `ScenarioLink`/`WorkflowEdge` have no
  separate `kind` field — `scenarioEdgeKind()` derives kind from the legacy `type` string the same way
  `connectorKind()` does for `FlowEdge`; workflow execution remains dependency/routing based rather than a
  full `FlowExecutor` equivalent, but the connector-structure safety checks now run before execution.
- **Parallel `sharedPage` mode is sequential fan-out (by design).** `FlowExecutor.executeParallelTargets`
  runs each branch one-after-another on the current page — this is the shared-page safety guard (no concurrent
  UI mutation). Concurrency is available via `isolatedPage` mode (`executeParallelIsolated`): each branch runs
  on its own page in the shared browser context (shared session, independent DOM), bounded by `maxConcurrency`.
- **Auto Secure Login / Reuse Session not exercised against real Chrome here.** `executeAutoSecureLogin`
  and `executeReuseSession` are verified only via mocked `SessionCaptureService` in `verify-runner.mts`.
  The real path (close automation browser → spawn system Chrome → user logs in → relaunch
  `persistentContext` on the captured `userDataDir`) needs the clean-machine GUI walkthrough. Auto Secure
  Login's poll loop blocks the instance for up to `timeoutMs` (default 10 min) while the user logs in.
- **Clean-machine GUI walkthrough not done.** The offline-VM walkthrough in
  `docs/OFFLINE_STANDALONE_PACKAGING.md` is the production-ready gate and has not been run.
- **EXEs are unsigned.** `electron-builder` reports "signing is skipped"; Windows SmartScreen will
  warn on first launch. No code-signing is configured.
- **RESOLVED (2026-07-03): manual/protected-login handoff no longer dead-ends.** `StepExecutor` now pauses
  through the shared `ManualHandoffController` and waits inside the live runner/browser instead of returning
  terminal `manualHandoff` to `PlaywrightRunner.executeScenario`. `ExecutionEngine` surfaces
  `waitingForManualAction` from live progress, keeps the queue active, and exposes Continue (`resumeInstance`)
  plus in-place Retry Detection (`retryHandoff`); Cancel resolves the pending controller promise and closes
  the browser through the normal runner `finally`. Verified by `npm run verify:runner` (manual handoff pauses
  without finishing the scenario, resumes in place, and runs the next browser step). **Trap:** do not map
  Retry Detection back to `repeatInstance`, and do not treat `waitingForManualAction` as terminal while a
  runner promise is still alive.
- **PowerShell-written JSON + BOM.** `Set-Content -Encoding UTF8` (Windows PowerShell 5.1) writes a
  UTF-8 BOM that breaks Node `JSON.parse`. This already bit the dependency manifest twice
  (manifest "missing/invalid JSON"). Generator now writes BOM-free and loaders strip a leading BOM —
  keep this in mind for any new PowerShell-generated JSON the app reads.
- **`@playwright/test` runner needs Node ≥18.19.** On Node 18.16 it errors loading the TS/ESM
  config (`Unknown file extension ".ts"`). Use `npm run verify:runner` (tsx) instead.
- **Rename ripple risk.** The product rename (Playwright Flow Studio → WebFlow Studio) touched the
  window title, manifests (+validators in PS and TS), runtime data root, and appId. The validators
  must agree on `WebFlow Studio`; a missed validator previously failed the packaged startup gate.

## Fragile areas (handle with care)

- **Node Palette is a fixed-row CSS grid — keep `grid-template-rows` in sync with its children.**
  `.flow-node-palette` uses `grid-template-rows: auto auto minmax(0, 1fr)` for its three direct children
  (header / search bar / scrollable list). Adding/removing a direct child without updating the row count
  pushes a child into the `1fr` track and stretches it (this corrupted the search bar once). The search
  input must stay an `auto` row; only the list gets `minmax(0,1fr)` so `overflow:auto` works.
- **`<td>`/`table` must keep table display for column alignment.** A global `table { display:block }`
  rule exists (for legacy horizontal scroll); `.instance-table` overrides it with `display:table` so
  `table-layout:fixed` + `<colgroup>` align columns. Never put `display:grid`/`flex` on a `<td>` (e.g.
  `.instance-name-cell`) — it drops the cell from the column model and shifts every column. Stack
  multi-line cell content with block children instead; scroll via the `.instance-table-wrapper`.

- **Live Report modal: freeze time + stop polling on terminal state (FIXED — don't reintroduce).**
  The Instance Monitor re-renders the modal ~every 1s (its instance poll). Deriving `now = new Date()`
  each render made the banner "Updated" value tick forever, even after the run ended. For terminal
  statuses (`completed/done/succeeded/failed/cancelled/skipped/stopped/error`) the model now uses a stable
  `updatedAt` (`scenario.endedAt ?? instance.endedAt ?? snapshot.updatedAt`) and shows a fixed "Last
  updated" time; only active runs show live relative time. The modal's own `reports.get` interval must run
  **only while live**, be cleared on close/unmount, and do a single delayed final fetch after the terminal
  transition — never leave a per-modal interval running. Failed steps show a friendly message; the raw
  error is masked (`safeTechnicalError`) and shown only on hover — never render raw errors/JSON/secrets in
  the main UI.
- **Bundled-browser path coupling.** The packaged path is `process.resourcesPath/resources/...`
  (note the double `resources/resources`) and must match `getResourcesRoot()` + `BundledBrowserResolver`.
  In packaged builds `playwright-core` ends up **nested** under `playwright/node_modules` (asar-unpacked).
- **Settings deep-merge.** `uiSettings.ts` deep-merges known groups; adding a new settings group means
  updating `hydrate`/`mergePatch` and defaults, or partial updates will drop fields.
- **Connector conditions fail silently.** A condition referencing a non-existent output resolves to
  `undefined` → false → the branch is skipped (falls through to success/always/next). Typos don't error.
- **Runner ↔ main coupling.** `src/runner/ExecutionEngine` imports `app/main/appPaths`; keep that the
  only renderer/main bridge or you risk import cycles in the "framework-agnostic" core.
- **Dirty-state must ignore React Flow's measurement churn (FIXED — don't reintroduce).** React Flow
  emits `dimensions` node changes during its initial measurement and elevates selected nodes in the
  array. The unsaved-changes flag must NOT key off raw `onNodesChange` events or array order, or the
  dialog fires on open/selection. Both editors now derive `isDirty` from an order-independent
  serialization of the *saveable* document (`serializeFlowDoc`/`serializeWorkflowDoc`, id-sorted)
  compared to a baseline captured on load and reset on save. Don't go back to a string-state heuristic
  or a `handleNodesChange` dirty toggle.
- **Data-source files vs profile metadata (FIXED — don't reintroduce).** The data-source
  `JsonProfileStore` writes profile metadata as `<dataSources>/<id>.json` and reads every top-level
  `*.json` there as a profile. User data files must therefore NOT be written to that folder's top
  level — they live in `<dataSources>/files/`. Writing a data file named `<id>.json` to the store
  folder previously let `store.import` overwrite the array with the profile object (editor then
  showed "not a root array of objects"). See `app/main/ipc/dataSource.ipc.ts` (`dataFilesDir`,
  `resolveDataFile`).

## Risky assumptions / to verify

- **Recorder data (actions + captured URLs) is in-memory and session-scoped.** `RecorderService` keeps
  `actions` and `recordedUrls` in the main-process singleton for the current start→stop session; they
  survive navigating away/back to the Recording screen but NOT an app restart (same as recorded actions).
  Captured URLs mask sensitive query values (`maskUrl`) BEFORE storage — never store/log raw tokens. If a
  future task needs persistence, add a JSON store (don't assume it exists today).
- **Saved sessions are sensitive plaintext local files.** The Save Session node writes Playwright
  `storageState` (cookies + localStorage) under `%LOCALAPPDATA%/WebFlow Studio/sessions/`. There is no
  encryption — they are protected only by the user profile's filesystem permissions. Never commit them,
  never write them into `resources/`/`app.asar`/source, and never log their contents. A complementary
  **Load Session** node is future work (not implemented; no no-op button shown).
- **Connector `style` is optional + normalized.** `normalizeEdgeStyle` drops invalid color/shape/line/
  thickness/arrow values, and `hasCustomStyle` strips empty styles on save, so legacy edges without
  `style` keep type-default visuals. Both designers must keep using `buildConnectorVisual` (don't inline
  edge styling) or the two canvases will drift again.

- **Instance Monitor "Clear Completed" must remove from the backend pool (FIXED — don't reintroduce).**
  The monitor re-fetches `executions.list()` every 1s, so filtering only local React state let cleared
  rows reappear on the next poll. Clear Completed now calls `executions.removeInstance` for each terminal
  instance (the engine refuses to remove active ones). Don't revert to a local-only filter.
- **Route Change page-switch is per-StepExecutor.** `activePage` switches affect the current flow's
  StepExecutor only; a Route Change inside a child flow doesn't change the parent flow's active page.
  Fine for the intended within-flow tab-switch use case.
- **Instance ids must stay globally unique (don't revert).** `InstancePool` keys by `instanceId`;
  `InstanceManager` mints `${executionId}-i${n}`. Reverting to `instance-${n}` would let two concurrent
  workflow runs overwrite each other in the pool (the workflow-cards UX relies on concurrent runs).
- **Run-card screenshot-on-failure is per-step, not run-level.** The card shows the toggle disabled with a
  tooltip — the engine has no run-level screenshot flag; it's controlled by each flow step's
  `onFailure.screenshot`. Don't wire it as a run param (it would be a no-op/fake control).
- **Workflow-cards "Load More" uses measured grid columns.** Visible cards = (columns measured via
  `ResizeObserver` on `grid-template-columns`) × rows. The grid is a **fixed 3-column** layout
  (`repeat(3, minmax(0,1fr))`, → 2/1 cols on smaller widths) — deliberately not `auto-fit`, because the
  rendered column count must NOT depend on how many cards exist (otherwise Load More reflowed the row,
  changing cards-per-row and card width). Don't switch back to `auto-fit`/`auto-fill` for this grid.
- **Workflow-card hover reveal must not change height (don't reintroduce).** The card body holds two
  absolutely-positioned equal-area layers (`.workflow-card-summary`/`.workflow-card-params`) that cross-fade
  on `:hover`/`:focus-within`; the card has a fixed `min-height`. Don't go back to a `max-height` expand
  reveal — it reflowed the grid on hover. Hidden params use `opacity:0` + `pointer-events:none` (still
  tab-focusable, so keyboard focus reveals them).
- **Protected-login pause leaves the instance in `waitingForManualAction` (not terminal).** The queue
  (`ExecutionEngine.processQueue`) treats `waitingForManualAction` as run-complete so the run doesn't loop
  forever and the report still writes, but the instance stays in that state until the user picks Cancel
  (stopInstance) or Retry (repeatInstance) in the handoff panel — there is no auto-timeout yet. Don't make
  the runner auto-continue past a protected login.
- **Load Session / OAuth callback are foundation-only.** "Use Saved Session" and "Use Test Session" are
  intentionally disabled-with-reason (Load Session unimplemented). OAuth is gated by `WFS_OAUTH_*` env and
  only opens the system browser — there is no callback/token handling, and none must be faked.
- **Repeat (single-instance re-run) needs the in-memory run context.** `ExecutionEngine` retains a
  `RunContext` per execution (flows/scenario/dataSources/dirs/inputs) so `repeatInstance` can re-run a
  finished instance. This map is in-memory only — after an app restart the context is gone and Repeat
  reports "run context no longer available (re-run the workflow)." Repeat also doesn't regenerate the
  aggregate run report (the run's report array was already flushed); artifacts in the instance paths are
  overwritten by the re-run.
- **Resizable canvas nodes must fill the React Flow wrapper.** A node article with a fixed `width`/no
  `height:100%` makes `NodeResizer` handles misalign from the visible node. Both `.action-flow-node` and
  `.scenario-flow-node` use `width/height:100%` + `box-sizing:border-box` — keep that for any new
  resizable node type.
- **Recorder records tab switches, not in-tab navigations.** `RecorderService` emits a `routeChange`
  action only when an interaction occurs on a *different* page object than the last recorded one (new
  tab). Same-tab URL changes are not recorded as Route Change by design (avoids noise).
- **Recorder locator uniqueness is DOM-approximated, not Playwright-engine-exact.** The injected
  `recorderInitScript.ts` counts role/label/text matches with a compact DOM heuristic (role map +
  accessible-name approximation), so a saved `matchCount` can differ slightly from Playwright's real
  locator engine on exotic ARIA markup. Counts are also capped at `>5` for performance. The runner's
  live strict-mode translation (`friendlyLocatorError`) is the backstop if a "unique" locator turns out
  ambiguous at run time.
- **`addInitScript` must be registered before the target document loads.** `RecorderService` injects the
  capture script *before* `page.goto(target)`, which is why it works. Tests must add the init script
  before `newPage()` (or use `page.goto(data:…)`); a `setContent()` on a page created *before*
  `addInitScript` may not run it (see `scripts/verify-recorder-locator.mts`).
- **Recorder capture script must stay self-contained.** Everything used by `installRecorderCapture`
  lives inside that one function (only browser globals + the `__awtkit_recordAction` binding), because
  it is serialized via `Function.prototype.toString()`. Do not extract helpers to module scope or
  reference imports; `getRecorderInitScriptContent()` shims esbuild's `__name` (added by `tsx`/keepNames)
  so injection survives different bundlers.
- Concurrency/worker isolation (`RunnerWorkerHost`/`RunnerWorker`) is not load-tested.
- Form Designer and Runtime Input end-to-end flows are not covered by `verify:runner`.
- Large renderer bundle (~900 KB) — fine for desktop, but no code-splitting.

## Repeated problems pattern

- When packaging fails at the startup gate, the cause has historically been a **manifest** issue
  (BOM or stale path/name), not a missing file. Check `resources/dependency-manifest.json` first.
