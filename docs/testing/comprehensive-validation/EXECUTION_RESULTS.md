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
| `benchmark:oracle-jdbc` (30-min soak) | **8 PASS / 1 FAIL** — see below |

### `benchmark:oracle-jdbc` is RED — Node RSS leak check failed

The 30-minute soak is **not** green, and the earlier Phase 2 summary omitted it. Correcting that here.

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
