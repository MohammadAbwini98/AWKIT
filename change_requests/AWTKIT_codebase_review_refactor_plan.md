# AWTKIT Codebase Review & Refactor Plan

## Review Scope

The uploaded archive was inspected at the project structure level. The archive contains an Electron + React + TypeScript application with Playwright-related source modules, renderer pages, sample resources, offline packaging resources, and bundled `node_modules`.

Key structural observations from the archive inventory:

- Main UI pages exist:
  - `FlowChartDesigner.tsx`
  - `ScenarioBuilder.tsx`
  - `WorkflowDesigner.tsx`
  - `DataSourceManager.tsx`
  - `RuntimeInputPanel.tsx`
  - `InstanceMonitor.tsx`
  - `ExecutionMonitor.tsx`
- Runner/orchestrator modules exist:
  - `PlaywrightRunner.ts`
  - `FlowExecutor.ts`
  - `StepExecutor.ts`
  - `ScenarioOrchestrator.ts`
  - `ConcurrentExecutionCoordinator.ts`
  - `InstanceManager.ts`
- Several critical integration files are very small, which strongly suggests placeholder/stub implementation:
  - `app/main/ipc/*.ts`
  - `src/storage/ProfileStore.ts`
  - `src/orchestrator/FlowOrchestrator.ts`
  - `src/orchestrator/FlowOrderResolver.ts`
  - `src/orchestrator/ExecutionQueue.ts`
  - `src/runner/RunnerWorker.ts`
  - `src/runner/RunnerWorkerHost.ts`

This explains why many screens appear implemented visually but are not fully functional.

---

# Main Problem

The implementation currently appears to be UI-first. Many screens exist, but the core application contract is not fully wired:

```text
UI actions
  → IPC
  → profile stores
  → flow/workflow data model
  → orchestrator
  → Playwright runner
  → execution monitor
  → reports/logs
```

The missing or incomplete wiring causes:

- Save/load not working consistently.
- Flow selection not connected to saved flow profiles.
- Scenario Builder not acting as a true workflow builder.
- Workflow Designer not changing execution order or transitions.
- Too many configuration fields without clear behavior.
- UI actions that appear clickable but do not produce real system behavior.

---

# Recommended Product Model

Use this simplified terminology:

```text
Flow
  = One reusable automation unit made of Playwright action nodes.
  Example: Login Flow, Create Customer Flow, Logout Flow.

Workflow
  = A saved orchestration of multiple flows.
  Example: Login Flow → Create Customer Flow → Validate Customer Flow → Logout Flow.

Run Profile
  = Runtime configuration for executing a workflow.
  Example: selected JSON file, runtime dropdown values, instance count, headless/headed mode.

Instance
  = One isolated Playwright execution context.
```

Recommended decision:

```text
Rename Scenario Builder to Workflow Builder
or
Keep Scenario Builder internally, but show it to users as Workflow Builder.
```

The user-facing concept should be:

```text
Flow + Flow + N Flows = Workflow
```

---

# Issue 1 — Flow Chart Designer Should Select Saved Flows or Add New Flow

## Current Problem

The Flow Chart Designer is unclear. It should not create disconnected visual nodes only. Users need to choose from saved flows or create a new flow.

## Required Behavior

The Flow Chart Designer / Workflow Builder should support:

```text
Add Existing Flow
Create New Flow
Clone Existing Flow
Edit Selected Flow
Open Flow Details
Attach Data Source
Bind JSON fields to flow inputs
Configure dropdown runtime values
```

## Required UI

Add a left or top panel:

```text
Saved Flows
[Search flows...]

+ New Flow
+ Import Flow

Available Flows:
- Login Flow
- Create Customer Flow
- Validate Customer Flow
- Logout Flow
```

When user drags or selects a flow, add it as a workflow node.

## Required Node Properties

For each flow node:

```text
Flow Name
Flow ID
Flow Alias
Required / Optional
Execution Order
Input Bindings
JSON Source
Runtime Inputs
Condition Rules
Retry Policy
Failure Policy
```

## Data Source Selection in Node Properties

Inside node properties, add:

```text
Data Source:
[customers.json ▼]

JSON Path:
[$.customer.firstName ▼]

Preview:
Mohammad
```

For dropdown steps:

```text
Dropdown Value Source:
[Runtime UI Input ▼]

Runtime Key:
[selectedAccountType ▼]

Preview:
BUSINESS
```

---

