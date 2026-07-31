# FEATURES

## Active Directory authentication (2026-07-29)

- Implemented: opt-in trusted main-process configuration for certificate-validated LDAPS or LDAP
  upgraded with StartTLS; disabled/incomplete configuration causes zero directory traffic.
- Implemented: direct UPN bind mapped only to a pre-provisioned AWKIT user, retaining local RBAC,
  custom roles, direct overrides, and the offline Virtual User fallback.
- Implemented: provider-aware sessions and sensitive-operation reauthentication. Domain passwords
  are neither persisted/logged nor substituted for the local fallback credential.
- Environment validation remains: no live enterprise AD/DC was available in this workspace.

## RBAC v2 custom roles and per-user overrides (2026-07-29)

- Implemented: persisted custom-role create/update/delete with protected immutable built-ins,
  trusted validation, fresh re-authentication, audit events, and affected-session revocation.
- Implemented: direct per-user Inherit/Grant/Deny overrides. Role permissions are unioned, direct
  grants are added, and direct denies take final precedence; unknown ids fail closed.
- Implemented: custom-role administration in Roles, custom columns in the Permissions matrix, and
  role plus direct-override editing in Users with keyboard-safe modal behavior.

## Secure authentication and Super User recovery (2026-07-29)

- Implemented: offline local virtual-user authentication with one-time Super User bootstrap,
  scrypt password hashing, DPAPI-backed protected columns, lockout, idle/absolute session expiry,
  forced password changes, and sender-bound authorization.
- Implemented: bootstrap generates a 128-bit ambiguity-free recovery code, shows it once before the
  protected shell mounts, and retains only its protected hash.
- Implemented: the login-screen recovery form atomically resets the protected Super User password,
  consumes the code, clears lockout, revokes all existing Super User sessions, and audits success,
  invalid, policy-rejected, and reused attempts.

## Randomized Automation Test Lab (2026-07-29)

- Implemented: deterministic generation, production validation oracle, and lossless designer/JSON
  round-trip.
- Implemented: immutable, secret-safe failure bundles with exact category/signature reproduction
  and generator-version compatibility checks.
- Implemented: category-preserving shrinker in flows, branches, nodes, concurrency, loop-bounds
  order; originals are deep-cloned and never overwritten.
- Implemented: Windows-safe `npm run test:random*` CLI plus the classified
  `verify:random-failures` integration gate.
- Implemented: capacity-planned live generated-flow execution through the real ExecutionEngine,
  including isolated-page `waitAll`, bounded polling, distinct `labTimeout`, report/resource/secret
  invariants, authorized-target enforcement, upload materialization, and a 14/14 live/safety gate.
- Implemented: versioned campaign JSON/Markdown with raw-sample duration percentiles, raw-capacity
  peaks, coverage/block reasons, outcomes, failure categories/signatures, and reproduction commands.
- Implemented: deterministic 176-cell auth × authz × license × enforcement lifecycle campaigns
  through the production authorization service and shared production license gate policy.
- Planned: the optional Super-User Test Lab UI remains Phase 7 pending its recorded product decision.

## Signed machine licensing (2026-07-29)

- Implemented: offline Ed25519 per-machine licensing, hashed multi-signal fingerprint, activation
  request, import/replace/revoke, tamper/clock checks, Super-User RBAC/reauth/audit, and trusted run gate.
- Implemented: attention-only global status-bar surface for permitted users. Healthy licenses stay
  silent; attention states navigate to Licensing and revalidate every 15 minutes plus focus/visibility.
- Decision required: hard-enforcement rollout and upgrade/grace policy remain `awkit-1cc`.

Status legend: ✅ implemented · 🟡 partial/unverified · 🔭 planned/implied

## Workflow-reference contextual editors (2026-07-11)

- Flow Designer and Workflow Builder use one shared searchable contextual picker: blank-canvas
  right-click, edge insertion, leaf append, and toolbar command. Permanent palette/definition rails are unmounted.
- Both designers use overlay configuration drawers while preserving the existing real configuration controls.
  Flow Designer bounds its drawer inside the full-width canvas below the action toolbar and reserves the
  matching internal canvas strip so the drawer cannot exceed the canvas or cover nodes/connectors.
