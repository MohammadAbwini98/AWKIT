/**
 * Phase 01 — Headed Production Anchor. The A/B/C/D ramp and the 30-min soak were HEADLESS; AWKIT's real
 * default execution mode is HEADED (activeOnly). This runs the short headed cross-check that anchors the
 * production-default recommendation against headed execution: Config A vs Config D, MIXED, F=6, 45–60 s each,
 * through the REAL ExecutionEngine dispatch path (queue → adaptive → backpressure → weighted admission →
 * limiters → worker pool → isolation resolver → BrowserContextFactory → SharedBrowserPool → PlaywrightRunner).
 *
 * Reuses the existing engine harness (runStage) — no new architecture, no chromium.launch() per instance.
 * NOTE: headed mode opens real Chromium windows for the measurement window.
 *
 *   npm run benchmark:engine-headed                         (F=6, 50 s per config)
 *   AWKIT_ANCHOR_HOLD_MS=60000 AWKIT_ANCHOR_F=6 npm run benchmark:engine-headed
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { startWorkloadServer, reductionPct } from "./benchmark/lib.mts";
import { runStage, buildDirs, cleanupRoot, installBenchGuards, type ConfigSpec, type StageResult } from "./benchmark/engineHarness.mts";
import { DEFAULT_MIX } from "./benchmark/workloads.mts";

installBenchGuards();

const F = Number.parseInt(process.env.AWKIT_ANCHOR_F ?? "6", 10);
const HOLD_MS = Math.min(60000, Math.max(45000, Number.parseInt(process.env.AWKIT_ANCHOR_HOLD_MS ?? "50000", 10)));
const P = Number.parseInt(process.env.AWKIT_ANCHOR_POOL_BUDGET ?? "2", 10); // shared browsers for Config D
const PORT = 4460;

async function runConfig(wl: Awaited<ReturnType<typeof startWorkloadServer>>, spec: ConfigSpec): Promise<StageResult> {
  const { dirs, root } = await buildDirs("awkit-headed-anchor-");
  const engine = new ExecutionEngine();
  process.stdout.write(`  ${spec.name} (headed, F=${F}, browsers=${spec.maxBrowsersPerHost}, pool=${spec.sharedPool}, weights=${spec.workloadWeights}) … `);
  const result = await runStage(engine, wl, dirs, { config: spec, targetActive: F, holdMs: HOLD_MS, headless: false, mix: DEFAULT_MIX });
  await engine.drainIdleSharedBrowsers().catch(() => undefined);
  await cleanupRoot(root);
  console.log(`done: procs~${result.chromiumProcs?.median} rss~${result.chromiumRssMb?.median}MB cpuP95=${result.cpuPercent?.p95} thr=${result.throughputPerMin}/min p95=${result.durationP95Ms}ms fail=${result.failed} clean=${result.teardown.clean}`);
  return result;
}

function row(r: StageResult) {
  return {
    config: r.config,
    chromiumProcsMedian: r.chromiumProcs?.median ?? 0,
    chromiumRssMedianMb: r.chromiumRssMb?.median ?? 0,
    chromiumRssP95Mb: r.chromiumRssMb?.p95 ?? 0,
    chromiumPeakRssMb: r.chromiumPeakRssMb,
    cpuMean: r.cpuPercent?.mean ?? 0,
    cpuP95: r.cpuPercent?.p95 ?? 0,
    cpuPeak: r.cpuPercent?.max ?? 0,
    sharedBrowsersMedian: r.sharedBrowsers?.median ?? 0,
    sharedContextsMedian: r.sharedContexts?.median ?? 0,
    throughputPerMin: r.throughputPerMin,
    durationP50Ms: r.durationP50Ms ?? 0,
    durationP95Ms: r.durationP95Ms ?? 0,
    queueWaitP95Ms: r.queueWaitP95Ms ?? 0,
    failed: r.failed, failureRate: r.failureRate, retries: r.retries, crashes: r.crashes,
    sustainedActiveMedian: r.sustainedActive?.median ?? 0,
    teardownClean: r.teardown.clean
  };
}

async function main() {
  const wl = await startWorkloadServer(PORT);
  console.log(`Headed Production Anchor — Config A vs D, MIXED, F=${F}, hold=${HOLD_MS / 1000}s each, headed (activeOnly).\n`);
  try {
    const specA: ConfigSpec = { name: "A", sharedPool: false, workloadWeights: false, maxBrowsersPerHost: F, maxActiveFlows: F };
    const specD: ConfigSpec = { name: "D", sharedPool: true, workloadWeights: true, maxBrowsersPerHost: P, maxActiveFlows: F };
    const rA = row(await runConfig(wl, specA));
    const rD = row(await runConfig(wl, specD));

    // Config D vs A deltas (reductionPct is positive when D uses LESS; throughput/duration shown as % change).
    const deltas = {
      chromiumProcsReductionPct: reductionPct(rA.chromiumProcsMedian, rD.chromiumProcsMedian),
      chromiumRssReductionPct: reductionPct(rA.chromiumRssMedianMb, rD.chromiumRssMedianMb),
      cpuP95ReductionPct: reductionPct(rA.cpuP95, rD.cpuP95),
      throughputChangePct: rA.throughputPerMin > 0 ? Number((((rD.throughputPerMin - rA.throughputPerMin) / rA.throughputPerMin) * 100).toFixed(1)) : 0,
      durationP95ChangePct: rA.durationP95Ms > 0 ? Number((((rD.durationP95Ms - rA.durationP95Ms) / rA.durationP95Ms) * 100).toFixed(1)) : 0,
      failureRateDelta: Number((rD.failureRate - rA.failureRate).toFixed(4))
    };

    const artifactDir = join(process.cwd(), "reports", "browser-performance");
    await mkdir(artifactDir, { recursive: true });
    const artifactPath = join(artifactDir, "headed-anchor.json");
    await writeFile(artifactPath, JSON.stringify({ mode: "headed", F, holdMs: HOLD_MS, sharedPoolBudgetP: P, mix: DEFAULT_MIX, results: { A: rA, D: rD }, deltas }, null, 2), "utf8");

    const p = (n: number) => String(n).padStart(9);
    console.log(`\n=== Headed anchor (F=${F}, ${HOLD_MS / 1000}s/config) ===`);
    console.log(`Config | Procs | ChromRSS(med/P95/peak) | CPU(mean/P95/peak) | shBr/ctx | thr/min | durP50/P95 | qWaitP95 | fail/retry/crash | sustained | clean`);
    for (const r of [rA, rD]) {
      console.log(`  ${r.config}   |${p(r.chromiumProcsMedian)} | ${r.chromiumRssMedianMb}/${r.chromiumRssP95Mb}/${r.chromiumPeakRssMb}MB | ${r.cpuMean}/${r.cpuP95}/${r.cpuPeak}% | ${r.sharedBrowsersMedian}/${r.sharedContextsMedian} | ${r.throughputPerMin} | ${r.durationP50Ms}/${r.durationP95Ms}ms | ${r.queueWaitP95Ms}ms | ${r.failed}/${r.retries}/${r.crashes} | ${r.sustainedActiveMedian} | ${r.teardownClean ? "✓" : "✗"}`);
    }
    console.log(`\nD vs A deltas: procs ${deltas.chromiumProcsReductionPct}% less | Chromium RSS ${deltas.chromiumRssReductionPct}% less | CPU P95 ${deltas.cpuP95ReductionPct}% less | throughput ${deltas.throughputChangePct >= 0 ? "+" : ""}${deltas.throughputChangePct}% | P95 duration ${deltas.durationP95ChangePct >= 0 ? "+" : ""}${deltas.durationP95ChangePct}% | failureRate Δ ${deltas.failureRateDelta}`);
    console.log(`\nArtifact: ${artifactPath}`);
  } finally {
    wl.server.close();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
