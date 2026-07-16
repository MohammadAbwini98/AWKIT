# 002 — Consolidate motion tokens and add the missing easing curves

- **Status**: TODO
- **Commit**: 7c4b260
- **Severity**: MEDIUM
- **Category**: Cohesion / Tokens (+ Easing)
- **Estimated scope**: 1 file (`app/renderer/styles/global.css`), token block + ~5 call-site edits

## Problem

The motion token spine has **duplicate families** and **missing curves**, and several durations are
**hardcoded off-scale**.

```css
/* app/renderer/styles/global.css:151-158 — current (light :root) */
  --awkit-motion-fast: 120ms;
  --awkit-motion-base: 180ms;
  --awkit-motion-slow: 260ms;
  --awkit-motion-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --awkit-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --awkit-dur-fast: 120ms;
  --awkit-dur-med: 180ms;
  --awkit-dur-slow: 260ms;
```

- `--awkit-motion-fast/base/slow` are byte-identical duplicates of `--awkit-dur-fast/med/slow`.
- `--awkit-motion-ease` is a byte-identical duplicate of `--awkit-ease-out`.
- There is **only one curve**. Both reference skills require a distinct **ease-in-out** for
  moving/morphing elements (node glide, sidebar resize, reorder) and an **ease-drawer** curve for
  sheets. Today those movements borrow the ease-out curve.
- Hardcoded durations bypass the ladder and one exceeds the 300ms UI ceiling:

```css
/* app/renderer/styles/global.css:8170, 8174 — 350ms, and animates layout props (see plan 005) */
.flow-animating .react-flow__node { transition: transform 350ms cubic-bezier(0.22, 1, 0.36, 1); }
.flow-animating .react-flow__edge-path { transition: d 350ms cubic-bezier(0.22, 1, 0.36, 1); }
/* app/renderer/styles/global.css:9059 */
.awkit-flow-canvas.flow-animating .awkit-flow-node {
  transition: left 350ms cubic-bezier(0.22, 1, 0.36, 1), top 350ms cubic-bezier(0.22, 1, 0.36, 1);
}
/* app/renderer/styles/global.css:5625 — bare `ease`, hardcoded */
.report-progress-fill { transition: width 0.3s ease; }
/* app/renderer/styles/global.css:8791 — hardcoded 220ms + bare `ease` on opacity */
transition: grid-template-rows 220ms var(--awkit-ease-out, ease), opacity 200ms ease;
```

## Target

**One duration spine + one ease-out (kept as-is) + two new curves.** The existing `--awkit-motion-*`
names are retained as *aliases* (so nothing breaks) but point at the canonical `--awkit-dur-*` /
`--awkit-ease-out` values. Add the two new curves at the **exact** values below.

```css
/* target — app/renderer/styles/global.css :root (light), replacing 151-158 */
  /* Canonical duration spine */
  --awkit-dur-fast: 120ms;
  --awkit-dur-med: 180ms;
  --awkit-dur-slow: 260ms;
  --awkit-dur-panel: 240ms;                                 /* was --awkit-motion-panel (see 7803) */
  /* Canonical easing */
  --awkit-ease-out: cubic-bezier(0.22, 1, 0.36, 1);         /* enter/exit — KEEP this exact value */
  --awkit-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);     /* NEW — moving/morphing on screen */
  --awkit-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);      /* NEW — iOS-like drawer/sheet curve */
  /* Back-compat aliases — do not introduce new usages of these */
  --awkit-motion-fast: var(--awkit-dur-fast);
  --awkit-motion-base: var(--awkit-dur-med);
  --awkit-motion-slow: var(--awkit-dur-slow);
  --awkit-motion-ease: var(--awkit-ease-out);
```

> The dark-theme block (`global.css:171-234`) does **not** redefine these motion tokens (they are
> theme-independent), so only the light `:root` block changes.

Then replace the hardcoded call-site durations with tokens (curves for movement become
`--awkit-ease-in-out`; see plan 005 for the `left/top`→`transform` change — this plan only tokenizes the
duration/curve, plan 005 owns the property swap):

```css
/* target — 9059 (duration/curve only; property swap is plan 005) */
.awkit-flow-canvas.flow-animating .awkit-flow-node {
  transition: left var(--awkit-dur-slow) var(--awkit-ease-in-out),
              top  var(--awkit-dur-slow) var(--awkit-ease-in-out);
}
/* target — 5625 */
.report-progress-fill { transition: width var(--awkit-dur-slow) var(--awkit-ease-out); }
/* target — 8791 */
transition: grid-template-rows var(--awkit-dur-panel) var(--awkit-ease-in-out),
            opacity var(--awkit-dur-med) var(--awkit-ease-out);
```

