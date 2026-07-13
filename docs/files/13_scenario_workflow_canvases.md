# File Spec — Scenario Builder and Workflow Designer Canvas Surfaces

Project files:

```text
app/renderer/pages/ScenarioBuilder.tsx
app/renderer/pages/WorkflowDesigner.tsx
```

Potential related files:

```text
app/renderer/components/shared/connectorStyle.ts
app/renderer/components/shared/TemplateSmoothEdge.tsx
app/renderer/styles/global.css
```

## Goal

Apply the same template canvas, node, connector, panel, and overflow design to Workflow Builder / Scenario Builder and Workflow Designer.

## Required agent steps

### 1. Inspect each file first

Search for:

```text
ReactFlow
Background
Controls
MiniMap
edgeTypes
nodeTypes
workflow-stage
scenario-node
scenario-canvas
workflow-board
```

### 2. If React Flow is used

- Register `TemplateSmoothEdge` for smooth connector rendering.
- Use the same dotted background values.
- Use `CanvasZoomControl` if not already present and if compatible.
- Style minimap/controls through global CSS.
- Ensure canvas uses full available height and no old boxed margins.

### 3. If static/custom canvas is used

- Apply the same `.designer-canvas`, `.template-canvas-body`, `.workflow-board`, and connector styles.
- Replace old left-border node cards with template node cards.
- Replace thick connector borders with thin violet connector lines.

### 4. Required visual treatment

- white rounded workflow cards
- icon tile
- small metadata line
- title line
- kebab affordance where real actions exist
- selected lavender fill
- purple connector lines
- branch labels styled as small muted text/pill
- plus buttons at safe insertion points if functionality exists
- bottom zoom pill if zoom exists
- internal panel scroll, not page overflow

### 5. Do not break

- workflow save/load
- workflow node selection
- connector creation/deletion
- run-another-flow links
- last opened workflow restoration
- node properties bindings
- existing validation

## CSS selectors to use/extend

```text
.scenario-builder-page
.scenario-builder-grid
.scenario-canvas-panel
.scenario-side-panel
.scenario-properties-panel
.scenario-node
.workflow-board
.workflow-stage
.workflow-connector
.template-canvas-body
```

## Acceptance proof

Capture screenshots for:

```text
docs/ai/ui-reskin-template-plan/screenshots/after/scenario-builder.png
docs/ai/ui-reskin-template-plan/screenshots/after/workflow-designer.png
```

## Verify

```bash
npm run build
npm run verify:workflow-builder
```
