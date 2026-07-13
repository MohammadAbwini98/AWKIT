/**
 * Bounded browser worker pool. In AWKIT each running instance owns exactly one browser runtime
 * (its lifecycle — including mid-run Reuse Session swaps — is managed by PlaywrightRunner), so
 * the pool manages **slots**: it caps how many browser processes may be alive on the host,
 * tracks contexts/pages/health per slot, records crash/disconnect events for backpressure, and
 * refuses (queues) work when saturated instead of letting Chromium processes pile up.
 */
import type { Browser, BrowserContext, Page } from "playwright";
import { Semaphore } from "../concurrency/Semaphore";
import { loadConcurrencyLimits, type ConcurrencyLimits } from "../concurrency/ConcurrencyConfig";

export interface BrowserWorkerSlot {
  workerId: string;
  instanceId: string;
  bornAt: number;
  generation: number;
  activeContexts: number;
  activePages: number;
  crashes: number;
  unhealthy: boolean;
  unhealthyReason?: string;
  released: boolean;
  /** Generation the runner has announced it will intentionally close; its disconnect is not a crash. */
  expectedCloseGeneration?: number;
  /**
   * A "context slot" (Phase A5): a shared-eligible instance runs as one isolated context on a shared
   * browser owned by the SharedBrowserPool, so it does NOT consume a whole-browser semaphore permit and
   * is not counted toward pool saturation. Its lifecycle tracking (contexts/pages/health) is otherwise
   * identical to a real browser slot.
   */
  virtual?: boolean;
}

export interface BrowserPoolSnapshot {
  activeSlots: number;
  maxSlots: number;
  pendingWaiters: number;
  totalAcquired: number;
  totalReleased: number;
  totalRejected: number;
  recentCrashes: number;
  slots: Array<Pick<BrowserWorkerSlot, "workerId" | "instanceId" | "bornAt" | "activeContexts" | "activePages" | "crashes" | "unhealthy" | "unhealthyReason">>;
}

export class BrowserPoolSaturatedError extends Error {
  constructor(active: number, max: number) {
    super(`Browser pool is saturated (${active}/${max} browser slots in use). The run stays queued until a slot frees up.`);
    this.name = "BrowserPoolSaturatedError";
  }
}

export class BrowserWorkerPool {
  private readonly limits: ConcurrencyLimits;
  private slotSemaphore: Semaphore;
  private readonly slots = new Map<string, BrowserWorkerSlot>();
  private readonly crashTimestamps: number[] = [];
  private slotCounter = 0;
  private totalAcquired = 0;
  private totalReleased = 0;
  private totalRejected = 0;

  constructor(limits?: Partial<ConcurrencyLimits>) {
    this.limits = loadConcurrencyLimits(limits);
    this.slotSemaphore = new Semaphore(this.limits.maxBrowsersPerHost);
  }

  get concurrencyLimits(): ConcurrencyLimits {
    return this.limits;
  }

  /**
   * Apply user-configured concurrency caps (from Settings) over the env/default limits. The shared
   * `limits` object is mutated in place so the BackpressureController (which holds the same reference)
   * sees the change live — `maxActiveFlows` and other soft caps take effect immediately for the next
   * admission decision. The browser-slot `Semaphore` capacity is fixed at construction and can only be
   * safely rebuilt when NO slot is currently held (an in-flight release into a resized semaphore would
   * corrupt its permit count); while the pool is busy a `maxBrowsersPerHost` change is deferred so
   * `limits.maxBrowsersPerHost` never drifts from the live semaphore capacity (keeping the gauge honest).
   */
  reconfigure(overrides: Partial<ConcurrencyLimits>): void {
    const { maxBrowsersPerHost, ...soft } = overrides;
    Object.assign(this.limits, soft);
    if (maxBrowsersPerHost !== undefined && maxBrowsersPerHost >= 1 && this.slots.size === 0) {
      this.limits.maxBrowsersPerHost = maxBrowsersPerHost;
      this.slotSemaphore = new Semaphore(maxBrowsersPerHost);
    }
  }

  /** Non-blocking: grab a browser slot or return null (caller keeps the instance queued). */
  tryAcquireSlot(instanceId: string): BrowserWorkerSlot | null {
    if (!this.slotSemaphore.tryAcquire()) {
      this.totalRejected += 1;
      return null;
    }
    return this.createSlot(instanceId);
  }

  /**
   * Acquire a **context slot** for a shared-eligible instance (Phase A5). Unlike `tryAcquireSlot`, this
   * does not consume a browser-semaphore permit — the shared instance runs as one isolated context on a
   * pooled browser, so concurrency is bounded by `maxActiveFlows` (and the SharedBrowserPool's own
   * browser cap), not by `maxBrowsersPerHost`. Always succeeds.
   */
  acquireContextSlot(instanceId: string): BrowserWorkerSlot {
    return this.createSlot(instanceId, true);
  }

  /** Blocking acquire with timeout — throws BrowserPoolSaturatedError on timeout. */
  async acquireSlot(instanceId: string, timeoutMs = 0): Promise<BrowserWorkerSlot> {
    try {
      await this.slotSemaphore.acquire(1, timeoutMs > 0 ? timeoutMs : undefined);
    } catch {
      this.totalRejected += 1;
      throw new BrowserPoolSaturatedError(this.slots.size, this.limits.maxBrowsersPerHost);
    }
    return this.createSlot(instanceId);
  }

