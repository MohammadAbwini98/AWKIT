/**
 * Main-process capacity service (Concurrency Capacity plan — Phase A4).
 *
 * Bridges the pure `src/` capacity core to the running app: detects the current host, plans a
 * conservative recommendation, reconciles the per-machine profile, and resolves the user's capacity
 * MODE into concrete host caps for the ExecutionEngine. Also powers the Settings `system:capacityPreview`
 * readout. The `src/` core never reads app settings — the main process passes them in here.
 */
import os from "node:os";
import { getRuntimePaths } from "./appPaths";
import { getUiSettings, type UiSettings } from "./uiSettings";
import { MachineCapabilityDetector } from "@src/runner/concurrency/MachineCapabilityDetector";
import {
  DEFAULT_CAPACITY_TUNING,
  planCapacity,
  type CapacityRecommendation,
  type CapacityTuning,
  type WorkloadClass
} from "@src/runner/concurrency/CapacityPlanner";
import {
  MachineCapacityProfileStore,
  reconcileMachineProfile,
  type MachineCapacityProfile
} from "@src/runner/concurrency/MachineCapacityProfileStore";
import {
  DEFAULT_UNBENCHMARKED_AUTO_CEILING,
  resolveEffectiveConcurrency,
  type CapacityPreview,
  type EffectiveConcurrency
} from "@src/runner/concurrency/CapacityContracts";
import type { MachineRunContext } from "@src/reports/TelemetryContracts";

type RuntimeSettings = UiSettings["runtime"];

/** Build a CapacityTuning that overlays the user's configured knobs on the seed defaults. */
function tuningFromRuntime(runtime: RuntimeSettings): CapacityTuning {
  return {
    ...DEFAULT_CAPACITY_TUNING,
    capacitySafetyFactor: runtime.capacitySafetyFactor,
    reservedLogicalCpuCount: runtime.reservedLogicalCpuCount,
    absoluteSafetyMaximum: runtime.absoluteSafetyMaximum,
    administratorMaximumConcurrency: runtime.administratorMaximumConcurrency ?? undefined
  };
}

interface DetectAndPlan {
  capabilities: Awaited<ReturnType<MachineCapabilityDetector["detect"]>>;
  recommendation: CapacityRecommendation;
  profile: MachineCapacityProfile;
}

/**
 * Detect the host, plan a recommendation for the given workload class, and reconcile the per-machine
 * profile. `persist` controls whether the reconciled profile is written (true for real application,
 * false for read-only previews so a preview keystroke never mutates disk).
 */
async function detectAndPlan(runtime: RuntimeSettings, workloadClass: WorkloadClass, persist: boolean): Promise<DetectAndPlan> {
  const root = getRuntimePaths().root;
  const capabilities = await new MachineCapabilityDetector(root).detect();
  // Use the freshest available memory reading (freemem drifts after the id/profile I/O above).
  const liveAvailableMemoryMb = Math.round(os.freemem() / (1024 * 1024));
  const tuning = tuningFromRuntime(runtime);
  const recommendation = planCapacity({ capabilities, workloadClass, tuning, liveAvailableMemoryMb });

  const store = new MachineCapacityProfileStore(root);
  const existing = await store.load(capabilities.machineId);
  const { profile } = reconcileMachineProfile({ existing, capabilities, recommendation, tuning });
  if (persist) await store.save(profile).catch(() => undefined);

  return { capabilities, recommendation, profile };
}

function autoInput(runtime: RuntimeSettings, recommendation: CapacityRecommendation, profile: MachineCapacityProfile) {
  return {
    mode: "auto" as const,
    manualBrowsers: runtime.maxBrowsers,
    manualActiveFlows: runtime.maxActiveFlows,
    recommendation,
    benchmarkTestedCapacity: profile.benchmarkTestedCapacity,
    administratorMaximumConcurrency: runtime.administratorMaximumConcurrency ?? undefined,
    absoluteSafetyMaximum: runtime.absoluteSafetyMaximum,
    unbenchmarkedAutoCeiling: DEFAULT_UNBENCHMARKED_AUTO_CEILING
  };
}

/**
 * Resolve the current settings into the concrete host caps to push into the engine. Auto mode detects
 * the host and persists the refreshed machine profile; sequential/manual need no host detection.
 */
export async function computeEffectiveConcurrency(runtime: RuntimeSettings): Promise<EffectiveConcurrency> {
  if (runtime.capacityMode === "auto") {
    const { recommendation, profile } = await detectAndPlan(runtime, runtime.workloadClass, true);
    return resolveEffectiveConcurrency(autoInput(runtime, recommendation, profile));
  }
  return resolveEffectiveConcurrency({
    mode: runtime.capacityMode,
    manualBrowsers: runtime.maxBrowsers,
    manualActiveFlows: runtime.maxActiveFlows,
    administratorMaximumConcurrency: runtime.administratorMaximumConcurrency ?? undefined,
    absoluteSafetyMaximum: runtime.absoluteSafetyMaximum
  });
}

/**
 * Build the per-run machine context stamped onto durable run rows (Phase B1) so reports can filter and
 * compare BY machine. Detection is best-effort (read-only, no profile persistence): a failure yields just
 * the settings-derived fields so a run is still labelled with its mode/class. `availableMemoryMbAtStart`
 * uses the freshest reading; `capacityRecommendationAtRun` prefers this machine's benchmarked capacity.
 */
export async function buildMachineRunContext(runtime: RuntimeSettings, effective: EffectiveConcurrency): Promise<MachineRunContext> {
  const base: MachineRunContext = {
    executionMode: runtime.capacityMode,
    workloadClass: runtime.workloadClass,
    configuredConcurrency: effective.target,
    availableMemoryMbAtStart: Math.round(os.freemem() / (1024 * 1024))
  };
  try {
    const { capabilities, recommendation, profile } = await detectAndPlan(runtime, runtime.workloadClass, false);
    return {
      ...base,
      machineId: capabilities.machineId,
      logicalCpuCount: capabilities.logicalCpuCount,
      totalMemoryMb: capabilities.totalMemoryMb,
      capacityRecommendationAtRun: profile.benchmarkTestedCapacity ?? recommendation.conservativeRecommendedCapacity
    };
  } catch {
    return base;
  }
}

/**
 * Read-only preview for the Settings UI. Always computes the Auto recommendation (so the UI can show
 * "what Auto would pick" and warn when a Manual value exceeds it) plus what the CURRENT mode applies.
 * Does NOT persist the profile.
 */
export async function previewCapacity(workloadClassOverride?: WorkloadClass): Promise<CapacityPreview> {
  const { runtime } = await getUiSettings();
  const workloadClass = workloadClassOverride ?? runtime.workloadClass;
  const { capabilities, recommendation, profile } = await detectAndPlan(runtime, workloadClass, false);

  const auto = resolveEffectiveConcurrency(autoInput(runtime, recommendation, profile));
  const effective =
    runtime.capacityMode === "auto"
      ? auto
      : resolveEffectiveConcurrency({
          mode: runtime.capacityMode,
          manualBrowsers: runtime.maxBrowsers,
          manualActiveFlows: runtime.maxActiveFlows,
          administratorMaximumConcurrency: runtime.administratorMaximumConcurrency ?? undefined,
          absoluteSafetyMaximum: runtime.absoluteSafetyMaximum
        });

  return {
    capabilities,
    recommendation,
    profile,
    mode: runtime.capacityMode,
    workloadClass,
    autoTarget: auto.target,
    effectiveTarget: effective.target,
    requiresRecalibration: profile.requiresRecalibration
  };
}
