# Concurrency & Stability Layer — Implementation Plan

**Created:** 2026-07-06 (Claude Fable 5)
**Status:** IMPLEMENTED 2026-07-06 (local architecture + core stability layer; no distributed/K8s scope).
Verification: `verify:concurrency` 78/78, `npm run build` clean, `verify:runner` 82/82,
`verify:waits` 21/21, `ai:memory` pass.

## Current architecture (as inspected)

### Execution path (Confirmed)

```text
execution.ipc → ExecutionEngine.startRun(executionId, ConcurrentRunProfile, rows, dirs, …)
  → InstanceManager.createInstancesForRun → InstancePool (per-instance runtime state)
  → processQueue (500ms poll) → ConcurrentExecutionCoordinator.promoteQueued/startPending
      (bounded ONLY by profile.maxConcurrentInstances — no host capacity awareness)
  → runInstance → new PlaywrightRunner (per instance) → executeScenario
      → BrowserContextFactory.create  (one browser process per instance;
         persistentContext = launchPersistentContext(userDataDir))
      → workflow link routing → runFlowWithChildren → FlowExecutor.executeFlow
          (sequential nodes, structured conditional/parallel/loop connectors,
           parallel isolatedPage branches = new page in shared context, bounded by maxConcurrency)
      → StepExecutor.execute (active page, Smart Waits, popup registry, session swaps)
  → ReportService (final report) ; live progress via RunnerProgressReporter → InstanceRuntimeState.liveProgress
```

### Existing browser/session lifecycle (Confirmed)

- One Chromium **browser process per instance** (`browserContext` isolation) or one persistent
  context per instance (`persistentContext` + `userDataDir`). Closed in `executeScenario`'s `finally`.
- Mid-run generation-guarded browser swap for Auto Secure Login / Reuse Session (`BrowserHolder`,
  swap mutex, two-phase relaunch) — already hardened in the prior task.
- `BrowserContextFactory.assertPersistentProfileAvailable` checks Chrome `Singleton*` lock artifacts
  on disk before `launchPersistentContext` — detection only, **not** an in-process lock.
- Per-instance downloads/screenshots dirs exist (`InstanceManager.createInstancePaths`).
  `paths.logs` (`<logs>/<executionId>/<instanceId>.jsonl`) is allocated but **never written** —
  runner logs stay in `MemoryRunnerLogger` and end up only inside the report JSON.

### Existing concurrency gaps (Confirmed)

1. **No host capacity budget:** `maxConcurrentInstances` is the only limit; N instances = N Chromium
   processes regardless of RAM/CPU/browser count.
2. **No profile locking in code:** two runs pointed at the same `userDataDir` are only stopped if
   Chrome already wrote `SingletonLock`; a race between two Playwright launches is possible.
   `InstanceLockManager` exists but is **not wired** into any execution path.
3. **No heartbeat/watchdog:** if the runner promise hangs (stuck page, dead browser without an
   exception), the instance stays `running` forever; `runInstance`'s catch marks `failed` only when
   the promise rejects.
4. **Blind retries:** `FlowExecutor.executeWithRetry` re-runs any failed step per `step.retry` config
   with no error classification and no dangerous-mutation guard.
5. **No structured on-disk run logs/state:** debugging relies on the final report; a crashed engine
   loses live state.
6. **No backpressure:** the 500ms queue poll starts pending instances whenever the concurrency count
   allows, even under memory pressure or crash storms.

## Design decisions for this codebase

- **Browser worker = one browser runtime per instance** (slot-based pool). AWKIT's runner swaps the
  browser mid-run (Reuse Session) and binds popup registries/lifecycle handlers per instance, so
  sharing one browser process across instances would be a rewrite with high regression risk. The
  `BrowserWorkerPool` therefore manages **slots** (admission, tracking, health, recycle-on-release)
  rather than multiplexing contexts of a shared browser. Contexts-per-browser limits apply to pages
  opened inside an instance (parallel isolated branches).
- **Locks are in-memory, in the main process** (single Electron host). The `LockStore` interface
  keeps a future DB adapter possible.
