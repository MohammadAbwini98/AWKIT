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

// ── Hover-dependency: an explicit hover step is injected before the gated click (awkit-aui.5) ──
const hoverActions: RecordedAction[] = [
  {
    id: "h1",
    type: "click",
    name: "Click me",
    locator: {
      strategy: "role",
      value: "button",
      name: "Click me",
      exact: true,
      interaction: {
        requiresHover: true,
        hoverContainer: { strategy: "testId", value: "hover-trigger" }
      }
    }
  }
];
const hoverFlow = buildRecordedFlow("Hover", hoverActions);
const hIdx = hoverFlow.nodes.findIndex((n) => n.type === "hover");
const cIdx = hoverFlow.nodes.findIndex((n) => n.type === "click");
check("hover step is injected immediately before the gated click", hIdx >= 0 && hIdx === cIdx - 1);
const hStep = hoverFlow.nodes[hIdx];
check(
  "hover step carries the trigger locator, marked resolved",
  hStep?.locator?.strategy === "testId" && hStep?.locator?.value === "hover-trigger" && hStep?.locator?.resolution === "resolved"
);
check("hover step is NOT a copy of the click's own locator", hStep?.locator?.value !== "button");

// ── Drag actions map to a drag step carrying BOTH the source and drop-target locators ─────────
const dragFlow = buildRecordedFlow("Drag", [
  {
    id: "d1",
    type: "drag",
    name: "Drag Item A to Zone",
    locator: { strategy: "css", value: "#src" },
    targetLocator: { strategy: "css", value: "#zone" }
  } as RecordedAction
]);
const dragStep = dragFlow.nodes.find((n) => n.type === "drag");
check("drag action maps to a drag step", dragStep?.type === "drag");
check("drag step keeps the source locator (marked resolved)", dragStep?.locator?.value === "#src" && dragStep?.locator?.resolution === "resolved");
check("drag step carries the drop-target locator (marked resolved)", dragStep?.targetLocator?.value === "#zone" && dragStep?.targetLocator?.resolution === "resolved");
const dragRt = JSON.parse(JSON.stringify(dragFlow));
check("drag targetLocator survives JSON round-trip", dragRt.nodes.find((n: { type: string }) => n.type === "drag")?.targetLocator?.value === "#zone");
// Saving a flow is a full JSON serialize/deserialize — the injected hover node + its order must survive.
const hoverRT = JSON.parse(JSON.stringify(hoverFlow));
const hRtIdx = hoverRT.nodes.findIndex((n: { type: string }) => n.type === "hover");
const cRtIdx = hoverRT.nodes.findIndex((n: { type: string }) => n.type === "click");
check(
  "injected hover step survives JSON round-trip, still before the click",
  hRtIdx >= 0 && hRtIdx === cRtIdx - 1 && hoverRT.nodes[hRtIdx].locator.value === "hover-trigger"
);

// ── Hover-dependency: an unattributable trigger leaves the click needs-review, no fabricated step ──
const unresolvedActions: RecordedAction[] = [
  {
    id: "u1",
    type: "click",
    name: "Ambiguous",
    locator: { strategy: "role", value: "button", name: "Ambiguous", interaction: { requiresHover: true, hoverUnresolved: true } }
  }
];
const unresolvedFlow = buildRecordedFlow("Unresolved", unresolvedActions);
check("no hover step is fabricated when the trigger is unresolved", !unresolvedFlow.nodes.some((n) => n.type === "hover"));
const uClick = unresolvedFlow.nodes.find((n) => n.type === "click");
check("unresolved hover leaves the click needs-review", uClick?.locator?.resolution === "needs-review");
const uRT = JSON.parse(JSON.stringify(unresolvedFlow));
const uRtClick = uRT.nodes.find((n: { type: string }) => n.type === "click");
check("needs-review survives JSON round-trip", uRtClick?.locator?.resolution === "needs-review");

