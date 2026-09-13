# 05 — Cross-cutting patterns

The rules that hold across every page and every component: how a surface says *loading*, *empty*,
*broken*, *unsaved*, *unavailable* and *focused*; the motion spine; the accessibility floors already
implemented in code; and the icon system.

A redesign that restyles pages and components but breaks these patterns produces an inconsistent
product. **These are the contracts to preserve.** Everything below was read out of source at commit
`28fb9fb` — nothing here is aspirational.

> One caveat on sources: `docs/ui-design-and-motion-direction.md` is a **proposal** document whose
> "current state" columns predate the code. Much of what it proposes has since shipped
> (`--awkit-dur-press`, `--awkit-ease-in-out`, `--awkit-ease-drawer`, `prefers-reduced-transparency`,
> `prefers-contrast`, the refined reduced-motion allow-list). This file records the **implemented**
> state; where the two disagree, the stylesheet wins.

---

## 1. The seven state patterns

Every data-bearing surface in the product moves through the same states. There is no single
"state machine" component — instead there are **three parallel kits** that implement the same
vocabulary, and a redesign must keep all three in step.

| Kit | Used by | Loading | Empty | Error/notice |
|---|---|---|---|---|
| **Shared** | Dashboard, libraries, monitors, reports | `SkeletonCard`, `MetricCard loading` | `EmptyState` | `AvailabilityNotice`, `Toast` |
| **Admin** | The six Administration pages | `AdminLoading` | `AdminEmpty` | `AdminBanner` |
| **Table** | Any `DataTable` surface | (host-provided) | `TableEmptyState` | (host-provided) |

They are **not unified today** — see the `MetricTone` divergence noted in `04-components.md`
(`shared/MetricCard` has four tones, `admin/AdminUi` has five and a different set). Unifying them is
a legitimate redesign goal; silently dropping one is not.

---

### 1.1 Loading

Three distinct treatments, chosen by how much layout is already known:

**Skeleton — layout is known.** `SkeletonCard` renders a shimmering placeholder in the shape of the
eventual content, so the page does not reflow when data lands.

```css
.awkit-skeleton-line, .awkit-skeleton-block, .awkit-skeleton-title {
  background: linear-gradient(90deg,
    var(--awkit-surface-inset) 25%, var(--awkit-surface-soft) 37%, var(--awkit-surface-inset) 63%);
  background-size: 400% 100%;
  animation: awkit-shimmer 1.4s ease infinite;
  border-radius: var(--radius-xs);
}
.awkit-skeleton-line  { height: 12px; }
.awkit-skeleton-title { height: 16px; width: 55%; }
.awkit-skeleton-block { height: 96px; }   /* the `variant="chart"` block */
```

`global.css:8475-8513`. The shimmer is a **background-position** animation, which the reduced-motion
block reduces to `0.001ms` — it stops without the placeholder disappearing. `MetricCard` takes
`loading?: boolean` and swaps its own content for the same treatment.

**Spinner — layout is not known.** `@keyframes awkit-spinner-rotate` (`global.css:10119`) driven at
`linear` in four places: `.spin` at `1s` (`:7103`), two canvas/report surfaces at `0.9s` / `900ms`
(`:8686`, `:10030`), and `.awkit-admin-spin` at `0.9s` in `--awkit-accent` (`:12508`). The admin
spinner is explicitly killed under reduced motion (`:12509` — `animation: none`).

**Announced loading — the user is waiting on the app, not on a list.** Two surfaces do this:

```
SecurityGate.tsx:266   <div className="awkit-login-loading" role="status" aria-live="polite">
AdminUi.tsx:221        <div className="awkit-admin-state"  role="status" aria-live="polite">
```

**Rule to preserve:** a skeleton is *silent* (visual only), an announced loading state is
`role="status" aria-live="polite"`. Do not add `aria-live` to skeletons — a grid of eight would
announce eight times.

---

### 1.2 Empty

Empty is a first-class designed state, not an absence. `EmptyState` distinguishes four things:

| Prop | Purpose |
|---|---|
| `title` | What is not here |
| `hint` | *"Guidance on how to populate this surface"* (source comment) |
| `icon` | Category glyph |
| `action` | *"Optional call-to-action (e.g. \"Run a workflow\")"* |
| `compact` | *"Compact variant for inline/section empties"* |

