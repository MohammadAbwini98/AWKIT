# Agent Handoff

Last updated: 2026-07-04

## Purpose

This file is the active handoff note between AI coding agents and humans. It applies to any coding
agent (Claude Code, Codex, Gemini, Antigravity, future agents) and human developers.

Use this file when work is paused, blocked, or moving from one agent/tool to another.

## Current Handoff

### From Agent / Tool

Codex (Smart Wait Engine completion)

### To Agent / Tool

Any next agent

### Timestamp

2026-07-04

### Branch / Commit

- Repository is a Git repo; always run `git status --short --branch` before editing.
- Current branch: `feature/smart-wait-engine`.
- Smart Wait Engine Phase 1/2 were completed in earlier commits on this branch; diagnostics and UI phases
  were completed locally on 2026-07-04. Check `git log --oneline -5` for exact commit ids.

### Active Task

None in progress. Smart Wait Engine implementation is complete locally. Remaining release work is general
project verification, especially the clean-machine offline Windows VM walkthrough.

### Completed Work (current Smart Wait branch)

1. Smart Wait runner support: `FlowStep.beforeWaits` / `afterWaits` use the shared `WaitCondition` model
   and execute around actions, including armed response waits.
2. Smart Wait recorder observation: the recorder passively observes safe DOM/network/page signals and
   attaches high-confidence `afterWaits` to the previous action.
3. Diagnostics polish: wait failures include phase, sanitized current URL, condition, timeout, recorded
   reason, last observed state, and a suggestion.
4. Recorder UI: Controls exposes a persisted Smart Wait toggle and recorded actions summarize captured
   wait types.
5. Flow Designer UI: save/load preserves `beforeWaits`/`afterWaits`; Node Properties shows a Smart Waits
   section for timeout tuning/removal.
6. Flow Designer GUI verifier: navigation now clicks by visible label instead of stale `title` text.

### Files Changed (current Smart Wait completion)

- `src/runner/StepExecutor.ts`
- `scripts/verify-waits.mts`
- `scripts/verify-flow-designer-gui.mjs`
- `app/renderer/pages/Recorder.tsx`
- `app/renderer/pages/FlowChartDesigner.tsx`
- `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx`
- `app/renderer/components/workflow/flowDesignerTypes.ts`
- `app/renderer/styles/global.css`
- `docs/ai/ARCHITECTURE.md`
- `docs/ai/CURRENT_STATE.md`
- `docs/ai/FEATURES.md`
- `docs/ai/TESTING.md`
- `docs/ai/TASK_LOG.md`
- `docs/ai/HANDOFF.md`

### Commands / Tests Run

- `npm run typecheck` - passed.
- `npm run verify:waits` - 18/18.
- `npm run verify:runner` - 76/76.
- `npm run verify:recorder` - 57/57.
- `npm run verify:recorder-draft` - 17/17.
- `npm run build` - clean (`tsc --noEmit` + electron-vite bundles).
- `npm run verify:flow-designer` - 19/19.
- `node scripts/ai-memory/check-memory.mjs` - passed.

### Current State Summary

See `docs/ai/CURRENT_STATE.md`. Smart Wait Engine is complete locally; build/typecheck and the relevant
runner/recorder/wait/Flow Designer suites pass.

### Remaining Work

- Clean-machine offline Windows VM walkthrough (`docs/OFFLINE_STANDALONE_PACKAGING.md`) remains the only
  external release gate; it cannot be satisfied from this dev checkout.
- Smart Locator follow-ups are still optional/deferred: quality badge, alternatives panel, debug candidates
  table, and manual override editor.

### Known Risks / Blockers

- `ELECTRON_RUN_AS_NODE=1` in agent environments makes direct Electron launches boot as plain Node. The
  project GUI verification scripts clear it themselves; clear it manually for ad hoc Electron commands.
- Playwright 1.49 has no `locator.filter({ visible })`; existing locator fallback logic uses
  `nth(i).isVisible()` probing.

### Do Not Touch Without Confirmation

- Do not rename `window.playwrightFlowStudio`.
- Do not break offline-first constraints: no runtime internet, no global Node/Playwright/Chromium, and no
  writes to `resources/` or `app.asar`.
- Keep Smart Locator's `LocatorFactory.resolve()` vs `create()` split.
- Keep the branch-connector per-slot `<kind>-out-0/1` handle model.

### Recommended Next Step

Inspect `git status` and open a dedicated PR into `main` when ready (protected - PR-only). The
repo-verifiable suites are current: waits 18/18, recorder 57/57, recorder-draft 17/17, runner 76/76,
Flow Designer GUI 19/19, build clean.

### Required First Actions For Next Agent

1. Read `AGENTS.md`.
2. Read `docs/ai/CURRENT_STATE.md`.
3. Read `docs/ai/HANDOFF.md` (this file).
4. Run `git status --short --branch` and inspect `git diff` before editing.
5. Read `.claude/skills/git-full-cycle/SKILL.md` (or the `.codex`/`.gemini` mirror) before any Git
   branch/stage/commit/push/PR operation.
6. Confirm the plan before risky or broad changes.

## Handoff History

Older handoff detail is preserved in Git history. The current handoff above supersedes the stale
pre-Smart-Wait branch-preparation note.
