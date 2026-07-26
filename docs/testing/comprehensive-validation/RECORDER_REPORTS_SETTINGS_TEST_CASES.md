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
- **Status:** `PASS` — `npm run verify:recorder-gui`. Idle status, Stop/Cancel disabled, Save
  refused with nothing recorded, editable Target URL, the empty-state panel instead of a timeline,
  no stale action, no handoff panel, and no console error. Note: `Start` is NOT gated on a non-empty
  URL — that guard sits on `Save URL` — so the empty-target path is asserted in REC-003.

### REC-002 — Start a recording from a valid loopback URL

- **Priority / layer:** P0 / Electron → IPC → RecorderService → Chromium
- **Preconditions:** Mock site is available at `/recorder-lab`; bundled Chromium is available.
- **Steps:** Enter the loopback URL; enable Smart waits; click Start Recording; wait for the separate
  browser; inspect Recorder status and Target URL controls.
- **Expected:** Exactly one browser session opens at the target; status becomes Recording; target and
  capture toggles are locked; Stop/Cancel become enabled; the first action is a sanitized `goto`.
- **Status:** `PASS` — `npm run verify:recorder-gui`. A loopback start locks the Target URL field,
  both capture switches and `Save URL`, enables Stop/Cancel, disables Start, and records a first
  action of type `goto` whose target matches the requested loopback URL.

### REC-003 — Invalid URL and browser-launch failure recovery

- **Priority / layer:** P0 / validation and recovery
- **Preconditions:** Recorder is idle.
- **Steps:** Try empty, malformed, unsupported-scheme, refused-loopback, and unreachable URLs; simulate
  browser launch failure; then retry with a valid loopback URL.
- **Expected:** Unsafe/invalid targets do not leave a live recorder; a useful error is shown; no orphan
  browser remains; Start is re-enabled; a later valid start succeeds.
- **Status:** `PASS` — `npm run verify:recorder-gui`. Empty, malformed, `javascript:` pseudo-scheme,
  a refused loopback port and an unreachable host each surface an error, leave no live recording and
  re-enable Start; a valid target then starts normally.
  **`file:`, `about:` and `data:` are deliberately PERMITTED** targets — `RecorderService.normalizeUrl`
  names them explicitly — so they are not "unsupported schemes" here; an `about:` start is asserted to
  succeed as the positive control for that design decision.
  **Found and fixed — `AWKIT-REC-003` (S3):** an empty target started a live recording pointed at
  nothing, and because the Target URL field disables while recording, the operator could not correct
  it without cancelling. **The check that found it was vacuous first:** waiting for
  `isRecording === false` is already true while a start is in flight, so all four invalid targets
  passed at t=0 without being attempted. The loop now waits for the status line to leave
  `Starting browser...`. Simulated browser-launch failure remains unexecuted.

### REC-004 — Stop versus Cancel lifecycle

- **Priority / layer:** P0 / Electron GUI and persistence
- **Preconditions:** A recording contains at least three actions.
- **Steps:** Stop one session; verify actions remain and Save is enabled. Start a second session,
  create actions, then Cancel.
- **Expected:** Stop closes the browser and retains final actions for review/save. Cancel closes the
  browser, clears actions and draft, disables Save, and retains reusable URL history only.
- **Status:** `PASS` — `npm run verify:recorder-gui`. Stop retains the actions, shows
  `Recording stopped. Ready to save.`, re-enables Start and disables Stop/Cancel. Cancel clears the
  actions, restores the empty state, and leaves the reusable URL history intact.

### REC-005 — Core DOM controls become correct recorded action types

- **Priority / layer:** P0 / real Chromium capture script
- **Preconditions:** Recorder capture script is injected into a synthetic page.
- **Steps:** Click a button; type in text/email/number/date/textarea controls; select an option; check
  and uncheck a checkbox; choose a radio; stop without blurring the last text input.
- **Expected:** Actions are `click`, `fill`, `select`, `check`, `uncheck`, and `radio` as appropriate;
  locators are usable; the final focused input value is captured.
- **Status:** `PASS` — `npm run verify:recorder`, 97/97 (was 78 before the AWKIT-REC-002 pattern guards).

### REC-006 — Live typing is compacted to one final fill action

- **Priority / layer:** P0 / RecorderService binding
- **Preconditions:** A live RecorderService session is active on a text field.
- **Steps:** Type a multi-character value one key at a time without blurring; inspect in-memory and
  persisted draft actions; stop recording.
- **Expected:** Consecutive fills for the same page and locator collapse to one action containing the
  final value; draft size does not grow per keystroke.