- New workflows persist structural Start/End nodes plus a default connector. Runtime conversion strips
  these sentinels deterministically; older workflows load without mutation.

## Confirmed (by module)

### Flow Designer — `app/renderer/pages/FlowChartDesigner.tsx`
- ✅ React Flow canvas with draggable nodes, connectors, minimap, controls.
- ✅ Node registry + type-specific properties — `components/workflow/flowNodeRegistry.ts`,
  `FlowNodePropertiesPanel.tsx` (click/fill/select/check/radio/wait/assert/screenshot/scroll/
  loop/runFlow/goto/condition/manualHandoff/**routeChange**).
- ✅ **Smart Wait editing:** Flow Designer preserves `beforeWaits`/`afterWaits` on saved steps and Node
  Properties shows captured waits with before/after grouping, condition details, timeout editing, per-wait
  remove, and clear-list controls. A nested required `anyOf` group supports `A AND (B OR C)` without
  flattening; empty groups fail closed. Real-Electron GUI check 11.3 configures and persists the
  API-success AND (rows OR empty-state) contract. A non-gating `streamActivity` condition observes
  WebSocket/SSE lifecycle while a required UI outcome remains primary completion. Chromium adds
  sanitized CDP request IDs/timing/redirect chains; Firefox/WebKit-compatible execution falls back
  to Playwright events. Neither path retains query strings, headers, bodies, or frame payloads.
- ✅ **Route Change node**: switches the active automation page/tab/URL — modes switchToUrl,
  switchToLatestTab, waitForNewTab, navigateCurrentPage (URL match exact/contains/regex; wait-until).
  Runtime switches `StepExecutor.activePage` + `LocatorFactory.setPage` so later steps target the new tab.
- ✅ **Protected Login Handoff**: detector (`src/security/ProtectedLoginDetector.ts`) + `protectedLoginHandoff`
  node + runner auto-pause + Instance Monitor handoff UI. Detects Google/Microsoft/Okta/Auth0/Duo and
  insecure-browser/CAPTCHA/MFA pages, pauses the live runner/browser (never bypasses), offers
  Cancel/Continue/Retry (+OAuth/saved/test disabled-with-reason). Continue resumes the same in-flight flow;
  Retry re-detects in place. Capability-gated OAuth via `WFS_OAUTH_*` + `shell.openExternal`. No secrets logged.
- ✅ **Save Session node**: saves Playwright `storageState` (cookies + localStorage/origins) to
  `<runtimeRoot>/sessions/<name>.json` for later reuse. Config: session name (file-safe), target folder,
  overwrite, capture scope (context | origin), mask-in-logs. Never logs cookie/token values.
- ✅ **Auto Secure Login node** (`autoSecureLogin`): reuses a saved session for the target URL (matched by
  **normalized origin**) → `sessionAlreadyExists`; otherwise closes the automation browser, launches the
  user's real Chrome (`SessionCaptureService`), waits for manual login, and relaunches Playwright on the
  captured profile → `sessionCaptured` + `restartRequired`. Never bypasses MFA/CAPTCHA; no secrets logged.
- ✅ **Reuse Session node** (`reuseSession`): loads a saved session and restarts the browser on its profile
  dir → `sessionLoaded`. Modes: **Auto detect** (by origin from node URL/current page) or **Selected**
  (dropdown of ready sessions).
- ✅ **Smart connectors** (structured `kind` on every edge): **Normal**; **Conditional**
  (`ConditionalConnectorConfig` — sourceField outcome/status/errorCode/variable/dataSourceValue + operator +
  expectedValue + priority); **Parallel** (`ParallelConnectorConfig` — join waitAll/waitAny, fail
  failFast/collectErrors, isolation sharedPage[sequential]/isolatedPage[concurrent, `maxConcurrency`]);
  **Loop** (`LoopConnectorConfig` — **self-loop only** (source===target), count/staticList/dataSource/
  whileCondition, `maxIterations`, `parameterName` injected as a runtimeInput). Kind selector + per-kind
  fields in Connection Properties; legacy `outcome`/`loopBack` (cross-node, exempt from the self-loop rule)
  expression edges still supported. Routing/eval in `FlowExecutor` + `ConnectorConditionEvaluator`; connector
  timeline events surface in the Live Report.
- ✅ **Connector-structure safeguards** (Flow Designer + Workflow Builder, block Save; Flow Designer
  re-validated at runtime by `FlowExecutor`; Workflow Builder re-validated at runtime by
  `ScenarioOrchestrator`/`FlowDependencyResolver`): a node may have at most one standard (non-conditional/
  non-parallel) outgoing connector; a loop connector must return to the same node; a node with a self-loop
  forces every other outgoing connector to be Conditional. `validateConnectorStructure`
  (`src/profiles/FlowProfile.ts`) is the shared rule set.
- ✅ **Dynamic connector ports:** `ActionFlowNode`/`ScenarioFlowNode` show a `normal` handle per side always,
  plus a conditional/parallel two-port source pair once an edge of that kind leaves the node (derived at
  render time via `computePortFlags`, not persisted). Node components refresh React Flow internals when
  port flags change so the dynamic branch handles support real drag-connections.
- ✅ **Circular self-loop connector shape:** `EdgeVisualStyle.shape` includes `circular`, rendered by
  `SelfLoopEdge.tsx` (custom React Flow edge type); loop connectors default to it.
- ✅ **Node Palette search** + searchable node-property dropdowns (`SearchableSelect` for JSON Data Source /
  Target flow / Saved Flow).
- ✅ **Connector style customization** (`ConnectorStyleEditor`, shared): per-connector color/line-style/
  thickness/shape/arrowhead in both designers, persisted on the edge; shared `buildConnectorVisual` makes
  Flow Designer and Workflow Builder connectors visually identical.
- ✅ Node resize + default size from Settings; size persisted (`FlowStep.size`). Resize handles/
  lines show **only on the selected node** (`NodeResizer isVisible={selected}` + CSS guard in
  `global.css`); selecting another node moves them, clearing selection hides them.
- ✅ Zoom % control (`CanvasZoomControl.tsx`), default 100%, persisted; collapsible Node Palette
  and Node Properties; compact header; auto-expand properties on node select.
- ✅ Save/Load/Export/Delete; validation chip; selection persistence. Flows table rows open the flow in
  the Designer on click (keyboard accessible; action buttons isolated).
- ✅ **Snapshot-based unsaved-changes detection** (`serializeFlowDoc`): the unsaved dialog appears
  only for real document edits (node add/remove/move/resize, property/connector/metadata change),
  not on open, selection, zoom/pan, node measurement, or after a successful save.

### Workflow Builder — `app/renderer/pages/ScenarioBuilder.tsx`
- ✅ **Import workflow JSON from the Builder or Workflows Library** through a shared structural
  validator. Dirty canvases prompt before discard; ID collisions require an explicit destructive
  replacement confirmation and are rechecked by the authoritative IPC before overwrite.
- ✅ Link saved flows into a `WorkflowProfile`; typed connectors (Connection Properties panel).
- ✅ Resizable "Workflow Definition" panel; collapsible data-source/connector sections; zoom.
- ✅ Workflow data-source binding; selection persistence.
- ✅ Snapshot-based unsaved-changes detection (`serializeWorkflowDoc`, includes execution +
  dataSource) — same rules as the Flow Designer.
- ✅ **Double-click a flow node → opens that flow in the Flow Designer** (via the unsaved-changes guard;
  Back restores the workflow).
- ✅ **Resizable workflow nodes** (`NodeResizer`, handles only on the selected node; size persisted in
  `WorkflowFlowNode.size`).
- ✅ **Saved Flows search by name + "Load More"** (10 initially, +10 per click).
- ✅ Save success/failure **toast** (`components/shared/Toast.tsx`).

### Libraries & data
- ✅ Flows library + Workflows library with pagination, page size, sorting, advanced filters,
  persisted table state (`components/table/*`).
- ✅ Data Source Manager (JSON sources, click a row to preview, validate, **Edit Table**, duplicate,
  export, **Create Data Source** from scratch); Runtime Input panel; Form Designer.
- 🟡 **Oracle Data Sources + Oracle node (read-only; `INTEGRATION-CANDIDATE`, 2026-07-17):** Oracle-backed
  Data Sources in **Runtime** mode (query executes lazily, only when a consumer actually needs the rows —
  single-flight per run) or **Snapshot** mode (query runs once, rows persist for fully offline use), plus an
  `oracle` `StepType` node. Both resolve through `DataSourceResolver` to the same array-of-objects contract
  as JSON sources, so they work anywhere JSON sources do (node mappings, workflow/flow inputs, loops,
  previews). UI: "Add Oracle Source" in `DataSourceManager` → `OracleDataSourceModal`; node panel via
  `OracleNodeSection`. Credentials live in the DPAPI `SecretStore` and are referenced by name only.
  **Read-only by policy** (SELECT / WITH…SELECT only). Behaviorally important:
  - a **packaged build never serves mock rows** — with no real driver the feature reports *unavailable*
    rather than returning synthetic data (Snapshot sources keep working, they never launch the bridge);
  - the real Oracle driver has **not** yet been linked and **no authorized Oracle DB has been used** —
    everything here is verified against a database-free mock executor. See
    `ORACLE_JDBC_VALIDATION_GATES.md` for what must clear before this is production-ready.
- ✅ **Data Source Editor** (`pages/DataSourceEditor.tsx`, hidden route `dataSourceEditor`):
  visual table editor for root-array JSON — inline cell editing (type-preserving), add/delete/
  duplicate rows, add/rename/delete columns, search, pagination (25/50/100/All), import/export,
  validate, revert, unsaved-changes dialog, id-binding warnings. Reads/writes real files via IPC;
  bundled samples migrate to the writable data-sources folder on save. Pure logic in
  `src/data/TableEditing.ts` (verified by `npm run verify:data-editor`).
- ✅ Recorder (records browser actions into a flow) — `src/recorder`, `pages/Recorder.tsx`.
  "Save to Flow Library" shows success/failure feedback (shared `Toast` + inline banner) with an
  `isSaving` guard against duplicate-click corruption. **Auto-captures visited URLs** (main-frame
  navigations + opened tabs) with sensitive query values masked, shown in a searchable/paginated
  "Recorded URLs" table (Time/Title/URL/Source/Session/copy) via `recorder.getUrls()`.
- ✅ **Protected-login pause boundary:** while detection is shown, the automation browser stays open
  but inert so false positives can resume in place. `recordActionFromPage` drops every action while
  paused; the protected-login verifier proves password/OTP attempts preserve the exact non-empty
  draft and proves the identical action records after unpause.
- ✅ **Mock-authenticated session replay:** `/mock/session-reuse` derives authentication from
  persisted origin storage. A production runner verification loads a captured profile through Auto
  Secure Login + Reuse Session and reaches the dashboard without a login action; a fresh no-session
  control fails. The remaining REC-022 gap is deliberately manual: a real approved IdP and authorized
  operator (`awkit-cey`).
- ✅ **Smart Wait recorder observation:** default-on `settings.recorder.captureSmartWaits` records
  high-confidence `afterWaits` from passive loaders, fetch/XHR completion (method + URL path only),
  URL changes, table/list/card data growth, enabled controls, toasts, and a fixed-delay fallback. Recorder
  Controls exposes a persisted Smart Wait toggle, and the recorded-actions list summarizes captured wait
  types. Legacy fixed-time wait capture remains controlled separately by `captureWaitTime`.
- ✅ **Unique, Playwright-safe recorder locators** (`src/recorder/recorderInitScript.ts`): for
  click/fill/select/check/uncheck/radio steps the injected capture script generates ranked candidate
  locators (getByRole/label/placeholder/text/testId → stable attributes → id → scoped → **compound
  tree** → anchored/positional fallback), **never** utility/layout-class selectors (`flex`,
  `items-center`, …), validates each against the live DOM, and saves the highest-priority candidate
  that resolves to exactly one element. Each saved step carries `LocatorQuality`
  (`strategy`/`isUnique`/`matchCount`/`confidence`/`warning`/`candidateCount`/`disambiguation`/`requiresHover`/`hoverContainer`) and
  (for role/text) an `exact` flag. Steps get human-readable names ("Click Log in", "Fill Email").
  Password field values are never stored. Verified by `npm run verify:recorder`.
- ✅ **Hover-dependency capture (replay-verified):** when a click target was hidden at rest and only
  actionable after a hover, the recorder attributes the reveal to the element the pointer actually
  hovered — a trusted pointer trail plus record-time first-seen (rest) visibility of interactive
  elements and their ancestors. It walks the click target's `composedPath()`, skips the hidden-at-rest
  revealed surface, and selects the first visible-at-rest, on-pointer-path, specific (never
  `html`/`body`/`main` or a bare landmark), uniquely-resolvable ancestor as the `hoverContainer`
  trigger — never the hidden surface, never an unconditional parent. `buildRecordedFlow` injects an
  explicit `hover` step (the trigger's full locator, `resolution: "resolved"`) immediately before the
  click; `StepExecutor` replays it as `locator.hover()`. When no stable trigger can be attributed the
  click is left `needs-review` rather than fabricating an unreplayable hover step; a target that
  toggles on its own (async) produces no hover step. Verified by `npm run verify:recorder-hover`, which
  records, builds, and **replays Hover→Click on fresh pages** and guards against the hidden-surface
  regression.
- ✅ **Compound / tree locators for non-unique elements** (`recorderInitScript.ts`): when no single
  strategy is unique, the recorder combines the element's meaningful features (stable attributes +
  rare, non-utility classes) with the **fewest distinguishing ancestors** (descendant combinators,
  skipping wrapper noise) until exactly one element matches — e.g. `#results .customer-card
  input[type=checkbox]`. If a readable semantic locator (role+name/label/placeholder/text) can instead
  be scoped to a stable **container** that isolates the exact element, that is preferred and saved as
  `context.container` (verified in-page against the real ancestor). A guaranteed-unique anchored
  positional path is the final fallback. `quality.disambiguation` records how uniqueness was reached
  (`compound`/`container`/`positional`), so ordinary duplicates no longer surface the red "matches N
  elements" warning.
- ✅ **Runtime locator self-healing** (`src/runner/LocatorFactory.ts`): when a saved step matches
  several elements at run time, the runner narrows deterministically and intent-free — a single
  *visible* match, else a single *enabled* match, else a single *in-viewport* match. If two or more
  remain equally actionable it does **not** guess and fails with the existing friendly diagnostic
  (clicking the wrong twin is worse than a clear error). This heals legacy non-unique flows without
  re-recording.
- ✅ **Locator-quality surfacing:** Flow Designer Node Properties shows a locator-quality readout
  (including how a non-unique element was disambiguated) and will not report a node as valid when its
  saved locator is genuinely non-unique (flow-level + node validation messages). Recorder
  `alternatives`/`context` now survive a Flow Designer load→save round-trip
  (`FlowDesignerNodeData.locatorAlternatives`/`locatorContext`). At run time `StepExecutor` fails a
  known-non-unique step early with a friendly message and translates raw Playwright strict-mode
  violations into an end-user message (technical detail stays in the structured logs).

### Execution & reporting
- ✅ Generic Playwright runner: `StepExecutor`, `FlowExecutor`, `PlaywrightRunner`,
  `ExecutionEngine`, `LocatorFactory`, `ValueResolver`, `ExpressionEvaluator`.
- ✅ **Browser Resource Optimization (per-instance Chromium cost):** selectable profiles
  (`maximum-compatibility` / `balanced` = default = today / `low-resource` / `custom`) resolved through one
  authoritative `BrowserRuntimeConfigurationResolver` (`src/runner/browserProfile/`). Low-resource blocks
  image/media/font + analytics hosts, blocks service workers, reduces motion, fixes device-scale, sets
  production artifacts + bounded 64 MB disk cache. Workflow **capabilities** (screenshots→images,
  downloads, popups→pages, persistent→service workers, animations, WebGL/GPU/media via env hints) only ever
  RELAX the profile so an aggressive setting can't break a workflow. Env: `AWKIT_BROWSER_RESOURCE_PROFILE`
  (default balanced == today). Measured (see `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`): network −~99% and
  RAM −7…13% on image-heavy pages, duration unchanged; background throttling removed (no measured benefit).
- ✅ **Multi-Window / Popup Handling:** `StepExecutor` targets steps to specific windows via `pageAlias` and `PageRegistry`. Click steps with `opensPopup` capture and register popups. Support for `switchToPopup`, `switchToMainPage`, and `closePopup` nodes. Flow Designer canvas shows active page badges. Verified via `npm run verify:popup`.
- ✅ **Smart Wait execution diagnostics:** `StepExecutor` runs `beforeWaits`/`afterWaits` around steps and
  reports failed waits with phase, sanitized current URL, wait condition, timeout, recorded reason, last
  observed state, and a suggested fix.
- ✅ Connector routing at flow and workflow level (structured conditional/parallel/loop connectors +
  legacy success/failure/conditional/always/outcome/loopBack); Auto Secure Login engine restart guard
  (`MAX_AUTO_LOGIN_RESTART`); Run Another Flow with recursion guard (depth 5).
- ✅ Instance manager/pool/coordinator for concurrent isolated instances; manual handoff.
- ✅ Reports/logs/screenshots/downloads written under runtime data paths; Execution & Instance monitors.
- ✅ **Live Execution Report** (`components/instances/LiveExecutionReportModal.tsx`): the instance table's
  Live Report button opens a human-readable modal — summary banner with status pill + heartbeat, connected
  horizontal **per-step process flow** with numbered status nodes, real progress bar, active/running/waiting
  animation, statistics cards, and a masked activity timeline (no raw JSON). Failed nodes show a friendly
  message in the main UI and expose masked technical details only on hover/focus. Active runs show relative
  "Updated" time; terminal runs show a stable final update timestamp. Real live progress: `StepExecutor`
  emits per-step events → `ExecutionEngine` writes a bounded `InstanceRuntimeState.liveProgress` snapshot →
  renderer 1s poll renders it; finished runs use the stored report. Built via `executionReportModel.ts` +
  `src/runner/RunnerProgress.ts`.
- ✅ Concurrent Instance Monitor controls (Pause/Resume/**Stop Pending & Running**/Clear Completed +
  per-instance Pause/Resume/Stop/**Repeat**/Remove) all map to real `executionEngine` methods. Clear
  Completed removes terminal instances from the backend pool. Repeat re-runs a single finished instance
  from its retained run context. Logs/Screenshots buttons are enabled only for `failed` instances that
  have an artifact path. Bulk stop includes pending/queued work, requires confirmation, and calls the
  existing hard-cancel `executions.stopAll()` path.
