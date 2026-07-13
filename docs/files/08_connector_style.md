# File Spec — `app/renderer/components/shared/connectorStyle.ts`

## Goal

Make connectors template-quality and theme-token driven while preserving saved connector compatibility.

## Current issue

`connectorTypeColor` currently uses hardcoded hex values such as green/red/violet/amber. That keeps connectors visually noisy and not fully template-aligned.

## Required changes

### 1. Replace `connectorTypeColor` values with CSS variable strings

Replace the existing export with:

```ts
export const connectorTypeColor: Record<string, string> = {
  // Template default: violet flow lines. Semantic colors are kept for actual runtime/result states.
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

Add the referenced CSS variables in `global.css`:

```css
:root,
[data-theme="light"] {
  --awkit-connector-default: #7c3aed;
  --awkit-connector-selected: #6b21c8;
  --awkit-connector-failure: #d93f45;
  --awkit-connector-success: #35b85f;
  --awkit-connector-warning: #d99017;
  --awkit-connector-loop: #7c3aed;
}
```

### 2. Keep custom saved colors working

Do not change `normalizeEdgeStyle` validation unless needed. It currently accepts hex values only. That is fine for saved custom colors.

### 3. Update `resolveConnectorColor`

Keep custom style override first:

```ts
export function resolveConnectorColor(type: string, style?: EdgeVisualStyle): string {
  return normalizeEdgeStyle(style).color || connectorTypeColor[type] || "var(--awkit-connector-default)";
}
```

### 4. Update `buildConnectorVisual`

Change default shape strategy so template smooth edges use the new custom edge type.

Replace:

```ts
const shape = s.shape ?? (type === "loop" ? "circular" : "smoothstep");
return {
  type: shape,
  animated: type === "loop" || type === "conditional" || type === "loopBack" || type === "parallel",
  style: { stroke, strokeWidth: s.thickness ?? 2, strokeDasharray: dashArray(s.lineStyle) ?? defaultDash },
  markerEnd: ...
};
```

With:

```ts
const shape = s.shape ?? (type === "loop" ? "circular" : "smoothstep");
const reactFlowType = shape === "circular" ? "circular" : shape === "smoothstep" ? "templateSmooth" : shape;

return {
  type: reactFlowType,
  animated: type === "loop" || type === "conditional" || type === "loopBack" || type === "parallel",
  style: {
    stroke,
    strokeWidth: s.thickness ?? 2,
    strokeDasharray: dashArray(s.lineStyle) ?? defaultDash
  },
  markerEnd: markerType ? { type: markerType, width: 18, height: 18, color: stroke } : undefined
};
```

## Important

- If any React Flow surface has not registered `templateSmooth`, it will break. Register it in all relevant canvases.
- Do not alter serialized `EdgeVisualStyle` shape values.
- Do not force custom saved connector colors into CSS variables.

## Verify

```bash
npm run build
npm run verify:flow-designer
npm run verify:workflow-builder
```
