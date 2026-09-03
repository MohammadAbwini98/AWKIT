# AWKIT System Design Refactoring — Reconciled Implementation Plan

**Status:** planning complete; R0 and R1A complete; R1B is the next production tranche

**Repository baseline:** `main` at `18dc90d5a97cd37a2304d8a9885b899cc148d4cc`

**Reconciled:** 2026-09-02

**Companion:** `docs/plans/AWKIT_REFACTORING_INTEGRATION_HANDOFF_CHECKLIST.md`

## 1. Authority and scope

This is the repository-canonical replacement for the supplied
`AWKIT_SYSTEM_DESIGN_REFACTORING_IMPLEMENTATION_PLAN.md`. The supplied version was a useful generic
safety outline, but it was written without the live repository and incorrectly treated many mature
AWKIT systems as not yet designed.

Conflicts are resolved in this order:

1. the owner's current request;
2. live production code and persisted contracts on `main`;
3. root/local `AGENTS.md` and `docs/ai/{RULES,SECURITY,ARCHITECTURE}.md`;
4. the current validation ledger, Beads, phase source and verifier registry;
5. this plan;
6. the unreconciled supplied documents.

This task changes documentation only. It does **not** authorize production edits, schema migrations,
test weakening, UI redesign, package generation, or removal of legacy contracts. Each implementation
phase below requires its own task contract, Beads item, lease and evidence.

### Status vocabulary

| Status | Meaning |
|---|---|
| **Already implemented** | The live repository already has the proposed behavior and executable evidence. Preserve it; do not recreate it. |
| **Partially implemented** | The core exists, but a measured ownership or integration seam remains. |
| **Genuinely required** | Live code or authoritative documentation identifies actionable debt or missing proof. |
| **Obsolete/conflicting** | The proposal would duplicate, weaken, or contradict the current architecture. |
| **Needs clarification** | Repository policy and the proposal/user goal differ, or removing a surface could affect an undocumented consumer. |

## 2. Repository baseline and findings

### 2.1 Live state

- `main`, `HEAD`, and `origin/main` are all `18dc90d`; divergence is `0/0` and the working tree was
  clean before this documentation task.
- The four latest commits (`5d1e680`, `f70095b`, `6ccf0c3`, `18dc90d`) refine and verify locator
  blueprint recovery; they do not add a second execution or locator runtime.
- Beads contains 265 issues: 263 closed and two externally blocked Oracle items (`awkit-7bu`,
  `awkit-cm8`). There is no ready, open or in-progress implementation item for this refactor.
- Roadmap phases A–K are all `complete`. The comprehensive ledger is **65 PASS / 2 NOT RUN / 0
  BLOCKED**. The traceability matrix is **87 PASS / 12 NOT RUN / 3 BLOCKED**.
- `verify:verifier-classification` reconciles 199 commands: 1 documentation-consistency, 11
  static-source-validation, 63 unit, 36 integration, 77 real-browser, 11 packaged-application and 0
  clean-machine-acceptance.
- `verify:roadmap-dashboard` passes 177/177 and reports **Sources agree** at the baseline.

### 2.2 Current canonical ownership

| Concern | Live authority | Important consumers / boundaries |
|---|---|---|
| Run authorization | `app/main/security/sessionContext.ts`; `app/main/ipc/execution.ipc.ts` | Must remain sender/session/permission enforcement in Electron main. |
| License policy | `src/licensing/RunGatePolicy.ts`; `app/main/licensing/{licenseRuntime,licenseEnforcementService}.ts` | Request, pre-run, queue promotion, parked resume and repeat are deliberately separate enforcement points using one policy. |
| Pre-run validity | `src/reports/PreRunValidator.ts`; `src/validation/*`; main validation composition | Legacy Compatibility is content-bound and fail-closed; renderer findings are not authority. |
| Queue and execution lifecycle | `src/runner/ExecutionEngine.ts`, `src/instances/{InstanceManager,InstancePool,InstanceStatus}.ts`, `src/orchestrator/ConcurrentExecutionCoordinator.ts`, durable runtime store | The actual lifecycle is `pending/queued/starting/running/.../terminal`; there is no production `ExecutionQueue`. |
| Workflow orchestration | `src/orchestrator/ScenarioOrchestrator.ts`; `src/runner/PlaywrightRunner.ts`; `src/runner/FlowExecutor.ts` | `ScenarioOrchestrator` is live; `FlowOrchestrator`, `ExecutionQueue`, `FlowOutputRegistry` and `ConditionalFlowRouter` have no production importers. |
| Runner browser lifecycle | `src/runner/BrowserContextFactory.ts`, `PlaywrightRunner.ts`, browser/lock/concurrency modules | Owns bundled/installed execution contexts, pool leases, locks and cleanup. |
| Recorder browser lifecycle | `src/recorder/RecorderService.ts`, configured by `app/main/ipc/recorder.ipc.ts` | Separate owner because capture, live bindings, popup identity and handoff resume differ from execution. It reuses shared hardening/certificate policy. |
| Manual session capture | `src/session/SessionCaptureService.ts`; `app/main/ipc/session.ipc.ts` | Launches the user's installed Chrome/Edge only with an AWKIT-owned scoped profile; never runner hardening or the daily profile. |
| Recorder normalization | `RecorderService.applyLocatorRecordingMode`, recursive wait/signal normalization, `buildRecordedFlow.ts` | Default/XPath, frame/popup/wait/drag/shadow truthfulness use the existing `StepLocator` contract. |
| Profile contracts | `src/profiles/{FlowProfile,WorkflowProfile,ScenarioProfile}.ts` | Existing JSON is additive; Flow Designer preserves original/unknown step and locator metadata. |
| JSON persistence | `src/storage/ProfileStore.ts` and `src/storage/atomicReplace.ts`; factories in `app/main/profileStores.ts` | Atomic replacement is already one implementation. Factory-created stores can still have independent write queues. |
| Runtime persistence | `src/runner/store/{RuntimeStore,SqliteRuntimeStore,RuntimeStoreSchema}.ts` | SQLite via `sql.js`, versioned additive migrations, single engine-owned durable store. Do not replace with profile JSON. |
| IPC contract | `app/main/ipc/*`; `app/main/preload.ts`; `scripts/verify-ipc-contract.mts` | Preload name stays `window.playwrightFlowStudio`; handlers declare permission, trusted or deliberately open status. |
| Reports/observability | `ExecutionEngine`, `src/reports/*`, durable runtime queries, `app/main/ipc/{report,telemetry}.ipc.ts` | JSON execution reports and SQLite telemetry are complementary, not duplicate telemetry architectures. |
| Offline/package policy | `app/main/appPaths.ts`, `src/offline/*`, `electron-builder.json`, packaging scripts | Bundled Chromium, standard-user roots and no production internet are non-negotiable. |

