---
name: pr-review
description: Review AWKIT changes before commit or pull request.
allowed-tools: Read, Glob, Grep, Bash(git *), Bash(npm *), Bash(node *)
---

# PR Review

Procedure:
1. Inspect `git status --short --branch`.
2. Inspect `git diff --stat` and `git diff`.
3. Check for unrelated changes, secrets, large rewrites, and missing verification.
4. Run relevant verification if not already run.
5. Provide findings by severity.
6. Recommend whether the change is ready to commit/PR.
