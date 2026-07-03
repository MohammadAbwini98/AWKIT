# Phase 03 — Workflow Builder: Collapsible Workflow Data Source Panel

## Claude Code Role

You are an expert React, TypeScript, Electron, UI/UX, data-source management, and workflow-builder engineer.

You are working inside the AWTKIT / Playwright Flow Studio project.

Before making changes, read:

```text
AGENTS.md
README.md
package.json
```

---

## Objective

In **Workflow Builder**, make the **Workflow Data Source** panel collapsible to give more space to the canvas.

---

## Current Problem

The Workflow Data Source section takes permanent space in the left panel:

```text
Workflow Data Source
Data Source dropdown
Root Array Path
Saved Flows
Flow Order
```

The user may not need to see data source settings all the time while arranging nodes on the canvas.

---

## Required Behavior

Make the Workflow Data Source area collapsible independently from other left-panel content.

When expanded:

```text
Data Source dropdown is visible.
Root Array Path is visible.
Validation/record count preview is visible if available.
```

When collapsed:

```text
Show a compact header only.
Show selected data source summary if possible.
Saved Flows and Flow Order should move up or gain more space.
Canvas layout should remain stable.
```

---

## Suggested UI

Expanded:

```text
Workflow Data Source                         [Collapse]
Data Source
[customers.json ▼]
Root Array Path
[$.customers]
10 records found
```

Collapsed:

```text
Workflow Data Source: customers.json      [Expand]
```

If no data source:

```text
Workflow Data Source: None                [Expand]
```

---

## Persistence Requirement

Persist collapsed/expanded state.

Suggested key:

```text
ui.workflowBuilder.workflowDataSourceCollapsed
```

Use existing settings store if available.

---

## Functional Requirements

Collapsing must not lose data.

The following must remain saved:

```text
Selected data source
Root array path
Validation status if stored
Workflow profile dataSource field
```

Expanding should restore the previous values.

---

## Layout Rules

When collapsed:

```text
Left panel consumes less vertical space.
Saved Flows and Flow Order have more room.
Canvas remains aligned.
No content jumps outside frame.
```

---

## Files to Inspect

Look for:

```text
app/renderer/pages/WorkflowBuilder.tsx
app/renderer/pages/WorkflowDesigner.tsx
app/renderer/components/data-binding/*
app/renderer/components/workflow/*
app/renderer/stores/*
src/profiles/*
src/storage/*
```

---

## Implementation Steps

1. Locate Workflow Data Source section.
2. Add collapse/expand state.
3. Persist state.
4. Create compact collapsed summary.
5. Ensure values do not reset when collapsed.
6. Ensure Saved Flows and Flow Order remain usable.
7. Ensure workflow save/load still persists data source.
8. Run typecheck/build.
9. Manually test collapse, expand, save, reload.

---

## Acceptance Criteria

```text
Workflow Data Source panel can collapse.
Workflow Data Source panel can expand.
Selected data source and root path are preserved.
Collapsed state persists after navigation/restart.
Left panel gains usable space when collapsed.
Workflow save/load still preserves data source.
No layout overflow occurs.
```

---

## Final Response Required From Claude Code

After implementation, report:

```text
Files changed
State/persistence key used
Data source UI changes
Workflow persistence verification
Commands executed
Manual verification results
Remaining limitations
```
