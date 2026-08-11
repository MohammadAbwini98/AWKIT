# TESTING

> **Workflow (2026-07-25):** A failing or unexecuted verifier never freezes implementation and never
> blocks a commit — but it must be reported truthfully and never described as passed. Release gates
> govern release claims only. Authority: `docs/ai/BRANCH_AND_COMMIT_POLICY.md`.

## Confirmed

Complete Loop connector coverage (2026-08-11, `awkit-pwc`): `verify:flow-designer` **93/93** and
`verify:workflow-builder` **41/41** drive the real Electron editors through loop creation, complete
while-condition editing, Standard→Conditional exit promotion, save, and persisted profile reads.
`verify:runner` **99/99** includes workflow count/while execution and bounded Loop Back;
`verify:validation` **134/134** requires while conditions; `verify:branch-pairs` **36/36** exercises the
shared promotion policy; `verify:workflow-sentinels` **14/14** proves loop metadata conversion parity.
No new mock page was needed: authoring is editor-local and runtime uses existing local login/form routes.

Workflow.rar contextual-editor coverage extends the real-Electron designer verifiers with checks for
absent permanent rails, `Start -> End` workflow scaffolding, blank/edge/leaf picker entry points, actual
insertion, and selection drawers. `npm run verify:workflow-sentinels` adds 4 checks proving sentinels
remain structural and legacy workflows remain compatible.

### Frameworks present
- `@playwright/test` (devDependency) — config `playwright.config.ts` (`testDir: "tests"`).
- `tsx` (devDependency) — used to run the standalone runner verification script on Node 18.

### What exists
- `tests/runner.mocksite.spec.ts` — Playwright test exercising the runner against the mock site.
- `scripts/verify-runner.mts` — standalone live verification (run via `npm run verify:runner`)
  that drives `StepExecutor` / `FlowExecutor` / `PlaywrightRunner` against `mock-site/` with a real
  Chromium. As of the last run: **99 checks pass** (node types, flow/workflow loops, runFlow + recursion guard,
  Protected Login Handoff pause/resume, manual handoff in-place resume, workflow runtime connector-structure validation,
  **Route Change** [opens a new tab, switches the active page, fills/clicks/asserts on it], **Reuse Session
  browser lifecycle** [two-phase swap, stale old-generation lifecycle ignored, locked profile fail-before-
  navigate, duplicate swap mutex], **workflow protected-login session capture** [auto-detected and explicit
  handoff close Playwright, launch normal-browser capture, load captured profile, and ignore the triggering
  navigation timeout while waiting for the normal browser], **Save Session**
  [writes storageState; fails on missing name / no-overwrite collision], flow-level and workflow-level
  connector routing). **89 checks as of 2026-07-26** — the flow-level connector section gained 5
  manual-approval regressions with the `AWKIT-E2E-001` fix (approved routing to End with an exact node
  sequence, approved downstream work, cancelled handoff, an ordinary node as a negative control, and
  no `passed` when an unapproved continuation was skipped).
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
- `scripts/verify-recorder-locator.mts` (`npm run verify:recorder`) — **217 checks** in live Chromium
  for recorder locator generation, runner locator safeguards/fallbacks, persisted winner ordering,
  bounded all-candidates-miss recovery, and Smart Wait recorder observation
  (safe fetch/XHR path-only signals, loader disappearance, URL changes, table/list/card waits, toast,
  enabled controls, polling ignored, fixed-delay fallback). Recovery coverage includes no-history,
  equal-twin, valid-recorded-candidate, class/business-text exclusion, durable-source, and
  loud-warning sentinels.
- `scripts/verify-blueprint-recovery-browser.mts` (`npm run verify:blueprint-recovery-browser`) — **24
  checks** in real Chromium for the browser-only half of Locator Blueprint recovery. It records a click
  through the exact injected Recorder script, assembles the captured blueprint with `buildRecordedFlow`,
  then drives `LocatorFactory` against `/blueprint-recovery-lab`: every saved locator misses after one
  inserted sibling beyond the broad 200-element scan, the captured fingerprint scores 0.866667 and
  recovers the intended target, while a below-0.86 identity change is refused with no side effect. An
  explicit `externalCommit` control proves sensitive steps never enter local/blueprint recovery, read
  blueprint storage, emit recovery success, or click the drifted target.
