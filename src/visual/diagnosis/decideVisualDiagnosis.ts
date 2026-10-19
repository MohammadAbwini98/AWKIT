import { compareVisualFingerprints } from "../compare";
import type { VisualErrorCode } from "../errors";
import { VISUAL_FINGERPRINT_VERSION, type VisualFingerprint } from "../fingerprint";
import type { VisualFrameInfo, VisualViewportInfo } from "../capture";
import { VISUAL_EVIDENCE_VERSION, type VisualEvidence } from "../visualEvidence";

/**
 * Visual Failure Diagnosis policy (Phase N, N5.2 / awkit-vra.14.2). PURE: no I/O, no clock, no randomness, no page, no
 * model. Plan: docs/plans/ai-upgrade-v5/N5-visual-failure-diagnosis.md, owner decisions VD-0 to VD-11 (DECISIONS.md
 * 2026-10-19).
 *
 * ADVISORY (VD-0). The verdict is a closed set of observation codes about the moment a step finally failed. It has no
 * effect field and no key that could name an element: no index, locator, selector, coordinate or score.
 *
 * FAIL-CLOSED CONDITIONS (VD-9). A `VisualEvidence` v1 record cannot prove render mode, browser build or colour scheme,
 * so every comparison against one is at best `unproven`. Under `unproven` only byte identity, which proves itself, is
 * reported. A difference or an absence could be rendering, so it is never reported. `equal-proven` needs the VD-11
 * provenance envelope, which is deferred: this input has no field for it, so no v1 call can reach it.
 *
 * EXAMINED SCOPE (finding 3). Identity is counted only over the examined members the caller captured from the
 * DOM-named set. No code, field or count claims uniqueness. `truncated` says the DOM-named set was cut short.
 */

export const VISUAL_DIAGNOSIS_VERSION = 1;
/** The examined cap. `verify:visual-diagnosis` pins it equal to `VISUAL_FANOUT_MAX_CANDIDATES`. */
export const VISUAL_DIAGNOSIS_MAX_EXAMINED = 32;
/** The most step-locator matches or DOM-named members the caller reports; larger counts are capped to this. */
export const VISUAL_DIAGNOSIS_MAX_COUNT = 64;
/** A record holds at most this many observations. */
export const VISUAL_DIAGNOSIS_MAX_OBSERVATIONS = 8;
/** Provisional `viewport-uniform` floors over the viewport fingerprint (VD-10: fixed by N5.6 calibration). */
export const VIEWPORT_UNIFORM_MAX_LUMA_VARIANCE = 4;
export const VIEWPORT_UNIFORM_MAX_MEAN_EDGE = 1;

/** Refusals the caller determines before anything is captured or compared (VD-2, VD-8). */
export type VisualDiagnosisRefusal =
  | "not-eligible"
  | "sensitive"
  | "handoff-active"
  | "protected-surface"
  | "page-closed"
  | "coalesced"
  | "budget-exhausted"
  | "capture-failed";

export const VISUAL_DIAGNOSIS_REFUSALS: readonly VisualDiagnosisRefusal[] = [
  "not-eligible",
  "sensitive",
  "handoff-active",
  "protected-surface",
  "page-closed",
  "coalesced",
  "budget-exhausted",
  "capture-failed"
];

export type VisualDiagnosisObservation =
  | "reference-unavailable"
  | "conditions-changed"
  | "conditions-unproven"
  | "target-not-in-dom"
  | "target-multiple-matches"
  | "target-offscreen"
  | "target-zero-size"
  | "target-occluded"
  | "target-identical-to-reference"
  /** Needs `equal-proven` (VD-11). Never emitted for a v1 reference. */
  | "target-differs-from-reference"
  | "other-examined-identical"
  /** Needs `equal-proven` (VD-11) and an untruncated set. Never emitted for a v1 reference. */
  | "no-examined-identical"
  | "viewport-uniform"
  | "inconclusive";

export type VisualDiagnosisCode = VisualDiagnosisRefusal | VisualDiagnosisObservation;

