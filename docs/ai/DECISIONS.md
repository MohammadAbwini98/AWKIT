# DECISIONS

### 2026-09-20 — Phase L L3 §6: controlled locator promotion, audit and revert (`awkit-djnl.4`)

- **One trusted operation, re-deriving everything.** `promoteLocatorUpgrade` (`src/ai/locatorPromotion.ts`) is
  the only path from `pendingUpgrade` to the saved locator, and it runs inside the flow store's lane. It takes
  no `eligible` flag and no caller-chosen tally: the caller names a flow, a step and the candidate's
  `createdAt`, and everything else is recomputed from the profile the lane hands it. The Flow Designer's badge
  comes from a DRY RUN of the same function, so the preview and the write cannot disagree.
- **Evidence is selected inside the lane, never summed across scenarios.** A replay tally is keyed by
  scenario, so one flow step can have several. `selectReplayEvidence` considers only tallies whose candidate
  and binding digests match the step as it is now; one refusal in any of them disqualifies the candidate for
  good; otherwise a single tally must satisfy the policy alone, because three single-row runs in three
  workflows are not "three replays across two data rows".
- **Seeded thresholds authorize review, not autonomy.** `LOCATOR_UPGRADE_REPLAY_POLICY.committed` is `false`
  until L7 commits the numbers. While it is false, mode `auto` is refused (`THRESHOLDS_PROVISIONAL`) even when
  the policy says `autoApply`; a user-approved apply still requires the full evidence and is recorded as
  **T1**, so a later revert cannot self-demote the feature for a decision a person made.
- **Only an already-authoritative locator is upgraded.** A `needs-review`, `invalid` or
  `user-approved-fallback` baseline is refused (`BASELINE_NOT_PROMOTABLE`). This keeps decision 3 intact —
  `resolution` is not repurposed and is never written by promotion — and leaves repairing those locators to
  L3 §8, which has its own approval path.
- **The promoted locator drops the guard and rewrites `quality`.** `LocatorFactory` routes a locator to
  `resolveGuardedPositional` whenever `isPositionalLocator` is true, which reads the record-time `quality`. A
  promotion that left the replaced primary's `quality` in place would therefore keep executing positionally and
  the promotion would have no runtime effect at all. `quality` is replaced with what the proof established
  (`isUnique`, `matchCount: 1`), and `context` is exactly the compiled scope the proof used — carrying the old
  one would run something no gate ever saw.
- **The locator write commits before the audit record.** The other order can leave an `AiActionRecord`
  claiming a change that never happened; this order can only leave a promotion with no audit entry, which is
  visible and still revertible from `locatorProvenance.previous` on the step.
- **Unsaved editor changes defer promotion, as integrity rather than authorization.** Only a renderer knows
  its own dirty state, so main holds it as declared state (`ai:setEditorState`, keyed by `WebContents` id) and
  refuses `EDITOR_DIRTY`. It can only ever make promotion stricter. The authorization guarantees — the IPC
  permission, T3, the trusted evidence and the binding compare-and-swap — trust the renderer for nothing.
- **Dirtiness is never folded into the cached view.** `describeFlowLocatorUpgrades` dry-runs as if the editor
  were clean and reports `editorDirty` beside the result. A real-Electron run showed the panel stuck on
  "unsaved changes" for a flow that had been clean for twenty seconds, because its one fetch crossed the
  editor's own report. A fact that changes per keystroke does not belong in a fetched, cached view.
- **No new permission.** Reading a flow's AI locator state is `ai.use` + `workflow.view`; applying a promotion
  is `ai.use` + `workflow.edit`; declaring editor state is `workflow.edit`. Reusing existing permissions avoids
  the `ADMINISTRATOR_PERMISSIONS` denylist trap that a new permission would spring.

### 2026-09-20 — Phase L L3 §4–§5: browser proof gates, pending upgrades and replay proof (`awkit-djnl.4`)

- **Proof lives in the runner** (`src/runner/locatorProof.ts`) and uses the same `LocatorFactory` roots as
  execution. It is observational and uses a factory with no recovery memory, so resolving the baseline
  writes nothing. Same-element proof is DOM node identity; handles from different frames cannot be
  compared, which is itself a `FRAME_CONTEXT_MISMATCH`.
- **The protected-login check uses the Recorder's DOM-signal detector** (`detectRecorderProtectedLogin`, the
  one Element Spy uses), not the runner's text-only pause heuristic. Any detected surface refuses the proof
  (fail closed). One consequence: a plain sign-in page with a password field, such as the mock site's
  `/login`, refuses AI proof.
- **Replay counts only a passing step.** A refusal (wrong element, ambiguous, intent, scope) is tallied
  immediately and makes that candidate `replay-rejected` for good; a new candidate or an edited step
  starts a fresh tally (digest of candidate + binding). An `unprovable-now` replay counts nothing.
- **Tallies are runtime memory, not profile data**: `LocatorRecoveryStore.updateReplayProof` under
  `<locator memory>/upgrade-proofs/`, serialized per key in-process (the engine is the single writer).
- **Eligibility thresholds are seeded, not committed:** at least 3 passing replays over at least 2 distinct
  hashed data rows (`LOCATOR_UPGRADE_REPLAY_POLICY`); L7 commits them. `eligible` only sets
  `proofSatisfied`; promotion stays L3 §6.
- **The intent guard rejects rather than parameterizes** a bound value, both at capture and at every replay
  (the replay's bound values are the current row, instance/runtime inputs and the step's value).

### 2026-09-19 — Phase L L5a collector lifecycle and L2 locator quality (`awkit-djnl.7`, `awkit-djnl.3`)

- **L5a collector attaches before the first page.** New runner hook `onBrowserContext` (initial launch
  and Reuse Session swap) runs as soon as a generation's context exists; the collector starts there, so
  its init script and binding join each new page's initialization. This supersedes "the CDP trace and
  the collector start concurrently" in the entry below: the CDP trace still starts on `onBrowserRuntime`.
- **Context-level network and console listeners, made inert rather than removed.** Every Playwright
  subscription change is a protocol call that captures a stack; unsubscribing from a context that is
  closing is pure cost (and against a closed page, an error). Per-page listeners are only the
  subscription-free events (`pageerror`, `framenavigated`, `close`).
- **The overhead gate formats stack traces as the packaged app does.** tsx enables source-mapped stacks
  for every script; the Electron main bundle has none. Measured ~8 ms per Playwright call, charged to
  whichever mode makes more calls. The ceilings are unchanged; `AWKIT_L5A_OVERHEAD_SOURCE_MAPS=1` keeps
  the old condition. Gate methodology (rounds, median definition, host) is left to the owner.
- **Raw-UI-text suppression** is `execution.suppressEvidenceUiText` (default false) inside the
  SETTINGS_EDIT-gated `execution` group, read from persisted Settings at run start, never from the
  renderer's request. Enforced in the page script and again in the collector.
- **L2 quality class is derived, not stored.** `classifyLocatorQuality` reads only what a saved locator
  already carries and reuses the runtime's positional and guard predicates, so it cannot drift from what
  `LocatorFactory` does. It replaces the Recorder page's own strong/medium/brittle grade (one scoring
  system). A class never changes `resolution` or execution.
- **L2 strategy chooser** promotes a preferred strategy only when the page proved it globally unique and
  non-positional for the element; otherwise the adaptive choice stands with a stated warning. The
  evidence is capture-only and stripped by both `RecorderService` and `buildRecordedFlow`.

### 2026-09-19 — Phase L L5a: run-lifetime failure evidence, protected-login exclusion, off-path binding (`awkit-djnl.7`)

- **Decision:** one collector per instance (`src/runner/evidence/FailureEvidenceCollector.ts`) on the
  per-generation lifecycle `PassiveCdpTrace` uses, writing the optional `InstanceReport.diagnostics`
  (versioned events, summary, deterministic cause). No second browser owner; `NetworkDiagnosticsObserver`
  and `captureFailureEvidence` keep their roles. The CDP trace and the collector now start and stop
  concurrently: they are independent best-effort observers.