# Issue 2 — Scenario Builder Should Save/Load/Export Workflows

## Current Problem

Scenario Builder should not be only a visual or static page. It must load saved flows, allow ordering and configuration, then save the result as a new workflow.

## Correct Behavior

The user should be able to:

```text
Open Workflow Builder
Choose saved flows
Order flows
Connect flows
Set success/failure/condition links
Configure each flow node
Save as workflow
Load workflow
Clone workflow
Export workflow JSON
Import workflow JSON
Run workflow
```

## Workflow Profile Schema

```json
{
  "id": "customer-onboarding-workflow",
  "name": "Customer Onboarding Workflow",
  "description": "Login, create customer, validate result, then logout",
  "version": 1,
  "nodes": [
    {
      "id": "node-login",
      "type": "flowRef",
      "flowId": "login-flow",
      "alias": "Login",
      "order": 1,
      "required": true,
      "inputBindings": {}
    },
    {
      "id": "node-create-customer",
      "type": "flowRef",
      "flowId": "create-customer-flow",
      "alias": "Create Customer",
      "order": 2,
      "required": true,
      "inputBindings": {
        "firstName": {
          "type": "json",
          "dataSourceId": "customers-json",
          "path": "$.customer.firstName"
        },
        "accountType": {
          "type": "runtimeInput",
          "key": "selectedAccountType"
        }
      }
    }
  ],
  "edges": [
    {
      "id": "edge-login-create",
      "source": "node-login",
      "target": "node-create-customer",
      "type": "success"
    }
  ],
  "runtimeInputs": [
    {
      "key": "selectedAccountType",
      "label": "Account Type",
      "type": "dropdown",
      "required": true
    }
  ],
  "execution": {
    "mode": "sequential",
    "maxConcurrentInstances": 1,
    "stopOnRequiredFlowFailure": true
  }
}
```

---

# Issue 3 — Workflow Designer Order and Direction Not Functional

## Current Problem

Workflow Designer currently appears to show UI but does not affect execution.

## Required Behavior

Workflow order and direction must be persisted and used by the orchestrator.

## Required Implementation

When user connects nodes:

```text
Save edge source and target.
Save edge type.
Recalculate flow order.
Validate graph.
Show execution path.
Use this graph during workflow execution.
```

## Required Order Resolver

Implement graph-based ordering:

```text
1. Validate one start path or valid entry node.
2. Detect cycles unless loop is explicit.
3. Resolve order with topological sort.
4. Respect edge types:
   - success
   - failure
   - always
   - conditional
   - manualApproval
   - loop
5. Store calculated order.
6. Show order badges on nodes.
```

## Workflow Direction

Direction should mean real execution transition:

```text
A → B means run B after A according to connector rule.
```

It should not be only a visual arrow.

---

# Issue 4 — Flow Chart Designer Role Is Unclear

## Recommended Screen Separation

To remove confusion, use these screens:

## 1. Flow Library

Purpose:

```text
List saved flows.
Create new flow.
Edit flow.
Clone flow.
Delete flow.
Import/export flow.
```

## 2. Flow Designer

Purpose:

```text
Design one flow internally.
Add Playwright action nodes:
- click
- fill
- select
- wait
- screenshot
- assertion
```

## 3. Workflow Builder

Purpose:

```text
Select saved flows.
Link them together.
Set flow order.
Configure conditions.
Save as workflow.
```

## 4. Run Workspace

Purpose:

```text
Select workflow.
Select data source.
Set runtime values.
Set instance count.
Run workflow.
Monitor execution.
```

## Recommendation

Remove or rename `Flow Chart Designer`.

Best rename:

```text
Workflow Graph Builder
```

or split it into:

```text
Flow Designer
Workflow Builder
```

---

# Issue 5 — UI Issues Across the Application

## Likely Causes

- No unified design system.
- Too many visible configuration fields.
- Some buttons are not wired.
- Some screens are mock/demo-driven.
- Advanced options are visible too early.
- Similar pages overlap in purpose.

## Required UI Fixes

### 1. Simplify Navigation

Recommended navigation:

```text
Dashboard
Flows
Workflows
Data Sources
Run
Instances
Reports
Settings
Offline Runtime
```

### 2. Hide Unimplemented Features

Do not show buttons or configurations that are not functional.

Use:

```text
Coming Soon
Disabled
Tooltip explaining why disabled
```

### 3. Progressive Disclosure

Show basic fields first.

Example:

