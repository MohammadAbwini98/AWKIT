# Agent Handoff

Last updated: 2026-07-03

## Purpose

This file is the active handoff note between AI coding agents and humans. It applies to Claude Code, Codex, Gemini, Antigravity, and future agents.

Use this file when work is paused, blocked, or moving from one agent/tool to another.

## Current Handoff

### Current Status Override (Codex, 2026-07-03)

Repo-verifiable remaining-work items from the previous handoff are resolved:

- Branch-pair 2→1 GUI coverage is now real-Electron verified. `verify:flow-designer` is **18/18** and
  includes a real drag from `conditional-out-1` to create a second branch, then deletion of one branch to
  prove survivor auto-revert.
- Dynamic branch handles now call `useUpdateNodeInternals(id)` in both node components so React Flow can
  drag from newly rendered handles.
- Workflow Builder connector-structure rules now have runtime validation through
  `FlowDependencyResolver` / `ScenarioOrchestrator.createExecutionPlan`.
- Manual/protected-login handoff now resumes in place through a shared `ManualHandoffController`; Continue
  resumes the same live runner/browser and Retry Detection maps to `retryHandoff`, not `repeatInstance`.
- Current verification: `npm run build` clean, `npm run verify:runner` **76/76**, `npm run
  verify:flow-designer` **18/18**, `npm run verify:workflow-builder` **13/13**, `npm run validate:offline`
  passed, `npm run package:portable` and `npm run package:nsis` passed with strict offline validation.

Only external/human remaining gate: run the clean-machine offline Windows VM walkthrough in
`docs/OFFLINE_STANDALONE_PACKAGING.md` using `dist/WebFlow Studio 0.1.0.exe` and
`dist/WebFlow Studio Setup 0.1.0.exe`. This cannot be proven from this dev checkout because the checklist
requires a separate offline VM with no Node, global Playwright, or global Chromium. Older Claude Code notes
below are retained as history but are superseded by this override where they conflict.

### Follow-up (Claude Code, 2026-07-03) — two UI bug fixes

Two user-reported bugs fixed after the override above (no impact on the runtime/packaging state):
- **`SearchableSelect` dropdown** (Flow Designer "Saved Flow" + node property pickers) now closes on an
  outside click over the React Flow canvas — switched its outside-click listener to capture-phase
  `pointerdown` (`SearchableSelect.tsx`). React Flow's pane was swallowing the old bubble-phase `mousedown`.
- **Recorder** now captures typed text **live** on the `input` event (not only `change`/blur), with the
  `RecorderService` binding collapsing consecutive same-field fills into one action
  (`recorderInitScript.ts`, `RecorderService.ts`). Passwords remain masked.
- **Recorder draft persistence:** an unsaved recording (actions + URLs) is now mirrored to
  `recorder-draft.json` under the runtime data root, so it survives an app close and reloads on the
  Recorder page. Cleared on new recording / cancel / save. `RecorderService.configureDraftStorage` +
  `ensureDraftLoaded`/`discardDraft`, wired in `recorder.ipc.ts`. Draft holds no secrets (URLs masked,
  passwords blanked).
- Verification refreshed: `verify:recorder` **25/25** (added a no-blur live-typing case),
  `verify:recorder-draft` **7/7** (draft round-trip), `verify:flow-designer` **19/19** (added a dropdown
  outside-click case), `verify:runner` **76/76** unaffected, build clean.

### From Agent / Tool

Codex

### To Agent / Tool

Any next agent

### Timestamp

2026-07-03

### Branch / Commit

- Branch: Not available in this checkout (`git status` reports this directory is not a Git repository).
- Latest commit: Not available in this checkout.
- Working tree status: Not available from Git; inspect files directly (see Files Changed below).

### Active Task

No repo-verifiable implementation task is currently in progress. See the Codex status override above:
previous connector verification/runtime/handoff gaps are resolved; the remaining gate is the external
clean-machine offline Windows VM walkthrough.

### Completed Work