/** `none`: no comparison ran. `equal-proven` is unreachable until a provenance envelope exists (VD-11). */
export type VisualDiagnosisConditions = "none" | "different" | "unproven" | "equal-proven";
export type VisualDiagnosisReferenceSource = "runtime" | "recorded" | "none";

/** An input that could not be captured or read. Carries a bounded error code only. */
export interface VisualDiagnosisUnavailable {
  available: false;
  code: VisualErrorCode;
}

export type VisualDiagnosisEvidenceInput = VisualEvidence | VisualDiagnosisUnavailable;

export interface VisualDiagnosisTargetGeometry {
  inViewport: boolean;
  zeroSize: boolean;
  /** `elementsFromPoint` at the target's centre did not return it or a descendant. */
  occluded: boolean;
}

/** Read-only DOM facts, all derived by the caller from the DOM, never from pixels. */
export interface VisualDiagnosisDom {
  /** The step locator's match count, capped at `VISUAL_DIAGNOSIS_MAX_COUNT`. */
  targetMatches: number;
  /** Required exactly when `targetMatches` is 1. */
  target?: VisualDiagnosisTargetGeometry;
  /** Size of the DOM-named set (step matches, then recovery contenders), capped at `VISUAL_DIAGNOSIS_MAX_COUNT`. */
  domNamed: number;
  /** The recovery decision itself dropped contenders past its own cap. */
  contendersDropped: boolean;
}

/** One examined member of the DOM-named set, captured from the diagnosis's single frame. */
export interface VisualDiagnosisMember {
  /** True for the step's own single target. At most one member, and only when `targetMatches` is 1. */
  isTarget: boolean;
  evidence: VisualDiagnosisEvidenceInput;
}

export interface VisualDiagnosisInput {
  /** Set by the caller when nothing may be captured or compared. */
  refusal?: VisualDiagnosisRefusal;
  referenceSource: VisualDiagnosisReferenceSource;
  /** The step's last-known-good element evidence, or null when the store had none. */
  reference: VisualDiagnosisEvidenceInput | null;
  dom: VisualDiagnosisDom;
  /** Examined members in DOM-named order, at most `VISUAL_DIAGNOSIS_MAX_EXAMINED`. */
  members: VisualDiagnosisMember[];
  /** The whole-viewport fingerprint from the same frame, or null when no frame was taken. */
  viewport: VisualFingerprint | VisualDiagnosisUnavailable | null;
}

export interface VisualDiagnosisVerdict {
  version: typeof VISUAL_DIAGNOSIS_VERSION;
  outcome: "refused" | "observed";
  conditions: VisualDiagnosisConditions;
  observations: VisualDiagnosisCode[];
  referenceSource: VisualDiagnosisReferenceSource;
  /** Members whose evidence was usable. */
  examined: number;
  domNamed: number;
  truncated: boolean;
  /** Present only with `other-examined-identical`. A lower bound over the examined set, never "only". */
  identicalOthers?: "1" | "2+";
}

/**
 * The v1 evidence keys the condition rule relies on, pinned at compile time: adding a key to `VisualEvidence`,
 * `VisualViewportInfo` or `VisualFrameInfo` fails the build until it is classified here (provable or not).
 */
export const VISUAL_DIAGNOSIS_EVIDENCE_KEYS: Readonly<Record<keyof VisualEvidence, "provable" | "not-a-condition">> = {
  version: "provable",
  kind: "not-a-condition",
  capturedAt: "not-a-condition",
  viewport: "provable",
  frame: "provable",
  bounds: "not-a-condition",
  contextBounds: "not-a-condition",
  fingerprint: "provable",
  contextFingerprint: "not-a-condition"
};
export const VISUAL_DIAGNOSIS_VIEWPORT_KEYS: Readonly<Record<keyof VisualViewportInfo, "compared" | "derived">> = {
  cssWidth: "compared",
  cssHeight: "compared",
  devicePixelRatio: "compared",
  scaleX: "derived",
  scaleY: "derived",
  imageWidth: "derived",
  imageHeight: "derived"
};
export const VISUAL_DIAGNOSIS_FRAME_KEYS: Readonly<Record<keyof VisualFrameInfo, "compared">> = {
  isMainFrame: "compared",
  depth: "compared"
};
/** Conditions no v1 record carries. Any of them unproven keeps a comparison at `unproven`. */
export const VISUAL_DIAGNOSIS_UNPROVABLE_CONDITIONS = ["render-mode", "browser-build", "colour-scheme"] as const;

