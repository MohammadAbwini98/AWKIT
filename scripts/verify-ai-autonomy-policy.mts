/**
 * verify:ai-autonomy-policy — Phase L L1.4 autonomy policy (docs/ai/DECISIONS.md 2026-09-19).
 *
 * Proves the four properties the plan names: the tier matrix, T3 unreachable, the T2 global cap and
 * per-feature ceilings, and self-demotion. The expected table is written out HERE, independently of
 * `src/security/authz/AiAutonomyPolicy.ts`, so a ceiling raised or a T3 class dropped in the policy
 * fails this verifier instead of being mirrored by it.
 *
 * What makes it fail: any feature/tier/context combination whose decision differs from the ratified
 * table; any T3 input that reaches observe/suggest/autoApply; any configuration value that lifts a
 * feature above its ceiling or T2; a demotion that trips below the minimum sample or on T1 records.
 *
 * Run: npm run verify:ai-autonomy-policy
 */

import {
  AI_ACTION_CLASSES,
  AI_FEATURE_CEILINGS,
  AI_FEATURE_IDS,
  AI_FORBIDDEN_ACTION_CLASSES,
  AI_GLOBAL_TIER_CAP,
  AI_SELF_DEMOTION,
  decideAiAction,
  evaluateSelfDemotion,
  isConfigurableAiTier,
  type AiActionContext,
  type AiPolicyConfig,
  type AiSelfDemotionFact
} from "@src/security/authz/AiAutonomyPolicy";
import { AI_ACTION_RECORD_RETENTION } from "@src/ai/AiActionRecord";

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── The ratified table, restated independently ──────────────────────────────────────────────────
type Tier = "T0" | "T1" | "T2";
const RANK: Record<Tier, number> = { T0: 0, T1: 1, T2: 2 };
const CEILING: Record<string, Tier> = {
  locatorSemanticUpgrade: "T2",
  locatorRepair: "T1",
  safeFixRanking: "T1",
  fragmentParameterMapping: "T1",
  failureAnalysis: "T0",
  validationExplanation: "T0",
  fragmentSummary: "T0"
};
const ACTIONS: Record<string, string[]> = {
  locatorSemanticUpgrade: ["locatorChange", "interpretation"],
  locatorRepair: ["locatorChange", "interpretation"],
  safeFixRanking: ["safeFixApply", "interpretation"],
  fragmentParameterMapping: ["parameterMapping", "interpretation"],
  failureAnalysis: ["interpretation"],
  validationExplanation: ["interpretation"],
  fragmentSummary: ["interpretation"]
};
const T3 = ["protectedLoginAction", "sensitiveLocatorChange", "graphEdit", "runControl", "aiGovernance"];
const PROTECTED_LOGIN_TYPES = ["protectedLoginHandoff", "autoSecureLogin", "reuseSession"];

const minTier = (...tiers: Tier[]): Tier => tiers.reduce((low, t) => (RANK[t] < RANK[low] ? t : low));

function expected(feature: string, action: string, configured: unknown, demoted: boolean, ctx: AiActionContext): string {
  const ceiling = CEILING[feature];
  const configuredTier: Tier =
    configured === undefined ? ceiling : configured === "T0" || configured === "T1" || configured === "T2" ? configured : "T0";
  const tier = minTier(configuredTier, ceiling, "T2", demoted ? "T1" : "T2");
  if (action === "interpretation" || tier === "T0") return "observe";
  if (tier === "T1") return "suggest";
  return ctx.proofSatisfied === true && ctx.meaningChange !== true ? "autoApply" : "suggest";
}

const SAFE_STEP = { type: "click", name: "Open details" };
const TIER_VALUES: unknown[] = [undefined, "T0", "T1", "T2"];
const GARBAGE_TIERS: unknown[] = ["T3", "T9", "autoApply", 2, null, "", "t2"];
const config = (enabled: boolean, feature: string, tier: unknown, demoted: boolean): AiPolicyConfig => ({
  enabled,
  featureTiers: tier === undefined ? {} : { [feature]: tier },
  demotedFeatures: demoted ? [feature] : []
});

