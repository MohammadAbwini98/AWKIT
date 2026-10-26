import { detectSensitiveValue } from "./sensitiveExpected";

/**
 * OCR text assertion decision policy (Phase N, N7.2 / awkit-vra.9.4). PURE: no I/O, no clock, no randomness, no page,
 * no engine. Plan: docs/plans/ai-upgrade-v5/N7-ocr-text-in-image.md, owner decisions OC-0 to OC-12 as ratified
 * (DECISIONS 2026-10-26).
 *
 * A VERDICT, NOT A STEP STATUS. `matched`, `differs` and `inconclusive` describe what the recognized words prove about
 * the author's expected text. In N7 the step is observe only (OC-5, OC-6): the runner records the verdict and never
 * fails, acts, retries or picks a locator because of it.
 *
 * FACTS ONLY. The caller supplies its own refusals (decided before any capture), the expected text with its match
 * mode, and the engine's outcome: either words with confidences (0–100) or a failure code. The decision never returns
 * text: only a code, a distance bucket, a confidence bucket and a character count.
 *
 * FAIL CLOSED, in this order:
 *   1. malformed input, a caller refusal, an invalid policy, invalid or unsupported expected text, and an expected
 *      value that looks sensitive (OC-8) are all inconclusive before the engine outcome is read;
 *   2. an engine failure or an unknown failure code is inconclusive, and so is malformed engine output;
 *   3. nothing read, or a character outside the supported English set, is inconclusive;
 *   4. comparison:
 *      - an edit distance of exactly 1 is `near-miss`, never matched;
 *      - a difference made only of look-alike glyphs (O/0, l/1/I, 5/S, rn/m, ...) is inconclusive;
 *      - `contains` with more than one region at distance 0 or 1 is `ambiguous-match`;
 *      - before a match, every word of the compared span must reach the word-confidence threshold, and every span
 *        word holding a look-alike glyph must reach the higher look-alike threshold;
 *      - a difference of two or more edits is `differs` only when every compared word reached the word threshold.
 *
 * The thresholds are UNCALIBRATED until N7.6 measures them (OC-10); a cell that misses its criteria stays observe-only.
 */

export const TEXT_ASSERTION_POLICY_VERSION = 1;
export const TEXT_ASSERTION_INPUT_VERSION = 1;
/** Longest expected text (plan, Persistence); anything longer is invalid, never truncated. */
export const TEXT_ASSERTION_MAX_EXPECTED_LENGTH = 256;
/** Bounds on engine output; more is malformed for an element-sized region. */
export const TEXT_ASSERTION_MAX_WORDS = 600;
export const TEXT_ASSERTION_MAX_WORD_LENGTH = 256;

export type TextAssertionMatchMode = "exact" | "contains" | "normalized";
export const TEXT_ASSERTION_MATCH_MODES: readonly TextAssertionMatchMode[] = ["exact", "contains", "normalized"];

export type TextAssertionVerdictKind = "matched" | "differs" | "inconclusive";

/** Refusals the caller decides before anything is captured. */
export type TextAssertionRefusal =
  | "handoff-active"
  | "protected-surface"
  | "sensitive-step"
  | "sensitive-input"
  | "target-not-found"
  | "target-not-unique"
  | "target-hidden"
  | "target-offscreen"
  | "region-too-small"
  | "region-too-large"
  | "region-clipped";

export const TEXT_ASSERTION_REFUSALS: readonly TextAssertionRefusal[] = [
  "handoff-active",
  "protected-surface",
  "sensitive-step",
  "sensitive-input",
  "target-not-found",
  "target-not-unique",
  "target-hidden",
  "target-offscreen",
  "region-too-small",
  "region-too-large",
  "region-clipped"
];

/** Engine or capture outcomes that produced no words. An unknown code is read as `ocr-unavailable`. */
export type TextAssertionOcrFailure = "capture-stale" | "capture-unavailable" | "ocr-unavailable" | "ocr-busy" | "budget-exhausted" | "cancelled" | "page-closed";

