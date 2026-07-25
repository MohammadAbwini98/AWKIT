/**
 * Test-only Electron entry that drives the REAL `ZvecUtilityHostManager` against a real packaged
 * native host.
 *
 * This exists because Phase 1A removed the `AWKIT_ZVEC_SPIKE_HOST` hook from `app/main/main.ts` —
 * correctly, since a production startup path must never be bypassable by an environment variable.
 * That removal also deleted the only packaged live-CRUD coverage, so this replaces it *without*
 * putting anything back into the product:
 *
 *   - it is never bundled into `out/main`, shipped in `app.asar`, or referenced by production code;
 *   - `scripts/verify-zvec-packaged-live.mts` esbuilds it into a temporary Electron app directory
 *     and launches that directory (`electron.launch({ args: [dir] })`), which is the invocation form
 *     this environment supports — a bare `electron <script.mjs>` never reaches `app.whenReady()`
 *     here, as Phase 0B established;
 *   - it imports the manager from source, so what is verified is the production class rather than a
 *     re-implementation of its protocol.
 *
 * Behaviour is selected by AWKIT_HARNESS_MODE and reported as JSON to AWKIT_HARNESS_REPORT.
 */

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { ZvecUtilityHostManager, type ZvecHostStatus } from "@main/semantic/ZvecUtilityHostManager";
import { ZVEC_HOST_PROTOCOL_VERSION, ZVEC_HOST_TIMEOUTS } from "@src/semantic/contracts/ZvecHostProtocol";
import { generationName, semanticIndexLayout } from "@src/semantic/SemanticGenerationLayout";
import type { ValidatedSemanticDocument } from "@src/semantic/SemanticPolicyValidator";
import type { SemanticStore } from "@src/semantic/SemanticStore";
import { contractDocument, runSemanticStoreContract } from "@src/semantic/SemanticStoreContract";
import { ZvecSemanticStore } from "@src/semantic/ZvecSemanticStore";

interface Step {
  label: string;
  ok: boolean;
  durationMs: number;
  detail?: unknown;
  error?: string;
}

const steps: Step[] = [];
const logLines: string[] = [];

async function step<T>(label: string, fn: () => Promise<T> | T): Promise<T | undefined> {
  const started = Date.now();
  try {
    const result = await fn();
    steps.push({ label, ok: true, durationMs: Date.now() - started, detail: result });
    return result;
  } catch (error) {
    steps.push({
      label,
      ok: false,
      durationMs: Date.now() - started,
      error: String((error as Error)?.message ?? error)
    });
    return undefined;
  }
}

const VECTOR_DIM = 16;
const vec = (seed: number): number[] => Array.from({ length: VECTOR_DIM }, (_, i) => Math.sin(seed * 0.017 + i) * 0.5 + 0.5);
const CATEGORIES = ["workflow", "flow", "documentation", "run-failure", "locator-success"];

const SCHEMA = {
  name: "awkitPhase1aLive",
  fields: [
    { name: "title", dataType: "STRING" as const, fts: { tokenizer: "standard" as const } },
    { name: "category", dataType: "STRING" as const }
  ],
  vectors: [{ name: "embedding", dimension: VECTOR_DIM }]
};

function docs(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    fields: {
      title: `synthetic automation record number ${i} for category ${CATEGORIES[i % CATEGORIES.length]}`,
      category: CATEGORIES[i % CATEGORIES.length]
    },
    vectors: { embedding: vec(i) }
  }));
}

function finish(extra: Record<string, unknown> = {}): void {
  const report = {
    mode: process.env.AWKIT_HARNESS_MODE ?? "crud",
    isPackaged: app.isPackaged,
    electron: process.versions.electron,
    node: process.versions.node,
    ok: steps.every((s) => s.ok),
    steps,
    log: logLines,
    ...extra
  };
  const target = process.env.AWKIT_HARNESS_REPORT;
  if (target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2), "utf8");
  }
  app.exit(report.ok ? 0 : 1);
}

function makeManager(hostPath: string, runtimeRoot: string): ZvecUtilityHostManager {
  return new ZvecUtilityHostManager({
    hostPath,
    runtimeRoot,
    logger: (level, message) => logLines.push(`${level}: ${message}`)
  });
}

