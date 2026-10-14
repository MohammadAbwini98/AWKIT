import {
  buildCandidateEvidence,
  captureCandidates,
  VISUAL_EVIDENCE_MAX_BYTES,
  VISUAL_EVIDENCE_VERSION,
  type VisualEvidence
} from "@src/visual";
import type { Locator, Page } from "playwright";
import { VisualReferenceStore, type VisualReferenceWrite } from "../../runner/visualFusion/VisualReferenceStore";
import { recordedVisualReferenceKey } from "../../runner/visualFusion/recordedVisualReferenceKey";

/**
 * Phase N, N4.2 (awkit-vra.13.2): the Recorder's ONE approved `src/visual` adapter (RV-1, amending the 2026-10-12
 * isolation decision and FD-2). `verify:visual-isolation` pins exactly two edges into `src/visual`: this file and the
 * runner's `VisualFusionStage`, both through the index only. Nothing else in `src/recorder` may import `src/visual`.
 *
 * It captures the N2-comparable evidence of ONE element the caller has already re-proved unique on the live page: a
 * single-candidate shared-capture cycle (`captureCandidates`) reduced by `buildCandidateEvidence`, exactly as the
 * runner's N2 reference refresh does, so a reference seeded here compares like one the runner wrote. It never scrolls,
 * focuses, clicks, types or logs; the N0 cycle refuses an offscreen target (RV-7) and a protected surface before and
 * after its one screenshot. The result is evidence (geometry and fingerprints, never pixels) or a bare
 * `VisualErrorCode`; the caller maps the code to its own fixed text (RV-8).
 *
 * N4.3 (awkit-vra.13.3, RV-3): at save it also hands the bound references to the unchanged `VisualReferenceStore`,
 * which does the file I/O, under the recorded namespace key, with the runner's own evidence version, size cap and
 * digest, so the runner (N4.6) reads them as it reads its own.
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

/** N4.3: one captured reference bound to the saved flow's step it was captured for (see `buildRecordedFlow`). */
export interface RecordedVisualReferenceWrite {
  stepId: string;
  bindingDigest: string;
  evidence: unknown;
}

/** Per-reference outcome counts. `failed` includes a rate-limited write: either way the store does not hold it. */
export interface RecordedVisualPersistCounts {
  written: number;
  unchanged: number;
  refused: number;
  failed: number;
}

/** The same content digest the runner's stage stores and compares (`VisualFusionStage`), so both read one record. */
function digestOf(value: unknown): string | null {
  const digest = (value as VisualEvidence | null)?.fingerprint?.contentDigest;
  return typeof digest === "string" ? digest : null;
}

/** Store each reference under its recorded key. Never throws: a write the store cannot make is counted, not raised. */
export async function persistRecordedVisualReferences(
  folder: string,
  flowId: string,
  references: readonly RecordedVisualReferenceWrite[]
): Promise<RecordedVisualPersistCounts> {
  const counts: RecordedVisualPersistCounts = { written: 0, unchanged: 0, refused: 0, failed: 0 };
  const store = new VisualReferenceStore({ folder, evidenceVersion: VISUAL_EVIDENCE_VERSION, maxEvidenceBytes: VISUAL_EVIDENCE_MAX_BYTES, digestOf });
  for (const reference of references) {
    let outcome: VisualReferenceWrite;
    try {
      outcome = await store.refresh(recordedVisualReferenceKey(flowId, reference.stepId, reference.bindingDigest), reference.evidence);
    } catch {
      outcome = { status: "failed", code: "UNKNOWN" };
    }
    if (outcome.status === "written") counts.written += 1;
    else if (outcome.status === "unchanged") counts.unchanged += 1;
    else if (outcome.status === "refused") counts.refused += 1;
    else counts.failed += 1;
  }
  return counts;
}
