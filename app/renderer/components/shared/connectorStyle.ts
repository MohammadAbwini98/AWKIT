import type { EdgeVisualStyle } from "@src/profiles/FlowProfile";

/** Visual fields the canvas engine reads off an edge (type + dash animation + stroke style). */
export interface ConnectorVisual {
  type: string;
  animated: boolean;
  style: React.CSSProperties;
}

/**
 * Single source of truth for connector (edge) visuals, shared by the Flow Designer and
 * the Workflow Builder so both canvases render connectors identically (Task 03) and both
 * honor per-connector style customization (Task 06).
 */
export const connectorTypeColor: Record<string, string> = {
  // Template default: violet flow lines. Semantic colors are reserved for actual
  // runtime/result states so the resting canvas reads as a calm, single-accent graph.
  // Values are CSS variable strings resolved via the SVG `stroke` presentation attribute.
  success: "var(--awkit-connector-default)",
  failure: "var(--awkit-connector-failure)",
  always: "var(--awkit-connector-default)",
  conditional: "var(--awkit-connector-default)",
  outcome: "var(--awkit-connector-default)",
  manualApproval: "var(--awkit-connector-default)",
  loop: "var(--awkit-connector-loop)",
  loopBack: "var(--awkit-connector-loop)",
  parallel: "var(--awkit-connector-parallel)"
};

