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
| `/recorder-lab` | Recorder, locator engine, saved URL history | Accessible form controls, manual pause/countdown, reusable local URLs, linear Start/End flow, dynamic DOM with stable selectors, and a **non-unique controls** scenario (`data-testid="duplicate-controls"`): two package cards share a checkbox accessible name (`0796713928`) and a `Select package` button, plus a customer table repeating an `Edit` button per row — the Recorder must disambiguate with a compound selector or by scoping to the stable container (`package-basic`/`package-pro`/row text). |
| `/designer-lab` | Flow Designer, Workflow Builder, Instance Monitor | Canvas-like area with Start/Action/End, contextual edge/leaf picker and selection-drawer contract, workflow cards grid, stable named flows/workflows, an execution-grouped workflow run summary that opens a three-instance detail modal, and Smart Wait scenario data examples. |
| `/mock/popup/` | Multi-Window / Popup Flow Handling | Index of 7 popup scenarios: target blank, window.open, auto-close, stays-open, multiple popups, failure cases, and smart-wait popup. |
| `/mock/protected-login` | Recorder protected-login detection + secure Chrome handoff | Password + one-time-code login with protected-login warning and a `Complete Manual Login` button. The Recorder must detect it (`data-testid` `password`, `otp`, `complete-login`) and pause. |
| `/mock/protected-popup-login` | Recorder protected-popup detection | `Open Protected Login Popup` opens a popup with a password login (external identity provider). Recorder must detect the popup and pause; `Complete Manual Login` closes it and the main page shows an authenticated marker (`data-testid="auth-status"`). |
| `/mock/protected-popup-captcha` | Recorder CAPTCHA-popup detection | Opens a popup with a reCAPTCHA-like `iframe[src*=recaptcha]` placeholder and `[aria-label*=captcha]`. Recorder must detect and pause. No CAPTCHA solving is implemented. |
| `/mock/protected-popup-otp` | Recorder OTP-popup detection | Opens a popup with an `input[autocomplete="one-time-code"]` and `Complete Manual Verification`. Recorder must detect and pause; completing it shows a verified marker. |
| `/mock/session-reuse` | Reuse Session node | NOT a protected login (Recorder must not pause). Toggles logged-out/logged-in states with a visible authenticated marker (`data-testid` `auth-status`, `dashboard`) for testing `Reuse Session`. |
| `/mock/sso-text-app` | Protected-login false-positive (confidence detector) | A normal authenticated app page that merely contains the text "single sign-on" / "identity provider" — no password field, MFA, or CAPTCHA. The Recorder must **not** pause (low-confidence → continue). `data-testid` `open-reports`, `reports-panel`. |
| `/api/delay?ms=300` | Runner/Smart Wait response waits | Returns local JSON after a bounded deterministic delay. |

## Using it with Recorder

1. Start the site with `npm run mock-site`.
2. Record `http://localhost:4321/recorder-lab` for accessible controls, manual waiting-time capture,
   saved URL reuse, dynamic DOM, and Start -> actions -> End flow validation.
3. Record `http://localhost:4321/smart-waits` for Smart Wait observation signals.
4. Record `http://localhost:4321/login` -> `/form` for the existing core login/form flow.

## Using it with Flow Designer / Workflow Builder

1. Start the mock site.
2. Optionally seed local app fixtures:

   ```bash
   npm run seed:mock-fixtures
   ```

3. Use `/designer-lab` for manual panel/canvas/card scenarios and `/smart-waits` for wait-node or
   Smart Wait scenario data.

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