## Repo conventions to follow

- All tokens live in the `:root` block near `global.css:151`. `docs/ai/RULES.md` › UI mandates that
  every color/space/radius/**motion** value resolve through a `--awkit-*` token — this plan makes the
  motion tokens actually honor that.
- Keep the existing `--awkit-ease-out` **value** (`cubic-bezier(0.22, 1, 0.36, 1)`). Do NOT "upgrade" it
  to any other curve — hundreds of call sites and `app/renderer/lib/motion.ts` (`ease: [0.22, 1, 0.36, 1]`
  at lines 53/59/65) are intentionally aligned to it; changing it would desync JS and CSS.
- Exemplar of correct tokenized motion already in the repo: `.metric-card` at `global.css:7730`
  (`transition: transform var(--awkit-dur-fast) var(--awkit-ease-out), box-shadow ...`).

## Steps

1. `global.css:151-158` — replace the token block with the **target** block above (canonical spine +
   two new curves + four back-compat aliases). Confirm `--awkit-motion-panel` (defined later at `7803`)
   is likewise aliased to `--awkit-dur-panel`, or add `--awkit-dur-panel: 240ms` here and alias
   `--awkit-motion-panel: var(--awkit-dur-panel)` at `7803`.
2. `global.css:9059` — swap the two hardcoded `350ms cubic-bezier(0.22,1,0.36,1)` to
   `var(--awkit-dur-slow) var(--awkit-ease-in-out)` (property names unchanged here; plan 005 changes
   `left/top`→`transform`).
3. `global.css:8170, 8174` — these target dead `.react-flow__*` selectors (removed in plan 005). If plan
   005 has NOT run yet, tokenize them the same way; if plan 005 ran, they no longer exist — skip.
4. `global.css:5625` — swap `0.3s ease` → `var(--awkit-dur-slow) var(--awkit-ease-out)`.
5. `global.css:8791` — swap `220ms` → `var(--awkit-dur-panel)`, `ease` (opacity) → `var(--awkit-ease-out)`,
   and the grid-template-rows curve → `var(--awkit-ease-in-out)` (it is a size morph).
6. Update the stale comment in `app/renderer/lib/motion.ts:7-8` only if it names retired tokens — change
   "match the `--awkit-motion-*`" wording to "`--awkit-dur-*` / `--awkit-ease-out`". **Do not change any
   JS values** in that file.

## Boundaries

- Do NOT touch any file except `app/renderer/styles/global.css` (and the one **comment** in
  `app/renderer/lib/motion.ts:7-8`; no code/values there).
- Do NOT delete the `--awkit-motion-*` alias tokens — other rules still reference them; aliasing keeps
  them working while steering new code to the canonical names.
- Do NOT change the `--awkit-ease-out` curve value.
- Do NOT change animated **properties** (e.g. `left`→`transform`) — that is plan 005's job.
- If a cited line's content differs from the excerpt (drift since `7c4b260`), STOP and report.

## Verification

- **Mechanical**:
  - `rg -n "cubic-bezier\(0\.22, 1, 0\.36, 1\)" app/renderer/styles/global.css` → only the
    `--awkit-ease-out` definition (and the two new-curve lines are different values); no hardcoded
    `350ms`/`0.3s`/`220ms` on the edited lines: `rg -n "350ms|0\.3s ease|220ms" app/renderer/styles/global.css`
    should not match the lines you edited.
  - `rg -n "\-\-awkit-ease-in-out|\-\-awkit-ease-drawer" app/renderer/styles/global.css` → each defined once.
  - `npm run build` → passes.
- **Feel check**: run the app and confirm nothing regressed (durations are identical; only names/curves
  for *movement* changed):
  - Trigger the canvas **auto-arrange** glide (Flow Designer → arrange) and confirm nodes glide with a
    natural accelerate-then-settle (`ease-in-out`) rather than the pure decelerate of `ease-out`. In
    DevTools Animations at 10% playback, the glide should ease **in and out**, not start instantly.
  - Confirm the sidebar-group expand/collapse (`grid-template-rows`, `8791`) still opens smoothly.
  - Toggle prefers-reduced-motion → all movement is neutralized.
- **Done when**: one duration spine exists, the two new curves are defined at the exact values above, no
  edited line carries a hardcoded duration, and `npm run build` is clean.
