# AWKIT — UI Design & Motion Direction

> **Status:** Direction / specification only. **No source code is changed by this document.**
> It establishes the coherent visual, interaction, and animation language for the whole
> app *before* any implementation. Implementation is deferred to the roadmap in §13.
>
> **Sources:** an evidence-based audit of the current renderer (`app/renderer/**`, chiefly the
> 9,067-line `app/renderer/styles/global.css`) reconciled with two design references —
> Emil Kowalski's design-engineering philosophy (`emil-design-eng`) and Apple's fluid-interface
> principles (`apple-design`). File\:line citations throughout point at real code.
>
> **Scope guardrails honored:** no new pages/features; no backend/API/execution/business-rule
> changes; existing stack kept (React + TypeScript + plain CSS + the in-house canvas engine);
> the `.app-shell` / `.app-main` grids and `window.playwrightFlowStudio` contract are untouched;
> all proposals resolve through `global.css` tokens (Hologram re-skin rule, `docs/ai/RULES.md` › UI).

---

## 1. Executive summary

AWKIT already has a **mature, largely disciplined design system** — the "Hologram" token set in
`global.css` (violet accent, light/dark parity on every token, a coherent shadow ladder, a single
strong ease-out curve) and a genuinely **well-engineered in-house canvas** (Pointer Events with
capture, 1:1 zoom-aware drag, rAF-batched drag, memoized node/edge layers). The codebase avoids the
worst motion sins: **no `transition: all`, no `scale(0)` entrances, one consistent ease-out curve,
and a comprehensive reduced-motion neutralizer.** This is a strong base, not a rebuild.

The problems are **coherence and completeness**, not taste:

1. **Two foundation scales collide.** Spacing exists twice (`--space-*` and `--awkit-space-*`) with a
   direct value conflict at step 5 (24px vs 20px, `global.css:32,37`); radius exists twice with
   different values (`--radius-sm:8` vs `--awkit-radius-sm:10`, `global.css:39,135`).
2. **Motion vocabulary is one-dimensional.** A single easing curve is aliased under two names; there is
   **no ease-in-out** for moving/morphing elements and **no spring** anywhere.
3. **Trigger-attached surfaces are not origin-aware.** `transform-origin` appears exactly **once** in
   9,067 lines — dropdowns, menus, popovers, and tooltips do not scale from their trigger.
4. **Hover is never pointer-gated.** 78 `:hover` rules, **zero** `@media (hover: hover)` guards — every
   hover effect fires on a touchscreen tap.
5. **The canvas animates layout properties.** Nodes are positioned with `left`/`top`
   (`FlowCanvas.tsx:540`) and the auto-arrange glide animates `left`/`top`/`d` (`global.css:9059,8174`)
   instead of GPU `transform`.
6. **No type scale.** 259 hardcoded `font-size` values, zero typography tokens, only 33
   line-height/letter-spacing declarations total — no size-specific tracking or leading.
7. **Latent duplication bugs.** `@keyframes awkit-drawer-in` is defined **three times** with different
   bodies (`7393 / 7917 / 8502`); because CSS keyframes are global-by-name and last-wins, **every**
   drawer silently plays the full-width `translateX(100%)` version regardless of intent.

**The direction:** consolidate to **one token spine**, add a **small, exact motion vocabulary** (two
curves + one spring set), make **trigger surfaces originate from their trigger**, **gate hover behind
pointer capability**, move the **canvas onto transforms**, add a **type scale**, and — above all —
**hold the line that high-frequency and keyboard-initiated actions do not animate.** The felt result
should be a *precision instrument*: instant, quiet, and spatially coherent, refined without being showy.

---

## 2. Current UI & motion assessment

### 2.1 What is already right (preserve these)

| Strength | Evidence | Keep because |
| --- | --- | --- |
| No `transition: all` anywhere | 0 matches in `global.css` | Properties are explicit → cheap, predictable |
| No `scale(0)` entrances | `awkit-pop-in` starts `scale(0.98)` (`7716`) | Nothing appears "from nothing" |
| One strong ease-out curve | `--awkit-ease-out: cubic-bezier(0.22,1,0.36,1)` (`155`) | Matches Emil's recommended strong ease-out almost exactly |
| Full light/dark token parity | every token has a `[data-theme="dark"]` twin (`171–234`) | Theme correctness is automatic on token use |
| Comprehensive reduced-motion kill-switch | global `*` neutralizer (`8445–8454`) | Motion-sickness safety by default |
| Coherent elevation ladder | `--awkit-shadow-soft/card/float/hover/node` (`140–147`) | A real depth system already exists |
| Canvas: Pointer Events + capture, 1:1 drag | `FlowCanvas.tsx:266,488,493–507` | Direct-manipulation done correctly |
| Canvas: rAF-batched drag, memoized layers | `FlowCanvas.tsx:330–345,617,448` | 60fps drag independent of graph size |
| Stagger done well | card-rise 45ms step, capped at 270ms (`705–722`) | Within the 30–80ms window, and bounded |
| Press feedback exists | `.toolbar-button:active { translateY(1px) }` (`402`) | The instinct is present (just not universal) |

