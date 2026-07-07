# 00 — Template Review Findings

> **Status of this file:** the four Dribbble URLs could **not** be visually inspected in this
> pass. Direct fetch returns an empty client-rendered shell, and the local **Claude in Chrome**
> extension did not register a connected browser (`list_connected_browsers` → `[]`) despite the
> desktop toggle being on. The findings below are therefore **derived from the user's written
> design brief** (premium dark SaaS, purple/blue, gradients, glass, animated connectors, large
> radius) plus the well-documented visual language of this Dribbble genre. **Every observation is
> marked `[BRIEF]` (from the brief) or `[GENRE]` (typical of these shots).** Nothing here is copied
> from a protected asset. Once Chrome connects, re-open the URLs and replace `[BRIEF]/[GENRE]`
> tags with `[OBSERVED]` notes + screenshot paths.

## Template URLs and accessibility

| # | URL | Opened in Chrome? | Notes |
|---|-----|-------------------|-------|
| 1 | https://dribbble.com/shots/25507450-AI-Automation-Platform | ❌ not reachable | Extension not connected; plain fetch returned empty JS shell |
| 2 | https://dribbble.com/shots/25658881-Integrations-AI-Automation-Platform | ❌ not reachable | same |
| 3 | https://dribbble.com/shots/25519917-AI-Automation-Platform-Building-Workflow | ❌ not reachable | same |
| 4 | https://dribbble.com/shots/25742747-Dashboard-Chart-Components | ❌ not reachable | same |

Screenshots captured: **none** (pending Chrome). When available, save under
`docs/ai/ui-reskin-template-plan/mockups/screenshots/` as `t1-main.png`, `t2-*.png`, etc.

## Per-template observations (to confirm)

### Template 1 — AI Automation Platform (overview/dashboard) `[BRIEF][GENRE]`
- **Layout:** left icon+label sidebar, slim top bar, content grid of metric/summary cards over a very dark backdrop.
- **Background:** near-black navy (#0a–#0e range) with a large, soft radial accent glow bleeding from a corner. `[GENRE]`
- **Palette:** violet→blue as the single accent, everything else neutral grey-blue. `[BRIEF]`
- **Cards:** large radius (~16px), 1px hairline border at ~8% white, soft drop shadow + faint top accent line. `[GENRE]`
- **Motion:** count-up numbers, hover lift on cards, animated line/area charts. `[GENRE]`

### Template 2 — Integrations `[BRIEF][GENRE]`
- Grid of integration/connector cards with logo tiles, glassy panels, subtle inner glow on hover, pill status chips.
- Search + filter row; segmented tabs with a sliding active pill.

### Template 3 — Building Workflow (node canvas) `[BRIEF][GENRE]`
- **Canvas:** dark inset surface with a faint **dot grid**; nodes are rounded cards with an icon tile, title, subtitle.
- **Connectors:** smooth bezier lines with a **violet→blue gradient stroke** and an animated dashed "flow" when running. `[BRIEF]`
- **Node states:** selected (accent ring), running (pulsing outline), success/error tint on the icon tile. `[GENRE]`
- **Controls:** floating zoom cluster bottom-right, minimap top-right, floating add-node toolbar. `[GENRE]`

### Template 4 — Dashboard Chart Components `[BRIEF][GENRE]`
- Reusable chart cards (line, area, donut, bar) with gradient fills, legend chips, KPI header + sparkline, glass tooltips.

## Extracted design system (working hypothesis)

- **Backdrop:** `#0a0c14` + dual radial accent glows (violet top-right, blue top-left).
- **Surfaces:** base `#12141f`, raised `#171a27`, inset/well `#0e1019`, glass `rgba(23,26,39,.72)` w/ blur.
- **Accent:** `#7c5cff` (purple) → `#3b82f6` (blue) as a 135° gradient; solid purple for focus/handles.
- **Text:** `#f5f6fb` / `#aab1c9` / `#6c7391`.
- **Status:** success `#34d399`, warning `#fbbf24`, danger `#f87171`, info `#60a5fa` (each with ~14% soft bg).
- **Radius:** cards 16, panels 20, controls 12, pills 999.
- **Depth:** layered soft shadow + accent glow on primary/selected only.
- **Motion:** 120/220/360ms with `cubic-bezier(.22,1,.36,1)`; dashed connector flow; pulse for live/running.

## What SHOULD influence AWKIT
- The dark premium surface system, single violet→blue accent, large radius, hairline borders, soft depth.
- Dot-grid canvas, gradient/animated connectors, node status tinting, floating zoom + minimap.
- Metric cards with accent top-line + sparkline; segmented tabs with sliding active state; glass header/status bar.

## What must NOT be copied
- No Dribbble logos, brand marks, illustrations, icon sets, or exact artwork.
- No verbatim color values lifted from a shot's exported palette (we define an original AWKIT palette).
- No pixel-copied layout of any specific shot — adapt patterns to AWKIT's existing routes only.
- Icons remain **lucide-react** (already a dependency), not any template icon set.

## Follow-up when Chrome connects
1. Open each URL, capture main + zoom + any GIF frames to `mockups/screenshots/`.
2. Sample real palette/spacing, confirm connector motion, note anything that changes the token set.
3. Update this file's tags to `[OBSERVED]` and reconcile `03_DESIGN_TOKENS` if values shift.
