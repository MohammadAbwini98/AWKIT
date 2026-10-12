import type { Locator, Page } from "playwright";

import type { VisualResult } from "./errors";
import {
  captureElementWithSeams,
  captureViewportWithSeams,
  type VisualCaptureOptions,
  type VisualElementCapture,
  type VisualViewportCapture
} from "./internal/captureCore";

/**
 * Visual capture (Phase N, N0). A library: it captures what the caller points it at and returns pixels in memory.
 * It never scrolls, clicks, focuses, waits for or otherwise drives the page, never writes a capture to disk, and
 * nothing in the Runner, Recorder or preload imports it (`verify:visual-isolation`).
 *
 * The implementation lives in `internal/captureCore.ts` together with its verification seams. This public surface
 * takes no seam (N2.1), so no product caller can replace the protected-surface guard; `verify:visual-isolation`
 * proves only this module and `verify:visual-capture` import the internal entry.
 */

export type {
  VisualCaptureOptions,
  VisualCrop,
  VisualElementCapture,
  VisualFrameInfo,
  VisualViewportCapture,
  VisualViewportInfo
} from "./internal/captureCore";

/** Capture the visible viewport of `page`. */
export function captureViewport(page: Page, options: VisualCaptureOptions = {}): Promise<VisualResult<VisualViewportCapture>> {
  return captureViewportWithSeams(page, options);
}

/**
 * Capture one element of `page` (it may sit in any frame of that page), plus an optional context crop around it.
 * The locator must match exactly one element. The element is not scrolled into view: a wholly offscreen target is
 * `TARGET_OFFSCREEN`, a partly visible one is cropped to the viewport with `wasClipped`.
 */
export function captureElement(page: Page, target: Locator, options: VisualCaptureOptions = {}): Promise<VisualResult<VisualElementCapture>> {
  return captureElementWithSeams(page, target, options);
}
