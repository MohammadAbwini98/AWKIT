# Phase 4 — Scenario Orchestration & Flow Linking

## Objective

Allow users to link multiple reusable flows together into complete scenarios and determine execution order visually.

## What Is a Scenario?

A **scenario** is a higher-level automation profile that connects multiple flows.

Example:

```text
Customer Onboarding Scenario
   1. Login Flow
   2. Open Customer Page Flow
   3. Create Customer Flow
   4. Validate Customer Flow
   5. Logout Flow
```

## Flow Linking Modes

The system must support:

```text
Sequential
Conditional
Parallel
Loop
Manual
```

## Sequential Flow

```text
Login Flow → Create Customer Flow → Validate Customer Flow → Logout Flow
```

## Conditional Flow

```text
Login Flow
   → on success: Create Customer Flow
   → on failure: Stop Scenario
```

## Parallel Flow

```text
Download Report A
Download Report B
Download Report C
```

All run at the same time if allowed by the instance/concurrency settings.

## Loop Flow

```text
For each row in customers.json:
   Run Create Customer Flow
```

## Manual Flow

```text
Submit Request Flow
   → pause for human review
   → Resume
   → Approval Flow
```

## Scenario Profile Example

```json
{
  "id": "customer-onboarding-scenario",
  "name": "Customer Onboarding Scenario",
  "description": "Login, create customer, validate result, then logout",
  "executionMode": "sequential",
  "maxParallelFlows": 1,
  "flows": [
    {
      "order": 1,
      "flowId": "login-flow",
      "required": true
    },
    {
      "order": 2,
      "flowId": "create-customer-flow",
      "required": true
    },
    {
      "order": 3,
      "flowId": "validate-customer-flow",
      "required": true
    },
    {
      "order": 4,
      "flowId": "logout-flow",
      "required": false
    }
  ],
  "links": [
    {
      "id": "login-to-create",
      "sourceFlowId": "login-flow",
      "targetFlowId": "create-customer-flow",
      "type": "success"
    },
    {
      "id": "create-to-validate",
      "sourceFlowId": "create-customer-flow",
      "targetFlowId": "validate-customer-flow",
      "type": "success"
    },
    {
      "id": "validate-to-logout",
      "sourceFlowId": "validate-customer-flow",
      "targetFlowId": "logout-flow",
      "type": "always"
    }
  ],
  "failurePolicy": {
    "stopOnRequiredFlowFailure": true,
    "continueOnOptionalFlowFailure": true,
    "takeScreenshotOnFailure": true
  }
}
```

## Flow Link Types

```text
success
failure
always
conditional
manualApproval
loop
```

## Flow Link Example

```json
{
  "id": "approval-to-end",
  "sourceFlowId": "cfo-approval-flow",
  "targetFlowId": "end-flow",
  "type": "success",
  "label": "Approved"
}
```

## Conditional Link Example

```json
{
  "id": "amount-condition",
  "sourceFlowId": "submit-request-flow",
  "targetFlowId": "cfo-approval-flow",
  "type": "conditional",
  "condition": {
    "expression": "${outputs.submit-request-flow.amount} > 10000"
  }
}
```

## Flow Order Editor

The app should allow ordering by:

```text
Dragging flow cards
Editing order number
Connecting arrows visually
Using dependency resolver
```

## Orchestrator Responsibilities

The `ScenarioOrchestrator` should:

```text
Read scenario profile
Load required flow profiles
Validate links and dependencies
Resolve execution order
Start flows sequentially or in parallel
Pass runtime inputs
Pass flow outputs
Handle retries
Handle required vs optional flows
Apply failure policy
Trigger manual handoff
Update execution monitor
Write final scenario report
```

## Flow Output Passing

A flow can output data.

Example:

```json
{
  "flowId": "create-customer-flow",
  "outputs": {
    "customerId": {
      "fromStep": "read-customer-id",
      "type": "text"
    }
  }
}
```

Another flow can consume it:

```json
{
  "flowId": "validate-customer-flow",
  "inputs": {
    "customerId": "${outputs.create-customer-flow.customerId}"
  }
}
```

## Deliverables

- Scenario builder screen.
- Flow linker UI.
- Flow order editor.
- Scenario profile schema.
- Scenario orchestrator.
- Conditional route support.
- Required/optional flow support.
- Flow output passing.


## Update: Concurrent Scenario Runs

A scenario can be executed multiple times concurrently. Data-driven runs should assign each JSON row to an instance and queue remaining rows when the row count exceeds the `maxConcurrentInstances` setting.
