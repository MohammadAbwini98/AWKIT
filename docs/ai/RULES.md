# RULES

Derived from existing repo patterns and the project spec. Non-negotiable unless a task explicitly
changes them.

## Offline-first (non-negotiable)
- No runtime internet dependency: no CDN, remote fonts, remote scripts, online update checks, or
  runtime browser/dependency downloads.
- Production must not require global Node, global Playwright, global Chromium, or admin rights.
- Always launch Playwright via `BundledBrowserResolver` in production-offline mode
  (`isProductionOffline()` → packaged, or `PRODUCTION_OFFLINE=true`).
- Never write mutable data into `resources/`, `app.asar`, or the install directory. Mutable data
  goes under `%LOCALAPPDATA%/WebFlow Studio/` or user-configured Settings paths
  (`getConfiguredPaths()` provides safe fallbacks).

## Coding style / architecture
- TypeScript throughout; keep `tsc --noEmit` clean (the `build` gate runs it).
- Renderer: React function components + hooks; canvases use the **in-house engine** at
  `app/renderer/components/canvas/` (`FlowCanvas` + `useCanvas`/`FlowCanvasHandle`) — **not** React
  Flow / `@xyflow` (removed 2026-07-11); **plain CSS** in `app/renderer/styles/global.css` (no
  CSS-in-JS, no new UI framework without explicit instruction).
- Keep `src/` framework-agnostic (no Electron/React imports) except the established bridge where the
  runner/IPC imports `app/main/appPaths`.
- Match existing module layout (`app/main/ipc/*` + `preload.ts` for IPC; `src/profiles` for schemas;
  `JsonProfileStore` for storage). Reuse shared helpers over one-off path/logging/launch logic.
- Make minimal, scoped diffs; no unrelated refactors; no renaming of internal identifiers.

## API / IPC contract
- The renderer talks to main **only** through `window.playwrightFlowStudio.*` (preload). When adding
  an IPC method, register it in `app/main/ipc/*` **and** expose it in `app/main/preload.ts` with a
  typed signature. Do not rename the `playwrightFlowStudio` global.
- Settings updates use a deep-partial patch (`settings.update`); the store deep-merges known groups.

## Storage / schema
- Profiles are JSON (`FlowProfile`, `WorkflowProfile`, `ScenarioProfile`, data sources, reports).
- When changing a schema, keep backward compatibility (optional fields + defaults on read) or add a
  migration; existing saved files must still load.
- Generated JSON the app reads at runtime must be **UTF-8 without BOM** (PowerShell `Set-Content -Encoding UTF8`
  writes a BOM that breaks `JSON.parse`; loaders also strip a leading BOM defensively).

## Node / connector model
- New flow node types must be added to the node registry (`flowNodeRegistry.ts`), have type-specific
  properties in `FlowNodePropertiesPanel.tsx`, persist via `FlowStep`/`NodeConfig`, and be executed
  in `StepExecutor` (or be disabled with a clear reason — no active no-op nodes).
- Connector expressions resolve `${outputs.<flowId>.<key>}`, `${runtimeInputs.*}`,
  `${instanceInputs.*}` via `ExpressionEvaluator` (no `eval`).
- Run Another Flow must keep the recursion guard (max nested depth 5; self/indirect detection).

## UI
- Preserve the app shell (left nav, top header, status bar) and routing in `routes.tsx`.
- Honor the unsaved-changes dialog (`pageChrome` dirty flag) for navigation away from editors.
- No fake/no-op controls: every enabled control must do something real, or be disabled with a tooltip.
- No demo/seed data presented as real user records — use empty states.
- **Design tokens (Hologram re-skin):** all new/changed UI MUST resolve color, spacing, radius,
  shadow, and motion through the existing `global.css` tokens (`var(--awkit-*)`, `--space-*`,
  `--radius-*`, `--awkit-motion-*`/`--awkit-dur-*`/`--awkit-ease-out`, `--awkit-shadow-*`). Do NOT
  hardcode hex colors or arbitrary pixel spacing/radii. Every token has a `[data-theme="dark"]`
  override, so token use keeps light/dark correct automatically. (Known intentional exception: the
  `ReportsFailures` category-hue chart palette.) Do not introduce parallel class systems that
  duplicate existing base styling (global `input/select/textarea`, `.toolbar-button`, `.awkit-table`,
  `.modal-overlay`/`.modal-dialog`, `MetricCard`/`EmptyState`/`SkeletonCard`).
- **App-shell grids:** do NOT modify the global `.app-shell` / `.app-main` grid layouts (or the
  full-height left sidebar / header-over-content relationship) without explicit permission — changing
  them breaks the sidebar/header/status structure across every route.
- **Accessibility:** keep a visible `:focus-visible` style on every focusable element (never
  `outline: none` without an alternative — the global `:focus-visible` ring is that alternative);
  use semantic elements (`<button>` for actions, `<a>` for links) rather than clickable `<div>`s;
  keep motion behind the last-in-cascade `prefers-reduced-motion` neutralizer.

## Logging / errors / secrets
- Mask secrets in logs and reports. Never hardcode secrets or environment-specific values.
- Structured per-run/per-instance logs (timestamp, level, execution/instance/scenario/flow/step ids).

## Documentation
- Keep `docs/ai/` evidence-based; separate Confirmed / Inferred / Unknown.
- Update `CURRENT_STATE.md` and `TASK_LOG.md` after every task (see `AGENTS.md` checklist).
