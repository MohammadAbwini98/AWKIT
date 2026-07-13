// Verifies the machine-relative benchmark planner (src/runner/concurrency/BenchmarkPlanner.ts): stage
// generation scales with R and the ceiling and normalizes to distinct integers ≥ 1; stop conditions trip
// on each threshold and ignore missing telemetry; production capacity keeps a margin below the highest
// sustainable stage; the benchmark summary takes the contiguous sustainable run and folds into a profile.
// Pure — no browser. Run: npx tsx scripts/verify-benchmark-planner.mts
import {
  generateBenchmarkStages,
  normalizeStages,
  evaluateStopConditions,
  productionApprovedCapacity,
  summarizeBenchmark,
  applyBenchmarkToProfile,
  DEFAULT_BENCHMARK_THRESHOLDS,
  DEFAULT_BENCHMARK_STAGE_CONFIG,
  type BenchmarkStageOutcome,
  type BenchmarkHealthSample
} from "../src/runner/concurrency/BenchmarkPlanner";
import type { MachineCapacityProfile } from "../src/runner/concurrency/MachineCapacityProfileStore";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}
const distinctAscending = (a: number[]) => a.every((v, i) => i === 0 || v > a[i - 1]);
const healthy: BenchmarkHealthSample = { avgCpuPercent: 30, p95CpuPercent: 50, freeMemoryMb: 8000, systemMemoryPercent: 40, eventLoopDelayMs: 20, errorRate: 0, browserCrashes: 0, rendererCrashes: 0 };

