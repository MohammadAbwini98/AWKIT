# AWKIT Comprehensive Validation Execution Results

## awkit-cey / REC-022 closeout — QC-driven verifier repair - 2026-08-22

Independent QC of the REC-022 workstream found three assertions in this workstream's **own committed
verifiers** that were passing vacuously. A QA pass repaired all three. Executed results after the
repair:

| Verifier | Result |
| --- | --- |
| `npm run verify:recorder-draft` | **86/86**, exit 0 (was 83/83; +3 checks) |
| `npm run verify:protected-login-recorder` | **72/72**, exit 0 (count unchanged; a replaced assertion) |

Product code was confirmed **byte-identical to HEAD** across the repair
(`git diff --exit-code -- src/ app/` exits 0). No product defect surfaced; every repaired assertion
passes against unmutated product code.

- **T1** (`verify-recorder-draft.mts`) — "delete removes the profile directory" was true by absence;
  the fixture never created the directory. It now really creates `Default/Preferences` with an
  existence assertion immediately before `deleteProfile`. Mutant: repaired check FAILED, old form
  PASSED. Deterministic.
- **T2** (`verify-protected-login-recorder.mts`), **security-relevant** — "automation browser closes
  before the manual browser opens" read
  `browser === null && (page.isClosed() || page !== preLoginPage)`; since `closeBrowser` nulls
  `page`, the second disjunct was unconditionally true and `isClosed()` was dead code. A regression
  leaving the automation browser OPEN ON THE PROTECTED PAGE would have passed. Now
  `preLoginPage.isClosed() === true && resumeInternals.browser === null`. Mutant: repaired check
  FAILED, old form PASSED. Deterministic.
- **T3** (`verify-recorder-draft.mts`) — the concurrent rename+markUsed guard, the sole guard for the
  `enqueue` fix, had a conjunct satisfied by state written earlier in the same block. It now seeds a
  known-stale `lastUsedAt`, asserts the precondition, asserts the value CHANGED, and adds the
  reverse interleaving. Repaired check killed the pass-through-`enqueue` mutant **40/40**; the old
  form was blind **21/40** (18/20 in the markUsed-first ordering it never exercised). Control on
  correct code **20/20**.

**Methodological qualification, recorded honestly:** the write lease blocked editing `src/**`, so
these mutants were injected **at runtime against the real product objects**, not by editing product
source. The agent did not work around the guard. This is exact for T2 (a boolean over live objects)
and equivalent in discriminating power for T1/T3, but it is **not** a literal file-edit mutant.
Exit codes were inferred from clean tool completion plus tallies at or above baseline, not from a
printed `$?` — the lease guard rejects compound shell commands.

Eight further findings from the same review are deferred, all LOW, all recorded in `DEFECTS.md`:
`AWKIT-SES-001`, `AWKIT-SES-002`, `AWKIT-REC-036` (product/architecture) and `AWKIT-QA-001` …
`AWKIT-QA-005` (test/harness). None is fixed and none blocks closure.

No ledger case changed status — REC-022 stays `BLOCKED` on AC-6 and REC-023 stays `PASS` — so the
authoritative tally remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

---

## Super User / Recorder UX / editor-history tranche - 2026-08-08

Epic `awkit-3jm` and its nine children passed focused authorization, persistence, real-browser,
Electron GUI, accessibility, and mutation-sensitive acceptance. Key restored-state results were:
Super User controls **49/49**, Settings E2E **170/170**, Recorder hotkeys **37/37**, Recorder action
mutation **20/20**, editor history **14/14**, Flow Designer **87/87**, Workflow Builder **34/34**,
Recorder hover **236/236**, Mock Site **145/145**, and runner **95/95**. Nine targeted production
mutations each made its owning verifier fail before restoration.

No focused-ledger case changed status, so the authoritative tally remains
**63 PASS / 2 NOT RUN / 1 BLOCKED**.

---

## SET-015 real runtime-folder launch — 2026-08-04

The owner-approved opt-in Settings gate passed **154 PASS / 0 FAIL** with
`AWKIT_ALLOW_OS_SHELL_LAUNCH=1`. The verifier proved its unique isolated runtime root was not
already open, clicked the rendered **Open Runtime Folder** action, and observed a real Windows
Explorer window at that exact configured path. It then closed only the test-created exact-path
window and verified cleanup. The default verifier remains non-launching when the opt-in is absent.

SET-015 therefore moves from `NOT RUN` to `PASS`. The focused 66-case ledger is now
**63 PASS / 2 NOT RUN / 1 BLOCKED**; Settings is **21 PASS / 0 NOT RUN**. The remaining two
`NOT RUN` cases are Reports OS-shell launches, and the remaining `BLOCKED` case is the protected
login human-handoff completion.

---

## Increment 6 Shadow DOM evidence — 2026-08-01

`awkit-aui.6` was exercised through the production capture/build/validate/resolve/execute layers.
`verify:recorder` passed **171/171**: actual `composedPath()` inner targets; document + reachable-open-root
match counts; stable duplicate-host and nested-host replay; role/test-ID/dynamic/slotted cases; XPath,
dropped-host, retargeted-host, and closed-host-substitution negatives; known-closed-root privacy and
zero-launch preflight; same-origin-frame replay and cross-origin review guard. Supporting results:
ambiguity **59/59**, recorder-flow **29/29**, hover **34/34**, runner **89/89**, Mock Site **110/110**,
Flow Designer mapping **105/105**, profile store **16/16**, and IPC contract **4/4**. The 66-case
focused ledger status is unchanged at **62 PASS / 3 NOT RUN / 1 BLOCKED** because no new ledger case
or status transition was introduced.

Broader non-shadow compatibility also passed: Recorder draft/service **50/50**, Recorder IPC
authorization **50/50**, REC-018 full record→save→restart→Designer→three production replays **61/61**
with **18/18 (100%)** aggregate fidelity, and Recorder Electron GUI/accessibility **152/152**. REC-018's
metadata comparison now canonicalizes the intentional legacy-absent → `resolved`/`recorder`
normalization performed by `buildRecordedFlow`, while still comparing the full locator payload.

## Executive ledger

