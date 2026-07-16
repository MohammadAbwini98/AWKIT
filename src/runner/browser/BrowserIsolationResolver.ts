/**
 * Authoritative browser-isolation resolver (Concurrency Capacity — shared-browser hardening).
 *
 * ONE place decides how an instance is isolated at the *browser* level, so the decision is never
 * scattered across services. Every instance is classified into exactly one class, with an explained
 * `{ decision, value, source }` diagnostic per rule:
 *
 *   SHARED_CONTEXT     → a fresh isolated BrowserContext on a shared Chromium process (Phase A5).
 *   DEDICATED_BROWSER  → its own Chromium process (shared pool off, or a non-shareable launch config).
 *   PERSISTENT_BROWSER → owns a persistent user-data profile / captured session (exclusive on disk).
 *   HANDOFF_BROWSER    → swaps the automation browser mid-run (Reuse Session / Auto Secure Login /
 *                        protected-login handoff) and cannot share a process with unrelated work.
 *
 * It ALSO derives the browser-level compatibility key: only browsers with an identical key may share a
 * Chromium process. The key folds in the browser-LEVEL launch configuration (headed/headless + the
 * resolved launch-arg deltas). Context-LEVEL options (viewport, device scale, storageState, request
 * routing) stay isolated per BrowserContext and are deliberately NOT part of the key — two workflows that
 * differ only at the context level may still share one browser.
 *
 * Pure + framework-agnostic (no Electron/React/Chromium, no I/O). Shareability never depends on the launch
 * args (only the compatibility key does): the class answers "can this share a process at all", the key
 * answers "which process is it allowed to share".
 */
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { InstanceConfig } from "@src/instances/InstanceConfig";
import type { LaunchArgOverrides } from "../browserProfile/BrowserRuntimeConfigurationResolver";

export type BrowserIsolationClass =
  | "SHARED_CONTEXT"
  | "DEDICATED_BROWSER"
  | "PERSISTENT_BROWSER"
  | "HANDOFF_BROWSER";

/** One classification rule and the reason it fired (mirrors the browser-profile resolver's diagnostics). */
export interface IsolationDiagnostic {
  decision: string;
  value: string;
  source: string;
}

export interface BrowserIsolationDecision {
  isolationClass: BrowserIsolationClass;
  /** True only for SHARED_CONTEXT — the sole class that leases a context on a pooled shared browser. */
  shareable: boolean;
  /** Browser-level compatibility key; only identical keys may share a Chromium process. */
  compatibilityKey: string;
  diagnostics: IsolationDiagnostic[];
}

export interface BrowserIsolationInput {
  /** The live `useSharedBrowserPool` flag. Flag off → every instance is a DEDICATED_BROWSER. */
  sharedPoolEnabled: boolean;
  /** The resolved browser-level launch deltas for this instance (folded into the compatibility key). */
  launchArgOverrides?: LaunchArgOverrides;
}

/** Node types whose runtime behaviour closes/relaunches (swaps) the automation browser mid-run. */
const BROWSER_SWAP_NODE_TYPES = new Set(["autoSecureLogin", "reuseSession", "protectedLoginHandoff"]);

/** True when any flow in the scenario contains a node that swaps the automation browser mid-run. */
export function scenarioUsesBrowserSwap(flows: FlowProfile[]): boolean {
  return (flows ?? []).some((flow) => (flow?.nodes ?? []).some((node) => BROWSER_SWAP_NODE_TYPES.has(node.type)));
}

/** A persistent profile / captured session owns an exclusive on-disk user-data dir — never shareable. */
function usesPersistentProfile(config: InstanceConfig): boolean {
  return config.isolationMode === "persistentContext" || Boolean(config.userDataDir) || Boolean(config.sessionProfileId);
}

/**
 * Classify one instance's browser isolation. Precedence is by physical constraint strength:
 *   1. PERSISTENT_BROWSER — owns a user-data dir lock (strongest; even trumps the shared flag).
 *   2. HANDOFF_BROWSER    — swaps the browser mid-run.
 *   3. shared pool off    — DEDICATED_BROWSER.
 *   4. non-`browserContext` isolation (defensive) — DEDICATED_BROWSER.
 *   5. otherwise          — SHARED_CONTEXT.
 */
export function resolveBrowserIsolation(
  config: InstanceConfig,
  flows: FlowProfile[],
  input: BrowserIsolationInput
): BrowserIsolationDecision {
  const compatibilityKey = sharedCompatibilityKey(config, input.launchArgOverrides);
  const decide = (
    isolationClass: BrowserIsolationClass,
    shareable: boolean,
    source: string,
    extra: IsolationDiagnostic[] = []
  ): BrowserIsolationDecision => ({
    isolationClass,
    shareable,
    compatibilityKey,
    diagnostics: [{ decision: "isolation", value: isolationClass, source }, ...extra]
  });

  if (usesPersistentProfile(config)) {
    const source =
      config.isolationMode === "persistentContext"
        ? "persistent-context-isolation"
        : config.sessionProfileId
          ? "captured-session-profile"
          : "explicit-user-data-dir";
    return decide("PERSISTENT_BROWSER", false, source);
  }

  if (scenarioUsesBrowserSwap(flows)) {
    return decide("HANDOFF_BROWSER", false, "browser-swap-node (reuseSession/autoSecureLogin/protectedLoginHandoff)");
  }

  if (!input.sharedPoolEnabled) {
    return decide("DEDICATED_BROWSER", false, "shared-browser-pool-disabled");
  }

  // Persistent modes are handled above; guard defensively against any other non-shareable mode.
  if (config.isolationMode !== "browserContext") {
    return decide("DEDICATED_BROWSER", false, `non-shareable-isolation-mode (${config.isolationMode})`);
  }

  return decide("SHARED_CONTEXT", true, "normal-workflow", [
    { decision: "compatibilityKey", value: compatibilityKey, source: "browser + headed/headless + launch-args" }
  ]);
}

/**
 * Deterministic browser-level compatibility key. Two instances may share a Chromium process only when
 * this key matches. It reflects the BROWSER-level launch configuration:
 *   - target browser + headed/headless,
 *   - the extra launch switches the resource profile adds (gpu/webgl/cache …),
 *   - the Playwright default switches it drops (`ignoreDefaultArgs`),
 *   - whether the background-timer-throttle pin is omitted.
 * Under the default `balanced` profile every instance resolves to empty deltas → one stable key → they
 * all share, exactly as before. Context-level differences are intentionally excluded (they are isolated
 * per BrowserContext). Delimiters are control chars that never appear in Chromium flags, so the encoding
 * is collision-safe without a hash dependency.
 */
export function sharedCompatibilityKey(config: InstanceConfig, overrides?: LaunchArgOverrides): string {
  const mode = config.headless ? "headless" : "headed";
  const add = [...(overrides?.add ?? [])].sort().join("");
  const ignore = [...(overrides?.ignoreDefaultArgs ?? [])].sort().join("");
  const throttle = overrides?.omitBackgroundTimerThrottlePin ? "1" : "0";
  return [`${config.browser}:${mode}`, `add=${add}`, `ign=${ignore}`, `thr=${throttle}`].join("");
}
