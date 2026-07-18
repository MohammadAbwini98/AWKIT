# Agent Handoff

Last updated: 2026-07-18 (**Release-readiness audit** via the `fullstack-webapp-testing` skill, on merged
`main` @ `93162d6`). **State correction:** the Secure Login work (PR #15, `93162d6`) and the Oracle
user-selected-Java/direct-JDBC work (PR #14, `79e20a5`) are **merged to `main`** — every note below that says
"branch `feature/secure-login-auth`", "branch `feature/oracle-jdbc-driver-settings`", or "NOTHING COMMITTED"
is history. Working tree is clean apart from this audit's own doc/tracker/`test-artifacts/` edits + the
reports-verifier fix. **Decision: `CONDITIONAL GO`** for `main` as a dev/integration checkpoint (NOT a
production-ship verdict — the standing external gates are unchanged and un-run). Fresh safe-test evidence
(build; ipc-contract 4/4; security 39/39; secrets 16/16; auth 41/41; auth-gui 13/13; profile-store 13/13;
write-queue 7/7; mock-site 39/39; runner 82/82) + full report under
`test-artifacts/2026-07-18-release-readiness-audit/`. Found the GUI-verifier regression is bigger than bd
`awkit-gmn` recorded — the splash **and** the new `SecurityGate` both block the app shell; **fixed
`scripts/verify-reports-gui.mjs` (31/31)** as the reference (resolveMainWindow + isolated-LOCALAPPDATA
first-run), 5+ sibling GUI verifiers still need the same recipe. Prior handoff below is history.

---

Previously: 2026-07-16 (**Runtime Observability final production-validation** — Phases 1–6). Controlled A/B
overhead + full 30-min soak + measured storage/query benchmarks + real-Electron UI walkthrough (36/36) across
seeded normal/empty/migration/high-data DBs. **Decision: `PRODUCTION-CANDIDATE`** (report §16–17). Corrected the
report's overhead/query/storage/"Experimental" claims. Fixed 2 soak-harness accounting bugs (`cancelled`-run
count; NaN event-loop peak) in `scripts/benchmark-engine-soak.mts`; **no `src/` change** this session. New:
`scripts/seed-observability-fixtures.mts`, `scripts/verify-runtime-analytics-gui.mjs`, 2 `package.json` aliases,
`.gitignore` (`.fixtures-observability/`). Working tree still modified & uncommitted on `main`.
**Remaining gate:** fresh packaged-EXE build + the same walkthrough against the EXE on a higher-memory host (the
`dist/` EXE predates observability; re-packaging OOMs on the 16 GB dev host — see `KNOWN_ISSUES`). Provisional:
anomaly numeric thresholds (uncalibrated) + a precise A/B RSS figure (variance-limited). Prior handoff below is
history.

---

Previously: 2026-07-15 (Real-`ExecutionEngine` capacity benchmark + shared-pool over-launch **race fix** +
Phases 6–10. New benchmark harness drives real workflow instances through the full production scheduler; the
race fix and Phase 8 completion touch `src/runner` core (`SharedBrowserPool`, `ExecutionEngine`,
`BrowserProcessSampler`). Default path unchanged (pool + A8 weights stay flag-OFF pending owner sign-off).
Full write-up: `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md`. **Open decision for the owner:** the evidence
recommends enabling BOTH the shared pool and A8 weighted admission by default (Config D) — a one-line default
flip in `src/runner/concurrency/ConcurrencyConfig.ts`, not yet applied. Working tree modified & uncommitted on
`main`. Earlier uncommitted sessions also remain in the tree — see history below.)

Previous: Shared-browser concurrency capacity — authoritative `BrowserIsolationResolver` + launch-arg-aware
compatibility key hardening the A5 shared Chromium pool (`src/runner` core only; default path byte-for-byte
unchanged). Prior handoff sections are preserved as history.

## Purpose

This file is the active handoff note between AI coding agents and humans. It applies to any coding
agent (Claude Code, Codex, Gemini, Antigravity, future agents) and human developers.

Use this file when work is paused, blocked, or moving from one agent/tool to another.

## Current Handoff

> **ORACLE LIVE-VALIDATION GATE DONE 2026-07-18 — `verify:oracle-live` PASSED 7/7 against the real local
> Oracle 19c.** On branch `feature/oracle-jdbc-driver-settings`. Resolved the fixture/schema mismatch by
> provisioning the canonical `SPECTER_FIXTURE.AWKIT_TYPES_TEST` (204 rows) **additively** via new
> `scripts/oracle/local-19c-awkit-types-fixture.sql` (`GRANT SELECT` + a SYS-created private synonym to
> `SPECTER_READER`; existing `CUSTOMERS`/`TYPE_SAMPLES`/`V_ACTIVE_CUSTOMERS` untouched), imported
> `ojdbc17.jar` into the Settings-managed bundle store (`Oracle-ojdbc17-local-19c-validation`, 23.26.2.0.0,
> JDBC-only), and ran the gate in **real** mode against `jdbc:oracle:thin:@//localhost:1521/ORCLPDB` as
> `SPECTER_READER` with `AWKIT_ORACLE_LIVE_TEST_TABLE=SPECTER_FIXTURE.AWKIT_TYPES_TEST`. An ephemeral
> read-only credential was minted → used → **rotated + ACCOUNT LOCKED** and its secret file securely deleted
> (value never printed anywhere). `npm run build` clean; `verify:oracle-driver-bundle` 43/43. **Docker was
> NOT needed** — the crash-loop note below is moot. Part B tooling remains **uncommitted**. Overall status
> stays INTEGRATION-CANDIDATE (UCP pooled path + private-JRE/packaged-EXE walkthrough + perf/soak gates
> remain). Full detail: top of `docs/ai/CURRENT_STATE.md` + `docs/ai/TASK_LOG.md`.

> **RESOLVED (was: PAUSED 2026-07-17 — Docker crash-loop).** The live-validation run no longer depends on
> Docker — it was completed against the pre-existing local Oracle 19c (see the DONE note above), so the
> Docker-reboot resume path in `docs/ai/ORACLE_LIVE_VALIDATION_RESUME.md` is obsolete for this gate. Part A
> (Settings-managed JDBC driver bundles + non-pooled JDBC executor) remains committed (`fc50227`); Part B
> (dev-only Docker orchestration + live-validation tooling + the new fixture) remains authored, uncommitted,
> and typechecks.

> **STATE CHANGE 2026-07-17 — the long-standing uncommitted tree is GONE.** Everything that had piled up
> across earlier sessions (Oracle JDBC, the SpecterStudio rename, the launch splash/logo/icons, and the
> already-committed security work) is now **merged to `main`** via PR #11 (`476dc29`) and PR #12
> (`b6e473d`). CI on `main` is green. **The working tree is clean and there are no open PRs.**
> Notes below about "uncommitted work in the tree" and about being on `feature/smart-wait-engine` are
> historical — ignore them.
>
> Start new work from clean `main`. Normal Git flow applies (branch → commit → push → PR); follow
> `.claude/skills/git-full-cycle/SKILL.md`, and still don't push/PR without the user asking.
>
> **Only open thread:** the Oracle feature is `INTEGRATION-CANDIDATE`, not production-ready. Its four
> external gates (vendor real ojdbc/ucp jars + a private JRE, an authorized read-only Oracle run, a
> packaged-EXE clean-machine walkthrough, real perf/soak) are **not run** — none are doable in this
> environment. Exact procedures: `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md`.

### From / To

- **From:** the agent that hardened the A5 shared Chromium browser pool (isolation resolver + compatibility key).
- **To:** any next agent or human developer.
- **Branch (historical):** `main`, working tree modified & uncommitted. **Superseded — see the state change
  above: the tree is now clean and everything is merged.**

### Active Task — Shared-browser concurrency capacity: COMPLETE (pool stays default-OFF)

Goal: maximise stable concurrent workflow capacity by safely sharing Chromium processes. The A5 shared pool
+ adaptive/backpressure/weighted admission + machine-aware capacity core already existed (plan phases
A1–A10); this task **proved them from code + runtime**, then closed the real gaps. `src/runner` core only —
**no route, IPC, preload (`window.playwrightFlowStudio`), profile schema, or packaging change; the default
path is byte-for-byte unchanged** (shared pool stays flag-OFF via `AWKIT_SHARED_BROWSER_POOL`; the `balanced`
resource profile resolves to one stable compatibility key → sharing behaves exactly as before).

### Completed Work (shared-browser capacity)

- **New `src/runner/browser/BrowserIsolationResolver.ts`** — THE authoritative resolver. Classifies every
  instance into `SHARED_CONTEXT | DEDICATED_BROWSER | PERSISTENT_BROWSER | HANDOFF_BROWSER` with a
  `{decision,value,source}` diagnostic per rule (precedence: persistent profile > mid-run browser-swap node >
  shared-flag > catch-all dedicated), plus `sharedCompatibilityKey(config, launchArgOverrides)` that folds the
  **browser-level** launch config (headed/headless + resolved launch-arg deltas) into the pool grouping key.
  Context-level options (viewport, device scale, storageState, request routing) are deliberately EXCLUDED —
  they stay isolated per `BrowserContext`. Pure/framework-agnostic; delimited + collision-safe (no hash dep).
- **Latent correctness bug fixed:** the shared pool previously grouped browsers only by `browser:headed/headless`
  and ignored per-instance `launchArgOverrides`. With the pool ON **and** a non-`balanced` resource profile,
  two instances with divergent launch flags could reuse one browser carrying only the first leaser's flags.
  `sharedCompatibilityKey` now separates them.
- **Wiring:** `browserSharing.isSharedEligible` now delegates to the resolver (single source of truth — the
  dispatch loop and the factory can't drift); `BrowserContextFactory` shared launcher keys on
  `sharedCompatibilityKey(config, this.options.launchArgOverrides)`; `ExecutionEngine.runInstanceInner` logs the
  isolation class + diagnostics **only when the shared pool is enabled** (silent on the default path).
  `sharedLaunchKey` kept as a legacy human-readable diagnostic.
- **Benchmarks:** ran `benchmark:concurrency` with `AWKIT_SHARED_BROWSER_POOL=1` and found the flag is **inert
  in that harness** (it `chromium.launch()`es one browser per instance, bypassing engine/factory/pool). It
  reported this machine's baseline (highest sustainable **7**, production-approved **5**, stop at 8 on P95 CPU
  96.5%). Built + ran new **`scripts/benchmark-shared-pool.mts`** (`npm run benchmark:shared-pool`) that drives
  the REAL `BrowserContextFactory` + `SharedBrowserPool`: Model A (browser/workflow) vs Model B (shared) →
  **N=4 −37.5% processes / −27% RSS; N=8 −56% / −39%** (headless, maxBrowsers=2); per-context cookie isolation
  held in every cell. The pool saves **RAM + process count, NOT CPU** (per-page render CPU is unchanged), so it
  raises the memory-bound ceiling only.

### Changed Files (this task, on top of the pre-existing uncommitted tree)

- **New (untracked):** `src/runner/browser/BrowserIsolationResolver.ts`, `scripts/verify-browser-isolation.mts`,
  `scripts/benchmark-shared-pool.mts`.
- **Modified (tracked):** `src/runner/browser/browserSharing.ts`, `src/runner/BrowserContextFactory.ts`,
  `src/runner/ExecutionEngine.ts`, `package.json`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`,
  `docs/ai/HANDOFF.md`.

### Commands / Tests Run (this task, all green)

- `npm run build` — clean (tsc + electron-vite main/preload/renderer).
- New `verify:browser-isolation` **27/27**.
- Regression: `verify:shared-browser-pool` 18/18, `verify:shared-browser-live` 5/5 (real Chromium),
  `verify:runner` 82/82, `verify:concurrency` 78/78, `verify:workload-weights` 53/53, `verify:resource-routing`
  42/42, `verify:chromium-hardening` 13/13, `verify:browser-resource-profile` 51/51,
  `verify:adaptive-concurrency` 14/14, `verify:operation-limiters` 10/10, `verify:telemetry` 54/54.
- Benchmarks: `benchmark:concurrency` (baseline; profile written to the gitignored `.benchmark-runtime/`),
  `benchmark:shared-pool` (Model A vs B, above).
- **Not run** (untouched areas): recorder/protected-login/GUI/mock-site/packaging verifiers. `npm test` /
  `npm run lint` still do not exist.

### Remaining Work / Recommended Next Step (shared-browser capacity)

- **External gate (unchanged):** a full flag-ON run *through `ExecutionEngine` dispatch* under sustained load on
  a clean machine, then the owner decision to flip the shared pool default ON (owner decision D4). The
  factory+pool lease itself is now measured; sharing does not lift a CPU-bound ceiling (it helps RAM-bound hosts).
- **Optional follow-ups:** wire `browserRecycleMemoryMb` (config field exists; the pool recycles by context
  count only); enable A8 weighted admission (`AWKIT_WORKLOAD_WEIGHTS`, default OFF) once per-class costs are
  calibrated; surface the isolation class / shared-browser count in the Instance Monitor.
- **Recommended next step:** decide whether to commit the working tree. Read the git-full-cycle skill for your
  agent surface (`.claude`/`.codex`/`.gemini` mirror) before any Git operation. Do not push/PR unless asked.

### Known Risks (shared-browser capacity)

- The shared pool is **experimental, default OFF**. Turning it on is now *safe* (incompatible launch configs are
  separated by the compatibility key) but should follow the clean-machine engine-dispatch benchmark.
- `BrowserIsolationResolver` is the single source of truth for browser isolation — do NOT re-derive eligibility
  elsewhere; extend the resolver instead.
- Reuse Session / Auto Secure Login / Manual Handoff / persistent-profile / popup / parallel-isolated-page
  behaviour is unchanged and must stay that way (they map to PERSISTENT/HANDOFF/DEDICATED classes).

### Other uncommitted work already in the tree (NOT this task — leave as-is unless asked)

The working tree carries several earlier sessions beyond this task; do not revert or "clean up" without the
user's ask:

- **Custom in-house canvas engine** (React Flow removal) — see the preserved "Prior uncommitted session" block
  below. Still needs `npm install` to sync `package-lock.json` (`@xyflow/react` removed from `package.json`) +
  `npm run offline:manifest` re-validate.
- **DPAPI secret store + full security-audit remediation** — `src/secrets/`, `app/main/secretStore.ts`,
  `app/main/ipc/{secrets,senderGuard,window}.ipc.ts`, `src/utils/pathSafety.ts`, `src/runner/urlPolicy.ts`,
  `src/profiles/FlowValidation.ts`, `docs/security/`.
- **Browser Resource Optimization** profiles — `src/runner/browserProfile/`, `scripts/benchmark-*.mts`,
  `scripts/benchmark/`, `verify:browser-resource-profile`, `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`.
- **Custom app window frame** — `app/renderer/layout/{AppFrame,WindowControls}.tsx`, frameless window changes.

---

## Prior uncommitted session — custom canvas engine (React Flow removal)

### From / To

- **From:** the agent that removed React Flow and built the in-house canvas engine.
- **To:** any next agent or human developer.
- **Branch:** `feature/smart-wait-engine` (level with `origin/feature/smart-wait-engine`; the working
  tree is **modified & uncommitted / unpushed**, and already carried prior sessions' UI-migration work
  before this task). Do not fetch/pull/push/PR unless the user asks.

### Active Task — Remove React Flow (`@xyflow/react`) from the canvases: COMPLETE

The user asked to replace the React Flow-based canvases with the **same custom UI design as their
`Workflow` (flowforge) reference project, but implemented without the React Flow library**. Note the
reference project is itself built on `@xyflow/react`, so this required building a small in-house canvas
engine (viewport pan/zoom, node drag, SVG smooth-step edges, dotted grid, fit-view, screen↔flow
mapping) and porting all three canvases onto it. Renderer-only — **no route, IPC, preload API
(`window.playwrightFlowStudio`), runner/runtime, profile schema, storage contract, or packaging
behavior changed.** Per the user's explicit choice ("adopt flowforge nodes as-is"), the extra
node features listed under Known Risks were intentionally dropped.

### Completed Work (React Flow removal)

- **New in-house engine** `app/renderer/components/canvas/` (all untracked, no `@xyflow` anywhere):
  `FlowCanvas.tsx` (viewport pan/zoom via CSS transform, node drag with DOM measurement, SVG edge
  layer, fit-view, `useCanvas`/`useViewport`, `FlowCanvasHandle` imperative ref exposing
  `fitView`/`zoomTo`/`screenToFlowPosition`, `getIntersectingNodes`), `geometry.ts` (a faithful port
  of React Flow's `getSmoothStepPath` / `getViewportForBounds` math), `edgeComponents.tsx` +
  `edgeLabelContext.ts` (`BaseEdge`/`EdgeLabelRenderer` portaling into an in-transform HTML overlay),
  `Background.tsx` (dotted grid that pans/scales), `CanvasZoomControl.tsx` (glass zoom pill),
  `state.ts` (`useNodesState`/`useEdgesState`/`addEdge` compat helpers), `nodes/StepNode.tsx`,
  `edges/SmoothEdge.tsx` (insert `+`), `edges/LoopEdge.tsx` (self-loop), `types.ts`, `index.ts` barrel.
  The flow runs **top→bottom**: every edge leaves a node's bottom-center and enters the next node's
  top-center (self-loops when source === target).
- **All three canvases converted** to `<FlowCanvas>`: `pages/WorkflowDesigner.tsx` (read-only
  overview, uses `StepNode`), `pages/FlowChartDesigner.tsx`, `pages/ScenarioBuilder.tsx`. Their
  save/load/validation/serialization logic is unchanged — only the rendering layer swapped.
- **Node components rebuilt on the engine** (kept their existing flowforge-parity card markup/CSS):
  `components/workflow/ActionFlowNode.tsx`, `components/scenario/ScenarioFlowNode.tsx`. Resize +
  connector-port rendering removed; loop create/remove moved to the kebab menu via new
  `onToggleLoop`/`hasLoop` data callbacks (page owns the edge mutation).
- **Shared edits:** `components/shared/connectorStyle.ts` dropped its `@xyflow` import; `buildConnectorVisual`
  now returns `{ type: "smooth" | "loop", animated, style }` (was `templateSmooth`/`circular`).
  `components/workflow/FlowNodePropertiesPanel.tsx` `Node` type now imports from the engine.
  `flowDesignerTypes.ts` / `scenarioDesignerTypes.ts` gained `hasLoop`/`onToggleLoop`.
- **Deleted** (React-Flow-only, orphaned by the swap): `components/shared/TemplateSmoothEdge.tsx`,
  `components/shared/SelfLoopEdge.tsx`, `components/shared/ConnectorPorts.tsx`,
  `components/workflow/CanvasZoomControl.tsx`. Removed the `@xyflow/react/dist/style.css` import from
  `main.tsx` and the `@xyflow/react` dependency line from `package.json`.
- **Engine CSS** appended to `global.css` (`.awkit-flow-*`, `.awkit-step-node*`, `.awkit-edge-*`),
  translating the reference's Tailwind card design to AWKIT `--awkit-*` tokens (AWKIT has no Tailwind).
- **Both GUI verify scripts rewritten** against the new DOM (`.awkit-flow-node[data-id]`,
  `g.awkit-flow-edge[data-source][data-target]`, `.awkit-edge-add`, `.awkit-flow-canvas`), dropping the
  removed branch-port geometry checks. `AGENTS.md` (renderer) architecture note updated.

### Changed Files (this task, on top of the pre-existing uncommitted tree)

- **New (untracked):** `app/renderer/components/canvas/**` (engine).
- **Modified:** `app/renderer/pages/{WorkflowDesigner,FlowChartDesigner,ScenarioBuilder}.tsx`,
  `app/renderer/components/workflow/{ActionFlowNode,FlowNodePropertiesPanel,flowDesignerTypes}.tsx`,
  `app/renderer/components/scenario/{ScenarioFlowNode,scenarioDesignerTypes}.tsx`,
  `app/renderer/components/shared/connectorStyle.ts`, `app/renderer/main.tsx`,
  `app/renderer/styles/global.css`, `app/renderer/AGENTS.md`, `package.json`,
  `scripts/verify-flow-designer-gui.mjs`, `scripts/verify-workflow-builder-gui.mjs`.
- **Deleted:** `app/renderer/components/shared/{TemplateSmoothEdge,SelfLoopEdge,ConnectorPorts}.tsx`,
  `app/renderer/components/workflow/CanvasZoomControl.tsx`.
- **Note:** the working tree also holds many *pre-existing* uncommitted changes from earlier sessions
  (Workflow UI migration, Hologram reskin — e.g. `Recorder.tsx`, `LeftNavigation.tsx`, `Settings.tsx`,
  `src/profiles/WorkflowProfile.ts`, `mock-site/*`, doc/`.md` files, `package-lock.json`). Those are
  **not** from this task; leave them as-is unless the user asks.

### Commands / Tests Run (this task)

- `npx tsc --noEmit` — **clean**.
- `npx electron-vite build` — **clean** (main + preload + renderer). Renderer bundle
  **1,589 kB → 1,235 kB** (~355 kB smaller, React Flow gone; modules 2214 → 2049).
- `node scripts/verify-flow-designer-gui.mjs` (real Electron GUI) — **14/14**.
- `node scripts/verify-workflow-builder-gui.mjs` (real Electron GUI) — **14/14**.
- `grep -rn "@xyflow" app/` — no imports remain in source.
- **Not run** (no runner/runtime/mock-site/packaging code touched): `verify:runner`, `verify:recorder`,
  `verify:mock-site`, `verify:workflow-sentinels`, `validate:offline`, packaging verifiers. `npm test` /
  `npm run lint` still do not exist.

### Remaining Work / Recommended Next Step

- **Run `npm install`** — `@xyflow/react` was removed from `package.json` but **still exists in
  `package-lock.json` (6 refs) and `node_modules/`** (install was not run). Sync the lockfile + prune
  the module. This is the top remaining item.
- **Regenerate the offline dependency manifest + re-validate** after the install:
  `npm run offline:manifest` then `npm run validate:offline`. `scripts/generate-dependency-manifest.ps1`
  still references React Flow / `@xyflow` — confirm the manifest no longer lists it and that offline
  validation passes (a dependency was removed).
- **Optional — free node-to-node connect:** the engine currently connects via the `+` insert / append /
  Logic-picker affordances only. Port-drag-to-connect and edge-reconnect were dropped with the port
  model; if arbitrary connect-any-two-nodes is wanted, add flowforge-style drag-a-node-onto-another
  (the engine already exposes `getIntersectingNodes`).
- **Optional cleanup:** the now-unused port helpers remain in `components/shared/connectorStyle.ts`
  (`ConnectorPortFlags`, `computePortFlags`, `reconcileBranchConnectors`, `portHandlesForKind`,
  `branchSourceHandle`, `portPositions`) and the `portFlags?` fields on the two node-data types — dead
  after this task; safe to prune later.
- **Recommended next step:** run `npm install`, then `npm run build`, then `verify:flow-designer` +
  `verify:workflow-builder` to confirm still-green, before committing. Read
  `.claude/skills/git-full-cycle/SKILL.md` before any Git commit. Do not push/PR unless asked.

### Known Risks / Behavior Changes

- **Intentionally dropped features** (from the user's "adopt flowforge nodes as-is" choice): node
  resize, branch-port dragging, edge reconnect, and free port-drag-to-connect. Connections are now made
  via the `+`/append/Logic-picker affordances; loop is toggled from the node kebab menu. All connector
  *kinds* (conditional/parallel/loop), their config, and save/validation logic are preserved.
- **The engine is new hand-written code.** It has been GUI-verified (14/14 ×2) but is less battle-tested
  than React Flow — watch pan/zoom/drag edge cases. Node size is measured from the rendered DOM
  (`ResizeObserver`), so edges attach after first paint.
- The old `docs/ai/CURRENT_STATE.md` "Structured connectors (Checkpoint B)" section still describes the
  **removed** port/handle/`reconcileBranchConnectors` rendering model — the *runtime* connector
  semantics it documents are unchanged, but the renderer half (ports, `useUpdateNodeInternals`,
  branch-pair handles, `.react-flow__*` DOM) no longer exists. See the new dated CURRENT_STATE entry.

---

## Prior release-hardening context (historical — the release gates below are still the real gates)

### Codex Git-Cycle Update

2026-07-07: User explicitly requested committing and pushing all current project changes on
`feature/smart-wait-engine`. This overrides the older "do not push unless explicitly asked" caution for
this Git cycle only; do not assume future pushes are approved.

Fresh verification before staging:
- `npm run build` pass
- `npm run verify:runner` 82/82
- `npm run verify:recorder` 57/57
- `npm run verify:telemetry` 39/39
- `npm run verify:reports` 26/26
- `npm run verify:waits` 21/21
- `npm run verify:mock-site` 28/28
- `npm run validate:offline` pass
- `npm run verify:concurrency` 78/78

### From Agent / Tool

Claude Fable 5 (completed the concurrency & stability layer on top of Codex's uncommitted Reuse Session
lifecycle fixes — both change sets are in the working tree together)

### To Agent / Tool

Any next agent

### Timestamp

2026-07-06

### Branch / Commit

- Repository is a Git repo; always run `git status --short --branch` before editing.
- ~~Current branch: `feature/smart-wait-engine` (ahead of origin by 5 commits; local-only work not pushed).~~
  ~~Work is local-only. Do not fetch, pull, push, or open PRs unless the user explicitly asks.~~
  **STALE (corrected 2026-07-17):** that branch state no longer exists. The repo is on **`main`**, level with
  `origin/main` (`b6e473d`), working tree **clean**, no open PRs. Normal Git flow applies — still only
  push/PR when the user asks. See the state-change note at the top of this file.

### Active Task

Phase 5.1 release-candidate follow-up is in progress on branch `feature/smart-wait-engine`.
The repo is locally modified and uncommitted. The current work items are to:
- centralize Chromium no-egress hardening and ship it into the packaged app,
- make packaged verifiers track the real Electron main process tree and terminate it on cleanup,
- then validate the NSIS install/uninstall cycle and a real clean/offline Windows VM walkthrough.

### Phase 5.1 verification (2026-07-07, current handoff)

- **Chromium no-egress hardening validated end-to-end.** `src/runner/ChromiumHardening.ts`
  (`buildChromiumHardeningArgs`, env-configurable via `AWKIT_CHROMIUM_OFFLINE_HARDENING` /
  `AWKIT_CHROMIUM_EXTRA_ARGS`) is wired into `BrowserContextFactory` + both recorder launch paths and
  NOT into `SessionCaptureService`. Confirmed the `--disable-features` list is an exact superset of
  installed Playwright 1.61's (last-wins), and pinned 4 Playwright behavioral defaults so the arg set
  is self-contained. `npm run verify:chromium-hardening` **13/13** (ONLINE: zero non-loopback over a
  20 s idle window + external navigation still works). `AWKIT_WALKTHROUGH_STRICT_NET=1
  npm run verify:packaged-walkthrough` **70/70** — the strict no-egress check now PASSES; the Phase 5
  Google-service burst is eliminated. **This resolves the Phase 5 egress WARNING.**
- **Packaged-process teardown proven** (`scripts/helpers/packaged-process-tree.mts`): both
  `verify:packaged-runtime` (**25/25**) and the strict walkthrough report a fully-terminated tree.
- **Packaging OOM finding:** the default max-compression (`-mx=9`) packaging OOMs on this 16 GB
  machine; `win-unpacked` (the shared, validated payload) rebuilt hardened. One-off
  `-c.compression=store` builds produced **hardened** validation-grade portable (~1.23 GB) + NSIS
  (~376 MB) EXEs + a consistent `latest.yml` (installer sha512 re-verified). The two package wrappers
  were fixed to fail on a non-zero `electron-builder` exit (they previously masked the failure).
- **Remaining gates (unchanged):** clean/offline Windows VM walkthrough
  (`docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3); NSIS install/uninstall cycle (integrity sha512 only);
  code-signing; producing max-compressed shippable EXEs on a higher-memory machine.
- **RC decision: `PASS WITH WARNINGS`.** `npm test` / `npm run lint` still do not exist.

### Phase 5 additions (2026-07-06, this session)

- **`npm run verify:packaged-walkthrough` (68/68)** — `scripts/verify-packaged-walkthrough.mts`:
  launches the REAL `dist/win-unpacked` EXE with `LOCALAPPDATA` pointed at a fresh empty dir
  (clean first-run simulation); proves first-run init, IPC fixture import, full workflow run +
  artifacts (JSONL/screenshots/report/flow-state), hard cancellation (`cancelled`, Chromium tree
  gone, slot+locks freed), 2-browser OS-level bound under 4 instances, recorder start/cancel,
  hard kill → startup recovery (`orphaned`/recoverable, real Recoverable Runs panel renders,
  markReviewed clears), external SQLite read, ACTUAL portable EXE first boot, NSIS sha512 vs
  `latest.yml`, and network sampling (app processes loopback-only; bundled-Chromium startup
  Google burst = warn-only, `AWKIT_WALKTHROUGH_STRICT_NET=1` to fail). Evidence in
  `dist/phase5-evidence/`.
- **Findings recorded in KNOWN_ISSUES ("Phase 5 packaged-walkthrough findings")** — REQUIRED
  reading before scripting against the packaged app: launcher-stub pid (kill the REAL main from
  `app.evaluate(() => process.pid)`, never `app.process().pid`), orphaned Chromium self-exits
  when the real main dies, per-launch Chromium egress burst, `runWorkflow` needs `dryRun:false`,
  decorated instance ids, mock-site 127.0.0.1/Node-18 `localhost`→`::1` probe gotcha.
- Phase 5J full re-verification green (see CURRENT_STATE header for the complete list).
  `npm test` / `npm run lint` still do not exist.

### Phase 4 additions (2026-07-06, same session family)

- **sql.js ships verified in the packaged app:** `src/runner/store/SqlJsLoader.ts` resolves
  `sql-wasm.wasm` explicitly (`createRequire` + `locateFile`, path exposed);
  `electron-builder.json` lists the dist WASM; manifest generator + `validate-offline-bundle.ps1`
  + the TS manifest policy now REQUIRE `sqlJsRuntimeIncluded`/`sqlJsWasmIncluded` (an old manifest
  fails the packaged startup gate — both packaging scripts regenerate it). Portable (310 MB) +
  NSIS (357 MB) EXEs rebuilt 2026-07-06; `npm run verify:packaged-runtime` 24/24 launches the real
  packaged EXE and proves durable-store init + `%LOCALAPPDATA%` paths + external SQLite read.
- **Runtime diagnostics:** `getRuntimeStatus().environment` = appMode/runtimeRoot/sqlitePath/
  artifactsRoot/sqlJsWasmPath/durableStoreEnabled (logged once at init).
- **Durable runtime opens at app startup** (`registerExecutionIpc` →
  `engine.initializeDurableRuntime`), so startup recovery + recoverable runs appear right after a
  restart without starting a run.
- **Recoverable runs are actionable:** Instance Monitor `RecoverableRunsPanel` (details incl. last
  node/safety/URL/error class/trace/screenshot, open artifact folder, re-run workflow for SAFE runs
  only, mark reviewed/abandoned). New IPC `execution:recoveryDetails`/`execution:recoveryAction`;
  engine `getRecoveryDetails`/`applyRecoveryAction`; `RuntimeStore.listArtifacts`. Dangerous
  (failed/manual-review) runs are never auto-resumed.
- **Stress/soak verifiers (deterministic, tunable `AWKIT_STRESS_*`):** `verify:stress:concurrency`
  13, `verify:stress:cancellation` 8, `verify:stress:locks` 10, `verify:stress:artifacts` 7,
  `verify:soak:runtime` 8 — all green. `verify:stress:locks` found a real bug, now fixed:
  `DurableLockStore.acquireExclusive` treats Windows EPERM/EBUSY wx-create races as contention
  (clean denial) instead of throwing.
- Full Phase 1/2/3 regression re-run green (one `verify:durable-locks` flake under packaging CPU
  load, clean on re-run — noted in KNOWN_ISSUES). `npm test`/`npm run lint` still do not exist.

### Phase 3 additions (2026-07-06, same session family)

- **New dependency:** `sql.js` 1.13.0 (WASM SQLite — chosen because better-sqlite3's native ABI
  can't serve Node 18 tsx verifiers AND Electron 33's Node 20 simultaneously) +
  `@types/sql.js` (dev). Externalized in the main bundle; **packaged-EXE rebuild + dependency
  manifest regeneration still pending** before shipping.
- Durable runtime under `<runtime root>/runtime/`: `runtime.sqlite` (runs/attempts/heartbeats/
  cancellations/watchdog/artifacts/capacity, versioned migrations) + `locks/` (atomic wx-file
  cross-process locks, fencing versions, stale quarantine with reasons).
- Hard cancellation: Stop closes the live browser via per-instance CancellationTokenSource;
  runs end `cancelled` (not failed); `cancelled` error class never retried.
- `FlowStep.safety` explicit side-effect metadata (keyword heuristic = fallback only);
  RetryPolicy is metadata-first; unknown custom types conservative (no auto-retry).
- Dynamic origin claims (`OriginClaimTracker`), CPU/memory `ResourceSampler` in backpressure,
  startup recovery (`runStartupRecovery`: orphaned/recoverable vs failed/manual-review).
- Engine `getRuntimeStatus()` is now **async** (adds `durableLocks` + `recoverableRuns`);
  Instance Monitor strip shows CPU/Mem/Recoverable/Stale-durable-locks.
- New verifiers (95 checks, all green): `verify:durable-store` 11, `verify:durable-locks` 17,
  `verify:cancellation` 12, `verify:safety-policy` 17, `verify:dynamic-origin-claims` 14,
  `verify:resource-sampling` 14, `verify:startup-recovery` 10. Full Phase 1/2 regression green
  (`verify:concurrency` 78, `verify:runner` 82, `verify:waits` 21, `verify:protected-login` 16,
  `verify:recorder` 57, build clean, `ai:memory` pass, `validate:offline` pass in dev mode).
  `npm test`/`npm run lint` do not exist.

### Phase 2 additions (2026-07-06, same session family)

- Failure-path traces: `TraceService` per-step chunks; failed engine-run steps save
  `traces/<stepId>-<ts>.zip` before cleanup; `AWKIT_TRACE_MODE` off/onFailure/always; armed only
  when `instance.paths.traces` exists (verify scripts unaffected).
- Failure screenshots default ON (`onFailure.screenshot: false` opts out; best-effort).
- Origin/account dispatch semaphores (`DispatchClaims` + kind-prefix capacities `origin:*`/`account:*`;
  `AWKIT_MAX_PER_ORIGIN`=2, `AWKIT_MAX_PER_ACCOUNT`=1); released with slot in `finally`.
- Heartbeat refresh on `resumeInstance`/`retryHandoff`; watchdog snapshot (last scan/findings/swept).
- Runtime status: `getRuntimeStatus()` + IPC `execution:runtimeStatus` + preload
  `executions.runtimeStatus()` + read-only Instance Monitor strip (2s poll).
- Node attempts carry `tracePath` + sanitized `currentUrl`.
- New verifiers: `verify:locks` 15, `verify:browser-pool` 13, `verify:watchdog` 13,
  `verify:artifacts` 13, `verify:runtime-status` 15. Regression all green: `verify:concurrency`
  78, build clean, `verify:runner` 82, `verify:waits` 21, `verify:protected-login` 16,
  `verify:recorder` 57, `ai:memory` pass. `npm test`/`npm run lint` do not exist.

### Completed Work

1. **New pure modules:** `src/runner/concurrency/` (ResourceKey, Semaphore, ResourceLockManager —
   exclusive/shared/semaphore, TTL leases, fencing versions, atomic multi-acquire, stale sweep, snapshot;
   ConcurrencyConfig with `AWKIT_*` env overrides; BackpressureController; CapacitySnapshot),
   `src/runner/browser/BrowserWorkerPool.ts`, `src/runner/runtime/` (RuntimeStateMachine, NodeAttempt,
   ErrorClassifier, RetryPolicy, InstanceHeartbeat, WatchdogService), `src/runner/artifacts/` (RunLogger
   JSONL, RunStateArtifacts), `src/profiles/ProfileLockManager.ts`.
2. **BrowserContextFactory:** takes the exclusive in-process `profile:<userDataDir>` lock before
   `launchPersistentContext`, releases it in the runtime close path (and on launch failure). The on-disk
   `Singleton*` artifact check remains for external Chrome/Edge processes.
3. **FlowExecutor:** `executeWithRetry` is classification-gated (RetryPolicy + ErrorClassifier) — only
   transient navigation/timeout/locator/download errors auto-retry, with exponential backoff; dangerous-
   looking mutations (submit/approve/delete/send/pay/confirm keywords) and dead browser/context/page
   failures never do. Isolated parallel branches clamped by `maxActiveNodesPerFlow`.
4. **PlaywrightRunner:** optional `onBrowserRuntime` hook reports the live runtime (initial + each swap
   generation) so the engine's pool can track contexts/pages/disconnects without owning the lifecycle.
5. **ExecutionEngine:** browser-slot admission via BrowserWorkerPool + BackpressureController in
   `processQueue` (blocked dispatch queues with a logged reason); per-instance runner promises tracked;
   heartbeats + JSONL run logs + NodeAttempt records folded from progress events;
   `InstanceRuntimeState.runtime` additive field (flowRunStatus/heartbeatAt/browserWorkerId — UI `status`
   unchanged); WatchdogService marks orphans failed, notes stale heartbeats, sweeps stale locks; end-of-run
   `finally` releases the slot + stray profile locks and writes flow-state/node-attempts/capacity/locks
   JSON under `<instance storage>/state`; `repeatInstance` clears watchdog dedupe and re-enters through the
   slot gate.
6. **Verification:** new `scripts/verify-concurrency.mts` + `npm run verify:concurrency` (78/78), and the
   prior Codex work's tests still pass.

### Files Changed (uncommitted, working tree — includes the prior Codex change set)

- New: `src/runner/concurrency/*`, `src/runner/browser/*`, `src/runner/runtime/*`, `src/runner/artifacts/*`,
  `src/profiles/ProfileLockManager.ts`, `scripts/verify-concurrency.mts`,
  `docs/ai/CONCURRENCY_IMPLEMENTATION_PLAN.md`
- Modified this task: `src/runner/BrowserContextFactory.ts`, `src/runner/FlowExecutor.ts`,
  `src/runner/PlaywrightRunner.ts`, `src/runner/ExecutionEngine.ts`, `src/instances/InstanceRuntimeState.ts`,
  `package.json`, `docs/ai/{ARCHITECTURE,CURRENT_STATE,TASK_LOG,TESTING,COMMANDS,HANDOFF}.md`
- Untracked `electron_test*.cjs` at repo root are **pre-existing** and were left untouched.

### Commands / Tests Run

- `npm run verify:concurrency` — 78/78 (new).
- `npm run build` — clean (tsc + electron-vite).
- `npm run verify:runner` — 82/82.
- `npm run verify:waits` — 21/21.
- `npm run ai:memory` — pass.
- Not run this session: `verify:recorder`, `verify:protected-login`, GUI verifiers, packaging — no
  recorder/protected-login/renderer/packaging code touched.

### Current State Summary

The runner now has an enforced-in-code stability layer: exclusive persistent-profile locking, bounded
browser processes with queueing under backpressure (defaults: 2 browsers, 4 active flows — override via
`AWKIT_MAX_BROWSERS`, `AWKIT_MAX_ACTIVE_FLOWS`, etc.), classified retries with a dangerous-mutation guard,
heartbeat/watchdog recovery for orphaned instances and stale locks, per-instance JSONL run logs (the
previously-unwritten `paths.logs` file), and end-of-run state artifacts for debugging.

### Remaining Work / Recommended Next Step

- **Human clean/offline VM walkthrough** per `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 —
  the main remaining gate (includes the NSIS install/uninstall cycle, offline-adapter-disabled
  startup, and the protected-login handoff on a machine with real Chrome). The dev-machine half
  (full packaged workflow run, now with strict no-egress) is automated by `verify:packaged-walkthrough`.
- **Produce shippable EXEs on a higher-memory machine** — the default `-mx=9` packaging OOMs here;
  only `store`-compressed validation EXEs were produced (KNOWN_ISSUES). Then code-sign them.
- Chromium no-egress launch flags: **DONE** (`src/runner/ChromiumHardening.ts`, Phase 5.1C — proven).
- Optional: renderer code-splitting.
- Next phase (deliberately NOT started): remote runner hosts — see the roadmap section in
  `docs/ai/PHASE3_DURABLE_RUNTIME.md`.

### Known Risks / Blockers

- `ELECTRON_RUN_AS_NODE=1` in agent environments makes direct `npx electron script.cjs` boot as plain Node
  (`require('electron').app` is `undefined`). Clear it (`unset ELECTRON_RUN_AS_NODE`) for ad hoc Electron
  reproduction commands. The project GUI verification scripts clear it themselves.
- The real workflow can still pause at Protected Login Handoff after Navigate if the target site requires a
  human login/verification step. Do not automate or bypass that surface.
- Playwright 1.49 API note carried from prior work: no `locator.filter({ visible })`; locator fallback uses
  `nth(i).isVisible()` probing. (Installed Playwright for the app is 1.61 / Chromium 149.)

### Do Not Touch Without Confirmation

- Do not rename `window.playwrightFlowStudio`.
- Do not break offline-first constraints: no runtime internet, no global Node/Playwright/Chromium, and no
  writes to `resources/` or `app.asar`.
- Do not add a "block external / non-Playwright profile" guard to Reuse Session; protected-login session
  capture intentionally uses real Chrome/Edge scoped profiles.
- Keep Mock Site scenarios local-only, deterministic, and free of external services.

### Recommended Next Step

Start from `git status --short --branch`. The lifecycle fix is complete locally and uncommitted. Do not push
unless explicitly asked.

### Required First Actions For Next Agent

1. Read `AGENTS.md`.
2. Read `docs/ai/CURRENT_STATE.md`.
3. Read `docs/ai/HANDOFF.md` (this file).
4. Run `git status --short --branch` and inspect `git diff` before editing.
5. For mock-site work, read `mock-site/AGENTS.md`, `mock-site/README.md`, and the `mock-site-maintainer`
   skill for your agent surface.
6. Read `.claude/skills/git-full-cycle/SKILL.md` (or the `.codex`/`.gemini` mirror) before any Git
   branch/stage/commit/push/PR operation.

## Handoff History

Older handoff detail is preserved in Git history.