export const TEXT_ASSERTION_OCR_FAILURES: readonly TextAssertionOcrFailure[] = [
  "capture-stale",
  "capture-unavailable",
  "ocr-unavailable",
  "ocr-busy",
  "budget-exhausted",
  "cancelled",
  "page-closed"
];

export type TextAssertionCode =
  | "text-matched"
  | "text-differs"
  | "near-miss"
  | "lookalike-only-difference"
  | "ambiguous-match"
  | "low-confidence"
  | "lookalike-uncertain"
  | "no-text-read"
  | "unsupported-text"
  | "expected-invalid"
  | "ocr-output-invalid"
  | "policy-invalid"
  | "input-invalid"
  | TextAssertionRefusal
  | TextAssertionOcrFailure;

/** The closed vocabulary, each code pinned to the only verdict it may carry. */
export const TEXT_ASSERTION_CODES: Readonly<Record<TextAssertionCode, TextAssertionVerdictKind>> = {
  "text-matched": "matched",
  "text-differs": "differs",
  "near-miss": "inconclusive",
  "lookalike-only-difference": "inconclusive",
  "ambiguous-match": "inconclusive",
  "low-confidence": "inconclusive",
  "lookalike-uncertain": "inconclusive",
  "no-text-read": "inconclusive",
  "unsupported-text": "inconclusive",
  "expected-invalid": "inconclusive",
  "ocr-output-invalid": "inconclusive",
  "policy-invalid": "inconclusive",
  "input-invalid": "inconclusive",
  "handoff-active": "inconclusive",
  "protected-surface": "inconclusive",
  "sensitive-step": "inconclusive",
  "sensitive-input": "inconclusive",
  "target-not-found": "inconclusive",
  "target-not-unique": "inconclusive",
  "target-hidden": "inconclusive",
  "target-offscreen": "inconclusive",
  "region-too-small": "inconclusive",
  "region-too-large": "inconclusive",
  "region-clipped": "inconclusive",
  "capture-stale": "inconclusive",
  "capture-unavailable": "inconclusive",
  "ocr-unavailable": "inconclusive",
  "ocr-busy": "inconclusive",
  "budget-exhausted": "inconclusive",
  cancelled: "inconclusive",
  "page-closed": "inconclusive"
};

/** Edit distance of the compared span: `few-edits` is 2 up to a quarter of the expected length (at least 2). */
export type TextDistanceBucket = "exact" | "one-edit" | "few-edits" | "many-edits";
/** The lowest word confidence in the compared span. */
export type TextConfidenceBucket = "ge-95" | "90-to-95" | "80-to-90" | "below-80";

export interface TextAssertionPolicy {
  version: 1;
  /** Every word of the compared span must reach this confidence (0–100). */
  minWordConfidence: number;
  /** A span word holding a look-alike glyph must reach this higher confidence. */
  minLookalikeConfidence: number;
  calibrated: boolean;
}

/** Pre-calibration thresholds, declared before any measurement (OC-10: no tuning against the fixtures afterwards). */
export const UNCALIBRATED_TEXT_ASSERTION_POLICY: TextAssertionPolicy = Object.freeze({
  version: 1,
  minWordConfidence: 80,
  minLookalikeConfidence: 92,
  calibrated: false
});

export interface OcrWord {
  text: string;
  /** Engine confidence, 0–100. */
  confidence: number;
}

export type TextAssertionOcr = { ok: true; words: readonly OcrWord[] } | { ok: false; code: string };

export interface TextAssertionExpected {
  text: string;
  match: TextAssertionMatchMode;
  /** Default: true for `exact`, false for `contains` and `normalized`. */
  caseSensitive?: boolean;
  /** The source is an OTP or PIN context: a 4–8 digit value is then sensitive (OC-8). */
  otpOrPinContext?: boolean;
}

