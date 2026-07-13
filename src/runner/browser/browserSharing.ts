/**
 * Shared-browser eligibility classification (Concurrency Capacity plan — Phase A5).
 *
 * Decides whether an instance may run on a SHARED Chromium process (many isolated contexts per browser)
 * or needs its OWN dedicated browser. Dedicated is required whenever the instance owns a persistent
 * profile or performs a mid-run browser swap (Reuse Session / Auto Secure Login / protected-login
 * handoff) — those cannot safely share a process with other instances. Pure + framework-agnostic.
 */
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { InstanceConfig } from "@src/instances/InstanceConfig";

/** Node types whose runtime behaviour closes/relaunches (swaps) the automation browser mid-run. */
const BROWSER_SWAP_NODE_TYPES = new Set(["autoSecureLogin", "reuseSession", "protectedLoginHandoff"]);

/** True when any flow in the scenario contains a node that swaps the automation browser mid-run. */
export function scenarioUsesBrowserSwap(flows: FlowProfile[]): boolean {
  return flows.some((flow) => (flow.nodes ?? []).some((node) => BROWSER_SWAP_NODE_TYPES.has(node.type)));
}

/**
 * Shared-eligible = the shared-pool flag is on, the instance uses isolated `browserContext` isolation
 * (not a persistent profile / captured session), and none of its flows swap the browser mid-run.
 */
export function isSharedEligible(config: InstanceConfig, flows: FlowProfile[], sharedFlagEnabled: boolean): boolean {
  if (!sharedFlagEnabled) return false;
  if (config.isolationMode !== "browserContext") return false;
  if (config.sessionProfileId || config.userDataDir) return false;
  return !scenarioUsesBrowserSwap(flows);
}

/** Group key so only compatible browsers are shared (headed and headless never share a process). */
export function sharedLaunchKey(config: InstanceConfig): string {
  return `${config.browser}:${config.headless ? "headless" : "headed"}`;
}
