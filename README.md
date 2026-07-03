# WebFlow Studio

Windows desktop application for visually designing and running authorized Playwright UI automation.

## Development

```powershell
npm install
npm run dev
```

## Validation

```powershell
npm run typecheck
npm run build
```

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
