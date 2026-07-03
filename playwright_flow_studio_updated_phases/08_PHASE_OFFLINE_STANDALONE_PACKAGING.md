# Phase 8 — Offline Standalone Packaging

## Objective

Package the Windows app so it runs in production without internet and without admin permission.

## Production Requirements

The production app must:

```text
Run without internet
Run without npm install
Run without admin permission
Run without downloading Playwright browsers
Run without writing to installation directory
Include application dependencies
Include Playwright runtime files
Include bundled Chromium browser
Include required native modules
Create runtime folders under the user profile
Work as a portable app or per-user installer
```

## Recommended Deployment Models

### Option 1 — Portable Windows build

```text
PlaywrightFlowStudio.exe
resources/
runtime/
```

Best for locked-down machines because it does not require admin rights.

### Option 2 — Per-user installer

Installs under the current user's profile and avoids machine-wide admin privileges.

Avoid machine-wide installation under `Program Files` unless admin permission is explicitly approved.

## Runtime Data Location

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

## Bundled Dependencies

The offline package should include:

```text
Electron application bundle
Compiled renderer assets
Compiled main process assets
Node/Electron runtime
Production node_modules
Playwright runtime files
Bundled Chromium browser
Native modules
SQLite database library if used
Sample flows
Sample scenarios
Sample data
Dependency manifest
```

## Vendor Folder

```text
vendor/
├── browsers/
│   └── chromium/
├── native-modules/
├── npm-cache/
└── dependency-manifest.json
```

## Build Process on Development Machine

```text
1. npm ci
2. Install/download Playwright browser binaries during development packaging.
3. Build renderer.
4. Build Electron main process.
5. Copy browser binaries into resources/browsers.
6. Copy production runtime dependencies.
7. Generate dependency manifest.
8. Validate offline bundle.
9. Package portable app or per-user installer.
```

## Production Startup Validation

At startup, validate:

```text
Bundled browser executable exists
Playwright runtime files exist
Native modules load correctly
Runtime data path is writable
Downloads/screenshots/logs/reports folders are writable
Dependency manifest exists
No runtime download is attempted
No admin-only path is required
```

## Offline Runtime Config

```json
{
  "productionOffline": true,
  "allowRuntimeDownloads": false,
  "browser": {
    "type": "chromium",
    "executablePath": "resources/browsers/chromium/chrome.exe"
  },
  "runtimeDataPath": "%LOCALAPPDATA%/PlaywrightFlowStudio"
}
```

## Important Rule

Production must never rely on:

```text
npx playwright install
npm install
Global Node.js
Global Playwright
Global Chromium
Internet access
Admin permission
```

## Deliverables

- Offline packaging scripts.
- Portable package option.
- Per-user installer option.
- Bundled browser resolver.
- Offline runtime validator.
- Dependency manifest generator.
- Production startup check.
- No-admin installation mode.
