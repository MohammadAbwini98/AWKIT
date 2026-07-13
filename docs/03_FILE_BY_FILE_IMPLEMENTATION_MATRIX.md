# File-by-file Implementation Matrix

Use this as the agent's execution checklist. Each file has a detailed spec under `files/`.

| Order | Project file | Spec file | Main changes |
|---:|---|---|---|
| 1 | `app/renderer/styles/global.css` | `files/01_global_css.md` | Add/replace template tokens, shell layout, canvas, drawer, node, connector, motion, overflow, shared page styles. |
| 2 | `app/renderer/layout/AppShell.tsx` | `files/02_app_shell.md` | Change shell DOM so sidebar is full-height and header only spans main content. Thread `dirty`. |
| 3 | `app/renderer/layout/TopHeader.tsx` | `files/03_top_header.md` | Add dirty/status chip, compact action cluster, template classes. |
| 4 | `app/renderer/layout/LeftNavigation.tsx` | `files/04_left_navigation.md` | Template sidebar structure, bottom utilities, active state, route preservation. |
| 5 | `app/renderer/layout/DesignerCanvasLayout.tsx` | `files/05_designer_canvas_layout.md` | Make right drawer overlay slot, preserve React Flow geometry. |
| 6 | `app/renderer/components/workflow/CanvasZoomControl.tsx` | `files/06_canvas_zoom_control.md` | Template bottom zoom pill, optional real controls only. |
| 7 | `app/renderer/components/workflow/ActionFlowNode.tsx` | `files/07_action_flow_node.md` | Template node anatomy while preserving resizer/handles/loop. |
| 8 | `app/renderer/components/shared/connectorStyle.ts` | `files/08_connector_style.md` | Tokenize connector colors and introduce `templateSmooth` edge strategy. |
| 9 | `app/renderer/components/shared/TemplateSmoothEdge.tsx` | `files/09_new_template_smooth_edge.md` | New custom edge: label pill, running animation, optional add button. |
| 10 | `app/renderer/pages/FlowChartDesigner.tsx` | `files/10_flow_chart_designer.md` | Register template edge, inject safe edge insert callback, canvas class cleanup. |
| 11 | `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx` | `files/11_flow_node_properties_panel.md` | Drawer structure: sticky header/body/footer, overflow fixes, template section styling. |
| 12 | `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` | `files/12_connection_properties_panel.md` | Connector drawer structure, delete/save footer, body overflow. |
| 13 | `app/renderer/pages/ScenarioBuilder.tsx` | `files/13_scenario_workflow_canvases.md` | Apply same canvas/palette/drawer/connector style to workflow builder surfaces. |
| 14 | `app/renderer/pages/WorkflowDesigner.tsx` | `files/13_scenario_workflow_canvases.md` | Same as above for workflow designer. |
| 15 | `app/renderer/pages/FormDesigner.tsx` | `files/14_form_designer_and_shared_pages.md` | Canvas-like form designer polish and overflow. |
| 16 | Reports / Instances / Recorder / Settings pages | `files/14_form_designer_and_shared_pages.md` | Shared cards/forms/tables/panels/overflows/motion. |
| 17 | `docs/ai/*` | `files/15_docs_and_verification.md` | Update task log, current state, gap closure report. |

## Acceptance requirements

For every file changed, the agent must report:

```text
File:
Selectors/components changed:
Reason:
Template detail implemented:
Risk:
Verification:
Screenshot path:
```

## Forbidden shortcuts

- Do not state “already delivered” without screenshot proof.
- Do not skip connector redesign because edges already have colors.
- Do not skip drawer redesign because `properties-panel` already has radius/shadow.
- Do not skip overflow fixes.
- Do not skip animation proof.
