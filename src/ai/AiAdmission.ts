/**
 * Local-AI admission (Phase L, L1.6): may ONE inference start now? Pure.
 *
 * Inference is admitted against the same weighted budget as browser instances (`WorkloadWeights`),
 * with no second scheduler, and it only ever yields: it never delays, preempts or blocks Playwright
 * work, and the engine never counts it against instance admission. By default it does not run while
 * any run is active or queued (`yieldDuringRuns`); with that off it still needs weighted headroom.
 * A dispatch refusal, host pressure or low free memory keeps it queued either way.
 */

import { canAdmitWeighted, DEFAULT_WORKLOAD_WEIGHT_CONFIG } from "../runner/concurrency/WorkloadWeights";

export interface AiAdmissionView {
  activeRuns: number;
  queuedRuns: number;
  /** `AdaptiveController` state, normalized; anything but healthy/stable holds inference. */
  pressureState: string;
  /** Backpressure is currently refusing instance dispatch. */
  dispatchBlocked: boolean;
  activeWeight: number;
  weightedBudget: number;
  freeMemoryMb: number;
}

export interface AiAdmissionOptions {
  yieldDuringRuns: boolean;
  minFreeMemoryMb: number;
  inferenceWeight?: number;
}

export type AiAdmissionHoldReason = "RUNS_ACTIVE" | "DISPATCH_BLOCKED" | "HOST_PRESSURE" | "LOW_MEMORY" | "WEIGHTED_BUDGET";
export type AiAdmissionDecision = { admit: true } | { admit: false; reason: AiAdmissionHoldReason };

export function decideAiAdmission(view: AiAdmissionView, options: AiAdmissionOptions): AiAdmissionDecision {
  if (options.yieldDuringRuns && (view.activeRuns > 0 || view.queuedRuns > 0)) return { admit: false, reason: "RUNS_ACTIVE" };
  if (view.dispatchBlocked) return { admit: false, reason: "DISPATCH_BLOCKED" };
  if (view.pressureState !== "healthy" && view.pressureState !== "stable") return { admit: false, reason: "HOST_PRESSURE" };
  if (!(view.freeMemoryMb >= options.minFreeMemoryMb)) return { admit: false, reason: "LOW_MEMORY" };
  const weight = options.inferenceWeight ?? DEFAULT_WORKLOAD_WEIGHT_CONFIG.aiInferenceWeight;
  if (!canAdmitWeighted(view.activeWeight, weight, view.weightedBudget)) return { admit: false, reason: "WEIGHTED_BUDGET" };
  return { admit: true };
}

/**
 * Inference threads from the detected host, never a hardcoded count: half the logical CPUs, at least
 * one, at most four (3 on the ~6-vCPU target envelope), leaving the rest to Playwright and the app.
 */
export function deriveInferenceThreads(logicalCpuCount: number): number {
  const cpus = Number.isFinite(logicalCpuCount) ? Math.floor(logicalCpuCount) : 1;
  return Math.min(4, Math.max(1, Math.floor(cpus / 2)));
}
