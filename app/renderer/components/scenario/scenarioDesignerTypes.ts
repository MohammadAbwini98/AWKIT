import type { ScenarioLink } from "@src/profiles/ScenarioProfile";
import type { EdgeVisualStyle } from "@src/profiles/FlowProfile";
import type { ConnectorPortFlags } from "../shared/connectorStyle";

export interface ScenarioFlowNodeData extends Record<string, unknown> {
  kind: "flowRef" | "start" | "end";
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
  isLeaf?: boolean;
  onAppendFlow?: (nodeId: string, anchor: HTMLElement) => void;
  /** Per-node kebab menu actions (render-only; never serialized). */
  onConfigure?: (nodeId: string) => void;
  onDeleteFlow?: (nodeId: string) => void;
  /** Whether this flow node currently carries a self-loop connector (render-only). */
  hasLoop?: boolean;
  /** Toggle the flow node's self-loop connector from its kebab menu (render-only). */
  onToggleLoop?: (nodeId: string) => void;
}

export const SCENARIO_NODE_DEFAULT_WIDTH = 320;
export const SCENARIO_NODE_DEFAULT_HEIGHT = 96;

export interface ScenarioLinkData extends Record<string, unknown> {
  linkType: ScenarioLink["type"];
  label: string;
  expression: string;
  style?: EdgeVisualStyle;
  /**
   * Display-only fields injected per-render by the canvas (`edgesForCanvas`) for the
   * `templateSmooth` edge's inline "+" affordance (SRS-CANVAS-UX-001 §3.1). NEVER persisted —
   * `toWorkflowProfile` reads connector fields explicitly and ignores these.
   */
  showAddButton?: boolean;
  onInsertNode?: (edgeId: string, anchor: HTMLElement) => void;
}