### 2.3 Measured debt this plan may address

| ID | Finding | Classification | Code-grounded consequence |
|---|---|---|---|
| G1 | `ExecutionEngine.ts` imports `app/main/ipc/session.ipc.ts` and `app/main/profileStores.ts`. | **Genuinely required** | The framework-agnostic runner transitively depends on Electron-main composition. The existing `appPaths` import is the one currently sanctioned bridge and is not part of the first cut. |
| G2 | Main-process callers repeatedly construct stores with `create*ProfileStore()`. `ExecutionEngine` and `report.ipc.ts` use different report-store instances. | **Genuinely required** | `JsonProfileStore.writeChain` is instance-local, so unrelated instances targeting one folder are not mutually serialized. Preserve the existing store and atomic writer; consolidate instance ownership. |
| G3 | `execution.ipc.ts` owns authorization plus workflow loading, validation, compatibility attribution, license request/pre-run gates, data-source materialization, capacity application, instance-template assembly and engine dispatch. | **Genuinely required** | The handler is a composition/application-service boundary in one file, not a thin transport. Extract without moving sender authorization or duplicating policy. |
| G4 | `ExecutionQueue`, `FlowOrchestrator`, `FlowOutputRegistry`, `ConditionalFlowRouter`, `InstanceEvents` and `InstanceLockManager` have no live importers. Several backend-only legacy IPC mutations also have no preload/renderer consumer. | **Partially implemented** | Dead names imply a parallel architecture that does not actually protect production. Remove only after an executable no-consumer/public-contract check. |
| G5 | `uiSettings.ts` intentionally prunes unknown fixed-schema keys and `verify:settings-e2e` SET-017 requires that behavior. Profile mappings preserve unknown fields. | **Needs clarification** | A global “preserve every unknown field” migration conflicts with a current security/normalization decision. No settings behavior changes until an explicit decision replaces or confirms SET-017. |
| G6 | The old `PROJECT_BRIEF.md` named WebFlow Studio and said no SQLite, while package metadata/app paths name SpecterStudio and the durable runtime uses SQLite. | **Already corrected by this planning task** | Documentation identity/data-store drift is removed; no runtime behavior changes. |
| G7 | Existing suites strongly prove behavior, but no focused gate pins the intended execution dependency direction or proves that store instances sharing a folder serialize together. | **Genuinely required** | Add characterization/negative controls before moving ownership. A static architecture check cannot substitute for queue, cancellation, licensing or persistence behavior tests. |

## 3. Reconciliation of the supplied phase plan

