# Single Combined Prompt — AWKIT Hologram Template Design Completion

Paste this into the agent from the AWKIT repo root.

---

You are working locally inside the AWKIT repository.

The previous UI implementation is still visually incomplete. Your task is to implement the missing Hologram-style workflow builder design details exactly enough that the AWKIT UI visibly matches the provided template assets.

## Design assets to review first

Review these local assets:

```text
UI Samples/sample_01.png
UI Samples/Sample02.mp4
UI Samples/sample_03.mp4
UI Samples/sample_04.mp4
```

Extract frames from all MP4 files if needed. Use installed Chrome, Comet Browser, ffmpeg, Python/OpenCV, or any safe local tool. Save frame evidence under:

```text
docs/ai/ui-reskin-template-plan/screenshots/template-frames/
```

## Actual template design to implement

Implement a light Hologram-style SaaS workflow builder:

- full-height off-white left sidebar
- header only over main content, not above sidebar
- compact top header with title, real dirty/status chip, muted subtitle, action cluster
- light off-white dotted canvas
- floating left node palette
- floating right configuration drawer
- bottom-center zoom pill
- white rounded node cards
- left icon tile, metadata row, title, kebab affordance
- selected lavender fill + purple border/ring
- thin curved violet connectors
- branch labels like `If true` / `If false`
- plus/add buttons on connector segments only where real insertion is supported
- drawer with sticky header, tabs, scroll body, sticky footer
- clean input/select/textarea style
- hover lift, drawer slide, connector flow animation, card motion, skeleton shimmer
- full reduced-motion support
- no page-level overflow bugs

## Hard rules

- Do not remove functionality.
- Do not remove required fields.
- Do not change automation runtime behavior.
- Do not break workflow save/load/execution.
- Do not break recorder, sessions, instances, reports, or settings.
- Do not fake data or controls.
- Do not add a new animation library unless CSS is insufficient and you justify it.
- Do not commit unless explicitly asked.

## Files to modify and required changes

### `app/renderer/layout/AppShell.tsx`

Change shell structure from header-above-sidebar to full-height sidebar plus main content:

```tsx
return (
  <div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
    <LeftNavigation
      activeRouteId={activeRouteId}
      collapsed={sidebarCollapsed}
      onRouteChange={onRouteChange}
      onToggle={onToggleSidebar}
    />
    <div className="app-main">
      <TopHeader
        activeRoute={activeRoute}
        actions={headerActions}
        canGoBack={canGoBack}
        dirty={dirty}
        onBack={onBack}
      />
      <main key={activeRouteId} className={animateContent ? "main-surface main-surface-animated" : "main-surface"}>
        {children}
      </main>
      <StatusBar />
    </div>
  </div>
);
```

Add `dirty: boolean` to props.

### `app/renderer/layout/TopHeader.tsx`

Add `dirty` prop and render:

```tsx
<div className="header-title">
  <strong>{activeRoute.label}</strong>
  {dirty ? <span className="header-dirty-chip">Unsaved changes</span> : null}
  <span className="header-subtitle">{activeRoute.description}</span>
</div>
```

Primary action class: `toolbar-button primary header-primary-action`; secondary: `toolbar-button header-secondary-action`.

### `app/renderer/layout/LeftNavigation.tsx`

Keep all routes. Redesign sidebar presentation:

- brand row: AWKIT / Automation workbench
- route groups in template spacing
- footer utilities: Settings shortcut, Dark Mode toggle, local workspace row
- collapsed state polished

Do not remove route IDs.

### `app/renderer/layout/DesignerCanvasLayout.tsx`

Change right panel from sibling column to overlay slot:

```tsx
return (
  <section className={className}>
    <div className={flush ? "designer-canvas flush" : "designer-canvas"}>{children}</div>
    <div className="designer-right-drawer-slot">
      {rightPanel ?? <RightPropertiesPanel title={propertiesTitle} />}
    </div>
  </section>
);
```

Do not animate React Flow measurement containers.

### `app/renderer/components/workflow/CanvasZoomControl.tsx`

Keep real zoom functionality. Add class `canvas-zoom-button` to buttons. Do not add fake Ask AI.

### `app/renderer/components/workflow/ActionFlowNode.tsx`

Add template node anatomy while preserving NodeResizer, handles, loop button, and selected/validation behavior.

Import:

```ts
import { MoreHorizontal, RotateCw } from "lucide-react";
```

Replace article content with icon tile + metadata + title + description + menu button:

```tsx
<article className={`action-flow-node ${selected ? "selected" : ""} ${nodeData.validationState}`}>
  {canHaveLoop(nodeData.stepType) ? (...existing loop button...) : null}
  <div className="action-node-icon" aria-hidden="true"><Icon size={18} /></div>
  <div className="action-node-content">
    <div className="action-node-meta">
      <span>{catalogItem.label}</span>
      <span className="action-node-index">{nodeData.stepType}</span>
    </div>
    <strong className="action-node-title">{nodeData.name}</strong>
    {nodeData.description ? <span className="action-node-description">{nodeData.description}</span> : null}
  </div>
  <button className="action-node-menu" type="button" title="Node actions" aria-label="Node actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
    <MoreHorizontal size={16} />
  </button>
</article>
```

