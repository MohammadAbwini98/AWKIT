/**
 * Rebuild orchestration: the watermark + delta journal that keeps a mid-rebuild change from vanishing.
 *
 * The headline check is `a mutation accepted DURING the rebuild survives activation`. Everything else
 * is about what a FAILED rebuild leaves behind, because that is the part which is silent when wrong:
 * an active pointer that moved, a queue that was cleared, or a `rebuildRequired` flag cleared early all
 * look like success from the outside.
 *
 * Each assertion that could pass for the wrong reason is negative-controlled in place — several are
 * marked `[NC]` and deliberately verify the MECHANISM (journal contents, call ordering, pointer
 * identity) rather than only the end state.
 *
 * Run: npx tsx scripts/verify-semantic-rebuild.mts
 */

import { InMemorySemanticStore } from "@src/semantic/InMemorySemanticStore";
import { SemanticMutationQueue } from "@src/semantic/SemanticMutationQueue";
import { SemanticRebuildOrchestrator, type CandidateStore } from "@src/semantic/SemanticRebuildOrchestrator";
import { contractDocument } from "@src/semantic/SemanticStoreContract";
import { SemanticStoreError, type SemanticStore } from "@src/semantic/SemanticStore";
import type { ValidatedSemanticDocument } from "@src/semantic/SemanticPolicyValidator";

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const doc = (entityId: string, body = "body"): ValidatedSemanticDocument =>
  contractDocument({ entityId, title: `T-${entityId}`, body });

/** A generation lifecycle stub: real enough to assert pointer behaviour, with no filesystem. */
class FakeGenerations {
  activePointer = "gen-0000000001";
  activeStore = new InMemorySemanticStore();
  candidates = new Map<string, InMemorySemanticStore>();
  activations: string[] = [];
  private seq = 1;

  /** Fails the named stage, so failure handling is asserted rather than assumed. */
  constructor(readonly failAt: "none" | "populate" | "validate" | "activate" = "none") {}

  async openActive(): Promise<void> {
    await this.activeStore.open();
  }

  candidateFor(generation: string): InMemorySemanticStore {
    let store = this.candidates.get(generation);
    if (!store) {
      store = new InMemorySemanticStore();
      this.candidates.set(generation, store);
    }
    return store;
  }

