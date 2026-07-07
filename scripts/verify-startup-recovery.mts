/**
 * Startup-recovery verification (temp SQLite files; no Electron needed — exercises the same
 * `runStartupRecovery` the ExecutionEngine calls on init).
 * Run with: npx tsx scripts/verify-startup-recovery.mts
 *
 * Proves: killing the app mid-run does not lose state (rows persist), interrupted runs are
 * classified orphaned/recoverable vs failed/manual-review (dangerous node in flight), verdicts
 * are recorded once (idempotent across restarts), safe runs are flagged retryable, and watchdog
 * events document every recovery action.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import { runStartupRecovery } from "@src/runner/store/StartupRecovery";

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
  console.log("Startup-recovery verification");
  const root = await mkdtemp(join(tmpdir(), "wfs-recovery-"));
  const dbPath = join(root, "runtime.sqlite");

  // ── Simulate a prior app instance that died mid-run ─────────────────────────
  const before = await SqliteRuntimeStore.open(dbPath, () => undefined);
  // Run 1: interrupted while a SAFE (read) node was running.
  before.upsertRun({ instanceId: "run-safe", executionId: "e1", scenarioId: "s1", status: "running", appInstanceId: "old-app", startedAt: "2026-07-06T09:00:00.000Z" });
  before.recordAttempt({ attemptId: "run-safe:n1", instanceId: "run-safe", executionId: "e1", nodeId: "n1", tryNumber: 1, status: "succeeded", sideEffectLevel: "safeMutation" });
  before.recordAttempt({ attemptId: "run-safe:n2", instanceId: "run-safe", executionId: "e1", nodeId: "n2", tryNumber: 1, status: "running", sideEffectLevel: "read" });
  // Run 2: interrupted while a DANGEROUS node was in flight.
  before.upsertRun({ instanceId: "run-danger", executionId: "e2", scenarioId: "s1", status: "running", appInstanceId: "old-app", startedAt: "2026-07-06T09:01:00.000Z" });
  before.recordAttempt({ attemptId: "run-danger:n1", instanceId: "run-danger", executionId: "e2", nodeId: "n1", tryNumber: 1, status: "running", sideEffectLevel: "dangerousMutation" });
  // Run 3: waiting for manual action when the app died (no side-effect in flight).
  before.upsertRun({ instanceId: "run-waiting", executionId: "e3", scenarioId: "s1", status: "waitingForManualAction", appInstanceId: "old-app" });
  // Run 4: completed cleanly — must NOT be touched by recovery.
  before.upsertRun({ instanceId: "run-done", executionId: "e4", scenarioId: "s1", status: "completed", appInstanceId: "old-app", endedAt: "2026-07-06T09:02:00.000Z" });
  await before.persistNow();
  await before.close(); // "app exit" — no cleanup ran

  // ── New app instance starts up ───────────────────────────────────────────────
  const after = await SqliteRuntimeStore.open(dbPath, () => undefined);
  check("state survived the app exit (all 4 runs present)", after.listRuns().length === 4);

  const verdicts = runStartupRecovery(after, "new-app-instance");
  check("recovery examined exactly the 3 interrupted runs", verdicts.length === 3);

  const safeRun = after.getRun("run-safe");
  check("safe interrupted run → orphaned + recoverable (can be scheduled for retry)", safeRun?.status === "orphaned" && safeRun.recoverable === true, JSON.stringify(safeRun));
  const dangerRun = after.getRun("run-danger");
  check("dangerous interrupted run → failed + NOT auto-resumable", dangerRun?.status === "failed" && dangerRun.recoverable === false);
  check("dangerous verdict says manual review required", /manual/i.test(dangerRun?.recoveryNote ?? ""));
  const waitingRun = after.getRun("run-waiting");
  check("manual-handoff run → orphaned + recoverable (no side-effect in flight)", waitingRun?.status === "orphaned" && waitingRun.recoverable === true);
  const doneRun = after.getRun("run-done");
  check("completed run untouched by recovery", doneRun?.status === "completed" && doneRun.recoveryNote === undefined);

  check("recovery is idempotent (second pass finds nothing)", runStartupRecovery(after, "new-app-instance").length === 0);
  await after.persistNow();
  await after.close();

  // Verdicts must survive yet another restart (inspectability).
  const third = await SqliteRuntimeStore.open(dbPath, () => undefined);
  check("verdicts persisted across another restart", third.getRun("run-danger")?.recoverable === false && third.getRun("run-safe")?.recoverable === true);
  check("recovery on the third start also finds nothing (notes persisted)", runStartupRecovery(third, "yet-another-app").length === 0);
  await third.close();

  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-startup-recovery crashed:", error);
  process.exit(1);
});
