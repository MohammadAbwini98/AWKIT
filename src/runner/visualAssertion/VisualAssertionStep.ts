import {
  VISUAL_ASSERTION_INPUT_VERSION,
  VISUAL_ASSERTION_POLICY_VERSION,
  VISUAL_FINGERPRINT_VERSION,
  captureElement,
  checkProtectedSurface,
  decideVisualAssertion,
  fingerprintVisualImage,
  type VisualAssertionBaseline,
  type VisualAssertionConditions,
  type VisualAssertionDecision,
  type VisualAssertionGeometry,
  type VisualAssertionRefusal,
  type VisualErrorCode
} from "@src/visual";
import type { ElementHandle, Locator, Page } from "playwright";
import { sensitiveTarget } from "./sensitiveTarget";
import { visualStepContentDigest } from "./stepContentDigest";
import type { VisualBaselineStore, VisualGrantEnvironment } from "./VisualBaselineStore";
import { VISUAL_CALIBRATION_SUITE_VERSION } from "./VisualBaselineStore";
import type { VisualAssertionCandidates, VisualCandidateReason } from "./visualAssertionCandidates";
import {
  VISUAL_ASSERTION_DEADLINE_MS,
  visualAssertionOsBuild as osBuild,
  visualAssertionStepMode,
  type VisualAssertionAssessment,
  type VisualAssertionAssessRequest,
  type VisualAssertionAssessor,
  type VisualAssertionCell,
  type VisualAssertionRunInitiator,
  type VisualCandidateWithheld,
  type VisualGrantStatus
} from "./visualAssertionContract";

/**
 * N6.4 (awkit-vra.15.4): the runtime visual assertion adapter. The fourth runner-side module allowed to import
 * `src/visual` (`verify:visual-isolation`), through its public index only, and loaded lazily only when
 * `AWKIT_VISUAL_ASSERTIONS` is `observe` or `enforce`. Plan: docs/plans/ai-upgrade-v5/N6-visual-assertions.md ›
 * Architecture and data flow, VA-4, VA-9, VA-13, VA-15.
 *
 * It only DESCRIBES: it returns the N6.2 policy verdict, the cell's grant status (when asked) and whether a pending
 * candidate was created. The step status is decided by `decideVisualAssertionStepStatus` in the contract module.
 *
 * READ-ONLY on the page. Nothing clicks, hovers, focuses, scrolls or navigates. The handoff and protected-surface
 * checks run before the target is resolved, so a sign-in or one-time-code page is refused with no locator query, and
 * N0 re-checks before and after its one screenshot. A sensitive input (password, one-time code, card number) is
 * refused before capture.
 *
 * ONE DEADLINE (VA-9). The whole assessment, including the target resolution, the guarded capture and the baseline
 * read, settles within `deadlineMs`; whichever settles first fills the single result slot. A late result is dropped
 * and never creates a candidate.
 */

/** VA-15: the capture policy identifier bound into the conditions key and every grant. */
export const VISUAL_ASSERTION_CAPTURE_POLICY = "awkit-va15-v1";

/**
 * The current observation's commitment when no baseline record is present. The policy validates the observation's
 * shape before it reads the baseline status, but it compares commitments only against a `present` record, so this
 * value is never compared with anything. A `present` record is always paired with the real keyed commitment.
 */
const UNCOMPARED_COMMITMENT = "0".repeat(64);

const CANDIDATE_CODES: Readonly<Record<string, VisualCandidateReason>> = {
  "no-baseline": "no-baseline",
  "binding-changed": "binding-changed",
  "baseline-other-conditions": "baseline-other-conditions",
  "baseline-unreadable": "baseline-unreadable"
};

/** Verifier-only probes (`verify:visual-assertion-runtime`). Production passes none. */
export interface VisualAssertionProbe {
  hold?: (stage: "before-capture" | "after-capture") => Promise<void>;
  /** Called right before the one guarded capture is requested. */
  onCapture?: () => void;
}