console.log("Registry matches the ratified decision:\n");
{
  check("seven features are registered", AI_FEATURE_IDS.length === 7, JSON.stringify(AI_FEATURE_IDS));
  check("every registered feature is in the ratified table", AI_FEATURE_IDS.every((f) => f in CEILING));
  check(
    "every ceiling equals the ratified default",
    AI_FEATURE_IDS.every((f) => AI_FEATURE_CEILINGS[f] === CEILING[f]),
    JSON.stringify(AI_FEATURE_CEILINGS)
  );
  check("the global cap is T2", AI_GLOBAL_TIER_CAP === "T2");
  check("exactly five T3 action classes", AI_FORBIDDEN_ACTION_CLASSES.length === 5, JSON.stringify(AI_FORBIDDEN_ACTION_CLASSES));
  check("the T3 classes are the ratified list", T3.every((c) => (AI_FORBIDDEN_ACTION_CLASSES as readonly string[]).includes(c)));
  check(
    "no permitted action class is also a T3 class",
    AI_ACTION_CLASSES.every((c) => !(AI_FORBIDDEN_ACTION_CLASSES as readonly string[]).includes(c))
  );
  check("only locatorSemanticUpgrade has a T2 ceiling", AI_FEATURE_IDS.filter((f) => AI_FEATURE_CEILINGS[f] === "T2").join() === "locatorSemanticUpgrade");
}

console.log("\nTier matrix (feature × action × configured tier × demotion × proof × meaning):\n");
{
  const outcomes = new Map<string, number>();
  let cases = 0;
  const mismatches: string[] = [];
  for (const feature of AI_FEATURE_IDS) {
    for (const action of ACTIONS[feature]) {
      for (const tier of [...TIER_VALUES, ...GARBAGE_TIERS]) {
        for (const demoted of [false, true]) {
          for (const proofSatisfied of [false, true]) {
            for (const meaningChange of [false, true]) {
              const ctx: AiActionContext = {
                step: SAFE_STEP,
                proofSatisfied,
                meaningChange,
                validatorEmittedSafeFix: true
              };
              const got = decideAiAction(feature, action, ctx, config(true, feature, tier, demoted)).decision;
              const want = expected(feature, action, tier, demoted, ctx);
              cases += 1;
              outcomes.set(got, (outcomes.get(got) ?? 0) + 1);
              if (got !== want) mismatches.push(`${feature}/${action}/${String(tier)}/demoted=${demoted}/proof=${proofSatisfied}/meaning=${meaningChange}: got ${got}, want ${want}`);
            }
          }
        }
      }
    }
  }
  check("every combination matches the ratified table", mismatches.length === 0, mismatches.slice(0, 5).join("; "));
  check("the matrix is non-vacuous (observe, suggest and autoApply all occur)", ["observe", "suggest", "autoApply"].every((o) => (outcomes.get(o) ?? 0) > 0), JSON.stringify([...outcomes]));
  check("no permitted, non-T3 combination is forbidden while enabled", (outcomes.get("forbidden") ?? 0) === 0, String(outcomes.get("forbidden")));
  // 11 feature/action pairs × 11 tier values × demotion × proof × meaning.
  check("the matrix covered 968 combinations", cases === 968, String(cases));
}

console.log("\nGlobal cap and ceilings — configuration never raises a feature:\n");
{
  const aboveCeiling: string[] = [];
  for (const feature of AI_FEATURE_IDS) {
    for (const tier of [...TIER_VALUES, ...GARBAGE_TIERS]) {
      for (const action of ACTIONS[feature]) {
        const decision = decideAiAction(feature, action, { step: SAFE_STEP, proofSatisfied: true, validatorEmittedSafeFix: true }, config(true, feature, tier, false));
        const tierRank = decision.tier ? RANK[decision.tier as Tier] : -1;
        if (tierRank > RANK[CEILING[feature]] || tierRank > RANK.T2) aboveCeiling.push(`${feature}/${String(tier)} -> ${decision.tier}`);
        if (decision.decision === "autoApply" && CEILING[feature] !== "T2") aboveCeiling.push(`${feature} auto-applied`);
        if (decision.decision === "suggest" && CEILING[feature] === "T0") aboveCeiling.push(`${feature} suggested`);
      }
    }
  }
  check("no configured value lifts any feature above its ceiling or T2", aboveCeiling.length === 0, aboveCeiling.slice(0, 5).join("; "));
  check("T2 is not configurable for a T1-ceiling feature", !isConfigurableAiTier("locatorRepair", "T2"));
  check("T1 is not configurable for a T0-ceiling feature", !isConfigurableAiTier("failureAnalysis", "T1"));
  check("lowering to T0 is configurable", isConfigurableAiTier("locatorSemanticUpgrade", "T0"));
  check("restoring up to the ceiling is configurable", isConfigurableAiTier("locatorSemanticUpgrade", "T2") && isConfigurableAiTier("locatorRepair", "T1"));
  check("T3 is never a configurable tier", AI_FEATURE_IDS.every((f) => !isConfigurableAiTier(f, "T3")));
  check("garbage is never configurable", GARBAGE_TIERS.every((t) => AI_FEATURE_IDS.every((f) => !isConfigurableAiTier(f, t))));
  check("an unknown feature is never configurable", !isConfigurableAiTier("rogueFeature", "T0"));
}

