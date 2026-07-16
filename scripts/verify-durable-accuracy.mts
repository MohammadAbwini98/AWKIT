/**
 * Durable run-history accuracy verification (Phase 04 of the concurrency closing task).
 *
 * Proves — through the REAL ExecutionEngine + durable SQLite store — that durable run counts are correct
 * and that the historical "3822 live completions vs 495 queried durable rows" discrepancy was a READ bug
 * (a clamped single-page query), NOT lost/overwritten/unflushed writes:
 *
 *   1. Reproduce the clamp:   getTelemetryRunHistory({ limit: huge }).rows.length === min(500, total)
 *                             while page.total (unbounded COUNT) === the real total.
 *   2. Fix via pagination:    readAllRunHistory(engine) returns every row (no dup / no missing IDs).
 *   3. Fix via aggregate:     getTelemetryStatusCounts({}).total === the real total.
 *   4. Accuracy invariants:   submitted === completed + failed + cancelled (live);
 *                             expected persisted === actual persisted (durable).
 *   5. No write loss:         durable success/failed === live completed/failed; every dispatched instance
 *                             has exactly one durable row; a fresh store reopened from disk sees them all.
 *   6. Retention is bounded + deterministic (documented cap; default cap ≫ this workload → nothing pruned).
 *
 * Runs a bounded, known workload (default 600 OK + 40 failing + 40 cancelled, so > the 500-row page cap).
 *
 *   npm run verify:durable-accuracy
 *   AWKIT_DURABLE_VERIFY_N=1000 npm run verify:durable-accuracy
 */
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { SqliteRuntimeStore } from "@src/runner/store/SqliteRuntimeStore";
import { RUNTIME_DB_FILENAME } from "@src/runner/store/RuntimeStoreSchema";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import type { ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import { startWorkloadServer } from "./benchmark/lib.mts";
import { buildFlow, buildScenario, buildProfile } from "./benchmark/workloads.mts";
import { buildDirs, cleanupRoot, installBenchGuards, readAllRunHistory } from "./benchmark/engineHarness.mts";

installBenchGuards();

const N = envInt("AWKIT_DURABLE_VERIFY_N", 600); // OK runs — deliberately > the 500 single-page clamp
const FAIL = envInt("AWKIT_DURABLE_VERIFY_FAIL", 40); // hard-failing runs (navigation refused)
const CANCEL = envInt("AWKIT_DURABLE_VERIFY_CANCEL", 40); // long-waiting runs cancelled mid-flight
const CONC = envInt("AWKIT_DURABLE_VERIFY_CONC", 8);
const PORT = 4460;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/** Minimal profile builder (isolated from the workload matrix) so scenarioId is explicit. */
function runProfile(executionId: string, scenarioId: string, base: string): ConcurrentRunProfile {
  return {
    id: executionId,
    scenarioId,
    runMode: "fixedConcurrent",
    maxConcurrentInstances: CONC,
    browserWindowMode: "headless",
    instanceTemplate: { browser: "chromium", headless: true, isolationMode: "browserContext", baseUrl: base, timeoutMs: 30_000, viewport: { width: 1280, height: 720 } },
    resourceControls: { maxBrowserContextsPerProcess: 8, delayBetweenInstanceStartsMs: 0 },
    failurePolicy: { stopAllOnCriticalFailure: false, continueOtherInstancesOnFailure: true, retryFailedInstance: false, retryCount: 0 }
  };
}

function scenario(id: string, flowId: string): ScenarioProfile {
  return {
    id,
    name: id,
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: [{ order: 1, flowId, required: true }],
    links: [],
    failurePolicy: { stopOnRequiredFlowFailure: false, continueOnOptionalFlowFailure: true, takeScreenshotOnFailure: false }
  };
}

/** Ultra-light OK flow: one goto to a fast static page then end (keeps N runs quick + deterministic). */
function okFlow(base: string): FlowProfile {
  return {
    id: "dv-ok-flow",
    name: "durable-ok",
    version: 1,
    nodes: [
      { id: "start", type: "start", name: "start" },
      { id: "goto", type: "goto", name: "goto form", url: `${base}/form` },
      { id: "end", type: "end", name: "end" }
    ],
    edges: [
      { id: "e0", source: "start", target: "goto", type: "success" },
      { id: "e1", source: "goto", target: "end", type: "success" }
    ]
  } as FlowProfile;
}

/** Hard-failing flow: navigate to a refused port so the required step errors → instance status "failed". */
function failFlow(): FlowProfile {
  return {
    id: "dv-fail-flow",
    name: "durable-fail",
    version: 1,
    nodes: [
      { id: "start", type: "start", name: "start" },
      { id: "goto", type: "goto", name: "goto refused", url: "http://127.0.0.1:9/nope" },
      { id: "end", type: "end", name: "end" }
    ],
    edges: [
      { id: "e0", source: "start", target: "goto", type: "success" },
      { id: "e1", source: "goto", target: "end", type: "success" }
    ]
  } as FlowProfile;
}

/**
 * Wait until every instance of the given executions is FULLY settled: live status terminal AND its durable
 * row terminal. `stopInstance` flips the live status to "cancelled" synchronously, but the durable terminal
 * row is written later in each instance's `finally` — so a live-only wait would read stale "running" rows.
 * Waiting on both signals removes that race (no arbitrary sleep).
 */
async function waitForSettled(engine: ExecutionEngine, execIds: string[], timeoutMs: number): Promise<void> {
  const ids = new Set(execIds);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const activeLive = engine.getInstances().filter((i) => ids.has(i.executionId) && !TERMINAL.has(i.status));
    const nonTerminalRows = readAllRunHistory(engine, {}).filter((r) => ids.has(r.executionId) && !TERMINAL.has(r.status));
    if (activeLive.length === 0 && nonTerminalRows.length === 0) return;
    await sleep(300);
  }
}

