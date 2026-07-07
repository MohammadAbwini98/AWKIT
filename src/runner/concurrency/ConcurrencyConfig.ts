/**
 * Host concurrency limits for the browser runtime. Conservative starting envelopes —
 * every value is overridable via environment variables (offline-safe; no remote config).
 */
export interface ConcurrencyLimits {
  /** Max simultaneously-open browser processes (one per running instance). */
  maxBrowsersPerHost: number;
  /** Max browser contexts tracked per browser worker (persistent context counts as 1). */
  maxContextsPerBrowser: number;
  /** Max concurrently-open pages per context (parallel isolated branches consume these). */
  maxPagesPerContext: number;
  /** Max concurrently-running flows (instances) admitted by the engine. */
  maxActiveFlows: number;
  /** Max concurrently-running nodes within one flow (isolated parallel branches). */
  maxActiveNodesPerFlow: number;
  /** Backpressure: block new dispatch when host free memory drops below this many MB. */
  minFreeMemoryMb: number;
  /** Backpressure: block new dispatch when this many browser crashes happened in the window. */
  maxRecentCrashes: number;
  /** Crash-rate observation window. */
  crashWindowMs: number;
  /** Watchdog: a running instance with no heartbeat for this long is probed/recovered. */
  staleHeartbeatMs: number;
  /** Watchdog scan interval. */
  watchdogIntervalMs: number;
  /** Max concurrently-dispatched instances per target origin (semaphore `origin:<host>`). */
  maxPerOrigin: number;
  /** Max concurrently-dispatched instances per account key (semaphore `account:<envFile>`). */
  maxPerAccount: number;
  /** Re-evaluate `origin:*` claims when a page navigates to a different origin mid-flow. */
  dynamicOriginClaims: boolean;
  /** Max wait for a new origin semaphore during a mid-flow origin change. */
  originClaimTimeoutMs: number;
  /** Backpressure: block new dispatch when system memory usage exceeds this percent. */
  maxSystemMemoryPercent: number;
  /** Backpressure: block new dispatch when the main process RSS exceeds this many MB. */
  maxProcessMemoryMb: number;
  /** Backpressure: block new dispatch when sampled system CPU exceeds this percent. */
  maxCpuPercent: number;
  /** Resource sampler interval. */
  resourceSampleIntervalMs: number;
}

const DEFAULTS: ConcurrencyLimits = {
  maxBrowsersPerHost: 2,
  maxContextsPerBrowser: 4,
  maxPagesPerContext: 2,
  maxActiveFlows: 4,
  maxActiveNodesPerFlow: 2,
  minFreeMemoryMb: 512,
  maxRecentCrashes: 3,
  crashWindowMs: 5 * 60_000,
  staleHeartbeatMs: 120_000,
  watchdogIntervalMs: 15_000,
  maxPerOrigin: 2,
  maxPerAccount: 1,
  dynamicOriginClaims: true,
  originClaimTimeoutMs: 30_000,
  maxSystemMemoryPercent: 85,
  maxProcessMemoryMb: 2048,
  maxCpuPercent: 85,
  resourceSampleIntervalMs: 2000
};

function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

export function loadConcurrencyLimits(overrides: Partial<ConcurrencyLimits> = {}): ConcurrencyLimits {
  return {
    maxBrowsersPerHost: envInt("AWKIT_MAX_BROWSERS", DEFAULTS.maxBrowsersPerHost),
    maxContextsPerBrowser: envInt("AWKIT_MAX_CONTEXTS_PER_BROWSER", DEFAULTS.maxContextsPerBrowser),
    maxPagesPerContext: envInt("AWKIT_MAX_PAGES_PER_CONTEXT", DEFAULTS.maxPagesPerContext),
    maxActiveFlows: envInt("AWKIT_MAX_ACTIVE_FLOWS", DEFAULTS.maxActiveFlows),
    maxActiveNodesPerFlow: envInt("AWKIT_MAX_ACTIVE_NODES_PER_FLOW", DEFAULTS.maxActiveNodesPerFlow),
    minFreeMemoryMb: envInt("AWKIT_MIN_FREE_MEMORY_MB", DEFAULTS.minFreeMemoryMb, 0),
    maxRecentCrashes: envInt("AWKIT_MAX_RECENT_CRASHES", DEFAULTS.maxRecentCrashes, 0),
    crashWindowMs: envInt("AWKIT_CRASH_WINDOW_MS", DEFAULTS.crashWindowMs, 1000),
    staleHeartbeatMs: envInt("AWKIT_STALE_HEARTBEAT_MS", DEFAULTS.staleHeartbeatMs, 5000),
    watchdogIntervalMs: envInt("AWKIT_WATCHDOG_INTERVAL_MS", DEFAULTS.watchdogIntervalMs, 1000),
    maxPerOrigin: envInt("AWKIT_MAX_PER_ORIGIN", DEFAULTS.maxPerOrigin),
    maxPerAccount: envInt("AWKIT_MAX_PER_ACCOUNT", DEFAULTS.maxPerAccount),
    dynamicOriginClaims: envBool("AWKIT_DYNAMIC_ORIGIN_CLAIMS", DEFAULTS.dynamicOriginClaims),
    originClaimTimeoutMs: envInt("AWKIT_ORIGIN_CLAIM_TIMEOUT_MS", DEFAULTS.originClaimTimeoutMs, 100),
    maxSystemMemoryPercent: envInt("AWKIT_MAX_SYSTEM_MEMORY_PERCENT", DEFAULTS.maxSystemMemoryPercent, 1),
    maxProcessMemoryMb: envInt("AWKIT_MAX_PROCESS_MEMORY_MB", DEFAULTS.maxProcessMemoryMb, 64),
    maxCpuPercent: envInt("AWKIT_MAX_CPU_PERCENT", DEFAULTS.maxCpuPercent, 1),
    resourceSampleIntervalMs: envInt("AWKIT_RESOURCE_SAMPLE_INTERVAL_MS", DEFAULTS.resourceSampleIntervalMs, 250),
    ...overrides
  };
}

/**
 * Kind-prefix semaphore capacities for the global lock manager: an `origin:*` / `account:*`
 * entry caps every key of that kind unless an exact-key capacity overrides it.
 */
export function defaultSemaphoreCapacities(limits: ConcurrencyLimits = loadConcurrencyLimits()): Record<string, number> {
  return {
    "origin:*": limits.maxPerOrigin,
    "account:*": limits.maxPerAccount
  };
}