`EmptyState.tsx:20` renders `div.awkit-empty-state[.is-compact]` with **`role="status"`**.

**The one deliberate piece of delight in the product.** Empty states get a four-step staggered rise
— and nothing else does:

```css
/* global.css:8550-8593 */
.awkit-empty-state-icon, .awkit-empty-state strong,
.awkit-empty-state-hint, .awkit-empty-state-action {
  animation: awkit-empty-rise var(--awkit-dur-med) var(--awkit-ease-out) both;
}
.awkit-empty-state-icon   { animation-delay:   0ms; }
.awkit-empty-state strong { animation-delay:  45ms; }
.awkit-empty-state-hint   { animation-delay:  90ms; }
.awkit-empty-state-action { animation-delay: 135ms; }

@keyframes awkit-empty-rise { from { opacity: 0; transform: translateY(6px); } to { … } }
```

45ms per step, 135ms total, `both` fill so each child holds its pre-enter opacity during its delay
instead of flashing. **Removed entirely under reduced motion** (`animation: none`, `:8585`) — not
shortened, removed.

The header comment states the reasoning, and it is the product's stated position on where motion
budget goes: *"Empty states are the 'rare / first-time' tier that may spend a little delight
budget."*

**The counter-example is load-bearing.** Grid cards used to have the same entrance and it was
deliberately deleted:

```css
/* global.css:1043 */
/* Card-grid entrance removed (plans/007): grid children previously rose + faded in a stagger on every
   navigation to a grid page (tens/day). Replaying entrance motion on frequent revisits is friction, not
   delight — cards now render instantly; the light page-level opacity fade (.main-surface-animated) stays. */
```

**Do not re-add entrance motion to frequently revisited surfaces.** The interaction-frequency test —
*would a user see this animation tens of times a day?* — is the deciding rule.

**Empty vs. filtered-empty.** `TableEmptyState` takes a `filtered` boolean and must keep saying two
different things: *"nothing exists yet"* (offer the create action) versus *"nothing matches your
filters"* (offer to clear them). Collapsing these into one message is a regression.

---

### 1.3 Error, warning and notice

Four severities, expressed through **soft-background + matching border + matching text**, never
background alone:

| Class | Background | Border | Text |
|---|---|---|---|
| `.settings-banner.success` | `--awkit-success-soft` | `--awkit-success-muted` | `--awkit-success` |
| `.settings-banner.error` | `--awkit-danger-soft` | `--awkit-danger-muted` | `--awkit-danger` |
| `.awkit-availability-notice` | `--awkit-warning-soft` | `color-mix(in srgb, var(--awkit-warning) 30%, transparent)` | — |
| `.awkit-availability-notice.awkit-backpressure` | `--awkit-danger-soft` | `color-mix(… danger 30% …)` | `--awkit-danger` |

`global.css:4728-4745`, `:9287-9308`. Banner geometry: `1px solid` border, `--radius-sm`,
`--text-sm`, `padding: 10px 12px`.

Inline field-level messages are a separate, lighter family — `--text-xs`, block, sitting directly
under the control:

| Class | Colour | Weight |
|---|---|---|
| `.form-message` | `--awkit-text-secondary` | normal |
| `.form-message.error` | `--awkit-danger` | semibold |
| `.form-message.warn` | `--awkit-warning` | semibold |
| `.form-message.ok-text` | `--awkit-success` | normal |
| `.form-message.success` | **`--awkit-success-text`** | normal |
| `.error-text` (standalone) | `--awkit-danger` | semibold |

`global.css:1921`, `:4814`, `:4869`, `:12634`, `:2896`.

