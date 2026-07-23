# Software Requirements Specification (SRS)

## Workflow Builder & Flow Designer — Canvas UX, Connector Rules, and Motion

| | |
|---|---|
| **Document ID** | SRS-CANVAS-UX-001 |
| **Product** | WebFlow Studio (AWKIT) — offline Electron + React desktop app, **in-house canvas engine** (`app/renderer/components/canvas/`; React Flow / `@xyflow/react` was removed) |
| **Author** | Front-End / UX |
| **Date** | 2026-07-10 · **reconciled 2026-07-23** |
| **Status** | Draft for review — **partially implemented; reconciled against current code** |
| **Related surfaces** | Flow Designer (`app/renderer/pages/FlowChartDesigner.tsx`), Workflow Builder (`app/renderer/pages/ScenarioBuilder.tsx`), Workflow Overview (`app/renderer/pages/WorkflowDesigner.tsx`), shared connectors (`app/renderer/components/shared/`), canvas engine (`app/renderer/components/canvas/`), tokens/motion (`app/renderer/styles/global.css`) |

> **⚠ Reconciled 2026-07-23.** This SRS was written 2026-07-10 against a React-Flow-based canvas
> that no longer exists. It has been reconciled against the current in-house engine: component
> names, tokens, and the implementation status of each requirement are updated below. Where the
> original cited `global.css` line numbers, those are replaced with stable token/selector
> references — `global.css` is a large, frequently-edited file and absolute line numbers drift.
> **FR-2.6 (branch-pair deletion) is now implemented and verified** (`components/shared/branchPairs.ts`,
> `npm run verify:branch-pairs`). Remaining gaps and the still-unresolved visual references are
> called out per requirement.

> **⚠ Design references not yet attached.** The originating request refers repeatedly to
> "the attached images" for the desired plus-button, conditional connector, and loop
> appearance. No images were supplied with this ticket. Every acceptance criterion that
> depends on visual conformance is marked **[NEEDS REFERENCE]** and must be re-verified
> against the images before sign-off. This reconciliation does **not** resolve those.

---

## 1. Introduction

### 1.1 Purpose

This SRS defines the requirements to fix and complete the visual-authoring experience of the
two node-graph editors in WebFlow Studio — the **Flow Designer** and the **Workflow Builder** —
and to introduce a consistent motion layer across the application. It covers node-add
affordances, connector (edge) routing rules for conditional / parallel / loop links, automatic
node layout, canvas backdrop, and UI animation.

### 1.2 Scope

**In scope**

- Node-add ("plus") affordances on both canvases.
- Connector rules and visual differentiation for **conditional**, **parallel**, and **loop**
  connectors, including loop routing priority.
- Automatic spacing / layout of saved nodes so they never overlap.
- A visible dotted canvas backdrop on both editors.
- Application-wide, accessibility-aware motion (fade/slide/scale) for panels, nodes, sidebar,
  page transitions, and interactive controls.

**Out of scope**

- Changing the runner/orchestrator execution engine beyond honoring the connector semantics
  already produced by these editors.
- Changes to profile JSON storage schema, IPC contracts, or the `window.playwrightFlowStudio`
  preload identifier.
- New node types or new business logic in flows/workflows.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| **Flow Designer** | `FlowChartDesigner.tsx` — edits a single reusable flow (action-level nodes). |
| **Workflow Builder** | `ScenarioBuilder.tsx` — composes saved flows into a workflow (flow-ref nodes). |
| **Workflow Overview** | `WorkflowDesigner.tsx` — **read-only** graph; no editing affordances. |
| **Node** | A canvas-engine node (`actionNode` / `scenarioFlow`), rendered by the in-house engine (`components/canvas/`). |
| **Connector / Edge** | A canvas-engine edge linking two nodes; every connector routes bottom→top (source-bottom → target-top). |
| **Branch connector** | A conditional or parallel connector. A node's same-kind branch connectors form a **pair** (max 2); this is now a purely *semantic* cap enforced by validation — the old two-port node model is gone, so there are no per-kind ports. |
| **Loop connector** | A structured `loop`-kind self-edge (source === target) rendered via `components/canvas/edges/LoopEdge.tsx`. |
| **~~Port / Handle~~** | **Obsolete.** The React-Flow handle model (`normal-out`, `conditional-out-0`, `loop-in`, …) was removed with React Flow. Handle helpers still linger in `connectorStyle.ts` (`portHandlesForKind`, `computePortFlags`, `portFlags`) as vestigial dead code tracked for a separate prune; they do not affect routing. |