### 2.2 Problems, by severity

**P0 — Foundation coherence**

- **Colliding spacing scales.** `--space-5: 24px` (`32`) vs `--awkit-space-5: 20px` (`37`). "Step 5" means
  two different things; `docs/ai/RULES.md` tells authors to use *both* families.
- **Colliding radius scales.** `--radius-sm/md/lg = 8/12/16` (`39–41`) vs
  `--awkit-radius-sm/md/card/panel = 10/14/18/22` (`135–138`).
- **Duplicate keyframe names silently override.** `awkit-drawer-in` × 3 (`7393/7917/8502`); the
  `.awkit-drawer` at `7382` intends a subtle 24px slide but actually renders the `8502` body
  (`translateX(100%)`, opacity 0.6). `.modal-overlay` is also split across two blocks (`3898`, `7696`).
- **No type scale.** 259 `font-size` literals, 0 type tokens.

**P1 — Motion vocabulary**

- **No ease-in-out** for on-screen movement (both skills reserve ease-in-out for morph/reposition).
- **Duplicate duration/curve aliases:** `--awkit-motion-fast/base/slow` (`151–153`) duplicate
  `--awkit-dur-fast/med/slow` (`156–158`); `--awkit-motion-ease` duplicates `--awkit-ease-out`.
- **No origin-awareness** for trigger-attached surfaces (`transform-origin` used once, `8328`, on the
  spinner — legitimately `center`).
- **No springs** — every transition is fixed-duration, so nothing is velocity-aware or
  cleanly interruptible mid-gesture.
- **Hardcoded off-scale durations:** `350ms` at `8170/8174/9059` bypasses the token ladder and exceeds
  the 300ms UI ceiling.

**P2 — Accessibility & performance**

- **Hover never gated:** 78 `:hover`, 0 `@media (hover: hover) and (pointer: fine)`.
- **Canvas animates `left`/`top`/`d`** (`9059/8174`) and positions nodes with `left`/`top`
  (`FlowCanvas.tsx:540`) → layout/paint per frame instead of compositor-only `transform`.
- **`outline: none` × 14** (`901,3919,…,9054`) must each be proven to pair with a visible
  `:focus-visible` alternative (14 focus-visible rules exist — verify 1:1 coverage).
- **Blanket reduced-motion** kills *all* transitions incl. comprehension-aiding fades (skills say keep
  opacity/color, drop only movement).
- **No `will-change`**, **no `prefers-reduced-transparency` / `prefers-contrast`** responses.

**P3 — Polish & translucency**

- **Translucency is defined but unused:** `--awkit-glass` exists (`131`) but `backdrop-filter` appears
  **once** (`3901`, a 3px modal blur). Depth-via-material is an untapped, Apple-aligned lever.
- **Dead React-Flow residue:** `--xy-*` tokens (`2969–2977`) and `.react-flow__*` rules (`8159–8175`)
  survive though the engine was replaced by the in-house canvas (2026-07-11). Harmless but misleading.
- **Page-enter replays on every navigation** (`AppShell.tsx:40,48`; keyframe `6937`) — tens/day.

---

## 3. Intended product personality

**AWKIT is a precision instrument for professionals who live in it all day.**

| It is | It is not |
| --- | --- |
| Calm, quiet, confident | Playful, bouncy, attention-seeking |
| Instant — response before beauty | Animated-for-its-own-sake |
| Precise and dense without feeling cramped | Sparse/minimalist at the cost of information |
| Spatially coherent (things come from where they go) | Randomly transitioning |
| Apple-*influenced* restraint & materials | An Apple imitation or a consumer toy |
| Trustworthy under load (never drops frames) | Impressive in a demo, janky in a 50-instance run |

The emotion to engineer for is **quiet confidence**. Motion exists to *explain* (where did this come
from, what changed, what is running) — never to entertain. A power user running the same workflow for
the 200th time today should feel the app is *faster than they are*, with feedback so restrained it
registers only as responsiveness. Delight here is the **absence of friction**, not confetti.

---

## 4. Interaction-frequency map

Emil's first question is always *"how often will the user see this?"* — it dictates whether something
may animate at all. Mapped to AWKIT:

| Frequency | AWKIT interactions | Motion budget |
| --- | --- | --- |
| **Hundreds/day** | Node select/click; node drag; canvas pan; canvas wheel-zoom; connector select; toolbar/icon-button press; hover states; typing in search/filter/property fields; tab & sub-panel switches; keyboard navigation | **No entrance/exit animation.** Only instant pointer-down feedback + 1:1 tracking. |
| **Tens/day** | Route navigation (sidebar); open/close properties inspector; open node palette; run a flow/workflow; open the all-instances modal; open a dropdown/select; first tooltip in a group; expand/collapse a nav group | **Minimal, ≤180ms.** Reduce or remove; never block input. Subsequent tooltips instant. |
| **Occasional** | Confirm / unsaved-changes / connection-confirm modals; run-detail drawer; sidebar collapse; theme toggle; auto-arrange (fit/glide); create/delete node; save | **Standard animation** (200–300ms ease-out, origin-aware). |
| **Rare / first-time** | Empty states; first-run; Settings changes; protected-login handoff; benchmark; success/celebration moments | **May carry a touch of delight** — still fast, still purposeful. |

