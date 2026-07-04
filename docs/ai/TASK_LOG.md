# TASK_LOG

Append a new entry after every task (newest at top). Keep entries short and factual.

---

## 2026-07-04 — Claude Code — Handoff prep after Smart Locator + Git Full Cycle merges

- **Task:** `/HANDOFF` — prepare the repo for the next agent/human after the stacked-PR merge cycle.
- **Repo state:** `main` at `35548e1` (PR #2 merge); both PRs merged; local merged branches deleted;
  now on a clean `feature/smart-wait-engine` branch (no feature work started). Git metadata is available
  (earlier handoffs' "not a Git repository" note is obsolete).
- **Docs updated:** rewrote `docs/ai/HANDOFF.md` (new current handoff: Smart Locator runtime delta +
  Git Full Cycle skill merged, Smart Wait Engine is the next feature; superseded 2026-07-03 connector
  content moved to Handoff History). Added the `git-full-cycle` cross-agent skill to the
  `docs/ai/CURRENT_STATE.md` AI-agent-architecture inventory.
- **Validation:** `node scripts/ai-memory/check-memory.mjs` — passed. Docs only, so
  `verify:recorder`/`verify:runner`/`build` not re-run this turn (current on `main`: 42/42, 76/76, clean).
- **Note:** Two merged remote branches (`chore/save-inflight-recorder-work`,
  `feature/smart-locator-engine`) still exist on `origin`, left pending user confirmation to delete.

## 2026-07-04 — Claude Code — Smart Locator: runtime fallback, visibility disambiguation, context scoping

- **Task:** Make the existing recorder locator engine production-ready by adding the missing runtime
  delta (the recorder already generates ranked, uniqueness-validated locators). Targeted scope from
  the Smart Locator Engine plan — no new module tree, minimal diffs.
- **What was added:**
  - **Structured locator model** (`src/profiles/FlowProfile.ts`): `StepLocator` now carries optional
    `alternatives: LocatorCandidate[]` (ranked runtime fallbacks) and `context` (container/frame
    scoping). `FlowStep.locator` points at `StepLocator`. Fully backward compatible — legacy steps set
    only the primary fields and deserialize unchanged.
  - **Runtime resolver** (`src/runner/LocatorFactory.ts`): new async `resolve(step)` builds a scoped
    root from `context` (iframe `frameLocator`, then a container resolved to its single/visible match),
    tries the primary then `alternatives` in order, and returns a **single** element per candidate —
    unique match wins, else the one *visible* match when several exist (the fix for a hidden modal
    template + visible modal). Falls back to the primary (auto-wait) when nothing is present yet, and
    throws an actionable diagnostic (per-candidate count/visibleCount + context) when genuinely
    ambiguous. Playwright is 1.49 (no `filter({ visible })`), so visibility is probed via
    `nth(i).isVisible()`. `create()` is retained for count/loop/waitFor paths.
  - **StepExecutor** (`src/runner/StepExecutor.ts`): single-target actions (click/fill/select/check/
    uncheck/radio/scroll-element/upload/download/readText/assertVisible/assert value+text/screenshot
    element) now go through `resolve(step)`; count assertions, element loops, and `waitFor` keep
    `create()`. `guardLocatorQuality` now defers to the resolver when the step has `context` or
    `alternatives` (so recoverable non-unique steps aren't pre-failed).
  - **Recorder** (`recorderInitScript.ts`, `RecorderTypes.ts`, `buildRecordedFlow.ts`): the in-page
    capture script now emits up to 3 ranked `alternatives` and a `context` — nearest **visible dialog**
    (id/testId/role, `visibleOnly`), **table row** (role=row + row text), **card/list item**
    (testId/role + `hasText`), and **iframe** (`frameLocator` selector for same-origin frames). Rows/
    cards are only scoped when the primary is not already globally unique.
- **Files changed:** `src/profiles/FlowProfile.ts`, `src/runner/LocatorFactory.ts`,
  `src/runner/StepExecutor.ts`, `src/recorder/recorderInitScript.ts`, `src/recorder/RecorderTypes.ts`,
  `src/recorder/buildRecordedFlow.ts`, `scripts/verify-recorder-locator.mts` (Part C, +15 checks),
  docs.
- **Tests:** `npm run verify:recorder` → **42/42** (new Part C: duplicate hidden+visible modal,
  visibility fallback, table-row scoping, repeated-card scoping, alternative fallback, iframe context,
  legacy backward-compat). `npm run build` clean; `npm run verify:runner` → 76/76 (no regressions).
- **Not done / limitations:** No UI changes (locator quality badge / debug candidates table / manual
  override editor) — resolver + recorder only. Closed shadow DOM and cross-origin iframes still can't
  be scoped. Feature branch: `feature/smart-locator-engine`.

## 2026-07-04 — Claude Code — Add Git Full Cycle agent skill

- **Task:** Add a reusable Git lifecycle skill teaching agents to safely inspect status, protect
  in-flight work, branch, commit, push, open PRs, handle protected `main`, and manage stacked PRs.
- **What was added:**
  - Added the Git Full Cycle skill for Claude, Codex, and Gemini as byte-identical mirrors:
    `.claude/skills/git-full-cycle/SKILL.md`, `.codex/skills/git-full-cycle/SKILL.md`,
    `.gemini/skills/git-full-cycle/SKILL.md`, plus a canonical shared copy at
    `docs/ai/skills/git-full-cycle/SKILL.md` (`.codex/` and `docs/ai/skills/` newly created).
  - Added a **Git Full Cycle Skill** reference section to the agent entry files `CLAUDE.md`,
    `AGENTS.md`, and `GEMINI.md` (existing content preserved) pointing each agent at its mirror and
    requiring the skill be read before branch/stage/commit/push/PR operations.
- **Files changed:** `.claude/skills/git-full-cycle/SKILL.md`, `.codex/skills/git-full-cycle/SKILL.md`,
  `.gemini/skills/git-full-cycle/SKILL.md`, `docs/ai/skills/git-full-cycle/SKILL.md`, `CLAUDE.md`,
  `AGENTS.md`, `GEMINI.md`, `docs/ai/TASK_LOG.md`.
- **Validation:** `node scripts/ai-memory/check-memory.mjs` (no `verify:ai-memory` npm script exists).
- **Branch:** committed on `chore/save-inflight-recorder-work` (PR #1 still open — docs/skills work
  belongs with it). No Smart Locator feature files touched; Smart Wait Engine not started; no UI
  diagnostics added.

## 2026-07-04 — Claude Code — Recorder: guarantee unique positional fallback locator

- **Task:** Recorder saved a non-unique positional locator, so runs failed with
  "the saved locator matches N elements" (reported: `css=div > div > div > div:nth-of-type(3) > div > div:nth-of-type(3) > svg` matched 6 elements).
- **Root cause:** `structuralSelector` in `src/recorder/recorderInitScript.ts` built a floating
  child-combinator chain capped at 6 levels and only added `:nth-of-type` for same-tag siblings; it
  never validated the result against the live DOM, so the path could match many sibling subtrees.
- **Fix:** Rebuilt `structuralSelector` to walk up from the element prepending one segment per
  ancestor and stop the instant the accumulated path resolves to exactly one element (`q === 1`).
  Each segment pins the node's position among ALL siblings via `:nth-child` (more disambiguating than
  `:nth-of-type`); a stable ancestor id short-circuits into an anchored unique path. This yields the
  shortest unique path and keeps the fallback flagged low-confidence. Semantic/scoped strategies are
  unchanged and still preferred first.
- **Files changed:** `src/recorder/recorderInitScript.ts` (fallback rewrite),
  `scripts/verify-recorder-locator.mts` (added regression test 4b: repeated deeply-nested
  attribute-less `<svg>` subtrees must resolve to one element).
- **Tests run:** `npm run verify:recorder` **27/27** (was 25 + 2 new); `npm run build` clean.
- **Result:** Recorded positional-fallback locators are now unique; the reported multi-match failure
  no longer occurs.

---

## 2026-07-04 — Claude Code — Instances: remove Load More, always-on two-row card scroller

- **Task:** In the Concurrent Instance Monitor, remove the "Load More workflows" button and instead always
  render every workflow card, capping the grid at two rows tall with an internal scroller when the cards
  overflow two rows.
- **Behavior now:** `visibleWorkflows = filteredWorkflows` (all cards always rendered).
  `needsScroll = filteredWorkflows.length > visibleCardCount(gridColumns, 2)`. When `needsScroll`, the grid
  gets `.is-scrolling` (`overflow-y:auto`) and an inline `maxHeight` measured from two card rows + one row
  gap (unchanged measurement logic, now gated on `needsScroll` instead of the old `cardsExpanded`). At two
  rows or fewer the grid renders at natural height with no scroller. Removed the `cardsExpanded`/`visibleRows`
  state, the `INITIAL_CARD_ROWS`/`ROWS_PER_LOAD` constants (replaced by `MAX_CARD_ROWS = 2`), the Load-More
  button, and its search-reset side effects. A "Showing all N workflows — scroll the grid" hint remains when
  scrolling is active.
- **Files changed:** `app/renderer/pages/InstanceMonitor.tsx` (logic + render),
  `app/renderer/styles/global.css` (removed orphaned `.im-load-more` button rule; refreshed a stale
  "Load More" grid comment).
- **Tests run:** `npm run build` clean; `npm run verify:instance-monitor` **22/22** (the `visibleCardCount`
  helper is still used for the two-row threshold and remains covered). Not run: GUI walkthrough of the live
  scroller (manual check outstanding).
- **Result:** Load-More button gone; two-row card scroller is always-on when cards overflow two rows.

---

## 2026-07-04 — Claude Code — AI agent architecture hardening

- **Task:** Added/completed the scalable multi-agent architecture for Cursor, Claude Code,
  Codex/Antigravity, Gemini, and future agents — without rewriting existing AI memory.
- **Baseline preserved:** `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, all existing `docs/ai/*`,
  `.claude/commands/{HANDOFF,TAKEOFF}.md`, `.claude/skills/ai-memory-maintainer`,
  `.agents/skills/{ai-memory-maintainer,agent-handoff,agent-takeoff}`, `.agents/workflows/*`,
  and `.gemini/commands/*` were left untouched.
- **Files added:** `docs/ai/README.md` (concise AI-memory index); `.cursor/rules/`
  `00-project.mdc`, `10-electron-react.mdc`, `20-playwright-runner.mdc`, `30-storage-ipc.mdc`,
  `90-safety.mdc`; `.claude/skills/` `codebase-review`, `feature-implementation`, `bug-fix`,
  `test-and-verify`, `docs-sync`, `refactor-safe`, `pr-review` (each `SKILL.md`); `.agents/skills/`
  `codebase-review`, `feature-implementation`, `bug-fix`, `test-and-verify` (tool-neutral `SKILL.md`).
- **Files changed:** `scripts/ai-memory/check-memory.mjs` — added a non-fatal `optionalFiles`
  warning pass for the new README, Cursor rules, and Claude/agent skills (required checks and
  secret scans unchanged; Cursor rules stay soft, not hard failures).
- **Verification:** `node scripts/ai-memory/check-memory.mjs` → passed required checks, exit 0,
  no warnings. `npm run build`: skipped — only AI-memory Markdown, Cursor `.mdc`, and the checker
  script changed (no app runtime/TS source touched).
- **Result:** Architecture targets 1–11 met; all optional adapter/skill files present.
- **Remaining work:** None for this task. Cursor rules are enforced softly by design.

---

## 2026-07-04 — Claude Code — Recorder wait-capture + Start/End nodes, canvas-click collapse, last-opened restore, Instances Load-More scroller, reusable saved URLs

- **Task:** Six-point AWKIT change set across Recorder, Flow Designer, Workflow Builder, and Instances.
- **Point 1 — Recorder wait-time capture:** New toggle in Recorder Controls (default OFF, persisted at
  `settings.recorder.captureWaitTime`). When ON, `RecorderService` measures think-time between distinct
  actions and inserts a `wait` action (`waitMs`) for pauses ≥ 500 ms (capped 60 s); `buildRecordedFlow`
  saves it as a fixed-time wait step (`config.waitType:"time"`, `timeoutMs`). OFF = unchanged behavior.
- **Point 2 — default Start/End nodes:** Extracted `src/recorder/buildRecordedFlow.ts` (pure). Recorded
  flows now always contain Start + End with actions between (`Start → action… → End`; `Start → End` when
  empty); Start's edge is `always`, action edges `success`; recorded start/end are de-duped.
- **Point 3 — empty-canvas collapse:** Clicking empty canvas in Flow Designer (`onPaneClick`) and Workflow
  Builder collapses the app side menu (new `navigation.collapseSidebar()`), Node Palette / Workflow
  Definition, and Node Properties / Selected Connector — collapse-only (idempotent, persisted). Node
  selection still auto-opens properties; connector selection opens the connector panel (Workflow Builder
  now expands the right panel on edge click).
- **Point 4 — last opened restore:** Already persisted (`selections.lastSelectedFlowId` /
  `selectedBuilderWorkflowId`); added stale-reference clearing so a deleted flow/workflow no longer sticks.
- **Point 5 — Instances Load More:** After Load More, the workflow-card grid renders all cards but becomes
  a two-row internal scroller (measured height + `.workflow-card-grid.is-scrolling`), so the page below
  stays put. Pre-click layout unchanged; new search resets it.
- **Point 6 — reusable saved URLs:** URL history moved out of the transient draft into its own persisted,
  deduped, canonicalized `recorder-urls.json` (survives save/cancel/restart). New `recorder:saveUrl` IPC +
  "Save URL" button; clicking a saved URL row fills the Controls URL field (`saveUrl`/click-to-fill).
- **Files changed:** `src/recorder/RecorderService.ts`, `src/recorder/RecorderTypes.ts`,
  `src/recorder/buildRecordedFlow.ts` (new), `app/main/ipc/recorder.ipc.ts`, `app/main/preload.ts`,
  `app/main/uiSettings.ts`, `app/renderer/pages/Recorder.tsx`, `FlowChartDesigner.tsx`, `ScenarioBuilder.tsx`,
  `InstanceMonitor.tsx`, `app/renderer/App.tsx`, `app/renderer/state/navigation.tsx`,
  `app/renderer/styles/global.css`. Tests: rewrote `scripts/verify-recorder-draft.mts`, added
  `scripts/verify-recorder-flow.mts` + `npm run verify:recorder-flow`.
- **Tests run:** `npm run build` clean; `verify:recorder-draft` **15/15**; `verify:recorder-flow` **13/13**;
  `verify:recorder` **25/25**; `verify:instance-monitor` **22/22**; `verify:runner` **76/76**. Not run:
  GUI walkthroughs for the canvas-collapse and Load-More scroller (manual GUI check outstanding).
- **Result:** All six points implemented; automated validation green.

---

## 2026-07-03 — Claude Code — Recorder: persist unsaved recording draft (URLs survive app close)

- **Task:** Follow-up to "why are Recorded URLs removed when the app closes?" — they were session-scoped,
  in-memory only on the `RecorderService` singleton, so closing before Save lost them. Implemented draft
  persistence so an unsaved recording (actions + URLs) survives a restart and reloads on the Recorder page.
- **How:** `RecorderService` now writes a small JSON draft (`recorder-draft.json`) under the runtime data
  root (`getRuntimeDataRoot()`, i.e. `%LOCALAPPDATA%/WebFlow Studio/`). New methods:
  `configureDraftStorage(path)` (set once by the recorder IPC at startup), `scheduleDraftPersist()`
  (debounced write, called on every recorded action/URL and dedup update), `persistDraft()`,
  `ensureDraftLoaded()` (one-time restore on startup, only when idle + empty so it never clobbers a live
  session), and `discardDraft()` (clear memory + delete file). `startRecording` replaces any old draft;
  `stopRecording` flushes a final write; `cancelRecording` discards; `saveFlow` (IPC) discards after the
  flow is written. `recorder:getActions`/`getUrls` await `ensureDraftLoaded()` so the Recorder page shows a
  restored draft on mount. Renderer `handleSave` now also clears the URL table (consistent with discard).
  URLs are masked and passwords blanked before storage, so the draft holds no secrets.
- **Files changed:** `src/recorder/RecorderService.ts`, `app/main/ipc/recorder.ipc.ts`,
  `app/renderer/pages/Recorder.tsx`. Added `scripts/verify-recorder-draft.mts` +
  `npm run verify:recorder-draft`. Docs: TASK_LOG, CURRENT_STATE, COMMANDS, TESTING, HANDOFF.
- **Tests run:** `npm run build` clean, `npm run verify:recorder-draft` **7/7** (write → restart-restore →
  discard round-trip), `npm run verify:recorder` **25/25** (unaffected).
- **Result:** Recorded URLs (and actions) now survive an app close until explicitly saved or discarded.

## 2026-07-03 — Claude Code — Fix: dropdown not closing on outside click + recorder losing un-blurred text

- **Bug 1 (dropdown):** the `SearchableSelect` combobox (Flow Designer "Saved Flow" picker + the Run-Another-
  Flow node property pickers) did not close when clicking the canvas. Root cause: its outside-click
  listener used a **bubble-phase `mousedown`**, but the React Flow pane consumes pointer events on the
  canvas, so the document listener never fired. Fix: `SearchableSelect.tsx` now listens on **`pointerdown`
  in the capture phase** (fires before any handler can stop propagation; also covers touch "tap out").
  (Workflow Builder's workflow selector is a native `<select>`, which already auto-closes.)
- **Bug 2 (recorder):** typed text was recorded only on the `change` event, which fires on **blur** — so
  text typed into a field that never lost focus (user stops recording while focused, or a SPA re-renders
  the input) was lost. Fix: `recorderInitScript.ts` now also records the value on every **`input`** event
  (live), and `RecorderService`'s `__awtkit_recordAction` binding **collapses consecutive same-field fills**
  (same page + same locator) into one action — so live capture doesn't bloat the saved flow. Password
  values are still masked in both paths.
- **Files changed:** `app/renderer/components/shared/SearchableSelect.tsx`,
  `src/recorder/recorderInitScript.ts`, `src/recorder/RecorderService.ts`. Tests extended:
  `scripts/verify-recorder-locator.mts` (added a no-blur live-typing case),
  `scripts/verify-flow-designer-gui.mjs` (added a dropdown outside-click-closes case). Docs: TASK_LOG,
  CURRENT_STATE, COMMANDS, TESTING, HANDOFF.
- **Tests run:** `npm run build` clean, `npm run verify:runner` **76/76** (unaffected),
  `npm run verify:recorder` **25/25** (incl. "live typing (no blur) records a fill" / captures the value),
  `npm run verify:flow-designer` **19/19** (incl. "Saved Flow dropdown … closes on an outside canvas
  pointerdown"). `npm run verify:workflow-builder` unaffected (last green 13/13).
- **Result:** Both reported bugs fixed and verified in the real Electron app / a real Chromium recorder run.

## 2026-07-03 — Codex — Remaining-work burn-down: runtime safeguards, handoff resume, GUI branch verification

- **Task:** Resolve the repo-verifiable items from the handoff Remaining Work: close the branch-pair
  2→1 GUI verification gap, add Workflow Builder runtime connector-structure validation, and fix the
  manual/protected-login handoff dead-end. Also rebuild current portable/NSIS packages for the offline VM
  walkthrough.
- **Connector GUI fix:** `ActionFlowNode.tsx` and `ScenarioFlowNode.tsx` now call
  `useUpdateNodeInternals(id)` when `portFlags` change; without this, dynamic branch handles rendered but
  real drag-connections could miss the new handle bounds. `scripts/verify-flow-designer-gui.mjs` now drags
  from `conditional-out-1` to create a second branch and deletes one branch to prove the survivor reverts to
  Normal.
- **Runtime validation:** `FlowDependencyResolver.validate()` mirrors Workflow Builder connector-structure
  rules for `ScenarioProfile.links` before execution: structured loop links must self-loop, multiple
  standard outgoing workflow links are blocked, and loop-controlled workflow flows may only exit via
  Conditional links.
- **Handoff resume:** `ManualHandoffController` now tracks pending promises and resolves Continue/Retry/
  Cancel. `StepExecutor` waits inside the live runner/browser; `ExecutionEngine` owns the shared controller,
  marks `waitingForManualAction` through live progress, keeps waiting instances active, exposes
  `retryHandoff`, and cancels pending handoffs on stop. `ProtectedLoginHandoffPanel` now offers Continue and
  maps Retry Detection to in-place retry instead of `repeatInstance`.
- **Files changed:** `src/orchestrator/FlowDependencyResolver.ts`, `src/runner/ManualHandoffController.ts`,
  `src/runner/StepExecutor.ts`, `src/runner/ExecutionEngine.ts`, `src/runner/RunnerProgress.ts`,
  `app/main/ipc/execution.ipc.ts`, `app/main/preload.ts`,
  `app/renderer/components/auth/ProtectedLoginHandoffPanel.tsx`,
  `app/renderer/pages/InstanceMonitor.tsx`,
  `app/renderer/components/workflow/ActionFlowNode.tsx`,
  `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `scripts/verify-runner.mts`,
  `scripts/verify-flow-designer-gui.mjs`, `resources/dependency-manifest.json`, `dist/**`, and AI docs.
- **Tests/verification:** `npx tsc --noEmit` clean; `npm run build` clean; `npm run verify:runner` **76/76**;
  `npm run verify:flow-designer` **18/18**; `npm run verify:workflow-builder` **13/13**;
  `npm run validate:offline` passed; `npm run package:portable` passed with strict offline validation;
  `npm run package:nsis` passed with strict offline validation.
- **Remaining external gate:** clean-machine offline GUI walkthrough in `docs/OFFLINE_STANDALONE_PACKAGING.md`
  still requires a separate offline Windows VM with no Node/global Playwright/global Chromium. Current
  artifacts for that walkthrough: `dist/WebFlow Studio 0.1.0.exe` and
  `dist/WebFlow Studio Setup 0.1.0.exe`.

---

## 2026-07-03 — Claude Code — /HANDOFF after connector-rules task

- **Task:** Ran `/HANDOFF` to prepare `docs/ai/HANDOFF.md` for the next agent/human after the connector
  two-port-pair rules task (entry below).
- **Repo state:** Git metadata unavailable (`git status` → "not a git repository"); changed files were
  inspected directly and are listed in `docs/ai/HANDOFF.md` → Files Changed.
- **Files changed:** `docs/ai/HANDOFF.md` (Active Task, Completed Work, Files Changed, Commands/Tests,
  Current State Summary, Remaining Work, Known Risks, Do-Not-Touch, Recommended Next Step all refreshed for
  the connector-rules task), `docs/ai/TASK_LOG.md` (this entry).
- **Verification:** `node scripts/ai-memory/check-memory.mjs` passed. No source changed, so build/GUI
  suites were not re-run (last green: build clean, `verify:runner` 70/70, `verify:flow-designer` 17/17,
  `verify:workflow-builder` 13/13).
- **Result:** `docs/ai/HANDOFF.md` is ready for the next agent. No active/blocked task remains.

## 2026-07-03 — Claude Code — Connector rules: loop panel-lock, conditional/parallel two-port pairs

- **Task:** Apply four connector rules (UI + backend) across both canvases: (1) Loop is never selectable
  from the properties panel (button-only); (2) loop has execution priority over other connector kinds;
  (3) conditional connectors are a **two-port pair** (exactly 2 same-kind right-side ports, each with its
  own aligned connector, both locked to conditional; removing one auto-reverts the survivor to Normal and
  collapses to one centered port); (4) same for parallel (both locked parallel; sequential-by-default
  execution, config kept). Confirmed the design via AskUserQuestion before building.
- **Shared model (`connectorStyle.ts` + `ConnectorPorts.tsx`):** source side is a single centered
  `normal-out` port by default; once a conditional/parallel connector leaves the node it switches to a
  **branch pair** — two same-kind ports `<kind>-out-0/1` (evenly centered), so each of the 2 connectors
  aligns to its own port (fixes the old single-shared-handle overlap where "only one connector worked").
  New: `branchSourceHandle`, `slotFromHandle`, `MAX_BRANCH_CONNECTORS=2`, `ConnectorPortFlags.sourceKind`,
  and `reconcileBranchConnectors(edges, { kindOf, slotAssign, toNormal, revertSources })` which slots each
  node's pair and reverts a lone survivor to normal.
- **Both canvases wired identically:** `onConnect` caps branch connectors at 2 + reconciles; the panel
  kind/type change reconciles; edge deletion (Delete key via a wrapped `onEdgesChange`, panel delete, and
  node deletion) reconciles with `revertSources` so a surviving lone pair-member reverts to Normal; load
  reconciles saved edges. Flow Designer `ConnectionPropertiesPanel` and the Workflow Builder inline Link
  Type panel: Loop option disabled (Rule 1), kind+type selects locked while conditional/parallel/loop, with
  explanatory helper text.
- **Backend unchanged (verified compatible):** `FlowExecutor` already runs the self-loop before parallel
  fan-out and `resolveNext` (Rule 2 satisfied), and parallel defaults to sequential shared-page execution
  (Rule 4). Branch-pair invariants are maintained by construction (the UI only exposes the current mode's
  ports), so `validateConnectorStructure`/structure-issue checks (kind-based) needed no change.
- **Files changed:** `app/renderer/components/shared/connectorStyle.ts`, `.../shared/ConnectorPorts.tsx`,
  `.../workflow/ConnectionPropertiesPanel.tsx`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/pages/ScenarioBuilder.tsx`. GUI harnesses extended: `scripts/verify-flow-designer-gui.mjs`
  (added conditional-pair checks; overlap-proof loop click). Docs: CURRENT_STATE, HANDOFF, KNOWN_ISSUES,
  this entry.
- **Tests run:** `npm run build` clean, `npm run verify:runner` 70/70, `npm run verify:flow-designer`
  **17/17** (incl. convert→2 aligned conditional ports `conditional-out-0/1` Δy=9.6, kind locked, delete
  reverts to one normal port), `npm run verify:workflow-builder` **13/13**.
- **Known gap:** the 2→1 survivor-revert (delete one of an existing pair) is verified by the reconcile
  logic + the delete-to-normal GUI path, but not by a GUI-drawn second connector (React Flow drag
  connections can't be driven headlessly). The Workflow Builder conditional-pair rendering uses the same
  shared components verified in the Flow Designer harness.

## 2026-07-03 — Claude Code — Workflow Builder connector GUI verification (closes the last loose end)

- **Task:** Narrow verification checkpoint — adapt the real-Electron GUI verification to the Workflow
  Builder canvas (the Flow Designer was already 13/13; Workflow Builder was the remaining un-walked
  surface). No new features unless a bug surfaced (none did).
- **Added:** `scripts/verify-workflow-builder-gui.mjs` + `npm run verify:workflow-builder` — launches the
  REAL built app (Playwright `_electron`, `ELECTRON_RUN_AS_NODE` cleared), navigates to the Workflow
  Builder, loads a saved workflow that has an edge (via the toolbar Workflow `<select>`), and drives the
  `.scenario-flow-node` connector UI.
- **Result: 13/13 GUI checks pass** on the user's saved workflows ("Mock — Data-Driven Workflow"): ports
  render un-clipped as card siblings (0 handles inside the `overflow:hidden` card, left/right on the node
  edges), Add Loop creates a visible edge, the top loop port becomes visible on the node's top edge, the
  loop draws as a **semicircle above** the node, the button toggles to Remove and deletes the edge (top
  port hides), and a loop node **locks its Link Type selector** (`selectDisabled=true`, conditional option
  stays enabled) — full parity with the Flow Designer.
- **Notes / gotchas found (no code changes needed):** (1) `ScenarioBuilder` starts with an empty canvas
  and loads `savedWorkflows[0]` (or the persisted selection) on mount — the script loads a workflow with
  edges via the toolbar select. (2) Loaded-workflow edge ids are the **saved link ids**, not
  `edge-<src>-<tgt>`, so the lock check gives every loopable node a self-loop (making any edge's source
  loop-controlled) and selects the remaining non-loop edge instead of parsing the source from the id.
- **Files changed:** `scripts/verify-workflow-builder-gui.mjs` (new), `package.json` (new
  `verify:workflow-builder` script). Docs: `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`,
  `docs/ai/COMMANDS.md`, `docs/ai/KNOWN_ISSUES.md`, this entry.
- **Tests run:** `npm run verify:workflow-builder` 13/13 (real Electron GUI). No source/behavior changed,
  so build/runner were not re-run (last known green: build clean, `verify:runner` 70/70,
  `verify:flow-designer` 13/13).
- **Result:** Both connector canvases (Flow Designer + Workflow Builder) are now GUI-verified in the real
  app. No bugs discovered during verification.

## 2026-07-03 — Claude Code — Fix npm run dev launch + real GUI walkthrough of Flow Designer connectors

- **Task:** Stop feature work; (1) fix the `npm run dev` Electron launch crash that blocked all prior GUI
  verification, then (2) perform a real GUI walkthrough of the Flow Designer connector UI.
- **Root cause of the "launch crash" (misdiagnosed by 3 prior sessions as a Node/Electron version
  mismatch):** the agent/sandbox environment exports **`ELECTRON_RUN_AS_NODE=1`**, which makes the
  Electron binary boot as plain Node.js — `require("electron")` returns the binary path string (no
  `app`/`BrowserWindow`), and the ESM main entry gets loaded by bare Node, producing the
  `esm/translators` `TypeError: …reading 'exports'` (and the `Node.js v20.18.3` trace = Electron's Node
  running as node). Confirmed via `env | grep -i electron`. Clearing the var lets the GUI window open.
- **Fix:** `npm run dev` now runs `node scripts/dev.mjs`, which deletes `ELECTRON_RUN_AS_NODE` from the
  child env before spawning `electron-vite dev` (no-op on normal machines). Explored switching the main
  process to CommonJS to dodge the ESM preparse, then **reverted** it — the ESM main launches fine once
  the env var is cleared, so the module format was never the problem (kept the diff minimal).
- **Real GUI walkthrough:** added `scripts/verify-flow-designer-gui.mjs` + `npm run verify:flow-designer`,
  which launches the REAL built app (Playwright `_electron`, env cleared) and drives the Flow Designer.
  **13/13 checks pass** on the user's actual saved "Chatgpt-Login-v1.1" flow / "Auto Secure Login" node:
  ports render un-clipped as card siblings (0 handles inside the `overflow:hidden` card, left/right on the
  node edges), Add Loop creates a visible edge, the top loop port becomes visible on the node's top edge,
  the loop draws as a **semicircle above** the node (pathTop < nodeTop), the button toggles to Remove and
  deletes the edge (top port hides), and a loop node **locks its outgoing connectors to Conditional** in
  the properties panel. This retroactively validates the prior loop-port UI task (previously code-only).
- **Files changed:** `package.json` (dev script → `node scripts/dev.mjs`; new `verify:flow-designer`),
  `scripts/dev.mjs` (new), `scripts/verify-flow-designer-gui.mjs` (new). Reverted mid-task (net no change):
  `electron.vite.config.ts`, `app/main/windowManager.ts`, `src/runner/BrowserContextFactory.ts`,
  `src/recorder/RecorderService.ts` (all back to original ESM/import form). Docs:
  `docs/ai/KNOWN_ISSUES.md`, `docs/ai/COMMANDS.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`, this
  entry.
- **Tests run:** `npm run build` clean, `npm run verify:runner` 70/70, `npm run verify:flow-designer`
  13/13 (real Electron GUI), `npm run dev` launches the GUI window (4 electron.exe processes, no crash).
- **Result:** `npm run dev` fixed and root-caused; the Flow Designer connector UI is now **GUI-verified**
  in a running app — the outstanding "no GUI walkthrough" caveat from the last three tasks is cleared for
  the Flow Designer. (Workflow Builder connector UI shares the same components but was not separately
  GUI-walked this pass.)

## 2026-07-03 — Claude Code — Loop port UI fix: top loop port, semicircle self-loop, un-clip ports

- **Task:** Second GUI-driven bugfix pass on the same connector subsystem. User reported (after real GUI
  testing): (1) port/connector points render corrupted; (2) the "Add loop" button is broken — clicking it
  on `Auto Secure Login` doesn't visibly create a loop, and the loop can't be deleted; (3) a loop
  connector should attach to a **special loop port on top of the node** and draw as a **visible semicircle
  above** the node; (4) once a node has a loop, any new right-edge connector must be **Conditional only**.
- **Root causes found:** (1) The prior task added `position: relative` to `.action-flow-node` /
  `.scenario-flow-node`, which — combined with the pre-existing `overflow: hidden` — made those cards the
  offset parent for the React Flow `<Handle>` elements rendered *inside* them, so the edge-hugging handles
  (half outside the card box) were **clipped**. (2) Loop handles were invisible, co-located on the right,
  and gated behind `flags.loop` (only true *after* the edge exists → flaky attach); the self-loop arc
  bulged sideways where the node covered it, so it read as "not created / not deletable".
- **Fix:**
  - **Un-clip ports** — `ConnectorTargetPorts`/`ConnectorSourcePorts` are now rendered as *siblings* of
    the node `<article>` (in `ActionFlowNode`/`ScenarioFlowNode`), so React Flow positions them against
    the un-clipped `.react-flow__node` wrapper instead of the `overflow: hidden` card.
  - **Top loop port** — new `ConnectorLoopPort` renders a dedicated `loop-out`/`loop-in` handle pair on
    the node's **top** edge (slightly apart), always present (so the loop edge attaches immediately) but
    invisible/non-interactive until a loop exists (`.connector-port-loop.active`).
  - **Semicircle** — `SelfLoopEdge` now detects a self-loop via `source === target` (node identity, not
    coordinates) and draws a semicircle arcing **above** the node; distinct-node "curved" case unchanged.
  - **Reliable add/remove** — the node loop button is now an add/remove **toggle** (filled "active" state
    when a loop exists; `title` switches to "Remove loop connector"); `addLoop` guards against duplicates.
  - **Conditional-only on connect** — both canvases' `onConnect` now force the new connector's kind to
    `conditional` when the source node already has a self-loop (was only enforced by the properties-panel
    lock + save-time validation before).
- **Files changed:** `app/renderer/components/shared/ConnectorPorts.tsx`,
  `app/renderer/components/shared/SelfLoopEdge.tsx`, `app/renderer/components/shared/connectorStyle.ts`
  (doc comment only), `app/renderer/components/workflow/ActionFlowNode.tsx`,
  `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/pages/ScenarioBuilder.tsx`, `app/renderer/styles/global.css`. Docs:
  `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`, `docs/ai/HANDOFF.md`, this entry.
- **Tests run:** `npx tsc --noEmit` clean, `npm run build` clean, `npm run verify:runner` 70/70 (no
  regressions), `npm run validate:offline` passed (dev-mode warnings only). No `verify:flow-designer`
  script exists (prompt listed it speculatively). `npm run dev` still cannot launch here (Electron
  bundled-Node ESM/CJS crash — see `KNOWN_ISSUES.md`), so the **GUI walkthrough remains outstanding** —
  the rendered semicircle, top port visibility, and click/drag behavior are not visually confirmed.
- **Result:** Corrupted-port, invisible/undeletable-loop, and loop-shape bugs addressed in code and
  backend-verified. Backward compatible: loop edges keep the same `loop-out`/`loop-in` handle ids, so
  existing saved self-loops re-attach to the new top port automatically. GUI verification still pending.

## 2026-07-03 — Claude Code — Fix connector-port bugs found via manual GUI testing

- **Task:** A user manually tested the Flow Designer/Workflow Builder (the AWKIT points 1–5 connector
  work below was previously only typecheck/build-verified, never GUI-walked) and reported 3 bugs: (1)
  Loop kind connector always disabled, (2) new conditional/parallel/loop connectors' ports not
  functional + wrong position, (3) loop connector should auto-attach to its node in a circular/retry-icon
  shape. User confirmed via AskUserQuestion: loop creation should use a dedicated button (not
  drag-to-self), and extra ports should be evenly distributed centered on the node (not fixed offsets).
- **Root causes found:** (1) Loop kind was gated on `edge.source === edge.target`, achievable only by a
  fiddly manual self-drag — effectively unusable. (2) Both canvases' `onConnect` hardcoded every new
  connector to kind "normal"/linkType "success", ignoring `connection.sourceHandle`/`targetHandle`, so a
  drag from a conditional/parallel port silently created a normal connector. (3) Conditional/parallel
  ports were hardcoded to `top: 30%`/`70%` instead of centering as a group. (4) `portHandlesForKind
  ("loop")` reused the opposite-side `normal-out`/`normal-in` handles, so `SelfLoopEdge`'s same-point
  `isSelf` check never fired and a self-loop rendered as a giant arc instead of a tight circular shape.
- **Fix:** added a dedicated co-located `loop-out`/`loop-in` handle pair for loop connectors; added an
  "Add loop" button (small circular icon) on each node that creates the self-loop edge programmatically;
  added `connectorPortKindFromHandle()` so `onConnect` derives the new connector's kind from the dragged
  handle; added `portPositions(count)` to evenly space + center multi-port groups; extended
  `ConnectorPortFlags` with a `loop` flag.
- **Files changed:** `app/renderer/components/shared/connectorStyle.ts`,
  `app/renderer/components/shared/ConnectorPorts.tsx`, `app/renderer/components/workflow/
  ActionFlowNode.tsx`, `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `app/renderer/pages/
  FlowChartDesigner.tsx`, `app/renderer/pages/ScenarioBuilder.tsx`, `app/renderer/styles/global.css`.
  Docs: `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`, `docs/ai/HANDOFF.md`, this entry.
- **Tests run:** `npx tsc --noEmit` clean, `npm run build` clean, `npm run verify:runner` 70/70 (no
  regressions). `npm run dev` **could not run** — Electron crashes on launch with a Node ESM/CJS
  translator error before any app code runs (trace reports Electron's own bundled Node v20.18.3; system
  Node here is 18.16.0, matching `docs/ai/COMMANDS.md`) — new environment finding, logged in
  `docs/ai/KNOWN_ISSUES.md`. No manual GUI walkthrough was possible as a result — the click/drag
  interactions and rendered arc/port positions are not visually confirmed.
- **Result:** Bugs fixed in code and backend-verified; GUI walkthrough still outstanding (second
  consecutive task on this subsystem to land without one — flagged clearly in `KNOWN_ISSUES.md` and
  `HANDOFF.md`).

## 2026-07-03 — Claude Code — /HANDOFF prepared after connector structure rules task

- **Task:** Ran `/HANDOFF` to close out the AWKIT connector-structure task (points 1–5, see the entry
  directly below) and prepare `docs/ai/HANDOFF.md` for the next agent.
- **Files changed:** `docs/ai/HANDOFF.md` (filled in Current Handoff with completed work, files changed,
  commands/tests run, remaining work, known risks, recommended next step), `docs/ai/TASK_LOG.md` (this
  entry).
- **Verification:** Git metadata unavailable in this checkout (`git status`/`git diff` both fail with
  "not a git repository") — recorded in `docs/ai/HANDOFF.md` instead of git output. `node
  scripts/ai-memory/check-memory.mjs` passed.
- **Result:** `docs/ai/HANDOFF.md` is ready for the next agent. No active/blocked task remains.

## 2026-07-03 — Claude Code — Connector structure rules (AWKIT points 1–5)

- **Task:** Implement 5 connector-structure enhancements to the Flow Designer + Workflow Builder, in order:
  (1) dynamic conditional/parallel ports, (2) prevent duplicate standard outgoing connectors, (3) loop
  connectors force additional connectors to Conditional, (4) loop connectors must be self-loops
  (source === target), (5) curved/circular connector shape option.
- **Files changed:** `src/profiles/FlowProfile.ts` (circular shape, `validateConnectorStructure`),
  `src/runner/FlowExecutor.ts` (self-loop execution model + runtime structure guard),
  `app/renderer/components/shared/connectorStyle.ts` (`portHandlesForKind`, `computePortFlags`, circular
  shape default for loop), `app/renderer/components/shared/ConnectorStyleEditor.tsx` (circular option),
  `app/renderer/styles/global.css` (port + self-loop label CSS), `app/renderer/components/workflow/
  ActionFlowNode.tsx`, `app/renderer/components/workflow/flowDesignerTypes.ts` (`portFlags`),
  `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` (kind-lock UI for points 3/4),
  `app/renderer/pages/FlowChartDesigner.tsx` (ports/edgeTypes/validation/save-gating),
  `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `app/renderer/components/scenario/
  scenarioDesignerTypes.ts` (`portFlags`), `app/renderer/pages/ScenarioBuilder.tsx` (ports/edgeTypes/
  validation/save-gating, `scenarioEdgeKind`), `scripts/verify-runner.mts` (self-loop test fixtures + 2 new
  structural-safeguard tests).
- **Files added:** `app/renderer/components/shared/ConnectorPorts.tsx`, `app/renderer/components/shared/
  SelfLoopEdge.tsx`.
- **Verification:** `npx tsc --noEmit` clean; `npm run build` clean; `npm run verify:runner` → 70/70 (was
  68/68 — 2 new structural-safeguard tests, 3 loop tests rewritten for the self-loop model);
  `npm run validate:offline` passed (dev-mode warnings only). `npm run verify:flow-designer` does not exist
  — not run (per `docs/ai/COMMANDS.md`).
- **Result:** All 5 points implemented on both canvases. Loop connectors are now self-loop-only at both
  save-time (UI) and run-time (`FlowExecutor`); the legacy `loopBack` edge type is explicitly exempt.
  Ports/shape are derived at render time, no `FlowEdge`/`WorkflowEdge` schema change. **Not done:** GUI
  walkthrough of the port/self-loop visuals (no dev server run in this session — see `docs/ai/
  CURRENT_STATE.md`); Workflow Builder has no runtime-engine equivalent to `FlowExecutor`, so its structural
  safeguard is UI-only (documented in `docs/ai/KNOWN_ISSUES.md`).

## 2026-07-02 — Codex — Generic agent handoff/takeoff memory workflow

- **Task:** Add automated generic handoff and takeoff workflows to the AI memory system for Claude Code,
  Codex, Gemini, Antigravity, future agents, and human developers.
- **Files added:** `docs/ai/HANDOFF.md`, `.claude/commands/HANDOFF.md`,
  `.claude/commands/TAKEOFF.md`, `.gemini/commands/HANDOFF.toml`, `.gemini/commands/TAKEOFF.toml`,
  `.agents/skills/agent-handoff/SKILL.md`, `.agents/skills/agent-takeoff/SKILL.md`,
  `.agents/workflows/HANDOFF.md`, `.agents/workflows/TAKEOFF.md`.
- **Files changed:** `AGENTS.md`, `.claude/skills/ai-memory-maintainer/SKILL.md`,
  `.agents/skills/ai-memory-maintainer/SKILL.md`, `.agents/workflows/update-memory.md`,
  `.gemini/commands/ai-memory.toml`, `scripts/ai-memory/check-memory.mjs`,
  `docs/ai/DEVELOPMENT_WORKFLOW.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `node scripts/ai-memory/check-memory.mjs` passed.
- **Result:** Generic handoff/takeoff workflow added; `HANDOFF.md` is now part of the required memory set.

---

## 2026-07-02 — Claude Code — True concurrent parallel branches (opt-in isolated pages)

- **Task:** Add real concurrency for parallel connectors, gated behind explicit isolation config (per the
  spec's "require explicit isolation configuration"). `sharedPage` (default) stays sequential fan-out;
  `isolatedPage` runs branches concurrently, each on its own page in the shared browser context (shared
  cookies/session, independent DOM), bounded by `maxConcurrency`.
- **Files changed:**
  - `src/profiles/FlowProfile.ts` — `ParallelConnectorConfig.isolation` (sharedPage/isolatedPage); documented `maxConcurrency`.
  - `src/runner/FlowExecutor.ts` — `IsolatedBranchExecutor`/`ParallelBranchFactory` types; `branchExecutorFactory`
    constructor arg; `executeParallelIsolated` (bounded-concurrency batches, join/fail applied to collected results).
  - `src/runner/PlaywrightRunner.ts` — provides the branch factory (new page in the shared context + its own StepExecutor, closed after).
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — Execution (isolation) selector + Max concurrency field.
- **Tests:** `scripts/verify-runner.mts` +1 (isolated concurrent branches each run on their own page). → **68/68**.
- **Verification:** `npm run build` clean; `npm run verify:runner` → 68/68; `npm run validate:offline` passes; `npm run ai:memory` ✅.
- **Semantics note:** isolated `failFast` reports failure after branches settle (no hard-abort of in-flight branches);
  `waitAny` succeeds if ≥1 branch passes.

---

## 2026-07-02 — Claude Code — Connector polish: loop data-source dropdown + live-report connector events

- **Task:** Two follow-ups after checkpoint B. (1) Loop connector `dataSource` mode: pick a specific data
  source from a dropdown (or default to the workflow data source) with an optional row-key binding; runner
  honors `LoopConnectorConfig.dataSourceId`. (2) Surface connector events in the Live Report timeline.
- **Files changed:**
  - `src/runner/FlowExecutor.ts` — `progress?` constructor arg + `emitConnectorEvent()`; emits on structured
    conditional match, parallel fan-out, loop iteration, and Auto Secure Login restart; `resolveLoopValues`
    honors `dataSourceId`.
  - `src/runner/PlaywrightRunner.ts` — passes `this.options.progress` into `FlowExecutor`.
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — `dataSources` prop; loop dataSource
    dropdown + optional row key.
  - `app/renderer/pages/FlowChartDesigner.tsx` — passes `dataSources` to the connection panel; relaxed loop
    dataSource validation (row key optional).
- **Tests:** `scripts/verify-runner.mts` +1 (connector events reach the progress reporter). → **67/67**.
- **Verification:** `npm run build` clean; `npm run verify:runner` → 67/67; `npm run validate:offline` passes;
  `npm run ai:memory` ✅.

---

## 2026-07-02 — Claude Code — Structured connector model (checkpoint B of the AWKIT connectors/sessions spec)

- **Task:** The "full structured connector replacement" the user chose: a `kind`-based connector model with
  structured Conditional/Parallel/Loop configs across types, execution engine, designer UI, validation, and tests.
  Backward compatible — legacy edges keep executing via the expression paths.
- **Files added:** `src/runner/ConnectorConditionEvaluator.ts` (operators + sourceField resolution).
- **Files changed:**
  - `src/profiles/FlowProfile.ts` — `ConnectorKind`, `ConnectorConditionOperator`, `ConnectorConditionSource`,
    `ConditionalConnectorConfig`, `ParallelConnectorConfig`, `LoopConnectorConfig`; `FlowEdge.kind/conditional/
    parallel/loop`; `connectorKind()` helper.
  - `src/runner/RunnerResult.ts` — `StepExecutionResult.errorCode`.
  - `src/runner/FlowExecutor.ts` — structured conditional routing (priority) in `resolveNext`; parallel
    join/fail modes in `executeParallelTargets`; loop-connector execution (`executeLoopConnector` +
    `resolveLoopValues`, count/staticList/dataSource/whileCondition, param injection via runtimeInputs,
    `LOOP_CONNECTOR_HARD_CAP`).
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — `FlowConnectionData` gains
    kind/conditional/parallel/loop; kind selector + per-kind property fields.
  - `app/renderer/pages/FlowChartDesigner.tsx` — `createEdge` `extra`; `toFlowProfile`/`loadProfile`
    round-trip kind + configs; `validateFlow` connector checks (expected value, variable, loop bounds,
    ambiguous same-priority conditionals).
- **Tests:** `scripts/verify-runner.mts` +8 (conditional priority, conditional no-match safe stop, parallel
  waitAny, parallel failFast, parallel collectErrors, loop count, loop staticList, loop whileCondition).
- **Verification:** `npm run build` clean; `npm run verify:runner` → **66/66**; `npm run validate:offline`
  passes; `npm run ai:memory` ✅.
- **Not done (remaining):** true concurrent parallelism (still sequential fan-out), loop over multi-node
  branches (single target node only), dataSource-loop UI dropdown (binding is a text field), reporting/runtime
  connector events, GUI walkthrough, live real-Chrome capture.

---

## 2026-07-02 — Claude Code — Session registry + node behaviors (checkpoint A of the AWKIT connectors/sessions spec)

- **Task:** First checkpoint of the larger "Auto Secure Login / Reuse Session / smart connectors" spec.
  Decisions confirmed with user: **full structured connector replacement** (deferred to checkpoint B),
  **keep `SessionCaptureService`** (dedicated automation profile dir, AWKIT sessions dir), **both** restart
  mechanisms (engine counter + loopBack edge), **phased delivery**. This checkpoint = the additive,
  lower-risk session/node behaviors.
- **Files added:** `src/session/sessionMatch.ts` (`normalizeOrigin`, `profileOrigin`, `sessionMatchesUrl`,
  `findBestSessionForUrl`).
- **Files changed:**
  - `src/session/SessionProfile.ts` — `origin`, `loginUrl`, `source` fields.
  - `src/session/SessionCaptureService.ts` — compute `origin`/`loginUrl`/`source` on capture (`startCapture`
    gains optional `source`); backfill `origin`/`source` for legacy profiles in `list()`.
  - `src/runner/RunnerResult.ts` — `StepExecutionResult.outcome` + `restartRequired`.
  - `src/runner/StepExecutor.ts` — Auto Secure Login now matches by normalized origin, tags capture source,
    sets `outcome`/`restartRequired`; Reuse Session gains **auto-detect** (origin) vs **selected** modes and
    sets `outcome`; threads `outcome`/`restartRequired` through `execute()`.
  - `src/runner/FlowExecutor.ts` — engine-level Auto Secure Login restart guard (`MAX_AUTO_LOGIN_RESTART = 1`)
    that restarts from Start on `restartRequired` and fails safely on exhaustion.
  - `src/profiles/FlowProfile.ts` — `NodeConfig.reuseSessionMode`.
  - `app/renderer/components/workflow/flowDesignerTypes.ts` — `reuseSessionMode` field + default.
  - `app/renderer/pages/FlowChartDesigner.tsx` — map `reuseSessionMode` (+ only persist `reuseSessionId` in selected mode).
  - `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx` — Reuse Session mode selector + auto-detect URL / selected dropdown.
  - `app/renderer/pages/SessionsManager.tsx` — Source column + origin subtitle + search over origin/source.
  - `.gitignore` — ignore `sessions/`, `profiles/`, `session-profiles.json`, `*.storageState.json`.
- **Tests:** `scripts/verify-runner.mts` +5 (normalized-origin match, auto-detect find, auto-detect no-match,
  engine restart-then-complete, restart-guard exhaustion). Updated the selected-mode "no id" test.
- **Verification:** `npm run build` clean; `npm run verify:runner` → **58/58**; `npm run validate:offline`
  passes; `npm run ai:memory` ✅.
- **Not yet done (later checkpoints):** full structured connector-config model (Conditional/Parallel/Loop
  configs, designer UI, validation, execution — checkpoint B), reporting/runtime events, GUI walkthrough,
  live real-Chrome capture.

---

## 2026-07-02 — Claude Code — Enhanced Connectors + Auto Secure Login + Reuse Session (Phases 1–3)

- **Task:** Three-phase feature set. Phase 1: enhanced flow connectors (new `outcome`, `loopBack`,
  `parallel` edge types + `maxLoopCount`). Phase 2: `autoSecureLogin` node (capture manual login in real
  Chrome mid-run, then resume automation). Phase 3: `reuseSession` node (load a saved session profile
  mid-run). Reviewed all three prompt specs against the live code first; the prompts' code was
  illustrative — several signatures (preload `session.*` not `sessions.*`, positional `StepExecutor`
  ctor, `resolveStepValue`) were adapted.
- **Phase 1 files changed:**
  - `src/profiles/FlowProfile.ts` — `FlowEdgeType` += `outcome`/`loopBack`/`parallel`; `FlowEdge.maxLoopCount`.
  - `src/profiles/ScenarioProfile.ts` — `ScenarioLink.type` union synced.
  - `src/runner/FlowExecutor.ts` — rewired routing: `resolveNext()` (outcome edges via `${stepResult.*}`
    scope, conditional, conditional/unconditional loopBack gated by `maxLoopCount`); loopBack-aware cycle
    guard that clears `visited` only on a taken back-edge and **falls through to success/always on
    exhaustion** (no cycle error); `executeParallelTargets()` sequential fan-out.
  - `src/runner/PlaywrightRunner.ts` — `chooseNextFlow` now checks `outcome` links before `conditional`.
  - `app/renderer/components/shared/connectorStyle.ts` — colors + animate/dash for new types.
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — new options, outcome/loopBack
    expression inputs, `maxLoopCount` input; `FlowConnectionData.maxLoopCount`.
  - `app/renderer/pages/FlowChartDesigner.tsx` — `createEdge`/`toFlowProfile` serialize `maxLoopCount`.
  - `app/renderer/pages/ScenarioBuilder.tsx` — workflow edge-type dropdown extended.
- **Phase 2–3 files changed:**
  - `src/profiles/FlowProfile.ts` — `StepType` += `autoSecureLogin`/`reuseSession`; `NodeConfig.reuseSessionId`.
  - `src/runner/StepExecutor.ts` — `BrowserRestarter` type; ctor gains positional `browserRestarter` +
    `sessionService`; public `setActivePage`; `executeAutoSecureLogin` + `executeReuseSession`.
  - `src/runner/PlaywrightRunner.ts` — mutable `BrowserHolder` + `restartBrowser` callback (close-only /
    relaunch with `persistentContext` + new `userDataDir`, re-points the live executor's page);
    `sessionService` option threaded to `StepExecutor`; save/restore active executor across child flows.
  - `src/runner/ExecutionEngine.ts` — injects `getSessionService()` into `PlaywrightRunner`.
  - `app/renderer/components/workflow/flowNodeCatalog.ts` — `autoSecureLogin` (ShieldCheck) + `reuseSession` (History).
  - `app/renderer/components/workflow/flowNodeRegistry.ts` — META + new `reuseSession` section.
  - `app/renderer/components/workflow/flowDesignerTypes.ts` — `reuseSessionId` field + default.
  - `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx` — session-list fetch + `SearchableSelect`.
  - `app/renderer/pages/FlowChartDesigner.tsx` — `reuseSessionId` in `toNodeConfig`/`fromFlowStep`.
- **Tests:** `scripts/verify-runner.mts` +9 cases (multi-conditional first-match, outcome routing,
  loopBack max=2/max=1, parallel fan-out, autoSecureLogin skip/capture, reuseSession load/missing).
- **Verification:** `npm run build` clean; `npm run verify:runner` → **53/53** (was 44); `npm run
  validate:offline` passes. Not run: clean-machine GUI walkthrough; live real-Chrome capture (mocked in tests).
- **Result:** ✅ All three phases implemented, backward compatible, offline-first preserved.

---

## 2026-07-01 — Gemini — Session Capture Browser (manual login without automation detection)

- **Task:** Implement a Session Capture Browser feature that launches the user's real system Chrome/Edge
  (not Playwright's Chromium) so they can manually log into protected sites (Google, Microsoft,
  Cloudflare-gated) without being blocked by automation detection. After login, the session is saved
  for reuse in automation runs via `launchPersistentContext`.
- **Files added:**
  - `src/session/SessionProfile.ts` — types: `SessionProfile`, `SessionCaptureStatus`, `DetectedBrowser`.
  - `src/session/SessionCaptureService.ts` — core service: system Chrome/Edge detection (Windows paths),
    named profile directory management under `%LOCALAPPDATA%/WebFlow Studio/profiles/`, browser launch
    via `child_process.spawn --user-data-dir`, process monitoring, profile CRUD + metadata persistence.
  - `app/main/ipc/session.ipc.ts` — 9 IPC handlers (`session:list/startCapture/getStatus/delete/rename/
    detectBrowser/stopCapture/getById/markUsed`) + `getSessionService()` export.
  - `app/renderer/pages/SessionsManager.tsx` — full UI: browser detection banner, capture form with
    active-capture status, saved sessions table with rename/delete/open-folder, search + pagination.
- **Files changed:**
  - `app/main/ipc/index.ts` — register `registerSessionIpc()`.
  - `app/main/preload.ts` — add `session.*` namespace to the `playwrightFlowStudio` API.
  - `src/instances/InstanceConfig.ts` — add `sessionProfileId?: string`.
  - `app/main/ipc/execution.ipc.ts` — add `sessionProfileId` to `RunWorkflowRequest`, add
    `resolveInstanceTemplate()` that resolves profiles to `userDataDir + persistentContext`.
  - `src/instances/InstanceManager.ts` — prefer template `userDataDir` over per-instance generated path.
  - `app/renderer/routes.tsx` — add `sessions` route with `KeyRound` icon.
  - `app/renderer/layout/LeftNavigation.tsx` — add `sessions` to Data nav group.
  - `docs/ai/CURRENT_STATE.md` — document the new feature.
- **Tests run:** `npm run build` ✅ (tsc --noEmit + electron-vite); `npm run verify:runner` ✅ 44/44.
- **Tests not run:** `npm run validate:offline` (no resources/ or manifest touched); clean-machine GUI
  walkthrough (human/VM step). Live capture flow requires a running Electron app.
- **Result:** Feature fully implemented. Users can capture manual login sessions from a real Chrome/Edge
  browser and reuse them in automation runs. No automation detection triggered.

---

## 2026-07-01 — Claude Code — Investigation: manual/protected-login handoff dead-ends (no code change)

- **Trigger:** User's `Chatgpt-Workflow` instance paused on a "Protected login — action required" card
  with Provider/Reason/URL = unknown/—.
- **Findings (evidence-based, no code changed):**
  - The workflow runs one flow `flow-96138dff` (`Chatgpt-Login-v1.1`): Start → goto chat.openai.com →
    click → click "Log in" → **Manual Handoff** → End. The pause is that deliberate `manualHandoff` node.
  - `PlaywrightRunner.executeScenario` returns on `manualHandoff` (`:103-104`) and its `finally` closes
    the browser (`:130-131`), so the automation browser is gone when the card appears.
  - Instance Monitor handoff card: **Retry Detection → `repeatInstance`** (full re-run in a fresh
    context), **Cancel Run → `stopInstance`**. No in-place resume exists, so the flow can never get past
    the handoff. The `manualHandoff → saveSession` pattern in `flow-0a526377` is unreachable too.
  - UX gaps: `ProtectedLoginHandoffPanel` hardcodes the "Protected login" header for plain manual
    handoffs and shows `unknown/—` with no detection detail.
- **Files changed:** docs only — `KNOWN_ISSUES.md`, `CURRENT_STATE.md`, `TASK_LOG.md`.
- **Tests run:** none (documentation-only). **Result:** confirmed bug recorded; fix (keep browser open
  across a handoff + real Continue/resume) not yet implemented — awaiting user direction.

---

## 2026-07-01 — Claude Code — Recorder generates unique, Playwright-safe locators + runner safeguard

- **Task:** Fix the Recorder so it captures unique, Playwright-safe locators instead of generic
  utility-class selectors (e.g. `div.flex.items-center.justify-center`) that fail Playwright strict mode.
- **Files added:**
  - `src/recorder/recorderInitScript.ts` — self-contained DOM capture script (`installRecorderCapture`
    + `getRecorderInitScriptContent`): ranked candidate generation (role/label/placeholder/text/testId →
    stable attributes → id → scoped → positional fallback; never utility classes), live-DOM uniqueness
    validation, `LocatorQuality` metadata, human-readable step names, password-value masking.
  - `scripts/verify-recorder-locator.mts` — live Playwright verification (23 checks).
- **Files changed:**
  - `src/profiles/FlowProfile.ts` — new `LocatorQuality` type; `FlowStep.locator` gains `exact?`/`quality?`.
  - `src/recorder/RecorderTypes.ts` — `RecordedActionLocator` gains `exact?`/`quality?`.
  - `src/recorder/RecorderService.ts` — inject shared capture script via `addInitScript({ content })`;
    removed the old inline class-list locator logic.
  - `app/main/ipc/recorder.ipc.ts` — copy `exact`/`quality` onto saved `FlowStep.locator`.
  - `src/runner/LocatorFactory.ts` — honor `locator.exact` for role/text/label/placeholder.
  - `src/runner/StepExecutor.ts` — `guardLocatorQuality` (fail non-unique steps early) +
    `friendlyLocatorError` (translate strict-mode violations; raw error stays in logs).
  - Flow Designer: `flowDesignerTypes.ts` (+`locatorExact`/`locatorQuality`), `FlowChartDesigner.tsx`
    (round-trip + flow-level validation message), `FlowNodePropertiesPanel.tsx` (quality readout, exact
    toggle, clears stale quality on manual edits, validation message), `global.css` (`.locator-quality`).
  - `package.json` (+`verify:recorder`).
- **Tests run:** `npm run build` ✅ (tsc + bundles); `npm run verify:recorder` ✅ 23/23;
  `npm run verify:runner` ✅ 44/44 (regression check after LocatorFactory/StepExecutor edits).
- **Tests not run:** `npm run validate:offline` (PowerShell packaging validation — unrelated to this
  change; no `resources/` or manifest touched); clean-machine offline GUI walkthrough (human/VM step).
- **Result:** Recorder now saves unique semantic locators with quality metadata; designer surfaces
  non-unique locators; runner fails ambiguous steps with a friendly message. Backward compatible
  (all new fields optional; legacy flows load and run unchanged).

---

## 2026-07-01 — Claude Code — Recorder auto-captures visited URLs + Recorded URLs table

- **Task:** Automatically save URLs visited during a recording session and show them in a searchable,
  paginated table at the bottom of the Recording screen.
- **Capture:** `RecorderService` listens to main-frame `framenavigated` on the initial page and any tab the
  site opens (`context.on("page")`); records `{ id, url, title?, timestamp, source, sessionId }`. Sensitive
  query values (token/access_token/refresh_token/id_token/code/password/secret/session/auth/key/api_key)
  are masked to `***` **before storage** (`maskUrl`). Consecutive identical URLs within 1.5s are deduped;
  later revisits are kept. First URL = `manual_url_entry`, others = `navigation`. Session-scoped in memory,
  like recorded actions (start/cancel clear, stop keeps).
- **Wiring:** new `recorder:getUrls` IPC + `recorder.getUrls()` preload; `RecordedUrl` type in
  `RecorderTypes.ts`.
- **UI:** `Recorder.tsx` polls `getUrls` (500ms while recording + on mount + after stop) and renders a
  "Recorded URLs" table using the system table classes (`wl-table`, `table-search`, `DataTablePagination`,
  `TableEmptyState`): columns Time / Title / URL / Source / Session / Actions (copy). Case-insensitive
  search over url/title/source/session, resets to page 1; page sizes 10/25/50/100; newest-first; long URLs
  truncate with a full-value tooltip (`table-layout: fixed`). Empty + no-match states included.
- **Preserved:** existing recorder start/stop/cancel/getActions and Save to Flow Library unchanged.
- **Tests:** `npm run build` ✅; `npm run validate:offline` ✅. No `verify:recorder` script exists. GUI
  capture flow needs manual verification (headed browser). check-memory below.

---

## 2026-07-01 - Codex - Live Execution Report process-flow UI/UX fix

- **Task:** Improve the Live Execution Report modal, especially Flows & Steps, and fix the terminal
  "Updated" counter behavior.
- **Files changed:** `app/renderer/components/instances/LiveExecutionReportModal.tsx`,
  `app/renderer/components/instances/executionReportModel.ts`, `app/renderer/styles/global.css`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/FEATURES.md`, `docs/ai/TASK_LOG.md`.
- **UI/UX:** Replaced the static step-card grid with a connected horizontal process flow, numbered nodes,
  status icons/badges, active/waiting/manual-action animation, and a real progress bar based on visible
  step statuses. Narrow layouts keep the flow horizontally scrollable.
- **Failure handling:** Failed nodes now show friendly user-facing copy in the main UI; masked technical
  error detail is available only via hover/focus tooltip.
- **Timer/polling:** Modal report polling now runs only while the instance is live, with cleanup on close
  or unmount and one delayed final fetch after terminal transition. Terminal runs show a stable final
  update timestamp instead of an endlessly increasing relative "Updated" counter.
- **Tests:** `npm run build` passed; `npm run verify:instance-monitor` passed 22/22. Runner/offline
  verification not run because no runner/orchestrator/offline behavior changed. GUI walkthrough not run.

---

## 2026-06-27 — Claude Code — True live per-flow/per-step progress for the Execution Report

- **Runner progress events:** new `src/runner/RunnerProgress.ts` (`RunnerProgressReporter`,
  `RunnerProgressEvent`, bounded `LiveExecutionSnapshot`). `StepExecutor` takes an optional 8th
  `progress` reporter and emits `running` at step start and `succeeded`/`failed`/`waitingForManualAction`
  at step end (incl. the protected-login auto-pause). Threaded via `PlaywrightRunnerOptions.progress` →
  `StepExecutor` (existing call sites/tests unaffected — param is optional).
- **Bounded live snapshot in runtime state:** `InstanceRuntimeState.liveProgress?: LiveExecutionSnapshot`.
  `ExecutionEngine.createProgressReporter` folds step events into a snapshot (current flow/step, per-step
  states, recent events) capped at 500 steps / 200 events, resolves flow labels, and writes it to the pool
  (also live-updates the table's Current Flow/Step) — so the renderer's existing 1s poll shows live
  progress. No secrets stored.
- **Renderer:** `executionReportModel.buildLiveExecutionReport` now builds **per-step** node cards +
  timeline + stats from `instance.liveProgress` while running, from the stored report once finished, and
  falls back to the coarse per-flow map otherwise. Modal shows the active step pulsing, the flow label per
  card, and a live-updating timeline (`reports.get` still enriches/loads the final report; warning kept if
  it fails).
- **Compatibility:** final report + JSONL generation and workflow execution behavior unchanged; live and
  final share the same step statuses.
- **Tests:** `npm run build` ✅, `npm run verify:runner` ✅ 44/44, `npm run verify:instance-monitor` ✅
  22/22, `npm run validate:offline` ✅. check-memory below.

---

## 2026-06-27 — Claude Code — Live human-readable Execution Report modal (replaces JSONL button)

- **Instances table button:** the Files column's Logs (open-JSONL) button is replaced with a **Live Report**
  button (Activity icon, always enabled); the Screenshots button is kept. JSONL/report file generation is
  untouched — only the user-facing button changed.
- **New components:** `app/renderer/components/instances/executionReportModel.ts` (pure adapter +
  `LiveExecutionReport` types) and `LiveExecutionReportModal.tsx` (modal reusing `.modal-overlay`).
- **Data sources (no runner change):** banner/heartbeat from the live polled `InstanceRuntimeState`
  (status, currentStep, started, elapsed, manualHandoff); per-flow node map + step stats + timeline from
  the stored report (`reports.get(executionId)` → `InstanceReport.scenarioResult.flows[].steps[]` +
  `logs[]`). Added `reports.get` to preload (existing `reports:get` IPC). The modal refreshes the report
  every 3s while open so it fills in when the run completes.
- **UI/UX:** summary banner with status pill + animated heartbeat + "Running… waiting…" activity line;
  node-map cards with status colors and a pulse animation on the active/running/waiting node; statistics
  cards (total/completed/failed/pending/running, success rate, elapsed, avg/longest step, screenshots,
  errors — unavailable metrics show "Not available"); human-readable activity timeline from masked log
  messages (never raw JSON). Loading/empty states included. CSS-only animations.
- **Tests:** `npm run build` ✅, `npm run verify:instance-monitor` ✅ 22/22, `npm run validate:offline` ✅.
  No runner/report-generation files changed. check-memory below.

---

## 2026-06-27 — Claude Code — Recorder save feedback + Node Palette search-bar layout fix

- **Recorder "Save to Flow Library" feedback:** `Recorder.tsx` now shows clear success/failure feedback —
  shared `Toast` ("Flow saved to library successfully: <name>" / "Failed to save flow to library. Please
  try again. (<detail>)") plus an inline status banner in the Save Options panel. Added an `isSaving`
  pending guard (early-return + disabled button + "Saving…" label) so duplicate clicks can't corrupt the
  save. Existing save behavior/data unchanged; backend error message surfaced safely.
- **Node Palette search bar corruption:** root cause — the expanded `.flow-node-palette` is a CSS grid with
  `grid-template-rows: auto minmax(0, 1fr)` (two rows: head + scroll), but a third child (`.palette-search`)
  was added between them, so the search input landed in the `1fr` row and stretched tall while the list
  lost its scroll row. Fixed to `grid-template-rows: auto auto minmax(0, 1fr)` (head / search / scroll).
  Filtering/clear/drag-drop behavior unchanged (CSS-only fix).
- **Tests:** `npm run build` ✅ (tsc --noEmit + bundles). No `lint`/`test` npm scripts exist. check-memory below.

---

## 2026-06-27 — Claude Code — Protected Login Handoff (detect + pause + node + UI + OAuth foundation)

- **Detector (Task 01):** `src/security/ProtectedLoginDetector.ts` — pure `detectFromSignals(url,title,body)`
  + live `detectProtectedLogin(page)`. Flags provider URLs (Google/Microsoft/Okta/Auth0/Duo) and text
  signals (Google "browser may not be secure", "couldn't sign you in", CAPTCHA/"verify you are human"/
  "just a moment", MFA/2-step/authenticator, security check). Conservative: body text only scanned when
  URL/title is suspicious → no false positives on normal pages. Never reads/returns secrets.
- **Runner pause (Task 02):** `StepExecutor` auto-runs detection after goto/click/routeChange/wait; on
  detection it pauses via `ManualHandoffController` and returns `manualHandoff` + a `HandoffInfo`
  (`src/security/ProtectedLoginHandoff.ts`). Threaded through `FlowExecutor`/`PlaywrightRunner` results;
  `ExecutionEngine.runInstance` maps `manualHandoff` → `waitingForManualAction` with the detail, and the
  queue treats waiting as run-complete (no infinite loop; report still writes).
- **Node (Task 03):** new `protectedLoginHandoff` StepType + palette item + `protectedLogin` properties
  section (provider, handoff mode, instructions, detect-first, allow-retry, timeout). Validation surfaces
  capability notes (OAuth/saved/test-session unsupported) and requires instructions for pause-and-ask.
- **UI (Task 04):** `components/auth/ProtectedLoginHandoffPanel.tsx` in the Instance Monitor shows paused
  instances with provider/reason/URL + **Cancel Run** (stopInstance) and **Retry Detection**
  (repeatInstance); saved/test/OAuth actions shown disabled-with-reason unless supported.
- **OAuth foundation (Task 05):** `src/auth/OAuthHandoffService.ts` + `app/main/ipc/auth.ipc.ts` +
  preload `auth.*`. Capability-gated (env `WFS_OAUTH_*`); uses `shell.openExternal`; no fake tokens/success.
- **Sessions (Task 06):** Load Session not implemented → "Use Saved Session"/"Use Test Session" disabled
  with clear reasons. No third-party cookie extraction.
- **Docs (Task 07):** `docs/PROTECTED_LOGIN_HANDOFF.md`.
- **Verification (Task 08):** new `npm run verify:protected-login` (16/16, pure detector) + `verify:runner`
  extended (44/44, node pauses + auto-detect doesn't pause mock pages).
- **Tests:** `npm run build` ✅, `verify:runner` ✅ 44/44, `verify:protected-login` ✅ 16/16,
  `validate:offline` ✅, `verify:instance-monitor` ✅ 22/22, check-memory below.

---

## 2026-06-27 — Claude Code — Save Session node, flow row-open, shared connectors + style, palette/dropdown search

- **Task 01 — Save Session node:** new `saveSession` StepType. `StepExecutor.saveSession` writes Playwright
  `storageState` (cookies + localStorage/origins) to `<runtimeRoot>/sessions/<name>.json` (context.paths.sessions,
  set in `ExecutionEngine.runInstance` to `<dirs.root>/sessions`). Config: `sessionName`, `sessionFolder`,
  `overwriteSession`, `captureScope` (context | origin), `maskSession`. Validates required+file-safe name,
  writable folder, no-overwrite collision; logs only the path (never cookie/token values). Catalog + registry
  `session` section + properties UI added. `verify:runner` covers it (41/41, +4).
- **Task 02 — Flows row click → Flow Designer:** `FlowLibrary` rows are `role="button"`/tabbable, click or
  Enter/Space persists `selections.lastSelectedFlowId` and `navigateTo("flowChart")`; action buttons
  `stopPropagation`. Designer already loads `lastSelectedFlowId` on mount; Back returns via route history.
- **Task 03 + 06 — shared connector visuals + style customization:** new
  `components/shared/connectorStyle.ts` (`buildConnectorVisual`, `connectorTypeColor`, presets,
  `normalizeEdgeStyle`, `hasCustomStyle`) is now the single source for edge visuals in BOTH the Flow Designer
  (`createEdge`/`updateEdgeData`) and Workflow Builder (`createScenarioEdge`/`updateEdgeData`) — so they match.
  New `EdgeVisualStyle` on `FlowEdge`/`WorkflowEdge` (color/lineStyle/thickness/shape/arrowHead) persists and
  reloads; shared `ConnectorStyleEditor` added to both Connection Properties panels with Reset-to-default.
  Legacy connectors (no style) render with type defaults.
- **Task 04 — Node Palette search:** search input in the Flow Designer palette filters by
  label/type/description/category; "No matching nodes found." empty state; clear (X) + Escape reset.
- **Task 05 — searchable dropdowns:** new `components/shared/SearchableSelect.tsx` combobox applied to the long
  selectors in node properties (JSON Data Source, Target flow) and the Saved Flow selector — filter by
  label/value/description, keeps selection, "No matching options found." empty state.
- **Tests:** `npm run build` ✅, `npm run verify:runner` ✅ 41/41, `npm run validate:offline` ✅,
  `npm run verify:instance-monitor` ✅ 22/22, `check-memory` below.

---

## 2026-06-27 — Claude Code — UI fixes: instance-table alignment, DS row-preview, nav icon, brand mark

- **Instance table column alignment:** root cause was a global `table { display:block }` rule winning over
  `.instance-table` (so `table-layout:fixed` + `<colgroup>` were ignored) plus `.instance-name-cell` using
  `display:grid` on the `<td>` itself (removing it from the column model). Fix: `.instance-table` now sets
  `display:table`; `.instance-name-cell` is a normal table-cell with block-stacked `strong`/`small`.
  Horizontal scroll still handled by `.instance-table-wrapper`.
- **Data Source Manager preview on row click:** clicking a row now previews that source
  (`DataSourceManager` `<tr onClick>` → `openPreview`), with hover/selected row styles (`.ds-row*`);
  `stopPropagation` on the root-array-path input and the actions cell so they don't trigger a preview.
- **Runtime Inputs nav icon:** changed from `PlaySquare` (duplicated with Recorder) to `FormInput` in
  `routes.tsx`.
- **Brand mark consistency:** `.brand-mark` (WFS badge) is now a 32×32 square, radius 8px, weight 800,
  subtle shadow — consistent with the design system (was 38×30).
- **Tests:** `npm run build` ✅ (CSS/markup-only + icon swap; no logic touched). check-memory below.

---

## 2026-06-27 — Claude Code — Workflow cards grid: stable 3-column layout across Load More

- **Problem:** with `auto-fit minmax(250px,1fr)` the rendered column count depended on how many cards
  existed, so clicking "Load More" could reflow the row (cards-per-row and card width changed).
- **Fix (CSS only):** `.workflow-card-grid` is now `grid-template-columns: repeat(3, minmax(0,1fr))`
  (responsive: 2 cols ≤1080px, 1 col ≤680px). Cards-per-row and dimensions stay identical before/after
  Load More. `useGridColumns` still measures 3/2/1 for the Load-More row math; card design/min-height
  unchanged.
- **Tests:** `npm run build` ✅ (`verify:instance-monitor` logic unaffected — CSS-only change).

---

## 2026-06-27 — Claude Code — Workflow cards grid UI polish (equal height, full-width, no-jump hover)

- **UI-only changes** to the Concurrent Instance Monitor workflow cards (no runner/exec/logic changes;
  `instanceCardLogic` untouched, `verify:instance-monitor` still 22/22).
- **Equal-height cards:** `.workflow-card-grid` now `align-items: stretch`; `.workflow-card` is a fixed
  `grid-template-rows: auto 1fr` with `height:100%` + `min-height:250px`; names ellipsis, descriptions
  2-line clamped.
- **More cards per row:** grid switched from `auto-fill minmax(280px)` to `auto-fit minmax(250px, 1fr)`
  so cards stretch to fill the row (no wasted right gap) and up to ~4 fit on wide screens. The
  `useGridColumns` ResizeObserver still measures the real column count for Load-More math.
- **No-height-change hover:** `WorkflowRunCard` restructured into a fixed-height body with two
  absolutely-positioned, equal-area layers (`.workflow-card-summary` / `.workflow-card-params`) that
  cross-fade on `:hover`/`:focus-within`. Card height is constant → grid never reflows. Params inputs stay
  in the DOM and tab-focusable (focus reveals the layer); a "Hover or focus to configure & run" hint shows
  on the summary.
- **Full-width search & Load More:** removed `max-width` from `.im-card-search` (now `width:100%`) and
  `.im-load-more` (now full-width button).
- **Tests:** `npm run build` ✅, `npm run verify:instance-monitor` ✅ 22/22, `npm run verify:runner` ✅
  37/37, `npm run validate:offline` ✅, `check-memory` ✅.

---

## 2026-06-27 — Claude Code — Instance Monitor cards: unit verification + repackage

- **Goal:** close repo-verifiable unknowns for the workflow-cards work (no new features).
- **Extracted pure logic:** new `src/instances/instanceCardLogic.ts` (`filterWorkflows`,
  `visibleCardCount`, `validateCardParams`, `resolveWorkflowName`); `InstanceMonitor` now imports these
  instead of inline copies (behavior unchanged).
- **Added unit verification:** `scripts/verify-instance-monitor.mts` + `npm run verify:instance-monitor`
  → **22/22 pass** (search filter, responsive visible-count incl. 4×3=12 / 3×3=9 / 2×3=6 and +2-row Load
  More, per-card validation, deleted/unknown workflow-name resolution).
- **Repackaged after the UI change:** `npm run package:portable` → `dist/WebFlow Studio 0.1.0.exe`,
  `npm run package:nsis` → `dist/WebFlow Studio Setup 0.1.0.exe` (both unsigned; test-fixtures excluded).
- **Gates:** `npm run build` ✅, `npm run verify:runner` ✅ 37/37, `npm run validate:offline` ✅,
  `node scripts/ai-memory/check-memory.mjs` ✅.
- **Still GUI/VM-only:** live multi-workflow concurrency, hover/focus reveal, responsive widths, and the
  clean offline-VM walkthrough — see the checklist in `docs/OFFLINE_STANDALONE_PACKAGING.md`.

---

## 2026-06-27 — Claude Code — Instance Monitor workflow cards grid + workflow-aware instance records

- **Workflow cards grid (primary run UX):** new `components/instances/WorkflowRunCard.tsx` + a responsive
  grid in `InstanceMonitor`. Each card shows name/description, status badge (Active/Inactive/Invalid),
  flows + connectors counts, execution mode, data source, last updated; run parameters (total runs,
  concurrent, run mode, isolation, screenshot-on-failure [disabled — per-step concept], stop-on-error,
  Run) are revealed on **hover or keyboard focus** (`:focus-within`, inputs stay in the DOM so they're
  tabbable). Per-card params are independent, seeded from `settings.execution` defaults and persisted to
  the new `settings.workflowRunCards[workflowId]`.
- **Search + Load More by rows:** case-insensitive name/description search; grid shows 3 rows initially
  and Load More reveals +2 rows. Visible count = measured grid columns × rows (`ResizeObserver` reads
  `grid-template-columns`); search resets to 3 rows; empty states for no-workflows / no-match.
- **Classic form de-emphasized:** the old dropdown run form moved into a collapsed
  "Advanced / Classic run form" `<details>`; header keeps only **Stop All**.
- **Workflow column (Task 05):** instance table gains a Workflow column (resolves
  `scenarioId` → workflow name; "Deleted workflow"/"Unknown workflow" when missing); Instance subtext now
  shows the short execution id.
- **Concurrent workflows (Task 06):** fixed an instanceId collision — `InstanceManager` now mints
  globally-unique `instanceId` (`${executionId}-i${n}`) + sets `instanceOrderNumber`/`totalInstances`, so
  two workflows running at once no longer overwrite each other in the `InstancePool`. Card params
  `isolationMode` + `stopOnError` are plumbed through `RunWorkflowRequest` → the `ConcurrentRunProfile`
  (no fake controls; screenshot-on-failure shown disabled with tooltip).
- **Controls preserved (Task 07):** Pause All/Resume All/Stop All/Clear Completed moved to a monitor-wide
  bar; per-instance Pause/Resume/Stop/Repeat/Remove and the failed-only file-button rule unchanged.
- **Tests:** `npm run build` ✅; `npm run verify:runner` ✅ 37/37; `npm run validate:offline` ✅;
  `check-memory` — see below.

---

## 2026-06-27 — Claude Code — WB resize-handle alignment, Saved Flows pagination footer, per-instance Repeat

- **Task 02 fix — resize handles aligned to node bounds:** `.scenario-flow-node` had a fixed
  `width: 260px` and no `height: 100%`, so the article didn't fill the React Flow node wrapper that
  `NodeResizer` bounds — handles floated off the visible node. Now `width/height: 100%` +
  `box-sizing: border-box` + `overflow: hidden` (mirrors `.action-flow-node`).
- **Task 04 fix — Load More always discoverable:** Saved Flows now renders a footer showing
  "Showing X of N flows" whenever any flows exist, with the **Load More** button while more remain
  (and "All flows loaded." once exhausted). Previously the button only appeared when >10 flows existed,
  so with ≤10 it looked unimplemented. Logic unchanged (10 per page).
- **Task 09 (new) — Repeat single instance:** added `executionEngine.repeatInstance(instanceId)` which
  re-runs a finished instance from a retained per-execution `RunContext` (flows/scenario/dataSources/
  dirs/runtimeInputs, stored in `startRun` and kept beyond the run). New `execution:repeatInstance` IPC +
  `executions.repeatInstance` preload. Instance Monitor controls column gains a Repeat (RefreshCw) button,
  enabled only for terminal instances; Controls column widened to 200px so 5 buttons don't overflow.
- **Tests:** `npm run build` ✅; `npm run verify:runner` ✅ 37/37; `check-memory` — see below.

---

## 2026-06-27 — Claude Code — Route Change node, WB navigation/resize/search, save toasts, instance-monitor fixes

- **Task 01 — WB double-click opens Flow Designer:** `ScenarioBuilder` `onNodeDoubleClick` persists
  `selections.lastSelectedFlowId` + `selectedBuilderWorkflowId`, then `navigation.navigateTo("flowChart")`
  (routes through the unsaved-changes guard). `FlowChartDesigner` now honors `lastSelectedFlowId` on
  mount. Header Back returns to the Workflow Builder (restores the workflow via `selectedBuilderWorkflowId`).
- **Task 02 — WB node resize:** `ScenarioFlowNode` adds a `NodeResizer` (visible only when selected);
  `ScenarioFlowNodeData` carries `width/height`; size persists via `WorkflowFlowNode.size` and restores
  on load. Defaults `SCENARIO_NODE_DEFAULT_WIDTH/HEIGHT`.
- **Task 03/04 — Saved Flows search + Load More:** case-insensitive name filter, 10 shown initially,
  "Load More" reveals +10, "All flows loaded." when exhausted, "No matching flows found." empty state;
  search resets paging.
- **Task 05 — Route Change node:** new `routeChange` StepType + `NodeConfig.{routeMode,urlMatch,routeWaitUntil}`.
  Modes: switchToUrl / switchToLatestTab / waitForNewTab / navigateCurrentPage. Runtime switches the
  active page so later steps target the new tab: `StepExecutor` now holds a mutable `activePage` +
  `setActivePage`, and `LocatorFactory.setPage` redirects locators. Palette item, properties section, and
  mode-aware validation (incl. invalid-regex) added.
- **Task 06 — mock/recorder/fixtures:** mock site gains `#openNewTabButton` (form) + `/details` page
  (`routeChangeTargetTitle/Input/Submit/Result`). `RecorderService` inserts a Route Change action when an
  interaction occurs on a different tab/page; `recorder.ipc` maps it to a `switchToLatestTab` step. Seed
  adds `mock-route-change-flow` + `mock-route-change-workflow`. `verify-runner.mts` covers Route Change.
- **Task 07 — save messages:** shared `components/shared/Toast` + `.app-toast` CSS; Flow Designer and
  Workflow Builder show "… saved successfully: <name>" / "Failed to save changes. <err>". Data Source
  Editor already had success/error banners.
- **Tasks 08–10 — Instance Monitor:** Clear Completed now removes terminal instances from the backend
  pool (`executions.removeInstance`) so the 1s poll can't re-add them; controls audited (all map to real
  `executionEngine` methods); file/artifact buttons (Logs/Screenshots) enabled ONLY for `failed` instances
  with a path, disabled for completed/others, with status-specific tooltips.
- **Tests:** `npm run build` ✅; `npm run verify:runner` ✅ 37/37 (was 31; +6 Route Change); seed ✅
  (11 flows / 4 workflows / 1 data source); `npm run validate:offline` and `check-memory` — see below.

---

## 2026-06-27 — Claude Code — Selected-node resize handles + snapshot dirty-state + mock test fixtures

- **Task 1 — resize handles only on the selected node:** `ActionFlowNode.tsx` already used
  `<NodeResizer isVisible={selected} …>`; added a CSS safety net in
  `app/renderer/styles/global.css`
  (`.react-flow__node:not(.selected) .react-flow__resize-control { display:none }`) so unselected
  nodes never render handles/lines regardless of React Flow quirks. Resize + persistence unchanged.
- **Task 2 — unsaved dialog only for real changes:** replaced the string-state `isDirty` heuristic in
  `FlowChartDesigner.tsx` and `ScenarioBuilder.tsx` with a snapshot model. `serializeFlowDoc` /
  `serializeWorkflowDoc` produce an order-independent JSON of the saveable document (id-sorted nodes/
  edges; workflow also includes execution + dataSource). `isDirty = savedSnapshot !== "" &&
  docSnapshot !== savedSnapshot`. Baseline captured on load (`pendingSnapshot` ref + effect) and reset
  on save. Removed `handleNodesChange` (React Flow's initial `dimensions` measurement was flagging
  spurious dirty); now uses `onNodesChange` directly. Selection/zoom/pan/measurement no longer mark
  dirty; node/edge/property/metadata changes do.
- **Task 3 — test-only mock fixtures:** new `scripts/seed-mock-fixtures.mjs` + `seed:mock-fixtures`
  npm script. Generates 10 flows (login, fill-form, screenshot, scroll, upload, wait, loop,
  conditional, run-another-flow, assertion-fail+recovery), 3 workflows (simple, failure-handling,
  data-driven), 1 data source (mock-users, 3 rows). Writes source fixtures to
  `resources/test-fixtures/mock-site/{flows,workflows,data-sources}/` AND seeds them into the runtime
  userData folders (data file under `data/files/` per the collision fix). All `mock-`/"Mock —"
  prefixed, do NOT auto-load on fresh install. Excluded from packaged builds
  (`electron-builder.json` → `!test-fixtures/**`). Documented in
  `resources/test-fixtures/mock-site/README.md`.
- **Tests run:** seed script ✅ (10 flows / 3 workflows / 1 data source, 14 fixture JSON files parse);
  `npm run build`, `npm run validate:offline`, `npm run verify:runner`, and
  `node scripts/ai-memory/check-memory.mjs` — see below.

---

## 2026-06-27 — Claude Code — AI memory maintenance pass (skill)

- **Task:** Run the ai-memory-maintainer procedure; sync memory with recent changes.
- **Inspected:** `scripts/` now includes `verify-data-editor.mts` and `ai-memory/check-memory.mjs`
  (plus the `ai:memory` npm scripts and skill/command scaffolds).
- **Change:** `docs/ai/ARCHITECTURE.md` — `scripts/` map updated to list `verify-data-editor.mts`
  and `ai-memory/check-memory.mjs`. (COMMANDS, FEATURES, KNOWN_ISSUES, CURRENT_STATE already current
  from the data-source editor + collision-fix + review entries above.)
- **Checker:** `node scripts/ai-memory/check-memory.mjs` → passed.
- **Result:** memory consistent with the repo; no app code changed.

---

## 2026-06-27 — Claude Code — Memory review + checker pass

- **Task:** Review repo + memory files, replace any TODO sections, run `scripts/ai-memory/check-memory.mjs`.
- **Findings:** No literal TODO/placeholder sections exist — the memory files were authored fully
  populated and are current. Skill/command scaffolds present (no checker warnings). No secrets.
- **Change:** `docs/ai/COMMANDS.md` — added the new `ai:memory` / `ai:memory:check` npm scripts.
- **Checker:** `node scripts/ai-memory/check-memory.mjs` → passed (exit 0), no failures/warnings.
- **Result:** memory layer verified accurate and consistent with the current repo.

---

## 2026-06-27 — Claude Code — Fix data-source file/profile collision (editor "not a root array")

- **Bug:** Creating a data source wrote the data file to `<dataSources>/<name>.json`, the same path
  the profile-metadata store uses (`<dataSources>/<id>.json`); `store.import` then overwrote the
  array with the profile object, so the editor showed "not a root array of objects."
- **Fix:** `app/main/ipc/dataSource.ipc.ts` — user data files now live in `<dataSources>/files/`
  (`dataFilesDir`); `resolveDataFile` redirects legacy collided files and auto-heals (seeds from
  `profile.sampleRow` when the data file is missing); `preview`/`getJsonPaths` use the resolved
  data path too.
- **Tests run:** `npm run build` ✅, `npm run verify:data-editor` ✅ 27/27, `npm run verify:runner` ✅ 31/31.
- **Result:** new data sources save/read correctly; the previously-broken "users" source reopens
  with its seed row recovered. No schema change.

---

## 2026-06-27 — Claude Code — Data Source visual JSON table editor

- **Task:** Add a visual table editor for JSON data sources (view/edit/add/delete/duplicate rows,
  add/rename/delete columns, create from scratch, save real files).
- **Files added:** `app/renderer/pages/DataSourceEditor.tsx`,
  `app/renderer/components/shared/ConfirmDialog.tsx`, `src/data/TableEditing.ts` (pure helpers),
  `scripts/verify-data-editor.mts`.
- **Files changed:** `app/main/ipc/dataSource.ipc.ts` (+`readJson`/`writeJson`/`createFromScratch`,
  resources read-only → migrate on save), `app/main/preload.ts` (3 channels),
  `app/renderer/routes.tsx` (hidden `dataSourceEditor` route), `app/renderer/pages/DataSourceManager.tsx`
  (Edit Table / Duplicate / Export actions + Create Data Source modal), `app/renderer/styles/global.css`
  (editor table styles), `package.json` (`verify:data-editor`).
- **Tests run:** `npm run build` ✅, `npm run verify:data-editor` ✅ 27/27 (incl. real file round-trip),
  `npm run verify:runner` ✅ 31/31 (no regression), `npm run validate:offline` ✅.
- **Tests not run:** live GUI of the editor (needs the running Electron app).
- **Result:** feature implemented and logic verified against real files; uses real storage, not mock.

---

## 2026-06-26 — Claude Code — Final verification of AI memory (Prompt 04)

- **Task:** Pre-commit verification of the AI-agent memory setup.
- **Checks (all pass):** all 21 required files exist (3 root + 12 `docs/ai/` + 6 local `AGENTS.md`);
  Markdown code fences balanced in every file; `CLAUDE.md`/`GEMINI.md` both import `@AGENTS.md`;
  no secret-like values; referenced paths exist (`docs/OFFLINE_STANDALONE_PACKAGING.md`,
  `docs/IMPLEMENTATION_AUDIT.md`, `IMPLEMENTATION_STATUS.md`, `.env.example`, `.gitignore`,
  `playwright.config.ts`, `mock-site/server.mjs`).
- **Issues fixed:** none required.
- **Result:** AI memory layer verified and ready to commit.

---

## 2026-06-26 — Claude Code — Add folder-specific AGENTS.md (Prompt 03)

- **Task:** Add local `AGENTS.md` rules to high-value folders.
- **Files created:** `app/main/AGENTS.md`, `app/renderer/AGENTS.md`, `src/AGENTS.md`,
  `scripts/AGENTS.md`, `tests/AGENTS.md`, `docs/AGENTS.md`.
- **Files modified:** `docs/ai/DEVELOPMENT_WORKFLOW.md` (listed local AGENTS.md locations).
- **Skipped:** `resources/`, `vendor/`, `mock-site/`, `instances/`-style leaf folders — covered by
  root + `src`/`scripts` rules; per-folder files would add noise.
- **Tests run:** none (docs-only). **Result:** local rules added; consistent with root, no conflicts.

---

## 2026-06-26 — Claude Code — Audit & correct AI memory (Prompt 02)

- **Task:** Audit the memory files for accuracy, conflicts, invented features, unverifiable
  commands, secrets, and broken paths.
- **Findings:** All cited paths exist (verified `src/orchestrator`, `src/data`, `src/storage`,
  `app/main/ipc`, runner files, components/table, mock-site, tests, playwright.config). All
  `COMMANDS.md` commands are backed by `package.json`. No secrets; no conflicting rules; CLAUDE.md
  and GEMINI.md correctly import `@AGENTS.md`.
- **Corrections:** `ARCHITECTURE.md` — completed the `orchestrator/` and `data/` file lists
  (added FlowOrchestrator, ConditionalFlowRouter, ExecutionQueue, FlowOutputRegistry, DataBinding).
- **Tests run:** none (docs-only). **Result:** memory files verified accurate.

---

## 2026-06-26 — Claude Code — Bootstrap AI agent memory structure

- **Task:** Create the shared AI-agent memory/instruction layer (Prompt 01).
- **Files created:** `CLAUDE.md`, `GEMINI.md`, and `docs/ai/`: `PROJECT_BRIEF.md`,
  `CURRENT_STATE.md`, `FEATURES.md`, `ARCHITECTURE.md`, `COMMANDS.md`, `RULES.md`,
  `KNOWN_ISSUES.md`, `TASK_LOG.md`, `DECISIONS.md`, `SECURITY.md`, `TESTING.md`,
  `DEVELOPMENT_WORKFLOW.md`.
- **Files modified:** `AGENTS.md` (rewritten from a long product spec into a concise agent hub that
  delegates detail to `docs/ai/`; spec content relocated into `ARCHITECTURE.md`/`RULES.md`/
  `FEATURES.md`/`SECURITY.md`).
- **Repository understanding:** Electron + React + TypeScript Windows desktop app (WebFlow Studio)
  for offline Playwright automation; framework-agnostic core under `src/`; JSON profile storage;
  offline packaging (portable + NSIS) with bundled Chromium; runner verified live via
  `npm run verify:runner`.
- **Tests run:** none new (documentation-only task). Prior session verified `npm run build` ✅,
  `npm run verify:runner` ✅ 31/31, `npm run validate:offline` ✅, packaging ✅.
- **Tests not run:** clean-machine offline GUI walkthrough (human/VM step, pending).
- **Result:** AI memory layer created; no application code or runtime behavior changed.
- **Notes:** Folder-specific `AGENTS.md` files (Prompt 03) and audit (Prompt 02) not yet done.