### 1.4 References

- `AGENTS.md`, `docs/ai/RULES.md` (UI = Hologram design tokens; offline-first; minimal diffs).
- `docs/ai/ARCHITECTURE.md` (renderer/runner data flow).
- `mock-site/README.md` (Feature Test Lab — scenarios must cover new canvas behavior).

---

## 2. Overall Description

### 2.1 Current-state findings (grounded in code — reconciled 2026-07-23)

Since this table was first written, most of the "partial" items have been **completed**, and the
canvas was **re-platformed off React Flow onto an in-house engine**. The table is updated to the
*actual* current state; component/function names and the remaining real gaps reflect the code as
of 2026-07-23.

| # | Ticket claim | Actual current state (2026-07-23) | Real gap |
|---|---|---|---|
| 1a | Plus sign not implemented | **Largely done.** Inline **edge** "+" exists in **both** editors — Flow Designer (`FlowChartDesigner.insertNodeOnEdge`) and Workflow Builder (`ScenarioBuilder.insertFlowOnEdge`, edge "+" wired ~`ScenarioBuilder.tsx:576`). Rendered by the engine's `components/canvas/edges/SmoothEdge.tsx` (real `<button>` with `aria-label`, `nodrag nopan`, propagation stopped — FR-1.4). | (ii) an optional node-attached "add next node" affordance (FR-1.3) is still not built; (iii) visuals not conformed to reference **[NEEDS REFERENCE]**. |
| 1b | Connector rules corrupted (conditional/parallel/loop) | **Mostly done.** Branch/loop rules exist and are Save-blocking (`connectorStructureIssues` / `scenarioConnectorStructureIssues`): loop-is-self-only, "one standard outgoing connector" gate, conditional-priority ambiguity check, loop-forces-conditional-exit. **FR-2.6 lone-branch revert is now implemented** in `components/shared/branchPairs.ts` (was a no-op pass-through). | Loop **routing priority** is not surfaced at authoring time; conditional/parallel/loop **visual language** not conformed **[NEEDS REFERENCE]**. Editor parity for the branch-pair rule is now real (single shared module). |
| 1c | Saved nodes stacked on each other | **Done.** Deterministic layered auto-layout runs on load and via a manual **Auto-arrange** action (`components/shared/graphLayout.ts` — `positionsNeedLayout` / `layeredLayout` / `withAutoLayout`); it applies only when positions are missing or overlapping and never clobbers saved positions. Covered by `npm run verify:canvas-layout` (35/35). | None functional; visual polish only. |
| 1d | Dotted canvas not implemented | **Done.** The in-house `components/canvas/Background.tsx` renders a dotted backdrop on all three canvases via `--awkit-canvas-dot` + `radial-gradient` (`global.css` `.awkit-flow-background`; `radial-gradient(var(--awkit-canvas-dot) 1.5px, …)`). Current dot tokens: **light `#c4c9d2`, dark `#2c3140`, alt `#cac5d3`**. All three canvases pass **`gap={22} size={2}`**. | Verify on-device contrast (FR-4.2) and tune the token if invisible; do not re-add the feature. |
| 2 | Animations for panels/nodes/sidebar/pages/buttons | Motion tokens + keyframes exist (`--awkit-dur-*`, `--awkit-motion-*`, `--awkit-ease-out`; `awkit-page-enter`, `awkit-panel-in`, `awkit-drawer-in`, `awkit-fade-in`, `awkit-pop-in`, `awkit-edge-flow`, toast-in). Reduced-motion is handled by **multiple** `@media (prefers-reduced-motion: reduce)` blocks (six as of 2026-07-23, incl. admin-specific ones) — **not** a single reset. | Coverage is still **inconsistent** (see FR-5). The multiple reduced-motion blocks are a **consolidation hazard**: the global one uses `!important` on `transition-property` while others use the `transition: none` shorthand — merging them naively changes behavior. |

### 2.2 Constraints

- **C-1** UI must use Hologram tokens only (`var(--awkit-*)`, `--space-*`, `--radius-*`, motion
  tokens). No hardcoded hex or arbitrary px; no parallel class system (`docs/ai/RULES.md` › UI).
- **C-2** Fully offline: no CDN/remote fonts, scripts, or animation libraries fetched at runtime.
- **C-3** Do not change the `.app-shell` / `.app-main` grids without explicit permission.
- **C-4** Do not rename `window.playwrightFlowStudio`; do not alter saved profile JSON schema in
  a backward-incompatible way. Display-only edge data (`showAddButton`, `onInsertNode`,
  `portFlags`) must **never** be serialized.
