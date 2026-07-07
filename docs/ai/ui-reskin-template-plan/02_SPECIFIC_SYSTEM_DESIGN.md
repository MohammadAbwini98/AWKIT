# 02 — Specific System Design (AWKIT target spec)

**Visual identity:** premium, dark, calm. One violet→blue accent, deep near-black surfaces, hairline
borders, large radius, soft depth, restrained glow. Professional and legible first; "premium" comes
from consistency and motion, not noise.

## Layout model
Unchanged from today: `header (60px) / body / status bar (34px)`; body = `sidebar (248px, collapsible) | main`.
Canvas routes keep their special no-transform handling. Content max width is fluid; page padding 24–28px.

## App shell anatomy
- **Backdrop:** `--awkit-bg` + two fixed radial accent glows (behind everything, `background-attachment:fixed`).
- Header, sidebar, status bar are **glass** (`--awkit-glass` + `backdrop-filter: blur`) over the backdrop.

## Top header
Left: back icon-button (36px, hairline, hover lift). Center: title (`strong` 15px) + subtitle (12px muted).
Right: action buttons — primary = gradient fill + glow, secondary = ghost (soft surface + hairline).

## Sidebar
Brand block: gradient rounded mark (`WF`) + name/subtitle. Groups labeled (uppercase 10.5px, letter-spaced).
Nav item: icon + label, 12px radius; hover = soft surface; **active** = accent-soft fill + 1px accent-tint
border + a 3px gradient rail on the left edge + purple icon. Collapsed = icon-only, labels hidden (existing behavior).

## Status bar
Glass strip of chips: offline runtime (live pulse dot when Ready), active instances, queue, last error.
Tone via status tokens.

## Page anatomy
`section-heading` (h1 20px + muted sub) → metric grid (optional) → work panels. Consistent 16px gaps.

## Card anatomy (`.metric-card`)
Surface + hairline + soft shadow + **3px gradient top line**; label row (icon tile + muted text), 28px value,
delta (success/danger), optional sparkline bottom-right. Hover: `translateY(-3px)` + accent border + float shadow.

## Panel anatomy (`.work-panel`)
Radius 20px; header row (title + tabs/badge/actions) with hairline divider; padded body. Optional segmented
tabs with sliding active pill.

## Form anatomy
Vertical field (label 12px + control). Inputs/selects/textarea: inset surface, hairline, 12px radius, 38px tall;
focus = purple border + 3px purple ring. Toggle = pill switch (gradient when on, sliding knob). Checkbox/radio:
accent fill when checked. Grouping via subheads + optional collapsible "Advanced".

## Table / list anatomy
Header row muted uppercase; rows on surface, hairline dividers, hover = soft surface; zebra optional via inset.
Row actions right-aligned; status via badges. Sticky header inside scroll containers.

## Button / control anatomy
- **Primary:** gradient, white text, glow shadow, hover lift. **Ghost/secondary:** soft surface + hairline.
- **Danger:** danger-tinted. **Icon button:** 34–36px square, hairline. Disabled: 55% opacity, no pointer.

## Modal / drawer anatomy
Modal: centered glass card, radius 20, float shadow, scrim `rgba(0,0,0,.55)`, scale+fade in. Drawer: right/left
slide-in glass panel with hairline edge; used for properties where inline panels don't fit.

## Empty / loading / error states
- **Empty:** centered icon tile (accent-soft) + title + muted line + primary CTA.
- **Loading:** skeleton shimmer blocks matching final layout; spinners only for inline/button waits.
- **Error:** danger-tinted inline banner (icon + message + retry), never a raw stack.

## Dashboard / report card anatomy
KPI header (title + sparkline), chart body (gradient area/line fills, accent series), legend chips, glass tooltip.
Chrome-usage gauge keeps its pressure bands mapped to status tokens.

## Workflow canvas anatomy
Inset dark surface with faint **dot grid**; floating add-node toolbar (top-left), minimap (top-right), zoom
cluster (bottom-right) — all glass. See 06 for detail.

## Node anatomy
Rounded card (14px), icon tile (accent-soft, purple glyph), title + subtitle, type tag; ports as accent-ringed
handles. States: default / hover(lift) / selected(accent ring) / running(pulse) / success / error / disabled. See 06.

## Connector anatomy
Bezier path, violet→blue gradient stroke (or per-type/custom color), arrowhead; running = animated dashed flow;
success/failure recolor. See 06.

## Responsive behavior
Desktop-first (Electron). Sidebar collapses at narrow widths; metric grid 4→2→1; panels stack; canvas keeps min
size with scroll. No layout below ~1024px is required but must not break.

## Accessibility
WCAG AA contrast on text/controls against dark surfaces (verify muted text ≥ 4.5:1 for body, ≥3:1 for large).
Visible focus ring on all interactives; full keyboard nav; ARIA labels preserved; status not by color alone
(icon/text + color). Don't drop existing `aria-*`.

## Reduced-motion
`@media (prefers-reduced-motion: reduce)` disables connector flow, pulses, count-up, shimmer, and transforms;
falls back to instant state changes. See 07.
