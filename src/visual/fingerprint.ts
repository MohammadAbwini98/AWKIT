import { createHash } from "node:crypto";

import { visualFailure, visualSuccess, type VisualResult } from "./errors";
import { VisualImage } from "./png";

/**
 * Deterministic visual fingerprints (Phase N, N1 / awkit-vra.3.1).
 *
 * Integer arithmetic only, so the same pixels give the same fingerprint on every run and every machine: Rec.601 luma
 * composited over white, its mean and variance, a 16x16 area-averaged luma grid, a 16x16 Sobel edge-energy grid, a
 * 64-bit difference hash and a SHA-256 digest of the exact RGBA bytes. The grids are base64 so a fingerprint stays a
 * small JSON value (`VISUAL_FINGERPRINT_MAX_BYTES`); it never contains, and cannot be decoded back to, the image.
 *
 * A fingerprint describes appearance, not identity: two look-alike controls fingerprint alike. Nothing here may pick,
 * click, fill or recover an element (see `compare.ts`).
 */

export const VISUAL_FINGERPRINT_VERSION = "awkit-vfp-1";
export const VISUAL_FINGERPRINT_GRID = 16;
/** Serialised size ceiling. A fingerprint is about 1 KB; the cap catches a format change that would bloat evidence. */
export const VISUAL_FINGERPRINT_MAX_BYTES = 1536;

export interface VisualFingerprint {
  version: typeof VISUAL_FINGERPRINT_VERSION;
  width: number;
  height: number;
  /** Mean luma, 0-255, rounded half up. */
  meanLuma: number;
  /** Population variance of luma, floored. */
  lumaVariance: number;
  gridSize: number;
  /** `gridSize`² area-averaged luma cells, row-major, base64. */
  grid: string;
  /** `gridSize`² mean Sobel edge-energy cells (0-255), row-major, base64. */
  edgeGrid: string;
  /** Mean edge energy across the whole image, 0-255. */
  meanEdge: number;
  /** 64-bit difference hash of a 9x8 luma thumbnail, 16 hex digits. */
  dHash: string;
  /** `sha256:` + hex digest of width, height and the RGBA bytes. Equal digests mean pixel-identical images. */
  contentDigest: string;
}

/** Luma over a white background, so transparent regions read as the page background rather than black. */
export function lumaOf(image: VisualImage): Uint8Array {
  const { width, height, data } = image;
  const luma = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    const y = Math.floor((299 * data[p] + 587 * data[p + 1] + 114 * data[p + 2] + 500) / 1000);
    const a = data[p + 3];
    luma[i] = a === 255 ? y : Math.floor((y * a + 255 * (255 - a) + 127) / 255);
  }
  return luma;
}

/** Integer cell bounds: every cell covers at least one source pixel, even when the image is smaller than the grid. */
function cellStart(index: number, cells: number, size: number): number {
  return Math.floor((index * size) / cells);
}

function cellEnd(index: number, cells: number, size: number): number {
  return Math.max(cellStart(index, cells, size) + 1, Math.floor(((index + 1) * size) / cells));
}

/** Area-average a single-channel plane into `cols` x `rows` cells, rounding half up. */
export function downsamplePlane(plane: Uint8Array, width: number, height: number, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    const y0 = cellStart(cy, rows, height);
    const y1 = cellEnd(cy, rows, height);
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cellStart(cx, cols, width);
      const x1 = cellEnd(cx, cols, width);
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) sum += plane[row + x];
      }
      const count = (x1 - x0) * (y1 - y0);
      out[cy * cols + cx] = Math.floor((sum + (count >> 1)) / count);
    }
  }
  return out;
}

/** Sobel edge energy, (|gx| + |gy|) / 8 clamped to 255; the one-pixel border has no full neighbourhood and is 0. */
export function edgePlane(luma: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = luma[i - width - 1];
      const t = luma[i - width];
      const tr = luma[i - width + 1];
      const l = luma[i - 1];
      const r = luma[i + 1];
      const bl = luma[i + width - 1];
      const b = luma[i + width];
      const br = luma[i + width + 1];
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      out[i] = Math.min(255, (Math.abs(gx) + Math.abs(gy)) >> 3);
    }
  }
  return out;
}

function differenceHash(luma: Uint8Array, width: number, height: number): string {
  const thumb = downsamplePlane(luma, width, height, 9, 8);
  let hex = "";
  for (let row = 0; row < 8; row++) {
    let nibbleHigh = 0;
    let nibbleLow = 0;
    for (let col = 0; col < 8; col++) {
      const bit = thumb[row * 9 + col] < thumb[row * 9 + col + 1] ? 1 : 0;
      if (col < 4) nibbleHigh = (nibbleHigh << 1) | bit;
      else nibbleLow = (nibbleLow << 1) | bit;
    }
    hex += nibbleHigh.toString(16) + nibbleLow.toString(16);
  }
  return hex;
}

function sha256Digest(image: VisualImage): string {
  const hash = createHash("sha256");
  hash.update(`${image.width}x${image.height}:`);
  hash.update(image.data);
  return `sha256:${hash.digest("hex")}`;
}

/** Compute a fingerprint. Never throws. */
export function fingerprintVisualImage(image: VisualImage): VisualResult<VisualFingerprint> {
  try {
    if (!(image instanceof VisualImage)) return visualFailure("FINGERPRINT_FAILED", "the input is not a decoded visual image");
    const { width, height } = image;
    const luma = lumaOf(image);
    const n = luma.length;

    let sum = 0;
    for (let i = 0; i < n; i++) sum += luma[i];
    // Variance in BigInt: n * sumSq can exceed 2^53 for a large screenshot, and floats would make it run-dependent.
    let sumSq = 0n;
    let rowSq = 0;
    for (let i = 0; i < n; i++) {
      rowSq += luma[i] * luma[i];
      if (rowSq > 2 ** 52) {
        sumSq += BigInt(rowSq);
        rowSq = 0;
      }
    }
    sumSq += BigInt(rowSq);
    const bigN = BigInt(n);
    const bigSum = BigInt(sum);
    const variance = Number((bigN * sumSq - bigSum * bigSum) / (bigN * bigN));

    const edges = edgePlane(luma, width, height);
    let edgeSum = 0;
    for (let i = 0; i < n; i++) edgeSum += edges[i];

    const fingerprint: VisualFingerprint = {
      version: VISUAL_FINGERPRINT_VERSION,
      width,
      height,
      meanLuma: Math.floor((sum + (n >> 1)) / n),
      lumaVariance: variance,
      gridSize: VISUAL_FINGERPRINT_GRID,
      grid: Buffer.from(downsamplePlane(luma, width, height, VISUAL_FINGERPRINT_GRID, VISUAL_FINGERPRINT_GRID)).toString("base64"),
      edgeGrid: Buffer.from(downsamplePlane(edges, width, height, VISUAL_FINGERPRINT_GRID, VISUAL_FINGERPRINT_GRID)).toString("base64"),
      meanEdge: Math.floor((edgeSum + (n >> 1)) / n),
      dHash: differenceHash(luma, width, height),
      contentDigest: sha256Digest(image)
    };
    if (JSON.stringify(fingerprint).length > VISUAL_FINGERPRINT_MAX_BYTES) {
      return visualFailure("FINGERPRINT_FAILED", "the fingerprint exceeds its size ceiling");
    }
    return visualSuccess(fingerprint);
  } catch {
    return visualFailure("FINGERPRINT_FAILED", "the fingerprint could not be computed");
  }
}
