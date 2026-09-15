@AGENTS.md

# CLAUDE.md — Lean Claude Code execution contract

These are Claude Code-specific operating rules for AWKIT. `AGENTS.md` remains the shared source for product, security, offline, UI, testing, and Git constraints. This file controls **how Claude consumes context and executes work**.

## Default behavior: act, do not orbit the task

For an implementation request, move from evidence to a concrete change quickly. Do not spend a session repeatedly planning, rereading project history, reconciling unchanged state, or restating requirements.

Use this loop:

1. Read the user request and identify the smallest acceptance criteria.
2. Inspect the directly implicated source files once.
3. Make the smallest correct edit.
4. Run the narrowest meaningful verification once.
5. Run `npm run build` when product TypeScript/Electron/renderer/runtime code can affect the build.
6. Inspect the final diff/status once, update only project-state sources that actually changed, then commit/push when the active instructions authorize it.
7. Report the result and stop.

Choose an approach and commit to it. Reconsider only when new evidence disproves it.

## Context loading

For Claude Code, the long documentation map in `AGENTS.md` is a **reference map, not a mandatory startup checklist**. Do not preload all project documents.

### Always

- This file (which already imports `AGENTS.md`).
- The user's task/request.
- The directly implicated source files.
- A local `AGENTS.md` only when editing inside a folder that has one.

### Read only when triggered

- `docs/ai/CURRENT_STATE.md`: task depends on current project status, roadmap state, or unfinished work.
- `docs/ai/HANDOFF.md`: resuming handed-off/paused work.
- `docs/ai/ARCHITECTURE.md` / `DECISIONS.md`: cross-layer contract or architecture change.
- `docs/ai/RULES.md`: only the relevant UI/data/offline section when that boundary is touched.
- `docs/ai/COMMANDS.md` / `TESTING.md`: when selecting or changing verification commands.
- `docs/ai/SECURITY.md`: licensing, authentication, authorization, secrets, signing, protected login.
- `docs/OFFLINE_STANDALONE_PACKAGING.md`: packaging/release/offline-runtime work.
- `docs/ai/KNOWN_ISSUES.md`: only when a failure resembles a known fragile area.
- Historical logs, contracts, audits, phase reports, and archives: only to answer a specific historical question.

Never read `TASK_LOG.md`, old handoffs, phase history, all roadmap sources, or all AI docs merely to become familiar with the repository.

## Tool budget

Use the minimum tool surface needed for the task.

### Default tools

Use native Claude Code tools only:

- `Read`
- `Grep` / `Glob`
- `Edit` / `Write`
- `Bash`

Prefer direct source inspection over an abstraction layer.

### Optional tools — not default

- **Graphify:** use only for a genuinely broad dependency/impact question, or when the user explicitly invokes `/graphify`. Never run it before a simple file-level search.
- **Codebase Memory MCP:** do not query it for normal implementation, file discovery, summaries, or routine impact checks. Use it only when native source search cannot cheaply answer a broad architecture question.
- **Beads (`bd`):** use only when the task is tracked, must change tracker state, or the user asks for roadmap/task status. Do not run `bd prime` as routine session startup.
- **GLM/external model delegation:** never automatic. Use only when the user explicitly asks or when one isolated, large investigation clearly reduces total context.
- **Subagents:** zero for normal tasks. Use at most one independent reviewer for a named high-risk trigger: security boundary, concurrency/runtime race, persistence migration, architectural refactor, release claim, difficult stalled root cause, or explicit user request.

Do not stack Graphify + Codebase Memory + subagents + external delegation for the same discovery problem.

## Execution bounds

- One reconnaissance pass per task. Reopen a file only after it changed or a concrete finding requires it.
- Do not poll `git status`, lease state, roadmap state, task gates, or verifiers at unchanged repository state.
- A failing command gets one diagnosis and at most one rerun after a relevant correction.
- A blocked environmental/authorization prerequisite is a terminal `BLOCKED` result for that gate; record it and continue independent work once.
- Do not search for additional defects after the requested acceptance criteria are satisfied.
- Do not create speculative helpers, abstractions, documentation, or refactors that the task does not require.
- Keep raw logs out of the conversation/context. Summarize the useful error lines only.
- Do not repeat instructions, plans, or already-established facts after compaction.

## Leases and Git

Keep the existing AWKIT safety boundaries:

- One writer at a time.
- Never bypass `tools/agents/lease-guard.mjs`.
- Work only on `main`; no task branches/worktrees.
- Preserve all existing user work.
- No reset, stash, destructive restore, force-push, or history rewrite without explicit approval.

When a Git mutation is actually needed, read `docs/ai/BRANCH_AND_COMMIT_POLICY.md` once immediately before the first mutation. Do not reread it for every Git command.

## Verification

Verification is proportional to the change:

- Simple docs/config-only change: relevant syntax/consistency check only.
- Scoped TypeScript/product change: focused verifier if one exists, then `npm run build`.
- Runner/recorder/execution change: focused runtime/mock-site verifier plus build.
- Packaging/offline/security change: relevant dedicated verifier(s) plus build; report unavailable external gates as `BLOCKED`/`NOT RUN`.
- Full suites are reserved for release/phase completion, broad infrastructure changes, or explicit requests.

Never rerun a green verifier when its inputs did not change.

## Project-state updates

Do project-state bookkeeping **once, at the end**, and only for facts the task actually changed. Do not start a task by loading every dashboard source.

When status really moved, update the owning source (`bd`, validation ledger, defect/phase source, or relevant `docs/ai/` state file), run the applicable consistency verifier once, and stop after the bounded reconciliation rules in `AGENTS.md`.

## Stop condition

Stop as soon as all of these are true:

- requested behavior/root cause is addressed, or remaining work is externally blocked;
- relevant verification has run once against the final state;
- required state updates are complete;
- changes are committed/pushed when authorized, or the exact Git blocker is recorded.

Do not start another discovery cycle after this point.

## Final response

Keep the final report compact:

- what changed;
- files changed;
- checks and exact PASS/FAIL/BLOCKED/NOT RUN state;
- Git/commit state when applicable;
- real remaining risk or next action, if any.

Do not include reasoning transcripts, full logs, repeated requirements, or descriptions of unchanged code.