  /**
   * Wire the launched runtime into the slot: disconnect/crash events mark the slot unhealthy
   * and feed the crash-rate window. A mid-run swap (Reuse Session) re-registers with a higher
   * generation; events from older generations are ignored.
   */
  registerRuntime(slot: BrowserWorkerSlot, runtime: { browser?: Browser | null; context: BrowserContext }, generation = 1): void {
    if (slot.released) return;
    slot.generation = generation;
    slot.activeContexts = 1;
    slot.activePages = runtime.context.pages().length;

    runtime.browser?.on("disconnected", () => {
      if (slot.released || slot.generation !== generation) return;
      // The runner closes the browser itself at end-of-run / cancel / Reuse Session swap. That
      // intentional teardown also emits "disconnected" — it must NOT inflate the crash-rate window
      // (which would falsely trip backpressure and stall the rest of the queue). Only an
      // *unexpected* disconnect of the current generation is a real crash.
      if (slot.expectedCloseGeneration === generation) return;
      this.markUnhealthy(slot, "browser disconnected");
    });
    runtime.context.on("close", () => {
      if (slot.released || slot.generation !== generation) return;
      slot.activeContexts = Math.max(0, slot.activeContexts - 1);
    });
    runtime.context.on("page", (page: Page) => {
      if (slot.released || slot.generation !== generation) return;
      slot.activePages += 1;
      page.on("close", () => {
        slot.activePages = Math.max(0, slot.activePages - 1);
      });
      page.on("crash", () => {
        if (slot.released || slot.generation !== generation) return;
        this.recordCrash(slot, "page crashed");
      });
    });
  }

  /** True when this slot may open another page (parallel isolated branch budget). */
  canOpenPage(slot: BrowserWorkerSlot): boolean {
    return !slot.released && !slot.unhealthy && slot.activePages < this.limits.maxPagesPerContext * Math.max(1, slot.activeContexts);
  }

  markUnhealthy(slot: BrowserWorkerSlot, reason: string): void {
    if (slot.unhealthy) return;
    slot.unhealthy = true;
    slot.unhealthyReason = reason;
    this.recordCrash(slot, reason);
  }

  /**
   * The runner is about to intentionally close this generation's runtime (end-of-run cleanup, hard
   * cancel, or Reuse Session swap of the old generation). Records that the imminent "disconnected"
   * event is an expected teardown, not a crash, so it is excluded from the crash-rate backpressure
   * window. Generation-scoped so a later generation's real crash is still counted.
   */
  markExpectedClose(slot: BrowserWorkerSlot, generation: number): void {
    slot.expectedCloseGeneration = generation;
  }

  /**
   * Release the slot when the instance's browser runtime is fully closed. Safe to call twice.
   * Browser processes die with their instance, so "recycling" here means the slot's capacity
   * returns to the semaphore and its health/crash history feeds the backpressure window.
   */
  releaseSlot(slot: BrowserWorkerSlot): void {
    if (slot.released) return;
    slot.released = true;
    this.slots.delete(slot.workerId);
    this.totalReleased += 1;
    // Context slots never held a browser-semaphore permit, so releasing one must not return a permit
    // (that would corrupt the semaphore's count and let more real browsers launch than allowed).
    if (!slot.virtual) this.slotSemaphore.release();
  }

  recentCrashCount(now = Date.now()): number {
    const cutoff = now - this.limits.crashWindowMs;
    while (this.crashTimestamps.length && this.crashTimestamps[0] < cutoff) this.crashTimestamps.shift();
    return this.crashTimestamps.length;
  }

  snapshot(): BrowserPoolSnapshot {
    // Only real browser slots count toward pool saturation (maxBrowsersPerHost). Context slots (shared
    // instances) are bounded by maxActiveFlows + the SharedBrowserPool's own browser cap instead.
    const realSlots = [...this.slots.values()].filter((slot) => !slot.virtual).length;
    return {
      activeSlots: realSlots,
      maxSlots: this.limits.maxBrowsersPerHost,
      pendingWaiters: this.slotSemaphore.pendingWaiters,
      totalAcquired: this.totalAcquired,
      totalReleased: this.totalReleased,
      totalRejected: this.totalRejected,
      recentCrashes: this.recentCrashCount(),
      slots: [...this.slots.values()].map((slot) => ({
        workerId: slot.workerId,
        instanceId: slot.instanceId,
        bornAt: slot.bornAt,
        activeContexts: slot.activeContexts,
        activePages: slot.activePages,
        crashes: slot.crashes,
        unhealthy: slot.unhealthy,
        unhealthyReason: slot.unhealthyReason
      }))
    };
  }

  activeContexts(): number {
    return [...this.slots.values()].reduce((sum, slot) => sum + slot.activeContexts, 0);
  }

  activePages(): number {
    return [...this.slots.values()].reduce((sum, slot) => sum + slot.activePages, 0);
  }

  private createSlot(instanceId: string, virtual = false): BrowserWorkerSlot {
    const slot: BrowserWorkerSlot = {
      workerId: `bw-${++this.slotCounter}`,
      instanceId,
      bornAt: Date.now(),
      generation: 0,
      activeContexts: 0,
      activePages: 0,
      crashes: 0,
      unhealthy: false,
      released: false,
      virtual
    };
    this.slots.set(slot.workerId, slot);
    this.totalAcquired += 1;
    return slot;
  }

  private recordCrash(slot: BrowserWorkerSlot, reason: string): void {
    slot.crashes += 1;
    slot.unhealthy = true;
    slot.unhealthyReason = slot.unhealthyReason ?? reason;
    this.crashTimestamps.push(Date.now());
  }
}
