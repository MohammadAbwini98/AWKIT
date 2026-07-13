/**
 * Capacity mode contracts + the pure mode→limits resolver (Concurrency Capacity plan — Phase A4).
 *
 * `resolveEffectiveConcurrency` maps the user's capacity MODE (sequential / auto / manual) plus the
 * machine recommendation into the concrete host caps the ExecutionEngine consumes. It is pure and
 * hardware-agnostic: no machine value is hardcoded, everything flows in from detection/settings. The
 * `CapacityPreview` shape is what the Settings UI receives from `system:capacityPreview`.
 */
import type { CapacityRecommendation, WorkloadClass } from "./CapacityPlanner";
import type { MachineCapabilities } from "./MachineCapabilityDetector";
import type { MachineCapacityProfile } from "./MachineCapacityProfileStore";

export type CapacityMode = "sequential" | "auto" | "manual";

/**
 * Pre-benchmark ceiling applied to Auto ONLY on machines flagged `requiresBenchmark` that have not yet
 * been benchmarked — so a large server does not auto-adopt high concurrency before it has been measured
 * on the real host (owner decision D1: conservative Auto-start). Configurable seed, not a machine target.
 */
export const DEFAULT_UNBENCHMARKED_AUTO_CEILING = 8;

export interface EffectiveConcurrencyInput {
  mode: CapacityMode;
  /** Manual mode explicit host caps (also the fallback source for the manual path). */
  manualBrowsers: number;
  manualActiveFlows: number;
  /** Required for auto: the machine's conservative recommendation. */
  recommendation?: CapacityRecommendation;
  /** Measured highest sustainable stage on this machine, when a benchmark has run. */
  benchmarkTestedCapacity?: number;
  administratorMaximumConcurrency?: number;
  absoluteSafetyMaximum: number;
  unbenchmarkedAutoCeiling?: number;
}

export interface EffectiveConcurrency {
  mode: CapacityMode;
  maxBrowsers: number;
  maxActiveFlows: number;
  /** The single concurrency target the mode resolves to (== maxActiveFlows). */
  target: number;
  /** The hard ceiling applied (min of absolute safety max and any administrator max). */
  ceiling: number;
}

/**
 * Resolve the mode into concrete host caps. Always returns valid caps in [1, ceiling]. The absolute
 * safety ceiling and administrator maximum are enforced for EVERY mode, including Manual (Manual may
 * choose a value but can never exceed the safety ceiling — see plan §8).
 */
export function resolveEffectiveConcurrency(input: EffectiveConcurrencyInput): EffectiveConcurrency {
  const adminMax = input.administratorMaximumConcurrency;
  const absolute = input.absoluteSafetyMaximum >= 1 ? input.absoluteSafetyMaximum : 1;
  const ceiling = Math.max(1, Math.min(absolute, adminMax !== undefined && adminMax >= 1 ? adminMax : absolute));
  const clamp = (n: number): number => Math.max(1, Math.min(Math.floor(Number.isFinite(n) ? n : 1), ceiling));

  if (input.mode === "sequential") {
    // One active instance at a time on every machine. maxActiveFlows=1 + maxBrowsers=1 fully serialize
    // dispatch at the engine's admission layer regardless of the per-card concurrency request.
    return { mode: "sequential", maxBrowsers: 1, maxActiveFlows: 1, target: 1, ceiling };
  }

  if (input.mode === "manual") {
    const flows = clamp(input.manualActiveFlows);
    const browsers = clamp(input.manualBrowsers);
    return { mode: "manual", maxBrowsers: browsers, maxActiveFlows: flows, target: flows, ceiling };
  }

  // auto
  const rec = input.recommendation;
  let base = input.benchmarkTestedCapacity ?? rec?.conservativeRecommendedCapacity ?? 1;
  if (rec?.requiresBenchmark && input.benchmarkTestedCapacity === undefined) {
    base = Math.min(base, input.unbenchmarkedAutoCeiling ?? DEFAULT_UNBENCHMARKED_AUTO_CEILING);
  }
  const target = clamp(base);
  return { mode: "auto", maxBrowsers: target, maxActiveFlows: target, target, ceiling };
}

/** What the Settings UI receives to explain the current machine's capacity. */
export interface CapacityPreview {
  capabilities: MachineCapabilities;
  recommendation: CapacityRecommendation;
  profile: MachineCapacityProfile;
  mode: CapacityMode;
  workloadClass: WorkloadClass;
  /** Concurrency Auto would apply right now (after ceilings + pre-benchmark clamp). */
  autoTarget: number;
  /** Concurrency the CURRENT mode applies right now. */
  effectiveTarget: number;
  requiresRecalibration: boolean;
}
