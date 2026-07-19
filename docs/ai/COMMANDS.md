# COMMANDS

All commands verified against `package.json` scripts and repo scripts (2026-06-26).
Platform: **Windows** (packaging/offline scripts are PowerShell). Node 18 in the current dev env.

## Install
```bash
npm install
```

## Develop / run
```bash
npm run dev              # node scripts/dev.mjs → electron-vite dev (Electron + renderer with HMR).
                         # The launcher clears ELECTRON_RUN_AS_NODE first (some sandbox/agent envs
                         # set it =1, which makes Electron boot as plain Node and the app never opens).
npm run preview          # electron-vite preview
npm run mock-site        # node mock-site/server.mjs  (offline test website, port 4321 by default)
npm run dev:mock-site    # same as mock-site
```

## Typecheck / build
```bash
npm run typecheck        # tsc --noEmit
npm run build            # tsc --noEmit && electron-vite build  (primary verification gate)
```

## Test / verify
```bash
npm run verify:workflow-sentinels # workflow Start/End persistence/runtime compatibility (4 checks)
npm run verify:runner       # tsx scripts/verify-runner.mts — live runner checks vs the mock site
npm run verify:mock-site    # node scripts/verify-mock-site.mjs — starts the local Feature Test Lab
                            # mock site and checks scenario URLs, delay behavior, and stable selectors
npm run verify:flow-designer # node scripts/verify-flow-designer-gui.mjs — launches the REAL built Electron
                            # app (Playwright _electron) and drives the Flow Designer on the in-house canvas
                            # engine (no React Flow): asserts no `.react-flow__*` DOM, engine node cards +
                            # connector paths render, edges flow top→bottom (source-bottom → target-top),
                            # dotted background + zoom control, the contextual Node Palette (right-click /
                            # append + / edge-insert +), kebab loop add/remove (self-loop edge), and the
                            # Saved Flow dropdown closing on an outside canvas click.
                            # Requires `npm run build` first; clears ELECTRON_RUN_AS_NODE internally.
npm run verify:workflow-builder # node scripts/verify-workflow-builder-gui.mjs — same real-Electron GUI
                            # walkthrough for the Workflow Builder (.scenario-flow-node) canvas on the engine:
                            # engine cards/edges, kebab loop toggle, new Start→End scaffold, contextual
                            # Workflow Definition picker, default-edge + splices Start→flow→End, flow config
                            # drawer, and leaf append +.
npm run verify:canvas-perf  # node scripts/verify-canvas-perf.mjs — real-Electron canvas render-count
                            # regression guard. Seeds a 40-node flow and asserts (via the opt-in
                            # renderProbe) that zoom + typing cause 0 node/card/edge re-renders, a node
                            # drag re-renders only the dragged node (edges follow via the overlay, static
                            # EdgeLayer not per-frame), and editing one node re-renders only that node.
                            # Structural, not timing. Requires build. (13/13)
npm run verify:write-queue  # tsx scripts/verify-write-queue.mts — unit checks for the serial write queue
npm run verify:profile-store  # tsx scripts/verify-profile-store.mts — atomic write / corrupt-quarantine / id-rename durability for the JSON profile store
npm run verify:ipc-contract  # tsx scripts/verify-ipc-contract.mts — renderer↔main IPC contract guard (no broken/duplicate/undocumented channels)
                            # (FIFO, failure-isolation, flush drains + never rejects). No Electron. (7/7)
npm run verify:settings-persistence # node scripts/verify-settings-persistence.mjs — real-Electron: 40
                            # concurrent settings patches all persist (serialized, no lost updates), no
                            # leftover *.tmp files (atomic writes), and an update fired just before close is
                            # flushed on shutdown (before-quit). Requires build. (3/3)
# (report tool, not a gate) node scripts/measure-large-graphs.mjs — seeds 40/100/200/500-node flows and
#   prints load/zoom/drag/save/heap metrics + an in-session navigation leak check. Requires build.
npm run verify:reports      # node scripts/verify-reports-gui.mjs — real-Electron smoke of the Reports
                            # Overview page: nav→render, valid state (metrics OR empty), range selector,
                            # refresh, no telemetry/undefined console errors. Requires `npm run build`.
npm run verify:recorder     # tsx scripts/verify-recorder-locator.mts — live checks unique locators, runner locator safeguards, live text capture, and Smart Wait recorder observation signals/correlation
npm run verify:recorder-draft # tsx scripts/verify-recorder-draft.mts — recorder action-draft persistence + reusable saved-URL history + wait-time/smart-wait compatibility logic; no browser launched
npm run verify:recorder-flow # tsx scripts/verify-recorder-flow.mts — pure buildRecordedFlow checks: default Start/End nodes, action wiring, wait/route-change replay; no browser launched
npm run verify:protected-login # tsx scripts/verify-protected-login.mts — pure protected-login detector unit checks
npm run verify:data-editor  # tsx scripts/verify-data-editor.mts — data-source table editor logic + file round-trip
npm run verify:instance-monitor  # tsx scripts/verify-instance-monitor.mts — workflow-card logic + execution-group summaries + stop eligibility (35 pure checks)
npm run verify:instance-monitor-gui # real Electron isolated four-instance run: summary record/modal/focus + pending/running bulk stop (12 checks)
npm run verify:concurrency  # tsx scripts/verify-concurrency.mts — concurrency layer: locks (fencing/TTL/atomic), semaphore, browser pool saturation, backpressure, retry policy + dangerous-mutation guard, watchdog, JSONL logs, state artifacts, live Chromium profile lock
npm run verify:locks        # tsx scripts/verify-locks.mts — profile-lock lifecycle incl. release after failed launchPersistentContext; origin/account kind capacities; stale snapshots
npm run verify:browser-pool # tsx scripts/verify-browser-pool.mts — slot caps/saturation, release after failure/cancel, generation-guarded runtime tracking (fake runtimes)
npm run verify:watchdog     # tsx scripts/verify-watchdog.mts — stale-heartbeat/orphan detection, manual-handoff no-false-positive, dedupe, watchdog snapshot
npm run verify:artifacts    # tsx scripts/verify-artifacts.mts — JSONL logs, failure trace zips + default screenshots (live Chromium), run-state files
npm run verify:runtime-status # tsx scripts/verify-runtime-status.mts — dispatch claims, lock debug snapshot, capacity counts, aggregated runtime status
npm run verify:durable-store  # tsx scripts/verify-durable-store.mts — SQLite runtime store (sql.js): migrations, run/attempt persistence across restart
npm run verify:telemetry      # tsx scripts/verify-telemetry.mts — reporting read-model: v1→v2→v3→v4 in-place migration, run-summary + process samples, retention, ReportCategories, ProcessTreeSampler
npm run verify:observability  # tsx scripts/verify-observability.mts — Runtime Observability & Historical Analytics: migration v4, admission-reason normalization, RuntimeObservationCollector, per-workflow + capacity aggregation, anomaly/regression rules, store round-trip, per-table retention
npm run verify:browser-resource-profile # tsx scripts/verify-browser-resource-profile.mts — Browser Resource
                            # Optimization resolver (pure): balanced == today invariant, capability relaxations,
                            # low-resource has background throttling OFF (+ Custom-throttling mechanism still works),
                            # mode parsing, routing mapping. (51 checks)
# Browser Resource Optimization benchmarks (headed Windows; write reports/browser-performance/*.json):
npm run benchmark:browser-resource # simple Balanced-vs-Low-Resource per-instance run (blank/nav/idle/form)
npm run benchmark:workloads   # Balanced vs Low-Resource across 8 representative workloads (RAM/CPU/net/duration, N reps)
npm run benchmark:ablation    # per-optimization RAM/network attribution on the image-heavy workload (N reps)
npm run benchmark:occlusion   # minimized/occluded headed window: the 3 background-throttle switches individually + combined
                            # (+ behavioural correctness: timer rate, rAF, waitForResponse, popup, click). Shared lib: scripts/benchmark/lib.mts
npm run verify:durable-locks  # tsx scripts/verify-durable-locks.mts — cross-process durable locks (real spawned second process), stale quarantine, fencing
npm run verify:cancellation   # tsx scripts/verify-cancellation.mts — hard cancellation with live Chromium (browser closed, profile lock freed, no retry)
npm run verify:safety-policy  # tsx scripts/verify-safety-policy.mts — FlowStep.safety metadata precedence over keyword heuristic in RetryPolicy
npm run verify:dynamic-origin-claims # tsx scripts/verify-dynamic-origin-claims.mts — mid-flow origin re-claiming, saturation timeout, live origin change
npm run verify:resource-sampling # tsx scripts/verify-resource-sampling.mts — CPU/memory sampler + backpressure pressure blocking
npm run verify:startup-recovery # tsx scripts/verify-startup-recovery.mts — interrupted-run recovery policy after app restart
npm run verify:packaged-runtime # tsx scripts/verify-packaged-runtime.mts — Phase 4 packaged smoke: run AFTER
                            # `npm run package:portable`; checks dist/win-unpacked (app.asar ships the sql.js
                            # WASM, manifest flags, launches the REAL packaged EXE via Playwright _electron,
                            # asserts appMode=packaged + durable store enabled + %LOCALAPPDATA% paths, reads
                            # the produced runtime.sqlite externally, probes artifactsRoot writability)
npm run verify:packaged-walkthrough # tsx scripts/verify-packaged-walkthrough.mts — Phase 5 packaged clean-profile
                            # walkthrough: run AFTER `npm run package:portable`. Launches the REAL packaged EXE
                            # with LOCALAPPDATA pointed at a FRESH empty dir (clean first-run simulation), imports
                            # mock fixtures via the app's own IPC, runs a full workflow to completion (artifacts:
                            # JSONL log/screenshots/report/state), hard-cancels a long run (ends `cancelled`,
                            # Chromium tree gone), proves the 2-browser bound under 4 concurrent instances,
                            # starts/cancels the recorder, hard-kills the app mid-run and verifies startup
                            # recovery + the Recoverable Runs panel + markReviewed, reads runtime.sqlite
                            # externally, boots the ACTUAL portable EXE on a second fresh profile, checks the
                            # NSIS sha512 vs latest.yml, and samples the app's TCP connections the whole time
                            # (must be loopback-only). Evidence: dist/phase5-evidence/. This is the dev-machine
                            # half of Phase 5 — the clean/offline VM checklist in
                            # docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md remains the human gate.
npm run verify:chromium-hardening # tsx scripts/verify-chromium-hardening.mts — Phase 5.1C no-egress:
                            # (A) arg construction + env contract (AWKIT_CHROMIUM_OFFLINE_HARDENING /
                            # AWKIT_CHROMIUM_EXTRA_ARGS, --disable-features Playwright-superset rule);
                            # (B) launches the BUNDLED Chromium with the hardened args and asserts ZERO
                            # non-loopback TCP connections during a 20s idle window; (C) navigation to
                            # external sites (incl. google.com, whose SERVICE hosts are loopback-mapped)
                            # still works (part C auto-skips when the machine is offline).
npm run verify:soak:runtime       # tsx scripts/verify-soak-runtime.mts — SQLite store soak: many write cycles +
                            # close/reopen, DB stays valid/readable, migrations once, bounded heap growth
npm run verify:stress:concurrency # tsx scripts/verify-stress-concurrency.mts — 25 queued instances never exceed
                            # the browser cap; backpressure activates with a reason and clears (fake runtimes)
npm run verify:stress:cancellation # tsx scripts/verify-stress-cancellation.mts — mass cancellation releases all
                            # slots, cancel handlers run once, cancelled class never retried
npm run verify:stress:locks       # tsx scripts/verify-stress-locks.mts — profile-lock churn never double-grants;
                            # durable lock-file churn stays consistent; over-subscribed origin transitions
                            # finish via bounded wait (no permanent deadlock)
npm run verify:stress:artifacts   # tsx scripts/verify-stress-artifacts.mts — 25 concurrent JSONL loggers + state
                            # artifacts: complete, valid, never mixed between runs, secrets masked
                            # Stress tunables: AWKIT_STRESS_INSTANCES=25 AWKIT_STRESS_MAX_BROWSERS=2
                            # AWKIT_STRESS_TIMEOUT_MS=120000
# Security / RBAC / licensing verifiers (added 2026-07-18/19):
npm run verify:security     # tsx scripts/verify-security.mts — sender guard, IPC hardening (39)
npm run verify:auth         # tsx scripts/verify-auth.mts — auth domain: policy, sessions, rotation (49)
npm run verify:auth-gui     # node scripts/verify-auth-gui.mjs — REAL Electron sign-in walkthrough incl.
                            # AccountMenu sign-out, dark login, proactive idle lock (18; needs build)
npm run verify:authz        # tsx scripts/verify-authz.mts — RBAC deny-by-default, reauth, escalation guards (40)
npm run verify:session-context # tsx scripts/verify-session-context.mts — main-owned sender→session registry +
                            # assertSenderPermission fail-closed gating of non-admin IPC (11)
npm run verify:admin-gui    # node scripts/verify-admin-gui.mjs — REAL Electron Super User admin area incl.
                            # real Licensing page (11; needs build)
npm run verify:avatar       # tsx scripts/verify-avatar-initials.mts — initials + palette (24)
npm run verify:licensing    # tsx scripts/verify-licensing.mts — licensing domain + IPC RBAC (56)
# E2E QA suites (2026-07-19 assessment — specs/e2e/*, report docs/testing/; all REAL Electron, isolated
# fresh %LOCALAPPDATA% profiles, run AFTER `npm run build`):
npm run verify:e2e-auth     # full auth lifecycle: first-run, create/duplicate/double-click, enumeration,
                            # forced change, disable/reset, idle lock (30)
npm run verify:e2e-rbac     # per-role nav/route-guard/direct-IPC authorization; Viewer settings.update,
                            # real run + Oracle data-source mutators DENIED, footer filtered (b92+b3w) (51)
npm run verify:e2e-licensing# Licensing page + activation-request privacy + forged import +
                            # SPECTER_LICENSE_ENFORCE run-gate ON/OFF (22; seeds its own fixtures)
npm run verify:e2e-sweep    # all 30 nav routes render console-clean + screenshots, theme toggle,
                            # resize, keyboard/:focus-visible (13)
npm run verify:e2e-reauth   # live ReauthDialog GUI (dedicated launch, short AWKIT_REAUTH_WINDOW_MS): a
                            # sensitive admin op → dialog; wrong pw keeps it; correct pw applies (awkit-2d8) (9)
npm run seed:mock-fixtures  # node scripts/seed-mock-fixtures.mjs — import test-only mock flows/workflows/data source into runtime userData (for manual GUI testing)
npm run ai:memory           # node scripts/ai-memory/check-memory.mjs — validate the AI memory files
npm run ai:memory:check     # alias of ai:memory
```
- There is **no** `lint` script and **no** `test` npm script.
- `@playwright/test` is installed and `tests/runner.mocksite.spec.ts` exists, but the Playwright
  test runner cannot load the TS/ESM config on Node 18.16 (needs Node ≥18.19). Use `verify:runner`.

