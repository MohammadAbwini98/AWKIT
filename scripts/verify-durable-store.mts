/**
 * Durable SQLite runtime-store verification (temp files; no external services).
 * Run with: npx tsx scripts/verify-durable-store.mts
 *
 * Proves: initialization + migrations (idempotent across reopen), a REAL SQLite file on disk,
 * run/attempt/heartbeat/cancellation/watchdog/artifact/capacity persistence across store
 * restart, and recovery-oriented reads (interrupted runs).
 */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import { RUNTIME_STORE_MIGRATIONS } from "@src/runner/store/RuntimeStoreSchema";

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

async function main(): Promise<void> {
  console.log("Durable runtime store verification");
  const root = await mkdtemp(join(tmpdir(), "wfs-durable-store-"));
  const dbPath = join(root, "runtime.sqlite");

  console.log("\nPart A — init + migrations + real SQLite file");
  const store = await SqliteRuntimeStore.open(dbPath, () => undefined);
  const migrations = store.appliedMigrations();
  // Compared against RUNTIME_STORE_MIGRATIONS rather than a hardcoded list: this assertion was
  // previously pinned at 2 and went stale silently when v3 and v4 were added, leaving the verifier
  // red. Deriving it means adding a migration can no longer break this check.
  const expected = RUNTIME_STORE_MIGRATIONS.map((migration) => `${migration.version}:${migration.name}`);
  const applied = migrations.map((migration) => `${migration.version}:${migration.name}`);
  check(
    `all ${expected.length} migrations applied on first open (${expected.join(", ")})`,
    applied.length === expected.length && applied.every((entry, index) => entry === expected[index]),
    `applied: ${applied.join(", ") || "none"}`
  );
  const header = (await readFile(dbPath)).subarray(0, 15).toString();
  check("database file is a real SQLite file on disk", header === "SQLite format 3", header);

  console.log("\nPart B — writes persist across store restart");
  store.upsertRun({ instanceId: "i-1", executionId: "e-1", scenarioId: "s-1", status: "running", flowRunStatus: "running", startedAt: "2026-07-06T10:00:00.000Z" });
  store.recordAttempt({
    attemptId: "i-1:n1-a1",
    instanceId: "i-1",
    executionId: "e-1",
    flowId: "f-1",
    nodeId: "n1",
    tryNumber: 1,
    status: "running",
    sideEffectLevel: "read",
    startedAt: "2026-07-06T10:00:01.000Z"
  });
  store.recordAttempt({
    attemptId: "i-1:n1-a1",
    instanceId: "i-1",
    executionId: "e-1",
    flowId: "f-1",
    nodeId: "n1",
    tryNumber: 1,
    status: "failedRetryable",
    sideEffectLevel: "read",
    error: "Timeout 5000ms exceeded",
    errorClass: "timeout",
    tracePath: "C:/runs/e-1/traces/n1.zip",
    completedAt: "2026-07-06T10:00:05.000Z"
  });
  store.recordHeartbeat({ instanceId: "i-1", executionId: "e-1", nodeId: "n1", currentUrl: "http://x.test/page", timestamp: "2026-07-06T10:00:04.000Z" });
  store.recordCancellation({ instanceId: "i-1", executionId: "e-1", requestedAt: "2026-07-06T10:00:06.000Z", reason: "user stop", source: "ui" });
  store.recordWatchdogEvent({ instanceId: "i-1", kind: "staleHeartbeat", reason: "no heartbeat for 130s", at: "2026-07-06T10:00:07.000Z" });
  store.recordArtifact({ instanceId: "i-1", executionId: "e-1", nodeId: "n1", kind: "trace", path: "C:/runs/e-1/traces/n1.zip", createdAt: "2026-07-06T10:00:05.000Z" });
  store.recordCapacitySnapshot({
    timestamp: "2026-07-06T10:00:08.000Z",
    activeBrowsers: 1,
    maxBrowsers: 2,
    activeContexts: 1,
    activePages: 1,
    activeFlows: 1,
    maxActiveFlows: 4,
    queueDepth: 0,
    freeMemoryMb: 4096,
    processRssMb: 300,
    recentCrashes: 0,
    dispatchBlocked: false
  });
  await store.persistNow();
  await store.close();

  const reopened = await SqliteRuntimeStore.open(dbPath, () => undefined);
  check(
    `migrations idempotent across reopen (still exactly ${expected.length}, none re-applied)`,
    reopened.appliedMigrations().length === expected.length,
    `found ${reopened.appliedMigrations().length}`
  );
  const runs = reopened.listRuns();
  check("run state persisted across restart", runs.length === 1 && runs[0].instanceId === "i-1" && runs[0].status === "running");
  check("heartbeat folded into the run row", runs[0].lastHeartbeatAt === "2026-07-06T10:00:04.000Z");
  const attempts = reopened.listAttempts("i-1");
  check("node attempt persisted across restart (replaced, not duplicated)", attempts.length === 1 && attempts[0].status === "failedRetryable");
  check("attempt carries error class + trace path + side-effect level", attempts[0].errorClass === "timeout" && attempts[0].tracePath === "C:/runs/e-1/traces/n1.zip" && attempts[0].sideEffectLevel === "read");

  console.log("\nPart C — recovery-oriented reads");
  const interrupted = reopened.findInterruptedRuns("a-different-app-instance");
  check("active-looking run from another app instance is 'interrupted'", interrupted.length === 1 && interrupted[0].instanceId === "i-1");
  reopened.markRunRecovery("i-1", { status: "orphaned", recoverable: true, recoveryNote: "test note" });
  const recovered = reopened.getRun("i-1");
  check("recovery verdict written (status/recoverable/note)", recovered?.status === "orphaned" && recovered.recoverable === true && recovered.recoveryNote === "test note");
  check("runs with a recovery note are excluded from re-recovery", reopened.findInterruptedRuns("a-different-app-instance").length === 0);
  await reopened.close();

  // Verdict itself must persist across another restart.
  const third = await SqliteRuntimeStore.open(dbPath, () => undefined);
  check("recovery verdict persisted across restart", third.getRun("i-1")?.recoveryNote === "test note");
  await third.close();

  console.log("\nPart D — unreadable file fails CLOSED; history survives (AWKIT-DUR-001)");
  {
    // Inject a non-ENOENT read failure deterministically: the target path exists but cannot be
    // READ as a file (a directory occupies it — same failure class as EBUSY/EPERM/EACCES).
    // Asserting only on a MISSING file would pass vacuously — whatever sits at the path must
    // still exist untouched afterward.
    const occupiedPath = join(root, "occupied.sqlite");
    await mkdir(occupiedPath, { recursive: true });
    let rejected = false;
    try {
      await SqliteRuntimeStore.open(occupiedPath, () => undefined);
    } catch {
      rejected = true;
    }
    check("open() on an unreadable path REJECTS instead of booting an empty database", rejected);
    check("the unreadable path is preserved untouched (nothing renamed over it)", (await stat(occupiedPath)).isDirectory());

    // A genuinely corrupt-BYTES file must also reach the engine's fail-closed downgrade, never
    // a silent empty rebuild.
    const corruptPath = join(root, "corrupt.sqlite");
    const CORRUPT = "this is definitely not a sqlite database";
    await writeFile(corruptPath, Buffer.from(CORRUPT, "utf8"));
    let corruptThrew = false;
    try {
      await SqliteRuntimeStore.open(corruptPath, () => undefined);
    } catch {
      corruptThrew = true;
    }
    check("open() on corrupt BYTES rejects (engine downgrades to NullRuntimeStore)", corruptThrew);
    check("corrupt-bytes file is preserved verbatim", (await readFile(corruptPath, "utf8")) === CORRUPT);

    // ENOENT remains the ONLY legitimate fresh-database boot.
    const freshPath = join(root, "fresh.sqlite");
    const fresh = await SqliteRuntimeStore.open(freshPath, () => undefined);
    check("a genuinely MISSING file still boots a fresh empty database", fresh.listRuns().length === 0);
    await fresh.close();
  }

  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-durable-store crashed:", error);
  process.exit(1);
});
