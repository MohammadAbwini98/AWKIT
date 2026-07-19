# KNOWN_ISSUES

Evidence-based. Update when a task reveals a repeated bug, fragile area, or risky assumption.

## Confirmed (observed during development)

- **Fresh install seeded bundled samples as real user records — FIXED (bd `awkit-64x`, found + fixed 2026-07-19).**
  First-run profile stores seeded from `resources/sample-workflows` etc. (`app/main/profileStores.ts`
  `seedFolder`), so a brand-new install showed "Customer Onboarding Workflow", "Login Flow", and
  `customers.json` as ordinary user records — against RULES.md "no demo/seed data — use empty states".
  **Resolution:** `seedFolder` dropped (flows + workflows) and the `ensureDefaultDataSource` /
  `ensureDefaultRuntimeInputs` first-run injectors deleted (stores return `store.list()`); samples remain in
  `resources/` via `npm run seed:mock-fixtures`. `verify:e2e-sweep` flipped to assert empty states (13/13).
  Evidence: `test-artifacts/2026-07-19-e2e-qa/screenshots/e2e-sweep/`.
- **GUI verifiers that assert shell chrome break silently when `AppFrame` changes (2026-07-19).**
  PR #21's AccountMenu replaced `.app-frame-user`/`.app-frame-logout` and the licensing placeholder;
  `verify:auth-gui` and `verify:admin-gui` kept asserting the old DOM and were broken on `main` until
  repaired in the E2E QA assessment (now 18/18 and 11/11). When touching `AppFrame`/admin chrome,
  re-run BOTH suites before merging.

- **ICO frame-offset corruption in `png-to-ico` 2.1.0 — FIXED (2026-07-16).**
  `scripts/generate-app-icon.mjs` previously passed multiple PNGs to `png-to-ico`. Its DIB writer appended
  an AND mask but omitted those bytes from each directory entry's length and the next frame's offset, so a
  nominally multi-frame ICO could point into previous-frame mask data. The generator now embeds each RGBA
  PNG directly in the ICO, calculates exact offsets, and validates frame signature/dimensions/bit depth
  before writing. The package may remain installed as an unused dev dependency, but do not reintroduce it
  into the icon path without a byte-level multi-frame validation.
- **Soak-benchmark accounting bugs — FIXED (2026-07-16), not observability defects.** In
  `scripts/benchmark-engine-soak.mts`: (1) the run-summary invariant compared `runObsSummaries` (all terminal
  runs) against `durableTerminalRuns = completed + failed` read **pre-teardown** — omitting the `cancelled`
  runs that `stopAll()` finalizes at teardown, so a healthy soak reported a spurious `runSummaries MISMATCH`.
  Now recomputed post-teardown incl. `cancelled` (verified: `4666 == 4666`, and a 40 s re-run `203/203 MATCH`).
  (2) A single NaN event-loop-delay sample (a `monitorEventLoopDelay` window with no events → `.mean` is NaN)
  poisoned `Math.max(...series)` → `peak=NaN`; now a NaN-safe `peakOf()` (corrected 30-min peak 44.5 ms). The
  run-summary finalization and leak-free teardown were always correct — only the harness's derived display was wrong.
- **Packaged-EXE observability-UI validation is a remaining release gate (2026-07-16).** The shippable `dist/`
  EXE is from 2026-07-07 — **before** the (uncommitted) observability work — so it lacks the Runtime Analytics
  observability panels; and a fresh `electron-builder` package OOMs on this 16 GB host (see the `-mx=9` note
  below). Final Phase 5 UI validation therefore used `_electron.launch` on the **current-code dev build**
  (`out/`, the production renderer bundle) with a seeded `LOCALAPPDATA` — the strongest available local method
  (`verify:runtime-analytics-gui` 36/36). Re-package on a higher-memory host and re-run the walkthrough against
  the actual EXE before declaring `PRODUCTION-READY`. Seed fixtures with `seed:observability-fixtures`.
