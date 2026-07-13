# ARCHITECTURE

## Confirmed — folder/module map

```text
app/
  main/                 Electron main process
    main.ts             app bootstrap + offline startup gate
    windowManager.ts    BrowserWindow (title, icon)
    preload.ts          contextBridge → window.playwrightFlowStudio (IPC API)
    appPaths.ts         runtime data root, resources root, isProductionOffline()
    uiSettings.ts       persisted settings store (UiSettings) + validation; all mutations run through
                        a serial queue (writeQueue.ts) with atomic temp-file+rename writes;
                        flushSettingsWrites() runs on before-quit so last-moment edits aren't lost
    writeQueue.ts       createSerialQueue() — FIFO async queue (failure-isolated, flush()) used by uiSettings
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
                        data-binding/, reports/, scenario/, shared/ (CanvasItemPicker,
                        NodeAppendButton, themed canvas edges/dialogs/primitives)
    layout/             AppShell, TopHeader, LeftNavigation, StatusBar, DesignerCanvasLayout, RightPropertiesPanel
    state/              navigation.tsx, pageChrome.tsx (header actions + dirty flag)
    styles/global.css   single plain-CSS stylesheet
src/                    framework-agnostic core (no Electron/React imports, except runner→appPaths)
  runner/               PlaywrightRunner, FlowExecutor, StepExecutor, ExecutionEngine,
                        BrowserContextFactory, LocatorFactory, ValueResolver, ExpressionEvaluator,
                        ConnectorConditionEvaluator (structured conditional connectors),
                        ManualHandoffController, BrowserProcessManager, RunnerWorker(Host), RunnerResult
    concurrency/        ResourceKey, Semaphore, ResourceLockManager (exclusive/shared/semaphore,
                        TTL leases, fencing versions, atomic multi-acquire, snapshot(sweepFirst),
                        kind-prefix semaphore capacities origin:*/account:*),
                        ConcurrencyConfig (AWKIT_* env-overridable host limits),
                        DispatchClaims (origin/account claims per instance dispatch),
                        BackpressureController (+ sampled CPU/memory thresholds), CapacitySnapshot,
                        RuntimeStatus (aggregated status for the IPC status API),
                        CancellationToken (hard-cancel source/token, Phase 3),
                        OriginClaimTracker (mid-flow origin re-claiming, Phase 3),
                        ResourceSampler (system/process memory + CPU deltas, Phase 3)
    browser/            BrowserWorkerPool (bounded browser slots, health/crash window, snapshot)
    runtime/            RuntimeStateMachine (FlowRunStatus/NodeStatus), NodeAttempt(+Log),
                        ErrorClassifier (+cancelled class), RetryPolicy (safety-metadata-first),
                        StepSafetyPolicy (explicit → type default → keyword fallback),
                        InstanceHeartbeat, WatchdogService (+snapshot)
    artifacts/          RunLogger (JSONL per-instance run log), RunStateArtifacts (flow-state /
                        node-attempts / capacity / locks JSON at end of run), TraceService
                        (per-step failure trace zips, AWKIT_TRACE_MODE, engine-run only)
    store/              Phase 3 durable runtime: RuntimeStoreSchema (SQLite DDL + migrations),
                        SqliteRuntimeStore (sql.js WASM SQLite file, atomic-rename persistence),
                        SqlJsLoader (Phase 4: explicit sql-wasm.wasm resolution via module
                        resolution + locateFile; exposes the path for diagnostics — works in dev,
                        tsx, and packaged app.asar), RuntimeStore interface + NullRuntimeStore,
                        DurableLockStore (atomic wx-file cross-process locks: exclusive +
                        rank-based semaphores, fencing, TTL/dead-pid stale quarantine; Windows
                        EPERM/EBUSY wx-race treated as contention), DurableLockConfig,
                        AppInstance, StartupRecovery (orphaned/recoverable vs failed/manual-review)
  session/              SessionCaptureService (real Chrome/Edge capture), SessionProfile,
                        sessionMatch (normalizeOrigin / findBestSessionForUrl)
  profiles/…            + ProfileLockManager (exclusive in-process profile:* locks over the
                        global ResourceLockManager; enforced by BrowserContextFactory)
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
                        verify-canvas-perf.mjs (canvas render-count regression guard, real Electron) +
                        verify-write-queue.mts (serial-queue unit test) +
                        verify-settings-persistence.mjs (atomic write + before-quit flush, real Electron) +
                        measure-large-graphs.mjs (40/100/200/500-node perf report tool) +
                        seed-mock-fixtures.mjs + ai-memory/check-memory.mjs
mock-site/              offline Feature Test Lab (node http server) for runner/recorder/wait/designer verification
tests/                  runner.mocksite.spec.ts (@playwright/test)
docs/                   IMPLEMENTATION_AUDIT.md, OFFLINE_STANDALONE_PACKAGING.md, ai/
playwright_flow_studio_updated_phases/   master product spec (historical name)
change_requests/        historical change-request prompt sets
```

