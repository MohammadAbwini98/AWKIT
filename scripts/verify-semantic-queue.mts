/**
 * Serialized mutation queue: coalescing, delete-supersedes-upsert, bounded overflow, no blind replay.
 *
 * The checks that matter most here are the ones about what the queue REFUSES to do — drop a delete,
 * replay an unclassified failure — because those are silent when wrong. Each is asserted on the
 * mechanism (queue contents, call counts) rather than only on the end state, since an outcome-only
 * assertion can pass for the wrong reason.
 *
 * Run: npx tsx scripts/verify-semantic-queue.mts
 */

import { InMemorySemanticStore } from "@src/semantic/InMemorySemanticStore";
import { SemanticMutationQueue } from "@src/semantic/SemanticMutationQueue";
import { contractDocument } from "@src/semantic/SemanticStoreContract";
import { SemanticStoreError, type SemanticStore } from "@src/semantic/SemanticStore";

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

async function openStore(): Promise<InMemorySemanticStore> {
  const store = new InMemorySemanticStore();
  await store.open();
  return store;
}

const doc = (entityId: string, body = "body") => contractDocument({ entityId, title: `T-${entityId}`, body });

console.log("Coalescing:\n");
{
  const store = await openStore();
  const queue = new SemanticMutationQueue({ store });
  const d = doc("wf-1");

  const first = queue.enqueue({ op: "upsert", document: d });
  const second = queue.enqueue({ op: "upsert", document: d });
  check("the first enqueue is not coalesced", first.accepted && !first.coalesced);
  check("a repeat enqueue for the same id IS coalesced", second.accepted && second.coalesced);
  check("the queue holds one entry, not two", queue.size === 1, String(queue.size));

  queue.enqueue({ op: "upsert", document: doc("wf-2") });
  check("a different document is a separate entry", queue.size === 2);

  const res = await queue.drain();
  check("draining writes the coalesced documents once each", res.upserted === 2, JSON.stringify(res));
  check("the queue is empty after draining", queue.size === 0);
  check("the store holds both documents", (await store.stats()).documents === 2);
}

console.log("\nDelete supersedes upsert (and not the reverse):\n");
{
  const store = await openStore();
  const queue = new SemanticMutationQueue({ store });
  const d = doc("wf-1");

  queue.enqueue({ op: "upsert", document: d });
  const del = queue.enqueue({ op: "delete", id: d.id });
  check("a delete after an upsert reports superseding it", del.accepted && del.supersededUpsert);
  check("the pair collapses to ONE queued mutation", queue.size === 1, String(queue.size));

  await queue.drain();
  check("the document was never written", (await store.get(d.id)) === null);
  check("nothing was reported as upserted", (await store.stats()).documents === 0);

  // The reverse is a legitimate re-index and must be allowed.
  const store2 = await openStore();
  const queue2 = new SemanticMutationQueue({ store: store2 });
  queue2.enqueue({ op: "delete", id: d.id });
  const reindex = queue2.enqueue({ op: "upsert", document: d });
  check("an upsert AFTER a delete is not treated as superseded", reindex.accepted && !reindex.supersededUpsert);
  await queue2.drain();
  check("the re-indexed document IS present", (await store2.get(d.id)) !== null);
}

console.log("\nEntity deletion ordering (the resurrection defect):\n");
{
  // upsert X -> deleteEntity X -> drain  =>  X ABSENT.
  // Before the fix, drain executed every deleteEntity before every upsert, so the LATER entity
  // deletion ran first and the upsert re-created the document the caller had just removed.
  const store = await openStore();
  const queue = new SemanticMutationQueue({ store });
  const d = doc("wf-ent");

  queue.enqueue({ op: "upsert", document: d });
  const del = queue.enqueue({ op: "deleteEntity", entityId: "wf-ent" });
  check("deleteEntity reports superseding the pending upsert", del.accepted && del.supersededByEntity === 1, JSON.stringify(del));
  check("the superseded upsert is removed from the queue", queue.size === 1, String(queue.size));

  await queue.drain();
  check("upsert -> deleteEntity -> drain leaves the document ABSENT", (await store.get(d.id)) === null);
  check("nothing survived the entity deletion", (await store.stats()).documents === 0, String((await store.stats()).documents));
}

