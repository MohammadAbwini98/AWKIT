# AWKIT Animation Improvement Plans

Prioritized, self-contained motion/animation plans produced by the `improve-animations` skill (deep
mode) from an audit of the AWKIT renderer reconciled with Emil Kowalski's design-engineering philosophy
and Apple's fluid-interface principles. Companion to `docs/ui-design-and-motion-direction.md`.

- **Audited at commit**: `7c4b260`
- **Stack**: React + TypeScript (Electron renderer); plain CSS (`app/renderer/styles/global.css`,
  `--awkit-*` "Hologram" tokens, full light/dark parity); **Framer Motion 11.18.2** (`app/renderer/lib/motion.ts`
  is the JS motion source of truth); in-house canvas engine (`app/renderer/components/canvas/`), not React Flow.
- **Rule**: each plan changes **application source**; nothing here has been applied. Plans are written for
  an executor with zero prior context — every value (curve, duration, file:line, excerpt) is inlined.

## Plans

| # | Title | Severity | Category | Depends on | Status |
|---|---|---|---|---|---|
| [001](001-fix-drawer-keyframe-collision.md) | Fix the triple `awkit-drawer-in` keyframe collision | **HIGH** | Cohesion / Interruptibility | — | **DONE** ✅ (Approve) |
| [002](002-consolidate-motion-tokens.md) | Consolidate motion tokens + add `ease-in-out`/`ease-drawer` | MEDIUM | Cohesion / Tokens | — | **DONE** ✅ (Approve) |
| [003](003-fix-popover-origins.md) | Make trigger-anchored menus scale from their trigger | MEDIUM | Physicality / Origin | — | **DONE** ✅ (Approve) |
| [004](004-gate-hover-pointer-capability.md) | Gate hover motion behind pointer capability | MEDIUM | Accessibility | — | **DONE** ✅ (Approve) |
| [005](005-canvas-transform-positioning.md) | Position/glide canvas nodes with `transform`, not `left`/`top` | **HIGH** | Performance | 002 (soft) | **DONE** ✅ (Approve) |
| [006](006-refine-reduced-motion.md) | Refine reduced-motion so comprehension fades survive | MEDIUM | Accessibility | — | **DONE** ✅ (Approve) |
| [007](007-reduce-frequent-entrance-motion.md) | Stop replaying entrance motion on frequent navigation | MEDIUM | Purpose / Frequency | — | **DONE** ✅ (Approve) |

## Recommended execution order

The plans are largely independent, so they can be tackled in parallel — but this order minimizes rework
and puts the riskiest change last:

1. **002 — Consolidate motion tokens.** Foundation: adds `--awkit-ease-in-out` and `--awkit-ease-drawer`
   and collapses the duplicate token families. 005 (and, if desired, 001) reference the new curves, so do
   this first. Low risk (token/alias hygiene).
2. **001 — Fix drawer keyframe collision.** Highest severity, smallest change, pure correctness — every
   drawer currently plays the wrong motion. Independent of 002 (keeps existing tokens), but pairs naturally.
3. **003 — Popover/menu origins.** Isolated to two components; the most visible "polish" win per effort.
4. **006 — Refine reduced-motion.** Isolated one-rule accessibility correctness change.
5. **004 — Gate hover behind pointer capability.** Mechanical but touches ~15–20 hover rules; do it as a
   focused pass.
6. **007 — Reduce frequent entrance motion.** Isolated "delete the replay" change on grid/route entrances.
7. **005 — Canvas `transform` positioning.** Highest performance impact but the largest/riskiest edit
   (touches the canvas engine). Do it last, after 002, and gate on the full canvas verifier suite
   (`verify:canvas-perf`, `verify:flow-designer`, `verify:workflow-builder`).

### Dependency notes
- **005 depends on 002** (soft): it uses `--awkit-dur-slow` and `--awkit-ease-in-out`. Each plan lists a
  literal-value fallback if run out of order.
