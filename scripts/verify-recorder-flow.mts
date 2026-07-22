// Verifies recorder flow generation (Points 1 & 2): recorded sessions always produce a flow with
// default Start and End nodes, with actions wired between them, waits replayed as fixed-time steps,
// and tab switches replayed as Route Change. Pure logic — no browser, no I/O.
//
// Run: npm run verify:recorder-flow
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import type { RecordedAction } from "@src/recorder/RecorderTypes";

const results: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  results.push({ name, pass });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── Empty recording still yields Start → End ─────────────────────────────────
const empty = buildRecordedFlow("Empty", []);
check("empty recording has exactly Start + End nodes", empty.nodes.length === 2 && empty.nodes[0].type === "start" && empty.nodes[1].type === "end");
check("empty recording connects Start → End", empty.edges.length === 1 && empty.edges[0].source === "start" && empty.edges[0].target === "end");

// ── A typical recording with actions, a wait, and a tab switch ───────────────
const actions: RecordedAction[] = [
  { id: "a1", type: "goto", name: "Navigate", valueSource: { type: "static", value: "https://example.com" } },
  { id: "a2", type: "wait", name: "Wait 1.5s", waitMs: 1500 },
  { id: "a3", type: "click", name: "Click Login", locator: { strategy: "role", value: "button", name: "Login", exact: true } },
  { id: "a4", type: "routeChange", name: "Switch to tab", valueSource: { type: "static", value: "https://example.com/next" } }
];
const flow = buildRecordedFlow("Recorded", actions);
const first = flow.nodes[0];
const last = flow.nodes[flow.nodes.length - 1];

check("first node is Start", first.type === "start");
check("last node is End", last.type === "end");
check("action nodes sit between Start and End", flow.nodes.length === actions.length + 2);

const startEdge = flow.edges.find((e) => e.source === "start");
check("Start connects to the first action", startEdge?.target === "step-1" && startEdge?.type === "always");
const endEdge = flow.edges.find((e) => e.target === "end");
check("last action connects to End", endEdge?.source === `step-${actions.length}`);
check("every node except End has an outgoing edge", flow.nodes.slice(0, -1).every((n) => flow.edges.some((e) => e.source === n.id)));
check("every node except Start has an incoming edge", flow.nodes.slice(1).every((n) => flow.edges.some((e) => e.target === n.id)));

const waitStep = flow.nodes.find((n) => n.id === "step-2");
check("recorded wait becomes a fixed-time wait step", waitStep?.type === "wait" && waitStep?.config?.waitType === "time" && waitStep?.timeoutMs === 1500);

const routeStep = flow.nodes.find((n) => n.id === "step-4");
check("recorded tab switch becomes a Route Change", routeStep?.type === "routeChange" && routeStep?.config?.routeMode === "switchToLatestTab");

const clickStep = flow.nodes.find((n) => n.id === "step-3");
check("locator (with exact) is preserved on the click step", clickStep?.locator?.value === "button" && clickStep?.locator?.exact === true);

// ── Async activity waits (response + adaptive timeout) survive save round-trip ───
const asyncActions: RecordedAction[] = [
  {
    id: "b1",
    type: "click",
    name: "Submit order",
    locator: { strategy: "role", value: "button", name: "Submit" },
    afterWaits: [
      { type: "response", method: "POST", urlContains: "/api/orders", statusRange: [200, 299], armBeforeAction: true, timeoutMs: 29000, reason: "POST /api/orders completed in 8000ms after the action" },
      { type: "loaderHidden", locator: { strategy: "css", value: ".order-spinner" }, timeoutMs: 29000 }
    ]
  }
];
const asyncFlow = buildRecordedFlow("Async", asyncActions);
const asyncStep = asyncFlow.nodes.find((n) => n.id === "step-1");
check("async afterWaits are preserved on the step", (asyncStep?.afterWaits?.length ?? 0) === 2);
const respWait = asyncStep?.afterWaits?.find((w) => w.type === "response") as { statusRange?: [number, number]; armBeforeAction?: boolean; timeoutMs?: number } | undefined;
check("response wait keeps statusRange + armBeforeAction + adaptive timeoutMs", respWait?.statusRange?.[1] === 299 && respWait?.armBeforeAction === true && respWait?.timeoutMs === 29000);
// Full JSON serialize/deserialize (what saving a flow does) must not drop any async field.
const roundTripped = JSON.parse(JSON.stringify(asyncFlow));
const rtStep = roundTripped.nodes.find((n: { id: string }) => n.id === "step-1");
const rtResp = rtStep?.afterWaits?.find((w: { type: string }) => w.type === "response");
check("async waits survive JSON save round-trip (no silent drop)", rtStep?.afterWaits?.length === 2 && rtResp?.timeoutMs === 29000 && rtResp?.statusRange?.[0] === 200);

// ── Loader lifecycle + completionMode + optional survive round-trip (awkit-62o) ──
const lifecycleActions: RecordedAction[] = [
  {
    id: "c1",
    type: "click",
    name: "Search",
    locator: { strategy: "role", value: "button", name: "Search" },
    afterWaits: [
      { type: "loaderHidden", locator: { strategy: "css", value: ".spinner" }, appearanceGraceMs: 1500, mustAppear: false, completion: "hidden", timeoutMs: 29000 },
      { type: "response", method: "GET", urlContains: "/api/search", statusRange: [200, 299], armBeforeAction: true, optional: true, timeoutMs: 20000 }
    ]
  }
];
const lifecycleFlow = buildRecordedFlow("Lifecycle", lifecycleActions);
const lcStep = lifecycleFlow.nodes.find((n) => n.id === "step-1");
// A completion policy is a step-level property (set in the designer); prove it round-trips on FlowStep.
if (lcStep) lcStep.completionMode = "networkThenUi";
const lcRT = JSON.parse(JSON.stringify(lifecycleFlow));
const lcRtStep = lcRT.nodes.find((n: { id: string }) => n.id === "step-1");
const lcLoader = lcRtStep?.afterWaits?.find((w: { type: string }) => w.type === "loaderHidden");
const lcResp = lcRtStep?.afterWaits?.find((w: { type: string }) => w.type === "response");
check("loader lifecycle fields survive round-trip", lcLoader?.appearanceGraceMs === 1500 && lcLoader?.mustAppear === false && lcLoader?.completion === "hidden");
check("optional flag survives round-trip", lcResp?.optional === true);
check("completionMode survives round-trip", lcRtStep?.completionMode === "networkThenUi");

// ── Duplicate Start/End from the recording are dropped ───────────────────────
const withDupes = buildRecordedFlow("Dupes", [
  { id: "s", type: "start", name: "Start" },
  { id: "c", type: "click", name: "Click" },
  { id: "e", type: "end", name: "End" }
]);
check("recorded start/end actions are not duplicated", withDupes.nodes.filter((n) => n.type === "start").length === 1 && withDupes.nodes.filter((n) => n.type === "end").length === 1);

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} recorder-flow checks passed`);
process.exit(passed === results.length ? 0 : 1);
