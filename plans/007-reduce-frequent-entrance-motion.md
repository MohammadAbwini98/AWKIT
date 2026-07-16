# 007 — Stop replaying entrance motion on frequently-revisited pages

- **Status**: TODO
- **Commit**: 7c4b260
- **Severity**: MEDIUM
- **Category**: Purpose / Frequency
- **Estimated scope**: 1 file (`app/renderer/styles/global.css`); optionally 0 changes to `AppShell.tsx`

## Problem

Two entrance animations **replay on every navigation** — a tens-of-times-per-day interaction. Emil's
frequency rule is unambiguous: motion on frequently-seen elements should be **removed or drastically
reduced**. Re-watching a staggered card cascade on the 20th visit to the dashboard today is friction,
not delight.

```css
/* app/renderer/styles/global.css:6933-6946 — page-enter, applied to <main> on EVERY non-canvas route */
.awkit-page-enter,
.main-surface-animated {
  animation: awkit-page-enter var(--awkit-dur-med) var(--awkit-ease-out);
}
@keyframes awkit-page-enter {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

```css
/* app/renderer/styles/global.css:700-722 — staggered card-rise on EVERY .page-grid mount */
.page-grid > * {
  animation: awkit-card-rise var(--awkit-motion-slow) var(--awkit-ease-out) backwards;
}
.page-grid > *:nth-child(2) { animation-delay: 45ms; }
.page-grid > *:nth-child(3) { animation-delay: 90ms; }
.page-grid > *:nth-child(4) { animation-delay: 135ms; }
.page-grid > *:nth-child(5) { animation-delay: 180ms; }
.page-grid > *:nth-child(6) { animation-delay: 225ms; }
.page-grid > *:nth-child(n + 7) { animation-delay: 270ms; }
```

The shell keys the content by route (`app/renderer/layout/AppShell.tsx:48`,
`<main key={activeRouteId} className={animateContent ? "main-surface main-surface-animated" : ...}>`),
so both animations **re-trigger on each route change** (they are correctly *not* applied to canvas
routes — that exclusion, `AppShell.tsx:26,40`, is deliberate and must stay).

## Target

Delete the **movement** from these entrances and keep at most a brief opacity fade to avoid a harsh
content pop. This follows "prefer deleting motion" while preserving a soft transition.

**Page-enter → opacity-only, faster:**

```css
/* target — global.css:6933-6946 */
.awkit-page-enter,
.main-surface-animated {
  animation: awkit-page-enter var(--awkit-dur-fast) var(--awkit-ease-out);
}
@keyframes awkit-page-enter {
  from { opacity: 0; }      /* movement removed — no translateY */
  to   { opacity: 1; }
}
```

**Card-rise → remove the staggered rise entirely** (data cards should just be present; instant reads as
fast). Delete the `.page-grid > *` animation and all six `nth-child` delay rules:

```css
/* target — global.css:700-722 : DELETE the .page-grid > * animation and every nth-child delay.
   Keep the `@keyframes awkit-card-rise` definition only if another selector still uses it
   (check: `rg -n "awkit-card-rise" app/renderer` — if this is the only user, delete the keyframe too). */
```

> If the team prefers to keep a *first-load-only* cascade, that requires JS state (a "seen" flag) and is
> out of scope here — this plan intentionally chooses the simpler, higher-confidence "delete the replay."

## Repo conventions to follow

- `docs/ui-design-and-motion-direction.md` § 4 (interaction-frequency map) and § 14 ("do NOT animate":
  route content on frequent back-and-forth) call for exactly this reduction.
- Keep the canvas-route exclusion in `AppShell.tsx` (`CANVAS_ROUTES`, line 26) — canvas surfaces must not
  get a mount transform (it perturbs coordinate measurement). This plan does not touch that logic.
- Durations resolve through tokens (`--awkit-dur-fast` = 120ms). Do not hardcode.

## Steps

1. `global.css:6937-6946` — edit `@keyframes awkit-page-enter` to animate **opacity only** (remove both
   `transform: translateY(...)` lines).
2. `global.css:6933-6936` — change the duration token from `var(--awkit-dur-med)` to `var(--awkit-dur-fast)`.
3. `global.css:702-722` — delete the `.page-grid > *` animation rule and all six `.page-grid > *:nth-child`
   delay rules.
4. `rg -n "awkit-card-rise" app/renderer` — if no selector references it after step 3, delete the
   `@keyframes awkit-card-rise` block (`global.css:724-733`) too. If another selector uses it, leave the
   keyframe.
5. Leave `AppShell.tsx` unchanged (the `main-surface-animated` class still applies the now-opacity-only
   fade; no JSX edit needed).

## Boundaries

- Do NOT touch `AppShell.tsx` logic (the canvas-route exclusion and the keyed `<main>` stay as-is).
- Do NOT remove the opacity fade entirely unless the feel check says a hard cut is better — a light
  120ms opacity fade prevents a jarring content swap without any movement.
- Do NOT change `.page-grid` layout (grid columns/gaps) — only its child entrance animation.
- Do NOT add first-visit JS gating in this plan.
- If `.page-grid > *` or the page-enter keyframe differs from the excerpts (drift since `7c4b260`), STOP
  and report.

## Verification

- **Mechanical**:
  - `rg -n "translateY" app/renderer/styles/global.css` → the page-enter keyframe no longer appears among
    the matches.
  - `rg -n "page-grid > \*" app/renderer/styles/global.css` → no animation/nth-child-delay matches remain.
  - `npm run build` → passes.
  - `npm run verify:reports` → passes (report pages use `.page-grid`; confirm they still render, no
    console errors).
- **Feel check**: run the app:
  - Navigate **repeatedly** between Dashboard/Reports and another route. The content should appear with a
    quick, calm opacity settle — **no** upward drift, **no** staggered card cascade replaying each time.
    It should feel faster and quieter on the 2nd/3rd/10th visit.
  - Confirm **canvas** routes (Flow Designer, Workflow, Scenario, Form Designer) are unaffected (they were
    already excluded).
  - Toggle prefers-reduced-motion → the opacity fade is preserved-or-instant per plan 006; no movement.
- **Done when**: navigating to a grid page shows no positional/stagger entrance (at most a brief opacity
  fade), canvas routes are unchanged, and `npm run build` + `verify:reports` pass.
