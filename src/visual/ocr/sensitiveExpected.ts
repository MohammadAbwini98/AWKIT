/**
 * OC-8 sensitive-source and sensitive-value rules for OCR text assertions (Phase N, N7.2 / awkit-vra.9.4). PURE: no
 * I/O, no clock, no randomness, no page.
 *
 * An OCR comparison against a secret is an oracle: it reveals whether the secret is on screen. The expected text is
 * therefore refused when its SOURCE is sensitive (a secret reference, or a runtime input or data-source field whose
 * name or label names a credential, OTP, PIN, card, SSN, IBAN, account number, token or secret) or when its RESOLVED
 * VALUE looks sensitive (a Luhn-valid card number, a valid IBAN, an SSN pattern, or a 4–8 digit code in an OTP or PIN
 * context). The validator applies the name rule at design time; the runtime applies the value rule before any capture.
 * Neither returns or logs the value: only a code.
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
