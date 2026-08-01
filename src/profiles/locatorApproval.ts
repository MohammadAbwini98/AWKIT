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

export function locatorApprovalBindingMatches(
  step: Pick<FlowStep, "type" | "name" | "safety" | "locator">
): boolean {
  const binding = step.locator?.approvedFallbackBinding;
  const current = comparableBinding(step);
  return binding !== undefined && current !== undefined && canonical(binding) === canonical(current);
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

/** Save-boundary guard for every editor/import projection that can materially retarget a locator. */
export function invalidateStaleLocatorApproval(step: FlowStep): FlowStep {
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