- **C-5** Minimal, scoped diffs; preserve all runner/execution behavior, IPC, routing, and
  storage keys.
- **C-6** New/changed canvas behavior must be exercised by `npm run build` and, where the runner
  is affected, `npm run verify:runner`; add/update a `mock-site` scenario per `AGENTS.md`.

### 2.3 Assumptions & dependencies

- **A-1** Auto-layout may use a small, offline, bundled algorithm (e.g. a vendored layered/tree
  layout). No new networked dependency. If a library is added it must be dev-bundled and
  tree-shaken; a hand-rolled layered layout is acceptable and preferred if it keeps the diff small.
- **A-2** Loop runtime priority is honored by the existing orchestrator; this SRS constrains only
  the **authoring** guarantees (what the editor allows/produces) unless a runner gap is found
  during implementation, which must then be raised as a separate change.

---

## 3. Functional Requirements

Priority key: **P1** = must fix (defect / blocking), **P2** = should, **P3** = nice-to-have.

### 3.1 Node-add ("plus") affordances — *ticket 1a*

- **FR-1.1 (P1)** The inline edge "+" affordance MUST be available in **both** Flow Designer and
  Workflow Builder. Workflow Builder edges MUST be enriched with `showAddButton` +
  `onInsertNode` in a display-only `edgesForCanvas` mapping (mirroring Flow Designer), and the
  Workflow Builder MUST provide an equivalent midpoint-insert callback. **[NEEDS REFERENCE]** for
  exact button styling.
- **FR-1.2 (P1)** Clicking the edge "+" MUST insert a node at the connector midpoint, split the
  edge into `source → new` and `new → target`, and preserve the source edge's kind/routing so
  branch invariants (§3.2) remain intact — as `insertNodeOnEdge` already does in Flow Designer.
- **FR-1.3 (P2) — NOT IMPLEMENTED.** Each editable node MAY expose a **node-attached "+"** that
  appends a new node and connects it with a default (normal) connector, matching the reference
  images' "add next step" pattern. (There are no output "ports" in the in-house engine; this would
  attach to the node card, not a handle.) **[NEEDS REFERENCE]**
  - **FR-1.3.1** On a node with an existing conditional/parallel connector, the node "+" MUST
    create the next branch connector of the same kind, subject to the **pair cap of 2** (semantic,
    not port-based); when the pair is full the affordance MUST be disabled with an accessible
    explanation.
  - **FR-1.3.2** On a node that owns a self-loop, the node "+" MUST create a **Conditional**
    outgoing connector (consistent with the existing `loopControlledSources` rule).
- **FR-1.4 (P1)** All "+" controls MUST be real `<button>` elements with `aria-label`
  ("Insert node here" / "Add next node"), keyboard focusable, `nodrag nopan`, and MUST stop event
  propagation so canvas pan/selection is unaffected (as the current edge button does).
- **FR-1.5 (P2)** Inserted nodes MUST be selected on creation and MUST NOT overlap existing nodes
  (defer to §3.3 layout when the computed midpoint collides).
- **FR-1.6 (P1)** The Workflow Overview (read-only) MUST NOT show any "+" affordance.

### 3.2 Connector rules & visual language — *ticket 1b*

**Conditional**

- **FR-2.1 (P1)** A conditional connector MUST carry a `conditional` config (`sourceField`,
  `operator`, `expectedValue`, `priority`) and MUST render with a distinct visual state matching
  the reference (label pill, color/line treatment). **[NEEDS REFERENCE]**
- **FR-2.2 (P1)** A node MAY have at most two conditional branch connectors (the semantic pair
  cap). The connector-creation affordances (Logic picker, edge/append "+") MUST NOT produce a
  third same-kind branch connector on a node. (There is no drag-to-connect / `onConnect` in the
  in-house engine — connections are made through those affordances, so the cap is enforced there
  and by save-blocking validation, not by a React-Flow handle rejecting a drag.)
- **FR-2.3 (P1)** Multiple conditional connectors from the same source with the **same
  `priority`** MUST surface the existing ambiguity warning and MUST be resolvable in the
  connector properties panel by editing priority.
- **FR-2.4 (P2)** Conditional routing MUST evaluate in ascending `priority` order; the first
  matching condition wins. This ordering guarantee MUST be documented in the connector panel help
  text.

