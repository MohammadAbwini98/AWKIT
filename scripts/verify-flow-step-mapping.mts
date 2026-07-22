/**
 * Serialization round-trip verifier for the Flow Designer's model <-> node-data conversion.
 *
 * This imports the REAL production functions from
 * `app/renderer/components/workflow/flowStepMapping.ts` — the same `toFlowStep` / `fromFlowStep`
 * that `FlowChartDesigner.tsx` calls on save and load. There is no re-implemented or copied
 * conversion logic in this file; if the designer's behavior changes, these checks change with it.
 *
 * Why this exists: this converter pair is the only place a saved `FlowStep` becomes designer node
 * data and back, so a silently dropped field here corrupts a saved flow with no error. The JSON
 * store is field-agnostic (JSON.stringify/parse, no allowlist) and therefore cannot lose a field —
 * this layer can.
 *
 * Detects: dropped fields, changed values, wrong defaults, required/optional flags flipping,
 * timeouts recalculated on load, condition reordering, and legacy flows gaining incompatible fields.
 */
import { fromFlowStep, toFlowStep, type FlowDesignerNode } from "../app/renderer/components/workflow/flowStepMapping";
import type { FlowStep, WaitCondition } from "../src/profiles/FlowProfile";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Wrap a step in the node shape `toFlowStep` expects, mirroring what the designer builds. */
function nodeFor(step: FlowStep): FlowDesignerNode {
  return {
    id: step.id,
    type: "action",
    position: step.position ?? { x: 0, y: 0 },
    data: fromFlowStep(step)
  } as FlowDesignerNode;
}

/** One full model → designer → model cycle through the real converters. */
function cycle(step: FlowStep): FlowStep {
  return toFlowStep(nodeFor(step), []);
}

/** Run N cycles to expose gradual field loss that a single round trip would hide. */
function cycleN(step: FlowStep, times: number): FlowStep {
  let current = step;
  for (let i = 0; i < times; i += 1) current = cycle(current);
  return current;
}

const json = (value: unknown) => JSON.stringify(value);

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: one per supported WaitCondition variant, with representative fields.
// ─────────────────────────────────────────────────────────────────────────────
const loc = (value: string) => ({ strategy: "css" as const, value });

const WAIT_FIXTURES: Record<string, WaitCondition> = {
  loaderHidden: {
    type: "loaderHidden",
    locator: loc(".spinner"),
    appearanceGraceMs: 1500,
    mustAppear: true,
    completion: "ariaBusyFalse",
    optional: false,
    timeoutMs: 29000,
    reason: "recorded loader"
  },
  elementVisible: { type: "elementVisible", locator: loc("#done"), timeoutMs: 12000 },
  elementHidden: { type: "elementHidden", locator: loc("#overlay"), optional: true },
  elementEnabled: { type: "elementEnabled", locator: loc("#submit"), timeoutMs: 8000 },
  textVisible: { type: "textVisible", text: "Saved", exact: true, timeoutMs: 7000 },
  toastVisible: { type: "toastVisible", locator: loc(".toast"), text: "Done", timeoutMs: 6000 },
  response: {
    type: "response",
    method: "POST",
    urlContains: "/api/submit",
    statusRange: [200, 299],
    armBeforeAction: true,
    optional: true,
    timeoutMs: 20000
  },
  tableHasRows: { type: "tableHasRows", tableLocator: loc("#results"), rowLocator: loc("tbody tr"), minRows: 3, timeoutMs: 15000 },
  listHasItems: { type: "listHasItems", listLocator: loc("#list"), itemLocator: loc("li"), minItems: 2, timeoutMs: 15000 },
  urlChanged: { type: "urlChanged", fromUrl: "https://app.local/a", urlContains: "/b", timeoutMs: 9000 },
  domStable: { type: "domStable", stableForMs: 750, timeoutMs: 11000 },
  fixedDelay: { type: "fixedDelay", delayMs: 250 }
};

