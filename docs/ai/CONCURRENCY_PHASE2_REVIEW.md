# Concurrency Phase 2 — Review of the Phase 1 Implementation

**Date:** 2026-07-06 (Claude Fable 5). Evidence-based answers from code inspection before Phase 2 work.
Each answer states the finding **as of the start of Phase 2**; items marked *(fixed in Phase 2)* were
addressed in this task.

## Answers to the critical review questions

1. **Is `BrowserWorkerPool` preventing unbounded Chromium creation in every execution path?**
   Covered paths: `ExecutionEngine.processQueue` (pre-acquires a slot per instance under admission,
   `tryAcquireSlot` → instance stays pending when saturated) and `repeatInstance` →
   `runInstanceInner` (bounded `acquireSlot` with a 5-minute wait). **Not covered:** code that
   constructs `PlaywrightRunner` directly (verify scripts, potential future callers) bypasses the
   pool — by design, since the pool is engine-owned; documented. The Recorder launches its own
   browser outside the runner entirely (one at a time, user-driven) and is intentionally out of
   scope. Mid-run swaps (Reuse Session) do not consume a second slot — correct, because the swap is
   two-phase (new runtime verified, old closed) and briefly holds two browsers by design; the pool
   tracks the live generation via `onBrowserRuntime`.

