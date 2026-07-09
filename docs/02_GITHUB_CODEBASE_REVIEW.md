# GitHub Codebase Review — AWKIT UI Design Implementation Targets

Repository reviewed: `MohammadAbwini98/AWKIT`.

Important repo facts from `package.json`:

- App name: `playwright-flow-studio`.
- Runtime stack: Electron + Vite + React + TypeScript.
- UI libraries already present: `@xyflow/react`, `lucide-react`, `react`, `react-dom`.
- No separate animation library is currently required.
- Verification scripts exist for build, typecheck, Flow Designer, Workflow Builder, Reports, Recorder, Instance Monitor, Data Editor, and runtime checks.

## Key files and current gaps

### `app/renderer/App.tsx`

Observed:

- App owns route state, sidebar collapsed state, theme context, page chrome, unsaved changes dialog.
- It passes `dirty={chrome.dirty}` into `AppShell`.

Required:

- Ensure `AppShellProps` actually accepts `dirty` and threads it to `TopHeader`.
- Do not break unsaved changes behavior.

### `app/renderer/layout/AppShell.tsx`

Current structure observed in GitHub:

```tsx
<div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
  <TopHeader ... />
  <div className={sidebarCollapsed ? "app-body collapsed" : "app-body"}>
    <LeftNavigation ... />
    <main ...>{children}</main>
  </div>
  <StatusBar />
</div>
```

Gap:

- Header spans above sidebar. The template header starts to the right of the full-height sidebar.

Required structure:

```tsx
<div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
  <LeftNavigation ... />
  <div className="app-main">
    <TopHeader ... dirty={dirty} />
    <main ...>{children}</main>
    <StatusBar />
  </div>
</div>
```

### `app/renderer/layout/LeftNavigation.tsx`

Observed:

- Uses route groups Build/Data/Run/Reports/System.
- Has brand block and dark mode toggle.

Gap:

- Visual structure is still generic AWKIT route grouping, not the template’s Home/Reports/Team/Workflows + workflow status section + bottom utility style.

Required:

- Keep all routes but redesign presentation to template style.
- Add bottom utility styling.
- Add cleaner nav groups and active state.
- Do not fake live workflow status unless backed by real data.

### `app/renderer/layout/TopHeader.tsx`

Observed:

- Renders back button, title, description, and action buttons.

Gap:

- Missing template-like status chip, compact right cluster, icon-square secondary actions, dirty chip styling.

Required:

- Accept `dirty` prop.
- Render status chip only when real state exists.
- Primary page action = violet CTA.
- Secondary actions = compact neutral buttons.

### `app/renderer/styles/global.css`

Observed:

- Existing tokens are already present.
- Existing styles include `.app-shell`, `.top-header`, `.app-body`, `.left-navigation`, `.metric-card`, `.work-panel`, `.designer-layout`, `.designer-canvas`, `.properties-panel`, `.flow-node-palette`, `.react-flow-shell`, `.action-flow-node`, connector handles, etc.

Gaps:

- Some structural selectors still encode older layouts.
- Canvas styles still include boxed/layout assumptions.
- Node card styles still carry old generic automation styling in places.
- Connector color source still uses hardcoded hex values in TS.
- Overflow/panel scrolling needs stricter template behavior.

### `app/renderer/layout/DesignerCanvasLayout.tsx`

Observed:

```tsx
<section className={className}>
  <div className={flush ? "designer-canvas flush" : "designer-canvas"}>{children}</div>
  {rightPanel ?? <RightPropertiesPanel title={propertiesTitle} />}
</section>
```

Gap:

- Right panel is layout sibling, not a floating overlay slot.

Required:

- Wrap right panel in a `designer-right-drawer-slot` overlay container.
- Keep collapsed behavior.
- Do not apply transforms to React Flow measurement container.

### `app/renderer/pages/FlowChartDesigner.tsx`

Observed:

- Uses `@xyflow/react` with `Background`, `Controls`, `MiniMap`, `CanvasZoomControl`.
- Registers only `SelfLoopEdge` as a custom edge.
- Uses `ActionFlowNode`.
- Has palette collapse/resize and properties collapse behavior.

Gaps:

- Need custom template edge for labels/add buttons/running flow.
- Need overlay canvas layout and no old margin/box feel.
- Need better z-index/overflow.

### `app/renderer/components/workflow/ActionFlowNode.tsx`

Observed:

- Renders `NodeResizer`, node article, loop button, icon, copy, step type badge, connector ports.

Gap:

- Template node anatomy needs metadata row, index/type badge, title, action/kebab affordance, more precise selected/hover states.

Required:

- Update markup and CSS while preserving handles/resizer/loop behavior.

### `app/renderer/components/shared/connectorStyle.ts`

Observed:

- `connectorTypeColor` uses hardcoded hex values.
- `buildConnectorVisual` returns React Flow edge fields.

Gap:

- Connector color decisions are not tokenized.
- Default connector types should feel like the template: violet by default, semantic colors only when useful.

Required:

- Use CSS variable strings for default colors.
- Preserve custom saved colors.
- Prefer a custom `templateSmooth` edge type for default smooth connectors.

### `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx`

Observed:

- Full panel is `<aside className="properties-panel">` with heading, many `details.property-group` sections, and fields.
- Collapsed state already exists.

Gaps:

- Needs template drawer anatomy: sticky header, tabs/sections styling, internal scroll, sticky footer, stronger overflow handling.

Required:

- Do not remove fields.
- Add wrapper regions: header, tab strip if useful, body scroll area, footer.

### `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx`

Observed:

- Full panel is `<aside className="properties-panel">` with connection config sections.

Gaps:

- Same drawer and overflow issue.
- Needs selected connector visual controls matching template.

Required:

- Drawer shell + body + footer + delete action.

### `app/renderer/components/workflow/CanvasZoomControl.tsx`

Observed:

- Already uses React Flow `Panel position="bottom-center"`.
- Contains minus, percentage, plus, fit.

Gap:

- Needs template pill styling and hover/press animation.
- Do not add fake Ask AI unless existing functionality exists.

## Existing verification commands to use

```bash
npm run build
npm run typecheck
npm run verify:flow-designer
npm run verify:workflow-builder
npm run verify:reports
npm run verify:instance-monitor
npm run verify:data-editor
npm run verify:recorder
npm run ai:memory
```
