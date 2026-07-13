// Verifies machine capability detection (src/runner/concurrency/MachineCapabilityDetector.ts) is
// hardware-agnostic: fields populate from an injectable OS probe across synthetic machine shapes, the
// coarse fingerprint is stable across reboots yet changes on material hardware changes (and NOT on
// available-memory drift), and the machineId is generated + persisted + reused.
//
// Pure — no Electron, no real host assumptions. Run: npx tsx scripts/verify-machine-capabilities.mts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capabilitiesChanged,
  computeCapabilityFingerprint,
  detectMachineCapabilities,
  loadOrCreateMachineId,
  type OsProbe
} from "../src/runner/concurrency/MachineCapabilityDetector";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const GB = 1024 * 1024 * 1024;

/** Build a fake OS probe for a labelled example machine (fixtures only — never a production default). */
function fakeProbe(spec: {
  platform?: string;
  arch?: string;
  type?: string;
  release?: string;
  hostname?: string;
  cores: number;
  totalGb: number;
  freeGb: number;
  cpuModel?: string;
  cpuSpeed?: number;
}): OsProbe {
  return {
    platform: () => spec.platform ?? "win32",
    arch: () => spec.arch ?? "x64",
    type: () => spec.type ?? "Windows_NT",
    release: () => spec.release ?? "10.0.19045",
    hostname: () => spec.hostname ?? "example-host",
    totalmem: () => spec.totalGb * GB,
    freemem: () => spec.freeGb * GB,
    cpus: () => Array.from({ length: spec.cores }, () => ({ model: spec.cpuModel ?? "Example CPU", speed: spec.cpuSpeed ?? 2600 }))
  };
}

