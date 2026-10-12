/**
 * Visual Intelligence error taxonomy (Phase N, N0). Every capture, decode, fingerprint and comparison call returns
 * a `VisualResult` instead of throwing, so a caller can never mistake a refusal for an empty image.
 *
 * Messages are deliberately generic: they never carry a URL, selector, page text, field value or image byte, so a
 * result can be logged as-is.
 */

export type VisualErrorCode =
  /** The browser could not produce a screenshot, or the viewport could not be measured consistently. */
  | "CAPTURE_UNAVAILABLE"
  /** The requested region is not a finite, positive rectangle, or the target has no layout box. */
  | "INVALID_BOUNDS"
  /** The target lies wholly outside the viewport. Capture never scrolls the page to reach it. */
  | "TARGET_OFFSCREEN"
  /** The target moved, resized, detached or vanished between measurement and capture. */
  | "TARGET_STALE"
  /** The target locator matched more than one element. */
  | "TARGET_NOT_UNIQUE"
  /** The target sits in a frame (or page) whose position in the captured viewport cannot be established. */
  | "FRAME_MAPPING_FAILED"
  /** A protected-login, CAPTCHA, MFA, OTP or passkey surface is present, or its absence could not be proven. */
  | "PROTECTED_SURFACE"
  /** The screenshot bytes are not a PNG this decoder supports. */
  | "IMAGE_DECODE_FAILED"
  /** A fingerprint could not be computed from the image. */
  | "FINGERPRINT_FAILED"
  /** A fingerprint was produced by a different fingerprint version and cannot be compared. */
  | "UNSUPPORTED_FINGERPRINT_VERSION"
  /**
   * A shared capture no longer describes the page: it was released or expired, or the page navigated, opened a popup,
   * closed, or changed its viewport size or device pixel ratio after the screenshot. Never recaptured automatically.
   */
  | "CAPTURE_STALE"
  /** The page (or its browser) closed. */
  | "PAGE_CLOSED"
  /** The caller's time budget ran out. */
  | "BUDGET_EXHAUSTED"
  /** The caller's abort signal fired. */
  | "CANCELLED";

export interface VisualFailure {
  ok: false;
  code: VisualErrorCode;
  message: string;
}

export interface VisualSuccess<T> {
  ok: true;
  value: T;
}

export type VisualResult<T> = VisualSuccess<T> | VisualFailure;

export function visualFailure(code: VisualErrorCode, message: string): VisualFailure {
  return { ok: false, code, message };
}

export function visualSuccess<T>(value: T): VisualSuccess<T> {
  return { ok: true, value };
}

/** Internal control-flow error: thrown inside a capture and mapped to a `VisualFailure` at the boundary. */
export class VisualAbort extends Error {
  readonly code: VisualErrorCode;

  constructor(code: VisualErrorCode, message: string) {
    super(message);
    this.name = "VisualAbort";
    this.code = code;
  }
}
