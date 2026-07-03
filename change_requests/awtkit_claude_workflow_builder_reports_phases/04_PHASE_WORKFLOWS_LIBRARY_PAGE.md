# Phase 04 — Workflows Library Page

## Claude Code Role

You are an expert Electron, React, TypeScript, local persistence, IPC, and workflow automation engineer.

You are working inside the AWTKIT / Playwright Flow Studio project.

Before making changes, read:

```text
AGENTS.md
README.md
package.json
```

---

## Objective

Create or fix a page that shows all available and created workflows.

The user should be able to manage workflows from this page.

---

## Current Problem

The application has Workflow Builder, but there should also be a dedicated page that lists all workflows.

The user needs a central place to:

```text
See all workflows.
Open a workflow.
Create a new workflow.
Clone a workflow.
Delete a workflow.
Export a workflow.
Run a workflow.
```

---

## Required Page

Create/fix:

```text
Workflows
```

Suggested route:

```text
/workflows
```

If the project already has a workflow list route, use/fix it.

---

## Navigation

Add/update sidebar item:

```text
Workflows
```

Do not confuse it with:

```text
Flow Designer
Workflow Builder
Workflow Designer
```

Recommended navigation:

```text
Flows
Flow Designer
Form Designer
Workflows
Workflow Builder
Data Sources
Runtime Inputs
Run
Instances
Reports
Settings
```

If too many workflow items exist, simplify labels.

---

## Workflows Page UI

Display table or cards.

Recommended columns:

```text
Workflow Name
Description
Number of Flows
Data Source
Execution Mode
Max Parallel
Updated At
Validation Status
Actions
```

Actions:

```text
Open/Edit
Run
Clone
Export
Delete
```

Top actions:

```text
Create Workflow
Import Workflow
Refresh
```

Empty state:

```text
No workflows created yet.
Create your first workflow by linking saved flows.
[Create Workflow]
```

---

## Persistence Requirements

Workflows page must load from real persisted workflow profiles.

Do not use hardcoded workflows.

Support:

```text
list workflows
get workflow
create workflow
update workflow
clone workflow
delete workflow
export workflow
import workflow if existing import pattern exists
```

Use current persistence approach if implemented.

Recommended path:

```text
Electron app.getPath("userData")/workflows
```

---

## IPC Requirements

If Electron IPC is used, implement/fix:

```text
workflows:list
workflows:get
workflows:create
workflows:update
workflows:delete
workflows:clone
workflows:export
workflows:import
```

If existing names differ, use existing names consistently.

---

## Workflow Builder Integration

From Workflows page:

```text
Create Workflow → opens Workflow Builder in new mode.
Open/Edit → opens selected workflow in Workflow Builder.
Clone → duplicates workflow and refreshes list.
Run → opens Run/Instances page with workflow selected or starts configured run if app supports it.
Delete → confirms and removes workflow.
Export → writes workflow JSON.
```

---

## Validation

Before showing workflow as valid:

```text
Workflow has name.
All referenced flows exist.
Edges reference existing nodes.
Data source exists if required.
Execution settings are valid.
```

Show status:

```text
Valid
Invalid
Missing Flow
Missing Data Source
```

---

## Files to Inspect

Look for:

```text
app/renderer/pages/WorkflowBuilder.tsx
app/renderer/pages/WorkflowDesigner.tsx
app/renderer/pages/Flows.tsx
app/renderer/pages/*
app/renderer/layout/LeftNavigation.tsx
app/renderer/routes.tsx
app/renderer/stores/*
app/main/ipc/*
src/profiles/*
src/storage/*
```

---

## Implementation Steps

1. Check if a workflows list page already exists.
2. If missing, create it.
3. Add route/navigation.
4. Implement/fix workflow list loading from store/IPC.
5. Implement Create/Open/Edit/Clone/Delete/Export actions.
6. Add empty state.
7. Add validation status.
8. Link page to Workflow Builder.
9. Run typecheck/build.
10. Manually create multiple workflows and confirm they appear.

---

## Acceptance Criteria

```text
There is a page showing all available/created workflows.
The list is loaded from real persisted workflows.
User can create a new workflow.
User can open/edit an existing workflow.
User can clone a workflow.
User can delete a workflow with confirmation.
User can export workflow JSON.
Workflow list persists after app restart.
No hardcoded/demo workflows are shown as real workflows.
```

---

## Final Response Required From Claude Code

After implementation, report:

```text
Files changed
Files added
Route/navigation changes
Workflow store/IPC changes
Actions implemented
Commands executed
Manual verification results
Remaining limitations
```