- **Node scheduling stays in `FlowExecutor`** (it already implements dependencies, conditional
  routing, bounded parallel fan-out, bounded loops, nested flows). The new layer adds: page-capacity
  admission for isolated parallel branches, classified retries, and per-node attempt records.
- **UI-visible `InstanceStatus` is unchanged**; a richer `FlowRunStatus` + heartbeat live in new
  optional fields on `InstanceRuntimeState` so the renderer keeps working untouched.

## Files to add

```text
src/runner/concurrency/ResourceKey.ts          resource key builders + types
src/runner/concurrency/Semaphore.ts            counting semaphore w/ FIFO queue + timeout
src/runner/concurrency/ResourceLockManager.ts  exclusive/shared/semaphore locks, TTL leases,
                                               fencing versions, atomic multi-acquire, snapshot
src/runner/concurrency/BackpressureController.ts  capacity snapshot + admission decisions
src/runner/browser/BrowserWorkerPool.ts        bounded browser slots, health, recycle, snapshot
src/runner/runtime/RuntimeStateMachine.ts      FlowRunStatus/NodeStatus transitions + guards
src/runner/runtime/NodeAttempt.ts              per-node attempt records (from progress events)
src/runner/runtime/ErrorClassifier.ts          ErrorClass classification from error text/step
src/runner/runtime/RetryPolicy.ts              classified retry decision + backoff + danger guard
src/runner/runtime/WatchdogService.ts          stale-heartbeat / orphan / stuck-instance detection
src/runner/artifacts/RunLogger.ts              JSONL append logger to instance.paths.logs
src/profiles/ProfileLockManager.ts             exclusive profile:* locks over ResourceLockManager
scripts/verify-concurrency.mts                 focused verifier (npm run verify:concurrency)
```

## Files to modify (minimal diffs)

- `src/runner/BrowserContextFactory.ts` — acquire exclusive `profile:<userDataDir>` lock before
  `launchPersistentContext`; release in the runtime `close()`; keep the on-disk artifact check.
- `src/runner/ExecutionEngine.ts` — wire `BrowserWorkerPool` + `BackpressureController` into
  `processQueue` admission; heartbeat updates from progress events; start/stop `WatchdogService`;
  JSONL run logging + end-of-run state artifacts; runtime status fields.
- `src/runner/FlowExecutor.ts` — classified retry via `RetryPolicy`/`ErrorClassifier` (existing
  `step.retry` config still honored, dangerous mutations no longer blindly retried).
- `src/instances/InstanceRuntimeState.ts` — optional `runtime` field (flowRunStatus, heartbeatAt,
  browserWorkerId) — additive, backward compatible.
- `package.json` — `verify:concurrency` script.

## Phased implementation

1. Pure TS concurrency primitives (ResourceKey, Semaphore, ResourceLockManager).
2. ProfileLockManager + BrowserContextFactory enforcement.
3. BrowserWorkerPool (slots, health, recycle policy, capacity snapshot).
4. Runtime state machine + NodeAttempt + ErrorClassifier + RetryPolicy.
5. FlowExecutor classified-retry integration.
6. ExecutionEngine integration: admission, heartbeats, watchdog, RunLogger, state artifacts.
7. `scripts/verify-concurrency.mts` + full verification.
8. Docs updates (ARCHITECTURE, CURRENT_STATE, TASK_LOG, this file).

## Verification commands

- `npm run build` (typecheck + bundles) — must stay clean.
- `npm run verify:concurrency` — new focused checks (locks, semaphore, pool saturation, retry
  classification, watchdog, state machine).
- `npm run verify:runner` — existing 82 live checks must keep passing (regression gate).
- `npm run verify:waits` — 21 checks (StepExecutor untouched but shares runner internals).

## Phase 2 tuning & debugging guide (2026-07-06)

### How browser capacity is calculated

One running instance = one browser slot. An instance dispatches only when **all** pass:
`activeSlots < AWKIT_MAX_BROWSERS` → `activeFlows < AWKIT_MAX_ACTIVE_FLOWS` → host free memory ≥
`AWKIT_MIN_FREE_MEMORY_MB` → crashes in the window ≤ `AWKIT_MAX_RECENT_CRASHES` → the instance's
`origin:<host>` / `account:<envFile>` semaphores have units free. Otherwise it stays
pending/queued and is retried every 500ms tick; the block reason is logged
(`[backpressure] …`) and shown in the Instance Monitor status strip.

