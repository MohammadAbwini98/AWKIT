import {
  VISUAL_DIAGNOSIS_MAX_EXAMINED,
  VISUAL_EVIDENCE_MAX_BYTES,
  VISUAL_EVIDENCE_VERSION,
  buildVisualEvidence,
  captureVisualFrame,
  checkProtectedSurface,
  cropFromVisualFrame,
  decideVisualDiagnosis,
  fingerprintVisualImage,
  releaseVisualFrame,
  type VisualDiagnosisEvidenceInput,
  type VisualDiagnosisInput,
  type VisualDiagnosisMember,
  type VisualDiagnosisRefusal,
  type VisualDiagnosisVerdict,
  type VisualEvidence
} from "@src/visual";
import type { ElementHandle, Locator, Page } from "playwright";
import { PROTECTED_LOGIN_STEP_TYPES, type FlowStep } from "@src/profiles/FlowProfile";
import { hasPositionalIdentityGuard } from "@src/profiles/locatorApproval";
import { LocatorFactory } from "../LocatorFactory";
import { stepCandidatesDigest } from "../LocatorRecoveryStore";
import { isInstrumentedClosedShadow } from "../closedShadowBridge";
import { resolveStepSafety } from "../runtime/StepSafetyPolicy";
import { VisualReferenceStore, type VisualReferenceRead } from "../visualFusion/VisualReferenceStore";
import { recordedVisualReferenceKey } from "../visualFusion/recordedVisualReferenceKey";
import {
  VISUAL_DIAGNOSIS_DEADLINE_MS,
  VISUAL_DIAGNOSIS_SIGNATURE_CAP,
  visualDiagnosisFailureKind,
  type VisualDiagnosisRecord,
  type VisualDiagnosisRequest,
  type VisualFailureDiagnoser
} from "./visualDiagnosisContract";
import { VISUAL_DIAGNOSIS_RECORD_MAX_OBSERVATIONS } from "./visualDiagnosisRecord";
import { OCR_TEXT_SIGNAL_DIAGNOSIS_CODES, type OcrTextSignalSource } from "../ocr/ocrAssertionContract";

/**
 * N5.3 (awkit-vra.14.3): the Visual Failure Diagnosis adapter. The third and last runner-side module allowed to import
 * `src/visual` (VD-1, `verify:visual-isolation`), through its public index only, and loaded lazily only when
 * `AWKIT_VISUAL_DIAGNOSIS=on`. Plan: docs/plans/ai-upgrade-v5/N5-visual-failure-diagnosis.md › Architecture.
 *
 * ADVISORY (VD-0). Called once, after the retry policy declined another attempt (VD-2). Its record goes to `onRecord`
 * and nowhere else: it never changes the step, its error, the retry decision, the cause or the run.
 *
 * READ-ONLY. The reference is read through `get` only, with N4.6 precedence (runtime, then the recorded key under
 * `AWKIT_VISUAL_RECORDER=manual`); nothing writes, refreshes or deletes a reference. DOM facts are counts, boxes and one
 * `elementFromPoint` probe; nothing clicks, focuses, hovers, scrolls or navigates.
 *
 * ONE FRAME (VD-3). At most one protected-guarded N0 viewport frame, whether or not a target exists. Crops of the
 * examined DOM-named set (the step's own primary-candidate matches, in DOM order, in the viewport, up to the cap) and a
 * whole-viewport fingerprint come from that frame, which is released on every path.
 *
 * ABORT AND SETTLE (VD-8). One abort signal and one deadline. Whichever settles first fills the single result slot,
 * which then closes: a later value is dropped, and the outstanding work is aborted and only releases what it holds.
 */

/** FD-6 / VD-2: the element steps a diagnosis may describe (the N2 eligible set). */
const ELIGIBLE_STEPS: ReadonlySet<string> = new Set(["click", "dblclick", "contextMenu", "clickAndHold", "fill", "select", "check", "uncheck", "radio"]);
/** VD-2: steps that hand the session to the user. */
const HANDOFF_STEPS: ReadonlySet<string> = new Set([...PROTECTED_LOGIN_STEP_TYPES, "manualHandoff"]);
/** The most step-locator matches counted (the policy's own count cap). */
const MAX_COUNT = 64;
/** Context crop padding, the N2 runtime capture option, so digests compare with stored references. */
const CONTEXT_PADDING_CSS = 24;
/** Bounds the per-signature cap table; the oldest signature is forgotten first. */
const SIGNATURE_ENTRIES = 4096;

