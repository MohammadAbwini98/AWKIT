import {
  TEXT_ASSERTION_INPUT_VERSION,
  captureElement,
  checkProtectedSurface,
  decideTextAssertion,
  detectSensitiveValue,
  preprocessForOcr,
  type TextAssertionDecision,
  type TextAssertionOcr,
  type TextAssertionRefusal,
  type VisualErrorCode
} from "@src/visual";
import type { ElementHandle, Locator, Page } from "playwright";
import { sensitiveTarget } from "../visualAssertion/sensitiveTarget";
import { OCR_ASSERTION_DEADLINE_MS, type OcrAssertionAssessment, type OcrAssertionAssessRequest, type OcrAssertionAssessor, type OcrRecognizer } from "./ocrAssertionContract";

/**
 * N7.5 (awkit-vra.9.6): the observe-only OCR assertion adapter. The FIFTH and only additional runner-side module allowed
 * to import `src/visual` (`verify:visual-isolation`), through its public index only, and loaded lazily only when
 * `AWKIT_VISUAL_OCR=observe` and the expectation passed OC-8. Plan: docs/plans/ai-upgrade-v5/N7-ocr-text-in-image.md ›
 * Architecture, Security and privacy boundaries.
 *
 * It only DESCRIBES: the N7.2 decision's verdict and codes. It never fails a step, picks or replaces a locator, acts,
 * retries or routes; the recognized words live in memory for the decision only and are never returned, logged or
 * stored.
 *
 * READ-ONLY on the page, in this order, every refusal BEFORE any capture or recognition request:
 *   OC-8 value re-check -> handoff -> protected surface -> the authored locator (no recovery or healing) -> exactly one
 *   element -> the N6.8 sensitive container -> visible -> one N0 guarded capture (strict protected window, re-checked
 *   before and after) -> N7.2 preprocessing (size, clipping, x-height) -> the injected recognizer -> the N7.2 decision.
 *
 * ONE DEADLINE (OC-9). The whole assessment settles within `deadlineMs`; whichever settles first fills the single result
 * slot. The recognizer is given the remaining deadline and settles its own request at it (the N7.4 manager drops the
 * late result); only the run's cancellation aborts it. A late result never changes the step or its record.
 */

/** A measured point of one assessment (N7.6 `benchmark:ocr`): names only, never text, pixels or selectors. */
export type OcrAssertionPhase = "protected-checked" | "target-checked" | "captured" | "preprocessed" | "recognized";

/** Verifier and benchmark probes (`verify:ocr-runtime`, `benchmark:ocr`). Production passes none. */
export interface OcrAssertionProbe {
  /** Called right before the one guarded capture is requested. */
  onCapture?: () => void;
  /** Called right before the recognizer is asked. */
  onRecognize?: () => void;
  /** Called as each phase completes, for the N7.6 timing breakdown. Never changes the order or the outcome. */
  onPhase?: (phase: OcrAssertionPhase) => void;
}

export interface OcrStepOptions {
  recognizer: OcrRecognizer;
  probe?: OcrAssertionProbe;
}

class AssertionAborted extends Error {}

/** N0 capture refusals and failures, as the decision's codes. */
const CAPTURE_CODES: Readonly<Partial<Record<VisualErrorCode, string>>> = {
  PROTECTED_SURFACE: "protected-surface",
  TARGET_OFFSCREEN: "target-offscreen",
  TARGET_NOT_UNIQUE: "target-not-unique",
  CAPTURE_STALE: "capture-stale",
  TARGET_STALE: "capture-stale",
  PAGE_CLOSED: "page-closed",
  BUDGET_EXHAUSTED: "budget-exhausted",
  CANCELLED: "cancelled"
};

/** Host failures that are permanent for the session; reported as themselves so the UI can name the reason. */
const UNAVAILABLE_REASONS = new Set(["assets-missing", "checksum-mismatch", "unsupported-cpu"]);

export class OcrStep implements OcrAssertionAssessor {
  constructor(private readonly options: OcrStepOptions) {}

