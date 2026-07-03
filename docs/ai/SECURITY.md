# SECURITY

## Secret handling
- **Never** commit or paste secrets (passwords, tokens, API keys, certificates, session values,
  production credentials) into code, docs, logs, or `docs/ai/*`.
- `.env.example` (repo root) documents expected environment keys; the real `.env` is local only and
  is git-ignored (`.gitignore`). Do not add real values to `.env.example`.
- If you find secret-like values in the repo, do **not** copy them into documentation — note only
  that secret-like values exist and where to review them manually.
- Mask secrets in structured logs and reports (per the spec's reporting/logging rules).

## Environment / config
- Runtime config comes from `.env` files, runtime profiles, and the UI settings store.
- `PRODUCTION_OFFLINE` / `ALLOW_RUNTIME_DOWNLOADS` env vars influence offline mode; default behavior
  derives offline mode from `app.isPackaged` (`isProductionOffline()`).

## Safe automation (product-level, non-negotiable)
- WebFlow Studio is for **authorized** web UI automation only. Do **not** implement behavior that
  bypasses CAPTCHA, MFA, bot detection, access restrictions, or rate limits; no fake-account
  creation, spam, or exploitation.
- For human-required steps (login/MFA/approval), use **manual handoff** (`ManualHandoffController`):
  pause the affected instance, prompt the user, resume after the manual action.
- **Protected Login Handoff** (`src/security/ProtectedLoginDetector.ts`): the runner detects protected/
  automation-blocked login pages (Google/Microsoft/Okta/Auth0/Duo, "browser may not be secure",
  CAPTCHA/MFA/security-check) and **pauses** with a handoff UI — it must **never** bypass these. Do not
  add stealth/anti-detection, CAPTCHA/MFA/bot-detection bypass, fingerprint spoofing, patched Chromium,
  fake user agents, automated Google username/password login, or extraction/copying of cookies from a
  user's normal Chrome/Edge/Firefox profile. OAuth (when configured via `WFS_OAUTH_*`) opens the
  provider's approved flow in the **system browser** via `shell.openExternal`; it never fabricates
  tokens/success or transfers UI cookies into the automation browser. Detection/handoff surface only the
  URL/provider/reason — never cookies/tokens/localStorage/session contents. See
  `docs/PROTECTED_LOGIN_HANDOFF.md`.

## Offline / network safety
- Production offline mode must not execute remote scripts, load remote renderer code, fetch CDN
  assets, or attempt network downloads. Use bundled local resources only.
- No telemetry / online update checks.

## Files that should never contain secrets
- Any file under `docs/`, `docs/ai/`, `resources/`, `vendor/`, sample data, manifests, or committed
  config. Secrets belong only in a local, git-ignored `.env`.

## Unknown / Needs Verification
- Whether any sample data under `resources/sample-*` contains realistic-but-fake credentials —
  review before distributing; ensure they are clearly non-production.
