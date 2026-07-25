# AWKIT Detailed Test Cases

Status reflects the 2026-07-25/26 execution. Exact command and artifact locations are in `EXECUTION_RESULTS.md`.

## CMP-INV-001 — Persisted schema inventory

**Preconditions:** Comprehensive fixture directory is readable.

**Steps:**

1. Load every comprehensive flow and workflow JSON fixture.
2. Collect declared step types, edge types, structured connector kinds, and value-source types.
3. Compare the result with AWKIT's exhaustive type inventories.

**Expected:** All 30 step types, 9 edge types, 4 connector kinds, and 10 value-source types are represented; no unknown value is present.

**Result:** `PASS` — inventory JSON records the exact sets.

## CMP-FLOW-001 — Core browser actions and cross-flow data

**Preconditions:** Mock site is running; synthetic runtime, row, environment, JSON, secret, and instance values are available.

**Steps:**

1. Open the customer form in Chromium.
2. Fill text inputs from static, runtime-input, current-row, JSON, environment, secret, dynamic, generated, and instance sources.
3. Select multiple skills; check, uncheck, and select a radio option.
4. Scroll, read text, assert visibility/text, and capture a screenshot.
5. Execute condition and loop nodes.
6. Call the data-consumer flow with `runFlow`.
7. Pass and republish a heading through flow output mappings.

**Expected:** The live DOM contains every resolved value; generated data matches its pattern; all actions succeed; the child flow receives the parent value; a screenshot is written.

**Result:** `PASS`.

## CMP-IO-001 — Upload, asynchronous waits, and download

**Preconditions:** A temporary upload file exists; configured download directory is empty and writable.

**Steps:**

1. Navigate to the mock upload/download page.
2. Select the temporary file with `uploadFile`.
3. Submit the upload while a response listener is armed before the action.
4. Wait for both the network completion and visible success UI.
5. Map the returned/visible value to flow output.
6. Trigger `downloadFile`.
7. Inspect the downloaded path, name, and contents.

**Expected:** Upload is accepted; the response is not missed; success UI appears; output is populated; one CSV is downloaded inside the configured root with expected deterministic data.

**Result:** `PASS`.

## CMP-CON-001 — Conditional, outcome, parallel, loop, and loop-back routing

**Preconditions:** Structured connector fixture is loaded.

**Steps:**

1. Start the connector flow and evaluate multiple conditional branches.
2. Verify the highest-priority satisfied condition is selected.
3. Fan out across a shared-page parallel connector and join.
4. Route by step outcome.
5. Inject a bounded count loop.
6. Follow a bounded loop-back edge and exit to End.

**Expected:** Only the correct conditional/outcome path executes; all parallel branches complete under the configured join; loops execute the expected number of times; End executes.

**Result:** `PASS`.

## CMP-CON-002 — Flow-level manual-approval continuation

**Preconditions:** In-memory flow contains Start → Manual Handoff → `manualApproval` edge → End; test controller is authorized to resume the synthetic handoff.

**Steps:**

1. Run the flow until it pauses at Manual Handoff.
2. Resume it through the handoff controller.
3. Wait for flow completion.
4. Inspect executed node IDs and overall result.

**Expected:** The `manualApproval` edge is selected, End executes, and the flow reports passed.

**Result:** `FAIL` — the flow reports passed but End is absent from the execution trace. See `AWKIT-E2E-001`.

## CMP-ERR-001 — Retry, failure evidence, failure edge, and recovery

**Preconditions:** Evidence root is writable; a deterministic missing DOM target is configured.

**Steps:**

1. Execute the failing read-only browser step with retry enabled.
2. Allow all configured attempts to fail.
3. Inspect attempt records and per-attempt evidence.
4. Verify the failure connector is selected.
5. Execute the recovery branch through End.

**Expected:** Retry count is exact; each attempt retains PNG, DOM HTML, accessibility YAML, and metadata JSON; the flow continues through failure routing and finishes recovered.

**Result:** `PASS`.

## CMP-POP-001 — Popup and multi-window lifecycle

**Preconditions:** Popup fixture and mock popup page are available.

**Steps:**

1. Trigger a fast target-blank popup with capture armed before click.
2. Switch to the popup by alias and perform an action.
3. Switch back to the main page and assert its identity.
4. Trigger a delayed popup and discover it.
5. Target the popup, validate content, close it, and restore the main page.

**Expected:** Popup identities remain stable; actions target the intended page; close removes the popup; main-page execution resumes.

**Result:** `PASS`.

## CMP-WF-001 — Persisted multi-flow workflow

**Preconditions:** Core producer, data consumer, I/O, and popup flows plus workflow JSON are loaded.

**Steps:**

1. Persist all referenced flows and the workflow.
2. Run the workflow through the production Playwright runner.
3. Execute producer → consumer → I/O → popup stages.
4. Inspect flow results, mappings, and final workflow status.

**Expected:** Every required flow passes in order; mapped output survives stage boundaries; workflow result is `passed`.

**Result:** `PASS`.

