# Codex Prompt — Review AWTKIT Project and Fix UI / Functional Issues

You are an expert **Electron, React, TypeScript, Playwright, UI/UX, and desktop application engineer**.

You are working inside the **AWTKIT / Playwright Flow Studio** codebase.

Your task is to review the project first, understand its architecture, then fix the UI and functional issues listed below. Do not only apply visual patches. Fix the underlying state, routing, persistence, IPC wiring, layout, and event-handling problems where needed.

---

## 1. Read Project Instructions First

Before making any code changes, inspect and understand the project guidance files.

Start by reading:

```text
AGENTS.md
README.md
CLAUDE.md
GEMINI.md
package.json
```

If some files do not exist, continue with the available files.

Use `AGENTS.md` as the main project guidance file because it may explain the project structure, coding rules, architecture decisions, and expected behavior.

---

## 2. Review the Codebase Before Fixing

Inspect the full project structure, especially:

```text
app/main/
app/main/ipc/
app/renderer/
app/renderer/pages/
app/renderer/layout/
app/renderer/components/
app/renderer/stores/
src/runner/
src/orchestrator/
src/instances/
src/profiles/
src/data/
src/storage/
src/reports/
src/offline/
```

Understand how these areas currently work:

```text
Electron main process
Renderer React app
Routing/navigation
Application shell
Sidebar/header layout
Flow Designer
Workflow / Scenario Builder
Runtime Inputs
Data Source Manager
Instances page
Execution Monitor
Stores/state management
IPC handlers
Persistence layer
Playwright runner integration
```

After reviewing, create a short implementation plan, then start fixing.

---

# Main Objective

Make the application behave like a professional Windows desktop workflow automation builder.

It must be:

```text
Clean
Responsive
Persistent
Functional
Offline-safe
Easy to understand
Easy to maintain
```

The UI should not look like a static prototype. Every visible active button and field should either work correctly or be disabled with a clear explanation.

---

# Issues to Fix

## Issue 1 — General UI Design and Alignment

The current UI has many alignment and layout issues.

Fix:

```text
Panels not aligned
Cards/components not aligned
Inconsistent spacing
Components overflowing
Fields/buttons outside visible frame
Broken scroll areas
Layouts that do not fit smaller or larger screens
Pages that look inconsistent with each other
```

Requirements:

```text
Create a consistent application shell
Use a clear layout structure
Use consistent spacing, padding, border radius, typography, and button sizes
Avoid accidental horizontal overflow
Make panels use available height correctly
Make all screens visually consistent
```

Recommended layout:

```text
Header
Collapsible sidebar
Main content area
Optional right properties panel
Optional page-specific action bar
```

Acceptance criteria:

```text
No panel/component appears misaligned
No important UI element is out of frame
Main pages are visually consistent
Application is usable on common laptop and desktop screen sizes
```

---

## Issue 2 — Sidebar Collapse and Expand

Add a fully functional sidebar collapse/expand feature.

Requirements:

```text
Sidebar supports expanded and collapsed modes
Expanded mode shows icon + label
Collapsed mode shows icons only
Add clear toggle button
Persist collapsed/expanded state across app restarts
Main content resizes automatically when sidebar changes
Tooltips appear for collapsed menu icons
```

Acceptance criteria:

```text
User can collapse and expand sidebar
Main content gets more horizontal space when sidebar is collapsed
Sidebar state is restored after restarting the app
```

---

## Issue 3 — Make All Buttons and Fields Functional

Review every:

```text
button
dropdown
input
tab
file picker
save button
load button
export button
run button
back button
action button
```

Fix anything that is currently non-functional or misleading.

Requirements:

```text
Buttons must perform the expected action or be visibly disabled
Disabled buttons must have a tooltip/reason
Remove useless buttons
Do not leave fake/demo buttons active
All forms must update real state
Save actions must persist data
Load actions must restore saved data
Export actions must write a file
Browse buttons must open native file picker dialogs
Back button must navigate correctly
```

Acceptance criteria:

```text
No active button does nothing
All inputs are connected to state
All save/load/export actions work
Disabled future features are clearly marked
```

---

## Issue 4 — Responsive UI for All Screen Sizes

Make the UI responsive.

Requirements:

```text
Support common laptop and desktop screen sizes
Use flexible layouts instead of inappropriate fixed widths
Panels scroll internally when content is long
Node Palette must not overflow
Node Properties must not overflow
Runtime Inputs and Data Source screens must fit available space
Instances page must be usable with many instance rows/cards
Tables should have controlled scrolling
Designer canvas should take available space and support pan/zoom
```

