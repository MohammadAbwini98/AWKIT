/**
 * Capacity planner (Concurrency Capacity plan — Phase A2).
 *
 * Turns a detected machine snapshot + live pressure + tuning + workload class into a CONSERVATIVE
 * pre-benchmark capacity recommendation, with an explained breakdown. Fully hardware-agnostic: every
 * numeric input is a detected value, a configurable tuning seed, or a measured override — no CPU/RAM
 * count, browser count, or concurrency number is hardcoded as a target or default here.
 *
 * Pure `src/` core (no Electron/React, no I/O). See docs/ai/CONCURRENCY_CAPACITY_AND_REPORTS_PLAN.md §2.
 */
import type { MachineCapabilities } from "./MachineCapabilityDetector";

export type WorkloadClass = "light" | "medium" | "heavy" | "custom";

/** A machine matches a rule when EVERY specified bound holds; first match wins (catch-all last). */
export interface BootstrapCategoryRule {
  name: string;
  minLogicalCpu?: number;
  maxLogicalCpu?: number;
  minAvailableMemoryMb?: number;
  maxAvailableMemoryMb?: number;
  /** Fraction of the physical estimate to start from before the safety factor is applied. */
  startingCapacityFactor: number;
  /** High-capacity machines must be benchmarked before adopting high concurrency. */
  requiresBenchmarkBeforeHighConcurrency?: boolean;
}

export interface PerWorkloadEnvelope {
  light: number;
  medium: number;
  heavy: number;
}

/** One config object holding every seed/bound — no scattered machine-specific constants. */
export interface CapacityTuning {
  // Reserves — support BOTH absolute (Mb) and percentage (of total RAM); precedence in resolveReserveMb.
  reservedMemoryMb?: number;
  reservedMemoryPercent?: number;
  awkitReservedMemoryMb?: number;
  awkitReservedMemoryPercent?: number;
  safetyReservedMemoryMb?: number;
  safetyReservedMemoryPercent?: number;
  reservedLogicalCpuCount: number;

  // Conservative seed envelopes, replaced by measured values once a benchmark/history exists.
  conservativeMemoryPerInstanceMb: PerWorkloadEnvelope;
  conservativeCpuCoresPerInstance: PerWorkloadEnvelope;

  // Safety
  capacitySafetyFactor: number;
  productionApprovalMargin: number;
  absoluteSafetyMaximum: number;
  administratorMaximumConcurrency?: number;

  // Live-pressure thresholds (shared with backpressure / adaptive controller).
  minimumFreeMemoryMb?: number;
  minimumFreeMemoryPercent?: number;
  maximumSystemMemoryPercent: number;
  maximumAverageCpuPercent: number;
  maximumP95CpuPercent: number;

  // Bootstrap category boundaries (config, not scattered ifs).
  bootstrapCategories: BootstrapCategoryRule[];
}

/**
 * Default tuning. These are configurable SEEDS, not machine targets. Percentage reserves scale with any
 * machine; the AWKIT/Electron baseline is an absolute (its footprint does not grow with host RAM). The
 * per-instance envelopes are conservative starting bands, superseded by measurement (Phase A10).
 */
export const DEFAULT_CAPACITY_TUNING: CapacityTuning = {
  reservedMemoryPercent: 20, // operating system
  awkitReservedMemoryMb: 1024, // AWKIT/Electron/Node baseline (roughly fixed regardless of machine)
  safetyReservedMemoryPercent: 10, // configurable safety headroom
  reservedLogicalCpuCount: 1,

  conservativeMemoryPerInstanceMb: { light: 350, medium: 700, heavy: 1100 },
  conservativeCpuCoresPerInstance: { light: 0.3, medium: 0.5, heavy: 0.8 },

  capacitySafetyFactor: 0.75,
  productionApprovalMargin: 0.75,
  absoluteSafetyMaximum: 64,
  administratorMaximumConcurrency: undefined,

  minimumFreeMemoryPercent: 10,
  maximumSystemMemoryPercent: 85,
  maximumAverageCpuPercent: 75,
  maximumP95CpuPercent: 85,

  bootstrapCategories: [
    { name: "small", maxLogicalCpu: 2, startingCapacityFactor: 0.5 },
    { name: "small", maxAvailableMemoryMb: 4096, startingCapacityFactor: 0.5 },
    { name: "medium", maxLogicalCpu: 8, startingCapacityFactor: 0.75 },
    { name: "medium", maxAvailableMemoryMb: 16384, startingCapacityFactor: 0.75 },
    { name: "large", maxLogicalCpu: 16, startingCapacityFactor: 0.9 },
    { name: "large", maxAvailableMemoryMb: 49152, startingCapacityFactor: 0.9 },
    // Catch-all: server-grade resources start no more aggressively than "large" AND require benchmarking.
    { name: "highCapacity", startingCapacityFactor: 1.0, requiresBenchmarkBeforeHighConcurrency: true }
  ]
};

