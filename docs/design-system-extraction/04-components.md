# 04 — Component inventory

Every exported UI component in the renderer, with its source path, props, variants and the CSS
class hooks it renders. **The class hooks are the redesign surface**: restyle them, don't rename
them — several are matched by end-to-end helpers and by `data-testid` attributes.

Directories covered:

| Directory | What lives there |
|---|---|
| [`layout/`](#layout--application-chrome) | Application chrome (8 files) |
| [`components/shared/`](#componentsshared--the-general-kit) | The general-purpose kit (24 files) |
| [`components/reports/`](#componentsreports--the-reporting-kit) | Reporting page frame + charts |
| [`components/table/`](#componentstable--the-table-kit) | Sorting, pagination, filtering |
| [`components/canvas/`](#componentscanvas--the-in-house-canvas-engine) | The in-house canvas engine |
| [`components/workflow/`](#componentsworkflow--flow-designer) | Flow Designer nodes/edges/panels |
| [`components/scenario/`](#componentsscenario--workflow-builder) | Workflow Builder node |
| [`components/data-binding/`](#componentsdata-binding--value-sources) | Value-source editors |
| [`components/instances/`](#componentsinstances--run-surfaces) | Run cards and run modals |
| [`components/auth/`](#componentsauth--protected-login-handoff) | Protected-login handoff panel |
| [`security/`](#security--pre-shell-authentication) | Pre-shell authentication |
| [`semantic/`](#semantic--semantic-search) | Semantic search results |
| [`pages/admin/components/`](#pagesadmincomponents--the-administration-kit) | The Administration kit |
| [`assets/brand/`](#assetsbrand--brand-marks) | Brand marks |
| [*supporting `.ts`*](#supporting-ts-modules-no-jsx-but-they-decide-appearance) | Modules with no JSX that still decide appearance |

Conventions used below: `?` marks an optional prop; `= x` shows the default actually written in
the source.

---

## `layout/` — application chrome

Full DOM anatomy and behaviour is in [`01-app-shell.md`](01-app-shell.md); this is the export-level
summary.

| Component | Path | Props | Root class |
|---|---|---|---|
| `AppFrame` | `layout/AppFrame.tsx` | `areaLabel` | `header.app-frame` |
| `WindowControls` | `layout/WindowControls.tsx` | *(none)* | `.app-frame-controls` |
| `LeftNavigation` | `layout/LeftNavigation.tsx` | `activeRouteId`, `collapsed`, `onRouteChange`, `onToggle` | `aside.left-navigation[.collapsed]` |
| `TopHeader` | `layout/TopHeader.tsx` | `activeRoute`, `actions`, `canGoBack`, `dirty`, `onBack` | `header.top-header` |
| `StatusBar` | `layout/StatusBar.tsx` | `onOpenLicensing` | `footer.status-bar` |
| `AppShell` | `layout/AppShell.tsx` | `activeRoute`, `activeRouteId`, `canGoBack`, `children`, `dirty`, `headerActions`, `sidebarCollapsed`, `onBack`, `onRouteChange`, `onToggleSidebar` | `div.app-shell[.sidebar-collapsed]` |
| `DesignerCanvasLayout` | `layout/DesignerCanvasLayout.tsx` | `children`, `propertiesTitle = "Properties"`, `rightPanel?`, `flush = false`, `rightCollapsed = false` | `.designer-layout[.flush-layout][.has-right-panel][.right-collapsed]` |
| `RightPropertiesPanel` | `layout/RightPropertiesPanel.tsx` | `title` | `aside.properties-panel` |

---

## `components/shared/` — the general kit

The 24 components in this folder are used by every page family. Restyling this folder is the
highest-leverage work in the product after the tokens themselves.

### Status, metrics and feedback

#### `StatusBadge`
`components/shared/StatusBadge.tsx`

```ts
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "running";

{ tone: StatusTone; label: string; icon?: ReactNode; pulse?: boolean }
```

Source comments state the rules verbatim: *"Visual tone. Pair with a clear label — color is never
the only signal"* and *"Adds a soft pulse; use only for genuinely live/critical states."*

Hooks: `.awkit-status-badge` + tone modifier, `.awkit-status-badge-icon`.
**6 tones × pulse on/off = 12 states to design.**

#### `MetricCard`
`components/shared/MetricCard.tsx`

```ts
type MetricTone = "default" | "success" | "warning" | "danger";

{ label: string; value: ReactNode; detail: string; icon?: ReactNode;
  trend?: ReactNode; tone?: MetricTone = "default"; loading?: boolean }
```

`loading` renders a skeleton placeholder **instead of** the content — the card is its own loading
state, it is not wrapped in one. `trend` is a slot, normally filled with `<TrendDelta />`.
Hooks: `.metric-card` + tone, `.metric-card-trend`.

#### `TrendDelta`
`components/shared/TrendDelta.tsx` — `{ percent, higherIsBetter = true, neutral = false }`

Renders `` `awkit-trend-delta tone-${tone}` ``. The `higherIsBetter` flag inverts which direction is
good, so **the arrow direction and the tone are independent** — a falling number can be green.

#### `AnimatedCounter`
`components/shared/AnimatedCounter.tsx`

```ts
{ value: number; decimals?: number; durationMs?: number; prefix?: string; suffix?: string }
```

Source comment: *"Ramp duration in ms (default ~= `--awkit-dur-slow`)."* A numeric ramp, so it is
in scope for the reduced-motion rule.

#### `SkeletonCard`
`components/shared/SkeletonCard.tsx` — `{ lines? = 3; variant?: "text" | "chart" = "text" }`

Hooks: `.awkit-skeleton-card`, `.awkit-skeleton-line`, `.awkit-skeleton-line.awkit-skeleton-title`,
`.awkit-skeleton-block` (the `chart` variant). Shimmer lives on these classes.

#### `EmptyState`
`components/shared/EmptyState.tsx`

```ts
{ title: ReactNode; hint?: ReactNode; icon?: ReactNode; action?: ReactNode; compact?: boolean }
```

Source comments: `hint` is *"Guidance on how to populate this surface"*, `action` is an *"Optional
call-to-action (e.g. 'Run a workflow')"*, `compact` is the *"Compact variant for inline/section
empties."* Hooks: `.awkit-empty-state[.compact]`, `-icon`, `-hint`, `-action`.
**Two densities to design.**

#### `Toast`
`components/shared/Toast.tsx`

```ts
export interface ToastState { tone: "success" | "error" | "info"; message: string }
{ toast: ToastState | null; onDismiss: () => void; duration?: number = 4000 }
```

Renders `` `app-toast app-toast-${tone}` `` plus `.app-toast-close`. Auto-dismisses after 4s.
Mounted by `App.tsx` as a shell sibling, so it floats over every page.

#### `ErrorBoundary`
`components/shared/ErrorBoundary.tsx` — a `class` component (the only one in the renderer).

Hooks: `.error-boundary`, `-card`, `-detail`, `-actions`, `.toolbar-button.primary`.
Keyed by `activeRouteId` in `AppShell`, so navigating away resets a crashed page.

### Dialogs

All three share the `.modal-overlay` › `.modal-dialog` › `.modal-header` / `.modal-body` /
`.modal-actions` skeleton and use `useModalFocusContract` for focus trapping + Escape.

| Component | Props | Distinctive hooks |
|---|---|---|
| `ConfirmDialog` | `{ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", icon = "warning", danger?, onConfirm, onCancel }` | `.modal-icon` variant from `icon`; `.toolbar-button` (+ danger styling) |
| `PromptDialog` | `{ title, label, message?, placeholder?, initialValue?, confirmLabel?, cancelLabel?, onConfirm(value), onCancel }` | `.modal-icon.create`, `.modal-field`, `.toolbar-button.primary` |
| `UnsavedChangesDialog` | `{ canSave, busy = false, onSave, onDiscard, onCancel }` | `.modal-dialog.unsaved-changes-dialog`, `.modal-icon.warn`, `.modal-actions.unsaved-changes-actions`, `.toolbar-button.modal-danger` |

`PromptDialog.onConfirm` is documented as *"Called with the trimmed value when the user confirms a
non-empty entry"* — the empty case never fires, so the confirm button needs a disabled state.
`UnsavedChangesDialog` is three-way (Save / Discard / Cancel) and `canSave` is false when the page
published no save action, so **Save must have a disabled appearance**.

### Inputs and pickers

#### `SearchableSelect`
`components/shared/SearchableSelect.tsx`

```ts
export interface SearchableOption { value: string; label: string; description?: string }

{ value, options, onChange, placeholder = "Select…",
  emptyText = "No matching options found.", ariaLabel? }
```

Hooks: `.searchable-select`, `-trigger`, `-menu`, `-search`, `-list`, `-empty`,
`` `searchable-select-option${selected ? " selected" : ""}` ``. Options may carry a second line
(`description`), so the row has a one-line and a two-line form.

#### `CanvasItemPicker`
`components/shared/CanvasItemPicker.tsx` — generic over the id type.

```ts
export interface CanvasPickerItem<T extends string = string> {
  id: T; label: string; description: string; category: string; icon: LucideIcon; disabled?: boolean;
}

{ open, title, searchPlaceholder, items, x, y, onPick, onClose, footer? }
```

**Positioned at canvas coordinates** (`x`/`y`), not anchored to a trigger. Groups by `category`,
supports disabled rows, and has a footer slot. Hooks: `.canvas-item-picker`, `-header`,
`.icon-button`, `.canvas-picker-search`, `-scroll`, `-icon`, `-empty`, `-footer`.

#### `NodeOptionsMenu`
`components/shared/NodeOptionsMenu.tsx`

```ts
export interface NodeMenuItem {
  id: string; label: string; icon: LucideIcon; tone?: "default" | "danger";
  disabled?: boolean; title?: string; onSelect: () => void;
}

{ open, anchor, items, onClose }
```

Source comment on `disabled`: *"the item renders disabled (e.g. the acting role lacks the
permission) with `title` as the reason."* So the **disabled menu row must still be readable and must
surface a tooltip** — it is the permission-denial affordance. Anchored to a DOM element.
Hook: `.node-options-menu`.

#### `NodeAppendButton`
`components/shared/NodeAppendButton.tsx` — `{ nodeId, onAppend }` →
`.node-append-affordance.nodrag.nopan`. The `+` under a node. `nodrag`/`nopan` are canvas-engine
opt-outs and must survive any markup change.

#### `ConnectorStyleEditor`
`components/shared/ConnectorStyleEditor.tsx` — `{ style, onChange, onReset }`.
Colour/width/dash editor inside `.property-section`, resets via `.toolbar-button`.

#### `LoopConnectorEditor` + `ConditionalConnectorFields`
`components/shared/LoopConnectorEditor.tsx`

- `ConditionalConnectorFields({ value, onChange })`
- `LoopConnectorEditor({ value, onChange, targetLabel, dataSources = [] })`

Validation surfaces as `.form-message` — the same class the Administration banner uses.

### Identity and command surfaces

#### `UserAvatar`
`components/shared/UserAvatar.tsx` — `{ imageUrl?, size = 32, locale?, className?, ...identity }`

Falls back to initials with a **deterministic tone from the identity**:
`` `${classes} tone-${tone}` `` where `tone-0 … tone-5` are defined at `global.css:12148`.
**Six avatar tones must exist in any new palette**, and the same person must keep the same one.

#### `AccountMenu`
`components/shared/AccountMenu.tsx` — `{ displayName, username, roleLabel, onSignOut }`

Hooks: `.awkit-account`, `-trigger`, `-meta`, `-name`, `-role`, `-caret`, `-menu`, `-menu-head`,
`-menu-identity`, `-menu-username`, `-menu-role`, `-menu-item`. Lives in the title bar, so it
overlays the drag region and must remain clickable.

#### `SectionHeader`
`components/shared/SectionHeader.tsx` — `{ title, description?, actions?, icon? }` →
`.awkit-section-header`, `-main`, `-icon`, `-actions`. The standard in-page section divider,
used heavily by the reporting family.

#### The editor command bar
`components/shared/EditorCommandBar.tsx` — five exports that compose the designer toolbars:

| Export | Props | Class |
|---|---|---|
| `EditorCommandBar` | `{ ariaLabel, className = "", children }` | `.editor-command-bar` |
| `EditorCommandGroup` | `{ label, className = "", children }` | `.editor-command-group` + `.editor-command-group-label` |
| `EditorIdentityField` | `{ label, className = "", children }` | `.editor-command-controls` |
| `EditorHistoryControls` | `{ canUndo, canRedo, onUndo, onRedo, undoId?, redoId?, undoTestId?, redoTestId? }` | `.editor-history-controls` |
| `EditorIconButton` | full `ButtonHTMLAttributes<HTMLButtonElement>`, `className = ""`, `type = "button"` | `.editor-command-icon-button` |

`EditorIconButton` spreads arbitrary button attributes, so **it must style correctly with any
combination of `disabled`, `aria-pressed`, `title` and `data-testid`**.

---

## `components/reports/` — the reporting kit

Charts are **hand-written SVG**. There is no charting dependency, so every axis, label, gridline and
tooltip in this folder is markup you can restyle directly.

### `ReportPage` — the family frame

`components/reports/ReportPage.tsx`

```ts
{ title, description, icon, range, onRangeChange, onRefresh, refreshing, children }
```

Renders `<section className="page awkit-report-page">` with a `SectionHeader`, a
`TimeRangeSelector`, and `button.awkit-icon-button[aria-label="Refresh"]` carrying a 16px `RefreshCw`
that gains `.awkit-spin` while `refreshing`. Seven routes use it — see
[`03-pages.md`](03-pages.md) § Family C.

### `TimeRangeSelector`
`{ value, onChange }` → `div.awkit-range-selector[role="group"][aria-label="Time range"]` of buttons
using `aria-pressed` + `.is-active`. **A segmented control, not a `<select>`** — both the pressed
and unpressed states need designing.

### Charts

| Component | Props | Notes |
|---|---|---|
| `ConsumptionTimeline` | `{ series: TimelineSeries[]; unit? = ""; height? = 200 }` | Multi-series line; `TimelineSeries = { label, color, points: TimelinePoint[] }`, `TimelinePoint = { x /* epoch ms */, y }` |
| `BarChart` | `{ data: BarDatum[]; maxBars? = 12 }` | `BarDatum = { label, value, color? }` — *"Optional per-bar color; defaults to the accent"* |
| `DonutChart` | `{ segments: DonutSegment[]; size? = 148; thickness? = 18; centerLabel?; centerSub? }` | `DonutSegment = { label, value, color }`; the centre is a two-line label slot |
| `MetricSparkline` | `{ values, width? = 160, height? = 40, stroke? = "var(--awkit-blue)", ariaLabel? }` | **The one place a token name is a default prop value** — a renamed token breaks this default |
| `RadialGauge` | `{ value, unit, bands? = DEFAULT_BANDS }` | Banded arc; bands carry their own colours |
| `RpmGaugeCard` | `{ title, value, unit, caption, tooltip, pulseHigh }` | Gauge in a card; `pulseHigh` animates at high load |

Every `color` above is expected to be a `var(--awkit-chart-N)` reference. The 14-step data-viz ramp
is assigned **by data category, never by state** — see [`02-design-tokens.md`](02-design-tokens.md).

### Panels and state

- `AvailabilityNotice({ availability, reason })` — the "this telemetry source is unavailable"
  notice; a first-class state in this family, not an error.
- `LiveProcessStrip({ status })` — the live-run ticker.
- `RunDetailDrawer({ instanceId, onClose })` — a drawer, not a modal.

Report panels use `work-panel awkit-report-panel`; deltas use `` `awkit-delta-chip is-${tone}` ``.

---

## `components/table/` — the table kit

`components/table/TableUI.tsx` exports four pieces plus one interface.

```ts
SortableHeaderCell({ label, columnKey, sortBy, sortDirection, onSort, align = "left" })
DataTablePagination({ page, totalPages, total, pageSize, onPage, onPageSize })
TableEmptyState({ filtered, title, hint, action })
AdvancedTableFilters({ searchText, onSearch, fields, applied, onApply, onClear, searchPlaceholder })

export interface FilterFieldDef {
  key: string; label: string;
  type: "text" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
}
```

Two details a redesign must honour:

1. `SortableHeaderCell` has an `align` axis (`"left" | "right"`, etc.) **in addition to** the
   ascending / descending / unsorted indicator — the affordance must work right-aligned.
2. `TableEmptyState.filtered` distinguishes **"nothing exists yet"** from **"nothing matches your
   filters"**. These are different messages and should look different; the second needs a visible
   way back.

`AdvancedTableFilters` renders one control per `FilterFieldDef.type`, so **four field renderings**
are required, plus applied-filter chips, Apply and Clear.

Page sizes come from `components/table/tableState.ts`: `PAGE_SIZES = [10, 25, 50, 100]`.

---

## `components/canvas/` — the in-house canvas engine

**This is not React Flow / `@xyflow`.** It is a local engine, so the node, edge, handle and
selection appearance is entirely yours — but the *geometry* is computed in TypeScript and CSS must
not fight it.

| Export | Path | Signature |
|---|---|---|
| `FlowCanvas` | `canvas/FlowCanvas.tsx:114` | `forwardRef<FlowCanvasHandle, FlowCanvasProps>` |
| `useCanvas()` | `canvas/FlowCanvas.tsx:62` | `CanvasContextValue` |
| `useViewport()` | `canvas/FlowCanvas.tsx:71` | `Viewport` |
| `Background` | `canvas/Background.tsx:14` | `{ gap = 22, size = 2, color = "var(--awkit-canvas-dot, #c4c9d2)" }` |
| `CanvasZoomControl` | `canvas/CanvasZoomControl.tsx:18` | `{ onPersist }` |
| `BaseEdge` | `canvas/edgeComponents.tsx:10` | `{ id, path, style, className, directional = false, interactionWidth = 20 }` |
| `EdgeLabelRenderer` | `canvas/edgeComponents.tsx:60` | `{ children }` |
| `StepNode` | `canvas/nodes/StepNode.tsx:93` | `memo(StepNodeComponent)`; data is `StepNodeData` |
| `SmoothEdge` | `canvas/edges/SmoothEdge.tsx:24` | `{ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, label, selected, style, directional }` |
| `LoopEdge` | `canvas/edges/LoopEdge.tsx:65` | as `SmoothEdge` plus `source`, `target`, `sourceNodeWidth`, `loopSide` |

`FlowCanvasProps`:

```ts
{ nodes; edges; nodeTypes; edgeTypes; className?; minZoom?; maxZoom?; fitViewOnInit?;
  nodesDraggable?; onNodePositionChange?; onNodeDragStop?; onNodeConnect?; onNodeClick?;
  onNodeDoubleClick?; onEdgeClick?; onConnect?; onPaneClick?; onPaneContextMenu?;
  onMoveEnd?; children? }
```

`FlowCanvasHandle` exposes `fitView`, `zoomTo`, `screenToFlowPosition` and
`panBy(dx, dy, { duration? })` — the last is documented as *"Pan the viewport by a screen-pixel
delta (optionally animated) — used to shift content clear of the drawer."* Opening the properties
panel pans the canvas; that motion is a design decision, not an accident.

`onNodeConnect` is *"Fired when a node is dropped overlapping another — drag-to-connect"*, with
`CONNECT_THRESHOLD = 4`. So **overlap during a drag needs a visible "will connect" affordance.**

### Geometry constants that CSS must not contradict

`components/canvas/geometry.ts`

```ts
SMOOTH_STEP_OFFSET = 20;
LOOP_CONTROL_LANE_WIDTH            = SMOOTH_STEP_OFFSET * 8;   // 160
LOOP_CONTROL_LANE_HEIGHT           = …;
LOOP_CONTROL_MAIN_RADIUS           = SMOOTH_STEP_OFFSET * 1.5; // 30
LOOP_CONTROL_OUTER_RADIUS          = SMOOTH_STEP_OFFSET * 2;   // 40
LOOP_CONTROL_HIT_RADIUS            = SMOOTH_STEP_OFFSET * 2.2; // 44
LOOP_CONTROL_LABEL_GAP             = SMOOTH_STEP_OFFSET * 0.5; // 10
LOOP_CONTROL_PATH_INTERACTION_WIDTH= SMOOTH_STEP_OFFSET * 1.2; // 24
```

Plus `getSmoothStepPath()`, `getViewportForBounds()`, `pointToFlowPosition()`. The **hit radius is
larger than the visual radius** — an invisible touch target. Shrinking the drawn control is fine;
changing the hit geometry is a code change.

Node default sizes are declared in the designer type modules, not in CSS:
`DEFAULT_NODE_WIDTH = 320` / `DEFAULT_NODE_HEIGHT = 96`
(`workflow/flowDesignerTypes.ts`), and `SCENARIO_NODE_DEFAULT_WIDTH/HEIGHT = 320 / 96`
(`scenario/scenarioDesignerTypes.ts`). **A node design wider or taller than these will overlap
auto-layout positions.**

Supporting types: `canvas/types.ts` (`CanvasNode`, `CanvasEdge`, `CanvasNodeProps`,
`CanvasEdgeProps`, `NodeTypes`, `EdgeTypes`, `Viewport`, `Connection`) and `canvas/state.ts`
(`useNodesState`, `useEdgesState`, `addEdge`). Zoom bounds:
`ZOOM_MIN_PERCENT = 25`, `ZOOM_MAX_PERCENT = 200` — **node text must stay legible at 25 %.**

---

## `components/workflow/` — Flow Designer

| Export | Path | Props |
|---|---|---|
| `ActionFlowNode` | `workflow/ActionFlowNode.tsx:22` | `CanvasNodeProps<FlowDesignerNodeData>` → `{ id, data, selected }` |
| `FlowNodePropertiesPanel` | `workflow/FlowNodePropertiesPanel.tsx:60` | see below |
| `ConnectionPropertiesPanel` | `workflow/ConnectionPropertiesPanel.tsx:121` | `{ edge, onUpdate, onDelete, dataSources = [], sourceHasLoop = false }` |
| `OracleNodeSection` | `workflow/OracleNodeSection.tsx:58` | `{ oracle, onChange }` |

```ts
interface FlowNodePropertiesPanelProps {
  selectedNode: Node<FlowDesignerNodeData> | null;
  validationFindings: DesignerValidationFinding[];
  dataSources: DataSourceOption[];
  flows: DataSourceOption[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onUpdateNode: (nodeId: string, data: Partial<FlowDesignerNodeData>) => void;
  onDelete?: () => void;
}
```

`selectedNode: null` and `collapsed` are both first-class: the panel has an **empty state** and a
**collapsed state** in addition to its populated state.

### The node type system drives node appearance

`components/workflow/flowNodeRegistry.ts`

```ts
type NodeCategory = "flow" | "navigation" | "interaction" | "input"
                  | "capture" | "assertion" | "control";

type PropertySection =
  | "locator" | "dragTarget" | "hold" | "value" | "select" | "wait" | "assertion"
  | "screenshot" | "scroll" | "loop" | "runFlow" | "condition" | "routeChange"
  | "session" | "protectedLogin" | "reuseSession" | "popup" | "oracle"
  | "execution" | "output";

interface NodeTypeDefinition extends FlowNodeCatalogItem {
  category: NodeCategory;
  defaultSize: { width: number; height: number };
  sections: PropertySection[];
  executable: boolean;   // "Whether the runner can execute this node type today."
  validate: (data: FlowDesignerNodeData) => string[];
}
```

Exports: `getNodeDefinition`, `hasSection`, `registeredStepTypes`, `nodeRegistry`.

**Seven node categories need seven visual treatments** — that is the primary categorical colour
demand on the canvas. `executable: false` is a real rendered state (a node the runner cannot yet
run). The properties panel is assembled from `sections`, so **each of the 20 section kinds is a
distinct form block** that must look coherent stacked in any combination.

`components/workflow/flowNodeCatalog.ts` supplies labels/icons via `flowNodeCatalog` and
`getFlowNodeCatalogItem`, with `UNKNOWN_FLOW_NODE_LABEL = "Unknown Step"` — the fallback for a node
type the build does not recognise, which **must render as a legitimate node, not a broken one**.

### Validation presentation

`components/workflow/flowValidationPresentation.ts` — `presentFlowValidation`, `findingsForNode`,
`interactionReviewForNode`, `confirmDirectActionPatch`; with
`type ValidationState = "valid" | "warning" | "error"` in `flowDesignerTypes.ts`.
Every node therefore carries **three validation appearances plus selection plus hover**.

### Connectors

`ConnectionPropertiesPanel.tsx` also exports `type FlowConnectionData`,
`interface SelectedConnection` and `const flowLinkTypeColor: Record<FlowEdgeType, string>` —
a **direct edge-type → colour map in TypeScript**, one of the few places colour is decided outside
the stylesheet. Keep it pointed at tokens.

---

## `components/scenario/` — Workflow Builder

`ScenarioFlowNode` (`scenario/ScenarioFlowNode.tsx:16`) —
`CanvasNodeProps<ScenarioFlowNodeData>` → `{ id, data, selected }`.

The Workflow Builder's node. It is a **sibling design to `ActionFlowNode`, not the same component**:
the two canvases share the engine and the 320×96 default size but have independent node components,
so a redesign must update both or they will visibly diverge.

---

## `components/data-binding/` — value sources

Six small editors that compose the "where does this value come from" surface.

| Component | Props |
|---|---|
| `DataBindingEditor` | `{ valueSource, runtimeInputKeys, onChange }` |
| `RuntimeValueInput` | `{ definition, value, onChange }` |
| `DropdownValueSelector` | `{ mode, onModeChange }` |
| `JsonPathPicker` | `{ value, paths, onChange }` |
| `JsonFilePicker` | `{ value, onChange }` |
| `VariableMapper` | `{ mappings }` |

`DataBindingEditor` is the container; the rest swap in by mode. `sampleData.ts` supplies preview
fixtures. These nest **inside** the node properties panel, so their density must survive a 440px
drawer (`--awkit-drawer-width`).

---

## `components/instances/` — run surfaces

### `WorkflowRunCard`
`components/instances/WorkflowRunCard.tsx`

```ts
type WorkflowCardStatus = "active" | "inactive" | "invalid" | "checking";

{ workflow: WorkflowProfile;
  status: WorkflowCardStatus;
  blockReason: string;        // "Reason the workflow can't run (invalid/inactive); empty when runnable."
  params: WorkflowCardParams;
  paramErrors: string[];      // "Per-card validation errors for the current parameter values."
  dataSourceName: string | null;
  maxRuns: number;
  maxConcurrentRuns: number;
  onChange: (patch: Partial<WorkflowCardParams>) => void;
  onRun: () => void;
  runDisabled?: boolean;      // "e.g. the acting role lacks the Execute Workflows permission"
  runDisabledReason?: string }
```

The densest single card in the product: **4 statuses × runnable/blocked × 0..n parameter errors ×
permission-disabled**, all inside one card with an embedded parameter form. `checking` is a
transient state that appears on every mount.

### `RecoverableRunsPanel`
`{ runs, resolveWorkflow, onRerunWorkflow, onOpenPath, onMessage, onChanged }` — crash-recovery
offer surface, shown after an unclean shutdown.

### Modals

| Component | Props |
|---|---|
| `BrowserObservationModal` | `{ instanceId, instanceName, onClose }` |
| `WorkflowInstancesModal` | `{ summary, workflowName, workflowMissing?, instances, onClose, onOpenReport }` |
| `LiveExecutionReportModal` | `{ instance, workflow, canExecute, canStop, onClose }` |

These are full-screen surfaces mounted from the Instances page. `LiveExecutionReportModal` streams
live and takes `canExecute` / `canStop` permission flags, so **its action buttons have a
permission-disabled appearance**. `WorkflowInstancesModal.workflowMissing` is the
"the workflow behind these runs was deleted" case.

---

## `components/auth/` — protected-login handoff

`components/auth/ProtectedLoginHandoffPanel.tsx`

```ts
export interface ProtectedLoginCapabilities {
  oauthConfigured: boolean;
  loadSessionSupported: boolean;
  testSessionSupported: boolean;
  reasons: { oauth: string; savedSession: string; testSession: string };
}

{ instances: InstanceRuntimeState[];
  capabilities: ProtectedLoginCapabilities | null;
  workflowName: (scenarioId: string) => string;
  onCancel(instanceId); onContinue(instanceId); onRetry(instanceId); onOpenOAuth(provider) }
```

The UI side of an existing product contract: when a run reaches a protected login, MFA, OTP,
CAPTCHA, passkey or approval surface, the run **pauses** and the user completes authentication
themselves in a real browser; the app never automates that page.

For design that means this panel is **a waiting state with three exits** (cancel / continue /
retry) plus an OAuth entry point, rendered once per paused instance. `capabilities: null` is the
"still determining" state, and each unavailable capability carries a human-readable `reasons` string
that **must be shown** — a greyed-out button with no explanation is the failure mode here.

---

## `security/` — pre-shell authentication

These render above the application shell; there is no navigation, header or status bar. Full DOM in
[`03-pages.md`](03-pages.md) § Security surfaces.

| Export | Path | Props |
|---|---|---|
| `SecurityGate` | `security/SecurityGate.tsx:42` | *(none)* — decides which screen shows |
| `LockedShell` | `security/LockedShell.tsx:53` | `{ areaLabel, children, idleTimeoutMs }` |
| `NotAuthorized` | `security/NotAuthorized.tsx:4` | `{ onGoHome?: () => void }` |
| `useSession()` / `SessionContext` | `security/SessionContext.tsx` | `SessionContextValue` |
| `PasswordField` | `security/components/PasswordField.tsx:40` | see below |
| `LoginScreen` | `security/screens/LoginScreen.tsx:26` | `{ options, onSubmit, onRecovery, notice }` |
| `FirstRunSetup` | `security/screens/FirstRunSetup.tsx:24` | `{ onSubmit }` |
| `ForcedPasswordChange` | `security/screens/ForcedPasswordChange.tsx:24` | `{ displayName, onSubmit, onCancel }` |
| `RecoveryCodeNotice` | `security/screens/RecoveryCodeNotice.tsx:13` | `{ recoveryCode, onContinue }` |
| `RecoveryPasswordReset` | `security/screens/RecoveryPasswordReset.tsx:19` | `{ onSubmit, onCancel }` |
| `SecurityUnavailable` | `security/screens/SecurityUnavailable.tsx:13` | `{ onRetry }` |

Result types the screens resolve to: `LoginSubmitResult`, `BootstrapResult`,
`ChangePasswordResult`, `RecoverySubmitResult`.

### `PasswordField`

```ts
{ label, value, onChange, autoComplete = "current-password", autoFocus?, disabled?,
  hint?, leadingIcon = false, invalid?, showStrength = false }
```

Hooks: `.awkit-login-field`, `-field-label`, `-leading-icon`, `.awkit-login-reveal`, `.sr-only`,
`.awkit-password-strength-bars`, `.awkit-password-strength-label`, `.awkit-login-caps`,
`.awkit-login-hint`.

Four independent overlays on one input: **reveal toggle**, **caps-lock warning**, **strength meter**
(bars + label), **invalid state**. They can co-occur. The caps-lock notice appears and disappears
while typing, so it must not shift layout.

### Shared login hooks

`LockedShell`: `.awkit-login-stage`, `-form-pane`, `-brand-row`, `-brand-row-spacer`,
`-appearance-label`, `-appearance-switch`, `-appearance-thumb`, `-scroll-body`, `-content`,
`-footnote`.

`LoginScreen`: `.awkit-login-form`, `-brand`, `-logo-custom`, `-wordmark`, `-wordmark-glyph`,
`-subtitle`, `-notice`, `-tabs`, `-soon`, `-field`, `-field-label`, `-leading-icon`, `-spin`,
`-link`, plus `.sr-only`. `.awkit-login-soon` marks a disabled "coming soon" tab.

`RecoveryCodeNotice` adds `.awkit-recovery-code`, `.awkit-recovery-code-value`,
`.awkit-recovery-confirm` — a one-time code the user must copy before continuing, so the value needs
to be unmistakably selectable and legible.

`SecurityGate` busy state: `.awkit-login-loading` + `.awkit-login-spin`.
`NotAuthorized` deliberately **reuses the Administration classes** (`.awkit-admin-page`,
`.awkit-admin-modal-icon`, `.awkit-admin-muted`) rather than defining its own.

The right half of the stage is the animated marketing panel: `.awkit-login-run-panel`, `-run-grid`,
`-run-spot`, `-run-scanline`, `-run-content`, `-run-kicker`, `-run-live-dot`, `-run-demo-label`,
`-run-lead`, `-run-timeline`, `-run-step-rail`, `-run-step-dot`, `-run-step-line`, `-run-step-card`,
`-run-step-row`, `-run-step-title`, `-run-step-time`, `-run-progress`, `-run-stats`, `-run-stat`.
It carries a **`demo` label by design** — it depicts a run, it does not report one. It is also the
most animation-heavy surface in the product and the first thing a user sees.

---

## `semantic/` — semantic search

`SemanticResultList` (`semantic/SemanticResultList.tsx:25`) —
`{ hits, ran, loading, degraded, error }`.

Five-way state in one component: **not yet run** (`ran: false`), **loading**, **error**,
**degraded** (results returned, but the index is stale or partial) and **results**. `degraded` is
the interesting one — it is a *success with a caveat* and needs a treatment that is neither an error
nor invisible.

Supporting modules:

- `semantic/useSemanticQuery.ts` — `type SemanticQueryMode = "search" | "similarFailures" | "suggestLocators"`; `useSemanticQuery()`. **Three query modes** the UI switches between.
- `semantic/useSensitiveSemanticAction.ts` — `type SensitiveOutcome`, `decideSensitiveOutcome`, `useSensitiveSemanticAction()`. Gates actions that could expose sensitive captured data.
- `semantic/semanticMessages.ts` — `SEMANTIC_KIND_OPTIONS`, `semanticKindLabel`, `semanticReasonMessage`, `semanticCapabilityLabel`, and `semanticCapabilityTone(capability): "ok" | "warn" | "error"` — **a three-tone capability indicator** for the search backend.

---

## `pages/admin/components/` — the Administration kit

`pages/admin/components/AdminUi.tsx` is a self-contained mini design system for the six
Administration routes. Its header comment states the rule this whole folder follows:

> All colour flows through `global.css` tokens; badges pair an icon with text so status never
> relies on colour alone.

| Export | Line | Props | Renders |
|---|---|---|---|
| `AdminPage` | 27 | `{ title, description, actions, children }` | `div.awkit-admin-page` › `.awkit-admin-header` › `.awkit-admin-heading` + `.awkit-admin-header-actions` |
| `AdminSummaryItem` | 59 | `{ label, value, hint }` | summary row |
| `AdminMetrics` | 73 | `{ label, children }` | `div.awkit-admin-metrics[role="list"]` |
| `AdminMetricCard` | 84 | `{ label, value, hint, icon, tone = "neutral" }` | `` `awkit-admin-metric-card tone-${tone}`[role="listitem"] `` › `-top`, `-icon`, `-label`, `-value`, `-hint` |
| `AdminSectionCard` | 117 | `{ title, icon, description, meta, actions, className, children }` | `` `settings-card awkit-admin-card…` `` › `-head`, `.awkit-admin-muted.awkit-admin-card-meta`, `.awkit-admin-row-actions`, `-description` |
| `AdminBanner` | 148 | `{ tone: "error" \| "warning" \| "success" \| "info", children }` | `p.form-message[.warn\|.error\|.success]` |
| `AdminStatusBadge` | 205 | `{ status, label }` | `` `awkit-admin-badge tone-${tone}` `` |
| `AdminLoading` | 219 | `{ label = "Loading…" }` | `div.awkit-admin-state[role="status"][aria-live="polite"]` + `.awkit-admin-spin` |
| `AdminEmpty` | 229 | `{ icon = Inbox, title, hint }` | `div.awkit-admin-state.awkit-admin-state-empty` |

Tones: `type MetricTone = "neutral" | "success" | "warning" | "danger" | "info"` — **note this is
five tones and a different set from `shared/MetricCard`'s four** (`default | success | warning |
danger`). The two kits are not unified today.

Icon sizes in this kit: metric-card icon **14px / strokeWidth 2.2**; section-card icon **16px**;
badge icon **12px / strokeWidth 2.4**; loading spinner (`Loader2`) **20px**; empty-state icon
**22px / strokeWidth 1.8**.

`AdminBanner` sets `role="alert"` for the `error` tone and `role="status"` otherwise — the tone is
an accessibility decision, not only a colour.

### `AdminStatusBadge` — the full status vocabulary

`STATUS_META` maps a normalised status string to a tone **and a required icon**:

| Tone | Statuses | Icon |
|---|---|---|
| success | `active`, `valid`, `success` | `CheckCircle2` |
| warning | `denied`, `disabled` | `Ban` |
| warning | `locked` | `Lock` |
| warning | `expiringsoon`, `expiring` | `Clock` |
| warning | `clockintegritywarning` | `TriangleAlert` |
| info | `notyetvalid` | `Clock` |
| neutral | `archived` | `Archive` |
| neutral | `notactivated`, `unsupportedversion` | `HelpCircle` |
| danger | `expired`, `invalid`, `failure` | `XCircle` |
| danger | `revoked` | `Ban` |
| danger | `invalidsignature` | `ShieldAlert` |
| danger | `machinemismatch`, `mismatch` | `MonitorX` |
| danger | `corrupted` | `TriangleAlert` |

Five tones, thirteen icons, twenty-one recognised statuses. **The icon is part of the meaning** —
`denied` and `revoked` are deliberately different glyphs at different tones.

---

## `assets/brand/` — brand marks

`app/renderer/assets/brand/AwkitBrandMarks.tsx`

```ts
export type AwkitBrandMarkSize = 16 | 38;          // only two sizes exist
export type AwkitBrandMarkProps = AwkitBrandMarkBaseProps & AwkitBrandMarkAccessibilityProps;
export interface AwkitWordmarkGlyphProps { className?: string }

AwkitLightBrandMark(props)   // :95
AwkitDarkBrandMark(props)    // :100
AwkitWordmarkGlyph({ className })  // :105
```

Inline SVG — **no image files, no icon font, no remote asset**. The light and dark marks are
separately authored artwork, not one mark with a filter. `AwkitBrandMarkSize` is a literal union of
`16 | 38`, so a new size is a code change, and the type is the reason arbitrary scaling is not
available today.

A third mark, `SpecterAppIcon({ size = 32 })`, is defined **inline inside**
`layout/LeftNavigation.tsx` rather than in this folder — concept "1c", matching `resources/icon.*`.
See [`01-app-shell.md`](01-app-shell.md).

---

## Supporting `.ts` modules (no JSX, but they decide appearance)

These are not components, and a designer will not see them in a screenshot — but each one produces
a value that ends up as a colour, a position or a motion decision. Changing the visual language
without reading them produces drift.

### Motion and focus

| Module | Export | Why it matters |
|---|---|---|
| `components/shared/usePrefersReducedMotion.ts:8` | `usePrefersReducedMotion(): boolean` | The **JS-side** reduced-motion switch. Some motion is JS-driven (`AnimatedCounter`, `panBy`) and cannot be neutralised by a CSS media query alone. |
| `components/shared/useModalFocusContract.ts:15` | `useModalFocusContract<T>(onCancel, active = true)` | One shared focus-trap + Escape contract for every dialog. New dialogs must use it; the focus ring styling is what makes it visible. |

### Connectors

`components/shared/connectorStyle.ts` — the connector visual language, in code:

```ts
interface ConnectorVisual { type: string; animated: boolean; style: React.CSSProperties }

connectorTypeColor        // type → colour
connectorColorPresets     // the user-selectable palette
normalizeEdgeStyle, hasCustomStyle, resolveConnectorColor, buildConnectorVisual

type ConnectorPortKind
LOOP_HANDLES = { sourceHandle: "loop-out", targetHandle: "loop-in" }
MAX_BRANCH_CONNECTORS = 2
branchSourceHandle, slotFromHandle, portHandlesForKind, connectorPortKindFromHandle
interface ConnectorPortFlags
computePortFlags, portPositions
```

Two design consequences: `MAX_BRANCH_CONNECTORS = 2` means a branching node has **exactly two
labelled outputs**, and `portPositions` / `computePortFlags` decide where handles sit and which are
active — so **handle placement is computed, not CSS.**

### Layout and authoring

| Module | Exports | Note |
|---|---|---|
| `components/shared/graphLayout.ts` | `layeredLayout`, `positionsNeedLayout`, `withAutoLayout`, `type LayoutDirection = "TB" \| "LR"` | Auto-layout. Node spacing derives from the declared node size, so a taller node design changes graph spacing. |
| `components/shared/branchPairs.ts` | `flowEdgeKind`, `scenarioEdgeKind`, `revertLoneBranchConnectors`, `incompleteBranchPairs`, `incompleteBranchPairMessage`, `flowEdgeToNormal`, `scenarioEdgeToNormal` | An **incomplete branch pair is a rendered warning state** on the canvas. |
| `components/shared/loopConnectorAuthoring.ts` | `defaultLoopCondition`, `defaultLoopConnectorConfig`, `defaultLoopConnectorStyle`, `loopConnectorDesignLabel`, `loopBackDesignLabel`, `defaultLoopExitCondition`, `promoteFlowLoopExits`, `promoteScenarioLoopExits` | Loop edge labels are **generated text**, not user strings — they must fit the label chip at any zoom. |
| `components/shared/nodeClipboard.ts` | `copyDesignerNode`, `readDesignerNode`, `isTextEditingTarget` | `isTextEditingTarget` is why canvas keyboard shortcuts don't fire inside inputs. |
| `components/table/tableState.ts` | `PAGE_SIZES = [10, 25, 50, 100]`, `applyTable`, `validateFilters`, `useTableState(key: "flows" \| "workflows")` | Table state is persisted per key, so a table reopens with the user's last sort/filter/page — **the filter chips are usually already populated on mount.** |

### Reporting helpers

| Module | Exports |
|---|---|
| `components/reports/statusTone.ts` | `statusToTone`, `formatDurationMs` (→ `"—"`, `"842 ms"`, `"3.4 s"`, `"2m 5s"`), `formatWhen` (→ `"—"` or `"Mar 4, 09:12"`) |
| `components/reports/useTelemetryQuery.ts` | `TelemetryQueryState<T> = { data, loading, error, refetch }`, `useTelemetryQuery<T>(fetcher, deps)` |
| `components/reports/useRuntimeStatus.ts` | polling hook, `intervalMs = 2000` |
| `components/reports/sampleReports.ts` | `sampleLogs`, `sampleConcurrentReport`, `preRunChecks` |

`"—"` (em dash) is the product's standard **no-value** glyph, produced by both formatters. It
appears throughout tables and metric cards and needs a deliberate muted treatment.

### Security and canvas plumbing

- `security/reasonMessages.ts` — `messageForReason` and
  `GENERIC_MESSAGE = "Something went wrong. Please contact your system administrator."`
  The deliberate catch-all: authentication failures do **not** explain themselves in detail.
- `security/usePermissions.ts:11` — `usePermissions()`, the hook behind every permission-disabled
  control described above.
- `components/canvas/renderProbe.ts`, `edgeLabelContext.ts`, `identityMap.ts` — engine internals
  (render verification, edge-label portalling, stable node identity).
- `components/data-binding/sampleData.ts` — preview fixtures for the binding editors.

---

## Component-count summary

| Group | Exported components |
|---|---|
| `layout/` | 8 |
| `components/shared/` | 24 |
| `components/reports/` | 11 |
| `components/table/` | 4 |
| `components/canvas/` | 10 |
| `components/workflow/` | 4 |
| `components/scenario/` | 1 |
| `components/data-binding/` | 6 |
| `components/instances/` | 5 |
| `components/auth/` | 1 |
| `security/` | 11 |
| `semantic/` | 1 |
| `pages/admin/components/` | 9 |
| `assets/brand/` | 3 |

Pages themselves (41 `.tsx` under `pages/`) are inventoried in
[`03-pages.md`](03-pages.md); the cross-cutting state, motion and accessibility rules these
components share are in [`05-patterns.md`](05-patterns.md).
