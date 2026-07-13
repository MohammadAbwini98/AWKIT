# Final Visual Acceptance Report — AWKIT Hologram Template UI

**Date:** 2026-07-07 · **Agent:** Claude Opus 4.8 · **Branch:** `feature/smart-wait-engine`
**Screenshots:** `docs/ai/ui-reskin-template-plan/mockups/screenshots/after/` (captured against the built app
via `scripts/capture-ui-screenshots.mjs` + targeted per-route captures).
**Committed:** No. **Runtime automation behavior changed:** No (renderer visual/markup + CSS only).

This is the strict acceptance/hardening pass following the template completion pass
(`16_VISUAL_GAP_CLOSURE_REPORT.md`). Every area was checked against the template extraction
(`docs/01_ACTUAL_TEMPLATE_DESIGN_EXTRACTION.md`) with screenshot + code evidence; safe gaps were fixed.

## Fixes applied in THIS pass

1. **Drawer no longer covers the in-canvas action bar (flush designer pages).** The floating drawer
   was measured from the whole `.designer-layout` (top: 18px), so on Flow Designer / Workflow Designer
   it overlapped the action bar's right controls (Flow Name input, Load/Delete, `N issues` chip,
   Workflow select). Added `.designer-layout.flush-layout .designer-right-drawer-slot { top: 62px }` in
   `global.css` so the drawer starts below the action bar. Non-flush Form Designer keeps the 18px inset.
   Proof: `after/02-flow-designer.png` (Save/Export in header; Saved Flow, Flow Name, Load, Delete,
   `4 issues` all visible above the drawer).
2. **Tokenized stray legacy borders.** Replaced `1px solid #dfe6ef` (×6) and `1px solid #e2e8f0` (×1)
   inline borders with `1px solid var(--awkit-border)` in `app/renderer/pages/Recorder.tsx` and
   `app/renderer/pages/SessionsManager.tsx` so those form panels theme correctly (light + dark) and match
   the template border.
3. **Verifier UI-state reset helper.** Added `scripts/helpers/reset-ui-state.mjs` (dev/verifier-only) —
   resets `ui-settings.json` `lastRouteId`/`sidebarCollapsed` to a known state before a GUI verifier run.
4. **Captured a real Workflow Designer screenshot.** The prior `05-*.png` duplicated Workflow Builder
   because the `workflow` route is not in the sidebar nav; captured it via direct route restore.

## Acceptance matrix

