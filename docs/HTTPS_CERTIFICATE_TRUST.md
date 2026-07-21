# HTTPS Certificate Trust — "Ignore invalid HTTPS certificates"

**Setting:** `Settings → Recorder Security → Ignore invalid HTTPS certificates`
**Default:** disabled
**Canonical property:** `ignoreHttpsErrors` (never `ignoreSslErrors` / `allowUnsafeCertificates` / `skipTlsValidation`)

## What the option does

When enabled, AWKIT creates its automation browser contexts with Playwright's `ignoreHTTPSErrors`, so
navigation continues instead of failing when a site presents an untrusted certificate. It covers the
Chromium certificate-trust family, including:

| Error | Cause |
|---|---|
| `net::ERR_CERT_AUTHORITY_INVALID` | Self-signed, or issued by a CA the machine does not trust |
| `net::ERR_CERT_DATE_INVALID` | Expired or not-yet-valid certificate |
| `net::ERR_CERT_COMMON_NAME_INVALID` | Certificate does not match the hostname being visited |

It also suppresses the related `net::ERR_SSL_*` trust rejections. Unrelated navigation failures
(`ERR_NAME_NOT_RESOLVED`, `ERR_CONNECTION_REFUSED`, timeouts) are **not** affected and still fail
normally.

## What it does NOT do

- It does **not** disable TLS. Traffic is still encrypted; only the *trust check* on the server
  certificate is skipped.
- It does **not** downgrade HTTPS to HTTP.
- It does **not** modify the Windows/OS certificate store, and never requests administrator rights.
- It does **not** apply to your real Chrome/Edge. The manual-login browser used by the
  **Recorder secure-login handoff** (`SessionCaptureService`) stays a plain, unflagged consumer
  browser where you make your own trust decisions.
- It does **not** bypass CAPTCHA, MFA, bot detection, or any other browser security control.
- AWKIT never clicks through Chromium's interstitial ("Advanced" → "Proceed to …") and never types the
  hidden bypass phrase. The option is applied as a Playwright context option **before** the page is
  created and navigated — there is no interstitial to click.

## Why it is disabled by default

Skipping certificate validation removes the guarantee that you are talking to the server you think you
are talking to; on an untrusted network it makes an interception attack invisible to the automation.
It is therefore off unless a user with `settings.edit` permission explicitly turns it on and confirms
the warning dialog.

**Appropriate use:** authorized internal, development, staging, and test environments using
self-signed or internally issued certificates.
**Not appropriate:** unknown or public websites, or production runs.

**Preferred alternative for production:** install your organization's trusted root certificate
authority into the Windows certificate store. Chromium uses the OS trust store, so once the root CA is
trusted, internally issued certificates validate normally and this option can stay off.

## Configuration precedence

```
Run-level override        (RunWorkflowRequest.ignoreHttpsErrors)
  → Workflow-level        (WorkflowProfile.security.ignoreHttpsErrors)
    → Application setting (UiSettings.recorder.security.ignoreHttpsErrors)
      → false
```

Each tier is skipped only when it is *absent*. An explicit `false` at any tier wins over an enabled
tier below it — so a workflow can force validation back on even when the global setting is enabled.
A value that is not literally `true` or `false` (corrupt settings file, hand-edited JSON) is treated
as absent, which means it falls through to `false` — malformed data can never enable the bypass.

The chain is resolved **once per run**, in `execution.ipc.resolveInstanceTemplate`, and stamped onto
the instance config. Recorder resolves the application tier at launch time in `recorder.ipc`.

## How Recorder and the runtime inherit it

Everything flows through two places, so no launch path can be missed:

- **`src/runner/BrowserContextFactory.ts`** — the single factory for every workflow-runtime context.
  It applies the option to all three creation paths: `launchPersistentContext` (captured session /
  persistent isolation), pooled `browser.newContext()` (shared browser, parallel isolated contexts),
  and dedicated `browser.newContext()`.
- **`src/recorder/RecorderService.ts`** — holds the decision on the service instance so both the
  initial `browser.newContext()` and the post-handoff `launchPersistentContext()` resume (Auto Secure
  Login / Reuse Session) use the same value.

