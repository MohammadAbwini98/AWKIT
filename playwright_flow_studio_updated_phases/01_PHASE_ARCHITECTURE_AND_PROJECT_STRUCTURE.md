# Phase 1 — Updated Architecture & Project Structure

## Objective

Build the foundation for a Windows desktop app that can design, store, orchestrate, and execute Playwright web UI automation flows with concurrent instances and offline standalone production support.

## Runtime Modes

```text
Development Mode
  - Internet available
  - npm install allowed
  - Playwright browser download allowed during setup
  - Dev tools and debug logs enabled

Production Offline Mode
  - No internet
  - No npm install
  - No runtime browser download
  - No admin permission
  - All dependencies bundled
  - Runtime data stored under user profile
```

## Updated Architecture

```text
Electron Main Process
   ↓
IPC Layer
   ↓
React Renderer UI
   ↓
Profile Stores
   ↓
Scenario Orchestrator
   ↓
Flow Orchestrator
   ↓
Concurrent Instance Manager
   ↓
Runner Worker Pool
   ↓
Bundled Playwright Browser Runtime
   ↓
Reports / Logs / Screenshots / Downloads
```

## Full Updated Project Structure

```text
visual-playwright-builder/
│
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── playwright.config.ts
├── electron-builder.json
├── .npmrc
├── .env.example
├── .gitignore
├── README.md
│
├── app/
│   ├── main/
│   │   ├── main.ts
│   │   ├── preload.ts
│   │   ├── windowManager.ts
│   │   ├── appPaths.ts
│   │   ├── offlineRuntimeValidator.ts
│   │   └── ipc/
│   │       ├── flow.ipc.ts
│   │       ├── scenario.ipc.ts
│   │       ├── execution.ipc.ts
│   │       ├── instance.ipc.ts
│   │       ├── dataSource.ipc.ts
│   │       ├── report.ipc.ts
│   │       └── offlineRuntime.ipc.ts
│   │
│   └── renderer/
│       ├── App.tsx
│       ├── main.tsx
│       ├── routes.tsx
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   ├── WorkflowDesigner.tsx
│       │   ├── FlowChartDesigner.tsx
│       │   ├── FormDesigner.tsx
│       │   ├── ScenarioBuilder.tsx
│       │   ├── RuntimeInputPanel.tsx
│       │   ├── DataSourceManager.tsx
│       │   ├── InstanceMonitor.tsx
│       │   ├── ExecutionMonitor.tsx
│       │   ├── ExecutionReports.tsx
│       │   ├── OfflineRuntimeStatus.tsx
│       │   └── Settings.tsx
│       ├── layout/
│       │   ├── AppShell.tsx
│       │   ├── TopHeader.tsx
│       │   ├── LeftNavigation.tsx
│       │   ├── DesignerCanvasLayout.tsx
│       │   ├── RightPropertiesPanel.tsx
│       │   └── StatusBar.tsx
│       ├── components/
│       │   ├── workflow/
│       │   ├── form-designer/
│       │   ├── data-binding/
│       │   ├── instances/
│       │   ├── reports/
│       │   ├── offline/
│       │   └── shared/
│       ├── stores/
│       └── styles/
│
├── src/
│   ├── runner/
│   │   ├── PlaywrightRunner.ts
│   │   ├── FlowExecutor.ts
│   │   ├── StepExecutor.ts
│   │   ├── LocatorFactory.ts
│   │   ├── ValueResolver.ts
│   │   ├── BrowserContextFactory.ts
│   │   ├── BrowserProcessManager.ts
│   │   ├── RunnerWorker.ts
│   │   ├── RunnerWorkerHost.ts
│   │   └── ManualHandoffController.ts
│   ├── orchestrator/
│   │   ├── FlowOrchestrator.ts
│   │   ├── ScenarioOrchestrator.ts
│   │   ├── FlowDependencyResolver.ts
│   │   ├── FlowOrderResolver.ts
│   │   ├── ConditionalFlowRouter.ts
│   │   ├── ExecutionQueue.ts
│   │   ├── ConcurrentExecutionCoordinator.ts
│   │   └── FlowOutputRegistry.ts
│   ├── instances/
│   │   ├── InstanceManager.ts
│   │   ├── InstancePool.ts
│   │   ├── InstanceConfig.ts
│   │   ├── InstanceStatus.ts
│   │   ├── InstanceLockManager.ts
│   │   ├── InstanceResourcePolicy.ts
│   │   ├── InstanceEvents.ts
│   │   └── InstanceIsolationMode.ts
│   ├── profiles/
│   ├── data/
│   ├── offline/
│   │   ├── OfflineRuntimeValidator.ts
│   │   ├── DependencyManifest.ts
│   │   ├── BundledBrowserResolver.ts
│   │   ├── PortablePathResolver.ts
│   │   ├── NoInternetGuard.ts
│   │   └── ProductionStartupCheck.ts
│   ├── scheduler/
│   ├── recorder/
│   ├── reports/
│   ├── storage/
│   └── utils/
│
├── scripts/
│   ├── dev.ps1
│   ├── build.ps1
│   ├── prepare-offline-deps.ps1
│   ├── validate-offline-bundle.ps1
│   ├── package-portable.ps1
│   └── package-per-user-installer.ps1
│
├── vendor/
│   ├── browsers/
│   │   └── chromium/
│   ├── native-modules/
│   ├── npm-cache/
│   └── dependency-manifest.json
│
├── resources/
│   ├── browsers/
│   ├── sample-flows/
│   ├── sample-scenarios/
│   ├── sample-data/
│   ├── offline-runtime.json
│   └── dependency-manifest.json
│
├── flows/
├── scenarios/
├── instances/
├── data/
├── runtime-inputs/
├── storage/
├── downloads/
├── screenshots/
├── logs/
├── reports/
├── temp/
└── dist/
    ├── portable/
    └── installer-per-user/
```

## Runtime Data Location

In production, runtime data must be written under the current user profile:

```text
%LOCALAPPDATA%/PlaywrightFlowStudio/
  flows/
  scenarios/
  instances/
  data/
  runtime-inputs/
  storage/
  downloads/
  screenshots/
  logs/
  reports/
  temp/
```

## Deliverables

- Updated Electron architecture.
- Updated folders for concurrent execution.
- Updated folders for offline packaging.
- Runtime path resolver.
- Offline runtime validator.
- Initial dependency manifest.
- Production startup check.
