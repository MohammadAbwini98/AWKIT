# Master Claude Code Prompt — Workflow Builder and Instances Fix Phases

You are an expert Electron, React, TypeScript, Playwright, UI/UX, workflow automation, and desktop application engineer.

You are working in the AWTKIT / Playwright Flow Studio project.

Before implementing, read:

```text
AGENTS.md
README.md
package.json
```

Also inspect any available project guidance files:

```text
CLAUDE.md
GEMINI.md
docs/
resources/
Roadmap
Project Contract
```

## Main Goal

Fix the Workflow Builder and Instances functionality issues reported by the user.

The app should behave like a real workflow automation workbench, not a demo UI.

## Required Phase Files

Implement these phase files:

```text
01_PHASE_WORKFLOWS_LIBRARY_AND_MULTIPLE_WORKFLOWS.md
02_PHASE_WORKFLOW_BUILDER_SHOW_ENABLED_FLOWS_ON_CANVAS.md
03_PHASE_INSTANCES_REMOVE_DUMMY_RUNNING_INSTANCES.md
04_PHASE_INSTANCES_TABLE_ALIGNMENT_AND_OVERFLOW.md
05_PHASE_INSTANCES_FUNCTIONAL_CONTROLS.md
06_PHASE_COMPLETE_INCOMPLETE_PHASES_AUDIT_AND_IMPLEMENTATION.md
```

## Recommended Order

```text
1. Phase 01 — Workflows Library and Multiple Workflows
2. Phase 02 — Workflow Builder shows enabled/applied flows on canvas
3. Phase 03 — Remove dummy running instances
4. Phase 04 — Fix Instances table alignment and overflow
5. Phase 05 — Make Instances controls functional
6. Phase 06 — Audit and complete incomplete phases
```

## Issues to Fix

```text
1. Workflow Builder should allow creating multiple workflows.
2. There should be a page showing all workflows.
3. Workflow Builder should show applied/enabled flows in the drawing area by default.
4. Instances page should not show dummy running instances.
5. Instances table alignment should not break after clearing completed instances.
6. Instance control buttons should not overflow the table.
7. Instance controls should be functional.
8. Some phases are incomplete and must be implemented or accurately marked.
```

## Product Rules

Use this product model:

```text
Flow = one reusable automation unit.
Workflow = one or more linked flows.
Flow + Flow + N flows = Workflow.
Instance = one isolated automation execution context.
```

Do not leave fake/demo active controls.

If a feature is not implemented:

```text
Disable it.
Add tooltip.
Track it as pending.
Do not pretend it works.
```

## Required Verification

Run available commands:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If some scripts do not exist, inspect `package.json` and run the closest available equivalents.

## Final Response Required

After implementation, provide:

```text
Files changed
Files added
Workflow changes
Instances changes
Persistence changes
IPC/execution changes
Roadmap/audit changes
Commands executed and results
Manual verification results
Remaining TODOs
```
