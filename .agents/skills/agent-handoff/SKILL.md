---
name: agent-handoff
description: Prepare a generic repository handoff for another AI coding agent or human. Use when work is paused, blocked, transferred between Claude Code, Codex, Gemini, Antigravity, or a human, or when the user asks for /HANDOFF or a handoff note.
---

# Agent Handoff

Prepare `docs/ai/HANDOFF.md` as the active transfer note.

1. Read `AGENTS.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`, `docs/ai/RULES.md`, and `docs/ai/COMMANDS.md`.
2. Inspect actual repository state. Use Git commands when available; if this checkout has no Git metadata, record that fact.
3. Update `docs/ai/HANDOFF.md` with factual, concise transfer details:
   - from/to agent or tool
   - timestamp
   - branch/commit/status when available
   - active task and completed work
   - files changed
   - commands/tests run with exact results
   - current state summary
   - remaining work
   - risks/blockers
   - do-not-touch areas
   - recommended next step
4. Append `docs/ai/TASK_LOG.md`.
5. Update `docs/ai/CURRENT_STATE.md` only when project status, behavior, commands, architecture, or risks changed.
6. Never copy secrets, tokens, cookies, passwords, private URLs, credentials, or session values into Markdown.
7. Run `node scripts/ai-memory/check-memory.mjs` and fix issues before finishing.
