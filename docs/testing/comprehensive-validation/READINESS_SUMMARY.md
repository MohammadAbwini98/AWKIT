# AWKIT Final Readiness Summary

## Decision

**Current decision: NOT READY for an unconditional claim that every supported flow connector executes correctly.**

The product is otherwise in strong condition across the tested Chromium automation, workflow, concurrency, cancellation, recovery, reporting, security, UI, and packaged-runtime surfaces. The blocking product reason is `AWKIT-E2E-001`: a supported flow-level `manualApproval` connector can silently skip downstream work while returning success.

## What is ready

- Core browser automation against the authorized loopback application
- Persisted multi-flow workflows and cross-flow data passing
- Static, runtime, JSON, row, environment, generated, dynamic, instance, secret, and flow-output values
- Conditional, outcome, parallel, loop, loop-back, success, failure, and always routing
- Upload/download, asynchronous waits, popups, screenshots, and automatic failure evidence
- Step retry, recovery branches, hard cancellation, process cleanup, locks, and artifact isolation
- Durable store, startup orphan recovery, telemetry, logs, reports, and runtime analytics
- Authentication, authorization, session context, secrets, and licensing verifier coverage
- Flow Designer and Workflow Builder mapping and GUI coverage
- Packaged application resources and local fresh-profile execution
- Oracle read-only policy, profile, data-source, lazy-resolution, and runtime contracts without a live database
- Persisted Oracle row-driven form workflow without a database: real Java bridge protocol, one
  single-flight query, all 8 DOM mappings, two-instance concurrency, success/blocked terminals,
  production `ExecutionEngine`, screenshots, JSONL logs, and run report
- Recorder component engines: semantic locator/smart-wait capture, redaction, draft/URL persistence,
  async review, flow conversion, protected-login detection, popup identity and HTTPS trust
- Reports empty-state GUI plus telemetry/observability persistence and aggregation
- Settings capacity/persistence, certificate security, appearance/branding, encrypted secret store,
  and Java/JDBC driver cards

## What must be fixed or completed

1. Fix `AWKIT-E2E-001` and add a regression proving End/downstream execution after explicit manual approval.
2. Re-run `CMP-CON-002` and require the main campaign to reach 9/9 PASS.
3. Supply an approved Oracle test environment and execute the same persisted form workflow in real mode.
4. Resolve or explicitly waive the zero-megabyte packaged Oracle driver bundle warning.
5. Complete the clean/offline Windows VM release walkthrough.
6. Perform authorized manual CAPTCHA/MFA/SSO handoffs where those real provider paths are release requirements.
7. Execute REC-018: Recorder page → launched browser → recorded actions → Stop → Save to Flow Library
   → reopen → production replay, including evidence and restart persistence.
8. Execute populated System Reports truth/drill-down/export cases and remaining Settings paths,
   validation, Secrets GUI, import/export, reset/data-preservation, authorization and accessibility cases.

Firefox/WebKit remain outside the present Chromium-first certification unless product scope changes.

## Release recommendation

- **Core Chromium automation beta/internal use:** conditionally acceptable if flows using a flow-level `manualApproval` edge are prohibited or independently reviewed.
- **General release advertising complete supported connector coverage:** do not approve until `AWKIT-E2E-001` is fixed and the main campaign is all green.
- **Offline Oracle release claim:** do not approve until live Oracle and packaged-driver gates pass.
- **Database-free Oracle-to-UI workflow:** ready; current ledger is 7 PASS / 0 FAIL with the live-DB
  variant separately blocked.
- **Recorder feature release claim:** do not approve from component totals alone; REC-018 remains
  `NOT RUN`.
- **System Reports and Settings full-page certification:** not complete; focused case document records
  the exact remaining GUI, authorization and accessibility gates.

## Retest minimum

After the connector fix:

1. `npm run typecheck:scripts`
2. `npm run verify:runner`
3. `npm run verify:comprehensive-e2e`
4. `npm run verify:concurrency`
5. `npm run verify:packaged-walkthrough`

Acceptance requires:

- CMP-CON-002 executes Manual Handoff → End and reports pass.
- Main comprehensive ledger is 9 PASS / 0 FAIL.
- No regression in concurrency, packaged cancellation, recovery, artifacts, logs, or reports.
- All external gates remain explicitly marked until actually executed.
