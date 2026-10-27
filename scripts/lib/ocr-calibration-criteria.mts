/**
 * N7.6 (awkit-vra.9.7) OCR calibration acceptance, as a pure function. Plan: docs/plans/ai-upgrade-v5/N7-ocr-text-in-
 * image.md › Determinism and accuracy, OC-10 (ratified 2026-10-26). Declared BEFORE any measurement and never tuned:
 *
 * A cell (render mode x device pixel ratio) is decided from the launches of ONE environment only (an exact match of
 * every fingerprint field: browser, Electron, OS, CPU, process architecture, engine and asset hashes, font hashes,
 * fixture-table hash, pipeline source digest, policy, viewport, deadline). Launches of any other environment are
 * counted and reported, never merged. Diagnostic launches (fallback fonts, `--diagnostic`) and cold-host probe launches
 * never count toward qualification.
 *
 *  - LAUNCHES: at least 300 complete launches from at least 3 sessions. A launch that failed before finishing (browser,
 *    page or harness error) is reported and does not count toward the 300; the trials it did finish stay in every
 *    statistic below. A launch id seen twice with different content invalidates the cell (duplicate evidence).
 *  - SUPPORTED fixtures (expected verdict matched):
 *      exact-match rate = matched trials / ALL supported trials   >= 98 %
 *      CER = sum(edits) / sum(expected characters)                <= 1 %
 *    A trial with no recognized text (budget-exhausted, a refusal, an engine failure) counts as a miss for exact match
 *    and as `expected characters` edits for CER. Nothing is excluded. Edits are the Levenshtein distance between the
 *    whitespace-collapsed, NFKC, case-sensitive recognized text and expected text, computed in memory by the harness;
 *    only the two counts are stored.
 *  - CONFUSABLE fixtures (look-alike and edit-distance-one near misses): matched trials = 0.
 *  - UNSUPPORTED fixtures (non-Latin, 15 degree rotation, vertical, below the x-height reach): inconclusive = 100 %.
 *  - REFUSAL fixtures: the expected refusal code with zero captures = 100 % (a security floor, not a rate).
 *  - LATENCY: p95 of the whole-operation duration over ALL supported and confusable trials (each is meant to reach
 *    recognition; instant pre-engine refusals cannot deflate it) <= 1500 ms. Budget-exhausted trials are included.
 *    OC-9's x64 target (p95 <= 1000 ms) is reported beside it, never substituted.
 */

export type OcrRenderMode = "headed" | "headless";
export interface OcrCalibrationCell {
  renderMode: OcrRenderMode;
  devicePixelRatio: number;
}
export type OcrFixtureClass = "supported" | "confusable" | "unsupported" | "refusal";

export interface OcrCalibrationTrial {
  fixtureId: string;
  /** The class in THIS cell (a fixture can be supported only above a device pixel ratio). */
  fixtureClass: OcrFixtureClass;
  verdict: "matched" | "differs" | "inconclusive";
  code: string;
  /** The whole-operation duration recorded by the executor (the corrected N7.5 clock). */
  durationMs: number;
  /** Levenshtein edits of the recognized text against the expected text; null when nothing was recognized. */
  edits: number | null;
  expectedChars: number;
  /** For refusal fixtures: the code they must answer. */
  expectedCode?: string;
  captures: number;
  /** The host was started for this trial (the first of a session or after a recycle). */
  coldHost: boolean;
  /** Per-phase milliseconds from the step's start (names only). */
  phases?: Record<string, number>;
}

export interface OcrCalibrationLaunch {
  launchId: string;
  sessionId: string;
  cell: OcrCalibrationCell;
  /** Canonical environment fingerprint; launches decide together only when these are identical. */
  environment: Record<string, unknown>;
  diagnostic: boolean;
  coldProbe: boolean;
  complete: boolean;
  error?: string;
  trials: OcrCalibrationTrial[];
}

