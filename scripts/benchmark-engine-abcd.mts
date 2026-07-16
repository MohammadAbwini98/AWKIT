/**
 * Phase 2 + 4 — A/B/C/D runtime configurations × machine-relative concurrency ramp, driven through the
 * COMPLETE real ExecutionEngine dispatch path (see engineHarness.mts). MIXED workload by default.
 *
 * Only two levers change across configs (AdaptiveController + BackpressureController stay ON in all four):
 *   A: shared pool OFF, A8 weights OFF   (production baseline)
 *   B: shared pool ON,  A8 weights OFF   (isolates browser sharing)
 *   C: shared pool OFF, A8 weights ON    (isolates workload-aware admission)
 *   D: shared pool ON,  A8 weights ON    (proposed optimized architecture)
 *
 * Concurrency stages are generated from the detected machine + CapacityPlanner (nothing hardcoded). Each
 * stage is held for AWKIT_BENCH_HOLD_MS (default 45s). Pool-OFF configs need one dedicated browser per
 * active workflow, so maxBrowsers scales with the stage; pool-ON configs use a fixed machine-relative
 * browser budget P and let contexts share — that decoupling IS the direct consequence of the flag.
 *
 * Run (full):  npm run benchmark:engine
 * Run (quick): AWKIT_BENCH_HOLD_MS=6000 AWKIT_BENCH_STAGES=2,4 AWKIT_BENCH_CONFIGS=A,D npm run benchmark:engine
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectMachineCapabilities, loadOrCreateMachineId } from "@src/runner/concurrency/MachineCapabilityDetector";
import { planCapacity, DEFAULT_CAPACITY_TUNING } from "@src/runner/concurrency/CapacityPlanner";
import { resolveEffectiveConcurrency } from "@src/runner/concurrency/CapacityContracts";
import { generateBenchmarkStages, evaluateStopConditions, DEFAULT_BENCHMARK_THRESHOLDS, type BenchmarkHealthSample } from "@src/runner/concurrency/BenchmarkPlanner";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { startWorkloadServer } from "./benchmark/lib.mts";
import { runStage, buildDirs, cleanupRoot, installBenchGuards, type ConfigSpec, type StageResult } from "./benchmark/engineHarness.mts";
import { DEFAULT_MIX } from "./benchmark/workloads.mts";

installBenchGuards();

const HOLD_MS = Number.parseInt(process.env.AWKIT_BENCH_HOLD_MS ?? "45000", 10);
const PORT = 4430;
const CONFIG_NAMES = (process.env.AWKIT_BENCH_CONFIGS ?? "A,B,C,D").split(",").map((s) => s.trim().toUpperCase());
const HEADED_ANCHOR = ["1", "true", "yes"].includes((process.env.AWKIT_BENCH_HEADED_ANCHOR ?? "").toLowerCase());

interface ConfigPolicy { name: string; sharedPool: boolean; workloadWeights: boolean; }
const POLICIES: Record<string, ConfigPolicy> = {
  A: { name: "A", sharedPool: false, workloadWeights: false },
  B: { name: "B", sharedPool: true, workloadWeights: false },
  C: { name: "C", sharedPool: false, workloadWeights: true },
  D: { name: "D", sharedPool: true, workloadWeights: true }
};

function healthSample(r: StageResult): BenchmarkHealthSample {
  return {
    avgCpuPercent: r.cpuPercent?.mean,
    p95CpuPercent: r.cpuPercent?.p95,
    systemMemoryPercent: r.samples.length ? Math.max(...r.samples.map((s) => s.systemMemoryPercent ?? 0)) : undefined,
    eventLoopDelayMs: r.eventLoopDelayMs?.p95,
    errorRate: r.failureRate,
    browserCrashes: r.crashes,
    rendererCrashes: 0
  };
}

/** Compact per-stage row for the artifact (drops the raw sample array to keep the file readable). */
function compactStage(r: StageResult, stop: { stop: boolean; reasons?: string[] }) {
  return {
    config: r.config,
    targetActive: r.targetActive,
    sustainedActiveMedian: r.sustainedActive?.median,
    sustainedActiveMax: r.sustainedActive?.max,
    chromiumProcsMedian: r.chromiumProcs?.median,
    chromiumRssMedianMb: r.chromiumRssMb?.median,
    chromiumPeakRssMb: r.chromiumPeakRssMb,
    sharedBrowsersMedian: r.sharedBrowsers?.median,
    sharedContextsMedian: r.sharedContexts?.median,
    cpuMean: r.cpuPercent?.mean,
    cpuMedian: r.cpuPercent?.median,
    cpuP95: r.cpuPercent?.p95,
    cpuPeak: r.cpuPercent?.max,
    eventLoopP95Ms: r.eventLoopDelayMs?.p95,
    awkitRssMedianMb: r.processRssMb?.median,
    nodeHeapMedianMb: r.nodeHeapUsedMb?.median,
    queueDepthMedian: r.queueDepth?.median,
    dispatchBlockedFraction: r.dispatchBlockedFraction,
    blockedReasons: r.blockedReasons,
    throughputPerMin: r.throughputPerMin,
    durationP50Ms: r.durationP50Ms,
    durationP95Ms: r.durationP95Ms,
    queueWaitP95Ms: r.queueWaitP95Ms,
    completed: r.completed,
    failed: r.failed,
    failureRate: r.failureRate,
    retries: r.retries,
    crashes: r.crashes,
    failureSamples: r.failureSamples,
    limits: r.limits,
    teardownClean: r.teardown.clean,
    teardownNotes: r.teardown.notes,
    healthStop: stop.stop,
    stopReasons: stop.reasons ?? []
  };
}