| Area | Status | Result |
| --- | --- | --- |
| Comprehensive real-browser campaign | `PASS` | **9 PASS / 0 FAIL** after the `AWKIT-E2E-001` fix (2026-07-26) |
| Exhaustive runner and wait semantics | `PASS` | **89/89** (84 + 5 manual-approval regressions) and 56/56 |
| Popup/multi-window | `PASS` | Main campaign plus 12/12, 43/43, 11/11 |
| Concurrency/cancellation/locks/artifacts | `PASS` | Baseline and all stress suites passed |
| Durable store/startup recovery | `PASS` | 11/11 and 10/10 |
| Telemetry/observability/reports/analytics | `PASS` | All specialized suites passed |
| Recorder component contracts | `PASS` | Capture 78/78; flow 19/19; draft 17/17; async review 21/21; protected detection 45/45 |
| Recorder full page record→save→replay | `PASS` | REC-018 **41/41**: real UI capture/save, restart/reopen, two production replays, designer round-trip |
| System Reports populated GUI truth/drill-down/export | `NOT RUN` | Populated core gate **136/136**; Reports **9 PASS / 7 NOT RUN**. Sort/filter matrix, comparison limit, multi-range capacity, recovered anomalies and storage sizing/denial/cache all closed; `AWKIT-REP-004` and `AWKIT-REP-005` found and fixed |
| Settings real-Electron core journey | `PASS` | **116/116** after fixes; access/IPC boundary, every section, validation, paths, Secrets, counts, import/reset/restart and core accessibility |
| Settings residual submatrices | `NOT RUN` | Core gate **151/151** plus `verify:recorder-gui` **103/103**; Settings **17 PASS / 4 NOT RUN**. Reset/Clear-UI-State inventory now covers sessions and driver records; boundary edges, rapid submit, the folder picker, an ACL-denied directory, unreadable-store recovery, the post-import restart round-trip and a FAILING offline-validation variant all closed; `AWKIT-SET-005` found and fixed |
| Recorder/Reports/Settings combined ledger | — | **51 PASS / 14 NOT RUN / 1 BLOCKED** (was 43/22/1). Counted from the case file, not from assertion totals |
| Auth/security/RBAC/session/secrets/licensing | `PASS` | All specialized suites passed |
| Flow Designer/Workflow Builder | `PASS` | Mapping, sentinels, and both GUI suites passed |
| Oracle offline/integration boundary | `PASS` | Policy, profile, source, runtime, and lazy resolution passed |
| Oracle row-driven browser workflow | `PASS` | 7 PASS / 0 FAIL; 8 rows through real bridge, Chromium, and production ExecutionEngine |
| Oracle live | `BLOCKED` | No approved URL/user/password; local container absent |
| Packaged runtime | `PASS` | 25/25 |
| Packaged clean-profile walkthrough | `PASS` | **70/70** at `82c2514`, against a package rebuilt after *all* of the Recorder/Reports/Settings work |
| Clean/offline Windows VM | `NOT RUN` | Separate manual release gate |
| CAPTCHA/MFA/OTP/protected-login completion | `BLOCKED` | Manual handoff required; no bypass attempted |
| Firefox/WebKit certification | `NOT RUN` | Chromium-first scope |

## Main campaign

Command:

`npm run verify:comprehensive-e2e`

Machine-readable result (current, post-fix):

`test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/campaign-results.json`

Structured runner log:

`test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/runner-logs.json`

Superseded pre-fix run (retained, not overwritten):
`test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/`

| Case | Status | Duration | Outcome |
| --- | --- | ---: | --- |
| CMP-INV-001 | `PASS` | 3 ms | 30 step types, 9 edge types, 4 connector kinds, 10 value-source types inventoried |
| CMP-FLOW-001 | `PASS` | 1,324 ms | Core live DOM actions and cross-flow values passed |
| CMP-IO-001 | `PASS` | 1,190 ms | Upload, async waits, output mapping, confined download passed |
| CMP-CON-001 | `PASS` | 663 ms | Conditional, parallel, outcome, loop, loop-back passed |
| CMP-CON-002 | `PASS` | 194 ms | The approved handoff continued through the `manualApproval` connector to End |
| CMP-ERR-001 | `PASS` | 1,078 ms | Retry, per-attempt evidence, failure routing, recovery passed |
| CMP-POP-001 | `PASS` | 2,285 ms | Popup lifecycle passed |
| CMP-WF-001 | `PASS` | 4,679 ms | Four-flow persisted workflow passed |
| CMP-MAN-001 | `PASS` | 826 ms | Safe synthetic handoffs and local session save passed |

Totals: **9 PASS, 0 FAIL, 0 BLOCKED, 0 NOT RUN** inside the main campaign. External gates are recorded
separately below.

### `AWKIT-E2E-001` fix verification (2026-07-26)

| Command | Before fix | After fix |
| --- | --- | --- |
| `npm run verify:runner` | 86 passed, **3 failed** | **89 passed, 0 failed** |
| `npm run verify:comprehensive-e2e` | 8 PASS / 1 FAIL | **9 PASS / 0 FAIL** |
| `npm run typecheck` | pass | pass |
| `npm run typecheck:scripts` | pass | pass |
| `npm run verify:concurrency` | — | 78 passed, 0 failed |
| `npm run verify:waits` | — | 56 passed, 0 failed |
| `npm run verify:popup` | — | 12 passed, 0 failed |
| `npm run verify:cancellation` | — | 12 passed, 0 failed |
| `npm run verify:artifacts` | — | 13 passed, 0 failed |
| `npm run verify:flow-step-mapping` | — | 101 passed, 0 failed |

The three pre-fix failures were the new regression's positive assertions (approved routing, approved
downstream work, and the skipped-approval report). Its two negative controls — a cancelled handoff and
an ordinary node — passed both before and after, so the added coverage is negative-controlled rather
than vacuously green.

### Packaged verification of this fix (2026-07-26)

`dist/win-unpacked` was built 2026-07-25 22:31 — *before* the fix — and
`scripts/verify-packaged-walkthrough.mts` had **no staleness guard**, so running it as-found would
have exercised the pre-fix bundle and reported a pass that said nothing about the change. Both were
addressed rather than worked around:

| Step | Result |
| --- | --- |
| `npm run package:portable` | PASS — fresh `dist/win-unpacked` (`app.asar` 2026-07-26 03:09) and portable EXE (03:13) |
| Fix present in the packaged payload | Confirmed — the guard's error string is in `out/main/main.js`, which electron-builder packs into `app.asar` |
| `npm run verify:packaged-walkthrough` | **70 passed, 0 failed** (69 + the new staleness check) |

**New precondition check.** Part A now refuses to run when the newest file under `src/` or `app/` is
newer than the packaged payload, naming the offending file and both timestamps. It was
negative-controlled: touching `src/runner/FlowExecutor.ts` made the verifier exit 1 with
`dist/win-unpacked is STALE — src\runner\FlowExecutor.ts (…) is newer than the packaged payload (…)`,
and the file was confirmed byte-identical to its pre-test copy and to `HEAD` afterwards (the control
changed only the mtime).

This closes a genuine evidence-integrity hole: every prior packaged result was only as trustworthy as
whoever remembered to repackage first, and nothing in the suite would have said otherwise. It is the
same class of trap as the stale Zvec host tree recorded in `docs/ai/HANDOFF.md`.

### Reports + Settings accessibility (SYS-REP-016, SET-021) — 2026-07-26

Both cases were wholly `NOT RUN`. New `npm run verify:reports-settings-a11y` (real Electron, isolated
profile) is **14 PASS / 0 FAIL / 1 NOT RUN**, and two seeded `aria-sort` assertions were added to
`verify:reports-populated-gui` (64 → **66**).

Covered: keyboard reach; the `:focus-visible` ring on every focused control (driven with real `Tab`
presses — `.focus()` would never match the selector the ring uses); accessible names; `aria-sort` on
sorted and unsorted columns; announcement of a rejected Save through a live region; association of the
error with its field; reduced motion; 200% zoom and a narrow width with no horizontal overflow.

**Two product defects found and fixed:**

1. **Sort state was icon-only.** `ReportsWorkflows.SortHeader` signalled direction with a chevron and
   no accessible text, so a screen-reader user could not tell which column was sorted or which way.
   `aria-sort` now sits on the header cell — `ascending`/`descending` on the active column, `none` on
   the rest. An `aria-label` was tried first and **reverted**: it replaced the button's natural name
   (the column title) with a sentence, which is worse for table navigation and broke an existing
   selector. `aria-sort` on the cell is the correct mechanism.
2. **Validation errors were not associated with their fields.** `validateClient` returned a flat
   `string[]`, so the banner announced *what* was wrong while the offending input carried no
   `aria-invalid`/`aria-describedby` — a user tabbing the form could not find it. Errors now carry a
   field id and bind to the control.

**Explicitly still unexecuted:** chart accessible summaries and the drawer focus-trap/return subcases
(SYS-REP-016); high-contrast mode and unavailable-secret controls (SET-021). One check reports
`NOT RUN` by design — Workflow Reports renders its EmptyState on a fresh profile, so the `aria-sort`
audit runs against seeded data in `verify:reports-populated-gui` instead.

**Regressions re-run:** `verify:reports-populated-gui` 66/66 · `verify:settings-e2e` 116/116 ·
`verify:reports` 31/31 · `verify:settings-persistence` 3/3 · `verify:e2e-rbac` 51/51 ·
`verify:verifier-classification` reconciled at **138** (four verifiers were unregistered, three of
them pre-existing) · `npm run build` and both typechecks PASS.

## Specialized suite results

| Suite | Result |
| --- | ---: |
| Script type-check | `PASS` |
| Production build | `PASS` |
| Verifier classification reconciliation | `PASS` — **138** classified: 1 documentation, 7 static, 50 unit, 27 integration, **45** real-browser, 8 packaged |
| Runner | `PASS` — **89/89** (84 + 5 manual-approval regressions) |
| Waits | `PASS` — 56/56 |
| Popup | `PASS` — 12/12 |
| Popup identity | `PASS` — 43/43 |
| Popup mock site | `PASS` — 11/11 |
| Concurrency | `PASS` — 78/78 |
| Cancellation | `PASS` — 12/12 |
| Artifacts | `PASS` — 13/13 |
| Live failure evidence | `PASS` — 17/17 |
| Stress concurrency | `PASS` — 13/13 |
| Stress cancellation | `PASS` — 8/8 |
| Stress locks | `PASS` — 10/10 |
| Stress artifacts | `PASS` — 7/7 |
| Durable store | `PASS` — 11/11 |
| Startup recovery | `PASS` — 10/10 |
| Telemetry | `PASS` — 61/61 |
| Observability | `PASS` — 65/65 |
| Reports GUI | `PASS` — 31/31 |
| Populated Reports GUI | `PASS` — **66/66** (64 + 2 `aria-sort` assertions for SYS-REP-016) |
| Recorder capture/locator/Smart Wait | `PASS` — 78/78 |
| Recorder flow conversion | `PASS` — 19/19 |
| Recorder draft/URL persistence | `PASS` — 17/17 |
| Recorder async review policy | `PASS` — 21/21 |
| Recorder protected-login detection | `PASS` — 45/45 |
| Recorder full page record→save→replay | `PASS` — **41/41** |
| Random designer/profile round-trip | `PASS` — 26/26 (direct script invocation) |
| Settings real-Electron E2E | `PASS` — **116/116** after fixes (pre-fix 81/114) |
| Settings persistence | `PASS` — 3/3 (isolated application-data root) |
| Capacity Settings GUI | `PASS` — 12/12 |
| HTTPS certificate runtime | `PASS` — 49/49 |
| HTTPS certificate Settings GUI | `PASS` — 31/31 |
| Accent Settings GUI | `PASS` — 33/33 |
| Branding Settings GUI | `PASS` — 30/30 |
| Database Drivers Settings GUI | `PASS` — 30/30 |
| Runtime analytics GUI | `PASS` — 36/36 |
| Authentication | `PASS` — 49/49 |
| Security | `PASS` — 39/39 |
| Authorization/RBAC | `PASS` — 40/40 |
| Real-Electron per-role RBAC | `PASS` — 51/51 |
| Session context | `PASS` — 11/11 |
| Secrets | `PASS` — 16/16 |
| Licensing | `PASS` — 56/56 |
| Flow step mapping | `PASS` — 101/101 |
| Workflow sentinels | `PASS` — 4/4 |
| Flow Designer GUI | `PASS` — 56/56 |
| Workflow Builder GUI | `PASS` — 20/20 |
| Oracle SQL policy | `PASS` — 30/30 |
| Oracle profiles | `PASS` — 22/22 |
| Oracle data source | `PASS` — 28/28 |
| Oracle runtime | `PASS` — 36/36 |
| Oracle lazy resolution | `PASS` — 20/20 |
| Packaged runtime | `PASS` — 25/25 |
| Packaged clean-profile walkthrough | `PASS` — **70/70** (re-run 2026-07-26 at `82c2514` on a freshly built package) |

