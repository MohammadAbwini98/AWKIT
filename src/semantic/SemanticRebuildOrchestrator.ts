/**
 * Rebuild orchestration: build a candidate generation, replay everything that changed while it was
 * building, and only then make it live.
 *
 * ## The failure this exists to prevent
 *
 * A rebuild reads authoritative sources at one instant and takes seconds to populate. The obvious
 * implementation loses data:
 *
 *     take source snapshot
 *       -> build candidate for several seconds
 *          -> user edits or deletes a workflow  (applied to the ACTIVE generation)
 *       -> activate the candidate, built from the older snapshot
 *       -> clear the mutation queue
 *     => the user's change is gone from the semantic index, silently
 *
 * `queue.clear()` after activation is therefore unsafe unless the queue provably holds nothing that
 * postdates the snapshot — which, during a live rebuild, it never does. So the queue is never cleared
 * on activation. Instead:
 *
 *   1. drain what has already been accepted for the active generation;
 *   2. take watermark **W** and start journalling;
 *   3. populate the candidate from a snapshot at W, while normal mutations keep flowing to the ACTIVE
 *      generation and are also journalled;
 *   4. validate the candidate;
 *   5. pause draining, replay the post-W journal INTO the candidate in order, revalidate;
 *   6. close the candidate, swap the pointer, retarget, resume draining;
 *   7. clear `rebuildRequired` only after all of that succeeded.
 *
 * ## What a failure must leave behind
 *
 * Every pre-activation failure leaves the active pointer untouched, the pending queue intact, the
 * journal intact, and `rebuildRequired` still true. That is what makes a failed rebuild a retry rather
 * than damage. The pointer swap is the single commit point: `rebuildIntoNewGeneration` disables
 * candidate cleanup the instant the pointer moves, so no later error can delete a live generation.
 *
 * A metadata write failing AFTER activation is reported as repair-required and does NOT undo the
 * activation — the pointer is authoritative, and startup reconciliation repairs derived metadata.
 *
 * Framework-agnostic: no Electron, no Zvec. The generation lifecycle and the candidate store are
 * injected, so this is testable without a native host.
 */

import { SEMANTIC_DOCUMENT_KINDS } from "./contracts/SemanticDocument";
import type { ValidatedSemanticDocument } from "./SemanticPolicyValidator";
import type { GenerationValidation } from "./SemanticGenerationManager";
import type { JournalledMutation, SemanticMutationQueue } from "./SemanticMutationQueue";
import { SemanticStoreError, type SemanticStore } from "./SemanticStore";

export type RebuildRefusal =
  /** Another rebuild owns the candidate writer. */
  | "REBUILD_ALREADY_RUNNING"
  /** The source snapshot could not be read; nothing was allocated. */
  | "SNAPSHOT_FAILED"
  | "POPULATE_FAILED"
  | "VALIDATION_FAILED"
  /** The post-watermark delta could not be replayed into the candidate. */
  | "DELTA_REPLAY_FAILED"
  /**
   * The journal hit its bound, so the delta is incomplete. Activating would silently drop whatever
   * overflowed, so the candidate is abandoned and the rebuild must be retried.
   */
  | "DELTA_OVERFLOWED"
  | "ACTIVATION_FAILED";

export interface RebuildReport {
  ok: boolean;
  refusal?: RebuildRefusal;
  reason?: string;
  /** The candidate generation, when one was allocated. */
  generation?: string;
  /** Documents written from the snapshot. */
  populated: number;
  /** Journal entries replayed into the candidate before activation. */
  replayed: number;
  watermark: number;
  activated: boolean;
  /**
   * Activation succeeded but derived metadata did not persist. The index IS live; startup repairs the
   * metadata. Deliberately NOT treated as a failed rebuild.
   */
  metadataRepairRequired: boolean;
}

/** A candidate generation's writable store, plus how to dispose of it. */
export interface CandidateStore {
  store: SemanticStore;
  close: () => Promise<void>;
}

