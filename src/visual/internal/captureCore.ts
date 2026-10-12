import { randomUUID } from "node:crypto";

import type { ElementHandle, Frame, Locator, Page } from "playwright";

import { VisualAbort, visualFailure, visualSuccess, type VisualErrorCode, type VisualResult } from "../errors";
import {
  clampPixelRect,
  cssRectToPixelRect,
  cssRectsDiffer,
  expandCssRect,
  isOutsideViewport,
  isValidCssRect,
  measureAxisScale,
  pixelRectToCssRect,
  scaleMatchesDevicePixelRatio,
  type AxisScale,
  type CssRect,
  type PixelRect
} from "../geometry";
import { cropImage, decodePng, PngDecodeError, type VisualImage } from "../png";
import { checkProtectedSurface, protectedCallerVerdict, type ProtectedCallerContext, type ProtectedGuardVerdict } from "../protectedGuard";

/**
 * Visual capture core (Phase N, N0; seams encapsulated in N2.1). INTERNAL: product code captures through
 * `src/visual/capture.ts`, whose `captureViewport` / `captureElement` take no seam. Only that module and
 * `verify:visual-capture` may import this file, and `verify:visual-isolation` proves it.
 *
 * A library: it captures what the caller points it at and returns pixels in memory. It never scrolls, clicks,
 * focuses, waits for or otherwise drives the page, and never writes a capture to disk.
 *
 * Every capture is ONE viewport screenshot of the explicitly given page — a popup is captured by passing the popup's
 * page — cropped in memory. Element positions come from Playwright's `boundingBox()`, which is already in the main
 * frame's viewport CSS pixels for an element in any frame, and are measured before and after the screenshot: a
 * target that moved in between is `TARGET_STALE`, never a crop of whatever is now under the old box.
 *
 * N2.4 (awkit-vra.12.4) adds the shared capture: `captureCandidatesWithSeams` takes ONE screenshot per visual decision
 * cycle and crops every candidate from that immutable `VisualCaptureFrame`, so evaluating more candidates never takes
 * more screenshots. The frame's pixels live in a private field of the frame object — no module state refers to any
 * frame — and are dropped when the cycle releases it.
 */

export interface VisualCaptureOptions extends ProtectedCallerContext {
  /** Whole-call budget in ms (default 5000). */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Context crop padding around the element, in CSS px (default 24). 0 omits the context crop. */
  contextPaddingCss?: number;
}

/**
 * Verification seams. `verify:visual-capture` uses them to change the page between the screenshot and the
 * post-capture protected check, and to substitute the guard in its budget and mutation controls. The guard seam can
 * switch protection off, which is why no product caller may reach it.
 */