### Packaged re-verification at `82c2514` (2026-07-26, current)

The packaged gate had gone stale again once the Reports and Settings units landed — the staleness
guard added in `94c858e` refused to run, naming
`app\renderer\components\shared\ConfirmDialog.tsx` as newer than the packaged payload. That is the
guard doing its job on work it was not written for.

| Step | Result |
| --- | --- |
| `npm run package:portable` | PASS — `app.asar` rebuilt 03:09 → **15:08** (`package-portable.ps1:3` runs `npm run build` itself, so the bundles cannot be stale) |
| Fixes present in the packaged payload | Confirmed in `out/main/main.js`: `Settings failed validation` ×2, `retainKnownKeys` ×9, `Appearance must be light` ×1, and the `manual-approval connector to` guard ×1 |
| Staleness precondition | `packaged payload is at least as new as src/ and app/` — PASS |
| `npm run verify:packaged-walkthrough` | **70 passed, 0 failed** |

This is the first packaged run that exercises the whole session's work together: the
`manualApproval` routing fix, the Reports authorization/export contract, and the Settings
authorization plus main-process validation. `resources/dependency-manifest.json` carries the
regenerated `manifestGeneratedAt` from that package run; it dates the manifest only and was not
hand-edited. Chromium age and content identity are recorded separately under `payloadProvenance`.
| Oracle mock-UI fixture | `PASS` — 36/36 |
| Oracle row-driven workflow | `PASS` — 7/7 executed cases; 1 live-Oracle case `BLOCKED` |

The production build emitted one non-fatal Vite dynamic/static import warning. No build failure resulted.

## Recorder, System Reports, and Settings focused execution

Detailed preconditions, steps, expected outcomes and per-case status:
`docs/testing/comprehensive-validation/RECORDER_REPORTS_SETTINGS_TEST_CASES.md`.

Commands executed:

```text
npm run verify:recorder
npm run verify:recorder-e2e
npm run verify:recorder-flow
npm run verify:recorder-draft
npm run verify:async-review
npm run verify:protected-login-recorder
npm run verify:https-certificates
npm run verify:popup-identity
npx tsx scripts/verify-random-roundtrip.mts
npm run verify:reports
npm run verify:reports-populated-gui
npm run verify:telemetry
npm run verify:observability
npm run verify:runtime-analytics-gui
npm run verify:e2e-rbac
npm run verify:settings-e2e
npm run verify:settings-persistence
npm run verify:capacity-settings-gui
npm run verify:https-certificates-gui
npm run verify:secrets
npm run verify:accent-gui
npm run verify:branding-gui
npm run verify:oracle-drivers-gui
```

All listed commands passed. REC-018 ran with an isolated temporary `LOCALAPPDATA` and forced the
supported production-offline bundled-Chromium path for both Recorder and ExecutionEngine. Settings
persistence ran with an isolated temporary `LOCALAPPDATA`.
Screenshots generated by GUI verifiers remained in their verifier-reported temporary/evidence
locations and were not committed.

### REC-018 integrated Recorder result (2026-07-26)

Command: `npm run verify:recorder-e2e`

Evidence: `test-artifacts/recorder-e2e/2026-07-26T08-59-26-977Z/`

| Assertion group | Status | Outcome |
| --- | --- | --- |
| Real Recorder UI and browser launch | `PASS` | Recorder page launched bundled Chromium through rendered controls |
| Capture and save | `PASS` | Exact `goto,fill,fill,select,check,click`; Stop; named Flow Library save |
| Restart and reopen | `PASS` | Full Electron restart on the same isolated root; flow visible in Flow Library |
| Production replay 1 | `PASS` | Reset oracle reproduced fixed synthetic form state; all 8 nodes passed in order |
| Flow Designer round-trip | `PASS` | No-op save preserved Recorder metadata plus node/connector order |
| Production replay 2 | `PASS` | Same target state and exact node order after designer save |
| Evidence/security | `PASS` | Valid JSONL logs, reports, recovery state and 6 screenshots; auth password absent |

Totals: **41 PASS / 0 FAIL / 0 BLOCKED / 0 NOT RUN** inside REC-018. The page harness is inert
without the Recorder-only binding; the server-side oracle was reset after capture and before each
run, so replay success is not self-fulfilled by the fixture.

### Populated System Reports result (2026-07-26)

Command: `npm run verify:reports-populated-gui`

Evidence: `test-artifacts/reports-populated-gui/2026-07-26T09-30-15-417Z/`

The gate creates a timestamped isolated profile, writes 32 current-window and 10 previous-window
durable runs through the real `SqliteRuntimeStore`, writes one valid and one corrupt stored report,
adds attempts/artifacts/capacity/admission/process/anomaly rows, and drives the real Electron renderer,
preload, IPC and security session boundary.

| Assertion group | Status | Outcome |
| --- | --- | --- |
| SYS-REP-002 range/refresh race | `PASS` | All five presets and rapid/repeated refresh settled on the newest request |
| SYS-REP-003 persisted Overview truth | `PASS` | 32 total; 23 completed, 6 failed, 3 cancelled; visible rates/counts/queue wait matched |
| SYS-REP-004/005 workflows | `PARTIAL` | Populated truth, two-way Workflow sort, machine/combined filters, two-row comparison passed |
| SYS-REP-006/007 detail and paging | `PARTIAL` | Exact run/attempt/artifact identity and 32-row two-page history passed |
| SYS-REP-008 stored reports | `PARTIAL` | Corrupt sibling ignored; full redacted JSON export and trusted folder boundary passed; Explorer launch not run |
| SYS-REP-009/010 analytics | `PARTIAL` | Six failure categories/rankings plus capacity/admission/active anomaly rendered |
| SYS-REP-011/012 live/server | `PARTIAL` | Four gauges, second poll, four process cards and storage discovery passed |
| SYS-REP-015 authorization/path safety | `PARTIAL` | Pre-auth/Viewer/no-role/direct/deep-link/path denials passed; persisted denial audit not run |
| Renderer stability | `PASS` | No renderer errors |

