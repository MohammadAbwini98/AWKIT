import { Maximize2, Minus, Plus } from "lucide-react";
import { useCanvas, useViewport } from "./FlowCanvas";

export const ZOOM_MIN_PERCENT = 25;
export const ZOOM_MAX_PERCENT = 200;
const ZOOM_STEP = 10;

interface CanvasZoomControlProps {
  /** Called with the new zoom percentage whenever it changes via the control. */
  onPersist?: (percent: number) => void;
}

/**
 * Bottom-center glass zoom toolbar bound to the custom canvas viewport. Shows the
 * live zoom percentage with zoom in/out, reset-to-100%, and fit controls —
 * matching the Workflow reference (no minimap / RF controls).
 */
export function CanvasZoomControl({ onPersist }: CanvasZoomControlProps) {
  const { zoomTo, fitView } = useCanvas();
  const { zoom } = useViewport();
  const percent = Math.round(zoom * 100);

  const applyPercent = (next: number) => {
    const clamped = Math.min(ZOOM_MAX_PERCENT, Math.max(ZOOM_MIN_PERCENT, Math.round(next)));
    zoomTo(clamped / 100, { duration: 150 });
    onPersist?.(clamped);
  };

  return (
    <div className="canvas-zoom-control nopan" style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 5 }}>
      <button type="button" className="canvas-zoom-button" title="Zoom out" aria-label="Zoom out" onClick={() => applyPercent(percent - ZOOM_STEP)}>
        <Minus size={14} />
      </button>
      <button type="button" className="canvas-zoom-button zoom-value" title="Reset to 100%" onClick={() => applyPercent(100)}>
        {percent}%
      </button>
      <button type="button" className="canvas-zoom-button" title="Zoom in" aria-label="Zoom in" onClick={() => applyPercent(percent + ZOOM_STEP)}>
        <Plus size={14} />
      </button>
      <span className="canvas-zoom-divider" aria-hidden="true" />
      <button type="button" className="canvas-zoom-button" title="Fit to screen" aria-label="Fit to screen" onClick={() => fitView({ duration: 150, padding: 0.2 })}>
        <Maximize2 size={14} />
      </button>
    </div>
  );
}