**Consequence:** the majority of AWKIT interactions live in the top row, so the dominant design
decision is *what NOT to animate* (see §14). The animation work concentrates in the occasional/rare
rows, where it actually aids comprehension.

---

## 5. Design foundations

Six principles, in priority order. Every token and component rule below serves one of them.

1. **Response before beauty.** Feedback on pointer-*down*, never on release; continuous during a
   gesture, not just at its end (`apple-design` §1). Latency is the one unforgivable regression.
2. **Direct manipulation.** Dragged things stay glued to the pointer, 1:1, respecting the grab offset
   and the current zoom — already true in the canvas (`FlowCanvas.tsx:497`); extend the discipline to
   every draggable surface (drawers, sliders, resize handles).
3. **Restraint proportional to frequency.** The §4 map is law: the more often an action happens, the
   less it may move.
4. **Spatial continuity.** Things enter and exit along the same path and originate from their trigger,
   so the user always knows where something came from and where it went (`apple-design` §7).
5. **One token spine.** Exactly one scale each for space, radius, type, duration, and easing. Aliases
   may exist for migration, but there is a single source of truth per axis.
6. **Offline-first & dense-pro constraints.** No remote fonts/scripts (bundled Inter stays); no shell
   re-architecture; translucency is opt-in on surfaces that *already* float over content, never a
   reason to restructure `.app-shell`.

---

## 6. Proposed visual tokens

> These **reconcile and extend** the existing Hologram tokens; they do not throw them away. Existing
> names remain as **aliases** during migration so no component breaks. New names are the source of truth.

### 6.1 Typography (new — fills the biggest gap)

Bundled **Inter** stays (offline-first, `global.css:6`). Add a rem-based scale with **size-specific
tracking and leading** (`apple-design` §15): tighten large text, keep body near 0, loosen small text.

| Token | Size | Line-height | Letter-spacing | Role |
| --- | --- | --- | --- | --- |
| `--text-2xs` | 11px | 1.4 | +0.02em | chips, dense captions, table meta |
| `--text-xs` | 12px | 1.45 | +0.01em | secondary labels, badges |
| `--text-sm` | 13px | 1.5 | 0 | secondary body, table cells |
| `--text-base` | 14px | 1.5 | 0 | **default body** (app is dense) |
| `--text-md` | 16px | 1.45 | 0 | emphasized body, section leads |
| `--text-lg` | 18px | 1.35 | −0.01em | card titles, panel headers |
| `--text-xl` | 22px | 1.25 | −0.015em | page section titles |
| `--text-2xl` | 28px | 1.15 | −0.02em | page titles, empty-state headlines |

Weights: **400** body · **500** labels/UI · **600** headings & emphasis · 700 reserved. Build
hierarchy from *weight + size + leading as a set*, not size alone. Keep `font-synthesis: none` and
`text-rendering: optimizeLegibility` (already set). Add `font-optical-sizing: auto`.

### 6.2 Spacing (consolidate to one 4px grid)

Keep the `--space-*` family as canonical; **retire the conflicting `--awkit-space-*` values by aliasing
them to the canonical scale** (resolves the 24-vs-20 step-5 collision).

| Token | Value | | Token | Value |
| --- | --- | --- | --- | --- |
| `--space-1` | 4px | | `--space-5` | 24px |
| `--space-2` | 8px | | `--space-6` | 32px |
| `--space-3` | 12px | | `--space-7` | 40px |
| `--space-4` | 16px | | `--space-8` | 48px |
| `--space-4h` | 20px *(add the missing 20)* | | | |

### 6.3 Radius (one scale)

| Token | Value | Role | Old aliases to map |
| --- | --- | --- | --- |
| `--radius-xs` | 8px | inputs, chips, small controls | `--radius-sm` |
| `--radius-sm` | 10px | buttons, table rows | `--awkit-radius-sm` |
| `--radius-md` | 14px | cards, menus, popovers | `--radius-md`, `--awkit-radius-md` |
| `--radius-lg` | 18px | panels, modals, node cards | `--radius-lg`, `--awkit-radius-card` |
| `--radius-xl` | 22px | drawers, large sheets | `--awkit-radius-panel` |
| `--radius-pill` | 999px | pills, badges, toggles | (unchanged) |

### 6.4 Borders

Keep `--awkit-border` (0.08α) / `--awkit-border-strong` (0.14α) — both light/dark-aware (`71–72`,
`177–178`). Rule: **1px hairlines only**; use the shadow ladder, not heavier borders, for elevation.
Prefer **scroll-edge fade masks** over 1px dividers where floating chrome overlaps scrolling content
(`apple-design` §12).

### 6.5 Shadows & elevation (formalize the existing ladder)

| Elevation | Token | Use |
| --- | --- | --- |
| 0 — flat | `none` | page background, inset wells (`--awkit-surface-inset`) |
| 1 — resting | `--awkit-shadow-soft` | cards at rest, table container |
| 2 — raised | `--awkit-shadow-card` | hovered cards, node at rest (`--awkit-shadow-node`) |
| 3 — floating | `--awkit-shadow-float` | dropdowns, popovers, menus, node hover |
| 4 — overlay | `--awkit-shadow-hover` | modals, drawers, drag ghost |

