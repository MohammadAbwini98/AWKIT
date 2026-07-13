/**
 * Admission control for new instance dispatch. Combines pool saturation, host memory pressure,
 * and browser crash rate into a single allow/block decision with an explicit reason, preferring
 * queueing over crashing the host. Consulted by ExecutionEngine before starting each instance.
 */
import os from "node:os";
import type { CapacitySnapshot } from "./CapacitySnapshot";
import type { ConcurrencyLimits } from "./ConcurrencyConfig";
import type { ResourceSampler } from "./ResourceSampler";
import type { BrowserWorkerPool } from "../browser/BrowserWorkerPool";

export interface AdmissionDecision {
  allow: boolean;
  reason?: string;
}

export class BackpressureController {
  private lastBlockedReason: string | undefined;

  constructor(
    private readonly pool: BrowserWorkerPool,
    private readonly limits: ConcurrencyLimits = pool.concurrencyLimits,
    /** Optional CPU/memory sampler; thresholds only apply while its sample is fresh. */
    private readonly sampler?: ResourceSampler
  ) {}

  /**
   * Decide whether one more instance (== one more browser) may start now.
   * `activeFlows`/`queueDepth` come from the engine's instance pool view.
   */
  admit(activeFlows: number, queueDepth: number, effectiveMaxFlows?: number): AdmissionDecision {
    const poolSnapshot = this.pool.snapshot();

    if (poolSnapshot.activeSlots >= poolSnapshot.maxSlots) {
      return this.block(`browser pool saturated (${poolSnapshot.activeSlots}/${poolSnapshot.maxSlots} browsers)`);
    }
    // The adaptive controller (Phase A7) may lower the effective flow cap below the configured max under
    // live host pressure; never above it.
    const flowCap =
      effectiveMaxFlows !== undefined ? Math.max(1, Math.min(effectiveMaxFlows, this.limits.maxActiveFlows)) : this.limits.maxActiveFlows;
    if (activeFlows >= flowCap) {
      return this.block(`active flow limit reached (${activeFlows}/${flowCap})`);
    }
    const freeMemoryMb = Math.round(os.freemem() / (1024 * 1024));
    if (freeMemoryMb < this.limits.minFreeMemoryMb) {
      return this.block(`low host memory (${freeMemoryMb}MB free < ${this.limits.minFreeMemoryMb}MB floor)`);
    }
    const recentCrashes = this.pool.recentCrashCount();
    if (recentCrashes > this.limits.maxRecentCrashes) {
      return this.block(`browser crash rate high (${recentCrashes} crashes in window) — pausing new dispatch`);
    }

    // Sampled CPU / memory pressure (only while the sample is fresh; sampling failure = no-op).
    const sample = this.freshSample();
    if (sample?.systemMemoryPercent !== undefined && sample.systemMemoryPercent > this.limits.maxSystemMemoryPercent) {
      return this.block(`system memory pressure (${sample.systemMemoryPercent}% used > ${this.limits.maxSystemMemoryPercent}% cap)`);
    }
    if (sample?.processRssMb !== undefined && sample.processRssMb > this.limits.maxProcessMemoryMb) {
      return this.block(`process memory pressure (${sample.processRssMb}MB RSS > ${this.limits.maxProcessMemoryMb}MB cap)`);
    }
    if (sample?.cpuPercent !== undefined && sample.cpuPercent > this.limits.maxCpuPercent) {
      return this.block(`CPU pressure (${sample.cpuPercent}% > ${this.limits.maxCpuPercent}% cap)`);
    }

    this.lastBlockedReason = undefined;
    return { allow: true };
  }

  snapshot(activeFlows: number, queueDepth: number, adaptive?: { target: number; state: string }): CapacitySnapshot {
    const poolSnapshot = this.pool.snapshot();
    return {
      timestamp: new Date().toISOString(),
      activeBrowsers: poolSnapshot.activeSlots,
      maxBrowsers: poolSnapshot.maxSlots,
      activeContexts: this.pool.activeContexts(),
      activePages: this.pool.activePages(),
      activeFlows,
      maxActiveFlows: this.limits.maxActiveFlows,
      queueDepth,
      freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
      processRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      recentCrashes: poolSnapshot.recentCrashes,
      systemMemoryPercent: this.safeLatest()?.systemMemoryPercent,
      cpuPercent: this.safeLatest()?.cpuPercent,
      processCpuPercent: this.safeLatest()?.processCpuPercent,
      sampledAt: this.safeLatest()?.sampledAt,
      dispatchBlocked: this.lastBlockedReason !== undefined,
      blockedReason: this.lastBlockedReason,
      adaptiveTarget: adaptive?.target,
      adaptiveState: adaptive?.state
    };
  }

  /** Sampler access is best-effort: a broken sampler must never break admission or snapshots. */
  private freshSample() {
    try {
      return this.sampler?.isFresh() ? this.sampler.latest : undefined;
    } catch {
      return undefined;
    }
  }

  private safeLatest() {
    try {
      return this.sampler?.latest;
    } catch {
      return undefined;
    }
  }

  private block(reason: string): AdmissionDecision {
    this.lastBlockedReason = reason;
    return { allow: false, reason };
  }
}