Totals: **64 PASS / 0 FAIL** at the assertion level. At the case level, SYS-REP-002 and
SYS-REP-003 move to `PASS`; the partially executed cases remain `NOT RUN` until every listed
subcase is exercised. Reports now have **5 PASS / 11 NOT RUN** focused cases, and the combined
Recorder/Reports/Settings ledger has **41 `NOT RUN`** cases remaining after the Settings campaign
below.

The negative-controlled pre-fix run was **44 PASS / 13 FAIL**:
`test-artifacts/reports-populated-gui/2026-07-26T09-16-20-217Z/`. It exposed two product defects:
unauthenticated/no-role report reads bypassed the main-process permission boundary
(`AWKIT-REP-001`), and Run Artifacts used incompatible fields, lacked a working trusted open/export
bridge, exported a lossy card, and showed export to Viewer (`AWKIT-REP-002`). One dependent download
observation was a harness issue (`HARNESS-009`), corrected by capturing the actual blob bytes and
anchor filename without suppressing the real click.

Regression results after the fixes:

| Command | Result |
| --- | ---: |
| `npm run typecheck` | PASS |
| `npm run typecheck:scripts` | PASS |
| `npm run build` | PASS |
| `npm run verify:reports-populated-gui` | **64/64** |
| `npm run verify:reports` | 31/31 |
| `npm run verify:telemetry` | 61/61 |
| `npm run verify:observability` | 65/65 |
| `npm run verify:runtime-analytics-gui` | 36/36 |
| `npm run verify:e2e-rbac` | 51/51 |
| `npm run verify:ipc-contract` | 4/4 (203 handlers, 181 exposed, 23 backend-only) |

The first attempted RBAC/Runtime Analytics rerun launched both Electron suites concurrently and both
applications exited during startup. No Electron/Specter/related Node process or port remained. Serial
reruns passed 51/51 and 36/36, confirming a launch collision rather than a reproducible product defect.

### Settings real-Electron result (2026-07-26)

Command: `npm run verify:settings-e2e`

Evidence: `test-artifacts/settings-e2e/2026-07-26T09-55-38-176Z/`

The gate creates a timestamped isolated profile with two flows, one workflow, one data source, one
stored report and synthetic secrets. It drives the real Electron renderer/preload/main process,
exercises every Settings section, and restarts on the same profile. Secret values are generated only
inside the run and are neither printed nor written to the result ledger.

| Assertion group | Status | Outcome |
| --- | --- | --- |
| Access and main-process authorization | `PASS` | Pre-auth/Viewer metadata and mutations denied; Super User/Administrator policy enforced |
| Application/Recorder/path/default cards | `PASS` | Save, cancel, confirmation, restart, path truth and eight invalid direct updates verified |
| Secrets GUI and storage safety | `PASS` | Add/update/masked list/cancel-delete/confirm-delete/restart; no plaintext in DOM, settings, results or disk |
| Counts and Clear UI State | `PASS` | Seeded counts refreshed; UI state cleared without deleting seeded product data or the secret |
| Export/import and recovery | `PASS` | Exact JSON download, round-trip, partial legacy merge, unknown-field pruning, malformed/array/oversize/invalid rejection |
| Reset and restart | `PASS` | Cancel was inert; confirm restored defaults while preserving seeded data and secret |
| Accessibility/responsive core | `PASS` | Error announcements, modal focus trap/Escape/return, narrow layout and reduced motion |
| Renderer stability | `PASS` | No renderer errors |

Totals: **116 PASS / 0 FAIL** at the assertion level. SET-001 and SET-018 move to `PASS`;
Settings now stand at **9 PASS / 12 NOT RUN**. Partially executed cases retain `NOT RUN` for their
unexecuted subcases: Recorder live-session scope, OS folder picker/launch, read-only/missing paths,
new-designer/runner propagation, unavailable/rapid secret storage, unreadable stores, session/driver
data inventory, corrupt/missing offline dependencies, 200% zoom, high contrast and the complete
control-by-control accessibility audit.

The complete pre-fix negative control was **81 PASS / 33 FAIL**:
`test-artifacts/settings-e2e/2026-07-26T09-49-23-933Z/`. It reproduced four product defects:
the Settings/Secrets IPC authorization gap (`AWKIT-SET-001`), missing main-process validation and
unsafe import normalization (`AWKIT-SET-002`), file-as-directory path truth (`AWKIT-SET-003`), and
modal/error accessibility gaps (`AWKIT-SET-004`). Two earlier runs were incomplete verifier
development runs and are not evidence. A post-fix 114/116 run exposed two stale-banner/timing
assertions in the verifier; correcting those harness observations without a production change
produced the final 116/116.

Regression results after the fixes:

| Command | Result |
| --- | ---: |
| `npm run typecheck` | PASS |
| `npm run typecheck:scripts` | PASS |
| `npm run build` | PASS |
| `npm run verify:settings-e2e` | **116/116** |
| `npm run verify:settings-persistence` | 3/3 |
| `npm run verify:e2e-rbac` | 51/51 |
| `npm run verify:https-certificates-gui` | 31/31 |
| `npm run verify:capacity-settings-gui` | 12/12 |
| `npm run verify:accent-gui` | 33/33 |
| `npm run verify:branding-gui` | 30/30 |
| `npm run verify:oracle-drivers-gui` | 30/30 |
| `npm run verify:flow-designer` | 56/56 |
| `npm run verify:workflow-builder` | 20/20 |
| `npm run verify:secrets` | 16/16 |
| `npm run verify:authz` | 40/40 |
| `npm run verify:ipc-contract` | 4/4 |

## Oracle row-driven campaign

Command: `npm run verify:oracle-mock-ui-workflow`

Machine-readable result:
`test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/execution-summary.json`