- **Observability query latency is aggregation-bound, not sub-ms (2026-07-16).** Measured
  (`benchmark:observability-storage`): run-aggregating analytics (overview, workflow summary, capacity
  analytics, rankings, run-history deep page) are **tens-to-~500 ms P95** at 5k–50k runs — acceptable for the
  async/windowed page but the earlier "sub-millisecond" claim was wrong. Cost is JS aggregation over the
  window, not missing indexes (EXPLAIN confirms index use); do **not** add speculative indexes. Storage is
  ~3 MB/day uncapped (not ~1 MB/day), bounded in steady state by retention.
- **Shared pool over-launched browsers under concurrent dispatch — check-then-act race, FIXED (2026-07-15).**
  `SharedBrowserPool.selectOrLaunch` read the per-key browser count, then `await`ed `launch()` *before*
  registering the record, so N contexts acquired at once each saw "under cap" and launched their own browser
  (`maxBrowsers=2, concurrency=6` → **6** browsers, 1 launch key). The per-context-factory benchmark never hit
  it (contexts created serially); only the real concurrent `ExecutionEngine` dispatch path exposed it. Fixed
  by reserving the browser+context slot **atomically under the pool mutex** and creating the context outside
  the lock (rollback on failure). Peak browsers 6 → 2. Guarded by a regression test in
  `verify:shared-browser-pool` (delayed launch, 8 concurrent acquisitions, cap holds). Lesson: any
  read-count-then-await-launch pool logic must reserve the slot before releasing the mutex.
- **Playwright 1.61 `Browser` exposes no `process()` — per-browser PID attribution unavailable (2026-07-15).**
  Only `BrowserServer` and `ElectronApplication` declare `process(): ChildProcess`; a locally-launched
  `chromium.launch()` `Browser` has `typeof browser.process === "undefined"` at runtime (verified). So
  `SharedBrowserPool.browserRoots()` is always empty and **memory-based browser recycling (`browserRecycleMemoryMb`)
  ships wired but inert** — `BrowserProcessSampler` and the drain lifecycle are complete and unit-tested, but
  never fire without a root PID. It would activate unchanged if a launch path surfaced the PID (remote
  `launchServer()`+`connect`, or a future Playwright). Do not claim recycling is proven end-to-end on this stack.
  The pool's `closeReasons` telemetry confirms it: `MEMORY_THRESHOLD` is always 0; browser relaunches are
  `CONTEXT_COUNT_RECYCLE` (after `browserRecycleAfterContexts`) + `IDLE_DRAIN`/`POOL_SHUTDOWN`. Do NOT describe
  those (or falling Chromium RSS from them) as "memory-based recycling".
- **Shared pool + A8 weighted admission now default ON (2026-07-15).** `ConcurrencyConfig.ts` ships
  `useSharedBrowserPool: true`, and `workloadWeights` defaults to the resolved pool state (never on without the
  pool — Config C measured harmful). Integration verifiers now exercise the shared path by default. Turn off
  with `AWKIT_SHARED_BROWSER_POOL=0`; explicit `AWKIT_WORKLOAD_WEIGHTS` overrides either way. Not yet validated
  on a clean packaged machine or lower-spec hardware — flag as a release-gate risk.
- **Playwright headless Chromium runs as `chrome-headless-shell.exe`, NOT `chrome.exe` (2026-07-15).** Any
  process-tree / consumption sampling that filters by image name must include it. `ProcessTreeSampler`
  (`CHROMIUM_IMAGE_NAMES`) was missing it → the Chrome Consumption dashboard undercounted headless instances
  (each is 4+ helper processes). Fixed. AWKIT's default run is HEADED (`execution.ipc` `headless = request.headless ?? false`),
  so this only affected headless runs. The benchmark harness matches `Name LIKE '%chrom%'` to be safe.
