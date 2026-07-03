# Phase 03 — Each Workflow Has Its Own Data Source

## Claude Code Role

You are an expert Electron, React, TypeScript, data modeling, and Playwright workflow automation engineer.

Work inside the AWTKIT / Playwright Flow Studio project.

Read `AGENTS.md` and inspect the current flow/workflow/profile storage before editing.

---

## Objective

Change the system model so **each workflow owns or selects its own data source**.

This makes workflow execution easier and avoids confusion when multiple JSON files exist in Data Source Manager.

---

## Product Rule

Each workflow should have a selected data source.

```text
Workflow → Data Source
```

The data source should be one of the JSON files listed in Data Source Manager.

Node Properties can still reference a data source explicitly if needed, but the default behavior should be:

```text
Use current workflow data source
```

---

## Data Source Manager Simplification

Data Source Manager should only be a table of JSON files.

It should not be a complex binding screen.

Required table columns:

```text
Name
File Path / Stored Path
Root Array Path
Record Count
Status
Created At
Updated At
Actions
```

Actions:

```text
Add JSON
Browse
Validate
Preview
Edit Metadata
Delete
```

Optional:

```text
Copy JSON path
Open file location
```

---

## Workflow Data Source UI

In Workflow Builder / Workflow Designer, add a workflow-level section:

```text
Workflow Data Source
[customers.json ▼]

Root Array Path:
[$.customers]

Preview:
10 records found
```

When user saves the workflow, persist the selected data source.

---

## Workflow Profile Schema

Update workflow schema:

```json
{
  "id": "customer-onboarding-workflow",
  "name": "Customer Onboarding Workflow",
  "dataSource": {
    "dataSourceId": "customers-json",
    "rootArrayPath": "$.customers"
  },
  "nodes": [],
  "edges": [],
  "execution": {
    "mode": "sequential",
    "maxConcurrentInstances": 1
  }
}
```

---

## Node-Level Dynamic Source Behavior

For dynamic node value sources, allow this:

```json
{
  "valueSource": {
    "type": "dynamic",
    "dataSourceScope": "workflow",
    "idMode": "instanceOrder",
    "keyName": "email"
  }
}
```

This means:

```text
Use the workflow selected data source.
Resolve ID based on instance order.
Get the key name from the matched object.
```

Also allow explicit data source override if required:

```json
{
  "valueSource": {
    "type": "dynamic",
    "dataSourceScope": "specific",
    "dataSourceId": "other-json",
    "idMode": "explicit",
    "objectId": "1",
    "keyName": "email"
  }
}
```

Default should be:

```text
dataSourceScope = workflow
```

---

## Runtime Behavior

When running a workflow:

1. Load workflow.
2. Load workflow data source.
3. Validate JSON.
4. Determine record count.
5. Pass workflow data source context into all flow/node executions.
6. If dynamic value source uses `dataSourceScope = workflow`, resolve from workflow data source.
7. If dynamic value source uses `dataSourceScope = specific`, resolve from the specific data source.

---

## Instance Order Behavior

For concurrent instances:

```text
Instance 1 → object id 1
Instance 2 → object id 2
Instance 3 → object id 3
```

The workflow data source must contain matching IDs.

If not, show error:

```text
Workflow data source does not contain object id 3 required by instance 3.
```

---

## UI Changes Required

### Workflow Builder

Add:

```text
Data Source dropdown
Root array path selector or input
Record count preview
Validation status
```

### Node Properties

For dynamic value source:

```text
Data Source Scope:
  - Use Workflow Data Source
  - Choose Specific Data Source

If Use Workflow Data Source:
  hide JSON file dropdown
  show workflow selected data source name

If Choose Specific Data Source:
  show JSON file dropdown
```

### Instances Page

When user selects a workflow:

```text
Show workflow data source name.
Show record count.
Warn if total runs exceeds available records when using instance order ID.
```

---

## Validation Rules

Workflow validation should check:

```text
Workflow has data source if any node uses dynamic workflow data source.
Selected data source exists.
JSON is valid.
Root array path is valid.
Record/object IDs are available.
Key names used by dynamic nodes exist.
Total runs do not exceed matching records when using instance order ID unless allowed.
```

---

## Files to Inspect

Look for:

```text
app/renderer/pages/WorkflowDesigner.tsx
app/renderer/pages/ScenarioBuilder.tsx
app/renderer/pages/DataSourceManager.tsx
app/renderer/pages/InstanceMonitor.tsx
app/renderer/components/workflow/*
app/renderer/components/data-binding/*
app/renderer/stores/*
src/profiles/*
src/data/*
src/storage/*
src/orchestrator/*
src/runner/ValueResolver.ts
```

---

## Implementation Steps

1. Inspect current workflow/scenario schema.
2. Add workflow-level data source field.
3. Update workflow save/load/export/import.
4. Simplify Data Source Manager to JSON table.
5. Add workflow data source selector UI.
6. Update Node Properties dynamic source UI to use workflow source by default.
7. Update resolver to support workflow-level data source context.
8. Update Instances page to display selected workflow data source.
9. Add validation.
10. Run typecheck/build.
11. Manually test with one workflow and one JSON data source.

---

## Acceptance Criteria

```text
Each workflow can select and save its own data source.
Workflow reload restores selected data source.
Data Source Manager shows simple table of JSON files.
Dynamic nodes can use workflow data source.
Dynamic nodes can optionally override with specific data source.
Instances page shows selected workflow data source.
Validation catches missing/invalid data source.
```

---

## Final Response Required

After implementation, report:

```text
Files changed
Schema changes
Data Source Manager changes
Workflow Builder changes
Node Properties changes
Resolver changes
Validation added
Commands executed
Manual verification results
Remaining limitations
```