- `scripts/verify-locator-guard.mts` (`npm run verify:locator-guard`) — **35 checks** in real Chromium
  for normal and sensitive guarded positional identity, fingerprint parity, and preconditions. Its Recorder coverage also proves a dangerous
  captured action receives no `blueprintId` and persists no page blueprint.
- `scripts/verify-recorder-ambiguity.mts` (`npm run verify:recorder-ambiguity`) — **74 checks** through
  trusted browser capture → action owner → identity contract → `buildRecordedFlow` → JSON/IPC round
  trip → `LocatorFactory`/`StepExecutor`. Its twin fixture proves unchanged replay and refuses a
  logical reorder with `TARGET_IDENTITY_CHANGED`; disabling normal guard enforcement yields 4 failures.
- `scripts/verify-recorder-e2e.mjs` (`npm run verify:recorder-e2e`) — REC-018 real-Electron gate on
  an isolated profile using bundled Chromium: Recorder UI capture/Stop/Save, full restart and visible
  Flow Library reopen, production `ExecutionEngine` replay, exact node/log/report order, resettable
  target-state oracle, Flow Designer no-op save, and two replay-only DOM-drift profiles. The
  awkit-60w gate scores real report+log agreement as matched business steps / recorded business
  steps, prints a per-scenario table and aggregate, and enforces **>=95% aggregate / >=80% each**.
  First measured baseline: **18/18 = 100%**, **61/61 checks** on 2026-07-28. Removing one control's
  last stable accessible name produced **2/6** for that scenario and **14/18 = 77.78%** aggregate,
  proving the metric turns red. Evidence under `test-artifacts/recorder-e2e/<timestamp>/`.
- `scripts/verify-reports-populated-gui.mts` (`npm run verify:reports-populated-gui`) — deterministic
  populated real-Electron Reports gate. Seeds the real SQLite/report stores with current/previous
  run history, attempts, artifacts, runtime/observability rows, one valid report and one corrupt
  sibling; drives every Reports surface; validates exact Overview truth, range races, populated
  workflows/detail/paging/analytics, full redacted export, and pre-auth/Viewer/no-role/path
  authorization. **64/64** as of 2026-07-26; timestamped evidence under
  `test-artifacts/reports-populated-gui/<timestamp>/`. This assertion count is not a 16/16 case
  claim; the focused case document keeps exact residual submatrices `NOT RUN`.
- `scripts/verify-settings-e2e.mts` (`npm run verify:settings-e2e`) — deterministic real-Electron
  Settings gate on a timestamped isolated profile. Seeds representative flows/workflow/data
  source/report and synthetic secrets; drives all Settings sections, pre-auth/Super
  User/Administrator/Viewer IPC authorization, direct validation, paths, execution defaults,
  Secrets GUI/no-plaintext evidence, counts, Clear UI State, export/import recovery, reset/restart,
  offline validation and core dialog/error/narrow/reduced-motion accessibility. **116/116** as of
  2026-07-26; timestamped screenshots/export/result ledger under
  `test-artifacts/settings-e2e/<timestamp>/`. This is not a 21/21 case claim; exact residual
  submatrices remain `NOT RUN` in the focused case document.
- `scripts/verify-recorder-draft.mts` (`npm run verify:recorder-draft`) — browser-free recorder draft,
  URL-history, legacy wait-time, and smart-wait compatibility checks. As of the last run: **17 checks pass**.
- `scripts/verify-waits.mts` (`npm run verify:waits`) — Smart Wait runner checks for before/after waits,
  armed response waits, loader/element/table/list/URL/DOM/fixed-delay waits, and failure diagnostics
  (phase, sanitized URL, reason, suggestion), including stale recorder-generated navigation response waits
  being skipped only after a successful `goto`. As of the last run: **21 checks pass**.
