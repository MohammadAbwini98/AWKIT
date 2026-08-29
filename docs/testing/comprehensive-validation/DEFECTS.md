# AWKIT Comprehensive Validation Defects

## Resolved 2026-08-27 — `awkit-final9` execution, UX, export, Chrome and diagnostics findings

| Finding | Root cause | Resolution / evidence |
| --- | --- | --- |
| FINAL9-001 continued failure could finish green | Graph termination at End was allowed to overwrite earlier terminal step failure. | Terminal-failure latch plus explicit `recoveryRouted` distinction; Runner 136/136 and Reports status agreement. |
| FINAL9-002 false Not Runnable | Instance Monitor used a partial/generic derived verdict instead of execution admission. | `executions.validate` is authoritative and real reasons render; Instance Monitor 27/27 plus designer validation suites. |
| FINAL9-003 inaccessible long run lists | Overflow/min-height ownership sat outside the list's flex boundary. | Contained focusable scrollers for Workflow Runs and Instances; real-Electron small-viewport and keyboard checks 27/27. |
| FINAL9-004 no safe node clipboard | Designers had no shared portable clipboard or compatibility mapping. | Application-scoped structured clone, fresh ids/offsets, no edges, Start/End and text-edit guards, Run Flow cross-mapping; Flow 122/122 and Workflow 68 broad checks. |
| FINAL9-005 favorites mixed with URL history | Recorder persisted only one recent/captured list. | Schema-v2 separate favorites with normalization, dedupe, remove/re-add and unknown-field preservation; 119/119. |
| FINAL9-006 report export was incomplete | Reports lacked CSV and real workbook serialization. | Escaped CSV and ExcelJS Summary/Instances/Steps workbook with centralized redaction; populated Reports 168/0/3 and live engine 21/21. |
| FINAL9-007 installed Chrome trust/runtime gaps | Browser distribution lacked complete exact-role enforcement/discovery/profile isolation; long generated profile paths also exceeded Chrome's Windows cache limit. | Exact Super User IPC guards, explicit resolver errors/no fallback, AWKIT-owned short hashed profiles, captured-session precedence; Super User 61/61, concurrency 89/89 and real host Chrome Recorder/execution PASS. |
| FINAL9-008 Workflow table left unused width | A stale constrained wrapper prevented the table from consuming its panel. | Workflow-list-only Hologram layout correction; rendered widths pass at 1024–1920. |
| FINAL9-009 insufficient failure extraction | Optional debug-off suppressed critical evidence and no safe support artifact spanned responsible layers. | Critical error/fatal retention, deterministic redaction/rotation/correlation and exact-SU offline bundle; Settings E2E 182/182 plus redaction/retention checks. |

Two verifier defects and one environment-sensitive gate were also resolved without weakening product
assertions: Recorder identity capture now waits for the observable fixture click; Settings does not
double-count NOT RUN as FAIL; offline SHA-256 uses a module-independent .NET helper.

## Open product defects

None.

## Open test and harness findings

None.

## Resolved test and harness findings

### AWKIT-BLD-001 — `npm run typecheck:scripts` fails with 33 pre-existing errors, so `verify:all-typecheck` cannot pass

- **Classification:** Test/harness finding (gate is red before any change)
- **Severity:** S3 / The gate exists to catch a removed export that only fails at `tsx` runtime. While
  it is red, a NEW error in the verifier scripts is indistinguishable from the standing 33, so the
  signal it was built for is unavailable. No product code is affected — `tsc --noEmit` over `app/` +
  `src/` (the `npm run build` gate) is clean.
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-25 in a17b6e4** — 33 errors → **0**, `typecheck:scripts` exit 0.
- **Owner routing:** Verifier/script maintenance
- **Affected area:** `scripts/verify-cancellation.mts`, `verify-concurrency.mts`,
  `verify-ipc-contract.mts`, `verify-protected-login-recorder.mts`, `verify-recorder-draft.mts`,
  `verify-recorder-third-pass.mts`, `verify-reports-settings-a11y.mts`, `verify-secrets.mts`,
  `verify-security.mts`, `verify-verifier-classification.mts`, `verify-workflow-sentinels.mts`.
- **Evidence:** 33 errors at `HEAD` (`7ba0874`) and 33 with the `awkit-uwfo` working tree applied,
  measured by stashing the change and re-running — so the count is a standing baseline, not a
  regression. Dominant shapes: `TS2554 Expected 2 arguments, but got 3` on local `check(...)` helpers
  whose third detail parameter was never declared; `TS2341` private-member access in
  `verify-recorder-third-pass.mts`; implicit `any` in `verify-verifier-classification.mts`.
- **Fix direction:** widen the local `check()` signatures to accept the detail argument they are
  already called with, declare the two implicit `any` parameters, and expose or stop reaching for
  `StepExecutor.activePage`. Then keep the gate green so it can do its job.

- **Evidence after fix:** every diagnostic was traced to a cause and fixed there — no `tsconfig`
  change, no `@ts-ignore`, no widening to `any`, no assertion removed, no private member made public.
  **16× TS2554**: the local `check()` helpers in `verify-{secrets,security,workflow-sentinels}.mts`
  never declared the `detail` parameter their callers already passed, so every computed diagnostic
  string was discarded; declared **and used** (printed on failure; folded into the thrown message in
  workflow-sentinels, which fails by throwing). **4× TS7023/TS7006**: `listVerifierFiles` annotated
  `string[]`/`Dirent[]`, which resolves the two downstream implicit anys. **3× TS2341**: `StepExecutor`
  gained the read half of the public `setActivePage()` it already exposed — `getActivePage()` — and
  REC-039 asserts through it. **3× TS2367**: TypeScript narrows `let flag = false` to the literal
  `false` and does not track assignment inside a `.then()`/queued callback, so a correct `flag === true`
  could not compile; observed state moved onto a holder object, assertions unchanged. **2× TS7016**:
  added `scripts/lib/verify-harness.d.mts`, the sibling-declaration pattern `release-key-custody.d.mts`
  already uses. **2× TS2322/TS2698**: `ScenarioFlowNodeData` is one interface with a `kind` union, not
  a discriminated union, so `Extract<…, { kind: "flowRef" }>` was `never` and the fixture helper's
  overrides parameter accepted nothing; now `Partial<ScenarioNode["data"]>`. **1× TS2345**: the
  `verify-concurrency` Part K fixture declared a `runMode`/`browserWindowMode` that are not members and
  omitted required fields; it is now a genuine `ConcurrentRunProfile`. **1× TS2322**: `classify()` in
  `verify-ipc-contract` omitted `"NONE"` although the registry declares it. **1× TS2353**: the
  a11y results row type never declared the `skipped` NOT-RUN marker it carries, and the summary's
  `any` cast is gone.
  Behaviour re-measured after the fixes: security **53/53**, secrets **24/24**, ipc-contract **9/9**,
  classification reconciled, workflow-sentinels **29/29**, recorder-draft **109/109** (cardinality
  exact), cancellation **34/34**, concurrency **84/84**, recorder-third-pass **6/6** (REC-039 through
  the new accessor), protected-login-recorder **74/74** (cardinality exact), runner **129/129**,
  reports-settings-a11y **14 PASS / 0 FAIL / 1 NOT RUN** (its documented strict third state, unchanged).

## Resolved comprehensive-campaign defects
### AWKIT-REC-042 — User scroll is never captured, so scroll-dependent recordings replay against unscrolled pages

- **Classification:** Missing capability (silent semantic loss)
- **Severity:** S3 / The init script's complete listener inventory contains no wheel/scroll
  capture (scroll appears only as a drag-cancel signal). Infinite-scroll feeds, virtualized
  tables, and scroll-triggered lazy loads therefore replay without the scroll that mounted their
  content; later locators time out with no hint a scroll step is missing. The runner fully
  supports `scroll` nodes (`StepExecutor.ts:1973-1985`); recordings can never produce one.
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-24 in dc7f194**
- **Owner routing:** Recorder capture semantics
- **Affected area:** `src/recorder/recorderInitScript.ts` (listener inventory;
  `:3166, :3339` scroll-as-cancel only); runner support `src/runner/StepExecutor.ts:1973-1985`.
- **Fix direction:** at minimum document the exclusion as a known limit; better, capture
  debounced wheel gestures on the scrolled container as `scroll` nodes with the same fail-closed
  review bar used for drags.

- **Evidence after fix:** `verify:recorder-third-pass` 6/6: wheel gestures over new mock-site /scroll-lab are captured as PAGE-level scroll actions (direction+amount); mapped flow replays through StepExecutor and mounts the below-fold lazy block (lazy-clicked=clicked). Runner centers the cursor before wheel. Mapping covered by verify:recorder-flow 53/53.

---

- **Evidence after fix:** Source-level triage evidence recorded in `verify:security`-style guards is unnecessary here; the contract is pinned by existing gates — `flowNodeRegistry.uploadFile.validate` refuses an empty value (covered by catalog parity + validation suites) and the panel's `has("value")` Value Source editor is the in-product path. Verified on source 2026-08-24; no product change required.

### AWKIT-REC-041 — Downloads during recording are completely unobserved; download intent is silently dropped and replay saves to nowhere

- **Classification:** Missing capability (silent semantic loss)
- **Severity:** S3 / No `page.on("download")` exists anywhere in `src/recorder/**` — clicking
  "Export CSV" records a plain `click`. The runner fully supports a `downloadFile` node
  (`StepExecutor.ts:2000-2015`) the recorder can never emit; on replay the artifact lands in an
  internal temp location nothing references (or is opted out entirely under the Lean resource
  profile). Contrast uploads, where the validator at least refuses loudly (REC-043).
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-24 in dc7f194**
- **Owner routing:** Recorder capture semantics
- **Affected area:** `src/recorder/**` (no download handling); runner support exists at
  `src/runner/StepExecutor.ts:2000-2015`; `src/runner/BrowserContextFactory.ts:116`.
- **Fix direction:** decide product posture — observe `download` and emit a runner-executable
  `downloadFile` node (recorded suggested filename as hint), or surface an explicit
  "downloads aren't captured" notice; add a mock-site download scenario.

- **Evidence after fix:** `verify:recorder-third-pass` 6/6: clicking mock-site /runner-lab download-csv during recording REPLACES the click with a runnable downloadFile step keeping the element locator (no double download on replay); uncorrelated downloads log a loud warning.

---

### AWKIT-REC-040 — Smart-Wait signals are not scoped to a page, so popup/tab activity becomes `afterWaits` on the wrong page's actions

- **Classification:** Product defect (probable; quality rot, mostly silent)
- **Severity:** S3 / Signal bindings discard the source page and buffer into one array;
  `attachSmartWaits` builds its window across ALL pages and attaches to the last action
  regardless of origin. Background fetches/loaders inside an open popup land in the next
  main-page action's window; at replay those optional `response` waits stall ~10 s each on the
  main page before warn-only failure, and loader/rows/toast locators resolve against the wrong
  page. Required `urlChanged` leaks are mostly bounded by the 2 s causality window, hence P3.
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-24 in dc7f194**
- **Owner routing:** Recorder Smart-Wait capture
- **Affected area:** `src/recorder/RecorderService.ts:744-749` (binding discards `_source`),
  `:1388-1401` (`attachSmartWaits`); `src/recorder/smartWaitObservation.ts:22-28, 202-234`.
- **Fix direction:** tag signals with the source page in the init-script envelope; filter in
  `attachSmartWaits` to the predecessor action's page; add a two-page fixture asserting popup
  signals never become main-page `afterWaits`.

- **Evidence after fix:** `verify:wait-validation` 107/107 (+4): buildSmartWaits(actionPageSrc) drops popup-page loader/rows from main-page windows while request/url signals stay global and unmarked legacy signals are never filtered. Recorder stamps __src per Page at binding time.

---

### AWKIT-REC-039 — "Return to main tab" always replays as `switchToLatestTab`; the recorded URL hint is never consulted, so ≥2 open popups switch to the wrong tab

- **Classification:** Product defect (probable at ≥2 live popups; logic-certain)
- **Severity:** S2 / The recorder emits a routeChange named "Switch to tab: <main-url>" with the
  target URL, but `buildRecordedFlow` hardcodes `routeMode: "switchToLatestTab"`, and the
  runner's `switchToLatestTab` branch picks `context.pages().filter(p => p !== activePage).pop()`
  — creation-ordered — ignoring the URL entirely (`urlMatch` is consulted only in the
  `switchToUrl` branch). With pages `[Main, Popup1, Popup2]` and activePage Popup2, replay
  switches to Popup1, and every subsequent main-tagged step executes against the wrong page.
  Single-popup fixtures (all that exist) pick correctly, which is why coverage is green.
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-24 in dc7f194**
- **Owner routing:** Recorder → flow mapping / runner tab switching
- **Affected area:** `src/recorder/RecorderService.ts:1672-1692`;
  `src/recorder/buildRecordedFlow.ts:299-303`; `src/runner/StepExecutor.ts:2142-2176`.
- **Existing coverage:** `verify:recorder-locator` single-popup return-to-main only;
  `verify:recorder-flow` asserts the mapping statically; no two-live-popups scenario exists.
- **Fix direction:** in the `switchToLatestTab` default prefer a page matching the recorded URL
  before falling back to `.pop()` (or emit `switchToUrl` when a safe target URL exists); add a
  two-popup mock-site fixture with return-to-main.

- **Evidence after fix:** `verify:recorder-third-pass` 6/6: real StepExecutor with pages [Main,/form] [Popup1] [Popup2=active] executes routeChange carrying the main URL and lands on MAIN (old .pop() logic landed on Popup1). Mapping keeps step.value = recorded hint (`verify:recorder-flow` 53/53).

---

### AWKIT-REC-038 — Type-then-Enter records a trailing duplicate Fill that replays against the post-submission page

- **Classification:** Product defect (recorded flow diverges from user actions; common flows fail replay)
- **Severity:** S2 / Chrome commits `change` immediately before form submit, so typing "alice"
  then pressing Enter records `[Fill X="alice", Press Enter, Fill X="alice"]`: the init script
  records the change-commit as a second fill AFTER the Enter keydown, and the recorder's
  duplicate-echo rule drops the Tab-blur echo but keeps any echo preceded by an action that
  "might have altered the control" — Enter is not in `VALUE_PRESERVING_KEYS`, so the echo is
  kept. At replay the `press` triggers navigation and the trailing `fill` then resolves its
  locator on the committed page: where the field is gone (login → dashboard) the step auto-waits
  and fails the flow; where it exists the field is silently refilled post-navigation.
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-24 in dc7f194**
- **Owner routing:** Recorder capture semantics
- **Affected area:** `src/recorder/recorderInitScript.ts:3374-3379, 3423` (press recorded at
  keydown, change recorded after); `src/recorder/RecorderService.ts:1593-1603, 1615-1624`
  (`VALUE_PRESERVING_KEYS` without Enter; echo-drop condition); replay surface
  `src/runner/StepExecutor.ts:1929-1942`.
- **Existing coverage:** ineffective — `verify:recorder-competitive` §F uses a
  `onsubmit="return false"` form (no navigation) and asserts only "an action was captured";
  nothing replays a type+Enter flow.
- **Fix direction:** treat Enter/Escape as value-preserving for the echo rule (or restrict the
  keep-echo exception to keys that actually edit text); add a mock-site type+Enter-submit
  scenario asserted at action-sequence level AND replayed.

- **Evidence after fix:** `verify:recorder-actions` 23/23 (+3) drives the REAL service echo policy: [Fill alice, Press Enter, Fill alice] collapses to one fill + press; Escape-only behaves identically; original fill and press remain recorded.

---

### AWKIT-DUR-003 — Recorder draft and URL history use bare non-atomic writes; a torn write is silently discarded and the crash flush can race the debounce

- **Classification:** Data-integrity risk (unsaved recording loss)
- **Severity:** S2 / `persistDraft` writes the draft with a plain `writeFile` (no temp+rename),
  and `ensureDraftLoaded` treats a parse failure as "nothing to restore" — a torn write from a
  crash/power loss silently destroys the unsaved recording with no quarantine or log. Additionally
  `onUnexpectedDeath` fires `void this.persistDraft()` **without clearing `draftTimer`**, so the
  debounced write and the death flush can write the same file concurrently (`stopRecording` clears
  the timer first; the death path does not). `verify:recorder-draft` REC-014 pins the silent-drop
  load behavior but nothing asserts write atomicity.
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-24 in b5c0d41**
- **Owner routing:** Recorder persistence (`src/recorder`)
- **Affected area:** `src/recorder/RecorderService.ts:390-403` (`persistDraft`), `:448-457`
  (`persistUrlHistory`), `:463-477` (`ensureDraftLoaded` catch), `:541-561`
  (`onUnexpectedDeath` flush without timer clear; contrast `stopRecording`).
- **Fix direction:** route both writers through the shared atomic-replace helper, clear
  `draftTimer` in `onUnexpectedDeath` before flushing, quarantine corrupt drafts, and extend
  REC-014 coverage with a torn-write fixture plus a concurrent-flush assertion.

- **Evidence after fix:** `verify:recorder-draft` 109/109 (+7 DUR-003): torn-draft fixture quarantines bytes (.corrupt-* sibling verbatim) and restores nothing; persistDraft/persistUrlHistory use the shared atomic writer (no .tmp residue, complete JSON); onUnexpectedDeath clears draftTimer before flushing (wiring guards).

---

### AWKIT-DUR-002 — A transient read failure or corruption of the secret vault silently empties it; the next `set()` destroys every stored secret

- **Classification:** Data-integrity risk (unrecoverable credential loss)
- **Severity:** S2 / `SecretStore.read()` converts ANY parse/read failure into an empty vault
  (no quarantine, no log). `set()` is read-modify-write, so the first credential saved after such
  a failure rewrites `secrets.json` containing only the new secret — all Oracle connection
  passwords/trust-store secrets are gone with no diagnostic. Writes are atomic temp+rename but
  lack the bounded EPERM/EBUSY retry every other writer has (that failure mode at least throws,
  leaving the old file intact). `set`/`delete` being fully synchronous means there is no
  in-process read-modify-write race.
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-24 in b5c0d41**
- **Owner routing:** Secrets persistence (`src/secrets`)
- **Affected area:** `src/secrets/SecretStore.ts:104-113` (read catch-all → empty), `:63-82`
  (set read-modify-write), `:115-129` (write: atomic rename, no retry). Same shape the project
  filed as DUR-001/SES-004/SET-007 for other stores — but this store holds material the app
  cannot recover.
- **Fix direction:** quarantine corrupt bytes (mirror `JsonProfileStore.quarantineCorrupt`);
  return empty only on true ENOENT; adopt the shared atomic-replace retry; add a focused
  verifier (lock file → set → assert old secrets survive).

- **Evidence after fix:** `verify:secrets` 24/24 (+8): corrupt vault FAILS list(), quarantined as one secrets.json.corrupt-* sibling preserving bytes verbatim, get() resolves nothing fail-closed, subsequent set() starts a fresh vault without destroying preserved bytes; ENOENT control unchanged. write() adopts shared EPERM/EBUSY retry constants.

---

### AWKIT-SEC-006 — `AWKIT_SESSION_IDLE_MS` / `AWKIT_REAUTH_WINDOW_MS` are honored in packaged builds, contradicting the documented "dev/test only" posture

- **Classification:** Security concern (defense-in-depth inconsistency) + documentation drift
- **Severity:** S3 / Both env overrides are applied unconditionally in `securityKernel.ts` (no
  `app.isPackaged` guard), so a packaged install launched with e.g.
  `AWKIT_REAUTH_WINDOW_MS=86400000` stretches the sensitive-operation re-auth window from 5
  minutes to a day. The codebase's own precedent — the license test bypass — deliberately reads
  `app.isPackaged` before any env var for exactly this reason. CURRENT_STATE.md (2026-07-18
  section) claims the override is "dev/test only — production uses `DEFAULT_SESSION_POLICY`",
  which the implementation does not enforce.
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-24 in b72ad08**
- **Owner routing:** Security kernel bootstrap
- **Affected area:** `app/main/security/securityKernel.ts:37-47`; contrast
  `app/main/licensing/licenseRuntime.ts:38-95`; stale claim at `docs/ai/CURRENT_STATE.md`
  (2026-07-18 idle-lock section).
