---
name: ai-memory-maintainer
description: Use after any code, architecture, command, test, configuration, or documentation change to update and verify repository AI memory files.
---

# AI Memory Maintainer

Before finishing implementation work:

1. Inspect changed files.
2. Update docs/ai/TASK_LOG.md.
3. Update docs/ai/HANDOFF.md when work is paused, blocked, or handed to another agent/tool or human.
4. Update docs/ai/CURRENT_STATE.md if the project state changed.
5. Update docs/ai/FEATURES.md if feature behavior changed.
6. Update docs/ai/ARCHITECTURE.md if architecture changed.
7. Update docs/ai/COMMANDS.md if commands changed.
8. Update docs/ai/KNOWN_ISSUES.md if new risks, missing tests, fragile behavior, or repeated traps were found.
9. Update docs/ai/DECISIONS.md if meaningful decisions were made.
10. Verify AGENTS.md, CLAUDE.md, and GEMINI.md still point to the shared memory structure.
11. Do not copy secrets into documentation.

Run node scripts/ai-memory/check-memory.mjs and fix any reported issues.
