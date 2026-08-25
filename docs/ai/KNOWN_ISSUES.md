# KNOWN_ISSUES

## RESOLVED (2026-08-25): `typecheck:scripts` is GREEN again — keep it that way (`AWKIT-BLD-001`)

`npm run typecheck:scripts` was red with **33** standing errors in eleven verifier scripts; it is now
**0, exit 0** (`a17b6e4`). Every one was fixed at its cause — no `tsconfig` change, no `@ts-ignore`,
no widening to `any`, no assertion deleted, no private member made public. Per-diagnostic evidence:
`docs/testing/comprehensive-validation/DEFECTS.md` › `AWKIT-BLD-001`.

**Why it must stay green:** the gate exists to catch a removed export that otherwise only fails at
`tsx` runtime. While it was red, a NEW error was indistinguishable from the standing 33 — which is
how it stayed red long enough to accumulate 33.

**Two traps this uncovered, both likely to recur in new verifiers:**

- A local `check(name, cond)` helper called as `check(name, cond, detail)` **compiles nothing away
  silently** — it is a hard TS2554, but only under `typecheck:scripts`, which nothing runs by habit.
  Declare `detail?: string` and actually print it; a discarded diagnostic is a red run that says
  nothing about what failed.
- `let flag = false; p.then(() => { flag = true; }); … flag === true` is **TS2367**, not a bug in your
  test. TypeScript narrows the bare `let` to the literal `false` and does not track assignment inside
  the callback. Put the observed state on a holder object (`const seen = { flag: false }`); a property
  read is not narrowed that way. Do not "fix" it by weakening the assertion.

## Release packaging: portable/NSIS artifacts cannot be built on this workstation (2026-08-25, `awkit-hgol`)

`npm run package:portable` gets through every stage — including **strict** offline validation — and
then dies in `electron-builder`'s final `7za -mx=9` over the 802 MiB tree with
`Can't allocate required memory!`. Reproduced three times at 6.0–6.7 GB free of 15.9 GB.

What this does and does not block:

- `dist/win-unpacked` **is** produced correctly, from a clean tree, with a signed manifest whose
  `sourceCommit` equals HEAD. Every packaged gate that drives it (`verify:packaged-licensing`,
  `verify:packaged-runtime`, and Parts B–J of `verify:packaged-walkthrough`) runs normally.
- Only the single-file portable EXE and the NSIS installer + `latest.yml` are missing, so
  `verify:packaged-walkthrough` Parts A/K/L and `verify:packaged-validation`'s portable freshness
  guard cannot pass.

**Do not make this go away by lowering `compression` in `electron-builder.json`.** That changes the
shipped artifact, and doing it to turn a gate green is exactly the move the guard exists to prevent.
The guard itself is working: `package-portable.ps1` throws rather than leaving a stale EXE that a
later gate would happily call fresh (its comment has named this `-mx=9` OOM since 2026-07-06).

**A stale portable EXE still "passes" the existence check.** Part K booted the 22-hour-old artifact
and reported three green checks about it. Before trusting Part K or L, confirm
`dist/SpecterStudio <version>.exe` was built from the HEAD you are testing —
`verify:packaged-validation`'s freshness guard is the check that actually notices (it reported the
EXE as 1321 minutes old).

## Issuer readiness is profile-scoped — an isolated `%LOCALAPPDATA%` legitimately reports MISSING (2026-08-25)

Every GUI verifier launches on an isolated, empty `%LOCALAPPDATA%` (`isolatedLaunchEnv`), and the
issuer key lives under `%LOCALAPPDATA%\SpecterStudio\issuer-keys\`. So the License Issuer page in ANY
GUI verifier run correctly shows **MISSING**, even on a workstation where the authorized key is
provisioned. That is not a defect and must not be "fixed" by pointing the resolver anywhere else.

Before treating an "Unavailable" report as a path bug, establish which profile produced it:

```powershell
echo {} | node node_modules/tsx/dist/cli.mjs tools/license-issuer/roadmap-bridge.mts readiness
```

That answers for the REAL profile, through the same resolver the app uses. To exercise the READY path
in a GUI run, set `SPECTER_ISSUER_KEY` to the authorized absolute path in the launch env — which is
what `verify:issuer-readiness-gui` does, and why it reports **BLOCKED** rather than passing when no
authorized key exists. Never copy the private key into a temp profile to make a test go green.

## RESOLVED (2026-08-23): all 38 review defects fixed; two catalogued families closed by guards — and a THIRD review pass filed 12 new defects mid-campaign

The 38-defect campaign (`AWKIT-MAP-002..005`, `AWKIT-WFB-001/002`, `AWKIT-RUN-001..011`,
`AWKIT-FLO-001`, `AWKIT-DUR-001`, `AWKIT-SES-001..004`, `AWKIT-SET-007`, `AWKIT-REC-036/037`,
`AWKIT-SEC-001/002`, `AWKIT-LIC-002`, `AWKIT-A11Y-001`, `AWKIT-QA-001..008`) is CLOSED with
per-defect evidence in `DEFECTS.md`. Two KNOWN_ISSUES families are now guarded, not just patched:

- **aria-modal-without-focus-contract**: the shared `useModalFocusContract` hook is the contract;
  `verify:source-hygiene` scans every `aria-modal="true"` file and fails without the hook or an
  in-file Escape+focus+return implementation. The guard surfaced nine MORE instances beyond
  ReauthDialog/ResetPasswordModal (instances #5–#13 of the class); all converted.
- **checks-that-fail-open / escape hatches**: instance #8 (`verify-zvec-packaged-live` lastReason)
  removed; chromium-hardening gained a NOT-RUN state that exits non-zero offline;
  verifier-classification scans scripts/ recursively with per-class floors;
  recorder-draft/protected-login-recorder pin EXPECTED check counts via
  `scripts/lib/verify-harness.mjs`.

**Operational note on the new strict gates:** `verify:settings-e2e` and
`verify:reports-settings-a11y` now exit non-zero when an owner-approved OS-shell or
environment-gated check cannot run (one such skip each in this environment). That redness is the
point — a skip is no longer printed as green. Run with the documented approvals for full green.

**MID-CAMPAIGN DISCLOSURE:** a *third* independent review pass filed **12 new open defects**
(`AWKIT-SEC-003..006`, `AWKIT-DUR-002/003`, `AWKIT-REC-038..043`) into DEFECTS.md while this
campaign was executing. They arrived in the working tree uncommitted and were swept into the
cluster-5 docs commit (`d6c8c1b`) by the per-cluster staging. Preserved per the never-discard rule. **Follow-up campaign resolved all twelve** (11 fixed,
REC-043 closed as a false positive — the Designer's uploadFile Value Source editor already exists).
Residual watch-items: Oracle mutator gating now requires SETTINGS_EDIT, so any future Operator-facing
Oracle settings UI must ship with the corresponding role grant; recorder download capture replaces
the triggering click, so flows whose download endpoint is rate-limited will re-request on replay
(documented in the verifier).


## Whole-repository code review (2026-08-23): architecture erosion, licensing depth, and doc drift — recorded, not fixed

An independent read-only review swept runner, recorder/sessions, persistence/mappings, licensing,
security/offline/packaging, designers/UI, and verifier quality. Product defects are filed in
`docs/testing/comprehensive-validation/DEFECTS.md` (`AWKIT-RUN-001..007`, `AWKIT-MAP-002..004`,
`AWKIT-WFB-001/002`, `AWKIT-REC-037`, `AWKIT-SEC-001/002`, `AWKIT-LIC-002`, `AWKIT-QA-006/007`).
The items below are risks and drift that do not fit the defect register.

A **second independent pass** the same day corroborated these records and filed a delta: DEFECTS
`AWKIT-DUR-001`, `AWKIT-SES-004`, `AWKIT-RUN-008..011`, `AWKIT-FLO-001`, `AWKIT-MAP-005`,
`AWKIT-SET-007`, `AWKIT-A11Y-001`, `AWKIT-QA-008`; plus the additional risk items in the
"second-pass delta" subsections at the end of this review block. The two passes were executed
independently and their overlap deduplicated.

### The `src/` framework-agnostic rule has eroded: three upward imports, one of them an Electron module

The documented contract (`ARCHITECTURE.md`, `src/AGENTS.md`) is that the ONE sanctioned bridge is
`ExecutionEngine → app/main/appPaths`. Today there are four import sites across three files:

| Site | Pulls in |
| --- | --- |
| `src/runner/ExecutionEngine.ts:19` | `appPaths` (the sanctioned one) |
| `src/runner/ExecutionEngine.ts:20` | **`app/main/ipc/session.ipc` — which imports `electron`** |
| `src/runner/ExecutionEngine.ts:29` | `app/main/profileStores` (`createReportStore`) |
| `src/storage/ProfileStore.ts:4` | `app/main/atomicReplace` |

`DispatchGate.ts:4` itself states "ExecutionEngine lives in the Electron-free domain" while the
same file imports an IPC registrar. Every script that imports `ExecutionEngine` under plain `tsx`
transitively loads Electron today only because `ipcMain.handle` sits behind a function. The
injection seam that should host these already exists (`execution.ipc.ts` setter injection) —
route them through it rather than adding a fourth upward import. Related composition split-brain:
`report.ipc.ts:11` constructs its own `createReportStore()` instance, so engine report writes and
IPC-driven deletes are not mutually serialized (per-instance write chains).

### Dead components advertised as live; a wired-but-unreachable legacy layer

Zero importers exist for `src/orchestrator/ExecutionQueue.ts`, `FlowOutputRegistry.ts`,
`ConditionalFlowRouter.ts`, `src/instances/InstanceEvents.ts`, and `InstanceLockManager.ts`
(superseded by ResourceLockManager + ProfileLockManager + DispatchClaims), yet ARCHITECTURE.md
lists the first three as live orchestrator components — an agent auditing concurrency would count
protections that do not exist. Separately, the pre-run-cards legacy layer is fully plumbed but has
no renderer consumer: preload exposes `instances.*` / `runtimeInputs.*` / `scenarios.*`
(`preload.ts:393-395,426-428`), main registers the channels (mutation-capable, and the
runtimeInput ones carry no permission assertion — see AWKIT-SEC-002), stores still seed
`default-concurrent-profile`, and `scenario:save` would persist through the lossy reverse
converter if ever bound. Delete or finish; half-alive surface is worse than absence.
Third-pass delta (2026-08-23): the WFB-002 fix widened the latent loss —
`scenarioToWorkflowProfile` (`src/profiles/WorkflowProfile.ts:187-226`) still drops
`execution.continueOnOptionalFlowFailure`, `execution.takeScreenshotOnFailure`, `runtimeInputs`,
`dataSource`, `security`, `createdAt`/`updatedAt`, per-node `retryPolicy`/`failurePolicy`/`size`,
and flattens `inputBindings` to static/runtime strings, so any future consumer of
`scenario:save` would revert the newly persisted failure-policy fields to defaults. The channel
remains renderer-unreachable (`preload` exposes `scenario:list` only).

### Settings store prunes unknown keys on every read — deliberate, but asymmetric with the profile stores and unrecorded as a policy

`uiSettings.ts` `retainKnownKeys`/`pruneUnknownSettings` delete any key not in the schema
template on every read, and every settings update rewrites the pruned object — so unknown
compatible fields (written by a newer version sharing `%LOCALAPPDATA%/SpecterStudio`, or arriving
via `settings:import`) are permanently erased by the next mundane write. `verify:settings-e2e`
SET-017 pins this as intended, and dynamic maps are correctly exempted — but it is the opposite
of the profile stores' byte-for-byte unknown-field preservation and of the stated schema rule.
Recorded here (third-pass 2026-08-23) so the asymmetry gets an explicit DECISIONS.md entry:
either document the settings exception or switch to retention.

### Licensing depth: the signed entitlement dimension is decorative

See AWKIT-LIC-002 in DEFECTS.md for the headline. The perimeter is healthy (single trust model,
fail-closed defaults, no bypass found beyond documented set); the depth gaps are entitlements
never consulted by admission, import resetting the rollback high-water mark, shared-license
metadata never advancing, key1 not flagged `retired`, resume/retry-handoff skipping latch
consultation, and synchronous disk+registry work inside the dispatch loop. None permits
unlicensed execution.

### Renderer bundle size claim is stale (~900 KB → ~2 MB measured)

KNOWN_ISSUES previously recorded "large renderer bundle (~900 KB)". Measured on 2026-08-23:
`out/renderer/assets/renderer-*.js` is **1,985.78 kB** after a clean build. The no-code-splitting
observation stands; the number did not. Update any sizing reasoning that used the old figure.

### ScenarioBuilder dead UI / settings archaeology (cross-ref AWKIT-WFB-001/002)

Beyond the fabricated save path: the Workflow Definition left panel renders `{false && …}` while
its collapse/width settings keys stay live; the collapsed connector panel's expand rail also
renders `{false && …}`, so clicking empty canvas can strand the user with no visible way back;
execution-mode/parallelism have setters but no authoring control, so the toolbar chip advertises
configuration nothing can change and every authored workflow is forever `sequential`; keyboard
Delete removes edges only — nodes are pointer-only deletable in both designers; a saved flow can
be used only once per builder-authored workflow (canvas id overloads flowId). Import validation
admits duplicate node ids and missing sentinels, deferring failures to plan time or React key
collisions.

### Recorder capture long-tail (beyond DEFECTS AWKIT-REC-037)

- **`<select multiple>` records only the first selected option**
  (`recorderInitScript.ts` reads `.value`). Ctrl-selections silently degrade to one option on
  replay; Playwright's `selectOption` accepts arrays, so the channel exists.
- **Popup-close and independent-navigation steps bypass the serialized action queue**
  (`RecorderService.ts` popup `close` handler and `recordIndependentNavigation` push straight to
  `actions`), so recorded order can invert under concurrent events and Smart-Wait windows can
  attach to the wrong predecessor.
- **Hidden-at-rest controls outside the visibility catalog get NO hover prerequisite at all**
  (catalog samples `a, button, input, select, textarea, [role=button], [role=menuitem]` while the
  action-owner climb accepts broader sets): a `[role=tab]` hidden at rest yields neither hover nor
  needs-review — this case fails OPEN where every sibling fails closed.

### Verifier exit-code semantics differ per suite (cross-ref AWKIT-QA-006/007)

"Green" means different things depending on which script produced it: some suites fail on skip
(zvec-packaged-live, packaged-walkthrough), four exit 0 with all checks NOT RUN, chromium-
hardening passes vacuously offline, and two tallies shrink denominators on uncaught throws
(AWKIT-QA-005). Until a shared harness helper exists, judge each suite's green by reading its own
exit condition — not by analogy with its siblings.

### Second-pass delta (2026-08-23): risks that need verification or do not fit the defect register

Filed by the corroborating review pass; none of these duplicates an existing record.

- **SECURITY-RISK, needs measurement: the `file://` trust boundary accepts ANY local file URL.**
  `app/main/ipc/senderGuard.ts:14-15` returns trusted for any URL starting `file://`, and
  `windowManager.ts:110-121` `isOwnBundle` does the same for navigation — the comments say "the
  packaged bundle", but the check pins no bundle path. Electron's DEFAULT behavior navigates a
  window when a local file is dragged onto it; nothing in `app/renderer/**` installs a
  dragover/drop preventDefault (only widget-local handlers exist). If a drop navigates to a
  foreign local `.html`, that document becomes a TRUSTED IPC sender with the full preload bridge,
  and the session binding keyed to `event.sender.id` (`sessionContext.ts:27-31`) SURVIVES
  navigation — so a post-login drop would inherit the logged-in RBAC. This converts AWKIT-SEC-002's
  ungated channels from "needs XSS" to "needs one drag-drop". **INFERENCE, not observation:** the
  drop-navigation path was not executed in this app. Verify by dragging an HTML file onto the
  window in dev; fix direction either way is pinning both checks to the exact bundle path/dev
  origin plus a renderer-level drop preventDefault.
- **PROBABLE protected-login gap: popup handoff detection attaches after the identity wait.**
  For popups, `attachProtectedDetection` runs only after the instrumentation probe AND the popup
  identity probe (`RecorderService.ts:945-975`), which by design consumes ≥250 ms and up to 2 s;
  detection listens only to `load`/`domcontentloaded` (`:1042-1048`). An OAuth/MFA popup that
  finishes loading inside that window fires both events before any listener exists, so
  `detectAndMaybeHandoff` never runs for it unless a LATER navigation happens. The initial page
  gets its detector attached BEFORE `goto` (`:666-668`) — this asymmetry is popup-specific. If
  confirmed live, a single-shot IdP popup is recorded with no handoff offered, which violates the
  SECURITY.md pause rule. Needs a live mock-site OAuth-popup fixture before filing as a defect.
