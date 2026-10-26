/**
 * OC-8 sensitive-source and sensitive-value rules for OCR text assertions (Phase N, N7.2 / awkit-vra.9.4). PURE.
 *
 * The implementation lives in `src/ocr/ocrExpectedText.ts` (N7.5 / awkit-vra.9.6), outside `src/visual`, so the
 * validator, the step executor and the Designer apply the same rules without reaching Visual Intelligence. This module
 * only re-exports them for the N7.2 decision: there is one implementation of OC-8.
 */
export { detectSensitiveValue, isSensitiveSourceName, type SensitiveValueCode } from "../../ocr/ocrExpectedText";
