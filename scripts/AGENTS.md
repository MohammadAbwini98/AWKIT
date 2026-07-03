# Local Agent Rules — `scripts`

## Scope
Build/offline/packaging automation. PowerShell scripts (`*.ps1`) drive offline prep, manifest
generation, validation, and electron-builder packaging; `.mjs`/`.mts` scripts handle the app icon
and live runner verification.

## Required reading
Root `AGENTS.md` + `docs/ai/COMMANDS.md`, `docs/ai/KNOWN_ISSUES.md`, `docs/OFFLINE_STANDALONE_PACKAGING.md`.

## Local rules
- **No BOM in generated JSON.** Windows PowerShell `Set-Content -Encoding UTF8` writes a UTF-8 BOM
  that breaks Node `JSON.parse` (this has already failed the packaged startup gate twice). Write
  JSON via `[System.IO.File]::WriteAllText(path, json, (New-Object System.Text.UTF8Encoding($false)))`.
- **Keep validators in sync.** The dependency-manifest is validated in **both**
  `validate-offline-bundle.ps1` and `src/offline/DependencyManifest.ts`; the app name/paths
  (`WebFlow Studio`, `%LOCALAPPDATA%/WebFlow Studio/...`) must match across the generator and both
  validators, or strict packaging / the startup gate will fail.
- **Safety:** scripts should be repeatable and non-destructive by default; don't print secrets;
  document any required env vars (e.g. `MOCK_SITE_PORT`). Packaging needs internet on first run
  (electron-builder helper binaries) but the produced app must not.
- **Don't bundle dev tooling:** `tsx`, `sharp`, `png-to-ico` are devDependencies and must stay out
  of the production bundle (electron-builder includes prod deps only).

## Testing / verification
- `npm run validate:offline` after changing offline/manifest scripts.
- `npm run verify:runner` (this runs `scripts/verify-runner.mts` via `tsx`) after touching it.

## Do not break
- The manifest contract, BOM-free output, or the offline packaging chain
  (`build → manifest → strict validate → electron-builder`).

## Update requirements
- Update `docs/ai/COMMANDS.md` if a script/command changed; append to `docs/ai/TASK_LOG.md`.