- **Fix direction:** honor both overrides only when `!app.isPackaged` (mirror
  `licenseRuntime.ts`), or document them as supported production configuration in SECURITY.md
  and correct CURRENT_STATE.md.
- **Note:** local environment control is required to exploit, hence P3 — but the doc/code
  contradiction is the point of the record.

- **Evidence after fix:** `verify:security` 53/53 SEC-006: AWKIT_SESSION_IDLE_MS/AWKIT_REAUTH_WINDOW_MS code positions sit behind an app.isPackaged gate in securityKernel.ts (packaged builds run documented policy regardless of launcher env).

---

### AWKIT-SEC-005 — Workflow execution reads data sources through an unconfined sink, bypassing audit §14 read confinement

- **Classification:** Security concern (documented confinement not enforced on one sink)
- **Severity:** S2 / `execution:runWorkflow` resolves a workflow's bound data source via
  `readDataFile` → `resolveDataFilePath`, which accepts **any absolute path** and applies neither
  `isReadableDataSourceFile` nor the 25 MB preview cap. The parsed content becomes run `rows` —
  so an Operator (holds `DATASOURCE_MANAGE` + `WORKFLOW_EXECUTE`) can read arbitrary
  JSON-parseable files, explicitly including AWKIT-internal artifacts under the runtime root
  (settings, session metadata, runtime store) that §14 exists to protect.
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-24 in b72ad08**
- **Owner routing:** Execution IPC / data-source read confinement
- **Affected area:** `app/main/ipc/execution.ipc.ts:441-459` (`readDataFile`/
  `resolveDataFilePath`); contrast the confined path every other read uses,
  `app/main/ipc/dataSource.ipc.ts:27-51` (`assertReadableDataFile`); the create/import channels
  do not validate the profile's `file` field, so an absolute path persists unchallenged.
  `docs/security/FULL_SECURITY_AUDIT.md` §14 claims "all JSON data-source reads" are confined —
  contradicted by this sink.
- **Fix direction:** route execution-time reads through `readJsonFileGuarded`/
  `assertReadableDataFile` (or validate `file` at create/import); add a `verify:security` case
  asserting a runtime-root data source is rejected at run time.

- **Evidence after fix:** `verify:security` 53/53 SEC-005: readDataFile routes through §14 confinement before parsing; real temp-file probes prove a runtime-root absolute path is REJECTED while the data-sources workspace stays readable. Execution-time exfiltration path closed.

---

### AWKIT-SEC-004 — `recorder.ignoreProtectedLoginDetection` can be persisted by an unauthenticated `settings:update`, disabling protected-login handoff app-wide

- **Classification:** Security concern (protected-login boundary weakening)
- **Severity:** S2 / `settings:update` gates only `recorder.security` and the four substantive
  keys; `{ recorder: { ignoreProtectedLoginDetection: true } }` touches neither, so **no
  permission check and no session is required**. The flag persists in `ui-settings.json` and
  suppresses the pause-and-handoff on IdP/MFA/CAPTCHA surfaces for every future Recorder session
  on the machine (`recorder.ipc.ts:51` feeds it to `RecorderService` at start).
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-24 in b72ad08**
- **Owner routing:** Settings IPC / Recorder security policy
- **Affected area:** `app/main/ipc/settings.ipc.ts:36-43`
  (`patchTouchesSubstantiveSettings` — the comment gates `recorder.security` as privileged while
  its security sibling one field away stays ungated); consumption at
  `app/main/ipc/recorder.ipc.ts:51` and `src/recorder/RecorderService.ts:640`.
- **Fix direction:** treat `recorder.ignoreProtectedLoginDetection` as privileged (include
  `patch.recorder?.ignoreProtectedLoginDetection` in the substantive gate, requiring
  `SETTINGS_EDIT`); add an authorization probe to `verify:protected-login-recorder` or
  `verify:e2e-rbac`.

- **Evidence after fix:** `verify:security` 53/53: patchTouchesSubstantiveSettings gates recorder.ignoreProtectedLoginDetection (SETTINGS_EDIT required) and recorder:start consumption site pinned; unauthorized persistence now fails at IPC.

---

### AWKIT-SEC-003 — Oracle Settings/Drivers/Java IPC mutators are gated only by `assertTrustedSender`: pre-authentication path to code execution and secret-store writes

- **Classification:** Security concern (authorization bypass; code-execution prerequisite chain)
- **Severity:** S2 / Every mutating Oracle *settings* channel requires no session and no
  permission — only a trusted sender frame. Reachable chain in a packaged build: DevTools is not
  disabled, so at the login screen `window.playwrightFlowStudio.oracle.java.addExe(...)` opens the
  native picker and the app then **executes** the chosen binary (`probeJavaVersion` → `execFile`);
  `oracle:drivers:import` + `oracle:drivers:testLoad` import and load attacker JARs in the Java
  bridge; `oracle:profiles:save` writes attacker-controlled entries into the DPAPI secret vault.
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-24 in b72ad08**
- **Owner routing:** Oracle IPC / main-process authorization
- **Affected area:** `app/main/ipc/oracle.ipc.ts:47-63` (profiles save/delete/test/testDraft),
  `:90-164` (drivers import/validate/setDefault/remove/testLoad, java add/remove) — all
  `assertTrustedSender` only; contrast `:69-78` where sibling `oracle:dataSources:*` correctly use
  `assertSenderPermission(Permission.DATASOURCE_MANAGE)`. Execution sinks:
  `app/main/oracleService.ts:91-108` (`execFile` probe), `:232-268` (driver classpath load);
  `src/oracle/JavaRuntimeStore.ts:128-139`; `src/oracle/OracleProfileService.ts:100-103`
  (credential → vault on save). CURRENT_STATE.md's PR #24 note (2026-07-24) records that
  driver/Java/Settings channels were left "unchanged" when the data-source channels were gated —
  known asymmetry, never filed as a defect until now.
- **Fix direction:** add `assertSenderPermission(event, Permission.SETTINGS_EDIT)` to every
  mutating `oracle:profiles:*`, `oracle:drivers:*`, `oracle:java:*` handler (matching
  `settings.ipc.ts`/`secrets.ipc.ts`); extend `verify:e2e-rbac` with pre-login and Viewer probes
  of these channels; then fold the surface into the SEC-002 channel registry.

- **Evidence after fix:** `verify:security` 53/53 SEC-003 scan: all 15 mutating oracle profiles/drivers/java handlers enforce SETTINGS_EDIT after assertTrustedSender; ipc-contract 9/9 reclassified them PERMISSION; authz 92/92 confirms SETTINGS_EDIT is session-gated fail-closed.

---

### AWKIT-QA-008 — Field-absence escape hatch in `verify-zvec-packaged-live`; unreachable BLOCKED/NOT-RUN states in the comprehensive ledger

- **Classification:** Test quality (new instances of the catalogued "checks that cannot fail" and
  dead-state families)
- **Severity:** S3 / (a) The packaged live-CRUD gate asserts
  `` typeof status?.lastReason === "string" ? /^SEMANTIC_/.test(...) : true `` — if the report
  schema drifts and the field disappears, the check folds to `true` instead of failing. This is
  instance #8 of the KNOWN_ISSUES "escape hatch" family, in a file NEWER than the seven
  catalogued ones. (b) `verify-comprehensive-e2e.mts` declares `BLOCKED`/`NOT RUN` case states
  and tallies them, but its `withCase` helper can only ever produce PASS/FAIL — the tallies are
  structurally zero. Harmless today; the moment someone starts recording BLOCKED there, the exit
  gate keys on FAIL only and unexecuted cases print green.
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-23 in e64a5dd**
- **Owner routing:** QA
- **Affected area:** `scripts/verify-zvec-packaged-live.mts:195-199`;
  `scripts/verify-comprehensive-e2e.mts:30,591-596,631`
- **Fix direction:** assert field presence before pattern-matching (or use the suite's existing
  NOT-RUN plumbing for schema absence); either wire real BLOCKED production into `withCase` or
  delete the dead states so the tally cannot mask a future skip.

---

- **Evidence after fix:** zvec escape hatch #8 removed (field presence asserted before SEMANTIC_ match; verify exit 0). comprehensive-e2e dead BLOCKED/NOT RUN/N-A states deleted so the tally cannot mask a future skip (exit 0).

---

### AWKIT-QA-007 — Four GUI/engine gates exit 0 when every check is NOT RUN

- **Classification:** Test quality (family)
- **Severity:** S3 / A CI consumer sees green with zero executed checks; exit-code semantics are inconsistent across suites
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-23 in e64a5dd**
- **Owner routing:** QA
- **Affected area:** `scripts/verify-packaged-validation.mts:676`, `scripts/verify-reports-live-engine.mts:536`, `scripts/verify-recorder-gui.mts:1566`, `scripts/verify-settings-runner-behaviour.mts:405` (exit on `failed === 0` only); correct pattern already in-tree at `scripts/verify-zvec-packaged-live.mts:228` (`failed === 0 && notRun.length === 0`) and `verify-packaged-walkthrough.mjs` (blocked fails)
- **Detected by:** Independent whole-repository code review

Related same-family observations from the same review, recorded without full entries:
`verify-reports-settings-a11y.mts` writes skips into execution-results.json as `pass:false` while
exiting green and never printing its `notRun` counter; `verify-settings-e2e.mts` SET-015 pushes
no results row at all so the case vanishes from both denominator and headline;
`verify-comprehensive-e2e.mts` declares BLOCKED/NOT RUN/N-A statuses that the exit condition
never consults; `verify-verifier-classification.mts` scans `scripts/` non-recursively (the two
zvec-spike verifiers are invisible to reconciliation), counts any substring mention as
registration, and has no floor on per-class totals; several registered GUI verifiers chain fixed
`waitForTimeout(n)` delays before assertions (the exact flaky shape measured FAIL/FAIL/FAIL/PASS
in settings-runner-behaviour). A shared harness helper (three states + cardinality floor +
connectivity-aware skip semantics) would close these as a class.

---

---

---

---

---

- **Evidence after fix:** Exit gates fixed in packaged-validation / reports-live-engine / recorder-gui / settings-runner-behaviour / reports-settings-a11y (prints + fails on skips) / settings-e2e (SET-015 skip becomes a visible skipped row that fails). verifier-classification scans scripts/ recursively (198 files) and enforces per-class floors. Fixed waits in settings-runner-behaviour converted to condition waits.

---

### AWKIT-QA-006 — An offline machine turns the Chromium no-egress gate into a vacuous full-green run

- **Classification:** Test quality
- **Severity:** S2 / A security-relevant release gate can print a confident all-pass tally while its subject was exercised zero times
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in e64a5dd**
- **Owner routing:** QA
- **Affected area:** `scripts/verify-chromium-hardening.mts:159-165`
- **Detected by:** Independent whole-repository code review

When navigation probes fail with offline-shaped errors the suite records a PASS via
`check("navigation check skipped while offline …", true)` and itself notes that part B's
zero-egress result is trivially true offline — yet part B still tallies as a real pass, and the
suite has only PASS/FAIL states so nothing marks the run degraded. Same family as the documented
context-status degrade-to-normal trap: environmental degradation converts the gate into a quiet
pass. Fix direction: a NOT-RUN third state plus a distinct exit (or failure) when the positive
navigation proof did not execute.

- **Evidence after fix:** `verify-chromium-hardening`: offline skip records NOT RUN and exits non-zero (positive navigation proof must execute); NOT RUN lines printed at summary.

---

### AWKIT-QA-005 — Verifier tallies divide by a denominator an uncaught throw can shrink

- **Classification:** Harness design — repo-wide pattern, not confined to these two scripts
- **Severity:** S3 / LOW
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-23 in e64a5dd**
- **Owner routing:** QA
- **Affected area:** `scripts/verify-recorder-draft.mts`,
  `scripts/verify-protected-login-recorder.mts`, and any verifier sharing this harness shape
- **Detected by:** Independent QC review of the REC-022 workstream (`awkit-cey`)

Both harnesses compute their tally as `passed / results.length`, where `results` accumulates only
the checks that actually ran. An uncaught throw part-way through a section therefore **shrinks the
denominator** instead of failing a check, so the run can print a full-looking `N/N` while having
silently skipped work. The exit code still reflects the failure; the printed tally does not.

**Consequence for readers:** judge these verifiers by **exit code**, never by a full-looking tally
alone. This is worth a repo-wide sweep — the shape is not unique to these two scripts.

**Fix direction:** assert an expected check count (a cardinality assertion) alongside the tally, so a
shortened run fails loudly.

- **Evidence after fix:** Shared helper scripts/lib/verify-harness.mjs (assertCardinality + three-state createTally); recorder-draft pins EXPECTED=102, protected-login-recorder EXPECTED=74 — both print 'executed exactly N checks' and fail on shrink. Sweep of remaining suites tracked as ongoing adoption.

---

### AWKIT-QA-004 — Missing optional chaining turns a clean FAIL into a crash

- **Classification:** Test robustness
- **Severity:** S3 / LOW
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-23 in e64a5dd**
- **Owner routing:** QA
- **Affected area:** `scripts/verify-protected-login-recorder.mts` (`.config` access)
- **Detected by:** Independent QC review of the REC-022 workstream (`awkit-cey`)

A `.config` property is read without optional chaining. If the owning object is ever absent the
verifier throws a `TypeError` instead of recording a failed check — which, combined with
AWKIT-QA-005 below, would remove the check from the denominator rather than fail it.

**Fix direction:** use optional chaining and assert the value explicitly.

- **Evidence after fix:** `verify:protected-login-recorder` 74/74: persistedResumeDraft.actions[1]?.config?.reuseSessionId — a missing node fails the check instead of crashing the verifier.

---

### AWKIT-QA-003 — Inverted variable name `draftGoneAfterDiscard`

- **Classification:** Test readability / fragility
- **Severity:** S3 / LOW
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-23 in 4c4044f**
- **Owner routing:** QA
- **Affected area:** `scripts/verify-recorder-draft.mts:275-276`
- **Detected by:** Independent QC review of the REC-022 workstream (`awkit-cey`)

The variable named `draftGoneAfterDiscard` holds the opposite sense of its name. The assertion is
**correct today**, but the name invites a future editor to "fix" the polarity and silently invert a
real check.

**Fix direction:** rename to match the value it holds.

- **Evidence after fix:** Renamed to draftExistsAfterDiscard with a comment recording why; landed inside cluster 8's recorder-draft update (93/93 then, 102/102 now).

---

### AWKIT-QA-002 — Queue failure-isolation contract is untested

- **Classification:** Test coverage gap
- **Severity:** S3 / LOW
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-23 in e64a5dd**
- **Owner routing:** QA
- **Affected area:** `src/session/SessionCaptureService.ts:82,85` (the `.then(operation, operation)`
  serialization chain)
- **Detected by:** Independent QC review of the REC-022 workstream (`awkit-cey`)

The `enqueue` chain uses `.then(operation, operation)` specifically so a rejected operation cannot
poison the queue for every later mutation. No assertion exercises that: the added concurrency
coverage only drives operations that resolve. A regression that dropped the rejection handler would
pass the whole suite.

**Fix direction:** enqueue an operation that rejects, then prove a subsequent enqueued operation
still runs and lands.

- **Evidence after fix:** `verify:recorder-draft` 102/102 QA-002: an operation enqueued AFTER a rejecting operation still runs and lands; list() healthy afterwards.

---

### AWKIT-QA-001 — Trivially-true login-interaction regex with no positive control

- **Classification:** Test quality
- **Severity:** S3 / LOW
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-23 in e64a5dd**
- **Owner routing:** QA
- **Affected area:** `scripts/verify-protected-login-recorder.mts`
- **Detected by:** Independent QC review of the REC-022 workstream (`awkit-cey`)

The regex asserting that the resumed draft contains no login interaction cannot fail against any
plausible draft, and no positive control proves it would match a draft that *did* contain one. The
assertion is not currently wrong, but it carries no discriminating power.

**Fix direction:** add a positive control that constructs a draft containing a login interaction and
proves the regex matches it, then assert absence on the real draft.

- **Evidence after fix:** `verify:protected-login-recorder` 74/74 QA-001 positive control: strengthened pattern matches Click/Complete-login names AND does not match the inserted secure nodes (the OLD regex matched neither control — proof the original had zero discriminating power).

---

### AWKIT-A11Y-001 — ReauthDialog declares `aria-modal` with no focus contract, while another file asserts it has one

- **Classification:** Product defect (accessibility; recurring aria-modal-without-focus class,
  fourth instance)
- **Severity:** S2 / The password modal for sensitive Super-User actions moves focus neither in nor
  back, does not trap Tab, and ignores Escape — while background content remains reachable. A
  sibling file documents the opposite: "`ReauthDialog` … already carries a focus contract", which
  is false against current source. `ResetPasswordModal` on the same admin surface duplicates the
  gap (and lacks an accessible name) while UserAccessModal in the same file implements the full
  contract — two modals, divergent keyboard behavior, one page.
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 6aaae02**
- **Owner routing:** Frontend admin pages
- **Affected area:** `app/renderer/pages/admin/ReauthDialog.tsx` (no effect/ref/keydown anywhere);
  false claim `app/renderer/pages/SemanticIndexSettings.tsx:23`; `ResetPasswordModal`
  `app/renderer/pages/admin/UserManagement.tsx:403-418` vs correct sibling `UserAccessModal`
  `:352-400`; reference contract `components/shared/ConfirmDialog.tsx:31-62`. Launched from
  sensitive flows incl. License Issuer re-auth.
- **Fix direction:** apply the ConfirmDialog contract to both modals and correct the stale claim;
  consider the class-level guard already recommended in KNOWN_ISSUES (source scan over
  `aria-modal="true"`).

---

---

---

---

---

---

---

---

---

---

- **Evidence after fix:** `verify:source-hygiene` 11/11 with the class-level guard: every aria-modal file must use useModalFocusContract or an in-file Escape+focus+return contract. ReauthDialog + ResetPasswordModal converted (accessible name added); the guard surfaced nine more instances, all fixed via the hook. verify:admin-gui / verify:e2e-reauth / verify:reports-settings-a11y / verify:super-user-controls all exit 0. Stale claim in SemanticIndexSettings corrected.

---

### AWKIT-LIC-002 — Signed entitlements are never enforced anywhere

- **Classification:** Licensing-model gap (documentation contradicts implementation)
- **Severity:** S2 / A license issued with a single entitlement confers the entire product; concurrency/scheduling/browser tiers are cryptographically attested yet operationally meaningless, contradicting docs/LICENSING.md ("check them in the trusted layer")
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 56739ea**
- **Owner routing:** Licensing
- **Affected area:** `src/licensing/LicenseTypes.ts:32-37` (four signed Entitlement values); `src/licensing/RunGatePolicy.ts:46-66` (admission consults only status/operable); consumers otherwise issuer/UI-only
- **Detected by:** Independent whole-repository code review

Not a run-gate bypass: unlicensed/integrity-failure posture is unaffected. Related lower-severity
findings from the same review, recorded without full entries: license IMPORT resets the clock-
rollback high-water mark and `locallyRevoked` (`LicenseService.ts:157-164` defeats the advertised
rollback mitigation via re-import); provisioned/shared licenses never advance clock/revocation
metadata (meta maintenance runs only for `source === "local"`); `key1` is not marked `retired` in
TRUSTED_KEYS although the issuer already refuses retired keys mechanically; `resumeInstance`/
`retryHandoff` resume parked work without consulting the enforcement latch (narrow — the instance
was admitted when started); enforcement refresh performs synchronous disk + registry fingerprint
work inside the dispatch loop (availability cost, fail-closed intact).

---

---

- **Evidence after fix:** `verify:licensing` 192/192 (+9): single-entitlement license blocks runs as ENTITLEMENT_MISSING while absent-data stays back-compat; import preserves locallyRevoked + high-water; shared-source shadow advances rollback metadata; key1 retired; parked resume/retry consult the latch (execution.ipc). verify:license-dispatch-gate 34/34, verify:e2e-licensing exit 0, verify:release-key-custody exit 0.

