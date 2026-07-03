# Local Agent Rules — `app/main` (Electron main process)

## Scope
Electron main process: app bootstrap, window, preload/IPC bridge, settings store, profile stores,
path resolution, offline validation. Code here runs in Node with Electron APIs.

## Required reading
Root `AGENTS.md` + `docs/ai/ARCHITECTURE.md`, `docs/ai/RULES.md`. This folder overrides nothing in
the root rules; it adds local specifics.

## Local rules
- **IPC contract:** the renderer reaches main only via `window.playwrightFlowStudio.*`. To add a
  channel you must (1) `ipcMain.handle(...)` in `ipc/<area>.ipc.ts`, register it in `ipc/index.ts`,
  and (2) expose a typed method in `preload.ts`. Never rename the `playwrightFlowStudio` global.
- **Paths:** resolve via `appPaths.ts` (`getRuntimeDataRoot`, `getResourcesRoot`,
  `isProductionOffline`) and `storagePaths.ts` (`getConfiguredPaths`). Do not hardcode
  `%LOCALAPPDATA%` or resource paths. Never write mutable data into `resources/`/`app.asar`.
- **Settings:** change `UiSettings` only in `uiSettings.ts`; update `hydrate`/`mergePatch`/defaults
  together or partial updates will drop fields. `settings.update` takes a deep-partial patch.
- **Profile stores:** create via the `createXProfileStore()` factories (they already route through
  `getConfiguredPaths()` for user paths). Use `JsonProfileStore` from `@src/storage`.
- **JSON files** the app reads must be UTF-8 **without BOM**; loaders strip a leading BOM defensively.
- **Offline:** keep the startup gate (`main.ts`) and `BundledBrowserResolver` usage intact; no
  runtime network calls, no `autoUpdater`.

## Testing / verification
- `npm run build` (typecheck). For offline/manifest changes: `npm run validate:offline`.

## Do not break
- The preload API surface, the offline startup gate, the dependency-manifest contract, or the
  runtime data root location.

## Update requirements
- If you change IPC, settings schema, or paths, update `docs/ai/ARCHITECTURE.md` and
  `docs/ai/CURRENT_STATE.md`, and append to `docs/ai/TASK_LOG.md`.