console.log("\nT3 is unreachable by any configuration:\n");
{
  const leaks: string[] = [];
  let probes = 0;
  const probe = (label: string, feature: string, action: string, ctx: AiActionContext): void => {
    for (const enabled of [true, false]) {
      for (const tier of [...TIER_VALUES, ...GARBAGE_TIERS]) {
        for (const demoted of [false, true]) {
          const decision = decideAiAction(feature, action, ctx, config(enabled, feature, tier, demoted));
          probes += 1;
          if (decision.decision !== "forbidden") leaks.push(`${label} ${feature}/${action}/enabled=${enabled}/${String(tier)} -> ${decision.decision}`);
          // T3 is decided before configuration is read, so the reason is T3 even with the switch off.
          else if (!decision.reason.startsWith("T3_")) leaks.push(`${label} forbidden for ${decision.reason}, not a T3 reason`);
        }
      }
    }
  };
  const full: AiActionContext = { step: SAFE_STEP, proofSatisfied: true, validatorEmittedSafeFix: true };

  for (const feature of AI_FEATURE_IDS) {
    for (const t3 of T3) probe("T3 class", feature, t3, full);
    for (const action of ACTIONS[feature]) {
      // 1. protected-login surface: nothing, not even an interpretation, because its evidence never reaches the model.
      probe("T3 protected-login surface", feature, action, { ...full, protectedLoginSurface: true });
      for (const type of PROTECTED_LOGIN_TYPES) probe(`T3 protected-login step ${type}`, feature, action, { ...full, step: { type, name: "Sign in" } });
    }
  }
  // 2. a locator change on a sensitive-action step — explicit safety, and the keyword fallback LocatorFactory also uses.
  for (const feature of ["locatorSemanticUpgrade", "locatorRepair"]) {
    probe("T3 sensitive step (dangerousMutation)", feature, "locatorChange", { ...full, step: { type: "click", name: "x", safety: { sideEffectLevel: "dangerousMutation", retryable: false } } });
    probe("T3 sensitive step (externalCommit)", feature, "locatorChange", { ...full, step: { type: "fill", name: "x", safety: { sideEffectLevel: "externalCommit", retryable: false } } });
    probe("T3 sensitive step (keyword fallback)", feature, "locatorChange", { ...full, step: { type: "click", name: "Submit payment" } });
    probe("T3 locator change with no step", feature, "locatorChange", { proofSatisfied: true });
  }
  // 3. a graph edit other than a validator-emitted safeFix.
  probe("T3 unemitted safeFix", "safeFixRanking", "safeFixApply", { ...full, validatorEmittedSafeFix: false });
  probe("T3 unemitted safeFix (absent)", "safeFixRanking", "safeFixApply", { step: SAFE_STEP });

  check("every T3 probe is forbidden, enabled or not, at every tier", leaks.length === 0, leaks.slice(0, 5).join("; "));
  // 44 configurations × (7 features × 5 classes + 11 pairs × 4 protected-login probes + 8 sensitive + 2 safeFix).
  check("the T3 probe set is non-vacuous", probes === 2 * 11 * 2 * (7 * 5 + 11 * 4 + 2 * 4 + 2), String(probes));

  // T0 prose may DISCUSS a sensitive step; only acting on it is forbidden.
  const discuss = decideAiAction("locatorRepair", "interpretation", { step: { type: "click", name: "Submit payment" } }, config(true, "locatorRepair", undefined, false));
  check("an interpretation about a sensitive step is still observable", discuss.decision === "observe", JSON.stringify(discuss));
  check("an unknown action class is forbidden", decideAiAction("locatorRepair", "deleteFlow", full, config(true, "x", undefined, false)).decision === "forbidden");
  check("an unknown feature is forbidden", decideAiAction("rogueFeature", "interpretation", full, config(true, "x", undefined, false)).decision === "forbidden");
  check(
    "a feature cannot borrow another feature's action class",
    decideAiAction("failureAnalysis", "locatorChange", full, config(true, "failureAnalysis", undefined, false)).decision === "forbidden"
  );
}