  async assess(request: OcrAssertionAssessRequest): Promise<OcrAssertionAssessment> {
    const started = performance.now();
    const deadlineMs = Math.max(1, Math.min(OCR_ASSERTION_DEADLINE_MS, request.deadlineMs));
    const controller = new AbortController();
    // The recognizer enforces the deadline it is given and is aborted only by the run's cancellation, so a deadline
    // overrun stays the recognizer's to settle (N7.4 manager: answer at once, keep a warm host within its grace).
    const cancellation = new AbortController();
    const external = request.signal;
    const onExternalAbort = () => {
      cancellation.abort();
      controller.abort();
    };
    if (external?.aborted) onExternalAbort();
    else external?.addEventListener("abort", onExternalAbort, { once: true });

    let slot: OcrAssertionAssessment | undefined;
    // Late is judged by the wall clock when the result lands, not by which callback runs first: synchronous work on the
    // main thread can hold the deadline timer back, and a reply that arrives meanwhile must not become a verdict.
    const settle = (value: OcrAssertionAssessment): void => {
      if (slot) return;
      slot = performance.now() - started > deadlineMs && value.code !== "budget-exhausted" && value.code !== "cancelled" ? this.inconclusive(started, "budget-exhausted") : value;
    };
    const work = this.run(request, controller.signal, cancellation.signal, started, deadlineMs)
      .catch((error: unknown) => {
        if (external?.aborted) return this.inconclusive(started, "cancelled");
        if (error instanceof AssertionAborted) return this.inconclusive(started, "budget-exhausted");
        return this.inconclusive(started, pageClosed(request.page) ? "page-closed" : "capture-unavailable");
      })
      .then(settle);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        // Abort FIRST, in the timer's own turn: work queued behind a settling await sees the signal, so nothing after
        // the deadline can fill the slot. The recognizer's own deadline settles its request at the same moment.
        controller.abort();
        settle(this.inconclusive(started, "budget-exhausted"));
        resolve();
      }, deadlineMs);
    });
    try {
      await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
      controller.abort();
    }
    return slot ?? this.inconclusive(started, "budget-exhausted");
  }

  private async run(request: OcrAssertionAssessRequest, signal: AbortSignal, cancelled: AbortSignal, started: number, deadlineMs: number): Promise<OcrAssertionAssessment> {
    const { step, page, expected } = request;
    const aborted = new Promise<never>((_, reject) => {
      const fail = () => reject(new AssertionAborted());
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    });
    aborted.catch(() => undefined);
    const bounded = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, aborted]);
    const refuse = (refusal: TextAssertionRefusal) => this.decided(started, decideTextAssertion({ version: TEXT_ASSERTION_INPUT_VERSION, expected: { text: expected.text, match: expected.match }, refusal }));

    if (step.type !== "assertImageText") return this.inconclusive(started, "input-invalid");
    // OC-8, again at the last moment before the page is touched: a sensitive value is never compared.
    if (detectSensitiveValue(expected.text, { otpOrPinContext: expected.otpOrPinContext }) !== null) return refuse("sensitive-input");
    if (pageClosed(page)) return this.inconclusive(started, "page-closed");
    // I5, fail-closed: only an explicit `false` lets anything touch the page.
    if (request.handedOff !== false) return refuse("handoff-active");
    if ((await bounded(checkProtectedSurface(page).catch(() => ({ protected: true as const })))).protected) return refuse("protected-surface");
    this.options.probe?.onPhase?.("protected-checked");

    let target: Locator;
    try {
      target = await bounded(request.target());
    } catch (error) {
      if (error instanceof AssertionAborted) throw error;
      return refuse("target-not-found");
    }
    const count = await bounded(target.count());
    if (count === 0) return refuse("target-not-found");
    if (count > 1) return refuse("target-not-unique");
    let handle: ElementHandle | null = null;
    try {
      handle = await bounded(target.elementHandle({ timeout: remaining(started, deadlineMs) }));
      if (!handle) return refuse("target-not-found");
      // Three independent read-only reads, together (each is a page round trip); the refusal order is unchanged.
      const element = handle;
      const [sensitive, visible, fontSizeCssPx] = await bounded(Promise.all([sensitiveTarget(element), element.isVisible(), smallestTextSize(element)]));
      if (sensitive) return refuse("sensitive-step");
      if (!visible) return refuse("target-hidden");
      this.options.probe?.onPhase?.("target-checked");

      if (signal.aborted) throw new AssertionAborted();
      // Every pre-capture refusal has passed: start a cold engine now, so its start-up runs alongside the capture.
      try {
        this.options.recognizer.prepare?.();
      } catch {
        // A recognizer that cannot prepare answers the request itself.
      }
      this.options.probe?.onCapture?.();
      const shot = await bounded(
        request.limitScreenshot(() =>
          captureElement(page, target, {
            timeoutMs: remaining(started, deadlineMs),
            signal,
            contextPaddingCss: 0,
            stillness: true,
            stepType: step.type,
            handedOff: request.handedOff
          })
        )
      );
      this.options.probe?.onPhase?.("captured");
      if (!shot.ok) return this.inconclusive(started, CAPTURE_CODES[shot.code] ?? "capture-unavailable");
      const capture = shot.value;
      const prepared = preprocessForOcr({
        image: capture.element.image,
        fontSizeCssPx,
        devicePixelRatio: capture.viewport.devicePixelRatio,
        clipped: capture.element.wasClipped
      });
      this.options.probe?.onPhase?.("preprocessed");
      if (!prepared.ok) return prepared.code === "input-invalid" ? this.inconclusive(started, "capture-unavailable") : refuse(prepared.code);

      if (signal.aborted) throw new AssertionAborted();
      this.options.probe?.onRecognize?.();
      const outcome = await bounded(
        this.options.recognizer.recognize({ width: prepared.width, height: prepared.height, gray: prepared.gray, psm: 6 }, { deadlineMs: remaining(started, deadlineMs), signal: cancelled })
      );
      this.options.probe?.onPhase?.("recognized");
      if (!outcome.ok && UNAVAILABLE_REASONS.has(outcome.reason)) return this.inconclusive(started, outcome.reason);
      const ocr: TextAssertionOcr = outcome.ok
        ? { ok: true, words: outcome.words }
        : { ok: false, code: outcome.reason === "ocr-busy" || outcome.reason === "budget-exhausted" || outcome.reason === "cancelled" ? outcome.reason : "ocr-unavailable" };
      return this.decided(
        started,
        decideTextAssertion({
          version: TEXT_ASSERTION_INPUT_VERSION,
          expected: {
            text: expected.text,
            match: expected.match,
            ...(expected.caseSensitive !== undefined ? { caseSensitive: expected.caseSensitive } : {}),
            otpOrPinContext: expected.otpOrPinContext
          },
          ocr
        })
      );
    } finally {
      if (handle) void handle.dispose().catch(() => undefined);
    }
  }

  private decided(started: number, decision: TextAssertionDecision): OcrAssertionAssessment {
    return {
      verdict: decision.verdict,
      code: decision.code,
      ...(decision.distanceBucket ? { distanceBucket: decision.distanceBucket } : {}),
      ...(decision.confidenceBucket ? { confidenceBucket: decision.confidenceBucket } : {}),
      ...(decision.charCount !== null ? { charCount: decision.charCount } : {}),
      durationMs: Math.round(performance.now() - started)
    };
  }

  private inconclusive(started: number, code: string): OcrAssertionAssessment {
    return { verdict: "inconclusive", code, durationMs: Math.round(performance.now() - started) };
  }
}

function pageClosed(page: Page): boolean {
  try {
    return page.isClosed();
  } catch {
    return true;
  }
}

function remaining(started: number, deadlineMs: number): number {
  return Math.max(1, Math.round(deadlineMs - (performance.now() - started)));
}

/**
 * The smallest computed font size of the text the element shows, in CSS px (the x-height floor follows the smallest
 * text). A bounded, read-only walk; an element without text answers with its own size.
 */
function smallestTextSize(handle: ElementHandle): Promise<number> {
  return handle.evaluate((node) => {
    const element = node as Element;
    let smallest = Number.parseFloat(getComputedStyle(element).fontSize) || 16;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let visited = 0;
    for (let text = walker.nextNode(); text && visited < 500; text = walker.nextNode(), visited += 1) {
      if (!text.textContent?.trim() || !text.parentElement) continue;
      const size = Number.parseFloat(getComputedStyle(text.parentElement).fontSize);
      if (size > 0 && size < smallest) smallest = size;
    }
    return smallest;
  });
}
