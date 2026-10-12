import type { VisualElementCapture, VisualFrameInfo, VisualViewportCapture, VisualViewportInfo } from "./capture";
import { visualFailure, visualSuccess, type VisualResult } from "./errors";
import { fingerprintVisualImage, type VisualFingerprint } from "./fingerprint";
import type { CssRect, PixelRect } from "./geometry";

/**
 * `visualEvidence` (Phase N, N1): the image-free summary of one capture — geometry and fingerprints, never pixels.
 *
 * MODULE-ONLY by owner decision of 2026-10-12: no run record, report, flow profile or IPC payload carries this shape
 * yet, so adding it changed no persisted contract. Persisting it is a later, separately reviewed step.
 */

export const VISUAL_EVIDENCE_VERSION = 1;
/** Serialised size ceiling for one evidence record (two fingerprints plus geometry). */
export const VISUAL_EVIDENCE_MAX_BYTES = 4096;

export interface VisualEvidenceBounds {
  requested: CssRect;
  actual: PixelRect;
  actualCss: CssRect;
  wasClipped: boolean;
}

export interface VisualEvidence {
  version: typeof VISUAL_EVIDENCE_VERSION;
  kind: "viewport" | "element";
  capturedAt: string;
  viewport: VisualViewportInfo;
  frame?: VisualFrameInfo;
  bounds?: VisualEvidenceBounds;
  contextBounds?: VisualEvidenceBounds;
  fingerprint: VisualFingerprint;
  contextFingerprint?: VisualFingerprint;
}

/** Summarise a capture. The returned value holds no image bytes and is safe to serialise. */
export function buildVisualEvidence(capture: VisualViewportCapture | VisualElementCapture): VisualResult<VisualEvidence> {
  if (capture.kind === "viewport") {
    const fingerprint = fingerprintVisualImage(capture.image);
    if (!fingerprint.ok) return fingerprint;
    return bounded({
      version: VISUAL_EVIDENCE_VERSION,
      kind: "viewport",
      capturedAt: capture.capturedAt,
      viewport: { ...capture.viewport },
      fingerprint: fingerprint.value
    });
  }

  const fingerprint = fingerprintVisualImage(capture.element.image);
  if (!fingerprint.ok) return fingerprint;
  const evidence: VisualEvidence = {
    version: VISUAL_EVIDENCE_VERSION,
    kind: "element",
    capturedAt: capture.capturedAt,
    viewport: { ...capture.viewport },
    frame: { ...capture.frame },
    bounds: {
      requested: { ...capture.element.requestedBounds },
      actual: { ...capture.element.actualBounds },
      actualCss: { ...capture.element.actualCssBounds },
      wasClipped: capture.element.wasClipped
    },
    fingerprint: fingerprint.value
  };
  if (capture.context) {
    const contextFingerprint = fingerprintVisualImage(capture.context.image);
    if (!contextFingerprint.ok) return contextFingerprint;
    evidence.contextBounds = {
      requested: { ...capture.context.requestedBounds },
      actual: { ...capture.context.actualBounds },
      actualCss: { ...capture.context.actualCssBounds },
      wasClipped: capture.context.wasClipped
    };
    evidence.contextFingerprint = contextFingerprint.value;
  }
  return bounded(evidence);
}

function bounded(evidence: VisualEvidence): VisualResult<VisualEvidence> {
  if (JSON.stringify(evidence).length > VISUAL_EVIDENCE_MAX_BYTES) {
    return visualFailure("FINGERPRINT_FAILED", "the visual evidence exceeds its size ceiling");
  }
  return visualSuccess(evidence);
}
