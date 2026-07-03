# Protected Login Handoff

WebFlow Studio automates web flows with a Playwright-controlled Chromium. Some logins are
**deliberately protected** against automation — Google/Microsoft/SSO sign-in, MFA, CAPTCHA, and
bot-detection. WebFlow Studio **detects** those pages and **hands off to a human** instead of
trying to defeat the protection.

## Why this exists

Providers like Google reject automated/controlled browsers. A Playwright Chromium exposes automation
signals, so Google shows:

> Couldn't sign you in. **This browser or app may not be secure.** Try using a different browser.

ChatGPT/Cloudflare similarly shows a "Verify you are human" interstitial. Typing credentials inside the
automation browser does not help — the page itself refuses the automated context. The only correct,
compliant behavior is to **stop and hand off**.

## What the system does when a protected login is detected

1. **Detect** the page (`src/security/ProtectedLoginDetector.ts`) by provider URL and/or page text.
2. **Pause** the run — the runner returns a `manualHandoff` result; the instance goes to
   `waitingForManualAction`. No further automation steps run.
3. **Surface** a handoff card in **Instances › Concurrent Instance Monitor** with the provider, reason,
   URL, instance/workflow name, and a clear safe message.
4. **Wait** for the user's decision — it never auto-continues or loops forever.

Detection runs automatically after navigation-type steps (`goto`, `click`, `routeChange`, `wait`) and
can be triggered explicitly with the **Protected Login Handoff** Flow Designer node.

## Supported providers / signals

- **URL providers:** `accounts.google.com`, `signin.google.com`, `login.live.com`,
  `login.microsoftonline.com`, `login.microsoft.com`, `*.okta.com`, `*.auth0.com`, `*.duosecurity.com`.
- **Text signals:** "couldn't sign you in", "this browser or app may not be secure",
  "try using a different browser", "verify you are human", "just a moment", reCAPTCHA/CAPTCHA,
  "two-step verification" / "authenticator app" / "enter a verification code", "verify it's you",
  "security check", "single sign-on".

Detection is conservative: on a known provider URL it flags immediately; on other URLs it only flags
on a strong text signal (and only scans page text when the URL/title is already suspicious), so normal
flows are not interrupted. A false positive can simply be retried/continued — it never bypasses anything.

## Supported safe options

- **Cancel Run** — stops the instance.
- **Retry Detection** — re-runs the instance (e.g. after you've prepared an approved session).
- **Open OAuth in System Browser** — *only when OAuth is configured* (see below). Uses
  `shell.openExternal` to open the provider's approved OAuth flow in your real browser. This is for
  provider-approved **API/identity** auth — it does **not** copy UI cookies into the automation browser.
- **Use Saved Session** — shown **disabled** with the reason "Load Session is not implemented yet."
- **Use Test Session** — shown **disabled** with the reason "No configured test session is available."

Only implemented actions are active; unsupported ones are disabled with a reason (never fake no-ops).

## OAuth / system-browser behavior

OAuth is **foundation-only** and **off by default**. It is reported as available only when the project
provides real configuration via environment variables:

```text
WFS_OAUTH_CLIENT_ID
WFS_OAUTH_AUTH_URL
WFS_OAUTH_REDIRECT_URI   (optional)
WFS_OAUTH_SCOPE          (optional, default: "openid email profile")
```

When configured, `auth:openOAuth` builds the authorize URL and opens it in the system browser. WebFlow
Studio does **not** fabricate tokens, does **not** record a fake OAuth success, and stores no tokens
unless real callback/token handling is added later.

## Saved session limitations

The **Save Session** node can capture a Playwright `storageState` after a *human* login. Reusing it in a
new run (**Load Session**) is **not implemented yet**, so "Use Saved Session" is disabled. Even when
implemented, Google specifically also flags reused/automated sessions, so it is not a reliable Google
automation path.

## Test environment recommendation

For building/testing flows, target automation-friendly sites — e.g. the bundled mock site
(`npm run mock-site`, `http://localhost:4321`) or your own application with an authorized
test-authenticated session/backend-generated cookie. Do not use test sessions to bypass third-party
login protections.

## Unsupported / forbidden behavior

WebFlow Studio does **not** implement (and must not implement): stealth/anti-detection, CAPTCHA/MFA/
bot-detection bypass, fingerprint spoofing, patched Chromium, fake user agents, login-page workarounds,
automating Google username/password login, or extracting/copying cookies from a user's normal
Chrome/Edge/Firefox profile.

## Security notes

- Detection and handoff surface only the **URL, provider, reason, and message** — never cookies, tokens,
  localStorage, authorization headers, or session contents.
- Runner logs are masked by `SecretMasker`; handoff log lines record the provider/reason/mode only.
- Saved session files are sensitive local files under `%LOCALAPPDATA%/WebFlow Studio/sessions/`
  (see `docs/ai/SECURITY.md` and `KNOWN_ISSUES.md`).

## Verification

```bash
npm run verify:protected-login   # pure detector unit checks (Google/MS/Okta/Auth0/Duo, MFA/CAPTCHA, no false positives)
npm run verify:runner            # includes: Protected Login Handoff node pauses; auto-detect doesn't pause normal pages
```