**Parallel**

- **FR-2.5 (P1)** A parallel connector MUST carry a `parallel` config (`joinMode`, `failMode`),
  form a locked pair (max 2), and render with its own visual state distinct from conditional.
  **[NEEDS REFERENCE]**
- **FR-2.6 (P1) — ✅ IMPLEMENTED & VERIFIED (2026-07-23).** Deleting one half of a
  conditional/parallel pair reverts the survivor to a normal (`success`) connector, identically in
  both editors. Implemented in `components/shared/branchPairs.ts` (`revertLoneBranchConnectors`),
  wired via `reconcileFlowBranches` (Flow Designer) and `reconcileScenarioBranches` (Workflow
  Builder) on every edge/node deletion. The conversion also clears branch-only config so nothing
  stale is carried over. **Hybrid rule** (owner decision, 2026-07-23):
  - **Interactive deletion** auto-reverts the lone survivor (the editor never leaves a graph it can
    deterministically repair).
  - **Existing / imported** lone branches are **not** rewritten on load; instead they are reported
    as Save-blocking issues (`incompleteBranchPairs` → `connectorStructureIssues` and its scenario
    twin) so opening a profile never mutates it.
  - A lone branch that still has a **standard fallback** connector is a valid if/else and is
    deliberately **exempt** from the Save block.

  Rationale: a lone branch does not truncate the flow (an earlier claim) — at run time
  `FlowExecutor` routes a lone conditional to its target with the *condition ignored*, and runs a
  lone parallel's target *twice* via the `success`/`always` fallback. The revert prevents both.
  Note the "single centered port" phrasing in the original requirement is obsolete — there are no
  ports; "normal connector" is the whole meaning now. Covered by `npm run verify:branch-pairs`
  (31/31).

**Loop (and loop priority)**

- **FR-2.7 (P1)** A `loop`-kind connector MUST connect a node **to itself only**; a cross-node
  loop MUST be a blocking validation error (`connectorStructureIssues`).
- **FR-2.8 (P1)** When a node owns a self-loop, every **other** outgoing connector from that node
  MUST be **Conditional** (existing `loopControlledSources` rule), so the graph always defines how
  the loop is exited.
- **FR-2.9 (P1) — Loop priority.** The loop MUST have **higher routing priority** than the node's
  other outgoing connectors: while the loop's continue-condition is satisfied, execution MUST
  re-enter the loop; only when the loop is *not* satisfied (or `maxIterations` is reached) may the
  flow proceed along the Conditional exit connector(s). The editor MUST make this precedence
  explicit in the loop connector's properties (e.g. "Loop runs until its condition fails or max
  iterations reached, then the flow continues"). **[NEEDS REFERENCE]** for the loop badge/arrow
  style.
- **FR-2.10 (P1)** Loop connectors MUST expose `maxIterations` (1–1000) with validation; missing
  or out-of-range values MUST be blocking issues (existing `validateFlow` loop checks).

**Cross-cutting**

- **FR-2.11 (P1)** Connector structure gates in `connectorStructureIssues` /
  `scenarioConnectorStructureIssues` MUST remain Save-blocking and MUST be **behaviorally
  identical** across Flow Designer and Workflow Builder (same messages, same thresholds).
- **FR-2.12 (P1)** A node MUST have at most one **standard** (non-conditional, non-parallel)
  outgoing connector; additional standard connectors MUST be blocked with the existing guidance
  message.
- **FR-2.13 (P2)** Connector selection MUST open the connector properties panel; the link-type
  control MUST remain locked for branch/loop connectors per the current rules, with the existing
  explanatory helper text.

### 3.3 Node layout / anti-overlap — *ticket 1c*

- **FR-3.1 (P1)** On loading a flow/workflow, any node **without a saved `position`** MUST be
  assigned a non-overlapping position by a deterministic auto-layout, replacing the current
  constant `{ x: 280, y: 120 }` fallback in `FlowChartDesigner.loadProfile`.
- **FR-3.2 (P1)** Auto-layout MUST guarantee a minimum gap between node bounding boxes (both axes)
  such that nodes and the connectors between them are clearly legible. Recommended default spacing:
  ≥ 64px horizontal and ≥ 48px vertical clearance (tunable via constants).
- **FR-3.3 (P2)** A manual **"Auto-arrange / Tidy"** toolbar action MUST re-run layout on demand
  for the current graph; it MUST mark the document dirty and be undoable via normal node-move
  history (positions are user-editable afterward).
