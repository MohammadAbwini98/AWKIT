/**
 * One write-coordination authority per resolved storage folder.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 *
 * `JsonProfileStore` already serialized its mutations, but it did so through a chain owned by the
 * *instance*. Every `create*ProfileStore()` / `createReportStore()` call returns a NEW instance, so
 * two callers working on the same configured folder each held their own private queue. R0
 * characterization measured the consequence directly: two real same-folder stores entered atomic
 * replacement concurrently (`maxActive = 2`), and two independently loaded snapshots could each
 * write back a whole document, so the later replace silently discarded the other writer's field.
 *
 * Serialization has to be keyed by the thing that is actually shared — the destination folder — not
 * by the object that happens to be holding a handle to it.
 *
 * ── What it deliberately is not ───────────────────────────────────────────────────────────────
 *
 * This is a serialization authority, nothing more. It owns no files, no cache, no schema and no
 * lifecycle; it does not read, write, or interpret anything on disk. Adding a store registry, a
 * document cache or a transaction log here would be a new persistence architecture, which R1B
 * explicitly must not introduce.
 *
 * ── Why lanes are evicted when idle ───────────────────────────────────────────────────────────
 *
 * A process-wide `Map` that only ever grows is the kind of global singleton that makes configured
 * Settings path changes and isolated tests unsafe: stale keys would accumulate for every folder the
 * app ever pointed at. Each lane is reference-counted by its own pending tasks and removed the
 * moment that count reaches zero — at which point nothing is in flight or queued for that key, so a
 * later arrival that creates a fresh lane has, correctly, nothing to wait behind. Coordination
 * therefore never outlives the work it is coordinating, and a path change simply routes to a
 * different key rather than having to invalidate anything.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";

interface FolderLane {
  /** Settles when every task admitted so far has settled. Never rejects. */
  tail: Promise<unknown>;
  /** Tasks admitted but not yet settled. The lane is evicted at zero. */
  pending: number;
}

const lanes = new Map<string, FolderLane>();

/**
 * Coordination keys held by the task that owns the current async context.
 *
 * A plain boolean or a per-lane "busy" flag cannot express this. While a task runs, the lane is
 * busy for *everyone*, and rejecting every arrival during that window would reject the legitimate
 * external callers this module exists to queue. The only thing that separates "queued from outside
 * the running task" from "called from inside it" is async context, so `AsyncLocalStorage` is the
 * mechanism rather than a convenience. `node:async_hooks` is Node core: no package dependency, no
 * manifest change, and nothing that touches the offline-first constraints.
 *
 * The store is entered around the TASK INVOCATION only (see `runExclusive`) — never around the lane
 * chain — so a caller that merely queues while a task happens to be running inherits nothing.
 */
const heldCoordinationKeys = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * Textual coordination key for a storage folder.
 *
 * The key applies `resolve`, normalizes path separators, removes trailing separators, then
 * lowercases on win32. It deliberately does NOT call `realpath` or otherwise probe physical
 * filesystem identity because `JsonProfileStore` creates its folder lazily, so it frequently does
 * not exist when coordination is first required, and a resolver failure plus fallback could itself
 * assign inconsistent identities.
 *
 * The total textual rule guarantees that equal configured spellings produce equal keys.
 *
 * Consequence: different aliases for one physical directory can retain different textual keys and
 * therefore use different write lanes, degrading same-folder serialization for that alias pair.
 * This is fail-degraded lane splitting, not a known merge of distinct physical folders. Callers
 * should configure and reuse one stable path spelling for each storage folder. Detailed
 * representative alias classes and the residual scope are recorded in `docs/ai/KNOWN_ISSUES.md`.
 *
 * Windows textual paths are compared case-insensitively because NTFS is; on other platforms case is
 * significant and must be preserved or two genuinely different folders would collapse into one.
 */
