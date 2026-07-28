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
  "schema": {
    "name": "playwright-flow-studio-offline-dependency-manifest",
    "version": 2
  },
  "manifestGeneratedAt": "2026-01-01T10:00:00Z",
  "application": {
    "name": "SpecterStudio",
    "version": "1.0.0",
    "buildMode": "production-offline"
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
      "validated": true,
      "payloadProvenance": {
        "source": "Playwright browser cache entry chromium-1234",
        "requestedPlaywrightVersion": "1.61.0",
        "installedPlaywrightVersion": "1.61.0",
        "stagedAt": "2025-12-31T09:00:00Z",
        "sourceTimestamp": "2025-12-20T08:00:00Z",
        "sourceTimestampBasis": "chrome.exe LastWriteTimeUtc; payload source metadata, not manifest generation time",
        "hash": {
          "algorithm": "sha256-tree-v1",
          "sha256": "64 lowercase hexadecimal characters",
          "fileCount": 123,
          "totalBytes": 456789,
          "excludedRelativePaths": ["debug.log"]
        }
      }
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

`manifestGeneratedAt` dates only this JSON document. It does not date Chromium or another copied
dependency. Browser age/source and content identity come only from `payloadProvenance`; a legacy
payload whose acquisition was never captured must say that its acquisition details are unavailable
rather than inheriting the manifest timestamp.

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
