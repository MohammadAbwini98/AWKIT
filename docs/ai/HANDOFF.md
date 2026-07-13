# Agent Handoff

Last updated: 2026-07-11 (React Flow removal — the three canvases now run on an in-house custom
canvas engine; `@xyflow/react` fully removed from source and `package.json`. Renderer-only; working
tree modified & uncommitted on `feature/smart-wait-engine`. The UI-migration and release-hardening
context below is historical; its release gates remain the real remaining gates.)

## Purpose

This file is the active handoff note between AI coding agents and humans. It applies to any coding
agent (Claude Code, Codex, Gemini, Antigravity, future agents) and human developers.

Use this file when work is paused, blocked, or moving from one agent/tool to another.

## Current Handoff

### From / To

- **From:** the agent that removed React Flow and built the in-house canvas engine.
- **To:** any next agent or human developer.
- **Branch:** `feature/smart-wait-engine` (level with `origin/feature/smart-wait-engine`; the working
  tree is **modified & uncommitted / unpushed**, and already carried prior sessions' UI-migration work
  before this task). Do not fetch/pull/push/PR unless the user asks.

### Active Task — Remove React Flow (`@xyflow/react`) from the canvases: COMPLETE

The user asked to replace the React Flow-based canvases with the **same custom UI design as their
`Workflow` (flowforge) reference project, but implemented without the React Flow library**. Note the
reference project is itself built on `@xyflow/react`, so this required building a small in-house canvas
engine (viewport pan/zoom, node drag, SVG smooth-step edges, dotted grid, fit-view, screen↔flow
mapping) and porting all three canvases onto it. Renderer-only — **no route, IPC, preload API
(`window.playwrightFlowStudio`), runner/runtime, profile schema, storage contract, or packaging
behavior changed.** Per the user's explicit choice ("adopt flowforge nodes as-is"), the extra
node features listed under Known Risks were intentionally dropped.

### Completed Work (React Flow removal)

