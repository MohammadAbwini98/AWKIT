import { useViewport } from "./FlowCanvas";
import { DotField } from "../../layout/AppBackground";

/**
 * Canvas background: the app's emitted-light dot field, anchored to the canvas viewport so the
 * grid pans and scales with the nodes. Sits under the transform layer and never takes pointer input.
 */
export function Background() {
  const { x, y, zoom } = useViewport();
  return <DotField className="awkit-flow-background" view={{ x, y, k: zoom }} />;
}
