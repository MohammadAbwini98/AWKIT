import {
  VISUAL_DIAGNOSIS_MAX_EXAMINED,
  VISUAL_EVIDENCE_MAX_BYTES,
  VISUAL_EVIDENCE_VERSION,
  buildVisualEvidence,
  captureVisualFrame,
  checkProtectedSurface,
  cropFromVisualFrame,
  MEASURED_VISUAL_ROWS_POLICY,
  MEASURED_VISUAL_STATE_POLICY,
  VISUAL_ROWS_MAX_ROWS,
  decideVisualDiagnosis,
  decideVisualRows,
  decideVisualState,
  fingerprintVisualImage,
  measureVisualMotion,
  measureVisualMotionPlane,
  measureVisualStateFrame,
  releaseVisualFrame,
  type VisualDiagnosisEvidenceInput,
  type VisualDiagnosisInput,
  type VisualDiagnosisMember,
  type VisualDiagnosisRefusal,
  type VisualDiagnosisVerdict,
  type VisualEvidence,
  type VisualMotion,
  type VisualImage,
  type VisualRowsBox,
  type VisualRowsInput,
  type VisualRowsPolicy,
  type VisualRowsVerdict,
  type VisualStateFrame,
  type VisualStateFrameFeatures,
  type VisualStatePolicy,
  type VisualStateVerdict
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
  VISUAL_DIAGNOSIS_SYNC_RESERVE_MS,
  visualDiagnosisSyncReserveMs,
  visualDiagnosisWorkBudget,
  VISUAL_ROWS_MIN_REMAINING_MS,
  VISUAL_STATE_INTERVAL_MS,
  VISUAL_STATE_MIN_REMAINING_MS,
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
  /** N8: the row decision and how long the row work took (benchmark:visual-rows). */
  onRows?: (event: { verdict: VisualRowsVerdict; ms: number }) => void;
  /** N9: the state decision with its measured numbers and how long the state work took (benchmark:visual-state). */
  onState?: (event: { features: VisualStateFrameFeatures; motion: VisualMotion | null; verdict: VisualStateVerdict; ms: number }) => void;
  /** N8 QC finding 7: the container crop was taken from the frame, or dropped (always before the frame is released). */
  onRowCrop?: (event: "taken" | "dropped") => void;
  /** Security Sec 1-2 (2026-11-01): frame 1 (N5's) or 2 (N9's second) was just taken and is held, before any crop. */
  heldFrame?: (index: 1 | 2) => Promise<void>;
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
  /**
   * N9 (awkit-vra.11, NS-2): screenshot state evidence, only with `AWKIT_VISUAL_STATE=on`. After the verdict is decided
   * it adds one `visual-state-*` code from N5's own frame plus at most one more guarded frame for motion (NS-D1).
   * Nothing else changes, and with it off the adapter takes at most one frame exactly as before.
   */
  stateRecognition?: boolean;
  /** Verifier and development-baseline override; production passes none (MEASURED_VISUAL_STATE_POLICY). */
  statePolicy?: Readonly<VisualStatePolicy>;
  /**
   * Verifier-only: the settle margin (default VISUAL_DIAGNOSIS_SETTLE_MARGIN_MS). `verify:visual-diagnosis-deadline`
   * passes 0 to reproduce the original late settlement; production passes none.
   */
  settleMarginMs?: number;
  /**
   * N8 (awkit-vra.10, NR-3): row/grid evidence, only with `AWKIT_VISUAL_ROWS=on`. The DOM proves the container and its
   * rows (read only); one crop of N5's own frame corroborates them. Adds at most three `rows-*` / `row-association-*`
   * codes after the verdict. No extra frame, no interaction; with it off nothing is read.
   */
  rowEvidence?: boolean;
  /** Verifier and development-baseline override; production passes none (MEASURED_VISUAL_ROWS_POLICY). */
  rowsPolicy?: Readonly<VisualRowsPolicy>;
}

/** N8: what makes an element a row, for the DOM read (plan § 2). */
const ROW_SELECTOR = 'tr, [role="row"], li, [role="listitem"]';