**Latest task (2026-07-03, connector rules — two-port branch pairs):** see the TASK_LOG entry for full
detail. Key model: `connectorStyle.ts` gained `sourceKind`, `branchSourceHandle`, `slotFromHandle`,
`MAX_BRANCH_CONNECTORS`, and `reconcileBranchConnectors(edges, { kindOf, slotAssign, toNormal, revertSources })`.
`ConnectorPorts.tsx` renders one `normal-out` port, OR two `<kind>-out-0/1` ports when the node has a
conditional/parallel connector. Both `FlowChartDesigner.tsx` and `ScenarioBuilder.tsx` reconcile on
connect/edit/delete/load, cap branch connectors at 2, and revert a lone survivor to Normal on deletion (via
a wrapped `onEdgesChange`). Panels lock the kind/type selects for conditional/parallel/loop and disable the
Loop option (loop is button-only). `FlowExecutor` already gave loop priority + sequential parallel — no
backend change. **Do NOT** re-introduce a shared `conditional-out`/`parallel-out` single handle — the
per-slot handles are what make two aligned branch connectors possible.

**Prior task (2026-07-03, Workflow Builder connector GUI verification):** added
`scripts/verify-workflow-builder-gui.mjs` + `npm run verify:workflow-builder` (real Electron `_electron`
walkthrough of the `.scenario-flow-node` canvas — loads a saved workflow with an edge, then checks ports
un-clipped, Add Loop, top loop port, semicircle-above, add/remove delete, and the Link Type lock).
**13/13 pass** — full parity with the Flow Designer; no bugs found. This closes the last un-walked
connector surface. Gotchas (no code change): `ScenarioBuilder` starts empty and loads `savedWorkflows[0]`
on mount; loaded-workflow edge ids are the saved link ids (not `edge-<src>-<tgt>`), so the lock check
loops every node and selects the remaining non-loop edge rather than parsing the source.

**Prior task (2026-07-03, dev-launch fix + real GUI walkthrough):**

1. **Root-caused & fixed the `npm run dev` "Electron launch crash"** that three prior sessions misdiagnosed
   as a Node/Electron version mismatch. Real cause: the agent/sandbox environment exports
   **`ELECTRON_RUN_AS_NODE=1`**, which makes the Electron binary boot as plain Node (no `app`/
   `BrowserWindow`; `require("electron")` returns the binary path string; the ESM main entry gets loaded
   by bare Node → the `esm/translators` `TypeError`). Fix: `npm run dev` now runs `node scripts/dev.mjs`,
   which deletes `ELECTRON_RUN_AS_NODE` from the child env before spawning `electron-vite dev`. (A CJS-main
   experiment was explored and reverted — the ESM main launches fine once the var is cleared.)
2. **Performed the real GUI walkthrough** via a new `scripts/verify-flow-designer-gui.mjs` +
   `npm run verify:flow-designer` (Playwright `_electron`, launches the built app with the env cleared).
   **13/13 checks pass** on the user's saved "Chatgpt-Login-v1.1" / "Auto Secure Login" flow: un-clipped
   ports (siblings of the card), Add Loop creates a visible edge, top loop port visible on the top edge,
   semicircle above the node, add/remove toggle deletes the edge, and the loop node locks outgoing
   connectors to Conditional in the properties panel. This retroactively validates the loop-port UI task
   below (previously code-only).

**Previous task (2026-07-03, loop-port UI fix — now GUI-verified above):** the user GUI-tested the earlier
connector-port bugfix and found the loop still non-functional and the ports visually corrupted. Redesigned
the loop and fixed the port clipping:

1. **Corrupted ports — root cause & fix.** The previous task added `position: relative` to
   `.action-flow-node`/`.scenario-flow-node`; combined with the pre-existing `overflow: hidden`, that made
   the card the offset parent for the React Flow `<Handle>`s rendered *inside* it, so the edge-hugging
   handles (half outside the card) were **clipped**. Fixed by rendering the handles as **siblings** of the
   `<article>` (in `ActionFlowNode`/`ScenarioFlowNode`), so React Flow positions them against the
   un-clipped `.react-flow__node` wrapper.
