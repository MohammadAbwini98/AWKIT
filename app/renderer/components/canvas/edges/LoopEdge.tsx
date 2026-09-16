import { BaseEdge, EdgeLabelRenderer } from "../edgeComponents";
import {
  LOOP_CONTROL_CORNER_RADIUS,
  LOOP_CONTROL_HIT_RADIUS,
  LOOP_CONTROL_LABEL_GAP,
  LOOP_CONTROL_LANE_HEIGHT,
  LOOP_CONTROL_LANE_WIDTH,
  LOOP_CONTROL_PATH_INTERACTION_WIDTH,
  Position
} from "../geometry";
import type { CanvasEdgeProps } from "../types";
import type { EdgeVisualStyle, LoopConnectorConfig } from "@src/profiles/FlowProfile";
import { loopBackDesignLabel, loopConnectorDesignLabel } from "../../shared/loopConnectorAuthoring";
import "./LoopEdge.css";

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
 * Loop renderer. Structured self-loops use the approved Workflow Builder green loop design: one
 * compact side bracket attached to the node (faint base stroke), bright marching dashes travelling
 * along it, and a single orbiting dot with a soft halo. The bracket is stationary and is never
 * duplicated by the generic directional overlay, which avoids the dotted-stroke interference that
 * corrupted the later U-route hybrid. Legacy cross-node `loopBack` connectors retain their separate
 * bounded execution model and return-path renderer.
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

  // `FlowCanvas` supplies the node's bottom/top centre for a structured self-loop. Reconstruct the
  // selected side anchor from the measured node width, then keep the visual in the approved compact
  // side bracket (rounded corners, marching dashes, orbiting dot) instead of routing from
  // bottom-centre around the full card and back to top-centre.
  const nodeCenterX = (sourceX + targetX) / 2;
  const centerY = (sourceY + targetY) / 2;
  const side = loopSide === Position.Right ? 1 : -1;
  const halfNodeWidth = Math.max(0, sourceNodeWidth ?? 0) / 2;
  const nodeSideX = nodeCenterX + side * halfNodeWidth;

  const outX = nodeSideX + side * LOOP_CONTROL_LANE_WIDTH;
  const cornerX = outX - side * LOOP_CONTROL_CORNER_RADIUS;
  const topY = centerY - LOOP_CONTROL_LANE_HEIGHT / 2;
  const bottomY = centerY + LOOP_CONTROL_LANE_HEIGHT / 2;
  const radius = LOOP_CONTROL_CORNER_RADIUS;
  const sweep = side > 0 ? 1 : 0;
  const path =
    `M ${nodeSideX},${topY} H ${cornerX} ` +
    `A ${radius} ${radius} 0 0 ${sweep} ${outX},${topY + radius} ` +
    `V ${bottomY - radius} ` +
    `A ${radius} ${radius} 0 0 ${sweep} ${cornerX},${bottomY} ` +
    `H ${nodeSideX}`;
  const controlX = nodeSideX + side * (LOOP_CONTROL_LANE_WIDTH / 2);
  // The label hugs the node side just above the bracket's top arm so it can never fold back over
  // the node itself, whatever its measured width.
  const labelAnchorX = nodeSideX + side * 8;
  const labelY = topY - LOOP_CONTROL_LABEL_GAP - 2;
  const controlColor = typeof style?.stroke === "string" ? style.stroke : "var(--awkit-connector-loop)";

  return (
    <>
      <g
        className={["awkit-loop-indicator", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
        data-loop-indicator="true"
        data-loop-owner={source}
        data-loop-side={side < 0 ? "left" : "right"}
        data-loop-visual="dash-orbit"
        style={{ color: controlColor }}
      >
        <BaseEdge
          id={id}
          path={path}
          className={["awkit-loop-indicator-path", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
          style={style}
          directional={false}
          interactionWidth={LOOP_CONTROL_PATH_INTERACTION_WIDTH}
        />
        <path aria-hidden="true" className="awkit-loop-indicator-dash" d={path} fill="none" pointerEvents="none" />
        <g className="awkit-loop-indicator-marker" data-loop-marker="true">
          <circle
            aria-hidden="true"
            className="awkit-loop-indicator-orbit"
            data-loop-orbit="true"
            r={4}
            style={{ offsetPath: `path("${path}")`, offsetRotate: "0deg" }}
          />
          <circle aria-hidden="true" className="awkit-loop-indicator-focus-ring" cx={controlX} cy={centerY} r={LOOP_CONTROL_HIT_RADIUS - 1} />
          <circle
            aria-hidden="true"
            className="awkit-loop-indicator-hit"
            cx={controlX}
            cy={centerY}
            r={LOOP_CONTROL_HIT_RADIUS}
            fill="transparent"
            pointerEvents="all"
          />
        </g>
      </g>
      <EdgeLabelRenderer>
        <div
          className="awkit-edge-label awkit-loop-indicator-label"
          data-edge-id={id}
          title={resolvedLabel}
          style={{
            maxWidth: "120px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            transform:
              `translate(${side > 0 ? "0" : "-100%"}, -50%) ` +
              `translate(${labelAnchorX}px, ${labelY}px)`
          }}
        >
          {resolvedLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
