# CURRENT_STATE

**Last updated:** 2026-07-08 (Codex - Flow Designer and Workflow Builder sparse dot canvas match.)

## Flow/Workflow canvas dots matched to attachment (2026-07-08)

Renderer/UI-only dot-grid follow-up; no route/IPC/schema/runner automation behavior changed. Flow Designer
and Workflow Builder now use the attached sparse lavender dot field: React Flow `BackgroundVariant.Dots`
is `gap={44}` / `size={2.4}`, the two light-mode canvas containers scope `--awkit-canvas-bg: #f4f1f8`
and `--awkit-canvas-dot: #cac5d3`, and `.react-flow__pane` is transparent so the SVG background dots are
actually visible. The earlier Form-Designer-style framed-card experiment remains reverted.

Verified: `npm run build` pass, `verify:flow-designer` 19/19 (stable local `login-flow` selection; current
`test-mock` local flow made the drag branch check flaky), `verify:workflow-builder` 13/13, `ai:memory`
pass. Refreshed after-screenshots:
`ui-reskin-template-plan/mockups/screenshots/after/02-flow-designer.png` and `04-workflow-builder.png`.

## Template UI — Codex completion evidence + token/status polish (2026-07-08)

Codex completed the requested local-template implementation pass against `UI Samples/sample_01.png`, the
attached matching image, the three local mp4 references (present; fresh extraction attempted but blocked by
missing `ffmpeg`/media libraries and a Chrome seek timeout), and the reachable Dribbble text pages. Report:
`ui-reskin-template-plan/19_CODEX_TEMPLATE_COMPLETION_REPORT.md`; implementation plan:
`ui-reskin-template-plan/18_CODEX_TEMPLATE_IMPLEMENTATION_PLAN.md`.

Renderer/UI-only changes; no route/IPC/schema/runner/automation behavior changed. Verified:
`npm run typecheck` pass, `npm run build` pass, `verify:flow-designer` 19/19, `verify:workflow-builder`
13/13, `verify:reports` 26/26, `verify:instance-monitor` 22/22, `verify:data-editor` 27/27,
`verify:recorder` 57/57, `ai:memory` pass. Fresh after-screenshots captured in
`ui-reskin-template-plan/mockups/screenshots/after/` including a direct hidden-route
`05-workflow-designer.png` and optional `10-dark-flow-designer.png`.

- **Light template tokens aligned to the prompt:** `global.css` now uses the requested Hologram-style
  light palette (`--awkit-bg: #f6f4f9`, `--awkit-bg-canvas: #f3f0f8`, `--awkit-accent: #7c3aed`,
  text/muted/border/radius/shadow/motion aliases) while retaining dark-mode overrides.
- **Status bar no longer shows fake placeholders.** `StatusBar.tsx` polls real
  `executions.runtimeStatus()` and shows Flows/Browsers/Queue plus runtime nominal/backpressure/error
  status chips. The prior static `Active Instances: 0`, `Queue: 0`, `Last Error: None` placeholders are gone.
- **Loader/state utilities added:** `.awkit-spinner`, `.awkit-loader-dot`, `.loading-panel`,
  `.skeleton-card`, `.skeleton-shimmer`; all are covered by the existing last-in-cascade
  `prefers-reduced-motion` neutralizer.
- **Inline legacy border cleanup:** remaining UI-surface border hex values in `Recorder.tsx`,
  `SessionsManager.tsx`, and `RecoverableRunsPanel.tsx` now use `--awkit-*` tokens. Remaining TSX literal
  colors are intentional connector presets and the distinct Reports Failures chart palette.
- **Body overflow made explicit:** `html`, `body`, and `#root` are full-height with hidden overflow; canvas
  and page panels continue to scroll internally.

## Template UI — final visual acceptance + hardening (2026-07-07)

Strict acceptance pass over every template surface (report:
`ui-reskin-template-plan/17_FINAL_VISUAL_ACCEPTANCE_REPORT.md`). Renderer visual/CSS only; no
route/IPC/runner/schema/automation change. All areas pass with screenshot+code evidence; three safe
fixes applied. Verified: `npm run build` clean; `verify:flow-designer` **19/19 run twice** (via new
reset helper, from two different start states — proves state-independence), `verify:workflow-builder`
13/13, `verify:reports` 26/26, `verify:recorder` 57, `verify:instance-monitor` 22, `verify:data-editor`
27; `ai:memory` pass. Fresh after-screenshots for all 8 surfaces in
`ui-reskin-template-plan/mockups/screenshots/after/`.

- **Fix — floating drawer no longer covers the in-canvas action bar.** On flush designer pages (Flow
  Designer, Workflow Designer) the drawer's `top:18px` was measured from the whole `.designer-layout`,
  overlapping the action bar's right controls (Flow Name / Load / Delete / `N issues` / Workflow select).
  Added `.designer-layout.flush-layout .designer-right-drawer-slot { top: 62px }` so the drawer starts
  below the action bar (Form Designer, non-flush, keeps the 18px inset).
- **Fix — tokenized stray legacy borders.** `1px solid #dfe6ef` (×6) + `1px solid #e2e8f0` (×1) inline
  borders → `1px solid var(--awkit-border)` in `Recorder.tsx` and `SessionsManager.tsx` (now theme-aware).
- **New — verifier-only UI-state reset helper** `scripts/helpers/reset-ui-state.mjs`
  (`node scripts/helpers/reset-ui-state.mjs <routeId> <collapsed:true|false>`): resets only
  `ui-settings.json` `lastRouteId`/`sidebarCollapsed` before a GUI verifier so the documented
  route/collapse-state gotcha can't flake a run. Dev/verifier-only (no production/route/schema change);
  intentionally NOT wired into the green verifiers to avoid destabilizing them.
- **Proven:** display-only edge fields `showAddButton`/`onInsertNode` never serialize — absent from
  `src/` and from `FlowEdge` (`FlowProfile.ts`); `toFlowProfile` reads explicit connector fields only.
