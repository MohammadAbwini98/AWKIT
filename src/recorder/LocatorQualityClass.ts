/**
 * Phase L L2: the one explainable locator quality class, shared by the Recorder, the Flow Designer and
 * (later) the L3 upgrade trigger. Deterministic and derived from what a saved `StepLocator` already
 * carries — record-time match counts, strategy, disambiguation, guard, scope and resolution — so it is
 * never persisted and never drifts from the locator it describes. Not an AI score.
 *
 *   strong-semantic      a semantic strategy (test id, role + name, label, placeholder, id) unique on
 *                        its own at capture
 *   acceptable-semantic  semantic, but leaning on help: visible text, a role without a name, container
 *                        or closed-shadow scope, nested frames, visibility, or no capture evidence
 *   guarded-positional   a positional index the runner re-proves against the recorded fingerprint
 *                        before acting (runnable, and resolved: L2 never changes that)
 *   review-required      nothing proves it finds the same element: unguarded positional, not unique,
 *                        structural selectors (CSS, XPath, tag), or a needs-review/invalid resolution
 *
 * The last two are what L3 tries to upgrade. A class never changes execution: `resolution` decides that.
 */
import { locatorContainerChain, locatorFrameChain, type StepLocator } from "@src/profiles/FlowProfile";
import { hasPositionalIdentityGuard, isPositionalLocator } from "@src/profiles/locatorApproval";

export type LocatorQualityClass = "strong-semantic" | "acceptable-semantic" | "guarded-positional" | "review-required";

export type LocatorQualityReasonCode =
  | "resolution-invalid"
  | "resolution-needs-review"
  | "user-approved-fallback"
  | "guarded-positional"
  | "positional-unguarded"
  | "not-unique"
  | "structural-selector"
  | "xpath-opt-in"
  | "unique-semantic"
  | "text-content"
  | "role-without-name"
  | "no-capture-evidence"
  | "low-capture-confidence"
  | "unique-when-visible"
  | "container-scoped"
  | "closed-shadow"
  | "nested-frames"
  | "in-frame"
  | "identity-fingerprint";

export interface LocatorQualityReason {
  code: LocatorQualityReasonCode;
  detail: string;
}

export interface LocatorQualityClassification {
  class: LocatorQualityClass;
  /** The deciding reason first, then context. */
  reasons: LocatorQualityReason[];
}

export const LOCATOR_QUALITY_CLASS_LABEL: Readonly<Record<LocatorQualityClass, string>> = Object.freeze({
  "strong-semantic": "Strong semantic",
  "acceptable-semantic": "Acceptable semantic",
  "guarded-positional": "Guarded positional",
  "review-required": "Review required"
});

const STRONG_STRATEGIES: ReadonlySet<string> = new Set(["testId", "role", "label", "placeholder", "id"]);
const STRUCTURAL_STRATEGIES: ReadonlySet<string> = new Set(["css", "xpath", "tagName"]);
const STRATEGY_NAME: Readonly<Record<string, string>> = { testId: "test id", role: "role and name", label: "label", placeholder: "placeholder", id: "id" };

export function classifyLocatorQuality(locator: StepLocator | undefined): LocatorQualityClassification | undefined {
  if (!locator?.strategy) return undefined;
  const quality = locator.quality;
  const reasons: LocatorQualityReason[] = [];
  const result = (cls: LocatorQualityClass): LocatorQualityClassification => {
    if (locator.identity?.fingerprint) reasons.push({ code: "identity-fingerprint", detail: "An identity fingerprint was captured for the exact target." });
    return { class: cls, reasons };
  };

  if (locator.resolution === "invalid") {
    reasons.push({ code: "resolution-invalid", detail: locator.reviewReason ?? "The locator is marked invalid." });
    return result("review-required");
  }
  if (locator.resolution === "needs-review") {
    reasons.push({ code: "resolution-needs-review", detail: locator.reviewReason ?? "The Recorder could not prove the target's identity." });
    return result("review-required");
  }

  // The runtime's own predicates (LocatorFactory): only a well-formed guard on a positional locator is re-proven.
  if (isPositionalLocator(locator)) {
    if (hasPositionalIdentityGuard({ locator }) && locator.guard) {
      const { index, siblingCount, confidence } = locator.guard;
      reasons.push({
        code: "guarded-positional",
        detail: `Position ${index + 1} of ${siblingCount} candidates, re-proven against the recorded fingerprint (${confidence} match) before every action.`
      });
      return result("guarded-positional");
    }
    reasons.push(
      locator.resolution === "user-approved-fallback"
        ? { code: "user-approved-fallback", detail: "A user-approved positional fallback with no identity guard." }
        : { code: "positional-unguarded", detail: "A positional locator with no identity guard: a reordered page changes the target." }
    );
    return result("review-required");
  }

  if (quality && !quality.isUnique) {
    reasons.push({ code: "not-unique", detail: `Matched ${quality.matchCount} elements at capture.` });
    return result("review-required");
  }
  if (locator.resolution === "user-approved-fallback") {
    reasons.push({ code: "user-approved-fallback", detail: "The user approved this fallback instead of a proven unique locator." });
    return result("review-required");
  }
  if (STRUCTURAL_STRATEGIES.has(locator.strategy)) {
    reasons.push(
      locator.strategy === "xpath"
        ? { code: "xpath-opt-in", detail: "XPath was chosen explicitly: low durability when the page structure changes." }
        : { code: "structural-selector", detail: `A ${locator.strategy === "css" ? "CSS" : "tag"} selector follows page structure, not meaning.` }
    );
    return result("review-required");
  }

  // Semantic from here on. Anything that helped it along makes it acceptable rather than strong.
  const downgrades: LocatorQualityReason[] = [];
  if (locator.strategy === "text") downgrades.push({ code: "text-content", detail: "Visible text changes with copy edits and translations." });
  if (locator.strategy === "role" && !locator.name) downgrades.push({ code: "role-without-name", detail: "A role without an accessible name." });
  if (!quality) downgrades.push({ code: "no-capture-evidence", detail: "No record-time uniqueness evidence (hand-authored or saved before it existed)." });
  else if (quality.confidence === "low") downgrades.push({ code: "low-capture-confidence", detail: "The Recorder rated its own capture low confidence." });
  if (quality && quality.matchCount > 1 && quality.visibleMatchCount === 1) {
    downgrades.push({ code: "unique-when-visible", detail: `Unique among visible elements only (${quality.matchCount} in the DOM).` });
  }
  const containers = locatorContainerChain(locator.context);
  if (containers.length) {
    downgrades.push({ code: "container-scoped", detail: `Unique inside ${containers.map((container) => container.type).join(" → ")}.` });
  }
  if (locator.context?.shadow?.boundary === "closed") downgrades.push({ code: "closed-shadow", detail: "Inside a closed shadow root (instrumented resolution)." });
  const frames = locatorFrameChain(locator.context).length;
  if (frames > 1) downgrades.push({ code: "nested-frames", detail: `Inside ${frames} nested frames.` });

  if (downgrades.length === 0 && STRONG_STRATEGIES.has(locator.strategy)) {
    reasons.push({ code: "unique-semantic", detail: `Unique by ${STRATEGY_NAME[locator.strategy]} at capture (${quality?.matchCount ?? 1} match).` });
    if (frames === 1) reasons.push({ code: "in-frame", detail: "Inside one frame." });
    return result("strong-semantic");
  }
  reasons.push(...downgrades);
  if (frames === 1) reasons.push({ code: "in-frame", detail: "Inside one frame." });
  return result("acceptable-semantic");
}
