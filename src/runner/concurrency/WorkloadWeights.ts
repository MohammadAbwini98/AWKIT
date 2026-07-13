/**
 * Workload-aware capacity + scheduler weights (Concurrency Capacity plan — Phase A8).
 *
 * Two related ideas live here, both pure and framework-agnostic:
 *
 *  1. **Workload classification** — turn an instance's config + its flows' features into a
 *     `light | medium | heavy` class. When the signal is ambiguous we round UP to the safer (heavier)
 *     class, never down (plan §A8: "misclassification → default to the safer class").
 *
 *  2. **Scheduler weights** — a relative admission COST for one instance. A simple ephemeral context is
 *     the base unit (1.0); persistent profiles, headed runs, extra pages/navigations, parallel isolated
 *     branches, downloads, screenshots, popups, nested flows, and trace/video each add cost. The engine
 *     admits new dispatch against a weighted budget (maxActiveFlows × budgetPerFlow) rather than a raw
 *     flow count, so two heavy instances can weigh as much as several light ones.
 *
 * Weight is an ADMISSION concept only — deliberately separate from the physical browser/context budget
 * (Phase A5) so the two never double-count. Every number below is a configurable seed, not a machine
 * target, and is superseded by measurement (Phase A10) exactly like the capacity seeds.
 *
 * Pure `src/` core (no Electron/React, no I/O). See docs/ai/CONCURRENCY_CAPACITY_AND_REPORTS_PLAN.md §A8.
 */
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import type { FlowProfile, FlowStep } from "@src/profiles/FlowProfile";
import type { WorkloadClass } from "./CapacityPlanner";

/** Node types whose runtime behaviour closes/relaunches (swaps) the automation browser mid-run. */
const BROWSER_SWAP_NODE_TYPES = new Set(["autoSecureLogin", "reuseSession", "protectedLoginHandoff"]);
/** Step types that count as a network navigation (page load) for classification. */
const NAVIGATION_STEP_TYPES = new Set(["goto", "routeChange"]);

/**
 * Structural + config signals that make one instance heavier than a plain isolated context. Extracted
 * once from the (static) config + flows — none of these change during a run.
 */
export interface WorkloadFeatures {
  /** Headed (visible) runs cost more than headless. */
  headed: boolean;
  /** Persistent user-data profile / captured session — its own dedicated browser, larger footprint. */
  persistentProfile: boolean;
  /** Flow swaps the automation browser mid-run (Reuse Session / Auto Secure Login / protected handoff). */
  browserSwap: boolean;
  /** Count of navigation steps (goto / routeChange) across all flows. */
  navigationCount: number;
  /** Count of download steps (downloadFile). */
  downloadCount: number;
  /** Count of upload steps (uploadFile). */
  uploadCount: number;
  /** Count of screenshot steps. */
  screenshotCount: number;
  /** Any full-page screenshot (heavier than a viewport capture). */
  fullPageScreenshot: boolean;
  /** Uses popups / extra pages (switchToPopup) — more concurrent pages per context. */
  popupUsage: boolean;
  /** Has isolated parallel branches (parallel connectors) — concurrent nodes within one flow. */
  parallelBranches: boolean;
  /** Invokes nested flows (runFlow). */
  nestedFlows: boolean;
  /** Contains loop nodes (repeated work). */
  loops: boolean;
  /** Total node count across all flows (large flows run longer / hold resources longer). */
  nodeCount: number;
  /** Trace or video capture is on for this run (from the artifact profile / env — passed in). */
  traceOrVideo: boolean;
}

/** Every weight seed in one object — no scattered magic numbers (mirrors DEFAULT_CAPACITY_TUNING). */
export interface WorkloadWeightConfig {
  /** Base cost of one simple ephemeral-context instance. */
  baseWeight: number;
  headedSurcharge: number;
  persistentProfileSurcharge: number;
  browserSwapSurcharge: number;
  /** Navigations beyond `navigationFreeCount` add this each. */
  perNavigationWeight: number;
  navigationFreeCount: number;
  perDownloadWeight: number;
  perScreenshotWeight: number;
  fullPageScreenshotSurcharge: number;
  popupSurcharge: number;
  parallelBranchSurcharge: number;
  nestedFlowSurcharge: number;
  loopSurcharge: number;
  traceOrVideoSurcharge: number;
  /** Nodes beyond `nodeFreeCount` add this each (bounded by maxWeight). */
  perNodeWeight: number;
  nodeFreeCount: number;
  /** Absolute clamp so a pathological flow can never starve the whole host on its own. */
  maxWeight: number;
  /** Classification thresholds on the computed weight (inclusive upper bounds). */
  lightMaxWeight: number;
  mediumMaxWeight: number;
}

