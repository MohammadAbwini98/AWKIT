# COMMANDS

All commands verified against `package.json` scripts and repo scripts (2026-06-26).
Platform: **Windows** (packaging/offline scripts are PowerShell). Node 18 in the current dev env.

## Install
```bash
npm install
```

## Develop / run
```bash
npm run dev              # node scripts/dev.mjs → electron-vite dev (Electron + renderer with HMR).
                         # The launcher clears ELECTRON_RUN_AS_NODE first (some sandbox/agent envs
                         # set it =1, which makes Electron boot as plain Node and the app never opens).
npm run preview          # electron-vite preview
npm run mock-site        # node mock-site/server.mjs  (offline test website, port 4321 by default)
npm run dev:mock-site    # same as mock-site
```

## Typecheck / build
```bash
npm run typecheck        # tsc --noEmit
npm run build            # tsc --noEmit && electron-vite build  (primary verification gate)
```

## Test / verify
```bash
npm run verify:runner       # tsx scripts/verify-runner.mts — live runner checks vs the mock site
npm run verify:mock-site    # node scripts/verify-mock-site.mjs — starts the local Feature Test Lab
                            # mock site and checks scenario URLs, delay behavior, and stable selectors
npm run verify:flow-designer # node scripts/verify-flow-designer-gui.mjs — launches the REAL built Electron
                            # app (Playwright _electron) and drives the Flow Designer connector UI: ports
                            # un-clipped, top loop port, semicircle self-loop, add/remove loop, conditional
                            # lock, second conditional branch drag, 2→1 survivor auto-revert, and the Saved
                            # Flow searchable dropdown closing on an outside canvas click.
                            # Requires `npm run build` first; clears ELECTRON_RUN_AS_NODE internally.
npm run verify:workflow-builder # node scripts/verify-workflow-builder-gui.mjs — same real-Electron GUI
                            # walkthrough for the Workflow Builder (.scenario-flow-node) canvas. Loads a
                            # saved workflow with an edge, then checks the same connector behaviors.
npm run verify:recorder     # tsx scripts/verify-recorder-locator.mts — live checks unique locators, runner locator safeguards, live text capture, and Smart Wait recorder observation signals/correlation
npm run verify:recorder-draft # tsx scripts/verify-recorder-draft.mts — recorder action-draft persistence + reusable saved-URL history + wait-time/smart-wait compatibility logic; no browser launched
npm run verify:recorder-flow # tsx scripts/verify-recorder-flow.mts — pure buildRecordedFlow checks: default Start/End nodes, action wiring, wait/route-change replay; no browser launched
npm run verify:protected-login # tsx scripts/verify-protected-login.mts — pure protected-login detector unit checks
npm run verify:data-editor  # tsx scripts/verify-data-editor.mts — data-source table editor logic + file round-trip
npm run verify:instance-monitor  # tsx scripts/verify-instance-monitor.mts — workflow-card logic (filter/visible-count/validation/name-resolve)
npm run seed:mock-fixtures  # node scripts/seed-mock-fixtures.mjs — import test-only mock flows/workflows/data source into runtime userData (for manual GUI testing)
npm run ai:memory           # node scripts/ai-memory/check-memory.mjs — validate the AI memory files
npm run ai:memory:check     # alias of ai:memory
```
- There is **no** `lint` script and **no** `test` npm script.
- `@playwright/test` is installed and `tests/runner.mocksite.spec.ts` exists, but the Playwright
  test runner cannot load the TS/ESM config on Node 18.16 (needs Node ≥18.19). Use `verify:runner`.

## Offline preparation & packaging (PowerShell)
```bash
npm run prepare:offline  # prepare-offline-deps.ps1 -InstallChromium (installs+copies Chromium, regenerates manifest)
npm run offline:prepare  # prepare-offline-deps.ps1 (copy cached Chromium, no install)
npm run offline:manifest # generate-dependency-manifest.ps1
npm run validate:offline # validate-offline-bundle.ps1 (add -Strict via the package scripts)
npm run package:portable # build + manifest + strict validate + electron-builder --win portable
npm run package:nsis     # per-user NSIS installer (alias of package:installer)
npm run package:installer# package-per-user-installer.ps1
npm run package:offline  # package:portable && package:installer
```
Output: `dist/WebFlow Studio <version>.exe` (portable), `dist/WebFlow Studio Setup <version>.exe` (installer).
> First packaging needs internet (electron-builder downloads NSIS/codesign helper binaries) or a warm
> electron-builder cache; the produced app itself needs no internet.

## Assets
```bash
npm run icon:generate    # node scripts/generate-app-icon.mjs (build resources/icon.ico from icon-source.png)
```

## Database migrations
`Unknown - verify before use` — the project uses JSON file storage, not a database; no migration command exists.

## Notes
- Bash tool note: this repo runs on Windows; prefer the npm scripts above. PowerShell is the shell
  for the `*.ps1` packaging/offline scripts.
