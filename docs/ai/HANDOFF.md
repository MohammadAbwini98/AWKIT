# Agent Handoff

Last updated: 2026-07-04

## Purpose

This file is the active handoff note between AI coding agents and humans. It applies to any coding
agent (Claude Code, Codex, Gemini, Antigravity, future agents) and human developers.

Use this file when work is paused, blocked, or moving from one agent/tool to another.

## Current Handoff

### From Agent / Tool

Previous session (Smart Locator Engine + Git Full Cycle skill; stacked-PR merge cycle)

### To Agent / Tool

Any next agent

### Timestamp

2026-07-04

### Branch / Commit

- **Repository is a Git repo** (earlier handoffs incorrectly reported "not a Git repository" — that is
  no longer true; `git` metadata is available and should be used).
- **Current branch:** `feature/smart-wait-engine` — freshly created from `main`, **empty** (no commits
  yet), working tree **clean**.
- **`main` latest commit:** `35548e1` "Merge pull request #2 from
  MohammadAbwini98/feature/smart-locator-engine".
- **Recent `main` history:** `35548e1` (PR #2 merge) → `9830103` (Smart Locator Engine) → `68a8e6d`
  (PR #1 merge: in-flight recorder + Git Full Cycle skill) → `a8c1ec2` → `46fc59a` → `49c7cdc`.

### Active Task

**None in progress.** `feature/smart-wait-engine` is a clean, empty branch prepared for the next
feature (Smart Wait Engine). Implementation has **not** started — the scope is still to be provided.

### Completed Work (this session)

1. **Smart Locator Engine — targeted runtime delta (merged, PR #2, `9830103`).** Extended the existing
   recorder locator engine (which already generates ranked, uniqueness-validated locators) with the
   missing runtime pieces:
   - `StepLocator` (`src/profiles/FlowProfile.ts`) gained optional `alternatives: LocatorCandidate[]`
     (ranked runtime fallbacks) and `context` (dialog / tableRow / card / listItem / iframe scoping).
     Fully backward compatible — legacy steps set only the primary fields.
   - `LocatorFactory.resolve(step)` (`src/runner/LocatorFactory.ts`) — async resolver: scopes by
     `context` (iframe `frameLocator` → container resolved to its single/visible match), tries primary
     then alternatives, returns a single element per candidate (unique, else the one visible match when
     several exist — the fix for a hidden modal template + a visible modal). Auto-waits on the primary
     when nothing is present yet; throws a per-candidate diagnostic otherwise. `create()` is retained
     for count-assertion / element-loop / `waitFor` paths.
   - `StepExecutor` routes single-target actions through `resolve`; `guardLocatorQuality` defers to the
     resolver when a step has `context`/`alternatives`.
   - Recorder capture script emits up to 3 `alternatives` + detected `context`.
   - Playwright is **1.49** (no `filter({ visible })`), so visibility is probed via `nth(i).isVisible()`.
2. **Git Full Cycle agent skill (merged, PR #1, `a8c1ec2`).** Added a reusable Git-lifecycle skill as
   byte-identical mirrors for Claude/Codex/Gemini + a canonical `docs/ai/skills/` copy, referenced from
   `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`. Also carried the prior in-flight recorder/docs work.
3. **Stacked-PR merge cycle** performed safely: chore branch (in-flight + skill) merged first (PR #1),
   then the Smart Locator feature branch was rebased onto updated `main` (resolving one expected
   `docs/ai/TASK_LOG.md` conflict — kept both entries) and merged (PR #2). Local merged branches were
   deleted; `main` synced fast-forward.

### Files Changed (Smart Locator, the substantive runtime change on `main`)

- `src/profiles/FlowProfile.ts` — `LocatorCandidate` / `LocatorContext` / `StepLocator` types.
- `src/runner/LocatorFactory.ts` — `resolve()` + scoped-root/visibility/diagnostics; `create()` kept.
- `src/runner/StepExecutor.ts` — single-target actions use `resolve`; relaxed `guardLocatorQuality`.
- `src/recorder/recorderInitScript.ts`, `src/recorder/RecorderTypes.ts`,
  `src/recorder/buildRecordedFlow.ts` — emit + propagate `alternatives`/`context`.
- `scripts/verify-recorder-locator.mts` — Part C (+15 runtime fallback/visibility/context checks).
- Docs: `docs/ai/ARCHITECTURE.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.

### Commands / Tests Run (current, on the merged code)

- `npm run verify:recorder` — **42/42** (Parts A/B recorder + quality guard, Part C runtime fallback).
- `npm run verify:runner` — **76/76** (no regressions).
- `npm run build` — clean (`tsc --noEmit` + electron-vite bundles).
- `node scripts/ai-memory/check-memory.mjs` — passed.

### Current State Summary

See `docs/ai/CURRENT_STATE.md`. Build/typecheck clean; recorder suite 42/42; runner suite 76/76. The
Smart Locator runtime fallback + context scoping and the Git Full Cycle skill are on `main`.

### Remaining Work

- **Smart Wait Engine** — not started; implement on the prepared `feature/smart-wait-engine` branch once
  scope is provided. Keep it in its own PR (do not mix with other features).
- **Smart Locator follow-ups (optional, deferred):** UI surface for locator quality — quality badge,
  alternatives panel, debug candidates table, manual-override editor — was intentionally excluded from
  the runtime PR.
- **Clean-machine offline Windows VM walkthrough** (`docs/OFFLINE_STANDALONE_PACKAGING.md`) remains the
  only external release gate; it cannot be satisfied from this dev checkout.

### Known Risks / Blockers

- **`ELECTRON_RUN_AS_NODE=1` is set in this agent environment** — it makes `electron` boot as plain Node
  (breaking GUI launches). `npm run dev` / `npm run verify:flow-designer` clear it themselves; if you
  invoke `electron` directly, clear it first.
- **Playwright 1.49 has no `locator.filter({ visible })`** — the Smart Locator resolver depends on the
  `nth(i).isVisible()` probing approach. Do not switch to `filter({ visible })` without bumping Playwright.
- **Two merged remote branches still exist on `origin`** (`chore/save-inflight-recorder-work`,
  `feature/smart-locator-engine`). They are fully merged into `main` and safe to delete on the remote,
  but were left in place pending explicit user confirmation.

### Do Not Touch Without Confirmation

- **Smart Locator resolution model** (`LocatorFactory`): keep the `resolve()` (single-target, with
  fallback/visibility) vs `create()` (count/loop/waitFor) split, and the `StepLocator` shape. Do not
  pre-fail steps that carry `context`/`alternatives` — the resolver owns that outcome.
- **Branch-connector port model** (`connectorStyle.ts` / `ConnectorPorts.tsx`): do NOT collapse the
  per-slot `<kind>-out-0/1` handles back to a single shared handle (reintroduces the overlap bug).
- Standard rules: don't rename `window.playwrightFlowStudio`, no unrelated refactors, preserve
  offline-first constraints (`docs/ai/RULES.md`).

### Recommended Next Step

Obtain the **Smart Wait Engine** scope, then implement it on `feature/smart-wait-engine` (already checked
out, clean, based on `main`). Verify with `npm run verify:runner` + `npm run build` (and
`npm run verify:recorder` if the recorder capture script is touched). Open a dedicated PR into `main`
(protected — PR-only). The repo-verifiable suites are current: recorder 42/42, runner 76/76, build clean.

### Required First Actions For Next Agent

1. Read `AGENTS.md`.
2. Read `docs/ai/CURRENT_STATE.md`.
3. Read `docs/ai/HANDOFF.md` (this file).
4. Run `git status --short --branch` and inspect `git diff` before editing. Git metadata **is** available.
5. Read `.claude/skills/git-full-cycle/SKILL.md` (or the `.codex`/`.gemini` mirror) before any Git
   branch/stage/commit/push/PR operation.
6. Confirm the plan before risky or broad changes.

## Handoff History

Append older handoffs below when replacing the current handoff.

### 2026-07-03 — Codex/Claude Code — Connector rules, GUI verification, UI bugfixes (superseded)

At the time this checkout reported "not a Git repository," so branch/commit metadata was unavailable
(now corrected). Repo-verifiable connector work was complete: branch-pair 2→1 GUI coverage
(`verify:flow-designer` 18/18 incl. real second-branch drag + survivor-revert); dynamic branch handles
call `useUpdateNodeInternals(id)`; Workflow Builder connector-structure rules enforced at runtime via
`FlowDependencyResolver` / `ScenarioOrchestrator.createExecutionPlan`; manual/protected-login handoff
resumes in place via a shared `ManualHandoffController`. Two follow-up UI bugfixes: `SearchableSelect`
closes on outside canvas click (capture-phase `pointerdown`), and the Recorder captures typed text live
on `input` (consecutive same-field fills collapsed; passwords masked) with draft persistence to
`recorder-draft.json`. Verification then: `verify:runner` 76/76, `verify:flow-designer` 18/18,
`verify:workflow-builder` 13/13, `validate:offline` passed, portable/NSIS packages rebuilt with strict
offline validation. **Do NOT** re-introduce a shared `conditional-out`/`parallel-out` single handle — the
per-slot handles are what make two aligned branch connectors possible. Only open gate: the external
clean-machine offline Windows VM walkthrough.

### 2026-07-03 — Claude Code — AWKIT connector-structure points 1–5 (superseded)

Implemented 5 connector-structure enhancements across the Flow Designer and Workflow Builder, per
`AWKIT_Point_1..5_*_Claude_Prompt.md`: (1) dynamic ports — nodes always show a `normal` handle per side;
`conditional`/`parallel` handles additionally render once an edge of that kind touches the node (derived
at render time via `computePortFlags`, not persisted); (2) duplicate-normal guard — a node may have at
most one standard outgoing connector; blocks Save in both canvases; (3) loop-forces-conditional — a node
with a self-loop connector locks every other outgoing connector's kind selector to Conditional; (4) loop
self-only — a `loop`-kind connector's source and target must be the same node, enforced at save-time (UI)
and run-time (`FlowExecutor.executeFlow`); the legacy `loopBack` edge type is exempt; (5) circular
connector shape — `EdgeVisualStyle.shape` gained `"circular"`, rendered by `SelfLoopEdge`.

Files changed: `src/profiles/FlowProfile.ts` (`"circular"` shape, `validateConnectorStructure`),
`src/runner/FlowExecutor.ts` (self-loop execution model, runtime structure guard),
`app/renderer/components/shared/connectorStyle.ts` (`portHandlesForKind`, `computePortFlags`, circular
default), `app/renderer/components/shared/ConnectorStyleEditor.tsx` (circular option),
`app/renderer/styles/global.css` (port + self-loop label CSS), `app/renderer/components/workflow/
ActionFlowNode.tsx`/`flowDesignerTypes.ts`/`ConnectionPropertiesPanel.tsx`, `app/renderer/pages/
FlowChartDesigner.tsx`, `app/renderer/components/scenario/ScenarioFlowNode.tsx`/`scenarioDesignerTypes.ts`,
`app/renderer/pages/ScenarioBuilder.tsx`, `scripts/verify-runner.mts`. New files:
`app/renderer/components/shared/ConnectorPorts.tsx`, `app/renderer/components/shared/SelfLoopEdge.tsx`.

Commands run: `npx tsc --noEmit` clean, `npm run build` clean, `npm run verify:runner` 70/70,
`npm run validate:offline` passed (dev-mode warnings only).

Remaining work flagged at the time: no GUI walkthrough was performed (this turned out to matter — the
follow-up task found 3 real bugs in this exact surface from a first real GUI test).