- **Protected-login surfaces are excluded by retraction, not only at the door.** The page script
  announces each document's state (a password or one-time-code field anywhere); network, console and
  error events can arrive before that, so the collector retracts what the document already produced
  (bytes returned to both budgets, counted as `dropped.protected`). Pages the runner hands off as a
  protected login, and protected-login, secure-login, session-reuse and manual-handoff steps, are
  excluded too. Only the runner's own failure survives. The redactor alone was not enough: a verifier
  mutation that disabled the guard kept the canaries masked but kept the login page's 401 and console
  error as evidence.
- **The binding is exposed off the start-up path.** Playwright's context `exposeBinding` makes four to
  five sequential round trips; awaited on start-up it cost ~330 ms median per instance under contention
  and failed the overhead gate (+568 to +1,077 ms). Only `addInitScript` (one round trip) is awaited, so
  the script still precedes the first navigation; the page queues at most 50 messages until the binding
  lands, and they are delivered in order with their age, so offsets stay truthful.
- **Runner failure text** keeps the diagnosis line only. Playwright's "Call log" quotes matched elements'
  HTML (page content and attribute values) and is not a runner diagnosis.
- **Reports:** the report writer waits (bounded, 30 s) for unwinding runners. A stopped instance turns
  `cancelled` synchronously while its runner still unwinds, so before this the cancelled instance's
  report could miss `report.json` entirely (reproduced by `verify:ui-error-evidence`, mutation M6).
- **Overhead ceilings (*proposed*, owner approval pending):** capture ON may add at most max(10 %, 150 ms)
  to the median and max(15 %, 300 ms) to the p95 instance duration, max(25 %, 40 ms) Node CPU per
  instance, and 4 KB of evidence per passing evidence-workload instance. Measured on the development
  host: +145/+152 ms median, +39 ms CPU. Not a VMware production claim.
