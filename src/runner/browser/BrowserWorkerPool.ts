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
  private readonly slotSemaphore: Semaphore;
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

  /** Non-blocking: grab a browser slot or return null (caller keeps the instance queued). */
  tryAcquireSlot(instanceId: string): BrowserWorkerSlot | null {
    if (!this.slotSemaphore.tryAcquire()) {
      this.totalRejected += 1;
      return null;
    }
    return this.createSlot(instanceId);
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
   * Release the slot when the instance's browser runtime is fully closed. Safe to call twice.
   * Browser processes die with their instance, so "recycling" here means the slot's capacity
   * returns to the semaphore and its health/crash history feeds the backpressure window.
   */
  releaseSlot(slot: BrowserWorkerSlot): void {
    if (slot.released) return;
    slot.released = true;
    this.slots.delete(slot.workerId);
    this.totalReleased += 1;
    this.slotSemaphore.release();
  }

  recentCrashCount(now = Date.now()): number {
    const cutoff = now - this.limits.crashWindowMs;
    while (this.crashTimestamps.length && this.crashTimestamps[0] < cutoff) this.crashTimestamps.shift();
    return this.crashTimestamps.length;
  }

  snapshot(): BrowserPoolSnapshot {
    return {
      activeSlots: this.slots.size,
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

  private createSlot(instanceId: string): BrowserWorkerSlot {
    const slot: BrowserWorkerSlot = {
      workerId: `bw-${++this.slotCounter}`,
      instanceId,
      bornAt: Date.now(),
      generation: 0,
      activeContexts: 0,
      activePages: 0,
      crashes: 0,
      unhealthy: false,
      released: false
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
