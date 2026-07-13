# File Spec — `app/renderer/styles/global.css`

This is the main design implementation file. Most visual missing work should happen here.

## Current evidence

GitHub review shows this file already contains AWKIT tokens and many selectors, but structural and visual gaps remain:

- `:root` token block exists.
- `.app-shell` currently uses row layout.
- `.top-header`, `.app-body`, `.left-navigation`, `.metric-card`, `.work-panel`, `.designer-layout`, `.designer-canvas`, `.properties-panel`, `.flow-node-palette`, `.react-flow-shell`, `.action-flow-node`, connector handles, etc. already exist.

## Required line-by-line changes

### 1. Add/complete template tokens near existing token block

Add these tokens under the existing light theme token section. Preserve existing token names, but add missing aliases so the rest of CSS can be explicit.

```css
:root,
[data-theme="light"] {
  --awkit-template-sidebar-width: 276px;
  --awkit-template-sidebar-collapsed-width: 76px;
  --awkit-template-header-height: 84px;
  --awkit-template-status-height: 28px;

  --awkit-app-bg: #f6f5f7;
  --awkit-sidebar-bg: #f7f7f8;
  --awkit-header-bg: #ffffff;
  --awkit-canvas-bg: #f3f2f4;
  --awkit-canvas-dot: rgba(32, 25, 44, 0.13);
  --awkit-card-bg: #ffffff;
  --awkit-drawer-bg: #ffffff;

  --awkit-template-border: #e8e6ea;
  --awkit-template-border-strong: #dad7df;

  --awkit-template-violet: #6b21c8;
  --awkit-template-violet-hover: #5818ad;
  --awkit-template-violet-soft: #f3ecff;
  --awkit-template-violet-fill: #f4efff;
  --awkit-template-violet-ring: #8b4ad8;

  --awkit-template-blue-chip: #d9efff;
  --awkit-template-blue-chip-text: #2874a6;

  --awkit-node-radius: 18px;
  --awkit-node-shadow: 0 2px 4px rgba(23, 17, 38, 0.04), 0 12px 34px rgba(23, 17, 38, 0.08);
  --awkit-node-shadow-hover: 0 6px 16px rgba(23, 17, 38, 0.08), 0 18px 48px rgba(23, 17, 38, 0.12);

  --awkit-drawer-width: 440px;
  --awkit-drawer-radius: 22px;
  --awkit-drawer-shadow: 0 12px 36px rgba(23, 17, 38, 0.12), 0 32px 80px rgba(23, 17, 38, 0.10);

  --awkit-motion-fast: 120ms;
  --awkit-motion-base: 180ms;
  --awkit-motion-panel: 240ms;
  --awkit-motion-ease: cubic-bezier(.2, .8, .2, 1);
}
```

For dark theme, map these aliases to existing dark tokens. Do not optimize dark mode at the expense of the light template target.

### 2. Replace `.app-shell`, `.app-body`, `.app-main`, `.main-surface`

Replace the current row-based shell styles with:

```css
.app-shell {
  background: var(--awkit-app-bg);
  color: var(--awkit-text);
  display: grid;
  grid-template-columns: var(--awkit-template-sidebar-width) minmax(0, 1fr);
  height: 100vh;
  min-width: 0;
  overflow: hidden;
}

.app-shell.sidebar-collapsed {
  grid-template-columns: var(--awkit-template-sidebar-collapsed-width) minmax(0, 1fr);
}

.app-main {
  display: grid;
  grid-template-rows: var(--awkit-template-header-height) minmax(0, 1fr) var(--awkit-template-status-height);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.main-surface {
  background: var(--awkit-app-bg);
  min-height: 0;
  min-width: 0;
  overflow: auto;
  position: relative;
}

.main-surface.main-surface-animated {
  animation: awkit-page-in var(--awkit-motion-panel) var(--awkit-motion-ease) both;
}

@keyframes awkit-page-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
```

Remove/disable old `.app-body` grid-column layout if `AppShell.tsx` no longer renders `.app-body`. If `.app-body` remains for compatibility, make it harmless:

```css
.app-body { min-width: 0; min-height: 0; }
.app-body.collapsed { min-width: 0; }
```

### 3. Sidebar template styles

Replace `.left-navigation` and children with template-aligned styles:

