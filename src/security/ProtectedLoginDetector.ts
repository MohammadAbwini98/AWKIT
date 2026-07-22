import type { Page } from "playwright";

/**
 * Protected-login detection. Identifies known protected/auth providers and blocked-automation
 * states (e.g. Google's "this browser or app may not be secure", MFA/CAPTCHA/security checks) so
 * the runner can PAUSE and hand off to the user instead of trying to bypass the protection.
 *
 * SAFETY: this module only *detects*. It never bypasses, spoofs, or works around any protection,
 * and it never reads or returns cookies/tokens/session contents.
 */

export type ProtectedLoginProvider = "google" | "microsoft" | "okta" | "auth0" | "duo" | "unknown";

export type ProtectedLoginReason =
  | "known-provider"
  | "blocked-automation-browser"
  | "mfa"
  | "captcha"
  | "sso"
  | "security-check"
  // ── Recorder-side handoff (conservative DOM/text signals) ────────────────────
  | "login-form"
  | "passkey"
  | "digital-signature"
  | "external-approval"
  | "unknown";

/**
 * How strongly the signals point at a genuine protected surface.
 * - `low`   — a single weak/text-only signal (e.g. the page merely contains "single sign-on").
 * - `medium`— a concrete but non-blocking login affordance (e.g. a password field).
 * - `high`  — a known provider host, CAPTCHA/MFA/passkey, or a browser-security block.
 */
export type ProtectedLoginConfidence = "low" | "medium" | "high";

/**
 * Recommended handling for a detection. Only `pause` triggers the manual-handoff flow; `continue`
 * lets the recorder/runner keep going (used for low-confidence false positives such as SSO body
 * text). This never bypasses authentication — the user still completes any real login manually.
 */
export type ProtectedLoginRecommendedAction = "continue" | "warn" | "pause";

export interface ProtectedLoginDetection {
  detected: boolean;
  provider: ProtectedLoginProvider;
  reason: ProtectedLoginReason;
  /** Confidence that this is a genuine protected surface (drives `recommendedAction`). */
  confidence: ProtectedLoginConfidence;
  /** What the caller should do. `pause` = manual handoff; `continue`/`warn` = keep recording. */
  recommendedAction: ProtectedLoginRecommendedAction;
  url: string;
  title?: string;
  matchedPattern?: string;
  message: string;
}

/** Host suffixes mapped to providers (matched against the page's hostname). */
const PROVIDER_HOSTS: { suffix: string; provider: ProtectedLoginProvider }[] = [
  { suffix: "accounts.google.com", provider: "google" },
  { suffix: "signin.google.com", provider: "google" },
  { suffix: "accounts.youtube.com", provider: "google" },
  { suffix: "login.live.com", provider: "microsoft" },
  { suffix: "login.microsoftonline.com", provider: "microsoft" },
  { suffix: "login.microsoft.com", provider: "microsoft" },
  { suffix: "okta.com", provider: "okta" },
  { suffix: "auth0.com", provider: "auth0" },
  { suffix: "duosecurity.com", provider: "duo" }
];

/** Text signals (lowercased, apostrophes normalized) → reason. Order = priority. */
const TEXT_PATTERNS: { pattern: string; reason: ProtectedLoginReason }[] = [
  { pattern: "this browser or app may not be secure", reason: "blocked-automation-browser" },
  { pattern: "couldn't sign you in", reason: "blocked-automation-browser" },
  { pattern: "try using a different browser", reason: "blocked-automation-browser" },
  { pattern: "verify you are human", reason: "captcha" },
  { pattern: "just a moment", reason: "captcha" },
  { pattern: "recaptcha", reason: "captcha" },
  { pattern: "captcha", reason: "captcha" },
  { pattern: "two-step verification", reason: "mfa" },
  { pattern: "two-factor", reason: "mfa" },
  { pattern: "multi-factor", reason: "mfa" },
  { pattern: "authenticator app", reason: "mfa" },
  { pattern: "enter a verification code", reason: "mfa" },
  { pattern: "verification code", reason: "mfa" },
  { pattern: "one-time password", reason: "mfa" },
  { pattern: "one time password", reason: "mfa" },
  { pattern: "verify it's you", reason: "security-check" },
  { pattern: "security check", reason: "security-check" },
  // Passkey / hardware security key challenges — a manual, hardware-bound step we never automate.
  { pattern: "passkey", reason: "passkey" },
  { pattern: "webauthn", reason: "passkey" },
  { pattern: "security key", reason: "passkey" },
  // Bank / signature / external-approval flows (manual out-of-band approval).
  { pattern: "digital signature", reason: "digital-signature" },
  { pattern: "bank authorization", reason: "external-approval" },
  { pattern: "external approval", reason: "external-approval" },
  { pattern: "identity provider", reason: "sso" },
  { pattern: "single sign-on", reason: "sso" }
];