2. **Loop redesigned to a top port + semicircle.** Replaced the invisible right-side co-located loop
   anchors with a dedicated **top loop port** (`ConnectorLoopPort`: `loop-out`/`loop-in` on
   `Position.Top`, slightly apart). Handles are always rendered (so the loop edge attaches immediately)
   but invisible/non-interactive until a loop exists (`.connector-port-loop.active`). `SelfLoopEdge` now
   detects a self-loop via `source === target` (node identity, not coordinates) and draws a visible
   **semicircle above** the node.
3. **Reliable add/remove.** The node loop button is now an add/remove **toggle** (filled "active" state +
   "Remove loop connector" title once a loop exists); `addLoop` guards against duplicate self-loops.
4. **Conditional-only enforced on connect.** Both canvases' `onConnect` now force the new connector's kind
   to `conditional` when the source node already has a self-loop (previously only the properties-panel
   lock + save-time validation enforced it).

Backward compatible: loop edges keep the same `loop-out`/`loop-in` handle ids, so existing saved
self-loops re-attach to the new top port automatically.

**Prior task (AWKIT points 1–5, still standing):** 5 connector-structure enhancements — dynamic ports,
duplicate-normal guard, loop-forces-conditional, loop self-only (enforced by `validateConnectorStructure`
in `src/profiles/FlowProfile.ts`, used by `FlowExecutor.executeFlow` and by
`connectorStructureIssues`/`scenarioConnectorStructureIssues` in both canvases), and the circular
connector shape (`SelfLoopEdge.tsx`).

### Files Changed

**Latest task (connector rules — two-port branch pairs):**
- `app/renderer/components/shared/connectorStyle.ts` — `sourceKind` on `ConnectorPortFlags`;
  `branchSourceHandle`, `slotFromHandle`, `MAX_BRANCH_CONNECTORS`, and `reconcileBranchConnectors`;
  `computePortFlags`/`connectorPortKindFromHandle`/`portHandlesForKind` updated for slotted branch handles.
- `app/renderer/components/shared/ConnectorPorts.tsx` — source side renders one `normal-out` port OR a
  two-port branch pair (`<kind>-out-0/1`) when `flags.sourceKind` is set.
