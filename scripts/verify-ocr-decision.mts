/**
 * verify:ocr-decision — Phase N, N7.2 (awkit-vra.9.4): the pure OCR text assertion decision `decideTextAssertion`, the
 * pure preprocessing `preprocessForOcr`, and the OC-8 sensitive-source and sensitive-value rules.
 *
 * No browser, no engine, no files beyond reading the policies' own sources. Engine outputs are synthetic word lists
 * with confidences, which is exactly the decision's input contract, so every case is a genuine fact pattern.
 *
 * One suite covers:
 *   - a decision table: exact, normalized and contains modes; case, whitespace and typographic forms; one-edit near
 *     misses; look-alike-only differences; contains ambiguity, rival regions and word boundaries; both confidence gates
 *     and their boundaries; every caller refusal (with a matching read supplied, so a refusal can never become a
 *     match); every engine failure and an unknown one; malformed engine output, expected text, policy and input;
 *     OC-8 sensitive expected values; buckets;
 *   - shape invariants on every decision: exactly six fields, a vocabulary code, the only verdict that code may carry,
 *     and never the expected or recognized text;
 *   - a seeded property run: one-edit, look-alike, duplicate, low-confidence and refused reads never match; copies
 *     match; disjoint reads differ; determinism and no input mutation;
 *   - preprocessing: grayscale over white, the x-height scale rule, size and clipping refusals, no downscale,
 *     determinism and no input mutation;
 *   - OC-8 rules: card (Luhn), IBAN (mod 97), SSN, OTP/PIN context, secret references, word-split names;
 *   - pins and purity: the index exports the API; the three sources import only siblings (types from ../png), use no
 *     I/O, clock, randomness or engine, and nothing that captures or acts.
 *
 * The same suites are then run against mutants, each of which must make them FAIL.
 *
 * Run: npm run verify:ocr-decision
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TEXT_ASSERTION_CODES,
  TEXT_ASSERTION_MAX_EXPECTED_LENGTH,
  TEXT_ASSERTION_MAX_WORDS,
  TEXT_ASSERTION_OCR_FAILURES,
  TEXT_ASSERTION_REFUSALS,
  UNCALIBRATED_TEXT_ASSERTION_POLICY,
  decideTextAssertion,
  type OcrWord,
  type TextAssertionCode,
  type TextAssertionDecision,
  type TextAssertionInput,
  type TextAssertionMatchMode,
  type TextAssertionOcr,
  type TextAssertionPolicy
} from "@src/visual/ocr/decideTextAssertion";
import { OCR_MAX_OUTPUT_PIXELS, OCR_MIN_X_HEIGHT_PX, grayscaleOverWhite, ocrScaleFor, preprocessForOcr, type OcrPreprocessInput, type OcrPreprocessResult } from "@src/visual/ocr/preprocess";
import { detectSensitiveValue, isSensitiveSourceName, type SensitiveValueCode } from "@src/visual/ocr/sensitiveExpected";
import { VisualImage } from "@src/visual/png";
import * as visualIndex from "@src/visual";

/** Hardcoded floors. Raising the counts is fine; dropping below these fails the suite. */
const TABLE_FLOOR = 80;
const PROPERTY_RUNS = 5000;
const MIN_MATCHED = 300;
const MIN_DIFFERS = 300;
const MIN_INCONCLUSIVE = 1000;

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

type Decider = (input: TextAssertionInput, policy?: TextAssertionPolicy) => TextAssertionDecision;
interface Outcome {
  label: string;
  ok: boolean;
  detail?: string;
}
interface Case {
  name: string;
  input: TextAssertionInput;
  code: TextAssertionCode;
  policy?: TextAssertionPolicy;
  /** Extra expectations on the decision's facts. */
  facts?: Partial<Pick<TextAssertionDecision, "distanceBucket" | "confidenceBucket" | "charCount">>;
}

// ── Builders ────────────────────────────────────────────────────────────────────────────────────────────────────────

