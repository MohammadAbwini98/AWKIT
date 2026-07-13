// Verifies the capacity planner (src/runner/concurrency/CapacityPlanner.ts) is hardware-agnostic and
// safe: recommendations scale with detected specs, high RAM alone never yields high concurrency,
// admin/absolute ceilings clamp, live background load lowers the number, workload classes are
// monotonic, and tiny/zero machines floor to 1. Maps to plan §13 acceptance criteria.
//
// Pure — no Electron. Run: npx tsx scripts/verify-capacity-planner.mts
import {
  DEFAULT_CAPACITY_TUNING,
  classifyBootstrapCategory,
  planCapacity,
  planWorkloadCapacities,
  resolveReserveMb,
  type CapacityTuning,
  type WorkloadClass
} from "../src/runner/concurrency/CapacityPlanner";
import type { MachineCapabilities } from "../src/runner/concurrency/MachineCapabilityDetector";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

/** Labelled example machine (fixtures only — never a production default). */
function caps(cores: number, totalGb: number, freeGb: number, extra: Partial<MachineCapabilities> = {}): MachineCapabilities {
  return {
    machineId: "fixture",
    platform: "win32",
    architecture: "x64",
    logicalCpuCount: cores,
    totalMemoryMb: totalGb * 1024,
    availableMemoryMb: freeGb * 1024,
    operatingSystem: "Windows_NT",
    detectedAt: new Date().toISOString(),
    ...extra
  };
}

function plan(machine: MachineCapabilities, workloadClass: WorkloadClass, opts: Partial<Parameters<typeof planCapacity>[0]> = {}) {
  return planCapacity({ capabilities: machine, workloadClass, ...opts });
}

