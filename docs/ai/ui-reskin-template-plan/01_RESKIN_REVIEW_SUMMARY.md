# 01 — Re-skin Review Summary (AWKIT codebase)

## Files inspected (this pass)
- Root: `package.json`, `CLAUDE.md`, `AGENTS.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/ARCHITECTURE.md` (index), `docs/ai/TASK_LOG.md` (index).
- Styles: `app/renderer/styles/global.css` (5,846 lines — the **single** stylesheet).
- Shell/layout: `app/renderer/layout/{AppShell,TopHeader,LeftNavigation,StatusBar,RightPropertiesPanel,DesignerCanvasLayout}.tsx`.
- Routing: `app/renderer/routes.tsx` (25 routes, grouped Build/Data/Run/Reports/System).
- Workflow: `app/renderer/components/workflow/{ActionFlowNode,CanvasZoomControl,ConnectionPropertiesPanel,FlowNodePropertiesPanel,flowNodeCatalog,flowNodeRegistry,flowDesignerTypes}.*`
- Shared: `app/renderer/components/shared/{connectorStyle.ts,ConnectorPorts.tsx,...}`.
- Pages: 25 under `app/renderer/pages/` (Dashboard, FlowChartDesigner, WorkflowDesigner, Recorder, InstanceMonitor, ExecutionMonitor, Reports*, Settings, DataSource*, ScenarioBuilder, FormDesigner, …).

## Existing UI architecture
- **Electron + React 18 + `@xyflow/react` 12.3.6**, Vite bundling. Icons: **lucide-react**. No Tailwind, no CSS modules — **one global stylesheet**.
- IPC bridge is exposed on `window.playwrightFlowStudio` (preload). **Must not be renamed** (per `CLAUDE.md`).
- Shell is a CSS grid: `grid-template-rows: 60px 1fr 32px` = header / body / status bar; body is `sidebar | main`.
- Two React Flow canvases (Flow Designer + Scenario/Workflow Builder) share connector visuals via `shared/connectorStyle.ts`.
- Route content fades on navigation **except** canvas routes (`flowChart`, `scenarioBuilder`, `workflow`, `formDesigner`) — a mount transform perturbs React Flow measurement (see `AppShell.tsx` comment). **Keep this exclusion.**

## Where `--awkit-*` tokens already exist
- Defined in `global.css` `:root` (~line 40): surfaces, text, accents (`--awkit-purple:#5b3e91`, `--awkit-blue:#3563f8`), status, radius (`--awkit-radius-card:14px`), shadows, **motion** (`--awkit-ease-out`, `--awkit-dur-*`), **z-index**. This is a **light-first** set.
- Applied in: metric cards, work panels, badges, skeleton, some node/selected states, Reports surfaces.

## Where tokens are NOT applied (old-skin hotspots)
- `.top-header` → hardcoded `background:#ffffff; border-bottom:1px solid #dde3ed`.
- `.left-navigation`, `.status-bar`, brand block → hardcoded greys.
- Node internals: `.action-node-copy span{color:#617089}`, `.action-flow-node em{background:#eef5ff;color:#0d5dc2}`, handles `#1769e0`, warning/error `#d68a00/#d64545`.
- Connector colors hardcoded in `connectorStyle.ts` (`connectorTypeColor`, `connectorColorPresets`).
- Global hardcoded hex counts in `global.css`: `#ffffff`×47, `#617089`×39, `#dfe6ef`×37, `#f8fafc`×29, `#1769e0`×17, plus many status/border greys.
- **227** inline `style={{…}}` blocks across `.tsx` (charts, canvases, layout) — a hardcoded-value risk surface.

## Main pages still on the old skin
Dashboard, Flow Designer, Workflow Builder, Recorder, Instances, Instance Monitor, Settings, and even Reports (which reuse `.work-panel`, `.page-grid`, `.metric-card` — retrofit those base classes and Reports upgrade for free).

## Current animation gaps
- Present: route fade, card hover, badge pulse, skeleton shimmer, focus ring.
- Missing vs. target: gradient/animated connectors, node running/success/error transitions, metric count-up, sliding tab pill, panel/drawer slide, active-nav indicator motion, chart draw-in. No animation library installed → **CSS-first** (see 07).

## Re-skin strategy (one line)
Flip the token set to the **dark premium** system, retrofit the shared base classes (`.top-header`, `.left-navigation`, `.status-bar`, `.metric-card`, `.work-panel`, `.action-flow-node`, controls) to consume tokens, move hardcoded node/connector colors into tokens, then layer motion — **CSS-only, additive, no structural/route/IPC changes.**