---

### AWKIT-SEC-002 — Several mutating/read IPC channels carry no authorization assertion (RBAC boundary incompleteness)

- **Classification:** Security concern (authorization asymmetry)
- **Severity:** S2 / Pre-login or low-privileged renderers can read full data-source rows, delete captured login sessions (recursive profile-directory delete), rename/markUsed sessions, and perform full instance CRUD — the declared fail-closed boundary model is not applied uniformly
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in f6b144c**
- **Owner routing:** Main-process security
- **Affected area:** `app/main/ipc/dataSource.ipc.ts:67-108` (list/get/export/preview/getJsonPaths/readJson/dataSource:list ungated while every mutating sibling is gated); `app/main/ipc/session.ipc.ts:31-53` (delete/rename/markUsed/getById/list/stopCapture ungated; only startCapture guards); `app/main/ipc/instance.ipc.ts:8-17` (full CRUD ungated); `app/main/ipc/runtimeInput.ipc.ts:8-15` (mutation-capable channels ungated)
- **Detected by:** Independent whole-repository code review

There is also no mechanical gate asserting every registered channel declares NONE/TRUSTED/
PERMISSION — `verify:ipc-contract` recognizes specific registrar helpers, so a plain
`ipcMain.handle` with no guard passes everything today. That registry is the fix direction that
closes the class.

- **Evidence after fix:** `verify:ipc-contract` 9/9 with Check 5 AUTHZ_REGISTRY: all 210 handlers classify as PERMISSION (assertSenderPermission/authorize), TRUSTED (assertTrustedSender), or declared NONE with reason; registry-vs-code mismatches and stale entries fail. Per-file floors in verify:security 45/45; role suites green (authz 92/92, e2e-rbac 70/70, e2e-reauth exit 0, data-editor 27/27) with DATASOURCE_VIEW added to Viewer+.

---

### AWKIT-SEC-001 — `dataSources:createFromScratch` writes attacker-controlled paths outside the workspace

- **Classification:** Security concern (path traversal write)
- **Severity:** S2 / A caller with DATASOURCE_MANAGE can create/overwrite arbitrary user-writable `.json` files outside the data-sources workspace, including privileged stores such as ui-settings.json or session-profiles.json metadata
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in f6b144c**
- **Owner routing:** Main-process security
- **Affected area:** `app/main/ipc/dataSource.ipc.ts:218-236` (`fileName` joined raw into `dataFilesDir()`; only extension validated; no `isPathInside`/basename confinement) — the editor write path was confined for exactly this hazard (F-04), this sink was missed
- **Detected by:** Independent whole-repository code review

- **Evidence after fix:** `verify:security` 45/45 SEC-001 guard: createFromScratch confines fileName via safePathComponent and re-asserts isPathInside(dataFilesDir(), file). Mutation restoring the raw join makes the guard detect the mutant (safePathComponent/isPathInside absent).

---

### AWKIT-REC-037 — The Recorder's preserved draft is unreachable in the UI, and starting a recording destroys it

- **Classification:** Product defect (silent loss of recorded work; undermines the AWKIT-REC-001 guarantee at the UI layer)
- **Severity:** S2 / After a restart the restored draft never appears (page fetches actions only while `isRecording`), Save stays disabled, and pressing Start clears service memory and overwrites the draft file with empty — total silent loss of a pre-crash recording. Cancelling a handoff likewise wipes the locally displayed actions without refetching, hiding the actions the service deliberately preserved
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-23 in f49e132**
- **Owner routing:** Recorder (renderer/service contract)
- **Affected area:** `app/renderer/pages/Recorder.tsx:56-69` (actions fetched only inside the `isRecording` interval), `:379-392` (`handleCancelHandoff` sets `setActions([])` and never refetches); service `src/recorder/RecorderService.ts:603,645` (`startRecording` clears actions and persists immediately), `:463-477` (`ensureDraftLoaded` restores to memory only)
- **Detected by:** Independent whole-repository code review

Related same-root-shape gaps found in the same review: Save Flow remains enabled during an active
handoff pause and saving empties service memory mid-pause (Renderer `saveDisabled` lacks a handoff
term); `continueWithNormalBrowser` closes the recorder browser BEFORE validating Chrome
availability, bricking the handoff in `phase:"error"` with no retry; `startCapture` persists a
`capturing` profile row before validating the URL, stranding perpetual `capturing` rows invisible
to session matching; liveness watch is suppressed during the `detected` pause, so a closed paused
browser leaves status "Recording" against dead handles.

- **Evidence after fix:** `verify:recorder-draft` 100/100 (+14): page fetches actions+handoff on mount; saveDisabled includes handoffActive; cancel refetches instead of blanking; ConfirmDialog guards Start over a preserved draft; Chrome check precedes closeBrowser; URL validation precedes the capturing row; liveness watch armed during the detected pause. verify:protected-login-recorder 73/73 and verify:recorder-flow 50/50 stay green with the reordered service calls.

---

### AWKIT-REC-036 — Cancelling a handoff leaves stale ambiguity state pointing at a dead page

- **Classification:** Product
- **Severity:** S3 / LOW — reachable only by invoking ambiguity preview after a cancelled handoff
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-23 in 4c4044f**
- **Owner routing:** Recorder
- **Affected area:** `src/recorder/RecorderService.ts` `cancelSecureHandoff` (`:1347-1365`),
  `previewCandidate` (`:1757-1758`), former clearing site in `discardDraft()` (`:489-490`)
- **Detected by:** Independent QC review of the REC-022 workstream (`awkit-cey`)

The AWKIT-REC-001 fix removed the `discardDraft()` call from `cancelSecureHandoff`, which was also —
incidentally — the only thing nulling `ambiguityState` and `ambiguityPage` on that path
(`discardDraft()` still clears them at `:489-490`). After a cancelled handoff those fields can
therefore still reference a closed page, and `previewCandidate` (`:1757-1758`) would surface a raw
Playwright "target closed" error instead of an actionable message.

**Mitigating:** `stopRecording` has the same pre-existing gap, so this is a latent condition the fix
merely widened — it is **not** a regression unique to `1e85946`.

**Fix direction:** add `this.ambiguityState = null; this.ambiguityPage = null;` at
`src/recorder/RecorderService.ts:1361`, and consider the same for `stopRecording`.

- **Evidence after fix:** `verify:recorder-draft` 93/93 REC-036 checks: both cancelSecureHandoff AND stopRecording clear stale ambiguityState/ambiguityPage while preserving the draft; protected-login suites stay green (73/73, 26/26).

---

### AWKIT-SES-003 — Closing Chrome marks a capture `ready` without any authentication check

- **Classification:** Product defect (session lifecycle)
- **Severity:** S2/LOW–MEDIUM — a profile whose browser was closed WITHOUT logging in becomes
  `ready`, so Auto Secure Login's origin matching can silently bind a replay to an unauthenticated
  session
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 4c4044f**
- **Owner routing:** Session persistence / runner
- **Affected area:** `src/session/SessionCaptureService.ts` `handleBrowserClosed`;
  consumer `StepExecutor.executeAutoSecureLogin`
- **Detected by:** Live walkthrough run `021e3a2f`: an abandoned capture (`session-a2b9c0c8`,
  closed without login) flipped to `ready` and satisfied the Auto Secure Login skip-match

`handleBrowserClosed` sets `status = "ready"` unconditionally when the spawned Chrome exits — the
recorder path guards this with `hasCapturedData` in `captureSessionAndResume`, but the runner's
capture-completion path checks only `status === "ready"`, and `findBestSessionForUrl` filters on
`ready`. Mitigations that limited the blast radius this time: Reuse Session pins ids explicitly,
and the recorder now embeds login-origin urls (AWKIT-REC-003 fix). Fix direction: gate the
`ready` transition on `hasCapturedData` (existence-only) or a stronger authenticated-state signal;
note that real Chrome writes `Default/Preferences` early, so existence alone is weak — a stronger
signal may be needed. Never automate around it; fail closed.

---

- **Evidence after fix:** `verify:recorder-draft` 93/93 SES-003 matrix: cookies-bearing capture → ready on browser close; Preferences-only and abandoned captures → error (never reusable). Live log lines show the fail-closed warning.

---

### AWKIT-SES-002 — `session-profiles.json` silently changed from pretty-printed to single-line

- **Classification:** Documentation / undocumented behavior change
- **Severity:** S3 / LOW — the file still round-trips losslessly; only its on-disk shape changed
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-23 in 4c4044f**
- **Owner routing:** Persistence
- **Affected area:** `src/session/atomicWrite.ts:44`
- **Detected by:** Independent QC review of the REC-022 workstream (`awkit-cey`)

The new helper writes `JSON.stringify(value)` where the previous write path used
`JSON.stringify(value, null, 2)`. `session-profiles.json` therefore changed from pretty-printed to a
single line as a side effect of the `b16812a` atomicity fix. Nothing depends on the formatting, but
the change was neither intended by the defect it shipped under nor documented anywhere, so an
operator inspecting the store by hand sees an unexplained format change.

**Fix direction:** either restore the two-space indentation or record the format deliberately in the
session-store documentation.

- **Evidence after fix:** writeJsonFileAtomic writes JSON.stringify(value, null, 2); the recorder-draft suite seeds and round-trips real metadata through it (93/93) so session-profiles.json is pretty-printed by deliberate contract.

---

### AWKIT-SES-001 — Session atomic write duplicates the existing main-process helper

- **Classification:** Architecture / duplicate implementation
- **Severity:** S3 / LOW — no observed data loss; the two copies simply disagree on retry policy
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-08-23 in 4c4044f**
- **Owner routing:** Persistence
- **Affected area:** `src/session/atomicWrite.ts`, `app/main/atomicReplace.ts:77-109`
- **Detected by:** Independent QC review of the REC-022 workstream (`awkit-cey`)

`src/session/atomicWrite.ts` reimplements the temp-file + rename + EPERM/EBUSY retry that
`app/main/atomicReplace.ts:77-109` already provides, and the defaults have already drifted apart:
the new helper uses **4 attempts / 50ms linear** backoff while the existing helper uses
`DEFAULT_REPLACE_ATTEMPTS = 5` and `DEFAULT_REPLACE_BACKOFF_MS = 20`. Two independent retry
policies for the same Windows contention hazard is exactly the duplication `docs/ai/RULES.md:30`
forbids, and a future fix to one copy will not reach the other.

**Fix direction:** consolidate on the existing `app/main/atomicReplace.ts` helper rather than
keeping a second implementation; if the session store genuinely needs different attempt/backoff
values, they should be parameters of the one helper, not a fork.

- **Evidence after fix:** One canonical helper in src/storage/atomicReplace.ts (5 attempts / 20ms); app/main re-exports unchanged; src/session/atomicWrite delegates the rename half. verify:recorder-draft 93/93 injected-seam retry probes and verify:write-queue 29/29 run through the single implementation.

---

### AWKIT-SET-007 — Corrupt `ui-settings.json` silently resets to defaults and is overwritten at next startup

- **Classification:** Data-integrity risk (settings loss without backup)
- **Severity:** S3 / `getUiSettings()` treats any parse/read failure as factory defaults; `main.ts`
  writes `lastLaunchedAt` through `updateUiSettings` on EVERY startup, so a corrupted/truncated
  settings file is permanently replaced by defaults at next launch — custom storage paths,
  capacity caps, recorder security toggles and super-user policy gone silently, with no
  `.corrupt-*` preservation.
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 8e6e6a4**
- **Owner routing:** Main-process settings store
- **Affected area:** `app/main/uiSettings.ts:471-477` (catch-all hydrate({})),
  `app/main/main.ts:65` (unconditional startup write).
- **Fix direction:** quarantine-and-default like `JsonProfileStore`, and never let the startup
  bookkeeping write be the operation that destroys unrecoverable bytes.

- **Evidence after fix:** `verify-settings-runner-behaviour` 17 PASS / 0 FAIL on an ISOLATED LOCALAPPDATA with a seeded-truncated ui-settings.json: app boots on defaults, exactly one .corrupt-* sibling preserves bytes verbatim, startup write lands on a fresh VALID file, valid writes create no further siblings. Live quarantine line captured from app stderr.

---

### AWKIT-SES-004 — Malformed `session-profiles.json` silently resets the registry to `[]`; the next write destroys it

- **Classification:** Data-integrity risk (index to captured login sessions lost)
- **Severity:** S2 / One JSON parse failure collapses the whole session registry to empty; every
  subsequent mutation (list backfill, rename, markUsed, capture completion, delete) writes the
  truncated list over the metadata. The captured Chrome profile DIRECTORIES survive on disk but
  become unreachable/unlisted forever.
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-23 in 8e6e6a4**
- **Owner routing:** Session persistence (`src/session`)
- **Affected area:** `src/session/SessionCaptureService.ts` `readProfiles()` — bare
  `catch { return []; }` treats parse errors as "no sessions"; write-back sites then persist the
  loss through the (otherwise correct) atomic enqueue chain. Contrast the correct pattern one
  layer away: `JsonProfileStore.quarantineCorrupt` renames the bad file to `.corrupt-<ts>` and
  logs loudly (`src/storage/ProfileStore.ts:160-179`).
- **Fix direction:** mirror the profile-store quarantine (preserve bytes, return empty only for
  true ENOENT), and add a round-trip verifier that seeds malformed metadata and asserts it is
  preserved.

- **Evidence after fix:** `verify:recorder-draft` 85/85: corrupt session-profiles.json now fails reads loudly (/corrupt/i), quarantines exactly one .corrupt-* sibling whose bytes equal the original; missing-metadata control still lists zero safely.

---

### AWKIT-DUR-001 — A transient read failure of `runtime.sqlite` silently replaces all run history with an empty database

- **Classification:** Data-integrity risk (silent destruction of durable history)
- **Severity:** S2 / Any non-ENOENT read error (`EBUSY`/`EPERM`/`EACCES` — the exact Windows
  contention class this repo documents as routine) boots the store EMPTY, then persists the empty
  DB over the existing file. All durable run/attempt/artifact history is destroyed with "open"
  reporting success.
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-23 in 8e6e6a4**
- **Owner routing:** Runner persistence (`src/runner/store`)
- **Affected area:** `src/runner/store/SqliteRuntimeStore.ts` — `open()` catch block converts
  every `readFile` failure into a fresh empty `SQL.Database()`; `migrate()` then sets `dirty`,
  and the unconditional `persistNow()` at open renames the empty DB over `runtime.sqlite`
  (temp+rename, no quarantine). Contrast: corrupt-bytes failures throw out of
  `new SQL.Database(bytes)` into `ExecutionEngine`'s NullRuntimeStore downgrade, which PRESERVES
  the file — the two failure classes are handled inconsistently.
- **Fix direction:** catch only `ENOENT`; on any other read failure fail closed to
  `NullRuntimeStore` (or quarantine the unreadable file) and never persist over bytes that could
  not be read. Add a focused verifier that locks the file and asserts history survives.

- **Evidence after fix:** `verify:durable-store` 16/16, new Part D: open() on an unreadable path (directory-at-path, non-ENOENT class) REJECTS and the path survives untouched; corrupt-bytes rejects and is preserved verbatim; ENOENT control still boots fresh. Mutation restoring swallow-all → exit 1.

---

### AWKIT-RUN-002 — All instances of one run share a single `runtimeInputs` object

- **Classification:** Product defect (cross-instance data isolation)
- **Severity:** S2 / Under concurrent execution, one instance's loop-connector parameter writes are visible to sibling instances' `${runtimeInputs.*}` expressions for the duration of the loop — wrong values can be filled/submitted with no error
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-23 in a911cea**
- **Owner routing:** Runner / Instances
- **Affected area:** `src/instances/InstanceManager.ts:64` (same reference assigned to every created instance); writers `src/runner/FlowExecutor.ts:392,412`, `src/runner/PlaywrightRunner.ts:362,378`; reader `src/runner/ValueResolver.ts:19`
- **Detected by:** Independent whole-repository code review

`createInstancesForRun` builds N instances inside one `Array.from({ ... })` closing over one
`runtimeInputs` object; loop connectors mutate it in place (with save/restore around each
iteration, which narrows but does not close the window). Fix direction: per-instance shallow copy
at creation or copy-on-write at dispatch.

---

---

- **Evidence after fix:** `verify:concurrency` 84/84 with new Part K: 4 instances created from one template, all own DISTINCT runtimeInputs references (Set-cardinality === n), divergent writes on instances 1 and 2 stay invisible to siblings AND the run-level template. Mutation reverting to the shared reference → exit 1.

---

### AWKIT-RUN-010 — Scenario flow-input bindings are accepted by designers/validation but never executed

- **Classification:** Product defect (declared feature has no runtime implementation)
- **Severity:** S2 / `ScenarioOrchestrator.resolveFlowInputs` exists and computes per-flow input
  bindings, but repo-wide it has exactly ONE occurrence — its definition. Nothing applies declared
  `${outputs.*}` input bindings before each flow runs, so wiring flow A's output into flow B's
  input via the scenario editor has zero runtime effect.
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 6f4ec34**
- **Owner routing:** Orchestrator / runner
- **Affected area:** `src/orchestrator/ScenarioOrchestrator.ts:57-62` (sole occurrence);
  consumers use the plan for ordering/validation only (`PlaywrightRunner.ts:286`).
- **Fix direction:** either apply the bindings in the scenario execution path or remove the dead
  surface and stop advertising flow-input mapping.

- **Evidence after fix:** `verify:runner` 129/129 LIVE wiring case against mock-site /form: producer's declared output `${outputs.flowProd.first}` resolves through resolveFlowInputs and feeds the consumer's runtime input, proven by an equals assertion that only passes when the binding landed.

---

### AWKIT-RUN-004 — Workflow-level `manualApproval` links traverse automatically, bypassing the approval semantic

- **Classification:** Product defect (governance/approval bypass)
- **Severity:** S2 / Downstream approved-work runs unconditionally when linked by a manualApproval scenario link — zero human gate, opposite semantics to the same connector type inside a flow
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 6f4ec34**
- **Owner routing:** Runner / orchestrator
- **Affected area:** `src/runner/PlaywrightRunner.ts:457` (treats `link.type === "manualApproval"` as a success edge); contrast `src/runner/FlowExecutor.ts:629-640` ("an ordinary node must never traverse an approval connector, or the approval semantic is bypassed"); link type declared `src/profiles/ScenarioProfile.ts:15`
- **Detected by:** Independent whole-repository code review

Fix direction: require an explicit handoff/resume for workflow-level approval links, or reject
them at workflow validation until supported.

---

- **Evidence after fix:** `verify:runner` 129/129: a scenario with a manualApproval link fails validation-driven execution with an approval-named error and the downstream flow does not silently run; FlowDependencyResolver emits an error-severity issue.

---

### AWKIT-RUN-005 — Parallel fan-out silently skips branch targets and can report passed with zero branch work

- **Classification:** Product defect (silent incomplete run)
- **Severity:** S2 / A dangling edge (deleted target) vanishes a branch; diamond convergence skips branches whose target was already visited; the isolated variant returns success on an empty target set — no log, event, or step row records the skip
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 6f4ec34**
- **Owner routing:** Runner
- **Affected area:** `src/runner/FlowExecutor.ts:245-250` (sequential fan-out `continue`s), `:294-300` (isolated variant returns `{ success: true }` on empty targets)
- **Detected by:** Independent whole-repository code review

Same failure shape as the documented guarded-no-op loop class. Fix direction: emit a connector
event at minimum; fail (or record skipped step rows) when a declared parallel target cannot run.

---

---

- **Evidence after fix:** `verify:runner` 129/129, AWKIT-RUN-005 section: dangling sequential branch fails the group AND records a `skipped` step row; isolated fan-out whose only targets are dangling FAILS while the branch factory is provably never invoked.

---

### AWKIT-RUN-009 — Nested-flow outputs are double-prefixed, so `${outputs.<childFlowId>.<key>}` can never resolve

