import { compareVisualFingerprints } from "../compare";
import type { VisualErrorCode } from "../errors";
import type { VisualEvidence } from "../visualEvidence";

/**
 * Visual Locator Recovery agreement policy (Phase N, N3.1 / awkit-vra.4.1). PURE: no I/O, no clock, no randomness, no
 * page, no model. Plan: docs/plans/ai-upgrade-v5/N3-visual-locator-recovery.md (decision table A1-A9, J1-J9), owner
 * decisions VR-0 to VR-9 (DECISIONS.md 2026-10-13).
 *
 * DOM-CHOSEN ONLY (J1). The only element that can proceed is the DOM layer's own best candidate. The input has no field
 * that could name another element and the verdict carries no locator, index, selector or coordinate, so `agreed` can
 * only let that candidate continue into the unchanged `distinct` -> `insideContainer` -> `requireActionable` chain.
 *
 * NARROW (J2). Only a local-layer `below-threshold` refusal whose best candidate still holds the DOM margin, ancestry and
 * the 0.6 identity floor is eligible. `ambiguous-margin` is never rescued: letting appearance decide between DOM
 * near-ties is the measured F2 swap hazard.
 *
 * IDENTITY, NOT SIMILARITY (J3). `agreed` needs equal `contentDigest`. No similarity score, margin or threshold can
 * produce it, because a look-alike measurably outscores a restyled original (0.9434 vs 0.6705).
 *
 * UNIQUE (J4). Any captured competitor identical to the reference or to the best refuses (F3 twins), and a competitor
 * that was not captured refuses: uniqueness cannot be shown over pixels that were never seen.
 *
 * DOM arithmetic is in integer basis points; conditions are derived from the evidence, never trusted from the caller.
 */

export const VISUAL_AGREEMENT_VERSION = 1;
/** VR-4: every other candidate of the pruned snapshot must be captured, up to this many. */
export const AGREEMENT_MAX_COMPETITORS = 8;
/** A2 floors, in basis points: `AGREEMENT_MIN_IDENTITY`, `RECOVERY_MIN_ANCESTRY` and `RECOVERY_MARGIN`. */
export const AGREEMENT_MIN_SCORE_BP = 6000;
export const AGREEMENT_MIN_ANCESTRY_BP = 5000;
export const AGREEMENT_MIN_MARGIN_BP = 800;

/** VR-1 / VR-8: `AWKIT_VISUAL_RECOVERY`, off by default. */
export type VisualAgreementMode = "off" | "shadow" | "enforce";
/** VR-5: element steps only; never sensitive, protected or handed off. The caller derives it. */
export type VisualAgreementEligibility = "eligible" | "ineligible";

export type VisualAgreementOutcome = "not-eligible" | "unavailable" | "refused" | "agreed";
export type VisualAgreementEffect = "none" | "proceed";

export type VisualAgreementUnavailableReason =
  | "protected-surface"
  | "budget-exhausted"
  | "cancelled"
  | "target-stale"
  | "target-offscreen"
  | "frame-mapping-failed"
  | "version-mismatch"
  | "capture-failed";

export type VisualAgreementReason =
  | "mode-off"
  | "ineligible-step"
  | "refusal-not-eligible"
  | "dom-floor"
  | "no-reference"
  | "reference-invalid"
  | VisualAgreementUnavailableReason
  | "invalid-input"
  | "conditions-changed"
  | "competitors-uncaptured"
  | "not-identical"
  | "identical-competitor"
  | "identical-unique";

/** An input that could not be captured, read or compared. Carries a bounded error code only. */
export interface VisualAgreementUnavailable {
  available: false;
  code: VisualErrorCode;
}

export type VisualAgreementEvidenceInput = VisualEvidence | VisualAgreementUnavailable;

export interface VisualAgreementDom {
  /** The DOM layer's refusal. Only `below-threshold` is eligible (VR-3). */
  refusal: string;
  /** The DOM layer's own best candidate. Scores are 0-1. */
  best: { score: number; ancestry: number };
  /** Best minus runner-up DOM score, 0-1 (1 when there is no runner-up). */
  margin: number;
  /** DOM candidates in the pruned snapshot other than the best. */
  competitorCount: number;
}

export interface VisualAgreementInput {
  mode: VisualAgreementMode;
  eligibility: VisualAgreementEligibility;
  dom: VisualAgreementDom;
  /** The step's last-known-good element evidence from the N2.4b store; null when the step has none. */
  reference: VisualAgreementEvidenceInput | null;
  /** The DOM best candidate, captured now. */
  best: VisualAgreementEvidenceInput;
  /** The other DOM candidates, captured now in the same frame. */
  competitors: VisualAgreementEvidenceInput[];
}

export interface VisualAgreementVerdict {
  version: typeof VISUAL_AGREEMENT_VERSION;
  outcome: VisualAgreementOutcome;
  /** "proceed" only for `agreed` in enforce mode on an eligible step. */
  effect: VisualAgreementEffect;
  reason: VisualAgreementReason;
}

const BP = 10000;

function verdict(outcome: VisualAgreementOutcome, reason: VisualAgreementReason, effect: VisualAgreementEffect = "none"): VisualAgreementVerdict {
  return { version: VISUAL_AGREEMENT_VERSION, outcome, effect, reason };
}

function isUnavailable(input: VisualAgreementEvidenceInput): input is VisualAgreementUnavailable {
  return (input as VisualAgreementUnavailable).available === false;
}

