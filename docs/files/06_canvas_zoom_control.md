# File Spec — `app/renderer/components/workflow/CanvasZoomControl.tsx`

## Goal

Bottom-center zoom control must match the template pill.

## Current state

Current component already uses React Flow:

```tsx
<Panel position="bottom-center" className="canvas-zoom-control">
  <button>minus</button>
  <button className="zoom-value">{percent}%</button>
  <button>plus</button>
  <button>fit</button>
</Panel>
```

## Required changes

### 1. Keep the existing functionality

Do not add fake Ask AI. Do not add undo/redo unless real undo/redo exists.

### 2. Add semantic class names to buttons

Change button markup to:

```tsx
<button className="canvas-zoom-button" ...>
...
</button>
<button type="button" className="canvas-zoom-button zoom-value" ...>
  {percent}%
</button>
<button className="canvas-zoom-button" ...>
...
</button>
<button className="canvas-zoom-button" ...>
...
</button>
```

### 3. Optional divider

If visual matching needs it, insert:

```tsx
<span className="canvas-zoom-divider" aria-hidden="true" />
```

before the fit button.

## CSS required

Style in `global.css`:

```text
.canvas-zoom-control
.canvas-zoom-button
.canvas-zoom-divider
.zoom-value
```

## Verify

```bash
npm run build
npm run verify:flow-designer
npm run verify:workflow-builder
```
