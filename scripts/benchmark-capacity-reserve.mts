/**
 * Phase 7 (re-evaluation) — replay the CapacityPlanner memory reserve across representative machine sizes
 * and current-memory-pressure states, comparing three reserve models:
 *
 *   A. CURRENT formula (real planCapacity): available − OS 20 %(of total) − AWKIT 1024 MB − safety 10 %(of total)
 *   B. AVAILABLE safety-floor: available − AWKIT 1024 MB − max(1024 MB, 10 % of AVAILABLE)
 *      (drops the %-of-TOTAL OS reserve because `available` already nets out OS + other-app usage)
 *   C. MEASURED baseline/growth + machine-relative safety: available − (measuredBaseline + growthReserve)
 *      − max(1024 MB, 8 % of AVAILABLE)
 *
 * The question: does subtracting a %-of-TOTAL "OS reserve" from ALREADY-current available memory make model A
 * unnecessarily double-conservative (under-admitting) on larger machines? Pure planner replay — no browsers.
 *
 *   npm run benchmark:capacity-reserve
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { planCapacity, DEFAULT_CAPACITY_TUNING } from "../src/runner/concurrency/CapacityPlanner";
import type { MachineCapabilities } from "../src/runner/concurrency/MachineCapabilityDetector";

const GB = 1024;
const MACHINE_GB = [4, 8, 16, 32, 64, 128];
// Current-pressure states as the fraction of TOTAL RAM that is currently AVAILABLE.
const PRESSURE = { low: 0.75, medium: 0.45, high: 0.18 };
// AWKIT absolute baseline used by the shipped model: engine core RSS in-soak was ~230–320 MB; a real
// packaged run adds Electron main + renderer + GPU. 1024 MB is the measured-plus-headroom app baseline.
const MEASURED_BASELINE_MB = 1024;
const MEM_PER_INSTANCE_MB = DEFAULT_CAPACITY_TUNING.conservativeMemoryPerInstanceMb.medium; // 700 (seed, medium)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function capabilities(totalGb: number, availableMb: number): MachineCapabilities {
  return {
    logicalCpuCount: 12, // hold CPU constant so the memory axis is isolated (CPU is not the binding study here)
    totalMemoryMb: totalGb * GB,
    availableMemoryMb: availableMb,
    cpuModel: "replay", cpuBaseSpeedMhz: 2200, architecture: "x64",
    platform: "win32", operatingSystem: "Windows_NT", operatingSystemVersion: "replay",
    hostname: "replay", machineId: "replay", detectedAt: new Date().toISOString()
  } as unknown as MachineCapabilities;
}

/** A — the real shipped formula, via planCapacity (memory branch only). */
function modelA(totalMb: number, availableMb: number) {
  const os = 0.20 * totalMb;
  const awkit = 1024;
  const safety = 0.10 * totalMb;
  const usable = Math.max(0, availableMb - os - awkit - safety);
  return { usable, reserves: os + awkit + safety, parts: { os, awkit, safety } };
}

/** B — reserve off AVAILABLE with a safety floor; no redundant %-of-total OS reserve. */
function modelB(_totalMb: number, availableMb: number) {
  const awkit = 1024;
  const safety = Math.max(1024, 0.10 * availableMb);
  const usable = Math.max(0, availableMb - awkit - safety);
  return { usable, reserves: awkit + safety, parts: { awkit, safety } };
}

/**
 * C — the NOW-SHIPPED model (planCapacity): OS reserve is a CEILING on planning memory (not re-subtracted
 * from available); absolute AWKIT baseline + bounded machine-relative growth; safety cushion as a % of
 * planning memory with an absolute floor. Mirrors DEFAULT_CAPACITY_TUNING so it can be cross-checked below.
 */
function modelC(totalMb: number, availableMb: number) {
  const osReserve = 0.20 * totalMb;
  const planning = Math.min(availableMb, Math.max(0, totalMb - osReserve));
  const baseline = 1024;
  const growth = clamp(0.05 * totalMb, 512, 4096);
  const safety = Math.max(1024, 0.10 * planning);
  const usable = Math.max(0, planning - baseline - growth - safety);
  return { usable, reserves: baseline + growth + safety, parts: { baseline, growth, safety, planning } };
}

const cap = (usable: number) => Math.max(1, Math.floor(usable / MEM_PER_INSTANCE_MB));

const rows: Record<string, unknown>[] = [];
console.log(`Capacity reserve replay — medium seed ${MEM_PER_INSTANCE_MB} MB/instance, CPU held at 12 cores.`);
console.log(`Pressure = fraction of TOTAL that is currently AVAILABLE (low=0.75, medium=0.45, high=0.18).\n`);
console.log(`machine  pressure  avail   | A usable  A cap | B usable  B cap | C usable  C cap | A→B cap  A→C cap`);
console.log(`-------  --------  ------- | -------- ------ | -------- ------ | -------- ------ | -------  -------`);

for (const gb of MACHINE_GB) {
  const totalMb = gb * GB;
  for (const [name, frac] of Object.entries(PRESSURE)) {
    const availableMb = Math.round(frac * totalMb);
    const a = modelA(totalMb, availableMb);
    const b = modelB(totalMb, availableMb);
    const c = modelC(totalMb, availableMb);
    // Cross-check model C against the real (now-shipped) planner memory branch: usable memory must match.
    const planned = planCapacity({ capabilities: capabilities(gb, availableMb), workloadClass: "medium" });
    const aCap = cap(a.usable), bCap = cap(b.usable), cCap = cap(c.usable);
    rows.push({
      machineGb: gb, pressure: name, availableMb,
      A: { usableMb: Math.round(a.usable), cap: aCap },
      B: { usableMb: Math.round(b.usable), cap: bCap },
      C: { usableMb: Math.round(c.usable), cap: cCap, plannerUsableMb: planned.usableMemoryMb, plannerMemCap: planned.memoryCapacityEstimate },
      capDeltaAtoB: bCap - aCap, capDeltaAtoC: cCap - aCap
    });
    const f = (n: number) => String(n).padStart(7);
    const f6 = (n: number) => String(n).padStart(6);
    console.log(
      `${String(gb + "GB").padStart(6)}  ${name.padEnd(8)}  ${f(availableMb)} | ${f(Math.round(a.usable))} ${f6(aCap)} | ${f(Math.round(b.usable))} ${f6(bCap)} | ${f(Math.round(c.usable))} ${f6(cCap)} | ${f6(bCap - aCap)}  ${f6(cCap - aCap)}`
    );
  }
}

// Sanity: model C must equal the real (shipped) planner's usable memory (confirms the study mirrors code).
const mismatches = rows.filter((r) => Math.abs((r.C as { usableMb: number }).usableMb - (r.C as { plannerUsableMb: number }).plannerUsableMb) > 1);
console.log(`\nModel-C vs real planCapacity usable-memory mismatch rows: ${mismatches.length} (expect 0).`);
console.log(`(Model A = the PREVIOUS shipped formula, shown for before/after comparison.)`);

const artifactDir = join(process.cwd(), "reports", "browser-performance");
await mkdir(artifactDir, { recursive: true });
await writeFile(join(artifactDir, "capacity-reserve.json"), JSON.stringify({
  memPerInstanceMb: MEM_PER_INSTANCE_MB, measuredBaselineMb: MEASURED_BASELINE_MB, pressure: PRESSURE, rows
}, null, 2), "utf8");
console.log(`Artifact: ${join(artifactDir, "capacity-reserve.json")}`);
process.exit(mismatches.length === 0 ? 0 : 1);
