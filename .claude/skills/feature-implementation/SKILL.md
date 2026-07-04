---
name: feature-implementation
description: Implement a scoped AWKIT feature using existing architecture, minimal diffs, and verification.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(git *), Bash(npm *), Bash(node *)
---

# Feature Implementation

Procedure:
1. Read `AGENTS.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`, `docs/ai/ARCHITECTURE.md`, `docs/ai/RULES.md`, and `docs/ai/COMMANDS.md`.
2. Inspect relevant code paths before editing.
3. Identify existing patterns and integration points.
4. Make the smallest safe implementation.
5. Add or update verification when practical.
6. Run `npm run build` and task-relevant verify scripts.
7. Update `docs/ai/TASK_LOG.md`.
8. Update `docs/ai/CURRENT_STATE.md` and `docs/ai/HANDOFF.md` only when applicable.
9. Run `node scripts/ai-memory/check-memory.mjs`.
