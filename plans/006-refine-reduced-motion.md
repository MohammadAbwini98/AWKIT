# 006 — Refine reduced-motion so comprehension fades survive

- **Status**: TODO
- **Commit**: 7c4b260
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file (`app/renderer/styles/global.css`), 1 rule change (+ optional spinner exemption)

## Problem

The global reduced-motion neutralizer zeroes **every** transition and animation duration, including
opacity/color fades that *aid comprehension* (a status turning red, a validation message fading in, a
skeleton→content crossfade). Both reference skills are explicit: reduced motion means **fewer and gentler**
motion — keep transitions that aid understanding, remove only **movement**.

```css
/* app/renderer/styles/global.css:8445-8454 — current */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;   /* nukes opacity/color fades too */
    scroll-behavior: auto !important;
  }
}
```

`transition-duration: 0.001ms !important` makes *all* transitions instant — so a reduced-motion user
loses the gentle color/opacity feedback that carries meaning, not just the movement they asked to avoid.

## Target

Keep the neutralizer as the safety net, but instead of zeroing transition **duration**, restrict the
transition **property** allow-list to non-movement properties. Movement props (`transform`, `left`,
`top`, `width`, `height`, `margin`, `inset`) then **snap** (no animation), while `opacity` and color
properties still transition — exactly AUDIT §6's "keep opacity/color, drop movement."

```css
/* target — app/renderer/styles/global.css:8445-8454 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    /* Movement snaps; opacity/color/shadow fades that aid comprehension are preserved. */
    transition-property: opacity, color, background-color, border-color, box-shadow, fill, stroke !important;
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
}
```

Optional (flag for feel-check, not mandatory): a loading **spinner** rotating is arguably feedback, not
decorative movement. If, in the feel check below, the frozen spinner reads as "stuck," add a narrow
exemption so spinners keep rotating under reduced motion:

```css
/* optional target — add AFTER the block above */
@media (prefers-reduced-motion: reduce) {
  .awkit-spinner,
  .spin,
  .session-spin {
    animation-duration: 900ms !important;   /* keep the rotate; it signals "busy", not decoration */
  }
}
```

## Repo conventions to follow

- `docs/ai/RULES.md` › UI mandates "keep motion behind the last-in-cascade `prefers-reduced-motion`
  neutralizer." This plan keeps that neutralizer; it only makes it gentler, not weaker.
- The per-component reduced-motion blocks (`global.css:7200`, `9062`) already do targeted
  `transition: none` — they remain valid and stack with this global rule; do not remove them.
- JS motion already branches on `usePrefersReducedMotion()` (`lib/motion.ts`, used in `NodeOptionsMenu`,
  `CanvasItemPicker`, `ActionFlowNode`) — this CSS change does not affect that path.

## Steps

1. `global.css:8449` — remove `transition-duration: 0.001ms !important;`.
2. `global.css` (same block) — add `transition-property: opacity, color, background-color, border-color,
   box-shadow, fill, stroke !important;` as the first declaration in the block.
3. Keep `animation-duration`, `animation-iteration-count`, and `scroll-behavior` lines unchanged.
4. Do the feel check. **If** any spinner reads as frozen/stuck, add the optional spinner-exemption block
   above; otherwise leave it out.

## Boundaries

- Do NOT touch any file except `app/renderer/styles/global.css`.
- Do NOT remove the neutralizer or the per-component reduced-motion blocks.
- Do NOT add movement back anywhere — this plan only decides *which* transitions survive under reduced
  motion; it never introduces new motion.
- Do NOT widen the allow-list to include `transform`, `left`, `top`, `width`, `height`, or `inset` — those
  are the movements reduced-motion users are opting out of.
- If the block at `8445` differs from the excerpt (drift since `7c4b260`), STOP and report.

## Verification

- **Mechanical**:
  - `rg -n "transition-property: opacity" app/renderer/styles/global.css` → one match, inside the
    `prefers-reduced-motion` block.
  - `rg -n "transition-duration: 0.001ms" app/renderer/styles/global.css` → no match.
  - `npm run build` → passes.
- **Feel check** (this is the important part — the effect is only visible with reduced motion on):
  - DevTools → Rendering → enable **"Emulate CSS prefers-reduced-motion"**.
  - Trigger a **status/validation** change (e.g. save a form with an invalid field, or watch a run change
    state in the Instance Monitor): the color/opacity should still **fade** in (comprehension preserved),
    while any slide/position movement **snaps** instantly.
  - Open a **modal/drawer**: it appears without sliding/scaling (movement dropped) but may still fade
    (opacity allowed).
  - Watch a **spinner** during a load: decide whether the static ring reads as "busy" or "stuck." Apply
    the optional exemption only if it reads as stuck.
  - Disable the emulation and confirm normal motion is fully restored.
- **Done when**: with reduced motion emulated, opacity/color feedback still animates while all movement
  snaps, `npm run build` is clean, and the spinner decision is made via the feel check.
