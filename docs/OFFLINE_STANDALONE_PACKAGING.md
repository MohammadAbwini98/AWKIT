# Offline Standalone Packaging — WebFlow Studio

## Purpose

WebFlow Studio ships as a self-contained Windows desktop application that runs on a
clean production machine with **no internet, no admin rights, and nothing installed
globally**. Everything required to design and run Playwright automation — the Electron
shell, compiled app, production `node_modules`, the Playwright runtime, and a bundled
Chromium browser — is packaged into the build. Mutable runtime data is written to the
user profile, never inside the install directory.

The packaged app must **never** download Playwright browsers or any other dependency at
runtime.

## What is bundled

| Item | Location in build |
|---|---|
| Electron runtime | electron-builder output |
| Compiled main / preload / renderer | `out/**` (inside `app.asar`) |
| Production `node_modules` (incl. `playwright`, `playwright-core`) | auto-included by electron-builder; Playwright is `asarUnpack`-ed |
| Bundled Chromium | `resources/browsers/chromium/chrome.exe` → packaged under `resources/` |
| Dependency manifest | `resources/dependency-manifest.json` |
| Offline runtime descriptor | `resources/offline-runtime.json` |
| Sample flows / scenarios / data / workflows | `resources/sample-*` |
| App icon | `resources/icon.ico` |

The raw icon source (`resources/icon-source.png`, `resources/icon.png`) is excluded from
the package via the `extraResources` filter.

## Build prerequisites (developer machine, online once)

```powershell
node -v            # Node 18+ (project tooling pinned for 18)
npm install        # install dependencies
npx playwright install chromium   # download Chromium into the Playwright cache
```

## How to prepare the offline runtime

This installs Chromium (if missing), copies it into `resources/browsers/chromium`, mirrors
it to `vendor/browsers`, and regenerates the dependency manifest:

```powershell
npm run prepare:offline
```

Equivalent lower-level commands:

```powershell
npm run offline:prepare -- -InstallChromium   # copy without forcing reinstall: omit the flag
npm run offline:manifest                       # regenerate resources/dependency-manifest.json
npm run validate:offline                       # non-strict validation (warnings allowed)
```

`prepare:offline` fails loudly if Chromium cannot be located, and writes a manifest marked
`development-missing-browser` so the gap is visible.

## How to package

Portable single-exe build:

```powershell
npm run package:portable
```

Per-user installer (NSIS, no admin required):

```powershell
npm run package:nsis      # alias of package:installer
```

Both targets at once:

```powershell
npm run package:offline
```

Each packaging script runs: `npm run build` → regenerate manifest (`production-offline`) →
**strict** offline validation → `electron-builder`. Strict validation fails the build if
the bundled Chromium is missing or unvalidated, so a broken offline bundle cannot ship.
Output is written to `dist/`.

## Packaging configuration

Defined in [`electron-builder.json`](../electron-builder.json):

- `productName`: **WebFlow Studio**
- `appId`: `com.webflowstudio.app`
- `directories.output`: `dist`
- `win.target`: `portable` + `nsis`
- `nsis`: `oneClick:false`, `perMachine:false`, `allowToChangeInstallationDirectory:true`
  (per-user install → **no admin rights required**)
- `extraResources`: copies `resources/**` (minus the icon source PNGs) and `vendor/**`
- `asarUnpack`: `playwright` and `playwright-core` (native launcher must live on disk)

## Bundled Playwright browser

- **Browser:** Chromium (from the Playwright cache).
- **Source path (dev):** `%LOCALAPPDATA%/ms-playwright/chromium-*/chrome-win`.
- **Bundled path (repo):** `resources/browsers/chromium/chrome.exe`.
- **Packaged path (runtime):** `<resources>/browsers/chromium/chrome.exe`, where
  `<resources>` is `process.resourcesPath/resources` when packaged and `./resources` in dev.
- **Runtime resolution:** `BundledBrowserResolver` builds the path from the resources root
  (`app/main/appPaths.ts → getResourcesRoot()`). In production-offline mode the runner and
  recorder pass this `executablePath` to `chromium.launch(...)`, so Playwright never
  consults its global cache or attempts a download.

### How offline mode is activated

`app/main/appPaths.ts → isProductionOffline()` is the single source of truth:

- `PRODUCTION_OFFLINE=true` → force on (test a dev build against the bundled browser).
- `PRODUCTION_OFFLINE=false` → force off.
- otherwise → `app.isPackaged` (on in packaged builds, off in `npm run dev`).

