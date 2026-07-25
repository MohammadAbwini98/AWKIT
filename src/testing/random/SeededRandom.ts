/**
 * Deterministic seeded randomness for the Randomized Automation Test Lab.
 *
 * Every generated campaign, workflow, flow, node and connector is derived from a seed so any
 * failure can be reproduced exactly:
 *
 *   npm run test:random -- --seed="<seed>"
 *
 * Uses `mulberry32` — the PRNG idiom already established in this repo by
 * `scripts/seed-observability-fixtures.mts` — so fixture and campaign determinism behave alike.
 *
 * Framework-agnostic (no Electron / React / Node built-ins) per `src/AGENTS.md`.
 */

/** 32-bit FNV-1a — turns an arbitrary seed string into a PRNG state without needing a hash lib. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A weighted choice entry. Weights are relative; non-positive weights are never selected. */
export interface WeightedOption<T> {
  readonly value: T;
  readonly weight: number;
}

/**
 * A reproducible random source.
 *
 * Two `SeededRandom` instances created with the same seed emit the identical sequence, and
 * `derive()` produces child streams that are stable regardless of how much the parent is consumed
 * afterwards — that matters because generation is tree-shaped (campaign → workflow → flow → node)
 * and we do not want adding a node to shift every later workflow.
 */
export class SeededRandom {
  private readonly next: () => number;

  private drawCount = 0;

  constructor(readonly seed: string) {
    this.next = mulberry32(hashSeed(seed));
  }

  /** How many raw draws have been taken — recorded in failure artifacts for diagnosis. */
  get draws(): number {
    return this.drawCount;
  }

  /** Float in `[0, 1)`. */
  float(): number {
    this.drawCount += 1;
    return this.next();
  }

  /** Integer in `[min, max]` inclusive. Throws when the range is inverted. */
  int(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error(`SeededRandom.int requires finite bounds, received [${min}, ${max}].`);
    }
    const low = Math.ceil(min);
    const high = Math.floor(max);
    if (high < low) {
      throw new Error(`SeededRandom.int requires max >= min, received [${min}, ${max}].`);
    }
    return low + Math.floor(this.float() * (high - low + 1));
  }

  /** `true` with the given probability (clamped to `[0, 1]`). */
  bool(probability = 0.5): boolean {
    const clamped = Math.min(1, Math.max(0, probability));
    return this.float() < clamped;
  }

  /** Uniform pick. Throws on an empty list so a miscount surfaces instead of yielding `undefined`. */
  pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new Error("SeededRandom.pick requires a non-empty array.");
    }
    return values[this.int(0, values.length - 1)] as T;
  }

  /**
   * Weighted pick — used for node-type and connector-type weights so a campaign can bias
   * generation toward whatever is under-covered.
   */
  pickWeighted<T>(options: readonly WeightedOption<T>[]): T {
    const eligible = options.filter((option) => option.weight > 0);
    if (eligible.length === 0) {
      throw new Error("SeededRandom.pickWeighted requires at least one option with weight > 0.");
    }
    const total = eligible.reduce((sum, option) => sum + option.weight, 0);
    let threshold = this.float() * total;
    for (const option of eligible) {
      threshold -= option.weight;
      if (threshold < 0) {
        return option.value;
      }
    }
    // Floating-point drift only; the last eligible option is the correct fallback.
    return eligible[eligible.length - 1]!.value;
  }

  /** `count` distinct items, or every item when `count` exceeds the pool. Order is randomized. */
  sample<T>(values: readonly T[], count: number): T[] {
    const shuffled = this.shuffle(values);
    return shuffled.slice(0, Math.max(0, Math.min(count, shuffled.length)));
  }

  /** Fisher-Yates over a copy — the input is never mutated. */
  shuffle<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = this.int(0, index);
      [result[index], result[swap]] = [result[swap] as T, result[index] as T];
    }
    return result;
  }

  /**
   * A child stream whose sequence depends only on `(parentSeed, label)`.
   *
   * Deriving does NOT consume the parent, so generation stays stable under edits: shrinking a
   * failing case by dropping one flow leaves every other flow byte-identical.
   */
  derive(label: string): SeededRandom {
    return new SeededRandom(`${this.seed}::${label}`);
  }
}

/**
 * Build a fresh campaign seed. Callers pass an explicit seed to reproduce; this is only used when
 * no seed was supplied. Kept human-typable so it survives a copy-paste out of a report.
 */
export function createCampaignSeed(prefix = "awkit", now: number = Date.now()): string {
  const stamp = new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const salt = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return `${prefix}-${stamp}-${salt}`;
}
