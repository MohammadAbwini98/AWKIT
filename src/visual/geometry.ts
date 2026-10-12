/**
 * Coordinate mapping for Visual Intelligence (Phase N, N0).
 *
 * One canonical space: CSS pixels of the MAIN frame's viewport, which is what Playwright's `boundingBox()` reports
 * for an element in any frame (iframe offsets and inner scroll already applied) and what `page.screenshot()` covers.
 * The screenshot is in device pixels, so a CSS rectangle is scaled per axis by `imageSize / viewportCssSize` — the
 * MEASURED ratio, not `devicePixelRatio`, so fractional DPR is covered by the same arithmetic. Browser zoom is not: the
 * screenshot then disagrees with `devicePixelRatio` and is refused (see `scaleMatchesDevicePixelRatio`).
 *
 * Rounding is outward (floor the start, ceil the end) so a crop never loses a partially covered edge pixel, then the
 * result is clamped to the image; `wasClipped` records that the clamp removed part of the request.
 */

export interface CssRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Integer device-pixel rectangle inside a decoded image. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AxisScale {
  scaleX: number;
  scaleY: number;
}

/** Floating-point slack so `10 * 1.1 = 11.000000000000002` does not round outward by a whole pixel. */
const ROUNDING_EPSILON = 1e-6;

export function isValidCssRect(rect: CssRect | null | undefined): rect is CssRect {
  return (
    !!rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * The per-axis device-pixel scale of a viewport screenshot. Each image dimension is a rounded product, so the two
 * axes may differ by up to one pixel's worth; a larger disagreement means the image is not of this viewport.
 */
export function measureAxisScale(
  imageWidth: number,
  imageHeight: number,
  viewportCssWidth: number,
  viewportCssHeight: number
): AxisScale | null {
  if (!(imageWidth > 0 && imageHeight > 0 && viewportCssWidth > 0 && viewportCssHeight > 0)) return null;
  const scaleX = imageWidth / viewportCssWidth;
  const scaleY = imageHeight / viewportCssHeight;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return null;
  // Rounding moves each ratio by at most 0.5 / its CSS size, so the two can differ by at most 1 / the smaller size.
  const tolerance = 1 / Math.min(viewportCssWidth, viewportCssHeight) + ROUNDING_EPSILON;
  if (Math.abs(scaleX - scaleY) > tolerance) return null;
  return { scaleX, scaleY };
}

/**
 * Whether a measured screenshot scale is the page's own `devicePixelRatio`. If they disagree, something between the
 * page and the screenshot rescaled the image in a way this mapping cannot see, and the capture must be refused rather
 * than cropped at a guessed offset. The tolerance is the same one-pixel rounding slack as `measureAxisScale`.
 *
 * Browser zoom is such a case. Chromium folds it into `devicePixelRatio` and the CSS viewport, but Playwright's
 * device-scale screenshot stays at the unzoomed ratio: measured in N2.3 on a real headed Ctrl+zoom (110% on a 2x
 * display), devicePixelRatio 2.2 against a 942x679 CSS viewport, screenshot 1884x1358 = 2.0. Zoomed pages are refused.
 */
export function scaleMatchesDevicePixelRatio(
  scale: AxisScale,
  devicePixelRatio: number,
  viewportCssWidth: number,
  viewportCssHeight: number
): boolean {
  if (!(Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 && viewportCssWidth > 0 && viewportCssHeight > 0)) return false;
  const tolerance = 1 / Math.min(viewportCssWidth, viewportCssHeight) + ROUNDING_EPSILON;
  return Math.abs(scale.scaleX - devicePixelRatio) <= tolerance && Math.abs(scale.scaleY - devicePixelRatio) <= tolerance;
}

/** Map a CSS rectangle to device pixels, rounding outward. The result may extend beyond the image. */
export function cssRectToPixelRect(rect: CssRect, scale: AxisScale): PixelRect {
  const x0 = Math.floor(rect.x * scale.scaleX + ROUNDING_EPSILON);
  const y0 = Math.floor(rect.y * scale.scaleY + ROUNDING_EPSILON);
  const x1 = Math.ceil((rect.x + rect.width) * scale.scaleX - ROUNDING_EPSILON);
  const y1 = Math.ceil((rect.y + rect.height) * scale.scaleY - ROUNDING_EPSILON);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/** The inverse mapping, for reporting the actual crop back in CSS pixels. */
export function pixelRectToCssRect(rect: PixelRect, scale: AxisScale): CssRect {
  return {
    x: rect.x / scale.scaleX,
    y: rect.y / scale.scaleY,
    width: rect.width / scale.scaleX,
    height: rect.height / scale.scaleY
  };
}

/**
 * Clamp a pixel rectangle to an image. Returns null when nothing of it lies inside the image, so an offscreen target
 * is reported, never cropped to an empty or neighbouring region.
 */
export function clampPixelRect(rect: PixelRect, imageWidth: number, imageHeight: number): { rect: PixelRect; wasClipped: boolean } | null {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(imageWidth, rect.x + rect.width);
  const y1 = Math.min(imageHeight, rect.y + rect.height);
  if (x1 <= x0 || y1 <= y0) return null;
  const clamped = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const wasClipped = clamped.x !== rect.x || clamped.y !== rect.y || clamped.width !== rect.width || clamped.height !== rect.height;
  return { rect: clamped, wasClipped };
}

/** True when the CSS rectangle has no overlap with a viewport of the given CSS size. */
export function isOutsideViewport(rect: CssRect, viewportCssWidth: number, viewportCssHeight: number): boolean {
  return rect.x + rect.width <= 0 || rect.y + rect.height <= 0 || rect.x >= viewportCssWidth || rect.y >= viewportCssHeight;
}

/** Grow a CSS rectangle by `padding` on every side (the context crop around an element). */
export function expandCssRect(rect: CssRect, padding: number): CssRect {
  const pad = Number.isFinite(padding) && padding > 0 ? padding : 0;
  return { x: rect.x - pad, y: rect.y - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad };
}

/** True when two measurements of the same element disagree by more than `tolerance` CSS px on any edge. */
export function cssRectsDiffer(a: CssRect, b: CssRect, tolerance = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) > tolerance ||
    Math.abs(a.y - b.y) > tolerance ||
    Math.abs(a.x + a.width - (b.x + b.width)) > tolerance ||
    Math.abs(a.y + a.height - (b.y + b.height)) > tolerance
  );
}
