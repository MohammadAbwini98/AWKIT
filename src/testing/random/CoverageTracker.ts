/**
 * Coverage accounting for the Randomized Automation Test Lab.
 *
 * Tracks, per dimension and per key, how far a thing got through the pipeline:
 * generated → configured → serialized → deserialized → rendered → executed → passed.
 *
 * The `blocked` stage is the important one. When a node type, connector mode or report format
 * cannot be exercised because the capability does not exist yet (see
 * `docs/testing/RANDOMIZED_TESTING_ARCHITECTURE.md` §6), the lab records it as *blocked with a
 * reason* rather than quietly omitting it. A campaign that silently skips a dimension looks the
 * same as one that covers it; a blocked entry does not.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */

/** What kind of thing is being covered. */
export type CoverageDimension =
  | "nodeType"
  | "connectorKind"
  | "edgeType"
  | "conditionOperator"
  | "conditionSource"
  | "joinMode"
  | "failMode"
  | "isolationMode"
  | "loopMode"
  | "flowPattern"
  | "valueSourceType"
  | "locatorStrategy"
  | "waitConditionType"
  | "executionMode"
  | "concurrencyLevel"
  | "mutationKind";

/**
 * Pipeline stages. Ordered loosely from cheapest to most expensive to reach; nothing enforces the
 * order, because a campaign that only runs Phases 1–3 legitimately never reaches `executed`.
 */
export type CoverageStage =
  | "generated"
  | "configured"
  | "serialized"
  | "deserialized"
  | "rendered"
  | "executed"
  | "passed"
  | "failedAsExpected"
  | "retried"
  | "concurrent";

export const ALL_COVERAGE_STAGES: readonly CoverageStage[] = [
  "generated",
  "configured",
  "serialized",
  "deserialized",
  "rendered",
  "executed",
  "passed",
  "failedAsExpected",
  "retried",
  "concurrent"
];

export interface CoverageEntry {
  readonly dimension: CoverageDimension;
  readonly key: string;
  readonly counts: Readonly<Record<CoverageStage, number>>;
  /** Set when the key cannot be exercised at all. Mutually informative with zero counts. */
  readonly blockedReason?: string;
}

export interface CoverageGap {
  readonly dimension: CoverageDimension;
  readonly key: string;
  readonly stage: CoverageStage;
  /** Present when the gap is explained by a known missing capability rather than a generator bug. */
  readonly blockedReason?: string;
}

export interface CoverageSnapshot {
  readonly entries: readonly CoverageEntry[];
  readonly blocked: readonly CoverageEntry[];
}

function emptyCounts(): Record<CoverageStage, number> {
  return {
    generated: 0,
    configured: 0,
    serialized: 0,
    deserialized: 0,
    rendered: 0,
    executed: 0,
    passed: 0,
    failedAsExpected: 0,
    retried: 0,
    concurrent: 0
  };
}

interface MutableEntry {
  dimension: CoverageDimension;
  key: string;
  counts: Record<CoverageStage, number>;
  blockedReason?: string;
}

export class CoverageTracker {
  private readonly entries = new Map<string, MutableEntry>();

  private static id(dimension: CoverageDimension, key: string): string {
    return `${dimension}::${key}`;
  }

  private entry(dimension: CoverageDimension, key: string): MutableEntry {
    const id = CoverageTracker.id(dimension, key);
    let existing = this.entries.get(id);
    if (!existing) {
      existing = { dimension, key, counts: emptyCounts() };
      this.entries.set(id, existing);
    }
    return existing;
  }

  /** Count one occurrence of `key` reaching `stage`. */
  record(dimension: CoverageDimension, key: string, stage: CoverageStage, times = 1): void {
    this.entry(dimension, key).counts[stage] += times;
  }

  /** Convenience for the common "generated and configured in one go" case. */
  recordGenerated(dimension: CoverageDimension, key: string): void {
    const entry = this.entry(dimension, key);
    entry.counts.generated += 1;
    entry.counts.configured += 1;
  }

  /**
   * Mark a key as impossible to exercise, with the reason. Registering a blocked key also makes it
   * visible in the snapshot even though it has zero counts — that is the entire point.
   */
  block(dimension: CoverageDimension, key: string, reason: string): void {
    this.entry(dimension, key).blockedReason = reason;
  }

  /** Total occurrences of `key` at `stage`, or 0 when never recorded. */
  count(dimension: CoverageDimension, key: string, stage: CoverageStage): number {
    return this.entries.get(CoverageTracker.id(dimension, key))?.counts[stage] ?? 0;
  }

  isBlocked(dimension: CoverageDimension, key: string): boolean {
    return this.entries.get(CoverageTracker.id(dimension, key))?.blockedReason !== undefined;
  }

  /**
   * Keys from `universe` that never reached `stage` at least `minimum` times.
   *
   * Blocked keys are still returned — with their reason attached — so a caller can decide whether
   * a gap is an accepted limitation or a coverage failure. They are never filtered out silently.
   */
  gaps(
    dimension: CoverageDimension,
    universe: readonly string[],
    stage: CoverageStage,
    minimum = 1
  ): CoverageGap[] {
    return universe
      .filter((key) => this.count(dimension, key, stage) < minimum)
      .map((key) => {
        const blockedReason = this.entries.get(CoverageTracker.id(dimension, key))?.blockedReason;
        return blockedReason === undefined
          ? { dimension, key, stage }
          : { dimension, key, stage, blockedReason };
      });
  }

  /** Gaps that are not explained by a known missing capability — i.e. real coverage failures. */
  unexplainedGaps(
    dimension: CoverageDimension,
    universe: readonly string[],
    stage: CoverageStage,
    minimum = 1
  ): CoverageGap[] {
    return this.gaps(dimension, universe, stage, minimum).filter((gap) => gap.blockedReason === undefined);
  }

  snapshot(): CoverageSnapshot {
    const all = [...this.entries.values()]
      .map<CoverageEntry>((entry) =>
        entry.blockedReason === undefined
          ? { dimension: entry.dimension, key: entry.key, counts: { ...entry.counts } }
          : {
              dimension: entry.dimension,
              key: entry.key,
              counts: { ...entry.counts },
              blockedReason: entry.blockedReason
            }
      )
      .sort((a, b) => (a.dimension === b.dimension ? a.key.localeCompare(b.key) : a.dimension.localeCompare(b.dimension)));

    return { entries: all, blocked: all.filter((entry) => entry.blockedReason !== undefined) };
  }

  /** Fold another tracker in — used when parallel campaign shards report back. */
  merge(other: CoverageTracker): void {
    for (const entry of other.entries.values()) {
      const target = this.entry(entry.dimension, entry.key);
      for (const stage of ALL_COVERAGE_STAGES) {
        target.counts[stage] += entry.counts[stage];
      }
      if (entry.blockedReason !== undefined && target.blockedReason === undefined) {
        target.blockedReason = entry.blockedReason;
      }
    }
  }
}
