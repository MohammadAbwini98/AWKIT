# DECISIONS

Important decisions visible in the repository / made during development. Newest first.

---

### 2026-07-15 — Browser Resource Optimization: balanced stays default; background throttling removed on evidence
- **Decision:** Per-instance Chromium cost is controlled by one authoritative resolver
  (`src/runner/browserProfile/BrowserRuntimeConfigurationResolver`) over four profiles
  (maximum-compatibility / **balanced (default)** / low-resource / custom). Balanced == today's exact
  behaviour and stays the default (zero risk). `low-resource` is recommended for unattended / image-heavy
  runs only. Workflow **capabilities only ever RELAX** an optimization (never break a workflow).
  **Background throttling was REMOVED from low-resource** (kept in `custom` only). GPU/WebGL/renderer-limit
  are Custom-only, not in any default preset.
- **Reason (measured):** 20/20/15-rep benchmarks (`reports/browser-performance/`,
  `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`). Background throttling gave **no CPU benefit** — Playwright keeps
  automated pages `visibilityState:visible` (timers never throttle) and minimizing already floors CPU (rAF
  60→1/s); behaviour stayed 100%. The real, safe wins are **network −~99%** (asset-heavy pages, deterministic)
  and **RAM −7…13%** (image-blocking-dominated, workload-dependent); CPU is not a reliable per-instance lever.
  The earlier "21% RAM" was 3-rep noise. GPU/WebGL/renderer-limit stayed Custom-only pending a clean-machine
  benchmark (risk of raising CPU / breaking rendering).
- **Impact:** New additive modules + one wiring seam; default path byte-for-byte unchanged (verified). New
  env `AWKIT_BROWSER_RESOURCE_PROFILE` + `AWKIT_WORKFLOW_REQUIRES_*` hints. `ProcessTreeSampler` now counts
  `chrome-headless-shell.exe`. No IPC/schema/UI change; Settings UI + unattended→low-resource auto-rule are
  follow-ups.

---

### 2026-07 — Loop connectors became self-loops; three connector-structure rules now block Save/execution
- **Decision:** A `loop`-kind connector's source and target must be the same node (AWKIT point 4); a node
  may have at most one standard outgoing connector (point 2); a node with a self-loop forces every other
  outgoing connector to be Conditional (point 3). Enforced by a shared `validateConnectorStructure`
  (`src/profiles/FlowProfile.ts`), called by `FlowExecutor.executeFlow` as a runtime guard and mirrored in
  both the Flow Designer and Workflow Builder to block Save. The legacy `loopBack` edge type is explicitly
  exempt from the self-loop rule — it's a pre-existing, intentional cross-node back-edge.
- **Reason:** The prior loop-connector model (edge `A → B` where `B` was repeated) made loop semantics
  ambiguous alongside the new structured conditional/parallel model, and multi-node branch looping was
  explicitly out of scope. A self-loop is simpler, safer, and predictable: it repeats one node, and any exit
  is unambiguous once forced to Conditional.