function normalize(text: string): string {
  return text.replace(/[‘’]/g, "'").toLowerCase();
}

export function providerFromHost(host: string): ProtectedLoginProvider {
  const lower = host.toLowerCase();
  const match = PROVIDER_HOSTS.find((entry) => lower === entry.suffix || lower.endsWith(`.${entry.suffix}`));
  return match?.provider ?? "unknown";
}

function buildMessage(provider: ProtectedLoginProvider, reason: ProtectedLoginReason): string {
  if (provider === "google" && reason === "blocked-automation-browser") {
    return (
      "Google sign-in cannot be completed inside the automation browser. Google rejected this browser " +
      'context ("This browser or app may not be secure."). SpecterStudio will not bypass Google security ' +
      "protections — choose a supported handoff option (cancel, a previously saved session, OAuth in your " +
      "system browser, or a test-authenticated session for your own application)."
    );
  }
  const label = provider === "unknown" ? "A protected login / security page" : `A ${provider} protected login page`;
  return `${label} was detected (${reason}). SpecterStudio will not bypass login protections. Choose a supported handoff option.`;
}

/**
 * Reasons that, on their own, are strong evidence of a genuine protected surface the recorder/runner
 * must not automate (CAPTCHA, MFA, passkey, a browser-security block, or a known IdP). These always
 * resolve to `high` confidence → `pause`.
 */
const HIGH_CONFIDENCE_REASONS = new Set<ProtectedLoginReason>([
  "known-provider",
  "blocked-automation-browser",
  "mfa",
  "captcha",
  "security-check",
  "passkey",
  "digital-signature",
  "external-approval"
]);

/**
 * Classify a detection into a confidence level + recommended action.
 *
 * SAFETY / FALSE-POSITIVE FIX: a *text-only* `sso` signal ("single sign-on" / "identity provider")
 * with no known provider host and no concrete DOM affordance is a weak signal — a normal internal
 * app can contain that phrase. It resolves to `low` → `continue` so the recorder no longer pauses on
 * it. Everything currently treated as protected (providers, CAPTCHA, MFA, passkey, a detected login
 * form, …) stays `pause`, so no real protection is weakened.
 */
function classifyProtection(
  reason: ProtectedLoginReason,
  provider: ProtectedLoginProvider
): { confidence: ProtectedLoginConfidence; recommendedAction: ProtectedLoginRecommendedAction } {
  // A known identity-provider host is always a genuine protected page.
  if (provider !== "unknown") return { confidence: "high", recommendedAction: "pause" };
  if (HIGH_CONFIDENCE_REASONS.has(reason)) return { confidence: "high", recommendedAction: "pause" };
  // A concrete password field is a real (if non-blocking) login surface — AWKIT hands these off so
  // the user signs in manually in their real browser. Medium confidence, but still pauses.
  if (reason === "login-form") return { confidence: "medium", recommendedAction: "pause" };
  // Text-only SSO / anything else weak → low confidence, keep recording (the false-positive case).
  return { confidence: "low", recommendedAction: "continue" };
}

/**
 * Pure detection from page signals (URL + title + optional body text). Exposed for unit
 * verification without a live browser.
 */
