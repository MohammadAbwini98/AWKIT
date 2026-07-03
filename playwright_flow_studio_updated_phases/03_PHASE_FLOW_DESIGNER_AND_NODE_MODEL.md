# Phase 3 — Flow Designer & Node Model

## Objective

Create a visual flow designer where users build reusable Playwright automation flows by dragging, configuring, and connecting action nodes.

## What Is a Flow?

A **flow** is one reusable automation unit.

Examples:

```text
Login Flow
Create Customer Flow
Download Report Flow
Upload File Flow
Search Customer Flow
Logout Flow
```

A flow contains connected steps.

## Supported Step Nodes

```text
Start
Open URL
Click
Fill Text
Select Dropdown
Check Checkbox
Uncheck Checkbox
Select Radio Button
Scroll
Wait
Upload File
Download File
Read Text
Assert Text
Assert Element Visible
Take Screenshot
Manual Handoff
Condition
Loop
Run Another Flow
End
```

## Node Configuration Model

Each node should have:

```text
ID
Name
Type
Description
Position on canvas
Input handles
Output handles
Locator configuration if needed
Value source if needed
Timeout
Retry policy
Failure behavior
Screenshot setting
Next step reference
Output variable mapping
```

## Flow Profile Example

```json
{
  "id": "login-flow",
  "name": "Login Flow",
  "description": "Logs into the application",
  "version": 1,
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "name": "Start",
      "position": { "x": 250, "y": 50 },
      "next": "open-login"
    },
    {
      "id": "open-login",
      "type": "goto",
      "name": "Open Login Page",
      "url": "${BASE_URL}/login",
      "position": { "x": 250, "y": 170 },
      "next": "fill-username"
    },
    {
      "id": "fill-username",
      "type": "fill",
      "name": "Fill Username",
      "locator": {
        "strategy": "id",
        "value": "username"
      },
      "valueSource": {
        "type": "env",
        "envKey": "USERNAME"
      },
      "position": { "x": 250, "y": 290 },
      "next": "fill-password"
    },
    {
      "id": "fill-password",
      "type": "fill",
      "name": "Fill Password",
      "locator": {
        "strategy": "id",
        "value": "password"
      },
      "valueSource": {
        "type": "env",
        "envKey": "PASSWORD"
      },
      "position": { "x": 250, "y": 410 },
      "next": "click-login"
    },
    {
      "id": "click-login",
      "type": "click",
      "name": "Click Login",
      "locator": {
        "strategy": "role",
        "value": "button",
        "name": "Login"
      },
      "position": { "x": 250, "y": 530 },
      "next": "end"
    },
    {
      "id": "end",
      "type": "end",
      "name": "End",
      "position": { "x": 250, "y": 650 }
    }
  ],
  "edges": [
    {
      "id": "edge-start-open-login",
      "source": "start",
      "target": "open-login",
      "type": "always"
    },
    {
      "id": "edge-open-login-fill-username",
      "source": "open-login",
      "target": "fill-username",
      "type": "success"
    }
  ]
}
```

## Locator Strategy

Supported locator strategies:

```text
role
label
placeholder
text
testId
id
css
xpath
tagName as fallback only
```

Recommended priority:

```text
1. role
2. label
3. placeholder
4. text
5. testId
6. id
7. css
8. xpath
9. tagName fallback
```

## Locator Configuration Examples

### By ID

```json
{
  "strategy": "id",
  "value": "username"
}
```

### By Role

```json
{
  "strategy": "role",
  "value": "button",
  "name": "Login"
}
```

### By Label

```json
{
  "strategy": "label",
  "value": "Email Address"
}
```

### By CSS

```json
{
  "strategy": "css",
  "value": "form.login button[type='submit']"
}
```

## Step Failure Behavior

Each node should support:

```text
Stop flow
Continue flow
Retry step
Go to failure connector
Take screenshot
Trigger manual handoff
```

Example:

```json
{
  "timeoutMs": 10000,
  "retry": {
    "count": 2,
    "delayMs": 1000
  },
  "onFailure": {
    "action": "goToFailureEdge",
    "screenshot": true
  }
}
```

## Output Variables

Some nodes can produce output variables.

Examples:

```text
Read Text → customerId
Download File → downloadedFilePath
Upload File → uploadedFileName
Assertion → assertionResult
```

Example:

```json
{
  "id": "read-customer-id",
  "type": "readText",
  "locator": {
    "strategy": "css",
    "value": ".customer-id"
  },
  "outputs": {
    "customerId": {
      "type": "text"
    }
  }
}
```

## Deliverables

- Flow chart canvas.
- Node palette.
- Node drag/drop.
- Node properties panel.
- Connector creation.
- Flow save/load.
- Flow validation.
- Basic sample flow.


## Update: Concurrent Execution Compatibility

Flow nodes must not store global mutable state. Every runtime value must be scoped by `executionId`, `instanceId`, `scenarioId`, `flowId`, and `stepId` so the same flow can run in many instances concurrently.
