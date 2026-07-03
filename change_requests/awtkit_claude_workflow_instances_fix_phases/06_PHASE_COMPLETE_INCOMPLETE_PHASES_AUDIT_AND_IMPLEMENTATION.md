# Phase 06 — Audit and Complete Incomplete Phases

## Claude Code Role

You are an expert software architect, Electron/React/TypeScript engineer, Playwright automation engineer, and implementation reviewer.

You are working inside the AWTKIT / Playwright Flow Studio project.

Before making changes, read:

```text
AGENTS.md
README.md
package.json
```

Also inspect all project phase/roadmap/contract files, especially if available:

```text
Project Contract
Roadmap
Implementation phases
AGENTS.md
CLAUDE.md
docs/
resources/
```

---

## Objective

Some phases were marked complete or partially complete but are still incomplete functionally.

Audit all implemented phases and finish the incomplete parts, or clearly mark what remains pending with reasons.

---

## Current Problem

The application has a Roadmap page showing phase statuses, but some functionality is still missing or incomplete.

Observed examples:

```text
Workflow Builder not fully functional.
Workflow canvas not showing enabled flows.
Instances page has dummy data.
Instances controls are not functional.
Some UI controls are visible but inactive.
Some phases may be marked complete even if acceptance criteria are not met.
```

---

## Required Audit

Review the roadmap/phase definitions and actual code implementation.

For each phase, check:

```text
Acceptance criteria
UI implementation
State/persistence implementation
IPC implementation
Backend/service implementation
Runner/orchestrator implementation
Manual testability
```

Create an internal checklist and compare against actual behavior.

---

## Phase Status Rules

Use accurate statuses:

```text
Complete
In Progress
Pending
Blocked
```

Do not mark a phase complete unless its acceptance criteria are actually met.

If partial:

```text
Mark In Progress
List missing items
```

If blocked:

```text
Mark Blocked
Explain blocker
```

---

## Roadmap Page Fix

If Roadmap is shown inside app, ensure it reflects real state.

Do not use hardcoded misleading completion if functionality is missing.

Options:

### Option 1 — Static but accurate

Update statuses manually based on real current implementation.

### Option 2 — Data-driven

Load statuses from a project status JSON file.

Example:

```json
{
  "phaseId": "workflow-builder",
  "status": "in-progress",
  "completedItems": [],
  "remainingItems": []
}
```

Pick the practical approach that matches the project.

---

## Required Areas to Recheck

Audit at least these areas:

```text
Flow Library
Flow Designer
Workflow Library
Workflow Builder
Workflow Designer
Data Sources
Runtime Inputs
Run page
Instances
Reports
Offline Runtime
Settings
Mock Website
Value Source Binding
Workflow Data Source
Concurrent Execution
```

---

## Completion Priority

Prioritize fixing these incomplete items first:

```text
1. Workflow library and multiple workflows.
2. Workflow Builder canvas showing selected flows.
3. Instances dummy data removal.
4. Instances table alignment.
5. Instances controls functionality.
6. Data source binding clarity.
7. Node properties collapsible/value source simplification.
```

If any of these are already fixed by previous phases, verify them and update roadmap status.

---

## Incomplete Feature Handling

For features that are not yet implemented:

```text
Disable UI buttons.
Add tooltip explaining "Not implemented yet".
Remove fake behavior.
Add TODO in roadmap.
Do not pretend it works.
```

Examples:

```text
Recorder Mode
Advanced scheduling
Advanced offline packaging validation
Complex loop execution
Nested flow execution
```

---

## Testing Requirements

Run available commands:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If scripts do not exist, inspect `package.json` and run the closest equivalents.

Manual verification:

```text
Can create multiple workflows.
Can load workflow and see flows on canvas.
Can remove dummy instances.
Can clear completed without table break.
Can use instance controls.
Can save/reload main forms.
Can browse data source JSON.
Can edit node properties.
Can view accurate Roadmap statuses.
```

---

## Deliverable Inside Project

Add or update an implementation audit file:

```text
docs/IMPLEMENTATION_AUDIT.md
```

It should include:

```text
Phase
Expected behavior
Actual behavior
Status
Files reviewed
Fixes applied
Remaining work
```

If `docs/` does not exist, create it.

---

## Files to Inspect

```text
app/renderer/pages/Roadmap.tsx
app/renderer/pages/*
app/renderer/components/*
app/renderer/stores/*
app/main/ipc/*
src/*
docs/*
resources/*
```

---

## Implementation Steps

1. Read roadmap/contract/phase docs.
2. Review implementation against phase acceptance criteria.
3. Create `docs/IMPLEMENTATION_AUDIT.md`.
4. Fix high-priority incomplete items if not already fixed by earlier phases.
5. Update Roadmap page statuses so they are accurate.
6. Disable or label incomplete features.
7. Run verification commands.
8. Manually test major flows.
9. Report remaining limitations.

---

## Acceptance Criteria

```text
Implementation audit document exists.
Roadmap status is accurate.
No phase is falsely marked complete.
High-priority incomplete workflow/instances issues are fixed or explicitly tracked.
Unimplemented buttons/features are disabled or clearly marked.
Manual verification checklist is completed.
```

---

## Final Response Required

After implementation, report:

```text
Files changed
Audit findings
Phases corrected
Features completed
Features marked pending/blocked
Roadmap status changes
Commands executed
Manual verification results
Remaining limitations
```
