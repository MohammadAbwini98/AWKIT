# AWKIT Refactoring Integration & Handoff Checklist — Reconciled

**Status:** planning complete; R0 characterization complete; production ownership refactor not started

**Repository baseline:** `main` at `18dc90d5a97cd37a2304d8a9885b899cc148d4cc`

**Reconciled:** 2026-09-02

**Companion plan:** `docs/plans/AWKIT_SYSTEM_DESIGN_REFACTORING_IMPLEMENTATION_PLAN.md`

## 1. Purpose and use

This is the repository-canonical replacement for the supplied handoff checklist. Use it once per
implementation phase R0–R9; do not mark baseline evidence as proof for a later code change. The current
repository and authoritative project sources outrank the supplied generic checklist.

Allowed classification terms are **Already implemented**, **Partially implemented**, **Genuinely
required**, **Obsolete/conflicting**, and **Needs clarification**. Verification results use only
`PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, or `NOT APPLICABLE`; `INCONCLUSIVE` is not an AWKIT result.

## 2. Handoff header

Complete this header for each phase:

| Field | Required value |
|---|---|
| Phase / task / Bead | R-number, task contract and Bead when implementation is authorized |
| Branch | `main`; direct commits only |
| Baseline and final commit | Full SHAs |
| Scope | Exact production, verifier, fixture and authoritative-source paths |
| Lease | Holder, allowed paths, amendments and release reason |
| User-visible behavior | Changed / unchanged, with evidence |
| Persisted-contract effect | None / additive / migration, with version and rollback |
| Verification | Exact command and PASS/FAIL/BLOCKED/NOT RUN counts |
| Unverified surfaces | Concrete reason and owning next phase |
| Git state | Clean/dirty, divergence and pushed commit |

## 3. Design decisions locked by the live repository

| Decision | Reconciliation | Required handling |
|---|---|---|
| One execution runtime | **Partially implemented** | `ExecutionEngine`/InstanceManager/Pool/ConcurrentCoordinator are canonical. Remove only proven dead parallel stubs. |
| One admission gate | **Obsolete/conflicting as phrased** | Keep sender auth, validation, license, capacity/resource and dispatch checks separate. One application service may sequence them; do not merge policies. |
| One queue/status model | **Already implemented** | Preserve `InstanceStatus`; do not invent `created/admitted` persisted states. |
| One browser owner | **Obsolete/conflicting as phrased** | Runner, Recorder and manual session capture have intentionally distinct lifecycles. Share policy helpers only. |
| One locator runtime | **Already implemented** | Default/XPath both persist `StepLocator` and replay through LocatorFactory/StepExecutor. |
| One atomic writer | **Already implemented** | `app/main/atomicReplace.ts` delegates to `src/storage/atomicReplace.ts`. |
| One store instance/coordinator per resolved folder | **Genuinely required** | Fix instance-local write-queue split without changing JSON shape or settings path behavior. |
| One telemetry/report store | **Obsolete/conflicting** | JSON reports and durable SQLite telemetry have different contracts; preserve both. |
| Preserve all unknown settings keys | **Needs clarification** | SET-017 intentionally prunes unknown fixed-schema Settings keys. Do not change without an explicit owner decision. |
| Evidence enum includes `INCONCLUSIVE` | **Obsolete/conflicting** | Use the repository result vocabulary; keep runtime state separate. |
| Offline and protected-login boundaries | **Already implemented** | Preserve bundled runtime and manual handoff; never automate protected surfaces. |

## 4. Current migration map

| Area | Live owner | Classification | Planned phase |
|---|---|---|---|
| Execution composition | `app/main/ipc/execution.ipc.ts` + `src/runner/ExecutionEngine.ts` | **Genuinely required**: IPC is too broad and core imports main composition | R0, R1A, R2 |
| Profile/report store composition | `app/main/profileStores.ts`, `src/storage/ProfileStore.ts` | **Genuinely required**: same-folder instances have separate queues | R0, R1B |
| Lifecycle predicates/dead stubs | Instance and orchestrator modules | **Partially implemented** | R0, R3 |
| Backend-only IPC/profile projections | preload + main IPC + profile mappings | **Needs clarification** for external consumers | R0, R4 |
| Profile compatibility | Flow/Workflow/Scenario mappings and stores | **Already implemented / needs focused ledger** | R5 |
| Settings unknown-key policy | `uiSettings.ts`, SET-017 | **Needs clarification** | R5 |
| Recorder/Runner fidelity | RecorderService, conversion, LocatorFactory/StepExecutor | **Already implemented** | Preserve; cross-layer proof in R6 |
| Browser/session lifecycle | Runner factory, RecorderService, SessionCaptureService | **Already implemented** | Preserve; shared-policy audit in R6 |
| Cutover/removal | No replacement architecture yet | **Genuinely required only after earlier proof** | R7 |
| Packaged/offline acceptance | Packaging/offline verifiers | **Already implemented; rerun after cutover** | R8 |
| Project state | Beads/ledger/docs/dashboard/contracts | **Already implemented process** | R9 after every phase |

## 5. Data compatibility ledger

Record a before/after fixture and exact-field diff for each changed aggregate.

| Data | Current rule | Phase gate |
|---|---|---|
| Flow profile and locators | Preserve unknown step/locator/config metadata; absent fields remain absent | `verify:flow-step-mapping`, Recorder and compatibility fixtures |
| Workflow profile | Preserve loaded workflow fields and connector meaning | workflow/profile round trip and Runner |
| Scenario projection | Backend-only `scenario:save` is potentially lossy | R4 consumer decision before removal or change |
| UI Settings | Normalize known schema; prune unknown fixed-schema keys; retain approved dynamic maps | SET-017 decision plus settings persistence/E2E |
| Session profiles | Preserve scoped app-owned paths and protected-login metadata; mask secrets | session-security and protected-login suites |
| Reports | Preserve JSON schema/artifact references and durable telemetry identifiers | run-report compatibility and execution history |
| Runtime SQLite | Additive/versioned migrations only; preserve terminal/cancellation history | runtime-store schema and recovery suites |
| Legacy profiles | Missing new fields keep old defaults; no destructive rewrite on read | legacy fixture corpus |

For each row entering a phase, capture: fixture path, old schema/version, new schema/version, unknown-field
policy, migration trigger, rollback/non-destructive-read rule, rollback strategy, and executed verifier.

## 6. Runtime invariants — classification and phase proof

The supplied unchecked list was not evidence. Its reconciled baseline is:

| Invariant | Baseline classification | Required phase evidence |
|---|---|---|
| Queued cancellation cannot be reversed | **Already implemented** | cancellation and queue race tests in R0/R2/R7 |
| Cancelled pending work cannot run | **Already implemented** | negative promotion test |
| Already-running policy is documented | **Already implemented** | preserve cancellation/stop semantics and reports |
| Cancellation is idempotent | **Already implemented** | repeated-cancel probe |
| Limits use canonical capacity logic | **Already implemented** | capacity + promotion tests; no local counters |
| No hardcoded host CPU/RAM | **Already implemented** | source guard and capacity verifier |
| Browser/context/page release | **Already implemented** | success/failure/cancel leak probes |
| Protected login uses manual handoff | **Already implemented** | secure-login fixture and session-security suite |
| No CAPTCHA/MFA/OTP/passkey bypass | **Already implemented** | negative policy/source evidence |
| No renderer-only authorization | **Already implemented** | IPC contract/authz tests |
| No secret logged or persisted | **Already implemented** | masking/storage evidence |
| No production internet dependency | **Already implemented** | strict offline and package evidence |

Any code phase touching an invariant must convert the relevant row to current-run `PASS`; otherwise report
`NOT RUN` with a reason. A static source check never substitutes for a behavior or race test.

## 7. Recorder / Runner fidelity — classification and phase proof

| Supplied checklist item | Baseline classification | Minimum rerun when affected |
|---|---|---|
| Default locator capture | **Already implemented** | Recorder + Recorder GUI |
| XPath locator capture | **Already implemented** | Recorder + Recorder GUI |
| Frame context | **Already implemented** | frame-chain/Recorder/Runner |
| Popup context | **Already implemented** | Recorder/Runner popup cases |
| Waits/async conditions | **Already implemented** | Recorder waits + Runner |
| Drag source/target | **Already implemented** | Recorder drag/drop + Runner |
| Save/reload | **Already implemented** | Recorder persistence |
| Flow Designer edit | **Already implemented** | flow-step mapping/GUI |
| Flow → Workflow conversion | **Already implemented** | mapping + persisted XPath Runner test |
| Workflow save/reload | **Already implemented** | profile persistence/mapping |
| Runner execution | **Already implemented** | Runner against Mock Site |
| Report/artifact output | **Already implemented** | run-report compatibility |
| Session reuse | **Already implemented** | session-security/reuse suites |
| Cancellation | **Already implemented** | queue/cancellation probes |
| Legacy profile | **Already implemented** | legacy fixture corpus |

Baseline XPath evidence at `33fb6cf` was Recorder 272/272, Recorder GUI 192 PASS / 0 FAIL / 0 NOT RUN,
Flow mapping 194/194 and Runner 138/138. These are historical anchors, not permission to skip R6 after
execution/store changes. XPath must never acquire a fallback or alternate runtime.

## 8. Mock Site / Feature Test Lab

- Extend an existing fixture when a phase changes observable Recorder, Runner, wait, locator, queue,
  report or session behavior.
- Every new scenario needs stable URL/title/description/expected behavior/related feature and stable
  accessible selectors.
- Prefer mutation/negative controls: cancelled promotion, store race, wrapper relocation, duplicate
  match, protected login and resource cleanup.
- Run `verify:mock-site` plus the feature verifier. Fixture HTML alone is not proof.
- If no observable scenario applies, record `NOT APPLICABLE` with a code-grounded reason.

## 9. Verification ledger template

| Command / scenario | Layer | Expected count | Actual result | Evidence path / note |
|---|---|---:|---|---|
| R0 architecture characterization | integration + mutation | 85 | PASS 85/85 | Exact-edge, real-store, lifecycle, capacity, license and dead-consumer guards |
| `npm run build` | type/bundle | command success | PASS | Typecheck and bundles complete |
| Focused subsystem verifiers | unit/integration/browser | Per command | PASS | Runner 138/138 plus store/cancel/concurrency/license gates recorded in task log |
| `npm run verify:mock-site` | fixture contract | current total | NOT APPLICABLE | R0 changed no fixture or observable scenario |
| `npm run verify:verifier-classification` | documentation consistency | 200 | PASS 200/200 | R0 command classified as integration |
| `npm run verify:roadmap-dashboard` | documentation consistency | 177 | PASS 177/177 | Overview says `Sources agree` |
| `npm run validate:offline` | integration/offline | command success | PASS | Strict offline validation completed |
| Packaged/clean-profile suites | packaged/acceptance | Pin artifact identity | NOT RUN | R8 only; do not inherit old package evidence |
| `git diff --check` | source hygiene | command success | PASS | R0 closeout |

Record exact PASS / FAIL / BLOCKED / NOT RUN counts. A denied command is `NOT RUN`. A genuine external
dependency may be `BLOCKED`; a failure is never relabelled. Include a red/mutation control for each new
architecture guard and compatibility rule.

## 10. Verifier quality review

For every added or modified verifier:

- classify it in `scripts/lib/verifier-classification.ts`;
- assert production entry points, not a copied test implementation;
- include a negative or mutation control proving the assertion can fail;
- pin stable behavior rather than private formatting;
- bound scans, timeouts and fixture size;
- distinguish static, unit, integration, real-browser, packaged and clean-machine evidence;
- avoid network, daily browser profiles, secrets, or weakened authorization;
- register Mock Site changes and make their contract executable.

## 11. Packaging / offline checklist — reconciled

All supplied items are **Already implemented**, but become current-run proof only in R8:

| Requirement | R8 evidence |
|---|---|
| No CDN/remote runtime assets | strict offline validation + packaged runtime |
| No required global Node/Playwright/browser | clean-profile package launch using bundled payload |
| Bundled Chromium resolves | packaged runtime provenance and launch |
| Standard-user execution | clean-profile Windows run |
| Mutable state outside `resources`/`app.asar` | path/provenance checks |
| Required runtime dependencies included | package manifest and runtime launch |
| Test-only tooling excluded | package-content verifier |
| Strict offline validation executed | exact artifact/source identity recorded |

Do not call an earlier installer/portable run proof for a new source commit. Host resource exhaustion may
block packaging, but it does not justify removing offline payloads or stopping unrelated applications.

## 12. Security review

- Sender/session/permission checks remain in Electron main IPC.
- License enforcement remains at request, pre-run, promotion, parked-resume and repeat boundaries.
- Protected-login detection pauses Recorder, preserves draft state, closes automation browser and uses an
  app-owned scoped installed-browser profile for manual handoff.
- No CAPTCHA/MFA/OTP/passkey/bot-detection automation or scraping.
- Secrets remain masked in logs/reports and absent from committed fixtures.
- Locator recovery retains exact sensitive-action identity, threshold/margin, hashing and bounded scans.
- Browser policy sharing must not merge Recorder/Runner/manual-capture lifecycle ownership.
- Offline production must not gain a runtime network dependency.

## 13. Project-state reconciliation — classification and closeout

The supplied items describe the existing **Already implemented process**, not work to mark complete in
advance. For each R phase:

| Source/action | Required handling |
|---|---|
| Beads and `blocks` | Create/update only when implementation is authorized; reflect real dependencies |
| Assignment | Claim while active; clear on closeout |
| Validation ledger | Update only with current-run evidence/status changes |
| `DEFECTS.md` | Update only for a real finding/state change |
| Phase source | Update only if product roadmap status actually changes |
| `CURRENT_STATE.md` | Record behavior/status and exact evidence |
| `HANDOFF.md` | Record next executable phase, boundaries and blockers |
| `TASK_LOG.md` | Append files/tests/result |
| `KNOWN_ISSUES.md` | Update only for a repeated defect/fragile area/risk |
| Architecture/commands/security/decisions | Update only when their authority changed |
| Verifier classification | Register every new command |
| Roadmap | Run verifier and confirm `Sources agree`; never hand-edit derived totals |

R0 used Bead/task contract `awkit-id8i`; its lease/claim is cleared at closeout. The comprehensive
Recorder/Reports/Settings validation ledger remains **65 PASS / 2 NOT RUN / 0 BLOCKED** because it has
no R0 case, so no unrelated row was fabricated or moved.

## 14. Git handoff

- Read the branch/commit policy and Git skill before every Git operation.
- Work directly on `main`; no feature branches, worktrees, stashes, resets or force pushes.
- Preserve unrelated changes and inspect every staged path.
- Commit coherent progress with truthful scope (`test:`, `fix:`, `refactor:`, `docs:`).
- Push, fetch, verify `HEAD == origin/main`, report divergence and final working-tree state.
- Failed/blocked gates do not prevent a truthful WIP/progress commit, but they do prevent release claims.

## 15. Remaining-risk register

| Risk / decision | Owner phase | Gate |
|---|---|---|
| Same-folder stores are proven to overlap and can lose stale-snapshot fields | R1B | one resolved-folder coordinator + concurrent/restart/failure-injection regression |
| Core imports main composition | R1A | architecture negative control + unchanged Runner behavior |
| Execution IPC extraction could collapse policies | R2 | independent denial tests at every checkpoint |
| Dead-looking IPC may have external consumers | R4 | owner/public API decision before removal |
| Settings unknown-key policy conflicts with proposal | R5 | explicit decision; SET-017 retained until then |
| Profile compatibility may be field-sensitive | R5/R7 | before/after fixture ledger |
| Browser ownership could be over-centralized | R6 | lifecycle/leak/protected-login suites |
| Package proof is artifact-specific and resource-sensitive | R8 | exact-commit packaged evidence or honest BLOCKED |

## 16. Next agent start point

Start only with **R1A — Narrow ExecutionEngine ports** from the companion plan. R0 is complete and its
85-check gate must stay green. Inject only the minimum session/report ports from Electron-main
composition, remove the two exact upward imports, retain the sanctioned `appPaths` bridge and do not
combine R1B or R2 ownership work into the same phase.
