import {
  buildCandidateEvidence,
  captureCandidates,
  type VisualEvidence
} from "@src/visual";
import type { Locator, Page } from "playwright";

/**
 * Phase N, N4.2 (awkit-vra.13.2): the Recorder's ONE approved `src/visual` adapter (RV-1, amending the 2026-10-12
 * isolation decision and FD-2). `verify:visual-isolation` pins exactly two edges into `src/visual`: this file and the
 * runner's `VisualFusionStage`, both through the index only. Nothing else in `src/recorder` may import `src/visual`.
 *
 * It captures the N2-comparable evidence of ONE element the caller has already re-proved unique on the live page: a
 * single-candidate shared-capture cycle (`captureCandidates`) reduced by `buildCandidateEvidence`, exactly as the
 * runner's N2 reference refresh does, so a reference seeded here compares like one the runner wrote. It never scrolls,
 * focuses, clicks, types, writes a file or logs; the N0 cycle refuses an offscreen target (RV-7) and a protected
 * surface before and after its one screenshot. The result is evidence (geometry and fingerprints, never pixels) or a
 * bare `VisualErrorCode`; the caller maps the code to its own fixed text (RV-8).
 */

export type { VisualEvidence };

export type RecorderVisualCaptureOutcome =
  | { ok: true; evidence: VisualEvidence }
  | { ok: false; code: string };

export interface RecorderVisualCaptureRequest {
  page: Page;
  target: Locator;
  stepType: string;
  timeoutMs: number;
  signal: AbortSignal;
}

export async function captureRecorderVisualEvidence(request: RecorderVisualCaptureRequest): Promise<RecorderVisualCaptureOutcome> {
  const fanout = await captureCandidates(request.page, [{ id: "winner", target: request.target }], {
    timeoutMs: request.timeoutMs,
    signal: request.signal,
    stepType: request.stepType,
    // The service refuses before it gets here while a protected-login handoff is active.
    handedOff: false
  });
  if (!fanout.ok) return { ok: false, code: fanout.code };
  if (request.signal.aborted) return { ok: false, code: "CANCELLED" };
  const [own] = buildCandidateEvidence(fanout.value).candidates;
  if (!own) return { ok: false, code: "CAPTURE_UNAVAILABLE" };
  if (!own.evidence.ok) return { ok: false, code: own.evidence.code };
  return { ok: true, evidence: own.evidence.value };
}