```css
.left-navigation {
  background: var(--awkit-sidebar-bg);
  border-right: 1px solid var(--awkit-template-border);
  display: grid;
  grid-template-rows: 86px minmax(0, 1fr) auto;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
}

.brand-block {
  align-items: center;
  border-bottom: 1px solid var(--awkit-template-border);
  display: flex;
  gap: 12px;
  padding: 0 22px;
}

.brand-mark {
  background: #08070a;
  border-radius: 7px;
  color: #fff;
  height: 28px;
  width: 28px;
  box-shadow: none;
}

.navigation-list {
  display: flex;
  flex-direction: column;
  gap: 22px;
  overflow: auto;
  padding: 26px 22px 14px;
}

.nav-group { gap: 6px; }

.nav-group-label {
  color: var(--awkit-text);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0;
  margin: 14px 0 6px;
  padding: 0;
  text-transform: none;
}

.nav-item {
  align-items: center;
  border-radius: 12px;
  color: var(--awkit-text-secondary);
  display: flex;
  gap: 12px;
  min-height: 38px;
  padding: 0 10px;
  transition: background var(--awkit-motion-fast) var(--awkit-motion-ease), color var(--awkit-motion-fast) var(--awkit-motion-ease), transform var(--awkit-motion-fast) var(--awkit-motion-ease);
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.72);
  color: var(--awkit-text);
  transform: translateX(2px);
}

.nav-item.active {
  background: transparent;
  color: var(--awkit-text);
  font-weight: 700;
}

.nav-item.active::after {
  background: var(--awkit-template-violet);
  border-radius: 999px;
  content: "";
  height: 6px;
  margin-left: auto;
  width: 6px;
}

.nav-footer {
  border-top: 1px solid var(--awkit-template-border);
  display: grid;
  gap: 10px;
  padding: 18px 22px 20px;
}
```

Collapsed state must remain functional:

```css
.left-navigation.collapsed {
  align-items: stretch;
}
.left-navigation.collapsed .brand-block,
.left-navigation.collapsed .navigation-list,
.left-navigation.collapsed .nav-footer {
  align-items: center;
  padding-left: 10px;
  padding-right: 10px;
}
.left-navigation.collapsed .nav-item {
  justify-content: center;
  padding: 0;
  width: 42px;
}
.left-navigation.collapsed .nav-item.active::after,
.left-navigation.collapsed .brand-name,
.left-navigation.collapsed .nav-group-label {
  display: none;
}
```

### 4. Header template styles

Replace/extend `.top-header`:

```css
.top-header {
  align-items: center;
  background: var(--awkit-header-bg);
  border-bottom: 1px solid var(--awkit-template-border);
  display: flex;
  gap: 16px;
  min-width: 0;
  padding: 0 18px 0 30px;
}

.header-title {
  align-items: center;
  display: flex;
  flex: 1;
  flex-direction: row;
  gap: 10px;
  min-width: 0;
}

.header-title strong {
  color: var(--awkit-text);
  font-size: 18px;
  letter-spacing: -0.01em;
}

.header-title span {
  color: var(--awkit-text-muted);
  font-size: 13px;
}

.header-status-chip,
.header-dirty-chip {
  align-items: center;
  background: var(--awkit-template-blue-chip);
  border-radius: 7px;
  color: var(--awkit-template-blue-chip-text);
  display: inline-flex;
  font-size: 13px;
  font-weight: 700;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
}

.header-dirty-chip {
  background: var(--awkit-template-violet-soft);
  color: var(--awkit-template-violet);
}

.header-actions {
  align-items: center;
  display: flex;
  gap: 10px;
}

.icon-button,
.toolbar-button {
  border-radius: 12px;
  min-height: 42px;
  transition: background var(--awkit-motion-fast) var(--awkit-motion-ease), box-shadow var(--awkit-motion-fast) var(--awkit-motion-ease), transform var(--awkit-motion-fast) var(--awkit-motion-ease);
}

.icon-button:hover,
.toolbar-button:hover {
  transform: translateY(-1px);
}

.toolbar-button.primary {
  background: linear-gradient(180deg, var(--awkit-template-violet), var(--awkit-template-violet-hover));
  border-color: var(--awkit-template-violet);
  box-shadow: 0 10px 24px rgba(107, 33, 200, 0.24);
}
```

### 5. Canvas layout and React Flow surfaces

Replace old boxed canvas assumptions:

```css
.designer-layout {
  background: var(--awkit-canvas-bg);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.designer-layout.flush-layout {
  display: block;
  min-height: 0;
}

.designer-canvas {
  background-color: var(--awkit-canvas-bg);
  background-image: radial-gradient(var(--awkit-canvas-dot) 1.2px, transparent 1.2px);
  background-size: 18px 18px;
  border: none;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  position: relative;
}

.designer-canvas.flush {
  padding: 0;
}

.react-flow-shell {
  height: 100%;
  margin: 0;
  min-height: 0;
  position: relative;
  width: 100%;
}

.react-flow__pane {
  cursor: grab;
}

.react-flow__pane:active {
  cursor: grabbing;
}
```

