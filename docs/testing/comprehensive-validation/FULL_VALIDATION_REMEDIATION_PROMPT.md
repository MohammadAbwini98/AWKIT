# AWKIT Full Validation Remediation and Release-Gate Prompt

Use the following prompt with the coding agent that will reconcile, implement, test, fix, and
document all remaining work from three completed validation campaigns:

1. the comprehensive end-to-end validation suite;
2. the Oracle JDBC and persisted row-driven workflow validation;
3. the Recorder, System Reports, and Settings focused validation.

---

## Role

You are the senior engineer responsible for completing AWKIT's full release gates across the
comprehensive runner/browser campaign, Oracle JDBC/data-driven workflow campaign, and the Recorder,
System Reports, and Settings campaign. Work as a combined Electron/React/TypeScript engineer,
Playwright automation engineer, Java/JDBC integration engineer, Oracle read-only data-access
reviewer, security reviewer, accessibility specialist, persistence/concurrency engineer, Windows
packaging engineer, and evidence-driven test lead.

Treat AWKIT as a production desktop automation product. Preserve all working business logic,
Electron IPC contracts, persisted profile formats, authorization behavior, security controls,
offline behavior, routing, reports, and runtime integrations.

## Objective

Starting from commit `d43dfa6`, complete the following outcome:

1. Reproduce and fix the one confirmed open product defect, `AWKIT-E2E-001`.
2. Rerun the comprehensive campaign after the fix and require 9/9 main cases to pass without
   regressing runner semantics, workflows, concurrency, recovery, evidence, security, or packaging.
3. Reconcile and complete the Oracle validation gates:
   - preserve the already-passing offline, mock, bridge, JDBC, Settings, and data-driven contracts;
   - distinguish the previously passed generic live 19c matrix from the still-blocked same-workflow
     live 19c rerun;
   - execute the same persisted row-driven workflow in real mode only after an authorized operator
     provisions it and supplies a fresh ephemeral reader credential out of band;
   - validate the user-selected Java/driver packaging model on a clean Windows machine.
4. Implement reliable automated coverage for every safe automatable Recorder, System Reports, and
   Settings case currently marked `NOT RUN`.
5. Execute the cases against the real local Electron application, production runner, durable store,
   loopback mock site, real Java bridge, and bundled/installed Chromium where required.
6. For every newly reproduced failure, identify the root cause, implement the smallest safe product
   fix, add a regression, and rerun the focused and broader affected suites.
7. Preserve `BLOCKED` for CAPTCHA, MFA, OTP, SSO, passkeys, protected approvals, unavailable live
   Oracle credentials, or any case that genuinely requires an authorized person/external environment.
8. Reconcile stale or contradictory readiness documentation without changing product behavior to
   satisfy an obsolete packaging assumption.
9. Produce sanitized screenshots, traces, structured logs, execution reports, a defect ledger, and
   one updated release-readiness decision covering all three campaigns.
10. Do not stop after writing tests. Continue until all safe, in-scope, automatable cases pass or a
    genuine external blocker is documented with exact evidence.

`NOT RUN` is a coverage gap, not proof of a defect. Do not change production code for a `NOT RUN`
case until the intended behavior is verified from the product contract and a failure is reproduced.

## Repository and working rules

- Repository: `C:\Users\moham\OneDrive\Desktop\AWTKIT`
- Work directly on `main`; do not create a branch, worktree, or stash.
- Inspect repository instructions and `docs/ai/` memory before changing code.
- Prefer the codebase knowledge graph for code discovery, call tracing, and impact analysis.
- Preserve unrelated user changes, especially:
  - `.beads/interactions.jsonl`
  - `.beads/issues.jsonl`
- Stage only files that belong to this task.
- Make small, reviewable changes and commit coherent work.
- Push the completed commits to `origin/main`.
- Use the existing npm/TypeScript/Electron/Playwright conventions. Do not introduce a second
  overlapping E2E framework.
- Do not weaken existing assertions, silently quarantine a failure, or add arbitrary long sleeps.
- Do not rename public routes, IPC channels, persisted keys, profile fields, or runtime events unless
  a reproduced defect requires a compatible migration.

## Authoritative test and evidence sources

Read these before implementation:

1. `docs/testing/comprehensive-validation/RECORDER_REPORTS_SETTINGS_TEST_CASES.md`
2. `docs/testing/comprehensive-validation/EXECUTION_RESULTS.md`
3. `docs/testing/comprehensive-validation/TRACEABILITY_MATRIX.csv`
4. `docs/testing/comprehensive-validation/DEFECTS.md`
5. `docs/testing/comprehensive-validation/READINESS_SUMMARY.md`
6. `docs/testing/comprehensive-validation/TEST_PLAN.md`
7. `docs/testing/comprehensive-validation/TEST_CASES.md`
8. `docs/testing/comprehensive-validation/FIXTURES.md`
9. `docs/ai/CURRENT_STATE.md`
10. `docs/ai/HANDOFF.md`
11. `docs/ai/TASK_LOG.md`
12. `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md`
13. `docs/ai/ORACLE_JDBC_RUNTIME_MATRIX.md`
14. `docs/ai/ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md`
15. `docs/ai/ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md`
16. `scripts/verify-comprehensive-e2e.mts`
17. `scripts/verify-oracle-mock-ui-workflow.mts`
18. `scripts/oracle/local-19c-awkit-types-fixture.sql`
19. `scripts/oracle/local-19c-mock-ui-fixture.sql`

The detailed case document is authoritative for preconditions, steps, expected results, and current
status. Do not replace its exact requirements with shallow smoke checks.

## Current outcome baseline

### Campaign-level status

| Campaign | Current outcome | Release observation |
|---|---|---|
| Comprehensive real-browser main campaign | 8 PASS / 1 FAIL | `CMP-CON-002` / `AWKIT-E2E-001` blocks complete connector support |
| Oracle persisted row-driven workflow | 7 PASS / 0 FAIL / 1 BLOCKED | Database-free path passed; exact live-19c workflow rerun remains blocked |
| Recorder + System Reports + Settings | 19 component/contract PASS / 46 NOT RUN / 1 BLOCKED | Integrated page journeys and full GUI truth remain incomplete |

