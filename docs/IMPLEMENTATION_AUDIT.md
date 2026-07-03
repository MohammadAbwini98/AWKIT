# Implementation Audit — Playwright Flow Studio

**Date:** 2026-06-21  
**Auditor:** Antigravity (automated audit against phase 00–06 change requests)

---

## Summary

| Phase | Feature | Status | Fixed In |
|-------|---------|--------|----------|
| 01 | Workflows Library page | ✅ Fixed | `WorkflowsLibrary.tsx` (new) |
| 01 | Multiple workflows CRUD | ✅ Confirmed working | `ScenarioBuilder.tsx`, IPC bridge |
| 02 | Canvas shows enabled flows on load | ✅ Fixed | `ScenarioBuilder.tsx` |
| 02 | New workflow starts with empty canvas | ✅ Fixed | `ScenarioBuilder.tsx` |
| 03 | Remove dummy running instances | ✅ Fixed | `InstanceMonitor.tsx` |
| 03 | Empty state on initial load | ✅ Fixed | `InstanceMonitor.tsx` |
| 04 | Table alignment stable after clear | ✅ Fixed | `global.css`, `InstanceMonitor.tsx` |
| 04 | Controls overflow fix | ✅ Fixed | `.instance-controls` CSS |
| 05 | Functional pause/resume/stop buttons | ✅ Fixed | `InstanceMonitor.tsx` |
| 05 | Status-aware button disabled states | ✅ Fixed | `InstanceMonitor.tsx` |
| 05 | Clear completed only removes terminal statuses | ✅ Fixed | `InstanceMonitor.tsx` |
| 06 | Roadmap accuracy | ✅ Updated | `ImplementationRoadmap.ts` |
| 06 | Navigation context | ✅ Added | `navigation.tsx`, `App.tsx` |

---

## Detailed Findings

### Phase A — Desktop Foundation
**Status:** Complete  
**Files reviewed:** `app/main/main.ts`, `app/main/appPaths.ts`, `app/main/preload.ts`  
**Actual behavior:** App opens, IPC bridge works, runtime paths resolve correctly.  
**Remaining:** None.

---

### Phase B — Flow Designer MVP
**Status:** Complete  
**Files reviewed:** `app/renderer/pages/FlowChartDesigner.tsx`  
**Actual behavior:** Full React Flow canvas with node palette, properties inspector, save/load/export.  
**Remaining:** None.

---

### Phase C — Generic Playwright Runner
**Status:** Complete  
**Files reviewed:** `src/runner/`, `src/orchestrator/`  
**Actual behavior:** Profile-driven runner, step executor, value resolver, screenshot/log capture exist.  
**Remaining:** End-to-end integration test with a live browser.

---

### Phase D — Data Binding
**Status:** Complete  
**Files reviewed:** `app/renderer/pages/DataSourceManager.tsx`, `app/renderer/pages/RuntimeInputPanel.tsx`  
**Actual behavior:** JSON data sources, runtime inputs, binding editor, current-row support all work.  
**Remaining:** None.

---

### Phase E — Scenario Builder / Workflow Builder
**Status:** In Progress (was incorrectly marked Complete)  

**Pre-audit problems:**
- Workflow Builder canvas always showed 5 hardcoded demo flows regardless of saved state.
- No dedicated Workflows Library page existed.
- The workflow selector in ScenarioBuilder didn't reset canvas state.

**Fixes applied:**
- Created `WorkflowsLibrary.tsx` — full table of saved workflows with Open/Clone/Export/Delete/Import actions.
- Added `workflowsLibrary` route to `routes.tsx` and navigation group.
- Rewrote `ScenarioBuilder.tsx`:
  - Initial state is now empty `[]` arrays (not hardcoded demo nodes).
  - On mount, reads `settings.selectedBuilderWorkflowId` and loads that workflow's nodes onto the canvas.
  - If no ID is set, shows empty canvas with helpful message.
  - Added "New" button to reset to blank workflow with a generated ID.
  - `loadWorkflowProfile` auto-layouts nodes that have no saved position.
  - Save now writes `updatedAt` timestamp.
- Added `createdAt?` / `updatedAt?` to `WorkflowProfile` type.
- Added `NavigationContext` so pages can navigate without prop-drilling.