// ── Shadow context: explicit review/resolution and evidence survive build + JSON round-trip ──
const shadowActions: RecordedAction[] = [
  {
    id: "sh1",
    type: "click",
    name: "Click Select",
    locator: {
      strategy: "role",
      value: "button",
      name: "Select",
      quality: { strategy: "role", isUnique: true, matchCount: 1, visibleMatchCount: 1, confidence: "high", disambiguation: "shadow" },
      context: { shadow: { boundary: "open", hosts: [{ strategy: "testId", value: "product-card-2" }] } },
      interaction: { path: ["button", "product-card"], shadowBoundary: "open" },
      resolution: "resolved",
      resolvedBy: "recorder"
    }
  },
  {
    id: "sh2",
    type: "click",
    name: "Review closed host",
    locator: {
      strategy: "testId",
      value: "closed-host",
      context: { shadow: { boundary: "closed", hosts: [{ strategy: "testId", value: "closed-host" }] } },
      interaction: { path: ["closed-widget"], shadowBoundary: "closed" },
      resolution: "needs-review",
      resolvedBy: "recorder",
      reviewReason: "closed shadow root"
    }
  }
];
const shadowFlow = buildRecordedFlow("Shadow", shadowActions);
const shadowRT = JSON.parse(JSON.stringify(shadowFlow));
const openShadow = shadowRT.nodes.find((n: { name: string }) => n.name === "Click Select");
const closedShadow = shadowRT.nodes.find((n: { name: string }) => n.name === "Review closed host");
check("open shadow host chain survives build + JSON round-trip", openShadow?.locator?.context?.shadow?.hosts?.[0]?.value === "product-card-2");
check("shadow interaction evidence survives build + JSON round-trip", openShadow?.locator?.interaction?.shadowBoundary === "open" && openShadow?.locator?.interaction?.path?.[0] === "button");
check("explicit closed-shadow review state is not overwritten by buildRecordedFlow", closedShadow?.locator?.resolution === "needs-review" && closedShadow?.locator?.reviewReason === "closed shadow root");

// ── Duplicate Start/End from the recording are dropped ───────────────────────
const withDupes = buildRecordedFlow("Dupes", [
  { id: "s", type: "start", name: "Start" },
  { id: "c", type: "click", name: "Click" },
  { id: "e", type: "end", name: "End" }
]);
check("recorded start/end actions are not duplicated", withDupes.nodes.filter((n) => n.type === "start").length === 1 && withDupes.nodes.filter((n) => n.type === "end").length === 1);

