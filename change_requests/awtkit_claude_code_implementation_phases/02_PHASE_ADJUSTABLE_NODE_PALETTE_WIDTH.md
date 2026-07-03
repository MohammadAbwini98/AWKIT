# Phase 02 — Adjustable Node Palette Width

## Claude Code Role

You are an expert Electron, React, TypeScript, UI/UX, and workflow-designer engineer.

Work inside the AWTKIT / Playwright Flow Studio project.

Read `AGENTS.md` and existing UI layout components before editing.

---

## Objective

Make the **Node Palette in Flow Designer** width adjustable dynamically.

The Node Palette should not be fixed or cramped. The user should be able to resize it horizontally to get more or less canvas space.

---

## Current Problem

The Node Palette appears fixed-width and may not fit all node types or screen sizes.

Required improvements:

```text
Adjustable width
Scrollable content
Contained elements
Persistent width
Minimum and maximum width
Smooth canvas resize
Good behavior on small screens
```

---

## UI Requirement

In Flow Designer:

```text
┌───────────────┬──────────────────────────┬──────────────────┐
│ Node Palette  │ Canvas                   │ Node Properties  │
│ resizable     │ expands/shrinks          │ optional panel   │
└───────────────┴──────────────────────────┴──────────────────┘
```

Add a vertical resize handle between:

```text
Node Palette | Flow Canvas
```

The user should be able to drag the handle.

---

## Width Rules

Recommended width constraints:

```text
Minimum width: 220px
Default width: 280px
Maximum width: 480px
```

For very small screens:

```text
Palette can collapse or switch to overlay/drawer mode if needed.
```

---

## Persistence

Persist the selected palette width.

Suggested key:

```text
ui.flowDesigner.nodePaletteWidth
```

Storage can be:

```text
existing settings store
localStorage
Electron userData config file
```

Use the project’s existing settings persistence if available.

---

## Scroll Behavior

The Node Palette content must be scrollable.

Requirements:

```text
Palette header stays visible if practical.
Node list scrolls.
All node types are reachable.
No node item appears outside palette.
No accidental page-level horizontal scroll.
```

---

## Accessibility and Usability

Add:

```text
Cursor resize style on handle
Double-click reset width to default if easy
Keyboard-friendly fallback if available
Tooltip: "Resize node palette"
```

---

## Files to Inspect

Look for:

```text
app/renderer/pages/FlowDesigner.tsx
app/renderer/components/workflow/NodePalette.tsx
app/renderer/components/workflow/FlowCanvas.tsx
app/renderer/layout/DesignerCanvasLayout.tsx
app/renderer/styles/workflow-designer.css
app/renderer/stores/*
```

---

## Implementation Steps

1. Locate the Flow Designer layout.
2. Identify the Node Palette component.
3. Add width state with default/min/max values.
4. Add drag resize handle.
5. Persist width.
6. Update canvas layout to use remaining space.
7. Ensure palette content scrolls internally.
8. Ensure the layout is responsive.
9. Test on small and large window sizes.
10. Run typecheck/build.

---

## Acceptance Criteria

```text
Node Palette width can be adjusted by dragging.
Node Palette width persists after navigation/restart.
Node Palette content remains inside its panel.
All palette elements are reachable through scrolling.
Canvas resizes automatically.
No UI elements go out of frame.
```

---

## Final Response Required

After implementation, report:

```text
Files changed
How resizing was implemented
Persistence key used
Responsive behavior
Commands executed
Manual verification results
Remaining limitations
```
