# FEATURE_COMPLETENESS_MATRIX

Legend — UI / Persistence / IPC / Runtime / Tests: ✅ present & wired · ⚠️ partial/unverified ·
➖ n/a · ❌ missing. **Status** is the overall assessment. Evidence is a representative anchor, not
exhaustive. "Verified?" means a `verify:*` script exercises it (per repo docs / script names).

| Area | Feature | UI | Persist | IPC | Runtime | Tests | Status | Evidence | Missing work |
|------|---------|----|--------|-----|---------|-------|--------|----------|--------------|
| Flows | Create/edit/save flow (Flow Designer) | ✅ | ⚠️ | ✅ | ✅ | ✅ | Implemented; persist non-atomic | `FlowChartDesigner.tsx`, `ProfileStore.ts:126` | Atomic write (A1) |
| Flows | Clone/import/export/delete | ✅ | ✅ | ✅ | ➖ | ⚠️ | Implemented | preload `flows.*`, `flow.ipc` | Corrupt-file surfacing (A2) |
| Workflows | Build/edit workflow (Workflow Builder) | ✅ | ⚠️ | ✅ | ✅ | ✅ | Implemented; sentinel model | `ScenarioBuilder.tsx`, sentinels 4/4 | Atomic write (A1) |
| Workflows | Workflow Designer (read-only overview) | ✅ | ➖ | ✅ | ➖ | ✅ | Intentionally read-only | `WorkflowDesigner.tsx` (`nodesDraggable={false}`) | none |
| Connectors | normal/conditional/parallel/loop routing | ✅ | ✅ | ➖ | ✅ | ✅ | Implemented | `FlowExecutor.resolveNext`, `validateConnectorStructure` | none |
| Connectors | Structure validation (loop/self-loop rules) | ✅ | ✅ | ➖ | ✅ | ✅ | Implemented (defense-in-depth) | `FlowProfile.validateConnectorStructure`, `FlowDependencyResolver` | none |
| Steps | All 28 `StepType`s have runtime cases | ✅ | ✅ | ➖ | ✅ | ✅ | Complete | `StepExecutor.ts:640-925`, `FlowProfile.ts:1-34` | none |
| Steps | Smart Wait (before/after waits, 12 kinds) | ✅ | ✅ | ➖ | ✅ | ✅ | Implemented | `StepExecutor` wait dispatch `:362-437`, verify:waits | none |
| Recorder | Record actions → nodes | ✅ | ✅ | ✅ | ✅ | ✅ | Implemented | `RecorderService`, `recorderInitScript.ts` | none |
| Recorder | Locator alternatives + container + self-heal | ✅ | ✅ | ✅ | ✅ | ✅ | Implemented | `recorderInitScript.ts`, `LocatorFactory.resolve` | none |
| Recorder | Smart Wait observation | ✅ | ✅ | ✅ | ✅ | ✅ | Implemented | `smartWaitObservation.ts` | none |
| Recorder | Protected-login → real-Chrome handoff | ✅ | ✅ | ✅ | ✅ | ✅ | Implemented | `ProtectedLoginDetector`, recorder handoff IPC | none |
| Sessions | Capture (real Chrome/Edge) | ✅ | ✅ | ✅ | ✅ | ⚠️ | Implemented | `SessionCaptureService`, `session:*` IPC | none |
| Sessions | Reuse Session (persistent-profile swap) | ✅ | ✅ | ➖ | ✅ | ⚠️ | Implemented | `StepExecutor.executeReuseSession:1131` | none |
| Sessions | Auto Secure Login (manual-login + restart) | ✅ | ✅ | ➖ | ✅ | ⚠️ | Implemented | `executeAutoSecureLogin`, `verify:protected-login` | none |
| Sessions | Save Session (storageState → JSON) | ✅ | ✅ | ➖ | ✅ | ⚠️ | Implemented | `StepExecutor.saveSession:912` | none |
| Sessions | **Load Session** (reuse storageState in new run) | ⚠️(disabled) | ❌ | ❌ | ❌ | ➖ | **Not implemented (honest)** | `OAuthHandoffService.ts:23-29`, `flowNodeRegistry.ts:167`, `ProtectedLoginHandoffPanel.tsx:91` | Implement or remove node option (A7) |
| Runtime | Concurrent instance execution + pool | ✅ | ✅ | ✅ | ✅ | ✅ | Implemented | `ExecutionEngine`, `BrowserWorkerPool`, verify:concurrency | none |
| Runtime | Backpressure / crash-window | ➖ | ✅ | ✅ | ✅ | ✅ | Implemented | `BackpressureController`, verify:browser-pool | none |
| Runtime | Hard cancellation / stop / stopAll | ✅ | ✅ | ✅ | ✅ | ✅ | Implemented | `execution:stopInstance/stopAll`, `CancellationToken` | none |
| Runtime | Repeat instance / recovery actions | ✅ | ✅ | ✅ | ✅ | ⚠️ | Implemented | `execution:repeatInstance/recoveryAction` | none |
| Runtime | Isolated-context teardown | ➖ | ➖ | ➖ | ⚠️ | ⚠️ | Edge-case gap | `BrowserContextFactory.ts:93-96` | try/finally (A4) |
| Instance Monitor | Live pool, workflow records, bulk stop | ✅ | ✅ | ✅ | ✅ | ✅ | Implemented | `InstanceMonitor.tsx`, verify:instance-monitor | none |
| Instance Monitor | All-instance modal drill-down | ✅ | ➖ | ✅ | ➖ | ✅ | Implemented | `WorkflowInstancesModal.tsx` | none |
| Reports | Telemetry overview/workflows/history/failures | ✅ | ✅ | ✅ | ✅ | ✅ | Implemented | `telemetry.ipc.ts`, `components/reports/*` | none |
| Reports | Process-tree sampling | ➖ | ✅ | ✅ | ✅ | ⚠️ | Implemented (Windows CIM) | `ProcessTreeSampler.ts` | non-Windows path unverified |
| Reports | `reports:create/delete/export` IPC | ❌ | ✅ | ✅ | ➖ | ❌ | Backend-only / dead | registered, not in preload | Wire or prune (A6) |
| Data Sources | JSON array editor (CRUD, columns, rows) | ✅ | ⚠️ | ✅ | ✅ | ✅ | Implemented | `DataSourceEditor.tsx`, verify:data-editor | Atomic write (A1) |
| Data Sources | Data binding / JSON path resolve | ✅ | ✅ | ✅ | ✅ | ⚠️ | Implemented | `JsonPathResolver`, `DataBinding` | none |
| Runtime Inputs | Definitions list | ✅ | ✅ | ✅ | ✅ | ⚠️ | Implemented (list only in UI) | `runtimeInputs:list` in preload | CRUD IPC unexposed (A6) |
| Instances | `instances:*` CRUD IPC | ❌ | ✅ | ✅ | ➖ | ❌ | Backend-only / dead | registered, preload exposes only `list` | Wire or prune (A6) |
| Settings | Persisted UI settings (atomic + flush) | ✅ | ✅ | ✅ | ➖ | ✅ | Implemented (hardened) | `uiSettings.ts`, `writeQueue.ts`, verify:settings-persistence | none |
| Settings | Configurable storage paths | ✅ | ✅ | ✅ | ✅ | ⚠️ | Implemented | `storagePaths.ts` | none |
| Offline | Bundled Chromium + egress hardening | ➖ | ➖ | ✅ | ✅ | ✅ | Implemented | `BundledBrowserResolver`, `ChromiumHardening.ts` | none |
| Offline | Dependency manifest validation | ➖ | ✅ | ✅ | ✅ | ⚠️ | Implemented | `offlineRuntime:getStatus`, `validate:offline` | not re-run here |
| Packaging | Portable + per-user installer (PS scripts) | ➖ | ➖ | ➖ | ⚠️ | ⚠️ | Present; not re-run | `scripts/package-*.ps1` | Clean-machine walkthrough (external gate) |
| Auth | OAuth handoff (open external) | ✅ | ➖ | ✅ | ✅ | ⚠️ | Implemented (config-gated) | `OAuthHandoffService`, `auth.ipc.ts` | none |
| Canvas | In-house engine (pan/zoom/drag/edges) | ✅ | ✅ | ➖ | ➖ | ✅ | Implemented (React Flow removed) | `components/canvas/*`, verify:canvas-perf | none |
| Canvas | Error boundary (white-screen guard) | ✅ | ➖ | ➖ | ➖ | ⚠️ | Implemented | `shared/ErrorBoundary.tsx` | none |
