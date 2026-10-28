/**
 * N7.6 (awkit-vra.9.7) OCR engine and recognition-data spike: the GO / NO-GO criteria, fixed BEFORE any candidate was
 * measured (owner approval 2026-10-28). PURE: no I/O, no clock, no engine. DIAGNOSTIC ONLY: nothing in the product
 * imports it and no production verdict depends on it.
 *
 * Every candidate's words go through the UNCHANGED production decision (decideTextAssertion, 80 / 92, uncalibrated).
 * A composite may only DEMOTE the baseline's text-matched to inconclusive when its second engine does not read the
 * expected text; it can never create a match. An engine that reports no confidence cannot meet the unchanged
 * thresholds on its own and is judged only as a composite's second reader.
 *
 * A candidate is GO only when every gate passes:
 *  - zeroFalseMatched: no `matched` on any negative (confusable calibration fixtures, confirmation and holdout
 *    negatives), in every measured cell (OC-10);
 *  - supportedAccuracy: matched / supported trials >= 98 %, every refusal and failure counted as a miss (OC-10);
 *  - unsupportedNeverMatched: no `matched` on the unsupported fixtures;
 *  - coverage: every one of the six cells measured at least once;
 *  - latency: the estimated whole-operation p95 (the qualifying session's warm whole-operation p95, minus the baseline's
 *    recognize p95, plus the candidate's) is within the unchanged 1500 ms deadline, and its first recognition after
 *    start-up is measured;
 *  - packageBudget: the candidate's shipped OCR assets fit the OC-9 8,000,000-byte budget;
 *  - offlinePinned: every asset is local and pinned (no runtime download, no network);
 *  - cpuCompatible: no CPU requirement beyond the current SIMD floor.
 */

export interface EngineSpikeCriteria {
  falseMatchedMax: number;
  supportedAccuracyMin: number;
  unsupportedMatchedMax: number;
  cells: number;
  deadlineMs: number;
  packageBudgetBytes: number;
}

export const ENGINE_SPIKE_CRITERIA: Readonly<EngineSpikeCriteria> = Object.freeze({
  falseMatchedMax: 0,
  supportedAccuracyMin: 0.98,
  unsupportedMatchedMax: 0,
  cells: 6,
  deadlineMs: 1500,
  packageBudgetBytes: 8_000_000
});

export type GateState = "PASS" | "FAIL" | "NOT-RUN";
export type SpikeVerdict = "GO" | "NO-GO";

export interface CandidateMeasurement {
  /** True when the candidate cannot meet the unchanged thresholds alone (no confidence): never GO standalone. */
  noConfidence: boolean;
  available: boolean;
  negatives: { trials: number; matched: number };
  supported: { trials: number; matched: number };
  unsupported: { trials: number; matched: number };
  cellsMeasured: number;
  latency: { estimatedWholeP95Ms: number | null; firstRecognizeMs: number | null };
  packageBytes: number | null;
  offlinePinned: boolean;
  cpuCompatible: boolean;
}

export interface CandidateEvaluation {
  gates: Record<"zeroFalseMatched" | "supportedAccuracy" | "unsupportedNeverMatched" | "coverage" | "latency" | "packageBudget" | "offlinePinned" | "cpuCompatible" | "policyCompatible", GateState>;
  supportedAccuracy: number | null;
  verdict: SpikeVerdict;
  failed: string[];
}

const state = (condition: boolean | null): GateState => (condition === null ? "NOT-RUN" : condition ? "PASS" : "FAIL");

export function evaluateCandidate(m: CandidateMeasurement, c = ENGINE_SPIKE_CRITERIA): CandidateEvaluation {
  const measured = m.available;
  const accuracy = m.supported.trials > 0 ? m.supported.matched / m.supported.trials : null;
  const gates: CandidateEvaluation["gates"] = {
    zeroFalseMatched: state(measured && m.negatives.trials > 0 ? m.negatives.matched <= c.falseMatchedMax : null),
    supportedAccuracy: state(measured && accuracy !== null ? accuracy >= c.supportedAccuracyMin : null),
    unsupportedNeverMatched: state(measured && m.unsupported.trials > 0 ? m.unsupported.matched <= c.unsupportedMatchedMax : null),
    coverage: state(measured ? m.cellsMeasured >= c.cells : null),
    latency: state(measured && m.latency.estimatedWholeP95Ms !== null && m.latency.firstRecognizeMs !== null ? m.latency.estimatedWholeP95Ms <= c.deadlineMs : null),
    packageBudget: state(m.packageBytes === null ? null : m.packageBytes <= c.packageBudgetBytes),
    offlinePinned: state(m.offlinePinned),
    cpuCompatible: state(m.cpuCompatible),
    policyCompatible: state(!m.noConfidence)
  };
  const failed = Object.entries(gates).filter(([, s]) => s !== "PASS").map(([name]) => name);
  return { gates, supportedAccuracy: accuracy, verdict: failed.length === 0 ? "GO" : "NO-GO", failed };
}

/** A composite can only demote: matched survives only when the second reader also read the expected text. */
export function compositeCode(baseCode: string, secondAgrees: boolean | null): string {
  if (baseCode !== "text-matched") return baseCode;
  return secondAgrees === true ? "text-matched" : "lookalike-uncertain";
}

/** The deadline estimate: replace the baseline's recognize p95 inside the measured warm whole-operation p95. */
export function estimateWholeP95(sessionWarmWholeP95: number, baselineRecognizeP95: number, candidateRecognizeP95: number): number {
  return Math.round(sessionWarmWholeP95 - baselineRecognizeP95 + candidateRecognizeP95);
}
