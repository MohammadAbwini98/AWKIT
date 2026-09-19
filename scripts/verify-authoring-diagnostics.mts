/**
 * verify:authoring-diagnostics — Phase L L4a (awkit-djnl.5): every authoring-diagnostic family in
 * docs/plans/ai-upgrade-v5/L4-authoring-diagnostics.md, against the real owners.
 *
 * For each family: the owner that detects it, a defective fixture that must produce the family's
 * stable code with the right severity, anchor and active-path classification, and a negative
 * control that must not. The new L4a rules are checked against what `FlowExecutor` actually does
 * (their premises are asserted on its source, so a runtime change forces the rule to be revisited),
 * through the run gate (`PreRunValidator`), for workflow parity (`FlowDependencyResolver`), for
 * legacy-shaped profiles, and for designer parity (no second implementation left in the renderer).
 *
 * Run: npm run verify:authoring-diagnostics
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { incompleteBranchPairs as rendererIncompleteBranchPairs } from "../app/renderer/components/shared/branchPairs";
import { FlowDependencyResolver } from "../src/orchestrator/FlowDependencyResolver";
import type { FlowEdge, FlowProfile, FlowStep, StepType, ValueSource } from "../src/profiles/FlowProfile";
import type { ScenarioProfile } from "../src/profiles/ScenarioProfile";
import { isRunBlocked, PreRunValidator } from "../src/reports/PreRunValidator";
import { incompleteBranchPairs } from "../src/validation/BranchPairs";
import {
  FLOW_VALIDATION_RULES,
  isExecutionBlocking,
  validateFlowDefinition,
  type FlowValidationCode,
  type FlowValidationIssue
} from "../src/validation/FlowValidator";
import { FLOW_VALIDATOR_VERSION } from "../src/validation/LegacyCompatibility";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}
const section = (title: string) => console.log(`\n${title}`);

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

const step = (id: string, type: StepType, extra: Partial<FlowStep> = {}): FlowStep => ({ id, type, name: `${type} ${id}`, ...extra });
const click = (id: string) => step(id, "click", { locator: { strategy: "testId", value: id } });
const edge = (id: string, source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge => ({ id, source, target, type: "success", kind: "normal", ...extra });
const flow = (id: string, nodes: FlowStep[], edges: FlowEdge[]): FlowProfile => ({ id, name: `Flow ${id}`, version: 1, nodes, edges });
const conditional = (id: string, source: string, target: string, operator = "equals", extra: Record<string, unknown> = {}): FlowEdge =>
  edge(id, source, target, { type: "conditional", kind: "conditional", conditional: { sourceField: "outcome", operator, expectedValue: "ok", ...extra } as FlowEdge["conditional"] });
const parallel = (id: string, source: string, target: string): FlowEdge =>
  edge(id, source, target, { type: "parallel", kind: "parallel", parallel: { joinMode: "waitAll", failMode: "failFast" } });

/** start → a → b → end: the valid baseline every family varies. */
const baseline = (id = "baseline") =>
  flow(id, [step("s", "start"), click("a"), click("b"), step("e", "end")], [edge("e1", "s", "a"), edge("e2", "a", "b"), edge("e3", "b", "e")]);

const codesOf = (profile: FlowProfile) => validateFlowDefinition(profile).issues.map((issue) => issue.code);
const issuesOf = (profile: FlowProfile, code: FlowValidationCode) => validateFlowDefinition(profile).issues.filter((issue) => issue.code === code);
const has = (profile: FlowProfile, code: FlowValidationCode) => codesOf(profile).includes(code);

// ── Families ─────────────────────────────────────────────────────────────────────────────────────

section("0. The rule table");
check("the validator version moved for the L4a rules", FLOW_VALIDATOR_VERSION === 4, FLOW_VALIDATOR_VERSION);
const NEW_RULES: [FlowValidationCode, "error" | "warning"][] = [
  ["incompleteBranchPair", "error"],
  ["unguardedCycle", "error"],
  ["connectorFromEndNode", "warning"],
  ["deadEndNode", "warning"],
  ["incompleteCondition", "warning"],
  ["emptyLoopValues", "warning"],
  ["ambiguousConditionPriority", "warning"],
  ["incompleteValueSource", "warning"]
];
for (const [code, severity] of NEW_RULES) check(`${code} is in the rule table as ${severity}`, FLOW_VALIDATION_RULES[code]?.severity === severity);
check("the baseline flow validates clean", codesOf(baseline()).length === 0, codesOf(baseline()));