export interface VisualCaptureSeams {
  afterScreenshot?: (page: Page) => Promise<void>;
  guard?: (page: Page) => Promise<ProtectedGuardVerdict>;
  /** N2.4: observe the shared frame of a candidate cycle, so `verify:visual-capture-fanout` can prove it is released. */
  onFrame?: (frame: VisualCaptureFrame) => void;
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

async function assertNotProtected(page: Page, budget: Budget, seams: VisualCaptureSeams | undefined, when: string): Promise<void> {
  const guard = seams?.guard ?? ((target: Page) => checkProtectedSurface(target));
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

function readViewportMetrics(page: Page): Promise<ViewportMetrics> {
  return page.evaluate(() => ({
    cssWidth: window.innerWidth,
    cssHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    visualScale: window.visualViewport ? window.visualViewport.scale : 1
  }));
}

async function measureViewport(page: Page, budget: Budget): Promise<ViewportMetrics> {
  const metrics = await budget.race(readViewportMetrics(page));
  if (!(metrics.cssWidth > 0 && metrics.cssHeight > 0)) refuse("CAPTURE_UNAVAILABLE", "the viewport has no size");
  // Pinch zoom moves the visual viewport away from the layout viewport that boundingBox() reports against.
  if (Math.abs(metrics.visualScale - 1) > 1e-3) refuse("CAPTURE_UNAVAILABLE", "the page is pinch-zoomed");
  return metrics;
}

interface ViewportScreenshot {
  image: VisualImage;
  scale: AxisScale;
  pngBytes: number;
  screenshotMs: number;
  decodeMs: number;
}

async function screenshotViewport(page: Page, budget: Budget, metrics: ViewportMetrics): Promise<ViewportScreenshot> {
  const shotStarted = performance.now();
  const bytes = await budget.race(page.screenshot({ type: "png", scale: "device", timeout: Math.max(1, budget.remaining()) }));
  const decodeStarted = performance.now();
  const image = decodePng(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const decodeMs = performance.now() - decodeStarted;
  const scale = measureAxisScale(image.width, image.height, metrics.cssWidth, metrics.cssHeight);
  if (!scale) refuse("CAPTURE_UNAVAILABLE", "the screenshot does not match the measured viewport");
  if (!scaleMatchesDevicePixelRatio(scale, metrics.devicePixelRatio, metrics.cssWidth, metrics.cssHeight)) {
    refuse("CAPTURE_UNAVAILABLE", "the screenshot scale does not match the device pixel ratio");
  }
  return { image, scale, pngBytes: bytes.byteLength, screenshotMs: decodeStarted - shotStarted, decodeMs };
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

/** Capture the visible viewport of `page`, with optional verification seams. */
export async function captureViewportWithSeams(
  page: Page,
  options: VisualCaptureOptions = {},
  seams?: VisualCaptureSeams
): Promise<VisualResult<VisualViewportCapture>> {
  const started = Date.now();
  const budget = new Budget(options.timeoutMs, options.signal);
  try {
    preflight(page, options);
    await assertNotProtected(page, budget, seams, "before capture");
    const metrics = await measureViewport(page, budget);
    const { image, scale } = await screenshotViewport(page, budget, metrics);
    if (seams?.afterScreenshot) await budget.race(seams.afterScreenshot(page));
    await assertNotProtected(page, budget, seams, "after capture");
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
 * Capture one element of `page` (it may sit in any frame of that page), plus an optional context crop around it,
 * with optional verification seams. The locator must match exactly one element. The element is not scrolled into
 * view: a wholly offscreen target is `TARGET_OFFSCREEN`, a partly visible one is cropped to the viewport with
 * `wasClipped`.
 */
export async function captureElementWithSeams(
  page: Page,
  target: Locator,
  options: VisualCaptureOptions = {},
  seams?: VisualCaptureSeams
): Promise<VisualResult<VisualElementCapture>> {
  const started = Date.now();
  const budget = new Budget(options.timeoutMs, options.signal);
  let handle: ElementHandle | null = null;
  try {
    preflight(page, options);
    await assertNotProtected(page, budget, seams, "before capture");

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
    if (seams?.afterScreenshot) await budget.race(seams.afterScreenshot(page));

    const after = await measureElement(handle, budget, !isMainFrame);
    if (cssRectsDiffer(before, after)) refuse("TARGET_STALE", "the target moved during capture");
    await assertNotProtected(page, budget, seams, "after capture");

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

// ---------------------------------------------------------------------------------------------------------------------
// N2.4 (awkit-vra.12.4): one shared capture per visual decision cycle.
// ---------------------------------------------------------------------------------------------------------------------

/** The most candidates one cycle may crop from its shared capture. */
export const VISUAL_FANOUT_MAX_CANDIDATES = 32;
const DEFAULT_FRAME_MAX_AGE_MS = 5000;

/** Why a shared capture no longer describes the page. */
export type VisualFrameStaleReason = "released" | "expired" | "navigated" | "popup" | "page-closed" | "viewport-changed";

export interface VisualFrameMemory {
  /** Encoded screenshot size; the encoded buffer is dropped once decoded. */
  pngBytes: number;
  /** Decoded RGBA size; held only until the frame is released. */
  decodedBytes: number;
}

export interface VisualCaptureFrameOptions extends VisualCaptureOptions {
  /** How long after its screenshot the frame may still be cropped, in ms (default 5000). Older is CAPTURE_STALE. */
  maxFrameAgeMs?: number;
}

interface PageWatch {
  stale: VisualFrameStaleReason | null;
  detach: () => void;
}

interface FrameBinding {
  page: Page;
  image: VisualImage;
  scale: AxisScale;
  metrics: ViewportMetrics;
  expiresAt: number;
  watch: PageWatch;
}

const FRAME_KEY = Symbol("VisualCaptureFrame");
let bindingOf!: (frame: VisualCaptureFrame) => FrameBinding | null;
let unbind!: (frame: VisualCaptureFrame) => FrameBinding | null;

/**
 * One immutable viewport screenshot and the conditions it was taken under. The public fields are metadata only; the
 * decoded pixels and the page are held in a private field, so serialising a frame never carries an image or a
 * Playwright object, and `releaseVisualFrame` makes the pixels unreachable. Created only by the capture functions.
 */
export class VisualCaptureFrame {
  readonly kind = "frame" as const;
  readonly captureId: string;
  readonly viewport: Readonly<VisualViewportInfo>;
  readonly capturedAt: string;
  /** Screenshot plus decode, in ms. */
  readonly durationMs: number;
  readonly memory: Readonly<VisualFrameMemory>;
  #binding: FrameBinding | null;

  static {
    bindingOf = (frame) => frame.#binding;
    unbind = (frame) => {
      const binding = frame.#binding;
      frame.#binding = null;
      return binding;
    };
  }

  constructor(
    key: symbol,
    init: { viewport: VisualViewportInfo; capturedAt: string; durationMs: number; memory: VisualFrameMemory },
    binding: FrameBinding
  ) {
    if (key !== FRAME_KEY) throw new TypeError("a VisualCaptureFrame is created only by a capture");
    this.captureId = randomUUID();
    this.viewport = Object.freeze({ ...init.viewport });
    this.capturedAt = init.capturedAt;
    this.durationMs = init.durationMs;
    this.memory = Object.freeze({ ...init.memory });
    this.#binding = binding;
    Object.freeze(this);
  }
}

/** The element crop and optional context crop of one candidate, cut from a shared frame. */
export interface VisualFrameCrop {
  element: VisualCrop;
  context?: VisualCrop;
}

function staleReasonOf(frame: VisualCaptureFrame): VisualFrameStaleReason | null {
  const binding = bindingOf(frame);
  if (!binding) return "released";
  if (binding.watch.stale) return binding.watch.stale;
  if (Date.now() > binding.expiresAt) return "expired";
  return null;
}

function staleMessage(reason: VisualFrameStaleReason): string {
  switch (reason) {
    case "released":
      return "the shared capture was released";
    case "expired":
      return "the shared capture is older than its maximum age";
    case "navigated":
      return "the page navigated after the shared capture";
    case "popup":
      return "the page opened a popup after the shared capture";
    case "page-closed":
      return "the page closed after the shared capture";
    case "viewport-changed":
      return "the viewport size or device pixel ratio changed after the shared capture";
  }
}

/**
 * Mark a capture stale on any frame navigation, popup or page close. Attached BEFORE the screenshot, so an event that
 * races the screenshot itself is caught too; detached when the frame is released.
 */
function watchPage(page: Page): PageWatch {
  const onNavigated = (): void => mark("navigated");
  const onPopup = (): void => mark("popup");
  const onClose = (): void => mark("page-closed");
  const watch: PageWatch = {
    stale: null,
    detach: () => {
      page.off("framenavigated", onNavigated);
      page.off("popup", onPopup);
      page.off("close", onClose);
    }
  };
  const mark = (reason: VisualFrameStaleReason): void => {
    if (!watch.stale) watch.stale = reason;
  };
  page.on("framenavigated", onNavigated);
  page.on("popup", onPopup);
  page.on("close", onClose);
  return watch;
}

async function shootFrame(
  page: Page,
  budget: Budget,
  metrics: ViewportMetrics,
  options: VisualCaptureFrameOptions
): Promise<{ frame: VisualCaptureFrame; screenshotMs: number; decodeMs: number }> {
  const watch = watchPage(page);
  try {
    const shot = await screenshotViewport(page, budget, metrics);
    const maxAge =
      typeof options.maxFrameAgeMs === "number" && Number.isFinite(options.maxFrameAgeMs) && options.maxFrameAgeMs > 0
        ? options.maxFrameAgeMs
        : DEFAULT_FRAME_MAX_AGE_MS;
    const frame = new VisualCaptureFrame(
      FRAME_KEY,
      {
        viewport: viewportInfo(metrics, shot.image, shot.scale),
        capturedAt: new Date().toISOString(),
        durationMs: shot.screenshotMs + shot.decodeMs,
        memory: { pngBytes: shot.pngBytes, decodedBytes: shot.image.data.byteLength }
      },
      { page, image: shot.image, scale: shot.scale, metrics, expiresAt: Date.now() + maxAge, watch }
    );
    return { frame, screenshotMs: shot.screenshotMs, decodeMs: shot.decodeMs };
  } catch (error) {
    watch.detach();
    throw error;
  }
}

/**
 * Re-measure the page against the frame: closed, navigated (its execution context is gone), popup, or a different
 * viewport size, device pixel ratio or pinch zoom all make the frame stale. Throws `CAPTURE_STALE`.
 */
async function assertFrameCurrent(frame: VisualCaptureFrame, budget: Budget): Promise<void> {
  const binding = bindingOf(frame);
  if (binding) {
    let closed = false;
    try {
      closed = binding.page.isClosed();
    } catch {
      closed = true;
    }
    if (closed) {
      binding.watch.stale ??= "page-closed";
    } else {
      let now: ViewportMetrics | null = null;
      try {
        now = await budget.race(readViewportMetrics(binding.page));
      } catch (error) {
        if (error instanceof VisualAbort) throw error;
        now = null;
      }
      if (!now) {
        binding.watch.stale ??= binding.page.isClosed() ? "page-closed" : "navigated";
      } else if (
        now.cssWidth !== binding.metrics.cssWidth ||
        now.cssHeight !== binding.metrics.cssHeight ||
        now.devicePixelRatio !== binding.metrics.devicePixelRatio ||
        now.visualScale !== binding.metrics.visualScale
      ) {
        binding.watch.stale ??= "viewport-changed";
      }
    }
  }
  const reason = staleReasonOf(frame);
  if (reason) refuse("CAPTURE_STALE", staleMessage(reason));
}

/**
 * The one post-screenshot check of a shared frame: the protected-surface guard, then `assertFrameCurrent`. A page
 * that closed after the screenshot cannot be scanned, so the guard fails closed; the frame is discarded either way,
 * and the cycle reports what happened — the capture is stale — rather than a protected surface it never saw.
 */
async function assertFrameAfterCapture(page: Page, frame: VisualCaptureFrame, budget: Budget, seams: VisualCaptureSeams | undefined): Promise<void> {
  try {
    await assertNotProtected(page, budget, seams, "after capture");
  } catch (error) {
    if (error instanceof VisualAbort && error.code === "PROTECTED_SURFACE" && page.isClosed()) refuse("CAPTURE_STALE", staleMessage("page-closed"));
    throw error;
  }
  await assertFrameCurrent(frame, budget);
}

/**
 * Take ONE viewport screenshot of `page` as a shared frame, with optional verification seams. The protected-surface
 * guard runs once before and once after; a protected surface after the screenshot discards the frame. The caller owns
 * the frame and must `releaseVisualFrame` it when its decision cycle ends.
 */
export async function captureVisualFrameWithSeams(
  page: Page,
  options: VisualCaptureFrameOptions = {},
  seams?: VisualCaptureSeams
): Promise<VisualResult<VisualCaptureFrame>> {
  const budget = new Budget(options.timeoutMs, options.signal);
  let frame: VisualCaptureFrame | null = null;
  try {
    preflight(page, options);
    await assertNotProtected(page, budget, seams, "before capture");
    const metrics = await measureViewport(page, budget);
    frame = (await shootFrame(page, budget, metrics, options)).frame;
    seams?.onFrame?.(frame);
    if (seams?.afterScreenshot) await budget.race(seams.afterScreenshot(page));
    await assertFrameAfterCapture(page, frame, budget, seams);
    budget.check();
    const owned = frame;
    frame = null;
    return visualSuccess(owned);
  } catch (error) {
    return toFailure(error, page);
  } finally {
    if (frame) releaseVisualFrame(frame);
  }
}

/**
 * Crop one region from a shared frame: the element at `cssBounds` (main-frame viewport CSS px) and, when
 * `contextPaddingCss` > 0, the context around it. Synchronous and deterministic — the same frame and bounds give the
 * same pixels whatever was cropped before. Uses the same single CSS-to-device-pixel transform as `captureElement`.
 * A released, expired, navigated, popped-up or closed frame is `CAPTURE_STALE`; it is never recaptured here.
 */
export function cropFromVisualFrame(
  frame: VisualCaptureFrame,
  cssBounds: CssRect,
  contextPaddingCss: number = DEFAULT_CONTEXT_PADDING_CSS
): VisualResult<VisualFrameCrop> {
  const reason = staleReasonOf(frame);
  const binding = bindingOf(frame);
  if (reason || !binding) return visualFailure("CAPTURE_STALE", staleMessage(reason ?? "released"));
  if (!isValidCssRect(cssBounds)) return visualFailure("INVALID_BOUNDS", "the region is empty or not finite");
  if (isOutsideViewport(cssBounds, binding.metrics.cssWidth, binding.metrics.cssHeight)) {
    return visualFailure("TARGET_OFFSCREEN", "the region is outside the captured viewport");
  }
  const element = cropRegion(binding.image, cssBounds, binding.scale);
  if (!element) return visualFailure("TARGET_OFFSCREEN", "the region is outside the captured viewport");
  const context = contextPaddingCss > 0 ? cropRegion(binding.image, expandCssRect(cssBounds, contextPaddingCss), binding.scale) : null;
  return visualSuccess(context ? { element, context } : { element });
}

/** Re-check that a shared frame still describes its page. `CAPTURE_STALE` when it does not. */
export async function validateVisualFrame(
  frame: VisualCaptureFrame,
  options: Pick<VisualCaptureOptions, "timeoutMs" | "signal"> = {}
): Promise<VisualResult<VisualCaptureFrame>> {
  const binding = bindingOf(frame);
  if (!binding) return visualFailure("CAPTURE_STALE", staleMessage("released"));
  try {
    await assertFrameCurrent(frame, new Budget(options.timeoutMs, options.signal));
    return visualSuccess(frame);
  } catch (error) {
    return toFailure(error, binding.page);
  }
}

/** Drop a frame's pixels and stop watching its page. Idempotent; every later crop is `CAPTURE_STALE`. */
export function releaseVisualFrame(frame: VisualCaptureFrame): void {
  unbind(frame)?.watch.detach();
}

/** One candidate of a decision cycle. `id` is the caller's own label and must be unique within the cycle. */
export interface VisualCandidateTarget {
  id: string;
  target: Locator;
}

export interface VisualCandidateTiming {
  /** ms from the cycle start at which the bounds used for the crop were measured: always before the screenshot. */
  boundsMeasuredMs: number;
  /** ms from the cycle start at which the bounds were re-measured after the screenshot, when they were. */
  boundsRecheckedMs?: number;
}

export interface VisualCandidateCapture {
  id: string;
  /** The shared capture this candidate's pixels come from; null when the cycle took no screenshot. */
  captureId: string | null;
  result: VisualResult<VisualElementCapture>;
  timing: VisualCandidateTiming;
}

export interface VisualFanoutTiming {
  /** Resolving and measuring every candidate before the screenshot. */
  resolveMs: number;
  screenshotMs: number;
  decodeMs: number;
  /** Re-measuring every candidate after the screenshot. */
  recheckMs: number;
  cropMs: number;
  totalMs: number;
}

export interface VisualFanoutMemory extends VisualFrameMemory {
  /** Every element and context crop returned. */
  cropBytes: number;
  /** Upper bound on the cycle's transient image memory: encoded + decoded + crops, as if all were live at once. */
  peakTemporaryBytes: number;
}

export interface VisualCandidateFanout {
  kind: "fanout";
  /** null when no candidate could be resolved, so no screenshot was taken. */
  captureId: string | null;
  /** Screenshots this cycle took: never more than one, whatever the number of candidates. */
  screenshots: 0 | 1;
  viewport?: VisualViewportInfo;
  capturedAt?: string;
  /** One entry per input candidate, in input order. */
  candidates: VisualCandidateCapture[];
  timing: VisualFanoutTiming;
  memory: VisualFanoutMemory;
}

/** Failures that end the whole cycle rather than one candidate. */
const CYCLE_FATAL: ReadonlySet<VisualErrorCode> = new Set(["PROTECTED_SURFACE", "CAPTURE_STALE", "PAGE_CLOSED", "BUDGET_EXHAUSTED", "CANCELLED"]);

interface ResolvedCandidate {
  index: number;
  handle: ElementHandle;
  isMainFrame: boolean;
  depth: number;
  before: CssRect;
}

async function resolveCandidate(page: Page, target: Locator, budget: Budget, metrics: ViewportMetrics, index: number): Promise<ResolvedCandidate> {
  const count = await budget.race(target.count());
  if (count === 0) refuse("TARGET_STALE", "the target matched no element");
  if (count > 1) refuse("TARGET_NOT_UNIQUE", "the target matched more than one element");
  const handle = await budget.race(target.elementHandle({ timeout: Math.max(1, budget.remaining()) }));
  if (!handle) refuse("TARGET_STALE", "the target matched no element");
  try {
    const ownerFrame = await budget.race(handle.ownerFrame());
    if (!ownerFrame || ownerFrame.isDetached()) refuse("FRAME_MAPPING_FAILED", "the target's frame is detached");
    if (ownerFrame.page() !== page) refuse("FRAME_MAPPING_FAILED", "the target belongs to a different page");
    const isMainFrame = ownerFrame === page.mainFrame();
    const before = await measureElement(handle, budget, !isMainFrame);
    if (isOutsideViewport(before, metrics.cssWidth, metrics.cssHeight)) refuse("TARGET_OFFSCREEN", "the target is outside the viewport");
    return { index, handle, isMainFrame, depth: frameDepth(ownerFrame), before };
  } catch (error) {
    await handle.dispose().catch(() => undefined);
    throw error;
  }
}

/** A failure scoped to one candidate, or a rethrow when it ends the whole cycle. */
function candidateFailure(error: unknown, page: Page): VisualResult<never> {
  const failure = toFailure(error, page);
  if (!failure.ok) {
    if (CYCLE_FATAL.has(failure.code)) throw new VisualAbort(failure.code, failure.message);
  }
  return failure;
}

function invalidCandidates(candidates: readonly VisualCandidateTarget[]): boolean {
  if (!Array.isArray(candidates) || candidates.length > VISUAL_FANOUT_MAX_CANDIDATES) return true;
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.id !== "string" || candidate.id.length === 0 || ids.has(candidate.id) || !candidate.target) return true;
    ids.add(candidate.id);
  }
  return false;
}

/**
 * One visual decision cycle over `candidates` on `page`, with optional verification seams: resolve and measure every
 * candidate, take ONE viewport screenshot, guard it once before and once after, prove it still describes the page,
 * then re-measure and crop every candidate from that same frame. The frame is released before returning.
 *
 * A candidate that cannot be resolved, measured or cropped fails on its own; the others are unaffected and nothing is
 * recaptured for it. A protected surface, a stale frame (navigation, popup, page close, viewport/DPR change), a closed
 * page, the budget or the abort signal ends the whole cycle.
 */
export async function captureCandidatesWithSeams(
  page: Page,
  candidates: readonly VisualCandidateTarget[],
  options: VisualCaptureFrameOptions = {},
  seams?: VisualCaptureSeams
): Promise<VisualResult<VisualCandidateFanout>> {
  const started = performance.now();
  const elapsed = (): number => performance.now() - started;
  const budget = new Budget(options.timeoutMs, options.signal);
  const padding = options.contextPaddingCss ?? DEFAULT_CONTEXT_PADDING_CSS;
  const resolved: ResolvedCandidate[] = [];
  let frame: VisualCaptureFrame | null = null;
  try {
    if (invalidCandidates(candidates)) refuse("CAPTURE_UNAVAILABLE", "the candidate list is empty-labelled, duplicated or too long");
    preflight(page, options);
    await assertNotProtected(page, budget, seams, "before capture");
    const metrics = await measureViewport(page, budget);

    const results: (VisualResult<VisualElementCapture> | null)[] = candidates.map(() => null);
    const timings: VisualCandidateTiming[] = candidates.map(() => ({ boundsMeasuredMs: 0 }));
    const resolveStarted = elapsed();
    for (let index = 0; index < candidates.length; index += 1) {
      timings[index].boundsMeasuredMs = elapsed();
      try {
        resolved.push(await resolveCandidate(page, candidates[index].target, budget, metrics, index));
      } catch (error) {
        results[index] = candidateFailure(error, page);
      }
    }
    const resolveMs = elapsed() - resolveStarted;

    const timing: VisualFanoutTiming = { resolveMs, screenshotMs: 0, decodeMs: 0, recheckMs: 0, cropMs: 0, totalMs: 0 };
    const memory: VisualFanoutMemory = { pngBytes: 0, decodedBytes: 0, cropBytes: 0, peakTemporaryBytes: 0 };
    if (resolved.length === 0) {
      timing.totalMs = elapsed();
      return visualSuccess({
        kind: "fanout",
        captureId: null,
        screenshots: 0,
        candidates: candidates.map((candidate, index) => ({
          id: candidate.id,
          captureId: null,
          result: results[index] ?? visualFailure("TARGET_STALE", "the target matched no element"),
          timing: timings[index]
        })),
        timing,
        memory
      });
    }

    const shot = await shootFrame(page, budget, metrics, options);
    frame = shot.frame;
    timing.screenshotMs = shot.screenshotMs;
    timing.decodeMs = shot.decodeMs;
    seams?.onFrame?.(frame);
    if (seams?.afterScreenshot) await budget.race(seams.afterScreenshot(page));
    await assertFrameAfterCapture(page, frame, budget, seams);

    const viewport = { ...frame.viewport };
    for (const slot of resolved) {
      const recheckStarted = elapsed();
      let after: CssRect;
      try {
        after = await measureElement(slot.handle, budget, !slot.isMainFrame);
      } catch (error) {
        timing.recheckMs += elapsed() - recheckStarted;
        results[slot.index] = candidateFailure(error, page);
        continue;
      }
      timings[slot.index].boundsRecheckedMs = elapsed();
      timing.recheckMs += elapsed() - recheckStarted;
      if (cssRectsDiffer(slot.before, after)) {
        results[slot.index] = visualFailure("TARGET_STALE", "the target moved during capture");
        continue;
      }
      const cropStarted = elapsed();
      const crop = cropFromVisualFrame(frame, slot.before, padding);
      timing.cropMs += elapsed() - cropStarted;
      if (!crop.ok) {
        if (CYCLE_FATAL.has(crop.code)) refuse(crop.code, crop.message);
        results[slot.index] = crop;
        continue;
      }
      memory.cropBytes += crop.value.element.image.data.byteLength + (crop.value.context?.image.data.byteLength ?? 0);
      results[slot.index] = visualSuccess({
        kind: "element",
        viewport: { ...viewport },
        frame: { isMainFrame: slot.isMainFrame, depth: slot.depth },
        element: crop.value.element,
        ...(crop.value.context ? { context: crop.value.context } : {}),
        capturedAt: frame.capturedAt,
        durationMs: Math.round(elapsed())
      });
    }
    // A navigation, popup or close that arrived while the candidates were cropped makes every crop suspect.
    const lateStale = staleReasonOf(frame);
    if (lateStale) refuse("CAPTURE_STALE", staleMessage(lateStale));
    budget.check();

    memory.pngBytes = frame.memory.pngBytes;
    memory.decodedBytes = frame.memory.decodedBytes;
    memory.peakTemporaryBytes = memory.pngBytes + memory.decodedBytes + memory.cropBytes;
    timing.totalMs = elapsed();
    const captureId = frame.captureId;
    return visualSuccess({
      kind: "fanout",
      captureId,
      screenshots: 1,
      viewport,
      capturedAt: frame.capturedAt,
      candidates: candidates.map((candidate, index) => ({
        id: candidate.id,
        captureId,
        result: results[index] ?? visualFailure("CAPTURE_UNAVAILABLE", "the candidate was not captured"),
        timing: timings[index]
      })),
      timing,
      memory
    });
  } catch (error) {
    return toFailure(error, page);
  } finally {
    if (frame) releaseVisualFrame(frame);
    await Promise.all(resolved.map((slot) => slot.handle.dispose().catch(() => undefined)));
  }
}