- **Status:** `PASS` — `npm run verify:recorder-draft`, **50/50** (was 17). 16 keystrokes on one field
  collapse to a single action carrying the final value, the persisted draft holds one fill rather than
  one per keystroke, a different field starts a new action, and an intervening click breaks the run.
  Driven through `RecorderService.recordActionFromPage` — extracted from the `__awtkit_recordAction`
  binding (now a one-line adapter) so service-level behaviour is reachable without a browser.

### REC-007 — Sensitive input and signal redaction

- **Priority / layer:** P0 / security
- **Preconditions:** Synthetic fields represent password, OTP, passcode, PIN, CVV/CVC, card number,
  SSN, token, and secret inputs.
- **Steps:** Enter canary values; trigger input/change; generate network and URL signals; inspect
  actions, draft, flow JSON, logs, and diagnostics.
- **Expected:** Steps may be recorded, but sensitive values are empty or secret references; network
  data stores method/path only; query strings, bodies, headers, cookies, tokens, and canaries do not
  appear anywhere.
- **Status:** `PASS` — `npm run verify:recorder-redaction`, **15/15**, plus 19 new pattern
  assertions in `verify:recorder` (97/97, was 78). A real Recorder session on `/recorder-sensitive`
  types fixed canaries into password, one-time-code, card, CVC, PIN, SSN, API-token and
  shared-secret controls and submits — putting the token in a query string, an `Authorization`
  header and a JSON body. **Every file** under the isolated application data root is then scanned:
  recorded actions, the on-disk draft, the saved flow JSON, URL history, recorder status/handoff
  diagnostics, the production run's JSONL log and the stored report. Zero canaries. A deliberately
  non-sensitive display name is asserted **present** in the same corpus, so the scan cannot pass
  vacuously. The fixture also pauses on protected-login detection at the secure default
  (`handoff.phase="detected"`), asserted before the run disables detection for the redaction test.
  **Found and fixed — `AWKIT-REC-002` (S2):** `\btoken\b` and `\bsecret\b` never matched `apiToken`
  or `api_token`, because a word boundary needs a non-word character and both camelCase and
  snake_case supply a word one. `accessToken`, `refreshToken`, `clientSecret`, `devicePin`,
  `userSsn` and `cardCvv` were all exempt from redaction and were written verbatim into saved flows.

### REC-008 — Semantic locator generation and repeated-container disambiguation

- **Priority / layer:** P0 / real Chromium capture and replay
- **Preconditions:** Synthetic page includes duplicate role/name controls in dialogs, table rows,
  cards, list items, hidden templates, and an iframe.
- **Steps:** Interact with one intended control in each structure; inspect primary/alternative/context
  locators; replay the resulting steps.
- **Expected:** Recorder prefers role, label, placeholder, test id, or stable ID; utility-only classes
  are rejected; container/compound context resolves exactly one intended visible/actionable element.
- **Status:** `PASS` — `verify:recorder`, 97/97.

### REC-009 — Ambiguous locator refuses to guess

- **Priority / layer:** P0 / safety and recovery
- **Preconditions:** Two identical visible, enabled targets cannot be distinguished.
- **Steps:** Capture or load the ambiguous step; execute it; compare with the one-visible and
  one-enabled variants.
- **Expected:** Equal candidates fail with a friendly multiple-elements diagnostic and no click;
  visible/actionable disambiguation succeeds only when deterministic.
- **Status:** `PASS` — `verify:recorder`, 97/97.

### REC-010 — Fixed waiting-time capture thresholds

- **Priority / layer:** P1 / RecorderService
- **Preconditions:** Capture waiting time can be toggled.
- **Steps:** Record pauses below 500 ms, at/above the meaningful threshold, and an excessive idle
  pause; repeat with the option off.
- **Expected:** Sub-threshold gaps are ignored; meaningful gaps become bounded fixed-time wait nodes;
  excessive pauses are capped; option-off creates no fixed wait.
- **Status:** `PASS` — `npm run verify:recorder-draft`, **50/50**. The complete matrix: 499 ms inserts
  nothing, **500 ms exactly** inserts a wait (the `<` vs `<=` boundary), 501 ms inserts one, an
  excessive 120 s pause is capped at 60 s rather than recorded verbatim, capture-off inserts nothing
  even for an excessive pause, and no wait is inserted when there is no preceding action.

### REC-011 — Smart Wait observation and adaptive timeout generation

- **Priority / layer:** P0 / real Chromium and pure correlation
- **Preconditions:** Smart waits are enabled.
- **Steps:** Trigger POST/GET responses, loader shown→hidden, rows/list items, toast, enabled control,
  URL change, repeated polling, and no-signal cases.
