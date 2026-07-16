# 003 — Make trigger-anchored menus scale from their trigger, not center

- **Status**: TODO
- **Commit**: 7c4b260
- **Severity**: MEDIUM
- **Category**: Physicality / Origin
- **Estimated scope**: 2 components (`NodeOptionsMenu.tsx`, `CanvasItemPicker.tsx`) + 1 optional variant (`lib/motion.ts`)

## Problem

Two trigger-anchored Framer Motion surfaces animate a `scale`/`y` entrance but never set a
`transform-origin`, so Framer Motion uses its default (**center, 50% 50%**). A menu opened from a kebab
button, or a picker opened at a canvas point, should visually *grow out of* the point it was summoned
from — not bloom from its own middle.

```tsx
/* app/renderer/components/shared/NodeOptionsMenu.tsx:71-83 — current */
<motion.div
  ref={ref}
  role="menu"
  className="node-options-menu"
  style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}   /* no transformOrigin */
  initial={reducedMotion ? false : { opacity: 0, y: -6, scale: 0.97 }}
  animate={{ opacity: 1, y: 0, scale: 1 }}
  exit={reducedMotion ? undefined : { opacity: 0, y: -4, scale: 0.98 }}
  transition={reducedMotion ? { duration: 0 } : menuSpring}
```

The menu is positioned below the anchor by default and **flips above** when it would overflow
(`NodeOptionsMenu.tsx:44-48`), so the correct origin is the **top** edge when placed below and the
**bottom** edge when flipped above.

```tsx
/* app/renderer/components/shared/CanvasItemPicker.tsx:77-86 — current */
<motion.div
  ref={panelRef}
  className="canvas-item-picker"
  style={{ left: x, top: y }}                                  /* no transformOrigin */
  initial={reducedMotion ? false : { opacity: 0, y: -8, scale: 0.97 }}
  animate={{ opacity: 1, y: 0, scale: 1 }}
  ...
```

The picker opens at a canvas `(x, y)` (a "+"/click point), so it should scale from its **top-left**.

(There is also an unused `popIn` variant in `app/renderer/lib/motion.ts:95-99` with the same missing
origin — fix it too so future consumers inherit the correct behavior.)

## Target

Set `transformOrigin` on the animated element to the trigger edge. Physicality values are already
correct (`scale: 0.97`, not `scale(0)`; opacity paired) — **only the origin changes.**

```tsx
/* target — NodeOptionsMenu.tsx: compute a flip flag, then set origin */
// in the useLayoutEffect that positions the menu, remember whether it flipped above:
const flippedAbove = top < rect.bottom;              // true when placed above the anchor
setPos({ left, top, origin: flippedAbove ? "bottom" : "top" });
// ...
<motion.div
  style={{ left: pos.left, top: pos.top, width: MENU_WIDTH, transformOrigin: `center ${pos.origin}` }}
  initial={reducedMotion ? false : { opacity: 0, y: pos.origin === "top" ? -6 : 6, scale: 0.97 }}
  animate={{ opacity: 1, y: 0, scale: 1 }}
  exit={reducedMotion ? undefined : { opacity: 0, y: pos.origin === "top" ? -4 : 4, scale: 0.98 }}
  transition={reducedMotion ? { duration: 0 } : menuSpring}
>
```

```tsx
/* target — CanvasItemPicker.tsx:80 */
style={{ left: x, top: y, transformOrigin: "top left" }}
```

```ts
/* target — lib/motion.ts:95-99 (optional; unused today, fix for future use) */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: easeFast },
  exit: { opacity: 0, scale: 0.96, y: 4, transition: instant }
};
// NOTE: consumers of popIn MUST set style={{ transformOrigin: <trigger edge> }} on the motion element,
// because a variant cannot carry transform-origin. Document this in the JSDoc above popIn.
```

## Repo conventions to follow

- Framer Motion is the JS motion layer; springs/variants live in `app/renderer/lib/motion.ts`
  (`menuSpring` = `{ type: "spring", stiffness: 420, damping: 32 }`). Keep using `menuSpring` — do not
  swap it for a CSS transition.
- Reduced motion is gated with `usePrefersReducedMotion()` from `lib/motion.ts` and an
  `initial={reducedMotion ? false : …}` pattern — **preserve it exactly**; `transformOrigin` is a static
  style and is safe to leave set under reduced motion (nothing scales, so origin is inert).
- Both components already compute their placement in a `useLayoutEffect`/props (`NodeOptionsMenu.tsx:37-49`,
  `CanvasItemPicker` via `x`/`y` props) — derive the origin there, next to the placement math.

## Steps

1. `NodeOptionsMenu.tsx:35` — extend the `pos` state type to `{ left: number; top: number; origin: "top" | "bottom" }`.
2. `NodeOptionsMenu.tsx:44-48` — when computing `top`, set `origin` to `"bottom"` in the flip-above branch
   (`top = ... rect.top - estHeight - 6`) and `"top"` in the default below branch; include it in `setPos`.
3. `NodeOptionsMenu.tsx:76` — add `transformOrigin: \`center ${pos.origin}\`` to the `style` object.
4. `NodeOptionsMenu.tsx:77,79` — make the `y` offsets direction-aware (negative when origin `top`,
   positive when origin `bottom`) so the slide and the origin agree (see target excerpt).
5. `CanvasItemPicker.tsx:80` — add `transformOrigin: "top left"` to the `style` object.
6. `lib/motion.ts:94` — update the `popIn` JSDoc to state that consumers must set `transformOrigin` to
   the trigger edge (no value change to the variant needed).

## Boundaries

- Do NOT change `menuSpring`, the reduced-motion gating, the portal target, the positioning math (other
  than adding the `origin` derivation), or any markup/structure.
- Do NOT convert these to CSS animations — they are gesture-adjacent, spring-driven surfaces.
- Do NOT add a new dependency.
- Only these three files. If `NodeOptionsMenu`'s positioning code no longer matches the excerpt (drift
  since `7c4b260`), STOP and report.

## Verification

- **Mechanical**:
  - `rg -n "transformOrigin" app/renderer/components/shared/NodeOptionsMenu.tsx app/renderer/components/shared/CanvasItemPicker.tsx`
    → one match each.
  - `npm run build` → passes.
  - `npm run verify:flow-designer` and `npm run verify:workflow-builder` → pass (these open canvas
    surfaces that host the menu/picker; confirm no console errors).
- **Feel check**: run the app, open the **Flow Designer**:
  - Click a node's kebab ("…") near the **bottom** of the viewport so the menu flips **above** the button;
    it must scale out of its **bottom** edge (toward the button), not its center.
  - Click a kebab near the top so the menu opens **below**; it must scale out of its **top** edge.
  - Open the **add-to-canvas picker** ("+"): it must grow from its **top-left** corner (the click point),
    not bloom from the middle.
  - DevTools → Animations at **10%** playback: watch the origin — the corner/edge nearest the trigger
    stays put while the opposite corner expands.
  - Toggle prefers-reduced-motion: the menu/picker appears with no scale (origin is inert). Good.
- **Done when**: both surfaces scale from the edge/corner nearest their trigger in slow motion, reduced
  motion still suppresses the scale, and `npm run build` + the two GUI verifiers pass.
