/**
 * Watchdog verification (deterministic, fake instance views).
 * Run with: npx tsx scripts/verify-watchdog.mts
 *
 * Proves: stale-heartbeat detection, orphan detection, NO false positives for manual handoff /
 * paused / terminal instances, finding dedupe + clearInstance, stale-lock sweeping, and the
 * watchdog snapshot used by the runtime status API.
 */
import { ResourceLockManager } from "@src/runner/concurrency/ResourceLockManager";
import { WatchdogService, type WatchdogFinding, type WatchdogInstanceView } from "@src/runner/runtime/WatchdogService";

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
  console.log("Watchdog verification");

  const locks = new ResourceLockManager();
  locks.tryAcquire("dead-owner", { key: "instance:expired", mode: "exclusive", ttlMs: 1 });
  await sleep(10);
  const now = Date.now();

  let views: WatchdogInstanceView[] = [];
  const findings: WatchdogFinding[] = [];
  const logs: string[] = [];
  const watchdog = new WatchdogService(
    { listActiveInstances: () => views, onFinding: (finding) => findings.push(finding), log: (message) => logs.push(message) },
    { staleHeartbeatMs: 120_000, watchdogIntervalMs: 15_000 },
    locks
  );

  console.log("\nPart A — detection without false positives");
  views = [
    { instanceId: "healthy", executionId: "e", status: "running", heartbeatAt: new Date(now - 5_000).toISOString(), runnerActive: true },
    { instanceId: "stuck", executionId: "e", status: "running", heartbeatAt: new Date(now - 10 * 60_000).toISOString(), runnerActive: true },
    { instanceId: "ghost", executionId: "e", status: "running", heartbeatAt: new Date(now - 5_000).toISOString(), runnerActive: false },
    // Manual handoff: heartbeat is HOURS old but status says the human is working — never flagged.
    { instanceId: "handoff", executionId: "e", status: "waitingForManualAction", heartbeatAt: new Date(now - 3 * 3600_000).toISOString(), runnerActive: true },
    { instanceId: "paused", executionId: "e", status: "paused", heartbeatAt: new Date(now - 3600_000).toISOString(), runnerActive: true },
    { instanceId: "done", executionId: "e", status: "completed", runnerActive: false }
  ];
  const first = watchdog.scan(now);
  check("stale heartbeat detected", first.some((f) => f.instanceId === "stuck" && f.kind === "staleHeartbeat"));
  check("orphan detected (no runner promise)", first.some((f) => f.instanceId === "ghost" && f.kind === "orphaned"));
  check("manual handoff NOT flagged despite hours-old heartbeat", !first.some((f) => f.instanceId === "handoff"));
  check("paused NOT flagged", !first.some((f) => f.instanceId === "paused"));
  check("healthy + terminal NOT flagged", !first.some((f) => f.instanceId === "healthy" || f.instanceId === "done"));
  check("reason names the exact stall duration", logs.some((line) => line.includes("stuck") && line.includes("no heartbeat for")));

  console.log("\nPart B — dedupe + clearInstance");
  const second = watchdog.scan(now + 1_000);
  check("repeat scans do not re-report the same finding", second.length === 0);
  watchdog.clearInstance("stuck");
  const third = watchdog.scan(now + 2_000);
  check("cleared instance re-evaluated after repeat", third.some((f) => f.instanceId === "stuck"));

  console.log("\nPart C — stale lock sweep + snapshot");
  check("expired lock swept and logged", !locks.isHeld("instance:expired") && logs.some((line) => line.includes("released stale lock instance:expired")));
  const snapshot = watchdog.snapshot();
  check("snapshot: lastScanAt + totals", snapshot.lastScanAt !== undefined && snapshot.totalFindings === 3);
  check("snapshot: recent findings carry kind/instance/reason/at", snapshot.recentFindings.every((f) => f.kind && f.instanceId && f.reason && f.at));
  check("snapshot: swept lock recorded", snapshot.sweptLockCount === 1 && snapshot.lastSweptLockKey === "instance:expired");
  check("snapshot: running=false (timer not started in test)", snapshot.running === false);

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-watchdog crashed:", error);
  process.exit(1);
});