async function main() {
  // 1. resolveReserveMb precedence: more protective (larger) reserve wins when both configured.
  check("reserve: both set → larger wins (abs>pct)", resolveReserveMb(5000, 10, 40000) === 5000);
  check("reserve: both set → larger wins (pct>abs)", resolveReserveMb(1000, 10, 40000) === 4000);
  check("reserve: percent only", resolveReserveMb(undefined, 10, 40000) === 4000);
  check("reserve: absolute only", resolveReserveMb(1500, undefined, 40000) === 1500);
  check("reserve: neither set → 0", resolveReserveMb(undefined, undefined, 40000) === 0);

  // 2. Every example shape yields a valid recommendation within [1, absoluteSafetyMaximum].
  const fixtures: Array<{ label: string; m: MachineCapabilities }> = [
    { label: "8GB/4c", m: caps(4, 8, 6) },
    { label: "16GB/8c", m: caps(8, 16, 12) },
    { label: "32GB/12c", m: caps(12, 32, 24) },
    { label: "48GB/8c (guide example)", m: caps(8, 48, 30) },
    { label: "64GB/16c", m: caps(16, 64, 50) },
    { label: "128GB/32c", m: caps(32, 128, 110) }
  ];
  for (const f of fixtures) {
    const r = plan(f.m, "medium");
    const inBounds = r.conservativeRecommendedCapacity >= 1 && r.conservativeRecommendedCapacity <= DEFAULT_CAPACITY_TUNING.absoluteSafetyMaximum;
    check(`${f.label}: recommendation in [1, ceiling]`, inBounds, `rec=${r.conservativeRecommendedCapacity} binding=${r.bindingConstraint} cat=${r.categoryName}`);
  }

  // 3. Larger machines recommend >= smaller machines (same workload).
  {
    const small = plan(caps(4, 8, 6), "medium").conservativeRecommendedCapacity;
    const mid = plan(caps(12, 32, 24), "medium").conservativeRecommendedCapacity;
    const big = plan(caps(32, 128, 110), "medium").conservativeRecommendedCapacity;
    check("recommendation is monotonic across machine size", small <= mid && mid <= big, `small=${small} mid=${mid} big=${big}`);
  }

  // 4. High RAM + low CPU is CPU-bound — RAM does not inflate the recommendation.
  {
    const r = plan(caps(4, 128, 120), "medium");
    check("high-RAM/low-CPU is CPU-bound", r.bindingConstraint === "cpu", `binding=${r.bindingConstraint}`);
    check("high-RAM/low-CPU rec << memory estimate (RAM not inflating)", r.conservativeRecommendedCapacity < r.memoryCapacityEstimate / 4, `rec=${r.conservativeRecommendedCapacity} memEst=${r.memoryCapacityEstimate}`);
    check("high-RAM/low-CPU rec <= cpu estimate", r.conservativeRecommendedCapacity <= r.cpuCapacityEstimate, `rec=${r.conservativeRecommendedCapacity} cpuEst=${r.cpuCapacityEstimate}`);
  }

  // 5. Low-resource machine gets a conservative recommendation and a "small" category.
  {
    const r = plan(caps(2, 4, 3), "medium");
    check("low-resource machine → small category", r.categoryName === "small", `cat=${r.categoryName}`);
    check("low-resource machine → very low recommendation", r.conservativeRecommendedCapacity <= 2, `rec=${r.conservativeRecommendedCapacity}`);
  }

  // 6. Administrator maximum clamps and reports the binding constraint.
  {
    const tuning: CapacityTuning = { ...DEFAULT_CAPACITY_TUNING, administratorMaximumConcurrency: 2 };
    const r = plan(caps(32, 128, 110), "medium", { tuning });
    check("admin max clamps the recommendation", r.conservativeRecommendedCapacity === 2, `rec=${r.conservativeRecommendedCapacity}`);
    check("admin max is reported as the binding constraint", r.bindingConstraint === "adminMax", `binding=${r.bindingConstraint}`);
  }

  // 7. Absolute safety ceiling clamps and reports the binding constraint.
  {
    const tuning: CapacityTuning = { ...DEFAULT_CAPACITY_TUNING, absoluteSafetyMaximum: 3 };
    const r = plan(caps(32, 128, 110), "medium", { tuning });
    check("absolute safety ceiling clamps the recommendation", r.conservativeRecommendedCapacity === 3, `rec=${r.conservativeRecommendedCapacity}`);
    check("absolute ceiling is reported as the binding constraint", r.bindingConstraint === "safetyCeiling", `binding=${r.bindingConstraint}`);
  }

  // 8. Live background CPU load lowers the current recommendation.
  {
    const m = caps(16, 64, 50);
    const idle = plan(m, "medium", { backgroundCpuLoadFraction: 0 }).conservativeRecommendedCapacity;
    const busy = plan(m, "medium", { backgroundCpuLoadFraction: 0.5 }).conservativeRecommendedCapacity;
    check("background CPU load lowers the recommendation", busy < idle, `idle=${idle} busy=${busy}`);
  }

  // 9. Workload monotonicity: heavy <= medium <= light on the same machine.
  {
    const all = planWorkloadCapacities({ capabilities: caps(12, 32, 24) });
    check("workload monotonicity heavy <= medium <= light", all.heavy.conservativeRecommendedCapacity <= all.medium.conservativeRecommendedCapacity && all.medium.conservativeRecommendedCapacity <= all.light.conservativeRecommendedCapacity, `light=${all.light.conservativeRecommendedCapacity} medium=${all.medium.conservativeRecommendedCapacity} heavy=${all.heavy.conservativeRecommendedCapacity}`);
  }

  // 10. "custom" workload is treated as the most conservative (heavy) seed.
  {
    const m = caps(12, 32, 24);
    const custom = plan(m, "custom").conservativeRecommendedCapacity;
    const heavy = plan(m, "heavy").conservativeRecommendedCapacity;
    check("custom workload uses the heavy (most conservative) seed", custom === heavy, `custom=${custom} heavy=${heavy}`);
  }

  // 11. Measured per-instance overrides replace the seed envelopes.
  {
    const m = caps(16, 64, 50);
    const seeded = plan(m, "medium").conservativeRecommendedCapacity;
    const cheaper = plan(m, "medium", { measuredCpuCoresPerInstance: 0.25, measuredMemoryPerInstanceMb: 300 }).conservativeRecommendedCapacity;
    check("measured (cheaper) per-instance cost raises capacity", cheaper > seeded, `seeded=${seeded} cheaper=${cheaper}`);
  }

  // 12. Zero / degenerate specs floor to exactly 1 (never 0 or NaN).
  {
    const r = plan(caps(1, 0, 0), "medium");
    check("degenerate machine floors to 1", r.conservativeRecommendedCapacity === 1 && Number.isFinite(r.conservativeRecommendedCapacity), `rec=${r.conservativeRecommendedCapacity}`);
  }

  // 13. High-capacity (server-grade) machines are flagged as requiring benchmark validation.
  {
    const r = plan(caps(32, 128, 110), "medium");
    check("server-grade machine requires benchmark before high concurrency", r.requiresBenchmark === true && r.categoryName === "highCapacity", `cat=${r.categoryName} requiresBenchmark=${r.requiresBenchmark}`);
  }

  // 14. The 48GB/8c guide example is classified as an ordinary Medium machine (not a special target).
  {
    const r = plan(caps(8, 48, 30), "medium");
    check("48GB/8c example → medium category, CPU-bound, sane range", r.categoryName === "medium" && r.bindingConstraint === "cpu" && r.conservativeRecommendedCapacity >= 4 && r.conservativeRecommendedCapacity <= 12, `cat=${r.categoryName} binding=${r.bindingConstraint} rec=${r.conservativeRecommendedCapacity}`);
  }

  // 15. classifyBootstrapCategory falls back to a safe category when no rule matches (defensive).
  {
    const cat = classifyBootstrapCategory(8, 16000, []);
    check("empty category rules → safe custom fallback", cat.name === "custom" && cat.requiresBenchmarkBeforeHighConcurrency === true);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nCapacity planner: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
