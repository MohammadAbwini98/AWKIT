# Phase 05 — Instances Table Functional Controls

## Claude Code Role

You are an expert Electron, React, TypeScript, state management, IPC, and Playwright execution-control engineer.

You are working inside the AWTKIT / Playwright Flow Studio project.

Before making changes, read:

```text
AGENTS.md
README.md
package.json
```

Review Instances page, execution orchestration, IPC, instance manager, and runner control logic.

---

## Objective

Fix the Instances table controls so they are functional.

Controls should not be decorative. Every active control must perform its expected action.

---

## Current Problem

Instance controls in the table are visible but not working or not fully wired.

Controls likely include:

```text
Start
Pause
Resume
Stop
Stop All
Clear Completed
Logs
Report
```

These need to be connected to real state and execution services.

---

## Required Controls

## 1. Start Workflow

From Instances page, user should be able to:

```text
Select saved workflow.
Set total runs.
Set number of concurrent instances.
Select run type: headed/headless.
Click Start.
```

Behavior:

```text
Validate inputs.
Create execution run.
Create queued/running instance records.
Start workflow execution through existing execution manager/orchestrator.
Update instance table.
```

If full Playwright runner is not implemented yet:

```text
Do not fake success.
Show clear "Runner integration incomplete" message.
Disable Start or route to existing available execution path.
```

But if runner exists, wire it.

---

## 2. Pause Instance

Pause selected instance.

Expected behavior:

```text
If instance is running and pause is supported:
  request pause through execution manager
  mark status as Paused or Pausing
  disable Pause button
  enable Resume button

If pause is not supported:
  disable button with tooltip explaining why
```

---

## 3. Resume Instance

Resume a paused instance.

Expected behavior:

```text
Resume execution if supported.
Update status.
```

---

## 4. Stop Instance

Stop/cancel selected instance.

Expected behavior:

```text
Request cancellation.
Close browser/context if applicable.
Mark as Cancelled/Stopping/Stopped.
Do not affect other instances unless explicitly requested.
```

---

## 5. Stop All

Stop all active/queued instances.

Expected behavior:

```text
Request cancellation for all active/queued instances.
Update statuses.
Do not delete historical completed rows unless Clear Completed is clicked.
```

---

## 6. Clear Completed

Remove only:

```text
Completed
Failed
Cancelled
Stopped
```

Do not remove:

```text
Running
Queued
Paused
Starting
Stopping
```

Do not corrupt table layout.

---

## 7. Logs

Logs button should:

```text
Open live logs panel/modal
or open report/log file if available
or be disabled if logs are unavailable
```

---

## 8. Report

Report button should:

```text
Open the execution report if available
or be disabled until report exists
```

---

## Button State Rules

Buttons should enable/disable based on status.

Example:

```text
Queued:
  Stop enabled
  Pause disabled
  Resume disabled

Running:
  Pause enabled if supported
  Stop enabled

Paused:
  Resume enabled
  Stop enabled

Completed:
  Report enabled if available
  Logs enabled if available
  Pause/Resume/Stop disabled

Failed:
  Report/logs enabled if available
  Stop disabled

Cancelled:
  Report/logs enabled if available
  Stop disabled
```

---

## IPC Requirements

If using Electron IPC, ensure channels exist:

```text
execution:runWorkflow
execution:pauseInstance
execution:resumeInstance
execution:stopInstance
execution:stopAll
execution:clearCompleted
reports:get
logs:get
```

If existing channel names differ, use existing names consistently.

---

## State Management Requirements

Instance state should update from:

```text
execution events
instance manager events
IPC responses
store actions
```

Avoid direct UI-only fake state.

---

## Error Handling

Show friendly messages for:

```text
No workflow selected.
Invalid total runs.
Invalid concurrency.
Execution manager not available.
Pause not supported.
Resume not supported.
Stop failed.
Report not found.
Logs not found.
```

---

## Files to Inspect

Look for:

```text
app/renderer/pages/InstanceMonitor.tsx
app/renderer/pages/Instances.tsx
app/renderer/components/instances/*
app/renderer/stores/useInstanceStore.ts
app/renderer/stores/useExecutionStore.ts
app/main/ipc/execution.ipc.ts
src/instances/InstanceManager.ts
src/instances/InstancePool.ts
src/orchestrator/ConcurrentExecutionCoordinator.ts
src/runner/RunnerWorkerHost.ts
src/reports/*
src/utils/logger.ts
```

---

## Implementation Steps

1. Inspect current controls and event handlers.
2. Identify which buttons are fake/no-op.
3. Wire workflow selection to saved workflows.
4. Wire Start button to execution service/IPC.
5. Implement/fix pause/resume/stop/stopAll.
6. Implement/fix clearCompleted behavior.
7. Implement/fix logs/report actions.
8. Add proper button enable/disable logic.
9. Add validation messages.
10. Run typecheck/build.
11. Manually test controls with sample workflow or mock execution path.

---

## Acceptance Criteria

```text
Start validates and triggers real execution path.
Pause button works or is disabled with reason.
Resume button works or is disabled with reason.
Stop instance works.
Stop all works.
Clear completed removes only completed/failed/cancelled/stopped rows.
Logs button works or is disabled with reason.
Report button works or is disabled with reason.
Buttons update correctly based on instance status.
No active button is a no-op.
```

---

## Final Response Required

After implementation, report:

```text
Files changed
Controls wired
IPC/execution changes
State management changes
Validation added
Commands executed
Manual verification results
Remaining limitations
```
