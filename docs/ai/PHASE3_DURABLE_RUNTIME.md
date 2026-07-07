# Phase 3 — Durable Runtime Store, Hard Cancellation, Cross-Process Safety

**Implemented:** 2026-07-06 (Claude Fable 5). Local-only, uncommitted, on `feature/smart-wait-engine`.

## Driver decision (read this first)

`better-sqlite3` (native) is **not viable** in this repo: the tsx verifiers run under Node 18.16
(ABI 108) while Electron 33's main process runs Node 20.18 (ABI 130) — one `node_modules` binary
cannot serve both, `node:sqlite` needs Node ≥22.5, and a native module would complicate the
offline packaging pipeline. The store therefore uses **`sql.js` 1.13.0 (SQLite compiled to WASM,
pure JS, new runtime dependency)**: it produces a REAL SQLite database file (openable by any
SQLite tool), works identically in Node 18 and Electron, and is fully offline after install.

Consequences, stated honestly:
- The database lives in memory and is persisted by **atomic-rename writes** (debounced ~300ms,
  immediate on critical transitions — cancellations, recovery verdicts, run end — and on close).
  A hard kill can lose at most the last un-persisted debounce window.
- The SQLite store is **single-writer** (the Electron main process). Cross-process mutual
  exclusion does NOT come from SQLite file locking — it comes from `DurableLockStore`'s atomic
  filesystem locks (below). The store is the durable *state*, the lock store is the durable
  *exclusion*.

## Storage layout

```text
%LOCALAPPDATA%/WebFlow Studio/storage (dirs.root)/runtime/
  runtime.sqlite      SQLite database (runs, attempts, heartbeats, cancellations,
                      watchdog events, artifacts, capacity snapshots, migrations)
  locks/              durable cross-process locks
    <key>-<hash>/holder.lock          exclusive holder (atomic wx create)
    <key>-<hash>/units/<owner>.unit   semaphore units (rank-based capacity)
    stale/*.stale.json                quarantined stale locks WITH reasons (never deleted)
```

### Tables (migration v1, `RuntimeStoreSchema.ts`)

`runtime_migrations`, `runtime_runs` (status, flowRunStatus, appInstanceId, pid, heartbeat,
lastKnownUrl, error/errorClass, recoverable + recoveryNote), `runtime_node_attempts` (per-attempt
status, sideEffectLevel, error class, trace/screenshot paths, currentUrl), `runtime_heartbeats`,
`runtime_locks` + `runtime_leases` (reserved for history mirroring), `runtime_artifacts`,
`runtime_cancellations`, `runtime_watchdog_events`, `runtime_capacity_snapshots` (bounded 500).
Migrations run once each, recorded by version; reopen is idempotent (`verify:durable-store`).

## Durable lock semantics (`DurableLockStore`)

- **Exclusive**: `holder.lock` created with the `wx` flag — atomic on NTFS/POSIX; two REAL
  processes cannot both create it (`verify:durable-locks` proves this with a spawned child).
