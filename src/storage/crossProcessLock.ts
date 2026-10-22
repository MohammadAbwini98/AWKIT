/**
 * A cross-process exclusive lock for one storage directory (Phase N, N6.3 / awkit-vra.15.3).
 *
 * ── Why not `DurableLockStore` ───────────────────────────────────────────────────────────────
 *
 * `src/runner/store/DurableLockStore.ts` stays as the runner's lock, unchanged. It is not safe for
 * N6's shared flow storage: it treats an expired TTL as stale even while the holder is alive, creates
 * the holder file with `wx` before writing its content (so a competitor can read it empty and
 * quarantine a live lock), recovers by check-then-rename (two recoverers can move a successor's
 * lock), fences with wall-clock versions, and retries contention after a sleep. See KNOWN_ISSUES.
 *
 * ── What this lock guarantees ────────────────────────────────────────────────────────────────
 *
 *  - ATOMIC, COMPLETE OWNERSHIP. The holder writes its record to a private temporary file and
 *    hard-links it to the lock path. `link` fails with EEXIST when the lock exists, so the lock file
 *    appears only once, already complete; there is no empty-file window.
 *  - NO TAKEOVER OF A LIVE HOLDER. There is no TTL. A holder is replaced only when its process is
 *    provably gone (`process.kill(pid, 0)` reports ESRCH), or when it is this very process and the
 *    owner id is not one this process is acquiring or holding.
 *  - ONE RECOVERER PER DEAD OWNER. Recovery first claims `<name>.claim.<deadOwner>.<n>` with the same
 *    atomic link. Only the claim winner may remove the lock, and only after re-reading that it still
 *    holds the dead owner's id. Owner ids are random and never reused, so nobody else can remove that
 *    lock in the meantime. A dead claimant is superseded by claim n+1, up to a bound.
 *  - OWNER-VERIFIED RELEASE AND FENCING. Release and `assertHeld` re-read the lock and require the
 *    caller's owner id; a mismatch is the typed `lock-lost`. Callers check `assertHeld()` immediately
 *    before each protected write. A monotonic fence counter, written only by the holder, numbers the
 *    grants for observability; safety rests on owner ids, not clocks.
 *  - NO SLEEPS, NO SILENT RETRIES. A live holder is waited for with a directory watch, bounded by a
 *    deadline and an attempt cap. Every failure is a typed `CrossProcessLockError`.
 *  - NO RE-ENTRANCY. A nested acquisition of the same lock in the same async context is refused with
 *    `lock-reentrant` instead of deadlocking.
 *
 * Residual: a dead holder whose pid has been reused by another live process looks alive, so its lock
 * cannot be recovered until that process exits. That fails closed (`lock-timeout`), never unsafe.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { realpathSync, watch, type FSWatcher } from "node:fs";
import { link, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { replaceFileAtomically } from "./atomicReplace";

export type CrossProcessLockErrorCode =
  | "lock-timeout"
  | "lock-reentrant"
  | "lock-corrupt"
  | "lock-lost"
  | "lock-recovery-exhausted"
  | "lock-unsupported";

export class CrossProcessLockError extends Error {
  readonly code: CrossProcessLockErrorCode;

  constructor(code: CrossProcessLockErrorCode, message: string) {
    super(message);
    this.name = "CrossProcessLockError";
    this.code = code;
  }
}

export interface CrossProcessLockOptions {
  /** Directory that holds the lock files; created on demand. */
  directory: string;
  /** Lock name: lowercase letters, digits and hyphens. */
  name: string;
  /** Deadline for acquisition. Default 5000 ms. */
  timeoutMs?: number;
  /**
   * Liveness probe for another process. Production leaves it unset (`process.kill(pid, 0)`).
   * Verifiers pass one to simulate a holder that is wrongly judged dead, which is what the fencing
   * check exists for.
   */
  isProcessAlive?: (pid: number) => boolean;
}

export interface CrossProcessLease {
  readonly ownerId: string;
  /** Monotonic grant number for this lock, written only by holders. */
  readonly fence: number;
  /** Throws `lock-lost` unless this lease still owns the lock. Call immediately before each protected write. */
  assertHeld(): Promise<void>;
}

interface LockRecord {
  version: 1;
  ownerId: string;
  pid: number;
  acquiredAt: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 200;
const MAX_CLAIMS = 8;
const MAX_CLEANUP_ENTRIES = 64;
const NAME_PATTERN = /^[a-z0-9-]{1,40}$/;

/** Owner ids this process is acquiring or holding, for every lock. */
const localOwners = new Set<string>();
/** Locks held by the current async context, keyed by lock path. */
const heldLocks = new AsyncLocalStorage<ReadonlyMap<string, CrossProcessLease>>();

function lockPath(options: CrossProcessLockOptions): string {
  return join(options.directory, `${options.name}.lock`);
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: exists but not ours. Only ESRCH proves the process is gone; anything else fails closed.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isRecord(value: unknown): value is LockRecord {
  const r = value as LockRecord;
  return !!r && r.version === 1 && typeof r.ownerId === "string" && /^[0-9a-f]{32}$/.test(r.ownerId) && Number.isInteger(r.pid) && r.pid > 0;
}

type ReadResult = { kind: "missing" } | { kind: "corrupt" } | { kind: "record"; record: LockRecord };

async function readRecord(path: string): Promise<ReadResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? { kind: "record", record: parsed } : { kind: "corrupt" };
  } catch {
    return { kind: "corrupt" };
  }
}