function main() {
  // 1. Stages scale with R; distinct ascending integers within [1, ceiling].
  {
    const s = generateBenchmarkStages(8, 32);
    check("stages are distinct ascending integers", distinctAscending(s) && s.every((n) => Number.isInteger(n)), s.join(","));
    check("stages start at/around 0.25R and reach beyond R", s[0] <= 2 && Math.max(...s) > 8, s.join(","));
    check("no stage exceeds the ceiling", Math.max(...s) <= 32);
    check("first ramp uses 0.25/0.5/0.75/1.0 × R", s.slice(0, 4).join(",") === "2,4,6,8", s.join(","));
    check("overshoot 1.25×R present (10)", s.includes(10));
  }

  // 2. Small machine: R and ceiling both small → a short 1→ceiling ramp, capped at the ceiling.
  {
    const s = generateBenchmarkStages(4, 4);
    check("small machine ramps 1→2→3→4", s.join(",") === "1,2,3,4", s.join(","));
    check("small machine never exceeds its ceiling", Math.max(...s) === 4);
  }

  // 3. Degenerate R=1 dedupes the ramp and still grows toward the ceiling.
  {
    const s = generateBenchmarkStages(1, 6);
    check("R=1 dedupes to distinct integers", distinctAscending(s) && s[0] === 1, s.join(","));
    check("R=1 grows up to the ceiling", Math.max(...s) === 6, s.join(","));
  }

  // 4. Ceiling clamps a large R; maxStages bounds the count.
  {
    const s = generateBenchmarkStages(100, 5);
    check("ceiling clamps every stage", Math.max(...s) <= 5 && s.every((n) => n >= 1), s.join(","));
    const big = generateBenchmarkStages(50, 500);
    check("stage count is bounded by maxStages", big.length <= DEFAULT_BENCHMARK_STAGE_CONFIG.maxStages, `count=${big.length}`);
  }

  // 5. normalizeStages: clamps, dedupes, sorts, drops non-finite.
  {
    const n = normalizeStages([3, 3, 0, -2, 9, Number.NaN, 5], 6, 12);
    check("normalizeStages clamps + dedupes + sorts", n.join(",") === "1,3,5,6", n.join(","));
  }

  // 6. Stop conditions: healthy sample does not stop; each threshold trips independently.
  {
    check("healthy sample → no stop", evaluateStopConditions(healthy).stop === false);
    check("high sustained CPU stops", evaluateStopConditions({ ...healthy, avgCpuPercent: 95 }).stop === true);
    check("high P95 CPU stops", evaluateStopConditions({ ...healthy, p95CpuPercent: 99 }).stop === true);
    check("low free memory stops", evaluateStopConditions({ ...healthy, freeMemoryMb: 100 }).stop === true);
    check("high system memory stops", evaluateStopConditions({ ...healthy, systemMemoryPercent: 95 }).stop === true);
    check("high event-loop delay stops", evaluateStopConditions({ ...healthy, eventLoopDelayMs: 900 }).stop === true);
    check("high error rate stops", evaluateStopConditions({ ...healthy, errorRate: 0.2 }).stop === true);
    check("browser crash stops", evaluateStopConditions({ ...healthy, browserCrashes: 3 }).stop === true);
    check("latency regression stops", evaluateStopConditions({ ...healthy, latencyP95Ms: 900, baselineLatencyP95Ms: 400 }).stop === true);
    check("latency within factor does not stop", evaluateStopConditions({ ...healthy, latencyP95Ms: 500, baselineLatencyP95Ms: 400 }).stop === false);
  }

  // 7. Missing telemetry never trips a stop.
  {
    check("empty sample → no stop (partial telemetry is fine)", evaluateStopConditions({}).stop === false);
    check("only errorRate present → evaluates just that", evaluateStopConditions({ errorRate: 0.5 }).stop === true && evaluateStopConditions({ errorRate: 0 }).stop === false);
  }

  // 8. Production capacity keeps a margin BELOW the highest sustainable stage.
  {
    check("production margin 0.75 of 8 → 6", productionApprovedCapacity(8, 0.75) === 6);
    check("production never below 1", productionApprovedCapacity(1, 0.75) === 1);
    check("invalid margin falls back to no reduction", productionApprovedCapacity(4, 0) === 4);
  }

  // 9. summarizeBenchmark takes the CONTIGUOUS sustainable run (first failure ends the ramp).
  {
    const outcomes: BenchmarkStageOutcome[] = [
      { stage: 2, sustained: true, sample: healthy, measuredMemoryPerInstanceMb: 300, measuredCpuCoresPerInstance: 0.4 },
      { stage: 4, sustained: true, sample: healthy, measuredMemoryPerInstanceMb: 320, measuredCpuCoresPerInstance: 0.45 },
      { stage: 6, sustained: false, sample: { ...healthy, avgCpuPercent: 95 } },
      { stage: 8, sustained: true, sample: healthy } // a later lucky pass must NOT inflate the result
    ];
    const r = summarizeBenchmark({ benchmarkId: "b1", machineId: "m1", startedAt: "t0", recommendationR: 8, ceiling: 16, stages: [2, 4, 6, 8], outcomes, productionApprovalMargin: 0.75 });
    check("highest sustainable is the contiguous top (4, not 8)", r.highestSustainableStage === 4, `got ${r.highestSustainableStage}`);
    check("benchmarkTested = highest sustainable", r.benchmarkTestedCapacity === 4);
    check("productionApproved is below tested (floor 4×0.75=3)", r.productionApprovedCapacity === 3);
    check("per-instance estimates come from the calibration stage", r.estimatedMemoryPerInstanceMb === 320 && r.estimatedCpuCostPerInstance === 0.45);
  }

  // 10. applyBenchmarkToProfile adopts the measured values and clears recalibration.
  {
    const profile: MachineCapacityProfile = {
      machineId: "m1",
      capabilitiesSnapshot: {} as any,
      fingerprint: "fp",
      requiresRecalibration: true,
      recommendedCapacity: 4,
      configuredCapacity: 4,
      absoluteSafetyCeiling: 64,
      capacitySafetyFactor: 0.75,
      updatedAt: "t0"
    };
    const r = summarizeBenchmark({ benchmarkId: "b2", machineId: "m1", startedAt: "t0", recommendationR: 4, ceiling: 16, stages: [4], outcomes: [{ stage: 4, sustained: true, sample: healthy, measuredMemoryPerInstanceMb: 500 }], productionApprovalMargin: 0.75 });
    const updated = applyBenchmarkToProfile(profile, r);
    check("profile adopts benchmarkTestedCapacity", updated.benchmarkTestedCapacity === 4);
    check("profile records productionApprovedCapacity", updated.productionApprovedCapacity === 3);
    check("profile clears requiresRecalibration", updated.requiresRecalibration === false);
    check("profile records the benchmark id + estimate", updated.lastBenchmarkId === "b2" && updated.estimatedMemoryPerInstanceMb === 500);
    check("profile preserves configuredCapacity", updated.configuredCapacity === 4);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nBenchmark planner: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
