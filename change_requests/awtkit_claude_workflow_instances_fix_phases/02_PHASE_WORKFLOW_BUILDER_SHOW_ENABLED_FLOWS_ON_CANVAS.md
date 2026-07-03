# Phase 02 — Workflow Builder Shows Enabled / Applied Flows on Canvas

## Claude Code Role

You are an expert React, TypeScript, React Flow, Electron, and workflow-builder engineer.

You are working inside the AWTKIT / Playwright Flow Studio project.

Before making changes, read:

```text
AGENTS.md
README.md
package.json
```

Review existing Workflow Builder, Flow Designer, React Flow canvas, and workflow persistence code.

---

## Objective

Fix Workflow Builder so it shows the applied/enabled flows in the drawing area by default.

When a user loads or edits a workflow, all selected workflow flows should appear as nodes on the canvas automatically.

---

## Current Problem

In the current Workflow Builder screen, the saved/applied/enabled flow appears in the Flow Order list, but the drawing area is empty or does not show those flows by default.

This makes the builder confusing because the workflow exists but the canvas does not reflect it.

---

## Required Behavior

When opening Workflow Builder:

```text
If creating a new workflow:
  Show empty canvas with clear empty state.

If loading existing workflow:
  Render all workflow nodes on the canvas.

If user adds a saved flow:
  Add it immediately to canvas and flow order list.

If user removes a flow:
  Remove it from canvas and flow order list.

If user reorders flows:
  Update order badges and optional layout.

If user saves:
  Persist nodes, positions, edges, order, required flags, conditions.
```

---

## Canvas Rendering Rules

Workflow nodes should represent saved flows.

Node label:

```text
Flow Name
Order number
Required/Optional
```

Example:

```text
┌──────────────────────────────┐
│  1  Yahoo-Login              │
│     Required                 │
└──────────────────────────────┘
```

---

## Auto Layout Requirement

If a workflow has nodes but no saved positions, auto-place them.

Suggested default layout:

```text
x = 120 + (index * 260)
y = 180
```

or vertical layout:

```text
x = 260
y = 120 + (index * 140)
```

Use whatever fits existing design.

Once the user moves nodes, persist the new positions.

---

## Existing Workflow Load Behavior

When workflow is selected from dropdown or opened from Workflows Library:

1. Load workflow profile.
2. Load referenced flow profiles.
3. Convert workflow nodes to React Flow nodes.
4. Convert workflow edges to React Flow edges.
5. Render them on canvas.
6. Render same order in Flow Order panel.

---

## Adding Existing Flow

Saved Flows panel should allow:

```text
Click Add
Drag to canvas if supported
Double click to add
```

When added:

```text
Create WorkflowNode
Assign order = max order + 1
Create position
Render on canvas
Mark as unsaved
```

If it is the first node, no edge is required.

If there is a previous node, optionally create default success/always edge:

```text
previous node → new node
```

Only do this if it matches current product behavior. Otherwise, leave unconnected but visibly on canvas.

---

## Required Data Consistency

Keep these synchronized:

```text
workflow.nodes
workflow.edges
React Flow nodes
React Flow edges
Flow Order list
Selected node panel
Selected connector panel
```

Avoid separate disconnected states that drift apart.

---

## Empty State

If no flows are applied:

```text
No flows added to this workflow yet.
Select saved flows from the left panel to build your workflow.
```

Show this inside the canvas.

---

## Validation

Before save/run:

```text
Workflow has at least one flow node.
All workflow nodes reference existing saved flows.
Edges reference existing workflow nodes.
Order numbers are unique.
No duplicate node IDs.
No orphan edge references.
```

---

## Files to Inspect

Look for:

```text
app/renderer/pages/WorkflowBuilder.tsx
app/renderer/pages/WorkflowDesigner.tsx
app/renderer/components/workflow/FlowCanvas.tsx
app/renderer/components/workflow/WorkflowNode.tsx
app/renderer/components/workflow/FlowOrderEditor.tsx
app/renderer/stores/*
src/profiles/*
src/storage/*
```

---

## Implementation Steps

1. Inspect Workflow Builder current state model.
2. Identify source of truth for workflow nodes and flow order.
3. Refactor so workflow profile nodes/edges are the source of truth.
4. On workflow load, map workflow nodes/edges into React Flow state.
5. Auto-layout nodes that lack positions.
6. Persist node positions after drag.
7. Keep Flow Order list synchronized.
8. Add empty state.
9. Add validation.
10. Run typecheck/build.
11. Manually verify loaded workflow shows nodes on canvas.

---

## Acceptance Criteria

```text
Loaded workflow shows all enabled/applied flows on canvas.
Adding a saved flow immediately shows it on canvas.
Removing a flow removes it from canvas.
Flow Order list and canvas stay synchronized.
Node positions persist after save/reload.
Empty canvas shows helpful message.
Workflow save/load preserves canvas nodes and connectors.
```

---

## Final Response Required

After implementation, report:

```text
Files changed
Canvas mapping changes
State synchronization changes
Auto-layout behavior
Persistence changes
Commands executed
Manual verification results
Remaining limitations
```