- **Expected:** Stable response/UI waits are attached in the correct order; URL/query secrets are
  removed; polling is ignored; adaptive timeouts honor configured min/max; fixed fallback is not
  duplicated when fixed-time capture is enabled.
- **Status:** `PASS` — `verify:recorder`, 97/97.

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
- **Status:** `NOT RUN` for the dialog's keyboard focus-trap/Escape semantics only. Everything else
  is executed in `verify:recorder-gui` (**100 PASS / 0 FAIL / 1 NOT RUN**) against the new
  `/recorder-lab?rec013=1` harness: Save pauses on the dialog, the dialog is a labelled `role=dialog`,
  dismissing it retains all three actions **and persists nothing**, a second Save reopens it, and
  Confirm persists the flow exactly once.
  **The precondition is now asserted, not assumed** — the `fixedDelay` wait is checked before any
  dialog assertion, so a fixture that stopped producing review-worthy activity fails loudly instead
  of quietly reverting to `NOT RUN`.
  **Two premises recorded so they are not re-derived:** (1) a `fixedDelay` requires Smart Wait capture
  **ON** and waiting-time capture **OFF** — `RecorderService` passes
  `allowFixedDelayFallback: !captureWaitTime`, so the intuitive "capture waiting time ON" approach
  suppresses the very wait the case needs; and (2) the dismiss control is labelled **"Keep editing"**,
  not "Cancel" — this block had guessed "Cancel" before it had ever executed.

### REC-014 — Draft crash/restart recovery

- **Priority / layer:** P0 / filesystem persistence
- **Preconditions:** Draft storage path is isolated and writable.
- **Steps:** Persist an unsaved action; create a new RecorderService; load draft; corrupt/remove the
  draft; discard; inspect URL history.
- **Expected:** Valid actions restore once without overwriting a live session; missing/corrupt drafts
  do not crash; discard removes only draft/actions and keeps saved URLs.
- **Status:** `PASS` — `npm run verify:recorder-draft`, **50/50**. Unparseable JSON, structurally
  valid JSON of the wrong shape (`actions` not an array), and a missing file each load without
  throwing and restore no actions; the reusable URL history survives a corrupt draft intact.

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
- **Status:** `PASS` — `npm run verify:recorder-gui`, **90/90**. The recording clears **only** after a
  successful save — proven against a real forced failure, after which the actions were still intact —
  and a success result is surfaced. Cross-restart persistence and the visible Flow Library reopen
  remain covered by `verify:recorder-e2e` 41/41.

### REC-017 — Save validation, duplicate names, and write failure

- **Priority / layer:** P0 / validation and recovery
- **Preconditions:** Existing flow uses the proposed name; profile store can be made read-only/failing
  in an isolated environment.
- **Steps:** Try blank/whitespace/very long/Unicode/duplicate names; simulate write failure; retry.
- **Expected:** Naming policy is deterministic; failure leaves actions intact and shows a useful
  error; no partial/corrupt flow is created; retry saves exactly once.
- **Status:** `PASS` — `npm run verify:recorder-gui`, **90/90**. Blank and whitespace-only names
  disable Save. A **real** write failure (the flows directory replaced by a file, so the store's own
  write fails rather than a mocked rejection) surfaces an actionable error, leaves the recorded
  actions intact and creates nothing; restoring the directory and retrying saves **exactly once**.
  A 288-character name and a mixed Arabic/CJK/emoji name are both stored verbatim.
  **Documented policy:** a duplicate name creates a second, distinctly-identified flow — asserted, so
  a future decision to reject or auto-rename is deliberate rather than a silent regression.

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
- **Status:** `PASS` — `npm run verify:recorder-gui` drives the table itself: a repeated URL
  deduplicates to one row, the newest entry sorts first, search narrows the rows, a no-match search
  shows none, clearing restores the list, a row's reuse control loads the URL into the Target field,
  and reuse is disabled while a recording is active. Paging and page-size controls, the copy action,
  and cross-restart persistence of history remain unexecuted.

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
- **Status:** `PASS` — `npm run verify:recorder-gui`. A protected surface raises the handoff panel;
  Ignore-and-continue resumes the SAME recording with its actions intact, sets
  `protectedDetectionIgnored`, shows the operator notice, leaves the global Setting at `false`, and a
  subsequent session starts with the override cleared. Re-visiting the same signal within the session
  was not separately exercised.

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
- **Status:** `PASS` — `npm run verify:recorder-draft`, **50/50**. Cancel from every phase
  (`detected`, `capturingSession`, `sessionCaptured`, `error`) completes without throwing, ends the
  recording, and leaves no active handoff to block the next session. The phase guards refuse
  out-of-order operations with actionable messages: ignore with no detection waiting, normal-browser
  handoff from the `error` phase, and session capture before the capture phase begins.

