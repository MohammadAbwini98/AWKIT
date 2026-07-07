/**
 * Host resource sampling for backpressure (Windows-first, cross-platform, no native deps).
 * Samples system memory %, main-process RSS, and CPU % (system-wide via os.cpus() time deltas,
 * plus main-process CPU via process.cpuUsage deltas). Sampling problems yield undefined values
 * and never throw — execution must not depend on telemetry.
 */
import os from "node:os";

export interface ResourceSample {
  sampledAt: string;
  systemMemoryPercent?: number;
  processRssMb?: number;
  /** System-wide CPU busy percent since the previous sample. */
  cpuPercent?: number;
  /** This process's CPU percent (both cores summed, normalized by core count). */
  processCpuPercent?: number;
}

interface CpuTimes {
  idle: number;
  total: number;
}

export class ResourceSampler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastCpuTimes: CpuTimes | undefined;
  private lastProcessCpu: NodeJS.CpuUsage | undefined;
  private lastProcessCpuAt: number | undefined;
  private latestSample: ResourceSample | undefined;

  constructor(private readonly intervalMs = 2000) {}

  get latest(): ResourceSample | undefined {
    return this.latestSample;
  }

  /** True when the latest sample is recent enough to act on. */
  isFresh(now = Date.now(), maxAgeMs = this.intervalMs * 3): boolean {
    if (!this.latestSample) return false;
    return now - Date.parse(this.latestSample.sampledAt) <= maxAgeMs;
  }

  start(): void {
    if (this.timer) return;
    this.sample(); // prime the deltas
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Take one sample now (also used directly by verifiers). Never throws. */
  sample(): ResourceSample {
    const result: ResourceSample = { sampledAt: new Date().toISOString() };
    try {
      result.systemMemoryPercent = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 1000) / 10;
    } catch {
      /* keep undefined */
    }
    try {
      result.processRssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    } catch {
      /* keep undefined */
    }
    try {
      const cpus = os.cpus();
      const current: CpuTimes = cpus.reduce(
        (acc, cpu) => {
          const times = cpu.times;
          acc.idle += times.idle;
          acc.total += times.user + times.nice + times.sys + times.idle + times.irq;
          return acc;
        },
        { idle: 0, total: 0 }
      );
      if (this.lastCpuTimes) {
        const idleDelta = current.idle - this.lastCpuTimes.idle;
        const totalDelta = current.total - this.lastCpuTimes.total;
        if (totalDelta > 0) result.cpuPercent = Math.round((1 - idleDelta / totalDelta) * 1000) / 10;
      }
      this.lastCpuTimes = current;
    } catch {
      /* keep undefined */
    }
    try {
      const now = Date.now();
      const usage = process.cpuUsage();
      if (this.lastProcessCpu && this.lastProcessCpuAt) {
        const elapsedUs = (now - this.lastProcessCpuAt) * 1000;
        const usedUs = usage.user + usage.system - (this.lastProcessCpu.user + this.lastProcessCpu.system);
        const cores = Math.max(1, os.cpus().length);
        if (elapsedUs > 0) result.processCpuPercent = Math.round((usedUs / (elapsedUs * cores)) * 1000) / 10;
      }
      this.lastProcessCpu = usage;
      this.lastProcessCpuAt = now;
    } catch {
      /* keep undefined */
    }

    this.latestSample = result;
    return result;
  }
}
