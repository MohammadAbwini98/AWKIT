# Phase 9 — Reporting, Logging & Security

## Objective

Provide execution visibility while enforcing safe and authorized automation rules.

## Reporting Requirements

Each run should generate:

```text
Execution ID
Scenario name
Run mode
Max concurrent instances
Instance results
Start/end time
Duration
Status
Passed/failed/skipped flows
Step-by-step result
Screenshots
Errors
Downloaded files
Runtime inputs used
Offline runtime status
```

## Concurrent Run Report Example

```json
{
  "executionId": "exec-20260101-0001",
  "scenarioId": "customer-onboarding-scenario",
  "runMode": "concurrent",
  "maxConcurrentInstances": 5,
  "status": "completed",
  "instances": [
    {
      "instanceId": "instance-1",
      "status": "passed",
      "durationMs": 50000,
      "currentDataRowIndex": 0
    },
    {
      "instanceId": "instance-2",
      "status": "failed",
      "durationMs": 45000,
      "currentDataRowIndex": 1,
      "error": "Login button not found"
    }
  ]
}
```

## Logging Requirements

Use structured logs per run and per instance.

```json
{
  "timestamp": "2026-01-01T10:00:00Z",
  "level": "info",
  "executionId": "exec-20260101-0001",
  "instanceId": "instance-user-1",
  "scenarioId": "customer-onboarding-scenario",
  "flowId": "login-flow",
  "stepId": "click-login",
  "message": "Clicking login button"
}
```

## Screenshot Path

```text
screenshots/{executionId}/{instanceId}/{flowId}/{stepId}.png
```

## Security Rules

The app must not:

```text
Bypass CAPTCHA
Bypass MFA
Bypass bot detection
Access unauthorized systems
Scrape private data without permission
Create fake accounts
Perform spam or abuse
Attack or exploit web applications
Ignore website restrictions
```

## Safe Handling of MFA and CAPTCHA

```text
Pause the affected instance only.
Show manual handoff prompt.
Let user complete it manually.
Continue only after Resume.
```

## Offline Security

Production offline mode must:

```text
Not attempt network downloads
Not execute scripts from external URLs
Not load remote renderer code
Use local bundled resources only
Mask secrets in logs and reports
```

## Pre-Run Validation

Validate:

```text
Scenario exists
All referenced flows exist
All runtime inputs provided
JSON files and paths resolve
Locators configured
Instance folders available
Concurrency settings valid
No resource lock conflicts
Bundled browser exists in production
Runtime folders writable
```

## Deliverables

- Report service.
- Concurrent run report.
- Per-instance report.
- Structured logger.
- Screenshot service.
- Secret masking.
- Manual handoff safety.
- Offline runtime safety validation.