- **Playwright keeps automated pages `visibilityState: visible`, so Chromium background throttling never
  engages (2026-07-15).** The 20-rep occlusion benchmark (`scripts/benchmark-occlusion.mts`) proved that
  re-enabling `--disable-background-timer-throttling` / `--disable-backgrounding-occluded-windows` /
  `--disable-renderer-backgrounding` (via selective `ignoreDefaultArgs`) yields NO CPU saving for AWKIT
  instances — even a genuinely minimized window + background tab reports `pageHidden 0%`, so page timers stay
  full-rate. Minimizing already stops the compositor (rAF 60→1/s), flooring CPU at ~1.5% in the current
  default. Trap for anyone trying to cut idle CPU via throttling: it does nothing here. (Background throttling
  was removed from the low-resource profile for this reason; kept in `custom` only.)

- **RESOLVED & ROOT-CAUSED (2026-07-11): ordinary run completions falsely tripped "browser crash rate
  high — pausing new dispatch", stranding the queue.** Symptom (from a 50-instance run): backpressure
  engaged with `Crashes 5`, `Browsers 0/2`, ~46 instances frozen `Pending`, while the host was idle
  (CPU 2.4%, Mem 48.8%). Root cause was a **browser-lifecycle ordering bug**, not real instability:
  1. In **`browserContext` isolation** (the default, shown as "Context" in the monitor) the runtime owns
     a real `Browser` (`BrowserContextFactory` non-persistent branch); `close()` calls `browser.close()`,
     which emits Playwright's `disconnected`. (Persistent-context runs were immune — no `Browser` object.)
  2. `PlaywrightRunner.executeScenario` closes the runtime **inside its own `finally`** (`closeRuntime`),
     i.e. *before* it returns to the engine — and the engine only calls `browserPool.releaseSlot(slot)`
     in *its* `finally`, *after* `executeScenario` returns. So at close time `slot.released` was still
     `false`, and `BrowserWorkerPool`'s `disconnected` handler scored the **normal** close as a crash.
  3. Every completed instance (pass *or* fail) therefore added one phantom crash to the 5-min window.
     Past `maxRecentCrashes` (default 3), `BackpressureController.admit` blocked all new dispatch. The
     failing instances here also died on "Navigate to …" (unreachable target → `navigation` class), which
     just supplied the stream of quick completions that inflated the count (5 Failed ⇒ 5 "crashes").
  - **Fix:** the runner announces intentional teardown via a new `onRuntimeClosing` option (fired in
    `closeRuntime`, covering end-of-run, cancel, and Reuse Session swap); the engine wires it to
    `BrowserWorkerPool.markExpectedClose(slot, generation)`, and the pool's `disconnected` handler skips
    crash-counting when `slot.expectedCloseGeneration === generation`. Genuine crashes are unaffected — a
    mid-run disconnect with no signal, a page `crash` event, and the engine's explicit `browser-crash`
    classification all still count — and the signal is **generation-scoped** so a later generation's real
    crash after a swap is still counted. Guarded by `verify:browser-pool` Part E (16/16).
  - **Fragile area to respect:** `executeScenario` owns the browser close (in its `finally`) and it runs
    **before** the engine releases the pool slot. Any future change to crash accounting must not assume
    `slot.released` is set at close time.

- **Compound/container locators (2026-07-11) — two design assumptions to keep in mind.**
  1. **Manual locator edits keep the Recorder's `alternatives`/`context`** (approved default). Because
     `LocatorFactory` resolves the primary *and* alternatives inside `context.container`, hand-authoring
     a globally-scoped primary on a step that still carries a recorded container can mis-scope it (the
     container narrows it to the wrong/zero match). If a manual locator misbehaves, clear the strategy or
     re-record. Only the `quality` badge is cleared on value/name edits; container/alternatives persist.
  2. **Runtime self-healing never guesses.** `LocatorFactory.narrowToActionable` only resolves an
     ambiguous match when exactly one is visible/enabled/in-viewport; two+ equally-actionable twins fail
     with the friendly diagnostic by design (clicking the wrong twin is worse). It only turns failures
     into successes — it never changes which element an already-unambiguous step resolves to.