Bigger surfaces read as thicker: deeper blur **and** deeper shadow than small chips (`apple-design` §12).

### 6.6 Materials & translucency (opt-in, scoped)

Translucency conveys hierarchy **only on surfaces that already float over content** — this respects
the shell-grid rule (no `.app-shell` restructuring). Redefine the glass token to actually be
translucent and pair it with a real blur:

| Token | Light | Dark | Applied to |
| --- | --- | --- | --- |
| `--awkit-glass` | `rgba(255,255,255,0.72)` | `rgba(22,21,28,0.62)` | canvas floating toolbar & node palette, command/overlay chrome |
| `--awkit-glass-blur` | `blur(20px) saturate(180%)` | same | the backdrop-filter for the above |
| `--awkit-scrim` | `rgba(32,23,47,0.40)` | `rgba(0,0,0,0.60)` | modal/drawer dimming (keep `--awkit-overlay`) |

Rules (from `apple-design` §12): never stack one translucent surface on another; put color on solid
layers, keep translucent foregrounds high-contrast; **cap the number of concurrent backdrop-filters**
(expensive); and always provide a `prefers-reduced-transparency` solid fallback (§10). Do **not** apply
glass to dense tables, forms, or the properties inspector — legibility first.

---

## 7. Proposed motion tokens

### 7.1 Durations (extend the existing ladder; retire the `--awkit-motion-*` duplicates)

| Token | Value | Use |
| --- | --- | --- |
| `--awkit-dur-press` *(new)* | 90ms | pointer-down press feedback |
| `--awkit-dur-fast` | 120ms | hover/color, small state changes, tooltips |
| `--awkit-dur-med` | 180ms | dropdowns, selects, page-content fade |
| `--awkit-dur-panel` | 240ms | side panels, node palette |
| `--awkit-dur-slow` | 260ms | drawers, larger reveals |
| `--awkit-dur-modal` *(new)* | 300ms | modal settle (hard ceiling for UI) |

**Retire** `--awkit-motion-fast/base/slow` and `--awkit-motion-panel` as *aliases* of the above (they
are byte-identical duplicates). Replace the three hardcoded `350ms` canvas transitions with
`--awkit-dur-slow` (260ms) — under the 300ms ceiling.

### 7.2 Easing curves

| Token | Curve | Use | Rule |
| --- | --- | --- | --- |
| `--awkit-ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` *(exists, keep)* | **entering & exiting** UI | starts fast → feels instant |
| `--awkit-ease-in-out` *(new)* | `cubic-bezier(0.77, 0, 0.175, 1)` | **moving / morphing** on-screen (node glide, reorder, canvas reposition) | natural accel/decel |
| `--awkit-ease-drawer` *(new)* | `cubic-bezier(0.32, 0.72, 0, 1)` | drawers & sheets | iOS-like settle |
| `linear` | — | spinners, progress, marquee, live-edge dashes | constant motion |

**`ease-in` is banned for UI entrances/exits.** For reversible transitions, mirror the curve (inverse
control points) so the return path matches the outbound path (`apple-design` §7).

### 7.3 Spring configurations (for JS/WAAPI-driven interruptible motion)

CSS transitions cannot be grabbed and reversed mid-flight; use springs (Motion/WAAPI) for **gesture-
driven, reversible** surfaces only. Values follow Apple's damping/response model (`apple-design` §4):

| Token (config) | Damping | Response | Motion API | Use |
| --- | --- | --- | --- | --- |
| `spring-default` | 1.0 | 0.35s | `{ bounce: 0, duration: 0.35 }` | default UI settle, no overshoot |
| `spring-move` | 1.0 | 0.4s | `{ bounce: 0, duration: 0.4 }` | reposition (canvas fit, node reflow) |
| `spring-drawer` | 0.8 | 0.3s | `{ bounce: 0.2, duration: 0.3 }` | drawer/sheet drag-release |
| `spring-momentum` | 0.8 | 0.4s | `{ bounce: 0.2, duration: 0.4 }` | flick/throw landing |

**Bounce only when the gesture itself carried momentum** (a flick or drag-release). Never bounce a menu
that merely faded in. Default everything to critically damped (bounce 0).

### 7.4 Stagger limits

Keep the existing card-rise pattern: **45ms** between items, **hard-capped** so total ≤ ~270ms
(`global.css:705–722`). Never exceed 80ms/step; never block interaction while a stagger plays; apply
stagger only on genuine first mount, not on every re-visit.

### 7.5 Reduced-motion alternatives

Refine the blanket neutralizer (`8445–8454`) so reduced motion means *gentler*, not *nothing*
(`apple-design` §14, `emil-design-eng` › Accessibility):

- **Keep** opacity & color transitions that aid comprehension (state, validation, run status).
- **Remove** transform/position/scale motion and any bounce; replace slides/springs with a ≤200ms
  cross-fade.
