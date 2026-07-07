# 10 — Design Mock Details

## Mock type
**Static single-file HTML/CSS** (option 1). No build, no network, no framework — opens in any browser.

## Mock file path
`docs/ai/ui-reskin-template-plan/mockups/awkit-template-mock.html`

## What the mock demonstrates
- **App shell:** glass top header, gradient-backdrop body, glass status bar with live pulse.
- **Sidebar:** brand mark, grouped nav, active item with gradient left rail + accent-soft fill.
- **Top header:** title/subtitle, ghost + primary (gradient/glow) actions, icon button.
- **Dashboard metric cards:** gradient top-line, KPI value, delta, sparkline, hover lift.
- **Work panel:** header + segmented tabs (sliding active), padded body.
- **Workflow canvas:** dot-grid inset surface, floating add-node toolbar, minimap, glass zoom cluster.
- **Nodes:** icon tile + title/subtitle + type tag + ports; states shown = **start, selected+running, done(success), error**.
- **Connectors:** violet→blue gradient bezier edges with **animated dashed flow**; a success-colored edge.
- **Forms:** input, select, focus ring, pill toggle (interactive), primary/ghost buttons.
- **Status badges:** running(live pulse)/queued/retrying/failed.
- **States:** hover (cards/nodes), selected (node ring), loading (**skeleton shimmer**), accent swatches.

## Template elements that influenced it
Dark backdrop + radial accent glow, single violet→blue accent, large radius + hairline borders + soft depth,
dot-grid node canvas, gradient/animated connectors, node status tinting, floating zoom + minimap, KPI cards
with sparkline + accent line, segmented tabs, glass chrome. **All redrawn originally** — no template asset used.

## AWKIT components each mock piece maps to
| Mock piece | AWKIT target |
|---|---|
| shell/header/sidebar/status | `AppShell/TopHeader/LeftNavigation/StatusBar.tsx` + shell css |
| metric cards | `.metric-card` (Dashboard, Reports) |
| work panel + tabs | `.work-panel`, tab classes |
| canvas + toolbar + zoom + minimap | Flow Designer, `CanvasZoomControl`, `.react-flow__*` |
| nodes + states | `.action-flow-node` / `.scenario-flow-node` |
| connectors | `connectorStyle.ts` + edge css |
| form controls | inputs/selects/toggles css |
| badges | `.status-chip` / badge classes |
| skeleton | `.skeleton` |

## Intentionally NOT production-wired
No routing, no `window.playwrightFlowStudio`, no React, no React Flow engine. Node positions/edges are static
SVG/CSS for illustration. Icons are inline placeholder SVG/glyphs — production uses lucide-react. Numbers are dummy.

## How to open / view
Double-click `awkit-template-mock.html`, or right-click → Open with → your browser. Hover cards and nodes to
see states; toggle the switch in Node properties. (Also viewable via the file card shared in chat.)

## Feedback needed before production implementation
1. Overall darkness/contrast level ok, or lighter surfaces?
2. Accent = violet→blue gradient as shown, or a different primary?
3. Radius/glow intensity — keep, dial up, or down?
4. Node card density + which states must be visually distinct?
5. Connector default = gradient stroke vs. solid per-type?
6. Any surface that should stay lighter for readability (e.g., dense report tables)?
Once confirmed (and after the live Dribbble review), lock tokens in 03 and start Phase 1.