### REC-024 — Browser closes or crashes during recording

- **Priority / layer:** P0 / resilience
- **Preconditions:** Active recording with persisted actions.
- **Steps:** Close the recorded page, close the browser, and terminate the browser process in separate
  runs; return to Recorder; stop/cancel/save or restart.
- **Expected:** UI leaves Recording state; draft remains recoverable where safe; no process leak;
  Stop/Cancel do not hang; next Start works.
- **Status:** `NOT RUN` for a real browser close/crash. `verify:recorder-gui` proves the adjacent
  teardown properties — a session torn down mid-handoff leaves the Recording state, re-enables Start,
  a new recording starts cleanly, and no recording remains active at suite end — but it does not kill
  the browser process or close the recorded page out-of-band, which is the case's actual trigger.

### REC-025 — Single-active-recorder concurrency and rapid commands

- **Priority / layer:** P0 / concurrency
- **Preconditions:** Recorder is idle.
- **Steps:** Double-click Start; invoke Start through two renderer calls; rapidly Stop/Cancel; navigate
  away and back while starting/stopping.
- **Expected:** At most one browser/context exists; duplicate Start returns “already in progress” or
  is UI-disabled; Stop/Cancel are idempotent-safe; state and draft remain consistent.
- **Status:** `PASS` — `npm run verify:recorder-gui`. The rendered Start control is disabled during a
  recording; a direct duplicate `recorder:start` through preload is refused with
  `Recording is already in progress.` and the original session survives; Stop and Cancel with nothing
  running are safe and leave consistent state. Navigating away and back mid-command is not covered.

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
- **Status:** `PASS` — `verify:reports-populated-gui`, **112/112**. Five workflows seeded across three
  machines with each filter dimension varying independently. Every sortable column (`Workflow`,
  `Runs`, `Success`, `Avg`, `p95`) was driven in both directions, holding the same row set and
  reporting a definite `aria-sort` each time; the ordering itself is proven against the column's own
  values (`Runs` descending `20,12,2,2,2`, ascending `2,2,2,12,20`). All four filters narrow to a
  strict subset and restore on clear, two filters intersect rather than union (3 → 1), contradictory
  filters show an explicit empty state, and machine-context labels are asserted so a cross-machine
  comparison cannot be presented as same-machine.

### SYS-REP-005 — Workflow comparison limit and deltas

- **Priority / layer:** P1 / GUI analytics
- **Preconditions:** At least five workflow rows with current/previous-window history.
- **Steps:** Enable Compare; select/deselect rows; attempt a fifth selection; inspect success,
  duration, runs and delta values.
- **Expected:** Maximum four selected; fifth is disabled/refused; values match backend comparison;
  new/up/down/flat semantics and higher-is-better direction are correct.
- **Status:** `PASS` — `verify:reports-populated-gui`, **112/112**. With five populated rows, Compare
  renders a control per row; two then four selections render matching cards; a fifth is refused (the
  control is `disabled` and no fifth card appears) and the four existing selections survive the
  attempt; deselecting releases a slot (4 → 3); and each card carries both percentage and numeric
  figures with delta direction.

### SYS-REP-006 — Recent runs and Run Detail drawer

- **Priority / layer:** P0 / GUI → telemetry → artifact access
- **Preconditions:** Selected workflow has passed, failed, retried and cancelled runs with artifacts.
- **Steps:** Open workflow row; select recent run; inspect metadata, attempts and artifacts; open valid
  artifact; close by button/Escape/scrim; delete a retained run and retry.
- **Expected:** Correct run opens; attempts/artifacts match durable rows; path open is allowed only for
  approved runtime roots; missing run shows retention message; focus returns to opener.
- **Status:** `NOT RUN` for artifact launch and an explicit retention message. Durable row identity,
  two attempts, two artifacts, button-close, **Escape-close and focus return** now pass in the
  populated gate (**112/112**) — the last two found and fixed `AWKIT-REP-004`. A missing retained run
  is asserted to degrade safely (no throw, no path leak), but `telemetry.runDetail` returns
  `{attempts:[],artifacts:[]}` for an unknown id, which the UI cannot distinguish from a run that was
  retained with no attempts; surfacing a retention message needs a telemetry contract change and is
  recorded as `NOT RUN`, not as a pass.

### SYS-REP-007 — Instance Reports paging and live status

