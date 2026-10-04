import { PROTECTED_TEXT_PATTERNS, type ProtectedLoginReason } from "@src/security/ProtectedLoginDetector";

/**
 * L12.17 (owner decision 2026-10-04): the protected surfaces a Super User may diagnose with the parser-only
 * DOM intelligence, for locator help. Pure, so the IPC, the diagnosis and the verifier share one list.
 *
 * Allowed: an ordinary sign-in form, an MFA or one-time-code step, a passkey prompt, single sign-on, and a
 * known identity provider's sign-in page. Refused for every role, always: a CAPTCHA, a security check, a
 * browser the site blocked as automated, a digital signature, an external approval, and anything the
 * detector could not name. Reading those would be a step toward getting past a control meant to stop
 * automation, which AWKIT never does.
 *
 * What the override changes is only that the document may be read at all. Password, one-time-code and
 * hidden inputs are still dropped from the snapshot, and no input value is ever serialized.
 */
export const PROTECTED_DIAGNOSIS_REASONS: ReadonlySet<ProtectedLoginReason> = new Set<ProtectedLoginReason>(["login-form", "mfa", "passkey", "sso", "known-provider"]);

export function protectedDiagnosisAllowed(reason: ProtectedLoginReason | undefined): boolean {
  return reason !== undefined && PROTECTED_DIAGNOSIS_REASONS.has(reason);
}

/**
 * A second, independent CAPTCHA check: the common challenge widgets by their own markers. A page carrying one
 * is never read under the override, even when the detector named something else or only warned.
 */
export const CAPTCHA_MARKER_SELECTOR =
  'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],iframe[src*="arkoselabs"],.g-recaptcha,.h-captcha,.cf-turnstile,[data-sitekey],[data-hcaptcha-widget-id]';

/**
 * L12.21: the detector's wording for every refused reason (captcha, security check, blocked automation,
 * signature, approval). A detection reports only its first match, and a password field outranks a "verify it's
 * you" heading, so the serializer checks the captured document for ALL of these at the moment it is read.
 */
export const REFUSED_TEXT_PATTERNS: readonly string[] = Object.freeze(
  PROTECTED_TEXT_PATTERNS.filter((entry) => !protectedDiagnosisAllowed(entry.reason)).map((entry) => entry.pattern)
);