### Comprehensive main cases

| Case | Status | Outcome |
|---|---|---|
| `CMP-INV-001` | PASS | 30 step types, 9 edges, 4 connector kinds, and 10 value sources inventoried |
| `CMP-FLOW-001` | PASS | Core live DOM actions, all value sources, subflow output passing |
| `CMP-IO-001` | PASS | Upload, async waits, mapped output, confined download |
| `CMP-CON-001` | PASS | Conditional, outcome, parallel, loop, and loop-back routing |
| `CMP-CON-002` | FAIL | `manualApproval` edge skipped; End not executed |
| `CMP-ERR-001` | PASS | Retry, per-attempt evidence, failure routing, recovery |
| `CMP-POP-001` | PASS | Fast/delayed popup identity, switching, close, main-page restore |
| `CMP-WF-001` | PASS | Persisted four-flow workflow and cross-flow data |
| `CMP-MAN-001` | PASS | Safe synthetic handoffs and local session save |

### Oracle row-driven cases

| Case | Status | Outcome |
|---|---|---|
| `ORA-WF-001` | PASS | Persisted Data Source/flow/workflow and production pre-run gate |
| `ORA-WF-002` | PASS | Real bridge protocol, single-flight query, 8 rows |
| `ORA-WF-003` | PASS | All compatible Oracle values mapped into live DOM controls |
| `ORA-WF-004` | PASS | Stale checked interests explicitly cleared |
| `ORA-WF-005` | PASS | Eight isolated instances with maximum concurrency 2 |
| `ORA-ENG-001` | PASS | Production ExecutionEngine, logs, reports, 16 screenshots |
| `ORA-WF-006` | PASS | Native required-checkbox block reaches blocked End |
| `ORA-LIVE-001` | BLOCKED | Same persisted workflow not rerun against real 19c without fresh credentials |

### Recorder, Reports, and Settings cases

| Surface | Total cases | PASS | NOT RUN | BLOCKED | Confirmed FAIL |
|---|---:|---:|---:|---:|---:|
| Recorder | 29 | 9 | 19 | 1 | 0 |
| System Reports | 16 | 3 | 13 | 0 | 0 |
| Settings | 21 | 7 | 14 | 0 | 0 |

### Status interpretation

- `PASS` means the exact recorded scope ran and produced evidence.
- `FAIL` means the expected behavior was executed and contradicted by observed behavior.
- `BLOCKED` means an authorized human, credential, database, or external machine is genuinely
  required.
- `NOT RUN` is a coverage gap, not proof of a defect.
- A component pass does not certify the corresponding full Electron user journey.

## Comprehensive campaign observations

The comprehensive campaign already proves:

- all declared step, edge, structured connector, and value-source schemas are represented;
- core browser actions, uploads/downloads, waits, popups, screenshots, sessions, cross-flow data,
  generated/dynamic/row/secret values, and persisted workflows work in live Chromium;
- retry, failure evidence, recovery, cancellation, concurrency, locks, artifact isolation, durable
  storage, startup recovery, auth, RBAC, secrets, and packaged fresh-profile execution pass;
- the production build passed with one non-fatal Vite dynamic/static import warning;
- packaged runtime passed 25/25 and the clean-profile walkthrough passed 69/69 locally.

The sole confirmed open product failure is `AWKIT-E2E-001`. Do not let the large green specialized
suite obscure that it can report success while skipping approved downstream work.

External comprehensive gates remain:

- a clean/offline Windows VM walkthrough;
- protected provider completion requiring authorized manual handoff;
- Firefox/WebKit certification, which remains outside the current Chromium-first scope unless
  product scope changes;
- production/private external targets, which were intentionally not used.

## Oracle campaign observations

The current Oracle architecture is:

`Settings-selected java.exe → AWKIT isolated bridge jar → user-imported ojdbc*.jar → Oracle`

AWKIT does not bundle a JRE, Oracle JDBC driver, or UCP. It bundles only its own bridge jar. Direct
JDBC uses one connection per query; there is no UCP pool.

Locally passing Oracle evidence includes:

- 13 non-GUI Oracle verifiers: 350/350;
- direct JDBC concurrency/cancellation: 23/23;
- Java runtime Settings: 48/48;
- generic authorized live Oracle 19c functional matrix: 7/7 in the historical gate record;
- mock-UI fixture parity: 36/36;
- Database Drivers Electron GUI: 30/30;
- packaging: 23/23;
- offline bundle: 11/11;
- runtime preparation: 14/14;
- 30-minute Oracle JDBC soak with redacted artifact
  `reports/oracle-validation/oracle-soak.json`;
- persisted database-free row-driven workflow: 7 PASS / 0 FAIL with 8 rows, real bridge protocol,
  real Chromium, two-instance bound, production ExecutionEngine, JSONL logs, reports, and screenshots.

Do not collapse two different live gates:

1. the generic `verify:oracle-live` matrix was previously cleared 7/7 against local Oracle 19c;
2. `ORA-LIVE-001`, the exact persisted `SPECTER_MOCKUI.MOCK_FORM_CASES` workflow in real mode, is
   still recorded `BLOCKED` because that run did not receive the ephemeral reader credential.

There is no stored Oracle password to recover. An authorized operator must provision/unlock the
least-privilege reader, mint a fresh password, supply it via `AWKIT_ORACLE_LIVE_*` out of band, and
rotate plus lock the account after the run.

Documentation currently contains a stale-looking “zero-megabyte packaged Oracle driver bundle”
warning. Under the current user-selected-driver model, shipping zero Oracle driver bytes is expected
and enforced. Investigate the exact validator output and architecture chronology. If the warning
refers to an obsolete bundled-driver expectation, correct the readiness documentation and verifier
classification; do not vendor an Oracle driver or JRE to make the warning disappear. If it refers to
the AWKIT bridge jar itself, reproduce and fix the actual packaging defect.

The remaining Oracle external gates are:

- the same persisted workflow rerun against authorized real 19c;
- portable/NSIS plus clean-machine walkthrough with no system Java initially configured;
- sustained production-style soak beyond the existing 30-minute harness.

### Recorder observations

The underlying Recorder contracts are strong and currently green:

- DOM capture, semantic locators, ambiguity refusal, Smart Wait behavior: 78/78
- recorded-action to flow conversion: 19/19
- draft and URL-history persistence contracts: 17/17
- async review policy: 21/21
- protected-login detection: 45/45
- HTTPS trust behavior: 49/49
- popup identity: 43/43
- designer/profile random round-trip: 26/26

The feature is not release-certified because no current verifier proves this complete path:

`Recorder page → launched browser → recorded actions → Stop → Save to Flow Library → reopen after
restart → production ExecutionEngine replay → correct report/evidence`

That path is `REC-018`, the decisive Recorder release gate.

### System Reports observations

Currently green:

- empty/fresh-profile Reports GUI route and terminal-state checks: 31/31
- telemetry storage/query contracts: 61/61
- observability aggregation and lifecycle contracts: 65/65

The current GUI evidence primarily proves route rendering, empty/loading states, controls, and
backend calculations separately. It does not prove that populated pages render the same truth as
seeded durable history, that drill-downs select the correct run, or that export/open-folder actions
are authorized and path-safe.

### Settings observations

Currently green:

- settings persistence with an isolated application-data root: 3/3
- runtime capacity Settings GUI: 12/12
- HTTPS certificate runtime: 49/49
- HTTPS certificate Settings GUI: 31/31
- secret-store backend: 16/16
- accent GUI: 33/33
- branding GUI: 30/30
- Database Drivers GUI: 30/30

Coverage is fragmented across individual cards and backend contracts. The whole Settings page still
needs general validation, path safety/writability, Secrets GUI, data-storage counts, import/export,
corrupt import recovery, Clear UI State safety, Reset data preservation, offline validation,
authorization, accessibility, responsive behavior, and concurrent interaction coverage.

## Confirmed open defect to fix first

### AWKIT-E2E-001 — flow-level `manualApproval` connector is silently ignored

- Severity: S2 / Major
- Priority: P1 and release-blocking for complete connector support
- Status: open and reproducible
- Detected by: `CMP-CON-002`
- Primary code: `src/runner/FlowExecutor.ts`, `FlowExecutor.resolveNext`
- Reproducer: `runFlowManualApprovalConnector` in `scripts/verify-comprehensive-e2e.mts`
- Evidence:
  `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/campaign-results.json`

Preconditions:

- a flow contains a `manualHandoff` node;
- its only outgoing edge is `manualApproval` to End;
- the authorized controller explicitly resumes the handoff.

Actual:

- the flow returns `passed`;
- Manual Handoff completes;
- End never executes;
- routing terminates silently.

Expected:

- after explicit approval/resume, the `manualApproval` edge is selected;
- End and any downstream approved work execute;
- the flow reports `passed` only after the terminal path completes.

Required fix behavior:

1. Add a failing focused regression before changing the runtime.
2. Trace the approved/resumed state from the handoff result into connector routing.
3. Make `manualApproval` eligible only after the corresponding handoff was explicitly resumed.
4. Do not treat `manualApproval` as a general success edge; that could bypass approval semantics.
5. Assert the exact executed-node sequence, including End.
6. Assert cancel, timeout, rejection, and non-resumed paths do not traverse the approval edge.
7. Assert reports cannot claim success when downstream approved work was skipped.
8. Rerun `CMP-CON-002` and require the comprehensive campaign to reach 9/9 PASS.

## Product architecture and likely files

Inspect callers and contracts before editing. The likely scope includes, but is not limited to:

### Comprehensive runner and browser campaign

- `scripts/verify-comprehensive-e2e.mts`
- `resources/test-fixtures/mock-site/`
- `mock-site/`
- `src/runner/FlowExecutor.ts`
- `src/runner/StepExecutor.ts`
- `src/runner/PlaywrightRunner.ts`
- `src/runner/ExecutionEngine.ts`
- `src/runner/ManualHandoffController.ts`
- `src/instances/InstanceManager.ts`
- `src/instances/InstanceRuntimeState.ts`
- `src/runner/concurrency/`
- `src/reports/`
- `src/session/`
- `src/profiles/`
- `app/main/ipc/execution.ipc.ts`
- `app/main/security/sessionContext.ts`

### Oracle JDBC and row-driven workflow

- `scripts/verify-oracle-mock-ui-workflow.mts`
- `scripts/verify-oracle-mock-ui.mts`
- `scripts/verify-oracle-live.mts`
- `scripts/verify-oracle-direct-jdbc.mts`
- `scripts/benchmark-oracle-jdbc.mts`
- `scripts/oracle/local-19c-awkit-types-fixture.sql`
- `scripts/oracle/local-19c-mock-ui-fixture.sql`
- `src/oracle/OracleQueryService.ts`
- `src/oracle/OracleJdbcBridgeManager.ts`
- `src/oracle/OracleProfileService.ts`
- `src/oracle/OracleRuntimeResolver.ts`
- `src/oracle/OracleSqlPolicy.ts`
- `src/oracle/OracleDriverBundle.ts`
- `src/oracle/OracleDriverBundleStore.ts`
- `src/oracle/JavaRuntimeProfile.ts`
- `src/data/DataSourceResolver.ts`
- `src/instances/InstanceManager.ts`
- `src/runner/ExecutionEngine.ts`
- `src/runner/FlowExecutor.ts`
- `src/runner/StepExecutor.ts`
- `app/main/oracleService.ts`
- `app/main/ipc/oracle.ipc.ts`
- `app/renderer/pages/JavaRuntimeSettings.tsx`
- `app/renderer/pages/OracleDriverSettings.tsx`
- `oracle-jdbc-bridge/src/main/java/`

### Recorder

