/**
 * Run-level entry point for the Browser Resource Optimization architecture.
 *
 * Ties the pieces together for one instance: pick the profile mode (env, default `balanced` == today),
 * analyze the workflow's capabilities from its flows, and resolve the authoritative runtime configuration.
 * This is the ONLY function the engine/runner needs to call; everything below it is pure.
 *
 * Offline-safe: the only external input is `process.env`. Default (`AWKIT_BROWSER_RESOURCE_PROFILE`
 * unset) yields `balanced`, which resolves to AWKIT's historical behaviour.
 */
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import {
  parseBrowserResourceProfileMode,
  resolveBrowserResourceProfile,
  type BrowserResourceProfileMode
} from "./BrowserResourceProfile";
import {
  analyzeWorkflowCapabilities,
  permissiveCapabilities,
  type CapabilityHints,
  type WorkflowCapabilities
} from "./WorkflowCapabilities";
import {
  resolveBrowserRuntimeConfiguration,
  type ResolvedBrowserRuntimeConfiguration
} from "./BrowserRuntimeConfigurationResolver";

export function loadBrowserResourceProfileMode(env: NodeJS.ProcessEnv = process.env): BrowserResourceProfileMode {
  return parseBrowserResourceProfileMode(env.AWKIT_BROWSER_RESOURCE_PROFILE);
}

/** Global operator escape hatches: force a capability ON regardless of static detection. */
function envCapabilityHints(env: NodeJS.ProcessEnv): CapabilityHints {
  const on = (raw: string | undefined): boolean | undefined =>
    raw === undefined || raw === "" ? undefined : !["0", "false", "no", "off"].includes(raw.toLowerCase());
  return {
    requiresImages: on(env.AWKIT_WORKFLOW_REQUIRES_IMAGES),
    requiresMedia: on(env.AWKIT_WORKFLOW_REQUIRES_MEDIA),
    requiresServiceWorkers: on(env.AWKIT_WORKFLOW_REQUIRES_SERVICE_WORKERS),
    requiresWebGL: on(env.AWKIT_WORKFLOW_REQUIRES_WEBGL),
    requiresGpu: on(env.AWKIT_WORKFLOW_REQUIRES_GPU),
    requiresAnimations: on(env.AWKIT_WORKFLOW_REQUIRES_ANIMATIONS),
    requiresFullResolution: on(env.AWKIT_WORKFLOW_REQUIRES_FULL_RESOLUTION)
  };
}

export interface ResolveForRunOptions {
  env?: NodeJS.ProcessEnv;
  machine?: { logicalCpuCount?: number };
  /** Explicit per-workflow capability overrides (supersede env hints when provided). */
  hints?: CapabilityHints;
}

/**
 * Resolve the browser runtime configuration for one instance. When `flows` is empty/unknown, the most
 * permissive capabilities are assumed so no optimization is applied blindly.
 */
export function resolveBrowserConfigurationForRun(
  config: InstanceConfig,
  flows: FlowProfile[] | undefined,
  options: ResolveForRunOptions = {}
): ResolvedBrowserRuntimeConfiguration {
  const env = options.env ?? process.env;
  const mode = loadBrowserResourceProfileMode(env);
  const profile = resolveBrowserResourceProfile(mode);

  const hints = options.hints ?? envCapabilityHints(env);
  const capabilities: WorkflowCapabilities =
    flows && flows.length > 0 ? analyzeWorkflowCapabilities(config, flows, hints) : permissiveCapabilities();

  return resolveBrowserRuntimeConfiguration({ profile, capabilities, machine: options.machine, env });
}
