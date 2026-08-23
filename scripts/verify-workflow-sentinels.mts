import { isWorkflowFlowNode, scenarioToWorkflowProfile, workflowToScenarioProfile, type WorkflowProfile } from "@src/profiles/WorkflowProfile";
import type { EdgeVisualStyle, LoopConnectorConfig } from "@src/profiles/FlowProfile";
import {
  formatWorkflowConflictMessage,
  parseWorkflowConflictName,
  validateWorkflowProfile
} from "@src/profiles/workflowProfileValidation";
// AWKIT-WFB-001: drive the page's REAL save-path converter (extracted so it can be imported
// headlessly). This file previously exercised only the converters in WorkflowProfile.ts — which
// is exactly why the save path re-fabricating documents stayed invisible.
import {
  toWorkflowProfile,
  type ScenarioEdge,
  type ScenarioNode
} from "../app/renderer/components/scenario/workflowDocumentMapping";
import type { WorkflowSecuritySettings } from "@src/security/browser/CertificateTrust";

let passed = 0;
const check = (label: string, value: boolean) => {
  if (!value) throw new Error(label);
  passed += 1;
  console.log(`  âœ“ ${label}`);
};

const workflow: WorkflowProfile = {
  id: "sentinel-workflow",
  name: "Sentinel workflow",
  version: 1,
  nodes: [
    { id: "start", type: "start", alias: "Start", order: 0 },
    { id: "node-a", type: "flowRef", flowId: "flow-a", alias: "Flow A", order: 1, required: true, inputBindings: {} },
    { id: "end", type: "end", alias: "End", order: 2 }
  ],
  edges: [
    { id: "edge-start-a", source: "start", target: "node-a", type: "always" },
    { id: "edge-a-end", source: "node-a", target: "end", type: "success" }
  ],
  runtimeInputs: [],
  execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true }
};

const scenario = workflowToScenarioProfile(workflow);
check("Start/End remain persisted structural nodes", workflow.nodes.length === 3 && workflow.nodes.filter(isWorkflowFlowNode).length === 1);
check("only real flow references enter the execution scenario", scenario.flows.length === 1 && scenario.flows[0].flowId === "flow-a");
check("sentinel-bound canvas edges are excluded from runtime routing", scenario.links.length === 0);

const legacy: WorkflowProfile = {
  ...workflow,
  id: "legacy-workflow",
  nodes: workflow.nodes.filter(isWorkflowFlowNode),
  edges: []
};
const legacyScenario = workflowToScenarioProfile(legacy);
check("legacy workflows without sentinels still load and convert unchanged", legacyScenario.flows.length === 1 && legacyScenario.flows[0].flowId === "flow-a");

type ForwardLoopConfig = LoopConnectorConfig & {
  futureMetadata: { revision: number; policy: string };
};
const fullLoopConfig: ForwardLoopConfig = {
  mode: "dataSource",
  maxIterations: 7,
  staticValues: ["preserved-hidden-value"],
  dataSourceId: "customers",
  dataSourceBinding: "displayName",
  parameterName: "customer",
  condition: {
    sourceField: "dataSourceValue",
    variableName: "customer.active",
    operator: "equals",
    expectedValue: true,
    priority: 6,
    label: "Active customer",
    futurePredicate: "preserve-me"
  } as NonNullable<LoopConnectorConfig["condition"]> & { futurePredicate: string },
  delayMs: 25,
  label: "Customers",
  futureMetadata: { revision: 3, policy: "forward-compatible" }
};
const loopStyle: EdgeVisualStyle = {
  color: "accent",
  lineStyle: "dotted",
  thickness: 4,
  shape: "circular",
  arrowHead: "closed"
};
const loopWorkflow: WorkflowProfile = {
  ...workflow,
  id: "loop-workflow",
  nodes: [
    { id: "node-flow-a", type: "flowRef", flowId: "flow-a", alias: "Flow A", order: 1, required: true, inputBindings: {} },
    { id: "node-flow-b", type: "flowRef", flowId: "flow-b", alias: "Flow B", order: 2, required: true, inputBindings: {} }
  ],
  edges: [
    {
      id: "loop-a",
      source: "node-flow-a",
      target: "node-flow-a",
      type: "loop",
      loop: fullLoopConfig,
      style: loopStyle
    },
    { id: "exit-a", source: "node-flow-a", target: "node-flow-b", type: "conditional", condition: { expression: "true" } }
  ]
};
const loopScenario = workflowToScenarioProfile(loopWorkflow);
const scenarioLoop = loopScenario.links.find((link) => link.id === "loop-a") as
  | ((typeof loopScenario.links)[number] & { style?: EdgeVisualStyle })
  | undefined;