- `app/renderer/pages/Recorder.tsx`
- `app/main/ipc/recorder.ipc.ts`
- `app/main/preload.ts`
- `src/recorder/RecorderService.ts`
- `src/recorder/RecorderTypes.ts`
- `src/recorder/recorderInitScript.ts`
- `src/recorder/buildRecordedFlow.ts`
- `src/recorder/smartWaitObservation.ts`
- `src/profiles/asyncCompletionReview.ts`
- `src/security/ProtectedLoginDetector.ts`
- `src/security/browser/CertificateTrust.ts`
- `app/renderer/components/auth/ProtectedLoginHandoffPanel.tsx`
- `app/renderer/components/workflow/flowStepMapping.ts`
- `app/renderer/components/workflow/flowProfileMapping.ts`
- `src/runner/ExecutionEngine.ts`
- `src/runner/StepExecutor.ts`
- `mock-site/`

### System Reports

- `app/renderer/pages/ReportsOverview.tsx`
- `app/renderer/pages/ReportsWorkflows.tsx`
- `app/renderer/pages/ReportsInstances.tsx`
- `app/renderer/pages/ReportsFailures.tsx`
- `app/renderer/pages/ReportsRuntime.tsx`
- `app/renderer/pages/ReportsChrome.tsx`
- `app/renderer/pages/ReportsServer.tsx`
- `app/renderer/pages/ExecutionReports.tsx`
- `app/renderer/components/reports/ReportPage.tsx`
- `app/renderer/components/reports/RunDetailDrawer.tsx`
- `app/renderer/components/reports/useTelemetryQuery.ts`
- `app/renderer/components/reports/useRuntimeStatus.ts`
- `app/main/ipc/telemetry.ipc.ts`
- `src/reports/TelemetryContracts.ts`
- `src/reports/ObservabilityContracts.ts`
- `src/reports/observabilityAggregation.ts`
- `src/reports/ReportService.ts`
- `src/reports/SecretMasker.ts`
- `src/reports/StructuredLogger.ts`
- `src/runner/ExecutionEngine.ts`

### Settings

- `app/renderer/pages/Settings.tsx`
- `app/renderer/pages/JavaRuntimeSettings.tsx`
- `app/main/ipc/settings.ipc.ts`
- `app/main/ipc/secrets.ipc.ts`
- `app/main/preload.ts`
- `app/main/uiSettings.ts`
- `app/main/storagePaths.ts`
- `app/main/appPaths.ts`
- `app/main/offlineRuntimeValidator.ts`
- `app/main/oracleService.ts`
- `src/secrets/SecretStore.ts`
- `src/security/browser/CertificateTrust.ts`
- `src/security/authz/Permissions.ts`
- `app/main/security/sessionContext.ts`
- `src/offline/OfflineRuntimeValidator.ts`
- `src/storage/ProfileStore.ts`

### Cross-cutting routing, authorization, and navigation

- `src/runner/FlowExecutor.ts`
- `scripts/verify-comprehensive-e2e.mts`
- `app/renderer/routes.tsx`
- `app/main/ipc/index.ts`
- `src/security/authz/Permissions.ts`

Use these as starting points, not permission to edit all of them.

## Required implementation sequence

### Phase 0 — establish a clean, isolated baseline

1. Confirm the current branch, commit, and working tree.
2. Preserve unrelated changes.
3. Run the existing fast baseline suites before editing:

   ```text
   npm run typecheck
   npm run typecheck:scripts
   npm run verify:runner
   npm run verify:comprehensive-e2e
   ```

4. Record baseline results and evidence. `CMP-CON-002` should reproduce the known failure; any
   additional failure must be investigated rather than assumed pre-existing.
5. Use a unique temporary `LOCALAPPDATA` or equivalent isolated Electron profile for mutable GUI and
   Settings tests.
6. Use only synthetic users, secrets, telemetry, files, sessions, and loopback web targets.
7. Create a timestamped evidence root:

   `test-artifacts/full-validation-remediation/<run-id>/`
8. Preserve and index the historical baselines before creating new evidence:
   - `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/`
   - `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/`
   - `reports/browser-performance/phase5-ui-evidence/`
   - `reports/oracle-validation/oracle-soak.json`

### Phase 1 — fix AWKIT-E2E-001

Implement the confirmed fix and focused regression exactly as described above. After the focused test
passes, run:

```text
npm run typecheck
npm run typecheck:scripts
npm run verify:runner
npm run verify:comprehensive-e2e
npm run verify:concurrency
npm run verify:packaged-walkthrough
```

Do not continue to a broad refactor if the connector can be corrected with a smaller semantic change.

### Phase 2 — reconcile and complete the Oracle validation gates

#### Preserve the resolved Oracle regressions

The following are resolved defects, not open work. Keep their regressions green:

- `AWKIT-ORA-E2E-001`: scheduled rows must reach runner `currentRow`.
- `AWKIT-ORA-E2E-002`: structured connectors must resolve `currentRow.*`.
- `AWKIT-ORA-E2E-003`: Oracle DATE instants must map to `YYYY-MM-DD` only for HTML date controls.
- `HARNESS-007`: the terms-declined fixture must have real native required validation.

Do not rewrite these fixes unless a new failure proves the current implementation is wrong.

#### Reconcile the live-Oracle status

1. Inspect the historical artifact for the generic 7/7 `verify:oracle-live` pass.
2. Inspect the 7 PASS / 1 BLOCKED row-driven artifact.
3. Confirm that they tested different scopes and record that distinction in the ledger.
4. Ensure `scripts/verify-oracle-mock-ui-workflow.mts` supports an explicit real mode that uses the
   same persisted Data Source, flow, workflow, query, DOM mapping, two-instance bound, production
   ExecutionEngine, screenshots, logs, and report as database-free mode.
5. Real mode must fail closed when required environment variables are absent. It must never silently
   fall back to the mock bridge.

#### Execute ORA-LIVE-001 safely when the local authorized environment is available

1. Use PowerShell for `sqlplus / as sysdba`; Git Bash may mangle the argument.
2. Provision `SPECTER_MOCKUI.MOCK_FORM_CASES` with
   `scripts/oracle/local-19c-mock-ui-fixture.sql`.
