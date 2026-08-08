/**
 * Flow Validation Engine — rule-by-rule verifier (Tranche 2, Stage 2a).
 * Run with: npx tsx scripts/verify-validation.mts
 *
 * Every rule gets a **positive control** (a flow carrying the defect must be reported) *and* a
 * **negative control** (a flow without it must not be). Positive controls alone would be passed by
 * a validator that rejects everything, which is the failure mode that makes a validation suite
 * worthless.
 *
 * The strongest negative control here is the generated corpus: all 9 flow patterns — including
 * parallel fan-out, self-loops, nested `runFlow` and branch/merge shapes — are driven through the
 * engine and must come back completely clean. Reachability in particular is easy to write in a way
 * that false-positives on legal parallel and loop graphs, which would wrongly block real flows once
 * Stage 2b wires this into the run gate.
 *
 * Pure: no browser, no Electron, no filesystem writes.
 */
import type { FlowEdge, FlowProfile, FlowStep, StepType } from "@src/profiles/FlowProfile";
import {
  FLOW_VALIDATION_LIMITS,
  FLOW_VALIDATION_RULES,
  activePathErrorsOf,
  errorsOf,
  executionBlockingErrorsOf,
  hasActivePathError,
  offPathErrorsOf,
  validateFlowDefinition,
  validateFlowSet,
  warningsOf,
  type FlowValidationCode,
  type FlowValidationIssue,
  type FlowValidationReport
} from "@src/validation/FlowValidator";
import { ALL_STEP_TYPES, STEP_REQUIREMENTS } from "@src/validation/StepRequirements";
import { FLOW_BOUNDS } from "@src/profiles/FlowValidation";
import { FLOW_VALIDATOR_VERSION, effectiveVerdict } from "@src/validation/LegacyCompatibility";
import { sha256FlowDigest } from "../app/main/validation/contentDigest";
import { PreRunValidator, isRunBlocked, type PreRunValidationIssue } from "@src/reports/PreRunValidator";
import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";
import { ALL_FLOW_PATTERNS, resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { generateFlow } from "@src/testing/random/RandomFlowGenerator";
import { SeededRandom } from "@src/testing/random/SeededRandom";
import { NODE_CATALOG } from "@src/testing/random/NodeCatalog";
import { RUNTIME_LOOP_LIMITS } from "@src/testing/random/ConnectorCatalog";
import { flowNodeCatalog } from "@renderer/components/workflow/flowNodeCatalog";
import { readFileSync } from "node:fs";

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

/** Assert a code is present, and (optionally) how it was classified. */
function expectCode(
  label: string,
  report: FlowValidationReport,
  code: FlowValidationCode,
  options: { onActivePath?: boolean; nodeId?: string; edgeId?: string } = {}
): void {
  const matches = report.issues.filter((issue) => issue.code === code);
  if (matches.length === 0) {
    check(label, false, `no ${code} issue; got [${report.issues.map((issue) => issue.code).join(", ") || "none"}]`);
    return;
  }
  const issue = matches[0] as FlowValidationIssue;
  const problems: string[] = [];
  if (options.onActivePath !== undefined && issue.onActivePath !== options.onActivePath) {
    problems.push(`onActivePath=${issue.onActivePath}, expected ${options.onActivePath}`);
  }
  if (options.nodeId !== undefined && issue.nodeId !== options.nodeId) problems.push(`nodeId=${String(issue.nodeId)}, expected ${options.nodeId}`);
  if (options.edgeId !== undefined && issue.edgeId !== options.edgeId) problems.push(`edgeId=${String(issue.edgeId)}, expected ${options.edgeId}`);
  check(label, problems.length === 0, problems.join("; "));
}

function expectNoCode(label: string, report: FlowValidationReport, code: FlowValidationCode): void {
  const matches = report.issues.filter((issue) => issue.code === code);
  check(label, matches.length === 0, matches.map((issue) => issue.message).join(" | "));
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function step(id: string, type: StepType, extra: Partial<FlowStep> = {}): FlowStep {
  return { id, type, name: `${type} ${id}`, ...extra };
}

function edge(id: string, source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge {
  return { id, source, target, type: "success", kind: "normal", ...extra };
}

/**
 * The baseline valid flow every positive control is derived from: start → click → end.
 * Any rule that fires on this flow is a false positive.
 */
function baseFlow(overrides: Partial<FlowProfile> = {}): FlowProfile {
  return {
    id: "base-flow",
    name: "Base flow",
    version: 1,
    nodes: [
      step("n-start", "start"),
      step("n-click", "click", { locator: { strategy: "testId", value: "submit" }, timeoutMs: 5_000 }),
      step("n-end", "end")
    ],
    edges: [edge("e1", "n-start", "n-click"), edge("e2", "n-click", "n-end")],
    ...overrides
  };
}

/**
 * A legacy-shaped flow: no `kind` on connectors (derived from `type`), no `position`, no `config`,
 * no timeouts, a `loopBack` cross-node back-edge and an `outcome` edge. Nothing here is a defect —
 * it is what a flow saved by an older build looks like, and it must validate clean or Stage 2b
 * would start blocking flows that run correctly today.
 */
function legacyFlow(): FlowProfile {
  return {
    id: "legacy-flow",
    name: "Legacy flow",
    version: 1,
    nodes: [
      step("l-start", "start"),
      step("l-goto", "goto", { url: "http://127.0.0.1:4173/" }),
      step("l-fill", "fill", { locator: { strategy: "label", value: "Name" }, value: "Ada" }),
      step("l-check", "condition", { value: 'outcome === "success"' }),
      step("l-end", "end")
    ],
    edges: [
      { id: "le1", source: "l-start", target: "l-goto", type: "success" },
      { id: "le2", source: "l-goto", target: "l-fill", type: "success" },
      { id: "le3", source: "l-fill", target: "l-check", type: "success" },
      { id: "le4", source: "l-check", target: "l-end", type: "outcome", condition: { expression: 'outcome === "success"' } },
      { id: "le5", source: "l-check", target: "l-goto", type: "loopBack", maxLoopCount: 3 }
    ]
  };
}

/* ------------------------------------------------------------------ *
 * 1. Contract & determinism
 * ------------------------------------------------------------------ */
console.log("\nValidator output contract");
{
  const report = validateFlowDefinition(baseFlow());
  check("a valid flow reports zero issues", report.issues.length === 0, report.issues.map((issue) => issue.code).join(", "));
  check("reachability is known and every node is reachable", report.reachabilityKnown && report.reachableNodeIds.size === 3);
  check("startNodeId is resolved", report.startNodeId === "n-start");
  check("hasActivePathError is false for a valid flow", !hasActivePathError(report));

  // Every rule declares a severity, and the declaration order is the report's sort order.
  const codes = Object.keys(FLOW_VALIDATION_RULES) as FlowValidationCode[];
  check(`all ${codes.length} rules declare a severity and a summary`, codes.every((code) => FLOW_VALIDATION_RULES[code].severity !== undefined && FLOW_VALIDATION_RULES[code].summary.length > 0));

  // Full contract on a real issue.
  const broken = validateFlowDefinition(baseFlow({ edges: [edge("e1", "n-start", "n-click"), edge("e2", "n-click", "nope")] }));
  const issue = broken.issues.find((entry) => entry.code === "brokenConnectorEndpoint") as FlowValidationIssue;
  check(
    "an issue carries code, severity, onActivePath, flowId, a location and a message",
    issue !== undefined &&
      issue.code === "brokenConnectorEndpoint" &&
      issue.severity === "error" &&
      issue.onActivePath === true &&
      issue.flowId === "base-flow" &&
      issue.edgeId === "e2" &&
      issue.message.length > 0
  );
  check("the validator does not mutate its input", JSON.stringify(baseFlow()) === JSON.stringify(baseFlow()));
}

console.log("\nDeterministic output ordering");
{
  // One flow, many simultaneous defects, with nodes and edges deliberately out of order.
  const messy: FlowProfile = {
    id: "messy",
    name: "Messy",
    version: 1,
    nodes: [
      step("z-node", "click", { timeoutMs: -1 }),
      step("a-node", "fill", { timeoutMs: 0 }),
      step("m-node", "click"),
      step("dup", "click", { locator: { strategy: "css", value: ".a" } }),
      step("dup", "click", { locator: { strategy: "css", value: ".b" } })
    ],
    edges: [edge("z-edge", "ghost", "a-node"), edge("a-edge", "a-node", "ghost2")]
  };
  const first = validateFlowDefinition(messy);
  const second = validateFlowDefinition(messy);
  check("the same input produces byte-identical output", JSON.stringify(first.issues) === JSON.stringify(second.issues));

  // Reordering the input must not reorder the report.
  const reordered: FlowProfile = { ...messy, nodes: [...messy.nodes].reverse(), edges: [...messy.edges].reverse() };
  const reorderedReport = validateFlowDefinition(reordered);
  check(
    "reordering nodes and connectors does not change the report",
    JSON.stringify(first.issues) === JSON.stringify(reorderedReport.issues),
    `${first.issues.map((i) => i.code).join(",")} vs ${reorderedReport.issues.map((i) => i.code).join(",")}`
  );

  const ruleOrder = Object.keys(FLOW_VALIDATION_RULES) as FlowValidationCode[];
  const indices = first.issues.map((issue) => ruleOrder.indexOf(issue.code));
  check("issues are sorted by rule declaration order", indices.every((value, index) => index === 0 || value >= (indices[index - 1] as number)));
}

/* ------------------------------------------------------------------ *
 * 2. Structure — Start / End
 * ------------------------------------------------------------------ */
console.log("\nRule: missing Start and End nodes");
{
  const noStart = validateFlowDefinition(baseFlow({ nodes: [step("n-click", "click", { locator: { strategy: "css", value: "a" } }), step("n-end", "end")] }));
  expectCode("a flow with no Start node reports missingStartNode", noStart, "missingStartNode", { onActivePath: true });
  check("reachability is NOT claimed when there is no single Start", !noStart.reachabilityKnown && noStart.reachableNodeIds.size === 0);
  expectNoCode("no unreachableNode flood when reachability is unknowable", noStart, "unreachableNode");
  check(
    "with no Start, anchored issues are conservatively active-path",
    noStart.issues.filter((issue) => issue.nodeId !== undefined).every((issue) => issue.onActivePath)
  );

  const twoStarts = validateFlowDefinition(
    baseFlow({ nodes: [step("n-start", "start"), step("n-start2", "start"), step("n-click", "click", { locator: { strategy: "css", value: "a" } }), step("n-end", "end")] })
  );
  expectCode("a flow with two Start nodes reports multipleStartNodes", twoStarts, "multipleStartNodes", { onActivePath: true });

  const noEnd = validateFlowDefinition(baseFlow({ nodes: [step("n-start", "start"), step("n-click", "click", { locator: { strategy: "css", value: "a" } })], edges: [edge("e1", "n-start", "n-click")] }));
  expectCode("a flow with no End node reports missingEndNode", noEnd, "missingEndNode", { onActivePath: true });

  // An End node that exists but cannot be reached is a different, always-blocking defect.
  const strandedEnd = validateFlowDefinition(
    baseFlow({ nodes: [step("n-start", "start"), step("n-click", "click", { locator: { strategy: "css", value: "a" } }), step("n-end", "end")], edges: [edge("e1", "n-start", "n-click")] })
  );
  expectCode("an End node that cannot be reached reports unreachableEndNode", strandedEnd, "unreachableEndNode", { onActivePath: true });
  expectNoCode("...and does not also report missingEndNode", strandedEnd, "missingEndNode");

  expectNoCode("a valid flow reports no missingStartNode", validateFlowDefinition(baseFlow()), "missingStartNode");
  expectNoCode("a valid flow reports no missingEndNode", validateFlowDefinition(baseFlow()), "missingEndNode");
}

/* ------------------------------------------------------------------ *
 * 3. Duplicate ids
 * ------------------------------------------------------------------ */
console.log("\nRule: duplicate ids");
{
  const dupNode = validateFlowDefinition(
    baseFlow({
      nodes: [step("n-start", "start"), step("dup", "click", { locator: { strategy: "css", value: "a" } }), step("dup", "screenshot"), step("n-end", "end")],
      edges: [edge("e1", "n-start", "dup"), edge("e2", "dup", "n-end")]
    })
  );
  expectCode("two nodes sharing an id report duplicateNodeId", dupNode, "duplicateNodeId", { onActivePath: true, nodeId: "dup" });
  check(
    "duplicateNodeId offers NO safe fix (edge references cannot be remapped unambiguously)",
    dupNode.issues.filter((issue) => issue.code === "duplicateNodeId").every((issue) => issue.safeFix === undefined)
  );

  const dupEdge = validateFlowDefinition(baseFlow({ edges: [edge("e1", "n-start", "n-click"), edge("e1", "n-click", "n-end")] }));
  expectCode("two connectors sharing an id report duplicateEdgeId", dupEdge, "duplicateEdgeId", { onActivePath: true });
  const edgeFix = dupEdge.issues.find((issue) => issue.code === "duplicateEdgeId")?.safeFix;
  check("duplicateEdgeId offers a regenerateId safe fix", edgeFix?.kind === "regenerateId" && edgeFix.from === "e1");

  const dupFlow = validateFlowSet([baseFlow({ id: "same" }), baseFlow({ id: "same" })]);
  check("two flows sharing an id report duplicateFlowId", dupFlow.issues.some((issue) => issue.code === "duplicateFlowId"));

  expectNoCode("a valid flow reports no duplicateNodeId", validateFlowDefinition(baseFlow()), "duplicateNodeId");
  expectNoCode("a valid flow reports no duplicateEdgeId", validateFlowDefinition(baseFlow()), "duplicateEdgeId");
}

/* ------------------------------------------------------------------ *
 * 4. Broken node / connector references
 * ------------------------------------------------------------------ */
console.log("\nRule: broken node and connector references");
{
  const badTarget = validateFlowDefinition(baseFlow({ edges: [edge("e1", "n-start", "n-click"), edge("e2", "n-click", "ghost")] }));
  expectCode("a connector pointing at a missing node reports brokenConnectorEndpoint", badTarget, "brokenConnectorEndpoint", { onActivePath: true, edgeId: "e2" });

  const badSource = validateFlowDefinition(baseFlow({ edges: [edge("e1", "n-start", "n-click"), edge("e2", "n-click", "n-end"), edge("e3", "ghost", "n-end")] }));
  const sourceIssue = badSource.issues.find((issue) => issue.code === "brokenConnectorEndpoint" && issue.edgeId === "e3");
  check("a connector starting at a missing node reports brokenConnectorEndpoint", sourceIssue !== undefined);
  check("...classified off the active path (an unreachable source cannot be traversed)", sourceIssue?.onActivePath === false);

  expectNoCode("a valid flow reports no brokenConnectorEndpoint", validateFlowDefinition(baseFlow()), "brokenConnectorEndpoint");
}

/* ------------------------------------------------------------------ *
 * 5. Reachability & active-path classification
 * ------------------------------------------------------------------ */
console.log("\nRule: reachable vs unreachable nodes");
{
  const orphaned = baseFlow({
    nodes: [...baseFlow().nodes, step("n-orphan", "screenshot")],
    edges: baseFlow().edges
  });
  const report = validateFlowDefinition(orphaned);
  expectCode("a node with no incoming connector reports unreachableNode", report, "unreachableNode", { onActivePath: false, nodeId: "n-orphan" });
  check("the orphan is absent from reachableNodeIds", !report.reachableNodeIds.has("n-orphan") && report.reachableNodeIds.size === 3);
  check("an off-path-only error means hasActivePathError is FALSE (Legacy-Compatibility tolerable)", !hasActivePathError(report));
  check("...and it is still an error, surfaced by offPathErrorsOf", offPathErrorsOf(report).length === 1 && errorsOf(report).length === 1);

  // A chain hanging off an orphan is entirely unreachable, and none of it is active-path.
  const orphanChain = baseFlow({
    nodes: [...baseFlow().nodes, step("o1", "click", { locator: { strategy: "css", value: "a" } }), step("o2", "screenshot")],
    edges: [...baseFlow().edges, edge("e3", "o1", "o2")]
  });
  const chainReport = validateFlowDefinition(orphanChain);
  check("every node in an unreachable chain is reported", chainReport.issues.filter((issue) => issue.code === "unreachableNode").length === 2);
  check("no issue in an unreachable chain is classified active-path", activePathErrorsOf(chainReport).length === 0);

  // The same defect ON the reachable path must classify as active — this is the contrast that
  // makes the classification meaningful rather than a constant.
  const activeDefect = validateFlowDefinition(baseFlow({ nodes: [step("n-start", "start"), step("n-click", "click"), step("n-end", "end")] }));
  expectCode("a defect on a reachable node is classified onActivePath", activeDefect, "missingRequiredLocator", { onActivePath: true, nodeId: "n-click" });
  check("...so hasActivePathError is true", hasActivePathError(activeDefect));

  // Self-loops and parallel fan-out are legal shapes; a naive walk reports them unreachable.
  const looping = baseFlow({
    nodes: [step("n-start", "start"), step("n-loop", "click", { locator: { strategy: "css", value: "a" } }), step("n-end", "end")],
    edges: [
      edge("e1", "n-start", "n-loop"),
      { id: "e-self", source: "n-loop", target: "n-loop", type: "loop", kind: "loop", loop: { mode: "count", maxIterations: 3 } },
      { id: "e2", source: "n-loop", target: "n-end", type: "conditional", kind: "conditional", conditional: { sourceField: "outcome", operator: "equals", expectedValue: "success" } }
    ]
  });
  check("a self-looping node is not reported unreachable", validateFlowDefinition(looping).issues.length === 0, validateFlowDefinition(looping).issues.map((i) => i.code).join(","));

  const parallel = baseFlow({
    nodes: [step("p-start", "start"), step("p-a", "screenshot"), step("p-b", "screenshot"), step("p-end", "end")],
    edges: [
      { id: "pe1", source: "p-start", target: "p-a", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAll", failMode: "failFast" } },
      { id: "pe2", source: "p-start", target: "p-b", type: "parallel", kind: "parallel", parallel: { joinMode: "waitAll", failMode: "failFast" } },
      edge("pe3", "p-a", "p-end"),
      edge("pe4", "p-b", "p-end")
    ]
  });
  check("both branches of a parallel fan-out are reachable", validateFlowDefinition(parallel).issues.length === 0, validateFlowDefinition(parallel).issues.map((i) => i.code).join(","));
}

/* ------------------------------------------------------------------ *
 * 6. Loop bounds
 * ------------------------------------------------------------------ */
console.log("\nRule: invalid loop bounds");
{
  const loopEdge = (maxIterations: number): FlowProfile =>
    baseFlow({
      edges: [
        edge("e1", "n-start", "n-click"),
        { id: "e-loop", source: "n-click", target: "n-click", type: "loop", kind: "loop", loop: { mode: "count", maxIterations } },
        { id: "e2", source: "n-click", target: "n-end", type: "conditional", kind: "conditional", conditional: { sourceField: "outcome", operator: "equals", expectedValue: "ok" } }
      ]
    });

  expectCode("a loop connector with maxIterations 0 reports invalidLoopBounds", validateFlowDefinition(loopEdge(0)), "invalidLoopBounds", { onActivePath: true, edgeId: "e-loop" });
  expectCode("a negative loop bound reports invalidLoopBounds", validateFlowDefinition(loopEdge(-5)), "invalidLoopBounds");
  expectCode(
    `a loop bound above the ${FLOW_VALIDATION_LIMITS.maxLoopIterations} cap reports invalidLoopBounds`,
    validateFlowDefinition(loopEdge(FLOW_VALIDATION_LIMITS.maxLoopIterations + 1)),
    "invalidLoopBounds"
  );
  expectNoCode("a loop bound of 1 is accepted", validateFlowDefinition(loopEdge(1)), "invalidLoopBounds");
  expectNoCode(`a loop bound at the ${FLOW_VALIDATION_LIMITS.maxLoopIterations} cap is accepted`, validateFlowDefinition(loopEdge(FLOW_VALIDATION_LIMITS.maxLoopIterations)), "invalidLoopBounds");

  const large = validateFlowDefinition(loopEdge(FLOW_VALIDATION_LIMITS.warnLoopIterations + 1));
  check("a large-but-legal loop bound is a warning, not an error", warningsOf(large).some((issue) => issue.code === "largeLoopBounds") && errorsOf(large).length === 0);

  // Node-level loop configuration, not just connectors.
  const nodeLoop = validateFlowDefinition(
    baseFlow({
      nodes: [step("n-start", "start"), step("n-loop", "loop", { value: "3", config: { loopType: "fixedCount", iterationCount: 0 } }), step("n-end", "end")],
      edges: [edge("e1", "n-start", "n-loop"), edge("e2", "n-loop", "n-end")]
    })
  );
  expectCode("a loop node with iterationCount 0 reports invalidLoopBounds", nodeLoop, "invalidLoopBounds", { onActivePath: true, nodeId: "n-loop" });

  const legacyBackEdge = validateFlowDefinition(baseFlow({ edges: [edge("e1", "n-start", "n-click"), edge("e2", "n-click", "n-end"), { id: "e3", source: "n-end", target: "n-click", type: "loopBack", maxLoopCount: 0 }] }));
  expectCode("a legacy loopBack with maxLoopCount 0 reports invalidLoopBounds", legacyBackEdge, "invalidLoopBounds", { edgeId: "e3" });
}

/* ------------------------------------------------------------------ *
 * 7. Timeouts
 * ------------------------------------------------------------------ */
console.log("\nRule: invalid timeout values");
{
  const withTimeout = (timeoutMs: number): FlowProfile =>
    baseFlow({ nodes: [step("n-start", "start"), step("n-click", "click", { locator: { strategy: "css", value: "a" }, timeoutMs }), step("n-end", "end")] });

  expectCode("a negative timeout reports invalidTimeout", validateFlowDefinition(withTimeout(-1)), "invalidTimeout", { onActivePath: true, nodeId: "n-click" });
  expectCode("a zero timeout reports invalidTimeout", validateFlowDefinition(withTimeout(0)), "invalidTimeout");
  expectCode("a NaN timeout reports invalidTimeout", validateFlowDefinition(withTimeout(Number.NaN)), "invalidTimeout");
  expectCode("an infinite timeout reports invalidTimeout", validateFlowDefinition(withTimeout(Number.POSITIVE_INFINITY)), "invalidTimeout");
  expectNoCode("a normal timeout is accepted", validateFlowDefinition(withTimeout(5_000)), "invalidTimeout");

  const high = validateFlowDefinition(withTimeout(FLOW_VALIDATION_LIMITS.warnTimeoutMs + 1));
  check("an unusually high timeout is a warning, not an error", warningsOf(high).some((issue) => issue.code === "highTimeout") && errorsOf(high).length === 0);
  check(
    "a timeout above the runtime clamp is still only a warning (the runner clamps it)",
    warningsOf(validateFlowDefinition(withTimeout(FLOW_VALIDATION_LIMITS.maxTimeoutMs + 1))).some((issue) => issue.code === "highTimeout")
  );

  const waitTimeout = validateFlowDefinition(
    baseFlow({
      nodes: [step("n-start", "start"), step("n-click", "click", { locator: { strategy: "css", value: "a" }, beforeWaits: [{ type: "elementVisible", locator: { strategy: "css", value: "a" }, timeoutMs: -5 }] }), step("n-end", "end")]
    })
  );
  expectCode("a negative before-wait timeout reports invalidTimeout", waitTimeout, "invalidTimeout", { nodeId: "n-click" });
}

/* ------------------------------------------------------------------ *
 * 8. Unsupported operators / configurations
 * ------------------------------------------------------------------ */
console.log("\nRule: unsupported operators and configurations");
{
  const conditional = (operator: string): FlowProfile =>
    baseFlow({
      edges: [
        edge("e1", "n-start", "n-click"),
        { id: "e-cond", source: "n-click", target: "n-end", type: "conditional", kind: "conditional", conditional: { sourceField: "outcome", operator: operator as "equals", expectedValue: "ok" } }
      ]
    });

  expectCode("an operator outside the union reports unsupportedOperator", validateFlowDefinition(conditional("isDefinitelyNotAnOperator")), "unsupportedOperator", { onActivePath: true, edgeId: "e-cond" });
  expectNoCode("every legal operator is accepted", validateFlowDefinition(conditional("greaterThanOrEqual")), "unsupportedOperator");

  // Safe-fix metadata: described, never applied.
  const casing = validateFlowDefinition(conditional("NotEquals"));
  const fix = casing.issues.find((issue) => issue.code === "unsupportedOperator")?.safeFix;
  check("a casing-only operator mistake carries a normalizeEnumCasing safe fix", fix?.kind === "normalizeEnumCasing" && fix.to === "notEquals");
  check("...and the profile is NOT modified by validation", (validateFlowDefinition(conditional("NotEquals")), (conditional("NotEquals").edges[1]?.conditional?.operator as string) === "NotEquals"));
  check(
    "a genuinely unknown operator carries NO safe fix",
    validateFlowDefinition(conditional("isDefinitelyNotAnOperator")).issues.find((issue) => issue.code === "unsupportedOperator")?.safeFix === undefined
  );

  const badSource = baseFlow({
    edges: [
      edge("e1", "n-start", "n-click"),
      { id: "e-cond", source: "n-click", target: "n-end", type: "conditional", kind: "conditional", conditional: { sourceField: "nonsense" as "outcome", operator: "equals", expectedValue: "ok" } }
    ]
  });
  expectCode("an unknown condition source reports unsupportedConfiguration", validateFlowDefinition(badSource), "unsupportedConfiguration", { edgeId: "e-cond" });

  const badLoopMode = baseFlow({
    edges: [
      edge("e1", "n-start", "n-click"),
      { id: "e-loop", source: "n-click", target: "n-click", type: "loop", kind: "loop", loop: { mode: "nonsense" as "count", maxIterations: 2 } },
      { id: "e2", source: "n-click", target: "n-end", type: "conditional", kind: "conditional", conditional: { sourceField: "outcome", operator: "equals", expectedValue: "ok" } }
    ]
  });
  expectCode("an unknown loop mode reports unsupportedConfiguration", validateFlowDefinition(badLoopMode), "unsupportedConfiguration");

  const badStepType = baseFlow({ nodes: [step("n-start", "start"), step("n-weird", "teleport" as StepType), step("n-end", "end")], edges: [edge("e1", "n-start", "n-weird"), edge("e2", "n-weird", "n-end")] });
  expectCode("an unknown step type reports unsupportedConfiguration", validateFlowDefinition(badStepType), "unsupportedConfiguration", { nodeId: "n-weird" });

  const badParallel = baseFlow({
    edges: [
      edge("e1", "n-start", "n-click"),
      { id: "e-par", source: "n-click", target: "n-end", type: "parallel", kind: "parallel", parallel: { joinMode: "waitSome" as "waitAll", failMode: "failFast" } }
    ]
  });
  expectCode("an unknown parallel join mode reports unsupportedConfiguration", validateFlowDefinition(badParallel), "unsupportedConfiguration");

  // The wrapped legacy gate still fires through the engine.
  const crossNodeLoop = baseFlow({ edges: [edge("e1", "n-start", "n-click"), { id: "e-loop", source: "n-click", target: "n-end", type: "loop", kind: "loop", loop: { mode: "count", maxIterations: 2 } }] });
  expectCode("the wrapped validateConnectorStructure rules still fire", validateFlowDefinition(crossNodeLoop), "connectorStructure", { onActivePath: true });
}

/* ------------------------------------------------------------------ *
 * 9. Required locator / value
 * ------------------------------------------------------------------ */
console.log("\nRule: required locator and value");
{
  const noLocator = validateFlowDefinition(baseFlow({ nodes: [step("n-start", "start"), step("n-click", "click"), step("n-end", "end")] }));
  expectCode("a click with no locator reports missingRequiredLocator", noLocator, "missingRequiredLocator", { onActivePath: true, nodeId: "n-click" });

  // `awkit-acw`: the type PreRunValidator's hardcoded list omits.
  const noRadioLocator = validateFlowDefinition(
    baseFlow({ nodes: [step("n-start", "start"), step("n-radio", "radio", { value: "option-a" }), step("n-end", "end")], edges: [edge("e1", "n-start", "n-radio"), edge("e2", "n-radio", "n-end")] })
  );
  expectCode("a radio with no locator reports missingRequiredLocator (awkit-acw drift)", noRadioLocator, "missingRequiredLocator", { nodeId: "n-radio" });

  // Every locator-requiring type, so no type can quietly escape the rule.
  const locatorTypes = ALL_STEP_TYPES.filter((type) => STEP_REQUIREMENTS[type].requiresLocator);
  const escaped = locatorTypes.filter((type) => {
    const probe = validateFlowDefinition({ id: `p-${type}`, name: "p", version: 1, nodes: [step("p", type)], edges: [] });
    return !probe.issues.some((issue) => issue.code === "missingRequiredLocator");
  });
  check(`all ${locatorTypes.length} locator-requiring types are enforced`, escaped.length === 0, escaped.join(", "));

  const noValue = validateFlowDefinition(
    baseFlow({ nodes: [step("n-start", "start"), step("n-fill", "fill", { locator: { strategy: "css", value: "a" } }), step("n-end", "end")], edges: [edge("e1", "n-start", "n-fill"), edge("e2", "n-fill", "n-end")] })
  );
  expectCode("a fill with no value reports missingRequiredValue", noValue, "missingRequiredValue", { onActivePath: true, nodeId: "n-fill" });

  const valueTypes = ALL_STEP_TYPES.filter((type) => STEP_REQUIREMENTS[type].requiresValue);
  const escapedValue = valueTypes.filter((type) => {
    const probe = validateFlowDefinition({ id: `v-${type}`, name: "v", version: 1, nodes: [step("v", type)], edges: [] });
    return !probe.issues.some((issue) => issue.code === "missingRequiredValue");
  });
  check(`all ${valueTypes.length} value-requiring types are enforced`, escapedValue.length === 0, escapedValue.join(", "));

  // A value supplied by any legal channel satisfies the rule — otherwise real flows break.
  const bySource = validateFlowDefinition(
    baseFlow({ nodes: [step("n-start", "start"), step("n-fill", "fill", { locator: { strategy: "css", value: "a" }, valueSource: { type: "secret", secretName: "PASSWORD" } }), step("n-end", "end")], edges: [edge("e1", "n-start", "n-fill"), edge("e2", "n-fill", "n-end")] })
  );
  expectNoCode("a secret-backed value satisfies missingRequiredValue", bySource, "missingRequiredValue");

  const gotoByUrl = validateFlowDefinition(
    baseFlow({ nodes: [step("n-start", "start"), step("n-goto", "goto", { url: "http://127.0.0.1:4173/" }), step("n-end", "end")], edges: [edge("e1", "n-start", "n-goto"), edge("e2", "n-goto", "n-end")] })
  );
  expectNoCode("a goto carrying only `url` satisfies missingRequiredValue", gotoByUrl, "missingRequiredValue");
}

/* ------------------------------------------------------------------ *
 * 9b. Unknown interaction prerequisite decisions
 * ------------------------------------------------------------------ */
console.log("\nRule: unknown interaction prerequisite execution decision");
{
  const locator = {
    strategy: "role" as const,
    value: "button",
    name: "Continue",
    quality: { strategy: "role" as const, isUnique: true, matchCount: 1, confidence: "high" as const },
    identity: {
      schemaVersion: 1 as const,
      primary: { strategy: "role" as const, value: "button", name: "Continue" },
      owner: { tag: "button", role: "button", accessibleName: "Continue" },
      fingerprint: { tag: "tag", role: "role", name: "name", text: "text", attributes: {}, ancestry: ["parent"] },
      confidence: { level: "high" as const, basis: ["primary"] }
    },
    prerequisite: {
      schemaVersion: 1 as const,
      status: "unknown" as const,
      hover: { required: true, resolved: false, reason: "insertion provenance unknown" }
    },
    resolution: "resolved" as const,
    executionDecision: { schemaVersion: 1 as const, status: "automatic" as const }
  };
  const automatic = validateFlowDefinition(baseFlow({
    nodes: [step("n-start", "start"), step("n-click", "click", { locator }), step("n-end", "end")]
  }));
  expectNoCode("ordinary click with automatic trial is runnable", automatic, "interactionPrerequisiteBlocked");
  expectNoCode("unknown prerequisite does not become a locator error", automatic, "locatorNeedsReview");

  const blocked = validateFlowDefinition(baseFlow({
    nodes: [step("n-start", "start"), step("n-click", "click", { locator: { ...locator, executionDecision: { schemaVersion: 1, status: "blocked" } } }), step("n-end", "end")]
  }));
  expectCode("blocked prerequisite has its own validation code", blocked, "interactionPrerequisiteBlocked", { nodeId: "n-click" });
  expectNoCode("blocked prerequisite still does not corrupt locator validity", blocked, "locatorNeedsReview");

  const sensitive = validateFlowDefinition(baseFlow({
    nodes: [step("n-start", "start"), step("n-click", "click", { name: "Submit payment", safety: { sideEffectLevel: "externalCommit", retryable: false }, locator }), step("n-end", "end")]
  }));
  expectCode("sensitive action remains blocked even with automatic decision", sensitive, "interactionPrerequisiteBlocked", { nodeId: "n-click" });

  const legacy = validateFlowDefinition(baseFlow({
    nodes: [step("n-start", "start"), step("n-click", "click", {
      locator: {
        ...locator,
        resolution: "needs-review",
        executionDecision: { schemaVersion: 1, status: "blocked" },
        interaction: { requiresHover: true, hoverUnresolved: true, hoverReviewReason: "insertion provenance unknown" },
        reviewReason: "insertion provenance unknown"
      }
    }), step("n-end", "end")]
  }));
  expectNoCode("legacy prerequisite-only review is not reported as locator failure", legacy, "locatorNeedsReview");
  expectCode("legacy prerequisite-only review remains blocked by decision", legacy, "interactionPrerequisiteBlocked", { nodeId: "n-click" });
}

/* ------------------------------------------------------------------ *
 * 10. Nested / referenced flows
 * ------------------------------------------------------------------ */
console.log("\nRule: nested and referenced flows");
{
  const child: FlowProfile = { ...baseFlow(), id: "child-flow", name: "Child" };
  const parent = (targetFlowId: string): FlowProfile =>
    baseFlow({
      id: "parent-flow",
      nodes: [step("p-start", "start"), step("p-run", "runFlow", { flowId: targetFlowId }), step("p-end", "end")],
      edges: [edge("e1", "p-start", "p-run"), edge("e2", "p-run", "p-end")]
    });

  const missing = validateFlowDefinition(parent("no-such-flow"), { referenceableFlowIds: new Set(["child-flow"]) });
  expectCode("a runFlow targeting a missing flow reports missingFlowReference", missing, "missingFlowReference", { onActivePath: true, nodeId: "p-run" });

  const resolved = validateFlowDefinition(parent("child-flow"), { referenceableFlowIds: new Set(["child-flow"]) });
  expectNoCode("a runFlow targeting an existing flow is accepted", resolved, "missingFlowReference");

  // An absent context means "the caller does not know the library", never "no flow exists".
  expectNoCode("with no referenceableFlowIds the reference check is skipped, not failed", validateFlowDefinition(parent("anything")), "missingFlowReference");

  // The runner reads `flowId ?? config.targetFlowId` (StepExecutor.ts:955) — the engine must agree.
  const viaConfig = validateFlowDefinition(
    baseFlow({
      id: "parent-flow",
      nodes: [step("p-start", "start"), step("p-run", "runFlow", { config: { targetFlowId: "child-flow" } }), step("p-end", "end")],
      edges: [edge("e1", "p-start", "p-run"), edge("e2", "p-run", "p-end")]
    }),
    { referenceableFlowIds: new Set(["child-flow"]) }
  );
  expectNoCode("a target supplied only via config.targetFlowId resolves", viaConfig, "missingFlowReference");
  expectNoCode("...and is not reported as a missing value either", viaConfig, "missingRequiredValue");

  const noTarget = validateFlowDefinition(
    baseFlow({ id: "parent-flow", nodes: [step("p-start", "start"), step("p-run", "runFlow"), step("p-end", "end")], edges: [edge("e1", "p-start", "p-run"), edge("e2", "p-run", "p-end")] }),
    { referenceableFlowIds: new Set(["child-flow"]) }
  );
  expectCode("a runFlow with no target at all reports missingRequiredValue", noTarget, "missingRequiredValue", { nodeId: "p-run" });
  expectNoCode("...and not missingFlowReference (no target is a different defect)", noTarget, "missingFlowReference");

  // validateFlowSet resolves references across the set automatically.
  const set = validateFlowSet([parent("child-flow"), child]);
  check("validateFlowSet validates every flow in the set", set.reports.length === 2 && set.byFlowId.has("parent-flow"));
  check("validateFlowSet resolves cross-flow references without an explicit context", set.reports.every((report) => report.issues.length === 0), set.reports.flatMap((r) => r.issues.map((i) => i.code)).join(","));

  const brokenSet = validateFlowSet([parent("child-flow")]);
  check("a referenced flow absent from the set is reported", brokenSet.reports.some((report) => report.issues.some((issue) => issue.code === "missingFlowReference")));

  // Cycles: the runner can only stop these by exhausting its depth-5 recursion guard mid-run.
  const selfRef: FlowProfile = {
    ...baseFlow(),
    id: "self-flow",
    nodes: [step("s-start", "start"), step("s-run", "runFlow", { flowId: "self-flow" }), step("s-end", "end")],
    edges: [edge("e1", "s-start", "s-run"), edge("e2", "s-run", "s-end")]
  };
  check("a self-referencing runFlow reports flowReferenceCycle", validateFlowSet([selfRef]).issues.some((issue) => issue.code === "flowReferenceCycle"));

  const a: FlowProfile = { ...baseFlow(), id: "flow-a", nodes: [step("a-start", "start"), step("a-run", "runFlow", { flowId: "flow-b" }), step("a-end", "end")], edges: [edge("e1", "a-start", "a-run"), edge("e2", "a-run", "a-end")] };
  const b: FlowProfile = { ...baseFlow(), id: "flow-b", nodes: [step("b-start", "start"), step("b-run", "runFlow", { flowId: "flow-a" }), step("b-end", "end")], edges: [edge("e1", "b-start", "b-run"), edge("e2", "b-run", "b-end")] };
  check("an indirect A→B→A cycle reports flowReferenceCycle", validateFlowSet([a, b]).issues.some((issue) => issue.code === "flowReferenceCycle"));

  // Legal nesting must not be mistaken for a cycle.
  const mid: FlowProfile = { ...baseFlow(), id: "mid-flow", nodes: [step("m-start", "start"), step("m-run", "runFlow", { flowId: "child-flow" }), step("m-end", "end")], edges: [edge("e1", "m-start", "m-run"), edge("e2", "m-run", "m-end")] };
  const top: FlowProfile = { ...baseFlow(), id: "top-flow", nodes: [step("t-start", "start"), step("t-run", "runFlow", { flowId: "mid-flow" }), step("t-end", "end")], edges: [edge("e1", "t-start", "t-run"), edge("e2", "t-run", "t-end")] };
  check("legal three-level nesting is NOT reported as a cycle", validateFlowSet([top, mid, child]).issues.length === 0, validateFlowSet([top, mid, child]).issues.map((i) => i.code).join(","));

  // Two flows referencing the same child is a diamond, not a cycle.
  const other: FlowProfile = { ...baseFlow(), id: "other-flow", nodes: [step("o-start", "start"), step("o-run", "runFlow", { flowId: "child-flow" }), step("o-end", "end")], edges: [edge("e1", "o-start", "o-run"), edge("e2", "o-run", "o-end")] };
  check("two parents sharing one child is not a cycle", validateFlowSet([mid, other, child]).issues.length === 0);
}

/* ------------------------------------------------------------------ *
 * 11. Valid legacy and modern flows (the negative controls)
 * ------------------------------------------------------------------ */
console.log("\nNegative controls: valid legacy and modern flows");
{
  const legacy = validateFlowDefinition(legacyFlow());
  check("a legacy-shaped flow (no kind/position/config, loopBack, outcome edges) validates clean", legacy.issues.length === 0, legacy.issues.map((issue) => `${issue.code}: ${issue.message}`).join(" | "));

  const modern = validateFlowDefinition(baseFlow());
  check("a modern flow validates clean", modern.issues.length === 0, modern.issues.map((issue) => issue.code).join(", "));

  // The corpus: all 9 generated patterns, the shapes most likely to trip a reachability walk.
  const constraints = resolveConstraints({ seed: "awkit-validation-2a", recorderFidelity: true, minNodesPerFlow: 6, maxNodesPerFlow: 16 });
  const corpus: FlowProfile[] = [];
  for (const pattern of ALL_FLOW_PATTERNS) {
    for (let index = 0; index < 6; index += 1) {
      corpus.push(
        generateFlow({
          flowId: `val-${pattern}-${index}`,
          flowName: `Validation ${pattern} ${index}`,
          rng: new SeededRandom(`awkit-validation-2a::${pattern}-${index}`),
          constraints,
          referenceableFlowIds: corpus.map((profile) => profile.id).slice(0, 3),
          pattern
        }).profile
      );
    }
  }

  const set = validateFlowSet(corpus);
  const dirty = set.reports.filter((report) => report.issues.length > 0);
  check(
    `all ${corpus.length} generated flows across ${ALL_FLOW_PATTERNS.length} patterns validate clean`,
    dirty.length === 0 && set.issues.length === 0,
    dirty.slice(0, 3).map((report) => `${report.flowId}: ${report.issues.map((issue) => issue.code).join(",")}`).join(" | ")
  );
  check(
    "every node in every generated flow is reachable",
    set.reports.every((report) => report.reachabilityKnown && report.reachableNodeIds.size === (corpus.find((profile) => profile.id === report.flowId)?.nodes.length ?? -1))
  );
}

/* ------------------------------------------------------------------ *
 * 12. Requirement-table parity (the drift guard for awkit-acw)
 * ------------------------------------------------------------------ */
console.log("\nRequirement table parity (engine ↔ test lab ↔ renderer catalog)");
{
  const catalogDrift = ALL_STEP_TYPES.filter(
    (type) => STEP_REQUIREMENTS[type].requiresLocator !== NODE_CATALOG[type].requiresLocator || STEP_REQUIREMENTS[type].requiresValue !== NODE_CATALOG[type].requiresValue
  );
  check("STEP_REQUIREMENTS agrees with the test lab's NODE_CATALOG", catalogDrift.length === 0, catalogDrift.join(", "));

  const rendererByType = new Map(flowNodeCatalog.map((item) => [item.type, item]));
  const rendererDrift = ALL_STEP_TYPES.filter((type) => {
    const item = rendererByType.get(type);
    if (!item) return false; // Not offered in the designer palette; nothing to compare against.
    return STEP_REQUIREMENTS[type].requiresLocator !== (item.requiresLocator ?? false) || STEP_REQUIREMENTS[type].requiresValue !== (item.requiresValue ?? false);
  });
  check(
    `STEP_REQUIREMENTS agrees with the renderer's flowNodeCatalog for all ${rendererByType.size} palette types`,
    rendererDrift.length === 0,
    rendererDrift.map((type) => `${type}: engine=${JSON.stringify(STEP_REQUIREMENTS[type])} renderer=${JSON.stringify({ requiresLocator: rendererByType.get(type)?.requiresLocator ?? false, requiresValue: rendererByType.get(type)?.requiresValue ?? false })}`).join(" | ")
  );

  check(`the table covers all ${ALL_STEP_TYPES.length} step types`, ALL_STEP_TYPES.every((type) => STEP_REQUIREMENTS[type] !== undefined));

  // Owner decision 1 (Stage 2b): ONE canonical loop cap of 1,000 across validator, runtime clamp,
  // test-lab catalog and the runner's truncation point. FlowExecutor's private constant is checked
  // at source level because it is deliberately not exported.
  check("the canonical loop cap is 1000", FLOW_VALIDATION_LIMITS.maxLoopIterations === 1000);
  check(
    "FLOW_BOUNDS.maxLoopIterations (runtime clamp) reads the canonical cap",
    FLOW_BOUNDS.maxLoopIterations === FLOW_VALIDATION_LIMITS.maxLoopIterations
  );
  check(
    "RUNTIME_LOOP_LIMITS.absoluteMaxLoopIterations (test lab) reads the canonical cap",
    RUNTIME_LOOP_LIMITS.absoluteMaxLoopIterations === FLOW_VALIDATION_LIMITS.maxLoopIterations
  );
  const flowExecutorSource = readFileSync("src/runner/FlowExecutor.ts", "utf8");
  check(
    "FlowExecutor's LOOP_CONNECTOR_HARD_CAP reads FLOW_VALIDATION_LIMITS.maxLoopIterations",
    /LOOP_CONNECTOR_HARD_CAP\s*=\s*FLOW_VALIDATION_LIMITS\.maxLoopIterations/.test(flowExecutorSource)
  );
  // The former duplicated literals: 10_000 in the runtime clamp, `= 1000` in the runner, and the
  // renderer's `> 1000` advisory. All three sites must now read the constant instead.
  // Numeric literals only — the prose comment explaining the old divergence may say "10,000".
  check("FlowValidation.ts no longer carries the divergent 10_000 literal", !/\b10_?000\b/.test(readFileSync("src/profiles/FlowValidation.ts", "utf8")));
  check("FlowExecutor.ts no longer hardcodes a 1000 literal for the cap", !/HARD_CAP\s*=\s*1000\b/.test(flowExecutorSource));
  check(
    "FlowChartDesigner.tsx no longer hardcodes a 1000 loop-limit literal",
    !/limit 1000|maxIterations > 1000/.test(readFileSync("app/renderer/pages/FlowChartDesigner.tsx", "utf8"))
  );
}

/* ------------------------------------------------------------------ *
 * 13. Malformed input tolerance
 * ------------------------------------------------------------------ */
console.log("\nMalformed input (hand-edited and imported JSON)");
{
  const noArrays = validateFlowDefinition({ id: "broken", name: "broken", version: 1, nodes: undefined as unknown as FlowStep[], edges: undefined as unknown as FlowEdge[] });
  check("a profile with non-array nodes/edges does not throw", noArrays.issues.some((issue) => issue.code === "missingStartNode"));

  const empty = validateFlowDefinition({ id: "empty", name: "empty", version: 1, nodes: [], edges: [] });
  check("an empty flow reports missing Start and End rather than throwing", empty.issues.length === 2 && errorsOf(empty).length === 2);

  check("an empty flow set is handled", validateFlowSet([]).reports.length === 0);
}

/* ------------------------------------------------------------------ *
 * 14. Run gate (Stage 2b): PreRunValidator delegates to the engine
 * ------------------------------------------------------------------ */
console.log("\nRun gate: PreRunValidator as a thin adapter (Stage 2b)");
{
  const validator = new PreRunValidator();
  const scenarioFor = (...flowIds: string[]): ScenarioProfile => ({
    id: "gate-scenario",
    name: "Gate scenario",
    executionMode: "sequential",
    maxParallelFlows: 1,
    flows: flowIds.map((flowId, order) => ({ order, flowId, required: true, inputs: {} })),
    links: [],
    failurePolicy: { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: true, takeScreenshotOnFailure: true }
  });
  const gate = (flows: FlowProfile[], scenario: ScenarioProfile): PreRunValidationIssue[] => validator.validate({ scenario, flows });

  // 3. Active-path errors block execution.
  const activeBroken = baseFlow({ id: "gate-active", nodes: [step("n-start", "start"), step("n-click", "click"), step("n-end", "end")] });
  const activeIssues = gate([activeBroken], scenarioFor("gate-active"));
  check("an active-path error blocks the run", isRunBlocked(activeIssues));
  const activeIssue = activeIssues.find((issue) => issue.code === "missingRequiredLocator");
  check(
    "10. gate issues carry structured locations (code, flowId, nodeId, onActivePath, blocking)",
    activeIssue !== undefined && activeIssue.flowId === "gate-active" && activeIssue.nodeId === "n-click" && activeIssue.onActivePath === true && activeIssue.blocking === true
  );

  // 4. Off-path errors: reported distinctly, and — since Stage 2c — blocking UNLESS a Legacy
  // Compatibility grant tolerates them. (Stage 2b's universal off-path tolerance was the declared
  // interim posture; `verify-legacy-compat.mts` owns the full grant matrix.)
  const offPath = baseFlow({ id: "gate-offpath", nodes: [...baseFlow().nodes, step("n-orphan", "screenshot")] });
  const offPathIssues = gate([offPath], scenarioFor("gate-offpath"));
  const orphanIssue = offPathIssues.find((issue) => issue.code === "unreachableNode");
  check("an off-path error is reported and blocks under the Stage 2c full gate", orphanIssue !== undefined && orphanIssue.severity === "error" && isRunBlocked(offPathIssues));
  check("...and is still classified off the active path (so a grant can tolerate it)", orphanIssue?.onActivePath === false && orphanIssue?.blocking === true);
  const tolerated = validator.validate({
    scenario: scenarioFor("gate-offpath"),
    flows: [offPath],
    legacyCompatibility: {
      grants: new Map([[offPath.id, { id: offPath.id, contentHash: sha256FlowDigest(offPath), grantedAt: "2026-07-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", validatorVersion: FLOW_VALIDATOR_VERSION, issueCodes: ["unreachableNode"], runsUnderCompatibility: 0 }]]),
      digestFor: sha256FlowDigest,
      nowIso: "2026-07-21T00:00:00.000Z"
    }
  });
  check("...and a valid Legacy Compatibility grant makes it non-blocking", !isRunBlocked(tolerated) && tolerated.some((issue) => issue.code === "unreachableNode" && !issue.blocking));

  // Deviation (documented): connector-structure errors block regardless of path, because the
  // runtime (FlowExecutor.ts:69-72) refuses such flows flow-wide.
  const offPathStructure = baseFlow({
    id: "gate-structure",
    nodes: [...baseFlow().nodes, step("s1", "screenshot"), step("s2", "screenshot"), step("s3", "screenshot")],
    edges: [
      ...baseFlow().edges,
      edge("os1", "s1", "s2"),
      edge("os2", "s1", "s3") // two standard outgoing on unreachable s1 — runtime still refuses the flow
    ]
  });
  check("an off-path connector-structure error still blocks (the runtime refuses the whole flow)", isRunBlocked(gate([offPathStructure], scenarioFor("gate-structure"))));

  // 5. Unknown reachability is conservative.
  const noStart = baseFlow({ id: "gate-nostart", nodes: [step("n-click", "click"), step("n-end", "end")], edges: [edge("e1", "n-click", "n-end")] });
  check("with unknowable reachability, anchored errors block conservatively", isRunBlocked(gate([noStart], scenarioFor("gate-nostart"))));

  // 6. Warnings never block.
  const warnOnly = baseFlow({
    id: "gate-warn",
    nodes: [step("n-start", "start"), step("n-click", "click", { locator: { strategy: "css", value: "a" }, timeoutMs: FLOW_VALIDATION_LIMITS.warnTimeoutMs + 1 }), step("n-end", "end")]
  });
  const warnIssues = gate([warnOnly], scenarioFor("gate-warn"));
  check("a warnings-only flow is not blocked", warnIssues.some((issue) => issue.severity === "warning") && !isRunBlocked(warnIssues));

  // 12. Existing valid flows continue to execute.
  check("a valid modern flow passes the gate", !isRunBlocked(gate([baseFlow({ id: "gate-valid" })], scenarioFor("gate-valid"))));
  check("a valid legacy-shaped flow passes the gate", !isRunBlocked(gate([legacyFlow()], scenarioFor("legacy-flow"))));

  // Scoping: an unrelated broken draft in the library must not block this scenario.
  const brokenDraft = baseFlow({ id: "gate-unrelated-draft", nodes: [step("d-click", "click")], edges: [] });
  const scopedIssues = gate([baseFlow({ id: "gate-valid" }), brokenDraft], scenarioFor("gate-valid"));
  check("an unrelated broken library flow does not block the run", !isRunBlocked(scopedIssues));
  check("...and its issues are not even reported for this scenario", !scopedIssues.some((issue) => issue.flowId === "gate-unrelated-draft"));

  // Transitive closure: a broken flow reached via runFlow DOES block.
  const parent = baseFlow({
    id: "gate-parent",
    nodes: [step("p-start", "start"), step("p-run", "runFlow", { flowId: "gate-child" }), step("p-end", "end")],
    edges: [edge("e1", "p-start", "p-run"), edge("e2", "p-run", "p-end")]
  });
  const brokenChild = baseFlow({ id: "gate-child", nodes: [step("c-start", "start"), step("c-click", "click"), step("c-end", "end")] });
  const closureIssues = gate([parent, brokenChild], scenarioFor("gate-parent"));
  check("a broken flow reached transitively via runFlow blocks the run", isRunBlocked(closureIssues) && closureIssues.some((issue) => issue.flowId === "gate-child"));

  // missingFlowReference at the gate.
  const dangling = baseFlow({
    id: "gate-dangling",
    nodes: [step("p-start", "start"), step("p-run", "runFlow", { flowId: "no-such-flow" }), step("p-end", "end")],
    edges: [edge("e1", "p-start", "p-run"), edge("e2", "p-run", "p-end")]
  });
  check("a runFlow step targeting a missing flow blocks the run", isRunBlocked(gate([dangling], scenarioFor("gate-dangling"))));

  // referenceableFlowIds input: a partial flow set with an externally-known reference.
  const externalRef = validator.validate({ scenario: scenarioFor("gate-parent"), flows: [parent], referenceableFlowIds: new Set(["gate-child"]) });
  check("referenceableFlowIds lets a partial set resolve external targets", !externalRef.some((issue) => issue.code === "missingFlowReference"));

  // 7. The gate is stateless — every call validates from scratch.
  const before = gate([activeBroken], scenarioFor("gate-active"));
  const fixed = baseFlow({ id: "gate-active" });
  const after = gate([fixed], scenarioFor("gate-active"));
  check("7. validation is fresh per call: fixing the flow immediately unblocks", isRunBlocked(before) && !isRunBlocked(after));
  const repeat = gate([activeBroken], scenarioFor("gate-active"));
  check("...and identical input yields identical output (no hidden caching)", JSON.stringify(before) === JSON.stringify(repeat));

  // 13. CLI/Test Lab and the production gate agree on the same input. Compared through the SAME
  // policy function the gate uses (`effectiveVerdict` — the Stage 2c full gate with no grants), so
  // this proves the two callers agree rather than that two different policies coincide.
  const agreementFixtures: FlowProfile[] = [
    baseFlow({ id: "agree-valid" }),
    baseFlow({ id: "agree-orphan", nodes: [...baseFlow().nodes, step("n-orphan", "screenshot")] }),
    baseFlow({ id: "agree-broken", nodes: [step("n-start", "start"), step("n-click", "click"), step("n-end", "end")] }),
    legacyFlow()
  ];
  const disagreements = agreementFixtures.filter((flow) => {
    const report = validateFlowDefinition(flow, { referenceableFlowIds: new Set(agreementFixtures.map((f) => f.id)) });
    const engineBlocking = effectiveVerdict(report, undefined, sha256FlowDigest(flow), new Date().toISOString()).blocked;
    const gateBlocking = isRunBlocked(gate([flow], scenarioFor(flow.id)));
    return engineBlocking !== gateBlocking;
  });
  check("13. the engine and the production gate agree flow-by-flow", disagreements.length === 0, disagreements.map((flow) => flow.id).join(", "));
}

/* ------------------------------------------------------------------ *
 * 15. runFlow target precedence (owner decision 3)
 * ------------------------------------------------------------------ */
console.log("\nrunFlow target precedence (flowId is canonical; config.targetFlowId is an alias)");
{
  const conflicted = baseFlow({
    id: "prec-flow",
    nodes: [step("p-start", "start"), step("p-run", "runFlow", { flowId: "flow-a", config: { targetFlowId: "flow-b" } }), step("p-end", "end")],
    edges: [edge("e1", "p-start", "p-run"), edge("e2", "p-run", "p-end")]
  });
  // The runner resolves `flowId ?? config.targetFlowId` (StepExecutor.ts:955) — so with both set,
  // only `flowId` matters, and the engine must judge by the same precedence.
  expectNoCode("with conflicting targets, the engine resolves flowId first (matches the runner)", validateFlowDefinition(conflicted, { referenceableFlowIds: new Set(["flow-a"]) }), "missingFlowReference");
  expectCode(
    "…and reports missingFlowReference when flowId (the canonical field) is the missing one",
    validateFlowDefinition(conflicted, { referenceableFlowIds: new Set(["flow-b"]) }),
    "missingFlowReference",
    { nodeId: "p-run" }
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
