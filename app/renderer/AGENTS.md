# Local Agent Rules — `app/renderer` (React UI)

## Scope
The React renderer: pages, components, layout, state, and the single CSS file. Runs in the
Electron renderer (browser context); reaches the main process only through the preload API.

## Required reading
Root `AGENTS.md` + `docs/ai/ARCHITECTURE.md`, `docs/ai/RULES.md`, `docs/ai/FEATURES.md`.

## Local rules
- **Components:** React function components + hooks. Canvases use the in-house engine in
  `components/canvas/*` (`FlowCanvas` + `useCanvas`/`FlowCanvasHandle`, `Background`,
  `CanvasZoomControl`, `SmoothEdge`/`LoopEdge`, `StepNode`) — no React Flow / `@xyflow`. The flow
  runs top→bottom (edges leave a node's bottom-center and enter the next node's top-center). Reuse
  existing building blocks in `components/workflow/*` (node registry, `FlowNodePropertiesPanel`),
  `components/table/*` (pagination/search), `components/shared/*`.
- **Styling:** plain CSS only, in `styles/global.css`. No CSS-in-JS, no new UI framework, no
  inline-style sprawl beyond small dynamic values. Reuse existing class names/patterns.
- **Backend access:** call `window.playwrightFlowStudio.<area>.<method>()` — never `fetch`/HTTP and
  never import from `app/main`. Keep these calls in pages/components consistent with current usage.
- **Routing/shell:** preserve `routes.tsx`, `layout/AppShell` (left nav, top header, status bar).
  Publish header actions and the unsaved-changes dirty flag via `state/pageChrome.tsx`.
- **State persistence:** persist UI state through `settings.update({...})` (deep-partial) and restore
  on mount, matching existing patterns (sidebar, panels, widths, zoom, selections, table state).
- **No fake controls / no demo data:** every enabled control must work; use empty states, not seed
  records.

## Testing / verification
- `npm run build`, then `npm run dev` to exercise the affected screen.

## Do not break
- The app shell/routing, the `window.playwrightFlowStudio` usage pattern, or offline behavior
  (no remote fonts/scripts/CDN).

## Update requirements
- If you add/change a feature or screen, update `docs/ai/FEATURES.md` and `docs/ai/CURRENT_STATE.md`,
  and append to `docs/ai/TASK_LOG.md`.