const baseStep = (over: Partial<FlowStep> = {}): FlowStep =>
  ({
    id: "step-1",
    type: "click",
    name: "Submit",
    position: { x: 10, y: 20 },
    ...over
  }) as FlowStep;

console.log("Every WaitCondition variant survives a round trip:");
for (const [name, wait] of Object.entries(WAIT_FIXTURES)) {
  const out = cycle(baseStep({ afterWaits: [wait] }));
  check(`${name} round-trips byte-identically`, json(out.afterWaits?.[0]) === json(wait), `got ${json(out.afterWaits?.[0])}`);
}

console.log("\nbeforeWaits and afterWaits:");
{
  const before = [WAIT_FIXTURES.elementEnabled, WAIT_FIXTURES.domStable];
  const after = [WAIT_FIXTURES.response, WAIT_FIXTURES.loaderHidden, WAIT_FIXTURES.textVisible];
  const out = cycle(baseStep({ beforeWaits: before, afterWaits: after }));
  check("beforeWaits preserved", json(out.beforeWaits) === json(before));
  check("afterWaits preserved", json(out.afterWaits) === json(after));
  // Order is meaningful: networkThenUi runs responses, then loaders, then UI outcomes.
  check("afterWaits ORDER is preserved", (out.afterWaits ?? []).map((w) => w.type).join(",") === "response,loaderHidden,textVisible");
}

console.log("\nResponse wait detail (method / URL / status range / arming / adaptive timeout):");
{
  const wait = WAIT_FIXTURES.response as Extract<WaitCondition, { type: "response" }>;
  const out = cycle(baseStep({ afterWaits: [wait] }));
  const rt = out.afterWaits?.[0] as Extract<WaitCondition, { type: "response" }>;
  check("method preserved", rt.method === "POST", String(rt.method));
  check("urlContains preserved", rt.urlContains === "/api/submit", String(rt.urlContains));
  check("statusRange preserved", json(rt.statusRange) === json([200, 299]), json(rt.statusRange));
  check("armBeforeAction preserved", rt.armBeforeAction === true, String(rt.armBeforeAction));
  check("optional:true preserved", rt.optional === true, String(rt.optional));
  // The adaptive timeout is computed once at RECORD time; load must never recompute it.
  check("adaptive timeout is NOT recalculated on load", rt.timeoutMs === 20000, String(rt.timeoutMs));
}

console.log("\nLoader lifecycle detail:");
{
  const out = cycle(baseStep({ afterWaits: [WAIT_FIXTURES.loaderHidden] }));
  const rt = out.afterWaits?.[0] as Extract<WaitCondition, { type: "loaderHidden" }>;
  check("appearanceGraceMs preserved", rt.appearanceGraceMs === 1500, String(rt.appearanceGraceMs));
  check("mustAppear preserved", rt.mustAppear === true, String(rt.mustAppear));
  check("completion signal preserved", rt.completion === "ariaBusyFalse", String(rt.completion));
  check("reason preserved", rt.reason === "recorded loader", String(rt.reason));
  // optional:false is FALSY — the classic silent-drop bug.
  check("optional:false preserved (not dropped as falsy)", rt.optional === false, String(rt.optional));
}

console.log("\nRequired/optional flags never flip:");
{
  const waits: WaitCondition[] = [
    { type: "textVisible", text: "A", optional: true },
    { type: "textVisible", text: "B", optional: false },
    { type: "textVisible", text: "C" } // absent = required
  ];
  const out = cycle(baseStep({ afterWaits: waits }));
  const flags = (out.afterWaits ?? []).map((w) => w.optional);
  check("optional true/false/absent all preserved exactly", json(flags) === json([true, false, undefined]), json(flags));
}