## CMP-MAN-001 — Safe handoffs and local session save

**Preconditions:** Synthetic loopback flow; local controller can acknowledge handoffs; session directory writable.

**Steps:**

1. Execute Manual Handoff and wait for the paused state.
2. Resume through the controller.
3. Execute Protected Login Handoff without entering credentials or bypassing a control.
4. Resume through the controller.
5. Save browser storage state locally.

**Expected:** Both pauses are explicit and resumable; no CAPTCHA/MFA/OTP/login action is automated; valid session-state JSON is written.

**Result:** `PASS`.

## ENG-001 — Exhaustive runner semantics

**Preconditions:** TypeScript runner test harness available.

**Steps:** Run `verify:runner`; exercise step dispatch, connectors, conditions, loops, subflows, output mappings, manual/session routes, and error outcomes.

**Expected:** All runner assertions pass.

**Result:** `PASS` — 84/84.

## WAIT-001 — Wait-condition matrix

**Preconditions:** Deterministic page/network fakes and cancellation signals available.

**Steps:** Run the wait verifier across selectors, text, navigation, network idle, response status, API polling, loader lifecycle, grouped completion, optional waits, timeouts, and cancellation.

**Expected:** Success, timeout, optional, grouped, and cancellation semantics match their contracts.

**Result:** `PASS` — 56/56.

## POP-002 — Popup regression suites

**Preconditions:** Bundled Chromium and loopback mock site available.

**Steps:** Run base popup, popup identity, and popup mock-site suites.

**Expected:** Popup detection, alias identity, switching, closure, and race handling pass.

**Result:** `PASS` — 12/12, 43/43, and 11/11.

## REL-001 — Concurrency, cancellation, locks, and artifact isolation

**Preconditions:** Temporary runtime roots writable.

**Steps:**

1. Run baseline concurrency and hard-cancellation suites.
2. Run concurrency, cancellation, lock, and artifact stress suites.
3. Observe active slots, queued instances, terminal status, released locks, and per-instance artifact roots.

**Expected:** Caps are never exceeded; excess work queues; cancellation terminates browsers; locks release; artifacts never collide.

**Result:** `PASS` — baseline 78/78 and 12/12; stress 13/13, 8/8, 10/10, and 7/7.

## REC-001 — Durable state and startup recovery

**Preconditions:** Durable store enabled; temporary runtime database writable.

**Steps:** Persist runs and attempts, simulate interrupted startup state, restart recovery services, list recoverable runs, fetch details, and mark reviewed.

**Expected:** Durable records remain readable; orphaned work is not silently resumed; safe/manual review classification and cleanup are correct.

**Result:** `PASS` — durable store 11/11; startup recovery 10/10.

## OBS-001 — Telemetry, logs, reports, and analytics

**Preconditions:** Run history and report fixtures available.

**Steps:** Generate runtime observations and logs; open report and analytics GUI paths; exercise normal, empty, migration, and high-data states.

**Expected:** Structured records contain run/node identifiers; report models and GUI render correctly; analytics screenshots are captured.

**Result:** `PASS` — telemetry 61/61, observability 65/65, reports GUI 31/31, runtime analytics GUI 36/36.

## SEC-001 — Authentication, authorization, sessions, secrets, and licensing

**Preconditions:** Fresh synthetic local profiles; no real credentials.

**Steps:** Execute auth, security-policy, RBAC, session-context, secret-storage/redaction, and licensing verifier suites.

**Expected:** Unauthorized actions are rejected; allowed actions succeed; context remains isolated; secrets are redacted; licensing decisions are deterministic.

**Result:** `PASS` — 49/49, 39/39, 40/40, 11/11, 16/16, and 56/56.

## ORA-001 — Oracle policy and integration boundary

**Preconditions:** No live database is needed for policy/profile/data-source tests.

**Steps:**

1. Validate read-only SQL policy and rejection of write-capable statements.
2. Validate connection profiles, descriptors, redaction, data-source snapshots, lazy resolution, and runtime-node contracts.
3. Probe live-container and environment configuration.

**Expected:** All offline/integration contracts pass; live execution runs only when approved connection variables are present.

**Result:** `PASS` for policy/profile/data-source/runtime/lazy suites (30/30, 22/22, 28/28, 36/36, 20/20). `BLOCKED` for live Oracle because the container is absent and URL/user/password are not configured.

## ORA-WF-001 — Persisted Oracle form workflow and production pre-run gate

**Preconditions:** The credential-free Data Source, flow, and workflow JSON fixtures exist.

**Steps:**

1. Load all three persisted profiles.
2. Validate the flow set with the shared validator.
3. Convert the workflow to a scenario.
4. Run the same production pre-run gate used by the application.
5. Inspect the persisted Data Source for secret-shaped fields.

**Expected:** Zero flow/set/pre-run issues; runtime Oracle mode; no password or secret value persisted.

**Result:** `PASS`.

## ORA-WF-002 — Real bridge materialization and single-flight cache

**Preconditions:** JDK 17 and the bridge source are available; no Oracle database is required.

**Steps:**

