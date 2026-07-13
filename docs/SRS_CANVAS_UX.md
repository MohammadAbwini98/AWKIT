# Software Requirements Specification (SRS)

## Workflow Builder & Flow Designer — Canvas UX, Connector Rules, and Motion

| | |
|---|---|
| **Document ID** | SRS-CANVAS-UX-001 |
| **Product** | WebFlow Studio (AWKIT) — offline Electron + React + `@xyflow/react` desktop app |
| **Author** | Front-End / UX |
| **Date** | 2026-07-10 |
| **Status** | Draft for review |
| **Related surfaces** | Flow Designer (`app/renderer/pages/FlowChartDesigner.tsx`), Workflow Builder (`app/renderer/pages/ScenarioBuilder.tsx`), Workflow Overview (`app/renderer/pages/WorkflowDesigner.tsx`), shared connectors (`app/renderer/components/shared/`), tokens/motion (`app/renderer/styles/global.css`) |

> **⚠ Design references not yet attached.** The originating request refers repeatedly to
> "the attached images" for the desired plus-button, conditional connector, and loop
> appearance. No images were supplied with this ticket. Every acceptance criterion that
> depends on visual conformance is marked **[NEEDS REFERENCE]** and must be re-verified
> against the images before sign-off.

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
| **Node** | A React Flow node (`actionNode` / `scenarioFlow`). |
| **Connector / Edge** | A React Flow edge linking two nodes. |
| **Branch connector** | A conditional or parallel connector; nodes in this mode expose a locked **pair** of same-kind source ports (`MAX_BRANCH_CONNECTORS = 2`). |
| **Loop connector** | A structured `loop`-kind self-edge (source === target) rendered via `SelfLoopEdge`. |
| **Port / Handle** | A React Flow connection handle on a node (`normal-out`, `conditional-out-0`, `loop-in`, …). |

### 1.4 References

- `AGENTS.md`, `docs/ai/RULES.md` (UI = Hologram design tokens; offline-first; minimal diffs).
- `docs/ai/ARCHITECTURE.md` (renderer/runner data flow).
- `mock-site/README.md` (Feature Test Lab — scenarios must cover new canvas behavior).

---

## 2. Overall Description

### 2.1 Current-state findings (grounded in code)

A code inspection shows several items reported as "not implemented" are in fact **partially
implemented**. Requirements below are written to close the *actual* gaps, not to rebuild
working code.

