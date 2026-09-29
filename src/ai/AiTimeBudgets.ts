/**
 * Feature time budgets (Phase L, L9.2, E8): how long one AI request of each kind may run before the
 * service ends it TIMEOUT.
 *
 * Four things stay separate and are never derived from each other:
 *  - benchmark ACCEPTANCE CEILINGS (L1.8's 120 s explanation and 180 s background ceilings, owned by
 *    `scripts/benchmark-ai-model.mts`): evidence, never read at runtime;
 *  - runtime REQUEST TIMEOUTS: this table;
 *  - CANCEL GRACE and forced host termination: `AI_HOST_TIMEOUTS.cancelMs` / `cancelGraceMs`;
 *  - ETA RANGES: measured history (`AiEtaHistory`), never computed from a budget.
 *
 * Defaults are the values the closed Phase L evidence ran under: 125 s and 185 s are the L1.8 ceilings
 * plus 5 s, the 120 s load and 240 s probe are the host deadlines L1/L8b shipped with. Where no evidence
 * exists (fragment assistance keeps its 30 s; component copy is new) the default is a committed
 * conservative bound. An administrator may set a budget only inside [min, max]; outside it the value is
 * refused, never clamped (`sanitizeAiSettingsPatch`). A changed budget never re-labels old evidence:
 * `describeQualification` reads a feature whose budget moved as unqualified.
 *
 * Framework-agnostic and pure.
 */

import type { AiFeatureId } from "../security/authz/AiAutonomyPolicy";

export type AiBudgetId =
  | "locatorAssistance"
  | "authoringExplanation"
  | "failureAnalysis"
  | "fragmentAssistance"
  | "modelLoad"
  | "compatibilityProbe"
  | "componentCopy";

export const AI_BUDGET_IDS: readonly AiBudgetId[] = Object.freeze([
  "locatorAssistance",
  "authoringExplanation",
  "failureAnalysis",
  "fragmentAssistance",
  "modelLoad",
  "compatibilityProbe",
  "componentCopy"
]);

export interface AiBudgetBounds {
  defaultMs: number;
  minMs: number;
  maxMs: number;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** Every value a whole number of seconds, so Settings can show and accept seconds without rounding. */
export const AI_TIME_BUDGETS: Readonly<Record<AiBudgetId, Readonly<AiBudgetBounds>>> = Object.freeze({
  /** Per model call of the L3 §7 loop (a job makes up to `maxAttempts`): L1.8's 180 s ceiling + 5 s. */
  locatorAssistance: Object.freeze({ defaultMs: 185 * SECOND, minMs: 15 * SECOND, maxMs: 10 * MINUTE }),
  /** L1.8's 120 s explanation ceiling at the output cap + 5 s. */
  authoringExplanation: Object.freeze({ defaultMs: 125 * SECOND, minMs: 15 * SECOND, maxMs: 10 * MINUTE }),
  /** L1.8's 180 s background ceiling at the output cap + 5 s. */
  failureAnalysis: Object.freeze({ defaultMs: 185 * SECOND, minMs: 15 * SECOND, maxMs: 10 * MINUTE }),
  /** No L1.8 ceiling of its own: the shared 30 s it always had. */
  fragmentAssistance: Object.freeze({ defaultMs: 30 * SECOND, minMs: 15 * SECOND, maxMs: 10 * MINUTE }),
  /** `AI_HOST_TIMEOUTS.loadMs`: a load (and a GPU plan), cold disk included. */
  modelLoad: Object.freeze({ defaultMs: 120 * SECOND, minMs: 30 * SECOND, maxMs: 10 * MINUTE }),
  /** `AI_HOST_TIMEOUTS.probeMs`: a cold load plus the probe's 48 bounded tokens. */
  compatibilityProbe: Object.freeze({ defaultMs: 240 * SECOND, minMs: 60 * SECOND, maxMs: 15 * MINUTE }),
  /** A model or backend-pack copy with its hash; the pack is at most a few GB. */
  componentCopy: Object.freeze({ defaultMs: 30 * MINUTE, minMs: 1 * MINUTE, maxMs: 2 * 60 * MINUTE })
});

/** The budget each product feature's requests run under. */
export const FEATURE_BUDGET: Readonly<Record<AiFeatureId, AiBudgetId>> = Object.freeze({
  locatorSemanticUpgrade: "locatorAssistance",
  locatorRepair: "locatorAssistance",
  validationExplanation: "authoringExplanation",
  safeFixRanking: "authoringExplanation",
  failureAnalysis: "failureAnalysis",
  fragmentSummary: "fragmentAssistance",
  fragmentParameterMapping: "fragmentAssistance"
});

const INFERENCE_BUDGETS = [...new Set(Object.values(FEATURE_BUDGET))];

/** The longest request any configuration may ask for: `AiService` refuses a longer one. Never unbounded. */
export const MAX_INFERENCE_BUDGET_MS = Math.max(...INFERENCE_BUDGETS.map((id) => AI_TIME_BUDGETS[id].maxMs));

export type AiTimeBudgets = Readonly<Record<AiBudgetId, number>>;

export const isAiBudgetId = (value: unknown): value is AiBudgetId => typeof value === "string" && (AI_BUDGET_IDS as readonly string[]).includes(value);

/** A configured value in seconds, inside its committed bounds. */
export function isBudgetSeconds(id: AiBudgetId, seconds: unknown): seconds is number {
  const bounds = AI_TIME_BUDGETS[id];
  return typeof seconds === "number" && Number.isInteger(seconds) && seconds * SECOND >= bounds.minMs && seconds * SECOND <= bounds.maxMs;
}

export const AI_BUDGET_LABELS: Readonly<Record<AiBudgetId, string>> = Object.freeze({
  locatorAssistance: "Locator assistance (each attempt)",
  authoringExplanation: "Validation explanation",
  failureAnalysis: "Failure analysis",
  fragmentAssistance: "Fragment assistance",
  modelLoad: "Model load",
  compatibilityProbe: "Compatibility check",
  componentCopy: "Model or backend pack copy"
});

/** The sentence a refused value gets: main's own bounds, never a clamp. */
export function budgetBoundsSentence(id: AiBudgetId): string {
  const { minMs, maxMs } = AI_TIME_BUDGETS[id];
  return `The ${AI_BUDGET_LABELS[id].toLowerCase()} time limit must be a whole number of seconds from ${minMs / SECOND} to ${maxMs / SECOND}.`;
}

/** Every budget in milliseconds: the configured value where one is valid, else the default. */
export function resolveAiTimeBudgets(configuredSeconds: Readonly<Partial<Record<AiBudgetId, number>>> | undefined): AiTimeBudgets {
  const resolved = {} as Record<AiBudgetId, number>;
  for (const id of AI_BUDGET_IDS) {
    const seconds = configuredSeconds?.[id];
    resolved[id] = isBudgetSeconds(id, seconds) ? seconds * SECOND : AI_TIME_BUDGETS[id].defaultMs;
  }
  return Object.freeze(resolved);
}

/** The features whose budget is not the one their quality evidence was measured under. */
export function featuresWithChangedBudget(budgets: AiTimeBudgets): AiFeatureId[] {
  return (Object.keys(FEATURE_BUDGET) as AiFeatureId[]).filter((feature) => budgets[FEATURE_BUDGET[feature]] !== AI_TIME_BUDGETS[FEATURE_BUDGET[feature]].defaultMs);
}
