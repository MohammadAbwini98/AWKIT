@AGENTS.md

# CLAUDE.md — Claude Code instructions for SpecterStudio

Shared rules live in `AGENTS.md` (imported above) and `docs/ai/`. This file adds
Claude Code-specific behavior.

## Subagent policy

**Default behavior: DO NOT spawn subagents.** One capable agent completes one normal task end to
end. Add another model only when independent reasoning provides measurable value.

- **Normal task: 0 subagents.** Bug fixes, UI adjustments, small and medium features, refactoring,
  test fixes, documentation, configuration, routine persistence edits, routine validation, git
  inspection and project-state updates are done by the primary agent, in place.
- **Default maximum for a single task: 1.** Even a high-risk task normally wants one independent
  reader, not a committee — parallel reviewers of one diff mostly re-derive each other at full price.
- **Never spawn a subagent merely because one is available.** Availability is not a reason, and a
  routed role is not an instruction to delegate: deterministic routing (`tools/agents/routing-matrix.mjs`)
  names who is *accountable* for a concern, and by default you discharge that role yourself. Routing,
  risk levels, path ownership and the write lease are all unchanged by this.
- **Delegate only on a named trigger:** major phase completion; release candidate;
  security-sensitive change; concurrency or runtime change; persistence migration; architectural
  refactor; a stalled root-cause investigation; or an explicit request. Name the trigger when you do.
- **Review starts from the diff** — `git diff`, the changed files, the objective, the acceptance
  criteria, the validation already run. Widen into the repository only to prove or disprove a
  concrete finding.
- **No nested delegation.** A subagent completes its assigned scope itself and must not delegate to
  further agents unless you explicitly authorize it.
- **External models are opt-in.** Never invoke `glm-delegate` automatically. It is permitted only
  when you are explicitly asked, when an isolated task is large enough that offloading is
  economically advantageous, or when a genuinely independent second analysis has measurable value —
  never for file searching, summarizing, formatting, test execution, simple edits or state updates.
- **Optimize in this order:** avoid the unnecessary call → minimize context sent → minimize output
  requested → target the validation → *only then* choose a cheaper model. A wasteful call moved to a
  cheaper model is still a wasteful call.

Machine-readable form: `CONCURRENCY_POLICY`, `DELEGATION_TRIGGERS`, `NESTED_DELEGATION` and
`delegationDecisionFor()` in `tools/agents/context-policy.mjs`.

## Before editing

**Always** — three sources, on every task:

- `AGENTS.md` (imported by this file, so one read) and `docs/ai/CURRENT_STATE.md`.
- The active task contract, when the task has one.

**Conditional** — open one *only* when its trigger actually fires:

| When | Read |
|---|---|
| Architecture or cross-layer change (`cross_layer_count >= 2`, `public_contract_change`, `new_dependency`, a module boundary moves) | `docs/ai/ARCHITECTURE.md`, `DECISIONS.md` |
| You are about to choose, run, add or change a verification command | `docs/ai/COMMANDS.md`, `TESTING.md` |
| Security-sensitive work (licensing, auth, authorization, secrets, protected login, signing) | `docs/ai/SECURITY.md` |
| Persistence or schema work (`persisted_shape_change`, `migration_required`, `filesystem_write_change`) | `docs/ai/RULES.md` data rules + the local `AGENTS.md` of the folder |
| Packaging or release work (`packaging_change`, `offline_boundary_change`, `signing_change`, `new_dependency`) | `docs/ai/RULES.md` offline rules, `docs/OFFLINE_STANDALONE_PACKAGING.md` |
| Renderer or UI work (`renderer_visual_change`, `interaction_change`, `accessibility_change`) | `docs/ai/RULES.md` UI rules + the local `AGENTS.md` of the folder |
| Resuming paused or handed-off work | `docs/ai/HANDOFF.md` |
| The area is known-fragile, or a failure looks familiar | `docs/ai/KNOWN_ISSUES.md` |
| Using the code graph, or questioning who owns a path | `docs/ai/GRAPHIFY.md`, `docs/ai/routing/ROUTING_MATRIX.md` |

A small single-layer change fires none of these, and that is the point: for a tiny UI bug the
always-set plus the UI row is the whole budget — no persistence, release, architecture or
historical validation context at all.

- Treat as **historical**: `docs/ai/TASK_LOG.md`, `docs/ai/contracts/`,
  `playwright_flow_studio_updated_phases/`, `change_requests/`, `docs/IMPLEMENTATION_AUDIT.md`, and
  prior phase reports and audits. These stay authoritative for the record, but do not auto-load them
  for routine work — open one to answer a specific question, and read the section, not the file.
- Do not read the entire repository, every planning file, all phase reports, all historical audits
  or unrelated architecture docs to make a scoped change.
- Inspect the actual files (Read/Grep/Glob) before changing them — don't rely on memory of
  prior sessions; the code changes between tasks.

### Default process

1. Read the task and the always-set above; add a conditional source only if its trigger fires.
2. Inspect only the files the change implicates.
3. Implement.
4. Typecheck, then run the relevant verifier, then build when the change can affect a bundle.
5. Report concisely: what changed, what ran, what did not, what remains at risk.
6. Update the state sources the task actually moved.
7. Escalate to a reviewer only on a named trigger.

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
- **Prefer targeted validation, and run it once.** Run the checks the change actually implicates;
  reserve broad sweeps for phase completion, a release candidate, a major refactor, a
  shared-infrastructure change, or an explicit request. If you delegate a review, it re-runs only
  what a specific finding requires — it does not repeat validation you already performed.
- **Targeting is about duplication, not coverage.** The protections below are not optional and are
  never skipped to save tokens when the change implicates them: TypeScript correctness; production
  build; runtime safety; Electron security; offline behavior; Playwright automation integrity;
  Oracle fail-closed behavior; SQLite/data integrity; concurrency and admission controls; packaging
  requirements; regression-sensitive workflows.
- Report what you ran and what you could not (e.g. the clean-machine GUI walkthrough).

## After finishing

- Follow the **End-of-task checklist** in `AGENTS.md`: update `docs/ai/CURRENT_STATE.md` and
  append to `docs/ai/TASK_LOG.md`; update other `docs/ai/` files only if they changed.
- **Keep the Program Status dashboard current** (`npm run roadmap` → <http://127.0.0.1:4380>). It is
  **derived** — it re-parses 13 repository files on a 1.5s poll, so never edit `tools/roadmap/` to
  record progress; update the source that owns the fact. Any change, stage reached, or issue
  observed/reported belongs in `bd` (with `blocks` edges for real dependencies), the validation
  ledger, `DEFECTS.md`, `ImplementationRoadmap.ts`, or the `docs/ai/` memory files. Claim work you
  are actively doing in `tools/roadmap/assignments.json`; claims expire, and it is the only
  authoritative assignee. Finish with `npm run verify:roadmap-dashboard` and confirm the Overview
  banner reads "Sources agree". Procedure and traps: `docs/ai/DEVELOPMENT_WORKFLOW.md` § 6.
- End with a concise summary: implementation, files changed, tests run / not run, remaining risks.

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
3. **Then open the real files.** Graphify returns `source_file` + `source_location` — `Read` those
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
