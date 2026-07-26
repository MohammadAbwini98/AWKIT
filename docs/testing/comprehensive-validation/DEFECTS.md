# AWKIT Comprehensive Validation Defects

## Open product defects

None. `AWKIT-E2E-001` was the only confirmed open product defect and is resolved below.

## Resolved comprehensive-campaign defects

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

- Live Oracle: blocked because no approved URL/user/password is configured and the local Oracle container is absent.
- ~~Oracle packaged driver bundle: local development offline validation reported a zero-megabyte
  Oracle bundle warning.~~ **Withdrawn 2026-07-26 — never a defect or a warning.** `validate:offline`
  emits no Oracle warning and exits 0; the "0 MB" was an informational rounded size for a bundle whose
  measured contents are AWKIT's 40,550-byte bridge jar plus manifest and checksums (42,893 bytes
  total). Shipping zero Oracle driver bytes is the enforced user-selected-driver model, not a gap. See
  `EXECUTION_RESULTS.md` › Additional offline note.
- Clean/offline Windows VM walkthrough: not run.
- CAPTCHA/MFA/OTP/protected-login completion: intentionally blocked for authorized manual handoff.
- Firefox/WebKit certification: not run under this Chromium-first scope.
