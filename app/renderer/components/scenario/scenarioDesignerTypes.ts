import type { ScenarioLink } from "@src/profiles/ScenarioProfile";
import type { EdgeVisualStyle } from "@src/profiles/FlowProfile";
import type { ConnectorPortFlags } from "../shared/connectorStyle";

export interface ScenarioFlowNodeData extends Record<string, unknown> {
  flowId: string;
  name: string;
  order: number;
  required: boolean;
  description: string;
  mode: "sequential" | "conditional" | "parallel" | "loop" | "manual";
  outputs: string[];
  inputs: string[];
  /** Canvas node size (px) — resizable like Flow Designer nodes (persisted in the workflow). */
  width: number;
  height: number;
  // ── Dynamic connector ports (Point 1, render-only — not persisted to WorkflowFlowNode) ──
  portFlags?: ConnectorPortFlags;
}

export const SCENARIO_NODE_DEFAULT_WIDTH = 240;
export const SCENARIO_NODE_DEFAULT_HEIGHT = 96;

export interface ScenarioLinkData extends Record<string, unknown> {
  linkType: ScenarioLink["type"];
  label: string;
  expression: string;
  style?: EdgeVisualStyle;
}