interface RowFacts {
  container: VisualRowsBox;
  rows: VisualRowsBox[];
  totalRows: number;
  declaredRows: number | null;
  members: Array<{ box: VisualRowsBox; rowIndex: number; topmost: boolean }>;
}

interface MemberBox {
  index: number;
  box: { x: number; y: number; width: number; height: number };
  isMainFrame: boolean;
  depth: number;
}

type MemberHandle = ElementHandle;

class DiagnosisAborted extends Error {}
/** The work budget ran out at a checkpoint before synchronous work could start: truthfully `budget-exhausted`. */
class DiagnosisOverBudget extends Error {}

/**
 * Security (2026-11-01 review, S1 and Sec 1-2): the one advisory refusal boundary. A frame N0 refused because the surface
 * is protected, or the page navigated or closed during capture (the first frame or N9's second), withdraws every N7.7, N8
 * and N9 code of that diagnosis, as do a refused verdict and a handoff that became active while it ran. N5's own record
 * keeps its meaning and its refusal codes: nothing derived from a page N0 would not capture is added to it.
 */
const ADVISORY_REFUSALS: ReadonlySet<string> = new Set(["PROTECTED_SURFACE", "CAPTURE_STALE", "PAGE_CLOSED"]);
/** The same refusals as N7.7's text signal reports them (its own N0 frame, protected scan and handoff check). */
const TEXT_SIGNAL_REFUSALS: ReadonlySet<string> = new Set(["protected-surface", "handoff-active", "page-closed", "capture-stale"]);
/** An unavailable capture result whose code is one of ADVISORY_REFUSALS. */
const refusedCapture = (capture: unknown): boolean =>
  !!capture && typeof capture === "object" && (capture as { available?: unknown }).available === false && ADVISORY_REFUSALS.has(String((capture as { code?: unknown }).code));

/** The N4.2 masked-field rule (autocomplete tokens, then the described attributes), shared by `masked` and the N8 container. */
const MASKED_AUTOCOMPLETE = "one-time-code|current-password|new-password|cc-number|cc-csc";
const MASKED_DESCRIBED = String.raw`otp|one[-_ ]?time|passcode|\bpin\b|\bcvv\b|\bcvc\b|\bcsc\b|card[-_ ]?number|cardnumber|credit[-_ ]?card|\bssn\b|social[-_ ]?security|\bsecret\b|\btoken\b`;

/** N9: one macrotask turn, so a deadline timer that is already due runs before more synchronous pixel work starts. */
const yieldToTimers = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * QC F1: the device pixels one member's crop and evidence touch (the element crop plus its padded context crop, each
 * clipped to the viewport), so the checkpoint before them reserves their measured cost, not a fixed one. Exported for its
 * behavioural test.
 */
export function memberCropPixels(viewport: { cssWidth: number; cssHeight: number; scaleX: number; scaleY: number }, box: MemberBox["box"]): number {
  const area = (pad: number): number => {
    const width = Math.min(viewport.cssWidth, box.x + box.width + pad) - Math.max(0, box.x - pad);
    const height = Math.min(viewport.cssHeight, box.y + box.height + pad) - Math.max(0, box.y - pad);
    return Math.max(0, width) * Math.max(0, height);
  };
  return (area(0) + area(CONTEXT_PADDING_CSS)) * viewport.scaleX * viewport.scaleY;
}

/**
 * N8/N9 QC finding 5: append the advisory codes to a decided record's observations under the observation cap. N9's one
 * code keeps a slot; the N7.7 and N8 codes, given in keep order, fill the rest. Exported for its behavioural test.
 */
