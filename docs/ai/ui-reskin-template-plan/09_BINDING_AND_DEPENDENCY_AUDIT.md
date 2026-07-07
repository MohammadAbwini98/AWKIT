# 09 — Binding & Dependency Audit

Mapping: **UI → props/state/hooks/context → IPC/preload bridge → main service → runtime/data → files → regression risk → verification.**
Bridge is always `window.playwrightFlowStudio.*` (preload). Re-skin touches **classNames/CSS only**;
these bindings must remain byte-identical.

| UI component | State/hooks | IPC bridge | Main service | Data source | Files (style-touch) | Risk | Verify |
|---|---|---|---|---|---|---|---|
| App shell | route state, `sidebarCollapsed`, `pageChrome` actions | — | — | — | `AppShell/TopHeader/LeftNavigation/StatusBar.tsx`, css | low | nav + collapse + header actions |
| Dashboard | KPI fetch hooks | `...reports/status.get*` | reports/telemetry svc | runtime.sqlite | `Dashboard.tsx`, css | low | counts unchanged |
| Flow Designer | React Flow state, `useReactFlow`, node/edge stores | `...flows.save/load` | flow profile store | JSON profiles | `FlowChartDesigner.tsx`, workflow comps, css | **high** | build/run/save |
| Workflow Builder | RF state, scenario store | `...flows/scenarios.*` | scenario/runner | JSON | `WorkflowDesigner/ScenarioBuilder.tsx`, css | high | build/run/save |
| Recorder | recorder session hooks | `...recorder.*`, `sessionCapture` | recorder/runner | draft store | `Recorder.tsx`, css | med | record→draft→save |
| Node Palette | catalog list | — | — | `flowNodeCatalog.ts` | palette css | low | drag adds node |
| Node Properties | node data state | via flow save | flow store | node data schema | `FlowNodePropertiesPanel.tsx`, css | med | edit→save persists |
| Connector Properties | edge data state, `connectorStyle` | via flow save | flow store | edge `data.style` | `ConnectionPropertiesPanel.tsx`, `connectorStyle.ts`, css | med | style edit→save |
| Instances | instance list/live subs | `...instances.*`, events | runner/instance mgr | runtime.sqlite | `ExecutionMonitor.tsx`, `components/instances/*`, css | med | run/cancel/filter |
| Instance Monitor | live resource subs | `...runtime.subscribe*` | runtime status svc | live samples | `InstanceMonitor.tsx`, css | med | live updates, no leak |
| Reports | report queries, tabs | `...reports.*` | telemetry/analytics | runtime.sqlite | `Reports*.tsx`, `components/reports/*`, css | med | each tab renders |
| Settings | settings form state | `...settings.get/set` | settings store | JSON | `Settings.tsx`, css | low | fields save |
| Shared cards | props only | — | — | — | css | low | visual only |
| Shared forms | controlled inputs | per-page | per-page | — | css | low | submit payload same |
| Shared tables | props/rows | per-page | per-page | — | css | low | sort/filter intact |
| Workflow canvas | RF instance | — | — | — | css `.react-flow__*` | high | geometry intact |
| Nodes | node data | flow save | flow store | node schema | `ActionFlowNode.tsx`, css | high | ports/resize/loop work |
| Connectors | edge data | flow save | flow store | edge schema | `connectorStyle.ts`, edge css | high | connect/save/render |

**Audit conclusion:** every binding is orthogonal to styling. Keep `window.playwrightFlowStudio`,
handle IDs, edge `data` schema, and RF coordinate code untouched. Style edits are className/CSS-scoped.