export interface TextAssertionInput {
  version: 1;
  expected: TextAssertionExpected;
  refusal?: TextAssertionRefusal;
  ocr?: TextAssertionOcr;
}

export interface TextAssertionDecision {
  version: 1;
  verdict: TextAssertionVerdictKind;
  code: TextAssertionCode;
  distanceBucket: TextDistanceBucket | null;
  confidenceBucket: TextConfidenceBucket | null;
  /** Length of the normalized recognized text; never the text. */
  charCount: number | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const decide = (
  code: TextAssertionCode,
  facts: { distanceBucket?: TextDistanceBucket | null; confidenceBucket?: TextConfidenceBucket | null; charCount?: number | null } = {}
): TextAssertionDecision => ({
  version: 1,
  verdict: TEXT_ASSERTION_CODES[code],
  code,
  distanceBucket: facts.distanceBucket ?? null,
  confidenceBucket: facts.confidenceBucket ?? null,
  charCount: facts.charCount ?? null
});

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
/** Printable ASCII only: the first qualification is English (OC-3). */
const SUPPORTED = /^[\x20-\x7e]*$/;

/** Typographic forms an English UI renders for ASCII punctuation. */
const TYPOGRAPHIC: ReadonlyArray<[RegExp, string]> = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐‑‒–—―−]/g, "-"]
];

function canonicalChars(text: string, mode: TextAssertionMatchMode): string {
  if (mode === "exact") return text;
  let out = text.normalize("NFKC");
  for (const [pattern, replacement] of TYPOGRAPHIC) out = out.replace(pattern, replacement);
  return out;
}

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Single glyphs an OCR engine confuses, and the multi-glyph forms (rn/m, cl/d, vv/w). */
const LOOKALIKE_CLASSES: ReadonlyArray<[string, string]> = [
  ["0Oo", "0"],
  ["1lIi|!", "1"],
  ["5Ss", "5"],
  ["8B", "8"],
  ["2Zz", "2"],
  ["6G", "6"],
  ["9gq", "9"]
];
/**
 * The same classes after case folding: a folded `b` may have been a `B` (8) and a folded `g` a `G` (6), so the folded
 * classes are the lowercase closure of the cased ones (6 and 9 merge through g).
 */
const LOOKALIKE_CLASSES_FOLDED: ReadonlyArray<[string, string]> = [
  ["0o", "0"],
  ["1li|!", "1"],
  ["5s", "5"],
  ["8b", "8"],
  ["2z", "2"],
  ["69gq", "6"]
];
const LOOKALIKE_SEQUENCES: ReadonlyArray<[string, string]> = [
  ["rn", "m"],
  ["cl", "d"],
  ["vv", "w"]
];

function lookalikeFold(text: string, caseSensitive: boolean): string {
  const classes = caseSensitive ? LOOKALIKE_CLASSES : LOOKALIKE_CLASSES_FOLDED;
  let out = text;
  for (const [sequence, replacement] of LOOKALIKE_SEQUENCES) out = out.split(sequence).join(replacement);
  return [...out].map((ch) => classes.find(([glyphs]) => glyphs.includes(ch))?.[1] ?? ch).join("");
}

function hasLookalike(word: string, caseSensitive: boolean): boolean {
  const classes = caseSensitive ? LOOKALIKE_CLASSES : LOOKALIKE_CLASSES_FOLDED;
  return [...word].some((ch) => classes.some(([glyphs]) => glyphs.includes(ch))) || LOOKALIKE_SEQUENCES.some(([sequence]) => word.includes(sequence));
}

/** Levenshtein distance when it is at most `cap`, otherwise `cap + 1` (banded, so long texts stay cheap). */
function boundedDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const big = cap + 1;
  let previous = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j <= cap ? j : big;
  for (let i = 1; i <= a.length; i += 1) {
    const current = Array.from({ length: b.length + 1 }, () => big);
    current[0] = i <= cap ? i : big;
    const from = Math.max(1, i - cap);
    const to = Math.min(b.length, i + cap);
    let rowMin = current[0];
    for (let j = from; j <= to; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost, big);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin >= big) return big;
    previous = current;
  }
  return Math.min(previous[b.length], big);
}

