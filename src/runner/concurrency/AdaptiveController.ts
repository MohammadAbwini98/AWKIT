/**
 * Adaptive concurrency controller (Concurrency Capacity plan — Phase A7).
 *
 * Maintains a live active-flow TARGET between 1 and the configured ceiling. It grows slowly toward the
 * ceiling while the host is healthy and shrinks fast under real pressure — CPU / memory / event-loop
 * delay / crash-rate — which reflects load from OTHER applications too, not just AWKIT. Purely
 * protective: with no pressure it sits at the ceiling, so steady-state behaviour is unchanged.
 *
 * Design guards against oscillation: asymmetric steps (grow by 1, shrink by more) + a cooldown between
 * changes. It never touches the browser-slot semaphore (that resize stays idle-only) — it only bounds
 * how many flows admission will start. Pure + framework-agnostic; thresholds are all injected config.
 */
export type AdaptiveState = "healthy" | "stable" | "pressure" | "critical";

export interface AdaptiveHealthInput {
  cpuPercent?: number;
  systemMemoryPercent?: number;
  freeMemoryMb?: number;
  eventLoopDelayMs?: number;
  recentCrashes: number;
  /** Pending work — the target only grows when there is queued work that could use more capacity. */
  queueDepth: number;
  /** Injectable clock for deterministic tests. */
  now?: number;
}

export interface AdaptiveThresholds {
  enabled: boolean;
  growStep: number;
  shrinkStep: number;
  cooldownMs: number;
  healthyCpuPercent: number;
  healthyMemoryPercent: number;
  pressureCpuPercent: number;
  pressureMemoryPercent: number;
  pressureFreeMemoryMb: number;
  pressureEventLoopMs: number;
  criticalCpuPercent: number;
  criticalMemoryPercent: number;
  criticalEventLoopMs: number;
  criticalCrashes: number;
}

export interface AdaptiveEvaluation {
  state: AdaptiveState;
  target: number;
}

export class AdaptiveController {
  private target: number;
  private state: AdaptiveState = "stable";
  private lastChangeAt = 0;

  constructor(private ceiling: number, private thresholds: AdaptiveThresholds) {
    this.target = Math.max(1, Math.floor(ceiling));
  }

  /** The effective active-flow target. When disabled, always the full ceiling (no throttling). */
  get currentTarget(): number {
    return this.thresholds.enabled ? this.target : this.ceiling;
  }

  get currentState(): AdaptiveState {
    return this.thresholds.enabled ? this.state : "stable";
  }

  /**
   * Set a new ceiling (an intentional reconfiguration — Settings/Auto/Manual). The target jumps to the
   * new ceiling rather than crawling there: a user/operator change is not pressure, so it takes effect
   * immediately. Clamped to >= 1.
   */
  setCeiling(ceiling: number): void {
    this.ceiling = Math.max(1, Math.floor(ceiling));
    this.target = this.ceiling;
    this.state = "stable";
    this.lastChangeAt = 0;
  }

  updateThresholds(partial: Partial<AdaptiveThresholds>): void {
    Object.assign(this.thresholds, partial);
  }

  /** Classify current health and adjust the target. Returns the new state + target. */
  evaluate(input: AdaptiveHealthInput): AdaptiveEvaluation {
    const t = this.thresholds;
    if (!t.enabled) {
      this.target = this.ceiling;
      this.state = "stable";
      return { state: "stable", target: this.ceiling };
    }

    const now = input.now ?? Date.now();
    this.state = this.classify(input, t);
    const cooled = now - this.lastChangeAt >= t.cooldownMs;

    switch (this.state) {
      case "critical":
        if (cooled && this.target > 1) {
          this.target = Math.max(1, this.target - Math.max(1, t.shrinkStep));
          this.lastChangeAt = now;
        }
        break;
      case "pressure":
        // Freeze: don't grow (admission's own backpressure pauses dispatch); don't shrink either.
        break;
      case "healthy":
        if (cooled && this.target < this.ceiling && input.queueDepth > 0) {
          this.target = Math.min(this.ceiling, this.target + Math.max(1, t.growStep));
          this.lastChangeAt = now;
        }
        break;
      case "stable":
        break;
    }

    this.target = Math.max(1, Math.min(this.ceiling, this.target));
    return { state: this.state, target: this.target };
  }

  private classify(input: AdaptiveHealthInput, t: AdaptiveThresholds): AdaptiveState {
    const { cpuPercent: cpu, systemMemoryPercent: mem, freeMemoryMb: free, eventLoopDelayMs: lag } = input;

    if (
      (cpu !== undefined && cpu >= t.criticalCpuPercent) ||
      (mem !== undefined && mem >= t.criticalMemoryPercent) ||
      (lag !== undefined && lag >= t.criticalEventLoopMs) ||
      input.recentCrashes >= t.criticalCrashes
    ) {
      return "critical";
    }

    if (
      (cpu !== undefined && cpu >= t.pressureCpuPercent) ||
      (mem !== undefined && mem >= t.pressureMemoryPercent) ||
      (free !== undefined && free < t.pressureFreeMemoryMb) ||
      (lag !== undefined && lag >= t.pressureEventLoopMs)
    ) {
      return "pressure";
    }

    // "Healthy" requires positive evidence the host is idle — if we know nothing (no CPU/memory sample
    // yet), hold rather than grow. This prevents growth on the very first tick or after a sampler stall.
    const known = cpu !== undefined || mem !== undefined;
    const cpuOk = cpu === undefined || cpu < t.healthyCpuPercent;
    const memOk = mem === undefined || mem < t.healthyMemoryPercent;
    return known && cpuOk && memOk ? "healthy" : "stable";
  }
}
