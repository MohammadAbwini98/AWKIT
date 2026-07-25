/**
 * Serialized mutation queue for the semantic index (plan §14).
 *
 * Four properties, each chosen for a specific failure it prevents:
 *
 *  1. **Serialized.** One drain at a time. Concurrent writers against one index generation are how
 *     an "upsert then delete" pair lands in the wrong order and resurrects a deleted document.
 *
 *  2. **Coalescing.** Repeated mutations for the same key collapse to the last one. Saving a
 *     workflow five times must cost one write, not five — and because document ids are
 *     deterministic, the five projections are genuinely the same document.
 *
 *  3. **Delete supersedes upsert.** A delete enqueued after an upsert for the same id cancels it
 *     outright. The reverse (upsert after delete) is a legitimate re-index and is allowed. This
 *     asymmetry is deliberate: the two operations are NOT equally safe to lose.
 *
 *  4. **Bounded, and biased toward deletes.** Overflow drops the oldest pending UPSERT and never a
 *     delete. A dropped upsert leaves the index stale — detectable via `sourceHash`, fixed by a
 *     rebuild. A dropped delete leaves content indexed that was supposed to be removed, which is a
 *     privacy failure a rebuild will not necessarily notice. When only deletes remain, the enqueue
 *     is REJECTED rather than made to drop one.
 *
 * **No blind replay.** A failed batch is retried a bounded number of times and only when the failure
 * is classified retryable. Anything else marks the index as needing a rebuild and stops. Replaying
 * an unclassified failure forever is how a poison document turns into an infinite write loop that
 * looks like a hang.
 *
 * Framework-agnostic: no Electron, no filesystem, no Zvec.
 */

import type { ValidatedSemanticDocument } from "./SemanticPolicyValidator";
import { SemanticStoreError, type SemanticStore } from "./SemanticStore";

export type SemanticMutation =
  | { op: "upsert"; document: ValidatedSemanticDocument }
  | { op: "delete"; id: string }
  | { op: "deleteEntity"; entityId: string };

/** Coalescing key. Upsert and delete of the same document id share a key so one can supersede the other. */
function mutationKey(mutation: SemanticMutation): string {
  switch (mutation.op) {
    case "upsert":
      return `doc:${mutation.document.id}`;
    case "delete":
      return `doc:${mutation.id}`;
    case "deleteEntity":
      return `entity:${mutation.entityId}`;
  }
}

export type EnqueueOutcome =
  | { accepted: true; coalesced: boolean; supersededUpsert: boolean }
  | { accepted: false; reason: "QUEUE_FULL_OF_DELETES" };

export interface DrainResult {
  upserted: number;
  deleted: number;
  failed: number;
  /** Mutations abandoned after exhausting bounded retries or hitting a non-retryable failure. */
  abandoned: number;
  rebuildRequired: boolean;
}

export interface SemanticMutationQueueOptions {
  store: SemanticStore;
  /** Max pending mutations before overflow handling engages. Default 1000. */
  maxPending?: number;
  /** Max documents per store call. Default 100. */
  batchSize?: number;
  /** Bounded retries for a RETRYABLE failure. Default 2. */
  maxRetries?: number;
}

/** Failures worth retrying. Everything else is treated as terminal — see "no blind replay". */
const RETRYABLE_CODES = new Set(["WRITE_FAILED", "READ_FAILED", "QUERY_FAILED"]);

function isRetryable(error: unknown): boolean {
  return error instanceof SemanticStoreError && RETRYABLE_CODES.has(error.code);
}

export class SemanticMutationQueue {
  /** Insertion-ordered by key; re-enqueueing a key REPLACES in place and keeps original position. */
  private pending = new Map<string, SemanticMutation>();
  private draining = false;
  private rebuildRequired = false;
  private droppedUpserts = 0;

  private readonly maxPending: number;
  private readonly batchSize: number;
  private readonly maxRetries: number;

  constructor(private readonly options: SemanticMutationQueueOptions) {
    this.maxPending = options.maxPending ?? 1000;
    this.batchSize = options.batchSize ?? 100;
    this.maxRetries = options.maxRetries ?? 2;
  }

  get size(): number {
    return this.pending.size;
  }

  /** True once the index can no longer be trusted to reflect its sources without a rebuild. */
  get needsRebuild(): boolean {
    return this.rebuildRequired;
  }

  get droppedUpsertCount(): number {
    return this.droppedUpserts;
  }

