import type { FlowStep, LocatorApprovalBinding, LocatorCandidate, StepLocator } from "./FlowProfile";

export function isPositionalCandidate(candidate: LocatorCandidate | undefined): boolean {
  if (!candidate || (candidate.strategy !== "css" && candidate.strategy !== "xpath")) return false;
  return /(?:>>\s*nth\s*=|:nth-(?:child|of-type)\s*\(|\[[0-9]+\])/.test(candidate.value);
}

/**
 * A positional fallback is an explicit exception, never an ordinary resolved locator. Keep this
 * predicate shared by Recorder review, static validation, LocatorFactory diagnostics, and the
 * executor so the product cannot develop four subtly different approval policies.
 */
export function isPositionalLocator(locator: StepLocator | undefined): boolean {
  return (
    locator?.quality?.strategy === "fallback" ||
    locator?.quality?.disambiguation === "positional" ||
    isPositionalCandidate(locator)
  );
}

function comparableBinding(step: Pick<FlowStep, "type" | "name" | "safety" | "locator">): LocatorApprovalBinding | undefined {
  const locator = step.locator;
  if (!locator) return undefined;
  return {
    version: 1,
    stepType: step.type,
    stepName: step.name,
    locator: {
      strategy: locator.strategy,
      value: locator.value,
      name: locator.name,
      // Playwright's default is non-exact. The Flow Designer materializes an omitted value as
      // `false`, so normalize both representations or an unchanged save revokes valid approval.
      exact: locator.exact || undefined
    },
    context: locator.context,
    safety: step.safety
  };
}

/** Bind approval to every material target/action field without relying on a collision-prone hash. */
export function createLocatorApprovalBinding(
  step: Pick<FlowStep, "type" | "name" | "safety" | "locator">
): LocatorApprovalBinding | undefined {
  return comparableBinding(step);
}

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

/** True while `binding` still describes the step's current target/action fields. */
export function locatorBindingMatches(
  binding: LocatorApprovalBinding | undefined,
  step: Pick<FlowStep, "type" | "name" | "safety" | "locator">
): boolean {
  const current = comparableBinding(step);
  return binding !== undefined && current !== undefined && canonical(binding) === canonical(current);
}

export function locatorApprovalBindingMatches(
  step: Pick<FlowStep, "type" | "name" | "safety" | "locator">
): boolean {
  return locatorBindingMatches(step.locator?.approvedFallbackBinding, step);
}

export function hasExplicitFallbackReason(locator: StepLocator | undefined): boolean {
  return (locator?.approvedFallbackReason?.trim().length ?? 0) >= 8;
}

export function isValidLocatorFallbackApproval(
  step: Pick<FlowStep, "type" | "name" | "safety" | "locator">
): boolean {
  return (
    isPositionalLocator(step.locator) &&
    step.locator?.resolution === "user-approved-fallback" &&
    hasExplicitFallbackReason(step.locator) &&
    locatorApprovalBindingMatches(step)
  );
}

/**
 * A positional locator that carries a structurally-complete runtime identity guard
 * (guarded-positional). This is a STATIC presence check — the runtime identity PROOF (resolve the
 * container, recompute the target's fingerprint, and abort on any mismatch) is enforced by the
 * runner. It lets normal and sensitive positional captures run without an interactive approval
 * prompt while preserving the wrong-target safety property.
 */
export function hasPositionalIdentityGuard(step: Pick<FlowStep, "locator">): boolean {
  const guard = step.locator?.guard;
  return (
    isPositionalLocator(step.locator) &&
    guard !== undefined &&
    guard.fingerprint !== undefined &&
    typeof guard.index === "number" &&
    guard.index >= 0 &&
    typeof guard.siblingCount === "number"
  );
}

/**
 * Drop an AI `pendingUpgrade` or `locatorProvenance` whose binding no longer describes the step
 * (docs/ai/DECISIONS.md 2026-09-19): the editor spreads unknown locator keys through every save, so
 * without this a candidate proposed for an older target would survive an edit that retargeted it.
 */
export function invalidateStaleAiLocatorFields(step: FlowStep): FlowStep {
  const locator = step.locator;
  if (!locator) return step;
  const stalePending = locator.pendingUpgrade !== undefined && !locatorBindingMatches(locator.pendingUpgrade.binding, step);
  const staleProvenance = locator.locatorProvenance !== undefined && !locatorBindingMatches(locator.locatorProvenance.binding, step);
  if (!stalePending && !staleProvenance) return step;
  const next: StepLocator = { ...locator };
  if (stalePending) delete next.pendingUpgrade;
  if (staleProvenance) delete next.locatorProvenance;
  return { ...step, locator: next };
}

/** Save-boundary guard for every editor/import projection that can materially retarget a locator. */
export function invalidateStaleLocatorApproval(step: FlowStep): FlowStep {
  step = invalidateStaleAiLocatorFields(step);
  if (step.locator?.resolution !== "user-approved-fallback" || isValidLocatorFallbackApproval(step)) return step;
  const { approvedFallbackReason: _reason, approvedFallbackBinding: _binding, ...locator } = step.locator;
  return {
    ...step,
    locator: {
      ...locator,
      resolution: "needs-review",
      resolvedBy: "user",
      reviewReason: "locator or context changed after fallback approval"
    }
  };
}