const w = (text: string, confidence = 97): OcrWord => ({ text, confidence });
const read = (text: string, confidence = 97): TextAssertionOcr => ({ ok: true, words: text.split(" ").map((t) => w(t, confidence)) });
const readWords = (...words: OcrWord[]): TextAssertionOcr => ({ ok: true, words });
const ask = (text: string, match: TextAssertionMatchMode, ocr: TextAssertionOcr | undefined, extra: Partial<TextAssertionInput["expected"]> = {}): TextAssertionInput => ({
  version: 1,
  expected: { text, match, ...extra },
  ...(ocr ? { ocr } : {})
});
const asInput = (value: unknown): TextAssertionInput => value as TextAssertionInput;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function buildCases(): Case[] {
  const cases: Case[] = [];
  const add = (name: string, input: TextAssertionInput, code: TextAssertionCode, more: Partial<Case> = {}): void => {
    cases.push({ name, input, code, ...more });
  };

  // exact
  add("exact identical", ask("Total Due", "exact", read("Total Due")), "text-matched", { facts: { distanceBucket: "exact", confidenceBucket: "ge-95", charCount: 9 } });
  add("exact is case-sensitive by default", ask("Total Due", "exact", read("TOTAL DUE")), "text-differs");
  add("exact case-insensitive when asked", ask("Total Due", "exact", read("TOTAL DUE"), { caseSensitive: false }), "text-matched");
  add("exact collapses whitespace", ask("  Total   Due ", "exact", read("Total Due")), "text-matched");
  add("exact one substitution", ask("Total Due", "exact", read("Total Dua")), "near-miss", { facts: { distanceBucket: "one-edit" } });
  add("exact one insertion", ask("Total Due", "exact", read("Total Duee")), "near-miss");
  add("exact one deletion", ask("Total Due", "exact", read("Total De")), "near-miss");
  add("exact look-alike-only difference", ask("INV-0042", "exact", read("INV-OO42")), "lookalike-only-difference");
  add("exact two edits differ", ask("Total Due", "exact", read("Total Dxx")), "text-differs", { facts: { distanceBucket: "few-edits" } });
  add("exact many edits differ", ask("Total Due", "exact", read("Shipping address")), "text-differs", { facts: { distanceBucket: "many-edits" } });
  add("exact differs with a low-confidence word", ask("Total Due", "exact", readWords(w("Shipping"), w("address", 70))), "low-confidence");
  add("exact match, look-alike word at 85", ask("Total", "exact", read("Total", 85)), "lookalike-uncertain", { facts: { confidenceBucket: "80-to-90" } });
  add("exact match, no look-alike glyph at 85", ask("WAVE", "exact", read("WAVE", 85)), "text-matched");
  add("exact match with min confidence 79", ask("WAVE", "exact", read("WAVE", 79)), "low-confidence", { facts: { confidenceBucket: "below-80" } });
  add("exact match at the word threshold 80", ask("WAVE", "exact", read("WAVE", 80)), "text-matched");
  add("exact look-alike word at the higher threshold 92", ask("Total", "exact", read("Total", 92)), "text-matched", { facts: { confidenceBucket: "90-to-95" } });
  add("exact look-alike word just below 92", ask("Total", "exact", read("Total", 91.9)), "lookalike-uncertain");
  add("exact uppercase WARN holds no look-alike glyph", ask("WARN", "exact", read("WARN", 85)), "text-matched");
  add("exact lowercase rn is a look-alike sequence", ask("turn", "exact", read("turn", 85)), "lookalike-uncertain");
  add("nothing read", ask("Total", "exact", readWords()), "no-text-read", { facts: { charCount: 0 } });
  add("only whitespace read", ask("Total", "exact", readWords(w("   "))), "no-text-read");
  add("unsupported recognized character", ask("Total Due", "exact", read("Total Dué")), "unsupported-text");
  add("unsupported expected character", ask("Grüße", "normalized", read("Grusse")), "unsupported-text");
  add("expected empty", ask("", "exact", read("Total")), "expected-invalid");
  add("expected whitespace only", ask("   ", "exact", read("Total")), "expected-invalid");
  add("expected over the length limit", ask("a".repeat(TEXT_ASSERTION_MAX_EXPECTED_LENGTH + 1), "exact", read("a")), "expected-invalid");
  add("expected at the length limit", ask("a".repeat(TEXT_ASSERTION_MAX_EXPECTED_LENGTH), "exact", read("a".repeat(TEXT_ASSERTION_MAX_EXPECTED_LENGTH))), "text-matched");
  add("unknown match mode", asInput({ version: 1, expected: { text: "Total", match: "fuzzy" }, ocr: read("Total") }), "expected-invalid");
  add("caseSensitive not boolean", asInput({ version: 1, expected: { text: "Total", match: "exact", caseSensitive: "yes" }, ocr: read("Total") }), "expected-invalid");
  add("otpOrPinContext not boolean", asInput({ version: 1, expected: { text: "Total", match: "exact", otpOrPinContext: 1 }, ocr: read("Total") }), "expected-invalid");
  add("expected not an object", asInput({ version: 1, expected: "Total", ocr: read("Total") }), "expected-invalid");

  // normalized
  add("normalized typographic forms", ask("Can't wait - 2026", "normalized", readWords(w("Can’t"), w("wait"), w("–"), w("2026"))), "text-matched");
  add("normalized is case-insensitive by default", ask("total due", "normalized", read("TOTAL DUE")), "text-matched");
  add("normalized case-sensitive when asked", ask("Total", "normalized", read("TOTAL"), { caseSensitive: true }), "text-differs");
  add("normalized NFKC ligature", ask("final", "normalized", read("ﬁnal")), "text-matched");
  add("normalized NFKC full-width digits", ask("Room 1234", "normalized", read("Room １２３４")), "text-matched");
  add("normalized near miss", ask("Order shipped", "normalized", read("Order shippad")), "near-miss");
  add("normalized look-alike after case folding (B/8)", ask("REF-8B", "normalized", read("REF-B8")), "lookalike-only-difference");
  add("normalized folded b needs the look-alike threshold", ask("BATCH", "normalized", read("BATCH", 85)), "lookalike-uncertain");

  // contains
  add("contains one whole-word occurrence", ask("Total", "contains", read("Subtotal 10 Total 12")), "text-matched");
  add("contains duplicate", ask("Total", "contains", read("Total 10 Total 12")), "ambiguous-match");
  add("contains rival region one edit away", ask("Order 4471", "contains", read("Order 4471 Order 4474")), "ambiguous-match");
  add("contains absent but one edit away", ask("Order 4471", "contains", read("Your Order 4472 shipped")), "near-miss");
  add("contains absent", ask("Refund", "contains", read("Order shipped today")), "text-differs");
  add("contains absent with a low-confidence word", ask("Refund", "contains", readWords(w("Order"), w("shipped", 60), w("today"))), "low-confidence");
  add("contains look-alike-only difference", ask("INV-0042", "contains", read("Ref INV-OO42 paid")), "lookalike-only-difference");
  add("contains word boundary (Subtotal)", ask("Total", "contains", read("Subtotal 10")), "text-differs");
  add("contains multi-word phrase", ask("Order shipped", "contains", read("Your Order shipped today")), "text-matched");
  add("contains span word below the threshold", ask("Order shipped", "contains", readWords(w("Your"), w("Order"), w("shipped", 70), w("today"))), "low-confidence");
  add("contains low confidence outside the span", ask("Order shipped", "contains", readWords(w("Your", 40), w("Order"), w("shipped"), w("today", 50))), "text-matched");
  add("contains span look-alike word at 85", ask("Total", "contains", readWords(w("Pay"), w("Total", 85))), "lookalike-uncertain");
  add("contains case-sensitive when asked", ask("Total", "contains", read("TOTAL due"), { caseSensitive: true }), "text-differs");

  // refusals, each with a matching read supplied
  for (const refusal of TEXT_ASSERTION_REFUSALS) add(`refusal ${refusal}`, { ...ask("Total", "exact", read("Total")), refusal }, refusal);
  add("unknown refusal", asInput({ ...ask("Total", "exact", read("Total")), refusal: "because" }), "input-invalid");

  // engine outcomes
  for (const code of TEXT_ASSERTION_OCR_FAILURES) add(`engine failure ${code}`, ask("Total", "exact", { ok: false, code }), code);
  add("unknown engine failure code", ask("Total", "exact", { ok: false, code: "gpu-melted" }), "ocr-unavailable");
  add("engine outcome missing", ask("Total", "exact", undefined), "input-invalid");
  add("engine words not an array", asInput({ version: 1, expected: { text: "Total", match: "exact" }, ocr: { ok: true, words: "Total" } }), "ocr-output-invalid");
  add("engine confidence NaN", ask("Total", "exact", readWords(w("Total", Number.NaN))), "ocr-output-invalid");
  add("engine confidence above 100", ask("Total", "exact", readWords(w("Total", 101))), "ocr-output-invalid");
  add("engine confidence negative", ask("Total", "exact", readWords(w("Total", -1))), "ocr-output-invalid");
  add("engine word text not a string", asInput({ version: 1, expected: { text: "Total", match: "exact" }, ocr: { ok: true, words: [{ text: 7, confidence: 99 }] } }), "ocr-output-invalid");
  add("engine output over the word limit", ask("Total", "exact", { ok: true, words: Array.from({ length: TEXT_ASSERTION_MAX_WORDS + 1 }, () => w("x")) }), "ocr-output-invalid");
  add("engine word over the length limit", ask("Total", "exact", readWords(w("x".repeat(257)))), "ocr-output-invalid");

  // OC-8 sensitive expected values, each with a matching read supplied
  add("sensitive card number", ask("4111 1111 1111 1111", "exact", read("4111 1111 1111 1111")), "sensitive-input");
  add("sensitive secret reference", ask("${secret.apiKey}", "exact", read("${secret.apiKey}")), "sensitive-input");
  add("sensitive IBAN", ask("GB82 WEST 1234 5698 7654 32", "exact", read("GB82 WEST 1234 5698 7654 32")), "sensitive-input");
  add("sensitive SSN", ask("123-45-6789", "exact", read("123-45-6789")), "sensitive-input");
  add("sensitive code in an OTP context", ask("482913", "exact", read("482913"), { otpOrPinContext: true }), "sensitive-input");
  add("the same digits outside an OTP context", ask("482913", "exact", read("482913")), "text-matched");
  add("a Luhn-invalid 16-digit number is not a card", ask("4111 1111 1111 1112", "exact", read("4111 1111 1111 1112")), "text-matched");

  // malformed input and policy
  add("null input", asInput(null), "input-invalid");
  add("array input", asInput([]), "input-invalid");
  add("unsupported input version", asInput({ ...ask("Total", "exact", read("Total")), version: 2 }), "input-invalid");
  add("policy with look-alike below word threshold", ask("Total", "exact", read("Total")), "policy-invalid", { policy: { version: 1, minWordConfidence: 90, minLookalikeConfidence: 80, calibrated: true } });
  add("policy with an unknown version", ask("Total", "exact", read("Total")), "policy-invalid", { policy: asPolicy({ version: 2, minWordConfidence: 80, minLookalikeConfidence: 92, calibrated: false }) });
  add("policy above 100", ask("Total", "exact", read("Total")), "policy-invalid", { policy: { version: 1, minWordConfidence: 80, minLookalikeConfidence: 101, calibrated: false } });
  add("a stricter policy rejects 94", ask("WAVE", "exact", read("WAVE", 94)), "low-confidence", { policy: { version: 1, minWordConfidence: 95, minLookalikeConfidence: 97, calibrated: true } });
  add("a stricter policy accepts 97", ask("WAVE", "exact", read("WAVE", 97)), "text-matched", { policy: { version: 1, minWordConfidence: 95, minLookalikeConfidence: 97, calibrated: true } });
  return cases;
}

