/**
 * Visual Intelligence (Phase N) public surface. A library with no execution influence: nothing in the Runner,
 * Recorder, orchestrator or preload may import it except the one shadow adapter
 * `src/runner/visualFusion/VisualFusionStage.ts`, through this index only (N2.5, FD-2, `verify:visual-isolation`),
 * and no result from it may drive a click, fill, selector replacement or locator recovery.
 */

export type { VisualErrorCode, VisualFailure, VisualResult, VisualSuccess } from "./errors";
export type { CssRect, PixelRect } from "./geometry";
export { VisualImage, decodePng } from "./png";
export {
  VISUAL_FANOUT_MAX_CANDIDATES,
  captureCandidates,
  captureElement,
  captureViewport,
  captureVisualFrame,
  cropFromVisualFrame,
  releaseVisualFrame,
  validateVisualFrame,
  type VisualCandidateCapture,
  type VisualCandidateFanout,
  type VisualCandidateTarget,
  type VisualCaptureFrame,
  type VisualCaptureFrameOptions,
  type VisualCaptureOptions,
  type VisualCrop,
  type VisualElementCapture,
  type VisualFrameCrop,
  type VisualFrameInfo,
  type VisualFrameStaleReason,
  type VisualViewportCapture,
  type VisualViewportInfo
} from "./capture";
export { buildCandidateEvidence, type VisualCandidateEvidence, type VisualFanoutEvidence } from "./candidateEvidence";
export { checkProtectedSurface, protectedCallerVerdict, type ProtectedGuardVerdict } from "./protectedGuard";
export { VISUAL_FINGERPRINT_VERSION, fingerprintVisualImage, type VisualFingerprint } from "./fingerprint";
export { compareVisualFingerprints, type VisualComparison } from "./compare";
export { VISUAL_EVIDENCE_MAX_BYTES, VISUAL_EVIDENCE_VERSION, buildVisualEvidence, type VisualEvidence } from "./visualEvidence";
export {
  FUSION_MAX_COMPETITORS,
  FUSION_VERDICT_VERSION,
  MEASURED_FUSION_POLICY,
  UNCALIBRATED_FUSION_POLICY,
  decideFusion,
  type FusionInput,
  type FusionPolicy,
  type FusionReason,
  type FusionVerdict
} from "./fusion/decideFusion";