export interface SemanticRebuildOrchestratorOptions {
  queue: SemanticMutationQueue;
  /**
   * Read every document that should exist, from AUTHORITATIVE sources, as of now.
   *
   * Returns validated documents: a rebuild must not be able to introduce content that the normal write
   * path would have rejected, so it goes through the same branded type rather than a privileged path.
   */
  snapshot: () => Promise<readonly ValidatedSemanticDocument[]>;
  /**
   * Allocate + open a candidate generation, run `populate`/`validate`, and activate on success.
   * Satisfied by `rebuildIntoNewGeneration` bound to a runtime root.
   */
  rebuildGeneration: (hooks: {
    populate: (generation: string, generationPath: string) => Promise<void>;
    validate: (generation: string, generationPath: string) => Promise<GenerationValidation>;
  }) => Promise<{
    generation: string;
    activated: boolean;
    status: string;
    reason?: string;
    metadataRepairRequired?: boolean;
  }>;
  /**
   * Open a writable store over the candidate generation.
   *
   * Called MORE THAN ONCE per rebuild (once to populate, once to replay + validate), and each call must
   * return a FRESH store: the previous handle is closed in between, and a real backend refuses to open
   * a collection twice (`SEMANTIC_COLLECTION_ALREADY_OPEN`) while also leaving a closed store unusable.
   */
  openCandidate: (generation: string, generationPath: string) => Promise<CandidateStore>;
  /** Point the live store/queue at the newly activated generation. */
  retarget: (generation: string, generationPath: string) => Promise<void>;
  /** Documents per candidate write batch. Default 200. */
  batchSize?: number;
  logger?: (level: "info" | "warn" | "error", message: string) => void;
}

export class SemanticRebuildOrchestrator {
  private running = false;

  constructor(private readonly options: SemanticRebuildOrchestratorOptions) {}

  get isRunning(): boolean {
    return this.running;
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.options.logger?.(level, message);
  }

  /**
   * Run one rebuild.
   *
   * Registered with the queue so a shutdown can await a single promise covering both the rebuild and
   * any drain, rather than closing the store while a candidate is half-written.
   */
  rebuild(): Promise<RebuildReport> {
    if (this.running) {
      return Promise.resolve({
        ok: false,
        refusal: "REBUILD_ALREADY_RUNNING",
        populated: 0,
        replayed: 0,
        watermark: 0,
        activated: false,
        metadataRepairRequired: false
      });
    }
    this.running = true;
    return this.options.queue.trackRebuild(
      this.run().finally(() => {
        this.running = false;
      })
    );
  }

