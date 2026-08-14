import { BaseEdge, EdgeLabelRenderer } from "../edgeComponents";
import {
  LOOP_MARKER_HIT_RADIUS,
  LOOP_MARKER_LABEL_GAP,
  LOOP_MARKER_OUTER_RADIUS,
  LOOP_MARKER_RADIUS,
  LOOP_RETURN_CLEARANCE,
  LOOP_RETURN_CORNER_RADIUS,
  LOOP_RETURN_INTERACTION_WIDTH,
  Position
} from "../geometry";
import type { CanvasEdgeProps } from "../types";
import type { EdgeVisualStyle, LoopConnectorConfig } from "@src/profiles/FlowProfile";
import { loopBackDesignLabel, loopConnectorDesignLabel } from "../../shared/loopConnectorAuthoring";

interface LoopEdgeData {
  label?: string;
  linkType?: string;
  loop?: LoopConnectorConfig;
  maxLoopCount?: number;
  style?: EdgeVisualStyle;
}

function arrowPath(tipX: number, tipY: number, unitX: number, unitY: number, closed: boolean): string {
  const length = 10;
  const halfWidth = 5;
  const baseX = tipX - unitX * length;
  const baseY = tipY - unitY * length;
  const normalX = -unitY * halfWidth;
  const normalY = unitX * halfWidth;
  const start = `${baseX + normalX},${baseY + normalY}`;
  const end = `${baseX - normalX},${baseY - normalY}`;
  return closed ? `M ${tipX},${tipY} L ${start} L ${end} Z` : `M ${start} L ${tipX},${tipY} L ${end}`;
}

function cubicPointAndTangent(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
): { point: { x: number; y: number }; unit: { x: number; y: number } } {
  const mt = 1 - t;
  const point = {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y
  };
  const tangent = {
    x: 3 * mt ** 2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t ** 2 * (p3.x - p2.x),
    y: 3 * mt ** 2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t ** 2 * (p3.y - p2.y)
  };
  const magnitude = Math.hypot(tangent.x, tangent.y) || 1;
  return { point, unit: { x: tangent.x / magnitude, y: tangent.y / magnitude } };
}

/**
 * Return-connector renderer. Structured self-loops use a rounded path with a compact, static
 * configuration marker; directional motion lives on the path itself. Legacy cross-node
 * `loopBack` connectors retain their execution model while sharing this design-time vocabulary.
 */
