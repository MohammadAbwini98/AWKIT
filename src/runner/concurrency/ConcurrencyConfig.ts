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
  /**
   * Phase A5 (default ON since the real-ExecutionEngine capacity benchmark): route shared-eligible
   * instances (browserContext isolation, no session-swap nodes) through a shared Chromium pool so many
   * isolated contexts share a few browser processes instead of one process per instance. Persistent/
   * Reuse-Session/protected-login instances always keep their own dedicated browser. An operator can turn
   * it OFF with AWKIT_SHARED_BROWSER_POOL=0 (or false/no/off).
   */
  useSharedBrowserPool: boolean;
  /** Hard cap on contexts per shared browser — always enforced for crash isolation. */
  maxContextsPerBrowserHardLimit: number;
  /** Recycle a shared browser after it has created this many contexts (drain then replace). */
  browserRecycleAfterContexts: number;
  /** Recycle a shared browser once its process-tree memory exceeds this many MB (advisory; A5+). */
  browserRecycleMemoryMb: number;
  /** Max time to wait for a shared browser to drain before forcing it closed. */
  browserDrainTimeoutMs: number;
  /**
   * Phase A6 — operation limiters. Independent caps on the number of each EXPENSIVE operation that may
   * run at once across all instances, so peak concurrency does not mean peak simultaneous spikes. Each
   * is a config value (Sequential forces them to 1); none is fixed to a machine.
   */
  maxConcurrentBrowserLaunches: number;
  maxConcurrentContextCreations: number;
  maxConcurrentNavigations: number;
  maxConcurrentDownloads: number;
  maxConcurrentScreenshots: number;
  /**
   * Phase A7 — adaptive concurrency. When enabled, the live active-flow target grows slowly toward the
   * configured cap while the host is healthy and shrinks under real pressure (including load from OTHER
   * apps), then recovers. Purely protective: with no pressure it sits at the cap (no behavior change).
   */
  adaptiveConcurrency: boolean;
  adaptiveGrowStep: number;
  adaptiveShrinkStep: number;
  adaptiveCooldownMs: number;
  /** Below these sampled values the host is "healthy" and the target may grow. */
  adaptiveHealthyCpuPercent: number;
  adaptiveHealthyMemoryPercent: number;
  /** At/above these the host is "critical" and the target shrinks fast. */
  adaptiveCriticalCpuPercent: number;
  adaptiveCriticalMemoryPercent: number;
  /** Event-loop delay (ms) thresholds for pressure/critical states. */
  adaptivePressureEventLoopMs: number;
  adaptiveCriticalEventLoopMs: number;
  /**
   * Phase A8: admit new dispatch against a WEIGHTED cost budget instead of a raw active-flow count.
   * Heavier instances (persistent profiles, headed, downloads, parallel branches, trace/video, …) consume
   * more of the budget, so two heavy flows can weigh as much as several light ones. Weighted admission is
   * **strictly dependent on the Shared Browser Pool**: the benchmark measured it beneficial only WITH the
   * pool (Config D) and net-harmful without it (Config C), so it can never resolve ON while the pool is
   * OFF — not by default and not even when explicitly requested (see `resolveWeightedAdmission`). When the
   * pool is ON it defaults to ON; an explicit AWKIT_WORKLOAD_WEIGHTS=false still turns it off.
   */
  workloadWeights: boolean;
  /** Weighted budget per configured active flow (budget = maxActiveFlows × this). 1.0 == base cost. */
  workloadWeightBudgetPerFlow: number;
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
  resourceSampleIntervalMs: 2000,
  useSharedBrowserPool: true,
  maxContextsPerBrowserHardLimit: 8,
  browserRecycleAfterContexts: 50,
  browserRecycleMemoryMb: 2500,
  browserDrainTimeoutMs: 60_000,
  maxConcurrentBrowserLaunches: 2,
  maxConcurrentContextCreations: 4,
  maxConcurrentNavigations: 8,
  maxConcurrentDownloads: 3,
  maxConcurrentScreenshots: 2,
  adaptiveConcurrency: true,
  adaptiveGrowStep: 1,
  adaptiveShrinkStep: 2,
  adaptiveCooldownMs: 10_000,
  adaptiveHealthyCpuPercent: 60,
  adaptiveHealthyMemoryPercent: 70,
  adaptiveCriticalCpuPercent: 95,
  adaptiveCriticalMemoryPercent: 92,
  adaptivePressureEventLoopMs: 200,
  adaptiveCriticalEventLoopMs: 500,
  workloadWeights: true, // resolved as "follow the shared pool, never ON while pool OFF" (see below)
  workloadWeightBudgetPerFlow: 1.0
};

