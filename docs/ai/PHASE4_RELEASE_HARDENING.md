# Phase 4 — Release Hardening: Packaging, Offline Manifest, Recoverable Runs UI

**Implemented:** 2026-07-06 (Claude Fable 5). Local-only, uncommitted, on `feature/smart-wait-engine`.
Builds on Phase 3 (`docs/ai/PHASE3_DURABLE_RUNTIME.md`).

## 4A — sql.js WASM packaging

- **Loader:** `src/runner/store/SqlJsLoader.ts` resolves `sql-wasm.wasm` explicitly through Node
  module resolution (`createRequire(import.meta.url).resolve("sql.js")` → sibling `sql-wasm.wasm`)
  and passes it to `initSqlJs` via `locateFile`. The resolved path is cached and exposed
  (`getSqlJsWasmPath()`) for diagnostics. Resolution works identically in:
  - **dev / tsx verifiers:** `<repo>/node_modules/sql.js/dist/sql-wasm.wasm`
  - **packaged (portable AND NSIS — same win-unpacked payload):**
    `<install>/resources/app.asar/node_modules/sql.js/dist/sql-wasm.wasm` (Electron's patched `fs`
    reads inside the archive; sql.js stays packed — nothing is asar-unpacked)
  - Resolution failure falls back to sql.js's default script-directory behavior (never fatal).
- **Packaging config:** `electron-builder.json` `files` now explicitly lists
  `node_modules/sql.js/dist/sql-wasm.js` + `sql-wasm.wasm` (production deps were already
  auto-included; the explicit entries make the requirement visible and guard against future
  exclusion patterns).
- **Verified (2026-07-06):** portable rebuild (`npm run package:portable`, 310 MB EXE) and NSIS
  rebuild pass; `npm run verify:packaged-runtime` (24/24) proves the WASM loads inside the
  packaged main process and the durable store initializes. Packaging used the warm
  electron-builder cache — no internet needed by the produced app.

## 4B — Runtime path diagnostics

`RuntimeStatusSnapshot.environment` (`RuntimeEnvironmentInfo` in
`src/runner/concurrency/RuntimeStatus.ts`):

```ts
{
  appMode: "dev" | "packaged",     // app/main/appPaths.getAppMode() (guarded for tsx)
  runtimeRoot: string,             // <%LOCALAPPDATA%/WebFlow Studio>
  sqlitePath: string,              // <runtimeRoot>/runtime/runtime.sqlite
  artifactsRoot: string,           // <runtimeRoot>/instances
  sqlJsWasmPath?: string,          // resolved WASM file (app.asar path when packaged)
  durableStoreEnabled: boolean
}
```

Populated by `ExecutionEngine.ensureDurableRuntime` (also on the disabled/failure paths, with
`durableStoreEnabled:false`), logged once as `[runtime-store] environment {...}`, and returned
by `execution:runtimeStatus`. The DB and artifacts always live under the writable runtime root,
never in `resources/`/`app.asar` (asserted by `verify:packaged-runtime`).

## 4C — Recoverable runs UI (Instance Monitor)

- **Durable init at app startup:** `registerExecutionIpc` now calls
  `executionEngine.initializeDurableRuntime(resolveStorageDirs())` (fire-and-forget), so startup
  recovery runs when the app starts — recoverable prior runs are visible right after a restart,
  not only when a new run begins. `AWKIT_DURABLE_STORE=0` still disables everything.
- **Engine API:** `getRecoveryDetails(instanceId)` → `{ run, attempts, artifacts }` (durable rows,
  incl. `listArtifacts` — new on `RuntimeStore`); `applyRecoveryAction(instanceId,
  "markReviewed" | "markAbandoned")` → sets run status `reviewed`/`abandoned` (+ recoveryNote and a
  `recoveryAction` watchdog event), refreshes the surfaced list, persists immediately. The
  surfaced list (`recoverableRuns`) is now filtered to status `orphaned`/`failed` with a
  recovery note, so acted-on runs disappear.
- **IPC/preload:** `execution:recoveryDetails`, `execution:recoveryAction` →
  `executions.recoveryDetails()`, `executions.recoveryAction()`.
