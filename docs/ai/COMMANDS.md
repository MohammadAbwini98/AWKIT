# COMMANDS

> **Workflow (2026-07-25):** AWKIT develops on `main` only. A failing verifier does not block a
> commit — commit the reproducible state and keep fixing.
> Authority: `docs/ai/BRANCH_AND_COMMIT_POLICY.md`.

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
npm run roadmap          # node tools/roadmap/server.mjs — Program Status & Roadmap dashboard,
                         # http://127.0.0.1:4380 (ROADMAP_PORT overrides). Read-only, binds loopback
                         # only, zero dependencies. NOT part of the app: tools/ is outside
                         # tsconfig's include and electron-builder's files allowlist.
                         # See tools/roadmap/README.md.
npm run dev:roadmap      # same as roadmap
```

## Typecheck / build
```bash
npm run typecheck        # tsc --noEmit  (app + src, per tsconfig.json)
npm run build            # tsc --noEmit && electron-vite build  (primary verification gate)
npm run typecheck:scripts # tsc -p tsconfig.scripts.json — type-checks the .mts verifier/benchmark
                         # scripts (which tsconfig.json excludes). Catches deleted imports, stale
                         # APIs and incompatible types before `tsx` runtime. Bundler resolution to
                         # match how tsx resolves them; emits nothing.
npm run verify:all-typecheck # build + typecheck:scripts — the combined type gate.
```

## Offline dependency supply chain / packaging

```powershell
# Stage only the exact approved Chrome for Testing archive. The command verifies archive size/hash,
# browser version, chrome.exe hash and the complete payload tree before copying.
npm run offline:prepare -- -ArchivePath "C:\release-inputs\chrome-win64.zip"

# Use the exact matching Playwright cache entry when already provisioned. This never selects newest.
npm run offline:prepare

# Download the policy's immutable version-qualified URL, then verify it. Build-time network only.
npm run offline:prepare -- -InstallChromium

# Verify exact package pins, policy/payload hashes, detached Ed25519 signature, runtime tamper
# detection, packaging order and resources/vendor staging.
npm run verify:offline-supply-chain

# Complete strict bundle validation. Packaging wrappers run this and now fail on every nonzero step.
npm run validate:offline -- -Strict

# Compare independently built artifacts by decompressed path/size/CRC identity. The report excludes
# generated dependency-manifest signature metadata and normalizes documented volatile JSON fields.
npm run offline:compare-payloads -- --left "<artifact-a>" --right "<artifact-b>" --report "<report.json>"

npm run package:portable
npm run package:nsis
```

Release signing requires the ignored private Ed25519 key at
`.release-local/offline-manifest-private.pem`, or an explicit
`AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY`. Generate a new key only for a deliberate trust-root setup:

```powershell
node scripts/offline-manifest-signature.mjs generate-key
```

The private key must NOT live in a cloud-synced folder. `sign` and `generate-key` refuse a key that
resolves inside OneDrive/Dropbox/Google Drive/iCloud/Box; `verify` is read-only and unaffected.
Approved default: `%LOCALAPPDATA%\SpecterStudio\release-keys\offline-manifest-private.pem`
(override with `AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY`). Owner procedure — moving or rotating the key is
never automated — is in `docs/security/RELEASE_KEY_CUSTODY.md`.

```bash
npm run verify:release-key-custody # tsx scripts/verify-release-key-custody.mts — pure path/env checks
                            # over the real custody module: sync detection (whole-segment, so
                            # `onedriveclone` is not refused), key-path resolution order, the
                            # fail-closed gate and its exact-"1" override, path redaction, and source
                            # guards that both key-using commands are gated and `verify` is not.
                            # Also covers the ISSUER key (awkit-5ea): app<->packaging-script parity
                            # over one fixture table, and that LicenseIssuerService refuses a synced
                            # SPECTER_ISSUER_KEY with ISSUER_KEY_UNSAFE_LOCATION *before* reading it.
                            # Reads no key and launches nothing. (58/58)
