# AWKIT Final Readiness Summary

## Decision

**Current decision (2026-07-26): the connector-coverage blocker is cleared; full release readiness is
still NOT established, for coverage and external-gate reasons rather than a known defect.**

`AWKIT-E2E-001` — the one confirmed open product defect — is **fixed and regression-covered**. The main
comprehensive campaign is **9 PASS / 0 FAIL** and `npm run verify:runner` is **89/89**. There is no
longer a known defect in flow-level connector routing.

That does **not** make the product release-ready. What changed is the *reason* it is not:

- previously: a confirmed S2 routing defect;
- now: unexecuted coverage (41 remaining `NOT RUN` Recorder/Reports/Settings cases; REC-018,
  SYS-REP-002/003 and SET-001/018 are now PASS) and external gates that need an operator, a
  database, or a clean machine.

A green specialized suite is not certification of the corresponding user journey.

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
- Recorder critical journey: real UI capture/save, full restart and Flow Library reopen, two
  production replays with exact node/log/report order, and Flow Designer metadata preservation
- Reports empty-state GUI plus populated persisted Overview truth and range/refresh behavior;
  telemetry/observability persistence and aggregation; authorization/path-boundary checks; and full
  redacted stored-report export
- Settings real-Electron core journey at 116/116: sender-bound authorization, every section,
  main-process validation, path truth, Secrets CRUD/restart/no-plaintext, counts, UI-state reset,
  export/import recovery, reset safety, modal/error accessibility and restart checks; plus the
  existing capacity/persistence, certificate, appearance/branding and Java/JDBC suites

## What must be fixed or completed

1. ~~Fix `AWKIT-E2E-001` and add a regression proving End/downstream execution after explicit manual
   approval.~~ **Done 2026-07-26** (bead `awkit-3eo`); see `DEFECTS.md`.
2. ~~Re-run `CMP-CON-002` and require the main campaign to reach 9/9 PASS.~~ **Done** —
   `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/`.
3. ~~Re-run `npm run verify:packaged-walkthrough` against a **freshly packaged** tree.~~ **Done** —
   `package:portable` rebuilt, walkthrough **70/70**, and the verifier now refuses a stale tree
   outright (negative-controlled).
4. Supply an approved Oracle test environment and execute the same persisted form workflow in real mode
   (bead `awkit-7bu`).
5. ~~Resolve or explicitly waive the zero-megabyte packaged Oracle driver bundle warning.~~
   **Closed 2026-07-26 as not a defect; no waiver needed.** There was never an Oracle warning — the
   validator printed a rounded informational size (`42,893 bytes` → `0 MB`) for a bundle that
   correctly contains only AWKIT's 40 KB bridge jar. Java and the Oracle driver are user-selected and
   the validator *fails* if either is vendored. Output now reads KB below 1 MB. See
   `EXECUTION_RESULTS.md` › Additional offline note.
6. Complete the clean/offline Windows VM release walkthrough.
7. Perform authorized manual CAPTCHA/MFA/SSO handoffs where those real provider paths are release requirements.
8. ~~Execute REC-018: Recorder page → launched browser → recorded actions → Stop → Save to Flow
   Library → reopen → production replay, including evidence and restart persistence.~~
   **Done 2026-07-26 — 41/41**, including a designer round-trip and second replay; evidence under
   `test-artifacts/recorder-e2e/2026-07-26T08-59-26-977Z/`.
9. ~~Execute the first populated System Reports truth/drill-down/export campaign.~~ **Core done
   2026-07-26 — 64/64 assertions**, closing SYS-REP-002/003 and fixing `AWKIT-REP-001/002`.
   Complete the exact remaining Reports submatrices (including the real OS folder launch,
   five-workflow compare cap, live/backpressure, fault injection, denial-audit evidence and
   accessibility).
10. ~~Execute the first full Settings page/IPC/data-safety campaign.~~ **Core done 2026-07-26 —
    116/116 assertions**, closing SET-001/018 and fixing `AWKIT-SET-001` through `004`. Complete the
    exact residual Settings submatrices: live Recorder/session propagation, picker/OS-launch and
    read-only paths, new-designer/runner propagation, unavailable/rapid secret store, unreadable
    stores, session/driver preservation inventory, missing/corrupt offline dependencies, 200% zoom,
    high contrast and the complete accessible-name audit.

Firefox/WebKit remain outside the present Chromium-first certification unless product scope changes.

## Release recommendation

- **Core Chromium automation beta/internal use:** acceptable. The `manualApproval` restriction is
  lifted — the connector is now routed only after an explicit resume, and a skipped approval fails the
  flow instead of reporting success.
- **General release advertising complete supported connector coverage:** the defect gate is met —
  9/9 campaign, 89/89 runner, and 70/70 packaged walkthrough against a package rebuilt after the fix.
- **Offline Oracle release claim:** do not approve until live Oracle and packaged-driver gates pass.
- **Database-free Oracle-to-UI workflow:** ready; current ledger is 7 PASS / 0 FAIL with the live-DB
  variant separately blocked.
- **Recorder feature release claim:** the decisive REC-018 journey is approved at 41/41. Other
  focused Recorder cases retain their individual `PASS`/`BLOCKED`/`NOT RUN` status; do not infer
  those unexecuted cases from REC-018.
- **System Reports full-page certification:** materially advanced but not complete. The populated
  real-Electron gate is 64/64, SYS-REP-002/003 are PASS, and both defects are resolved. Reports stand
  at 5 PASS / 11 NOT RUN because partially covered cases retain `NOT RUN` until their final subcases
  execute.
- **Settings full-page certification:** materially advanced but not complete. The core
  real-Electron gate is 116/116 and the four reproduced defects are resolved. Settings stand at
  9 PASS / 12 NOT RUN because the residual integration, fault and accessibility submatrices above
  were not executed.

## Retest minimum

After the connector fix:

1. `npm run typecheck:scripts`
2. `npm run verify:runner`
3. `npm run verify:comprehensive-e2e`
4. `npm run verify:concurrency`
5. `npm run verify:packaged-walkthrough`
6. `npm run verify:reports-populated-gui`
7. `npm run verify:settings-e2e`
8. `npm run verify:e2e-rbac`

Acceptance requires:

- CMP-CON-002 executes Manual Handoff → End and reports pass.
- Main comprehensive ledger is 9 PASS / 0 FAIL.
- No regression in concurrency, packaged cancellation, recovery, artifacts, logs, or reports.
- All external gates remain explicitly marked until actually executed.
