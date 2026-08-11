import { Plus } from "lucide-react";
import { Position, SMOOTH_STEP_OFFSET, getSmoothStepPath } from "../geometry";
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
  insertControlRole?: "default" | "loop-exit";
  onInsertNode?: (edgeId: string, anchor: HTMLElement) => void;
}

/**
 * Smooth-step connector: a curved edge with an optional label pill and an
 * optional inline "+" insert button. Branch edges (those carrying a label like
 * "If true") render only the label; plain spine edges expose the "+".
 */
export function SmoothEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, label, selected, style, directional }: CanvasEdgeProps<SmoothEdgeData>) {
  const showAddButton = Boolean(data?.showAddButton && data?.onInsertNode);
  const isLoopExitControl = showAddButton && data?.insertControlRole === "loop-exit";
  const usesLoopExitSourceStem = isLoopExitControl && (sourcePosition ?? Position.Bottom) === Position.Bottom && targetY <= sourceY;
  const usesLoopExitSideRoute = isLoopExitControl && sourcePosition === Position.Right && targetPosition === Position.Right;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
    // Loop exits use a larger anchor clearance on their source stem or side route so
    // the enlarged control and halo never touch either endpoint card.
    offset: usesLoopExitSourceStem || usesLoopExitSideRoute ? SMOOTH_STEP_OFFSET * 2 : SMOOTH_STEP_OFFSET
  });

  const resolvedLabel = label ?? data?.label;
  const isBranch = Boolean(resolvedLabel);
  const controlX = usesLoopExitSourceStem ? sourceX : labelX;
  const controlY = usesLoopExitSourceStem ? sourceY + SMOOTH_STEP_OFFSET : labelY;
  let labelTransform = `translate(-50%, -50%) translate(${labelX}px, ${labelY - (showAddButton ? 18 : 0)}px)`;
  if (isLoopExitControl) {
    labelTransform = usesLoopExitSourceStem
      ? `translate(-50%, -50%) translate(${controlX}px, calc(${controlY}px + var(--awkit-loop-exit-control-label-offset)))`
      : `translate(-50%, -50%) translate(${controlX}px, calc(${controlY}px - var(--awkit-loop-exit-control-label-offset)))`;
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} className={selected ? "is-selected" : undefined} style={style} directional={directional} />
      <EdgeLabelRenderer>
        {isBranch ? (
          // Offset the label away from the midpoint so it never sits under the insert "+". Loop exits
          // use the clear side of their enlarged control; other edges keep the original upper offset.
          <div
            className={["awkit-edge-label", "nopan", isLoopExitControl ? "is-loop-exit-affordance" : ""].filter(Boolean).join(" ")}
            data-edge-id={id}
            data-insert-role={isLoopExitControl ? "loop-exit" : "default"}
            style={{ transform: labelTransform }}
          >
            {resolvedLabel}
          </div>
        ) : null}
        {showAddButton ? (
          <button
            type="button"
            aria-label={isLoopExitControl ? "Insert step on loop exit" : "Insert step here"}
            className={["awkit-edge-add", "nodrag", "nopan", isLoopExitControl ? "is-loop-exit-affordance" : ""].filter(Boolean).join(" ")}
            data-edge-id={id}
            data-insert-role={isLoopExitControl ? "loop-exit" : "default"}
            style={{ transform: `translate(-50%, -50%) translate(${controlX}px, ${controlY}px)` }}
            onClick={(event) => {
              event.stopPropagation();
              data?.onInsertNode?.(id, event.currentTarget);
            }}
          >
            <Plus className="awkit-edge-add-icon" size={14} strokeWidth={2.5} aria-hidden="true" />
          </button>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}
