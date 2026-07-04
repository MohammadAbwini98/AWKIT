# Agent Handoff

Last updated: 2026-07-04

## Purpose

This file is the active handoff note between AI coding agents and humans. It applies to any coding
agent (Claude Code, Codex, Gemini, Antigravity, future agents) and human developers.

Use this file when work is paused, blocked, or moving from one agent/tool to another.

## Current Handoff

### From Agent / Tool

Codex (Mock Site Feature Test Lab update)

### To Agent / Tool

Any next agent

### Timestamp

2026-07-04

### Branch / Commit

- Repository is a Git repo; always run `git status --short --branch` before editing.
- Current branch: `feature/smart-wait-engine`.
- Work is local-only. Do not fetch, pull, push, or open PRs unless the user explicitly asks.

### Active Task

None in progress. Smart Wait Engine is complete locally, and the mock site has been upgraded into the
local Feature Test Lab with dedicated scenarios and verifier coverage.

### Completed Work

1. Added Feature Test Lab pages under `mock-site/public/`:
   - `/` scenario index.
   - `/smart-waits` for Smart Wait/Runner timing scenarios.
   - `/recorder-lab` for Recorder, locator, waiting-time, saved URL, dynamic DOM, and Start/End flows.
   - `/designer-lab` for Flow Designer, Workflow Builder, workflow cards, and Smart Wait scenario data.
2. Added local `/api/delay?ms=...` JSON endpoint in `mock-site/server.mjs`.
3. Added `npm run verify:mock-site` via `scripts/verify-mock-site.mjs` (28/28 current checks).
4. Updated Mock Site docs and AI guidance so future feature work must consider the Feature Test Lab.
5. Added `mock-site-maintainer` skills under `.agents/skills/`, `.claude/skills/`, and `.gemini/skills/`.

### Files Changed

- Mock site: `mock-site/server.mjs`, `mock-site/public/*`, `mock-site/README.md`, `mock-site/AGENTS.md`.
- Verifier/commands: `scripts/verify-mock-site.mjs`, `package.json`, `scripts/AGENTS.md`,
  `tests/AGENTS.md`.
- Agent guidance: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/*`,
  `.agents/skills/mock-site-maintainer/SKILL.md`, `.claude/skills/mock-site-maintainer/SKILL.md`,
  `.gemini/skills/mock-site-maintainer/SKILL.md`.
- AI memory/docs: `docs/ai/ARCHITECTURE.md`, `docs/ai/COMMANDS.md`, `docs/ai/CURRENT_STATE.md`,
  `docs/ai/DEVELOPMENT_WORKFLOW.md`, `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`,
  `docs/ai/TESTING.md`, `README.md`, `resources/test-fixtures/mock-site/README.md`.

### Commands / Tests Run

- `npm run build` - passed.
- `npm run verify:waits` - 18/18.
- `npm run verify:runner` - 76/76.
- `npm run verify:recorder` - 57/57.
- `npm run verify:recorder-draft` - 17/17.
- `npm run verify:flow-designer` - 19/19.
- `npm run verify:mock-site` - 28/28.
- `node scripts/ai-memory/check-memory.mjs` - passed.

### Current State Summary

See `docs/ai/CURRENT_STATE.md` and `mock-site/README.md`. The mock site is now the mandatory local Feature
Test Lab for Recorder, Runner, Smart Wait, Flow Designer, Workflow Builder, Instance Monitor, locator,
node, wait, and execution work. New scenarios must stay offline/local, deterministic, documented, and
verified.

### Remaining Work

- Clean-machine offline Windows VM walkthrough (`docs/OFFLINE_STANDALONE_PACKAGING.md`) remains the only
  external release gate; it cannot be satisfied from this dev checkout.
- Optional future work: add seeded Flow/Workflow fixtures that directly target `/smart-waits`,
  `/recorder-lab`, or `/designer-lab` when a feature needs app-level saved-profile coverage.

### Known Risks / Blockers

- `ELECTRON_RUN_AS_NODE=1` in agent environments makes direct Electron launches boot as plain Node. The
  project GUI verification scripts clear it themselves; clear it manually for ad hoc Electron commands.
- Playwright 1.49 has no `locator.filter({ visible })`; existing locator fallback logic uses
  `nth(i).isVisible()` probing.

### Do Not Touch Without Confirmation

- Do not rename `window.playwrightFlowStudio`.
- Do not break offline-first constraints: no runtime internet, no global Node/Playwright/Chromium, and no
  writes to `resources/` or `app.asar`.
- Keep Mock Site scenarios local-only, deterministic, and free of external services.

### Recommended Next Step

Inspect `git status`, run the requested verification suite, then create one local commit when the tree is
clean and verification passes. Do not push.

### Required First Actions For Next Agent

1. Read `AGENTS.md`.
2. Read `docs/ai/CURRENT_STATE.md`.
3. Read `docs/ai/HANDOFF.md` (this file).
4. Run `git status --short --branch` and inspect `git diff` before editing.
5. For mock-site work, read `mock-site/AGENTS.md`, `mock-site/README.md`, and the `mock-site-maintainer`
   skill for your agent surface.
6. Read `.claude/skills/git-full-cycle/SKILL.md` (or the `.codex`/`.gemini` mirror) before any Git
   branch/stage/commit/push/PR operation.

## Handoff History

Older handoff detail is preserved in Git history.
