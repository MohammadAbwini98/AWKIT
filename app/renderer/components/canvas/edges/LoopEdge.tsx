import { BaseEdge, EdgeLabelRenderer } from "../edgeComponents";
import { LOOP_ARC_HEIGHT, LOOP_INTERACTION_WIDTH, SMOOTH_STEP_OFFSET } from "../geometry";
import type { CanvasEdgeProps } from "../types";

/**
 * Circular connector renderer. Structured self-loops restore the original dedicated top-port
 * design: a large, unobstructed arc above the card. The saved circular style can also be used on
 * distinct nodes; those retain the existing right-bulging curve.
 */
export function LoopEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data, label, selected, style, directional }: CanvasEdgeProps<{ label?: string }>) {
  const isSelfLoop = source === target;
  const shoulder = Math.abs(targetX - sourceX) / 4;
  const bulge = Math.max(sourceX, targetX) + 72;
  const path = isSelfLoop
    ? `M ${sourceX},${sourceY} C ${sourceX - shoulder},${sourceY - LOOP_ARC_HEIGHT} ${targetX + shoulder},${targetY - LOOP_ARC_HEIGHT} ${targetX},${targetY}`
    : `M ${sourceX},${sourceY} C ${bulge},${sourceY + 26} ${bulge},${targetY - 26} ${targetX},${targetY}`;
  const labelX = isSelfLoop ? (sourceX + targetX) / 2 : bulge;
  const labelY = isSelfLoop
    ? Math.min(sourceY, targetY) - LOOP_ARC_HEIGHT - SMOOTH_STEP_OFFSET / 4
    : (sourceY + targetY) / 2;
  const resolvedLabel = label ?? data?.label ?? "Next Item";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={selected ? "is-selected" : undefined}
        style={style}
        directional={directional}
        interactionWidth={isSelfLoop ? LOOP_INTERACTION_WIDTH : 20}
      />
      <EdgeLabelRenderer>
        <div
          className={["awkit-edge-label", isSelfLoop ? "awkit-loop-edge-label" : ""].filter(Boolean).join(" ")}
          data-edge-id={id}
          style={{ whiteSpace: "nowrap", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {resolvedLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