```

Back up and protect the private key outside the repository. Packaging writes
`dist/release-provenance.json` with the source commit, exact Electron/Playwright/browser inputs,
manifest signing key id, final artifact size and final artifact SHA-256.

## Test / verify
```bash
npm run verify:workflow-sentinels # workflow Start/End persistence/runtime compatibility (4 checks)
npm run verify:runner       # tsx scripts/verify-runner.mts — live runner checks vs the mock site
npm run verify:roadmap-dashboard # node scripts/verify-roadmap-dashboard.mjs — 105 checks over the
                            # tools/roadmap dashboard: source readability, exact record counts
                            # (111 beads / 66 cases / 34 defects / 101 CSV rows / 11 phases), the
                            # FOUR-WAY ledger reconciliation (case file = its own rollup =
                            # CURRENT_STATE.md = HANDOFF.md — this is what catches doc drift),
                            # ordering invariants incl. a SYNTHETIC 2-cycle proving the cycle branch
                            # fires, byte-identical determinism, the provenance rules driven against
                            # a claims fixture, server routes (200/304/404/405), the offline rules,
                            # and the 19 global.css class names the page borrows.
                            # static-source-validation: never launches a browser or the app.
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
npm run verify:flow-node-catalog-parity # tsx scripts/verify-flow-node-catalog-parity.mts — reconciles
                            # flowNodeCatalog ↔ flowNodeRegistry in BOTH directions (plus the StepType
                            # union parsed from FlowProfile.ts), guarded by cardinality/non-empty checks
                            # so it cannot pass over an empty scan. Also pins awkit-8lz: hover renders as
                            # Hover (not Start), start is unchanged, an unknown type renders explicitly as
                            # Unknown, and the `?? flowNodeCatalog[0]` fallback stays out of the source.
                            # No browser launched. (39/39)
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
npm run verify:run-report-compatibility # tsx scripts/verify-run-report-compatibility.mts - a run
                            # admitted under a Legacy Compatibility grant says so in its execution
                            # report (awkit-vbj): the block names each admitted flow and its grant
                            # deadline, is ABSENT on ordinary runs (its presence is the signal), and
                            # source guards cover the chain admission -> run profile -> engine ->
                            # report. Pure; no browser. (21/21)
npm run verify:validation   # tsx scripts/verify-validation.mts - rule-by-rule Flow Validation Engine
                            # checks over pure validator logic; no persistence or browser. (125/125)
npm run verify:legacy-compat # tsx scripts/verify-legacy-compat.mts - Legacy Compatibility + suggested-fix
                            # migration, driving FlowValidationService against a real JSON profile store
                            # on a temp dir (atomic writes, grant persistence); no browser. (152/152)
npm run verify:packaged-validation # tsx scripts/verify-packaged-validation.mts - launches the BUILT
                            # Electron app (Playwright _electron) to walk the validation subsystem on a
                            # clean + upgrade profile. packaged-application: requires a FRESH
                            # dist/win-unpacked (build the package first) and fails a freshness guard on a
                            # stale artifact. Registered by awkit-iu7; all three above were runnable but
                            # invisible to gates before it.
npm run verify:ipc-error-message # tsx scripts/verify-ipc-error-message.mts - IPC rejections reach the
                            # UI as the handler's own sentence, not wrapped in Electron's
                            # "Error invoking remote method '<channel>': " preamble (awkit-x48).
                            # Anchored strip, generic "Error:" only (TypeError et al. preserved),
                            # fallback for empty/non-Error input, `cause` retained, plus a source
                            # guard that exactly one direct ipcRenderer.invoke remains in preload.
                            # Pure; no Electron. (22/22)
npm run verify:ipc-contract  # tsx scripts/verify-ipc-contract.mts — renderer↔main IPC contract guard (no broken/duplicate/undocumented channels)
                            # (FIFO, failure-isolation, flush drains + never rejects). No Electron. (7/7)
npm run verify:settings-persistence # node scripts/verify-settings-persistence.mjs — real-Electron: 40
                            # concurrent settings patches all persist (serialized, no lost updates), no
                            # leftover *.tmp files (atomic writes), and an update fired just before close is
                            # flushed on shutdown (before-quit). Requires build. (3/3)
npm run verify:settings-e2e # tsx scripts/verify-settings-e2e.mts — timestamped isolated real-Electron
                            # Settings campaign: all sections; pre-auth/SU/Admin/Viewer IPC boundary;
                            # direct validation/path truth; Secrets GUI + no plaintext; counts/UI reset;
                            # export/import/reset/restart; offline validation and core accessibility.
                            # Writes screenshots, export and machine-readable ledger under
                            # test-artifacts/settings-e2e/<timestamp>/. Requires build. (116/116)