- ✅ **Workflow run summaries + instance drill-down:** Instance Monitor groups pool rows by unique
  `executionId` and shows workflow status, active/pending/completed/failed counts, progress, total, and
  duration. Selecting a record opens `WorkflowInstancesModal` with every instance's execution details and
  a link to its live report; concurrent runs of the same workflow remain separate.
- ✅ **Passive browser observation + durable CDP trace:** every live browser generation may attach a
  second, fail-open CDP client whose command allowlist is limited to observation domains and local
  screenshot/optional DOM reads. It stores a capped and secret-sanitized raw stream, bounded visual
  samples, 17 session buckets, navigation-bisected page slices, and an analysis-first summary under
  the instance artifact root. Instance Monitor displays the same attach in a permission-gated,
  keyboard-contained read-only live-view modal.
- ✅ **Workflow cards grid** (`components/instances/WorkflowRunCard.tsx`): primary run UX — one card per
  saved workflow with status badge, summary metadata, and per-card run parameters revealed on
  hover/keyboard focus (independent per workflow; persisted to `settings.workflowRunCards`). Search by
  name/description; all cards always render, and the grid becomes a two-row-tall internal scroller once the
  cards overflow two rows (no "Load More" button). Classic dropdown form collapsed behind an "Advanced"
  `<details>`. Runs multiple workflows concurrently; instance table has a **Workflow column**.
  Cards are equal-height on a stable 3-column grid (`repeat(3, minmax(0,1fr))`; 2/1 cols on smaller
  widths) so cards-per-row and dimensions stay consistent whether or not the scroller is active; the
  hover/focus reveal cross-fades two equal-area layers so the card height (and grid) never moves; the
  search bar is full content width.