Acceptance criteria:

```text
No content is cut off on smaller screens
No form fields or buttons appear outside the frame
User can scroll where needed
Canvas and side panels fit correctly
```

---

## Issue 5 — Persist All Screens and Filled Data

All filled data and screen state should be saved and restored.

Persist:

```text
Sidebar collapsed/expanded state
Last selected page if appropriate
Flow Designer nodes and edges
Node properties
Workflow/Scenario Builder selected flows and order
Runtime Inputs values
Data Source Manager selected files and bindings
Instances page selected workflow
Instances page number of runs
Instances page concurrency count
Instances page headless/headed setting
User-created flows
User-created workflows
Data source profiles
Runtime input profiles
```

Use the existing project persistence approach if it is already available. If it is incomplete, implement a clean local persistence layer.

Recommended storage:

```text
UI settings: local storage or app config file
Profiles/data: JSON files or SQLite under user data folder
Runtime files: under Electron app userData path
```

Do not write runtime state into source files.

Acceptance criteria:

```text
User can move between screens without losing filled values
Closing and reopening the app restores saved configuration
Saved workflows/flows/data sources are listed correctly
```

---

## Issue 6 — Instances Page Functional Workflow Runner

The Instances page must allow users to run one of the existing saved workflows.

Requirements:

Add or fix controls for:

```text
Select workflow from existing saved workflows
Number of total runs
Number of concurrent instances
Run type: Headless or Headed
Optional delay between instance starts
Start selected workflow
Pause instance
Resume instance
Stop instance
Stop all
Show current status for each instance
Show current workflow/flow/step when execution integration exists
Show logs/report link when available
```

Validation rules:

```text
Workflow must be selected before run
Number of total runs must be greater than 0
Number of concurrent instances must be greater than 0
Concurrent instances cannot exceed total runs
Show validation errors clearly
```

Acceptance criteria:

```text
User can choose a saved workflow
User can set total runs and concurrent instances
User can choose headed/headless mode
Start button calls the correct workflow execution path
Instance state is visible and updated
```

---

## Issue 7 — Node Palette and Node Properties Scroll Behavior

Fix `Node Palette` and `Node Properties`.

Requirements:

```text
Node Palette must be scrollable
All node types must stay contained inside the palette panel
Node Properties must be scrollable
Long property forms must not overflow
```

Group properties clearly:

```text
Basic
Locator
Data Binding
Execution
Advanced
```

Advanced fields should be collapsible.

Acceptance criteria:

```text
All palette items are reachable
All node property fields are reachable
No property form goes outside the frame
User can edit node configuration comfortably
```

---

## Issue 8 — Runtime Inputs and Data Source Manager

The `Browse` button is not working, and the binding process is unclear.

Fix both pages.

### Runtime Inputs Requirements

Allow the user to create/edit runtime input definitions.

Supported input types:

```text
text
number
dropdown
checkbox
file path
password/secret
```

Each runtime input should support:

```text
key
label
type
default value
required flag
options for dropdown
secret flag where applicable
```

Runtime input profiles and user values should be saved and persistent.

### Data Source Manager Requirements

Fix and implement:

```text
Browse button opens native file picker
User can select JSON file
Application validates JSON
Application saves data source profile
Application displays JSON tree or selectable JSON path list
User can copy/select JSON paths
Application previews selected path value
Friendly validation errors
```

Data source profile should store:

```text
name
file path or copied local data-source path
type
created date
updated date
```

### Binding UX Requirements

Make binding simple in Node Properties.

When value source is JSON:

```text
Select data source from dropdown
Select JSON path from dropdown/tree
Show preview value
```

When value source is Runtime Input:

```text
Select runtime input key from dropdown
Show current/default value
```

Acceptance criteria:

```text
Browse works
JSON file is loaded and validated
JSON paths are discoverable
Binding a field to JSON is understandable to a normal user
Binding a dropdown to runtime input is simple
```

---

## Issue 9 — Flow Designer Connections Must Be Editable

Connections between nodes are not editable.

Fix Flow Designer connection management.

Requirements:

```text
User can create connection between nodes
User can click/select an existing connection
User can edit connection properties
User can delete connection
User can reconnect/change source or target if supported
Connection changes must persist
Connections must be validated
Invalid graph should show clear errors
```

