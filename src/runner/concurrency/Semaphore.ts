/**
 * Counting semaphore with FIFO waiters and optional acquire timeout. Used for bounded
 * capacities (browser slots, per-origin concurrency, parallel-branch page budgets).
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<{
    units: number;
    resolve: () => void;
    reject: (error: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(public readonly capacity: number) {
    if (!Number.isFinite(capacity) || capacity < 1) {
      throw new Error(`Semaphore capacity must be a positive number (got ${capacity}).`);
    }
    this.available = capacity;
  }

  get availableUnits(): number {
    return this.available;
  }

  get pendingWaiters(): number {
    return this.waiters.length;
  }

  /** Non-blocking acquire; returns false when capacity is unavailable. */
  tryAcquire(units = 1): boolean {
    this.assertUnits(units);
    if (this.available < units) return false;
    this.available -= units;
    return true;
  }

  /** Waits (FIFO) for capacity; rejects after `timeoutMs` when provided. */
  async acquire(units = 1, timeoutMs?: number): Promise<void> {
    this.assertUnits(units);
    if (this.waiters.length === 0 && this.available >= units) {
      this.available -= units;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiter = { units, resolve, reject, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      if (timeoutMs !== undefined && timeoutMs >= 0) {
        waiter.timer = setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error(`Semaphore acquire timed out after ${timeoutMs}ms (requested ${units}, available ${this.available}).`));
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  release(units = 1): void {
    this.assertUnits(units);
    this.available = Math.min(this.capacity, this.available + units);
    this.drain();
  }

  /** Runs `fn` inside an acquire/release pair; release happens in `finally`. */
  async withPermit<T>(fn: () => Promise<T>, units = 1, timeoutMs?: number): Promise<T> {
    await this.acquire(units, timeoutMs);
    try {
      return await fn();
    } finally {
      this.release(units);
    }
  }

  private drain(): void {
    while (this.waiters.length > 0 && this.available >= this.waiters[0].units) {
      const waiter = this.waiters.shift()!;
      if (waiter.timer) clearTimeout(waiter.timer);
      this.available -= waiter.units;
      waiter.resolve();
    }
  }

  private assertUnits(units: number): void {
    if (!Number.isFinite(units) || units < 1 || units > this.capacity) {
      throw new Error(`Invalid semaphore units ${units} (capacity ${this.capacity}).`);
    }
  }
}
