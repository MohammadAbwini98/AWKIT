# Randomized Automation Test Lab — Architecture &amp; Codebase Findings

Status: **findings complete, implementation in progress**
Date: 2026-07-21
Method: six parallel read-only audits of the real codebase. Every claim below carries a
`path:line` citation and was read, not inferred. Sections are marked **Confirmed** /
**Inferred** / **Unknown** per `docs/ai/RULES.md`.

Companion documents:
- `RANDOMIZED_TESTING_IMPLEMENTATION_PLAN.md` — phased build order
- `RANDOMIZED_TESTING_COVERAGE_MATRIX.md` — what the lab covers vs. what it cannot
- `RANDOMIZED_TESTING_SAFETY.md` — safety controls and their enforcement points

---

## 0. Executive summary — read this first

The requested lab was specified against an assumed architecture. The real one differs in ways
that **materially change what is worth building**. Three findings dominate:

1. **AWKIT already has ~130 verifier scripts and roughly 700 passing checks**, including full
   auth, RBAC, licensing, concurrency, cancellation and artifact suites. Re-implementing those as
   "randomized" tests would duplicate existing coverage without finding new defects. The new value
   is a **generation + oracle + coverage layer**, not a parallel test suite.

2. **Several capabilities the lab was asked to test do not exist.** Writing tests for them would
   produce assertions that pass vacuously (worse than no test). These are enumerated in §6.

3. **The audit itself already found real defects** — round-trip data loss, a stale verifier
   assertion, a dead "Open" button, unreachable report categories. These are listed in §7 and are
   independently actionable regardless of how much of the lab gets built.

---

## 1. Domain model — Confirmed

### 1.1 Flow profile

`src/profiles/FlowProfile.ts:567` — nodes live under `nodes`, **not** `steps`:

```ts
interface FlowProfile { id; name; description?; version; nodes: FlowStep[]; edges: FlowEdge[]; createdAt?; updatedAt? }
```

`FlowStep` at `src/profiles/FlowProfile.ts:237`; `NodeConfig` (every field optional) at `:302`.

### 1.2 Node types — 30 literals

`StepType`, `src/profiles/FlowProfile.ts:1-36`:

```
start goto click fill select check uncheck radio scroll wait uploadFile downloadFile
readText assertText assertVisible screenshot manualHandoff condition loop runFlow
routeChange saveSession protectedLoginHandoff autoSecureLogin reuseSession
switchToPopup closePopup switchToMainPage oracle end
```

All 30 are `executable: true` in the renderer registry
(`app/renderer/components/workflow/flowNodeRegistry.ts:43-161`); `StepExecutor.executeStep`
(`src/runner/StepExecutor.ts:704-1005`) covers them in 25 case labels, with `default` throwing
`Unsupported step type: …` at `:1003`.

**The registry is renderer-only.** `src/` must stay framework-agnostic (`src/AGENTS.md:12-14`), so
the lab's catalog is an exhaustive `Record<StepType, …>` in `src/testing/random/NodeCatalog.ts`.
`tsc --noEmit` — the repo's primary gate — then fails if a node type is added without teaching the
generator about it. This is a stronger drift guard than a runtime scan.

### 1.3 Connectors — two overlapping taxonomies

This is the single most confusing part of the model and the generator must handle both.

- **Legacy wire format** `FlowEdgeType`, 9 literals (`src/profiles/FlowProfile.ts:400-409`):
  `success failure always conditional outcome manualApproval loop loopBack parallel`
- **Structured overlay** `ConnectorKind`, 4 literals (`:428`): `normal conditional parallel loop`
- Derivation `connectorKind()` at `:508-522`, duplicated in the renderer at
  `ConnectionPropertiesPanel.tsx:66-80` and `FlowChartDesigner.tsx:1014`.