export function LoopEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceNodeWidth,
  loopSide,
  data,
  label,
  selected,
  style,
  directional
}: CanvasEdgeProps<LoopEdgeData>) {
  const isSelfLoop = source === target;
  const authoredLabel = label ?? data?.label;
  const resolvedLabel = isSelfLoop
    ? loopConnectorDesignLabel(data?.loop, authoredLabel)
    : data?.linkType === "loopBack"
      ? loopBackDesignLabel(data.maxLoopCount, authoredLabel)
      : authoredLabel ?? "Next Item";
  const arrowHead = data?.style?.arrowHead ?? "closed";
  const showArrow = directional && arrowHead !== "none";
  const arrowClosed = arrowHead !== "default";

  if (!isSelfLoop) {
    const bulge = Math.max(sourceX, targetX) + 72;
    const p0 = { x: sourceX, y: sourceY };
    const p1 = { x: bulge, y: sourceY + 26 };
    const p2 = { x: bulge, y: targetY - 26 };
    const p3 = { x: targetX, y: targetY };
    const path = `M ${p0.x},${p0.y} C ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
    const arrow = cubicPointAndTangent(0.72, p0, p1, p2, p3);
    return (
      <>
        <BaseEdge id={id} path={path} className={selected ? "is-selected" : undefined} style={style} directional={directional} />
        {showArrow ? (
          <path
            aria-hidden="true"
            className={["awkit-loop-indicator-arrow", arrowClosed ? "is-closed" : ""].filter(Boolean).join(" ")}
            d={arrowPath(arrow.point.x, arrow.point.y, arrow.unit.x, arrow.unit.y, arrowClosed)}
            style={{ color: typeof style?.stroke === "string" ? style.stroke : "var(--awkit-connector-loop)" }}
          />
        ) : null}
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

  const centerX = (sourceX + targetX) / 2;
  const centerY = (sourceY + targetY) / 2;
  const side = loopSide === Position.Right ? 1 : -1;
  const halfNodeWidth = Math.max(0, sourceNodeWidth ?? 0) / 2;
  const markerX = centerX + side * (halfNodeWidth + LOOP_RETURN_CLEARANCE);
  const returnBottomY = sourceY + LOOP_RETURN_CLEARANCE;
  const returnTopY = targetY - LOOP_RETURN_CLEARANCE;
  const innerCornerX = centerX + side * LOOP_RETURN_CORNER_RADIUS;
  const outerCornerX = markerX - side * LOOP_RETURN_CORNER_RADIUS;
  const path = [
    `M ${centerX},${sourceY}`,
    `C ${centerX},${sourceY + LOOP_RETURN_CLEARANCE * 0.45} ${centerX},${returnBottomY} ${innerCornerX},${returnBottomY}`,
    `H ${outerCornerX}`,
    `Q ${markerX},${returnBottomY} ${markerX},${returnBottomY - LOOP_RETURN_CORNER_RADIUS}`,
    `V ${returnTopY + LOOP_RETURN_CORNER_RADIUS}`,
    `Q ${markerX},${returnTopY} ${outerCornerX},${returnTopY}`,
    `H ${innerCornerX}`,
    `C ${centerX},${returnTopY} ${centerX},${targetY - LOOP_RETURN_CLEARANCE * 0.45} ${centerX},${targetY}`
  ].join(" ");
  const labelY = centerY - LOOP_MARKER_OUTER_RADIUS - LOOP_MARKER_LABEL_GAP;
  const controlColor = typeof style?.stroke === "string" ? style.stroke : "var(--awkit-connector-loop)";
  const arrowDirection = -side;
  const arrowTipX = innerCornerX - arrowDirection * 4;
  const routeStyle = {
    ...style,
    strokeDasharray:
      data?.style?.lineStyle === "solid"
        ? "none"
        : style?.strokeDasharray ?? "4 7"
  };

  return (
    <>
      <g
        className={["awkit-loop-indicator", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
        data-loop-indicator="true"
        data-loop-owner={source}
        data-loop-side={side < 0 ? "left" : "right"}
        style={{ color: controlColor }}
      >
        <BaseEdge
          id={id}
          path={path}
          className={["awkit-loop-indicator-path", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
          style={routeStyle}
          directional={directional}
          interactionWidth={LOOP_RETURN_INTERACTION_WIDTH}
        />
        {showArrow ? (
          <path
            aria-hidden="true"
            className={["awkit-loop-indicator-arrow", arrowClosed ? "is-closed" : ""].filter(Boolean).join(" ")}
            d={arrowPath(arrowTipX, returnTopY, arrowDirection, 0, arrowClosed)}
          />
        ) : null}
        <g className="awkit-loop-indicator-marker" data-loop-marker="true">
          <circle aria-hidden="true" className="awkit-loop-indicator-outer-ring" cx={markerX} cy={centerY} r={LOOP_MARKER_OUTER_RADIUS} />
          <circle aria-hidden="true" className="awkit-loop-indicator-main-ring" cx={markerX} cy={centerY} r={LOOP_MARKER_RADIUS} />
          <circle aria-hidden="true" className="awkit-loop-indicator-focus-ring" cx={markerX} cy={centerY} r={LOOP_MARKER_OUTER_RADIUS + 1} />
          <circle
            aria-hidden="true"
            className="awkit-loop-indicator-hit"
            cx={markerX}
            cy={centerY}
            r={LOOP_MARKER_HIT_RADIUS}
            fill="transparent"
            pointerEvents="all"
          />
        </g>
      </g>
      <EdgeLabelRenderer>
        <div
          className="awkit-edge-label awkit-loop-indicator-label"
          data-edge-id={id}
          style={{ whiteSpace: "nowrap", transform: `translate(-50%, -50%) translate(${markerX}px, ${labelY}px)` }}
        >
          {resolvedLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
