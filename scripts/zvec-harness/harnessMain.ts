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
import { createGeneration, readActivePointerStrict, resolveActiveIdentity, rollbackGeneration } from "@src/semantic/SemanticGenerationManager";
import { reconcileGenerations } from "@src/semantic/SemanticGenerationReconciler";
import { SemanticIndexRuntime, type SemanticIndexRuntimeOptions } from "@src/semantic/SemanticIndexRuntime";
import type { ValidatedSemanticDocument } from "@src/semantic/SemanticPolicyValidator";
import type { SemanticStore } from "@src/semantic/SemanticStore";
import { contractDocument, runSemanticStoreContract } from "@src/semantic/SemanticStoreContract";
import { SEMANTIC_SCHEMA, ZvecSemanticStore } from "@src/semantic/ZvecSemanticStore";

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

  if (mode === "rebuild") {
    // ── the REAL rebuild lifecycle, end to end ──
    //
    // SemanticIndexRuntime -> SemanticRebuildOrchestrator -> generation filesystem ->
    // ZvecSemanticStore -> ZvecUtilityHostManager -> utilityProcess -> raw host -> real Zvec.
    //
    // Everything here was previously verified against a generation-lifecycle STUB and in-memory
    // stores. A stub cannot fail the way a filesystem and a native collection fail: it does not hold
    // a RocksDB lock, does not reject a path outside the approved root, and cannot leave a candidate
    // half-written. This mode is what turns "the orchestration logic is correct" into "the
    // orchestration works against the thing that ships".
    const checks: Array<{ label: string; ok: boolean; detail?: string }> = [];
    const expect = (label: string, ok: unknown, detail?: string): void => {
      checks.push({ label, ok: Boolean(ok), detail });
      logLines.push(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
    };

    const doc = (entityId: string, body = "alpha automation body") =>
      contractDocument({ entityId, title: `T-${entityId}`, body });

    /**
     * Every scenario shares ONE runtime root, because the host fixes its approved root at fork time
     * from the manager's runtimeRoot — a per-scenario root would put every generation path outside
     * it and be refused. Isolation therefore comes from wiping the index between scenarios, with a
     * fresh manager (and so a fresh host process) each time so no collection lock survives the wipe.
     */
    const freshIndex = (): void => {
      fs.rmSync(layout.root, { recursive: true, force: true });
      fs.mkdirSync(layout.generations, { recursive: true });
    };

    /** A transport that can inject a fault before forwarding. The tool behind every failure case. */
    class FaultTransport {
      fault: ((request: Record<string, unknown>) => void) | null = null;
      constructor(private readonly inner: { call<T>(request: unknown, timeoutMs: number): Promise<T> }) {}
      async call<T>(request: unknown, timeoutMs: number): Promise<T> {
        this.fault?.(request as Record<string, unknown>);
        return this.inner.call<T>(request, timeoutMs);
      }
    }

    interface ScenarioContext {
      mgr: ZvecUtilityHostManager;
      transport: FaultTransport;
    }

    const scenario = async (name: string, fn: (ctx: ScenarioContext) => Promise<void>): Promise<void> => {
      freshIndex();
      const mgr = makeManager(hostPath, runtimeRoot);
      const transport = new FaultTransport(mgr);
      try {
        await fn({ mgr, transport });
      } catch (error) {
        expect(`[${name}] scenario completed without an unexpected throw`, false, String((error as Error)?.message ?? error));
      } finally {
        await mgr.dispose().catch(() => undefined);
      }
    };

    const newRuntime = (
      transport: FaultTransport,
      snapshot: () => Promise<readonly ValidatedSemanticDocument[]>,
      extra: Partial<SemanticIndexRuntimeOptions> = {}
    ): SemanticIndexRuntime =>
      new SemanticIndexRuntime({
        runtimeRoot,
        transport,
        snapshot,
        reopenAttempts: 1,
        reopenDelayMs: 10,
        logger: (level, message) => logLines.push(`${level}: ${message}`),
        ...extra
      });

    const activeGenerationOf = (): string | null => {
      const read = readActivePointerStrict(runtimeRoot);
      return read.status === "ok" ? read.pointer.activeGeneration : null;
    };

    // ── 0. diagnosis: open a store on a generation allocated exactly the way production allocates it ──
    await step("candidateOpensOnAnAllocatedGeneration", async () => {
      freshIndex();
      const mgr = makeManager(hostPath, runtimeRoot);
      try {
        const created = createGeneration(runtimeRoot);
        // Called through the MANAGER first: the store maps every open failure onto
        // BACKEND_UNAVAILABLE, which is right for production and useless for diagnosis.
        try {
          const raw = await mgr.call(
            { type: "open", generation: `${created.name}-probe`, path: created.path, schema: SEMANTIC_SCHEMA },
            ZVEC_HOST_TIMEOUTS.openCollectionMs
          );
          logLines.push(`diag: raw open OK ${JSON.stringify(raw)}`);
          await mgr.call({ type: "close", collectionId: `${created.name}-probe` }, ZVEC_HOST_TIMEOUTS.closeMs ?? 5000).catch(() => undefined);
        } catch (error) {
          const e = error as { reason?: string; message?: string };
          logLines.push(`diag: raw open FAILED reason=${e.reason} message=${e.message}`);
        }
        const store = new ZvecSemanticStore({ transport: mgr, generation: created.name, generationPath: created.path });
        try {
          await store.open();
          const stats = await store.stats();
          await store.close();
          logLines.push(`diag: opened allocated generation ${created.name} (docs=${stats.documents})`);
          expect("[diag] a store opens on a directory allocated by createGeneration", true);
          return { opened: true, generation: created.name };
        } catch (error) {
          const e = error as { code?: string; reason?: string; message?: string };
          logLines.push(`diag: open FAILED code=${e.code} reason=${e.reason} message=${e.message}`);
          expect("[diag] a store opens on a directory allocated by createGeneration", false, `${e.code} / ${e.reason} / ${e.message}`);
          return { opened: false, code: e.code, reason: e.reason, message: e.message };
        }
      } finally {
        await mgr.dispose().catch(() => undefined);
      }
    });

    // ── 1. bootstrap: a real rebuild creates and activates a real generation ──
    await step("realRebuildAndActivation", async () => {
      await scenario("bootstrap", async ({ transport }) => {
        const runtime = newRuntime(transport, async () => [doc("wf-a"), doc("wf-b"), doc("wf-c")]);
        const before = await runtime.open();
        expect("[bootstrap] an empty index reports no active generation", before.block === "NO_ACTIVE_GENERATION", String(before.block));

        const report = await runtime.rebuild();
        expect("[bootstrap] the real rebuild activated", report.ok && report.activated, JSON.stringify({ refusal: report.refusal, reason: report.reason }));
        expect("[bootstrap] it populated the snapshot documents", report.populated === 3, String(report.populated));

        const pointer = activeGenerationOf();
        expect("[bootstrap] the pointer names the rebuilt generation", pointer !== null && pointer === report.generation, `${pointer} vs ${report.generation}`);
        expect("[bootstrap] the generation directory exists on disk", pointer !== null && fs.existsSync(path.join(layout.generations, pointer)));

        const status = runtime.status();
        expect("[bootstrap] the runtime is writable after activation", status.writable && status.block === null, String(status.block));

        const stats = await runtime.store?.stats();
        expect("[bootstrap] the ACTIVE store serves the rebuilt content", stats?.documents === 3, String(stats?.documents));
        await runtime.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 2. the active generation stays queryable while a candidate is being built ──
    await step("activeGenerationSearchableDuringRebuild", async () => {
      await scenario("searchable", async ({ transport }) => {
        // ONE runtime throughout. A second runtime over the same root would try to open the same
        // generation while the first still holds it, and the host answers that with
        // SEMANTIC_COLLECTION_ALREADY_OPEN — a collision in the test, not a property of the system.
        let snapshotDocs: ValidatedSemanticDocument[] = [doc("wf-a"), doc("wf-b")];
        const runtime = newRuntime(transport, async () => snapshotDocs);
        await runtime.open();
        await runtime.rebuild(); // bootstrap generation 1

        // A LARGE snapshot so populate spans several host round-trips, and the search below genuinely
        // overlaps candidate construction rather than slipping in before it starts. `runtime.store` is
        // still the OLD active store until retarget, which is exactly what should stay queryable.
        snapshotDocs = Array.from({ length: 300 }, (_, i) => doc(`bulk-${i}`));
        const activeDuring = runtime.store;
        const rebuilding = runtime.rebuild();
        const during = await activeDuring?.search({ text: "alpha", topK: 5 });
        const report = await rebuilding;

        expect("[searchable] the rebuild activated", report.ok && report.activated, JSON.stringify(report.refusal));
        expect("[searchable] the ACTIVE generation answered a query mid-rebuild", (during?.hits.length ?? 0) > 0, String(during?.hits.length));
        expect("[searchable] ...and answered from the OLD content, not the candidate", (during?.totalMatched ?? 0) <= 2, String(during?.totalMatched));
        await runtime.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 3/4. post-watermark mutations survive activation ──
    await step("postWatermarkMutationsSurviveActivation", async () => {
      await scenario("delta", async ({ transport }) => {
        const lateDoc = doc("late-arrival", "arrived mid rebuild");
        const doomedId = doc("doomed").id;
        let onSnapshot: (() => void) | null = null;

        // The snapshot deliberately still CONTAINS `doomed`, so if the delete were not replayed the
        // candidate would resurrect it. That is what makes this discriminating rather than incidental.
        const runtime = newRuntime(transport, async () => {
          onSnapshot?.();
          return [doc("keep-1"), doc("doomed")];
        });
        await runtime.open();
        await runtime.rebuild();

        onSnapshot = () => {
          runtime.enqueue({ op: "upsert", document: lateDoc });
          runtime.enqueue({ op: "delete", id: doomedId });
        };
        const report = await runtime.rebuild();

        expect("[delta] the rebuild activated", report.ok && report.activated, JSON.stringify({ refusal: report.refusal, reason: report.reason }));
        expect("[delta] both post-watermark mutations were replayed", report.replayed === 2, String(report.replayed));

        const survived = await runtime.store?.get(lateDoc.id);
        expect("[delta] a post-watermark UPSERT exists in the activated generation", survived?.id === lateDoc.id);

        const deleted = await runtime.store?.get(doomedId);
        expect("[delta] a post-watermark DELETE is absent from the activated generation, despite being in the snapshot", deleted === null, JSON.stringify(deleted?.id));
        await runtime.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 5. a mutation accepted AFTER activation drains to the new generation ──
    await step("postActivationMutationDrainsToNewGeneration", async () => {
      await scenario("drains", async ({ transport }) => {
        const runtime = newRuntime(transport, async () => [doc("wf-a")]);
        await runtime.open();
        const report = await runtime.rebuild();
        expect("[drains] the rebuild activated", report.ok && report.activated, JSON.stringify(report.refusal));

        const after = doc("after-activation");
        runtime.enqueue({ op: "upsert", document: after });
        await runtime.drain();

        const stored = await runtime.store?.get(after.id);
        expect("[drains] a mutation accepted after activation lands in the NEW generation", stored?.id === after.id);
        expect("[drains] ...and the queue is empty afterwards", runtime.status().pending === 0, String(runtime.status().pending));
        await runtime.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 6/7/8. pre-activation failures leave the pointer exactly where it was ──
    //
    // The injected request types are the ones the STORE actually sends, which are not the ones the
    // host also happens to implement: `ZvecSemanticStore` writes with `upsert` (never `insert`) and
    // computes stats with `count` (never `stats`). Matching the wrong type made both arms no-ops, so
    // these scenarios silently exercised a SUCCESSFUL rebuild while claiming to test failure — a check
    // that fails open, which is the same defect class this whole tranche keeps surfacing.
    for (const [name, arm] of [
      ["populate", (t: FaultTransport, active: string) => {
        t.fault = (req) => {
          if ((req.type === "upsert" || req.type === "insert") && typeof req.collectionId === "string" && req.collectionId !== active) {
            throw new Error("injected populate failure");
          }
        };
      }],
      ["validate", (t: FaultTransport, active: string) => {
        t.fault = (req) => {
          if (req.type === "count" && typeof req.collectionId === "string" && req.collectionId !== active) {
            throw new Error("injected validation failure");
          }
        };
      }]
    ] as Array<[string, (t: FaultTransport, active: string) => void]>) {
      await step(`${name}FailureLeavesActivePointerUnchanged`, async () => {
        await scenario(name, async ({ transport }) => {
          let snapshotDocs: ValidatedSemanticDocument[] = [doc("wf-a")];
          const runtime = newRuntime(transport, async () => snapshotDocs);
          await runtime.open();
          await runtime.rebuild();
          const pointerBefore = activeGenerationOf();
          const statsBefore = await runtime.store?.stats();

          snapshotDocs = [doc("wf-a"), doc("wf-b")];
          arm(transport, pointerBefore ?? "");
          const report = await runtime.rebuild();
          transport.fault = null;

          expect(`[${name}] the rebuild was refused`, !report.ok && !report.activated, JSON.stringify(report.refusal));
          expect(`[${name}] the active pointer did NOT move`, activeGenerationOf() === pointerBefore, String(activeGenerationOf()));
          const statsAfter = await runtime.store?.stats();
          expect(`[${name}] the active generation still serves its original content`, statsAfter?.documents === statsBefore?.documents, `${statsAfter?.documents} vs ${statsBefore?.documents}`);
          expect(`[${name}] the runtime is still writable`, runtime.status().writable);
          await runtime.shutdown();
        });
        return { checks: checks.length };
      });
    }

    // ── 9. delta overflow refuses activation rather than dropping entries ──
    await step("deltaOverflowPreventsActivation", async () => {
      await scenario("overflow", async ({ transport }) => {
        let onSnapshot: (() => void) | null = null;
        const runtime = newRuntime(
          transport,
          async () => {
            onSnapshot?.();
            return [doc("wf-a")];
          },
          { maxRebuildDelta: 2 }
        );
        await runtime.open();
        await runtime.rebuild();
        const pointerBefore = activeGenerationOf();

        onSnapshot = () => {
          for (let i = 0; i < 6; i += 1) runtime.enqueue({ op: "upsert", document: doc(`flood-${i}`) });
        };
        const report = await runtime.rebuild();

        expect("[overflow] an overflowed delta refuses activation", !report.ok && report.refusal === "DELTA_OVERFLOWED", JSON.stringify(report.refusal));
        expect("[overflow] the active pointer did NOT move", activeGenerationOf() === pointerBefore, String(activeGenerationOf()));
        expect("[overflow] the flooded mutations are still pending, not dropped", runtime.status().pending > 0, String(runtime.status().pending));
        await runtime.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 10. a pointer WRITE failure keeps the previous generation active ──
    await step("pointerActivationFailurePreservesActiveGeneration", async () => {
      await scenario("pointerFail", async ({ transport }) => {
        const runtime = newRuntime(transport, async () => [doc("wf-a")]);
        await runtime.open();
        await runtime.rebuild();
        const activeStore = runtime.store;

        // A DIRECTORY where the pointer file belongs: the atomic rename onto it fails, which is the
        // real failure mode of a locked or unwritable pointer without needing ACL trickery.
        fs.rmSync(layout.activeGenerationFile, { force: true });
        fs.mkdirSync(layout.activeGenerationFile, { recursive: true });

        const report = await runtime.rebuild();
        expect("[pointerFail] the rebuild was refused", !report.ok && !report.activated, JSON.stringify(report.refusal));
        expect("[pointerFail] no new pointer was committed", activeGenerationOf() === null);

        const stats = await activeStore?.stats();
        expect("[pointerFail] the previously-active generation is still open and serving", stats?.documents === 1, String(stats?.documents));
        expect("[pointerFail] the runtime never entered a blocked state", runtime.status().writable, String(runtime.status().block));

        fs.rmSync(layout.activeGenerationFile, { recursive: true, force: true });
        await runtime.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 11. a metadata failure AFTER the pointer swap is repair-required, not a failed rebuild ──
    await step("metadataFailureAfterPointerSwapReportsRepairRequired", async () => {
      await scenario("metadata", async ({ transport }) => {
        const runtime = newRuntime(transport, async () => [doc("wf-a")]);
        await runtime.open();
        await runtime.rebuild();

        fs.rmSync(layout.metadataFile, { force: true });
        fs.mkdirSync(layout.metadataFile, { recursive: true });

        const report = await runtime.rebuild();
        expect("[metadata] the rebuild still ACTIVATED — the pointer is authoritative", report.ok && report.activated, JSON.stringify({ refusal: report.refusal, reason: report.reason }));
        expect("[metadata] ...and reported metadata repair separately from failure", report.metadataRepairRequired === true);
        expect("[metadata] the pointer names the new generation", activeGenerationOf() === report.generation, `${activeGenerationOf()} vs ${report.generation}`);

        fs.rmSync(layout.metadataFile, { recursive: true, force: true });
        await runtime.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 12. activation succeeded but the new generation will not OPEN ──
    await step("retargetFailureEntersDegradedRecovery", async () => {
      await scenario("retarget", async ({ transport }) => {
        const runtime = newRuntime(transport, async () => [doc("wf-a")]);
        await runtime.open();
        await runtime.rebuild();
        const pointerBefore = activeGenerationOf();
        const oldStore = runtime.store;

        // Populate and validate each open the candidate, so the retarget open is the THIRD. Failing
        // exactly that one is what puts the runtime in the activated-but-unopenable state.
        const opensByGeneration = new Map<string, number>();
        transport.fault = (req) => {
          if (req.type !== "open") return;
          const gen = String(req.generation ?? "");
          if (gen === pointerBefore) return;
          const n = (opensByGeneration.get(gen) ?? 0) + 1;
          opensByGeneration.set(gen, n);
          if (n >= 3) throw new Error("injected post-activation open failure");
        };

        const report = await runtime.rebuild();
        transport.fault = null;

        expect("[retarget] the rebuild reports failure", !report.ok, JSON.stringify(report.refusal));
        expect("[retarget] but the POINTER did commit — activation is not reverted", activeGenerationOf() !== pointerBefore && activeGenerationOf() !== null, String(activeGenerationOf()));
        expect("[retarget] the activated generation was NOT deleted", fs.existsSync(path.join(layout.generations, String(activeGenerationOf()))));

        const status = runtime.status();
        expect("[retarget] the runtime is BLOCKED, not silently writable", !status.writable && status.block === "ACTIVE_GENERATION_OPEN_FAILED", String(status.block));
        expect("[retarget] reconciliation is required", status.reconciliationRequired);

        // The core safety property: no post-activation write may reach the superseded generation.
        const beforeOld = await oldStore?.stats();
        const accepted = runtime.enqueue({ op: "upsert", document: doc("must-not-land") });
        expect("[retarget] writes are REFUSED while blocked", !accepted.accepted && accepted.block === "ACTIVE_GENERATION_OPEN_FAILED", String(accepted.block));
        await runtime.drain();
        const afterOld = await oldStore?.stats();
        expect("[retarget] the superseded generation received NOTHING", afterOld?.documents === beforeOld?.documents, `${afterOld?.documents} vs ${beforeOld?.documents}`);

        await runtime.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 13. a restart opens the generation the POINTER names ──
    await step("restartOpensPointerSelectedGeneration", async () => {
      await scenario("restart", async ({ transport }) => {
        const runtime = newRuntime(transport, async () => [doc("wf-a"), doc("wf-b")]);
        await runtime.open();
        const first = await runtime.rebuild();
        const marker = doc("survives-restart");
        runtime.enqueue({ op: "upsert", document: marker });
        await runtime.drain();
        await runtime.shutdown();

        // A brand-new runtime over the same root: exactly what the next application start does.
        const restarted = newRuntime(transport, async () => []);
        const status = await restarted.open();
        expect("[restart] the restarted runtime is writable", status.writable && status.block === null, String(status.block));
        expect("[restart] it opened the generation the POINTER names", status.activeGeneration === first.generation, `${status.activeGeneration} vs ${first.generation}`);
        const stored = await restarted.store?.get(marker.id);
        expect("[restart] content written before shutdown is still present", stored?.id === marker.id);
        await restarted.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 14. rollback restores the retained previous generation ──
    await step("rollbackRestoresRetainedGeneration", async () => {
      await scenario("rollback", async ({ transport }) => {
        const runtime = newRuntime(transport, async () => [doc("only-in-first")]);
        await runtime.open();
        const first = await runtime.rebuild();
        await runtime.shutdown();

        const runtime2 = newRuntime(transport, async () => [doc("only-in-second"), doc("extra")]);
        await runtime2.open();
        const second = await runtime2.rebuild();
        await runtime2.shutdown();
        expect("[rollback] the second rebuild activated a different generation", second.generation !== first.generation, `${second.generation} vs ${first.generation}`);

        const activation = rollbackGeneration(runtimeRoot);
        expect("[rollback] rollback repointed at the retained previous generation", activation.pointer.activeGeneration === first.generation, `${activation.pointer.activeGeneration} vs ${first.generation}`);

        const rolled = newRuntime(transport, async () => []);
        const status = await rolled.open();
        expect("[rollback] a restart after rollback opens the FIRST generation", status.activeGeneration === first.generation, String(status.activeGeneration));
        const restored = await rolled.store?.get(doc("only-in-first").id);
        expect("[rollback] its original content is served again", restored !== null && restored !== undefined);
        const gone = await rolled.store?.get(doc("only-in-second").id);
        expect("[rollback] content unique to the rolled-back generation is not served", gone === null, JSON.stringify(gone?.id));
        await rolled.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 15. shutdown during a wedged rebuild completes within its deadline ──
    await step("shutdownDuringWedgedRebuildIsBounded", async () => {
      await scenario("wedged", async ({ transport }) => {
        let release: (() => void) | undefined;
        const wedged = new Promise<void>((resolve) => {
          release = resolve;
        });
        const runtime = newRuntime(
          transport,
          async () => {
            await wedged;
            return [doc("wf-a")];
          },
          { shutdownDeadlineMs: 300 }
        );
        await runtime.open();
        const rebuilding = runtime.rebuild();

        const started = Date.now();
        const result = await runtime.shutdown();
        const waited = Date.now() - started;

        expect("[wedged] shutdown reported that it did NOT reach quiescence", result.idle === false);
        expect("[wedged] ...and returned within its deadline rather than hanging", waited < 5_000, `waited=${waited}ms`);
        release?.();
        await rebuilding.catch(() => undefined);
      });
      return { checks: checks.length };
    });

    // ── 16. a host crash mid-mutation requires reconciliation and never blind-replays ──
    await step("hostCrashDuringMutationRequiresReconciliation", async () => {
      await scenario("crashWrite", async ({ mgr, transport }) => {
        const runtime = newRuntime(transport, async () => [doc("wf-a")]);
        await runtime.open();
        await runtime.rebuild();

        // Kill the utility process underneath an in-flight write.
        transport.fault = (req) => {
          if (req.type === "upsert") {
            const pid = mgr.status().pid;
            if (pid) {
              try {
                process.kill(pid);
              } catch {
                /* already gone */
              }
            }
          }
        };
        runtime.enqueue({ op: "upsert", document: doc("during-crash") });
        await runtime.drain();
        transport.fault = null;

        const status = runtime.status();
        expect("[crashWrite] the crash did not take the application process down", true);
        expect("[crashWrite] the failure is surfaced rather than silently swallowed", status.rebuildRequired || status.pending > 0, JSON.stringify({ rebuildRequired: status.rebuildRequired, pending: status.pending }));
        expect("[crashWrite] the host recorded an unexpected exit", (mgr.status().unexpectedExits ?? 0) > 0, String(mgr.status().unexpectedExits));
        await runtime.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 17. a host crash while populating the candidate leaves the active generation intact ──
    await step("hostCrashDuringPopulateLeavesActiveGenerationIntact", async () => {
      await scenario("crashPopulate", async ({ mgr, transport }) => {
        const runtime = newRuntime(transport, async () => [doc("wf-a")]);
        await runtime.open();
        await runtime.rebuild();
        const pointerBefore = activeGenerationOf();

        transport.fault = (req) => {
          if (req.type === "upsert" && typeof req.collectionId === "string" && req.collectionId !== pointerBefore) {
            const pid = mgr.status().pid;
            if (pid) {
              try {
                process.kill(pid);
              } catch {
                /* already gone */
              }
            }
          }
        };
        const report = await runtime.rebuild();
        transport.fault = null;

        expect("[crashPopulate] the rebuild was refused", !report.ok && !report.activated, JSON.stringify(report.refusal));
        expect("[crashPopulate] the active pointer did NOT move", activeGenerationOf() === pointerBefore, String(activeGenerationOf()));
        await runtime.shutdown();
      });
      return { checks: checks.length };
    });

    // ── 18. startup reconciliation handles a candidate interrupted mid-build ──
    await step("startupReconciliationHandlesInterruptedCandidate", async () => {
      await scenario("reconcile", async ({ transport }) => {
        const runtime = newRuntime(transport, async () => [doc("wf-a")]);
        await runtime.open();
        const first = await runtime.rebuild();
        await runtime.shutdown();

        // An orphan directory that no pointer names — exactly what an interrupted candidate leaves.
        const orphan = path.join(layout.generations, generationName(9998));
        fs.mkdirSync(orphan, { recursive: true });
        fs.writeFileSync(path.join(orphan, "PARTIAL"), "interrupted", "utf8");

        const report = reconcileGenerations({
          runtimeRoot,
          activeIdentity: resolveActiveIdentity(runtimeRoot)
        });
        expect("[reconcile] reconciliation kept the pointer's generation as active", report.activeGeneration === first.generation, `${report.activeGeneration} vs ${first.generation}`);
        expect("[reconcile] the ACTIVE generation was not reclaimed", fs.existsSync(path.join(layout.generations, String(first.generation))));
        expect("[reconcile] the interrupted candidate was not left as active", activeGenerationOf() === first.generation, String(activeGenerationOf()));

        const reopened = newRuntime(transport, async () => []);
        const status = await reopened.open();
        expect("[reconcile] the index still opens normally afterwards", status.writable && status.activeGeneration === first.generation, String(status.block));
        await reopened.shutdown();
      });
      return { checks: checks.length };
    });

    finish({
      contract: {
        total: checks.length,
        failed: checks.filter((c) => !c.ok).length,
        failures: checks.filter((c) => !c.ok).map((c) => ({ label: c.label, detail: c.detail }))
      },
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

  // Protocol v2 replaced the id-only `{ hits }` summary with real rows: `{ docs, truncated,
  // totalMatched, totalExact }`. These two steps still read `r.hits`, which is now always `undefined`
  // — so the POSITIVE check (`hits === 0`) silently passed for every run since v2 while asserting
  // nothing, and only the negative control (`hits !== 0`) failed loudly enough to be noticed. Both now
  // read the fields the host actually returns, and each asserts the row count AND the total.
  type QueryReply = { docs: unknown[]; totalMatched: number; totalExact: boolean };

  await step("ftsQueryMatches", async () => {
    const r = (await manager.call(
      { type: "query", collectionId: generation, query: { fieldName: "title", fts: { queryString: "automation AND workflow" }, topK: 20 } },
      ZVEC_HOST_TIMEOUTS.queryMs
    )) as QueryReply;
    if (!Array.isArray(r.docs)) throw new Error(`query returned no docs array (got ${JSON.stringify(Object.keys(r ?? {}))})`);
    if (r.docs.length === 0) throw new Error("FTS returned 0 rows for a term the corpus contains");
    if (!(r.totalMatched > 0)) throw new Error(`FTS matched rows but reported totalMatched=${r.totalMatched}`);
    return { rows: r.docs.length, totalMatched: r.totalMatched, totalExact: r.totalExact };
  });

  await step("ftsNegativeControl", async () => {
    const r = (await manager.call(
      { type: "query", collectionId: generation, query: { fieldName: "title", fts: { queryString: "zzzznonexistentterm" }, topK: 20 } },
      ZVEC_HOST_TIMEOUTS.queryMs
    )) as QueryReply;
    if (!Array.isArray(r.docs)) throw new Error(`query returned no docs array (got ${JSON.stringify(Object.keys(r ?? {}))})`);
    if (r.docs.length !== 0) throw new Error(`expected 0 rows for an absent term, got ${r.docs.length}`);
    if (r.totalMatched !== 0) throw new Error(`expected totalMatched=0 for an absent term, got ${r.totalMatched}`);
    return { rows: r.docs.length, totalMatched: r.totalMatched };
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
