// Phase 0C driver — exercises the STAGED, PACKAGED native-host tree
// (resources/native-hosts/zvec/) through the real §5.1 protocol, inside the real packaged AWKIT
// Electron main process.
//
// This is deliberately different from the Phase 0B modes: those imported @zvec/zvec from
// app.asar.unpacked. Phase 0C removes Zvec from app.asar entirely, so this driver proves the
// production-intended extraResources layout — raw unbundled host, own module root, jieba adjacency,
// path confinement, and CRUD — rather than the spike layout.

import { utilityProcess } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const VECTOR_DIM = 16;
const DOC_COUNT = 1200;
const CATEGORIES = ["workflow", "flow", "documentation", "run-failure", "locator-success"];
const CHINESE = ["自动化测试失败", "工作流执行成功", "定位器解析超时", "全文检索索引", "离线运行报告"];

const SEMANTIC_ROOT = path.join(process.env.LOCALAPPDATA ?? ".", "SpecterStudio", "semantic-index");
const GENERATIONS_DIR = path.join(SEMANTIC_ROOT, "generations");

function vec(seed) {
  return Array.from({ length: VECTOR_DIM }, (_, i) => Math.sin(seed * 0.017 + i) * 0.5 + 0.5);
}

function docs(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `doc-${i}`,
    fields: {
      title: `synthetic automation record number ${i} for category ${CATEGORIES[i % CATEGORIES.length]}`,
      titleZh: CHINESE[i % CHINESE.length],
      category: CATEGORIES[i % CATEGORIES.length]
    },
    vectors: { embedding: vec(i) }
  }));
}

const SCHEMA = {
  name: "awkitSemanticPhase0C",
  fields: [
    { name: "title", dataType: "STRING", fts: { tokenizer: "standard" } },
    { name: "titleZh", dataType: "STRING", fts: { tokenizer: "jieba" } },
    { name: "category", dataType: "STRING" }
  ],
  vectors: [{ name: "embedding", dimension: VECTOR_DIM }]
};

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Client side of the §5.1 protocol: one pending-request map, every request deadline-bounded. */
class HostClient {
  constructor(hostPath) {
    this.hostPath = hostPath;
    this.pending = new Map();
    this.seq = 0;
    this.exitCode = null;
  }

  start(timeoutMs = 10_000) {
    this.child = utilityProcess.fork(this.hostPath, [], { stdio: "pipe" });
    this.child.on("exit", (code) => {
      this.exitCode = code;
      for (const [, p] of this.pending) p.reject(new Error("SEMANTIC_HOST_EXITED"));
      this.pending.clear();
    });
    this.child.on("message", (msg) => {
      if (msg?.type === "ready") {
        this.readyResolve?.(msg);
        return;
      }
      const p = this.pending.get(msg?.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(Object.assign(new Error(msg.reason), { reason: msg.reason, retryable: msg.retryable }));
    });
    return this.#deadline(
      new Promise((resolve) => {
        this.readyResolve = resolve;
      }),
      timeoutMs,
      "handshake"
    );
  }

  request(type, payload = {}, timeoutMs = 60_000) {
    const id = `r${++this.seq}`;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.postMessage({ version: 1, id, type, ...payload });
    return this.#deadline(promise, timeoutMs, type);
  }

  #deadline(promise, ms, label) {
    let timer;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      })
    ]);
  }

  async stop() {
    const start = performance.now();
    try {
      await this.request("shutdown", {}, 2000);
    } catch {
      /* a host that cannot answer shutdown is killed below; never block the caller */
    }
    if (this.exitCode === null) {
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          this.child.kill();
          resolve();
        }, 2000);
        this.child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    return performance.now() - start;
  }
}

async function step(steps, label, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    steps.push({ label, ok: true, durationMs: +(performance.now() - start).toFixed(2), result });
    return result;
  } catch (err) {
    steps.push({
      label,
      ok: false,
      durationMs: +(performance.now() - start).toFixed(2),
      error: { message: String(err?.message ?? err), reason: err?.reason }
    });
    throw err;
  }
}