async function main() {
  const fixtures = [
    { label: "8GB/4c", cores: 4, totalGb: 8, freeGb: 6 },
    { label: "16GB/8c", cores: 8, totalGb: 16, freeGb: 12 },
    { label: "32GB/12c", cores: 12, totalGb: 32, freeGb: 24 },
    { label: "48GB/8c (guide example)", cores: 8, totalGb: 48, freeGb: 30 },
    { label: "64GB/16c", cores: 16, totalGb: 64, freeGb: 50 },
    { label: "128GB/32c", cores: 32, totalGb: 128, freeGb: 110 }
  ];

  // 1. Fields populate correctly for every example shape.
  for (const f of fixtures) {
    const caps = detectMachineCapabilities("mid-1", { probe: fakeProbe(f) });
    const okCpu = caps.logicalCpuCount === f.cores;
    const okMem = Math.round(caps.totalMemoryMb / 1024) === f.totalGb;
    const okAvail = Math.round(caps.availableMemoryMb / 1024) === f.freeGb;
    check(`detect ${f.label}: cpu/mem/avail populated`, okCpu && okMem && okAvail, `cpu=${caps.logicalCpuCount} totalMb=${caps.totalMemoryMb} availMb=${caps.availableMemoryMb}`);
  }

  // 2. Optional fields degrade gracefully (no cpu model/speed, no hostname).
  {
    const probe: OsProbe = {
      platform: () => "linux",
      arch: () => "arm64",
      type: () => "Linux",
      release: () => "",
      hostname: () => "",
      totalmem: () => 16 * GB,
      freemem: () => 8 * GB,
      cpus: () => Array.from({ length: 8 }, () => ({})) // no model/speed
    };
    const caps = detectMachineCapabilities("mid-2", { probe });
    check("optional fields degrade to undefined", caps.cpuModel === undefined && caps.cpuBaseSpeedMhz === undefined && caps.hostname === undefined, `model=${caps.cpuModel} speed=${caps.cpuBaseSpeedMhz} host=${caps.hostname}`);
    check("required fields still present when optionals missing", caps.logicalCpuCount === 8 && caps.platform === "linux" && caps.architecture === "arm64");
  }

  // 3. Detection never throws even when the probe is hostile.
  {
    const hostile: OsProbe = {
      platform: () => { throw new Error("x"); },
      arch: () => { throw new Error("x"); },
      type: () => { throw new Error("x"); },
      release: () => { throw new Error("x"); },
      hostname: () => { throw new Error("x"); },
      totalmem: () => { throw new Error("x"); },
      freemem: () => { throw new Error("x"); },
      cpus: () => { throw new Error("x"); }
    };
    let threw = false;
    let caps;
    try {
      caps = detectMachineCapabilities("mid-3", { probe: hostile });
    } catch {
      threw = true;
    }
    check("hostile probe does not throw; floors to a minimal snapshot", !threw && !!caps && caps!.logicalCpuCount >= 1 && caps!.totalMemoryMb === 0, `cpu=${caps?.logicalCpuCount} totalMb=${caps?.totalMemoryMb}`);
  }

  // 4. Fingerprint is stable across a "reboot" with identical hardware and across available-memory drift.
  {
    const base = fixtures[3]; // 48GB/8c
    const a = detectMachineCapabilities("fp", { probe: fakeProbe(base), now: new Date("2026-01-01T00:00:00Z") });
    const rebooted = detectMachineCapabilities("fp", { probe: fakeProbe(base), now: new Date("2026-06-01T00:00:00Z") });
    const memDrift = detectMachineCapabilities("fp", { probe: fakeProbe({ ...base, freeGb: 12 }) }); // only free RAM differs
    check("fingerprint stable across reboot (same hardware)", computeCapabilityFingerprint(a) === computeCapabilityFingerprint(rebooted));
    check("fingerprint stable across available-memory drift", computeCapabilityFingerprint(a) === computeCapabilityFingerprint(memDrift));
  }

  // 5. Fingerprint changes on material hardware changes (CPU count, total RAM, platform).
  {
    const base = detectMachineCapabilities("fp", { probe: fakeProbe({ cores: 8, totalGb: 32, freeGb: 20 }) });
    const moreCpu = detectMachineCapabilities("fp", { probe: fakeProbe({ cores: 16, totalGb: 32, freeGb: 20 }) });
    const moreRam = detectMachineCapabilities("fp", { probe: fakeProbe({ cores: 8, totalGb: 64, freeGb: 20 }) });
    const otherOs = detectMachineCapabilities("fp", { probe: fakeProbe({ cores: 8, totalGb: 32, freeGb: 20, platform: "linux", type: "Linux" }) });
    check("fingerprint changes when CPU count changes", computeCapabilityFingerprint(base) !== computeCapabilityFingerprint(moreCpu));
    check("fingerprint changes when total RAM changes", computeCapabilityFingerprint(base) !== computeCapabilityFingerprint(moreRam));
    check("fingerprint changes when platform/OS changes", computeCapabilityFingerprint(base) !== computeCapabilityFingerprint(otherOs));
  }

  // 6. capabilitiesChanged reports material changes with reasons; identical hardware = no change.
  {
    const prev = detectMachineCapabilities("m", { probe: fakeProbe({ cores: 8, totalGb: 32, freeGb: 20 }) });
    const same = detectMachineCapabilities("m", { probe: fakeProbe({ cores: 8, totalGb: 32, freeGb: 4 }) }); // avail drift only
    const changed = detectMachineCapabilities("m", { probe: fakeProbe({ cores: 12, totalGb: 32, freeGb: 20 }) });
    check("capabilitiesChanged: available-memory drift alone is NOT a change", capabilitiesChanged(prev, same).changed === false);
    const cpuChange = capabilitiesChanged(prev, changed);
    check("capabilitiesChanged: CPU change flagged with a reason", cpuChange.changed === true && cpuChange.reasons.some((r) => r.toLowerCase().includes("cpu")), cpuChange.reasons.join("; "));
  }

  // 7. machineId is generated, persisted, reused, and regenerated on corruption.
  {
    const dir = await mkdtemp(join(tmpdir(), "awtkit-mid-"));
    const first = await loadOrCreateMachineId(dir);
    const second = await loadOrCreateMachineId(dir);
    check("machineId generated as a non-empty string", typeof first === "string" && first.length > 0);
    check("machineId is stable across calls (persisted + reused)", first === second, `${first} === ${second}`);
    const persisted = JSON.parse(await readFile(join(dir, "machine-id.json"), "utf8"));
    check("machineId persisted to machine-id.json", persisted.machineId === first);
    await writeFile(join(dir, "machine-id.json"), "{ not json", "utf8");
    const regenerated = await loadOrCreateMachineId(dir);
    check("corrupt machine-id.json regenerates a fresh id", typeof regenerated === "string" && regenerated.length > 0 && regenerated !== first, `regenerated=${regenerated}`);
    await rm(dir, { recursive: true, force: true });
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nMachine capabilities: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
