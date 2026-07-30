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

## graphify — graph-first code retrieval

AWKIT has a local knowledge graph of its **code** at `graphify-out/` (derived, gitignored; rebuild
with `graphify update .`). It is a **retrieval accelerator, not an authority**. Full contract,
coverage, exclusions and refresh procedure: **`docs/ai/GRAPHIFY.md`**.

**Order of operations — do not reorder:**

1. **Read AWKIT's mandatory documents first.** `AGENTS.md` and the required-reading order it lists
   (`docs/ai/CURRENT_STATE.md`, `HANDOFF.md`, `RULES.md`, `ARCHITECTURE.md`, `COMMANDS.md`) are
   authoritative and are **not in the graph** — the graph never substitutes for them.
2. **Then query the graph before broad search.** Prefer `graphify query "<question>"` over
   speculative `Glob`/`Grep` sweeps or repeated whole-file reads. Use `graphify explain "<Symbol>"`
   for a symbol and its neighbours, and `graphify path "<A>" "<B>"` for dependency/impact tracing
   (`graphify affected "<X>"` for reverse impact).
3. **Then open the real files.** Graphify returns `source_file` + `source_location` — read those
   files before editing them or making any critical claim. Never cite the graph as evidence for a
   claim you have not checked in source.

**Fall back to native search** (`Grep`, `Glob`, `Read`, the Codebase Memory MCP) whenever the graph
is stale, incomplete, unsupported for that file type, or simply does not answer the question. It is
a shortcut, never a gate — a missing node means "not indexed", never "does not exist".

**Evidence ranking, highest first:** source code → tests/verifiers → Git state → `docs/ai/` and
`AGENTS.md` → the graph. An `INFERRED` graph edge is a hint; an `EXTRACTED` edge is still only an
AST fact about imports and references, not proof of runtime behaviour.

**Known coverage limits** (full accounting in `docs/ai/GRAPHIFY.md`): code and Markdown are indexed
(Markdown **structurally only** — headings, links, containment; no semantic/LLM edges). **Not**
indexed: all `.css` including `app/renderer/styles/global.css`, all 48 `mock-site/*.html` scenario
pages, `.json` fixtures (parsed, zero nodes), and `docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md`
(excluded on purpose — read them directly). **Use `Grep` for style tokens and mock-site scenarios.**
`graphify path` traverses an **undirected** graph, so a returned path shows connectivity, not call
direction.

**Refresh** after changing code or docs: `graphify update .` (offline, no API key, no token cost).
That is also the canonical **build** command — driving the skill's pipeline by hand without an LLM
key produces a strictly smaller, code-only graph.

**Antigravity integration:** the graphify rule is active at `.agents/rules/graphify.md` (always-on).
The graphify skill is at `.agents/skills/graphify/SKILL.md`. Use `/graphify .` to run the full
pipeline via the installed skill when a full graph build or rebuild is needed.
