# 14 — Next Implementation Prompt (paste into Claude Code / Codex)

> Use this **only after** you approve the mock (`mockups/awkit-template-mock.html`) and the design
> direction in `02`/`03`. It starts **Phase 1 only**.

---

**PROMPT:**

You are working in the AWKIT / WebFlow Studio codebase. We are executing the approved UI re-skin
documented in `docs/ai/ui-reskin-template-plan/` (premium dark SaaS: violet→blue accent, dark
surfaces, hairline borders, large radius, soft depth/glow, glass chrome, animated connectors). The
approved visual target is `docs/ai/ui-reskin-template-plan/mockups/awkit-template-mock.html` and the
token set in `03_DESIGN_TOKENS_AND_GLOBAL_CSS_PLAN.md`.

Before doing anything, read `AGENTS.md`, `CLAUDE.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/RULES.md`,
`docs/ai/ARCHITECTURE.md`, `docs/ai/COMMANDS.md`, and the plan folder above. Follow
`.claude/skills/git-full-cycle/SKILL.md` for any branch/commit work.

**Do ONLY Phase 1 from `11_IMPLEMENTATION_PHASES.md` — Baseline screenshots + code audit. Implement
NO visual changes.** Specifically:

1. Capture baseline "before" screenshots of every page and key state if the GUI can be launched
   (Dashboard, Flow Designer empty/populated/running/error, Workflow Builder, Recorder idle/recording,
   Instances list/running/cancelled, Instance Monitor live, each Reports tab, Settings, a modal, an
   empty state, a loading state). Save under `docs/ai/ui-reskin-template-plan/mockups/screenshots/before/`.
   If the GUI cannot be launched here, note that and list exactly which shots a human must capture.
2. Audit old-skin usage: grep hardcoded colors in `app/renderer/styles/global.css` and inventory the
   inline `style={{…}}` blocks in `app/renderer/**/*.tsx`. Produce a hotspot list with file:line and a
   proposed token mapping (align to `03`). Save as `docs/ai/ui-reskin-template-plan/AUDIT_PHASE1.md`.
3. Confirm the current token block and where `--awkit-*` is vs. isn't applied. Note any binding you
   must NOT touch (`window.playwrightFlowStudio`, React Flow geometry, handle IDs, edge `data` schema,
   canvas route no-transform rule).
4. Update `docs/ai/CURRENT_STATE.md` and append a Phase 1 entry to `docs/ai/TASK_LOG.md`.

**Constraints:** Do not change any component markup, CSS values, tokens, routing, or IPC in this
phase. Do not start Phase 2+. Minimal-diff, offline-first rules from `docs/ai/RULES.md` apply.

**Verify:** run `npm run build` (must stay green — you changed no source). Report what you ran and any
GUI steps you could not perform here.

**When done: STOP and report** — baseline coverage, audit findings (hotspot counts + mapping),
do-not-touch list, and the exact command list for Phase 2. Do not continue automatically.
