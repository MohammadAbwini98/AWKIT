# New File Spec — `app/renderer/components/shared/TemplateSmoothEdge.tsx`

## Goal

Create a custom React Flow edge that matches the template:

- smooth violet connector
- label pill
- optional plus/add button
- selected/hover CSS support
- running animation support through React Flow `animated`

## Create this file

```tsx
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps
} from "@xyflow/react";
import { Plus } from "lucide-react";

export interface TemplateSmoothEdgeData extends Record<string, unknown> {
  label?: string;
  showAddButton?: boolean;
  onInsertNode?: (edgeId: string) => void;
}

export function TemplateSmoothEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
  selected
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16
  });

  const edgeData = data as TemplateSmoothEdgeData | undefined;
  const label = edgeData?.label;
  const showAddButton = Boolean(edgeData?.showAddButton && edgeData?.onInsertNode);

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {label ? (
          <div
            className={selected ? "template-edge-label selected" : "template-edge-label"}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 16}px)` }}
          >
            {label}
          </div>
        ) : null}
        {showAddButton ? (
          <button
            className="template-edge-add-button"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            type="button"
            title="Insert node here"
            aria-label="Insert node here"
            onClick={(event) => {
              event.stopPropagation();
              edgeData?.onInsertNode?.(id);
            }}
          >
            <Plus size={14} />
          </button>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
}
```

## Notes

- This edge intentionally does not store callback functions in saved flow JSON. Add callbacks only to canvas-rendered edge data via `useMemo` in canvas pages.
- If TypeScript complains about generic `EdgeProps`, adjust to match installed `@xyflow/react` 12.3.6 typing.
- Use CSS classes from `global.css`.

## Register it in canvases

In each React Flow canvas with `edgeTypes`, add:

```ts
import { TemplateSmoothEdge } from "../components/shared/TemplateSmoothEdge";

const edgeTypes = {
  templateSmooth: TemplateSmoothEdge,
  circular: SelfLoopEdge
} satisfies EdgeTypes;
```

Adjust relative import path depending on file location.

## Verify

```bash
npm run build
npm run verify:flow-designer
npm run verify:workflow-builder
```
