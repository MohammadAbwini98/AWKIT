/**
 * N9 (awkit-vra.11): the acceptance criteria S-1 to S-5 of docs/plans/ai-upgrade-v5/N9-screenshot-state-recognition.md
 * § 5, as a pure function shared by `benchmark:visual-state` and `verify:visual-state`. The numbers are frozen in
 * `N9_FROZEN_CRITERIA` (plan § 6) before the qualifying campaign and are never changed by its results.
 */

export type StateTruth = "loading" | "empty" | "error" | "ready" | "unknown";
export type StateDecision = "loading" | "empty" | "error" | "ready" | "unknown" | "skipped" | "none";

export interface StateTrial {
  fixture: string;
  truth: StateTruth;
  adversarial: boolean;
  decided: StateDecision;
  /** Time the state work added to the diagnosis (ms), or null when it did not run. */
  stateMs: number | null;
  /** The record arrived after the deadline (must never happen). */
  late?: boolean;
}

export interface StateCriteria {
  /** S-2: false-error rate over non-error trials, permille. */
  falseErrorCeilingPermille: number;
  /** S-2: the most a single non-error fixture may be decided `error`, as a fraction of its trials (permille). */
  falseErrorPerFixturePermille: number;
  /** S-3: recall floors per positive state, permille. */
  recallFloorPermille: Record<"loading" | "empty" | "error" | "ready", number>;
  /** S-4: non-unknown decisions over positive-truth trials, permille. */
  decidedFloorPermille: number;
  /** S-5: p95 of the state work, ms. */
  p95BudgetMs: number;
}

export interface StateCriterionResult {
  id: "S-1" | "S-2" | "S-3" | "S-4" | "S-5";
  state?: "loading" | "empty" | "error" | "ready";
  met: boolean;
  observed: string;
}

const permille = (part: number, whole: number): number => (whole > 0 ? Math.floor((part * 1000) / whole) : 0);

export function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

export function evaluateStateCriteria(trials: readonly StateTrial[], criteria: StateCriteria): StateCriterionResult[] {
  const results: StateCriterionResult[] = [];
  const loading = trials.filter((t) => t.truth === "loading");
  const falseReady = loading.filter((t) => t.decided === "ready").length;
  results.push({ id: "S-1", met: loading.length > 0 && falseReady === 0, observed: `${falseReady} ready of ${loading.length} loading-truth trials` });

  const nonError = trials.filter((t) => t.truth !== "error");
  const falseError = nonError.filter((t) => t.decided === "error").length;
  const byFixture = new Map<string, { n: number; err: number }>();
  for (const t of nonError) {
    const entry = byFixture.get(t.fixture) ?? { n: 0, err: 0 };
    entry.n += 1;
    if (t.decided === "error") entry.err += 1;
    byFixture.set(t.fixture, entry);
  }
  const worst = [...byFixture.entries()].map(([fixture, e]) => ({ fixture, p: permille(e.err, e.n) })).sort((a, b) => b.p - a.p)[0];
  results.push({
    id: "S-2",
    met: nonError.length > 0 && permille(falseError, nonError.length) <= criteria.falseErrorCeilingPermille && (worst?.p ?? 0) <= criteria.falseErrorPerFixturePermille,
    observed: `${falseError} error of ${nonError.length} non-error trials (${permille(falseError, nonError.length)}‰), worst fixture ${worst ? `${worst.fixture} ${worst.p}‰` : "none"}`
  });

  for (const state of ["loading", "empty", "error", "ready"] as const) {
    const positives = trials.filter((t) => t.truth === state);
    const hits = positives.filter((t) => t.decided === state).length;
    results.push({
      id: "S-3",
      state,
      met: positives.length > 0 && permille(hits, positives.length) >= criteria.recallFloorPermille[state],
      observed: `${hits} of ${positives.length} (${permille(hits, positives.length)}‰, floor ${criteria.recallFloorPermille[state]}‰)`
    });
  }

  const positive = trials.filter((t) => t.truth !== "unknown");
  const decided = positive.filter((t) => t.decided === "loading" || t.decided === "empty" || t.decided === "error" || t.decided === "ready").length;
  results.push({
    id: "S-4",
    met: positive.length > 0 && permille(decided, positive.length) >= criteria.decidedFloorPermille,
    observed: `${decided} decided of ${positive.length} positive-truth trials (${permille(decided, positive.length)}‰)`
  });

  const times = trials.map((t) => t.stateMs).filter((ms): ms is number => typeof ms === "number");
  const tail = p95(times);
  const late = trials.filter((t) => t.late).length;
  results.push({
    id: "S-5",
    met: tail !== null && tail <= criteria.p95BudgetMs && late === 0,
    observed: `p95 ${tail ?? "n/a"} ms over ${times.length} runs (budget ${criteria.p95BudgetMs} ms), ${late} late`
  });
  return results;
}

/**
 * Plan § 6: FROZEN 2026-10-31 from the development baseline (variant `a`, headless DPR 1, 1.25 and 2, 156 scored
 * trials), committed before any qualification trial ran. The development figures were loading 833‰, empty 1000‰,
 * error 750‰, ready 888‰, false ready 0, false error 0 and state-work p95 471 ms. Each floor sits below its development
 * figure to allow for held-out variance, but far above zero.
 */
export const N9_FROZEN_CRITERIA: { frozen: boolean; frozenAt: string | null; criteria: StateCriteria } = {
  frozen: true,
  frozenAt: "2026-10-31",
  criteria: {
    falseErrorCeilingPermille: 20,
    falseErrorPerFixturePermille: 333,
    recallFloorPermille: { loading: 700, empty: 600, error: 600, ready: 700 },
    decidedFloorPermille: 750,
    p95BudgetMs: 600
  }
};