/*
 * Pointer gestures survive conversion and a persistence round trip.
 *
 * Capture is proven in verify:recorder-competitive; this is the next link in the chain. A recorded
 * gesture is worthless if buildRecordedFlow drops it or flattens it back into a click, and worse if
 * a save/reload silently rewrites it — the user would see a double-click in the designer and get two
 * ordinary clicks at replay, which is precisely the failure the dedicated step types exist to stop.
 */
{
  const gestures = buildRecordedFlow("PointerGestures", [
    { id: "s", type: "goto", name: "Navigate", valueSource: { type: "static", value: "http://localhost/x" } },
    { id: "d", type: "dblclick", name: "Double click Target", locator: { strategy: "testId", value: "target" } },
    { id: "r", type: "contextMenu", name: "Right click Target", locator: { strategy: "testId", value: "target" } }
  ] as unknown as RecordedAction[]);

  const types = gestures.nodes.map((n) => n.type);
  check(
    "pointer gestures survive conversion with their own step types",
    types.includes("dblclick") && types.includes("contextMenu"),
    JSON.stringify(types)
  );
  check(
    "conversion does not flatten a double-click back into clicks",
    !types.includes("click"),
    JSON.stringify(types)
  );

  const dbl = gestures.nodes.find((n) => n.type === "dblclick");
  const ctx = gestures.nodes.find((n) => n.type === "contextMenu");
  check(
    "each pointer gesture keeps the locator it was recorded against",
    dbl?.locator?.value === "target" && ctx?.locator?.value === "target",
    JSON.stringify({ dbl: dbl?.locator?.value, ctx: ctx?.locator?.value })
  );

  // Round trip through the persisted form. JSON is what actually reaches disk, so serialising and
  // reparsing is the honest test of survival — an in-memory clone would prove nothing about storage.
  const reloaded = JSON.parse(JSON.stringify(gestures)) as typeof gestures;
  const reloadedTypes = reloaded.nodes.map((n) => n.type);
  check(
    "pointer gestures survive a save/reload round trip unchanged",
    JSON.stringify(reloadedTypes) === JSON.stringify(types),
    JSON.stringify(reloadedTypes)
  );

  // An older flow that predates these types must still load. The union grew; nothing was renamed.
  const legacy = buildRecordedFlow("LegacyClicks", [
    { id: "c1", type: "click", name: "Click A", locator: { strategy: "testId", value: "a" } },
    { id: "c2", type: "click", name: "Click A again", locator: { strategy: "testId", value: "a" } }
  ] as unknown as RecordedAction[]);
  check(
    "two ordinary clicks are still two clicks — conversion never invents a double-click",
    legacy.nodes.filter((n) => n.type === "click").length === 2 &&
      !legacy.nodes.some((n) => n.type === "dblclick"),
    JSON.stringify(legacy.nodes.map((n) => n.type))
  );

  /*
   * ── Hover prerequisite applies to EVERY pointer gesture, not just `click` ──────────────────
   *
   * Found by audit, not by a failing test: the hover-prerequisite branch was gated on
   * `step.type === "click"`, so a hover-gated double-click or right-click silently skipped BOTH of
   * its arms. The cost was two different bugs at once — no hover step was injected, so replay ran
   * against a still-hidden element; and an unpinnable trigger was reported as `resolved` rather
   * than `needs-review`, which is a false assurance rather than a missing warning.
   *
   * `click` is kept in the loop as the control: it is the path that always worked, so if these
   * assertions ever pass for click alone the gate has regressed to type-specific again.
   */
  for (const gesture of ["click", "dblclick", "contextMenu"] as const) {
    const gated = buildRecordedFlow("Gated", [
      {
        id: "g1",
        type: gesture,
        name: "Act",
        locator: {
          strategy: "testId",
          value: "row-act",
          interaction: { requiresHover: true, hoverContainer: { strategy: "testId", value: "row-trigger" } }
        }
      }
    ] as unknown as RecordedAction[]);
    const hoverIdx = gated.nodes.findIndex((n) => n.type === "hover");
    const gestureIdx = gated.nodes.findIndex((n) => n.type === gesture);
    check(
      `hover-gated ${gesture} gets an injected hover step immediately before it`,
      hoverIdx >= 0 && hoverIdx === gestureIdx - 1,
      JSON.stringify(gated.nodes.map((n) => n.type))
    );
    check(
      `the hover step injected for ${gesture} carries the TRIGGER locator, not the gesture's own`,
      gated.nodes[hoverIdx]?.locator?.value === "row-trigger",
      JSON.stringify(gated.nodes[hoverIdx]?.locator?.value)
    );

    const unresolved = buildRecordedFlow("Unresolved", [
      {
        id: "u1",
        type: gesture,
        name: "Act",
        locator: {
          strategy: "testId",
          value: "row-act",
          quality: { isUnique: true },
          interaction: {
            requiresHover: true,
            hoverUnresolved: true,
            hoverReviewReason: "trigger could not be pinned"
          }
        }
      }
    ] as unknown as RecordedAction[]);
    const step = unresolved.nodes.find((n) => n.type === gesture);
    check(
      `a hover-gated ${gesture} with no pinnable trigger is marked needs-review, never silently resolved`,
      step?.locator?.resolution === "needs-review" && !!step?.locator?.reviewReason,
      JSON.stringify({ resolution: step?.locator?.resolution, reason: step?.locator?.reviewReason })
    );
    check(
      `no hover step is fabricated for ${gesture} from the hidden target itself`,
      !unresolved.nodes.some((n) => n.type === "hover"),
      JSON.stringify(unresolved.nodes.map((n) => n.type))
    );
  }
}


// ── AWKIT-REC-042 — recorded wheel gestures map to runnable PAGE-level scroll nodes ──
{
  const flow = buildRecordedFlow("Scroll flow", [
    { id: "g1", type: "goto", name: "Open", valueSource: { type: "static", value: "https://example.com/list" } },
    {
      id: "s1",
      type: "scroll",
      name: "Scroll down 900",
      config: { scrollTarget: "page", scrollDirection: "down", scrollAmount: 900 }
    },
    { id: "c1", type: "click", name: "Load more", locator: { strategy: "testId", value: "lazy-item" } }
  ] as unknown as RecordedAction[]);
  const step = flow.nodes.find((n) => n.type === "scroll");
  results.push({ name: "REC-042 a recorded scroll becomes a scroll node", pass: Boolean(step && step.type === "scroll") });
  results.push({
    name: "REC-042 the mapped scroll node is PAGE-level with direction+amount",
    pass: step?.config?.scrollTarget === "page" && step?.config?.scrollDirection === "down" && step?.config?.scrollAmount === 900
  });
}

// ── AWKIT-REC-039 — the return-to-tab URL hint survives the mapping ──
{
  const flow = buildRecordedFlow("Hint flow", [
    { id: "rc", type: "routeChange", name: "Switch to tab: https://example.com/main", valueSource: { type: "static", value: "https://example.com/main" } }
  ] as unknown as RecordedAction[]);
  const step = flow.nodes.find((n) => n.type === "routeChange");
  results.push({ name: "REC-039 the routeChange step carries the recorded URL hint as its value", pass: step?.value === "https://example.com/main" });
}
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} recorder-flow checks passed`);
process.exit(passed === results.length ? 0 : 1);
