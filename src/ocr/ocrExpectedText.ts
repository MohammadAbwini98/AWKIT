import type { ValueSource } from "../profiles/FlowProfile";

/**
 * The expected-text rules of OCR text assertions (Phase N): the OC-8 sensitive-source and sensitive-value rules
 * (N7.2 / awkit-vra.9.4) and the N7.5 (awkit-vra.9.6) static checks the validator, the step executor and the Designer
 * share. PURE: no I/O, no clock, no randomness, no page.
 *
 * Outside `src/visual` on purpose: the validator and the step executor (execution tree) and the Designer (renderer) must
 * apply the same rules without reaching Visual Intelligence (`verify:visual-isolation`). `src/visual/ocr/
 * sensitiveExpected.ts` re-exports the OC-8 functions for the pure N7.2 decision, so there is one implementation.
 *
 * OC-8. An OCR comparison against a secret is an oracle: it reveals whether the secret is on screen. The expected text is
 * therefore refused when its SOURCE is sensitive (a secret reference, or a runtime input or data-source field whose name
 * or label names a credential, OTP, PIN, card, SSN, IBAN, account number, token or secret) or when its RESOLVED VALUE
 * looks sensitive (a Luhn-valid card number, a valid IBAN, an SSN pattern, or a 4–8 digit code in an OTP or PIN
 * context). A source whose sensitivity cannot be verified (an environment variable, an unknown source type) is refused
 * too. Nothing here returns or logs a value: only a code.
 */

export type SensitiveValueCode = "secret-reference" | "card-number" | "iban" | "ssn" | "otp-or-pin";

/** Word-split, as the N6.8 container rule does, so cardNumber, card_cvv, pinCode and cvv2 match like their words. */
function words(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z]+/g, " ")
    .toLowerCase();
}

const SENSITIVE_NAME =
  /otp|one ?time|passcode|pass ?word|\bpwd\b|\bpin\b|\bcvv\b|\bcvc\b|\bcsc\b|card ?number|credit ?card|security ?code|\bssn\b|social ?security|\biban\b|account ?(?:number|no)\b|\bsecret\b|\btoken\b/;