function asPolicy(value: unknown): TextAssertionPolicy {
  return value as TextAssertionPolicy;
}

// ── Invariants ──────────────────────────────────────────────────────────────────────────────────────────────────────

const FIELDS = ["charCount", "code", "confidenceBucket", "distanceBucket", "verdict", "version"].join(",");
const DISTANCE = new Set(["exact", "one-edit", "few-edits", "many-edits", null]);
const CONFIDENCE = new Set(["ge-95", "90-to-95", "80-to-90", "below-80", null]);

/** Six known fields with closed types: a decision has no slot through which text could leave. */
function shapeProblem(decision: unknown): string | null {
  if (!decision || typeof decision !== "object") return "not an object";
  const d = decision as Record<string, unknown>;
  if (Object.keys(d).sort().join(",") !== FIELDS) return `fields ${Object.keys(d).sort().join(",")}`;
  if (d.version !== 1) return "version";
  if (!Object.prototype.hasOwnProperty.call(TEXT_ASSERTION_CODES, d.code as string)) return `unknown code ${String(d.code)}`;
  if (d.verdict !== TEXT_ASSERTION_CODES[d.code as TextAssertionCode]) return `verdict ${String(d.verdict)} for ${String(d.code)}`;
  if (!DISTANCE.has(d.distanceBucket as string | null)) return "distance bucket";
  if (!CONFIDENCE.has(d.confidenceBucket as string | null)) return "confidence bucket";
  if (d.charCount !== null && (!Number.isInteger(d.charCount) || (d.charCount as number) < 0)) return "charCount";
  return null;
}

