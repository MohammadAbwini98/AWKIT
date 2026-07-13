/**
 * Operation limiters (Concurrency Capacity plan — Phase A6).
 *
 * Independent, configurable caps on how many of each EXPENSIVE operation may run at once ACROSS all
 * instances — browser launches, context creations, navigations, downloads, screenshots. Allowing 16
 * active instances does not mean allowing all 16 to launch a browser or navigate simultaneously (the
 * guide's "stagger expensive operations"): each such spike causes a much larger transient resource cost
 * than steady-state execution.
 *
 * Each limiter is a counting Semaphore; `run()` acquires it, runs the operation, and releases in
 * `finally` (short-held — never across a wait/handoff). Reconfiguring swaps the semaphore instance, so
 * in-flight operations finish on their original instance (a brief resize over-shoot is harmless — there
 * is no shared permit count to corrupt). Framework-agnostic; no machine value is hardcoded.
 */
import { Semaphore } from "./Semaphore";

export type OperationKind = "browserLaunch" | "contextCreation" | "navigation" | "download" | "screenshot";

export interface OperationLimitsConfig {
  browserLaunch: number;
  contextCreation: number;
  navigation: number;
  download: number;
  screenshot: number;
}

const KINDS: OperationKind[] = ["browserLaunch", "contextCreation", "navigation", "download", "screenshot"];

export class OperationLimiters {
  private caps: OperationLimitsConfig;
  private sems: Record<OperationKind, Semaphore>;

  constructor(config: OperationLimitsConfig) {
    this.caps = { ...config };
    this.sems = {
      browserLaunch: new Semaphore(Math.max(1, config.browserLaunch)),
      contextCreation: new Semaphore(Math.max(1, config.contextCreation)),
      navigation: new Semaphore(Math.max(1, config.navigation)),
      download: new Semaphore(Math.max(1, config.download)),
      screenshot: new Semaphore(Math.max(1, config.screenshot))
    };
  }

  /** Run `fn` while holding a permit for `kind`; the permit is released in `finally` (short-held). */
  run<T>(kind: OperationKind, fn: () => Promise<T>): Promise<T> {
    return this.sems[kind].withPermit(fn);
  }

  /**
   * Apply updated caps (from Settings/Auto/Sequential). Only kinds whose cap actually changed are
   * swapped; in-flight `run()` calls keep their original semaphore, so this is safe at any time.
   */
  configure(partial: Partial<OperationLimitsConfig>): void {
    for (const kind of KINDS) {
      const next = partial[kind];
      if (typeof next === "number" && next >= 1 && next !== this.caps[kind]) {
        this.caps[kind] = next;
        this.sems[kind] = new Semaphore(next);
      }
    }
  }

  snapshot(): OperationLimitsConfig {
    return { ...this.caps };
  }
}
