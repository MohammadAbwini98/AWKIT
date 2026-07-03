# Phase 04 — Instances Table Alignment and Control Overflow

## Claude Code Role

You are an expert React, TypeScript, responsive UI, table layout, and desktop app UX engineer.

You are working inside the AWTKIT / Playwright Flow Studio project.

Before making changes, read:

```text
AGENTS.md
README.md
package.json
```

Review the Instances page and component layout.

---

## Objective

Fix the Instances table alignment and overflow issues.

After clearing completed instances, the table alignment becomes corrupted and control buttons overflow the table.

---

## Current Problem

Observed issues:

```text
Instances table columns lose alignment.
Controls column becomes too wide or overflows.
Buttons appear outside table/card boundaries.
Table layout breaks after rows are removed.
Responsive behavior is poor.
```

---

## Required Behavior

The Instances page must remain visually stable:

```text
Before starting runs
During active runs
After completed runs
After clearing completed instances
When many rows exist
When window size changes
```

---

## Table Layout Requirements

Use a robust layout.

Recommended options:

### Option 1 — CSS Grid Row Layout

Use explicit columns:

```text
Instance | Workflow | Status | Current Step | Mode | Duration | Controls
```

Controls column:

```text
Fixed width or minmax with wrapping
```

### Option 2 — HTML Table with Controlled Widths

Use:

```text
table-layout: fixed
overflow-x: auto wrapper
```

### Option 3 — Cards on Small Screens

For small screens:

```text
Convert rows to cards
or allow horizontal scroll
```

Choose the option that best matches the existing project.

---

## Required Columns

Recommended columns:

```text
Instance
Workflow
Status
Run Type
Current Flow / Step
Duration
Actions
```

Actions should fit.

---

## Controls Column Behavior

Controls must not overflow.

Use:

```text
button group
compact icon buttons
wrap if needed
horizontal scroll only inside action cell if absolutely necessary
disabled state for unavailable actions
tooltips
```

Example controls:

```text
Pause
Resume
Stop
Logs
Report
```

On small width, show icons only.

---

## Clear Completed Behavior

When user clicks `Clear Completed`:

```text
Remove completed/failed/cancelled rows.
Keep active/queued rows.
Recalculate layout naturally.
Do not leave empty broken columns.
Show empty state if no rows remain.
```

---

## Responsive Requirements

For narrow screens:

```text
Table wrapper scrolls horizontally
or rows become cards
Buttons remain inside row/card
No content goes outside page frame
```

For large screens:

```text
Columns align cleanly
Actions are right-aligned
Status badges are consistent
```

---

## Empty State

If no instances exist:

```text
No active instances.
Start a workflow run to see instances here.
```

This should not break table layout.

---

## Files to Inspect

Look for:

```text
app/renderer/pages/InstanceMonitor.tsx
app/renderer/pages/Instances.tsx
app/renderer/components/instances/InstanceGrid.tsx
app/renderer/components/instances/InstanceCard.tsx
app/renderer/components/instances/InstanceStatusBadge.tsx
app/renderer/components/instances/ConcurrentRunToolbar.tsx
app/renderer/styles/*
```

---

## Implementation Steps

1. Inspect current Instances table layout.
2. Identify cause of alignment corruption after clearing rows.
3. Refactor table/grid layout with stable columns.
4. Fix action controls width and wrapping.
5. Add responsive behavior.
6. Add empty state after clearing all completed rows.
7. Test with:
   - 0 rows
   - 1 row
   - 5 rows
   - many rows
   - after clear completed
8. Run typecheck/build.

---

## Acceptance Criteria

```text
Instances table stays aligned before and after clearing completed instances.
Controls do not overflow table.
Controls stay inside row/card boundaries.
Empty state appears when no rows remain.
Layout works on small and large windows.
No horizontal page overflow except controlled table scroll if needed.
```

---

## Final Response Required

After implementation, report:

```text
Files changed
Table layout approach used
Responsive behavior
Clear completed behavior
Commands executed
Manual verification results
Remaining limitations
```