| Case | Status | Outcome |
| --- | --- | --- |
| ORA-WF-001 | `PASS` | Persisted profiles and production pre-run gate: zero issues |
| ORA-WF-002 | `PASS` | Real bridge, one query for three concurrent consumers, 8 rows |
| ORA-WF-003 | `PASS` | All compatible controls matched for all 8 rows |
| ORA-WF-004 | `PASS` | Stale checked interests explicitly cleared |
| ORA-WF-005 | `PASS` | 8 isolated runner instances, maximum 2 active |
| ORA-ENG-001 | `PASS` | Production ExecutionEngine: 8 completed, 8 logs, 16 screenshots |
| ORA-WF-006 | `PASS` | Required terms blocked native submit and reached blocked End |
| ORA-LIVE-001 | `BLOCKED` | Real 19c workflow not attempted without ephemeral credentials |

Totals: **7 PASS, 0 FAIL, 1 BLOCKED, 0 NOT RUN**.

## Evidence index

### Main campaign

- Result ledger: `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/campaign-results.json`
- Inventory: `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/inventory.json`
- Runner logs: `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/runner-logs.json`
- Workflow result: `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/workflow-result.json`
- Core screenshot root: `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/runs/core-cross-flow/screenshots`
- Retry/failure evidence root: `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/runs/recovery/screenshots`
- Download: `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/runs/io-flow/downloads/awkit-report.csv`
- Saved session root: `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/runs/manual-session/sessions`

### Oracle row-driven evidence

- Result ledger: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/execution-summary.json`
- Pre-run gate: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/pre-run-validation.json`
- Runner logs: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/runner-logs.json`
- Bridge/service logs: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/oracle-bridge.log` and `oracle-service.log`
- Production run report: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/execution-engine/reports/oracle-engine-2026-07-25T22-36-01-353Z/report.json`
- Screenshot roots: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/runs/` and `execution-engine/screenshots/`

### Recorder REC-018 evidence

- Result ledger: `test-artifacts/recorder-e2e/2026-07-26T08-59-26-977Z/execution-results.json`
- Captured actions + persisted flow: `test-artifacts/recorder-e2e/2026-07-26T08-59-26-977Z/recorded-actions-and-flow.json`
- Production logs/reports/state: `test-artifacts/recorder-e2e/2026-07-26T08-59-26-977Z/run-{1-before-designer-save,2-after-designer-save}-*`
- UI screenshots: `test-artifacts/recorder-e2e/2026-07-26T08-59-26-977Z/01-recorder-stopped.png` through `06-populated-reports.png`

### Populated System Reports evidence

- Result ledger: `test-artifacts/reports-populated-gui/2026-07-26T09-30-15-417Z/execution-results.json`
- Independent fixture truth: `test-artifacts/reports-populated-gui/2026-07-26T09-30-15-417Z/expected-fixture.json`
- Exported full report: `test-artifacts/reports-populated-gui/2026-07-26T09-30-15-417Z/exports/report-rep-populated-001.json`
- Screenshots: `test-artifacts/reports-populated-gui/2026-07-26T09-30-15-417Z/screenshots/01-overview-populated.png`
  through `05-run-artifacts.png`
- Retained pre-fix negative control: `test-artifacts/reports-populated-gui/2026-07-26T09-16-20-217Z/execution-results.json`

### Settings evidence

- Result ledger: `test-artifacts/settings-e2e/2026-07-26T09-55-38-176Z/execution-results.json`
- Exported settings: `test-artifacts/settings-e2e/2026-07-26T09-55-38-176Z/exports/webflow-studio-settings.json`
- Screenshots: `test-artifacts/settings-e2e/2026-07-26T09-55-38-176Z/screenshots/01-settings-super-user.png`
  through `04-settings-viewer-denied.png`
- Retained pre-fix negative control:
  `test-artifacts/settings-e2e/2026-07-26T09-49-23-933Z/execution-results.json`

### UI/report screenshots

- `reports/browser-performance/phase5-ui-evidence/runtime-analytics-normal.png`
- `reports/browser-performance/phase5-ui-evidence/runtime-analytics-empty.png`
- `reports/browser-performance/phase5-ui-evidence/runtime-analytics-migration.png`
- `reports/browser-performance/phase5-ui-evidence/runtime-analytics-high-data.png`

### Packaged evidence

- Evidence directory: `dist/phase5-evidence`
- Final walkthrough stdout: `test-artifacts/comprehensive-e2e/packaged-walkthrough-final3.stdout.log`
- Final walkthrough stderr: `test-artifacts/comprehensive-e2e/packaged-walkthrough-final3.stderr.log` (empty; zero failures)
- Summary: `dist/phase5-evidence/walkthrough-summary.json`

## Blocked and not-run ledger

| Item | Status | Reason |
| --- | --- | --- |
| Live Oracle connection/query | `BLOCKED` | Container absent; `AWKIT_ORACLE_LIVE_URL`, user, and password not configured |
| CAPTCHA/MFA/OTP completion | `BLOCKED` | Requires authorized manual handoff; bypass prohibited |
| Real protected provider Auto Secure Login | `NOT RUN` | No approved provider/session supplied; contract suites only |
| Reuse of a real approved captured session | `NOT RUN` | No approved real session supplied; local synthetic save and contract suites passed |
| Clean/offline Windows VM | `NOT RUN` | Separate human release walkthrough |
| Firefox/WebKit | `NOT RUN` | Chromium-first product scope |
| Production/private external API targets | `NOT RUN` | Only the authorized loopback mock API was used |

## Phase 2 — Oracle local gates re-executed (2026-07-26)

Every Oracle gate that does not require a live database was re-run at `94c858e` after
`npm run build:oracle-bridge` and `npm run prepare:oracle-runtime` (both PASS; the bridge reports
"no JRE/driver bundled; both are user-selected").

