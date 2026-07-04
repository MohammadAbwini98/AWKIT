---
name: refactor-safe
description: Perform safe, scoped AWKIT refactors without changing behavior.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(git *), Bash(npm *), Bash(node *)
---

# Safe Refactor

Procedure:
1. Confirm the requested refactor scope.
2. Read architecture and affected files.
3. Preserve behavior and public contracts.
4. Avoid broad renames unless required.
5. Run before/after verification when possible.
6. Summarize behavior preserved, files changed, and verification.
