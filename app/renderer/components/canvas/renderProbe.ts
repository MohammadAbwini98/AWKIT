/**
 * Opt-in render probe for canvas performance regression tests.
 *
 * Zero cost in normal use: `bumpRenderProbe` returns immediately unless a test has
 * enabled the probe by assigning `window.__awkitRenderProbe = { node: 0, edge: 0, card: 0 }`.
 * It never logs. `scripts/verify-canvas-perf.mjs` uses it to assert that viewport-only
 * interactions (pan / zoom) and unrelated page re-renders (typing) do NOT re-render the
 * memoized node/edge subtree — guarding the memoization/stable-callback work from regressing.
 */
export interface RenderProbeCounts {
  /** NodeContainer renders (one per node card wrapper). */
  node: number;
  /** EdgeLayer renders (the whole SVG connector layer). */
  edge: number;
  /** Node-card component renders (ActionFlowNode / ScenarioFlowNode / StepNode). */
  card: number;
}

declare global {
  interface Window {
    __awkitRenderProbe?: RenderProbeCounts;
  }
}

export function bumpRenderProbe(kind: keyof RenderProbeCounts): void {
  if (typeof window === "undefined") return;
  const probe = window.__awkitRenderProbe;
  if (probe) probe[kind] += 1;
}