export interface VisualAssertionStepOptions {
  store: VisualBaselineStore;
  appVersion: string;
  /** The main process's candidate registry (memory only). */
  candidates: VisualAssertionCandidates;
  /**
   * The run's authenticated initiator (VA-13). Absent, an eligible run makes NO candidate (`run-unattributed`): an
   * approval must never bind a run user that was not authenticated.
   */
  initiator?: VisualAssertionRunInitiator;
  probe?: VisualAssertionProbe;
}

class AssertionAborted extends Error {}

interface Environment {
  browserVersion: string;
  devicePixelRatio: number;
  cssWidth: number;
  cssHeight: number;
  colorScheme: "light" | "dark";
  forcedColors: "none" | "active";
  reducedMotion: "no-preference" | "reduce";
  locale: string;
  timeZone: string;
}

export class VisualAssertionStep implements VisualAssertionAssessor {
  constructor(private readonly options: VisualAssertionStepOptions) {}

  async assess(request: VisualAssertionAssessRequest): Promise<VisualAssertionAssessment> {
    const started = performance.now();
    const deadlineMs = Math.max(1, Math.min(VISUAL_ASSERTION_DEADLINE_MS, request.deadlineMs));
    const controller = new AbortController();
    const external = request.signal;
    const onExternalAbort = () => controller.abort();
    if (external?.aborted) controller.abort();
    else external?.addEventListener("abort", onExternalAbort, { once: true });

    let slot: VisualAssertionAssessment | undefined;
    const settle = (value: VisualAssertionAssessment): void => {
      slot ??= value;
    };
    const work = this.run(request, controller.signal, started, deadlineMs)
      .catch((error: unknown) => {
        if (external?.aborted) return this.finish(started, { refusalCode: "cancelled" });
        if (error instanceof AssertionAborted) return this.finish(started, { refusalCode: "budget-exhausted" });
        return this.finish(started, { refusalCode: pageClosed(request.page) ? "page-closed" : "capture-unavailable" });
      })
      .then(settle);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        // Abort FIRST, in the timer's own turn: work already queued behind a settling await then sees the signal and can
        // never add a candidate for a step that reports budget-exhausted (N6.8 QC finding 1).
        controller.abort();
        settle(this.finish(started, { refusalCode: "budget-exhausted" }));
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
    return slot ?? this.finish(started, { refusalCode: "budget-exhausted" });
  }