async function main() {
  const runtimeRoot = process.env.AWKIT_RUNTIME_ROOT ?? join(process.cwd(), ".benchmark-runtime");
  await mkdir(runtimeRoot, { recursive: true });
  const machineId = await loadOrCreateMachineId(runtimeRoot);
  const caps = detectMachineCapabilities(machineId);
  const rec = planCapacity({ capabilities: caps, workloadClass: "medium", tuning: DEFAULT_CAPACITY_TUNING });
  const eff = resolveEffectiveConcurrency({
    mode: "auto", manualBrowsers: 1, manualActiveFlows: 1, recommendation: rec,
    administratorMaximumConcurrency: DEFAULT_CAPACITY_TUNING.administratorMaximumConcurrency,
    absoluteSafetyMaximum: DEFAULT_CAPACITY_TUNING.absoluteSafetyMaximum
  });
  const R = rec.conservativeRecommendedCapacity;
  const ceiling = eff.ceiling;
  const plannerStages = generateBenchmarkStages(R, ceiling); // recorded for reference (planner view)
  // Empirical ramp: bounded by real hardware. The planner's R is memory-conservative (often 1 here — see
  // the Phase 7 review), so a stage ramp seeded only from R would be degenerate. Derive machine-relative
  // stages from the DETECTED logical-CPU count (nothing hardcoded) spanning ¼×cores … 1.5×cores; the health
  // stop conditions end each config's ramp as soon as the host is no longer healthy.
  const cores = caps.logicalCpuCount;
  const derivedStages = [...new Set([Math.ceil(cores / 4), Math.ceil(cores / 2), Math.ceil((3 * cores) / 4), cores, Math.ceil((5 * cores) / 4), Math.ceil((3 * cores) / 2)].filter((n) => n >= 2 && n <= ceiling))].sort((a, b) => a - b);
  const stages = (process.env.AWKIT_BENCH_STAGES
    ? process.env.AWKIT_BENCH_STAGES.split(",").map((s) => Number.parseInt(s.trim(), 10)).filter((n) => n >= 1)
    : derivedStages);
  // Shared-pool browser budget P: fixed, machine-relative, and < high stages so sharing is exercised.
  const P = Math.max(2, Math.min(4, Math.ceil(R / 2)));

  console.log(`Machine ${machineId}: ${caps.logicalCpuCount} CPUs, ${caps.totalMemoryMb}MB RAM (avail ${caps.availableMemoryMb}MB), category=${rec.categoryName}`);
  console.log(`R(recommended)=${R} ceiling=${ceiling} sharedPoolBudgetP=${P}`);
  console.log(`stages: ${stages.join(" → ")}  hold=${HOLD_MS}ms  configs=${CONFIG_NAMES.join(",")}  mix=${JSON.stringify(DEFAULT_MIX)}\n`);

  const wl = await startWorkloadServer(PORT);
  const artifactDir = join(process.cwd(), "reports", "browser-performance");
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "engine-abcd.json");

  const results: Record<string, ReturnType<typeof compactStage>[]> = {};
  const stableConcurrency: Record<string, number> = {};

  try {
    for (const name of CONFIG_NAMES) {
      const policy = POLICIES[name];
      if (!policy) { console.warn(`unknown config ${name}, skipping`); continue; }
      results[name] = [];
      console.log(`\n══════ Config ${name} (pool=${policy.sharedPool} weights=${policy.workloadWeights}) ══════`);
      let stable = 0;
      for (const F of stages) {
        const spec: ConfigSpec = {
          name,
          sharedPool: policy.sharedPool,
          workloadWeights: policy.workloadWeights,
          maxBrowsersPerHost: policy.sharedPool ? P : F, // pool-off ⇒ 1 browser per active workflow
          maxActiveFlows: F
        };
        process.stdout.write(`  stage F=${F} (browsers=${spec.maxBrowsersPerHost}) … `);
        const { dirs, root } = await buildDirs();
        const engine = new ExecutionEngine();
        const result = await runStage(engine, wl, dirs, { config: spec, targetActive: F, holdMs: HOLD_MS, headless: true, mix: DEFAULT_MIX });
        await cleanupRoot(root);
        const stop = evaluateStopConditions(healthSample(result), DEFAULT_BENCHMARK_THRESHOLDS);
        results[name].push(compactStage(result, stop));
        await writeFile(artifactPath, JSON.stringify({ machine: { machineId, ...caps }, recommendation: { R, ceiling, category: rec.categoryName, plannerStages }, sharedPoolBudgetP: P, holdMs: HOLD_MS, stages, mix: DEFAULT_MIX, results, stableConcurrency }, null, 2), "utf8");
        const active = result.sustainedActive?.median ?? 0;
        console.log(`active≈${active} chromium=${result.chromiumProcs?.median}proc/${result.chromiumRssMb?.median}MB cpuP95=${result.cpuPercent?.p95}% tput=${result.throughputPerMin}/min fail=${result.failureRate} ${stop.stop ? `STOP(${stop.reasons?.join("; ")})` : "healthy"}${result.teardown.clean ? "" : " [LEAK]"}`);
        if (result.failureSamples.length) console.log(`      failures: ${result.failureSamples.join(" || ")}`);
        if (!stop.stop) stable = Math.max(stable, Math.round(active));
        if (stop.stop) break; // ramp ends at the first unhealthy stage for this config
      }
      stableConcurrency[name] = stable;
      console.log(`  → Config ${name} stable concurrency ≈ ${stable}`);
    }

    // Optional headed anchor (Config D at F=P) to tie the RAM ceiling to AWKIT's real headed default.
    if (HEADED_ANCHOR) {
      console.log(`\n══════ Headed anchor: Config D at F=${P} (headed) ══════`);
      const spec: ConfigSpec = { name: "D-headed", sharedPool: true, workloadWeights: true, maxBrowsersPerHost: P, maxActiveFlows: P };
      const { dirs, root } = await buildDirs();
      const engine = new ExecutionEngine();
      const result = await runStage(engine, wl, dirs, { config: spec, targetActive: P, holdMs: Math.min(HOLD_MS, 30000), headless: false, mix: DEFAULT_MIX });
      await cleanupRoot(root);
      results["D-headed"] = [compactStage(result, { stop: false })];
      console.log(`  headed active≈${result.sustainedActive?.median} chromium=${result.chromiumProcs?.median}proc/${result.chromiumRssMb?.median}MB peak=${result.chromiumPeakRssMb}MB cpuP95=${result.cpuPercent?.p95}%`);
      await writeFile(artifactPath, JSON.stringify({ machine: { machineId, ...caps }, recommendation: { R, ceiling, category: rec.categoryName, plannerStages }, sharedPoolBudgetP: P, holdMs: HOLD_MS, stages, mix: DEFAULT_MIX, results, stableConcurrency }, null, 2), "utf8");
    }
  } finally {
    wl.server.close();
  }

  console.log(`\n=== Stable concurrency (highest healthy sustained active) ===`);
  for (const name of CONFIG_NAMES) console.log(`  Config ${name}: ${stableConcurrency[name] ?? "—"}`);
  console.log(`\nArtifact: ${artifactPath}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