// ── Property run ────────────────────────────────────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Letters outside every look-alike class, so copies and disjoint reads are what they claim to be. */
const PLAIN = "acehkmntuvwxyAEHKMNTUVWXY";
const DISJOINT = "dfjpDFJPR";
const LOOKALIKE_SWAP: Record<string, string> = { "0": "O", "1": "l", "5": "S", "8": "B" };

interface PropertyTally {
  matched: number;
  differs: number;
  inconclusive: number;
}

function propertyOutcomes(decider: Decider, runs: number): Outcome[] {
  const random = mulberry32(0x0c7a2026);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const word = (alphabet: string, min = 2, max = 7): string => Array.from({ length: min + Math.floor(random() * (max - min + 1)) }, () => pick([...alphabet])).join("");
  const conf = (): number => 93 + Math.floor(random() * 8);
  const violations = new Map<string, string>();
  const note = (label: string, detail: string): void => {
    if (!violations.has(label)) violations.set(label, detail);
  };
  const tally: PropertyTally = { matched: 0, differs: 0, inconclusive: 0 };
  const LABELS = [
    "[property] copies match",
    "[property] disjoint reads differ",
    "[property] one-edit reads never match",
    "[property] look-alike reads never match",
    "[property] duplicates never match",
    "[property] low confidence never matches",
    "[property] a refusal always wins",
    "[property] deterministic",
    "[property] input not mutated",
    "[property] shape"
  ];

  for (let run = 0; run < runs; run += 1) {
    const mode = pick<TextAssertionMatchMode>(["exact", "normalized", "contains"]);
    const kind = pick(["copy", "different", "one-edit", "lookalike", "duplicate", "lowconf", "refusal"]);
    const expectedWords = Array.from({ length: 1 + Math.floor(random() * 3) }, () => word(PLAIN));
    let expectedText = expectedWords.join(" ");
    let words: OcrWord[] = expectedWords.map((t) => w(t, conf()));
    let refusal: (typeof TEXT_ASSERTION_REFUSALS)[number] | undefined;
    if (kind === "different") words = Array.from({ length: 1 + Math.floor(random() * 3) }, () => w(word(DISJOINT), conf()));
    if (kind === "one-edit") {
      const index = Math.floor(random() * words.length);
      const chars = [...words[index].text];
      const at = Math.floor(random() * chars.length);
      const op = pick(["substitute", "insert", "delete"]);
      const replacement = pick([..."bdfgjpqrs"].filter((c) => c !== chars[at].toLowerCase()));
      if (op === "substitute") chars[at] = replacement;
      else if (op === "insert") chars.splice(at, 0, replacement);
      else if (chars.length > 1) chars.splice(at, 1);
      else chars.push(replacement);
      words[index] = w(chars.join(""), words[index].confidence);
    }
    if (kind === "lookalike") {
      const digits = Array.from({ length: 4 }, () => pick(Object.keys(LOOKALIKE_SWAP))).join("");
      expectedText = `${expectedWords[0]}-${digits}`;
      const swapped = [...digits];
      swapped[0] = LOOKALIKE_SWAP[swapped[0]];
      swapped[2] = LOOKALIKE_SWAP[swapped[2]];
      words = [w(`${expectedWords[0]}-${swapped.join("")}`, conf())];
    }
    if (kind === "duplicate") words = [...words, w(word(DISJOINT), conf()), ...expectedWords.map((t) => w(t, conf()))];
    if (kind === "lowconf") {
      const index = Math.floor(random() * words.length);
      words[index] = w(words[index].text, Math.floor(random() * 80));
    }
    if (kind === "refusal") refusal = pick(TEXT_ASSERTION_REFUSALS);

    const input = deepFreeze<TextAssertionInput>({ version: 1, expected: { text: expectedText, match: mode }, ...(refusal ? { refusal } : {}), ocr: { ok: true, words } });
    const snapshot = JSON.stringify(input);
    let decision: TextAssertionDecision;
    let again: TextAssertionDecision;
    try {
      decision = decider(input);
      again = decider(input);
    } catch (error) {
      note("[property] input not mutated", `threw on run ${run}: ${(error as Error).message}`);
      continue;
    }
    if (JSON.stringify(input) !== snapshot) note("[property] input not mutated", `run ${run}`);
    if (JSON.stringify(decision) !== JSON.stringify(again)) note("[property] deterministic", `run ${run}`);
    const problem = shapeProblem(decision);
    if (problem) note("[property] shape", `run ${run}: ${problem}`);
    if (decision.verdict === "matched") tally.matched += 1;
    else if (decision.verdict === "differs") tally.differs += 1;
    else tally.inconclusive += 1;

    const detail = `run ${run} ${mode} ${kind}: ${decision.code}`;
    if (kind === "copy" && mode !== "contains" && decision.code !== "text-matched") note("[property] copies match", detail);
    if (kind === "different" && decision.code !== "text-differs") note("[property] disjoint reads differ", detail);
    if (kind === "one-edit" && decision.verdict === "matched") note("[property] one-edit reads never match", detail);
    if (kind === "lookalike" && (decision.verdict === "matched" || (mode !== "contains" && decision.code !== "lookalike-only-difference"))) note("[property] look-alike reads never match", detail);
    if (kind === "duplicate" && mode === "contains" && decision.verdict === "matched") note("[property] duplicates never match", detail);
    if (kind === "lowconf" && (decision.verdict === "matched" || (mode !== "contains" && decision.code !== "low-confidence"))) note("[property] low confidence never matches", detail);
    if (kind === "refusal" && decision.code !== refusal) note("[property] a refusal always wins", detail);
  }

  const outcomes: Outcome[] = LABELS.map((label) => ({ label, ok: !violations.has(label), detail: violations.get(label) }));
  outcomes.push({
    label: "[property] the run generated every verdict above its floor",
    ok: runs > 0 && tally.matched >= MIN_MATCHED && tally.differs >= MIN_DIFFERS && tally.inconclusive >= MIN_INCONCLUSIVE,
    detail: `${tally.matched} matched, ${tally.differs} differs, ${tally.inconclusive} inconclusive over ${runs} runs`
  });
  return outcomes;
}