- **FR-3.4 (P1)** Auto-layout MUST respect graph direction (Flow Designer top-to-bottom; Workflow
  Builder left-to-right, matching current defaults) and MUST route branch/loop nodes without
  crossing their own ports where feasible.
- **FR-3.5 (P1)** Auto-layout MUST NOT overwrite a user's manually saved positions on normal load;
  it applies only when positions are absent or detectably overlapping (same coordinates within a
  small epsilon).
- **FR-3.6 (P2)** After layout or first load, the canvas MUST `fitView` to frame all nodes.

### 3.4 Dotted canvas backdrop — *ticket 1d*

- **FR-4.1 (P1)** Both editors MUST display a visible dotted backdrop. The existing in-house
  `components/canvas/Background.tsx` + `--awkit-canvas-dot` `radial-gradient` implementation MUST
  be retained, not replaced. (The React-Flow `BackgroundVariant.Dots` referenced in the original
  is gone with React Flow.)
- **FR-4.2 (P1)** The dot color MUST have sufficient contrast against `--awkit-canvas-bg` in
  **both** light and dark themes to be perceivable but non-distracting (target: subtle, ~AA-ish
  non-text contrast). Current tokens (**`#c4c9d2` light, `#2c3140` dark, `#cac5d3` alt**; dot
  radius 1.5px) MUST be verified on-device and tuned if the dots are invisible.
- **FR-4.3 (P2)** Dot gap/size MUST remain consistent across all three canvases (currently
  **`gap={22} size={2}`** on all three); any change MUST be applied uniformly.

### 3.5 Motion & micro-interactions — *ticket 2*

- **FR-5.1 (P1)** All motion MUST use existing motion tokens (`--awkit-dur-fast|med|slow`,
  `--awkit-motion-*`, `--awkit-ease-out`). No new hardcoded durations/easings.
- **FR-5.2 (P1)** **Nodes** MUST animate on mount/insert (subtle fade + scale/`pop-in`) and on
  selection (elevation/border transition). Node drag MUST remain immediate (no transition lag on
  position).
- **FR-5.3 (P2)** **Connectors** MUST fade in on creation; running/active connectors keep the
  existing `awkit-edge-flow` animation; the edge "+" keeps its hover/focus reveal.
- **FR-5.4 (P1)** **Panels** (Node Palette, Node/Connector Properties, Workflow Definition,
  Selected Connector) MUST animate open/close and collapse/expand using `awkit-panel-in` /
  `awkit-drawer-in`, with width transitions on resize.
- **FR-5.5 (P1)** The **sidebar** collapse/expand MUST animate width and content opacity.
- **FR-5.6 (P1)** **Page/route switches** MUST use the existing `awkit-page-enter` entrance
  consistently across all routed pages.
- **FR-5.7 (P1)** **Buttons and interactive controls** MUST have hover, `:focus-visible`,
  `:active` (press), disabled, and loading states with token-driven transitions. Icon-only
  controls MUST have `aria-label`s.
- **FR-5.8 (P1)** All motion MUST be disabled/neutralized under
  `@media (prefers-reduced-motion: reduce)`. Note the codebase currently has **multiple**
  reduced-motion blocks (six as of 2026-07-23), not one reset, and they are **not equivalent** —
  the global block uses `!important` on `transition-property` while others use the `transition:
  none` shorthand (which suppresses via `transition-duration: 0s`). Any new keyframed element MUST
  be covered, and any consolidation of these blocks MUST preserve the `!important` behavior — do
  not merge them naively.
- **FR-5.9 (P2)** Toasts, dropdowns, and modals MUST use consistent enter/exit motion
  (fade + small translate/scale), reusing existing keyframes.

---

## 4. Non-Functional Requirements

- **NFR-1 Performance.** Canvas interactions (pan/zoom/drag) MUST stay at ~60fps on a typical
  graph (≤ ~150 nodes). Animations MUST be GPU-friendly (`transform`/`opacity` only; avoid
  animating `width`/`height`/`box-shadow` on large lists). Auto-layout for a typical graph MUST
  complete in < 100ms and MUST not block the main thread perceptibly.
- **NFR-2 Accessibility.** Keyboard operability for all new affordances (Tab/Shift+Tab/Enter/Space);
  visible focus rings; `aria-label`s on icon-only controls; respect `prefers-reduced-motion`;
  maintain color-independent connector differentiation (shape/label, not color alone).
