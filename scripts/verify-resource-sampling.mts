/**
 * Resource-sampling verification (pure — no browsers).
 * Run with: npx tsx scripts/verify-resource-sampling.mts
 *
 * Proves: the sampler produces plausible system-memory/CPU/process values, freshness gating,
 * backpressure blocking on memory/CPU pressure with explicit reasons, sampled values in the
 * capacity snapshot, sampling failure never breaking admission, and browser-count backpressure
 * still working alongside.
 */
import { ResourceSampler } from "@src/runner/concurrency/ResourceSampler";
import { BackpressureController } from "@src/runner/concurrency/BackpressureController";
import { BrowserWorkerPool } from "@src/runner/browser/BrowserWorkerPool";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Duck-typed sampler with pinned values (sampling source stubbed, controller logic real). */
function fakeSampler(values: { systemMemoryPercent?: number; processRssMb?: number; cpuPercent?: number }, fresh = true): ResourceSampler {
  return {
    latest: { sampledAt: new Date().toISOString(), ...values },
    isFresh: () => fresh,
    start: () => undefined,
    stop: () => undefined,
    sample: () => ({ sampledAt: new Date().toISOString(), ...values })
  } as unknown as ResourceSampler;
}

async function main(): Promise<void> {
  console.log("Resource-sampling verification");

  console.log("\nPart A — real sampler values");
  const sampler = new ResourceSampler(200);
  sampler.sample();
  await sleep(250);
  const sample = sampler.sample();
  check("system memory percent plausible (0–100)", sample.systemMemoryPercent !== undefined && sample.systemMemoryPercent > 0 && sample.systemMemoryPercent <= 100, JSON.stringify(sample));
  check("process RSS sampled (> 0 MB)", sample.processRssMb !== undefined && sample.processRssMb > 0);
  check("system CPU percent computed from deltas (0–100)", sample.cpuPercent !== undefined && sample.cpuPercent >= 0 && sample.cpuPercent <= 100);
  check("process CPU percent computed", sample.processCpuPercent !== undefined && sample.processCpuPercent >= 0);
  check("freshness gate true right after sampling", sampler.isFresh());
  check("freshness gate false for an old sample", !sampler.isFresh(Date.now() + 60_000));

  console.log("\nPart B — backpressure reacts to sampled pressure");
  const limits = { maxBrowsersPerHost: 8, maxActiveFlows: 8, minFreeMemoryMb: 0, maxRecentCrashes: 99, maxSystemMemoryPercent: 85, maxProcessMemoryMb: 2048, maxCpuPercent: 85 };
  const pool = new BrowserWorkerPool(limits);

  const memBp = new BackpressureController(pool, pool.concurrencyLimits, fakeSampler({ systemMemoryPercent: 97 }));
  const memDecision = memBp.admit(0, 0);
  check("blocks on system memory pressure with explicit reason", !memDecision.allow && /system memory pressure/.test(memDecision.reason ?? ""), memDecision.reason);

  const rssBp = new BackpressureController(pool, pool.concurrencyLimits, fakeSampler({ processRssMb: 4096 }));
  check("blocks on process RSS pressure", !rssBp.admit(0, 0).allow);

  const cpuBp = new BackpressureController(pool, pool.concurrencyLimits, fakeSampler({ cpuPercent: 99 }));
  const cpuDecision = cpuBp.admit(0, 0);
  check("blocks on CPU pressure with explicit reason", !cpuDecision.allow && /CPU pressure/.test(cpuDecision.reason ?? ""), cpuDecision.reason);

  const staleBp = new BackpressureController(pool, pool.concurrencyLimits, fakeSampler({ cpuPercent: 99 }, false));
  check("stale sample is ignored (no false blocking)", staleBp.admit(0, 0).allow);

  const okBp = new BackpressureController(pool, pool.concurrencyLimits, fakeSampler({ systemMemoryPercent: 40, cpuPercent: 10, processRssMb: 200 }));
  check("healthy sample admits", okBp.admit(0, 0).allow);

  console.log("\nPart C — snapshot carries sampled values; failures never crash admission");
  const snap = okBp.snapshot(1, 2);
  check("capacity snapshot exposes sampled CPU/memory for the UI", snap.systemMemoryPercent === 40 && snap.cpuPercent === 10 && snap.sampledAt !== undefined);

  const brokenSampler = {
    latest: undefined,
    isFresh: () => {
      throw new Error("sampler exploded");
    }
  } as unknown as ResourceSampler;
  const brokenBp = new BackpressureController(pool, pool.concurrencyLimits, brokenSampler);
  let admitResult: { allow: boolean } | undefined;
  let snapshotOk = false;
  try {
    admitResult = brokenBp.admit(0, 0);
    snapshotOk = brokenBp.snapshot(0, 0).timestamp !== undefined;
  } catch {
    admitResult = undefined;
  }
  check("sampler failure never crashes admission (broken sampler tolerated)", admitResult?.allow === true && snapshotOk);

  // Browser-count backpressure still works with a sampler present.
  const smallPool = new BrowserWorkerPool({ ...limits, maxBrowsersPerHost: 1 });
  smallPool.tryAcquireSlot("i1");
  const comboBp = new BackpressureController(smallPool, smallPool.concurrencyLimits, fakeSampler({ systemMemoryPercent: 40 }));
  check("browser-count backpressure still works alongside sampling", !comboBp.admit(0, 0).allow);

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-resource-sampling crashed:", error);
  process.exit(1);
});
