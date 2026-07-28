/**
 * Unit verification for the Concurrent Instance Monitor's non-DOM card logic
 * (filtering, responsive visible-count, per-card validation, workflow-name resolution).
 * Run with: npx tsx scripts/verify-instance-monitor.mts
 */
import {
  filterWorkflows,
  isInstanceStoppable,
  resolveWorkflowName,
  summarizeWorkflowRuns,
  validateCardParams,
  visibleCardCount
} from "@src/instances/instanceCardLogic";
import { compareElapsedToHistory } from "../app/renderer/components/instances/executionReportModel";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bisectCdpTrace,
  isObservationCommand,
  type CdpTraceRecord
} from "@src/runner/observation/PassiveCdpTrace";

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const workflows = [
  { name: "Mock Login Workflow", description: "Logs into the mock site" },
  { name: "Mock Route Change Workflow", description: "Opens a new tab" },
  { name: "Data Driven", description: "Runs per row" }
];

// ── filterWorkflows ────────────────────────────────────────────────────────────
console.log("filterWorkflows:");
check("empty query returns all", filterWorkflows(workflows, "").length === 3);
check("name match is case-insensitive", filterWorkflows(workflows, "LOGIN").length === 1);
check("matches partial name", filterWorkflows(workflows, "workflow").length === 2);
check("matches description", filterWorkflows(workflows, "new tab").length === 1);
check("whitespace-only query returns all", filterWorkflows(workflows, "   ").length === 3);
check("no match returns empty", filterWorkflows(workflows, "zzz").length === 0);

// ── visibleCardCount (rows × responsive columns) ────────────────────────────────
console.log("visibleCardCount:");
check("4 columns × 3 rows = 12", visibleCardCount(4, 3) === 12);
check("3 columns × 3 rows = 9", visibleCardCount(3, 3) === 9);
check("2 columns × 3 rows = 6", visibleCardCount(2, 3) === 6);
check("Load More adds 2 rows (4 cols × 5 rows = 20)", visibleCardCount(4, 5) === 20);
check("columns < 1 clamps to 1", visibleCardCount(0, 3) === 3);

// ── validateCardParams ──────────────────────────────────────────────────────────
console.log("validateCardParams:");
const limits = { maxRuns: 100, maxConcurrentRuns: 10 };
check("valid params pass", validateCardParams({ totalRuns: 5, concurrentInstances: 2 }, limits, false, false).length === 0);
check("totalRuns < 1 fails", validateCardParams({ totalRuns: 0, concurrentInstances: 1 }, limits, false, false).length > 0);
check("concurrent < 1 fails", validateCardParams({ totalRuns: 5, concurrentInstances: 0 }, limits, false, false).length > 0);
check(
  "concurrent > total fails",
  validateCardParams({ totalRuns: 3, concurrentInstances: 5 }, limits, false, false).some((m) => m.includes("exceed total"))
);
check(
  "totalRuns over max fails",
  validateCardParams({ totalRuns: 200, concurrentInstances: 2 }, limits, false, false).some((m) => m.includes("100"))
);
check(
  "concurrent over max fails",
  validateCardParams({ totalRuns: 50, concurrentInstances: 20 }, limits, false, false).some((m) => m.includes("10"))
);
check(
  "missing required data source fails",
  validateCardParams({ totalRuns: 5, concurrentInstances: 2 }, limits, true, false).some((m) => m.includes("data source"))
);
check("present required data source passes", validateCardParams({ totalRuns: 5, concurrentInstances: 2 }, limits, true, true).length === 0);

// ── resolveWorkflowName ─────────────────────────────────────────────────────────
console.log("resolveWorkflowName:");
const nameById = new Map<string, string>([["wf-1", "Mock Login Workflow"]]);
check("known id resolves name", resolveWorkflowName(nameById, "wf-1").name === "Mock Login Workflow" && !resolveWorkflowName(nameById, "wf-1").missing);
check("missing id → Deleted workflow", resolveWorkflowName(nameById, "wf-x").name === "Deleted workflow" && resolveWorkflowName(nameById, "wf-x").missing);
check("empty id → Unknown workflow", resolveWorkflowName(nameById, "").name === "Unknown workflow");