const REFUSAL_SET: ReadonlySet<string> = new Set(VISUAL_DIAGNOSIS_REFUSALS);

function refused(code: VisualDiagnosisRefusal, source: VisualDiagnosisReferenceSource = "none"): VisualDiagnosisVerdict {
  return {
    version: VISUAL_DIAGNOSIS_VERSION,
    outcome: "refused",
    conditions: "none",
    observations: [code],
    referenceSource: source,
    examined: 0,
    domNamed: 0,
    truncated: false
  };
}

function isUnavailable(input: unknown): input is VisualDiagnosisUnavailable {
  return !!input && typeof input === "object" && (input as VisualDiagnosisUnavailable).available === false;
}

const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function elementEvidence(evidence: unknown): evidence is VisualEvidence {
  const e = evidence as VisualEvidence;
  return (
    !!e &&
    e.version === VISUAL_EVIDENCE_VERSION &&
    e.kind === "element" &&
    !!e.viewport &&
    !!e.frame &&
    !!e.bounds &&
    !!e.fingerprint &&
    e.bounds.actualCss.width > 0 &&
    e.bounds.actualCss.height > 0
  );
}

/** Every condition a v1 record can prove. Derived from the evidence, never trusted from the caller. */
function provablyEqual(a: VisualEvidence, b: VisualEvidence): boolean {
  return (
    a.version === b.version &&
    a.fingerprint.version === b.fingerprint.version &&
    a.viewport.devicePixelRatio === b.viewport.devicePixelRatio &&
    a.viewport.cssWidth === b.viewport.cssWidth &&
    a.viewport.cssHeight === b.viewport.cssHeight &&
    a.frame!.depth === b.frame!.depth &&
    a.frame!.isMainFrame === b.frame!.isMainFrame
  );
}

/** A capture refusal that ends the whole diagnosis; anything else only leaves that member unexamined. */
function terminalRefusal(code: VisualErrorCode): VisualDiagnosisRefusal | null {
  switch (code) {
    case "PROTECTED_SURFACE":
      return "protected-surface";
    case "BUDGET_EXHAUSTED":
    case "CANCELLED":
      return "budget-exhausted";
    case "PAGE_CLOSED":
      return "page-closed";
    default:
      return null;
  }
}

function viewportUniform(fingerprint: VisualFingerprint): boolean {
  return (
    fingerprint.version === VISUAL_FINGERPRINT_VERSION &&
    count(fingerprint.lumaVariance) &&
    typeof fingerprint.meanEdge === "number" &&
    fingerprint.lumaVariance <= VIEWPORT_UNIFORM_MAX_LUMA_VARIANCE &&
    fingerprint.meanEdge <= VIEWPORT_UNIFORM_MAX_MEAN_EDGE
  );
}

