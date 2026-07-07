# 07 — Motion & Animation System Plan

**Approach:** CSS-first (no animation lib installed; don't add one). Reuse existing motion tokens
(`--awkit-ease-out`, `--awkit-dur-fast/med/slow`). Everything degrades under reduced-motion.

## Principles
Purposeful, quick, consistent. Motion signals state/hierarchy, never decoration for its own sake.
Prefer `transform`/`opacity` (GPU-friendly); avoid animating layout/`box-shadow` on large lists.

## Scales
- **Duration:** fast 120ms (hover/press), med 220ms (entrance/panels), slow 360ms (page/drawer).
- **Easing:** `--awkit-ease-out` for most; linear only for looping (connector dash, shimmer, spinner).

## Catalog
| Motion | Where | Technique |
|--------|-------|-----------|
| Page transition | route change (non-canvas) | keep existing keyed fade/rise on `.main-surface-animated` |
| Panel transition | drawers/collapsibles | height/opacity or translateX 220ms |
| Card entrance | dashboard/report cards | fade+rise, small stagger via `animation-delay` |
| Hover | cards/nodes/rows/buttons | `translateY(-1..3px)` + shadow, 120ms |
| Press | buttons | `scale(.98)` active |
| Active nav | sidebar | gradient rail + color transition |
| Metric count-up | KPI values | small JS `requestAnimationFrame` counter (respect reduced-motion → set final) |
| Chart draw-in | report charts | stroke-dashoffset draw / opacity; library-native if used |
| Live pulse | running/live badges, status dot | keyframe `pulse` (box-shadow ring) |
| Connector flow | running edges | `stroke-dasharray` + animated `stroke-dashoffset` |
| Node status | running/success/error | outline pulse / border+icon color transition |
| Drawer/modal | overlays | scrim fade + panel scale/slide 220–360ms |
| Skeleton | loading | shimmer gradient sweep 1.4s linear |

## Reduced-motion fallback
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration:.001ms !important; animation-iteration-count:1 !important;
    transition-duration:.001ms !important; scroll-behavior:auto !important;
  }
}
```
Plus JS guards: count-up and any rAF loops check `matchMedia('(prefers-reduced-motion: reduce)')` and jump to final state; connector flow class not applied.

## Performance safeguards
- Cap simultaneously-animating nodes/edges (only animate running ones).
- Use `will-change` sparingly (hovered/selected only), remove after.
- No infinite animations on off-screen/virtualized rows.
- Verify canvas stays ≥ ~50fps with a busy graph; if not, disable edge flow beyond N running edges.
