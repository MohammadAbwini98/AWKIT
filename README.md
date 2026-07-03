# WebFlow Studio

Windows desktop application for visually designing and running authorized Playwright UI automation.

Offline-capable (Electron + React + TypeScript): it runs fully offline in production with a
bundled Chromium — no internet, global Node, global Playwright, or admin rights required.

## Requirements

- **Windows** (primary target; the app and its scripts are Windows-first).
- **Node.js 20 LTS or newer** (see the Node caveat in `docs/ai/TESTING.md`).
- **PowerShell** for the packaging/offline scripts.

## Fresh-clone setup

```powershell
# 1. Install dependencies (uses the committed lockfile).
npm ci        # or: npm install

# 2. Create your local environment file from the template.
copy .env.example .env        # PowerShell/CMD
# cp .env.example .env         # Git Bash

# 3. Edit .env and fill in real values locally.
```

> **Never commit your real `.env`.** Only `.env.example` (placeholders) is tracked in Git.
> Real credentials, tokens, session values, and machine-specific settings must stay local.
> `.env` and `.env.*` (except `.env.example`) are already excluded by `.gitignore`.

## Run in development

```powershell
npm run dev
```

This launches the Electron app with `electron-vite` and hot reload. To exercise flows against
the bundled test site, start the mock site in a second terminal:

```powershell
npm run mock-site      # serves the mock site (default http://localhost:4321)
```

## Build

```powershell
npm run build          # tsc --noEmit (typecheck) + electron-vite build (bundles)
npm run typecheck      # type-check only, no bundling
```

## Test / verification

There is **no** `lint` or `test` npm script. Verification is done via the build and the live
runner checks:

```powershell
npm run build            # typecheck + bundle — the primary gate (CI runs this)
npm run verify:runner    # live runner checks against the mock site (via tsx)
npm run validate:offline # strict validation of the offline bundle (packaging changes)
```

Additional focused verifiers exist for individual features (`verify:flow-designer`,
`verify:workflow-builder`, `verify:recorder*`, `verify:protected-login`, `verify:data-editor`,
`verify:instance-monitor`). See `docs/ai/TESTING.md` for details and the Node-version caveat.

## Files excluded from Git

The following large, generated, or sensitive paths are intentionally **not** committed
(see `.gitignore`). A fresh clone will not contain them — they are produced locally:

| Path | Why excluded | How to restore |
|---|---|---|
| `node_modules/` | Installed dependencies | `npm ci` |
| `dist/`, `out/`, `build/` | Build output & packaged installers (very large) | `npm run build` / packaging scripts |
| `vendor/`, `resources/browsers/` | Bundled offline Chromium & runtime binaries (hundreds of MB) | `npm run prepare:offline` (see below) |
| `logs/`, `*.log`, `temp/`, `reports/`, `screenshots/`, `downloads/` | Runtime logs & generated output | Regenerated at runtime |
| `sessions/`, `profiles/`, `*.storageState.json`, `cookies/`, `*.har` | **Sensitive** captured login/session/browser-profile state | Never committed; recaptured locally |
| `.env` | **Secrets** | Copy from `.env.example` |
| `.claude/settings.local.json` | Machine-specific local editor settings | Local only |

In production, all mutable runtime data lives under `%LOCALAPPDATA%/WebFlow Studio`, never inside
the app bundle or `resources/`.

## Restoring the bundled Chromium / vendor resources

Dev-mode browser automation uses Playwright's own Chromium:

```powershell
npx playwright install chromium
```

To rebuild the **offline** bundle (`resources/browsers/` and `vendor/browsers/`) that ships with
packaged builds, run on a development machine:

```powershell
npm run prepare:offline        # installs Chromium via Playwright and copies it into the bundle
# equivalently: npm run offline:prepare -- -InstallChromium
```

Then generate and validate the dependency manifest:

```powershell
npm run offline:manifest
npm run validate:offline
```

The manifest is written to both `resources/dependency-manifest.json` and
`vendor/dependency-manifest.json`.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests: `npm ci`, then
`npm run typecheck` and `npm run build`. It uses no secrets, downloads no browsers, and uploads
no artifacts.

## Implementation Roadmap

Phase 10 is available inside the app at System > Roadmap. The same status is summarized in `IMPLEMENTATION_STATUS.md`.

The master build prompt is available inside the app at System > Project Contract and is backed by `src/project/ProjectContract.ts`.

Production packaging must preserve the offline rules in `AGENTS.md`: no runtime downloads, no global Node/Playwright/browser dependency, and all mutable runtime data under `%LOCALAPPDATA%/WebFlow Studio`. See [docs/OFFLINE_STANDALONE_PACKAGING.md](docs/OFFLINE_STANDALONE_PACKAGING.md) for the full offline packaging guide.

## Offline Packaging

Prepare the offline browser bundle on a development machine:

```powershell
npm run offline:prepare -- -InstallChromium
```

Generate and validate the manifest:

```powershell
npm run offline:manifest
npm run validate:offline
```

The generated manifest follows `playwright_flow_studio_updated_phases/12_OFFLINE_DEPENDENCY_MANIFEST_TEMPLATE.md` and is written to both `resources/dependency-manifest.json` and `vendor/dependency-manifest.json`.

Create packages after strict validation passes:

```powershell
npm run package:portable
npm run package:installer
```
