/**
 * N7.6 (awkit-vra.9.7) OCR character-ambiguity analysis. DIAGNOSTIC ONLY and PURE: no I/O, no clock, no engine. Used by
 * benchmark:ocr-ambiguity (measurements) and verify:ocr-ambiguity (deterministic tests and mutants). Nothing here is
 * imported by the product, and no verdict anywhere depends on it.
 *
 * Terms:
 *  - class symbol: a recognized glyph in the production look-alike class of the digit one (`1lIi|!`, the cased class
 *    in src/visual/ocr/decideTextAssertion.ts).
 *  - choice scale: the ChoiceIterator's confidence. Margins are taken within that one scale, never mixed with the
 *    symbol or word confidence (a different scale in Tesseract).
 *  - class margin: the top choice's confidence minus the best alternative that is a DIFFERENT member of the class
 *    (0 when the engine offered none). any margin: top minus the best different alternative of any kind.
 *
 * Privacy: every reduction returns numbers, booleans and codes. `assertAggregateOnly` refuses a report holding any
 * string outside a fixed vocabulary, any unsafe key, or any fixture text.
 */
import { percentile } from "./ocr-calibration-criteria.mts";

export const ONE_CLASS = "1lIi|!";

export interface ProbeChoice {
  text: string;
  confidence: number;
}
export interface ProbeSymbol {
  text: string;
  confidence: number;
  choices: ProbeChoice[];
}
export interface ProbeWord {
  text: string;
  confidence: number;
  line?: number;
  symbols?: ProbeSymbol[];
}

export interface SymbolMargins {
  /** Symbol confidence (the result iterator's scale). */
  symbolConfidence: number;
  /** Top choice confidence (choice scale). */
  top: number;
  classMargin: number;
  anyMargin: number;
  choiceCount: number;
  /** True when the engine offered a different class member at all. */
  classMateOffered: boolean;
}

export const isOneClass = (ch: string): boolean => ch.length === 1 && ONE_CLASS.includes(ch);

export function symbolMargins(symbol: ProbeSymbol): SymbolMargins {
  const choices = symbol.choices.filter((c) => Number.isFinite(c.confidence));
  const own = choices.filter((c) => c.text === symbol.text).reduce((max, c) => Math.max(max, c.confidence), -1);
  const top = own >= 0 ? own : choices.reduce((max, c) => Math.max(max, c.confidence), 0);
  const others = choices.filter((c) => c.text !== symbol.text);
  const classMate = others.filter((c) => isOneClass(c.text)).reduce((max, c) => Math.max(max, c.confidence), -1);
  const second = others.reduce((max, c) => Math.max(max, c.confidence), -1);
  return {
    symbolConfidence: symbol.confidence,
    top,
    classMargin: top - Math.max(classMate, 0),
    anyMargin: top - Math.max(second, 0),
    choiceCount: choices.length,
    classMateOffered: classMate >= 0
  };
}

export interface TrialFeatures {
  classSymbols: number;
  minSymbolConfidence: number | null;
  minClassMargin: number | null;
  minAnyMargin: number | null;
  minClassWordConfidence: number | null;
  maxChoiceCount: number;
  classMatesOffered: number;
}

export function trialFeatures(words: readonly ProbeWord[]): TrialFeatures {
  let classSymbols = 0;
  let classMatesOffered = 0;
  let maxChoiceCount = 0;
  const minOf = (a: number | null, b: number): number => (a === null ? b : Math.min(a, b));
  let minSymbolConfidence: number | null = null;
  let minClassMargin: number | null = null;
  let minAnyMargin: number | null = null;
  let minClassWordConfidence: number | null = null;
  for (const word of words) {
    for (const symbol of word.symbols ?? []) {
      const margins = symbolMargins(symbol);
      maxChoiceCount = Math.max(maxChoiceCount, margins.choiceCount);
      if (!isOneClass(symbol.text)) continue;
      classSymbols += 1;
      if (margins.classMateOffered) classMatesOffered += 1;
      minSymbolConfidence = minOf(minSymbolConfidence, margins.symbolConfidence);
      minClassMargin = minOf(minClassMargin, margins.classMargin);
      minAnyMargin = minOf(minAnyMargin, margins.anyMargin);
      minClassWordConfidence = minOf(minClassWordConfidence, word.confidence);
    }
  }
  return { classSymbols, minSymbolConfidence, minClassMargin, minAnyMargin, minClassWordConfidence, maxChoiceCount, classMatesOffered };
}

export type SymbolLabel = "correct" | "incorrect";

/**
 * Each class symbol labelled against the rendered text, position by position, when the read glyph count (spaces
 * ignored) equals the rendered one. Null when they differ: no label is guessed.
 */
