---
name: ai-memory-maintainer
description: Update and verify AI memory files after code, architecture, command, test, configuration, or documentation changes. Use before finishing any implementation task.
allowed-tools: Bash(node *), Bash(npm *), Bash(git *), Read, Edit, Write, Glob, Grep
---

# AI Memory Maintainer

You maintain the repository AI memory system.

## Procedure

1. Inspect recent project changes.
2. Identify whether changes affect project state, features, architecture, commands, tests, security, known issues, decisions, or agent instructions.
3. Always update docs/ai/TASK_LOG.md.
4. Update docs/ai/HANDOFF.md when work is paused, blocked, or handed to another agent/tool or human.
5. Update docs/ai/CURRENT_STATE.md when behavior, implementation status, risks, or incomplete work changed.
6. Update docs/ai/FEATURES.md only when feature behavior changed.
7. Update docs/ai/ARCHITECTURE.md only when module boundaries, data flow, APIs, storage, or integrations changed.
8. Update docs/ai/COMMANDS.md only when commands or scripts changed.
9. Update docs/ai/KNOWN_ISSUES.md only when a real issue, fragile area, missing test, or repeated trap was found.
10. Update docs/ai/DECISIONS.md when a meaningful technical/product decision was made.
11. Verify AGENTS.md, CLAUDE.md, and GEMINI.md still point to the shared memory structure.
12. Never copy secrets into Markdown files.

## Verification

Run:

```bash
node scripts/ai-memory/check-memory.mjs
```

Fix any reported issue before finishing.

## Final Response

Report memory files updated, why each file was updated, verification result, and remaining unknowns.
