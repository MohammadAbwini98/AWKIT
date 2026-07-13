import { BaseEdge, EdgeLabelRenderer } from "../edgeComponents";
import type { CanvasEdgeProps } from "../types";

/**
 * Self-referencing loop connector: bulges out to the right of a node and curves
 * back into it, carrying a "Next Item"/loop label. Used when source === target.
 * Mirrors the Workflow reference LoopBackEdge.
 */
export function LoopEdge({ id, sourceX, sourceY, targetX, targetY, data, label, selected, style }: CanvasEdgeProps<{ label?: string }>) {
  const bulge = Math.max(sourceX, targetX) + 72;
  const path = `M ${sourceX},${sourceY} C ${bulge},${sourceY + 26} ${bulge},${targetY - 26} ${targetX},${targetY}`;
  const labelX = bulge;
  const labelY = (sourceY + targetY) / 2;
  const resolvedLabel = label ?? data?.label ?? "Next Item";

  return (
    <>
      <BaseEdge id={id} path={path} className={selected ? "is-selected" : undefined} style={style} />
      <EdgeLabelRenderer>
        <div className="awkit-edge-label" style={{ whiteSpace: "nowrap", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          {resolvedLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
