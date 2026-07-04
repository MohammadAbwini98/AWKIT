# ARCHITECTURE

## Confirmed — folder/module map

```text
app/
  main/                 Electron main process
    main.ts             app bootstrap + offline startup gate
    windowManager.ts    BrowserWindow (title, icon)
    preload.ts          contextBridge → window.playwrightFlowStudio (IPC API)
    appPaths.ts         runtime data root, resources root, isProductionOffline()
    uiSettings.ts       persisted settings store (UiSettings) + validation
    storagePaths.ts     getConfiguredPaths() — resolves user Settings paths w/ fallback
    offlineRuntimeValidator.ts
    profileStores.ts    JSON profile stores (flows/workflows/dataSources/reports/...)
    ipc/                IPC handlers: flow, scenario(workflow), execution, instance,
                        dataSource, runtimeInput, report, recorder, settings, system, offlineRuntime
  renderer/             React UI (Vite)
    App.tsx, routes.tsx, main.tsx
    pages/              Dashboard, FlowChartDesigner, ScenarioBuilder, Flow/WorkflowsLibrary,
                        DataSourceManager, RuntimeInputPanel, FormDesigner, Recorder,
                        InstanceMonitor, ExecutionMonitor, ExecutionReports, OfflineRuntimeStatus,
                        Settings, ImplementationRoadmap, ProjectContract, WorkflowDesigner
    components/         workflow/ (nodes, registry, panels, zoom), table/ (state+UI),
                        data-binding/, reports/, scenario/, shared/
    layout/             AppShell, TopHeader, LeftNavigation, StatusBar, DesignerCanvasLayout, RightPropertiesPanel
    state/              navigation.tsx, pageChrome.tsx (header actions + dirty flag)
    styles/global.css   single plain-CSS stylesheet
src/                    framework-agnostic core (no Electron/React imports, except runner→appPaths)
  runner/               PlaywrightRunner, FlowExecutor, StepExecutor, ExecutionEngine,
                        BrowserContextFactory, LocatorFactory, ValueResolver, ExpressionEvaluator,
                        ConnectorConditionEvaluator (structured conditional connectors),
                        ManualHandoffController, BrowserProcessManager, RunnerWorker(Host), RunnerResult
  session/              SessionCaptureService (real Chrome/Edge capture), SessionProfile,
                        sessionMatch (normalizeOrigin / findBestSessionForUrl)
  orchestrator/         ScenarioOrchestrator, FlowOrchestrator, FlowOrderResolver, FlowDependencyResolver,
                        ConditionalFlowRouter, ConcurrentExecutionCoordinator, ExecutionQueue, FlowOutputRegistry
  instances/            InstanceManager, InstancePool, InstanceConfig/State, ConcurrentRunProfile
  profiles/             FlowProfile, WorkflowProfile, ScenarioProfile (+ conversions)
  data/                 DataSourceProfile, DataBinding, JsonPathResolver, RuntimeInputDefinition,
                        TableEditing (pure helpers for the data-source table editor)
  offline/              BundledBrowserResolver, OfflineRuntimeValidator, ProductionStartupCheck,
                        PortablePathResolver, DependencyManifest, NoInternetGuard
  reports/, storage/, recorder/, project/, roadmap/, utils/
resources/              bundled assets: browsers/chromium, dependency-manifest.json,
                        offline-runtime.json, sample-flows/-workflows/-scenarios/-data, icon.*,
                        test-fixtures/mock-site (test-only fixtures, excluded from packaged builds)
vendor/                 offline vendor copies (browsers, dependency-manifest, native-modules, npm-cache)
scripts/                PowerShell packaging/offline scripts + generate-app-icon.mjs +
                        verify-runner.mts + verify-data-editor.mts + verify-instance-monitor.mts +
                        seed-mock-fixtures.mjs + ai-memory/check-memory.mjs
mock-site/              offline test website (node http server) for runner verification
tests/                  runner.mocksite.spec.ts (@playwright/test)
docs/                   IMPLEMENTATION_AUDIT.md, OFFLINE_STANDALONE_PACKAGING.md, ai/
playwright_flow_studio_updated_phases/   master product spec (historical name)
change_requests/        historical change-request prompt sets
```

## Confirmed — process & data flow

- **Renderer ↔ main:** renderer calls `window.playwrightFlowStudio.<area>.<method>()` (preload
  contextBridge) → `ipcMain.handle` in `app/main/ipc/*` → profile stores / runner / settings.
  Data-source editor channels: `dataSources:readJson`, `dataSources:writeJson`,
  `dataSources:createFromScratch` (write to the configured data-sources folder; `resources/`
  samples are read-only and migrate on save). Editor route `dataSourceEditor` is hidden from the
  sidebar and opened from the Data Source Manager (target id via `selections.lastSelectedDataSourceId`).