- `scripts/verify-flow-designer-gui.mjs` (`npm run verify:flow-designer`) — real Electron GUI walkthrough
  for Flow Designer connector behavior, complete Loop authoring/persistence, and saved-flow dropdown
  behavior. As of the last run: **93 checks pass**.
- **E2E QA suites (2026-07-19 assessment, bd `awkit-xyo`)** — four real-Electron suites on isolated fresh
  profiles, driven by the specs in `specs/e2e/` and the shared drivers in `scripts/lib/e2e-qa-lib.mjs`
  (login/sign-out/nav/create-user/forced-change/direct-IPC on top of `gui-verify-harness.mjs`):
  `verify:e2e-auth` (**30** — full auth lifecycle incl. enumeration + idle lock), `verify:e2e-rbac`
  (**51** — per-role nav/route-guard/direct-preload-IPC; a Viewer's `settings.update`/`execution:runWorkflow`
  are now DENIED and the footer nav is permission-filtered after the bd `awkit-b92` fix), `verify:e2e-licensing`
  (**38** — activation-request privacy, forged-signature rejection, default-ON run gate blocking a fresh
  install, the non-packaged test bypass admitting the identical run, and the one-time 14-day migration window),
  `verify:e2e-sweep` (**13** — 30 routes console-clean + screenshots, theme, resize, `:focus-visible`; the
  seeded-samples check now asserts empty states after the bd `awkit-64x` fix). Coverage matrix +
  reports: `docs/testing/E2E_{COVERAGE_MATRIX,EXECUTION_REPORT,DEFECTS}.md`; evidence:
  `test-artifacts/2026-07-19-e2e-qa/`.
- **`verify:e2e-reauth` (2026-07-24, bd `awkit-2d8`)** — a dedicated real-Electron launch (own isolated
  profile, short `AWKIT_REAUTH_WINDOW_MS`) driving the **live ReauthDialog**: a sensitive Super-User create
  after the window lapses pops the dialog and holds the action; **cancel** drops the held create; a **wrong
  password** keeps the dialog open with an error, applies nothing, and writes **no** `USER_CREATE` success
  audit; the **correct password** applies the held create **exactly once** (no duplicate/replay). Exactly-once /
  no-replay / no-wrong-password-success are proven by baseline-delta `USER_CREATE(success)` audit counts +
  the admin user list (not UI text), and it asserts no password reaches console or audit. Class **real-browser**
  (**19/19**). Kept separate from `verify:e2e-rbac` so a globally-short window never destabilises seeding.
- `scripts/verify-session-context.mts` (`npm run verify:session-context`) — domain-level checks for the
  main-owned sender→session registry backing bd `awkit-b92`: bind/unbind lifecycle, window-destroyed
  auto-unbind, and `assertSenderPermission` failing closed (`NOT_AUTHORIZED`) for unbound windows. **11/11**.
