# File Spec — Form Designer and Shared Pages Polish

Project files to inspect and polish:

```text
app/renderer/pages/Dashboard.tsx
app/renderer/pages/WorkflowsLibrary.tsx
app/renderer/pages/FlowLibrary.tsx
app/renderer/pages/FormDesigner.tsx
app/renderer/pages/RuntimeInputPanel.tsx
app/renderer/pages/DataSourceManager.tsx
app/renderer/pages/DataSourceEditor.tsx
app/renderer/pages/Recorder.tsx
app/renderer/pages/SessionsManager.tsx
app/renderer/pages/InstanceMonitor.tsx
app/renderer/pages/ExecutionMonitor.tsx
app/renderer/pages/ReportsOverview.tsx
app/renderer/pages/ReportsWorkflows.tsx
app/renderer/pages/ReportsInstances.tsx
app/renderer/pages/ReportsChrome.tsx
app/renderer/pages/ReportsRuntime.tsx
app/renderer/pages/ReportsFailures.tsx
app/renderer/pages/ReportsServer.tsx
app/renderer/pages/ExecutionReports.tsx
app/renderer/pages/Settings.tsx
app/renderer/pages/ImplementationRoadmap.tsx
app/renderer/pages/ProjectContract.tsx
app/renderer/pages/OfflineRuntimeStatus.tsx
```

Shared components:

```text
app/renderer/components/shared/MetricCard.tsx
app/renderer/components/shared/StatusBadge.tsx
app/renderer/components/shared/EmptyState.tsx
app/renderer/components/shared/SkeletonCard.tsx
app/renderer/components/shared/Toast.tsx
```

## Goal

Every page should feel part of the same template system, not only the builder.

## Required visual changes

### Cards

- 18px radius.
- White surface.
- Soft shadow.
- 1px subtle border.
- Hover lift only for interactive cards.
- Compact metric hierarchy.

### Tables

- Rounded table container.
- Sticky or clear header if existing table is tall.
- Subtle row hover.
- Internal scroll for wide tables.
- No page-wide horizontal overflow.

### Forms

- Inputs/selects 42px high.
- 12px radius.
- Labels muted and compact.
- Focus ring violet.
- Textareas contained and resizable only vertically.

### Recorder

- URL/session controls must remain.
- Saved URL behavior must remain.
- Primary recording action is violet.
- Secondary controls are neutral pills.
- Long recorded steps list scrolls internally.

### Instances

- Instance cards use same card style.
- Live status dots and badges follow template styling.
- Long lists scroll internally.

### Reports

- Chart cards align with metric cards.
- No old flat borders/shadows.
- Loading/empty/error states are visually polished.
- Gauge/RPM cards keep visualization but use template surfaces.

### Settings

- Appearance select and dark toggle remain functional.
- Group cards match template panel style.
- Import/export sections do not overflow.

## Required overflow audit

For every page above, inspect and fix:

- horizontal scroll caused by fixed widths
- panels taller than viewport
- tables escaping cards
- drawer/forms causing body scroll
- chart SVG overflow
- long labels breaking layout

Use CSS patterns:

```css
min-width: 0;
overflow: hidden;
overflow-wrap: anywhere;
```

For scrollable containers:

```css
overflow: auto;
max-height: ...;
```

## Acceptance screenshots

Capture after screenshots:

```text
docs/ai/ui-reskin-template-plan/screenshots/after/dashboard.png
docs/ai/ui-reskin-template-plan/screenshots/after/recorder.png
docs/ai/ui-reskin-template-plan/screenshots/after/instances.png
docs/ai/ui-reskin-template-plan/screenshots/after/reports-overview.png
docs/ai/ui-reskin-template-plan/screenshots/after/settings.png
```

## Verify

```bash
npm run build
npm run verify:reports
npm run verify:instance-monitor
npm run verify:recorder
npm run verify:data-editor
```