function evaluateSuite(decider: Decider, cases: readonly Case[], runs: number): Outcome[] {
  const outcomes: Outcome[] = [];
  outcomes.push({ label: "the decision table holds the floor", ok: cases.length >= TABLE_FLOOR, detail: `${cases.length} cases` });
  const shapeProblems: string[] = [];
  for (const c of cases) {
    let decision: TextAssertionDecision;
    try {
      decision = c.policy ? decider(c.input, c.policy) : decider(c.input);
    } catch (error) {
      outcomes.push({ label: `[table] ${c.name}`, ok: false, detail: `threw: ${(error as Error).message}` });
      continue;
    }
    const factProblems = Object.entries(c.facts ?? {}).filter(([key, value]) => decision[key as keyof TextAssertionDecision] !== value);
    outcomes.push({
      label: `[table] ${c.name}`,
      ok: decision.code === c.code && factProblems.length === 0,
      detail: `got ${decision.code}${factProblems.length ? ` with ${factProblems.map(([k]) => `${k}=${String(decision[k as keyof TextAssertionDecision])}`).join(", ")}` : ""}, want ${c.code}`
    });
    const problem = shapeProblem(decision);
    if (problem) shapeProblems.push(`${c.name}: ${problem}`);
  }
  outcomes.push({ label: "[invariant] shape: every table decision carries exactly six fields, a vocabulary code and its verdict, and no text", ok: shapeProblems.length === 0, detail: shapeProblems.slice(0, 3).join("; ") });
  outcomes.push(...propertyOutcomes(decider, runs));
  return outcomes;
}

// ── Preprocessing and OC-8 suites ───────────────────────────────────────────────────────────────────────────────────

type Preprocessor = (input: OcrPreprocessInput) => OcrPreprocessResult;
const solid = (width: number, height: number, rgba: [number, number, number, number]): VisualImage => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return new VisualImage(width, height, data);
};

function preprocessOutcomes(pre: Preprocessor): Outcome[] {
  const out: Outcome[] = [];
  const add = (label: string, ok: boolean, detail?: string): void => {
    out.push({ label: `[preprocess] ${label}`, ok, detail });
  };
  const code = (r: OcrPreprocessResult): string => (r.ok ? "ok" : r.code);
  const at = (r: OcrPreprocessResult, i: number): number => (r.ok ? r.gray[i] : -1);

  const large = pre({ image: solid(40, 20, [0, 0, 0, 255]), fontSizeCssPx: 40, devicePixelRatio: 1 });
  add("text whose x-height meets the floor is not scaled", large.ok && large.scale === 1 && large.width === 40 && large.height === 20, code(large));
  add("black stays black", at(large, 0) === 0);
  add("white stays white", at(pre({ image: solid(10, 10, [255, 255, 255, 255]), fontSizeCssPx: 40, devicePixelRatio: 1 }), 0) === 255);
  add("transparent composites over white", at(pre({ image: solid(10, 10, [0, 0, 0, 0]), fontSizeCssPx: 40, devicePixelRatio: 1 }), 0) === 255);
  add("pure red uses BT.601 weights", at(pre({ image: solid(10, 10, [255, 0, 0, 255]), fontSizeCssPx: 40, devicePixelRatio: 1 }), 0) === 76);
  add("half-transparent black is mid gray", at(pre({ image: solid(10, 10, [0, 0, 0, 128]), fontSizeCssPx: 40, devicePixelRatio: 1 }), 0) === 127);
  const small = pre({ image: solid(30, 10, [0, 0, 0, 255]), fontSizeCssPx: 12, devicePixelRatio: 1 });
  add("12 px text is scaled to the next quarter (3.5) and keeps its tone", small.ok && small.scale === 3.5 && small.width === 105 && small.height === 35 && small.gray.every((v) => v === 0), small.ok ? `scale ${small.scale}, ${small.width}x${small.height}` : code(small));
  const dpr = pre({ image: solid(30, 10, [0, 0, 0, 255]), fontSizeCssPx: 12, devicePixelRatio: 2 });
  add("the device pixel ratio counts toward the x-height", dpr.ok && dpr.scale === 1.75, dpr.ok ? `scale ${dpr.scale}` : code(dpr));
  add("10 px text at DPR 1 needs exactly the maximum factor 4", code(pre({ image: solid(20, 10, [0, 0, 0, 255]), fontSizeCssPx: 10, devicePixelRatio: 1 })) === "ok");
  add("8 px text is too small to read", code(pre({ image: solid(20, 10, [0, 0, 0, 255]), fontSizeCssPx: 8, devicePixelRatio: 1 })) === "region-too-small");
  add("a region under the minimum size is refused", code(pre({ image: solid(7, 30, [0, 0, 0, 255]), fontSizeCssPx: 40, devicePixelRatio: 1 })) === "region-too-small");
  add("a crop over 1 MP is refused, never downscaled", code(pre({ image: solid(1001, 1000, [0, 0, 0, 255]), fontSizeCssPx: 40, devicePixelRatio: 1 })) === "region-too-large");
  add("scaling past 1 MP is refused", code(pre({ image: solid(400, 400, [0, 0, 0, 255]), fontSizeCssPx: 12, devicePixelRatio: 1 })) === "region-too-large");
  add("exactly 1 MP after scaling is accepted", code(pre({ image: solid(500, 500, [0, 0, 0, 255]), fontSizeCssPx: 20, devicePixelRatio: 1 })) === "ok");
  add("a clipped region is refused", code(pre({ image: solid(40, 20, [0, 0, 0, 255]), fontSizeCssPx: 40, devicePixelRatio: 1, clipped: true })) === "region-clipped");
  add("a bad font size is invalid", code(pre({ image: solid(40, 20, [0, 0, 0, 255]), fontSizeCssPx: Number.NaN, devicePixelRatio: 1 })) === "input-invalid");
  add("a bad device pixel ratio is invalid", code(pre({ image: solid(40, 20, [0, 0, 0, 255]), fontSizeCssPx: 40, devicePixelRatio: 0 })) === "input-invalid");
  add("a malformed image is invalid", code(pre({ image: { width: 4, height: 4, data: new Uint8Array(3) } as unknown as VisualImage, fontSizeCssPx: 40, devicePixelRatio: 1 })) === "input-invalid");

  const stripe = new Uint8Array(20 * 10 * 4);
  for (let i = 0; i < stripe.length; i += 4) stripe.set(Math.floor(i / 4) % 20 < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255], i);
  const before = stripe.slice();
  const a = pre({ image: new VisualImage(20, 10, stripe), fontSizeCssPx: 14, devicePixelRatio: 1 });
  const b = pre({ image: new VisualImage(20, 10, stripe), fontSizeCssPx: 14, devicePixelRatio: 1 });
  add("deterministic", a.ok && b.ok && Buffer.from(a.gray).equals(Buffer.from(b.gray)));
  add("the input pixels are not mutated", Buffer.from(stripe).equals(Buffer.from(before)));
  add("an upscaled edge keeps both tones", a.ok && a.gray[0] === 0 && a.gray[a.width - 1] === 255);
  add("ocrScaleFor and the floor agree", ocrScaleFor(40, 1) === 1 && ocrScaleFor(12, 1) === 3.5 && OCR_MIN_X_HEIGHT_PX === 20 && OCR_MAX_OUTPUT_PIXELS === 1_000_000);
  add("grayscaleOverWhite is the plane used", a.ok && grayscaleOverWhite(new VisualImage(20, 10, stripe)).length === 200);
  return out;
}

