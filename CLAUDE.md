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
