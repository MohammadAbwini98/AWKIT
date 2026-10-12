import { compareVisualFingerprints } from "../compare";
import type { VisualErrorCode } from "../errors";
import type { VisualEvidence } from "../visualEvidence";

/**
 * DOM + Vision evidence fusion policy (Phase N, N2.2 / awkit-vra.12.2). PURE: no I/O, no clock, no randomness, no
 * page, no model. Plan: docs/plans/ai-upgrade-v5/N2-dom-vision-evidence-fusion.md (decision table R1-R8, I1-I9).
 *
 * VETO-ONLY. The DOM chooses; fusion may only report on that choice. `effect` is "veto" in exactly one row (R8) and
 * nothing here can name, rank or select an element: the verdict carries no locator, index, selector or coordinate
 * (I1), so applying it can only remove an action the DOM would have taken (I2).
 *
 * RELATIVE ONLY. There is no absolute score threshold: a look-alike scores higher against a remembered target than the
 * same control after a restyle (measured 0.9434 vs 0.6705), so only the winner's score RELATIVE to the competitors'
 * scores against the same reference is meaningful.
 *
 * UNCALIBRATED UNTIL N2.3. The margins are owner decision FD-9: they are set from N2.3 measurements. Until then the
 * policy is an injected parameter and `UNCALIBRATED_FUSION_POLICY` stops after R5 with `uncalibrated` — it never
 * corroborates, contests or contradicts on invented numbers. All arithmetic is in integer basis points (I7).
 */

export const FUSION_VERDICT_VERSION = 1;
/** FD-7: at most this many gated-out DOM competitors are captured and compared. */
export const FUSION_MAX_COMPETITORS = 3;

export type FusionMode = "off" | "shadow" | "enforce-veto";
/** FD-6: whether this step may be vetoed, may only be observed, or is out of scope. */
export type FusionEligibility = "eligible" | "shadow-only" | "ineligible";
export type FusionDomLayer = "local" | "blueprint" | "provider-agreed";

export type FusionOutcome = "unchecked" | "dom-only" | "corroborated" | "contested" | "contradicted";
export type FusionEffect = "none" | "veto";

export type FusionUnavailableReason =
  | "protected-surface"
  | "budget-exhausted"
  | "cancelled"
  | "target-stale"
  | "target-offscreen"
  | "frame-mapping-failed"
  | "version-mismatch"
  | "capture-failed";

export type FusionReason =
  | "fusion-off"
  | "step-ineligible"
  | "no-reference"
  | FusionUnavailableReason
  | "invalid-input"
  | "conditions-changed"
  | "identical"
  | "no-competitors"
  | "uncalibrated"
  | "visual-leader"
  | "mixed"
  | "dom-decisive"
  | "size-out-of-bounds"
  | "visual-contradiction";

/** An input that could not be captured or compared. Carries a bounded error code only. */
export interface FusionUnavailable {
  available: false;
  code: VisualErrorCode;
}

export type FusionEvidenceInput = VisualEvidence | FusionUnavailable;

export interface FusionDomDecision {
  layer: FusionDomLayer;
  /** DOM scores are 0-1. */
  winner: { score: number };
  /** The gated-out DOM candidates, in the same order as `FusionInput.competitors`. */
  competitors: { score: number }[];
  /** Winner minus runner-up DOM score, 0-1. */
  margin: number;
}

export interface FusionInput {
  mode: FusionMode;
  eligibility: FusionEligibility;
  dom: FusionDomDecision;
  /** The step's last-known-good element evidence; null when the step has none yet. */
  reference: FusionEvidenceInput | null;
  /** The DOM winner, captured now. */
  winner: FusionEvidenceInput;
  /** The same DOM competitors, captured now. */
  competitors: FusionEvidenceInput[];
}

/** All margins in basis points (1 = 0.0001). */
export interface FusionPolicy {
  calibrated: boolean;
  /** R6: winner must lead every competitor by at least this. */
  corroborateMarginBp: number;
  /** R8: a competitor must lead the winner by at least this. */
  contradictMarginBp: number;
  /** R8: the DOM margin must be BELOW this for a veto. */
  domDecisiveMarginBp: number;
  /** R8: smaller/larger CSS area against the reference, for both winner and the leading competitor. */
  minSizeRatioBp: number;
  /** FD-9: false when N2.3 shows no separation; R8 then never fires. */
  contradictionEnabled: boolean;
}

export const UNCALIBRATED_FUSION_POLICY: FusionPolicy = Object.freeze({
  calibrated: false,
  corroborateMarginBp: 0,
  contradictMarginBp: 0,
  domDecisiveMarginBp: 0,
  minSizeRatioBp: 0,
  contradictionEnabled: false
});

export interface FusionVerdictEvidence {
  winnerScore?: number;
  bestCompetitorScore?: number;
  /** Winner minus best competitor visual score, -1..1. */
  visualMargin?: number;
  identical?: boolean;
}

export interface FusionVerdict {
  version: typeof FUSION_VERDICT_VERSION;
  outcome: FusionOutcome;
  effect: FusionEffect;
  reason: FusionReason;
  evidence: FusionVerdictEvidence;
}

const BP = 10000;

function verdict(outcome: FusionOutcome, reason: FusionReason, evidence: FusionVerdictEvidence = {}, effect: FusionEffect = "none"): FusionVerdict {
  return { version: FUSION_VERDICT_VERSION, outcome, effect, reason, evidence };
}

function isUnavailable(input: FusionEvidenceInput): input is FusionUnavailable {
  return (input as FusionUnavailable).available === false;
}

