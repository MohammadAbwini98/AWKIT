# AWTKIT — Claude Code Implementation Plan Phases

## Purpose

This package contains separate Claude Code implementation phase files for the Workflow Builder and Instances issues noticed after implementation.

Each phase is separated so Claude Code can review, implement, test, and commit one issue area at a time.

## Phase Files

```text
00_README_PHASE_INDEX.md
01_PHASE_WORKFLOWS_LIBRARY_AND_MULTIPLE_WORKFLOWS.md
02_PHASE_WORKFLOW_BUILDER_SHOW_ENABLED_FLOWS_ON_CANVAS.md
03_PHASE_INSTANCES_REMOVE_DUMMY_RUNNING_INSTANCES.md
04_PHASE_INSTANCES_TABLE_ALIGNMENT_AND_OVERFLOW.md
05_PHASE_INSTANCES_FUNCTIONAL_CONTROLS.md
06_PHASE_COMPLETE_INCOMPLETE_PHASES_AUDIT_AND_IMPLEMENTATION.md
07_MASTER_CLAUDE_CODE_EXECUTION_PROMPT.md
```

## Recommended Implementation Order

```text
1. Phase 01 — Workflows Library and Multiple Workflows
2. Phase 02 — Workflow Builder shows enabled/applied flows on canvas
3. Phase 03 — Remove dummy running instances
4. Phase 04 — Fix Instances table alignment and overflow
5. Phase 05 — Make Instances controls functional
6. Phase 06 — Audit and complete incomplete phases
```

## Product Model

Use this terminology consistently:

```text
Flow
  One reusable automation unit made of Playwright action nodes.

Workflow
  A saved orchestration of one or more flows.
  Flow + Flow + N flows = Workflow.

Workflow Builder
  The screen where user selects saved flows, orders them, connects them,
  configures workflow data source and execution behavior, then saves a workflow.

Workflows Library
  A page/table showing all saved workflows.

Instance
  One isolated Playwright automation run context.

Instances Page
  The page where user selects a saved workflow, total runs, concurrency,
  headed/headless mode, starts execution, and manages running instances.
```

## Important Rule

Do not leave any fake/demo behavior active.

If something is not implemented, disable it clearly with a tooltip or mark it as incomplete. Do not show dummy running instances as if they are real.

## Required Final Outcome

After all phases:

```text
User can create multiple workflows.
User can see all workflows in a page/table.
Workflow Builder loads/saves workflows.
Workflow Builder canvas shows selected/enabled flows by default.
Instances page contains only real runs.
Instances table stays aligned after clearing completed instances.
Instance control buttons do not overflow.
Instance control buttons are functional.
Incomplete phases are audited and either implemented or explicitly marked.
```
