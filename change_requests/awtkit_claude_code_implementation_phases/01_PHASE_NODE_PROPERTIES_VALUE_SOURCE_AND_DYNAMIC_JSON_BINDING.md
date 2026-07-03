# Phase 01 — Node Properties Value Source and Dynamic JSON Binding

## Claude Code Role

You are an expert Electron, React, TypeScript, Playwright, and UI automation framework engineer.

You are working inside the AWTKIT / Playwright Flow Studio project.

Before changing code, read:

```text
AGENTS.md
README.md
package.json
```

Follow the existing architecture and coding style. Reuse current stores, IPC handlers, and profile schemas where possible.

---

## Objective

Refactor **Node Properties in Flow Designer** so the value source model is simple and user-friendly.

Node Properties should support only two value source types:

```text
static
dynamic
```

Where:

```text
static  = direct inserted text value
dynamic = value read from one of the JSON files listed in Data Source Manager
```

Also make **Node Properties collapsible**, with clear sections and scrollable behavior.

---

## User Requirement

### Node Properties can be collapsed

The right-side Node Properties panel in Flow Designer should be collapsible to give more canvas space.

Requirements:

```text
Collapse/expand button
Collapsed state persists
When collapsed, canvas expands
When expanded, all properties are visible
Panel content is scrollable
Advanced sections are collapsible
```

### Value Source Type should be simplified

Remove or hide confusing value source types.

Allowed types only:

```text
Static
Dynamic
```

Static:

```text
User enters a direct value.
```

Dynamic:

```text
User selects a JSON file from Data Source Manager.
User defines key name.
User defines how object ID is resolved.
```

---

## Required UI Behavior

In Node Properties, create this section:

```text
Value Source
  Type:
    - Static
    - Dynamic
```

### Static UI

When Type = Static:

```text
Text Value:
[________________________]
```

Saved model:

```json
{
  "valueSource": {
    "type": "static",
    "value": "Mohammad"
  }
}
```

### Dynamic UI

When Type = Dynamic:

```text
JSON Data Source:
[customers.json ▼]

Object ID Mode:
[Explicit ID ▼] or [Instance Order ID ▼]

If Explicit ID:
  Object ID:
  [1]

Key Name:
[email]

Preview:
mohammad@example.com
```

Saved model, explicit ID:

```json
{
  "valueSource": {
    "type": "dynamic",
    "dataSourceId": "customers-json",
    "idMode": "explicit",
    "objectId": "1",
    "keyName": "email"
  }
}
```

Saved model, runtime instance order ID:

```json
{
  "valueSource": {
    "type": "dynamic",
    "dataSourceId": "customers-json",
    "idMode": "instanceOrder",
    "keyName": "email"
  }
}
```

---

## Dynamic ID Runtime Rule

When dynamic type is selected and `idMode = instanceOrder`:

```text
Instance #1 should resolve JSON object with ID = 1
Instance #2 should resolve JSON object with ID = 2
Instance #3 should resolve JSON object with ID = 3
...
Instance #10 should resolve JSON object with ID = 10
```

The object ID is determined at runtime.

The `keyName` is still inserted manually by the user.

Example:

```text
10 instances selected
customers.json contains objects with ids 1 to 10
Node keyName = email

Instance 1 gets object id 1, key email
Instance 2 gets object id 2, key email
Instance 10 gets object id 10, key email
```

---

## Required JSON Shape Support

Support JSON files that contain either:

### Array root

```json
[
  {
    "id": 1,
    "firstName": "Mohammad",
    "email": "mohammad1@example.com"
  },
  {
    "id": 2,
    "firstName": "Ali",
    "email": "ali@example.com"
  }
]
```

### Object with array property

```json
{
  "customers": [
    {
      "id": 1,
      "firstName": "Mohammad",
      "email": "mohammad1@example.com"
    },
    {
      "id": 2,
      "firstName": "Ali",
      "email": "ali@example.com"
    }
  ]
}
```

For object-with-array files, the data source profile should include the array path:

```json
{
  "id": "customers-json",
  "name": "customers.json",
  "filePath": "data/customers.json",
  "rootArrayPath": "$.customers"
}
```

---

## Required Resolver Behavior

Implement or update the value resolver.

Pseudo behavior:

```ts
if valueSource.type === "static":
  return valueSource.value

if valueSource.type === "dynamic":
  dataSource = loadDataSource(valueSource.dataSourceId)
  rows = readRows(dataSource.filePath, dataSource.rootArrayPath)

  if valueSource.idMode === "explicit":
      id = valueSource.objectId

  if valueSource.idMode === "instanceOrder":
      id = context.instanceOrderNumber

  row = rows.find(x => String(x.id) === String(id))

  if row not found:
      throw friendly error

  if keyName not in row:
      throw friendly error

  return String(row[keyName])
```

---

## Required Instance Context

Ensure each running instance has an order number.

Example:

```ts
export interface InstanceExecutionContext {
  executionId: string;
  instanceId: string;
  instanceOrderNumber: number;
  totalInstances: number;
}
```

Rules:

```text
instanceOrderNumber starts from 1
it must be stable for the whole run
it must be passed to value resolver
it must be included in logs/reports
```

---

## Node Properties Sections

Make sections collapsible:

```text
Basic
Locator
Value Source
Execution
Advanced
```

Required behavior:

```text
The whole properties panel can collapse.
Each section can collapse.
Panel scrolls when content is long.
Collapsed/expanded state persists.
```

---

## Validation Rules

Add validation for dynamic value source:

```text
Data source is required.
Key name is required.
Explicit object ID is required when idMode = explicit.
Data source file must exist.
JSON must be valid.
Object with resolved ID must exist.
Key must exist inside resolved object.
```

Show clear UI errors.

Examples:

```text
No JSON data source selected.
Object with id "5" was not found in customers.json.
Key "email" does not exist in object id "2".
Instance order id "7" was not found in customers.json.
```

---

## Files to Inspect

Look for files similar to:

```text
app/renderer/pages/FlowDesigner.tsx
app/renderer/components/workflow/NodePropertiesForm.tsx
app/renderer/components/workflow/FlowCanvas.tsx
app/renderer/components/data-binding/*
app/renderer/stores/*
src/data/*
src/runner/ValueResolver.ts
src/runner/StepExecutor.ts
src/instances/*
src/storage/*
```

---

## Implementation Steps

1. Find current Node Properties implementation.
2. Add collapsible panel support.
3. Add collapsible sections.
4. Refactor value source UI to static/dynamic only.
5. Update value source TypeScript schema.
6. Update persistence schema for flow nodes.
7. Update value resolver for explicit ID and instance order ID.
8. Ensure instance order number is passed through execution context.
9. Add preview behavior for dynamic values where possible.
10. Add validation and friendly errors.
11. Remove/hide old unsupported value source types from UI.
12. Run typecheck/build.
13. Manually verify static and dynamic binding.

---

## Acceptance Criteria

```text
Node Properties panel can collapse and expand.
Node Properties state persists.
Value Source Type only shows Static and Dynamic.
Static value saves and runs correctly.
Dynamic value can select JSON data source.
Dynamic value supports explicit object ID + key name.
Dynamic value supports instance order ID + key name.
Instance #1 resolves object id 1.
Instance #2 resolves object id 2.
Validation errors are clear.
Old confusing value source types are removed from UI.
```

---

## Final Response Required

After implementation, report:

```text
Files changed
Schema changes
UI changes
Resolver changes
Validation added
Commands executed
Manual verification results
Remaining limitations
```