- **Runner races pending runtime verification** (each code-traced, none reproduced):
  - *Origin-claim permit loss under parallel branches*: all isolatedPage branch executors share
    one `OriginClaimTracker`; `ensureOrigin` is check-then-act with no mutex
    (`OriginClaimTracker.ts:62-103`), so two branches landing on different origins can interleave
    and overwrite `currentToken`, permanently leaking one non-TTL semaphore permit
    (`DispatchClaims.ts:49-53` grants without TTL) until app restart.
  - *Cancel-before-arm resolves "continue"*: `ManualHandoffController.waitForAction` returns
    `Promise.resolve("continue")` when no pending entry exists (`:48-50`); if Stop lands between
    `pauseForHandoff` and the `waitForAction` call in `captureProtectedLoginSession`
    (`StepExecutor.ts:2467→2489`), the cancel is consumed silently and the capture poll runs to
    its timeout.
  - *Void-discarded optional armed response*: `StepExecutor.ts:1042` fire-and-forgets optional
    waits with `void`; `runRequiredOrOptional` rethrows `CancelledError`, and there is no
    process-level unhandled-rejection handler — Stop during an optional armed response can raise
    an unhandled rejection in the Electron main process.
  - *Old-runtime close failure kills the replacement*: in the Reuse Session swap
    (`PlaywrightRunner.ts:264-270`), a rejection from closing the OLD browser tears down the new,
    already-published healthy runtime via the catch's cleanup.
- **Persistence lower-severity findings (bundle)** — all code-traced, no data loss observed:
  import-collision overwrite asymmetry (workflows guard `WORKFLOW_IMPORT_ID_CONFLICT`;
  `flows:`/`dataSources:`/`instances:` import are blind upserts via `JsonProfileStore.import`);
  profile-store folders freeze at creation while other consumers re-resolve `getConfiguredPaths()`,
  so changing a Settings path splits reads/writes across two folders for process lifetime
  (`profileStores.ts` factories + IPC caching vs `resolveStorageDirs`); Oracle service long
  read-modify-write can revert concurrent edits to the same Oracle data source
  (`oracleService.ts:349-402`, seconds-long await between get and update on a store instance
  disjoint from the cached one); bare `writeFile` remains for user row-data files
  (`dataSource.ipc.ts:191,203,236`) and run reports (`ReportService.ts:81-85`);
  `SqliteRuntimeStore.persistNow` renames WITHOUT the EPERM/EBUSY retry every other writer uses
  and leaks its temp file on failure (`SqliteRuntimeStore.ts:1044-1061`); `ProfileStore.update`
  deletes the freshly written record when old/new ids sanitize to the same filename
  (`ProfileStore.ts:74-83`).
- **Designer smaller items (bundle)**: Reuse Session validation is mode-blind — every autoDetect
  node permanently shows "requires a saved session" although the runtime fully supports autoDetect
  (`flowNodeRegistry.ts:209` vs `FlowNodePropertiesPanel.tsx:1500-1523`,
  `StepExecutor.ts:2343`); touching any structured field of a conditional connector writes a full
  `conditional` config whose presence makes the legacy expression routing-inert with no UI
  disclosure (`ConnectionPropertiesPanel.tsx:283-289,357-370`; precedence `FlowExecutor.ts:579-609`);
  Start/End structural guards are keyed to literal node ids `"start"`/`"end"` and vanish for
  loaded flows whose persisted ids differ (`FlowChartDesigner.tsx:402,785,1093`); non-loop
  connectors have no keyboard path at all — not focusable/selectable/deletable
  (`FlowCanvas.tsx:792-809` vs loop-only role/tabIndex) — and node wrappers are likewise
  pointer-only (`:616-631`); the ConnectionPropertiesPanel footer "Done" button is enabled with no
  onClick (`ConnectionPropertiesPanel.tsx:411-413`), a RULES.md no-fake-controls violation.
- **Recorder smaller items (bundle)**: independent-navigation `goto` steps persist MASKED urls as
  replay targets — `recordIndependentNavigation` stores `maskUrl()` output in
  `valueSource.value`, so a mid-recording navigation carrying a sensitive query param saves a step
  that replays a literal `?token=***` URL (`RecorderService.ts:226-238,273-278`; same for
  autoSecureLogin loginTarget at `:1114,:1243`); hash-stripped URL signals make hash-route SPA
  `urlChanged` waits vacuous — signals drop the location hash while firing on `hashchange`
  (`recorderInitScript.ts:2405,2427` + `smartWaitObservation.ts:171-179`).