section("1. Unreachable and orphan nodes (FlowValidator)");
{
  const orphan = baseline("orphan");
  orphan.nodes.push(click("x"));
  const [issue] = issuesOf(orphan, "unreachableNode");
  check("an orphan node is unreachableNode, off the active path", issue?.nodeId === "x" && issue.onActivePath === false);
  const pastEnd = baseline("past-end");
  pastEnd.nodes.push(click("x"));
  pastEnd.edges.push(edge("e4", "e", "x"));
  check("a step reachable only through an End step is unreachableNode (End finishes the run)", issuesOf(pastEnd, "unreachableNode").some((i) => i.nodeId === "x"));
  const parallelFromEnd = baseline("parallel-end");
  parallelFromEnd.nodes.push(click("x"));
  parallelFromEnd.edges.push(parallel("e4", "e", "x"), parallel("e5", "e", "b"));
  check("a parallel target of an End step is reachable (the fan-out runs before End finishes)", !issuesOf(parallelFromEnd, "unreachableNode").some((i) => i.nodeId === "x"));
  const broken = baseline("broken");
  broken.edges.push(edge("e4", "b", "ghost"));
  check("a connector to a missing node is brokenConnectorEndpoint", has(broken, "brokenConnectorEndpoint"));
}

section("2. Connector rules (FlowValidator wraps validateConnectorStructure)");
{
  const two = baseline("two-standard");
  two.edges.push(edge("e4", "a", "e"));
  check("two standard connectors from one step is connectorStructure", has(two, "connectorStructure"));
  const spans = baseline("loop-spans");
  spans.edges.push(edge("e4", "a", "b", { type: "loop", kind: "loop", loop: { mode: "count", maxIterations: 2 } }));
  check("a loop connector spanning two steps is connectorStructure", has(spans, "connectorStructure"));
}

section("3. Start and End (FlowValidator)");
{
  const noStart = flow("no-start", [click("a"), step("e", "end")], [edge("e1", "a", "e")]);
  check("no Start is missingStartNode", has(noStart, "missingStartNode"));
  const noEnd = flow("no-end", [step("s", "start"), click("a")], [edge("e1", "s", "a")]);
  check("no End is missingEndNode", has(noEnd, "missingEndNode"));
  const fromEnd = baseline("from-end");
  fromEnd.edges.push(edge("e4", "e", "a"));
  const [endIssue] = issuesOf(fromEnd, "connectorFromEndNode");
  check("a connector leaving End is connectorFromEndNode (warning)", endIssue?.edgeId === "e4" && endIssue.severity === "warning");
  check("...and it is not also a cycle (End never routes)", !has(fromEnd, "unguardedCycle"));
  const intoStart = baseline("into-start");
  intoStart.edges[2] = conditional("e3", "b", "s");
  intoStart.edges.push(edge("e4", "b", "e"));
  check("an ordinary connector back into Start is unguardedCycle", issuesOf(intoStart, "unguardedCycle").length === 1);
}

section("4. Missing required bindings (FlowValidator)");
{
  const noLocator = baseline("no-locator");
  noLocator.nodes[1] = step("a", "click");
  check("a click with no locator is missingRequiredLocator", has(noLocator, "missingRequiredLocator"));
  const noValue = baseline("no-value");
  noValue.nodes[1] = step("a", "fill", { locator: { strategy: "testId", value: "a" } });
  check("a fill with no value is missingRequiredValue", has(noValue, "missingRequiredValue"));
  const pair = (cond: FlowEdge) => flow("cond", [step("s", "start"), click("a"), step("e", "end")], [edge("e1", "s", "a"), cond, edge("e3", "a", "e")]);
  const [noExpected] = issuesOf(pair(conditional("e2", "a", "e", "equals", { expectedValue: "" })), "incompleteCondition");
  check("a comparison with no expected value is incompleteCondition (warning)", noExpected?.edgeId === "e2" && noExpected.severity === "warning");
  check("...an operator that needs no value is not", !has(pair(conditional("e2", "a", "e", "exists", { expectedValue: "" })), "incompleteCondition"));
  check("a variable source with no variable path is incompleteCondition", has(pair(conditional("e2", "a", "e", "truthy", { sourceField: "variable", variableName: " " })), "incompleteCondition"));
  check("...and with a path it is not", !has(pair(conditional("e2", "a", "e", "truthy", { sourceField: "variable", variableName: "order.total" })), "incompleteCondition"));
}