console.log("\nCompletion policy (awkit-62o):");
for (const mode of ["allRequired", "anyRequired", "networkThenUi", "quietPeriod"] as const) {
  const out = cycle(baseStep({ afterWaits: [WAIT_FIXTURES.response], completionMode: mode }));
  check(`completionMode "${mode}" preserved`, out.completionMode === mode, String(out.completionMode));
}
{
  const out = cycle(baseStep({ afterWaits: [WAIT_FIXTURES.response] }));
  check("absent completionMode stays absent (no default injected)", out.completionMode === undefined, String(out.completionMode));
}

console.log("\nUI outcome conditions and valid empty results:");
{
  // The designer's "+ UI outcome" scaffold is textVisible with an EMPTY string.
  const scaffold: WaitCondition = { type: "textVisible", text: "" };
  const out = cycle(baseStep({ afterWaits: [scaffold] }));
  const rt = out.afterWaits?.[0] as Extract<WaitCondition, { type: "textVisible" }>;
  check("UI outcome scaffold with empty text survives (falsy not dropped)", rt?.type === "textVisible" && rt.text === "", json(rt));

  // An explicitly-configured empty expectation must keep its zero.
  const zeroRows: WaitCondition = { type: "tableHasRows", tableLocator: loc("#results"), minRows: 0 };
  const zeroOut = cycle(baseStep({ afterWaits: [zeroRows] }));
  const zeroRt = zeroOut.afterWaits?.[0] as Extract<WaitCondition, { type: "tableHasRows" }>;
  check("tableHasRows minRows:0 preserved (falsy zero not dropped)", zeroRt?.minRows === 0, String(zeroRt?.minRows));

  const zeroItems: WaitCondition = { type: "listHasItems", listLocator: loc("#list"), minItems: 0 };
  const itemsRt = cycle(baseStep({ afterWaits: [zeroItems] })).afterWaits?.[0] as Extract<WaitCondition, { type: "listHasItems" }>;
  check("listHasItems minItems:0 preserved", itemsRt?.minItems === 0, String(itemsRt?.minItems));

  // Empty-state outcome paired with an API success (the configurable half of the empty contract).
  const pair: WaitCondition[] = [WAIT_FIXTURES.response, { type: "elementVisible", locator: loc("[data-testid=empty-state]") }];
  const pairOut = cycle(baseStep({ afterWaits: pair, completionMode: "networkThenUi" }));
  check("API + empty-state outcome pair round-trips", json(pairOut.afterWaits) === json(pair) && pairOut.completionMode === "networkThenUi");
}

console.log("\nLegacy steps (no async fields) gain nothing incompatible:");
{
  // Realistic legacy shape: every current producer emits `value` together with `valueSource`.
  const legacy = baseStep({ type: "fill", name: "Username", value: "alice", valueSource: { type: "static", value: "alice" } });
  const out = cycle(legacy);
  check("legacy step gains no beforeWaits", out.beforeWaits === undefined, json(out.beforeWaits));
  check("legacy step gains no afterWaits", out.afterWaits === undefined, json(out.afterWaits));
  check("legacy step gains no completionMode", out.completionMode === undefined, String(out.completionMode));
  check("legacy value preserved when valueSource is present", out.value === "alice", String(out.value));
  check("legacy valueSource preserved", json(out.valueSource) === json({ type: "static", value: "alice" }), json(out.valueSource));
  // Empty wait arrays must serialize back to undefined, not [] — otherwise every legacy flow grows fields.
  const emptyArrays = cycle(baseStep({ beforeWaits: [], afterWaits: [] }));
  check("empty wait arrays normalize to undefined (no field growth)", emptyArrays.beforeWaits === undefined && emptyArrays.afterWaits === undefined);
}

