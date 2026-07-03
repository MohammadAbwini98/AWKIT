# Phase 01 — Workflows Library and Multiple Workflows

## Claude Code Role

You are an expert Electron, React, TypeScript, local persistence, and workflow automation engineer.

You are working inside the AWTKIT / Playwright Flow Studio project.

Before making changes, read:

```text
AGENTS.md
README.md
package.json
```

If available, also inspect:

```text
CLAUDE.md
GEMINI.md
src/profiles/
src/storage/
app/main/ipc/
app/renderer/pages/
app/renderer/stores/
```

Follow existing project architecture and coding style.

---

## Objective

Fix the Workflow Builder model so the user can create, save, load, edit, clone, delete, export, and manage **multiple workflows**.

There must be a dedicated page that shows all saved workflows.

---

## Current Problem

The application appears to have a Workflow Builder screen, but it does not behave like a full workflow management area.

Required behavior:

```text
User can create many workflows.
User can see all workflows in a list/table/cards page.
User can open an existing workflow.
User can edit and save workflow.
User can clone workflow.
User can delete workflow.
User can export workflow.
User can import workflow if existing import pattern exists.
```

---

## Required Screens

Implement or fix these screens:

### 1. Workflows Library Page

A page showing all workflows.

Suggested route:

```text
/workflows
```

or reuse existing navigation item if already present.

Suggested user-facing name:

```text
Workflows
```

This page should not be the same as Flow Designer.

### 2. Workflow Builder Page

A page for creating/editing one workflow.

Suggested route examples:

```text
/workflows/new
/workflows/:workflowId
```

If the current project does not use route params, use the existing routing approach.

---

## Workflows Library UI

The Workflows Library should show a table or cards.

Required columns/details:

```text
Workflow Name
Description
Number of flows
Data source name
Execution mode
Max parallel
Updated at
Status/validity
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
Create New Workflow
Import Workflow
Refresh
```

Empty state:

```text
No workflows yet.
Create your first workflow by selecting saved flows and linking them.
[Create Workflow]
```

---

## Workflow Profile Schema

Ensure workflow profiles support multiple saved records.

Minimum schema:

```ts
export interface WorkflowProfile {
  id: string;
  name: string;
  description?: string;
  version: number;

  dataSource?: {
    dataSourceId?: string;
    rootArrayPath?: string;
  };

  nodes: WorkflowNode[];
  edges: WorkflowEdge[];

  execution: {
    mode: "sequential" | "parallel" | "conditional";
    maxParallel: number;
    stopOnRequiredFlowFailure: boolean;
    continueOptionalFailures: boolean;
    screenshotOnFailure: boolean;
  };

  createdAt: string;
  updatedAt: string;
}
```

Workflow node should usually reference a saved flow:

```ts
export interface WorkflowNode {
  id: string;
  type: "flowRef";
  flowId: string;
  label: string;
  order: number;
  required: boolean;
  position?: { x: number; y: number };
  inputBindings?: Record<string, unknown>;
}
```

---

## Persistence Requirements

Implement/fix workflow persistence with real storage.

Support:

```text
list
get
create
update
delete
clone
export
import if applicable
```

Use existing persistence if available.

Recommended runtime path:

```text
Electron app.getPath("userData")/workflows
```

or the project’s existing profile folder.

Do not write runtime user workflows into source-controlled resource folders.

---

## IPC Requirements

If the app uses Electron IPC, implement/fix channels similar to:

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

All UI workflow actions must call the real store/IPC and not only update temporary React state.

---

## Navigation Requirements

Update sidebar/navigation:

```text
Flows
Flow Designer
Workflows
Workflow Builder
Run
Instances
Reports
```

Recommended:

```text
Workflows
  Shows all saved workflows.

Workflow Builder
  Opens new workflow or current selected workflow.
```

Avoid duplicate/confusing menu items if possible.

---

## Workflow Builder Save Behavior

Workflow Builder should support:

```text
New workflow creation.
Editing existing workflow.
Save.
Save As / Clone.
Load existing workflow.
Export.
Delete with confirmation.
```

When user clicks Save:

```text
Validate workflow name.
Persist workflow profile.
Show success message.
Update Workflows Library list.
Keep the workflow selected/loaded.
```

---

## Validation Rules

Before saving:

```text
Workflow name is required.
Workflow ID is unique for new workflows.
All referenced flow IDs exist.
Node IDs are unique.
Edges reference existing nodes.
Max parallel >= 1.
If workflow uses dynamic data source, selected data source must exist.
```

---

## Files to Inspect

Look for:

```text
app/renderer/pages/WorkflowBuilder.tsx
app/renderer/pages/WorkflowDesigner.tsx
app/renderer/pages/Roadmap.tsx
app/renderer/components/workflow/*
app/renderer/stores/*
app/main/ipc/*
src/profiles/*
src/storage/*
src/orchestrator/*
```

---

## Implementation Steps

1. Inspect current workflow/scenario storage.
2. Determine whether workflows are already persisted or mocked.
3. Create/fix WorkflowProfile schema.
4. Create/fix WorkflowProfileStore.
5. Add/fix IPC channels for workflow CRUD.
6. Add Workflows Library page.
7. Wire navigation.
8. Wire Workflow Builder save/load/clone/export/delete.
9. Add empty state and validation.
10. Run typecheck/build.
11. Manually create two workflows and confirm both appear in the library.

---

## Acceptance Criteria

```text
User can create multiple workflows.
User can view all saved workflows on a dedicated page.
User can open/edit a workflow.
User can save workflow changes.
User can clone workflow.
User can delete workflow with confirmation.
User can export workflow JSON.
Workflow list persists after app restart.
No workflow list is hardcoded/demo-only.
```

---

## Final Response Required

After implementation, report:

```text
Files changed
Files added
Workflow schema changes
Persistence changes
IPC changes
UI/navigation changes
Commands executed
Manual verification results
Remaining limitations
```