### Tuning via environment variables

| Variable | Default | Meaning |
|---|---|---|
| `AWKIT_MAX_BROWSERS` | 2 | Live Chromium processes (browser slots) |
| `AWKIT_MAX_ACTIVE_FLOWS` | 4 | Concurrently running instances |
| `AWKIT_MAX_ACTIVE_NODES_PER_FLOW` | 2 | Isolated parallel branches per flow |
| `AWKIT_MAX_PAGES_PER_CONTEXT` | 2 | Page budget per context |
| `AWKIT_MAX_PER_ORIGIN` | 2 | Instances per target hostname |
| `AWKIT_MAX_PER_ACCOUNT` | 1 | Instances per account (envFile) key |
| `AWKIT_MIN_FREE_MEMORY_MB` | 512 | Free-memory floor for new dispatch |
| `AWKIT_MAX_RECENT_CRASHES` / `AWKIT_CRASH_WINDOW_MS` | 3 / 300000 | Crash-rate breaker |
| `AWKIT_STALE_HEARTBEAT_MS` / `AWKIT_WATCHDOG_INTERVAL_MS` | 120000 / 15000 | Watchdog thresholds |
| `AWKIT_TRACE_MODE` | `onFailure` | `off` / `onFailure` / `always` (engine runs only) |

### How to read run artifacts

Per instance (paths from Settings-configured roots): `logs/<executionId>/<instanceId>.jsonl` —
every step event (`step.running/succeeded/failed`), instance start/end, errors with class;
`<instanceRoot>/traces/<stepId>-<ts>.zip` — open with `npx playwright show-trace <zip>`;
screenshots under the screenshots root (`<stepId>-failure.png`);
`<instanceRoot>/storage/state/flow-state.json` (status + every transition with reason),
`node-attempts.json` (per-attempt status/error class/trace/screenshot/URL), `capacity.json` and
`locks.json` (what the host looked like when the run ended).

### Debugging quick table

| Symptom | Look at | Likely cause / action |
|---|---|---|
| Instances stuck `queued`/`pending` | Status strip Backpressure reason; `capacity.json` | Pool/flow cap, memory floor, crash breaker, or origin/account semaphore — raise the matching env var |
| `ProfileLockedError` | `locks.json` / strip Locks count; `verify:locks` | Another running instance holds the profile — stop it or use a different session profile; stale in-process locks are swept by the watchdog |
| `PersistentProfileInUseError` | Profile dir `SingletonLock`/`lockfile` | A real Chrome/Edge window still has the captured profile open — close it |
| Instance failed with watchdogNote `orphaned` | JSONL log tail + `flow-state.json` | Engine lost the runner promise (crash) — check `instance.error` events |
| Stale-heartbeat watchdog notes | `runtime.heartbeatAt`, current step | Slow page/long wait; raise `AWKIT_STALE_HEARTBEAT_MS` if legitimate |

### Next phase — distributed roadmap

**Phase 3 (2026-07-06) delivered the local-durability part:** SQLite runtime store (`sql.js`),
durable cross-process locks with fencing, hard cancellation, explicit safety metadata, dynamic
origin claims, CPU/memory sampling, and startup recovery — see
`docs/ai/PHASE3_DURABLE_RUNTIME.md` (incl. how to read `runtime.sqlite` and debug durable locks).
Still open for a future phase: remote runner hosts, cross-HOST leases/semaphores, artifact
upload, and a shared durable store service (opt-in networking that respects offline-first).

## Known limitations (first run)

- Locks/leases are in-memory (lost on app restart — acceptable: browsers die with the host process;
  on-disk profile lock artifacts still protect cross-process reuse).
- No CPU sampling (memory + counts only) in backpressure inputs.
- Node-level DAG remains the existing connector engine; no separate DagPlanner module.
- No Playwright trace capture yet (screenshots-on-failure already exist); trace dirs are reserved.
