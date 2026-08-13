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

interface LoopEdgeData {
  label?: string;
  loop?: LoopConnectorConfig;
  style?: EdgeVisualStyle;
}

/**
 * Circular connector renderer. A structured self-loop is one rounded return path with a compact,
 * animated configuration marker attached to it. Circular styles between distinct nodes retain the
 * legacy curved-edge renderer.
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
  const configuredTotal = data?.loop?.maxIterations;
  const markerValue = typeof configuredTotal === "number" && Number.isFinite(configuredTotal) ? String(configuredTotal) : undefined;
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
          directional={false}
          interactionWidth={LOOP_RETURN_INTERACTION_WIDTH}
        />
        <g className="awkit-loop-indicator-marker" data-loop-marker="true">
          <circle aria-hidden="true" className="awkit-loop-indicator-outer-ring" cx={markerX} cy={centerY} r={LOOP_MARKER_OUTER_RADIUS} />
          <circle aria-hidden="true" className="awkit-loop-indicator-main-ring" cx={markerX} cy={centerY} r={LOOP_MARKER_RADIUS} />
          <circle
            aria-hidden="true"
            className="awkit-loop-indicator-sweep"
            cx={markerX}
            cy={centerY}
            r={LOOP_MARKER_RADIUS}
            pathLength={100}
          />
          {markerValue !== undefined ? (
            <text aria-hidden="true" className="awkit-loop-indicator-value" x={markerX} y={centerY}>
              {markerValue}
            </text>
          ) : null}
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
