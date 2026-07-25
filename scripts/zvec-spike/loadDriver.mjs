// Phase 0D §F — sustained Zvec load profiles, run inside the packaged app while a real
// Playwright workflow executes against the local mock site in a separate process.
//
// Profiles (AWKIT_ZVEC_LOAD_PROFILE):
//   fts    — continuous full-text queries
//   upsert — bounded incremental upserts
//   batch  — throttled larger indexing batches
//   crash  — run briefly, then hard-abort the host mid-operation
//
// Duration comes from AWKIT_ZVEC_LOAD_SECONDS. The report records how much work actually
// happened, so a "coexistence" result can never be quietly based on an idle host.

import { utilityProcess } from "electron";
import fs from "node:fs";
import path from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";

const VECTOR_DIM = 16;
const SEMANTIC_ROOT = path.join(process.env.LOCALAPPDATA ?? ".", "SpecterStudio", "semantic-index");
const GENERATIONS_DIR = path.join(SEMANTIC_ROOT, "generations");
const CATEGORIES = ["workflow", "flow", "documentation", "run-failure", "locator-success"];

const vec = (s) => Array.from({ length: VECTOR_DIM }, (_, i) => Math.sin(s * 0.017 + i) * 0.5 + 0.5);
const doc = (i, tag) => ({
  id: `${tag}-${i}`,
  fields: {
    title: `synthetic automation record number ${i} for category ${CATEGORIES[i % CATEGORIES.length]}`,
    category: CATEGORIES[i % CATEGORIES.length]
  },
  vectors: { embedding: vec(i) }
});

const SCHEMA = {
  name: "awkitCoexistence",
  fields: [
    { name: "title", dataType: "STRING", fts: { tokenizer: "standard" } },
    { name: "category", dataType: "STRING" }
  ],
  vectors: [{ name: "embedding", dimension: VECTOR_DIM }]
};

function withDeadline(p, ms, label) {
  let t;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`${label} timeout`)), ms);
    })
  ]);
}

export async function runLoad({ resourcesPath }) {
  const profile = process.env.AWKIT_ZVEC_LOAD_PROFILE ?? "fts";
  const seconds = Number(process.env.AWKIT_ZVEC_LOAD_SECONDS ?? 120);
  const hostPath = path.join(resourcesPath, "native-hosts", "zvec", "zvec-host.cjs");
  const gen = `gen-load-${Date.now()}`;
  const genPath = path.join(GENERATIONS_DIR, gen);
  fs.mkdirSync(GENERATIONS_DIR, { recursive: true });

  const pending = new Map();
  let seq = 0;
  let exited = false;
  let exitCode = null;

  const child = utilityProcess.fork(hostPath, [], {
    stdio: "pipe",
    env: profile === "crash" ? { ...process.env, AWKIT_ZVEC_HOST_TEST_ABORT: "1" } : process.env
  });

  let readyResolve;
  const ready = new Promise((r) => {
    readyResolve = r;
  });
  child.on("message", (m) => {
    if (m?.type === "ready") return readyResolve(m);
    const p = pending.get(m?.id);
    if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m.value) : p.reject(new Error(m.reason));
  });
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
    for (const [, p] of pending) p.reject(new Error("SEMANTIC_HOST_EXITED"));
    pending.clear();
  });

  const req = (type, payload = {}, ms = 60_000) => {
    const id = `l${++seq}`;
    const p = new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
    child.postMessage({ version: 1, id, type, ...payload });
    return withDeadline(p, ms, type);
  };

  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();

  await withDeadline(ready, 15_000, "ready");
  await req("open", { generation: gen, path: genPath, schema: SCHEMA });
  await req("insert", { collectionId: gen, docs: Array.from({ length: 1000 }, (_, i) => doc(i, "seed")) });

  const counters = { ftsQueries: 0, vectorQueries: 0, upserts: 0, batches: 0, docsWritten: 0, errors: 0 };
  const started = performance.now();
  const deadline = started + seconds * 1000;
  let crashInjectedAt = null;
  let n = 0;

  const terms = ["automation", "workflow", "documentation", "record", "category"];

  while (performance.now() < deadline && !exited) {
    try {
      if (profile === "fts") {
        await req("query", { collectionId: gen, query: { fieldName: "title", fts: { queryString: terms[n % terms.length] }, topK: 20 } });
        counters.ftsQueries++;
        if (n % 5 === 0) {
          await req("query", { collectionId: gen, query: { fieldName: "embedding", vector: vec(n), topK: 5 } });
          counters.vectorQueries++;
        }
      } else if (profile === "upsert") {
        // Bounded incremental writes, the shape real indexing events would produce.
        await req("upsert", { collectionId: gen, docs: [doc(n, "inc"), doc(n + 1, "inc")] });
        counters.upserts++;
        counters.docsWritten += 2;
        await new Promise((r) => setTimeout(r, 25));
      } else if (profile === "batch") {
        // Throttled larger batch, simulating a rebuild running at low priority.
        await req("insert", { collectionId: gen, docs: Array.from({ length: 500 }, (_, i) => doc(n * 500 + i, "batch")) });
        counters.batches++;
        counters.docsWritten += 500;
        await new Promise((r) => setTimeout(r, 250));
      } else if (profile === "crash") {
        await req("query", { collectionId: gen, query: { fieldName: "title", fts: { queryString: "automation" }, topK: 20 } });
        counters.ftsQueries++;
        // Abort roughly a third of the way in, so the workflow is mid-flight when it happens.
        if (crashInjectedAt === null && performance.now() - started > (seconds * 1000) / 3) {
          crashInjectedAt = +(performance.now() - started).toFixed(1);
          child.postMessage({ version: 1, id: "abort", type: "__testAbort" });
        }
      }
    } catch (err) {
      counters.errors++;
      if (String(err.message).includes("SEMANTIC_HOST_EXITED")) break;
    }
    n++;
  }

  loop.disable();
  const elapsedMs = +(performance.now() - started).toFixed(1);

  if (!exited) {
    try {
      await req("close", { collectionId: gen }, 5000);
    } catch {
      /* the load report is the artefact; a failed close must not mask it */
    }
    try {
      await req("shutdown", {}, 2000);
    } catch {
      /* fall through */
    }
    if (!exited) child.kill();
  }
  fs.rmSync(genPath, { recursive: true, force: true });

  return {
    phase: "0D",
    check: "playwright-coexistence-zvec-load",
    profile,
    requestedSeconds: seconds,
    elapsedMs,
    counters,
    hostExited: exited,
    hostExitCode: exitCode,
    crashInjectedAtMs: crashInjectedAt,
    mainEventLoopDelayMs: {
      n: loop.count,
      p50: +(loop.percentile(50) / 1e6).toFixed(3),
      p95: +(loop.percentile(95) / 1e6).toFixed(3),
      p99: +(loop.percentile(99) / 1e6).toFixed(3),
      max: +(loop.max / 1e6).toFixed(3)
    },
    mainRssBytes: process.memoryUsage().rss,
    ok: true
  };
}
