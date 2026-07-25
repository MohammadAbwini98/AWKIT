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
import { ZVEC_HOST_TIMEOUTS } from "@src/semantic/contracts/ZvecHostProtocol";
import { generationName, semanticIndexLayout } from "@src/semantic/SemanticGenerationLayout";

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
