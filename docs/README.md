# AWKIT Template Implementation Spec Pack

Use this pack when an agent says the template UI is already complete but the app still misses the actual Hologram-style design details.

Recommended order:

1. `00_MASTER_AGENT_PROMPT.md`
2. `01_ACTUAL_TEMPLATE_DESIGN_EXTRACTION.md`
3. `02_GITHUB_CODEBASE_REVIEW.md`
4. `03_FILE_BY_FILE_IMPLEMENTATION_MATRIX.md`
5. Then apply each per-file spec under `files/`.

This pack is written for Claude Code, Codex, or Gemini working from the AWKIT repo root.

Rules:

- Work locally only unless asked otherwise.
- Do not commit unless the user explicitly says to commit.
- Do not remove required fields or system functionality.
- Do not change runtime automation behavior.
- Do not mark anything as already done without screenshot proof and exact selector/component proof.
