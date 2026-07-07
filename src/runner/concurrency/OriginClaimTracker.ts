/**
 * Dynamic origin-claim re-evaluation. An instance dispatches holding `origin:<host>` for its
 * initial target; when the page navigates to a DIFFERENT origin mid-flow, the tracker acquires
 * the new origin's semaphore (bounded wait — no deadlock: timeout fails the step with a clear,
 * retryable message) before releasing the old one, and logs the transition. Same-origin
 * navigation is a no-op (no lock churn). Disabled via AWKIT_DYNAMIC_ORIGIN_CLAIMS=0.
 */
import { resourceKey } from "./ResourceKey";
import type { LeaseToken, ResourceLockManager } from "./ResourceLockManager";
import type { DurableLease, DurableLockStore } from "../store/DurableLockStore";

export interface OriginTransition {
  from?: string;
  to: string;
  at: string;
}

export class OriginClaimTimeoutError extends Error {
  constructor(host: string, timeoutMs: number) {
    super(
      `Timed out after ${timeoutMs}ms waiting for origin capacity on "${host}" ` +
        `(origin:${host} semaphore is saturated). The step can be retried when capacity frees up.`
    );
    this.name = "OriginClaimTimeoutError";
  }
}

export class OriginClaimTracker {
  private currentHost: string | undefined;
  private currentToken: LeaseToken | undefined;
  private currentDurable: DurableLease | undefined;
  readonly transitions: OriginTransition[] = [];

  constructor(
    private readonly ownerId: string,
    private readonly locks: ResourceLockManager,
    private readonly options: {
      enabled: boolean;
      timeoutMs: number;
      durable?: DurableLockStore;
      log?: (message: string) => void;
    }
  ) {}

  get origin(): string | undefined {
    return this.currentHost;
  }

  /** Adopt the claim acquired at dispatch time (token ownership stays with the engine). */
  seed(host: string | undefined, token?: LeaseToken, durable?: DurableLease): void {
    this.currentHost = host;
    this.currentToken = token;
    this.currentDurable = durable;
  }

  /**
   * Called after navigation-capable steps with the page's current hostname. Same origin → no-op.
   * New origin → acquire new semaphore (in-memory + durable when configured) under the timeout,
   * then release the old claim. Throws `OriginClaimTimeoutError` when the new origin stays
   * saturated — the step fails safely and can be retried.
   */
  async ensureOrigin(host: string | undefined): Promise<void> {
    if (!this.options.enabled || !host || host === this.currentHost) return;

    const key = resourceKey("origin", host.toLowerCase());
    const deadline = Date.now() + this.options.timeoutMs;

    // In-memory semaphore first (fast, same-process fairness)...
    let newToken: LeaseToken | undefined;
    try {
      const tokens = await this.locks.acquireMany(this.ownerId, [{ key, mode: "semaphore", reason: "dynamic origin claim" }], {
        waitTimeoutMs: this.options.timeoutMs
      });
      newToken = tokens[0];
    } catch {
      throw new OriginClaimTimeoutError(host, this.options.timeoutMs);
    }

    // ...then the durable cross-process semaphore (bounded polling until the same deadline).
    let newDurable: DurableLease | undefined;
    if (this.options.durable) {
      for (;;) {
        newDurable = (await this.options.durable.acquireSemaphore(this.ownerId, key, { reason: "dynamic origin claim" }).catch(() => null)) ?? undefined;
        if (newDurable) break;
        if (Date.now() >= deadline) {
          this.locks.releaseMany([newToken]);
          throw new OriginClaimTimeoutError(host, this.options.timeoutMs);
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    // New origin secured — release the old claim and record the transition.
    const previous = this.currentHost;
    if (this.currentToken) this.locks.releaseMany([this.currentToken]);
    if (this.currentDurable) await this.currentDurable.release().catch(() => undefined);
    this.currentHost = host;
    this.currentToken = newToken;
    this.currentDurable = newDurable;
    const transition: OriginTransition = { from: previous, to: host, at: new Date().toISOString() };
    this.transitions.push(transition);
    this.options.log?.(`[origin-claim] ${previous ?? "(none)"} → ${host} (claim moved to origin:${host}).`);
  }

  /** Release whatever the tracker currently holds (run end; engine cleanup is the backstop). */
  async release(): Promise<void> {
    if (this.currentToken) {
      try {
        this.locks.releaseMany([this.currentToken]);
      } catch {
        /* swept */
      }
      this.currentToken = undefined;
    }
    if (this.currentDurable) {
      await this.currentDurable.release().catch(() => undefined);
      this.currentDurable = undefined;
    }
    this.currentHost = undefined;
  }
}