export async function runNativeHostChecks({ resourcesPath, isPackaged }) {
  const steps = [];
  const hostDir = path.join(resourcesPath, "native-hosts", "zvec");
  const hostPath = path.join(hostDir, "zvec-host.cjs");
  // Phase 0D §A9: a fixed generation name plus KEEP lets two separate app launches share one
  // collection, so restart persistence is proven ACROSS process lifetimes rather than only across
  // a close/reopen inside a single run.
  const generation = process.env.AWKIT_ZVEC_GENERATION_NAME || `gen-phase0c-${Date.now()}`;
  const keepGeneration = process.env.AWKIT_ZVEC_KEEP_GENERATION === "1";
  const generationPath = path.join(GENERATIONS_DIR, generation);
  const measurements = {};
  let client;

  try {
    // ── Health: the shipped tree must match its own manifest before anything is loaded ──
    await step(steps, "packagedTreeExists", async () => {
      if (!fs.existsSync(hostPath)) throw new Error(`host missing: ${hostPath}`);
      return { hostPath, outsideAsar: !hostPath.includes("app.asar") };
    });

    await step(steps, "packagedManifestChecksums", async () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(hostDir, "zvec-native-host-manifest.json"), "utf8"));
      let verified = 0;
      for (const asset of manifest.assets) {
        const abs = path.join(hostDir, asset.relativePath);
        if (!fs.existsSync(abs)) throw new Error(`missing packaged asset: ${asset.relativePath}`);
        if (fs.statSync(abs).size !== asset.size) throw new Error(`size mismatch: ${asset.relativePath}`);
        if (sha256(abs) !== asset.sha256) throw new Error(`checksum mismatch: ${asset.relativePath}`);
        verified++;
      }
      return { verified, total: manifest.assets.length, zvec: manifest.zvecVersion };
    });

    // Regression guard for a real defect found in Phase 0D: the main process must not be able to
    // resolve @zvec/zvec AT ALL. Running from dist/win-unpacked (inside the repo) lets Node's
    // upward node_modules walk satisfy the import from the repository tree, which silently
    // recreates the bundled-caller crash path. A genuine install location has no such fallback.
    await step(steps, "mainProcessCannotResolveZvec", async () => {
      const require_ = createRequire(import.meta.url);
      let resolvedFrom = null;
      try {
        resolvedFrom = require_.resolve("@zvec/zvec");
      } catch {
        /* expected: unreachable from the main process */
      }
      if (resolvedFrom) {
        throw new Error(
          `main process can resolve @zvec/zvec at ${resolvedFrom} — Zvec must be reachable ONLY from the utility host's own module root`
        );
      }
      const loadedNatively = process.moduleLoadList.filter((m) => /zvec/i.test(m));
      if (loadedNatively.length > 0) {
        throw new Error(`main process has loaded zvec native modules: ${loadedNatively.join(", ")}`);
      }
      return { resolvable: false, nativeModulesLoadedInMain: 0 };
    });

    await step(steps, "nativeBinaryOutsideAsar", async () => {
      const bin = path.join(hostDir, "node_modules", "@zvec", "bindings-win32-x64", "zvec_node_binding.node");
      const dict = path.join(path.dirname(bin), "jieba_dict", "jieba.dict.utf8");
      if (!fs.existsSync(bin)) throw new Error("native binary not found outside asar");
      if (!fs.existsSync(dict)) throw new Error("jieba dictionary not adjacent to binary");
      return { bytes: fs.statSync(bin).size, dictionaryAdjacent: true };
    });

    // ── Lifecycle + CRUD over the real protocol ──
    const spawnStart = performance.now();
    client = new HostClient(hostPath);
    await step(steps, "hostSpawnAndReady", async () => {
      const ready = await client.start(10_000);
      measurements.spawnAndReadyMs = +(performance.now() - spawnStart).toFixed(2);
      return { pid: ready.pid, ms: measurements.spawnAndReadyMs };
    });

    await step(steps, "helloHandshake", async () => {
      const hello = await client.request("hello", {
        expected: { protocolVersion: 1, platform: "win32", arch: "x64" }
      });
      if (!hello.compatible) throw new Error("SEMANTIC_NATIVE_INCOMPATIBLE");
      if (!hello.jiebaDictDir) throw new Error("jieba dictionary was not auto-registered");
      return hello;
    });

    // Confinement is checked BEFORE any real collection exists, so a rejection cannot be
    // confused with an incidental failure to open a valid path.
    await step(steps, "pathConfinementRejectsOutsideRoot", async () => {
      const attempts = [
        path.join(resourcesPath, "native-hosts", "zvec", "evil-generation"),
        path.join(process.env.LOCALAPPDATA ?? ".", "SpecterStudio", "flows"),
        path.join(GENERATIONS_DIR, "..", "..", "escape")
      ];
      const rejected = [];
      for (const p of attempts) {
        try {
          await client.request("open", { generation: `probe-${rejected.length}`, path: p, schema: SCHEMA });
          throw new Error(`host ACCEPTED an unapproved path: ${p}`);
        } catch (err) {
          if (err.reason !== "SEMANTIC_PATH_OUTSIDE_APPROVED_ROOT") throw err;
          rejected.push(path.basename(p));
        }
      }
      return { rejected, count: rejected.length };
    });

    const preExisting = fs.existsSync(generationPath);
    await step(steps, preExisting ? "openExistingGenerationAcrossRelaunch" : "openCreateGeneration", async () => {
      fs.mkdirSync(GENERATIONS_DIR, { recursive: true });
      const r = await client.request("open", { generation, path: generationPath, schema: SCHEMA });
      if (preExisting && r.created) throw new Error("expected to reopen an existing generation, but a new one was created");
      if (preExisting && r.docCount === 0) throw new Error("reopened generation across relaunch was empty");
      return { ...r, reopenedAcrossRelaunch: preExisting };
    });
    // Read the duration AFTER step() has recorded it. Reading steps.at(-1) from inside the
    // callback silently captured the PREVIOUS step's duration instead.
    measurements.createCollectionMs = steps.at(-1).durationMs;

    await step(steps, "insertOneDoc", () =>
      client.request("insert", {
        collectionId: generation,
        docs: [
          {
            id: "single-insert",
            fields: { title: "single inserted record", titleZh: CHINESE[0], category: "workflow" },
            vectors: { embedding: vec(9001) }
          }
        ]
      })
    );

    await step(steps, "batchInsert1200Docs", () =>
      client.request("insert", { collectionId: generation, docs: docs(DOC_COUNT) })
    );

    // Both FTS steps assert a NON-ZERO hit count against terms the fixture is known to contain.
    // An earlier revision queried "automation AND failed", which the fixture never produces
    // ("run-failure" is a category, "failed" is not a token) — so it returned 0 hits and would
    // have looked identical to a completely broken FTS index.
    await step(steps, "ftsQueryStandard", async () => {
      const r = await client.request("query", {
        collectionId: generation,
        query: { fieldName: "title", fts: { queryString: "automation AND workflow" }, topK: 20 }
      });
      if (r.hits === 0) throw new Error("standard-tokenizer FTS returned 0 hits for a term the corpus contains");
      return r;
    });

    // Negative control: a term the corpus definitely lacks must return 0, proving the non-zero
    // result above is real matching rather than the index returning everything.
    await step(steps, "ftsQueryStandardNegativeControl", async () => {
      const r = await client.request("query", {
        collectionId: generation,
        query: { fieldName: "title", fts: { queryString: "zzzznonexistentterm" }, topK: 20 }
      });
      if (r.hits !== 0) throw new Error(`expected 0 hits for an absent term, got ${r.hits}`);
      return r;
    });

    await step(steps, "ftsQueryJieba", async () => {
      const r = await client.request("query", {
        collectionId: generation,
        query: { fieldName: "titleZh", fts: { matchString: "自动化" }, topK: 20 }
      });
      if (r.hits === 0) throw new Error("jieba-tokenizer FTS returned 0 hits");
      return r;
    });

    await step(steps, "vectorQuery", () =>
      client.request("query", { collectionId: generation, query: { fieldName: "embedding", vector: vec(42), topK: 5 } })
    );

    await step(steps, "updateDoc", async () => {
      await client.request("update", { collectionId: generation, docId: "doc-0", fields: { category: "phase0c-updated" } });
      const back = await client.request("fetch", { collectionId: generation, ids: ["doc-0"] });
      if (back.docs.length !== 1) throw new Error("updated document was not fetchable");
      return { updated: "doc-0" };
    });

    await step(steps, "upsertDocs", () =>
      client.request("upsert", {
        collectionId: generation,
        docs: [
          {
            id: "doc-1",
            fields: { title: "upserted record one", titleZh: CHINESE[1], category: "phase0c-upsert" },
            vectors: { embedding: vec(1) }
          }
        ]
      })
    );

    await step(steps, "fetchDocs", async () => {
      const r = await client.request("fetch", { collectionId: generation, ids: ["doc-0", "doc-1"] });
      if (r.docs.length !== 2) throw new Error(`expected 2 docs, got ${r.docs.length}`);
      return r;
    });

    await step(steps, "deleteDocs", () => client.request("delete", { collectionId: generation, ids: ["doc-2", "doc-3"] }));

    const statsBefore = await step(steps, "statsBeforeClose", () => client.request("stats", { collectionId: generation }));

    await step(steps, "closeCollection", () => client.request("close", { collectionId: generation }));
    measurements.closeCollectionMs = steps.at(-1).durationMs;

    // ── Restart persistence: reopen the same generation and confirm the corpus survived ──
    await step(steps, "reopenPersistence", async () => {
      const r = await client.request("open", { generation, path: generationPath, schema: SCHEMA });
      if (r.created) throw new Error("reopen created a NEW collection instead of opening the existing one");
      const after = await client.request("stats", { collectionId: generation });
      if (after.docCount !== statsBefore.docCount) {
        throw new Error(`docCount changed across close/reopen: ${statsBefore.docCount} -> ${after.docCount}`);
      }
      return { docCount: after.docCount, persisted: true };
    });

    await step(steps, "closeAfterReopen", () => client.request("close", { collectionId: generation }));
  } catch {
    /* individual step failures are already recorded; the report below carries the verdict */
  } finally {
    if (client) measurements.gracefulShutdownMs = +(await client.stop()).toFixed(2);
    if (!keepGeneration) fs.rmSync(generationPath, { recursive: true, force: true });
  }

  return {
    phase: "0C",
    check: "packaged-native-host-health-and-crud",
    isPackaged,
    layout: "extraResources native-hosts/zvec (raw, unbundled, outside app.asar)",
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    generationPath,
    ok: steps.every((s) => s.ok),
    steps,
    measurements
  };
}
