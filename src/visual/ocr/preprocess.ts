import type { VisualImage } from "../png";

/**
 * OCR preprocessing (Phase N, N7.2 / awkit-vra.9.4). PURE: no I/O, no clock, no randomness, no engine. Plan:
 * docs/plans/ai-upgrade-v5/N7-ocr-text-in-image.md (OC-0 to OC-12, ratified 2026-10-26).
 *
 * It turns an in-memory element crop (RGBA, from the N0 guarded capture) into one grayscale plane the engine reads:
 *   - alpha is composited over white, then luma is taken with integer BT.601 weights;
 *   - the crop is scaled UP so the text's x-height reaches the floor (OCR_MIN_X_HEIGHT_PX), using the element's CSS font
 *     size and the device pixel ratio supplied by the caller; the factor is rounded up to a quarter step;
 *   - nothing is binarized, and nothing is ever scaled down.
 *
 * Fail closed: a clipped region, a region smaller than the minimum, text so small that the factor would exceed
 * OCR_MAX_SCALE, or an output larger than OCR_MAX_OUTPUT_PIXELS is refused with a code (never shrunk below the floor).
 */

export const OCR_PREPROCESS_VERSION = 1;
/** The x-height floor in device pixels after scaling (plan, Architecture). */
export const OCR_MIN_X_HEIGHT_PX = 20;
/** The x-height as a fraction of the CSS font size, for typical Latin UI faces. */
export const OCR_X_HEIGHT_RATIO = 0.5;
/** OC-9: at most 1.0 MP after scaling. */
export const OCR_MAX_OUTPUT_PIXELS = 1_000_000;
/** Text needing more than this factor is too small to read reliably. */
export const OCR_MAX_SCALE = 4;
/** A crop narrower or shorter than this, in device pixels, holds no readable text. */
export const OCR_MIN_REGION_PX = 8;

export type OcrPreprocessRefusal = "region-clipped" | "region-too-small" | "region-too-large" | "input-invalid";

export interface OcrPreprocessInput {
  image: VisualImage;
  /** Computed CSS font size of the target element, in CSS pixels. */
  fontSizeCssPx: number;
  devicePixelRatio: number;
  /** True when the element's box was clipped by the viewport or an ancestor. */
  clipped?: boolean;
}

export type OcrPreprocessResult =
  | { ok: true; version: 1; width: number; height: number; scale: number; gray: Uint8Array }
  | { ok: false; version: 1; code: OcrPreprocessRefusal };

const refuse = (code: OcrPreprocessRefusal): OcrPreprocessResult => ({ ok: false, version: 1, code });

function validImage(image: unknown): image is VisualImage {
  if (!image || typeof image !== "object") return false;
  const { width, height, data } = image as { width: unknown; height: unknown; data: unknown };
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    (width as number) > 0 &&
    (height as number) > 0 &&
    data instanceof Uint8Array &&
    data.length === (width as number) * (height as number) * 4
  );
}

/** The scale factor, rounded up to a quarter step, that lifts the x-height to the floor; 1 when it already does. */
export function ocrScaleFor(fontSizeCssPx: number, devicePixelRatio: number): number {
  const xHeight = fontSizeCssPx * OCR_X_HEIGHT_RATIO * devicePixelRatio;
  if (xHeight >= OCR_MIN_X_HEIGHT_PX) return 1;
  return Math.ceil((OCR_MIN_X_HEIGHT_PX / xHeight) * 4) / 4;
}

/** Luma of RGBA composited over white, integer BT.601 weights, row-major. */
export function grayscaleOverWhite(image: VisualImage): Uint8Array {
  const { data } = image;
  const out = new Uint8Array(image.width * image.height);
  for (let p = 0, i = 0; p < out.length; p += 1, i += 4) {
    const a = data[i + 3];
    const r = Math.floor((data[i] * a + 255 * (255 - a) + 127) / 255);
    const g = Math.floor((data[i + 1] * a + 255 * (255 - a) + 127) / 255);
    const b = Math.floor((data[i + 2] * a + 255 * (255 - a) + 127) / 255);
    out[p] = Math.floor((299 * r + 587 * g + 114 * b + 500) / 1000);
  }
  return out;
}

/** Bilinear resample of a grayscale plane to an exact size (pixel-centre aligned, edge-clamped). */
function resize(gray: Uint8Array, width: number, height: number, outW: number, outH: number): Uint8Array {
  const out = new Uint8Array(outW * outH);
  const sx = width / outW;
  const sy = height / outH;
  for (let y = 0; y < outH; y += 1) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, height - 1);
    const wy = fy - y0;
    for (let x = 0; x < outW; x += 1) {
      const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, width - 1);
      const wx = fx - x0;
      const top = gray[y0 * width + x0] * (1 - wx) + gray[y0 * width + x1] * wx;
      const bottom = gray[y1 * width + x0] * (1 - wx) + gray[y1 * width + x1] * wx;
      out[y * outW + x] = Math.round(top * (1 - wy) + bottom * wy);
    }
  }
  return out;
}

export function preprocessForOcr(input: OcrPreprocessInput): OcrPreprocessResult {
  if (!input || typeof input !== "object" || !validImage(input.image)) return refuse("input-invalid");
  const { fontSizeCssPx, devicePixelRatio } = input;
  if (typeof fontSizeCssPx !== "number" || !Number.isFinite(fontSizeCssPx) || fontSizeCssPx <= 0 || fontSizeCssPx > 1000) return refuse("input-invalid");
  if (typeof devicePixelRatio !== "number" || !Number.isFinite(devicePixelRatio) || devicePixelRatio < 0.25 || devicePixelRatio > 8) return refuse("input-invalid");
  if (input.clipped !== undefined && typeof input.clipped !== "boolean") return refuse("input-invalid");
  if (input.clipped === true) return refuse("region-clipped");
  const { width, height } = input.image;
  if (width < OCR_MIN_REGION_PX || height < OCR_MIN_REGION_PX) return refuse("region-too-small");
  if (width * height > OCR_MAX_OUTPUT_PIXELS) return refuse("region-too-large");
  const scale = ocrScaleFor(fontSizeCssPx, devicePixelRatio);
  if (scale > OCR_MAX_SCALE) return refuse("region-too-small");
  const outW = Math.round(width * scale);
  const outH = Math.round(height * scale);
  if (outW * outH > OCR_MAX_OUTPUT_PIXELS) return refuse("region-too-large");
  const gray = grayscaleOverWhite(input.image);
  return { ok: true, version: 1, width: outW, height: outH, scale, gray: scale === 1 ? gray : resize(gray, width, height, outW, outH) };
}