Consumers: `ExecutionEngine` (workflow runner), `recorder.ipc` (recorder), and the
Offline Runtime status page.

## Runtime data paths

All mutable data lives under a fixed per-user root (consistent across portable and
installer builds):

```
%LOCALAPPDATA%/WebFlow Studio/
  flows/  workflows/  scenarios/  instances/  data/  runtime-inputs/
  storage/  downloads/  screenshots/  logs/  reports/  temp/
```

Resolved by `getRuntimeDataRoot()` / `getRuntimePaths()` and created at startup by
`ensureRuntimeFolders()`. Reports, logs, screenshots, and downloads are written here per
run. Nothing mutable is written into `app.asar`, the `resources/` folder, or `Program Files`.

## Startup gate (production offline)

In packaged/offline-production mode (`isProductionOffline()` → `app.isPackaged`, or
`PRODUCTION_OFFLINE=true`), `app/main/main.ts` runs a **hard startup gate** before opening
any window. It validates (via `OfflineRuntimeValidator` + `evaluateOfflineStartupGate`):

- Dependency manifest present and policy-valid.
- Offline runtime manifest (`offline-runtime.json`) present.
- Bundled Chromium executable present.
- Runtime downloads disabled.
- Runtime data root and all runtime folders creatable/writable under the user profile.

If any blocking item fails, the app shows a blocking dialog —
*"WebFlow Studio cannot start because required offline runtime assets are missing"* — lists
the missing items, instructs the user to rebuild with `npm run prepare:offline` /
`npm run package:offline`, and exits. **Development builds are never gated.**

At browser launch the runner and recorder log the resolved path:
`[offline] Runner using bundled Chromium: <path>` / `[offline] Recorder using bundled Chromium: <path>`.

## Final release checklist — clean-machine GUI walkthrough

This is the **last gate** before WebFlow Studio may be marked offline-production-ready. It
must be performed by a human on a real, offline Windows VM (snapshot first so you can reset).
Record a pass/fail for each step.

Current artifacts for the VM pass were rebuilt on 2026-07-03: `dist/WebFlow Studio 0.1.0.exe`
and `dist/WebFlow Studio Setup 0.1.0.exe`. Both packaging commands completed strict offline
validation in this dev checkout; the VM walkthrough below is still required.

1. Create a clean Windows VM.
2. Disconnect the internet (disable the network adapter).
3. Confirm **Node.js is not installed** (`node -v` → not recognized).
4. Confirm **Playwright is not installed globally** (no global `playwright`; no `%LOCALAPPDATA%/ms-playwright`).
5. Confirm **Chrome/Chromium is not required globally** (a system browser is not relied upon).
6. Copy **only** the portable EXE (`dist/WebFlow Studio <version>.exe`) onto the VM.
7. Launch **WebFlow Studio**.
8. Open **System → Offline Runtime** and confirm every check passes (no blocking startup dialog; bundled browser found; manifests present; runtime downloads disabled; folders writable).
9. Create a **data source** (add a JSON file) and confirm it lists.
10. Create a **flow** (Flow Designer or Recorder) and save it.
11. Create a **workflow** (Workflow Builder) linking the saved flow(s) and save it.
12. Run a **headed** automation (`dryRun=false`, headless off).
13. Confirm the **bundled Chromium** window opens (log shows `[offline] Runner using bundled Chromium: …`).
14. Start the **Recorder**.
15. Confirm the Recorder opens the **bundled Chromium** (log shows `[offline] Recorder using bundled Chromium: …`).
16. Generate a **screenshot/report/log** (complete a run).
17. Confirm files are written under `%LOCALAPPDATA%/WebFlow Studio/` (or the **configured custom paths** from Settings → Paths).
18. Confirm **nothing** is written beside the EXE or inside the app's `resources/`.
19. Repeat steps 6–18 using the **NSIS installer** (`dist/WebFlow Studio Setup <version>.exe`, per-user, no admin).
20. Record the overall **pass/fail** result.

### Release note

> **WebFlow Studio can be marked offline-production-ready only after this clean-machine GUI
> walkthrough passes** on an offline Windows VM with no internet, Node.js, global Playwright,
> or global Chromium. Everything verifiable without a desktop session — build, strict offline
> validation, bundle integrity, and live runner execution (`npm run verify:runner`, 76/76) —
> already passes; this walkthrough is the remaining human gate.