- **Storage:** JSON files via `JsonProfileStore` (`src/storage`) under the runtime data root;
  seed samples from `resources/sample-*`. No database.
- **Build:** `electron-vite` builds `app/main` → `out/main`, `app/main/preload.ts` → `out/preload`,
  `app/renderer` → `out/renderer`. `tsc --noEmit` typechecks first. TS path aliases: `@main/*`,
  `@renderer/*`, `@src/*` (`tsconfig.json`).
- **Execution flow:** `execution.ipc` builds a `ConcurrentRunProfile` + resolved `StorageDirs`
  (from `getConfiguredPaths`) → `ExecutionEngine.startRun` → `InstanceManager` creates isolated
  instance contexts → `PlaywrightRunner.executeScenario` → `FlowExecutor.executeFlow` →
  `StepExecutor.execute`. Browser launched via `BrowserContextFactory`; in offline mode
  `executablePath` = bundled Chromium (`BundledBrowserResolver`). `ExecutionEngine` retains a per-execution
  `RunContext` so `repeatInstance(instanceId)` (IPC `execution:repeatInstance`) can re-run one finished
  instance. The `InstancePool` keys by `instanceId`, so `InstanceManager` mints globally-unique ids
  (`${executionId}-i${n}`) — this is what lets multiple workflows run concurrently without colliding.
  Per-card run parameters (`isolationMode`, `stopOnError`) flow through `RunWorkflowRequest` into the
  `ConcurrentRunProfile`. The cards' non-DOM logic lives in `src/instances/instanceCardLogic.ts`
  (filter / responsive visible-count / validation / name-resolve), unit-verified by
  `npm run verify:instance-monitor`. `WorkflowRunCard` is a fixed-height card with two absolutely-positioned
  layers (summary ⇄ params) that cross-fade on hover/focus — height stays constant so the fixed 3-column
  grid never reflows. The table's **Live Report** button opens `LiveExecutionReportModal.tsx`, which builds a
  per-step human-readable model (`executionReportModel.ts`) from `InstanceRuntimeState.liveProgress` while
  running and the stored report (`reports.get(executionId)`) once finished. Live progress: `StepExecutor`
  emits `RunnerProgressEvent`s (`src/runner/RunnerProgress.ts`) via `PlaywrightRunnerOptions.progress`;
  `ExecutionEngine.createProgressReporter` folds them into a bounded `liveProgress` snapshot (≤500 steps /
  ≤200 events) on the pooled instance, surfaced by the renderer's 1s `executions.list()` poll. JSONL/final
  report generation and execution behavior are unchanged. Waiting handoffs are also surfaced through live
  progress (`manualHandoff` detail on `RunnerProgressEvent`) so the engine can set
  `InstanceRuntimeState.status = waitingForManualAction` while the runner/browser stays alive.
- **Connector routing:** every `FlowEdge` has a structured `kind` (normal/conditional/parallel/loop; derived
  from legacy `type` when absent — see `connectorKind`). `FlowExecutor.resolveNext` evaluates **conditional**
  connectors first (`ConnectorConditionEvaluator`, highest `priority` wins; no match → safe stop), then legacy
  outcome/conditional expression edges, success/always, and loopBack. **Parallel** connectors run via
  `executeParallelTargets` — `sharedPage` (default) is sequential fan-out; `isolatedPage` is concurrent via
  `executeParallelIsolated` using a `ParallelBranchFactory` (new page in the shared context + its own
  `StepExecutor`), honoring join (waitAll/waitAny) / fail (failFast/collectErrors) / `maxConcurrency`.
  **Loop** connectors are **self-loops only** (`edge.source === edge.target`) — `executeFlow` detects the
  self-loop edge on the current node *before* its normal single execution and runs the whole loop in place
  via `executeLoopConnector` (count/staticList/dataSource/whileCondition), injecting the value under
  `parameterName` into `context.runtimeInputs`, then continues via the node's own exit edge (forced
  Conditional, see below). The legacy `loopBack` edge type (cross-node) is exempt from the self-loop rule.
  `FlowExecutor` emits connector timeline events via the injected `RunnerProgressReporter`.
  `PlaywrightRunner.chooseNextFlow` routes workflow links (outcome → conditional → success/loop → always);
  expression conditions use `ExpressionEvaluator` against `${outputs.*}` / `${runtimeInputs.*}` /
  `${instanceInputs.*}`.