- Also honor `prefers-reduced-transparency` (frost/solidify glass) and `prefers-contrast` (near-solid
  surfaces + defined borders).

---

## 8. Component-specific behavior recommendations

| Component | Frequency | Recommendation |
| --- | --- | --- |
| **Buttons / icon buttons** | hundreds/day | Instant pointer-down feedback on **all** pressables (today only `.toolbar-button`/`.icon-button`, `402/8252`). Keep the `translateY(1px)` press *or* adopt `scale(0.97)` — pick one and apply universally at `--awkit-dur-press`. No entrance animation. |
| **Primary CTA** | tens/day | Same press feedback + existing soft depth. Optional 200ms `filter: blur` mask on label swap (loading→done) per Emil. |
| **Sidebar nav items** | hundreds/day | **No** transition on activate — instant. Hover = color only, `--awkit-dur-fast`, **pointer-gated**. Group expand/collapse: animate `grid-template-rows` 0fr→1fr (not `max-height` guesswork) at `--awkit-dur-med` ease-out. |
| **Sidebar collapse** | occasional | Width transition `--awkit-dur-panel` `--awkit-ease-in-out` (it *moves*, not enters). Content reflow must not jump; icons stay put. |
| **Dropdowns / selects / menus** | tens/day | Scale-in from the **trigger**: `transform-origin` set to the trigger edge, `translateY(-4px) scale(0.98)` + opacity, `--awkit-dur-med` ease-out. Exit faster (`--awkit-dur-fast`). This is the single biggest origin-awareness fix. |
| **Tooltips** | tens/day | 125–200ms, origin-aware. **First** tooltip delays; once one is open, adjacent tooltips open **instantly with no animation** (`emil-design-eng`). Pointer-gated; never on touch. |
| **Context menus / popovers** | occasional | Same origin-aware scale-in as menus, anchored to the cursor/trigger. `--awkit-shadow-float`. |
| **Modals (confirm / unsaved / connect)** | occasional | Keep **center** origin (correct for modals). `awkit-pop-in` (`translateY(6px) scale(0.98)`, `7713`) is right — keep it, at `--awkit-dur-modal`. Scrim fades at `--awkit-dur-fast`. Exit reverses. |
| **Drawers / run-detail / properties** | occasional | **Fix the triple keyframe first** (§12). One drawer-in: slide from its own edge (`translateX(100%)`→0) at `--awkit-dur-slow` `--awkit-ease-drawer`; exit along the same edge. Make it drag-dismissible with `spring-drawer` + velocity handoff (§9). |
| **Toasts** | occasional | Enter & exit from the **same** edge (spatial consistency); use CSS *transitions* not keyframes so rapid stacking retargets smoothly (`emil-design-eng` › Sonner). Swipe-to-dismiss with momentum (velocity > 0.11 dismisses). |
| **Workflow / instance cards** | tens/day | Hover lift (`translateY` + shadow 1→2) `--awkit-dur-fast`, **pointer-gated**. First-mount stagger only. No re-animation on data refresh — update in place. |
| **Tables / rows** | hundreds/day | **No row entrance animation.** Sort/filter = instant re-order (optional ≤120ms opacity cross-fade on the tbody, never row-by-row slides). Sticky header already present; keep. |
| **Filters / search** | hundreds/day | Instant. Results update with at most a tbody opacity fade; never a layout animation per result. Debounce input, not the render. |
| **Pagination** | tens/day | Instant page swap; optional 120ms opacity cross-fade. No horizontal slide (implies spatial travel that isn't real). |
| **Execution / run status** | live | State color transitions `--awkit-dur-fast` (keep). Running = a single `linear` pulse/dash; never a bouncy loop. Errors/warnings appear with opacity (kept under reduced motion). |
| **Live-running nodes** | live | See §9.6 — one calm looping indicator per running node, `linear`, GPU-only, throttled. |
| **Progress / spinners** | live | Keep `--awkit-spinner` (`8324`, `center` origin, linear). A *faster* spin reads as faster loading (Emil) — 900ms is fine; don't slow it. |
| **Skeletons** | occasional | Keep `awkit-shimmer` shimmer, `linear`. Cross-fade skeleton→content (opacity) so it doesn't pop. |
| **Empty states** | rare | May carry a little delight: gentle staggered fade-in of illustration→headline→CTA, first render only. |
| **Form validation** | tens/day | Inline, on blur/change (not on submit). Error appears with opacity + 1px border color at `--awkit-dur-fast`; **no shake** (movement adds nothing, fails reduced-motion intent). Keep the color/opacity under reduced motion. |
| **Save feedback** | tens/day | Button label morph (idle→saving→saved) with a 200ms blur-masked cross-fade; the checkmark is completion feedback, not celebration. |

---

## 9. Canvas & workflow-builder interaction recommendations

The canvas is the app's signature surface and is already the most carefully engineered
(`FlowCanvas.tsx`). Recommendations are **refinements**, ordered by impact.

### 9.1 Panel open / close & canvas shift (spatial continuity)
Opening the properties inspector currently makes it a **real layout column** so the canvas *shrinks*
rather than being covered (`DesignerCanvasLayout.tsx:50–52`) — the right instinct. Two refinements:
- Animate the column width with `grid-template-columns` (fr) at `--awkit-dur-panel` `--awkit-ease-in-out`
  so the canvas viewport *glides* to its new width instead of snapping.
- Pair it with the existing `panBy` (`FlowCanvas.tsx:184`) so any node the panel would cover slides
  clear **in the same motion** (same duration/curve) — one coherent gesture, not two.

### 9.2 Node creation / deletion
- **Create:** the new node fades+scales in from `scale(0.96)`+opacity at its drop point
  (`--awkit-dur-med`, ease-out) so it doesn't pop. If appended via the "+" button, originate the motion
  from that button.
- **Delete:** reverse — scale to `0.96` + opacity out, `--awkit-dur-fast`, then its edges re-route with
  `--awkit-ease-in-out`. Never leave a hard gap; neighbors settle into place.

### 9.3 Node selection / drag / resize / arrange
- **Select:** instant. Selection ring is a box-shadow/border change, **no** transition delay (hundreds/day).
- **Drag:** already 1:1 and zoom-correct (`FlowCanvas.tsx:497`). **Keep placement exact — no momentum,
  no bounce** on node drop (precision > flair). Raise the node drag threshold from **1px** (`499`) to
  ~3–4px so a click with a tremor isn't read as a drag.
- **Resize:** if/when node resize exists, 1:1 with the handle, rubber-band at min/max size rather than a
  hard stop (`apple-design` §9).
- **Auto-arrange / fit:** this is the one canvas motion that *should* feel alive. Move it off `left/top`
  onto `transform` (§11) and drive it with `spring-move` (interruptible) so a user can grab a node
  mid-glide. Cap the glide so large graphs don't animate for >~400ms.

### 9.4 Connector creation / selection
- **Create (drag-to-connect):** already emits on overlap-drop (`FlowCanvas.tsx:349`). While dragging,
  show a live "ghost" connector following the pointer (the `DraggingEdgeLayer` already re-routes only
  touched edges — extend it to a pending connector). Snap-preview the target with a subtle highlight as
  the projected endpoint nears it.
- **Select:** instant stroke-width/color change (already `--awkit-dur-fast`, `8155`). Keep. Move the
  hover/selected `filter: drop-shadow` (`8161`) behind pointer-gating for hover.
- **Edge path morph:** animating the SVG `d` (`8174`) is acceptable for occasional auto-arrange but is
  paint-heavy; restrict it to the arrange window only (already gated by `.flow-animating`) and never
  during live drag (already true — drag uses direct re-route).

### 9.5 Toolbar collapse / node palette
- Node palette enters with `awkit-panel-in` (`translateX(-10px)`, `8297`) — good; make it originate from
  the toolbar button that opened it. As a floating canvas surface it is a **prime candidate for the glass
  material** (§6.6).
- Toolbar collapse/expand: animate width/opacity of labels at `--awkit-dur-panel` `--awkit-ease-in-out`;
  icons never move.

### 9.6 Live workflow execution visualization
- One **calm** indicator per running node: a `linear` pulsing ring or a marching-ants edge dash on the
  active connector (GPU `transform`/`opacity`/`stroke-dashoffset` only), throttled to a slow cycle so a
  50-node run isn't a light show. Reuse `awkit-badge-pulse`/`recorder-pulse` vocabulary but ensure it is
  GPU-only and **fully neutralized under reduced motion** (a static "running" badge remains).
- Progress across the run: a single `linear` progress element, not per-node celebratory bursts.

### 9.7 Pan / zoom feel
- Keep interactive pan/zoom strictly 1:1 (no animation during the gesture — already correct, `136`).
- **Optional** enhancement: gentle inertial pan on flick-release using momentum projection
  `project(v) = (v/1000)·0.998/(1−0.998)` and `spring-momentum` velocity handoff (`apple-design` §5–6).
  This is a *nice-to-have* for the "alive" feel; it must never overshoot node placement and must be
  disabled under reduced motion.
- Wheel/trackpad zoom steps by 1.1× per tick (`303`); consider smoothing successive ticks so pinch-zoom
  on a trackpad doesn't feel stepped.

---

## 10. Accessibility requirements

| Requirement | Current state | Action |
| --- | --- | --- |
| **Reduced motion** | Blanket `*` kill-switch (`8445`) | Refine to keep opacity/color, drop only movement/bounce; cross-fade replacements ≤200ms |
| **Reduced transparency** | none | Add `@media (prefers-reduced-transparency: reduce)` → solidify glass, drop blur (pairs with §6.6) |
| **High contrast** | none | Add `@media (prefers-contrast: more)` → near-solid surfaces + defined borders |
| **Touch/touchpad hover** | 78 `:hover`, 0 gates | Wrap hover-*motion* (lifts/scales/shadows) in `@media (hover: hover) and (pointer: fine)`; keep essential hover affordances (cursor, tooltip triggers) ungated |
| **Focus visible** | 14 `:focus-visible`, 14 `outline:none` | Audit each `outline:none` (`901…9054`) for a paired visible ring; the global `:focus-visible` ring is the required alternative (`RULES.md` › Accessibility) |
| **Keyboard access** | nav uses real `<button>`s (good) | Ensure canvas nodes, connectors, menus, and the properties panel are fully keyboard-operable and focus is spatially logical; **never** animate keyboard-initiated actions |
| **Contrast (text)** | tokens defined | Verify `--awkit-text-muted` (`#91899f` light / `#7d7790` dark) meets ≥4.5:1 on its surfaces; bump muted text on glass (vibrancy: higher weight + contrast) |
| **Target size** | — | Interactive controls ≥ 32px hit area (dense-desktop); pad small icon buttons to a ≥32px target |
| **Wayfinding** | route groups exist | Preserve clear "where am I / where can I go / how do I exit"; never trap focus in a modal/drawer without an Escape + visible close |

---

## 11. Performance requirements

1. **Animate only `transform` and `opacity`.** The one systemic violation is the canvas: nodes use
   `left`/`top` (`FlowCanvas.tsx:540`) and the arrange glide animates `left`/`top`/`d`
   (`9059/8174`). Move node positioning to `transform: translate3d(x,y,0)` and the glide to `transform`;
   this is the highest-value perf change and unlocks smooth 50-node runs.
2. **Keep the memoization architecture.** `NodeContainer`/`EdgeLayer` are memoized and the drag path is
   O(edges touching the dragged node) (`FlowCanvas.tsx:448,617,662`). Do not regress this; it is why the
   canvas scales. (Guarded by `verify:canvas-perf` per project memory.)
3. **`will-change` discipline.** Add `will-change: transform` on the canvas transform layer and on a node
   *at drag-start*, and **remove it at drag-end** — never leave it on globally (it costs memory).
4. **Prefer CSS transitions for predetermined motion, JS/springs only for interruptible gesture motion**
   (`emil-design-eng` › Performance): CSS runs off the main thread and stays smooth while the app is busy
   dispatching a run.
5. **Cap concurrent `backdrop-filter` surfaces** (§6.6) — each is a real GPU cost; a handful, not dozens.
6. **60fps budget under load.** The app runs live automations; motion must never compete with execution.
   Throttle live-node indicators; never run per-node JS animation loops for a large run.
7. **CSS variables on parents cause child recalc** — when driving a live value (e.g. a drag offset),
   set `transform` on the element directly, not a `--var` on a shared ancestor (`emil-design-eng`).

---

## 12. Before / After / Why

**Foundations**

| Before | After | Why |
| --- | --- | --- |
| `--space-5: 24px` **and** `--awkit-space-5: 20px` (`32/37`) | One `--space-*` scale; `--awkit-space-*` aliased to it; add `--space-4h: 20px` | "Step 5" must mean one value; removes a silent 4px inconsistency |
| `--radius-sm: 8` vs `--awkit-radius-sm: 10` (`39/135`) | One radius scale; old names aliased | Two radius systems = inconsistent corners across the app |
| `@keyframes awkit-drawer-in` defined 3× (`7393/7917/8502`) | One definition; all drawers reference it | Global keyframe last-wins makes every drawer play the wrong (`translateX(100%)`) body |
| 259 hardcoded `font-size`, 0 type tokens | `--text-2xs…2xl` scale with per-size leading/tracking | Consistent hierarchy; enables optical tracking per `apple-design` §15 |
| `.modal-overlay` styled in two split blocks (`3898/7696`) | Single block | Maintainability; avoids one block silently overriding the other |
| Dead `--xy-*` tokens & `.react-flow__*` rules (`2969/8159`) | Remove | Engine was replaced 2026-07-11; residue misleads authors |

**Motion**

| Before | After | Why |
| --- | --- | --- |
| Single curve aliased twice; no ease-in-out | Add `--awkit-ease-in-out: cubic-bezier(0.77,0,0.175,1)` for moving/morphing | Enter/exit and move need *different* curves (both skills) |
| `--awkit-motion-*` duplicates `--awkit-dur-*` | Retire motion-* as aliases | One duration spine, no drift |
| `transform-origin` used once (`8328`) | Dropdowns/menus/tooltips scale from their **trigger** | Origin-awareness is a core polish signal; menus should grow from what opened them |
| `350ms` hardcoded canvas transitions (`8170/8174/9059`) | `--awkit-dur-slow` (260ms) | Token-driven; under the 300ms UI ceiling |
| Node positioned/animated via `left`/`top` (`540/9059`) | `transform: translate3d(...)` | GPU compositing; no per-frame layout; smooth large graphs |
| Same enter/exit timing on overlays | Exit faster than enter (e.g. enter 260ms / exit 120ms) | Snappy dismissal feels responsive (`emil-design-eng`) |
| Reduced motion kills *all* transitions (`8445`) | Keep opacity/color, drop only movement | Reduced motion ≠ no feedback (`apple-design` §14) |
| Form errors implied to shake / move | Opacity + border-color only | Movement adds nothing and fails reduced-motion intent |

**Accessibility**

| Before | After | Why |
| --- | --- | --- |
| 78 `:hover`, 0 pointer gates | Hover *motion* behind `@media (hover: hover) and (pointer: fine)` | Prevents sticky hover on touchscreen taps |
| 14 `outline: none` | Each paired with a visible `:focus-visible` ring | Keyboard users must always see focus (`RULES.md`) |
| No `prefers-reduced-transparency` / `prefers-contrast` | Add both media responses | Serves low-vision & vestibular users; required before shipping glass |

---

## 13. Prioritized implementation roadmap

> Each phase is independently shippable, low-risk, and token-first. **Nothing here is implemented yet.**

**Phase 0 — Foundation consolidation** *(highest impact, lowest risk; pure token/CSS hygiene)*
- Unify spacing (`--awkit-space-*` → alias `--space-*`; add `--space-4h`).
- Unify radius into one scale; alias old names.
- **De-duplicate `awkit-drawer-in` → one keyframe** (fixes the latent full-width-slide bug); merge the
  two `.modal-overlay` blocks.
- Remove dead `--xy-*` tokens and `.react-flow__*` rules.
- Add the type-scale tokens (§6.1); do **not** mass-migrate call sites yet — just introduce the spine.

**Phase 1 — Motion vocabulary**
- Add `--awkit-ease-in-out`, `--awkit-ease-drawer`, `--awkit-dur-press`, `--awkit-dur-modal`; retire the
  `--awkit-motion-*` duplicates as aliases.
- Replace the three `350ms` canvas durations with tokens.
- Universalize pointer-down press feedback across all pressables.

**Phase 2 — Origin-aware surfaces & hover gating**
- Make dropdowns, selects, menus, popovers, tooltips scale from their trigger (`transform-origin`).
- Tooltip "instant after first" behavior.
- Wrap all hover *motion* in `@media (hover: hover) and (pointer: fine)`.

**Phase 3 — Canvas performance & continuity**
- Move node positioning and the arrange glide from `left/top` to `transform`; add scoped `will-change`.
- Animate the properties-panel column width + coordinated `panBy` canvas shift.
- Raise node drag threshold to ~3–4px.

**Phase 4 — Materials, type migration & refined reduced-motion**
- Introduce glass on the canvas floating toolbar/palette + overlay chrome (with reduced-transparency
  and reduced-contrast fallbacks).
- Migrate `font-size` call sites onto the type scale, section by section.
- Refine the reduced-motion block to preserve comprehension fades.

**Phase 5 — Gesture polish (optional, delight tier)**
- Spring-based, drag-dismissible drawers/toasts with velocity handoff.
- Optional inertial canvas pan with momentum projection.
- Interruptible auto-arrange glide (`spring-move`).

Each phase ends with `npm run build` (tsc + bundles) plus the relevant GUI verifiers
(`verify:flow-designer`, `verify:instance-monitor`, `verify:reports`, `verify:canvas-perf`) and a
light/dark + reduced-motion pass.

---

## 14. Explicit "do NOT animate" list

These stay **instant** (no entrance/exit/scale motion) — feedback is limited to color/press/1:1 tracking:

- **Any keyboard-initiated action** — command/menu invocation, keyboard nav, shortcuts, Escape-to-close.
- **Sidebar nav item activation** and route *content* on frequent back-and-forth (the current per-nav
  page-fade, `AppShell.tsx:48`, should be reduced to opacity-only or removed for frequent routes).
- **Node/connector selection** — ring/stroke change only, no transition delay.
- **Live canvas pan & zoom during the gesture** — strictly 1:1 (already correct).
- **Node drop placement** — lands exactly where released, no momentum/bounce.
- **Table rows on sort/filter/paginate** — no per-row slides; at most a tbody opacity cross-fade.
- **Search/filter result updates** — instant; no layout animation per result.
- **Typing feedback in any field** — no animated affordances on keystroke.
- **Tab / sub-panel switches within a page** — instant content swap.
- **Toggles/checkboxes committing state** — instant state; the only motion is the toggle thumb itself.
- **Focus ring appearance** — appears immediately (no fade) so keyboard users track it precisely.

---

## Highest-impact improvements (summary — not yet implemented)

1. **Fix the `awkit-drawer-in` triple-definition** (`7393/7917/8502`) — a real latent bug making every
   drawer play the wrong motion. One-line-class-of fix, immediate correctness win.
2. **Consolidate the colliding spacing & radius scales** into one spine — removes silent inconsistency
   across the entire UI and unblocks everything else.
3. **Add the two missing easing curves + one spring set**, and make **dropdowns/menus/tooltips scale
   from their trigger** — the largest perceptible "polish" jump for the least code.
4. **Gate all 78 hover effects behind pointer capability** — the clearest accessibility gap given touch
   is a supported input.
5. **Move the canvas off `left/top` onto `transform`** — the highest-value performance change; keeps the
   signature surface smooth under heavy concurrent runs.
6. **Introduce a type scale with size-specific tracking/leading** — replaces 259 ad-hoc font sizes with a
   coherent hierarchy.

Together these turn an already-solid system into a *coherent* one: calm, instant, spatially honest, and
refined — a precision instrument that stays out of the way for the hundreds of daily interactions and
earns its motion only where motion explains something.
