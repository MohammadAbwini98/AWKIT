# TESTING

## Confirmed

### Frameworks present
- `@playwright/test` (devDependency) — config `playwright.config.ts` (`testDir: "tests"`).
- `tsx` (devDependency) — used to run the standalone runner verification script on Node 18.

### What exists
- `tests/runner.mocksite.spec.ts` — Playwright test exercising the runner against the mock site.
- `scripts/verify-runner.mts` — standalone live verification (run via `npm run verify:runner`)
  that drives `StepExecutor` / `FlowExecutor` / `PlaywrightRunner` against `mock-site/` with a real
  Chromium. As of the last run: **82 checks pass** (node types, loop, runFlow + recursion guard,
  Protected Login Handoff pause/resume, manual handoff in-place resume, workflow runtime connector-structure validation,
  **Route Change** [opens a new tab, switches the active page, fills/clicks/asserts on it], **Reuse Session
  browser lifecycle** [two-phase swap, stale old-generation lifecycle ignored, locked profile fail-before-
  navigate, duplicate swap mutex], **workflow protected-login session capture** [auto-detected and explicit
  handoff close Playwright, launch normal-browser capture, load captured profile, and ignore the triggering
  navigation timeout while waiting for the normal browser], **Save Session**
  [writes storageState; fails on missing name / no-overwrite collision], flow-level and workflow-level
  connector routing).
- `mock-site/server.mjs` — offline Feature Test Lab website, default port 4321. Core legacy routes remain
  `/login` → `/form` → `/success`, with `/details` opened via `#openNewTabButton` for Route Change.
  Feature lab routes include `/smart-waits`, `/recorder-lab`, `/designer-lab`, and `/api/delay`.
- `scripts/verify-mock-site.mjs` (`npm run verify:mock-site`) — starts the mock site and verifies Feature
  Test Lab scenario URLs, Smart Wait delay behavior, Recorder selectors, Designer/Workflow Builder
  selectors, and local delayed API behavior. As of the last run: **28 checks pass**.
- `scripts/verify-protected-login.mts` (`npm run verify:protected-login`) — pure unit checks for the
  protected-login detector (provider URLs, Google insecure-browser page, MFA/CAPTCHA text, no false
  positives, no secret fields). As of the last run: **16 checks pass**. `verify:runner` also covers the
  Protected Login Handoff node pausing/resuming and auto-detect not pausing normal mock pages (82 total).
- `scripts/verify-recorder-locator.mts` (`npm run verify:recorder`) — live Chromium checks for recorder
  locator generation, runner locator safeguards/fallbacks, and Smart Wait recorder observation
  (safe fetch/XHR path-only signals, loader disappearance, URL changes, table/list/card waits, toast,
  enabled controls, polling ignored, fixed-delay fallback). As of the last run: **57 checks pass**.
- `scripts/verify-recorder-draft.mts` (`npm run verify:recorder-draft`) — browser-free recorder draft,
  URL-history, legacy wait-time, and smart-wait compatibility checks. As of the last run: **17 checks pass**.
- `scripts/verify-waits.mts` (`npm run verify:waits`) — Smart Wait runner checks for before/after waits,
  armed response waits, loader/element/table/list/URL/DOM/fixed-delay waits, and failure diagnostics
  (phase, sanitized URL, reason, suggestion), including stale recorder-generated navigation response waits
  being skipped only after a successful `goto`. As of the last run: **21 checks pass**.
- `scripts/verify-flow-designer-gui.mjs` (`npm run verify:flow-designer`) — real Electron GUI walkthrough
  for Flow Designer connector behavior and saved-flow dropdown behavior. As of the last run: **19 checks
  pass**.