| Area | Template expectation | Screenshot proof | Code path / selector | Pass/Fail | Fix applied | Remaining gap |
|---|---|---|---|:--:|---|---|
| App shell | Full-height sidebar; header over content only | after/01-dashboard.png | `AppShell.tsx`; `.app-shell` (grid 260px/1fr), `.app-main` | ✅ | — | — |
| Sidebar | Brand tile, grouped nav, footer utilities, dark toggle | after/01-dashboard.png | `LeftNavigation.tsx`; `.left-navigation/.nav-item/.nav-footer` | ✅ | — | `workflow` (Workflow Designer) route not in nav (pre-existing/by design) |
| Header | Title + subtitle + dirty chip + action cluster | after/02-flow-designer.png | `TopHeader.tsx`; `.top-header/.header-title/.header-status-chip` | ✅ | — | — |
| Dashboard cards | White rounded KPI cards + panels | after/01-dashboard.png | `.metric-card/.work-panel` | ✅ | — | — |
| Reports cards/charts | Card surfaces, polished empty/loading | after/08-reports-overview.png | `ReportsOverview.tsx`; range pills, empty state | ✅ | — | 14-hue chart palette intentionally literal (`ReportsFailures.tsx`) |
| Instances page | Equal-height run cards grid, status badges, internal scroll | after/07-instances.png | `InstanceMonitor.tsx` / `WorkflowRunCard.tsx` | ✅ | — | — |
| Recorder page | Violet primary CTA, neutral toggles, polished empty state, scrolling list | after/06-recorder.png | `Recorder.tsx` | ✅ | tokenized borders | — |
| Settings page | Sectioned template cards, 42px inputs, purple Save | after/09-settings.png | `Settings.tsx` | ✅ | — | — |
| Flow Designer canvas | Dotted full canvas, floating palette + drawer, zoom pill | after/02-flow-designer.png | `FlowChartDesigner.tsx`; `.designer-canvas/.react-flow-shell` | ✅ | drawer offset | — |
| Workflow Builder / Scenario canvas | Same canvas/nodes/connectors/drawer | after/04-workflow-builder.png | `ScenarioBuilder.tsx` | ✅ | — | `ScenarioFlowNode` keeps existing (re-skinned) numbered-badge card markup |
| Workflow Designer canvas | Read-only overview graph, floating overview drawer, templateSmooth edges | after/05-workflow-designer.png | `WorkflowDesigner.tsx` | ✅ | real shot captured | — |
| Node Palette | Floating searchable list, internal scroll, slide-in | after/02-flow-designer.png | `.flow-node-palette/.palette-scroll` | ✅ | — | — |
| Node Properties drawer | Sticky header + Setup/Test tabs + scroll body + sticky footer | after/02-flow-designer.png | `FlowNodePropertiesPanel.tsx`; `.template-config-drawer/.properties-tabs/.properties-body/.properties-footer` | ✅ | — | Test tab disabled (no real test runner — deliberate) |
| Connection Properties drawer | Same drawer + header delete | (drawer shell shared) | `ConnectionPropertiesPanel.tsx` | ✅ | — | Run Test disabled (no runtime — deliberate) |
| Right floating drawer | White floating panel, slide-in, over canvas | after/02-flow-designer.png | `DesignerCanvasLayout.tsx`; `.designer-right-drawer-slot` | ✅ | drawer offset | — |
| Node cards | icon tile + metadata + type badge + title + desc + kebab | after/02-flow-designer.png | `ActionFlowNode.tsx`; `.action-node-content/meta/index/title/menu` | ✅ | — | — |
| Start/End nodes | Same card anatomy | after/02-flow-designer.png | `ActionFlowNode` (start/end share markup) | ✅ | — | — |
| Connectors | Curved violet, hover/selected, running flow | after/02, after/04 | `TemplateSmoothEdge.tsx`, `connectorStyle.ts`; `.react-flow__edge-path` | ✅ | — | — |
| Conditional branch labels | Label pill on connector | after/04-workflow-builder.png (`success`) | `.template-edge-label` | ✅ | — | — |
| Connector plus/add affordance | Hover-revealed `+` splits edge | (hover-only; verified in verify:flow-designer flow) | `FlowChartDesigner.tsx` `insertNodeOnEdge`; `.template-edge-add-button` | ✅ | — | Inserts a default `Click` node (deliberate; TODO type chooser) |
| Bottom zoom pill | Bottom-center pill w/ divider, hover | after/02-flow-designer.png | `CanvasZoomControl.tsx`; `.canvas-zoom-control/.canvas-zoom-button` | ✅ | — | — |
| React Flow controls | Themed top-right controls | after/02-flow-designer.png | `<Controls position="top-right">` + `--xy-*` vars | ✅ | — | — |
| Minimap | Themed bottom-right minimap | after/05-workflow-designer.png | `<MiniMap>` keyed by theme | ✅ | — | — |
| Hover states | Node/card/button lift, edge highlight | (transform-only; code) | `global.css` hover rules | ✅ | — | — |
| Selected states | Lavender fill + purple ring node; edge highlight | after/02-flow-designer.png | `.action-flow-node.selected` | ✅ | — | — |
| Loading/skeleton states | Shimmer / skeleton cards | code | `SkeletonCard.tsx` (pre-existing) | ✅ | — | — |
| Empty states | Polished dashed/empty panels | after/06, after/08 | `EmptyState.tsx`; `.empty-state/.empty-properties` | ✅ | — | — |
| Modal/dialog/toast motion | Fade + pop entrance | code | `.modal-overlay` `awkit-fade-in/awkit-pop-in`; `Toast.tsx` | ✅ | — | — |
| Panel overflow/scroll | Only `.properties-body` scrolls; no page-wide overflow | after/02-flow-designer.png | grid `auto auto 1fr auto` | ✅ | — | — |
| Reduced-motion | All added motion disabled under `prefers-reduced-motion` | code | `@media (prefers-reduced-motion)` last in cascade | ✅ | — | — |

## GUI verifier state caveat — RESOLVED (helper) + documented

**Root cause:** the GUI verifiers navigate the sidebar by visible label (`verify:flow-designer` needs the
sidebar **expanded** + route reachable) or by nav `title` (`verify:workflow-builder` clicks
`nav-item[title="Workflow Builder"]`, which only matches when **collapsed**). The app persists
`lastRouteId`/`sidebarCollapsed`, so a prior session can leave an incompatible state and time a verifier
out. This is not caused by the template work.

**Helper (implemented, verifier-only, safe):** `scripts/helpers/reset-ui-state.mjs` resets only those two
persisted fields before a run. It mutates the local dev settings file only — no production/route/schema
change — so it was intentionally **not wired into** the existing (green) verifier scripts to avoid
destabilizing them. Run it as a pre-step:

```bash
node scripts/helpers/reset-ui-state.mjs flowChart false      # verify:flow-designer
node scripts/helpers/reset-ui-state.mjs scenarioBuilder true # verify:workflow-builder
node scripts/helpers/reset-ui-state.mjs dashboard false      # neutral / screenshots
```

**Proof of state-independence:** `verify:flow-designer` was run twice via the helper — once starting from
`route=workflow` (reset → `flowChart`) and once already on `flowChart` — both passed **19/19**.