### Reports & analytics (UI-reports refactor, 2026-07-07)
- ✅ **Reports section** — a "Reports" left-nav group with seven pages plus the existing Run Artifacts:
  Reports Overview (`ReportsOverview.tsx`), Workflow Reports (`ReportsWorkflows.tsx`, sortable + run
  drill-down), Instance Reports (`ReportsInstances.tsx`, live distribution + history), Chrome
  Consumption (`ReportsChrome.tsx`, RPM gauges), Runtime Analytics (`ReportsRuntime.tsx`, consumption
  timelines), Failure Analytics (`ReportsFailures.tsx`, category breakdown + flakiness + insights),
  Server Performance (`ReportsServer.tsx`, storage + resources). All consume the read-only
  `window.playwrightFlowStudio.telemetry.*` channels over the durable runtime store; full
  loading/empty/error/ready states; hand-rolled SVG charts (no chart dependency). Driven by
  `npm run verify:reports` (real Electron, 26 checks).
- ✅ **Telemetry read-model** — additive `runtime.sqlite` migration v2 (run-summary columns +
  `runtime_process_samples`), `src/reports/ReportCategories.ts` (failure taxonomy over the existing
  `ErrorClassifier`), `src/runner/runtime/ProcessTreeSampler.ts` (Windows Chrome process sampling),
  bounded retention sweep, and windowed query methods on the store. Exposed via `app/main/ipc/telemetry.ipc.ts`
  (`telemetry:overview/workflows/runHistory/runDetail/failures/runtimeSeries/processHistory/server`).
  Verified by `npm run verify:telemetry` (39 checks). Telemetry is best-effort and never affects a run.