const signatureCounts = new Map<string, number>();

/** VD-8: count one diagnosis for its signature; false once the cap is reached. */
function admit(signature: string): boolean {
  const next = (signatureCounts.get(signature) ?? 0) + 1;
  signatureCounts.delete(signature);
  signatureCounts.set(signature, next);
  while (signatureCounts.size > SIGNATURE_ENTRIES) signatureCounts.delete(signatureCounts.keys().next().value as string);
  return next <= VISUAL_DIAGNOSIS_SIGNATURE_CAP;
}

/** The store's change detector (unused for reads, required by its constructor). */
function digestOf(value: unknown): string | null {
  const digest = (value as VisualEvidence | null)?.fingerprint?.contentDigest;
  return typeof digest === "string" ? digest : null;
}

/** The only store surface the adapter holds: a read. */
export interface VisualDiagnosisReferenceReader {
  get(key: string): Promise<VisualReferenceRead>;
}

/** Verifier-only probes (`verify:visual-diagnosis-runtime`). Production passes none. */
export interface VisualDiagnosisProbe {
  hold?: (stage: "before-frame" | "after-frame") => Promise<void>;
  /** `late-released`: a frame that arrived after the work gave up, released without ever being used (N5.7 QC nit). */
  onFrame?: (event: "taken" | "released" | "late-released") => void;
  /** N5.7: the page is about to be inspected (handles, boxes, the masked check); never before the protected checks. */
  onInspect?: () => void;
  /** N5.7: element handles resolved and disposed, so a verifier can prove every handle is released. */
  onHandles?: (event: "resolved" | "disposed", count: number) => void;
}

export interface VisualFailureDiagnosisOptions {
  /** `<runtime root>/visual-references`, read only. */
  folder: string;
  /** I5, fail-closed: only an explicit `false` lets a capture run. */
  handedOff: (page: Page) => boolean;
  /** N4.6: read the Recorder-seeded key when the runtime one is missing (`AWKIT_VISUAL_RECORDER=manual`). */
  recordedFallback?: boolean;
  /** Where the settled record goes. Called exactly once per diagnosis; a throwing sink is ignored. */
  onRecord?: (record: VisualDiagnosisRecord) => void;
  deadlineMs?: number;
  /** Verifier override of the read; production builds a read-only view of the store from `folder`. */
  reader?: VisualDiagnosisReferenceReader;
  probe?: VisualDiagnosisProbe;
  /**
   * N7.7: the advisory OCR text signal, offered only with `AWKIT_VISUAL_OCR=observe`. Asked after the diagnosis is
   * decided, only for exactly one visible in-viewport match, with what is left of the deadline. It may add only
   * `target-text-differs-from-name` or `target-text-unreadable` (unverified OCR evidence); nothing else changes.
   */
  textSignal?: OcrTextSignalSource;
}

interface MemberBox {
  index: number;
  box: { x: number; y: number; width: number; height: number };
  isMainFrame: boolean;
  depth: number;
}

type MemberHandle = ElementHandle;

class DiagnosisAborted extends Error {}

export class VisualFailureDiagnosis implements VisualFailureDiagnoser {
  private readonly reader: VisualDiagnosisReferenceReader;
  private readonly deadlineMs: number;
  private inFlightCount = 0;

  constructor(private readonly options: VisualFailureDiagnosisOptions) {
    if (options.reader) {
      this.reader = options.reader;
    } else {
      const store = new VisualReferenceStore({
        folder: options.folder,
        evidenceVersion: VISUAL_EVIDENCE_VERSION,
        maxEvidenceBytes: VISUAL_EVIDENCE_MAX_BYTES,
        digestOf
      });
      // A read-only view: the adapter never holds the store itself, so no write path exists here.
      this.reader = { get: (key) => store.get(key) };
    }
    this.deadlineMs = options.deadlineMs ?? VISUAL_DIAGNOSIS_DEADLINE_MS;
  }

  /** Diagnoses whose work has not finished yet (including abandoned ones). Verifier diagnostics. */
  inFlight(): number {
    return this.inFlightCount;
  }

