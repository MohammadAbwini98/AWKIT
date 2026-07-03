# Playwright Flow Studio — Updated System Structure & Phased Design

## Purpose

**Playwright Flow Studio** is a Windows desktop application for visually building and running Playwright-based web UI automation. Users draw flows, configure events, bind input data, link flows into scenarios, and execute them through a generic Playwright runner instead of writing repeated code for each scenario.

## Newly Added Critical Requirements

### 1. Multiple concurrent UI automation instances

The system must run multiple Playwright UI automation sessions at the same time. Each instance must be isolated by browser context or persistent profile, runtime inputs, data row, environment variables, logs, screenshots, downloads, and execution state.

### 2. Offline standalone production mode

Development machines have internet, but production machines do not. The production build must include all runtime dependencies and browser binaries, must not download anything at runtime, must not require `npm install`, and must not require admin permission.

## Main Architecture

```text
Windows Desktop Application
   ↓
Workflow / Form Designer UI
   ↓
Flow Profiles + Scenario Profiles
   ↓
Runtime Inputs + JSON Data Sources
   ↓
Scenario Orchestrator
   ↓
Concurrent Instance Manager
   ↓
Runner Worker Pool
   ↓
Bundled Playwright Browser Runtime
   ↓
Logs / Screenshots / Downloads / Reports
```

## Technology Stack

```text
Desktop App: Electron
Frontend: React + TypeScript
Workflow Canvas: React Flow
Drag & Drop: dnd-kit
UI Components: Radix UI or shadcn/ui
Icons: Lucide React
Styling: Tailwind CSS
Automation: Playwright
Runtime: Node.js inside Electron
Storage: SQLite + JSON import/export
Configuration: .env files and runtime profiles
Production: Offline standalone portable/per-user Windows package
```

## Offline Production Rules

Production must not depend on:

```text
Internet access
npm install
npx playwright install
Global Node.js
Global Playwright
Global Chromium
Admin permission
Writing to Program Files
```

Production must include:

```text
Electron application bundle
Compiled renderer and main process
Production node_modules/native modules
Bundled Chromium browser
Playwright runtime files
Sample flows/scenarios/data
Dependency manifest
Offline startup validator
```

## Updated Phase Files

```text
00_README_OVERVIEW.md
01_PHASE_ARCHITECTURE_AND_PROJECT_STRUCTURE.md
02_PHASE_UI_UX_DESIGN.md
03_PHASE_FLOW_DESIGNER_AND_NODE_MODEL.md
04_PHASE_SCENARIO_ORCHESTRATION_AND_FLOW_LINKING.md
05_PHASE_DATA_BINDING_AND_RUNTIME_INPUTS.md
06_PHASE_CONCURRENT_UI_AUTOMATION_INSTANCES.md
07_PHASE_PLAYWRIGHT_RUNNER_ENGINE.md
08_PHASE_OFFLINE_STANDALONE_PACKAGING.md
09_PHASE_REPORTING_LOGGING_AND_SECURITY.md
10_PHASE_IMPLEMENTATION_ROADMAP.md
11_MASTER_CLAUDE_CODEX_PROMPT.md
12_OFFLINE_DEPENDENCY_MANIFEST_TEMPLATE.md
```