# (report tool, not a gate) node scripts/measure-large-graphs.mjs — seeds 40/100/200/500-node flows and
#   prints load/zoom/drag/save/heap metrics + an in-session navigation leak check. Requires build.
npm run verify:reports      # node scripts/verify-reports-gui.mjs — real-Electron smoke of the Reports
                            # Overview page: nav→render, valid state (metrics OR empty), range selector,
                            # refresh, no telemetry/undefined console errors. Requires `npm run build`.
npm run verify:reports-populated-gui # tsx scripts/verify-reports-populated-gui.mts — isolated real-Electron
                            # populated Reports gate: real SQLite/report stores, all report pages,
                            # exact Overview/range truth, drill-down/paging/analytics, full redacted
                            # export and sender-bound RBAC/path safety; timestamped evidence. (64/64)
npm run verify:reports-live-engine # tsx scripts/verify-reports-live-engine.mts — SYS-REP-007 + SYS-REP-011.
                            # The only suite that produces LIVE ExecutionEngine state: starts real
                            # instances against the mock site, switches the app to sequential capacity
                            # via its own settings IPC, and asserts the rendered live distribution
                            # equals executions.list() and that backpressure appears AND clears.
                            # Spawns the mock site itself; needs `npm run build` first. (21/21)
npm run verify:settings-runner-behaviour # tsx scripts/verify-settings-runner-behaviour.mts — SET-009 +
                            # SET-008's run-form half. Proves Settings execution defaults reach a NEWLY
                            # OPENED run card (two distinct value sets), that a card's own saved value
                            # survives a later Settings change while an untouched card takes the new
                            # default, and that the RUNNER honours screenshot-on-failure — driven by
                            # real runs started from the card's Run button, ON/OFF/ON. Spawns the mock
                            # site; needs `npm run build` first. (11/11)
npm run verify:recorder     # tsx scripts/verify-recorder-locator.mts — live unique locators, persisted winner + bounded recovery, live text capture, Smart Wait signals/correlation, and Increment 6 open/nested/duplicate/slotted/closed/frame/cap Shadow DOM capture→persistence→preflight→LocatorFactory→StepExecutor coverage (171/171)
npm run verify:recorder-hover # tsx scripts/verify-recorder-hover.mts — records a hover-gated click, builds the
                            # flow, and REPLAYS Hover→Click on fresh pages via the real StepExecutor/LocatorFactory;
                            # asserts the actionable owner (not a wrapper or hidden revealed surface), refuses positional-only
                            # triggers, guards the old-locator regression, and covers async/needs-review negatives.
                            # Also covers adjacent-sibling triggers (`.trigger:hover + .target`, awkit-vot) — attribution
                            # + replay, plus four negatives: unnamed trigger, positional-only trigger, a timer reveal
                            # beside a hovered sibling, and the remote (non-adjacent) boundary.
                            # Also covers hover-INSERTED controls (awkit-0vm): sibling / container /
                            # multi-node / re-inserted / open-shadow positives with fresh-page replay and a
                            # profile round trip, plus negatives for timer, witness-less, unrelated-subtree,
                            # click-driven, positional-only and vanishing triggers, and the fail-closed
                            # saturation bound. Nested open-shadow insertion persists the INTERNAL trigger
                            # via the Increment 6 ordered host chain (never the host), proved by a fixture
                            # whose hosts' action points miss the trigger; an unrepresentable inner trigger
                            # degrades to needs-review with no host fallback. Remote (non-adjacent)
                            # triggers are attributed and replayed too (awkit-hmt), gated on the
                            # pointer's ARRIVAL rather than its presence, with a densely-jiggled
                            # remote-timer negative isolating that window. Installs the recorder the way
                            # production does (context.addInitScript, document start) and guards that
                            # order at source across every recorder verifier. (214/214)
npm run verify:recorder-ambiguity # tsx scripts/verify-recorder-ambiguity.mts — awkit-aui.8 nine-point acceptance gate:
                            # records duplicate/ambiguous/hover controls in real Chromium, then drives buildRecordedFlow,
                            # FlowValidator preflight (zero-launch), LocatorFactory and StepExecutor to prove capture,
                            # ancestor scoping, deterministic replay, review-required state, approved positional fallback,
                            # round-trip integrity and hover replay, with negative controls.
npm run verify:recorder-e2e # node scripts/verify-recorder-e2e.mjs — REC-018 real Electron gate:
                            # Recorder UI → bundled Chromium capture → Stop/Save → restart/Flow Library
                            # → production replay → Flow Designer save → two DOM-drift replays. Reports
                            # matched/total and fidelity % per scenario plus aggregate (>=95% aggregate,
                            # >=80% each); timestamped machine-readable evidence. (61/61, 18/18 = 100%)
