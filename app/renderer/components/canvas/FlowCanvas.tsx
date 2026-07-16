import { createContext, memo, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, forwardRef, type MutableRefObject, type ReactNode } from "react";
import { Position, getRectOfNodes, getViewportForBounds, pointToFlowPosition, getOverlappingArea, clamp, type Rect, type XYPosition } from "./geometry";
import { EdgeLabelContext } from "./edgeLabelContext";
import { bumpRenderProbe } from "./renderProbe";
import type { CanvasEdge, CanvasEdgeProps, CanvasNode, Connection, EdgeTypes, NodeTypes, Viewport } from "./types";

/**
 * Custom canvas engine — a small, purpose-built replacement for the parts of
 * React Flow the app used (viewport pan/zoom, node drag, smooth-step edges,
 * fit-view, screen↔flow mapping). The flow runs top→bottom: every edge leaves
 * the source node's bottom-center and enters the target node's top-center,
 * matching the Workflow (flowforge) reference. Self-loops (source === target)
 * are drawn by the edge component from a single anchor.
 */

const MIN_ZOOM_DEFAULT = 0.3;
const MAX_ZOOM_DEFAULT = 2;
/** Screen-pixel movement before a node pointer-down is treated as a drag rather than a click.
 *  Measured in screen space so it's zoom-independent; ~3px filters hand tremor (docs §9.3). */
const NODE_DRAG_THRESHOLD_PX = 3;
/** How long a deleted node lingers as a fading "ghost" before unmount — matches the `.awkit-flow-node.is-exiting`
 *  transition in global.css (--awkit-dur-fast, 120ms) plus a small buffer (docs §9.2). */
const NODE_EXIT_MS = 150;

interface MeasuredSize {
  width: number;
  height: number;
}

interface CanvasContextValue {
  viewport: Viewport;
  minZoom: number;
  maxZoom: number;
  /** Convert a client (screen) point into flow coordinates. */
  screenToFlowPosition: (client: XYPosition) => XYPosition;
  /** Frame all nodes within the viewport. */
  fitView: (options?: { padding?: number; duration?: number; maxZoom?: number }) => void;
  /** Set an absolute zoom level, keeping the viewport centered. */
  zoomTo: (zoom: number, options?: { duration?: number }) => void;
  /** Nodes whose bounding box overlaps the given node's box (drag-to-connect). */
  getIntersectingNodes: (node: { id: string }) => CanvasNode[];
  setViewport: (viewport: Viewport, options?: { duration?: number }) => void;
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

/** Access the canvas viewport + helpers. Mirrors the old useReactFlow/useViewport. */
export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) {
    throw new Error("useCanvas must be used within a <FlowCanvas>");
  }
  return ctx;
}

/** Live viewport zoom, for a zoom read-out. Mirrors the old useViewport(). */
export function useViewport(): Viewport {
  return useCanvas().viewport;
}

export interface FlowCanvasHandle {
  fitView: CanvasContextValue["fitView"];
  zoomTo: CanvasContextValue["zoomTo"];
  screenToFlowPosition: CanvasContextValue["screenToFlowPosition"];
  /** Pan the viewport by a screen-pixel delta (optionally animated) — used to shift content clear of the drawer. */
  panBy: (dx: number, dy: number, options?: { duration?: number }) => void;
}

export interface FlowCanvasProps {
  // Data payloads are opaque to the engine (forwarded to the registered node/edge
  // components), so any node/edge data shape is accepted here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: CanvasNode<any>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edges: CanvasEdge<any>[];
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  className?: string;
  minZoom?: number;
  maxZoom?: number;
  fitViewOnInit?: boolean;
  nodesDraggable?: boolean;
  /** Called with a node's new position after a drag. */
  onNodePositionChange?: (id: string, position: XYPosition) => void;
  onNodeDragStop?: (id: string, position: XYPosition) => void;
  /** Fired when a node is dropped overlapping another — drag-to-connect (flowforge parity). */
  onNodeConnect?: (sourceId: string, targetId: string) => void;
  onNodeClick?: (id: string) => void;
  onNodeDoubleClick?: (id: string) => void;
  onEdgeClick?: (id: string) => void;
  onConnect?: (connection: Connection) => void;
  onPaneClick?: () => void;
  onPaneContextMenu?: (event: React.MouseEvent) => void;
  onMoveEnd?: (viewport: Viewport) => void;
  children?: ReactNode;
}

