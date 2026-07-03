---
description: Prepare a generic cross-agent handoff
---

# HANDOFF Workflow

Use this workflow when pausing, blocking, or transferring work to another agent/tool or human.

1. Read `AGENTS.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`, `docs/ai/RULES.md`, and `docs/ai/COMMANDS.md`.
2. Inspect repository state with Git when available:
   - `git status --short --branch`
   - `git diff --stat`
   - `git diff`
3. If Git metadata is unavailable, record that fact and inspect changed files directly.
4. Update `docs/ai/HANDOFF.md` with concise, factual transfer details for any next agent.
5. Append `docs/ai/TASK_LOG.md`; update other `docs/ai/*` files only when the task actually changed them.
6. Run `node scripts/ai-memory/check-memory.mjs` and fix issues.
7. Summarize changed files, checks run, remaining work, and handoff readiness.

Do not copy secrets, tokens, cookies, passwords, private URLs, credentials, or session values into Markdown.
