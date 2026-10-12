import type { ElementHandle, Frame, Locator, Page } from "playwright";

import { VisualAbort, visualFailure, visualSuccess, type VisualErrorCode, type VisualResult } from "./errors";
import {
  clampPixelRect,
  cssRectToPixelRect,
  cssRectsDiffer,
  expandCssRect,
  isOutsideViewport,
  isValidCssRect,
  measureAxisScale,
  pixelRectToCssRect,
  type AxisScale,
  type CssRect,
  type PixelRect
} from "./geometry";
import { cropImage, decodePng, PngDecodeError, type VisualImage } from "./png";
import { checkProtectedSurface, protectedCallerVerdict, type ProtectedCallerContext, type ProtectedGuardVerdict } from "./protectedGuard";

/**
 * Visual capture (Phase N, N0). A library: it captures what the caller points it at and returns pixels in memory.
 * It never scrolls, clicks, focuses, waits for or otherwise drives the page, never writes a capture to disk, and
 * nothing in the Runner, Recorder or preload imports it (`verify:visual-isolation`).
 *
 * Every capture is ONE viewport screenshot of the explicitly given page — a popup is captured by passing the popup's
 * page — cropped in memory. Element positions come from Playwright's `boundingBox()`, which is already in the main
 * frame's viewport CSS pixels for an element in any frame, and are measured before and after the screenshot: a
 * target that moved in between is `TARGET_STALE`, never a crop of whatever is now under the old box.
 */

export interface VisualCaptureOptions extends ProtectedCallerContext {
  /** Whole-call budget in ms (default 5000). */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Context crop padding around the element, in CSS px (default 24). 0 omits the context crop. */
  contextPaddingCss?: number;
}

/**
 * Verification seams. Not for product callers: `verify:visual-capture` uses them to change the page between the
 * screenshot and the post-capture protected check, and to substitute the guard in its mutation control.
 */
export interface VisualCaptureInternals {
  afterScreenshot?: (page: Page) => Promise<void>;
  guard?: (page: Page) => Promise<ProtectedGuardVerdict>;
}

export interface VisualViewportInfo {
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
  scaleX: number;
  scaleY: number;
  imageWidth: number;
  imageHeight: number;
}

export interface VisualFrameInfo {
  isMainFrame: boolean;
  /** 0 for the main frame, 1 for its child, and so on. */
  depth: number;
}

export interface VisualCrop {
  image: VisualImage;
  /** What was asked for, in viewport CSS px (before rounding and clamping). */
  requestedBounds: CssRect;
  /** What was cropped, in device pixels of the viewport screenshot. */
  actualBounds: PixelRect;
  /** `actualBounds` mapped back to viewport CSS px. */
  actualCssBounds: CssRect;
  /** True when part of the request lay outside the viewport and was cut off. */
  wasClipped: boolean;
}

export interface VisualViewportCapture {
  kind: "viewport";
  viewport: VisualViewportInfo;
  image: VisualImage;
  capturedAt: string;
  durationMs: number;
}

export interface VisualElementCapture {
  kind: "element";
  viewport: VisualViewportInfo;
  frame: VisualFrameInfo;
  element: VisualCrop;
  /** The element plus `contextPaddingCss` around it, clipped to the viewport; absent when padding is 0. */
  context?: VisualCrop;
  capturedAt: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CONTEXT_PADDING_CSS = 24;

class Budget {
  private readonly deadline: number;

  constructor(
    timeoutMs: number | undefined,
    private readonly signal: AbortSignal | undefined
  ) {
    const ms = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    this.deadline = Date.now() + ms;
  }

  remaining(): number {
    return Math.max(0, this.deadline - Date.now());
  }

  check(): void {
    if (this.signal?.aborted) throw new VisualAbort("CANCELLED", "the capture was cancelled");
    if (this.remaining() <= 0) throw new VisualAbort("BUDGET_EXHAUSTED", "the capture ran out of time");
  }