## Visual-only edge fields do NOT persist — proof

- `showAddButton` / `onInsertNode` appear only in `TemplateSmoothEdge.tsx` (render), `FlowConnectionData`
  (renderer type, `ConnectionPropertiesPanel.tsx`), and the Flow Designer `edgesForCanvas` memo. A repo
  grep finds **zero** occurrences under `src/` (the persisted-model source).
- `FlowEdge` (`src/profiles/FlowProfile.ts:422`) has no such fields: `id, source, target, type, kind,
  conditional, parallel, loop, label, condition, style, maxLoopCount`.
- `toFlowProfile` (`FlowChartDesigner.tsx`) builds each saved edge by reading **explicit** fields only
  (`linkType/kind/conditional/parallel/loop/label/condition/style/maxLoopCount`) — it never spreads
  `edge.data`. `serializeFlowDoc` (dirty detection) uses that `toFlowProfile` output, so the display-only
  fields cannot enter save payloads or dirty comparisons. **No persistence risk.**

## Connector behavior — verified

Covered by `verify:flow-designer` (19/19) and `verify:workflow-builder` (13/13): normal connector
creation, selection opens the connection drawer, conditional two-port pair (+ lock after creation),
second conditional branch creation, deleting a branch reverts survivor to a normal port, self-loop
create/remove + semicircle path + top loop port, loop-node conditional lock. Edge split `+` inserts a
`Click` node and reconnects via `reconcileFlowBranches` preserving the source edge's kind. Saved custom
connector colors remain honored first in `resolveConnectorColor` (backward compatible).

## Properties drawer behavior — verified

Node drawer opens on node select; connector drawer opens on edge select (`verify:flow-designer`). Only
`.properties-body` scrolls (grid rows `auto auto 1fr auto`); header/tabs/footer stay pinned (see
`after/02-flow-designer.png` — long validation list scrolls, `Done` footer fixed). Test tab disabled
(no fake runner). No required fields hidden; all `details.property-group` sections preserved inside the
body. Collapse rail preserved.

## Remaining hardcoded colors — and why

| Location | Value(s) | Kept because |
|---|---|---|
| `global.css` `:root`/`[data-theme=*]` | e.g. `#f4f3f7`, `#ffffff`, connector `#7c3aed`… | **Token definitions** — the values themselves must be literal hex. |
| `connectorStyle.ts` `connectorColorPresets` | `#8b5cf6`,`#3b82f6`,`#16a34a`,`#f59e0b`,`#ef4444`,`#64748b` | **User-selectable** connector custom colors + backward-compat with saved `EdgeVisualStyle.color`. |
| `ReportsFailures.tsx` | 14-hue category palette | Deliberate distinct chart hues (documented in prior re-skin). |
| `TemplateSmoothEdge.tsx` add button `color: #fff` | `#fff` | Icon-on-violet contrast; matches template add-button. |

No remaining **layout/surface** hex in renderer TSX/CSS outside the above (verified by grep for
`#dfe6ef|#e2e8f0|#dde3ed|#0f172a|#334155` etc.).

## Verification commands & results

| Command | Result |
|---|---|
| `npm run build` (= tsc --noEmit + electron-vite) | ✅ pass |
| `node scripts/helpers/reset-ui-state.mjs flowChart false` + `npm run verify:flow-designer` ×2 | ✅ 19/19 both runs |
| `verify:workflow-builder` (reset scenarioBuilder/collapsed) | ✅ 13/13 |
| `verify:reports` | ✅ 26/26 |
| `verify:recorder` | ✅ 57/0 |
| `verify:instance-monitor` | ✅ 22/0 |
| `verify:data-editor` | ✅ 27/0 |
| `node scripts/ai-memory/check-memory.mjs` | ✅ pass |

`verify:runner` / telemetry / runtime-status not run: no runtime/report/runner code was touched this
pass (connectorStyle is renderer-only; Recorder/SessionsManager changes are inline border tokens).

## Remaining deliberate gaps

- **Test tab disabled** on both drawers — no real per-node/connector test runner exists; rendered disabled
  (`Not available yet`) rather than faked. Future: wire a real test.
- **Connector `+` inserts a default `Click` node** — safe first-action default; TODO add a node-type chooser.
- **`ScenarioFlowNode` card markup unchanged** — keeps its existing (already re-skinned) numbered-badge card;
  only its connectors were upgraded to `templateSmooth`. Optional future node-anatomy port.
- **`workflow` (Workflow Designer) route not in the sidebar nav** — pre-existing; the page is a read-only
  overview reached via direct route restore, not this pass's scope.

## Confirmations

- **Runtime automation behavior unchanged** — renderer visual/markup + CSS only; display-only edge fields
  never serialize.
- **Nothing committed.**
