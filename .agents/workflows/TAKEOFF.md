---
description: Resume safely from a generic cross-agent handoff
---

# TAKEOFF Workflow

Use this workflow when beginning from `docs/ai/HANDOFF.md`.

1. Read `AGENTS.md`, then follow its required reading order.
2. Read `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`, `docs/ai/COMMANDS.md`, `docs/ai/TESTING.md`, and `docs/ai/RULES.md`.
3. Inspect repository state with Git when available:
   - `git status --short --branch`
   - `git diff --stat`
   - `git diff`
4. If Git metadata is unavailable, record that fact and inspect changed files directly.
5. Compare the handoff note with actual files. Treat the handoff as a guide, not proof.
6. Report current state, completed work, remaining work, risks/blockers, likely files to edit, and verification commands.
7. Wait for confirmation before risky or broad changes unless the user explicitly asked to continue.

Do not invent project facts, overwrite unrelated local changes, or copy secrets into Markdown/logs.
