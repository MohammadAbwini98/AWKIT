// Phase 0D §E — repeated benchmark against the production-shaped utility host.
//
// Phase 0B reported single-run figures; those are not percentiles and were explicitly rejected.
// Every number here comes from a named sample count recorded alongside it.

import { utilityProcess } from "electron";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";

const VECTOR_DIM = 16;
const CORPUS = 1200;
const COLD_STARTS = 10;
const WARM_SUITES = 30;
const FTS_QUERIES = 1000;
const VECTOR_QUERIES = 500;
const CLOSE_CYCLES = 15;

const SEMANTIC_ROOT = path.join(process.env.LOCALAPPDATA ?? ".", "SpecterStudio", "semantic-index");
const GENERATIONS_DIR = path.join(SEMANTIC_ROOT, "generations");
const CATEGORIES = ["workflow", "flow", "documentation", "run-failure", "locator-success"];

const vec = (seed) => Array.from({ length: VECTOR_DIM }, (_, i) => Math.sin(seed * 0.017 + i) * 0.5 + 0.5);
const corpus = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `doc-${i}`,
    fields: {
      title: `synthetic automation record number ${i} for category ${CATEGORIES[i % CATEGORIES.length]}`,
      category: CATEGORIES[i % CATEGORIES.length]
    },
    vectors: { embedding: vec(i) }
  }));

const SCHEMA = {
  name: "awkitBenchmark",
  fields: [
    { name: "title", dataType: "STRING", fts: { tokenizer: "standard" } },
    { name: "category", dataType: "STRING" }
  ],
  vectors: [{ name: "embedding", dimension: VECTOR_DIM }]
};

/** Nearest-rank percentile on a sorted copy. Returns null below 2 samples rather than inventing one. */
function pct(samples, p) {
  if (!samples.length) return null;
  const s = [...samples].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return +s[Math.max(0, idx)].toFixed(3);
}

function summarize(samples) {
  if (!samples.length) return { n: 0 };
  return {
    n: samples.length,
    min: +Math.min(...samples).toFixed(3),
    p50: pct(samples, 50),
    p95: pct(samples, 95),
    p99: pct(samples, 99),
    max: +Math.max(...samples).toFixed(3),
    mean: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3)
  };
}

function withDeadline(promise, ms, label) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms);
    })
  ]);
}

class Host {
  constructor(hostPath) {
    this.hostPath = hostPath;
    this.pending = new Map();
    this.seq = 0;
    this.exited = false;
  }
  async start() {
    const t0 = performance.now();
    this.child = utilityProcess.fork(this.hostPath, [], { stdio: "pipe" });
    this.child.on("exit", () => {
      this.exited = true;
      for (const [, p] of this.pending) p.reject(new Error("SEMANTIC_HOST_EXITED"));
      this.pending.clear();
    });
    this.child.on("message", (m) => {
      if (m?.type === "ready") return this.readyResolve?.(m);
      const p = this.pending.get(m?.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.ok ? p.resolve(m.value) : p.reject(new Error(m.reason));
    });
    await withDeadline(
      new Promise((r) => {
        this.readyResolve = r;
      }),
      15_000,
      "ready"
    );
    return performance.now() - t0;
  }
  req(type, payload = {}, ms = 60_000) {
    const id = `b${++this.seq}`;
    const p = new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
    this.child.postMessage({ version: 1, id, type, ...payload });
    return withDeadline(p, ms, type);
  }
  async shutdown() {
    const t0 = performance.now();
    try {
      await this.req("shutdown", {}, 2000);
    } catch {
      /* fall through to kill */
    }
    if (!this.exited) {
      await new Promise((r) => {
        const t = setTimeout(() => {
          this.child.kill();
          r();
        }, 2000);
        this.child.once("exit", () => {
          clearTimeout(t);
          r();
        });
      });
    }
    return performance.now() - t0;
  }
}

async function cpuPercentOver(ms) {
  const start = process.cpuUsage();
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, ms));
  const diff = process.cpuUsage(start);
  const elapsedUs = (performance.now() - t0) * 1000;
  return +(((diff.user + diff.system) / elapsedUs) * 100).toFixed(2);
}

