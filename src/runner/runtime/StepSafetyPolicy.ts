/**
 * Explicit side-effect safety metadata for steps. `FlowStep.safety` (optional, saved with the
 * flow) is authoritative; when absent, node-TYPE defaults classify the step (covers recorder
 * output and legacy flows without editing them), and the keyword heuristic remains only as a
 * conservative fallback for mutating types.
 */
import type { SideEffectLevel, StepSafetyPolicy } from "@src/profiles/FlowProfile";
import { isDangerousMutationStep } from "./ErrorClassifier";

export type { SideEffectLevel, StepSafetyPolicy };

export interface ResolvedStepSafety extends StepSafetyPolicy {
  /** Where the classification came from — surfaced in retry logs and attempts. */
  source: "explicit" | "typeDefault" | "keywordFallback" | "conservativeDefault";
}

/** Step types with no page/server mutation (safe to retry on transient failures). */
const READ_TYPES = new Set([
  "start",
  "end",
  "goto",
  "wait",
  "assertion",
  "assertText",
  "screenshot",
  "scroll",
  "extract",
  "extractText",
  "condition",
  "routeChange",
  "switchToPopup",
  "switchToMainPage",
  "closePopup",
  "download"
]);

/** Local session/handoff operations: no remote business side effect; idempotent locally. */
const LOCAL_SESSION_TYPES = new Set(["saveSession", "reuseSession", "autoSecureLogin", "protectedLoginHandoff", "manualAction"]);

/** UI-mutating types: safe to retry unless the keyword fallback flags a business commit. */
const UI_MUTATION_TYPES = new Set(["click", "fill", "check", "uncheck", "radio", "select", "upload", "keyboard", "press", "hover"]);

/** Container/composite types: re-running the whole body automatically is not safe. */
const CONTAINER_TYPES = new Set(["loop", "runFlow"]);

export function resolveStepSafety(step: { type: string; name?: string; value?: string; safety?: StepSafetyPolicy }): ResolvedStepSafety {
  if (step.safety) {
    return { ...step.safety, source: "explicit" };
  }
  if (READ_TYPES.has(step.type)) {
    return { sideEffectLevel: "read", retryable: true, source: "typeDefault" };
  }
  if (LOCAL_SESSION_TYPES.has(step.type)) {
    return { sideEffectLevel: "none", retryable: true, source: "typeDefault" };
  }
  if (UI_MUTATION_TYPES.has(step.type)) {
    if (isDangerousMutationStep(step)) {
      return { sideEffectLevel: "dangerousMutation", retryable: false, source: "keywordFallback" };
    }
    return { sideEffectLevel: "safeMutation", retryable: true, source: "typeDefault" };
  }
  if (CONTAINER_TYPES.has(step.type)) {
    return { sideEffectLevel: "unknown", retryable: false, source: "typeDefault" };
  }
  // Unknown custom node type: conservative — never auto-retry what we can't classify.
  return { sideEffectLevel: "unknown", retryable: false, source: "conservativeDefault" };
}