type Detector = (value: unknown, context?: { otpOrPinContext?: boolean }) => SensitiveValueCode | null;
type NameRule = (name: unknown) => boolean;

function sensitiveOutcomes(detect: Detector, name: NameRule): Outcome[] {
  const out: Outcome[] = [];
  const add = (label: string, ok: boolean, detail?: string): void => {
    out.push({ label: `[sensitive] ${label}`, ok, detail });
  };
  const is = (value: string, want: SensitiveValueCode | null, context?: { otpOrPinContext?: boolean }): void => {
    const got = detect(value, context);
    add(`${JSON.stringify(value)}${context?.otpOrPinContext ? " (OTP context)" : ""} is ${want ?? "not sensitive"}`, got === want, `got ${got}`);
  };
  is("4111 1111 1111 1111", "card-number");
  is("Card 4111-1111-1111-1111 on file", "card-number");
  is("4111 1111 1111 1112", null);
  is("Order 12345678901234567890", null);
  is("GB82 WEST 1234 5698 7654 32", "iban");
  is("GB82 WEST 1234 5698 7654 33", null);
  is("123-45-6789", "ssn");
  is("Date 2026-10-26", null);
  is("482913", "otp-or-pin", { otpOrPinContext: true });
  is("Code: 4829", "otp-or-pin", { otpOrPinContext: true });
  is("482913", null);
  is("Order 4471", null);
  is("${secret.apiKey}", "secret-reference");
  is("${ secret.db.password }", "secret-reference");
  add("a non-string value is treated as sensitive", detect(42) !== null);
  for (const n of ["cardNumber", "user_pin", "cvv2", "OTP", "passwordConfirm", "iban", "accountNumber", "apiToken", "client_secret", "Security code", "one-time code"]) {
    add(`the name ${n} is sensitive`, name(n));
  }
  for (const n of ["pinned", "spinner", "tokenizer", "Total", "orderId", "shippingAddress"]) add(`the name ${n} is not sensitive`, !name(n));
  add("a non-string name is treated as sensitive", name(undefined));
  return out;
}

// ── Preconditions, pins and purity ──────────────────────────────────────────────────────────────────────────────────

console.log("verify:ocr-decision — N7.2 pure OCR text assertion decision, preprocessing and OC-8 rules\n");

check("pin: every code maps to exactly one verdict", Object.values(TEXT_ASSERTION_CODES).every((v) => ["matched", "differs", "inconclusive"].includes(v)));
check("pin: only text-matched is matched and only text-differs differs", Object.entries(TEXT_ASSERTION_CODES).filter(([, v]) => v !== "inconclusive").map(([k, v]) => `${k}:${v}`).sort().join(",") === "text-differs:differs,text-matched:matched");
check("pin: the uncalibrated policy is 80 / 92 and marked uncalibrated", UNCALIBRATED_TEXT_ASSERTION_POLICY.minWordConfidence === 80 && UNCALIBRATED_TEXT_ASSERTION_POLICY.minLookalikeConfidence === 92 && UNCALIBRATED_TEXT_ASSERTION_POLICY.calibrated === false && Object.isFrozen(UNCALIBRATED_TEXT_ASSERTION_POLICY));
check(
  "pin: the visual index exports the N7.2 API",
  [visualIndex.decideTextAssertion, visualIndex.preprocessForOcr, visualIndex.detectSensitiveValue, visualIndex.isSensitiveSourceName].every((f) => typeof f === "function") &&
    visualIndex.UNCALIBRATED_TEXT_ASSERTION_POLICY === UNCALIBRATED_TEXT_ASSERTION_POLICY
);