**Note `.form-message.success` uses `--awkit-success-text`, not `--awkit-success`** — and it is
re-declared identically for `[data-theme="dark"]` at `:12635`. That is constraint 10 in the
[README](README.md#10-accessibility-floors-already-in-the-code) in force: `--awkit-success` at
`#14a46c` is 3.20:1 on white and fails AA for text. Any new palette needs both tokens, and the
text-safe one must actually be text-safe.

The Administration kit adds one explicitly-noted rule against parallel class systems:

```
AdminUi.tsx:150
// `warning` reuses the existing `.form-message.warn` styling rather than introducing a parallel class.
```

#### `role="alert"` vs `role="status"`

This distinction is applied deliberately across ~40 sites and must survive a redesign, because it
decides whether a screen reader interrupts the user.

**`role="alert"`** — the user's action just failed, they need to know now:
`form-message error` in every auth screen (`LoginScreen:174`, `ForcedPasswordChange:94,99`,
`FirstRunSetup:118,123`, `RecoveryPasswordReset:99,100`, `ReauthDialog:69`), invalid input
(`AccentColorSettings:176,194,196`, `BrandingSettings:147`, `SemanticIndexSettings:81,86`),
`SecurityUnavailable:15`, `Settings:527,1057`, `ImplementationRoadmap:118`, `ErrorBoundary:48`,
`Recorder:1023`, `OracleNodeSection:106`, and the one canvas case that means *your step is
unrunnable*: `FlowNodePropertiesPanel:930` (`data-testid="drag-target-missing"`).

**`role="status"`** — ambient state the user may read at their own pace: `EmptyState:20`,
`Toast:74`, `AvailabilityNotice` (`ReportsChrome:53`, `ReportsServer:58`),
`PasswordField:94,105` (strength meter and caps-lock hint, both `aria-live="polite"`),
`FlowChartDesigner:1338` / `ScenarioBuilder:1372` (`.editor-command-state`, each with an
`aria-label` — "Flow state" / "Workflow state"), `Recorder:597,727,732,744,946,1121`,
`FlowNodePropertiesPanel:560,675,689,756`, and the licence-readiness warnings
(`LicenseIssuerPage:308,383` — `.form-message.warn` with `role="status"`, deliberately *not* alert).

One surface picks at runtime:

```tsx
// Settings.tsx:521
aria-live={banner.type === "error" ? "assertive" : "polite"}
```

Two regions are live containers rather than live messages — content streams into them:
`Recorder.tsx:1033` (`.recorder-timeline`, actions appear as the user records) and
`FlowNodePropertiesPanel.tsx:552` (`aria-label="Step validation"`,
`data-testid="node-validation-summary"`), plus `Recorder.tsx:701`.

**Crash is its own state.** `ErrorBoundary` is the only `class` component in the renderer; it renders
`div.error-boundary[role="alert"]` and is keyed by `activeRouteId` in `AppShell`, so navigating away
resets it. Its stylesheet region is labelled *"Renderer crash fallback (ErrorBoundary) — replaces the
blank white screen"* (`global.css:4356`) — that is the requirement: a crash must never be a blank
window.

**Degraded is not error.** `SemanticResultList` treats `degraded` as *a success with a caveat* — a
`role="status"` `.form-message` (`:64`) beside real results, not the `role="alert"` error branch
(`:32`). Do not merge them.

**Never leak internals.** The security layer's user-facing fallback is a single fixed string:
`GENERIC_MESSAGE = "Something went wrong. Please contact your system administrator."` Error surfaces
must be designed to look right holding a deliberately uninformative message.

---

### 1.4 Dirty / unsaved

A three-link chain, and all three links are visible design:

1. A page publishes `PageChrome = { actions: PageAction[]; dirty: boolean }` through
   `PageChromeContext`.
2. `TopHeader` renders `.header-status-chip` — "Unsaved changes" — whenever `dirty` is true.
3. `App.tsx` intercepts navigation and shows `UnsavedChangesDialog` (Save / Discard / Cancel), with
   **Save enabled only if the page published an action whose `id === "save"`**.

So "dirty" is not decoration: it changes what navigation does. The chip and the dialog must remain
recognisably the same claim.

---

### 1.5 Disabled — and the permission-denial affordance

The base rule is one declaration, and it carries its own comment:

```css
/* global.css:401 — Disabled: the design system's documented pairing is opacity .40 with a
   not-allowed cursor. */
button:disabled { cursor: not-allowed; opacity: 0.4; }
```

`opacity: 0.4` + `cursor: not-allowed` recurs verbatim at `:3994`, `:4249`, `:5266`, `:5871`,
`:7680`, `:8004`, `:9760`, `:11776`, `:12008`, `:12054`, `:12530`. **A new design system must supply
a disabled treatment that works at that ratio on every surface token** — 0.4 opacity over
`--awkit-surface-inset` is the worst case.

**Disabled is the product's main way of expressing "you lack permission", and it always carries a
reason.** Three components make this explicit in their prop contracts:

```ts
// NodeOptionsMenu.tsx — NodeMenuItem
/** When set, the item renders disabled (e.g. the acting role lacks the permission) with `title` as the reason. */
disabled?: boolean; title?: string;

// WorkflowRunCard.tsx
/** When set, the Run button is disabled (e.g. the acting role lacks the Execute Workflows permission). */
runDisabled?: boolean;
runDisabledReason?: string;

// WorkflowRunCard.tsx
/** Reason the workflow can't run (invalid/inactive); empty when runnable. */
blockReason: string;
```

**A disabled control without a reachable reason is a defect, not a style choice.** The reason is
currently delivered via `title`, which is not keyboard-reachable — improving that is a legitimate
redesign contribution; removing the reason is not.

Adjacent but different: `.awkit-login-soon` marks a *not-yet-available* affordance rather than a
denied one, and the login marketing panel carries a `demo` label by design.

---

### 1.6 Focus

One global rule, one token, no exceptions:

```css
/* global.css:9493 — "Re-skin foundation: global focus ring, themed scrollbars, selection color." */
:focus-visible {
  outline: none;
  box-shadow: var(--awkit-focus-ring);
  border-radius: var(--radius-xs);
}
```

```css
/* global.css:255 */
--awkit-focus-ring: 0 0 0 2px var(--awkit-surface), 0 0 0 4px rgba(var(--awkit-accent-rgb), 0.7);
```

Two rings: an inner **surface-coloured** ring that separates the outer ring from the control, then a
4px accent ring at 70% alpha. Because the outer ring reads `--awkit-accent-rgb`, a user-chosen accent
keeps a visible ring automatically. **If a new design system changes the ring, it must stay a
function of `--awkit-accent-rgb` and must keep the inner separator ring** — a single flat ring
disappears against same-coloured controls.

~25 components restate `:focus-visible { outline: none; box-shadow: var(--awkit-focus-ring) }`
locally where a container would otherwise clip it. `outline: none` **must** always be paired.

#### The modal focus contract

`useModalFocusContract(onCancel, active)` is the four-point contract every `aria-modal="true"`
surface implements, and its header comment records why it exists:

```
1. focus moves INTO the dialog on open,
2. Tab / Shift+Tab cycle within it,
3. Escape dismisses it,
4. focus RETURNS to the opener on close.

AWKIT-A11Y-001: this contract has been re-implemented per modal four times, and each time a new
surface shipped without it while a sibling claimed otherwise.
```

Implementation details a redesign must not break: the opener is captured **at open time, not at
hook-creation time**, so a long-lived page hosting a conditional dialog returns focus correctly;
focus returns only if the opener `isConnected`; the focusable query excludes `[disabled]`,
`[tabindex="-1"]` and `[hidden]`. **Every new modal, drawer or popover uses this hook** — do not
hand-roll a trap.

---

### 1.7 Live / running

Motion is the product's signal for *something is happening right now*, and it is rationed:

- `StatusBadge` takes `pulse?: boolean` with the source comment *"Adds a soft pulse; use only for
  genuinely live/critical states."* Six tones × pulse = 12 badge states.
- The status bar polls `executions.runtimeStatus()` every **2000 ms** — the ambient health signal.
- Connector direction animates on the canvas (`.awkit-loop-direction-path` dash march,
  `.awkit-loop-indicator-sweep`, `.awkit-edge-add.is-loop-exit-affordance::after`).
- `AnimatedCounter` ramps numbers over `--awkit-dur-slow` by default.

All four have reduced-motion fallbacks that **preserve the meaning** rather than blanking the
element — see §2.4.

---

## 2. The motion spine

### 2.1 Durations

```css
/* global.css:257 — "motion — one canonical spine; --awkit-motion-* kept as back-compat aliases
   (do not add new uses)" */
--awkit-dur-press:  90ms;   /* pointer-down feedback */
--awkit-dur-fast:  120ms;   /* hover, colour, small state changes */
--awkit-dur-med:   180ms;   /* dropdowns, selects, page-content fade */
--awkit-dur-panel: 240ms;   /* side panels, node palette */
--awkit-dur-slow:  260ms;   /* drawers, larger reveals */
--awkit-dur-modal: 300ms;   /* modal settle — the hard ceiling for UI */
--awkit-dur-layout: 350ms;  /* programmatic canvas layout only */
--awkit-delay-toolbar: 150ms;
```

**300ms is the stated ceiling for UI motion.** `--awkit-dur-layout` at 350ms is the single
documented exception and is scoped to programmatic canvas layout. The `--awkit-motion-*` tokens are
byte-identical back-compat aliases — **do not add new uses**, and a redesign should map them, not
extend them.

### 2.2 Easing

```css
--awkit-ease-out:    cubic-bezier(0.22, 1, 0.36, 1);      /* entering / exiting UI */
--awkit-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);     /* moving / morphing on screen */
--awkit-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);      /* iOS-like drawer / sheet curve */
--awkit-ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);    /* CSS approximation of the springs */
```

The three-way split is semantic, not decorative: **enter/exit** uses `ease-out` (starts fast, feels
instant), **on-screen movement** uses `ease-in-out` (natural accel/decel), **drawers** get their own
settle. `ease-in` is not used for UI entrances or exits.

`--awkit-ease-spring` carries an explicit warning in the stylesheet:

```css
/* CSS approximation of the design system's entry springs (node stiffness 380/damping 30, menu
   420/32). CSS has no spring timing function; this is the closest single curve with a small,
   controlled overshoot. Anything using it must still be neutralised under reduced motion. */
```

### 2.3 The JS motion layer

`app/renderer/lib/motion.ts` is the **single source of truth for framer-motion values** — the
renderer does depend on `framer-motion`, and hand-writing spring numbers in components is explicitly
disallowed by its header:

```ts
export const nodeSpring    = { type: "spring", stiffness: 380, damping: 30 };  // node mount / layout settle
export const menuSpring    = { type: "spring", stiffness: 420, damping: 32 };  // picker / context menu
export const drawerSpring  = { type: "spring", stiffness: 300, damping: 30 };  // 400px config drawer
export const toolbarSpring = { type: "spring", stiffness: 260, damping: 26 };  // floating toolbar
export const controlSpring = { type: "spring", stiffness: 500, damping: 32 };  // buttons, toggles, small chrome

export const easeBase = { duration: 0.18, ease: [0.22, 1, 0.36, 1] };  // == --awkit-dur-med
export const easeFast = { duration: 0.12, ease: [0.22, 1, 0.36, 1] };  // == --awkit-dur-fast
export const easeSlow = { duration: 0.26, ease: [0.22, 1, 0.36, 1] };  // == --awkit-dur-slow
export const instant  = { duration: 0 };

export const nodeEnter: Variants = {
  hidden:  { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: nodeSpring }
};

export function motionSafe<T extends Transition>(reduced: boolean | null, transition: T): Transition;
export const GLIDE_MAX_NODES = 120;
export function useFlowGlide(durationMs = 350): { animating: boolean; arm: () => void };
```

The tweens are numerically identical to the CSS duration tokens *on purpose* — the header states
that CSS transitions and framer-motion animations must feel identical. **A redesign that changes a
duration token must change the matching tween here, or the two layers drift apart.**

`useFlowGlide` drives the `.flow-animating` class for programmatic canvas layout (auto-arrange /
load). Above `GLIDE_MAX_NODES = 120` the glide is skipped and nodes snap — *"to avoid layout thrash
on large graphs."* Keep the cap.

> **Two `usePrefersReducedMotion` exist.** `lib/motion.ts:86` re-exports framer-motion's
> `useReducedMotion`; `components/shared/usePrefersReducedMotion.ts` is a standalone `matchMedia`
> implementation with its own `change` subscription. Both are live. This is a real duplication worth
> flagging, not a documentation error.

### 2.4 Reduced motion — *gentler, not nothing*

The global block is placed last in the stylesheet so it wins the cascade:

```css
/* global.css:10143 — "Global reduced-motion honor (OS 'reduce motion'). Neutralizes CSS animation
   and transitions everywhere; JS animations additionally check usePrefersReducedMotion().
   Placed last so it wins the cascade." */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    /* Reduced motion = fewer/gentler, not none: movement snaps (transform/left/top/width/height are
       NOT in the allow-list), while opacity/color/shadow fades that aid comprehension are preserved. */
    transition-property: opacity, color, background-color, border-color, box-shadow, fill, stroke !important;
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
}
```

**This is the single most important rule in the file to understand before proposing motion.** The
allow-list is the design contract: **colour, opacity, shadow, fill and stroke still transition;
movement does not.** A new design system may add to the allow-list only if the added property does
not move anything.

Eleven surfaces then opt out further, because the blanket rule is not enough for them:

| Surface | Reduced-motion behaviour | Line |
|---|---|---|
| `.editor-command-icon-button` | `transition: none` | `:4353` |
| `.recorder-locator-mode-option span` | `transition: none` | `:7570` |
| **Empty-state stagger** | `animation: none` — removed, not shortened | `:8585` |
| `.awkit-filter-toggle` | `transition: none` | `:8946` |
| `.awkit-loop-direction-path` | `animation: none !important` + **frozen at `stroke-dasharray: 12 88; stroke-dashoffset: -76`** | `:10641` |
| `.awkit-edge-add.is-loop-exit-affordance::after` | `animation: none !important; opacity: 0.3; transform: scale(1.18)` | `:10824` |
| `.awkit-step-node`, `.awkit-flow-canvas.flow-animating .awkit-flow-node` | `transition: none` | `:10998` |
| Login screen (`.awkit-login-screen`, `-spin`, `-run-spot`, `-run-scanline`, …) | ambient motion off | `:12234` |
| `.awkit-admin-spin` | `animation: none` | `:12509` |
| `.awkit-admin-table tbody tr` | `transition: none` | `:12667` |
| `.awkit-loop-indicator-sweep` | `animation: none !important; transform: rotate(-32deg)` | `LoopEdge.css:23` |

**Notice the pattern in the canvas rows: they freeze at a *meaningful* pose, not at frame zero.** The
loop dash stops mid-march so direction is still readable; the sweep stops at `-32deg`; the loop-exit
affordance settles at `scale(1.18)` and 30% opacity. Any replacement animation needs the same
treatment — **a static fallback that still communicates the thing the motion communicated.**

### 2.5 Press feedback

Universal, on every pressable, and it uses the independent `translate` property specifically so it
composes:

```css
/* global.css:407 */
button, [role="button"] { transition: translate var(--awkit-dur-press) var(--awkit-ease-out); }

button:not(:disabled):not([role="switch"]):active,
[role="button"]:not([aria-disabled="true"]):not([role="switch"]):active { translate: 0 1px; }
```

The comment explains all three decisions: `translate` rather than `transform` *"so it composes with
transform-based positioning (e.g. `.awkit-edge-add` centering) and hover transforms instead of
clobbering them"*; toggles opt out because *"only the thumb moves"*; and it is *"neutralized to an
instant nudge under the reduced-motion block"* (`translate` is not in the allow-list, so it snaps).

If a redesign swaps `translateY(1px)` for `scale(0.97)`, it must apply **universally** and keep the
`[role="switch"]` and disabled exclusions.

### 2.6 Hover gating

Hover *motion* is gated behind `@media (hover: hover) and (pointer: fine)` in twelve places —
`:534`, `:2536`, `:5625`, `:5788`, `:6993`, `:9480`, `:9976`, `:10469`, `:10726`, `:10819`,
`:10850`, `:12181` — so lifts, scales and shadow changes never fire from a touch tap. Essential
hover affordances (cursor changes, tooltip triggers) stay ungated. Preserve the split.

### 2.7 What already animates in the shell

- `.main-surface-animated` — a mount cross-fade on route change, **excluded on the four canvas
  routes** because a mount transform perturbs coordinate measurement (README constraint 7).
- `.app-shell` animates `grid-template-columns` for the sidebar collapse (`240px minmax(0,1fr)` →
  collapsed), with a note that Chromium/Electron supports this and that the reduced-motion block
  neutralises it.
- `.awkit-step-node` / canvas nodes: `transition: transform var(--awkit-dur-slow)
  var(--awkit-ease-in-out); will-change: transform` (`:10994`).
- The floating toolbar rises after `--awkit-delay-toolbar: 150ms`.

---

## 3. Accessibility contracts already in code

| Contract | Where | Rule |
|---|---|---|
| **Global focus ring** | `global.css:9493` | Every `outline: none` is paired with `box-shadow: var(--awkit-focus-ring)`; the ring resolves through `--awkit-accent-rgb` |
| **Modal focus** | `useModalFocusContract` | Focus in, Tab cycle, Escape, focus returns to opener |
| **Live-region discipline** | ~40 sites | `role="alert"` for failed actions, `role="status"` for ambient state, `aria-live="assertive"` only for errors (`Settings:521`) |
| **Status never colour-only** | `StatusBadge`, `STATUS_META`, Admin kit | Icon **and** text always accompany the tone. The Admin kit states this in its file header |
| **Text contrast** | `--awkit-success-text` | `--awkit-success` (#14a46c, 3.20:1 on white) is decorative; text uses `--awkit-success-text` (#15803d) |
| **Reduced motion** | `global.css:10148` | Allow-list preserves comprehension-bearing fades; JS motion additionally checks `usePrefersReducedMotion()` |
| **Reduced transparency** | `global.css:10164` | `.canvas-item-picker` → `--awkit-surface-raised`, `.canvas-zoom-control` → `--awkit-surface`, both `backdrop-filter: none` |
| **High contrast** | `global.css:10177` | Both glass surfaces → `--awkit-surface` + `--awkit-border-strong`, no blur |
| **Hover gating** | 12 media blocks | Hover *motion* requires a fine pointer |
| **Collapsed nav** | `LeftNavigation` | Icon-only rows carry explicit `aria-label`; expanded rows are named by visible text that e2e helpers match |
| **Grouped toggles** | `TimeRangeSelector` | `div[role="group"][aria-label="Time range"]` with `aria-pressed` on each button, plus `.is-active` |
| **Semantic lists** | `AdminMetrics` | `role="list"` / `role="listitem"` where a visual grid replaces a list |
| **Visually hidden text** | `.sr-only` (`:12271`) | Standard `clip-path: inset(50%)` + 1×1px pattern — the accessible-name escape hatch |
| **Named state readouts** | designers | `.editor-command-state` carries `role="status"` **and** an `aria-label` ("Flow state" / "Workflow state") so the region is identifiable |
| **Chart legibility** | reports | Series tokens are assigned **by data category**, never by state, so a category keeps its colour across every chart |
| **Canvas legibility** | `FlowCanvas` | `ZOOM_MIN_PERCENT = 25` — node text must stay legible at 25% |

Two glass surfaces exist in the entire product (`.canvas-item-picker`, `.canvas-zoom-control`) and
the a11y fallbacks are **scoped to exactly those two** — the stylesheet comment says *"never tables /
forms / the properties inspector."* If a redesign glasses more surfaces, each new one needs matching
`prefers-reduced-transparency` and `prefers-contrast` fallbacks.

---

## 4. Icon system

**One library — `lucide-react`, bundled.** No icon fonts, no sprite sheets, no remote SVG. The only
hand-authored SVG is: the brand marks (`assets/brand/AwkitBrandMarks.tsx`), the inline
`SpecterAppIcon` in `LeftNavigation.tsx`, the window controls, and every chart in
`components/reports/`.

Sizes are set per call site as a `size` prop, and they are consistent by role:

| Context | Size | Notes |
|---|---|---|
| Navigation rows | 17px | The densest, most-used surface |
| Nav collapse button | 16px | |
| Nav group chevron | 14px | |
| Nav workspace mark | 15px | |
| Header back button | 18px | `ArrowLeft` |
| Report refresh | 16px | |
| Brand mark (title bar) | 16px | `AwkitBrandMarkSize = 16 \| 38` — **only two sizes exist** |
| Brand mark (login) | 38px | |
| Admin kit | 12 / 14 / 16 / 20 / 22px | Stroke widths 1.8 / 2.2 / 2.4 at the small end |
| App icon | 32px default | `SpecterAppIcon({ size = 32 })` |
| Window controls | 10px stroke box | Inline SVG, deliberately not an icon-library dependency, so the glyphs match Windows metrics exactly |

**The small end is where a redesign breaks.** At 12-14px with stroke width 1.8-2.4, a lighter icon
set will disappear. Check the Admin kit and the nav chevron before committing to a new stroke weight.

Icons are never the sole carrier of meaning (§3). `StatusBadge` pairs icon + label; the Admin
`STATUS_META` map covers **21 recognised statuses across 13 icons and 5 tones** — that table is the
real breadth requirement for any new status iconography.

---

## 5. Density and geometry constants

Values a redesign inherits whether or not it intends to:

| Constant | Value | Source |
|---|---|---|
| Title bar / header / status bar | 36 / 64 / 32px → `--shell-chrome` **132px** | `01-app-shell.md` |
| Sidebar | `240px` expanded | `.app-shell` grid |
| Properties drawer | `--awkit-drawer-width: 440px` | `DesignerCanvasLayout` |
| Action bar height | measured at runtime → `--awkit-action-bar-h` | `ResizeObserver` |
| Radius ceiling | 16px | `02-design-tokens.md` |
| Node default size | 320 × 96 (both designers) | `flowNodeRegistry` |
| Canvas zoom range | 25% – 200% | `FlowCanvas` |
| Drag-to-connect threshold | 4px | `CONNECT_THRESHOLD` |
| Max branch connectors | 2 | `connectorStyle.ts` |
| Glide node cap | 120 | `motion.ts` |
| Table page sizes | 10 / 25 / 50 / 100 | `TableUI` |
| Status bar poll | 2000ms | `StatusBar` |
| Empty-state stagger | 45ms × 4 steps | `global.css:8561` |
| No-value glyph | `"—"` (em dash) | `statusTone.ts` |

Nothing scrolls at the application level (`html, body, #root { height: 100%; overflow: hidden }`) —
every page owns its own scroll container and subtracts `--shell-chrome`. A redesign that changes any
of the three chrome heights changes every page's available height at once.

---

## 6. Redesign checklist

Run a proposal through this before calling it complete:

1. **Every token has a new value** — including both themes independently, the 12 accent and 9
   gradient tokens, and the `[data-accent-mode="gradient"]` layer.
2. **The disabled pairing survives** at `opacity: 0.4` + `not-allowed` on every surface token.
3. **The focus ring still resolves through `--awkit-accent-rgb`** and keeps its inner separator ring.
4. **`--awkit-success-text` still exists separately** from `--awkit-success`, and passes AA on both
   themes' surfaces.
5. **Six `StatusBadge` tones × pulse, six `UserAvatar` tones, 5 admin metric tones + 4 shared metric
   tones, 5 status tones over 21 statuses** all have a defined treatment (or are explicitly and
   deliberately unified).
6. **Loading has three answers** — skeleton, spinner, announced — and skeletons stay silent.
7. **Empty keeps its four slots** (title / hint / icon / action) and its compact variant; filtered-
   empty stays distinguishable from never-populated.
8. **Errors keep `alert` vs `status`**, and inline messages stay a lighter family than banners.
9. **Motion respects the 300ms ceiling**, uses the three semantic easings, and adds no entrance
   animation to a surface a user sees tens of times a day.
10. **Every animation has a reduced-motion fallback that still communicates** — frozen at a
    meaningful pose, not blanked.
11. **CSS duration tokens and `lib/motion.ts` tweens stay numerically aligned.**
12. **Icons still read at 12px / stroke 1.8**, and no status is expressed by colour alone.
13. **New glass surfaces ship with `prefers-reduced-transparency` and `prefers-contrast` fallbacks.**
14. **Canvas ancestors gain no transforms, scale animations or layout shifts**, and the four canvas
    routes stay out of the route-mount fade.
15. **No class hook is renamed** without checking `data-testid` attributes and end-to-end helpers.

---

*Back to the [index](README.md) · previous: [`04-components.md`](04-components.md)*
