/**
 * Exclusive in-process locking for persistent browser profiles (userDataDir).
 *
 * Production rule enforced here in code: two active browser processes/contexts must never share
 * the same persistent profile. Chrome's own on-disk `Singleton*` artifacts only protect against
 * an already-running browser — they do not stop two Playwright launches racing in the same
 * process. This manager closes that gap with an exclusive `profile:<normalized dir>` lock held
 * for the lifetime of the launched runtime.
 */
import { profileKey } from "@src/runner/concurrency/ResourceKey";
import {
  globalResourceLocks,
  LockUnavailableError,
  type LeaseToken,
  type ResourceLockManager
} from "@src/runner/concurrency/ResourceLockManager";
import { getDurableLockStore } from "@src/runner/store/DurableLockConfig";

export class ProfileLockedError extends Error {
  constructor(userDataDir: string, holders: string[]) {
    super(
      `The saved session profile is already in use by another running instance in this app ` +
        `(profile: ${userDataDir}; held by: ${holders.join(", ") || "unknown"}). ` +
        `Wait for that run to finish or stop it, then try again.`
    );
    this.name = "ProfileLockedError";
  }
}

export interface ProfileLease {
  userDataDir: string;
  token: LeaseToken;
  release(): void;
}

export class ProfileLockManager {
  constructor(private readonly locks: ResourceLockManager = globalResourceLocks) {}

  /**
   * Acquire the exclusive profile lock or throw `ProfileLockedError`. The returned lease must be
   * released in the browser runtime's close path (`finally`), never dropped silently.
   */
  acquire(ownerId: string, userDataDir: string, reason?: string): ProfileLease {
    const key = profileKey(userDataDir);
    const token = this.locks.tryAcquire(ownerId, { key, mode: "exclusive", reason: reason ?? "persistentContext launch" });
    if (!token) throw new ProfileLockedError(userDataDir, this.locks.holdersOf(key));

    let released = false;
    return {
      userDataDir,
      token,
      release: () => {
        if (released) return;
        released = true;
        try {
          this.locks.releaseMany([token]);
        } catch {
          // Swept as stale — nothing left to release.
        }
      }
    };
  }

  /**
   * Acquire the profile lock in-memory AND (when configured) in the durable cross-process lock
   * store, so a second AWKIT app instance cannot open the same profile. The returned lease
   * releases both. Throws `ProfileLockedError` either way.
   */
  async acquireDurable(ownerId: string, userDataDir: string, reason?: string): Promise<ProfileLease> {
    const memoryLease = this.acquire(ownerId, userDataDir, reason);
    const durable = getDurableLockStore();
    if (!durable) return memoryLease;

    try {
      const durableLease = await durable.acquireExclusive(ownerId, profileKey(userDataDir), {
        reason: reason ?? "persistentContext launch"
      });
      if (!durableLease) {
        memoryLease.release();
        throw new ProfileLockedError(userDataDir, ["another AWKIT process (durable lock)"]);
      }
      let released = false;
      return {
        userDataDir,
        token: memoryLease.token,
        release: () => {
          if (released) return;
          released = true;
          memoryLease.release();
          void durableLease.release();
        }
      };
    } catch (error) {
      if (error instanceof ProfileLockedError) throw error;
      // Durable store I/O problems must not strand the run — fall back to in-memory only.
      return memoryLease;
    }
  }

  isLocked(userDataDir: string): boolean {
    return this.locks.isHeld(profileKey(userDataDir));
  }

  holders(userDataDir: string): string[] {
    return this.locks.holdersOf(profileKey(userDataDir));
  }

  /** Crash cleanup: release every profile lease held by an owner (e.g. a failed instance). */
  releaseOwner(ownerId: string): number {
    return this.locks.releaseOwner(ownerId);
  }
}

/** Process-wide profile lock manager used by BrowserContextFactory. */
export const globalProfileLocks = new ProfileLockManager();

export { LockUnavailableError };
