/**
 * Phase L autonomy policy (L1.4): the single, pure authority that decides what an AI feature may do
 * with a proposal: observe it, suggest it, auto-apply it, or nothing. The values are ratified in
 * docs/ai/DECISIONS.md (2026-09-19); `verify:ai-autonomy-policy` restates that table independently.
 *
 * It lives beside `Permissions.ts` because it IS authorization: `src/security/**` routes to the
 * security owner as `authorization_change`, so every edit to a ceiling, the cap or the T3 list is
 * lease-gated. (The plan named `src/ai/`; the routing matrix forbids one owner's glob nested inside
 * another's, so the protected module sits here and the rest of the AI code stays in `src/ai/`.)
 *
 * `decideAiAction` applies, in order:
 *  1. T3, before configuration is read: the forbidden action classes; anything on a protected-login
 *     surface (not even an interpretation, because that evidence never reaches the model); a locator
 *     change on a sensitive-action step or on a step it cannot see; a safe fix the validator did not
 *     emit for the current graph. The T3 reason survives the master switch.
 *  2. Unknown features or action classes, and a class the feature does not own, fail closed.
 *  3. Master switch off: nothing runs, so behavior is identical to today.
 *  4. Effective tier = min(configured, ceiling, T2 cap, T1 when self-demoted). An unrecognised
 *     configured value fails closed to T0; configuration can lower a feature, never raise it.
 *  5. An interpretation is always observe. T0 observes, T1 suggests, T2 auto-applies only with the
 *     feature's proof satisfied and no meaning change, otherwise it suggests.
 *
 * Pure and renderer-safe: it imports only the step-safety predicate `LocatorFactory` also uses and the
 * canonical protected-login step-type set from the profile vocabulary.
 */

import { PROTECTED_LOGIN_STEP_TYPES as CANONICAL_PROTECTED_LOGIN_STEP_TYPES, type StepSafetyPolicy } from "../../profiles/FlowProfile";
import { resolveStepSafety } from "../../runner/runtime/StepSafetyPolicy";

export type AiTier = "T0" | "T1" | "T2";
export type AiDecision = "observe" | "suggest" | "autoApply" | "forbidden";

const TIER_RANK: Readonly<Record<AiTier, number>> = { T0: 0, T1: 1, T2: 2 };

export const AI_FEATURE_IDS = [
  "locatorSemanticUpgrade",
  "locatorRepair",
  "safeFixRanking",
  "fragmentParameterMapping",
  "failureAnalysis",
  "validationExplanation",
  "fragmentSummary"
] as const;
export type AiFeatureId = (typeof AI_FEATURE_IDS)[number];

/** Each feature's default tier is also its ceiling. */
export const AI_FEATURE_CEILINGS: Readonly<Record<AiFeatureId, AiTier>> = Object.freeze({
  locatorSemanticUpgrade: "T2",
  locatorRepair: "T1",
  safeFixRanking: "T1",
  fragmentParameterMapping: "T1",
  failureAnalysis: "T0",
  validationExplanation: "T0",
  fragmentSummary: "T0"
});

/** No ceiling, configuration or demotion can produce a tier above this. */
export const AI_GLOBAL_TIER_CAP: AiTier = "T2";

/** Action classes a feature may request. */
export const AI_ACTION_CLASSES = ["interpretation", "locatorChange", "safeFixApply", "parameterMapping"] as const;
export type AiActionClass = (typeof AI_ACTION_CLASSES)[number];

/** T3: forbidden whatever the configuration. T0 prose may discuss these topics but never act on them. */
export const AI_FORBIDDEN_ACTION_CLASSES = [
  "protectedLoginAction",
  "sensitiveLocatorChange",
  "graphEdit",
  "runControl",
  "aiGovernance"
] as const;

const FEATURE_ACTIONS: Readonly<Record<AiFeatureId, readonly AiActionClass[]>> = Object.freeze({
  locatorSemanticUpgrade: ["locatorChange", "interpretation"],
  locatorRepair: ["locatorChange", "interpretation"],
  safeFixRanking: ["safeFixApply", "interpretation"],
  fragmentParameterMapping: ["parameterMapping", "interpretation"],
  failureAnalysis: ["interpretation"],
  validationExplanation: ["interpretation"],
  fragmentSummary: ["interpretation"]
});

