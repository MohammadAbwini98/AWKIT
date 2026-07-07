# 02 — Enhanced Design System & Motion (AWKIT)

Enhances the original Prompt 02 with the real CSS architecture and an explicit token plan.

## Current reality (verified)

- One stylesheet: `app/renderer/styles/global.css` (~4,980 lines, plain CSS, component classes
  like `.app-shell`, `.top-header`, `.left-navigation`, `.metric-card`, `.workflow-card-grid`).
- Existing tokens (keep, extend — do not rename):
  `--space-1..5` (4/8/12/16/24px), `--radius-sm` (6px), `--radius-md` (8px), `--radius-pill`,
  `--header-height` (60px), `--status-height` (32px), `--shell-chrome`.
- Colors are currently hard-coded hex values throughout (`#f4f6f9` bg, `#ffffff` surfaces,
  `#dde3ed` borders, `#172033` text). The tokenization pass converts *new and touched* rules to
  tokens; a full-file recolor is allowed only as a mechanical, reviewable step.
- Shell: `AppShell.tsx` (grid: 60px header / content / 32px status bar), `LeftNavigation.tsx`
  (collapsible, groups Build/Data/Run/System), `TopHeader.tsx`, `StatusBar.tsx`,
  `RightPropertiesPanel.tsx`, `DesignerCanvasLayout.tsx`.
- Existing primitives to reuse/extend (do not duplicate): `MetricCard.tsx` (label/value/detail/icon),
  `Toast.tsx`, `ConfirmDialog.tsx`, `UnsavedChangesDialog.tsx`, `SearchableSelect.tsx`,
  `ConnectorStyleEditor.tsx`. **Missing** (to create): `StatusBadge`, `SectionHeader`,
  `SkeletonCard`, `EmptyState`, `TrendDelta`, `AnimatedCounter`, gauge/chart primitives.
- Font: Inter with system-ui fallback stack — already local/system, keep (no remote fonts).

## Theme decision