| Original proposal | Status | Reconciled disposition |
|---|---|---|
| Scope note: uploaded archive was unavailable and must later become authoritative | **Obsolete/conflicting** | Both supplied Markdown files were readable. No unseen archive outranks live AWKIT. Remove the future override clause. |
| Objectives 1–3: offline architecture, data compatibility, less duplication | **Already implemented / ongoing** | Keep as invariants. “Compatibility” means preserve current JSON, SQLite migration and settings semantics unless a specific migration is approved. |
| Objectives 4–5: establish ownership and separate Recorder/Runner/Orchestrator/storage/IPC/renderer | **Partially implemented** | Most owners are already explicit. Address only G1–G4; do not create replacement domain models. |
| Objectives 6–10: security, local data, no parallel paths, regression evidence, roadmap sync | **Already implemented as policy** | Keep as phase gates. They are not new product work. |
| Phase 0: reconciliation/baseline | **Already implemented** | This document, its companion checklist, Graphify/source inspection and baseline verifiers satisfy it. |
| Phase 0: identify duplicate execution admission | **Partially implemented** | Multiple enforcement checkpoints are intentional defense in depth over one license policy; do not collapse them. G3 is an application-service extraction, not a “single gate.” |
| Phase 0: identify duplicate flow/workflow conversion | **Partially implemented** | `workflowToScenarioProfile` is live. The reverse converter is lossy but only backs an unexposed legacy save channel; prefer retiring that channel to expanding a second authoring path. |
| Phase 0: identify duplicate locator/wait handling | **Already implemented** | Recorder → `FlowStep` → `LocatorFactory`/`StepExecutor` is one contract. XPath and Smart Wait are modes/metadata, not runtimes. |
| Phase 1A: define Flow/Workflow/Step/Connector/Locator/Wait/data/session/run/report contracts | **Already implemented** | These types already exist under `src/`. Do not create a new “contracts” layer. Add only narrow injected ports required by G1/G2. |
| Phase 1B: separate domain and IPC DTOs | **Partially implemented / needs clarification** | Preload uses production types where stable and `unknown` for some responses. A wholesale DTO rewrite has no measured defect and would create migration surface. Scope DTO changes only to the extracted execution service, keeping the preload API stable. |
| Phase 1C: preserve old/unknown fields | **Partially implemented** | Flow/locator/designer mapping and JSON stores preserve them. Workflow reverse conversion is lossy but legacy-only. Settings intentionally prunes them and is a decision gate, not an automatic migration. |
| Phase 2 target dependency flow | **Already implemented in broad shape** | Renderer → preload → main authorization/composition → engine → runner/browser/data/store is the live path. G1/G3 are the remaining leaks. |
| Phase 2 execution admission centralization | **Obsolete/conflicting as written** | Retain separate auth, validation, licensing, capacity/resource and dispatch checks. One application service sequences them; one policy implementation owns each decision. |
| Phase 2 queue state `created → pending → admitted → ...` | **Obsolete/conflicting** | It invents persisted states not in `InstanceStatus`. Preserve existing values and reports. Consolidate predicates/transitions without a schema rename. |
| Phase 2 queue cancellation/concurrency invariants | **Already implemented** | Hard cancellation, durable cancellation, slot/claim/lock cleanup, capacity config and parked-instance accounting exist. Strengthen characterization before refactoring. |
| Phase 2 orchestration ownership | **Partially implemented** | `ScenarioOrchestrator`, `FlowExecutor` and `ExecutionEngine` have distinct live roles. Remove dead names and extract IPC application logic; do not merge the live three. |
| Phase 3 centralize all browser lifecycle | **Obsolete/conflicting as written** | Runner, Recorder and manual session capture intentionally own different lifecycles. Share launch policy/resolvers where semantics match; never route protected login through an automation-browser abstraction. |
| Phase 3 Recorder five-layer split | **Already implemented in behavior** | Capture/init script, `RecorderService` normalization/policy/draft, `buildRecordedFlow`, profile store and renderer are distinct. Avoid a speculative class split of the large service until a measured defect requires it. |
| Phase 3 Default/XPath/frame/popup/wait/session/action-order invariants | **Already implemented** | Recorder 272/272, GUI 192/0/0, Flow mapping 194/194 and Runner 138/138 are current evidence at `33fb6cf`; upstream refactors must rerun them. |
| Phase 3 protected-login requirements | **Already implemented** | Detector/manual handoff/session capture boundaries are security authority. No new browser owner may bypass them. |
| Phase 4 inventory persisted objects | **Partially implemented** | Stores and migration verifiers exist, but no one cross-aggregate compatibility ledger exists. The companion checklist now provides it. |
| Phase 4 one repository/store per aggregate | **Partially implemented** | One store implementation exists, but main repeatedly creates instances. Consolidate composition, not file formats. JSON reports and SQLite runtime remain separate aggregates. |
| Phase 4 atomic writes | **Already implemented** | `src/storage/atomicReplace.ts` is the one retry implementation; the main facade and session JSON writer delegate to it. Do not “fix” the stale 2026-08-22 description by adding another helper. |
| Phase 4 mutable data locations | **Already implemented** | App paths/configured paths are authoritative. Verify after touched storage/package work. |
| Phase 4 migration tests | **Partially implemented** | Strong per-area suites exist. Add shared-store concurrency and a consolidated compatibility matrix; do not rewrite all migrations. |
| Phase 5 renderer simplification | **Needs clarification** | No renderer defect is established by this plan. Limit UI work to adapting unchanged commands/results; no unrelated redesign or new state store. |
| Phase 5 IPC six-step pattern | **Partially implemented** | Authorization registry and payload-specific checks exist. `execution.ipc.ts` needs application-service extraction, while sender checks remain in handlers. Read-only/pre-login exceptions stay explicitly registered. |
| Phase 6 one result-state enum including `INCONCLUSIVE`/`CANCELLED` | **Obsolete/conflicting** | AWKIT evidence vocabulary is `PASS/FAIL/BLOCKED/NOT RUN/NOT APPLICABLE`; product runtime has separate instance/run statuses. Do not conflate evidence, execution and report domains. |
| Phase 6 observability/reporting | **Already implemented / G2 partial** | Existing SQLite telemetry and JSON reports are canonical. Fix report-store composition only; add no telemetry database or event bus. |
| Phase 7 verifier-driven migration pattern | **Already implemented as workflow** | Keep and apply to every later work item. Use failing mutation/negative controls and truthful counts. |
| Phase 8 integration cutover | **Genuinely required later** | Execute only after all callers use the extracted seams and legacy surfaces are proven unused. |
| Phase 9 packaged/offline acceptance | **Genuinely required final gate** | Package only after code phases. Existing artifacts do not prove a future refactor. |
| Phase 10 project-state reconciliation | **Already implemented as every-phase workflow** | Perform after each work item, not just at the end. |
| Original recommended order | **Partially implemented / reordered** | Compatibility characterization precedes ownership moves; store/port seams precede IPC extraction; browser/Recorder/reporting are regression consumers; dead-code removal occurs only after consumer proof. |

