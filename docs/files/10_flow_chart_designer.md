# File Spec — `app/renderer/pages/FlowChartDesigner.tsx`

## Goal

Make Flow Designer match the template canvas behavior and register the template connector edge.

## Required changes

### 1. Import `TemplateSmoothEdge`

Add near other shared component imports:

```ts
import { TemplateSmoothEdge } from "../components/shared/TemplateSmoothEdge";
```

### 2. Register edge type

Change:

```ts
const edgeTypes = {
  circular: SelfLoopEdge
} satisfies EdgeTypes;
```

To:

```ts
const edgeTypes = {
  templateSmooth: TemplateSmoothEdge,
  circular: SelfLoopEdge
} satisfies EdgeTypes;
```

### 3. Add safe insert-node-on-edge callback

Add after `addNode` or near connector callbacks:

```ts
const insertNodeOnEdge = useCallback(
  (edgeId: string) => {
    const edge = edges.find((item) => item.id === edgeId);
    if (!edge || edge.source === edge.target) return;

    const sourceNode = nodes.find((node) => node.id === edge.source);
    const targetNode = nodes.find((node) => node.id === edge.target);
    const catalogItem = getFlowNodeCatalogItem("click");
    const id = `click-${Date.now().toString(36)}`;
    const position = {
      x: ((sourceNode?.position.x ?? 280) + (targetNode?.position.x ?? 560)) / 2,
      y: ((sourceNode?.position.y ?? 160) + (targetNode?.position.y ?? 320)) / 2
    };

    const node: FlowDesignerNode = styledNode({
      id,
      type: "actionNode",
      position,
      data: { ...defaultNodeData("click", catalogItem.label, catalogItem.description), ...defaultNodeSize.current }
    });

    setNodes((currentNodes) => [...currentNodes, node]);
    setEdges((currentEdges) => {
      const targetEdge = currentEdges.find((item) => item.id === edgeId);
      if (!targetEdge) return currentEdges;
      const remaining = currentEdges.filter((item) => item.id !== edgeId);
      return reconcileFlowBranches([
        ...remaining,
        createEdge(targetEdge.source, id, targetEdge.data?.linkType ?? "success", targetEdge.data?.label, targetEdge.data?.expression, targetEdge.data?.style, targetEdge.data?.maxLoopCount, {
          kind: targetEdge.data?.kind ?? "normal",
          conditional: targetEdge.data?.conditional,
          parallel: targetEdge.data?.parallel,
          loop: targetEdge.data?.loop
        }),
        createEdge(id, targetEdge.target, "success", "success")
      ]);
    });
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setSaveState("Unsaved changes");
  },
  [edges, nodes, setEdges, setNodes]
);
```

If using `click` as default insert type is too opinionated, use the first non-start/end catalog item or open a chooser. Do not insert fake/invalid node data.

### 4. Build display-only edges with add-button callbacks

Create a memo before render:

```ts
const edgesForCanvas = useMemo(
  () =>
    edges.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        label: edge.data?.label ?? edge.label,
        showAddButton: edge.source !== edge.target,
        onInsertNode: insertNodeOnEdge
      }
    })),
  [edges, insertNodeOnEdge]
);
```

Then change React Flow prop:

```tsx
edges={edgesForCanvas}
```

Do not save `edgesForCanvas`; save original `edges` only.

### 5. Fix canvas body/layout classes

Current flow body uses grid columns and palette width. Keep the palette collapse/resize behavior, but make sure CSS turns the palette into a floating overlay and the React Flow shell fills the area.

If JSX currently has:

```tsx
<div className="flow-designer-body" style={{ gridTemplateColumns: ... }}>
```

Keep the state behavior, but add a template class:

```tsx
<div className="flow-designer-body template-canvas-body" style={{ ... }}>
```

CSS should override layout so React Flow gets full canvas and palette floats.

### 6. Background settings

Keep:

```tsx
<Background gap={22} size={1.5} variant={BackgroundVariant.Dots} />
```

But verify CSS colors via React Flow CSS variables or `Background` props if needed.

### 7. Controls and minimap

Keep existing Controls/MiniMap, but CSS must make them template-like.

### 8. Acceptance criteria

- Add button appears on eligible connectors.
- Clicking add inserts a real node and splits the edge safely.
- Flow save still serializes without callback functions.
- Connector labels render as pills.
- Canvas has no old boxed margin.
- Drawer overlays canvas.

## Verify

```bash
npm run build
npm run verify:flow-designer
```