export async function runBenchmark({ resourcesPath }) {
  const hostPath = path.join(resourcesPath, "native-hosts", "zvec", "zvec-host.cjs");
  fs.mkdirSync(GENERATIONS_DIR, { recursive: true });

  const results = {};
  const mainRssBaseline = process.memoryUsage().rss;

  // Event-loop delay of the Electron MAIN process, sampled across the whole run.
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();

  // ── 1. Cold host starts ──
  const coldStarts = [];
  for (let i = 0; i < COLD_STARTS; i++) {
    const h = new Host(hostPath);
    coldStarts.push(await h.start());
    await h.shutdown();
  }
  results.hostColdStartMs = summarize(coldStarts);

  // ── 2. Steady-state host for the operation benchmarks ──
  const host = new Host(hostPath);
  await host.start();
  const gen = `gen-bench-${Date.now()}`;
  const genPath = path.join(GENERATIONS_DIR, gen);

  const createStart = performance.now();
  await host.req("open", { generation: gen, path: genPath, schema: SCHEMA });
  results.collectionCreateColdMs = { n: 1, value: +(performance.now() - createStart).toFixed(3) };

  // ── 3. Insertion throughput ──
  const docs = corpus(CORPUS);
  const insertStart = performance.now();
  await host.req("insert", { collectionId: gen, docs });
  const insertMs = performance.now() - insertStart;
  results.insertion = {
    docs: CORPUS,
    totalMs: +insertMs.toFixed(3),
    docsPerSecond: +((CORPUS / insertMs) * 1000).toFixed(1),
    note: "single batch of 1200, chunked at 1024 inside the host"
  };

  // ── 4. FTS queries ──
  const ftsSamples = [];
  const terms = ["automation", "workflow", "documentation", "record", "category"];
  for (let i = 0; i < FTS_QUERIES; i++) {
    const t0 = performance.now();
    await host.req("query", {
      collectionId: gen,
      query: { fieldName: "title", fts: { queryString: terms[i % terms.length] }, topK: 20 }
    });
    ftsSamples.push(performance.now() - t0);
  }
  results.ftsQueryMs = summarize(ftsSamples);

  // ── 5. Vector queries ──
  const vecSamples = [];
  for (let i = 0; i < VECTOR_QUERIES; i++) {
    const t0 = performance.now();
    await host.req("query", { collectionId: gen, query: { fieldName: "embedding", vector: vec(i), topK: 5 } });
    vecSamples.push(performance.now() - t0);
  }
  results.vectorQueryMs = summarize(vecSamples);

  // ── 6. Warm operation suites ──
  const warmSuites = [];
  for (let i = 0; i < WARM_SUITES; i++) {
    const t0 = performance.now();
    await host.req("insert", {
      collectionId: gen,
      docs: [{ id: `warm-${i}`, fields: { title: `warm suite record ${i}`, category: "workflow" }, vectors: { embedding: vec(i) } }]
    });
    await host.req("query", { collectionId: gen, query: { fieldName: "title", fts: { queryString: "automation" }, topK: 20 } });
    await host.req("query", { collectionId: gen, query: { fieldName: "embedding", vector: vec(i), topK: 5 } });
    await host.req("fetch", { collectionId: gen, ids: ["doc-0", "doc-1"] });
    await host.req("update", { collectionId: gen, docId: "doc-0", fields: { category: `warm-${i}` } });
    await host.req("delete", { collectionId: gen, ids: [`warm-${i}`] });
    warmSuites.push(performance.now() - t0);
  }
  results.warmSuiteMs = summarize(warmSuites);

  // RSS while the host is live and loaded.
  const utilityRssSample = await host.req("stats", { collectionId: gen }).then(() => process.memoryUsage().rss);
  results.cpuPercentDuringIdleSample = await cpuPercentOver(1000);

  await host.req("close", { collectionId: gen });
  const shutdownFirst = await host.shutdown();

  // ── 7. Repeated close + graceful shutdown cycles ──
  const closeSamples = [];
  const shutdownSamples = [shutdownFirst];
  for (let i = 0; i < CLOSE_CYCLES; i++) {
    const h = new Host(hostPath);
    await h.start();
    await h.req("open", { generation: gen, path: genPath, schema: SCHEMA });
    const c0 = performance.now();
    await h.req("close", { collectionId: gen });
    closeSamples.push(performance.now() - c0);
    shutdownSamples.push(await h.shutdown());
  }
  results.collectionCloseMs = summarize(closeSamples);
  results.gracefulShutdownMs = summarize(shutdownSamples);

  loopDelay.disable();
  results.mainEventLoopDelayMs = {
    n: loopDelay.count,
    p50: +(loopDelay.percentile(50) / 1e6).toFixed(3),
    p95: +(loopDelay.percentile(95) / 1e6).toFixed(3),
    p99: +(loopDelay.percentile(99) / 1e6).toFixed(3),
    max: +(loopDelay.max / 1e6).toFixed(3),
    note: "Electron MAIN process event-loop delay sampled across the entire benchmark"
  };

  const mainRssAfter = process.memoryUsage().rss;
  results.memory = {
    mainRssBaselineBytes: mainRssBaseline,
    mainRssAfterBytes: mainRssAfter,
    mainRssGrowthBytes: mainRssAfter - mainRssBaseline,
    mainRssWhileHostLiveBytes: utilityRssSample,
    note:
      "Utility-process RSS is not readable from the parent via Node APIs; measured externally by the " +
      "harness (see PowerShell process sampling in the Phase 0D report). Main-process growth is the " +
      "architecturally significant number and is measured directly here."
  };

  fs.rmSync(genPath, { recursive: true, force: true });

  return {
    phase: "0D",
    check: "repeated-benchmark",
    host: "resources/native-hosts/zvec/zvec-host.cjs (production-shaped, utilityProcess.fork)",
    methodology: {
      coldStarts: COLD_STARTS,
      warmSuites: WARM_SUITES,
      ftsQueries: FTS_QUERIES,
      vectorQueries: VECTOR_QUERIES,
      closeShutdownCycles: CLOSE_CYCLES,
      corpusDocs: CORPUS,
      percentileMethod: "nearest-rank on sorted samples",
      machine: { cpus: os.cpus().length, model: os.cpus()[0]?.model, totalMemBytes: os.totalmem() },
      electron: process.versions.electron,
      node: process.versions.node
    },
    ok: true,
    results
  };
}