## 4. Data compatibility requirements

| Persisted aggregate | Current owner/format | Baseline | Refactor rule | Required evidence |
|---|---|---|---|---|
| Flow profiles | `JsonProfileStore<FlowProfile>` JSON | Unknown top/step/config/locator fields survive designer no-op edit/save through `originalStep` and merge logic. | No required-field rename. Additive optional fields only. Preserve absent-vs-default distinctions. | `verify:profile-store`, `verify:flow-step-mapping`, `verify:legacy-compat`, Recorder suites. |
| Workflow profiles | `JsonProfileStore<WorkflowProfile>` JSON | Builder retains the loaded document and known policies; forward conversion is live. | Keep stored node ids, sentinels, timestamps, policies, bindings and unknown fields. Do not use lossy reverse conversion for normal saves. | `verify:workflow-builder`, `verify:workflow-sentinels`, `verify:flow-step-mapping`, old fixture. |
| Scenario runtime projection | In-memory `ScenarioProfile` | Derived from Workflow; structural sentinels are filtered. | Treat as an execution projection, not a second authoring store. Retire or explicitly justify reverse-save IPC. | `verify:runner`, `verify:workflow-sentinels`, `verify:legacy-compat`. |
| Data sources/runtime inputs | JSON profile stores plus configured external JSON/Oracle references | Existing ids and bindings resolve through trusted main paths. | No path broadening, secret materialization or external-file relocation. Preserve unknown profile fields. | `verify:oracle-profiles`, `verify:oracle-mock-ui-workflow`, `verify:runner`, profile-store gate. |
| Recorder draft/URL history | Recorder-owned JSON, atomic session writer | Schema v2 URL/favorite and draft compatibility exist. | Preserve draft recovery, URL sensitivity policy, action order and unknown action/locator metadata. | `verify:recorder-draft`, `verify:recorder-actions`, `verify:recorder-gui`. |
| Session profiles | `SessionCaptureService`, `session-profiles.json` | Atomic, pretty-printed, corruption quarantine, app-owned profile dirs. | Preserve ids/status/origin/source and unknown fields; never import the daily browser profile. | session/runner/Recorder protected-login suites and restart fixture. |
| UI settings | `app/main/uiSettings.ts`, fixed schema JSON | Unknown fixed-schema keys are intentionally pruned; dynamic maps are retained. | **Blocked on decision.** No refactor may silently change SET-017 or claim global unknown-field retention. | `verify:settings-persistence`, `verify:settings-e2e`; explicit decision and migration test if changed. |
| JSON execution reports | `ReportService` + report profile store | Readable/exportable compatibility; separate from telemetry. | Share one main-process write coordinator/store authority; preserve old report imports/exports. | `verify:run-report-compatibility`, `verify:reports-populated-gui`, new cross-instance store race test. |
| Durable runtime | `runtime.sqlite`, `SqliteRuntimeStore`, schema migrations | Additive migrations and startup recovery exist. | No replacement store. Migrations are versioned, idempotent and preserve old rows/unknown JSON payload members. | `verify:durable-store`, `verify:startup-recovery`, `verify:durable-accuracy`, packaged runtime. |
| Security/license state | dedicated security/license stores | Trusted main ownership, signing/high-water/audit rules. | No profile-store consolidation that crosses secret/license boundaries. Preserve fail-closed reads and key custody. | licensing, authz, session-context, custody and packaged licensing gates. |
| Oracle/Java driver registries | dedicated stores under runtime roots | Existing profiles/bundles survive settings resets. | Do not fold native-runtime registries into generic profile CRUD. | Oracle profile/driver/settings gates. |

## 5. Execution-ready phased sequence

Every phase is a separate Beads item and coherent commit. “Independent” means it has no code
dependency; AWKIT's single-writer `main` policy still prevents simultaneous repository writers.

### R0 — Characterize architecture and make regressions fail loudly

**Classification:** **complete 2026-09-03**; verifier-only; no product behavior change.

**Dependencies:** none.

**May run independently:** yes; must precede R1–R7.

**Scope**