| # | Ticket claim | Actual current state | Real gap |
|---|---|---|---|
| 1a | Plus sign not implemented | Inline **edge** "+" exists (`TemplateSmoothEdge` + `insertNodeOnEdge`) but is wired **only in Flow Designer** via `edgesForCanvas`. Workflow Builder renders raw `edges` with no `showAddButton`/`onInsertNode`. No node-attached "add next node" button exists on either canvas. | (i) Add the "+" to Workflow Builder edges; (ii) add a node-port "+" affordance to append a node from a node's output; (iii) conform visuals to reference. |
| 1b | Connector rules corrupted (conditional/parallel/loop) | Extensive rules already exist: branch pairs (`reconcileBranchConnectors`), loop-is-self-only, "one standard outgoing connector" gate, conditional-priority ambiguity check, save-blocking `connectorStructureIssues`. | Loop **routing priority** ("loop always wins; continue when satisfied") is not specified/enforced at authoring time; conditional/parallel/loop **visual language** does not yet match the reference; rules diverge subtly between the two canvases. |
| 1c | Saved nodes stacked on each other | `FlowChartDesigner.loadProfile` falls back to a constant `{ x: 280, y: 120 }` for every node lacking a saved `position`, so position-less nodes overlap exactly. No auto-layout exists. Workflow Builder spaces by index (`140 + i*320`) but only on a single row. | Deterministic **auto-layout** on load when positions are missing or overlapping, plus a manual "Tidy / Auto-arrange" action. |
| 1d | Dotted canvas not implemented | Implemented: `<Background variant={Dots}>` on all three canvases + `--awkit-canvas-dot` token + `radial-gradient` (`global.css:764`, `:2886`). | Likely a **contrast/visibility** defect (dot color too close to canvas bg) rather than a missing feature — verify and tune, do not re-add. |
| 2 | Animations for panels/nodes/sidebar/pages/buttons | Motion tokens exist (`--awkit-dur-*`, `--awkit-motion-*`, `--awkit-ease-out`); keyframes exist (`awkit-page-enter`, `awkit-panel-in`, `awkit-drawer-in`, `awkit-fade-in`, `awkit-pop-in`, `awkit-edge-flow`, toast-in); a `prefers-reduced-motion` reset exists (`global.css:7678`). | Coverage is **inconsistent** — nodes/edges mount without transition, page switches and sidebar collapse are not uniformly animated, button press has no active-state feedback. Requirement is systematic, token-driven application. |

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
- **FR-1.3 (P2)** Each editable node MUST expose a **node-attached "+"** on its primary output
  port that appends a new node and connects it with a default (normal) connector, matching the
  reference images' "add next step" pattern. **[NEEDS REFERENCE]**
  - **FR-1.3.1** On a node in conditional/parallel mode, the node "+" MUST create the next branch
    connector of the same kind, subject to the `MAX_BRANCH_CONNECTORS = 2` cap; when the pair is
    full the affordance MUST be disabled with an accessible explanation.
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
- **FR-2.2 (P1)** A node MAY have at most two conditional branch connectors (the locked pair);
  additional conditional drags beyond the cap MUST be rejected (already enforced by `onConnect`).
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
- **FR-2.6 (P1)** Deleting one half of a conditional/parallel pair MUST revert the survivor to a
  normal connector (single centered port) — as `reconcileBranchConnectors` `revertSources`
  already does; this MUST hold identically in both editors.

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

- **FR-4.1 (P1)** Both editors MUST display a visible dotted backdrop. The existing
  `BackgroundVariant.Dots` + `--awkit-canvas-dot` implementation MUST be retained, not replaced.
- **FR-4.2 (P1)** The dot color MUST have sufficient contrast against `--awkit-canvas-bg` in
  **both** light and dark themes to be perceivable but non-distracting (target: subtle, ~AA-ish
  non-text contrast). Current tokens (`#d8d4e0` light, `rgba(255,255,255,0.09)` dark,
  `#cac5d3` alt) MUST be verified on-device and tuned if the dots are invisible.
- **FR-4.3 (P2)** Dot gap/size MUST remain consistent across all three canvases (currently
  `gap={24} size={1}`); any change MUST be applied uniformly.

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
  `@media (prefers-reduced-motion: reduce)` (the existing global reset MUST cover any new
  animations; new keyframed elements MUST not bypass it).
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

| Ticket item | Requirements | Primary files |
|---|---|---|
| 1a Plus sign | FR-1.1 – FR-1.6 | `ScenarioBuilder.tsx`, `FlowChartDesigner.tsx`, `components/shared/TemplateSmoothEdge.tsx` |
| 1b Connector rules | FR-2.1 – FR-2.13 | `components/shared/connectorStyle.ts`, `SelfLoopEdge.tsx`, `components/workflow/ConnectionPropertiesPanel.tsx`, both page files |
| 1c Stacked nodes | FR-3.1 – FR-3.6 | `FlowChartDesigner.tsx` (`loadProfile`), `ScenarioBuilder.tsx`, new shared layout util |
| 1d Dotted canvas | FR-4.1 – FR-4.3 | `styles/global.css` (`--awkit-canvas-dot`, `.react-flow__background`), all three page files |
| 2 Animations | FR-5.1 – FR-5.9, NFR-1/2 | `styles/global.css` (motion tokens + keyframes), node/edge/panel components, routing shell |

---

*End of SRS-CANVAS-UX-001.*
