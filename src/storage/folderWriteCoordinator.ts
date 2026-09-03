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

import { resolve } from "node:path";

interface FolderLane {
  /** Settles when every task admitted so far has settled. Never rejects. */
  tail: Promise<unknown>;
  /** Tasks admitted but not yet settled. The lane is evicted at zero. */
  pending: number;
}

const lanes = new Map<string, FolderLane>();

/**
 * Canonical key for a storage folder.
 *
 * Deliberately NOT `realpath`: `JsonProfileStore` creates its folder lazily on first use, so the
 * directory frequently does not exist yet at the moment coordination is required, and a resolver
 * that throws (or silently falls back) there would hand the two writers different keys — exactly
 * the split this module exists to prevent. `resolve` is total, so equal configured paths always
 * produce equal keys.
 *
 * Windows paths are compared case-insensitively because NTFS is; on other platforms case is
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
 */
export function runExclusive<T>(folder: string, task: () => Promise<T>): Promise<T> {
  const key = folderCoordinationKey(folder);
  let lane = lanes.get(key);
  if (!lane) {
    lane = { tail: Promise.resolve(), pending: 0 };
    lanes.set(key, lane);
  }
  const owned = lane;
  owned.pending += 1;

  // `then(task, task)` — the failure branch runs the next task too, which is what keeps one bad
  // write from stranding the lane.
  const result = owned.tail.then(task, task);
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
