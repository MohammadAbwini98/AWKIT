/**
 * Dependency-free layered ("Sugiyama-lite") auto-layout for the Flow Designer and Workflow
 * Builder canvases (SRS-CANVAS-UX-001 §3.3). Fixes the stacking defect where nodes without a
 * saved position collapse onto one coordinate, and powers the manual "Auto-arrange" action.
 *
 * The algorithm is intentionally small and offline: longest-path layering (cycle-safe), then
 * each layer is centered on a shared axis so branch children sit evenly beneath/beside their
 * parent. Self-loop edges (source === target) are ignored for layering — they route through the
 * node's own top loop port, not between layers.
 */

export interface LayoutNodeInput {
  id: string;
  width?: number;
  height?: number;
}

export interface LayoutEdgeInput {
  source: string;
  target: string;
}

export type LayoutDirection = "TB" | "LR";

export interface LayeredLayoutOptions {
  /** "TB" = top-to-bottom (Flow Designer), "LR" = left-to-right (Workflow Builder). */
  direction?: LayoutDirection;
  /** Clearance between sibling nodes within a layer (perpendicular to the flow). */
  nodeGap?: number;
  /** Clearance between successive layers (along the flow). */
  layerGap?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  originX?: number;
  originY?: number;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

// FR-3.2: minimum legible clearance — ≥64px across the flow, ≥48px between layers.
const DEFAULTS: Required<Omit<LayeredLayoutOptions, "direction">> = {
  nodeGap: 64,
  layerGap: 56,
  defaultWidth: 220,
  defaultHeight: 96,
  originX: 80,
  originY: 80
};

/**
 * Compute non-overlapping positions for a set of nodes using longest-path layering. Cycles are
 * handled safely: relaxation is capped at `nodes.length` passes, so a back-edge simply stops
 * improving its target's layer instead of looping forever.
 */
export function layeredLayout(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], options: LayeredLayoutOptions = {}): Map<string, LayoutPosition> {
  const opts = { ...DEFAULTS, ...options };
  const direction = options.direction ?? "TB";
  const positions = new Map<string, LayoutPosition>();
  if (!nodes.length) return positions;

  const ids = new Set(nodes.map((node) => node.id));
  const flowEdges = edges.filter((edge) => edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target));

  // Longest-path layering (Bellman-Ford style, cycle-safe via the pass cap).
  const layer = new Map<string, number>();
  nodes.forEach((node) => layer.set(node.id, 0));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of flowEdges) {
      const sourceLayer = layer.get(edge.source) ?? 0;
      const targetLayer = layer.get(edge.target) ?? 0;
      if (targetLayer < sourceLayer + 1) {
        layer.set(edge.target, sourceLayer + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group nodes by layer, preserving input order for stability.
  const byLayer = new Map<number, LayoutNodeInput[]>();
  nodes.forEach((node) => {
    const index = layer.get(node.id) ?? 0;
    const bucket = byLayer.get(index) ?? [];
    bucket.push(node);
    byLayer.set(index, bucket);
  });
  const layerIndexes = [...byLayer.keys()].sort((a, b) => a - b);

  const widthOf = (node: LayoutNodeInput) => (node.width && node.width > 0 ? node.width : opts.defaultWidth);
  const heightOf = (node: LayoutNodeInput) => (node.height && node.height > 0 ? node.height : opts.defaultHeight);

  if (direction === "TB") {
    // Cross-axis = x (nodes spread within a row), main-axis = y (rows stack downward).
    const layerWidths = layerIndexes.map((index) => {
      const bucket = byLayer.get(index)!;
      return bucket.reduce((sum, node) => sum + widthOf(node), 0) + opts.nodeGap * (bucket.length - 1);
    });
    const maxWidth = Math.max(0, ...layerWidths);
    const centerX = opts.originX + maxWidth / 2;
    let y = opts.originY;
    layerIndexes.forEach((index, li) => {
      const bucket = byLayer.get(index)!;
      const rowHeight = Math.max(...bucket.map(heightOf));
      let x = centerX - layerWidths[li] / 2;
      bucket.forEach((node) => {
        positions.set(node.id, { x: Math.round(x), y: Math.round(y) });
        x += widthOf(node) + opts.nodeGap;
      });
      y += rowHeight + opts.layerGap;
    });
  } else {
    // Cross-axis = y, main-axis = x (columns march rightward).
    const layerHeights = layerIndexes.map((index) => {
      const bucket = byLayer.get(index)!;
      return bucket.reduce((sum, node) => sum + heightOf(node), 0) + opts.nodeGap * (bucket.length - 1);
    });
    const maxHeight = Math.max(0, ...layerHeights);
    const centerY = opts.originY + maxHeight / 2;
    let x = opts.originX;
    layerIndexes.forEach((index, li) => {
      const bucket = byLayer.get(index)!;
      const colWidth = Math.max(...bucket.map(widthOf));
      let y = centerY - layerHeights[li] / 2;
      bucket.forEach((node) => {
        positions.set(node.id, { x: Math.round(x), y: Math.round(y) });
        y += heightOf(node) + opts.nodeGap;
      });
      x += colWidth + opts.layerGap;
    });
  }

  return positions;
}

/**
 * True when a graph needs auto-layout on load: any node lacks a position, or two nodes share
 * (near-)identical coordinates — the classic "everything stacked on {280,120}" defect. Manually
 * arranged graphs with distinct saved positions return false so we never clobber user layout.
 */
export function positionsNeedLayout(nodes: { position?: LayoutPosition | null }[]): boolean {
  if (nodes.length < 2) return false;
  const seen = new Set<string>();
  for (const node of nodes) {
    if (!node.position) return true;
    // Bucket to ~8px so exact stacks (and jittered near-stacks) collapse to one key.
    const key = `${Math.round(node.position.x / 8)}:${Math.round(node.position.y / 8)}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/** React Flow node shape this helper can re-position (Flow Designer + Workflow Builder both satisfy it). */
interface PositionedNode {
  id: string;
  position: LayoutPosition;
  data?: { width?: number; height?: number };
}

/**
 * Re-position `nodes` with `layeredLayout` only when {@link positionsNeedLayout} says the graph is
 * stacked/position-less. Used on load so saved manual layouts are preserved but position-less
 * flows/workflows open cleanly framed. Pass `force` for the manual "Auto-arrange" action.
 */
export function withAutoLayout<T extends PositionedNode>(
  nodes: T[],
  edges: LayoutEdgeInput[],
  options: LayeredLayoutOptions & { force?: boolean } = {}
): T[] {
  if (!options.force && !positionsNeedLayout(nodes)) return nodes;
  const positions = layeredLayout(
    nodes.map((node) => ({ id: node.id, width: node.data?.width, height: node.data?.height })),
    edges,
    options
  );
  return nodes.map((node) => {
    const next = positions.get(node.id);
    return next ? { ...node, position: next } : node;
  });
}
