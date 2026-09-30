/**
 * L10.0 gate rule — written and committed BEFORE the first benchmark run, and shared by
 * `benchmark:dom-intelligence` (which applies it) and `verify:dom-intelligence-gate` (which re-derives
 * the decision from the committed results so it cannot drift from the data).
 *
 * Locator integration is judged against the UNCHANGED LocatorFactory gates (decision DI5): a Scrapling
 * candidate only counts when AWKIT's own identity score for it clears the 0.86 threshold AND beats every
 * other visible element by the 0.08 margin. Normalization is judged against what the browser can
 * already produce with no new runtime.
 */

export const RECOVERY_SCORE_THRESHOLD = 0.86;
export const RECOVERY_MARGIN = 0.08;
/** Warm relocation p95 budget on the fixture pages; the failure path already tolerates up to 2 s grace. */
export const WARM_P95_BUDGET_MS = 500;

export type EngineStatus = "resolved" | "unresolved" | "ambiguous" | "error";

export interface EngineOutcome {
  status: EngineStatus;
  /** True only when the resolved element is the truth element; false for a wrong element. */
  correct: boolean | null;
  ms: number;
  detail?: string;
}

export interface ScraplingOutcome {
  candidateCount: number;
  topScore: number | null;
  runnerUpScore: number | null;
  correct: boolean | null;
  truthRank: number | null;
  truthScore: number | null;
  /** AWKIT identity score of the unique candidate against the remembered fingerprint. */
  awkitScore: number | null;
  /** Best AWKIT score among every OTHER visible element (the margin competitor). */
  awkitBestOther: number | null;
  relocateMs: number;
  parseMs: number;
}

export interface CaseResult {
  id: string;
  expectation: "recoverable" | "no-match";
  recordedLocator: string;
  production: EngineOutcome;
  localOnly: EngineOutcome;
  localAndBlueprint: EngineOutcome;
  scrapling: ScraplingOutcome;
  truthAwkitScore: number | null;
  truthAwkitBestOther: number | null;
}

export interface LocatorTally {
  cases: number;
  recoverable: number;
  noMatch: number;
  awkitCorrect: number;
  awkitWrong: number;
  scraplingCorrect: number;
  scraplingAmbiguous: number;
  scraplingFalse: number;
  incrementalRaw: string[];
  incrementalGated: string[];
  gatedFalse: string[];
}

export function passesAwkitGates(scrapling: ScraplingOutcome): boolean {
  return (
    scrapling.awkitScore !== null &&
    scrapling.awkitScore >= RECOVERY_SCORE_THRESHOLD &&
    (scrapling.awkitBestOther === null || scrapling.awkitScore - scrapling.awkitBestOther >= RECOVERY_MARGIN)
  );
}

/** A Scrapling answer: exactly one top candidate. Ties are ambiguity, never a pick. */
export function scraplingPicked(scrapling: ScraplingOutcome): boolean {
  return scrapling.candidateCount === 1;
}

export function tallyLocator(results: CaseResult[]): LocatorTally {
  const tally: LocatorTally = {
    cases: results.length,
    recoverable: results.filter((r) => r.expectation === "recoverable").length,
    noMatch: results.filter((r) => r.expectation === "no-match").length,
    awkitCorrect: 0,
    awkitWrong: 0,
    scraplingCorrect: 0,
    scraplingAmbiguous: 0,
    scraplingFalse: 0,
    incrementalRaw: [],
    incrementalGated: [],
    gatedFalse: []
  };
  for (const r of results) {
    const awkitResolved = r.localAndBlueprint.status === "resolved";
    const awkitRight = awkitResolved && r.localAndBlueprint.correct === true;
    if (awkitRight) tally.awkitCorrect += 1;
    if (awkitResolved && !awkitRight) tally.awkitWrong += 1;

    if (r.scrapling.candidateCount > 1) tally.scraplingAmbiguous += 1;
    const picked = scraplingPicked(r.scrapling);
    const right = picked && r.scrapling.correct === true;
    const wrong = picked && r.scrapling.correct !== true;
    if (right) tally.scraplingCorrect += 1;
    if (wrong) tally.scraplingFalse += 1;
    if (wrong && passesAwkitGates(r.scrapling)) tally.gatedFalse.push(r.id);

    if (r.expectation === "recoverable" && !awkitRight && right) {
      tally.incrementalRaw.push(r.id);
      if (passesAwkitGates(r.scrapling)) tally.incrementalGated.push(r.id);
    }
  }
  return tally;
}

export interface LocatorGate {
  decision: "GO" | "NO-GO";
  reasons: string[];
}

export function decideLocatorGate(tally: LocatorTally, warmP95Ms: number): LocatorGate {
  const reasons: string[] = [];
  if (tally.incrementalGated.length === 0) {
    reasons.push("no case where Scrapling recovers the target that AWKIT missed AND its candidate passes the unchanged 0.86/0.08 gates");
  }
  if (tally.gatedFalse.length > 0) {
    reasons.push(`wrong candidates that would pass the unchanged gates: ${tally.gatedFalse.join(", ")}`);
  }
  if (!(warmP95Ms <= WARM_P95_BUDGET_MS)) reasons.push(`warm relocation p95 ${warmP95Ms} ms exceeds ${WARM_P95_BUDGET_MS} ms`);
  return { decision: reasons.length === 0 ? "GO" : "NO-GO", reasons };
}

export interface NormalizationMethod {
  method: string;
  newRuntime: boolean;
  leaked: string[];
  missingFacts: string[];
  outputChars: number;
  ms: number;
}

export interface NormalizationGate {
  decision: "GO" | "NO-GO";
  reasons: string[];
}

/**
 * Scrapling normalization is GO only if it leaks nothing, keeps every required fact, and is better on
 * at least one of (leaks, facts, size) than the best method that needs no new runtime.
 */
export function decideNormalizationGate(methods: NormalizationMethod[]): NormalizationGate {
  const scrapling = methods.find((m) => m.method === "scrapling-static-text");
  const inBrowser = methods.filter((m) => !m.newRuntime);
  const reasons: string[] = [];
  if (!scrapling) return { decision: "NO-GO", reasons: ["no Scrapling normalization measurement"] };
  if (scrapling.leaked.length > 0) reasons.push(`Scrapling output leaks ${scrapling.leaked.join(", ")}`);
  if (scrapling.missingFacts.length > 0) reasons.push(`Scrapling output drops ${scrapling.missingFacts.join(", ")}`);
  const dominated = inBrowser.some(
    (m) =>
      m.leaked.length <= scrapling.leaked.length &&
      m.missingFacts.length <= scrapling.missingFacts.length &&
      (m.leaked.length < scrapling.leaked.length || m.missingFacts.length < scrapling.missingFacts.length || m.outputChars <= scrapling.outputChars)
  );
  if (dominated) reasons.push("an in-browser method with no new runtime is at least as good on leaks, facts and size");
  return { decision: reasons.length === 0 ? "GO" : "NO-GO", reasons };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