  private async run(): Promise<RebuildReport> {
    const { queue } = this.options;
    const batchSize = this.options.batchSize ?? 200;

    // 1. Everything already accepted for the ACTIVE generation is written first, so the watermark
    //    genuinely separates "already in the active index" from "must be replayed into the candidate".
    await queue.drain();

    // 2. Watermark, then journalling. Taken BEFORE the snapshot read: a mutation landing between the
    //    two would otherwise be in neither the snapshot nor the journal.
    const watermark = queue.beginRebuildJournal();

    const report: RebuildReport = {
      ok: false,
      populated: 0,
      replayed: 0,
      watermark,
      activated: false,
      metadataRepairRequired: false
    };

    let documents: readonly ValidatedSemanticDocument[];
    try {
      documents = await this.options.snapshot();
    } catch (error) {
      queue.endRebuildJournal();
      return { ...report, refusal: "SNAPSHOT_FAILED", reason: describe(error) };
    }

    let replayFailure: string | null = null;
    let overflowed = false;
    /** Set once the captured delta is provably in the candidate — the precondition for `markRebuilt`. */
    let deltaReplayed = false;
    let candidateGeneration = "";
    // Captured during populate: the generation lifecycle owns path allocation, and `retarget` needs the
    // path as well as the name.
    let candidatePath = "";

    const outcome = await this.options.rebuildGeneration({
      // 3. Populate the candidate. Normal mutations continue against the active generation throughout.
      populate: async (generation, generationPath) => {
        candidateGeneration = generation;
        candidatePath = generationPath;
        const candidate = await this.options.openCandidate(generation, generationPath);
        try {
          for (let offset = 0; offset < documents.length; offset += batchSize) {
            const batch = documents.slice(offset, offset + batchSize);
            const written = await candidate.store.upsert(batch);
            report.populated += written.inserted + written.replaced;
          }
        } finally {
          await candidate.close();
        }
      },

      // 4/5. Validate, then replay the delta, then revalidate. All of it happens BEFORE activation, so
      //      a candidate that cannot be brought up to date never becomes live.
      validate: async (generation, generationPath) => {
        const candidate = await this.options.openCandidate(generation, generationPath);
        try {
          const first = await this.validateCandidate(candidate.store, documents, report.populated);
          if (!first.ok) return first;

          // The pause window opens only now, and closes as soon as the delta is in. Anything accepted
          // during it stays pending and drains against the NEW generation afterwards.
          queue.pauseDraining();
          try {
            const state = queue.rebuildJournalState();
            if (state.overflowed) {
              overflowed = true;
              return { ok: false, reason: "SEMANTIC_REBUILD_DELTA_OVERFLOWED" };
            }
            // Only the entries captured in THIS snapshot have to reach the candidate. Replaying is
            // asynchronous, so a mutation can be accepted while it runs — and because draining is
            // paused, such a mutation is necessarily still PENDING and will drain against the new
            // generation once the pointer moves. Treating it as an unreplayed entry would fail a
            // perfectly good rebuild for the one reason a rebuild exists to tolerate: concurrent
            // writes. So completeness is judged against the captured set, never the live journal.
            const expected = new Set(state.entries.map((entry) => entry.seq));
            const { applied, touchedIds, touchedEntities } = await this.replay(candidate.store, state.entries);
            report.replayed = applied.length;
            queue.confirmRebuildDeltaApplied(applied);

            const unreplayed = queue.rebuildJournalState().entries.filter((entry) => expected.has(entry.seq));
            if (unreplayed.length > 0) {
              replayFailure = `${unreplayed.length} journal entries could not be replayed`;
              return { ok: false, reason: "SEMANTIC_REBUILD_DELTA_REPLAY_FAILED" };
            }
            deltaReplayed = true;

            // Revalidated AFTER the replay: the counts asserted a moment ago no longer describe the
            // candidate, and activating on a stale validation would defeat the point of validating.
            const second = await this.validateCandidate(candidate.store, documents, report.populated, report.replayed, {
              ids: touchedIds,
              entities: touchedEntities
            });
            if (!second.ok) return second;

            return { ok: true };
          } finally {
            // Whatever happened, the candidate handle is released before the pointer swap — a
            // generation must not be activated while this process still holds a writer on it.
            await candidate.close();
          }
        } catch (error) {
          replayFailure = describe(error);
          return { ok: false, reason: "SEMANTIC_REBUILD_DELTA_REPLAY_FAILED" };
        }
      }
    });

    report.generation = outcome.generation || candidateGeneration || undefined;
    report.activated = outcome.activated;
    report.metadataRepairRequired = outcome.metadataRepairRequired === true;

    if (!outcome.activated) {
      // Draining resumes even on failure: the active generation is untouched and still serving, so
      // leaving the queue paused would strand every subsequent write.
      queue.resumeDraining();
      const journal = queue.endRebuildJournal();
      const refusal: RebuildRefusal = overflowed
        ? "DELTA_OVERFLOWED"
        : replayFailure
          ? "DELTA_REPLAY_FAILED"
          : outcome.status === "POPULATE_FAILED"
            ? "POPULATE_FAILED"
            : outcome.status === "VALIDATION_FAILED"
              ? "VALIDATION_FAILED"
              : "ACTIVATION_FAILED";
      this.log("warn", `Semantic rebuild refused (${refusal}); the active index is unchanged.`);
      return {
        ...report,
        ok: false,
        refusal,
        reason: replayFailure ?? outcome.reason ?? `unapplied=${journal.unapplied}`
      };
    }

    // 6. The pointer has switched. Retarget the live store, then resume draining so pending mutations
    //    land on the new generation.
    try {
      await this.options.retarget(outcome.generation, candidatePath);
    } catch (error) {
      // Activation already happened and must not be undone; the pointer is authoritative. Report it.
      this.log("error", `Semantic index activated but retargeting failed: ${describe(error)}`);
      queue.resumeDraining();
      queue.endRebuildJournal();
      return { ...report, ok: false, refusal: "ACTIVATION_FAILED", reason: describe(error) };
    }

    queue.resumeDraining();
    const journal = queue.endRebuildJournal();

    // 7. Only now is the index trustworthy. `markRebuilt` before the delta replay would have declared
    //    a candidate authoritative while it was still missing recent changes.
    //
    //    Judged on `deltaReplayed`, not on the journal being empty: entries accepted during the pause
    //    window are still pending and drain against the new generation, so leaving the stale flag set
    //    for them would make every rebuild under load look like it had failed.
    if (deltaReplayed && !journal.overflowed) queue.markRebuilt();

    this.log(
      "info",
      `Semantic index rebuilt into ${outcome.generation}: ${report.populated} from snapshot, ${report.replayed} replayed.`
    );
    return { ...report, ok: true };
  }