section("5. Missing runtime and data bindings (FlowValidator, PreRunValidator)");
{
  const bound = (source: ValueSource) =>
    flow("bound", [step("s", "start"), step("a", "fill", { locator: { strategy: "testId", value: "a" }, valueSource: source }), step("e", "end")], [edge("e1", "s", "a"), edge("e2", "a", "e")]);
  const incomplete: [string, ValueSource, string][] = [
    ["runtimeInput without key", { type: "runtimeInput" }, "empty value"],
    ["instanceVariable without key", { type: "instanceVariable", key: " " }, "empty value"],
    ["env without envKey", { type: "env" }, "empty value"],
    ["flowOutput without flowId", { type: "flowOutput", outputKey: "total" }, "empty value"],
    ["secret without secretName", { type: "secret" }, "fails when it runs"],
    ["json without path", { type: "json", file: "data.json" }, "fails when it runs"],
    ["dynamic explicit without objectId", { type: "dynamic", keyName: "email", idMode: "explicit" }, "fails when it runs"],
    ["dynamic specific without dataSourceId", { type: "dynamic", keyName: "email", dataSourceScope: "specific", idMode: "instanceOrder" }, "fails when it runs"],
    ["generated without generator", { type: "generated" }, "fails when it runs"]
  ];
  for (const [label, source, effect] of incomplete) {
    const [issue] = issuesOf(bound(source), "incompleteValueSource");
    check(`${label} is incompleteValueSource and says it ${effect}`, issue?.nodeId === "a" && issue.message.includes(effect), issue?.message);
  }
  const complete: [string, ValueSource][] = [
    ["runtimeInput with key", { type: "runtimeInput", key: "email" }],
    ["flowOutput with flowId and outputKey", { type: "flowOutput", flowId: "login", outputKey: "total" }],
    ["dynamic instanceOrder in workflow scope with keyName", { type: "dynamic", keyName: "email", idMode: "instanceOrder" }],
    ["generated uuid", { type: "generated", generator: "uuid" }],
    ["static", { type: "static", value: "x" }]
  ];
  for (const [label, source] of complete) check(`${label} is complete`, !has(bound(source), "incompleteValueSource"));
  const conditionBound = flow("cond-bound", [step("s", "start"), step("a", "condition", { value: "true", valueSource: { type: "runtimeInput" } }), step("e", "end")], [edge("e1", "s", "a"), conditional("e2", "a", "e"), edge("e3", "a", "e")]);
  check("a condition's ignored source is ignoredConditionValueSource, not incompleteValueSource", has(conditionBound, "ignoredConditionValueSource") && !has(conditionBound, "incompleteValueSource"));

  const scenario = { id: "sc", name: "sc", flows: [{ flowId: "json-flow", order: 1 }], links: [], maxParallelFlows: 1 } as unknown as ScenarioProfile;
  const jsonGate = (file: string, jsonPath: string) =>
    new PreRunValidator().validate({
      scenario,
      flows: [flow("json-flow", [step("s", "start"), step("a", "fill", { locator: { strategy: "testId", value: "a" }, valueSource: { type: "json", file, path: jsonPath } }), step("e", "end")], [edge("e1", "s", "a"), edge("e2", "a", "e")])],
      jsonData: { d: { present: 1 } }
    }).filter((issue) => issue.key === "json.a");
  check("a malformed JSON path blocks the run gate (existing PreRunValidator rule)", jsonGate("d", "present").some((issue) => issue.severity === "error" && issue.blocking));
  check("a JSON path to a missing key is a non-blocking warning (L4a)", (() => {
    const found = jsonGate("d", "$.missing");
    return found.length === 1 && found[0]?.severity === "warning" && !found[0].blocking;
  })());
  check("...a path that resolves is clean", jsonGate("d", "$.present").length === 0);
  check("...a file that was not preloaded is not judged (the runner reads it from disk)", jsonGate("elsewhere.json", "$.missing").length === 0);
}