## Capacity benchmarks (dev-only; real ExecutionEngine, offline mock-site)
```bash
npm run benchmark:engine         # A/B/C/D machine-relative ramp, MIXED workload → reports/browser-performance/engine-abcd.json
npm run benchmark:engine-weights # Phase 6 A8 workload-weight calibration → reports/browser-performance/weight-calibration.json
npm run benchmark:engine-soak    # Phase 9 Config-D soak (30 min; AWKIT_SOAK_MS=600000 for 10 min) → reports/browser-performance/soak.json
```
These drive real workflow instances through `ExecutionEngine.startRun` under an `electron` stub (via
`scripts/benchmark/run.mjs`, which sets the origin-cap / trace-off / bench-tsconfig env). Not part of the
standard verify workflow. Full write-up + results: `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md`.

## Offline preparation & packaging (PowerShell)
```bash
npm run prepare:offline  # prepare-offline-deps.ps1 -InstallChromium (installs+copies Chromium, regenerates manifest)
npm run offline:prepare  # prepare-offline-deps.ps1 (copy cached Chromium, no install)
npm run offline:manifest # generate-dependency-manifest.ps1
npm run validate:offline # validate-offline-bundle.ps1 (add -Strict via the package scripts)
npm run package:portable # build + manifest + strict validate + electron-builder --win portable
npm run package:nsis     # per-user NSIS installer (alias of package:installer)
npm run package:installer# package-per-user-installer.ps1
npm run package:offline  # package:portable && package:installer
```
Output: `dist/WebFlow Studio <version>.exe` (portable), `dist/WebFlow Studio Setup <version>.exe` (installer).
> First packaging needs internet (electron-builder downloads NSIS/codesign helper binaries) or a warm
> electron-builder cache; the produced app itself needs no internet.

