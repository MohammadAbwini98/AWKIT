# Offline Dependency Manifest Template

## Purpose

The offline dependency manifest confirms that the production Windows application contains every dependency required to run without internet and without admin permission.

Recommended path:

```text
resources/dependency-manifest.json
```

## Template

```json
{
  "application": {
    "name": "Playwright Flow Studio",
    "version": "1.0.0",
    "buildMode": "production-offline",
    "builtAt": "2026-01-01T10:00:00Z"
  },
  "offline": {
    "internetRequired": false,
    "runtimeDownloadsAllowed": false,
    "adminPermissionRequired": false,
    "globalNodeRequired": false,
    "globalPlaywrightRequired": false,
    "globalBrowserRequired": false
  },
  "runtime": {
    "electronIncluded": true,
    "nodeRuntimeIncluded": true,
    "productionNodeModulesIncluded": true,
    "nativeModulesIncluded": true
  },
  "browsers": [
    {
      "name": "chromium",
      "included": true,
      "relativeExecutablePath": "resources/browsers/chromium/chrome.exe",
      "version": "bundled-version",
      "validated": true
    }
  ],
  "paths": {
    "runtimeDataRoot": "%LOCALAPPDATA%/PlaywrightFlowStudio",
    "flows": "%LOCALAPPDATA%/PlaywrightFlowStudio/flows",
    "scenarios": "%LOCALAPPDATA%/PlaywrightFlowStudio/scenarios",
    "instances": "%LOCALAPPDATA%/PlaywrightFlowStudio/instances",
    "data": "%LOCALAPPDATA%/PlaywrightFlowStudio/data",
    "downloads": "%LOCALAPPDATA%/PlaywrightFlowStudio/downloads",
    "screenshots": "%LOCALAPPDATA%/PlaywrightFlowStudio/screenshots",
    "logs": "%LOCALAPPDATA%/PlaywrightFlowStudio/logs",
    "reports": "%LOCALAPPDATA%/PlaywrightFlowStudio/reports"
  },
  "validation": {
    "bundledBrowserExists": true,
    "browserLaunchTestPassed": true,
    "profileStorageWritable": true,
    "runtimeFoldersWritable": true,
    "noRuntimeDownloadsDetected": true,
    "noAdminPathRequired": true
  },
  "dependencies": {
    "electron": "pinned-version",
    "playwright": "pinned-version",
    "react": "pinned-version",
    "reactFlow": "pinned-version",
    "sqlite": "pinned-version"
  }
}
```

## Startup Validation Checklist

```text
Manifest exists
Bundled browser executable exists
Production node_modules available
Native modules load successfully
Runtime data root writable
Downloads/screenshots/logs/reports writable
No internet download attempted
No admin-only path required
```