- Phase 2 focused verifiers (all deterministic, no external websites): `verify:locks` (**15** —
  concurrent profile acquisition, release after success/throw/failed `launchPersistentContext`,
  kind-prefix origin/account capacities, active+stale snapshots), `verify:browser-pool` (**13** —
  fake runtimes: saturation, release after failure/cancel, generation-guarded page/crash tracking,
  backpressure), `verify:watchdog` (**13** — stale/orphan detection, manual-handoff
  no-false-positive, dedupe, snapshot), `verify:artifacts` (**13** — live Chromium: failure trace
  zip saved / success discarded, default failure screenshot, trace errors never mask the step
  error, state files), `verify:runtime-status` (**15** — dispatch claims, lock debug snapshot,
  capacity counts, aggregated status shape).
- Phase 3 verifiers (deterministic; temp SQLite/lock dirs; live parts local-only):
  `verify:durable-store` (**11** — migrations idempotent across reopen, real SQLite file,
  run/attempt/heartbeat persistence across restart, recovery reads), `verify:durable-locks`
  (**17** — REAL second Node process cannot take the same exclusive profile lock; semaphore
  capacity across processes; TTL/dead-pid stale quarantine with reasons; fencing;
  ProfileLockManager dual-layer), `verify:cancellation` (**12** — live Chromium: a 30s wait
  cancelled in seconds with the browser closed, profile lock released, pre-cancelled token,
  cancelled class never retried, manual-handoff cancel safe), `verify:safety-policy` (**17** —
  explicit metadata overrides keywords both ways, idempotency-key gate, infra-terminal beats
  explicit), `verify:dynamic-origin-claims` (**14** — tracker semantics + live
  127.0.0.1→localhost origin transition), `verify:resource-sampling` (**14** — sampler values,
  pressure blocking with reasons, broken sampler tolerated), `verify:startup-recovery` (**10** —
  interrupted runs classified orphaned/recoverable vs failed/manual-review, idempotent, persisted).
- `scripts/verify-concurrency.mts` (`npm run verify:concurrency`) — concurrency & stability layer:
  resource locks (exclusive/shared/semaphore, TTL + fencing, atomic multi-acquire), semaphore
  capacity/FIFO/timeout, browser pool saturation + crash window, backpressure admission reasons,
  error classifier + retry policy (incl. the dangerous-mutation guard), runtime state machines, node
  attempts, watchdog stale/orphan detection + stale-lock sweep, JSONL run logger, run-state artifacts,
  FlowExecutor classified-retry integration, and a live Chromium profile-lock/cleanup check. As of the
  last run: **78 checks pass**.
- Phase 4 verifiers (2026-07-06, see `docs/ai/PHASE4_RELEASE_HARDENING.md`):
  `verify:packaged-runtime` (**24** — run AFTER `npm run package:portable`: app.asar ships the
  sql.js WASM, packaged manifest flags, REAL packaged-EXE launch via Playwright `_electron`,
  `appMode=packaged` + durable store enabled + `%LOCALAPPDATA%` runtime paths, external read of the
  produced `runtime.sqlite`, artifactsRoot write probe), and the deterministic stress/soak set —
  `verify:stress:concurrency` (**13**), `verify:stress:cancellation` (**8**),
  `verify:stress:locks` (**10** — this one found and now guards the Windows `EPERM` wx-create race
  in `DurableLockStore`), `verify:stress:artifacts` (**7**), `verify:soak:runtime` (**8**).
  Tunables: `AWKIT_STRESS_INSTANCES` (25), `AWKIT_STRESS_MAX_BROWSERS` (2),
  `AWKIT_STRESS_TIMEOUT_MS` (120000; each script exits 1 on timeout as a deadlock guard).