- **DOC DRIFT: `tests/runner.mocksite.spec.ts` is wired to nothing while TESTING.md instructs
  extending it.** No npm script invokes `playwright test`; neither tsconfig reaches the file, so
  it is type-checked by nothing and executed by nothing, yet `docs/ai/TESTING.md` ("Required test
  behavior") still names it as a required extension point alongside `verify-runner.mts`. The spec
  has also drifted (`makeContext` omits `paths.sessions`). Corrected inline in TESTING.md; decide
  whether to wire, revive, or delete the spec.
- **Assertion-failure masking asymmetry is filed as AWKIT-RUN-011** rather than left here: the
  `expected` side of an assertion failure can be a resolved secret and reaches reports raw. See
  DEFECTS.md.

## TRAP: a verifier tally divides by a denominator an uncaught throw can SHRINK (2026-08-22)

`scripts/verify-recorder-draft.mts` and `scripts/verify-protected-login-recorder.mts` — and any
verifier sharing this harness shape — compute their result as `passed / results.length`, where
`results` accumulates **only the checks that actually ran**. An uncaught throw part-way through a
section therefore removes those checks from the **denominator** instead of failing them, so the run
can print a confident, full-looking `N/N` while having silently skipped work. The tally goes
*down* in total, not into a failure column, and a reader comparing against a remembered baseline can
easily read a shrunken `N/N` as "still green".

**Rule: judge these verifiers by their EXIT CODE, never by a full-looking tally alone.** A tally is
only trustworthy when paired with a cardinality assertion that pins the expected number of checks.

Two aggravating factors seen together in this same suite: a missing optional chain on a `.config`
access (`AWKIT-QA-004`) is exactly the kind of `TypeError` that triggers this, converting what
should have been one clean FAIL into a silently shorter run. Tracked as `AWKIT-QA-005` in
`docs/testing/comprehensive-validation/DEFECTS.md`; the shape is **not** confined to these two
scripts and deserves a repo-wide sweep.

This is the same family as the long-standing "checks fail OPEN" lesson: the failure mode of a check
is almost never a loud red failure — it is a quiet pass, or here, a quiet disappearance.

## TRAP: `src/session/atomicWrite.ts` duplicates `app/main/atomicReplace.ts`, and they have already drifted (2026-08-22)

AWKIT now has **two independent implementations** of the same Windows-contention-safe write:

| | attempts | backoff |
| --- | --- | --- |
| `app/main/atomicReplace.ts:77-109` (pre-existing) | `DEFAULT_REPLACE_ATTEMPTS = 5` | `DEFAULT_REPLACE_BACKOFF_MS = 20` |
| `src/session/atomicWrite.ts` (added by `b16812a`) | 4 | 50ms linear |

Both do temp-file + rename with bounded `EPERM`/`EBUSY` retry, and the defaults **already
disagree** — so the two paths behave differently under the same antivirus or
browser-still-releasing-the-directory contention, and a future tuning fix applied to one will not
reach the other. This is the duplication `docs/ai/RULES.md:30` forbids.

Before adding any third atomic-write path, **use `app/main/atomicReplace.ts`**. If a caller
genuinely needs different attempt/backoff values, make them parameters of that one helper rather
than forking it. Tracked as `AWKIT-SES-001`.

Related, from the same review: the new helper writes `JSON.stringify(value)` and dropped the
previous `null, 2`, so `session-profiles.json` silently changed from pretty-printed to single-line
(`AWKIT-SES-002`). Harmless to round-tripping, but it is an undocumented on-disk format change that
will confuse anyone inspecting the store by hand.

## RESOLVED: `typecheck:scripts` is green at 0 diagnostics (`awkit-rvt`, 2026-08-22)

The nine-diagnostic regression across five verifier consumers is resolved in `8c02726`; the Bead is
closed. Root causes were four deliberately incomplete `FlowStep` negative-test shapes asserted with
unsafe direct casts, two missing same-basename declarations for real roadmap `.mjs` exports, a
duplicate `readFileSync` import, and a stale `unknownStepType` expectation even though the canonical
code for a known step with unsupported config is `unsupportedConfiguration`.

Ownership was split correctly: QA owned the verifier repairs and project-state owned
`tools/roadmap/lib/license-issuer.d.mts` plus `tools/roadmap/server.d.mts`. The result uses precise
negative-test helpers and declarations, with no `any`, `ts-ignore`, unsafe double-cast, broad
`allowJs`, or compiler exclusion. `npm run typecheck:scripts` now passes with **0 diagnostics**;
assertion is **77/77**, loop-scroll **88/88**, validation **163/163**, and the roadmap-license module
import smoke path remains type-safe. Removing only the declared `buildIssuePayload` export proved
the gate is sensitive: typecheck failed with exit 1 and TS2305 at the consumer, then returned to 0
after exact restoration. Changing the constructed dblclick/contextMenu step types to raw `teleport`
separately failed validation at **161/163** because the corrected canonical
`unsupportedConfiguration` negative checks no longer received known step types.

The enduring rule remains: `npm run build` does not typecheck `scripts/**`; after changing an `.mts`
verifier, run `npm run verify:all-typecheck` (or at minimum `typecheck:scripts`) in addition to the
runtime verifier. `tsx` execution alone can stay green while static contracts are red.

## RESOLVED: random oracle and clickAndHold round-trip baselines are green (`awkit-rvo`, `awkit-rvb`, 2026-08-22)

Both broader random-lab gaps are resolved and their Beads are closed:

- **`awkit-rvb`, product/frontend mapping defect, fixed by `8d7c7b9`:** a Designer no-op save
  treated absent `clickAndHold.config` as an explicit default and fabricated `{ holdMs: 1000 }`.
  Mapping now preserves absence versus explicit duration, retains imported unknown keys, and filters
  known fields irrelevant to the active subtype. Click-and-hold is **35/35** and random round-trip is
  **27/27**, JSON **54/54**, with **0 diffs**.
- **`awkit-rvo`, QA harness defect, fixed by `8c02726`:** the generic
  `missingRequiredValue` mutator cleared flat selector fields even when the actual required runtime
  channel was assertion `config.expectedValue`, fixed-loop `iterationCount`, time-wait `timeoutMs`,
  or page-scroll `scrollAmount`. The oracle now targets the exact subtype channel and excludes
  optional or already-invalid shapes. It passes **33/33** with **54/54** mutation applications.

Mutation proof prevents both fixes from being accidental. Re-fabricating `holdMs` failed
click-and-hold at **32/35**: F6 gained `{ holdMs: 1000 }` from absence, F8 gained it beside an
unknown-only config, and F11 filtered the irrelevant known key but still fabricated the default.
Round-trip simultaneously failed **25/27** with 5 raw diffs of one `nodes[].config` shape (JSON
stayed **54/54**). Flattening the required-value selector failed the oracle at **32/33**; its focused
channel check rejected `generic-goto`, `assert-config`, `wait-time`, `scroll-page`, `loop-fixed`, and
`run-flow`. Restoring each implementation returned the exact green counts above.

## RESOLVED by Option A: a condition literal+valueSource is now diagnosed; residual is generated evidence only (2026-08-21)

**RESOLVED and independently QC-approved.** The owner decision landed — Option A, literal-only
condition expressions (`awkit-9qcz`). The "no diagnostic anywhere" gap below is CLOSED:
`FlowValidator.ts` now emits a warning-severity `ignoredConditionValueSource` when a condition
carries a non-empty literal AND a `valueSource` (message names only the source `.type`), the condition
editor in `FlowNodePropertiesPanel.tsx` shows the same non-fatal message plus a remove button, and
`RandomConfigurationGenerator.ts` no longer emits a `valueSource` for conditions (so the generator
stops manufacturing the state). The runtime is unchanged — a condition still routes on its literal.
During final QC, an imported `valueSource: null` was found to crash while the diagnostic formatted
`.type`; the guard now uses `!= null`, and the focused verifier proves malformed legacy JSON returns
normally and treats null as absent metadata.

**Generated evidence, NOT product data:** independent QC observed the pre-finalization gitignored
`reports/random-tests/roundtrip-defects.json` at **88** legacy conditions / 88 sources. The optional
final `test:random:roundtrip` run regenerated that report by design; it now contains 44 conditions /
0 sources and the unrelated `clickAndHold` finding recorded above. Neither version is read by the
app. No live profile carries a condition source (0 in `%LOCALAPPDATA%/SpecterStudio/`), and the one
tracked repository fixture is literal-only.

The pre-fix description below is retained as historical context for how the state arose.

### Historical (pre-Option-A) description

`FlowExecutor.resolveNext` (`src/runner/FlowExecutor.ts` L549, L571-577) is synchronous and routes a
condition with `evaluateBoolean(step.value ?? "", …)`. It **never reads `step.valueSource`**.
Before Option A, `FlowValidator.ts` required only `isNonEmptyString(step.value)` for a condition, so a
node carrying *both* fields passed validation, ran on the literal, and the bound source was silently
ignored with no diagnostic anywhere — the "Resolved at run time from a &lt;type&gt; source" hint in
`FlowNodePropertiesPanel.tsx` (L1012-1019) lives in the value section, and a condition's `sections`
(`flowNodeRegistry.ts` L150-155) are `["condition", "execution"]`, so that hint is never rendered for
one.

**The Flow Designer cannot author this state.** With `"value"` excluded from the condition's
sections, a condition binding has no UI at all. Such a node can therefore only arrive from:

- the random configuration generator (`RandomConfigurationGenerator.ts` L145-152 / L331-340 sets
  `payload.valueSource` unconditionally whenever `spec.requiresValue` — 100% of generated conditions
  carry one),
- an imported profile, or
- a hand-edited profile JSON.

Blast radius today: **1** condition node tracked in the repository (literal-only, no source) and
**0** in the live `%LOCALAPPDATA%/SpecterStudio/` profile store. The 88 in
`reports/random-tests/roundtrip-defects.json` are frozen, gitignored historic evidence, **not live
product data**.

Related and distinct: a condition is the **only** value-taking step type where the literal wins.
`StepExecutor.resolveStepValue` (L2614-2617) gives every other type the opposite precedence — the
source wins. Do not "harmonize" that inversion without the owner decision; honouring a condition
`valueSource` would force `resolveNext` to become async, because `ValueResolver.resolve` is async.

## Agent harness: three fail-open seams in the routing/lease architecture (2026-08-21)

Found by the independent QC review of `awkit-bkfy`. All three share one shape — the safety
mechanism's failure mode is indistinguishable from "everything is fine".

- **RISK, no mitigation, no regression guard: write-lease enforcement is a single point that fails
  open when the hook cannot spawn.** `tools/agents/lease-guard.mjs` blocks a write only by exiting
  with code `2`. A hook process that never starts — `node` not on PATH, a spawn timeout, a crash
  before the guard's own logic runs — exits non-2, which Claude Code treats as a *non-blocking*
  error and the tool call proceeds. Meanwhile `.claude/settings.json` `permissions.allow` grants
  `git commit -m:*`, `git push origin main`, `bd update:*` and `package:*` to **every** agent, not
  per role. So a guard that fails to start silently converts a read-only reviewer into an
  unrestricted writer with push rights, and nothing in the transcript looks wrong. There is
  currently no fallback enforcement and no test that the guard is even running.
  **INFERENCE, not observation:** Claude Code's actual behavior on hook-spawn failure was NOT
  measured here — this is read off the documented exit-code contract (2 = block, anything else =
  non-blocking error). Confirm by observation before treating the severity as settled, and do not
  record a mitigation until one exists.
- **`context-status.mjs` degrades to a silent "everything is fine" reading.** Its token lookup ends
  in `?? 0`, so any statusLine payload whose shape it does not recognise — an upstream rename, a
  nesting change, a new schema version — renders **0 tokens** and reports the `normal` zone forever.
  The 120K delegation warning and the 150K compaction signal would then never fire, and the readout
  would look healthy the whole time. The routing verifier feeds it a repository-authored
  **synthetic** fixture rather than an observed live payload, so the check passes on data that by
  construction has the expected shape and a real upstream change would not be caught. This is the
  degrade-path-satisfies-the-check shape: prefer `?? null` plus an explicit "unknown" zone, and
  assert against a captured real payload.
- **The compaction threshold is configured but UNVERIFIED.** `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75`
  with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` is set, but official documentation states the
  override cannot *raise* the threshold and that values above the default percentage are ignored.
  The default percentage was not established, so whether `75` is in effect at all is unknown.
  Tracked in the task contract as `E-COMPACT-THRESHOLD` = `NOT RUN`, `required: false`. It must
  **never** be upgraded to `PASS` on the basis of the setting being present — only an *observed*
  compaction event at a measured context size is evidence.

## RISK: two more low-severity seams surfaced closing awkit-bkfy (2026-08-21)

Non-blocking, carried forward from the `awkit-bkfy` closure review. Neither is fixed.

- **`findStaleClaims` has limited sensitivity and no fixture proving it can return non-empty.**
  `tools/roadmap/lib/link.mjs` `findStaleClaims` gates the roadmap dashboard's "0 stale claims"
  reading, but there is no test that injects an actually-stale claim and asserts the function returns
  it. A `.every()`/empty-collection-style pass is therefore possible: the check could report zero
  stale claims because it cannot detect one, not because none exist. Add a fixture that makes it
  return non-empty before trusting the zero.
- **Some consistency copies inherit booleans computed elsewhere (`model.mjs`) rather than
  re-deriving them.** Parts of the roadmap consistency readout carry forward a boolean produced in
  `model.mjs` instead of recomputing it from the sources at the point of display, so a defect in the
  upstream derivation would propagate silently into "Sources agree" rather than being caught
  independently. Prefer independent re-derivation at each consumer.

## DEFECT: the roster's turn budget starves the one role independence depends on (2026-08-21)

In `tools/agents/routing-matrix.mjs`, read-only roles carry `maxTurns` 14–18 while writer roles carry
28–32. `awkit-qc-reviewer` sits at **18** — yet a whole-repository independent audit is the most
tool-expensive read-only job in the roster: it must read broadly precisely because it is forbidden to
take shortcuts through the implementer's own account of the work.

**Observed FACT:** two consecutive QC review attempts in one session were truncated by that ceiling
before the reviewer could report; only a follow-up message asking for the verdict alone produced one.
The budget is therefore biased against the role the architecture's independence rests on, and its
failure mode is a missing or thin verdict rather than a visible error.

Do **not** hand-edit `routing-matrix.mjs` from a project-state lease: it is not in that lease, and
every agent file under `.claude/agents/` is generated from it, so a change there forces a
regeneration of all 16 files and a `verify:agent-routing` byte-for-byte re-check. Route it as a
scoped task that owns the registry.

## FRAGILE: closing a bead breaks a QA-owned pin that the project-state lease cannot reach (2026-08-21)

`verify:roadmap-dashboard` hardcodes an exact `"N outstanding / M closed"` pair (now
`5 outstanding / 251 closed`, around line 341 of `scripts/verify-roadmap-dashboard.mjs`, updated
under a QA lease when `awkit-bkfy` closed on 2026-08-21). The pin is correct and deliberately not a
range: it is the only thing that catches a `bd close` whose export was never refreshed, because a
stale `.beads/issues.jsonl` is perfectly well-formed and no structural check can see it.

The trap is that the pin lives in a **QA-owned** file while beads are **project-state-owned**.
Under the write lease, the project-state holder can legitimately close a bead and then cannot fix the
verifier its own correct change just turned red — the lease guard blocks the edit, by design. Route a
QA lease to move the pin **in the same session as the close** (as was done for `awkit-bkfy`), or
sequence the close into a session that already holds one. Do not relax the pin to a range, and do not
work around the guard.

Two adjacent facts that cost time:

- **`bd stats` prints `Blocked: 0` for a tracker with four `blocked`-status issues.** That field
  counts dependency-blocked issues, not the `blocked` STATUS. Use `bd list --status blocked`.
- **Outstanding can rise with nothing filed.** Reopening and claiming a closed bead moves it
  backwards across the closed/outstanding line. `5 + 251` and `6 + 250` both total 256, so compare
  the *total* before reading a rise as a new defect.

## Validation (2026-08-20)

- **A requirement table keyed on step TYPE lies about any type that is really several steps.**
  `STEP_REQUIREMENTS` gives one `{requiresLocator, requiresValue}` answer per `StepType`, which is
  right for `fill` or `click` and wrong for `wait` - five different steps behind one type literal
  (`awkit-3p6x`). The flat row demanded a value from all five subtypes and a locator from none, so it
  blocked three valid configurations AND let a `selector` wait with no locator reach a runtime
  failure. The same shape was then CONFIRMED in `assertText` (`awkit-56un`, CLOSED): seven
  `assertionType` arms behind one row, where `url`/`storage` were required to carry a locator neither
  resolves and `attribute`/`storage` had their config enforced only by a throw inside
  `executeAssertion`. All three sites are now fixed. **The rule to carry forward: any node whose
  `config` selects a dispatch arm cannot be described by one row in a type-keyed table.**
- **The gate can be too PERMISSIVE as well as too strict, and that failure is worse.** Four of these
  five fixes were false positives; `condition` was the opposite (`awkit-dnbb`). `hasRequiredValue`
  accepted a `valueSource` that `FlowExecutor` never resolves, so the node reached run time with an
  empty expression - and `evaluateBoolean("")` returns **true**, so it took its true branch on every
  run. A flow that routes deterministically wrong is worse than one that refuses to start. When a
  rule accepts several channels, check that the RUNTIME reads every one of them.
- **`runFlow` is the reference implementation of a multi-channel requirement, and needs no change.**
  `resolveRunFlowTarget` mirrors `step.flowId ?? step.config?.targetFlowId` exactly, `value` and
  `valueSource` correctly do NOT satisfy it, missing targets and both cycle shapes are covered, and
  the conflicting-target case is a deliberate tested decision (the engine resolves `flowId` first to
  match the runner). Do not add a rule for the disagreement: the designer writes both fields from one
  input, and the ignored alias is inert.
- **A guarded no-op is invisible everywhere except the gate.** `performLoopAction` guards every arm
  with `if (target)`, so a `loop` whose action needs a locator it does not have runs its full
  iteration count doing nothing, reports `passed`, and records the iterations as completed
  (`awkit-njqg`). A scroll-to-element with no element quietly wheels the page instead. Neither ever
  appears in a run report, so no amount of live testing would find them - only validation can. When
  auditing an executor, read what each arm does when its input is ABSENT, not only when it is wrong.
- **A validation rule that goes red against generated test data may be right about the generator.**
  Adding the loop/scroll contracts turned `verify:validation`'s "all 54 generated flows validate
  clean" red. The corpus really was full of dead nodes: the generator emitted click-loops with no
  locator and element-scrolls with no element, because `NODE_CATALOG` marks both types as needing no
  locator - true at the TYPE level, wrong for those CONFIGS. The fix belonged in the generator, and
  relaxing either the rule or the guard would have preserved the defect and thrown away the finding.
- **The field the designer WRITES is not always the field the validator READS.** This produced a live
  false positive twice. A Fixed time Wait carries its duration in `timeoutMs`, and an Assert Text
  carries its expected value in `config.expectedValue` - both read first by the runtime, both
  invisible to `hasRequiredValue`, which knew only `step.value`/`valueSource`. The `assertText` case
  was flagging **8 of the repo's own shipped mock-site fixtures**, the same flows
  `verify:comprehensive-e2e` executes successfully - so the validator and the runner disagreed about
  the product's own test data for as long as the rule existed. When adding a value requirement, trace
  the field from the panel input through `toFlowStep` to the executor, and assert every channel.
- **When a fix relaxes a rule, the collateral risk is the OTHER branch silently relaxing too.** The
  first draft of the wait fix let `timeoutMs` satisfy the value requirement for every wait subtype -
  which would have made a `textVisible` wait with a timeout and no text "valid", because a timeout is
  how long it may look, not what it looks for. A relaxation needs a negative control per branch, not
  one per rule.
- **Two surfaces validating the same concept will drift, and the flat one wins by being wrong
  everywhere.** The renderer's `flowNodeRegistry.wait.validate` was already subtype-aware while the
  engine was not, and it had drifted in its own direction - demanding "a selector or text" from
  `navigation`/`networkIdle` waits, and excusing a `selector` wait that carried text but no selector.
  Both now read `WaitStepContract`. Prefer a shared framework-agnostic module in `src/validation/`
  over a second implementation shaped to the renderer's data type.
- **A validation gap hides two different failures, and the silent one is worse** (`awkit-jtok`,
  CLOSED). Smart Wait conditions were checked for timeouts only. Some incomplete conditions THROW
  (`waitLocator(undefined)`), which at least surfaces - but three shapes pass VACUOUSLY and look
  fine forever: `urlChanged` with neither `urlContains` nor `fromUrl` returns true on the first poll,
  `getByText("")` matches every element, and a `response` with no method and no `urlContains`
  resolves on whatever arrives first. When auditing a wait, ask what it does with NOTHING supplied,
  not just whether it errors.
- **PRESENT-but-empty is a different state from absent, and it is the common one.** The designer's
  "Add wait" scaffolds create `{ strategy: "css", value: "" }` for the user to fill in, and
  `LocatorFactory.create` only throws on `undefined` - so an empty selector sails through a presence
  check straight to Playwright. A validator that tests `!== undefined` passes the entire
  half-configured case. Mutating the check to presence-only failed 3 checks, so it is guarded.
- **Read severity off the runtime, not off intuition.** `runRequiredOrOptional` swallows an OPTIONAL
  wait condition's failure and re-throws a required one, so a malformed optional condition cannot
  fail a run and must not block it. Its check is `optional || evidence?.requirement === "optional"`
  and pointedly excludes `"advisory"` - so a hand-authored advisory with no `optional` flag really
  is required at run time. The tidier reading ("anything not required is skippable") under-reports.

## WebDriverUniversity findings (2026-08-20)

- **An install marker must die with the listeners it guards.** `document.write()` on a loaded
  document triggers an implicit `document.open()`, which removes EVERY event listener registered on
  the Window, the Document and its nodes — but leaves the Window's own properties untouched. A
  window-scoped `__awtkitCaptureInstalled` flag therefore reported "installed" for a page that was
  listening to nothing (`awkit-jw46`). Mark `document.documentElement`, which `document.open()`
  does replace. Note it is `null` at document-start on a real navigation, so the window flag stays
  as the second-install guard and the element is marked as soon as it exists.
- **`document.elementFromPoint` returns the drag ghost, not the drop target.** Every mainstream drag
  library moves the source (or an overlay) under the cursor, so the topmost hit at the release point
  is the thing being dragged (`awkit-tj2o`). Use `elementsFromPoint` and skip the source, anything
  inside it, and anything it sits inside. A fixture that does NOT move its item cannot catch this —
  `drag-lab`'s pointer sortable never did, which is why `capture-gaps` exists.
- **The browser fires no `click` when the mousedown target is removed.** A control that replaces its
  own contents on `mousedown` — jQuery's `.text()` is the common shape — produces mousedown and
  mouseup and NO click, so an unhandled gesture disappears from a recording entirely rather than
  degrading to a click (`awkit-dhdr`). Resolve to the nearest surviving ancestor and regenerate the
  locator; the destruction is itself the strongest evidence the page responded.
- **A locator candidate that is unique is not therefore good.** Selection took the first UNIQUE
  NON-fallback candidate, and the scoped `:nth-of-type(n)` selector was pushed unflagged — so a
  positional selector beat the feature-based compound selector whenever it happened to be unique,
  which for a radio group is always (`awkit-e0z6`). Anything positional must carry `fallback: true`.
- **Attribute ranking has to account for what an attribute DISTINGUISHES, not just its stability.**
  In a radio group `name` and `type` are shared by construction, so the two highest-ranked
  attributes an option carries are exactly the two that cannot tell it from its siblings.
- **A container's concatenated text is a summary, not an identity.** When offering an element's own
  text as a locator, use its own DIRECT text nodes — otherwise a wrapper gets a "stable" locator
  assembled from whatever happens to be inside it right now (`awkit-vzhy`), and a hover-trigger gate
  that depends on "positional only" silently stops testing anything.
- **Skipping a click because a fill will cover it is wrong for a READONLY field.** Its value can
  never change, so no fill is ever recorded and the click IS the interaction — which is how every
  datepicker and custom select is opened (`awkit-n4wr`).
- **Playwright's visibility check ignores overflow clipping.** A `max-height: 0; overflow: hidden`
  panel still reports VISIBLE, so an accordion's open/closed state cannot be asserted with
  `assertVisible` — assert the class or the inline `max-height` instead (WDU-C21).
- **An empty static value source satisfies a required-value rule.** `hasRequiredValue` returns true
  for any `valueSource`, so attaching `{ type: "static", value: "" }` to a step that needs a path
  makes the flow save clean and fail at replay. Omit the value source entirely when there is no
  value (`awkit-11ii`).

## WebDriverUniversity findings (2026-08-19)

- **A locator you intend to COUNT must never go through `waitLocator()`.** It appends `.first()`.
  `tableHasRows` and `listHasItems` did exactly that and were therefore capped at 1 for their whole
  lifetime (`awkit-380d`), so any `minRows`/`minItems` > 1 could never be satisfied — the wait always
  burned its full timeout and reported a count of 1. Fixed, guarded by `verify:waits` `[W-LC*]`.
- **`isVisible()` ignores the timeout you hand it.** It is an immediate check. Measured: `false`
  after 23ms against a 10s timeout on an element that appeared at 1.5s. Use
  `waitFor({ state: "visible" })` when you mean to wait (`awkit-dctr`). Anywhere `isVisible()` is
  used inside a polling loop is fine; a one-shot call with a timeout argument is a bug.
- **Attaching ANY `page.on("dialog")` listener suppresses Playwright's auto-dismiss**, even a
  listener that ignores the dialog. A handler that declines to answer therefore leaves the page
  blocked on a modal until the action times out. Anything that arms a dialog listener must answer
  every dialog it sees, explicitly dismissing the ones it does not claim.
- **Playwright's visibility model ignores `opacity`.** An element faded to `opacity: 0` with
  `visibility: visible` is VISIBLE, so `elementHidden` can never fire for it. Assert the class or
  attribute instead. Conversely `innerText` returns `""` for a `visibility: hidden` element even
  when `textContent` is populated — which is why a text assertion cannot be fooled by an invisible
  success message.
- **`verify:wdu-live` is an external-site gate.** It needs the public internet and drives a
  third-party site. Never add it to a gate that must run offline; a WDU outage is not a regression.


## RESOLVED: a focus rule that exists is not a focus indicator that paints (2026-08-19)

Found by driving the real browser on the new License Issuer page, not by reading the CSS. Two
controls were focusable with **no visible indicator at all**, and both rules looked correct:

1. **Native radio / checkbox.** Chrome does not paint a `box-shadow` on a control that keeps its UA
   appearance — the computed value comes back `rgba(0,0,0,0) 0px 0px 0px 0px`. `global.css` already
   clears the UA outline for every `input:focus-visible`, so a shadow-only rule removed the only
   indicator and replaced it with nothing. **Use an `outline` for radios and checkboxes.**
2. **Visually-hidden file input.** Its ring is drawn on the visible label via
   `.rm-issuer-file:focus-visible + .rm-issuer-file-label`, which only matches input-then-label. The
   DOM had them the other way round, so the selector never matched.

This is the same shape as the recurring `aria-modal`-without-focus-contract defect: the a11y contract
belongs to the CONCEPT, and each new component re-implements it from scratch. `.rm-issuer-radio` was
the fourth place in this repository to get keyboard focus wrong in its own way.

**Both are now guarded** by `verify:roadmap-license-issuer`, and both guards fail against the old CSS
and the old DOM order. Note the guards are static: they assert the outline and the sibling order,
which is what the browser measurement showed to be the deciding factors. A static check still cannot
prove a pixel was painted — the measurement is recorded here because it is the real evidence.

**Note for the app itself:** `global.css` clearing the UA outline for ALL inputs means every native
radio and checkbox in SpecterStudio depends on a replacement ring existing. That was not audited here.

## OPEN: two issuer implementations, one signing contract (`awkit-vf9r`, 2026-08-19)

`tools/license-issuer/issue-license.mts` re-implements serial-number generation, the license payload
shape and the issuance-history record rather than calling `LicenseIssuerService`. The in-app Issuer
console and the new dashboard bridge both call the service; the CLI does not. Nothing forces the two
to agree, so a change to canonicalisation, an added payload field, or a bounds change lands in one and
not the other — and the CLI is the looser of the two (no custody check, no key/public-key match, no
atomic write, no bounded validity).

**Do not add a third.** When touching issuance, extend the service and let callers adapt.

## FRAGILE: the roadmap dashboard server must be restarted after a `tools/roadmap` change (2026-08-19)

Routes are an explicit allowlist built at module load. A dashboard process started before a new route
existed answers plain-text `404` for it, and the page surfaces `readApiPayload`’s restart message rather
than a real error. This bit during the License Issuer work: the owner’s server on 4380 kept serving the
old allowlist while the new page was already in the browser. `server.mjs` now also honours `PORT`, so a
second instance can run beside it, but **restart `npm run roadmap` before any visual verification**.

## RESOLVED: restored Loop renderer used a stale U-route collision and fit footprint (2026-08-15)

The restored `LoopEdge` rendered the approved 160-unit capsule and 44-unit hit ring, but `FlowCanvas`
still scored and framed a roughly 80-unit-wide, full-card-height footprint derived from the rejected
36-unit U-route marker. A neighbor inside the real capsule's outer band could be invisible to side
selection, and fit-to-screen could crop the lane/ring. Because nodes paint above edges, an overlap looked
like a cut or corrupted Loop even though the isolated topology oracle was green.

`geometry.ts` now owns one full capsule/ring/hit/label footprint consumed by `LoopEdge` and `FlowCanvas`.
`LoopEdge` also caps the rendered summary to the shared 160-unit lane, uses ellipsis for overflow, and
retains the exact full text as its title. The visual oracle requires nonzero visible layers, correct
edge-below-node stacking, the hit/accessibility contract, and the measured label bound; independent
negative mutations prove each requirement can turn the gate red.
The focused GUI fixtures use a connected blocker 100 graph units from the owner, require the clear side,
complete post-fit containment, and no node/label/insert-control intersection. Workflow coverage physically
drags the blocker away and back and requires right -> left -> right recomputation without detachment.
Keep these negative controls; an open-space fixture cannot detect this regression.

The canonical broad-coverage adapter was also hardened. A killed, signalled, truncated, status-2, wrong
check-count, missing-allow-list, or unexpected-failure child now fails. The pre-capsule readers expose a
safe compatibility view for the removed direction descendants so all unrelated checks run. Sixteen exact
U-route-era compound assertions per suite may be non-binding; the focused suites independently replace
their editing, persistence, history, access, and visual intent with ordered 15/16-check contracts.

## RESOLVED: Workflow GUI verifier sampled the library before its table loaded (2026-08-15)

The preserved Workflow walkthrough waited only for the Workflows page surface, which mounts while its
async profile list still shows `Loading workflows...`. Its first layout assertion could therefore report
`workflow table not found`; an immediate run from the same source usually passed, making the failure a
real fixed-delay/startup race rather than product geometry evidence.

The verifier now waits for the exact Workflows navigation control, performs the observable navigation,
waits for the page surface, and then waits for the visible `.wl-table-workflows` that the assertion
measures. The swallowed navigation click and blind 1.2-second startup delay were removed. Keep this state
synchronization; do not replace it with another delay or allow-list this non-Loop assertion.

## SUPERSEDED RESOLUTION: Loop direction lived on the real U-route (2026-08-14)

Earlier iterations targeted the Conditional insertion control, an ordinary edge overlay, a node-obscured
ring, or a numeric marker sweep. Those implementations could satisfy DOM/keyframe checks while the real
returning connector remained visually small, static, or suggested live execution progress.

During that superseded iteration, structured self-Loops used a compact rounded U-route with a static
configuration marker, path-dash motion, and an arrow. Those details are historical and must not be used as
current acceptance criteria. The binding topology is now `LOOP_VISUAL_CONTRACT.md`: a 160x20 capsule,
dominant configured-value ring, and sweep-only circular motion with no structured-Loop direction overlay or
arrow. Legacy cross-node `loopBack` alone retains its directional return renderer.

The historical checks remain useful only for nonvisual editing, persistence, Conditional exits, undo/redo,
keyboard access, node interactions, and the separate legacy `loopBack` renderer. The canonical adapter must
retire only the exact U-route assertions and must run the current focused capsule oracle afterward.

## RESOLVED: unknown interaction prerequisites were misclassified as locator review (awkit-aek, 2026-08-08)

A proven element identity could still receive locator `needs-review` when insertion/hover provenance
was unknown. That conflated identity with actionability, produced duplicate Designer validation text,
and left no execution decision path. The states are now independent. Ordinary clicks can use a
binding-scoped Playwright actionability trial or a reasoned user confirmation; sensitive actions remain
blocked. Legacy prerequisite-only review records normalize without silently becoming executable.

## OPEN LIMIT: cross-reload reorder cannot be detected for truly evidence-identical twins (2026-08-07)

The schema and resolver support guarded positional identity, but no browser API can prove which
logical object is which after reload when two siblings have identical semantics, attributes, text,
ancestry, geometry policy, and stable application identity. Browser node/backend ids are session-local
and must not be treated as durable. In that genuinely unprovable case AWKIT can verify only the
recorded candidate set and position; applications should expose a stable business key/test id, or the
step must remain review-required. The `/recorder-lab` mutation fixture uses `data-item-key` only as a
hashed fingerprint signal (not as the Playwright-facing locator) so logical reorder is detectable.

---

## RESOLVED: `typecheck:scripts` baseline repaired (opened 2026-08-07, closed 2026-08-18)

`npm run typecheck:scripts` and `npm run verify:all-typecheck` now **pass with 0 errors**. The gate
may be cited as green.

The baseline had grown from the nine diagnostics recorded here to **13**, across six files -
`verify-blueprint-recovery.mts`, `verify-closed-shadow.mts`, `verify-frame-chain.mts`,
`verify-locator-guard.mts`, `verify-recorder-competitive.mts` and `verify-write-queue.mts`. Growth
was the predictable consequence of a red gate: nothing was checking, so new mismatches joined
quietly. That is the argument for repairing a baseline rather than documenting it.

All 13 were in verifier scripts; **no product code changed**. Four shapes:

- **TS2345 x7** - `textContent()` yields `string | null` while the detail parameter takes
  `string | undefined`. Converted with `?? undefined`.
- **TS2339 x4** (`verify-write-queue.mts`) - a `let` initialised to `null` and assigned inside a
  `.catch` callback; TypeScript's flow analysis never sees that assignment and narrows to `never`.
  Fixed by capturing the rejection **as a value** (`.then(() => null, (e) => e as NodeJS.ErrnoException)`),
  which removes the analysis problem instead of asserting past it.
- **TS2322** (`verify-recorder-competitive.mts`) - `selectOption` resolves to the selected values
  where the callback contract is `Promise<void>`; braces discard it explicitly.
- **TS2322** (`verify-blueprint-recovery.mts`) - `blueprintCapture.fingerprint` is deliberately
  `Record<string, unknown>` in `RecorderTypes.ts` (raw capture-time JSON, hashed later), and an
  interface has no implicit index signature. The fixture spreads it; the product type is untouched.

**Nothing was silenced.** No `any`, no `as any`, no `@ts-expect-error` - a suppressed diagnostic
leaves the gate green while the mismatch it reported is still there. Behaviour is unchanged: all six
affected verifiers pass at their previous counts (write-queue 29/29, blueprint-recovery 52/52,
locator-guard 35/35, frame-chain 31/31, closed-shadow 23/23, recorder-competitive 54/54).

---

## OPEN: a non-positional `needs-review` locator cannot be resolved in the app (`awkit-871`, 2026-08-04)

A recorded step whose locator is `needs-review` is refused at preflight by `locatorNeedsReview`
(`src/validation/FlowValidator.ts:460`), before any browser launches — correct, and deliberate. The
problem is the exit: the Flow Designer's approval control is gated behind `isPositionalLocator(...)`
(`app/renderer/components/workflow/FlowNodePropertiesPanel.tsx:662`), so it renders **only** for
positional locators. A step that is `needs-review` for any other reason — an ambiguous `role + name`
matching two or more elements, a closed shadow root, an unsupported cross-origin frame — gets no
resolve affordance at all. The ranked alternatives are rendered read-only; nothing adopts one.

**The workaround is a trap, which is what makes this worth writing down.** Editing the locator by
hand calls `editLocator` (`FlowNodePropertiesPanel.tsx:105`), which clears `locatorQuality`. The
visible "matches N elements" warning therefore disappears and the step *looks* repaired — but
`resolution` is never touched, so it stays `needs-review`, preflight still refuses it, and the review
chip never clears. Anyone debugging this will believe they fixed the step.

Until `awkit-871` lands, the only supported path for such a step is to re-record it and resolve it in
the Recorder's ambiguity dialog, which does offer select-candidate / scope-to-ancestor /
approve-fallback / defer.

**When fixing:** keep the positional refusal absolute for `dangerousMutation` / `externalCommit`
steps, and make sure a hand-edited locator cannot end up *looking* resolved while still blocking —
that asymmetry is the actual defect, not just the missing button.

---

## RESOLVED: bare NSIS `/S` crashes in temporary `System.dll` (`awkit-9yc`, 2026-08-04)

On the clean Windows 11 Hyper-V guest, the hash-verified `SpecterStudio Setup 0.1.5.exe` exited with
`0xC0000005` when a standard interactive user launched it with bare `/S`; Application Error 1000
identified the NSIS temporary `System.dll`. Explicit `/currentuser /S` against the same restored
snapshot and exact bytes exits zero, installs per-user with no UAC process, and launches normally.
Both installed-layout drivers now obtain that ordered argument pair from the shared helper and fail
explicitly on the crash sentinel or a missing installed executable. Keep the exact negative control
in `npm run verify:nsis-per-user-install`; a return to bare `/S` is not supported by this harness.

---

## RESOLVED: dashboard portable builds reused the current semantic version (2026-08-03)

The original dashboard action invoked `package-portable.ps1`. That script is intentionally a rebuild
pipeline, not a versioning workflow, so repeated clicks regenerated and replaced the same
`SpecterStudio 0.1.2.exe` artifact. The action now invokes the hardened `release-portable.ps1` with a
fixed patch bump and reports the version read after success. Keep rebuild-only and next-release actions
distinct: a future change must not point the dashboard back at `package-portable.ps1` unless the UI is
also renamed to say it rebuilds the current version.

---

## RESOLVED: roadmap assets could outrun the module-cached server route table (2026-08-03)

The roadmap server reads public assets from disk per request but loads `server.mjs` once. After adding
the portable-build route, an old running process could therefore serve the new button/client while still
returning plain-text `Not found` for `/api/package-portable`. The client assumed JSON and displayed
`Unexpected token 'N'`.

`dom.js` now decodes API bodies without assuming JSON. A plain-text 404 maps to “Restart the roadmap
server (npm run roadmap) to enable portable packaging,” the button stays disabled until the capability
exists, and SSE reconnect rechecks it after restart. Other non-JSON error bodies are reduced to the HTTP
status rather than reflected. Regression coverage imports the real decoder and drives valid JSON, stale
404, and internal-error controls. Future server/API changes still require a process restart; never assume
live public assets imply live server modules.

---

## Licensing dispatch latch has a deliberate 30-second maximum staleness window (2026-08-01)

`ExecutionEngine` consults an in-memory licensing latch at least every 500 ms instead of reading and
fingerprinting the license store on every dispatch tick. Startup, the 15-minute main-process watcher,
window focus, renderer revalidation, license mutation, run request, and pre-run all refresh it; an
otherwise untouched latch self-refreshes after 30 seconds. Therefore an externally changed license
file can take up to 30 seconds to stop queued promotion. This is an explicit cost/failure-surface
trade-off, not a renderer dependency. Do not remove the max-age refresh or weaken the bootstrap gate.

The current development machine's private offline-manifest key was moved with explicit owner
authorization from the OneDrive-synced repository to the approved `%LOCALAPPDATA%` release-key
directory on 2026-08-03. No private material is tracked in Git or was read/logged during the move.
`awkit-2l1` remains in progress until the owner clears the historical copy from OneDrive's online
recycle bins and version history, which local tooling cannot verify.

---

## RESOLVED verifier race: Recorder live-region check ran before the first polled action (2026-08-01)

`verify:recorder-gui` twice reported only `REC-029 recording: the action timeline is a live region`
as failed while the product still rendered `aria-live="polite"` on `.recorder-timeline`. The verifier
waited for Recorder start but not for the renderer's polling loop to receive the initial navigation
action; with no action yet, the conditional timeline did not exist. The check now waits up to 10 seconds
for the timeline's real rendering precondition before auditing its live-region ancestor. The repaired
full suite passed **166/166**. Do not weaken this into an unconditional source-text assertion.


## Release operations: offline-manifest key custody and Authenticode remain external (2026-07-28)

Offline dependency manifests are now Ed25519-signed, but the private key is intentionally local and
held outside the repository at `%LOCALAPPDATA%\SpecterStudio\release-keys\` (or supplied through
`AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY`). Release owners must back it up in an approved secret store,
control access, and define rotation/revocation. Losing it prevents packaging; exposing it invalidates
the manifest trust boundary. The shipped public key id is recorded in artifact provenance.

This signature authenticates AWKIT's dependency manifest; it is **not** Windows Authenticode.
Current portable/NSIS artifacts remain unsigned and may trigger SmartScreen. Chrome for Testing and
Playwright redistribution notices are staged in `resources/THIRD_PARTY_NOTICES.md`; final release
legal review and code-signing certificate operations remain external release responsibilities.

> **Workflow (2026-07-25):** AWKIT develops on `main` only; commits are never withheld because an
> issue below is open. Authority: `docs/ai/BRANCH_AND_COMMIT_POLICY.md`.

## Recorder ambiguity/replayability — tracked limitations (2026-08-01, epic `awkit-aui`)

These are deliberate scope boundaries of the ambiguity/hover work (Increments 5 & 7), not regressions.
They are tracked in `bd`; none are "supported behavior".

The related action-owner defect `awkit-3vh` is resolved: hover prerequisites now promote wrappers to
an actionable owner and refuse positional-only trigger locators. That guard does not infer sibling or
late-inserted triggers, so it deliberately does not close either limitation below.

- **Closed Shadow DOM is diagnostic-only by platform boundary.** Increment 6 records a known
  closed-mode host without retaining the root or exposing internal content, then marks the action
  `needs-review` with reason `closed shadow root`. Playwright cannot durably traverse the internal
  control, so execution is deliberately blocked before launch; the host is never clicked as a
  substitute.
- **Child frames without a strict captured selector are review-required.** Same-origin frames with the
  existing selector model replay normally. When the injected frame cannot provide that strict model,
  `RecorderService` retains safe frame evidence; cross-origin cases are labelled explicitly and never
  fall back to the main document. Full new frame automation remains outside Increment 6.
- **Shadow-aware enumeration is deliberately bounded.** A capture scans at most 128 roots and 10,000
  elements per generation. Reaching either limit is not treated as uniqueness: the locator is marked
  review-required with reason `shadow traversal limit reached`. This keeps large component pages
  bounded without silently ignoring duplicates beyond the scan boundary.

- **Hover: sibling/self-toggle triggers not attributed** (`awkit-vot`). Increment 5 attributes a
  hover reveal only when the click target has a hidden-at-rest *ancestor container*. A sibling/self
  trigger (`.trigger:hover + .target`) with no hidden ancestor is classified "none" (no hover step)
  rather than fabricating a trigger — so such a recorded click can still fail replay.
- **Hover: controls inserted only after hover** (`awkit-0vm`). First-seen (rest) visibility is recorded
  at the baseline scan; a control inserted into the DOM only after a hover is never seen hidden-at-rest,
  so no hover prerequisite is produced.
- **Live needs-review is not reproducible in the mock** (context for `awkit-aui.8`). The recorder's
  candidate chain always ends in a `structuralSelector` that yields a UNIQUE positional path for any
  resolvable DOM (the CR4b regression made the structural fallback serial-unique), so an in-page
  capture effectively never yields `quality.isUnique === false`. A genuine "no unique locator" case (the
  YouTube twin-"Shorts" case, where even the structural path collides) cannot be contrived in a mock
  without an artificial pathological structure. Per `awkit-aui.8` §4, the `isUnique === false →
  needs-review` mapping is therefore exercised at the responsible `buildRecordedFlow` layer inside
  `verify:recorder-ambiguity` point 4 (with the exact shape the recorder emits when structural fails),
  and a live layer is deliberately not fabricated.
- **RESOLVED 2026-08-01 — Table-row container name captured without cell spacing** (`awkit-bw9`, P2).
  Was: container-scoping a duplicate table button by the concatenated row name (`"Customer BetaEdit"`)
  failed `getByRole('row',{name})` replay because the platform accessible name is space-joined. Fixed
  in `recorderInitScript.ts` (`rowAccessibleName` joins the row's direct-child cells with a space, ARIA
  name-from-content style; card `hasText` scoping was already self-consistent and untouched). Verified
  by `verify:recorder` CR6 (capture → save/reload → fresh-page replay; whitespace/newlines; partial
  overlap; ARIA `role=row`; old no-space name as a failing negative control) and
  `verify:recorder-ambiguity` [3b].

## FLAKY: `verify:settings-runner-behaviour` — the hover-reveal Run button (2026-07-27)

**Measured on identical code, no rebuild between runs: FAIL, FAIL, FAIL, PASS.**
7 PASS / 1 FAIL three times, then **11 PASS / 0 FAIL**. Treat it as flaky, not broken — and do not
record a run as authoritative without repeating it.

The failing step is always the same: `locator.click` on `button.workflow-card-run` times out after
30s with `<span class="workflow-card-hint">…</span> intercepts pointer events`. The workflow card
cross-fades its summary layer out to expose the run controls, and until that happens the summary
keeps `pointer-events: auto`, so the hit-test lands on the hint span.

- `global.css:5411` — `.workflow-card:focus-within .workflow-card-summary { opacity: 0 }` — ungated.
- `global.css:5423` — `@media (hover: hover) and (pointer: fine)` gates the `:hover` twin that sets
  `pointer-events: none`.

**Root cause is NOT fully isolated.** A per-machine media-query mismatch was the first hypothesis and
is now doubtful — that would be deterministic, and the suite does pass. The remaining suspects are
window foreground/activation at the moment Playwright hit-tests, and the cross-fade transition not
having settled (the failing logs show `element is not stable` before the interception). It is not a
product regression: no `app/` or `src/` file changed across all four runs, the hover-reveal markup
dates from the initial commits, and the sibling `verify:reports-live-engine` scored 21/21 on the same
build in the same session.

**If it fails, re-run before concluding anything.** If it becomes persistent, prefer driving the card
through `:focus-within` — the ungated path the product already supports — over loosening the
assertion. Never make it green by weakening what it checks; this suite is what found `AWKIT-SET-006`.

## Fragile area: checks that CANNOT FAIL — seven instances, no guard (2026-07-27)

Seven assertions across this repo's verifiers have been found green while asserting **nothing**. Every
one had the same shape: a real condition with an **escape hatch** that short-circuits to `true`.

| # | suite | the shape | why it never failed |
|---|---|---|---|
| 1-3 | `verify-zvec-*` (2026-07-25) | vacuous negative control; suite-size floor below the real size | recorded further down this file |
| 4 | `verify-reports-populated-gui` | `(failures.recent ?? []).length === 0 \|\| …` | the contract had no `recent` field at all |
| 5 | `verify-reports-populated-gui` | `chromiumMemoryMb === undefined ? realCheck : true` | the fixture always defines it |
| 6 | `verify-reports-settings-a11y` | `unsorted.length === 0 \|\| …` | a single-column table satisfies it |
| 7 | `verify-packaged-validation` | `statuses.some(…) \|\| true` | **unconditionally true**, in a release gate |

**The tell:** a `check(...)` whose *condition* can be satisfied without the product doing anything.
Grep `=== undefined ?`, `.length === 0 ||`, and `|| true` **inside a check condition**.

**Two things that look like the pattern and are not:** `check("…", true)` on its own line is usually a
legitimate "control flow reached here" marker after an awaited action that would otherwise have
thrown; and `x === undefined ? "—" : …` in output formatting is not an assertion.

**The root cause is structural, not careless.** Every instance appeared in a verifier with only
**pass/fail** and no `NOT RUN` state. When a precondition can legitimately be absent and the only two
outcomes are "pass" and "invent a defect", the precondition gets folded into the condition — and the
check dies silently. Suites with a `checkSkip`/NOT RUN third state (`verify-reports-settings-a11y`,
the Oracle soak) do not develop this. **Give a new verifier three states from the start.**

**There is no guard.** A source-scan verifier over `scripts/**` for these three shapes inside a
`check(` argument list would close the class rather than the instance, the same way a scan over
`aria-modal="true"` would close the modal-contract class below.

## Fragile area: a modal contract fixed per-component instead of per-concept (2026-07-27)

**Three separate surfaces have now shipped `role="dialog"`/`aria-modal="true"` with none of the focus
machinery that declaration promises**, each found only when someone finally checked that surface:

| defect | surface | fixed |
|---|---|---|
| `AWKIT-SET-004` | `components/shared/ConfirmDialog.tsx` | 2026-07-26 |
| `AWKIT-REP-004` | `components/reports/RunDetailDrawer.tsx` | 2026-07-26 |
| `AWKIT-REC-004` | inline review dialog in `pages/Recorder.tsx` | 2026-07-27 |

Each has its own markup, so none inherited the previous fix. **Before adding any new dialog, drawer or
overlay, copy the contract, not the component:** capture the opener, move focus in, trap `Tab` and
`Shift+Tab`, dismiss on `Escape` with the *non-destructive* action, restore focus on unmount.

There is still **no guard** that fails a new `aria-modal` surface lacking this. A source-scan verifier
over `aria-modal="true"` occurrences would close the class rather than the instance.

**Related observation, not yet actioned:** `Recorder.tsx`'s protected-login handoff panel declares
`role="alertdialog"` but is an inline `<section>` that never receives focus. An `alertdialog` that is
never focused is announced by essentially no screen reader. The paused state *is* announced correctly
via the status pill (`AWKIT-REC-005`), so this is a role-choice smell rather than an information gap —
but it sits on the protected-login surface governed by `docs/ai/SECURITY.md`, so changing focus
behaviour there needs a deliberate decision, not a drive-by edit.

## Unlabelled `table-search` inputs in three remaining renderer surfaces (2026-07-27)

All four `table-search` inputs relied on `placeholder` alone for their accessible name. A placeholder
is not a name — it is not reliably announced as one and it disappears on the first keystroke.

`Recorder.tsx` is fixed (`AWKIT-REC-006`) because `REC-029` covers it. **Still unlabelled:**
`pages/DataSourceEditor.tsx`, `pages/SessionsManager.tsx`, and the shared
`components/table/TableUI.tsx` — the last of which would fix several pages at once. They were left
unchanged deliberately: no verifier currently asserts them, and changing four surfaces on the back of
a Recorder case would be untested scope creep.

## Fragile area: `@zvec/zvec` collection paths, and fakes that are more permissive than the backend

**Measured vendor constraint (do not re-derive from types):**

- `ZVecCreateAndOpen(path)` requires the path to be **ABSENT**. It throws `path validate failed` for
  *any* existing directory, empty or not.
- `ZVecOpen(path)` requires a real collection directory.
- A document **primary key** accepts only `A-Za-z0-9 - _ . @ # + =` plus a length bound.

Consequence already hit once: `createGeneration` allocates a generation with `mkdir` **without**
`recursive` — that mkdir *is* its atomic claim on the name — so every real candidate reaches the host
as an existing EMPTY directory, which can be neither created into nor opened. The rebuild path failed
at populate every time. The host now handles three cases and removes an empty directory with
`rmdirSync` (never `rm -r`, so it can only discard a directory holding nothing).

**The recurring root cause is bigger than any one of these.** A fake that is more permissive than the
real backend relocates risk rather than reducing it. Defects that survived a fully green suite for
exactly that reason, so far: an explicit `null` the binding rejects; `fetch` returning bare id
strings; a schema using `type` where the host reads `dataType`; `open` returning `{generation}` and
not `{collectionId}`; a primary key containing `:`; `fts: {}` rejected rather than match-all; and an
existing empty directory. When adding to `FakeZvecHostTransport`, model the binding's **rejections**,
not just its shapes — and when a reply shape changes, grep every reader of the removed field, because
a check reading a now-undefined field fails **open**.

## RESOLVED 2026-07-25: packaged live-CRUD coverage for Zvec

Restored by `verify:zvec-packaged-live`, which esbuilds a harness into a TEMPORARY Electron app
directory and drives the real `ZvecUtilityHostManager` against the packaged host - no production
startup hook. 35/0 against both the packaged tree and the NSIS-installed tree. Historical note
below.

### (historical) Coverage removed with the spike hook

Phase 1A removed the `AWKIT_ZVEC_SPIKE_HOST` hook from `app/main/main.ts` and the `__testAbort`
handler from the shipped host, which is correct - neither may ship. But the Phase 0D harnesses that
drove packaged CRUD, crash isolation, benchmarks and Playwright coexistence all ran *through* that
hook, so they were deleted with it.

Consequence: there is currently **no automated packaged-application test** that opens a real
collection from the installed layout. The pure logic is covered
(`verify:zvec-host-lifecycle` 52/0, `verify:zvec-generation-recovery` 31/0) and the packaged tree is
still verified structurally (`verify:zvec-packaged-assets`), but the live path is not.

Replacement needs a harness built on `ZvecUtilityHostManager` rather than a hook that bypasses
startup. The deleted harnesses remain recoverable at tag `archive/spike-zvec-phase-0-20260725`.

## RESOLVED 2026-07-25: `npm run typecheck:scripts` / `verify:all-typecheck` are GREEN

Both gates now pass with zero errors. **The previously recorded cause here was wrong**, and it is
worth knowing why, because it sent an earlier reader looking in the wrong place: this file blamed the
edge *fixtures* in `scripts/verify-branch-pairs.mts` for being `{ id: string }`. They were never
malformed — `flowEdge()` / `scenarioEdge()` always emitted `source` and `target`. The type was
erased downstream by the lookup helper:

```ts
const byId = (edges: { id: string }[], id: string) => edges.find((e) => e.id === id)!;
```

A non-generic parameter widens the RETURN type to `{ id: string }`, so all 16 errors landed on the
`flowKindOf(byId(...))` call sites rather than on the fixtures. Fixed by making `byId` generic
(`<T extends { id: string }>(edges: readonly T[], id: string): T`) and throwing on a miss instead of
`!`-asserting.

**The gate was also red in two files this entry never mentioned** (5 further errors), so fixing
`byId` alone would not have restored it:

- `scripts/verify-popup-identity.mts` — used `Parameters<typeof StepExecutor>` on a **class**. A
  class's call signature is not its constructor signature, so the type resolved to something that
  silently accepted an incomplete context object. Switching to `ConstructorParameters<...>` restored
  real checking and immediately exposed **seven missing required fields**
  (`instanceOrderNumber`, `totalInstances`, `runtimeInputs`, `instanceInputs`, `flowOutputs`, plus
  `paths.logs` / `paths.reports`) that the fixture had never supplied. Also cast `Page.listenerCount`,
  which exists at runtime but is not declared in Playwright's types.
- `scripts/verify-session-context.mts` — `assertDenied(fn: () => Promise<void>)` rejected every real
  call site, since `assertSenderPermission` resolves an `AuthorizedActor`. Widened to `Promise<unknown>`.

**Lesson:** a red aggregate gate hides more than the file named in the bug report. Re-derive the
error list from `tsc` output before trusting a recorded cause, and never conclude from a filtered
view of a failing gate.

## Damaged active-generation pointer read as "absent" — FIXED 2026-07-25 (bd `awkit-9rd`)

**This destroyed the entire semantic index, including the live generation.** `readActivePointer()`
returned `null` for four different states — pointer absent, file unreadable, JSON malformed, and
generation name invalid. `semanticService` passed that `null` through as
`authoritativeActiveGeneration`, where reconciliation reads it as *"there is no active generation,
so nothing is protected"*: the preserve-everything early return is skipped, the per-generation
`name === active` guard can never match, and on an unclean shutdown (the default whenever metadata
is also unreadable) every generation is `rm -rf`'d.

It is the **same defect class as `4ddc773`** (which stopped active identity being derived from
`metadata.json`), relocated one level up: making the pointer authoritative achieves nothing while
"unreadable" and "absent" are the same value.

**Fix:** `readActivePointerStrict` returns `ok | missing | invalid | unreadable` and validates all
three fields (`activeGeneration`, `previousGeneration`, `activatedAt`). `ReconcileOptions` now takes
a three-state `ActiveGenerationIdentity` (`known | none | unknown`) instead of `string | null`, so
the illegal collapse is unrepresentable rather than merely discouraged. Under `unknown`,
reconciliation discards, quarantines and trims **nothing**, reports `activeIdentityUnknown` +
`recoveryRequired`, and health surfaces `ACTIVE_POINTER_READ_FAILED`. Startup stays non-blocking.

**Negative-controlled:** reverting only the identity mapping to the old collapse makes the new suite
report `survivors: none` with 3072 bytes reclaimed — the data loss reproduced. Guarded by
`verify:zvec-generation-recovery` (34 → **134**).

**Bias worth keeping:** validation failure resolves toward `invalid` (preserve everything, require
recovery), never toward a usable-looking pointer. Over-preserving wastes disk; under-preserving
destroys an index that only an explicit rebuild can restore.

## RESOLVED 2026-07-25: direct push to `origin/main`

`git push origin main` was rejected with `GH013: Changes must be made through a pull request`. The
owner adjusted the ruleset bypass; the push then succeeded (`5dbe25f..3128fdf`) and `origin/main`
now equals local `main`. Branch consolidation completed afterwards, in the required order: push
main -> verify origin/main -> push archive tags -> compare each remote branch -> delete.

**Lesson worth keeping:** archive tags are worthless for preservation until they are PUSHED. They
existed only locally at first, so deleting remote branches at that point would have recreated the
same off-machine-copy risk the push had just cleared.

## Validation verifiers are not registered in package.json (2026-07-25)

`scripts/verify-validation.mts`, `scripts/verify-random-roundtrip.mts` and
`scripts/verify-packaged-validation.mts` exist and pass (125/0 and 26/0 respectively) but have no
`npm run` alias, so they are easy to miss. Pre-existing on `feature/randomized-test-lab`; not caused
by the consolidation merge.

Evidence-based. Update when a task reveals a repeated bug, fragile area, or risky assumption.

## Confirmed (observed during development)

- **Fresh install seeded bundled samples as real user records — FIXED (bd `awkit-64x`, found + fixed 2026-07-19).**
  First-run profile stores seeded from `resources/sample-workflows` etc. (`app/main/profileStores.ts`
  `seedFolder`), so a brand-new install showed "Customer Onboarding Workflow", "Login Flow", and
  `customers.json` as ordinary user records — against RULES.md "no demo/seed data — use empty states".
  **Resolution:** `seedFolder` dropped (flows + workflows) and the `ensureDefaultDataSource` /
  `ensureDefaultRuntimeInputs` first-run injectors deleted (stores return `store.list()`); samples remain in
  `resources/` via `npm run seed:mock-fixtures`. `verify:e2e-sweep` flipped to assert empty states (13/13).
  Evidence: `test-artifacts/2026-07-19-e2e-qa/screenshots/e2e-sweep/`.
- **GUI verifiers that assert shell chrome break silently when `AppFrame` changes (2026-07-19).**
  PR #21's AccountMenu replaced `.app-frame-user`/`.app-frame-logout` and the licensing placeholder;
  `verify:auth-gui` and `verify:admin-gui` kept asserting the old DOM and were broken on `main` until
  repaired in the E2E QA assessment (now 18/18 and 11/11). When touching `AppFrame`/admin chrome,
  re-run BOTH suites before merging.

- **ICO frame-offset corruption in `png-to-ico` 2.1.0 — FIXED (2026-07-16).**
  `scripts/generate-app-icon.mjs` previously passed multiple PNGs to `png-to-ico`. Its DIB writer appended
  an AND mask but omitted those bytes from each directory entry's length and the next frame's offset, so a
  nominally multi-frame ICO could point into previous-frame mask data. The generator now embeds each RGBA
  PNG directly in the ICO, calculates exact offsets, and validates frame signature/dimensions/bit depth
  before writing. The package may remain installed as an unused dev dependency, but do not reintroduce it
  into the icon path without a byte-level multi-frame validation.
- **Soak-benchmark accounting bugs — FIXED (2026-07-16), not observability defects.** In
  `scripts/benchmark-engine-soak.mts`: (1) the run-summary invariant compared `runObsSummaries` (all terminal
  runs) against `durableTerminalRuns = completed + failed` read **pre-teardown** — omitting the `cancelled`
  runs that `stopAll()` finalizes at teardown, so a healthy soak reported a spurious `runSummaries MISMATCH`.
  Now recomputed post-teardown incl. `cancelled` (verified: `4666 == 4666`, and a 40 s re-run `203/203 MATCH`).
  (2) A single NaN event-loop-delay sample (a `monitorEventLoopDelay` window with no events → `.mean` is NaN)
  poisoned `Math.max(...series)` → `peak=NaN`; now a NaN-safe `peakOf()` (corrected 30-min peak 44.5 ms). The
  run-summary finalization and leak-free teardown were always correct — only the harness's derived display was wrong.
- **Packaged-EXE observability-UI validation is a remaining release gate (2026-07-16).** The shippable `dist/`
  EXE is from 2026-07-07 — **before** the (uncommitted) observability work — so it lacks the Runtime Analytics
  observability panels; and a fresh `electron-builder` package OOMs on this 16 GB host (see the `-mx=9` note
  below). Final Phase 5 UI validation therefore used `_electron.launch` on the **current-code dev build**
  (`out/`, the production renderer bundle) with a seeded `LOCALAPPDATA` — the strongest available local method
  (`verify:runtime-analytics-gui` 36/36). Re-package on a higher-memory host and re-run the walkthrough against
  the actual EXE before declaring `PRODUCTION-READY`. Seed fixtures with `seed:observability-fixtures`.
- **Observability query latency is aggregation-bound, not sub-ms (2026-07-16).** Measured
  (`benchmark:observability-storage`): run-aggregating analytics (overview, workflow summary, capacity
  analytics, rankings, run-history deep page) are **tens-to-~500 ms P95** at 5k–50k runs — acceptable for the
  async/windowed page but the earlier "sub-millisecond" claim was wrong. Cost is JS aggregation over the
  window, not missing indexes (EXPLAIN confirms index use); do **not** add speculative indexes. Storage is
  ~3 MB/day uncapped (not ~1 MB/day), bounded in steady state by retention.
- **Shared pool over-launched browsers under concurrent dispatch — check-then-act race, FIXED (2026-07-15).**
  `SharedBrowserPool.selectOrLaunch` read the per-key browser count, then `await`ed `launch()` *before*
  registering the record, so N contexts acquired at once each saw "under cap" and launched their own browser
  (`maxBrowsers=2, concurrency=6` → **6** browsers, 1 launch key). The per-context-factory benchmark never hit
  it (contexts created serially); only the real concurrent `ExecutionEngine` dispatch path exposed it. Fixed
  by reserving the browser+context slot **atomically under the pool mutex** and creating the context outside
  the lock (rollback on failure). Peak browsers 6 → 2. Guarded by a regression test in
  `verify:shared-browser-pool` (delayed launch, 8 concurrent acquisitions, cap holds). Lesson: any
  read-count-then-await-launch pool logic must reserve the slot before releasing the mutex.
- **Playwright 1.61 `Browser` exposes no `process()` — per-browser PID attribution unavailable (2026-07-15).**
  Only `BrowserServer` and `ElectronApplication` declare `process(): ChildProcess`; a locally-launched
  `chromium.launch()` `Browser` has `typeof browser.process === "undefined"` at runtime (verified). So
  `SharedBrowserPool.browserRoots()` is always empty and **memory-based browser recycling (`browserRecycleMemoryMb`)
  ships wired but inert** — `BrowserProcessSampler` and the drain lifecycle are complete and unit-tested, but
  never fire without a root PID. It would activate unchanged if a launch path surfaced the PID (remote
  `launchServer()`+`connect`, or a future Playwright). Do not claim recycling is proven end-to-end on this stack.
  The pool's `closeReasons` telemetry confirms it: `MEMORY_THRESHOLD` is always 0; browser relaunches are
  `CONTEXT_COUNT_RECYCLE` (after `browserRecycleAfterContexts`) + `IDLE_DRAIN`/`POOL_SHUTDOWN`. Do NOT describe
  those (or falling Chromium RSS from them) as "memory-based recycling".
- **Shared pool + A8 weighted admission now default ON (2026-07-15).** `ConcurrencyConfig.ts` ships
  `useSharedBrowserPool: true`, and `workloadWeights` defaults to the resolved pool state (never on without the
  pool — Config C measured harmful). Integration verifiers now exercise the shared path by default. Turn off
  with `AWKIT_SHARED_BROWSER_POOL=0`; explicit `AWKIT_WORKLOAD_WEIGHTS` overrides either way. Not yet validated
  on a clean packaged machine or lower-spec hardware — flag as a release-gate risk.
- **Playwright headless Chromium runs as `chrome-headless-shell.exe`, NOT `chrome.exe` (2026-07-15).** Any
  process-tree / consumption sampling that filters by image name must include it. `ProcessTreeSampler`
  (`CHROMIUM_IMAGE_NAMES`) was missing it → the Chrome Consumption dashboard undercounted headless instances
  (each is 4+ helper processes). Fixed. AWKIT's default run is HEADED (`execution.ipc` `headless = request.headless ?? false`),
  so this only affected headless runs. The benchmark harness matches `Name LIKE '%chrom%'` to be safe.
- **Playwright keeps automated pages `visibilityState: visible`, so Chromium background throttling never
  engages (2026-07-15).** The 20-rep occlusion benchmark (`scripts/benchmark-occlusion.mts`) proved that
  re-enabling `--disable-background-timer-throttling` / `--disable-backgrounding-occluded-windows` /
  `--disable-renderer-backgrounding` (via selective `ignoreDefaultArgs`) yields NO CPU saving for AWKIT
  instances — even a genuinely minimized window + background tab reports `pageHidden 0%`, so page timers stay
  full-rate. Minimizing already stops the compositor (rAF 60→1/s), flooring CPU at ~1.5% in the current
  default. Trap for anyone trying to cut idle CPU via throttling: it does nothing here. (Background throttling
  was removed from the low-resource profile for this reason; kept in `custom` only.)

- **RESOLVED & ROOT-CAUSED (2026-07-11): ordinary run completions falsely tripped "browser crash rate
  high — pausing new dispatch", stranding the queue.** Symptom (from a 50-instance run): backpressure
  engaged with `Crashes 5`, `Browsers 0/2`, ~46 instances frozen `Pending`, while the host was idle
  (CPU 2.4%, Mem 48.8%). Root cause was a **browser-lifecycle ordering bug**, not real instability:
  1. In **`browserContext` isolation** (the default, shown as "Context" in the monitor) the runtime owns
     a real `Browser` (`BrowserContextFactory` non-persistent branch); `close()` calls `browser.close()`,
     which emits Playwright's `disconnected`. (Persistent-context runs were immune — no `Browser` object.)
  2. `PlaywrightRunner.executeScenario` closes the runtime **inside its own `finally`** (`closeRuntime`),
     i.e. *before* it returns to the engine — and the engine only calls `browserPool.releaseSlot(slot)`
     in *its* `finally`, *after* `executeScenario` returns. So at close time `slot.released` was still
     `false`, and `BrowserWorkerPool`'s `disconnected` handler scored the **normal** close as a crash.
  3. Every completed instance (pass *or* fail) therefore added one phantom crash to the 5-min window.
     Past `maxRecentCrashes` (default 3), `BackpressureController.admit` blocked all new dispatch. The
     failing instances here also died on "Navigate to …" (unreachable target → `navigation` class), which
     just supplied the stream of quick completions that inflated the count (5 Failed ⇒ 5 "crashes").
  - **Fix:** the runner announces intentional teardown via a new `onRuntimeClosing` option (fired in
    `closeRuntime`, covering end-of-run, cancel, and Reuse Session swap); the engine wires it to
    `BrowserWorkerPool.markExpectedClose(slot, generation)`, and the pool's `disconnected` handler skips
    crash-counting when `slot.expectedCloseGeneration === generation`. Genuine crashes are unaffected — a
    mid-run disconnect with no signal, a page `crash` event, and the engine's explicit `browser-crash`
    classification all still count — and the signal is **generation-scoped** so a later generation's real
    crash after a swap is still counted. Guarded by `verify:browser-pool` Part E (16/16).
  - **Fragile area to respect:** `executeScenario` owns the browser close (in its `finally`) and it runs
    **before** the engine releases the pool slot. Any future change to crash accounting must not assume
    `slot.released` is set at close time.

- **Compound/container locators (2026-07-11) — two design assumptions to keep in mind.**
  1. **Manual locator edits keep the Recorder's `alternatives`/`context`** (approved default). Because
     `LocatorFactory` resolves the primary *and* alternatives inside `context.container`, hand-authoring
     a globally-scoped primary on a step that still carries a recorded container can mis-scope it (the
     container narrows it to the wrong/zero match). If a manual locator misbehaves, clear the strategy or
     re-record. Only the `quality` badge is cleared on value/name edits; container/alternatives persist.
  2. **Runtime self-healing never guesses.** `LocatorFactory.narrowToActionable` only resolves an
     ambiguous match when exactly one is visible/enabled/in-viewport; two+ equally-actionable twins fail
     with the friendly diagnostic by design (clicking the wrong twin is worse). It only turns failures
     into successes — it never changes which element an already-unambiguous step resolves to.

- **Phase 5 packaged-walkthrough findings (2026-07-06) — read before writing any script that drives
  the packaged app.** Discovered while building `npm run verify:packaged-walkthrough` (five
  calibration runs against the real `dist/win-unpacked` EXE):
  1. **The packaged `WebFlow Studio.exe` that gets spawned is a LAUNCHER STUB** — the real Electron
     main process is its *child* (verified: Playwright `app.process().pid` ≠
     `app.evaluate(() => process.pid)`). Killing the stub (Node `process.kill`, `taskkill` on the
     spawned pid) leaves the real app alive as a **zombie with an open window** — two such zombies
     were produced before this was understood. Any kill/restart/orphan test MUST target the real
     main pid from `app.evaluate(() => process.pid)`. Bundled-Chromium browser processes are
     children of the real main, not the stub, so process-tree accounting must use that pid too.
  2. **When the REAL main process dies, orphaned bundled-Chromium browsers self-exit** (observed
     cleanly in the final walkthrough runs) — the earlier "8 leaked chrome processes" observation
     was an artifact of killing only the stub. Startup recovery then classifies the interrupted
     safe run `orphaned`/recoverable with a note; a run whose browser is closed under a live app
     instead fails normally with `errorClass: context-closed` and is NOT a recovery case.
  3. **Bundled Chromium Google-service startup egress — RESOLVED by Phase 5.1C hardening
     (2026-07-07).** The original Phase 5 finding: every bundled-Chromium launch emitted a short
     burst of non-loopback Google-service TCP connections (4–5 endpoints in 142.250–251.\*/216.239.\*,
     path-attributed to `resources/browsers/chromium/chrome.exe`) under plain Playwright launch
     options; app data itself always stayed on loopback. The follow-up named here (explicit
     kill-switch flags in the launch path) was implemented as `src/runner/ChromiumHardening.ts`
     (`buildChromiumHardeningArgs`, wired into `BrowserContextFactory` + the recorder): background-service
     switches + a `--disable-features` superset of Playwright's list + `--host-resolver-rules` mapping the
     emitting service hosts (GCM/mtalk, component/variations updaters, safebrowsing, optimization hints,
     time.google.com, gvt1) to loopback + gaia/search-preconnect redirects. Proven: `verify:chromium-hardening`
     13/13 (bundled Chromium made ZERO non-loopback connections over a 20 s idle window while external
     navigation still worked) and `AWKIT_WALKTHROUGH_STRICT_NET=1 npm run verify:packaged-walkthrough` 70/70
     (strict no-egress passes in the packaged app). Toggle off with `AWKIT_CHROMIUM_OFFLINE_HARDENING=false`.
     NOTE: this hardening is for AWKIT-owned automation/recorder browsers only — it is never applied to the
     user's real Chrome in `SessionCaptureService` (protected-login handoff must stay a plain browser).
  4. **`execution:runWorkflow` only VALIDATES unless `dryRun: false` is passed explicitly**
     (`request.dryRun !== false` gate in `app/main/ipc/execution.ipc.ts`) — the UI always passes
     it; programmatic drivers that forget it get `status: "validated"` and no run.
  5. **Instance ids are decorated:** `instance.executionId` is the raw run UUID, but
     `instance.instanceId` is `<profileId>-<timestamp>-<hash>-i<N>` (`InstanceManager.
     createExecutionId`); artifact folders under `instances/`/`logs/`/`screenshots/` use the
     DECORATED id while `reports/<rawExecutionId>.json` uses the raw one. Match instances by
     `executionId` equality + `instanceId.endsWith("-i<N>")`, never by reconstructing the prefix.
  6. **The mock site binds `127.0.0.1` and Node 18 resolves `localhost` to `::1` first**, so a
     Node-side readiness probe against `http://localhost:4321` reports the server down while
     browsers (which try both families) connect fine. Probe `http://127.0.0.1:<port>` explicitly.