| Verifier | Result |
| --- | ---: |
| `verify:oracle-bridge` | 32 / 0 |
| `verify:oracle-bridge-real-build` | 16 / 0 |
| `verify:oracle-sql-policy` | 30 / 0 |
| `verify:oracle-profiles` | 22 / 0 |
| `verify:oracle-data-source` | 28 / 0 |
| `verify:oracle-lazy-resolution` | 20 / 0 |
| `verify:oracle-runtime` | 36 / 0 |
| `verify:oracle-java-runtime` | 48 / 0 |
| `verify:oracle-driver-bundle` | 47 / 0 |
| `verify:oracle-direct-jdbc` | 23 / 0 |
| `verify:oracle-packaging` | 23 / 0 |
| `verify:oracle-offline-bundle` | 11 / 0 |
| `verify:oracle-runtime-prep` | 14 / 0 |
| **13 non-GUI subtotal** | **350 / 0** |
| `verify:oracle-mock-ui` | 36 / 0 |
| `verify:oracle-drivers-gui` | **30 / 30** |
| `verify:oracle-mock-ui-workflow` | **7 PASS / 0 FAIL / 1 BLOCKED** |
| `validate:offline` | PASS (Zvec 17/17) |
| `benchmark:oracle-jdbc` (30-min soak) | **9 PASS / 0 FAIL** after the statistic fix — see below |

### `benchmark:oracle-jdbc` — RESOLVED 2026-07-26 (`dce4204`, bd `awkit-cww`)

The gate is green **because the statistic now measures the right thing, not because memory behaviour
improved.** Read that sentence before quoting the 9/0.

Clean idle-host 30-minute soak: **18,243,386 queries at 9,746/s**, `failures=0`, cancellation
`ok=55 bad=0` p95 252 ms, `pending=0`, no orphan Java.

| Statistic | Node (Specter) | Verdict |
| --- | --- | --- |
| **floor rise** (min 1st third → min last third) — *the gate* | 137 → 245 MB = **+108 MB** | PASS, at **72 % of the 150 MB budget** |
| least-squares slope (diagnostic) | +52.14 MB/sample = **+1460 MB** | — |
| endpoint delta (the old check, diagnostic) | **+1219 MB** | would still FAIL |
| peak (diagnostic) | **2472 MB** | uncovered — see `awkit-q0e` |

Bridge (Java) floor 157 → 156 MB (−1), slope −0.39 MB/sample. Flat, as it always was.

**This is not a leak.** The last third still returns to 245 MB against a 137 MB start, so the process
demonstrably still reclaims memory — which is exactly what the floor statistic is designed to detect
and the endpoint delta could not.

**Two corrections to what was previously recorded here.**

1. The earlier entry argued the endpoint delta was "close to arbitrary" and leaned on the series
   dipping to 53 MB. Computing trend statistics on that same data pointed the *other* way — slope
   +1106 MB, floor +350 MB, median 319 → 827 MB. The old check was roughly right for the wrong
   reason, and the previous framing erred in the exonerating direction.
2. **The concurrent-load confound hypothesis is refuted by measurement.** The idle run is *worse*
   than the confounded one on every peak-sensitive statistic — slope +1460 vs +1106, endpoint +1219
   vs +651, peak 2472 vs 1872. The behaviour is intrinsic, not an artifact of sharing the machine.

**The peak-growth concern (`awkit-q0e`) is now RESOLVED — there was never a product leak.** The
growth was the harness measuring itself. See the section below.

### `awkit-q0e` — the soak was measuring its own accounting (RESOLVED, `c6d4547`)

Two causes, neither in the product:

1. **Unbounded per-query accumulation.** `latencies` took one element per query. At 18.2M queries that
   array alone measured **502 MB of live data** (survives a forced GC) against a 30 MB baseline — and
   the 60-second sampler ran `[...latencies].sort()` **every minute**, a ~500 MB copy-and-sort per
   tick. Replaced with a fixed-bucket histogram: **18.2M samples now cost 0 MB.**
2. **RSS is the Windows working set**, trimmed by the OS independently of the process. Measured: with
   an 18.2M-element array live, `rss=499 MB / heapUsed=470 MB`; after a working-set trim, `rss=5 MB`
   with `heapUsed` **unchanged** at 470 MB and the array still live. The verdict now uses `heapUsed`;
   RSS is retained as a labelled diagnostic. The 150 MB budget is unchanged.

**Full 30-minute soak with the fixed harness — 9 PASS / 0 FAIL.** 23,458,521 queries at 13,030/s,
`failures=0`, cancellation `ok=59 bad=0` p95 252 ms, clean teardown.

| Signal | Result |
| --- | --- |
| **node heap floor** — *the gate* | 11 → 8 MB (**rise −3 MB**), slope +0.08 MB/sample (+2 MB), peak 24 MB |
| node RSS — *diagnostic* | 78 → 78 MB (rise 0), slope 0, peak 80 MB |
| bridge (Java) RSS | 194 → 193 MB (−1) |

```text
heap: 14 11 11 18 14 14 21 20 16 13 12 17 24 16 15 21 13 16 21 13 16 20 20 20 8 18 18 12 19
rss : 78 79 79 80 80 79 79 79 79 79 79 79 79 79 79 79 79 79 79 78 78 79 79 79 78 79 79 79 79
```

Heap oscillates in a tight 8–24 MB band with no trend; RSS is flat at 78–80 MB for thirty minutes.

**Same workload, before vs after the harness fix:**

| | before | after |
| --- | ---: | ---: |
| peak RSS | 2472 MB | **80 MB** |
| throughput | 9,746/s | **13,030/s** (+34 %) |
| max latency | 36,727 ms | **4,681 ms** |

The throughput gain and the collapse in max latency are the tell: the harness was spending roughly a
third of the machine on its own accounting, and the multi-second outliers were GC pauses from the
per-minute sort.

**Recorded rather than overstated:** with the harness fixed, RSS is stable enough that it would have
carried the verdict fine. Moving to `heapUsed` is still correct — a trim *can* corrupt an RSS verdict
and heap cannot be trimmed — but cause 1 was the dominant one. Cause 2 explains why the numbers never
reconciled, not why the gate broke. No peak ceiling was added: with the harness fixed there is
nothing left to ceiling.

**`awkit-1ts` — RESOLVED.** The soak artifact was overwritten by a run of *any* length, so a smoke run
silently replaced the release evidence (this happened on 2026-07-26 and was caught by chance, not by a
guard), and a run with fewer than two samples passed the memory invariants trivially. Two guards now:

- only `AWKIT_ORACLE_SOAK_MINUTES >= 30` writes the canonical `oracle-soak.json`; a shorter run writes
  `oracle-soak-SHORT-<n>min.json` and prints *"This is NOT the release gate … must not be cited as
  soak evidence"*;
- `checkTrend()` reports the memory invariants as **NOT RUN**, not passed, below two samples — a trend
  is undefined there, not satisfied.

Verified with a real 1-minute run: tally `7 passed, 0 failed, 2 NOT RUN` (previously `9 passed, 0
failed`), artifact routed to the SHORT path, and the canonical file left **byte-identical**
(md5 unchanged, still `durationMinutes 30.01` / 23,458,521 queries). `reports/` is gitignored, so this
artifact is local evidence only.

The full series is now written to `reports/oracle-validation/oracle-soak.json`
(`memory.nodeRssSeriesMb`), so any of this can be re-analysed without another 30-minute run.

### Historical: why the check was RED (superseded by the above)

*Retained for provenance. The run below is the 2026-07-26 soak taken under concurrent load, before
the statistic was fixed in `dce4204`. Its `FAIL` verdict is superseded by the section above.*

Passing: full 30.2 min, **19,659,232 queries at 10,864.8/s**, `failures=0`, cancellation `ok=56 bad=0`
p95 251 ms, bridge (Java) RSS drift **−37 MB**, `pending=0`, no orphan Java, no pool metrics.

Failing: `Node (Specter) RSS did not leak (drift < 150MB)` — `drift=651MB over 28 samples`
(start 104 MB, end 755 MB).

**The check's method cannot support either conclusion.**
`scripts/benchmark-oracle-jdbc.mts:246` computes `rssDrift = nodeRss[last] − nodeRss[0]` — a two-point
endpoint delta that ignores the other 26 samples. The observed series is a strong sawtooth:

```text
104 126 159 319 138 363 521 328 328 53 … 745 1286 827 1872 755
```

It **dips to 53 MB** at t+10.3 m, *below* the 104 MB start — a monotonic leak cannot decrease, so the
process demonstrably returns memory. But the peaks do rise (521 → 745 → 1286 → 1872), so growth in the
high-water mark is **not** ruled out. Had the final sample landed in a trough the check would have
passed, which makes it close to arbitrary on this signal.

**Confound:** this run shared the machine with electron-builder packaging, Electron GUI verifiers, and
Chromium workloads. Re-run on an otherwise-idle host before concluding anything.

**Deliberately not changed.** The threshold was not loosened and the method was not rewritten. Editing
a red gate's measurement is how a real regression gets buried; the fix (a trend statistic over all
samples, with a threshold derived from a measured idle-host baseline) is an owner decision recorded on
bead **`awkit-cww`**.

Not caused by this session's changes — none of them touch Oracle JDBC or memory. The artifact
`reports/oracle-validation/oracle-soak.json` is untracked, so there is no committed baseline to diff.

`verify:oracle-drivers-gui` was previously recorded at **25/30**, with five Oracle bridge/Java/ojdbc
checks "environmental/inconclusive". They pass now: the cause was simply that the bridge runtime had
not been built in that worktree. Building and staging it resolved all five — no product change was
needed, and no waiver is required.

### ORA-LIVE-001 is blocked by two things, not one

The recorded status ("blocked pending an authorized operator and ephemeral credential") understated
the gap. `scripts/verify-oracle-mock-ui-workflow.mts` **has no real-mode code path**: it reads no
`AWKIT_ORACLE_LIVE_*` variable anywhere and calls `addLiveOracleBlock()` unconditionally. Supplying
credentials today would still produce a mock run and a `BLOCKED` verdict.

Phase 2 item 4 of the brief — "ensure the verifier supports an explicit real mode" — is therefore
**not satisfied**, and is tracked on bead `awkit-7bu`. Implementing it needs the same persisted Data
Source, flow, workflow, query, DOM mapping, two-instance bound, production `ExecutionEngine`,
screenshots, logs and report as mock mode, must fail closed when any variable is absent, and must
never fall back to the mock bridge.

Interim mitigation landed: the `BLOCKED` entry now states both reasons, and when `AWKIT_ORACLE_LIVE_*`
is present the verifier prints a loud warning that nothing was executed against a database. Variable
*presence* is counted; no value is read, printed, or persisted. Both branches were exercised.

The generic `verify:oracle-live` matrix (previously 7/7) is a **separate scope** and remains so; the
two must not be conflated.

## Additional offline note

`validate:offline` passes in development mode and verifies the Zvec bundle/checksum (17/17).

### The "0 MB Oracle driver bundle warning" was a misreading — resolved 2026-07-26

It was recorded as a release-readiness warning requiring resolution or waiver. Investigation of the
validator's actual output shows **no Oracle warning and no Oracle failure exists**. Full Oracle
section of the run:

```text
Validating bundled Oracle JDBC runtime...
Oracle bundle size: 0 MB
```

That second line was a bare informational `Write-Host` in `scripts/validate-offline-bundle.ps1`,
emitted *after* every Oracle check had already passed. It is not in the warnings list, not in the
failures list, and `validate:offline` exits 0.

**Measured contents of `resources/oracle-jdbc/`:**

| File | Bytes |
| --- | ---: |
| `bridge/awkit-oracle-jdbc-bridge.jar` | 40,550 |
| `manifest.json` | 2,131 |
| `checksums.json` | 212 |
| **Total** | **42,893** (0.041 MB) |

`[math]::Round(42893 / 1MB, 1)` is `0.0`, printed as `0 MB`. The bridge jar is **present and
non-zero**, so this is not the "missing bridge jar" packaging defect — it is the expected
user-selected-driver layout, which the validator actively *enforces*: it adds a hard failure if
`runtime\bin\java.exe` or any `lib\*.jar` is found, because Java and the Oracle driver are chosen by
the user in Settings and must never be vendored.

**Resolution — documentation and output, not packaging.** No driver or JRE was vendored. The size
line now reports KB below 1 MB and states what the bundle is:

```text
Oracle bundle size: 41.9 KB (bridge jar only, as expected; Java + Oracle driver are user-selected)
```

Item 5 of `READINESS_SUMMARY.md` ("resolve or explicitly waive the zero-megabyte bundle warning") is
therefore closed as **not a defect**, with no waiver required.