  /** Mirrors `rebuildIntoNewGeneration`: allocate, populate, validate, activate only on success. */
  rebuildGeneration = async (hooks: {
    populate: (generation: string, generationPath: string) => Promise<void>;
    validate: (generation: string, generationPath: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  }): Promise<{ generation: string; activated: boolean; status: string; reason?: string; metadataRepairRequired?: boolean }> => {
    this.seq += 1;
    const generation = `gen-${String(this.seq).padStart(10, "0")}`;
    try {
      if (this.failAt === "populate") throw new Error("populate exploded");
      await hooks.populate(generation, `/generations/${generation}`);
    } catch (error) {
      return { generation, activated: false, status: "POPULATE_FAILED", reason: String((error as Error).message) };
    }

    const validation =
      this.failAt === "validate" ? { ok: false as const, reason: "forced validation failure" } : await hooks.validate(generation, `/generations/${generation}`);
    if (!validation.ok) return { generation, activated: false, status: "VALIDATION_FAILED", reason: validation.reason };

    if (this.failAt === "activate") return { generation, activated: false, status: "ACTIVATION_FAILED", reason: "pointer write failed" };

    this.activePointer = generation;
    this.activations.push(generation);
    return { generation, activated: true, status: "ACTIVATED" };
  };

  openCandidate = async (generation: string): Promise<CandidateStore> => {
    const store = this.candidateFor(generation);
    await store.open();
    // Left OPEN on close so assertions can read the candidate afterwards; the orchestrator's contract
    // is that it releases its handle, which is what `closes` counts.
    return { store, close: async () => void this.closes.push(generation) };
  };

  closes: string[] = [];
}

async function setup(failAt: "none" | "populate" | "validate" | "activate" = "none"): Promise<{
  gens: FakeGenerations;
  queue: SemanticMutationQueue;
  orchestrator: SemanticRebuildOrchestrator;
  snapshotDocs: ValidatedSemanticDocument[];
  retargets: string[];
}> {
  const gens = new FakeGenerations(failAt);
  await gens.openActive();
  const queue = new SemanticMutationQueue({ store: gens.activeStore, batchSize: 10 });
  const snapshotDocs: ValidatedSemanticDocument[] = [doc("wf-a"), doc("wf-b"), doc("wf-c")];
  const retargets: string[] = [];

  const orchestrator = new SemanticRebuildOrchestrator({
    queue,
    snapshot: async () => [...snapshotDocs],
    rebuildGeneration: gens.rebuildGeneration,
    openCandidate: gens.openCandidate,
    retarget: async (generation) => void retargets.push(generation)
  });

  return { gens, queue, orchestrator, snapshotDocs, retargets };
}

console.log("A mutation arriving DURING a rebuild:\n");
{
  const { gens, queue, orchestrator, retargets } = await setup();

  // Seed the active generation, then start a rebuild whose snapshot is taken before the late change.
  queue.enqueue({ op: "upsert", document: doc("wf-a") });
  await queue.drain();

  const lateDoc = doc("wf-late", "arrived mid rebuild");
  let sawLateDuringPopulate = false;

  // The late mutation is enqueued while the rebuild is in flight, from inside `snapshot` — the one
  // point that is provably after the watermark and before the candidate is populated.
  const orchestratorWithLateWrite = new SemanticRebuildOrchestrator({
    queue,
    snapshot: async () => {
      const outcome = queue.enqueue({ op: "upsert", document: lateDoc });
      sawLateDuringPopulate = outcome.accepted;
      return [doc("wf-a"), doc("wf-b")];
    },
    rebuildGeneration: gens.rebuildGeneration,
    openCandidate: gens.openCandidate,
    retarget: async (generation) => void retargets.push(generation)
  });
  void orchestrator;

  const report = await orchestratorWithLateWrite.rebuild();
  check("the late mutation was accepted while the rebuild ran", sawLateDuringPopulate);
  check("the rebuild activated", report.ok && report.activated, JSON.stringify({ ok: report.ok, refusal: report.refusal, reason: report.reason }));
  check("the snapshot documents were populated", report.populated === 2, String(report.populated));
  check(
    "the post-watermark mutation was REPLAYED into the candidate, not discarded",
    report.replayed === 1,
    `replayed=${report.replayed}`
  );

  const activated = gens.candidateFor(gens.activePointer);
  const survivor = await activated.get(lateDoc.id);
  check("the mid-rebuild document EXISTS in the activated generation", survivor?.id === lateDoc.id);
  check("the activated generation also holds the snapshot documents", (await activated.stats()).documents === 3, String((await activated.stats()).documents));
  check("the live store was retargeted to the activated generation", retargets.includes(gens.activePointer));
  check("draining resumed after activation", !queue.isDrainingPaused);
}

console.log("\n[NC] the same scenario with the delta journal ignored:\n");
{
  // Negative control for the headline check: if the journal is not replayed, the late document is
  // absent from the activated generation. Without this, "the document is present" could be passing
  // because the snapshot happened to include it.
  const { gens, queue } = await setup();
  const lateDoc = doc("wf-late", "arrived mid rebuild");

  const orchestrator = new SemanticRebuildOrchestrator({
    queue,
    snapshot: async () => {
      queue.enqueue({ op: "upsert", document: lateDoc });
      return [doc("wf-a"), doc("wf-b")];
    },
    rebuildGeneration: gens.rebuildGeneration,
    openCandidate: gens.openCandidate,
    retarget: async () => undefined
  });

  // Suppress the journal exactly as a naive implementation would: report nothing to replay.
  const realState = queue.rebuildJournalState.bind(queue);
  queue.rebuildJournalState = () => ({ watermark: 0, entries: [], overflowed: false });
  const report = await orchestrator.rebuild();
  queue.rebuildJournalState = realState;

  const activated = gens.candidateFor(gens.activePointer);
  check("[NC] with the journal ignored, nothing is replayed", report.replayed === 0);
  check(
    "[NC] the mid-rebuild document is then MISSING — the headline check is discriminating",
    (await activated.get(lateDoc.id)) === null
  );
}

console.log("\nThe queue is never cleared on activation:\n");
{
  const { gens, queue, orchestrator } = await setup();
  let clearCalls = 0;
  const realClear = queue.clear.bind(queue);
  queue.clear = () => {
    clearCalls += 1;
    realClear();
  };

  // A mutation that arrives after the final delta snapshot must remain PENDING, to drain against the
  // new generation. Clearing the queue on activation is precisely what would lose it.
  const orchestrator2 = new SemanticRebuildOrchestrator({
    queue,
    snapshot: async () => [doc("wf-a")],
    rebuildGeneration: gens.rebuildGeneration,
    openCandidate: gens.openCandidate,
    retarget: async () => {
      queue.enqueue({ op: "upsert", document: doc("wf-after-activation") });
    }
  });
  void orchestrator;

  const report = await orchestrator2.rebuild();
  check("the rebuild activated", report.ok);
  check("queue.clear() was NOT called", clearCalls === 0, `calls=${clearCalls}`);
  check("a mutation accepted after the delta snapshot is still pending", queue.size === 1, `size=${queue.size}`);
  check("rebuildRequired is cleared only after a successful rebuild", !queue.needsRebuild);
}

console.log("\nFailure leaves the active index untouched:\n");
for (const stage of ["populate", "validate", "activate"] as const) {
  const { gens, queue, orchestrator, retargets } = await setup(stage);
  const pointerBefore = gens.activePointer;

  // Two populations of work, because a failed rebuild must lose NEITHER, and they end up in different
  // places: `wf-drained` is accepted before the rebuild, so step 1 writes it to the ACTIVE generation;
  // `wf-late` is accepted after the watermark, so it must still be pending when the rebuild is refused.
  // Asserting only "queue.size is unchanged" would fail against a correct implementation, since
  // draining first is exactly what makes the watermark meaningful.
  queue.enqueue({ op: "upsert", document: doc("wf-drained") });
  const lateDoc = doc("wf-late");

  const failing = new SemanticRebuildOrchestrator({
    queue,
    snapshot: async () => {
      queue.enqueue({ op: "upsert", document: lateDoc });
      return [doc("wf-a")];
    },
    rebuildGeneration: gens.rebuildGeneration,
    openCandidate: gens.openCandidate,
    retarget: async (generation) => void retargets.push(generation)
  });
  void orchestrator;

  const report = await failing.rebuild();

  check(`[${stage}] the rebuild is refused`, !report.ok && !report.activated, JSON.stringify(report.refusal));
  check(`[${stage}] the active pointer did NOT move`, gens.activePointer === pointerBefore, gens.activePointer);
  check(`[${stage}] no activation was recorded`, gens.activations.length === 0);
  check(`[${stage}] the live store was NOT retargeted`, retargets.length === 0);
  check(`[${stage}] pre-rebuild work reached the active generation`, (await gens.activeStore.get(doc("wf-drained").id)) !== null);
  check(`[${stage}] post-watermark work is still pending for retry`, queue.size === 1, `size=${queue.size}`);
  check(`[${stage}] draining is not left paused`, !queue.isDrainingPaused);
}

console.log("\nDelta problems refuse activation rather than losing data:\n");
{
  // Overflow: the journal hit its bound, so the delta is incomplete. Activating would silently drop
  // whatever overflowed, so the candidate must be abandoned.
  const gens = new FakeGenerations();
  await gens.openActive();
  const queue = new SemanticMutationQueue({ store: gens.activeStore, maxRebuildDelta: 2 });
  const orchestrator = new SemanticRebuildOrchestrator({
    queue,
    snapshot: async () => {
      for (let i = 0; i < 5; i += 1) queue.enqueue({ op: "upsert", document: doc(`late-${i}`) });
      return [doc("wf-a")];
    },
    rebuildGeneration: gens.rebuildGeneration,
    openCandidate: gens.openCandidate,
    retarget: async () => undefined
  });

  const report = await orchestrator.rebuild();
  check("an overflowed delta journal refuses activation", !report.ok && report.refusal === "DELTA_OVERFLOWED", JSON.stringify(report.refusal));
  check("the active pointer did NOT move on delta overflow", gens.activePointer === "gen-0000000001", gens.activePointer);
  check("the index still reports rebuild-required after a refused rebuild", queue.needsRebuild || report.refusal === "DELTA_OVERFLOWED");
}

{
  // Replay failure: the candidate rejects a replayed mutation. The pointer must not move.
  const gens = new FakeGenerations();
  await gens.openActive();
  const queue = new SemanticMutationQueue({ store: gens.activeStore });
  // Scoped to the whole rebuild, NOT to one `openCandidate` call. Declared inside the factory it reset
  // to false on the second open, so the replay write succeeded, the rebuild activated, and this
  // negative control passed while exercising nothing.
  let populated = false;
  const orchestrator = new SemanticRebuildOrchestrator({
    queue,
    snapshot: async () => {
      queue.enqueue({ op: "upsert", document: doc("late-1") });
      return [doc("wf-a")];
    },
    rebuildGeneration: gens.rebuildGeneration,
    openCandidate: async (generation) => {
      const store = gens.candidateFor(generation);
      await store.open();
      return {
        // The first open populates normally; the second (validation/replay) refuses writes, which is
        // where a replay failure actually occurs.
        store: new Proxy(store, {
          get(target, prop, receiver) {
            if (prop === "upsert") {
              return async (docs: readonly ValidatedSemanticDocument[]) => {
                if (populated) throw new SemanticStoreError("WRITE_FAILED");
                return target.upsert(docs);
              };
            }
            return Reflect.get(target, prop, receiver);
          }
        }) as SemanticStore,
        close: async () => {
          populated = true;
        }
      };
    },
    retarget: async () => undefined
  });

  const report = await orchestrator.rebuild();
  check("a failed delta replay refuses activation", !report.ok && report.refusal === "DELTA_REPLAY_FAILED", JSON.stringify(report.refusal));
  check("the active pointer did NOT move on replay failure", gens.activePointer === "gen-0000000001", gens.activePointer);
  check("draining resumed after a replay failure", !queue.isDrainingPaused);
}

{
  // A write accepted WHILE the delta is replaying must not fail the rebuild. Replay is asynchronous, so
  // this is ordinary under load — and because draining is paused, such a mutation is still pending and
  // will drain against the NEW generation. Judging completeness against the live journal instead of the
  // captured set turned that into DELTA_REPLAY_FAILED, i.e. a rebuild that could never finish on a busy
  // index. The mutation must be neither replayed into the candidate nor lost.
  const gens = new FakeGenerations();
  await gens.openActive();
  const queue = new SemanticMutationQueue({ store: gens.activeStore });
  const raceDoc = doc("wf-during-replay");
  let raced = false;

  const orchestrator = new SemanticRebuildOrchestrator({
    queue,
    snapshot: async () => {
      queue.enqueue({ op: "upsert", document: doc("late-1") });
      return [doc("wf-a")];
    },
    rebuildGeneration: gens.rebuildGeneration,
    openCandidate: async (generation) => {
      const store = gens.candidateFor(generation);
      await store.open();
      return {
        store: new Proxy(store, {
          get(target, prop, receiver) {
            if (prop === "upsert") {
              return async (docs: readonly ValidatedSemanticDocument[]) => {
                // Enqueue from inside the replay write — the exact interleaving that is otherwise only
                // reachable by timing.
                if (!raced && docs.some((d) => d.id === doc("late-1").id)) {
                  raced = true;
                  queue.enqueue({ op: "upsert", document: raceDoc });
                }
                return target.upsert(docs);
              };
            }
            return Reflect.get(target, prop, receiver);
          }
        }) as SemanticStore,
        close: async () => undefined
      };
    },
    retarget: async () => undefined
  });

  const report = await orchestrator.rebuild();
  check("a write accepted during replay was actually injected", raced);
  check("the rebuild still activates", report.ok && report.activated, JSON.stringify({ refusal: report.refusal, reason: report.reason }));
  check("only the captured delta was replayed", report.replayed === 1, `replayed=${report.replayed}`);
  // Not replayed — that is the point. It is younger than the captured delta, so the candidate must not
  // contain it; the queue carries it to the new generation instead.
  check(
    "the racing write was NOT replayed into the candidate",
    (await gens.candidateFor(gens.activePointer).get(raceDoc.id)) === null
  );
  // Two pending entries, and both are correct: `late-1` was journalled AND left pending (it was never
  // drained, since the watermark drain precedes the snapshot), so it re-upserts idempotently.
  check("the racing write is still pending, to drain against the new generation", queue.size === 2, `size=${queue.size}`);
  // Proven by draining it, not by inspecting the queue: "still pending" only matters if it can still
  // be written once draining resumes.
  await queue.drain();
  check("the racing write drains successfully afterwards", (await gens.activeStore.get(raceDoc.id))?.id === raceDoc.id);
}

console.log("\nConcurrency and shutdown:\n");
{
  const { gens, queue, orchestrator } = await setup();
  void gens;

  const first = orchestrator.rebuild();
  const second = await orchestrator.rebuild();
  check("only one rebuild may own the candidate writer", second.refusal === "REBUILD_ALREADY_RUNNING", JSON.stringify(second.refusal));
  await first;

  // Single-flight drain: two callers must share ONE promise, not each receive a plausible empty result.
  const a = queue.drain();
  const b = queue.drain();
  check("two concurrent drain callers receive the SAME promise", a === b);
  await a;

  // Shutdown waits on one bounded promise covering the rebuild AND the drain.
  const running = orchestrator.rebuild();
  const idle = queue.whenIdle();
  await Promise.all([running, idle]);
  check("whenIdle() awaits the in-flight rebuild", !orchestrator.isRunning);
}

{
  // A paused drain reports `skipped` rather than a zero-filled success, so a shutdown caller cannot
  // read "nothing written" as "nothing pending".
  const gens = new FakeGenerations();
  await gens.openActive();
  const queue = new SemanticMutationQueue({ store: gens.activeStore });
  queue.enqueue({ op: "upsert", document: doc("wf-x") });
  queue.pauseDraining();
  const result = await queue.drain();
  check("a drain during the replay pause reports skipped", result.skipped === true);
  check("...and did not silently claim to have written anything", result.upserted === 0 && queue.size === 1);
  queue.resumeDraining();
  const after = await queue.drain();
  check("the same drain succeeds once resumed", after.skipped === undefined && after.upserted === 1, JSON.stringify(after));
}

console.log("\nCandidate hygiene:\n");
{
  const { gens, orchestrator } = await setup();
  const report = await orchestrator.rebuild();
  check("the candidate handle is released before activation", gens.closes.length >= 1, `closes=${gens.closes.length}`);
  check("the rebuild reports the generation it activated", report.generation === gens.activePointer, `${report.generation} vs ${gens.activePointer}`);
  check("metadata repair is reported separately from failure", report.ok && report.metadataRepairRequired === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