- **Classification:** Product defect (documented expression contract broken; fails open blank)
- **Severity:** S2 / A child flow prefixes its own step outputs with its flow id
  (`outputs["<child>.<key>"]`), `runFlow` spreads them verbatim into the parent step's outputs,
  and the parent flow re-prefixes → final key `<parent>.<child>.<key>`. Neither
  `FlowExecutor.makeScope` nor the workflow-level scope can match the documented two-segment form,
  so connector conditions and value sources referencing a sub-flow's outputs silently resolve to
  `undefined`/`""` instead of erroring.
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 6f4ec34**
- **Owner routing:** Runner (`FlowExecutor` output registry + `StepExecutor.runFlow`)
- **Affected area:** `src/runner/FlowExecutor.ts:134-136` (prefixing), `makeScope` lookup;
  `src/runner/StepExecutor.ts:2079` (`{ childFlowId, childFlowStatus, ...result.outputs }` spread);
  contract documented in RULES.md ("Connector expressions resolve `${outputs.<flowId>.<key>}`").
- **Fix direction:** strip the child prefix when importing nested outputs (or namespace under an
  explicit key) and pin both resolution channels with verifier cases.

- **Evidence after fix:** `verify:runner` 129/129: runFlow import-strip check proves the parent step outputs carry `value` with NO `<child>.` key (stub returns real registry shape `<flowId>.value`); parent re-prefix yields the documented two-segment form.

---

### AWKIT-FLO-001 — `closePopup` is palette-authorable but guaranteed to throw at runtime

- **Classification:** Product defect (designer-runtime contract break)
- **Severity:** S2 / A user can add Close Popup from the Node Palette, it validates clean
  ("Runnable"), and the step then throws at run time: the executor requires
  `config.popupAlias ?? step.pageAlias`, and NO renderer surface can author either field for this
  node type (the mapping preserves only Recorder-produced aliases).
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 4772c3b**
- **Owner routing:** Frontend / Flow Designer node registry
- **Affected area:** `app/renderer/components/workflow/flowNodeRegistry.ts:217-221`
  (`sections: ["execution"]`, no validate, `executable: true`);
  `src/runner/StepExecutor.ts` closePopup case (throws without alias);
  `app/renderer/components/workflow/flowProfileMapping.ts:282-284` (verbatim-preserve path is the
  only alias source). Shared validator agrees with the empty designer check
  (`src/validation/StepRequirements.ts:82`).
- **Fix direction:** give the node an alias picker section fed by the same popup aliases
  `switchToPopup` authors, or mark the node draft-only until an alias exists.

- **Evidence after fix:** `verify:flow-step-mapping` 166/166 FLO-001 section: registry refuses alias-less Close Popup / accepts pageAlias or recorded config.popupAlias; StepRequirements.requiresPopupAlias set; FlowValidator flags the empty shape as missingRequiredValue while leaving the aliased node clean; panel exposes the Popup Target editor. verify:validation 163/163 (shipped popup fixture carries an alias and stays clean).

---

### AWKIT-RUN-011 — Assertion-failure messages embed the raw `expected` value, which may be a resolved secret

- **Classification:** Security concern (secret leakage into run reports/logs)
- **Severity:** S3 / The masking comment is applied to `actual` only. `expected` comes from
  `resolveStepValue(step, cfg.expectedValue ?? step.value)` which resolves secret-type value
  sources through the DPAPI store — so an assertion comparing against a stored secret throws the
  RAW secret into the step error, which lands in run reports/logs. Exactly the leak the adjacent
  code says it is preventing.
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 4772c3b**
- **Owner routing:** Runner / redaction
- **Affected area:** `src/runner/StepExecutor.ts` `executeAssertion` failure branch:
  `` throw new Error(`Assertion failed: "${reported}" ${operator} "${expected}".`) `` — mask
  `expected` symmetrically (and consider refusing secret-backed expectations outright).
- **Existing coverage:** `verify:recorder-redaction` covers recorder surfaces; no gate covers this
  runner sink.

- **Evidence after fix:** `verify:assertions` 15/15, section [E] drives a real StepExecutor with a registered secret-backed expectation: failure message contains no raw secret and shows [masked]. Mutation reverting to raw interpolation → exit 1.

---

### AWKIT-RUN-008 — Auto Secure Login's manual-login wait cannot be cancelled; Stop resumes into a fresh browser launch

- **Classification:** Product defect (cancellation contract break)
- **Severity:** S2 / `Stop Instance` during the manual login has no effect for up to `timeoutMs`
  (default **10 minutes**): the poll loop checks neither `throwIfCancelled` nor the manual-handoff
  controller, and the automation browser is already closed so there is nothing to kill. When the
  user finally closes Chrome, steps 5–6 still execute — including `browserRestarter({ newUserDataDir })`
  relaunching a fresh persistent context AFTER cancellation — before the next step's
  cancellation check aborts the flow.
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-23 in 4772c3b**
- **Owner routing:** Runner (`StepExecutor` secure-login lifecycle)
- **Affected area:** `src/runner/StepExecutor.ts:2292-2300` (uncancellable `for(;;)` poll),
  `:2302-2312` (post-wait verify + relaunch with no cancellation check). Compare
  `captureProtectedLoginSession` (`:2489-2498`), which correctly races the handoff action — but
  see KNOWN_ISSUES for its cancel-before-arm window.
- **Fix direction:** race the poll against `this.cancellation` and reject immediately on cancel;
  re-check cancellation before the step-5/6 relaunch.

- **Evidence after fix:** `verify:cancellation` 34/34: new guards prove the manual-login poll checks throwIfCancelled inside the loop (before/after each tick) and re-checks BEFORE the post-wait relaunch; suite green with live Parts A-F.

---

### AWKIT-RUN-007 — Manual-handoff instances park browser slots invisibly to capacity accounting

- **Classification:** Architecture concern (queue starvation with green gauges)
- **Severity:** S3 / Each protected-login/manual handoff holds a full Chromium slot indefinitely while backpressure/capacity count only `starting|running`, so admission keeps admitting work that queues forever
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 49ea367**
- **Owner routing:** Runner / concurrency
- **Affected area:** `src/runner/ExecutionEngine.ts:1149-1151` (activeGlobal filter) vs slot held until `runInstanceInner`'s finally (~L1592); coordinator contrast `src/orchestrator/ConcurrentExecutionCoordinator.ts:85-87` (counts `waitingForManualAction`/`paused` correctly)
- **Detected by:** Independent whole-repository code review

- **Evidence after fix:** `verify:cancellation` Part G: admission filter is [starting, running, waitingForManualAction, paused]; verify:adaptive-concurrency 14/14 and verify:concurrency 81/81 stay green.

---

### AWKIT-RUN-006 — A throw during run-instance setup permanently leaks the browser pool slot

- **Classification:** Data-integrity risk (capacity leak)
- **Severity:** S2 / One bad disk/sql.js state halves host browser capacity (default cap 2) until app restart, with queued runs stalling on a saturated pool and no diagnostic pointing at the leak
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 49ea367**
- **Owner routing:** Runner
- **Affected area:** `src/runner/ExecutionEngine.ts:1334-1506` — slot/claims acquired ~1298-1345, fallible setup calls (durable store upsert L1385, RunLogger L1360, PassiveCdpTrace L1364, observability startRun L1450) sit OUTSIDE the try whose finally releases the slot (try begins ~L1509, release in finally ~L1592)
- **Detected by:** Independent whole-repository code review

A throw there rejects out of `runInstanceInner` before any cleanup; the watchdog marks the
instance failed but never releases the BrowserWorkerPool slot or resource claims. Fix direction:
move acquisition/setup inside the existing try/finally.

- **Evidence after fix:** `verify:cancellation` Part G source guard: in runInstanceInner the try opens BEFORE RunLogger construction and the durable upsert, with the finally after; runLogger uses are optional-chained so a setup throw cleans up instead of leaking. Concurrency/browser-pool suites green.

---

### AWKIT-RUN-003 — Stop on a finished instance retroactively relabels it `cancelled` with a fresh `endedAt`

- **Classification:** Product defect (history corruption)
- **Severity:** S2 / Run history and the durable store disagree for that run; reports show completed while the monitor shows cancelled
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 49ea367**
- **Owner routing:** Runner
- **Affected area:** `src/runner/ExecutionEngine.ts:1970-1976` (`cancelOne` rewrites terminal statuses when no active runner exists); `app/main/ipc/execution.ipc.ts:100-102` (no status guard); reachable from Instance Monitor controls on finished cards
- **Detected by:** Independent whole-repository code review

Expected: a no-op (or explicit error) for terminal instances without an active runner, mirroring
how the engine refuses to remove active instances elsewhere.

- **Evidence after fix:** `verify:cancellation` Part G: cancelOne's terminal branch returns without a status rewrite and execution.ipc refuses with `already-<status>`; suite green 32/32.

---

### AWKIT-RUN-001 — Instance Pause changes a label; execution continues at full speed

- **Classification:** Product defect (safety-relevant state desync / enabled control that does nothing)
- **Severity:** S2 / An operator who pauses before a sensitive sequence believes automation halted while clicks/fills/navigations keep firing on the live site
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-23 in 49ea367**
- **Owner routing:** Runner / Instance Monitor
- **Affected area:** `src/runner/ExecutionEngine.ts:1905-1915` (`pauseInstance` flips pool status only); renderer `app/renderer/pages/InstanceMonitor.tsx:508-516,718-722,957-959` (Pause / Pause All presented as execution control)
- **Detected by:** Independent whole-repository code review

Nothing in `src/runner` ever reads instance status to gate step dispatch — the runner has no
handle to the pool and no between-step pause token. Resume simply flips the label back. Either
wire a real gate checked between steps in `StepExecutor`, or re-scope/rename the control so it
cannot be read as an execution halt.

- **Evidence after fix:** `verify:cancellation` 32/32: new Part F proves LIVE that a paused run executes no further work (unsettled after 2.5s), Stop interrupts the parked pause promptly, and resume completes normally; Part G pins the wiring (StepExecutor awaits pauseGate at the throwIfCancelled seam; engine owns per-instance gates). Mutation: gate not awaited → exit 1.

---

### AWKIT-WFB-002 — Two of three Failure-Policy checkboxes are enabled controls that persist nothing; two large Builder UI regions are unreachable

- **Classification:** Product defect (RULES violation: no fake controls) + dead feature surface
- **Severity:** S2 / Toggling `continueOnOptionalFlowFailure` / `takeScreenshotOnFailure` changes nothing (not in the schema `execution` carries, so the dirty flag never fires and Save drops them); the entire Workflow Definition left panel renders `{false && …}` while its settings keys stay live; the collapsed connector panel's expand rail also renders `{false && …}` so it can never be reopened from the UI
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 63959fa**
- **Owner routing:** Frontend / Workflow Builder
- **Affected area:** `app/renderer/pages/ScenarioBuilder.tsx:1711-1722` and `1840-1866` (checkboxes), `2171-2175` (persisted subset), `1404-1597` (dead left panel), `1648-1662` + `1161-1167` (unreachable expand rail), `416-419`/`449-517` (live-but-write-only settings persistence); schema `src/profiles/WorkflowProfile.ts:90-94`
- **Detected by:** Independent whole-repository code review

- **Evidence after fix:** `WorkflowProfile.execution` gained optional continueOnOptionalFlowFailure/takeScreenshotOnFailure (back-compat, defaults on read); Builder checkboxes load+save them and `workflowToScenarioProfile` reads stored values. Retired left panel dead JSX + plumbing deleted; collapsed connector panel's expand rail renders again. Sentinels assert both fields persist and reach the runtime scenario profile; mutation dropping them → exit 1.

---

### AWKIT-WFB-001 — Every Workflow Builder save/export re-fabricates the stored workflow document

- **Classification:** Product defect (silent overwrite / demo-shaped data in the save path)
- **Severity:** S2 / Saving corrupts input bindings into static literals equal to the binding key, injects a hardcoded `selectedAccountType` dropdown into every saved workflow, clobbers descriptions, pins `version: 1`, and drops per-node policies on load+save
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-23 in 63959fa**
- **Owner routing:** Frontend / Workflow Builder
- **Affected area:** `app/renderer/pages/ScenarioBuilder.tsx:2102-2177` (`toWorkflowProfile`, used by the `workflowProfile` memo and `saveScenario`), load path `:1000-1052`, export `:1092-1100`
- **Detected by:** Independent whole-repository code review

Observed in `toWorkflowProfile`: `inputBindings` maps every declared flow-input key to
`{ type: "static", value: <the key's own name> }`; `runtimeInputs` hardcodes the
BUSINESS/PERSONAL `selectedAccountType` dropdown unconditionally; `description` is the constant
"Saved workflow of reusable flow profiles"; `version: 1` is pinned. The load path
(`loadWorkflowProfile`) discards persisted `inputBindings`, per-node `failurePolicy`,
`conditionRules`, `jsonPath`, `runtimeInputKey`, and the schema-documented `security` override.
Export serializes the same memo rather than the stored bytes, so export→import mutates documents.
No verifier drives `toWorkflowProfile` (`verify-workflow-sentinels.mts` exercises the converters
in `WorkflowProfile.ts`, not the page).

- **Evidence after fix:** `verify:workflow-sentinels` grew 20 → 29 checks and now drives the page's real `toWorkflowProfile` (extracted to workflowDocumentMapping.ts): stored description/version/security/runtimeInputs/inputBindings/jsonPath/runtimeInputKey/conditionRules/retryPolicy/failurePolicy all survive a save; new nodes get `{}` bindings; no injected dropdown. Mutations: re-pinned description+version → exit 1; restored 29/29.

---

### AWKIT-MAP-005 — Edge label normalization persists the connector type as an authored label (RT-08 regression)

- **Classification:** Product defect (round-trip fidelity / phantom authored data)
- **Severity:** S3 / `updateEdgeData` writes `linkType` INTO the persisted `data.label` whenever
  the label is empty — directly contradicting the RT-08 contract documented in the same module
  ("an unlabelled connector is not saved as though the user had typed its type as a label").
  Every panel edit of an unlabelled edge fabricates an authored label; saves are not byte-stable.
  `insertNodeOnEdge` additionally hardcodes an authored `"success"` label on the lower half-edge.
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-23 in 5ba4bf7**
- **Owner routing:** Frontend / Flow Designer + Workflow Builder
- **Affected area:** `app/renderer/pages/FlowChartDesigner.tsx:480` (normalization),
  `:859` (hardcoded split label); identical pattern in `app/renderer/pages/ScenarioBuilder.tsx:599`
  persisted at `:2154`; contract `app/renderer/components/workflow/flowProfileMapping.ts:65-69`
  vs persistence `:119`.
- **Fix direction:** keep the render-label fallback display-only; persist `data.label` verbatim.

- **Evidence after fix:** `verify:flow-step-mapping` 158/158 with new source guards: both designer pages keep the fallback display-only (`authoredLabel`), insertNodeOnEdge no longer hardcodes an authored "success" label, and createScenarioEdge persists data.label authored-only; `ScenarioLinkData.label` is optional again.

---

### AWKIT-MAP-004 — The only field-level round-trip verifier tests a mapping module production does not use

- **Classification:** Test-quality issue / duplicated authority
- **Severity:** S2 / Green coverage that proves nothing about shipped code; this is how MAP-002 stayed invisible
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-23 in 5ba4bf7**
- **Owner routing:** QA + Frontend
- **Affected area:** `app/renderer/components/workflow/flowStepMapping.ts` (dead); importer `app/renderer/pages/branchPairs.ts:3`; `scripts/verify-flow-step-mapping.mts:17` (header claims it tests "the REAL production functions")
- **Detected by:** Independent whole-repository code review

`FlowChartDesigner.tsx:45` imports `flowProfileMapping.ts`; `flowStepMapping.ts` is imported only
type-only by `branchPairs.ts` and by the verifier itself. The dead module still carries the
pre-fix shapes `flowProfileMapping` documents as fixed (catalog-gated locator, fabricated
retry/onFailure, rebuilt env/runtimeInput/secret sources from one string, no configOriginal).
Deleting it (or repointing the verifier) removes a resurrect-on-import hazard.

- **Evidence after fix:** `flowStepMapping.ts` deleted (git rm); `verify-flow-step-mapping.mts` and both type-only importers (`branchPairs.ts`, `verify-branch-pairs.mts`) repointed at `flowProfileMapping.ts`. The repoint itself exposed two stale dead-module expectations (multi-key outputs collapse; absent-next mirroring) now corrected to production semantics: 158/158.

---

### AWKIT-MAP-003 — Loop node `customFlow` target flow is never written on save

- **Classification:** Product defect (designer-runtime contract break)
- **Severity:** S2 / A user-configured "run another flow" loop loses its target on save; reload empties the selector and the run gate then blocks with an unfixable error
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-23 in 5ba4bf7**
- **Owner routing:** Frontend / Flow Designer mapping
- **Affected area:** `app/renderer/components/workflow/flowProfileMapping.ts:201,264`; registry `flowNodeRegistry.ts:156-174`; panel `FlowNodePropertiesPanel.tsx:1272-1303`; runtime read `src/runner/StepExecutor.ts:2764-2768`; contract `src/validation/LoopStepContract.ts:140-143`
- **Detected by:** Independent whole-repository code review

`toFlowStep` writes `targetFlowId` only when `inSection("runFlow")` (line 264) and `flowId` only
for `stepType === "runFlow"` (line 201). A `loop` node's sections are `["loop", "execution"]`
(`flowNodeRegistry.ts:158`), so both writes are always `undefined` — yet the properties panel
offers "Custom flow" plus a target-flow select writing `data.targetFlowId`, and the panel validator
demands it (registry line 171). The runner executes customFlow loops exclusively from
`step.config?.targetFlowId`, which save never produces. `RandomConfigurationGenerator.ts:336`
deliberately skips scroll/customFlow loops, so the random round-trip gate cannot see this path.

- **Evidence after fix:** `verify:flow-step-mapping` 158/158 with a new customFlow-loop section (config.targetFlowId persists, second-cycle stable, panel validator accepts; click loop gains none); reverting the section gate to runFlow-only failed exactly 3 checks. Random corpus now generates customFlow loops (`test:random:roundtrip` 27/27).

---

### AWKIT-MAP-002 — Flow Designer authors `completionMode` but the production mapping never persists it

- **Classification:** Product defect (round-trip loss)
- **Severity:** S2 / Any step saved with a non-default async completion mode silently reverts to `allRequired`; existing flows lose the field the first time they are opened and re-saved in the designer
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-23 in 5ba4bf7**
- **Owner routing:** Frontend / Flow Designer mapping
- **Affected area:** `app/renderer/components/workflow/flowProfileMapping.ts` (`toFlowStep`/`fromFlowStep`); authoring surface `FlowNodePropertiesPanel.tsx:950-963`; consumer `src/runner/StepExecutor.ts:680`
- **Detected by:** Independent whole-repository code review

`FlowNodePropertiesPanel` authors `data.completionMode` (Any required / networkThenUi /
quietPeriod), `flowDesignerTypes.ts:121` declares it "carried through round-trip", and the runner
reads `step.completionMode ?? "allRequired"` — but neither direction of `flowProfileMapping.ts`
mentions `completionMode`. The dead twin module `flowStepMapping.ts:81,223` DOES map it, evidence
it was lost when the mapping was extracted.

**Coverage gap:** `verify-flow-step-mapping.mts:216-273` asserts completionMode round-trips —
against `flowStepMapping.ts`, which production does not import (see AWKIT-MAP-004 below). The
random-roundtrip corpus never emits the field. All three gates are blind to this loss.

- **Evidence after fix:** `verify:flow-step-mapping` (repointed at production per AWKIT-MAP-004) 158/158 incl. the four completionMode round-trip checks and absence-preservation; mutation re-dropping `completionMode: data.completionMode` failed exactly 9 checks; restored 158/158.

---

### AWKIT-REC-003 — Recorder embedded the site URL instead of the login URL in Auto Secure Login

- **Classification:** Product defect
- **Severity:** S2 / Replay of an IdP-redirect recording spawned a redundant manual-login browser
  instead of reusing the captured session
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-22; found by the executed live REC-022 walkthrough**
- **Owner routing:** Recorder handoff lifecycle
- **Affected area:** `src/recorder/RecorderService.ts` (`captureSessionAndResume` →
  `insertSecureSessionNodes`)