const scenarioExit = loopScenario.links.find((link) => link.id === "exit-a");
check(
  "workflow conversion preserves every structured Loop field and the Conditional exit",
  JSON.stringify(scenarioLoop?.loop) === JSON.stringify(fullLoopConfig) && scenarioExit?.condition?.expression === "true"
);
check(
  "workflow conversion preserves Loop connector identity and semantic endpoints",
  scenarioLoop?.id === "loop-a" && scenarioLoop.sourceFlowId === "flow-a" && scenarioLoop.targetFlowId === "flow-a"
);
check(
  "workflow conversion preserves Loop visual style",
  JSON.stringify(scenarioLoop?.style) === JSON.stringify(loopStyle)
);
check(
  "workflow conversion preserves unknown nested Loop and condition metadata",
  (scenarioLoop?.loop as ForwardLoopConfig | undefined)?.futureMetadata.policy === "forward-compatible" &&
    (scenarioLoop?.loop?.condition as (NonNullable<LoopConnectorConfig["condition"]> & { futurePredicate?: string }) | undefined)?.futurePredicate === "preserve-me"
);

const firstLoopRoundTrip = scenarioToWorkflowProfile(loopScenario);
const secondLoopScenario = workflowToScenarioProfile(firstLoopRoundTrip);
const secondLoopRoundTrip = scenarioToWorkflowProfile(secondLoopScenario);
const roundTrippedLoop = secondLoopRoundTrip.edges.find((edge) => edge.id === "loop-a");
const roundTrippedExits = secondLoopRoundTrip.edges.filter((edge) => edge.id === "exit-a" && edge.type === "conditional");
check(
  "scenario conversion preserves the full Loop configuration through two cycles",
  JSON.stringify(roundTrippedLoop?.loop) === JSON.stringify(fullLoopConfig)
);
check(
  "scenario conversion preserves Loop style through two cycles",
  JSON.stringify(roundTrippedLoop?.style) === JSON.stringify(loopStyle)
);
check(
  "scenario conversion keeps Loop id and canonical self-loop endpoints stable through two cycles",
  roundTrippedLoop?.id === "loop-a" && roundTrippedLoop.source === "node-flow-a" && roundTrippedLoop.target === "node-flow-a"
);
check(
  "two conversion cycles keep exactly one Conditional exit with its routing expression",
  roundTrippedExits.length === 1 && roundTrippedExits[0].source === "node-flow-a" &&
    roundTrippedExits[0].target === "node-flow-b" && roundTrippedExits[0].condition?.expression === "true"
);

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const errorsFor = (candidate: unknown): string[] => {
  const result = validateWorkflowProfile(candidate);
  return result.ok ? [] : result.errors;
};

check("a structurally valid workflow profile passes the import validator", validateWorkflowProfile(workflow).ok);

const missingId = clone(workflow) as Partial<WorkflowProfile>;
delete missingId.id;
check("missing workflow id reports the named id error", errorsFor(missingId).includes("Workflow id must be a non-empty string."));

const missingName = clone(workflow) as Partial<WorkflowProfile>;
delete missingName.name;
check("missing workflow name reports the named name error", errorsFor(missingName).includes("Workflow name must be a non-empty string."));

const missingExecution = clone(workflow) as Partial<WorkflowProfile>;
delete missingExecution.execution;
check("missing execution reports the named execution error", errorsFor(missingExecution).includes("Workflow execution must be an object."));

const danglingEdge = clone(workflow);
danglingEdge.edges[0].target = "missing-node";
check(
  "an edge endpoint outside the document is rejected",
  errorsFor(danglingEdge).some((error) => error.includes('target "missing-node" does not match a node id'))
);

const missingFlowId = clone(workflow) as unknown as { nodes: Array<Record<string, unknown>> };
delete missingFlowId.nodes[1].flowId;
check(
  "a flowRef node without flowId is rejected",
  errorsFor(missingFlowId).some((error) => error.includes('Flow reference node "node-a" must have a string flowId'))
);

const requiredFieldMutation = clone(workflow) as Partial<WorkflowProfile>;
delete requiredFieldMutation.runtimeInputs;
check(
  "deleting a required field makes the valid fixture fail",
  !validateWorkflowProfile(requiredFieldMutation).ok
);

const conflictName = 'Quoted "workflow" name';
check(
  "workflow conflict producer/parser round-trips the existing name",
  parseWorkflowConflictName(formatWorkflowConflictMessage(conflictName, workflow.id)) === conflictName
);