1. Add a focused `verify:execution-architecture` command (or extend a demonstrably equivalent
   existing gate) that inventories live production imports/callers and pins:
   - one renderer/preload execution entry group;
   - `execution.ipc.ts` as current composition boundary;
   - `ExecutionEngine` as queue/runtime owner;
   - `ScenarioOrchestrator` as the live workflow planner;
   - zero production importers for the six dead candidates;
   - the two disallowed `ExecutionEngine` upward dependencies as explicit expected failures to remove,
     while retaining the currently sanctioned `appPaths` bridge.
2. Strengthen behavioral characterization rather than relying on source scans:
   - queued cancel cannot promote and repeated cancel is idempotent;
   - terminal stop cannot relabel history;
   - parked instances retain capacity;
   - request/pre-run/dispatch/repeat/resume licensing checkpoints use the same pure policy;
   - two current profile-store instances targeting the same folder can interleave their independent
     queues, while the future R1B coordinator must make that interleaving impossible.
3. Add mutation/negative controls that break each structural and behavioral assertion.
4. Register any new command in `scripts/lib/verifier-classification.ts` and roadmap sources.

**Owning files/modules**

- `scripts/verify-execution-architecture.mts` (new, QA) or exact existing verifier extensions;
- `scripts/verify-{license-dispatch-gate,cancellation,profile-store}.mts` where behavior belongs;
- `package.json`, `scripts/lib/verifier-classification.ts`, project-state sources.

**Compatibility/security/offline**

- No persisted shape or production code changes.
- Tests must not launch protected-login automation or require the internet.
- Store race fixtures use isolated temporary roots.

**Acceptance**

- Each new check fails under a targeted broken-behavior mutation and passes restored code.
- Baseline semantics and live/dead import inventory are explicit.
- `build`, script typecheck, focused gates, classification and roadmap all report exact counts.

**Executed evidence (2026-09-03)**

- `verify:r0-characterization` passes **85/85**, with a targeted negative/mutation control for every
  architecture, race, lifecycle, capacity, checkpoint and consumer guard.
- The exact current upward edges are `ipc/session.ipc` and `profileStores`; `appPaths` remains a
  separately sanctioned bridge. `execution.ipc.ts` is the sole production `startRun` caller.
- Real same-folder stores overlap (`maxActive = 2`); atomic replacement remains whole-file safe, while a
  stale snapshot can lose the other instance's field. R1B is confirmed, not implemented.
- Cancellation, saturation/release, browser backpressure, canonical capacity derivation and thirteen
  independent licensing checkpoint groups are pinned without sleeps or production seams.
- Six candidates are apparently dead by production/dynamic/IPC/preload/persistence/test-tool/built-bundle
  evidence; `ScenarioOrchestrator` is live. R3 still owns deletion.
- No R1+ production file changed. Build, script typecheck, Runner and all focused R0 gates pass; the
  command is registered as integration evidence.

**Rollback/risk**

- Low product risk; highest risk is a brittle source-shape assertion. Prefer AST/import analysis and
  behavior probes. Revert only the focused verifier/registration as one unit if the oracle is wrong.

### R1 — Remove core upward dependencies and unify store write ownership

**Classification:** genuinely required.

**Dependencies:** R0.

**May run independently:** R1A and R1B can be designed separately, but land sequentially.

#### R1A — Narrow ExecutionEngine ports

**Classification:** **complete 2026-09-03**.

- Introduce only the minimum framework-agnostic ports required for session lookup/use and JSON report
  persistence; do not create a generic repository/service framework.
- Inject those ports from Electron main composition.
- Remove `ExecutionEngine` imports of `app/main/ipc/session.ipc.ts` and
  `app/main/profileStores.ts`.
- Keep the documented `appPaths` bridge in this tranche; removing it is a separate, optional proposal
  only after packaged-path characterization.
- Preserve constructor compatibility for verifier/benchmark engines through explicit safe defaults,
  without a production fail-open path.

**Executed evidence (2026-09-03)**

- `ExecutionEngine` has no `session.ipc` or `profileStores` import; `appPaths` remains the sole permitted
  main-process edge. `ExecutionEnginePorts.ts` contains only the session-access and report-persistence
  shapes used by the runner.
- Existing Electron main composition injects `getSessionService()` and
  `createReportStore().import(report)`. The report store remains per-write so R1A does not silently
  implement R1B; production bootstrap fails closed if ports are absent.
- R0 characterization passes **99/99** with real negative controls for both former imports, an alias-
  based replacement dependency, missing production composition and report/session compatibility drift.
- Build, scripts typecheck, Runner/session/protected-login, report compatibility/live/GUI/a11y,
  profile-store/write-queue, licensing/dispatch, cancellation/concurrency, source/offline and verifier-
  classification gates pass. Populated Reports' first screenshot attempt failed at the evidence capture;
  its clean retry passed **168/0/3 NOT RUN**. No fixture behavior changed, so Mock Site is not applicable.

#### R1B — One write coordinator per resolved profile folder

- Make store instances targeting the same resolved folder share serialization, or expose one cached
  main-process store registry keyed by resolved folder.
- Path changes in Settings must select the new folder safely; never retain a stale store after a path
  change.
- Migrate main callers one at a time while factory compatibility remains; remove the compatibility
  alias only after no consumers remain.