- **Deliberate gaps (unchanged):** Setup/**Test** tabs are visual (Test disabled — no fake runner);
  connector `+` inserts a default `Click` node (TODO type chooser); `ScenarioFlowNode` keeps its existing
  numbered-badge card (only its connectors use `templateSmooth`); the `workflow` (Workflow Designer)
  route is a read-only overview not present in the sidebar nav (pre-existing).



## Template UI completion pass — drawer / nodes / connectors / motion (2026-07-07)

Implemented the **structural Hologram-template details the earlier token-only + shell re-skin left
out** (spec pack under `docs/` + `docs/files/`; gap report `ui-reskin-template-plan/16_VISUAL_GAP_CLOSURE_REPORT.md`).
Renderer visual/markup + CSS only — no route/IPC/runner/schema/automation change; canvas coordinate
invariants preserved. Verified: `npm run build` clean; `verify:flow-designer` 19/19,
`verify:workflow-builder` 13/13, `verify:reports` 26/26, `verify:recorder` 57, `verify:instance-monitor`
22, `verify:data-editor` 27; `ai:memory` pass. After-screenshots in
`ui-reskin-template-plan/mockups/screenshots/after/`.

- **Floating config drawer (was a grid column):** `DesignerCanvasLayout` now wraps the right panel in a
  pointer-transparent `.designer-right-drawer-slot` that floats over the canvas (top/right/bottom 18px);
  `.designer-layout` collapsed to a single canvas column so the workflow surface keeps full width. React
  Flow re-fits on the resize (no mount transform — canvas invariant intact).
- **Config-drawer shell:** `FlowNodePropertiesPanel` + `ConnectionPropertiesPanel` are now
  `template-config-drawer`s — sticky header (icon tile + title + collapse/delete), **Setup/Test tab strip**
  (Test disabled — no fake test runner), a single scroll region `.properties-body`, and a sticky footer
  (`Done`; connector panel also shows a disabled `Run Test`). All existing fields/validation/locking
  preserved. Grid rows `auto auto 1fr auto` ⇒ only the body scrolls.
- **Template node-card anatomy:** `ActionFlowNode` renders icon tile + metadata row (catalog label + type
  badge) + bold title + description + kebab (`MoreHorizontal`, pointer/click-stopped so it never breaks
  drag/select). NodeResizer, ports, and the loop button are unchanged (verifier still 19/19; card keeps
  `overflow:hidden` — ports are siblings so never clipped).
- **Template connectors:** new `components/shared/TemplateSmoothEdge.tsx` (curved violet `BaseEdge` +
  `EdgeLabelRenderer` label pill + hover-revealed `+` insert button + running-flow dash animation).
  `connectorStyle.ts`: `connectorTypeColor` values are now **CSS-variable strings**
  (`--awkit-connector-*`, violet default; semantic red/green kept for real outcomes) and
  `buildConnectorVisual` remaps runtime edge `type` `smoothstep → templateSmooth` (**saved
  `EdgeVisualStyle.shape` is untouched**). Registered on Flow Designer, Workflow Builder
  (`ScenarioBuilder`), and Workflow Designer canvases. Flow Designer adds `insertNodeOnEdge` (splits an
  edge with a `Click` node) via a **display-only `edgesForCanvas`** memo — `showAddButton`/`onInsertNode`
  are never serialized (`toFlowProfile` reads connector fields explicitly; they were added as optional
  non-persisted fields on `FlowConnectionData`).
- **Zoom pill:** `CanvasZoomControl` buttons carry `canvas-zoom-button` + a `canvas-zoom-divider` before
  Fit; styled as a hover-lifting pill.
- **CSS:** one appended **TEMPLATE COMPLETION PASS** block in `global.css` (connector/motion tokens,
  drawer slot + single-column designer layout, drawer header/tabs/body/footer, node anatomy, connector
  label/add/flow, zoom-pill buttons, palette slide-in), placed **before** the last-in-cascade
  reduced-motion neutralizer so all added motion is disabled under `prefers-reduced-motion`.
- **Gotcha re-confirmed (not caused by this work):** the GUI verifiers depend on persisted route +
  sidebar-collapse state — `verify:flow-designer` needs an **expanded** sidebar + a matching route;
  `verify:workflow-builder` needs a **collapsed** sidebar (clicks `nav-item[title=…]`). Reset
  `%LOCALAPPDATA%/WebFlow Studio/storage/ui-settings.json` `lastRouteId`/`sidebarCollapsed` between runs.

## Missing-template design pack — structural shell re-skin (2026-07-07, Phases 1–5)

Completed the "Missing Template Design" prompt pack (`docs/ai/ui-reskin-template-plan/01..05`) — the
**structural** template work the earlier token-only re-skin left out. Visual/layout only; no
route/IPC/runner/schema changes; `window.playwrightFlowStudio`, React Flow handle IDs/edge schema,
and the canvas no-mount-transform rule preserved. Verified: `npm run build` clean;
`verify:flow-designer` 19/19, `verify:workflow-builder` 13/13, `verify:reports` 26/26,
`verify:instance-monitor` 22, `verify:recorder` 57/57, `verify:data-editor` 27/27.

- **Shell layout corrected (Phase 2):** the sidebar is now **full-height on the left** and the top
  header renders **only over the main content** (matches the Hologram template). `AppShell.tsx`:
  `.app-shell` is `grid-template-columns: 260px minmax(0,1fr)` (76px collapsed) wrapping
  `<LeftNavigation>` + a new `.app-main` (`grid-template-rows: 60px 1fr 32px` → header / content /
  status). The old full-width `.app-body` top-header layout is gone.
- **Sidebar re-skin (Phase 3):** brand **workspace tile** at top; Settings relocated from the System
  group into a pinned **footer utility area** (Settings nav + Dark Mode toggle + a non-interactive
  workspace identity row). Collapsed sidebar remains a polished 76px icon rail.
- **Header re-skin (Phase 3):** a real **"Unsaved changes" status chip** appears when the active
  editor is dirty (`chrome.dirty` threaded `App → AppShell → TopHeader`; `.header-status-chip`).
  No fake data/controls (honors RULES). Icon-square back button; purple primary CTA retained.
- **Shared polish (Phase 4):** template KPI-card hover-lift (`.metric-card`) + elevated purple CTA
  (`.toolbar-button.primary`), transform/shadow-only inside the reduced-motion neutralizer.
- **Canvas/drawer/motion (Phase 5):** confirmed already delivered by the token re-skin (dotted
  canvas, 16px node cards + type badge + purple/lavender selection + hover-lift, **floating** rounded
  properties drawer with float shadow + uppercase section labels, floating bottom-center zoom pill,
  reduced-motion). No structural drawer rewrite (would risk canvas coordinate stability).
- **New helper:** `scripts/capture-ui-screenshots.mjs [subdir]` — launches the built app and captures
  route screenshots for before/after evidence (`docs/ai/ui-reskin-template-plan/mockups/screenshots/`).
- **Gotcha (pre-existing, re-confirmed):** GUI verifiers navigate by nav **title** (workflow-builder —
  matches only when the sidebar is **collapsed**) vs. visible **text** (flow-designer — matches only
  when **expanded**); a collapsed sidebar + a restored non-matching route can time a verifier out.
  Reset the app's route/collapse state between runs. Not caused by this work.

## Hologram UI re-skin + theme system (2026-07-07)

- **Full visual re-skin to the user-provided Hologram template** (light SaaS style: off-white shell,
  white sidebar/cards, violet `#6d28d9` accent, 16px card radius, dotted canvas, floating right
  drawer + bottom zoom pill) implemented as a **token-only + CSS re-skin** — no route/IPC/runner
  changes. Template sources: `UI Samples/sample_01.png` + 3 mp4s (frames extracted via system
  Chrome; Playwright's bundled Chromium cannot decode H.264).
- **Design tokens:** `global.css` now has a complete light token set under `:root`/`[data-theme="light"]`
  and a full dark override under `[data-theme="dark"]` (surfaces, text, accent family incl.
  `--awkit-accent-rgb` triplet for rgba glows, status ×soft/muted, canvas bg/dot, node tokens, glass/
  overlay, shadows, focus ring). All ~548 hardcoded hex values in `global.css` and ~170 inline hex
  values in renderer TSX were replaced by `var(--awkit-*)` references (property-aware for `#fff`:
  `color:` → `--awkit-accent-contrast`, backgrounds → `--awkit-surface`). `ReportsFailures.tsx`
  keeps its 14-hue category palette literal (deliberate — distinct chart hues).
  `var()` in SVG presentation attributes verified working in Chromium (charts/minimap).
- **Theme persistence:** `UiSettings.appearance: "light" | "dark" | "system"` (default light,
  backward compatible via hydrate). Renderer `state/theme.tsx` (`ThemeContext`, `useTheme`,
  `resolveAppearance`) + App.tsx applies `data-theme` on `<html>` and follows OS changes live in
  system mode. Sidebar bottom gets a template-style **Dark Mode toggle** (LeftNavigation);
  Settings > Application gets an **Appearance** select (applies immediately, persists; reset syncs).
- **Canvas:** all three React Flow canvases use the dotted `BackgroundVariant.Dots` grid colored via
  CSS (`.react-flow__background circle` → `--awkit-canvas-dot`); RF v12 `--xy-*` variables set for
  minimap/controls theming. Node cards (`.action-flow-node`, `.scenario-flow-node`): 16px radius,
  no left color bar (validation now = amber/red border+ring; selection = purple border + lavender
  `--awkit-node-selected-bg` + ring; selection wins over validation). Scenario execution-mode tint
  moved to the order badge. `connectorTypeColor` retuned (always/parallel → violet family; semantic
  green/red/amber kept); `CanvasZoomControl` is now a bottom-center floating pill.
  **Canvas invariants preserved and GUI-verified:** `verify:flow-designer` 19/19,
  `verify:workflow-builder` 13/13 (needs seeded fixtures + `lastRouteId`/collapsed-sidebar nav —
  see KNOWN gotcha: the verifier clicks `nav-item[title="Workflow Builder"]`, which matches only
  when the sidebar is collapsed since expanded items use description titles).
- **Shell:** sidebar nav items (36px, purple soft active pill, hover), uppercase group labels,
  brand block, top header buttons (10px radius, purple primary with hover), themed scrollbars,
  global `:focus-visible` ring, `::selection`, `color-scheme` per theme.
- **Motion:** button/nav/switch transitions, node hover lift, modal fade+pop entrance — all
  transform/opacity, inside the existing last-in-cascade reduced-motion neutralizer.
- **Verified this pass:** `npm run build` clean ×5; `verify:flow-designer` 19/19;
  `verify:workflow-builder` 13/13; `verify:reports` 26/26; plus screenshot walkthrough of
  Dashboard/Flow Designer/Workflow Builder/Recorder/Instances/Settings in BOTH themes via
  Playwright `_electron` (light + dark render correctly; minimap dark fix applied).
  `verify:instance-monitor`, `verify:data-editor`, `verify:recorder` run at end of task (see
  TASK_LOG). Settings **import** does not live-refresh the theme context (appearance applies on
  next launch) — minor known gap.

## Git-cycle verification (2026-07-07)

- User explicitly requested committing and pushing all current project changes on
  `feature/smart-wait-engine` (overriding the prior handoff's "do not push unless explicitly asked"
  caution).
- Fresh local verification before staging: `npm run build` pass; `npm run verify:runner` 82/82;
  `npm run verify:recorder` 57/57; `npm run verify:telemetry` 39/39; `npm run verify:reports` 26/26;
  `npm run verify:waits` 21/21; `npm run verify:mock-site` 28/28; `npm run validate:offline` pass;
  `npm run verify:concurrency` 78/78.
- No new product behavior was introduced by the Git-cycle task itself; it preserves and publishes the
  already-documented local workset.

## Phase 5.1 verification (2026-07-07)

- **Chromium no-egress hardening validated end-to-end.** `src/runner/ChromiumHardening.ts`
  (`buildChromiumHardeningArgs`) is wired into the runner (`BrowserContextFactory`) and both recorder
  launch paths, and is deliberately NOT applied to the user's real Chrome (`SessionCaptureService`).
  It builds background-service switches + a `--disable-features` **superset of Playwright 1.61's list**
  (verified against the installed `playwright-core` bundle — last-wins replace, so the superset is
  required) + `--host-resolver-rules` mapping Google service hosts to loopback + gaia/search redirect
  switches, plus four pinned Playwright behavioral defaults (`--disable-popup-blocking` etc.). Toggle:
  `AWKIT_CHROMIUM_OFFLINE_HARDENING` (default on) + `AWKIT_CHROMIUM_EXTRA_ARGS`.
  - `npm run verify:chromium-hardening` **13/13** (machine ONLINE): the bundled Chromium under the
    hardened args made **ZERO non-loopback TCP connections** over a 20 s idle window, AND navigation
    to external sites (incl. `google.com`, whose SERVICE hosts are loopback-mapped) still worked.
  - `npm run verify:packaged-walkthrough` re-run with **`AWKIT_WALKTHROUGH_STRICT_NET=1`** → **70/70**:
    the strict check (bundled Chromium makes no non-loopback connections) now **PASSES** — the Phase 5
    Google-service burst is eliminated in the packaged app. App processes stayed loopback-only; teardown
    left no zombie app/Chromium. **This resolves the Phase 5 egress WARNING** (see KNOWN_ISSUES #3).
- **Packaged-process teardown proven.** `scripts/helpers/packaged-process-tree.mts` captures the
  launcher-stub PID and the real Electron main PID (`app.evaluate(() => process.pid)`), tree-kills the
  real main on cleanup (including failure paths), and asserts no zombie app/Chromium remain — used by
  `verify:packaged-runtime` (**25/25**) and `verify:packaged-walkthrough` (**70/70**), both of which
  reported a fully-terminated process tree.
- **Packaging finding (this machine): max-compression packaging OOMs.** The default
  `npm run package:portable` / `package:nsis` (7-Zip `-mx=9` over the ~1.2 GB payload) failed with
  `Can't allocate required memory!` on this 16 GB machine, so the **shippable** max-compressed EXEs
  could not be produced here. `electron-builder` did rebuild `dist/win-unpacked` (the shared app
  payload — now **hardened**), and one-off `-c.compression=store` builds produced **hardened**
  validation-grade EXEs: portable `WebFlow Studio 0.1.0.exe` (~1.23 GB) + NSIS
  `WebFlow Studio Setup 0.1.0.exe` (~376 MB) + a regenerated `latest.yml` whose sha512 was
  re-verified against the new installer (MATCH). These are uncompressed-payload artifacts for
  validation only; produce the max-compressed + signed distributables on a higher-memory machine.
  The `package-portable.ps1` / `package-per-user-installer.ps1` wrappers were **fixed** to fail on a
  non-zero `electron-builder` exit (they previously printed success and left a stale EXE — see
  KNOWN_ISSUES). All packaged verifiers run against `dist/win-unpacked`, which is hardened.
- **Full re-verification green** (2026-07-07): build clean; `validate:offline` pass;
  `verify:chromium-hardening` 13; `verify:packaged-runtime` 25; `verify:packaged-walkthrough`
  (strict) 70; durable-store 11; durable-locks 17; cancellation 12; safety-policy 17;
  dynamic-origin-claims 14; resource-sampling 14; startup-recovery 10; concurrency 78; locks 15;
  browser-pool 13; watchdog 13; artifacts 13; runtime-status 15; runner 82; waits 21;
  protected-login 16; recorder 57; mock-site 28; stress:concurrency 13; stress:cancellation 8;
  stress:locks 10; stress:artifacts 7; soak:runtime 8; `ai:memory` pass. `npm test` / `npm run lint`
  still do not exist.
- **Release-candidate decision remains `PASS WITH WARNINGS`.** Egress is now hardened and proven, but
  the remaining human gates are unchanged: the clean/offline Windows VM walkthrough
  (`docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3), the NSIS install/uninstall cycle (integrity sha512
  verified only), producing signed + max-compressed distributable EXEs on a higher-memory machine, and
  code-signing (EXEs are unsigned).

**Last updated:** 2026-07-06 (Claude Fable 5 — Phase 5 Release-Candidate Gate, on top of Phase 4
Release Hardening. NEW: `npm run verify:packaged-walkthrough` (**68/68**) drives the REAL packaged
EXE (`dist/win-unpacked`, the exact portable/NSIS payload) with a **fresh empty LOCALAPPDATA
root** — clean first-run simulation: first-run init + folders + sample-only content, full workflow
run to `completed` with artifacts, hard cancellation (run ends `cancelled`, Chromium tree gone,
slot/locks freed), 4-instance run never exceeds the 2-browser OS-level cap, recorder start/cancel,
hard kill of the REAL main pid → startup recovery surfaces the run `orphaned`/recoverable, the
Recoverable Runs panel renders and markReviewed clears it, `runtime.sqlite` reads externally, the
ACTUAL portable EXE boots a second fresh profile, NSIS sha512 matches `latest.yml`, and the app's
own processes made ZERO non-loopback TCP connections (bundled-Chromium per-launch Google-service
burst documented as a WARNING — see KNOWN_ISSUES "Phase 5 packaged-walkthrough findings", which
also records the launcher-stub pid gotcha, `dryRun:false` requirement, and instance-id decoration).
Release-candidate decision: **PASS WITH WARNINGS** — the packaged build is validated on the dev
machine with a clean profile, but the true clean/offline Windows VM walkthrough
(`docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3) has NOT been performed (no VM available to the
agent) and remains the final human gate; EXEs are unsigned. Phase 5J full re-verification, all
green: build clean, `validate:offline` pass, `verify:packaged-runtime` 24, `verify:durable-store`
11, `verify:durable-locks` 17, `verify:cancellation` 12, `verify:safety-policy` 17,
`verify:dynamic-origin-claims` 14, `verify:resource-sampling` 14, `verify:startup-recovery` 10,
`verify:concurrency` 78, `verify:locks` 15, `verify:browser-pool` 13, `verify:watchdog` 13,
`verify:artifacts` 13, `verify:runtime-status` 15, `verify:runner` 82, `verify:waits` 21,
`verify:protected-login` 16, `verify:recorder` 57, `verify:mock-site` 28, `ai:memory` pass.
`npm test` / `npm run lint` still do not exist. See `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md`.)

## What currently works (Confirmed)

- **Build & typecheck:** `npm run build` (`tsc --noEmit` + electron-vite main/preload/renderer) passes.
- **AI memory handoff/takeoff:** `docs/ai/HANDOFF.md` is the active generic handoff note for Claude Code,
  Codex, Gemini, Antigravity, future agents, and human developers. `/HANDOFF` command/workflow files
  prepare the repo for the next agent; `/TAKEOFF` command/workflow files resume from the handoff by reading
  memory and inspecting actual repo state before editing. The AI memory checker requires `HANDOFF.md` and
  warns if important handoff sections are missing.
- **AI agent architecture:** Shared source of truth is `AGENTS.md` + `docs/ai/` (indexed by
  `docs/ai/README.md`); Claude Code uses `CLAUDE.md`, `.claude/commands`, and `.claude/skills`
  (`ai-memory-maintainer`, `codebase-review`, `feature-implementation`, `bug-fix`,
  `test-and-verify`, `docs-sync`, `refactor-safe`, `pr-review`, `mock-site-maintainer`);
  Codex/Antigravity/future agents use `.agents/skills` + `.agents/workflows` (including
  `mock-site-maintainer`); Gemini uses `.gemini/commands` and `.gemini/skills/mock-site-maintainer`;
  Cursor uses `.cursor/rules`.
  A cross-agent **`git-full-cycle`** skill (safe Git lifecycle: status, dirty-tree handling, branching,
  commit, push, PRs, protected `main`, stacked PRs) is mirrored byte-identically under
  `.claude/skills/`, `.codex/skills/`, `.gemini/skills/`, and a canonical `docs/ai/skills/` copy, and is
  referenced from `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`.
  `node scripts/ai-memory/check-memory.mjs` validates required memory files and warns for optional
  adapter/skill gaps.
- **Offline packaging:** `npm run package:portable` and `npm run package:nsis` produce
  `dist/WebFlow Studio 0.1.0.exe` (portable, ~310 MB) and `dist/WebFlow Studio Setup 0.1.0.exe`
  (per-user NSIS, ~357 MB) — both rebuilt 2026-07-06 with the `sql.js` durable-runtime dependency
  (WASM inside app.asar; unsigned; test-fixtures excluded). Strict offline validation
  (`validate:offline`) passes and now also requires the sql.js dist files + manifest flags;
  bundled Chromium at `resources/browsers/chromium/chrome.exe`; dependency manifest is BOM-free,
  valid, and declares `sqlJsRuntimeIncluded`/`sqlJsWasmIncluded`/`dependencies.sqlJs`. The packaged
  runtime is smoke-verified by `npm run verify:packaged-runtime` (24/24 — real EXE launch, durable
  store init, `%LOCALAPPDATA%` paths, external SQLite read).
- **Offline startup gate:** packaged app validates required assets before opening a window
  (`app/main/main.ts` + `evaluateOfflineStartupGate`); shows a styled blocking dialog if missing.
- **Runner execution (live-verified, `npm run verify:runner` → 82/82):** goto, click, fill
  (+clearBeforeFill), select (single/multiple), check/uncheck/radio, wait (time/selector/
  navigation/networkIdle/textVisible), assertion (visible/text/value/count/url × operators),
  scroll (direction/element), screenshot (full-page/element), upload, download, loop
  (fixed/elements/dataRows with guard), runFlow with recursion guard (direct/indirect/max-depth),
  **routeChange** (switchToUrl / switchToLatestTab / waitForNewTab / navigateCurrentPage — switches
  the active page so later steps target the new tab), **saveSession** (writes Playwright `storageState`
  — cookies + localStorage/origins — to `<runtimeRoot>/sessions/<name>.json`; never logs secret values),
  and manual/protected-login handoff pause/resume (the runner stays alive and continues the next browser
  step after `ManualHandoffController.resume`).
- **Multi-Window / Popup Flow Handling (live-verified, `npm run verify:popup` → 12/12):** `StepExecutor` handles steps with `pageAlias` by resolving the target window from a `PageRegistry`. Click steps with `opensPopup` wait for the new page event and register it. Explicit `switchToPopup`, `switchToMainPage`, and `closePopup` nodes mutate the active context for subsequent steps. Flow Designer canvas shows visual context badges.
- **Connector routing (live-verified):** flow-level success/failure/conditional/always; workflow-level
  link routing (success/failure/conditional/always) with strict traversal + linear fallback.
- **Structured connectors (Checkpoint B, live-verified):** every connector has a `kind` —
  `normal` / `conditional` / `parallel` / `loop` — with structured config on `FlowEdge`
  (`conditional`/`parallel`/`loop`). **Conditional** connectors (`ConditionalConnectorConfig`) route by a
  `sourceField` (outcome / status / errorCode / variable / dataSourceValue) + operator (equals, contains,
  exists, greaterThan, truthy, …) + `expectedValue`, with `priority` breaking ties (highest wins; no match
  → safe stop). **Parallel** connectors (`ParallelConnectorConfig`) honor `joinMode` (waitAll/waitAny) and
  `failMode` (failFast/collectErrors) plus an **`isolation`** mode: `sharedPage` (default) runs branches as
  sequential fan-out on the current page (safe, no concurrent UI mutation); `isolatedPage` runs branches
  **concurrently**, each on its own page in the shared browser context (shared session, independent DOM),
  bounded by `maxConcurrency`. **Loop**
  connectors (`LoopConnectorConfig`) are **self-loops only** — source and target must be the same node
  (Point 4) — and repeat that node in `count` / `staticList` / `dataSource` / `whileCondition` mode, bounded
  by `maxIterations` (hard cap 1000), injecting the loop value under `parameterName` (read via a
  `runtimeInput` value source); the node's own (Conditional-only, Point 3) exit edge then continues the flow.
  Evaluation lives in `src/runner/ConnectorConditionEvaluator.ts`; routing in `FlowExecutor`
  (`executeFlow` detects a self-loop edge on the current node and runs the whole loop in place via
  `executeLoopConnector` before any exit routing). The legacy `loopBack` edge type (Enhanced Connectors,
  Phase 1) remains an intentional **cross-node** back-edge and is exempt from the self-loop rule. Legacy
  edges (no `kind`) derive a kind from their `type` and keep executing via the expression-based paths (fully
  backward compatible). **Connector-structure safeguards (AWKIT points 1–5):** `validateConnectorStructure`
  (`src/profiles/FlowProfile.ts`) — reused by `FlowExecutor.executeFlow` as a runtime guard and mirrored by
  `connectorStructureIssues`/`scenarioConnectorStructureIssues` in the Flow Designer/Workflow Builder — blocks
  execution/Save when: a loop connector doesn't return to the same node; a node has more than one standard
  (non-conditional/non-parallel) outgoing connector; or a node with a self-loop has a non-Conditional
  additional outgoing connector. Both canvases' kind/link-type selectors disable the disallowed options with
  explanatory helper text. **Branch-pair ports (Rules 3/4):** the source (right) side is a single centered
  `normal-out` port by default; once a **conditional** or **parallel** connector leaves the node it becomes
  a two-port **branch pair** — exactly two same-kind ports `<kind>-out-0/1` (evenly centered via
  `portPositions(2)`), so each of the (max 2) branch connectors aligns to its own port instead of sharing
  one handle (`ConnectorPortFlags.sourceKind`, `branchSourceHandle`, `reconcileBranchConnectors` in
  `connectorStyle.ts`). `reconcileBranchConnectors` slots each pair and, on deletion (`revertSources`),
  reverts a lone surviving branch connector back to **Normal** (single centered port). `ActionFlowNode` and
  `ScenarioFlowNode` call `useUpdateNodeInternals` when `portFlags` change so newly rendered dynamic handles
  are draggable, not only visible. Target (left) side
  keeps a `normal-in` port plus a `conditional-in`/`parallel-in` port for incoming branch connectors. Ports
  render as **siblings of the node card** (not children) so React Flow positions them against the
  un-clipped `.react-flow__node` wrapper (the card's `overflow: hidden` would otherwise clip the
  edge-hugging handles). **Kind changes only in the properties panel (Rule 1):** a `normal` connector's
  kind list offers Normal/Conditional/Parallel (Loop shown disabled — it's created only by the node's loop
  button); once conditional/parallel, the kind **and** type selects are **locked** until a connector is
  removed. `onConnect` in both `FlowChartDesigner.tsx`/`ScenarioBuilder.tsx` caps branch connectors at 2
  and reconciles; if the source already has a self-loop, a new connector is forced to Conditional.
  **Loop connector creation:** a small circular loop button
  (top-right of each node, `ActionFlowNode.tsx`/`ScenarioFlowNode.tsx`) is an **add/remove toggle** —
  clicking it creates the self-loop edge (source=target=that node, kind/type `loop`, circular shape), and
  once a loop exists the button turns filled and removes it on click (the loop is also selectable +
  deletable as a normal edge). **Top loop port + semicircle:** loop connectors attach to a dedicated
  `loop-out`/`loop-in` handle pair on the node's **top** edge (`ConnectorLoopPort`, always present so the
  edge attaches immediately, visible only when a loop exists — `.connector-port-loop.active`); the shared
  `SelfLoopEdge.tsx` detects a self-loop via `source === target` (node identity, not coordinates) and draws
  a visible **semicircle arcing above** the node. **Circular shape:** `EdgeVisualStyle.shape` includes
  `"circular"`, rendered by `SelfLoopEdge` (registered edge type `circular`, also used as the general
  "curved" option for distinct-node edges); loop connectors default to it automatically. The Flow Designer
  Connection Properties panel has a **kind selector + per-kind fields** (incl. a **data-source dropdown** for
  loop `dataSource` mode); `validateFlow` checks conditional expected-value/variable, loop bounds/config,
  ambiguous same-priority conditionals, and the connector-structure rules above. Connector routing also emits
  **live-report timeline events** (conditional matched, parallel fan-out, loop iteration, Auto Secure Login
  restart) via the `RunnerProgressReporter` — no secrets. **Workflow Builder runtime guard:** the same
  connector-structure rules now run through `FlowDependencyResolver` / `ScenarioOrchestrator.createExecutionPlan`
  before workflow execution, so a saved or externally edited invalid workflow graph that bypasses the
  renderer Save gate is blocked at runtime (verified by `verify:runner`).
- **Enhanced Connectors (Phase 1, live-verified):** new flow edge types `outcome` (routes on the step's
  own result via `${stepResult.*}` scope), `loopBack` (controlled back-edge gated by `maxLoopCount`,
  default 2; exhaustion falls through to success/always instead of erroring), and `parallel` (sequential
  fan-out to multiple targets, then converge). `resolveNext` in `FlowExecutor` orders outcome →
  conditional → conditional loopBack → success → always → unconditional loopBack → legacy `next`.
  Workflow-level `chooseNextFlow` also honors `outcome` links. Colors/animations and the Connection
  Properties panels (Flow Designer + Workflow Builder) expose all new types. Backward compatible.
- **Auto Secure Login node:** `autoSecureLogin` reuses a saved session for the target URL when one is
  ready — matched by **normalized origin** (protocol+host+port), so different paths on the same site reuse
  the same login (`outcome: sessionAlreadyExists`). Otherwise it closes the automation browser, launches the
  user's real Chrome via `SessionCaptureService.startCapture(..., "autoSecureLogin")`, waits for the manual
  login, then relaunches Playwright with a `persistentContext` bound to the captured profile
  (`outcome: sessionCaptured`, `restartRequired: true`). Enabled by a `BrowserRestarter` callback in
  `PlaywrightRunner` (mutable browser holder that re-points the live `StepExecutor` at the new page) +
  `sessionService` injected from `ExecutionEngine`. **Restart:** two mechanisms — the engine-level guard in
  `FlowExecutor` restarts the flow from Start on `restartRequired` (bounded by `MAX_AUTO_LOGIN_RESTART = 1`,
  fails safely with a clear message if the session still can't be reused), AND a user-drawable `outcome`/
  `loopBack` edge back to Start still works for explicit flows.
- **Reuse Session node:** `reuseSession` loads a previously-captured session profile and restarts the
  automation browser on its `userDataDir` (`outcome: sessionLoaded`, marks the session used). Two modes:
  **Auto detect** (default) resolves a ready session by normalized origin from the node's optional Target
  URL or the current page URL; **Selected** uses a specific session chosen from a `SearchableSelect` of ready
  sessions. No-match in auto-detect fails safely with `outcome: sessionNotFound`. The browser swap is now a
  generation-guarded two-phase relaunch: launch and verify the new persistent context/page, publish the new
  runtime, re-point the active `StepExecutor`, close the old generation with an explicit reason, and verify
  the new runtime remains alive for at least 2 seconds. Old page/context/browser close or disconnect events
  are ignored by generation guard, duplicate swaps are blocked by a per-instance mutex, locked session
  profiles fail clearly before `Navigate`, and every step runs a browser/page liveness check first. Real
  Electron verification of `Smart-Rec-Chatgpt` on 2026-07-05 showed `Reuse Session` succeeded and
  `Navigate to https://chat.openai.com` succeeded without `Target page, context or browser has been closed`.
- **Session registry metadata:** `SessionProfile` now carries `origin`, `loginUrl`, and `source`
  (`autoSecureLogin` | `manual` | `imported`); `SessionCaptureService.list()` backfills `origin`/`source`
  for legacy profiles. Sessions Manager shows a **Source** column + origin subtitle. Sessions live under a
  dedicated automation profile dir `%LOCALAPPDATA%/WebFlow Studio/profiles/<id>` (never the user's daily
  Chrome profile); session artifacts are git-ignored.
- **UI:** Flows & Workflows tables with pagination + advanced search/filter (persisted);
  Flow Designer with node registry/type-specific properties, node resizing, zoom % control,
  collapsible Node Palette/Properties; Workflow Builder with resizable Workflow Definition panel
  and collapsible sections; styled unsaved-changes dialog; full Settings screen.
- **Resize handles only on selected node:** the `NodeResizer` uses `isVisible={selected}`, and a
  CSS rule (`.react-flow__node:not(.selected) .react-flow__resize-control { display:none }` in
  `app/renderer/styles/global.css`) guarantees unselected nodes never show resize handles/lines.
  Selecting another node moves the handles; clearing selection hides them. Resize + persistence
  still work.
- **Protected Login Handoff:** the runner detects protected/automation-blocked login pages
  (`src/security/ProtectedLoginDetector.ts` — Google/Microsoft/Okta/Auth0/Duo URLs + Google
  "browser may not be secure"/CAPTCHA/MFA/security-check text) after navigation steps. In workflow runs with
  session lifecycle services available, detection now **pauses**, closes the Playwright automation browser,
  launches the user's normal Chrome/Edge at the detected login URL via `SessionCaptureService.startCapture`
  (`manualChromeHandoff`), waits for the user to complete login and close that browser, validates captured
  profile data, relaunches Playwright on the captured persistent profile, marks the session used, and
  continues the same workflow. Capture uses the Protected Login Handoff timeout (`handoffTimeoutMs`, where
  `0` disables the timeout for explicit nodes) and never inherits a triggering navigation/action timeout, so
  auto-detected protected login after `goto` leaves the normal browser open for the human login window. This
  mirrors the recorder secure-login handoff; no protected page is automated or scraped. If no session-capture
  service is available, it falls back to the existing manual
  `waitingForManualAction` pause. The explicit `protectedLoginHandoff` Flow Designer node uses the same
  capture path when possible. OAuth foundation
  (`src/auth/OAuthHandoffService.ts` + `auth.*` IPC) is capability-gated via `WFS_OAUTH_*` env and uses
  `shell.openExternal`; no bypass, no fake tokens, no secrets logged. See
  `docs/PROTECTED_LOGIN_HANDOFF.md`.
- **Session Capture Browser (manual login workaround):** a Sessions Manager page
  (`app/renderer/pages/SessionsManager.tsx`, route `sessions` in the Data nav group) lets users
  capture login sessions by launching the system's **real Chrome or Edge browser** via
  `child_process.spawn` with a custom `--user-data-dir` — no Playwright, no CDP, no automation
  flags. The core service (`src/session/SessionCaptureService.ts`) detects installed browsers at
  standard Windows paths, creates named profile directories under `%LOCALAPPDATA%/WebFlow Studio/
  profiles/`, monitors the browser process, and saves metadata to `session-profiles.json`. IPC:
  `session.ipc.ts` (`session:list`, `session:startCapture`, `session:getStatus`, `session:delete`,
  `session:rename`, `session:detectBrowser`, `session:stopCapture`, `session:getById`,
  `session:markUsed`); preload `session.*`. When a workflow run includes a `sessionProfileId`,
  `execution.ipc.ts` resolves the profile directory and forces `persistentContext` isolation mode
  (`BrowserContextFactory.launchPersistentContext` with the session's `userDataDir`). This lets
  automation runs reuse the full login state (cookies, IndexedDB, Service Workers, localStorage)
  without triggering automation detection. Build & runner verified: `npm run build` clean,
  `npm run verify:runner` → 44/44.
- **Shared connector visuals + style customization:** `components/shared/connectorStyle.ts`
  (`buildConnectorVisual`) is the single source for edge visuals in both the Flow Designer and Workflow
  Builder, so connectors look identical. A shared `ConnectorStyleEditor` in both Connection Properties
  panels customizes color/line-style/thickness/shape/arrowhead; the style persists on `FlowEdge`/
  `WorkflowEdge` (`EdgeVisualStyle`) and reloads. Legacy connectors (no style) render with type defaults.
- **Flow Designer UX:** Node Palette has a search box (filter by label/type/description/category); long
  node-property dropdowns (JSON Data Source, Target flow, Saved Flow) use a searchable combobox
  (`SearchableSelect`). Clicking a Flows-table row opens that flow in the Flow Designer.
- **Flow Designer Smart Wait editing (2026-07-04):** saved steps preserve `beforeWaits`/`afterWaits`.
  Node Properties shows a Smart Waits section when a selected node has waits, split by before/after phase,
  with type/condition/reason details plus timeout editing, per-wait remove, and clear-list controls.
- **Route Change node (Flow Designer):** palette item + Route Change properties section (mode, URL
  match, URL value, wait-until) with mode-aware validation (incl. invalid-regex). At run time
  `StepExecutor` keeps a mutable `activePage` (+`setActivePage`) and `LocatorFactory.setPage` so later
  steps target the switched tab/page.
- **Workflow Builder navigation + resize + search:** double-clicking a workflow flow node opens that
  flow in the Flow Designer (persists `selections.lastSelectedFlowId` + `selectedBuilderWorkflowId`,
  navigates via the unsaved-changes guard; Back restores the workflow). Workflow nodes are resizable
  (`NodeResizer`, size persisted in `WorkflowFlowNode.size`). Saved Flows list has a name search and a
  10-at-a-time "Load More".
- **Save success/failure toasts:** Flow Designer and Workflow Builder show an app-styled `Toast`
  (`components/shared/Toast.tsx`) on save ("… saved successfully: <name>" / "Failed to save changes").
  The Data Source Editor uses its existing success/error banner.
- **Instance Monitor (Concurrent Instance Monitor):** Clear Completed removes terminal instances from the
  backend pool (so the 1s poll can't re-add them); per-instance + toolbar controls all map to real
  `executionEngine` methods; file/artifact buttons (Logs/Screenshots) are enabled ONLY for `failed`
  instances that have a path (disabled for completed/others, with status-specific tooltips). A per-instance
  **Repeat** button (`executionEngine.repeatInstance`) re-runs a finished instance from its retained
  run context (enabled only for terminal instances).
- **Workflow cards grid (primary run UX):** the monitor shows saved workflows as an enterprise-styled card
  grid (`components/instances/WorkflowRunCard.tsx`). Each card shows status (Active/Inactive/Invalid),
  flows/connectors/mode/data-source/updated, and reveals per-card run parameters on hover/keyboard focus
  (independent per workflow, seeded from `settings.execution`, persisted to `settings.workflowRunCards`).
  Run launches that workflow; **multiple workflows can run concurrently** (instance ids are globally unique
  per execution). Search filters by name/description; the grid **always renders every card** and, once the
  cards exceed two rows, becomes a two-row-tall internal scroller (no "Load More" button). The old
  dropdown form is collapsed behind an "Advanced / Classic run form". The instance table has a **Workflow
  column** (resolves `scenarioId` → name; deleted/unknown handled). Card `isolationMode`/`stopOnError` are
  passed through to the run; screenshot-on-failure is shown disabled (it's a per-step flow setting).
  The instance table's **Live Report** button (replacing the open-JSONL button) opens a human-readable
  `LiveExecutionReportModal`: live banner + heartbeat, connected horizontal **per-step process flow** with
  numbered status nodes, real progress bar, statistics cards, and a masked activity timeline. Failed steps
  show a friendly end-user message in the node, with masked technical details available only via hover/focus
  tooltip. Active/running/waiting/manual-action nodes animate; terminal runs show a stable final update time
  instead of an endlessly advancing "Updated" counter. **Live progress is now real:** `StepExecutor` emits per-step events via a
  `RunnerProgressReporter`; `ExecutionEngine` folds them into a bounded `InstanceRuntimeState.liveProgress`
  snapshot (≤500 steps / ≤200 events), which the renderer's 1s poll renders live. Once finished, the stored
  report (`reports.get(executionId)`) supplies the per-step detail. JSONL/report generation and execution
  behavior are unchanged.
  Cards are **equal-height** (fixed `min-height`) on a stable **3-column grid**
  (`repeat(3, minmax(0,1fr))`; 2 cols ≤1080px, 1 col ≤680px) so cards-per-row and dimensions stay the same
  before/after Load More. They use a **two-layer cross-fade** (summary ⇄ params) on hover/focus that does
  **not** change card height (no grid reflow). Search bar and Load More button are full content width.
- **Snapshot-based unsaved-changes detection:** Flow Designer (`FlowChartDesigner.tsx`) and
  Workflow Builder (`ScenarioBuilder.tsx`) compute `isDirty` by comparing an order-independent
  JSON serialization of the *saveable* document against a baseline captured on load and on save
  (`serializeFlowDoc` / `serializeWorkflowDoc`). The dialog appears ONLY for real document changes
  (node add/remove/move/resize, property edit, connector add/remove/change, metadata/data-source/
  execution-settings change). It does NOT appear on open, selection, zoom/pan, React Flow's initial
  node measurement, or after a successful save (baseline is reset to the saved doc).
- **Settings & state persistence:** `app/main/uiSettings.ts` store under
  `%LOCALAPPDATA%/WebFlow Studio/storage/ui-settings.json`; persists route, sidebar, panels,
  widths, zoom, selections (node/connector/flow/workflow/data source), table state, run defaults,
  paths, lastLaunchedAt. Custom paths are consumed by writers (flows/workflows/data sources/
  reports/screenshots/downloads/logs).
- **Recorder & runner** launch the **bundled Chromium** in production-offline mode.
- **Recorder AWKIT extensions (2026-07-04):** (1) **Capture waiting time** toggle in Recorder Controls
  (default OFF, persisted `settings.recorder.captureWaitTime`) — when ON, `RecorderService` measures
  think-time between distinct actions and inserts `wait` actions for pauses ≥ 500 ms (capped 60 s), saved
  as fixed-time wait steps (`config.waitType:"time"`, `timeoutMs`). (2) Recorded flows always open with
  default **Start** and **End** nodes and actions wired between them (`Start → action… → End`, or
  `Start → End` when empty) via the pure `src/recorder/buildRecordedFlow.ts` (unit-verified). (3) **Reusable
  saved-URL history** now lives in its own deduped/canonicalized `recorder-urls.json` (survives
  save/cancel/restart, separate from the transient action draft); `recorder:saveUrl` IPC + a "Save URL"
  button persist a typed URL, and clicking a saved URL row fills the Controls URL field. Verified by
  `npm run verify:recorder-draft` (17/17) and `npm run verify:recorder-flow` (13/13). (4) **Smart Wait
  observation** (default ON via `settings.recorder.captureSmartWaits`, visible Recorder toggle) passively
  observes loaders, fetch/XHR completion, URL changes, table/list/card data growth, enabled controls,
  toasts, and fixed-delay fallback windows, then stores high-confidence `afterWaits` on the preceding
  recorded action. It records method + URL path/status/timing only for network signals; never headers,
  bodies, cookies, query tokens, or response contents. The Recorder action list summarizes captured Smart
  Wait types. Verified as part of `npm run verify:recorder` (57/57).
- **Designer empty-canvas collapse (2026-07-04):** Clicking empty canvas in the Flow Designer and Workflow
  Builder collapses the app side menu (`navigation.collapseSidebar()`), Node Palette / Workflow Definition,
  and Node Properties / Selected Connector panels (collapse-only, idempotent, persisted). Node selection
  still auto-opens the properties panel; connector selection opens the connector panel (Workflow Builder
  expands its right panel on edge click). Last-opened flow/workflow restore now clears a stale reference
  when the saved flow/workflow was deleted.
- **Instances two-row card scroller (2026-07-04):** The workflow-card grid always renders every card; the
  "Load More workflows" button was removed. Once the cards exceed two rows
  (`filteredWorkflows.length > visibleCardCount(gridColumns, 2)`), the grid becomes a **two-row internal
  scroller** (measured height + `.workflow-card-grid.is-scrolling`) so the rest of the Instances page stays
  put; at two rows or fewer it renders at natural height with no scroller.
- **Recorder unique locators + Smart Wait observation (live-verified, `npm run verify:recorder` → 57/57):** the injected capture
  script (`src/recorder/recorderInitScript.ts`) generates ranked candidate locators (role/label/
  placeholder/text/testId → stable attributes → id → scoped → positional fallback — never utility/layout
  classes like `flex`/`items-center`), validates uniqueness against the live DOM, and saves the best
  `count === 1` candidate with `LocatorQuality` metadata (`isUnique`/`matchCount`/`confidence`/`warning`/
  `candidateCount`) + an `exact` flag for role/text. The positional fallback (`structuralSelector`) is
  itself guaranteed unique: it walks up prepending one `:nth-child` segment per ancestor and stops at the
  shortest path that resolves to a single element (or an id-anchored path), so it no longer emits floating
  child-chains like `div > div > … > svg` that match many subtrees. Human-readable step names ("Click Log
  in"); password values are never stored. Node Properties shows locator quality and won't mark a non-unique
  node valid.
- **Smart Locator runtime fallback + context scoping (live-verified, part of `verify:recorder` 57/57):**
  `FlowStep.locator` is a structured `StepLocator` (`src/profiles/FlowProfile.ts`) with the primary plus
  optional `alternatives: LocatorCandidate[]` (ranked runtime fallbacks) and `context` (container/frame
  scope). The recorder emits both: up to 3 alternatives and a `context` for the nearest **visible dialog**
  (`visibleOnly`), **table row** (role=row + row text), **card/list item** (testId/role + `hasText`), or
  **iframe** (`frameLocator` selector, same-origin). At run time `LocatorFactory.resolve(step)` builds a
  scoped root from `context`, then tries primary → alternatives, returning a **single** element per
  candidate — a unique match wins, else the one *visible* match when several exist (**visibility
  disambiguation**, the fix for a hidden modal template + a visible modal). It auto-waits on the primary
  when nothing is present yet, and throws an actionable diagnostic (per-candidate count/visibleCount +
  context) when genuinely ambiguous. `StepExecutor` routes single-target actions through `resolve` (count
  assertions / element loops / `waitFor` keep the plain `create`); `guardLocatorQuality` defers to the
  resolver when a step has `context`/`alternatives`. Fully backward compatible — legacy steps (primary
  only) resolve unchanged. Playwright is 1.49 (no `filter({ visible })`); visibility is probed via
  `nth(i).isVisible()`. Not yet surfaced in the UI (no locator-quality badge / debug candidates table /
  manual override editor).
- **Data Source visual table editor:** edit root-array JSON data sources as a table
  (cells/rows/columns), create from scratch, save real files to the configured data-sources path
  (bundled samples migrate on save). Logic verified by `npm run verify:data-editor` (27/27) incl. a
  real file read→edit→save round-trip; GUI not exercised here.
- **Mock Site Feature Test Lab (2026-07-04):** `mock-site/` is the mandatory local offline test surface for
  Recorder, Runner, Smart Wait, Flow Designer, Workflow Builder, Instance Monitor, locator, node, wait, and
  execution work. Stable URLs: `/` (scenario index), `/login`, `/form`, `/details`, `/success`,
  `/smart-waits`, `/recorder-lab`, `/designer-lab`, and `/api/delay?ms=...`. New/changed scenarios must
  document title/description/expected behavior/related feature/stable selectors in `mock-site/README.md`
  and be covered by `npm run verify:mock-site` or a focused feature verifier. Current verifier:
  `npm run verify:mock-site` -> 28/28.
- **Test-only mock fixtures** (new): `npm run seed:mock-fixtures` imports 10 flows, 3 workflows, and
  1 data source (all `mock-` prefixed) that target the offline mock-site into the runtime userData
  folders. Source fixtures live in `resources/test-fixtures/mock-site/` (excluded from packaged
  builds). They do NOT auto-load — a fresh install still shows empty Flows/Workflows/Data Sources.
  See `resources/test-fixtures/mock-site/README.md`.

- **Recorder secure-login browser handoff (2026-07-04):** while recording, `RecorderService` watches
  every page/popup load via `detectRecorderProtectedLogin` (`src/security/ProtectedLoginDetector.ts` —
  conservative stable DOM signals `input[type=password]`, `input[autocomplete=one-time-code]`,
  `iframe[src*=recaptcha|hcaptcha|turnstile]`, `[aria-label*=captcha|verification]`, passkey/webauthn +
  provider/text patterns incl. verification-code/OTP/MFA/passkey/digital-signature/external-approval). On
  the first detection it **pauses** recording, preserves the draft, stores secret-free handoff metadata
  (source alias, origin, reason, signals, timestamp, draft id, resume URL), and **closes the automation
  browser** — it never automates or scrapes the protected page. The Recorder page shows a handoff panel
  (`data-testid="protected-handoff-panel"`) with **Continue using normal browser** (launches the user's real
  Chrome via `SessionCaptureService.startCapture(..., "manualChromeHandoff")` at the detected URL, app-owned
  scoped profile under `%LOCALAPPDATA%/WebFlow Studio/profiles/<id>` — never the user's daily Chrome
  profile), **Capture Session & Resume** (validates captured session via `hasCapturedData`, optional name,
  inserts `Auto Secure Login` + `Reuse Session` nodes at the front of the draft with the session id linked to
  Reuse Session — deduped, then relaunches Playwright with `launchPersistentContext` on the saved profile,
  navigates to the safe resume URL, and resumes recording), and **Cancel**. No secrets (passwords, OTPs,
  CAPTCHA values, cookies, tokens) are captured or logged. New IPC: `recorder:getHandoff`,
  `recorder:continueWithNormalBrowser`, `recorder:captureSessionAndResume`, `recorder:cancelHandoff`
  (+ preload `recorder.*`). `buildRecordedFlow` serializes `autoSecureLogin` (target URL → `step.value`) and
  `reuseSession` (`config.reuseSessionMode="selected"` + `reuseSessionId`). Mock Site scenarios
  `/mock/protected-login`, `/mock/protected-popup-login`, `/mock/protected-popup-captcha`,
  `/mock/protected-popup-otp`, `/mock/session-reuse`. Verified: `npm run verify:protected-login-recorder`
  (34/34), `verify:protected-login` (16/16), `verify:recorder` (57/57), `verify:mock-site` (28/28),
  `verify:popup` (12/12), `verify:runner` (76/76), `npm run build` clean. Detection reuses the same signals
  as the runner-side Protected Login Handoff; runtime replay of the inserted nodes uses the existing
  Auto Secure Login / Reuse Session runner behavior.

- **Concurrency & stability layer (2026-07-06, verified `npm run verify:concurrency` → 78/78):**
  `src/runner/concurrency/` (ResourceLockManager — exclusive/shared/semaphore locks with TTL leases,
  monotonic fencing versions, atomic multi-acquire, stale sweep, debug snapshot; Semaphore;
  ConcurrencyConfig with `AWKIT_*` env overrides; BackpressureController + CapacitySnapshot),
  `src/runner/browser/BrowserWorkerPool.ts` (bounded browser slots — one browser runtime per running
  instance, default cap 2 per host, health/crash-window tracking, refuses work when saturated),
  `src/runner/runtime/` (FlowRunStatus/NodeStatus state machines with recorded transitions, NodeAttempt
  log, ErrorClassifier, RetryPolicy, InstanceHeartbeat, WatchdogService), `src/runner/artifacts/`
  (RunLogger — masked JSONL to the per-instance `paths.logs` file that was previously never written;
  RunStateArtifacts — `flow-state.json`/`node-attempts.json`/`capacity.json`/`locks.json` under
  `<instance storage>/state`), and `src/profiles/ProfileLockManager.ts`. Enforced rules: a persistent
  profile (`userDataDir`) is an exclusive locked resource (`BrowserContextFactory` acquires before
  `launchPersistentContext`, releases in the close path — plus the existing on-disk `Singleton*` check
  for external browsers); instance dispatch passes backpressure admission (pool saturation, active-flow
  cap, host free-memory floor, crash rate) and queues with a logged reason instead of overloading the
  host; step retries are classification-gated (transient navigation/timeout/locator/download only,
  exponential backoff; submit/approve/delete/send/pay/confirm-looking mutations and dead
  browser/context/page failures never auto-retry); isolated parallel branches are clamped by
  `maxActiveNodesPerFlow`; every progress event heartbeats `InstanceRuntimeState.runtime` (additive —
  UI `status` values unchanged); the watchdog (15s, unref'd) marks orphaned instances failed, notes
  stale heartbeats, and sweeps expired locks. Existing behavior preserved: `verify:runner` 82/82 and
  `verify:waits` 21/21 pass unchanged.
  **Phase 2 (2026-07-06, review in `docs/ai/CONCURRENCY_PHASE2_REVIEW.md`):** per-step **failure
  traces** (`TraceService` chunks; failed engine-run steps save `traces/<stepId>-<ts>.zip` before any
  cleanup; success discards; `AWKIT_TRACE_MODE` off/onFailure/always; armed only when
  `instance.paths.traces` is provided, so verify scripts/direct runners have zero overhead);
  **failure screenshots default on** (`onFailure.screenshot: false` opts out, best-effort);
  **origin/account dispatch semaphores** (`DispatchClaims`: `origin:<host>` from baseUrl/first goto,
  `account:<envFile>`; `AWKIT_MAX_PER_ORIGIN`=2, `AWKIT_MAX_PER_ACCOUNT`=1; a saturated key queues
  only instances targeting it); heartbeat refresh on `resumeInstance`/`retryHandoff` (no stale-note
  false positives after manual handoff); **runtime status surface**: `execution:runtimeStatus` IPC →
  `executions.runtimeStatus()` preload → read-only Instance Monitor strip (browsers/flows/pages/
  queued/locks incl. stale, crashes, backpressure reason, last watchdog action), backed by
  `getRuntimeStatus`/`getLockSnapshot`/`getBrowserPoolSnapshot`/`getWatchdogSnapshot`. Node attempts
  now carry `tracePath` + sanitized `currentUrl`. New deterministic verifiers: `verify:locks` (15),
  `verify:browser-pool` (13), `verify:watchdog` (13), `verify:artifacts` (13, live Chromium),
  `verify:runtime-status` (15). Locks/pool/watchdog remain **single-Electron-main-process** only;
  cross-process profile safety is the on-disk `Singleton*` check.
  **Phase 3 (2026-07-06, `docs/ai/PHASE3_DURABLE_RUNTIME.md`, verified — 95 new checks):**
  durable runtime under `<runtime root>/runtime/`: `runtime.sqlite` (real SQLite file via
  `sql.js` WASM — runs, node attempts, heartbeats, cancellations, watchdog events, artifacts,
  capacity snapshots; versioned migrations; single-writer with atomic-rename persistence,
  ≤300ms loss window on hard kill) + `locks/` (atomic wx-file **cross-process** locks with
  fencing versions, TTL/dead-pid stale quarantine — two AWKIT app processes can no longer share
  a persistent profile; `ProfileLockManager.acquireDurable` enforces both layers).
  **Hard cancellation:** Stop/stopAll → durable cancellation record → handoff wake → token
  cancel → the runner closes the live browser generation; in-flight actions reject in seconds,
  `cancelled` error class never retries, run ends `cancelled` with slot/claims/profile locks
  released and artifacts written. **Safety metadata:** optional `FlowStep.safety`
  (`sideEffectLevel`, `retryable`, idempotency-key requirements) is authoritative; node-type
  defaults classify legacy/recorder steps; keyword heuristic is fallback-only; unknown custom
  types are conservative (no auto-retry). **Dynamic origin claims:** cross-origin navigation
  mid-flow acquires the new `origin:*` semaphore (in-memory + durable) before releasing the old,
  bounded by `AWKIT_ORIGIN_CLAIM_TIMEOUT_MS`; saturation fails only that step (retryable).
  **Resource sampling:** system/process memory + CPU deltas gate dispatch
  (`AWKIT_MAX_SYSTEM_MEMORY_PERCENT`/`AWKIT_MAX_PROCESS_MEMORY_MB`/`AWKIT_MAX_CPU_PERCENT`) and
  render in the Instance Monitor strip. **Startup recovery:** interrupted prior-instance runs
  are marked orphaned/recoverable (safe to re-run) or failed/manual-review (dangerous node in
  flight — never auto-resumed); recoverable runs + stale durable locks appear in runtime status.
  `AWKIT_DURABLE_STORE=0` disables durability (tests/dev).
  **Phase 4 Release Hardening (2026-07-06, `docs/ai/PHASE4_RELEASE_HARDENING.md`):** explicit
  sql.js WASM resolution (`src/runner/store/SqlJsLoader.ts` — module resolution + `locateFile`,
  path exposed for diagnostics; works in dev/tsx/app.asar); durable runtime initialized at **app
  startup** via `registerExecutionIpc` so recovery is visible right after restart;
  `RuntimeStatusSnapshot.environment` diagnostics (appMode/runtimeRoot/sqlitePath/artifactsRoot/
  sqlJsWasmPath/durableStoreEnabled) logged once at init and asserted by the packaged smoke
  verifier; **Recoverable Runs panel** in the Instance Monitor (`RecoverableRunsPanel.tsx`) with
  per-run Details (last node/safety level/last URL/error class/trace/screenshot), Open artifacts
  (`system:openPath`), Re-run workflow (safe runs only), Mark reviewed / Mark abandoned (IPC
  `execution:recoveryDetails`/`execution:recoveryAction`, engine `getRecoveryDetails`/
  `applyRecoveryAction`, durable statuses `reviewed`/`abandoned`); packaging config + offline
  manifest + validators require the sql.js runtime/WASM; portable + NSIS rebuilt and the packaged
  runtime smoke-verified (`verify:packaged-runtime` 24/24); five deterministic stress/soak
  verifiers added (46 checks, tunable via `AWKIT_STRESS_*`); `DurableLockStore` hardened against
  the Windows EPERM/EBUSY wx-create race (found by `verify:stress:locks`).

## Partially implemented / to verify

- **Both connector canvases are GUI-VERIFIED in the real app (2026-07-03).** The un-clipped ports,
  top loop port, semicircle self-loop, add/remove loop toggle, conditional-lock, and real second-branch
  drag/delete survivor-revert path were driven in the **real running Electron app** via
  `npm run verify:flow-designer` (Flow Designer, 19/19) and `npm run verify:workflow-builder` (Workflow
  Builder `.scenario-flow-node`, 13/13, on saved "Mock — Data-Driven Workflow") — both Playwright
  `_electron` scripts. `npm run build` (clean), `npm run verify:runner` (76/76), and
  `npm run validate:offline` also pass. The `npm run dev` launch blocker was root-caused and fixed (it was
  `ELECTRON_RUN_AS_NODE=1` in the agent env, not a version mismatch — see below).
- **Clean/offline Windows VM walkthrough not yet performed (Phase 5 gate).** The dev-machine half is
  now automated and green — `npm run verify:packaged-walkthrough` 68/68 drives the real packaged EXE
  on a fresh empty profile (first run, workflow run, cancellation, kill+recovery incl. the real UI
  panel, browser bound, portable boot, NSIS hash, loopback-only app traffic) — but it still executes
  on the dev machine. The human checklist in `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 (offline
  VM, no dev toolchain) remains the final gate; no VM/Windows Sandbox was available to the agent
  (`WindowsSandbox.exe` absent). The NSIS installer's install/uninstall cycle has never been
  exercised anywhere (sha512 integrity vs `latest.yml` verified only).
- **Bundled Chromium startup egress (Phase 5 WARNING).** Every bundled-Chromium launch emits a short
  burst of Google-service TCP connections (path-attributed; app processes stay loopback-only; plain
  Playwright launch options). Harmless offline (attempts fail), but a hard no-egress guarantee would
  need explicit Chromium kill-switch flags in `BrowserContextFactory.createLaunchOptions` — see
  KNOWN_ISSUES "Phase 5 packaged-walkthrough findings" §3.
- **EXEs are unsigned** — Windows SmartScreen will warn on first launch (no code-signing configured).
- **`@playwright/test` runner** cannot load the TS/ESM config on Node 18.16 (needs Node ≥18.19);
  the committed `tests/runner.mocksite.spec.ts` runs there, but live verification here uses the
  `tsx` script `scripts/verify-runner.mts` instead.

## What must NOT be broken

- Offline-first guarantees (no runtime internet, no global Node/Playwright/Chromium, no writes to
  `resources/`/`app.asar`).
- The `window.playwrightFlowStudio` preload API contract (used across the renderer).
- The dependency-manifest must stay valid + BOM-free and reference `WebFlow Studio` paths, or the
  packaged startup gate / strict validation will fail.
- Bundled-Chromium resolution (`BundledBrowserResolver` → `resources/browsers/chromium/chrome.exe`).

## Current technical debt

- Renderer bundle is large (~900 KB JS) — no code-splitting.
- No automated lint; no unit-test suite beyond the runner verification script.
- Historical product spec docs (`playwright_flow_studio_updated_phases/`, some `change_requests/`)
  still say "Playwright Flow Studio".
- Runtime data root renamed to `WebFlow Studio`; data under the old `PlaywrightFlowStudio` folder
  is not migrated (acceptable pre-1.0).

## Next logical steps

0. **In-progress initiative (2026-07-07):** UI/UX refactor + reports/analytics. Enhanced execution
   pack in `docs/ai/ui-reports-refactor/` (`09_EXECUTION_PLAN.md` = 14 phases). Theme decided:
   **light-first**. Git/Phase 0 skipped per user instruction (work stays on
   `feature/smart-wait-engine`).
   - **Phase 2 DONE (design-system foundation):** added the `--awkit-*` light-first token block to
     `app/renderer/styles/global.css` (surfaces/text/accents/status/bands/depth/motion/z — additive,
     existing hard-coded colors untouched); new `awkit-`-namespaced shared primitives in
     `app/renderer/components/shared/`: `StatusBadge`, `SectionHeader`, `SkeletonCard`, `EmptyState`,
     `TrendDelta`, `AnimatedCounter`, and the `usePrefersReducedMotion` hook; extended `MetricCard`
     additively (`trend`/`tone`/`loading` optional props; `value` widened to `ReactNode`); global
     `prefers-reduced-motion` block (last in the cascade). Verified: `npm run build` clean;
     `verify:flow-designer` 19/19; `verify:workflow-builder` 13/13 (the WB verifier needs a workflow
     loaded on the Builder canvas — seed via `npm run seed:mock-fixtures` and set persisted
     `selections.selectedBuilderWorkflowId`; the empty-canvas timeout is an environment/persisted-state
     dependency, not a code regression). Primitives are not yet consumed by any page (that starts at
     Phase 5).
   - **Phase 3 DONE (telemetry read-model):** additive **migration v2** (`reporting-extensions`) in
     `src/runner/store/RuntimeStoreSchema.ts` — nullable `runtime_runs` columns (scenarioName,
     triggerType, queueWaitMs, durationMs, retryCount, recoveryCount, reportCategory), new
     `runtime_process_samples` table, + read indexes; v1 databases upgrade **in place** (proven).
     `SqliteRuntimeStore` gained `recordProcessSample`/`listProcessSamples`/`sweepRetention`
     (bounded time+run retention over DB rows only — never user artifacts; interrupted/recoverable
     runs always kept) and extended `upsertRun` (v2 columns preserved across REPLACE via the
     existing merge-read). New pure `src/reports/ReportCategories.ts` maps the existing
     `ErrorClassifier` classes → report taxonomy (no second classifier). New
     `src/runner/runtime/ProcessTreeSampler.ts` (Windows CIM, own-subtree Chromium count+memory,
     throttled, never-throws, `AWKIT_PROCESS_SAMPLING` gate). `RuntimeStatusSnapshot.processes?`
     added (additive). `ExecutionEngine` now writes run-summary fields at the existing start/end
     seams (queueWait from run enqueue→dispatch; duration; retryCount from node attempts;
     reportCategory from errorClass), starts the process sampler + persists history rows (≤1/15s),
     and runs the retention sweep on durable init (`AWKIT_REPORT_RETENTION_HOURS`/`_RUNS`).
     Verified: `npm run build` clean; **new `npm run verify:telemetry` 21/21** (v1→v2 in-place
     upgrade, run-summary round-trip incl. REPLACE-preservation, process-sample write/read,
     retention time+run cap, taxonomy mapping, sampler tolerance); `verify:durable-store` 11/11
     (assertions updated for v2); `verify:runtime-status` 15/15; `verify:runner` 82/82;
     `verify:cancellation` 12/12; `verify:concurrency` 78/78. No IPC query layer yet (Phase 4) and
     no report pages yet (Phase 5).
   - **Phase 4 DONE (telemetry query IPC + preload):** shared read-model types in
     `src/reports/TelemetryContracts.ts`; 5 read-only aggregate query methods on the `RuntimeStore`
     interface (`queryOverview`/`queryWorkflows`/`queryRunHistory`/`queryFailures`/
     `queryRuntimeSeries`) implemented in `SqliteRuntimeStore` (SQL SELECT + bounded JS aggregation;
     windowed/paginated; ≤5–10k row caps; percentiles/durationStats in JS) and as empty +
     `storeEnabled:false` in `NullRuntimeStore`; engine `getTelemetry*` delegators (+ `getTelemetryRunDetail`
     reusing run/attempts/artifacts, `getTelemetryProcessHistory`). New `app/main/ipc/telemetry.ipc.ts`
     (7 channels `telemetry:overview/workflows/runHistory/runDetail/failures/runtimeSeries/processHistory`;
     range preset → `sinceIso` + bucketMs resolved server-side), registered in `ipc/index.ts`, and a
     typed `telemetry` group on `window.playwrightFlowStudio` (`app/main/preload.ts`). Existing
     `reports:*`/`execution:*` channels untouched. Verified: `npm run build` clean;
     `npm run verify:telemetry` **37/37** (now incl. Part G: overview counts/rates/duration/queue-wait,
     workflow grouping, run-history pagination, failure categorization + top-workflow, runtime-series
     bucketing, deterministic range filtering, empty-DB + NullRuntimeStore(`storeEnabled:false`));
     `verify:durable-store` 11/11; `verify:runtime-status` 15/15. Execution paths unchanged from
     Phase 3 (read-only additions only), so runner/concurrency were not re-run. No report pages yet.
   - **Phase 5 DONE (reports nav shell + Overview — first rendered report UI):** new `reportsOverview`
     route (`app/renderer/routes.tsx`) + a new **"Reports" nav group** in `LeftNavigation.tsx`; the
     existing `reports` route was relabeled **"Run Artifacts"** (id unchanged — `ExecutionReports`
     still lists stored run reports). New `app/renderer/components/reports/` scaffold:
     `useTelemetryQuery` (loading/error/data, stale-request cancel, manual refetch — no polling),
     `ReportPage` (SectionHeader + `TimeRangeSelector` + refresh + page-enter), and hand-rolled SVG
     chart primitives `MetricSparkline`/`BarChart`/`DonutChart` (zero chart deps, point-capped,
     text/aria fallbacks). New `pages/ReportsOverview.tsx` consumes `telemetry.overview` + a one-shot
     `executions.list()` for live counts, with full loading/error/store-disabled/empty/ready states.
     Report CSS added to `global.css` (all `awkit-` namespaced; reduced-motion block still last).
     App.tsx already guards an unknown `lastRouteId` (falls back to `routes[0]`), so up/downgrade is
     safe. Verified: `npm run build` clean; **new `npm run verify:reports` 8/8** (real Electron —
     nav→page render, header, resolves to a valid non-loading state [empty "No runs in this range"
     on the dev profile], 5-button range selector + range change + refresh, zero telemetry/undefined
     console errors); `verify:flow-designer` 19/19 (shared CSS, no canvas regression);
     `verify:telemetry` 37/37 (data correctness). The real-data GUI path (populated metrics) wasn't
     exercised because the dev profile has no in-range runs — the query aggregates are proven by
     `verify:telemetry` and the empty→ready state machine by `verify:reports`.
   - **Phase 6 DONE (workflow & instance reports + run drill-down):** additive `RunHistoryFilter`
     (scenarioId/status) threaded through `queryRunHistory` (contract→store→engine→IPC→preload;
     parameterized SQL, back-compatible). New `pages/ReportsWorkflows.tsx` (client-side sortable
     per-workflow table from `telemetry.workflows`; row click → scenarioId-filtered recent-runs
     panel; run → drawer) and `pages/ReportsInstances.tsx` (live status distribution via a 2s
     `executions.list()` poll cleared on unmount + paginated `telemetry.runHistory` history; run →
     drawer). Shared `components/reports/RunDetailDrawer.tsx` (run metadata + node-attempts table +
     artifact "Open folder" via `system.openPath`) and `statusTone.ts` (status→tone + duration/time
     formatters). Both routes added to the Reports nav group. Report table/drawer/distribution CSS
     added (all `awkit-` namespaced). Verified: `npm run build` clean; **`npm run verify:reports`
     13/13** (real Electron: all 3 report routes render + resolve to valid states, live-status section
     on Instances, zero telemetry/undefined console errors); **`npm run verify:telemetry` 39/39**
     (+scenarioId/status filter checks); `verify:flow-designer` 19/19 (no canvas regression). The
     populated-data GUI path (tables with rows + drawer content) wasn't exercised (dev profile has no
     in-range runs) — covered by `verify:telemetry` aggregates/filters + build-time binding types.
   - **Phase 7 DONE (live Chrome consumption + RPM gauges):** new `pages/ReportsChrome.tsx`
     (route `reportsChrome`, in the Reports nav group) driven by a `useRuntimeStatus` 2s poll of
     `executions.runtimeStatus()` (which carries the Phase 3 `processes` sample + `capacity` +
     `browserPool`). Four hand-rolled SVG **RPM gauges** (`RadialGauge` — 180° dial, colored bands
     0–60/60–85/85–100, CSS-rotated needle [reduced-motion safe], `undefined`→neutral "—"):
     browser-pool saturation (activeBrowsers/maxBrowsers), concurrency (activeFlows/maxActiveFlows),
     memory pressure (systemMemoryPercent), CPU (cpuPercent); each `RpmGaugeCard` carries a mandatory
     source/formula tooltip + high-band pulse. Plus process metric cards (Chromium processes/memory,
     active/queued instances), a `LiveProcessStrip` (per-slot contexts/pages/health, NULL-tolerant),
     an `AvailabilityNotice` (only mentions access when the reason is access-related; core metrics stay
     live), and a backpressure banner (`dispatchBlocked`). Gauge/notice/strip CSS added (all `awkit-`
     namespaced). Verified: `npm run build` clean; **`npm run verify:reports` 18/18** (real Electron:
     Chrome route renders 4 gauges — idle shows pool/concurrency 0% and memory/CPU "—" because the
     `ResourceSampler` only starts on the first run, so system metrics are legitimately unavailable
     while idle: the graceful-degradation path — process-detail section present, stable across a poll
     tick, zero telemetry/undefined console errors); `verify:flow-designer` 19/19 (no canvas
     regression).
   - **Phase 8 DONE (consumption history + concurrency analytics):** new `pages/ReportsRuntime.tsx`
     (route `reportsRuntime`, "Runtime Analytics" in the Reports nav group) consuming
     `telemetry.runtimeSeries` + `telemetry.processHistory` (both server-bucketed, Phase 4). New
     `components/reports/ConsumptionTimeline.tsx` — hand-rolled multi-series SVG line chart (shared
     time x-domain, y auto-scaled, gaps for undefined points, aria summary, empty-safe). Four
     timelines (concurrency: active browsers/flows/queue; host: memory %/CPU %; Chrome process count;
     Chrome memory: chromium + electron main) + an analytical summary (busiest window, peak active
     browsers, peak system memory %, peak Chromium memory/process count). Timeline CSS added
     (`awkit-` namespaced). Retention sweep for both sample tables was already proven in
     `verify:telemetry` Part D. Verified: `npm run build` clean; **`npm run verify:reports` 21/21**
     (real Electron: Runtime route renders + resolves to a clean empty state — dev profile has no
     in-range samples — zero telemetry/undefined console errors); `verify:flow-designer` 19/19 (no
     canvas regression).
   - **Phase 9 DONE (failure/success + server-performance analytics):** new `pages/ReportsFailures.tsx`
     (route `reportsFailures`) — failure-category donut + bar (from `telemetry.failures`), top failing
     workflows, a **workflow reliability ranking** with a flakiness score
     (`min(100, round(failureRate×60 + retryRate×40))`, ≥5-run threshold, tooltip-documented,
     timeouts folded into failure rate), and **deterministic evidence-based insight strings** (no AI/
     network). New `pages/ReportsServer.tsx` (route `reportsServer`) — memory/CPU/Chromium cards +
     a **storage-usage** bar chart + availability + backpressure banners + a "never auto-deletes
     artifacts" note. New additive `telemetry:server` channel (contract `ServerReport`/`StorageUsage`,
     preload `telemetry.server`): computed in the **IPC layer** (keeps the `src/` boundary) via
     `getConfiguredPaths` + a bounded (≤20k-entry) never-throwing directory walk cached 60s, plus
     `getRuntimeStatus` capacity/process fields. Both routes in the Reports nav group; CSS added
     (`awkit-` namespaced). Verified: `npm run build` clean; **`npm run verify:reports` 26/26** (real
     Electron: all 7 report routes render + resolve; Failure Analytics resolves; Server Performance
     shows 4 metric cards + a real storage-usage section from actual dev-profile folder sizes; zero
     telemetry/undefined console errors); `verify:flow-designer` 19/19 (no canvas regression). The
     Reports section is now complete: Overview, Workflow, Instance, Chrome, Runtime, Failure, Server
     + the existing Run Artifacts.
   - **Phase 10 DONE (Flow Designer / Workflow Builder visual refactor — CSS-only):** token-based
     polish of the node cards in `global.css` — `.action-flow-node` + `.scenario-flow-node` now use
     `--awkit-surface`/`--awkit-border`/`--awkit-blue` accent + `--awkit-shadow-card` + a smooth
     box-shadow/border transition + a slightly rounder 10px radius; `.selected` uses a purple token
     ring (`color-mix`) + float shadow; node icon → surface-inset + purple; scenario order badge →
     `--awkit-blue`. **No TSX, serializer, connectorStyle, or DOM/geometry changes** — node geometry
     (grid/overflow/size), the port-sibling structure, the `NodeResizer` selected-only visibility
     rule, and saved `EdgeVisualStyle` precedence are all untouched; connector **semantic** colors
     (success=green/failure=red/conditional=amber/parallel=violet) were deliberately kept (flat
     purple/blue would regress clarity). Verified: `npm run build` clean; `verify:flow-designer`
     **19/19** and `verify:workflow-builder` **13/13** (all port/loop/resize/conditional-lock
     invariants intact with the restyled nodes). `verify:runner`/`verify:recorder` not re-run — they
     run headlessly against the runner core and never load `global.css`, so a CSS-only diff cannot
     affect them.
   - **Phase 11 DONE (motion pass + reduced-motion audit):** added a **route-content fade** to the
     shell — `AppShell` keys `<main>` by `activeRouteId` (re-triggers on navigation) and applies
     `main-surface-animated` (opacity + 4px translateY, `--awkit-dur-med`) to **non-canvas routes
     only** (CANVAS_ROUTES = flowChart/scenarioBuilder/workflow/formDesigner are excluded so no
     mount-transform perturbs React Flow measurement). Centralized the fade there and dropped the now
     redundant `awkit-page-enter` from `ReportPage`. **Audit findings** (in
     `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md`): reduced motion fully handled (global CSS media block
     neutralizes all animation/transition; `AnimatedCounter` checks `usePrefersReducedMotion`;
     no other JS animation); compositor-friendly (transform/opacity/background-position) except a
     bounded one-shot `width` transition on `.awkit-bar-fill` (accepted); no idle always-running
     animations (gauge pulse only ≥85%, shimmer only while loading, spin only while refreshing); all
     one-shot transitions use motion tokens. Verified: `npm run build` clean; `verify:flow-designer`
     19/19, `verify:workflow-builder` 13/13 (the `<main>` key change doesn't disturb the canvases),
     `verify:reports` 26/26 (route fade doesn't break report rendering).
   - **Phase 12 DONE (mapping/binding regression audit — verdict PASS):** full Section-C pass over all
     37 files changed in Phases 2–11, recorded in `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` §C. All 8
     checks PASS: rendering map (unique route ids, unknown-`lastRouteId` fallback), props/state (tsc
     clean), store/IPC (8/8 `telemetry:*` channel parity, all intervals/listeners cleaned up),
     persistence (v1→v2 in-place, empty-DB, `AWKIT_DURABLE_STORE=0` disabled state, old reports
     load), runtime safety (`verify:runner` 82/82 + `verify:cancellation` 12/12 with telemetry
     active — never-throw writers, exited-PID tolerance), dependencies (**zero new npm deps**),
     accessibility (aria labels, chart text fallbacks, color+label), performance (paginated,
     point-capped, poll budget). Fresh evidence this pass: telemetry 39/39, durable-store 11/11,
     runtime-status 15/15, runner 82/82, cancellation 12/12 (+ flow-designer 19/19, workflow-builder
     13/13, reports 26/26 from Phase 11). Open non-blocking items: `TrendDelta` primitive not yet
     consumed (documented), populated-data report GUI path not exercised on the empty dev profile,
     10-min heap soak + OS reduced-motion toggle are manual gates.
   - **Phase 13 DONE (final QA + packaging + handoff — the initiative is COMPLETE, verdict PASS):**
     final report at `docs/ai/ui-reports-refactor/FINAL_REPORT.md`. Fresh sweep: build clean;
     `validate:offline` pass; `verify:mock-site` 28/28; rebuilt `dist/win-unpacked` via
     `electron-builder --dir` (avoids the documented max-compression OOM) and `verify:packaged-runtime`
     **25/25** against the real EXE (packaged app boots with all changes; durable/telemetry init +
     migration v2 on a fresh runtime.sqlite; external SQLite read OK). `ARCHITECTURE.md` +
     `FEATURES.md` updated with the reporting/telemetry + design-system surfaces. Standing pre-existing
     gates (unchanged by this initiative): max-compression signed EXEs (16 GB OOM), clean/offline VM
     walkthrough, code-signing. The 70-check packaged walkthrough was not re-run — it exercises
     workflow-run/cancellation/recovery paths this read-only+UI initiative doesn't touch, and
     `verify:packaged-runtime` 25/25 already proves a clean packaged boot with the changes.
   - **Net:** the UI/UX refactor + reports initiative (Phases 1–13) is implemented, verified, and
     documented, entirely additive, zero new npm deps. Nothing committed/pushed (git skipped per user).
   - **NEXT INITIATIVE PLANNED (2026-07-07, docs only): full-app DARK premium re-skin.** User pivoted
     the theme decision (light → dark premium SaaS, full-app scope). Implementation-ready plan in
     `docs/ai/ui-reskin-template-plan/` (14 files; phases R1–R12 in `10_IMPLEMENTATION_PHASES.md`;
     Phase R1 prompt in `13_NEXT_IMPLEMENTATION_PROMPT.md`). Core strategy: redefine `--awkit-*`
     token VALUES to dark + retire all 130 remaining hardcoded hex colors in `global.css` by
     value-substitution inside existing rules (selectors/specificity unchanged), then premium
     treatments on the shared classes (`.work-panel`×38, `.toolbar-button`×70, …), page passes,
     canvas/nodes/connectors (invariant-preserving; `connectorStyle.ts` values-only), motion,
     simplification (zero functionality loss), audits. The 4 Dribbble templates were inaccessible
     (blocked/empty via WebFetch) — recorded honestly; design proceeds from the stated dark target.
     No application code changed in the planning pass. Awaiting approval to start Phase R1.
1. Human clean/offline VM walkthrough per `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 (incl. the
   NSIS install/uninstall cycle) — then upgrade the RC decision from PASS WITH WARNINGS to PASS.
2. Optional hardening: explicit Chromium no-egress flags; code-signing for the installer/exe.
3. Then: remote-runner-host roadmap (deliberately NOT started — see `docs/ai/PHASE3_DURABLE_RUNTIME.md`).
4. Optional: `lastSelectedNodeId/Connector` restore-on-open, renderer code-splitting.

## Unknown / Needs Verification

- Real behavior on a clean offline Windows VM (untested here — dev-machine fresh-profile walkthrough
  is green, but the VM checklist in `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 is unperformed).
- NSIS installer install/uninstall cycle (only sha512 integrity verified).