- ✅ **Design-system layer** — `--awkit-*` tokens + reusable primitives (`StatusBadge`, `SectionHeader`,
  `SkeletonCard`, `EmptyState`, `TrendDelta`, `AnimatedCounter`, `usePrefersReducedMotion`) in
  `components/shared/`; report/chart components in `components/reports/`; global reduced-motion honoring;
  a route-content fade (non-canvas routes). Designer nodes visually modernized (token shadows/accent) with
  all canvas invariants preserved. Codex's 2026-07-08 completion pass aligned the light tokens to the
  requested Hologram palette, added named loader utilities (`.awkit-spinner`, `.awkit-loader-dot`,
  `.loading-panel`, `.skeleton-shimmer`), and made the footer status bar show real runtime capacity
  chips from `executions.runtimeStatus()` instead of static placeholder values. Flow Designer and Workflow
  Builder now use the attached sparse dot canvas pattern (`gap={44}`, `size={2.4}`) with visible
  light-mode lavender dots and a transparent React Flow pane.

### Settings & offline
- ✅ Full Settings screen (Application, Paths, Designer Defaults, Execution Defaults, Data Storage,
  Advanced) wired to the persisted store; folder picker IPC; consumed by writers.
- ✅ Offline Runtime status page; bundled Chromium; dependency manifest; startup gate;
  portable + per-user NSIS packaging.

