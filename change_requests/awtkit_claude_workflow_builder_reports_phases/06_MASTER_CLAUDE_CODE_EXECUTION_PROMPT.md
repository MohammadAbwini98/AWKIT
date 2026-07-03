# Master Claude Code Prompt — Workflow Builder Space and Reports Cleanup

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
Project Contract
Roadmap
```

## Main Goal

Fix the latest Workflow Builder layout and Reports issues.

The app should provide more usable canvas space, better workflow management, and real reports only.

## Required Phase Files

Implement these phase files:

```text
01_PHASE_WORKFLOW_BUILDER_COLLAPSIBLE_SELECTED_CONNECTOR.md
02_PHASE_WORKFLOW_BUILDER_COMPACT_HEADER_LAYOUT.md
03_PHASE_WORKFLOW_BUILDER_COLLAPSIBLE_WORKFLOW_DATA_SOURCE.md
04_PHASE_WORKFLOWS_LIBRARY_PAGE.md
05_PHASE_REPORTS_REMOVE_DUMMY_REPORTS.md
```

## Recommended Order

```text
1. Phase 04 — Workflows Library Page
2. Phase 01 — Collapsible Selected Connector panel
3. Phase 03 — Collapsible Workflow Data Source panel
4. Phase 02 — Compact Workflow Builder header layout
5. Phase 05 — Remove dummy reports
```

## Issues to Fix

```text
1. Workflow Builder Selected Connector should collapse to get more canvas space.
2. Workflow Builder header buttons and fields should be rearranged to reduce height.
3. Workflow Builder Workflow Data Source should collapse to get more canvas space.
4. There should be a page that shows all available/created workflows.
5. Reports should wipe dummy reports and only show real ones.
```

## Product Rules

```text
Do not leave fake/demo data active.
Do not leave no-op buttons enabled.
Use real persistence for workflows and reports.
Keep collapsed UI state persistent.
Keep Workflow Builder canvas area as large as possible.
```

## Required Verification

Run available project checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If some scripts do not exist, inspect `package.json` and run the closest available equivalents.

## Final Response Required From Claude Code

After implementation, provide:

```text
Files changed
Files added
Workflow Builder layout changes
Workflows page changes
Reports cleanup changes
Persistence changes
Commands executed and results
Manual verification results
Remaining TODOs
```