/**
 * The step types that ARE the protected-login surface, whose evidence never reaches the model. The
 * membership comes from `FlowProfile`, beside the `StepType` union that defines those names — this
 * module used to restate it, which made the T3 list a copy that could silently stop matching the
 * vocabulary it is about. Importing it does not widen what T3 forbids: the same three types, and this
 * module still decides on its own what to do with them. Only the STATIC type is widened here, because
 * `AiActionContext.step.type` is an arbitrary string from an untrusted caller; asserting it into
 * `StepType` to satisfy the lookup would claim something about the value that nothing has checked.
 */
const PROTECTED_LOGIN_STEP_TYPES: ReadonlySet<string> = CANONICAL_PROTECTED_LOGIN_STEP_TYPES;

export function isAiFeatureId(value: unknown): value is AiFeatureId {
  return typeof value === "string" && (AI_FEATURE_IDS as readonly string[]).includes(value);
}

export function isAiActionClass(value: unknown): value is AiActionClass {
  return typeof value === "string" && (AI_ACTION_CLASSES as readonly string[]).includes(value);
}

function isTier(value: unknown): value is AiTier {
  return value === "T0" || value === "T1" || value === "T2";
}

function lowest(...tiers: AiTier[]): AiTier {
  return tiers.reduce((low, tier) => (TIER_RANK[tier] < TIER_RANK[low] ? tier : low));
}

export interface AiActionContext {
  /** The step the action targets. A locator change with no step is refused: it cannot be proven non-sensitive. */
  step?: { type: string; name?: string; value?: string; safety?: StepSafetyPolicy };
  /** The protected-login detector classified the page or evidence this action derives from. */
  protectedLoginSurface?: boolean;
  /** `safeFixApply` only: the fix is one `FlowValidator` emitted for the CURRENT graph. */
  validatorEmittedSafeFix?: boolean;
  /** The proposal changes the target's meaning (for example position to text). Blocks auto-apply. */
  meaningChange?: boolean;
  /** The feature's auto-apply proof criteria are met (L3: replay proof across distinct data rows). */
  proofSatisfied?: boolean;
}

export interface AiPolicyConfig {
  /** Master switch. */
  enabled: boolean;
  /** Configured tier per feature; absent means the ceiling. Untrusted: validated here, never assumed. */
  featureTiers?: Readonly<Record<string, unknown>>;
  /** Features the self-demotion rule has demoted; only an administrator restores them. */
  demotedFeatures?: readonly string[];
}

export type AiPolicyReason =
  | "T3_FORBIDDEN_CLASS"
  | "T3_PROTECTED_LOGIN"
  | "T3_SENSITIVE_STEP"
  | "T3_STEP_UNKNOWN"
  | "T3_UNEMITTED_SAFE_FIX"
  | "UNKNOWN_FEATURE"
  | "UNKNOWN_ACTION_CLASS"
  | "ACTION_NOT_REGISTERED"
  | "MASTER_SWITCH_OFF"
  | "INTERPRETATION"
  | "TIER_T0"
  | "TIER_T1"
  | "TIER_T2"
  | "MEANING_CHANGE"
  | "PROOF_NOT_SATISFIED";

export interface AiPolicyDecision {
  decision: AiDecision;
  /** Effective tier, or null when forbidden. */
  tier: AiTier | null;
  reason: AiPolicyReason;
}

const forbidden = (reason: AiPolicyReason): AiPolicyDecision => ({ decision: "forbidden", tier: null, reason });

function isSensitiveStep(step: NonNullable<AiActionContext["step"]>): boolean {
  const level = resolveStepSafety(step).sideEffectLevel;
  return level === "dangerousMutation" || level === "externalCommit";
}

/** Effective tier for a known feature: never above its ceiling, the global cap, or T1 once demoted. */
export function effectiveAiTier(feature: AiFeatureId, config: AiPolicyConfig): AiTier {
  const ceiling = AI_FEATURE_CEILINGS[feature];
  const hasConfigured = config.featureTiers !== undefined && Object.prototype.hasOwnProperty.call(config.featureTiers, feature);
  const raw = hasConfigured ? config.featureTiers![feature] : undefined;
  const configured = raw === undefined ? ceiling : isTier(raw) ? raw : "T0";
  const demoted = config.demotedFeatures?.includes(feature) === true;
  return lowest(configured, ceiling, AI_GLOBAL_TIER_CAP, demoted ? "T1" : AI_GLOBAL_TIER_CAP);
}