- **Detected by:** The authorized live IdP walkthrough: replaying the saved workflow launched a NEW
  real-Chrome manual capture (`session-a2b9c0c8`) instead of skipping to reuse of the captured
  `session-f11ab5c3`

`insertSecureSessionNodes` was called with `resumeUrl` — the site being recorded (youtube.com) —
but at replay time `executeAutoSecureLogin` reuses sessions by ORIGIN match, and protected logins
happen on a DIFFERENT origin (accounts.google.com). The node therefore never matched the captured
session. The recorder now inserts the detected/login URL (`handoff.detectedUrl || profile.loginUrl
|| profile.targetUrl`), while resume navigation still returns to the original site.

**Evidence:** `verify:protected-login-recorder` grew to **73/73** with a new assertion that the
inserted node carries the LOGIN url; reverting the fix failed exactly that assertion at **72/73**
(the failure detail reproduced the live defect shape). Restored green 73/73.

---

### AWKIT-REC-002 — Session-profile store lost writes to Windows file contention

- **Classification:** Product defect
- **Severity:** S2 / A saved session profile could silently vanish from the registry
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-22 in `b16812a`; Bead `awkit-cey` remains open on the live IdP gate**
- **Owner routing:** Recorder / session persistence
- **Affected area:** `src/session/SessionCaptureService.ts`, new `src/session/atomicWrite.ts`
- **Detected by:** REC-022 contract inspection (no verifier exercised the store at all)

`writeProfiles` was a plain `writeFile`: a torn write (crash mid-write) or transient Windows
contention (`EPERM`/`EBUSY` from antivirus or a browser still releasing the directory) could
destroy or fail the `session-profiles.json` update, and unsynchronized read-modify-write cycles
(a rename racing the capture-exit handler) could drop one mutation entirely. Writes now go through
a temp-file + rename atomic write with bounded `EPERM`/`EBUSY` retry, and every metadata mutation
is serialized through an operation chain.

**Evidence:** `verify:recorder-draft` extended 50/50 → 83/83 → **86/86** (exit 0): real-file round
trips (rename/markUsed survive close/reload), corrupt and missing metadata recover safely, unknown
compatible fields survive losslessly, concurrent rename+markUsed both land, injected-seam retry
proofs (EBUSY retried then succeeds; exhausted retries throw; non-retryable codes fail fast), no
temp residue. Forcing single-attempt writes crashed the retry probe with a fatal EBUSY; restoring
the retry returned the suite to green.

**Post-fix evidence repair (2026-08-22):** independent QC found the concurrent rename+markUsed
guard — the sole guard for the `enqueue` serialization half of this fix — had a conjunct satisfied
by state written earlier in the same block. It now seeds a known-stale `lastUsedAt`, asserts that
precondition, asserts the value actually CHANGED, and adds the reverse interleaving. Replacing
`enqueue` with a pass-through kills the repaired check **40/40**; the old form was blind
**21/40** (18/20 in the markUsed-first ordering it never exercised). Control on correct code:
**20/20**. The mutant was injected at runtime against the real product objects, not by editing
product source (the write lease forbade `src/**`), so this is equivalent in discriminating power
but is not a literal file-edit mutant.

---

### AWKIT-REC-001 — Cancelling a protected-login handoff discarded the pre-login draft

- **Classification:** Product defect
- **Severity:** S2 / A user-aborted handoff destroyed already-recorded work
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-22 in `1e85946`; Bead `awkit-cey` remains open on the live IdP gate**
- **Owner routing:** Recorder handoff lifecycle
- **Affected area:** `src/recorder/RecorderService.ts` (`cancelSecureHandoff`)
- **Detected by:** REC-022 contract AC-1 inspection

`cancelSecureHandoff` called `discardDraft()`, so cancelling out of a protected-login handoff —
including after the user had already completed a manual login in Chrome — deleted the actions
recorded before the pause. The cancel path now flushes and preserves the draft (disk + memory);
discarding remains owned by full-recording Cancel (`cancelRecording`) and the save path.

**Evidence:** `verify:recorder-draft` REC-022 section, now **86/86** (exit 0): draft survives cancel
in both `capturingSession` and `detected` phases, stays intact on restart, and explicit discard
still deletes it. Re-adding `discardDraft()` failed exactly those five assertions (**78/83** at the
then-current count); the fix restored the suite to green.

**Post-fix evidence repair (2026-08-22):** independent QC found the "delete removes the profile
directory" assertion in the same file was true **by absence** — the fixture never created the
directory it claimed to observe being removed. The fixture now really creates `Default/Preferences`
and an existence assertion runs immediately before `deleteProfile`. Preventing the real
`deleteProfile` from removing the directory makes the repaired check FAIL where the old form
PASSED; deterministic. Mutant injected at runtime against the real product objects, not by editing
product source.

**Residual, not fixed:** removing `discardDraft()` from this path also removed the only site that
nulled `ambiguityState`/`ambiguityPage` on handoff cancel — tracked as open **AWKIT-REC-036** above.

---

### AWKIT-MAP-001 (`awkit-rvb`) — Designer no-op save fabricated clickAndHold configuration

- **Classification:** Product defect
- **Severity:** S2 / A semantically unchanged Designer round trip altered persisted flow data
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-22 in `8d7c7b9`; Bead closed**
- **Owner routing:** Frontend / Flow Designer mapping
- **Affected area:** `app/renderer/components/workflow/flowDesignerTypes.ts`,
  `app/renderer/components/workflow/flowProfileMapping.ts`
- **Detected by:** deterministic random round-trip plus focused click-and-hold verification

`fromFlowStep` converted a missing `clickAndHold.config` into `{ holdMs: 1000 }`, so the Designer
could not distinguish absence from an explicit default. The mapping now tracks whether `holdMs` was
actually configured: no-op saves preserve absence, explicit durations survive, imported unknown
keys survive, and known fields irrelevant to the selected subtype are filtered.

**Evidence:** `verify:click-and-hold` **35/35**; random round-trip **27/27**, JSON **54/54**, **0
diffs**. Reintroducing default fabrication failed click-and-hold **32/35** (absence, unknown-only,
and irrelevant-known-field cases) and round-trip **25/27** with 5 raw diffs of one fabricated
`nodes[].config` shape; restoration returned all gates to green.

---

### AWKIT-VAL-001 (`awkit-rvo`) — Random missing-required-value oracle mutated the wrong channels

- **Classification:** Validation-harness defect; no product-runtime defect
- **Severity:** S2 / A red oracle obscured whether generated mutations exercised required values
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-22 in `8c02726`; Bead closed**
- **Owner routing:** QA / random verification harness
- **Affected area:** `src/testing/random/RandomMutator.ts`, `scripts/verify-random-oracle.mts`
- **Detected by:** `test:random:oracle` required-value application accounting

The generic mutator cleared flat top-level selector/value fields even when a subtype's required
runtime channel was assertion `config.expectedValue`, fixed-loop `iterationCount`, time-wait
`timeoutMs`, or page-scroll `scrollAmount`. It now targets the exact subtype channel and excludes
optional or already-invalid shapes.

**Evidence:** random oracle **33/33** with **54/54** applications. A flat-selector mutant failed
**32/33**; the focused exact-target/channel proof failed `generic-goto`, `assert-config`,
`wait-time`, `scroll-page`, `loop-fixed`, and `run-flow`. Restoration returned **33/33** and
**54/54**.

---

### AWKIT-VAL-002 (`awkit-rvt`) — Script verifiers executed green while their static baseline was red

- **Classification:** Validation-harness/type-contract defect; no product-runtime defect
- **Severity:** S2 / Nine static diagnostics created false confidence in verifier maintenance
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-22 in `8c02726`; Bead closed**
- **Owner routing:** QA for verifier sources; project-state for roadmap declaration sidecars
- **Affected area:** `scripts/verify-assertion-validation.mts`,
  `scripts/verify-loop-scroll-validation.mts`, `scripts/verify-validation.mts`,
  `tools/roadmap/lib/license-issuer.d.mts`, `tools/roadmap/server.d.mts`
- **Detected by:** `npm run typecheck:scripts`

The nine diagnostics across five consumers were caused by four incomplete `FlowStep` negative-test
casts, two real `.mjs` modules without same-basename declarations, a duplicate `readFileSync`
import, and the non-canonical `unknownStepType` expectation (known steps with unsupported config use
`unsupportedConfiguration`). Repairs use precise shapes and declarations; no `any`, suppression,
unsafe double-cast, broad `allowJs`, or exclusion was introduced.

**Evidence:** script typecheck **0 diagnostics**; assertion **77/77**; loop-scroll **88/88**;
validation **163/163**. Removing the declared `buildIssuePayload` export failed typecheck with exit
1 / TS2305. Changing the constructed dblclick/contextMenu step types to raw `teleport` failed
validation **161/163** because the corrected canonical `unsupportedConfiguration` negative checks
no longer received known step types; exact restoration returned both gates to green.

---

### AWKIT-LIC-001 (`awkit-f3l`) — Repeat bypass and queue dispatch could outrun license enforcement

- **Severity:** S1 / Work could begin after an integrity-blocking license transition
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-01**
- **Affected area:** `app/main/licensing`, licensing/execution IPC, `src/runner/ExecutionEngine.ts`
- **Detected by:** source-level licensing enforcement audit while closing `awkit-f3l`

`execution:repeatInstance` called `runInstance` directly without any license gate, and the normal
queue consulted licensing only at the original IPC run request. Revalidation discarded
`activeRunDisposition`, renderer permissions controlled the only timer/focus trigger, and queued work
could continue promoting after a one-shot sweep.

**Resolution:** a main-process watcher and synchronous enforcement latch now own all revalidation and
pending sweeps. The runner receives one named dispatch gate, checks it before promotion, immediately
before the running transition (releasing both browser slot and resource claims on refusal), and before
repeat. Gate faults fail closed; valid recovery clears the latch immediately. `verify:licensing` is
167/167 and `verify:license-dispatch-gate` exercises the real queue plus the repeat/fault/wiring
negative controls.

---

### AWKIT-REC-030 — Recorder saves an interactive step it knows cannot replay, with no resolution path

- **Severity:** S2 / A recorded flow predictably fails at replay and the user is given no supported
  way to fix it (recording-to-execution reliability gap)
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-01.** Epic `awkit-aui`
  (children `awkit-aui.1`…`.6`, `.8`); plan
  `docs/recorder-ambiguity-resolution-plan.md`
- **Affected area:** `src/recorder/recorderInitScript.ts`, `src/recorder/buildRecordedFlow.ts`,
  `src/validation/FlowValidator.ts`, `src/runner/StepExecutor.ts`, `src/runner/LocatorFactory.ts`,
  `app/main/ipc/{recorder,execution,validation}.ipc.ts`, `app/renderer/pages/Recorder.tsx`
- **Detected by:** live `youtube.com → Shorts → scroll button` record→save→replay probe (session
  diagnostic, not a committed verifier)
- **Evidence:** the probe recorded `Click Shorts` as `role=link "Shorts"` with
  `quality.isUnique=false, matchCount=2`; the flow **saved clean** (no preflight error) and then
  **failed at replay** with `LocatorFactory` "…the saved locator matches 2 elements". The scroll
  button (`role=button "Next video"`) recorded uniquely, proving the gap is the *resolution workflow*,
  not the locator engine.

The safety mechanisms work as designed — the Recorder correctly detected the ambiguity
(`isUnique:false`), preserved the metadata instead of guessing, and `StepExecutor`/`LocatorFactory`
refused to act on a multi-match locator (`src/runner/StepExecutor.ts:397-428`,
`src/runner/LocatorFactory.ts:265`). **But the ambiguity is enforced runtime-only** — there is no
preflight rule (`FlowValidator` only has `missingRequiredLocator`,
`src/validation/FlowValidator.ts:114`), so a known-unrunnable flow saves and is only rejected *after*
the browser launches. And there is **no ambiguity-resolution UX**: the recorder discards the
interaction context (`composedPath()`, coordinates, which candidate was clicked —
`src/recorder/recorderInitScript.ts:1098-1113`) that could disambiguate, and offers the user no way
to pick a candidate, scope to a stable ancestor, or explicitly approve a positional fallback.

**Not summarised as an overall Recorder pass:** ambiguity detection and strict-mode protection
working does not make the feature complete. See the plan's corrected classification
(Recorded-flow replayability = FAIL; Ambiguous-locator recovery UX = NOT IMPLEMENTED).

**Current correction (2026-08-01):** the runtime-only/no-context description above is the original
defect evidence, not current behavior. The resolution model, preflight gate, evidence persistence,
stable ancestor/context scoping, hover prerequisite, and acceptance regression have since landed.
Increment 6 (`awkit-aui.6`) adds actual `composedPath()` inner-target capture, bounded open-root match
counting, ordered stable host scoping, nested/dynamic/slotted replay, known-closed-root review-required
preflight, and an honest unsupported cross-origin-frame guard. `verify:recorder` is 171/171 and
`verify:recorder-ambiguity` is 62/62. Increments 3 and 4 now add live-validated Recorder review,
reasoned exact fallback binding, edit invalidation/revocation, report disclosure, and real GUI/
persistence/runner negative controls. All seven epic increments are closed; the full gate set is green.

---

### AWKIT-REC-033 (`awkit-aui.3.1`) — Recorder ambiguity review can resolve unvalidated or unreachable choices

- **Severity:** S2 / The visible review surface can claim success without proving the saved locator
  identifies one live target, while the normal positional-capture path bypasses review entirely
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-01**
- **Affected area:** `src/recorder/RecorderService.ts`, `src/recorder/RecorderTypes.ts`,
  `app/main/ipc/recorder.ipc.ts`, `app/main/preload.ts`, `app/renderer/pages/Recorder.tsx`,
  `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx`, Recorder GUI verification
- **Detected by:** Increment 3 code/test/GUI reconciliation (`awkit-aui.3`)

Commit `6421315` added a panel, but `RecorderService` pauses only for
`quality.isUnique === false`. The production capture engine normally ends with a unique structural
positional fallback, so that fragile capture bypasses the panel and is later refused by
`StepExecutor`. When the panel is reached, `selectCandidate` and `scopeToAncestor` stamp
`resolution: "resolved"` even when the candidate/index/landmark is absent and without a live
uniqueness check. Highlighting translates semantic locators into guessed document CSS, which does
not represent role/name, frame, or Shadow DOM context. The Flow Designer exposes recorder quality
as text but has no persisted resolution/revocation action. No real-Electron verifier exercises the
panel, so the existing green gates do not prove the user workflow.

**Resolution:** real positional/unresolved capture now pauses before commit. Candidate selection and
captured scope are validated through `LocatorFactory` against the authorized page plus frame/shadow/
container context; invalid choices fail, cancel discards, and defer remains blocking. The modal is
focus-contained and exposes evidence, alternatives, context, and execution consequences. Recorder GUI
166/166, Flow Designer 69/69, ambiguity 62/62, authz 50/50, and E2E 61/61 are green.

---

### AWKIT-REC-034 (`awkit-aui.4.1`) — Positional fallback approval is not bound to the approved locator

- **Severity:** S1 / A stale approval can authorize a materially different locator or context
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-01**
- **Affected area:** `src/profiles/FlowProfile.ts`, `src/recorder/RecorderService.ts`,
  `src/validation/FlowValidator.ts`, `src/runner/StepExecutor.ts`, `src/runner/LocatorFactory.ts`,
  Flow Designer mappings/properties, reports and Recorder verifiers
- **Detected by:** Increment 4 policy/lifecycle reconciliation (`awkit-aui.4`)

The current approval is only the enum value `resolution: "user-approved-fallback"`.
`approvedFallbackReason` is optional and the Recorder does not set it. No fingerprint binds the
approval to strategy, value/index, exact/name, container/frame/shadow context, or action type.
Flow Designer locator edits clear quality only, leaving the approval enum intact, and
`StepExecutor` authorizes based on that enum alone. Existing tests construct approval metadata
directly; they do not prove real approval, edit invalidation, revocation, reload, or report output.

**Resolution:** approval now requires a specific reason and `approvedFallbackBinding` over step
type/name, exact primary locator, frame/shadow/container context, and safety policy. Static validation
and execution reject missing/stale binding; Flow Designer edits invalidate authority and offers explicit
revocation; sensitive actions stay absolutely blocked. Mapping 111/111, profile store 18/18, ambiguity
62/62 (including report/history disclosure and future-field clone controls), Recorder GUI 166/166, and
Flow Designer 69/69 are green.

---

No product defect remains open in this campaign section. The separate tracked hover limitations
`awkit-vot` / `awkit-0vm` remain outside this closure; manifest audit `awkit-hj8` is closed.

### AWKIT-REC-031 — Recorder's hover step targeted the hidden revealed surface, so hover-gated flows failed replay

- **Severity:** S2 / A recorded hover-gated flow predictably fails at replay (Increment 5 acceptance
  gap under `AWKIT-REC-030` / epic `awkit-aui`, child `awkit-aui.5`)
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-01**
- **Affected area:** `src/recorder/recorderInitScript.ts`, `src/recorder/buildRecordedFlow.ts`,
  `src/recorder/RecorderTypes.ts`, `mock-site/public/recorder-lab.html`,
  `scripts/verify-recorder-hover.mts`, `package.json`
- **Detected by:** fresh-page replay probe (record → `buildRecordedFlow` → replay the built
  `hover`/`click` steps through the real `LocatorFactory`), 2026-08-01 re-review
- **Evidence before fix:** the generated hover step was `css [data-testid="hover-menu"] div`, resolving
  to the hidden `.hover-dropdown` (the surface the hover *reveals*, `display:none` at rest). Replaying
  it on a fresh page: `locator.hover: Timeout 4000ms exceeded`; the button never became visible and the
  subsequent click also timed out — **replay FAILED**. Root cause: trigger selection fell back to
  `composedPath()[1]` (the immediate parent = the revealed surface), and a class heuristic
  `/(^|\s)(menu|dropdown|popover|tooltip)(\s|$)/i` never matched hyphenated class names. The verifier
  stayed green only because it asserted `value.includes("hover-menu")` and never replayed.
- **Evidence after fix:** `verify:recorder-hover` **48/48** (expanded by AWKIT-REC-035) — records the hover-gated click, builds the
  flow, and **replays Hover→Click successfully on two fresh pages** (post-click state `hover-click-ok`);
  asserts the hover locator resolves to `data-testid=hover-trigger` (never the revealed surface); proves
  the old hidden-surface locator still **fails** to replay (regression guard); and covers the negatives
  (async self-reveal → no hover step; no-stable-trigger → `needs-review`; one hover step per click; fast
  hover-and-click still detected). The standalone replay probe now **SUCCEEDS** (previously FAILED).

The fix attributes the reveal to the element the pointer actually hovered — a trusted pointer trail plus
record-time first-seen (rest) visibility for interactive elements and their ancestors — then walks the
click target's `composedPath()`, skips the hidden-at-rest revealed surface, and selects the first
visible-at-rest, on-pointer-path, specific, uniquely-resolvable ancestor. When no stable trigger can be
attributed the click is left `needs-review` instead of fabricating an unreplayable hover step.

---

### AWKIT-REC-035 (`awkit-3vh`) — Hover trigger capture persists a wrapper instead of its actionable owner

- **Severity:** S2 / The generated prerequisite can require positional approval or fail replay even
  though a stable semantic action owner is present directly above the selected wrapper
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-08-02**
- **Affected area:** `src/recorder/recorderInitScript.ts`, `mock-site/public/recorder-lab.html`,
  `scripts/verify-recorder-hover.mts`
- **Evidence before fix:** the action-owner Recorder Lab case persisted
  `css=[data-testid="duplicate-controls"] div:nth-of-type(8)` as its hover prerequisite. It resolved
  to the unlabelled wrapper, was classified as positional by `StepExecutor`, failed the hover action,
  left the gated target hidden, and caused the click to time out. The inherited verifier reproduced
  **41 PASS / 7 FAIL**.
