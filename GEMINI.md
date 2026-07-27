@AGENTS.md

# GEMINI.md — Gemini instructions for SpecterStudio

Shared rules live in `AGENTS.md` (imported above) and `docs/ai/`. This file adds
Gemini-specific behavior.

## Source of truth

- Treat `AGENTS.md` and `docs/ai/` as the authoritative project memory. Read them before
  proposing or making changes, following the reading order in `AGENTS.md`.
- Use `docs/ai/CURRENT_STATE.md` to understand what currently works vs. what is incomplete.

## Working rules

- Inspect the relevant implementation files before suggesting edits; do not assume behavior
  when repository evidence is missing — mark it `Unknown / Needs Verification`.
- Keep responses aligned with the current architecture (Electron main + React renderer + a
  `src/` runner/orchestrator core; JSON profile storage; `@xyflow/react` canvases).
- Do not introduce new frameworks, remote/CDN dependencies, or runtime network calls — the app
  must remain offline-first (see `docs/ai/RULES.md`).
- Do not rename internal identifiers such as `window.playwrightFlowStudio`.
- Make minimal, evidence-based changes; avoid unrelated refactors.
- Treat `mock-site/` as AWKIT's local Feature Test Lab. For Recorder, Runner, Smart Wait, Flow Designer,
  Workflow Builder, Instance Monitor, locator, node, wait, or execution features, check
  `mock-site/README.md`, update an applicable scenario, and use `.gemini/skills/mock-site-maintainer`
  when the task touches that surface.

## Verifying & finishing

- Verify with `npm run build`; use `npm run verify:runner` for runner changes and
  `npm run validate:offline` for offline/packaging changes (no lint/test npm script exists).
- For mock-site changes, run `npm run verify:mock-site` plus the related feature verifier.
- After each task, update `docs/ai/CURRENT_STATE.md` and append to `docs/ai/TASK_LOG.md`, per
  the End-of-task checklist in `AGENTS.md`.
- **Keep the Program Status dashboard current** (`npm run roadmap` → <http://127.0.0.1:4380>). It is
  **derived** — it re-parses 13 repository files on a 1.5s poll, so never edit `tools/roadmap/` to
  record progress; update the source that owns the fact. Any change, stage reached, or issue
  observed/reported belongs in `bd` (with `blocks` edges for real dependencies), the validation
  ledger, `DEFECTS.md`, `ImplementationRoadmap.ts`, or the `docs/ai/` memory files. Claim work you
  are actively doing in `tools/roadmap/assignments.json` — it is the only authoritative assignee, and
  claims expire. Finish with `npm run verify:roadmap-dashboard` and confirm the Overview banner reads
  "Sources agree". Procedure and traps: `docs/ai/DEVELOPMENT_WORKFLOW.md` § 6.

## Owner workflow directive - one branch, continuous implementation

AWKIT uses `main` as its single continuing development branch.

- Do not create feature/fix/chore/docs/test/spike/archive/backup branches or normal task worktrees.
- Do not freeze implementation or prohibit commits because work is incomplete, tests fail,
  validation is pending, or an environment is unavailable.
- Commit coherent progress directly to `main` with truthful scoped messages.
- Failed or unexecuted checks must be reported accurately, but they do not prevent development
  commits. Release gates govern release claims, not whether implementation may continue.
- Read `docs/ai/BRANCH_AND_COMMIT_POLICY.md` before any Git operation.

## Git Full Cycle Skill

**`docs/ai/BRANCH_AND_COMMIT_POLICY.md` is the authority; the skills implement it.**

When doing any Git operation, branch work, commit, push, pull, PR creation, or branch
consolidation, first read:

- `.claude/skills/git-full-cycle/SKILL.md` for Claude
- `.codex/skills/git-full-cycle/SKILL.md` for Codex
- `.gemini/skills/git-full-cycle/SKILL.md` for Gemini

The skill must be used before changing branches, staging files, committing, pushing, or opening PRs.
