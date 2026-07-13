# File Spec — `app/renderer/components/workflow/ActionFlowNode.tsx`

## Goal

Redesign node markup to match template cards while preserving all existing behavior.

## Existing behavior to preserve

Do not break:

- `NodeResizer`
- `useReactFlow`
- `useUpdateNodeInternals`
- loop button creation/removal
- `ConnectorTargetPorts`
- `ConnectorSourcePorts`
- `ConnectorLoopPort`
- start/end restrictions
- validation state classes
- selected class
- saved node width/height

## Required import change

Add `MoreHorizontal` from `lucide-react`:

```ts
import { MoreHorizontal, RotateCw } from "lucide-react";
```

If import already exists, merge safely.

## Required markup replacement

Replace current article content:

```tsx
<article className={`action-flow-node ${selected ? "selected" : ""} ${nodeData.validationState}`}>
  ...
  <div className="action-node-icon">...</div>
  <div className="action-node-copy">...</div>
  <em>{nodeData.stepType}</em>
</article>
```

With:

```tsx
<article className={`action-flow-node ${selected ? "selected" : ""} ${nodeData.validationState}`}>
  {canHaveLoop(nodeData.stepType) ? (
    <button
      className={`node-loop-button${hasLoop ? " active" : ""}`}
      onClick={hasLoop ? removeLoop : addLoop}
      title={hasLoop ? "Remove loop connector" : "Add loop connector"}
      type="button"
    >
      <RotateCw size={11} />
    </button>
  ) : null}

  <div className="action-node-icon" aria-hidden="true">
    <Icon size={18} />
  </div>

  <div className="action-node-content">
    <div className="action-node-meta">
      <span>{catalogItem.label}</span>
      <span className="action-node-index">{nodeData.stepType}</span>
    </div>
    <strong className="action-node-title">{nodeData.name}</strong>
    {nodeData.description ? <span className="action-node-description">{nodeData.description}</span> : null}
  </div>

  <button className="action-node-menu" type="button" title="Node actions" aria-label="Node actions">
    <MoreHorizontal size={16} />
  </button>
</article>
```

## Important note about the menu button

If no node menu exists, the button can be decorative/non-destructive for now, but it must not break selection/dragging. If it causes drag problems, add:

```tsx
onPointerDown={(event) => event.stopPropagation()}
onClick={(event) => event.stopPropagation()}
```

Do not add fake destructive actions.

## Required CSS selectors

Implemented in `global.css`:

```text
.action-flow-node
.action-flow-node.selected
.action-flow-node.warning
.action-flow-node.error
.action-node-icon
.action-node-content
.action-node-meta
.action-node-index
.action-node-title
.action-node-description
.action-node-menu
.node-loop-button
.react-flow-handle
```

## Verify

```bash
npm run build
npm run verify:flow-designer
```
