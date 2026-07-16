/**
 * Shared framer-motion primitives — the single source of truth for motion across the
 * renderer, mirroring the Workflow/FlowForge reference (see docs/plan-workflow-visual-parity.md).
 *
 * Rules of the road:
 *  - Import variants/transitions from here instead of hand-writing spring numbers in components.
 *  - Durations/easings intentionally match the `--awkit-dur-*` / `--awkit-ease-out` tokens in
 *    styles/global.css so CSS transitions and framer-motion animations feel identical.
 *  - Respect reduced-motion: gate entrance/movement with `usePrefersReducedMotion()` (or
 *    framer-motion's own `useReducedMotion`) and fall back to `instant`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion, type Transition, type Variants } from "framer-motion";

/** Signature spring for node mount / layout settling (matches ServiceNode in the reference). */
export const nodeSpring: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 30
};

/** Reference picker/context-menu spring. */
export const menuSpring: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 32
};

/** Reference 400px configuration-drawer spring. */
export const drawerSpring: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30
};

/** Reference floating-toolbar spring. */
export const toolbarSpring: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 26
};

/** Snappy spring for interactive chrome (buttons, toggles, small controls). */
export const controlSpring: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 32
};

/** Token-aligned eased tween. `--awkit-motion-base` = 180ms, `--awkit-motion-ease`. */
export const easeBase: Transition = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1]
};

/** Fast eased tween — `--awkit-motion-fast` = 120ms. */
export const easeFast: Transition = {
  duration: 0.12,
  ease: [0.22, 1, 0.36, 1]
};

/** Slow eased tween — `--awkit-motion-slow` = 260ms (drawers, panels, page transitions). */
export const easeSlow: Transition = {
  duration: 0.26,
  ease: [0.22, 1, 0.36, 1]
};

/** Collapse animation to a no-op — spread into a transition when reduced motion is requested. */
export const instant: Transition = { duration: 0 };

/* ------------------------------------------------------------------ *
 * Variants
 * ------------------------------------------------------------------ */

/** Node card entrance: fade + subtle scale, settled with `nodeSpring`. */
export const nodeEnter: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: nodeSpring }
};

/* ------------------------------------------------------------------ *
 * Reduced-motion helpers
 * ------------------------------------------------------------------ */

/** Re-export so components have one import site for motion concerns. */
export { useReducedMotion as usePrefersReducedMotion };

/** Pick between a full transition and an instant one based on the reduced-motion preference. */
export function motionSafe<T extends Transition>(reduced: boolean | null, transition: T): Transition {
  return reduced ? instant : transition;
}

/* ------------------------------------------------------------------ *
 * Canvas auto-layout glide
 * ------------------------------------------------------------------ */

/**
 * Drives the `.flow-animating` class used by the in-house canvas glide (see the
 * `.awkit-flow-canvas.flow-animating .awkit-flow-node` rule in styles/global.css). Call `arm()` in the same
 * tick you apply a programmatic layout change (auto-arrange / load); nodes and edges then
 * transition to their new positions for `durationMs` before snapping behavior returns.
 *
 * Usage:
 *   const { animating, arm } = useFlowGlide();
 *   // in the layout handler: arm(); setNodes(withAutoLayout(...));
 *   <ReactFlow className={animating ? "flow-animating" : undefined} ... />
 *
 * The CSS transition itself collapses to a no-op under `prefers-reduced-motion`, so no extra
 * guard is needed here.
 */
/**
 * Above this node count the auto-arrange/load "glide" (which animates every node's `left`/`top`)
 * is skipped — nodes snap to their new positions instead — to avoid layout thrash on large graphs.
 */
export const GLIDE_MAX_NODES = 120;

export function useFlowGlide(durationMs = 350): { animating: boolean; arm: () => void } {
  const [animating, setAnimating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    setAnimating(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnimating(false), durationMs);
  }, [durationMs]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { animating, arm };
}
