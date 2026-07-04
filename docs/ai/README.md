# AI Memory Index

This directory is the single source of truth for AI coding agents and human handoff notes.

## Default reading order

1. `PROJECT_BRIEF.md` — product purpose, users, and scope.
2. `CURRENT_STATE.md` — current verified state, what works, what is incomplete.
3. `HANDOFF.md` — active cross-agent handoff/takeoff note.
4. `ARCHITECTURE.md` — module boundaries, data flow, runtime boundaries.
5. `RULES.md` — non-negotiable project rules.
6. `COMMANDS.md` — verified commands.
7. `TASK_LOG.md` — append-only task history.

## Read only when relevant

- `FEATURES.md` — feature inventory.
- `TESTING.md` — verification strategy.
- `SECURITY.md` — safe automation and secret-handling rules.
- `KNOWN_ISSUES.md` — debugging and fragile areas.
- `DECISIONS.md` — accepted architecture/product decisions.
- `DEVELOPMENT_WORKFLOW.md` — how agents start, implement, verify, and finish tasks.

## Token discipline

Agents must not load every file by default.

Start with:
- `AGENTS.md`
- this file
- `CURRENT_STATE.md`
- `HANDOFF.md`

Then read only the docs relevant to the task.

## Update rules

- Update `TASK_LOG.md` after every meaningful implementation or documentation task.
- Update `CURRENT_STATE.md` only when behavior, status, commands, architecture, risks, or incomplete work changed.
- Update `HANDOFF.md` when work is paused, blocked, or transferred to another agent/tool/human.
- Update `ARCHITECTURE.md`, `COMMANDS.md`, `RULES.md`, `FEATURES.md`, `SECURITY.md`, `TESTING.md`, `KNOWN_ISSUES.md`, or `DECISIONS.md` only when their facts changed.
