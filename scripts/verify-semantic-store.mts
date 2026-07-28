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
import { SemanticMutationQueue } from "@src/semantic/SemanticMutationQueue";
import { ZvecSemanticStore, toZvecDocument, fromZvecDocument } from "@src/semantic/ZvecSemanticStore";
import { FakeZvecHostTransport } from "@src/semantic/FakeZvecHostTransport";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildSemanticSnapshot,
  createSemanticSnapshotProvider,
  SemanticSnapshotError
} from "@main/semantic/semanticSnapshot";
import { projectAndValidate } from "@src/semantic/SemanticPolicyValidator";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { createBlankWorkflowProfile, type WorkflowProfile } from "@src/profiles/WorkflowProfile";

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

/**
 * Both implementations run the IDENTICAL suite. The Zvec adapter is driven through a transport fake
 * that speaks the real wire shapes, so the adapter's own logic (field projection, existence
 * pre-reads, filter application, re-validation on read) is exercised for real. It does NOT prove
 * native behaviour — crash isolation, real FTS ranking and on-disk durability need the actual host
 * and are covered by verify:zvec-packaged-live.
 */
const IMPLEMENTATIONS: Array<{ name: string; factory: SemanticStoreFactory }> = [
  { name: "in-memory", factory: async () => new InMemorySemanticStore() },
  {
    name: "zvec",
    factory: async () =>
      new ZvecSemanticStore({
        transport: new FakeZvecHostTransport(),
        generation: "gen-000001",
        generationPath: "/tmp/awkit-semantic/gen-000001"
      })
  }
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

  let timedWriteCalls = 0;
  const timeoutStore = new ZvecSemanticStore({
    generation: "gen-timeout",
    generationPath: "/tmp/awkit-semantic/gen-timeout",
    transport: {
      async call<T>(request: unknown): Promise<T> {
        const type = (request as { type?: string }).type;
        if (type === "open") return { collectionId: "gen-timeout" } as T;
        if (type === "fetch") return { docs: [] } as T;
        if (type === "upsert") {
          timedWriteCalls += 1;
          throw Object.assign(new Error("late host reply"), { reason: "SEMANTIC_HOST_TIMEOUT" });
        }
        return {} as T;
      }
    }
  });
  await timeoutStore.open();
  const timeoutQueue = new SemanticMutationQueue({ store: timeoutStore, maxRetries: 2 });
  timeoutQueue.enqueue({
    op: "upsert",
    document: contractDocument({ entityId: "wf-timeout", title: "Timeout", body: "ambiguous outcome" })
  });
  const timeoutDrain = await timeoutQueue.drain();
  check(
    "an ambiguous host timeout is never blind-replayed",
    timedWriteCalls === 1,
    `${timedWriteCalls} write attempts`
  );
  check(
    "an ambiguous host timeout abandons the queue item and requires authoritative rebuild",
    timeoutDrain.failed === 1 &&
      timeoutDrain.abandoned === 1 &&
      timeoutDrain.rebuildRequired &&
      timeoutQueue.size === 0,
    JSON.stringify(timeoutDrain)
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

console.log("\nRebuild snapshot (authoritative flow + workflow projection):\n");
{
  const flow = (over: Partial<FlowProfile> = {}): FlowProfile => ({
    id: "flow-login",
    name: "Login",
    description: "Signs the user in",
    version: 1,
    nodes: [
      { id: "s1", type: "goto", name: "Open the portal" },
      { id: "s2", type: "fill", name: "Enter username", value: "hunter2" },
      { id: "s3", type: "click", name: "Submit" }
    ],
    edges: [],
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...over
  });

  const workflow = (over: Partial<WorkflowProfile> = {}): WorkflowProfile => {
    const base = createBlankWorkflowProfile("Nightly regression");
    return {
      ...base,
      id: "workflow-nightly",
      nodes: [
        ...base.nodes,
        {
          id: "n1",
          type: "flowRef",
          flowId: "flow-login",
          alias: "Login step",
          order: 2,
          required: true,
          inputBindings: {}
        }
      ],
      updatedAt: "2026-07-28T00:00:00.000Z",
      ...over
    };
  };

  const sourcesOf = (flows: FlowProfile[], workflows: WorkflowProfile[]) => ({
    flows: { list: async () => flows },
    workflows: { list: async () => workflows }
  });

  // Cardinality, not `.every()`: a suite that only asserts "every document is valid" passes
  // vacuously against an empty snapshot, which is precisely the regression that matters here.
  const report = await buildSemanticSnapshot(sourcesOf([flow(), flow({ id: "flow-checkout", name: "Checkout" })], [workflow()]));
  check("the snapshot reads every flow and workflow", report.read === 3, `read=${report.read}`);
  check("the snapshot projects one document per entity", report.documents.length === 3, `${report.documents.length} documents`);
  check("nothing is rejected for a well-formed corpus", report.rejected.length === 0, JSON.stringify(report.rejected));
  check(
    "both kinds are represented",
    report.documents.filter((d) => d.kind === "flow").length === 2 &&
      report.documents.filter((d) => d.kind === "workflow").length === 1,
    JSON.stringify(report.documents.map((d) => d.kind))
  );

  const flowDoc = report.documents.find((d) => d.entityId === "flow-login");
  check("a flow document indexes its step names", /Enter username/.test(flowDoc?.content ?? ""), flowDoc?.content);
  // The single most important assertion in this section: `value` is a forbidden field, and the step
  // that carries it is indexed by NAME. A recorded credential must not reach the index through the
  // step it was typed into.
  check("a recorded step value never reaches the index", !/hunter2/.test(JSON.stringify(report.documents)));

  const workflowDoc = report.documents.find((d) => d.kind === "workflow");
  check(
    "a workflow document resolves referenced flow names",
    /Login/.test(workflowDoc?.content ?? ""),
    workflowDoc?.content
  );

  // One malformed entity must cost exactly itself, not the whole index.
  const mixed = await buildSemanticSnapshot(
    sourcesOf([flow(), flow({ id: "", name: "Nameless" })], [workflow()])
  );
  check("a malformed flow is dropped, not thrown", mixed.documents.length === 2, `${mixed.documents.length} documents`);
  check("the dropped entity is reported", mixed.rejected.length === 1 && mixed.rejected[0]?.kind === "flow", JSON.stringify(mixed.rejected));
  check(
    "read minus rejected accounts for every document",
    mixed.read - mixed.rejected.length === mixed.documents.length,
    `${mixed.read} - ${mixed.rejected.length} != ${mixed.documents.length}`
  );

  // A forbidden field ANYWHERE in the source rejects the document rather than being dropped quietly.
  const forbidden = projectAndValidate("flow", { flowId: "f1", name: "X", revision: "1", password: "s3cret" });
  check("a forbidden source field rejects the document", !forbidden.ok);

  // An unreadable source must NOT yield a partial snapshot: the orchestrator would validate it,
  // activate it, and silently drop every flow from the index.
  let threw = false;
  try {
    await buildSemanticSnapshot({
      flows: { list: async () => { throw new Error("EPERM"); } },
      workflows: { list: async () => [workflow()] }
    });
  } catch (error) {
    threw = error instanceof SemanticSnapshotError && error.source === "flows";
  }
  check("an unreadable source throws instead of returning a partial snapshot", threw);

  const empty = await buildSemanticSnapshot(sourcesOf([], []));
  check("an empty corpus is a valid, empty snapshot", empty.documents.length === 0 && empty.read === 0);

  const provider = createSemanticSnapshotProvider(() => sourcesOf([flow()], [workflow()]), () => {});
  check("the provider adapts the report to the runtime's snapshot signature", (await provider()).length === 2);

  // The sources are resolved per snapshot so a Settings path change is picked up. A provider that
  // captured its stores once would keep returning the first corpus forever.
  let resolutions = 0;
  let corpus: FlowProfile[] = [flow()];
  const relocating = createSemanticSnapshotProvider(() => {
    resolutions += 1;
    return sourcesOf(corpus, []);
  });
  check("the first snapshot reads the current corpus", (await relocating()).length === 1);
  corpus = [flow(), flow({ id: "flow-second", name: "Second" })];
  check("a later snapshot re-resolves the sources", (await relocating()).length === 2, `${resolutions} resolutions`);
  check("the sources were resolved once per snapshot", resolutions === 2, `${resolutions} resolutions`);
}

console.log("\nProduction registration (the runtime must be reachable from the app):\n");
{
  // The regression this guards is "returns to zero callers". `setSemanticIndexRuntime` existed for a
  // whole phase with none, which left semanticHealth() reporting healthy unconditionally and every
  // shutdown recording clean. Capture permissively, then validate strictly.
  const servicePath = fileURLToPath(new URL("../app/main/semantic/semanticService.ts", import.meta.url));
  const source = readFileSync(servicePath, "utf8");
  const constructions = source.match(/new\s+SemanticIndexRuntime\s*\(/g) ?? [];

  check("the main process constructs a SemanticIndexRuntime", constructions.length >= 1, `${constructions.length} found`);

  // Counting `setSemanticIndexRuntime(` call sites is NOT enough, and this check was written that way
  // first: the degrade path calls `setSemanticIndexRuntime(null)`, so deleting the real registration
  // still left a call behind and the guard passed against the exact defect it exists for. What has to
  // be asserted is that the CONSTRUCTED runtime is the thing handed to the registrar.
  check(
    "the constructed runtime is the one registered",
    /setSemanticIndexRuntime\s*\(\s*new\s+SemanticIndexRuntime\s*\(/.test(source),
    "no setSemanticIndexRuntime(new SemanticIndexRuntime(...)) call site"
  );
  check(
    "the not-in-this-build path still clears the registration",
    /setSemanticIndexRuntime\s*\(\s*null\s*\)/.test(source)
  );
  check("a production rebuild entry point exists", /export async function rebuildSemanticIndex/.test(source));
  check("the transport is the host manager, not a fake", /transport:\s*manager/.test(source));

  // Registering inside a lazy getter is only real if something reaches the getter. `semanticHealth`,
  // `getSemanticHostManager`, `ensureSemanticIndexOpen` and `rebuildSemanticIndex` all had zero
  // callers in `app/`, so a registrar that nothing calls would have left the original defect intact
  // while every check above still passed. Startup is the caller that closes that.
  const startup = /export function initializeSemanticSubsystem[\s\S]*?\n}/.exec(source)?.[0] ?? "";
  check("startup reaches the registrar", /getSemanticHostManager\(\)/.test(startup), "initializeSemanticSubsystem does not register");
  check(
    "startup registers only after reconciliation has repaired the pointer",
    startup.indexOf("reconcileGenerations") < startup.indexOf("getSemanticHostManager()"),
    "registration precedes reconciliation"
  );

  const mainPath = fileURLToPath(new URL("../app/main/main.ts", import.meta.url));
  const mainSource = readFileSync(mainPath, "utf8");
  check("the app calls startup initialization", /initializeSemanticSubsystem\(\)/.test(mainSource));
  check("the app drains the subsystem on quit", /disposeSemanticSubsystem\(\)/.test(mainSource));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