- **Semaphore(N)**: per-owner unit files; after writing, holders are ranked by fencing version
  and any holder ranked ≥ capacity deletes its own unit and reports "denied" — deterministic
  cross-process capacity (child holding 2 `origin:*` units blocks the parent's 3rd).
- **Fencing versions**: epoch-millis×1000 + counter, monotonic across grants; release verifies
  the on-disk version matches the lease so a stale owner can never clobber a successor.
- **TTL leases** + **stale detection**: expired TTL or dead owning pid (checked via signal-0)
  → the lock file is MOVED to `stale/` with `staleReason` + `markedStaleAt` recorded. Nothing is
  silently deleted; stale records appear in the runtime status (`durableLocks.stale`).
- Records carry `ownerId`, `pid`, `appInstanceId`, `reason`, `acquiredAt`, `expiresAt`.
- Wired resources: `profile:*` is **exclusive durable** through
  `ProfileLockManager.acquireDurable` (called by `BrowserContextFactory` before
  `launchPersistentContext`; released in the runtime close path — both layers). Dispatch claims
  (`origin:*`, `account:*`) are mirrored as durable semaphores per instance (best-effort:
  a saturated durable key from ANOTHER app instance is tolerated — the in-memory claim already
  throttles this process; profile safety never relies on this). `browser:*`/`flow:*`/
  `workflow:*`/`instance:*` remain per-process (browsers die with their process; instance ids
  are globally unique) — documented, not durable.

## Hard cancellation flow

```text
UI Stop → execution.ipc → ExecutionEngine.cancelOne(instanceId, reason)
  1. durableStore.recordCancellation (persisted immediately)
  2. manualHandoffController.cancel (wakes a waiting handoff)
  3. pool status → cancelled; runtime.flowRunStatus → cancelling
  4. CancellationTokenSource.cancel(reason)
       → PlaywrightRunner onCancel handler closes the CURRENT browser runtime (generation-aware)
       → in-flight Playwright action rejects immediately (waits, navigations, clicks)
  5. StepExecutor.execute throws CancelledError before any further step
  6. Runner flow loop refuses further flows; error class "cancelled" is never retried
  7. runInstanceInner catch: state machine → cancelled (not failed/crashed)
  8. finally: slot released, origin tracker + dispatch claims (memory + durable) released,
     profile locks released, state artifacts + JSONL flushed, completeCancellation recorded
```

Cancelled runs still produce artifacts where possible (failure trace/screenshot capture is
best-effort against a closing browser; state files + JSONL always). Verified live by
`verify:cancellation` (a 30s wait ends in ~3s with the browser closed, profile lock freed).

## Safety metadata model (`FlowStep.safety`, resolved by `resolveStepSafety`)

Precedence: **explicit `safety` on the step** → node-type defaults (read types, local session
ops, UI mutations, containers) → keyword heuristic (fallback only, mutating types) →
conservative default (`unknown`, non-retryable) for unrecognized custom types.
`RetryPolicy` consumes it: dangerous/externalCommit never retry; `retryable:false` blocks;
`requiresIdempotencyKey` without an expression blocks; explicit-retryable steps retry any
non-infra failure (metadata overrides the keyword heuristic); implicit classifications still
require a transient error class. Infra-terminal classes (dead browser/context/page, profile
locked, manual action, **cancelled**) beat everything. Recorder/legacy flows need no editing —
type defaults classify them. Verified by `verify:safety-policy`.

## Dynamic origin claims (`OriginClaimTracker`)

Enabled by default (`AWKIT_DYNAMIC_ORIGIN_CLAIMS`, timeout `AWKIT_ORIGIN_CLAIM_TIMEOUT_MS` =
30s). After each successful step the executor compares the page hostname with the held claim:
same origin = no-op; new origin = acquire `origin:<newHost>` (in-memory + durable semaphore)
under the timeout, THEN release the old claim, log `[origin-claim] a → b`, and record the
transition. Saturation of the new origin fails only that step with `OriginClaimTimeoutError`
(classified `timeout`, retryable) — other flows/origins continue; timeout prevents deadlock.
Verified pure + live (127.0.0.1 → localhost real navigation) by `verify:dynamic-origin-claims`.

## Resource sampling (`ResourceSampler`)

Every `AWKIT_RESOURCE_SAMPLE_INTERVAL_MS` (2s): system memory %, main-process RSS, system CPU %
(os.cpus() time deltas), process CPU %. No native deps, Windows-first, cross-platform; sampling
failure yields undefined values and never throws (the controller also guards a throwing
sampler). Backpressure blocks with explicit reasons on `AWKIT_MAX_SYSTEM_MEMORY_PERCENT` (85),
`AWKIT_MAX_PROCESS_MEMORY_MB` (2048), `AWKIT_MAX_CPU_PERCENT` (85) — only while the sample is
fresh (≤3 intervals). Sampled values appear in the capacity snapshot and Instance Monitor strip.
Chromium child-process memory is NOT sampled (would need process-tree walking/native help) —
browser count + pool health remain the proxy; documented limitation.

## Startup recovery policy (`runStartupRecovery`)

On the first run after app start: durable runs with active-looking statuses under a DIFFERENT
`appInstanceId` are classified — a `running` attempt with sideEffectLevel
dangerousMutation/externalCommit/unknown in flight → `failed`, `recoverable:false`,
note "verify the external system, then re-run manually" (never auto-resumed); otherwise →
`orphaned`, `recoverable:true` ("safe to re-run" — resume in AWKIT's model = re-run the
workflow). Verdicts are written once (idempotent), each with a `startupRecovery` watchdog event,
and surfaced in the runtime status / Instance Monitor strip ("Recoverable N prior run(s)").
Stale durable locks from prior crashes are quarantined with reasons and shown as
"Stale durable locks N". Verified by `verify:startup-recovery`.

## Remaining limitations after Phase 3

- sql.js persistence window: a hard kill can lose the last ≤300ms of non-critical writes
  (critical transitions persist immediately).
- The runtime store is single-writer; a second app instance gets durable LOCK safety but does
  not share the run-state database (it would need its own runtime root or the next phase).
- Cancellation closes the browser; it cannot un-send an already-sent request — the safety
  metadata + recovery policy handle that half.
- Chromium child-process memory/CPU not individually sampled.
- Origin claims re-evaluate after steps; a redirect chain mid-step settles on the final origin.
- ~~Packaged-EXE rebuild with the new `sql.js` dependency has not been re-run in this task~~
  **Resolved by Phase 4 (2026-07-06, `docs/ai/PHASE4_RELEASE_HARDENING.md`):** dependency
  manifest regenerated with sql.js flags, portable + NSIS EXEs rebuilt, and
  `verify:packaged-runtime` (24/24) proves the WASM loads inside the packaged app.

## Next roadmap — remote runner hosts (not started)

Shared durable store service (real server SQLite/Postgres behind the same `RuntimeStore` /
`LockStore` interfaces), fenced cross-HOST leases, runner hosts consuming leased instances,
artifact upload, cross-host origin/account semaphores, and central capacity arbitration.
Prerequisites: a network story that respects AWKIT's offline-first posture (opt-in), and a
durable queue for dispatch.
