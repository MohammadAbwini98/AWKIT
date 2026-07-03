# Local Agent Rules — `src` (framework-agnostic core)

## Scope
The automation core: `runner/`, `orchestrator/`, `instances/`, `profiles/`, `data/`, `offline/`,
`reports/`, `storage/`, `recorder/`, `project/`, `roadmap/`, `utils/`. This is the engine that the
Electron main process drives.

## Required reading
Root `AGENTS.md` + `docs/ai/ARCHITECTURE.md`, `docs/ai/RULES.md`, `docs/ai/TESTING.md`.

## Local rules
- **Keep it UI-agnostic:** do not import React or Electron here. The one sanctioned bridge is the
  runner importing `app/main/appPaths` (resource/data roots, `isProductionOffline`). Avoid creating
  new `app/*` imports — it risks cycles in the "framework-agnostic" core.
- **Schemas (`profiles/`, `data/`):** changes must stay backward-compatible (optional fields +
  defaults on read) so existing saved JSON still loads; add a migration if not.
- **Runner (`runner/`):** any visible node type must execute in `StepExecutor` (or be disabled with
  a clear reason — no no-op nodes). Keep type-specific behavior reading from `FlowStep`/`NodeConfig`.
  Connector conditions use `ExpressionEvaluator` (no `eval`) over `${outputs.*}`/`${runtimeInputs.*}`/
  `${instanceInputs.*}`. Preserve the Run-Another-Flow recursion guard (max depth 5; self/indirect).
- **Offline:** launch browsers via `BrowserContextFactory` → `BundledBrowserResolver` in
  production-offline mode; never download browsers or hit the network at runtime.
- **Concurrency:** route runtime artifacts (downloads/screenshots/logs/reports) through the
  `StorageDirs` passed in — do not rebuild paths from a hardcoded root.

## Testing / verification
- `npm run build` (typecheck), then **`npm run verify:runner`** for any runner/orchestrator/
  connector/node change — report the pass count and add a case for new behavior in
  `scripts/verify-runner.mts`.

## Do not break
- Offline browser launch, the recursion guard, connector routing semantics, or schema back-compat.

## Update requirements
- Update `docs/ai/ARCHITECTURE.md` (if flow/contract changed), `docs/ai/CURRENT_STATE.md`, and
  append to `docs/ai/TASK_LOG.md`.