section("6. Branch pairs (BranchPairs, shared by FlowValidator and both canvases)");
{
  const lone = flow("lone", [step("s", "start"), click("a"), step("e", "end")], [edge("e1", "s", "a"), conditional("e2", "a", "e")]);
  const [issue] = issuesOf(lone, "incompleteBranchPair");
  check("a lone conditional is incompleteBranchPair on its connector", issue?.edgeId === "e2" && issue.severity === "error" && issue.onActivePath === true);
  const loneParallel = flow("lone-par", [step("s", "start"), click("a"), step("e", "end")], [edge("e1", "s", "a"), parallel("e2", "a", "e")]);
  check("a lone parallel is incompleteBranchPair", issuesOf(loneParallel, "incompleteBranchPair")[0]?.message.includes("runs its target twice"));
  const ifElse = flow("if-else", [step("s", "start"), click("a"), step("e", "end")], [edge("e1", "s", "a"), conditional("e2", "a", "e"), edge("e3", "a", "e")]);
  check("a conditional with a standard fallback (if/else) is not", !has(ifElse, "incompleteBranchPair"));
  const pairOk = flow("pair", [step("s", "start"), click("a"), click("b"), step("e", "end")], [edge("e1", "s", "a"), conditional("e2", "a", "b"), conditional("e3", "a", "e", "notEquals"), edge("e4", "b", "e")]);
  check("a complete conditional pair is not", !has(pairOk, "incompleteBranchPair"));
  const loopExit = flow("loop-exit", [step("s", "start"), click("a"), step("e", "end")], [
    edge("e1", "s", "a"),
    edge("e-loop", "a", "a", { type: "loop", kind: "loop", loop: { mode: "count", maxIterations: 3 } }),
    conditional("e2", "a", "e", "always", { expectedValue: undefined })
  ]);
  check("a loop step's single Conditional exit is not", !has(loopExit, "incompleteBranchPair"));
  check("the canvases use the engine's implementation, not a copy", rendererIncompleteBranchPairs === incompleteBranchPairs);
}

section("7. Unguarded and bounded cycles (FlowValidator)");
{
  const retry = flow("retry", [step("s", "start"), click("a"), click("b"), step("e", "end")], [
    edge("e1", "s", "a"),
    edge("e2", "a", "b"),
    conditional("e3", "b", "a", "notEquals"),
    edge("e4", "b", "e")
  ]);
  const [cycle] = issuesOf(retry, "unguardedCycle");
  check("a retry through an ordinary conditional is unguardedCycle", cycle?.severity === "error" && cycle.edgeId === "e3" && cycle.onActivePath === true, cycle);
  check("...naming both steps", Boolean(cycle?.message.includes("click a") && cycle.message.includes("click b")));
  const failureLoop = flow("failure-loop", [step("s", "start"), click("a"), click("b"), step("e", "end")], [edge("e1", "s", "a"), edge("e2", "a", "b"), edge("e3", "b", "a", { type: "failure" }), edge("e4", "b", "e")]);
  check("a failure connector back to an earlier step is unguardedCycle", has(failureLoop, "unguardedCycle"));
  const selfStandard = flow("self", [step("s", "start"), click("a"), step("e", "end")], [edge("e1", "s", "a"), conditional("e2", "a", "a"), edge("e3", "a", "e")]);
  check("an ordinary connector from a step to itself is unguardedCycle", has(selfStandard, "unguardedCycle"));
  const loopBack = flow("loopback", [step("s", "start"), click("a"), click("b"), step("e", "end")], [
    edge("e1", "s", "a"),
    edge("e2", "a", "b"),
    edge("e3", "b", "a", { type: "loopBack", kind: "loop", maxLoopCount: 3 }),
    edge("e4", "b", "e")
  ]);
  check("the same retry through a Loop Back connector is not (it is bounded)", !has(loopBack, "unguardedCycle"));
  const selfLoop = flow("self-loop", [step("s", "start"), click("a"), step("e", "end")], [
    edge("e1", "s", "a"),
    edge("e-loop", "a", "a", { type: "loop", kind: "loop", loop: { mode: "count", maxIterations: 3 } }),
    conditional("e2", "a", "e", "always", { expectedValue: undefined })
  ]);
  check("a structured loop connector on its own step is not", !has(selfLoop, "unguardedCycle"));
  const diamond = flow("diamond", [step("s", "start"), click("a"), click("b"), click("c"), step("e", "end")], [
    edge("e1", "s", "a"),
    conditional("e2", "a", "b"),
    conditional("e3", "a", "c", "notEquals"),
    edge("e4", "b", "e"),
    edge("e5", "c", "e")
  ]);
  check("a diamond that re-converges is not a cycle", !has(diamond, "unguardedCycle"));
  const parallelBack = flow("parallel-back", [step("s", "start"), click("a"), click("b"), step("e", "end")], [
    edge("e1", "s", "a"),
    edge("e2", "a", "b"),
    parallel("e3", "b", "a"),
    parallel("e4", "b", "e"),
    edge("e5", "b", "e")
  ]);
  check("a parallel connector back to an executed step is not (the fan-out skips it)", !has(parallelBack, "unguardedCycle"));
  const two = flow("two-cycles", [step("s", "start"), click("a"), click("b"), click("c"), click("d"), step("e", "end")], [
    edge("e1", "s", "a"),
    edge("e2", "a", "b"),
    conditional("e3", "b", "a"),
    edge("e4", "b", "c"),
    edge("e5", "c", "d"),
    conditional("e6", "d", "c"),
    edge("e7", "d", "e")
  ]);
  check("two separate cycles are two issues", issuesOf(two, "unguardedCycle").length === 2);
  check("an off-path cycle is classified off the active path", (() => {
    const off = baseline("off-cycle");
    off.nodes.push(click("x"), click("y"));
    off.edges.push(edge("e4", "x", "y"), edge("e5", "y", "x"));
    const [issue] = issuesOf(off, "unguardedCycle");
    return issue?.onActivePath === false;
  })());
}