- **Packaging the final EXEs OOMs at 7-Zip `-mx=9` on low-memory machines (2026-07-07).** On this
  16 GB dev machine (with heavy memory-compression pressure), `npm run package:portable` /
  `package:nsis` rebuilt `dist/win-unpacked` successfully but `7za a -mx=9` (max compression of the
  ~1.2 GB payload) failed with `ERROR: Can't allocate required memory!`, so the portable/NSIS
  single-file EXEs were **not** produced — the old ones stayed on disk. Two consequences:
  1. **The wrappers masked the failure.** `scripts/package-portable.ps1` /
     `package-per-user-installer.ps1` used `$ErrorActionPreference="Stop"`, which does NOT trip on a
     native-exe non-zero exit in PowerShell 5.1, then printed "… created under dist/." and exited 0 —
     a silent false success that leaves a **stale EXE wrapping the previous app.asar**. Both scripts
     were **fixed** to `throw` on a non-zero `$LASTEXITCODE`. Always check the app.asar mtime vs. your
     source changes before trusting a packaged EXE.
  2. **Workaround used:** a one-off `npx electron-builder --win <portable|nsis> -c.compression=store`
     (no committed-config change) avoids the `-mx=9` allocation and produces a functional but
     **uncompressed (~1.2 GB) EXE** that wraps the hardened payload — fine for validation, not for
     distribution. A shippable max-compressed + code-signed build must be produced on a
     higher-memory machine (or with `"compression": "normal"` in `electron-builder.json`).
  All packaged verifiers (`verify:packaged-runtime`, `verify:packaged-walkthrough`) drive
  `dist/win-unpacked` directly, so they validate the hardened payload regardless of the final-EXE wrap.