- **Phase 5 packaged-walkthrough findings (2026-07-06) — read before writing any script that drives
  the packaged app.** Discovered while building `npm run verify:packaged-walkthrough` (five
  calibration runs against the real `dist/win-unpacked` EXE):
  1. **The packaged `WebFlow Studio.exe` that gets spawned is a LAUNCHER STUB** — the real Electron
     main process is its *child* (verified: Playwright `app.process().pid` ≠
     `app.evaluate(() => process.pid)`). Killing the stub (Node `process.kill`, `taskkill` on the
     spawned pid) leaves the real app alive as a **zombie with an open window** — two such zombies
     were produced before this was understood. Any kill/restart/orphan test MUST target the real
     main pid from `app.evaluate(() => process.pid)`. Bundled-Chromium browser processes are
     children of the real main, not the stub, so process-tree accounting must use that pid too.
  2. **When the REAL main process dies, orphaned bundled-Chromium browsers self-exit** (observed
     cleanly in the final walkthrough runs) — the earlier "8 leaked chrome processes" observation
     was an artifact of killing only the stub. Startup recovery then classifies the interrupted
     safe run `orphaned`/recoverable with a note; a run whose browser is closed under a live app
     instead fails normally with `errorClass: context-closed` and is NOT a recovery case.
  3. **Bundled Chromium Google-service startup egress — RESOLVED by Phase 5.1C hardening
     (2026-07-07).** The original Phase 5 finding: every bundled-Chromium launch emitted a short
     burst of non-loopback Google-service TCP connections (4–5 endpoints in 142.250–251.\*/216.239.\*,
     path-attributed to `resources/browsers/chromium/chrome.exe`) under plain Playwright launch
     options; app data itself always stayed on loopback. The follow-up named here (explicit
     kill-switch flags in the launch path) was implemented as `src/runner/ChromiumHardening.ts`
     (`buildChromiumHardeningArgs`, wired into `BrowserContextFactory` + the recorder): background-service
     switches + a `--disable-features` superset of Playwright's list + `--host-resolver-rules` mapping the
     emitting service hosts (GCM/mtalk, component/variations updaters, safebrowsing, optimization hints,
     time.google.com, gvt1) to loopback + gaia/search-preconnect redirects. Proven: `verify:chromium-hardening`
     13/13 (bundled Chromium made ZERO non-loopback connections over a 20 s idle window while external
     navigation still worked) and `AWKIT_WALKTHROUGH_STRICT_NET=1 npm run verify:packaged-walkthrough` 70/70
     (strict no-egress passes in the packaged app). Toggle off with `AWKIT_CHROMIUM_OFFLINE_HARDENING=false`.
     NOTE: this hardening is for AWKIT-owned automation/recorder browsers only — it is never applied to the
     user's real Chrome in `SessionCaptureService` (protected-login handoff must stay a plain browser).
  4. **`execution:runWorkflow` only VALIDATES unless `dryRun: false` is passed explicitly**
     (`request.dryRun !== false` gate in `app/main/ipc/execution.ipc.ts`) — the UI always passes
     it; programmatic drivers that forget it get `status: "validated"` and no run.
  5. **Instance ids are decorated:** `instance.executionId` is the raw run UUID, but
     `instance.instanceId` is `<profileId>-<timestamp>-<hash>-i<N>` (`InstanceManager.
     createExecutionId`); artifact folders under `instances/`/`logs/`/`screenshots/` use the
     DECORATED id while `reports/<rawExecutionId>.json` uses the raw one. Match instances by
     `executionId` equality + `instanceId.endsWith("-i<N>")`, never by reconstructing the prefix.
  6. **The mock site binds `127.0.0.1` and Node 18 resolves `localhost` to `::1` first**, so a
     Node-side readiness probe against `http://localhost:4321` reports the server down while
     browsers (which try both families) connect fine. Probe `http://127.0.0.1:<port>` explicitly.