async function main(): Promise<void> {
  console.log(`Durable accuracy verification — N(ok)=${N} fail=${FAIL} cancel=${CANCEL} conc=${CONC}\n`);
  const server = await startWorkloadServer(PORT);
  const { dirs, root } = await buildDirs("awkit-durable-verify-");
  const engine = new ExecutionEngine();
  // Config D (shared pool ON + weighted admission ON) — the production default path.
  engine.configureConcurrency({ maxBrowsersPerHost: 4, maxActiveFlows: CONC, useSharedBrowserPool: true, workloadWeights: true });

  // ── Phase 1: OK + FAIL runs, waited to full completion (no forced cancellation) ──────────────
  console.log("Submitting OK + FAIL runs…");
  await engine.startRun("dv-ok", runProfile("dv-ok", "dv-scn-ok", server.base), Array.from({ length: N }), dirs, {}, scenario("dv-scn-ok", "dv-ok-flow"), [okFlow(server.base)]);
  await engine.startRun("dv-fail", runProfile("dv-fail", "dv-scn-fail", server.base), Array.from({ length: FAIL }), dirs, {}, scenario("dv-scn-fail", "dv-fail-flow"), [failFlow()]);
  await waitForSettled(engine, ["dv-ok", "dv-fail"], 15 * 60_000);
  await engine.persistDurableNow(); // explicit durable drain (not an arbitrary sleep)

  const okFailExecs = new Set(["dv-ok", "dv-fail"]);
  const liveOkFail = engine.getInstances().filter((i) => okFailExecs.has(i.executionId));
  const submitted = liveOkFail.length;
  const completedLive = liveOkFail.filter((i) => i.status === "completed").length;
  const failedLive = liveOkFail.filter((i) => i.status === "failed").length;
  const cancelledLive = liveOkFail.filter((i) => i.status === "cancelled").length;

  console.log(`\nPart A — live invariant (submitted = completed + failed + cancelled)`);
  check(`submitted === N + FAIL (${N + FAIL})`, submitted === N + FAIL, `submitted=${submitted}`);
  check("submitted === completed + failed + cancelled (live)", submitted === completedLive + failedLive + cancelledLive, `${submitted} vs ${completedLive}+${failedLive}+${cancelledLive}`);
  check("no unexpected cancellations in the OK/FAIL phase", cancelledLive === 0, `cancelled=${cancelledLive}`);
  check(`FAIL run actually produced failed runs (${FAIL})`, failedLive === FAIL, `failed=${failedLive}`);

  // ── Phase 2: reproduce the clamp + prove the pagination/aggregate fixes ───────────────────────
  console.log(`\nPart B — durable read paths (clamp reproduction vs pagination vs aggregate)`);
  const clamped = engine.getTelemetryRunHistory({}, { limit: 1_000_000, offset: 0 });
  const counts = engine.getTelemetryStatusCounts({});
  const allRows = readAllRunHistory(engine, {});
  check("aggregate total === submitted (every instance persisted)", counts.total === submitted, `aggregate=${counts.total} submitted=${submitted}`);
  check("single-page read is CLAMPED to 500 rows (the historical bug)", clamped.rows.length === Math.min(500, counts.total), `rows=${clamped.rows.length}`);
  check("clamped page.total is the UNBOUNDED count (would have been the correct number)", clamped.total === counts.total, `total=${clamped.total}`);
  if (counts.total > 500) {
    check("counting the clamped page UNDERCOUNTS vs reality (bug reproduced)", clamped.rows.length < counts.total, `${clamped.rows.length} < ${counts.total}`);
  } else {
    console.log(`  · (clamp not exercised: only ${counts.total} rows ≤ 500 — run with AWKIT_DURABLE_VERIFY_N>500 to reproduce the undercount)`);
  }
  check("pagination reads EVERY row", allRows.length === counts.total, `read=${allRows.length} total=${counts.total}`);

  const idList = allRows.map((r) => r.instanceId);
  const idSet = new Set(idList);
  check("no duplicate instanceIds across pages", idSet.size === idList.length, `unique=${idSet.size} rows=${idList.length}`);
  const liveIdSet = new Set(liveOkFail.map((i) => i.instanceId));
  const missing = [...liveIdSet].filter((id) => !idSet.has(id));
  check("no missing instanceIds (durable set === live dispatched set)", missing.length === 0, `missing=${missing.length}`);

  console.log(`\nPart C — durable per-status counts match live (no write loss / mislabel)`);
  check("durable success === live completed", counts.success === completedLive, `${counts.success} vs ${completedLive}`);
  check("durable failed === live failed", counts.failed === failedLive, `${counts.failed} vs ${failedLive}`);
  check("durable other === 0 (all OK/FAIL runs are terminal)", counts.other === 0, `other=${counts.other}`);

  // ── Phase 3: cross-process durability (reject the "teardown before flush" hypothesis) ────────
  console.log(`\nPart D — at-rest durability (reopen the SQLite file)`);
  const dbPath = join(root, "runtime", RUNTIME_DB_FILENAME);
  const reopened = await SqliteRuntimeStore.open(dbPath, () => undefined);
  const reopenedCounts = reopened.countRunsByStatus({});
  check("a fresh store reopened from disk sees every row", reopenedCounts.total === counts.total, `disk=${reopenedCounts.total} live=${counts.total}`);

  // ── Phase 4: retention is bounded + deterministic (documented) ───────────────────────────────
  console.log(`\nPart E — retention behaviour`);
  reopened.sweepRetention({ retentionHours: 24, retentionRuns: 5000 });
  check("default retention (5000) ≫ workload → nothing pruned", reopened.countRunsByStatus({}).total === counts.total, `after=${reopened.countRunsByStatus({}).total}`);
  const cap = 100;
  const expectedAfterCap = Math.min(counts.total, cap);
  reopened.sweepRetention({ retentionHours: 24, retentionRuns: cap });
  check(`retention cap is enforced deterministically (cap=${cap} → keep min(total,cap)=${expectedAfterCap})`, reopened.countRunsByStatus({}).total === expectedAfterCap, `after=${reopened.countRunsByStatus({}).total}`);
  await reopened.close();

  // ── Phase 5: cancellation — dispatched-cancelled runs persist as "cancelled" (not lost) ──────
  console.log(`\nPart F — cancellation accuracy`);
  await engine.startRun("dv-cancel", runProfile("dv-cancel", "dv-scn-cancel", server.base), Array.from({ length: CANCEL }), dirs, {}, buildScenario("waiting", buildFlow("waiting", server.base, 8000).id), [buildFlow("waiting", server.base, 8000)]);
  await sleep(4000); // let several dispatch and reach "running"
  engine.stopAll();
  await waitForSettled(engine, ["dv-cancel", "dv-ok", "dv-fail"], 3 * 60_000);
  await engine.persistDurableNow();

  const liveCancel = engine.getInstances().filter((i) => i.executionId === "dv-cancel");
  const cancelledLiveC = liveCancel.filter((i) => i.status === "cancelled").length;
  const allRows2 = readAllRunHistory(engine, {});
  const cancelRows = allRows2.filter((r) => r.executionId === "dv-cancel");
  const durableCancelledC = cancelRows.filter((r) => r.status === "cancelled").length;
  const cancelRowStatuses: Record<string, number> = {};
  for (const r of cancelRows) cancelRowStatuses[r.status] = (cancelRowStatuses[r.status] ?? 0) + 1;
  console.log(`  · dv-cancel: ${liveCancel.length} live (${cancelledLiveC} cancelled) → ${cancelRows.length} durable rows ${JSON.stringify(cancelRowStatuses)}`);
  const liveById = new Map(liveCancel.map((i) => [i.instanceId, i.status]));
  const everyCancelRowIsLive = cancelRows.every((r) => liveById.has(r.instanceId));
  const everyCancelRowTerminal = cancelRows.every((r) => TERMINAL.has(r.status));
  const durableCancelledAreCancelledLive = cancelRows.filter((r) => r.status === "cancelled").every((r) => liveById.get(r.instanceId) === "cancelled");

  check("cancel run: live invariant holds (all terminal)", liveCancel.length === liveCancel.filter((i) => TERMINAL.has(i.status)).length, `terminal=${liveCancel.filter((i) => TERMINAL.has(i.status)).length}/${liveCancel.length}`);
  check("every durable cancel row maps to a live instance (no phantom)", everyCancelRowIsLive);
  check("every dispatched-cancel row is TERMINAL (finally wrote a terminal status, not stale 'running')", everyCancelRowTerminal, JSON.stringify(cancelRowStatuses));
  check("dispatched-cancelled runs are durably recorded as 'cancelled' (not mislabeled)", durableCancelledAreCancelledLive && durableCancelledC > 0, `durableCancelled=${durableCancelledC}`);
  check("durable cancelled ⊆ live cancelled (pending-cancelled never dispatched → correctly no row)", durableCancelledC <= cancelledLiveC, `durable=${durableCancelledC} live=${cancelledLiveC}`);

  // ── Phase 6: final expected-vs-actual persisted across all three runs (race-free: row presence) ──
  console.log(`\nPart G — expected persisted === actual persisted (all runs)`);
  const allLive = engine.getInstances().filter((i) => ["dv-ok", "dv-fail", "dv-cancel"].includes(i.executionId));
  const finalRows = readAllRunHistory(engine, {});
  const durableById = new Map(finalRows.map((r) => [r.instanceId, r.status]));
  const liveIds = new Set(allLive.map((i) => i.instanceId));
  const submittedAll = allLive.length;
  const completedAll = allLive.filter((i) => i.status === "completed").length;
  const failedAll = allLive.filter((i) => i.status === "failed").length;
  const cancelledAll = allLive.filter((i) => i.status === "cancelled").length;
  // A durable row exists iff the instance dispatched. Presence-based (not status-based) → race-free.
  const completedWithRow = allLive.filter((i) => i.status === "completed" && durableById.has(i.instanceId)).length;
  const failedWithRow = allLive.filter((i) => i.status === "failed" && durableById.has(i.instanceId)).length;
  const dispatchedLive = allLive.filter((i) => durableById.has(i.instanceId)).length;
  const phantomRows = finalRows.filter((r) => !liveIds.has(r.instanceId));
  const finalCounts = engine.getTelemetryStatusCounts({});
  const actualPersisted = finalCounts.total;

  check("submitted (all) === completed + failed + cancelled (live)", submittedAll === completedAll + failedAll + cancelledAll, `${submittedAll} vs ${completedAll}+${failedAll}+${cancelledAll}`);
  check("every COMPLETED run is persisted (no completed lost)", completedWithRow === completedAll, `${completedWithRow}/${completedAll}`);
  check("every FAILED run is persisted (no failed lost)", failedWithRow === failedAll, `${failedWithRow}/${failedAll}`);
  check("no phantom durable rows (durable set ⊆ live set)", phantomRows.length === 0, `phantom=${phantomRows.length}`);
  check("actual persisted === dispatched live instances (expected)", actualPersisted === dispatchedLive, `actual=${actualPersisted} expected=${dispatchedLive}`);
  const expectedPersisted = dispatchedLive;

  // ── Result table ─────────────────────────────────────────────────────────────────────────────
  const table = {
    Submitted: submittedAll,
    Completed: completedAll,
    Failed: failedAll,
    Cancelled: cancelledAll,
    "Expected Persisted": expectedPersisted,
    "Actual Persisted": actualPersisted,
    "Clamped single-page rows": clamped.rows.length,
    "Aggregate total": finalCounts.total
  };
  console.log(`\n=== Durable accuracy result ===`);
  for (const [k, v] of Object.entries(table)) console.log(`  ${k.padEnd(26)} ${v}`);

  const artifactDir = join(process.cwd(), "reports", "browser-performance");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    join(artifactDir, "durable-accuracy.json"),
    JSON.stringify({ config: { N, FAIL, CANCEL, CONC }, table, byStatus: finalCounts.byStatus, checks: { passed, failed }, at: new Date().toISOString() }, null, 2),
    "utf8"
  );

  engine.stopAll();
  await engine.drainIdleSharedBrowsers().catch(() => undefined);
  server.server.close();
  await cleanupRoot(root);

  console.log(`\n${passed}/${passed + failed} durable-accuracy checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-durable-accuracy crashed:", error);
  process.exit(1);
});