- Phase 5 (2026-07-06, see `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md`):
  `verify:packaged-walkthrough` (**68** — run AFTER `npm run package:portable`; launches the REAL
  packaged EXE with a FRESH empty `LOCALAPPDATA` root = clean first-run simulation): first-run
  window renders (no white screen), durable runtime init at startup, runtime.sqlite + folders
  created under the fresh root, only bundled sample content present, fixtures imported through the
  app's own IPC, a full workflow runs to `completed` with JSONL log/screenshot/report/state
  artifacts, hard cancellation ends `cancelled` with the Chromium tree gone and slot+locks freed,
  4 concurrent instances never exceed the 2-browser cap at OS level, recorder start/cancel works,
  clean exit leaves no Chromium, a hard kill of the REAL main pid (launcher-stub gotcha — see
  KNOWN_ISSUES) leads to startup recovery: orphaned run surfaced recoverable, Recoverable Runs
  panel renders in the real UI, markReviewed clears it, runtime.sqlite reads externally, the
  ACTUAL portable EXE boots a second fresh profile, NSIS sha512 matches latest.yml, and the app's
  processes make NO non-loopback TCP connections (bundled-Chromium startup egress is warn-only;
  `AWKIT_WALKTHROUGH_STRICT_NET=1` makes it fail). Evidence: `dist/phase5-evidence/`.
- Phase 5.1 (2026-07-07, Chromium no-egress hardening — `src/runner/ChromiumHardening.ts`):
  `verify:chromium-hardening` (**13** — launches the BUNDLED Chromium with `buildChromiumHardeningArgs`
  and asserts ZERO non-loopback TCP over a 20 s idle window while external navigation, incl.
  `google.com`, still works; part C auto-skips offline). The hardening was then confirmed in the
  packaged app: `AWKIT_WALKTHROUGH_STRICT_NET=1 npm run verify:packaged-walkthrough` → **70** with the
  strict no-egress check passing (bundled Chromium made zero non-loopback connections — the Phase 5
  Google-service burst is eliminated). `verify:packaged-runtime` is now **25** (adds the process-tree
  teardown assertion). NOTE: packaged verifiers drive `dist/win-unpacked` (rebuilt hardened); the
  final single-file EXEs could not be max-compressed on the dev machine (7-Zip `-mx=9` OOM — see
  KNOWN_ISSUES).
- `scripts/seed-mock-fixtures.mjs` (`npm run seed:mock-fixtures`) — imports test-only mock
  flows/workflows/data source into the runtime userData folders for manual GUI testing against the
  mock site. Sources live in `resources/test-fixtures/mock-site/` (see its README); they never
  auto-load and are excluded from packaged builds.

### How to verify
```bash
npm run build            # primary gate: tsc --noEmit + electron-vite bundles
npm run verify:runner    # live runner checks vs the mock site (tsx)
npm run verify:mock-site # Feature Test Lab scenario URLs, delays, and stable selectors
npm run verify:waits     # Smart Wait runner checks and diagnostics
npm run verify:concurrency # locks, browser pool, backpressure, retry policy, watchdog, artifacts
npm run verify:locks           # profile-lock lifecycle incl. failed-launch release
npm run verify:browser-pool    # slot caps, release paths, crash tracking (fake runtimes)
npm run verify:watchdog        # stale/orphan detection, manual-handoff safety, snapshot
npm run verify:artifacts       # JSONL logs, failure traces + screenshots, state files (live Chromium)
npm run verify:runtime-status  # dispatch claims, lock/capacity snapshots, status API shape
npm run verify:durable-store   # SQLite runtime store: migrations, persistence across restart
npm run verify:durable-locks   # cross-process durable locks (spawns a real second process)
npm run verify:cancellation    # hard cancellation (live Chromium; wait cancelled in seconds)
npm run verify:safety-policy   # explicit side-effect metadata vs keyword fallback
npm run verify:dynamic-origin-claims # mid-flow origin re-claiming (live local origin change)
npm run verify:resource-sampling     # CPU/memory sampling + backpressure thresholds
npm run verify:startup-recovery      # interrupted-run classification after app restart
npm run verify:soak:runtime          # SQLite store soak (write cycles, reopen, bounded heap)
npm run verify:stress:concurrency    # browser-cap + backpressure under 25-instance churn
npm run verify:stress:cancellation   # mass cancel releases slots; cancelled never retried
npm run verify:stress:locks          # lock churn, durable-file consistency, origin transitions
npm run verify:stress:artifacts      # concurrent JSONL/state artifacts complete + unmixed
npm run verify:chromium-hardening    # Chromium no-egress: zero non-loopback idle + nav still works
npm run validate:offline # offline bundle validation (for packaging/offline changes)
npm run package:portable && npm run verify:packaged-runtime  # packaged-app smoke (real EXE)
npm run verify:packaged-walkthrough  # packaged clean-profile FULL walkthrough (real EXE, fresh
                                     # LOCALAPPDATA, workflow run/cancel/kill/recovery/net watch)

# Manual UI fixtures (optional, for exercising the designer/builder by hand):
npm run mock-site            # terminal 1
npm run seed:mock-fixtures   # terminal 2 — seeds Mock — flows/workflows/data source
npm run dev                  # open the app; the mock fixtures appear in the tables
```

