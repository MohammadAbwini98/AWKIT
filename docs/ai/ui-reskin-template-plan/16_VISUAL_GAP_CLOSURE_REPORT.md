# Visual Gap Closure Report

**Date:** 2026-07-07 · **Agent:** Claude Opus 4.8 · **Branch:** `feature/smart-wait-engine`
**Spec pack:** `docs/` (`README.md`, `00_MASTER_AGENT_PROMPT.md`, `01_ACTUAL_TEMPLATE_DESIGN_EXTRACTION.md`,
`02_GITHUB_CODEBASE_REVIEW.md`, `03_FILE_BY_FILE_IMPLEMENTATION_MATRIX.md`, `docs/files/01..15`).
The spec pack lives at repo `docs/` + `docs/files/` (not the `docs/ai/awkit-template-implementation-spec-pack/`
path named in the prompt — that directory does not exist in this repo).

This pass implemented the **structural template details the earlier token-only + shell re-skin left
out**: the floating configuration drawer, template node-card anatomy, the custom template connector
(label pills + insert affordance + running flow), the zoom-pill buttons, and the drawer
header/tabs/scroll-body/sticky-footer overflow model. No route/IPC/runner/schema/automation change.

## Template assets reviewed

| Asset | Reviewed? | Frames/screenshots | Notes |
|---|---:|---|---|
| UI Samples/sample_01.png | Prior passes (Hologram re-skin, 2026-07-07) | `docs/ai/ui-reskin-template-plan/screenshots/template-frames/` (prior) | Static workflow-builder reference; re-read design extraction (`01_ACTUAL_TEMPLATE_DESIGN_EXTRACTION.md`). |
| UI Samples/Sample02.mp4 | Prior passes | frames extracted earlier (system Chrome; Playwright Chromium can't decode H.264 — see [[hologram-reskin-gotchas]]) | Node select → drawer slide, Setup/Test tab motion. |
| UI Samples/sample_03.mp4 | Prior passes | frames extracted earlier | Center popover fade/scale over stable canvas. |
| UI Samples/sample_04.mp4 | Prior passes | frames extracted earlier | Node select + config/test drawer states. |

Frames were not re-extracted this pass; the design was driven from `01_ACTUAL_TEMPLATE_DESIGN_EXTRACTION.md`
and the exact per-file specs under `docs/files/`.

## Gap checklist

| Area | Template expectation | Prior AWKIT gap | Files/selectors fixed | Done? | Screenshot proof |
|---|---|---|---|---:|---|
| App shell | Sidebar full height, header in content | (already delivered by shell re-skin) | `AppShell.tsx` (unchanged this pass) | ✅ | after/02-flow-designer.png |
| Sidebar | Template nav + footer utilities | (already delivered) | `LeftNavigation.tsx` (unchanged) | ✅ | after/01-dashboard.png |
| Header | Title + dirty chip + action cluster | (already delivered) | `TopHeader.tsx` (unchanged) | ✅ | after/02-flow-designer.png |
| Canvas | Dotted full workspace, drawer floats | Drawer was a **grid column**, not floating | `DesignerCanvasLayout.tsx` (`designer-right-drawer-slot`), `global.css` (`.designer-layout` single column, slot overlay) | ✅ | after/02-flow-designer.png |
| Node cards | icon tile + metadata + title + kebab; lavender selected | Old generic icon/copy/type-badge markup | `ActionFlowNode.tsx` (`action-node-content/meta/index/title/description/menu`), `global.css` | ✅ | after/02-flow-designer.png |
| Connectors | curved violet + `success`/branch label pills + add button | Hardcoded semantic hex; no label pill/add affordance | `connectorStyle.ts` (tokenized + `templateSmooth`), **new** `TemplateSmoothEdge.tsx`, `FlowChartDesigner.tsx` (register + `insertNodeOnEdge` + `edgesForCanvas`), `ScenarioBuilder.tsx`, `WorkflowDesigner.tsx` | ✅ | after/05-workflow-designer.png (`success` pill) |
| Right drawer | floating panel + sticky header/tabs/footer + internal scroll | Panel scrolled as one block; no tabs/footer | `FlowNodePropertiesPanel.tsx`, `ConnectionPropertiesPanel.tsx` (`template-config-drawer`, `properties-tabs/body/footer`), `global.css` | ✅ | after/02-flow-designer.png |
| Node palette | floating searchable list | (already delivered; added slide-in) | `global.css` (`awkit-panel-in`) | ✅ | after/02-flow-designer.png |
| Zoom pill | bottom-center pill w/ divider | Buttons unclassed | `CanvasZoomControl.tsx` (`canvas-zoom-button`/`canvas-zoom-divider`), `global.css` | ✅ | after/02-flow-designer.png |
| Motion | hover/slide/flow/pop/shimmer + reduced-motion | Drawer/edge-flow/insert motion missing | `global.css` (`awkit-drawer-in`, `awkit-edge-flow`, `awkit-panel-in`; existing reduced-motion neutralizer kept last) | ✅ | n/a (motion) |
| Overflows | no page-wide overflow; only body scrolls | Whole drawer scrolled | `global.css` (`.properties-body` sole scroll region) | ✅ | after/02-flow-designer.png |
| Shared pages | cards/forms/tables polished | (already delivered by token re-skin) | unchanged | ✅ | after/08-reports-overview.png, after/09-settings.png |

## Files changed

- `app/renderer/components/shared/TemplateSmoothEdge.tsx` — **new** custom React Flow edge (label pill + insert `+` + running flow).
- `app/renderer/components/shared/connectorStyle.ts` — `connectorTypeColor` → CSS-variable strings; `buildConnectorVisual` remaps `smoothstep` → `templateSmooth` (saved `EdgeVisualStyle.shape` untouched); `resolveConnectorColor` fallback tokenized.
- `app/renderer/components/workflow/ActionFlowNode.tsx` — template node anatomy (icon tile / meta row + type badge / title / description / kebab); preserved NodeResizer, ports, loop button.
- `app/renderer/components/workflow/CanvasZoomControl.tsx` — `canvas-zoom-button` classes + divider.
- `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx` — drawer shell (`template-config-drawer`, header icon, Setup/Test tabs, `.properties-body`, sticky `Done` footer). All fields preserved.
- `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — same drawer shell; header delete; `Run Test` (disabled) + `Done` footer; added non-persisted `showAddButton`/`onInsertNode` to `FlowConnectionData`.
- `app/renderer/layout/DesignerCanvasLayout.tsx` — wrap right panel in floating `designer-right-drawer-slot`.
- `app/renderer/pages/FlowChartDesigner.tsx` — register `templateSmooth`; `insertNodeOnEdge` (safe edge split, Click node); display-only `edgesForCanvas` (callbacks never serialized).
- `app/renderer/pages/ScenarioBuilder.tsx` — register `templateSmooth`.
- `app/renderer/pages/WorkflowDesigner.tsx` — register `templateSmooth`; edges use it + violet stroke; label moved to `data.label`.
- `app/renderer/styles/global.css` — appended **TEMPLATE COMPLETION PASS** block (connector/motion tokens, floating drawer slot + single-column designer layout, drawer header/tabs/body/footer, node-card anatomy, connector label/add/flow, zoom-pill buttons, palette slide-in), placed before the last-in-cascade reduced-motion neutralizer.

## Verification

| Command | Result | Notes |
|---|---|---|
| npm run build | ✅ pass | `tsc --noEmit` + electron-vite (main/preload/renderer). |
| npm run verify:flow-designer | ✅ 19/19 | Reset persisted route→`flowChart`, sidebar expanded first (documented nav-title gotcha). |
| npm run verify:workflow-builder | ✅ 13/13 | Route→`scenarioBuilder`, sidebar **collapsed** (verifier clicks `nav-item[title=...]`). |
| npm run verify:reports | ✅ 26/26 | — |
| npm run verify:recorder | ✅ 57/0 | — |
| npm run verify:instance-monitor | ✅ 22/0 | — |
| npm run verify:data-editor | ✅ 27/0 | — |
| node scripts/ai-memory/check-memory.mjs | ✅ pass | — |

Screenshots (built app via `scripts/capture-ui-screenshots.mjs after`):
`docs/ai/ui-reskin-template-plan/mockups/screenshots/after/` —
`01-dashboard`, `02-flow-designer`, `04-workflow-builder`, `05-workflow-designer`,
`06-recorder`, `07-instances`, `08-reports-overview`, `09-settings`.

## Remaining gaps / notes

- **Setup/Test tabs are visual only.** `Test` is rendered disabled (`Not available yet`) — no fake test
  runner was added (honors RULES: no fake controls). Wiring a real per-node/connector test is future work.
- **Connector insert (`+`) inserts a `Click` node.** Deliberate, safe default (first non-start/end action);
  a node-type chooser could replace it later.
- **Scenario node card markup unchanged.** `ScenarioFlowNode` keeps its existing (already re-skinned)
  numbered-badge card; only its connectors were upgraded to `templateSmooth`. A full node-anatomy port to
  the workflow node is optional future polish.
- **Runtime automation behavior:** unchanged. Only renderer visual/markup + CSS touched; the display-only
  `showAddButton`/`onInsertNode` fields are never serialized (`toFlowProfile` reads connector fields
  explicitly).
- **Committed?** No — no commit was made (per instructions).
