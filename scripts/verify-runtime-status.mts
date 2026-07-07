/**
 * Runtime-status API verification (pure — no Electron, no browsers).
 * Run with: npx tsx scripts/verify-runtime-status.mts
 *
 * Proves: dispatch-claim derivation (origin from baseUrl / first goto, account from envFile),
 * lock debug snapshot counts (active + stale, per kind), capacity snapshot correctness, and
 * the aggregated RuntimeStatusSnapshot shape the IPC status API returns.
 */
import { buildDispatchClaims, deriveTargetOrigin } from "@src/runner/concurrency/DispatchClaims";
import { buildLockDebugSnapshot, buildRuntimeStatus } from "@src/runner/concurrency/RuntimeStatus";
import { ResourceLockManager } from "@src/runner/concurrency/ResourceLockManager";
import { BrowserWorkerPool } from "@src/runner/browser/BrowserWorkerPool";
import { BackpressureController } from "@src/runner/concurrency/BackpressureController";
import { WatchdogService } from "@src/runner/runtime/WatchdogService";
import type { FlowProfile } from "@src/profiles/FlowProfile";

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

async function main(): Promise<void> {
  console.log("Runtime-status verification");

  console.log("\nPart A — dispatch claim derivation");
  const gotoFlow = { nodes: [{ id: "s", type: "start", name: "Start" }, { id: "g", type: "goto", name: "Go", url: "https://app.example.test/login?next=/home" }] } as unknown as FlowProfile;
  check("origin from first goto URL (host only)", deriveTargetOrigin({ flows: [gotoFlow] }) === "app.example.test");
  check("baseUrl wins over goto", deriveTargetOrigin({ baseUrl: "https://base.test/x", flows: [gotoFlow] }) === "base.test");
  check("templated URL skipped safely", deriveTargetOrigin({ flows: [{ nodes: [{ id: "g", type: "goto", name: "Go", url: "${runtimeInputs.url}" }] } as unknown as FlowProfile] }) === undefined);

  const claims = buildDispatchClaims({ baseUrl: "https://app.example.test", envFile: "acct-7.env", flows: [] });
  check("claims: origin + account semaphores", claims.length === 2 && claims.some((c) => c.key === "origin:app.example.test") && claims.some((c) => c.key === "account:acct-7.env"));
  check("no claimable inputs → empty claims (dispatch still allowed)", buildDispatchClaims({ flows: [] }).length === 0);

  console.log("\nPart B — lock debug snapshot (active + stale, per kind)");
  const locks = new ResourceLockManager({ "origin:*": 2 });
  locks.tryAcquire("i1", { key: "profile:c:/p/one", mode: "exclusive" });
  locks.tryAcquire("i2", { key: "downloadDir:d:/dl/run1", mode: "exclusive" });
  locks.tryAcquire("i3", { key: "origin:site.test", mode: "semaphore" });
  locks.tryAcquire("i4", { key: "account:a1", mode: "semaphore" });
  locks.tryAcquire("dead", { key: "instance:gone", mode: "exclusive", ttlMs: 1 });
  await sleep(15);

  const debugSnapshot = buildLockDebugSnapshot(locks.snapshot(false));
  check("per-kind counts correct", debugSnapshot.profileLocks === 1 && debugSnapshot.downloadDirLocks === 1 && debugSnapshot.originLocks === 1 && debugSnapshot.accountLocks === 1);
  check("stale (expired, unswept) lease reported", debugSnapshot.staleLocks === 1);
  check("totalHeld counts holders", debugSnapshot.totalHeld === 5);

  console.log("\nPart C — capacity snapshot correctness");
  const pool = new BrowserWorkerPool({ maxBrowsersPerHost: 3, maxActiveFlows: 5, minFreeMemoryMb: 0, maxRecentCrashes: 10 });
  pool.tryAcquireSlot("i1");
  pool.tryAcquireSlot("i2");
  const backpressure = new BackpressureController(pool);
  const capacity = backpressure.snapshot(2, 4);
  check("capacity: browsers active/max", capacity.activeBrowsers === 2 && capacity.maxBrowsers === 3);
  check("capacity: flows + queue depth", capacity.activeFlows === 2 && capacity.maxActiveFlows === 5 && capacity.queueDepth === 4);
  check("capacity: memory + rss present", capacity.freeMemoryMb > 0 && capacity.processRssMb > 0);

  console.log("\nPart D — aggregated runtime status");
  const watchdog = new WatchdogService(
    { listActiveInstances: () => [], onFinding: () => undefined, log: () => undefined },
    { staleHeartbeatMs: 120_000, watchdogIntervalMs: 15_000 },
    locks
  );
  watchdog.scan();
  const status = buildRuntimeStatus({
    capacity,
    lockEntries: locks.snapshot(false),
    browserPool: pool.snapshot(),
    watchdog: watchdog.snapshot()
  });
  check("status: all four sections present", !!status.capacity && !!status.locks && !!status.browserPool && !!status.watchdog && !!status.timestamp);
  check("status: watchdog scan reflected", status.watchdog.lastScanAt !== undefined);
  check("status: stale lock swept by watchdog scan", status.locks.entries.every((entry) => entry.key !== "instance:gone"));
  check("status: browser pool section carries slots", status.browserPool.activeSlots === 2 && status.browserPool.maxSlots === 3);

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-runtime-status crashed:", error);
  process.exit(1);
});