- **Not changed / deferred:** response-body excerpts stay unimplemented (off by default per policy);
  the Raw-UI-text suppression Settings switch is not built yet (its default, OFF, is today's behavior);
  `ErrorClassifier` still classes a Playwright `waitFor` timeout as `locator` for reports. The collector
  corrects only its own `runner.failure` kind for `wait` steps.

### 2026-09-19 — Phase L L4a: engine owns every graph diagnostic; new rules block only real runtime failures (`awkit-djnl.5`)

- **Decision:** the renderer-only graph advisories (dead ends, condition completeness, empty static-list
  loops, priority ties) and the branch-pair rule moved into `FlowValidator`. The pure detection is
  `src/validation/BranchPairs.ts`, and `app/renderer/components/shared/branchPairs.ts` re-exports it.
  New rules: `incompleteBranchPair` and `unguardedCycle` (errors); `connectorFromEndNode`,
  `deadEndNode`, `incompleteCondition`, `emptyLoopValues`, `ambiguousConditionPriority` and
  `incompleteValueSource` (warnings). Reachability no longer walks through End steps (only their
  parallel fan-out runs). `PreRunValidator` warns when a JSON path finds nothing in a loaded file.
  `FLOW_VALIDATOR_VERSION` is 4.
- **Severity rule:** an error only where `FlowExecutor` already fails or misroutes. A lone branch ignores its
  condition or runs its parallel target twice, and a cycle without a Loop Back connector throws "runtime
  cycle" when taken. Everything else is a warning, so no flow that runs today is newly blocked except
  through a genuine defect. Steps reachable only past End become `unreachableNode`, which is off-path and
  grant-tolerable; the version bump re-runs the inventory scan that issues those grants.
- **Reason:** the Flow Designer's Save-blocking branch-pair check (`connectorStructureIssues`) had no
  caller, and imported or hand-edited flows reached the run gate with lone branches and unguarded
  cycles that only failed mid-run. The rule table is now one source for the designer, import and the
  run gate.
- **Not changed:** `SafeFixApplier` gains no fix kind (still `normalizeEnumCasing`, `regenerateId`).
  Workflow-level lone branches stay a Workflow Builder advisory, because `FlowDependencyResolver`
  schedules by dependency and has no flow-style fallback. Design-time data-source and secret reference
  checks are deferred: they need a library context, and the runtime already fails loudly with named errors.

### 2026-09-19 — Phase L L1 runtime binding: node-llama-cpp in the utility process (`awkit-djnl.1`)

- **Decision:** the inference host (`native-hosts/ai/ai-host.cjs`) runs node-llama-cpp 3.21.1, which bundles
  llama.cpp `v0.4.0` (Qwen3.5 `qwen35` supported since February 2026), inside the existing Electron utility
  process. It is CPU only (`gpu: false`) and never builds or downloads (`build: "never"`,
  `skipDownload: true`). The pin string the host reports is `node-llama-cpp@3.21.1+llama.cpp@v0.4.0`.
  node-llama-cpp is a dev dependency, so nothing reaches `app.asar`; the runtime tree is staged beside the
  host like the Zvec host.
- **Reason:** it is the plan's primary shape: MessagePort only, no TCP listener, one crash domain that frees
  the model when it dies, `AbortSignal` cancellation, and a JSON-schema grammar covering the bounded output
  subset. The prebuilt `@node-llama-cpp/win-x64` ships every CPU variant (SSE4.2 to AVX-512) and selects at
  run time, which suits an unknown VMware CPU. The rejected `llama-server.exe` option needs a loopback port
  and key, and a grandchild process Windows does not kill with its parent. That is more infrastructure
  than the plan's rule allows ("if unavoidable"). The choice does not change a ratified decision.
- **Prompt format:** Qwen3.5 ChatML with the template's thinking-disabled branch (an empty think block).
  Only the template pieces are tokenized with special tokens enabled; system and page text are plain, so
  `<|im_end|>` in page text cannot close a turn.
- **Acquisition is an owner step:** the lease guard admits no install or network command for the agent,
  so installing the runtime and downloading the pack are the two owner steps in `L1-ai-foundation.md`.
  The model pack pin comes only from a measured SHA-256.

### 2026-09-19 — Phase L L1 implementation choices (`awkit-djnl.1`)

- **Scope:** choices made while building the L1 foundation. They refine the L0 entry below. Items
  marked *default* were chosen by the implementing agent and are open to owner override.
- **Policy location:** the autonomy policy is `src/security/authz/AiAutonomyPolicy.ts`, not `src/ai/`.
  The routing matrix forbids one owner's glob inside another's (`verify:agent-routing` checks
  cross-agent overlap), so a protected file inside a software-owned `src/ai/**` was impossible. The
  policy is authorization anyway: `src/security/**` routes to security as `authorization_change`, so
  editing a ceiling, the T2 cap, the T3 list or the self-demotion seeds needs a security lease.
  `src/ai/**` is registered to the software domain.
- **AI settings are not a `UiSettings` group.** `settings:update` leaves groups outside its
  substantive list open to every signed-in role, and `settings:import`/`reset` rewrite whole
  documents under other permissions. The switch and tiers therefore live in
  `<data root>/ai/ai-settings.json`, written only by `ai:updateSettings` (`ai.manage` plus
  re-authentication). The file is read fail-closed: missing means AI off, corrupt is preserved and
  read as off, and an invalid stored tier reads as T0. The existing `semantic` group has the bypass
  this avoids; it is tracked as a separate task.
- **Permissions (*default*):** `ai.use` goes to Operator, Administrator and Super User. `ai.manage`
  (re-authenticated) and `ai.audit.view` go to Administrator and Super User; the denylist grants them
  to Administrator on purpose, and `verify:ai-permissions` asserts both directions.
  `recorder.elementSpy` goes to Operator and above. Viewer and Issuer get none. Revert needs
  `ai.audit.view` and `workflow.edit`.
- **Empty manifest and unpinned runtime.** `AI_MODEL_MANIFEST` is empty and `AI_RUNTIME_PIN.build`
  is null until the owner supplies a measured pack and a runtime build. A guessed checksum would let
  the import check pass for the wrong reason. Meanwhile every import is refused, no host starts even
  if a host script exists, and the app behaves exactly as before Phase L.
- **Admission (L1.6):** inference yields and never preempts. By default it waits for zero active or
  queued runs; manual-action and paused instances count as active. It also waits on dispatch
  backpressure, pressure beyond `stable` and low free memory. With yield off it must fit the weighted
  budget, where `aiInferenceWeight` has a seed of 1.5 (*default*, superseded by the L1.8 benchmark).
  The engine never counts AI weight against instance admission, and no `src/runner` module imports
  `src/ai` (`verify:ai-fallback`). Inference threads are floor(logical CPUs / 2), clamped to 1–4.
- **Self-demotion seeds (*default*):** a 30-day window, more than 20% reverted, and at least 10
  auto-applied actions. Demotion is persisted and cleared only by an explicit administrator restore.
- **Runtime binding: resolved later on 2026-09-19** (node-llama-cpp; see the runtime-binding entry
  above). The original note follows. The protocol and manager are runtime-agnostic
  (utility process, MessagePort, no TCP). The host script `native-hosts/ai/ai-host.cjs` is not
  written, because it depends on the choice:
  - an in-process binding (e.g. `node-llama-cpp`) inside the utility process: no listener, a new
    npm dependency with prebuilt native binaries;
  - pinned `llama-server.exe` behind the host: the plan's loopback fallback with a random port and
    token.

  Either way the binary and the model pack must be obtained (a download the owner must approve),
  pinned in the manifests and noticed. The L1.8 benchmark is blocked until then.

### 2026-09-19 — Phase L (local AI): decisions ratified against the code (`awkit-djnl.2`, L0)

- **Scope:** the owner decisions for Phase L (`docs/plans/ai-upgrade-v5/ROADMAP.md`), checked against
  the code they touch. The owner audit table is in that ROADMAP under "Owner audit". Where this entry
  and the plan differ, this entry wins; the plan was corrected in the same change. Values marked
  *default* were chosen from existing precedent by the implementing agent and are open to owner override.
- **Global decisions 1–9 (ratified):**
  1. Locator AI is a semantic upgrade, not a rescue: guarded-positional output (saved `resolved` by
     `buildRecordedFlow.ts`) stays authoritative until a replacement is proven.
  2. Unproven candidates live only in `pendingUpgrade`. They never go into `alternatives`, which
     `LocatorFactory.resolve` executes as ordinary fallbacks and digests into remembered-winner memory.
  3. Provenance is additive (`locatorProvenance`); `resolvedBy` stays `"recorder" | "user"` and
     `resolution` is not repurposed.
  4. Intent guard: scope/target text equal to a bound, data-row or earlier-input value is rejected or
     parameterized; a scope-kind change (position → text) sets `meaningChange` and cannot auto-apply.
  5. Promotion and revert are single-writer profile saves (`ProfileLockManager`, version check,
     deferred while the flow has unsaved editor changes), never a side effect of a run.
  6. L5a failure capture is a new evidence owner that attaches through the existing per-generation
     lifecycle `PassiveCdpTrace` already uses; `NetworkDiagnosticsObserver` keeps its per-action role
     and `captureFailureEvidence` its point-in-time role.
  7. The deterministic cause baseline always runs first; AI analysis auto-runs only where it beats
     that baseline on the labelled set.
  8. Privacy follows the policy below.
  9. L4b is explanation-first: AI may only rank `safeFix` entries `FlowValidator` emitted (today
     `normalizeEnumCasing` and `regenerateId`); a new fix kind is a deterministic owner-approved change first.
- **Autonomy tiers:** T0 observe (a labelled interpretation), T1 suggest (one-click approval), T2
  auto-apply with proof (audited, one-click revert), T3 forbidden. Each feature's default is also its
  ceiling: T2 semantic locator promotion; T1 saved-locator repair, safe-fix ranking, fragment parameter
  mapping; T0 failure analysis, validation explanation, fragment summary. Configuration may lower a
  feature and restore it up to its ceiling, never above; the global T2 cap and the T3 list are code
  constants. This reconciles ROADMAP "raising is capped at T2" with L3 §8, L4b and L6, which each
  require user approval.
  - **Promotion proof** (resolves L3 §6 against CHANGELOG M3): capture proof alone never
    auto-promotes. T2 needs same-element replay proof on ≥ N replays spanning ≥ 2 distinct data rows;
    a flow that never runs two distinct rows gets a T1 suggestion instead.
  - **Self-demotion:** a T2 feature whose revert rate over the rolling window exceeds the threshold
    (with a minimum sample size) drops to T1 with a visible reason. Re-promotion is an explicit admin
    action, never automatic. N, the window, the threshold and the minimum sample are seeded in L1 and
    committed in L7.
  - **Master switch off:** no jobs and no annotations, so behavior is identical to today; existing
    `pendingUpgrade`/`locatorProvenance` stay inert. Revert and the audit view never need the model.
- **Exact T3 list:** hard-coded `forbidden` action classes in `AiAutonomyPolicy`, proven unreachable
  by `verify:ai-autonomy-policy`. AI never proposes or applies:
  1. anything on a protected-login surface: pages the protected-login detector classifies and
     `protectedLoginHandoff`, `autoSecureLogin` and `reuseSession` steps, whose evidence never
     reaches the model;
  2. a locator change on a sensitive-action step (`resolveStepSafety(step).sideEffectLevel` is
     `dangerousMutation` or `externalCommit`, the predicate `LocatorFactory` already uses), not even
     as a T1 suggestion. The user may still edit it manually. This supersedes L3 §6 "step not
     sensitive … otherwise T1";
  3. a graph edit other than applying a `safeFix` entry `FlowValidator` emitted for the current graph;
  4. run control: execution status/outcome, retry, cancellation, `onFailure`/`retry` policy, admission;
  5. AI governance: its own tiers, the master switch, permissions and roles, the model manifest.

  T0 prose may discuss these topics but can never act on them.
- **Field names and placement.** Audited `FlowProfile.ts`, `RecorderTypes.ts`, `buildRecordedFlow.ts`,
  `locatorApproval.ts`, `flowProfileMapping.ts` and `FlowNodePropertiesPanel.tsx`. No
  `pendingUpgrade`, `locatorProvenance` or locator `provenance` key exists in `src/`, `app/` or
  `scripts/`. Both are optional `StepLocator` fields on `step.locator` only; a drag `targetLocator` is
  not an upgrade target in Phase L.
  - `pendingUpgrade: { schemaVersion: 1, candidate: LocatorCandidate, context?: LocatorContext,
    proof: "unprovable-now" | "capture-proven", meaningChange: boolean, binding: LocatorApprovalBinding,
    modelId: string, createdAt: string }`. `LocatorFactory` never reads it, and replay-proof tallies
    live in `LocatorRecoveryStore` runtime memory rather than here. It holds candidate data only, the
    same class as `alternatives`, and never a raw fingerprint: `forwardLocatorFields` passes unknown
    keys through `buildRecordedFlow` unhashed. Writing or clearing it is a T0 annotation through the
    single-writer save path, not an `AiActionRecord`.
  - `locatorProvenance: { schemaVersion: 1, source: "ai-semantic-upgrade" | "ai-repair",
    tier: "T1" | "T2", actionId: string, modelId: string,
    proof: "capture-proven" | "replay-proven" | "repair-proven", appliedAt: string,
    binding: LocatorApprovalBinding, previous: StepLocator }`. Absent means recorder or user, as
    `resolvedBy` says. `previous` is the exact pre-change locator with guard, identity and context
    intact; it never carries `pendingUpgrade` or `locatorProvenance` itself (one level, no chain).
  - **The replaced guarded locator is a revert target, not a runtime fallback.**
    `LocatorFactory.resolve` applies `guard` only when the primary is positional, so a guarded locator
    moved into `alternatives` would run positionally without its identity proof. This supersedes L3 §6
    "keeps guarded locator as fallback".
  - **Staleness:** each field's `binding` is `createLocatorApprovalBinding` of the finalized step it
    describes. The save-boundary pass that already runs `invalidateStaleLocatorApproval`
    (`flowProfileMapping.ts` `toFlowStep`) drops either field when its binding no longer matches. This
    is required because `toFlowStep` spreads `originalStep.locator`, so unknown keys survive every
    save, while `editLocator` clears only the fields it maps (`quality`, `identity`, `guard`,
    `prerequisite`, `executionDecision`).
- **`AiActionRecord`:** written for every applied change (T2 auto-apply and T1 user-approved apply).
  T0 output, `pendingUpgrade` annotations and unapplied suggestions are not records. Shape:
  `{ schemaVersion: 1, id, feature, actionClass, tier: "T1" | "T2", target: { kind, flowId, stepId? },
  evidenceIds: string[], proof: { result, replays?, dataRows? }, modelId, createdAt, revertHandle,
  reverted?: { at } }`. It holds ids, enums and counts only, never page text, locator values, prompts
  or model output. It is stored under the runtime data root via `app/main/atomicReplace.ts`.
  - **Retention (*default*):** the newest 5,000 records, at most 90 days old, pruned on write. This
    mirrors the report-run cap and anomaly retention passed to `sweepRetention` in `ExecutionEngine`.
    The self-demotion window must fit inside it.
  - **Revert** never depends on a record: the prior value lives in `locatorProvenance.previous` or in
    the `flowValidationService` backup. Revert is compare-and-swap: it restores `previous` only while
    the current locator still matches `locatorProvenance.binding`; otherwise it is refused as stale,
    so a user edit is never overwritten.
- **Privacy policy.** Every model request and every stored AI artifact goes through the semantic
  three-layer model: an allowlisted packet builder (as `SEMANTIC_PROJECTION_ALLOWLIST`), then
  `SemanticRedactor` (which composes `SecretMasker`), then a `SemanticPolicyValidator` rescan. No
  third redactor.
  - *Never sent or persisted:* passwords, tokens, cookies, auth headers, storage/session state, private
    keys, `secret`-source values and registered run secrets, request bodies and headers,
    credential-bearing URLs. Protected-login surfaces are excluded entirely.
  - *Minimized:* input values are never captured; evidence names a field by identity. Bound,
    data-row and earlier-input values become typed placeholders (L2 markers). Emails and identifiers
    of 6+ digits are redacted (the `SemanticRedactor` defaults). URLs are kept as origin + path
    template with ids stripped, never query, fragment or userinfo.
  - *Raw-UI-text suppression (*default* OFF):* one Settings switch; when ON, evidence keeps role,
    source, code, count and field identity and drops visible text.
  - *Index exclusion:* raw evidence, prompts and AI outputs are never semantically indexed; adding
    any of them needs an owner decision plus an allowlist change.
  - *Retention:* evidence and analyses live and die with their run report; analyses are
    deletable and recomputable. Raw prompts and responses are never persisted (*default*: no debug
    capture in Phase L). Response-body excerpts are OFF by default. Per-event/instance/run byte caps
    are set by `verify:failure-capture-overhead` in L5a.
- **Model manifest:** one source-controlled manifest, `src/offline/AiModelManifest.ts`, owned by the
  release role. `src/offline/**` already routes to `release` with `offline_boundary_change`, so every
  edit is Risk-3 and lease-gated, like `DependencyManifest.ts`. It changes only with an app release:
  no online refresh, no user override, and a pack whose SHA-256 is not in it is refused at import. The
  pinned llama.cpp runtime ships in the installer and belongs in the signed dependency manifest; the
  model pack never does.
- **Routing for new code:** `src/ai/**` has no routing-matrix owner today. L1 registers it and
  classifies the autonomy-policy module as `authorization_change`, so T3 or ceiling edits are lease-gated.

### 2026-09-18 — Claude Code uses a direct loop for ordinary repository work

- **Decision:** ordinary Claude Code tasks use one primary agent and the direct sequence: reason,
  decide, implement, verify, commit to `main`, and push `origin/main`. Subagents and external-model
  delegation require an explicit user request and are limited to one independent review. Ordinary
  source, documentation, test, and configuration changes no longer require a task contract, route,
  lease, handoff, or terminal finalizer.
- **Reason:** the prior universal lease lifecycle made a small change require a task contract,
  deterministic route, grant, handoff/amendment, finalizer, and multiple role calls before the work
  could be committed. The routing policy already documented ordinary paths as unrestricted, but the
  hook contradicted it by blocking every no-lease edit and Git mutation.
- **Safety boundary:** `tools/agents/lease-guard.mjs` still derives and protects Risk-3 paths.
  Licensing, authentication, authorization, secrets, protected-login handoff, required migrations,
  signing, and the offline boundary continue to require a validated, scoped lease. Destructive Git
  operations remain denied and direct work still uses bounded commands.

### 2026-09-15 — Agent-control gates get terminal states and bounded remediation (anti-loop repair)

- **Decision:** every agent-facing gate now recognizes truthful terminal outcomes
  (`PASS` / `FAIL` / `BLOCKED` / `NOT RUN` / `INCONCLUSIVE`), required closeout bookkeeping is an
  exact 16-path `SYSTEM_BOOKKEEPING_PATHS` set writable under any active lease, the third
  identical lease denial in a session is labelled TERMINAL instead of returning another
  remediation suggestion, the Stop hook blocks only on confirmed secret exposure or broken
  required files, verification reruns are change-triggered, roadmap reconciliation is capped at
  two rounds, and compaction restores reuse recorded facts/command results instead of instructing
  repository re-derivation.
- **Reason:** the 2026-09 diagnostic measured one Claude Code session at 44 MB / 53 compactions,
  158 write-lease denials, 45 lease grant/amend/handoff commands, and 12 roadmap re-verifications —
  every blocked action returned an open-ended instruction and every compaction erased the facts
  that would have stopped the repetition. The safeguards are unchanged in strength; only their
  stopping semantics were refined so a blocked gate is a recorded outcome, not an infinite
  obligation. Compound shell commands remain blocked (security precedence); agents must issue
  separate bounded commands.

### 2026-09-14 — Final lease release is an exact terminal control-plane commit (`awkit-yl33`)

- **Decision:** a completed task's final active lease is closed through
  `agent:lease-finalize`, not through ordinary `agent:lease-release` followed by an impossible
  bookkeeping commit. The operation permits exactly three terminal paths — the released active
  lease record, the current task contract with one archived lease entry, and the cleared roadmap
  assignment — and performs the normal `git push origin main` only after their exact state validates.
- **Reason:** ordinary release necessarily dirtied those tracked files after the last permitted
  commit, while the no-active-lease guard correctly denied any later generic Git command. A broad
  exemption would undermine the boundary. The terminal control plane instead fails closed on task or
  lease mismatch, altered bookkeeping, scope violations, extra staged files, unresolved gate/QC
  state or unauthorized push.
- **Impact:** normal grants, amendments, releases and no-lease guards are unchanged. Repeated
  finalization is limited to the same verified terminal state, and an inherited residue may be
  absorbed only when its task, released lease ID and file fingerprints are recorded in the contract.
  Sequential writer changes use the validated active `handoff` control plane; terminal finalization
  records `completion.closed_at_commit` so later task gates do not reassign unrelated changes to a
  closed contract.

### 2026-09-11 - Chart series become a categorical token family; last chrome literals and legacy aliases retired (awkit-44eu)

- **Decision:** categorical data-visualization colors are now first-class design tokens —
  `--awkit-chart-1..14`, defined in BOTH theme blocks with distinct values per theme — and
  `pages/ReportsFailures.tsx` maps failure categories to `var(--awkit-chart-N)` instead of a
  14-hex literal map. The legacy `--awkit-purple*` accent aliases are deleted (all consumers
  migrated to the `--awkit-accent*` family), `--awkit-blue/-deep` is re-documented as the
  **data-viz blue family** (not a legacy alias), and the remaining rule-body color literals in
  `global.css` resolve through tokens (status rgb triplets `--awkit-success/danger-rgb`,
  `--awkit-shadow-lg`, `--font-mono`, `--awkit-overlay` scrim for the admin modal backdrop).
- **Why tokens for charts:** a donut/bar chart needs more distinguishable series than the four
  functional status families provide, so the palette is its own family — but series tokens are
  assigned by DATA category, never by run state; state keeps the status tokens. Light values are
  the previous hand-tuned hexes (light rendering unchanged); dark values are lifted counterparts,
  fixing a real gap: charts previously painted light-tuned hexes on dark surfaces with no theme
  adaptation at all.
- **Bounded exceptions, written down at the site:** the avatar tone gradients are identity art
  (design-system.md permits gradient decoration only for AI affordances and the existing profile
  avatar), and the Connector Style presets in `components/shared/connectorStyle.ts` are persisted
  USER CONTENT — `normalizeEdgeStyle` validates stored colors as hex, so preset values are part of
  the saved-data contract, not themeable chrome (defaults resolve through `--awkit-connector-*`).
- **Dead legacy CSS removed:** `workflow-stage`, plain `flow-node`, `scenario-chain`,
  `stage-badge`, `workflow-connector`/connector-one/two/three, `mini-map`, `flow-canvas`,
  `start-node`, `end-node`, `node-handle`, `flow-mini-map`, `workflow-board` — every family
  proven to have zero live references before deletion (`node-palette` was checked and KEPT:
  FormDesigner is routed). Net −139 CSS lines.
- **The control that pins it:** `npm run verify:design-tokens` (fail-closed, mutation-proven both
  directions) fails on any undefined var() reference, any rule-body color literal outside the
  bounded exceptions, any missing/duplicate/non-theme-adaptive chart step, and proves the token
  spine plus the Sessions status pill paint in the real app in light AND dark.
- **Commits:** de8772c (token spine + legacy CSS removal), e816373 (surface migrations),
  03a590f (accentColor comment accuracy), verifier commit, project-state commit.


### 2026-09-07 - The view-level dry-run exemption is deliberate and is pinned by a control, not gated

- **Decision:** `execution:validate` and the `dryRun`-not-`false` path of `execution:runWorkflow` stay
  ungated at view level. This is remedy **(a)** from `awkit-ttvb` - document the exemption and add a
  control pinning it - chosen over remedy **(b)**, gating the paths. `docs/ai/KNOWN_ISSUES.md` framed
  the remedy as a decision and said "do not silently pick one"; this record is that choice, made
  explicitly.
- **Reason (b) was rejected:** gating is a **behavior change that breaks a documented product
  behavior**. `app/main/ipc/execution.ipc.ts` states in code that validation/dry-run stays open at
  view level precisely so a Viewer's pre-run preview works, and that **no browser is launched on that
  path**. Adding an `assertSender*` call there would deny a Viewer the preview the product promises,
  in exchange for guarding a path that reaches no browser, no session and no filesystem write.
- **Why it is safe, and what actually makes it safe:** the IPC authorization block runs when
  `request.dryRun === false`, and `ExecutionApplicationService.runWorkflow` returns
  `{ status: "validated" }` when `request.dryRun !== false`. Those two literal predicates live in two
  different modules and are **exact complements** - that complement, plus the short-circuit returning
  *before* `applyRunGateEnforcement` and `executionEngine.startRun`, is the entire reason the ungated
  path launches nothing. Nothing in the repository asserted that relationship, so narrowing the
  service predicate to `=== true` would have been a genuine privilege escalation with every existing
  control still green.
- **The control that pins it:** **R2.6c** in `scripts/verify-r0-characterization.mts`. It asserts both
  literal predicates in their own scopes, the short-circuit's position ahead of
  `applyRunGateEnforcement` and `executionEngine.startRun`, and that `execution:validate` contains
  **exactly zero** `assertSender*` calls - so granting *or* removing authorization on these paths now
  turns the suite red. Cardinality is asserted before every ordering expression.
- **Commits:** `dfcbdc5` (comment-only, both halves of the invariant: the `execution:runWorkflow`
  dry-run guard in `app/main/ipc/execution.ipc.ts` and the `runWorkflow` dry-run short-circuit in
  `app/main/execution/ExecutionApplicationService.ts`) and `f44b4b2` (R2.6c, +204 lines / 0 deletions
  in `scripts/verify-r0-characterization.mts`). No predicate, control flow, handler registration or
  exported signature changed. `verify:r0-characterization` moved 169 PASS / 0 FAIL to **175 PASS / 0
  FAIL**; `verify:security` stayed at **61 passed / 0 failed**; `build` PASS.
- **Disclosed limit of the control:** the escalation mutation (service predicate narrowed to
  `=== true`) is rejected by the structural **operator** assertion, not by the explicit complement
  assertion. The complement assertion is logically entailed by the two predicate assertions as
  written, so no mutation currently fails on it alone. It is recorded as **defense-in-depth against a
  future relaxation of those two assertions, not as an independently proven control** - and no
  mutation was manufactured by weakening them to claim otherwise.

### 2026-08-22 - Condition expressions remain literal-only; structured sources are inert legacy metadata

- **Decision:** a condition branches only on its literal `step.value`. `step.valueSource` is never an
  executable condition-expression channel; `FlowExecutor.resolveNext` stays synchronous and no
  persisted expression-mode discriminator is added.
- **Compatibility:** an imported literal+source condition remains runnable from its literal and keeps
  the source verbatim through load/save/reload, including unknown persisted fields. The validator and
  condition editor identify the ignored binding non-fatally; only an explicit user action removes it.
- **Authoring:** new Flow Designer conditions and random Test Lab generation do not create condition
  value sources. Source-only conditions remain invalid.
- **Reason:** this makes the existing runtime truth visible and testable without introducing a second
  async resolution path, activating dormant metadata, resolving secrets into routing, or destructively
  migrating legacy profiles. Owner-approved Option A for `awkit-9qcz`.

### 2026-08-21 - Token-aware orchestration uses 16 generated roles, subagents by default, and local ephemeral compaction state

- **Decision:** AWKIT exposes the 16 requested responsibilities as unique project-scoped Claude
  identities generated from `routing-matrix.mjs`. The main context remains `awkit-manager`; only it
  receives the `Agent` tool. Read-only Architect, UI/UX, Integration, QC, Researcher and Performance
  roles deny Edit/Write. Writers remain serialized by a contract-bound lease on `main`.
- **Context policy:** delegate verbose investigation at 100K input tokens, warn at 120K, and target
  approximately 150K on the standard 200K window with the installed client's supported 75-percent
  auto-compact override. PreCompact/PostCompact hooks are asynchronous and store only allowlisted
  repository/task facts beneath LOCALAPPDATA. Transcript, compact summary and messages are excluded;
  the checkpoint is explicitly non-authoritative.
- **Teams policy:** subagents are the normal isolation mechanism. Experimental Agent Teams remain
  disabled in shared settings and may be enabled locally only for interactive, genuinely independent
  peer coordination. They never relax the single-writer lease or AWKIT's no-worktree rule.
- **Reason:** bounded specialist contexts reduce main-session discovery pressure only when the same
  investigation is not repeated. The exact route, concurrency ceiling, concise evidence contract and
  operational task gate make token efficiency subordinate to correctness rather than agent count.
- **Details:** `docs/ai/MULTI_AGENT_ARCHITECTURE.md`.

### 2026-08-16 - Agent routing has one canonical registry, and platform agents will be derived from it

- **Decision:** `tools/agents/routing-matrix.mjs` is the single encoding of agent ownership,
  activation predicates and risk. `docs/ai/routing/ROUTING_MATRIX.md` is RENDERED from it and
  compared byte-for-byte by `verify:agent-routing`.
- **Reason:** the reviewed proposal stated its routing rules three times — as pseudocode, as a
  markdown matrix, and as a validator rejection list — and the three had already drifted into
  disagreement about when the Architect was mandatory, before anyone implemented them. Three
  hand-maintained copies of one rule always end that way. This mirrors the Program Status dashboard's
  own discipline: derive the fact, never hand-record it.
- **Generated-platform rule:** `.claude/agents/*.md`, Codex and Gemini adapters
  must be **generated from or asserted against** this registry. They may never become a second source
  of truth, and three independently maintained per-provider architectures are explicitly rejected.
- **Registry format is `.mjs`, not YAML or TypeScript.** The repository has no YAML parser in
  `dependencies` or `devDependencies`, and adding one would itself be a `new_dependency` change
  routed to Architect and Release and reviewed against the offline boundary — a governance tool must
  not open the boundary it exists to police. TypeScript would buy nothing: `tsc --noEmit` covers only
  `app` and `src`, so a registry under `tools/` is not typechecked by the build. `.mjs` also lets the
  `PreToolUse` lease guard import it directly, which matters because that hook runs on every edit.
  Task contracts are JSON for the same reason. Precedent: `tools/roadmap/lib/sources.mjs`.

### 2026-08-16 - The write lease is enforced, and scope expansion re-runs routing

- **Decision:** while a lease is active, a `PreToolUse` hook on `Edit|Write|NotebookEdit` blocks
  writes outside it. Scope grows only through `npm run agent:lease-amend`, which re-runs the
  classifier and router; if the added paths are owned by another specialist the lease is **released
  rather than widened** and the work moves to that specialist.
- **Reason:** a lease that lives only in a document is a suggestion. And a lease that simply widens
  on request lets one agent creep outward into the whole repository, which defeats the specialization
  the system exists to provide. Rerouting is what makes specialization survive surprise.
- **No environment-variable bypass.** An `AWKIT_SKIP_LEASE=1` escape would be one keystroke, invisible
  in the repository afterwards, and would leave no trace that scope had grown. Emergency overrides
  are recorded in the contract, narrowly scoped, and force QC; the verifier rejects one that sets
  `qc_required: false` or whose forced QC never resolved.
- **Two limits accepted and documented, not hidden:** with no active lease the hook allows the edit
  (failing closed would block every task that does not yet use a contract), and `Bash` writes bypass
  it entirely. Derived classification — computed from `git diff --name-only` after the fact — is the
  backstop for both, which is the right place for a check that cannot be made precise up front.

### 2026-08-15 - Structured Loops use the frozen side capsule and one circular sweep

- **Decision:** `LOOP_VISUAL_CONTRACT.md` is the visual authority. A structured self-edge renders one
  160x20/r10 side capsule with 40/30/44 outer/main/hit radii, `maxIterations` in the dominant ring,
  and an external mode-aware summary. This deliberately augments the historical `7282178` image with
  configuration text while preserving its topology.
- **Motion:** only the ring sweep animates, for 2 seconds linearly and continuously. The capsule path,
  rings, value, and label are stationary; reduced motion freezes only the visible sweep.
- **Geometry ownership:** renderer constants, side-collision scoring, and fit bounds share one geometry
  source. The full lane/hit/ring/label footprint—not the superseded small-marker/U-route footprint—must
  be modelled. Long design summaries are bounded to the 160-unit lane with ellipsis and a full-text title.
- **Separation:** structured self-Loops have no direction overlay or self-arrow. Legacy cross-node
  `loopBack` keeps its distinct return-path renderer and bounded runtime semantics.
- **Reason:** the prior test oracle followed an incompatible U-route implementation and could report
  success for the visually corrupted result. The shared immutable contract plus mutation/dense-layout
  controls prevents implementation-defined visual acceptance.

### SUPERSEDED 2026-08-13 - A structured Loop was a U-route with a configured-value marker

- **Decision:** the Loop remains one persisted self-edge, rendered as a continuous rounded return path
  around its real source card with a compact circular marker attached directly to the path. The marker is
  an SVG part of the edge, never a node or separately positioned/persisted object.
- **Value:** the marker reads `LoopConnectorConfig.maxIterations` directly and shows only that configured
  number. It never derives runtime progress, defaults missing legacy data, or subscribes to execution IPC.
- **Geometry and motion:** measured card dimensions and graph coordinates drive the route, fit bounds, and
  live drag overlay. Only one transform-based arc rotates; path and text remain stationary, and reduced
  motion freezes the arc.
- **Reason:** this matches the supplied reference while preserving the existing graph, configuration,
  persistence, validation, and runtime contracts shared by both editors.

### 2026-08-12 - Superseded visual: a structured Loop was a node-owned edge-layer ring

- **Decision:** the Loop's circular visual shares the exact center of its real workflow card and renders in
  the existing connector SVG below the DOM node layer. The card naturally occludes the ring center; no
  synthetic node, separate position, detached lane, filled backdrop, bridge, arrow, or center badge exists.
- **Geometry:** the ring derives from the card's measured height with a bounded minimum and follows the
  card through the existing live dragging-edge overlay. Fit-to-view includes the visual footprint but never
  rewrites the card's persisted coordinates.
- **Interaction and motion:** exposed arcs reuse the persisted connector's pointer/keyboard configuration
  path, while the covered card center remains the node's drag/select surface. One transform-only sweep runs
  over stable rings; reduced motion uses a fixed segment.
- **Reason:** visual ownership, movement, persistence, and runtime meaning all belong to the same workflow
  node and self-loop connector. A second graph component would miscommunicate the model and create avoidable
  positioning, selection, and synchronization state.
- **Superseded:** the 2026-08-13 reference explicitly requires a rounded return path with a compact marker
  on that path. The enduring parts of this decision are that the Loop remains one edge, not a graph node,
  and that no separate persistence/runtime representation is introduced.

### 2026-08-11 - Workflow loops reuse the Flow connector contract and runtime policy

- **Decision:** `WorkflowEdge`/`ScenarioLink` carry the existing `LoopConnectorConfig` and
  `maxLoopCount`; no renderer-only or workflow-only loop model is introduced. A structured Loop is a
  self-loop and all non-self siblings are explicit Conditional exits.
- **Authoring:** adding a Loop promotes existing Standard exits instead of relaxing validation. Both
  designers use the same loop editor/defaults/exit-promotion helpers, while invalid loaded documents
  remain user-repairable and are never rewritten merely by opening them.
- **Execution:** Flow and workflow loops share value materialization, the canonical 1,000-iteration
  cap, runtime-input injection, and previous-iteration while evaluation. Legacy Loop Back remains a
  separate cross-node connector bounded by `maxLoopCount`.
- **Reason:** the persisted model and run gate already define valid loop semantics; completing that
  contract end-to-end avoids a second policy in the renderer and prevents designer-created invalid
  graphs without hiding errors.

### 2026-08-08 - Unknown prerequisites require a separate, binding-scoped execution decision

- **Decision:** Locator identity and interaction actionability are independent invariants. A proven
  locator stays resolved when prerequisite provenance is unknown; execution depends on a separately
  validated decision bound to the exact step, locator/context, identity hash, prerequisite, and safety.
- **Ordinary clicks:** automatic policy uses Playwright `click({ trial: true })`, then cancellation and
  identity re-resolution before a normal click. Operators may instead confirm no prerequisite with a
  reason. Material edits invalidate either authority.
- **Safety:** never use `force`; dangerous mutation and external commit actions remain blocked when the
  prerequisite is unknown and cannot use the ordinary confirmation controls.
- **Compatibility:** prerequisite-only legacy locator reviews normalize to resolved identity but do not
  gain execution authority unless a current decision validates.

### 2026-08-07 - Element identity is a versioned evidence contract, not selector uniqueness

- **Decision:** New Recorder output carries an optional schema-v1 `ElementIdentityContract` plus a
  separate `InteractionPrerequisiteContract`. `LocatorFactory` remains the single replay engine and
  combines existing Playwright candidates, ordered scope, hashed fingerprints, bounded structure,
  geometry/blueprint evidence, and guarded position. A non-unique primary alone does not block a
  normal action when the exact selected target can be re-proven.
- **Technology evaluation:** Adopt Playwright's re-resolving role/label/test-id locators and chaining,
  the browser composed event path, existing frame/shadow APIs, and the shared privacy-preserving
  fingerprint. Defer CDP Accessibility because its relevant tree/query methods are experimental and
  enabling AX has a documented performance cost. Reject per-interaction DOMSnapshot capture because it
  is experimental, page-wide, and adds privacy/size/versioning risk without improving acceptance.
  Defer local visual matching until an offline benchmark demonstrates value over deterministic evidence.
- **Compatibility:** all schema fields are optional, old saved flows retain legacy behavior, and
  unknown fields continue to survive JSON/IPC. Editing a locator invalidates its captured identity and
  guard. Sensitive steps keep exact-candidate-only recovery and fail closed.
- **Related files:** `src/profiles/FlowProfile.ts`, `src/recorder/{recorderInitScript,buildRecordedFlow}.ts`,
  `src/runner/{LocatorFactory,locatorFingerprint}.ts`, Flow Designer mappings/properties UI, and
  `scripts/verify-{recorder-ambiguity,recorder-hover,locator-guard}.mts`.

Important decisions visible in the repository / made during development. Newest first.

---

### 2026-08-01 — The signed dependency manifest is committed but must be release-current at promotion

- **Decision:** `resources/dependency-manifest.json` plus `.sig` are committed release artifacts so a
  clean checkout can package. Ordinary development commits do not regenerate them, and their
  `application.sourceCommit` is expected to be historical between releases.
- **Release rule:** a release build must regenerate and re-sign the pair from the release commit.
  Strict offline validation requires the manifest version to equal `package.json` and its
  `sourceCommit` to equal `HEAD`; signature, clean-tree, browser-validation, and launch checks remain
  mandatory.
- **Reason:** signature validity proves integrity of the recorded bytes, not that those bytes describe
  the commit being released. Keeping provenance checks release-only avoids making every ordinary code
  commit fail while preventing a stale, self-consistent manifest from being promoted.
- **Security boundary:** only the public trust root is tracked. Private signing material stays outside
  Git and requires owner-controlled custody; `awkit-2l1` tracks removal from a synced workspace.

---

### 2026-07-29 — The Randomized Test Lab is CLI-only and never ships in the app

- **Decision:** The Randomized Test Lab is CLI-only by architectural decision; its generation harness is never shipped inside the production application.
- **Why:** the production app exists to execute user-authored authorized workflows. Embedding a
  random/combinatorial generator would add production UI and IPC surface, packaged code and
  dependencies, a standing risk of accidentally destructive generated workflows, authorization and
  support ambiguity, and a permanent maintenance obligation unrelated to customer execution — plus
  a real chance of confusing generated fixtures with the user's own data.
- **Consequence:** Test Lab **Phase 7 (`awkit-wza.8`) is CLOSED as a recorded architecture
  decision, not as an incomplete product feature.** Generation, mutation, orchestration and result
  classification stay under `src/testing/**`, driven from developer tooling. The lab continues to
  exercise the *real* Electron, IPC, runner, storage, mock-site, reporting and packaged layers — it
  is not permitted to substitute synthetic engine-only fixtures for those. Generated artifacts may
  be imported into a disposable test workspace when GUI validation is needed.
- **Not this:** a future customer-facing template or workflow wizard is a separate feature with its
  own product requirements. It must not be delivered by exposing the randomized Test Lab.
- **Enforcement:** `scripts/lib/test-lab-packaging-policy.ts` is the canonical source;
  `npm run verify:test-lab-cli-only` proves no `app/**` module imports the harness, no production
  bundle contains its symbols, and no route registration file declares a Test Lab surface.

### 2026-07-29 — Licensing is enforced by default; upgrades get one 14-day grace

- **Decision:** hard enforcement is **on by default**. `SPECTER_LICENSE_ENFORCE` is removed as a
  production opt-in. `VALID`/`EXPIRING_SOON` admit runs; `NOT_ACTIVATED`, `EXPIRED`, `INVALID`,
  `MISMATCH`, `CORRUPTED` and any failure to evaluate licensing block new runs.
- **Active runs:** `NOT_ACTIVATED` and `EXPIRED` let an already-started run finish; the integrity
  states (`INVALID`, `MISMATCH`, `CORRUPTED`) cancel pending work before execution starts.
- **Grace:** an installation upgraded from a pre-enforcement version gets a **one-time 14-day**
  migration grace from first launch of the enforcing version. Fresh installations get none. During
  grace, saved workflows stay executable and the UI persistently shows the deadline and the
  activation action. Integrity states are never graced. Editing, exporting, reports, settings and
  license recovery all remain available after execution is blocked.
- **Bypass:** exists only for automated tests and development composition roots, and is compiled out
  of packaged builds — a packaged application has no enforcement bypass at all, by any environment
  variable, flag, setting or IPC call.
- **Why:** optional enforcement is not enforcement. A bounded, one-time upgrade grace protects
  existing users without weakening any integrity-related state.

### 2026-07-28 — The offline browser is an approved, signed release input

- **Decision:** ship Chrome for Testing `149.0.7827.55` (revision `1228`) with Playwright `1.61.0`.
  The in-repo policy pins the exact archive URL, size, archive hash, executable hash, and tree hash.
- **Acquisition:** release preparation may use the exact verified archive or the exact matching
  Playwright cache entry. It never chooses the newest cache directory and never performs a floating
  browser install. Runtime downloads remain forbidden.
- **Trust boundary:** release packaging signs the generated dependency manifest with Ed25519.
  Production startup verifies that signature, the approved policy hash, and `chrome.exe` before
  opening a window. The private key is release infrastructure and is never committed.
- **Reproducibility:** compare decompressed path/size/CRC identities, excluding the freshly generated
  signed manifest metadata and normalizing only documented volatile fields. Whole installer hashes
  identify accepted artifacts but do not prove reproducible compilation.

### 2026-07-28 — An ambiguous semantic mutation is never replayed

- **Decision:** when a dispatched Zvec mutation times out or the utility host exits before replying,
  classify it as `AMBIGUOUS_MUTATION`, abandon that queue item, and require an authoritative rebuild.
  Do not retry it and do not infer success or failure from a late reply.
- **Why:** the host may have committed the write before the deadline, may still be applying it, or
  may have failed before touching the collection. Replaying can corrupt counts and order; dropping it
  without a rebuild silently leaves the index stale.
- **Consequence:** the mutation queue reports one abandoned failure and `rebuildRequired`; the source
  snapshot plus ordered rebuild delta, not a second write attempt, determines the final index.
- **Enforcement:** `ZvecSemanticStore` preserves the manager's timeout/exit classification through
  the vendor-neutral store boundary. `SemanticMutationQueue` retries only explicitly safe generic
  read/write/query failures; `AMBIGUOUS_MUTATION` is outside that set.

### 2026-07-25 — A failed retarget after activation degrades; it never reverts the pointer

- **Decision:** once `activateGeneration` writes the active pointer, that generation is
  authoritative. If the newly-active generation then fails to open, or the live store cannot be
  retargeted onto it, the system enters a stable degraded state (`ACTIVE_GENERATION_OPEN_FAILED`):
  writes stop, the pending queue and delta journal are preserved, a bounded reopen is attempted, and
  a restart recovers from the pointer. It does **not** revert the pointer, delete the activated
  generation, or resume writing to the previous one.
- **Why:** the alternatives both corrupt. Reverting the pointer strands every document the rebuild
  just wrote. Continuing to write to the superseded generation forks the index into two divergent
  histories, and the next restart opens the pointer's generation — so the fork is silently discarded,
  which is data loss that looks like a working application.
- **Enforcement is structural, not procedural:** the mutation queue is retargeted onto a store that
  refuses every operation. Correctness does not depend on future callers remembering to check a flag
  before draining.
- **Consequence:** reads may continue from the still-open previous store only if explicitly marked
  stale; it must never receive a post-activation mutation. A shutdown that hits its deadline
  deliberately skips `markIndexClosed`, leaving the session unclean so startup reconciles it.

### 2026-07-25 — Rebuild validation trusts the snapshot only where the delta did not touch

- **Decision:** post-replay candidate validation excludes every document id and entity the delta
  replay touched. The snapshot is authoritative only for documents the delta did not change.
- **Why:** validation sampled the snapshot and asserted each sampled document was present in the
  candidate. A post-watermark DELETE of a snapshotted document is a *correct* outcome, so it was read
  as corruption and the rebuild was refused — meaning any rebuild that merely overlapped a delete
  could never activate, which is precisely the case the delta journal exists to support. Upserts are
  the same problem one step subtler: the replayed content is legitimately newer than the snapshot, so
  comparing `sourceHash` against the snapshot's version reports a mismatch that is really an update.
- **Trade-off:** the post-replay pass asserts less than the pre-replay pass, which still validates the
  snapshot exactly. That is the correct division: the first pass proves the candidate matches its
  source, the second proves the replay did not corrupt it.

### 2026-07-25 - Single-branch continuous implementation

- **Decision:** AWKIT development continues on `main`. Agents must not create a branch per task,
  phase, feature, fix, test, or documentation change. Existing branches and worktrees are
  consolidated into `main` and removed after unique work is preserved.
- **Commit policy:** Incomplete, failing, or environmentally blocked states may be committed and
  pushed when clearly labeled and documented. Verification and release gates remain truthful and may
  block release promotion, but they do not freeze implementation or Git commits.
- **Reason:** Multiple branches/worktrees and repeated freeze/approval checkpoints fragmented the
  implementation, left valuable work uncommitted, complicated state tracking, and delayed integration.
- **Safety:** Never discard user work, commit secrets, or hide failures. Use scoped commits, tags for
  historical branch tips where useful, and factual status documentation.
- **Known constraint:** `origin/main` is protected (`GH013: Changes must be made through a pull
  request`), so direct pushes are rejected. Per policy, work is committed locally on `main` and the
  error reported; no replacement branches are created. Remote branches are NOT deleted until
  `origin/main` contains the integration.
- **Canonical detail:** `docs/ai/BRANCH_AND_COMMIT_POLICY.md`.

---

### 2026-07-17 — Oracle ships behind a private Java bridge, read-only, and fails closed in production
- **Decision:** Oracle Database support runs **only** through a bundled private Java bridge — a
  zero-dependency, pure-JDK child process speaking framed JSON-RPC over **stdio (no network port)** — with
  a private JRE + ojdbc/ucp jars vendored at package time, exactly like bundled Chromium. The initial
  release is **read-only** (single `SELECT` / `WITH … SELECT`). A **packaged build may never serve mock
  rows**: packaged mode forces `AWKIT_ORACLE_REQUIRE_REAL`, refuses the mock flag, and treats a
  missing/failed driver as *feature unavailable*.
- **Reason:** Node has no first-party Oracle driver that satisfies AWKIT's offline/no-admin/no-global-
  toolchain constraints; JDBC does, but only from a JVM. Isolating JDBC in a child process keeps the
  driver out of the Electron process and lets the core compile and be fully tested with a plain JDK and
  no database. Fail-closed exists because the opposite is a silent-correctness disaster: a user could act
  on synthetic rows believing they came from Oracle. This closed a **live leak** — `oracleService` used to
  force `AWKIT_ORACLE_BRIDGE_MOCK=1` on any missing driver with no packaged guard.
- **Impact:** Three independent enforcement layers (`OracleRuntimeResolver` → launch env,
  `OracleJdbcBridgeManager` → handshake rejection, Java `Main` → `DriverUnavailableExecutor`). Snapshot
  Data Sources deliberately bypass all of it (stored rows, bridge never launched), so offline use survives
  a driverless build. `MockQueryExecutor` is dev/test only, by construction.
- **Related files:** `src/oracle/*`, `oracle-jdbc-bridge/**`, `app/main/oracleService.ts`,
  `scripts/prepare-oracle-runtime.mjs`, `docs/ai/ORACLE_JDBC_*.md`.

### 2026-07-17 — Oracle is INTEGRATION-CANDIDATE; merging ships code, not validation
- **Decision:** Gate the release behind explicit status transitions —
  `INTEGRATION-CANDIDATE` → (real executor compiles against real jars **and** an authorized Oracle suite
  passes) → `PRODUCTION-CANDIDATE` → (bundled runtime + packaged EXE + clean-machine validation) →
  `PRODUCTION-READY`. Merging PR #11 did **not** advance the status.
- **Reason:** An earlier report claimed `PRODUCTION-CANDIDATE`, which was **over-stated**: the real
  `OracleUcpQueryExecutor` had never compiled and no authorized Oracle database had ever been used. The
  code being merged and the code being validated are different claims, and conflating them is how a
  feature ships broken.
- **Impact:** `verify:oracle-live` is credential-gated and skips cleanly rather than falling back to mock;
  the gated executor is stub-compiled against the real JDK `java.sql` every run so it cannot rot. The four
  external gates (jars, authorized DB, packaged EXE, perf/soak) are documented as *not run*, with exact
  procedures, rather than silently skipped.
- **Related files:** `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md`, `ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md`.

### 2026-07-17 — SQL read-only gate is defense in depth; the database account is the real boundary
- **Decision:** Keep the tokenizer gate mirrored in TypeScript **and** Java (Java authoritative), and treat
  it explicitly as defense in depth. The primary control is a dedicated least-privilege, read-only Oracle
  account. `Connection.setReadOnly(true)` is set but is **not** a security boundary.
- **Reason:** A tokenizer can be out-thought; a privilege model cannot. But a read-only `SELECT` can still
  invoke a stored function, so the gate must also reject `UTL_`/`DBMS_`/`OWA_` package calls (SSRF/file
  access), database links, and inline PL/SQL (`WITH FUNCTION`/`WITH PROCEDURE` — which previously **passed**
  both engines, since `WITH` leads legally and `FUNCTION`/`PROCEDURE` weren't forbidden).
- **Impact:** `verify:oracle-sql-policy` drives one adversarial corpus through both engines via the real
  Dispatcher and requires identical decisions — keeping the mirror honest is now enforced, not hoped for.
- **Related files:** `src/oracle/OracleSqlPolicy.ts`, `oracle-jdbc-bridge/.../sql/SqlReadOnlyPolicy.java`,
  `docs/ai/ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md`.

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

### 2026-07-17 — Product rename to "SpecterStudio" (supersedes the WebFlow Studio rename)
- **Decision:** Rename the product to **SpecterStudio**; package `specterstudio`, `appId`
  `com.specterstudio.app`, runtime data root `%LOCALAPPDATA%/SpecterStudio/`. Shipped as its own commit
  inside PR #11 (renames only, no behavior change), alongside a new logo, launch splash, and icons (PR #12).
- **Reason:** Branding. It shipped **with** Oracle rather than separately because the Oracle work is
  SpecterStudio-native throughout (`com.specterstudio.*` Java packages, `com.specterstudio.app`,
  `%LOCALAPPDATA%/SpecterStudio/`, branded error text) — landing Oracle alone would have left the rename
  half-applied and the repo internally inconsistent.
- **Impact:** Same surface as the previous rename (titles, brand, `electron-builder.json`, dependency
  manifests + their PS/TS validators, agent rule docs, data root). `window.playwrightFlowStudio` is still
  **not** renamed — see the decision below. Old data folders are not migrated (pre-1.0).
- **Related files:** the 38 rename-only files in `488eabf`, plus `package.json`, `electron-builder.json`,
  `app/main/main.ts`.

### ~~2026-06 — Product rename to "WebFlow Studio"~~ (SUPERSEDED 2026-07-17 by the SpecterStudio rename)
- **Decision:** Rename the product from "Playwright Flow Studio" to **WebFlow Studio**; `appId`
  `com.webflowstudio.app`; runtime data root `%LOCALAPPDATA%/WebFlow Studio`.
- **Reason:** Branding. **No longer current** — kept for history only.
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