- **Concurrency defaults throttle instance throughput (2026-07-06) — intentional, not a bug.** The new
  browser worker pool caps live Chromium processes at `AWKIT_MAX_BROWSERS` (default **2**) and active flows
  at `AWKIT_MAX_ACTIVE_FLOWS` (default **4**), so a run configured with `maxConcurrentInstances` above the
  cap queues the extra instances (they start as slots free up) instead of launching unbounded browsers.
  Backpressure also blocks new dispatch on low host memory (`AWKIT_MIN_FREE_MEMORY_MB`, default 512) and
  high crash rate — the reason is logged (`[backpressure] …`) and visible in
  `ExecutionEngine.getCapacitySnapshot()`. Raise the env limits for machines that can handle more.
  **Retry behavior also changed:** a step's `retry.count` only re-runs transient failure classes
  (navigation/timeout/locator/download); steps whose name/value contains submit/approve/delete/send/pay/
  confirm-style keywords, and dead browser/context/page failures, are never auto-retried (the block reason
  is logged). In-process persistent-profile reuse now fails fast with `ProfileLockedError` instead of racing
  two launches on one `userDataDir`.
  **Phase 2 additions (2026-07-06):** instances sharing one target origin/account also queue beyond
  `AWKIT_MAX_PER_ORIGIN` (2) / `AWKIT_MAX_PER_ACCOUNT` (1); failing engine-run steps save a Playwright
  trace zip + full-page screenshot by default (disable per step with `onFailure.screenshot: false`, or
  traces globally with `AWKIT_TRACE_MODE=off`) — expect extra files under the instance's
  `traces/`/screenshots dirs. **Single-process caveats (by design, documented):** locks/pool/watchdog
  live in the Electron main process only — a second app instance is not coordinated (profiles still
  protected cross-process by Chrome `Singleton*` artifacts); `stopInstance` marks cancelled but does not
  kill the in-flight browser (slot frees when the runner notices); dangerous-mutation detection is an
  English keyword heuristic; origin claims derive from `baseUrl`/first `goto` only (mid-flow cross-origin
  navigation is not re-claimed). See `docs/ai/CONCURRENCY_PHASE2_REVIEW.md` for the full audit.
  **Phase 3 (2026-07-06) resolved most of those single-process caveats:** profiles are now protected
  **cross-process** by the durable wx-file lock store (plus `Singleton*` artifacts for external browsers);
  `stopInstance` now HARD-cancels (closes the live browser; runs end `cancelled`); the keyword heuristic
  is only a fallback behind explicit `FlowStep.safety` metadata + node-type defaults; mid-flow
  cross-origin navigation re-claims `origin:*`; backpressure samples CPU/system/process memory.
  **New Phase 3 caveats (by design — see `docs/ai/PHASE3_DURABLE_RUNTIME.md`):** the SQLite runtime store
  uses `sql.js` (WASM) with atomic-rename persistence — a hard kill can lose the last ≤300ms of
  non-critical writes, and the DB is single-writer per app process; unknown/custom step types are no
  longer auto-retried (conservative default — add explicit `safety` metadata to opt in); a saturated new
  origin mid-flow fails that step with a retryable timeout; **packaged builds must ship
  `node_modules/sql.js`** — RESOLVED in Phase 4 (2026-07-06): the manifest generator/validators now
  require `sqlJsRuntimeIncluded`/`sqlJsWasmIncluded`, `electron-builder.json` lists the dist WASM
  explicitly, portable + NSIS EXEs were rebuilt, and `npm run verify:packaged-runtime` (24/24)
  proves the WASM loads inside the packaged main process (see `docs/ai/PHASE4_RELEASE_HARDENING.md`).
  **Trap (Phase 4):** the manifest policy (`validateDependencyManifestPolicy`) now FAILS a manifest
  without the sql.js flags — never ship a stale `resources/dependency-manifest.json` with a new EXE
  (both packaging scripts regenerate it automatically).

