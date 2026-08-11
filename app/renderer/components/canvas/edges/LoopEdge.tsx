import { BaseEdge, EdgeLabelRenderer } from "../edgeComponents";
import { Position } from "../geometry";
import type { CanvasEdgeProps } from "../types";

/**
 * Self-referencing loop connector: bulges out from the clearer side of a node and curves
 * back into it, carrying a "Next Item"/loop label. Used when source === target.
 * Mirrors the Workflow reference LoopBackEdge.
 */
export function LoopEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, data, label, selected, style, directional }: CanvasEdgeProps<{ label?: string }>) {
  const side = sourcePosition === Position.Left ? -1 : 1;
  const bulge = (side < 0 ? Math.min(sourceX, targetX) : Math.max(sourceX, targetX)) + side * 72;
  const path = `M ${sourceX},${sourceY} C ${bulge},${sourceY + 26} ${bulge},${targetY - 26} ${targetX},${targetY}`;
  // Cubic Bézier midpoint at t=.5. Keeping the label on the visible curve also makes the
  // connector's generous interaction path easy to find beside the node.
  const labelX = 0.125 * (sourceX + targetX) + 0.75 * bulge;
  const labelY = (sourceY + targetY) / 2;
  const resolvedLabel = label ?? data?.label ?? "Next Item";

  return (
    <>
      <BaseEdge id={id} path={path} className={selected ? "is-selected" : undefined} style={style} directional={directional} />
      <EdgeLabelRenderer>
        <div className="awkit-edge-label" style={{ whiteSpace: "nowrap", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          {resolvedLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
