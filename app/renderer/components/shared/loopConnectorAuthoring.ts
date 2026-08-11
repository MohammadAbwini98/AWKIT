import type { ConditionalConnectorConfig, LoopConnectorConfig } from "@src/profiles/FlowProfile";
import type { FlowDesignerEdge } from "../workflow/flowProfileMapping";
import type { FlowConnectionData } from "../workflow/ConnectionPropertiesPanel";
import type { ScenarioDesignerEdge } from "./branchPairs";
import type { ScenarioLinkData } from "../scenario/scenarioDesignerTypes";
import { buildConnectorVisual } from "./connectorStyle";
import { flowEdgeKind, scenarioEdgeKind } from "./branchPairs";

/** Safe initial condition for a while loop: keep repeating after a successful iteration. */
export function defaultLoopCondition(): ConditionalConnectorConfig {
  return { sourceField: "status", operator: "equals", expectedValue: "passed", priority: 0 };
}

/** One source of truth for newly authored structured self-loop configuration. */
export function defaultLoopConnectorConfig(): LoopConnectorConfig {
  return { mode: "count", maxIterations: 3, parameterName: "", condition: undefined };
}

/** A structured Conditional exit that is taken after the self-loop finishes. */
export function defaultLoopExitCondition(): ConditionalConnectorConfig {
  return { sourceField: "status", operator: "always", priority: 0 };
}

function loopExitLabel(label: string | undefined, currentType: string): string {
  return !label?.trim() || label.trim().toLowerCase() === currentType.toLowerCase() ? "Exit loop" : label;
}

function flowEdgeToLoopExit(edge: FlowDesignerEdge): FlowDesignerEdge {
  const label = loopExitLabel(edge.data?.label, edge.data?.linkType ?? "success");
  const data: FlowConnectionData = {
    ...edge.data,
    linkType: "conditional",
    kind: "conditional",
    label,
    expression: "",
    conditional: defaultLoopExitCondition(),
    parallel: undefined,
    loop: undefined
  };
  return { ...edge, ...buildConnectorVisual("conditional", edge.data?.style), data, label };
}

function scenarioEdgeToLoopExit(edge: ScenarioDesignerEdge): ScenarioDesignerEdge {
  const label = loopExitLabel(edge.data?.label, edge.data?.linkType ?? "success");
  const data: ScenarioLinkData = {
    ...edge.data,
    linkType: "conditional",
    label,
    expression: "true",
    loop: undefined,
    maxLoopCount: undefined
  };
  return { ...edge, ...buildConnectorVisual("conditional", edge.data?.style), data, label };
}

/**
 * Make every existing non-self exit from `source` legal before adding a Flow Designer self-loop.
 * Existing Conditional exits are preserved exactly; every other route is explicitly promoted.
 */
export function promoteFlowLoopExits(edges: FlowDesignerEdge[], source: string): { edges: FlowDesignerEdge[]; converted: number } {
  let converted = 0;
  const next = edges.map((edge) => {
    if (edge.source !== source || edge.target === source || flowEdgeKind(edge) === "conditional") return edge;
    converted += 1;
    return flowEdgeToLoopExit(edge);
  });
  return { edges: converted ? next : edges, converted };
}

/** Workflow Builder equivalent of {@link promoteFlowLoopExits}. */
export function promoteScenarioLoopExits(edges: ScenarioDesignerEdge[], source: string): { edges: ScenarioDesignerEdge[]; converted: number } {
  let converted = 0;
  const next = edges.map((edge) => {
    if (edge.source !== source || edge.target === source || scenarioEdgeKind(edge.data?.linkType) === "conditional") return edge;
    converted += 1;
    return scenarioEdgeToLoopExit(edge);
  });
  return { edges: converted ? next : edges, converted };
}