console.log("\nMaster switch:\n");
{
  const off = AI_FEATURE_IDS.flatMap((f) =>
    ACTIONS[f].map((a) => decideAiAction(f, a, { step: SAFE_STEP, proofSatisfied: true, validatorEmittedSafeFix: true }, config(false, f, undefined, false)))
  );
  check("switch off forbids every feature and action", off.every((d) => d.decision === "forbidden"));
  check("switch off reports MASTER_SWITCH_OFF", off.every((d) => d.reason === "MASTER_SWITCH_OFF"), JSON.stringify(off.map((d) => d.reason)));
  check("switch off covered every permitted pairing", off.length === 11, String(off.length));
}

console.log("\nSelf-demotion:\n");
{
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-09-19T12:00:00.000Z");
  const facts = (applied: number, reverted: number, options: { feature?: string; tier?: string; ageMs?: number } = {}): AiSelfDemotionFact[] =>
    Array.from({ length: applied }, (_, i) => ({
      feature: options.feature ?? "locatorSemanticUpgrade",
      tier: options.tier ?? "T2",
      createdAt: new Date(now - (options.ageMs ?? DAY)).toISOString(),
      reverted: i < reverted
    }));
  const min = AI_SELF_DEMOTION.minSample;
  const threshold = AI_SELF_DEMOTION.maxRevertRate;
  const atThreshold = Math.floor(min * threshold);

  check("the seeded window fits inside the 90-day record retention", AI_SELF_DEMOTION.windowMs <= AI_ACTION_RECORD_RETENTION.maxAgeMs);
  check("the seeded values are sane", min >= 1 && threshold > 0 && threshold < 1, JSON.stringify(AI_SELF_DEMOTION));
  check("below the minimum sample never demotes, even at 100% reverts", !evaluateSelfDemotion("locatorSemanticUpgrade", facts(min - 1, min - 1), now).demote);
  check("a rate AT the threshold does not demote", !evaluateSelfDemotion("locatorSemanticUpgrade", facts(min, atThreshold), now).demote, `${atThreshold}/${min}`);
  const tripped = evaluateSelfDemotion("locatorSemanticUpgrade", facts(min, atThreshold + 1), now);
  check("a rate ABOVE the threshold demotes", tripped.demote, JSON.stringify(tripped));
  check("the evaluation reports its counts", tripped.applied === min && tripped.reverted === atThreshold + 1);
  check(
    "records outside the window do not count",
    !evaluateSelfDemotion("locatorSemanticUpgrade", facts(min, min, { ageMs: AI_SELF_DEMOTION.windowMs + DAY }), now).demote
  );
  check("T1 (user-approved) records do not count", !evaluateSelfDemotion("locatorSemanticUpgrade", facts(min, min, { tier: "T1" }), now).demote);
  check("another feature's records do not count", !evaluateSelfDemotion("locatorSemanticUpgrade", facts(min, min, { feature: "locatorRepair" }), now).demote);
  check("a feature whose ceiling is below T2 never demotes", !evaluateSelfDemotion("locatorRepair", facts(min, min, { feature: "locatorRepair" }), now).demote);
  const demotedDecision = decideAiAction("locatorSemanticUpgrade", "locatorChange", { step: SAFE_STEP, proofSatisfied: true }, config(true, "locatorSemanticUpgrade", "T2", true));
  check("a demoted T2 feature suggests instead of auto-applying", demotedDecision.decision === "suggest" && demotedDecision.tier === "T1", JSON.stringify(demotedDecision));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