console.log("\nSave-path converter `toWorkflowProfile` preserves, not re-derives (AWKIT-WFB-001):");
{
  const flowNodeData = (overrides: Partial<Extract<ScenarioNode["data"], { kind: "flowRef" }>> = {}) =>
    ({
      kind: "flowRef",
      flowId: "flow-a",
      name: "Flow A",
      description: "",
      order: 1,
      required: true,
      mode: "sequential",
      width: 320,
      height: 96,
      outputs: [],
      inputs: ["customerId"],
      ...overrides
    }) as ScenarioNode["data"];
  const canvasFlowNode = (id: string, data: ScenarioNode["data"]): ScenarioNode =>
    ({ id, type: "scenarioFlow", position: { x: 10, y: 20 }, data }) as ScenarioNode;
  const canvasEdge = (id: string, source: string, target: string, linkType = "success"): ScenarioEdge =>
    ({ id, source, target, data: { linkType, label: undefined, expression: "" } }) as ScenarioEdge;

  // A stored document with everything the old save path used to drop or overwrite.
  const stored: WorkflowProfile = {
    id: "wf-1",
    name: "Stored workflow",
    description: "Authored description",
    version: 7,
    security: { allowInsecureTlsForTrustedHosts: true } as WorkflowSecuritySettings,
    nodes: [
      {
        id: "node-a",
        type: "flowRef",
        flowId: "flow-a",
        alias: "Flow A",
        order: 1,
        required: true,
        inputBindings: { customerId: { type: "runtimeInput", key: "cid" } },
        jsonPath: "$.items[*]",
        runtimeInputKey: "cid",
        conditionRules: "skip-if-empty",
        retryPolicy: { count: 2, delayMs: 500 },
        failurePolicy: "manualHandoff"
      }
    ],
    edges: [],
    runtimeInputs: [{ key: "cid", label: "Customer", type: "text", required: true }],
    execution: { mode: "sequential", maxConcurrentInstances: 3, stopOnRequiredFlowFailure: false }
  };
  const saved = toWorkflowProfile(
    [canvasFlowNode("node-a", flowNodeData())],
    [canvasEdge("e1", "node-a", "node-a")],
    stored.id,
    "Renamed on canvas",
    "sequential",
    3,
    { stopOnRequiredFlowFailure: false, continueOnOptionalFlowFailure: false, takeScreenshotOnFailure: false },
    undefined,
    stored
  );
  check("authored description survives a save (not reset to the constant)", saved.description === "Authored description", String(saved.description));
  check("authored version survives a save (not pinned to 1)", saved.version === 7, String(saved.version));
  check("schema-documented security override survives a save", JSON.stringify(saved.security) === JSON.stringify(stored.security));
  check("stored runtimeInputs survive a save (no injected demo dropdown)", JSON.stringify(saved.runtimeInputs) === JSON.stringify(stored.runtimeInputs), JSON.stringify(saved.runtimeInputs));
  const savedNodeA = saved.nodes.filter(isWorkflowFlowNode)[0];
  check(
    "stored per-node fields survive a save",
    Boolean(
      savedNodeA &&
        JSON.stringify(savedNodeA.inputBindings) === JSON.stringify({ customerId: { type: "runtimeInput", key: "cid" } }) &&
        savedNodeA.jsonPath === "$.items[*]" &&
        savedNodeA.runtimeInputKey === "cid" &&
        savedNodeA.conditionRules === "skip-if-empty" &&
        JSON.stringify(savedNodeA.retryPolicy) === JSON.stringify({ count: 2, delayMs: 500 }) &&
        savedNodeA.failurePolicy === "manualHandoff"
    ),
    JSON.stringify(savedNodeA)
  );

  // A brand-new document fabricates nothing.
  const fresh = toWorkflowProfile(
    [canvasFlowNode("new-node", flowNodeData())],
    [],
    "wf-new",
    "New Workflow",
    "sequential",
    1,
    { stopOnRequiredFlowFailure: true, continueOnOptionalFlowFailure: true, takeScreenshotOnFailure: true },
    undefined,
    null
  );
  const freshNode = fresh.nodes.filter(isWorkflowFlowNode)[0];
  check(
    "a NEW node gets empty bindings — no static literals equal to the key names",
    JSON.stringify(freshNode?.inputBindings) === "{}",
    JSON.stringify(freshNode?.inputBindings)
  );
  check("a NEW document starts with no runtime inputs (no BUSINESS/PERSONAL dropdown)", fresh.runtimeInputs.length === 0, JSON.stringify(fresh.runtimeInputs));

  // AWKIT-WFB-002: the failure-policy checkboxes persist and load.
  check(
    "continueOnOptionalFlowFailure / takeScreenshotOnFailure persist in execution",
    saved.execution.continueOnOptionalFlowFailure === false && saved.execution.takeScreenshotOnFailure === false,
    JSON.stringify(saved.execution)
  );
  const backToScenario = workflowToScenarioProfile(saved);
  check(
    "the persisted policy reaches the runtime scenario profile",
    backToScenario.failurePolicy.continueOnOptionalFlowFailure === false &&
      backToScenario.failurePolicy.takeScreenshotOnFailure === false,
    JSON.stringify(backToScenario.failurePolicy)
  );
}

console.log(`\n${passed} workflow sentinel checks passed`);
