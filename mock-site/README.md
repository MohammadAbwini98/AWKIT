# Mock Site - Feature Test Lab

The mock site is AWKIT's local **Feature Test Lab**: a deterministic offline website for Recorder,
Runner, Smart Wait, Flow Designer, Workflow Builder, Instance Monitor, locator, node, wait, and execution
features. It uses Node's built-in `http` module only - no internet and no extra dependencies.

## Start it

```bash
npm run mock-site
```

Open `http://localhost:4321/`. Change the port with `MOCK_SITE_PORT`.

## Scenario URLs

| URL | Related AWKIT feature | Expected behavior |
| --- | --- | --- |
| `/` | Feature Test Lab index | Lists every local scenario with title, description, expected behavior, feature, and stable URL. |
| `/login` | Runner core, Recorder, seeded fixtures | Any non-empty username/password submits to `/form`. |
| `/form` | Runner core nodes, route-change trigger | Full form with stable labels, ids, and test ids; submit navigates to `/success`. |
| `/details` | Route Change node | Opens in a new tab from `/form`; automation must switch context before interacting. |
| `/success?id=...` | Assertions and reports | Shows submitted values with stable ids. |
| `/smart-waits` | Smart Wait Engine, Runner timing, Recorder wait capture | Element appears/disappears, text changes, button enables, loader/content, delayed navigation, modal, toast, delayed API response, sequential waits, intentional failure context, and fast no-wait scenario. |
| `/async-results` | Async completion policies, response status handling, empty-result contracts | Loader plus exactly one outcome per action: three invoice rows (`data-testid="results-table"`, rows in `tbody`), a **valid empty result** (HTTP 200, zero rows → table hidden, `data-testid="empty-state"` visible), or a selectable HTTP error (`data-testid="error-banner"`). Controls: `load-populated`, `load-empty`, `load-error`, `error-code`, `results-delay-ms`, `reset-async-results`. Use it to prove an error status is reported as a status failure rather than a wait timeout, and that an empty result only counts as success when an empty outcome is explicitly configured. |
| `/recorder-lab` | Recorder, locator engine, saved URL history | Accessible form controls, manual pause/countdown, reusable local URLs, linear Start/End flow, dynamic DOM with stable selectors, and a **non-unique controls** scenario (`data-testid="duplicate-controls"`): two package cards share a checkbox accessible name (`0796713928`) and a `Select package` button, plus a customer table repeating an `Edit` button per row — the Recorder must disambiguate with a compound selector or by scoping to the stable container (`package-basic`/`package-pro`/row text). |
| `/recorder-sensitive` | REC-007 sensitive-value redaction | Nine inputs covering password, one-time code, card number, CVC, PIN, SSN, API token and shared secret, plus one deliberately **non**-sensitive display name as a control. **Expected:** each control is captured as a recorded step, but no typed value reaches the draft, flow JSON, run log, report or diagnostics. Submitting POSTs to `/api/recorder/sensitive` with the token in the **query string, an `Authorization` header, and a JSON body**, so the Smart Wait network signal is exercised against exactly the material a canary scan then hunts for. The route counts the received fields and discards them — it stores, logs and echoes nothing. Nothing here authenticates anything. |
| `/recorder-sensitive?rec007=1` | REC-007 capture harness | Self-drives the sensitive form with fixed canary constants (`window.__AWKIT_REC007_CANARIES`), double-gated on the query param **and** `window.__awtkit_recordAction` exactly like the REC-018 harness. **Why this is a separate page and not a `/recorder-lab` section:** a page carrying password and one-time-code inputs reads as a protected login surface, so the Recorder's detector pauses the recording — correct behavior that would otherwise have changed the security character of every scenario recorded on the shared lab page. `verify:recorder-redaction` asserts that pause happens by default before it disables detection for the redaction run. |
| `/recorder-lab?rec018=1` | REC-018 record → save → replay gate | **Capture harness.** Self-drives the basic form so the Recorder has real DOM events to capture without a human, then goes inert during replay. Double-gated on the query param **and** `window.__awtkit_recordAction`, so it never affects other recordings and never fills the form during a production replay. Status: `data-testid="rec018-status"`. See "Using it with Recorder" below. |
| `/designer-lab` | Flow Designer, Workflow Builder, Instance Monitor | Canvas-like area with Start/Action/End, contextual edge/leaf picker and selection-drawer contract, workflow cards grid, stable named flows/workflows, an execution-grouped workflow run summary that opens a three-instance detail modal, and Smart Wait scenario data examples. |
| `/mock/popup/` | Multi-Window / Popup Flow Handling | Index of 9 popup scenarios: target blank, window.open, auto-close, stays-open, multiple popups, failure cases, smart-wait popup, reversed order, and script/timer identity. |
| `/popup/reversed-order.html` | Deterministic page identity (FR-C1.5) | Opens two distinguishable popups — alpha (`/popup/reversed-popup-alpha.html`) and beta (`/popup/reversed-popup-beta.html`) — in **either** order (`open-alpha-first-button`, `open-beta-first-button`, plus single-open and `close-all-button`). Each popup's identity comes from its own stable path, so both orders must resolve to the same two aliases. A positional `popup-N` counter swaps them; an identity-derived alias must not. Status text: `data-testid="order-status"`. |
| `/popup/script-timer.html` | Deterministic page identity (FR-C1.3) | `arm-timer-button` opens `/popup/script-timer-popup.html` after a bounded 400 ms timer with **no** click or `switchToPopup` step, so only a synthetic alias can name it. The timer URL deliberately carries a secret-shaped `?token=…&session=…#section-2` that must never reach an alias or diagnostic (only origin + pathname are identity-bearing). `open-ambiguous-button` opens two popups at the **same** origin+pathname — genuinely indistinguishable identity, which must surface an explicit ambiguity error rather than order-based aliases. Status text: `data-testid="timer-status"`. |
| `/mock/protected-login` | Recorder protected-login detection + secure Chrome handoff | Password + one-time-code login with protected-login warning and a `Complete Manual Login` button. The Recorder must detect it (`data-testid` `password`, `otp`, `complete-login`) and pause. |
| `/mock/protected-popup-login` | Recorder protected-popup detection | `Open Protected Login Popup` opens a popup with a password login (external identity provider). Recorder must detect the popup and pause; `Complete Manual Login` closes it and the main page shows an authenticated marker (`data-testid="auth-status"`). |
| `/mock/protected-popup-captcha` | Recorder CAPTCHA-popup detection | Opens a popup with a reCAPTCHA-like `iframe[src*=recaptcha]` placeholder and `[aria-label*=captcha]`. Recorder must detect and pause. No CAPTCHA solving is implemented. |
| `/mock/protected-popup-otp` | Recorder OTP-popup detection | Opens a popup with an `input[autocomplete="one-time-code"]` and `Complete Manual Verification`. Recorder must detect and pause; completing it shows a verified marker. |
| `/mock/session-reuse` | Reuse Session node | NOT a protected login (Recorder must not pause). Toggles logged-out/logged-in states with a visible authenticated marker (`data-testid` `auth-status`, `dashboard`) for testing `Reuse Session`. |
| `/mock/sso-text-app` | Protected-login false-positive (confidence detector) | A normal authenticated app page that merely contains the text "single sign-on" / "identity provider" — no password field, MFA, or CAPTCHA. The Recorder must **not** pause (low-confidence → continue). `data-testid` `open-reports`, `reports-panel`. |
| `/runner-lab` | `downloadFile` / `uploadFile` nodes, retry policy, error handling | Four scenarios in one page: attachment downloads (`data-testid` `download-csv`/`download-txt`/`download-json`), controlled HTTP failures with the received status and `Retry-After` echoed to the DOM (`fail-500`/`fail-503`/`fail-429`/`fail-404`, `failure-status`, `failure-retry-after`), a fail-twice-then-succeed endpoint (`flaky-call`, `flaky-reset`, `flaky-success`), and a multipart upload that echoes filename, byte size, and a content preview (`upload-input`, `upload-submit`, `upload-filename`, `upload-size`, `upload-result`). |
| `/iframe-lab` | `LocatorFrameContext`, Recorder frame scoping | Same-origin interactive iframe (`data-testid="lab-frame"`) whose child (`/iframe-child`) has an input, select, checkbox, and Apply/Reset buttons. **The top document deliberately repeats the same `Message` label and `Apply inside frame` button**, so a locator that ignores frame scoping silently hits the inert decoy instead of failing — the failure mode worth testing. The child mirrors its state to the parent (`mirror-message`, `mirror-country`, `mirror-applied`) so a top-level assertion can confirm the frame interaction happened. |
| `/api/download?type=csv\|txt\|json` | `downloadFile` node | Responds with `Content-Disposition: attachment` and a deterministic body, raising a real browser download event. |
| `/api/http-status?code=<code>&retryAfter=<s>` | Error handling, retry policy | Returns the requested status (400/401/403/404/409/422/429/500/502/503); adds `Retry-After` for 429 and 503. |
| `/api/flaky?key=<key>&failures=<n>` | Retry policy | Returns 503 for the first `n` calls of a key (max 5), then 200. Deterministic and per-key, never random. Reset with `/api/flaky/reset?key=<key>` (omit `key` to clear all). |
| `POST /api/upload` | `uploadFile` node | Accepts `multipart/form-data` and echoes `filename`, `size`, a content `preview`, and the `note` field. Returns 400 when no file part is present. |
| `/api/delay?ms=300` | Runner/Smart Wait response waits | Returns local JSON after a bounded deterministic delay. |
| `/api/status?code=500&ms=0` | Response status vs timeout | Returns the requested status from an allow-list (200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504; anything else falls back to 500). No 3xx, so it can never act as an open redirect. Optional bounded `ms` delay. |
| `/api/results?mode=populated&ms=300` | Empty-result completion contracts | `mode=populated` returns three fixed rows; `mode=empty` returns HTTP 200 with zero rows. Both are successes — only the UI outcome differs. |
| `/recorder-lab?rec013=1` | REC-013 async review modal | **Capture harness.** Self-drives two form fields separated by a deliberately *quiet* 1.4 s so the Recorder emits a `fixedDelay` wait — the one the async-review policy classifies `needsReview`, which is what makes the review dialog open. Double-gated on the query param **and** `window.__awtkit_recordAction`, so it is inert during replay. Status: `data-testid="rec013-status"`. **Requires Smart Wait capture ON and waiting-time capture OFF** — see below. |
| `/api/rec018/state`, `/api/rec018/reset`, `POST /api/rec018/submit` | REC-018 replay equivalence | Resettable, in-memory oracle for the fixed synthetic Recorder-lab form. The verifier resets it after capture; a later matching submission proves the inert fixture was completed by production replay. It accepts no credentials, cookies, headers, or session state. |

