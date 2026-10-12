import type { VisualCandidateFanout } from "./capture";
import type { VisualResult } from "./errors";
import { buildVisualEvidence, type VisualEvidence } from "./visualEvidence";

/**
 * Per-candidate evidence of one shared-capture cycle (Phase N, N2.4 / awkit-vra.12.4). Each candidate's crop is reduced
 * to the unchanged N1 `VisualEvidence` (geometry and fingerprints, never pixels) and labelled with the `captureId` of
 * the one screenshot it was cut from, so a consumer can tell that every candidate was judged against the same moment.
 * MODULE-ONLY like `visualEvidence`: nothing persists this shape.
 */

export interface VisualCandidateEvidence {
  id: string;
  captureId: string | null;
  evidence: VisualResult<VisualEvidence>;
}

export interface VisualFanoutEvidence {
  captureId: string | null;
  candidates: VisualCandidateEvidence[];
  /** Fingerprinting every successful crop, in ms. */
  fingerprintMs: number;
  /** Serialised size of every successful evidence record. */
  evidenceBytes: number;
}

/** Summarise every candidate of a cycle. The result holds no image bytes and is safe to serialise. */
export function buildCandidateEvidence(fanout: VisualCandidateFanout): VisualFanoutEvidence {
  const started = performance.now();
  let evidenceBytes = 0;
  const candidates = fanout.candidates.map((candidate): VisualCandidateEvidence => {
    const evidence = candidate.result.ok ? buildVisualEvidence(candidate.result.value) : candidate.result;
    if (evidence.ok) evidenceBytes += JSON.stringify(evidence.value).length;
    return { id: candidate.id, captureId: candidate.captureId, evidence };
  });
  return { captureId: fanout.captureId, candidates, fingerprintMs: performance.now() - started, evidenceBytes };
}