- Change `src/storage/ProfileStore.ts` to import `src/storage/atomicReplace.ts` directly. Keep the
  `app/main/atomicReplace.ts` re-export for existing main callers until proven removable.

**Owning files/modules**

- `src/runner/ExecutionEngine.ts` and one narrowly named port file;
- `app/main/execution/*` composition;
- `app/main/profileStores.ts` and current IPC/store consumers;
- `src/storage/ProfileStore.ts`.

**Migration/compatibility**

- No file-format, id, folder, default, report or session change.
- Existing factory signatures stay until all callers move.
- Existing corrupt-file quarantine, atomic rename and pretty-print behavior remain.

**Acceptance and verifiers**

- No non-sanctioned `src/** → app/main/**` import remains.
- Concurrent writers through two acquired handles serialize and preserve both valid documents.
- Runs still write the same JSON report and SQLite rows; report list/delete/export sees the same file.
- Required: R0 gate, `verify:profile-store`, `verify:write-queue`, `verify:run-report-compatibility`,
  `verify:runner`, `verify:reports-populated-gui`, build, script typecheck.

**Rollback/risk**

- Main risk is store caching across configured-path changes and test engines accidentally receiving a
  permissive production adapter. Keep old factories as thin adapters until all callers pass.

### R2 — Extract one execution application service; preserve independent gates

**Classification:** genuinely required.

**Dependencies:** R1A and R1B.

**May run independently:** no.

**Scope**

- Move workflow/profile loading, projection, pre-run validation, compatibility attribution,
  data-source resolution, capacity application, instance-template construction and call to
  `ExecutionEngine.startRun` from `execution.ipc.ts` into one main-process application service.
- Keep sender/session/RBAC checks in each IPC handler.
- Keep pure license policy in `RunGatePolicy`; request/pre-run checks in the application boundary and
  promotion/repeat checks in the engine. The service sequences these checkpoints; it does not replace
  them with a new policy table.
- Keep `RunWorkflowRequest` and the preload API backward compatible. Return changes must be additive.
- Preserve dry-run behavior, installed-Chrome Super User rule, certificate-trust precedence, Legacy
  Compatibility attribution, Oracle/JSON resolution and settings-derived capacity.

**Owning files/modules**

- new `app/main/execution/ExecutionApplicationService.ts` (or similarly specific name);
- `app/main/ipc/execution.ipc.ts`;
- main composition and focused tests only.

**Acceptance and verifiers**

- IPC handler performs transport validation/authorization and one service call for run/validate.
- Exactly one production service instance uses the one production engine and store registry.
- Viewer dry-run remains available; unauthorized real run remains denied before license disclosure.
- License transitions between request and promotion still cancel/hold pending work truthfully.
- Required: `verify:ipc-contract`, `verify:e2e-rbac`, `verify:e2e-licensing`,
  `verify:license-dispatch-gate`, `verify:settings-runner-behaviour`, `verify:runner`, R0 gate and build.

**Rollback/risk**

- Highest risk is changed check ordering or error shape. Move one helper at a time, compare exact return
  fixtures, and keep the old handler facade until parity is green.

### R3 — Consolidate lifecycle predicates and retire dead orchestration stubs

**Classification:** partially implemented; cleanup genuinely required after proof.

**Dependencies:** R0; may land before or after R1/R2 if it does not touch their files.

**May run independently:** yes logically; serialize Git work.

**Scope**

- Add canonical pure predicates in `src/instances/InstanceStatus.ts` for terminal, dispatchable,
  active/capacity-occupying and stoppable states; migrate duplicated literal arrays carefully.
- Preserve every persisted/status string. Do **not** add `created` or `admitted` states.
- Remove unused `InstanceManager` pause/resume/stop helpers if R0 proves no consumer.
- Delete the six zero-import legacy files only after AST/import, package and packaged-source checks.
- Update `ARCHITECTURE.md` so only live orchestration components are advertised.

**Acceptance and verifiers**

- Queued/pending cancellation cannot reverse; terminal history is immutable; manual handoff and pause
  occupy capacity; cleanup statuses do not appear terminal early.
- `verify:cancellation`, `verify:concurrency`, `verify:browser-pool`, `verify:runtime-status`,
  `verify:instance-monitor`, `verify:instance-monitor-gui`, `verify:runner`, source hygiene and R0 gate.

**Rollback/risk**

- Status classification affects UI and dispatch. Migrate one predicate family per commit; no enum/string
  migration. Restore a removed file only if a real consumer is found—never reintroduce it as a shim by
  default.

### R4 — Decide and retire legacy IPC/persistence projections

**Classification:** needs clarification, then potentially required.

**Dependencies:** R0; R2 preferred so live execution IPC is already isolated.

**May run independently:** decision/research can; removal cannot overlap other IPC edits.

**Scope**

- Inventory `BACKEND_ONLY` channels and the exposed-but-renderer-unconsumed `scenarios`, `instances` and
  `runtimeInputs` groups.
- For each, obtain one of: documented external/public consumer, retained compatibility deadline, or
  removal approval.
- Prefer deleting unexposed `scenario:get/save` and its lossy reverse conversion over making a second
  Workflow authoring path.