export function labelClassSymbols(words: readonly ProbeWord[], rendered: string): Array<{ label: SymbolLabel; margins: SymbolMargins }> | null {
  const symbols = words.flatMap((w) => (w.symbols ?? []).filter((s) => s.text.trim() !== ""));
  const truth = [...rendered.replace(/\s+/g, "")];
  if (symbols.length !== truth.length || symbols.some((s) => [...s.text].length !== 1)) return null;
  const out: Array<{ label: SymbolLabel; margins: SymbolMargins }> = [];
  symbols.forEach((symbol, index) => {
    if (isOneClass(symbol.text) || isOneClass(truth[index])) out.push({ label: symbol.text === truth[index] ? "correct" : "incorrect", margins: symbolMargins(symbol) });
  });
  return out;
}

export interface Quantiles {
  n: number;
  min: number | null;
  p05: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
}

const round = (value: number | null): number | null => (value === null ? null : Math.round(value * 100) / 100);

export function quantiles(values: readonly number[]): Quantiles {
  const finite = values.filter((v) => Number.isFinite(v));
  const at = (q: number) => round(percentile(finite, q));
  return {
    n: finite.length,
    min: finite.length ? round(Math.min(...finite)) : null,
    p05: at(0.05),
    p25: at(0.25),
    p50: at(0.5),
    p75: at(0.75),
    p95: at(0.95),
    max: finite.length ? round(Math.max(...finite)) : null
  };
}

export interface Separability {
  falseN: number;
  legitN: number;
  falseMax: number | null;
  legitMin: number | null;
  /** Every false value strictly below every legitimate value. */
  separable: boolean;
  /** legitMin - falseMax (negative when they overlap). */
  gap: number | null;
  /** False values at or above the lowest legitimate value. */
  falseInOverlap: number;
  /** Legitimate values at or below the highest false value. */
  legitInOverlap: number;
  /** A demotion floor (value < floor demotes), the midpoint of the gap; null unless separable. */
  floor: number | null;
  status: "separable" | "overlapping" | "insufficient";
}

/** The rule under test demotes a match whose feature is BELOW the floor, so false values must sit lower. */
export function separability(falseValues: readonly number[], legitValues: readonly number[], minimumFalse = 1): Separability {
  const f = falseValues.filter(Number.isFinite);
  const l = legitValues.filter(Number.isFinite);
  const falseMax = f.length ? Math.max(...f) : null;
  const legitMin = l.length ? Math.min(...l) : null;
  if (f.length < minimumFalse || l.length === 0 || falseMax === null || legitMin === null) {
    return { falseN: f.length, legitN: l.length, falseMax: round(falseMax), legitMin: round(legitMin), separable: false, gap: null, falseInOverlap: 0, legitInOverlap: 0, floor: null, status: "insufficient" };
  }
  const separable = falseMax < legitMin;
  return {
    falseN: f.length,
    legitN: l.length,
    falseMax: round(falseMax),
    legitMin: round(legitMin),
    separable,
    gap: round(legitMin - falseMax),
    falseInOverlap: f.filter((v) => v >= legitMin).length,
    legitInOverlap: l.filter((v) => v <= falseMax).length,
    floor: separable ? (falseMax + legitMin) / 2 : null,
    status: separable ? "separable" : "overlapping"
  };
}

/** How many values a floor would demote (value < floor). */
export const demotedBy = (values: readonly number[], floor: number): number => values.filter((v) => Number.isFinite(v) && v < floor).length;

// ── Privacy guard ────────────────────────────────────────────────────────────────────────────────────────────────────

const SAFE_KEY = /^(?:[a-z][a-zA-Z0-9]*|[a-z0-9]+(?:[-:.][a-z0-9]+)*)$/;

/**
 * Throws unless every string value in `report` is in `vocabulary`, every key is safe and not a token of any fixture
 * text, and no fixture text (or its expected text) appears anywhere in the serialized report.
 */
export function assertAggregateOnly(report: unknown, vocabulary: ReadonlySet<string>, fixtureTexts: readonly string[]): void {
  const tokens = new Set(
    fixtureTexts.flatMap((t) => t.toLowerCase().split(/\s+/)).filter((t) => t.length >= 3 && !vocabulary.has(t))
  );
  const walk = (value: unknown, where: string): void => {
    if (value === null || typeof value === "number" || typeof value === "boolean") return;
    if (typeof value === "string") {
      if (!vocabulary.has(value)) throw new Error(`aggregate guard: a string outside the vocabulary at ${where}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${where}[${index}]`));
      return;
    }
    if (typeof value === "object") {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (!vocabulary.has(key) && (!SAFE_KEY.test(key) || tokens.has(key.toLowerCase()))) throw new Error(`aggregate guard: an unsafe key at ${where}`);
        walk(inner, `${where}.${key}`);
      }
      return;
    }
    throw new Error(`aggregate guard: a ${typeof value} at ${where}`);
  };
  walk(report, "report");
  const serialized = JSON.stringify(report).toLowerCase();
  for (const text of fixtureTexts) {
    const needle = JSON.stringify(text.toLowerCase()).slice(1, -1);
    if (needle.length >= 3 && serialized.includes(needle)) throw new Error("aggregate guard: fixture text in the report");
  }
}