/** Preset colors offered in the Connector Style picker. Empty value = default by type. */
export const connectorColorPresets: { value: string; label: string }[] = [
  { value: "", label: "Default (by type)" },
  { value: "#8b5cf6", label: "Purple" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#16a34a", label: "Green" },
  { value: "#f59e0b", label: "Orange" },
  { value: "#ef4444", label: "Red" },
  { value: "#64748b", label: "Gray" }
];

const ALLOWED_SHAPES = ["smoothstep", "bezier", "straight", "step", "circular"] as const;
const ALLOWED_LINE = ["solid", "dashed", "dotted"] as const;
const ALLOWED_ARROW = ["default", "closed", "none"] as const;

/** Clamp/validate a stored style so invalid/legacy values fall back to defaults. */
export function normalizeEdgeStyle(style?: EdgeVisualStyle): EdgeVisualStyle {
  if (!style) return {};
  return {
    color: typeof style.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(style.color) ? style.color : undefined,
    lineStyle: (ALLOWED_LINE as readonly string[]).includes(style.lineStyle as string) ? style.lineStyle : undefined,
    thickness: typeof style.thickness === "number" && style.thickness >= 1 && style.thickness <= 5 ? style.thickness : undefined,
    shape: (ALLOWED_SHAPES as readonly string[]).includes(style.shape as string) ? style.shape : undefined,
    arrowHead: (ALLOWED_ARROW as readonly string[]).includes(style.arrowHead as string) ? style.arrowHead : undefined
  };
}

/** Whether a style object actually customizes anything (used to drop empty styles on save). */
export function hasCustomStyle(style?: EdgeVisualStyle): boolean {
  const s = normalizeEdgeStyle(style);
  return Boolean(s.color || s.lineStyle || s.thickness || s.shape || s.arrowHead);
}

export function resolveConnectorColor(type: string, style?: EdgeVisualStyle): string {
  return normalizeEdgeStyle(style).color || connectorTypeColor[type] || "var(--awkit-connector-default)";
}

function dashArray(lineStyle?: EdgeVisualStyle["lineStyle"]): string | undefined {
  if (lineStyle === "dashed") return "6 4";
  if (lineStyle === "dotted") return "1 5";
  return undefined;
}

/** Canvas-engine edge fields (type/animated/style) for a connector + its style. */
export function buildConnectorVisual(type: string, style?: EdgeVisualStyle): ConnectorVisual {
  const s = normalizeEdgeStyle(style);
  const stroke = resolveConnectorColor(type, s);
  // loopBack edges default to a dashed line so they read visually as "return" paths.
  const defaultDash = type === "loopBack" ? "6 4" : undefined;
  // Loop connectors default to the circular self-loop shape when no explicit shape was chosen.
  const shape = s.shape ?? (type === "loop" ? "circular" : "smoothstep");
  // Map the serialized shape to the canvas-engine edge `type`. The engine has two edge renderers:
  // `loop` (self-loop bezier) and `smooth` (curved line + label pill + insert affordance). Circular
  // self-loops render through `loop`; every other shape renders through `smooth`. The saved
  // `EdgeVisualStyle.shape` value is NOT altered — only the runtime edge type is remapped.
  const engineType = shape === "circular" ? "loop" : "smooth";
  return {
    type: engineType,
    animated: type === "loop" || type === "conditional" || type === "loopBack" || type === "parallel",
    style: { stroke, strokeWidth: s.thickness ?? 2, strokeDasharray: dashArray(s.lineStyle) ?? defaultDash }
  };
}

/** Structured connector "port" kinds that get a distinct, stable handle id on each node. */
export type ConnectorPortKind = "normal" | "conditional" | "parallel";

/** Dedicated handle pair used only by self-loop (`loop`-kind) connectors (top loop port). */
export const LOOP_HANDLES = { sourceHandle: "loop-out", targetHandle: "loop-in" } as const;

/**
 * A branch connector (conditional/parallel) is a **pair**: a node in that mode shows exactly
 * two same-kind source ports on its right edge, each hosting one connector, so this is the
 * hard cap on same-kind outgoing connectors per node.
 */
export const MAX_BRANCH_CONNECTORS = 2;

/** Source handle id for a branch connector kind at a given 0-based slot (its right-side port). */
export function branchSourceHandle(kind: "conditional" | "parallel", slot: number): string {
  return `${kind}-out-${slot}`;
}

/** 0-based slot index encoded in a `<kind>-out-<slot>` handle id (0 if none/normal/loop). */
export function slotFromHandle(handleId?: string | null): number {
  const match = /-out-(\d+)$/.exec(handleId ?? "");
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Stable source/target handle ids for a connector kind. `loop` connectors are self-loops and
 * get their own dedicated top handle pair (`LOOP_HANDLES`). Branch connectors default to slot
 * 0 (`<kind>-out-0`). (Vestigial from the removed two-port node model; see the note above.)
 */
export function portHandlesForKind(kind: string | undefined): { sourceHandle: string; targetHandle: string } {
  if (kind === "loop") return { ...LOOP_HANDLES };
  if (kind === "conditional" || kind === "parallel") return { sourceHandle: branchSourceHandle(kind, 0), targetHandle: `${kind}-in` };
  return { sourceHandle: "normal-out", targetHandle: "normal-in" };
}

/** Derive the port kind a drag started/ended from, from its React Flow handle id. */
export function connectorPortKindFromHandle(handleId?: string | null): ConnectorPortKind {
  if (!handleId) return "normal";
  if (handleId.startsWith("conditional-")) return "conditional";
  if (handleId.startsWith("parallel-")) return "parallel";
  return "normal";
}

export interface ConnectorPortFlags {
  /**
   * Right (source) side mode. When set, the node renders exactly two same-kind branch ports
   * (a conditional/parallel pair); when undefined it renders a single centered normal port.
   */
  sourceKind?: "conditional" | "parallel";
  /** Left (target) side: an incoming conditional/parallel connector lands here. */
  conditionalIn?: boolean;
  parallelIn?: boolean;
  /** A self-loop (`loop`-kind) connector already touches this node — render the top loop port. */
  loop?: boolean;
}

/**
 * Per-node port flags derived from the edges attached to each node. The source (right) side is
 * single-normal by default and switches to a two-port branch pair once a conditional/parallel
 * connector leaves the node. Target (left) ports appear only for incoming branch connectors.
 */
export function computePortFlags(edges: { source: string; target: string; kind: string }[]): Map<string, ConnectorPortFlags> {
  const map = new Map<string, ConnectorPortFlags>();
  const ensure = (id: string): ConnectorPortFlags => {
    let flags = map.get(id);
    if (!flags) {
      flags = {};
      map.set(id, flags);
    }
    return flags;
  };
  edges.forEach((edge) => {
    if (edge.kind === "loop") {
      ensure(edge.source).loop = true;
      return; // self-loops route through the top loop port, not a branch pair
    }
    if (edge.kind === "conditional") {
      ensure(edge.source).sourceKind = "conditional";
      ensure(edge.target).conditionalIn = true;
    } else if (edge.kind === "parallel") {
      ensure(edge.source).sourceKind = "parallel";
      ensure(edge.target).parallelIn = true;
    }
  });
  return map;
}

/**
 * NOTE: the branch-pair invariant (revert a lone conditional/parallel connector back to normal)
 * now lives in `components/shared/branchPairs.ts` — `revertLoneBranchConnectors` — which both
 * editors and `scripts/verify-branch-pairs.mts` share. The old `reconcileBranchConnectors` here
 * also did right-side port slotting, which died with the two-port node model, so it was removed.
 * The remaining port helpers below (`portHandlesForKind`, `computePortFlags`, `portPositions`, …)
 * are likewise vestigial from that model and are tracked for a separate prune.
 */

/**
 * Evenly spaced vertical offsets (as a `top` percentage) for `count` stacked ports on one
 * side of a node, centered as a group on the node's vertical midpoint — so a node with a
 * single extra port (e.g. normal + conditional) reads as centered rather than skewed
 * toward one edge.
 */
export function portPositions(count: number): number[] {
  if (count <= 1) return [50];
  const spacing = 20;
  const start = 50 - ((count - 1) * spacing) / 2;
  return Array.from({ length: count }, (_, index) => start + index * spacing);
}