// ── workflow run summaries + stop eligibility ────────────────────────────────
console.log("workflow run summaries:");
const runSummaries = summarizeWorkflowRuns([
  { executionId: "exec-active", scenarioId: "wf-1", status: "running", startedAt: "2026-07-12T10:00:00.000Z", durationMs: 5000 },
  { executionId: "exec-active", scenarioId: "wf-1", status: "queued", durationMs: 0 },
  { executionId: "exec-active", scenarioId: "wf-1", status: "completed", startedAt: "2026-07-12T10:00:00.000Z", endedAt: "2026-07-12T10:00:04.000Z", durationMs: 4000 },
  { executionId: "exec-done", scenarioId: "wf-1", status: "completed", startedAt: "2026-07-12T09:00:00.000Z", endedAt: "2026-07-12T09:00:03.000Z", durationMs: 3000 },
  { executionId: "exec-done", scenarioId: "wf-1", status: "failed", startedAt: "2026-07-12T09:00:00.000Z", endedAt: "2026-07-12T09:00:02.000Z", durationMs: 2000 },
  { executionId: "exec-paused", scenarioId: "wf-2", status: "waitingForManualAction", startedAt: "2026-07-12T11:00:00.000Z", durationMs: 1000 }
]);
check("groups records by execution id", runSummaries.length === 3);
check("active workflow executions sort ahead of terminal history", runSummaries.slice(0, 2).every((summary) => ["running", "attention"].includes(summary.status)) && runSummaries[2].executionId === "exec-done");
const activeSummary = runSummaries.find((summary) => summary.executionId === "exec-active");
check("active summary counts running, pending, and completed", activeSummary?.running === 1 && activeSummary.pending === 1 && activeSummary.completed === 1);
check("active summary progress is terminal / total", activeSummary?.progressPercent === 33);
check("separate runs of the same workflow stay distinct", runSummaries.filter((summary) => summary.scenarioId === "wf-1").length === 2);
check("manual handoff is summarized as needs-attention", runSummaries.find((summary) => summary.executionId === "exec-paused")?.status === "attention");
check("mixed completed/failed run preserves failure count", runSummaries.find((summary) => summary.executionId === "exec-done")?.failed === 1);

console.log("stop eligibility:");
check("pending instance can be stopped", isInstanceStoppable("pending"));
check("queued instance can be stopped", isInstanceStoppable("queued"));
check("running instance can be stopped", isInstanceStoppable("running"));
check("manual-action instance can be stopped", isInstanceStoppable("waitingForManualAction"));
check("completed instance cannot be stopped", !isInstanceStoppable("completed"));
check("already-stopping instance is not offered again", !isInstanceStoppable("stopping"));

// ── B4: live-vs-history comparison (compareElapsedToHistory) ─────────────────────
console.log("live-vs-history comparison:");
const base = { avgMs: 10_000, p95Ms: 16_000, runs: 5, machineScoped: true };
check("no baseline → undefined", compareElapsedToHistory(5000, undefined, true) === undefined);
check("zero-avg baseline → undefined", compareElapsedToHistory(5000, { runs: 0, machineScoped: false, avgMs: 0 }, true) === undefined);
check("no elapsed → undefined", compareElapsedToHistory(undefined, base, true) === undefined);
check("live under avg → progress toward avg (neutral)", (() => { const r = compareElapsedToHistory(5000, base, true); return r?.tone === "neutral" && r.label === "at 50% of avg"; })());
check("live over avg → behind", (() => { const r = compareElapsedToHistory(13_000, base, true); return r?.tone === "behind" && r.label === "30% over avg"; })());
check("finished faster → ahead", (() => { const r = compareElapsedToHistory(8000, base, false); return r?.tone === "ahead" && r.label === "20% faster than avg"; })());
check("finished slower → behind", (() => { const r = compareElapsedToHistory(12_000, base, false); return r?.tone === "behind" && r.label === "20% slower than avg"; })());
check("finished within ±5% → about average (neutral)", (() => { const r = compareElapsedToHistory(10_200, base, false); return r?.tone === "neutral" && r.label === "about average"; })());

