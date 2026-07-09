import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { Plus } from "lucide-react";

/**
 * Display-only data added to canvas-rendered edges (never persisted to flow JSON).
 * `label` renders as a small pill on the connector; `showAddButton` + `onInsertNode`
 * render a violet "+" affordance at the segment midpoint for safe node insertion.
 */
export interface TemplateSmoothEdgeData extends Record<string, unknown> {
  label?: string;
  showAddButton?: boolean;
  onInsertNode?: (edgeId: string) => void;
}

/**
 * Template-style smooth connector: a curved violet edge with an optional label pill and an
 * optional inline add button. Selected/hover visuals + the running (`animated`) flow come from
 * the shared `.react-flow__edge*` rules in global.css. This edge intentionally holds only
 * display data — insertion callbacks are injected per-render by the canvas page and are never
 * serialized into the saved flow.
 */
export function TemplateSmoothEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
  selected
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16
  });

  const edgeData = data as TemplateSmoothEdgeData | undefined;
  const label = edgeData?.label;
  const showAddButton = Boolean(edgeData?.showAddButton && edgeData?.onInsertNode);

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {label ? (
          <div
            className={selected ? "template-edge-label selected" : "template-edge-label"}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 16}px)` }}
          >
            {label}
          </div>
        ) : null}
        {showAddButton ? (
          <button
            className="template-edge-add-button nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            type="button"
            title="Insert node here"
            aria-label="Insert node here"
            onClick={(event) => {
              event.stopPropagation();
              edgeData?.onInsertNode?.(id);
            }}
          >
            <Plus size={14} />
          </button>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}