## Data migration (pre-1.0)

The runtime data root was renamed from `%LOCALAPPDATA%/PlaywrightFlowStudio` to
`%LOCALAPPDATA%/WebFlow Studio`, and the `appId` changed to `com.webflowstudio.app`.

**Decision: documentation only (no automatic migration).** This is a pre-1.0 project with
no production installations, so any data under the old folder is development-only. The app
does **not** auto-copy it, which avoids the risk of partial/incorrect copies of evolving
profile formats.

If you have local dev data you want to keep, copy these subfolders manually **before**
first launch (do not overwrite anything the new build has already created):

```
%LOCALAPPDATA%/PlaywrightFlowStudio/{flows,workflows,scenarios,data,runtime-inputs,storage,reports}
  → %LOCALAPPDATA%/WebFlow Studio/
```

(A safe, non-overwriting first-run migration could be added later if real users upgrade
across the rename — see Remaining TODOs.)

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Strict validation fails: "Bundled Chromium is not present" | Run `npm run prepare:offline` before packaging. |
| "Bundled Chromium is required for production offline mode" at run/record time | The browser wasn't bundled; re-run `prepare:offline` and repackage. |
| `browserLaunchTestPassed=false` in strict mode | The bundled `chrome.exe` couldn't report `--version`; re-copy from a known-good Playwright cache. |
| Playwright `ERR_MODULE_NOT_FOUND` | `playwright`/`playwright-core` must stay in `asarUnpack` (they are by default). |
| Data not persisting / permission errors | Ensure `%LOCALAPPDATA%/WebFlow Studio/` is writable; the app probes this at startup. |

## Known limitations / notes

- The offline preparation and packaging scripts are **PowerShell** (`scripts/*.ps1`),
  matching this Windows-only project. The npm `prepare:offline` / `package:*` scripts wrap
  them.
- Only **Chromium** is bundled. Firefox/WebKit are not supported in offline builds.
- Chromium is captured from the developer machine's Playwright cache at prepare time; keep
  the Playwright version in `package.json` aligned with the cached browser build.
- `appId` change to `com.webflowstudio.app` and the data-root rename to `WebFlow Studio`
  mean a previously-installed pre-release build is treated as a separate app; old data under
  `%LOCALAPPDATA%/PlaywrightFlowStudio` is not migrated.

## Manual GUI checklist — Concurrent Instance Monitor workflow cards

These require an interactive desktop (renderer/Electron) and are **not** covered by the headless
verification scripts. Seed test data first: `npm run mock-site` + `npm run seed:mock-fixtures`, then
`npm run dev` (or launch the packaged exe) and open **Instances**.

**Workflow cards & search**
- [ ] Each saved workflow shows as a card with status badge (Active/Inactive/Invalid), flows/connectors
      counts, execution mode, data source, last-updated.
- [ ] Hovering a card reveals its run parameters; moving away hides them.
- [ ] Tabbing with the keyboard into a card reveals the parameters (focus-within), and the Run button is
      reachable and activatable by keyboard.
- [ ] Typing in the search box filters cards by name/description; clearing restores all; a non-matching
      query shows "No matching workflows found."

**Load More / responsive**
- [ ] At a wide window the grid shows ~3 rows of cards initially; "Load More" reveals 2 more rows.
- [ ] Resize the window narrow → wide: columns reflow (1 → 2 → 3–4) with no horizontal page scroll.
- [ ] After all cards are shown, Load More disappears ("All workflows loaded." when >3 initial rows).

**Per-card run + concurrency**
- [ ] Set Workflow A to e.g. 3 runs / 2 concurrent and Run; instances appear in the table.
- [ ] While A is active, set Workflow B to different values and Run; B's instances appear **alongside** A's.
- [ ] Each row shows the correct workflow name in the **Workflow** column; instance ids are unique.
- [ ] Editing Workflow A's card values does not change Workflow B's values; reopening the page restores the
      saved per-card values.
- [ ] An Invalid/Inactive workflow's Run button is disabled with a visible reason.

**Controls across workflows**
- [ ] Stopping one instance does not affect unrelated workflow instances.
- [ ] Stop All stops all active/queued instances across both workflows.
- [ ] Clear Completed removes only terminal rows (across workflows); active rows remain.
- [ ] Logs/Screenshots buttons are enabled only for Failed instances with real artifacts.
