# /TAKEOFF

Resume safely from `docs/ai/HANDOFF.md`. This command is for Claude Code, Codex, Gemini, Antigravity, and human developers.

## Steps

1. Read `AGENTS.md`, then follow its required reading order.
2. Read `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`, `docs/ai/COMMANDS.md`, `docs/ai/TESTING.md`, and `docs/ai/RULES.md`.
3. Inspect current repository state before editing:
   - Run `git status --short --branch` when Git metadata is available.
   - Run `git diff --stat` and `git diff` when Git metadata is available.
   - If Git metadata is unavailable, record that fact and inspect changed files directly.
4. Compare the handoff note against the actual files. Do not assume the handoff is complete or current.
5. Report the current repo state, what the previous agent completed, remaining work, risks/blockers, files likely to change, and recommended verification commands.
6. Wait for confirmation before risky or broad implementation work unless the user explicitly asked to continue immediately.

## Rules

- Do not invent project facts.
- Do not overwrite unrelated local changes.
- Do not copy secrets into Markdown or logs.
