/**
 * Visual Intelligence (Phase N) public surface. A library with no execution influence: nothing in the Runner,
 * Recorder, orchestrator or preload may import it (`verify:visual-isolation`), and no result from it may drive a
 * click, fill, selector replacement or locator recovery.
 */

export type { VisualErrorCode, VisualFailure, VisualResult, VisualSuccess } from "./errors";
export type { CssRect, PixelRect } from "./geometry";
export { VisualImage, decodePng } from "./png";
export {
  captureElement,
  captureViewport,
  type VisualCaptureOptions,
  type VisualCrop,
  type VisualElementCapture,
  type VisualFrameInfo,
  type VisualViewportCapture,
  type VisualViewportInfo
} from "./capture";
export { checkProtectedSurface, protectedCallerVerdict, type ProtectedGuardVerdict } from "./protectedGuard";
export { VISUAL_FINGERPRINT_VERSION, fingerprintVisualImage, type VisualFingerprint } from "./fingerprint";
export { compareVisualFingerprints, type VisualComparison } from "./compare";
export { VISUAL_EVIDENCE_VERSION, buildVisualEvidence, type VisualEvidence } from "./visualEvidence";