export function detectFromSignals(url: string, title = "", bodyText = ""): ProtectedLoginDetection {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }
  const provider = providerFromHost(host);
  const text = normalize(`${title}\n${bodyText}`);
  const patternMatch = TEXT_PATTERNS.find((entry) => text.includes(entry.pattern));

  if (provider !== "unknown") {
    const reason = patternMatch?.reason ?? "known-provider";
    const { confidence, recommendedAction } = classifyProtection(reason, provider);
    return { detected: true, provider, reason, confidence, recommendedAction, url, title, matchedPattern: patternMatch?.pattern, message: buildMessage(provider, reason) };
  }
  if (patternMatch) {
    const { confidence, recommendedAction } = classifyProtection(patternMatch.reason, "unknown");
    return {
      detected: true,
      provider: "unknown",
      reason: patternMatch.reason,
      confidence,
      recommendedAction,
      url,
      title,
      matchedPattern: patternMatch.pattern,
      message: buildMessage("unknown", patternMatch.reason)
    };
  }
  return { detected: false, provider: "unknown", reason: "unknown", confidence: "low", recommendedAction: "continue", url, title, message: "" };
}

/** Whether the title alone is suspicious enough to warrant a (costlier) body-text scan. */
function titleIsSuspicious(title: string): boolean {
  const text = normalize(title);
  return TEXT_PATTERNS.some((entry) => text.includes(entry.pattern));
}

/**
 * Live detection against a Playwright page. Always checks URL + title (cheap); only reads body
 * text when the URL is a known provider or the title is already suspicious (keeps normal flows
 * fast and avoids false positives), unless `deepScan` forces a full body scan.
 */
export async function detectProtectedLogin(page: Page, options: { deepScan?: boolean } = {}): Promise<ProtectedLoginDetection> {
  let url = "";
  let title = "";
  try {
    url = page.url();
  } catch {
    url = "";
  }
  try {
    title = await page.title();
  } catch {
    title = "";
  }

  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }
  const isProvider = providerFromHost(host) !== "unknown";

  let bodyText = "";
  if (options.deepScan || isProvider || titleIsSuspicious(title)) {
    try {
      bodyText = (await page.locator("body").first().innerText({ timeout: 1500 })).slice(0, 4000);
    } catch {
      bodyText = "";
    }
  }

  return detectFromSignals(url, title, bodyText);
}

// ─── Recorder-side protected login / popup detection ───────────────────────────
// The recorder must PAUSE (and hand off to a manual real-browser login) the moment a protected
// login / MFA / OTP / CAPTCHA / passkey / approval surface appears — on the main page OR a popup.
// It reuses the same URL/title/text signals plus conservative, stable DOM signals. As with the
// runner, this only *detects*: no bypass, no reading of secrets/cookies/OTP/CAPTCHA values.

/** Stable DOM signals scanned in the page (booleans only — never field values). */
export interface ProtectedDomSignals {
  /** `input[type=password]` present. */
  passwordField?: boolean;
  /** `input[autocomplete="one-time-code"]` present (OTP/MFA). */
  oneTimeCodeField?: boolean;
  /** reCAPTCHA / hCaptcha / Turnstile iframe present. */
  captchaIframe?: boolean;
  /** An element labelled as a captcha (`[aria-label*=captcha]`). */
  captchaElement?: boolean;
  /** An element labelled for verification (`[aria-label*=verification]`). */
  verificationElement?: boolean;
  /** Passkey / WebAuthn / security-key affordance present. */
  webauthn?: boolean;
}

export interface RecorderProtectedDetection extends ProtectedLoginDetection {
  /** Human-readable, secret-free descriptions of what matched (for handoff metadata). */
  signals: string[];
}