async function run(): Promise<void> {
  const hostPath = process.env.AWKIT_HARNESS_HOST_PATH ?? "";
  const runtimeRoot = process.env.AWKIT_HARNESS_RUNTIME_ROOT ?? app.getPath("temp");
  const mode = process.env.AWKIT_HARNESS_MODE ?? "crud";
  const layout = semanticIndexLayout(runtimeRoot);
  const generation = generationName(1);
  const generationPath = path.join(layout.generations, generation);

  await step("hostFileExists", () => {
    if (!fs.existsSync(hostPath)) throw new Error(`host not found: ${hostPath}`);
    return { hostPath, outsideAsar: !hostPath.includes("app.asar") };
  });

  // The manager must never be able to reach Zvec itself — only the forked host may.
  await step("managerProcessCannotResolveZvec", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const req = require as unknown as { resolve: (id: string) => string };
    let resolved: string | null = null;
    try {
      resolved = req.resolve("@zvec/zvec");
    } catch {
      /* expected */
    }
    if (resolved) throw new Error(`main process can resolve @zvec/zvec at ${resolved}`);
    const loaded = process.moduleLoadList.filter((m) => /zvec/i.test(m));
    if (loaded.length > 0) throw new Error(`zvec native modules loaded in main: ${loaded.join(", ")}`);
    return { resolvable: false };
  });

  const manager = makeManager(hostPath, runtimeRoot);

  if (mode === "degraded") {
    // The host asset is damaged. The manager must fail with a stable reason and stay usable.
    await step("degradedHandshakeFails", async () => {
      try {
        await manager.handshake();
        throw new Error("handshake unexpectedly succeeded against a damaged host");
      } catch (error) {
        const reason = (error as { reason?: string }).reason ?? "unknown";
        return { reason };
      }
    });
    await step("degradedStatusIsReported", () => {
      const status: ZvecHostStatus = manager.status();
      return { state: status.state, lastReason: status.lastReason, circuitOpen: status.circuitOpen };
    });
    await step("degradedManagerStillDisposesCleanly", async () => manager.dispose());
    finish({ statusAfter: manager.status() });
    return;
  }

  if (mode === "circuit") {
    // Drive three unexpected exits and assert the circuit opens in a REAL application process.
    await step("circuitOpensAfterRepeatedExits", async () => {
      const observed: string[] = [];
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          await manager.handshake();
          // Kill the live host so the manager records an UNEXPECTED exit.
          const pid = manager.status().pid;
          if (pid) process.kill(pid);
          // Give the exit event a moment to land.
          await new Promise((r) => setTimeout(r, 400));
          observed.push(`attempt${attempt}:killed`);
        } catch (error) {
          observed.push(`attempt${attempt}:${(error as { reason?: string }).reason ?? "error"}`);
        }
      }
      return { observed, status: manager.status() };
    });
    await step("circuitIsOpen", () => {
      const status = manager.status();
      if (!status.circuitOpen) throw new Error(`circuit did not open; status=${JSON.stringify(status)}`);
      return { circuitOpen: status.circuitOpen, unexpectedExits: status.unexpectedExits, state: status.state };
    });
    await step("callsAreRefusedWhileOpen", async () => {
      try {
        await manager.handshake();
        throw new Error("handshake succeeded while the circuit was open");
      } catch (error) {
        const reason = (error as { reason?: string }).reason;
        if (reason !== "SEMANTIC_CIRCUIT_OPEN") throw new Error(`expected SEMANTIC_CIRCUIT_OPEN, got ${reason}`);
        return { reason };
      }
    });
    await step("resetCircuitRecovers", async () => {
      manager.resetCircuit();
      const hello = await manager.handshake();
      return { compatible: hello.compatible, state: manager.status().state };
    });
    await step("disposeAfterCircuitTest", async () => manager.dispose());
    finish({ statusAfter: manager.status() });
    return;
  }

  if (mode === "batch") {
    // Phase 0D coexistence scenario 4 was INCONCLUSIVE: a large batch load ran (330 MB utility RSS)
    // but its counters never published, because the close after a huge insert exceeded the harness's
    // wait window. This mode re-runs exactly that case with a close budget sized for the workload,
    // and reports the counters that were missing.
    const batches = Number(process.env.AWKIT_HARNESS_BATCHES ?? 20);
    const perBatch = Number(process.env.AWKIT_HARNESS_BATCH_SIZE ?? 500);
    const counters = { batches: 0, docsWritten: 0, errors: 0 };

    await step("handshake", async () => {
      const hello = await manager.handshake();
      return { zvec: hello.versions.zvec };
    });

    await step("openGeneration", async () => {
      fs.mkdirSync(layout.generations, { recursive: true });
      return manager.call({ type: "open", generation, path: generationPath, schema: SCHEMA }, ZVEC_HOST_TIMEOUTS.openCollectionMs);
    });

    await step("largeBatchInsert", async () => {
      const started = Date.now();
      for (let b = 0; b < batches; b += 1) {
        try {
          await manager.call(
            { type: "insert", collectionId: generation, docs: docs(perBatch, `batch${b}`) },
            ZVEC_HOST_TIMEOUTS.writeBatchMs
          );
          counters.batches += 1;
          counters.docsWritten += perBatch;
        } catch (error) {
          counters.errors += 1;
          logLines.push(`batch ${b} failed: ${String((error as Error).message)}`);
        }
      }
      return { ...counters, elapsedMs: Date.now() - started, docsPerSecond: Math.round((counters.docsWritten / (Date.now() - started)) * 1000) };
    });

    await step("statsAfterLargeBatch", async () => manager.call({ type: "stats", collectionId: generation }, ZVEC_HOST_TIMEOUTS.queryMs));

    // The specific step that timed out in Phase 0D. Given its own generous budget and MEASURED, so
    // the result is a number rather than another inconclusive row.
    const closeStart = Date.now();
    await step("closeAfterLargeBatch", async () => {
      await manager.call({ type: "close", collectionId: generation }, 120_000);
      return { closeMs: Date.now() - closeStart };
    });

    await step("disposeAfterLargeBatch", async () => manager.dispose());
    finish({ counters, statusAfter: manager.status() });
    return;
  }

  if (mode === "store") {
    // ── the PRODUCTION path, end to end ──
    //
    // ZvecSemanticStore -> ZvecUtilityHostManager -> Electron utilityProcess -> raw packaged host
    // -> real Zvec. Everything else in this subsystem is verified against a transport FAKE, which
    // proves adapter translation and nothing about the host's own code: its independently duplicated
    // filter builder, its two-pass exact-total query, and its post-delete re-scan were previously
    // asserted only by scanning the host's source text.
    //
    // That gap is not hypothetical. The fake once encoded the protocol as INTENDED while the host
    // implemented something else, and three defects survived a green suite as a result — an explicit
    // null rejected by the binding, `fetch` returning bare id strings, and a schema using `type`
    // where the host reads `dataType`. This mode is what makes those unable to recur.
    const contractResults: Array<{ label: string; ok: boolean; detail?: string }> = [];

    await step("handshake", async () => {
      const hello = await manager.handshake();
      if (hello.protocolVersion !== ZVEC_HOST_PROTOCOL_VERSION) {
        throw new Error(`host protocol ${hello.protocolVersion}, expected ${ZVEC_HOST_PROTOCOL_VERSION}`);
      }
      return { protocolVersion: hello.protocolVersion, zvec: hello.versions.zvec, compatible: hello.compatible };
    });

    fs.mkdirSync(layout.generations, { recursive: true });

    // One store per contract case: the suite calls the factory repeatedly and expects isolation, and
    // a real backend needs a distinct on-disk collection per case.
    let storeSeq = 0;
    const factory = async (): Promise<SemanticStore> => {
      storeSeq += 1;
      const name = generationName(storeSeq);
      return new ZvecSemanticStore({
        transport: manager,
        generation: name,
        generationPath: path.join(layout.generations, name)
      });
    };

    await step("sharedContractSuiteAgainstTheRealHost", async () => {
      const checks = await runSemanticStoreContract(factory, "zvec-native");
      contractResults.push(...checks);
      const failures = checks.filter((c) => !c.ok);
      if (failures.length > 0) {
        throw new Error(`${failures.length}/${checks.length} contract checks failed: ${failures.slice(0, 6).map((f) => f.label).join(" | ")}`);
      }
      return { checks: checks.length };
    });

    // ── scale, above every threshold that used to be a ceiling ──
    const scaleName = generationName(9000);
    const scalePath = path.join(layout.generations, scaleName);
    const scaleStore = new ZvecSemanticStore({ transport: manager, generation: scaleName, generationPath: scalePath });

    await step("openScaleStore", async () => {
      await scaleStore.open();
      return { generation: scaleName };
    });

    const BULK = 1500;
    const BIG_ENTITY_DOCS = 130;

    await step("writeAboveEveryCeiling", async () => {
      // >1024 forces the host's write chunking; >100 clears the old top-K cap. `run-failure` is a
      // HISTORICAL kind, so each revision is a distinct document rather than a replacement — that is
      // what lets one entity legitimately own 130 rows.
      const bulk: ValidatedSemanticDocument[] = [];
      for (let i = 0; i < BULK; i += 1) {
        bulk.push(
          contractDocument({
            kind: "run-failure",
            entityId: i < BIG_ENTITY_DOCS ? "big-entity" : `run-${i}`,
            revision: `r${i}`,
            title: `Failure ${i}`,
            body: i === BULK - 1 ? "sharedterm uniqueneedle appears once" : `sharedterm failure detail ${i}`
          })
        );
      }
      const result = await scaleStore.upsert(bulk);
      return { written: result.inserted + result.replaced, countsKnown: result.countsKnown };
    });

    await step("exactCountAbove1500", async () => {
      const stats = await scaleStore.stats();
      if (stats.documents !== BULK) throw new Error(`expected ${BULK} documents, got ${stats.documents}`);
      if ((stats.byKind["run-failure"] ?? 0) !== BULK) throw new Error(`per-kind count wrong: ${JSON.stringify(stats.byKind)}`);
      return stats;
    });

    await step("exactTotalMatchedAbove100", async () => {
      // The page is deliberately smaller than the match set, so a store reporting the page length
      // would be caught here rather than at a size where the two happen to agree.
      const page = await scaleStore.search({ text: "sharedterm", topK: 20 });
      if (page.hits.length !== 20) throw new Error(`expected 20 hits, got ${page.hits.length}`);
      if (page.totalMatched !== BULK) throw new Error(`totalMatched ${page.totalMatched}, expected ${BULK}`);
      if (page.degraded) throw new Error("an exact total must not be reported as degraded");
      return { hits: page.hits.length, totalMatched: page.totalMatched };
    });

    await step("typedFilterIsAppliedBeforeRanking", async () => {
      // The needle is the LAST-written document, so an unfiltered page cannot reach it. Both halves
      // are asserted: the filtered query finds it AND the unfiltered one does not.
      const unfiltered = await scaleStore.search({ text: "sharedterm", topK: 10 });
      const reachedUnfiltered = unfiltered.hits.some((h) => h.summary.includes("uniqueneedle"));
      const filtered = await scaleStore.search({ text: "sharedterm", topK: 10, errorCategory: "timeout", nodeType: undefined });
      if (reachedUnfiltered) throw new Error("the needle was already inside the unfiltered page; the check would be vacuous");
      if (filtered.hits.length === 0) throw new Error("a filtered search returned nothing");
      return { reachedUnfiltered, filteredHits: filtered.hits.length, filteredTotal: filtered.totalMatched };
    });

    await step("fetchReturnsFullDocuments", async () => {
      const first = await scaleStore.search({ text: "sharedterm", topK: 1 });
      const id = first.hits[0]?.documentId ?? "";
      const doc = await scaleStore.get(id);
      if (!doc) throw new Error(`get() returned null for ${id}`);
      // v1 returned bare id strings here, which made every one of these fields undefined.
      if (!doc.kind || !doc.entityId || !doc.entityKey || !doc.sourceHash || !doc.content) {
        throw new Error(`fetched document is missing fields: ${JSON.stringify(Object.keys(doc))}`);
      }
      return { id: doc.id, hasEntityKey: doc.entityKey.length === 64 };
    });

    await step("absentOptionalsAreOmittedNotNull", async () => {
      // The binding REJECTS an explicit null on a nullable field, failing the whole batch. A document
      // with no workflowId/flowId/hostname is the common case, so if this were still written as null
      // every such write would fail here — which is precisely what the fake could not show.
      const doc = contractDocument({ kind: "documentation", entityId: "docs/readme.md", title: "Readme", body: "plain body" });
      const written = await scaleStore.upsert([doc]);
      const readBack = await scaleStore.get(doc.id);
      if (!readBack) throw new Error("a document with absent optionals could not be read back");
      if (readBack.workflowId !== undefined) throw new Error(`absent optional came back as ${JSON.stringify(readBack.workflowId)}`);
      return { written: written.inserted + written.replaced, workflowId: readBack.workflowId ?? "absent" };
    });

    await step("entityDeletionAbove100Documents", async () => {
      const removed = await scaleStore.deleteByEntity("big-entity");
      if (removed !== BIG_ENTITY_DOCS) throw new Error(`removed ${removed}, expected ${BIG_ENTITY_DOCS}`);
      const after = await scaleStore.stats();
      // +1 for the documentation row written above.
      const expected = BULK - BIG_ENTITY_DOCS + 1;
      if (after.documents !== expected) throw new Error(`expected ${expected} remaining, got ${after.documents}`);
      return { removed, remaining: after.documents };
    });

    await step("hostileIdentitiesAreDeletableByDerivedKey", async () => {
      // Every identity here is one a real user can produce. Filtering by the raw value either throws
      // a lexer error or silently matches nothing; the derived `entityKey` makes all of them ordinary.
      const hostile = [
        "C:\\Users\\name\\item",
        "single'quote",
        'double"quote',
        "trailing\\",
        "Unicode-اسم",
        '" OR schemaVersion >= 0 OR entityId = "'
      ];
      const outcomes: Record<string, number> = {};
      for (const entityId of hostile) {
        const doc = contractDocument({ kind: "workflow", entityId, title: "Hostile", body: "removable" });
        await scaleStore.upsert([doc]);
        const removed = await scaleStore.deleteByEntity(entityId);
        outcomes[entityId.slice(0, 18)] = removed;
        if (removed !== 1) throw new Error(`identity ${JSON.stringify(entityId)} reported ${removed} removed, expected 1`);
      }
      return outcomes;
    });

    await step("clearRemovesEverything", async () => {
      const before = (await scaleStore.stats()).documents;
      if (before < 1000) throw new Error(`clear would be unconvincing at ${before} documents`);
      await scaleStore.clear();
      const after = await scaleStore.stats();
      if (after.documents !== 0) throw new Error(`clear left ${after.documents} documents`);
      const search = await scaleStore.search({ text: "sharedterm" });
      if (search.hits.length !== 0) throw new Error("search returned hits after clear");
      return { before, after: after.documents };
    });

    await step("closeScaleStore", async () => {
      await scaleStore.close();
      return { closed: true };
    });

    const hostPid = manager.status().pid ?? null;
    await step("disposeIsGraceful", async () => manager.dispose());

    finish({
      contract: {
        total: contractResults.length,
        failed: contractResults.filter((c) => !c.ok).length,
        failures: contractResults.filter((c) => !c.ok).map((c) => ({ label: c.label, detail: c.detail }))
      },
      // The verifier checks this pid is gone from the OS — a graceful dispose that leaves the utility
      // process running is not a graceful dispose.
      hostPid,
      statusAfter: manager.status()
    });
    return;
  }

  // ── default: full live CRUD through the manager ──
  await step("handshake", async () => {
    const hello = await manager.handshake();
    return {
      zvec: hello.versions.zvec,
      binding: hello.versions.binding,
      napi: hello.versions.napi,
      jieba: hello.jiebaDictDir,
      approvedRoot: hello.approvedRootConfigured
    };
  });

  await step("pathConfinementRejectsUnapprovedPaths", async () => {
    const rejected: string[] = [];
    const attempts = [layout.root, path.join(layout.quarantine, "x"), path.join(layout.generations, "..", "escape")];
    for (const candidate of attempts) {
      try {
        await manager.call({ type: "open", generation: "probe", path: candidate, schema: SCHEMA }, ZVEC_HOST_TIMEOUTS.openCollectionMs);
        throw new Error(`host accepted an unapproved path: ${candidate}`);
      } catch (error) {
        const reason = (error as { reason?: string }).reason;
        if (reason !== "SEMANTIC_PATH_OUTSIDE_APPROVED_ROOT") throw new Error(`unexpected reason for ${candidate}: ${reason}`);
        rejected.push(path.basename(candidate));
      }
    }
    return { rejected };
  });

  await step("openGeneration", async () => {
    fs.mkdirSync(layout.generations, { recursive: true });
    return manager.call({ type: "open", generation, path: generationPath, schema: SCHEMA }, ZVEC_HOST_TIMEOUTS.openCollectionMs);
  });

  await step("insertOne", async () =>
    manager.call({ type: "insert", collectionId: generation, docs: docs(1, "single") }, ZVEC_HOST_TIMEOUTS.writeBatchMs)
  );

  await step("batchInsert1200", async () =>
    manager.call({ type: "insert", collectionId: generation, docs: docs(1200, "doc") }, ZVEC_HOST_TIMEOUTS.writeBatchMs)
  );

  await step("ftsQueryMatches", async () => {
    const r = (await manager.call(
      { type: "query", collectionId: generation, query: { fieldName: "title", fts: { queryString: "automation AND workflow" }, topK: 20 } },
      ZVEC_HOST_TIMEOUTS.queryMs
    )) as { hits: number };
    if (r.hits === 0) throw new Error("FTS returned 0 hits for a term the corpus contains");
    return r;
  });

  await step("ftsNegativeControl", async () => {
    const r = (await manager.call(
      { type: "query", collectionId: generation, query: { fieldName: "title", fts: { queryString: "zzzznonexistentterm" }, topK: 20 } },
      ZVEC_HOST_TIMEOUTS.queryMs
    )) as { hits: number };
    if (r.hits !== 0) throw new Error(`expected 0 hits for an absent term, got ${r.hits}`);
    return r;
  });

  await step("vectorQuery", async () =>
    manager.call({ type: "query", collectionId: generation, query: { fieldName: "embedding", vector: vec(42), topK: 5 } }, ZVEC_HOST_TIMEOUTS.queryMs)
  );

  await step("updateDoc", async () =>
    manager.call({ type: "update", collectionId: generation, docId: "doc-0", fields: { category: "phase1a" } }, ZVEC_HOST_TIMEOUTS.writeBatchMs)
  );

  await step("upsertDoc", async () =>
    manager.call({ type: "upsert", collectionId: generation, docs: docs(1, "doc") }, ZVEC_HOST_TIMEOUTS.writeBatchMs)
  );

  await step("fetchDocs", async () =>
    manager.call({ type: "fetch", collectionId: generation, ids: ["doc-0", "doc-1"] }, ZVEC_HOST_TIMEOUTS.queryMs)
  );

  await step("deleteDocs", async () =>
    manager.call({ type: "delete", collectionId: generation, ids: ["doc-2", "doc-3"] }, ZVEC_HOST_TIMEOUTS.writeBatchMs)
  );

  const stats = (await step("statsBeforeClose", async () =>
    manager.call({ type: "stats", collectionId: generation }, ZVEC_HOST_TIMEOUTS.queryMs)
  )) as { docCount: number } | undefined;

  await step("closeCollection", async () => manager.call({ type: "close", collectionId: generation }, ZVEC_HOST_TIMEOUTS.closeCollectionMs));

  await step("reopenPersistsCorpus", async () => {
    const reopened = (await manager.call(
      { type: "open", generation, path: generationPath, schema: SCHEMA },
      ZVEC_HOST_TIMEOUTS.openCollectionMs
    )) as { created: boolean; docCount: number };
    if (reopened.created) throw new Error("reopen created a new collection instead of opening the existing one");
    if (stats && reopened.docCount !== stats.docCount) {
      throw new Error(`docCount changed across close/reopen: ${stats.docCount} -> ${reopened.docCount}`);
    }
    return reopened;
  });

  await step("closeAfterReopen", async () => manager.call({ type: "close", collectionId: generation }, ZVEC_HOST_TIMEOUTS.closeCollectionMs));

  const shutdown = await step("gracefulDispose", async () => manager.dispose());

  finish({ statusAfter: manager.status(), shutdown });
}

app.whenReady().then(() => {
  void run().catch((error) => {
    steps.push({ label: "harness", ok: false, durationMs: 0, error: String((error as Error)?.stack ?? error) });
    finish();
  });
});