- **Root cause:** `resolveHoverTrigger` chose by visibility topology and never applied
  `interactiveTarget`; its uniqueness gate also allowed positional generation. A scoped
  `:nth-of-type` selector could therefore look unique/medium-confidence while still being a fragile
  positional locator that the runner correctly refuses.
- **Evidence after fix:** the trigger is promoted to the `role=tab` owner named
  `Open shorts actions`; positional generation is disabled for hover prerequisites; fresh-page
  `LocatorFactory` resolution identifies that exact owner; real Hover→Click replay exposes and clicks
  the target. A no-owner fixture proves positional-only evidence remains `needs-review` with no
  fabricated hover step. `verify:recorder-hover` **48/48**, Recorder **171/171**, ambiguity **62/62**,
  and Mock Site **110/110** pass.

The separate sibling/self-toggle (`awkit-vot`) and hover-inserted-control (`awkit-0vm`) limitations
remain open; this fix deliberately does not infer either trigger class.

---

### AWKIT-REC-032 (`awkit-bw9`) — Table-row container name captured without cell spacing fails replay

- **Severity:** S2 / A recorded flow scoped to a table row predictably fails at replay (Increment 2
  capture defect under `AWKIT-REC-030` / epic `awkit-aui`, child `awkit-aui.2`)
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-08-01**
- **Affected area:** `src/recorder/recorderInitScript.ts` (`detectContainer` tableRow branch)
- **Detected by:** building `verify:recorder-ambiguity` (`awkit-aui.8`), 2026-08-01
- **Evidence before fix:** clicking a duplicate customer-table `Edit` button recorded a container
  context `{type:tableRow, strategy:role, value:row, name:"Customer BetaEdit", exact:false}`. On replay
  `LocatorFactory` builds `getByRole('row',{name:'Customer BetaEdit'})`; the row's platform accessible
  name is the space-joined `"Customer Beta Edit"`, so the no-space name is not a substring match — the
  container never resolves and `locator.click` times out. Root cause: the row name came from
  `norm(row.textContent)`, which concatenates adjacent cells with no separator.
- **Evidence after fix:** `verify:recorder` **135/135** incl. CR6 — captures the row click, saves/
  reloads (JSON), and **replays on a fresh page** selecting the intended row; covers whitespace/newline
  normalization, partial-overlap row names, and ARIA `role=row`/`role=cell` markup; the **old no-space
  name is a failing negative control**. `verify:recorder-ambiguity` **[3b]** replays the live
  recorder-lab customer-table row. Fix: `rowAccessibleName` joins the row's direct-child cells
  (`td/th/[role=cell]/[role=gridcell]/[role=columnheader]/[role=rowheader]`) with a space (ARIA
  name-from-content), normalizing repeated whitespace. Card `hasText` scoping matches `textContent`
  against `textContent` and was already self-consistent, so it was deliberately left unchanged.

---

### AWKIT-SET-006 — "Screenshot on failure" was a control that did nothing

- **Severity:** S3 / An enabled control with no effect (RULES.md: no fake/no-op controls)
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-07-27**
- **Affected area:** `app/renderer/pages/InstanceMonitor.tsx`, `app/main/ipc/execution.ipc.ts`,
  `src/instances/{InstanceConfig,InstanceManager}.ts`, `src/runner/ExecutionEngine.ts`
- **Detected by:** `SET-009` — "the runner honors the selected flags"
- **Evidence before fix:** `test-artifacts/settings-runner-behaviour/2026-07-27T13-02-*/` — ON/OFF/ON
  produced **4 / 4 / 4** failure-evidence bundles; the setting changed nothing
- **Evidence after fix:** `test-artifacts/settings-runner-behaviour/2026-07-27T13-05-*/`
  (**11 PASS / 0 FAIL**) — ON/OFF/ON produces **4 / 0 / 4**

Settings › Execution Defaults offered "Screenshot on failure", every workflow run card offered its own
toggle, both persisted — and neither reached a run. `runWorkflowFromCard` sent `headless`,
`totalInstances`, `maxConcurrentInstances`, `isolationMode` and `stopOnError`; `RunWorkflowRequest` had
no field for it at all. The runner's default came from `resolveArtifactSettings()`, and **all four
artifact profiles hardcode `screenshotOnFailure: true`**, so failure evidence was captured
unconditionally no matter what the user chose. The only control that ever worked was the per-step
`onFailure.screenshot` in the Flow Designer.

Fixed by carrying the run-level choice the same way certificate trust already travels: a new optional
`RunWorkflowRequest.screenshotOnFailure` → the instance template → `InstanceConfig` → the engine, where
it takes precedence over the artifact-profile default. Per-step `onFailure.screenshot` still wins over
both, and an omitted field still means "artifact-profile default", so no existing caller changes
behaviour.

**Two measurement traps on the way to this, both worth keeping.** The first version of the check
polled `executions.list()` for "some terminal instance" — which a *previous* run's finished instance
satisfies instantly, so it sampled the artifact directory before the run under test had written
anything and reported the defect as **fixed**. It now waits for a NEW `executionId` and for every
instance of that execution to end. And a single ON→OFF pair cannot separate "the setting works" from
"the second run writes nothing for an unrelated reason", so the suite runs **ON → OFF → ON**; the
4/0/4 shape is what makes the difference attributable to the setting.

### AWKIT-REP-008 — backpressure never cleared; an idle app reported itself throttled forever

- **Severity:** S3 / A live gauge reports a state the system is not in
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-07-27**
- **Affected area:** `src/runner/concurrency/BackpressureController.ts`
- **Detected by:** `SYS-REP-011` — the *release* half of "backpressure appears **and clears**"
- **Evidence before fix:** `test-artifacts/reports-live-engine/2026-07-27T12-10-*/execution-results.json`
  (**19 PASS / 2 FAIL**) — `dispatchBlocked:true, blockedReason:"active flow limit reached (1/1)",
  activeFlows:0` recorded 45 s after every instance had ended
- **Evidence after fix:** `test-artifacts/reports-live-engine/2026-07-27T12-15-*/execution-results.json`
  (**21 PASS / 0 FAIL**)

`CapacitySnapshot.dispatchBlocked` was `lastBlockedReason !== undefined`, and `lastBlockedReason` was
cleared **only** by a later *successful* `admit()`. The dispatch loop stops calling `admit()` once its
run ends, so a run that finished or was cancelled while blocked left the last refusal in place
permanently. With zero active flows the app went on reporting **"Dispatch is currently throttled by
backpressure — active flow limit reached (1/1)"**.

This is not one page: `ReportsChrome` renders the notice, `telemetry:server` returns
`backpressureBlocked: true`, `StatusBar` shows a throttled indicator and `InstanceMonitor` shows the
reason — all from the same stale field. An operator investigating why nothing was dispatching would
have been sent after a limit that was no longer binding.

Fixed by making the refusal **decay**: `block()` timestamps itself and the snapshot reports a block
only while it is still current (5 s; the dispatch loop re-asks about every 500 ms, so a genuine block
re-stamps itself continuously, while one nobody renews lapses). A self-healing rule was chosen over
"clear it on the way out" deliberately — the latter has to be remembered by every present and future
exit path, and this defect exists precisely because one of them did not.

**Guarded, not just fixed:** `verify:concurrency` gained three checks driven by an injected clock —
a fresh refusal reports blocked, it stays current while dispatch is still being attempted, and one
nobody renewed decays. 78 → **81 PASS / 0 FAIL**.

### AWKIT-REP-006 — Failure Analytics had no evidence

- **Severity:** S3 / The page cannot support the conclusions it presents
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-07-27**
- **Affected area:** `src/reports/TelemetryContracts.ts`, `src/runner/store/SqliteRuntimeStore.ts`,
  `app/renderer/pages/ReportsFailures.tsx`
- **Detected by:** `SYS-REP-009`
- **Evidence after fix:** `test-artifacts/reports-populated-gui/2026-07-27T10-52-*/execution-results.json`
  (**158 PASS / 0 FAIL**)

The page is described as "evidence-based insights". `FailureBreakdown` was
`{total, categories, topWorkflows}` — there was no evidence in it. An operator could read that 12
runs failed with timeouts and had no way to reach *which* runs, so the aggregate could neither be
acted on nor checked. `queryFailures` already had the filtered failed runs in hand and threw them
away.

Fixed by returning `recent` from the same already-filtered rows the aggregates are computed from, so
the evidence cannot disagree with the counts beside it, and rendering it as a table that opens the
existing `RunDetailDrawer`.

**The check that should have caught this had never tested anything.** "Only failed runs appear in the
failure evidence list" read `failures.recent` — a field the contract did not have — so it evaluated
`undefined ?? []` and then passed on its own `length === 0 ||` escape hatch. Same shape as the
vacuous ternary in `AWKIT-REP-007` below. Both are now real checks.

**Redaction is structural, not filtered.** The evidence row carries identity, workflow, category and
timings only; no free-text error message crosses the boundary. Asserted by inspecting the row's own
**keys**, so adding a message field later fails the check instead of silently shipping.

### AWKIT-REP-007 — Storage sizes were silently truncated

- **Severity:** S3 / Misleading operational figure
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-07-27**
- **Affected area:** `app/main/ipc/telemetry.ipc.ts` (`dirSizeMb`),
  `app/renderer/pages/ReportsServer.tsx`, `src/reports/TelemetryContracts.ts`
- **Detected by:** `SYS-REP-012`

`dirSizeMb` stops after 20,000 entries. The bound was documented in the source and correct as a
bound — what was missing was any way for the result to say so. A folder above that size reported a
number that read as a total, so an operator deciding whether to clean up saw a small figure and
concluded there was nothing to clean. Same class as `AWKIT-SET-005`, where a read-only folder was
labelled writable: a wrong figure is worse than no figure.

`StorageUsage.truncated` now reports it, and the page renders **"at least N MB"** plus an explicit
note. Exercised with a real 20,001-entry directory (asserted as a precondition) and controlled by a
completed walk reporting `truncated === false`.

The oversized directory is created in the OS temp dir and removed in a `finally`: the suite's profile
lives under `test-artifacts/`, which is inside the user's OneDrive, and 20,000 files there would be
pushed into cloud sync.

### AWKIT-REC-007 — The Recorder never noticed its browser dying

- **Severity:** S2 / Operator stranded in a session that no longer exists
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-07-27**
- **Affected area:** `src/recorder/RecorderService.ts` (`attachLivenessWatch`, `startRecording`,
  `resumeAfterHandoff`)
- **Detected by:** `REC-024`
- **Evidence before fix:** `test-artifacts/recorder-gui/2026-07-27T09-32-38-378Z/execution-results.json`
- **Evidence after fix:** `test-artifacts/recorder-gui/2026-07-27T09-54-10-088Z/execution-results.json`
  (**152 PASS / 0 FAIL / 0 NOT RUN**)

**Reproduction before fix**

1. Start a recording and let it capture at least one action.
2. Kill the recorded browser out of band — crash its renderer, close its window, or terminate the
   process. Do **not** use Stop or Cancel.
3. `recorder.getStatus()` keeps returning `{"isRecording": true}` indefinitely.

`RecorderService` registered a `close` listener for **popups** and nothing at all for the main page,
the browser, or the context. `getStatus()` returns the raw `isRecording` flag with no liveness check,
and the Recorder page polls it on an interval — so the UI kept showing **Recording** and kept Start,
the Target URL field and both capture switches disabled. The operator was stranded in a session whose
browser no longer existed, with Cancel as the only way out.

**Fix**

`attachLivenessWatch` wires four signals, because none implies the others:

- `page.close` — the recorded tab went away while the browser lives.
- `page.crash` — **measured**: a renderer crash leaves `page.isClosed() === false` and fires neither
  `close` nor `disconnected`. Without this the recorder stays stuck behind a crashed tab, which is
  the case's own wording ("browser closes **or crashes**").
- `browser.disconnected` — a normal launch dying or being killed.
- `context.close` — the persistent-context resume path, where `this.browser` is deliberately `null`.

It fires only on an **unexpected** death: every supported teardown sets `isRecording = false` before
closing anything, and a handle belonging to an already-replaced session is ignored, so the handoff
resume path cannot be killed by its predecessor's listeners.

The recorded actions and the draft are **preserved** — that is the whole difference between this path
and `cancelRecording`. An unexpected death must not destroy what the user recorded.

### AWKIT-REC-004 — The async review dialog declared `aria-modal` and implemented none of it

- **Severity:** S2 / Keyboard and assistive-technology user is stranded
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-07-27**
- **Affected area:** `app/renderer/pages/Recorder.tsx` (async activity review dialog)
- **Detected by:** `REC-013`, `REC-029`
- **Evidence before fix:** `test-artifacts/recorder-gui/2026-07-27T08-51-42-761Z/execution-results.json`
  (**74 PASS / 6 FAIL**)
- **Evidence after fix:** `test-artifacts/recorder-gui/2026-07-27T09-08-59-961Z/execution-results.json`
  (**128 PASS / 0 FAIL / 0 NOT RUN**)

**Reproduction before fix**

1. Record on `/recorder-lab?rec013=1` with Smart Wait capture ON and waiting-time capture OFF, so the
   quiet gap produces a review-worthy `fixedDelay`.
2. Press **Save to Flow Library**. The review dialog opens.
3. Focus never moves into it — `activeElement` is still the Save button that opened it.
4. Press `Tab`. Focus walks into the page *behind* the dialog:
   `INPUT(ESCAPED) → BUTTON(ESCAPED) → BUTTON(ESCAPED) → …`
5. Press `Escape`. Nothing happens; the dialog stays open.

The dialog rendered `role="dialog" aria-modal="true"`, which tells assistive technology that
everything behind it is **inert** — so a screen-reader user tabbing out of it lands in content their
reader has been told does not exist, with no way back and no way to dismiss without a pointer.

**This is the third surface with this exact defect.** `AWKIT-SET-004` fixed `ConfirmDialog`;
`AWKIT-REP-004` then found it again in `RunDetailDrawer`. Each has its own markup, so each time the
fix had been applied to a *component* rather than to the *concept*. This dialog is inline markup in
`Recorder.tsx` and inherited nothing.

**Fix**

The same contract the other two already implement, scoped to `reviewOpen`: capture the previously
focused element, move focus to the first focusable control, trap `Tab`/`Shift+Tab` in both
directions, dismiss on `Escape`, and restore focus on unmount. `Escape` routes to `setReviewOpen(false)`
— the **"Keep editing"** semantic, never Confirm — because the entire purpose of this dialog is that
saving is a deliberate act.

**Why the checks are phrased as containment**

Focus assertions test `dialog.contains(document.activeElement)`, not label text. When focus is lost
`activeElement` falls back to `<body>`, whose `textContent` contains every button label on the page —
which is exactly how the equivalent Reports check once passed *while the defect was present*.

### AWKIT-REC-005 — The Recorder status readout changed silently

- **Severity:** S3 / Information gap for assistive technology
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-07-27**
- **Affected area:** `app/renderer/pages/Recorder.tsx` (status pill, transient status message)
- **Detected by:** `REC-029`
- **Evidence after fix:** `test-artifacts/recorder-gui/2026-07-27T09-08-59-961Z/execution-results.json`

The status pill is the page's primary state readout — `Idle` / `Recording` / `Ready to save` /
`Manual handoff` — and it sat in no live region. Starting a recording, stopping one, or pausing for a
protected-login handoff was conveyed only by a colour and a word that changed on screen. The action
timeline was already `aria-live="polite"`, so *actions* were announced while the *state* was not.

Both the pill and the transient status message are now `role="status"` (polite + atomic). The check
asserts the announcement's **text** reaches a live region — `"Manual handoff"` is observed during the
handoff pause — so an unrelated live region elsewhere on the page cannot satisfy it, and the check
does not hard-code which element is allowed to do the announcing.

### AWKIT-REC-006 — The recorded-URL search box had no accessible name

- **Severity:** S3 / Unlabelled control
- **Priority recommendation:** P3
- **Status:** **Resolved 2026-07-27**
- **Affected area:** `app/renderer/pages/Recorder.tsx` (Recorded URLs search)
- **Detected by:** `REC-029`

The input carried a `placeholder` and nothing else. A placeholder is not an accessible name: it is
not reliably announced as one, and it disappears the moment the user types. Fixed with an
`aria-label`.

**Same pattern elsewhere, deliberately not changed here.** All four `table-search` inputs in the
renderer share this shape — `DataSourceEditor.tsx`, `SessionsManager.tsx` and the shared
`components/table/TableUI.tsx` are the other three. Only the Recorder one is in scope for `REC-029`
and covered by a verifier; the rest are recorded in `KNOWN_ISSUES.md` rather than changed untested.

### AWKIT-E2E-001 — Flow-level `manualApproval` connector is silently ignored

- **Severity:** S2 / Major
- **Priority recommendation:** P1 before declaring the complete flow-routing model ready
- **Status:** **Resolved 2026-07-26** (bead `awkit-3eo`)
- **Affected area:** `src/runner/FlowExecutor.ts`, `FlowExecutor.resolveNext`
- **Detected by:** `CMP-CON-002`
- **Evidence before fix:** `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/campaign-results.json`
- **Evidence after fix:** `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/campaign-results.json`
  (9 PASS / 0 FAIL; `CMP-CON-002` PASS)

**Preconditions**

- A flow contains a `manualHandoff` node.
- Its only outgoing edge has type `manualApproval` and targets End.
- The authorized controller resumes the handoff.

**Reproduction**

1. Run the test profile constructed by `runFlowManualApprovalConnector` in `scripts/verify-comprehensive-e2e.mts`.
2. Wait until the manual handoff pauses.
3. Resume it through the test handoff controller.
4. Inspect the returned flow status and executed node IDs.

**Actual result**

- The flow returns `passed`.
- The Manual Handoff node completes.
- The target End node never executes.
- The path terminates silently because `resolveNext` has routing precedence for outcome, conditional, loop-back, success, always, and legacy `next`, but no flow-level `manualApproval` case.

**Expected result**

- After explicit approval/resume, the `manualApproval` edge is selected.
- End executes.
- The flow reports `passed` only after reaching the terminal node.

**Impact**

- A designer can persist a supported connector that the runtime does not follow.
- Downstream actions may be skipped while the run is reported successful.
- Reports can therefore state success for an incomplete business process.

**Fix applied**

`resolveNext` gained a `manualApproval` case placed immediately before the `success`/`always`
fallback, eligible **only** when the step reports `outcome === "manualContinued"` — the outcome
`StepExecutor` sets exactly when an operator chose to continue a handoff. A cancel throws inside
`waitForHandoffAction`, so a cancelled handoff fails the step and never reaches routing. The edge is
deliberately *not* a general success edge: an ordinary passed node never traverses one.

A second, narrower guard closes the relocated half of the same bug. When routing dead-ends at a node
whose only remaining outgoing edge is an ungranted `manualApproval`, the flow now finishes `failed`
with a message naming the step and the skipped target, instead of reporting `passed`. Without it,
any future path that reaches a handoff node without an explicit resume would reproduce the original
symptom — a report claiming success for a business process that stopped early.

Deliberate scope limits:

- `outcome === "sessionCaptured"` does **not** enable the edge. Automatic session reuse is not an
  approval, and `sessionAlreadyExists` involves no human at all.
- The workflow-level equivalent in `PlaywrightRunner.resolveNextFlow` already treats `manualApproval`
  as a continuation link and was left unchanged; it is flow-to-flow routing, a different granularity,
  and was not implicated by `CMP-CON-002`.
- A node cannot carry both `success` and `manualApproval`: both are `normal` connectors, so
  `multipleStandardOutgoing` structural validation rejects that pair before execution. Placement
  relative to the success fallback is therefore unreachable for valid persisted flows.

**Regression**

`npm run verify:runner` (flow-level connector routing section) gained 5 checks, taking it from 84 to
**89**. Before the runtime change they failed 3/5 — approved routing, approved downstream work, and
the skipped-approval report — with the two negative controls already passing, so the suite was
negative-controlled rather than vacuous:

1. an approved handoff routes through the connector to End, asserting the exact node sequence
   `start,approve,approved-work,end`;
