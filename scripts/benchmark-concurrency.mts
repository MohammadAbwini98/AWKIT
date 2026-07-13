/**
 * Machine-relative concurrency benchmark harness (Concurrency Capacity plan — Phase A10).
 *
 * HEAVY and OPT-IN — never runs automatically. It calibrates THIS machine's real sustainable capacity by
 * ramping concurrency through machine-relative stages (see BenchmarkPlanner), holding each stage under
 * real Chromium load against the offline mock-site, sampling host health, and stopping at the first stage
 * that trips a stop condition. The highest sustainable stage (minus a production margin) is written into
 * this machine's capacity profile plus a JSON artifact under the runtime root.
 *
 *   npm run benchmark:concurrency                 # full benchmark (heavy; clean-machine gate)
 *   AWKIT_BENCHMARK_PLAN_ONLY=1 npm run benchmark:concurrency   # print machine + planned stages, no launch
 *
 * Env knobs: AWKIT_RUNTIME_ROOT (where the profile/artifact are written; default ./.benchmark-runtime),
 * AWKIT_BENCHMARK_HOLD_MS (per-stage hold, default 8000), AWKIT_BENCHMARK_WORKLOAD (light|medium|heavy).
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { detectMachineCapabilities, loadOrCreateMachineId } from "@src/runner/concurrency/MachineCapabilityDetector";
import { planCapacity, DEFAULT_CAPACITY_TUNING, type WorkloadClass } from "@src/runner/concurrency/CapacityPlanner";
import { resolveEffectiveConcurrency } from "@src/runner/concurrency/CapacityContracts";
import { ResourceSampler } from "@src/runner/concurrency/ResourceSampler";
import { MachineCapacityProfileStore, reconcileMachineProfile } from "@src/runner/concurrency/MachineCapacityProfileStore";
import {
  generateBenchmarkStages,
  evaluateStopConditions,
  summarizeBenchmark,
  applyBenchmarkToProfile,
  DEFAULT_BENCHMARK_THRESHOLDS,
  type BenchmarkStageOutcome,
  type BenchmarkHealthSample
} from "@src/runner/concurrency/BenchmarkPlanner";

const PORT = 4408;
const BASE = `http://127.0.0.1:${PORT}`;
const HOLD_MS = Number.parseInt(process.env.AWKIT_BENCHMARK_HOLD_MS ?? "8000", 10);
const WORKLOAD = (process.env.AWKIT_BENCHMARK_WORKLOAD ?? "medium") as WorkloadClass;
const PLAN_ONLY = ["1", "true", "yes"].includes((process.env.AWKIT_BENCHMARK_PLAN_ONLY ?? "").toLowerCase()) || process.argv.includes("--plan");

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
const avg = (values: number[]): number | undefined => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined);

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Mock site did not start");
}

/** Drive one browser instance in a navigation loop for the hold window; returns whether it errored. */
async function driveInstance(deadline: number): Promise<boolean> {
  let errored = false;
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      while (Date.now() < deadline) {
        await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
        await page.fill("#username", "tester").catch(() => (errored = true));
        await page.goto(`${BASE}/form`, { waitUntil: "domcontentloaded" });
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch {
    errored = true;
  }
  return errored;
}

async function runStage(stage: number, sampler: ResourceSampler): Promise<BenchmarkStageOutcome> {
  const cpuSamples: number[] = [];
  const memSamples: number[] = [];
  const eldSamples: number[] = [];
  const deadline = Date.now() + HOLD_MS;
  const poll = setInterval(() => {
    const s = sampler.latest;
    if (s?.cpuPercent !== undefined) cpuSamples.push(s.cpuPercent);
    if (s?.systemMemoryPercent !== undefined) memSamples.push(s.systemMemoryPercent);
    if (s?.eventLoopDelayMs !== undefined) eldSamples.push(s.eventLoopDelayMs);
  }, 500);

  const results = await Promise.all(Array.from({ length: stage }, () => driveInstance(deadline)));
  clearInterval(poll);

  const errorCount = results.filter(Boolean).length;
  const sample: BenchmarkHealthSample = {
    avgCpuPercent: avg(cpuSamples),
    p95CpuPercent: percentile(cpuSamples, 95),
    systemMemoryPercent: percentile(memSamples, 95),
    eventLoopDelayMs: percentile(eldSamples, 95),
    errorRate: results.length ? errorCount / results.length : 0,
    browserCrashes: 0,
    rendererCrashes: 0
  };
  const evaluation = evaluateStopConditions(sample, DEFAULT_BENCHMARK_THRESHOLDS);
  return { stage, sustained: !evaluation.stop, sample, stopReasons: evaluation.reasons };
}

async function main() {
  const runtimeRoot = process.env.AWKIT_RUNTIME_ROOT ?? join(process.cwd(), ".benchmark-runtime");
  await mkdir(runtimeRoot, { recursive: true });
  const machineId = await loadOrCreateMachineId(runtimeRoot);
  const capabilities = detectMachineCapabilities(machineId);
  const recommendation = planCapacity({ capabilities, workloadClass: WORKLOAD, tuning: DEFAULT_CAPACITY_TUNING });
  const effective = resolveEffectiveConcurrency({
    mode: "auto",
    manualBrowsers: 1,
    manualActiveFlows: 1,
    recommendation,
    administratorMaximumConcurrency: DEFAULT_CAPACITY_TUNING.administratorMaximumConcurrency,
    absoluteSafetyMaximum: DEFAULT_CAPACITY_TUNING.absoluteSafetyMaximum
  });
  const R = recommendation.conservativeRecommendedCapacity;
  const ceiling = effective.ceiling;
  const stages = generateBenchmarkStages(R, ceiling);

  console.log(`Machine ${machineId}`);
  console.log(`  CPUs: ${capabilities.logicalCpuCount}  RAM: ${capabilities.totalMemoryMb}MB (avail ${capabilities.availableMemoryMb}MB)  category: ${recommendation.categoryName}`);
  console.log(`  workload=${WORKLOAD}  R(recommendation)=${R}  ceiling=${ceiling}  requiresBenchmark=${recommendation.requiresBenchmark}`);
  console.log(`  planned stages: ${stages.join(" → ")}`);

  if (PLAN_ONLY) {
    console.log("\n[plan-only] no browsers launched. Remove AWKIT_BENCHMARK_PLAN_ONLY / --plan to run the full benchmark.");
    process.exit(0);
  }

  const server = spawn(process.execPath, ["mock-site/server.mjs"], { env: { ...process.env, MOCK_SITE_PORT: String(PORT) }, stdio: "ignore" });
  const sampler = new ResourceSampler(1000);
  sampler.start();
  const startedAt = new Date().toISOString();
  const benchmarkId = `bench-${Date.now()}`;
  const outcomes: BenchmarkStageOutcome[] = [];
  try {
    await waitForServer();
    for (const stage of stages) {
      console.log(`\nStage ${stage} — holding ${HOLD_MS}ms under ${stage} concurrent instance(s)…`);
      const outcome = await runStage(stage, sampler);
      outcomes.push(outcome);
      const s = outcome.sample;
      console.log(`  cpuAvg=${fmt(s.avgCpuPercent)}% cpuP95=${fmt(s.p95CpuPercent)}% mem=${fmt(s.systemMemoryPercent)}% eld=${fmt(s.eventLoopDelayMs)}ms err=${fmt((s.errorRate ?? 0) * 100)}% → ${outcome.sustained ? "SUSTAINED" : `STOP (${outcome.stopReasons?.join("; ")})`}`);
      if (!outcome.sustained) break;
    }
  } finally {
    sampler.stop();
    server.kill();
  }

  const result = summarizeBenchmark({
    benchmarkId,
    machineId,
    startedAt,
    recommendationR: R,
    ceiling,
    stages,
    outcomes,
    productionApprovalMargin: DEFAULT_CAPACITY_TUNING.productionApprovalMargin
  });

  const artifactDir = join(runtimeRoot, "runtime", "benchmarks");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, `${benchmarkId}.json`), JSON.stringify(result, null, 2), "utf8");

  const store = new MachineCapacityProfileStore(runtimeRoot);
  const existing = await store.load(machineId);
  const reconciled = reconcileMachineProfile({ existing, capabilities, recommendation, tuning: DEFAULT_CAPACITY_TUNING });
  await store.save(applyBenchmarkToProfile(reconciled.profile, result));

  console.log(`\nBenchmark complete: highestSustainable=${result.highestSustainableStage} benchmarkTested=${result.benchmarkTestedCapacity} productionApproved=${result.productionApprovedCapacity}`);
  console.log(`  artifact: ${join(artifactDir, `${benchmarkId}.json`)}`);
  console.log(`  profile updated for machine ${machineId}`);
  console.log("\nNote: a TRUE production cap requires a clean-machine run (no competing load). Treat this as machine-relative calibration.");
  process.exit(0);
}

const fmt = (v: number | undefined): string => (v === undefined ? "—" : String(Math.round(v * 10) / 10));

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