export const OCR_CALIBRATION_CRITERIA = Object.freeze({
  minLaunches: 300,
  minSessions: 3,
  exactMatchMin: 0.98,
  cerMax: 0.01,
  falseMatchedMax: 0,
  unsupportedInconclusiveMin: 1,
  refusalCorrectMin: 1,
  p95MaxMs: 1500,
  /** OC-9 objective, Windows x64 only: reported, never a qualification criterion. */
  oc9TargetP95Ms: 1000
});

export const cellIdOf = (cell: OcrCalibrationCell): string => `${cell.renderMode}-dpr${cell.devicePixelRatio}`;

export const OCR_CALIBRATION_CELLS: readonly OcrCalibrationCell[] = (["headed", "headless"] as const).flatMap((renderMode) =>
  [1, 1.25, 2].map((devicePixelRatio) => ({ renderMode, devicePixelRatio }))
);

/** Canonical JSON: keys sorted at every level, so equal environments compare equal. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Nearest-rank percentile; null for an empty set. */
export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

export function latencySummary(values: readonly number[]): { n: number; p50: number | null; p95: number | null; p99: number | null; mean: number | null; max: number | null } {
  return {
    n: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    mean: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null,
    max: values.length ? Math.max(...values) : null
  };
}

/** Levenshtein distance (in-memory CER numerator). */
export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

/** The CER text form: NFKC, whitespace collapsed and trimmed, case kept. */
export const cerText = (value: string): string => value.normalize("NFKC").replace(/\s+/g, " ").trim();

export interface OcrCellSummary {
  cell: string;
  qualified: boolean;
  unmet: string[];
  /** `diagnostic` counts the launches of the OTHER kind (diagnostic ones when deciding, qualifying ones in a diagnostic summary). */
  launches: { complete: number; failed: number; sessions: number; otherEnvironment: number; diagnostic: number; coldProbe: number };
  supported: { trials: number; matched: number; exactMatchRate: number | null; edits: number; chars: number; cer: number | null };
  confusable: { trials: number; falseMatched: number };
  unsupported: { trials: number; inconclusive: number; inconclusiveRate: number | null };
  refusal: { trials: number; correct: number; correctRate: number | null };
  budgetExhausted: { trials: number; of: number };
  latency: ReturnType<typeof latencySummary>;
  latencyWarm: ReturnType<typeof latencySummary>;
  latencyCold: ReturnType<typeof latencySummary>;
  oc9TargetMet: boolean | null;
}