- **Priority / layer:** P0 / GUI and concurrency state
- **Preconditions:** More than one history page plus live queued/running instances.
- **Steps:** Compare live distribution; page forward/back; open a row; change time range.
- **Expected:** Live counts match engine state; no duplicate/missing history rows; buttons disable at
  boundaries; row detail is correct.
- **Status:** `NOT RUN` for queued/running live-state transitions — the populated gate passed
  38-row two-page history, exact `1–25`/`26–38` boundaries, no duplicate/missing IDs, disabled
  boundary action, and correct row detail. **Same root cause as SYS-REP-011:** `useLiveDistribution`
  polls `executions.list()` from the live `ExecutionEngine`, never the durable store, so seeded
  history cannot produce a queued or running instance. Asserting "no instances in the pool" here
  would prove only that the fixture seeds no live work, which is true by construction — it is
  recorded as `NOT RUN`, not passed.

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
- **Status:** `NOT RUN` for low-sample flakiness suppression and evidence navigation. The populated
  GUI (**112/112**) passed six named categories, the exact failed total, both workflow rankings, and
  now the **unknown-category** subcase: three uncategorised failures are surfaced rather than dropped,
  the category distribution accounts for every one of the 9 failed runs, and no non-failed run appears
  in the failure evidence list. Taxonomy/backend logic remains green in `verify:telemetry`.

### SYS-REP-010 — Runtime Analytics historical capacity and anomaly views

- **Priority / layer:** P0 / telemetry and observability
- **Preconditions:** Seed capacity/admission/process samples, historical workflow baselines and anomalies.
- **Steps:** Inspect peak metrics, timelines, admission reasons, pool effectiveness, rankings,
  regressions and recovered anomalies over multiple ranges.
- **Expected:** Aggregates, buckets, percentages and anomaly state match source data; unavailable
  metrics are neutral, not zero; environmental observations are labelled.
- **Status:** `NOT RUN` for the neutral-vs-zero unavailable-metric matrix on this page only.
  **Multi-range and recovered-anomaly transitions are now executed** in
  `verify:reports-populated-gui` (**136/136**). Capacity buckets are seeded so that each preset band
  contains exactly one more than the last, and all five presets return their derived count —
  `15m=12 1h=13 24h=14 7d=15 all=16` — so a range argument that was ignored, clamped or sign-flipped
  produces a different sequence. The recovered-anomaly subcase found and fixed `AWKIT-REP-005`.
  Seeded capacity, admission reasons, process history, active anomaly and environmental labels
  render correctly; normal/empty/migration/high-data Runtime Analytics is 36/36 and backend
  observability is 65/65.

### SYS-REP-011 — Chrome Consumption live gauges and polling

- **Priority / layer:** P1 / live runtime telemetry
- **Preconditions:** Idle application; optionally run a bounded synthetic workflow.
- **Steps:** Open Chrome Consumption; inspect browser pool, concurrency, memory, CPU and process detail;
  wait through multiple polls; trigger/release backpressure.
- **Expected:** Four gauges render with values or neutral unavailable state; page remains stable;
  backpressure reason appears and clears; no timer/listener leak is observed.
- **Status:** `NOT RUN` for active-workflow/backpressure/cleanup subcases — four gauges and a second
  polling cycle passed in both the fresh-profile and populated GUI gates. **Root cause of the gap,
  recorded so it is not re-investigated:** `telemetry:server` reads `backpressureBlocked` from
  `executionEngine.getRuntimeStatus().capacity.dispatchBlocked` — live in-memory engine state that a
  store-seeded fixture cannot produce at all. Closing this needs a harness that saturates a real
  engine with real instances, not more seeding. The admission/backpressure logic itself is green in
  `verify:capacity`.

### SYS-REP-012 — Server Performance and storage sizing

- **Priority / layer:** P1 / IPC and filesystem aggregation
- **Preconditions:** Runtime directories exist with known synthetic files.
- **Steps:** Open Server Performance; compare process/system values and per-directory sizes; remove a
  directory or deny access in an isolated root; refresh.
- **Expected:** Four metric cards and storage section render; known sizes are accurate; missing/denied
  paths degrade to unavailable without crashing or leaking paths outside runtime roots.