/** True when a runtime-input or data-source field name or label names a sensitive value (OC-8, the N6.8 word rule). */
export function isSensitiveSourceName(name: unknown): boolean {
  if (typeof name !== "string") return true;
  return SENSITIVE_NAME.test(words(name));
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function ibanValid(candidate: string): boolean {
  const iban = candidate.replace(/ /g, "").toUpperCase();
  if (iban.length < 15 || iban.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/**
 * The first sensitive-value code the text matches, or null. A non-string is sensitive (fail closed). Only maximal
 * digit runs of 13–19 digits (spaces or dashes allowed between digits) are tested for Luhn, so an ordinary long
 * reference number is not refused by an accidental Luhn-valid sub-window.
 */
export function detectSensitiveValue(value: unknown, context: { otpOrPinContext?: boolean } = {}): SensitiveValueCode | null {
  if (typeof value !== "string") return "secret-reference";
  if (/\$\{\s*secret\./i.test(value)) return "secret-reference";
  for (const match of value.matchAll(/\d(?:[ -]?\d)*/g)) {
    const digits = match[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return "card-number";
  }
  for (const match of value.matchAll(/\b[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]){11,30}\b/g)) {
    if (ibanValid(match[0])) return "iban";
  }
  if (/(?:^|[^\d-])\d{3}-\d{2}-\d{4}(?![\d-])/.test(value)) return "ssn";
  if (context.otpOrPinContext === true && /(?:^|\D)\d{4,8}(?!\d)/.test(value)) return "otp-or-pin";
  return null;
}

// ── N7.5: the authored assertion ───────────────────────────────────────────────────────────────────────────────────

export type OcrMatchMode = "exact" | "contains" | "normalized";
export const OCR_MATCH_MODES: readonly OcrMatchMode[] = ["exact", "contains", "normalized"];
/** The match mode of a step that names none. */
export const OCR_DEFAULT_MATCH: OcrMatchMode = "normalized";
/** The longest expected text (plan, Persistence; the N7.2 decision's own limit). */
export const OCR_EXPECTED_MAX_LENGTH = 256;

/**
 * An OTP or PIN context, read from the step's own name and description: a 4–8 digit expected value is then sensitive
 * (OC-8). Errs towards a context, never away from one.
 */
export function ocrOtpOrPinContext(step: { name?: unknown; description?: unknown }): boolean {
  const text = words(`${typeof step.name === "string" ? step.name : ""} ${typeof step.description === "string" ? step.description : ""}`);
  return /otp|one ?time|passcode|\bpin\b|verification ?code|security ?code|auth(?:entication)? ?code|\b2fa\b|\bmfa\b/.test(text);
}

/** Typographic forms an English UI renders for ASCII punctuation (the N7.2 decision's own table). */
const TYPOGRAPHIC: ReadonlyArray<[RegExp, string]> = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐‑‒–—―−]/g, "-"]
];

export type OcrExpectedTextProblem = "empty" | "too-long" | "unsupported-characters";

/**
 * Whether an expected text can be compared at all, by the same rules as the N7.2 decision (which re-checks at run time
 * and answers inconclusive): at most 256 characters, not blank, and printable English characters after the mode's
 * canonical form (NFKC and typographic punctuation, except in `exact` mode).
 */
export function ocrExpectedTextProblem(text: unknown, match: OcrMatchMode = OCR_DEFAULT_MATCH): OcrExpectedTextProblem | null {
  if (typeof text !== "string") return "empty";
  if (text.length > OCR_EXPECTED_MAX_LENGTH) return "too-long";
  let canonical = text;
  if (match !== "exact") {
    canonical = canonical.normalize("NFKC");
    for (const [pattern, replacement] of TYPOGRAPHIC) canonical = canonical.replace(pattern, replacement);
  }
  canonical = canonical.replace(/\s+/g, " ").trim();
  if (!canonical) return "empty";
  return /^[\x20-\x7e]*$/.test(canonical) ? null : "unsupported-characters";
}

export type OcrSourceRefusal = SensitiveValueCode | "sensitive-source" | "unverified-source";

/** The names a value source is read through, each checked by the OC-8 word rule. */
function sourceNames(source: ValueSource): string[] {
  return [source.key, source.keyName, source.path, source.file, source.outputKey, source.dataSourceId, source.secretName].filter(
    (name): name is string => typeof name === "string" && name.length > 0
  );
}

/**
 * The OC-8 refusal of an authored expectation, decided WITHOUT resolving it, so a secret is never read to find out:
 *  - a `secret` source, and an `env` or unknown source (sensitivity unverifiable), are refused;
 *  - any source whose key, field, path, file, output or data-source name is a sensitive name is refused;
 *  - a static literal (or a static source's value) is refused when it looks sensitive.
 * The resolved value is checked again at run time (`detectSensitiveValue`), where a binding first becomes text.
 */
export function ocrSourceRefusal(step: { value?: unknown; valueSource?: ValueSource; name?: unknown; description?: unknown }): OcrSourceRefusal | null {
  const otpOrPinContext = ocrOtpOrPinContext(step);
  const source = step.valueSource;
  if (source !== undefined) {
    if (!source || typeof source !== "object") return "unverified-source";
    switch (source.type) {
      case "secret":
        return "secret-reference";
      case "env":
        return "unverified-source";
      case "static":
        return detectSensitiveValue(source.value ?? "", { otpOrPinContext });
      case "dynamic":
      case "json":
      case "runtimeInput":
      case "instanceVariable":
      case "flowOutput":
      case "currentRow":
        return sourceNames(source).some(isSensitiveSourceName) ? "sensitive-source" : null;
      case "generated":
        return null;
      default:
        return "unverified-source";
    }
  }
  return detectSensitiveValue(typeof step.value === "string" ? step.value : "", { otpOrPinContext });
}