1. Build and spawn the real Java bridge with explicit development mock mode.
2. Resolve the persisted Oracle Data Source through `OracleQueryService` and `DataSourceResolver`.
3. Materialize it from three concurrent consumers.
4. Inspect bridge handshake, query counter, service metrics, and rows.

**Expected:** The bridge identifies itself as mock mode; exactly one real `executeQuery` RPC runs; all
three consumers share the same 8-row result; no DB credential is read or written.

**Result:** `PASS`.

## ORA-WF-003 — All Oracle values reach compatible live form controls

**Preconditions:** Feature Test Lab `/form` and real Chromium are available.

**Steps:**

1. Run an inspection form flow once for each of the 8 rows.
2. Assert text, nullable text, integer, two-decimal salary, local calendar date, selects,
   multi-select, textarea, radio, and checkboxes in the live DOM.
3. Assert unmapped password/file controls remain empty.
4. Capture a populated-form screenshot for every row.

**Expected:** Every field equals its row value; NULL renders empty rather than `"null"`; a NULL date
and gender select nothing; 0-valued controls are clear.

**Result:** `PASS`.

## ORA-WF-004 — Reused-page stale checkbox recovery

**Preconditions:** The `interests-unchecked` row exists.

**Steps:**

1. Open `/form` and pre-check both interest boxes.
2. Run the row mapping without re-navigation.
3. Inspect executed connector branches and final DOM state.

**Expected:** Both explicit uncheck branches execute and both controls finish clear.

**Result:** `PASS`.

## ORA-WF-005 — Isolated row-driven workflow concurrency

**Preconditions:** Persisted workflow concurrency is 2.

**Steps:**

1. Run all 8 rows through separate `PlaywrightRunner` instances with a two-worker limit.
2. Confirm seven success terminals and one expected-block terminal.
3. Confirm two screenshots per row and per-row result JSON.
4. Repeat through the production `ExecutionEngine` in `dataDrivenConcurrent` mode.
5. Inspect queue/backpressure, run-level report, eight JSONL logs, and sixteen engine screenshots.

**Expected:** Maximum active instances is exactly 2; all 8 engine instances complete; row-specific
`currentRow` values and connectors work; 7 rows reach success and the negative row reaches blocked End.

**Result:** `PASS`.

## ORA-WF-006 — Native terms-required negative path

**Preconditions:** The `terms-declined-negative` row has `ACCEPT_TERMS=0`.

**Steps:**

1. Fill the complete row and explicitly leave terms unchecked.
2. Click Submit.
3. Inspect URL, native `validity.valueMissing`, retained first name, connector route, and screenshot.

**Expected:** Browser remains on `/form`; terms reports `valueMissing=true`; the success branch does
not execute; the blocked assertions and blocked End execute.

**Result:** `PASS`.

## ORA-LIVE-001 — Same workflow against real Oracle 19c

**Preconditions:** Authorized SYSDBA provisioning and a freshly minted ephemeral `SPECTER_READER`
password supplied out of band.

**Steps:** Provision `SPECTER_MOCKUI`, export approved `AWKIT_ORACLE_LIVE_*` values, run the live gate,
then rotate and lock the account.

**Expected:** The same persisted query and workflow produce the same 7 success/1 blocked matrix in real mode.

**Result:** `BLOCKED` — credentials were not supplied; no attempt was made to recover or invent them.

## UI-001 — Flow Designer and Workflow Builder

**Preconditions:** Electron development UI can launch.

**Steps:** Create/edit nodes and connectors, persist/reload diagrams, validate step mapping, exercise workflow builder controls, and run sentinels.

**Expected:** UI-to-profile mapping is lossless; supported items remain editable; sentinel and GUI assertions pass.

**Result:** `PASS` — flow mapping 101/101, workflow sentinels 4/4, Flow Designer GUI 56/56, Workflow Builder GUI 20/20.

## PKG-001 — Packaged runtime and installer

**Preconditions:** `dist/win-unpacked`, portable EXE, installer, and `latest.yml` exist.

**Steps:**

1. Verify packaged resources, app archive, bundled Chromium, WASM, runtime database, and writable artifact paths.
2. Launch on a fresh profile and authenticate with the script's synthetic local first-run account.
3. Import and execute a persisted workflow.
4. Verify logs, screenshots, reports, and state.
5. Exercise cancellation, concurrent cap/queue, recorder, hard kill, restart recovery, portable boot, installer hash, and network isolation.

**Expected:** All checks pass; no non-loopback connection or zombie process remains.

**Result:** `PASS` — packaged walkthrough 69/69; independent packaged-runtime check 25/25.

## ENV-001 — Offline and protected external gates

**Preconditions:** Approved clean Windows VM, real protected account, and/or live Oracle credentials.

**Steps:** Execute only with authorized environment and manual security handoff.

**Expected:** Evidence is collected without bypassing controls.

**Result:** `NOT RUN` for clean/offline VM and Firefox/WebKit; `BLOCKED` for CAPTCHA/MFA/protected-login completion and live Oracle.