const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const sources = {
  decision: readFileSync(join(process.cwd(), "src", "visual", "ocr", "decideTextAssertion.ts"), "utf8"),
  preprocess: readFileSync(join(process.cwd(), "src", "visual", "ocr", "preprocess.ts"), "utf8"),
  sensitive: readFileSync(join(process.cwd(), "src", "visual", "ocr", "sensitiveExpected.ts"), "utf8")
};
const importsOf = (text: string): string[] => [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
check("purity: the decision imports only ./sensitiveExpected", importsOf(sources.decision).join(",") === "./sensitiveExpected", importsOf(sources.decision).join(", "));
check("purity: preprocessing imports only a type from ../png", importsOf(sources.preprocess).join(",") === "../png" && /import type \{ VisualImage \} from "\.\.\/png"/.test(sources.preprocess));
check("purity: the OC-8 rules import nothing", importsOf(sources.sensitive).length === 0);
for (const [name, text] of Object.entries(sources)) {
  const code = strip(text);
  check(`purity: ${name} uses no I/O, clock, randomness or dynamic import`, !/\b(node:|require\(|import\(|Date\.|new Date|Math\.random|performance\.|process\.|setTimeout|fetch\(|readFile|writeFile|console\.)/.test(code));
  check(`purity: ${name} names no OCR engine`, !/tesseract|traineddata|wasm/i.test(code));
  check(`purity: ${name} cannot capture, act or pick a locator`, !/\b(capture(Element|Viewport|Candidates|VisualFrame)|captureCore|protectedGuard|click|fill|locator|selector|retry|page\.)\s*\(?/.test(code));
}

const cases = buildCases();
for (const outcome of evaluateSuite(decideTextAssertion, cases, PROPERTY_RUNS)) check(outcome.label, outcome.ok, outcome.ok ? undefined : outcome.detail);
for (const outcome of preprocessOutcomes(preprocessForOcr)) check(outcome.label, outcome.ok, outcome.ok ? undefined : outcome.detail);
for (const outcome of sensitiveOutcomes(detectSensitiveValue, isSensitiveSourceName)) check(outcome.label, outcome.ok, outcome.ok ? undefined : outcome.detail);

// ── Mutants ─────────────────────────────────────────────────────────────────────────────────────────────────────────

console.log("\n  mutants (each must FAIL its suite)");

const withCode = (d: TextAssertionDecision, code: TextAssertionCode): TextAssertionDecision => ({ ...d, code, verdict: TEXT_ASSERTION_CODES[code] });
const mapWords = (i: TextAssertionInput, f: (word: OcrWord) => OcrWord): TextAssertionInput => {
  if (!i || typeof i !== "object" || !i.ocr || i.ocr.ok !== true || !Array.isArray(i.ocr.words)) return i;
  const copy = clone(i) as TextAssertionInput & { ocr: { ok: true; words: OcrWord[] } };
  copy.ocr.words = copy.ocr.words.map((word) => (word && typeof word.confidence === "number" && Number.isFinite(word.confidence) ? f(word) : word));
  return copy;
};
const outputMutant = (from: TextAssertionCode, to: TextAssertionCode): Decider => (i, p) => {
  const d = decideTextAssertion(i, p);
  return d.code === from ? withCode(d, to) : d;
};

const confidenceGateDropped: Decider = (i, p) => decideTextAssertion(mapWords(i, (word) => ({ ...word, confidence: 100 })), p);
const lookalikeGateDropped: Decider = (i, p) => decideTextAssertion(mapWords(i, (word) => (word.confidence >= 80 && word.confidence <= 100 ? { ...word, confidence: Math.max(word.confidence, 92) } : word)), p);
const boundaryIgnored: Decider = (i, p) => {
  const d = decideTextAssertion(i, p);
  if (!i || typeof i !== "object" || i.expected?.match !== "contains" || i.ocr?.ok !== true || d.verdict !== "differs") return d;
  const joined = i.ocr.words.map((word) => word.text).join(" ").toLowerCase();
  return joined.includes(String(i.expected.text).toLowerCase()) ? withCode(d, "text-matched") : d;
};
const refusalDropped: Decider = (i, p) => {
  if (!i || typeof i !== "object" || !("refusal" in i)) return decideTextAssertion(i, p);
  const copy = clone(i);
  delete copy.refusal;
  return decideTextAssertion(copy, p);
};
const unknownFailureAsDiffers: Decider = (i, p) => {
  const d = decideTextAssertion(i, p);
  const code = i && typeof i === "object" && i.ocr?.ok === false ? (i.ocr as { code: string }).code : null;
  return code !== null && !(TEXT_ASSERTION_OCR_FAILURES as readonly string[]).includes(code) ? withCode(d, "text-differs") : d;
};
const exactFoldsCase: Decider = (i, p) => {
  if (!i || typeof i !== "object" || i.expected?.match !== "exact" || i.expected.caseSensitive !== undefined || typeof i.expected.text !== "string") return decideTextAssertion(i, p);
  const copy = mapWords(clone(i), (word) => ({ ...word, text: typeof word.text === "string" ? word.text.toLowerCase() : word.text }));
  copy.expected = { ...copy.expected, text: copy.expected.text.toLowerCase() };
  return decideTextAssertion(copy, p);
};
const leaksText: Decider = (i, p) => {
  const d = decideTextAssertion(i, p);
  return d.verdict === "matched" ? ({ ...d, text: i.expected.text } as TextAssertionDecision) : d;
};
const throwsOnMalformed: Decider = (i, p) => {
  if (!i || typeof i !== "object" || Array.isArray(i)) throw new Error("malformed input");
  return decideTextAssertion(i, p);
};

const decisionMutants: Array<[string, Outcome[], string]> = [
  ["a near miss is read as a match", evaluateSuite(outputMutant("near-miss", "text-matched"), cases, PROPERTY_RUNS), "[table] exact one substitution"],
  ["the word-confidence gate is dropped", evaluateSuite(confidenceGateDropped, cases, PROPERTY_RUNS), "[table] exact match with min confidence 79"],
  ["the look-alike gate is dropped", evaluateSuite(lookalikeGateDropped, cases, PROPERTY_RUNS), "[table] exact match, look-alike word at 85"],
  ["contains ambiguity is read as a match", evaluateSuite(outputMutant("ambiguous-match", "text-matched"), cases, PROPERTY_RUNS), "[table] contains duplicate"],
  ["contains ignores word boundaries", evaluateSuite(boundaryIgnored, cases, PROPERTY_RUNS), "[table] contains word boundary (Subtotal)"],
  ["a caller refusal is dropped", evaluateSuite(refusalDropped, cases, PROPERTY_RUNS), "[table] refusal protected-surface"],
  ["the OC-8 sensitive check is dropped", evaluateSuite(outputMutant("sensitive-input", "text-matched"), cases, PROPERTY_RUNS), "[table] sensitive card number"],
  ["an unknown engine failure is read as a difference", evaluateSuite(unknownFailureAsDiffers, cases, PROPERTY_RUNS), "[table] unknown engine failure code"],
  ["exact mode folds case", evaluateSuite(exactFoldsCase, cases, PROPERTY_RUNS), "[table] exact is case-sensitive by default"],
  ["a look-alike-only difference is reported as a difference", evaluateSuite(outputMutant("lookalike-only-difference", "text-differs"), cases, PROPERTY_RUNS), "[table] exact look-alike-only difference"],
  ["a low-confidence difference is reported as a difference", evaluateSuite(outputMutant("low-confidence", "text-differs"), cases, PROPERTY_RUNS), "[table] exact differs with a low-confidence word"],
  ["a decision carries the text", evaluateSuite(leaksText, cases, PROPERTY_RUNS), "[invariant] shape"],
  ["malformed input throws", evaluateSuite(throwsOnMalformed, cases, PROPERTY_RUNS), "[table] null input"],
  ["an empty case set", evaluateSuite(decideTextAssertion, [], PROPERTY_RUNS), "the decision table holds the floor"],
  ["a case set one short of the floor", evaluateSuite(decideTextAssertion, cases.slice(0, TABLE_FLOOR - 1), PROPERTY_RUNS), "the decision table holds the floor"],
  ["an empty property run", evaluateSuite(decideTextAssertion, cases, 0), "[property] the run generated every verdict above its floor"]
];

const clippedIgnored: Preprocessor = (i) => preprocessForOcr({ ...i, clipped: false });
const neverTooLarge: Preprocessor = (i) => {
  const r = preprocessForOcr(i);
  return !r.ok && r.code === "region-too-large" ? preprocessForOcr({ ...i, fontSizeCssPx: 1000 }) : r;
};
const alphaIgnored: Preprocessor = (i) => {
  if (!i?.image?.data || i.image.data.length !== i.image.width * i.image.height * 4) return preprocessForOcr(i);
  const data = i.image.data.slice();
  for (let k = 3; k < data.length; k += 4) data[k] = 255;
  return preprocessForOcr({ ...i, image: new VisualImage(i.image.width, i.image.height, data) });
};
const noUpscale: Preprocessor = (i) => preprocessForOcr(i?.fontSizeCssPx ? { ...i, fontSizeCssPx: Math.max(i.fontSizeCssPx, 40) } : i);

const luhnIgnored: Detector = (value, context) => {
  const got = detectSensitiveValue(value, context);
  return got === null && typeof value === "string" && /(?:\d[ -]?){15}\d/.test(value) ? "card-number" : got;
};
const otpContextIgnored: Detector = (value) => detectSensitiveValue(value, {});
const nameNotWordSplit: NameRule = (n) => typeof n !== "string" || /otp|one ?time|passcode|pass ?word|\bpin\b|\bcvv\b|card ?number|\bssn\b|\biban\b|account ?number|\bsecret\b|\btoken\b/.test(n.toLowerCase());

const otherMutants: Array<[string, Outcome[], string]> = [
  ["preprocessing ignores clipping", preprocessOutcomes(clippedIgnored), "[preprocess] a clipped region is refused"],
  ["preprocessing downscales instead of refusing", preprocessOutcomes(neverTooLarge), "[preprocess] scaling past 1 MP is refused"],
  ["preprocessing ignores alpha", preprocessOutcomes(alphaIgnored), "[preprocess] transparent composites over white"],
  ["preprocessing never scales up", preprocessOutcomes(noUpscale), "[preprocess] 12 px text is scaled"],
  ["the card rule skips the Luhn check", sensitiveOutcomes(luhnIgnored, isSensitiveSourceName), "[sensitive] \"4111 1111 1111 1112\" is not sensitive"],
  ["the OTP/PIN context is ignored", sensitiveOutcomes(otpContextIgnored, isSensitiveSourceName), "[sensitive] \"482913\" (OTP context) is otp-or-pin"],
  ["names are not word-split", sensitiveOutcomes(detectSensitiveValue, nameNotWordSplit), "[sensitive] the name user_pin is sensitive"]
];

for (const [name, outcomes, mustFail] of [...decisionMutants, ...otherMutants]) {
  const failing = outcomes.filter((o) => !o.ok).map((o) => o.label);
  const caughtBy = failing.some((label) => label.startsWith(mustFail));
  check(`MUTATION: ${name} fails the suite (${failing.length} checks, including "${mustFail}")`, failing.length > 0 && caughtBy, `the suite passed a mutant: ${failing.slice(0, 5).join("; ") || "nothing failed"}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
