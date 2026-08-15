import { BaseEdge, EdgeLabelRenderer } from "../edgeComponents";
import {
  LOOP_CONTROL_HIT_RADIUS,
  LOOP_CONTROL_LABEL_GAP,
  LOOP_CONTROL_LANE_HEIGHT,
  LOOP_CONTROL_LANE_WIDTH,
  LOOP_CONTROL_MAIN_RADIUS,
  LOOP_CONTROL_OUTER_RADIUS,
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
 * Loop renderer. Structured self-loops intentionally use the approved 7282178 design vocabulary:
 * one compact capsule attached to the real node, one dominant concentric control, the configured
 * iteration bound inside that ring, and one rotating circular sweep. The capsule path is stationary
 * and is never duplicated by the generic directional overlay, which avoids the dotted-stroke
 * interference that corrupted the later U-route hybrid. Legacy cross-node `loopBack` connectors
 * retain their separate bounded execution model and return-path renderer.
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
  // selected side anchor from the measured node width, then keep the visual in a compact horizontal
  // capsule instead of routing from bottom-centre around the full card and back to top-centre.
  const nodeCenterX = (sourceX + targetX) / 2;
  const centerY = (sourceY + targetY) / 2;
  const side = loopSide === Position.Right ? 1 : -1;
  const halfNodeWidth = Math.max(0, sourceNodeWidth ?? 0) / 2;
  const nodeSideX = nodeCenterX + side * halfNodeWidth;

  const farX = nodeSideX + side * LOOP_CONTROL_LANE_WIDTH;
  const controlX = nodeSideX + side * (LOOP_CONTROL_LANE_WIDTH / 2);
  const laneX = Math.min(nodeSideX, farX);
  const laneY = centerY - LOOP_CONTROL_LANE_HEIGHT / 2;
  const capX = farX - side * (LOOP_CONTROL_LANE_HEIGHT / 2);
  const lowerY = centerY + LOOP_CONTROL_LANE_HEIGHT / 2;
  const upperY = centerY - LOOP_CONTROL_LANE_HEIGHT / 2;
  const path = `M ${nodeSideX},${lowerY} H ${capX} Q ${farX},${lowerY} ${farX},${centerY} Q ${farX},${upperY} ${capX},${upperY} H ${nodeSideX}`;
  const labelY = centerY - LOOP_CONTROL_OUTER_RADIUS - LOOP_CONTROL_LABEL_GAP;
  const controlColor = typeof style?.stroke === "string" ? style.stroke : "var(--awkit-connector-loop)";
  const configuredValue = Number.isFinite(data?.loop?.maxIterations) ? String(data?.loop?.maxIterations) : undefined;

  return (
    <>
      <g
        className={["awkit-loop-indicator", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
        data-loop-indicator="true"
        data-loop-owner={source}
        data-loop-side={side < 0 ? "left" : "right"}
        data-loop-visual="capsule-ring"
        style={{ color: controlColor }}
      >
        <rect
          aria-hidden="true"
          className="awkit-loop-control-lane"
          x={laneX}
          y={laneY}
          width={LOOP_CONTROL_LANE_WIDTH}
          height={LOOP_CONTROL_LANE_HEIGHT}
          rx={LOOP_CONTROL_LANE_HEIGHT / 2}
          fill="var(--awkit-surface)"
          fillOpacity={0.94}
          stroke="currentColor"
          strokeOpacity={0.34}
          strokeWidth={1}
          pointerEvents="none"
        />
        <BaseEdge
          id={id}
          path={path}
          className={["awkit-loop-indicator-path", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
          style={style}
          directional={false}
          interactionWidth={LOOP_CONTROL_PATH_INTERACTION_WIDTH}
        />
        <g className="awkit-loop-indicator-marker" data-loop-marker="true">
          <circle
            aria-hidden="true"
            className="awkit-loop-control-backplate"
            cx={controlX}
            cy={centerY}
            r={LOOP_CONTROL_OUTER_RADIUS - 5}
            fill="var(--awkit-surface-raised)"
            pointerEvents="none"
          />
          <circle aria-hidden="true" className="awkit-loop-indicator-outer-ring" cx={controlX} cy={centerY} r={LOOP_CONTROL_OUTER_RADIUS} />
          <circle aria-hidden="true" className="awkit-loop-indicator-main-ring" cx={controlX} cy={centerY} r={LOOP_CONTROL_MAIN_RADIUS} />
          <circle
            aria-hidden="true"
            className="awkit-loop-indicator-sweep"
            cx={controlX}
            cy={centerY}
            r={LOOP_CONTROL_MAIN_RADIUS}
            pathLength={100}
            fill="none"
            stroke="currentColor"
            strokeDasharray="22 78"
            strokeLinecap="round"
            strokeWidth={4}
            pointerEvents="none"
          />
          {configuredValue ? (
            <text
              className="awkit-loop-indicator-value"
              x={controlX}
              y={centerY}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--awkit-text)"
              fontSize="var(--text-xs)"
              fontWeight={700}
              pointerEvents="none"
            >
              {configuredValue}
            </text>
          ) : null}
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
            maxWidth: `${LOOP_CONTROL_LANE_WIDTH}px`,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            transform: `translate(-50%, -50%) translate(${controlX}px, ${labelY}px)`
          }}
        >
          {resolvedLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
