# Recorder, System Reports, and Settings Test Cases

## 1. Purpose and status rules

This focused package closes the test-design gap for three application surfaces that were only
represented by suite totals in the original comprehensive campaign:

1. Recorder — highest priority because it spans the Electron page, browser launch, injected capture
   script, locator generation, protected-login handoff, draft persistence, flow creation, and replay.
2. System Reports — Reports Overview, Workflow Reports, Instance Reports, Failure Analytics, Runtime
   Analytics, Chrome Consumption, Server Performance, and stored Execution Reports.
3. Settings — application appearance, Recorder security, paths, execution/runtime defaults, secrets,
   Java/JDBC configuration, storage information, imports/exports, reset, and offline validation.

Status is restricted to `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, or `NOT APPLICABLE`.

- `PASS` means the exact scope stated in that case was executed and observed.
- A component-level `PASS` does not imply that the full Electron user journey passed.
- `BLOCKED` means an external/manual prerequisite is required.
- `NOT RUN` identifies newly specified coverage that still needs automation or manual execution.

Execution date: 2026-07-26 (Asia/Amman). Baseline commit: `cfe4594`.

## 2. Safety and evidence controls

- Use only AWKIT's loopback mock site and synthetic accounts/data.
- Never automate CAPTCHA, MFA, OTP, passkeys, signatures, protected approvals, or real login
  completion. Pause for an authorized manual handoff.
- Never persist a password, OTP, card value, token, cookie, authorization header, or secret in a
  recorded action, URL history, flow, log, screenshot, report, or test fixture.
- Run mutable Settings tests against an isolated temporary application-data root and restore values
  when a verifier intentionally uses an existing profile.
- Do not open arbitrary filesystem paths from a renderer-controlled value; path-opening checks must
  remain inside the configured runtime roots.

## 3. Recorder cases

### REC-001 — Recorder page access and idle state

- **Priority / layer:** P0 / Electron GUI
- **Preconditions:** Authenticated user has `page.recorder`; no recording or handoff is active.
- **Steps:** Open Recorder; inspect Target URL, Smart waits, Capture waiting time, Start, Stop, Cancel,
  Recorded Actions, Save Options, and Recorded URLs; inspect initial enabled/disabled states.
- **Expected:** Page loads without console errors; status is Idle; Start is enabled; Stop/Cancel/Save
  are disabled; the URL is editable; no stale action or handoff is displayed.
- **Status:** `NOT RUN` — no current verifier drives the Recorder page itself.

### REC-002 — Start a recording from a valid loopback URL

- **Priority / layer:** P0 / Electron → IPC → RecorderService → Chromium
- **Preconditions:** Mock site is available at `/recorder-lab`; bundled Chromium is available.
- **Steps:** Enter the loopback URL; enable Smart waits; click Start Recording; wait for the separate
  browser; inspect Recorder status and Target URL controls.
- **Expected:** Exactly one browser session opens at the target; status becomes Recording; target and
  capture toggles are locked; Stop/Cancel become enabled; the first action is a sanitized `goto`.
- **Status:** `NOT RUN` — the packaged walkthrough proves launch/cancel, but not this complete page path.

### REC-003 — Invalid URL and browser-launch failure recovery

- **Priority / layer:** P0 / validation and recovery
- **Preconditions:** Recorder is idle.
- **Steps:** Try empty, malformed, unsupported-scheme, refused-loopback, and unreachable URLs; simulate
  browser launch failure; then retry with a valid loopback URL.
- **Expected:** Unsafe/invalid targets do not leave a live recorder; a useful error is shown; no orphan
  browser remains; Start is re-enabled; a later valid start succeeds.
- **Status:** `NOT RUN`.

### REC-004 — Stop versus Cancel lifecycle

- **Priority / layer:** P0 / Electron GUI and persistence
- **Preconditions:** A recording contains at least three actions.
- **Steps:** Stop one session; verify actions remain and Save is enabled. Start a second session,
  create actions, then Cancel.
- **Expected:** Stop closes the browser and retains final actions for review/save. Cancel closes the
  browser, clears actions and draft, disables Save, and retains reusable URL history only.
- **Status:** `NOT RUN`.

### REC-005 — Core DOM controls become correct recorded action types

- **Priority / layer:** P0 / real Chromium capture script
- **Preconditions:** Recorder capture script is injected into a synthetic page.
- **Steps:** Click a button; type in text/email/number/date/textarea controls; select an option; check
  and uncheck a checkbox; choose a radio; stop without blurring the last text input.
- **Expected:** Actions are `click`, `fill`, `select`, `check`, `uncheck`, and `radio` as appropriate;
  locators are usable; the final focused input value is captured.
- **Status:** `PASS` — `npm run verify:recorder`, 78/78.

### REC-006 — Live typing is compacted to one final fill action

- **Priority / layer:** P0 / RecorderService binding
- **Preconditions:** A live RecorderService session is active on a text field.
- **Steps:** Type a multi-character value one key at a time without blurring; inspect in-memory and
  persisted draft actions; stop recording.
- **Expected:** Consecutive fills for the same page and locator collapse to one action containing the
  final value; draft size does not grow per keystroke.
- **Status:** `NOT RUN` — capture-without-blur passed, but service-level compaction was not exercised.

### REC-007 — Sensitive input and signal redaction

- **Priority / layer:** P0 / security
- **Preconditions:** Synthetic fields represent password, OTP, passcode, PIN, CVV/CVC, card number,
  SSN, token, and secret inputs.
- **Steps:** Enter canary values; trigger input/change; generate network and URL signals; inspect
  actions, draft, flow JSON, logs, and diagnostics.
- **Expected:** Steps may be recorded, but sensitive values are empty or secret references; network
  data stores method/path only; query strings, bodies, headers, cookies, tokens, and canaries do not
  appear anywhere.
- **Status:** `NOT RUN` end to end — field redaction and safe-signal component assertions passed in
  `verify:recorder` and `verify:protected-login-recorder`; draft/flow/log/report canary scanning did not.

### REC-008 — Semantic locator generation and repeated-container disambiguation

- **Priority / layer:** P0 / real Chromium capture and replay
- **Preconditions:** Synthetic page includes duplicate role/name controls in dialogs, table rows,
  cards, list items, hidden templates, and an iframe.
- **Steps:** Interact with one intended control in each structure; inspect primary/alternative/context
  locators; replay the resulting steps.
- **Expected:** Recorder prefers role, label, placeholder, test id, or stable ID; utility-only classes
  are rejected; container/compound context resolves exactly one intended visible/actionable element.
- **Status:** `PASS` — `verify:recorder`, 78/78.

### REC-009 — Ambiguous locator refuses to guess

- **Priority / layer:** P0 / safety and recovery
- **Preconditions:** Two identical visible, enabled targets cannot be distinguished.
- **Steps:** Capture or load the ambiguous step; execute it; compare with the one-visible and
  one-enabled variants.
- **Expected:** Equal candidates fail with a friendly multiple-elements diagnostic and no click;
  visible/actionable disambiguation succeeds only when deterministic.
- **Status:** `PASS` — `verify:recorder`, 78/78.

### REC-010 — Fixed waiting-time capture thresholds

- **Priority / layer:** P1 / RecorderService
- **Preconditions:** Capture waiting time can be toggled.
- **Steps:** Record pauses below 500 ms, at/above the meaningful threshold, and an excessive idle
  pause; repeat with the option off.
- **Expected:** Sub-threshold gaps are ignored; meaningful gaps become bounded fixed-time wait nodes;
  excessive pauses are capped; option-off creates no fixed wait.
- **Status:** `NOT RUN` for the complete boundary/cap matrix — meaningful/sub-threshold/off behavior
  passed in `verify:recorder-draft` 17/17.

### REC-011 — Smart Wait observation and adaptive timeout generation

- **Priority / layer:** P0 / real Chromium and pure correlation
- **Preconditions:** Smart waits are enabled.
- **Steps:** Trigger POST/GET responses, loader shown→hidden, rows/list items, toast, enabled control,
  URL change, repeated polling, and no-signal cases.
- **Expected:** Stable response/UI waits are attached in the correct order; URL/query secrets are
  removed; polling is ignored; adaptive timeouts honor configured min/max; fixed fallback is not
  duplicated when fixed-time capture is enabled.
- **Status:** `PASS` — `verify:recorder`, 78/78.

### REC-012 — Async activity classification before save

- **Priority / layer:** P0 / review policy
- **Preconditions:** Recorded actions contain reliable, incomplete, review-needed, unsafe, optional,
  and contradictory wait combinations.
- **Steps:** Classify individual waits and step policies; compute summary/worst classification.
- **Expected:** Reliable signals are distinguished from fixed-delay-only, missing endpoint/locator,
  all-optional, contradictory, and unsafe combinations; labels and hints are meaningful.
- **Status:** `PASS` — `npm run verify:async-review`, 21/21.

### REC-013 — Async review modal interaction

- **Priority / layer:** P1 / Electron GUI accessibility
- **Preconditions:** Recording contains at least one async review item.
- **Steps:** Click Save; inspect modal labels, classifications and warnings; cancel; reopen; confirm.
- **Expected:** Save pauses on the review dialog; Cancel retains actions; Confirm persists once;
  keyboard focus is trapped/restored and Escape behavior is deliberate.
- **Status:** `NOT RUN`.

### REC-014 — Draft crash/restart recovery

- **Priority / layer:** P0 / filesystem persistence
- **Preconditions:** Draft storage path is isolated and writable.
- **Steps:** Persist an unsaved action; create a new RecorderService; load draft; corrupt/remove the
  draft; discard; inspect URL history.
- **Expected:** Valid actions restore once without overwriting a live session; missing/corrupt drafts
  do not crash; discard removes only draft/actions and keeps saved URLs.
- **Status:** `NOT RUN` for corrupt/missing recovery — valid restore and discard/URL separation passed
  in `verify:recorder-draft` 17/17.

### REC-015 — Recorded actions convert to a valid flow

- **Priority / layer:** P0 / flow generation
- **Preconditions:** Actions include navigation, click, wait, route change, async waits, session reuse,
  and popup metadata.
- **Steps:** Build flow; serialize/deserialize it; inspect nodes, edges, locators, values, waits,
  session IDs, page aliases, popup expectations, and safety metadata.
- **Expected:** Exactly one Start and End; sequential valid edges; fields survive losslessly; no
  sensitive literal is introduced.
- **Status:** `PASS` — `verify:recorder-flow` 19/19 and direct random round-trip 26/26.

### REC-016 — Save from Recorder into Flow Library

- **Priority / layer:** P0 / Electron GUI → IPC → profile store
- **Preconditions:** Recording is stopped, flow name is non-empty, async review is resolved.
- **Steps:** Save; observe success; open Flow Library; locate and open the saved flow; restart app and
  check again.
- **Expected:** One flow is stored atomically with the requested name; actions clear only after
  success; success toast/status appear; the flow remains after restart.
- **Status:** `NOT RUN`.

### REC-017 — Save validation, duplicate names, and write failure

- **Priority / layer:** P0 / validation and recovery
- **Preconditions:** Existing flow uses the proposed name; profile store can be made read-only/failing
  in an isolated environment.
- **Steps:** Try blank/whitespace/very long/Unicode/duplicate names; simulate write failure; retry.
- **Expected:** Naming policy is deterministic; failure leaves actions intact and shows a useful
  error; no partial/corrupt flow is created; retry saves exactly once.
- **Status:** `NOT RUN`.

### REC-018 — Replay equivalence of a saved recorded flow

- **Priority / layer:** P0 / complete critical journey
- **Preconditions:** A flow was created through the Recorder page against `/recorder-lab`.
- **Steps:** Run the saved flow through the production ExecutionEngine; compare target state, node
  sequence, waits, screenshots/logs, and report; repeat after a designer open/save round-trip.
- **Expected:** Replay reproduces the recorded business outcome; every node completes in order;
  designer save preserves Recorder metadata; report contains no secret values.
- **Status:** `PASS` — `npm run verify:recorder-e2e`, **41/41**. Real Electron Recorder controls
  launched bundled Chromium and captured `goto,fill,fill,select,check,click`; Stop/Save persisted the
  flow across a full restart and visible Flow Library reopen. Two production `ExecutionEngine`
  replays (before and after a Flow Designer no-op save) reproduced the reset target-state oracle,
  completed all eight nodes in order, and wrote valid JSONL logs/reports/recovery state without the
  authentication secret. Evidence:
  `test-artifacts/recorder-e2e/2026-07-26T08-59-26-977Z/`.

### REC-019 — Recorded URL history UI

- **Priority / layer:** P1 / Electron GUI and persistence
- **Preconditions:** More than one page of synthetic URLs exists, including duplicate normalized URLs.
- **Steps:** Save current URL; navigate during recording; search by URL/title/source/session; paginate;
  change page size; copy; reuse a URL while idle; try reuse while recording; restart.
- **Expected:** URLs normalize and deduplicate; newest first; search/pagination are accurate; copy
  matches sanitized URL; reuse is disabled during recording; history persists separately from draft.
- **Status:** `NOT RUN` — storage/deduplication passed in `verify:recorder-draft`; UI behavior did not.

### REC-020 — Protected-login detection without security bypass

- **Priority / layer:** P0 / security
- **Preconditions:** Synthetic login, OTP, CAPTCHA iframe, passkey, approval, protected-popup,
  low-confidence SSO-text, and normal pages exist.
- **Steps:** Run detection for every page and inspect reason, confidence, recommendation and safe
  signals.
- **Expected:** Strong protected surfaces pause; text-only SSO and normal pages continue; no protected
  field value is read; the test never completes the protected action automatically.
- **Status:** `PASS` — `verify:protected-login-recorder`, 45/45.

### REC-021 — Ignore a false positive for this Recorder session

- **Priority / layer:** P0 / Electron GUI and RecorderService state
- **Preconditions:** Handoff panel is active for a synthetic false positive.
- **Steps:** Select Ignore and continue recording; interact on the same page; revisit the same signal;
  start a new recording session.
- **Expected:** Same context/page/action list resumes; notice is visible; current detection does not
  re-pause; global Settings remain unchanged; a new session does not inherit the session override.
- **Status:** `NOT RUN`.

### REC-022 — Authorized manual Chrome handoff and session reuse

- **Priority / layer:** P0 / security and external manual action
- **Preconditions:** Authorized operator and test identity; real Chrome session capture is available.
- **Steps:** Let Recorder pause; choose normal-browser handoff; manually complete login/MFA/CAPTCHA;
  capture session; resume; save; replay.
- **Expected:** AWKIT never types or solves protected input; protected page actions are not recorded;
  captured session produces Auto Secure Login + Reuse Session nodes; resumed business steps replay.
- **Status:** `BLOCKED` — requires an authorized human and approved test identity.

### REC-023 — Handoff cancel and capture error recovery

- **Priority / layer:** P0 / recovery
- **Preconditions:** Exercise detected, capturingSession, missing-captured-data, browser-launch-error,
  and session-not-found phases with synthetic services.
- **Steps:** Cancel in each allowed phase; force capture/resume errors; retry or start a new recording.
- **Expected:** Automation/manual browsers close appropriately; draft/session state follows the
  documented policy; error is actionable; no stale active handoff blocks the next session.
- **Status:** `NOT RUN`.

### REC-024 — Browser closes or crashes during recording

- **Priority / layer:** P0 / resilience
- **Preconditions:** Active recording with persisted actions.
- **Steps:** Close the recorded page, close the browser, and terminate the browser process in separate
  runs; return to Recorder; stop/cancel/save or restart.
- **Expected:** UI leaves Recording state; draft remains recoverable where safe; no process leak;
  Stop/Cancel do not hang; next Start works.
- **Status:** `NOT RUN`.

### REC-025 — Single-active-recorder concurrency and rapid commands

- **Priority / layer:** P0 / concurrency
- **Preconditions:** Recorder is idle.
- **Steps:** Double-click Start; invoke Start through two renderer calls; rapidly Stop/Cancel; navigate
  away and back while starting/stopping.
- **Expected:** At most one browser/context exists; duplicate Start returns “already in progress” or
  is UI-disabled; Stop/Cancel are idempotent-safe; state and draft remain consistent.
- **Status:** `NOT RUN`.

### REC-026 — HTTPS certificate handling remains explicit and session-scoped

- **Priority / layer:** P0 / security
- **Preconditions:** Local valid, self-signed, expired, and wrong-host HTTPS fixtures.
- **Steps:** Start Recorder with validation on/off; inspect failure guidance and live status; restart
  with secure default; verify no forbidden launch switch.
- **Expected:** Invalid certificates fail by default; authorized bypass works only when explicitly
  enabled before context creation; status/warning reflect the live session; cleanup resets state.
- **Status:** `PASS` — `verify:https-certificates` 49/49 and GUI setting 31/31.

### REC-027 — Popup identity and metadata preservation

- **Priority / layer:** P0 / multi-window correctness
- **Preconditions:** Synthetic click-opened, timer-opened, repeated, reversed-order, and closing popups.
- **Steps:** Derive/claim aliases; reverse open order; close/reopen; serialize through the designer;
  inspect aliases and diagnostics for sensitive material.
- **Expected:** Identity is deterministic and not positional; one owner per page; ambiguity is current,
  explicit and masked; legacy aliases work; `opensPopup` and expectations survive round-trip.
- **Status:** `PASS` — `verify:popup-identity` 43/43 and random round-trip 26/26.

### REC-028 — Recorder authorization boundary

- **Priority / layer:** P0 / security and RBAC
- **Preconditions:** Roles with and without `page.recorder`; trusted and untrusted IPC senders.
- **Steps:** Check nav/route; deep-link; call start/stop/save IPC directly; repeat after session
  expiry/revocation.
- **Expected:** Unauthorized users cannot render or invoke Recorder operations; main-process checks
  reject direct calls; active recording is safely terminated on revoked access.
- **Status:** `PASS` — `npm run verify:recorder-authz`, **44/44**. All 11 preload-reachable
  `recorder:*` channels were probed with no bound session, as a Viewer (no `page.recorder`), as an
  Operator (has it), and again after sign-out. Denials are asserted on the *reason*
  (`NOT_AUTHORIZED`), not merely on rejection, and each mutation probe additionally asserts that no
  URL and no flow was persisted. Operator reads remain permitted, so the guard does not over-deny.
  **Found and fixed — `AWKIT-REC-001` (S1):** every handler discarded its `IpcMainInvokeEvent`, so
  with no session at all a caller could persist URL history, **create a flow** (bypassing the
  `workflow.create` check `flows:create` enforces), and launch a browser. The hidden nav entry was
  the only thing withholding the Recorder from a Viewer. Pre-fix negative control **3/26** at
  `test-artifacts/recorder-authz/2026-07-26T17-50-19-068Z/`.
  Still unexecuted: deep-linking the Recorder route in the renderer, and terminating an *active*
  recording when access is revoked mid-session — both belong to the Recorder GUI harness.

### REC-029 — Recorder accessibility, responsive layout, and reduced motion

- **Priority / layer:** P1 / accessibility and compatibility
- **Preconditions:** Idle, recording, ready-to-save, review-dialog, and handoff states.
- **Steps:** Complete operations keyboard-only; inspect labels/names/roles/live announcements/focus;
  test 200% zoom, narrow viewport, long text, high contrast, and reduced motion.
- **Expected:** Logical tab order and visible focus; switches expose checked state; dialogs trap/restore
  focus; actions/status updates are announced; controls do not overlap or require hover; pulse motion
  is removed/reduced.
- **Status:** `NOT RUN`.

## 4. System Reports cases

### SYS-REP-001 — All Reports routes render valid terminal states

- **Priority / layer:** P0 / Electron GUI
- **Preconditions:** Authenticated fresh isolated profile.
- **Steps:** Open Reports Overview, Workflow Reports, Instance Reports, Chrome Consumption, Runtime
  Analytics, Failure Analytics, and Server Performance.
- **Expected:** Every page resolves from skeleton to content or an accurate empty/disabled/error state;
  no telemetry/undefined console error occurs.
- **Status:** `PASS` — `npm run verify:reports`, 31/31.

### SYS-REP-002 — Time range and refresh controls

- **Priority / layer:** P1 / Electron GUI and telemetry IPC
- **Preconditions:** A Reports page with the shared range control.
- **Steps:** Select each range preset; refresh repeatedly; switch routes while a query is pending.
- **Expected:** Selected range is exposed with `aria-pressed`; queries use the new range; stale results
  do not replace newer results; refresh does not duplicate rows or crash.
- **Status:** `PASS` — `verify:reports-populated-gui` exercised all five presets, rapid
  `15m → 7d → 24h` switching, and repeated refresh; the final accessible selection and dataset
  remained the newest 24h request.

### SYS-REP-003 — Overview metrics match persisted run truth

- **Priority / layer:** P0 / UI → telemetry → SQLite
- **Preconditions:** Seed known success, failure, cancelled, queued and running executions.
- **Steps:** Open Overview in a range containing the seed; compare total, success/failure rates,
  cancelled, durations, queue wait, active, queued, and trend series with source rows.
- **Expected:** Counts/rates use documented denominators; in-progress/cancelled handling is correct;
  displayed durations and series match persisted data.
- **Status:** `PASS` — the populated GUI gate independently seeded 32 current-window runs
  (23 completed, 6 failed, 3 cancelled) and matched durable totals, terminal-only rates, queue wait,
  visible metric cards, and trend data. Backend aggregate contract remains green at 61/61.

### SYS-REP-004 — Workflow sorting and machine-context filters

- **Priority / layer:** P0 / GUI and backend filtering
- **Preconditions:** Seed multiple workflows across machines, execution modes, pool modes and workloads.
- **Steps:** Sort each column both ways; apply and combine all four filters; clear filters.
- **Expected:** Stable correct order; filtered rows/counts match SQLite; empty filter result is explicit;
  no cross-machine comparison is silently presented as same-machine.
- **Status:** `NOT RUN` for the full all-column/all-filter matrix — the populated gate passed
  two-direction Workflow sorting, machine filtering, machine-context labels, and contradictory
  combined-filter empty state against two seeded workflows.

### SYS-REP-005 — Workflow comparison limit and deltas

- **Priority / layer:** P1 / GUI analytics
- **Preconditions:** At least five workflow rows with current/previous-window history.
- **Steps:** Enable Compare; select/deselect rows; attempt a fifth selection; inspect success,
  duration, runs and delta values.
- **Expected:** Maximum four selected; fifth is disabled/refused; values match backend comparison;
  new/up/down/flat semantics and higher-is-better direction are correct.
- **Status:** `NOT RUN` for the five-workflow/fifth-selection limit — populated comparison and
  side-by-side deltas passed with two independently seeded workflows.

### SYS-REP-006 — Recent runs and Run Detail drawer

- **Priority / layer:** P0 / GUI → telemetry → artifact access
- **Preconditions:** Selected workflow has passed, failed, retried and cancelled runs with artifacts.
- **Steps:** Open workflow row; select recent run; inspect metadata, attempts and artifacts; open valid
  artifact; close by button/Escape/scrim; delete a retained run and retry.
- **Expected:** Correct run opens; attempts/artifacts match durable rows; path open is allowed only for
  approved runtime roots; missing run shows retention message; focus returns to opener.
- **Status:** `NOT RUN` for artifact launch, Escape/scrim/focus return, and missing-retained-run
  recovery — durable row identity, two attempts, two artifacts, and button-close passed in the
  populated gate.

### SYS-REP-007 — Instance Reports paging and live status

- **Priority / layer:** P0 / GUI and concurrency state
- **Preconditions:** More than one history page plus live queued/running instances.
- **Steps:** Compare live distribution; page forward/back; open a row; change time range.
- **Expected:** Live counts match engine state; no duplicate/missing history rows; buttons disable at
  boundaries; row detail is correct.
- **Status:** `NOT RUN` for queued/running live-state transitions — the populated gate passed
  32-row two-page history, exact `1–25`/`26–32` boundaries, no duplicate/missing IDs, disabled
  boundary action, and correct row detail.

### SYS-REP-008 — Stored Execution Reports list, export and folder open

- **Priority / layer:** P0 / report store and filesystem boundary
- **Preconditions:** Complete a real synthetic workflow that writes a report.
- **Steps:** Open Execution Reports; refresh; inspect the row; export JSON; open its folder; compare
  exported content; repeat with no reports and with a corrupt report file.
- **Expected:** Only real reports appear; empty state has no demo rows; export is valid/redacted;
  folder open is scoped; corrupt records do not crash or expose raw stack/secrets.
- **Status:** `NOT RUN` only for launching the real OS folder target. The populated gate passed one
  real record plus one corrupt sibling, exact report-card fields, permission-aware actions, complete
  stored-report JSON export (not a card summary), exact filename, and redaction. The new
  `reports:openFolder` boundary accepts only an existing report id and resolves the configured
  Reports folder in the main process; crafted ids and unauthorized calls were rejected. The OS
  Explorer launch was deliberately not executed in automation.

### SYS-REP-009 — Failure Analytics categories and evidence

- **Priority / layer:** P0 / observability correctness
- **Preconditions:** Seed selector, timeout, network, assertion, session-expired, handoff-required and
  unknown failures, plus retries and successful workflows.
- **Steps:** Open Failure Analytics; compare category distribution, rankings, flakiness and evidence.
- **Expected:** Only failures enter failure views; taxonomy is correct; low-sample flakiness is hidden;
  evidence points to the correct run and remains redacted.
- **Status:** `NOT RUN` for unknown-category, low-sample, and evidence-navigation subcases — the
  populated GUI passed six named categories, the exact failed total, and both workflow rankings;
  taxonomy/backend logic remains green in `verify:telemetry`.

### SYS-REP-010 — Runtime Analytics historical capacity and anomaly views

- **Priority / layer:** P0 / telemetry and observability
- **Preconditions:** Seed capacity/admission/process samples, historical workflow baselines and anomalies.
- **Steps:** Inspect peak metrics, timelines, admission reasons, pool effectiveness, rankings,
  regressions and recovered anomalies over multiple ranges.
- **Expected:** Aggregates, buckets, percentages and anomaly state match source data; unavailable
  metrics are neutral, not zero; environmental observations are labelled.
- **Status:** `NOT RUN` for multi-range and recovered-anomaly transitions — seeded capacity,
  admission reasons, process history, active anomaly and environmental labels rendered correctly;
  normal/empty/migration/high-data Runtime Analytics is 36/36 and backend observability is 65/65.

### SYS-REP-011 — Chrome Consumption live gauges and polling

- **Priority / layer:** P1 / live runtime telemetry
- **Preconditions:** Idle application; optionally run a bounded synthetic workflow.
- **Steps:** Open Chrome Consumption; inspect browser pool, concurrency, memory, CPU and process detail;
  wait through multiple polls; trigger/release backpressure.
- **Expected:** Four gauges render with values or neutral unavailable state; page remains stable;
  backpressure reason appears and clears; no timer/listener leak is observed.
- **Status:** `NOT RUN` for active-workflow/backpressure/cleanup subcases — four gauges and a second
  polling cycle passed in both the fresh-profile and populated GUI gates.

### SYS-REP-012 — Server Performance and storage sizing

- **Priority / layer:** P1 / IPC and filesystem aggregation
- **Preconditions:** Runtime directories exist with known synthetic files.
- **Steps:** Open Server Performance; compare process/system values and per-directory sizes; remove a
  directory or deny access in an isolated root; refresh.
- **Expected:** Four metric cards and storage section render; known sizes are accurate; missing/denied
  paths degrade to unavailable without crashing or leaking paths outside runtime roots.
- **Status:** `NOT RUN` for exact-byte, missing-path, denied-path, large-directory and cache-expiry
  fault injection — the populated gate passed four process cards and seeded runtime/report storage
  discovery; fresh-profile sizing remained stable.

### SYS-REP-013 — Telemetry persistence, retention, paging and migration contract

- **Priority / layer:** P0 / SQLite integration
- **Preconditions:** Temporary v1/v2/v3/fresh stores and >500 run corpus.
- **Steps:** Migrate; upsert summaries/samples; query overview/workflows/history/failures/machines;
  page; apply retention.
- **Expected:** Old rows survive compatible migration; aggregates are unbounded while pages clamp;
  no duplicate/missing pages; keyed lookup works; retention preserves recoverable runs.
- **Status:** `PASS` — `verify:telemetry`, 61/61.

### SYS-REP-014 — Observability aggregation and regression lifecycle

- **Priority / layer:** P0 / service integration
- **Preconditions:** Synthetic run/capacity/admission/anomaly history.
- **Steps:** Aggregate distributions and percentiles; detect slow/failing/regressed workflows; apply
  cooldown; record recovery; perform retention.
- **Expected:** Null-safe metrics; correct pressure/admission normalization; thresholds and cooldown
  are deterministic; active and recovered anomaly transitions are stored.
- **Status:** `PASS` — `verify:observability`, 65/65.

### SYS-REP-015 — Reports authorization and safe artifact opening

- **Priority / layer:** P0 / RBAC and filesystem security
- **Preconditions:** Roles with and without report access; crafted artifact paths.
- **Steps:** Test nav/deep link/direct telemetry/report IPC; attempt another user's run detail if
  identity scoping applies; try traversal/out-of-root artifact paths.
- **Expected:** Main process enforces authorization; no hidden-only security; unauthorized/traversal
  requests are rejected and audited; allowed report reads remain redacted.
- **Status:** `PASS` — `verify:reports-populated-gui`, **74/74**. Main-process authorization is
  enforced on every telemetry/report read and report export/open action. The real Electron gate
  proves pre-auth denial; Viewer read allowance but export/open denial and hidden controls; no-role
  nav/deep-link/direct-IPC denial; crafted report-id rejection; and out-of-root path rejection.
  **Denied attempts are now persisted and verified:** each of `telemetry:overview`, `report:list`,
  `reports:get` and `reports:openFolder` produces an audit row with `result=failure` and
  `reasonCode=NOT_AUTHORIZED`, read back through the operator-visible `AUDIT_VIEW` surface rather
  than an internal call. The entry names the acting user when there is one, records no actor for a
  pre-auth attempt rather than inventing one, and contains no caller-supplied argument.
  **Gap closed — `AWKIT-REP-003`:** the app rejected unauthorized reads but recorded nothing, so a
  probing attempt left no trace. `verify:e2e-rbac` remains 51/51.

### SYS-REP-016 — Reports accessibility, zoom and reduced motion

- **Priority / layer:** P1 / accessibility
- **Preconditions:** Content, empty, loading, error, drawer and comparison states.
- **Steps:** Navigate keyboard-only; inspect table headers/sort state, chart accessible names, focus
  trap/return, live loading/error announcements; test 200% zoom, narrow layout and reduced motion.
- **Expected:** All operations are keyboard reachable; charts have useful summaries; state is not
  color-only; tables/drawers remain readable without clipping; motion is reduced.
- **Status:** `PASS` for the executed audit — `verify:reports-settings-a11y` 14/14 plus two seeded
  `aria-sort` assertions in `verify:reports-populated-gui` (66/66). Covers keyboard reach, the
  `:focus-visible` ring on every focused control, accessible names, sorted/unsorted `aria-sort`
  on the Workflow Reports table, reduced motion, 200% zoom and a narrow width with no horizontal
  overflow. **Found and fixed:** sort direction was conveyed only by a chevron icon, so a screen
  reader could not tell which column was sorted or which way. Chart accessible summaries and the
  drawer focus-trap/return subcases are still unexecuted.

## 5. Settings cases

### SET-001 — Settings page access, loading and permission boundary

- **Priority / layer:** P0 / Electron GUI and RBAC
- **Preconditions:** Super User, Administrator and non-settings role.
- **Steps:** Open by navigation and deep link; inspect every section; call substantive update/reset/
  import/open-folder IPC directly from each role.
- **Expected:** Authorized roles see permitted cards; main process rejects unauthorized mutations;
  UI-state-only updates follow policy; loading/error states do not expose controls prematurely.
- **Status:** `PASS` — `verify:settings-e2e`, 116/116. The real Electron renderer, preload and
  sender-bound main process were exercised before login and as Super User, Administrator and Viewer.
  Read-only metadata required `page.settings`; mutation required `settings.edit`; Viewer and pre-auth
  calls were denied without changing settings or secrets.

### SET-002 — Appearance and accent persistence

- **Priority / layer:** P1 / Electron GUI and settings store
- **Preconditions:** Isolated clean profile.
- **Steps:** Apply solid/gradient custom colors and preset; inspect buttons, connectors, statuses and
  login; restart; reset.
- **Expected:** Theme tokens update without corrupting semantic status colors; settings persist and
  bootstrap before login; reset returns documented defaults.
- **Status:** `PASS` — `verify:accent-gui`, 33/33.

### SET-003 — Workspace logo lifecycle and authorization

- **Priority / layer:** P1 / GUI, image validation and RBAC
- **Preconditions:** Super User and Administrator; valid PNG/SVG plus corrupt asset.
- **Steps:** Preview/apply/replace/remove; restart; inspect Administrator UI and direct IPC; corrupt
  stored logo.
- **Expected:** Only authorized role mutates; SVG is safely rasterized; no raw path is rendered;
  restart persists; corrupt asset falls back without broken image/crash.
- **Status:** `PASS` — `verify:branding-gui`, 30/30.

### SET-004 — Recorder capture defaults persist and affect only new sessions

- **Priority / layer:** P0 / Settings → Recorder integration
- **Preconditions:** Recorder idle, then active.
- **Steps:** Toggle Smart waits and Capture waiting time in Recorder and/or Settings; restart; start a
  session; change setting mid-session; inspect current and next sessions.
- **Expected:** Values persist; launch resolves them once; mid-session setting change does not alter
  live capture behavior; next session uses new values.
- **Status:** `NOT RUN`.

### SET-005 — Ignore protected-login detection confirmation and scope

- **Priority / layer:** P0 / security
- **Preconditions:** Setting is off.
- **Steps:** Enable and cancel confirmation; enable and confirm; start Recorder; disable; restart.
- **Expected:** Cancel persists nothing; confirm warns that authentication is not bypassed; setting
  affects new sessions; visible session notice appears; disabling restores pause behavior.
- **Status:** `NOT RUN` for the Recorder/session-scope portion. The Settings confirmation, cancel,
  persist, restart and disable paths passed in `verify:settings-e2e`.

### SET-006 — Ignore invalid HTTPS certificates secure lifecycle

- **Priority / layer:** P0 / security
- **Preconditions:** Isolated profile; setting off.
- **Steps:** Open confirmation; cancel; enable; restart; disable; load legacy settings; import a file
  attempting to enable the bypass.
- **Expected:** Secure default false; nothing persists before confirmation; warning stays visible while
  enabled; restart persists intentional value; disabling needs no confirmation; legacy/import cannot
  silently enable it.
- **Status:** `PASS` — GUI 31/31 plus runtime certificate contract 49/49.

### SET-007 — Path browse, reset, validation and writability

- **Priority / layer:** P0 / GUI and filesystem
- **Preconditions:** Isolated existing writable, existing read-only and missing directories.
- **Steps:** Browse each path; cancel picker; reset individually; save empty/missing/read-only paths;
  restart.
- **Expected:** Cancel leaves value unchanged; reset uses runtime default; blank paths are blocked;
  existence/writability labels are accurate; persisted paths drive actual artifact locations.
- **Status:** `NOT RUN` for the complete picker/read-only/artifact-location matrix. Blank and
  file-as-directory validation, writable-directory truth, save, reset and restart passed in
  `verify:settings-e2e`.

### SET-008 — Designer and execution default validation boundaries

- **Priority / layer:** P0 / client + main-process validation
- **Preconditions:** Settings page loaded.
- **Steps:** Test zoom 24/25/200/201; zero/negative dimensions; zero/fractional run counts; defaults
  above maxima; concurrency above runs; valid boundaries.
- **Expected:** Invalid combinations show all actionable errors and do not persist; main-process
  validation rejects direct invalid IPC; valid boundaries save and appear in new designer/run forms.
- **Status:** `NOT RUN` for new-designer/new-run propagation and the exact valid boundary matrix.
  Eight invalid direct-IPC combinations were rejected without persistence and rendered validation
  errors were announced in `verify:settings-e2e`.

### SET-009 — Execution defaults persist and influence a new run

- **Priority / layer:** P0 / Settings → runner integration
- **Preconditions:** Safe mock workflow.
- **Steps:** Change run limits, default counts/concurrency, headed/headless, screenshot-on-failure and
  stop-on-error; save/restart; open a new run; execute failure/recovery cases.
- **Expected:** New run form receives defaults within maxima; runner honors selected flags; existing
  saved workflow/card values are not silently overwritten.
- **Status:** `NOT RUN` for runner-behavior proof. Save/restart persistence for execution defaults
  passed in `verify:settings-e2e`.

### SET-010 — Runtime concurrency modes and host recommendation

- **Priority / layer:** P0 / GUI → settings → capacity engine
- **Preconditions:** Isolated authenticated profile.
- **Steps:** Detect machine; select Sequential, Auto and Manual; compare workload classes and readout.
- **Expected:** Sequential=1; Auto equals recommendation; Manual applies explicit safe target; light
  recommendation is not below heavy; controls/readout render without console errors.
- **Status:** `PASS` — `verify:capacity-settings-gui`, 12/12.

### SET-011 — Concurrent settings writes and shutdown flush

- **Priority / layer:** P0 / persistence concurrency
- **Preconditions:** Isolated application-data root.
- **Steps:** Send 40 distinct concurrent patches; inspect all keys and temp files; fire a final update
  and immediately close; reopen.
- **Expected:** No lost updates; atomic rename leaves no temp files; before-quit flush persists the
  final update.
- **Status:** `PASS` — `verify:settings-persistence`, 3/3.

### SET-012 — Secret store encryption, validation, CRUD and masking

- **Priority / layer:** P0 / security storage
- **Preconditions:** Synthetic secret and isolated keystore/store.
- **Steps:** Set/get/list/update/delete; inspect disk; test invalid name/empty value/unavailable
  keystore; collect flow references; log canary.
- **Expected:** Plaintext never appears on disk/list/log; only summaries return to renderer; invalid
  and unavailable cases fail closed; masking scrubs registered literals.
- **Status:** `PASS` — `verify:secrets`, 16/16.

### SET-013 — Secrets card user journey

- **Priority / layer:** P0 / Electron GUI
- **Preconditions:** Secret storage available, then simulated unavailable.
- **Steps:** Add invalid/valid secret; update same name; inspect cleared input and masked control;
  delete with cancel/confirm; restart; attempt duplicate/rapid submit.
- **Expected:** Inline validation is accurate; value is never rendered after save; list shows name/date
  only; cancel preserves; confirm deletes; unavailable state disables storage safely.
- **Status:** `NOT RUN` for unavailable-store and rapid-submit variants. Real GUI add, update,
  masked-list, cancel-delete, confirm-delete, restart persistence and no-plaintext evidence passed in
  `verify:settings-e2e`.

### SET-014 — Java Runtime and Oracle JDBC Driver settings

- **Priority / layer:** P0 / GUI and isolated bridge
- **Preconditions:** Approved local JDK 17 and validation driver bundle; no password.
- **Steps:** Render cards; validate/set defaults/test bridge and driver load; add referencing profile;
  attempt remove; drop reference; inspect renderer projection and reduced motion.
- **Expected:** Metadata/availability are correct; real driver loads; in-use deletion is blocked;
  renderer/DOM contain no secrets; no horizontal overflow or console error.
- **Status:** `PASS` — `verify:oracle-drivers-gui`, 30/30.

### SET-015 — Data Storage counts and runtime folder

- **Priority / layer:** P1 / GUI and profile stores
- **Preconditions:** Known counts of flows, workflows, data sources and reports in isolated root.
- **Steps:** Open card; compare counts; add/delete one item; Refresh Counts; open runtime folder; make a
  store temporarily unreadable.
- **Expected:** Counts match stores and refresh; open folder is the configured runtime root only;
  unreadable store reports safe zero/error according to contract without crashing.
- **Status:** `NOT RUN` for real folder launch and unreadable-store recovery. Seeded counts and
  Refresh Counts passed in `verify:settings-e2e`.

### SET-016 — Clear UI State is non-destructive

- **Priority / layer:** P0 / data safety
- **Preconditions:** Saved user data plus non-default sidebar/layout/selection UI state.
- **Steps:** Clear UI State; restart; inspect layout and all saved records/files.
- **Expected:** Only UI-state keys reset; flows, workflows, data sources, reports, sessions, secrets,
  drivers and settings data remain.
- **Status:** `NOT RUN` for the complete saved-data inventory because sessions and driver records
  were not seeded. Two flows, one workflow, one data source, one report, a secret and non-default
  settings survived Clear UI State and restart in `verify:settings-e2e`.

### SET-017 — Export/import round-trip and protected security fields

- **Priority / layer:** P0 / import/export security
- **Preconditions:** Non-default settings with no secret values in settings object.
- **Steps:** Export; inspect JSON; change values; import export; restart; import file containing unknown
  fields and `ignoreHttpsErrors=true`.
- **Expected:** Supported values round-trip; export contains no stored secret values; unknown/invalid
  fields are rejected or normalized; import cannot silently enable certificate bypass; user data is
  not deleted.
- **Status:** `NOT RUN` for the complete post-import restart round-trip. Export bytes/filename/no
  plaintext, supported-value restoration, partial legacy merge, unknown-field pruning, data
  preservation and certificate-bypass refusal passed in `verify:settings-e2e`; the dedicated HTTPS
  Settings GUI remains 31/31.

### SET-018 — Invalid or corrupt Settings import

- **Priority / layer:** P0 / recovery
- **Preconditions:** Valid current settings persisted.
- **Steps:** Import malformed JSON, wrong top-level type, oversized file, invalid enums/numbers/paths,
  partial legacy object and unsupported future-version object.
- **Expected:** Error is actionable; existing settings remain unchanged and parseable; partial legacy
  values merge/migrate safely; no stack trace or secret is exposed.
- **Status:** `PASS` — `verify:settings-e2e`, 116/116. Malformed JSON, array top-level input,
  oversized input, invalid enums/numbers/paths, unknown/future fields and partial legacy input were
  negative-controlled. Failed imports preserved the current parseable store; valid legacy input
  merged through the documented defaults.

### SET-019 — Reset all defaults without deleting user data

- **Priority / layer:** P0 / destructive-action safety
- **Preconditions:** Non-default settings plus representative saved artifacts and secret references.
- **Steps:** Trigger reset and cancel; trigger and confirm; restart; inventory records/files.
- **Expected:** Cancel changes nothing; confirm resets documented Settings/theme defaults and applies
  runtime caps; saved flows/workflows/data/reports/sessions/secrets/drivers are not deleted.
- **Status:** `NOT RUN` as a complete data-preservation inventory because sessions and driver records
  were not seeded. Cancel/confirm, documented default restoration, restart, and preservation of
  seeded flows/workflows/data sources/reports/secrets passed in `verify:settings-e2e`.

### SET-020 — Offline Runtime validation action

- **Priority / layer:** P1 / integration
- **Preconditions:** Complete offline bundle, then isolated missing/corrupt dependency variants.
- **Steps:** Click Validate Offline Runtime for each state; open Offline Runtime detail when issues exist.
- **Expected:** Passing bundle reports success; failure count and detail agree; action does not download
  dependencies or require network; no false success on missing browser/runtime.
- **Status:** `NOT RUN` for missing/corrupt dependency variants. The installed offline bundle's
  passing validation action completed in `verify:settings-e2e`.

### SET-021 — Settings accessibility and responsive behavior

- **Priority / layer:** P1 / accessibility
- **Preconditions:** Default, validation-error, confirmation-dialog, secret-unavailable and narrow states.
- **Steps:** Navigate keyboard-only; inspect form labels, groups, error/status announcements, dialog
  focus and return; test 200% zoom, narrow viewport, high contrast and reduced motion.
- **Expected:** Every control has an accessible name and visible focus; errors associate with controls;
  confirmation is operable without pointer; cards do not overflow; motion is reduced.
- **Status:** `PASS` for the executed audit — `verify:reports-settings-a11y` 14/14. Covers keyboard
  reach, the `:focus-visible` ring on every focused control, a page-wide accessible-name audit of every
  visible control, announcement of a rejected Save through a live region, association of the error with
  its field, reduced motion, 200% zoom and a narrow width with no horizontal overflow.
  **Found and fixed:** `validateClient` returned a flat string list, so the banner announced *what* was
  wrong but the offending input carried no `aria-invalid`/`aria-describedby` — a screen-reader user
  tabbing the form could not locate the invalid field. Errors now carry their field id and bind to the
  control. High-contrast mode and the unavailable-secret control subcases remain unexecuted.
- **Recorder:** component contracts are strong, but release approval for the Recorder feature requires
  REC-001 through REC-004 and REC-013, REC-016, REC-018, REC-021, REC-023 through REC-025, REC-028 and
  REC-029 to execute. REC-018 is the decisive record→save→reopen→replay gate.
- **System Reports:** empty-state GUI and backend analytics are green. Populated GUI truth, drill-down,
  export/path security, authorization and accessibility remain open.
- **Settings:** the real-Electron core gate is 116/116, including page/IPC authorization, every
  section, direct validation, path truth, Secrets CRUD, counts, UI-state reset, import recovery,
  reset safety, restart checks and modal/error accessibility. SET-001 and SET-018 are now PASS.
  Cases with unexecuted picker, runner/session integration, unavailable-store, OS-launch,
  sessions/drivers inventory, corrupt offline bundle, 200% zoom and high-contrast subcases remain
  `NOT RUN`.

No defect is inferred from a `NOT RUN` or `BLOCKED` result.