3. Use the least-privilege `SPECTER_READER` account with only approved SELECT access.
4. Have an authorized human operator mint and enter a fresh high-entropy ephemeral password out of
   band. The coding agent must not retrieve, reconstruct, print, persist, or include the value in any
   prompt, command transcript, log, report, screenshot, profile, or artifact.
5. Configure:

   ```text
   AWKIT_ORACLE_LIVE_URL
   AWKIT_ORACLE_LIVE_USER
   AWKIT_ORACLE_LIVE_PASSWORD
   AWKIT_ORACLE_LIVE_CONFIRM_NONPROD=1
   AWKIT_ORACLE_LIVE_DRIVER_BUNDLE_ID
   AWKIT_ORACLE_LIVE_JAVA_RUNTIME_PROFILE_ID
   ```

6. Run the generic live matrix first, then the exact persisted workflow live mode.
7. Require exactly the same 8-row outcome: 7 success terminals and 1 native-validation blocked
   terminal.
8. Confirm prepared binds, row truncation, type conversion, read-only policy rejection, permission
   errors, cancellation, and secret redaction.
9. Have the authorized operator rotate the password again and lock `SPECTER_READER`; clear the
   injected environment values and verify no credential appears in shell history, logs, reports,
   screenshots, profiles, artifacts, or Git.
10. If authorized SYSDBA/database access is unavailable, leave `ORA-LIVE-001` as `BLOCKED` with the
    exact missing prerequisite. Do not invent a password or reuse a retired credential.

#### Validate packaging under the current selection model

1. Treat the user-selected Java/driver architecture as authoritative unless the product contract has
   explicitly changed.
2. Verify only the AWKIT bridge jar ships; a JRE, `ojdbc*.jar`, or `ucp*.jar` in packaged resources
   must fail validation.
3. Verify the app starts and non-Oracle workflows run with no Java installed.
4. Verify Snapshot Oracle Data Sources work without Java or database connectivity.
5. Verify live Oracle mode fails closed with a clear Settings configuration message when Java/driver
   is absent.
6. On a clean Windows x64 machine, configure a user-selected Java runtime and driver, validate the
   real bridge handshake/query, restart, and verify profile/secret-reference persistence.
7. Confirm shutdown invariants:
   - pending bridge requests = 0;
   - active JDBC requests = 0;
   - orphan Java processes = 0.
8. Investigate the “0 MB Oracle bundle” observation:
   - if it means no Oracle driver/JRE is bundled, classify it as expected and correct stale docs;
   - if the AWKIT bridge jar is missing or zero bytes, reproduce and fix the packaging defect.
9. Do not add UCP or pool metrics. This architecture uses direct JDBC.
10. If the dev host still cannot build portable/NSIS because of resource limits, preserve evidence
    and run the clean-machine gate on an approved better-resourced host; do not mark it passed locally.

#### Oracle regression commands

Run all applicable Oracle gates, including:

```text
npm run build:oracle-bridge
npm run prepare:oracle-runtime
npm run verify:oracle-bridge
npm run verify:oracle-bridge-real-build
npm run verify:oracle-sql-policy
npm run verify:oracle-profiles
npm run verify:oracle-data-source
npm run verify:oracle-lazy-resolution
npm run verify:oracle-runtime
npm run verify:oracle-java-runtime
npm run verify:oracle-driver-bundle
npm run verify:oracle-direct-jdbc
npm run verify:oracle-packaging
npm run verify:oracle-offline-bundle
npm run verify:oracle-runtime-prep
npm run verify:oracle-drivers-gui
npm run verify:oracle-mock-ui
npm run verify:oracle-mock-ui-workflow
npm run verify:oracle-live
npm run benchmark:oracle-jdbc
```

Run live/soak commands only with the approved non-production environment and ephemeral credential.
The existing 30-minute soak is a regression; any longer production-style soak requires an approved
environment and operational window.

### Phase 3 — build deterministic three-surface fixtures

Create or extend reusable fixtures that provide:

1. A loopback Recorder lab with:
   - text, email, number, date, textarea, select, checkbox, and radio controls;
   - duplicate/repeated containers for locator disambiguation;
   - a final focused input that is not blurred;
   - controlled loader, DOM mutation, response, download, navigation, and popup activity;
   - synthetic fields with password/token-like names for redaction checks;
   - false-positive protected-login signals;
   - explicit protected-login simulation that stops before any real authentication;
   - valid and intentionally invalid HTTPS variants where existing certificate fixtures permit.
2. Seeded report history with deterministic:
   - passed, failed, cancelled, queued, running, and recovered instances;
   - workflows with known counts, durations, p50/p95 values, trends, machine contexts, and failures;
   - error categories and sanitized evidence paths;
   - Chrome/process/resource samples;
   - storage directories with known byte totals;
   - enough instances to exercise pagination and filtering.
3. An isolated Settings profile with:
   - non-default appearance, branding, Recorder defaults, paths, runtime and execution values;
   - representative flows, workflows, data sources, reports, sessions, secret references, Java
     runtimes, and JDBC driver profiles;
   - known UI-only state so Clear UI State can be distinguished from user data;
   - valid, legacy, partial, malformed, oversized, unknown-version, and hostile import fixtures.

Fixtures must be deterministic, minimal, idempotent, and safe to clean up. Never seed a real
credential, cookie, authorization header, personal record, or production path.

### Phase 4 — complete Recorder coverage

Preserve the existing passing Recorder cases:

- `REC-005`, `REC-008`, `REC-009`, `REC-011`, `REC-012`, `REC-015`, `REC-020`, `REC-026`,
  and `REC-027`.

Implement and execute the following missing coverage:

#### Lifecycle and page integration

- `REC-001`: page access, idle state, control availability, and absence of stale data.
- `REC-002`: valid loopback start through Recorder UI, IPC, RecorderService, and real Chromium.
- `REC-003`: empty/malformed/unsafe/unreachable URLs and browser-launch failure recovery.
- `REC-004`: exact Stop versus Cancel behavior and draft retention/clearing.

#### Capture, redaction, waits, review, and recovery