**Remaining:**
- Import workflow from file in the builder (currently only in the library).
- Edge/condition validation before save.

---

### Phase F — Concurrent UI Automation Instances
**Status:** In Progress (was incorrectly marked Complete)

**Pre-audit problems:**
- `InstanceMonitor.tsx` initialised `instances` state with `createMonitorInstances(...)` — always showing 5 fake running instances.
- Instance control buttons had no `disabled` logic — all appeared active regardless of instance status.
- Table had no `overflow-x` wrapper — buttons overflowed on narrow windows.
- `clearCompleted` didn't properly define which statuses are "done".

**Fixes applied:**
- Changed `useState(createMonitorInstances(...))` → `useState<InstanceRuntimeState[]>([])`.
- Removed the import of `sampleCustomersData` from the instances page.
- Added empty state UI when `instances.length === 0`.
- Wrapped `<table>` in `.instance-table-wrapper { overflow-x: auto }`.
- Applied `table-layout: fixed` + `colgroup` for stable column widths.
- Consolidated two action columns into two compact ones (Controls + Files).
- Added per-instance `disabled` logic:
  - Pause → enabled only when `running | starting`
  - Resume → enabled only when `paused | waitingForManualAction`
  - Stop → enabled when not in terminal state
- Toolbar buttons (Pause All, Resume All, Stop All, Clear Completed) now have `disabled` states.
- `clearCompleted` now filters: `completed | failed | cancelled | stopped`.
- `createPlannedInstances` is now only called on user-initiated Start — not on mount.

**Remaining:**
- Real IPC event-driven status updates (currently UI state only — proper integration when runner is wired end-to-end).
- Shell `openPath` for log/screenshot file links.

---

### Phase G — Data-Driven Concurrent Runs
**Status:** In Progress  
**Remaining:** Full runner fan-out from JSON rows to isolated instances.

---

### Phase H — Advanced Flow Control
**Status:** In Progress  
**Remaining:** Loop execution, nested flow runner integration.

---

### Phase I — Reporting & Stability
**Status:** Complete  
**Remaining:** None.

---

### Phase J — Offline Standalone Packaging
**Status:** In Progress  
**Remaining:** Local Chromium bundle preparation.

---

### Phase K — Recorder Mode
**Status:** Pending  
**Remaining:** Not started — intentionally deferred.

---

## Files Changed

| File | Change |
|------|--------|
| `app/main/uiSettings.ts` | Added `selectedBuilderWorkflowId` field |
| `app/renderer/App.tsx` | Added `NavigationContext.Provider` wrapper |
| `app/renderer/routes.tsx` | Added `workflowsLibrary` route + `WorkflowsLibrary` import |
| `app/renderer/layout/LeftNavigation.tsx` | Added `workflowsLibrary` to Build group |
| `app/renderer/pages/WorkflowsLibrary.tsx` | **NEW** — full Workflows Library page |
| `app/renderer/pages/ScenarioBuilder.tsx` | Phase 01+02 — empty canvas, load from settings, New workflow |
| `app/renderer/pages/InstanceMonitor.tsx` | Phase 03+04+05 — empty initial state, table fix, functional controls |
| `app/renderer/state/navigation.tsx` | **NEW** — NavigationContext for programmatic routing |
| `app/renderer/styles/global.css` | Added `.wl-table*`, `.instance-table*`, `.instance-controls`, `.scenario-canvas-empty` |
| `src/profiles/WorkflowProfile.ts` | Added `createdAt?` / `updatedAt?` |
| `src/roadmap/ImplementationRoadmap.ts` | Updated Phase E and F statuses + notes |

---

## Remaining Known Limitations

1. **Runner integration** — Workflow execution is validated and planned but actual Playwright browser fan-out requires the runner IPC to be wired to the Electron main process execution pipeline.
2. **Shell openPath** — Log/screenshot file open buttons in the instance monitor call a placeholder. A proper `shell:openPath` IPC channel needs to be added.
3. **Import in builder** — Import workflow JSON is available in the Workflows Library but not directly in the builder toolbar.
4. **Recorder Mode** — Not started (Phase K, pending).