### 6. Floating drawer slot

Add:

```css
.designer-right-drawer-slot {
  bottom: 18px;
  pointer-events: none;
  position: absolute;
  right: 18px;
  top: 18px;
  width: min(var(--awkit-drawer-width), calc(100vw - var(--awkit-template-sidebar-width) - 56px));
  z-index: var(--awkit-z-drawer);
}

.designer-right-drawer-slot > * {
  pointer-events: auto;
}

.sidebar-collapsed .designer-right-drawer-slot {
  width: min(var(--awkit-drawer-width), calc(100vw - var(--awkit-template-sidebar-collapsed-width) - 56px));
}
```

### 7. Properties drawer styles

Replace `.properties-panel` styling with:

```css
.properties-panel {
  animation: awkit-drawer-in var(--awkit-motion-panel) var(--awkit-motion-ease) both;
  background: var(--awkit-drawer-bg);
  border: 1px solid var(--awkit-template-border);
  border-radius: var(--awkit-drawer-radius);
  box-shadow: var(--awkit-drawer-shadow);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  margin: 0;
  max-height: 100%;
  overflow: hidden;
  padding: 0;
}

@keyframes awkit-drawer-in {
  from { opacity: 0; transform: translateX(18px) scale(.985); }
  to { opacity: 1; transform: translateX(0) scale(1); }
}

.properties-heading {
  align-items: center;
  border-bottom: 1px solid var(--awkit-template-border);
  display: flex;
  gap: 12px;
  min-height: 74px;
  padding: 16px 18px 12px;
}

.properties-body {
  display: grid;
  gap: 16px;
  min-height: 0;
  overflow: auto;
  padding: 16px 18px 20px;
}

.properties-footer {
  background: linear-gradient(180deg, rgba(255,255,255,0.78), #fff 30%);
  border-top: 1px solid var(--awkit-template-border);
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr 1fr;
  padding: 14px 18px 18px;
}

.properties-tabs {
  border-bottom: 1px solid var(--awkit-template-border);
  display: flex;
  gap: 24px;
  padding: 0 18px;
}

.properties-tab {
  background: transparent;
  border: none;
  border-radius: 0;
  color: var(--awkit-text-secondary);
  height: 42px;
  position: relative;
}

.properties-tab.active {
  color: var(--awkit-text);
  font-weight: 700;
}

.properties-tab.active::after {
  background: var(--awkit-template-violet);
  border-radius: 999px 999px 0 0;
  bottom: -1px;
  content: "";
  height: 3px;
  left: 0;
  position: absolute;
  right: 0;
}
```

Collapsed rail:

```css
.properties-panel.collapsed {
  align-items: center;
  display: flex;
  gap: 12px;
  height: auto;
  min-height: 220px;
  padding: 14px 8px;
  width: 48px;
}
```

### 8. Node palette and overflow

```css
.flow-node-palette {
  animation: awkit-panel-in var(--awkit-motion-panel) var(--awkit-motion-ease) both;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid var(--awkit-template-border);
  border-radius: 18px;
  box-shadow: 0 12px 36px rgba(23, 17, 38, 0.10);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  left: 18px;
  max-height: calc(100% - 36px);
  overflow: hidden;
  padding: 14px;
  position: absolute;
  top: 18px;
  width: 260px;
  z-index: var(--awkit-z-panel);
}

.palette-scroll {
  display: grid;
  gap: 8px;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.flow-node-palette button {
  border-radius: 13px;
  min-height: 54px;
  transition: background var(--awkit-motion-fast) var(--awkit-motion-ease), border-color var(--awkit-motion-fast) var(--awkit-motion-ease), transform var(--awkit-motion-fast) var(--awkit-motion-ease), box-shadow var(--awkit-motion-fast) var(--awkit-motion-ease);
}

.flow-node-palette button:hover {
  box-shadow: 0 8px 22px rgba(23, 17, 38, 0.08);
  transform: translateY(-1px);
}
```

### 9. Node card styles

