import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

/**
 * Custom "circular" edge (Point 5) for self-loop connectors (Point 4: a loop connector's
 * source and target are always the same node). For a true self-loop (`source === target`)
 * it draws a semicircle that leaves the node's top loop port and curves back into it,
 * routed above the node so it never covers the card. Registered under the React Flow edge
 * type key `circular` in both the Flow Designer and Workflow Builder canvases; also used as
 * a general "curved" option for connectors between two distinct nodes.
 */
export function SelfLoopEdge({ id, source, target, sourceX, sourceY, targetX, targetY, markerEnd, style, label, selected }: EdgeProps) {
  // A self-loop is authoritative on node identity, not coordinates — the two top loop
  // handles sit slightly apart, so a coordinate-distance check would misclassify them.
  const isSelf = source === target;

  let path: string;
  let labelX: number;
  let labelY: number;

  if (isSelf) {
    // Self-loop: arc up and over from the top loop-out port back to the top loop-in port,
    // forming a visible semicircle above the node (retry/refresh-icon shape).
    const height = 54;
    path = `M ${sourceX} ${sourceY} C ${sourceX - 10} ${sourceY - height}, ${targetX + 10} ${targetY - height}, ${targetX} ${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = Math.min(sourceY, targetY) - height - 6;
  } else {
    // Distinct nodes: a classic curved self-connecting arc (general "curved" shape option).
    const radiusX = Math.max(60, Math.abs(sourceX - targetX) * 0.6);
    const radiusY = 60;
    path = `M ${sourceX} ${sourceY} A ${radiusX} ${radiusY} 0 1 0 ${targetX} ${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = sourceY - radiusY;
  }

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className={`self-loop-edge-label${selected ? " selected" : ""}`}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              color: typeof style?.stroke === "string" ? style.stroke : undefined
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