- `REC-006`: live keystroke compaction to one final `fill` in memory and the persisted draft.
- `REC-007`: end-to-end sensitive input, URL, signal, flow, log, screenshot, and report redaction.
- `REC-010`: fixed waiting-time thresholds, disabled state, boundaries, and no wait inflation.
- `REC-013`: async review modal keyboard/pointer behavior and save gating.
- `REC-014`: valid, missing, empty, truncated, corrupt, and incompatible draft recovery.

#### Save and replay—the principal release gate

- `REC-016`: save through Recorder into Flow Library, reopen, and restart persistence.
- `REC-017`: blank, whitespace, long, Unicode, duplicate-name, and atomic write-failure behavior.
- `REC-018`: record through the actual Recorder page, stop, save, reopen, execute with the production
  `ExecutionEngine`, verify the browser outcome, then repeat after a Flow Designer open/save
  round-trip.

`REC-018` must validate:

1. exact recorded node sequence and supported action types;
2. locator and popup metadata preservation;
3. wait and async-completion metadata preservation;
4. output/report correctness;
5. screenshots and structured logs;
6. restart persistence;
7. no secret leakage;
8. no direct calls that bypass the Recorder page or production runner.

#### History, handoff, race, and recovery

- `REC-019`: recorded URL normalization, masking, deduplication, search, pagination, copy, reuse, and
  restart persistence.
- `REC-021`: ignore a false-positive protected-login detection for only the active Recorder session.
- `REC-023`: handoff cancel and capture-error recovery without an orphan browser or lost draft.
- `REC-024`: browser close/crash recovery.
- `REC-025`: single-active-recorder enforcement, rapid Start/Stop/Cancel commands, and idempotent
  cleanup.

`REC-022` requires an authorized person and approved test identity to complete the real Chrome
handoff. Never automate the protected login, MFA, CAPTCHA, OTP, passkey, or approval itself. Keep this
case `BLOCKED` if those inputs are not supplied. Contract and synthetic pre-handoff checks may run,
but they do not convert the manual case to `PASS`.

#### Authorization and accessibility

- `REC-028`: direct IPC plus UI authorization checks for users without `page.recorder` or relevant
  mutation permission.
- `REC-029`: keyboard-only operation, focus order/restoration, accessible names and status
  announcements, 200% zoom, narrow viewport, high contrast, and reduced motion.

Add maintainable scripts using the existing Electron GUI verifier conventions. Suitable names are:

```text
scripts/verify-recorder-gui.mjs
scripts/verify-recorder-e2e.mjs
```

Add corresponding npm scripts only after confirming no equivalent verifier already exists.

### Phase 5 — complete populated System Reports coverage

Preserve the existing passing Reports cases:

- `SYS-REP-001`, `SYS-REP-013`, and `SYS-REP-014`.

Implement and execute:

- `SYS-REP-002`: every time range, manual refresh, loading behavior, and rapid range/refresh stale
  response race.
- `SYS-REP-003`: Overview totals, statuses, duration statistics, rates, queue wait, and live counts
  against independently computed persisted truth.
- `SYS-REP-004`: workflow sorting and machine-context filters.
- `SYS-REP-005`: workflow comparison selection limits, deltas, empty selection, and removed workflow.
- `SYS-REP-006`: Recent Runs and Run Detail drawer identity, status, timings, steps, errors, evidence,
  close behavior, and focus restoration.
- `SYS-REP-007`: Instance Reports paging, filters, live statuses, terminal transitions, and no
  duplicate/missing rows.
- `SYS-REP-008`: stored report list, type/status/date filters, detail, export, and safe folder open.
- `SYS-REP-009`: failure categories, counts, reliability ranking, sanitized messages, and evidence.
- `SYS-REP-010`: capacity/history/anomaly calculations against independently computed fixtures.
- `SYS-REP-011`: Chrome gauges, polling lifecycle, pressure/backpressure state, process unavailable,
  navigation-away cleanup, and bounded timers.
- `SYS-REP-012`: process metrics, storage sizing, unreadable/missing directories, 20,000-entry bound,
  and cache behavior.
- `SYS-REP-015`: route and direct IPC authorization plus path traversal/symlink/absolute-path
  rejection for report artifacts and folder-open actions.
- `SYS-REP-016`: keyboard navigation, table/chart semantics, accessible status, focus management,
  200% zoom, narrow layout, high contrast, and reduced motion.

For every populated report assertion:

1. seed known durable data;
2. independently compute expected values from the fixture, not from the same product aggregation
   helper;
3. drive the real Reports page;
4. compare visible values and selected drill-down identity;
5. compare the backing durable store after refresh/restart;
6. verify errors and stale requests cannot overwrite newer selections;
7. verify no secret appears in cards, tables, drawers, exports, logs, or screenshots.

Create a focused populated GUI verifier if none exists, for example:

```text
scripts/verify-reports-populated-gui.mts
```

Reuse `scripts/seed-observability-fixtures.mts` where suitable, but do not let the expected-result
calculation call the same implementation being tested.

### Phase 6 — complete Settings coverage

Preserve the existing passing Settings cases:

- `SET-002`, `SET-003`, `SET-006`, `SET-010`, `SET-011`, `SET-012`, and `SET-014`.

Implement and execute:

- `SET-001`: page access, loading/error/success states, route permission, and direct IPC permission.
- `SET-004`: Recorder wait/Smart Wait defaults persist and affect only newly started sessions.
- `SET-005`: protected-login ignore confirmation, persisted scope, active-session behavior, and reset.
- `SET-007`: browse/reset/validate every path, missing/not-directory/unreadable/unwritable/long/Unicode
  behavior, and no renderer-controlled arbitrary folder opening.
- `SET-008`: designer and execution numeric/enum validation boundaries, invalid paste, blur, and
  save/reload behavior.
- `SET-009`: persisted execution defaults actually influence a new production run.
- `SET-013`: Secrets card availability, create, replace, list, delete, cancel, duplicate, validation,
  masking, keyboard behavior, and absence of plaintext from renderer state/logs/screenshots.
- `SET-015`: Data Storage counts, refresh, runtime folder, missing/unreadable stores, and exact
  configured-root behavior.