```text
Basic:
- Flow name
- Action type
- Locator
- Value source

Advanced:
- Timeout
- Retry
- Failure connector
- Screenshot options
- Manual handoff
```

### 4. Consistent Empty States

Example:

```text
No saved flows yet.
Create your first flow or import one.
[Create Flow] [Import Flow]
```

### 5. Add Help Text

Every unclear config should have:

```text
Label
Short description
Example
Preview
```

---

# Issue 6 — Functional Issues Across the Application

## Main Functional Gaps to Fix

### 1. IPC Layer

The files in `app/main/ipc/*.ts` appear very small and likely incomplete.

Required IPC channels:

```text
flows:list
flows:get
flows:create
flows:update
flows:delete
flows:export
flows:import

workflows:list
workflows:get
workflows:create
workflows:update
workflows:delete
workflows:export
workflows:import

dataSources:list
dataSources:create
dataSources:preview
dataSources:getJsonPaths

execution:validate
execution:runWorkflow
execution:pauseInstance
execution:resumeInstance
execution:stopInstance
execution:stopAll

reports:list
reports:get
```

### 2. Profile Store

`src/storage/ProfileStore.ts` appears too small for the required system.

Implement:

```text
FlowProfileStore
WorkflowProfileStore
DataSourceProfileStore
RuntimeInputProfileStore
InstanceProfileStore
ReportStore
```

### 3. Orchestrator

Some orchestrator files appear very small and likely placeholders.

Implement:

```text
WorkflowOrchestrator
FlowOrchestrator
FlowOrderResolver
ConditionalFlowRouter
ConcurrentExecutionCoordinator
ExecutionQueue
```

### 4. Runner Integration

The UI must call the real runner through IPC.

Required path:

```text
Run button
  → execution IPC
  → pre-run validator
  → workflow orchestrator
  → instance manager
  → Playwright runner
  → live events
  → execution monitor
  → report service
```

### 5. Save/Load

All save/load operations must write to actual profile files or SQLite.

Recommended user data path:

```text
%LOCALAPPDATA%/PlaywrightFlowStudio/
```

---

# Issue 7 — Too Many Configurations Are Unclear or Not Working

## Recommended Fix

Classify every configuration into one of three categories:

```text
Core
Advanced
Unsupported / Future
```

## Core Configs

Show by default:

```text
Flow name
Action type
Locator strategy
Locator value
Value source
Data source
JSON path
Runtime key
Required/optional
Order
Connector type
```

## Advanced Configs

Hide under advanced section:

```text
Timeout
Retry count
Retry delay
Screenshot on failure
Continue on failure
Manual handoff
Storage state
Isolation mode
Download path
```

## Future Configs

Do not show unless implemented:

```text
Scheduler
API monitor
Complex resource policies
Advanced browser window tiling
Advanced offline dependency tools
```

---

# Recommended Immediate Fix Plan

## Milestone 1 — Fix Data Model and Terminology

Deliver:

```text
FlowProfile
WorkflowProfile
DataSourceProfile
RuntimeInputDefinition
InstanceProfile
```

Rename user-facing screens:

```text
Scenario Builder → Workflow Builder
Flow Chart Designer → Flow Designer or Workflow Graph Builder
```

## Milestone 2 — Implement Real Profile Stores

Deliver:

```text
FlowProfileStore
WorkflowProfileStore
DataSourceProfileStore
```

Each store must support:

```text
list
get
create
update
delete
clone
export
import
```

## Milestone 3 — Wire IPC

Implement real IPC for:

```text
Flow CRUD
Workflow CRUD
Data Source CRUD
Execution
Reports
Instances
```

## Milestone 4 — Make Flow Selection Functional

Flow chart/workflow builder must load saved flows.

Required UI:

```text
Saved Flow Picker
Add Existing Flow
Create New Flow
Open/Edit Flow
Flow Node Properties
```

## Milestone 5 — Make Data Binding Easy

Node properties must show:

```text
Data source dropdown
JSON file name
JSON path dropdown/tree
Preview value
Runtime input selector
```

## Milestone 6 — Make Workflow Builder Functional

Implement:

```text
Add flow nodes
Order flow nodes
Connect flow nodes
Configure connector type
Save workflow
Load workflow
Export workflow
Validate workflow
Run workflow
```

## Milestone 7 — Connect Execution

Wire:

```text
Workflow Builder → Run Workspace → Instance Manager → Playwright Runner → Report
```

