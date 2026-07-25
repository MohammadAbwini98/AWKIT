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

/** A queued mutation plus its arrival order. */
interface SequencedMutation {
  mutation: SemanticMutation;
  seq: number;
}

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
  | {
      accepted: true;
      coalesced: boolean;
      /** A pending upsert for the same document id was cancelled by this delete. */
      supersededUpsert: boolean;
      /** How many pending upserts this `deleteEntity` cancelled. */
      supersededByEntity: number;
    }
  | { accepted: false; reason: "QUEUE_FULL_OF_DELETES" };

export interface DrainResult {
  upserted: number;
  deleted: number;
  failed: number;
  /** Mutations abandoned after exhausting bounded retries or hitting a non-retryable failure. */
  abandoned: number;
  rebuildRequired: boolean;
  /**
   * True when this call did NOT drain because draining is paused for a rebuild's delta replay.
   *
   * Reported rather than returned as a zero-filled success: a shutdown caller that reads
   * `upserted: 0, deleted: 0` as "the queue is empty" would close the store with work still pending.
   * Callers waiting for quiescence should await `whenIdle()`.
   */
  skipped?: true;
}

/** An accepted mutation and the order in which it was accepted. */
export interface JournalledMutation {
  mutation: SemanticMutation;
  seq: number;
}

export interface RebuildJournalState {
  /** Sequence number at which the rebuild snapshot was taken. Everything later must be replayed. */
  watermark: number;
  entries: readonly JournalledMutation[];
  /**
   * True when the journal hit its bound. The rebuild MUST NOT be activated in that state: replaying a
   * partial delta would produce a candidate that silently lacks recent changes, which is worse than
   * having no new candidate at all.
   */
  overflowed: boolean;
}

export interface SemanticMutationQueueOptions {
  store: SemanticStore;
  /** Max pending mutations before overflow handling engages. Default 1000. */
  maxPending?: number;
  /** Max documents per store call. Default 100. */
  batchSize?: number;
  /** Bounded retries for a RETRYABLE failure. Default 2. */
  maxRetries?: number;
  /**
   * Max entries the rebuild delta journal will hold. Default 5000.
   *
   * Bounded for the same reason as the queue itself, but with the opposite failure response: the
   * journal never DROPS an entry. Overflow is recorded, and the orchestrator refuses to activate the
   * candidate — an unactivated rebuild is a retry, whereas a rebuild activated from a truncated delta
   * silently loses whatever the user changed while it was running.
   */
  maxRebuildDelta?: number;
}

type MutationRun =
  | { op: "upsert"; items: Extract<SemanticMutation, { op: "upsert" }>[] }
  | { op: "delete"; items: Extract<SemanticMutation, { op: "delete" }>[] }
  | { op: "deleteEntity"; items: Extract<SemanticMutation, { op: "deleteEntity" }>[] };

/**
 * Split an ordered mutation list into consecutive same-operation runs.
 *
 * Only ADJACENT mutations are grouped, so batching can never move an operation past one that was
 * enqueued before it. `[upsert, upsert, deleteEntity, upsert]` yields three runs, preserving the
 * fact that the trailing upsert is a deliberate re-index after the entity deletion.
 */
function adjacentRuns(mutations: readonly SemanticMutation[]): MutationRun[] {
  const runs: MutationRun[] = [];
  for (const mutation of mutations) {
    const last = runs[runs.length - 1];
    if (last && last.op === mutation.op) {
      (last.items as SemanticMutation[]).push(mutation);
    } else {
      runs.push({ op: mutation.op, items: [mutation] } as MutationRun);
    }
  }
  return runs;
}

/** Failures worth retrying. Everything else is treated as terminal — see "no blind replay". */
const RETRYABLE_CODES = new Set(["WRITE_FAILED", "READ_FAILED", "QUERY_FAILED"]);

function isRetryable(error: unknown): boolean {
  return error instanceof SemanticStoreError && RETRYABLE_CODES.has(error.code);
}

function requireInteger(value: number | undefined, fallback: number, min: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min) {
    // Thrown, not clamped: a `batchSize` of 0 previously left `pending.size > 0` forever while every
    // selected batch was empty — an infinite loop presenting as a hang. Silently repairing a
    // nonsensical option would hide the caller's bug.
    throw new RangeError(`${label} must be an integer >= ${min}, got ${String(value)}`);
  }
  return resolved;
}