  private async run(request: VisualAssertionAssessRequest, signal: AbortSignal, started: number, deadlineMs: number): Promise<VisualAssertionAssessment> {
    const { step, page } = request;
    const aborted = new Promise<never>((_, reject) => {
      const fail = () => reject(new AssertionAborted());
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    });
    aborted.catch(() => undefined);
    const bounded = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, aborted]);
    const refuse = (refusal: VisualAssertionRefusal) => this.finish(started, { decision: decideVisualAssertion({ version: VISUAL_ASSERTION_INPUT_VERSION, refusal }) });

    if (step.type !== "assertVisual") return this.finish(started, { refusalCode: "capture-unavailable" });
    if (pageClosed(page)) return this.finish(started, { refusalCode: "page-closed" });
    // I5, fail-closed: only an explicit `false` lets anything touch the page.
    if (request.handedOff !== false) return refuse("handoff-active");
    if ((await bounded(checkProtectedSurface(page).catch(() => ({ protected: true as const })))).protected) return refuse("protected-surface");

    // Exactly one visible element, resolved read-only.
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
      if (await bounded(sensitiveTarget(handle))) return refuse("sensitive-step");
      if (!(await bounded(handle.isVisible()))) return refuse("target-hidden");
      const facts = await bounded(elementFacts(handle));
      const environment = await bounded(readEnvironment(page));
      if (!environment) return this.finish(started, { refusalCode: "capture-unavailable" });
      const cell: VisualAssertionCell = { renderMode: request.renderMode, devicePixelRatio: environment.devicePixelRatio };
      const grant = request.readGrant ? await bounded(this.grantFor(cell, environment)) : undefined;
      // C3 / VA-13: the epoch is read BEFORE the capture, so any invalidation after this point (an identical re-import
      // included) makes the candidate stale. Every written flow has a token (VA-5); a flow copied in from outside the
      // app gets one inside the lane here, still before the capture. Unavailable, no candidate can bind one.
      const epoch = await bounded(
        this.options.store.layout
          .readToken(request.flowId)
          .then((token) => token ?? this.options.store.ensureToken(request.flowId))
          .catch(() => null)
      );

      await this.options.probe?.hold?.("before-capture");
      if (signal.aborted) throw new AssertionAborted();
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
      await this.options.probe?.hold?.("after-capture");
      if (!shot.ok) return this.finish(started, { decision: captureFailure(shot.code), grant, cell });
      const capture = shot.value;
      const fingerprint = fingerprintVisualImage(capture.element.image);
      if (!fingerprint.ok) return this.finish(started, { decision: captureFailure(fingerprint.code), grant, cell });

      const conditions: VisualAssertionConditions = {
        renderMode: request.renderMode,
        browserVersion: environment.browserVersion,
        appVersion: this.options.appVersion,
        osBuild: osBuild(),
        devicePixelRatio: capture.viewport.devicePixelRatio,
        cssWidth: capture.viewport.cssWidth,
        cssHeight: capture.viewport.cssHeight,
        colorScheme: environment.colorScheme,
        forcedColors: environment.forcedColors,
        reducedMotion: environment.reducedMotion,
        locale: environment.locale,
        timeZone: environment.timeZone,
        frameDepth: capture.frame.depth,
        isMainFrame: capture.frame.isMainFrame,
        capturePolicy: VISUAL_ASSERTION_CAPTURE_POLICY,
        fingerprintVersion: VISUAL_FINGERPRINT_VERSION,
        assertionPolicyVersion: VISUAL_ASSERTION_POLICY_VERSION
      };
      const bounds = capture.element.requestedBounds;
      const geometry: VisualAssertionGeometry = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        clipped: capture.element.wasClipped,
        hover: facts.hover,
        focus: facts.focus
      };
      const image = capture.element.image;
      const stepContentDigest = visualStepContentDigest(step as unknown as { id: string } & Record<string, unknown>);
      const store = this.options.store;
      const keyGeneration = await bounded(store.keyGeneration().catch(() => null));
      const lookup = await bounded(store.lookup({ flowId: request.flowId, stepId: step.id, stepContentDigest, conditions }));
      let baseline: VisualAssertionBaseline;
      let commitment = UNCOMPARED_COMMITMENT;
      if (lookup.status === "present") {
        const current =
          epoch === null
            ? ({ ok: false } as const)
            : await bounded(
                store.commitmentFor({
                  flowId: request.flowId,
                  stepId: step.id,
                  stepContentDigest,
                  conditions,
                  epoch,
                  width: image.width,
                  height: image.height,
                  contentDigest: fingerprint.value.contentDigest
                })
              );
        if (current.ok) {
          commitment = current.commitment;
          baseline = { status: "present", conditions: lookup.conditions as unknown as VisualAssertionConditions, geometry: lookup.geometry, commitment: lookup.commitment };
        } else {
          baseline = { status: "integrity-unavailable" };
        }
      } else {
        baseline = { status: lookup.status };
      }
      const decision = decideVisualAssertion({
        version: VISUAL_ASSERTION_INPUT_VERSION,
        capture: { ok: true, observation: { conditions, geometry, commitment } },
        baseline
      });

      // VA-13: a pending candidate only after a successful, unclipped capture, while the key is usable, bound to the epoch.
      let candidateId: string | undefined;
      let candidateWithheld: VisualCandidateWithheld | undefined;
      const reason = CANDIDATE_CODES[decision.code];
      const initiator = this.options.initiator;
      const eligible = reason !== undefined && epoch !== null && keyGeneration !== null && !geometry.clipped && !signal.aborted;
      if (eligible && !initiator) {
        candidateWithheld = "run-unattributed";
      } else if (eligible && initiator) {
        candidateId = this.options.candidates.add({
          executionId: request.executionId,
          instanceId: request.instanceId,
          flowId: request.flowId,
          stepId: step.id,
          mode: visualAssertionStepMode(step),
          reason,
          epoch,
          stepContentDigest,
          conditions,
          geometry,
          keyGeneration,
          initiator,
          contentDigest: fingerprint.value.contentDigest,
          width: image.width,
          height: image.height,
          preview: { width: image.width, height: image.height, rgba: image.data }
        });
      }
      return this.finish(started, { decision, grant, cell, candidateId, candidateWithheld });
    } finally {
      if (handle) void handle.dispose().catch(() => undefined);
    }
  }

  /** The cell's grant for this environment. Read only when the gate asked (non-packaged, enforce flag and step). */
  private grantFor(cell: VisualAssertionCell, environment: Environment): Promise<VisualGrantStatus> {
    return this.options.store.grantStatus(cell, visualAssertionGrantEnvironment(environment.browserVersion, this.options.appVersion)).catch((): VisualGrantStatus => "invalidated");
  }

  private finish(
    started: number,
    result: {
      decision?: VisualAssertionDecision;
      refusalCode?: string;
      grant?: VisualGrantStatus;
      cell?: VisualAssertionCell;
      candidateId?: string;
      candidateWithheld?: VisualCandidateWithheld;
    }
  ): VisualAssertionAssessment {
    const decision = result.decision ?? { verdict: "inconclusive" as const, code: result.refusalCode ?? "capture-unavailable" };
    return {
      verdict: decision.verdict,
      code: decision.code,
      ...(result.grant ? { grant: result.grant } : {}),
      ...(result.cell ? { cell: result.cell } : {}),
      ...(result.candidateId ? { candidateId: result.candidateId } : {}),
      ...(result.candidateWithheld ? { candidateWithheld: result.candidateWithheld } : {}),
      durationMs: Math.round(performance.now() - started)
    };
  }
}

