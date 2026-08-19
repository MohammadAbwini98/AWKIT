import type {
  FlowStep,
  InteractionDecisionBinding,
  InteractionExecutionDecisionContract,
  StepLocator
} from "./FlowProfile";
import { resolveStepSafety } from "../runner/runtime/StepSafetyPolicy";

type DecisionStep = Pick<FlowStep, "type" | "name" | "safety" | "locator">;

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function comparableBinding(step: DecisionStep): InteractionDecisionBinding | undefined {
  const identity = step.locator?.identity;
  const prerequisite = step.locator?.prerequisite;
  if (!identity || prerequisite?.status !== "unknown") return undefined;
  return {
    version: 1,
    stepType: step.type,
    stepName: step.name,
    locator: {
      strategy: step.locator!.strategy,
      value: step.locator!.value,
      name: step.locator!.name,
      exact: step.locator!.exact || undefined
    },
    context: step.locator!.context,
    identity,
    prerequisite,
    safety: step.safety
  };
}

/** Bind a confirmation to the already SHA-256-hashed identity contract and material action fields. */
export function createInteractionDecisionBinding(step: DecisionStep): InteractionDecisionBinding | undefined {
  return comparableBinding(step);
}

export function interactionDecisionBindingMatches(step: DecisionStep): boolean {
  const binding = step.locator?.executionDecision?.binding;
  const current = comparableBinding(step);
  return binding !== undefined && current !== undefined && canonical(binding) === canonical(current);
}

export function isSensitiveInteractionStep(step: DecisionStep): boolean {
  return ["dangerousMutation", "externalCommit"].includes(resolveStepSafety(step).sideEffectLevel);
}

/**
 * How an unknown prerequisite can be proven safe for each step type, without performing the action.
 *
 * `"pointer"` uses Playwright's own `trial: true`, which runs the full actionability check (visible,
 * stable, receives events, enabled) and then deliberately does NOT act.
 *
 * `"predicate"` exists because `trial` is not offered on every action — notably `fill`, where
 * Playwright has no trial option at all. Those types are proven with Playwright's own predicates
 * instead (`waitFor({state:"visible"})`, `isEnabled()`, `isEditable()`), which is the same
 * actionability evidence expressed through a different API. It is not a weaker check and it is not
 * a bypass: nothing is forced, and a target that fails still refuses to run.
 *
 * Why this map exists at all: trial authority used to be `step.type === "click"`, so a `fill`,
 * `select` or `check` whose prerequisite came back `unknown` could not be resolved by ANY of the
 * three actions the UI offers — "Try direct action" and "Confirm no prerequisite" both route through
 * this predicate, so both were structurally incapable of succeeding. The step was permanently
 * blocked while the UI insisted a resolution existed.
 *
 * `press` is deliberately absent. It acts through `keyboard.press` against whatever holds focus
 * rather than through the step's locator, so there is no target to prove actionable and a trial
 * would be theatre.
 */
export const PREREQUISITE_TRIAL_MODES: Readonly<Record<string, "pointer" | "predicate">> = Object.freeze({
  click: "pointer",
  dblclick: "pointer",
  contextMenu: "pointer",
  hover: "pointer",
  check: "pointer",
  uncheck: "pointer",
  radio: "pointer",
  fill: "predicate",
  select: "predicate"
});

/** The trial mode for a step, or undefined when its prerequisite cannot be proven without acting. */
export function interactionTrialMode(step: DecisionStep): "pointer" | "predicate" | undefined {
  return PREREQUISITE_TRIAL_MODES[step.type];
}

export function supportsAutomaticPrerequisiteTrial(step: DecisionStep): boolean {
  return interactionTrialMode(step) !== undefined && !isSensitiveInteractionStep(step);
}

export function hasExplicitInteractionDecisionReason(locator: StepLocator | undefined): boolean {
  return (locator?.executionDecision?.reason?.trim().length ?? 0) >= 8;
}

export function isValidInteractionExecutionDecision(step: DecisionStep): boolean {
  const decision = step.locator?.executionDecision;
  if (step.locator?.prerequisite?.status !== "unknown") return true;
  if (!step.locator.identity || isSensitiveInteractionStep(step)) return false;
  if (decision?.status === "automatic") return supportsAutomaticPrerequisiteTrial(step);
  return (
    decision?.status === "user-confirmed" &&
    supportsAutomaticPrerequisiteTrial(step) &&
    hasExplicitInteractionDecisionReason(step.locator) &&
    interactionDecisionBindingMatches(step)
  );
}

/** Recognize the pre-contract shape where prerequisite uncertainty alone polluted locator review. */
export function isPrerequisiteOnlyLocatorReview(locator: StepLocator | undefined): boolean {
  if (
    !locator?.identity ||
    locator.prerequisite?.status !== "unknown" ||
    locator.resolution !== "needs-review" ||
    locator.quality?.isUnique !== true ||
    locator.interaction?.hoverUnresolved !== true
  ) return false;
  const reasons = [locator.prerequisite.hover?.reason, locator.interaction.hoverReviewReason].filter(Boolean);
  return !locator.reviewReason || reasons.includes(locator.reviewReason);
}

/** Save-boundary invalidation for a confirmation whose material action/identity fields changed. */
export function invalidateStaleInteractionDecision(step: FlowStep): FlowStep {
  const decision = step.locator?.executionDecision;
  const automaticBecameUnsafe = decision?.status === "automatic" && !supportsAutomaticPrerequisiteTrial(step);
  const confirmationBecameStale = decision?.status === "user-confirmed" && !interactionDecisionBindingMatches(step);
  if (!automaticBecameUnsafe && !confirmationBecameStale) return step;
  return {
    ...step,
    locator: step.locator
      ? {
          ...step.locator,
          executionDecision: {
            schemaVersion: 1,
            status: "blocked",
            reason: automaticBecameUnsafe
              ? "action policy changed and no longer permits an automatic prerequisite trial"
              : "action or element identity changed after prerequisite confirmation"
          }
        }
      : step.locator
  };
}

export function automaticInteractionDecision(reason?: string): InteractionExecutionDecisionContract {
  return { schemaVersion: 1, status: "automatic", reason };
}