- `SET-016`: Clear UI State resets only UI keys and preserves flows, workflows, data sources,
  reports, sessions, secrets, drivers, and settings data.
- `SET-017`: export/import round-trip, no secret values in export, unknown/invalid field handling,
  and refusal to silently enable insecure certificate behavior.
- `SET-018`: malformed, wrong-type, oversized, invalid, legacy, partial, and unsupported-version
  import recovery without corrupting current settings.
- `SET-019`: reset cancel/confirm behavior and preservation of all user records, secret references,
  Java/JDBC profiles, and runtime artifacts.
- `SET-020`: offline runtime validation with complete, missing, and corrupt bundles; no network
  downloads or false success.
- `SET-021`: keyboard-only use, labels, groups, descriptions, validation associations, live status,
  confirmation focus, 200% zoom, narrow viewport, high contrast, and reduced motion.

Settings mutation tests must:

1. use a unique isolated application-data root;
2. snapshot the initial files and records;
3. verify the renderer result and persisted main-process result;
4. restart Electron and re-verify;
5. run direct unauthorized IPC calls, not only hidden/disabled-control checks;
6. prove that reset/clear/import operations do not delete out-of-scope user data;
7. clean up only the exact temporary root created by the test.

Create a complete page verifier if none exists, for example:

```text
scripts/verify-settings-gui.mjs
```

Do not merge all existing card-specific verifiers into one large brittle script. Keep shared Electron
launch, profile isolation, screenshot, log, and cleanup helpers reusable.

### Phase 7 — defect workflow for any new failure

For every newly failing case:

1. Run it at least twice when safe.
2. Reduce it to the smallest reliable reproduction.
3. Capture expected versus actual behavior.
4. Record affected commit, environment, role, page, browser, and frequency.
5. Capture sanitized screenshot, trace, console, main-process log, IPC error, durable-store state, and
   report where applicable.
6. Assign severity:
   - P0: compromise, irreversible corruption, unauthorized privileged action, critical outage.
   - P1: critical workflow unavailable/incorrect, material authorization weakness, no workaround.
   - P2: important incorrect behavior with limited impact or a reasonable workaround.
   - P3: minor functional, accessibility, compatibility, or cosmetic issue.
7. Add the failing regression before the product fix where practical.
8. Trace the root cause across renderer → preload → IPC → service/store/runner.
9. Implement the smallest compatible fix.
10. Rerun the focused case and the affected feature suite.
11. Rerun cross-feature regression when Settings affects Recorder/runtime or when runner behavior
    affects Reports.
12. Add the defect and evidence to `DEFECTS.md`. Do not log a defect for an environment-only blocker.

## Security and safety requirements

- Never bypass CAPTCHA, MFA, OTP, SSO, passkeys, protected approvals, bot detection, login policy, or
  certificate policy.
- Pause for an authorized human handoff where required.
- Never print, commit, persist, or screenshot real passwords, tokens, cookies, authorization headers,
  private keys, session state, Oracle credentials, or personal data.
- Use named secret references; do not place secret values in a flow, report, URL, test fixture, or
  renderer state.
- Test redaction at collection time, not only when rendering a report.
- Use loopback web targets and synthetic accounts only.
- Test authorization in the main process/direct IPC. A hidden page or disabled button is not a
  security boundary.
- Validate all artifact and folder paths in the main process. Test traversal, absolute-path injection,
  alternate separators, encoded traversal, symlinks/junctions where safe, missing paths, and
  unauthorized targets.
- Do not run destructive, load, or denial-of-service tests against production or an unapproved
  environment.

## UI, UX, and accessibility requirements

- Preserve the current modern AWKIT visual system and shared components.
- Cover loading, empty, success, warning, partial, disabled, validation, and error states.
- Provide visible focus and logical keyboard order.
- Associate form errors with the relevant controls.
- Give icon-only actions accessible names.
- Trap and restore focus correctly for dialogs and drawers.
- Announce asynchronous status and errors without noisy repeated announcements.
- Ensure tables and charts have understandable semantic or textual alternatives.
- Prevent clipping and horizontal loss at 200% zoom and narrow widths.
- Respect high-contrast modes and `prefers-reduced-motion`.
- Keep motion subtle and purposeful; never make test stability depend on animation timing.

## Reliability, concurrency, and persistence requirements

- Prefer observable event/state waits over fixed sleeps.
- Explicitly test rapid repeated clicks and stale in-flight results.
- Ensure Start/Stop/Cancel/Save/Refresh/Reset/Import are idempotent or safely rejected.
- Verify settings writes are serialized and flushed on shutdown.
- Verify Recorder has at most one active browser/session and leaves no orphan process.
- Verify report polling stops when a page unmounts and does not multiply after navigation.
- Verify every mutation survives restart where persistence is part of the contract.
- Verify failed writes/imports preserve the last valid state and do not create partial files.
- Verify Oracle runtime materialization remains single-flight for concurrent consumers.
- Verify direct JDBC limiter slots release after success, error, timeout, and cancellation.
- Verify bridge processes partition by Java/driver compatibility key and shut down without orphans.
- Verify database-free, snapshot, and non-Oracle workflows never require Java or live database access.
- Verify cleanup targets only the test-created temporary profile and artifact roots.

## Required test commands

Keep all existing passing suites green:

```text
npm run build
npm run typecheck:scripts
npm run verify:runner
npm run verify:comprehensive-e2e
npm run verify:waits
npm run verify:popup
npm run verify:popup-mock-site
npm run verify:cancellation
npm run verify:artifacts
npm run verify:failure-evidence-live
npm run verify:stress:concurrency
npm run verify:stress:cancellation
npm run verify:stress:locks
npm run verify:stress:artifacts
npm run verify:durable-store
npm run verify:startup-recovery
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
npm run verify:security
npm run verify:auth
npm run verify:authz
npm run verify:session-context
npm run verify:licensing
npm run verify:ipc-contract
npm run verify:concurrency
npm run verify:flow-step-mapping
npm run verify:workflow-sentinels
npm run verify:flow-designer
npm run verify:workflow-builder
npm run verify:packaged-runtime
npm run verify:packaged-walkthrough
```

