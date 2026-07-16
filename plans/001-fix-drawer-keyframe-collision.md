# 001 — Fix the triple `awkit-drawer-in` keyframe collision

- **Status**: TODO
- **Commit**: 7c4b260
- **Severity**: HIGH
- **Category**: Cohesion / Interruptibility
- **Estimated scope**: 1 file (`app/renderer/styles/global.css`), ~6 small edits

## Problem

`@keyframes awkit-drawer-in` is defined **three times** in `global.css`, each with a **different body**.
CSS keyframes are global-by-name and the **last definition wins for every consumer** — so all three
drawers animate with the third body, not the one written next to them.

```css
/* app/renderer/styles/global.css:7382 — consumer #1 (generic drawer) */
.awkit-drawer {
  animation: awkit-drawer-in var(--awkit-dur-med) var(--awkit-ease-out);
  ...
}
/* app/renderer/styles/global.css:7393 — definition #1 (subtle 24px nudge) */
@keyframes awkit-drawer-in {
  from { transform: translateX(24px); opacity: 0.4; }
  to   { transform: translateX(0);    opacity: 1;   }
}
```

```css
/* app/renderer/styles/global.css:7905 — consumer #2 (config drawer) */
.properties-panel.template-config-drawer {
  ...
  animation: awkit-drawer-in var(--awkit-motion-panel) var(--awkit-ease-out) both;
}
/* app/renderer/styles/global.css:7917 — definition #2 (16px + scale) */
@keyframes awkit-drawer-in {
  from { opacity: 0; transform: translateX(16px) scale(0.99); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}
```

```css
/* app/renderer/styles/global.css:8482 — consumer #3 (scenario side panel) */
.scenario-properties-panel {
  animation: awkit-drawer-in var(--awkit-motion-slow) var(--awkit-motion-ease) both;
  ...
}
/* app/renderer/styles/global.css:8502 — definition #3 (full-width slide) — THIS ONE WINS FOR ALL THREE */
@keyframes awkit-drawer-in {
  from { opacity: 0.6; transform: translateX(100%); }
  to   { opacity: 1;   transform: translateX(0); }
}
```

**Effect today:** `.awkit-drawer` (intended a 24px nudge from opacity 0.4) and
`.template-config-drawer` (intended 16px + `scale(0.99)` from opacity 0) both render as a **full-width
`translateX(100%)` slide from opacity 0.6** — the wrong motion, and a visible full-panel-width sweep
where a small settle was intended. This is a latent correctness bug, not a taste call.

## Target

Each consumer keeps the motion written next to it by giving each keyframe a **unique name**. No visual
change to `.scenario-properties-panel` (it already—accidentally—gets its own body); `.awkit-drawer` and
`.template-config-drawer` are restored to their intended motion.

```css
/* target — app/renderer/styles/global.css:7382 */
.awkit-drawer {
  animation: awkit-drawer-in-nudge var(--awkit-dur-med) var(--awkit-ease-out);
  ...
}
/* target — replaces definition at 7393 */
@keyframes awkit-drawer-in-nudge {
  from { transform: translateX(24px); opacity: 0.4; }
  to   { transform: translateX(0);    opacity: 1;   }
}
```

```css
/* target — app/renderer/styles/global.css:7905 */
.properties-panel.template-config-drawer {
  ...
  animation: awkit-config-drawer-in var(--awkit-motion-panel) var(--awkit-ease-out) both;
}
/* target — replaces definition at 7917 */
@keyframes awkit-config-drawer-in {
  from { opacity: 0; transform: translateX(16px) scale(0.99); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}
```

```css
/* target — app/renderer/styles/global.css:8482 */
.scenario-properties-panel {
  animation: awkit-side-panel-in var(--awkit-motion-slow) var(--awkit-motion-ease) both;
  ...
}
/* target — replaces definition at 8502 */
@keyframes awkit-side-panel-in {
  from { opacity: 0.6; transform: translateX(100%); }
  to   { opacity: 1;   transform: translateX(0); }
}
```

## Repo conventions to follow

- Keyframes are named `awkit-<thing>-<motion>` (e.g. `awkit-pop-in`, `awkit-panel-in`, `awkit-page-enter`
  at `global.css:7713, 8297, 6937`). The three new names follow that pattern.
- Durations/easings stay as the existing tokens each consumer already references
  (`--awkit-dur-med`, `--awkit-motion-panel`, `--awkit-motion-slow`, `--awkit-ease-out`,
  `--awkit-motion-ease`). Do not change them in this plan (token consolidation is plan 002).
- Motion is `transform` + `opacity` only — already true here; keep it.

## Steps

1. `global.css:7382` — in `.awkit-drawer`, rename the animation reference `awkit-drawer-in` →
   `awkit-drawer-in-nudge`.
2. `global.css:7393` — rename that `@keyframes awkit-drawer-in` → `@keyframes awkit-drawer-in-nudge`
   (body unchanged).
3. `global.css:7905` — in `.properties-panel.template-config-drawer`, rename the animation reference
   `awkit-drawer-in` → `awkit-config-drawer-in`.
4. `global.css:7917` — rename that `@keyframes awkit-drawer-in` → `@keyframes awkit-config-drawer-in`
   (body unchanged).
5. `global.css:8482` — in `.scenario-properties-panel`, rename the animation reference
   `awkit-drawer-in` → `awkit-side-panel-in`.
6. `global.css:8502` — rename that `@keyframes awkit-drawer-in` → `@keyframes awkit-side-panel-in`
   (body unchanged).
7. Grep the whole repo for any remaining `awkit-drawer-in` reference; there must be **zero** after this
   plan (`rg "awkit-drawer-in" app/renderer`). If another consumer references it, STOP and report — it
   was silently getting body #3 and needs an explicit decision.

## Boundaries

- Do NOT touch any file other than `app/renderer/styles/global.css`.
- Do NOT change the keyframe bodies, durations, easings, or any consumer's other properties — only the
  three animation-name references and the three keyframe names.
- Do NOT merge the three into one "shared" drawer motion — the three surfaces intentionally differ (a
  generic drawer, a 440px config drawer, a full-height scenario side panel).
- If a keyframe body at the cited line does not match the excerpt above (drift since commit `7c4b260`),
  STOP and report.

## Verification

- **Mechanical**:
  - `rg -n "awkit-drawer-in\b" app/renderer` → **no matches** (all renamed).
  - `rg -n "awkit-drawer-in-nudge|awkit-config-drawer-in|awkit-side-panel-in" app/renderer/styles/global.css`
    → exactly **2 matches each** (one consumer + one `@keyframes`).
  - `npm run build` → passes (tsc + bundles; CSS is bundled, so a dangling animation name would still
    build — rely on the greps above for correctness).
- **Feel check**: run the app (`npm run dev` or the Electron dev launch), then:
  - Open the **Flow Designer** and open the node **config drawer** (`.template-config-drawer`): it should
    settle in with a **small 16px slide + faint scale**, NOT sweep across its full width.
  - Open the **Scenario Builder** properties (`.scenario-properties-panel`): unchanged — a full-width
    slide from the right edge is correct for that overlay panel.
  - In DevTools → Animations, set playback to **10%** and confirm the config drawer travels a short
    distance (~16px), not its entire width.
  - Rendering panel → enable **prefers-reduced-motion** and confirm all three drawers appear without
    movement (the global neutralizer handles this).
- **Done when**: each drawer plays the body defined next to it, `rg "awkit-drawer-in\b"` returns nothing,
  and `npm run build` is clean.
