# Phase 02 — Workflow Builder: Compact Header Layout

## Claude Code Role

You are an expert React, TypeScript, Electron, UI/UX, and responsive desktop layout engineer.

You are working inside the AWTKIT / Playwright Flow Studio project.

Before making changes, read:

```text
AGENTS.md
README.md
package.json
```

---

## Objective

Re-arrange the **Workflow Builder** header buttons and fields to minimize vertical height and give more space to the canvas.

---

## Current Problem

The Workflow Builder header area is too tall. It includes:

```text
Workflow selector
Name field
Mode dropdown
Max Parallel field
Save / Load buttons
Export / Run / Valid status
Possibly repeated Save/Run buttons in top app header
```

This consumes too much vertical space and reduces canvas area.

---

## Required Behavior

Make the Workflow Builder header compact, clean, and horizontally efficient.

The header should have two compact rows maximum, preferably one main row and one optional action row.

---

## Recommended Compact Layout

### Top App Header

Keep only global/page-level actions:

```text
Back button
Workflow Builder title
Save
Run
```

Avoid duplicate Save/Run buttons inside the page if top header already has them.

### Workflow Builder Toolbar

Use a compact toolbar:

```text
Workflow: [Mock ▼]  Name: [Mock]  Mode: [Sequential ▼]  Max Parallel: [1]  [Load] [Export] [Validate]
```

Or:

```text
[Workflow ▼] [Name] [Mode ▼] [Max Parallel]       [Load] [Export] [Validate]
```

Keep vertical height low.

---

## Button Rules

Remove duplicate or unnecessary buttons.

Use button grouping:

```text
Primary: Save, Run
Secondary: Load, Export, Validate
```

If actions are page-specific, keep them in the page toolbar.

If actions are global header actions, do not duplicate them inside the page.

---

## Field Rules

Fields should have compact labels or inline labels.

Examples:

```text
Workflow
[Mock ▼]

Name
[Mock]
```

can become:

```text
Workflow: [Mock ▼]   Name: [Mock]
```

Keep accessibility labels available.

---

## Responsive Rules

For smaller screens:

```text
Fields wrap into two rows.
Buttons remain inside toolbar.
No fields go out of frame.
Toolbar height stays reasonable.
```

For large screens:

```text
Toolbar stays mostly one row.
Canvas starts higher on the page.
```

---

## Persistence / Behavior

Do not break existing behavior:

```text
Workflow selection still loads workflow.
Name field still updates workflow name.
Mode still persists.
Max Parallel still persists.
Save still saves.
Run still runs.
Load still loads.
Export still exports.
Validate still validates.
```

---

## Files to Inspect

Look for:

```text
app/renderer/pages/WorkflowBuilder.tsx
app/renderer/layout/TopHeader.tsx
app/renderer/layout/PageHeader.tsx
app/renderer/components/shared/*
app/renderer/styles/*
```

---

## Implementation Steps

1. Inspect current Workflow Builder header layout.
2. Identify duplicate buttons between app header and page toolbar.
3. Remove or consolidate duplicate actions.
4. Re-arrange fields into compact toolbar.
5. Ensure all fields remain functional.
6. Ensure Save/Run/Load/Export/Validate still call existing handlers.
7. Add responsive wrapping.
8. Run typecheck/build.
9. Manually compare canvas height before/after.

---

## Acceptance Criteria

```text
Workflow Builder header height is reduced.
Header buttons are not duplicated unnecessarily.
Workflow selector, Name, Mode, and Max Parallel fields still work.
Save/Run/Load/Export/Validate remain functional.
Canvas has more vertical space.
Header remains responsive on smaller windows.
No controls overflow.
```

---

## Final Response Required From Claude Code

After implementation, report:

```text
Files changed
Header layout changes
Removed/merged buttons
Responsive behavior
Commands executed
Manual verification results
Remaining limitations
```