/** Whether `tier` may be stored for `feature`: a real tier at or below the feature's ceiling. */
export function isConfigurableAiTier(feature: unknown, tier: unknown): boolean {
  return isAiFeatureId(feature) && isTier(tier) && TIER_RANK[tier] <= TIER_RANK[AI_FEATURE_CEILINGS[feature]];
}

export function decideAiAction(
  feature: string,
  actionClass: string,
  context: AiActionContext,
  config: AiPolicyConfig
): AiPolicyDecision {
  // 1. T3, before any configuration is consulted.
  if ((AI_FORBIDDEN_ACTION_CLASSES as readonly string[]).includes(actionClass)) return forbidden("T3_FORBIDDEN_CLASS");
  if (context.protectedLoginSurface === true || (context.step && PROTECTED_LOGIN_STEP_TYPES.has(context.step.type))) {
    return forbidden("T3_PROTECTED_LOGIN");
  }
  if (actionClass === "locatorChange") {
    if (!context.step) return forbidden("T3_STEP_UNKNOWN");
    if (isSensitiveStep(context.step)) return forbidden("T3_SENSITIVE_STEP");
  }
  if (actionClass === "safeFixApply" && context.validatorEmittedSafeFix !== true) return forbidden("T3_UNEMITTED_SAFE_FIX");

  // 2. Fail closed on anything this policy does not know.
  if (!isAiFeatureId(feature)) return forbidden("UNKNOWN_FEATURE");
  if (!isAiActionClass(actionClass)) return forbidden("UNKNOWN_ACTION_CLASS");
  if (!FEATURE_ACTIONS[feature].includes(actionClass)) return forbidden("ACTION_NOT_REGISTERED");

  // 3. Master switch.
  if (config.enabled !== true) return forbidden("MASTER_SWITCH_OFF");

  // 4-5. Tier.
  const tier = effectiveAiTier(feature, config);
  if (actionClass === "interpretation") return { decision: "observe", tier, reason: "INTERPRETATION" };
  if (tier === "T0") return { decision: "observe", tier, reason: "TIER_T0" };
  if (tier === "T1") return { decision: "suggest", tier, reason: "TIER_T1" };
  if (context.meaningChange === true) return { decision: "suggest", tier: "T1", reason: "MEANING_CHANGE" };
  if (context.proofSatisfied !== true) return { decision: "suggest", tier: "T1", reason: "PROOF_NOT_SATISFIED" };
  return { decision: "autoApply", tier, reason: "TIER_T2" };
}

// ── Self-demotion ───────────────────────────────────────────────────────────────────────────────

/**
 * Seeded in L1, committed in L7. The window must fit inside the 90-day `AiActionRecord` retention,
 * or the records that justify a demotion could be pruned before it is evaluated.
 */
export const AI_SELF_DEMOTION = Object.freeze({
  windowMs: 30 * 24 * 60 * 60 * 1000,
  /** A revert rate strictly above this demotes. */
  maxRevertRate: 0.2,
  /** Auto-applied actions required in the window before a rate means anything. */
  minSample: 10
});

export interface AiSelfDemotionFact {
  feature: string;
  tier: string;
  createdAt: string;
  reverted: boolean;
}

export interface AiSelfDemotionEvaluation {
  demote: boolean;
  applied: number;
  reverted: number;
  revertRate: number | null;
}

/** Only auto-applied (T2) actions of a T2-ceiling feature inside the window count. */
export function evaluateSelfDemotion(
  feature: string,
  facts: readonly AiSelfDemotionFact[],
  nowMs: number
): AiSelfDemotionEvaluation {
  if (!isAiFeatureId(feature) || AI_FEATURE_CEILINGS[feature] !== "T2") {
    return { demote: false, applied: 0, reverted: 0, revertRate: null };
  }
  const since = nowMs - AI_SELF_DEMOTION.windowMs;
  const inWindow = facts.filter((fact) => {
    const at = Date.parse(fact.createdAt);
    return fact.feature === feature && fact.tier === "T2" && at >= since && at <= nowMs;
  });
  const applied = inWindow.length;
  const reverted = inWindow.filter((fact) => fact.reverted).length;
  const revertRate = applied === 0 ? null : reverted / applied;
  return {
    demote: applied >= AI_SELF_DEMOTION.minSample && revertRate !== null && revertRate > AI_SELF_DEMOTION.maxRevertRate,
    applied,
    reverted,
    revertRate
  };
}