2. the approved downstream work actually ran (`#firstName === "Approved"`) before `passed` is reported;
3. a cancelled handoff never traverses the connector and the flow fails;
4. an ordinary (non-handoff) node does not traverse a `manualApproval` connector;
5. a flow cannot report `passed` when an unapproved continuation was skipped.

### AWKIT-REP-001 — Reports read IPC trusted the renderer without authenticating its session

- **Severity:** S2 / Major security boundary failure
- **Priority recommendation:** P0 for any release exposing operational reports
- **Status:** **Resolved 2026-07-26**
- **Affected area:** `app/main/ipc/telemetry.ipc.ts`, `app/main/ipc/report.ipc.ts`
- **Detected by:** `SYS-REP-015`
- **Evidence before fix:** `test-artifacts/reports-populated-gui/2026-07-26T09-16-20-217Z/execution-results.json`
- **Evidence after fix:** `test-artifacts/reports-populated-gui/2026-07-26T09-30-15-417Z/execution-results.json`

**Reproduction before fix**

1. Launch the real Electron application with an isolated populated runtime/report store.
2. Before login, call `telemetry.overview`, `reports.list`, and `reports.get` through the exposed preload.
3. Repeat after login with an active user that has no Reports role.

**Actual result**

Every call returned operational run data. The main process checked neither the renderer-bound session
nor `page.reports`; hiding navigation and guarding the route were the only access controls.

**Expected result**

Every report/telemetry read must derive the actor from `event.sender`, fail closed before login, and
require `page.reports`. Export and folder-open actions must separately require `report.export`.

**Fix and regression**

All 18 telemetry handlers and all report read/alias handlers now use `assertSenderPermission` with
`PAGE_REPORTS`. Report export and folder-open use `REPORT_EXPORT`; the latter accepts only an existing
report id and resolves the configured Reports directory in the trusted process. The real-Electron
gate proves pre-auth denial, Viewer read allowance with export/open denial, no-role navigation,
deep-link and direct-IPC denial, crafted-id rejection, and out-of-root `system.openPath` rejection.
`verify:e2e-rbac` remains 51/51. Persisted denial-audit verification is still explicitly `NOT RUN`
under `SYS-REP-015`; this resolution does not claim it.

### AWKIT-REP-002 — Run Artifacts used a non-existent summary contract and bypassed export policy

- **Severity:** S2 / Major
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-07-26**
- **Affected area:** `app/renderer/pages/ExecutionReports.tsx`, `app/main/preload.ts`,
  `app/main/ipc/report.ipc.ts`
- **Detected by:** `SYS-REP-008`, `SYS-REP-015`
- **Evidence before fix:** `test-artifacts/reports-populated-gui/2026-07-26T09-16-20-217Z/execution-results.json`
- **Evidence after fix:** `test-artifacts/reports-populated-gui/2026-07-26T09-30-15-417Z/execution-results.json`

**Reproduction before fix**

1. Seed one valid stored `ConcurrentRunReport` and one corrupt report file.
2. Open Run Artifacts as Super User.
3. Inspect the card, attempt Open, and export it.
4. Repeat as Viewer.

**Actual result**

- The page projected stored records through fields that do not exist (`workflowName`,
  `instanceCount`, `reportPath`), so instance count was absent and Open could never render.
- The preload exposed no report export/open API.
- Export serialized the lossy renderer card rather than the full stored report.
- The Export control appeared for Viewer even though Viewer lacks `report.export`.

**Expected result**

The card must consume the persisted `ConcurrentRunReport` contract, export the complete redacted
record under the exact JSON filename, open only a trusted report-store folder, and expose actions only
to a role with `report.export`.

**Fix and regression**

The page now uses the real stored-report shape (`scenarioName`/`scenarioId`, `instances.length`),
fetches the permission-gated complete record before producing JSON, and hides Open/Export unless
`REPORT_EXPORT` is effective. Preload exposes the two main-owned operations. The populated gate proves
the corrupt sibling is skipped, exact card identity and instance count, full JSON bytes and filename,
redaction, Viewer hidden/denied actions, and safe crafted-id handling. The actual Windows Explorer
launch remains deliberately `NOT RUN` under `SYS-REP-008`; the boundary and button are covered without
opening an external OS window.

### AWKIT-SET-001 — Settings metadata, UI reset and secret operations lacked sender authorization

- **Severity:** S2 / Major security boundary failure
- **Priority recommendation:** P0
- **Status:** **Resolved 2026-07-26**
- **Affected area:** `app/main/ipc/settings.ipc.ts`, `app/main/ipc/secrets.ipc.ts`,
  `app/main/ipc/system.ipc.ts`
- **Detected by:** `SET-001`, `SET-013`, `SET-015`, `SET-016`
- **Evidence before fix:** `test-artifacts/settings-e2e/2026-07-26T09-49-23-933Z/execution-results.json`
- **Evidence after fix:** `test-artifacts/settings-e2e/2026-07-26T09-55-38-176Z/execution-results.json`

**Reproduction before fix**

1. Launch the real Electron app on an isolated profile containing known settings and a synthetic
   secret.
2. Before login, call Settings export/default-path/storage-stat/path-validation/UI-reset channels
   and every Secrets channel through preload.
3. Repeat as Viewer, which has neither `page.settings` nor `settings.edit`.
4. Attempt to overwrite and delete the named secret and invoke the Settings folder picker.

**Actual result**

Read-only calls exposed local paths/counts and secret names; UI state could be reset; secret values
could be overwritten or deleted; and the OS folder picker could be invoked. The comment claiming a
global sender guard did not match the implementation. No channel returned decrypted secret values,
but confidentiality metadata and secret integrity were outside the authenticated role boundary.

**Expected result and fix**

Every handler must derive the actor from `event.sender`: Settings/secret metadata requires
`page.settings`, and exports, folder actions, UI reset, secret set/delete and every other mutation
require `settings.edit`. All affected handlers now use `assertSenderPermission`; the real-Electron
gate proves pre-auth and Viewer denial without state change, plus authorized Super User and
Administrator behavior. `verify:e2e-rbac` remains 51/51, `verify:authz` 40/40 and the IPC contract
4/4.

### AWKIT-SET-002 — Crafted settings updates/imports bypassed authoritative validation

- **Severity:** S2 / Major
- **Priority recommendation:** P0
- **Status:** **Resolved 2026-07-26**
- **Affected area:** `app/main/uiSettings.ts`, `app/renderer/pages/Settings.tsx`
- **Detected by:** `SET-008`, `SET-018`
- **Evidence before fix:** `test-artifacts/settings-e2e/2026-07-26T09-49-23-933Z/execution-results.json`
- **Evidence after fix:** `test-artifacts/settings-e2e/2026-07-26T09-55-38-176Z/execution-results.json`

**Reproduction before fix**

1. As an authorized Administrator, bypass the form and call `settings:update` with invalid zoom,
   dimensions, run counts/concurrency, run mode, booleans or path types.
2. Import an array, an object with unknown nested fields, or an oversized file.
3. Restart and inspect the persisted settings file and dependent Settings controls.

**Actual result**

`settings:update` merged and wrote invalid values without calling `validateSettings`. Array imports
were treated as objects, unknown fixed-schema keys survived hydration, and the renderer placed no
size bound on import. Invalid state could therefore persist and destabilize later UI/runtime logic.

**Expected result and fix**

The main-owned write path now validates the fully merged document before persistence, including
finite ranges, enums, booleans, positive integer run limits and non-empty string paths. Replacement
rejects arrays; hydration prunes unknown fixed-schema keys while preserving documented dynamic maps;
the renderer rejects files above 1 MB. Eight invalid direct updates, malformed/array/oversized/
invalid imports, unknown fields and partial legacy input are negative-controlled in the final
116/116 run.

### AWKIT-SET-003 — Path validation reported an existing file as a writable directory

- **Severity:** S3 / Moderate
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-07-26**
- **Affected area:** `app/main/ipc/settings.ipc.ts`
- **Detected by:** `SET-007`
- **Evidence before fix:** `test-artifacts/settings-e2e/2026-07-26T09-49-23-933Z/execution-results.json`
- **Evidence after fix:** `test-artifacts/settings-e2e/2026-07-26T09-55-38-176Z/execution-results.json`

**Reproduction before fix:** Set a configured runtime path to an existing writable file and invoke
path validation. The result reported `exists=true, writable=true`, even though downstream artifact
code requires a directory.

**Fix:** The trusted path checker now calls `stat()` and reports a non-directory as not writable
before testing write access. The verifier proves a real directory remains writable and a real file
does not pass the directory contract. Picker, read-only-directory and actual artifact-location
subcases remain explicitly `NOT RUN` under SET-007.

### AWKIT-SET-004 — Settings errors and confirmation dialogs were not fully keyboard/screen-reader operable

- **Severity:** S3 / Moderate accessibility
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-07-26** for the reproduced core defects
- **Affected area:** `app/renderer/components/shared/ConfirmDialog.tsx`,
  `app/renderer/pages/Settings.tsx`
- **Detected by:** `SET-021`
- **Evidence before fix:** `test-artifacts/settings-e2e/2026-07-26T09-49-23-933Z/execution-results.json`
- **Evidence after fix:** `test-artifacts/settings-e2e/2026-07-26T09-55-38-176Z/execution-results.json`

**Reproduction before fix:** Trigger a validation/import error, then open a Settings confirmation
dialog and navigate with Tab/Shift+Tab/Escape. Error banners had no alert/live semantics; focus could
leave the modal; closing did not reliably return focus to the invoking control.

**Fix:** Error/status banners now use appropriate `role` and live-region semantics. `ConfirmDialog`
traps focus, supports Escape, remains focusable when it has no controls, and restores the prior
connected element on unmount. The gate proves announcements, forward/reverse wrap, Escape/close
return, narrow layout and reduced motion. SET-021 remains `NOT RUN` overall because 200% zoom,
high-contrast, unavailable-secret controls and the complete accessible-name audit were not executed.

### AWKIT-REC-003 — An empty Target URL started a live recording pointed at nothing

- **Severity:** S3 / Usability and state-integrity failure
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-07-26**
- **Affected area:** `src/recorder/RecorderService.ts` (`startRecording`)
- **Detected by:** `REC-003`
- **Evidence after fix:** `test-artifacts/recorder-gui/` (**70 PASS / 0 FAIL / 1 NOT RUN**)

**Reproduction before fix**

1. Open the Recorder with an empty Target URL.
2. Click Start Recording.

**Actual result**

The recording started. `getStatus()` returned `isRecording: true`, the status line read
`Recording (capturing waits)...`, and a browser session was live with no target.

The trap is that the Target URL input **disables itself while recording**, so the operator could not
type a URL to correct the mistake — the only exit was Cancel. The `!url.trim()` guard exists on the
**Save URL** button but not on **Start Recording**, whose `disabled` is only
`isRecording || handoffActive`, and `normalizeUrl("")` returns `""` without objecting.

**Expected result and fix**

REC-003 requires that an invalid target "does not leave a live recorder" and shows a useful error.
`startRecording` now refuses a blank target **before** any state is mutated or a browser is
launched, throwing `Enter a target URL before starting a recording.` Placing the guard before the
state assignment matters: rejecting later would leave `isRecording` already set.

**How this was nearly missed.** The first version of the REC-003 loop waited for
`isRecording === false` and then asserted. That condition is **already true while a start is in
flight**, so the poll returned at t=0 and all four invalid targets "passed" without ever being
attempted. The loop now waits for the status line to move off `Starting browser...` — the observable
an operator actually sees — and only then judges the state. The empty-target defect surfaced
immediately once the check stopped being vacuous.

### AWKIT-REC-002 — camelCase and snake_case secret field names bypassed redaction

- **Severity:** S2 / Secret leakage into persisted artifacts
- **Priority recommendation:** P0
- **Status:** **Resolved 2026-07-26**
- **Affected area:** `src/recorder/recorderInitScript.ts` (`shouldRedactValue`)
- **Detected by:** `REC-007`
- **Evidence before fix:** `test-artifacts/recorder-redaction/2026-07-26T18-21-24-237Z/` (**7/4**)
- **Evidence after fix:** `test-artifacts/recorder-redaction/2026-07-26T18-38-08-339Z/` (**15/0**)

**Reproduction before fix**

Record a form containing inputs named `apiToken` and `clientSecret`, type a value into each, then
read the recorded actions and the saved flow JSON.

**Actual result**

Both values were captured verbatim and persisted into the flow:

```
["", "", "", "", "", "", "CANARY-TOKEN-9d5f3a7c2e8b", "CANARY-SHARED-4f1e6b8a3d7c", "Rec007 Display Name"]
```

`SENSITIVE_FIELD_PATTERN` **does** contain `\bsecret\b` and `\btoken\b`. The failure is the word
boundary: `\b` requires a **non-word** character before the term, and both dominant field-naming
conventions supply a word character instead — `apiToken` (camelCase, preceded by `i`) and
`api_token` (snake_case, preceded by `_`, which regex counts as a word character).

Measured against the pre-fix pattern, every one of these was exempt:

`apiToken` · `accessToken` · `refreshToken` · `api_token` · `clientSecret` · `client_secret` ·
`devicePin` · `userSsn` · `cardCvv`

So the gap was never specific to tokens — it applied to **every** `\b`-anchored term in the pattern
(`pin`, `cvv`, `cvc`, `csc`, `ssn`, `secret`, `token`). Only the standalone spellings (`otp`, `ssn`,
`pin`, `cardNumber`, `client-secret`) ever matched. Hyphenated names worked by accident, because `-`
is not a word character.

**Expected result and fix**

Normalize the haystack before testing: insert a separator at each camelCase boundary and treat `_`
as one, so the anchors mean what they were written to mean.

```ts
const normalized = hay.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
```

Deliberately not fixed by dropping the `\b` anchors: that would redact `shipping` (contains "pin")
and `tokenizer_label`, and an over-redacting recorder silently discards values a user needs.

Covered in two places: `verify:recorder` (97/97, was 78) asserts all nine variants redact **and**
that `displayName` / `shippingAddress` / `tokenizer_label` still do not — so the fix cannot be
"achieved" by over-matching. `verify:recorder-redaction` (15/0) proves it end to end.

### AWKIT-REP-003 — Unauthorized Reports/telemetry reads were rejected but never recorded

- **Severity:** S3 / Missing detective control (no data was exposed)
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-07-26**
- **Affected area:** `app/main/security/sessionContext.ts`, `app/main/ipc/report.ipc.ts`,
  `app/main/ipc/telemetry.ipc.ts`, `src/security/authz/AuthorizationService.ts`
- **Detected by:** `SYS-REP-015`
- **Evidence after fix:** `test-artifacts/reports-populated-gui/2026-07-26T18-05-45-598Z/` (**74/74**)

**Reproduction before fix**

1. As a user with no Reports role, call `telemetry:overview`, `report:list`, `reports:get` and
   `reports:openFolder` directly through preload. All four are correctly denied.
2. As a Super User, open the Audit Log (`security:admin:listAudit`).

**Actual result**

Nothing. `appendAudit` was wired only into branding, licensing, user administration and
authentication, so a repeated probing attempt against the Reports surface left no trace at all —
the preventive control worked while the detective control did not exist. SYS-REP-015 requires that
unauthorized requests are "rejected **and audited**".

**Expected result and fix**

`assertSenderPermission` gained an opt-in `audit` descriptor; report and telemetry channels pass
one. A denial now appends `{eventType, result: "failure", reasonCode, targetType: "ipc-channel",
targetId: <channel>, detail: {requiredPermission}}`, attributing the acting user when a session
exists and recording no actor when there is none.

Three deliberate constraints:

1. **Only the channel and required permission are recorded** — never a caller-supplied argument, so
   a crafted request cannot inject content into the audit log. Asserted directly.
2. **Auditing is best-effort and never throws**, so an unwritable audit trail can never suppress the
   denial itself.
3. **The session is validated exactly once.** `AuthorizationService.resolveActor` was extracted so a
   denial can name its actor without a second `sessions.validate()` — that call runs `touchSession`,
   so re-running it would have let a *rejected* request slide the idle expiry it was just refused
   under. `requirePermission` is now defined in terms of `resolveActor`, so both paths share one
   implementation.

Auditing is opt-in per channel rather than global: the volume cost on a high-frequency polling
channel should be a deliberate choice. Extending it to every gated IPC surface is not done here.

Side effect: `telemetry.ipc.ts` now registers reads through a `handleReportsRead(channel, handler)`
helper that fuses registration with authorization, so a telemetry read cannot be added without its
guard. `verify:ipc-contract` was taught to recognise that registrar — without it the 18 telemetry
channels became invisible to its static scan, which would have failed **open** for its
"registered but unexposed and undocumented" check. Contract is back to 4/4 at 203 handlers.

### AWKIT-SET-005 — A read-only artifact folder was labelled "writable"

- **Severity:** S3 / Incorrect safety signal on a path the operator is asked to trust
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-07-27**
- **Affected area:** `app/main/ipc/settings.ipc.ts` (`checkPath`)
- **Detected by:** `SET-007`
- **Evidence before fix:** `test-artifacts/settings-e2e/2026-07-26T21-36-10-510Z/execution-results.json`
  (**137 PASS / 2 FAIL**)
- **Evidence after fix:** `test-artifacts/settings-e2e/2026-07-26T21-40-09-590Z/execution-results.json`
  (**139 PASS / 0 FAIL**)

**Reproduction before fix**

1. Create a directory and deny the current user "create file"/"create folder" on it
   (`icacls <dir> /deny <user>:(OI)(CI)(WD,AD)`). A real write into it now fails `EPERM`.
2. Set it as the Screenshots path in Settings and save.
3. `settings:validatePaths` returns `{exists: true, writable: true}` and the field renders the green
   **writable** label.

**Root cause:** `checkPath` tested writability with `access(path, W_OK)`. That is not a usable
writability test for a *directory* on Windows — Node does not consult the directory ACL, so it
returns success for a folder the user has been explicitly denied write access to. Measured directly:

| deny mask | `existsSync` | `isDirectory` | `access(W_OK)` | real write | `readdir` |
|---|---|---|---|---|---|
| `(W)` | false | `EPERM` | **writable** | `EPERM` | `EPERM` |
| `(WD,AD)` | true | true | **writable** | `EPERM` | OK |

**Why it matters:** these seven paths are where run artifacts land. A wrong "writable" label is worse
than no label — the operator configures the folder, sees Settings confirm it, saves, and every
screenshot/log/report write fails later with nothing having warned them. This is the same failure
*class* as `AWKIT-SET-003` (a file reported as a writable directory), which fixed the `isDirectory`
half of the same function and left the writability half intact.

**Fix:** writability is now decided by attempting an actual write — a uniquely-named probe file
created and removed in a `finally`, so a crash between write and delete cannot leave a permanent
artifact in a user-configured folder. The `isDirectory` guard from `AWKIT-SET-003` is unchanged.

**The fixture's own ACL mask had to be measured, not guessed.** The first attempt denied the whole
`W` right, which also blocks `stat` — the directory then reads as *missing* rather than read-only, so
the case under test was never exercised and the run failed for the wrong reason. `WD,AD` is the mask
that leaves `exists`/`isDirectory`/`readdir` intact while making a real write fail.

### AWKIT-REP-005 — A recovered anomaly was silently dropped from Runtime Analytics

- **Severity:** S3 / Information gap in an operator-facing health view
- **Priority recommendation:** P2
- **Status:** **Resolved 2026-07-26**
- **Affected area:** `app/renderer/pages/ReportsRuntime.tsx` (`AnomaliesPanel`),
  `app/renderer/styles/global.css`
- **Detected by:** `SYS-REP-010`
- **Evidence before fix:** `test-artifacts/reports-populated-gui/2026-07-26T20-41-50-639Z/execution-results.json`
  (**129 PASS / 1 FAIL**)
- **Evidence after fix:** `test-artifacts/reports-populated-gui/2026-07-26T20-48-22-606Z/execution-results.json`
  (**136 PASS / 0 FAIL**)

**Reproduction before fix**

