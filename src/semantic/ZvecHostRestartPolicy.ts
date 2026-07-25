/**
 * Restart / circuit-breaker decisions for the semantic native host (plan §6.3).
 *
 * Deliberately pure and framework-agnostic: the decision logic is the part that must never be
 * wrong, so it is kept out of `ZvecUtilityHostManager` (which imports Electron and therefore cannot
 * be exercised without a full Electron runtime). This class is driven by an injected clock and is
 * fully verifiable in plain Node.
 *
 * Rules:
 *  - an intentional shutdown is never a strike;
 *  - the first unexpected exit restarts lazily on the next operation;
 *  - a second unexpected exit inside the window restarts after a short delay;
 *  - a third opens the circuit for the remainder of the session;
 *  - a corrupt-generation signature opens the circuit immediately and names the generation for
 *    quarantine, because reopening the same corrupt data would just crash again.
 */

import { ZVEC_HOST_RESTART_POLICY } from "./contracts/ZvecHostProtocol";

export type RestartDecision =
  | { action: "restart"; delayMs: number; strikes: number }
  | { action: "openCircuit"; strikes: number; reason: "tooManyExits" | "corruptGeneration" }
  | { action: "none"; strikes: number };

export interface RestartPolicyState {
  strikes: number;
  circuitOpen: boolean;
  quarantinedGenerations: string[];
}

export class ZvecHostRestartPolicy {
  private exitTimestamps: number[] = [];
  private circuitOpen = false;
  private readonly quarantined = new Set<string>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly policy: { maxRestartsInWindow: number; windowMs: number; restartDelayMs: number } = ZVEC_HOST_RESTART_POLICY
  ) {}

  state(): RestartPolicyState {
    return {
      strikes: this.exitTimestamps.length,
      circuitOpen: this.circuitOpen,
      quarantinedGenerations: [...this.quarantined]
    };
  }

  isCircuitOpen(): boolean {
    return this.circuitOpen;
  }

  /** An orderly shutdown. Never counts against the restart budget. */
  recordIntentionalExit(): RestartDecision {
    return { action: "none", strikes: this.exitTimestamps.length };
  }

  /**
   * An unexpected exit. `generation` names the collection that was open, if any: a corrupt
   * generation is a distinct failure from a flaky process and must not be reopened.
   */
  recordUnexpectedExit(options: { generation?: string; corruptGeneration?: boolean } = {}): RestartDecision {
    if (this.circuitOpen) return { action: "none", strikes: this.exitTimestamps.length };

    if (options.corruptGeneration) {
      if (options.generation) this.quarantined.add(options.generation);
      this.circuitOpen = true;
      return { action: "openCircuit", strikes: this.exitTimestamps.length, reason: "corruptGeneration" };
    }

    const now = this.now();
    // Sliding window: only exits still inside it count toward the budget.
    this.exitTimestamps = this.exitTimestamps.filter((t) => now - t < this.policy.windowMs);
    this.exitTimestamps.push(now);
    const strikes = this.exitTimestamps.length;

    if (strikes > this.policy.maxRestartsInWindow) {
      this.circuitOpen = true;
      return { action: "openCircuit", strikes, reason: "tooManyExits" };
    }

    // First exit restarts immediately (lazily, on the next operation); later ones back off so a
    // crash loop cannot spin.
    return { action: "restart", delayMs: strikes === 1 ? 0 : this.policy.restartDelayMs, strikes };
  }

  /** Should this generation be refused because it previously took the host down? */
  isQuarantined(generation: string): boolean {
    return this.quarantined.has(generation);
  }

  /** Operator action after the cause has been addressed (health check / rebuild). */
  reset(): void {
    this.exitTimestamps = [];
    this.circuitOpen = false;
  }
}