## Partial / unverified

- 🟡 Clean-machine offline GUI walkthrough (manual gate, pending).
- 🟡 `@playwright/test` spec runs only on Node ≥18.19 (use `verify:runner` otherwise).

## Planned / implied (from spec — not all built)

- 🔭 SQLite storage (spec allows; currently JSON files).
- 🔭 Advanced recorder locator suggestions; richer reporting gallery.

## Important dependencies

- Runner depends on the bundled Chromium (`resources/browsers/chromium`) in offline mode and on
  `playwright`/`playwright-core` being asar-unpacked in packaged builds.
- Settings store (`app/main/uiSettings.ts`) underpins state restore, table state, designer
  defaults, and custom paths; many features read/write it via `window.playwrightFlowStudio.settings`.
- **`framer-motion`** (renderer UI animation; bundled by Vite into `out/renderer`, listed in the
  offline `dependency-manifest`). Shared motion primitives live in `app/renderer/lib/motion.ts`
  (node spring mount/hover, canvas auto-layout glide `useFlowGlide`, list/card variants). All motion
  is reduced-motion aware; visual styling stays in `styles/global.css` (`--awkit-*` tokens, both themes).

## Unknown / Needs Verification

- Completeness of Form Designer and Runtime Input flows end-to-end (not exercised in verification).
