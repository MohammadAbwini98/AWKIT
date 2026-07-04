---
name: feature-implementation
description: Implement a scoped AWKIT feature using existing architecture, minimal diffs, and verification.
---

# Feature Implementation

1. Read `AGENTS.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`, `docs/ai/ARCHITECTURE.md`, `docs/ai/RULES.md`, and `docs/ai/COMMANDS.md`.
2. Inspect relevant code before editing.
3. Make minimal, scoped changes.
4. Run `npm run build` and relevant verification commands.
5. Update `docs/ai/TASK_LOG.md`.
6. Update `docs/ai/CURRENT_STATE.md` or `docs/ai/HANDOFF.md` only when applicable.
7. Run `node scripts/ai-memory/check-memory.mjs`.
8. Report files changed, tests run, skipped tests, and remaining risks.
