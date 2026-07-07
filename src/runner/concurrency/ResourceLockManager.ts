/**
 * Application-level lock manager for schedulable resources (profiles, download dirs, accounts,
 * origins, browser slots). Supports exclusive, shared-read, and semaphore(N) modes, TTL leases
 * with renewal, fencing tokens (monotonic versions), atomic multi-acquire (all-or-nothing),
 * stale-lock sweep, and a debug snapshot.
 *
 * In-memory implementation for the single Electron main process; the `LockStore` interface keeps
 * a future durable adapter (e.g. SQLite/Postgres) possible without touching call sites.
 */
import { defaultSemaphoreCapacities } from "./ConcurrencyConfig";
import type { LockMode, ResourceClaim } from "./ResourceKey";

export interface LeaseToken {
  key: string;
  mode: LockMode;
  units: number;
  ownerId: string;
  /** Monotonic fencing version for this key: stale owners (post-expiry) are rejected on renew/release. */
  version: number;
  acquiredAt: number;
  expiresAt?: number;
  reason?: string;
}

export interface LockSnapshotEntry {
  key: string;
  mode: LockMode;
  holders: Array<{ ownerId: string; units: number; version: number; acquiredAt: number; expiresAt?: number; reason?: string }>;
  /** Semaphore capacity when the key was first claimed in semaphore mode. */
  capacity?: number;
}

export class LockUnavailableError extends Error {
  constructor(
    public readonly key: string,
    public readonly ownerId: string,
    holders: string[]
  ) {
    super(`Resource lock unavailable: ${key} (requested by ${ownerId}; held by ${holders.join(", ") || "unknown"}).`);
    this.name = "LockUnavailableError";
  }
}

export class StaleLeaseError extends Error {
  constructor(key: string, ownerId: string) {
    super(`Lease on ${key} owned by ${ownerId} is stale (expired or superseded by a newer fencing version).`);
    this.name = "StaleLeaseError";
  }
}

interface KeyState {
  mode: LockMode;
  capacity?: number;
  nextVersion: number;
  holders: Map<string, LeaseToken>;
}

export interface LockStore {
  tryAcquireMany(ownerId: string, claims: ResourceClaim[], defaultTtlMs?: number): LeaseToken[] | null;
  renewMany(tokens: LeaseToken[], ttlMs?: number): void;
  releaseMany(tokens: LeaseToken[]): void;
  releaseOwner(ownerId: string): number;
  cleanupStale(now?: number): LeaseToken[];
  snapshot(): LockSnapshotEntry[];
}

export class ResourceLockManager implements LockStore {
  private readonly keys = new Map<string, KeyState>();

  /** Default semaphore capacity when a semaphore claim doesn't specify one via `unitsCapacity`. */
  constructor(private readonly semaphoreCapacities: Record<string, number> = {}, private readonly defaultSemaphoreCapacity = 4) {}

  tryAcquire(ownerId: string, claim: ResourceClaim, defaultTtlMs?: number): LeaseToken | null {
    const tokens = this.tryAcquireMany(ownerId, [claim], defaultTtlMs);
    return tokens ? tokens[0] : null;
  }

  /** Atomic all-or-nothing multi-acquire: either every claim is granted or none are. */
  tryAcquireMany(ownerId: string, claims: ResourceClaim[], defaultTtlMs?: number): LeaseToken[] | null {
    this.cleanupStale();
    // Feasibility pass first so a partial grant never leaks.
    for (const claim of claims) {
      if (!this.canGrant(ownerId, claim)) return null;
    }
    return claims.map((claim) => this.grant(ownerId, claim, defaultTtlMs));
  }

