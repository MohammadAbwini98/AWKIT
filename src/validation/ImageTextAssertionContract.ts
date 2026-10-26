import type { FlowStep } from "../profiles/FlowProfile";
import {
  OCR_DEFAULT_MATCH,
  OCR_EXPECTED_MAX_LENGTH,
  OCR_MATCH_MODES,
  ocrExpectedTextProblem,
  ocrSourceRefusal,
  type OcrMatchMode,
  type OcrSourceRefusal
} from "../ocr/ocrExpectedText";

/**
 * The authoring contract of an `assertImageText` step (Phase N, N7.5 / awkit-vra.9.6). One definition, read by the
 * flow validator (authoring, import and pre-run), by the step executor before anything is resolved or captured, and by
 * the Designer's Image text section, so a configuration is refused the same way everywhere. Never imports
 * `src/visual`.
 *
 * Refused deterministically, never guessed or passed to another assertion:
 *  - a mode other than `observe` (N7 has no enforcing OCR assertion, OC-11);
 *  - an unknown match mode or a non-boolean case-sensitivity flag;
 *  - a literal expected text that is blank, longer than 256 characters or outside the supported English set;
 *  - any OC-8 refusal of the expectation's source or literal value.
 */

export type ImageTextProblemCode = "mode" | "match" | "case-sensitive" | "expected-empty" | "expected-too-long" | "expected-unsupported" | "sensitive" | "unverified-source";

export interface ImageTextProblem {
  code: ImageTextProblemCode;
  /** Completes "Step <name> (assertImageText) …". Never quotes the expected text. */
  message: string;
}

/** The step's match mode, or null when it names an unknown one. Absent = `normalized`. */
export function imageTextMatch(step: Pick<FlowStep, "config">): OcrMatchMode | null {
  const match = step.config?.ocrMatch;
  if (match === undefined) return OCR_DEFAULT_MATCH;
  return (OCR_MATCH_MODES as readonly string[]).includes(match) ? match : null;
}

/** The literal expected text the step carries, when it is not bound to a non-static source. */
export function imageTextLiteral(step: Pick<FlowStep, "value" | "valueSource">): string | undefined {
  if (step.valueSource === undefined) return typeof step.value === "string" ? step.value : undefined;
  return step.valueSource?.type === "static" ? step.valueSource.value ?? "" : undefined;
}

const SENSITIVE_MESSAGES: Record<OcrSourceRefusal, string> = {
  "secret-reference": "is bound to a secret",
  "card-number": "expects what looks like a card number",
  iban: "expects what looks like an IBAN",
  ssn: "expects what looks like a social security number",
  "otp-or-pin": "expects a short numeric code in a one-time-code or PIN context",
  "sensitive-source": "reads its expected text from a field whose name marks it sensitive (password, one-time code, PIN, card, IBAN, account number, token or secret)",
  "unverified-source": "reads its expected text from a source whose sensitivity cannot be verified (an environment variable or an unknown source)"
};

export function imageTextAssertionProblems(step: FlowStep): ImageTextProblem[] {
  const problems: ImageTextProblem[] = [];
  if (step.mode !== undefined && step.mode !== "observe") {
    problems.push({ code: "mode", message: `has mode "${String(step.mode)}"; image text assertions are observe only in this release, so use observe` });
  }
  const match = imageTextMatch(step);
  if (match === null) problems.push({ code: "match", message: `has an unknown match mode "${String(step.config?.ocrMatch)}"; use exact, contains or normalized` });
  if (step.config?.ocrCaseSensitive !== undefined && typeof step.config.ocrCaseSensitive !== "boolean") {
    problems.push({ code: "case-sensitive", message: "has a case-sensitivity setting that is not true or false" });
  }
  const literal = imageTextLiteral(step);
  // A missing value is the generic missingRequiredValue rule's to report; only a present literal is judged here.
  if (literal !== undefined && literal !== "") {
    const problem = ocrExpectedTextProblem(literal, match ?? OCR_DEFAULT_MATCH);
    if (problem === "too-long") problems.push({ code: "expected-too-long", message: `has an expected text longer than ${OCR_EXPECTED_MAX_LENGTH} characters` });
    else if (problem === "empty") problems.push({ code: "expected-empty", message: "has an expected text that is only whitespace" });
    else if (problem === "unsupported-characters") problems.push({ code: "expected-unsupported", message: "has an expected text with characters outside the supported English set" });
  }
  const refusal = ocrSourceRefusal(step);
  if (refusal) {
    problems.push({
      code: refusal === "unverified-source" ? "unverified-source" : "sensitive",
      message: `${SENSITIVE_MESSAGES[refusal]}; reading it from the screen would reveal whether that value is shown, so OCR refuses it (OC-8)`
    });
  }
  return problems;
}
