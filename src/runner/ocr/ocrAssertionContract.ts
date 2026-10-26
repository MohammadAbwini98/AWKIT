/**
 * The runner-side contract of N7.5 observe-only OCR assertions (Phase N, awkit-vra.9.6). Plan:
 * docs/plans/ai-upgrade-v5/N7-ocr-text-in-image.md (OC-0 to OC-12, ratified 2026-10-26).
 *
 * This module never imports `src/visual` (`verify:visual-isolation`): with OCR off, an `assertImageText` step is
 * recorded as `disabled` here without loading the adapter or forking the host.
 *
 *  - The FLAG (`AWKIT_VISUAL_OCR` = off | observe; default off, OC-6). There is no enforcing mode (OC-11).
 *  - ONE DEADLINE (1500 ms, OC-9) for the whole assertion: page resolution, checks, capture, preprocessing, the host's
 *    queue, start-up and recognition. Whatever loses it is inconclusive `budget-exhausted`, judged by the wall clock
 *    when the outcome lands (a verdict is never recorded after the deadline). The step settles within the deadline
 *    plus a 150 ms margin unless synchronous main-thread work holds the timers back; the record's `durationMs` is the
 *    whole operation, measured from the step's start.
 *  - OBSERVE ONLY: the step always passes. The verdict is a codes-only record, never a step status, a locator, an
 *    action, a branch or a retry.
 */

import type { Locator, Page } from "playwright";
import type { FlowStep } from "../../profiles/FlowProfile";
import type { OcrMatchMode } from "../../ocr/ocrExpectedText";
import type { OcrHostImage, OcrHostOutcome } from "../../ocr/OcrHostProtocol";

export type OcrAssertionMode = "off" | "observe";
export type OcrAssertionVerdict = "matched" | "differs" | "inconclusive";

/** OC-9: the whole-assertion deadline. */
export const OCR_ASSERTION_DEADLINE_MS = 1500;

/** OC-6: only the exact value `observe` turns OCR on; anything else, or nothing, is off. */
export function ocrAssertionMode(env: NodeJS.ProcessEnv = process.env): OcrAssertionMode {
  return env.AWKIT_VISUAL_OCR === "observe" ? "observe" : "off";
}

/** The recognizer main injects (the N7.4 `OcrUtilityHostManager`). Never rejects: words or a reason. */
export interface OcrRecognizer {
  recognize(image: OcrHostImage, options: { deadlineMs: number; signal?: AbortSignal }): Promise<OcrHostOutcome>;
  /**
   * Start the engine ahead of the request, so its start-up overlaps the capture instead of following it. Called only
   * once every pre-capture refusal has passed (a refused assertion never starts a host). Never throws.
   */
  prepare?(): void;
}

export interface OcrAssertionExpectation {
  /** The resolved expected text. Held in memory for the decision only; never recorded or logged. */
  text: string;
  match: OcrMatchMode;
  caseSensitive?: boolean;
  otpOrPinContext: boolean;
}

export interface OcrAssertionAssessRequest {
  step: FlowStep;
  page: Page;
  /** Resolves the step's target. Called only after the handoff and protected-surface checks passed. */
  target: () => Promise<Locator>;
  /** I5, fail-closed: only an explicit `false` lets a capture run. */
  handedOff: boolean;
  expected: OcrAssertionExpectation;
  deadlineMs: number;
  /** Runs the one screenshot under the run's screenshot limiter. */
  limitScreenshot: <T>(work: () => Promise<T>) => Promise<T>;
  /** The run's cancellation. */
  signal?: AbortSignal;
}

export interface OcrAssertionAssessment {
  verdict: OcrAssertionVerdict;
  code: string;
  distanceBucket?: string;
  confidenceBucket?: string;
  charCount?: number;
  durationMs: number;
}

/** The lazily loaded adapter (`OcrStep`), the fifth approved `src/visual` edge. */
export interface OcrAssertionAssessor {
  assess(request: OcrAssertionAssessRequest): Promise<OcrAssertionAssessment>;
}

/** The codes-only record of one assertion, for the report. Never text, pixels, boxes, selectors or URLs. */
export interface OcrAssertionRecord {
  stepId: string;
  flowId: string;
  mode: "observe";
  /** Observe never fails a step. */
  status: "passed";
  verdict?: OcrAssertionVerdict;
  code: string;
  distanceBucket?: string;
  confidenceBucket?: string;
  charCount?: number;
  durationMs: number;
}

/** What the runner hands the step executor. */
export interface OcrAssertionRuntime {
  mode: OcrAssertionMode;
  /** Loads the adapter on first use; never called when OCR is off or the expectation was refused. */
  assessor: () => Promise<OcrAssertionAssessor | undefined>;
  handedOff: (page: Page) => boolean;
  onRecord?: (record: OcrAssertionRecord) => void;
}