- **New in-house engine** `app/renderer/components/canvas/` (all untracked, no `@xyflow` anywhere):
  `FlowCanvas.tsx` (viewport pan/zoom via CSS transform, node drag with DOM measurement, SVG edge
  layer, fit-view, `useCanvas`/`useViewport`, `FlowCanvasHandle` imperative ref exposing
  `fitView`/`zoomTo`/`screenToFlowPosition`, `getIntersectingNodes`), `geometry.ts` (a faithful port
  of React Flow's `getSmoothStepPath` / `getViewportForBounds` math), `edgeComponents.tsx` +
  `edgeLabelContext.ts` (`BaseEdge`/`EdgeLabelRenderer` portaling into an in-transform HTML overlay),
  `Background.tsx` (dotted grid that pans/scales), `CanvasZoomControl.tsx` (glass zoom pill),
  `state.ts` (`useNodesState`/`useEdgesState`/`addEdge` compat helpers), `nodes/StepNode.tsx`,
  `edges/SmoothEdge.tsx` (insert `+`), `edges/LoopEdge.tsx` (self-loop), `types.ts`, `index.ts` barrel.
  The flow runs **top→bottom**: every edge leaves a node's bottom-center and enters the next node's
  top-center (self-loops when source === target).
- **All three canvases converted** to `<FlowCanvas>`: `pages/WorkflowDesigner.tsx` (read-only
  overview, uses `StepNode`), `pages/FlowChartDesigner.tsx`, `pages/ScenarioBuilder.tsx`. Their
  save/load/validation/serialization logic is unchanged — only the rendering layer swapped.
- **Node components rebuilt on the engine** (kept their existing flowforge-parity card markup/CSS):
  `components/workflow/ActionFlowNode.tsx`, `components/scenario/ScenarioFlowNode.tsx`. Resize +
  connector-port rendering removed; loop create/remove moved to the kebab menu via new
  `onToggleLoop`/`hasLoop` data callbacks (page owns the edge mutation).
- **Shared edits:** `components/shared/connectorStyle.ts` dropped its `@xyflow` import; `buildConnectorVisual`
  now returns `{ type: "smooth" | "loop", animated, style }` (was `templateSmooth`/`circular`).
  `components/workflow/FlowNodePropertiesPanel.tsx` `Node` type now imports from the engine.
  `flowDesignerTypes.ts` / `scenarioDesignerTypes.ts` gained `hasLoop`/`onToggleLoop`.
- **Deleted** (React-Flow-only, orphaned by the swap): `components/shared/TemplateSmoothEdge.tsx`,
  `components/shared/SelfLoopEdge.tsx`, `components/shared/ConnectorPorts.tsx`,
  `components/workflow/CanvasZoomControl.tsx`. Removed the `@xyflow/react/dist/style.css` import from
  `main.tsx` and the `@xyflow/react` dependency line from `package.json`.
- **Engine CSS** appended to `global.css` (`.awkit-flow-*`, `.awkit-step-node*`, `.awkit-edge-*`),
  translating the reference's Tailwind card design to AWKIT `--awkit-*` tokens (AWKIT has no Tailwind).
- **Both GUI verify scripts rewritten** against the new DOM (`.awkit-flow-node[data-id]`,
  `g.awkit-flow-edge[data-source][data-target]`, `.awkit-edge-add`, `.awkit-flow-canvas`), dropping the
  removed branch-port geometry checks. `AGENTS.md` (renderer) architecture note updated.

### Changed Files (this task, on top of the pre-existing uncommitted tree)

- **New (untracked):** `app/renderer/components/canvas/**` (engine).
- **Modified:** `app/renderer/pages/{WorkflowDesigner,FlowChartDesigner,ScenarioBuilder}.tsx`,
  `app/renderer/components/workflow/{ActionFlowNode,FlowNodePropertiesPanel,flowDesignerTypes}.tsx`,
  `app/renderer/components/scenario/{ScenarioFlowNode,scenarioDesignerTypes}.tsx`,
  `app/renderer/components/shared/connectorStyle.ts`, `app/renderer/main.tsx`,
  `app/renderer/styles/global.css`, `app/renderer/AGENTS.md`, `package.json`,
  `scripts/verify-flow-designer-gui.mjs`, `scripts/verify-workflow-builder-gui.mjs`.
- **Deleted:** `app/renderer/components/shared/{TemplateSmoothEdge,SelfLoopEdge,ConnectorPorts}.tsx`,
  `app/renderer/components/workflow/CanvasZoomControl.tsx`.
- **Note:** the working tree also holds many *pre-existing* uncommitted changes from earlier sessions
  (Workflow UI migration, Hologram reskin — e.g. `Recorder.tsx`, `LeftNavigation.tsx`, `Settings.tsx`,
  `src/profiles/WorkflowProfile.ts`, `mock-site/*`, doc/`.md` files, `package-lock.json`). Those are
  **not** from this task; leave them as-is unless the user asks.

### Commands / Tests Run (this task)

- `npx tsc --noEmit` — **clean**.
- `npx electron-vite build` — **clean** (main + preload + renderer). Renderer bundle
  **1,589 kB → 1,235 kB** (~355 kB smaller, React Flow gone; modules 2214 → 2049).
- `node scripts/verify-flow-designer-gui.mjs` (real Electron GUI) — **14/14**.
- `node scripts/verify-workflow-builder-gui.mjs` (real Electron GUI) — **14/14**.
- `grep -rn "@xyflow" app/` — no imports remain in source.
- **Not run** (no runner/runtime/mock-site/packaging code touched): `verify:runner`, `verify:recorder`,
  `verify:mock-site`, `verify:workflow-sentinels`, `validate:offline`, packaging verifiers. `npm test` /
  `npm run lint` still do not exist.

### Remaining Work / Recommended Next Step

- **Run `npm install`** — `@xyflow/react` was removed from `package.json` but **still exists in
  `package-lock.json` (6 refs) and `node_modules/`** (install was not run). Sync the lockfile + prune
  the module. This is the top remaining item.
- **Regenerate the offline dependency manifest + re-validate** after the install:
  `npm run offline:manifest` then `npm run validate:offline`. `scripts/generate-dependency-manifest.ps1`
  still references React Flow / `@xyflow` — confirm the manifest no longer lists it and that offline
  validation passes (a dependency was removed).
- **Optional — free node-to-node connect:** the engine currently connects via the `+` insert / append /
  Logic-picker affordances only. Port-drag-to-connect and edge-reconnect were dropped with the port
  model; if arbitrary connect-any-two-nodes is wanted, add flowforge-style drag-a-node-onto-another
  (the engine already exposes `getIntersectingNodes`).
- **Optional cleanup:** the now-unused port helpers remain in `components/shared/connectorStyle.ts`
  (`ConnectorPortFlags`, `computePortFlags`, `reconcileBranchConnectors`, `portHandlesForKind`,
  `branchSourceHandle`, `portPositions`) and the `portFlags?` fields on the two node-data types — dead
  after this task; safe to prune later.
- **Recommended next step:** run `npm install`, then `npm run build`, then `verify:flow-designer` +
  `verify:workflow-builder` to confirm still-green, before committing. Read
  `.claude/skills/git-full-cycle/SKILL.md` before any Git commit. Do not push/PR unless asked.

### Known Risks / Behavior Changes

- **Intentionally dropped features** (from the user's "adopt flowforge nodes as-is" choice): node
  resize, branch-port dragging, edge reconnect, and free port-drag-to-connect. Connections are now made
  via the `+`/append/Logic-picker affordances; loop is toggled from the node kebab menu. All connector
  *kinds* (conditional/parallel/loop), their config, and save/validation logic are preserved.
- **The engine is new hand-written code.** It has been GUI-verified (14/14 ×2) but is less battle-tested
  than React Flow — watch pan/zoom/drag edge cases. Node size is measured from the rendered DOM
  (`ResizeObserver`), so edges attach after first paint.
- The old `docs/ai/CURRENT_STATE.md` "Structured connectors (Checkpoint B)" section still describes the
  **removed** port/handle/`reconcileBranchConnectors` rendering model — the *runtime* connector
  semantics it documents are unchanged, but the renderer half (ports, `useUpdateNodeInternals`,
  branch-pair handles, `.react-flow__*` DOM) no longer exists. See the new dated CURRENT_STATE entry.

---

## Prior release-hardening context (historical — the release gates below are still the real gates)

### Codex Git-Cycle Update

2026-07-07: User explicitly requested committing and pushing all current project changes on
`feature/smart-wait-engine`. This overrides the older "do not push unless explicitly asked" caution for
this Git cycle only; do not assume future pushes are approved.

Fresh verification before staging:
- `npm run build` pass
- `npm run verify:runner` 82/82
- `npm run verify:recorder` 57/57
- `npm run verify:telemetry` 39/39
- `npm run verify:reports` 26/26
- `npm run verify:waits` 21/21
- `npm run verify:mock-site` 28/28
- `npm run validate:offline` pass
- `npm run verify:concurrency` 78/78

### From Agent / Tool

Claude Fable 5 (completed the concurrency & stability layer on top of Codex's uncommitted Reuse Session
lifecycle fixes — both change sets are in the working tree together)

### To Agent / Tool

Any next agent

### Timestamp

2026-07-06

### Branch / Commit

- Repository is a Git repo; always run `git status --short --branch` before editing.
- Current branch: `feature/smart-wait-engine` (ahead of origin by 5 commits; local-only work not pushed).
- Work is local-only. Do not fetch, pull, push, or open PRs unless the user explicitly asks.

### Active Task

Phase 5.1 release-candidate follow-up is in progress on branch `feature/smart-wait-engine`.
The repo is locally modified and uncommitted. The current work items are to:
- centralize Chromium no-egress hardening and ship it into the packaged app,
- make packaged verifiers track the real Electron main process tree and terminate it on cleanup,
- then validate the NSIS install/uninstall cycle and a real clean/offline Windows VM walkthrough.

### Phase 5.1 verification (2026-07-07, current handoff)

- **Chromium no-egress hardening validated end-to-end.** `src/runner/ChromiumHardening.ts`
  (`buildChromiumHardeningArgs`, env-configurable via `AWKIT_CHROMIUM_OFFLINE_HARDENING` /
  `AWKIT_CHROMIUM_EXTRA_ARGS`) is wired into `BrowserContextFactory` + both recorder launch paths and
  NOT into `SessionCaptureService`. Confirmed the `--disable-features` list is an exact superset of
  installed Playwright 1.61's (last-wins), and pinned 4 Playwright behavioral defaults so the arg set
  is self-contained. `npm run verify:chromium-hardening` **13/13** (ONLINE: zero non-loopback over a
  20 s idle window + external navigation still works). `AWKIT_WALKTHROUGH_STRICT_NET=1
  npm run verify:packaged-walkthrough` **70/70** — the strict no-egress check now PASSES; the Phase 5
  Google-service burst is eliminated. **This resolves the Phase 5 egress WARNING.**
- **Packaged-process teardown proven** (`scripts/helpers/packaged-process-tree.mts`): both
  `verify:packaged-runtime` (**25/25**) and the strict walkthrough report a fully-terminated tree.
- **Packaging OOM finding:** the default max-compression (`-mx=9`) packaging OOMs on this 16 GB
  machine; `win-unpacked` (the shared, validated payload) rebuilt hardened. One-off
  `-c.compression=store` builds produced **hardened** validation-grade portable (~1.23 GB) + NSIS
  (~376 MB) EXEs + a consistent `latest.yml` (installer sha512 re-verified). The two package wrappers
  were fixed to fail on a non-zero `electron-builder` exit (they previously masked the failure).
- **Remaining gates (unchanged):** clean/offline Windows VM walkthrough
  (`docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3); NSIS install/uninstall cycle (integrity sha512 only);
  code-signing; producing max-compressed shippable EXEs on a higher-memory machine.
- **RC decision: `PASS WITH WARNINGS`.** `npm test` / `npm run lint` still do not exist.

### Phase 5 additions (2026-07-06, this session)

- **`npm run verify:packaged-walkthrough` (68/68)** — `scripts/verify-packaged-walkthrough.mts`:
  launches the REAL `dist/win-unpacked` EXE with `LOCALAPPDATA` pointed at a fresh empty dir
  (clean first-run simulation); proves first-run init, IPC fixture import, full workflow run +
  artifacts (JSONL/screenshots/report/flow-state), hard cancellation (`cancelled`, Chromium tree
  gone, slot+locks freed), 2-browser OS-level bound under 4 instances, recorder start/cancel,
  hard kill → startup recovery (`orphaned`/recoverable, real Recoverable Runs panel renders,
  markReviewed clears), external SQLite read, ACTUAL portable EXE first boot, NSIS sha512 vs
  `latest.yml`, and network sampling (app processes loopback-only; bundled-Chromium startup
  Google burst = warn-only, `AWKIT_WALKTHROUGH_STRICT_NET=1` to fail). Evidence in
  `dist/phase5-evidence/`.
- **Findings recorded in KNOWN_ISSUES ("Phase 5 packaged-walkthrough findings")** — REQUIRED
  reading before scripting against the packaged app: launcher-stub pid (kill the REAL main from
  `app.evaluate(() => process.pid)`, never `app.process().pid`), orphaned Chromium self-exits
  when the real main dies, per-launch Chromium egress burst, `runWorkflow` needs `dryRun:false`,
  decorated instance ids, mock-site 127.0.0.1/Node-18 `localhost`→`::1` probe gotcha.
- Phase 5J full re-verification green (see CURRENT_STATE header for the complete list).
  `npm test` / `npm run lint` still do not exist.

### Phase 4 additions (2026-07-06, same session family)

- **sql.js ships verified in the packaged app:** `src/runner/store/SqlJsLoader.ts` resolves
  `sql-wasm.wasm` explicitly (`createRequire` + `locateFile`, path exposed);
  `electron-builder.json` lists the dist WASM; manifest generator + `validate-offline-bundle.ps1`
  + the TS manifest policy now REQUIRE `sqlJsRuntimeIncluded`/`sqlJsWasmIncluded` (an old manifest
  fails the packaged startup gate — both packaging scripts regenerate it). Portable (310 MB) +
  NSIS (357 MB) EXEs rebuilt 2026-07-06; `npm run verify:packaged-runtime` 24/24 launches the real
  packaged EXE and proves durable-store init + `%LOCALAPPDATA%` paths + external SQLite read.
- **Runtime diagnostics:** `getRuntimeStatus().environment` = appMode/runtimeRoot/sqlitePath/
  artifactsRoot/sqlJsWasmPath/durableStoreEnabled (logged once at init).
- **Durable runtime opens at app startup** (`registerExecutionIpc` →
  `engine.initializeDurableRuntime`), so startup recovery + recoverable runs appear right after a
  restart without starting a run.
- **Recoverable runs are actionable:** Instance Monitor `RecoverableRunsPanel` (details incl. last
  node/safety/URL/error class/trace/screenshot, open artifact folder, re-run workflow for SAFE runs
  only, mark reviewed/abandoned). New IPC `execution:recoveryDetails`/`execution:recoveryAction`;
  engine `getRecoveryDetails`/`applyRecoveryAction`; `RuntimeStore.listArtifacts`. Dangerous
  (failed/manual-review) runs are never auto-resumed.
- **Stress/soak verifiers (deterministic, tunable `AWKIT_STRESS_*`):** `verify:stress:concurrency`
  13, `verify:stress:cancellation` 8, `verify:stress:locks` 10, `verify:stress:artifacts` 7,
  `verify:soak:runtime` 8 — all green. `verify:stress:locks` found a real bug, now fixed:
  `DurableLockStore.acquireExclusive` treats Windows EPERM/EBUSY wx-create races as contention
  (clean denial) instead of throwing.
- Full Phase 1/2/3 regression re-run green (one `verify:durable-locks` flake under packaging CPU
  load, clean on re-run — noted in KNOWN_ISSUES). `npm test`/`npm run lint` still do not exist.

### Phase 3 additions (2026-07-06, same session family)

- **New dependency:** `sql.js` 1.13.0 (WASM SQLite — chosen because better-sqlite3's native ABI
  can't serve Node 18 tsx verifiers AND Electron 33's Node 20 simultaneously) +
  `@types/sql.js` (dev). Externalized in the main bundle; **packaged-EXE rebuild + dependency
  manifest regeneration still pending** before shipping.
- Durable runtime under `<runtime root>/runtime/`: `runtime.sqlite` (runs/attempts/heartbeats/
  cancellations/watchdog/artifacts/capacity, versioned migrations) + `locks/` (atomic wx-file
  cross-process locks, fencing versions, stale quarantine with reasons).
- Hard cancellation: Stop closes the live browser via per-instance CancellationTokenSource;
  runs end `cancelled` (not failed); `cancelled` error class never retried.
- `FlowStep.safety` explicit side-effect metadata (keyword heuristic = fallback only);
  RetryPolicy is metadata-first; unknown custom types conservative (no auto-retry).
- Dynamic origin claims (`OriginClaimTracker`), CPU/memory `ResourceSampler` in backpressure,
  startup recovery (`runStartupRecovery`: orphaned/recoverable vs failed/manual-review).
- Engine `getRuntimeStatus()` is now **async** (adds `durableLocks` + `recoverableRuns`);
  Instance Monitor strip shows CPU/Mem/Recoverable/Stale-durable-locks.
- New verifiers (95 checks, all green): `verify:durable-store` 11, `verify:durable-locks` 17,
  `verify:cancellation` 12, `verify:safety-policy` 17, `verify:dynamic-origin-claims` 14,
  `verify:resource-sampling` 14, `verify:startup-recovery` 10. Full Phase 1/2 regression green
  (`verify:concurrency` 78, `verify:runner` 82, `verify:waits` 21, `verify:protected-login` 16,
  `verify:recorder` 57, build clean, `ai:memory` pass, `validate:offline` pass in dev mode).
  `npm test`/`npm run lint` do not exist.

### Phase 2 additions (2026-07-06, same session family)

- Failure-path traces: `TraceService` per-step chunks; failed engine-run steps save
  `traces/<stepId>-<ts>.zip` before cleanup; `AWKIT_TRACE_MODE` off/onFailure/always; armed only
  when `instance.paths.traces` exists (verify scripts unaffected).
- Failure screenshots default ON (`onFailure.screenshot: false` opts out; best-effort).
- Origin/account dispatch semaphores (`DispatchClaims` + kind-prefix capacities `origin:*`/`account:*`;
  `AWKIT_MAX_PER_ORIGIN`=2, `AWKIT_MAX_PER_ACCOUNT`=1); released with slot in `finally`.
- Heartbeat refresh on `resumeInstance`/`retryHandoff`; watchdog snapshot (last scan/findings/swept).
- Runtime status: `getRuntimeStatus()` + IPC `execution:runtimeStatus` + preload
  `executions.runtimeStatus()` + read-only Instance Monitor strip (2s poll).
- Node attempts carry `tracePath` + sanitized `currentUrl`.
- New verifiers: `verify:locks` 15, `verify:browser-pool` 13, `verify:watchdog` 13,
  `verify:artifacts` 13, `verify:runtime-status` 15. Regression all green: `verify:concurrency`
  78, build clean, `verify:runner` 82, `verify:waits` 21, `verify:protected-login` 16,
  `verify:recorder` 57, `ai:memory` pass. `npm test`/`npm run lint` do not exist.

### Completed Work

1. **New pure modules:** `src/runner/concurrency/` (ResourceKey, Semaphore, ResourceLockManager —
   exclusive/shared/semaphore, TTL leases, fencing versions, atomic multi-acquire, stale sweep, snapshot;
   ConcurrencyConfig with `AWKIT_*` env overrides; BackpressureController; CapacitySnapshot),
   `src/runner/browser/BrowserWorkerPool.ts`, `src/runner/runtime/` (RuntimeStateMachine, NodeAttempt,
   ErrorClassifier, RetryPolicy, InstanceHeartbeat, WatchdogService), `src/runner/artifacts/` (RunLogger
   JSONL, RunStateArtifacts), `src/profiles/ProfileLockManager.ts`.
2. **BrowserContextFactory:** takes the exclusive in-process `profile:<userDataDir>` lock before
   `launchPersistentContext`, releases it in the runtime close path (and on launch failure). The on-disk
   `Singleton*` artifact check remains for external Chrome/Edge processes.
3. **FlowExecutor:** `executeWithRetry` is classification-gated (RetryPolicy + ErrorClassifier) — only
   transient navigation/timeout/locator/download errors auto-retry, with exponential backoff; dangerous-
   looking mutations (submit/approve/delete/send/pay/confirm keywords) and dead browser/context/page
   failures never do. Isolated parallel branches clamped by `maxActiveNodesPerFlow`.
4. **PlaywrightRunner:** optional `onBrowserRuntime` hook reports the live runtime (initial + each swap
   generation) so the engine's pool can track contexts/pages/disconnects without owning the lifecycle.
5. **ExecutionEngine:** browser-slot admission via BrowserWorkerPool + BackpressureController in
   `processQueue` (blocked dispatch queues with a logged reason); per-instance runner promises tracked;
   heartbeats + JSONL run logs + NodeAttempt records folded from progress events;
   `InstanceRuntimeState.runtime` additive field (flowRunStatus/heartbeatAt/browserWorkerId — UI `status`
   unchanged); WatchdogService marks orphans failed, notes stale heartbeats, sweeps stale locks; end-of-run
   `finally` releases the slot + stray profile locks and writes flow-state/node-attempts/capacity/locks
   JSON under `<instance storage>/state`; `repeatInstance` clears watchdog dedupe and re-enters through the
   slot gate.
6. **Verification:** new `scripts/verify-concurrency.mts` + `npm run verify:concurrency` (78/78), and the
   prior Codex work's tests still pass.

### Files Changed (uncommitted, working tree — includes the prior Codex change set)

- New: `src/runner/concurrency/*`, `src/runner/browser/*`, `src/runner/runtime/*`, `src/runner/artifacts/*`,
  `src/profiles/ProfileLockManager.ts`, `scripts/verify-concurrency.mts`,
  `docs/ai/CONCURRENCY_IMPLEMENTATION_PLAN.md`
- Modified this task: `src/runner/BrowserContextFactory.ts`, `src/runner/FlowExecutor.ts`,
  `src/runner/PlaywrightRunner.ts`, `src/runner/ExecutionEngine.ts`, `src/instances/InstanceRuntimeState.ts`,
  `package.json`, `docs/ai/{ARCHITECTURE,CURRENT_STATE,TASK_LOG,TESTING,COMMANDS,HANDOFF}.md`
- Untracked `electron_test*.cjs` at repo root are **pre-existing** and were left untouched.

### Commands / Tests Run

- `npm run verify:concurrency` — 78/78 (new).
- `npm run build` — clean (tsc + electron-vite).
- `npm run verify:runner` — 82/82.
- `npm run verify:waits` — 21/21.
- `npm run ai:memory` — pass.
- Not run this session: `verify:recorder`, `verify:protected-login`, GUI verifiers, packaging — no
  recorder/protected-login/renderer/packaging code touched.

### Current State Summary

The runner now has an enforced-in-code stability layer: exclusive persistent-profile locking, bounded
browser processes with queueing under backpressure (defaults: 2 browsers, 4 active flows — override via
`AWKIT_MAX_BROWSERS`, `AWKIT_MAX_ACTIVE_FLOWS`, etc.), classified retries with a dangerous-mutation guard,
heartbeat/watchdog recovery for orphaned instances and stale locks, per-instance JSONL run logs (the
previously-unwritten `paths.logs` file), and end-of-run state artifacts for debugging.

### Remaining Work / Recommended Next Step

- **Human clean/offline VM walkthrough** per `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 —
  the main remaining gate (includes the NSIS install/uninstall cycle, offline-adapter-disabled
  startup, and the protected-login handoff on a machine with real Chrome). The dev-machine half
  (full packaged workflow run, now with strict no-egress) is automated by `verify:packaged-walkthrough`.
- **Produce shippable EXEs on a higher-memory machine** — the default `-mx=9` packaging OOMs here;
  only `store`-compressed validation EXEs were produced (KNOWN_ISSUES). Then code-sign them.
- Chromium no-egress launch flags: **DONE** (`src/runner/ChromiumHardening.ts`, Phase 5.1C — proven).
- Optional: renderer code-splitting.
- Next phase (deliberately NOT started): remote runner hosts — see the roadmap section in
  `docs/ai/PHASE3_DURABLE_RUNTIME.md`.

### Known Risks / Blockers

- `ELECTRON_RUN_AS_NODE=1` in agent environments makes direct `npx electron script.cjs` boot as plain Node
  (`require('electron').app` is `undefined`). Clear it (`unset ELECTRON_RUN_AS_NODE`) for ad hoc Electron
  reproduction commands. The project GUI verification scripts clear it themselves.
- The real workflow can still pause at Protected Login Handoff after Navigate if the target site requires a
  human login/verification step. Do not automate or bypass that surface.
- Playwright 1.49 API note carried from prior work: no `locator.filter({ visible })`; locator fallback uses
  `nth(i).isVisible()` probing. (Installed Playwright for the app is 1.61 / Chromium 149.)

### Do Not Touch Without Confirmation

- Do not rename `window.playwrightFlowStudio`.
- Do not break offline-first constraints: no runtime internet, no global Node/Playwright/Chromium, and no
  writes to `resources/` or `app.asar`.
- Do not add a "block external / non-Playwright profile" guard to Reuse Session; protected-login session
  capture intentionally uses real Chrome/Edge scoped profiles.
- Keep Mock Site scenarios local-only, deterministic, and free of external services.

### Recommended Next Step

Start from `git status --short --branch`. The lifecycle fix is complete locally and uncommitted. Do not push
unless explicitly asked.

### Required First Actions For Next Agent

1. Read `AGENTS.md`.
2. Read `docs/ai/CURRENT_STATE.md`.
3. Read `docs/ai/HANDOFF.md` (this file).
4. Run `git status --short --branch` and inspect `git diff` before editing.
5. For mock-site work, read `mock-site/AGENTS.md`, `mock-site/README.md`, and the `mock-site-maintainer`
   skill for your agent surface.
6. Read `.claude/skills/git-full-cycle/SKILL.md` (or the `.codex`/`.gemini` mirror) before any Git
   branch/stage/commit/push/PR operation.

## Handoff History

Older handoff detail is preserved in Git history.