- **Packaging the final EXEs OOMs at 7-Zip `-mx=9` on low-memory machines (2026-07-07).** On this
  16 GB dev machine (with heavy memory-compression pressure), `npm run package:portable` /
  `package:nsis` rebuilt `dist/win-unpacked` successfully but `7za a -mx=9` (max compression of the
  ~1.2 GB payload) failed with `ERROR: Can't allocate required memory!`, so the portable/NSIS
  single-file EXEs were **not** produced — the old ones stayed on disk. Two consequences:
  1. **The wrappers masked the failure.** `scripts/package-portable.ps1` /
     `package-per-user-installer.ps1` used `$ErrorActionPreference="Stop"`, which does NOT trip on a
     native-exe non-zero exit in PowerShell 5.1, then printed "… created under dist/." and exited 0 —
     a silent false success that leaves a **stale EXE wrapping the previous app.asar**. Both scripts
     were **fixed** to `throw` on a non-zero `$LASTEXITCODE`. Always check the app.asar mtime vs. your
     source changes before trusting a packaged EXE.
  2. **Workaround used:** a one-off `npx electron-builder --win <portable|nsis> -c.compression=store`
     (no committed-config change) avoids the `-mx=9` allocation and produces a functional but
     **uncompressed (~1.2 GB) EXE** that wraps the hardened payload — fine for validation, not for
     distribution. A shippable max-compressed + code-signed build must be produced on a
     higher-memory machine (or with `"compression": "normal"` in `electron-builder.json`).
  All packaged verifiers (`verify:packaged-runtime`, `verify:packaged-walkthrough`) drive
  `dist/win-unpacked` directly, so they validate the hardened payload regardless of the final-EXE wrap.

- **Concurrency defaults throttle instance throughput (2026-07-06) — intentional, not a bug.** The new
  browser worker pool caps live Chromium processes at `AWKIT_MAX_BROWSERS` (default **2**) and active flows
  at `AWKIT_MAX_ACTIVE_FLOWS` (default **4**), so a run configured with `maxConcurrentInstances` above the
  cap queues the extra instances (they start as slots free up) instead of launching unbounded browsers.
  Backpressure also blocks new dispatch on low host memory (`AWKIT_MIN_FREE_MEMORY_MB`, default 512) and
  high crash rate — the reason is logged (`[backpressure] …`) and visible in
  `ExecutionEngine.getCapacitySnapshot()`. Raise the env limits for machines that can handle more.
  **Retry behavior also changed:** a step's `retry.count` only re-runs transient failure classes
  (navigation/timeout/locator/download); steps whose name/value contains submit/approve/delete/send/pay/
  confirm-style keywords, and dead browser/context/page failures, are never auto-retried (the block reason
  is logged). In-process persistent-profile reuse now fails fast with `ProfileLockedError` instead of racing
  two launches on one `userDataDir`.
  **Phase 2 additions (2026-07-06):** instances sharing one target origin/account also queue beyond
  `AWKIT_MAX_PER_ORIGIN` (2) / `AWKIT_MAX_PER_ACCOUNT` (1); failing engine-run steps save a Playwright
  trace zip + full-page screenshot by default (disable per step with `onFailure.screenshot: false`, or
  traces globally with `AWKIT_TRACE_MODE=off`) — expect extra files under the instance's
  `traces/`/screenshots dirs. **Single-process caveats (by design, documented):** locks/pool/watchdog
  live in the Electron main process only — a second app instance is not coordinated (profiles still
  protected cross-process by Chrome `Singleton*` artifacts); `stopInstance` marks cancelled but does not
  kill the in-flight browser (slot frees when the runner notices); dangerous-mutation detection is an
  English keyword heuristic; origin claims derive from `baseUrl`/first `goto` only (mid-flow cross-origin
  navigation is not re-claimed). See `docs/ai/CONCURRENCY_PHASE2_REVIEW.md` for the full audit.
  **Phase 3 (2026-07-06) resolved most of those single-process caveats:** profiles are now protected
  **cross-process** by the durable wx-file lock store (plus `Singleton*` artifacts for external browsers);
  `stopInstance` now HARD-cancels (closes the live browser; runs end `cancelled`); the keyword heuristic
  is only a fallback behind explicit `FlowStep.safety` metadata + node-type defaults; mid-flow
  cross-origin navigation re-claims `origin:*`; backpressure samples CPU/system/process memory.
  **New Phase 3 caveats (by design — see `docs/ai/PHASE3_DURABLE_RUNTIME.md`):** the SQLite runtime store
  uses `sql.js` (WASM) with atomic-rename persistence — a hard kill can lose the last ≤300ms of
  non-critical writes, and the DB is single-writer per app process; unknown/custom step types are no
  longer auto-retried (conservative default — add explicit `safety` metadata to opt in); a saturated new
  origin mid-flow fails that step with a retryable timeout; **packaged builds must ship
  `node_modules/sql.js`** — RESOLVED in Phase 4 (2026-07-06): the manifest generator/validators now
  require `sqlJsRuntimeIncluded`/`sqlJsWasmIncluded`, `electron-builder.json` lists the dist WASM
  explicitly, portable + NSIS EXEs were rebuilt, and `npm run verify:packaged-runtime` (24/24)
  proves the WASM loads inside the packaged main process (see `docs/ai/PHASE4_RELEASE_HARDENING.md`).
  **Trap (Phase 4):** the manifest policy (`validateDependencyManifestPolicy`) now FAILS a manifest
  without the sql.js flags — never ship a stale `resources/dependency-manifest.json` with a new EXE
  (both packaging scripts regenerate it automatically).