export function appendAdvisoryCodes(observations: string[], extras: readonly string[], stateCode: string | undefined): void {
  // QC (2026-11-01): a state code already in the record needs no slot of its own.
  const cap = VISUAL_DIAGNOSIS_RECORD_MAX_OBSERVATIONS - (stateCode && !observations.includes(stateCode) ? 1 : 0);
  for (const code of extras) {
    if (observations.length < cap && !observations.includes(code)) observations.push(code);
  }
  if (stateCode && observations.length < VISUAL_DIAGNOSIS_RECORD_MAX_OBSERVATIONS && !observations.includes(stateCode)) observations.push(stateCode);
}

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
    const hardDeadlineMs = Math.min(this.deadlineMs, request.deadlineMs ?? this.deadlineMs);
    // The deadline fix: everything below works to the earlier work budget (see visualDiagnosisWorkBudget).
    const deadlineMs = visualDiagnosisWorkBudget(hardDeadlineMs, this.options.settleMarginMs);
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
      .catch((error) => this.refusal(request, error instanceof DiagnosisOverBudget ? "budget-exhausted" : "capture-failed", started))
      // The monotonic clock, not the timer, decides: a result finished past the budget (its timer could not run while
      // synchronous work held the loop) is never published as an observation.
      .then((record) => settle(performance.now() - started > deadlineMs ? this.refusal(request, "budget-exhausted", started) : record))
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

    // N8: the DOM's row structure around the first examined main-frame candidate (read only, before the frame).
    // `undefined` = not asked (off, too little time left, or a container holding a masked field): no row code at all;
    // `null` = no row structure.
    let rowFacts: RowFacts | null | undefined;
    let rowAnchor: ElementHandle | undefined;
    let rowMs = 0;
    if (this.options.rowEvidence === true && this.remaining(started, deadlineMs) >= VISUAL_ROWS_MIN_REMAINING_MS) {
      // Security S2 / Sec 3: the inexpensive handoff recheck right before N8's DOM read. A handoff that became active since
      // the start is refused exactly as it is there; N0's own protected checks stay authoritative for the frame.
      if (this.handedOff(page)) return this.refusal(request, "protected-surface", started);
      const reading = performance.now();
      const mainMembers = boxes.filter((slot) => slot.isMainFrame).map((slot) => ({ handle: handles[slot.index]!, box: slot.box }));
      rowAnchor = mainMembers[0]?.handle;
      // A failed DOM read is "no structure examined"; it can never turn N5's own record into a failure.
      rowFacts = mainMembers.length === 0 ? null : await bounded(this.rowFacts(mainMembers, signal).catch(() => null));
      rowMs += performance.now() - reading;
    }
    let rowPixels: { image: VisualImage; cropCss: VisualRowsBox } | undefined;
    // N8 QC finding 7: the container crop is dropped before its frame is released, on every path.
    const dropRowPixels = (): void => {
      if (!rowPixels) return;
      rowPixels = undefined;
      this.options.probe?.onRowCrop?.("dropped");
    };
    let rowStale = false;
    /** N5's frame went stale after the member crops (the container crop, or the last check before release): the boundary below. */
    let frameRefused = false;
    let rowsVerdict: VisualRowsVerdict | undefined;

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
    const shotAt = performance.now();
    // N9: the state features of this same frame, measured before it is released (in memory only).
    let stateFrame: VisualStateFrame | undefined;
    let stateMs = 0;
    if (!shot.ok) {
      viewportInput = { available: false, code: shot.code };
      for (const slot of boxes) members.push({ isTarget: matches === 1 && slot.index === 0, evidence: { available: false, code: shot.code } });
    } else {
      const frame = shot.value;
      this.options.probe?.onFrame?.("taken");
      try {
        await this.options.probe?.heldFrame?.(1);
        if (signal.aborted) throw new DiagnosisAborted();
        // The deadline fix: N0's decode just ran synchronously; a due deadline goes first, and N5's own pixel work
        // starts only with the reserve left (otherwise the record is budget-exhausted, as the timer would have said).
        const framePixels = frame.viewport.imageWidth * frame.viewport.imageHeight;
        // The whole-viewport crop and fingerprint are one synchronous chunk: it starts only if its measured cost fits.
        await this.checkpoint(signal, started, deadlineMs, visualDiagnosisSyncReserveMs(framePixels));
        const { cssWidth, cssHeight } = frame.viewport;
        const whole = cropFromVisualFrame(frame, { x: 0, y: 0, width: cssWidth, height: cssHeight }, 0);
        if (whole.ok) {
          const fingerprint = fingerprintVisualImage(whole.value.element.image);
          viewportInput = fingerprint.ok ? fingerprint.value : { available: false, code: fingerprint.code };
          if (this.options.stateRecognition === true && this.remaining(started, deadlineMs) >= VISUAL_STATE_MIN_REMAINING_MS) {
            // N9 campaign-1 fix: synchronous pixel work blocks the deadline timer, so a due deadline is let through
            // first, and the work never starts with less than the minimum left.
            await yieldToTimers();
            if (signal.aborted) throw new DiagnosisAborted();
          }
          if (
            this.options.stateRecognition === true &&
            this.remaining(started, deadlineMs) >= Math.max(VISUAL_STATE_MIN_REMAINING_MS, visualDiagnosisSyncReserveMs(framePixels))
          ) {
            const measuring = performance.now();
            const measured = measureVisualStateFrame(whole.value.element.image, this.statePolicy, frame.viewport.scaleX);
            if (measured.ok) stateFrame = measured.value;
            stateMs = performance.now() - measuring;
          }
        } else {
          viewportInput = { available: false, code: whole.code };
        }
        for (const slot of boxes) {
          // QC F1: each member's crop and evidence are one synchronous chunk, reserved at their measured per-pixel cost.
          await this.checkpoint(signal, started, deadlineMs, visualDiagnosisSyncReserveMs(memberCropPixels(frame.viewport, slot.box)));
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
        if (rowFacts) {
          // N8: one crop of the DOM-proven container from this same frame, in memory only.
          await yieldToTimers();
          if (signal.aborted) throw new DiagnosisAborted();
          const cropping = performance.now();
          const c = rowFacts.container;
          const left = Math.max(0, c.x);
          const top = Math.max(0, c.y);
          const right = Math.min(cssWidth, c.x + c.width);
          const bottom = Math.min(cssHeight, c.y + c.height);
          // Without the reserve left, no crop is taken: the rows are withheld (no-pixels), never decided late.
          const cropPixels = (right - left) * (bottom - top) * frame.viewport.scaleX * frame.viewport.scaleY;
          if (right > left && bottom > top && this.leftOf(started, deadlineMs) >= visualDiagnosisSyncReserveMs(cropPixels)) {
            const crop = cropFromVisualFrame(frame, { x: left, y: top, width: right - left, height: bottom - top }, 0);
            if (crop.ok) {
              rowPixels = { image: crop.value.element.image, cropCss: { ...crop.value.element.actualCssBounds } };
              this.options.probe?.onRowCrop?.("taken");
            } else if (ADVISORY_REFUSALS.has(crop.code)) {
              frameRefused = true;
            }
          }
          rowMs += performance.now() - cropping;
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
            // Security NEW-1: a refused crop keeps its refusal code (the boundary below reads it).
            if (!refusedCapture(members[at].evidence)) members[at] = { ...members[at], evidence: { available: false, code: "TARGET_STALE" } };
            // N8 QC finding 1: a member that moved means its pre-frame row facts no longer describe these pixels.
            if (boxes[at].isMainFrame) rowStale = true;
          }
        }
        if (rowFacts && rowAnchor && !rowStale) {
          // N8: a container that moved since it was read makes every row code inconclusive.
          const before = rowFacts.container;
          const now = await bounded(
            rowAnchor
              .evaluate((node, selector) => {
                const container = (node as Element).closest(selector)?.parentElement;
                if (!container) return null;
                const r = container.getBoundingClientRect();
                return { x: r.left, y: r.top, width: r.width, height: r.height };
              }, ROW_SELECTOR)
              .catch(() => null)
          );
          rowStale = !now || now.x !== before.x || now.y !== before.y || now.width !== before.width || now.height !== before.height;
        }
        if (rowFacts !== undefined) {
          // N8 QC finding 7: decided while the frame is still held, so the container crop never outlives the frame.
          const deciding = performance.now();
          // The pixel decision is synchronous: without the reserve left it is withheld (no pixels), never run late.
          const decidable = rowPixels && this.leftOf(started, deadlineMs) >= visualDiagnosisSyncReserveMs(rowPixels.image.width * rowPixels.image.height);
          rowsVerdict = this.decideRows(rowFacts, decidable ? rowPixels : undefined, viewport, rowStale);
          dropRowPixels();
          rowMs += performance.now() - deciding;
        }
        // Security NEW-1: N0's own stale mark, read once more right before the frame is released (a 1-px crop reads
        // only that mark), so a navigation or close after the crops withdraws the advisory codes too.
        const last = cropFromVisualFrame(frame, { x: 0, y: 0, width: 1, height: 1 }, 0);
        if (!last.ok && ADVISORY_REFUSALS.has(last.code)) frameRefused = true;
      } finally {
        dropRowPixels();
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
    // The advisory refusal boundary (ADVISORY_REFUSALS): a refused verdict, or a first frame N0 refused or found stale
    // (the shot itself, or any crop of it) as protected, navigated or closed, gains no N7.7, N8 or N9 code.
    // N7.7's own refusals (TEXT_SIGNAL_REFUSALS) and a refused second frame withdraw it below.
    let advisory = verdict.outcome !== "refused" && !frameRefused && ![viewportInput, ...members.map((member) => member.evidence)].some(refusedCapture);
    // N7.7: advisory only, after the verdict is decided; a DOM-proven, unique, visible target only.
    const textCodes: string[] = [];
    if (advisory && this.options.textSignal && matches === 1 && target?.inViewport && !target.zeroSize && !signal.aborted) {
      const text = await bounded(
        this.options
          .textSignal({ page, target: locator, handedOff: this.handedOff(page), deadlineMs: this.remaining(started, deadlineMs), signal })
          .catch(() => undefined)
      );
      if (text && TEXT_SIGNAL_REFUSALS.has(text.code)) advisory = false;
      const code = text ? OCR_TEXT_SIGNAL_DIAGNOSIS_CODES[text.outcome] : undefined;
      if (code) textCodes.push(code);
    }
    const rowCodes: string[] = [];
    let stateCode: string | undefined;
    // N8: advisory only, after the verdict and the text signal; at most three codes.
    if (advisory && rowFacts !== undefined) {
      const deciding = performance.now();
      // Without a frame there are no pixels: the rows are decided here, withheld.
      const rows = rowsVerdict ?? this.decideRows(rowFacts, undefined, viewport, rowStale);
      // QC finding 5: kept apart so the cap trims them last-first (association and coverage before structure).
      rowCodes.push(...rows.codes.filter((c) => c.startsWith("row-association-")), ...rows.codes.filter((c) => c === "rows-partly-examined"), ...rows.codes.filter((c) => c.startsWith("rows-") && c !== "rows-partly-examined"));
      try {
        this.options.probe?.onRows?.({ verdict: rows, ms: Math.round(rowMs + performance.now() - deciding) });
      } catch {
        // A probe is an observer, not a participant.
      }
    }
    // N9: advisory only, after the verdict and the text signal; one code, never more.
    if (advisory && this.options.stateRecognition === true) {
      // Sec 2: a refused second frame (null) withdraws the text and row codes already computed, not just the state.
      const state = await this.state(request, page, stateFrame, stateMs, shotAt, signal, started, deadlineMs, bounded, defer);
      if (state === null) advisory = false;
      else stateCode = state;
    }
    // A handoff that became active while the advisory work ran withdraws it too.
    if (advisory && this.handedOff(page)) advisory = false;
    const record = this.toRecord(request, kind, verdict, started);
    if (advisory) appendAdvisoryCodes(record.observations, [...textCodes, ...rowCodes], stateCode);
    return record;
  }

  /**
   * N9 (plan § 2–3): the state of the failed step's viewport. Without a first frame nothing is claimed (`skipped`).
   * With enough deadline left, ONE more guarded N0 frame is taken for motion (same limiter, abort, handoff and protected
   * rules, released on every path); without it, motion stays unmeasured and `ready` cannot be decided. A second frame
   * N0 refuses under ADVISORY_REFUSALS returns `null`: every advisory code of the diagnosis is withdrawn.
   */
  private async state(
    request: VisualDiagnosisRequest,
    page: Page,
    frame: VisualStateFrame | undefined,
    measuredMs: number,
    firstAt: number,
    signal: AbortSignal,
    started: number,
    deadlineMs: number,
    bounded: <T>(work: Promise<T>) => Promise<T>,
    defer: (cleanup: () => void) => void
  ): Promise<string | null> {
    if (!frame) return "visual-state-skipped";
    const begun = performance.now();
    let motion: VisualMotion | null = null;
    if (!signal.aborted && this.remaining(started, deadlineMs) >= VISUAL_STATE_MIN_REMAINING_MS) {
      const wait = VISUAL_STATE_INTERVAL_MS - (performance.now() - firstAt);
      if (wait > 0) await bounded(new Promise<void>((resolve) => setTimeout(resolve, wait)));
      if (signal.aborted) throw new DiagnosisAborted();
      let kept = false;
      // A small margin keeps a slow second screenshot from cutting the whole diagnosis: it fails on its own first.
      const shooting = request.limitScreenshot(() =>
        captureVisualFrame(page, {
          timeoutMs: Math.max(1, this.remaining(started, deadlineMs) - 50),
          signal,
          stepType: request.step.type,
          handedOff: this.handedOff(page)
        })
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
        if (ADVISORY_REFUSALS.has(shot.code)) return null;
      } else {
        const second = shot.value;
        this.options.probe?.onFrame?.("taken");
        try {
          await this.options.probe?.heldFrame?.(2);
          await yieldToTimers();
          if (signal.aborted) throw new DiagnosisAborted();
          // Sec 1 (QC nit, 2026-11-01): a second frame that went stale (the page navigated or closed while it was held)
          // withdraws too, read from N0's mark with a 1-px crop whether or not there is time left to measure motion.
          const mark = cropFromVisualFrame(second, { x: 0, y: 0, width: 1, height: 1 }, 0);
          if (!mark.ok && ADVISORY_REFUSALS.has(mark.code)) return null;
          // Without the reserve left, motion stays unmeasured (so `ready` cannot be decided), never measured late.
          if (this.leftOf(started, deadlineMs) >= visualDiagnosisSyncReserveMs(second.viewport.imageWidth * second.viewport.imageHeight)) {
            const whole = cropFromVisualFrame(second, { x: 0, y: 0, width: second.viewport.cssWidth, height: second.viewport.cssHeight }, 0);
            const plane = whole.ok ? measureVisualMotionPlane(whole.value.element.image, second.viewport.scaleX) : undefined;
            if (plane?.ok) motion = measureVisualMotion(frame.motion, plane.value, this.statePolicy);
          }
        } finally {
          releaseVisualFrame(second);
          this.options.probe?.onFrame?.("released");
        }
      }
    }
    const verdict = decideVisualState({ frame: frame.features, motion }, this.statePolicy);
    try {
      this.options.probe?.onState?.({ features: frame.features, motion, verdict, ms: Math.round(measuredMs + performance.now() - begun) });
    } catch {
      // A probe is an observer, not a participant.
    }
    return `visual-state-${verdict.state}`;
  }

  private get statePolicy(): Readonly<VisualStatePolicy> {
    return this.options.statePolicy ?? MEASURED_VISUAL_STATE_POLICY;
  }

  private get rowsPolicy(): Readonly<VisualRowsPolicy> {
    return this.options.rowsPolicy ?? MEASURED_VISUAL_ROWS_POLICY;
  }

  private decideRows(
    facts: RowFacts | null,
    pixels: { image: VisualImage; cropCss: VisualRowsBox } | undefined,
    viewport: { width: number; height: number },
    stale: boolean
  ): VisualRowsVerdict {
    return decideVisualRows(
      {
        image: pixels?.image ?? null,
        cropCss: pixels?.cropCss ?? null,
        viewport,
        dom: facts ? { rows: facts.rows, totalRows: facts.totalRows, declaredRows: facts.declaredRows, members: facts.members } : null,
        stale
      },
      this.rowsPolicy
    );
  }

  /**
   * N8 (plan § 2): the container of the first member's closest DOM row, that container's row boxes (at most
   * VISUAL_ROWS_MAX_ROWS), a declared row count, and each member's DOM row index in that container (-1 when it is in
   * another one) and whether nothing is on top of it. Read only: boxes, ancestry and one hit test per member. Security S3:
   * a container holding a masked field (the N4.2 rule, attributes only, never a value) is `undefined`: never cropped,
   * never examined, no row code.
   */
  private async rowFacts(members: Array<{ handle: ElementHandle; box: MemberBox["box"] }>, signal: AbortSignal): Promise<RowFacts | null | undefined> {
    // N8 QC finding 6: after a cut, no further page reads are started.
    if (signal.aborted) return null;
    const container = await members[0]!.handle.evaluateHandle((node, selector) => (node as Element).closest(selector)?.parentElement ?? null, ROW_SELECTOR);
    try {
      // QC F6: a cut while the first read was in flight starts no second one.
      if (signal.aborted) return null;
      const facts = await container.evaluate(
        // No named inner functions here: a bundler may wrap them in a helper the page does not have.
        (node, [selector, cap, autocompleteRule, describedRule]) => {
          if (!node) return null;
          const element = node as Element;
          const autocompleteMasked = new RegExp(autocompleteRule);
          const describedMasked = new RegExp(describedRule, "i");
          for (const control of Array.from(element.querySelectorAll("input, textarea"))) {
            const autocomplete = (control.getAttribute("autocomplete") ?? "").toLowerCase();
            const described = [control.getAttribute("name"), control.id, autocomplete, control.getAttribute("aria-label"), control.getAttribute("placeholder")].join(" ");
            if ((control.getAttribute("type") ?? "").toLowerCase() === "password" || autocompleteMasked.test(autocomplete) || describedMasked.test(described)) {
              return { sensitive: true as const };
            }
          }
          const rows = Array.from(element.children).filter((child) => child.matches(selector));
          const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
          for (const row of rows.slice(0, cap)) {
            const r = row.getBoundingClientRect();
            boxes.push({ x: r.left, y: r.top, width: r.width, height: r.height });
          }
          const own = element.getBoundingClientRect();
          const declaredText = element.closest("[aria-rowcount]")?.getAttribute("aria-rowcount") ?? rows[0]?.getAttribute("aria-setsize") ?? null;
          const declared = declaredText === null ? Number.NaN : Number(declaredText);
          return {
            container: { x: own.left, y: own.top, width: own.width, height: own.height },
            rows: boxes,
            totalRows: rows.length,
            declaredRows: Number.isInteger(declared) && declared > 0 ? declared : null
          };
        },
        [ROW_SELECTOR, VISUAL_ROWS_MAX_ROWS, MASKED_AUTOCOMPLETE, MASKED_DESCRIBED] as [string, number, string, string]
      );
      if (!facts || signal.aborted) return null;
      if ("sensitive" in facts) return undefined;
      const placed = await Promise.all(
        members.map(({ handle }) =>
          handle
            .evaluate(
              (node, [owner, selector]) => {
                const row = (node as Element).closest(selector);
                if (!row || !owner || row.parentElement !== owner) return -1;
                return Array.from((owner as Element).children)
                  .filter((child) => child.matches(selector))
                  .indexOf(row);
              },
              [container, ROW_SELECTOR] as [typeof container, string]
            )
            .catch(() => -1)
        )
      );
      if (signal.aborted) return null;
      // Security S4: an unreadable hit test counts as covered here, so it can never support a row association.
      const covered = await Promise.all(members.map(({ handle }) => this.occluded(handle, true)));
      // QC (2026-11-01): a cut during the hit tests starts no visibility read.
      if (signal.aborted) return null;
      // N8 QC finding 4: a member that is transparent or hidden through any ancestor is hit-testable but not seen, so
      // it is never "on top" (its pixels would be whatever is behind it). QC F4: opacity compounds up the chain. QC
      // (2026-11-01): the chain is the flat tree, through slots and (nested) shadow hosts, up to the document; the
      // engine's own check covers what page script cannot walk (a closed root's insides). Fail closed on a read error,
      // an unreadable opacity, or a chain that does not reach the document.
      const hidden = await Promise.all(
        members.map(({ handle }) =>
          handle
            .evaluate((node) => {
              const element = node as Element;
              if (typeof element.checkVisibility === "function" && !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return true;
              let opacity = 1;
              for (let at: Node | null = element; at; ) {
                if (at.nodeType === Node.DOCUMENT_NODE) return false;
                if (at.nodeType !== Node.ELEMENT_NODE) return true;
                const style = getComputedStyle(at as Element);
                opacity *= Number(style.opacity);
                if (!(opacity >= 0.05) || style.visibility === "hidden" || style.visibility === "collapse") return true;
                const parent: Node | null = (at as Element).assignedSlot ?? at.parentNode;
                at = parent instanceof ShadowRoot ? parent.host : parent;
              }
              return true;
            })
            .catch(() => true)
        )
      );
      if (signal.aborted) return null;
      return { ...facts, members: members.map((member, at) => ({ box: member.box, rowIndex: placed[at], topmost: !covered[at] && !hidden[at] })) };
    } finally {
      await container.dispose().catch(() => undefined);
    }
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
              .evaluate(
                (node, [autocompleteRule, describedRule]) => {
                  const element = node as Element;
                  const control = element.tagName === "LABEL" ? ((element as HTMLLabelElement).control ?? element) : element;
                  if (control.tagName !== "INPUT" && control.tagName !== "TEXTAREA") return false;
                  const autocomplete = (control.getAttribute("autocomplete") ?? "").toLowerCase();
                  if ((control.getAttribute("type") ?? "").toLowerCase() === "password") return true;
                  if (new RegExp(autocompleteRule).test(autocomplete)) return true;
                  const described = [control.getAttribute("name"), control.id, autocomplete, control.getAttribute("aria-label"), control.getAttribute("placeholder")].join(" ");
                  return new RegExp(describedRule, "i").test(described);
                },
                [MASKED_AUTOCOMPLETE, MASKED_DESCRIBED] as [string, string]
              )
              .catch(() => true)
      )
    );
    return verdicts.some(Boolean);
  }

  /**
   * Whether another element is topmost over the member, in its own document or shadow root. Read only. N5.7 (QC finding
   * 1): the probe asks the member's own root, so a target inside an open shadow root is not "covered" by its host, and it
   * probes the centre of the part inside the viewport, so a partly visible target is not "covered" by nothing. A member
   * with no visible part is never called occluded. Security S4: `failClosed` (the N8 row facts) makes a read that
   * cannot be made count as occluded; N5's own target fact keeps reporting it as not occluded.
   */
  private occluded(member: MemberHandle, failClosed = false): Promise<boolean> {
    return member
      .evaluate((node, unreadable) => {
        const element = node as Element;
        const view = element.ownerDocument.defaultView;
        if (!view) return unreadable;
        const rect = element.getBoundingClientRect();
        const left = Math.max(rect.left, 0);
        const right = Math.min(rect.right, view.innerWidth);
        const top = Math.max(rect.top, 0);
        const bottom = Math.min(rect.bottom, view.innerHeight);
        if (right <= left || bottom <= top) return false;
        const root = element.getRootNode() as Document | ShadowRoot;
        const hit = (typeof root.elementFromPoint === "function" ? root : element.ownerDocument).elementFromPoint((left + right) / 2, (top + bottom) / 2);
        return !(hit && (hit === element || element.contains(hit)));
      }, failClosed)
      .catch(() => failClosed);
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

  /** What is left of the work budget on the monotonic clock (may be negative). */
  private leftOf(started: number, deadlineMs: number): number {
    return deadlineMs - (performance.now() - started);
  }

  /**
   * The deadline fix's checkpoint before N5's own synchronous pixel work: let a due deadline timer run first, then stop
   * on an abort, or as `budget-exhausted` when less than the reserve is left (the timer may not have fired yet).
   */
  private async checkpoint(signal: AbortSignal, started: number, deadlineMs: number, needMs = VISUAL_DIAGNOSIS_SYNC_RESERVE_MS): Promise<void> {
    await yieldToTimers();
    if (signal.aborted) throw new DiagnosisAborted();
    if (this.leftOf(started, deadlineMs) < needMs) throw new DiagnosisOverBudget();
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
