/**
 * The L5a overhead gate's statistics and configuration rules, pure so `verify:failure-capture-gate-stats`
 * can prove them without launching a browser. `scripts/verify-failure-capture-overhead.mts` is the only
 * production caller. Owner-approved methodology: `docs/plans/ai-upgrade-v5/L5-failure-evidence-and-analysis.md`
 * › "L5a gate — owner decision" (B/C + D + E, p95 binding from 21 samples per mode, ceilings unchanged).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Option C + D (approved 2026-09-21): the only configuration whose verdict counts. */
export const APPROVED_GATE = Object.freeze({ rounds: 21, instances: 1 });
/** Below this many samples per mode, `stats().p95` is the maximum sample, so p95 only informs. */
export const P95_MIN_SAMPLES = 21;

export interface MedianInterval {
  low: number;
  high: number;
  /** Exact coverage of the interval for a continuous distribution: 1 − 2·P(Bin(n, ½) ≤ k − 1). */
  coverage: number;
}

/**
 * Option E's interval (owner-approved as policy, 2026-09-21): the distribution-free order-statistic
 * interval for a median, [x(k), x(n+1−k)] with k the largest integer such that P(Bin(n, ½) ≤ k − 1) ≤ 2.5 %.
 * Assumes the values are independent draws from one continuous distribution. Assumes nothing about its
 * shape, which is why it suits skewed or bimodal round deltas. Returns undefined when n ≤ 5, because
 * then no interval of ≥ 95 % exists.
 */
export function medianInterval(values: readonly number[]): MedianInterval | undefined {
  const xs = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const n = xs.length;
  let k = 0;
  let cdf = 0;
  let term = 0.5 ** n; // P(X = 0)
  while (cdf + term <= 0.025) {
    cdf += term;
    k += 1;
    term = (term * (n - k + 1)) / k; // P(X = k)
  }
  return k === 0 ? undefined : { low: xs[k - 1], high: xs[n - k], coverage: 1 - 2 * cdf };
}

export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";

/** PASS when the whole interval is within the ceiling, FAIL when all of it is above, else INCONCLUSIVE. */
export function threeWayVerdict(interval: Pick<MedianInterval, "low" | "high"> | undefined, limit: number): Verdict {
  if (!interval) return "INCONCLUSIVE";
  if (interval.high <= limit) return "PASS";
  return interval.low > limit ? "FAIL" : "INCONCLUSIVE";
}

/** A paired-delta ceiling. INCOMPLETE (a round lost its data) is a harness failure, never noise. */
export function judgePaired(deltas: readonly number[], expectedRounds: number, limit: number): { verdict: Verdict | "INCOMPLETE"; interval?: MedianInterval } {
  if (deltas.length !== expectedRounds || deltas.some((delta) => !Number.isFinite(delta))) return { verdict: "INCOMPLETE" };
  const interval = medianInterval(deltas);
  return { verdict: threeWayVerdict(interval, limit), interval };
}

/**
 * - `gating`: the verdicts decide the exit code.
 * - `gateNotRun`: a gate invocation moved off the approved configuration, so it is exit 2 and never a PASS.
 * - `--saturated` is the informational run: never gating, never "not run".
 */
export function gateConfiguration(rounds: number, instances: number, saturated: boolean): { gating: boolean; gateNotRun: boolean } {
  const approved = rounds === APPROVED_GATE.rounds && instances === APPROVED_GATE.instances;
  return { gating: !saturated && approved, gateNotRun: !saturated && !approved };
}

/** The owner's p95 rule: binding only on the gate, and only once EACH mode has ≥ 21 samples. */
export function p95IsBinding(gating: boolean, samplesOn: number, samplesOff: number): boolean {
  return gating && samplesOn >= P95_MIN_SAMPLES && samplesOff >= P95_MIN_SAMPLES;
}

/** 1 = FAIL (or nothing passed), 2 = INCONCLUSIVE or gate NOT RUN, 0 = PASS. FAIL dominates. */
export function gateExitCode(counts: { passed: number; failed: number; inconclusive: number; gateNotRun: boolean }): 0 | 1 | 2 {
  if (counts.failed > 0 || counts.passed === 0) return 1;
  return counts.inconclusive > 0 || counts.gateNotRun ? 2 : 0;
}

/**
 * Append one run to `{ runs: [...] }`, preserving every earlier run as written. A file that is not that
 * shape throws BEFORE anything is written, so unreadable evidence is never replaced.
 */
export function appendEvidenceRun(path: string, record: unknown): number {
  let runs: unknown[] = [];
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { runs?: unknown };
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.runs)) throw new Error(`${path} is not { runs: [...] }; refusing to overwrite it`);
    runs = parsed.runs;
  }
  writeFileSync(path, `${JSON.stringify({ runs: [...runs, record] }, null, 2)}\n`, "utf8");
  return runs.length + 1;
}