Because the value lives on the instance config and the factory is constructed per run, it is inherited
automatically by retries, mid-run browser restarts/swaps, scheduled and repeated runs, headed and
headless execution, and packaged offline mode.

`src/security/browser/CertificateTrust.ts` is the single source of truth: the precedence rules, the
`buildBrowserContextOptions` helper that maps `ignoreHttpsErrors` → Playwright's `ignoreHTTPSErrors`,
the error classifier, and the log payload all live there.

## Chromium fallback launch argument

The implementation is **context-level only**. `--ignore-certificate-errors` is **not** used by any
AWKIT launch path, because every Recorder and runtime browser is driven through a Playwright context
and both `newContext()` and `launchPersistentContext()` accept `ignoreHTTPSErrors`.

A documented escape hatch exists for a Chromium build where context-level suppression proves
insufficient: set `AWKIT_CERT_FALLBACK_LAUNCH_ARG=true`. It is off by default, is added only when the
bypass is also enabled, is never duplicated, and is never applied to non-Chromium browsers.

> The switch is **browser-level**, so it would apply to every context on that browser. When it is
> active it is folded into `sharedCompatibilityKey`, which partitions the shared browser pool so a
> bypassing browser can never be reused by an instance that expects validation. The context-level
> option deliberately does *not* partition the pool — contexts are isolated from each other.

## Logging and reporting

- One structured warning per created browser context:
  `HTTPS certificate validation is disabled for this browser context`.
  Runtime contexts log it into the run log as event `security.certificateTrust` with
  `{ ignoreHttpsErrors, surface, source, workflowId, runId, instanceId }`. Recorder logs
  `{ ignoreHttpsErrors, surface: "recorder" }`.
- Payloads carry **ids only** — no URLs (which can contain tokens in query parameters), cookies,
  headers, or credentials. Run-log data is additionally passed through `SecretMasker`.
- Execution reports record the posture under `security`:

  ```json
  "security": { "ignoreHttpsErrors": true, "ignoreHttpsErrorsSource": "app" }
  ```

  so a run that passed against an untrusted certificate is distinguishable from one that passed
  against a trusted certificate.
- The Recorder shows a non-blocking banner below the toolbar while a session is running with
  validation disabled.

## Error handling when the option is OFF

A navigation that fails on certificate trust produces an actionable message instead of a bare
`net::ERR_*` code:

```
The website certificate could not be trusted.

For an authorized internal or testing environment, you can enable:
Settings → Recorder → Security → Ignore invalid HTTPS certificates

For production environments, correct the website certificate or install the trusted organization
certificate authority.

Underlying error: page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://…
```

The original Playwright error is preserved. The bypass is **never** enabled automatically in response
to an error, and non-certificate navigation errors are never rewritten.

## Permissions and persistence

- Stored at `UiSettings.recorder.security.ignoreHttpsErrors` in `ui-settings.json`.
- A settings patch touching `recorder.security` requires the `settings.edit` permission (its siblings
  `captureWaitTime` / `captureSmartWaits` remain open, since the Recorder page writes them implicitly).
- Settings files written before this feature existed have no `security` key; `hydrate()` fills the
  secure default, so old files load unchanged and startup never fails.
- The value is read in the main process from the persisted store. It is **not** a renderer-supplied
  `recorder.start` option, so it cannot be forced from the renderer.
- Enabling requires confirming a warning dialog; cancelling leaves the setting disabled. Disabling
  applies immediately.

## Verification

```bash
npm run verify:https-certificates
```

55 checks: unit coverage of defaults, persistence normalization, precedence, context-option
construction, the fallback argument, error classification and log safety; plus live Chromium
integration against local HTTPS servers with generated self-signed / expired / wrong-host
certificates, exercising the real `BrowserContextFactory` (dedicated, persistent, shared-pool) and
`RecorderService` code paths. No external website is contacted; the test certificate and key are
generated in memory per run (`scripts/lib/selfSignedCertificate.mts`) and never written to disk.
