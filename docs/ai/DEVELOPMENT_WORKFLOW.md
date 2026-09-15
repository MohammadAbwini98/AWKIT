# DEVELOPMENT_WORKFLOW

> **Workflow (2026-07-25):** AWKIT develops on `main` only — no feature/spike/backup branches, no
> task worktrees, and no freeze before committing. Failing or incomplete states are committed with
> truthful messages; release gates govern release claims, not whether work may continue.
> Authority: `docs/ai/BRANCH_AND_COMMIT_POLICY.md`. Any branch-per-task guidance below is superseded.

How AI agents should work in this repository.

## 1. Start — load context
- Read `AGENTS.md`, then follow its required-reading order: `docs/ai/PROJECT_BRIEF.md`,
  `CURRENT_STATE.md`, `HANDOFF.md`, `ARCHITECTURE.md`, `RULES.md`, `COMMANDS.md`, plus
  `KNOWN_ISSUES.md` / `TESTING.md` / `SECURITY.md` as relevant.
- **Reading is bounded (anti-loop rule):** read the *newest section* of `CURRENT_STATE.md` and
  `HANDOFF.md` first; read older sections only when the task directly concerns them. Historical
  handoffs live in `docs/ai/HANDOFF_ARCHIVE.md` and are never read at startup. One
  reconnaissance pass per task — do not reread unchanged files.
- If resuming after a compaction or continuation, reuse the checkpoint's established facts and
  recorded command results (`%LOCALAPPDATA%/AWKIT/claude-context/`) instead of re-deriving
  repository state.
- Read any **local `AGENTS.md`** in folders you will modify (these add folder-specific rules and
  take precedence within their folder; they must not contradict the root rules). Local files exist at:
  `app/main/AGENTS.md`, `app/renderer/AGENTS.md`, `src/AGENTS.md`, `scripts/AGENTS.md`,
  `tests/AGENTS.md`, `docs/AGENTS.md`.

## 2. Inspect before editing
- Use search/read tools on the actual files — code evolves between tasks; don't rely on memory.
- Identify the IPC method(s), profile schema(s), and UI screen(s) involved. The renderer talks to
  main only via `window.playwrightFlowStudio.*`.

## 3. Make safe changes
- Minimal, scoped diffs; match existing patterns; no unrelated refactors; no renaming internal
  identifiers (`window.playwrightFlowStudio`).
- Reuse shared canvas helpers instead of duplicating: connector visuals via
  `components/shared/connectorStyle.ts` (`buildConnectorVisual`), the connector style UI
  (`ConnectorStyleEditor`), and long dropdowns (`SearchableSelect`) — both designers depend on these.
- Respect offline-first and storage rules in `RULES.md`.
- Never add login-protection bypass (CAPTCHA/MFA/bot-detection/stealth) — protected logins must use the
  Protected Login Handoff (detect + pause). See `docs/PROTECTED_LOGIN_HANDOFF.md` and `SECURITY.md`.
- Treat `mock-site/` as the local Feature Test Lab. For Recorder, Runner, Smart Wait, Flow Designer,
  Workflow Builder, Instance Monitor, locator, node, wait, or execution features, decide whether an
  existing scenario needs to be updated before adding separate fixtures.
- For large/risky changes (runner, orchestrator, packaging, settings schema, IPC), plan first
  (Claude Code: use plan mode).

## 4. Verify
- **Change-triggered reruns (authoritative).** Run each relevant verifier once against the final
  changed state. Rerun it only when (1) relevant source or configuration changed, (2) a required
  artifact was regenerated, (3) the previous result was inconclusive for a now-corrected cause,
  or (4) it is an explicitly required final-state gate that has not run against the current
  state. A green result at unchanged inputs is reused, not repeated; a `BLOCKED`/`NOT RUN`
  environmental result is recorded once as terminal for that gate.
- Always: `npm run build` (typecheck + bundles).
- Runner/connector/node changes: `npm run verify:runner` (report pass count; add a case for new behavior).
- Mock Site changes: `npm run verify:mock-site` plus the related feature verifier.
- Instance Monitor card-logic changes: `npm run verify:instance-monitor` (pure functions in
  `src/instances/instanceCardLogic.ts`).
- Offline/packaging changes: `npm run validate:offline` (and repackage if needed).
- UI changes: `npm run dev` and exercise the screen. To get realistic data for the Flow Designer /
  Workflow Builder, run `npm run mock-site` + `npm run seed:mock-fixtures` first (test-only Mock —
  flows/workflows/data source). Report anything you could not run (e.g. the clean-machine GUI
  walkthrough).
- Record each executed verifier and its exact result with
  `node tools/agents/compaction-checkpoint.mjs record --task <id> --command "<cmd>" --result <PASS|FAIL|BLOCKED|NOT RUN>`
  so a compaction or continuation reuses the evidence instead of rerunning it.

## 5. Update memory (every task)
- Update `docs/ai/CURRENT_STATE.md` if state/behavior/commands/architecture changed.
- Update `docs/ai/HANDOFF.md` when work is paused, blocked, or handed to another agent/tool or human.
- Append an entry to `docs/ai/TASK_LOG.md` (date, agent, task, files, tests run/not-run, result).
- Add to `docs/ai/KNOWN_ISSUES.md` for repeated bugs / fragile areas / risky assumptions.
- Update `FEATURES.md` / `ARCHITECTURE.md` / `COMMANDS.md` / `DECISIONS.md` / `TESTING.md` only if
  those actually changed.

## Agent handoff workflow
- Use `docs/ai/HANDOFF.md` as the active transfer note between Claude Code, Codex, Gemini,
  Antigravity, future agents, and human developers.