/**
 * The environment a grant binds besides its cell (VA-12). The ONE definition: the runtime gate reads grants with it and
 * the N6.6 calibration root records evidence and issues grants with it, so the two can never drift apart.
 */
export function visualAssertionGrantEnvironment(browserVersion: string, appVersion: string): VisualGrantEnvironment {
  return {
    browserVersion,
    appVersion,
    osBuild: osBuild(),
    capturePolicy: VISUAL_ASSERTION_CAPTURE_POLICY,
    fingerprintVersion: VISUAL_FINGERPRINT_VERSION,
    assertionPolicyVersion: VISUAL_ASSERTION_POLICY_VERSION,
    calibrationSuiteVersion: VISUAL_CALIBRATION_SUITE_VERSION
  };
}

function captureFailure(code: VisualErrorCode): VisualAssertionDecision {
  return decideVisualAssertion({ version: VISUAL_ASSERTION_INPUT_VERSION, capture: { ok: false, code } });
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

/** Read-only interaction state: whether the element is hovered or focused right now. Nothing is moved or focused. */
function elementFacts(handle: ElementHandle): Promise<{ hover: boolean; focus: boolean }> {
  return handle.evaluate((node) => {
    const element = node as Element;
    return { hover: element.matches(":hover"), focus: element.matches(":focus") };
  });
}

/** The page-level conditions (VA-4). Null when any is missing, so nothing is compared under unknown conditions. */
async function readEnvironment(page: Page): Promise<Environment | null> {
  const facts = await page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    cssWidth: window.innerWidth,
    cssHeight: window.innerHeight,
    colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    forcedColors: window.matchMedia("(forced-colors: active)").matches ? "active" : "none",
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "no-preference",
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: navigator.userAgent
  }));
  let browserVersion: string | undefined;
  try {
    browserVersion = page.context().browser()?.version();
  } catch {
    browserVersion = undefined;
  }
  // A persistent context has no Browser object; its full version is the user agent's.
  browserVersion ||= /(?:HeadlessChrome|Chrome|Chromium)\/([\d.]+)/.exec(facts.userAgent)?.[1];
  if (!browserVersion || !facts.locale || !facts.timeZone || !(facts.devicePixelRatio > 0)) return null;
  return {
    browserVersion,
    devicePixelRatio: facts.devicePixelRatio,
    cssWidth: facts.cssWidth,
    cssHeight: facts.cssHeight,
    colorScheme: facts.colorScheme as Environment["colorScheme"],
    forcedColors: facts.forcedColors as Environment["forcedColors"],
    reducedMotion: facts.reducedMotion as Environment["reducedMotion"],
    locale: facts.locale,
    timeZone: facts.timeZone
  };
}