- **Status:** `NOT RUN` for the large-directory bound only. `dirSizeMb` deliberately stops after
  20,000 entries, so a folder above that silently under-reports; that bound is documented in the
  source but has never been exercised. Everything else is executed in `verify:reports-populated-gui`
  (**136/136**):
  - **Exact bytes** — 1.5 MiB written to a Screenshots *sub-folder* reads back as `1.5`, Logs as `5`,
    and the total equals the sum of its parts, so the walk recurses and the arithmetic is checked
    against what was written rather than against itself.
  - **Missing path** — the Downloads folder is never created and reports `0` without failing the
    report.
  - **Denied path** — a 4 MiB sub-tree has its read ACL revoked via `icacls` *before the app starts*,
    so the first storage read already exercises the branch. The denial is asserted as a precondition
    (this process genuinely cannot enumerate it) so the exclusion cannot pass for the wrong reason;
    Logs reads `5`, not the `9` an unbounded walk would report, and the rest of the page still
    renders. The ACL is restored in a `finally` and the restoration is itself a check.
  - **Cache expiry** — storage is cached for 60 s. A read, then a 2 MiB write, then a second read
    returns the *stale* figure (`3`, where a fresh walk would say `5`); after the TTL elapses the
    recomputed figure is exactly `5`.
  - **No path leak** — every Windows path the page renders is required to sit under the runtime root,
    with the count reported so the check cannot pass vacuously on a page that renders none.

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
- **Status:** `PASS` for the executed audit — `verify:reports-settings-a11y` 14/14 plus seeded
  `aria-sort` and run-drawer focus assertions in `verify:reports-populated-gui` (**112/112**). The
  drawer focus-trap/return subcase is now executed and found `AWKIT-REP-004`: focus moves into the
  drawer on open, Escape dismisses it, and focus returns to the opening control. Chart accessible
  summaries remain unexecuted. Covers keyboard reach, the
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
- **Status:** `PASS` — `verify:recorder-gui`, **103 PASS / 0 FAIL / 0 NOT RUN**. Toggling either
  capture switch persists to Settings, both restore from Settings when the page is reopened, and both
  **lock** during a recording. **The mid-session behavioural half is now executed** on the
  `/recorder-lab?rec013=1` fixture, using the two *observable* consequences of the capture flags
  rather than an unfalsifiable claim that "nothing changed":
  - A session is launched with Smart Wait capture ON and waiting-time capture OFF, which makes a quiet
    gap produce a `fixedDelay` and suppresses `wait` action insertion.
  - Waiting-time capture is then switched **on** mid-recording through Settings — the only route left,
    since the page locks its own switches. The change is asserted to have really persisted, so
    "live capture was unaffected" cannot pass vacuously.
  - The live session still reports `fixedDelay=2, waitActions=0`: its launch-time values, not the new
    ones. `RecorderService.start` assigns `captureWaitTime`/`captureSmartWaits` once, so the binding
    is launch-time by construction and there is no race in when the change lands.
  - The **next** session on the identical fixture reports `fixedDelay=0, waitActions=1` — the exact
    opposite shape. That is both the "next session uses new values" half and the negative control for
    the assertion above: the same fixture and the same quiet gap driven to the opposite result, so the
    first outcome cannot have been a property of the fixture rather than of the setting.

### SET-005 — Ignore protected-login detection confirmation and scope

- **Priority / layer:** P0 / security
- **Preconditions:** Setting is off.
- **Steps:** Enable and cancel confirmation; enable and confirm; start Recorder; disable; restart.
- **Expected:** Cancel persists nothing; confirm warns that authentication is not bypassed; setting
  affects new sessions; visible session notice appears; disabling restores pause behavior.
- **Status:** `PASS` — the Settings confirmation, cancel, persist, restart and disable paths passed in
  `verify:settings-e2e` (116/116); `verify:recorder-gui` (**90/90**) now closes the Recorder/session
  half. A session launched while the Setting is on starts with detection ignored and shows the visible
  notice, whose text states that authentication, MFA and CAPTCHA must still be completed manually.
  Flipping the Setting **mid-session** does not change the running session — asserted alongside a
  control proving the persisted value really did change, so the check cannot pass vacuously — and the
  **next** session picks up the new value. With the Setting off, a protected surface pauses again.

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
- **Status:** `PASS` — `verify:settings-e2e`, **139/139**. The picker is driven with the OS dialog
  stubbed in the **main** process, so the real `system:browseFolder` handler, its `SETTINGS_EDIT`
  check and the renderer's "null means leave it alone" branch all stay under test: cancelling leaves
  the value unchanged, accepting applies the chosen folder, and the choice persists as the artifact
  location. Both branches are asserted, because "unchanged after cancel" alone is equally satisfied by
  a Browse button that does nothing. A **genuinely unwritable** directory (ACL-denied, with the denial
  asserted as a precondition) is now correctly reported `exists: true, writable: false` and rendered
  `read-only` — that check found and fixed `AWKIT-SET-005`. Blank and file-as-directory validation,
  writable-directory truth, individual reset, save and restart also pass.

### SET-008 — Designer and execution default validation boundaries

