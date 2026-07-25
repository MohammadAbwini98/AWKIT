# AWKIT Recorder, System Reports, and Settings Remediation Prompt

Use the following prompt with the coding agent that will implement, test, and document the remaining
Recorder, System Reports, and Settings work.

---

## Role

You are the senior engineer responsible for completing AWKIT's Recorder, System Reports, and Settings
release gates. Work as a combined Electron/React/TypeScript engineer, Playwright automation engineer,
security reviewer, accessibility specialist, persistence/concurrency engineer, and evidence-driven
test lead.

Treat AWKIT as a production desktop automation product. Preserve all working business logic,
Electron IPC contracts, persisted profile formats, authorization behavior, security controls,
offline behavior, routing, reports, and runtime integrations.

## Objective

Starting from commit `d0e24c7`, complete the following outcome:

1. Reproduce and fix the one confirmed open product defect, `AWKIT-E2E-001`.
2. Implement reliable automated coverage for every safe automatable Recorder, System Reports, and
   Settings case currently marked `NOT RUN`.
3. Execute the cases against the real local Electron application, production runner, durable store,
   loopback mock site, and bundled/installed Chromium where the case requires them.
4. For every newly reproduced failure, identify the root cause, implement the smallest safe product
   fix, add a regression, and rerun the focused and broader affected suites.
5. Preserve `BLOCKED` for CAPTCHA, MFA, OTP, SSO, passkeys, protected approvals, or any case that
   genuinely requires an authorized person or unavailable external environment.
6. Produce sanitized screenshots, traces, structured logs, execution reports, a defect ledger, and
   an updated release-readiness decision.
7. Do not stop after writing tests. Continue until all safe, in-scope, automatable cases pass or a
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

The detailed case document is authoritative for preconditions, steps, expected results, and current
status. Do not replace its exact requirements with shallow smoke checks.

## Current outcome baseline

| Surface | Total cases | PASS | NOT RUN | BLOCKED | Confirmed FAIL |
|---|---:|---:|---:|---:|---:|
| Recorder | 29 | 9 | 19 | 1 | 0 |
| System Reports | 16 | 3 | 13 | 0 | 0 |
| Settings | 21 | 7 | 14 | 0 | 0 |

The comprehensive real-browser campaign is separately at **8 PASS / 1 FAIL** because of
`AWKIT-E2E-001`.

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

   `test-artifacts/recorder-reports-settings-remediation/<run-id>/`

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

### Phase 2 — build deterministic three-surface fixtures

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

### Phase 3 — complete Recorder coverage

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

### Phase 4 — complete populated System Reports coverage

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
scripts/verify-reports-populated-gui.mjs
```

Reuse `scripts/seed-observability-fixtures.mts` where suitable, but do not let the expected-result
calculation call the same implementation being tested.

### Phase 5 — complete Settings coverage

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

### Phase 6 — defect workflow for any new failure

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
- Verify cleanup targets only the test-created temporary profile and artifact roots.

## Required test commands

Keep all existing passing suites green:

```text
npm run build
npm run typecheck:scripts
npm run verify:runner
npm run verify:comprehensive-e2e
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
npm run verify:ipc-contract
npm run verify:concurrency
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

- screenshot before and after every critical mutation;
- trace/video for reproducible GUI failure where practical;
- sanitized renderer console and main-process logs;
- exact persisted files/database observations before and after mutation;
- flow/report IDs and execution IDs using synthetic data;
- process cleanup evidence for Recorder crash/cancel cases;
- exported report/settings files inspected for redaction;
- no large generated artifacts committed unless repository policy explicitly requires them.

Update:

- `RECORDER_REPORTS_SETTINGS_TEST_CASES.md`
- `TRACEABILITY_MATRIX.csv`
- `EXECUTION_RESULTS.md`
- `DEFECTS.md`
- `READINESS_SUMMARY.md`
- `docs/ai/CURRENT_STATE.md`
- `docs/ai/HANDOFF.md`
- `docs/ai/TASK_LOG.md`

Do not overwrite historical evidence. Append a new run and clearly identify superseded results.

## Acceptance criteria

The task is complete only when all of the following are true:

1. `AWKIT-E2E-001` has a regression, a minimal compatible fix, and evidence that Manual Handoff →
   `manualApproval` → End executes only after explicit resume.
2. The comprehensive campaign is 9 PASS / 0 FAIL.
3. All safe automatable Recorder cases pass.
4. `REC-018` passes through the real Recorder page, real launched browser, saved Flow Library entry,
   restart/reopen, Flow Designer round-trip, and production `ExecutionEngine`.
5. `REC-022` is either completed by an authorized person with approved synthetic credentials or
   remains explicitly `BLOCKED`; no security control is bypassed.
6. All System Reports cases pass with deterministic populated data, independently verified metrics,
   correct drill-down identity, safe export/open behavior, authorization, and accessibility.
7. All Settings cases pass with isolated persistence, direct IPC authorization, import/reset/clear
   data safety, path safety, Secrets GUI, offline validation, and accessibility.
8. No open P0 or P1 defect remains without explicit owner, containment, deadline, rollback plan, and
   documented risk acceptance.
9. Build, type checks, focused suites, security/auth/IPC suites, runner regression, concurrency, and
   packaged walkthrough pass.
10. No new flaky critical test, arbitrary sleep, orphan browser process, unhandled rejection, console
    error, secret leak, partial write, or unsafe cleanup remains.
11. Every result has an evidence path and every defect has reproducible steps.
12. The readiness summary truthfully distinguishes passed automation, manual blockers, environmental
    blockers, and out-of-scope browser/platform claims.
13. Relevant changes are committed and pushed to `origin/main`; unrelated user files remain untouched.

## Final response required from the implementing agent

Report:

1. outcome first: fixed, remaining failures, and release recommendation;
2. exact commit(s) and pushed branch;
3. changed files grouped by Recorder, Reports, Settings, runner, tests, and documentation;
4. results by case ID and status;
5. exact commands and assertion counts;
6. new and resolved defects with severity and reproduction;
7. screenshot, trace, log, report, export, and profile-snapshot paths;
8. security, accessibility, concurrency, recovery, and persistence observations;
9. anything blocked or not executed and the exact reason;
10. confirmation that no CAPTCHA/MFA/security control was bypassed and no secret was committed.

Do not declare full readiness merely because the component suites are green. Full readiness requires
the integrated Recorder, populated Reports, and complete Settings journeys above.