/**
 * Default weight seeds. Conservative, configurable, superseded by measurement. Chosen so a plain
 * headless isolated context = 1.0 (light), a headed persistent-profile flow with a few navigations lands
 * in "medium", and a persistent + browser-swap + trace flow lands in "heavy".
 */
export const DEFAULT_WORKLOAD_WEIGHT_CONFIG: WorkloadWeightConfig = {
  baseWeight: 1.0,
  headedSurcharge: 0.3,
  persistentProfileSurcharge: 0.6,
  browserSwapSurcharge: 0.5,
  perNavigationWeight: 0.05,
  navigationFreeCount: 4,
  perDownloadWeight: 0.25,
  perScreenshotWeight: 0.1,
  fullPageScreenshotSurcharge: 0.2,
  popupSurcharge: 0.3,
  parallelBranchSurcharge: 0.5,
  nestedFlowSurcharge: 0.3,
  loopSurcharge: 0.3,
  traceOrVideoSurcharge: 0.5,
  perNodeWeight: 0.02,
  nodeFreeCount: 20,
  maxWeight: 5.0,
  lightMaxWeight: 1.25,
  mediumMaxWeight: 2.5
};

/** Optional run-level signals not derivable from config/flows alone (e.g. artifact profile). */
export interface WorkloadFeatureContext {
  /** Whether trace/video is being captured this run (AWKIT_TRACE_MODE / artifact profile). */
  traceOrVideo?: boolean;
  /** Force headed even if config.headless says otherwise (e.g. a headed run-mode override). */
  headed?: boolean;
}

/**
 * Extract static workload features for one instance from its config + the run's flows. Never throws;
 * missing/hand-authored data degrades to the lightest signal (weight then rounds up on ambiguity).
 */
export function extractWorkloadFeatures(
  config: InstanceConfig,
  flows: FlowProfile[],
  context: WorkloadFeatureContext = {}
): WorkloadFeatures {
  const steps: FlowStep[] = [];
  for (const flow of flows ?? []) {
    for (const node of flow?.nodes ?? []) steps.push(node);
  }

  const countType = (type: string): number => steps.filter((s) => s.type === type).length;
  const navigationCount = steps.filter((s) => NAVIGATION_STEP_TYPES.has(s.type)).length;
  const screenshotSteps = steps.filter((s) => s.type === "screenshot");

  const persistentProfile =
    config.isolationMode === "persistentContext" ||
    Boolean(config.userDataDir) ||
    Boolean(config.sessionProfileId);

  const browserSwap = (flows ?? []).some((flow) =>
    (flow?.nodes ?? []).some((node) => BROWSER_SWAP_NODE_TYPES.has(node.type))
  );

  const parallelBranches = (flows ?? []).some((flow) =>
    (flow?.edges ?? []).some((edge) => edge.type === "parallel" || edge.kind === "parallel")
  );

  return {
    headed: context.headed ?? config.headless === false,
    persistentProfile,
    browserSwap,
    navigationCount,
    downloadCount: countType("downloadFile"),
    uploadCount: countType("uploadFile"),
    screenshotCount: screenshotSteps.length,
    fullPageScreenshot: screenshotSteps.some((s) => s.config?.fullPage === true),
    popupUsage: countType("switchToPopup") > 0,
    parallelBranches,
    nestedFlows: countType("runFlow") > 0,
    loops: countType("loop") > 0,
    nodeCount: steps.length,
    traceOrVideo: context.traceOrVideo === true
  };
}

/**
 * Compute the relative admission weight for one instance. Additive from `baseWeight`, clamped to
 * `[baseWeight, maxWeight]`. Deterministic and monotonic: adding any heavy feature never lowers the
 * weight.
 */
export function computeWorkloadWeight(
  features: WorkloadFeatures,
  config: WorkloadWeightConfig = DEFAULT_WORKLOAD_WEIGHT_CONFIG
): number {
  let weight = config.baseWeight;

  if (features.headed) weight += config.headedSurcharge;
  if (features.persistentProfile) weight += config.persistentProfileSurcharge;
  if (features.browserSwap) weight += config.browserSwapSurcharge;

  const extraNavigations = Math.max(0, features.navigationCount - config.navigationFreeCount);
  weight += extraNavigations * config.perNavigationWeight;

  weight += Math.max(0, features.downloadCount) * config.perDownloadWeight;
  weight += Math.max(0, features.screenshotCount) * config.perScreenshotWeight;
  if (features.fullPageScreenshot) weight += config.fullPageScreenshotSurcharge;
  if (features.popupUsage) weight += config.popupSurcharge;
  if (features.parallelBranches) weight += config.parallelBranchSurcharge;
  if (features.nestedFlows) weight += config.nestedFlowSurcharge;
  if (features.loops) weight += config.loopSurcharge;
  if (features.traceOrVideo) weight += config.traceOrVideoSurcharge;

  const extraNodes = Math.max(0, features.nodeCount - config.nodeFreeCount);
  weight += extraNodes * config.perNodeWeight;

  const clamped = Math.min(config.maxWeight, Math.max(config.baseWeight, weight));
  // Round to 3 decimals so summed active weight stays stable/comparable (no float drift in logs).
  return Math.round(clamped * 1000) / 1000;
}