## Mock Site Feature Test Lab

`mock-site/` is the mandatory local Feature Test Lab for AWKIT feature work. It must remain
offline/local friendly and cannot depend on external services. Existing stable URLs:

- `/` - lab index.
- `/login`, `/form`, `/details`, `/success` - core runner/recorder flow.
- `/smart-waits` - Smart Wait and runner timing scenarios.
- `/recorder-lab` - Recorder, locator, saved URL, dynamic DOM, and waiting-time scenarios.
- `/designer-lab` - Flow Designer, Workflow Builder, Instance Monitor, cards, and scenario-data examples.
- `/api/delay?ms=...` - bounded local delayed JSON response.

Any new Recorder, Runner, Smart Wait, Flow Designer, Workflow Builder, Instance Monitor, locator, node,
wait, or execution feature should update at least one Mock Site scenario when applicable. Future agents
must check `mock-site/README.md` before creating new feature-specific fixtures and should prefer extending
existing scenarios over duplicate isolated pages.

Each Mock Site scenario must have a stable local URL, clear title, description, expected behavior, related
AWKIT feature, and stable selectors using role/name, labels, placeholders, and/or `data-testid`. New pages
or scenarios must be covered by `npm run verify:mock-site` or another focused verifier, and their URLs
must be documented in `mock-site/README.md` and AI memory files.

### When modifying features

1. Identify whether the feature needs a Mock Site scenario.
2. Add or update the Mock Site scenario.
3. Add or update automated verification for that scenario.
4. Update Mock Site documentation with the scenario URL and expected behavior.
5. Update AI memory docs so future agents know the scenario exists.
6. Run relevant feature verifiers, `npm run verify:mock-site`, build, and memory checker.
7. Commit only after the working tree is clean and verification passes.

## Confirmed — process & data flow

- **Renderer ↔ main:** renderer calls `window.playwrightFlowStudio.<area>.<method>()` (preload
  contextBridge) → `ipcMain.handle` in `app/main/ipc/*` → profile stores / runner / settings.
  Data-source editor channels: `dataSources:readJson`, `dataSources:writeJson`,
  `dataSources:createFromScratch` (write to the configured data-sources folder; `resources/`
  samples are read-only and migrate on save). Editor route `dataSourceEditor` is hidden from the
  sidebar and opened from the Data Source Manager (target id via `selections.lastSelectedDataSourceId`).
- **Storage:** JSON files via `JsonProfileStore` (`src/storage`) under the runtime data root;
  seed samples from `resources/sample-*`. No database.
- **Workflow structural sentinels:** new Workflow Builder documents may persist `start`/`end`
  `WorkflowSentinelNode`s around real `flowRef` nodes. They are canvas-only structure:
  `workflowToScenarioProfile()` filters them and their boundary edges before orchestration. Existing
  pre-sentinel workflow JSON remains valid and is not mutated merely by loading.