- **UI:** `app/renderer/components/instances/RecoverableRunsPanel.tsx`
  (`data-testid="recoverable-runs-panel"`), rendered in the Instance Monitor under the runtime
  status strip whenever recoverable runs exist. Per run: verdict badge ("Recoverable — safe to
  re-run" vs **"Manual review required"**), workflow name, interrupted time, expandable details
  (verdict note, last node + try/status, safety level, last URL, error class, trace path,
  screenshot path, artifact count), and actions:
  - **Details** (expand), **Open artifacts** (`system:openPath` on the newest recorded
    artifact/trace/screenshot folder; disabled with a tooltip when none recorded),
  - **Re-run workflow** (ONLY for recoverable/safe runs whose workflow still exists — starts a
    fresh run through the normal card path; re-run = AWKIT's resume model),
  - **Mark reviewed** / **Mark abandoned** (explicit human verdicts).
  Dangerous/manual-review runs get NO re-run button and are never auto-resumed.

## 4D — Packaged smoke verification

`npm run verify:packaged-runtime` (`scripts/verify-packaged-runtime.mts`), run AFTER
`npm run package:portable`, checks against `dist/win-unpacked`:

1. EXE + app.asar exist; asar contains `out/main/main.js` + both sql.js dist files; bundled
   Chromium present.
2. Packaged dependency manifest parses and declares `sqlJsRuntimeIncluded` /
   `sqlJsWasmIncluded` / `dependencies.sqlJs` / no-internet flags.
3. Launches the real packaged EXE (Playwright `_electron`, `ELECTRON_RUN_AS_NODE` cleared),
   polls `executions.runtimeStatus()`: `appMode === "packaged"`, `durableStoreEnabled === true`
   (the WASM-loaded proof), WASM path inside app.asar, runtime root under
   `%LOCALAPPDATA%/WebFlow Studio`, sqlitePath/artifactsRoot under it.
4. Reads the produced `runtime.sqlite` externally (raw sql.js, read-only): SQLite header +
   migrations row + runs table.
5. Probes `artifactsRoot` writability.

NOT covered in packaged mode (covered live in dev, same code path): cancellation closing the
browser (`verify:cancellation`), failure screenshot/trace capture (`verify:artifacts`).

## 4E — Stress / soak verifiers (deterministic, no real websites)

| Script | Checks | What it proves |
|---|---|---|
| `verify:stress:concurrency` | 13 | 25 queued instances never exceed the browser cap; every grant released; backpressure activates with a reason and clears; flow cap + memory floor block/unblock |
| `verify:stress:cancellation` | 8 | 25 cancelled runs (queued AND running) all end cancelled, slots released, cancel handler runs exactly once, `cancelled` class never retryable, 50× cancel() idempotent |
| `verify:stress:locks` | 10 | profile locks never double-grant and the table drains; durable lock files survive rapid churn (no leftover holder/unit files, snapshot parses); over-subscribed dynamic origin transitions complete via bounded wait (no permanent deadlock), capacity honoured |
| `verify:stress:artifacts` | 7 | 25 concurrent JSONL loggers × 50 events: complete files, valid lines, no cross-run mixing, secrets masked; concurrent state artifacts valid and unmixed |
| `verify:soak:runtime` | 8 | 25 write cycles with periodic close/reopen: DB stays a valid SQLite file, all rows read back, migrations never re-apply, heap growth bounded |

Tunables: `AWKIT_STRESS_INSTANCES` (25), `AWKIT_STRESS_MAX_BROWSERS` (2),
`AWKIT_STRESS_TIMEOUT_MS` (120000) — each script exits 1 on timeout (deadlock guard).

**Hardening fix found by `verify:stress:locks`:** on Windows, a `wx` create racing a concurrent
release/unlink of the same `holder.lock` surfaces as `EPERM`/`EBUSY` (not `EEXIST`).
`DurableLockStore.acquireExclusive` now treats those codes as contention (retry once → clean
denial) instead of throwing.

## 4F — Offline / dependency manifest

- `scripts/generate-dependency-manifest.ps1`: `runtime.sqlJsRuntimeIncluded`,
  `runtime.sqlJsWasmIncluded`, `validation.sqlJsWasmFileExists`, `dependencies.sqlJs` (version)
  and `dependencies.sqlite` = "sql.js <version> (WASM, no native driver)".
- `scripts/validate-offline-bundle.ps1`: fails when `node_modules/sql.js/dist/sql-wasm.{js,wasm}`
  are missing or the manifest lacks the new runtime flags.
- `src/offline/DependencyManifest.ts` policy (packaged startup gate + Offline Runtime Status
  page): requires `sqlJsRuntimeIncluded` + `sqlJsWasmIncluded` — an old manifest without them now
  fails the gate, so a rebuilt EXE must carry the regenerated manifest (both packaging scripts
  regenerate it automatically).
- Regenerated 2026-07-06 (`npm run offline:manifest`); `validate:offline` passes (dev + strict
  inside packaging).

## Remaining limitations (after Phase 4)

- sql.js persistence still has a ≤300 ms loss window on hard kill (critical transitions persist
  immediately) and is single-writer per app process — unchanged, by design of the WASM driver.
- Chromium child processes are still not individually CPU/memory-sampled (browser count + pool
  health remain the proxy).
- Cancellation cannot un-send an already-sent request — safety metadata + the manual-review
  recovery verdict own that half.
- "Retry safe run" re-runs the workflow from the start (fresh run); node-level mid-flow resume
  does not exist.
- Packaged smoke verification launches the app and proves the durable runtime; it does not run a
  full workflow inside the packaged app (needs seeded workflows in the packaged profile).
- Everything is still single-host/single-app-instance for run state; durable locks are the only
  cross-process layer. Remote runner hosts remain the next roadmap (see Phase 3 doc) and were
  deliberately NOT started in this phase.
- EXEs remain unsigned; the clean-offline-VM GUI walkthrough is still the final human gate.
