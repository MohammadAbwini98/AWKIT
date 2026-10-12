import { visualFailure, visualSuccess, type VisualResult } from "./errors";
import { VISUAL_FINGERPRINT_GRID, VISUAL_FINGERPRINT_VERSION, type VisualFingerprint } from "./fingerprint";

/**
 * Fingerprint comparison (Phase N, N1 / awkit-vra.3.1).
 *
 * ADVISORY ONLY. A visual similarity score is evidence for a person reading a report; it MUST NOT cause a Playwright
 * click, fill, selector replacement or locator recovery, and it is not an identity check — look-alike controls score
 * high. The result therefore carries no "match" decision and no threshold, and `advisory` is always `true`.
 *
 * The score is computed in integer basis points so it is identical across runs: 40% difference-hash agreement, 40%
 * luma-grid agreement, 20% edge-grid agreement. Only pixel-identical images (equal `contentDigest`) score 1; any other
 * pair is capped at 0.9999.
 */

export interface VisualComparison {
  advisory: true;
  version: typeof VISUAL_FINGERPRINT_VERSION;
  /** Equal content digests: the two images are pixel-identical. */
  identical: boolean;
  sameSize: boolean;
  /** Hamming distance between the difference hashes, 0-64. */
  dHashDistance: number;
  /** Mean absolute difference of the luma grids, 0-255, floored. */
  gridDistance: number;
  /** Mean absolute difference of the edge grids, 0-255, floored. */
  edgeDistance: number;
  meanLumaDelta: number;
  /** 0-1 in steps of 0.0001. Advisory; never a decision. */
  score: number;
}

const CELLS = VISUAL_FINGERPRINT_GRID * VISUAL_FINGERPRINT_GRID;

function decodeGrid(encoded: unknown): Uint8Array | null {
  if (typeof encoded !== "string") return null;
  const bytes = Buffer.from(encoded, "base64");
  return bytes.length === CELLS ? new Uint8Array(bytes) : null;
}

function wellFormed(fingerprint: VisualFingerprint): boolean {
  return (
    Number.isInteger(fingerprint.width) &&
    Number.isInteger(fingerprint.height) &&
    Number.isInteger(fingerprint.meanLuma) &&
    fingerprint.gridSize === VISUAL_FINGERPRINT_GRID &&
    typeof fingerprint.dHash === "string" &&
    /^[0-9a-f]{16}$/.test(fingerprint.dHash) &&
    typeof fingerprint.contentDigest === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(fingerprint.contentDigest)
  );
}

function hamming(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

function absoluteDifferenceSum(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum;
}

/** Compare two fingerprints. Never throws; a version mismatch or a malformed fingerprint is a typed failure. */
export function compareVisualFingerprints(a: VisualFingerprint, b: VisualFingerprint): VisualResult<VisualComparison> {
  if (!a || !b || a.version !== VISUAL_FINGERPRINT_VERSION || b.version !== VISUAL_FINGERPRINT_VERSION) {
    return visualFailure("UNSUPPORTED_FINGERPRINT_VERSION", "the fingerprints were not produced by this fingerprint version");
  }
  const gridA = decodeGrid(a.grid);
  const gridB = decodeGrid(b.grid);
  const edgeA = decodeGrid(a.edgeGrid);
  const edgeB = decodeGrid(b.edgeGrid);
  if (!wellFormed(a) || !wellFormed(b) || !gridA || !gridB || !edgeA || !edgeB) {
    return visualFailure("FINGERPRINT_FAILED", "a fingerprint is malformed");
  }

  const identical = a.contentDigest === b.contentDigest;
  const dHashDistance = hamming(a.dHash, b.dHash);
  const gridSum = absoluteDifferenceSum(gridA, gridB);
  const edgeSum = absoluteDifferenceSum(edgeA, edgeB);

  // score = 0.4 * (64 - h) / 64 + 0.4 * (1 - gridSum / (255 * CELLS)) + 0.2 * (1 - edgeSum / (255 * CELLS)), in basis
  // points over a common integer denominator (at most about 4.2e11, well inside exact double range).
  const full = 255 * CELLS;
  const numerator = 4 * (64 - dHashDistance) * full + 4 * (full - gridSum) * 64 + 2 * (full - edgeSum) * 64;
  const denominator = 10 * 64 * full;
  const basisPoints = identical ? 10000 : Math.min(9999, Math.floor((numerator * 10000) / denominator));

  return visualSuccess({
    advisory: true,
    version: VISUAL_FINGERPRINT_VERSION,
    identical,
    sameSize: a.width === b.width && a.height === b.height,
    dHashDistance,
    gridDistance: Math.floor(gridSum / CELLS),
    edgeDistance: Math.floor(edgeSum / CELLS),
    meanLumaDelta: Math.abs(a.meanLuma - b.meanLuma),
    score: basisPoints / 10000
  });
}
