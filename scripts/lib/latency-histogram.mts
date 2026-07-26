// Bounded-memory latency percentiles for the Oracle soak (bd awkit-q0e).
//
// The soak previously pushed one element into a plain array PER QUERY. At 18.2M queries that array
// alone measured 502 MB of live data against a 30 MB baseline — so the harness's own accounting
// dominated the memory signal the soak exists to check. A live run, where `dbTimes` is also
// populated, would roughly double it.
//
// A histogram costs O(1) memory regardless of query count. Resolution is chosen so the percentiles
// the soak actually asserts (p50/p95/p99, observed p50 = 1 ms) stay exact:
//
//   0 … 9,999 ms   → 1 ms buckets    (10,000 entries) — exact to the millisecond
//   10 s … 99.9 s  → 100 ms buckets  (900 entries)    — ±100 ms, well past any asserted percentile
//   ≥ 100 s        → one overflow bucket
//
// ~10,900 numbers ≈ 87 KB, flat forever. `max` is tracked exactly, so the artifact's `max` field
// keeps its previous meaning rather than degrading to a bucket edge.

const FINE_LIMIT_MS = 10_000;
const COARSE_LIMIT_MS = 100_000;
const COARSE_BUCKET_MS = 100;
const COARSE_COUNT = (COARSE_LIMIT_MS - FINE_LIMIT_MS) / COARSE_BUCKET_MS; // 900

export class LatencyHistogram {
  /** 1 ms buckets for 0..9,999 ms. */
  private readonly fine = new Float64Array(FINE_LIMIT_MS);
  /** 100 ms buckets for 10,000..99,999 ms. */
  private readonly coarse = new Float64Array(COARSE_COUNT);
  private overflow = 0;
  private total = 0;
  private maxMs = 0;

  record(ms: number): void {
    if (!Number.isFinite(ms)) return;
    const v = ms < 0 ? 0 : Math.floor(ms);
    this.total += 1;
    if (v > this.maxMs) this.maxMs = v;
    if (v < FINE_LIMIT_MS) this.fine[v] += 1;
    else if (v < COARSE_LIMIT_MS) this.coarse[Math.floor((v - FINE_LIMIT_MS) / COARSE_BUCKET_MS)] += 1;
    else this.overflow += 1;
  }

  get count(): number {
    return this.total;
  }

  get max(): number {
    return this.maxMs;
  }

  /**
   * Nearest-rank percentile over the same ordering the previous sorted-array `pct()` used:
   * index = floor((p/100) * count), clamped to the last element. Matching that indexing keeps
   * historical artifact values comparable across the change.
   */
  percentile(p: number): number {
    if (this.total === 0) return 0;
    const target = Math.min(this.total - 1, Math.floor((p / 100) * this.total));
    let seen = 0;
    for (let i = 0; i < this.fine.length; i += 1) {
      seen += this.fine[i];
      if (seen > target) return i;
    }
    for (let i = 0; i < this.coarse.length; i += 1) {
      seen += this.coarse[i];
      if (seen > target) return FINE_LIMIT_MS + i * COARSE_BUCKET_MS;
    }
    // Overflow bucket. Every other branch returns its bucket's LOWER edge, so this does too —
    // returning `maxMs` here would report the single worst sample as though it were the percentile,
    // which reads as a far larger regression than the data supports. Resolution above
    // COARSE_LIMIT_MS is deliberately abandoned; `max` remains exact for anyone who needs the tail.
    return COARSE_LIMIT_MS;
  }
}