## Using it with Recorder

1. Start the site with `npm run mock-site`.
2. Record `http://localhost:4321/recorder-lab` for accessible controls, manual waiting-time capture,
   saved URL reuse, dynamic DOM, and Start -> actions -> End flow validation.
3. Record `http://localhost:4321/smart-waits` for Smart Wait observation signals.
4. Record `http://localhost:4321/login` -> `/form` for the existing core login/form flow.
5. Record `http://localhost:4321/recorder-lab?rec018=1` for the **REC-018 capture harness** (below).

### REC-018 capture harness (`/recorder-lab?rec018=1`)

Lets the REC-018 release gate — Recorder page -> launched browser -> recorded actions -> Stop -> Save
-> reopen -> production replay — run without a human at the keyboard. On load the page fills the basic
form (`Rec018 Operator`, `rec018@example.test`, plan `Enterprise`, newsletter checked) and clicks
**Save recorder form**, so `recorder-form-result` reads `Recorder form saved for Rec018 Operator`.
Events are dispatched with `dispatchEvent`; the Recorder's init script listens via `addEventListener`
and does not filter on `isTrusted`, so they are captured exactly like user-generated events. Bounded
and deterministic: five steps at 400 ms + 200 ms each, ~1.2 s total.

It fires only when **both** gates are open:

1. the URL carries `?rec018=1` — so every other `/recorder-lab` recording is unaffected; and
2. `window.__awtkit_recordAction` exists — the binding `RecorderService` exposes, present **only**
   while a recording session is attached.

Gate 2 is what keeps the REC-018 replay assertion honest. During a production `ExecutionEngine` replay
there is no Recorder and therefore no binding, so the harness stays inert and the form can only be
filled by the replayed steps themselves. Without it the fixture would fill its own form during replay
and the gate would pass while proving nothing.

Observable state via `data-testid="rec018-status"`: `REC-018 harness idle` (no query gate) ->
`REC-018 harness inert (no recorder attached)` (gate 1 only) -> `REC-018 harness armed` ->
`REC-018 harness completed`. All three branches are asserted by `npm run verify:mock-site`.

### REC-013 async-review harness (`/recorder-lab?rec013=1`)

Same two gates as REC-018, for a different purpose: producing a recording the async-review policy
considers **review-worthy**, so the Save-time review dialog actually opens. Without it, REC-013 had
no reachable precondition and was reported `NOT RUN`.

**The mechanism is specific, and the obvious guess is wrong.** It is a `fixedDelay` wait that
`reviewWait` classifies as `needsReview` ("Fixed delay is a timing guess, not a real completion
signal"), and `buildSmartWaits` emits one **only** when no reliable condition was detected *and*
`allowFixedDelayFallback` is set. `RecorderService` passes
`allowFixedDelayFallback: !this.captureWaitTime`. So:

- **Smart Wait capture must be ON** and **waiting-time capture must be OFF.** With waiting-time
  capture on, the fallback is suppressed and no `fixedDelay` is ever produced.
- **The gap must be genuinely quiet.** Any fetch, DOM mutation or loader inside that window yields a
  reliable condition instead, and the fallback never fires. This is why the harness does not touch
  its own status element between the two actions — that mutation alone would suppress it.

The harness fills `#recorderFullName` at 400 ms and `#recorderEmail` at 1800 ms: a 1.4 s still
window, comfortably above the 400 ms `minMeaningfulMs` floor. Observable state via
`data-testid="rec013-status"`: `REC-013 harness idle` -> `REC-013 harness inert (no recorder
attached)` -> `REC-013 harness armed` -> `REC-013 harness completed`.

`verify:recorder-gui` asserts the `fixedDelay` is present **before** asserting anything about the
dialog, so a fixture that silently stopped producing one fails loudly instead of degrading into a
vacuous pass.

## Using it with Flow Designer / Workflow Builder

1. Start the mock site.
2. Optionally seed local app fixtures:

   ```bash
   npm run seed:mock-fixtures
   ```

3. Use `/designer-lab` for manual panel/canvas/card scenarios and `/smart-waits` for wait-node or
   Smart Wait scenario data.

## Oracle-driven form scenario (data-driven runs)

`/form` doubles as the target for **Oracle Data Source** testing. `SPECTER_MOCKUI.MOCK_FORM_CASES`
(`scripts/oracle/local-19c-mock-ui-fixture.sql`) holds 8 rows whose columns map 1:1 onto the controls on
this page, so a workflow can run **SELECT → fill `/form` → assert `/success`** once per row.

| Column | `/form` control | Why the row exists |
| --- | --- | --- |
| `FIRST_NAME` / `LAST_NAME` / `EMAIL` | `#firstName` / `#lastName` / `#email` | NULL optional text must leave the input **blank**, not type `"null"` |
| `AGE` / `SALARY` | `#age` / `#salary` | `NUMBER(12,2)` arrives as a 2-decimal **string**, not a JSON number |
| `BIRTH_DATE` | `#birthDate` | `DATE` arrives as an ISO instant; a NULL date must type nothing |
| `COUNTRY` / `ACCOUNT_TYPE` | `#country` / `#accountType` | select values must be real options |
| `SKILLS` | `#skills` (multi) | comma-separated list → one row selects exactly one option |
| `GENDER` | `#genderMale` / `#genderFemale` | NULL gender must leave **neither** radio selected |
| `INTEREST_*` / `ACCEPT_TERMS` | checkboxes | `0` must actively **uncheck** on a reused page |
| `EXPECTED_OUTCOME` | — | `SUCCESS` for 7 rows; `BLOCKED` for the terms-declined negative case |

The same dataset is served **without a database** by `MockFormCasesFixture` in the bridge's mock
executor, so the identical SQL and workflow run offline (`AWKIT_ORACLE_BRIDGE_MOCK=1`). Packaged builds
still refuse mock mode. Verify both edges — and that the fixture's values are still valid controls on
this page — with:

```bash
npm run verify:oracle-mock-ui
npm run verify:oracle-mock-ui-workflow
```

The first command proves SQL-fixture/bridge parity and control compatibility. The second loads the
persisted Oracle Data Source, flow, and workflow, runs all 8 rows in real Chromium (including the
production `ExecutionEngine` path), checks every mapped DOM value, captures screenshots/logs/reports,
and proves the terms-declined row remains on `/form` because `#acceptTerms` is required.

## Extending the lab

- Check existing scenarios before creating a new page.
- Prefer extending `/smart-waits`, `/recorder-lab`, or `/designer-lab` instead of duplicating pages.
- Every scenario must have a stable local URL, title, description, expected behavior, related AWKIT
  feature, and stable selectors using role/name, labels, placeholders, and/or `data-testid`.
- Any new page or scenario must be covered by `npm run verify:mock-site` or another focused verifier.
- Keep all behavior deterministic, local-only, and free of external services.

## Verification

```bash
npm run verify:mock-site
npm run verify:protected-login-recorder
```

`verify:mock-site` starts the mock site on its own port, checks key pages, exercises delay scenarios, and
asserts stable selectors for Recorder and Designer scenarios.

`verify:protected-login-recorder` covers the secure-login lab: it runs the pure recorder detection (password
/ OTP / CAPTCHA / passkey / MFA-text, plus a no-false-positive check and a no-secrets check), drives the
`/mock/protected-*` pages and popups asserting the recorder detects each protected surface (and does NOT
pause on `/mock/session-reuse`), and verifies the inserted `Auto Secure Login` / `Reuse Session` flow nodes
serialize with the saved session id linked.