section("8. Malformed loops (FlowValidator)");
{
  const loopEdge = (loop: FlowEdge["loop"]) =>
    flow("loop", [step("s", "start"), click("a"), step("e", "end")], [edge("e1", "s", "a"), edge("e-loop", "a", "a", { type: "loop", kind: "loop", loop }), conditional("e2", "a", "e", "always", { expectedValue: undefined })]);
  const [empty] = issuesOf(loopEdge({ mode: "staticList", maxIterations: 5, staticValues: [] }), "emptyLoopValues");
  check("a static-list loop with no values is emptyLoopValues (warning)", empty?.edgeId === "e-loop" && empty.severity === "warning");
  check("...and with values it is not", !has(loopEdge({ mode: "staticList", maxIterations: 5, staticValues: ["a"] }), "emptyLoopValues"));
  check("a zero loop bound is invalidLoopBounds (existing)", has(loopEdge({ mode: "count", maxIterations: 0 }), "invalidLoopBounds"));
  check("a while loop with no condition is unsupportedConfiguration (existing)", has(loopEdge({ mode: "whileCondition", maxIterations: 3 }), "unsupportedConfiguration"));
}

section("9. Dead ends and priority ties (FlowValidator, formerly designer-only advisories)");
{
  const deadEnd = baseline("dead-end");
  deadEnd.edges = [edge("e1", "s", "a"), conditional("e2", "a", "b"), edge("e3", "a", "e")];
  const [issue] = issuesOf(deadEnd, "deadEndNode");
  check("a reachable step with no way out is deadEndNode (warning)", issue?.nodeId === "b" && issue.severity === "warning");
  const legacyNext = baseline("legacy-next");
  legacyNext.nodes[2] = { ...click("b"), next: "e" };
  legacyNext.edges = [edge("e1", "s", "a"), conditional("e2", "a", "b"), edge("e3", "a", "e")];
  check("a step that still routes through the legacy next field is not", !issuesOf(legacyNext, "deadEndNode").some((i) => i.nodeId === "b"));
  const ties = flow("ties", [step("s", "start"), click("a"), click("b"), step("e", "end")], [
    edge("e1", "s", "a"),
    conditional("e2", "a", "b", "equals", { priority: 1 }),
    conditional("e3", "a", "e", "notEquals", { priority: 1 }),
    edge("e4", "b", "e")
  ]);
  check("two conditionals with one priority is ambiguousConditionPriority", issuesOf(ties, "ambiguousConditionPriority")[0]?.nodeId === "a");
  ties.edges[2] = conditional("e3", "a", "e", "notEquals", { priority: 2 });
  check("...distinct priorities are not", !has(ties, "ambiguousConditionPriority"));
}

