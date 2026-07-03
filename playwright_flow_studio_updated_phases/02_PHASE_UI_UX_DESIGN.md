# Phase 2 — UI/UX Design

## Objective

Design the Windows app as a professional enterprise workflow and form designer, similar to the provided reference screenshots.

## Main Layout

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Top Header: Back, Title, Save, Validate, Run, Run Concurrent, Help   │
├──────────────────┬──────────────────────────────────┬────────────────┤
│ Left Navigation  │ Main Designer Canvas             │ Properties     │
├──────────────────┴──────────────────────────────────┴────────────────┤
│ Status Bar: Offline Ready, Active Instances, Queue, Last Error       │
└──────────────────────────────────────────────────────────────────────┘
```

## Required Screens

```text
Dashboard
Workflow Designer
Flow Chart Designer
Form Designer
Scenario Builder
Flow Library
Runtime Input Panel
Data Source Manager
Instance Monitor
Execution Monitor
Execution Reports
Offline Runtime Status
Settings
```

## Workflow Designer Style

```text
White canvas
Light gray panels
Blue accent color
Soft shadows
Rounded nodes
Curved arrows
Stage number badges
Colored status borders
Zoom / pan / fit-to-screen
Mini map
```

## Form Designer Style

The form designer should include:

```text
Left element palette
Main form canvas
Sections and drop zones
Input fields
Dropdowns
Checkboxes
Radio buttons
File uploaders
Right-side field configuration
```

## Concurrent Instance Monitor

Add a real-time monitor for concurrent UI automation runs.

Display:

```text
Instance Name
Browser
Headless/Headed
Isolation Mode
Scenario
Current Flow
Current Step
Data Row
Status
Duration
Queue Position
Pause / Resume / Stop
Open Logs
Open Screenshot
Open Report
```

## Concurrent Run Toolbar

```text
Max Parallel Instances
Run Count
Isolation Mode
Browser Window Mode
Start All
Pause All
Resume All
Stop All
Clear Completed
```

## Browser Window Modes for Headed Runs

```text
Tile windows
Cascade windows
Minimize all
Show active instance only
Run all headless
```

## Offline Runtime Status Screen

Show:

```text
Production offline mode: enabled/disabled
Internet required: no
Bundled browser: found/missing
Playwright runtime: found/missing
Native modules: found/missing
Writable user data folder: yes/no
Dependency manifest: valid/invalid
```

## Deliverables

- App shell.
- Workflow chart screen.
- Form designer screen.
- Properties panel.
- Runtime input screen.
- Concurrent instance monitor.
- Offline runtime status screen.
