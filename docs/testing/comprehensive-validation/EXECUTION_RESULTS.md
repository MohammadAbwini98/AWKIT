# AWKIT Comprehensive Validation Execution Results

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
| Recorder full page record→save→replay | `NOT RUN` | Newly specified as REC-018; no existing verifier proves the whole chain |
| System Reports populated GUI truth/drill-down/export | `NOT RUN` | Empty-state GUI and backend analytics passed; seeded user journey is still open |
| Settings focused automated contracts | `PASS` | Capacity, persistence, certificate security, appearance/branding, secrets backend, Java/JDBC passed |
| Settings remaining page journeys | `NOT RUN` | Paths, general validation, Secrets GUI, import/export, reset/data preservation, authorization and accessibility |
| Auth/security/RBAC/session/secrets/licensing | `PASS` | All specialized suites passed |
| Flow Designer/Workflow Builder | `PASS` | Mapping, sentinels, and both GUI suites passed |
| Oracle offline/integration boundary | `PASS` | Policy, profile, source, runtime, and lazy resolution passed |
| Oracle row-driven browser workflow | `PASS` | 7 PASS / 0 FAIL; 8 rows through real bridge, Chromium, and production ExecutionEngine |
| Oracle live | `BLOCKED` | No approved URL/user/password; local container absent |
| Packaged runtime | `PASS` | 25/25 |
| Packaged clean-profile walkthrough | `PASS` | **70/70** on a fresh temporary profile, against a package rebuilt after the fix |
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

## Specialized suite results

| Suite | Result |
| --- | ---: |
| Script type-check | `PASS` |
| Production build | `PASS` |
| Verifier classification reconciliation | `PASS` — 134 classified: 1 documentation, 7 static, 50 unit, 27 integration, 41 real-browser, 8 packaged |
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
| Recorder capture/locator/Smart Wait | `PASS` — 78/78 |
| Recorder flow conversion | `PASS` — 19/19 |
| Recorder draft/URL persistence | `PASS` — 17/17 |
| Recorder async review policy | `PASS` — 21/21 |
| Recorder protected-login detection | `PASS` — 45/45 |
| Recorder full page record→save→replay | `NOT RUN` |
| Random designer/profile round-trip | `PASS` — 26/26 (direct script invocation) |
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
| Packaged clean-profile walkthrough | `PASS` — **70/70** (re-run 2026-07-26 on a freshly built package) |
| Oracle mock-UI fixture | `PASS` — 36/36 |
| Oracle row-driven workflow | `PASS` — 7/7 executed cases; 1 live-Oracle case `BLOCKED` |

The production build emitted one non-fatal Vite dynamic/static import warning. No build failure resulted.

## Recorder, System Reports, and Settings focused execution

Detailed preconditions, steps, expected outcomes and per-case status:
`docs/testing/comprehensive-validation/RECORDER_REPORTS_SETTINGS_TEST_CASES.md`.

Commands executed:

```text
npm run verify:recorder
npm run verify:recorder-flow
npm run verify:recorder-draft
npm run verify:async-review
npm run verify:protected-login-recorder
npm run verify:https-certificates
npm run verify:popup-identity
npx tsx scripts/verify-random-roundtrip.mts
npm run verify:reports
npm run verify:telemetry
npm run verify:observability
npm run verify:settings-persistence
npm run verify:capacity-settings-gui
npm run verify:https-certificates-gui
npm run verify:secrets
npm run verify:accent-gui
npm run verify:branding-gui
npm run verify:oracle-drivers-gui
```

All listed commands passed. Settings persistence ran with an isolated temporary `LOCALAPPDATA`.
Screenshots generated by GUI verifiers remained in their verifier-reported temporary/evidence
locations and were not committed.

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

- Result ledger: `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/campaign-results.json`
- Inventory: `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/inventory.json`
- Runner logs: `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/runner-logs.json`
- Workflow result: `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/workflow-result.json`
- Core screenshot root: `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/runs/core-cross-flow/screenshots`
- Retry/failure evidence root: `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/runs/recovery/screenshots`
- Download: `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/runs/io-flow/downloads/awkit-report.csv`
- Saved session root: `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/runs/manual-session/sessions`

### Oracle row-driven evidence

- Result ledger: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/execution-summary.json`
- Pre-run gate: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/pre-run-validation.json`
- Runner logs: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/runner-logs.json`
- Bridge/service logs: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/oracle-bridge.log` and `oracle-service.log`
- Production run report: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/execution-engine/reports/oracle-engine-2026-07-25T22-36-01-353Z/report.json`
- Screenshot roots: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/runs/` and `execution-engine/screenshots/`

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

## Additional offline note

`validate:offline` passed in development mode and verified the Zvec bundle/checksum (17/17), but reported the Oracle packaged driver bundle as 0 MB. This is a release-readiness warning and must be resolved or explicitly waived before claiming full offline Oracle support.
