/**
 * N8 (awkit-vra.10): the acceptance criteria R-1 to R-5 of docs/plans/ai-upgrade-v5/N8-row-grid-intelligence.md § 4,
 * as a pure function shared by `benchmark:visual-rows` and `verify:visual-rows`. The numbers are frozen in
 * `N8_FROZEN_CRITERIA` (plan § 5) before the qualifying campaign and never changed by its results.
 */

export interface RowsTrial {
  fixture: string;
  adversarial: boolean;
  truthAssociation: "consistent" | "inconclusive" | "none";
  truthStructure: "look-alike" | "distinct" | "inconclusive" | "not-examined" | "any";
  truthCoverage: "full" | "partly" | "none";
  /** The record's row codes. */
  codes: string[];
  rowMs: number | null;
  late?: boolean;
}

export interface RowsCriteria {
  associationFloorPermille: number;
  alikeFloorPermille: number;
  alikeOnDistinctCeilingPermille: number;
  p95BudgetMs: number;
}

export interface RowsCriterionResult {
  id: "R-1" | "R-2" | "R-3" | "R-4" | "R-5";
  part?: string;
  met: boolean;
  observed: string;
}

const permille = (part: number, whole: number): number => (whole > 0 ? Math.floor((part * 1000) / whole) : 0);

export function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

export function evaluateRowsCriteria(trials: readonly RowsTrial[], criteria: RowsCriteria): RowsCriterionResult[] {
  const results: RowsCriterionResult[] = [];
  const has = (t: RowsTrial, code: string) => t.codes.includes(code);
  const adversarial = trials.filter((t) => t.adversarial);
  const falseClaims = adversarial.filter((t) => has(t, "row-association-consistent")).length;
  results.push({ id: "R-1", met: adversarial.length > 0 && falseClaims === 0, observed: `${falseClaims} consistent claims in ${adversarial.length} adversarial trials` });

  const positives = trials.filter((t) => t.truthAssociation === "consistent");
  const claimed = positives.filter((t) => has(t, "row-association-consistent")).length;
  results.push({ id: "R-2", met: positives.length > 0 && permille(claimed, positives.length) >= criteria.associationFloorPermille, observed: `${claimed} of ${positives.length} (${permille(claimed, positives.length)}‰, floor ${criteria.associationFloorPermille}‰)` });

  const alikeTruth = trials.filter((t) => t.truthStructure === "look-alike");
  const alikeHits = alikeTruth.filter((t) => has(t, "rows-look-alike")).length;
  results.push({ id: "R-3", part: "look-alike recall", met: alikeTruth.length > 0 && permille(alikeHits, alikeTruth.length) >= criteria.alikeFloorPermille, observed: `${alikeHits} of ${alikeTruth.length} (${permille(alikeHits, alikeTruth.length)}‰, floor ${criteria.alikeFloorPermille}‰)` });
  const distinctTruth = trials.filter((t) => t.truthStructure === "distinct");
  const alikeOnDistinct = distinctTruth.filter((t) => has(t, "rows-look-alike")).length;
  results.push({ id: "R-3", part: "look-alike on distinct", met: distinctTruth.length > 0 && permille(alikeOnDistinct, distinctTruth.length) <= criteria.alikeOnDistinctCeilingPermille, observed: `${alikeOnDistinct} of ${distinctTruth.length} (${permille(alikeOnDistinct, distinctTruth.length)}‰, ceiling ${criteria.alikeOnDistinctCeilingPermille}‰)` });

  const partly = trials.filter((t) => t.truthCoverage === "partly");
  const partlyHits = partly.filter((t) => has(t, "rows-partly-examined")).length;
  const none = trials.filter((t) => t.truthCoverage === "none");
  const noneHits = none.filter((t) => has(t, "rows-not-examined") && !t.codes.some((c) => c.startsWith("row-association"))).length;
  results.push({ id: "R-4", met: partly.length > 0 && none.length > 0 && partlyHits === partly.length && noneHits === none.length, observed: `partly-examined ${partlyHits}/${partly.length}, not-examined ${noneHits}/${none.length}` });

  const times = trials.map((t) => t.rowMs).filter((ms): ms is number => typeof ms === "number");
  const tail = p95(times);
  const late = trials.filter((t) => t.late).length;
  results.push({ id: "R-5", met: tail !== null && tail <= criteria.p95BudgetMs && late === 0, observed: `p95 ${tail ?? "n/a"} ms over ${times.length} runs (budget ${criteria.p95BudgetMs} ms), ${late} late` });
  return results;
}

/**
 * Plan § 5: FROZEN 2026-10-31 from the development baseline (variant `a`, headless DPR 1, 1.25 and 2, 102 scored
 * trials), committed before any qualification trial. The development figures were association 66/66, 0 false claims
 * in 30 adversarial trials, look-alike 36/36, look-alike on distinct 0/12, coverage 18/18 and row-work p95 29 ms.
 */
export const N8_FROZEN_CRITERIA: { frozen: boolean; frozenAt: string | null; criteria: RowsCriteria } = {
  frozen: true,
  frozenAt: "2026-10-31",
  criteria: { associationFloorPermille: 800, alikeFloorPermille: 800, alikeOnDistinctCeilingPermille: 100, p95BudgetMs: 150 }
};
