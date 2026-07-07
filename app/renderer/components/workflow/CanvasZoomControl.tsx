import { Maximize2, Minus, Plus } from "lucide-react";
import { Panel, useReactFlow, useViewport } from "@xyflow/react";

export const ZOOM_MIN_PERCENT = 25;
export const ZOOM_MAX_PERCENT = 200;
const ZOOM_STEP = 10;

interface CanvasZoomControlProps {
  /** Called with the new zoom percentage whenever it changes via the control. */
  onPersist?: (percent: number) => void;
}

/**
 * Zoom toolbar bound to the real React Flow viewport. Shows the live zoom
 * percentage and provides zoom in/out, reset-to-100%, and fit controls.
 */
export function CanvasZoomControl({ onPersist }: CanvasZoomControlProps) {
  const { zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const percent = Math.round(zoom * 100);

  const applyPercent = (next: number) => {
    const clamped = Math.min(ZOOM_MAX_PERCENT, Math.max(ZOOM_MIN_PERCENT, Math.round(next)));
    void zoomTo(clamped / 100, { duration: 150 });
    onPersist?.(clamped);
  };

  return (
    <Panel position="bottom-center" className="canvas-zoom-control">
      <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => applyPercent(percent - ZOOM_STEP)}>
        <Minus size={14} />
      </button>
      <button type="button" className="zoom-value" title="Reset to 100%" onClick={() => applyPercent(100)}>
        {percent}%
      </button>
      <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => applyPercent(percent + ZOOM_STEP)}>
        <Plus size={14} />
      </button>
      <button type="button" title="Fit to screen" aria-label="Fit to screen" onClick={() => void fitView({ duration: 150 })}>
        <Maximize2 size={14} />
      </button>
    </Panel>
  );
}
