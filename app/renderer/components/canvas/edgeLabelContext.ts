import { createContext } from "react";

/**
 * Portal target for edge labels/affordances. The overlay div lives inside the
 * canvas transform layer (so flow-coordinate transforms position labels
 * correctly), and `EdgeLabelRenderer` portals its children into it — the same
 * pattern React Flow used, letting edge components emit an SVG path and HTML
 * labels together.
 */
export const EdgeLabelContext = createContext<HTMLElement | null>(null);
