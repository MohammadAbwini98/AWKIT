# AUDIT_COMMAND_RESULTS

Commands actually executed during this audit (Windows, Git Bash / PowerShell available). Live/GUI/
packaging verifiers were **not** all run — they need real Electron/Playwright, a display, or Windows
packaging and take significant time; those are noted as *not run (reason)*, per the audit rule to record
what could not be run rather than fabricate results.

| # | Command | Outcome | Notes / relevant output | Related IDs |
|---|---------|---------|-------------------------|-------------|
| 1 | `npm run build` (`tsc --noEmit && electron-vite build`) | ✅ pass (exit 0, ~4.8s bundle) | `out/renderer/assets/renderer-*.js` **1,277.79 kB** (single chunk, > Vite 500 kB warn); css 191 kB; index 0.72 kB. No type errors. | A8 |
| 2 | `npm run verify:write-queue` (`tsx`) | ✅ 7/7 | Serial queue FIFO, failure-isolation, `flush()` drains, never rejects. | — (validates the pattern A1 should reuse) |
| 3 | `npm run verify:workflow-sentinels` (`tsx`) | ✅ 4/4 | Only real flow refs enter execution; sentinel edges excluded; legacy workflows load unchanged. (Console shows mojibake for ✓ under Git Bash — cosmetic, checks pass.) | — |
| 4 | Static scan: TODO/FIXME/HACK/placeholder/NotImplemented (Grep, `*.ts/tsx`) | ✅ ran | Only product-impacting hit: "Load Session is not implemented yet" family (`OAuthHandoffService.ts:23-29`, `flowNodeRegistry.ts:167`, `ProtectedLoginHandoffPanel.tsx:91`). Rest are input `placeholder=` attrs. | A7 |
| 5 | Static scan: `@ts-ignore`/`@ts-expect-error`/`eslint-disable`/`.skip(`/`.only(` | ✅ ran | 2 `@ts-ignore` in `InstanceMonitor.tsx:519,549` ("added to preload.ts"); scattered `eslint-disable` (react-hooks/exhaustive-deps, no-explicit-any in canvas/reports). No skipped/focused tests found. | Info |
| 6 | Static scan: empty `catch {}` in `src/` (multiline) | ✅ ran | No empty catch blocks matched; caught errors generally rethrown as friendly messages or intentionally ignored with a comment (e.g. seed-optional). | — |
| 7 | Static scan: Electron `webPreferences`/`openExternal`/`setWindowOpenHandler` | ✅ ran | `contextIsolation:true`, `nodeIntegration:false`, `sandbox:false` (`windowManager.ts:14-19`); window-open handler opens **any** URL scheme (`:22-25`); `auth:openExternal` guards http(s) (`auth.ipc.ts:15`). | A5 |
| 8 | IPC contract diff: `grep ipcMain.handle` vs `preload.ts` | ✅ ran | **117** registered channels; `instances:*` CRUD, `runtimeInputs:*` CRUD, `reports:create/delete/export`, `flow:list` not exposed in preload. | A6 |
| 9 | `throw new Error` density in `src/` | ✅ ran | 54 in `StepExecutor.ts` (legit step-failure signaling), 10 `PlaywrightRunner`, others normal. No throw-based control-flow smell. | — |
| 10 | LOC / file count | ✅ ran | 242 TS/TSX source files; `src/` ~15.8k LOC, `app/` ~21k LOC; 47 `verify:*` scripts. | — |

## Commands NOT run (and why)

| Command | Why not run | Historical claim (unverified this session) |
|---------|-------------|--------------------------------------------|
| `npm run verify:runner` | Live Playwright against mock-site; long-running, needs browser. | 82/82 (per CURRENT_STATE) |
| `npm run verify:mock-site` | Spawns local server + checks; skipped for time. | 35–39/39 |
| `npm run verify:flow-designer` / `:workflow-builder` / `:canvas-perf` / `:instance-monitor-gui` / `:reports` | Real Electron GUI; need a display session. | 20–24/24 etc. |
| `npm run verify:concurrency` / `:cancellation` / `:browser-pool` / `:durable-*` / `:stress:*` / `:soak:*` | Live/second-process/stress; heavy. | green |
| `npm run validate:offline` / `package:*` / `verify:packaged-*` | Windows PowerShell packaging + built EXE. | green |
| `npm test` / `npm run lint` | **No such scripts exist** (`package.json`). | n/a |

## Notes

- `npm install` was **not** run; the working tree already had `node_modules` and the build succeeded,
  so dependencies resolve. (`@xyflow/react` remains in `package-lock`/`node_modules` though removed from
  `package.json` deps — harmless leftover per the team's own note.)
- No massive logs are pasted here; the full build log is at the session scratch path
  (`$TEMP/awtkit_build.log`) and was summarized in row 1.
- No failing command was hidden. The only "unexpected" output was cosmetic UTF-8 rendering of check
  marks under Git Bash (row 3) — the checks themselves passed.