console.log("\nKNOWN DEFECT (pinned, see bead awkit-cxa) — bare `value` with no `valueSource`:");
{
  // `fromFlowStep` derives node value from `step.url ?? valueSource?.…` and NEVER reads `step.value`,
  // so a step carrying only `value` loses it on the first designer open+save. This is real and
  // reachable: resources/test-fixtures/mock-site/flows/mock-conditional-flow.json ships a `condition`
  // node whose expression is stored exactly this way.
  //
  // These assertions PIN the current (defective) behavior so the suite is honest and green. Fixing it
  // is a runtime behavior change and is deliberately OUT OF SCOPE for the hardening phase. When the
  // fix lands, these two checks are expected to fail and must be inverted.
  const bare = baseStep({ type: "condition", name: "Check Path", value: "${runtimeInputs.path} === 'A'" });
  const out = cycle(bare);
  check("PINNED: bare `value` is currently LOST (defect, not aspiration)", out.value === undefined, `got ${json(out.value)}`);
  check("PINNED: no valueSource is fabricated to compensate", out.valueSource === undefined, json(out.valueSource));
}

console.log("\nBackward-compatible defaults for missing optional properties:");
{
  const minimal = { id: "s", type: "click", name: "Bare" } as FlowStep;
  const data = fromFlowStep(minimal);
  check("missing timeoutMs defaults to 10000", data.timeoutMs === 10000, String(data.timeoutMs));
  check("missing retry defaults to 0 / 1000", data.retryCount === 0 && data.retryDelayMs === 1000);
  check("missing onFailure defaults to stop + screenshot", data.failureAction === "stop" && data.screenshotOnFailure === true);
  check("missing waits default to empty arrays in node data", Array.isArray(data.beforeWaits) && data.beforeWaits.length === 0 && Array.isArray(data.afterWaits));
  check("missing completionMode stays undefined in node data", data.completionMode === undefined, String(data.completionMode));
}

console.log("\nMultiple cycles (gradual field loss):");
{
  const rich = baseStep({
    beforeWaits: [WAIT_FIXTURES.elementEnabled],
    afterWaits: [WAIT_FIXTURES.response, WAIT_FIXTURES.loaderHidden, WAIT_FIXTURES.tableHasRows],
    completionMode: "networkThenUi",
    timeoutMs: 25000
  });
  const once = cycle(rich);
  const twice = cycleN(rich, 2);
  const thrice = cycleN(rich, 3);
  check("cycle 1 == cycle 2 (stable, no drift)", json(once) === json(twice));
  check("cycle 2 == cycle 3 (stable, no drift)", json(twice) === json(thrice));
  check("waits still complete after 3 cycles", (thrice.afterWaits ?? []).length === 3 && (thrice.beforeWaits ?? []).length === 1);
  check("completionMode still set after 3 cycles", thrice.completionMode === "networkThenUi");
  check("step timeoutMs not recalculated across cycles", thrice.timeoutMs === 25000, String(thrice.timeoutMs));
}

console.log("\nClone and edit round trips:");
{
  const original = baseStep({
    afterWaits: [WAIT_FIXTURES.response, WAIT_FIXTURES.loaderHidden],
    completionMode: "anyRequired"
  });
  // Clone: the store shallow-spreads a new id, then the designer reopens it.
  const cloned = cycle({ ...cycle(original), id: "step-1-copy" } as FlowStep);
  check("clone keeps every async field", json(cloned.afterWaits) === json(original.afterWaits) && cloned.completionMode === "anyRequired");
  check("clone keeps the new id", cloned.id === "step-1-copy", cloned.id);

  // Edit: mutate node data as the properties panel does, then convert back.
  const data = fromFlowStep(original);
  const edited = toFlowStep(
    { id: original.id, type: "action", position: { x: 0, y: 0 }, data: { ...data, name: "Renamed", timeoutMs: 44000 } } as FlowDesignerNode,
    []
  );
  check("edit preserves untouched async fields", json(edited.afterWaits) === json(original.afterWaits));
  check("edit applies the intended change", edited.name === "Renamed" && edited.timeoutMs === 44000);
  check("edit preserves completionMode", edited.completionMode === "anyRequired");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