- **Connector-structure safeguards (AWKIT points 1–5):** `validateConnectorStructure`
  (`src/profiles/FlowProfile.ts`) enforces three rules on `FlowEdge[]`: a loop connector must return to the
  same node; a node may have at most one standard (non-conditional/non-parallel) outgoing connector; a node
  with a self-loop forces every other outgoing connector to be Conditional. `FlowExecutor.executeFlow` calls
  it at the start of every run and fails safely if it finds a violation (defense-in-depth against a UI
  bypass). The Flow Designer (`connectorStructureIssues` in `FlowChartDesigner.tsx`) and Workflow Builder
  (`scenarioConnectorStructureIssues` in `ScenarioBuilder.tsx`, deriving kind from the legacy `type` string
  via `scenarioEdgeKind`/`connectorKind` since `WorkflowEdge` has no separate `kind` field) mirror the same
  rules and block Save; both kind/link-type selectors disable the disallowed options with helper text.
  `FlowDependencyResolver.validate()` now mirrors the same structure checks for `ScenarioProfile.links`,
  so `ScenarioOrchestrator.createExecutionPlan()` blocks invalid workflow graphs at runtime if they bypass
  the renderer Save gate.
  **Dynamic ports:** `computePortFlags`/`portHandlesForKind` (`app/renderer/components/shared/
  connectorStyle.ts`) derive per-node port visibility and per-edge `sourceHandle`/`targetHandle` purely at
  render time (nothing new persisted to `FlowEdge`/`WorkflowEdge`) — rendered by the shared
  `ConnectorPorts.tsx` (`ConnectorTargetPorts`/`ConnectorSourcePorts`) in `ActionFlowNode`/`ScenarioFlowNode`.
  Both node components call `useUpdateNodeInternals(id)` when `portFlags` change so React Flow refreshes
  dynamic handle bounds for real drag-connections.
  **Circular shape:** `EdgeVisualStyle.shape` gained `"circular"`; the shared `SelfLoopEdge.tsx` is
  registered as the React Flow edge type `circular` in both canvases (`edgeTypes` prop) and renders a
  self-loop arc; loop connectors default to this shape when created.
- **Auto Secure Login / Reuse Session:** `StepExecutor` is injected with a `BrowserRestarter` callback and
  the `SessionCaptureService` (from `ExecutionEngine`). `PlaywrightRunner` owns a mutable `BrowserHolder`;
  the restarter closes/relaunches the browser (persistentContext on a session profile dir) and re-points the
  live executor's active page. Sessions are matched by normalized origin (`sessionMatch`). Auto Secure Login
  returns `restartRequired`; `FlowExecutor` restarts the flow from Start (guarded by `MAX_AUTO_LOGIN_RESTART`)
  and a user-drawable `outcome`/`loopBack` edge is also supported.
- **Active-page switching (Route Change):** `StepExecutor` holds a mutable `activePage` (init from the
  constructor `page`) and `setActivePage()` which also calls `LocatorFactory.setPage()`. A `routeChange`
  step picks a different page/tab (existing-by-URL / latest / wait-for-new / navigate-in-place) and makes
  it active so subsequent steps' locators target it. Constructor signatures are unchanged (still take a
  `Page`), so existing call sites/tests keep working.
- **Save Session:** `StepExecutor.saveSession` writes `activePage.context().storageState()` to a JSON file
  under `context.paths.sessions` (set by `ExecutionEngine.runInstance` to `<runtimeRoot>/sessions`). It logs
  only the artifact path, never session contents.
- **Protected Login Handoff:** `src/security/ProtectedLoginDetector.ts` (detect) + `ProtectedLoginHandoff.ts`
  (`HandoffInfo` types). `StepExecutor` auto-detects after nav steps and on the `protectedLoginHandoff` node,
  pauses via the shared `ManualHandoffController`, emits waiting progress with the safe `HandoffInfo`, and
  waits inside the live runner/browser until Continue/Retry/Cancel resolves the controller promise.
  `ExecutionEngine` owns the shared controller, maps waiting progress to
  `InstanceRuntimeState.manualHandoff`, exposes Continue through `resumeInstance`, exposes in-place
  `retryHandoff`, and cancels pending handoffs through `stopInstance`. The queue treats
  `waitingForManualAction` as active, not terminal, while the runner promise is alive. UI:
  `components/auth/ProtectedLoginHandoffPanel.tsx`. OAuth: `src/auth/OAuthHandoffService.ts` +
  `app/main/ipc/auth.ipc.ts` (`auth:getCapabilities`/`openOAuth`/`openExternal`) + preload `auth.*`.
- **Recorder locator generation:** `RecorderService` injects `src/recorder/recorderInitScript.ts`
  (`getRecorderInitScriptContent()` serializes `installRecorderCapture` and shims esbuild's `__name`
  helper, then injects it via `context.addInitScript({ content })`). In the page DOM the script builds
  ranked candidate locators (role/label/placeholder/text/testId → stable attributes → id → scoped →
  positional fallback; utility/layout classes are never used), counts each against the live DOM, and
  reports the best `count === 1` candidate plus `LocatorQuality`, **up to 3 ranked `alternatives`**, and a
  **`context`** (nearest visible dialog / table row / card-listItem / same-origin iframe). The Node binding
  (`__awtkit_recordAction`) stores the action verbatim; `buildRecordedFlow`/`recorder:saveFlow` copy
  `exact`/`quality`/`alternatives`/`context` onto `FlowStep.locator` (a structured `StepLocator`).