/** Decide the observations for one finally failed step. Never throws: malformed input is `capture-failed`. */
export function decideVisualDiagnosis(input: VisualDiagnosisInput): VisualDiagnosisVerdict {
  if (!input || typeof input !== "object") return refused("capture-failed");
  const source: VisualDiagnosisReferenceSource =
    input.referenceSource === "runtime" || input.referenceSource === "recorded" ? input.referenceSource : "none";

  // Caller refusals: nothing was captured. An unknown refusal is a capture failure, never an observation.
  if (input.refusal !== undefined) return refused(REFUSAL_SET.has(input.refusal) ? input.refusal : "capture-failed", source);

  const dom = input.dom;
  if (
    !dom ||
    !count(dom.targetMatches) ||
    !count(dom.domNamed) ||
    typeof dom.contendersDropped !== "boolean" ||
    !Array.isArray(input.members) ||
    input.members.length > VISUAL_DIAGNOSIS_MAX_EXAMINED ||
    input.members.length > Math.min(dom.domNamed, VISUAL_DIAGNOSIS_MAX_COUNT)
  ) {
    return refused("capture-failed", source);
  }
  const targetMatches = Math.min(dom.targetMatches, VISUAL_DIAGNOSIS_MAX_COUNT);
  const domNamed = Math.min(dom.domNamed, VISUAL_DIAGNOSIS_MAX_COUNT);
  const target = dom.target;
  if ((targetMatches === 1) !== !!target) return refused("capture-failed", source);
  if (target && (typeof target.inViewport !== "boolean" || typeof target.zeroSize !== "boolean" || typeof target.occluded !== "boolean")) {
    return refused("capture-failed", source);
  }
  const targetMembers = input.members.filter((member) => member && member.isTarget === true).length;
  if (input.members.some((member) => !member || typeof member.isTarget !== "boolean") || targetMembers > 1 || (targetMembers === 1 && targetMatches !== 1)) {
    return refused("capture-failed", source);
  }

  // A protected, budget or page-closed refusal anywhere in the one frame ends the diagnosis (fail closed).
  const captures: unknown[] = [input.viewport, ...input.members.map((member) => member.evidence)];
  for (const capture of captures) {
    if (isUnavailable(capture)) {
      const terminal = terminalRefusal(capture.code);
      if (terminal) return refused(terminal, source);
    }
  }

  const truncated = dom.contendersDropped || dom.domNamed > VISUAL_DIAGNOSIS_MAX_EXAMINED;
  const examinedMembers = input.members.filter((member) => elementEvidence(member.evidence)) as Array<VisualDiagnosisMember & { evidence: VisualEvidence }>;
  const observations: VisualDiagnosisCode[] = [];
  let conditions: VisualDiagnosisConditions = "none";
  let identicalOthers = 0;
  let comparisonRan = false;
  let positive = false;

  // Reference and conditions.
  const reference = input.reference;
  if (!reference || isUnavailable(reference) || !elementEvidence(reference)) {
    observations.push("reference-unavailable");
  } else if (examinedMembers.length > 0) {
    if (examinedMembers.some((member) => !provablyEqual(reference, member.evidence))) {
      conditions = "different";
      observations.push("conditions-changed");
    } else {
      // No v1 record proves render mode, build or colour scheme (VD-9): the best a comparison can be is unproven.
      conditions = "unproven";
      observations.push("conditions-unproven");
      for (const member of examinedMembers) {
        const comparison = compareVisualFingerprints(reference.fingerprint, member.evidence.fingerprint);
        if (!comparison.ok) continue;
        comparisonRan = true;
        if (!comparison.value.identical) continue; // a difference is not reportable under unproven
        if (member.isTarget) positive = true;
        else identicalOthers += 1;
      }
    }
  }

  // DOM facts: always reportable, never from pixels.
  if (targetMatches === 0) observations.push("target-not-in-dom");
  else if (targetMatches > 1) observations.push("target-multiple-matches");
  else if (target) {
    if (!target.inViewport) observations.push("target-offscreen");
    if (target.zeroSize) observations.push("target-zero-size");
    if (target.occluded) observations.push("target-occluded");
  }

  if (positive) observations.push("target-identical-to-reference");
  if (identicalOthers > 0) observations.push("other-examined-identical");

  const viewport = input.viewport;
  if (viewport && !isUnavailable(viewport) && viewportUniform(viewport)) observations.push("viewport-uniform");

  // Inconclusive: a comparison ran with nothing reportable, or no other code applies. A record is never empty.
  if ((comparisonRan && !positive && identicalOthers === 0) || observations.length === 0) observations.push("inconclusive");

  const verdict: VisualDiagnosisVerdict = {
    version: VISUAL_DIAGNOSIS_VERSION,
    outcome: "observed",
    conditions,
    observations: observations.slice(0, VISUAL_DIAGNOSIS_MAX_OBSERVATIONS),
    referenceSource: source,
    examined: examinedMembers.length,
    domNamed,
    truncated
  };
  if (identicalOthers > 0) verdict.identicalOthers = identicalOthers === 1 ? "1" : "2+";
  return verdict;
}
