# Agent Handoff

Last updated: 2026-07-04

## Purpose

This file is the active handoff note between AI coding agents and humans. It applies to any coding
agent (Claude Code, Codex, Gemini, Antigravity, future agents) and human developers.

Use this file when work is paused, blocked, or moving from one agent/tool to another.

## Current Handoff

### From Agent / Tool

Claude (Recorder secure-login browser handoff — protected login/popup detection)

### To Agent / Tool

Any next agent

### Timestamp

2026-07-04

### Branch / Commit

- Repository is a Git repo; always run `git status --short --branch` before editing.
- Current branch: `feature/smart-wait-engine`.
- Work is local-only. Do not fetch, pull, push, or open PRs unless the user explicitly asks.

### Active Task

None in progress. The Recorder-side protected login / protected popup manual Chrome handoff is fully
implemented: detection (`detectRecorderProtectedLogin`), pause + draft preservation + automation-browser
close, real-Chrome session capture (`manualChromeHandoff`), `Auto Secure Login` + `Reuse Session` node
insertion (session id linked, deduped), and Playwright resume via `launchPersistentContext`. Mock Site
secure-login scenarios and `npm run verify:protected-login-recorder` (34/34) added; `npm run build` clean;
runner/recorder/mock-site/popup verifiers all pass. No security bypass; no secrets captured or logged.

### Follow-ups / not done here

- GUI walkthrough of the live handoff (real Chrome launch + persistent-context resume in the running
  Electron app) has not been driven — only mock-site + logic verification.
- Runtime session-expiry handling for the inserted nodes relies on the existing Auto Secure Login /
  Reuse Session + runner Protected Login Handoff; no new runner logic was added.

### Completed Work

1. Recorder-side protected-login/popup detection (`detectRecorderProtectedLogin` /
   `detectFromRecorderSignals` in `ProtectedLoginDetector.ts`) using conservative DOM + text signals
   (detect-only, no secrets). Evaluate body kept free of named function expressions (esbuild `__name`).
2. `RecorderService` handoff state machine: pause + preserve draft + close automation browser; real-Chrome
   session capture (`manualChromeHandoff`); insert `Auto Secure Login` + `Reuse Session` nodes (session id
   linked, deduped); resume recording via `launchPersistentContext`. Extracted shared `wireContext`.
3. `buildRecordedFlow` serializes the secure nodes; IPC + preload for getHandoff / continueWithNormalBrowser
   / captureSessionAndResume / cancelHandoff; Recorder UI handoff panel + always-on poll.
4. Mock Site `/mock/protected-login`, `/mock/protected-popup-login`, `/mock/protected-popup-captcha`,
   `/mock/protected-popup-otp`, `/mock/session-reuse` + index link; `verify-protected-login-recorder.mts` (34/34).

### Files Changed

- Detection/session: `src/security/ProtectedLoginDetector.ts`, `src/session/SessionProfile.ts`,
  `src/session/SessionCaptureService.ts`
- Recorder: `src/recorder/RecorderService.ts`, `src/recorder/RecorderTypes.ts`,
  `src/recorder/buildRecordedFlow.ts`
- IPC/preload/UI: `app/main/ipc/recorder.ipc.ts`, `app/main/preload.ts`, `app/renderer/pages/Recorder.tsx`
- Mock Site/tests: `mock-site/server.mjs`, `mock-site/public/secure-login/*`, `mock-site/public/index.html`,
  `mock-site/README.md`, `scripts/verify-protected-login-recorder.mts`, `package.json`
- Docs: `docs/ai/CURRENT_STATE.md`, `docs/ai/ARCHITECTURE.md`, `docs/ai/TASK_LOG.md`, `docs/ai/HANDOFF.md`

### Commands / Tests Run

- `npm run verify:protected-login-recorder` → 34/34, `verify:protected-login` → 16/16,
  `verify:recorder` → 57/57, `verify:mock-site` → 28/28, `verify:popup` → 12/12, `verify:runner` → 76/76.
- `npm run build` — clean.

### Current State Summary

The Recorder now safely hands off protected login/popup steps to the user's real Chrome, captures a scoped
session, wires the secure-session nodes into the recorded flow, and resumes recording on that session.

### Remaining Work

- Optional GUI walkthrough of the live handoff in the running Electron app (real Chrome + persistent-context
  resume). Runtime session-expiry uses existing Auto Secure Login / Reuse Session behavior.

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

Start from `git status --short --branch`. If only this handoff/task-log refresh is dirty, either continue
work with those docs in place or commit them as a docs-only handoff update. Do not push unless explicitly
asked.

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
