/** Point-in-time view of runtime capacity, exposed to logs, state artifacts, and the watchdog. */
export interface CapacitySnapshot {
  timestamp: string;
  activeBrowsers: number;
  maxBrowsers: number;
  activeContexts: number;
  activePages: number;
  activeFlows: number;
  maxActiveFlows: number;
  queueDepth: number;
  freeMemoryMb: number;
  processRssMb: number;
  recentCrashes: number;
  /** Sampled system memory usage percent (Phase 3 resource sampler; undefined until sampled). */
  systemMemoryPercent?: number;
  /** Sampled system-wide CPU busy percent (undefined until two samples exist). */
  cpuPercent?: number;
  /** Sampled main-process CPU percent. */
  processCpuPercent?: number;
  /** When the resource sample backing the fields above was taken. */
  sampledAt?: string;
  /** True when the backpressure controller is currently refusing new dispatch. */
  dispatchBlocked: boolean;
  blockedReason?: string;
}
