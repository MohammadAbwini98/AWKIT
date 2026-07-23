/**
 * Certificate-trust policy for AWKIT-owned automation browsers.
 *
 * Single source of truth for the "Ignore invalid HTTPS certificates" option: the precedence rules,
 * the Playwright context-option builder, the certificate-error classifier used for actionable
 * messages, and the safe structured-log payload.
 *
 * The bypass is applied EXCLUSIVELY as a per-`BrowserContext` Playwright option (`ignoreHTTPSErrors`).
 * There is deliberately no browser-level `--ignore-certificate-errors` launch switch: every AWKIT
 * automation browser is driven through a Playwright context (`newContext` / `launchPersistentContext`,
 * both of which accept `ignoreHTTPSErrors`), so context scope is sufficient and keeps the exception
 * confined to the one context that opted in rather than the whole browser process.
 *
 * SCOPE — this module only tells Playwright not to REJECT an untrusted server certificate inside an
 * AWKIT-owned automation browser context. It does NOT disable TLS, does not downgrade HTTPS to HTTP,
 * does not touch the OS/Windows certificate store, and is never applied to the user's real Chrome
 * (SessionCaptureService) — that browser stays a plain, unflagged consumer browser where the user
 * makes their own trust decisions.
 *
 * DEFAULT — disabled. Every resolution path falls back to `false`, including missing/corrupt persisted
 * values, so an older `ui-settings.json` (or a hand-edited one) can never silently enable the bypass.
 */

/** Canonical property name. Do NOT introduce aliases (ignoreSslErrors / skipTlsValidation / …). */
export const DEFAULT_IGNORE_HTTPS_ERRORS = false;

/** Recorder security preferences (persisted under `UiSettings.recorder.security`). */
export interface RecorderSecuritySettings {
  /**
   * When true, Recorder and workflow execution continue on untrusted / expired / self-signed /
   * mismatched HTTPS certificates. Authorized internal + test environments only.
   */
  ignoreHttpsErrors: boolean;
}

export const DEFAULT_RECORDER_SECURITY_SETTINGS: RecorderSecuritySettings = {
  ignoreHttpsErrors: DEFAULT_IGNORE_HTTPS_ERRORS
};

/**
 * Optional per-workflow override. `undefined` inherits the application setting; `false` explicitly
 * re-enables certificate validation even when the global setting is on.
 */
export interface WorkflowSecuritySettings {
  ignoreHttpsErrors?: boolean;
}

/**
 * Inputs to the precedence chain. Every tier is optional; an absent (or non-boolean) tier is skipped
 * rather than treated as `false`, so a lower tier can still supply the value.
 */
export interface CertificateTrustSources {
  /** Highest precedence: a single run's explicit override (execution request). */
  run?: boolean;
  /** Per-workflow security settings, when the workflow defines them. */
  workflow?: WorkflowSecuritySettings;
  /** Application-level Recorder/Execution security settings. */
  app?: RecorderSecuritySettings | { ignoreHttpsErrors?: boolean };
}

/**
 * Coerce a persisted/IPC value to a strict boolean. Anything that is not literally `true` or `false`
 * (missing key, `"true"`, `1`, `null`, object) yields `undefined` = "not specified", which the
 * resolver then falls through. This is what keeps a malformed settings file fail-SAFE (validation on)
 * instead of fail-open.
 */