Exact config literals (all verified, correcting the brief's assumptions):

| Concern | Field | Literals |
|---|---|---|
| Conditional operator | `operator` | 13: `always equals notEquals contains notContains exists notExists greaterThan greaterThanOrEqual lessThan lessThanOrEqual truthy falsy` (`:430-443`) |
| Conditional source | `sourceField` | 5: `outcome status errorCode variable dataSourceValue` (`:446`) |
| Join mode | `joinMode` | `waitAll` \| `waitAny` (`:459-472`) |
| Failure mode | `failMode` | `failFast` \| `collectErrors` (`:459-472`) |
| Isolation | `isolation` | `sharedPage` \| `isolatedPage` (`:459-472`) |
| Branch concurrency | **`maxConcurrency`** | number — **the field is NOT named `maxBranchConcurrency`** |
| Loop mode | `mode` | `count staticList dataSource whileCondition` (`:474-485`) |

`MAX_BRANCH_CONNECTORS = 2` (`app/renderer/components/shared/connectorStyle.ts:104`) is a
**port-count cap on outgoing same-kind connectors**, not a concurrency cap. Do not conflate.

### 1.4 Waits, locators

- `WaitCondition` — 12-variant discriminated union (`src/profiles/FlowProfile.ts:173-192`).
  Distinct from the legacy `wait` **node**'s 5-value `NodeConfig.waitType` (`:308`); they do not
  overlap.
- `LocatorStrategy` — 9 literals (`:38`): `role label placeholder text testId id css xpath tagName`.
  `LocatorQuality.strategy` additionally allows `"fallback"` (`:46-64`).

### 1.5 Runtime limits — sourced, not invented

| Limit | Value | Source |
|---|---|---|
| `LOOP_CONNECTOR_HARD_CAP` | 1000 | `src/runner/FlowExecutor.ts:14` |
| `FLOW_BOUNDS.maxLoopIterations` | 10 000 | `src/profiles/FlowValidation.ts:22` |
| Designer save gate | 1000 | `FlowChartDesigner.tsx:1028` |
| `loopBack` default `maxLoopCount` | 2 | `FlowExecutor.ts:561` |
| Run-Another-Flow recursion guard | depth 5 | `src/AGENTS.md:20` |
| Loop **node** max iterations | default 100, **no hard cap** | `StepExecutor.ts:1584` |

---

## 2. Execution engine — Confirmed

### 2.1 There is no awaitable run result

`ExecutionEngine.startRun(...)` returns `Promise<void>` and resolves as soon as instances are
queued (`src/runner/ExecutionEngine.ts:896`, `:922-938`). There is **no run handle, no result
object, and no completion promise**. `ExecutionEngine` is **not** an `EventEmitter` — no
`on`/`subscribe`/`emit` exists.

Consequence for the lab: the runner must **poll `getInstances()` until terminal**, which is exactly
what the repo's own harness does (`scripts/benchmark/engineHarness.mts:268`). Any invariant of the
form "await the run, then assert" has to be written as a bounded poll with a deadline.

### 2.2 Terminal statuses — and the missing one

`InstanceStatus` (`src/instances/InstanceStatus.ts:1`):
```
pending queued starting running waitingForManualAction paused
completed failed cancelled stopping cleaningUp
```
Terminal set is `["completed","failed","cancelled"]`, hardcoded in five places.

**`"timedOut"` does not exist anywhere in `src/`.** There is also **no run-level wall-clock
timeout**. Timeouts are per-operation defaults inside `StepExecutor` and surface as ordinary
`failed` runs. The `WatchdogService` detects stalls but is deliberately non-terminating — it only
writes a `watchdogNote` (`src/runner/ExecutionEngine.ts:880-884`).

### 2.3 "Parallel" is mostly sequential — critical for oracle design

Three separate findings that together mean naive parallelism assertions would test nothing:

1. **`ScenarioProfile.executionMode` and `maxParallelFlows` are dead at runtime**
   (`src/profiles/ScenarioProfile.ts:24-25`). They are copied into the plan
   (`src/orchestrator/ScenarioOrchestrator.ts:43-44`) and range-validated
   (`FlowDependencyResolver.ts:23`), but **zero** runtime code branches on them. A test asserting
   "a workflow set to `parallel` runs in parallel" asserts nothing.

2. **Default parallel connectors execute sequentially.** `isolation` defaults to `sharedPage`
   (`src/profiles/FlowProfile.ts:468`), and `executeParallelTargets` is a plain `for` loop
   (`src/runner/FlowExecutor.ts:210`) — sequential execution *is* the shared-page safety guard
   (comment at `:185`). Only `isolation: "isolatedPage"` is genuinely concurrent
   (`executeParallelIsolated`, `:248`), and it silently falls back to sequential when no
   `branchExecutorFactory` is supplied (`:203-205`).

3. **`failFast` is not fail-fast in isolated mode.** In-flight branches are not aborted; failure is
   reported only after all branches settle (`FlowExecutor.ts:245-247`, `:314-319`). Branch
   scheduling is **chunked, not a sliding window** (`:297-301`), so one slow branch stalls its chunk.

The only mechanism that genuinely forces sequential host execution is
`CapacityMode === "sequential"` (`src/runner/concurrency/CapacityContracts.ts:51-57`).

### 2.4 Concurrency admission — never hardcode capacity

Machine capacity is derived from `node:os` through an injectable probe
(`src/runner/concurrency/MachineCapabilityDetector.ts:43-63`); every number in
`DEFAULT_CAPACITY_TUNING` (`CapacityPlanner.ts:81`) is a fraction or seed, never a target. The lab
must query, not assume — three sanctioned paths:

- **Pure/in-process:** `detectMachineCapabilities` → `planCapacity` → `resolveEffectiveConcurrency`
  (pattern at `scripts/benchmark-concurrency.mts:116-125`).
- **Live from an engine:** `engine.getCapacitySnapshot()` (`ExecutionEngine.ts:356`). The repo's own
  harness states the rule outright — *"Concurrency is whatever the engine actually sustains,
  measured from `getCapacitySnapshot()`"* (`scripts/benchmark/engineHarness.mts:11`).
- **Settings-aware:** IPC `system:capacityPreview` (`app/main/capacityService.ts:136`).

Harness gotcha: `maxBrowsersPerHost` reconfiguration **silently no-ops while any slot is held**
(`src/runner/browser/BrowserWorkerPool.ts:80-87`).

### 2.5 Browser isolation — 4 classes, one resolver

`BrowserIsolationClass` (`src/runner/browser/BrowserIsolationResolver.ts:28`):
`SHARED_CONTEXT | DEDICATED_BROWSER | PERSISTENT_BROWSER | HANDOFF_BROWSER`. `shareable` is true
only for `SHARED_CONTEXT`. Note `BrowserContextFactory.ts` lives at **`src/runner/`**, not
`src/runner/browser/`.

Do **not** write assertions depending on shared-pool memory recycling: it is inert on the current
Playwright, which exposes no process handle, so `rootPid` is always undefined
(`src/runner/browser/SharedBrowserPool.ts:226-231`).

### 2.6 Cancellation

Custom `CancellationToken` (`src/runner/concurrency/CancellationToken.ts:15`), not `AbortSignal`
(which appears only in the Oracle node path, `StepExecutor.ts:1677-1678`). Cancellation is a hard
stop: the `onCancel` handler closes the live browser runtime
(`src/runner/PlaywrightRunner.ts:138-145`), and `cancelled` is in
`INFRA_TERMINAL_ERROR_CLASSES` so it is never retried (`RetryPolicy.ts:53`).

---

## 3. Persistence &amp; round-trip — Confirmed

`JsonProfileStore` (`src/storage/ProfileStore.ts:22`) is plain `JSON.stringify`/`JSON.parse` with
**no schema, no versioning, no migration, and an unvalidated cast** (`:145`, `:174`). Writes are
atomic (temp + rename, `:184-193`); corrupt files are quarantined, never dropped (`:157-171`).

**The designer↔profile mapping is where round-trip fidelity actually breaks**, and it is currently
untestable headlessly: `toFlowProfile`, `toFlowStep`, `toNodeConfig`, `createValueSource` and
`fromFlowStep` are **module-private functions inside a 1300-line `.tsx` page component**
(`app/renderer/pages/FlowChartDesigner.tsx:1101-1305`). Extracting them to a sibling module is the
single highest-leverage change for testability in this whole effort.

Known lossiness read directly from that code — these are **defects the lab would otherwise
"discover" expensively**:

| Loss | Location |
|---|---|
| `locator` written only when `requiresLocator` — a `screenshot`/`wait` step silently loses a saved locator | `:1138-1149` |
| `description`/`version` hardcoded, discarding loaded values | `:1102-1106` |
| `valueSource type:"secret"` cannot be emitted — `secretName` survives only if never re-saved | `:1213-1234` |
| Recorder popup/session metadata (`pageAlias`, `opensPopup`, `popupExpectation`) dropped on designer re-save | `:1125-1170` vs `buildRecordedFlow.ts:84-87` |
| `toNodeConfig` emits ~16 fields on **every** node type → config bloat, non-idempotent JSON | `:1173-1209` |
| `toWorkflowProfile` hardcodes `runtimeInputs` and drops `security` | `ScenarioBuilder.tsx:1748-1787` |
| `WorkflowEdge` has no structured connector config, so workflow-level conditional/parallel/loop is **not representable** | `WorkflowProfile.ts:51-61` |

---

## 4. Validation — Confirmed

Five separate validators, no unified one:

| Validator | Location | Returns | Save-blocking? |
|---|---|---|---|
| `validateConnectorStructure(edges)` | `src/profiles/FlowProfile.ts:531-565` | `string[]` | yes (enforced at `FlowExecutor.ts:69-72`) |
| `validateFlow(nodes, edges)` | `FlowChartDesigner.tsx:984-1050` | `string[]` | **advisory only** |
| `connectorStructureIssues` | `FlowChartDesigner.tsx:1059-1099` | `string[]` | **yes — the only save gate** (`:454-458`) |
| `FlowDependencyResolver.validate` | `src/orchestrator/FlowDependencyResolver.ts:10-79` | `ScenarioValidationIssue[]` | run-time |
| `PreRunValidator.validate` | `src/reports/PreRunValidator.ts:33-94` | `PreRunValidationIssue[]` | run-time |

**There is no reachability (BFS/DFS from Start) check at the flow level** — only per-node
incoming/outgoing degree. **The Workflow Builder has no start/end-count validator at all.**
`FlowDependencyResolver.findCycles` (`:142-162`) is a naive path-DFS with no memoization —
exponential on dense graphs, which is itself a generator safety constraint.

---

## 5. Existing verifier ecosystem — Confirmed

~130 `verify:*` scripts. **No `verify:all` aggregator exists.** Three dialects, and a new verifier
must match one exactly:

- **`.mts` (tsx) unit** — local `check(label, condition, detail?)` with `✓`/`✗`, `\nN passed, M failed`,
  `process.exit(1)` on failure. Imports use the `@src/*` alias. Each file **re-declares `check()`
  locally**; there is no shared `.mts` assertion harness.
- **Live-server** — spawns `mock-site/server.mjs` with `MOCK_SITE_PORT`, 60×100 ms readiness poll,
  `OK`/`FAIL` prefixes, `finally { browser.close(); server.kill(); }`.
- **`_electron` GUI** — uses `scripts/lib/gui-verify-harness.mjs` (`isolatedLaunchEnv`,
  `resolveMainWindow`, `signInFirstRun`) + `scripts/lib/e2e-qa-lib.mjs` (`makeChecker` — the
  canonical checker, returns a **failure count** from `summarize()`).

Ports already taken: 4321, 4399, 4401, 4407–4413, 4430, 4440, 4450, 4460, 14340, 14341.

Coverage that **already exists** and must not be duplicated: `verify:e2e-auth` (30),
`verify:e2e-rbac` (49, incl. direct-preload-IPC bypass attempts), `verify:e2e-licensing` (22),
`verify:auth` (49), `verify:authz` (40), `verify:licensing` (56), `verify:session-context` (11),
`verify:concurrency` (78), `verify:runner` (82), `verify:cancellation` (12), plus the `stress:*` and
`soak:*` sets.

---

## 6. Blocked or vacuous — features the spec assumes that do not exist

**This section is the main reason to read this document.** Each item would produce a test that
either cannot be written or would pass without proving anything.

| Spec ref | Assumption | Reality | Citation |
|---|---|---|---|
| §9, §32 | Runs can time out; `timedOut` is a status | **No `timedOut` literal and no run-level wall-clock timeout exist** | `src/instances/InstanceStatus.ts:1` |
| §8, §36 | Workflow `executionMode: parallel` produces parallel execution | Field is **dead at runtime** | `ScenarioProfile.ts:24-25` |
| §5, §8 | Parallel connectors run concurrently by default | Default `sharedPage` is a **sequential `for` loop** | `FlowExecutor.ts:210` |
| §5 | Connector field `maxBranchConcurrency` | Field is `maxConcurrency` | `FlowProfile.ts:459-472` |
| §27 | Export to CSV / Markdown / HTML / PDF | **JSON only.** No CSV/MD/HTML/PDF writer exists anywhere | `src/reports/ReportService.ts:75-80` |
| §27 | Report export is reachable from the UI | `reports:create/delete/export` are registered but **not in preload** | `report.ipc.ts:12-14` vs `preload.ts:288-289` |
| §30 | Live Report uses a subscription that can go stale | **No IPC push/subscription exists.** Everything is polled; the only bridge subscription is `appWindow.onMaximizedChange` | `preload.ts:87-91` |
| §30 | Live Report is a page | It is a **modal only**, no route | `LiveExecutionReportModal.tsx:66` |
| §6 | Recorder has pause/resume | **No public pause/resume API**; pause exists only as an internal handoff effect | `RecorderService.ts:681`, `:852` |
| §12, §22 | A `page.admin` permission gates the admin area | `Permission.PAGE_ADMIN` is **declared and never used anywhere** | `Permissions.ts:22` |
| §6, §7 | Mock site can exercise downloads / HTTP failures / iframes | **All three missing.** No `Content-Disposition` route, no 5xx/429/`Retry-After` endpoint, only an empty CAPTCHA-placeholder iframe | `mock-site/server.mjs:165` |
| §4 | `uploadFile` can be exercised end-to-end | File input exists but the server parser is `URLSearchParams`-only — no multipart endpoint | `mock-site/server.mjs:38` |
| §23 | License `REVOKED` etc. reachable in-app | Only `revokeLocal()`; there is no revocation service | `LicenseService.ts:172-180` |

**Recommendation:** treat these as a prerequisite backlog, not as test targets. Building the lab
against them first would generate a large amount of code that proves nothing.

---

## 7. Defects found during the audit — actionable now

Independent of the lab, the audit surfaced these. Each has a citation; none is speculative.

1. **`scripts/verify-durable-store.mts:34-41` asserts `migrations.length === 2`** but
   `RUNTIME_STORE_MIGRATIONS` now has **4** entries (`RuntimeStoreSchema.ts:17-289`). A fresh DB
   applies v1–v4, so this verifier fails. *Stale assertion — likely a currently-red check.*
2. **`ExecutionReports.tsx:66-68` calls `shell.openPath`**, but the preload exposes
   `system.openPath`. The optional chain silently no-ops, so **the "Open" button never works**.
   `ReportSummary` (`:20-31`) also does not match the stored shape, so cards render `undefined`
   names.
3. **`ConcurrentRunReport.skippedFlows` counts skipped *steps*, not flows**
   (`ReportService.ts:65-68`), while `passedFlows`/`failedFlows` count flows.
4. **Two `ReportCategory` values are unreachable**: `"network"` and `"data-binding"` have no
   `ErrorClass` mapping (`ReportCategories.ts:42-58`).
5. **Capacity-bucket retention comment contradicts code**: doc says 5000
   (`SqliteRuntimeStore.ts:393`), code retains 60 000 (`:402`), reads cap at 5000 (`:459`) — buckets
   5001+ are written, retained, and never readable.
6. **`SENSITIVE_PERMISSIONS` has no enforcing importer** (`Permissions.ts:59-67`). Sensitivity is a
   hand-passed boolean, and `SETTINGS_EDIT`/`SETTINGS_BRANDING_MANAGE` are members whose handlers
   pass **no** `sensitive` flag — so they are not re-auth-gated in practice.
7. **`StepSafetyPolicy` classifies type names that are not real `StepType`s**
   (`src/runner/runtime/StepSafetyPolicy.ts:18-41` lists `"assertion"`, `"extract"`, `"download"`,
   `"upload"`, `"press"`…), so `uploadFile`/`downloadFile`/`assertVisible`/`readText`/`oracle`/
   `manualHandoff` all fall through to the conservative `sideEffectLevel: "unknown", retryable: false`
   default.
8. **`findInterruptedRuns` only scans the 1000 most-recently-updated runs**
   (`SqliteRuntimeStore.ts:1006`) — an older interrupted run is invisible to startup recovery.
9. **Four telemetry channels have zero UI consumers**; **`countRunsByStatus` is unreachable from the
   renderer** (no `telemetry:statusCounts` channel).
10. **`app/main/ipc/oracle.ipc.ts` backend is still not sender-gated** (pre-existing, tracked as bd
    `awkit-b3w`).

---

## 8. Unknown / needs verification

- Whether `tests/*.spec.ts` runs in any CI — no CI config detected in the repo.
- Real-world blast radius of the `FlowDependencyResolver.findCycles` exponential path on dense
  generated graphs (the generator caps graph size to stay well clear).
