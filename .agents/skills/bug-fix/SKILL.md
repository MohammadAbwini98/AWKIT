---
name: bug-fix
description: Fix AWKIT bugs by reproducing or tracing the issue, patching the smallest safe area, and verifying.
---

# Bug Fix

1. Read `AGENTS.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`, `docs/ai/KNOWN_ISSUES.md`, and relevant source files.
2. Reproduce the issue when possible or trace the root cause from code.
3. Patch the smallest safe area.
4. Add regression coverage when practical.
5. Run `npm run build` and relevant verification scripts.
6. Document the fix in `docs/ai/TASK_LOG.md`.
7. Update `docs/ai/KNOWN_ISSUES.md` if a fragile area or repeated trap was found.
8. Run `node scripts/ai-memory/check-memory.mjs`.