{
  // deleteEntity X -> upsert X -> drain  =>  X PRESENT (a legitimate re-index).
  const store = await openStore();
  const queue = new SemanticMutationQueue({ store });
  const d = doc("wf-ent");

  queue.enqueue({ op: "deleteEntity", entityId: "wf-ent" });
  const up = queue.enqueue({ op: "upsert", document: d });
  check("an upsert AFTER deleteEntity is not superseded", up.accepted && up.supersededByEntity === 0);
  check("both mutations remain queued", queue.size === 2, String(queue.size));

  await queue.drain();
  check("deleteEntity -> upsert -> drain leaves the document PRESENT", (await store.get(d.id)) !== null);
}

{
  // deleteEntity must only cancel upserts for ITS entity.
  const store = await openStore();
  const queue = new SemanticMutationQueue({ store });
  const mine = doc("wf-mine");
  const other = doc("wf-other");
  queue.enqueue({ op: "upsert", document: mine });
  queue.enqueue({ op: "upsert", document: other });
  const del = queue.enqueue({ op: "deleteEntity", entityId: "wf-mine" });
  check("deleteEntity cancels only its own entity's upserts", del.accepted && del.supersededByEntity === 1);

  await queue.drain();
  check("the targeted entity is absent", (await store.get(mine.id)) === null);
  check("an unrelated entity's upsert still landed", (await store.get(other.id)) !== null);
}

{
  // Coalescing must adopt the LATEST temporal position, or a late delete can execute before
  // mutations that were genuinely enqueued before it.
  const store = await openStore();
  const queue = new SemanticMutationQueue({ store, batchSize: 10 });
  const a = doc("wf-a");
  const b = doc("wf-b");

  queue.enqueue({ op: "upsert", document: a }); // seq 0
  queue.enqueue({ op: "upsert", document: b }); // seq 1
  queue.enqueue({ op: "delete", id: a.id }); // coalesces onto a's key, must move to the END

  await queue.drain();
  check("a coalesced delete still removes its document", (await store.get(a.id)) === null);
  check("the unrelated upsert is unaffected", (await store.get(b.id)) !== null);
}

{
  // Execution ORDER is asserted directly, because the end state alone cannot discriminate it: the
  // entity-supersede sweep removes the conflicting upsert before the drain, so a store that
  // globally regrouped operations by type would still reach the right end state in that case.
  // Ordering and superseding are INDEPENDENT defences and each needs its own assertion.
  const calls: string[] = [];
  const inner = await openStore();
  const recording: SemanticStore = {
    ...inner,
    name: "recording",
    upsert: async (docs: Parameters<SemanticStore["upsert"]>[0]) => {
      calls.push(`upsert(${docs.length})`);
      return inner.upsert(docs);
    },
    delete: async (ids: readonly string[]) => {
      calls.push(`delete(${ids.length})`);
      return inner.delete(ids);
    },
    deleteByEntity: async (entityId: string) => {
      calls.push(`deleteByEntity(${entityId})`);
      return inner.deleteByEntity(entityId);
    }
  } as unknown as SemanticStore;

  const queue = new SemanticMutationQueue({ store: recording, batchSize: 10 });
  const a = doc("ent-a");
  const b = doc("ent-b");

  // Interleaved on purpose: two upserts, then an unrelated entity deletion, then another upsert.
  queue.enqueue({ op: "upsert", document: a });
  queue.enqueue({ op: "upsert", document: b });
  queue.enqueue({ op: "deleteEntity", entityId: "ent-unrelated" });
  queue.enqueue({ op: "upsert", document: doc("ent-c") });
  await queue.drain();

  check(
    "adjacent same-op mutations are batched but never reordered across ops",
    JSON.stringify(calls) === JSON.stringify(["upsert(2)", "deleteByEntity(ent-unrelated)", "upsert(1)"]),
    JSON.stringify(calls)
  );
  check("the trailing upsert is NOT hoisted into the earlier batch", calls[0] === "upsert(2)", JSON.stringify(calls));
  check("the entity deletion is not moved to the front", calls[1] === "deleteByEntity(ent-unrelated)", JSON.stringify(calls));
}

