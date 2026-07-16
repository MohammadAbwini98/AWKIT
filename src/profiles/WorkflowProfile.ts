import type { ScenarioLink, ScenarioProfile } from "./ScenarioProfile";
import type { EdgeVisualStyle, ValueSource } from "./FlowProfile";

export interface WorkflowNodeInputBinding {
  type: ValueSource["type"];
  dataSourceId?: string;
  path?: string;
  key?: string;
  value?: string;
}

export interface WorkflowFlowNode {
  id: string;
  type: "flowRef";
  flowId: string;
  alias: string;
  order: number;
  required: boolean;
  inputBindings: Record<string, WorkflowNodeInputBinding>;
  dataSourceId?: string;
  jsonPath?: string;
  runtimeInputKey?: string;
  conditionRules?: string;
  retryPolicy?: {
    count: number;
    delayMs: number;
  };
  failurePolicy?: "stop" | "continue" | "manualHandoff";
  position?: { x: number; y: number };
  /** Canvas node size (px) for the Workflow Builder. */
  size?: { width: number; height: number };
}

/** Structural canvas sentinels. They are persisted for editing but never executed as flows. */
export interface WorkflowSentinelNode {
  id: string;
  type: "start" | "end";
  alias: string;
  order: number;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

export type WorkflowNode = WorkflowFlowNode | WorkflowSentinelNode;

export function isWorkflowFlowNode(node: WorkflowNode): node is WorkflowFlowNode {
  return node.type === "flowRef";
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: ScenarioLink["type"];
  label?: string;
  condition?: {
    expression: string;
  };
  style?: EdgeVisualStyle;
}

export interface WorkflowRuntimeInput {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "dropdown" | "checkbox";
  required: boolean;
  options?: string[];
}

export interface WorkflowDataSourceBinding {
  dataSourceId: string;
  rootArrayPath: string;
}

export interface WorkflowProfile {
  id: string;
  name: string;
  description?: string;
  version: number;
  /** The JSON data source this workflow runs against (Phase 03: workflow owns its data source). */
  dataSource?: WorkflowDataSourceBinding;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runtimeInputs: WorkflowRuntimeInput[];
  execution: {
    mode: ScenarioProfile["executionMode"];
    maxConcurrentInstances: number;
    stopOnRequiredFlowFailure: boolean;
  };
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Build a blank, saveable workflow with the given name: a Start → End scaffold and
 * sequential defaults. Shared by the Workflows library "Create Workflow" flow and the
 * Workflow Builder "New" action so both persist an identical starting document and then
 * land on it in the builder.
 */
export function createBlankWorkflowProfile(name: string): WorkflowProfile {
  const now = new Date().toISOString();
  return {
    id: `workflow-${Date.now().toString(36)}`,
    name,
    description: "Saved workflow of reusable flow profiles",
    version: 1,
    nodes: [
      { id: "start", type: "start", alias: "Start", order: 0, position: { x: 280, y: 100 } },
      { id: "end", type: "end", alias: "End", order: 1, position: { x: 280, y: 420 } }
    ],
    edges: [{ id: "edge-start-end", source: "start", target: "end", type: "always", label: "always" }],
    runtimeInputs: [],
    execution: {
      mode: "sequential",
      maxConcurrentInstances: 1,
      stopOnRequiredFlowFailure: true
    },
    createdAt: now,
    updatedAt: now
  };
}

export function workflowToScenarioProfile(workflow: WorkflowProfile): ScenarioProfile {
  const flowNodes = workflow.nodes.filter(isWorkflowFlowNode);
  const flowNodeById = new Map(flowNodes.map((node) => [node.id, node]));
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    executionMode: workflow.execution.mode,
    maxParallelFlows: workflow.execution.maxConcurrentInstances,
    flows: flowNodes.map((node) => ({
      order: node.order,
      flowId: node.flowId,
      required: node.required,
      inputs: Object.fromEntries(
        Object.entries(node.inputBindings).map(([key, binding]) => [
          key,
          binding.type === "runtimeInput" ? `runtime:${binding.key ?? key}` : binding.path ?? binding.value ?? key
        ])
      )
    })),
    links: workflow.edges.flatMap((edge) => {
      const source = flowNodeById.get(edge.source);
      const target = flowNodeById.get(edge.target);
      if (!source || !target) return [];
      return [{
      id: edge.id,
      sourceFlowId: source.flowId,
      targetFlowId: target.flowId,
      type: edge.type,
      label: edge.label,
      condition: edge.condition
      }];
    }),
    failurePolicy: {
      stopOnRequiredFlowFailure: workflow.execution.stopOnRequiredFlowFailure,
      continueOnOptionalFlowFailure: true,
      takeScreenshotOnFailure: true
    }
  };
}

export function scenarioToWorkflowProfile(scenario: ScenarioProfile): WorkflowProfile {
  return {
    id: scenario.id.replace(/scenario/gi, "workflow"),
    name: scenario.name.replace(/Scenario/gi, "Workflow"),
    description: scenario.description,
    version: 1,
    nodes: scenario.flows.map((flow, index) => ({
      id: `node-${flow.flowId}`,
      type: "flowRef",
      flowId: flow.flowId,
      alias: flow.flowId,
      order: flow.order,
      required: flow.required,
      inputBindings: Object.fromEntries(
        Object.entries(flow.inputs ?? {}).map(([key, value]) => [
          key,
          value.startsWith("runtime:") ? { type: "runtimeInput", key: value.replace("runtime:", "") } : { type: "static", value }
        ])
      ),
      position: { x: 140 + index * 320, y: 120 }
    })),
    edges: scenario.links.map((link) => ({
      id: link.id,
      source: `node-${link.sourceFlowId}`,
      target: `node-${link.targetFlowId}`,
      type: link.type,
      label: link.label,
      condition: link.condition
    })),
    runtimeInputs: [],
    execution: {
      mode: scenario.executionMode,
      maxConcurrentInstances: scenario.maxParallelFlows,
      stopOnRequiredFlowFailure: scenario.failurePolicy.stopOnRequiredFlowFailure
    }
  };
}