/** Map DOM signals → the most specific protected reason (or null when none are strong enough). */
function reasonFromDomSignals(dom: ProtectedDomSignals): { reason: ProtectedLoginReason; signals: string[] } | null {
  const signals: string[] = [];
  let reason: ProtectedLoginReason | null = null;
  const pick = (candidate: ProtectedLoginReason, label: string) => {
    signals.push(label);
    if (!reason) reason = candidate;
  };
  if (dom.captchaIframe) pick("captcha", "captcha iframe");
  if (dom.captchaElement) pick("captcha", "captcha element");
  if (dom.oneTimeCodeField) pick("mfa", "one-time-code field");
  if (dom.verificationElement) pick("mfa", "verification element");
  if (dom.webauthn) pick("passkey", "passkey / security key");
  if (dom.passwordField) pick("login-form", "password field");
  return reason ? { reason, signals } : null;
}

/**
 * Combine text/provider signals with DOM signals into a single recorder detection. DOM signals are
 * the highest-confidence trigger (they work on any page without provider-specific text). Pure so it
 * can be unit-verified without a browser.
 */
export function detectFromRecorderSignals(
  url: string,
  title: string,
  bodyText: string,
  dom: ProtectedDomSignals = {}
): RecorderProtectedDetection {
  const textDetection = detectFromSignals(url, title, bodyText);
  const domHit = reasonFromDomSignals(dom);

  if (domHit) {
    const provider = textDetection.provider;
    // Prefer a stronger text reason (captcha/mfa) when both agree; otherwise use the DOM reason.
    const reason =
      textDetection.detected && (textDetection.reason === "captcha" || textDetection.reason === "mfa")
        ? textDetection.reason
        : domHit.reason;
    const signals = [...domHit.signals];
    if (textDetection.matchedPattern) signals.push(`text: ${textDetection.matchedPattern}`);
    if (provider !== "unknown") signals.push(`provider: ${provider}`);
    const { confidence, recommendedAction } = classifyProtection(reason, provider);
    return {
      detected: true,
      provider,
      reason,
      confidence,
      recommendedAction,
      url,
      title,
      matchedPattern: textDetection.matchedPattern,
      message: buildMessage(provider, reason),
      signals
    };
  }

  if (textDetection.detected) {
    const signals: string[] = [];
    if (textDetection.matchedPattern) signals.push(`text: ${textDetection.matchedPattern}`);
    if (textDetection.provider !== "unknown") signals.push(`provider: ${textDetection.provider}`);
    return { ...textDetection, signals };
  }

  return { ...textDetection, signals: [] };
}

/**
 * Live recorder detection against a Playwright page. Reads only booleans + a bounded body-text
 * snippet — never field values, cookies, or tokens. Safe to call on every navigation/load.
 */
export async function detectRecorderProtectedLogin(page: Page): Promise<RecorderProtectedDetection> {
  let url = "";
  try {
    url = page.url();
  } catch {
    url = "";
  }
  let title = "";
  try {
    title = await page.title();
  } catch {
    title = "";
  }

  let bodyText = "";
  let dom: ProtectedDomSignals = {};
  try {
    // NOTE: keep this evaluate body free of named function expressions (e.g. `const has = ...`) —
    // esbuild/tsx inject a `__name(...)` helper reference for those, which is undefined in the page
    // and would make the whole evaluate throw. Inline every querySelector directly instead.
    const result = await page.evaluate(() => {
      return {
        bodyText: (document.body?.innerText || "").slice(0, 4000),
        dom: {
          passwordField: !!document.querySelector('input[type="password"]'),
          oneTimeCodeField: !!document.querySelector('input[autocomplete="one-time-code"]'),
          captchaIframe: !!document.querySelector(
            'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]'
          ),
          captchaElement: !!document.querySelector(
            '[aria-label*="captcha" i], .g-recaptcha, .h-captcha, [data-testid*="captcha" i]'
          ),
          verificationElement: !!document.querySelector('[aria-label*="verification" i]'),
          webauthn:
            !!document.querySelector('input[autocomplete*="webauthn"]') ||
            !!document.querySelector('[aria-label*="passkey" i], [aria-label*="security key" i], [data-webauthn]')
        }
      };
    });
    bodyText = result.bodyText;
    dom = result.dom;
  } catch {
    // Page not ready / navigated away — fall back to URL + title signals only.
  }

  return detectFromRecorderSignals(url, title, bodyText, dom);
}