Connection properties:

```text
type: success, failure, always, conditional, manual approval, loop
label
condition expression for conditional type
priority/order if needed
```

UX requirements:

```text
When a connection is selected, show properties in the right panel
Use colors or labels for connection types
Add edge labels where useful
Confirm destructive delete if needed
```

Acceptance criteria:

```text
Connections are editable
Connection edits are saved
Reloading the flow restores edited connections
Invalid connections are blocked or clearly reported
```

---

## Issue 10 — Header Bar Cleanup

The application header currently contains useless buttons such as workspace or other unused actions.

Fix:

```text
Remove useless header buttons
Keep only useful global/page actions
Do not show unavailable actions as active buttons
Use page-specific actions instead of fake global actions
```

Recommended header:

```text
Back button
Current page/title
Save when page supports save
Validate when page supports validate
Run when page supports run
Help if useful
```

Acceptance criteria:

```text
Header is clean
No useless buttons remain
Header actions are relevant to the current page
```

---

## Issue 11 — Header Back Button Not Working

Fix the back button.

Requirements:

```text
Back button navigates to app history when available
If no history exists, go to Dashboard
Back button should not break state
Back button should not lose unsaved changes without warning
If current page has unsaved changes, prompt before leaving
```

Acceptance criteria:

```text
Back button works from every page
Back button behavior is predictable
Unsaved changes are protected
```

---

# Required Architecture Improvements

## 1. Do Not Break Existing Architecture

Before major changes:

```text
Identify current routing
Identify state management approach
Identify persistence layer
Identify IPC pattern
Reuse existing patterns where reasonable
Refactor only when current implementation is incomplete or broken
```

## 2. Reusable Components to Create or Fix

Create/fix reusable components as needed:

```text
AppShell
CollapsibleSidebar
PageHeader
PageActions
ScrollablePanel
PropertiesPanel
FormField
JsonPathPicker
DataSourcePicker
RuntimeInputPicker
WorkflowSelector
ConnectionPropertiesPanel
ConfirmLeaveDialog
```

## 3. Persistence Layer

Implement/fix persistence for:

```text
UI settings
flows
workflows
runtime inputs
data sources
instance run settings
```

Storage must be local and offline-safe.

Recommended base path:

```text
Electron app.getPath("userData")
```

Avoid writing to source folders during runtime.

## 4. IPC Requirements

If IPC is incomplete, implement channels for:

```text
settings:get
settings:update

flows:list
flows:get
flows:create
flows:update
flows:delete
flows:export
flows:import

workflows:list
workflows:get
workflows:create
workflows:update
workflows:delete
workflows:export
workflows:import

dataSources:list
dataSources:create
dataSources:update
dataSources:delete
dataSources:browseJson
dataSources:preview
dataSources:getJsonPaths

runtimeInputs:list
runtimeInputs:create
runtimeInputs:update
runtimeInputs:delete

execution:validateWorkflowRun
execution:runWorkflow
execution:pauseInstance
execution:resumeInstance
execution:stopInstance
execution:stopAll

reports:list
reports:get
```

## 5. Validation

Add validation messages for:

```text
Missing workflow selection
Invalid JSON file
Missing JSON path
Missing runtime input key
Invalid connection
Missing required node config
Invalid concurrency settings
Unsaved changes before navigation
```

---

# Manual Verification Checklist

After fixing, manually verify:

```text
Sidebar collapses and expands
Sidebar state persists after restart
Header back button works
Header useless buttons removed
Browse button opens file picker
JSON file loads and validates
JSON path preview works
Node Palette scrolls
Node Properties scrolls
Flow connections can be edited and saved
Workflow/Scenario data persists after navigating away
Instances page can select existing workflow
Instances page can set total runs and concurrent instances
Instances page can select headed/headless mode
Start button calls workflow execution path
UI fits small and large windows
No active button does nothing
```

---

# Commands to Run

Inspect `package.json` first, then run the available equivalents of:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If a script does not exist, do not invent it. Use the closest existing script and document what you ran.

---

# Deliverables in Final Response

When finished, provide:

```text
1. Summary of project files reviewed
2. Short explanation of root causes found
3. Files changed
4. Fixes implemented
5. Persistence changes made
6. IPC changes made
7. Commands executed and results
8. Manual verification checklist results
9. Remaining limitations or TODOs, if any
```

Start by reading `AGENTS.md`, then inspect the current implementation, then fix the issues above.
