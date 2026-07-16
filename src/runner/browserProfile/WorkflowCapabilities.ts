/**
 * Workflow capability analysis (Browser Resource Optimization architecture — Phase 7).
 *
 * Reads a run's static config + flows and reports which browser features the workflow ACTUALLY needs,
 * so the resolver can prevent an aggressive resource profile from breaking the workflow. The golden rule
 * (Phase 7): capabilities only ever RELAX an optimization (re-enable a feature) — they never make a run
 * more aggressive. The optimization adapts to the workflow, never the other way around.
 *
 * Detection is static and conservative. When a signal is genuinely undetectable from flow JSON (WebGL,
 * animations), the capability defaults to the SAFE assumption for the chosen profile and can be forced on
 * by an explicit per-workflow hint (`CapabilityHints`). We reuse the already-audited feature extraction
 * from `WorkloadWeights` rather than re-deriving flow signals.
 *
 * Pure `src/` core (no Electron/React, no I/O).
 */
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { extractWorkloadFeatures } from "../concurrency/WorkloadWeights";

export interface WorkflowCapabilities {
  /** The workflow renders/validates images (screenshots, image assertions) — do not block images. */
  needsImages: boolean;
  /** The workflow relies on audio/video media. */
  needsMedia: boolean;
  /** The workflow performs downloads — keep `acceptDownloads`. */
  needsDownloads: boolean;
  /** The workflow depends on Service Workers (offline app bootstrap, SW-intercepted requests). */
  needsServiceWorkers: boolean;
  /** The workflow depends on WebGL/3D/canvas (maps, charts). Static-undetectable → hint-driven. */
  needsWebGL: boolean;
  /** The workflow depends on GPU acceleration. Static-undetectable → hint-driven. */
  needsGpu: boolean;
  /** The workflow validates animations / animated state transitions — do not force reduced motion. */
  needsAnimations: boolean;
  /** The workflow uses several concurrent pages/tabs — do not close "idle" pages. */
  needsMultiplePages: boolean;
  /** The workflow captures full-page or pixel-faithful screenshots — keep full device-scale. */
  needsFullResolution: boolean;
}

/**
 * Explicit per-workflow overrides for capabilities that cannot be proven from flow JSON. These force a
 * capability ON (relaxing the profile); they can never turn a capability OFF (which could break the run).
 */
export interface CapabilityHints {
  requiresImages?: boolean;
  requiresMedia?: boolean;
  requiresServiceWorkers?: boolean;
  requiresWebGL?: boolean;
  requiresGpu?: boolean;
  requiresAnimations?: boolean;
  requiresFullResolution?: boolean;
}

/**
 * Analyze a workflow's browser-feature needs from its config + flows (+ optional explicit hints).
 * Never throws; missing data degrades to the least-aggressive-safe assumption.
 */
export function analyzeWorkflowCapabilities(
  config: InstanceConfig,
  flows: FlowProfile[],
  hints: CapabilityHints = {}
): WorkflowCapabilities {
  const features = extractWorkloadFeatures(config, flows);

  // Screenshots need the page to actually render (images + full resolution for pixel-faithful captures).
  const capturesScreens = features.screenshotCount > 0;

  return {
    needsImages: Boolean(hints.requiresImages) || capturesScreens,
    needsMedia: Boolean(hints.requiresMedia),
    needsDownloads: features.downloadCount > 0,
    // A persistent/captured-session profile commonly bootstraps via a Service Worker; keep them to avoid
    // breaking authenticated app shells unless the operator has proven otherwise.
    needsServiceWorkers: Boolean(hints.requiresServiceWorkers) || features.persistentProfile,
    needsWebGL: Boolean(hints.requiresWebGL),
    needsGpu: Boolean(hints.requiresGpu),
    needsAnimations: Boolean(hints.requiresAnimations),
    // Popups, isolated parallel branches, or browser swaps → more than one live page in play.
    needsMultiplePages: features.popupUsage || features.parallelBranches || features.browserSwap,
    needsFullResolution: Boolean(hints.requiresFullResolution) || features.fullPageScreenshot || capturesScreens
  };
}

/** The most permissive capability set — used when no flows are available (nothing may be optimized away). */
export function permissiveCapabilities(): WorkflowCapabilities {
  return {
    needsImages: true,
    needsMedia: true,
    needsDownloads: true,
    needsServiceWorkers: true,
    needsWebGL: true,
    needsGpu: true,
    needsAnimations: true,
    needsMultiplePages: true,
    needsFullResolution: true
  };
}
