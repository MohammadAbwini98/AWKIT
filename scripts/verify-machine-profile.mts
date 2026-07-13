// Verifies per-machine capacity profiles (src/runner/concurrency/MachineCapacityProfileStore.ts):
// profiles round-trip atomically, hardware change flags recalibration and drops stale benchmark values
// while preserving the administrator/manual configured capacity, same-hardware refresh keeps measured
// calibration, and two machineIds stay isolated. Maps to plan §13 acceptance criteria.
//
// Pure — no Electron. Run: npx tsx scripts/verify-machine-profile.mts
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CAPACITY_TUNING, planCapacity } from "../src/runner/concurrency/CapacityPlanner";
import { detectMachineCapabilities, type OsProbe } from "../src/runner/concurrency/MachineCapabilityDetector";
import {
  MachineCapacityProfileStore,
  reconcileMachineProfile,
  type MachineCapacityProfile
} from "../src/runner/concurrency/MachineCapacityProfileStore";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const GB = 1024 * 1024 * 1024;
function probe(cores: number, totalGb: number, freeGb: number, platform = "win32", type = "Windows_NT"): OsProbe {
  return {
    platform: () => platform,
    arch: () => "x64",
    type: () => type,
    release: () => "10.0.19045",
    hostname: () => "host",
    totalmem: () => totalGb * GB,
    freemem: () => freeGb * GB,
    cpus: () => Array.from({ length: cores }, () => ({ model: "CPU", speed: 2600 }))
  };
}

function recommend(caps: ReturnType<typeof detectMachineCapabilities>) {
  return planCapacity({ capabilities: caps, workloadClass: "medium", tuning: DEFAULT_CAPACITY_TUNING });
}