section("10. Stale references (FlowValidator; data sources and secrets fail loudly at run time)");
{
  const runFlow = flow("parent", [step("s", "start"), step("a", "runFlow", { flowId: "gone" }), step("e", "end")], [edge("e1", "s", "a"), edge("e2", "a", "e")]);
  check("a runFlow to a missing flow is missingFlowReference (existing)", validateFlowDefinition(runFlow, { referenceableFlowIds: new Set(["parent"]) }).issues.some((i) => i.code === "missingFlowReference"));
  const resolver = read("src/runner/ValueResolver.ts");
  check("a missing data source fails the step with a named error (runtime premise)", resolver.includes("No data source selected for dynamic value"));
  check("a missing secret fails the step with a named error (runtime premise)", resolver.includes("is not available. Add it in Settings → Secrets before running."));
}

section("11. Incompatible ports (retired with the two-port node model)");
check("no connector carries a port field any more", !/\b(sourceHandle|targetHandle)\b/.test(read("src/profiles/FlowProfile.ts")));

// ── Run gate ─────────────────────────────────────────────────────────────────────────────────────

section("12. The run gate (PreRunValidator over the same engine)");
{
  const scenarioOf = (profile: FlowProfile) => ({ id: "sc", name: "sc", flows: [{ flowId: profile.id, order: 1 }], links: [], maxParallelFlows: 1 }) as unknown as ScenarioProfile;
  const gate = (profile: FlowProfile) => new PreRunValidator().validate({ scenario: scenarioOf(profile), flows: [profile] });
  const lone = flow("gate-lone", [step("s", "start"), click("a"), step("e", "end")], [edge("e1", "s", "a"), conditional("e2", "a", "e")]);
  check("an active-path incomplete branch pair blocks the run", isRunBlocked(gate(lone)));
  const retry = flow("gate-retry", [step("s", "start"), click("a"), click("b"), step("e", "end")], [edge("e1", "s", "a"), edge("e2", "a", "b"), conditional("e3", "b", "a"), edge("e4", "b", "e")]);
  check("an active-path unguarded cycle blocks the run", isRunBlocked(gate(retry)));
  const warningsOnly = baseline("gate-warn");
  warningsOnly.edges.push(edge("e4", "e", "a"));
  const warnGate = gate(warningsOnly);
  check("warnings alone (a connector from End) never block", !isRunBlocked(warnGate) && warnGate.some((i) => i.code === "connectorFromEndNode" && !i.blocking));
  const pastEnd = baseline("gate-past-end");
  pastEnd.nodes.push(click("x"));
  pastEnd.edges.push(edge("e4", "e", "x"));
  const pastIssues = validateFlowDefinition(pastEnd).issues.filter((i) => i.code === "unreachableNode");
  check("a step past End is off-path, so a Legacy Compatibility grant can tolerate it", pastIssues.length > 0 && pastIssues.every((i: FlowValidationIssue) => !i.onActivePath && !isExecutionBlocking(i)));
}

// ── Workflow parity ──────────────────────────────────────────────────────────────────────────────