  /** Race one step against the remaining budget and the abort signal. The losing step's settlement is absorbed. */
  race<T>(step: Promise<T>): Promise<T> {
    this.check();
    const signal = this.signal;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new VisualAbort("CANCELLED", "the capture was cancelled"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        reject(new VisualAbort("BUDGET_EXHAUSTED", "the capture ran out of time"));
      }, this.remaining());
      signal?.addEventListener("abort", onAbort, { once: true });
      step.then(
        (value) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }
}

/** Map anything thrown inside a capture to a code. Raw error text is dropped: it can carry URLs and selectors. */
function toFailure(error: unknown, page: Page): VisualResult<never> {
  if (error instanceof VisualAbort) return visualFailure(error.code, error.message);
  if (error instanceof PngDecodeError) return visualFailure("IMAGE_DECODE_FAILED", `the screenshot could not be decoded: ${error.message}`);
  let closed = false;
  try {
    closed = page.isClosed();
  } catch {
    closed = true;
  }
  const text = error instanceof Error ? error.message : "";
  if (closed || /(?:Target|Page|Browser|Context)(?: page, context or browser)? (?:has been )?closed/i.test(text)) {
    return visualFailure("PAGE_CLOSED", "the page closed during capture");
  }
  return visualFailure("CAPTURE_UNAVAILABLE", "the browser could not produce the capture");
}

function refuse(code: VisualErrorCode, message: string): never {
  throw new VisualAbort(code, message);
}

async function assertNotProtected(page: Page, budget: Budget, internals: VisualCaptureInternals | undefined, when: string): Promise<void> {
  const guard = internals?.guard ?? ((target: Page) => checkProtectedSurface(target));
  let verdict: ProtectedGuardVerdict;
  try {
    verdict = await budget.race(guard(page));
  } catch (error) {
    if (error instanceof VisualAbort) throw error;
    verdict = { protected: true, reason: "frame-unscannable" };
  }
  if (verdict.protected) refuse("PROTECTED_SURFACE", `a protected surface is present ${when} (${verdict.reason ?? "unknown"})`);
}

interface ViewportMetrics {
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
  visualScale: number;
}

async function measureViewport(page: Page, budget: Budget): Promise<ViewportMetrics> {
  const metrics = await budget.race(
    page.evaluate(() => ({
      cssWidth: window.innerWidth,
      cssHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      visualScale: window.visualViewport ? window.visualViewport.scale : 1
    }))
  );
  if (!(metrics.cssWidth > 0 && metrics.cssHeight > 0)) refuse("CAPTURE_UNAVAILABLE", "the viewport has no size");
  // Pinch zoom moves the visual viewport away from the layout viewport that boundingBox() reports against.
  if (Math.abs(metrics.visualScale - 1) > 1e-3) refuse("CAPTURE_UNAVAILABLE", "the page is pinch-zoomed");
  return metrics;
}

async function screenshotViewport(page: Page, budget: Budget, metrics: ViewportMetrics): Promise<{ image: VisualImage; scale: AxisScale }> {
  const bytes = await budget.race(page.screenshot({ type: "png", scale: "device", timeout: Math.max(1, budget.remaining()) }));
  const image = decodePng(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const scale = measureAxisScale(image.width, image.height, metrics.cssWidth, metrics.cssHeight);
  if (!scale) refuse("CAPTURE_UNAVAILABLE", "the screenshot does not match the measured viewport");
  return { image, scale };
}

function viewportInfo(metrics: ViewportMetrics, image: VisualImage, scale: AxisScale): VisualViewportInfo {
  return {
    cssWidth: metrics.cssWidth,
    cssHeight: metrics.cssHeight,
    devicePixelRatio: metrics.devicePixelRatio,
    scaleX: scale.scaleX,
    scaleY: scale.scaleY,
    imageWidth: image.width,
    imageHeight: image.height
  };
}

function cropRegion(image: VisualImage, requested: CssRect, scale: AxisScale): VisualCrop | null {
  const clamped = clampPixelRect(cssRectToPixelRect(requested, scale), image.width, image.height);
  if (!clamped) return null;
  return {
    image: cropImage(image, clamped.rect),
    requestedBounds: { ...requested },
    actualBounds: clamped.rect,
    actualCssBounds: pixelRectToCssRect(clamped.rect, scale),
    wasClipped: clamped.wasClipped
  };
}

function preflight(page: Page, options: VisualCaptureOptions): void {
  let closed = false;
  try {
    closed = page.isClosed();
  } catch {
    closed = true;
  }
  if (closed) refuse("PAGE_CLOSED", "the page is closed");
  const caller = protectedCallerVerdict(options);
  if (caller.protected) refuse("PROTECTED_SURFACE", `capture is not allowed here (${caller.reason})`);
}

/** Capture the visible viewport of `page`. */
export async function captureViewport(
  page: Page,
  options: VisualCaptureOptions = {},
  internals?: VisualCaptureInternals
): Promise<VisualResult<VisualViewportCapture>> {
  const started = Date.now();
  const budget = new Budget(options.timeoutMs, options.signal);
  try {
    preflight(page, options);
    await assertNotProtected(page, budget, internals, "before capture");
    const metrics = await measureViewport(page, budget);
    const { image, scale } = await screenshotViewport(page, budget, metrics);
    if (internals?.afterScreenshot) await budget.race(internals.afterScreenshot(page));
    await assertNotProtected(page, budget, internals, "after capture");
    budget.check();
    return visualSuccess({
      kind: "viewport",
      viewport: viewportInfo(metrics, image, scale),
      image,
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - started
    });
  } catch (error) {
    return toFailure(error, page);
  }
}

function frameDepth(frame: Frame): number {
  let depth = 0;
  for (let at = frame.parentFrame(); at; at = at.parentFrame()) depth += 1;
  return depth;
}

async function measureElement(handle: ElementHandle, budget: Budget, inChildFrame: boolean): Promise<CssRect> {
  const box = await budget.race(handle.boundingBox());
  if (!box) {
    // A detached element and an element in a frame that no longer maps into the viewport both report no box.
    const attached = await budget.race(handle.evaluate((node) => node.isConnected)).catch(() => false);
    if (!attached) refuse("TARGET_STALE", "the target is no longer attached");
    if (inChildFrame) refuse("FRAME_MAPPING_FAILED", "the target's frame does not map into the viewport");
    refuse("INVALID_BOUNDS", "the target has no layout box");
  }
  if (!isValidCssRect(box)) refuse("INVALID_BOUNDS", "the target has an empty or non-finite layout box");
  return box;
}

/**
 * Capture one element of `page` (it may sit in any frame of that page), plus an optional context crop around it.
 * The locator must match exactly one element. The element is not scrolled into view: a wholly offscreen target is
 * `TARGET_OFFSCREEN`, a partly visible one is cropped to the viewport with `wasClipped`.
 */
export async function captureElement(
  page: Page,
  target: Locator,
  options: VisualCaptureOptions = {},
  internals?: VisualCaptureInternals
): Promise<VisualResult<VisualElementCapture>> {
  const started = Date.now();
  const budget = new Budget(options.timeoutMs, options.signal);
  let handle: ElementHandle | null = null;
  try {
    preflight(page, options);
    await assertNotProtected(page, budget, internals, "before capture");

    const count = await budget.race(target.count());
    if (count === 0) refuse("TARGET_STALE", "the target matched no element");
    if (count > 1) refuse("TARGET_NOT_UNIQUE", "the target matched more than one element");
    handle = await budget.race(target.elementHandle({ timeout: Math.max(1, budget.remaining()) }));
    if (!handle) refuse("TARGET_STALE", "the target matched no element");

    const ownerFrame = await budget.race(handle.ownerFrame());
    if (!ownerFrame || ownerFrame.isDetached()) refuse("FRAME_MAPPING_FAILED", "the target's frame is detached");
    if (ownerFrame.page() !== page) refuse("FRAME_MAPPING_FAILED", "the target belongs to a different page");
    const isMainFrame = ownerFrame === page.mainFrame();

    const metrics = await measureViewport(page, budget);
    const before = await measureElement(handle, budget, !isMainFrame);
    if (isOutsideViewport(before, metrics.cssWidth, metrics.cssHeight)) refuse("TARGET_OFFSCREEN", "the target is outside the viewport");

    const { image, scale } = await screenshotViewport(page, budget, metrics);
    if (internals?.afterScreenshot) await budget.race(internals.afterScreenshot(page));

    const after = await measureElement(handle, budget, !isMainFrame);
    if (cssRectsDiffer(before, after)) refuse("TARGET_STALE", "the target moved during capture");
    await assertNotProtected(page, budget, internals, "after capture");

    const element = cropRegion(image, before, scale);
    if (!element) refuse("TARGET_OFFSCREEN", "the target is outside the viewport");
    const padding = options.contextPaddingCss ?? DEFAULT_CONTEXT_PADDING_CSS;
    const context = padding > 0 ? cropRegion(image, expandCssRect(before, padding), scale) ?? undefined : undefined;
    budget.check();

    return visualSuccess({
      kind: "element",
      viewport: viewportInfo(metrics, image, scale),
      frame: { isMainFrame, depth: frameDepth(ownerFrame) },
      element,
      ...(context ? { context } : {}),
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - started
    });
  } catch (error) {
    return toFailure(error, page);
  } finally {
    if (handle) await handle.dispose().catch(() => undefined);
  }
}
