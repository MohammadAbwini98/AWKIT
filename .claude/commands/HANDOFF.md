# /HANDOFF

Prepare the repository for the next AI coding agent or human developer. Keep the handoff generic; do not make it Claude-specific, Codex-specific, or Gemini-specific.

## Steps

1. Read `AGENTS.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`, `docs/ai/RULES.md`, and `docs/ai/COMMANDS.md`.
2. Inspect current repository state:
   - Run `git status --short --branch` when Git metadata is available.
   - Run `git diff --stat` and `git diff` when Git metadata is available.
   - If Git metadata is unavailable, record that fact and inspect changed files directly.
3. Update `docs/ai/HANDOFF.md` with the current task, completed work, changed files, commands/tests run with results, remaining work, known risks/blockers, do-not-touch areas, and recommended next step.
4. Append `docs/ai/TASK_LOG.md`.
5. Update `docs/ai/CURRENT_STATE.md` only if project behavior, status, commands, architecture, or risks changed.
6. Do not copy secrets, tokens, cookies, passwords, private URLs, credentials, or session values into Markdown.
7. Run `node scripts/ai-memory/check-memory.mjs` and fix reported issues.

## Response

Summarize the files updated, checks run, remaining work, and whether `docs/ai/HANDOFF.md` is ready for the next agent.