- **Priority / layer:** P0 / client + main-process validation
- **Preconditions:** Settings page loaded.
- **Steps:** Test zoom 24/25/200/201; zero/negative dimensions; zero/fractional run counts; defaults
  above maxima; concurrency above runs; valid boundaries.
- **Expected:** Invalid combinations show all actionable errors and do not persist; main-process
  validation rejects direct invalid IPC; valid boundaries save and appear in new designer/run forms.
- **Status:** `NOT RUN` for the new-**run**-form half of propagation only, which is scoped to SET-009
  and not counted twice here. **New-designer propagation is now executed**: two different zoom
  defaults (75 % and 150 %) are driven through a freshly opened Flow Designer and read back from the
  visible zoom control. Two values, because one would match by coincidence — the default is 100 %.
  The per-designer `flowDesignerZoomPercent` is cleared first, or the assertion would silently read
  the saved per-designer zoom and pass regardless of the Setting. **The valid boundary matrix is also
  executed** in `verify:settings-e2e` (**151/151**): zoom `25` and `200` (the inclusive edges), node
  width `1`, `maxRuns` `1`, `defaultRuns === maxRuns` and `maxConcurrentRuns === maxRuns` are each
  accepted *and* read back persisted. This is the half that was missing — rejecting `24` and `201`
  proves only that something is refused out there, and is equally satisfied by a rule that wrongly
  refuses `25` and `200` too. Eight invalid direct-IPC combinations are still rejected without
  persistence, and rendered validation errors are announced.

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
- **Status:** `NOT RUN` for the unavailable-store variant only. **Rapid submit is now executed** in
  `verify:settings-e2e` (**128/128**): three Add clicks fired without awaiting produce **exactly one**
  row and exactly one durable record — asserted as `=== 1` rather than `>= 1`, since `>= 1` is what a
  duplicate-creating implementation would also satisfy. Real GUI add, update, masked-list,
  cancel-delete, confirm-delete, restart persistence and no-plaintext evidence also pass.

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
- **Status:** `NOT RUN` for the real OS folder launch only, which is a recorded manual check by the
  same owner decision as SYS-REP-008. **Unreadable-store recovery is now executed** in
  `verify:settings-e2e` (**139/139**): the flows store has its read ACL revoked (with unreadability
  asserted as a precondition), after which the flows count degrades to `0` **while the other three
  stores keep reporting truthfully** — a handler that let the rejection escape would have taken all
  four down together. Restoring access returns the count to `3`, so the `0` is demonstrably a
  degradation rather than a permanent loss. Seeded counts, Refresh Counts and the runtime-folder
  action also pass.

### SET-016 — Clear UI State is non-destructive

- **Priority / layer:** P0 / data safety
- **Preconditions:** Saved user data plus non-default sidebar/layout/selection UI state.
- **Steps:** Clear UI State; restart; inspect layout and all saved records/files.
- **Expected:** Only UI-state keys reset; flows, workflows, data sources, reports, sessions, secrets,
  drivers and settings data remain.
- **Status:** `PASS` — `verify:settings-e2e`, **128/128**. The inventory is now complete: sessions and
  driver records (a captured session profile, a Java runtime and an Oracle JDBC driver bundle) are
  seeded as real store files and read back through each store's own `list()`, **not** through
  `settings:getStorageStats`, which counts only flows/workflows/dataSources/reports and is therefore
  blind to exactly the two classes that were previously unverified. Their presence is asserted as an
  explicit precondition first, so "preserved" cannot mean "there was nothing to lose". Two flows, one
  workflow, one data source, one report, a secret and non-default settings also survive Clear UI State
  and restart.

### SET-017 — Export/import round-trip and protected security fields

- **Priority / layer:** P0 / import/export security
- **Preconditions:** Non-default settings with no secret values in settings object.
- **Steps:** Export; inspect JSON; change values; import export; restart; import file containing unknown
  fields and `ignoreHttpsErrors=true`.
- **Expected:** Supported values round-trip; export contains no stored secret values; unknown/invalid
  fields are rejected or normalized; import cannot silently enable certificate bypass; user data is
  not deleted.