export type BindingConstraint = "ram" | "cpu" | "adminMax" | "safetyCeiling";

export interface CapacityPlannerInputs {
  capabilities: MachineCapabilities;
  workloadClass: WorkloadClass;
  tuning?: CapacityTuning;
  /** Live available memory (Mb) — overrides the snapshot's value when a fresh sample exists. */
  liveAvailableMemoryMb?: number;
  /** 0..1 fraction of the whole machine's CPU currently consumed by OTHER work (background load). */
  backgroundCpuLoadFraction?: number;
  /** Measured per-instance cost from this machine's history/benchmark; overrides the seed envelopes. */
  measuredMemoryPerInstanceMb?: number;
  measuredCpuCoresPerInstance?: number;
}

export interface CapacityRecommendation {
  /** Theoretical upper estimate from the physical min(ram, cpu), before safety/admin/ceiling clamps. */
  detectedCapacity: number;
  /** Safe initial recommendation before any benchmark: physical min × category factor × safety factor, clamped. */
  conservativeRecommendedCapacity: number;
  memoryCapacityEstimate: number;
  cpuCapacityEstimate: number;
  usableMemoryMb: number;
  usableCores: number;
  bindingConstraint: BindingConstraint;
  categoryName: string;
  requiresBenchmark: boolean;
  workloadClass: WorkloadClass;
}

/**
 * Resolve a memory reserve from an absolute and/or percentage setting. When both are configured the
 * MORE PROTECTIVE (larger) reserve wins — reserves are floors, so we err toward safety.
 */
export function resolveReserveMb(
  absolute: number | undefined,
  percent: number | undefined,
  totalMb: number
): number {
  const fromAbs = typeof absolute === "number" && absolute >= 0 ? absolute : undefined;
  const fromPct = typeof percent === "number" && percent >= 0 ? (totalMb * percent) / 100 : undefined;
  if (fromAbs === undefined && fromPct === undefined) return 0;
  if (fromAbs === undefined) return fromPct as number;
  if (fromPct === undefined) return fromAbs;
  return Math.max(fromAbs, fromPct);
}

/** First bootstrap category whose specified bounds all hold. Catch-all rule (no bounds) always matches. */
export function classifyBootstrapCategory(
  logicalCpuCount: number,
  availableMemoryMb: number,
  rules: BootstrapCategoryRule[]
): BootstrapCategoryRule {
  for (const rule of rules) {
    if (rule.minLogicalCpu !== undefined && logicalCpuCount < rule.minLogicalCpu) continue;
    if (rule.maxLogicalCpu !== undefined && logicalCpuCount > rule.maxLogicalCpu) continue;
    if (rule.minAvailableMemoryMb !== undefined && availableMemoryMb < rule.minAvailableMemoryMb) continue;
    if (rule.maxAvailableMemoryMb !== undefined && availableMemoryMb > rule.maxAvailableMemoryMb) continue;
    return rule;
  }
  // Guaranteed fallback so the function is total even if a caller supplies rules without a catch-all.
  return { name: "custom", startingCapacityFactor: 0.5, requiresBenchmarkBeforeHighConcurrency: true };
}

function seedKey(workloadClass: WorkloadClass): keyof PerWorkloadEnvelope {
  // "custom" is treated as the most conservative (heavy) seed until measurement overrides it.
  return workloadClass === "custom" ? "heavy" : workloadClass;
}