const fewEditsCap = (expected: string): number => Math.max(2, Math.floor(expected.length / 4));

function distanceBucketOf(distance: number, expected: string): TextDistanceBucket {
  if (distance === 0) return "exact";
  if (distance === 1) return "one-edit";
  return distance <= fewEditsCap(expected) ? "few-edits" : "many-edits";
}

function confidenceBucketOf(minimum: number): TextConfidenceBucket {
  if (minimum >= 95) return "ge-95";
  if (minimum >= 90) return "90-to-95";
  if (minimum >= 80) return "80-to-90";
  return "below-80";
}

function validPolicy(policy: unknown): policy is TextAssertionPolicy {
  if (!isRecord(policy) || policy.version !== TEXT_ASSERTION_POLICY_VERSION || typeof policy.calibrated !== "boolean") return false;
  const { minWordConfidence: word, minLookalikeConfidence: lookalike } = policy;
  return typeof word === "number" && typeof lookalike === "number" && Number.isFinite(word) && Number.isFinite(lookalike) && word >= 0 && lookalike >= word && lookalike <= 100;
}

interface Word {
  text: string;
  confidence: number;
}

/** Validated, canonical words; null when the engine output is malformed. */
function readWords(raw: unknown, mode: TextAssertionMatchMode, caseSensitive: boolean): Word[] | null {
  if (!Array.isArray(raw) || raw.length > TEXT_ASSERTION_MAX_WORDS) return null;
  const words: Word[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.text !== "string" || entry.text.length > TEXT_ASSERTION_MAX_WORD_LENGTH) return null;
    const confidence = entry.confidence;
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) return null;
    const folded = caseSensitive ? canonicalChars(entry.text, mode) : canonicalChars(entry.text, mode).toLowerCase();
    // An engine "word" holding whitespace is split; each part keeps the word's confidence.
    for (const part of collapse(folded).split(" ")) if (part) words.push({ text: part, confidence });
  }
  return words;
}

