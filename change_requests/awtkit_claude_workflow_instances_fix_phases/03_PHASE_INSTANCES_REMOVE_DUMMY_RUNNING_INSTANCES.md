# Phase 03 — Instances Page: Remove Dummy Running Instances

## Claude Code Role

You are an expert Electron, React, TypeScript, state management, and workflow automation engineer.

You are working inside the AWTKIT / Playwright Flow Studio project.

Before making changes, read:

```text
AGENTS.md
README.md
package.json
```

Review the Instances page, instance store, execution store, and any seeded/mock/demo data.

---

## Objective

Remove dummy running instances from the Instances page.

The Instances page must show only real execution instances created by the application runtime or persisted run history if explicitly loaded.

---

## Current Problem

The Instances page appears to show dummy running instances or placeholder records. This is misleading because the user cannot distinguish real automation executions from demo data.

---

## Required Behavior

On first app start or with no executions:

```text
Instances page shows an empty state.
No fake running/completed instances appear.
```

Empty state text:

```text
No active instances.
Select a workflow, configure runs and concurrency, then start execution.
```

When user starts a workflow:

```text
Create real instance records.
Show actual running/queued/completed/failed status.
```

When user clears completed instances:

```text
Remove only completed/failed/cancelled entries from UI state/history according to app rules.
Do not create dummy replacement records.
```

---

## Remove Demo Data

Search for and remove/disable seeded instance data such as:

```text
mockInstances
demoInstances
sampleInstances
initialInstances
fakeRunningInstances
placeholderInstances
```

Also inspect:

```text
InstanceMonitor.tsx
Instances page
useInstanceStore
execution store
src/instances/*
resources/sample*
```

If sample data is useful for demos, keep it only behind an explicit development/demo flag:

```text
VITE_ENABLE_DEMO_DATA=true
```

Default should be:

```text
false
```

Production/offline app should not show demo instances.

---

## Instance State Source of Truth

Define the real source of truth.

Preferred:

```text
Instance store receives instance events from execution manager.
```

The UI should render from:

```text
real activeInstances
real queuedInstances
real completedInstances
```

Not from hardcoded arrays.

---

## Empty State Requirements

Instances page should show:

```text
No active instances.
No completed instances.
```

where appropriate.

It should still show run configuration controls:

```text
Workflow selector
Total runs
Concurrent instances
Headless/headed mode
Start button
```

---

## Persistence Rule

Do not persist fake instances.

If run history is persisted, it must be real run data only.

If no real history exists, show empty history.

---

## Validation

Add or keep validation:

```text
Workflow required before start.
Total runs > 0.
Concurrent instances > 0.
Concurrent instances <= total runs.
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
src/instances/*
src/orchestrator/ConcurrentExecutionCoordinator.ts
src/runner/*
resources/sample*
```

---

## Implementation Steps

1. Locate dummy instance data.
2. Remove demo instance records from default UI state.
3. Add empty state.
4. Ensure real run start creates instance records.
5. Ensure clearing completed instances does not regenerate fake records.
6. If demo mode is needed, put it behind explicit dev-only flag.
7. Run typecheck/build.
8. Manually open Instances page before any run and confirm it is empty.

---

## Acceptance Criteria

```text
Instances page no longer shows dummy running instances.
Initial state is empty when no real runs exist.
Starting a workflow creates real instance records.
Clearing completed instances does not create dummy records.
Demo/sample instances are disabled by default.
Production/offline mode never shows fake instance data.
```

---

## Final Response Required

After implementation, report:

```text
Files changed
Dummy data removed
New empty state behavior
Real instance source of truth
Commands executed
Manual verification results
Remaining limitations
```
