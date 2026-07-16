# 004 — Gate hover motion behind pointer capability

- **Status**: TODO
- **Commit**: 7c4b260
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file (`app/renderer/styles/global.css`), ~15–20 hover rules

## Problem

There are **78 `:hover` rules** in `global.css` and **zero** `@media (hover: hover)` guards. Every
hover **motion** (card lift, content swap, hover-revealed tooltip) fires on a **tap** on a touchscreen
Windows device, because touch synthesizes a `:hover` on tap and it sticks until the next tap elsewhere.
AWKIT lists touch as a supported input (`docs/ui-design-and-motion-direction.md` › personality), so
hover-triggered movement is a real accessibility defect there.

Representative offenders (transform-bearing hover):

```css
/* app/renderer/styles/global.css:4622 — card lift */
.workflow-card:hover,
.workflow-card:focus-within {
  border-color: var(--awkit-accent-muted);
  box-shadow: 0 10px 26px rgba(var(--awkit-shadow-rgb), 0.12);
  transform: translateY(-2px);
}
/* app/renderer/styles/global.css:4773 / 4780 — hover-driven content swap */
.workflow-card:hover .workflow-card-summary,
.workflow-card:focus-within .workflow-card-summary { opacity: 0; transform: translateY(-8px); }
.workflow-card:hover .workflow-card-params,
.workflow-card:focus-within .workflow-card-params { opacity: 1; transform: translateY(0); }
/* app/renderer/styles/global.css:5836 — hover-revealed tooltip */
.report-node-error-hint:hover .report-node-tooltip,
.report-node:focus-within .report-node-tooltip { opacity: 1; pointer-events: auto; transform: translateY(0); }
/* app/renderer/styles/global.css:7690 — node hover */
.action-flow-node:hover:not(.selected) { /* … transform … */ }
```

## Target

Wrap the **movement** part of each transform-bearing hover rule in
`@media (hover: hover) and (pointer: fine)`. Keep the `:focus-within` / `:focus-visible` motion
**ungated** (keyboard focus must still show the affordance on any device). Non-motion hover effects
(color, background, border, box-shadow) may stay ungated — they're harmless on tap.

```css
/* target — split workflow-card (4622): keep color/shadow for all pointers, gate the lift, keep focus */
.workflow-card:hover,
.workflow-card:focus-within {
  border-color: var(--awkit-accent-muted);
  box-shadow: 0 10px 26px rgba(var(--awkit-shadow-rgb), 0.12);
}
.workflow-card:focus-within {          /* keyboard focus keeps the lift on any device */
  transform: translateY(-2px);
}
@media (hover: hover) and (pointer: fine) {
  .workflow-card:hover {               /* pointer hover gets the lift only on real pointers */
    transform: translateY(-2px);
  }
}
```

The same three-part split applies to the content-swap and tooltip-reveal rules: the `:hover` variant of
the transform goes inside the media query; the `:focus-within` variant stays outside.

## Repo conventions to follow

- `docs/ai/RULES.md` › Accessibility already requires touch-safe hover behavior conceptually; this makes
  it real. Keep the existing `:focus-visible` global ring untouched (`RULES.md` forbids `outline:none`
  without it).
- Media queries in this file are written inline near their rules (e.g. the reduced-motion block at
  `global.css:8445`, `@media (prefers-reduced-motion)` at `7200`, `9062`). Place each new
  `@media (hover: hover) and (pointer: fine)` block immediately **after** the rule it guards.
- Framer Motion `whileHover` presets (`hoverTap`, `hoverLift` in `lib/motion.ts:123-131`) are **not used**
  anywhere today (verified: no `.tsx` imports them), so **no JS change is needed** in this plan. Do not
  add them.

## Steps

1. Enumerate the targets: `rg -n ":hover" app/renderer/styles/global.css` then filter to blocks whose body
   contains `transform` (translate/scale/rotate). Expect ~15–20 rules.
2. For each transform-bearing hover block:
   - If the selector list mixes `:hover` with `:focus-within`/`:focus-visible`: split into (a) the shared
     non-transform declarations for the full selector list, (b) the transform for the **focus** selector
     (ungated), (c) an `@media (hover: hover) and (pointer: fine)` block with the transform for the
     **:hover** selector.
   - If the block is `:hover`-only (no focus selector): move the whole block into the media query.
3. Leave hover rules that set only color/background/border/box-shadow/opacity **unchanged**.
4. Special case the hover-**revealed tooltip** at `5836`: its reveal is information (an error hint), so it
   must also be reachable without hover — confirm the paired `:focus-within` selector remains ungated so
   keyboard/touch focus still reveals it. (It already pairs with `.report-node:focus-within` — keep that
   outside the media query.)

## Boundaries

- Do NOT touch any file except `app/renderer/styles/global.css`.
- Do NOT gate `:focus-within` / `:focus-visible` motion — keyboard affordances must work on all devices.
- Do NOT gate non-motion hover feedback (color/border/shadow/background) — only `transform` movement.
- Do NOT change the transform **values**, durations, or easings — only wrap them in the media query.
- Do NOT remove any hover affordance entirely; this plan relocates motion, it does not delete it.
- If the count of transform-bearing hover rules is wildly different from ~15–20 (drift since `7c4b260`),
  STOP and report before mass-editing.

## Verification

- **Mechanical**:
  - `rg -n "@media \(hover: hover\) and \(pointer: fine\)" app/renderer/styles/global.css` → ~15–20 blocks.
  - `rg -n ":hover[^{]*\{[^}]*transform" -U app/renderer/styles/global.css` → every remaining match is
    **inside** a hover/pointer media query (spot-check a few).
  - `npm run build` → passes.
  - `npm run verify:workflow-builder` and `npm run verify:reports` → pass (hover surfaces render; no
    console errors).
- **Feel check**:
  - Desktop (mouse/trackpad = `pointer: fine` + `hover: hover`): hover a workflow card — it still lifts;
    tab to it with the keyboard — it still lifts. No regression.
  - Emulate touch: DevTools → Device Toolbar (or Rendering → "Emulate: touch") and **tap** a workflow
    card. It must **not** stick in the lifted/param-swapped state after the tap.
  - The error-hint tooltip (`5836`) still appears on keyboard focus of the node (not hover-only).
- **Done when**: every hover rule that moves an element is gated behind `@media (hover: hover) and
  (pointer: fine)`, focus-driven motion is unaffected, tapping on emulated touch leaves nothing stuck,
  and `npm run build` + the two GUI verifiers pass.