function isAlive(record: LockRecord, options: CrossProcessLockOptions): boolean {
  if (record.pid === process.pid) return localOwners.has(record.ownerId);
  return (options.isProcessAlive ?? defaultIsProcessAlive)(record.pid);
}

/** Atomically publish `record` at `target`: complete content or nothing. Returns false when the target exists. */
async function publish(options: CrossProcessLockOptions, target: string, record: LockRecord, suffix: string): Promise<boolean> {
  const tmp = join(options.directory, `${options.name}.tmp.${record.pid}.${record.ownerId}.${suffix}`);
  await writeFile(tmp, JSON.stringify(record), { flag: "wx" });
  try {
    await link(tmp, target);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    // Windows reports a create racing a pending delete of the same name as EPERM: contention, not a fault.
    if (code === "EPERM" || code === "EBUSY") return false;
    if (code === "ENOTSUP" || code === "EXDEV" || code === "ENOSYS") {
      throw new CrossProcessLockError("lock-unsupported", `the lock directory does not support hard links (${code})`);
    }
    throw error;
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * Resolves on the first change to the lock file itself (or an unnamed event), or returns false when the
 * deadline passes. Temporary, claim and fence files never wake a waiter, so waiters cannot wake each other.
 */
function watchLockFile(directory: string, lockFile: string): { wait(ms: number): Promise<boolean>; close(): void } {
  let watcher: FSWatcher | null = null;
  let fired = false;
  let wake: (() => void) | null = null;
  try {
    // Watch the native real path: libuv's Windows watcher asserts (and kills the process) when the
    // watched spelling differs from the long path it reports, e.g. an 8.3 short name like MOHAMM~1.
    watcher = watch(realpathSync.native(directory), { persistent: false }, (_event, filename) => {
      if (filename && filename.toString() !== lockFile) return;
      fired = true;
      wake?.();
    });
    watcher.on("error", () => {
      fired = true;
      wake?.();
    });
  } catch (error) {
    throw new CrossProcessLockError("lock-unsupported", `the lock directory cannot be watched (${(error as Error).message})`);
  }
  return {
    wait(ms: number): Promise<boolean> {
      if (fired) return Promise.resolve(true);
      return new Promise<boolean>((resolveWait) => {
        const timer = setTimeout(() => resolveWait(false), Math.max(0, ms));
        timer.unref?.();
        wake = () => {
          clearTimeout(timer);
          resolveWait(true);
        };
      });
    },
    close(): void {
      watcher?.close();
    }
  };
}

type RecoverResult = "recovered" | "claimant-alive";

async function recover(options: CrossProcessLockOptions, dead: LockRecord, me: LockRecord): Promise<RecoverResult> {
  const path = lockPath(options);
  for (let n = 0; n < MAX_CLAIMS; n += 1) {
    const claim = join(options.directory, `${options.name}.claim.${dead.ownerId}.${n}`);
    const won = await publish(options, claim, me, `claim${n}`);
    if (!won) {
      const existing = await readRecord(claim);
      if (existing.kind === "missing") return "claimant-alive"; // cleaned up concurrently: look again
      if (existing.kind === "record" && isAlive(existing.record, options)) return "claimant-alive";
      continue; // a dead or unreadable claimant is superseded by the next claim number
    }
    // The claim winner is the only process allowed to remove this dead owner's lock.
    const current = await readRecord(path);
    if (current.kind === "record" && current.record.ownerId === dead.ownerId) {
      try {
        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return "recovered";
  }
  throw new CrossProcessLockError("lock-recovery-exhausted", `more than ${MAX_CLAIMS} recoverers of one dead holder died`);
}

async function nextFence(options: CrossProcessLockOptions): Promise<number> {
  const fencePath = join(options.directory, `${options.name}.fence`);
  let previous = 0;
  try {
    const value = Number.parseInt(await readFile(fencePath, "utf8"), 10);
    if (Number.isSafeInteger(value) && value >= 0) previous = value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const next = previous + 1;
  const tmp = `${fencePath}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(tmp, String(next), { flag: "wx" });
  await replaceFileAtomically(tmp, fencePath);
  return next;
}

/** Remove claims and temporary files that can no longer matter. Bounded; never touches a live owner's files. */
async function cleanup(options: CrossProcessLockOptions, currentOwner: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(options.directory);
  } catch {
    return;
  }
  let removed = 0;
  for (const entry of entries) {
    if (removed >= MAX_CLEANUP_ENTRIES) return;
    if (!entry.startsWith(`${options.name}.`)) continue;
    const claim = /^[a-z0-9-]+\.claim\.([0-9a-f]{32})\.\d+$/.exec(entry);
    // A claim against an owner that no longer holds the lock can never matter again: owner ids are unique.
    if (claim && claim[1] !== currentOwner) {
      await rm(join(options.directory, entry), { force: true });
      removed += 1;
      continue;
    }
    const tmp = /\.tmp\.(\d+)\.([0-9a-f]{32})\./.exec(entry);
    if (tmp) {
      const pid = Number(tmp[1]);
      const orphaned = pid === process.pid ? !localOwners.has(tmp[2]) : !(options.isProcessAlive ?? defaultIsProcessAlive)(pid);
      if (orphaned) {
        await rm(join(options.directory, entry), { force: true });
        removed += 1;
      }
    }
  }
}

async function acquire(options: CrossProcessLockOptions): Promise<CrossProcessLease> {
  const path = lockPath(options);
  const me: LockRecord = { version: 1, ownerId: randomBytes(16).toString("hex"), pid: process.pid, acquiredAt: new Date().toISOString() };
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  localOwners.add(me.ownerId);
  let granted = false;
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      // The watch starts BEFORE the attempt, so a release between the attempt and the wait is not missed.
      const changes = watchLockFile(options.directory, `${options.name}.lock`);
      try {
        // Read first: a waiter behind a live holder only reads, so it creates no file events of its own.
        const holder = await readRecord(path);
        if (holder.kind === "missing") {
          if (await publish(options, path, me, "lock")) {
            granted = true;
            const fence = await nextFence(options);
            await cleanup(options, me.ownerId);
            return {
              ownerId: me.ownerId,
              fence,
              async assertHeld(): Promise<void> {
                const current = await readRecord(path);
                if (current.kind !== "record" || current.record.ownerId !== me.ownerId) {
                  throw new CrossProcessLockError("lock-lost", `the ${options.name} lock is no longer held by this lease`);
                }
              }
            };
          }
          continue; // another process won the publish: read its record on the next attempt
        }
        if (holder.kind === "corrupt") throw new CrossProcessLockError("lock-corrupt", `the ${options.name} lock file is unreadable; it is never deleted automatically`);
        if (!isAlive(holder.record, options)) {
          if ((await recover(options, holder.record, me)) === "recovered") continue;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0 || !(await changes.wait(remaining))) {
          throw new CrossProcessLockError("lock-timeout", `the ${options.name} lock is held by a live process`);
        }
      } finally {
        changes.close();
      }
    }
    throw new CrossProcessLockError("lock-timeout", `the ${options.name} lock was not acquired within ${MAX_ATTEMPTS} attempts`);
  } finally {
    if (!granted) localOwners.delete(me.ownerId);
  }
}

async function release(options: CrossProcessLockOptions, lease: CrossProcessLease): Promise<void> {
  const path = lockPath(options);
  try {
    const current = await readRecord(path);
    if (current.kind !== "record" || current.record.ownerId !== lease.ownerId) {
      throw new CrossProcessLockError("lock-lost", `the ${options.name} lock was taken over before release`);
    }
    // Nobody else can replace this lock while its owner (this process) is alive, so the unlink is ours.
    await unlink(path);
  } finally {
    localOwners.delete(lease.ownerId);
  }
}

/**
 * Run `task` while holding the lock. Acquisition and release failures are typed `CrossProcessLockError`s.
 * A release failure is reported only when the task itself succeeded, so it never masks the task's error.
 */
export async function withCrossProcessLock<T>(options: CrossProcessLockOptions, task: (lease: CrossProcessLease) => Promise<T>): Promise<T> {
  if (!NAME_PATTERN.test(options.name)) throw new CrossProcessLockError("lock-unsupported", `invalid lock name ${JSON.stringify(options.name)}`);
  const path = lockPath(options);
  const held = heldLocks.getStore();
  if (held?.has(path)) throw new CrossProcessLockError("lock-reentrant", `the ${options.name} lock is already held by this task`);
  await mkdir(options.directory, { recursive: true });
  const lease = await acquire(options);
  let result: T;
  try {
    result = await heldLocks.run(new Map(held ?? []).set(path, lease), () => task(lease));
  } catch (error) {
    await release(options, lease).catch(() => undefined);
    throw error;
  }
  await release(options, lease);
  return result;
}

/** The lease the current async context holds for this lock, if any. */
export function currentCrossProcessLease(options: Pick<CrossProcessLockOptions, "directory" | "name">): CrossProcessLease | undefined {
  return heldLocks.getStore()?.get(lockPath(options as CrossProcessLockOptions));
}
