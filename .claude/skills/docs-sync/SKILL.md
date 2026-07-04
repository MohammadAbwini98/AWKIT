---
name: docs-sync
description: Synchronize AWKIT docs/ai files after changes without duplicating stale context.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(node *), Bash(git *)
---

# Docs Sync

Procedure:
1. Read `AGENTS.md`, `docs/ai/README.md` if present, and changed docs.
2. Remove duplicate or stale context when safely obvious.
3. Keep `CURRENT_STATE.md` focused on current verified state.
4. Keep `TASK_LOG.md` append-only.
5. Keep `HANDOFF.md` focused on active transfer state.
6. Do not invent project facts.
7. Run `node scripts/ai-memory/check-memory.mjs`.
