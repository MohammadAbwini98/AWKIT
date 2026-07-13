import { useViewport } from "./FlowCanvas";

interface BackgroundProps {
  gap?: number;
  size?: number;
  color?: string;
}

/**
 * Dotted canvas background that pans and scales with the viewport, matching the
 * Workflow (flowforge) reference. Rendered as a CSS radial-gradient layer behind
 * the transform so it never intercepts pointer events.
 */
export function Background({ gap = 22, size = 2, color = "var(--awkit-canvas-dot, #c4c9d2)" }: BackgroundProps) {
  const { x, y, zoom } = useViewport();
  const scaledGap = gap * zoom;
  const dot = Math.max(1, size * zoom);
  return (
    <div
      className="awkit-flow-background"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        backgroundImage: `radial-gradient(${color} ${dot}px, transparent ${dot}px)`,
        backgroundSize: `${scaledGap}px ${scaledGap}px`,
        backgroundPosition: `${x}px ${y}px`
      }}
    />
  );
}