- Never delete persisted workflow/instance/runtime-input files as part of channel retirement.
- Keep legacy aliases only when a real compatibility consumer is named and tested.

**Clarification gate**

- Is `window.playwrightFlowStudio` consumed only by the bundled renderer, or is any supported external
  extension/integration entitled to backend-only/legacy methods? Repository evidence alone cannot grant
  external API compatibility.

**Acceptance and verifiers**

- No registered handler is unexposed and undocumented; no preload method lacks a bundled renderer or a
  documented compatibility consumer.
- No production use of `scenarioToWorkflowProfile` remains unless a lossless compatibility test covers it.
- Required: `verify:ipc-contract`, `verify:e2e-rbac`, workflow/profile compatibility gates, source hygiene,
  build and packaged walkthrough if preload shape changes.

**Rollback/risk**

- External consumer risk is the blocker. If ownership cannot be resolved, retain the channel, document it
  and exclude it from completion rather than guessing.

### R5 — Compatibility ledger and Settings decision

**Classification:** partially implemented; Settings is clarification-blocked.

**Dependencies:** R1–R4 for affected aggregates.

**May run independently:** fixture inventory/decision can; migrations cannot.

**Scope**

- Create versioned old/current fixtures for every touched aggregate in the table above.
- Prove load → no-op save, edit → save, import/export/clone where supported, restart and runtime use.
- Preserve unknown fields for profiles, steps, locators, waits, workflow nodes/edges, report JSON and
  opaque JSON payload members.
- Do not change Settings unknown-key pruning without an explicit decision that addresses the security
  purpose of rejecting crafted keys and updates SET-017 with stronger—not weaker—coverage.
- Do not add migration code when an adapter/projection can preserve bytes safely.

**Acceptance and verifiers**

- No touched old fixture loses unknown or absent fields.
- Migration failure leaves original bytes recoverable and produces an actionable error.
- Required: `verify:profile-store`, `verify:flow-step-mapping`, `verify:legacy-compat`,
  `verify:workflow-sentinels`, `verify:recorder-draft`, `verify:durable-store`,
  `verify:run-report-compatibility`, settings gates only if Settings changes.

**Rollback/risk**

- Downgrade compatibility may be impossible for additive fields consumed by old binaries; document it
  before writing. Never “normalize” by stripping fields to make an old fixture pass.

### R6 — Cross-layer fidelity gate: browser, Recorder, sessions and reports

**Classification:** existing systems; integration proof required, redesign not authorized.

**Dependencies:** R1–R5.

**May run independently:** focused suites can be run in parallel processes only if their isolated-profile
rules allow it; code changes remain serialized.

**Scope**

- Adapt only dependency injection/call sites required by preceding phases.
- Keep three browser owners distinct: execution browser factory, Recorder capture browser and manual
  installed-browser session capture.
- Keep one locator/step/runtime path; no XPath runner, Recorder repository or telemetry store.
- Prove protected-login precedence over closed-shadow/locator recovery and no secret/session content in
  logs/reports.

**Acceptance and verifiers**

- Recorder Default/XPath prospective switching and exact persisted replay remain unchanged.
- Frame, popup, drag/drop, hover, Smart Wait, shadow limitations, recovery thresholds and sensitive-action
  refusal remain truthful.
- Session profile locks, two-phase swaps, crash/cancel cleanup and report/artifact output remain intact.
- Required: `verify:recorder`, `verify:recorder-gui`, `verify:recorder-e2e`,
  `verify:recorder-ambiguity`, `verify:blueprint-recovery{,-browser}`, `verify:frame-chain`,
  `verify:closed-shadow`, `verify:waits`, `verify:smart-wait-causality`, `verify:runner`,
  `verify:flow-step-mapping`, session/protected-login gates, report gates and mock-site.
- GUI evidence: real Electron Recorder, Flow Designer, Workflow Builder, Instance Monitor and Reports in
  affected states. No cosmetic redesign.

**Rollback/risk**

- This is a stop/go gate. Any behavioral delta sends the owning earlier phase back for repair; do not
  patch Recorder/Runner locally merely to accommodate an incorrect service abstraction.

### R7 — Integration cutover and legacy adapter removal

**Classification:** genuinely required after migration.

**Dependencies:** R1–R6 and R4 clarification.

**May run independently:** no.

**Scope and acceptance**

- Search/Graphify proves all production callers use the intended service/ports/store authority.
- Remove temporary adapters only when old persisted data still loads and no supported IPC consumer uses
  them.
- No duplicate policy table, queue, browser owner, Recorder normalizer, report store or telemetry store
  remains.
- Run build, all touched focused suites, source hygiene, verifier classification, roadmap and `git diff
  --check`.

**Rollback/risk**

- Commit removals separately from behavior moves so reverting restores adapters without reverting the
  proven implementation.

### R8 — Packaged/offline and clean-profile acceptance

**Classification:** required release gate, not a prerequisite for early code commits.

**Dependencies:** R7.

**May run independently:** no.

**Scope and acceptance**

- Build current portable/installer artifacts from a clean source commit; do not reuse historical package
  evidence.
- Exercise fresh profile and representative existing-profile upgrade; Flow/Workflow/Recorder/session/
  cancellation/report/settings paths; bundled Chromium; standard user; no global runtime/browser;
  no non-loopback dependency; clean shutdown with no leaked Chromium.
