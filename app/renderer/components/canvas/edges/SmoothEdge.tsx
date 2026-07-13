import { Plus } from "lucide-react";
import { getSmoothStepPath } from "../geometry";
import { BaseEdge, EdgeLabelRenderer } from "../edgeComponents";
import type { CanvasEdgeProps } from "../types";

/**
 * Display data attached to canvas-rendered edges (never persisted). `label`
 * renders a small pill; `showAddButton` + `onInsertNode` render the violet "+"
 * insert affordance at the segment midpoint. Mirrors the Workflow reference
 * InsertableEdge.
 */
export interface SmoothEdgeData extends Record<string, unknown> {
  label?: string;
  showAddButton?: boolean;
  onInsertNode?: (edgeId: string, anchor: HTMLElement) => void;
}

/**
 * Smooth-step connector: a curved edge with an optional label pill and an
 * optional inline "+" insert button. Branch edges (those carrying a label like
 * "If true") render only the label; plain spine edges expose the "+".
 */
export function SmoothEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, label, selected, style }: CanvasEdgeProps<SmoothEdgeData>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16
  });

  const resolvedLabel = label ?? data?.label;
  const isBranch = Boolean(resolvedLabel);
  const showAddButton = Boolean(data?.showAddButton && data?.onInsertNode);

  return (
    <>
      <BaseEdge id={id} path={edgePath} className={selected ? "is-selected" : undefined} style={style} />
      <EdgeLabelRenderer>
        {isBranch ? (
          // Offset the label ABOVE the midpoint so it never sits under the insert "+"; without the
          // offset the "+" splits the label text (e.g. "If true" rendered as "I…e"). Keeps the label
          // fully readable on both spine and branch connectors.
          <div
            className="awkit-edge-label nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - (showAddButton ? 18 : 0)}px)` }}
          >
            {resolvedLabel}
          </div>
        ) : null}
        {showAddButton ? (
          <button
            type="button"
            aria-label="Insert step here"
            className="awkit-edge-add nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={(event) => {
              event.stopPropagation();
              data?.onInsertNode?.(id, event.currentTarget);
            }}
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}