- **Windows `wx`-create vs concurrent unlink race in durable locks (2026-07-06, fixed — don't
  reintroduce).** Found by `npm run verify:stress:locks`: creating `holder.lock` with the `wx` flag
  while another release is unlinking the same path surfaces as **`EPERM`/`EBUSY`** on Windows, not
  `EEXIST`. `DurableLockStore.acquireExclusive` treats those codes as contention (retry once → clean
  `null` denial). Don't revert to rethrowing every non-`EEXIST` code — under cross-process churn it
  turned lock contention into an exception at the call site.
- **`verify:durable-locks` can flake under heavy host load (observed once, 2026-07-06).** Part B
  ("parent denied the 3rd unit") failed exactly once while `electron-builder` was saturating the CPU
  in parallel (the spawned child's semaphore units apparently landed late); an immediate re-run
  passed 17/17. If it fails, re-run it on an idle machine before treating it as a regression — the
  verifier spawns a real second process and is timing-sensitive.

- **Conditional/parallel connectors are a two-port branch PAIR (2026-07-03) — invariant, now fully
  GUI-verified.** A node's source (right) side is either a single `normal-out` port or a same-kind branch
  pair (`<kind>-out-0/1`, max 2 connectors), never a mix — enforced by construction (the UI only exposes
  the current mode's ports) and `reconcileBranchConnectors` (`connectorStyle.ts`), which slots each pair and
  reverts a lone survivor to Normal on deletion. **Trap:** do NOT collapse the per-slot handles back to a
  single shared `conditional-out`/`parallel-out` handle — that reintroduces the old bug where two branch
  connectors overlapped and "only one worked". **React Flow dynamic-handle trap:** when port visibility
  changes, node components must call `useUpdateNodeInternals(id)`; without it the ports render visually but
  real drag-connections can miss the new handles. Verified by `npm run verify:flow-designer` **18/18**,
  including a real drag from `conditional-out-1` to create the second branch and deletion of one branch to
  confirm the survivor auto-reverts to Normal.
- **RESOLVED & ROOT-CAUSED (2026-07-03): the `npm run dev` "Electron launch crash" was `ELECTRON_RUN_AS_NODE=1`
  in the agent/sandbox environment — NOT a Node/Electron version mismatch or an ESM/CJS code bug.** Three
  earlier sessions misdiagnosed this. `ELECTRON_RUN_AS_NODE=1` makes the Electron binary boot as plain
  Node.js (skipping all Electron init): `require("electron")` returns the binary *path string* (no `app`/
  `BrowserWindow`), and an ESM main entry gets loaded by bare Node — which is what produced `TypeError:
  Cannot read properties of undefined (reading 'exports')` in `node:internal/modules/esm/translators` and
  the `Node.js v20.18.3` trace (Electron's bundled Node running as node). Diagnosis: `env | grep -i electron`
  → `ELECTRON_RUN_AS_NODE=1`; clearing it (`unset ELECTRON_RUN_AS_NODE` / `Remove-Item Env:ELECTRON_RUN_AS_NODE`)
  and launching makes the GUI window open normally. **Fix in-repo:** `npm run dev` now runs
  `node scripts/dev.mjs`, which deletes `ELECTRON_RUN_AS_NODE` from the child env before spawning
  `electron-vite dev` (a no-op on normal machines where it isn't set). Note: switching the main process
  to CommonJS was explored and then reverted — the ESM main launches fine once the env var is cleared, so
  the module format was never the problem. If you see this crash, check `ELECTRON_RUN_AS_NODE` first.
- **Node cards with `overflow: hidden` + `position: relative` clip child React Flow handles (2026-07-03,
  fixed).** The prior bugfix added `position: relative` to `.action-flow-node`/`.scenario-flow-node` (to
  anchor the loop button). Combined with the cards' pre-existing `overflow: hidden`, that made the card the
  offset parent for the `<Handle>` elements rendered *inside* it — and the edge-hugging handles (which sit
  half outside the card box via `translate(-50%, …)`) got **clipped**, i.e. "port rendering corrupted".
  Fix: render the handles as **siblings** of the `<article>` (not children) so they position against the
  un-clipped `.react-flow__node` wrapper. **Trap to remember:** custom React Flow node components must not
  put `<Handle>`s inside an element that both establishes a containing block (`position: relative/absolute`)
  and clips (`overflow: hidden`) — keep handles as siblings of the clipped card.
- **Loop connector redesigned to a top port + semicircle (2026-07-03) — supersedes the right-side loop
  anchors below; NOW GUI-VERIFIED (13/13).** After a GUI test, the previous invisible right-side co-located
  loop anchors were found not to reliably render/attach (they were gated behind `flags.loop`, which only
  becomes true *after* the edge exists) and the sideways arc overlapped the node so the loop read as "not
  created / not deletable". Replaced with a dedicated **top** `loop-out`/`loop-in` handle pair
  (`ConnectorLoopPort`, always present so the edge attaches immediately, visible only when a loop exists),
  and `SelfLoopEdge` now detects the self-loop via `source === target` and draws a **semicircle above** the
  node. The node loop button became an add/remove **toggle** (reliable delete path). `onConnect` in both
  canvases now forces new connectors to Conditional when the source node has a self-loop. Backward
  compatible (same handle ids). **Verified in the real Electron app on BOTH canvases** via
  `npm run verify:flow-designer` (Flow Designer 18/18, `scripts/verify-flow-designer-gui.mjs`) and
  `npm run verify:workflow-builder` (Workflow Builder `.scenario-flow-node`,
  `scripts/verify-workflow-builder-gui.mjs`) — Playwright `_electron`, **13/13 each**: ports render
  un-clipped as card siblings, Add Loop creates a visible edge, the top loop port becomes visible on the
  node's top edge, the loop draws as a semicircle above the node, the button toggles to Remove and deletes
  the edge (top port hides), and a loop node locks its outgoing connectors to Conditional (properties
  panel / Link Type selector).
- **[SUPERSEDED by the two entries above] Connector ports/loop button fixed after user-reported GUI bugs
  (2026-07-03) — still not visually confirmed.** A user manually testing the Flow Designer/Workflow Builder
  (after the AWKIT points 1–5 work below was merged typecheck/build-only) found three real bugs, now fixed
  in code but only
  typecheck/build/`verify:runner`-verified (see the Node 20 dev-launch issue above for why): (1) the
  Loop kind selector was unusable because it required a manual drag-connect of a node to itself —
  replaced with a dedicated "Add loop" button (small circular icon, top-right of the node) in both
  `ActionFlowNode.tsx` and `ScenarioFlowNode.tsx` that programmatically creates the self-loop edge;
  (2) dragging a new connector from a conditional/parallel port did nothing useful — both canvases'
  `onConnect` ignored `connection.sourceHandle`/`targetHandle` and always created a "normal" edge
  snapped to the normal port; fixed via `connectorPortKindFromHandle()` in `connectorStyle.ts`; (3)
  conditional/parallel ports on the same side were hardcoded to `top: 30%`/`70%` instead of centering
  as a group — fixed via `portPositions(count)`. Separately, `portHandlesForKind("loop")` used to reuse
  the always-present `normal-out`/`normal-in` handles, which sit on **opposite sides** of the node, so
  `SelfLoopEdge`'s `isSelf` check never fired and a self-loop rendered as a giant arc instead of a tight
  circular/retry-icon shape — fixed with a dedicated co-located `loop-out`/`loop-in` handle pair (both
  `Position.Right`, same offset, invisible/`pointer-events:none`). **The actual drag/click interactions
  and the rendered arc/port positions have not been eyeballed in a running app** — do the manual GUI
  check before calling this done.
- **Structured connector model implemented (checkpoint B) — with scoped limits.** `ConditionalConnectorConfig`,
  `ParallelConnectorConfig`, and `LoopConnectorConfig` now drive routing/execution/UI/validation. Remaining
  gaps: (a) parallel `sharedPage` mode (default) is sequential fan-out; `isolatedPage` mode runs branches
  concurrently but isolated `failFast` only reports failure after in-flight branches settle (no hard-abort);
  (b) loop connectors repeat a **single node** (themselves — see below), not an arbitrary multi-node branch.
  (The loop `dataSource` dropdown and live-report connector events are implemented.) Legacy expression-based
  edges remain fully supported.
- **RESOLVED (2026-08-11): Loop connectors are fully authorable self-loops; connector-structure rules
  block Run, not draft Save (AWKIT points 1–5).** A `loop`-kind
  connector's source and target must now be the **same node** (`validateConnectorStructure` in
  `src/profiles/FlowProfile.ts`, enforced by `FlowExecutor.executeFlow` at the top of every run, and by
  `connectorStructureIssues`/`scenarioConnectorStructureIssues` in the Flow Designer/Workflow Builder, which
  surface draft advisories). The legacy `loopBack` edge type (Enhanced Connectors, Phase 1) is **exempt** — it remains an
  intentional cross-node back-edge; only the new structured `loop` kind is self-only. `FlowExecutor`'s main
  loop now detects a self-loop edge on the current node *before* its normal single execution and runs the
  whole loop in place via `executeLoopConnector`, then continues via the node's own (Conditional) exit edge.
  Two more structural rules are enforced the same way: a node may have **at most one standard
  (non-conditional/non-parallel) outgoing connector**, and a node with a self-loop **forces every other
  outgoing connector to be Conditional**. Both designers now select/open a complete Loop editor on create,
  persist the mode/bound/parameter/delay/data binding/while condition, and promote an existing Standard exit
  to an always-taken Conditional exit. An invalid loaded Standard exit remains editable for manual repair.
  **Canvas/runtime parity:** the in-house canvas derives connector visuals without persisting a second
  routing model; `EdgeVisualStyle.shape: "circular"` selects its shared `LoopEdge` arc. Workflow structure
  rules also run through `FlowDependencyResolver`/`ScenarioOrchestrator`, so an invalid saved draft fails
  validation before execution. **Workflow Builder scope:** `ScenarioLink`/`WorkflowEdge` still derive
  kind from `type`, but now persist `LoopConnectorConfig` and `maxLoopCount`. `PlaywrightRunner` executes
  workflow loops with the shared count/list/data-source/while value materialization, condition evaluation,
  runtime-input injection, and canonical bound before taking a Conditional exit.
- **Parallel `sharedPage` mode is sequential fan-out (by design).** `FlowExecutor.executeParallelTargets`
  runs each branch one-after-another on the current page — this is the shared-page safety guard (no concurrent
  UI mutation). Concurrency is available via `isolatedPage` mode (`executeParallelIsolated`): each branch runs
  on its own page in the shared browser context (shared session, independent DOM), bounded by `maxConcurrency`.
- **RESOLVED (2026-07-05): Reuse Session browser swap no longer dies after relaunch.** The in-app failure
  was a lifecycle/reference bug, not a bad saved profile: `runStepWithWaits` restored the pre-swap active
  page after `Auto Secure Login` / `Reuse Session`, so the next `Navigate` could run against an old closed
  page/context; stale lifecycle events and cleanup also lacked generation guards. `PlaywrightRunner` now
  performs a generation-guarded two-phase persistent-context swap, re-points the live `StepExecutor` to a
  page from the new context, closes the old generation with an explicit reason, ignores stale old-generation
  page/context/browser close/disconnect events, blocks duplicate swaps, checks profile lock artifacts before
  launch, and verifies the new runtime remains alive for at least 2 seconds. `StepExecutor` liveness-checks
  the browser/page before every step and does not restore the old active page after session-swap steps.
  `ExecutionEngine` no longer leaves an unhandled rejection from fire-and-forget `.finally()` cleanup.
  Real Electron `Smart-Rec-Chatgpt` verification on 2026-07-05: `Reuse Session` succeeded, `Navigate to
  https://chat.openai.com` succeeded, and there was no `Target page, context or browser has been closed`.
  Trap: do **not** add a `createdBy: awkit-playwright` guard or block `manualChromeHandoff` profiles; real
  Chrome/Edge session capture is the protected-login design.
- **RESOLVED (2026-07-05): workflow protected-login capture must not inherit navigation/action timeouts.**
  Auto-detected Protected Login Handoff can run immediately after a `goto`, whose `timeoutMs` is an action
  timeout, not a human-login window. Reusing it made the normal Chrome/Edge session-capture window time out
  while the user was still logging in. `StepExecutor.captureProtectedLoginSession` now uses
  `config.handoffTimeoutMs` only, with the default 10 minutes when unset and `0` disabling the timeout for
  explicit Protected Login Handoff nodes. Trap: do **not** re-couple protected-login session capture to
  `step.timeoutMs`; keep action/browser timeouts separate from human handoff timeouts.
- **Clean-machine GUI walkthrough not done.** The offline-VM walkthrough in
  `docs/OFFLINE_STANDALONE_PACKAGING.md` is the production-ready gate and has not been run.
- **EXEs are unsigned.** `electron-builder` reports "signing is skipped"; Windows SmartScreen will
  warn on first launch. No code-signing is configured.
- **RESOLVED (2026-07-03): manual/protected-login handoff no longer dead-ends.** `StepExecutor` now pauses
  through the shared `ManualHandoffController` and waits inside the live runner/browser instead of returning
  terminal `manualHandoff` to `PlaywrightRunner.executeScenario`. `ExecutionEngine` surfaces
  `waitingForManualAction` from live progress, keeps the queue active, and exposes Continue (`resumeInstance`)
  plus in-place Retry Detection (`retryHandoff`); Cancel resolves the pending controller promise and closes
  the browser through the normal runner `finally`. Verified by `npm run verify:runner` (manual handoff pauses
  without finishing the scenario, resumes in place, and runs the next browser step). **Trap:** do not map
  Retry Detection back to `repeatInstance`, and do not treat `waitingForManualAction` as terminal while a
  runner promise is still alive.
- **PowerShell-written JSON + BOM.** `Set-Content -Encoding UTF8` (Windows PowerShell 5.1) writes a
  UTF-8 BOM that breaks Node `JSON.parse`. This already bit the dependency manifest twice
  (manifest "missing/invalid JSON"). Generator now writes BOM-free and loaders strip a leading BOM —
  keep this in mind for any new PowerShell-generated JSON the app reads.
- **`@playwright/test` runner needs Node ≥18.19.** On Node 18.16 it errors loading the TS/ESM
  config (`Unknown file extension ".ts"`). Use `npm run verify:runner` (tsx) instead.
- **Rename ripple risk.** The product rename (Playwright Flow Studio → WebFlow Studio) touched the
  window title, manifests (+validators in PS and TS), runtime data root, and appId. The validators
  must agree on `WebFlow Studio`; a missed validator previously failed the packaged startup gate.

## Fragile areas (handle with care)

- **Node Palette is a fixed-row CSS grid — keep `grid-template-rows` in sync with its children.**
  `.flow-node-palette` uses `grid-template-rows: auto auto minmax(0, 1fr)` for its three direct children
  (header / search bar / scrollable list). Adding/removing a direct child without updating the row count
  pushes a child into the `1fr` track and stretches it (this corrupted the search bar once). The search
  input must stay an `auto` row; only the list gets `minmax(0,1fr)` so `overflow:auto` works.
- **`<td>`/`table` must keep table display for column alignment.** A global `table { display:block }`
  rule exists (for legacy horizontal scroll); `.instance-table` overrides it with `display:table` so
  `table-layout:fixed` + `<colgroup>` align columns. Never put `display:grid`/`flex` on a `<td>` (e.g.
  `.instance-name-cell`) — it drops the cell from the column model and shifts every column. Stack
  multi-line cell content with block children instead; scroll via the `.instance-table-wrapper`.

- **Live Report modal: freeze time + stop polling on terminal state (FIXED — don't reintroduce).**
  The Instance Monitor re-renders the modal ~every 1s (its instance poll). Deriving `now = new Date()`
  each render made the banner "Updated" value tick forever, even after the run ended. For terminal
  statuses (`completed/done/succeeded/failed/cancelled/skipped/stopped/error`) the model now uses a stable
  `updatedAt` (`scenario.endedAt ?? instance.endedAt ?? snapshot.updatedAt`) and shows a fixed "Last
  updated" time; only active runs show live relative time. The modal's own `reports.get` interval must run
  **only while live**, be cleared on close/unmount, and do a single delayed final fetch after the terminal
  transition — never leave a per-modal interval running. Failed steps show a friendly message; the raw
  error is masked (`safeTechnicalError`) and shown only on hover — never render raw errors/JSON/secrets in
  the main UI.
- **Bundled-browser path coupling.** The packaged path is `process.resourcesPath/resources/...`
  (note the double `resources/resources`) and must match `getResourcesRoot()` + `BundledBrowserResolver`.
  In packaged builds `playwright-core` ends up **nested** under `playwright/node_modules` (asar-unpacked).
- **Settings deep-merge.** `uiSettings.ts` deep-merges known groups; adding a new settings group means
  updating `hydrate`/`mergePatch` and defaults, or partial updates will drop fields.
- **Connector conditions fail silently.** A condition referencing a non-existent output resolves to
  `undefined` → false → the branch is skipped (falls through to success/always/next). Typos don't error.
- **Runner ↔ main coupling.** `src/runner/ExecutionEngine` imports `app/main/appPaths`; keep that the
  only renderer/main bridge or you risk import cycles in the "framework-agnostic" core.
- **Dirty-state must ignore React Flow's measurement churn (FIXED — don't reintroduce).** React Flow
  emits `dimensions` node changes during its initial measurement and elevates selected nodes in the
  array. The unsaved-changes flag must NOT key off raw `onNodesChange` events or array order, or the
  dialog fires on open/selection. Both editors now derive `isDirty` from an order-independent
  serialization of the *saveable* document (`serializeFlowDoc`/`serializeWorkflowDoc`, id-sorted)
  compared to a baseline captured on load and reset on save. Don't go back to a string-state heuristic
  or a `handleNodesChange` dirty toggle.
- **Data-source files vs profile metadata (FIXED — don't reintroduce).** The data-source
  `JsonProfileStore` writes profile metadata as `<dataSources>/<id>.json` and reads every top-level
  `*.json` there as a profile. User data files must therefore NOT be written to that folder's top
  level — they live in `<dataSources>/files/`. Writing a data file named `<id>.json` to the store
  folder previously let `store.import` overwrite the array with the profile object (editor then
  showed "not a root array of objects"). See `app/main/ipc/dataSource.ipc.ts` (`dataFilesDir`,
  `resolveDataFile`).

## Risky assumptions / to verify

- **Oracle: the real UCP path has never linked against real jars or opened a real connection.** This is the
  Oracle feature's highest residual risk. `OracleUcpQueryExecutor` lives in the gated
  `oracle-jdbc-bridge/src/main/java-oracle/` source set, which compiles only when ojdbc/ucp are vendored —
  and they cannot be vendored here (build-time network is blocked). It IS stub-compiled against the real
  JDK `java.sql` on every `verify:oracle-bridge-real-build`, so its JDBC usage and internal signatures are
  validated; the **UCP API shape is not**. Specifically unverified: whether real UCP method signatures match
  (e.g. `setConnectionWaitTimeout(int)` vs. newer Duration-based setters), real pool lifecycle/teardown
  semantics, and real ORA-code → error-category mappings. Do not assume the executor works because it
  "compiles" — the compile is against stubs. Clear via `ORACLE_JDBC_VALIDATION_GATES.md`.
- **Oracle: everything green is green against a MOCK executor.** 218 checks pass with no database. They
  prove the protocol, SQL gate, cancellation, timeout, limits, lazy resolution, and fail-closed policy —
  they prove nothing about real driver connectivity, real pooling under load, or real latency. Treat
  `INTEGRATION-CANDIDATE` literally.
- **Oracle: `MockQueryExecutor` must never become reachable in a packaged build.** Three layers enforce
  this (resolver env, manager handshake, Java `Main`). If you touch `OracleRuntimeResolver`,
  `OracleJdbcBridgeManager.start()`, or `Main.selectExecutor()`, re-run `verify:oracle-runtime` +
  `verify:oracle-packaging` — they exist specifically to catch a regression here. The original bug was
  exactly this: `oracleService` forced the mock flag on any missing driver with no packaged guard.
- **CI does not run on stacked PRs.** `.github/workflows/ci.yml` triggers only on `push`/`pull_request` to
  `main`, so a PR based on another branch gets **no checks at all**, and `mergeStateStatus=CLEAN` then means
  "nothing blocking", not "verified". PR #12 merged this way (verified locally instead). Verify stacked PRs
  locally, or retarget to `main` and wait for CI, before trusting a green-looking merge state.
- **Recorder data (actions + captured URLs) is in-memory and session-scoped.** `RecorderService` keeps
  `actions` and `recordedUrls` in the main-process singleton for the current start→stop session; they
  survive navigating away/back to the Recording screen but NOT an app restart (same as recorded actions).
  Captured URLs mask sensitive query values (`maskUrl`) BEFORE storage — never store/log raw tokens. If a
  future task needs persistence, add a JSON store (don't assume it exists today).
- **Saved sessions are sensitive plaintext local files.** The Save Session node writes Playwright
  `storageState` (cookies + localStorage) under `%LOCALAPPDATA%/WebFlow Studio/sessions/`. There is no
  encryption — they are protected only by the user profile's filesystem permissions. Never commit them,
  never write them into `resources/`/`app.asar`/source, and never log their contents. A complementary
  **Load Session** node is future work (not implemented; no no-op button shown).
- **Connector `style` is optional + normalized.** `normalizeEdgeStyle` drops invalid color/shape/line/
  thickness/arrow values, and `hasCustomStyle` strips empty styles on save, so legacy edges without
  `style` keep type-default visuals. Both designers must keep using `buildConnectorVisual` (don't inline
  edge styling) or the two canvases will drift again.

- **Instance Monitor "Clear Completed" must remove from the backend pool (FIXED — don't reintroduce).**
  The monitor re-fetches `executions.list()` every 1s, so filtering only local React state let cleared
  rows reappear on the next poll. Clear Completed now calls `executions.removeInstance` for each terminal
  instance (the engine refuses to remove active ones). Don't revert to a local-only filter.
- **Route Change page-switch is per-StepExecutor.** `activePage` switches affect the current flow's
  StepExecutor only; a Route Change inside a child flow doesn't change the parent flow's active page.
  Fine for the intended within-flow tab-switch use case.
- **Instance ids must stay globally unique (don't revert).** `InstancePool` keys by `instanceId`;
  `InstanceManager` mints `${executionId}-i${n}`. Reverting to `instance-${n}` would let two concurrent
  workflow runs overwrite each other in the pool (the workflow-cards UX relies on concurrent runs).
- **Run-card screenshot-on-failure is per-step, not run-level.** The card shows the toggle disabled with a
  tooltip — the engine has no run-level screenshot flag; it's controlled by each flow step's
  `onFailure.screenshot`. Don't wire it as a run param (it would be a no-op/fake control).
- **Workflow-cards "Load More" uses measured grid columns.** Visible cards = (columns measured via
  `ResizeObserver` on `grid-template-columns`) × rows. The grid is a **fixed 3-column** layout
  (`repeat(3, minmax(0,1fr))`, → 2/1 cols on smaller widths) — deliberately not `auto-fit`, because the
  rendered column count must NOT depend on how many cards exist (otherwise Load More reflowed the row,
  changing cards-per-row and card width). Don't switch back to `auto-fit`/`auto-fill` for this grid.
- **Workflow-card hover reveal must not change height (don't reintroduce).** The card body holds two
  absolutely-positioned equal-area layers (`.workflow-card-summary`/`.workflow-card-params`) that cross-fade
  on `:hover`/`:focus-within`; the card has a fixed `min-height`. Don't go back to a `max-height` expand
  reveal — it reflowed the grid on hover. Hidden params use `opacity:0` + `pointer-events:none` (still
  tab-focusable, so keyboard focus reveals them).
- **Protected-login pause leaves the instance in `waitingForManualAction` (not terminal).** The queue
  (`ExecutionEngine.processQueue`) treats `waitingForManualAction` as run-complete so the run doesn't loop
  forever and the report still writes, but the instance stays in that state until the user picks Cancel
  (stopInstance) or Retry (repeatInstance) in the handoff panel — there is no auto-timeout yet. Don't make
  the runner auto-continue past a protected login.
- **Load Session / OAuth callback are foundation-only.** "Use Saved Session" and "Use Test Session" are
  intentionally disabled-with-reason (Load Session unimplemented). OAuth is gated by `WFS_OAUTH_*` env and
  only opens the system browser — there is no callback/token handling, and none must be faked.
- **Repeat (single-instance re-run) needs the in-memory run context.** `ExecutionEngine` retains a
  `RunContext` per execution (flows/scenario/dataSources/dirs/inputs) so `repeatInstance` can re-run a
  finished instance. This map is in-memory only — after an app restart the context is gone and Repeat
  reports "run context no longer available (re-run the workflow)." Repeat also doesn't regenerate the
  aggregate run report (the run's report array was already flushed); artifacts in the instance paths are
  overwritten by the re-run.
- **Resizable canvas nodes must fill the React Flow wrapper.** A node article with a fixed `width`/no
  `height:100%` makes `NodeResizer` handles misalign from the visible node. Both `.action-flow-node` and
  `.scenario-flow-node` use `width/height:100%` + `box-sizing:border-box` — keep that for any new
  resizable node type.
- **Recorder records tab switches, not in-tab navigations.** `RecorderService` emits a `routeChange`
  action only when an interaction occurs on a *different* page object than the last recorded one (new
  tab). Same-tab URL changes are not recorded as Route Change by design (avoids noise).
- **Recorder locator uniqueness is DOM-approximated, not Playwright-engine-exact.** The injected
  `recorderInitScript.ts` counts role/label/text matches with a compact DOM heuristic (role map +
  accessible-name approximation), so a saved `matchCount` can differ slightly from Playwright's real
  locator engine on exotic ARIA markup. Counts are also capped at `>5` for performance. The runner's
  live strict-mode translation (`friendlyLocatorError`) is the backstop if a "unique" locator turns out
  ambiguous at run time.
- **`addInitScript` must be registered before the target document loads.** `RecorderService` injects the
  capture script *before* `page.goto(target)`, which is why it works. Tests must add the init script
  before `newPage()` (or use `page.goto(data:…)`); a `setContent()` on a page created *before*
  `addInitScript` may not run it (see `scripts/verify-recorder-locator.mts`).
- **Recorder capture script must stay self-contained.** Everything used by `installRecorderCapture`
  lives inside that one function (only browser globals + the `__awtkit_recordAction` binding), because
  it is serialized via `Function.prototype.toString()`. Do not extract helpers to module scope or
  reference imports; `getRecorderInitScriptContent()` shims esbuild's `__name` (added by `tsx`/keepNames)
  so injection survives different bundlers.
- **`ADMINISTRATOR_PERMISSIONS` is a DENYLIST, so a new permission is granted to Administrator by
  default.** `src/security/authz/Permissions.ts:132` filters `ALL_PERMISSIONS` down by exclusion.
  Adding a member to `Permission` therefore grants it to Administrator with no further edit — correct
  for the semantic set added by bd `awkit-c7j`, but a Super-User-only permission that is not added to
  that filter is a **silent privilege grant** with no failing check. Assert new permissions in
  `verify:authz` in both directions (granted where intended, denied where intended); a one-directional
  assertion passes while the grant is wrong.
- Concurrency/worker isolation (`RunnerWorkerHost`/`RunnerWorker`) is not load-tested.
- Form Designer and Runtime Input end-to-end flows are not covered by `verify:runner`.
- Large renderer bundle (~900 KB) — fine for desktop, but no code-splitting.

## Repeated problems pattern

- **Optional grid panels must not leave empty slot elements or state classes behind.** In
  `DesignerCanvasLayout`, an explicit `rightPanel={null}` means there is no second grid child. Rendering
  an empty drawer slot in the one-column state creates an implicit second row and halves the canvas;
  applying `right-collapsed` without a panel reserves an empty narrow column. The Flow Designer GUI
  verifier guards both dimensions and requires zero slots in the no-inspector state.

- **Canvas pointer gesture refs must not be read from queued React state updaters.** Pointer-up releases
  `panState`/drag state immediately, while React may execute a pointer-move updater or commit `setDrag`
  afterward. Snapshot immutable pointer-down values before calling a state setter, and keep the latest
  computed node position in the gesture ref for pointer-up/drop. Regression coverage lives in the real
  Electron Flow Designer verifier (rapid pane drag plus hit-tested node-over-node drag). Do not replace
  this with optional chaining or error suppression; that would hide a broken gesture.

- **"build PASS" does not cover `scripts/`.** (2026-07-28.) `npm run build` typechecks the app
  project; verifier scripts are a separate project (`tsconfig.scripts.json`, `npm run
  typecheck:scripts`). A verifier can therefore be type-broken on `main` while a whole day of task
  entries truthfully report "build PASS" — which is what happened: `ea90491` landed a cast in
  `verify-semantic-store.mts` that `tsc -p tsconfig.scripts.json` rejects, and nothing noticed,
  because `tsx` strips types without checking them and the suite still ran 215/0. **After editing
  anything under `scripts/`, run the combined gate `npm run verify:all-typecheck`** (`build` +
  `typecheck:scripts`) — the suite passing proves nothing about whether it compiles.

- **Never write a control character as a `\uXXXX` escape in a source file — derive it in code.**
  (2026-07-28, hit twice in one session.) An editing tool expanded the escape and wrote a **literal
  NUL byte** into `LocatorRecoveryStore.ts`, which `verify:source-hygiene` forbids. It was slow to
  find because the failure hides itself: `grep` reports the file as "binary" instead of matching, and
  reading the file renders the NUL as a space, so the source *looks* correct. Use
  `String.fromCharCode(0)` — no tool can re-expand it. The same mistake was then reproduced while
  writing the lesson into a notes file, so treat "I know about this one" as insufficient: after
  editing any file that mentions a control character, scan it for literal ones.

- **A new top section in `CURRENT_STATE.md` or `HANDOFF.md` must carry the
  `N PASS / N NOT RUN / N BLOCKED` tally.** (2026-07-28.) `tools/roadmap/lib/parse-narrative.mjs`
  scopes to the newest `##` heading only. A section that omits the tally does not fail loudly — it
  drops that file from the consistency banner, which then compares one source against itself and
  still renders "Sources agree". `buildConsistency` computes `agrees` with `.every()`, which is
  vacuously true over an empty set; the only thing standing between that and a silent lie is the
  `checked >= 2` assertion in `verify:roadmap-dashboard`. Do not relax it.

- When packaging fails at the startup gate, the cause has historically been a **manifest** issue
  (BOM or stale path/name), not a missing file. Check `resources/dependency-manifest.json` first.
# Resolved: Recorder Smart Wait temporal-correlation false requirements (2026-08-08)

Recorder observation previously converted every nearby signal into an evidence-free required wait,
so a background `elementEnabled role=button` could fail after a successful SPA route change. New
captures classify causal evidence as required/optional/advisory and apply route dominance. Legacy
manual waits intentionally retain their prior semantics.
