# SECURITY

## Secret handling
- **Never** commit or paste secrets (passwords, tokens, API keys, certificates, session values,
  production credentials) into code, docs, logs, or `docs/ai/*`.
- `.env.example` (repo root) documents expected environment keys; the real `.env` is local only and
  is git-ignored (`.gitignore`). Do not add real values to `.env.example`.
- If you find secret-like values in the repo, do **not** copy them into documentation — note only
  that secret-like values exist and where to review them manually.
- Mask secrets in structured logs and reports (per the spec's reporting/logging rules).
- Passive CDP observation is local and read-only: its command allowlist excludes input/navigation
  actions, DOM capture is opt-in, URL queries/fragments and request/console payloads are removed,
  sensitive headers/credentials are redacted, raw bytes and retained samples are bounded, and
  renderer access requires `Permission.PAGE_INSTANCES`.

## Environment / config
- Runtime config comes from `.env` files, runtime profiles, and the UI settings store.
- `PRODUCTION_OFFLINE` / `ALLOW_RUNTIME_DOWNLOADS` env vars influence offline mode; default behavior
  derives offline mode from `app.isPackaged` (`isProductionOffline()`).
- Active Directory sign-in is disabled unless trusted main-process config explicitly sets
  `AWKIT_AD_ENABLED=true` plus `AWKIT_AD_URL` and `AWKIT_AD_DOMAIN`. Plain LDAP is rejected unless
  `AWKIT_AD_START_TLS=true`; LDAPS/StartTLS require TLS 1.2+ and always validate certificates.
  `AWKIT_AD_CA_FILE` may name a local PEM enterprise CA. Directory passwords are used only for the
  bind, never persisted or logged. AD identities must be pre-provisioned as AWKIT users; roles and
  direct overrides remain local administrator-owned authorization state.

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
- **Closed-shadow bridge** (`src/runner/closedShadowBridge.ts`, epic `awkit-65g` C2): a runtime
  `addInitScript` wraps `attachShadow` (mode preserved, never forced open) and retains closed roots in a
  closure WeakMap behind a per-process token-gated resolver, so the runner can replay an interaction inside a
  closed shadow root. It exposes no accessor to workflow expressions / IPC / renderer, persists no internal
  accessible name, and **must never be used to automate CAPTCHA / MFA / OTP / passkeys / device approval /
  protected-login / bot-detection** — the protected-login detector above takes precedence. Design review:
  `docs/ai/security-reviews/2026-08-04-closed-shadow-c2.md`; gate: `verify:closed-shadow`.

## Offline / network safety
- Production offline mode must not execute remote scripts, load remote renderer code, fetch CDN
  assets, or attempt network downloads. Use bundled local resources only.
- No telemetry / online update checks.
- AD causes no background traffic and no login traffic while disabled or incompletely configured.
  When explicitly enabled, only a user-initiated AD login/reauth contacts the configured directory
  endpoint; Virtual User sign-in remains the offline fallback.

## Files that should never contain secrets
- Any file under `docs/`, `docs/ai/`, `resources/`, `vendor/`, sample data, manifests, or committed
  config. Secrets belong only in a local, git-ignored `.env`.

## License issuance key boundary
- The package contains the Issuer UI and trusted signing logic but never a private signing key. The key is
  provisioned separately under `%LOCALAPPDATA%\SpecterStudio\issuer-keys\` on the issuer workstation (or
  selected by the `SPECTER_ISSUER_KEY` path variable), and only the Electron main process reads it.
- **One resolver decides the location:** `resolveIssuerKeyLocation()` in
  `src/licensing/issuer/IssuerLocations.ts`, used by the Electron main composition root, the dashboard
  bridge, the issuer CLI and keygen. It never returns a working-directory-relative path — no profile
  variable, a relative `SPECTER_ISSUER_KEY`, or an unusable key id all fail closed as
  `CONFIGURATION_ERROR` rather than resolving a private key under the caller's cwd. Never add a second
  place that composes an `issuer-keys` path; `verify:roadmap-license-issuer` fails if one appears.
- **Readiness names a location only where it is safe to.** `IssuerReadiness.expectedKeyLocation` carries
  the `redactKeyPath`'d location (`%LOCALAPPDATA%\…`) so an operator can provision a missing key. It is
  opt-in per composition root: the Electron main process passes it (exclusive `Issuer` role, fresh
  reauth, same process boundary); the dashboard bridge must NOT, because its answer is served to a
  browser over HTTP. It is a location, never key material — no readiness, issuance result,
  issuance-history record, audit entry, IPC payload, or rendered page ever carries the key bytes.
- There is deliberately no fallback, dev, or auto-generated signing key. A missing key blocks issuance
  and says where to provision one; it is never manufactured to make the issuer ready.
- Issuance requires the built-in `Issuer` role as the account's sole role, only one stored user may hold
  it, and every signing call requires fresh reauthentication. A permission grant or Super User session is
  insufficient at the IPC boundary.
- Activation requests are bounded and validated before signing; generated files are confined to
  `%LOCALAPPDATA%\SpecterStudio\issuer-output\`, written atomically, and recorded without key material.
- There is no online activation service. A license for another offline machine must still be transferred
  back and imported there; silently adding a network transport would change the offline/security model.

## Unknown / Needs Verification
- Whether any sample data under `resources/sample-*` contains realistic-but-fake credentials —
  review before distributing; ensure they are clearly non-production.