export function folderCoordinationKey(folder: string): string {
  const normalized = resolve(folder).replace(/[\\/]+/g, "/").replace(/(.)\/+$/, "$1");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Run `task` with exclusive access to `folder`, FIFO in admission order.
 *
 * Tasks targeting *different* resolved folders never wait on each other — each key owns its own
 * lane — so unrelated stores keep the concurrency they have today.
 *
 * A rejecting task rejects only for its own caller: both branches of the chain settle the lane
 * tail, so a full disk (`ENOSPC`), a permissions failure or an exhausted rename retry cannot
 * poison the folder for the writes queued behind it or for any later write.
 *
 * ── Same-key re-entrancy rejects instead of hanging ───────────────────────────────────────────
 *
 * A task already running on a lane that calls back in for the SAME key would chain behind a tail
 * that only settles once that task returns — while that task is waiting on the inner call. There is
 * no timeout and no `AbortSignal` that can break that cycle: `pending` never reaches zero, the lane
 * is never evicted, and because lanes are process-wide every store pointed at that folder wedges
 * for the life of the process. The observable symptom is a job timeout with no failing assertion
 * name, which is strictly worse than a red. So such a call is rejected at the moment it happens,
 * with the coordination key in the message.
 *
 * Deliberate limits, none of which are worth trying to solve here:
 *
 *  - A fire-and-forget same-key enqueue from inside a task (`void runExclusive(sameFolder, t2)`,
 *    never awaited) does NOT deadlock — it simply queues behind the outer task. It is rejected
 *    anyway, because at call time nothing can know whether the caller will go on to await the
 *    returned promise. That over-rejection is inherent to detecting at the call, not a gap.
 *  - Async context can be lost across a boundary that creates no async-hook-tracked resource, so
 *    this is best-effort DETECTION, never a proof that re-entrancy cannot occur.
 *  - Cross-key cycles — A holds key1 and awaits key2 while B holds key2 and awaits key1 — are a
 *    different hazard and are explicitly OUT OF SCOPE. This guard is same-key only; a general
 *    cycle detector is not something this module should grow.
 */
export function runExclusive<T>(folder: string, task: () => Promise<T>): Promise<T> {
  const key = folderCoordinationKey(folder);

  // Detect BEFORE touching any lane state — no `lanes.get`, no `lanes.set`, no `pending` increment
  // and no `tail` reassignment above this point. A rejected re-entrant call must leave the lane
  // exactly as it found it, or the guard would strand the very lane it exists to protect.
  const held = heldCoordinationKeys.getStore();
  if (held?.has(key)) {
    // A returned rejected promise, not a synchronous `throw`: `runExclusive`'s promise-returning
    // contract has to stay identical for every caller.
    return Promise.reject(
      new Error(
        `re-entrant folder write coordination on key "${key}" — a task already holding this lane cannot await it again`
      )
    );
  }

  let lane = lanes.get(key);
  if (!lane) {
    lane = { tail: Promise.resolve(), pending: 0 };
    lanes.set(key, lane);
  }
  const owned = lane;
  owned.pending += 1;

  // The store is entered around the task INVOCATION and nothing else. Wrapping the lane chain, the
  // `.then()` call or this function's body instead would leak the store to callers that merely
  // queued while the task was running, and they would be rejected as if they were re-entrant.
  const heldByTask: ReadonlySet<string> = new Set(held ?? []).add(key);
  const runTask = (): Promise<T> => heldCoordinationKeys.run(heldByTask, task);

  // `then(runTask, runTask)` — the failure branch runs the next task too, which is what keeps one
  // bad write from stranding the lane.
  const result = owned.tail.then(runTask, runTask);
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  owned.tail = settled;

  void settled.then(() => {
    owned.pending -= 1;
    // Only drop the entry that is still installed: a lane replaced after an eviction must not be
    // removed by a straggler from the previous generation.
    if (owned.pending === 0 && lanes.get(key) === owned) lanes.delete(key);
  });

  return result;
}

/**
 * Folder keys with coordination currently in flight. Introspection for verifiers only — production
 * code must never branch on this, and it exists so a test can prove that lanes are both shared
 * (one key for two same-folder stores) and released (no key survives idle work).
 */
export function activeFolderCoordinationKeys(): string[] {
  return [...lanes.keys()].sort();
}