Add and run focused npm commands for the new coverage. Preferred intent:

```text
npm run verify:recorder-gui
npm run verify:recorder-e2e
npm run verify:reports-populated-gui
npm run verify:settings-gui
```

If equivalent commands already exist, extend and use them instead of duplicating infrastructure.
Record every exact command, exit code, assertion count, duration, and artifact root.

## Evidence and reporting requirements

Every case must end as exactly one of:

- `PASS`
- `FAIL`
- `BLOCKED`
- `NOT RUN`
- `NOT APPLICABLE`

Create under the timestamped artifact root:

```text
execution-summary.json
full-test-report.md
traceability-matrix.csv
defects/
screenshots/
traces/
logs/
reports/
exports/
profile-snapshots/
```

Evidence requirements:

- one top-level summary reconciling all three campaigns;
- the comprehensive 9-case result ledger and exact executed-node sequences;
- the Oracle 8-case result ledger with bridge mode, query count, concurrency, terminal matrix, and
  live/mock classification;
- the 66-case Recorder/Reports/Settings ledger;
- screenshot before and after every critical mutation;
- trace/video for reproducible GUI failure where practical;
- sanitized renderer console and main-process logs;
- exact persisted files/database observations before and after mutation;
- flow/report IDs and execution IDs using synthetic data;
- process cleanup evidence for Recorder crash/cancel cases;
- bridge/JDBC cancellation and orphan-process evidence for Oracle cases;
- a credential-lifecycle note that records creation/retirement actions without the credential value;
- clean-machine OS/build/profile facts for packaged Oracle and full offline gates;
- exported report/settings files inspected for redaction;
- no large generated artifacts committed unless repository policy explicitly requires them.

Update:

- `RECORDER_REPORTS_SETTINGS_TEST_CASES.md`
- `TRACEABILITY_MATRIX.csv`
- `EXECUTION_RESULTS.md`
- `DEFECTS.md`
- `READINESS_SUMMARY.md`
- `TEST_CASES.md`
- `TEST_PLAN.md`
- `FIXTURES.md`
- `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md`
- `docs/ai/ORACLE_JDBC_RUNTIME_MATRIX.md`
- `docs/ai/CURRENT_STATE.md`
- `docs/ai/HANDOFF.md`
- `docs/ai/TASK_LOG.md`

Do not overwrite historical evidence. Append a new run and clearly identify superseded results.

## Acceptance criteria

The task is complete only when all of the following are true:

1. `AWKIT-E2E-001` has a regression, a minimal compatible fix, and evidence that Manual Handoff →
   `manualApproval` → End executes only after explicit resume.
2. The comprehensive campaign is 9 PASS / 0 FAIL.
3. Every previously passing comprehensive specialized suite remains green, including runner, waits,
   popups, concurrency, cancellation, evidence, stress, durable recovery, auth/RBAC/secrets,
   designer/builder, and packaged walkthrough.
4. All resolved Oracle workflow regressions remain green.
5. The generic live 19c matrix and exact persisted-workflow live gate are reported separately and
   consistently.
6. When an approved local 19c environment and ephemeral credential are available, `ORA-LIVE-001`
   produces the same 7 success / 1 blocked matrix as database-free mode, then the account is rotated
   and locked with no secret leakage. If unavailable, the case remains explicitly `BLOCKED` and the
   final release decision cannot claim full live-Oracle workflow readiness.
7. Oracle packaging proves only the AWKIT bridge jar ships; no JRE, ojdbc, or UCP is vendored.
8. The “0 MB Oracle bundle” observation is resolved as either an obsolete expected-driver warning
   corrected in documentation or a reproduced missing-bridge defect with a real fix.
9. The clean Windows Oracle/offline walkthrough passes on an approved host, or remains an explicit
   external gate that prevents an unconditional packaging claim.
10. All safe automatable Recorder cases pass.
11. `REC-018` passes through the real Recorder page, real launched browser, saved Flow Library entry,
   restart/reopen, Flow Designer round-trip, and production `ExecutionEngine`.
12. `REC-022` is either completed by an authorized person with approved synthetic credentials or
   remains explicitly `BLOCKED`; no security control is bypassed.
13. All System Reports cases pass with deterministic populated data, independently verified metrics,
   correct drill-down identity, safe export/open behavior, authorization, and accessibility.
14. All Settings cases pass with isolated persistence, direct IPC authorization, import/reset/clear
   data safety, path safety, Secrets GUI, offline validation, and accessibility.
15. No open P0 or P1 defect remains without explicit owner, containment, deadline, rollback plan, and
   documented risk acceptance.
16. Build, type checks, focused suites, security/auth/IPC suites, Oracle regressions, runner
    regression, concurrency, and packaged walkthrough pass.
17. No new flaky critical test, arbitrary sleep, orphan browser/Java process, unhandled rejection,
    console error, secret leak, partial write, or unsafe cleanup remains.
18. Every result has an evidence path and every defect has reproducible steps.
19. The readiness summary truthfully distinguishes passed automation, manual blockers, environmental
    blockers, and out-of-scope browser/platform claims.
20. Relevant changes are committed and pushed to `origin/main`; unrelated user files remain untouched.

## Final response required from the implementing agent

Report:

1. outcome first: fixed, remaining failures, and release recommendation;
2. exact commit(s) and pushed branch;
3. changed files grouped by comprehensive runner/browser, Oracle, Recorder, Reports, Settings,
   packaging, tests, and documentation;
4. results by campaign, case ID, and status;
5. exact commands and assertion counts;
6. new and resolved defects with severity and reproduction;
7. screenshot, trace, log, report, export, and profile-snapshot paths;
8. security, accessibility, concurrency, recovery, persistence, JDBC, and packaging observations;
9. anything blocked or not executed and the exact reason;
10. confirmation that no CAPTCHA/MFA/security control was bypassed and no secret was committed.

Do not declare full readiness merely because the specialized or component suites are green. Full
readiness requires a 9/9 comprehensive main campaign, truthful Oracle live/packaged gate status, the
integrated Recorder journey, populated Reports, and complete Settings journeys above.