### Important caveats
- **No `lint` and no `test` npm script.** Don't assume `npm test` exists.
- The **`@playwright/test` runner** fails to load the TS/ESM config on **Node 18.16**
  (`Unknown file extension ".ts"`); it needs **Node ≥18.19/20**. On older Node, use
  `npm run verify:runner` (tsx works on Node 18).

## Required test behavior for future changes
- After changing runner/orchestrator/connector/node-execution logic, run `npm run verify:runner`
  and report the pass count; extend `scripts/verify-runner.mts` (and `tests/runner.mocksite.spec.ts`)
  with a case for the new behavior.
- After changing the mock site, run `npm run verify:mock-site`; also run the related feature verifier
  (Recorder, Smart Wait/Runner, Flow Designer, Workflow Builder, or Instance Monitor).
- Before creating feature-specific fixtures, check `mock-site/README.md` and prefer extending existing
  Feature Test Lab scenarios.
- After offline/packaging changes, run `npm run validate:offline` (the package scripts run it in
  `-Strict` mode).
- Always run `npm run build` before declaring done.

## Manual verification checklist
- For UI changes: run `npm run dev` and exercise the affected screen.
- For offline/packaging: the **clean-machine GUI walkthrough** in
  `docs/OFFLINE_STANDALONE_PACKAGING.md` and the Phase 5 checklist in
  `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 (offline Windows VM) — the production-ready gate.
  The automated dev-machine half is `npm run verify:packaged-walkthrough` (fresh-profile packaged
  run); the true clean/offline VM walkthrough remains a human step and has NOT been performed.

## Known test gaps
- No coverage for Form Designer, Runtime Inputs, Data Source Manager UI flows.
- Limited automated renderer GUI coverage exists for the Flow Designer / Workflow Builder connector
  walkthroughs; most renderer screens still require manual verification.
- Concurrency/worker isolation now has deterministic stress coverage (`verify:stress:*`,
  `verify:soak:runtime` — fake runtimes/temp stores, developer-machine scale); real multi-hour
  soak with live browsers is still not automated.
- The Concurrent Instance Monitor workflow-cards **non-DOM logic** (search filter, responsive
  visible-card-count, per-card validation, workflow-name resolution) is unit-verified by
  `npm run verify:instance-monitor` (22 checks, pure functions in `src/instances/instanceCardLogic.ts`).
  The **DOM/Electron behavior** (hover/focus cross-fade with no card-height change, equal-height cards,
  full-width search + Load More, stable 3-per-row grid across Load More, live multi-workflow concurrency, Workflow
  column with real runs) still has no automated test — verify manually via `npm run dev` (seed with
  `npm run seed:mock-fixtures`, run two cards, confirm both appear with correct workflow names). See the
  GUI checklist in `docs/OFFLINE_STANDALONE_PACKAGING.md`.

## Unknown / Needs Verification
- Whether `tests/*.spec.ts` is run in any CI (no CI config detected in the repo).
