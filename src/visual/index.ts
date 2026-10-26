/**
 * Visual Intelligence (Phase N) public surface. A library with no execution influence: nothing in the Runner,
 * Recorder, orchestrator or preload may import it except two approved adapters, through this index only
 * (`verify:visual-isolation` pins exactly those two edges): the runner's shadow adapter
 * `src/runner/visualFusion/VisualFusionStage.ts` (N2.5, FD-2) and the Recorder's capture adapter
 * `src/recorder/visual/RecorderVisualCapture.ts` (N4.2, RV-1, the 2026-10-13 amendment to FD-2).
 * Visual similarity must never drive a click, fill or selector replacement. Under the 2026-10-13 amendment (VR-0) the
 * only execution-affecting result is `decideVisualAgreement`'s `agreed`, which lets the DOM's own best candidate proceed.
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
export {
  AGREEMENT_MAX_COMPETITORS,
  VISUAL_AGREEMENT_VERSION,
  decideVisualAgreement,
  type VisualAgreementInput,
  type VisualAgreementMode,
  type VisualAgreementReason,
  type VisualAgreementVerdict
} from "./fusion/decideVisualAgreement";
export {
  VISUAL_DIAGNOSIS_MAX_EXAMINED,
  VISUAL_DIAGNOSIS_VERSION,
  decideVisualDiagnosis,
  type VisualDiagnosisCode,
  type VisualDiagnosisConditions,
  type VisualDiagnosisEvidenceInput,
  type VisualDiagnosisInput,
  type VisualDiagnosisMember,
  type VisualDiagnosisRefusal,
  type VisualDiagnosisVerdict
} from "./diagnosis/decideVisualDiagnosis";
export {
  VISUAL_ASSERTION_INPUT_VERSION,
  VISUAL_ASSERTION_POLICY_VERSION,
  decideVisualAssertion,
  type VisualAssertionBaseline,
  type VisualAssertionCapture,
  type VisualAssertionCode,
  type VisualAssertionConditions,
  type VisualAssertionDecision,
  type VisualAssertionGeometry,
  type VisualAssertionInput,
  type VisualAssertionObservation,
  type VisualAssertionRefusal,
  type VisualAssertionVerdictKind
} from "./assertion/decideVisualAssertion";
export {
  TEXT_ASSERTION_INPUT_VERSION,
  TEXT_ASSERTION_POLICY_VERSION,
  UNCALIBRATED_TEXT_ASSERTION_POLICY,
  decideTextAssertion,
  type OcrWord,
  type TextAssertionCode,
  type TextAssertionDecision,
  type TextAssertionInput,
  type TextAssertionMatchMode,
  type TextAssertionOcr,
  type TextAssertionPolicy,
  type TextAssertionRefusal,
  type TextAssertionVerdictKind
} from "./ocr/decideTextAssertion";
export { OCR_PREPROCESS_VERSION, preprocessForOcr, type OcrPreprocessInput, type OcrPreprocessResult } from "./ocr/preprocess";
export { detectSensitiveValue, isSensitiveSourceName, type SensitiveValueCode } from "./ocr/sensitiveExpected";
