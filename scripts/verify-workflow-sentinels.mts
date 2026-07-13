import { isWorkflowFlowNode, workflowToScenarioProfile, type WorkflowProfile } from "@src/profiles/WorkflowProfile";

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

console.log(`\n${passed}/4 workflow sentinel checks passed`);