  async diagnoseFinalFailure(request: VisualDiagnosisRequest): Promise<VisualDiagnosisRecord | undefined> {
    const started = performance.now();
    // N5.7: a caller that already spent part of the deadline (the lazy loader) passes what is left; never more than ours.
    const deadlineMs = Math.min(this.deadlineMs, request.deadlineMs ?? this.deadlineMs);
    const controller = new AbortController();
    // The single-assignment slot: the first settlement wins and closes it.
    let slot: VisualDiagnosisRecord | undefined;
    let closed = false;
    const settle = (record: VisualDiagnosisRecord): void => {
      if (closed) return;
      closed = true;
      slot = record;
    };
    this.inFlightCount += 1;
    const cleanups: Array<() => void> = [];
    const work = this.run(request, controller.signal, started, deadlineMs, (cleanup) => cleanups.push(cleanup))
      .catch(() => this.refusal(request, "capture-failed", started))
      .then(settle)
      .finally(() => {
        for (const cleanup of cleanups) cleanup();
        this.inFlightCount -= 1;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        settle(this.refusal(request, "budget-exhausted", started));
        resolve();
      }, deadlineMs);
    });
    try {
      await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
      // Whatever is still running only releases what it holds; its value can no longer reach the slot.
      controller.abort();
    }
    const record = slot;
    if (record) {
      try {
        this.options.onRecord?.(record);
      } catch {
        // A sink is a recorder, not a participant.
      }
    }
    return record;
  }

  private async run(
    request: VisualDiagnosisRequest,
    signal: AbortSignal,
    started: number,
    deadlineMs: number,
    defer: (cleanup: () => void) => void
  ): Promise<VisualDiagnosisRecord> {
    const { step } = request;
    // A handoff step is named as such first: its cancellation is also a non-diagnosable error class.
    if (HANDOFF_STEPS.has(step.type)) return this.refusal(request, "handoff-active", started);
    const kind = visualDiagnosisFailureKind(request.errorClass);
    if (kind === "not-eligible" || kind === "page-closed") return this.refusal(request, kind, started);
    const spec = step.locator;
    if (!spec || !ELIGIBLE_STEPS.has(step.type) || hasPositionalIdentityGuard(step) || isInstrumentedClosedShadow(spec.context)) {
      return this.refusal(request, "not-eligible", started);
    }
    const safety = resolveStepSafety(step).sideEffectLevel;
    if (safety === "dangerousMutation" || safety === "externalCommit") return this.refusal(request, "sensitive", started);
    if (!admit(`${request.executionId}\u0000${request.flowId}\u0000${step.id}\u0000${kind}`)) return this.refusal(request, "coalesced", started);

    const aborted = new Promise<never>((_, reject) => {
      const fail = () => reject(new DiagnosisAborted());
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    });
    aborted.catch(() => undefined);
    const bounded = <T>(work: Promise<T>): Promise<T> => Promise.race([work, aborted]);

    const page = await bounded(request.page());
    if (!page || page.isClosed()) return this.refusal(request, "page-closed", started);
    if (this.handedOff(page)) return this.refusal(request, "protected-surface", started);
    // N5.7 (security finding 1): N0's protected-surface scan runs before anything inspects the page, so a sign-in or
    // one-time-code page the collector has not marked yet is refused with no handle, script or probe run inside it.
    // N0 still re-checks before and after its screenshot.
    if ((await bounded(checkProtectedSurface(page).catch(() => ({ protected: true as const })))).protected) {
      return this.refusal(request, "protected-surface", started);
    }

    const reference = await bounded(this.reference(request, step));

    let locator: Locator;
    try {
      locator = await bounded(new LocatorFactory(page).locateCandidate({ strategy: spec.strategy, value: spec.value, name: spec.name, exact: spec.exact }, spec.context));
    } catch (error) {
      if (error instanceof DiagnosisAborted) throw error;
      return this.refusal(request, "not-eligible", started);
    }
    this.options.probe?.onInspect?.();
    // N5.7: the step locator is resolved into at most MAX_COUNT handles; each member's facts then come from its handle,
    // dispatched together, with no per-member selector resolution. Boxes stay Playwright's `boundingBox()` (main-frame CSS
    // space, the reference capture's own source) so crops match stored references. Every handle is released when the
    // work unwinds, including after a deadline cut (security finding 3 / QC finding 4: never more handles than the cap).
    const total = await bounded(locator.count());
    const resolving: Promise<Array<ElementHandle | null>> =
      total <= MAX_COUNT
        ? locator.elementHandles()
        : Promise.all(
            Array.from({ length: MAX_COUNT }, (_, index) => locator.nth(index).elementHandle({ timeout: this.remaining(started, deadlineMs) }).catch(() => null))
          );
    defer(() => {
      void resolving.then(
        (all) => {
          const held = all.filter((handle): handle is ElementHandle => handle !== null);
          this.options.probe?.onHandles?.("resolved", held.length);
          return Promise.all(held.map((handle) => handle.dispose().catch(() => undefined))).then(() => this.options.probe?.onHandles?.("disposed", held.length));
        },
        () => undefined
      );
    });
    const handles = (await bounded(resolving)).slice(0, MAX_COUNT);
    const matches = handles.length;
    if (matches > 0 && (await bounded(this.masked(handles)))) return this.refusal(request, "sensitive", started);

    const viewport = await bounded(page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
    // Every counted match is measured, then the examined set is chosen in DOM order exactly as before.
    const measured = await bounded(Promise.all(handles.map((handle) => (handle ? handle.boundingBox().catch(() => null) : Promise.resolve(null)))));
    const chosen: Array<{ index: number; box: MemberBox["box"] }> = [];
    let target: VisualDiagnosisInput["dom"]["target"];
    for (let index = 0; index < matches && chosen.length < VISUAL_DIAGNOSIS_MAX_EXAMINED; index += 1) {
      const box = measured[index];
      // Position and size are separate facts: a zero-size element in the viewport is not offscreen. An element with no
      // box at all (`display: none`) has no position, so it is reported as zero-size only, never offscreen (QC finding 2).
      const zeroSize = !box || box.width <= 0 || box.height <= 0;
      const inViewport =
        !box || (box.x < viewport.width && box.y < viewport.height && box.x + Math.max(box.width, 1) > 0 && box.y + Math.max(box.height, 1) > 0);
      if (matches === 1) {
        const handle = handles[index];
        const occluded = handle && inViewport && !zeroSize ? await bounded(this.occluded(handle)) : false;
        target = { inViewport, zeroSize, occluded };
      }
      if (!box || !inViewport || zeroSize) continue;
      chosen.push({ index, box });
    }
    const frames = await bounded(Promise.all(chosen.map((slot) => this.frameOf(handles[slot.index]!))));
    const boxes: MemberBox[] = chosen.map((slot, at) => ({ ...slot, ...frames[at] }));

    await this.options.probe?.hold?.("before-frame");
    if (signal.aborted) throw new DiagnosisAborted();

    const members: VisualDiagnosisMember[] = [];
    let viewportInput: VisualDiagnosisInput["viewport"] = null;
    // N5.7 (security finding 4): the wait for the screenshot slot is bounded by the deadline too. A slot granted after
    // the cut takes no screenshot (N0 refuses an aborted signal at its first check, before the page is read), and a
    // frame that still arrives after the work gave up is released, so no pixels outlive the call.
    let kept = false;
    const shooting = request.limitScreenshot(() =>
      captureVisualFrame(page, { timeoutMs: this.remaining(started, deadlineMs), signal, stepType: step.type, handedOff: this.handedOff(page) })
    );
    defer(() => {
      void shooting.then(
        (late) => {
          if (kept || !late.ok) return;
          releaseVisualFrame(late.value);
          this.options.probe?.onFrame?.("late-released");
        },
        () => undefined
      );
    });
    const shot = await bounded(shooting);
    kept = true;
    if (!shot.ok) {
      viewportInput = { available: false, code: shot.code };
      for (const slot of boxes) members.push({ isTarget: matches === 1 && slot.index === 0, evidence: { available: false, code: shot.code } });
    } else {
      const frame = shot.value;
      this.options.probe?.onFrame?.("taken");
      try {
        const { cssWidth, cssHeight } = frame.viewport;
        const whole = cropFromVisualFrame(frame, { x: 0, y: 0, width: cssWidth, height: cssHeight }, 0);
        if (whole.ok) {
          const fingerprint = fingerprintVisualImage(whole.value.element.image);
          viewportInput = fingerprint.ok ? fingerprint.value : { available: false, code: fingerprint.code };
        } else {
          viewportInput = { available: false, code: whole.code };
        }
        for (const slot of boxes) {
          let evidence: VisualDiagnosisEvidenceInput;
          const crop = cropFromVisualFrame(frame, slot.box, CONTEXT_PADDING_CSS);
          if (!crop.ok) {
            evidence = { available: false, code: crop.code };
          } else {
            const built = buildVisualEvidence({
              kind: "element",
              viewport: { ...frame.viewport },
              frame: { isMainFrame: slot.isMainFrame, depth: slot.depth },
              element: crop.value.element,
              ...(crop.value.context ? { context: crop.value.context } : {}),
              capturedAt: frame.capturedAt,
              durationMs: 0
            });
            evidence = built.ok ? built.value : { available: false, code: built.code };
          }
          members.push({ isTarget: matches === 1 && slot.index === 0, evidence });
        }
        await this.options.probe?.hold?.("after-frame");
        if (signal.aborted) throw new DiagnosisAborted();
        // A member that moved since it was measured is not compared.
        // The same handles are re-measured (the N2 fan-out's recheck): a replaced or detached member is stale too.
        const rechecked = await bounded(Promise.all(boxes.map((slot) => handles[slot.index]!.boundingBox().catch(() => null))));
        for (let at = 0; at < boxes.length; at += 1) {
          const now = rechecked[at];
          const before = boxes[at].box;
          if (!now || now.x !== before.x || now.y !== before.y || now.width !== before.width || now.height !== before.height) {
            members[at] = { ...members[at], evidence: { available: false, code: "TARGET_STALE" } };
          }
        }
      } finally {
        releaseVisualFrame(frame);
        this.options.probe?.onFrame?.("released");
      }
    }

    const verdict = decideVisualDiagnosis({
      referenceSource: reference.source,
      reference: reference.evidence,
      dom: {
        targetMatches: matches,
        ...(matches === 1 && target ? { target } : {}),
        domNamed: matches,
        // N5.3: only the primary candidate's matches are examined, so a step with alternatives was cut short.
        contendersDropped: (spec.alternatives?.length ?? 0) > 0
      },
      members,
      viewport: viewportInput
    });
    // N7.7: advisory only, after the verdict is decided; a DOM-proven, unique, visible target only.
    const textCodes: string[] = [];
    if (this.options.textSignal && matches === 1 && target?.inViewport && !target.zeroSize && !signal.aborted) {
      const text = await bounded(
        this.options
          .textSignal({ page, target: locator, handedOff: this.handedOff(page), deadlineMs: this.remaining(started, deadlineMs), signal })
          .catch(() => undefined)
      );
      const code = text ? OCR_TEXT_SIGNAL_DIAGNOSIS_CODES[text.outcome] : undefined;
      if (code) textCodes.push(code);
    }
    const record = this.toRecord(request, kind, verdict, started);
    for (const code of textCodes) {
      if (record.observations.length < VISUAL_DIAGNOSIS_RECORD_MAX_OBSERVATIONS && !record.observations.includes(code)) record.observations.push(code);
    }
    return record;
  }

  /** Runtime key first; only a missing runtime reference falls back to the recorded key (N4.6). Read only. */
  private async reference(
    request: VisualDiagnosisRequest,
    step: FlowStep
  ): Promise<{ evidence: VisualDiagnosisInput["reference"]; source: VisualDiagnosisInput["referenceSource"] }> {
    const runtime = await this.reader.get(`${request.scenarioId}\u0000${request.flowId}\u0000${step.id}`);
    if (runtime.status === "found") return { evidence: runtime.evidence as VisualEvidence, source: "runtime" };
    if (runtime.status === "version-mismatch") return { evidence: { available: false, code: "UNSUPPORTED_FINGERPRINT_VERSION" }, source: "runtime" };
    if (runtime.status === "missing" && this.options.recordedFallback === true && step.locator) {
      const recorded = await this.reader.get(recordedVisualReferenceKey(request.flowId, step.id, stepCandidatesDigest(step.locator)));
      if (recorded.status === "found") return { evidence: recorded.evidence as VisualEvidence, source: "recorded" };
    }
    return { evidence: null, source: "none" };
  }

  /**
   * Masked credential, one-time-code, PIN, card or secret fields among the matches (the N4.2 rule). N5.7 (security
   * finding 2): checked on the very handles that are measured and cropped, so a page change between two lookups cannot
   * slip an unchecked field into the examined set. Any handle that cannot be read counts as masked (fail closed).
   */
  private async masked(handles: ReadonlyArray<ElementHandle | null>): Promise<boolean> {
    const verdicts = await Promise.all(
      handles.map((handle) =>
        handle === null
          ? Promise.resolve(false)
          : handle
              .evaluate((node) => {
                const element = node as Element;
                const control = element.tagName === "LABEL" ? ((element as HTMLLabelElement).control ?? element) : element;
                if (control.tagName !== "INPUT" && control.tagName !== "TEXTAREA") return false;
                const autocomplete = (control.getAttribute("autocomplete") ?? "").toLowerCase();
                if ((control.getAttribute("type") ?? "").toLowerCase() === "password") return true;
                if (/one-time-code|current-password|new-password|cc-number|cc-csc/.test(autocomplete)) return true;
                const described = [control.getAttribute("name"), control.id, autocomplete, control.getAttribute("aria-label"), control.getAttribute("placeholder")].join(" ");
                return /otp|one[-_ ]?time|passcode|\bpin\b|\bcvv\b|\bcvc\b|\bcsc\b|card[-_ ]?number|cardnumber|credit[-_ ]?card|\bssn\b|social[-_ ]?security|\bsecret\b|\btoken\b/i.test(described);
              })
              .catch(() => true)
      )
    );
    return verdicts.some(Boolean);
  }

  /**
   * Whether another element is topmost over the member, in its own document or shadow root. Read only. N5.7 (QC finding
   * 1): the probe asks the member's own root, so a target inside an open shadow root is not "covered" by its host, and it
   * probes the centre of the part inside the viewport, so a partly visible target is not "covered" by nothing. A member
   * with no visible part is never called occluded.
   */
  private occluded(member: MemberHandle): Promise<boolean> {
    return member
      .evaluate((node) => {
        const element = node as Element;
        const view = element.ownerDocument.defaultView;
        if (!view) return false;
        const rect = element.getBoundingClientRect();
        const left = Math.max(rect.left, 0);
        const right = Math.min(rect.right, view.innerWidth);
        const top = Math.max(rect.top, 0);
        const bottom = Math.min(rect.bottom, view.innerHeight);
        if (right <= left || bottom <= top) return false;
        const root = element.getRootNode() as Document | ShadowRoot;
        const hit = (typeof root.elementFromPoint === "function" ? root : element.ownerDocument).elementFromPoint((left + right) / 2, (top + bottom) / 2);
        return !(hit && (hit === element || element.contains(hit)));
      })
      .catch(() => false);
  }

  /** The member's frame depth (0 for the main frame). */
  private async frameOf(member: MemberHandle): Promise<{ isMainFrame: boolean; depth: number }> {
    let frame = await member.ownerFrame().catch(() => null);
    let depth = 0;
    while (frame?.parentFrame()) {
      depth += 1;
      frame = frame.parentFrame();
    }
    return { isMainFrame: depth === 0, depth };
  }

  /** I5, fail-closed: only an explicit `false` lets a capture run. */
  private handedOff(page: Page): boolean {
    try {
      return this.options.handedOff(page) !== false;
    } catch {
      return true;
    }
  }

  private remaining(started: number, deadlineMs: number): number {
    return Math.max(1, Math.round(deadlineMs - (performance.now() - started)));
  }

  private refusal(request: VisualDiagnosisRequest, code: VisualDiagnosisRefusal, started: number): VisualDiagnosisRecord {
    const kind = visualDiagnosisFailureKind(request.errorClass);
    return this.toRecord(request, kind === "not-eligible" || kind === "page-closed" ? "none" : kind, decideVisualDiagnosis({ refusal: code } as VisualDiagnosisInput), started);
  }

  private toRecord(
    request: VisualDiagnosisRequest,
    failureKind: VisualDiagnosisRecord["failureKind"],
    verdict: VisualDiagnosisVerdict,
    started: number
  ): VisualDiagnosisRecord {
    return {
      version: 1,
      stepId: request.step.id,
      attempt: request.attempt,
      failureKind,
      outcome: verdict.outcome,
      conditions: verdict.conditions,
      observations: [...verdict.observations],
      referenceSource: verdict.referenceSource,
      examined: verdict.examined,
      domNamed: verdict.domNamed,
      truncated: verdict.truncated,
      ...(verdict.identicalOthers ? { identicalOthers: verdict.identicalOthers } : {}),
      ms: Math.round(performance.now() - started)
    };
  }
}
