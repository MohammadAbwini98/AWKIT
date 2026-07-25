# AWKIT Comprehensive Validation Execution Results

## Executive ledger

| Area | Status | Result |
| --- | --- | --- |
| Comprehensive real-browser campaign | `FAIL` | 8 PASS / 1 FAIL; one open manual-approval routing defect |
| Exhaustive runner and wait semantics | `PASS` | 84/84 and 56/56 |
| Popup/multi-window | `PASS` | Main campaign plus 12/12, 43/43, 11/11 |
| Concurrency/cancellation/locks/artifacts | `PASS` | Baseline and all stress suites passed |
| Durable store/startup recovery | `PASS` | 11/11 and 10/10 |
| Telemetry/observability/reports/analytics | `PASS` | All specialized suites passed |
| Auth/security/RBAC/session/secrets/licensing | `PASS` | All specialized suites passed |
| Flow Designer/Workflow Builder | `PASS` | Mapping, sentinels, and both GUI suites passed |
| Oracle offline/integration boundary | `PASS` | Policy, profile, source, runtime, and lazy resolution passed |
| Oracle live | `BLOCKED` | No approved URL/user/password; local container absent |
| Packaged runtime | `PASS` | 25/25 |
| Packaged clean-profile walkthrough | `PASS` | 69/69 on a fresh temporary profile |
| Clean/offline Windows VM | `NOT RUN` | Separate manual release gate |
| CAPTCHA/MFA/OTP/protected-login completion | `BLOCKED` | Manual handoff required; no bypass attempted |
| Firefox/WebKit certification | `NOT RUN` | Chromium-first scope |

## Main campaign

Command:

`npm run verify:comprehensive-e2e`

Machine-readable result:

`test-artifacts/comprehensive-e2e/2026-07-25T21-27-41-429Z/campaign-results.json`

Structured runner log:

`test-artifacts/comprehensive-e2e/2026-07-25T21-27-41-429Z/runner-logs.json`

| Case | Status | Duration | Outcome |
| --- | --- | ---: | --- |
| CMP-INV-001 | `PASS` | 2 ms | 30 steps, 9 edges, 4 connector kinds, 10 value sources inventoried |
| CMP-FLOW-001 | `PASS` | 1,506 ms | Core live DOM actions and cross-flow values passed |
| CMP-IO-001 | `PASS` | 796 ms | Upload, async waits, output, download passed |
| CMP-CON-001 | `PASS` | 667 ms | Conditional, parallel, outcome, loop, loop-back passed |
| CMP-CON-002 | `FAIL` | 188 ms | `manualApproval` edge skipped; End not executed |
| CMP-ERR-001 | `PASS` | 1,256 ms | Retry, evidence, failure routing, recovery passed |
| CMP-POP-001 | `PASS` | 2,709 ms | Popup lifecycle passed |
| CMP-WF-001 | `PASS` | 5,120 ms | Four-flow persisted workflow passed |
| CMP-MAN-001 | `PASS` | 1,143 ms | Safe handoffs and session save passed |

Totals: **8 PASS, 1 FAIL, 0 BLOCKED, 0 NOT RUN** inside the main campaign. External gates are recorded separately below.

## Specialized suite results

| Suite | Result |
| --- | ---: |
| Script type-check | `PASS` |
| Production build | `PASS` |
| Verifier classification reconciliation | `PASS` — 132 classified: 1 documentation, 7 static, 50 unit, 26 integration, 40 real-browser, 8 packaged |
| Runner | `PASS` — 84/84 |
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
| Packaged clean-profile walkthrough | `PASS` — 69/69 |

The production build emitted one non-fatal Vite dynamic/static import warning. No build failure resulted.

## Evidence index

### Main campaign

- Result ledger: `test-artifacts/comprehensive-e2e/2026-07-25T21-27-41-429Z/campaign-results.json`
- Inventory: `test-artifacts/comprehensive-e2e/2026-07-25T21-27-41-429Z/inventory.json`
- Runner logs: `test-artifacts/comprehensive-e2e/2026-07-25T21-27-41-429Z/runner-logs.json`
- Workflow result: `test-artifacts/comprehensive-e2e/2026-07-25T21-27-41-429Z/workflow-result.json`
- Core screenshot root: `test-artifacts/comprehensive-e2e/2026-07-25T21-27-41-429Z/runs/core-cross-flow/screenshots`
- Retry/failure evidence root: `test-artifacts/comprehensive-e2e/2026-07-25T21-27-41-429Z/runs/recovery/screenshots`
- Download: `test-artifacts/comprehensive-e2e/2026-07-25T21-27-41-429Z/runs/io-flow/downloads/awkit-report.csv`
- Saved session root: `test-artifacts/comprehensive-e2e/2026-07-25T21-27-41-429Z/runs/manual-session/sessions`

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
