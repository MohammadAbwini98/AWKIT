# AWTKIT — Claude Code Implementation Plan Phases

## Purpose

This package contains separate Claude Code implementation phase files for the latest Workflow Builder and Reports cleanup issues.

Each phase is separated so Claude Code can review, implement, verify, and commit one point at a time.

## Phase Files

```text
00_README_PHASE_INDEX.md
01_PHASE_WORKFLOW_BUILDER_COLLAPSIBLE_SELECTED_CONNECTOR.md
02_PHASE_WORKFLOW_BUILDER_COMPACT_HEADER_LAYOUT.md
03_PHASE_WORKFLOW_BUILDER_COLLAPSIBLE_WORKFLOW_DATA_SOURCE.md
04_PHASE_WORKFLOWS_LIBRARY_PAGE.md
05_PHASE_REPORTS_REMOVE_DUMMY_REPORTS.md
06_MASTER_CLAUDE_CODE_EXECUTION_PROMPT.md
```

## Recommended Implementation Order

```text
1. Phase 04 — Workflows Library Page
2. Phase 01 — Collapsible Selected Connector panel
3. Phase 03 — Collapsible Workflow Data Source panel
4. Phase 02 — Compact Workflow Builder header layout
5. Phase 05 — Remove dummy reports
```

## Product Goals

After all phases:

```text
Workflow Builder gives more canvas space.
Selected Connector panel can collapse/expand.
Workflow Data Source panel can collapse/expand.
Workflow Builder header is shorter and better arranged.
There is a page that lists all available/created workflows.
Reports page shows only real generated reports.
Dummy reports are removed or hidden behind explicit development-only demo mode.
```

## Important Rules

Before changing code, Claude Code must read:

```text
AGENTS.md
README.md
package.json
```

If available, also inspect:

```text
CLAUDE.md
GEMINI.md
docs/
resources/
app/renderer/pages/
app/renderer/components/
app/renderer/stores/
app/main/ipc/
src/storage/
src/reports/
```

Do not leave fake/demo data active in production behavior.

If a feature is not implemented, disable it clearly and explain why in the UI.