Light-first (matches current app + the pack's reference palette). All new colors are defined as
tokens so a dark theme later is a token-swap under a `[data-theme="dark"]` root attribute — but the
dark theme itself is **out of scope** for this initiative unless the user requests it.

## Token plan (add near the top of `global.css`)

```css
:root {
  /* surfaces */
  --awkit-bg: #f0f1f5;
  --awkit-surface: #ffffff;
  --awkit-surface-soft: #f7f7fa;
  --awkit-surface-inset: #ececf1;
  --awkit-border: rgba(18, 18, 18, 0.08);
  --awkit-border-strong: rgba(18, 18, 18, 0.14);

  /* text */
  --awkit-text: #121212;
  --awkit-text-secondary: #4d4855;
  --awkit-text-muted: #5c5c5e;

  /* accents (from the reference palette) */
  --awkit-purple: #5b3e91;
  --awkit-purple-deep: #1d1060;
  --awkit-purple-soft: #69587e;
  --awkit-blue: #3563f8;
  --awkit-blue-deep: #0b1ee6;

  /* status */
  --awkit-success: #1f8a4c;
  --awkit-warning: #b97a1a;
  --awkit-danger: #c03434;
  --awkit-info: var(--awkit-blue);

  /* gauge/pressure bands (06) */
  --awkit-band-normal: var(--awkit-success);
  --awkit-band-warning: var(--awkit-warning);
  --awkit-band-high: var(--awkit-danger);

  /* depth & radius (extends existing --radius-*) */
  --awkit-radius-card: 14px;
  --awkit-radius-panel: 18px;
  --awkit-shadow-card: 0 8px 28px rgba(18, 18, 18, 0.07);
  --awkit-shadow-float: 0 12px 40px rgba(18, 18, 18, 0.12);

  /* motion */
  --awkit-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --awkit-dur-fast: 120ms;
  --awkit-dur-med: 220ms;
  --awkit-dur-slow: 360ms;

  /* z-layers */
  --awkit-z-panel: 20;
  --awkit-z-toolbar: 30;
  --awkit-z-drawer: 40;
  --awkit-z-modal: 50;
  --awkit-z-toast: 60;
}
```

Contrast rule: text on surfaces must meet WCAG AA (4.5:1 body, 3:1 large/labels). Verify muted
text (`--awkit-text-muted` on `--awkit-surface-soft`) explicitly.

## Component styling rules

- Cards: `--awkit-surface`, `--awkit-radius-card`, `--awkit-shadow-card`, 1px `--awkit-border`;
  hover lifts shadow to `--awkit-shadow-float` + 1–2px translateY, `--awkit-dur-fast`.
- Panels (properties/inspector/drawers): `--awkit-radius-panel`, slide+fade enter/exit
  (`--awkit-dur-med`), never lose form state on collapse (existing rule — panel collapse must not
  reset unsaved values; verified pattern in `FlowChartDesigner.tsx` empty-canvas collapse).
- Status colors never carry meaning alone — pair with icon/label (`StatusBadge`).
- Glow/gradients: restrained; only on primary metric emphases and gauge arcs, never on text.
- Do not restyle the React Flow resize/handle CSS that enforces "resize handles only on selected
  node" (`.react-flow__node:not(.selected) .react-flow__resize-control { display:none }`).

## New shared primitives (in `app/renderer/components/shared/` unless noted)

| Component | Notes |
|---|---|
| `StatusBadge` | status → token color + icon + label; reuse across instances/reports/nodes |
| `SectionHeader` | title + description + optional actions; replaces ad-hoc `.section-heading` uses gradually |
| `SkeletonCard` | shimmer via CSS keyframes; respects reduced motion (static tint) |
| `EmptyState` | icon + title + hint + optional action; used by every report page |
| `TrendDelta` | ▲/▼ + percent + accessible label |
| `AnimatedCounter` | rAF count-up, duration `--awkit-dur-slow`; renders final value immediately under reduced motion |
| `components/reports/MetricSparkline` | inline SVG polyline, ≤120 points |
| `components/reports/BarChart`, `DonutChart`, `RadialGauge` | hand-rolled SVG; see 05/06 |

Extend (don't replace) `MetricCard.tsx`: optional `trend?: ReactNode`, `tone?: "default"|"success"|"warning"|"danger"`,
`loading?: boolean` — existing call sites must keep working (props optional).

## Motion system

- CSS only (no framer-motion — RULES.md forbids new UI frameworks without instruction).
- Route/page content: fade+4px rise on mount (`--awkit-dur-med`), applied by a `.page-enter`
  class on the routed page container in `AppShell.tsx`.
- Sidebar collapse, panel expand/collapse: width/transform transitions (already partially present —
  align durations to tokens).
- Counters/gauges: JS-driven (rAF) but throttled; gauges animate needle/arc with CSS transform
  transitions on updated values.
- Skeleton shimmer: keyframed gradient.
- **Reduced motion:** a single global block —
  `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`
  plus JS checks (`matchMedia`) before starting rAF count-ups/needle sweeps.

## Performance rules

- Animate only `transform`/`opacity` (compositor-friendly); never `box-shadow` on large lists
  (use a pseudo-element opacity trick if a shadow must animate).
- No infinite animations on always-visible dashboards except explicitly-critical pulses.
- Charts cap rendered points (≤120 sparkline, ≤60 bars) — aggregation happens in the query layer.
- No layout thrash from the 1s/2s polls: memoize derived models; update DOM only on changed values.

## Accessibility requirements

- Keyboard focus rings preserved on all interactive elements (`:focus-visible`).
- `aria-label` on icon-only buttons (pattern already used in `LeftNavigation.tsx`).
- Charts/gauges get text equivalents (visually-hidden summary or adjacent value labels).
- Live regions: metric strips use `aria-live="polite"` sparingly (once per card group, not per value).

## Required UI states (every new surface)

Loading (skeleton) → Empty (EmptyState with guidance) → Error (message + retry) → Ready.
Live surfaces additionally: Stale (last-updated timestamp when polling fails) and
Partial (availability notice for missing process metrics — see 06).

## Verification for this phase

`npm run build`; manual dev-app walkthrough (shell loads, nav works, no blank route, no console
errors); `npm run verify:flow-designer` + `npm run verify:workflow-builder` if any shared CSS
touched the canvases; mapping/binding rows appended to 08.