npm run verify:recorder-draft # tsx scripts/verify-recorder-draft.mts — recorder action-draft persistence + reusable saved-URL history + wait-time/smart-wait compatibility logic; no browser launched
npm run verify:recorder-flow # tsx scripts/verify-recorder-flow.mts — pure buildRecordedFlow checks: default Start/End nodes, action wiring, wait/route-change replay; no browser launched
npm run verify:protected-login # tsx scripts/verify-protected-login.mts — pure protected-login detector unit checks
npm run verify:data-editor  # tsx scripts/verify-data-editor.mts — data-source table editor logic + file round-trip
npm run verify:instance-monitor  # tsx scripts/verify-instance-monitor.mts — workflow summaries/stop logic + passive CDP allowlist/17-bucket/page bisection (55 pure checks)
npm run verify:instance-monitor-gui # real Electron isolated four-instance run: summary/modal + passive live screenshot/focus + bulk stop (18 checks)
npm run verify:concurrency  # tsx scripts/verify-concurrency.mts — concurrency layer: locks (fencing/TTL/atomic), semaphore, browser pool saturation, backpressure, retry policy + dangerous-mutation guard, watchdog, JSONL logs, state artifacts, live Chromium profile lock
npm run verify:locks        # tsx scripts/verify-locks.mts — profile-lock lifecycle incl. release after failed launchPersistentContext; origin/account kind capacities; stale snapshots
npm run verify:browser-pool # tsx scripts/verify-browser-pool.mts — slot caps/saturation, release after failure/cancel, generation-guarded runtime tracking (fake runtimes)
npm run verify:watchdog     # tsx scripts/verify-watchdog.mts — stale-heartbeat/orphan detection, manual-handoff no-false-positive, dedupe, watchdog snapshot
npm run verify:artifacts    # tsx scripts/verify-artifacts.mts — JSONL/failure/state artifacts + passive second-client CDP trace, redaction, caps, retention (23 live checks)
npm run verify:runtime-status # tsx scripts/verify-runtime-status.mts — dispatch claims, lock debug snapshot, capacity counts, aggregated runtime status
npm run verify:durable-store  # tsx scripts/verify-durable-store.mts — SQLite runtime store (sql.js): migrations, run/attempt persistence across restart
npm run verify:telemetry      # tsx scripts/verify-telemetry.mts — reporting read-model: v1→v2→v3→v4 in-place migration, run-summary + process samples, retention, ReportCategories, ProcessTreeSampler
npm run verify:observability  # tsx scripts/verify-observability.mts — Runtime Observability & Historical Analytics: migration v4, admission-reason normalization, RuntimeObservationCollector, per-workflow + capacity aggregation, anomaly/regression rules, store round-trip, per-table retention
npm run verify:browser-resource-profile # tsx scripts/verify-browser-resource-profile.mts — Browser Resource
                            # Optimization resolver (pure): balanced == today invariant, capability relaxations,
                            # low-resource has background throttling OFF (+ Custom-throttling mechanism still works),
                            # mode parsing, routing mapping. (51 checks)
# ── Semantic index / Zvec native host ──────────────────────────────────────────────────────────
# Reachable from NO product surface yet. `prepare:zvec-host` MUST run before any live verifier:
# they refuse a host tree that is not byte-identical to native-hosts/zvec/zvec-host.cjs, because a
# stale tree reports a confident PASS for code that was never built.
npm run prepare:zvec-host   # stage the raw host + binding into build/native-hosts/zvec
npm run verify:semantic-policy   # projection/redaction/validator privacy pipeline (pure)
npm run verify:semantic-store    # shared contract vs both stores, ambiguous mutation no-replay policy,
                                 # rebuild snapshot projection, and the production-registration guards (179 checks)
npm run verify:semantic-queue    # coalescing, ordering, overflow, no blind replay (pure)
npm run verify:semantic-rebuild  # rebuild watermark + ordered delta replay vs in-memory stores and a
                            # generation-lifecycle stub (pure)
npm run verify:semantic-zvec-filter # typed filter builder + the SAME expressions against the REAL binding
npm run verify:semantic-zvec-native-contract # shared contract through the REAL path + exact-one NSIS matrix sentinel (22 checks; shared suite 68/68)
                            # → utilityProcess → raw host → Zvec
