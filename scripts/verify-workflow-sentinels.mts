import { isWorkflowFlowNode, scenarioToWorkflowProfile, workflowToScenarioProfile, type WorkflowProfile } from "@src/profiles/WorkflowProfile";
import {
  formatWorkflowConflictMessage,
  parseWorkflowConflictName,
  validateWorkflowProfile
} from "@src/profiles/workflowProfileValidation";

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

const loopWorkflow: WorkflowProfile = {
  ...workflow,
  id: "loop-workflow",
  nodes: [
    { id: "node-a", type: "flowRef", flowId: "flow-a", alias: "Flow A", order: 1, required: true, inputBindings: {} },
    { id: "node-b", type: "flowRef", flowId: "flow-b", alias: "Flow B", order: 2, required: true, inputBindings: {} }
  ],
  edges: [
    {
      id: "loop-a",
      source: "node-a",
      target: "node-a",
      type: "loop",
      loop: {
        mode: "whileCondition",
        maxIterations: 7,
        condition: { sourceField: "status", operator: "equals", expectedValue: "passed" }
      }
    },
    { id: "exit-a", source: "node-a", target: "node-b", type: "conditional", condition: { expression: "true" } }
  ]
};
const loopScenario = workflowToScenarioProfile(loopWorkflow);
check(
  "workflow conversion preserves structured loop metadata and the Conditional exit",
  loopScenario.links[0]?.loop?.mode === "whileCondition" &&
    loopScenario.links[0]?.loop?.maxIterations === 7 &&
    loopScenario.links[0]?.loop?.condition?.expectedValue === "passed" &&
    loopScenario.links[1]?.condition?.expression === "true"
);
const loopRoundTrip = scenarioToWorkflowProfile(loopScenario);
check(
  "scenario conversion preserves loop metadata back into WorkflowEdge",
  loopRoundTrip.edges[0]?.loop?.maxIterations === 7 && loopRoundTrip.edges[0]?.loop?.condition?.sourceField === "status"
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

console.log(`\n${passed}/14 workflow sentinel checks passed`);