- **Windows `wx`-create vs concurrent unlink race in durable locks (2026-07-06, fixed — don't
  reintroduce).** Found by `npm run verify:stress:locks`: creating `holder.lock` with the `wx` flag
  while another release is unlinking the same path surfaces as **`EPERM`/`EBUSY`** on Windows, not
  `EEXIST`. `DurableLockStore.acquireExclusive` treats those codes as contention (retry once → clean
  `null` denial). Don't revert to rethrowing every non-`EEXIST` code — under cross-process churn it
  turned lock contention into an exception at the call site.
- **`verify:durable-locks` can flake under heavy host load (observed once, 2026-07-06).** Part B
  ("parent denied the 3rd unit") failed exactly once while `electron-builder` was saturating the CPU
  in parallel (the spawned child's semaphore units apparently landed late); an immediate re-run
  passed 17/17. If it fails, re-run it on an idle machine before treating it as a regression — the
  verifier spawns a real second process and is timing-sensitive.

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
- **RESOLVED (2026-07-05): Reuse Session browser swap no longer dies after relaunch.** The in-app failure
  was a lifecycle/reference bug, not a bad saved profile: `runStepWithWaits` restored the pre-swap active
  page after `Auto Secure Login` / `Reuse Session`, so the next `Navigate` could run against an old closed
  page/context; stale lifecycle events and cleanup also lacked generation guards. `PlaywrightRunner` now
  performs a generation-guarded two-phase persistent-context swap, re-points the live `StepExecutor` to a
  page from the new context, closes the old generation with an explicit reason, ignores stale old-generation
  page/context/browser close/disconnect events, blocks duplicate swaps, checks profile lock artifacts before
  launch, and verifies the new runtime remains alive for at least 2 seconds. `StepExecutor` liveness-checks
  the browser/page before every step and does not restore the old active page after session-swap steps.
  `ExecutionEngine` no longer leaves an unhandled rejection from fire-and-forget `.finally()` cleanup.
  Real Electron `Smart-Rec-Chatgpt` verification on 2026-07-05: `Reuse Session` succeeded, `Navigate to
  https://chat.openai.com` succeeded, and there was no `Target page, context or browser has been closed`.
  Trap: do **not** add a `createdBy: awkit-playwright` guard or block `manualChromeHandoff` profiles; real
  Chrome/Edge session capture is the protected-login design.
- **RESOLVED (2026-07-05): workflow protected-login capture must not inherit navigation/action timeouts.**
  Auto-detected Protected Login Handoff can run immediately after a `goto`, whose `timeoutMs` is an action
  timeout, not a human-login window. Reusing it made the normal Chrome/Edge session-capture window time out
  while the user was still logging in. `StepExecutor.captureProtectedLoginSession` now uses
  `config.handoffTimeoutMs` only, with the default 10 minutes when unset and `0` disabling the timeout for
  explicit Protected Login Handoff nodes. Trap: do **not** re-couple protected-login session capture to
  `step.timeoutMs`; keep action/browser timeouts separate from human handoff timeouts.
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

- **Oracle: the real UCP path has never linked against real jars or opened a real connection.** This is the
  Oracle feature's highest residual risk. `OracleUcpQueryExecutor` lives in the gated
  `oracle-jdbc-bridge/src/main/java-oracle/` source set, which compiles only when ojdbc/ucp are vendored —
  and they cannot be vendored here (build-time network is blocked). It IS stub-compiled against the real
  JDK `java.sql` on every `verify:oracle-bridge-real-build`, so its JDBC usage and internal signatures are
  validated; the **UCP API shape is not**. Specifically unverified: whether real UCP method signatures match
  (e.g. `setConnectionWaitTimeout(int)` vs. newer Duration-based setters), real pool lifecycle/teardown
  semantics, and real ORA-code → error-category mappings. Do not assume the executor works because it
  "compiles" — the compile is against stubs. Clear via `ORACLE_JDBC_VALIDATION_GATES.md`.
- **Oracle: everything green is green against a MOCK executor.** 218 checks pass with no database. They
  prove the protocol, SQL gate, cancellation, timeout, limits, lazy resolution, and fail-closed policy —
  they prove nothing about real driver connectivity, real pooling under load, or real latency. Treat
  `INTEGRATION-CANDIDATE` literally.
- **Oracle: `MockQueryExecutor` must never become reachable in a packaged build.** Three layers enforce
  this (resolver env, manager handshake, Java `Main`). If you touch `OracleRuntimeResolver`,
  `OracleJdbcBridgeManager.start()`, or `Main.selectExecutor()`, re-run `verify:oracle-runtime` +
  `verify:oracle-packaging` — they exist specifically to catch a regression here. The original bug was
  exactly this: `oracleService` forced the mock flag on any missing driver with no packaged guard.
- **CI does not run on stacked PRs.** `.github/workflows/ci.yml` triggers only on `push`/`pull_request` to
  `main`, so a PR based on another branch gets **no checks at all**, and `mergeStateStatus=CLEAN` then means
  "nothing blocking", not "verified". PR #12 merged this way (verified locally instead). Verify stacked PRs
  locally, or retarget to `main` and wait for CI, before trusting a green-looking merge state.
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

- **Optional grid panels must not leave empty slot elements or state classes behind.** In
  `DesignerCanvasLayout`, an explicit `rightPanel={null}` means there is no second grid child. Rendering
  an empty drawer slot in the one-column state creates an implicit second row and halves the canvas;
  applying `right-collapsed` without a panel reserves an empty narrow column. The Flow Designer GUI
  verifier guards both dimensions and requires zero slots in the no-inspector state.

- **Canvas pointer gesture refs must not be read from queued React state updaters.** Pointer-up releases
  `panState`/drag state immediately, while React may execute a pointer-move updater or commit `setDrag`
  afterward. Snapshot immutable pointer-down values before calling a state setter, and keep the latest
  computed node position in the gesture ref for pointer-up/drop. Regression coverage lives in the real
  Electron Flow Designer verifier (rapid pane drag plus hit-tested node-over-node drag). Do not replace
  this with optional chaining or error suppression; that would hide a broken gesture.

- When packaging fails at the startup gate, the cause has historically been a **manifest** issue
  (BOM or stale path/name), not a missing file. Check `resources/dependency-manifest.json` first.