/**
 * The single searchable diagnostic emitted when an operator explicitly requests weighted admission while
 * the Shared Browser Pool is disabled. Exported so tests/tools can match on the exact wording.
 */
export const WEIGHTED_ADMISSION_REQUIRES_POOL_DIAGNOSTIC =
  "AWKIT_WORKLOAD_WEIGHTS=true ignored because Shared Browser Pool is disabled. Weighted admission requires Shared Browser Pool.";

export interface WeightedAdmissionResolution {
  /** Effective weighted-admission state after enforcing the pool dependency. */
  workloadWeights: boolean;
  /** Set only when an explicit request was overridden (so the caller can warn once). */
  diagnostic?: string;
}

/**
 * Enforce the Shared Browser Pool → A8 weighted-admission dependency. Weighted admission is only ever
 * beneficial WITH the pool (Config D); running it without the pool (Config C) measured net-harmful. So
 * weights can NEVER resolve ON while the pool is OFF — even when explicitly requested. When the operator
 * explicitly asked for weights while the pool is off, the request is forced OFF and a single searchable
 * diagnostic is returned (no startup error, no silent Config C). This is the one authoritative rule; both
 * env resolution and programmatic overrides pass through it.
 */
export function resolveWeightedAdmission(input: {
  useSharedBrowserPool: boolean;
  requestedWeights: boolean;
  weightsExplicit: boolean;
}): WeightedAdmissionResolution {
  if (!input.useSharedBrowserPool && input.requestedWeights) {
    return {
      workloadWeights: false,
      diagnostic: input.weightsExplicit ? WEIGHTED_ADMISSION_REQUIRES_POOL_DIAGNOSTIC : undefined
    };
  }
  return { workloadWeights: input.requestedWeights };
}

/** Process-once dedupe for the pool/weights diagnostic (loadConcurrencyLimits runs from many modules). */
const emittedDiagnostics = new Set<string>();
function emitWeightedAdmissionDiagnostic(message: string): void {
  if (emittedDiagnostics.has(message)) return;
  emittedDiagnostics.add(message);
  console.warn(`[concurrency] ${message}`);
}