section("13. Workflow parity (FlowDependencyResolver)");
{
  const scenario = (links: unknown[]): ScenarioProfile =>
    ({ id: "wf", name: "wf", flows: [{ flowId: "A", order: 1 }, { flowId: "B", order: 2 }, { flowId: "C", order: 3 }], links, maxParallelFlows: 1 }) as unknown as ScenarioProfile;
  const ids = (links: unknown[]) => new FlowDependencyResolver().validate(scenario(links));
  check("a link cycle is an error (the workflow-level cycle rule)", ids([{ id: "l1", sourceFlowId: "A", targetFlowId: "B", type: "success" }, { id: "l2", sourceFlowId: "B", targetFlowId: "A", type: "success" }]).some((i) => i.id.startsWith("cycle-") && i.severity === "error"));
  check("...a loopBack link is exempt, like a Loop Back connector in a flow", !ids([{ id: "l1", sourceFlowId: "A", targetFlowId: "B", type: "success" }, { id: "l2", sourceFlowId: "B", targetFlowId: "A", type: "loopBack", maxLoopCount: 2 }]).some((i) => i.id.startsWith("cycle-")));
  check("two standard links from one flow is an error (connector structure parity)", ids([{ id: "l1", sourceFlowId: "A", targetFlowId: "B", type: "success" }, { id: "l2", sourceFlowId: "A", targetFlowId: "C", type: "success" }]).some((i) => i.id === "multiple-standard-A"));
  check("a conditional link with no expression is an error (binding parity)", ids([{ id: "l1", sourceFlowId: "A", targetFlowId: "B", type: "conditional", condition: { expression: " " } }]).some((i) => i.id === "l1-condition"));
  check("a link to a flow outside the workflow is an error (reference parity)", ids([{ id: "l1", sourceFlowId: "A", targetFlowId: "Z", type: "success" }]).some((i) => i.id === "l1"));
  check(
    "a lone conditional link is NOT a gate error: workflows schedule by dependency, with no flow-style fallback",
    !ids([{ id: "l1", sourceFlowId: "A", targetFlowId: "B", type: "conditional", condition: { expression: "true" } }]).some((i) => i.severity === "error")
  );
  check("...the Workflow Builder still shows it as an advisory", read("app/renderer/pages/ScenarioBuilder.tsx").includes("incompleteBranchPairs(edges, kindOf)"));
}

// ── Legacy profiles ──────────────────────────────────────────────────────────────────────────────

section("14. Legacy-shaped profiles");
{
  const legacy: FlowProfile = {
    id: "legacy",
    name: "Legacy",
    version: 1,
    nodes: [
      { id: "s", type: "start", name: "Start", next: "a" } as FlowStep,
      { id: "a", type: "click", name: "Click", locator: { strategy: "css", value: "#go" }, next: "b" } as FlowStep,
      { id: "b", type: "fill", name: "Fill", locator: { strategy: "css", value: "#q" }, value: "x", next: "e" } as FlowStep,
      { id: "e", type: "end", name: "End" } as FlowStep
    ],
    edges: [
      { id: "e1", source: "s", target: "a", type: "success" },
      { id: "e2", source: "a", target: "b", type: "success" },
      { id: "e3", source: "b", target: "a", type: "loopBack", maxLoopCount: 2 },
      { id: "e4", source: "b", target: "e", type: "outcome", condition: { expression: "true" } }
    ]
  };
  check("a legacy flow (no kind, loopBack retry, outcome edge, next fields) validates clean", codesOf(legacy).length === 0, codesOf(legacy));
}

// ── Runtime premises and designer parity ─────────────────────────────────────────────────────────

section("15. Runtime premises the new rules mirror (FlowExecutor source)");
{
  const executor = read("src/runner/FlowExecutor.ts");
  check("re-entering a visited step throws a runtime-cycle error", executor.includes("contains a runtime cycle at step"));
  check("only a loopBack connector clears visited", /if \(next\.viaLoopBack\) visited\.clear\(\);/.test(executor) && /type === "loopBack"/.test(executor));
  check("a parallel fan-out skips an already-visited target instead of throwing", executor.includes("already executed earlier in this flow — skipping duplicate fan-out target"));
  const fanOut = executor.indexOf("executeParallelTargets(flow, parallelEdges");
  const endCheck = executor.indexOf('if (currentStep.type === "end")');
  check("End finishes the run after the parallel fan-out", fanOut > 0 && endCheck > fanOut);
  check("a step with no outgoing connector falls back to its legacy next", executor.includes("if (!outgoing.length) return { nextStepId: step.next, viaLoopBack: false };"));
}

section("16. Designer parity (one implementation)");
{
  const designer = read("app/renderer/pages/FlowChartDesigner.tsx");
  check("the designer no longer carries its own graph advisories", !/code: "(deadEnd|conditionalValue|conditionalVariable|loopValues|conditionalPriority)"/.test(designer));
  check("the dead connectorStructureIssues copy is gone", !designer.includes("function connectorStructureIssues"));
  check("the designer still validates through validateFlowDefinition", designer.includes("validateFlowDefinition(deferredProfile"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
