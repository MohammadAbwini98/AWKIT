import type { ConditionalConnectorConfig, EdgeVisualStyle, LoopConnectorConfig } from "@src/profiles/FlowProfile";
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

/** Shared visual defaults for every newly-authored Loop; loaded edges keep their persisted style. */
export function defaultLoopConnectorStyle(): EdgeVisualStyle {
  return { shape: "circular", lineStyle: "dotted", thickness: 4, arrowHead: "closed" };
}

const GENERIC_LOOP_LABELS = new Set(["loop", "loop connector"]);

function compactLoopText(value: unknown, maxLength = 22): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function loopConditionSummary(condition: ConditionalConnectorConfig | undefined): string | undefined {
  if (!condition) return undefined;
  const source = condition.sourceField === "variable"
    ? compactLoopText(condition.variableName || "variable", 14)
    : condition.sourceField === "dataSourceValue"
      ? compactLoopText(condition.variableName || "data value", 14)
      : condition.sourceField;
  const operator = {
    always: "always",
    equals: "=",
    notEquals: "≠",
    contains: "contains",
    notContains: "excludes",
    exists: "exists",
    notExists: "missing",
    greaterThan: ">",
    greaterThanOrEqual: "≥",
    lessThan: "<",
    lessThanOrEqual: "≤",
    truthy: "is true",
    falsy: "is false"
  }[condition.operator];
  const unary = ["always", "exists", "notExists", "truthy", "falsy"].includes(condition.operator);
  return unary
    ? `${source} ${operator}`
    : `${source} ${operator} ${compactLoopText(condition.expectedValue, 12)}`.trim();
}

/** Compact design-time label. It never represents a live/current iteration. */
export function loopConnectorDesignLabel(loop: LoopConnectorConfig | undefined, authoredLabel?: string): string {
  const explicitLabel = compactLoopText(loop?.label || authoredLabel, 30);
  if (explicitLabel && !GENERIC_LOOP_LABELS.has(explicitLabel.toLowerCase())) return explicitLabel;
  if (!loop) return explicitLabel || "Loop";

  switch (loop.mode) {
    case "count":
      return Number.isFinite(loop.maxIterations) ? `Count × ${loop.maxIterations}` : "Loop";
    case "staticList":
      return loop.staticValues?.length ? `For Each · ${loop.staticValues.length} items` : "For Each";
    case "dataSource": {
      const source = compactLoopText(loop.dataSourceId || loop.dataSourceBinding, 16);
      return source ? `For Each · ${source}` : "For Each · data source";
    }
    case "whileCondition": {
      const condition = loopConditionSummary(loop.condition);
      return condition ? compactLoopText(`While · ${condition}`, 30) : "While";
    }
  }
}

/** Design-time label for the separate, bounded legacy cross-node return model. */
export function loopBackDesignLabel(maxLoopCount: number | undefined, authoredLabel?: string): string {
  const explicitLabel = compactLoopText(authoredLabel, 30);
  if (explicitLabel && !["loop back", "loopback"].includes(explicitLabel.toLowerCase())) return explicitLabel;
  return Number.isFinite(maxLoopCount) ? `Loop Back × ${maxLoopCount}` : explicitLabel || "Loop Back";
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