- **Smart Wait recorder observation (Phase 2):** the injected script also watches the DOM/network
  between actions and emits raw signals via a second binding `__awtkit_recordSignal` — patched
  `fetch`/`XHR` (method + URL **path** only, never query/headers/bodies/cookies), `history`+pop/hash
  for URL changes, and a MutationObserver + 150 ms scan for loaders (appear→disappear), toasts,
  disabled→enabled transitions, and table/list/card item growth. `RecorderService` buffers the signals
  (gated by the persisted `settings.recorder.captureSmartWaits` option, default on) and, on each distinct action, calls the pure
  `buildSmartWaits` (`src/recorder/smartWaitObservation.ts`) to attach ranked `afterWaits` to the
  **previous** action (polling ignored; `fixedDelay` only as a fallback when `captureWaitTime` is off).
  `RecordedAction.beforeWaits`/`afterWaits` propagate to `FlowStep` via `buildRecordedFlow`. Verified by
  `npm run verify:recorder` (Part D, 57/57 total) and `npm run verify:recorder-draft` (17/17). Runner
  execution of these waits is Smart Wait Phase 1 (below).
- **Locator resolution (runtime):** `LocatorFactory` builds a Playwright locator from a `StepLocator`.
  `create()` (page-rooted, no fallback) is used where multiple/absent matches are expected (count
  assertions, element loops, `waitFor`). `resolve(step)` (async) is used for single-target actions: it
  scopes by `context` (iframe `frameLocator` → container resolved to its single/visible match), tries the
  primary then `alternatives`, and returns exactly one element per candidate — a unique match, else the
  single *visible* match when several exist (**visibility disambiguation** for hidden-template/duplicate
  modals). It auto-waits on the primary when nothing is present yet, and throws a per-candidate diagnostic
  (count/visibleCount + context) otherwise. Playwright 1.49 has no `filter({ visible })`, so visibility is
  probed via `nth(i).isVisible()`. `StepExecutor.guardLocatorQuality` still fails a recorded non-unique
  step early **unless** it has `context`/`alternatives` (then the resolver owns the outcome);
  `friendlyLocatorError` translates any raw strict-mode violation. Verified by `npm run verify:recorder`
  (Parts A/B recorder + quality guard, Part C runtime fallback/visibility/context).
- **Smart Wait Engine (Phase 1 — runner execution):** `FlowStep` carries optional
  `beforeWaits`/`afterWaits: WaitCondition[]` (`src/profiles/FlowProfile.ts`). `StepExecutor.execute`
  wraps each action via `runStepWithWaits`: `beforeWaits` → arm action-triggered `response` waits (a
  `response` with `armBeforeAction` registers `waitForResponse` *before* the action, awaited after) →
  action → await armed → `afterWaits`. `executeWaitCondition` dispatches loaderHidden / elementVisible /
  elementHidden / elementEnabled / textVisible / toastVisible / response / tableHasRows / listHasItems /
  urlChanged / domStable / fixedDelay, reusing `LocatorFactory` for locator waits and emitting a
  structured diagnostic on failure. `networkidle` is intentionally not a Smart Wait strategy. The legacy
  `wait` step node (`executeWait`: time/selector/navigation/networkIdle/textVisible) is unchanged, and
  steps without waits behave exactly as before. Verified by `npm run verify:waits`. The recorder can now
  emit these as `afterWaits` from Smart Wait observation; legacy fixed-time `wait` nodes remain supported.
- **Shared connector styling:** `app/renderer/components/shared/connectorStyle.ts` (`buildConnectorVisual` +
  `EdgeVisualStyle`) is the single edge-visual source for both `FlowChartDesigner` and `ScenarioBuilder`;
  style persists on `FlowEdge.style` / `WorkflowEdge.style`. Shared UI: `ConnectorStyleEditor`,
  `SearchableSelect`.

## Architectural constraints (Confirmed)

- Offline-first: production must not download browsers or require internet/global toolchains;
  launch Playwright through `BundledBrowserResolver`.
- Mutable runtime data only under `%LOCALAPPDATA%/WebFlow Studio/` (or configured Settings paths) —
  never `resources/`/`app.asar`/install dir.
- `src/` core stays UI-agnostic; the one bridge is `ExecutionEngine`/IPC importing
  `app/main/appPaths` for resource/data roots and offline mode.

## Inferred

- `RunnerWorkerHost`/`RunnerWorker` suggest a worker-isolation design for concurrency; verify how
  fully it is wired before relying on it.

## Unknown / Needs Verification

- Exact concurrency/worker execution path under heavy multi-instance load (not load-tested here).