### `app/renderer/components/shared/connectorStyle.ts`

Replace hardcoded colors with CSS variables:

```ts
export const connectorTypeColor: Record<string, string> = {
  success: "var(--awkit-connector-default)",
  failure: "var(--awkit-connector-failure)",
  always: "var(--awkit-connector-default)",
  conditional: "var(--awkit-connector-default)",
  outcome: "var(--awkit-connector-default)",
  manualApproval: "var(--awkit-connector-default)",
  loop: "var(--awkit-connector-loop)",
  loopBack: "var(--awkit-connector-loop)",
  parallel: "var(--awkit-connector-default)"
};
```

Update `buildConnectorVisual` to use `templateSmooth` for default smoothstep connectors:

```ts
const shape = s.shape ?? (type === "loop" ? "circular" : "smoothstep");
const reactFlowType = shape === "circular" ? "circular" : shape === "smoothstep" ? "templateSmooth" : shape;
```

Return `type: reactFlowType`.

### Add `app/renderer/components/shared/TemplateSmoothEdge.tsx`

Create a custom edge using `BaseEdge`, `EdgeLabelRenderer`, `getSmoothStepPath`, with label pill and optional plus button. Use the full spec from `files/09_new_template_smooth_edge.md` if available.

### `app/renderer/pages/FlowChartDesigner.tsx`

- Import and register `TemplateSmoothEdge`.
- Add `insertNodeOnEdge` callback.
- Create `edgesForCanvas` that adds `showAddButton` and `onInsertNode` only for rendering.
- Pass `edges={edgesForCanvas}` to React Flow.
- Do not save callbacks in flow JSON.
- Ensure canvas body uses template classes and full canvas.

### `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx`

Convert panel into template drawer:

- `template-config-drawer`
- sticky header
- Setup/Test tab strip
- `.properties-body` scroll container
- sticky footer with real safe action (`Done`/collapse) and no fake save if live-bound
- preserve all fields/details groups

### `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx`

Same drawer treatment:

- header with connection title and delete action
- Setup/Test tabs
- `.properties-body`
- sticky footer
- preserve all connector fields and locking rules

### `app/renderer/styles/global.css`

Implement template CSS:

- template tokens
- shell grid columns
- `.app-main`
- sidebar/header styles
- canvas/dotted grid
- drawer overlay and internal scroll
- node palette
- action node card anatomy
- connector label/add button/running animation
- bottom zoom pill
- shared cards/forms/tables
- overflow fixes
- reduced-motion kill switch

Use the detailed CSS blocks from `files/01_global_css.md` if available.

### Scenario/Workflow/Form pages

Apply the same treatment to:

```text
app/renderer/pages/ScenarioBuilder.tsx
app/renderer/pages/WorkflowDesigner.tsx
app/renderer/pages/FormDesigner.tsx
```

If they use React Flow, register `TemplateSmoothEdge` and use shared canvas styling. If static canvas, update classes/CSS to match template node/connector/panel system.

### Shared pages

Polish pages and overflows:

```text
Dashboard, Workflows Library, Flow Library, Runtime Inputs, Data Sources, Data Source Editor, Recorder, Sessions, Instance Monitor, Execution Monitor, Reports*, Settings, Roadmap, Project Contract, Offline Runtime
```

Fix cards, tables, forms, charts, empty/loading states, scroll behavior, and old flat styles.

## Documentation

Create/update:

```text
docs/ai/ui-reskin-template-plan/16_VISUAL_GAP_CLOSURE_REPORT.md
docs/ai/CURRENT_STATE.md
docs/ai/TASK_LOG.md
```

The gap report must include area, template expectation, current gap, files/selectors fixed, done status, screenshot proof.

## Screenshots

Capture after screenshots:

```text
docs/ai/ui-reskin-template-plan/screenshots/after/dashboard.png
docs/ai/ui-reskin-template-plan/screenshots/after/flow-designer.png
docs/ai/ui-reskin-template-plan/screenshots/after/scenario-builder.png
docs/ai/ui-reskin-template-plan/screenshots/after/workflow-designer.png
docs/ai/ui-reskin-template-plan/screenshots/after/recorder.png
docs/ai/ui-reskin-template-plan/screenshots/after/instances.png
docs/ai/ui-reskin-template-plan/screenshots/after/reports-overview.png
docs/ai/ui-reskin-template-plan/screenshots/after/settings.png
```

## Verification

Run:

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

## Final response

Report exact files changed, selectors/components changed, screenshots, verification results, remaining gaps, and confirm no commit was made.