function unavailableReason(code: VisualErrorCode): FusionUnavailableReason {
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

function unitScore(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function marginBp(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= BP;
}

function validPolicy(policy: FusionPolicy): boolean {
  return (
    !!policy &&
    typeof policy.calibrated === "boolean" &&
    typeof policy.contradictionEnabled === "boolean" &&
    marginBp(policy.corroborateMarginBp) &&
    marginBp(policy.contradictMarginBp) &&
    marginBp(policy.domDecisiveMarginBp) &&
    marginBp(policy.minSizeRatioBp) &&
    // A zero margin would let equal scores corroborate or contradict.
    (!policy.calibrated || (policy.corroborateMarginBp > 0 && policy.contradictMarginBp > 0))
  );
}

function elementEvidence(evidence: VisualEvidence): boolean {
  return (
    evidence.kind === "element" &&
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

function area(evidence: VisualEvidence): number {
  return evidence.bounds!.actualCss.width * evidence.bounds!.actualCss.height;
}

/** Smaller over larger area, in basis points (floored). */
function sizeRatioBp(a: VisualEvidence, b: VisualEvidence): number {
  const x = area(a);
  const y = area(b);
  return Math.floor((Math.min(x, y) * BP) / Math.max(x, y));
}

/**
 * Decide the fusion verdict for one DOM recovery decision. Never throws: malformed input is `dom-only` /
 * `invalid-input`, which has no effect.
 */
export function decideFusion(input: FusionInput, policy: FusionPolicy = UNCALIBRATED_FUSION_POLICY): FusionVerdict {
  // R1
  if (!input || (input.mode !== "shadow" && input.mode !== "enforce-veto")) return verdict("unchecked", "fusion-off");
  if (input.eligibility !== "eligible" && input.eligibility !== "shadow-only") return verdict("unchecked", "step-ineligible");
  if (!input.reference) return verdict("unchecked", "no-reference");

  // R2 — any unavailable input, the reference first. Fail closed: no effect.
  if (isUnavailable(input.reference)) return verdict("dom-only", unavailableReason(input.reference.code));
  if (!input.winner) return verdict("dom-only", "invalid-input");
  if (isUnavailable(input.winner)) return verdict("dom-only", unavailableReason(input.winner.code));
  if (!Array.isArray(input.competitors)) return verdict("dom-only", "invalid-input");
  for (const competitor of input.competitors) {
    if (!competitor) return verdict("dom-only", "invalid-input");
    if (isUnavailable(competitor)) return verdict("dom-only", unavailableReason(competitor.code));
  }

  const reference = input.reference;
  const winner = input.winner;
  const competitors = input.competitors as VisualEvidence[];
  const dom = input.dom;
  if (
    !validPolicy(policy) ||
    !dom ||
    !unitScore(dom.margin) ||
    !dom.winner ||
    !unitScore(dom.winner.score) ||
    !Array.isArray(dom.competitors) ||
    dom.competitors.length !== competitors.length ||
    competitors.length > FUSION_MAX_COMPETITORS ||
    !dom.competitors.every((c) => !!c && unitScore(c.score)) ||
    !elementEvidence(reference) ||
    !elementEvidence(winner) ||
    !competitors.every(elementEvidence)
  ) {
    return verdict("dom-only", "invalid-input");
  }

  // R3 — conditions are derived from the evidence, never trusted from the caller.
  if (!sameConditions(reference, winner) || !competitors.every((c) => sameConditions(reference, c))) {
    return verdict("dom-only", "conditions-changed");
  }

  const winnerComparison = compareVisualFingerprints(reference.fingerprint, winner.fingerprint);
  if (!winnerComparison.ok) return verdict("dom-only", unavailableReason(winnerComparison.code));
  const winnerBp = Math.round(winnerComparison.value.score * BP);

  // R4
  if (winnerComparison.value.identical) {
    return verdict("corroborated", "identical", { winnerScore: winnerBp / BP, identical: true });
  }

  // R5
  if (competitors.length === 0) {
    return verdict("dom-only", "no-competitors", { winnerScore: winnerBp / BP, identical: false });
  }

  const competitorBp: number[] = [];
  for (const competitor of competitors) {
    const comparison = compareVisualFingerprints(reference.fingerprint, competitor.fingerprint);
    if (!comparison.ok) return verdict("dom-only", unavailableReason(comparison.code));
    competitorBp.push(Math.round(comparison.value.score * BP));
  }
  let leader = 0;
  for (let i = 1; i < competitorBp.length; i++) if (competitorBp[i] > competitorBp[leader]) leader = i;
  const bestBp = competitorBp[leader];
  const visualMarginBp = winnerBp - bestBp;
  const evidence: FusionVerdictEvidence = {
    winnerScore: winnerBp / BP,
    bestCompetitorScore: bestBp / BP,
    visualMargin: visualMarginBp / BP,
    identical: false
  };

  if (!policy.calibrated) return verdict("dom-only", "uncalibrated", evidence);

  // R6
  if (visualMarginBp >= policy.corroborateMarginBp) return verdict("corroborated", "visual-leader", evidence);

  // R8 — the only veto row. Every clause must hold; otherwise the outcome is R7 with the clause that failed.
  if (!policy.contradictionEnabled || -visualMarginBp < policy.contradictMarginBp) {
    return verdict("contested", "mixed", evidence);
  }
  const domMarginBp = Math.round(dom.margin * BP);
  if (domMarginBp >= policy.domDecisiveMarginBp) return verdict("contested", "dom-decisive", evidence);
  if (sizeRatioBp(reference, winner) < policy.minSizeRatioBp || sizeRatioBp(reference, competitors[leader]) < policy.minSizeRatioBp) {
    return verdict("contested", "size-out-of-bounds", evidence);
  }
  const effect: FusionEffect = input.mode === "enforce-veto" && input.eligibility === "eligible" ? "veto" : "none";
  return verdict("contradicted", "visual-contradiction", evidence, effect);
}