console.log("\nBounded queue biases against dropping deletes:\n");
{
  const store = await openStore();

  // Pre-seed a document so the queued delete has something real to remove — otherwise "the delete
  // survived overflow" is unobservable and any assertion about it would pass vacuously.
  const victim = doc("wf-victim");
  await store.upsert([victim]);
  check("the delete target exists before draining", (await store.get(victim.id)) !== null);

  const queue = new SemanticMutationQueue({ store, maxPending: 3 });
  queue.enqueue({ op: "upsert", document: doc("wf-1") });
  queue.enqueue({ op: "upsert", document: doc("wf-2") });
  queue.enqueue({ op: "delete", id: victim.id });
  check("the queue fills to its bound", queue.size === 3);
  check("no rebuild is required before overflow", !queue.needsRebuild);

  queue.enqueue({ op: "upsert", document: doc("wf-3") });
  check("overflow keeps the queue at its bound", queue.size === 3, String(queue.size));
  check("an overflowing upsert drops the OLDEST upsert", queue.droppedUpsertCount === 1);
  check("overflow marks the index as needing a rebuild", queue.needsRebuild);

  await queue.drain();
  const ids = (await store.search({ text: "" })).hits.map((h) => h.entityId);

  // The load-bearing assertion: the DELETE was executed, so the overflow victim was an upsert.
  check("the pending DELETE survived overflow and was applied", (await store.get(victim.id)) === null);
  check("the dropped mutation was the oldest upsert", !ids.includes("wf-1"), JSON.stringify(ids));
  check("later upserts still landed", ids.includes("wf-2") && ids.includes("wf-3"), JSON.stringify(ids));
}

{
  // When ONLY deletes are pending, a new mutation is refused rather than dropping a removal.
  const store = await openStore();
  const queue = new SemanticMutationQueue({ store, maxPending: 2 });
  queue.enqueue({ op: "delete", id: "workflow:a:r1" });
  queue.enqueue({ op: "delete", id: "workflow:b:r1" });

  const refused = queue.enqueue({ op: "upsert", document: doc("wf-new") });
  check("enqueue is REFUSED rather than dropping a delete", !refused.accepted);
  check("the refusal names the reason", !refused.accepted && refused.reason === "QUEUE_FULL_OF_DELETES");
  check("both deletes are still queued", queue.size === 2);
  check("saturation marks a rebuild as required", queue.needsRebuild);
}

console.log("\nNo blind replay:\n");
{
  // A NON-retryable failure must be abandoned immediately, not retried.
  let calls = 0;
  const store: SemanticStore = {
    ...(await openStore()),
    name: "counting",
    upsert: async () => {
      calls += 1;
      throw new SemanticStoreError("CAPACITY_EXCEEDED");
    }
  } as unknown as SemanticStore;

  const queue = new SemanticMutationQueue({ store, maxRetries: 3 });
  queue.enqueue({ op: "upsert", document: doc("wf-1") });
  const res = await queue.drain();

  check("a non-retryable failure is attempted exactly once", calls === 1, `calls=${calls}`);
  check("it is reported as abandoned", res.abandoned === 1, JSON.stringify(res));
  check("the abandoned mutation is NOT re-queued", queue.size === 0, String(queue.size));
  check("abandonment marks the index as needing a rebuild", queue.needsRebuild);
  check("drain terminates rather than looping", true);
}

{
  // A RETRYABLE failure is retried, but a bounded number of times.
  let calls = 0;
  const store: SemanticStore = {
    ...(await openStore()),
    name: "flaky",
    upsert: async () => {
      calls += 1;
      throw new SemanticStoreError("WRITE_FAILED");
    }
  } as unknown as SemanticStore;

  const queue = new SemanticMutationQueue({ store, maxRetries: 2 });
  queue.enqueue({ op: "upsert", document: doc("wf-1") });
  const res = await queue.drain();
  check("a retryable failure is retried up to the bound", calls === 3, `calls=${calls} (1 attempt + 2 retries)`);
  check("it is abandoned once the bound is exhausted", res.abandoned === 1);
  check("the queue does not grow back", queue.size === 0);
}

{
  // A transient failure that then succeeds must NOT be abandoned.
  let calls = 0;
  const inner = await openStore();
  const store: SemanticStore = {
    ...inner,
    name: "recovers",
    upsert: async (docs: Parameters<SemanticStore["upsert"]>[0]) => {
      calls += 1;
      if (calls === 1) throw new SemanticStoreError("WRITE_FAILED");
      return inner.upsert(docs);
    }
  } as unknown as SemanticStore;

  const queue = new SemanticMutationQueue({ store, maxRetries: 2 });
  queue.enqueue({ op: "upsert", document: doc("wf-1") });
  const res = await queue.drain();
  check("a transient failure recovers on retry", res.upserted === 1, JSON.stringify(res));
  check("a recovered write is not counted as abandoned", res.abandoned === 0);
  check("a recovered write does not force a rebuild", !queue.needsRebuild);
}