- **NFR-3 Theming.** All new visuals MUST render correctly in light and dark themes via tokens.
- **NFR-4 Offline.** No runtime network, remote fonts, or CDN assets introduced.
- **NFR-5 Maintainability.** Connector rules, layout, and motion MUST be shared between the two
  editors where behavior is identical (extend the existing `components/shared/*` modules rather
  than forking logic).
- **NFR-6 Compatibility.** Existing saved flows/workflows MUST load and render correctly; no
  migration required for the position auto-layout (missing positions are computed, not persisted
  until the user saves).

---

## 5. Risks & Protections

| Risk | Impact | Mitigation |
|---|---|---|
| Reference images absent | Visual acceptance criteria ambiguous | All visual ACs marked **[NEEDS REFERENCE]**; do not sign off visual items without images. |
| Diverging rules between the two editors | Inconsistent UX, regressions | Consolidate in `components/shared/connectorStyle.ts`; assert parity via `verify:runner` + mock-site. |
| Auto-layout overwriting user positions | Data-loss feel | FR-3.5 applies layout only when positions are absent/overlapping; never persist without Save. |
| Serializing display-only edge data | Corrupt profile JSON | Keep `showAddButton`/`onInsertNode`/`portFlags` in per-render `*ForCanvas` maps only (C-4). |
| Motion regressions / jank | Perceived slowness | Token-driven, `transform`/`opacity` only; honor reduced-motion; profile large graphs. |
| Loop-priority runtime mismatch | Editor promises behavior the runner doesn't do | Verify against orchestrator; if a gap exists, raise a separate runner change (A-2). |

---

## 6. Acceptance Criteria (verification checklist)

- **AC-1 (1a)** Edge "+" appears and inserts a node correctly in **both** editors; a node-port "+"
  appends a node honoring branch/loop rules; all "+" controls are keyboard/AT accessible;
  Overview shows none. **[NEEDS REFERENCE]** for styling.
- **AC-2 (1b)** Conditional, parallel, and loop connectors are visually distinct and behave per
  §3.2; branch pairs cap at 2 and revert correctly; loop is self-only and forces conditional
  exits; loop priority is enforced/explained; structure gates block Save identically in both
  editors. **[NEEDS REFERENCE]** for connector visuals.
- **AC-3 (1c)** Loading a flow/workflow whose nodes lack positions yields a clean, non-overlapping
  layout; "Auto-arrange" tidies on demand; manual positions are preserved on normal load;
  `fitView` frames the graph.
- **AC-4 (1d)** Dotted backdrop is clearly visible in light **and** dark themes on both editors,
  with consistent gap/size, using the existing token implementation.
- **AC-5 (2)** Nodes, edges, panels, sidebar, page switches, and buttons animate consistently with
  motion tokens; everything is neutralized under `prefers-reduced-motion`; no jank on a ~150-node
  graph.
- **AC-6 (build/verify)** `npm run build` passes; `npm run verify:runner` passes (report pass
  count) if runner touched; an updated/added `mock-site` scenario covers the new canvas behavior
  and passes `npm run verify:mock-site`.

---

## 7. Traceability

| Ticket item | Requirements | Primary files (2026-07-23) |
|---|---|---|
| 1a Plus sign | FR-1.1 – FR-1.6 | `ScenarioBuilder.tsx`, `FlowChartDesigner.tsx`, `components/canvas/edges/SmoothEdge.tsx` (edge "+") |
| 1b Connector rules | FR-2.1 – FR-2.13 | `components/shared/connectorStyle.ts`, `components/shared/branchPairs.ts` (**FR-2.6**), `components/canvas/edges/LoopEdge.tsx`, `components/workflow/ConnectionPropertiesPanel.tsx`, both page files; verifier `scripts/verify-branch-pairs.mts` |
| 1c Stacked nodes | FR-3.1 – FR-3.6 | `components/shared/graphLayout.ts`, `FlowChartDesigner.tsx` (`loadProfile`), `ScenarioBuilder.tsx`; verifier `scripts/verify-canvas-layout.mts` |
| 1d Dotted canvas | FR-4.1 – FR-4.3 | `components/canvas/Background.tsx`, `styles/global.css` (`--awkit-canvas-dot`, `.awkit-flow-background`), all three page files |
| 2 Animations | FR-5.1 – FR-5.9, NFR-1/2 | `styles/global.css` (motion tokens + keyframes; multiple `prefers-reduced-motion` blocks), node/edge/panel components, routing shell |

---

*End of SRS-CANVAS-UX-001.*
