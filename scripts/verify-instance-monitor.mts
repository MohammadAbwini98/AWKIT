/**
 * Unit verification for the Concurrent Instance Monitor's non-DOM card logic
 * (filtering, responsive visible-count, per-card validation, workflow-name resolution).
 * Run with: npx tsx scripts/verify-instance-monitor.mts
 */
import {
  filterWorkflows,
  resolveWorkflowName,
  validateCardParams,
  visibleCardCount
} from "@src/instances/instanceCardLogic";

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
