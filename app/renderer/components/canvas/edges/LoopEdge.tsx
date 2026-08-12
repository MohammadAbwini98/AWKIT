import { BaseEdge, EdgeLabelRenderer } from "../edgeComponents";
import {
  LOOP_RING_INTERACTION_WIDTH,
  LOOP_RING_LABEL_GAP,
  getLoopOuterRadius,
  getLoopRingRadius
} from "../geometry";
import type { CanvasEdgeProps } from "../types";

/**
 * Circular connector renderer. A structured self-loop is a node-owned ring centered behind its
 * real source card; the edge layer sits below the node layer, so the card naturally occludes the
 * ring's middle while its upper/lower arcs remain visible. Circular styles between distinct nodes
 * retain the legacy curved-edge renderer.
 */
export function LoopEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data, label, selected, style, directional }: CanvasEdgeProps<{ label?: string }>) {
  const isSelfLoop = source === target;
  const resolvedLabel = label ?? data?.label ?? "Next Item";

  if (!isSelfLoop) {
    const bulge = Math.max(sourceX, targetX) + 72;
    const path = `M ${sourceX},${sourceY} C ${bulge},${sourceY + 26} ${bulge},${targetY - 26} ${targetX},${targetY}`;
    return (
      <>
        <BaseEdge id={id} path={path} className={selected ? "is-selected" : undefined} style={style} directional={directional} />
        <EdgeLabelRenderer>
          <div
            className="awkit-edge-label"
            data-edge-id={id}
            style={{ whiteSpace: "nowrap", transform: `translate(-50%, -50%) translate(${bulge}px, ${(sourceY + targetY) / 2}px)` }}
          >
            {resolvedLabel}
          </div>
        </EdgeLabelRenderer>
      </>
    );
  }

  const nodeHeight = Math.abs(targetY - sourceY);
  const centerX = (sourceX + targetX) / 2;
  const centerY = (sourceY + targetY) / 2;
  const ringRadius = getLoopRingRadius(nodeHeight);
  const outerRadius = getLoopOuterRadius(nodeHeight);
  const labelY = centerY - outerRadius - LOOP_RING_LABEL_GAP;
  const controlColor = typeof style?.stroke === "string" ? style.stroke : "var(--awkit-connector-loop)";
  const authoredRingStyle = {
    strokeDasharray: typeof style?.strokeDasharray === "string" ? style.strokeDasharray : undefined,
    strokeWidth: typeof style?.strokeWidth === "number" ? style.strokeWidth : undefined
  };

  return (
    <>
      <g
        className={["awkit-loop-indicator", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
        data-loop-indicator="true"
        data-loop-owner={source}
        style={{ color: controlColor }}
      >
        <circle aria-hidden="true" className="awkit-loop-indicator-outer-ring" cx={centerX} cy={centerY} r={outerRadius} />
        <circle aria-hidden="true" className="awkit-loop-indicator-main-ring" cx={centerX} cy={centerY} r={ringRadius} style={authoredRingStyle} />
        <circle
          aria-hidden="true"
          className="awkit-loop-indicator-sweep"
          cx={centerX}
          cy={centerY}
          r={ringRadius}
          pathLength={100}
        />
        <circle aria-hidden="true" className="awkit-loop-indicator-focus-ring" cx={centerX} cy={centerY} r={outerRadius + 1} />
        <circle
          aria-hidden="true"
          className="awkit-loop-indicator-hit"
          cx={centerX}
          cy={centerY}
          r={ringRadius}
          fill="none"
          stroke="transparent"
          strokeWidth={LOOP_RING_INTERACTION_WIDTH}
          pointerEvents="stroke"
        />
      </g>
      <EdgeLabelRenderer>
        <div
          className="awkit-edge-label awkit-loop-indicator-label"
          data-edge-id={id}
          style={{ whiteSpace: "nowrap", transform: `translate(-50%, -50%) translate(${centerX}px, ${labelY}px)` }}
        >
          {resolvedLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