async function verifyPassiveObservationModel(): Promise<void> {
  console.log("passive observation model:");
  check("observation allowlist contains read-only capture", isObservationCommand("Page.captureScreenshot"));
  check("observation allowlist rejects mouse actions", !isObservationCommand("Input.dispatchMouseEvent"));
  check("observation allowlist rejects script injection", !isObservationCommand("Page.addScriptToEvaluateOnNewDocument"));

  const root = await mkdtemp(join(tmpdir(), "wfs-cdp-bisect-"));
  const cdpRoot = join(root, "cdp");
  await mkdir(cdpRoot, { recursive: true });
  const record = (
    method: string,
    pageId: string,
    wallTimeMs: number,
    params: Record<string, unknown> = {}
  ): CdpTraceRecord => ({
    receivedAt: new Date(wallTimeMs).toISOString(),
    wallTimeMs,
    method,
    params,
    generation: 1,
    pageId
  });
  const records: CdpTraceRecord[] = [
    record("Network.requestWillBeSent", "page-a", 1, { type: "Document" }),
    record("Page.frameNavigated", "page-a", 2, { frame: { id: "main-a", parentId: null } }),
    record("Page.frameNavigated", "page-a", 3, { frame: { id: "child-a", parentId: "main-a" } }),
    record("Runtime.consoleAPICalled", "page-a", 4, { type: "log" }),
    record("Page.frameNavigated", "page-a", 5, { frame: { id: "main-a-2", parentId: "" } }),
    record("Network.responseReceived", "page-a", 6, { type: "Document" }),
    record("Log.entryAdded", "page-b", 7, { entry: { level: "warning" } }),
    record("Page.frameNavigated", "page-b", 8, { frame: { id: "main-b" } })
  ];
  await writeFile(
    join(cdpRoot, "raw.ndjson"),
    `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8"
  );

  const summary = await bisectCdpTrace(root);
  check("bisection keeps every raw event", summary.eventCount === records.length, JSON.stringify(summary));
  check("pre-navigation events clamp to page zero", summary.pages[0]?.eventCount === 4, JSON.stringify(summary.pages));
  check("iframe navigation does not create a page boundary", summary.pages.length === 3, JSON.stringify(summary.pages));
  check("empty-string parentId creates a new top-level page slice", summary.pages[1]?.eventCount === 2, JSON.stringify(summary.pages));
  check("a second CDP target gets its own page slice", summary.pages[2]?.eventCount === 2, JSON.stringify(summary.pages));
  check(
    "Runtime.consoleAPICalled is remapped into the console bucket",
    summary.buckets["console/logs"] === 1,
    JSON.stringify(summary.buckets)
  );

  const expectedBuckets = [
    "network/requests",
    "network/responses",
    "network/finished",
    "network/failed",
    "network/websocket",
    "console/logs",
    "console/exceptions",
    "runtime/all",
    "log/entries",
    "page/navigations",
    "page/lifecycle",
    "page/dialogs",
    "page/frames",
    "page/all",
    "dom/all",
    "target/attached",
    "target/detached"
  ];
  const bucketExists = await Promise.all(
    expectedBuckets.map((bucket) =>
      stat(join(cdpRoot, `${bucket}.jsonl`))
        .then(() => true)
        .catch(() => false)
    )
  );
  check("all 17 session buckets exist, including empty buckets", bucketExists.every(Boolean));
  check(
    "empty per-page buckets are omitted",
    !(await stat(join(cdpRoot, "pages", "p0", "network", "responses.jsonl"))
      .then(() => true)
      .catch(() => false))
  );

  const firstSummary = await readFile(join(root, "summary.json"), "utf8");
  await bisectCdpTrace(root);
  const secondSummary = await readFile(join(root, "summary.json"), "utf8");
  check("bisection is idempotent", firstSummary === secondSummary);
  await rm(root, { recursive: true, force: true });
}

verifyPassiveObservationModel()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