- Phase 2 focused verifiers (all deterministic, no external websites): `verify:locks` (**15** —
  concurrent profile acquisition, release after success/throw/failed `launchPersistentContext`,
  kind-prefix origin/account capacities, active+stale snapshots), `verify:browser-pool` (**13** —
  fake runtimes: saturation, release after failure/cancel, generation-guarded page/crash tracking,
  backpressure), `verify:watchdog` (**13** — stale/orphan detection, manual-handoff
  no-false-positive, dedupe, snapshot), `verify:artifacts` (**23** — live Chromium: failure trace
  zip saved / success discarded, default failure screenshot, trace errors never mask the step
  error, state files, and passive second-client CDP trace shape/redaction/size/sample retention),
  `verify:runtime-status` (**15** — dispatch claims, lock debug snapshot,
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
  **2026-07-26: now 70 checks** — Part A gained a staleness precondition. The verifier previously
  drove whatever sat in `dist/win-unpacked` with no freshness check, so a green packaged result was
  only as trustworthy as whoever remembered to repackage first. It now **exits 1** when the newest
  file under `src/` or `app/` is newer than the packaged payload, naming the file and both
  timestamps. Negative-controlled (a touched source file reproduced the refusal). Always run
  `npm run package:portable` before citing any packaged result.
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
npm run verify:failure-evidence # FR-B2: per-attempt failure evidence ordering/accumulation (unit)
npm run verify:failure-evidence-live # FR-B2: real evidence files written/named/confined/masked (live Chromium)
npm run verify:popup           # popup STEP behavior: click/switchToPopup/closePopup/back-compat
npm run verify:popup-identity  # FR-C1 identity INVARIANTS: reversed order, script/timer popup,
                               # ambiguity, close/reopen, legacy popup-N (live Chromium)
npm run verify:popup-mock-site # popup Feature Test Lab scenarios load with stable selectors
npm run verify:flow-step-mapping # designer round trip: no field silently dropped on re-save
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
- `verify:semantic-store` also owns the **production-registration guards**. They are source scans, and
  the first version of one passed against the very defect it existed for: counting
  `setSemanticIndexRuntime(` call sites was satisfied by the degrade path's
  `setSemanticIndexRuntime(null)`. It now asserts the *constructed* runtime is the one registered, and
  that `initializeSemanticSubsystem` reaches the registrar. If you move that wiring, fix the guard —
  do not relax it.
- After changing the semantic subsystem or the Zvec host, run `npm run prepare:zvec-host` FIRST, then
  `verify:semantic-zvec-native-contract` and `verify:semantic-rebuild-live`. Both refuse a host tree
  that is not byte-identical to `native-hosts/zvec/zvec-host.cjs` — a stale tree reports a confident
  PASS for code that was never built. Rebuild the portable/NSIS packages before claiming those layouts.
  The installed-layout matrix must run the native contract, manager lifecycle, and rebuild suites;
  the native-contract verifier guards its own matrix entry exactly once. Current semantic store is
  **153/153** and real rebuild lifecycle is **24/24** with 68 internal assertions, including the
  ambiguous-timeout and host-exit no-replay cases.
- Always run `npm run build` before declaring done.

### An unexecuted verifier is not evidence

Do not cite a verifier's checks in a summary, commit message, or doc until you have run it. This is
not a style rule; it has produced real defects in this repository:

- a negative control whose flag was declared inside a factory the code calls twice, so it reset and
  the control passed while exercising nothing;
- a suite-size floor set above the suite's real size, which failed a run that had completed;
- fault injection matching request types the caller never sends (`insert`/`stats` instead of
  `upsert`/`count`), so two "failure" scenarios silently exercised a SUCCESSFUL path;
- a check reading `r.hits` after the reply shape changed to `{ docs, totalMatched }` — `hits === 0`
  is false when `hits` is `undefined`, so it passed vacuously for an entire protocol version.

Two rules follow. **When a reply or response shape changes, grep every reader of the removed field**;
such a check fails OPEN. And **confirm each negative control actually fails when the behaviour it
guards is removed** — that is the only thing separating a control from decoration.

## Manual verification checklist
- For UI changes: run `npm run dev` and exercise the affected screen.
- For offline/packaging: the **clean-machine GUI walkthrough** in
  `docs/OFFLINE_STANDALONE_PACKAGING.md` and the Phase 5 checklist in
  `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 (offline Windows VM). As of the **2026-07-24 owner
  policy** this walkthrough is **optional and non-blocking** for release promotion (see the
  authoritative banner atop `CLEAN_MACHINE_VALIDATION_RUNBOOK.md`); its execution status stays truthful
  (currently **NOT EXECUTED**) and a **FAIL, if ever executed, remains blocking**. The automated
  dev-machine half is `npm run verify:packaged-walkthrough` (fresh-profile packaged run); the true
  clean/offline VM walkthrough remains a human step and has NOT been performed. This policy does not
  waive the checksum, offline-bundle, packaged-startup, artifact-integrity, dependency-manifest, or
  security gates.

### Visual QA — Hologram UI (Phase 14)

Golden baseline screenshots for the finalized Hologram re-skin are captured with the existing
manual evidence helper (not CI). Build first, then capture both themes:

```bash
npm run build
node scripts/helpers/reset-ui-state.mjs dashboard false   # neutral route/expanded sidebar
node scripts/capture-ui-screenshots.mjs golden            # light golden set (8 core pages)
# Dark set: set UiSettings.appearance="dark" in
# %LOCALAPPDATA%/WebFlow Studio/storage/ui-settings.json, re-run capture into `golden-dark`,
# then restore appearance to "light".
```

Output: `docs/ai/ui-reskin-template-plan/mockups/screenshots/{golden,golden-dark}/`
(Dashboard, Flow Designer, Workflow Builder, Workflow Designer, Recorder, Instances, Reports,
Settings — 8 shots each). Last run: 8 light + 8 dark, both legible/premium.

**No automated `toHaveScreenshot` visual-regression tests are wired** — deliberate: there is no
`npm test` script, `@playwright/test` has the Node-version caveat above, and several core screens
carry dynamic data (timestamps, live runtime status, instance ids) that would make pixel
assertions flaky. The golden PNGs are the human-review baseline; regressions are caught by
re-capturing and eyeballing the diff. If visual assertions are added later, mask/mock dynamic data
and run with reduced motion first (animations must be neutralized before capture).

**Manual QA checklist (run per major route — Dashboard, Flow/Form Designer, Workflow Builder,
Recorder, Instances, all Reports tabs, Data Sources, Sessions, Settings):**
- [ ] Toggle Light/Dark mode (sidebar toggle) on every major route — no layout shift, only colors change; text stays legible.
- [ ] Tab through the page — every button/input/link shows a visible `:focus-visible` ring in both themes.
- [ ] React Flow: drag a node, connect an edge, and open a self-loop — canvas coordinates stay correct (no jump).
- [ ] Open the right inspector and edit a node property — the canvas node updates and the unsaved-changes chip appears.
- [ ] Resize the window — AppShell sidebar/header/status grid and dashboard KPI grid reflow without overlap or clipping.
- [ ] Open a modal (Confirm/Unsaved-changes/Live Execution Report) — blurred backdrop, centered dialog, focus trapped, Esc closes.
- [ ] Empty states (fresh profile) render intentionally on Reports/Instances/Flows/Workflows — no fake/seed data shown as real.
- [ ] Enable OS "reduce motion" — hover lifts and entrance animations snap to final state with no motion.

## Known test gaps
- No coverage for Form Designer, Runtime Inputs, Data Source Manager UI flows.
- Limited automated renderer GUI coverage exists for the Flow Designer / Workflow Builder connector
  walkthroughs; most renderer screens still require manual verification.
- Concurrency/worker isolation now has deterministic stress coverage (`verify:stress:*`,
  `verify:soak:runtime` — fake runtimes/temp stores, developer-machine scale); real multi-hour
  soak with live browsers is still not automated.
- Concurrent Instance Monitor non-DOM logic is verified by `npm run verify:instance-monitor` (**55**
  pure checks: search/visible-count/validation/name resolution, execution grouping, status/count/progress
  summaries, run ordering, stop eligibility, the observation command boundary, and idempotent
  17-bucket/page bisection). `npm run verify:instance-monitor-gui` adds **18** real Electron checks
  using an isolated temporary profile and local-only slow workflow: one grouped record for four
  instances, all-instance details/report actions, passive live screenshot rendering, both modal
  focus traps, destructive confirmation, and hard cancellation of two running + two queued
  instances. Remaining manual-only DOM coverage: workflow-card hover/focus
  cross-fade/equal-height behavior and simultaneous runs from two different workflow cards.

## Unknown / Needs Verification
- Whether `tests/*.spec.ts` is run in any CI (no CI config detected in the repo).