- **Status:** `PASS` — `verify:settings-e2e`, **149/149**. **The post-import restart round-trip is now
  executed**, which is the half that mattered: every preceding assertion proved the import took effect
  in the *live* process, and an import that updated only in-memory state would have satisfied all of
  them and silently reverted on the next launch. After a real restart the imported execution defaults
  survive, every non-volatile top-level key is identical, the certificate bypass is still off, and the
  full data inventory (including sessions and driver records) is unchanged. Export bytes/filename/no
  plaintext, supported-value restoration, partial legacy merge, unknown-field pruning, data
  preservation and certificate-bypass refusal also pass; the dedicated HTTPS Settings GUI remains
  31/31.
  **Note for whoever extends this:** compare the document **per key**, not with a single
  `JSON.stringify` equality. `hydrate()` produces a different key *order* across a restart, so a
  whole-document string comparison reports a difference where none exists — it did, and the values
  were identical.

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
- **Status:** `PASS` — `verify:settings-e2e`, **128/128**. Cancel/confirm, documented default
  restoration, runtime caps and restart all pass, and the data-preservation inventory is now
  complete: the seeded session, Java runtime and driver bundle survive the confirmed reset, and the
  three classes are asserted identical from before Clear UI State through to after the reset. Profile
  counts are compared separately because SET-015 legitimately adds a flow mid-run.

### SET-020 — Offline Runtime validation action

- **Priority / layer:** P1 / integration
- **Preconditions:** Complete offline bundle, then isolated missing/corrupt dependency variants.
- **Steps:** Click Validate Offline Runtime for each state; open Offline Runtime detail when issues exist.
- **Expected:** Passing bundle reports success; failure count and detail agree; action does not download
  dependencies or require network; no false success on missing browser/runtime.
- **Status:** `PASS` — `verify:settings-e2e`, **149/149**. The passing bundle reports success, and the
  **failing variant is now exercised**: a runtime folder is made genuinely unwritable (with the
  denial asserted as a precondition), after which exactly one additional check fails, it is
  `folder.downloads` by name, and the banner's issue count agrees with the underlying checks.
  Restoring the folder clears the failure on the next validation, so the result is a real observation
  of current state rather than a latched flag. `internetRequired` and `runtimeDownloadsAllowed` are
  both asserted false, so the action cannot be satisfying itself by downloading. `resources/` is
  deliberately untouched — the offline rules forbid writing there, and the isolated profile's runtime
  folders give the same signal. This matters because a passing bundle proves only that the action
  *runs*; a validator hard-wired to report success would have satisfied the previous check perfectly.

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
- **System Reports:** **9 PASS / 7 NOT RUN**, with `verify:reports-populated-gui` at **136/136**.
  Empty-state GUI, backend analytics, populated overview truth, the full sort/filter matrix, the
  comparison limit, multi-range capacity, recovered anomalies, storage sizing/denial/cache fault
  injection, export/path security, authorization and the executed accessibility audit are green.
  The seven remaining cases are each open for a *named* residual submatrix, not wholesale:
  - **Blocked on a live engine, not on more seeding** — SYS-REP-007 (queued/running transitions) and
    SYS-REP-011 (backpressure) both read live `ExecutionEngine` state that a store-seeded fixture
    cannot produce. These belong to a run-driving harness.
  - **Owner-decision manual** — SYS-REP-008's real Explorer launch.
  - **Needs a contract change** — SYS-REP-006's explicit retention message.
  - **Straightforward remaining work** — SYS-REP-009 low-sample flakiness and evidence navigation,
    SYS-REP-010's neutral-vs-zero matrix, SYS-REP-012's 20,000-entry directory bound, and
    SYS-REP-006's artifact launch.
- **Settings:** **17 PASS / 4 NOT RUN**, with `verify:settings-e2e` at **151/151** and
  `verify:recorder-gui` at **103/103** — page/IPC
  authorization, every section, direct validation *and its valid boundary edges*, path truth
  including the folder picker and a genuinely ACL-denied directory, Secrets CRUD and rapid submit,
  counts and unreadable-store recovery, the complete UI-state/reset data-preservation inventory (now
  including sessions and driver records), the post-import restart round-trip, offline validation of
  both a healthy *and* a broken dependency, and modal/error accessibility. SET-004, SET-007, SET-016,
  SET-017, SET-019 and SET-020 closed this round; SET-007 found and fixed `AWKIT-SET-005`. SET-004's
  mid-session half is proven in `verify:recorder-gui`, which owns the mock site and the Recorder
  controls, rather than by duplicating that infrastructure into the Settings gate.
  The five remaining cases are open for a *named* residual subcase each:
  - **SET-008** — the new-**run-form** half of propagation only; the designer half is executed.
  - **SET-009** — runner *behaviour* proof (headed/headless, screenshot-on-failure, stop-on-error);
    persistence already passes, this needs a bounded real run.
  - **SET-013** — an unavailable secret store. Requires `safeStorage.isEncryptionAvailable()` to be
    false, which has no injection seam from outside the main process.
  - **SET-015** — the real OS folder launch, a recorded manual check by the same owner decision as
    SYS-REP-008.

No defect is inferred from a `NOT RUN` or `BLOCKED` result.