- **Build:** `electron-vite` builds `app/main` → `out/main`, `app/main/preload.ts` → `out/preload`,
  `app/renderer` → `out/renderer`. `tsc --noEmit` typechecks first. TS path aliases: `@main/*`,
  `@renderer/*`, `@src/*` (`tsconfig.json`).
- **Execution flow:** `execution.ipc` builds a `ConcurrentRunProfile` + resolved `StorageDirs`
  (from `getConfiguredPaths`) → `ExecutionEngine.startRun` → `InstanceManager` creates isolated
  instance contexts → `PlaywrightRunner.executeScenario` → `FlowExecutor.executeFlow` →
  `StepExecutor.execute`. Browser launched via `BrowserContextFactory`; in offline mode
  `executablePath` = bundled Chromium (`BundledBrowserResolver`). Every AWKIT-owned bundled-Chromium
  launch (runner + recorder, never the user's real Chrome in `SessionCaptureService`) gets the
  centralized no-egress launch args from `src/runner/ChromiumHardening.ts` (`buildChromiumHardeningArgs`,
  Phase 5.1C): background-service switches + a `--disable-features` superset of Playwright's list
  (last-wins) + `--host-resolver-rules` mapping Google service hosts to loopback + gaia/search
  redirect switches. Page-level navigation is untouched. Toggled by `AWKIT_CHROMIUM_OFFLINE_HARDENING`
  (default on) with `AWKIT_CHROMIUM_EXTRA_ARGS` for extra switches; proven by
  `npm run verify:chromium-hardening`. `ExecutionEngine` retains a per-execution
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
- **Concurrency & stability layer (2026-07-06):** `ExecutionEngine` owns a `BrowserWorkerPool`
  (bounded browser slots — one live browser runtime per running instance, capped by
  `maxBrowsersPerHost`) and a `BackpressureController` (pool saturation / `maxActiveFlows` / host
  free-memory floor / browser crash rate → allow or queue with a logged reason). `processQueue`
  consults admission before `startPending` and pre-acquires a slot per instance; no slot → the
  instance stays pending and is retried next tick. `PlaywrightRunner.onBrowserRuntime` reports the
  live runtime (initial launch + each Reuse Session swap generation) so the pool tracks
  contexts/pages/disconnects. `BrowserContextFactory` takes an exclusive `profile:<userDataDir>`
  lock (`ProfileLockManager` over the global `ResourceLockManager`) before `launchPersistentContext`
  and releases it in the runtime close path — two in-process runtimes can never share a profile;
  the on-disk `Singleton*` artifact check still covers external Chrome/Edge. `FlowExecutor` retries
  are classification-gated (`ErrorClassifier` + `RetryPolicy`): only transient
  navigation/timeout/locator/download failures re-run (exponential backoff, bounded by the step's
  `retry.count`); dangerous-looking mutations (submit/approve/delete/send/pay/confirm keywords on
  mutating steps) and dead browser/context/page failures never auto-retry. Isolated parallel
  branches are clamped by `maxActiveNodesPerFlow`. Every progress event updates
  `InstanceRuntimeState.runtime.heartbeatAt` (additive field; UI `status` unchanged), appends a
  masked JSONL line via `RunLogger` to `instance.paths.logs`, and maintains explicit `NodeAttempt`
  records. A `WatchdogService` (15s, unref'd) flags stale heartbeats (note only — Playwright
  actions carry their own timeouts), marks orphaned instances failed, and sweeps expired locks.
  End of run always releases the slot + dispatch claims + stray profile locks and writes
  `flow-state.json` / `node-attempts.json` / `capacity.json` / `locks.json` under
  `<instance storage>/state`. Limits come from `ConcurrencyConfig` (`AWKIT_MAX_BROWSERS`,
  `AWKIT_MAX_ACTIVE_FLOWS`, `AWKIT_MAX_ACTIVE_NODES_PER_FLOW`, `AWKIT_MIN_FREE_MEMORY_MB`, …).
  Verified by `npm run verify:concurrency`. See `docs/ai/CONCURRENCY_IMPLEMENTATION_PLAN.md`.
  **Phase 2 (2026-07-06, see `docs/ai/CONCURRENCY_PHASE2_REVIEW.md`):** dispatch additionally
  claims per-origin/per-account semaphores (`DispatchClaims` — origin from `baseUrl`/first `goto`
  host, account from `envFile`; capacities `AWKIT_MAX_PER_ORIGIN`=2 / `AWKIT_MAX_PER_ACCOUNT`=1 via
  kind-prefix entries in the global lock manager; a saturated key queues only the instances that
  target it). Every step runs inside a Playwright **trace chunk** (`TraceService`, armed only when
  the engine provides `instance.paths.traces`; `AWKIT_TRACE_MODE` off/onFailure/always): failed
  steps save `<traces>/<stepId>-<ts>.zip` before any cleanup and surface `tracePath` + sanitized
  `currentUrl` on the failed progress event → node attempts; successful steps discard the chunk.
  Failure **screenshots default on** (`onFailure.screenshot: false` opts out; best-effort).
  Manual-handoff resume (`resumeInstance`/`retryHandoff`) refreshes `runtime.heartbeatAt` so the
  watchdog never mistakes handoff idle time for a stall. Runtime status is exposed via
  `ExecutionEngine.getRuntimeStatus()` (+ `getLockSnapshot`/`getBrowserPoolSnapshot`/
  `getWatchdogSnapshot`), IPC `execution:runtimeStatus`, preload `executions.runtimeStatus()`, and
  a read-only Instance Monitor strip (browsers/flows/pages/queued/locks + stale, crashes,
  backpressure reason, last watchdog action; 2s poll). Verifiers: `verify:locks`,
  `verify:browser-pool`, `verify:watchdog`, `verify:artifacts`, `verify:runtime-status`.
  **Phase 3 (2026-07-06, see `docs/ai/PHASE3_DURABLE_RUNTIME.md`):** durable runtime under
  `<runtime root>/runtime/` — `runtime.sqlite` (real SQLite file via the pure-WASM `sql.js`
  driver; runs/attempts/heartbeats/cancellations/watchdog events/artifacts/capacity snapshots
  with versioned migrations; single-writer, atomic-rename persistence) and `locks/` (atomic
  wx-file cross-process locks with fencing versions; TTL/dead-pid stale locks quarantined to
  `stale/` with reasons, never silently deleted). `BrowserContextFactory` takes the profile lock
  in BOTH layers via `ProfileLockManager.acquireDurable` — two AWKIT app processes cannot share
  a `userDataDir`. **Hard cancellation:** `stopInstance` records the request durably, wakes
  manual handoffs, and fires a per-instance `CancellationTokenSource` whose runner handler
  closes the live browser generation — in-flight Playwright actions reject immediately, steps
  refuse to start, the `cancelled` error class is never retried, and the run ends `cancelled`
  with slot/claims/locks released and artifacts written in `finally`. **Safety metadata:**
  `FlowStep.safety` (explicit) → node-type defaults → keyword fallback → conservative unknown;
  `RetryPolicy` is metadata-first. **Dynamic origin claims:** `OriginClaimTracker` re-claims
  `origin:<host>` on mid-flow cross-origin navigation (acquire-new-then-release-old, bounded
  wait, `AWKIT_DYNAMIC_ORIGIN_CLAIMS`/`AWKIT_ORIGIN_CLAIM_TIMEOUT_MS`). **Sampling:**
  `ResourceSampler` feeds CPU/memory thresholds into backpressure and the status strip.
  **Startup recovery:** `runStartupRecovery` marks interrupted prior-instance runs
  orphaned/recoverable (safe) or failed/manual-review (side-effect node in flight; never
  auto-resumed); surfaced with stale durable locks in the runtime status + Instance Monitor.
  Engine status API is now async (`getRuntimeStatus` includes `durableLocks` +
  `recoverableRuns`). Verifiers: `verify:durable-store`, `verify:durable-locks` (real second
  process), `verify:cancellation` (live), `verify:safety-policy`,
  `verify:dynamic-origin-claims` (live), `verify:resource-sampling`, `verify:startup-recovery`.
  **Phase 4 (2026-07-06, see `docs/ai/PHASE4_RELEASE_HARDENING.md`):** the durable runtime now
  initializes at **app startup** (`registerExecutionIpc` → `initializeDurableRuntime`), not just
  on the first run, so startup recovery is visible immediately after a restart.
  `getRuntimeStatus().environment` (`RuntimeEnvironmentInfo`) reports appMode
  (`app/main/appPaths.getAppMode()`), runtimeRoot, sqlitePath, artifactsRoot, sqlJsWasmPath
  (from `SqlJsLoader`), and durableStoreEnabled. Recoverable/interrupted prior runs are
  **actionable**: IPC `execution:recoveryDetails` (run + node attempts + `listArtifacts` rows)
  and `execution:recoveryAction` (markReviewed/markAbandoned → engine `applyRecoveryAction`
  writes status `reviewed`/`abandoned` + a `recoveryAction` watchdog event and refreshes the
  surfaced list, which is filtered to `orphaned`/`failed` with a recovery note). The Instance
  Monitor renders `RecoverableRunsPanel` (details, open-artifact-folder via `system:openPath`,
  re-run workflow for SAFE runs only through the normal card path, mark reviewed/abandoned);
  dangerous/manual-review runs are never auto-resumed. Packaging: `electron-builder.json`
  explicitly ships `node_modules/sql.js/dist/sql-wasm.{js,wasm}` (inside app.asar); the
  dependency manifest declares/validates the sql.js runtime + WASM. Verifiers:
  `verify:packaged-runtime` (real packaged EXE), `verify:stress:concurrency`,
  `verify:stress:cancellation`, `verify:stress:locks`, `verify:stress:artifacts`,
  `verify:soak:runtime`.
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
  the `SessionCaptureService` (from `ExecutionEngine`). `PlaywrightRunner` owns a mutable `BrowserHolder`
  with a browser generation id. The restarter performs a generation-guarded two-phase swap for session
  profiles: launch and verify the new persistent context/page, publish the new runtime, re-point the live
  executor's active page, close the old generation with an explicit reason, then verify the new runtime
  remains alive. Old browser/context/page lifecycle events are ignored by generation guard; duplicate swaps
  are blocked by a per-instance mutex; profile lock artifacts fail before launch; and `StepExecutor`
  liveness-checks the browser/page before each step. Sessions are matched by normalized origin
  (`sessionMatch`). Auto Secure Login returns `restartRequired`; `FlowExecutor` restarts the flow from Start
  (guarded by `MAX_AUTO_LOGIN_RESTART`) and a user-drawable `outcome`/`loopBack` edge is also supported.
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
  emits waiting progress with the safe `HandoffInfo`, and when `SessionCaptureService` + `BrowserRestarter`
  are available closes the automation browser, opens the user's normal Chrome/Edge at the detected login URL
  (`manualChromeHandoff` capture), waits for the user to close it, validates captured profile data, relaunches
  Playwright on the captured persistent profile, and continues the same workflow. Protected-login capture uses
  `config.handoffTimeoutMs` (0 disables the explicit-node timeout) and deliberately ignores the triggering
  step's `timeoutMs`, because auto-detected handoff can be triggered by a short navigation/action timeout.
  When capture services are unavailable it falls back to pausing via the shared `ManualHandoffController` and waits inside the live
  runner/browser until Continue/Retry/Cancel resolves the controller promise.
  `ExecutionEngine` owns the shared controller, maps waiting progress to
  `InstanceRuntimeState.manualHandoff`, exposes Continue through `resumeInstance`, exposes in-place
  `retryHandoff`, and cancels pending handoffs through `stopInstance`. The queue treats
  `waitingForManualAction` as active, not terminal, while the runner promise is alive. UI:
  `components/auth/ProtectedLoginHandoffPanel.tsx`. OAuth: `src/auth/OAuthHandoffService.ts` +
  `app/main/ipc/auth.ipc.ts` (`auth:getCapabilities`/`openOAuth`/`openExternal`) + preload `auth.*`.
- **Recorder secure-login browser handoff:** `RecorderService` (`src/recorder/RecorderService.ts`) is
  injected a `SessionCaptureService` (`configureSessionCapture`, wired in `recorder.ipc.ts` from
  `getSessionService()`). It attaches `detectRecorderProtectedLogin` (`src/security/ProtectedLoginDetector.ts`)
  to every page/popup `load`/`domcontentloaded`. That detector combines conservative DOM signals (password
  field, one-time-code field, recaptcha/hcaptcha/turnstile iframe, captcha/verification aria, passkey/webauthn)
  with URL/title/text provider patterns — detect-only, never reading secrets. The evaluate body avoids named
  function expressions so esbuild's `__name` helper is never referenced in-page. On first detection while
  recording, `beginHandoff` stops action capture, persists the draft, records secret-free
  `RecorderHandoffInfo` (`src/recorder/RecorderTypes.ts`), and closes the automation browser via a
  context-or-browser-safe `closeBrowser` (the resume path uses `launchPersistentContext`, so there is no
  separate `Browser`). `continueWithNormalBrowser` → `SessionCaptureService.startCapture(url,
  "manualChromeHandoff")` (real Chrome, app-owned scoped profile). `captureSessionAndResume` stops the manual
  Chrome, validates the profile (`SessionCaptureService.hasCapturedData`), inserts `Auto Secure Login` +
  `Reuse Session` actions at the front of the draft (deduped; session id linked to Reuse Session), then
  `resumeAfterHandoff` relaunches Playwright with `launchPersistentContext(profileDir)`, re-wires the context
  (shared `wireContext`), navigates to the safe resume URL, and resumes recording. `buildRecordedFlow`
  serializes those nodes (`autoSecureLogin` value; `reuseSession` `config.reuseSessionMode`/`reuseSessionId`).
  IPC: `recorder:getHandoff` / `:continueWithNormalBrowser` / `:captureSessionAndResume` / `:cancelHandoff`
  (+ preload `recorder.*`); UI panel in `app/renderer/pages/Recorder.tsx`.
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
  `RecordedAction.beforeWaits`/`afterWaits` propagate to `FlowStep` via `buildRecordedFlow`. The Recorder
  page exposes a persisted Smart Wait capture toggle and summarizes captured wait types on recorded
  actions. Verified by `npm run verify:recorder` (Part D, 57/57 total) and
  `npm run verify:recorder-draft` (17/17). Runner execution of these waits is Smart Wait Phase 1 (below).
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
- **Smart Wait Engine (runner execution + diagnostics + designer surfacing):** `FlowStep` carries optional
  `beforeWaits`/`afterWaits: WaitCondition[]` (`src/profiles/FlowProfile.ts`). `StepExecutor.execute`
  wraps each action via `runStepWithWaits`: `beforeWaits` → arm action-triggered `response` waits (a
  `response` with `armBeforeAction` registers `waitForResponse` *before* the action, awaited after) →
  action → await armed → `afterWaits`. `executeWaitCondition` dispatches loaderHidden / elementVisible /
  elementHidden / elementEnabled / textVisible / toastVisible / response / tableHasRows / listHasItems /
  urlChanged / domStable / fixedDelay, reusing `LocatorFactory` for locator waits and emitting a
  structured diagnostic on failure. Recorder-generated armed response waits on a successful `goto` are
  treated as optional navigation hints when they time out after the navigation completed and the page is
  still live, because session reuse can legitimately change which bootstrap endpoints repeat; hand-authored
  and non-navigation response waits still fail normally. Diagnostics include the wait phase (before action / after action /
  armed response), sanitized current URL (origin + path only), recorded reason, last observed state, and a
  suggestion. `networkidle` is intentionally not a Smart Wait strategy. The legacy `wait` step node
  (`executeWait`: time/selector/navigation/networkIdle/textVisible) is unchanged, and steps without waits
  behave exactly as before. Flow Designer preserves waits through save/load and exposes a Smart Waits Node
  Properties section for timeout editing/removal. Verified by `npm run verify:waits` (21/21) and
  `npm run verify:flow-designer` (19/19). The recorder can emit these as `afterWaits` from Smart Wait
  observation; legacy fixed-time `wait` nodes remain supported.
- **Shared connector styling:** `app/renderer/components/shared/connectorStyle.ts` (`buildConnectorVisual` +
  `EdgeVisualStyle`) is the single edge-visual source for both `FlowChartDesigner` and `ScenarioBuilder`;
  style persists on `FlowEdge.style` / `WorkflowEdge.style`. Shared UI: `ConnectorStyleEditor`,
  `SearchableSelect`.

- **Reporting & Telemetry (UI-reports refactor, 2026-07-07):** an additive read-model over the
  existing durable runtime. **Writers:** `ExecutionEngine` records run-summary fields
  (scenarioName/queueWaitMs/durationMs/retryCount/reportCategory via `src/reports/ReportCategories.ts`)
  at the existing start/end `upsertRun` seams, and runs a `ProcessTreeSampler`
  (`src/runner/runtime/ProcessTreeSampler.ts` — Windows CIM, own Chromium subtree, throttled,
  never-throws, `AWKIT_PROCESS_SAMPLING`) whose samples persist to `runtime_process_samples`; a
  bounded retention sweep (`AWKIT_REPORT_RETENTION_HOURS`/`_RUNS`) runs on durable init. Schema:
  `RuntimeStoreSchema.ts` migration **v2** (`reporting-extensions`, additive nullable columns + the
  samples table + read indexes; v1 DBs upgrade in place). **Read model:** `SqliteRuntimeStore`
  query methods (`queryOverview`/`queryWorkflows`/`queryRunHistory`+filter/`queryFailures`/
  `queryRuntimeSeries`) — SQL SELECT + bounded JS aggregation, windowed/paginated; contracts in
  `src/reports/TelemetryContracts.ts`. **IPC:** `app/main/ipc/telemetry.ipc.ts` (`telemetry:overview/
  workflows/runHistory/runDetail/failures/runtimeSeries/processHistory/server`; `server` computes
  cached bounded directory sizes in the IPC layer) → preload `telemetry.*` group → renderer
  `components/reports/*` (hooks `useTelemetryQuery`/`useRuntimeStatus`, hand-rolled SVG charts) and
  `pages/Reports*.tsx`. All read-only and best-effort; a telemetry failure never affects a run.
  Verified by `npm run verify:telemetry` (data/store) and `npm run verify:reports` (real Electron UI).
- **Design system (UI-reports refactor):** `--awkit-*` tokens + reduced-motion honoring in
  `app/renderer/styles/global.css`; shared primitives in `components/shared/` (StatusBadge,
  SectionHeader, SkeletonCard, EmptyState, TrendDelta, AnimatedCounter, usePrefersReducedMotion);
  a route-content fade in `AppShell` for non-canvas routes. Designer node cards were recolored to
  tokens (CSS-only) with all canvas geometry/port/serializer invariants preserved.

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