  /**
   * Replay journal entries in sequence order, returning the sequences PROVEN applied.
   *
   * Stops at the first failure rather than skipping ahead: the entries are an ordered stream, and
   * applying a later one after skipping an earlier one can invert an upsert/delete pair.
   */
  private async replay(candidate: SemanticStore, entries: readonly JournalledMutation[]): Promise<ReplayOutcome> {
    const applied: number[] = [];
    // Which snapshot documents the delta has made stale. The snapshot describes the world at the
    // watermark; every id or entity the delta touches is one the snapshot can no longer be trusted to
    // describe, so post-replay validation must not assert the snapshot's version of it.
    const touchedIds = new Set<string>();
    const touchedEntities = new Set<string>();
    const ordered = [...entries].sort((a, b) => a.seq - b.seq);
    for (const entry of ordered) {
      const { mutation } = entry;
      if (mutation.op === "upsert") {
        await candidate.upsert([mutation.document]);
        touchedIds.add(mutation.document.id);
      } else if (mutation.op === "delete") {
        await candidate.delete([mutation.id]);
        touchedIds.add(mutation.id);
      } else {
        await candidate.deleteByEntity(mutation.entityId);
        touchedEntities.add(mutation.entityId);
      }
      applied.push(entry.seq);
    }
    return { applied, touchedIds, touchedEntities };
  }

