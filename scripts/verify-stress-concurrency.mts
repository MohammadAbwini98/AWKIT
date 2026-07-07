/**
 * Concurrency stress verification (Phase 4E — deterministic, fake runtimes, no browsers).
 * Run with: npm run verify:stress:concurrency
 *
 * Proves under churn: many queued instances never exceed the browser cap, every grant is
 * released, backpressure activates with an explicit reason and clears again, the active-flow
 * cap blocks dispatch, and total browser creation stays bounded (no unbounded Chromium).
 *
 * Tunables: AWKIT_STRESS_INSTANCES (25), AWKIT_STRESS_MAX_BROWSERS (2),
 *           AWKIT_STRESS_TIMEOUT_MS (120000).
 */
import { BrowserWorkerPool } from "@src/runner/browser/BrowserWorkerPool";
import { BackpressureController } from "@src/runner/concurrency/BackpressureController";
import { loadConcurrencyLimits } from "@src/runner/concurrency/ConcurrencyConfig";

const STRESS_INSTANCES = envInt("AWKIT_STRESS_INSTANCES", 25);
const STRESS_MAX_BROWSERS = envInt("AWKIT_STRESS_MAX_BROWSERS", 2);
const STRESS_TIMEOUT_MS = envInt("AWKIT_STRESS_TIMEOUT_MS", 120_000);

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

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  console.log(`Concurrency stress verification (${STRESS_INSTANCES} instances, cap ${STRESS_MAX_BROWSERS})`);

  console.log("\nPart A — browser cap holds under queued churn");
  const limits = loadConcurrencyLimits({ maxBrowsersPerHost: STRESS_MAX_BROWSERS, minFreeMemoryMb: 0, maxActiveFlows: 1000 });
  const pool = new BrowserWorkerPool(limits);
  let maxConcurrent = 0;
  let totalGrants = 0;
  let refusals = 0;

  const workers = Array.from({ length: STRESS_INSTANCES }, (_, index) => index).map(async (index) => {
    // Each "instance" polls for a slot like the engine's processQueue tick does.
    for (;;) {
      const slot = pool.tryAcquireSlot(`stress-i${index}`);
      if (slot) {
        totalGrants += 1;
        maxConcurrent = Math.max(maxConcurrent, pool.snapshot().activeSlots);
        await sleep(2 + (index % 7)); // hold the "browser" briefly
        maxConcurrent = Math.max(maxConcurrent, pool.snapshot().activeSlots);
        pool.releaseSlot(slot);
        return;
      }
      refusals += 1;
      await sleep(2);
    }
  });
  await Promise.all(workers);

  check(`every instance eventually ran (${totalGrants}/${STRESS_INSTANCES} grants)`, totalGrants === STRESS_INSTANCES);
  check(`browser cap never exceeded (max concurrent ${maxConcurrent} ≤ ${STRESS_MAX_BROWSERS})`, maxConcurrent <= STRESS_MAX_BROWSERS && maxConcurrent > 0);
  check(`saturation refusals happened and queued instead of crashing (${refusals} refusals)`, refusals > 0);
  check("all slots released at the end", pool.snapshot().activeSlots === 0, `activeSlots=${pool.snapshot().activeSlots}`);
  check(
    `no unbounded browser creation (total grants ${totalGrants} == instances, snapshot rejected ${pool.snapshot().totalRejected} ≥ refusals)`,
    totalGrants === STRESS_INSTANCES && pool.snapshot().totalRejected >= refusals
  );

  console.log("\nPart B — backpressure activates with a reason and clears");
  const bpPool = new BrowserWorkerPool(loadConcurrencyLimits({ maxBrowsersPerHost: 1, minFreeMemoryMb: 0 }));
  const backpressure = new BackpressureController(bpPool, bpPool.concurrencyLimits);
  const held = bpPool.tryAcquireSlot("bp-hold");
  const blocked = backpressure.admit(0, STRESS_INSTANCES);
  check("saturated pool blocks dispatch with an explicit reason", !blocked.allow && !!blocked.reason, blocked.reason);
  check("capacity snapshot reports dispatchBlocked + reason", backpressure.snapshot(0, STRESS_INSTANCES).dispatchBlocked === true);
  bpPool.releaseSlot(held!);
  const cleared = backpressure.admit(0, 0);
  check("backpressure clears after the slot frees", cleared.allow === true, cleared.reason);
  check("capacity snapshot clears blockedReason", backpressure.snapshot(0, 0).dispatchBlocked === false);

  console.log("\nPart C — active-flow cap blocks new dispatch");
  const flowPool = new BrowserWorkerPool(loadConcurrencyLimits({ maxBrowsersPerHost: 100, maxActiveFlows: 4, minFreeMemoryMb: 0 }));
  const flowBp = new BackpressureController(flowPool, flowPool.concurrencyLimits);
  const flowBlocked = flowBp.admit(4, 10);
  check("activeFlows at the cap blocks with an explicit reason", !flowBlocked.allow && /active flow limit/.test(flowBlocked.reason ?? ""), flowBlocked.reason);
  check("below the cap admits again", flowBp.admit(3, 10).allow === true);

  console.log("\nPart D — host memory floor blocks and clears");
  const memPool = new BrowserWorkerPool(loadConcurrencyLimits({ maxBrowsersPerHost: 100, minFreeMemoryMb: 100_000_000 }));
  const memBp = new BackpressureController(memPool, memPool.concurrencyLimits);
  const memBlocked = memBp.admit(0, 1);
  check("impossible memory floor blocks with a low-memory reason", !memBlocked.allow && /low host memory/.test(memBlocked.reason ?? ""), memBlocked.reason);
  const memOkPool = new BrowserWorkerPool(loadConcurrencyLimits({ maxBrowsersPerHost: 100, minFreeMemoryMb: 0 }));
  check("normal memory floor admits", new BackpressureController(memOkPool, memOkPool.concurrencyLimits).admit(0, 1).allow === true);

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

const timeout = setTimeout(() => {
  console.error(`✗ Stress run exceeded AWKIT_STRESS_TIMEOUT_MS (${STRESS_TIMEOUT_MS}ms) — possible deadlock.`);
  process.exit(1);
}, STRESS_TIMEOUT_MS);
timeout.unref();

main().catch((error) => {
  console.error(`✗ Unhandled failure: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
