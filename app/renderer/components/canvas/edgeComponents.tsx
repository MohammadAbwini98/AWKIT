import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EdgeLabelContext } from "./edgeLabelContext";

/**
 * SVG path for an edge. Drop-in for React Flow's BaseEdge — rendered inside the
 * engine's `<svg>` layer. Visual styling (stroke color/width, hover, selected)
 * comes from the shared `.awkit-flow-edge*` CSS rules.
 */
export function BaseEdge({
  id,
  path,
  style,
  className,
  directional = false,
  interactionWidth = 20
}: {
  id?: string;
  path: string;
  style?: React.CSSProperties;
  className?: string;
  markerEnd?: unknown;
  directional?: boolean;
  interactionWidth?: number;
}) {
  const authoredWidth = typeof style?.strokeWidth === "number" ? style.strokeWidth : 2;
  return (
    <>
      <path id={id} d={path} fill="none" className={["awkit-flow-edge-path", className].filter(Boolean).join(" ")} style={style} />
      {directional ? (
        <path
          aria-hidden="true"
          className="awkit-loop-direction-path"
          d={path}
          fill="none"
          focusable="false"
          pathLength={100}
          style={{ stroke: style?.stroke, strokeWidth: authoredWidth + 1 }}
        />
      ) : null}
      {interactionWidth ? (
        <path
          className="awkit-flow-edge-interaction"
          d={path}
          fill="none"
          pointerEvents="stroke"
          strokeOpacity={0}
          strokeWidth={interactionWidth}
        />
      ) : null}
    </>
  );
}

/**
 * Portals its children into the canvas HTML overlay (inside the transform), so
 * labels/buttons positioned with a flow-coordinate translate land in the right
 * place. Drop-in for React Flow's EdgeLabelRenderer.
 */
export function EdgeLabelRenderer({ children }: { children: ReactNode }) {
  const overlay = useContext(EdgeLabelContext);
  if (!overlay) return null;
  return createPortal(children, overlay);
}