- Run `validate:offline -Strict`, packaged validation/runtime/walkthrough, offline supply-chain and source
  hygiene. Record Authenticode and external Oracle/issuer prerequisites truthfully.
- Package/GUI evidence is required because this phase changes confidence in the shipped composition, not
  just TypeScript.

**Rollback/risk**

- A packaging/environment block does not justify weakening gates or deleting payloads. Preserve failed
  evidence, fix the owning phase or record `BLOCKED`/`NOT RUN`, and continue only within policy.

### R9 — Project-state closeout

**Classification:** already established workflow; required after every phase and once at final closeout.

**Dependencies:** each phase's evidence.

- Update/close the phase's Beads item and real `blocks` edges.
- Clear the roadmap assignment when ownership ends.
- Update validation/defect/traceability/phase sources only when facts change.
- Update `CURRENT_STATE`, `HANDOFF`, `TASK_LOG` and relevant architecture/known-issue/decision docs.
- Register new commands; run memory, classification and roadmap gates; confirm **Sources agree**.
- Commit and push normally to `main`; never force, reset, stash or discard user work.

## 6. Dependency order and independent work

```text
R0 Characterization (complete)
 ├─> R1A Engine ports ─┐
 ├─> R1B Store owner ──┼─> R2 Execution application service ─┐
 ├─> R3 Lifecycle/dead stubs (logically independent) ─────────┤
 └─> R4 Consumer decision (research independent) ─────────────┤
                                                              └─> R5 Compatibility ledger
                                                                   └─> R6 Cross-layer fidelity
                                                                        └─> R7 Cutover
                                                                             └─> R8 Packaged acceptance

R9 runs after every completed box and again after R8.
```

R3 implementation and R4 research may proceed after R0 without waiting for R1, but repository writes
must still be serialized. R2 is blocked by both R1 tranches. R4 removal is blocked by the external/public
consumer decision. R5 implementation is blocked by the Settings decision only if Settings enters scope.
R6–R8 are strictly ordered.

## 7. Verification strategy

### Always for a code phase

```powershell
npm run build
npm run typecheck:scripts
npm run verify:runner              # when runtime/orchestration/call path changes
npm run verify:verifier-classification
npm run verify:roadmap-dashboard
node scripts/ai-memory/check-memory.mjs
git diff --check
```

Run `verify:source-hygiene` when imports/dead surfaces/package contents change and `validate:offline`
when runtime dependencies, paths, browser resolution, preload/package contents or persistence placement
change. Focused commands are listed per phase; counts must be reported from the actual run.

### Evidence rules

- Use only `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, `NOT APPLICABLE` in project evidence.
- A source-shape assertion proves architecture shape only; pair it with the behavior gate it protects.
- Every new/materially changed verifier needs a targeted negative control and a pinned inventory/cardinality.
- Historical Recorder/package counts are baseline context, not future PASS evidence.
- GUI/package evidence is required only where the phase affects the rendered or shipped composition, but
  missing required evidence remains `NOT RUN`/`BLOCKED`, never inferred green.

## 8. Risks and explicit non-goals

1. **Mega-service risk:** extracting IPC logic into one service can merely move a god object. Keep the
   service an application coordinator over existing policies; do not absorb runner internals.
2. **Gate-collapse risk:** “one admission path” must not remove independent authorization, validation,
   license, capacity/resource and dispatch-time checks.
3. **Store-cache risk:** singleton stores can become stale when configured paths change. Key by resolved
   folder and test path switching.
4. **Unknown-field risk:** settings pruning conflicts with general forward-compatibility language. Treat it
   as a decision, not a covert migration.
5. **External IPC risk:** backend-only/unconsumed in this repository does not prove unsupported externally.
   Obtain an owner decision before removal.
6. **Browser-owner risk:** combining runner, Recorder and manual session capture would weaken protected
   login and isolation. Share policy helpers, not lifecycle ownership.
7. **Report dual-format risk:** JSON reports and SQLite telemetry serve different consumers. Do not
   “deduplicate” them into a new store.
8. **Verifier brittleness:** import/string scans can stay green while behavior breaks. Pair structure and
   runtime probes.
9. **Scope creep:** no unrelated UI, schema, licensing, reporting feature or packaging optimization belongs
   in this refactor.

## 9. Definition of done

The refactor is complete only when G1–G4 and G7 are closed with executed evidence, G5 has an explicit
decision or remains out of scope, all supported data and unknown fields satisfy the compatibility ledger,
the live call path has no parallel runtime/policy/storage owner, cross-layer GUI/runtime behavior is green,
fresh packaged evidence is recorded, authoritative sources agree, and all work is committed/pushed to
`main` without discarded user work.

## 10. Single recommended next implementation phase

Start with **R1B — One write coordinator per resolved profile folder**. R1A is complete and leaves the
existing report-store factory lifetime deliberately unchanged. Coordinate handles by their resolved,
current configured folder while preserving factory compatibility, atomic replacement, JSON shapes,
unknown fields and path-change behavior. Do not begin R2 execution IPC decomposition in the same tranche.
