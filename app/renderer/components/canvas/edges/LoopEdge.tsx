import { BaseEdge, EdgeLabelRenderer } from "../edgeComponents";
import {
  LOOP_CONTROL_HIT_RADIUS,
  LOOP_CONTROL_LABEL_GAP,
  LOOP_CONTROL_LANE_HEIGHT,
  LOOP_CONTROL_LANE_WIDTH,
  LOOP_CONTROL_MAIN_RADIUS,
  LOOP_CONTROL_OUTER_RADIUS,
  LOOP_INTERACTION_WIDTH,
  Position,
  SMOOTH_STEP_OFFSET
} from "../geometry";
import type { CanvasEdgeProps } from "../types";

/**
 * Circular connector renderer. A structured self-loop is a purpose-built Loop control: a stable
 * capsule lane, authored return route, concentric mechanism, fixed anchor, and one rotating sweep.
 * Circular styles between distinct nodes retain the legacy curved-edge renderer.
 */
export function LoopEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, data, label, selected, style, directional }: CanvasEdgeProps<{ label?: string }>) {
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

  const side = sourcePosition === Position.Left ? -1 : 1;
  const centerY = (sourceY + targetY) / 2;
  const farX = sourceX + side * LOOP_CONTROL_LANE_WIDTH;
  const capX = farX - side * (LOOP_CONTROL_LANE_HEIGHT / 2);
  const centerX = sourceX + side * (LOOP_CONTROL_LANE_WIDTH / 2);
  const laneX = Math.min(sourceX, farX);
  const laneY = centerY - LOOP_CONTROL_LANE_HEIGHT / 2;
  const path = `M ${sourceX},${sourceY} H ${capX} Q ${farX},${sourceY} ${farX},${centerY} Q ${farX},${targetY} ${capX},${targetY} H ${targetX}`;
  const labelY = centerY - LOOP_CONTROL_OUTER_RADIUS - LOOP_CONTROL_LABEL_GAP;
  const controlColor = typeof style?.stroke === "string" ? style.stroke : "var(--awkit-connector-loop)";

  return (
    <>
      <g
        className={["awkit-loop-control", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
        data-loop-control="true"
        data-loop-side={side < 0 ? "left" : "right"}
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
        />
        <BaseEdge
          id={id}
          path={path}
          className={selected ? "is-selected" : undefined}
          style={style}
          interactionWidth={LOOP_INTERACTION_WIDTH}
        />
        <circle aria-hidden="true" className="awkit-loop-control-halo" cx={centerX} cy={centerY} r={LOOP_CONTROL_OUTER_RADIUS} />
        <circle aria-hidden="true" className="awkit-loop-control-backplate" cx={centerX} cy={centerY} r={LOOP_CONTROL_OUTER_RADIUS - SMOOTH_STEP_OFFSET / 4} />
        <circle aria-hidden="true" className="awkit-loop-control-outer-ring" cx={centerX} cy={centerY} r={LOOP_CONTROL_OUTER_RADIUS} />
        <circle aria-hidden="true" className="awkit-loop-control-main-ring" cx={centerX} cy={centerY} r={LOOP_CONTROL_MAIN_RADIUS} />
        <circle
          aria-hidden="true"
          className="awkit-loop-control-sweep"
          cx={centerX}
          cy={centerY}
          r={LOOP_CONTROL_MAIN_RADIUS}
          pathLength={100}
        />
        <circle aria-hidden="true" className="awkit-loop-control-inner-ring" cx={centerX} cy={centerY} r={SMOOTH_STEP_OFFSET / 2} />
        <circle aria-hidden="true" className="awkit-loop-control-center-dot" cx={centerX} cy={centerY} r={SMOOTH_STEP_OFFSET * 0.15} />
        <circle aria-hidden="true" className="awkit-loop-control-focus-ring" cx={centerX} cy={centerY} r={LOOP_CONTROL_HIT_RADIUS - 1} />
        <circle
          aria-hidden="true"
          className="awkit-loop-control-hit"
          cx={centerX}
          cy={centerY}
          r={LOOP_CONTROL_HIT_RADIUS}
          fill="transparent"
          pointerEvents="all"
        />
      </g>
      <EdgeLabelRenderer>
        <div
          className="awkit-edge-label awkit-loop-edge-label"
          data-edge-id={id}
          style={{ whiteSpace: "nowrap", transform: `translate(-50%, -50%) translate(${centerX}px, ${labelY}px)` }}
        >
          {resolvedLabel}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