  /** Acquire with FIFO-less bounded polling (simple wait loop; callers are coarse-grained). */
  async acquireMany(ownerId: string, claims: ResourceClaim[], options?: { waitTimeoutMs?: number; pollMs?: number; ttlMs?: number }): Promise<LeaseToken[]> {
    const waitTimeoutMs = options?.waitTimeoutMs ?? 0;
    const pollMs = Math.max(25, options?.pollMs ?? 100);
    const deadline = Date.now() + waitTimeoutMs;

    for (;;) {
      const tokens = this.tryAcquireMany(ownerId, claims, options?.ttlMs);
      if (tokens) return tokens;
      if (Date.now() >= deadline) {
        const blocked = claims.find((claim) => !this.canGrant(ownerId, claim));
        const holders = blocked ? this.holdersOf(String(blocked.key)) : [];
        throw new LockUnavailableError(String(blocked?.key ?? claims[0]?.key), ownerId, holders);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  /** Runs `fn` holding the claims; always releases in `finally`. */
  async withLocks<T>(
    ownerId: string,
    claims: ResourceClaim[],
    fn: (tokens: LeaseToken[]) => Promise<T>,
    options?: { waitTimeoutMs?: number; ttlMs?: number; renewEveryMs?: number }
  ): Promise<T> {
    const tokens = await this.acquireMany(ownerId, claims, options);
    let renewTimer: ReturnType<typeof setInterval> | undefined;
    if (options?.ttlMs && options.ttlMs > 0) {
      const renewEveryMs = Math.max(250, options.renewEveryMs ?? Math.floor(options.ttlMs / 3));
      renewTimer = setInterval(() => {
        try {
          this.renewMany(tokens, options.ttlMs);
        } catch {
          // Stale lease — stop renewing; the holder will fail on release with a clear error.
          if (renewTimer) clearInterval(renewTimer);
        }
      }, renewEveryMs);
    }
    try {
      return await fn(tokens);
    } finally {
      if (renewTimer) clearInterval(renewTimer);
      try {
        this.releaseMany(tokens);
      } catch {
        // Already swept as stale — safe to ignore on the release path.
      }
    }
  }

  renewMany(tokens: LeaseToken[], ttlMs?: number): void {
    const now = Date.now();
    for (const token of tokens) {
      const holder = this.liveHolder(token);
      if (!holder) throw new StaleLeaseError(token.key, token.ownerId);
      if (ttlMs && ttlMs > 0) holder.expiresAt = now + ttlMs;
      token.expiresAt = holder.expiresAt;
    }
  }

  releaseMany(tokens: LeaseToken[]): void {
    for (const token of tokens) {
      const state = this.keys.get(token.key);
      if (!state) continue;
      const holder = state.holders.get(token.ownerId);
      // Fencing: a release from a superseded (older-version) owner is ignored, not honored.
      if (!holder || holder.version !== token.version) continue;
      state.holders.delete(token.ownerId);
      if (state.holders.size === 0) this.keys.delete(token.key);
    }
  }

  /** Releases every lease held by an owner (crash cleanup). Returns the number released. */
  releaseOwner(ownerId: string): number {
    let released = 0;
    for (const [key, state] of [...this.keys.entries()]) {
      if (state.holders.delete(ownerId)) {
        released += 1;
        if (state.holders.size === 0) this.keys.delete(key);
      }
    }
    return released;
  }

  /** Removes expired leases; returns them so callers can log exactly what was swept. */
  cleanupStale(now = Date.now()): LeaseToken[] {
    const swept: LeaseToken[] = [];
    for (const [key, state] of [...this.keys.entries()]) {
      for (const [ownerId, holder] of [...state.holders.entries()]) {
        if (holder.expiresAt !== undefined && holder.expiresAt <= now) {
          state.holders.delete(ownerId);
          swept.push(holder);
        }
      }
      if (state.holders.size === 0) this.keys.delete(key);
    }
    return swept;
  }

  isHeld(key: string): boolean {
    this.cleanupStale();
    return (this.keys.get(key)?.holders.size ?? 0) > 0;
  }

  holdersOf(key: string): string[] {
    return [...(this.keys.get(key)?.holders.keys() ?? [])];
  }

  /** Lock table view. `sweepFirst=false` keeps expired-but-unswept leases visible (diagnostics). */
  snapshot(sweepFirst = true): LockSnapshotEntry[] {
    if (sweepFirst) this.cleanupStale();
    return [...this.keys.entries()].map(([key, state]) => ({
      key,
      mode: state.mode,
      capacity: state.capacity,
      holders: [...state.holders.values()].map((holder) => ({
        ownerId: holder.ownerId,
        units: holder.units,
        version: holder.version,
        acquiredAt: holder.acquiredAt,
        expiresAt: holder.expiresAt,
        reason: holder.reason
      }))
    }));
  }

  private canGrant(ownerId: string, claim: ResourceClaim): boolean {
    const key = String(claim.key);
    const state = this.keys.get(key);
    if (!state) return true;
    if (state.mode !== claim.mode) return false; // mixed modes on one key are never granted
    if (state.holders.has(ownerId)) return false; // no re-entrant double-acquire

    switch (claim.mode) {
      case "exclusive":
        return state.holders.size === 0;
      case "shared":
        return true;
      case "semaphore": {
        const capacity = state.capacity ?? this.capacityFor(key);
        const used = [...state.holders.values()].reduce((sum, holder) => sum + holder.units, 0);
        return used + (claim.units ?? 1) <= capacity;
      }
    }
  }

  private grant(ownerId: string, claim: ResourceClaim, defaultTtlMs?: number): LeaseToken {
    const key = String(claim.key);
    let state = this.keys.get(key);
    if (!state) {
      state = {
        mode: claim.mode,
        capacity: claim.mode === "semaphore" ? this.capacityFor(key) : undefined,
        nextVersion: 1,
        holders: new Map()
      };
      this.keys.set(key, state);
    }
    const ttlMs = claim.ttlMs ?? defaultTtlMs;
    const now = Date.now();
    const token: LeaseToken = {
      key,
      mode: claim.mode,
      units: claim.units ?? 1,
      ownerId,
      version: state.nextVersion++,
      acquiredAt: now,
      expiresAt: ttlMs && ttlMs > 0 ? now + ttlMs : undefined,
      reason: claim.reason
    };
    state.holders.set(ownerId, token);
    return token;
  }

  private liveHolder(token: LeaseToken): LeaseToken | undefined {
    const holder = this.keys.get(token.key)?.holders.get(token.ownerId);
    if (!holder || holder.version !== token.version) return undefined;
    if (holder.expiresAt !== undefined && holder.expiresAt <= Date.now()) return undefined;
    return holder;
  }

  /** Capacity resolution: exact key → kind prefix (`<kind>:*`) → default. */
  private capacityFor(key: string): number {
    const exact = this.semaphoreCapacities[key];
    if (exact !== undefined) return exact;
    const kind = key.slice(0, key.indexOf(":"));
    const byKind = this.semaphoreCapacities[`${kind}:*`];
    return byKind ?? this.defaultSemaphoreCapacity;
  }
}

/**
 * Process-wide lock manager shared by profile locking, dispatch claims (origin/account
 * semaphores from `AWKIT_MAX_PER_ORIGIN` / `AWKIT_MAX_PER_ACCOUNT`), and diagnostics.
 */
export const globalResourceLocks = new ResourceLockManager(defaultSemaphoreCapacities());
