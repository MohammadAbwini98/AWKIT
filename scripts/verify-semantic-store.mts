/**
 * Runs the shared `SemanticStore` contract against every available implementation, plus the
 * implementation-specific checks that the shared contract deliberately does not cover
 * (injected failures, capacity limits).
 *
 * Phase 1B ships one implementation; `ZvecSemanticStore` joins the same loop, which is the point of
 * keeping the suite in `src/` rather than inline here.
 *
 * Run: npx tsx scripts/verify-semantic-store.mts
 */

import { InMemorySemanticStore, tokenize } from "@src/semantic/InMemorySemanticStore";
import {
  contractDocument,
  runSemanticStoreContract,
  type SemanticStoreFactory
} from "@src/semantic/SemanticStoreContract";
import { SemanticStoreError } from "@src/semantic/SemanticStore";

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

const IMPLEMENTATIONS: Array<{ name: string; factory: SemanticStoreFactory }> = [
  { name: "in-memory", factory: async () => new InMemorySemanticStore() }
  // { name: "zvec", factory: async () => new ZvecSemanticStore(...) }  ← same suite, next step
];

console.log("Shared SemanticStore contract:\n");

for (const impl of IMPLEMENTATIONS) {
  const results = await runSemanticStoreContract(impl.factory, impl.name);
  for (const r of results) check(r.label, r.ok, r.detail);
}

console.log("\nTokenizer (shared by indexing and querying — they must agree):\n");
{
  check("tokenizes on non-alphanumerics", JSON.stringify(tokenize("Login-flow, v2!")) === JSON.stringify(["login", "flow", "v2"]));
  check("drops single characters", !tokenize("a bb").includes("a"));
  check("is case-insensitive", JSON.stringify(tokenize("ABC")) === JSON.stringify(tokenize("abc")));
  check("handles empty input", tokenize("").length === 0);
}

console.log("\nInjected failures (error paths a healthy store never reaches):\n");
{
  const openFail = new InMemorySemanticStore({ failures: { onOpen: true } });
  let code = "";
  try {
    await openFail.open();
  } catch (error) {
    code = error instanceof SemanticStoreError ? error.code : "wrong-type";
  }
  check("an open failure surfaces BACKEND_UNAVAILABLE", code === "BACKEND_UNAVAILABLE", code);

  const writeFail = new InMemorySemanticStore({ failures: { onUpsert: true } });
  await writeFail.open();
  let writeCode = "";
  try {
    await writeFail.upsert([contractDocument({ entityId: "wf-1", title: "T", body: "b" })]);
  } catch (error) {
    writeCode = error instanceof SemanticStoreError ? error.code : "wrong-type";
  }
  check("a write failure surfaces WRITE_FAILED", writeCode === "WRITE_FAILED", writeCode);

  const searchFail = new InMemorySemanticStore({ failures: { onSearch: true } });
  await searchFail.open();
  let searchCode = "";
  try {
    await searchFail.search({ text: "x" });
  } catch (error) {
    searchCode = error instanceof SemanticStoreError ? error.code : "wrong-type";
  }
  check("a query failure surfaces QUERY_FAILED", searchCode === "QUERY_FAILED", searchCode);

  // Mid-batch failure: the queue's retry logic depends on knowing a batch can fail partway.
  const midBatch = new InMemorySemanticStore({ failures: { onUpsertOfId: "" } });
  await midBatch.open();
  const good = contractDocument({ entityId: "wf-ok", title: "OK", body: "fine" });
  const poison = contractDocument({ entityId: "wf-bad", title: "Bad", body: "bad" });
  const store = new InMemorySemanticStore({ failures: { onUpsertOfId: poison.id } });
  await store.open();
  let batchFailed = false;
  try {
    await store.upsert([good, poison]);
  } catch {
    batchFailed = true;
  }
  check("a batch containing a poison document fails as a unit", batchFailed);
  check("nothing from the failed batch is left half-written", (await store.stats()).documents === 0, String((await store.stats()).documents));

  const capped = new InMemorySemanticStore({ maxDocuments: 1 });
  await capped.open();
  await capped.upsert([contractDocument({ entityId: "wf-1", title: "A", body: "a" })]);
  let capCode = "";
  try {
    await capped.upsert([contractDocument({ entityId: "wf-2", title: "B", body: "b" })]);
  } catch (error) {
    capCode = error instanceof SemanticStoreError ? error.code : "wrong-type";
  }
  check("exceeding capacity surfaces CAPACITY_EXCEEDED", capCode === "CAPACITY_EXCEEDED", capCode);
  check(
    "replacing an existing id does NOT count against capacity",
    (await capped.upsert([contractDocument({ entityId: "wf-1", title: "A", body: "a" })])).replaced === 1
  );
}

console.log("\nRanking (deterministic and explainable):\n");
{
  const store = new InMemorySemanticStore();
  await store.open();
  await store.upsert([
    contractDocument({ entityId: "wf-title", title: "payment gateway", body: "unrelated text here" }),
    contractDocument({ entityId: "wf-body", title: "Unrelated", body: "payment gateway mentioned in body only" })
  ]);
  const res = await store.search({ text: "payment gateway" });
  check("a title match outranks a body-only match", res.hits[0]?.entityId === "wf-title", JSON.stringify(res.hits.map((h) => h.entityId)));
  check("both matches are still returned", res.hits.length === 2);
  check("the top hit explains why it won", res.hits[0]?.reasons.some((r) => /title/i.test(r)));

  // A repeated word must not let one document dominate purely by repetition.
  await store.clear();
  await store.upsert([
    contractDocument({ entityId: "wf-spam", title: "Other", body: "alpha ".repeat(50) }),
    contractDocument({ entityId: "wf-real", title: "alpha", body: "a real alpha document" })
  ]);
  const spam = await store.search({ text: "alpha" });
  check("term-frequency is capped so repetition cannot dominate a title match", spam.hits[0]?.entityId === "wf-real", JSON.stringify(spam.hits.map((h) => h.entityId)));
  await store.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
