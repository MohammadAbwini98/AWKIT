# AWKIT Comprehensive End-to-End Validation Plan

## 1. Objective

Validate AWKIT as an installed automation product, not only as a collection of isolated functions. The campaign covers persisted flows and workflows, browser execution, all declared step and connector schemas, value propagation, parallelism, loops, retries, waits, artifacts, sessions, error handling, observability, recovery, authorization, Oracle integration boundaries, packaged/offline readiness, and feature-level Recorder, System Reports, and Settings behavior.

## 2. Test basis

- Repository: `C:\Users\moham\OneDrive\Desktop\AWTKIT`
- Primary browser: bundled Chromium, headless for repeatable automation and headed where the product UI is under test
- Safe target: AWKIT's loopback mock site on `127.0.0.1:4321`
- Main campaign: `npm run verify:comprehensive-e2e`
- Final main-campaign evidence: `test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z`
- Oracle row-driven campaign: `npm run verify:oracle-mock-ui-workflow`
- Oracle row-driven evidence: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z`
- Focused feature cases: `docs/testing/comprehensive-validation/RECORDER_REPORTS_SETTINGS_TEST_CASES.md`
- Test date: 2026-07-25/26, Asia/Amman
- Security rule: no CAPTCHA, MFA, OTP, protected-login, bot-detection, or security-control bypass

## 3. In scope

### Flow and workflow model

- All 30 declared `StepType` values
- All 9 `FlowEdgeType` values
- All 4 structured connector kinds
- All 10 declared value-source types
- Flow references, workflow flow references, input/output mappings, and cross-flow output propagation
- Sequential and parallel workflow execution
- Parallel flow branches, joins, conditions, outcome routing, loops, loop-back, failure, always, and manual-approval routing

### Browser behavior

- Navigation, click, fill, select, check, uncheck, radio, scroll
- Explicit waits and asynchronous network/UI completion
- Upload and download
- Text reads and assertions
- Screenshots and automatic failure evidence
- Popup creation, selection, aliasing, main-page restoration, and closure
- Manual handoff and protected-login handoff without automating the protected action
- Local session-state save; session reuse contracts through the dedicated runner suites

### Reliability and operations

- Step retry and failure routing
- Multiple instances, browser-slot caps, queuing, stop, stop-all, and hard cancellation
- Durable execution state, startup recovery, orphan detection, and reviewed recovery
- JSONL logs, reports, screenshots, traces, telemetry, runtime analytics, and GUI report views
- Authentication, authorization, secrets, licensing, and session context
- Packaged EXE, portable EXE, installer integrity, fresh-profile startup, bundled browser, and writable runtime paths
- Oracle policy, profile, data-source, lazy-resolution, runtime, and live-environment boundary
- Persisted Oracle Data Source → current row → connector routing → live form controls, including
  nullable values, decimal/date conversion, stale-state clearing, native validation, and the
  production `ExecutionEngine` data-driven scheduler

### Recorder, System Reports, and Settings

- Recorder page state, browser lifecycle, DOM-action capture, locator safety, sensitive-value
  redaction, wait observation, async review, draft/URL persistence, flow save, replay, popup identity,
  protected-login handoff, recovery, authorization, accessibility, and rapid-command behavior
- Reports Overview, Workflow/Instance/Failure/Runtime/Chrome/Server views, stored Execution Reports,
  real-history correctness, comparison/filtering, drill-down, export/path security, retention,
  observability, authorization, accessibility, loading/empty/error states
- Settings appearance/branding, Recorder security, paths, designer/execution/runtime defaults,
  secrets, Java/JDBC, storage counts, UI-state clearing, import/export, reset, offline validation,
  authorization, accessibility, persistence and concurrent writes

## 4. Out of scope or externally blocked

- Real CAPTCHA, MFA, OTP, SSO, protected-login completion, or anti-bot challenge automation
- Live Oracle query execution without an approved live URL, user, and password
- Clean/offline Windows VM certification; the local packaged run is not a substitute
- Production customer systems, external private APIs, or private data
- Firefox and WebKit product certification; AWKIT is Chromium-first
- Destructive data changes or write-capable Oracle SQL

These items receive `BLOCKED` or `NOT RUN`, never an inferred pass.

## 5. Environments and data

| Environment | Purpose | Data policy |
| --- | --- | --- |
| TypeScript/in-memory runner | Exhaustive step, routing, state, and error semantics | Synthetic only |
| Loopback mock site | Real Chromium DOM, network, popup, upload/download, and artifact behavior | Synthetic fixture records |
| Electron development UI | Flow Designer, Workflow Builder, reports, runtime analytics, auth and RBAC | Fresh or temporary profiles |
| Packaged `win-unpacked` and portable app | Installed-runtime, fresh-profile, process, recovery, installer, and network isolation | Temporary profile roots |
| Oracle policy/runtime harness | SQL policy, descriptors, redaction, snapshot/lazy resolution, real Java mock bridge | Synthetic profiles/snapshots |
| Oracle row-driven browser lab | Persisted Oracle Data Source/flow/workflow, 8 rows, two-instance bound, live DOM assertions | Synthetic `SPECTER_MOCKUI` twin |
| Live Oracle | Real database integration | Blocked until approved credentials exist |

Secrets used by the campaign are synthetic. Evidence must not contain real credentials.

## 6. Test strategy

1. Inventory the persisted schema and fail if a declared step, edge, connector, or value source is absent.
2. Run deterministic unit/integration suites for exhaustive engine behavior.
3. Run real Chromium scenarios against the loopback mock site for user-visible behavior.
4. Run persisted multi-flow workflows through the production runner.
5. Force safe failures and verify retry, routing, evidence, and recovery.
6. Exercise concurrency, cancellation, durable state, telemetry, reports, security, and packaged runtime with their specialized verifiers.
7. Execute focused Recorder, Reports, and Settings verifiers, but do not convert a component-level
   pass into a full Electron-journey pass.
8. Record every result as `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`.
9. Preserve exact artifact paths and reproduction data.

## 7. Entry criteria

- Dependencies installed and project scripts type-check
- Loopback port 4321 available or already serving the AWKIT mock site
- Bundled Chromium present for real-browser and packaged checks
- Test output roots writable
- No requirement to bypass a security control

## 8. Exit criteria

- Every declared node/edge/connector/value-source appears in the inventory
- Core live-browser campaign produces a machine-readable result ledger
- Specialized suites complete or are explicitly blocked
- Every failure has severity, reproducible steps, and evidence
- No zombie Electron or bundled-Chromium process remains after packaged tests
- Readiness decision identifies residual product defects and environmental gates

## 9. Status rules

- `PASS`: the stated expected result was directly observed.
- `FAIL`: execution completed and the expected result was not observed.
- `BLOCKED`: execution required unavailable authorization, credentials, infrastructure, or a manual security handoff.
- `NOT RUN`: deliberately excluded or not attempted; no claim is made.

## 10. Risks and controls

| Risk | Control |
| --- | --- |
| Silent path termination | Assert that terminal End nodes execute, not only that the flow returns `passed` |
| Race-prone popup/network tests | Arm listeners before actions and use deterministic loopback endpoints |
| False retry coverage | Use a deterministic read-only missing target and retain evidence for every attempt |
| Artifact path escape | Assert downloads remain inside the configured directory |
| Security bypass | Stop at manual/protected handoff and require explicit local resume |
| Stale packaged profile | Generate fresh temporary profile roots per run |
| Test-harness false negatives | Verify preload bridge/main window, authentication preconditions, and asynchronous report persistence |
| Overclaiming Oracle/offline readiness | Separate policy/runtime passes from live Oracle and clean-VM gates |