const CONNECT_THRESHOLD = 4;

export const FlowCanvas = forwardRef<FlowCanvasHandle, FlowCanvasProps>(function FlowCanvas(
  {
    nodes,
    edges,
    nodeTypes,
    edgeTypes,
    className,
    minZoom = MIN_ZOOM_DEFAULT,
    maxZoom = MAX_ZOOM_DEFAULT,
    fitViewOnInit = true,
    nodesDraggable = true,
    onNodePositionChange,
    onNodeDragStop,
    onNodeConnect,
    onNodeClick,
    onNodeDoubleClick,
    onEdgeClick,
    onConnect,
    onPaneClick,
    onPaneContextMenu,
    onMoveEnd,
    children
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewportState] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Measured node sizes (id → {width,height}) so edges attach to the real card edges.
  const [sizes, setSizes] = useState<Record<string, MeasuredSize>>({});
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // ── Node exit animation (docs §9.2) ──────────────────────────────────────────
  // A node removed from `nodes` (deletion) lingers briefly as a fading "ghost" with an `is-exiting`
  // class instead of teleporting out. Driven solely by the `nodes` reference, so it never runs — and
  // never re-renders the memoized node subtree — during pan/zoom/typing (guarded by verify:canvas-perf).
  const [exitingNodes, setExitingNodes] = useState<CanvasNode[]>([]);
  const prevNodesRef = useRef(nodes);
  useEffect(() => {
    const prev = prevNodesRef.current;
    prevNodesRef.current = nodes;
    const currentIds = new Set(nodes.map((n) => n.id));
    const removed = prev.filter((n) => !currentIds.has(n.id));
    if (removed.length === 0) return;
    setExitingNodes((list) => {
      const known = new Set(list.map((e) => e.id));
      const toAdd = removed.filter((r) => !known.has(r.id));
      return toAdd.length ? [...list, ...toAdd] : list;
    });
    const removedIds = removed.map((r) => r.id);
    const timer = window.setTimeout(() => {
      setExitingNodes((list) => list.filter((e) => !removedIds.includes(e.id)));
    }, NODE_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [nodes]);
  // Drop any ghost whose id has returned to `nodes` so we never emit a duplicate React key.
  const currentNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const visibleExiting = exitingNodes.filter((n) => !currentNodeIds.has(n.id));
  // Stable no-op so ghost nodes don't re-report sizes (and can't defeat NodeContainer's memo).
  const noopMeasure = useCallback(() => {}, []);

  const didFitRef = useRef(false);
  const [labelOverlay, setLabelOverlay] = useState<HTMLDivElement | null>(null);
  // When true, the transform briefly CSS-transitions (animated fit/pan/drawer-shift); off during
  // interactive pan/zoom so those stay 1:1 with the cursor.
  const [viewportAnim, setViewportAnim] = useState(false);
  const viewportAnimTimer = useRef<number | null>(null);

  const reportSize = useCallback((id: string, size: MeasuredSize) => {
    setSizes((current) => {
      const prev = current[id];
      if (prev && Math.abs(prev.width - size.width) < 0.5 && Math.abs(prev.height - size.height) < 0.5) {
        return current;
      }
      return { ...current, [id]: size };
    });
  }, []);

  const getContainerRect = useCallback((): DOMRect => {
    return containerRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
  }, []);

  const screenToFlowPosition = useCallback(
    (client: XYPosition): XYPosition => {
      const rect = getContainerRect();
      return pointToFlowPosition(client.x, client.y, rect.left, rect.top, [viewportRef.current.x, viewportRef.current.y, viewportRef.current.zoom]);
    },
    [getContainerRect]
  );

  const nodeRect = useCallback((node: CanvasNode): Rect => {
    const size = sizesRef.current[node.id];
    return {
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? size?.width ?? 320,
      height: node.height ?? size?.height ?? 72
    };
  }, []);

  const applyViewport = useCallback(
    (next: Viewport, options?: { duration?: number }) => {
      if (options?.duration) {
        setViewportAnim(true);
        if (viewportAnimTimer.current) window.clearTimeout(viewportAnimTimer.current);
        viewportAnimTimer.current = window.setTimeout(() => setViewportAnim(false), options.duration + 40);
      }
      setViewportState(next);
      onMoveEnd?.(next);
    },
    [onMoveEnd]
  );

  const panBy = useCallback(
    (dx: number, dy: number, options?: { duration?: number }) => {
      const current = viewportRef.current;
      applyViewport({ x: current.x + dx, y: current.y + dy, zoom: current.zoom }, options);
    },
    [applyViewport]
  );

  const fitView = useCallback(
    (options?: { padding?: number; duration?: number; maxZoom?: number }) => {
      const rect = getContainerRect();
      if (rect.width === 0 || rect.height === 0 || nodesRef.current.length === 0) return;
      const rects = nodesRef.current.map((node) => nodeRect(node));
      const bounds = getRectOfNodes(rects);
      if (bounds.width === 0 || bounds.height === 0) return;
      const next = getViewportForBounds(bounds, rect.width, rect.height, minZoom, options?.maxZoom ?? maxZoom, options?.padding ?? 0.2);
      applyViewport(next, options);
    },
    [applyViewport, getContainerRect, maxZoom, minZoom, nodeRect]
  );

  const zoomTo = useCallback(
    (zoom: number, options?: { duration?: number }) => {
      const rect = getContainerRect();
      const clamped = clamp(zoom, minZoom, maxZoom);
      const current = viewportRef.current;
      // Keep the viewport center fixed while zooming.
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const flowX = (cx - current.x) / current.zoom;
      const flowY = (cy - current.y) / current.zoom;
      const x = cx - flowX * clamped;
      const y = cy - flowY * clamped;
      applyViewport({ x, y, zoom: clamped }, options);
    },
    [applyViewport, getContainerRect, maxZoom, minZoom]
  );

  const setViewport = useCallback(
    (next: Viewport, options?: { duration?: number }) => applyViewport(next, options),
    [applyViewport]
  );

  const getIntersectingNodes = useCallback(
    (node: { id: string }): CanvasNode[] => {
      const subject = nodesRef.current.find((n) => n.id === node.id);
      if (!subject) return [];
      const subjectRect = nodeRect(subject);
      return nodesRef.current.filter((n) => n.id !== subject.id && getOverlappingArea(subjectRect, nodeRect(n)) > 0);
    },
    [nodeRect]
  );

  // Fit once, after the first size measurement, when requested.
  useLayoutEffect(() => {
    if (!fitViewOnInit || didFitRef.current) return;
    if (nodes.length === 0) return;
    const measured = nodes.every((n) => sizes[n.id] || (n.width && n.height));
    if (!measured) return;
    didFitRef.current = true;
    fitView({ padding: 0.2 });
  }, [fitViewOnInit, nodes, sizes, fitView]);

  const contextValue = useMemo<CanvasContextValue>(
    () => ({ viewport, minZoom, maxZoom, screenToFlowPosition, fitView, zoomTo, getIntersectingNodes, setViewport }),
    [viewport, minZoom, maxZoom, screenToFlowPosition, fitView, zoomTo, getIntersectingNodes, setViewport]
  );

  useImperativeHandle(ref, () => ({ fitView, zoomTo, screenToFlowPosition, panBy }), [fitView, zoomTo, screenToFlowPosition, panBy]);

  // ── Pane panning ───────────────────────────────────────────────────────────
  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const movedRef = useRef(false);

  const onPanePointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Only start panning from the pane background (not a node / interactive element).
      const target = event.target as HTMLElement;
      if (target.closest("[data-canvas-node]") || target.closest(".nopan")) return;
      if (event.button !== 0) return;
      panState.current = { startX: event.clientX, startY: event.clientY, originX: viewportRef.current.x, originY: viewportRef.current.y };
      movedRef.current = false;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    []
  );

  const onPanePointerMove = useCallback((event: React.PointerEvent) => {
    const pan = panState.current;
    if (!pan) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (Math.abs(dx) > CONNECT_THRESHOLD || Math.abs(dy) > CONNECT_THRESHOLD) movedRef.current = true;
    // React may execute this updater after pointer-up has cleared panState.current. Capture the
    // immutable pointer-down snapshot now so the queued update never reads a released gesture.
    setViewportState((viewport) => ({ ...viewport, x: pan.originX + dx, y: pan.originY + dy }));
  }, []);

  const onPanePointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (panState.current) {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        panState.current = null;
        if (movedRef.current) {
          onMoveEnd?.(viewportRef.current);
        } else {
          onPaneClick?.();
        }
      }
    },
    [onMoveEnd, onPaneClick]
  );

  // ── Wheel zoom (cursor-anchored) ────────────────────────────────────────────
  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault();
      const rect = getContainerRect();
      const current = viewportRef.current;
      const scale = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nextZoom = clamp(current.zoom * scale, minZoom, maxZoom);
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const flowX = (px - current.x) / current.zoom;
      const flowY = (py - current.y) / current.zoom;
      const x = px - flowX * nextZoom;
      const y = py - flowY * nextZoom;
      setViewportState({ x, y, zoom: nextZoom });
    },
    [getContainerRect, maxZoom, minZoom]
  );

  const onWheelEndRef = useRef<number | null>(null);
  const scheduleMoveEnd = useCallback(() => {
    if (onWheelEndRef.current) window.clearTimeout(onWheelEndRef.current);
    onWheelEndRef.current = window.setTimeout(() => onMoveEnd?.(viewportRef.current), 160);
  }, [onMoveEnd]);

  // ── Live node drag → edge-follow ────────────────────────────────────────────
  // While a node is dragged, only the edges touching it need to re-route. We track the live
  // position (rAF-batched, so at most one state update per frame) and render just those edges in
  // a small overlay (DraggingEdgeLayer); the memoized EdgeLayer stays static and skips the dragged
  // node's edges, so a drag never re-computes the whole connector layer.
  const [dragState, setDragState] = useState<{ id: string; position: XYPosition } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const dragLatestRef = useRef<{ id: string; position: XYPosition } | null>(null);
  const handleNodeDrag = useCallback((id: string, position: XYPosition) => {
    dragLatestRef.current = { id, position };
    if (dragRafRef.current != null) return;
    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = null;
      setDragState(dragLatestRef.current);
    });
  }, []);
  const handleNodeDragEnd = useCallback(() => {
    if (dragRafRef.current != null) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    dragLatestRef.current = null;
    setDragState(null);
  }, []);

  // Drag-to-connect: on drop, if the node overlaps another, emit the pair (largest overlap). Uses the
  // FINAL drop position (the page's setNodes hasn't committed yet), not the stale prop position.
  const handleNodeDragStop = useCallback(
    (id: string, position: XYPosition) => {
      onNodeDragStop?.(id, position);
      if (!onNodeConnect) return;
      const size = sizesRef.current[id];
      const subjectRect: Rect = { x: position.x, y: position.y, width: size?.width ?? 320, height: size?.height ?? 72 };
      let best: { id: string; area: number } | null = null;
      for (const other of nodesRef.current) {
        if (other.id === id) continue;
        const area = getOverlappingArea(subjectRect, nodeRect(other));
        if (area > 0 && (!best || area > best.area)) best = { id: other.id, area };
      }
      if (best) onNodeConnect(id, best.id);
    },
    [onNodeDragStop, onNodeConnect, nodeRect]
  );

  return (
    <CanvasContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        className={["awkit-flow-canvas", className].filter(Boolean).join(" ")}
        onPointerDown={onPanePointerDown}
        onPointerMove={onPanePointerMove}
        onPointerUp={onPanePointerUp}
        onWheel={(event) => {
          onWheel(event);
          scheduleMoveEnd();
        }}
        onContextMenu={(event) => {
          if (onPaneContextMenu) onPaneContextMenu(event);
        }}
      >
        <div
          className="awkit-flow-transform"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 1,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: "0 0",
            transition: viewportAnim ? "transform 260ms var(--awkit-ease-out, ease)" : undefined
          }}
        >
          <EdgeLabelContext.Provider value={labelOverlay}>
            <EdgeLayer nodes={nodes} edges={edges} edgeTypes={edgeTypes} sizes={sizes} onEdgeClick={onEdgeClick} draggingId={dragState?.id ?? null} />
            {dragState ? <DraggingEdgeLayer nodes={nodes} edges={edges} edgeTypes={edgeTypes} sizes={sizes} drag={dragState} /> : null}
            <div ref={setLabelOverlay} className="awkit-flow-edge-labels" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }} />
          </EdgeLabelContext.Provider>
          <div className="awkit-flow-nodes">
            {nodes.map((node) => (
              <NodeContainer
                key={node.id}
                node={node}
                nodeTypes={nodeTypes}
                draggable={nodesDraggable && node.draggable !== false}
                viewportRef={viewportRef}
                onMeasure={reportSize}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onNodePositionChange={onNodePositionChange}
                onNodeDragStop={handleNodeDragStop}
                onNodeDrag={handleNodeDrag}
                onNodeDragEnd={handleNodeDragEnd}
              />
            ))}
            {/* Deleted nodes fade out as non-interactive ghosts before unmount (docs §9.2). */}
            {visibleExiting.map((node) => (
              <NodeContainer
                key={`exiting-${node.id}`}
                node={node}
                nodeTypes={nodeTypes}
                draggable={false}
                exiting
                viewportRef={viewportRef}
                onMeasure={noopMeasure}
              />
            ))}
          </div>
        </div>
        {children}
      </div>
    </CanvasContext.Provider>
  );
});