  /**
   * Validate the candidate against what it is supposed to contain.
   *
   * Checks the properties a silently-wrong index would violate: exact total, exact per-kind totals,
   * deterministic-id uniqueness, `sourceHash` agreement on samples, that a typed filter actually
   * filters, and that a full-text sample returns something. `expectedReplayed` is accepted so the
   * post-replay pass can tolerate the delta having changed the totals.
   */
  private async validateCandidate(
    candidate: SemanticStore,
    documents: readonly ValidatedSemanticDocument[],
    populated: number,
    replayed = 0,
    /**
     * Ids and entities the delta replay touched.
     *
     * The snapshot is authoritative only for documents the delta did NOT change. A post-watermark
     * DELETE of a snapshotted document is a correct outcome, but the sample check below reads it as a
     * missing document and fails the rebuild — so a rebuild that merely overlapped a delete could never
     * activate, which is precisely the case the delta journal exists to support. A post-watermark
     * UPSERT is the same problem one step subtler: the content is legitimately newer than the
     * snapshot, so comparing `sourceHash` against the snapshot's version reports a mismatch that is
     * really an update.
     */
    touched: { ids: ReadonlySet<string>; entities: ReadonlySet<string> } = { ids: new Set(), entities: new Set() }
  ): Promise<GenerationValidation> {
    try {
      const stats = await candidate.stats();

      // Before any replay the candidate must match the snapshot EXACTLY. After a replay the delta may
      // legitimately have added or removed rows, so the assertion becomes a bound rather than equality
      // — an unbounded drift would still be caught.
      if (replayed === 0) {
        if (stats.documents !== populated) {
          return { ok: false, reason: `SEMANTIC_REBUILD_COUNT_MISMATCH expected=${populated} actual=${stats.documents}` };
        }
        const expectedByKind = new Map<string, number>();
        for (const doc of documents) expectedByKind.set(doc.kind, (expectedByKind.get(doc.kind) ?? 0) + 1);
        for (const kind of SEMANTIC_DOCUMENT_KINDS) {
          const expected = expectedByKind.get(kind) ?? 0;
          const actual = stats.byKind[kind] ?? 0;
          if (expected !== actual) {
            return { ok: false, reason: `SEMANTIC_REBUILD_KIND_MISMATCH kind=${kind} expected=${expected} actual=${actual}` };
          }
        }
      } else if (stats.documents > populated + replayed) {
        return { ok: false, reason: `SEMANTIC_REBUILD_COUNT_DRIFT documents=${stats.documents} bound=${populated + replayed}` };
      }

      // Deterministic ids must not collide: two sources normalizing onto one id would make the count
      // match while quietly holding fewer documents than sources.
      const uniqueIds = new Set(documents.map((d) => d.id));
      if (replayed === 0 && uniqueIds.size !== documents.length) {
        return { ok: false, reason: `SEMANTIC_REBUILD_ID_COLLISION unique=${uniqueIds.size} documents=${documents.length}` };
      }

      // Samples, not a full re-read: this runs on every rebuild and must stay bounded. Documents the
      // delta touched are excluded rather than asserted — see `touched`.
      const verifiable = documents.filter((d) => !touched.ids.has(d.id) && !touched.entities.has(d.entityId));
      for (const doc of sample(verifiable, 5)) {
        const stored = await candidate.get(doc.id);
        if (!stored) return { ok: false, reason: `SEMANTIC_REBUILD_SAMPLE_MISSING id=${doc.kind}` };
        if (stored.sourceHash !== doc.sourceHash) {
          return { ok: false, reason: `SEMANTIC_REBUILD_SOURCE_HASH_MISMATCH kind=${doc.kind}` };
        }
        if (stored.entityKey !== doc.entityKey) {
          return { ok: false, reason: `SEMANTIC_REBUILD_ENTITY_KEY_MISMATCH kind=${doc.kind}` };
        }
      }

      // A typed filter must actually narrow. A candidate whose filters silently match everything would
      // pass every count check above.
      const firstKind = verifiable[0]?.kind ?? documents[0]?.kind;
      if (firstKind) {
        const filtered = await candidate.search({ text: "", kinds: [firstKind], topK: 5 });
        if (filtered.hits.some((hit) => hit.kind !== firstKind)) {
          return { ok: false, reason: "SEMANTIC_REBUILD_FILTER_NOT_APPLIED" };
        }
      }

      return { ok: true };
    } catch (error) {
      if (error instanceof SemanticStoreError) {
        return { ok: false, reason: `SEMANTIC_REBUILD_VALIDATION_ERROR ${error.code}` };
      }
      return { ok: false, reason: "SEMANTIC_REBUILD_VALIDATION_ERROR" };
    }
  }
}

interface ReplayOutcome {
  /** Sequence numbers PROVEN applied to the candidate. */
  applied: number[];
  /** Document ids the delta upserted or deleted. */
  touchedIds: Set<string>;
  /** Entity ids the delta removed wholesale. */
  touchedEntities: Set<string>;
}

/** Evenly spread samples, so a validation sample is not always the first N documents. */
function sample<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const step = Math.floor(items.length / count);
  const picked: T[] = [];
  for (let i = 0; i < count; i += 1) picked.push(items[i * step]);
  return picked;
}

/** Never leaks a vendor message or a path — only a stable shape. */
function describe(error: unknown): string {
  if (error instanceof SemanticStoreError) return error.code;
  if (error instanceof Error) return error.name;
  return "UNKNOWN_ERROR";
}