npm run verify:semantic-rebuild-live # the REBUILD lifecycle through the real generation runtime: real
                            # candidate build, activation, retarget, restart, rollback, host crash
                            # mid-write/mid-populate, ambiguous timeout, post-activation open failure (24 checks / 68 assertions)
npm run verify:zvec-host-source-boundary # the host stays raw CJS, utilityProcess-only, no crash hook
npm run verify:zvec-host-lifecycle       # fork/handshake/deadlines/restart policy/circuit breaker
npm run verify:zvec-generation-lifecycle # create/validate/activate/rollback + atomic pointer swap
npm run verify:zvec-generation-recovery  # startup reconciliation, retention, quarantine
npm run verify:zvec-generation-concurrency # concurrent allocation is collision-safe
npm run verify:zvec-packaged-assets      # packaged asset checksums (17/17)
npm run verify:zvec-packaged-live        # live manager against the PACKAGED host (also the NSIS tree)
npm run verify:zvec-coexistence          # Playwright workflow pass count is unchanged under Zvec load
# Point any live verifier at another layout (the NSIS matrix uses this):
#   $env:AWKIT_ZVEC_LIVE_HOST_PATH = "<...>/resources/native-hosts/zvec/zvec-host.cjs"
# Installed (NSIS) layout end-to-end — installs per-user unelevated, runs, uninstalls, verifies clean:
#   powershell -ExecutionPolicy Bypass -File scripts/zvec-harness/run-installed-live.ps1

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
npm run verify:licensing    # tsx scripts/verify-licensing.mts — licensing domain/RBAC/gate latch (167)
npm run verify:license-dispatch-gate # real ExecutionEngine queue at zero concurrency + production wiring/shell guard
# E2E QA suites (2026-07-19 assessment — specs/e2e/*, report docs/testing/; all REAL Electron, isolated
# fresh %LOCALAPPDATA% profiles, run AFTER `npm run build`):
npm run verify:e2e-auth     # full auth lifecycle: first-run, create/duplicate/double-click, enumeration,
                            # forced change, disable/reset, idle lock (30)
npm run verify:e2e-rbac     # per-role nav/route-guard/direct-IPC authorization; Viewer settings.update +
                            # real run now DENIED, footer nav filtered (awkit-b92 fixed) (49)
npm run verify:e2e-licensing# Licensing page + activation-request privacy + forged import +
                            # run gate: fresh-install block, test bypass, 14-day migration window (38)
npm run verify:e2e-sweep    # all 30 nav routes render console-clean + screenshots, theme toggle,
                            # resize, keyboard/:focus-visible (13)
npm run verify:e2e-reauth   # live ReauthDialog flow in the REAL Electron app (real-browser class): sensitive
                            # create after a lapsed reauth window → cancel drops it; wrong pw applies nothing
                            # + writes no success audit; correct pw applies it EXACTLY once, no replay (19)
npm run seed:mock-fixtures  # node scripts/seed-mock-fixtures.mjs — import test-only mock flows/workflows/data source into runtime userData (for manual GUI testing)
npm run ai:memory           # node scripts/ai-memory/check-memory.mjs — validate the AI memory files
npm run ai:memory:check     # alias of ai:memory

# Randomized Automation Test Lab Phases 1-4 (pure, no browser, no Electron).
npm run test:random -- --seed <seed> --workflow-count <count> # generation + validation + round-trip campaign
npm run test:random:smoke -- --seed <seed>                    # bounded two-workflow campaign
npm run test:random:generator                                 # generator/catalog/safety gate (49)
npm run test:random:oracle                                    # mutations vs production validators (27)
npm run test:random:roundtrip                                 # JSON + designer lossless gate (26)
npm run test:random:reproduce -- --artifact "<failure.json>"  # exact category/signature reproduction
npm run verify:random-failures                                # artifacts, reproducer, shrinker, CLI (17)
npm run verify:random-live                                    # generated flows through real ExecutionEngine/Chromium (14)
npm run verify:random-reporting                               # campaign JSON/Markdown, raw metrics, failures (13)
npm run verify:random-lifecycle                               # 176 auth × authz × license × enforcement cells (13)
npx tsx scripts/verify-packaged-validation.mts # Tranche 2 hardening gate — run AFTER `npm run package:portable`.
                                             # Drives the REAL packaged EXE on a clean profile AND an upgrade
                                             # profile (FNV-era grant, old migration record, run history):
                                             # all ten validation:* channels + their authorization matrix,
                                             # grant persistence/invalidation/expiry across restarts, the full
                                             # migration ceremony incl. undo, library states, offline posture,
                                             # clean-shutdown integrity, scan timing + renderer responsiveness (87)
