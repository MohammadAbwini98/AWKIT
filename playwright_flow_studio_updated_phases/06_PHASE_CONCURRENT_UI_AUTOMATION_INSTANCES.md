# Phase 6 — Multiple Concurrent UI Automation Instances

## Objective

Support running multiple Playwright UI automation instances at the same time from the Windows app.

## What Is an Instance?

An instance is an independent automation runtime unit containing:

```text
Browser process or browser context
Page
Cookies
Local storage
Session storage
Storage state
Runtime inputs
Current JSON row
Downloads folder
Screenshot folder
Log file
Execution state
Manual handoff state
```

## Concurrent Execution Modes

```text
Single instance
Fixed number of concurrent instances
Data-driven concurrent instances from JSON array
Multiple scenarios concurrently
```

## Isolation Modes

### Browser context isolation

```text
One Chromium browser process
Multiple isolated browser contexts
Lower resource usage
Good for most cases
```

### Persistent context isolation

```text
Separate userDataDir per instance
Stronger browser-state isolation
Useful for long-lived sessions
Higher resource usage
```

## Instance Profile Example

```json
{
  "id": "instance-user-1",
  "name": "User 1 Instance",
  "browser": "chromium",
  "headless": false,
  "isolationMode": "browserContext",
  "baseUrl": "${BASE_URL}",
  "envFile": ".env.user1",
  "storageState": "storage/user1-auth.json",
  "userDataDir": "storage/user1-profile",
  "downloadsPath": "downloads/user1",
  "screenshotsPath": "screenshots/user1",
  "logsPath": "logs/user1",
  "timeoutMs": 30000,
  "viewport": { "width": 1440, "height": 900 }
}
```

## Concurrent Run Profile

```json
{
  "id": "batch-customer-onboarding-run",
  "scenarioId": "customer-onboarding-scenario",
  "runMode": "dataDrivenConcurrent",
  "maxConcurrentInstances": 5,
  "browserWindowMode": "headless",
  "dataSource": {
    "type": "jsonArray",
    "file": "data/customers.json",
    "path": "$.customers"
  },
  "instanceTemplate": {
    "browser": "chromium",
    "headless": true,
    "isolationMode": "browserContext"
  },
  "failurePolicy": {
    "stopAllOnCriticalFailure": false,
    "continueOtherInstancesOnFailure": true,
    "retryFailedInstance": true,
    "retryCount": 1
  }
}
```

## Instance Statuses

```text
Pending
Queued
Starting
Running
Waiting for manual action
Paused
Completed
Failed
Cancelled
Stopping
Cleaning up
```

## Required Modules

```text
InstanceManager
InstancePool
ConcurrentExecutionCoordinator
BrowserProcessManager
InstanceLockManager
RunnerWorkerHost
RunnerWorker
```

## Instance Manager Responsibilities

```text
Create execution IDs
Create isolated contexts
Assign scenarios to instances
Assign JSON rows to instances
Track active instances
Apply max concurrency limit
Handle pause/resume/stop
Route events to UI
Route logs/screenshots/downloads per instance
Clean up after execution
```

## Lock Manager Responsibilities

Prevent conflicts such as:

```text
Same account used in two exclusive instances
Same storageState file used for writing
Same userDataDir used by two persistent contexts
Same download folder used by multiple instances
Output file name collisions
```

## Manual Handoff in Concurrent Runs

Manual handoff pauses only the affected instance.

```text
Instance 3 waits for MFA.
Instances 1, 2, 4, and 5 continue running.
```

## Resource Controls

```text
Max concurrent instances
Max browser contexts per browser process
Delay between instance starts
Retry failed instances
Stop all on critical failure
Continue other instances on failure
```

## Deliverables

- Concurrent execution coordinator.
- Instance manager.
- Instance pool.
- Browser process manager.
- Instance lock manager.
- Per-instance state isolation.
- Data-driven concurrent execution.
- Instance monitor UI.
- Pause/resume/stop per instance and globally.