export class SemanticMutationQueue {
  /** Keyed for coalescing; `seq` carries the TEMPORAL order that batching must respect. */
  private pending = new Map<string, SequencedMutation>();
  private nextSeq = 0;
  /** The in-flight drain, so concurrent callers await the real work instead of a false completion. */
  private activeDrain: Promise<DrainResult> | null = null;
  private rebuildRequired = false;
  private droppedUpserts = 0;

  /**
   * Ordered journal of mutations accepted AFTER a rebuild snapshot was taken.
   *
   * A rebuild reads authoritative sources at a point in time and takes seconds to populate. Anything
   * the user changes in that window is applied to the ACTIVE generation but is absent from the
   * candidate, so activating the candidate and clearing the queue would silently discard it. The
   * journal is what makes the window recoverable: the same mutations are replayed into the candidate
   * before it is activated.
   */
  private rebuildJournal: JournalledMutation[] | null = null;
  private rebuildWatermark = 0;
  private rebuildJournalOverflowed = false;
  private drainingPaused = false;
  private activeRebuild: Promise<unknown> | null = null;

  private readonly maxPending: number;
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly maxRebuildDelta: number;

  constructor(private readonly options: SemanticMutationQueueOptions) {
    this.maxPending = requireInteger(options.maxPending, 1000, 1, "maxPending");
    this.batchSize = requireInteger(options.batchSize, 100, 1, "batchSize");
    this.maxRetries = requireInteger(options.maxRetries, 2, 0, "maxRetries");
    this.maxRebuildDelta = requireInteger(options.maxRebuildDelta, 5000, 1, "maxRebuildDelta");
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

  /**
   * Record an accepted mutation in the rebuild journal.
   *
   * Every accepted mutation is journalled in arrival order, WITHOUT coalescing. Coalescing is safe for
   * the pending queue because the last write wins against one live index; the journal instead has to
   * reproduce a sequence of effects against a candidate built from an older snapshot, and collapsing
   * `upsert A` / `deleteEntity A` / `upsert A` would change that net effect.
   */
  private journal(mutation: SemanticMutation): void {
    if (this.rebuildJournal === null) return;
    if (this.rebuildJournal.length >= this.maxRebuildDelta) {
      // Never dropped silently. The orchestrator checks this and abandons the candidate.
      this.rebuildJournalOverflowed = true;
      return;
    }
    this.rebuildJournal.push({ mutation, seq: this.nextSeq });
  }

  enqueue(mutation: SemanticMutation): EnqueueOutcome {
    const key = mutationKey(mutation);
    const existing = this.pending.get(key);

    // Delete supersedes a pending upsert for the same id. The reverse is allowed: an upsert after a
    // delete is a genuine re-index, not a mistake.
    const supersededUpsert = existing?.mutation.op === "upsert" && mutation.op === "delete";

    // `deleteEntity` must cancel every pending upsert for that entity, not merely run before them.
    // These mutations live under DIFFERENT coalescing keys (`doc:` vs `entity:`), so key-based
    // coalescing alone cannot see the relationship — and draining all deletes before all upserts
    // reordered "upsert then deleteEntity" into "deleteEntity then upsert", resurrecting the very
    // document the caller had just asked to remove.
    let supersededByEntity = 0;
    if (mutation.op === "deleteEntity") {
      for (const [pendingKey, entry] of [...this.pending]) {
        if (entry.mutation.op === "upsert" && entry.mutation.document.entityId === mutation.entityId) {
          this.pending.delete(pendingKey);
          supersededByEntity += 1;
        }
      }
    }

    if (existing) {
      // Re-keyed at the END, not replaced in place: coalescing must carry the temporal position of
      // the LATEST operation, otherwise a late delete inherits an early upsert's slot and can be
      // executed before mutations that were actually enqueued before it.
      this.pending.delete(key);
      this.journal(mutation);
      this.pending.set(key, { mutation, seq: this.nextSeq++ });
      return { accepted: true, coalesced: true, supersededUpsert, supersededByEntity };
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

    this.journal(mutation);
    this.pending.set(key, { mutation, seq: this.nextSeq++ });
    return { accepted: true, coalesced: false, supersededUpsert: false, supersededByEntity };
  }

  private oldestUpsertKey(): string | null {
    let oldest: { key: string; seq: number } | null = null;
    for (const [key, entry] of this.pending) {
      if (entry.mutation.op === "upsert" && (oldest === null || entry.seq < oldest.seq)) {
        oldest = { key, seq: entry.seq };
      }
    }
    return oldest?.key ?? null;
  }

  /**
   * Drain the queue against the store.
   *
   * Re-entrant calls are refused rather than queued: the caller that is already draining will pick
   * up anything enqueued meanwhile, and allowing a second concurrent drain would defeat the
   * serialization this class exists to provide.
   */
  // Deliberately NOT `async`: an async method wraps its return value in a NEW promise, so
  // `drain() === drain()` would be false and each caller would hold a distinct wrapper. Returning
  // the stored promise directly is what makes single-flight observable.
  drain(): Promise<DrainResult> {
    // A concurrent caller awaits the REAL work. Returning an empty-looking result told a shutdown
    // caller the queue was drained while writes were still in flight — an invitation to close the
    // store mid-write.
    if (this.activeDrain) return this.activeDrain;

    // Paused for a rebuild's delta replay. Reported as `skipped` rather than as a zero-filled success,
    // because "nothing was written" and "there was nothing to write" must not look identical.
    if (this.drainingPaused) {
      return Promise.resolve({
        upserted: 0,
        deleted: 0,
        failed: 0,
        abandoned: 0,
        rebuildRequired: this.rebuildRequired,
        skipped: true
      });
    }
    this.activeDrain = this.runDrain().finally(() => {
      this.activeDrain = null;
    });
    return this.activeDrain;
  }

  private async runDrain(): Promise<DrainResult> {
    const result: DrainResult = { upserted: 0, deleted: 0, failed: 0, abandoned: 0, rebuildRequired: this.rebuildRequired };

    while (this.pending.size > 0) {
      // Take the OLDEST mutations by sequence, then execute them in that order. Snapshotting before
      // awaiting keeps mutations enqueued during the write out of the in-flight batch.
      const batch = [...this.pending.values()].sort((a, b) => a.seq - b.seq).slice(0, this.batchSize);
      for (const entry of batch) this.pending.delete(mutationKey(entry.mutation));

      // Group only ADJACENT same-op mutations. Globally regrouping the batch by operation type is
      // what reordered "upsert X" then "deleteEntity X" into "deleteEntity X" then "upsert X".
      // Batching is a throughput optimisation and must never change observable order.
      for (const run of adjacentRuns(batch.map((e) => e.mutation))) {
        if (run.op === "upsert") {
          const outcome = await this.attempt(() => this.options.store.upsert(run.items.map((u) => u.document)));
          if (outcome.ok) result.upserted += outcome.value.inserted + outcome.value.replaced;
          else this.recordFailure(result, outcome.abandoned);
        } else if (run.op === "delete") {
          const outcome = await this.attempt(() => this.options.store.delete(run.items.map((d) => d.id)));
          if (outcome.ok) result.deleted += outcome.value;
          else this.recordFailure(result, outcome.abandoned);
        } else {
          // Entity deletions run one at a time: each targets a different entity, so there is nothing
          // to batch, and a shared failure would obscure which entity was not removed.
          for (const del of run.items) {
            const outcome = await this.attempt(() => this.options.store.deleteByEntity(del.entityId));
            if (outcome.ok) result.deleted += outcome.value;
            else this.recordFailure(result, outcome.abandoned);
          }
        }
      }
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

  // ── rebuild coordination ──────────────────────────────────────────────────────────────────────

  /**
   * Start journalling, and return the watermark the rebuild snapshot corresponds to.
   *
   * Everything accepted from here on is applied to the ACTIVE generation as usual AND recorded, so it
   * can be replayed into the candidate before activation.
   */
  beginRebuildJournal(): number {
    if (this.rebuildJournal !== null) {
      // Two concurrent rebuilds would each own a partial delta and neither could be trusted.
      throw new Error("a rebuild journal is already open");
    }
    this.rebuildJournal = [];
    this.rebuildJournalOverflowed = false;
    this.rebuildWatermark = this.nextSeq;
    return this.rebuildWatermark;
  }

  rebuildJournalState(): RebuildJournalState {
    return {
      watermark: this.rebuildWatermark,
      entries: this.rebuildJournal ? [...this.rebuildJournal] : [],
      overflowed: this.rebuildJournalOverflowed
    };
  }

  /**
   * Drop journal entries PROVEN applied to the candidate, identified by sequence number.
   *
   * Entries are removed by explicit sequence rather than by clearing the journal, so a replay that
   * stopped part way leaves the unapplied remainder intact for the next attempt.
   */
  confirmRebuildDeltaApplied(appliedSeqs: readonly number[]): void {
    if (this.rebuildJournal === null) return;
    const applied = new Set(appliedSeqs);
    this.rebuildJournal = this.rebuildJournal.filter((entry) => !applied.has(entry.seq));
  }

  /** Close the journal. Anything still unapplied is reported so the caller can refuse to activate. */
  endRebuildJournal(): { unapplied: number; overflowed: boolean } {
    const unapplied = this.rebuildJournal?.length ?? 0;
    const overflowed = this.rebuildJournalOverflowed;
    this.rebuildJournal = null;
    this.rebuildJournalOverflowed = false;
    return { unapplied, overflowed };
  }

  /**
   * Stop draining while the delta is replayed into the candidate.
   *
   * The window must be short: it is only open between the final delta snapshot and the pointer swap.
   * Without it, a mutation could be applied to the active generation after the delta was captured and
   * before the candidate went live, and would then exist in neither.
   */
  pauseDraining(): void {
    this.drainingPaused = true;
  }

  resumeDraining(): void {
    this.drainingPaused = false;
  }

  get isDrainingPaused(): boolean {
    return this.drainingPaused;
  }

  /** Register the in-flight rebuild so shutdown can await ONE bounded promise covering both. */
  trackRebuild<T>(rebuild: Promise<T>): Promise<T> {
    this.activeRebuild = rebuild;
    return rebuild.finally(() => {
      this.activeRebuild = null;
    }) as Promise<T>;
  }

  /**
   * Await quiescence: the in-flight drain AND any in-flight rebuild.
   *
   * Shutdown needs a single thing to wait on. Waiting only on `drain()` would return immediately while
   * a rebuild was mid-populate, and closing the store underneath it is how a candidate generation ends
   * up half-written.
   *
   * **Returns `false` when the deadline wins**, so shutdown can log and proceed. Waiting forever is
   * not the safe default it looks like: a wedged host would hold the application open with no way out
   * but a kill, which is a worse outcome than closing over a rebuild that is already not progressing.
   * The caller decides what to do; this only promises to answer.
   */
  async whenIdle(deadlineMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, deadlineMs);
    // Looped because finishing a rebuild can leave a drain outstanding and vice versa; bounded both by
    // the fact that neither restarts itself AND by wall-clock, since an iteration bound alone does not
    // bound TIME — one hung await inside it waits forever.
    for (let i = 0; i < 8; i += 1) {
      const inFlight = [this.activeDrain, this.activeRebuild].filter(Boolean) as Promise<unknown>[];
      if (inFlight.length === 0) return true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;

      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = await Promise.race([
        Promise.allSettled(inFlight).then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), remaining);
        })
      ]);
      // Cleared on BOTH outcomes, which is what keeps the timer from outliving the race. It is
      // deliberately NOT `unref`'d: while this race is pending the timer is the only thing guaranteeing
      // it can ever settle, so unref'ing it lets a runtime with no other work exit mid-await instead of
      // reporting the deadline. (Observed: Node exit code 13, "unfinished top-level await".)
      clearTimeout(timer);
      if (expired) return false;
    }
    return this.activeDrain === null && this.activeRebuild === null;
  }

  /**
   * Discard everything pending.
   *
   * **Not for use after a rebuild activates.** A candidate is built from a snapshot, so the queue can
   * hold mutations that postdate it; clearing them on activation silently loses the user's most recent
   * changes. That is what the delta journal exists to prevent — replay the journal, then let the queue
   * drain normally against the new generation.
   */
  clear(): void {
    this.pending.clear();
  }

  /**
   * Called once a rebuild has re-derived the index from authoritative sources AND its delta has been
   * replayed. Clearing the flag before the delta is applied would declare an index trustworthy while
   * it was still missing recent changes.
   */
  markRebuilt(): void {
    this.rebuildRequired = false;
    this.droppedUpserts = 0;
  }
}