// ── Node container: absolute positioning, measurement, drag ───────────────────
// Memoized so viewport-only changes (pan / zoom / wheel) — which re-render <FlowCanvas>
// but leave every node's props referentially stable — do NOT re-render the node cards.
// The current zoom is read from `viewportRef` inside the drag handler instead of being
// passed as a prop, so a zoom change never invalidates the memo. The node component is
// rendered internally (not passed as `children`) so a fresh child element each parent
// render can't defeat the memo either.
interface NodeContainerProps {
  node: CanvasNode;
  nodeTypes: NodeTypes;
  draggable: boolean;
  /** Rendered as a fading exit "ghost" (deleted node); ignores pointer input while it animates out. */
  exiting?: boolean;
  viewportRef: MutableRefObject<Viewport>;
  onMeasure: (id: string, size: MeasuredSize) => void;
  onNodeClick?: (id: string) => void;
  onNodeDoubleClick?: (id: string) => void;
  onNodePositionChange?: (id: string, position: XYPosition) => void;
  onNodeDragStop?: (id: string, position: XYPosition) => void;
  /** Live drag position (per frame) so only the connected edges follow — see DraggingEdgeLayer. */
  onNodeDrag?: (id: string, position: XYPosition) => void;
  onNodeDragEnd?: () => void;
}

