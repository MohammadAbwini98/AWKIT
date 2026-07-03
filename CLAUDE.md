@AGENTS.md

# CLAUDE.md — Claude Code instructions for WebFlow Studio

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
  `resources/`/`app.asar`, data under `%LOCALAPPDATA%/WebFlow Studio/`).

## Verifying

- Run `npm run build` (typecheck + bundles). There is no lint/test npm script.
- For runner/connector/node changes, run `npm run verify:runner` (live checks via `tsx`).
- For offline/packaging changes, run `npm run validate:offline`.
- Report what you ran and what you could not (e.g. the clean-machine GUI walkthrough).

## After finishing

- Follow the **End-of-task checklist** in `AGENTS.md`: update `docs/ai/CURRENT_STATE.md` and
  append to `docs/ai/TASK_LOG.md`; update other `docs/ai/` files only if they changed.
- End with a concise summary: implementation, files changed, tests run / not run, remaining risks.