- `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — Loop option disabled (Rule 1);
  kind + type selects locked while conditional/parallel/loop; helper text for the pair/loop lock.
- `app/renderer/pages/FlowChartDesigner.tsx`, `app/renderer/pages/ScenarioBuilder.tsx` — `onConnect` caps
  branch connectors at 2 and reconciles; `updateEdgeData` reconciles; edge deletion (wrapped
  `onEdgesChange`, panel delete, node/flow removal) reconciles with `revertSources`; load reconciles; the
  Workflow Builder inline Link Type panel disables Loop and locks the select for branch/loop edges.
- `scripts/verify-flow-designer-gui.mjs` — added conditional-pair GUI checks; loop clicks are now
  overlap-proof (synthetic click dispatch).
- **Docs updated:** `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`, `docs/ai/HANDOFF.md`,
  `docs/ai/TASK_LOG.md`.

**Earlier tasks this session** (still standing): `npm run dev` launch fix (`scripts/dev.mjs` clears
`ELECTRON_RUN_AS_NODE`; `package.json` dev script); real-Electron GUI harnesses
(`scripts/verify-flow-designer-gui.mjs`, `scripts/verify-workflow-builder-gui.mjs` +
`verify:flow-designer`/`verify:workflow-builder` scripts); and the loop-port UI fix (top loop port +
semicircle, un-clipped ports rendered as card siblings, add/remove loop toggle) — see TASK_LOG for detail.

**Previous bugfix task (superseded loop design):** added the loop button, `connectorPortKindFromHandle()`,
`portPositions()`, the `loop` flag on `ConnectorPortFlags`, and the (now-replaced) right-side co-located
loop anchors — see Handoff History / TASK_LOG for detail.

**Prior task (AWKIT points 1–5) — see history below for the full file list:**
`src/profiles/FlowProfile.ts`, `src/runner/FlowExecutor.ts`,
`app/renderer/components/shared/ConnectorStyleEditor.tsx`,
`app/renderer/components/workflow/flowDesignerTypes.ts`,
`app/renderer/components/workflow/ConnectionPropertiesPanel.tsx`,
`app/renderer/components/scenario/scenarioDesignerTypes.ts`, `scripts/verify-runner.mts`,
`app/renderer/components/shared/SelfLoopEdge.tsx`.

### Commands / Tests Run

- `npx tsc --noEmit` / `npm run build` — clean.
- `npm run verify:runner` — superseded by Codex update above: **76/76 passed**.
- `npm run verify:flow-designer` — superseded by Codex update above: **18/18 passed** (real second-branch
  drag + 2→1 survivor-revert now covered).
- `npm run verify:workflow-builder` — **13/13 passed** (Workflow Builder canvas).
- `npm run validate:offline` — passed (dev-mode warnings only).
- `npm run dev` — **now launches the Electron GUI** (4 electron.exe processes, no crash). The prior
  "launch crash" was `ELECTRON_RUN_AS_NODE=1` in the environment (see Completed Work / `KNOWN_ISSUES.md`),
  now handled by `scripts/dev.mjs`.
- `node scripts/ai-memory/check-memory.mjs` — run as part of this update.

### Current State Summary

See `docs/ai/CURRENT_STATE.md` (updated). Build/typecheck clean, runner suite 76/76, Flow Designer GUI
18/18, Workflow Builder GUI 13/13, and current portable/NSIS packages rebuilt with strict offline
validation.

### Remaining Work

- No repo-verifiable connector or handoff implementation work is outstanding from this handoff. The
  branch-pair 2->1 survivor-revert is now covered by the Flow Designer GUI harness, and Workflow Builder
  connector-structure safeguards are enforced before execution through `FlowDependencyResolver`.
- The clean-machine offline GUI walkthrough is still the only open release gate. It must be completed on
  a separate offline Windows VM with no Node, no global Playwright, and no global Chromium; this dev
  checkout can rebuild artifacts and run strict validation, but cannot truthfully satisfy that human VM
  checklist.
- Multi-node branch looping (looping an arbitrary sub-graph, not just one node) remains explicitly out of
  scope; the implemented loop connector repeats a single node.

### Known Risks / Blockers

- **`ELECTRON_RUN_AS_NODE=1` is set in this agent environment** — it makes `electron` run as plain Node
  (breaking GUI launches). `npm run dev` and `npm run verify:flow-designer` clear it themselves; if you
  invoke `electron`/`npx electron` directly, clear it first (`unset ELECTRON_RUN_AS_NODE`).
- Existing saved flows that have a cross-node `loop`-kind edge (not `loopBack`) still fail
  validation/execution (pre-existing, from the AWKIT points 1–5 task) — unaffected by this task.

### Do Not Touch Without Confirmation

- **Branch-connector port model** (`connectorStyle.ts` / `ConnectorPorts.tsx`): do NOT collapse the
  per-slot `<kind>-out-0/1` handles back to a single shared `conditional-out`/`parallel-out` handle — that
  reintroduces the two-connectors-overlap bug. Keep `reconcileBranchConnectors` on every edge mutation.
- Normal rules apply: don't rename `window.playwrightFlowStudio`, don't perform unrelated refactors, keep
  offline-first constraints (see `docs/ai/RULES.md`).

### Recommended Next Step

Run the clean-machine offline GUI walkthrough from `docs/OFFLINE_STANDALONE_PACKAGING.md` against the
freshly rebuilt `dist/WebFlow Studio 0.1.0.exe` and `dist/WebFlow Studio Setup 0.1.0.exe` artifacts. The
repo-verifiable suites are current: `npm run verify:runner` 76/76, `npm run verify:flow-designer` 18/18,
`npm run verify:workflow-builder` 13/13, `npm run validate:offline` passed, and both packaging commands
passed strict offline validation.

### Required First Actions For Next Agent

1. Read AGENTS.md.
2. Read docs/ai/CURRENT_STATE.md.
3. Read docs/ai/HANDOFF.md.
4. Run git status and inspect git diff before editing. If Git metadata is unavailable, record that fact and inspect changed files directly.
5. Confirm plan before risky or broad changes.

## Handoff History

Append older handoffs below when replacing the current handoff.

### 2026-07-03 — Claude Code — AWKIT connector-structure points 1–5 (superseded above)

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
follow-up task above found 3 real bugs in this exact surface from a first real GUI test).
