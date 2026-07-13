// Verifies the pure mode→limits resolver (src/runner/concurrency/CapacityContracts.ts):
// sequential always = 1 active instance, manual/auto clamp to the absolute + administrator ceilings,
// auto prefers a benchmarked value and applies the pre-benchmark ceiling to unbenchmarked server-grade
// machines. Maps to plan §13 acceptance criteria (sequential/manual-safety/benchmark-relative).
//
// Pure — no Electron. Run: npx tsx scripts/verify-capacity-modes.mts
import {
  DEFAULT_UNBENCHMARKED_AUTO_CEILING,
  resolveEffectiveConcurrency
} from "../src/runner/concurrency/CapacityContracts";
import type { CapacityRecommendation } from "../src/runner/concurrency/CapacityPlanner";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

function rec(value: number, requiresBenchmark = false): CapacityRecommendation {
  return {
    detectedCapacity: value,
    conservativeRecommendedCapacity: value,
    memoryCapacityEstimate: value * 3,
    cpuCapacityEstimate: value,
    usableMemoryMb: 99999,
    usableCores: value,
    bindingConstraint: "cpu",
    categoryName: requiresBenchmark ? "highCapacity" : "medium",
    requiresBenchmark,
    workloadClass: "medium"
  };
}

async function main() {
  // 1. Sequential → exactly one active instance / one browser on any machine.
  {
    const e = resolveEffectiveConcurrency({ mode: "sequential", manualBrowsers: 8, manualActiveFlows: 16, absoluteSafetyMaximum: 64 });
    check("sequential → 1 browser / 1 active flow", e.maxBrowsers === 1 && e.maxActiveFlows === 1 && e.target === 1);
  }

  // 2. Manual passes through within bounds.
  {
    const e = resolveEffectiveConcurrency({ mode: "manual", manualBrowsers: 3, manualActiveFlows: 6, absoluteSafetyMaximum: 64 });
    check("manual within bounds passes through", e.maxBrowsers === 3 && e.maxActiveFlows === 6 && e.target === 6);
  }

  // 3. Manual is still clamped by the absolute safety ceiling (safety always on).
  {
    const e = resolveEffectiveConcurrency({ mode: "manual", manualBrowsers: 50, manualActiveFlows: 50, absoluteSafetyMaximum: 8 });
    check("manual clamped by absolute safety ceiling", e.maxBrowsers === 8 && e.maxActiveFlows === 8 && e.ceiling === 8);
  }

  // 4. Administrator maximum clamps every mode.
  {
    const e = resolveEffectiveConcurrency({ mode: "manual", manualBrowsers: 10, manualActiveFlows: 10, administratorMaximumConcurrency: 4, absoluteSafetyMaximum: 64 });
    check("administrator maximum clamps manual", e.target === 4 && e.ceiling === 4);
  }

  // 5. Auto uses the conservative recommendation.
  {
    const e = resolveEffectiveConcurrency({ mode: "auto", manualBrowsers: 2, manualActiveFlows: 4, recommendation: rec(5), absoluteSafetyMaximum: 64 });
    check("auto uses the conservative recommendation", e.target === 5 && e.maxBrowsers === 5 && e.maxActiveFlows === 5);
  }

  // 6. Auto prefers a benchmarked value when present.
  {
    const e = resolveEffectiveConcurrency({ mode: "auto", manualBrowsers: 2, manualActiveFlows: 4, recommendation: rec(5), benchmarkTestedCapacity: 11, absoluteSafetyMaximum: 64 });
    check("auto prefers benchmark-tested capacity", e.target === 11);
  }

  // 7. Auto applies the pre-benchmark ceiling to unbenchmarked server-grade machines.
  {
    const e = resolveEffectiveConcurrency({ mode: "auto", manualBrowsers: 2, manualActiveFlows: 4, recommendation: rec(40, true), absoluteSafetyMaximum: 64 });
    check("unbenchmarked server-grade auto is capped pre-benchmark", e.target === DEFAULT_UNBENCHMARKED_AUTO_CEILING, `target=${e.target} ceiling=${DEFAULT_UNBENCHMARKED_AUTO_CEILING}`);
  }

  // 8. A benchmarked server-grade machine is NOT held back by the pre-benchmark ceiling.
  {
    const e = resolveEffectiveConcurrency({ mode: "auto", manualBrowsers: 2, manualActiveFlows: 4, recommendation: rec(40, true), benchmarkTestedCapacity: 18, absoluteSafetyMaximum: 64 });
    check("benchmarked server-grade auto uses the measured value", e.target === 18);
  }

  // 9. Auto is clamped by the absolute safety ceiling.
  {
    const e = resolveEffectiveConcurrency({ mode: "auto", manualBrowsers: 2, manualActiveFlows: 4, recommendation: rec(40), absoluteSafetyMaximum: 12 });
    check("auto clamped by absolute safety ceiling", e.target === 12);
  }

  // 10. Every mode floors to >= 1 even with degenerate input.
  {
    const e = resolveEffectiveConcurrency({ mode: "auto", manualBrowsers: 0, manualActiveFlows: 0, recommendation: rec(0), absoluteSafetyMaximum: 64 });
    check("auto floors to at least 1", e.target === 1 && e.maxBrowsers >= 1);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nCapacity modes: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