- All other plans are independent and touch disjoint code (001 → drawer keyframes; 003 → two menu
  components; 004 → hover rules; 006 → the reduced-motion block; 007 → page-enter/card-rise). They can be
  parallelized safely.

## Verification commands referenced by the plans

- `npm run build` — tsc `--noEmit` + bundles (the project's typecheck gate; there is no lint/test script).
- `npm run verify:canvas-perf` — canvas render/perf guard (required green for 005).
- `npm run verify:flow-designer`, `npm run verify:workflow-builder` — real-Electron GUI walkthroughs of
  the canvas surfaces (001, 003, 005).
- `npm run verify:reports` — real-Electron report pages that use `.page-grid` (007) and hover cards (004).
- Feel checks use DevTools: **Animations** panel (10% playback for easing/origin), **Performance** panel
  (Layout vs Composite for 005), and **Rendering** panel (emulate `prefers-reduced-motion` for 006/007
  and touch for 004).

## Deferred / out of scope for these plans

- **LOW-severity dead code** beyond what 005 removes: 005 removed the dead React-Flow *glide* rules and the
  `--xy-*` theme vars, but the broader dead React-Flow *theming* CSS remains (`.react-flow__pane`,
  `.react-flow__controls`, `.react-flow__minimap`, `.react-flow__edge*`, `.react-flow__panel`,
  `.react-flow__resize-control`, etc. — no `.tsx` renders these classes). Also several unused
  `app/renderer/lib/motion.ts` exports (`popIn`, `pageEnter`, `drawerRight`, `listContainer`, `listItem`,
  `hoverTap`, `hoverLift`, `fadeIn`), and the duplicate spinner keyframes (`report-spin` vs
  `awkit-spinner-rotate`). Fold into a future cleanup pass; not high-leverage on their own.
- **Non-motion foundation gaps** (colliding spacing/radius scales, missing type scale) are covered by
  `docs/ui-design-and-motion-direction.md`, not these motion plans.

## Missed opportunities (additive — not corrective)

1. **Node deletion teleports.** ✅ **DONE** (2026-07-14). Deleted nodes now linger ~150ms as a
   non-interactive fading/scaling "ghost" via manual exit-tracking in `FlowCanvas` (no `AnimatePresence`
   — keeps the memoized hot path; gated on the `nodes` reference so pan/zoom/typing never re-render the
   node subtree). Scale/opacity are a keyframe on the node's child so the outer `translate3d` positioning
   is untouched. `verify:canvas-perf` memoization assertions still green.
2. **Properties-panel open has no spatial glide.** ~partial~ The `grid`/width glide is **implemented**
   (canvas `padding-right` + drawer `width` transition at `--awkit-dur-panel`/`--awkit-ease-in-out`,
   §9.1). The coordinated **`panBy`** shift is **deferred** — it needs the `FlowCanvas` imperative ref
   threaded through `DesignerCanvasLayout` (opaque `children`) into each designer page; higher effort,
   marginal benefit now that the floating drawer + padding already reserves canvas space.
3. **Toast has no exit.** ✅ **DONE** (2026-07-14). `Toast` now owns an enter→shown→leave state machine so
   it fades out along the same bottom edge (CSS transitions, not a keyframe, so rapid re-toasts retarget).
4. **Empty / first-run states spend none of their delight budget** — ✅ **DONE** (2026-07-14). The shared
   `EmptyState` (`.awkit-empty-state`) now plays a first-mount staggered rise (icon→headline→hint→CTA,
   45ms/step), fully removed under reduced motion.

## Non-motion foundation (docs/ui-design-and-motion-direction.md)

- **Type scale** — spine added (`--text-*`/`--leading-*`/`--tracking-*`). **199 exact-match `font-size`
  literals migrated onto `--text-*`** (2026-07-14, zero visual change — same px, single-sourced); 28
  off-scale one-offs (10/15/20/26px) left as-is. Applying the matching `--leading-*`/`--tracking-*` per
  section (a real visual change) is the remaining follow-on.
- **Spacing / radius** — consolidated to one spine with back-compat aliases (see `global.css` token block).