export function evaluateOcrCell(
  cell: OcrCalibrationCell,
  environment: Record<string, unknown>,
  all: readonly OcrCalibrationLaunch[],
  options: { diagnostic?: boolean } = {}
): OcrCellSummary {
  const id = cellIdOf(cell);
  const env = canonical(environment);
  const unmet: string[] = [];
  // Diagnostic evidence can be summarised (for the latency breakdown) but never qualifies a cell.
  const wantDiagnostic = options.diagnostic === true;
  if (wantDiagnostic) unmet.push("diagnostic evidence never qualifies");
  const ofCell = all.filter((l) => cellIdOf(l.cell) === id);
  const seen = new Map<string, string>();
  let duplicate = false;
  const unique: OcrCalibrationLaunch[] = [];
  for (const launch of ofCell) {
    const body = canonical(launch);
    const prior = seen.get(launch.launchId);
    if (prior === undefined) {
      seen.set(launch.launchId, body);
      unique.push(launch);
    } else if (prior !== body) duplicate = true;
  }
  if (duplicate) unmet.push("duplicate launch id with different content");
  const diagnostic = unique.filter((l) => l.diagnostic !== wantDiagnostic).length;
  const sameKind = unique.filter((l) => l.diagnostic === wantDiagnostic);
  const coldProbe = sameKind.filter((l) => l.coldProbe).length;
  const otherEnvironment = sameKind.filter((l) => !l.coldProbe && canonical(l.environment) !== env).length;
  const counted = sameKind.filter((l) => !l.coldProbe && canonical(l.environment) === env);
  const complete = counted.filter((l) => l.complete);
  const sessions = new Set(complete.map((l) => l.sessionId)).size;
  const trials = counted.flatMap((l) => l.trials);

  const supported = trials.filter((t) => t.fixtureClass === "supported");
  const matched = supported.filter((t) => t.verdict === "matched").length;
  const edits = supported.reduce((sum, t) => sum + (t.edits ?? t.expectedChars), 0);
  const chars = supported.reduce((sum, t) => sum + t.expectedChars, 0);
  const confusable = trials.filter((t) => t.fixtureClass === "confusable");
  const falseMatched = confusable.filter((t) => t.verdict === "matched").length;
  const unsupported = trials.filter((t) => t.fixtureClass === "unsupported");
  const inconclusive = unsupported.filter((t) => t.verdict === "inconclusive").length;
  const refusal = trials.filter((t) => t.fixtureClass === "refusal");
  const correct = refusal.filter((t) => t.code === t.expectedCode && t.captures === 0).length;
  const latencyTrials = [...supported, ...confusable];
  const latency = latencySummary(latencyTrials.map((t) => t.durationMs));

  const C = OCR_CALIBRATION_CRITERIA;
  if (complete.length < C.minLaunches) unmet.push(`launches ${complete.length} < ${C.minLaunches}`);
  if (sessions < C.minSessions) unmet.push(`sessions ${sessions} < ${C.minSessions}`);
  const rate = (n: number, d: number) => (d > 0 ? n / d : null);
  const exactMatchRate = rate(matched, supported.length);
  const cer = rate(edits, chars);
  const inconclusiveRate = rate(inconclusive, unsupported.length);
  const correctRate = rate(correct, refusal.length);
  if (exactMatchRate === null || exactMatchRate < C.exactMatchMin) unmet.push(`exact match ${exactMatchRate === null ? "no trials" : (exactMatchRate * 100).toFixed(2) + " %"} < 98 %`);
  if (cer === null || cer > C.cerMax) unmet.push(`CER ${cer === null ? "no trials" : (cer * 100).toFixed(2) + " %"} > 1 %`);
  if (confusable.length === 0) unmet.push("no confusable trials");
  else if (falseMatched > C.falseMatchedMax) unmet.push(`${falseMatched} false matched on look-alike and near-miss fixtures`);
  if (inconclusiveRate === null || inconclusiveRate < C.unsupportedInconclusiveMin) unmet.push(`unsupported inconclusive ${inconclusiveRate === null ? "no trials" : (inconclusiveRate * 100).toFixed(2) + " %"} < 100 %`);
  if (correctRate === null || correctRate < C.refusalCorrectMin) unmet.push(`refusals correct ${correctRate === null ? "no trials" : (correctRate * 100).toFixed(2) + " %"} < 100 %`);
  if (latency.p95 === null || latency.p95 > C.p95MaxMs) unmet.push(`p95 ${latency.p95 ?? "no trials"} ms > ${C.p95MaxMs} ms`);

  return {
    cell: id,
    qualified: unmet.length === 0,
    unmet,
    launches: { complete: complete.length, failed: counted.length - complete.length, sessions, otherEnvironment, diagnostic, coldProbe },
    supported: { trials: supported.length, matched, exactMatchRate, edits, chars, cer },
    confusable: { trials: confusable.length, falseMatched },
    unsupported: { trials: unsupported.length, inconclusive, inconclusiveRate },
    refusal: { trials: refusal.length, correct, correctRate },
    budgetExhausted: { trials: trials.filter((t) => t.code === "budget-exhausted").length, of: trials.length },
    latency,
    latencyWarm: latencySummary(latencyTrials.filter((t) => !t.coldHost).map((t) => t.durationMs)),
    latencyCold: latencySummary(latencyTrials.filter((t) => t.coldHost).map((t) => t.durationMs)),
    oc9TargetMet: latency.p95 === null ? null : latency.p95 <= C.oc9TargetP95Ms
  };
}

/** The keys a stored trial may carry: codes, counts and timings only, never text, pixels or selectors. */
export const OCR_CALIBRATION_TRIAL_KEYS = [
  "fixtureId",
  "fixtureClass",
  "verdict",
  "code",
  "durationMs",
  "edits",
  "expectedChars",
  "expectedCode",
  "captures",
  "coldHost",
  "phases"
] as const;