npx tsx scripts/measure-inventory-scale.mts  # MEASUREMENT (non-blocking) — run AFTER `npm run package:portable`.
                                             # Seeds SCALE_FLOWS (default 1000) into a fresh profile, launches the
                                             # packaged app, and measures the first inventory scan under
                                             # concurrent run requests: scan duration, renderer round-trip,
                                             # peak RSS, grant-store behavior, single-flight safety. Timing/memory
                                             # are recorded, never thresholded; only safety properties gate (9).
npx tsx scripts/verify-legacy-compat.mts     # Stage 2c: Legacy Compatibility grants (SHA-256 digest format,
                                             # collision resistance, canonicalization determinism, legacy-record
                                             # retirement, concurrency/fail-safety), plus expiry,
                                             # standing), the full-gate blocking policy, inventory scan +
                                             # grant planning, and the suggested-fix ceremony (preview,
                                             # backup, apply, migration report, undo) against the REAL
                                             # service in temp folders (90)
npx tsx scripts/verify-validation.mts        # Flow Validation Engine (src/validation/FlowValidator.ts):
                                             # every rule with positive AND negative controls, reachability
                                             # over all 9 generated patterns, active-path classification,
                                             # deterministic ordering, legacy+modern flows, requirement-table
                                             # parity, canonical 1000 loop-cap parity, and the Stage 2b run
                                             # gate (PreRunValidator delegation, blocking policy, scoping,
                                             # runFlow precedence) (124)
# Both write deterministic reports to reports/random-tests/ (gitignored).
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
npm run validate:offline # validate-offline-bundle.ps1 (add -Strict for the release gate;
                         # Strict also requires manifest version==package.json and sourceCommit==HEAD;
                         # -PackagingInputsOnly is the pre-build Chromium presence/completeness gate)
npm run package:portable # preflight required inputs + build + manifest + strict validate + electron-builder --win portable
powershell -ExecutionPolicy Bypass -File scripts/release-portable.ps1 -BumpType patch -Force
                         # clean-main next-release wrapper: sync package+lock version, commit bounded
                         # metadata, run package:portable, then commit the signed manifest pair
npm run package:nsis     # per-user NSIS installer (alias of package:installer)
npm run package:installer# same preflight-first chain via package-per-user-installer.ps1
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

npm run verify:oracle-mock-ui            # 36 — mock-UI fixture: SQL↔mock parity, /form control + option fit,
                                         #      read-only policy, maxRows truncation. NO database needed.
npm run verify:oracle-mock-ui-workflow   # real Java mock bridge + persisted Oracle Data Source/flow/workflow
                                         # + real Chromium + production ExecutionEngine (8 rows, max concurrency 2).
                                         # Writes test-artifacts/oracle-mock-ui-workflow/<timestamp>/.
                                         # Live Oracle is BLOCKED unless the operator supplies credentials.
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

## Graphify code knowledge graph (developer/AI tool — never part of the app or its build)
```bash
graphify update .                            # THE build/refresh command — offline, no API key, 0 tokens (code + structural Markdown)
```
```bash
graphify query "How does AWKIT execute a workflow?" --budget 3000
```
```bash
graphify explain "PlaywrightFlowStudioApi"   # a symbol and its neighbours (NOT "window.playwrightFlowStudio" — query by symbol)
```
```bash
graphify path "FlowProfile" "JsonProfileStore"   # shortest connectivity path (undirected — not a call chain)
```
> Install (user-scoped, no admin): `uv tool install "graphifyy[sql]"` then `uv tool update-shell`.
> Output lives in the gitignored `graphify-out/`; `.graphifyignore` is tracked index config.
> **NOT indexed:** all `.css` (incl. `global.css`), all `mock-site/*.html`, `.json` fixtures, and
> `docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md`. Markdown is structural only. Use `Grep` for those.
> Contract, coverage accounting, exclusions, hooks and limits: `docs/ai/GRAPHIFY.md`.

## Notes
- Bash tool note: this repo runs on Windows; prefer the npm scripts above. PowerShell is the shell
  for the `*.ps1` packaging/offline scripts.