function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function envFloat(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

export function loadConcurrencyLimits(overrides: Partial<ConcurrencyLimits> = {}): ConcurrencyLimits {
  // Resolve the shared pool first; A8 weighted admission then DEFAULTS to the pool's state when its own
  // env var is unspecified. Enabling weights while the pool is OFF (Config C) measured net-harmful, so the
  // Shared Pool → A8 dependency is enforced below (resolveWeightedAdmission): weights can never resolve ON
  // while the pool is OFF — not by default and not even when explicitly requested. An explicit
  // AWKIT_WORKLOAD_WEIGHTS=false is still honoured while the pool is ON.
  const useSharedBrowserPool = envBool("AWKIT_SHARED_BROWSER_POOL", DEFAULTS.useSharedBrowserPool);
  const weightsRaw = process.env.AWKIT_WORKLOAD_WEIGHTS;
  const weightsExplicitEnv = weightsRaw !== undefined && weightsRaw !== "";
  const requestedWeights = envBool("AWKIT_WORKLOAD_WEIGHTS", useSharedBrowserPool);
  const merged: ConcurrencyLimits = {
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
    useSharedBrowserPool,
    maxContextsPerBrowserHardLimit: envInt("AWKIT_MAX_CONTEXTS_PER_BROWSER_HARD_LIMIT", DEFAULTS.maxContextsPerBrowserHardLimit),
    browserRecycleAfterContexts: envInt("AWKIT_BROWSER_RECYCLE_AFTER_CONTEXTS", DEFAULTS.browserRecycleAfterContexts),
    browserRecycleMemoryMb: envInt("AWKIT_BROWSER_RECYCLE_MEMORY_MB", DEFAULTS.browserRecycleMemoryMb),
    browserDrainTimeoutMs: envInt("AWKIT_BROWSER_DRAIN_TIMEOUT_MS", DEFAULTS.browserDrainTimeoutMs, 1000),
    maxConcurrentBrowserLaunches: envInt("AWKIT_MAX_CONCURRENT_BROWSER_LAUNCHES", DEFAULTS.maxConcurrentBrowserLaunches),
    maxConcurrentContextCreations: envInt("AWKIT_MAX_CONCURRENT_CONTEXT_CREATIONS", DEFAULTS.maxConcurrentContextCreations),
    maxConcurrentNavigations: envInt("AWKIT_MAX_CONCURRENT_NAVIGATIONS", DEFAULTS.maxConcurrentNavigations),
    maxConcurrentDownloads: envInt("AWKIT_MAX_CONCURRENT_DOWNLOADS", DEFAULTS.maxConcurrentDownloads),
    maxConcurrentScreenshots: envInt("AWKIT_MAX_CONCURRENT_SCREENSHOTS", DEFAULTS.maxConcurrentScreenshots),
    adaptiveConcurrency: envBool("AWKIT_ADAPTIVE_CONCURRENCY", DEFAULTS.adaptiveConcurrency),
    adaptiveGrowStep: envInt("AWKIT_ADAPTIVE_GROW_STEP", DEFAULTS.adaptiveGrowStep),
    adaptiveShrinkStep: envInt("AWKIT_ADAPTIVE_SHRINK_STEP", DEFAULTS.adaptiveShrinkStep),
    adaptiveCooldownMs: envInt("AWKIT_ADAPTIVE_COOLDOWN_MS", DEFAULTS.adaptiveCooldownMs, 500),
    adaptiveHealthyCpuPercent: envInt("AWKIT_ADAPTIVE_HEALTHY_CPU_PERCENT", DEFAULTS.adaptiveHealthyCpuPercent, 1),
    adaptiveHealthyMemoryPercent: envInt("AWKIT_ADAPTIVE_HEALTHY_MEMORY_PERCENT", DEFAULTS.adaptiveHealthyMemoryPercent, 1),
    adaptiveCriticalCpuPercent: envInt("AWKIT_ADAPTIVE_CRITICAL_CPU_PERCENT", DEFAULTS.adaptiveCriticalCpuPercent, 1),
    adaptiveCriticalMemoryPercent: envInt("AWKIT_ADAPTIVE_CRITICAL_MEMORY_PERCENT", DEFAULTS.adaptiveCriticalMemoryPercent, 1),
    adaptivePressureEventLoopMs: envInt("AWKIT_ADAPTIVE_PRESSURE_EVENT_LOOP_MS", DEFAULTS.adaptivePressureEventLoopMs, 1),
    adaptiveCriticalEventLoopMs: envInt("AWKIT_ADAPTIVE_CRITICAL_EVENT_LOOP_MS", DEFAULTS.adaptiveCriticalEventLoopMs, 1),
    workloadWeights: requestedWeights,
    workloadWeightBudgetPerFlow: envFloat("AWKIT_WORKLOAD_WEIGHT_BUDGET_PER_FLOW", DEFAULTS.workloadWeightBudgetPerFlow, 0.1),
    ...overrides
  };

  // Enforce the Shared Pool → A8 dependency on the FINAL resolved values (env AND any programmatic
  // overrides): weighted admission may never resolve ON while the pool is OFF. One authoritative path.
  const weightsExplicit = weightsExplicitEnv || overrides.workloadWeights !== undefined;
  const resolution = resolveWeightedAdmission({
    useSharedBrowserPool: merged.useSharedBrowserPool,
    requestedWeights: merged.workloadWeights,
    weightsExplicit
  });
  merged.workloadWeights = resolution.workloadWeights;
  if (resolution.diagnostic) emitWeightedAdmissionDiagnostic(resolution.diagnostic);
  return merged;
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