- **Keep `HANDOFF.md` bounded.** It carries the newest handoff entry plus the structured
  `## Purpose` / `## Current Handoff` / `## Handoff History` template only. When adding an entry,
  move the older `## HANDOFF (...)` sections into `docs/ai/HANDOFF_ARCHIVE.md` (append, newest
  last, no edits to their content). `npm run ai:memory:check` warns once `HANDOFF.md` exceeds
  64 KiB; history is preserved in the archive and in Git — never deleted.
- `/HANDOFF` prepares the repo for the next agent: inspect current state, update `HANDOFF.md`,
  append `TASK_LOG.md`, update other memory files only when relevant, then run
  `node scripts/ai-memory/check-memory.mjs`.
- `/TAKEOFF` resumes safely: read the **newest section** of `HANDOFF.md` only, inspect the actual
  repo state before editing, compare the handoff against files on disk, then report completed
  work, remaining work, risks, likely files, and verification commands before risky or broad
  implementation. Do not read `HANDOFF_ARCHIVE.md` at startup.
- Keep handoffs short and factual. Do not copy secrets, tokens, cookies, passwords, private URLs,
  credentials, or session values into Markdown.

## 6. Keep the Program Status dashboard current (every task)

`npm run roadmap` → <http://127.0.0.1:4380> is the single view of what is left, in what order,
blocked by what, and who is on it. **Contract: `tools/roadmap/README.md`.**

> **The dashboard is DERIVED. Never edit it to record progress.**
> It re-parses 13 repository files on a 1.5s poll, so it updates itself the moment a source changes.
> Hand-editing anything under `tools/roadmap/` to change a number would make the page disagree with
> the repository — which is the exact failure it exists to detect. Update the **source**; the page
> follows within ~1.5s with no restart.

Whenever you make a change, reach a stage, or observe/report an issue, update the source that owns
that fact:

| What happened | Update this — the dashboard reads it |
|---|---|
| Work started / finished / newly discovered | `bd` (`.beads/issues.jsonl`) — create, `--claim`, close; add `blocks` edges for real dependencies |
| A test case changed status | `docs/testing/comprehensive-validation/RECORDER_REPORTS_SETTINGS_TEST_CASES.md` |
| A defect observed, reported, or fixed | `.../DEFECTS.md` (keep `Detected by` pointing at a real case id) |
| Requirement coverage changed | `.../TRACEABILITY_MATRIX.csv` |
| A roadmap phase changed status | `src/roadmap/ImplementationRoadmap.ts` |
| State / behaviour / commands changed | `docs/ai/CURRENT_STATE.md` |
| Work paused, blocked, or handed over | `docs/ai/HANDOFF.md` |
| Any task finished | `docs/ai/TASK_LOG.md` |
| A fragile area or risky assumption | `docs/ai/KNOWN_ISSUES.md` |
| A new `verify:*` / `validate:*` script | `scripts/lib/verifier-classification.ts` (`verify:verifier-classification` fails until you do) |
| You are taking sustained ownership of an item | `tools/roadmap/assignments.json` — see below |

**Dependencies are only real if you declare them.** The ordering view can only use `blocks` edges
from `bd`. Today 24 of 29 queued issues declare none, so their rank is a priority sort, not a
schedule. If you know B cannot start until A lands, record it — otherwise the dashboard cannot.

**Claiming work.** Add an entry to `tools/roadmap/assignments.json` when you start sustained work on
an item, and remove it when you stop. It is the **only** authoritative "who is on it" — the tracker
has no per-issue assignee and `TASK_LOG.md` records only completed work. Claims expire
(`claimedAt + 24h` by default) because a stale claim is worse than none. The muted *"recent activity
in this area"* line is derived from `TASK_LOG.md`, is never authoritative, and must never be written
or read as "who is working on this".

**Then confirm you did not introduce drift:**

```bash
npm run verify:roadmap-dashboard
```

and open the Overview — its consistency banner must read **"Sources agree"**. An amber banner means
two sources now claim different things; fix the source that is wrong. Do not reconcile it in the
dashboard. **Reconciliation is capped at two rounds:** if the second run still disagrees, fix the
one clearly-wrong in-scope source or record the drift as `INCONCLUSIVE` naming the disagreeing
sources — never enter a third loop. Expired time-based claims (24h) are expected drift, not
failure.

### Two traps that have already bitten

1. **The newest `##` section of `CURRENT_STATE.md` and `HANDOFF.md` must carry the ledger tally**
   (`N PASS / N NOT RUN / N BLOCKED`). The parser scopes to the newest heading only, so adding a
   section without that line silently drops a consistency source. `verify:roadmap-dashboard` check
   #3 catches it.
2. **Registering a new verifier is not optional.** `verify:verifier-classification` fails while any
   `verify:*` / `validate:*` script is missing from the registry, and it stayed red for two sessions
   because of exactly this.

## 7. Finish — report
- Summary of the change; files changed; tests run and not-run (with why); remaining risks or manual
  verification needed.
- Finish under the **Stopping semantics** in `AGENTS.md`: once implementation is complete or
  externally BLOCKED, final-state verification has run once, sources are reconciled within the
  caps, and work is committed with remaining gates truthfully reported — stop. Reserve ~20% of
  the context window for this report; record established facts with the compaction-checkpoint
  `record` CLI before ending a long session.

## Quick reference
- Build/run/test/package commands: `docs/ai/COMMANDS.md`.
- What works / is incomplete: `docs/ai/CURRENT_STATE.md`.
- Module map & data flow: `docs/ai/ARCHITECTURE.md`.