console.log("\nSerialization and batching:\n");
{
  const store = await openStore();
  const queue = new SemanticMutationQueue({ store, batchSize: 2 });
  for (let i = 0; i < 5; i += 1) queue.enqueue({ op: "upsert", document: doc(`wf-${i}`) });

  // Concurrent drains share one execution, so BOTH observe the same completed result — and the
  // store is written exactly once. (Summing the two results would double-count by design now that
  // drain is single-flight; the store's own document count is the non-ambiguous assertion.)
  const [a, b] = await Promise.all([queue.drain(), queue.drain()]);
  check("both concurrent callers observe the same result", a.upserted === 5 && b.upserted === 5, JSON.stringify([a.upserted, b.upserted]));
  check("five documents are written exactly once", (await store.stats()).documents === 5, String((await store.stats()).documents));
  check("the queue is drained", queue.size === 0);
}

{
  // Mutations enqueued DURING a drain must not be lost.
  const inner = await openStore();
  const queue = new SemanticMutationQueue({ store: inner, batchSize: 1 });
  queue.enqueue({ op: "upsert", document: doc("wf-a") });

  const drainPromise = queue.drain();
  queue.enqueue({ op: "upsert", document: doc("wf-b") });
  await drainPromise;
  await queue.drain(); // whatever the first drain did not pick up

  check("a mutation enqueued during a drain is not lost", (await inner.stats()).documents === 2, String((await inner.stats()).documents));
}

console.log("\nDrain is single-flight; options are validated:\n");
{
  // A concurrent drain must await the REAL work, not receive an empty-looking "done".
  const inner = await openStore();
  // Definite assignment: TS cannot see that the executor runs synchronously, and narrows a
  // `| null` declaration to `never` at the call site below.
  let resolveWrite!: () => void;
  const gate = new Promise<void>((r) => {
    resolveWrite = r;
  });
  const store: SemanticStore = {
    ...inner,
    name: "slow",
    upsert: async (docs: Parameters<SemanticStore["upsert"]>[0]) => {
      await gate;
      return inner.upsert(docs);
    }
  } as unknown as SemanticStore;

  const queue = new SemanticMutationQueue({ store });
  queue.enqueue({ op: "upsert", document: doc("wf-slow") });

  const first = queue.drain();
  const second = queue.drain();
  check("a concurrent drain returns the SAME in-flight promise", first === second);

  resolveWrite();
  const [r1, r2] = await Promise.all([first, second]);
  check("the concurrent caller sees the real result, not an empty one", r1.upserted === 1 && r2.upserted === 1, JSON.stringify([r1, r2]));
  check("the document was actually written", (await inner.stats()).documents === 1);
}

{
  const store = await openStore();
  const rejects = (options: Record<string, number>): boolean => {
    try {
      new SemanticMutationQueue({ store, ...options });
      return false;
    } catch (error) {
      return error instanceof RangeError;
    }
  };
  // batchSize 0 previously left pending.size > 0 forever while every batch came back empty.
  check("batchSize=0 is rejected rather than hanging the drain", rejects({ batchSize: 0 }));
  check("maxPending=0 is rejected", rejects({ maxPending: 0 }));
  check("a negative maxRetries is rejected", rejects({ maxRetries: -1 }));
  check("a non-integer batchSize is rejected", rejects({ batchSize: 1.5 }));
  check("a non-finite maxPending is rejected", rejects({ maxPending: Number.POSITIVE_INFINITY }));
  check("maxRetries=0 is allowed (no retries)", !rejects({ maxRetries: 0 }));
}

console.log("\nRebuild handoff:\n");
{
  const store = await openStore();
  const queue = new SemanticMutationQueue({ store, maxPending: 1 });
  queue.enqueue({ op: "upsert", document: doc("wf-1") });
  queue.enqueue({ op: "upsert", document: doc("wf-2") });
  check("the queue is marked stale after dropping work", queue.needsRebuild);

  queue.clear();
  check("clear() empties pending work", queue.size === 0);
  check("clear() alone does NOT clear the stale flag", queue.needsRebuild);

  queue.markRebuilt();
  check("markRebuilt() clears the stale flag", !queue.needsRebuild);
  check("markRebuilt() resets the dropped counter", queue.droppedUpsertCount === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