## Milestone 8 — UI Cleanup

Deliver:

```text
Simplified navigation
Clear screen roles
Disabled unimplemented configs
Tooltips
Consistent forms
Better empty states
```

---

# Suggested Codex / Claude Fix Prompt

```markdown
# Fix AWTKIT Functional and UI Issues

You are an expert Electron, React, TypeScript, and Playwright automation engineer.

Review the full AWTKIT codebase and refactor it so the application becomes a functional visual Playwright automation platform, not only a UI prototype.

## Main Problems to Fix

1. Flow Chart Designer is unclear and not properly connected to saved flows.
2. Scenario Builder is not fully functional for save/load/export.
3. Workflow Designer order and direction are not affecting execution.
4. Flow Chart Designer role overlaps with Workflow Designer.
5. UI has too many unclear or non-working configurations.
6. Many app functions are not wired through IPC/store/orchestrator/runner.
7. Data source selection and JSON value binding should be easier.

## Product Model

Use this model:

- Flow = one reusable automation unit made of action nodes.
- Workflow = ordered/connected group of saved flows.
- Run Profile = runtime data and instance configuration.
- Instance = one isolated Playwright browser context.

User-facing rule:

Flow + Flow + N Flows = Workflow.

## Required Screen Changes

Create or refactor screens into:

1. Flow Library
2. Flow Designer
3. Workflow Builder
4. Data Sources
5. Runtime Inputs
6. Run Workspace
7. Instance Monitor
8. Reports
9. Settings
10. Offline Runtime

Rename Scenario Builder to Workflow Builder or make Scenario a legacy alias internally.

## Required Functional Changes

### Flow Library

Implement:

- List saved flows
- Add new flow
- Edit flow
- Clone flow
- Delete flow
- Import flow
- Export flow

### Flow Designer

The Flow Designer edits one flow internally.

It should allow action nodes:

- Open URL
- Click
- Fill Text
- Select Dropdown
- Checkbox
- Radio Button
- Upload
- Download
- Wait
- Screenshot
- Assertion
- Manual Handoff
- End

### Workflow Builder

The Workflow Builder should allow users to:

- Select from list of saved flows
- Add existing flow to workflow canvas
- Create new flow if missing
- Order flows
- Connect flows
- Set connector type
- Set conditions
- Configure required/optional flows
- Save workflow
- Load workflow
- Clone workflow
- Export workflow
- Import workflow
- Run workflow

### Node Properties

For each flow/action node, allow:

- Select data source by name
- Select JSON file link/name
- Pick JSON path
- Preview resolved value
- Select runtime input key
- Select dropdown value source
- Configure selection by value/label/index

### Data Source Manager

Implement:

- List JSON data sources
- Add JSON data source
- Validate JSON file
- Display JSON tree
- Generate selectable JSON paths
- Preview selected path value
- Link data source to flow/workflow

### Persistence

Implement real stores:

- FlowProfileStore
- WorkflowProfileStore
- DataSourceProfileStore
- RuntimeInputProfileStore
- InstanceProfileStore

Support:

- list
- get
- create
- update
- delete
- clone
- import
- export

### IPC

Implement real IPC channels for:

- flows
- workflows
- dataSources
- runtimeInputs
- execution
- instances
- reports

### Execution Wiring

The Run button must execute this chain:

Workflow Builder
→ execution IPC
→ pre-run validator
→ workflow orchestrator
→ instance manager
→ Playwright runner
→ live events
→ execution monitor
→ report service

### Workflow Execution

Use the saved workflow graph as the source of truth.

Edges must determine execution transitions.

Connector types:

- success
- failure
- always
- conditional
- manualApproval
- loop

Use topological sorting for order where possible.
Reject invalid graphs.
Support explicit loop nodes only.

### UI Cleanup

- Simplify navigation.
- Hide or disable unimplemented configurations.
- Add tooltips and examples.
- Move advanced fields into collapsible Advanced sections.
- Add empty states.
- Add validation messages.
- Use consistent design components.

## Acceptance Criteria

1. User can create a flow and save it.
2. User can select saved flows from Workflow Builder.
3. User can order and connect flows.
4. User can save the connected flows as a workflow.
5. User can load and export workflow.
6. User can bind input fields to JSON source paths.
7. User can bind dropdown selections to runtime UI values.
8. User can run a saved workflow.
9. Execution order follows the workflow graph.
10. UI no longer shows non-working configurations as active features.
```
