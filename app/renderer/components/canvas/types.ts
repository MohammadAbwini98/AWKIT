import type { Position, XYPosition } from "./geometry";

/** A node on the canvas. Positions are in flow coordinates (pre-transform). */
export interface CanvasNode<T = Record<string, unknown>> {
  id: string;
  type?: string;
  position: XYPosition;
  data: T;
  selected?: boolean;
  draggable?: boolean;
  /** Optional explicit size; when omitted the engine measures the rendered DOM. */
  width?: number;
  height?: number;
}

/** A connector between two nodes. */
export interface CanvasEdge<T = Record<string, unknown>> {
  id: string;
  source: string;
  target: string;
  type?: string;
  data?: T;
  label?: string;
  selected?: boolean;
  /** Kept for API parity; the engine draws arrowheads from CSS, not markers. */
  markerEnd?: unknown;
  /** Adds the flowing dash animation to the connector. */
  animated?: boolean;
  style?: React.CSSProperties;
}

/** Props passed to a registered node component (nodeTypes). */
export interface CanvasNodeProps<T = Record<string, unknown>> {
  id: string;
  data: T;
  selected: boolean;
  type?: string;
  xPos: number;
  yPos: number;
}

/** Props passed to a registered edge component (edgeTypes). */
export interface CanvasEdgeProps<T = Record<string, unknown>> {
  id: string;
  source: string;
  target: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  data?: T;
  label?: string;
  selected: boolean;
  style?: React.CSSProperties;
}

export type NodeTypes = Record<string, React.ComponentType<CanvasNodeProps<never>>>;
export type EdgeTypes = Record<string, React.ComponentType<CanvasEdgeProps<never>>>;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** A new connection request emitted by drag-to-connect. */
export interface Connection {
  source: string;
  target: string;
}