1. Seed two anomalies for one workflow: one `state: "active"`, one `state: "recovered"`.
2. Open Runtime Analytics. `telemetry.anomalies` returns **both**, with states intact —
   `SqliteRuntimeStore.queryAnomalies` maps `state` faithfully and `verify:observability` (65/65)
   covers the transition.
3. The panel renders only the active row. Had the active one also recovered, the panel would show
   *"No anomalies detected in this range"* — identical to a workflow that never regressed at all.

`AnomaliesPanel` opened with `anomalies.filter((a) => a.state === "active")` and drove both the table
and its empty state from that list, so the recovered half of the data was discarded after being
correctly fetched, stored and transported.

**Why it matters:** recovery is the half of the signal that tells an operator whether a regression is
still costing them anything. Dropping it does not merely hide information, it makes a recovered
regression indistinguishable from no regression — the panel actively asserts the wrong thing.

**Fix:** the panel now renders active and recovered rows (active first), each carrying its own
labelled `StatusBadge` state, with the recovered rows tinted via `--awkit-text-muted` and the panel
subtitle reporting both counts. The empty state appears only when there are genuinely no anomalies.
Colour is never the only signal — the state is a text label in its own column.

**The check was hardened after it passed.** Asserting only that the recovered note appears would also
be satisfied by rendering every row as "active". It now additionally asserts that the rendered state
badges include *both* `active` and `recovered` — verified in the run above as `active,recovered`.

### AWKIT-REP-004 — The Reports run-detail drawer was an `aria-modal` dialog with no keyboard contract

- **Severity:** S3 / Moderate accessibility
- **Priority recommendation:** P1
- **Status:** **Resolved 2026-07-26**
- **Affected area:** `app/renderer/components/reports/RunDetailDrawer.tsx`
- **Detected by:** `SYS-REP-006`, `SYS-REP-016`
- **Evidence before fix:** `test-artifacts/reports-populated-gui/2026-07-26T19-38-40-665Z/execution-results.json`
  (**105 PASS / 3 FAIL**)
- **Evidence after fix:** `test-artifacts/reports-populated-gui/2026-07-26T20-31-28-001Z/execution-results.json`
  (**109 PASS / 0 FAIL**)

**Reproduction before fix**

1. Open Workflow Reports with populated run history and activate a row's **Details** button.
2. The drawer renders with `role="dialog"` and `aria-modal="true"`, but focus stays on the button
   behind it, Tab walks out into the page underneath, and Escape does nothing.
3. The only exit is a mouse click on Close or the scrim.

A keyboard or screen-reader user who opened the drawer was stranded: the drawer *claims* to be modal,
so assistive technology treats content behind it as inert, while focus was in fact still out there.

**This is the same defect class as `AWKIT-SET-004`.** That fix gave `ConfirmDialog` a focus trap,
Escape support and focus restoration, but the Reports drawer is a separate component and was never
covered by it — a fix applied to one modal surface, not to the concept.

**Fix:** `RunDetailDrawer` now mirrors `ConfirmDialog`'s pattern — focus moves into the drawer on
open, Tab/Shift+Tab wrap inside it, Escape dismisses it, and focus returns to the still-connected
element that opened it.

**The check that proves focus return was vacuous on the first attempt, and this is the reusable
lesson.** It asserted `document.activeElement.textContent.includes("Details")`. When focus is lost,
`activeElement` falls back to `<body>`, whose `textContent` contains *every* button label on the page
— including "Details". The assertion would therefore have passed precisely when the defect was
present. It now asserts the tag name *and* an exact label. Negative-controlled: with only the
focus-return line disabled the check fails with `activeElement=<BODY>`; restored, it reports
`activeElement=<BUTTON> "Details"`.

### AWKIT-REC-001 — Every Recorder IPC channel was reachable without a session or a permission

- **Severity:** S1 / Critical security boundary failure
- **Priority recommendation:** P0
- **Status:** **Resolved 2026-07-26**
- **Affected area:** `app/main/ipc/recorder.ipc.ts` (all 13 handlers)
- **Detected by:** `REC-028`
- **Evidence before fix:** `test-artifacts/recorder-authz/2026-07-26T17-50-19-068Z/results.json`
  (**3 passed / 26 failed**)
- **Evidence after fix:** `test-artifacts/recorder-authz/2026-07-26T17-52-58-107Z/results.json`
  (**44 passed / 0 failed**)

**Reproduction before fix**

1. Launch the real Electron app on an isolated profile and stop at the login card — no session is
   bound to the renderer.
2. Through the real preload surface, call every `recorder:*` channel: `getStatus`, `getActions`,
   `getUrls`, `getHandoff`, `saveUrl`, `saveFlow`, `ignoreProtectedDetection`, `cancelHandoff`,
   `stop`, `cancel`, `start`.
3. Sign in, then repeat as a Viewer, which does not hold `page.recorder`.

**Actual result**

Every handler executed. `recorder.ipc.ts` registered all 13 handlers as `async (_, …)` — the
`IpcMainInvokeEvent` was discarded, so no handler could identify its sender even in principle. With
**no session at all**:

- `recorder:saveUrl` persisted a caller-supplied URL into the reusable URL history;
- `recorder:saveFlow` **created a real flow profile in the library** — which also bypassed the
  `workflow.create` permission that `flows:create` enforces on the same store;
- `recorder:start` launched a browser and navigated it (the probe failed only at
  `net::ERR_CONNECTION_REFUSED`, i.e. after launch);
- `stop`, `cancel`, `cancelHandoff` and the handoff channels all ran.

The Viewer run behaved identically. The **only** thing withholding the Recorder from a Viewer was
the hidden navigation entry — the verifier confirms the nav item is correctly absent while every
underlying channel answered. That is hidden-only security, and it is the same class of gap as
`AWKIT-REP-001` (Reports) and `AWKIT-SET-001` (Settings) on the two surfaces already audited.

**Expected result and fix**

Every handler now derives its actor from `event.sender` via `assertSenderPermission`. Operating the
Recorder requires `page.recorder`; `recorder:saveFlow` additionally requires `workflow.create`, so
saving a recording cannot author a flow that `flows:create` would have refused. Because
`assertSenderPermission` unbinds the renderer on `SESSION_EXPIRED`, access is also lost when a
session is revoked — the verifier re-probes after sign-out and every channel denies.

Regressions: `verify:recorder-e2e` **41/41** (the full record → save → restart → production replay
journey still works for an authorized user), `verify:recorder` 78/78, `verify:recorder-draft` 17/17,
`verify:recorder-flow` 19/19, `verify:e2e-rbac` 51/51, `verify:authz` 40/40, `verify:security`
39/39, `verify:ipc-contract` 4/4.

**Note for follow-up, not fixed here:** `flows:list`, `flows:get` and `flows:export` in
`app/main/ipc/flow.ipc.ts` are also unauthenticated reads. That is outside REC-028's scope and is
recorded rather than silently changed.

### AWKIT-REC-043 — Every recording containing a file upload saves an `uploadFile` step the runner refuses by construction

- **Classification:** Technical debt (intentional fail-closed, but guaranteed rework with no in-product resolution path)
- **Severity:** S3 / Uploads are recorded with no `valueSource` (deliberate — never persist a
  fakepath), so validation refuses the flow before launch and names the step; the user's only
  remedy is hand-editing JSON to a path that must exist at replay time. There is no recorder-side
  or designer affordance to bind a file at save/run time, so any upload-including recording is
  unrunnable as recorded. Documented in-code; recorded here so the follow-up is tracked.
- **Priority recommendation:** P3
- **Status:** **Closed — not reproducible / invalid finding.** The Flow Designer DOES expose an in-product resolution path: `flowNodeRegistry.uploadFile.sections` includes `"value"` and the properties panel renders a full Value Source editor (Static text or Dynamic source) for it; registry validation requires a non-empty value and the runner resolves both static paths and dynamic value sources (`resolveStepValue`). No JSON hand-editing is required.
- **Owner routing:** Recorder capture semantics / Flow Designer
- **Affected area:** `src/recorder/recorderInitScript.ts:3398-3415`;
  `src/runner/StepExecutor.ts:1991-1998`; coverage `verify:recorder-upload` (refusal path only).
- **Fix direction:** add a save-time prompt or Flow Designer picker binding a concrete static
  path / runtime-input reference so recorded uploads become runnable without JSON editing.










---

## Resolved Oracle workflow defects

### AWKIT-ORA-E2E-001 — Scheduled data rows were absent from runner `currentRow`

- **Severity:** S2 / Major
- **Status:** Resolved
- **Reproduction before fix:** Start a `dataDrivenConcurrent` run whose flow fills a required control
  from a `currentRow` value. `InstanceManager` stored the row as `currentDataRow`, but
  `ExecutionEngine.runInstanceInner` omitted it from `InstanceExecutionContext`; the fill resolved
  empty and the row-specific workflow could not run correctly.
- **Fix:** Carry `instance.currentDataRow` into `currentRow`.
- **Evidence:** `ORA-ENG-001` — 8/8 production-engine instances completed with row-specific terminals.

### AWKIT-ORA-E2E-002 — Structured connectors could not route on `currentRow.*`

- **Severity:** S2 / Major
- **Status:** Resolved
- **Reproduction before fix:** Persist a structured conditional connector with
  `sourceField=dataSourceValue` and `variableName=currentRow.GENDER`. `FlowExecutor.makeScope`
  exposed outputs/runtimeInputs/instanceInputs only, so the condition never saw the row.
- **Fix:** Resolve `currentRow` and nested `currentRow.*` through the safe JSON-path resolver.
- **Evidence:** All 8 rows selected the correct gender/checkbox/outcome branches in `ORA-WF-003`,
  `ORA-WF-005`, and `ORA-ENG-001`.

### AWKIT-ORA-E2E-003 — Oracle DATE instants were incompatible with HTML date inputs

- **Severity:** S3 / Moderate
- **Status:** Resolved
- **Reproduction before fix:** Fill `<input type=date>` with the ISO instant returned by the JDBC
  bridge. HTML date controls accept `YYYY-MM-DD`, so the raw instant is rejected or leaves the value empty.
- **Fix:** For date controls only, normalize a parseable instant to the local calendar
  `YYYY-MM-DD`; keep ordinary text, already-normalized dates, invalid strings, and NULL behavior unchanged.
- **Evidence:** All non-null dates and the NULL-date row matched the live DOM in `ORA-WF-003`;
  `verify:runner` remains 84/84.

### HARNESS-007 — Terms-declined fixture was not actually blocked

- **Severity:** S2 / Major test-validity defect
- **Status:** Resolved
- **Reproduction before fix:** The mock form described terms as required but `#acceptTerms` lacked
  the HTML `required` attribute, so the negative row could submit to `/success`.
- **Fix:** Make the checkbox required and assert `validity.valueMissing=true`.
- **Evidence:** `ORA-WF-006` and mock-site regression 84/84.

## Resolved validation-harness defects

These were found and corrected while building the campaign. They are not open AWKIT product defects.

### HARNESS-008 — Packaged walkthrough accepted a packaged tree older than its own sources

- **Severity:** S2 / Major test-validity defect — it silently invalidates a release gate
- **Status:** **Resolved 2026-07-26** (commit `94c858e`)
- **Affected area:** `scripts/verify-packaged-walkthrough.mts`, Part A preconditions
- **Detected by:** attempting to verify the `AWKIT-E2E-001` fix in packaged form
- **Symptom:** none — and that is the defect. The suite reported a clean 69/69 while driving whatever
  happened to sit in `dist/win-unpacked`.
- **Cause:** Part A checked only that the packaged EXE *existed*. It never compared the packaged
  payload against the sources it claimed to contain, so a green packaged result was only as
  trustworthy as whoever remembered to run `npm run package:portable` first. Concretely: the tree
  present when the `AWKIT-E2E-001` fix landed had been built 2026-07-25 22:31, hours earlier, and
  would have "passed" without containing the fix at all.
- **Impact:** every historical packaged-walkthrough result carries this caveat. A pass could describe
  code no longer in the repository, and nothing in the suite would have contradicted it. Same class as
  the stale Zvec native host recorded in `docs/ai/HANDOFF.md`, where the first native-contract run
  silently exercised a protocol-v1 host from `dist/win-unpacked`.
- **Resolution:** Part A now resolves the newest file mtime under `src/` and `app/` and compares it
  against `dist/win-unpacked/resources/app.asar` (falling back to the EXE). If any source is newer the
  verifier prints the offending path and both timestamps and **exits 1** rather than producing a
  misleading pass. Check count 69 → 70.
- **Verification:** `verify:packaged-walkthrough` **70/70** against a freshly built package, with the
  `AWKIT-E2E-001` fix confirmed present in `out/main/main.js` (the bundle electron-builder packs into
  `app.asar`).
- **Negative control:** `touch src/runner/FlowExecutor.ts` reproduced the refusal —
  `dist/win-unpacked is STALE — src\runner\FlowExecutor.ts (…) is newer than the packaged payload (…)`,
  exit 1. The file was then confirmed byte-identical to its pre-test copy and to `HEAD`; the control
  changed only the mtime.

### HARNESS-009 — Electron blob export did not emit Playwright's download event

- **Severity:** S3 / Moderate test-validity defect
- **Status:** Resolved in `verify:reports-populated-gui`
- **Symptom:** The pre-fix gate timed out waiting for `Page.download` after the renderer clicked a
  blob-backed anchor, so the assertion could not distinguish an application export failure from an
  Electron/Playwright observation limitation.
- **Resolution:** The gate observes the real `Blob` bytes and the real anchor filename in the page
  without suppressing the click, persists those exact bytes as evidence, parses the JSON, and compares
  the full stored-report identity/instances/redaction fields. The final gate is 64/64.

### HARNESS-001 — Concurrency verifier used removed failure-capture hook

- **Symptom:** `verify:concurrency` crashed before assertions.
- **Cause:** Stub implemented `captureFailureScreenshot` while the runner now calls `captureFailureEvidence`.
- **Resolution:** Updated the verifier stub.
- **Verification:** `verify:concurrency` passed 78/78.

### HARNESS-002 — Packaged walkthrough selected splash window

- **Symptom:** Packaged checks attempted to call the preload bridge on the splash window.
- **Resolution:** Resolve the main window by probing for the packaged preload API.

### HARNESS-003 — Packaged walkthrough lacked current authentication precondition

- **Symptom:** Flow imports returned `NOT_AUTHORIZED`.
- **Resolution:** Provision/log in to a synthetic local first-run account within each fresh temporary profile.
- **Security note:** This is local test setup, not an MFA/CAPTCHA/SSO bypass.

### HARNESS-004 — Long Wait fixture violated current validation contract

- **Symptom:** The run returned `validationFailed`; no execution ID existed.
- **Cause:** Wait duration was set only as `timeoutMs`, while the exhaustive step requirements require Wait to carry a value/value source.
- **Resolution:** Persist `"120000"` as a static value and retain `timeoutMs` as the step timeout.

### HARNESS-005 — Packaged concurrency assumed dedicated-browser slots

- **Symptom:** Four instances and two browser roots ran, but `activeSlots` remained zero and no instances queued.
- **Cause:** Current shared-browser mode represents instances as virtual context slots; `activeSlots` deliberately counts only dedicated real-browser slots. Four contexts may be multiplexed over the two-root browser cap.
- **Resolution:** Observe active instance/context slots and OS browser roots, asserting four isolated instances over no more than two roots.

### HARNESS-006 — Fresh-profile/report assertions were stale or racy

- **Symptoms:** The harness expected a bundled sample workflow on a deliberately empty fresh profile and checked the report before asynchronous persistence completed.
- **Resolution:** Assert absence of developer/mock leftovers and poll for the report for up to 10 seconds.

## Environmental gaps, not defects

- **ACTIVE 2026-08-29 — v0.1.22 portable retry blocked by host-wide Windows commit exhaustion.**
  System event 2004 at 22:22:23 names the exact failure window: Oracle used 5,753,339,904 bytes,
  Comet 1,983,148,032 bytes and the canonical level-5 `7za.exe` 685,993,984 bytes. Live free commit
  then measured 717-814 MiB under a 32,556 MiB limit; a script typecheck also hit V8 OOM at 615 MiB.
  Product-side diagnostics are fixed: portable packaging now refuses below 1,536 MiB before costly
  work and immediately before electron-builder, emits a safe actionable dashboard label, and the
  outer release wrapper preserves the child failure code across manifest cleanup. Roadmap regression
  is 175/175 with negative controls. No fresh v0.1.22 EXE is claimed until the operator frees commit
  or increases pagefile capacity; AWKIT does not stop Oracle or user applications automatically.

- **RESOLVED 2026-08-29 — portable / NSIS release compression exhausted host commit (`awkit-hgol`).**
  `npm run package:portable` completes preflight, build, Zvec staging, the portable fresh-state gate,
  dependency-manifest generation + signing, and **strict** offline validation — then the final
  `electron-builder` step fails: `7za.exe a -bd -mx=9` over the 802 MiB `win-unpacked` tree exits 8
  with `ERROR: Can't allocate required memory!`. Reproduced three times with 6.0–6.7 GB physical free
  of 15.9 GB, including a pack-only retry against an already-built tree and a run with
  `NODE_OPTIONS=--max-old-space-size=8192` (that run instead died earlier with a V8
  `Fatal process out of memory: Zone` in `tsc --noEmit`, then passed on retry). `package-portable.ps1`
  already names this exact `-mx=9` OOM in its guard comment (observed 2026-07-06), and the guard works:
  it throws, so no stale EXE is passed off as fresh. **`dist/win-unpacked` IS produced correctly**, so
  every packaged gate that drives it runs normally; only `verify:packaged-walkthrough` Parts A/K/L and
  `verify:packaged-validation`'s portable freshness guard are blocked. Not a product defect — the
  packaged application is fine; the release compressor cannot get the memory it wants on this box.
  **Closed for verification purposes on owner decision (2026-08-25):** a fourth reproduction on a
  fully quiet machine confirmed it is not transient, so the artifacts were rebuilt with
  `ELECTRON_BUILDER_COMPRESSION_LEVEL=5` exported for one `npm run package:offline` invocation — no
  repository configuration changed, nothing persisted — and the pack completed (`PACKAGE_EXIT=0`).
  `verify:packaged-walkthrough` then went to **88/0** (Parts A/K/L green, NSIS sha512 bit-exact
  against `latest.yml`) and `verify:packaged-validation` to **87/0**. Compression affects the outer
  container only, so those results are real evidence about the code; the artifacts are nonetheless not
  byte-equivalent to a release build and must not be shipped
  (`dist/VERIFICATION-BUILD-0.1.20.md` records that beside them). Note for whoever picks this up:
  `electron-builder` hardcodes `-mx=9` for 7z regardless of the `compression` config value (only
  `"store"` differs), so editing `electron-builder.json` was never the lever. Resolution is the
  canonical wrapper policy `ELECTRON_BUILDER_COMPRESSION_LEVEL=5`: measured private memory fell from
  about 2.14 GiB to 0.64 GiB, both packages completed, strict offline validation and payload integrity
  passed, and a real-argument mutation control rejects a return to `-mx=9`. `awkit-hgol` is closed.
- Live Oracle: blocked because no approved URL/user/password is configured and the local Oracle container is absent.
- ~~Oracle packaged driver bundle: local development offline validation reported a zero-megabyte
  Oracle bundle warning.~~ **Withdrawn 2026-07-26 — never a defect or a warning.** `validate:offline`
  emits no Oracle warning and exits 0; the "0 MB" was an informational rounded size for a bundle whose
  measured contents are AWKIT's 40,550-byte bridge jar plus manifest and checksums (42,893 bytes
  total). Shipping zero Oracle driver bytes is the enforced user-selected-driver model, not a gap. See
  `EXECUTION_RESULTS.md` › Additional offline note.
- Clean/offline Windows VM walkthrough: **partially executed 2026-08-29, 21 PASS / 0 FAIL / 3 NOT
  EXECUTED**. Standard-user portable and per-user NSIS install/launch/uninstall passed; the driver does
  not automate its legacy upgrade-profile/summary/migration sections.
- CAPTCHA/MFA/OTP/protected-login completion: intentionally blocked for authorized manual handoff.
- Firefox/WebKit certification: not run under this Chromium-first scope.
