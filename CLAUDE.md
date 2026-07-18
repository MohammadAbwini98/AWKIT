@AGENTS.md

# CLAUDE.md — Claude Code instructions for SpecterStudio

Shared rules live in `AGENTS.md` (imported above) and `docs/ai/`. This file adds
Claude Code-specific behavior.

## Before editing

- Read `AGENTS.md` first, then the required-reading order it lists — at minimum
  `docs/ai/CURRENT_STATE.md`, `docs/ai/RULES.md`, `docs/ai/ARCHITECTURE.md`, and
  `docs/ai/COMMANDS.md`.
- Read any local `AGENTS.md` in folders you will modify.
- Inspect the actual files (Read/Grep/Glob) before changing them — don't rely on memory of
  prior sessions; the code changes between tasks.

## While working

- Use **plan mode** for large, cross-cutting, or risky changes (runner/orchestrator,
  packaging, settings schema, IPC contracts).
- Prefer **minimal diffs**; do not perform unrelated refactors or rename internal identifiers
  (especially `window.playwrightFlowStudio`).
- Match existing conventions: TypeScript, React + `@xyflow/react`, plain CSS in
  `app/renderer/styles/global.css`, JSON profile stores, IPC via `app/main/ipc/*` + `preload.ts`.
- Keep the offline-first constraints in `docs/ai/RULES.md` (no runtime network, no writes to
  `resources/`/`app.asar`, data under `%LOCALAPPDATA%/SpecterStudio/`).
- Treat `mock-site/` as AWKIT's local Feature Test Lab. For Recorder, Runner, Smart Wait, Flow Designer,
  Workflow Builder, Instance Monitor, locator, node, wait, or execution features, check
  `mock-site/README.md`, update an applicable scenario, and use `.claude/skills/mock-site-maintainer`
  when the task touches that surface.

## Verifying

- Run `npm run build` (typecheck + bundles). There is no lint/test npm script.
- For runner/connector/node changes, run `npm run verify:runner` (live checks via `tsx`).
- For mock-site changes, run `npm run verify:mock-site` plus the related feature verifier.
- For offline/packaging changes, run `npm run validate:offline`.
- Report what you ran and what you could not (e.g. the clean-machine GUI walkthrough).

## After finishing

- Follow the **End-of-task checklist** in `AGENTS.md`: update `docs/ai/CURRENT_STATE.md` and
  append to `docs/ai/TASK_LOG.md`; update other `docs/ai/` files only if they changed.
- End with a concise summary: implementation, files changed, tests run / not run, remaining risks.

## Git Full Cycle Skill

When doing any Git operation, branch work, commit, push, pull, PR creation, stacked PR, or
protected-main workflow, first read:

- `.claude/skills/git-full-cycle/SKILL.md` for Claude
- `.codex/skills/git-full-cycle/SKILL.md` for Codex
- `.gemini/skills/git-full-cycle/SKILL.md` for Gemini

The skill must be used before changing branches, staging files, committing, pushing, or opening PRs.

## Codebase Memory MCP + Beads (project-memory tools)

This repo is wired to two persistent-memory tools — **use both** on substantial tasks:

- **Codebase Memory MCP** — the code-structure knowledge graph. Query it (architecture, callers/callees,
  change-impact, entry points, tests) *before* broad grep/exploration, and verify critical findings against
  source. The `codebase-memory` skill has the decision matrix; the MCP tools appear after a Claude Code restart,
  or use `codebase-memory-mcp cli <tool> --project C-Users-moham-OneDrive-Desktop-AWTKIT …` now.
- **Beads (`bd`)** — the authoritative task/blocker tracker (see the managed block below).

Understand the code with Codebase Memory; track the work with Beads. Full setup, commands, and troubleshooting:
**`docs/ai/CODEBASE-MEMORY-AND-BEADS.md`**.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
