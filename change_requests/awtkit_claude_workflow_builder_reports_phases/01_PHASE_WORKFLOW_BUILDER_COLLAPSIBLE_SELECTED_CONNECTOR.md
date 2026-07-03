# Phase 01 — Workflow Builder: Collapsible Selected Connector Panel

## Claude Code Role

You are an expert React, TypeScript, Electron, React Flow, and workflow-builder UI engineer.

You are working inside the AWTKIT / Playwright Flow Studio project.

Before making changes, read:

```text
AGENTS.md
README.md
package.json
```

Follow the existing architecture and coding style.

---

## Objective

In **Workflow Builder**, make the **Selected Connector** panel collapsible so the user can get more canvas space.

---

## Current Problem

The right panel contains sections like:

```text
Selected Connector
Failure Policy
Binding Preview
Validation
```

This panel takes significant horizontal space even when the user only wants to design the workflow canvas.

The user should be able to collapse this panel and expand it when needed.

---

## Required Behavior

Add a collapse/expand control for the right-side connector/properties panel.

When expanded:

```text
The right panel shows Selected Connector details.
The panel has normal width.
The canvas uses the remaining space.
```

When collapsed:

```text
The right panel shrinks to a narrow rail or disappears.
The canvas expands to use the freed space.
A visible expand button remains.
```

---

## UI Requirements

The panel should have a header like:

```text
Selected Connector                    [Collapse]
```

When collapsed, show:

```text
[>] Connector
```

or an icon-only rail with tooltip:

```text
Show connector details
```

The collapsed state must be easy to discover.

---

## Persistence Requirement

Persist the collapsed/expanded state.

Suggested key:

```text
ui.workflowBuilder.selectedConnectorCollapsed
```

Use existing settings store if available. Otherwise use localStorage or app settings.

---

## Layout Rules

The Workflow Builder layout should respond immediately:

```text
Collapsed right panel → canvas width increases.
Expanded right panel → canvas width decreases but remains usable.
No horizontal page overflow.
No components pushed outside frame.
```

---

## Content Scroll Rule

When expanded, the right panel content should be internally scrollable.

Long sections must not push content outside the screen.

---

## Files to Inspect

Look for:

```text
app/renderer/pages/WorkflowBuilder.tsx
app/renderer/pages/WorkflowDesigner.tsx
app/renderer/components/workflow/*
app/renderer/components/shared/*
app/renderer/stores/*
app/renderer/styles/*
```

---

## Implementation Steps

1. Locate the Workflow Builder right-side panel implementation.
2. Add collapsed/expanded state.
3. Persist state.
4. Add collapse/expand button.
5. Update grid/flex layout so canvas expands when collapsed.
6. Ensure selected connector content scrolls when expanded.
7. Add tooltip/title for collapsed state.
8. Run typecheck/build.
9. Manually verify canvas space increases.

---

## Acceptance Criteria

```text
Selected Connector panel can collapse.
Selected Connector panel can expand again.
Canvas gains space when the panel is collapsed.
Collapsed state persists after navigation/restart.
No layout overflow occurs.
Panel content remains scrollable when expanded.
```

---

## Final Response Required From Claude Code

After implementation, report:

```text
Files changed
State/persistence key used
Layout changes
Manual verification results
Commands executed
Remaining limitations
```
