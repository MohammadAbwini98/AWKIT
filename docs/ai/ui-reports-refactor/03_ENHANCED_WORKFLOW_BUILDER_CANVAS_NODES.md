# 03 — Enhanced Flow Designer / Workflow Builder Visual Refactor

Enhances the original Prompt 03 with the exact components involved and the regression surface.
**Scheduled late** in the execution plan (Phase 10) because this is the most fragile, most-verified
area of the app.

## Exact existing files (verified)

| Concern | Files |
|---|---|
| Flow Designer page | `app/renderer/pages/FlowChartDesigner.tsx` (~1,151 lines) |
| Workflow Builder page | `app/renderer/pages/ScenarioBuilder.tsx` (~1,375 lines) |
| Flow node card | `app/renderer/components/workflow/ActionFlowNode.tsx` |
| Workflow node card | `app/renderer/components/scenario/ScenarioFlowNode.tsx` |
| Node registry | `app/renderer/components/workflow/flowNodeRegistry.ts` |
| Node properties panel | `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx` |
| Connector properties | `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` |
| Shared connector visuals | `app/renderer/components/shared/connectorStyle.ts` (`buildConnectorVisual`, `computePortFlags`, `portHandlesForKind`, `reconcileBranchConnectors`) |
| Ports / self-loop edge | `app/renderer/components/shared/ConnectorPorts.tsx`, `SelfLoopEdge.tsx` |
| Zoom control | `app/renderer/components/workflow/CanvasZoomControl.tsx` |
| Canvas layout | `app/renderer/layout/DesignerCanvasLayout.tsx`, `RightPropertiesPanel.tsx` |
| Persisted schemas | `src/profiles/FlowProfile.ts` (`FlowStep`, `FlowEdge`, `EdgeVisualStyle`, `validateConnectorStructure`), `ScenarioProfile` |
| Live status feed | `RunnerProgressEvent` → `InstanceRuntimeState.liveProgress` (for running-node animation, if surfaced) |

## Hard invariants (verified — must not regress)

- Connector structure rules (loop = self-loop only; ≤1 standard outgoing; self-loop forces
  Conditional exits) enforced in **three** places: `validateConnectorStructure`, both canvases'
  Save gates, and `FlowDependencyResolver`. Visual refactor must not alter kind/type semantics.
- Branch-pair ports: `<kind>-out-0/1` dynamic handles, `useUpdateNodeInternals` on
  `portFlags` change, ports rendered as **siblings** of the node card (the card's
  `overflow: hidden` would clip them). Any node-card DOM restructuring must preserve this.
- Loop button (add/remove toggle, top-right), top `loop-out`/`loop-in` handles, `SelfLoopEdge`
  semicircle, `circular` edge type registration in both canvases' `edgeTypes`.
- `NodeResizer` visible only when selected (CSS rule in `global.css`).
- Snapshot-based dirty detection (`serializeFlowDoc`/`serializeWorkflowDoc` baselines): visual-only
  props must NOT enter the serialized saveable doc, or every open flow becomes dirty.
- Empty-canvas click collapse behavior (collapse-only, idempotent, persisted; never loses unsaved
  panel values).
- Smart Waits section, locator-quality display, structured `StepLocator` fields in the properties
  panel; all node required fields and validation messages.
- Persisted `FlowEdge.style` (`EdgeVisualStyle`) must keep loading — new visual defaults apply only
  when `style` is absent (existing convention).
- Recorder-generated flows (Start/End wiring, `autoSecureLogin`/`reuseSession` nodes, pageAlias
  badges for popup flows) must render unchanged.

## Planned refactor (visual only, token-driven)

1. **Canvas**: dotted grid via React Flow `Background` styling with token colors; calmer empty
   state (EmptyState primitive); floating bottom toolbar restyle of existing zoom/fit controls
   (`CanvasZoomControl.tsx`) — no new actions, no removed actions.
2. **Node cards** (`ActionFlowNode`/`ScenarioFlowNode`): consistent card anatomy — icon area
   (registry icon), label, selected action/short description, `StatusBadge`, existing kebab/loop
   controls; token shadow/radius; `selected` ring via box-shadow token; `invalid` (registry
   validation) danger outline; running pulse **only** when live status is actually bound.
3. **Connectors**: keep `buildConnectorVisual` as the single source; recolor defaults to
   purple/blue tokens; animated dashed running-path only for genuinely running edges (live
   progress), else static; label chips (true/false/kind) with AA contrast.
4. **Properties panels**: grouped sections with `SectionHeader`, sticky action row, smooth
   open/close — every existing field, validation message, and disabled-option explanation stays.
5. **Node palette**: existing search stays; add category grouping visuals + hover states;
   drag/drop and add-node behavior untouched.
6. **Runtime animation binding**: reuse `liveProgress` (already polled at 1 s by Instance Monitor)
   only if the designer page has a live run context; otherwise ship static status styling and
   leave live canvas animation as a documented follow-up. **Do not invent runtime status.**

## Explicitly out of scope

- No node-type additions/renames; no edge `type`/`kind` changes; no serializer changes; no changes
  to `FlowStep`/`FlowEdge` persisted shape (visual tokens live in CSS, not in the profile JSON).
- No changes to `window.playwrightFlowStudio` contracts.

## Regression risks

| Risk | Mitigation |
|---|---|
| Port clipping / undraggable handles after card DOM changes | keep ports as card siblings; re-run GUI verifiers |
| Dirty-flag false positives | never add visual props to the saveable doc; verify open→no-dialog |
| Edge style overrides breaking saved custom styles | new defaults only when `style` undefined |
| CSS cascade breaking React Flow internals | scope new classes; do not touch `.react-flow__*` rules except the documented ones |
| Panel restyle losing required fields | field-by-field checklist against `FlowNodePropertiesPanel.tsx` before/after |

## Acceptance criteria

- `npm run build` clean.
- `npm run verify:flow-designer` (19 checks) and `npm run verify:workflow-builder` (13 checks) pass —
  these drive the **real Electron app**.
- `npm run verify:runner` (82) unchanged — proves serialization intact.
- Manual: open existing saved flow + workflow; select every major node type; edit/save required
  fields; connect/disconnect incl. conditional/parallel/loop; reload; confirm no unsaved-changes
  dialog on plain open; panels collapse/expand without data loss.
- Mock-site `/designer-lab` scenario updated if node/connector visuals change documented behavior;
  `npm run verify:mock-site` (28) passes.