2. **Are browser slots always released in `finally` — crash, cancel, manual handoff, timeout?**
   Yes for every path that goes through `runInstanceInner`: the `finally` block releases the slot,
   releases stray profile locks, writes state artifacts, and flushes the JSONL log. Crash/timeout →
   the runner promise rejects → `finally`. Manual handoff (in-runner pause) → the slot is held
   **intentionally** while the browser stays alive waiting for the human; released when the run
   finishes. Cancel (`stopInstance`) marks the instance `cancelled` but does **not** terminate the
   in-flight runner (pre-existing engine behavior) — the slot is held until the runner notices
   (next step's liveness check) or completes. This is a known limitation, now documented; the
   watchdog excludes cancelled instances so nothing is falsely flagged.

3. **Is `ProfileLockManager` released when `launchPersistentContext` fails halfway?**
   Yes — `BrowserContextFactory.create` wraps the artifact check + launch in `try/catch` and calls
   `profileLease.release()` before rethrowing. *(Phase 2 adds a deterministic verifier for this:
   a lock-artifact file forces the post-acquire failure path — `verify:locks`.)*

4. **Can two concurrent `Reuse Session` steps still race the same profile?**
   No. The swap path goes through `BrowserContextFactory.create` with `ownerId = instanceId`, so
   the second instance gets `ProfileLockedError` before launch (in-process), and external Chrome/
   Edge processes are still caught by the on-disk `Singleton*`/`lockfile` check. Same-instance
   duplicate swaps are blocked by the existing per-instance swap mutex. Corner case: one instance
   swapping onto the profile dir it already holds fails (same owner, no re-entrant acquire) — same
   outcome as before Phase 1 (Windows `lockfile` present), and not a supported scenario.

5. **Are Manual Chrome Handoff / Auto Secure Login / Reuse Session / Protected Login Handoff still
   compatible?** Yes — `verify:runner` 82/82 covers all four post-integration (handoff pause/resume,
   protected-login capture, Reuse Session lifecycle, locked-profile fail-before-Navigate). The
   engine's watchdog excludes `waitingForManualAction`/`paused` from scans, so a human taking hours
   is never flagged. Gap found: after resume, `runtime.heartbeatAt` is stale until the next progress
   event; a slow first step after resume could look stale. *(Fixed in Phase 2: `resumeInstance` /
   `retryHandoff` refresh the heartbeat.)*

6. **Does retry logic accidentally retry dangerous actions?**
   No. `RetryPolicy.decide` checks `isDangerousMutationStep` (submit/approve/delete/send/pay/
   confirm/transfer keywords on mutating step types) **before** the error class, and returns
   `dangerous-side-effect` with retry blocked even when `retry.count` is configured. Verified in
   `verify:concurrency` at both the policy level and the `FlowExecutor` integration level (a
   "Click Submit Order" step executes exactly once). Keyword matching is heuristic (English
   keywords) — documented limitation.

7. **Are browser/context/page closed errors classified correctly?**
   Yes: Playwright's combined "Target page, context or browser has been closed" is checked before
   the browser-specific patterns (both are terminal, never retried); page-crash and disconnect
   texts map to `page-closed`/`browser-crash`. `browser-crash` on the instance level marks the pool
   slot unhealthy and the flow state `crashed`.

8. **Are node attempts recorded for every real step or only high-level flow actions?**
   Every step — `StepExecutor.execute` emits `running` + terminal progress events for *every* node
   (including start/end, loop-connector iterations, and isolated parallel branches, whose branch
   executors share the same progress reporter), and the engine folds those into `NodeAttempt`
   records; each retry becomes a distinct attempt because the prior one is closed by its `failed`
   event. Connector-level events (no `stepId`) are logged but do not create attempts — correct.

9. **Does the watchdog mark stale instances correctly without false positives during manual
   handoff?** Yes — `listActiveInstances` only includes `starting`/`running`; `waitingForManualAction`
   and `paused` are excluded, and stale-heartbeat findings are notes (never terminal transitions)
   because Playwright actions carry their own timeouts. Orphan detection requires **both** an
   active-looking status and no unsettled runner promise. Dedupe prevents rescan spam; `repeatInstance`
   clears dedupe. *(Phase 2 adds `verify:watchdog` incl. an explicit manual-handoff no-false-positive
   check, and a watchdog snapshot for the UI.)*

10. **Are JSONL logs written for successful and failed runs?**
    Yes — `RunLogger` appends `instance.start`, every `step.*` progress event, `instance.error`
    (failures), `locks.releasedStray`, and `instance.end` for every run through the engine; masked
    via `SecretMasker`; flushed in `finally`. Write failures disable the logger without failing the
    run. Runs *not* through the engine (verify scripts) produce no JSONL — by design.

11. **Are artifacts written before cleanup closes context/page?**
    Screenshots: yes (taken during the run, but Phase 1 only when `onFailure.screenshot` was set —
    *(fixed in Phase 2: failure screenshots default on, best-effort)*). State artifacts + JSONL:
    written after the browser closes, which is safe (no browser needed). Traces: did not exist in
    Phase 1 — *(added in Phase 2: per-step trace chunks saved on failure **before** the step
    returns, hence long before context close; trace-save errors are logged and never mask the
    original failure)*. Downloads: persisted by the existing download step handler before close.

12. **Are capacity snapshots useful enough for UI/debugging?**
    Partially — `CapacitySnapshot` had browsers/contexts/pages/flows/queue/memory/crashes/blocked
    reason, but nothing was exposed to the renderer. *(Fixed in Phase 2: `execution:runtimeStatus`
    IPC + preload binding + a compact Instance Monitor status strip showing browsers, flows, queue,
    locks, backpressure reason, and last watchdog action; plus `getLockSnapshot` /
    `getBrowserPoolSnapshot` / `getWatchdogSnapshot` engine methods.)*

13. **Are in-memory locks clearly documented as single-process only?**
    Yes (plan doc + KNOWN_ISSUES + ARCHITECTURE): locks live in the Electron main process and die
    with it; cross-process protection for profiles is the on-disk `Singleton*` artifact check. The
    `LockStore` interface reserves a future durable adapter. Re-stated in this doc's limitations.

14. **Any hidden deadlocks or lock leaks?**
    No hard deadlocks found: dispatch uses non-blocking `tryAcquire*`; the only blocking waits are
    `acquireSlot` (repeat path, 5-min timeout) and `acquireMany` (poll-based with timeout).
    `withLocks` releases in `finally`; fencing versions make stale releases no-ops instead of
    corrupting newer holders; `releaseOwner(instanceId)` in the engine `finally` is the leak
    backstop. One theoretical livelock: two multi-claim acquirers polling can starve under constant
    contention — acceptable for the coarse-grained (per-instance) claims used here; documented.

15. **Are the env defaults safe for desktop Electron usage?**
    Yes — 2 browsers / 4 flows / 2 pages-per-context / 512 MB free-memory floor are conservative
    for a desktop host and env-overridable. The watchdog timer is `unref()`d so it never keeps the
    process alive. Phase 2 adds `AWKIT_MAX_PER_ORIGIN` (default 2) and `AWKIT_MAX_PER_ACCOUNT`
    (default 1) semaphores plus `AWKIT_TRACE_MODE` (default `onFailure`, active only when the
    engine provides a traces dir, so verify scripts and embedded runners see zero overhead).

## Gaps fixed in Phase 2 (summary)

- Heartbeat refresh on `resumeInstance`/`retryHandoff` (prevents post-handoff stale notes).
- Failure screenshots default on (best-effort, never masks the step error).
- Per-step failure traces (`TraceService`, chunked, engine-run only, `AWKIT_TRACE_MODE`).
- Origin/account dispatch semaphores (`origin:<host>` from baseUrl/first goto, `account:<envFile>`),
  released per instance; saturation of one origin/account does not block other instances.
- Runtime status surface: engine methods + `execution:runtimeStatus` IPC + Instance Monitor strip.
- Watchdog snapshot (last scan, recent findings, swept locks).
- New deterministic verifiers: `verify:locks`, `verify:browser-pool`, `verify:watchdog`,
  `verify:artifacts`, `verify:runtime-status`.

## Remaining single-process / uncovered items (honest)

- Locks, pool, and watchdog are **single Electron main process** only; a second app instance is not
  coordinated (profiles still protected cross-process by `Singleton*` artifacts).
- `stopInstance` does not terminate the in-flight browser; the slot frees when the runner notices.
- Direct `PlaywrightRunner` construction (verify scripts) bypasses pool/claims by design.
- Recorder browser lifecycle is outside the pool (single, user-driven).
- Origin derivation uses `baseUrl`/first `goto` URL — mid-flow navigation to other origins is not
  re-claimed.
- Distributed execution (durable store, cross-host leases) is the next roadmap phase, not started.
