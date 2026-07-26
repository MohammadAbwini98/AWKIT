// Leak detection for an RSS sample series (bd awkit-cww).
//
// Lives in its own module with NO side effects so the statistic can be imported and exercised
// directly. It previously sat inside scripts/benchmark-oracle-jdbc.mts, whose top-level `main()`
// starts a 30-minute soak on import — which makes the statistic effectively untestable.

export interface RssTrend {
  samples: number;
  /** `last - first`. Retained as a DIAGNOSTIC only — it is not the pass/fail criterion. */
  endpointDeltaMb: number;
  /** Least-squares slope over all samples, MB per sample. Diagnostic. */
  slopeMbPerSample: number;
  /** Slope extrapolated across the run, MB. Diagnostic. */
  slopeTotalMb: number;
  /** Lowest RSS in the first third — the baseline the allocator returns to. */
  floorStartMb: number;
  /** Lowest RSS in the last third. */
  floorEndMb: number;
  /** `floorEndMb - floorStartMb`. THE pass/fail criterion. Signed: only a RISE indicates a leak. */
  floorRiseMb: number;
  peakMb: number;
}

/**
 * Summarise an RSS series for leak detection.
 *
 * The pass/fail criterion is the rise of the FLOOR, not the endpoint delta and not the slope.
 * Under sustained allocation a healthy process traces a GC sawtooth: peaks climb and fall, but the
 * troughs return to a stable baseline because memory is actually reclaimed. A leak is precisely the
 * case where the process can no longer get back down — the floor itself rises.
 *
 * The two rejected alternatives, and why:
 *
 * - `last - first` (the original check) samples two arbitrary points of a sawtooth. Whether it
 *   passes depends on where the final sample happens to land in a GC cycle; the same run can pass
 *   or fail on noise alone.
 * - Least-squares slope over the raw series is dominated by PEAK amplitude. Transient peaks growing
 *   under load is not the same as memory being retained, so slope alone over-reports.
 *
 * Both are still computed and recorded, because a disagreement between them is informative — but
 * only `floorRiseMb` decides the gate.
 *
 * `floorRiseMb` is SIGNED on purpose. Comparing its absolute value (as the original endpoint check
 * did) fails a process whose floor *falls* — normal after warmup caches are released — and that
 * mistake was caught by the "decreasing" negative control, not by review.
 */
export function rssTrend(series: readonly number[]): RssTrend {
  const n = series.length;
  if (n < 2) {
    const only = series[0] ?? 0;
    return {
      samples: n,
      endpointDeltaMb: 0,
      slopeMbPerSample: 0,
      slopeTotalMb: 0,
      floorStartMb: only,
      floorEndMb: only,
      floorRiseMb: 0,
      peakMb: only
    };
  }
  const meanX = (n - 1) / 2;
  const meanY = series.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  series.forEach((y, i) => {
    num += (i - meanX) * (y - meanY);
    den += (i - meanX) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  // At least one sample per window, and never overlapping windows on a short series.
  const window = Math.max(1, Math.min(Math.floor(n / 3), Math.floor(n / 2)));
  const floorStart = Math.min(...series.slice(0, window));
  const floorEnd = Math.min(...series.slice(n - window));
  return {
    samples: n,
    endpointDeltaMb: series[n - 1] - series[0],
    slopeMbPerSample: Number(slope.toFixed(2)),
    slopeTotalMb: Math.round(slope * n),
    floorStartMb: floorStart,
    floorEndMb: floorEnd,
    floorRiseMb: floorEnd - floorStart,
    peakMb: Math.max(...series)
  };
}

/**
 * A leak is an upward rise of the floor beyond `budgetMb`. Deliberately NOT `Math.abs`.
 * A series shorter than two samples cannot show a trend and is treated as a pass.
 */
export function rssFloorWithinBudget(trend: RssTrend, budgetMb: number): boolean {
  if (trend.samples < 2) return true;
  return trend.floorRiseMb < budgetMb;
}