// ── Decision ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function decideTextAssertion(input: TextAssertionInput, policy: TextAssertionPolicy = UNCALIBRATED_TEXT_ASSERTION_POLICY): TextAssertionDecision {
  if (!isRecord(input) || input.version !== TEXT_ASSERTION_INPUT_VERSION) return decide("input-invalid");

  // 1. Caller refusals win over everything, including an engine result that was supplied anyway.
  if (hasOwn(input, "refusal") && input.refusal !== undefined) {
    return TEXT_ASSERTION_REFUSALS.includes(input.refusal) ? decide(input.refusal) : decide("input-invalid");
  }
  if (!validPolicy(policy)) return decide("policy-invalid");

  const expected = input.expected;
  if (!isRecord(expected) || typeof expected.text !== "string" || !TEXT_ASSERTION_MATCH_MODES.includes(expected.match)) return decide("expected-invalid");
  if (expected.caseSensitive !== undefined && typeof expected.caseSensitive !== "boolean") return decide("expected-invalid");
  if (expected.otpOrPinContext !== undefined && typeof expected.otpOrPinContext !== "boolean") return decide("expected-invalid");
  const mode = expected.match;
  const caseSensitive = expected.caseSensitive ?? mode === "exact";
  if (expected.text.length > TEXT_ASSERTION_MAX_EXPECTED_LENGTH) return decide("expected-invalid");
  const expectedChars = collapse(canonicalChars(expected.text, mode));
  if (!expectedChars) return decide("expected-invalid");
  if (!SUPPORTED.test(expectedChars)) return decide("unsupported-text");
  // OC-8: a sensitive value is never compared, whatever the engine read.
  if (detectSensitiveValue(expected.text, { otpOrPinContext: expected.otpOrPinContext === true }) !== null) return decide("sensitive-input");
  const target = caseSensitive ? expectedChars : expectedChars.toLowerCase();

  // 2. The engine outcome.
  const ocr = input.ocr;
  if (!isRecord(ocr) || typeof ocr.ok !== "boolean") return decide("input-invalid");
  if (ocr.ok === false) {
    const code = (ocr as { code?: unknown }).code;
    return decide(typeof code === "string" && (TEXT_ASSERTION_OCR_FAILURES as readonly string[]).includes(code) ? (code as TextAssertionOcrFailure) : "ocr-unavailable");
  }
  const words = readWords((ocr as { words?: unknown }).words, mode, caseSensitive);
  if (!words) return decide("ocr-output-invalid");

  // 3. Something must have been read, in the supported character set.
  const read = words.map((w) => w.text).join(" ");
  const charCount = read.length;
  if (words.length === 0) return decide("no-text-read", { charCount: 0 });
  if (!SUPPORTED.test(read)) return decide("unsupported-text", { charCount });
  const minOf = (span: readonly Word[]): number => span.reduce((min, w) => Math.min(min, w.confidence), 100);
  const allConfident = minOf(words) >= policy.minWordConfidence;

  // 4. Comparison.
  const cap = fewEditsCap(target) + 1;
  const gate = (span: readonly Word[], distance: number): TextAssertionDecision => {
    const facts = { distanceBucket: distanceBucketOf(distance, target), confidenceBucket: confidenceBucketOf(minOf(span)), charCount };
    if (minOf(span) < policy.minWordConfidence) return decide("low-confidence", facts);
    if (span.some((w) => hasLookalike(w.text, caseSensitive) && w.confidence < policy.minLookalikeConfidence)) return decide("lookalike-uncertain", facts);
    return decide("text-matched", facts);
  };

  if (mode !== "contains") {
    const distance = boundedDistance(target, read, cap);
    const facts = { distanceBucket: distanceBucketOf(distance, target), confidenceBucket: confidenceBucketOf(minOf(words)), charCount };
    if (distance === 0) return gate(words, 0);
    if (distance === 1) return decide("near-miss", facts);
    if (lookalikeFold(target, caseSensitive) === lookalikeFold(read, caseSensitive)) return decide("lookalike-only-difference", facts);
    return decide(allConfident ? "text-differs" : "low-confidence", facts);
  }

  // `contains`: whole-word windows of the expected word count, one fewer and one more.
  const n = target.split(" ").length;
  const windows: Array<{ start: number; end: number; distance: number; folded: boolean }> = [];
  for (const k of [n - 1, n, n + 1]) {
    if (k < 1) continue;
    for (let start = 0; start + k <= words.length; start += 1) {
      const text = words
        .slice(start, start + k)
        .map((w) => w.text)
        .join(" ");
      windows.push({ start, end: start + k, distance: boundedDistance(target, text, cap), folded: lookalikeFold(text, caseSensitive) === lookalikeFold(target, caseSensitive) });
    }
  }
  const exact = windows.filter((w) => w.distance === 0);
  const best = windows.reduce((min, w) => Math.min(min, w.distance), cap + 1);
  const overallFacts = { distanceBucket: distanceBucketOf(best, target), confidenceBucket: confidenceBucketOf(minOf(words)), charCount };
  if (exact.length > 1) return decide("ambiguous-match", overallFacts);
  if (exact.length === 1) {
    const hit = exact[0];
    // Another region within one edit, outside the hit, could be the real text misread: ambiguous.
    const rival = windows.some((w) => w.distance <= 1 && (w.end <= hit.start || w.start >= hit.end));
    if (rival) return decide("ambiguous-match", overallFacts);
    return gate(words.slice(hit.start, hit.end), 0);
  }
  if (best === 1) return decide("near-miss", overallFacts);
  if (windows.some((w) => w.folded)) return decide("lookalike-only-difference", overallFacts);
  return decide(allConfident ? "text-differs" : "low-confidence", overallFacts);
}
