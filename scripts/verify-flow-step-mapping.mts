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
import { fromFlowStep, toFlowStep, type FlowDesignerNode, type FlowDesignerEdge } from "../app/renderer/components/workflow/flowStepMapping";
import {
  fromFlowStep as fromProductionFlowStep,
  toFlowStep as toProductionFlowStep
} from "../app/renderer/components/workflow/flowProfileMapping";
import { getNodeDefinition } from "../app/renderer/components/workflow/flowNodeRegistry";
import { readFile } from "node:fs/promises";
import type { FlowProfile, FlowStep, ValueSource, WaitCondition } from "../src/profiles/FlowProfile";
import { createLocatorApprovalBinding } from "../src/profiles/locatorApproval";

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

/** One cycle through FlowChartDesigner's actual superset mapping module. */
function productionCycle(step: FlowStep): FlowStep {
  const node = {
    id: step.id,
    type: "action",
    position: step.position ?? { x: 0, y: 0 },
    data: fromProductionFlowStep(step)
  } as FlowDesignerNode;
  return toProductionFlowStep(node, []);
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
  fixedDelay: { type: "fixedDelay", delayMs: 250 },
  // 202 → poll-to-terminal (awkit-4km C1): every field must survive the round trip unchanged.
  apiPolling: {
    type: "apiPolling",
    urlContains: "/api/jobs/",
    method: "GET",
    pollingStatus: 202,
    terminalStatusRange: [200, 299],
    responseField: "status",
    terminalValues: ["succeeded", "failed"],
    maxAttempts: 20,
    optional: false,
    timeoutMs: 45000,
    reason: "async job polling"
  },
  // WebSocket/SSE lifecycle observation (awkit-4km C2): diagnostic-only fields survive unchanged.
  streamActivity: {
    type: "streamActivity",
    transport: "either",
    urlContains: "/api/events",
    event: "open",
    diagnostics: "auto",
    reason: "correlate stream activity without replacing UI completion"
  },
  // Grouped completion OR-group (awkit-y24): a required group whose branches are UI outcomes.
  anyOf: {
    type: "anyOf",
    optional: false,
    timeoutMs: 16000,
    reason: "empty-result contract",
    conditions: [
      { type: "tableHasRows", tableLocator: loc("#results"), rowLocator: loc("tbody tr"), minRows: 1, timeoutMs: 15000 },
      { type: "elementVisible", locator: loc("[data-testid=empty-state]"), timeoutMs: 15000 }
    ]
  }
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

console.log("\nGrouped completion — `A AND (B OR C)` round-trips (awkit-y24):");
{
  // The empty-result contract: API success AND (table has rows OR empty-state visible), under
  // allRequired. The required OR-group is one afterWait; nesting must survive the designer round trip
  // AND repeated cycles, or grouped completion repeats the historical round-trip-loss defects.
  const group = WAIT_FIXTURES.anyOf as Extract<WaitCondition, { type: "anyOf" }>;
  const after: WaitCondition[] = [WAIT_FIXTURES.response, group];
  const out = cycle(baseStep({ afterWaits: after, completionMode: "allRequired" }));
  check("A AND (B OR C) shape preserved", json(out.afterWaits) === json(after), `got ${json(out.afterWaits)}`);
  check("group stays required and keeps completionMode", out.completionMode === "allRequired" && (out.afterWaits?.[1] as { optional?: boolean }).optional === false);
  const grp = out.afterWaits?.[1] as Extract<WaitCondition, { type: "anyOf" }>;
  check("both OR-branches survive in order", grp.conditions.map((c) => c.type).join(",") === "tableHasRows,elementVisible", json(grp.conditions.map((c) => c.type)));
  check("nested branch detail preserved (minRows / locator)", (grp.conditions[0] as { minRows?: number }).minRows === 1 && json(grp.conditions[1]) === json(group.conditions[1]));
  // No gradual nested-field loss across three cycles.
  const thrice = cycleN(baseStep({ afterWaits: after, completionMode: "allRequired" }), 3);
  check("group nesting stable across 3 cycles", json(thrice.afterWaits) === json(after));
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

console.log("\nBare `value` with no `valueSource` round-trips losslessly (awkit-cxa FIXED):");
{
  // `fromFlowStep` now reads `step.value` and marks the node "none", so the save path re-serializes
  // the value WITHOUT fabricating a static `valueSource`. Reachable on shipped data:
  // resources/test-fixtures/mock-site/flows/mock-conditional-flow.json ships a `condition` node whose
  // expression is stored exactly this way (`value` present, `valueSource` absent).
  //
  // These assertions replace the two PINNED "KNOWN DEFECT" checks that formerly proved the data loss.
  const expr = "${runtimeInputs.path} === 'A'";
  const bare = baseStep({ type: "condition", name: "Check Path", value: expr });
  const out = cycle(bare);
  check("bare `value` is preserved (no longer dropped)", out.value === expr, `got ${json(out.value)}`);
  check("no static valueSource is fabricated for a bare value", out.valueSource === undefined, json(out.valueSource));

  // Stable across repeated opens — no drift, no late fabrication.
  const thrice = cycleN(bare, 3);
  check("bare `value` stable across 3 cycles", thrice.value === expr && thrice.valueSource === undefined, json({ v: thrice.value, s: thrice.valueSource }));

  // Bare-value shapes. FlowStep.value is typed `string`, so structured values arrive string-encoded.
  const shapes: Array<[string, string]> = [
    ["plain string", "hello world"],
    ["numeric-looking", "42"],
    ["boolean-looking", "true"],
    ["json-looking object", "{\"a\":1}"],
    ["json-looking array", "[1,2,3]"],
    ["expression", "${outputs.flow.ok} === 'true'"]
  ];
  for (const [label, v] of shapes) {
    const s = cycle(baseStep({ type: "condition", name: label, value: v }));
    check(`bare value (${label}) preserved without a fabricated source`, s.value === v && s.valueSource === undefined, json({ v: s.value, s: s.valueSource }));
  }

  // Empty-string bare value normalizes to undefined (via `data.value || undefined`) — still no source.
  const empty = cycle(baseStep({ type: "condition", name: "Empty", value: "" }));
  check("empty-string bare value normalizes to undefined (no source fabricated)", empty.value === undefined && empty.valueSource === undefined, json({ v: empty.value, s: empty.valueSource }));

  // A genuine static value node (value + explicit static valueSource) is UNCHANGED by the fix.
  const staticNode = cycle(baseStep({ type: "fill", name: "User", value: "alice", valueSource: { type: "static", value: "alice" } }));
  check("explicit static valueSource still preserved (fix does not disturb it)", staticNode.value === "alice" && json(staticNode.valueSource) === json({ type: "static", value: "alice" }), json(staticNode.valueSource));

  const shippedFixture = JSON.parse(
    await readFile("resources/test-fixtures/mock-site/flows/mock-conditional-flow.json", "utf8")
  ) as FlowProfile;
  const shippedCondition = shippedFixture.nodes.find((step) => step.id === "cond");
  const shippedRoundTrip = shippedCondition ? cycle(shippedCondition) : undefined;
  check(
    "shipped mock conditional expression survives the real designer round trip",
    shippedCondition?.value === "${runtimeInputs.path} === 'A'" &&
      shippedCondition.valueSource === undefined &&
      shippedRoundTrip?.value === shippedCondition.value &&
      shippedRoundTrip.valueSource === undefined,
    json({ before: shippedCondition, after: shippedRoundTrip })
  );
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

console.log("\nvalueSource variants round-trip (report §8 — incl. generated/secret fix):");
{
  const variants: ValueSource[] = [
    { type: "static", value: "literal" },
    { type: "env", envKey: "MY_ENV" },
    { type: "runtimeInput", key: "userId" },
    { type: "json", path: "$.data.id" },
    { type: "flowOutput", outputKey: "orderId" },
    { type: "generated", generator: "uuid" },
    { type: "currentRow", path: "email" },
    { type: "instanceVariable", key: "seat" },
    { type: "secret", secretName: "API_TOKEN" }
  ];
  for (const vs of variants) {
    const out = cycle(baseStep({ type: "fill", name: vs.type, valueSource: vs }));
    check(`valueSource "${vs.type}" round-trips`, json(out.valueSource) === json(vs), `got ${json(out.valueSource)}`);
  }
  const dyn: ValueSource = { type: "dynamic", dataSourceScope: "specific", dataSourceId: "ds-1", idMode: "explicit", objectId: "o-9", keyName: "email" };
  check("valueSource \"dynamic\" (specific/explicit) round-trips", json(cycle(baseStep({ type: "fill", name: "dyn", valueSource: dyn })).valueSource) === json(dyn));
  const dynWf: ValueSource = { type: "dynamic", dataSourceScope: "workflow", idMode: "instanceOrder", keyName: "name" };
  check("valueSource \"dynamic\" (workflow/instanceOrder) round-trips", json(cycle(baseStep({ type: "fill", name: "dynwf", valueSource: dynWf })).valueSource) === json(dynWf));
}

console.log("\nCompound locator alternatives + container/frame context round-trip (§8):");
{
  const locator = {
    strategy: "role" as const,
    value: "button",
    name: "Save",
    exact: true,
    alternatives: [
      { strategy: "css" as const, value: "#save" },
      { strategy: "text" as const, value: "Save", exact: false }
    ],
    context: {
      container: { type: "tableRow" as const, strategy: "css" as const, value: "tr.selected", hasText: "Acme", visibleOnly: true },
      containers: [
        { type: "section" as const, strategy: "testId" as const, value: "workspace-primary" },
        { type: "card" as const, strategy: "testId" as const, value: "account-acme", hasText: "Acme" }
      ],
      frame: { selector: "iframe#app" },
      shadow: {
        boundary: "open" as const,
        hosts: [
          { strategy: "testId" as const, value: "product-card-2", alternatives: [{ strategy: "id" as const, value: "card-two" }] },
          { strategy: "testId" as const, value: "nested-picker" }
        ]
      }
    },
    interaction: { path: ["button", "product-picker", "product-card"], shadowBoundary: "open" as const },
    resolution: "resolved" as const,
    resolvedBy: "recorder" as const,
    reviewReason: undefined
  };
  const out = cycle(baseStep({ type: "click", name: "Save", locator }));
  check("locator.alternatives preserved (compound self-heal payload)", json(out.locator?.alternatives) === json(locator.alternatives), json(out.locator?.alternatives));
  check("locator.context (legacy + nested containers + frame) preserved", json(out.locator?.context) === json(locator.context), json(out.locator?.context));
  check("locator Shadow DOM interaction evidence preserved", json(out.locator?.interaction) === json(locator.interaction), json(out.locator?.interaction));
  check("locator Shadow DOM resolution provenance preserved", out.locator?.resolution === "resolved" && out.locator?.resolvedBy === "recorder");
}

console.log("\nPositional-fallback approval binding lifecycle (awkit-aui.4):");
{
  const approved: FlowStep = baseStep({
    type: "click",
    name: "Choose second twin",
    safety: { sideEffectLevel: "none", retryable: true },
    locator: {
      strategy: "css",
      value: ".pos-btn:nth-of-type(2)",
      context: {
        frame: { selector: "iframe#catalog" },
        shadow: { boundary: "open", hosts: [{ strategy: "testId", value: "product-host" }] }
      },
      quality: { strategy: "fallback", disambiguation: "positional", isUnique: true, matchCount: 1, confidence: "low" },
      resolution: "user-approved-fallback",
      resolvedBy: "user",
      approvedFallbackReason: "Reviewed: the fixture intentionally exposes position only."
    }
  });
  approved.locator!.approvedFallbackBinding = createLocatorApprovalBinding(approved);

  const roundTrip = cycle(approved);
  check("approved binding survives designer save/load with frame + shadow context", json(roundTrip.locator?.approvedFallbackBinding) === json(approved.locator?.approvedFallbackBinding), json(roundTrip.locator));
  check("approved resolution remains valid across an unchanged designer cycle", roundTrip.locator?.resolution === "user-approved-fallback" && roundTrip.locator?.approvedFallbackReason === approved.locator?.approvedFallbackReason);
  const productionRoundTrip = productionCycle(approved);
  check("approved binding survives FlowChartDesigner's production mapping", json(productionRoundTrip.locator?.approvedFallbackBinding) === json(approved.locator?.approvedFallbackBinding) && productionRoundTrip.locator?.resolution === "user-approved-fallback", json(productionRoundTrip.locator));

  const renamedNode = { ...nodeFor(approved), data: fromProductionFlowStep(approved) } as FlowDesignerNode;
  renamedNode.data.name = "Choose a different twin";
  const renamed = toProductionFlowStep(renamedNode, []);
  check("action-name edit invalidates approval and removes stale authority", renamed.locator?.resolution === "needs-review" && renamed.locator?.approvedFallbackBinding === undefined && renamed.locator?.approvedFallbackReason === undefined, json(renamed.locator));

  const contextNode = { ...nodeFor(approved), data: fromProductionFlowStep(approved) } as FlowDesignerNode;
  contextNode.data.locatorContext = {
    ...contextNode.data.locatorContext,
    frame: { selector: "iframe#other-catalog" }
  };
  const recontextualized = toProductionFlowStep(contextNode, []);
  check("frame/context edit invalidates approval and removes stale authority", recontextualized.locator?.resolution === "needs-review" && recontextualized.locator?.approvedFallbackBinding === undefined && recontextualized.locator?.approvedFallbackReason === undefined, json(recontextualized.locator));

  const safetyNode = { ...nodeFor(approved), data: fromProductionFlowStep(approved) } as FlowDesignerNode;
  safetyNode.data.safety = { sideEffectLevel: "dangerousMutation", retryable: false };
  const resafed = toProductionFlowStep(safetyNode, []);
  check("safety/action-policy edit invalidates approval and removes stale authority", resafed.locator?.resolution === "needs-review" && resafed.locator?.approvedFallbackBinding === undefined && resafed.locator?.approvedFallbackReason === undefined, json(resafed.locator));
}

console.log("\nRecorder popup/window metadata survives the designer round trip (awkit-4t9, FR-C1 prerequisite):");
{
  // Before this tranche, `toFlowStep`/`fromFlowStep` carried NONE of these fields, so opening and
  // re-saving a recorded multi-window flow silently discarded its popup identity — which would strip
  // the recorded alias FR-C1.2 depends on. What regression makes this fail? Dropping any of the three
  // fields from either direction of the mapping.
  const popupExpectation = {
    popupAlias: "popup-1" as const,
    timeoutMs: 12_000,
    urlContains: "/terms",
    titleContains: "Terms",
    waitUntil: "domcontentloaded" as const,
    closeBehavior: "returnToMain" as const
  };
  const opener = cycle(baseStep({ type: "click", name: "Open terms", opensPopup: true, popupExpectation }));
  check("opensPopup preserved", opener.opensPopup === true, json(opener.opensPopup));
  check("popupExpectation preserved in full", json(opener.popupExpectation) === json(popupExpectation), json(opener.popupExpectation));

  const onPopup = cycle(baseStep({ type: "check", name: "Agree", pageAlias: "popup-1" }));
  check("pageAlias preserved", onPopup.pageAlias === "popup-1", String(onPopup.pageAlias));

  // A synthetic (non-positional) alias must survive too — it is the shape FR-C1.3 assigns.
  const synthetic = cycle(baseStep({ type: "click", name: "On synthetic", pageAlias: "popup-main-3f2a91cd" }));
  check("synthetic FR-C1.3 alias preserved", synthetic.pageAlias === "popup-main-3f2a91cd", String(synthetic.pageAlias));

  // Repeated edits must not erode the metadata (the failure mode awkit-cxa established the rule for).
  const repeated = cycleN(baseStep({ type: "click", name: "Open terms", opensPopup: true, popupExpectation, pageAlias: "main" }), 3);
  check("popup metadata survives 3 edit cycles", repeated.opensPopup === true && json(repeated.popupExpectation) === json(popupExpectation) && repeated.pageAlias === "main", json({ opensPopup: repeated.opensPopup, popupExpectation: repeated.popupExpectation, pageAlias: repeated.pageAlias }));

  // An unrelated node edit must not clear popup metadata.
  const edited = nodeFor(baseStep({ type: "click", name: "Open terms", opensPopup: true, popupExpectation }));
  edited.data.name = "Renamed opener";
  edited.data.timeoutMs = 4_321;
  const afterEdit = toFlowStep(edited, []);
  check("unrelated node edit does not clear popup metadata", afterEdit.opensPopup === true && json(afterEdit.popupExpectation) === json(popupExpectation), json(afterEdit.popupExpectation));

  // Absent stays absent: a plain step must not gain invented popup fields.
  const plain = cycle(baseStep({ type: "click", name: "Plain click" }));
  check("missing popup metadata stays absent (not invented)", plain.pageAlias === undefined && plain.opensPopup === undefined && plain.popupExpectation === undefined, json({ pageAlias: plain.pageAlias, opensPopup: plain.opensPopup, popupExpectation: plain.popupExpectation }));
}

console.log("\nEdge → next wiring (§8):");
{
  const node = nodeFor(baseStep({ type: "click", name: "A" }));
  const withEdge = toFlowStep(node, [{ id: "e1", source: node.id, target: "next-node" } as FlowDesignerEdge]);
  check("next resolves from the outgoing edge target", withEdge.next === "next-node", String(withEdge.next));
  check("no outgoing edge → next is undefined", toFlowStep(node, []).next === undefined, String(toFlowStep(node, []).next));
}

console.log("\nstep.config breadth round-trips (§8 — representative):");
{
  const route = cycle(baseStep({ type: "routeChange", name: "Route", config: { routeMode: "waitForNewTab", urlMatch: "contains", routeWaitUntil: "networkidle" } }));
  check("routeChange config round-trips", route.config?.routeMode === "waitForNewTab" && route.config?.urlMatch === "contains" && route.config?.routeWaitUntil === "networkidle", json(route.config));
  const save = cycle(baseStep({ type: "saveSession", name: "Save", config: { sessionName: "prod", sessionFolder: "sessions", overwriteSession: true, captureScope: "context", maskSession: false } }));
  check("saveSession config round-trips (incl. falsy maskSession:false)", save.config?.sessionName === "prod" && save.config?.overwriteSession === true && save.config?.maskSession === false && save.config?.captureScope === "context", json(save.config));
}

console.log("\nOutputs: single-key round-trips; multi-key is a documented single-key limitation (§8):");
{
  const single = cycle(baseStep({ type: "readText", name: "Read", outputs: { result: { type: "text" } } }));
  check("single-key text output round-trips", json(single.outputs) === json({ result: { type: "text" } }), json(single.outputs));
  // PINNED LIMITATION: node data holds ONE output key, so multi-key collapses to the first key as text.
  // If multi-key output support lands, this check will fail and must be updated.
  const multi = cycle(baseStep({ type: "readText", name: "Read2", outputs: { a: { type: "text" }, b: { type: "number" } } }));
  check("PINNED: multi-key outputs collapse to the first key as text (documented §8)", json(multi.outputs) === json({ a: { type: "text" } }), json(multi.outputs));
}

console.log("\nDrag: source + drop-target locators both survive the round-trip (awkit-3g6):");
{
  const dragStep = baseStep({
    type: "drag",
    name: "Drag Card to Zone",
    locator: { strategy: "css", value: "#src", resolution: "resolved", resolvedBy: "recorder" },
    targetLocator: { strategy: "css", value: "#zone", resolution: "resolved", resolvedBy: "recorder" }
  });
  const rt = cycle(dragStep);
  check("drag round-trip keeps the source locator", rt.locator?.value === "#src");
  check("drag round-trip keeps the drop-target locator (not silently dropped)", rt.targetLocator?.value === "#zone" && rt.targetLocator?.strategy === "css");
  const prodRt = productionCycle(dragStep);
  check("drag drop-target survives the PRODUCTION mapping too", prodRt.targetLocator?.value === "#zone");
  const clickRt = cycle(baseStep({ type: "click", name: "Click", locator: { strategy: "css", value: "#btn" } }));
  check("a non-drag step gains no targetLocator", clickRt.targetLocator === undefined);

  // create → save → reload → EDIT → re-save: load to designer data, edit ONLY the target, re-save.
  const loaded = fromFlowStep(dragStep);
  const editedNode = { id: "s-drag", type: "action", position: { x: 0, y: 0 }, data: { ...loaded, targetLocator: { ...loaded.targetLocator, strategy: "testId" as const, value: "drop-zone-2" } } } as FlowDesignerNode;
  const editedStep = toFlowStep(editedNode, []);
  check("editing the drop target persists on re-save", editedStep.targetLocator?.value === "drop-zone-2" && editedStep.targetLocator?.strategy === "testId");
  check("editing the drop target leaves the source locator untouched", editedStep.locator?.value === "#src" && editedStep.locator?.strategy === "css");
  // Clearing the target removes it WITHOUT touching the source (requirement: independent clearing).
  const clearedNode = { id: "s-drag", type: "action", position: { x: 0, y: 0 }, data: { ...loaded, targetLocator: undefined } } as FlowDesignerNode;
  const clearedStep = toFlowStep(clearedNode, []);
  check("clearing the drop target removes it", clearedStep.targetLocator === undefined);
  check("clearing the drop target leaves the source locator intact", clearedStep.locator?.value === "#src");
  // Registry validation blocks an executable drag step that has no drop target (no silent save).
  const dragDef = getNodeDefinition("drag");
  check("drag validation flags a missing drop target", dragDef.validate({ ...loaded, targetLocator: undefined }).some((m) => /drop-target/i.test(m)));
  check("drag validation passes once a drop target is set", dragDef.validate(loaded).length === 0);
  // Visibility: the dragTarget editor section is exclusive to drag nodes (the panel gates on this).
  check("the dragTarget editor section is exclusive to drag nodes", dragDef.sections.includes("dragTarget") && !getNodeDefinition("click").sections.includes("dragTarget") && !getNodeDefinition("fill").sections.includes("dragTarget"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