- **Impact:** `FlowExecutor`'s main loop now checks for a self-loop edge on the current node **before**
  its normal single execution and runs the whole loop via `executeLoopConnector`, then continues via
  `resolveNext` as usual (the self-loop edge is naturally skipped there since neither its `type` nor its
  `kind` match any of `resolveNext`'s pick clauses). Existing saved flows with a cross-node `loop`-kind edge
  (not `loopBack`) will now fail validation/execution until fixed — this is intentional per the point's own
  "existing invalid saved flow loads and shows validation error" requirement.

### 2026-07 — Connector ports and shapes are derived at render time, not persisted
- **Decision:** Dynamic conditional/parallel ports (`computePortFlags`) and self-loop `sourceHandle`/
  `targetHandle` (`portHandlesForKind`) are computed from the edge list on every render/edge-change, not
  stored on `FlowEdge`/`WorkflowEdge`. The circular self-loop shape is just another `EdgeVisualStyle.shape`
  value, rendered by a shared custom React Flow edge component (`SelfLoopEdge.tsx`) registered under the
  edge type key `circular`.
- **Reason:** Avoids a schema/migration change for a purely visual feature (AWKIT points 1 and 5), and keeps
  ports always consistent with the edges that actually exist — no risk of a stale/orphaned port flag in a
  saved profile.
- **Impact:** Any code that constructs a `FlowDesignerEdge`/`ScenarioEdge` (create, kind-change, load) must
  call `portHandlesForKind` to set `sourceHandle`/`targetHandle`, or the edge will target a handle id that
  isn't rendered on the node.

### 2026-07 — Structured connector model is additive, not a rewrite
- **Decision:** Add a structured `kind` (normal/conditional/parallel/loop) with typed configs
  (`ConditionalConnectorConfig`/`ParallelConnectorConfig`/`LoopConnectorConfig`) on `FlowEdge`, but keep the
  legacy `type`-based expression edges executing. Edges with no `kind` derive one via `connectorKind`; the
  runner evaluates structured conditionals first, then falls back to legacy expression paths.
- **Reason:** Deliver the spec's rich connector model without breaking existing saved flows or the ~60 runner
  tests; "full structured replacement" at the UI/config level, backward-compatible at the data level.
- **Impact:** Two routing paths coexist; when adding routing logic, handle structured configs before legacy
  edges and keep `connectorKind` the single source of kind derivation.
- **Related files:** `src/profiles/FlowProfile.ts`, `src/runner/FlowExecutor.ts`,
  `src/runner/ConnectorConditionEvaluator.ts`, `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx`.

### 2026-07 — Parallel concurrency is opt-in and page-isolated
- **Decision:** Parallel connectors default to `sharedPage` (sequential fan-out on the current page). True
  concurrency requires explicitly choosing `isolatedPage`, where each branch runs on its own page in the
  shared browser context (shared session, independent DOM), bounded by `maxConcurrency`.
- **Reason:** Concurrent UI mutation on one shared page is flaky/unsafe; the spec asks to serialize or require
  explicit isolation. Isolated pages give real concurrency without racing on a single DOM.
- **Impact:** `sharedPage` is the safe default; isolated `failFast` reports failure after in-flight branches
  settle (no hard-abort); isolated branches start on a blank page (suited to independent tasks, not
  current-DOM continuation).
- **Related files:** `src/runner/FlowExecutor.ts` (`executeParallelIsolated`), `src/runner/PlaywrightRunner.ts`
  (branch factory), `src/profiles/FlowProfile.ts` (`ParallelConnectorConfig.isolation`).

### 2026-07 — Auto Secure Login keeps SessionCaptureService (real Chrome), with two restart guards
- **Decision:** Manual login uses the existing `SessionCaptureService` (spawns the system's real Chrome/Edge
  with a dedicated `--user-data-dir`), not Playwright `channel:'chrome'`. Sessions match by **normalized
  origin**. After a capture, the flow restarts from Start via an **engine-level counter**
  (`MAX_AUTO_LOGIN_RESTART = 1`) *and* a user-drawable `outcome`/`loopBack` edge is supported.
- **Reason:** The real-browser spawn is best against automation detection and already integrated (Sessions
  Manager/IPC). Origin matching lets different paths on a site reuse one login. Belt-and-suspenders restart
  avoids both infinite loops and dead-ends.
- **Impact:** `sessionService` only exists in the Main process; never import it into renderer code. Session
  profiles live under `%LOCALAPPDATA%/WebFlow Studio/profiles/<id>` and are git-ignored.
- **Related files:** `src/runner/StepExecutor.ts` (`executeAutoSecureLogin`/`executeReuseSession`),
  `src/session/SessionCaptureService.ts`, `src/session/sessionMatch.ts`, `src/runner/FlowExecutor.ts`,
  `src/runner/PlaywrightRunner.ts` (`BrowserRestarter`/`BrowserHolder`), `src/runner/ExecutionEngine.ts`.

---

### 2026-06 — Protected logins are detected and handed off, never bypassed
- **Decision:** When the runner reaches a protected/automation-blocked login (Google "browser may not be
  secure", MFA, CAPTCHA, SSO), it **detects + pauses** (`waitingForManualAction`) and shows an approved
  handoff UI. It never implements stealth/anti-detection, CAPTCHA/MFA/bot-detection bypass, fingerprint
  spoofing, fake user agents, automated Google password login, or cookie extraction from the user's normal
  browser. OAuth is foundation-only (capability-gated by `WFS_OAUTH_*`, `shell.openExternal`, no fake
  tokens); Load Session / test session are disabled-with-reason until real support exists.
- **Reason:** Compliance with provider ToS and the app's safe-automation rules; bypassing protections risks
  account suspension and is out of scope.
- **Impact:** Protected logins require a human (manual handoff / approved session); the queue treats a
  waiting instance as run-complete so the run doesn't loop. No auto-timeout yet.
- **Related files:** `src/security/ProtectedLoginDetector.ts`, `src/security/ProtectedLoginHandoff.ts`,
  `src/runner/StepExecutor.ts`, `src/runner/ExecutionEngine.ts`, `src/auth/OAuthHandoffService.ts`,
  `app/main/ipc/auth.ipc.ts`, `app/renderer/components/auth/ProtectedLoginHandoffPanel.tsx`,
  `docs/PROTECTED_LOGIN_HANDOFF.md`.

---

### 2026-06 — Shared connector-style module as the single source for both designers
- **Decision:** Both the Flow Designer and Workflow Builder derive connector (edge) visuals from one
  module — `app/renderer/components/shared/connectorStyle.ts` (`buildConnectorVisual`,
  `connectorTypeColor`, `normalizeEdgeStyle`, `hasCustomStyle`) — plus shared UI
  (`ConnectorStyleEditor`, `SearchableSelect`). Per-connector customization is stored as an optional
  `EdgeVisualStyle` on `FlowEdge.style` / `WorkflowEdge.style`.
- **Reason:** Keep the two canvases visually identical (Task 03) and avoid duplicated edge-styling logic
  when adding color/shape customization (Task 06).
- **Impact:** Don't inline edge styling in either designer or they drift again; legacy edges with no
  `style` fall back to type defaults via `normalizeEdgeStyle`; `hasCustomStyle` strips empty styles on save.
- **Related files:** `app/renderer/components/shared/connectorStyle.ts`, `ConnectorStyleEditor.tsx`,
  `SearchableSelect.tsx`, `app/renderer/pages/FlowChartDesigner.tsx`, `ScenarioBuilder.tsx`,
  `src/profiles/FlowProfile.ts` (`EdgeVisualStyle`), `src/profiles/WorkflowProfile.ts`.

### 2026-06 — Saved browser sessions are plaintext local files (no encryption)
- **Decision:** The Save Session node writes Playwright `storageState` (cookies + localStorage/origins)
  as JSON under `%LOCALAPPDATA%/WebFlow Studio/sessions/`; no encryption is added. A Load Session node is
  deferred (not implemented; no no-op UI).
- **Reason:** Use Playwright's built-in capability; inventing weak/custom encryption would be worse than
  relying on the user profile's filesystem permissions. Sessions are protected as sensitive local files.
- **Impact:** Never commit/log session contents or write them into `resources/`/`app.asar`/source; only
  the artifact path is logged. If secure storage is added later, route session writes through it.
- **Related files:** `src/runner/StepExecutor.ts` (`saveSession`), `src/runner/ExecutionEngine.ts`,
  `src/runner/InstanceExecutionContext.ts`.

---

### 2026-06 — Product rename to "WebFlow Studio"
- **Decision:** Rename the product from "Playwright Flow Studio" to **WebFlow Studio**; `appId`
  `com.webflowstudio.app`; runtime data root `%LOCALAPPDATA%/WebFlow Studio`.
- **Reason:** Branding.
- **Impact:** Window/HTML title, sidebar brand, `electron-builder.json`, dependency manifests +
  their validators (PS and TS), README, runtime data folder. Old `PlaywrightFlowStudio` data is not
  migrated (pre-1.0).
- **Related files:** `app/main/windowManager.ts`, `app/renderer/index.html`,
  `app/renderer/layout/LeftNavigation.tsx`, `electron-builder.json`, `app/main/appPaths.ts`,
  `resources/dependency-manifest.json`, `scripts/*.ps1`, `src/offline/DependencyManifest.ts`.

### 2026-06 — Keep `window.playwrightFlowStudio` API identifier
- **Decision:** Do **not** rename the preload contextBridge global despite the product rename.
- **Reason:** It is an internal contract used across the renderer; renaming is churn/risk with no
  user-facing benefit.
- **Impact:** Naming inconsistency vs product name, but stable IPC contract.
- **Related files:** `app/main/preload.ts`, all `app/renderer` IPC call sites.

### (foundational) — JSON file storage instead of SQLite
- **Decision:** Use JSON profile files (`JsonProfileStore`) under the runtime data root.
- **Reason:** Simpler for the offline desktop foundation; spec permits SQLite later.
- **Impact:** No DB/migrations; schema changes need backward-compatible reads.
- **Related files:** `src/storage/ProfileStore.ts`, `app/main/profileStores.ts`, `src/profiles/*`.

### (foundational) — Offline bundled Chromium via `executablePath`
- **Decision:** In production-offline mode, launch Playwright with `executablePath` pointing at the
  bundled Chromium (`resources/browsers/chromium/chrome.exe`), gated by `isProductionOffline()`.
- **Reason:** No runtime browser downloads; works air-gapped.
- **Impact:** Packaging must bundle Chromium + keep `playwright`/`playwright-core` asar-unpacked.
- **Related files:** `src/offline/BundledBrowserResolver.ts`, `src/runner/BrowserContextFactory.ts`,
  `app/main/ipc/recorder.ipc.ts`, `electron-builder.json`.

### 2026-06 — Manifests written UTF-8 **without BOM**
- **Decision:** Generate `dependency-manifest.json` BOM-free; loaders also strip a leading BOM.
- **Reason:** Windows PowerShell `Set-Content -Encoding UTF8` writes a BOM that breaks `JSON.parse`,
  which previously failed the packaged startup gate.
- **Impact:** Offline startup gate / strict validation now pass.
- **Related files:** `scripts/generate-dependency-manifest.ps1`, `src/offline/DependencyManifest.ts`.

### 2026-06 — Settings stored under runtime data root (not `userData/settings`)
- **Decision:** Persist UI/app settings at `%LOCALAPPDATA%/WebFlow Studio/storage/ui-settings.json`.
- **Reason:** Reuse the existing runtime data root for a single consistent data location across
  portable + installer builds.
- **Impact:** Settings live with other runtime data; `getConfiguredPaths()` reads it synchronously
  for writers.
- **Related files:** `app/main/uiSettings.ts`, `app/main/storagePaths.ts`.

## Unknown / Needs Verification
- Some early decisions are inferred from code/spec rather than an explicit ADR; dates are
  approximate where not recorded.
