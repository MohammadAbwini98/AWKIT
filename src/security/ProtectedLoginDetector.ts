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
  | "unknown";

export interface ProtectedLoginDetection {
  detected: boolean;
  provider: ProtectedLoginProvider;
  reason: ProtectedLoginReason;
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
  { pattern: "authenticator app", reason: "mfa" },
  { pattern: "enter a verification code", reason: "mfa" },
  { pattern: "verify it's you", reason: "security-check" },
  { pattern: "security check", reason: "security-check" },
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
      'context ("This browser or app may not be secure."). WebFlow Studio will not bypass Google security ' +
      "protections — choose a supported handoff option (cancel, a previously saved session, OAuth in your " +
      "system browser, or a test-authenticated session for your own application)."
    );
  }
  const label = provider === "unknown" ? "A protected login / security page" : `A ${provider} protected login page`;
  return `${label} was detected (${reason}). WebFlow Studio will not bypass login protections. Choose a supported handoff option.`;
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
    return { detected: true, provider, reason, url, title, matchedPattern: patternMatch?.pattern, message: buildMessage(provider, reason) };
  }
  if (patternMatch) {
    return {
      detected: true,
      provider: "unknown",
      reason: patternMatch.reason,
      url,
      title,
      matchedPattern: patternMatch.pattern,
      message: buildMessage("unknown", patternMatch.reason)
    };
  }
  return { detected: false, provider: "unknown", reason: "unknown", url, title, message: "" };
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
