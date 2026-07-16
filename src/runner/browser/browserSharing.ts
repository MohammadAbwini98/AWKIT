/**
 * Shared-browser eligibility (Concurrency Capacity plan — Phase A5).
 *
 * Thin, back-compatible surface over the authoritative `BrowserIsolationResolver`. `isSharedEligible`
 * answers the engine's yes/no dispatch question by delegating to the resolver (single source of truth),
 * so the eligibility rules can never drift from the four-class classification. The resolver additionally
 * exposes the isolation class + the launch-arg-aware compatibility key (see BrowserIsolationResolver.ts).
 */
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import { resolveBrowserIsolation, scenarioUsesBrowserSwap, sharedCompatibilityKey } from "./BrowserIsolationResolver";

export { scenarioUsesBrowserSwap, sharedCompatibilityKey };

/**
 * Shared-eligible = classified SHARED_CONTEXT by the resolver (shared-pool flag on, `browserContext`
 * isolation, no persistent profile / captured session, and no mid-run browser-swap node).
 */
export function isSharedEligible(config: InstanceConfig, flows: FlowProfile[], sharedFlagEnabled: boolean): boolean {
  return resolveBrowserIsolation(config, flows, { sharedPoolEnabled: sharedFlagEnabled }).shareable;
}

/**
 * Legacy human-readable group key (browser + headed/headless). Superseded by `sharedCompatibilityKey`,
 * which also folds in the browser-level launch-arg deltas so instances with incompatible launch configs
 * never share a process. Retained for back-compat and diagnostics.
 */
export function sharedLaunchKey(config: InstanceConfig): string {
  return `${config.browser}:${config.headless ? "headless" : "headed"}`;
}