/**
 * Compute the conservative pre-benchmark recommendation for one workload class. See plan §2.3 for the
 * formula. Always returns >= 1 (a valid machine can run at least one instance). Never throws.
 */
export function planCapacity(inputs: CapacityPlannerInputs): CapacityRecommendation {
  const tuning = inputs.tuning ?? DEFAULT_CAPACITY_TUNING;
  const caps = inputs.capabilities;
  const key = seedKey(inputs.workloadClass);

  const totalMb = Math.max(0, caps.totalMemoryMb || 0);
  const availableMb = Math.max(0, inputs.liveAvailableMemoryMb ?? caps.availableMemoryMb ?? 0);

  const osReserve = resolveReserveMb(tuning.reservedMemoryMb, tuning.reservedMemoryPercent, totalMb);
  const awkitReserve = resolveReserveMb(tuning.awkitReservedMemoryMb, tuning.awkitReservedMemoryPercent, totalMb);
  const safetyReserve = resolveReserveMb(tuning.safetyReservedMemoryMb, tuning.safetyReservedMemoryPercent, totalMb);
  const usableMemoryMb = Math.max(0, availableMb - osReserve - awkitReserve - safetyReserve);

  const memPerInstance = inputs.measuredMemoryPerInstanceMb ?? tuning.conservativeMemoryPerInstanceMb[key];
  const memoryCapacityEstimate = memPerInstance > 0 ? Math.floor(usableMemoryMb / memPerInstance) : 0;

  const logical = Math.max(1, caps.logicalCpuCount || 1);
  const reservedCores = Math.max(0, tuning.reservedLogicalCpuCount ?? 0);
  const backgroundFraction = clamp01(inputs.backgroundCpuLoadFraction ?? 0);
  const backgroundCores = backgroundFraction * logical;
  const usableCores = Math.max(0, logical - reservedCores - backgroundCores);
  const cpuPerInstance = inputs.measuredCpuCoresPerInstance ?? tuning.conservativeCpuCoresPerInstance[key];
  const cpuCapacityEstimate = cpuPerInstance > 0 ? Math.floor(usableCores / cpuPerInstance) : 0;

  const physicalMin = Math.min(memoryCapacityEstimate, cpuCapacityEstimate);
  const detectedCapacity = Math.max(1, physicalMin);

  const category = classifyBootstrapCategory(logical, availableMb, tuning.bootstrapCategories);
  const factored = Math.floor(detectedCapacity * category.startingCapacityFactor * tuning.capacitySafetyFactor);

  // Determine the binding constraint as we clamp down from the physical estimate.
  let value = Math.max(1, factored);
  let binding: BindingConstraint = memoryCapacityEstimate <= cpuCapacityEstimate ? "ram" : "cpu";
  const adminMax = tuning.administratorMaximumConcurrency;
  if (adminMax !== undefined && adminMax >= 1 && adminMax < value) {
    value = adminMax;
    binding = "adminMax";
  }
  if (tuning.absoluteSafetyMaximum >= 1 && tuning.absoluteSafetyMaximum < value) {
    value = tuning.absoluteSafetyMaximum;
    binding = "safetyCeiling";
  }
  value = Math.max(1, value);

  return {
    detectedCapacity,
    conservativeRecommendedCapacity: value,
    memoryCapacityEstimate,
    cpuCapacityEstimate,
    usableMemoryMb: Math.round(usableMemoryMb),
    usableCores: Math.round(usableCores * 100) / 100,
    bindingConstraint: binding,
    categoryName: category.name,
    requiresBenchmark: category.requiresBenchmarkBeforeHighConcurrency === true,
    workloadClass: inputs.workloadClass
  };
}

/** Recommend across all standard workload classes at once (Phase A8 consumes this). */
export function planWorkloadCapacities(
  inputs: Omit<CapacityPlannerInputs, "workloadClass">
): Record<Exclude<WorkloadClass, "custom">, CapacityRecommendation> {
  return {
    light: planCapacity({ ...inputs, workloadClass: "light" }),
    medium: planCapacity({ ...inputs, workloadClass: "medium" }),
    heavy: planCapacity({ ...inputs, workloadClass: "heavy" })
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
