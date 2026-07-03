# AGENTS.md — WebFlow Studio

Shared instruction file for AI coding agents (Claude Code, OpenAI Codex, Gemini).
Keep this file concise. Detailed, evolving context lives under `docs/ai/`.

## What this project is

**WebFlow Studio** is an offline-capable **Windows desktop app** (Electron + React + TypeScript)
for visually building and running **Playwright** web-automation flows and workflows. It runs
fully offline in production with a bundled Chromium — no internet, global Node, global
Playwright, or admin rights required.

## Required reading order

1. This file (`AGENTS.md`)
2. `docs/ai/PROJECT_BRIEF.md` — what/why/who
3. `docs/ai/CURRENT_STATE.md` — what works / what's incomplete *(read every task)*
4. `docs/ai/HANDOFF.md` — active handoff/takeoff notes *(read before implementation work)*
5. `docs/ai/ARCHITECTURE.md` — module map, data/runtime flow
6. `docs/ai/RULES.md` — non-negotiable rules
7. `docs/ai/COMMANDS.md` — verified commands
8. `docs/ai/KNOWN_ISSUES.md`, `docs/ai/TESTING.md`, `docs/ai/SECURITY.md` — as relevant
9. Any local `AGENTS.md` in folders you will modify

## Documentation map

| File | Purpose |
|---|---|
| `docs/ai/PROJECT_BRIEF.md` | Project purpose, users, scope |
| `docs/ai/CURRENT_STATE.md` | Live status — update after every task |
| `docs/ai/HANDOFF.md` | Active cross-agent handoff/takeoff note |
| `docs/ai/FEATURES.md` | Feature inventory by module |
| `docs/ai/ARCHITECTURE.md` | Folder map, backend/renderer/runner, data flow |
| `docs/ai/COMMANDS.md` | Verified build/run/test/package commands |
| `docs/ai/RULES.md` | Coding, architecture, offline, UI rules |
| `docs/ai/KNOWN_ISSUES.md` | Bugs, fragile areas, risky assumptions |
| `docs/ai/TASK_LOG.md` | Chronological task log — append after every task |
| `docs/ai/DECISIONS.md` | Recorded technical/product decisions |
| `docs/ai/SECURITY.md` | Secret handling, safe-automation rules |
| `docs/ai/TESTING.md` | Test frameworks, how to verify |
| `docs/ai/DEVELOPMENT_WORKFLOW.md` | How agents start/finish a task |

Project spec/history also lives in `playwright_flow_studio_updated_phases/` (master spec),
`change_requests/` (historical change prompts), `IMPLEMENTATION_STATUS.md`, and
`docs/IMPLEMENTATION_AUDIT.md` / `docs/OFFLINE_STANDALONE_PACKAGING.md`.

## General coding rules (summary — see `docs/ai/RULES.md`)

- Inspect files before editing; make **minimal, scoped** diffs; no unrelated refactors.
- Match existing patterns (TypeScript, plain CSS in `app/renderer/styles/global.css`, React Flow, JSON profile stores).
- Do **not** rename the `window.playwrightFlowStudio` preload API identifier (internal contract).
- Preserve **offline-first**: no runtime internet, no CDN/remote fonts/scripts, no global Node/Playwright/Chromium; never write mutable data into `resources/` or `app.asar`.
- Mutable runtime data goes under `%LOCALAPPDATA%/WebFlow Studio/` (or user-configured Settings paths).
- Keep TypeScript clean — `npm run build` runs `tsc --noEmit` and must pass.

## Testing rules

- There is **no** `lint` and **no** `test` npm script. Verification = `npm run build` (typecheck + bundles) and `npm run verify:runner` (live runner checks against the mock site via `tsx`).
- After logic changes to the runner/orchestrator, run `npm run verify:runner` and report the pass count.
- For offline/packaging changes, run `npm run validate:offline`.
- See `docs/ai/TESTING.md` for details and the Node-version caveat for `@playwright/test`.

## Security rules (summary — see `docs/ai/SECURITY.md`)

- Never commit/paste secrets into code or docs. `.env.example` documents env keys; real `.env` is local only.
- This app is for **authorized** automation only — never bypass CAPTCHA/MFA/bot-detection; use manual handoff.
- Mask secrets in logs/reports.

## End-of-task checklist

1. `npm run build` passes (and `npm run verify:runner` / `npm run validate:offline` if runner/offline touched).
2. Summarize the change, list files changed, list tests run and not-run (with why).
3. Update `docs/ai/CURRENT_STATE.md` if state/behavior/commands/architecture changed.
4. Update `docs/ai/HANDOFF.md` when work is paused, blocked, or being handed to another agent/human.
5. Append an entry to `docs/ai/TASK_LOG.md` (date, agent, task, files, tests, result).
6. Add to `docs/ai/KNOWN_ISSUES.md` if you hit a repeated bug, fragile area, or risky assumption.
7. Update `FEATURES.md` / `ARCHITECTURE.md` / `COMMANDS.md` / `DECISIONS.md` only if those changed.
8. Note remaining risks or manual verification (e.g. the clean-machine GUI walkthrough).