export function readIgnoreHttpsErrors(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Normalize a persisted `recorder.security` group. Missing/invalid → the secure default (`false`).
 * Used by the settings hydrator so a settings file written before this feature existed loads cleanly.
 */
export function normalizeRecorderSecuritySettings(value: unknown): RecorderSecuritySettings {
  const group = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { ignoreHttpsErrors: readIgnoreHttpsErrors(group.ignoreHttpsErrors) ?? DEFAULT_IGNORE_HTTPS_ERRORS };
}

/**
 * Effective certificate-trust decision.
 *
 * Precedence: run-level override → workflow-level setting → global Recorder/Execution setting → false.
 */
export function resolveIgnoreHttpsErrors(sources: CertificateTrustSources = {}): boolean {
  return (
    readIgnoreHttpsErrors(sources.run) ??
    readIgnoreHttpsErrors(sources.workflow?.ignoreHttpsErrors) ??
    readIgnoreHttpsErrors(sources.app?.ignoreHttpsErrors) ??
    DEFAULT_IGNORE_HTTPS_ERRORS
  );
}

/** Which tier supplied the effective value (diagnostics / logs — never user data). */
export function explainIgnoreHttpsErrors(sources: CertificateTrustSources = {}): "run" | "workflow" | "app" | "default" {
  if (readIgnoreHttpsErrors(sources.run) !== undefined) return "run";
  if (readIgnoreHttpsErrors(sources.workflow?.ignoreHttpsErrors) !== undefined) return "workflow";
  if (readIgnoreHttpsErrors(sources.app?.ignoreHttpsErrors) !== undefined) return "app";
  return "default";
}

export interface BrowserContextSecurityOptions {
  ignoreHttpsErrors: boolean;
}

/**
 * Fold the certificate-trust decision into a Playwright context-options object. Shape-agnostic on
 * purpose: the same helper serves `browser.newContext()` and
 * `browserType.launchPersistentContext()` (both accept `ignoreHTTPSErrors`), so there is exactly one
 * place in the codebase that maps our `ignoreHttpsErrors` onto Playwright's `ignoreHTTPSErrors`.
 * Existing options are always preserved.
 */
export function buildBrowserContextOptions<T extends object>(
  existingOptions: T,
  security: BrowserContextSecurityOptions
): T & { ignoreHTTPSErrors: boolean } {
  return { ...existingOptions, ignoreHTTPSErrors: security.ignoreHttpsErrors };
}

/**
 * Chromium `net::ERR_CERT_*` / `net::ERR_SSL_*` family. Deliberately narrow — it must not swallow
 * unrelated navigation failures (DNS, connection refused, timeouts), which keep their own messages.
 */
const CERTIFICATE_ERROR_PATTERN = /net::ERR_(CERT_[A-Z0-9_]+|SSL_[A-Z0-9_]+|BAD_SSL_[A-Z0-9_]+)/;

/** True when the error text is a Chromium certificate/TLS-trust rejection. */
export function isCertificateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CERTIFICATE_ERROR_PATTERN.test(message);
}

/** The specific `net::ERR_*` code, when present (safe to log — it contains no user data). */
export function certificateErrorCode(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = message.match(CERTIFICATE_ERROR_PATTERN);
  return match ? `net::ERR_${match[1]}` : undefined;
}

/**
 * Actionable guidance shown when a navigation fails on certificate trust while the bypass is OFF.
 * Purely informational — AWKIT never enables the bypass automatically in response to an error.
 */
export const CERTIFICATE_ERROR_GUIDANCE = [
  "The website certificate could not be trusted.",
  "",
  "For an authorized internal or testing environment, you can enable:",
  "Settings → Recorder → Security → Ignore invalid HTTPS certificates",
  "",
  "For production environments, correct the website certificate or install the trusted organization certificate authority."
].join("\n");

/**
 * Wrap a failed navigation in the actionable certificate message. Non-certificate errors and errors
 * raised while the bypass is already enabled are returned untouched, so no unrelated navigation
 * failure is ever suppressed or relabelled.
 *
 * The original message is preserved verbatim (it carries the `net::ERR_*` code Playwright reported);
 * only the guidance is appended. Callers pass the URL separately if they want it — it is intentionally
 * NOT interpolated here, since URLs can carry tokens in query parameters.
 */
export function describeCertificateError(error: unknown, ignoreHttpsErrors: boolean): string {
  const message = error instanceof Error ? error.message : String(error);
  if (ignoreHttpsErrors || !isCertificateError(error)) return message;
  return `${CERTIFICATE_ERROR_GUIDANCE}\n\nUnderlying error: ${message}`;
}

/**
 * Structured-log payload emitted once per created browser context when validation is disabled.
 * Contains only non-sensitive identifiers — never URLs, cookies, headers, or credentials.
 */
export interface CertificateTrustLogFields {
  ignoreHttpsErrors: true;
  surface: "recorder" | "runtime";
  source: ReturnType<typeof explainIgnoreHttpsErrors>;
  workflowId?: string;
  runId?: string;
  instanceId?: string;
}

export const CERTIFICATE_BYPASS_LOG_MESSAGE = "HTTPS certificate validation is disabled for this browser context";