function unavailableReason(code: VisualErrorCode): VisualAgreementUnavailableReason {
  switch (code) {
    case "PROTECTED_SURFACE":
      return "protected-surface";
    case "BUDGET_EXHAUSTED":
      return "budget-exhausted";
    case "CANCELLED":
      return "cancelled";
    case "TARGET_STALE":
    case "PAGE_CLOSED":
      return "target-stale";
    case "TARGET_OFFSCREEN":
      return "target-offscreen";
    case "FRAME_MAPPING_FAILED":
      return "frame-mapping-failed";
    case "UNSUPPORTED_FINGERPRINT_VERSION":
      return "version-mismatch";
    default:
      return "capture-failed";
  }
}

function unitScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function elementEvidence(evidence: VisualEvidence): boolean {
  return (
    !!evidence &&
    evidence.kind === "element" &&
    !!evidence.viewport &&
    !!evidence.bounds &&
    !!evidence.frame &&
    !!evidence.fingerprint &&
    evidence.bounds.actualCss.width > 0 &&
    evidence.bounds.actualCss.height > 0
  );
}

function sameConditions(a: VisualEvidence, b: VisualEvidence): boolean {
  return (
    a.viewport.devicePixelRatio === b.viewport.devicePixelRatio &&
    a.viewport.cssWidth === b.viewport.cssWidth &&
    a.viewport.cssHeight === b.viewport.cssHeight &&
    a.frame!.depth === b.frame!.depth
  );
}

const toBp = (value: number): number => Math.round(value * BP);

/**
 * Decide whether pixel identity lets the DOM's own best candidate proceed after a `below-threshold` refusal. Never
 * throws: malformed input is `unavailable` / `invalid-input`, which has no effect. Every earlier row wins.
 */
export function decideVisualAgreement(input: VisualAgreementInput): VisualAgreementVerdict {
  // A1
  if (!input || (input.mode !== "shadow" && input.mode !== "enforce")) return verdict("not-eligible", "mode-off");
  if (input.eligibility !== "eligible") return verdict("not-eligible", "ineligible-step");
  const dom = input.dom;
  if (!dom || dom.refusal !== "below-threshold") return verdict("not-eligible", "refusal-not-eligible");

  // A2 — the DOM's own floors, in basis points. A malformed DOM decision is invalid, never eligible.
  if (
    !dom.best ||
    !unitScore(dom.best.score) ||
    !unitScore(dom.best.ancestry) ||
    !unitScore(dom.margin) ||
    !Number.isInteger(dom.competitorCount) ||
    dom.competitorCount < 0
  ) {
    return verdict("unavailable", "invalid-input");
  }
  if (toBp(dom.best.score) < AGREEMENT_MIN_SCORE_BP || toBp(dom.best.ancestry) < AGREEMENT_MIN_ANCESTRY_BP || toBp(dom.margin) < AGREEMENT_MIN_MARGIN_BP) {
    return verdict("refused", "dom-floor");
  }

  // A3
  if (!input.reference) return verdict("unavailable", "no-reference");
  if (isUnavailable(input.reference)) return verdict("unavailable", "reference-invalid");

  // A4 — the best first, then every competitor. Fail closed: no effect.
  if (!input.best) return verdict("unavailable", "invalid-input");
  if (isUnavailable(input.best)) return verdict("unavailable", unavailableReason(input.best.code));
  if (!Array.isArray(input.competitors)) return verdict("unavailable", "invalid-input");
  for (const competitor of input.competitors) {
    if (!competitor) return verdict("unavailable", "invalid-input");
    if (isUnavailable(competitor)) return verdict("unavailable", unavailableReason(competitor.code));
  }

  const reference = input.reference;
  const best = input.best;
  const competitors = input.competitors as VisualEvidence[];
  if (!elementEvidence(reference)) return verdict("unavailable", "reference-invalid");
  // More captures than DOM competitors means the caller paired evidence it should not have.
  if (!elementEvidence(best) || !competitors.every(elementEvidence) || competitors.length > dom.competitorCount) {
    return verdict("unavailable", "invalid-input");
  }

  // A5 — derived from the evidence, never trusted from the caller.
  if (!sameConditions(reference, best) || !competitors.every((c) => sameConditions(reference, c))) {
    return verdict("unavailable", "conditions-changed");
  }

  // A6 — uniqueness cannot be shown over a competitor that was never captured.
  if (dom.competitorCount > AGREEMENT_MAX_COMPETITORS || competitors.length < dom.competitorCount) {
    return verdict("refused", "competitors-uncaptured");
  }

  // A7 — identity, never similarity.
  const bestComparison = compareVisualFingerprints(reference.fingerprint, best.fingerprint);
  if (!bestComparison.ok) return verdict("unavailable", unavailableReason(bestComparison.code));
  if (!bestComparison.value.identical) return verdict("refused", "not-identical");

  // A8 — any identical competitor, against the reference or the best.
  for (const competitor of competitors) {
    for (const against of [reference, best]) {
      const comparison = compareVisualFingerprints(against.fingerprint, competitor.fingerprint);
      if (!comparison.ok) return verdict("unavailable", unavailableReason(comparison.code));
      if (comparison.value.identical) return verdict("refused", "identical-competitor");
    }
  }

  // A9
  return verdict("agreed", "identical-unique", input.mode === "enforce" ? "proceed" : "none");
}