/**
 * Classify an instance's workload from its computed weight. Thresholds are inclusive upper bounds;
 * anything above `mediumMaxWeight` is heavy. Ambiguity always rounds UP (never classify a costly flow
 * as lighter than it is).
 */
export function classifyWorkload(
  weight: number,
  config: WorkloadWeightConfig = DEFAULT_WORKLOAD_WEIGHT_CONFIG
): Exclude<WorkloadClass, "custom"> {
  if (weight <= config.lightMaxWeight) return "light";
  if (weight <= config.mediumMaxWeight) return "medium";
  return "heavy";
}

/** Convenience: features → class in one call. */
export function classifyWorkloadFeatures(
  features: WorkloadFeatures,
  config: WorkloadWeightConfig = DEFAULT_WORKLOAD_WEIGHT_CONFIG
): Exclude<WorkloadClass, "custom"> {
  return classifyWorkload(computeWorkloadWeight(features, config), config);
}

// ── Weighted admission ────────────────────────────────────────────────────────

/**
 * The weighted budget for a host: how much total instance weight may run at once. Derived from the flow
 * cap so it degrades to the existing count-based behaviour when every instance weighs `baseWeight`.
 */
export function weightedBudget(
  maxActiveFlows: number,
  budgetPerFlow: number,
  config: WorkloadWeightConfig = DEFAULT_WORKLOAD_WEIGHT_CONFIG
): number {
  const flows = Math.max(1, Math.floor(maxActiveFlows));
  const per = budgetPerFlow > 0 ? budgetPerFlow : config.baseWeight;
  return flows * per;
}

/**
 * Weighted admission predicate. Admits a candidate if the running weighted cost plus the candidate's
 * weight stays within budget. CRUCIAL: an idle host (no active weight) always admits the candidate even
 * if its weight alone exceeds the budget — otherwise a single heavy instance could deadlock the queue.
 */
export function canAdmitWeighted(activeWeight: number, candidateWeight: number, budget: number): boolean {
  if (activeWeight <= 0) return true; // never starve: at least one instance always runs
  const EPS = 1e-6;
  return activeWeight + candidateWeight <= budget + EPS;
}

// ── Per-workload capacity recommendations ──────────────────────────────────────

/**
 * Per-workload-class recommendation (plan §A8 contract). `recommendedConcurrency` is the conservative
 * pre-benchmark number for that class; `confidence` climbs as measurement arrives.
 */
export interface WorkloadCapacityRecommendation {
  machineId: string;
  workloadClass: WorkloadClass;
  recommendedConcurrency: number;
  benchmarkTestedConcurrency?: number;
  productionApprovedConcurrency?: number;
  confidence: "unmeasured" | "estimated" | "benchmarked";
}

/** Per-class conservative recommendation inputs (comes from planWorkloadCapacities). */
export interface WorkloadRecommendationInput {
  workloadClass: WorkloadClass;
  recommendedConcurrency: number;
  /** True once a live benchmark measured this class on this machine (Phase A10). */
  benchmarkTestedConcurrency?: number;
  productionApprovedConcurrency?: number;
  /** True when the recommendation used a measured per-instance cost rather than a raw seed. */
  measured?: boolean;
}

/**
 * Build the confidence-tagged recommendation for one class. Confidence transitions:
 *   unmeasured (raw seed) → estimated (measured per-instance cost, no benchmark) → benchmarked (A10).
 */
export function buildWorkloadRecommendation(
  machineId: string,
  input: WorkloadRecommendationInput
): WorkloadCapacityRecommendation {
  let confidence: WorkloadCapacityRecommendation["confidence"] = "unmeasured";
  if (input.benchmarkTestedConcurrency !== undefined) confidence = "benchmarked";
  else if (input.measured) confidence = "estimated";
  return {
    machineId,
    workloadClass: input.workloadClass,
    recommendedConcurrency: Math.max(1, Math.floor(input.recommendedConcurrency)),
    benchmarkTestedConcurrency: input.benchmarkTestedConcurrency,
    productionApprovedConcurrency: input.productionApprovedConcurrency,
    confidence
  };
}