async function main() {
  // 1. New machine → fresh conservative profile; round-trips through the store atomically.
  {
    const dir = await mkdtemp(join(tmpdir(), "awtkit-mcp-1-"));
    const store = new MachineCapacityProfileStore(dir);
    const caps = detectMachineCapabilities("machine-A", { probe: probe(8, 32, 24) });
    const { profile } = reconcileMachineProfile({ existing: null, capabilities: caps, recommendation: recommend(caps), tuning: DEFAULT_CAPACITY_TUNING });
    await store.save(profile);
    const loaded = await store.load("machine-A");
    check("new profile persists and reloads identically", !!loaded && loaded.machineId === "machine-A" && loaded.recommendedCapacity === profile.recommendedCapacity, `rec=${loaded?.recommendedCapacity}`);
    check("new profile seeds configuredCapacity from the recommendation", loaded?.configuredCapacity === profile.recommendedCapacity);
    const folder = join(dir, "runtime", "machine-profiles");
    const leftoverTmp = (await readdir(folder)).filter((f) => f.endsWith(".tmp"));
    check("no leftover .tmp files after atomic save", leftoverTmp.length === 0, `tmp=${leftoverTmp.length}`);
    await rm(dir, { recursive: true, force: true });
  }

  // 2. Same hardware → refresh keeps measured benchmark calibration and the configured (manual) value.
  {
    const caps = detectMachineCapabilities("machine-B", { probe: probe(8, 32, 24) });
    const base = reconcileMachineProfile({ existing: null, capabilities: caps, recommendation: recommend(caps), tuning: DEFAULT_CAPACITY_TUNING }).profile;
    // Simulate an administrator + a completed benchmark.
    const calibrated: MachineCapacityProfile = {
      ...base,
      configuredCapacity: 3,
      benchmarkTestedCapacity: 10,
      productionApprovedCapacity: 7,
      estimatedMemoryPerInstanceMb: 640,
      estimatedCpuCostPerInstance: 0.45,
      lastBenchmarkId: "bench-1",
      lastCalibratedAt: new Date().toISOString(),
      requiresRecalibration: false
    };
    const sameCaps = detectMachineCapabilities("machine-B", { probe: probe(8, 32, 12) }); // only free RAM drifted
    const { profile, recalibrationReasons } = reconcileMachineProfile({ existing: calibrated, capabilities: sameCaps, recommendation: recommend(sameCaps), tuning: DEFAULT_CAPACITY_TUNING });
    check("same hardware → no recalibration", recalibrationReasons.length === 0 && profile.requiresRecalibration === false);
    check("same hardware → keeps benchmark-tested capacity", profile.benchmarkTestedCapacity === 10 && profile.productionApprovedCapacity === 7);
    check("same hardware → keeps measured per-instance estimates", profile.estimatedMemoryPerInstanceMb === 640 && profile.estimatedCpuCostPerInstance === 0.45);
    check("same hardware → keeps administrator configured value", profile.configuredCapacity === 3);
  }

  // 3. Changed hardware → recalibration flagged, benchmark values dropped, configured value preserved.
  {
    const caps = detectMachineCapabilities("machine-C", { probe: probe(8, 32, 24) });
    const base = reconcileMachineProfile({ existing: null, capabilities: caps, recommendation: recommend(caps), tuning: DEFAULT_CAPACITY_TUNING }).profile;
    const calibrated: MachineCapacityProfile = {
      ...base,
      configuredCapacity: 4,
      benchmarkTestedCapacity: 12,
      productionApprovedCapacity: 9,
      estimatedMemoryPerInstanceMb: 700,
      requiresRecalibration: false
    };
    const upgraded = detectMachineCapabilities("machine-C", { probe: probe(16, 64, 50) }); // CPU + RAM changed
    const { profile, recalibrationReasons } = reconcileMachineProfile({ existing: calibrated, capabilities: upgraded, recommendation: recommend(upgraded), tuning: DEFAULT_CAPACITY_TUNING });
    check("hardware change → requiresRecalibration true with reasons", profile.requiresRecalibration === true && recalibrationReasons.length > 0, recalibrationReasons.join("; "));
    check("hardware change → stale benchmark values dropped", profile.benchmarkTestedCapacity === undefined && profile.productionApprovedCapacity === undefined && profile.estimatedMemoryPerInstanceMb === undefined);
    check("hardware change → administrator configured value preserved", profile.configuredCapacity === 4);
    check("hardware change → snapshot refreshed to new hardware", profile.capabilitiesSnapshot.logicalCpuCount === 16);
  }

  // 4. Two machines keep isolated profiles in the same runtime root.
  {
    const dir = await mkdtemp(join(tmpdir(), "awtkit-mcp-4-"));
    const store = new MachineCapacityProfileStore(dir);
    const a = detectMachineCapabilities("iso-A", { probe: probe(4, 8, 6) });
    const b = detectMachineCapabilities("iso-B", { probe: probe(32, 128, 110) });
    await store.save(reconcileMachineProfile({ existing: null, capabilities: a, recommendation: recommend(a), tuning: DEFAULT_CAPACITY_TUNING }).profile);
    await store.save(reconcileMachineProfile({ existing: null, capabilities: b, recommendation: recommend(b), tuning: DEFAULT_CAPACITY_TUNING }).profile);
    const la = await store.load("iso-A");
    const lb = await store.load("iso-B");
    const all = await store.list();
    check("two machineIds persist as separate profiles", la?.machineId === "iso-A" && lb?.machineId === "iso-B" && la?.recommendedCapacity !== lb?.recommendedCapacity, `A=${la?.recommendedCapacity} B=${lb?.recommendedCapacity}`);
    check("list() returns both machine profiles", all.length === 2);
    check("loading an unknown machine returns null", (await store.load("nope")) === null);
    await rm(dir, { recursive: true, force: true });
  }

  // 5. Server-grade machine starts flagged for benchmark validation.
  {
    const caps = detectMachineCapabilities("srv", { probe: probe(32, 128, 110) });
    const { profile } = reconcileMachineProfile({ existing: null, capabilities: caps, recommendation: recommend(caps), tuning: DEFAULT_CAPACITY_TUNING });
    check("server-grade new profile requires recalibration before high concurrency", profile.requiresRecalibration === true);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nMachine capacity profile: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