```css
.action-flow-node {
  align-items: center;
  background: var(--awkit-card-bg);
  border: 1px solid var(--awkit-template-border);
  border-radius: var(--awkit-node-radius);
  box-shadow: var(--awkit-node-shadow);
  display: grid;
  gap: 12px;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  min-height: 78px;
  overflow: visible;
  padding: 14px 16px;
  position: relative;
  transition: background var(--awkit-motion-base) var(--awkit-motion-ease), border-color var(--awkit-motion-base) var(--awkit-motion-ease), box-shadow var(--awkit-motion-base) var(--awkit-motion-ease), transform var(--awkit-motion-fast) var(--awkit-motion-ease);
}

.action-flow-node:hover {
  box-shadow: var(--awkit-node-shadow-hover);
  transform: translateY(-2px);
}

.action-flow-node.selected {
  background: var(--awkit-template-violet-fill);
  border-color: var(--awkit-template-violet-ring);
  box-shadow: 0 0 0 2px rgba(139, 74, 216, 0.18), var(--awkit-node-shadow-hover);
}

.action-node-icon {
  background: #f5f2f8;
  border-radius: 12px;
  color: var(--awkit-template-violet);
  height: 38px;
  width: 38px;
}

.action-node-meta {
  align-items: center;
  color: var(--awkit-text-muted);
  display: flex;
  font-size: 13px;
  gap: 6px;
}

.action-node-index {
  background: #efedf3;
  border-radius: 6px;
  color: var(--awkit-text-muted);
  font-size: 11px;
  font-weight: 700;
  padding: 1px 5px;
}

.action-node-title {
  color: var(--awkit-text);
  font-size: 15px;
  font-weight: 700;
}

.action-node-menu {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--awkit-text);
  display: inline-flex;
  height: 30px;
  justify-content: center;
  width: 30px;
}

.action-node-menu:hover {
  background: rgba(23, 17, 38, 0.06);
}
```

### 10. Connector styles

```css
.react-flow__edge-path {
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: stroke var(--awkit-motion-fast) var(--awkit-motion-ease), stroke-width var(--awkit-motion-fast) var(--awkit-motion-ease), filter var(--awkit-motion-fast) var(--awkit-motion-ease);
}

.react-flow__edge:hover .react-flow__edge-path,
.react-flow__edge.selected .react-flow__edge-path {
  filter: drop-shadow(0 2px 5px rgba(107, 33, 200, 0.28));
  stroke-width: 2.5px;
}

.template-edge-label {
  background: rgba(243, 242, 244, 0.92);
  border: 1px solid var(--awkit-template-border);
  border-radius: 999px;
  color: var(--awkit-text-muted);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  pointer-events: all;
  user-select: none;
}

.template-edge-add-button {
  align-items: center;
  background: var(--awkit-template-violet);
  border: 2px solid #fff;
  border-radius: 999px;
  box-shadow: 0 6px 14px rgba(107, 33, 200, 0.28);
  color: #fff;
  display: flex;
  height: 24px;
  justify-content: center;
  pointer-events: all;
  width: 24px;
}

.template-edge-add-button:hover {
  background: var(--awkit-template-violet-hover);
  transform: scale(1.05);
}

.react-flow__edge.animated .react-flow__edge-path {
  animation: awkit-edge-flow 700ms linear infinite;
  stroke-dasharray: 8 6;
}

@keyframes awkit-edge-flow {
  to { stroke-dashoffset: -14; }
}
```

### 11. Zoom pill

```css
.canvas-zoom-control {
  align-items: center;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid var(--awkit-template-border);
  border-radius: 16px;
  box-shadow: 0 12px 32px rgba(23, 17, 38, 0.12);
  display: flex;
  gap: 4px;
  padding: 8px;
}

.canvas-zoom-control button {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: 10px;
  color: var(--awkit-text);
  display: flex;
  height: 36px;
  justify-content: center;
  min-width: 36px;
  transition: background var(--awkit-motion-fast) var(--awkit-motion-ease), transform var(--awkit-motion-fast) var(--awkit-motion-ease);
}

.canvas-zoom-control button:hover {
  background: rgba(23, 17, 38, 0.06);
  transform: translateY(-1px);
}

.canvas-zoom-control .zoom-value {
  font-weight: 700;
  min-width: 58px;
}
```

### 12. Forms/tables/cards shared polish

```css
.metric-card,
.work-panel,
.report-card,
.instance-card {
  border-radius: 18px;
  transition: box-shadow var(--awkit-motion-base) var(--awkit-motion-ease), transform var(--awkit-motion-fast) var(--awkit-motion-ease);
}

.metric-card:hover,
.work-panel:hover,
.report-card:hover,
.instance-card:hover {
  box-shadow: var(--awkit-node-shadow-hover);
  transform: translateY(-2px);
}

input,
select,
textarea {
  border-radius: 12px;
  min-height: 42px;
}

textarea {
  min-height: 96px;
  resize: vertical;
}

.table-wrap,
.data-table-shell {
  overflow: auto;
  border-radius: 16px;
}
```

### 13. Reduced motion

Append/update:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Verification

After this file changes, run:

```bash
npm run build
npm run verify:flow-designer
npm run verify:workflow-builder
npm run verify:reports
```