const NodeContainer = memo(function NodeContainer({
  node,
  nodeTypes,
  draggable,
  exiting,
  viewportRef,
  onMeasure,
  onNodeClick,
  onNodeDoubleClick,
  onNodePositionChange,
  onNodeDragStop,
  onNodeDrag,
  onNodeDragEnd
}: NodeContainerProps) {
  bumpRenderProbe("node");
  const elementRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const dragPositionRef = useRef<XYPosition | null>(null);
  const [drag, setDrag] = useState<XYPosition | null>(null);

  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    const measure = () => onMeasure(node.id, { width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [node.id, onMeasure]);

  const pos = drag ?? node.position;

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const target = event.target as HTMLElement;
      // Let buttons / inputs inside the node handle their own clicks.
      if (target.closest("button, a, input, textarea, select, .nodrag")) return;
      if (event.button !== 0 || !draggable) return;
      event.stopPropagation();
      dragRef.current = { startX: event.clientX, startY: event.clientY, originX: node.position.x, originY: node.position.y, moved: false };
      dragPositionRef.current = null;
      elementRef.current?.setPointerCapture(event.pointerId);
    },
    [draggable, node.position.x, node.position.y]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragRef.current) return;
      const zoom = viewportRef.current.zoom || 1;
      const screenDx = event.clientX - dragRef.current.startX;
      const screenDy = event.clientY - dragRef.current.startY;
      const dx = screenDx / zoom;
      const dy = screenDy / zoom;
      // Latch "moved" from the SCREEN-space delta (zoom-independent) so a small hand tremor on a
      // click isn't read as a drag; placement below still uses the exact canvas-space delta.
      if (Math.abs(screenDx) > NODE_DRAG_THRESHOLD_PX || Math.abs(screenDy) > NODE_DRAG_THRESHOLD_PX) {
        dragRef.current.moved = true;
      }
      const next = { x: dragRef.current.originX + dx, y: dragRef.current.originY + dy };
      dragPositionRef.current = next;
      setDrag(next);
      // Report the live position so connected edges follow (rAF-batched in the parent).
      onNodeDrag?.(node.id, next);
    },
    [viewportRef, onNodeDrag, node.id]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (!dragRef.current) return;
      elementRef.current?.releasePointerCapture(event.pointerId);
      const moved = dragRef.current.moved;
      // Pointer-up can run before React commits the final setDrag render. The gesture ref is the
      // authoritative position calculated from the latest pointer event.
      const finalPos = dragPositionRef.current;
      dragRef.current = null;
      dragPositionRef.current = null;
      if (moved && finalPos) {
        onNodePositionChange?.(node.id, finalPos);
        onNodeDragStop?.(node.id, finalPos);
      } else {
        onNodeClick?.(node.id);
      }
      setDrag(null);
      onNodeDragEnd?.();
    },
    [node.id, onNodeClick, onNodePositionChange, onNodeDragStop, onNodeDragEnd]
  );

  const NodeComponent = node.type ? nodeTypes[node.type] : undefined;
  if (!NodeComponent) return null;

  return (
    <div
      ref={elementRef}
      data-canvas-node={node.id}
      data-id={node.id}
      className={exiting ? "awkit-flow-node is-exiting" : "awkit-flow-node"}
      aria-hidden={exiting ? true : undefined}
      style={{ position: "absolute", top: 0, left: 0, transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`, cursor: draggable ? "grab" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onNodeDoubleClick?.(node.id);
      }}
    >
      <NodeComponent id={node.id} data={node.data as never} selected={Boolean(node.selected)} type={node.type} xPos={node.position.x} yPos={node.position.y} />
    </div>
  );
});

// ── Edge layer ────────────────────────────────────────────────────────────────
interface EdgeLayerProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  edgeTypes: EdgeTypes;
  sizes: Record<string, MeasuredSize>;
  onEdgeClick?: (id: string) => void;
  /** While a node is dragged, its edges are drawn by DraggingEdgeLayer, so skip them here. */
  draggingId?: string | null;
}

function measuredSizeOf(node: CanvasNode, sizes: Record<string, MeasuredSize>): MeasuredSize {
  return {
    width: node.width ?? sizes[node.id]?.width ?? 320,
    height: node.height ?? sizes[node.id]?.height ?? 72
  };
}

/** One connector `<g>`: bottom-of-source → top-of-target. Shared by the static + dragging layers. */
function renderEdgeElement(
  edge: CanvasEdge,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  edgeTypes: EdgeTypes,
  onEdgeClick?: (id: string) => void
): ReactNode {
  const EdgeComponent = (edge.type && edgeTypes[edge.type]) || edgeTypes.default;
  if (!EdgeComponent) return null;
  const props: CanvasEdgeProps = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: edge.data,
    label: edge.label,
    selected: Boolean(edge.selected),
    style: edge.style
  };
  return (
    <g
      key={edge.id}
      data-id={edge.id}
      data-testid={edge.id}
      data-source={edge.source}
      data-target={edge.target}
      className={["awkit-flow-edge", edge.animated ? "is-animated" : ""].filter(Boolean).join(" ")}
      onClick={() => onEdgeClick?.(edge.id)}
      style={{ pointerEvents: "visibleStroke" }}
    >
      <EdgeComponent {...(props as CanvasEdgeProps<never>)} />
    </g>
  );
}

// Memoized so viewport-only changes (pan / zoom) never recompute all edge paths — the
// layer only re-renders when nodes / edges / measured sizes / drag start-stop actually change.
const EdgeLayer = memo(function EdgeLayer({ nodes, edges, edgeTypes, sizes, onEdgeClick, draggingId }: EdgeLayerProps) {
  bumpRenderProbe("edge");
  const nodeById = useMemo(() => {
    const map = new Map<string, CanvasNode>();
    for (const node of nodes) map.set(node.id, node);
    return map;
  }, [nodes]);

  return (
    <svg className="awkit-flow-edges" style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none", width: "100%", height: "100%" }}>
      {edges.map((edge) => {
        // The dragged node's own edges are rendered live by DraggingEdgeLayer.
        if (draggingId && (edge.source === draggingId || edge.target === draggingId)) return null;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return null;
        const sSize = measuredSizeOf(source, sizes);
        const tSize = measuredSizeOf(target, sizes);
        return renderEdgeElement(
          edge,
          source.position.x + sSize.width / 2,
          source.position.y + sSize.height,
          target.position.x + tSize.width / 2,
          target.position.y,
          edgeTypes,
          onEdgeClick
        );
      })}
    </svg>
  );
});

// ── Dragging-edge overlay ───────────────────────────────────────────────────────
// Renders ONLY the edges touching the actively-dragged node, using its live position, so a drag
// re-routes just those 1–few connectors per frame instead of the whole EdgeLayer. Not memoized —
// it re-renders each rAF frame by design (the dragged position changes), but the work is O(edges
// touching the dragged node), independent of graph size.
interface DraggingEdgeLayerProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  edgeTypes: EdgeTypes;
  sizes: Record<string, MeasuredSize>;
  drag: { id: string; position: XYPosition };
}

function DraggingEdgeLayer({ nodes, edges, edgeTypes, sizes, drag }: DraggingEdgeLayerProps) {
  const nodeById = useMemo(() => {
    const map = new Map<string, CanvasNode>();
    for (const node of nodes) map.set(node.id, node);
    return map;
  }, [nodes]);

  const positionOf = (id: string): XYPosition => (id === drag.id ? drag.position : nodeById.get(id)?.position ?? { x: 0, y: 0 });

  return (
    <svg className="awkit-flow-edges awkit-flow-edges-drag" style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none", width: "100%", height: "100%" }}>
      {edges.map((edge) => {
        if (edge.source !== drag.id && edge.target !== drag.id) return null;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return null;
        const sSize = measuredSizeOf(source, sizes);
        const tSize = measuredSizeOf(target, sizes);
        const sPos = positionOf(edge.source);
        const tPos = positionOf(edge.target);
        return renderEdgeElement(
          edge,
          sPos.x + sSize.width / 2,
          sPos.y + sSize.height,
          tPos.x + tSize.width / 2,
          tPos.y,
          edgeTypes
        );
      })}
    </svg>
  );
}
