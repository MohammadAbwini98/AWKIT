# Master Prompt — Build Playwright Flow Studio

You are an expert TypeScript, Electron, React, and Playwright automation engineer.

Build a Windows desktop application called **Playwright Flow Studio**.

## Main Goal

Create a no-code / low-code Windows application for authorized web UI automation using Playwright.

The app must allow users to:

- Draw automation flows visually.
- Add events such as click, fill text, dropdown select, checkbox, radio button, upload, download, scroll, wait, screenshot, and assertions.
- Configure locators.
- Fill input fields from JSON files.
- Select dropdown values from the Windows runtime UI.
- Save reusable flow profiles.
- Link flows into scenario profiles.
- Determine flow order visually.
- Run multiple isolated UI automation instances concurrently.
- Run data-driven concurrent batches from JSON rows.
- Monitor execution in real time.
- Generate logs, screenshots, and reports.
- Run in production as a standalone offline Windows app with no internet and no admin permission.

## Technology Stack

Use Electron, React, TypeScript, React Flow, dnd-kit, Tailwind CSS, Lucide React, Radix UI or shadcn/ui, Playwright, Node.js inside Electron, SQLite or JSON storage, and dotenv.

## Critical Production Requirement

Development has internet. Production has no internet.

The final production app must:

```text
Run without internet
Run without npm install
Run without admin permission
Run without downloading Playwright browsers
Run without global Node.js
Run without global Playwright
Run without global Chromium
Bundle all dependencies
Bundle Chromium browser binaries
Store runtime data under user profile
Support portable app or per-user installer
```

## Required Architecture Modules

```text
app/main IPC layer
app/renderer UI
src/runner
src/orchestrator
src/instances
src/profiles
src/data
src/offline
src/reports
src/storage
src/utils
scripts for offline packaging
vendor for bundled dependencies
resources for bundled browser/runtime assets
```

## Concurrent UI Automation

Implement:

```text
InstanceManager
InstancePool
ConcurrentExecutionCoordinator
BrowserProcessManager
InstanceLockManager
RunnerWorkerHost
RunnerWorker
```

Support:

```text
Max parallel instances
Run same scenario N times
Run one scenario per JSON row
Queue when rows exceed max concurrency
Pause/resume/stop one instance
Pause/resume/stop all instances
Manual handoff for one instance without blocking others
Retry failed instances
```

Each instance must isolate:

```text
Browser context or persistent context
Storage state
Cookies
Local storage
Runtime inputs
Current data row
Environment variables
Logs
Screenshots
Downloads
Execution state
```

## Offline Packaging

Implement:

```text
OfflineRuntimeValidator
BundledBrowserResolver
PortablePathResolver
NoInternetGuard
ProductionStartupCheck
DependencyManifest
```

Production must never require:

```text
npx playwright install
npm install
Global Node.js
Global Playwright
Global Chromium
Internet access
Admin permission
```

## UI Design

Use the provided screenshots as inspiration only. Do not copy logos or proprietary assets.

Design style:

```text
White background
Light gray panels
Blue accent
Soft shadows
Rounded nodes/cards
Left navigation
Top header
Large workflow canvas
Curved arrows
Numbered stage badges
Right properties panel
Concurrent instance monitor
Offline runtime status screen
```

## Safety Rules

Do not bypass CAPTCHA, MFA, bot detection, access restrictions, rate limits, or unauthorized pages. Use manual handoff for MFA/CAPTCHA/security confirmation.

## Implementation Phases

```text
1. Desktop shell
2. Flow designer MVP
3. Flow JSON schema
4. Generic Playwright runner
5. Data binding and runtime inputs
6. Scenario builder and flow linking
7. Concurrent UI automation instances
8. Data-driven concurrent runs
9. Reports and logs
10. Offline standalone packaging
11. Recorder mode
12. Final QA
```
