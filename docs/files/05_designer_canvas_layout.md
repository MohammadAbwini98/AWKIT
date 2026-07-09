# File Spec — `app/renderer/layout/DesignerCanvasLayout.tsx`

## Goal

Make designer canvases template-like: canvas fills available area and right properties panel floats over it.

## Current issue

Current layout renders right panel as a sibling after the canvas:

```tsx
<section className={className}>
  <div className={flush ? "designer-canvas flush" : "designer-canvas"}>{children}</div>
  {rightPanel ?? <RightPropertiesPanel title={propertiesTitle} />}
</section>
```

This creates panel-as-layout-column behavior. The template uses a floating drawer overlay.

## Required replacement

Replace return with:

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

## Important

- Do not wrap `children` with transform animation. React Flow measurements can break if parent transforms during mount.
- Animate the drawer itself, not the React Flow container.
- Keep `rightCollapsed` class on `section` for CSS targeting.

## Required CSS selectors

Implemented in `global.css`:

```css
.designer-layout
.designer-canvas
.designer-right-drawer-slot
.designer-layout.right-collapsed .designer-right-drawer-slot
```

## Verify

```bash
npm run build
npm run verify:flow-designer
npm run verify:workflow-builder
```