  enqueue(mutation: SemanticMutation): EnqueueOutcome {
    const key = mutationKey(mutation);
    const existing = this.pending.get(key);

    // Delete supersedes a pending upsert for the same id. The reverse is allowed: an upsert after a
    // delete is a genuine re-index, not a mistake.
    const supersededUpsert = existing?.op === "upsert" && mutation.op === "delete";

    if (existing) {
      this.pending.set(key, mutation); // replace in place, preserving queue position
      return { accepted: true, coalesced: true, supersededUpsert };
    }

    if (this.pending.size >= this.maxPending) {
      const victim = this.oldestUpsertKey();
      if (victim === null) {
        // Only deletes remain. Dropping one would leave content indexed that should be gone, so the
        // new mutation is refused instead — the caller learns the queue is saturated rather than
        // silently losing a removal.
        this.rebuildRequired = true;
        return { accepted: false, reason: "QUEUE_FULL_OF_DELETES" };
      }
      this.pending.delete(victim);
      this.droppedUpserts += 1;
      // Staleness is now possible, so the index must be rebuilt before it can be trusted.
      this.rebuildRequired = true;
    }

    this.pending.set(key, mutation);
    return { accepted: true, coalesced: false, supersededUpsert: false };
  }

  private oldestUpsertKey(): string | null {
    for (const [key, mutation] of this.pending) {
      if (mutation.op === "upsert") return key;
    }
    return null;
  }

  /**
   * Drain the queue against the store.
   *
   * Re-entrant calls are refused rather than queued: the caller that is already draining will pick
   * up anything enqueued meanwhile, and allowing a second concurrent drain would defeat the
   * serialization this class exists to provide.
   */
  async drain(): Promise<DrainResult> {
    const result: DrainResult = { upserted: 0, deleted: 0, failed: 0, abandoned: 0, rebuildRequired: this.rebuildRequired };
    if (this.draining) return result;
    this.draining = true;

    try {
      while (this.pending.size > 0) {
        // Snapshot and clear before awaiting, so mutations enqueued DURING the write are not lost
        // and are not silently folded into the in-flight batch.
        const batch = [...this.pending.values()].slice(0, this.batchSize);
        for (const mutation of batch) this.pending.delete(mutationKey(mutation));

        const upserts = batch.filter((m): m is Extract<SemanticMutation, { op: "upsert" }> => m.op === "upsert");
        const deletes = batch.filter((m): m is Extract<SemanticMutation, { op: "delete" }> => m.op === "delete");
        const entityDeletes = batch.filter(
          (m): m is Extract<SemanticMutation, { op: "deleteEntity" }> => m.op === "deleteEntity"
        );

        // Deletes first: if the batch fails partway, having removed content is the safer half-state
        // than having written content that a pending delete was about to remove.
        for (const del of entityDeletes) {
          const outcome = await this.attempt(() => this.options.store.deleteByEntity(del.entityId));
          if (outcome.ok) result.deleted += outcome.value;
          else this.recordFailure(result, outcome.abandoned);
        }

        if (deletes.length > 0) {
          const outcome = await this.attempt(() => this.options.store.delete(deletes.map((d) => d.id)));
          if (outcome.ok) result.deleted += outcome.value;
          else this.recordFailure(result, outcome.abandoned);
        }

        if (upserts.length > 0) {
          const outcome = await this.attempt(() => this.options.store.upsert(upserts.map((u) => u.document)));
          if (outcome.ok) result.upserted += outcome.value.inserted + outcome.value.replaced;
          else this.recordFailure(result, outcome.abandoned);
        }
      }
    } finally {
      this.draining = false;
    }

    result.rebuildRequired = this.rebuildRequired;
    return result;
  }

  private recordFailure(result: DrainResult, abandoned: boolean): void {
    result.failed += 1;
    if (abandoned) {
      result.abandoned += 1;
      // The mutation is NOT re-queued. Re-queueing an operation whose failure we could not classify
      // is the blind replay this design forbids; the index is instead declared stale so a rebuild —
      // which starts from authoritative sources — resolves it.
      this.rebuildRequired = true;
    }
  }

  /** Bounded retry, retryable failures only. */
  private async attempt<T>(
    operation: () => Promise<T>
  ): Promise<{ ok: true; value: T } | { ok: false; abandoned: boolean }> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return { ok: true, value: await operation() };
      } catch (error) {
        if (!isRetryable(error)) return { ok: false, abandoned: true };
        if (attempt === this.maxRetries) return { ok: false, abandoned: true };
      }
    }
    return { ok: false, abandoned: true };
  }

  /** Discard everything pending. Used when a rebuild supersedes the queued work. */
  clear(): void {
    this.pending.clear();
  }

  /** Called once a rebuild has re-derived the index from authoritative sources. */
  markRebuilt(): void {
    this.rebuildRequired = false;
    this.droppedUpserts = 0;
  }
}
