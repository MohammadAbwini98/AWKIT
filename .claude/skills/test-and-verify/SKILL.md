---
name: test-and-verify
description: Run AWKIT build and verification commands, interpret results, and document verification gaps.
allowed-tools: Read, Glob, Grep, Bash(npm *), Bash(node *), Bash(git *)
---

# Test and Verify

Procedure:
1. Read `AGENTS.md`, `docs/ai/COMMANDS.md`, and `docs/ai/TESTING.md`.
2. Choose verification based on changed files:
   - default: `npm run build`
   - runner/orchestrator: `npm run verify:runner`
   - flow designer: `npm run verify:flow-designer`
   - workflow builder: `npm run verify:workflow-builder`
   - recorder: recorder-specific verify scripts
   - offline/packaging: `npm run validate:offline`
3. Run only relevant commands unless the user requested full validation.
4. Record exact command results and pass counts.
5. Clearly mark skipped verification and why.