## Oracle JDBC (offline; no database required unless noted)
> **Model:** Specter does **not** bundle Java or UCP. The user selects a Java runtime + imports an ojdbc
> driver in Settings → Database Drivers; Oracle runs via **direct JDBC** (one connection per query, no pool).
```bash
npm run build:oracle-bridge          # compile the Java bridge with a PINNED JDK 17 (never JAVA_HOME/PATH).
                                     # Pure JDK — no UCP; the direct-JDBC executor is the sole real executor.
npm run prepare:oracle-runtime       # build + stage ONLY Specter's bridge jar under resources/oracle-jdbc/,
                                     # write manifest.json + checksums.json. No JRE, no driver jars (both are
                                     # user-selected). Offline, deterministic, FAIL-CLOSED (missing jar / bad arch).

# Verifiers (all green offline; 350 checks across the 13 non-GUI suites):
npm run verify:oracle-bridge             # 32 — framing/protocol, handshake, cancellation, restart, redaction
npm run verify:oracle-bridge-real-build  # 16 — real-executor contract + STUB-COMPILE vs real JDK java.sql
npm run verify:oracle-profiles           # 22 — profile CRUD, DPAPI secret routing, connection testing
npm run verify:oracle-data-source        # 28 — snapshot staleness, resolver normalization, binds, loops
npm run verify:oracle-runtime            # 36 — binds/types, result limits, timeout, telemetry, fail-closed
npm run verify:oracle-java-runtime       # 48 — Java runtime store: add/validate/set-default/bridge-test/remove
npm run verify:oracle-driver-bundle      # 47 — managed ojdbc bundle import/validate/load-test (UCP rejected)
npm run verify:oracle-runtime-prep       # 14 — prepare:oracle-runtime logic (bridge-only, synthetic fixtures)
npm run verify:oracle-sql-policy         # 30 — TS↔Java read-only SQL parity over an adversarial corpus
npm run verify:oracle-packaging          # 23 — checksums + selection-model runtime resolution + fail-closed
npm run verify:oracle-lazy-resolution    # 20 — lazy runtime execution, single-flight, snapshot = 0 DB
npm run verify:oracle-offline-bundle     # 11 — packaged bundle audit (bridge-only; rejects JRE/driver/secrets)
npm run verify:oracle-direct-jdbc        # 23 — direct-JDBC concurrency/cancellation/teardown (mock bridge)

npm run verify:oracle-drivers-gui        # 30 — REAL Electron: Database Drivers settings render + real bridge
                                         #      launch + real ojdbc load + deletion guard (needs `npm run build`)
npm run verify:oracle-live               # 7 — REAL Oracle — credential-gated; skips cleanly with no config and
                                         # NEVER falls back to mock. Resolves BOTH the Java runtime + driver via
                                         # the Settings-managed stores. Requires an authorized non-prod reader:
                                         #   AWKIT_ORACLE_LIVE_URL / _USER / _PASSWORD
                                         #   AWKIT_ORACLE_LIVE_CONFIRM_NONPROD=1
                                         #   AWKIT_ORACLE_LIVE_TEST_TABLE (default awkit_types_test)
                                         #   AWKIT_ORACLE_LIVE_DRIVER_BUNDLE_ID / _JAVA_RUNTIME_PROFILE_ID
                                         # Writes redacted reports/oracle-validation/oracle-live.json.
npm run benchmark:oracle-jdbc            # direct-JDBC soak (≥30 min): latency P50/P95, cancellation latency,
                                         # bridge+Node RSS, teardown invariants, NO pool metrics. Same live env
                                         # as verify:oracle-live (falls back to the mock bridge if unset).
                                         # Tunables: AWKIT_ORACLE_SOAK_MINUTES / _CONCURRENCY / _DRIVERS.
                                         # Writes redacted reports/oracle-validation/oracle-soak.json.
```
> Fail-closed rule: a **packaged** build never uses the mock executor. Packaged launches force
> `AWKIT_ORACLE_REQUIRE_REAL=1`; `AWKIT_ORACLE_BRIDGE_MOCK=1` is honored **only** in dev/unpackaged.
> Packaged + no Java/driver configured ⇒ Oracle live queries unavailable with a "Settings → Database Drivers"
> message (Snapshot Data Sources + non-Oracle workflows still work, no Java needed).
> See `ORACLE_JDBC_VALIDATION_GATES.md` for the gate status and the external-gate procedures.

## Assets
```bash
npm run icon:generate    # node scripts/generate-app-icon.mjs (build resources/icon.ico from icon-source.png)
```

## Database migrations
`Unknown - verify before use` — the project uses JSON file storage, not a database; no migration command exists.

## Notes
- Bash tool note: this repo runs on Windows; prefer the npm scripts above. PowerShell is the shell
  for the `*.ps1` packaging/offline scripts.
