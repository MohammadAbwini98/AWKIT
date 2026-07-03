---
name: agent-takeoff
description: Resume safely from docs/ai/HANDOFF.md. Use when starting work from a prior handoff, when the user asks for /TAKEOFF, or when a task should continue from another AI coding agent or human.
---

# Agent Takeoff

Resume from the active handoff without assuming it is complete or current.

1. Read `AGENTS.md`, then follow its required reading order.
2. Read `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`, `docs/ai/COMMANDS.md`, `docs/ai/TESTING.md`, and `docs/ai/RULES.md`.
3. Inspect actual repository state before editing. Use `git status --short --branch`, `git diff --stat`, and `git diff` when Git metadata is available; otherwise record that Git status is unavailable and inspect files directly.
4. Compare the handoff note with the actual files and commands.
5. Report what was completed, what remains, risks/blockers, likely files to edit, and verification commands.
6. Proceed only when the user asked to continue immediately or the next safe implementation step is clear.
7. Do not invent facts, overwrite unrelated local changes, or copy secrets into Markdown/logs.
