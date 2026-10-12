import type { Locator, Page } from "playwright";

import type { VisualResult } from "./errors";
import {
  captureCandidatesWithSeams,
  captureElementWithSeams,
  captureViewportWithSeams,
  captureVisualFrameWithSeams,
  type VisualCandidateFanout,
  type VisualCandidateTarget,
  type VisualCaptureFrame,
  type VisualCaptureFrameOptions,
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
 * proves only this module and the capture verifiers import the internal entry.
 *
 * N2.4: `captureCandidates` evaluates many candidates from ONE screenshot (the shared `VisualCaptureFrame`).
 */

export type {
  VisualCandidateCapture,
  VisualCandidateFanout,
  VisualCandidateTarget,
  VisualCandidateTiming,
  VisualCaptureFrame,
  VisualCaptureFrameOptions,
  VisualCaptureOptions,
  VisualCrop,
  VisualElementCapture,
  VisualFanoutMemory,
  VisualFanoutTiming,
  VisualFrameCrop,
  VisualFrameInfo,
  VisualFrameMemory,
  VisualFrameStaleReason,
  VisualViewportCapture,
  VisualViewportInfo
} from "./internal/captureCore";
export { VISUAL_FANOUT_MAX_CANDIDATES, cropFromVisualFrame, releaseVisualFrame, validateVisualFrame } from "./internal/captureCore";

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

/**
 * Take ONE viewport screenshot of `page` as a shared, immutable frame to crop with `cropFromVisualFrame`. The caller
 * owns it and must `releaseVisualFrame` it when its decision cycle ends.
 */
export function captureVisualFrame(page: Page, options: VisualCaptureFrameOptions = {}): Promise<VisualResult<VisualCaptureFrame>> {
  return captureVisualFrameWithSeams(page, options);
}

/**
 * One visual decision cycle: every candidate is cropped from the same single screenshot, which is released before
 * this returns. A candidate failure is that candidate's alone; a protected surface or a stale capture fails the cycle.
 */
export function captureCandidates(
  page: Page,
  candidates: readonly VisualCandidateTarget[],
  options: VisualCaptureFrameOptions = {}
): Promise<VisualResult<VisualCandidateFanout>> {
  return captureCandidatesWithSeams(page, candidates, options);
}
