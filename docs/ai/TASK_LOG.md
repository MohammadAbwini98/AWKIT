# TASK_LOG

Append a new entry after every task (newest at top). Keep entries short and factual.

---

## 2026-08-19 - Claude - Implement pointer interaction semantics (double-click, right-click)

- **Closes `awkit-bxyo`.** The two interactions the Recorder silently lost are now first-class across
  the whole chain: capture → normalization → action model → Flow/step conversion → save/reload →
  validation → safety policy → replay.
- **Model:** two distinct `StepType`s, `dblclick` and `contextMenu`, not one pointer step carrying
  `button` + click-count — matching the existing `click`/`hover`/`check`/`radio`/`drag` modelling.
  The closed union made the compiler find every exhaustive map: `StepRequirements`,
  `StepSafetyPolicy`, `PREREQUISITE_TRIAL_MODES`, both flow node catalogs, `NodeCatalog`.
- **Capture subtlety:** a double-click arrives after its own clicks. The init script drops the second
  click in-page (`detail >= 2`); the surviving first click is coalesced in
  `RecorderService.recordActionFromPage`, the documented owner, so the harness and real recorder
  paths cannot disagree. Narrow by design: immediately-preceding, same page, same stable target.
  Both listeners are installed inside closed shadow roots too.
- **Boundary held structurally:** the gesture is captured, the native menu's *contents* never are.
- **Sentinels converted, not kept:** `verify:recorder-competitive` 56/56 + 2 GAP → **60/60, zero
  sentinels**. The single-click control stays, because every other assertion is a count.
- **A verifier bug found on the way:** the competitive harness measured its own per-call accumulator
  rather than the recorder's action list, reporting a double-click as `["click","dblclick"]` when the
  service correctly held `["dblclick"]`. Now reads `bindingRecorder.getActions()`.
- **Files:** `src/profiles/FlowProfile.ts`, `src/profiles/interactionPrerequisiteDecision.ts`,
  `src/validation/StepRequirements.ts`, `src/runner/StepExecutor.ts`,
  `src/runner/runtime/StepSafetyPolicy.ts`, `src/recorder/recorderInitScript.ts`,
  `src/recorder/RecorderService.ts`, `src/testing/random/NodeCatalog.ts`,
  `app/renderer/components/workflow/flowNodeCatalog.ts`, `.../flowNodeRegistry.ts`,
  `mock-site/public/recorder-lab.html`, `scripts/verify-recorder-competitive.mts`,
  `scripts/verify-recorder-flow.mts`, `scripts/verify-runner.mts`,
  `docs/testing/RECORDER_NAVIGATION_MATRIX.md` (section H → 10 PASS rows).
- **Tests run:** `npm run build` clean · `verify:recorder-competitive` **60/60** ·
  `verify:recorder-flow` **38/38** · `verify:runner` **108 passed / 0 failed** (live) ·
  `verify:roadmap-dashboard` · `ai:memory`. Replay assertions mutation-tested both ways.
- **Not run:** clean-machine GUI walkthrough; packaged-EXE gates. **Not measured, deliberately:**
  whether a physical right-click renders the native menu in the Recorder's headed window — the
  `contextmenu` listener fires either way and the selection is unobservable in both cases.
- **Result:** tracker **228 total / 224 closed / 4 outstanding** (owner-gated only; no open items).

---

## 2026-08-19 - Claude - Stop the verifier tally absorbing two known Recorder defects

- **Owner objection, and it was right:** `verify:recorder-competitive` reported 58/58 PASS while two
  of those assertions existed only to prove the Recorder still drops interactions. Left alone, that
  number reads as "recorder pointer handling is green".
- **Change:** known-gap sentinels are tallied separately from checks and printed as `GAP`, never `✓`.
  Headline is now **56/56 checks + 2 sentinels**, with a summary line stating they are NOT passes and
  naming the open bead.
- **Sentinels are live, not decorative:** one that stops holding FAILS the run and says to convert it
  into a positive assertion. Measured by suppressing the second click of a double-click →
  `CHANGED … update awkit-bxyo`, exit 1.
- **Matrix section H** reclassified from `PASS (limitation)` to `GAP — defect present`, with the
  distinction written down.
- **awkit-bxyo** now carries the agreed tranche design: one pointer-interaction-semantics tranche,
  full chain from browser event through replay and reports, both right-click cases (page-owned
  handler and native menu), and the model boundary that two clicks never stand in for a double-click.
- **Tests run:** `verify:recorder-competitive` **56/56 + 2 GAP** (exit 0); mutation → exit 1 as
  designed; `verify:source-hygiene` 9/9; `verify:roadmap-dashboard` 158/158; `ai:memory` PASS.
- **Files:** `scripts/verify-recorder-competitive.mts`,
  `docs/testing/RECORDER_NAVIGATION_MATRIX.md`, `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/*`.
- **Result:** checkpoint recorded truthfully. Three-page switching CLOSED; double-click and
  right-click remain OPEN PRODUCT DEFECTS with replay fidelity NOT IMPLEMENTED.

---

## 2026-08-19 - Claude - Close the Recorder brief residuals (declared limitations, three-page switching)

- **Task:** the Recorder hardening brief was re-submitted. It had already been executed (`awkit-n7n`
  and follow-ups), so it was audited against the code instead of re-run; two residuals were found.
- **Residual 1 — silently uncaptured interactions.** Measured through `recordActionFromPage`: a
  double-click stores TWO clicks; a right-click stores NOTHING; a single click stores one (control).
  No `dblclick`/`contextmenu` listener exists. Declared and guarded in `verify:recorder-competitive`
  section L (**54 → 58**) and matrix section H. Guards do not bless the behaviour.
- **Residual 2 — three-page switching.** `verify:popup-identity` **44 → 50** (Suite 8b): three
  distinct identities, foreign-control isolation per page, non-adjacent switching walk, close-one.
- **Two self-caught test defects:** using a popup-opening button as the opener's marker created a
  third page and a legitimately ambiguous alias (product refused correctly); and checking isolation
  after clicking self-closing action buttons was VACUOUS. Isolation now runs first; a side-effect-free
  `opener-marker-button` was added to `mock-site/public/popup/multiple.html`.
- **Mutation-tested:** collapsing `derivePopupAlias` to a constant fails identity-distinctness and the
  switching walk.
- **Tests run:** `verify:popup-identity` **50/50**, `verify:recorder-competitive` **58/58**,
  `verify:popup-mock-site` 15/15, `verify:mock-site` 161/161, `verify:source-hygiene` 9/9,
  `ai:memory` PASS.
- **Files:** `scripts/verify-popup-identity.mts`, `scripts/verify-recorder-competitive.mts`,
  `mock-site/public/popup/multiple.html`, `mock-site/README.md`,
  `docs/testing/RECORDER_NAVIGATION_MATRIX.md`, `scripts/verify-roadmap-dashboard.mjs`,
  `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/*`.
- **Result:** both residuals closed; the dblclick/contextmenu PRODUCT decision filed as an open bead.
  Tracker 228 total / 223 closed / 5 outstanding.

---

## 2026-08-19 - Claude - Build the installer and re-express the vendorResources check (awkit-dz5w)

- **Packaged:** `npm run package:installer` -> `dist/SpecterStudio Setup 0.1.13.exe` (244,462,040
  bytes), `latest.yml`, blockmap. Unsigned. The lease guard caught the regenerated dependency
  manifest again; resolved with a release lease as before.
- **Diagnosis (reading (a), measured):** `electron-builder.json`'s `from: vendor` entry excludes
  `browsers/**`, the manifest, its signature, `offline-browser-policy.json` and `trust/**`; the
  remaining `vendor/native-modules` and `vendor/npm-cache` are EMPTY. Zero files survive, so
  electron-builder omits the directory correctly. Chromium ships via the other entry and is
  independently confirmed by `verify:packaged-validation`.
- **Fix:** the expectation is derived from `electron-builder.json` at run time and asserts both
  directions - nothing missing, and `resources/vendor` exists iff something should be staged.
- **Mutation-tested both ways** (necessary: with 0 expected files the first half is vacuous): a file
  that should ship but is absent fails; a `resources/vendor` present when nothing is staged fails.
- **Tests run:** `verify:zvec-packaged-assets` **PASSED, exit 0**; `verify:packaged-walkthrough`
  **25/0** with D-G BLOCKED; `verify:packaged-validation` 86/1 (portable aged past 180 min - use
  `npm run package:offline` to build both artifacts together); `verify:roadmap-dashboard` 158/158.
- **Correction:** I predicted the installer would re-enable the `latest.yml` check. It sits after
  Part G, inside the licensed-execution block, so it remains unreachable here.
- **Files:** `scripts/verify-zvec-packaged-assets.mjs`, `resources/dependency-manifest.{json,sig}`,
  `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `scripts/verify-roadmap-dashboard.mjs`, `.beads/*`.
- **Result:** `awkit-dz5w` closed. Tracker 227 total / 223 closed / 4 outstanding, nothing open.

---

## 2026-08-18 - Claude - Package 0.1.13 and fix six artifact version pins (awkit-joa3, awkit-6e2u)

- **Packaged:** `npm run package:portable` produced `dist/SpecterStudio 0.1.13.exe` (213,019,011
  bytes) plus `dist/win-unpacked`. All four pre-pack gates passed; unsigned (no signing identity).
  The write-lease guard caught the regenerated `resources/dependency-manifest.{json,sig}` as an
  unclaimed protected write - resolved by taking a release lease, not by working around it.
- **Found:** six version pins across five files, not the two filed. Two verifiers plus three
  clean-machine PowerShell scripts and the zvec install harness.
- **Impact:** `verify:packaged-validation` reported 86 checks passing against a July 30 artifact of a
  different version; `verify:zvec-packaged-assets` reached the same file via `readdirSync(dist)[0]`.
- **Fix:** one shared resolver (`scripts/helpers/packaged-artifacts.mjs` + `.d.mts`) deriving the name
  from package.json as `package-portable.ps1` does, never falling back to another `.exe`.
  `setup-offline.ps1` discovers from the DVD (no package.json on the guest) and requires exactly one
  match.
- **Tests run:** `verify:packaged-validation` **87/0** (was 86/1 against the wrong file);
  `verify:zvec-packaged-assets` now names 0.1.13 (still red on the separate `awkit-dz5w`);
  `verify:packaged-walkthrough` **24/1**, correctly red because no 0.1.13 installer exists - it used
  to pass against a July 29 installer. `verify:all-typecheck` 0 errors. All PowerShell parses.
- **Not run:** no VM, no `package:installer` - the PowerShell edits are unexercised.
- **Files:** `scripts/helpers/packaged-artifacts.{mjs,d.mts}` (new), `scripts/verify-packaged-
  {validation,walkthrough}.mts`, `scripts/verify-zvec-packaged-assets.mjs`,
  `scripts/clean-machine/{attach-artifacts,run-runbook,setup-offline}.ps1`,
  `scripts/zvec-harness/run-installed-live.ps1`, `resources/dependency-manifest.{json,sig}`,
  `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `scripts/verify-roadmap-dashboard.mjs`, `.beads/*`.
- **Result:** `awkit-joa3` and `awkit-6e2u` closed; `awkit-dz5w` remains open and undiagnosed.
  Tracker 227 total / 222 closed / 5 outstanding.

---

## 2026-08-18 - Claude - Repair the typecheck:scripts baseline, 13 diagnostics to 0 (awkit-zc88)

- **Scope was larger than the bead:** it named one diagnostic (the suite driver kept only the last
  four output lines); there were 13 across six files. A documented baseline of nine from 2026-08-07,
  grown to 13 - what a red gate does when nothing is checking.
- **The bead's proposed fix was wrong:** it said to annotate `thrown` as `NodeJS.ErrnoException |
  null`; that annotation was already present. The real cause is that flow analysis never sees an
  assignment made inside a `.catch` callback, so it narrows the declared `null` to `never`.
- **Fixes, all in verifier scripts, no product code:** `?? undefined` for seven `string | null` ->
  `string | undefined` details; capture the rejection as a value via `.then(() => null, ...)` for the
  four `never` narrowings; braces to discard `selectOption`'s resolved values; spread the raw
  capture-time fingerprint, whose product type is deliberately `Record<string, unknown>`.
- **Nothing silenced:** zero `any` / `as any` / `@ts-expect-error` / `@ts-ignore` in the diff.
- **Tests run:** `verify:all-typecheck` **0 errors, exit 0** (was 13); every affected verifier at its
  previous count - write-queue 29/29, blueprint-recovery 52/52, locator-guard 35/35, frame-chain
  31/31, closed-shadow 23/23, recorder-competitive 54/54; `verify:roadmap-dashboard` 158/158;
  `ai:memory` PASS.
- **Files:** `scripts/verify-{write-queue,blueprint-recovery,locator-guard,frame-chain,closed-shadow,
  recorder-competitive}.mts`, `docs/ai/KNOWN_ISSUES.md` (entry marked RESOLVED),
  `scripts/verify-roadmap-dashboard.mjs`, `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/*`.
- **Result:** `awkit-zc88` closed. Tracker 224 total / 220 closed / 4 outstanding, nothing open.

---

## 2026-08-18 - Claude - Scope the reports Open-action locator (awkit-1kct)

- **Task:** identify and fix the unnamed failing check in `verify:reports-populated-gui` (154/1/3).
- **Diagnosis:** `SYS-REP-008 Open action is available for a real stored report` used a page-wide
  `getByRole("button", { name: /Open/ })` with `.catch(() => false)`. Two controls on the page match
  the unanchored pattern, so strict mode threw and the catch hid it. Not a product defect.
- **Fix:** scoped to the report card, anchored `/^Open$/`, asserts exactly one match plus visibility,
  and prints both counts so a future ambiguity names itself. Measured: 1 in the card, 2 page-wide.
- **Mutation-tested (with rebuild, since this drives the built app):** renaming the card action to
  "Reveal" fails with `card matches=0, page-wide /Open/ matches=1`.
- **Correction:** the bead claimed the 3 NOT RUN were awkit-az7's OS shell launches. Wrong - they are
  SYS-REP-007 and SYS-REP-011 (both PROVEN ELSEWHERE by `verify:reports-live-engine`) and SYS-REP-006
  (measured unreachable in one session). A note was added to awkit-az7; it was not otherwise changed.
- **Tests run:** `verify:reports-populated-gui` **155 PASS / 0 FAIL / 3 NOT RUN**;
  `verify:roadmap-dashboard` 158/158; `ai:memory` PASS; `npm run build` clean.
- **Files:** `scripts/verify-reports-populated-gui.mts`, `scripts/verify-roadmap-dashboard.mjs`,
  `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/*`.
- **Result:** `awkit-1kct` closed. Tracker 224 total / 219 closed / 5 outstanding. All five findings
  from the full-suite run are resolved.

---

## 2026-08-18 - Claude - Re-express the branding permission sanity check (awkit-fbwn)

- **Task:** fix `verify:branding` 46/47, where `SuperUser holds every permission (sanity)` failed.
- **Why no product change:** satisfying it would have granted SuperUser `page.licenseIssuer` and
  `license.issue`, removing a deliberate signing-key boundary. Confirmed at three layers:
  `SUPER_USER_PERMISSIONS` = ALL minus ISSUER_PERMISSIONS (with the reason in a comment), the `Issuer`
  role holds exactly those two, and `UserAdminService` enforces Issuer exclusivity.
- **Bead instruction corrected:** it proposed asserting no built-in role holds them. Wrong - the
  `Issuer` role does, by design. Checked before writing.
- **Fix:** one assertion became three - SuperUser holds all non-issuer permissions; the ONLY withheld
  permissions are that pair (exact set difference, so the original sanity intent survives); the Issuer
  role holds exactly that pair. Names restated rather than imported so a boundary change is visible.
- **Mutation-tested:** M1 grant SuperUser the pair -> boundary check fails (the change the OLD
  assertion demanded); M2 withhold a third -> all three fail; M3 empty the Issuer role -> orphan check
  fails. Each caught by its intended check.
- **Tests run:** `verify:branding` **49/49**, `verify:licensing` 183/183, `verify:authz` 92/92,
  `verify:recorder-authz` 58/58, `verify:roadmap-dashboard` 158/158, `ai:memory` PASS.
- **Files:** `scripts/verify-branding.mts`, `scripts/verify-roadmap-dashboard.mjs`,
  `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/*`.
- **Result:** `awkit-fbwn` closed. Tracker 224 total / 218 closed / 6 outstanding.

---

## 2026-08-18 - Claude - Protected-login: stale count and wrong-signal wait (awkit-syyd)

- **Part 1:** the check asserted a raw draft length after unpausing; the test navigates in between, and
  since `eeb7a21` that independent navigation is a recorded step. Measured with a new evidence line:
  the draft gains `[goto:..., click:Click Open Reports]`. Re-expressed to count the identical action by
  type+name+locator - stronger than a length test, not weaker.
- **Part 2 (not dismissed as a flake):** the OTP check waited on the visible text and asserted the
  `data-authenticated` attribute. It now waits on the attribute it asserts, synchronous predicate.
- **Mutation-tested:** mutating the real resume point fails the check (`identical action 1/2; added
  after unpausing: []`). The first attempt was a BAD mutation - overwritten by the resume below it.
- **Tests run:** `verify:protected-login-recorder` 56/57 -> **57/57**, soaked 5 runs before and 3 after;
  `verify:async-wait-hygiene` 22/22; `verify:roadmap-dashboard` 158/158; `ai:memory` PASS.
- **Files:** `scripts/verify-protected-login-recorder.mts`, `scripts/verify-roadmap-dashboard.mjs`,
  `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/*`.
- **Result:** `awkit-syyd` closed. Tracker 224 total / 217 closed / 7 outstanding.

---

## 2026-08-18 - Claude - Full 181-verifier suite run, and fix recorder-e2e metadata parity (awkit-8yp6)

- **Task:** run the full verification suite, report it, then fix the recorder-e2e metadata failure.
- **Suite:** **181 verifiers, 170 PASS / 11 FAIL / 0 timeouts, 43 min.** No aggregate runner exists;
  built one from `scripts/lib/verifier-classification.ts`, cross-checked both ways. Five of the 11 are
  BLOCKED not FAILED (stale `dist/`, missing signed license, missing Java runtime) and are counted as
  neither passes nor failures.
- **Mine, fixed:** `verify:source-hygiene` — two U+000B characters in CURRENT_STATE.md from a `\\v`
  escape in a Windows path inside a JS string. Rewritten with forward slashes.
- **awkit-8yp6 root cause (NOT this session's regression, and my bead said otherwise — corrected):**
  the verifier compared a pre-hash captured action against a post-hash saved step. Identity
  fingerprints are hashed before persisting by design (hashing 2026-08-08 `ddd9c84`; comparison last
  reconciled 2026-08-01 `57dfad2`).
- **Fix, three parts:** compare the fingerprint THROUGH the hash transformation; make "metadata
  survives" a subset comparison since the finalizer legitimately adds `captureEvidence.pageKey`; treat
  `blueprintCapture` as a consumed input and assert its consumption separately. Both new checks are
  cardinality-guarded.
- **Mutation-tested (3 product mutations, rebuild each cycle):** drop recorded prerequisite -> parity
  fails; stop hashing -> hashed-fingerprint check fails; no page evidence -> only the blueprint check
  fails. The FIRST attempt was invalid — the E2E runs the BUILT output, so unrebuilt mutations showed
  as uncaught and would have condemned a working fix.
- **Also removed** a plaintext-leak check added minutes earlier: it flagged the testId selector, which
  is supposed to persist.
- **Tests run:** `verify:recorder-e2e` 58/3 -> **63 PASS / 0 FAIL**; `npm run build` clean;
  `verify:source-hygiene` 9/9; `verify:roadmap-dashboard` 158/158; `ai:memory` PASS.
- **Files:** `scripts/verify-recorder-e2e.mjs`, `docs/ai/{CURRENT_STATE,TASK_LOG}.md`,
  `scripts/verify-roadmap-dashboard.mjs`, `.beads/*`.
- **Result:** `awkit-8yp6` closed. Tracker 224 total / 216 closed / 8 outstanding (4 open findings
  from the suite run, 4 owner-gated blocked).

---

## 2026-08-18 - Claude - Re-express the stale positional drop-target assertion (awkit-gc0g)

- **Task:** fix the one failing check in `verify:recorder-competitive` (49/50), surfaced while
  running the verifiers cited by the navigation matrix.
- **Diagnosis, from source:** the check asserted `resolution === "needs-review"` for an ambiguous
  positional drop target. Since `awkit-65g` the recorder adopts a positional last-resort as
  `resolved` by owner directive - `buildRecordedFlow` routes a unique-but-positional locator there,
  and `verify:locator-guard` asserts the same for the sensitive case. A stale assertion, not a
  regression.
- **Fix:** re-expressed, not deleted, and no product code changed. Five checks now assert the intent
  against the current representation: adopted as resolved by the recorder; declares
  `disambiguation: positional`; low confidence with a non-empty warning; carries guard fingerprint +
  candidate selector; and the guard records the ambiguous sibling set the index came from.
- **Mutation-tested, and it was instructive:** dropping the guard hashing fails three of the five,
  including "adopted as resolved", because without re-provable evidence the recorder correctly falls
  back to needs-review. `resolved` is conditional on the guard existing - the old check had pinned
  the unguarded branch while this fixture takes the guarded one.
- **Tests run:** `verify:recorder-competitive` 49/50 -> **54/54**; `verify:locator-guard` **35/35**;
  `npm run build` clean; `verify:roadmap-dashboard` 158/158; `ai:memory` PASS.
- **Files:** `scripts/verify-recorder-competitive.mts`, `scripts/verify-roadmap-dashboard.mjs`,
  `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/*`.
- **Result:** `awkit-gc0g` closed. Tracker 219 total / 215 closed / 4 outstanding, with **nothing
  open** - all four remaining are owner-gated and externally blocked.

---

## 2026-08-18 - Claude - Recorder navigation lab and regression matrix (awkit-9qj)

- **Task:** the formalisation remainder carved out of `awkit-n7n` - a mock-site navigation lab and
  the regression matrix.
- **Not just bookkeeping.** Every transition was previously driven from the test, which cannot fake a
  link click, a form submit, or a server redirect - and an evaluate-injected `pushState` is a call the
  test makes, not one a real router makes, so a mis-installed `history` wrap would pass regardless.
- **Added:** `mock-site/public/navigation-lab.html` + `navigation-lab-arrived.html`, and routes
  `/navigation-lab`, `/navigation-lab/arrived`, `/navigation-lab/redirect` (fixed 302, hardcoded
  destination so it can never be an open redirect), `/navigation-lab/route*` (served by the lab so a
  post-`pushState` reload lands on the same URL instead of a 404).
- **Tests run:** `verify:recorder-navigation` 32 -> **45/45**; `verify:mock-site` 145 -> **161/161**;
  `verify:popup` 12/12; `verify:popup-identity` 44/44; `verify:popup-mock-site` 15/15;
  `verify:frame-chain` 31/31; `verify:recorder-competitive` **49/50** (pre-existing, unrelated);
  `npm run build` clean; `ai:memory` PASS.
- **Mutation-tested:** stripping the query string in `RecorderService.captureUrl` fails 14 checks, six
  of them the new lab ones.
- **Self-corrections:** an exact-set assertion replaced a wrong count (7 destinations, not 6); and the
  first mutation silently did not apply (CRLF anchor mismatch), so the clean run after it proved
  nothing - verify a mutation applied before trusting the run that follows.
- **Filed `awkit-gc0g`:** the one failing competitive check encodes the pre-`awkit-65g` positional
  expectation; the instruction is to re-express the assertion, not to change working product code.
- **Files:** `mock-site/public/navigation-lab{,-arrived}.html`, `mock-site/server.mjs`,
  `mock-site/README.md`, `scripts/verify-mock-site.mjs`, `scripts/verify-recorder-navigation.mts`,
  `docs/testing/RECORDER_NAVIGATION_MATRIX.md`, `scripts/verify-roadmap-dashboard.mjs`,
  `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/*`.
- **Result:** `awkit-9qj` closed. Tracker 219 total / 214 closed / 5 outstanding.

---

## 2026-08-18 - Claude - Fail the capsule suites on a save-error toast (awkit-v35n)

- **Task:** fix the gap the EPERM investigation exposed - the app raised a visible save error and
  every downstream check proceeded as though the save had worked.
- **Change:** `waitForPersistedState` in `scripts/lib/gui-verify-harness.mjs` polls the persisted
  state and reads `.app-toast-error` on every poll, failing immediately with the app's own message.
  All four Save clicks (2 Flow, 2 Workflow) are followed by a persist wait, so one helper covers all.
- **Three details that decide whether it works:** sampled during the wait (the toast auto-dismisses,
  and reading afterwards captured only the status bar); only toasts appearing after the wait starts
  are fatal (a stale one would abort a healthy save); the predicate is read before the toast (a save
  landing alongside an unrelated error is a success).
- **Consolidation:** `waitForAsyncCondition` had no callers left, so it was removed rather than left
  exported and unused; `verify:async-wait-hygiene` now points at the surviving construction.
- **Tests run:** `verify:async-wait-hygiene` 16 -> **22/22** (six behavioural checks against a
  stand-in page whose `evaluate` awaits); mutation-tested - disabling the guard fails exactly those
  three checks and reproduces the original symptom (5004ms timeout instead of an immediate failure).
  `verify:flow-designer` exit 0 (16/16, broad 112, retired 0, unexpected 0);
  `verify:workflow-builder` exit 0 (17/17, broad 58, retired 0, unexpected 0);
  `verify:roadmap-dashboard` 158/158; `ai:memory` PASS.
- **Files:** `scripts/lib/gui-verify-harness.mjs`, `scripts/lib/verify-flow-loop-capsule-gui.mjs`,
  `scripts/lib/verify-workflow-loop-capsule-gui.mjs`, `scripts/verify-async-wait-hygiene.mjs`,
  `scripts/verify-roadmap-dashboard.mjs`, `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/*`.
- **Result:** `awkit-v35n` closed. Tracker 218 total / 213 closed / 5 outstanding.

---

## 2026-08-18 - Claude - Delete the retired U-route assertions (awkit-6be step 2, awkit-8z0)

- **Task:** apply the step-2 recipe now that the Workflow capsule suite is stable.
- **Change:** excised the 16 retired U-route `check(` calls from each pre-capsule walkthrough with a
  string/template/comment-aware paren scanner (Flow 135 -> 119, Workflow 80 -> 64), emptied both
  `supersededURouteChecks` arrays, and moved `expectedChecks` 128 -> 112 and 74 -> 58.
- **Deviation, deliberate:** the two `Two ... Loops render independently` names each occur twice - the
  real assertion plus a fallback `check(name, false, ...)` guarding fixture setup. The real assertion
  was removed; the guard was RENAMED to state what it asserts rather than deleted, so a fixture
  regression still fails loudly.
- **Order honoured:** the one retired intent with no focused replacement (inspector-delete + Undo) was
  added to the focused Flow suite first, in an earlier session, before any deletion.
- **Tests run:** `verify:flow-designer` exit 0 - capsule **16/16**, broad observed **112**, retired 0,
  unexpected 0. `verify:workflow-builder` exit 0 - capsule **17/17**, broad observed **58**, retired 0,
  unexpected 0. `verify:roadmap-dashboard` 158/158, `ai:memory` PASS.
- **Note:** the empty allow-list strengthens the gate - `pass` requires `failedChecks.length === 0`,
  and `expectedChecks` feeds `harnessFailed` so a truncated run cannot pass.
- **Files:** `scripts/verify-flow-designer-gui{,.pre-capsule}.mjs`,
  `scripts/verify-workflow-builder-gui{,.pre-capsule}.mjs`, `scripts/verify-roadmap-dashboard.mjs`,
  `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/*`.
- **Result:** `awkit-8z0` and `awkit-6be` closed. Tracker 218 total / 212 closed / 6 outstanding.

---

## 2026-08-18 - Claude - Root-cause the capsule flake: an EPERM save loss behind a vacuous wait (awkit-a53k)

- **Task:** soak the Workflow capsule suite with a model-vs-DOM dump until it failed, to decide
  whether `awkit-a53k` was a render fault; then let `awkit-8z0`/`awkit-6be` fall out behind it.
- **The premise was false.** The first captured failure showed the persisted profile as the pristine
  seed with an mtime byte-identical to the seed mtime - the file was never written. Check 13 had
  recorded a FAIL, not a pass ("13/17 checks" counts results). Not a render fault.
- **Defect 1 (PRODUCT, data loss):** `JsonProfileStore.atomicWrite` did tmp-write + a SINGLE rename,
  no retry. Captured from the app own toast: `EPERM: operation not permitted, rename <...>.tmp ->
  <...>.json`. Routine Windows contention (antivirus, indexer, backup agent) discarded the save; the
  user saw a toast flash past and the profile reverted. Affects every profile the store persists.
  Fixed by reusing `app/main/atomicReplace.ts` (the policy proven for `ui-settings.json`, awkit-4qs).
- **Defect 2 (INSTRUMENT):** `page.waitForFunction` does not await an async predicate - measured,
  async-always-false resolves in 105ms while sync-always-false times out at 3010ms. Three
  persisted-state waits (1 Workflow, 2 Flow) were inert for their whole lifetime. Fixed with
  `waitForAsyncCondition` (polls from Node via `page.evaluate`, which does await).
- **Method note:** the diagnostic caught a bug in its own verdict logic before it could mislead -
  it ordered persistence before DOM, so a pre-save wait reported "absent from the saved profile"
  while the edge was on screen. DOM first; the profile only ever explains a missing DOM edge.
- **Tests run:** `verify:profile-store` **26/26** (was 18; new retry checks mutation-tested - removing
  the retry exits 1 at that check), `verify:async-wait-hygiene` **16/16** (new, mutation-tested by
  reverting a real call site), `verify:write-queue` 29/29, `verify:verifier-classification`
  reconciled (181), `verify:roadmap-dashboard` 158/158, `npm run build` clean.
  **Soak: 12 Workflow + 6 Flow runs green**, against three pre-fix soaks that each failed on run 1.
- **Files:** `src/storage/ProfileStore.ts`, `scripts/verify-profile-store.mts`,
  `scripts/verify-async-wait-hygiene.mjs` (new), `scripts/lib/gui-verify-harness.mjs`,
  `scripts/lib/verify-workflow-loop-capsule-gui.mjs`, `scripts/lib/verify-flow-loop-capsule-gui.mjs`,
  `scripts/lib/verifier-classification.ts`, `package.json`, `scripts/verify-roadmap-dashboard.mjs`,
  `docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/*`.
- **Result:** `awkit-a53k` closed; `awkit-v35n` filed (no suite asserts the absence of a save-error
  toast). Tracker 218 total / 210 closed / 8 outstanding. `awkit-8z0` is now genuinely unblocked.

---

## 2026-08-17 - Claude - Consolidate the flake bead chain and fix the fill echo (awkit-ty4)

- **Task:** Two things the owner asked for after questioning why Recorder issues kept opening:
  consolidate the duplicated flake beads, and fix `awkit-ty4` properly rather than with the risky
  value-only shortcut that caused it to be deferred.
- **Consolidation:** closed `awkit-2js`, `awkit-7h0w`, `awkit-be5o` and `awkit-r9f3` as **superseded
  by `awkit-a53k`**. One investigation had produced five P1 beads for one suspected defect, which
  overstates the defect count. Outstanding 9 -> 5, P1s 5 -> 1. Nothing was closed as fixed that is
  not fixed; each closure names its successor.
- **awkit-ty4 implementation:** a *value-preserving actions* rule in `src/recorder/RecorderService.ts`.
  A repeat `fill` on the same stable target with an identical `valueSource` is dropped only when every
  action recorded since the earlier fill cannot change the field - `hover`, or a `press` of a
  navigation/selection key (`Tab`, `Shift+Tab`, arrows, `Home`/`End`, `PageUp`/`PageDown`). A click,
  `Backspace`, or any printable key means the field may genuinely have been re-entered, so the second
  fill is kept.
- **Mutation evidence:** collapsing the rule to the naive `if (sameValue)` form fails exactly the two
  cases that caused the original deferral - "a re-fill after a Clear CLICK is kept (not an echo)" and
  "a re-fill after Backspace is kept (the key could have edited the field)". Restoring the rule
  returns green.
- **Gotchas recorded:** `findLastIndex` is unavailable at this lib target (TS2550), so the reverse
  scan is an explicit loop; a `WeakSet` keyed by page rejects a string, which was a harness bug of
  mine, not a product one.
- **Tests run:** `verify:recorder-navigation` **32/32** (6 new echo cases), `verify:recorder`
  **217/217**, `verify:recorder-actions` **20/20**, `npm run build` clean,
  `verify:roadmap-dashboard` **158/158**, `check-memory` PASS.
- **Files:** `src/recorder/RecorderService.ts`, `scripts/verify-recorder-navigation.mts`,
  `scripts/verify-roadmap-dashboard.mjs` (baseline moved to 8 outstanding / 209 closed - the parser
  counts every non-closed status, so it is 4 `open` + 4 owner-gated `blocked`, not `bd stats`' "Open 4"),
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`, `.beads/issues.jsonl`.
- **Result:** tracker at **217 total / 209 closed / 8 outstanding**. Still open: `awkit-a53k` (P1,
  the suspected Workflow self-loop render bug), `awkit-6be` (P2), `awkit-8z0` (P2, step 2 still
  reverted), `awkit-9qj` (P3). Ledger unchanged at 63 PASS / 2 NOT RUN / 1 BLOCKED.

---

## 2026-08-16 - Claude - Audit the retired U-route assertions; deletion BLOCKED by a real gap

- **Task:** Fix the 31 retired U-route assertions (16 Flow + 15 Workflow) that run, fail, and are
  allowlisted. Intended fix: delete them, since a permanently-failing allowlisted assertion is worse
  than none.
- **Deletion NOT performed.** The audit found the premise is not fully true, so deleting would have
  silently dropped real coverage.
- **Mapping:** 15 of the 16 Flow retired names map cleanly onto `FLOW_LOOP_CAPSULE_CHECK_NAMES`
  (label -> #4, render -> #1+#5, motion -> #6, Undo/Redo -> #13, zoom -> #8, drag -> #9, reduced
  motion -> #7, two Loops -> #10, reload -> #13, direct target -> #14+#15, unsaved edit -> #13,
  keyboard delete -> #14).
- **The exception:** "Undo restores an inspector-deleted Flow Loop with its configuration". Grepping
  the focused suite for `inspector` returns ZERO hits - inspector-initiated deletion followed by Undo
  is covered nowhere. The 2026-08-15 handoff's claim that the focused suites replace all the retired
  intent is therefore very nearly, but not entirely, correct.
- **Filed `awkit-6be`** with the required order: add an inspector-delete + Undo check to the focused
  suite FIRST, then delete the retired assertions and drop the allowlist.
- **Not checked:** whether the 15 Workflow retired assertions have a similar unreplaced intent.
- **Tests run:** `verify:roadmap-dashboard` 158/158; `check-memory` PASS. No code changed.
- **Result:** 31 assertions remain non-binding - a real if narrow reduction in the two designer
  suites' authority, and it should be read that way when relying on them.

---

## 2026-08-16 - Claude - Distinguish same-named validation issues (awkit-8xx)

- **Task:** Fix `awkit-8xx`, which the bead recorded as UNPROVEN.
- **Measured first.** The earlier harness returned 0 issues because its profile shape was wrong -
  `nodes` IS the FlowStep array. With a correct fixture: 3 blocked steps -> 3 issues, 3 distinct
  `nodeId` anchors, 2 distinct messages. The code-read theory held this time.
- **Not duplication.** The reported "same warning four times" is four correctly anchored, separate
  failures that read identically. Deduplicating would have hidden three real defects.
- **Implementation:** `labelFor` appends the step id only for names shared by more than one step in
  the flow; unique names stay clean. The ambiguity set is computed per flow and threaded through
  `validateTimeouts` and `validateStepLoopBounds`; the reference-cycle message stays plain since it
  already names the flow and target.
- **Tests run:** `verify:validation` **139/139** (was 134); mutations V1 (never disambiguate, 2
  failures) and V2 (always disambiguate, 1 failure) both killed; `npm run build` PASS;
  `verify:roadmap-dashboard` 158/158.
- **GUI gap closed in the same session:** `verify:flow-designer` focused capsule **15/15**, 128 broad
  observed, 16 retired U-route failures, **0 unexpected**; `verify:workflow-builder` focused capsule
  **16/16**, 74 broad observed, 15 retired, **0 unexpected**. The retired counts match the
  2026-08-15 handoff exactly, so the validator change caused no regression where its messages render.
- **Result:** `awkit-8xx` closed. Tracker 207 / 200 closed / 7 outstanding.

---

## 2026-08-16 - Claude - Guard action-caused navigation; kill the surviving mutation (awkit-rit)

- **Task:** Close the mutation gap left by `awkit-76x` - M1 (every navigation treated as
  independent) survived the whole recorder suite.
- **Diagnosis the bead asked for:** the earlier harness never reached `captureUrl` because it had no
  init-script/action wiring, so no click was ever recorded as an action. Rather than debug it,
  the causal case was built inside `verify-recorder-navigation`, whose harness provably reaches
  `captureUrl`.
- **Implementation:** a second context with the init script + real `recordActionFromPage`, a click
  on a link that navigates, and an assertion that NO goto step is added - plus assertions that the
  click was recorded and that it actually navigated, so a silent no-op cannot pass as success.
- **Tests run:** `verify:recorder-navigation` **24/24** (was 20). Mutations: **M1 KILLED** (was
  surviving), M2 killed, M3 (never mark the causal action) killed - 3/3.
  `verify:roadmap-dashboard` 158/158.
- **Tests not run:** `npm run build`, `verify:recorder`, `verify:popup` - test-only change, no
  product code touched this time.
- **Result:** `awkit-rit` closed. Tracker 207 / 199 closed / 8 outstanding.

---

## 2026-08-16 - Claude - Independent navigation becomes a replayable step (awkit-76x)

- **Task:** Fix `awkit-76x` - independent mid-recording navigation had no representation in the flow.
- **Implementation:** `captureUrl` distinguishes action-caused from independent navigation using a
  SEQUENCE rule, not a time window: did a recorded action occur on this page since its last
  navigation? Action-caused stays implicit; independent emits a `goto` step. Popups are excluded
  (their registration + `switchToPopup` already represent the move) and the opening navigation is
  excluded (the explicit start `goto` covers it).
- **Why not a time window:** "an action within N ms" is a race that fails differently on a slow
  machine; "an action since the last navigation" is deterministic.
- **Tests run:** `verify:recorder-navigation` **20/20** (was 18); `verify:recorder` 217/217;
  `verify:recorder-hover` 265/265; `verify:recorder-actions` 20/20; `verify:popup` 12/12;
  `npm run build` PASS; `verify:roadmap-dashboard` 158/158.
- **HALF THE CONTRACT IS UNPROVEN - `awkit-rit`.** Mutation M2 (never emit) is killed. Mutation M1 -
  force every navigation to count as independent, so each emits a redundant goto - SURVIVES the
  entire recorder suite. If the causal rule regresses, every click-caused navigation gains a
  redundant Navigate step (exactly what brief section 9 warns against) and nothing catches it. A
  first harness to test this failed because `captureUrl` never fired in it; diagnose that first.
- **Result:** `awkit-76x` closed, `awkit-rit` filed. Tracker 207 / 197 closed / 10 outstanding.

---

## 2026-08-16 - Claude - Event correlation and nav dedup measured; neither defective (awkit-n7n)

- **Task:** Fix brief sections 11 (navigation dedup) and 12 (event correlation).
- **Outcome: nothing to fix. Both are already correct, proven by measurement, and no code changed.**
- **Section 11 - not a defect:** a real `POST /login -> 303 -> /form` chain produced exactly ONE
  `framenavigated` and one recorded URL; `upsertUrl` also dedups identical URLs within
  `URL_DEDUPE_WINDOW_MS`. The feared "several accidental navigation nodes" cannot occur because
  navigation never becomes flow nodes (`awkit-76x`).
- **Section 12 - not a defect:** `recordActionFromPage` (RecorderService.ts:1385) already collapses
  consecutive fills on the same field. Measured: 15 raw init-script emissions -> 5 recorded actions
  for a full login journey; typing "alice" emits 5 per-keystroke fills and records 1.
- **THIRD wrong finding this session, same root cause.** The first harness exposed its OWN
  `__awtkit_recordAction` binding, so it measured the raw init-script emission and never reached
  `recordActionFromPage` - appearing to show 15 uncoalesced actions. This is the trap already in AI
  memory ("the harness bypasses recordActionFromPage"). Any correlation harness MUST call
  `recordActionFromPage`.
- **Genuine residue, deliberately NOT fixed (`awkit-ty4`, P3):** after focus leaves a field a
  redundant `fill` echo is recorded, because coalescing only merges with the immediately previous
  action. The obvious narrowing would break a legitimate re-fill after a Clear action, so shipping it
  on limited remaining budget was the wrong trade against idempotent noise.
- **Confirmed correct-by-design:** a recorded password value is empty because secret redaction works.
- **Tests run:** `verify:roadmap-dashboard` 158/158.
- **Tests not run:** `npm run build`, `verify:runner`, recorder verifiers - no product code changed.
- **Still open in awkit-n7n:** mock-site navigation lab and the 34-item regression matrix.

---

## 2026-08-16 - Claude - Popup coverage executed; URL/replay boundary measured (awkit-n7n)

- **Task:** Continue `awkit-n7n` - execute the popup claims I had only asserted, and answer the open
  question about ordered navigation events versus a visited set.
- **Popup coverage now MEASURED, not assumed:** `verify:popup` 12/12, `verify:popup-identity` 44/44,
  `verify:popup-mock-site` 15/15 - 71 checks, 0 failures. Sections 5-7 of the brief are
  substantially covered; a parallel page registry would duplicate working code.
- **The open question is answered, and it dissolves:** neither an ordered event log NOR the visited
  set feeds replay. `buildRecordedFlow(name, actions, blueprints)` never receives `recordedUrls`,
  and `"goto"` is pushed as an action exactly once - at recording start. A recorded flow contains
  exactly one navigation step.
- **Measured gap (`awkit-76x`):** that design is right for action-caused navigation (brief section 9
  prefers metadata on the triggering action over a Navigate step per URL change, and Playwright
  auto-waiting carries it). The gap is section 9's THIRD case - independent navigation during
  recording has no representation, so replay diverges silently. The bead warns explicitly against
  "fixing" it by emitting a Navigate step after every URL change.
- **Delivered:** `verify:recorder-navigation` 15 -> **18/18**, adding the URL-history-vs-replay
  boundary as an asserted contract.
- **Tests run:** verify:popup 12/12; verify:popup-identity 44/44; verify:popup-mock-site 15/15;
  verify:recorder-navigation 18/18; verify:roadmap-dashboard 158/158.
- **Tests not run:** `npm run build`, `verify:runner` - no product code changed this phase.
- **Corrected in passing:** the verifier comment cited a placeholder bead id; now points at the real
  `awkit-76x`.
- **Still open in awkit-n7n:** semantic event correlation, navigation deduplication across event
  sources, the mock-site navigation lab, and the 34-item regression matrix.

---

## 2026-08-16 - Claude - Navigation capture measured; both audit theories disproven (awkit-n7n)

- **Task:** Fix the mock-site harness that failed last session and run the navigation measurement.
- **Harness bug:** the mock site serves EXTENSIONLESS routes (`/login`, not `/login.html`). The
  readiness probe fetched `/index.html`, got 404, and reported "mock site did not start" - the
  server had been running the whole time. `stdio: "ignore"` hid the evidence. Both are now fixed and
  the extensionless-route trap is written into the verifier's header so it cannot cost a session again.
- **Result - both code-read theories were WRONG about consequence:**
  - `awkit-39j` CLOSED not-a-defect. Premise right (the init script's `kind:"url"` signal feeds only
    Smart Wait, gated on `captureSmartWaits`), consequence wrong - `recordedUrls` never depended on
    it. `page.on("framenavigated")` DOES fire for same-document history navigations and
    `frame.url()` carries the full URL.
  - `awkit-5sw` CLOSED not-a-defect. `emitUrl()` does emit `origin + pathname`, but that value never
    reaches `recordedUrls`, so query and hash survive.
- **Measured matrix:** document navigation, pushState, replaceState and hashchange are ALL recorded
  with query and hash preserved; revisiting a known URL, back, forward and reload add no record
  because `recordedUrls` is a deduplicated visited-URL SET rather than an ordered event log.
- **Delivered:** `scripts/verify-recorder-navigation.mts` -> `npm run verify:recorder-navigation`,
  **15/15**, registered as `real-browser` in the classification registry. Drives the real
  `RecorderService.attachUrlCapture` against real Chromium and the real mock site; no mock of the
  unit under test. Includes a non-vacuity check that EXACTLY the five expected URLs are recorded.
- **Tests run:** `verify:recorder-navigation` 15/15; `verify:verifier-classification` reconciled;
  `verify:roadmap-dashboard` 158/158.
- **Tests not run:** `npm run build` (no product code changed), `verify:runner`, `verify:popup*`.
- **Still open:** whether deterministic replay needs ordered navigation events rather than a visited
  set; the rest of `awkit-n7n` (event correlation, navigation dedup across sources, mock-site
  navigation lab, the 34-item matrix).

---

## 2026-08-16 - Claude - Recorder multi-page/navigation audit, Phase 1 of awkit-n7n

- **Task:** Open `awkit-n7n` as the bead instructs — audit existing popup/page and navigation support
  BEFORE building anything.
- **Finding 1 — multi-page support is mature, do not rebuild it.** `RecorderService` has popup alias
  assignment, one async registration pipeline per popup, direct `page.on("popup")` opener attribution
  kept separate from the context event, and click-attribution slots that account for Playwright
  firing the popup event before the originating click commits. `FlowProfile` has switchToPopup /
  closePopup / switchToMainPage / PageAlias / PopupExpectation. The mock site has 24 popup scenarios;
  three popup verifiers exist.
- **Finding 2 — navigation/URL capture is implemented but unverified.** No verifier asserts recorded
  URL semantics. The only SPA checks assert clicks still record across a route change, not that the
  transition is captured. No navigation lab exists in the mock site.
- **Defect `awkit-39j` (P1, code-read only):** the init script's `kind:"url"` signal reaches only
  `this.signals` (Smart Wait), gated on `captureSmartWaits`; nothing routes it into `recordedUrls`.
  The sole path in is `page.on("framenavigated")`.
- **Defect `awkit-5sw` (P2, code-read only):** `emitUrl()` emits `origin + pathname`, dropping hash
  and query, so hash-only and query-only transitions emit an unchanged URL and are likely deduped
  away. A fix must preserve `maskUrl` masking.
- **Tests run:** none — this phase changed no code.
- **NOT DONE and explicitly not fudged:** the empirical measurement of which navigation kinds reach
  `recordedUrls`. The throwaway harness failed to start the mock-site server (wrong port variable
  first, then startup failure) and was abandoned with the finding recorded as code-read evidence
  rather than claimed as proven. That measurement is the required next step.
- **Result:** `awkit-n7n` remains OPEN with its audit recorded. Tracker 203 total / 195 closed /
  8 outstanding.

---

## 2026-08-16 - Claude - Recorder prerequisite trial generalized beyond click (awkit-5b9)

- **Task:** First tranche of the Recorder hardening brief (prerequisites, validation, keyboard,
  multi-tab, navigation). Investigation first, per the brief.
- **Root cause found and fixed:** `supportsAutomaticPrerequisiteTrial` was `type === "click"`, and
  both routes in `isValidInteractionExecutionDecision` depend on it, so `fill`/`select`/`check` with
  an `unknown` prerequisite were permanently blocked while being offered resolutions that could not
  work. Click-only was not arbitrary — Playwright has no `trial` option on `fill` — so the fix adds
  a real predicate proof rather than relaxing the gate.
- **Implementation:** `PREREQUISITE_TRIAL_MODES` (pointer = Playwright `trial:true`; predicate =
  `waitFor visible` + `isEnabled` + `isEditable`); `resolveClickTarget` → `resolveDirectActionTarget`
  wired into click/fill/select/check/uncheck/radio/hover. No `force`, no sleeps. Sensitive-action
  boundary unchanged. `press` deliberately ineligible (acts on focus, not the locator).
- **Tests run:** `verify:recorder-hover` **265/265** (was 236, +29); the new checks produce **12
  failures** against the click-only implementation. `verify:runner` **100/100**, `verify:recorder`
  **217/217**, `verify:recorder-ambiguity` **74/74**, `npm run build` PASS,
  `verify:roadmap-dashboard` 158/158.
- **Tests NOT run:** `verify:recorder-gui`, `verify:recorder-e2e`, `verify:popup*`,
  `verify:mock-site`, `validate:offline` — not reached in this tranche.
- **Two brief assumptions contradicted by evidence, filed not "fixed":** repeated validation warnings
  are NOT duplicate emission (each issue carries a distinct `nodeId`; the message renders
  `step.name`, so same-named steps look identical) → `awkit-8xx`. `Tab` is NOT recorded as fill text
  — `recorderInitScript` emits a `press` step with `valueSource {static, "Tab"}`, which is correct.
- **NOT STARTED:** multi-tab lifecycle, navigation/URL capture, SPA routing, navigation dedup,
  mock-site labs, the 34-item regression matrix, race coverage → `awkit-n7n`.
- **Process note:** worked without a write lease. The change spans `src/profiles` (persistence) and
  `src/runner` (runtime), which the routing model would sequence as separate leases; ordinary paths
  are unrestricted without one, and this is recorded rather than glossed.
- **Result:** `awkit-5b9` closed. Tracker 201 total / 195 closed / 6 outstanding.

---

## 2026-08-16 - Claude - Watch the gitignored paths that carry consequence (awkit-6ab)

- **Task:** `git status` never reports ignored files, so the Bash audit could not see writes to them.
- **Two registry defects found by auditing `.gitignore`, not just a blind spot:** `build/**` was
  release-owned and implied `packaging_change` while being fully gitignored with ZERO tracked files;
  and `resources/**` is PROTECTED (offline boundary) while `resources/browsers/` and
  `resources/oracle-jdbc/` are ignored subtrees.
- **Implementation:** `WATCHED_IGNORED_PATHS` — short and specific, because enumerating all ignored
  paths would mean walking `node_modules/`. Covers `.env`, `.claude/settings.local.json`, the
  captured-auth files, the two protected subtrees, and `build`. `fingerprintWatchedIgnored()` uses
  mtime+size for files and direct-entry names+mtimes for directories; `changedWatchedIgnored()` is a
  pure comparison. Recorded at grant as `baseline_watched_ignored`; `bash-audit.mjs` now draws from
  git AND the fingerprint.
- **Tests run:** `verify:agent-routing` **298/298**; mutation suites **12/12 + 4/4 + 6/6 + 6/6 +
  5/5 + 7/7 = 40/40**; `npm run build` PASS; `verify:roadmap-dashboard` 158/158.
- **Tests not run:** `verify:runner`, `validate:offline` — routing tooling only, no product code.
- **Mutation testing found real test gaps, twice over:** three of seven survived initially. One was a
  bad mutation of mine (`[].concat([])` is truthy, so it never emptied the list). The other two were
  genuine — every assertion drove the pure comparator with fixture strings, so breaking the
  fingerprint PRODUCER changed nothing. Added checks that run it against a real temp tree.
- **Demonstrated live:** a write to `build/audit-probe.tmp` was reported by name while
  `git status --porcelain build/` returned 0 entries.
- **Stated limit:** everything else ignored (`out/`, `dist/`, `graphify-out/`, `node_modules/`,
  logs) stays unwatched by design — derived artifacts, not source a lease protects.
- **Result:** closed. Tracker 198 total / 194 closed / 4 outstanding.

---

## 2026-08-16 - Claude - Close the no-lease gap for Risk 3 paths (awkit-mtt)

- **Task:** The guard allowed every edit when no lease was held.
- **Not fixed by reversing the default:** failing closed everywhere would block every task that does
  not use a contract, and a gate that stops all work gets removed rather than obeyed.
- **Implementation:** `PROTECTED_PATHS` derived from `PATH_DOMAINS` entries whose `impliesFlags`
  intersect `RISK_3_FLAGS` — exactly `src/licensing/**`, `src/auth/**`, `src/secrets/**`,
  `src/security/**`, `resources/**`. Ordinary paths stay unrestricted with no lease; these refuse an
  unclaimed write and name the owner. `unclaimedProtectedWrites()` gives `bash-audit.mjs` the
  symmetric rule against committed state.
- **Testability fix that was part of the work:** extracted `decideWrite()` from the hook's `main()`.
  Mutation P3 (allow protected paths with no lease) would otherwise have survived, because only
  `targetPathOf()` was covered — the guard's actual judgement was untested.
- **Tests run:** `verify:agent-routing` **277/277**; mutation suites **12/12 + 4/4 + 6/6 + 6/6 +
  5/5 = 33/33**; `npm run build` PASS; `verify:roadmap-dashboard` 158/158.
- **Tests not run:** `verify:runner`, `validate:offline` — routing tooling only, no product code.
- **Demonstrated live with no lease held:** `src/licensing/`, `src/secrets/`, `resources/` refused by
  name; `app/renderer/App.tsx` and `src/runner/exec.ts` allowed. Re-checked after the refactor.
- **Non-vacuity pinned both ways:** an empty protected set protects nothing; a set equal to every
  path reinstates fail-closed-everywhere. Both are asserted.
- **Result:** closed. Tracker 197 total / 193 closed / 4 outstanding.

---

## 2026-08-16 - Claude - Close the Bash write-lease bypass (awkit-c6n)

- **Task:** The PreToolUse guard matches `Edit|Write|NotebookEdit`, so shell writes bypassed it.
- **Rejected approach, on evidence:** matching `Bash` and scanning for `>` / `sed -i` is wrong in
  both directions — misses `python -c "open(...)"`, `tee`, `cp`, indirect scripts; blocks
  `echo "a > b"` and angle brackets in commit messages.
- **Implementation:** `tools/agents/bash-audit.mjs` as a **PostToolUse** hook observing the
  filesystem, not the command. `dirtyPaths()` (git status) minus lease scope, shared write paths,
  and `baseline_dirty` recorded at grant. Violations are written onto the lease;
  `completionBlockers(contract, { lease })` reads them back so detection has consequences.
- **Defect found by running it:** `grantLease` writes the lease file and mirrors `assignments.json`
  AFTER snapshotting the baseline, so taking a lease reported itself. Fixed with
  `SYSTEM_BOOKKEEPING_PATHS`.
- **Mutation testing found a second gap in my own tests:** widening that exclusion to "every
  `.json`" SURVIVED, because every out-of-lease fixture was `.ts`. Added an ordinary out-of-lease
  `.json` case and a cardinality check on the exclusion list.
- **Tests run:** `verify:agent-routing` **256/256**; mutation suites **12/12 + 4/4 + 6/6 + 6/6 =
  28/28**; `npm run build` PASS; `verify:roadmap-dashboard` 158/158.
- **Tests not run:** `verify:runner`, `validate:offline` — routing tooling only, no product code.
- **Demonstrated live:** a shell redirect to `docs/ai/PROJECT_BRIEF.md` under a `tools/agents/**`
  lease was reported by name and blocked; a command writing nothing stayed silent.
- **Stated limits:** detection not prevention (PostToolUse runs after the write); gitignored paths
  are invisible to `git status`; ~100ms per Bash call while a lease is held, zero when none is.
- **Result:** closed. Tracker 196 total / 192 closed / 4 outstanding.

---

## 2026-08-16 - Claude - package.json shared-write split (awkit-dwo)

- **Task:** Remove the lease friction measured on the first routed task — adding a one-line npm
  script required a full handoff to the Release specialist.
- **Root cause:** ownership is file-granular, but `package.json`'s risk is concentrated in specific
  keys. The `PreToolUse` guard runs before the edit and cannot see which key is changing.
- **Implementation:** `SHARED_WRITE_PATHS` in the registry marks `package.json` shared for `scripts`;
  `leaseAllows()` permits any holder to write a shared path; `deriveGuardedFieldChanges()` compares
  the committed file against the working tree and `findGuardedFieldEscapes()` reports any non-shared
  field change as a scope escape. Relaxed where content is invisible, strict where it is not.
- **Fail-closed by construction:** `sharedFields` is an allow-list, so unlisted keys are guarded;
  the key comparison runs over the union of both sides so removals count; an unparseable file is
  reported as guarded rather than clean.
- **Tests run:** `verify:agent-routing` **242/242**, **mutation-tested 6/6** including S2 (share the
  dependency fields — the fail-open direction) and S5 (default-shared instead of default-guarded).
  `verify:roadmap-dashboard` 158/158; `npm run build` PASS.
- **Tests not run:** `verify:runner`, `validate:offline` — routing tooling only, no product code.
- **Demonstrated live, not just asserted:** added `agent:check-agents` to `package.json` while
  holding a QA lease (previously blocked), then confirmed a dependency edit under that same lease is
  reported as a scope escape naming `release`.
- **Result:** closed. Tracker 195 total / 191 closed / 4 outstanding.

---

## 2026-08-16 - Claude - Router: narrow writerSequence to actual path owners (awkit-yeh)

- **Task:** Fix the rough edge the first routed task exposed — `writerSequence` listed activated
  writer-mode agents that owned none of the task's paths.
- **Implementation:** `route()` now intersects activated writers with owners of `expected_paths`;
  dropped writer-mode agents become consultants. Added `writerSequenceNarrowed` so callers can tell
  a narrowed sequence from the fallback. The manager, writer-mode and activated on every task, is now
  governed by ownership too.
- **The real hazard was the fix, not the bug:** `validate-contract.mjs` derives `touchesProductCode`
  from `writerSequence.length > 0`, so a naive narrowing would fail OPEN and stop requiring a writer
  on tasks with unmapped or mis-declared paths. The sequence falls back to the full activated-writer
  list whenever narrowing would empty it. A verifier check drives an unmapped-path contract through
  `validateContract` and requires `writer.absent` to still fire.
- **Tests run:** `verify:agent-routing` **228/228**, **mutation-tested 4/4** — including R2, which
  removes the fail-closed fallback and is caught. `verify:roadmap-dashboard` 158/158;
  `npm run build` PASS.
- **Tests not run:** `verify:runner`, `verify:settings-persistence`, `validate:offline` — no product
  code was touched; this is routing tooling only.
- **Corrected mid-task:** the first version of the docs-task assertion was wrong, not the code — the
  manager legitimately writes documentation, so a docs task routes `manager` as its writer rather
  than having no writer at all.
- **Result:** closed. Tracker 194 total / 190 closed / 4 outstanding.

---

## 2026-08-16 - Claude - Harden Windows settings atomic replacement retries (awkit-4qs)

- **Task:** First real task routed end to end through the deterministic routing system.
- **Defect:** `writeSettings` did `writeFile(tmp)` + `rename(tmp, target)`. Crash-safe, but a
  transient Windows `EPERM`/`EBUSY` from a scanner/indexer handle discarded the settings write.
- **Implementation:** new `app/main/atomicReplace.ts` — `replaceFileAtomically()` retries only
  `EPERM`/`EBUSY`, bounded (5 attempts, 20ms linear backoff), rethrows the original errno, removes
  the temp file on every terminal path, leaves the prior target intact. `uiSettings.ts` delegates to
  it. Schema, IPC and serial FIFO ordering untouched.
- **Routing:** classified Risk 2 (`electron_main_change`, `filesystem_write_change`); activated
  manager, runtime, persistence, qa, qc. Contract at `docs/ai/contracts/awkit-4qs.json` declared
  evidence BEFORE implementation. Lease moved runtime -> qa -> manager sequentially, never
  concurrent.
- **Tests run:** `verify:write-queue` **29/29** (was 7), **mutation-tested 5/5**;
  `verify:settings-persistence` **3/3** real Electron (40 concurrent patches lossless, 0 temp files,
  flush-on-quit); `npm run build` PASS; `verify:agent-routing` 215/215;
  `verify:roadmap-dashboard` 158/158.
- **Tests not run:** `verify:settings-e2e`, `verify:runner`, `validate:offline` — no renderer,
  runner or packaging code was touched.
- **Found by the routing system:** `.beads/**` was unmapped, so no specialist owned the tracker
  export; now manager-owned. Also confirmed the preserved stash is docs-only and never overlapped
  this settings scope, resolving a standing handoff caution.
- **Rough edge recorded:** `writerSequence` lists writer-mode agents activated purely by flag even
  when they own none of the task's paths (persistence led the sequence here with nothing to write).
- **Result:** closed. Tracker 193 total / 189 closed / 4 outstanding, all owner-gated.

---

## 2026-08-16 - Claude - Phase 5: generated platform agent definitions, model dogfooded

- **Task:** Generate executable per-platform agent definitions from the canonical routing registry
  and reconcile the existing skills against the 11 roles (`awkit-bk3`).
- **Implementation:** `tools/agents/render-platform-agents.mjs` emits 11 `.claude/agents/*.md`
  subagent definitions (tool grants derived from mode, so a read-only role gets no Edit/Write) plus
  one adapter skill each for Codex and Gemini, which have no per-role agent runtime here. Added
  `ROLE_SKILLS` reconciling the 12 installed skills to roles; added `.claude/**`, `.codex/**` and
  `.gemini/**` to the path map.
- **Defects found by dogfooding the system on its own task:** the registry held two ownership lists
  (`AGENTS[].ownsPaths` for leases, `PATH_DOMAINS[].owner` for classification) that had drifted in
  three places - `tools/agents/**` and `app/preload.ts` missing from their owners' `ownsPaths`, and
  the Architect's two documents resolving to the Manager. A lease amendment consequently rerouted
  work to the specialist that already owned it. Added a bidirectional consistency check, which
  caught the `app/preload.ts` case the moment it was written.
- **Enforcement proven live:** an Edit to `docs/ai/CURRENT_STATE.md` under a `release` lease scoped
  to `package.json` was refused by the PreToolUse hook in the real runtime; the amendment rerouted to
  `manager` rather than widening the lease.
- **Tests run:** `verify:agent-routing` **213/213**; mutation harness **12/12 killed** (4 new);
  `npm run build` PASS; `verify:roadmap-dashboard` 158/158 "Sources agree";
  `verify:verifier-classification` PASS; `verify:source-hygiene` 9/9; `check-memory.mjs` PASS.
- **Tests not run:** `verify:runner`, `verify:flow-designer`, `verify:workflow-builder`,
  `validate:offline` - no runner, renderer or packaging code was touched.
- **Measured friction, not smoothed over:** adding a one-line npm script needs a lease handoff to
  `release`, because `package.json` carries the dependency graph. Deliberate checkpoint, real cost.
- **Result:** Phases 0-5 complete. The routing model has now governed a real task.

---

## 2026-08-16 - Claude - Review and implement deterministic multi-agent routing (Phases 0-4)

- **Task:** Review a proposed multi-agent routing/task-contract architecture, judge whether it was
  sufficient, then implement the corrected Phases 0-4 (`awkit-a1u`).
- **Review outcome:** design sound, specification insufficient. Five factual errors against the repo
  (`src/orchestration` vs `src/orchestrator`; root `DEFECTS.md`; an evidence vocabulary that
  near-missed `LEDGER_STATUSES` with `NOT_RUN`/`INCONCLUSIVE`; a new `.ai/` beside the existing
  `docs/ai/tasks`; doc-only "agents"). Three structural gaps: determinism was a pre-implementation
  prediction, routing was encoded three times with the copies already disagreeing, and the write
  lease had no enforcement. Plus a vacuous completion gate and no dashboard visibility.
- **Implementation:** `tools/agents/` — `routing-matrix.mjs` (single registry: 11 agents, path map,
  activation, risk), `classify.mjs` (declared + derived-from-diff, scope escapes), `route.mjs`
  (deterministic activation, sequential writer order), `validate-contract.mjs` (rejection rules +
  `requireCardinality` before every `.every()`), `lease.mjs` / `lease-guard.mjs` / `lease-cli.mjs`
  (PreToolUse-enforced lease, amend-reroutes, logged overrides), `render-docs.mjs`. Docs:
  `docs/ai/routing/{ROUTING_MATRIX.md,ROUTING_RULES.md,TASK_CONTRACT.schema.json}` and
  `docs/ai/contracts/`. Contracts are JSON, not YAML — no YAML parser exists and adding one would
  itself be a `new_dependency` change.
- **Tests run:** `npm run build` PASS; `verify:agent-routing` **119/119**; mutation harness **8/8
  killed**; `verify:roadmap-dashboard` **158/158** ("Sources agree"); `verify:verifier-classification`
  179 commands; `verify:source-hygiene` 9/9; `check-memory.mjs` PASS; write-lease hook driven
  end-to-end with real payloads (in-scope allow, out-of-scope block relative + absolute, outside-repo
  allow, damaged-lease block).
- **Tests not run:** no runner/renderer/packaging code was touched, so `verify:runner`,
  `verify:flow-designer`, `verify:workflow-builder` and `validate:offline` were not re-run.
- **Notable:** the first mutation round found a real hole in this work — deleting the completion
  gate's own cardinality guard left the suite green, because the assertion was satisfied by
  `validateContract`'s independent rule instead of the guard it named. Fixed by asserting the gate's
  own blocker text and that both guards fire.
- **Result:** Phases 0-4 complete and enforced. Phase 5 (executable `.claude/agents/*.md` plus Codex
  and Gemini adapters, generated from the registry) deliberately deferred.

---

## 2026-08-15 - Codex - Restore and verify the Loop capsule-and-ring contract

- **Task:** Continue from restored checkpoint `13dfc7a`, verify the authoritative augmented `7282178`
  capsule-and-ring Loop in both designers, repair any exposed production/test defect without changing
  runtime semantics, capture fresh rendered evidence, reconcile project state, and push `main`.
- **Failure reproduced:** the restored renderer and canvas geometry disagreed. `LoopEdge` drew the approved
  160-unit capsule with a 44-unit hit ring, but `FlowCanvas` collision/fit still modelled the rejected
  roughly 80-unit U-route marker. The initial Flow focused gate failed drag-side stability (12/13), while
  the old broad child aborted on removed direction descendants. Workflow's old child similarly timed out
  on an absent direction path; its focused harness sampled a panel transition and left a properties panel
  intercepting a later node-menu click. These were product geometry plus verifier-contract/harness defects,
  not evidence that the capsule target was wrong.
- **Implementation:** centralized the 160x20/r10 and 40/30/44 geometry plus a full lane/ring/hit/label
  footprint; reused it for rendering, collision-side scoring, and fit bounds; pinned the two-second orbit
  token; left structured Loop persistence, IPC, and execution untouched. Added a connected peer exactly
  100 graph units from the owner and binding full-containment/collision checks, including physical
  right -> left -> right peer-drag recomputation.
- **Coverage:** made visibility, stacking, accessibility, interaction, no-overlap, unique-id, and negative
  mutations binding; bounded long summaries to the 160-unit lane with ellipsis/full title; proved
  sweep-only computed and pixel motion, single/two-Loop reduced motion, 25/100/200% zoom plus pan in both
  designers, owner/peer drag, independent selection/config/timelines, exact dotted/4px styling, pointer/
  double-click/Enter/Space access, two app-backed save/reload cycles, configuration Undo/Redo, destructive
  Delete/Undo/Redo, and one Conditional exit. Hardened the broad adapter against killed/truncated/
  wrong-count/incomplete children while executing all 128 Flow and 74 Workflow checks and retaining the
  separate legacy cross-node `loopBack` assertions. The focused 15/16 check names and order are frozen.
- **Visual evidence:** opened both designers' light/dark 1440x900 captures under
  `reports/loop-capsule-verification/2026-08-15/` beside the historical reference. All four show the compact
  attached capsule, dominant clean concentric ring, centered configured value, readable external label,
  and current theme accents without a whole-card U-route, detached marker, bright bars, or beaded overlay.
- **Gate repairs:** verifier classification initially failed one check because the two intentional internal
  pre-capsule child files lacked justified exemptions; added exact reasons and returned to reconciled.
  Roadmap initially passed the tracker counts but failed 154/156 because the newest Current State section
  omitted the unchanged ledger tally; restored **63 PASS / 2 NOT RUN / 1 BLOCKED**, returning to
  **157/157 - Sources agree**. The first definitive Workflow run then found the known startup race as one
  unexpected `workflow table not found` failure even though focused Loop checks were 16/16. Replaced its
  swallowed navigation/1.2-second delay with waits for the real navigation, library surface, and visible
  table; the canonical regression rerun returned to **74 observed / 15 retired / 0 unexpected + 16/16**.
  Expanded lifecycle coverage then exposed verifier mistakes rather than product regressions: an Undo
  assertion ignored intentional 300ms edit coalescing; test drags moved toward peers/insertion controls;
  a Flow Delete probe deselected the edge before pressing Delete; and a topology query expected a
  `data-connector-kind` attribute the shared canvas never emits for ordinary Conditional edges. Each was
  corrected to synchronize on observable state and assert the real history/loop-exit contract without
  sleeps, forced clicks, or weakened capsule geometry. Direct focused reruns finished Flow **15/15** and
  Workflow **16/16** with their exact ordered inventories.
  Generated dashboard output was not edited.
- **Verified:** build PASS; Flow canonical **128 observed / 16 retired / 0 unexpected + 15/15 focused**;
  Workflow canonical **74 observed / 15 retired / 0 unexpected + 16/16 focused**; runner **100/100**;
  Mock Site **145/145**; source hygiene **9/9**; classification **178** commands/files reconciled;
  roadmap **157/157 - Sources agree**; `git diff --check` PASS; Graphify **12,284 nodes / 25,532
  edges / 618 communities**; repository AI-memory check PASS.
- **Tracking/Git:** `awkit-6cg` was reopened while the restored-capsule defects were active, its obsolete
  U-route description/acceptance was replaced, and it was reclosed only after current evidence passed.
  Final tracker: **191 total / 186 closed / 5 outstanding / 104 edges**; settings-only `awkit-4qs` remains
  separate, open, and unclaimed. Commits `24995a7` and `942c858` contain production/test work; the current
  repository-memory/tracker commit records closeout. All are committed directly to `main`; the final
  report records push synchronization. The pre-existing named stash was left untouched.

---

## 2026-08-14 - Codex - Close corrective Loop acceptance and reconcile Program Status

- **Task:** Resume the corrective Loop checkpoint, preserve interrupted tracker/test work, finish the
  missing legacy-return and visual acceptance, and leave the settings retry as a separate task.
- **Coverage:** added a persisted cross-node `loopBack` plus ordinary-edge negative control to the real
  Workflow Builder walkthrough; asserted visible base stroke, distinct return geometry, one direction
  animation/arrow, mode-safe label, no marker/value, stable zoom/drag animation identity, and a
  hidden-base-path mutation that turns the visibility oracle red. Manual review then exposed owning-card
  label occlusion; moved summaries into the clear band above the card and added no-overlap guards in both
  designers across rest/zoom/drag/multiple-Loop/reduced-motion states.
- **Visual evidence:** opened and manually inspected Flow Designer and Workflow Builder light/dark
  1440x900 captures under `reports/loop-connector-closeout/2026-08-14-takeoff/`; all four pass for
  full label/path/marker/arrow readability and theme contrast. Workflow evidence shows both independent
  Loops with the inspector collapsed, toast dismissed, and canvas refit.
- **Verified:** build PASS; Flow GUI **128/128**; final Workflow GUI **74/74**; classification **178**;
  roadmap **157/157 - Sources agree**; Graphify refresh PASS; AI-memory check PASS. One immediately
  preceding Workflow run was **73/74 FAIL** when its unrelated first Workflows-table probe raced startup;
  both new Loop checks passed in that run and the immediate rerun was green. `verify:all-typecheck`
  rebuilt the app successfully, then FAILED on the same nine documented pre-existing script-only
  diagnostics outside this scope.
- **Tracking:** closed `awkit-6cg`; kept settings-only `awkit-4qs` open; removed the completed claim;
  exported **191 total / 186 closed / 5 outstanding / 104 edges**. Validation ledger remains
  **63 PASS / 2 NOT RUN / 1 BLOCKED**.
- **Commits:** `8eef3c0` adds the focused verifier; `4e95bcc` adds label clearance, both rendered guards,
  tracker/roadmap reconciliation, and closeout memory. Both were pushed directly to `origin/main`; this
  documentation-only push record follows them.

---

## 2026-08-14 - Codex - Checkpoint corrective Loop connector implementation

- **Task:** Correct Loop design, path animation, labels, editing/persistence, multiple-Loop isolation,
  geometry continuity, keyboard deletion, Conditional exits, and regression quality in both visual
  designers, then stop and prepare a lossless agent handoff.
- **Implementation:** moved motion from the marker to one real-path dash plus static arrow; reduced
  route/marker footprint; added mode-aware design labels and shared new-Loop style defaults; kept
  Loop DOM identity persistent through drag; rendered legacy `loopBack` as a return curve without
  changing runtime semantics; preserved Loop/style data through designer and Workflow/Scenario cycles;
  and added Delete/Backspace handling.
- **Coverage:** two independent Loops; create/configure/undo/redo/save/reload/reconfigure; Enter/Space/
  pointer/inspector/keyboard deletion; reduced motion; node drag and 25/100/200% zoom; unknown nested
  metadata; legacy payload; style conversion; exit idempotence; data-source runtime cleanup.
- **Verified:** build PASS; Flow GUI **128/128**; Workflow GUI **72/72**; mapping **142/142**;
  conversions **20/20**; branches **40/40**; runner **100/100**; validation **134/134**; history
  **14/14**; layout **35/35**; canvas perf **13/13**; Mock Site **145/145**; source hygiene **9/9**;
  random round trip **27/27**; verifier classification **178**. Roadmap **155/157 FAIL** from the
  pre-existing combined tracker item/count pins. Focused Playwright spec is
  environment-BLOCKED before collection; final dark/light screenshot inspection and Graphify refresh
  are NOT RUN.
- **Commits:** `31f32af` production; `22fd95b` tests. Pre-existing `.beads/issues.jsonl` and
  `tools/roadmap/assignments.json` edits remain intentionally dirty and are documented in HANDOFF.

---

## 2026-08-13 - Codex - Implement the reference Loop return path and configured marker

- **Task:** Replace the obscured card-centered Loop ring with the supplied reference's continuous rounded
  return path and compact animated marker in both visual designers.
- **Implementation:** routed structured self-loops bottom-center to top-center around a collision-aware card
  side; integrated a 48-unit marker on the path; bound its stationary text directly to persisted
  `loop.maxIterations`; retained one 2-second transform-only sweep and a static reduced-motion state; and
  extended fit bounds, drag routing, accessible naming, and the canvas zoom floor to the advertised 25%.
- **Safety:** no fake node, display count field, persistence/schema, validation, IPC, runner, or execution
  change. Non-self connector rendering and the existing Loop editor/Configure/Remove paths remain intact.
- **Verified:** build PASS; Flow Designer Electron GUI **113/113**; Workflow Builder Electron GUI **60/60**;
  Flow mapping **137/137**; workflow conversions **14/14**; branch pairs **36/36**; canvas performance
  **13/13**; canvas layout **35/35**; source hygiene **9/9**. Inspected light/dark screenshots for both
  editors at desktop size; the GUI suites also cover 25/100/200% zoom.
- **Files:** shared canvas geometry/types/fit routing/Loop renderer, Hologram CSS, both Electron GUI
  verifiers, and repository AI memory.

---

## 2026-08-12 - Codex - Center the Loop ring behind its real workflow node

- **Task:** Correct the Loop's visual ownership: it is a node-owned ring centered behind the real card,
  not a detached pill, badge, side mechanism, or synthetic node.
- **Root cause:** the preceding implementation treated the reference as a separate left/right graph
  component. Its tests verified size and motion but encoded separation from the node instead of exact
  card/ring center equality and natural layering.
- **Implementation:** removed the lane, bridge, arrow, filled backplate, center badge, and side-selection
  geometry; derived concentric ring radii from the measured card height; centered the edge endpoints on the
  card's top/bottom; and relied on the existing edge-below-node layers for natural occlusion. The exposed
  arc retains a 24-unit hit stroke, the bright sweep remains transform-only, and reduced motion is static.
- **Safety:** the dragging-edge overlay keeps the ring attached to the real card. Pointer/keyboard and
  node-menu Configure/Remove actions, persisted styles/configuration, Conditional exits, validation, Loop
  Back, and runtime semantics remain on their existing paths.
- **Verified:** build PASS; Flow Designer Electron GUI **110/110**; Workflow Builder Electron GUI **57/57**;
  runner **99/99**; mock site **145/145**; validation **134/134**; Flow step mapping **137/137**; workflow
  conversions **14/14**; branch pairs **36/36**; canvas performance **13/13**; canvas layout **35/35**;
  source hygiene **9/9**; verifier classification reconciled.
- **Files:** shared canvas geometry/fit bounds/Loop edge, Hologram CSS, both real-Electron GUI verifiers,
  tracker sources, and AI memory.

---

## 2026-08-12 - Codex - Match the Loop connector to the detached owner sketch (superseded)

- **Task:** Correct the prior central Loop result, which still appeared as a small badge attached to its
  node, and make the sketched pill-and-ring mechanism a separate, dominant workflow component.
- **Root cause:** the prior geometry used a 160x20 pill and 80-unit outer circle whose near end touched the
  node. Its GUI assertions proved the parts and animation existed, but did not assert separation,
  card-relative scale, an explicit bridge/arrow, or complete viewport visibility.
- **Implementation:** expanded the shared mechanism to a 280x40 pill, 160-unit outer circle, 120-unit main
  ring, and 176-unit hit target; inserted a 60-unit straight bridge with an arrow into the node; retained
  collision-aware left/right placement; and reframed after Loop add/remove once the new edge state commits.
  One bright segment rotates on the stable rings; reduced motion keeps a static highlighted segment.
- **Safety:** pointer, double-click, Enter/Space, node-menu Configure/Remove, persisted styles/configuration,
  Conditional exits, validation, Loop Back, and runtime semantics remain on their existing paths.
- **Verified:** build PASS; Flow Designer Electron GUI **109/109**; Workflow Builder Electron GUI **56/56**;
  runner **99/99**; Flow step mapping **137/137**; workflow conversions **14/14**; branch pairs **36/36**;
  canvas performance **13/13**; canvas layout **35/35**; source hygiene **9/9**. Captured both designers and
  visually confirmed the full detached mechanism; no mock-site fixture was applicable to the desktop canvas.
- **Files:** shared canvas geometry/fit bounds/Loop edge, both editor mutation flows, Hologram CSS, both
  real-Electron GUI verifiers, tracker sources, and AI memory.
- **Superseded:** subsequent owner clarification established that separation was the wrong model; the Loop
  ring must share the real node's exact center and sit behind it. The entry above records the correction.

---

## 2026-08-12 - Codex - Replace the Loop arc with a central circular control (superseded proportions)

- **Task:** Implement the clarified Loop visual in Flow Designer and Workflow Builder: a horizontal
  connector lane with a dominant concentric circular control, continuous orbit, and the circle itself as
  the reconfiguration target.
- **Root cause:** the earlier Exit Loop `+` and exposed top-arc fixes improved separate affordances but still
  modeled the structured Loop as an ordinary edge. They did not match the requested control mechanism.
- **Implementation:** added a token-derived 160x20 capsule, 80-unit concentric mechanism, fixed center dot,
  88-unit hit target, and one 2-second transform-only rotating sweep. The shared canvas chooses a collision-
  clear side, defaults away from the right inspector, includes the control in fit-to-view, and gives the
  semantic Loop renderer precedence over legacy visual shapes. Click, double-click, Enter, and Space reuse
  the existing connector configuration path; reduced motion freezes a readable highlighted arc.
- **Safety:** Loop authoring data, persistence, validation, execution, Conditional exits, and legacy Loop
  Back are unchanged. Authored connector color, thickness, and line pattern stay on the stable route.
- **Verified:** build PASS; Flow Designer Electron GUI **109/109**; Workflow Builder Electron GUI **56/56**;
  Flow step mapping **137/137**; workflow conversions **14/14**; branch pairs **36/36**; canvas performance
  **13/13**; canvas layout **35/35**; source hygiene **9/9**. Both GUI suites also decode two timed
  screenshots and assert a real pixel delta for the rotating sweep.
- **Files:** shared canvas side routing/fit bounds/Loop edge, connector visual mapping, Hologram CSS, both
  real-Electron GUI verifiers, and AI memory/tracking sources.
- **Superseded:** owner review found the 160x20 / 80-unit-outer mechanism still read as a node-attached
  badge. The later entry above records the corrected detached geometry and stronger acceptance checks.

---

## 2026-08-12 - Codex - Correct the visible Loop circle and motion target

- **Task:** Fix the reported unchanged Loop size and invisible animation after `5cc98c9` in Flow Designer
  and Workflow Builder without changing connector semantics.
- **Root cause:** the prior patch enlarged the separate Conditional-exit insertion `+`; the structured
  self-loop SVG remained a 54px right-bulging curve with roughly 57-60% hidden beneath its node. Its moving
  segment existed but travelled primarily behind the opaque card.
- **Implementation:** restored dedicated measured top anchors, enlarged the exposed arc by approximately
  1.33x horizontally / 1.48x vertically, expanded its interaction stroke to 28px, and added repeating
  source-to-target segments on a 1.8-second linear cycle. The 32px Exit Loop `+` keeps its stable glyph and
  now uses a more legible 2.2-second linear halo; reduced motion uses static direction/ring cues.
- **Safety:** connector schema, persistence, validation, runtime routing, generic controls, and legacy Loop
  Back are unchanged. GUI verifiers now use isolated Electron user-data locks, measure real temporal motion,
  assert exposed geometry, and direct-click the Loop arc.
- **Verified:** build PASS; Flow Designer **107/107**; Workflow Builder **54/54**; Flow mapping **137/137**;
  workflow conversions **14/14**; canvas performance **13/13**; canvas layout **35/35**; source hygiene
  **9/9**. Rendered evidence was inspected in both designers under `reports/loop-connector-fix/`.

---

## 2026-08-12 - Codex - Restore the original Loop visual and animate its exit control

- **Task:** Keep the existing Loop model/runtime/validation intact, restore the owner-requested original
  self-loop connection shape, and enlarge/animate the Loop/Exit Loop circular `+` in both designers.
- **Implementation:** restored the centered right-bulging self-loop while retaining its directional SVG
  layer and reliable Configure action. Structurally tagged Conditional Loop exits at render time, enlarged
  only their control from 24px to 32px, let the shared `+` render at 14px, added collision-aware source-stem/
  side routing and label clearance, and added a tokenized 2.2-second halo with a static reduced-motion state.
  Flow edge insertion also preserves optional type-derived Conditional semantics.
- **Safety:** no connector schema, persisted display flag, validation/runtime policy, IPC contract, remote
  asset, dependency, or mock-site route changed. Generic connector controls and legacy Loop Back remain
  unchanged.
- **Verified:** build PASS; Flow Designer **106/106**; Workflow Builder **53/53**; Flow mapping **137/137**;
  workflow conversions **14/14**; canvas performance **13/13**; canvas layout **35/35**; source hygiene
  **9/9**.
- **Files:** shared canvas geometry/edge rendering/styles; Flow/Workflow render-only edge data and insertion
  mapping; focused real-Electron GUI verifiers; AI memory/tracking sources.

---

## 2026-08-11 - Codex - Fix Loop reconfiguration and directional connector motion

- **Task:** Complete `awkit-kwg` by repairing existing Loop reopening/reconfiguration and adding a
  clear direction animation in both visual designers, extending `88b964f` without weakening validation.
- **Implementation:** made Loop paths choose an unobstructed node side, isolated edge pointer gestures
  from pane panning, reopened collapsed inspectors on connector selection, and added explicit Configure
  loop menu actions. Preserved workflow node ids across load and type-derived Flow Loop metadata across
  re-save. Added a separate derived SVG direction layer that leaves authored line styling intact and
  disappears for reduced motion.
- **Safety:** no connector schema, runtime routing, validation rule, IPC contract, storage key, remote
  dependency, or mock-site route was added; legacy Loop Back remains distinct.
- **Verified:** build PASS; Flow Designer **99/99**; Workflow Builder **48/48**; Flow mapping **137/137**;
  runner **99/99**; validation **134/134**; branch pairs **36/36**; workflow conversions **14/14**;
  canvas performance **13/13**; canvas layout **35/35**; source hygiene **9/9**.
- **Files:** shared canvas edge geometry/rendering/styles; Flow/Workflow designer node actions and load/
  save boundaries; focused GUI/mapping verifiers; AI memory/tracking sources.

---

## 2026-08-11 - Codex - Complete Loop connector authoring in both visual designers

- **Task:** Complete `awkit-pwc`: make structured Loop connectors fully authorable, persistent,
  validated, and executable in Flow Designer and Workflow Builder without weakening validation.
- **Implementation:** added a shared loop/while-condition editor and shared exit-promotion policy;
  adding a Loop now selects it, opens its configuration, and converts existing Standard exits to
  explicit Conditional exits. Workflow/Scenario edges now round-trip `LoopConnectorConfig` and
  `maxLoopCount`; workflow execution shares canonical loop value materialization with Flow execution
  and supports bounded count/list/data-source/while-condition and legacy Loop Back routing.
- **Safety:** structured Loops remain self-only; the existing 1,000-iteration cap and run-gate
  structure checks remain authoritative; missing while conditions are now rejected. No new connector
  model, remote dependency, API, IPC, storage key, or mock-site route was introduced.
- **Verified:** build PASS; Flow Designer **93/93**; Workflow Builder **41/41**; runner **99/99**;
  validation **134/134**; branch pairs/authoring **36/36**; workflow conversions **14/14**.
- **Files:** renderer loop editor/authoring helper and both designer pages; Workflow/Scenario profiles;
  Flow/Workflow runtime validation and routing; focused verifier scripts; AI memory/tracking sources.

---

## 2026-08-09 - Codex - Professionally redesign and visually correct core UI surfaces

- **Task:** Complete `awkit-7le`: visually redesign Workflow Builder, Flow Designer, Users, Roles,
  Permissions, Audit Log, Licensing, Workflows, and embedded Program Status through rendered evidence.
- **Implementation:** made editor rails dense and task-led; replaced redundant/disabled editor chrome
  with icon utilities and a read-only execution summary; removed duplicate Administration hierarchy;
  made Users, Roles, Permissions, and Audit Log table-first and scannable; made Workflows full-width;
  and preserved the Program Status right rail through supported desktop widths. Existing handlers,
  IPC, RBAC, licensing, persistence, execution, and offline boundaries are unchanged.
- **Visual evidence:** captured before, intermediate, and final renders; manually inspected final dark
  and light screenshots for all nine required surfaces at 1440x900. Responsive assertions cover
  1024x768, 1280x800, 1440x900, and 1920x1080 where applicable.
- **Verified:** build PASS; Workflow Builder **37/37**; Flow Designer **89/89**; Administration
  **29/29**; Settings/Program Status **173/173**; licensing **183/183**; licensing E2E **38/38**;
  RBAC E2E **70/70**; accessibility **14/0**; Mock Site **145/145**; source hygiene **9/9**;
  verifier classification reconciled. `typecheck:scripts` has only the same nine pre-existing
  diagnostics.
- **Tracking:** closed `awkit-7le`; tracker **187 total / 183 closed / 4 outstanding / 104 edges**;
  ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**.

---

## 2026-08-09 - Codex - Unify editor and Administration UI surfaces

- **Task:** Complete `awkit-39h`: redesign the Workflow Builder and Flow Designer command bars,
  Administration family, Workflows table, and embedded Program Status presentation.
- **Implementation:** added shared editor command primitives; grouped both editor toolbars; compacted
  Undo/Redo; kept validation as derived state; introduced the shared Administration header/summary/
  layout grammar; grouped the real permission model; added audit filters; made Workflows fluid; and
  moved the canonical embedded roadmap navigation to a responsive right rail.
- **Safety:** no IPC, persistence, execution, permission, or licensing behavior changed. Program
  Status still uses the shared roadmap renderers plus the offline snapshot IPC and exposes neither
  localhost nor the portable-build action.
- **Verified:** build PASS; Workflow Builder **36/36**; Flow Designer **88/88**; Administration
  **24/24**; Settings/Program Status **172/172**; licensing **183/183**; licensing E2E **38/38**;
  RBAC E2E **70/70**; reports/settings accessibility **14/0**. Dark/light evidence covers every affected
  surface, with Workflow Builder also checked at 1024 wide and Flow Designer at 1936 wide. Source hygiene
  **9/9**, verifier classification, roadmap **157/157 —
  Sources agree**, AI memory, and Graphify refresh (**12,115 nodes / 25,110 edges / 612 communities**)
  also pass.
- **Tracking:** closed `awkit-39h`; tracker **186 total / 182 closed / 4 outstanding / 104 edges**;
  ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**.

---

## 2026-08-08 - Codex - Complete Super User, Recorder UX, session, and editor-history tranche

- **Task:** Implement epic `awkit-3jm` and its nine acceptance-matrix children.
- **Implementation:** Embedded the exact dashboard for Super Users; added bounded redacted Debug Mode
  and persisted inactivity policy; added canonical Recorder `press` capture/replay, confirmed Clear All,
  dependency-aware delete, and whole-row URL activation; added shared bounded undo/redo to both canvas
  editors; polished the Unsaved Changes dialog's alignment, focus, responsiveness, and motion behavior.
- **Safety/compatibility:** privileged route and IPC checks are independent; debug retention is bounded;
  protected input and synthetic/repeat keyboard events are ignored; delete cleans synthetic waits,
  popup lifecycle dependencies, and ambiguity/provenance state; legacy profiles/settings remain valid.
- **Verified:** Super User **49/49**; Settings E2E **170/170**; hotkeys **37/37**; Recorder actions
  **20/20**; history **14/14**; Flow Designer **87/87**; Workflow Builder **34/34**; hover **236/236**;
  Mock Site **145/145**; runner **95/95**. Nine targeted mutations went red before restoration.
- **Release:** no push and no fresh signed portable package; those remain owner/environment decisions.

---

## 2026-08-08 - Codex - Harden Recorder Smart Wait causality

- **Task:** Stop unrelated post-click activity from becoming fatal Recorder completion conditions
  (`awkit-dl7`).
- **Implementation:** Added versioned causal evidence; required/optional/advisory semantics; bounded
  timer/click/navigation attribution; identity-bound pre/post transitions; route dominance; specific
  runner diagnostics; and Flow Designer evidence details. Legacy/manual waits remain authoritative.
- **Verifier:** real Chromium Recorder observation -> buildRecordedFlow -> JSON -> StepExecutor plus
  the A-T causality/identity matrix plus route privacy boundary is **33/33**.
- **Mutation proof (32-assertion gate):** promote enables **28/4**; remove competing cause **30/2**;
  ignore identity **31/1**; ignore route dominance **31/1**; optional fatal **31/1**; restored
  **32/32**. A final route-privacy assertion subsequently raised the green gate to **33/33**.
- **Security:** safe origin/path metadata only, fingerprints hashed before save, no force or sensitive
  policy change. External YouTube acceptance was not run.

---

## 2026-08-08 - Codex - Separate interaction prerequisite decisions from locator identity

- **Task:** Remove the Flow Designer dead-end where a unique, proven locator with an unknown
  interaction prerequisite was mislabeled `needs-review`, duplicated in validation, and offered no
  safe way to execute or resolve the prerequisite.
- **Implementation:** Added a binding-scoped execution-decision contract. Normal clicks default to a
  Playwright actionability trial; user confirmation requires a reason; target/action edits invalidate
  stale authority; sensitive actions stay blocked. Runtime performs trial, cancellation check,
  identity re-resolution, then a normal click, never `force`. The Designer exposes direct-trial,
  confirmation, and re-record controls and validation emits a distinct prerequisite blocker.
- **Compatibility:** Legacy prerequisite-only locator reviews normalize to resolved identity while
  retaining unknown prerequisite state and requiring a valid execution decision.
- **Files:** profile/recorder/runner/validation contracts, Flow Designer mappings and properties panel,
  focused verifier suites, Mock Site documentation, tracker, and AI memory.
- **Verified:** build PASS; Flow Designer GUI **72/72**; mapping **133/133**; validation **132/132**;
  runner **95/95**; hover **236/236**; Recorder **217/217**; Recorder flow **33/33**; guard **35/35**;
  safety **17/17**; source hygiene **9/9**. `typecheck:scripts` retains only nine pre-existing errors.

---

## 2026-08-07 - Codex - Show portable release base in the roadmap dashboard

- **Task:** Display the main commit and version that form the base of the portable EXE release.
- **Implementation:** The dashboard's portable-build status now derives main through fixed,
  shell-free Git calls and reads main:package.json, returning branch, full SHA, current version, and
  the calculated patch target. The sidebar displays the short SHA and version transition; the full SHA
  is available in its tooltip and the confirmation dialog. The wording makes clear that the release
  wrapper creates the version commit from this clean base before packaging.
- **Boundary:** The disclosure is read-only repository identity. It exposes no command, arguments,
  working directory, environment, path, or child process output and does not alter the fixed release
  action.
- **Files:** tools/roadmap/server.mjs, tools/roadmap/public/index.html, dashboard.js, dashboard.css,
  scripts/verify-roadmap-dashboard.mjs, tools/roadmap/README.md, docs/ai/ARCHITECTURE.md, and this
  AI memory.
- **Verified:** npm run verify:roadmap-dashboard **157/157** after tracker reconciliation; npm run
  build; npm run verify:source-hygiene **9/9**; AI-memory check.

---

## 2026-08-07 - Codex - Preserve reliable semantic locators after insertion-tracking saturation

- **Task:** Fix a Recorder false positive surfaced in Flow Designer: a unique, high-confidence
  role locator was marked `needs-review` with “insertion tracking saturated — provenance unknown”.
- **Root cause and fix:** The saturation guard conflated an action owner's absence from the narrow
  hover visibility catalog with absence from the page at the recording baseline. The Recorder now
  snapshots every baseline light-DOM element in a `WeakSet` and treats only a target missing from that
  snapshot as possibly inserted. This leaves the existing fail-closed review for a truly
  post-baseline, unrecorded target intact.
- **Regression coverage:** Extended `/recorder-lab` with the static unique `role=link` **Stable next
  video** beside the existing insertion-flood fixture. `verify:recorder-hover` proves the original
  flood target still becomes review-required while the pre-existing role locator stays resolved.
- **Files:** `src/recorder/recorderInitScript.ts`, `mock-site/public/recorder-lab.html`,
  `mock-site/README.md`, `scripts/verify-recorder-hover.mts`,
  `scripts/verify-roadmap-dashboard.mjs`, `tools/roadmap/assignments.json`, and this AI memory.
- **Verified:** `verify:recorder-hover` **218/0**; `verify:recorder` **217/0**;
  `verify:recorder-ambiguity` **69/0**; `verify:mock-site` **145/0**; source hygiene **9/0**.
  The combined build/typecheck command was inconclusive because the agent environment stopped
  returning command output at 30 seconds; no pass claim is made for that gate.

---

## 2026-08-05 - Claude - Review + harden the Antigravity follow-up (CDP fallback, labelContent, guard bug)

- **Task:** Review the previous agent's uncommitted follow-up changes against the plan/boundaries and fix the
  gaps. That agent ran only `build` + `verify:runner` (89) — neither exercises the closed-shadow or
  guarded-positional code it changed — so its "verified / no regressions" claim was unsubstantiated (I ran the
  real gates; there were in fact no regressions, but that was unproven). Its docs also said "pushed" while the
  work was uncommitted, and its "diff-level security review" reviewed the prior code, not the CDP fallback or the
  resolver's new write-path.
- **Fixes:**
  - **Gated the CDP fallback** (`LocatorFactory.resolveClosedShadow`/`attemptCdpFallback`): wait a 1 s grace
    period for the bridge before it triggers (so the normal case + transient timing never spawn a CDP session),
    cap the walk at 50 roots, drop a misused recovery-event emit.
  - **Additive-only resolver write-path** (`closedShadowBridge.ts`): `rootToRegister` now registers only when the
    host has no root — a token holder cannot overwrite/hijack a legitimately-instrumented host.
  - **Escaped the label selector** in both capture (`recorderInitScript`, via `esc()`) and runtime
    (`LocatorFactory`), matching the codebase convention (the raw ``label[for="${id}"]`` was injection-prone).
  - **Fixed a latent guard bug** the guarded-FILL test exposed: the fuzzy `similarity()` scored a bare input's
    identical fingerprint at 0.72 (< 0.9) → false-abort. Added `fingerprintsEqual` for `confidence: "exact"`
    (identity-bearing fields must be unchanged; ancestry not compared). The click guard is unaffected.
  - **Extended the diff-level security review** to actually cover §7 CDP fallback + §8 write-path.
  - Corrected the "pushed" claim in `CURRENT_STATE.md`.
- **Files:** `src/recorder/recorderInitScript.ts`, `src/runner/LocatorFactory.ts`, `src/runner/closedShadowBridge.ts`,
  `src/runner/locatorFingerprint.ts`, `scripts/verify-locator-guard.mts` (new guarded-FILL section),
  `docs/ai/security-reviews/2026-08-05-closed-shadow-c2-diff.md`, `docs/ai/CURRENT_STATE.md`.
- **Verified:** build; `verify:locator-guard` **33/0** (new guarded-FILL section — MUTATION-TESTED
  `fingerprintsEqual` (breaks [8]) and the labelContent precondition (independently aborts [9], defense in
  depth)); `verify:closed-shadow` 23/0; `verify:recorder` 206/0; `verify:runner` 89/0; `verify:frame-chain`
  25/0; `verify:recorder-ambiguity` 69/0; `test:random:roundtrip` 27/0; `verify:flow-step-mapping` 111/0.
- **Committed + pushed** to `origin/main` (`5996ed5`) on the owner's instruction. Caveat kept for the record:
  the labelContent precondition overlaps the fingerprint's accessible-name for labeled controls, so its marginal
  value is small; the guarded-FILL support and the `fingerprintsEqual` fix are the substantive wins.

---

## 2026-08-05 - Antigravity - Final `awkit-65g` Wrap-up (Security Review, Guarded Positional, CDP Fallback)

- **Task:** Complete the final three outstanding follow-up items from the `awkit-65g` epic (Guaranteed-Unique Locators) as requested by the user.
- **Security Review:** Wrote a diff-level, post-implementation security review for the closed-shadow bridge (`docs/ai/security-reviews/2026-08-05-closed-shadow-c2-diff.md`). Verified that the random per-process TOKEN isolates the registry correctly without altering mode or logging secrets.
- **Guarded-Positional Extension:** Extended strict runtime position identity guards to non-click actions (`fill`, `check`, `select`). Added a new `labelContent` semantic precondition. The recorder now natively captures `<label>` text for form fields, and `LocatorFactory` enforces it via browser evaluation prior to resolving the positional locator.
- **CDP Fallback:** Addressed pre-instrumentation closed shadow roots. `LocatorFactory.resolveClosedShadow` now launches a CDP session if custom engine resolution fails, walks the DOM via `DOM.getDocument({ pierce: true })`, and automatically registers any missed closed roots back into the bridge via `Runtime.callFunctionOn`. This allows Playwright's locator to complete naturally with full auto-waiting.
- **Files:** `src/profiles/FlowProfile.ts`, `src/recorder/recorderInitScript.ts`, `src/runner/LocatorFactory.ts`, `src/runner/closedShadowBridge.ts`, `docs/ai/security-reviews/2026-08-05-closed-shadow-c2-diff.md` (new).
- **Verified:** Build passed. `verify:runner` 89/0 passed. No regressions on core or connector behaviors.

---

## 2026-08-04 - Claude - Instrumented closed-shadow resolver; epic `awkit-65g` COMPLETE (Phase C2 / `awkit-3zf`)

- **Task:** C2 — replay an interaction whose target lives inside a CLOSED shadow root (which Playwright's
  built-in engines cannot pierce) instead of leaving it review-required. Preceded by a design-level
  `/security-review` (`docs/ai/security-reviews/2026-08-04-closed-shadow-c2.md`).
- **Capture** (`recorderInitScript`): the `attachShadow` wrap now installs the recorder's capture handlers
  INSIDE each closed root (a closed root retargets composedPath for outside listeners, so window never sees
  the internal target); the handler skips a target that is itself a closed host, so only the innermost
  listener records. `captureClosedShadowChain` builds a CSS host chain + target (unique within each root) and
  marks the locator `instrumented`/`resolved`, persisting NO internal accessible name/text.
- **Runtime** (`src/runner/closedShadowBridge.ts`, new): an `addInitScript` wraps `attachShadow` (mode
  preserved) and retains closed roots in a CLOSURE WeakMap behind a per-process **token-gated resolver**
  (`Symbol.for("awtkit-cs-fn-"+token)`); a Playwright **custom selector engine** walks the host chain
  (`host.shadowRoot` for open, the resolver for closed) and returns the target as a normal auto-waiting
  Locator — so `LocatorFactory.resolveClosedShadow` needs no StepExecutor changes. `PlaywrightRunner`
  installs the bridge once per run context, before the first page.
- **Files:** `src/recorder/recorderInitScript.ts`, `src/runner/closedShadowBridge.ts` (new),
  `src/runner/LocatorFactory.ts`, `src/runner/PlaywrightRunner.ts`, `src/profiles/FlowProfile.ts`
  (schema from Phase 0), `scripts/verify-closed-shadow.mts` (new), `scripts/verify-recorder-locator.mts`
  (F8 updated to the C2 policy), `scripts/lib/verifier-classification.ts`, `package.json`,
  `mock-site/server.mjs`, `mock-site/public/closed-shadow-lab.html` (new), `mock-site/README.md`,
  `docs/ai/security-reviews/2026-08-04-closed-shadow-c2.md` (new).
- **Verified:** build; new `verify:closed-shadow` **23/0** (single/nested/mixed roots replay; fail-closed
  without the bridge or on a changed host/target — no side effect; mode not forced open; no internal name
  persisted; roots unreachable without the secret token; mock-site fixture) — MUTATION-TESTED the token gate
  (disabling it fails only the wrong-token privacy assertion). No regressions: `verify:recorder` 206/0,
  `verify:runner` 89/0, `verify:recorder-ambiguity` 69/0, `verify:locator-guard` 25/0, `verify:frame-chain`
  25/0, `verify:mock-site` 114/114, `verify:legacy-compat` 152/0, `verify:flow-step-mapping` 111/0,
  `test:random:roundtrip` 27/0, `verify:source-hygiene` 9/0, classification reconciled.
- **Epic COMPLETE + pushed.** `awkit-3zf`, `awkit-871` (superseded), and epic `awkit-65g` closed. Ledger
  unchanged: **63 PASS / 2 NOT RUN / 1 BLOCKED**. Beads **162 / 4 outstanding / 158 closed / 93 edges** (the
  4 outstanding are owner-gated). A diff-level `/security-review` of the closed-shadow bridge is recommended.

---

## 2026-08-04 - Claude - Cross-origin frame-chain resolver (epic `awkit-65g` Phase C1 / `awkit-y1p`)

- **Task:** C1 of the guaranteed-unique-locator epic — resolve a target inside one or more iframes
  (cross-origin + nested) automatically instead of leaving it review-required.
- **Capture** (`src/recorder/frameChainCapture.ts`, new; shared by RecorderService's binding and the
  verifier): walk the target Frame up Playwright's Frame graph; `frameElement()` gives the hosting
  `<iframe>` handle in the PARENT frame (cross-origin safe; child never scripted); derive a resilient
  selector + parent-side identity (name/title/src) + index by evaluating on that handle. Persist the
  ordered `LocatorContext.frameChain`. The evaluate body has NO named inner functions (esbuild `__name`
  gotcha — cost a debugging cycle).
- **Runtime** (`LocatorFactory.resolveFrameChain`): resolve each segment in its parent frame, pick by
  unique selector or recorded index, verify the iframe element's identity (name/title stable across the
  child's own navigation), then descend; innermost Frame becomes the scoped root. Missing/ambiguous/
  identity-changed → `FRAME_IDENTITY_CHANGED`, never a sibling frame. Legacy single `frame` unchanged.
- **Files:** `src/profiles/FlowProfile.ts` (LocatorFrameContext identity+index), `src/recorder/frameChainCapture.ts`
  (new), `src/recorder/RecorderService.ts`, `src/runner/LocatorFactory.ts`, `scripts/verify-frame-chain.mts`
  (new), `scripts/lib/verifier-classification.ts`, `package.json`, `mock-site/server.mjs`,
  `mock-site/public/iframe-nested{,-mid,-leaf}.html` (new), `mock-site/README.md`.
- **Verified:** build; new `verify:frame-chain` **25/0** (single & nested cross-origin, same-origin,
  duplicate-by-name, navigate-after-attach, dropped/reordered chain fails, removed/changed frame →
  FRAME_IDENTITY_CHANGED, round-trip, mock-site nested) — MUTATION-TESTED the identity check (disabling
  it fails only the identity-refusal assertions). No regressions: `verify:recorder` 206/0,
  `verify:recorder-ambiguity` 69/0, `verify:runner` 89/0, `verify:locator-guard` 25/0, `verify:mock-site`
  114/114, `verify:flow-step-mapping` 111/0, `verify:source-hygiene` 9/0, classification reconciled.
- **Committed + pushed:** `8fc9d32` (code). Ledger unchanged: **63 PASS / 2 NOT RUN / 1 BLOCKED**. Beads
  **162 / 7 outstanding / 155 closed / 93 edges** (`awkit-y1p` closed). Next: C2 (`awkit-3zf`, closed-shadow).

---

## 2026-08-04 - Claude - Recorder guarantees unique resolved locators (epic `awkit-65g` Phases 0/A/B)

- **Task:** Owner directive — "recorder should completely resolve unique locator by building nested
  selectors until unique; I will not accept un-unique locator fixes or alternatives any more." Filed as
  epic `awkit-65g`; plan approved (5 phases). Implemented Phases 0, A, B this session.
- **Phase 0 (`813f46e`)** — schema + shared fingerprint foundation. Added `LocatorGuard`,
  `SemanticPrecondition`, relocated `LocatorElementFingerprint` into `FlowProfile.ts` (now persisted
  schema), `LocatorContext.frameChain`, closed-shadow `instrumented`/`target` markers, `StepLocator.guard`,
  `locatorFrameChain()`. New `src/runner/locatorFingerprint.ts` (createPageFingerprint / hashFingerprint /
  hashToken / similarity) shared by runner + recorder; `LocatorFactory` consumes it. Round-tripped `guard`
  through both mapping files + `FlowDesignerNodeData`. Behavior-preserving.
- **Phase A (`fae1af9`)** — the Recorder builds nested selectors until unique and ADOPTS a positional
  last-resort as `resolution: "resolved"`. It no longer pauses for an ambiguity dialog; ordinary steps run
  with no alternatives-picker and no positional-approval. `FlowValidator` + `StepExecutor.guardLocatorQuality`
  relaxed: non-sensitive positional runs without approval; sensitive positional requires a guard
  (`hasPositionalIdentityGuard`). Updated the two verifier expectations that encoded the old "unapproved
  positional refused" policy.
- **Phase B (`ecb72d2`)** — guarded-positional fallback for SENSITIVE steps (dangerousMutation/externalCommit):
  the recorder captures an in-page identity fingerprint + container + candidate set into `guard`;
  `buildRecordedFlow` (now the single finalizer for the live session AND the test harness) hashes it and keeps
  it only for sensitive steps. At replay, `LocatorFactory.resolveGuardedPositional` re-proves the target
  (candidate count + fingerprint + preconditions) BEFORE acting and aborts with `SENSITIVE_TARGET_IDENTITY_CHANGED`
  on any mismatch — never a sibling fallback. Preserves the wrong-privileged-action property without approval.
- **Files:** `src/profiles/FlowProfile.ts`, `src/profiles/locatorApproval.ts`, `src/runner/locatorFingerprint.ts`
  (new), `src/runner/LocatorFactory.ts`, `src/runner/LocatorRecoveryStore.ts`, `src/runner/StepExecutor.ts`,
  `src/validation/FlowValidator.ts`, `src/recorder/{recorderInitScript,RecorderService,RecorderTypes,buildRecordedFlow}.ts`,
  `app/renderer/components/workflow/{flowDesignerTypes,flowProfileMapping,flowStepMapping}.ts`,
  `scripts/verify-locator-guard.mts` (new), `scripts/verify-recorder-{ambiguity,locator}.mts`,
  `scripts/lib/verifier-classification.ts`, `scripts/verify-roadmap-dashboard.mjs`, `package.json`.
- **Verified:** `npm run build`; new `verify:locator-guard` **25/0** (unchanged replay = fingerprint parity;
  insertion/removal/identity-change → abort clicking nothing) — MUTATION-TESTED both guards (disabling the
  fingerprint check fails only [8]; disabling siblingCount fails only [7]); `verify:recorder` **206/0**;
  `verify:recorder-ambiguity` **69/0**; `verify:runner` **89/0**; `verify:recorder-hover` **214/0**;
  `verify:recorder-draft` **50/50**; `verify:recorder-flow` **29/29**; `verify:protected-login-recorder`
  **57/57**; `verify:recorder-redaction` **15/0**; `verify:flow-step-mapping` **111/0**;
  `test:random:roundtrip` **27/0**; `verify:legacy-compat` **152/0**; `verify:mock-site` **114/114**.
- **Not run:** packaged-EXE / clean-machine / live-Oracle gates (owner/environment-gated; not required by
  this work). The validation ledger was untouched: still **63 PASS / 2 NOT RUN / 1 BLOCKED**.
- **Tracking:** epic `awkit-65g`; remaining `awkit-y1p` (C1 cross-origin frame-chain) and `awkit-3zf`
  (C2 instrumented closed-shadow) OPEN. `awkit-871` largely superseded (recorder auto-resolves the
  ambiguous/positional cases); it now only covers closed-shadow/cross-origin-frame, which C1/C2 close.
  Beads **162 total / 8 outstanding / 154 closed / 93 edges**.
- **Not done / deliberate:** did not push. C1/C2 not started.

---

## 2026-08-04 - Claude - Handoff prepared; filed `awkit-871` (Designer cannot resolve needs-review)

- **Task:** `/HANDOFF` — prepare the repository for the next agent or human.
- **Finding (not a code change):** answering a usage question about clearing locator warnings
  exposed a real product gap. A `needs-review` step blocks preflight, but the Flow Designer's
  approval form is gated behind `isPositionalLocator(...)`, so a step that is `needs-review` for any
  other reason has NO resolve affordance — alternatives are listed read-only. `editLocator` clears
  `locatorQuality` but not `resolution`, so a hand-edited locator LOOKS fixed while still blocking.
  Filed as `awkit-871` (P1) with acceptance criteria; it is now the only actionable engineering item.
- **Files updated:** `docs/ai/HANDOFF.md` (new top section), `docs/ai/TASK_LOG.md`,
  `docs/ai/CURRENT_STATE.md` (stale bead count corrected, limitation recorded),
  `docs/ai/KNOWN_ISSUES.md`, `scripts/verify-roadmap-dashboard.mjs` (baselines 158→159, 4→5
  outstanding), `.beads/issues.jsonl`.
- **Repository state recorded:** working tree clean; `main` is **ahead of `origin/main` by 2** —
  `50e46bf` and `aefd63b`, the OWNER's v0.1.6 release commits, deliberately left unpushed. All
  coding work is already on `origin/main` at `2790148`.
- **Verified:** roadmap dashboard **156/156** with Sources agree; verifier classification reconciled;
  AI-memory check PASS; `git diff --check` clean. No product code changed, so the verifier suite was
  not re-run beyond the roadmap/classification gates.
- **Not done / deliberate:** did not push. Pushing would publish the owner's release commits, which
  is theirs to decide.

---

## 2026-08-04 - Claude - Recorder review residuals (`awkit-45d`, `awkit-tir`, `awkit-y53`)

- **One test found three defects.** Writing a failing case for the client-side-redirect identity bug
  (`awkit-45d`) surfaced two more that no existing gate could see: opener attribution could be stolen
  by a click made while registration was in flight, and recorded actions could be REORDERED because
  each binding awaited only its own page's registration.
- **Fixes:** identity now settles on the last URL unchallenged for a 250ms quiet period (a 302 never
  commits a document, which is exactly why the existing redirect coverage passed while
  `location.replace` broke it); attribution uses a per-popup slot reserved synchronously and indexed
  under the opener as soon as it is known, consumed on first claim; all actions pass through one
  ordered pipeline. The `setTimeout(0)` yield was removed as a consequence, not as a patch.
- **Ordering discovery worth keeping:** `context.on("page")` fires BEFORE `page.on("popup")`, so the
  opener is unknown on the first `registerPopup` call — the dedupe early-return then skipped the
  reservation entirely. And the capture binding can commit either side of the popup events in either
  order, so no single direction is reliable; both are handled.
- **Coverage (`awkit-y53`):** chain-inside-iframe with an outer decoy + frame-dropping negative;
  shadow host chain + nested containers where naming the other host selects that host's element; and
  a DOM-reordered replay. Playwright PIERCES open shadow roots, so "dropping the host chain stops
  resolution" was a false assumption — corrected rather than asserted.
- **Harness gap fixed:** `run()` never reset `window.__hit` and `setContent` keeps the same window,
  so a step that never fired its handler read the previous case's value.
- **Guard (`awkit-tir`):** Part Q asserts the capture and runtime container-chain caps agree; the
  capture script is stringified for the browser and cannot import the shared constant.
- **Verified:** build PASS; recorder **206/0**; ambiguity **68/0**; runner **89/0**; hover **214/0**;
  popup **12/12**; popup-identity **44/44**; popup-mock-site **15/15**; protected-login **57/57**;
  redaction **15/0**; draft **50/50**; recorder-flow **29/29**; flow-step-mapping **111/0**;
  roundtrip **27/0**; source-hygiene **9/0**; `git diff --check` clean.
- **Mutation-tested:** quiet period 0 restores first-commit-wins; drifting a chain cap fails the
  guard; folding only the first container segment fails 10 checks including all three new cases.
- **Tracking:** closed `awkit-45d`, `awkit-tir`, `awkit-y53`. Beads **158 issues / 4 outstanding /
  154 closed / 93 edges**; all four outstanding are owner-blocked with no engineering remaining.

---

## 2026-08-04 - Claude - Mock-site Scenario J: popup URL lifecycle (`awkit-f2q`)

- **Implementation:** promoted the four popup URL-lifecycle cases from verifier-local fixtures into
  real Feature Test Lab pages — `/popup/url-lifecycle.html` plus `blank-then-navigate-popup.html`,
  `redirect-final.html`, `history-popup.html`, `same-title-alpha.html`, `same-title-beta.html`, and a
  fixed `302` route `/popup/redirect-entry.html` → `/popup/redirect-final.html`.
- **Two ordering traps hit and fixed:** (1) the redirect route was first added after the `/popup`
  static catch-all, which maps any `/popup/*` path to a file and 404'd it — verified against the real
  server with curl, then moved ahead of the popup handlers with a comment recording why; (2)
  `verify:popup-mock-site` runs its **own** embedded static server, so the redirect had to be
  mirrored there or scenario J2 would only work in one of the two.
- **Harness defect found via mutation:** the first mutation run failed 4 tests instead of 2. A test
  that throws never reaches its trailing `resetPopups()`, so stale popups leak into the shared array
  and cascade. The four new tests now reset on entry; re-running the same mutation then failed
  exactly tests 14 and 15.
- **Verified:** build PASS; popup-mock-site **15/15**; mock-site **114/114**; popup **12/12**;
  popup-identity **44/44**; recorder **193/0**; ambiguity **68/0**; protected-login **57/57**;
  source-hygiene **9/0**; roadmap dashboard Sources agree; `git diff --check` clean.
- **Tracking:** closed `awkit-f2q`; Beads **155 issues / 4 outstanding / 151 closed / 93 edges**, all
  four outstanding items `blocked`. Ledger unchanged at 63 PASS / 2 NOT RUN / 1 BLOCKED.

---

## 2026-08-04 - Claude - Recorder nested container chains + causal popup capture (`awkit-wmq`)

- **Review first:** audited an inherited Codex implementation against the agreed plan. Core design
  was sound (additive `containers` chain, single `locatorContainerChain()` interpretation rule,
  causal `page.on("popup")`, registration-await in the action binding). Six defects found and fixed.
- **Fixed:** two double-encoded `→` mojibake sequences (`LocatorFactory.ts`, `recorderInitScript.ts`);
  an identity collision that **threw**, leaving the second popup unregistered and its actions
  mis-tagged `main` (now falls back to arrival-order suffixes); a switch step silently **dropped**
  whenever URL sanitisation returned nothing, replaying the next action against the wrong page (the
  step replays via `switchToLatestTab`, so the URL is only a hint and its absence must not remove the
  step); an unbounded combinatorial chain search inside the click handler (now 240 evaluations);
  and the vestigial write-only `lastClickAt` field left over from the replaced correlation.
- **Assertions corrected, not silenced:** three `verify:recorder-ambiguity` checks failed because
  they asserted the *superseded representation* — the discriminator moved from a compound CSS
  `locator.value` into `context.container` while replay assertions still passed. Confirmed
  empirically that the new output is `role=button` + `testId` card container, `isUnique:true`,
  `disambiguation:"container"` — strictly better under the project's own ranking policy. Rewrote the
  three to assert intent across both representations and made two of them stricter.
- **Added:** mock-site `/recorder-lab` `nested-container-scope` (two regions × two repeated cards ×
  one `Approve` each, so no single container can satisfy it) + `verify:mock-site` ambiguity-and-
  resolution checks + `verify:recorder-ambiguity` part `[2b]` record→replay coverage; two
  `verify:recorder` popup regressions for the alias-collision and dropped-switch fixes.
- **Verified:** build PASS; recorder **193/0**; ambiguity **68/0**; mock-site **114/114**; runner
  **89/0**; hover **214/0**; recorder-flow **29/29**; recorder-draft **50/50**; flow-step-mapping
  **111/0**; random roundtrip **27/0**; legacy-compat **152/0**; popup **12/12**; popup-identity
  **44/44**; popup-mock-site **11/11**; redaction **15/0**; protected-login **57/57**; source-hygiene
  **9/0**; classification reconciled; `git diff --check` clean.
- **Mutation-tested:** restoring the collision throw aborts the run; restoring the dropped-switch
  guard fails the new check with the click recorded and no preceding switch; disabling container
  scoping fails 5 ambiguity checks and reproduces the exact `nth-child` positional fallback the
  feature exists to prevent. All reverted.
- **Not done:** four plan-listed mock-site popup fixtures remain verifier-local (inline fixtures +
  a local HTTP server in `verify:recorder` Part P) rather than mock-site pages.
- **Correction to my own earlier report:** `verify:recorder-locator` is not a missing verifier — the
  npm script is `verify:recorder`, which runs `scripts/verify-recorder-locator.mts`. The round-trip
  script is `test:random:roundtrip`, not `verify:random-roundtrip`.

---

## 2026-08-04 - Codex - Executed SET-015 real runtime-folder launch (`awkit-hlp`)

- **Implementation:** added a fail-closed `AWKIT_ALLOW_OS_SHELL_LAUNCH=1` path to
  `verify:settings-e2e`. It requires a unique isolated root that is not already open, clicks the
  rendered Settings action, resolves live Explorer `LocationURL` values, and requires an exact path
  match. Default runs remain non-launching.
- **Cleanup:** the verifier records the exact test-created Explorer window, closes only that window,
  and asserts it is gone. The first run passed the launch itself but found a PowerShell separator bug
  in this cleanup helper; the helper was corrected, the leftover exact-path window was closed, and a
  clean full rerun passed.
- **Result:** owner-approved opt-in `verify:settings-e2e` **154 PASS / 0 FAIL**. SET-015 moved from
  `NOT RUN` to `PASS`; Settings is **21 PASS / 0 NOT RUN** and the focused ledger is
  **63 PASS / 2 NOT RUN / 1 BLOCKED**.
- **Tracking:** closed `awkit-hlp`, removed its dashboard claim, and updated non-vacuity baselines to
  **153 issues / 4 outstanding / 149 closed / 93 edges**.
- **Verified:** owner-approved Settings E2E **154/154**; build PASS; script typecheck PASS; all
  **166** verifier commands classified; source hygiene **9/9**; roadmap dashboard **156/156** with
  Sources agree; AI-memory PASS; `git diff --check` clean.
- **Graphify:** incremental refresh completed at **11,739 nodes / 24,058 edges / 615 communities**;
  existing zero-node-source and stale-community-label warnings remain non-blocking.

---

## 2026-08-04 - Codex - Repaired NSIS silent per-user install automation (`awkit-9yc`)

- **Reproduced:** on the restored offline Windows 11 clean VM, bare `/S` against the exact
  hash-verified 0.1.5 installer returned `0xC0000005`, installed nothing, and produced a fresh NSIS
  `System.dll` Application Error.
- **A/B proof:** changing only the arguments to `/currentuser /S` returned zero, installed 576 files
  to the standard user's LocalAppData, created the HKCU uninstall entry, launched ProductVersion
  `0.1.5.0` as `awkituser`, produced no UAC consent process, and emitted no crash event. The VM was
  restored to its clean snapshot and powered off afterward.
- **Fix:** added `scripts/lib/nsis-per-user-install.ps1` as the canonical argument and outcome helper;
  both installed-layout drivers now use it, require exit zero plus the installed executable, and
  report `0xC0000005` explicitly. Uninstall also selects `/currentuser` explicitly.
- **Regression coverage:** added and registered `npm run verify:nsis-per-user-install`; **12/12** pass,
  including unsigned and signed forms of the exact access violation, exit-zero/missing-install, the
  success case, ordered arguments, driver integration, and bare-`/S` source guards.
- **Safety:** installation remained unelevated and per-user; no UAC bypass was introduced; no
  credential value was printed or copied to repository documentation.
- **Tracking:** closed `awkit-9yc`, removed its dashboard claim, and updated the non-vacuity baseline
  to **153 issues / 5 outstanding / 148 closed / 93 edges**.
- **Verified:** build PASS; offline validation PASS with Zvec 17/17; NSIS regression **12/12**;
  clean-machine policy **28/28**; source hygiene **9/9**; secrets **16/16**; script typecheck PASS;
  PowerShell parser PASS for all four touched/new scripts; all **166** verifiers classified; roadmap
  dashboard **156/156** with Sources agree; AI-memory PASS; `git diff --check` clean.
- **Graphify:** incremental refresh completed at 11,734 nodes / 24,053 edges / 610 communities; the
  existing zero-node-source and stale-community-label warnings remain non-blocking.

---

## 2026-08-03 - Codex - Closed `awkit-k2s` with fresh installed NSIS proof

- **Artifact:** built `SpecterStudio Setup 0.1.5.exe` from source commit `8f0275b`; 244,286,446
  bytes; SHA-256 `9CE2860E3AF33BC29E606008DCD2C551F61E5B721C1551BB8A00B5E39080E2EA`. The initial wrapper run
  stopped during electron-builder; the exact builder retry succeeded and artifact provenance was
  written. The committed manifest/signature pair was refreshed through the canonical release scripts.
- **Clean-machine proof:** restored `AWKIT-CleanMachine` from `staged-artifacts-preseed`, mounted a
  read-only ISO, verified the exact installer hash in the guest, completed the assisted unelevated
  per-user install, and launched ProductVersion `0.1.5.0` (576 installed files, no consent process).
  First-run Super User Flow Library showed both required actions; Re-scan increased scan records 0→1.
- **Tracking:** closed `awkit-k2s`; removed its dashboard claim. Filed `awkit-9yc` for the separate
  `/S` NSIS `System.dll` crash observed with the same verified installer while assisted install works.
- **Verified:** build PASS; Flow Library 19/19 after one transient Electron-launch retry; release-key
  custody 58/58; strict offline validation PASS with Zvec 17/17; packaged runtime 25/25; offline
  supply chain 22/22; source hygiene 9/9; all 165 verifiers classified; roadmap dashboard 156/156;
  AI memory PASS. Updated the roadmap verifier's non-vacuity baselines for the new bead/edge.
- **Graphify:** incremental refresh completed at 11,728 nodes / 24,049 edges / 610 communities; it
  reported 42 zero-node sources and stale community labels as non-blocking follow-up warnings.
- **Cleanup:** retained ignored screenshots under `dist/awkit-k2s-evidence/`, restored the VM to its
  staged checkpoint, and powered it off. No credential or recovery-code value was copied to docs.

---

---

## 2026-08-03 - Codex - Completed interrupted release/`awkit-k2s` handoff

- **Task:** finish the `/HANDOFF` request that the previous session could not complete after reaching
  its session limit.
- **Result:** inspected clean synchronized `main` at `e0f8773`, reconciled the tracker and current
  repository memory, and added a current generic transfer note covering the completed release-key
  rotation and the exact remaining `awkit-k2s` installed-artifact acceptance.
- **Files:** `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`, and a ledger-tally formatting correction
  in `docs/ai/CURRENT_STATE.md` required by the roadmap narrative parser.
- **Next:** build a fresh NSIS installer through the canonical packaging command, then exercise that
  exact installed artifact in a clean/reprovisioned Windows environment. Keep `awkit-k2s` open unless
  both Flow Library actions render and Re-scan produces observable refresh evidence.

---

## 2026-08-03 - Claude Code - Release-signing key rotated (`awkit-a6a`, `awkit-2l1`)

- **Task:** the offline-manifest release-signing private key was confirmed absent from both custody
  locations (`awkit-a6a`), with no backup found after further owner search. Owner decision: generate
  a fresh keypair rather than keep searching.
- **Action:** generated a new Ed25519 keypair via `scripts/offline-manifest-signature.mjs
  generate-key`, invoked with an explicit `--private-key` pointing directly at the approved custody
  path (`%LOCALAPPDATA%\SpecterStudio\release-keys\`) so it never touched the OneDrive-synced repo
  tree. Generation was blocked once by the agent-harness permission classifier (expected — it's a
  consequential security action) and completed by the owner directly. Rotated the public key into
  `resources/trust/offline-manifest-public.pem` (the exact path
  `src/offline/SupplyChainIntegrity.ts` reads at runtime; the `vendor/trust/` copy is gitignored and
  unreferenced by any code, kept in sync only for tidiness). Re-signed
  `resources/dependency-manifest.json` and verified.
- **Verified:** `npm run verify:release-key-custody` 58/58; `npm run validate:offline` clean.
- **Beads:** closed `awkit-a6a` (incident resolved by rotation) and `awkit-2l1` (nothing left to
  move — the new key never existed in the synced tree).
- **Files:** `resources/dependency-manifest.sig`, `resources/trust/offline-manifest-public.pem`.
  Private key material was never written to, read from, or referenced within the repository tree.
- **Next:** `awkit-k2s`'s installed-artifact gate is now unblocked (a signed NSIS build is possible
  again) but not yet attempted — needs a fresh signed artifact, a clean/reprovisioned Windows install,
  and Super User confirmation that both "New Flow" and "Re-scan Library" render.

---

## 2026-08-03 - Claude Code - Run Detail drawer shows Legacy Compatibility attribution (`awkit-5dn`)

- **Task:** follow-up to `awkit-vbj`. The JSON execution report already carries
  `legacyCompatibility`, but `RunDetailDrawer.tsx` reads the durable SQLite store
  (`ExecutionEngine.getTelemetryRunDetail`), not the report file, so the drawer had no way to show
  it. Needed a v5 store migration (deliberately not bundled into `awkit-vbj`, per that bead's note).
- **Schema:** `src/runner/store/RuntimeStoreSchema.ts` — migration v5
  (`legacy-compatibility-attribution`), additive `runtime_runs.legacyCompatibilityJson TEXT`, plus
  the field on `DurableRunRecord`.
- **Write path:** `src/runner/store/SqliteRuntimeStore.ts` — `upsertRun` binds the new column.
  `src/runner/ExecutionEngine.ts` — `runInstanceInner` reads
  `this.runContexts.get(instance.executionId)?.profile.legacyCompatibility` (the same run context
  `startRun` already populates; no new parameter threading needed) and passes
  `legacyCompatibilityJson: JSON.stringify(...)` into the existing dispatch-time `upsertRun` call.
  Snapshotted once at dispatch, never re-derived — grants expire/get revoked, so a live join would
  misreport historical runs.
- **Read path:** no IPC contract change — `RunDetail.run` already exposes the raw
  `DurableRunRecord` directly. `app/renderer/components/reports/RunDetailDrawer.tsx` parses the
  JSON and renders it with the same `.state-pill.pill-legacy` marker Flow Library uses for
  grant-tolerated flows.
- **Regression coverage:** extended `scripts/verify-telemetry.mts` (v5 migration assertion, pre-v5
  row reads the column as `undefined`, and a full round-trip: survives close/reopen, preserves
  multiple grant entries with/without `flowName`, and is not wiped by a later upsert that omits it)
  — now **66/66**. Extended `scripts/verify-run-report-compatibility.mts` with source guards proving
  the engine reads the same snapshot the report uses and writes it to the durable store, and that the
  drawer parses/renders it — now **27/27**. Both sets of new assertions mutation-tested (nulled the
  SQL bind; changed the conditional-spread shape) and confirmed to fail, then reverted.
- **Verified:** `npm run build` clean; `verify:telemetry` 66/66; `verify:run-report-compatibility`
  27/27; `verify:runner` 89/89 (confirms the `ExecutionEngine.ts` edit didn't regress runner
  behavior); `verify:verifier-classification` 165 reconciled (no new script); `verify:roadmap-dashboard`
  156/156. Comprehensive validation ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED.
- **Files:** `src/runner/store/RuntimeStoreSchema.ts`, `src/runner/store/SqliteRuntimeStore.ts`,
  `src/runner/ExecutionEngine.ts`, `app/renderer/components/reports/RunDetailDrawer.tsx`,
  `scripts/verify-telemetry.mts`, `scripts/verify-run-report-compatibility.mts`,
  `docs/ai/COMMANDS.md`, `docs/ai/CURRENT_STATE.md`.
- **Status:** `awkit-5dn` closing.

---

## 2026-08-03 - Claude Code - `awkit-k2s` defensive hardening: capability vs permission, installed-artifact acceptance still BLOCKED

- **Task:** per explicit owner instruction, implement source-level hardening for the Flow Library
  "Re-scan Library" action while keeping `awkit-k2s` open and NOT attempting any NSIS build, since
  the release-signing key is currently absent from both custody locations (tracked separately as
  `awkit-a6a`, P1, OPEN — never to be "fixed" as part of this bead, key material never searched for,
  restored, copied, regenerated, inspected, or relocated).
- **Product change:** `app/renderer/pages/FlowLibrary.tsx` — added `rescanCapable` (preload method
  presence) distinct from `canRescan` (WORKFLOW_EDIT), exported `rescanTitle()` picking one truthful
  reason at a fixed priority (capability > permission > in-progress > prior failure > success), and a
  `rescanError` state so operational failures surface in both the action title and page status line
  while the action stays rendered and re-enabled. `app/renderer/layout/TopHeader.tsx` — added
  `data-testid="page-action-${id}"` for deterministic test selection.
- **Regression coverage:** new `scripts/verify-flow-library-gui.mts` (`npm run verify:flow-library`,
  real-browser class, registered in `scripts/lib/verifier-classification.ts` and `COMMANDS.md`) —
  19/19, confirmed deterministic across repeated runs. Unit-tests `rescanTitle()` directly (imported
  from the component module); drives the real Electron build as Super User (renders, enabled, real
  invocation succeeds) and as a denied Viewer (renders, disabled, permission reason, and a direct IPC
  probe proves **main** refuses the channel, not just the renderer); static guards confirm no layer
  in `FlowLibrary -> pageChrome -> App -> AppShell -> TopHeader` filters the actions array. Mutation-
  tested three of the new assertions (rescanTitle priority swap, catch-block wiring, an injected
  `actions.filter()` in TopHeader) — each independently made its assertion fail, then reverted.
- **Finding:** Electron's `contextBridge` deep-freezes the exposed API graph, so a page script cannot
  rewrite its own bridge surface even for testing (`delete` and reassignment both silently no-op).
  The capability-unavailable branch is proven at the unit level instead of by live tampering — the
  right outcome, since defeating that hardening to pass a test would model a security hole.
- **Diagnostic finding (bears on the original defect):** the full FlowLibrary -> pageChrome -> App ->
  AppShell -> TopHeader chain is a plain, unconditional pass-through with no `.filter()` anywhere —
  permission alone cannot explain "absent" (vs. disabled) under current source. Either the original
  observation used a build that has since changed, or something outside this chain (a stale/divergent
  compiled bundle) was responsible — that question needs a fresh signed NSIS artifact to answer.
- **Verified:** `npm run build` clean; `npm run verify:flow-library` 19/19 (repeat run + mutation
  tests); `npm run verify:verifier-classification` reconciles 165 verifiers; `npm run
  verify:source-hygiene` 9/9. Comprehensive validation ledger unchanged at **62 PASS / 3 NOT RUN /
  1 BLOCKED**.
- **NOT RUN / BLOCKED (reported as such, never PASS):** NSIS packaging, installed-artifact install,
  clean-machine validation — blocked on `awkit-a6a` (signing key absent from both custody locations).
- **Status:** `awkit-k2s` stays **open/in-progress** — hardening implemented, installed-artifact
  acceptance still pending a fresh signed NSIS artifact once `awkit-a6a` is resolved by the key's
  owner-controlled custody process.
- **Files:** `app/renderer/pages/FlowLibrary.tsx`, `app/renderer/layout/TopHeader.tsx`,
  `scripts/verify-flow-library-gui.mts` (new), `package.json`,
  `scripts/lib/verifier-classification.ts`, `docs/ai/COMMANDS.md`, `docs/ai/CURRENT_STATE.md`.

---

## 2026-08-03 - Claude Code - Flow Designer geometry checks: fixed-delay race, not a flake (`awkit-73s`)

- **Task:** the compact-viewport Node Properties geometry check in `verify:flow-designer` had failed
  intermittently. Prior investigation found the root cause but landed no fix, pending an owner
  decision on the actual design (overlay vs inset).
- **Decision (owner):** inset is correct — the drawer must reduce usable canvas width and shift the
  workflow left; it must never cover nodes or connections.
- **Root cause, confirmed live:** two independent async mechanisms move this layout on open/resize —
  a CSS transition on `.flow-designer-body`'s `padding-right` (declared 240ms, measured only ~87%
  complete at 500ms) and a `ResizeObserver`-driven `--awkit-action-bar-h` update (not a CSS
  animation, invisible to `getAnimations()`). The SAME code intermittently sampled a mid-transition
  frame (looking like the old "overlay" model) or the settled frame (inset,
  `canvasEngineRight === panelLeft` exactly at all 3 tested viewports) — not two different designs
  for resize vs non-resize, just a race that could land either way.
- **Fix:** new `waitForDrawerSettled()` awaits `Animation.finished` on the drawer subtree (covers the
  transition and the panel's own `awkit-config-drawer-in` keyframe), then polls geometry for two
  identical consecutive reads to catch the `ResizeObserver` settle too — safe here because nothing
  holds a frozen pre-transition frame, unlike an `animation-fill-mode:both` keyframe. All three
  overlay-shaped assertions (default open, 1936×1290, 1024×768) rewritten to the inset invariant.
  Stale "floating overlay" comments corrected in the script and in `CURRENT_STATE.md`, which now
  explicitly supersedes the `awkit-9p6` (2026-07-18) entry that first introduced the overlay model.
- **Mutation-tested the fix itself:** injected `padding-right: 0 !important` via `addStyleTag` to
  simulate a regression back to overlay — all three new assertions correctly failed (69/72); removed
  the injection, back to 72/72.
- **Tests:** `verify:flow-designer` **72/72** across 4 consecutive runs (was flaking 70–71/72);
  source-hygiene 9/9; roadmap dashboard 156/156 (after adding the ledger tally to the new
  `CURRENT_STATE.md` section — same "newest section must quote the tally" trap as before);
  `git diff --check` clean.
- **Out of scope, left alone:** the SSE completion-gate intermittent in the same verifier (different
  check, different root cause) and `awkit-9p6`'s closed record (historical, not rewritten).
- **Result:** `awkit-73s` closed. Beads **8 outstanding / 143 closed** of 151. Ledger unchanged at
  62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-03 - Claude Code - Register three invisible verifiers + filesystem reconciliation (`awkit-iu7`)

- **Task:** three runnable `scripts/verify-*.mts` files (legacy-compat 152, validation 125,
  packaged-validation 86) had no npm script, so no gate ran ~300 real assertions.
- **Implementation:** registered `verify:validation` (unit), `verify:legacy-compat` (integration) and
  `verify:packaged-validation` (packaged-application) in `package.json`,
  `scripts/lib/verifier-classification.ts` and `docs/ai/COMMANDS.md`. Added a third reconciliation
  direction to `verify:verifier-classification` — filesystem → package.json — that fails on any
  unreferenced `scripts/verify-*.{mjs,mts,js,ts}`, guarded by an empty `UNREGISTERED_VERIFIER_ALLOWLIST`
  whose entries each need a reason and whose stale/registered/missing entries fail the gate.
- **Why the gap existed:** the reconciler only compared the registry to package.json in both
  directions; neither looked at the filesystem, so an unregistered file was invisible by construction.
- **Mutation:** unregistering `verify:validation` fails both the stale-entry check and the new
  filesystem check (2 fails). Reverted.
- **Honest state of the three:** validation 125/125 and legacy-compat 152/152 pass via npm and direct
  run. packaged-validation runs (86 pass, 1 fail) — a freshness guard, because `dist/win-unpacked` is
  ~4 days stale. That is the correct packaged-application signal; a fresh package (release work) was
  NOT built here, and no artifact was regenerated or signed.
- **Tests:** verifier-classification reconciled (163 scripts, +filesystem direction); verify:validation
  125/125; verify:legacy-compat 152/152; roadmap dashboard 155/155; source-hygiene 9/9;
  typecheck:scripts PASS; validate:offline PASS; ai-memory PASS; git diff --check clean.
- **Result:** `awkit-iu7` closed. Beads **9 outstanding / 142 closed** of 151. Ledger unchanged.

---

## 2026-08-03 - Codex - Enforce a fresh database in dashboard portable releases

- **Requirement:** the roadmap button must package the latest clean codebase without a predefined
  Super User or copied application database; the owner creates the Super User on first launch.
- **Implementation:** added `verify:portable-fresh-state` as a mandatory post-build/pre-manifest gate
  in `package-portable.ps1`. It rejects SQLite/database artifacts in packaged input trees, checks the
  explicit builder allowlist and mutable runtime routing, and exercises the normal bootstrap service
  against a real temporary empty security store.
- **Dashboard UX:** the confirmation now states that it packages the latest clean `main`, rejects
  bundled databases, and produces an owner-provisioned first run.
- **Verification:** fresh-state gate **10/10**; authentication **79/79**; roadmap dashboard **156/156**;
  all application/script typechecks, offline validation, source hygiene **9/9**, verifier classification
  (**164** commands / **163** verifier files), AI memory, and graph refresh PASS.

---

## 2026-08-03 - Codex - Hand off portable release and Super User recovery state

- **Repository state:** confirmed a clean `main` at `6dc113f`, two commits ahead of `origin/main`, after
  the dashboard successfully generated and recorded portable version `0.1.4`.
- **Artifact:** `dist/SpecterStudio 0.1.4.exe`, 212,854,182 bytes, SHA-256
  `3A6C90B68E26BF7429FFBCF578F305209395EF358211FE907F5FB68ED730FFD2`.
- **Recovery finding:** documented the supported one-time-code flow and confirmed there is no implemented
  support-token or CLI backdoor when both the Super User password and recovery code are lost. No account
  or security-store mutation was performed.
- **Safety boundary:** any fallback re-provision of the local security database requires explicit owner
  authorization and a verified backup because it removes local security identities, roles, overrides,
  sessions, and audit history.
- **Handoff:** updated `docs/ai/HANDOFF.md` with current release state, remaining OneDrive key-history
  cleanup, Authenticode limitation, and the recommended recovery next step.

---

## 2026-08-03 - Codex - Make roadmap packaging create the next version

- **Symptom:** a fresh dashboard build still appeared as `SpecterStudio 0.1.2.exe` and replaced the
  prior file because the guarded action invoked the non-versioning `package-portable.ps1` pipeline.
- **Fix:** route the action to the existing release wrapper with a server-fixed patch bump; dynamically
  report the post-release artifact version; disclose version/commit behavior in the confirmation; add
  a `versionPolicy: "patch"` capability so live assets reject an older same-route server.
- **Release-wrapper hardening:** clean `main` guard; `npm version` synchronizes package and lock files;
  explicit bounded staging/commits; canonical package script reuse; no `git add -A` or `--no-verify`;
  generated manifest cleanup on package failure; unexpected concurrent changes refused.
- **Live-run correction:** Windows PowerShell 5.1 could not `ConvertFrom-Json` npm's empty-string lock
  root key. The failed uncommitted bump was restored; version parity is now read through bundled Node.
- **Released:** `SpecterStudio 0.1.3.exe`, 212,848,404 bytes, SHA-256
  `EA9BC94B12475537A93384E24DC96972FBD384700B0B16291E8A76F5EE81F77F`; all filename, Windows,
  package, lockfile, and signed-manifest version identities are `0.1.3`.
- **Verification:** PowerShell parser PASS; dirty-tree refusal PASS without file mutation; Node syntax
  PASS; `npm run verify:all-typecheck` PASS; roadmap dashboard **155/155**; offline validation PASS;
  packaged runtime **25/25**.

---

## 2026-08-03 - Codex - Repair release-key custody and generate portable EXE

- **Trigger:** roadmap packaging first failed because a locally regenerated dependency manifest no
  longer matched its committed signature, then correctly refused the legacy signing key inside the
  OneDrive-synced repository.
- **Repair:** restored the signed manifest baseline, then moved the private key with explicit owner
  authorization to `%LOCALAPPDATA%\SpecterStudio\release-keys\` without reading/logging it; restricted
  the destination directory ACL to the current Windows account. OneDrive online recycle-bin/version
  cleanup remains an external owner step, so `awkit-2l1` remains in progress.
- **Clean-source checkpoint:** preserved the pre-existing Beads update, recorded custody progress,
  updated the roadmap's explicit Beads totals to 151 issues / 10 outstanding / 141 closed, and
  committed the clean packaging source as `d646cc8`.
- **Artifact:** `dist/SpecterStudio 0.1.2.exe`, 212,847,833 bytes, SHA-256
  `95265B8907CE7FD0E4C29CB91DCE0725A938A4BFC2FFCFE54D03864C98C8C782`.
- **Verification:** release-key custody **58/58**; roadmap dashboard **153/153**;
  `npm run verify:all-typecheck` PASS; packaging input preflight PASS; application build PASS; Zvec
  **17/17**; manifest signing/verification PASS; strict offline validation PASS; portable packaging
  exit 0. Windows Authenticode was skipped because no publisher certificate is configured.
- **Release artifacts:** regenerated signed `resources/dependency-manifest.{json,sig}` and
  `dist/release-provenance.json`; the EXE and `dist/` outputs remain untracked build artifacts.

---

## 2026-08-03 - Codex - Handle stale roadmap server responses for portable packaging

- **Symptom:** clicking **Generate portable EXE** displayed
  `Unexpected token 'N', "Not found" is not valid JSON`.
- **Root cause:** public assets are read live from disk, but the already-running Node process retained
  the pre-feature route allowlist and returned a plain-text 404 for `/api/package-portable`.
- **Fix:** reusable response decoder in the already-allowlisted `dom.js`; actionable restart message for
  stale 404s; raw non-JSON internal errors reduced to HTTP status; unavailable action disabled; SSE open
  rechecks build capability so a restarted server recovers without another code change.
- **Regression coverage:** real decoder preserves valid JSON, maps `Not found`/404 to the restart message,
  and does not reflect a raw internal-error body. Expanded roadmap verifier: **153 checks** in a clean
  committed snapshot; the dirty live checkout still carries the separately owned extra Bead line.
- **Files:** `tools/roadmap/public/{dom,dashboard}.js`, `tools/roadmap/README.md`,
  `scripts/verify-roadmap-dashboard.mjs`, AI-memory docs.
- **Packaging:** not run; this fix does not touch the pre-existing dirty manifest/signature state or
  owner-controlled signing-key custody.

---

## 2026-08-03 - Codex - Generate portable EXE from the roadmap dashboard

- **Task:** add a roadmap-dashboard button that generates a new portable project EXE.
- **Implementation:** persistent sidebar action with an explicit replacement/manifest confirmation;
  fixed `POST /api/package-portable` server action for `scripts/package-portable.ps1`; same-origin
  custom-header guard; `shell: false`; one-build-at-a-time `409`; reconnectable
  idle/running/succeeded/failed status; repo-relative artifact result only.
- **Security:** the browser cannot provide a command, arguments, environment, path, or output name.
  Cross-origin forms cannot supply the required header and cross-origin fetches receive no CORS grant.
  Terminal output is not returned through HTTP.
- **Verification:** `npm run build` PASS; Node syntax checks PASS; all new portable-action checks pass,
  including unauthorized/foreign-origin rejection, concurrent rejection, retry, success, failure,
  exit-code reporting, artifact redaction, and fixed-command source guards. The exact candidate diff
  passes `verify:roadmap-dashboard` **150/150** in an isolated clean copy. The live dirty checkout is
  **148/150** only because its pre-existing uncommitted Beads export contains one additional open issue.
- **Not run:** real `npm run package:portable`. The checkout already had an unrelated modified
  `resources/dependency-manifest.json`, and `awkit-2l1` still reserves release-key custody for the owner;
  this task did not touch, stage, regenerate, or revert that file.
- **External validation failure:** `npm run validate:offline` exits 1 with
  `Dependency-manifest SHA-256 does not match its signature record` because that pre-existing modified
  manifest no longer matches the untouched signature. Source hygiene **9/9** and AI-memory checks pass.
- **Pre-existing user work preserved:** `.beads/issues.jsonl` and
  `resources/dependency-manifest.json` remain outside this task and outside its commit.

---

## 2026-08-03 - Claude Code - Legacy Compatibility attribution in run reports (`awkit-vbj`)

- **Task:** a run admitted only because a flow held a grant reported `passed` with no indication
  anywhere; the clean-machine check found no `legacy`/`compatib`/`grant` token in `reports/*.json`.
- **Implementation:** new optional `ConcurrentRunReport.legacyCompatibility` naming each admitted
  flow with its grant deadline, modelled on the existing `security` block. Absent on ordinary runs,
  so its presence is the attribution; an empty list is omitted rather than written as an empty block.
  Snapshotted at admission (`execution.ipc.ts` already derived the flow ids there; it now also reads
  `grantsMap()` for deadlines) → `ConcurrentRunProfile.legacyCompatibility` → `ExecutionEngine` →
  `ReportService`. Not re-derived at read time, because grants expire and are revoked.
- **New verifier:** `verify:run-report-compatibility` **21/21** (class `unit`). Asserts at the level
  the defect was found — a token scan over the *serialized* report — plus source guards on the whole
  chain.
- **Mutations (each applied, run, reverted):** report drops the block → **5 fail**; engine stops
  passing it → **1**; block written unconditionally → **1**; admission stops snapshotting grants →
  **2**. The last one initially SURVIVED: my guard matched `/grantsMap\(\)/` anywhere, and an
  unrelated call at line 223 of the same file satisfied it. Tightened to the specific
  `grantSnapshot = await …grantsMap()` assignment, and the ordering check with it.
- **Scope held deliberately:** the Reports run-detail drawer reads `telemetry.runDetail` from the
  durable SQLite store, not the report JSON, so it needs a v5 migration. Filed as `awkit-5dn` (P3)
  rather than bundled.
- **Noticed:** `scripts/verify-legacy-compat.mts` has **no npm script** — I ran it directly (152/152).
  `verify:verifier-classification` reconciles package.json against the registry, so it cannot see a
  verifier file that was never registered.
- **Tests:** run-report-compatibility **21/21**; legacy-compat **152/152** (direct); telemetry
  **61/61**; runner **89/89**; Reports GUI **31/31**; ipc-contract **5/5**; build;
  `typecheck:scripts`; source-hygiene **9/9**; verifier-classification reconciled; roadmap dashboard
  **135/135**; `git diff --check` clean.
- **Result:** `awkit-vbj` closed. Beads **9 outstanding / 141 closed** of 150. Ledger unchanged at
  62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-02 - Claude Code - Issuer key custody (`awkit-5ea`)

- **Task:** the custody rule shipped for the dependency-manifest key did not cover the issuer key.
  Its default under `%LOCALAPPDATA%` is fine, but `SPECTER_ISSUER_KEY` could point at a synced folder
  and nothing checked — and this key signs licences for other machines.
- **Implementation:** new canonical `src/security/keyCustody.ts` (whole-segment detection for seven
  providers + sync-client env vars, fail-closed `evaluateKeyCustody`, `redactKeyPath`, same exact-`1`
  override). `LicenseIssuerService.loadSigningKey` evaluates custody **before** `readFile` and throws
  the new `ISSUER_KEY_UNSAFE_LOCATION`; it is the single funnel, so `readiness()` and `issue()` are
  both covered. Renderer maps the reason to a specific, actionable message.
- **Why two implementations, and how they are held together:** the packaging signer runs under plain
  `node` (no TypeScript) and `allowJs` is false (so the app cannot import the `.mjs`). Sharing a
  runtime module is impossible, so `verify:release-key-custody` became `.mts` (plus a `.d.mts` for
  the script-side module), imports **both**, and drives one fixture table through them — identical
  verdicts, identical redaction, same provider list, same override variable.
- **Mutations (each applied, run, reverted):** issuer check removed → **2 fail**; custody moved after
  the read → **2 fail** (ordering assertion, and readiness reporting `ISSUER_KEY_MISSING` instead);
  app-side table drops a provider the script keeps → **2 fail** (the parity check); app-side override
  accepts any truthy value → **1 fail**.
- **No key material touched.** The issuer cases use non-existent paths and a placeholder trust root;
  nothing was created, read, moved or rotated.
- **Tests:** release-key-custody **58/58** (was 39/39); licensing **183/183**; authz **92/92**;
  admin-gui **18/18**; e2e-licensing **38/38**; ipc-contract **5/5**; ipc-error-message **22/22**;
  build; `typecheck:scripts`; source-hygiene **9/9**; verifier-classification reconciled; roadmap
  dashboard **135/135**; `validate:offline`; `git diff --check` clean. The `awkit-2l1` release-key
  gate still refuses, as designed.
- **Repeat of a known trap:** a Python heredoc turned `\release-keys` into a carriage return in
  `docs/security/RELEASE_KEY_CUSTODY.md` — the same mistake as two tasks ago. Caught by the
  pre-commit control-character scan and repaired with `String.fromCharCode`. Use `node` with
  explicit char codes, not Python heredocs, for text containing Windows paths.
- **Result:** `awkit-5ea` closed. Beads **9 outstanding / 140 closed** of 149. `awkit-2l1` unchanged
  and still owner-blocked. Ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-02 - Claude Code - IPC toast no longer leaks the channel name (`awkit-x48`)

- **Task:** an unsafe-undo refusal reached the user wrapped in Electron's
  `Error invoking remote method '<channel>': ` preamble. Cosmetic, but it puts an internal channel
  name in front of an operator.
- **Implementation:** fixed at the single renderer-facing boundary, not per toast. New
  `app/main/ipcErrorMessage.ts` (anchored preamble strip, bounded unwrap for the nested case, then
  only the GENERIC `Error: ` name — `TypeError:` and friends are kept because they mean a bug, not a
  refusal; empty/non-Error input falls back). `preload.ts` gained an `invoke()` wrapper that routes
  rejections through it and keeps the original as `cause`; all **202** call sites now use it and the
  wrapper is the only remaining direct `ipcRenderer.invoke`. No renderer change was needed.
- **Placement note:** the helper started in `src/ipc/` and the preload bundle failed to resolve
  `@src` — `electron.vite.config.ts` gives `main` and `renderer` an alias block but `preload` none,
  because preload had only ever used type-only imports from there. Rather than change build config,
  the helper moved to `app/main/`, which is also where an Electron-transport detail belongs.
- **Real-app proof:** `verify:flow-designer` now drives a rejected `validation:undoMigration` through
  the built app and asserts the renderer sees `No migration … for flow …` with no channel name and a
  non-empty message. **72/72** (was 69/69).
- **New verifier:** `verify:ipc-error-message` **22/22** (class `unit`). Mutations with focused
  failures: preamble not stripped; any `*Error:` name stripped; unanchored match; one call site
  bypassing the wrapper.
- **Collateral damage caught by running the gates:** the rename broke `verify:ipc-contract`, whose
  preload parser matched `ipcRenderer.invoke("channel")` — it reported **`0 exposed, 224
  backend-only`** and would have described an empty contract as merely "backend-only". Fixed to
  accept both spellings **and** carry a cardinality floor so a dead pattern fails loudly. **5/5, 202
  exposed.**
- **Intermittent, investigated not shrugged at:** one `verify:flow-designer` run failed the
  compact-viewport Node Properties geometry check. Two re-runs of the same tree were 72/72 and clean
  HEAD was 69/69, so it is not attributable to this change. Filed as `awkit-73s` (P4).
- **Also filed:** `awkit-5ea` (P2) — the issuer console's `SPECTER_ISSUER_KEY` override has no
  synced-folder custody check, so the rule shipped for the release-manifest key does not cover the
  key that signs customer licences. Found while reviewing `awkit-0tn` during TAKEOFF.
- **Tests:** ipc-error-message **22/22**; ipc-contract **5/5**; flow-designer **72/72**; auth-gui
  **25/25**; admin-gui **18/18**; build; `typecheck:scripts`; source-hygiene **9/9**;
  verifier-classification reconciled (160); roadmap dashboard **135/135**; `validate:offline`;
  `git diff --check` clean.
- **Result:** `awkit-x48` closed. Beads **10 outstanding / 139 closed** of 149. Ledger unchanged at
  62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-02: Hand off completed Issuer console work (`awkit-0tn`)

- **Agent:** Codex
- **Task:** Prepare the active repository handoff for the next coding agent or human operator.
- **State recorded:** `main` and `origin/main` matched at implementation commit `9f391c9`; the working
  tree was clean before the handoff note. `awkit-0tn` is closed; Beads are 147 total / 138 closed.
- **Handoff:** recorded delivered role/route/IPC/signing behavior, principal files, exact verifier
  results, the external Issuer-key provisioning and real-Electron walkthrough still owed, the offline
  cross-machine transfer boundary, remaining open Beads, and signing-key/manifest do-not-touch rules.
- **Files:** `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `node scripts/ai-memory/check-memory.mjs` PASS; Program Status dashboard verifier
  **135/135**, including source agreement and ledger **62 PASS / 3 NOT RUN / 1 BLOCKED**.
- **Result:** transfer note ready; no source behavior or project status changed.

---

## 2026-08-02: Add singleton Issuer role and in-app offline license issuance (`awkit-0tn`)

- **Agent:** Codex
- **Task:** Add a page accessible only to one user with the `Issuer` role, consume exported activation
  JSON, and remove the command-line/manual issuance step while preserving offline private-key custody.
- **Behavior:** added the exclusive singleton built-in Issuer role; Super User provisioning/reassignment
  guards; exact-role renderer and trusted IPC gates; fresh-reauth issuance; strict request/key validation;
  automatic atomic `.dat` output; secret-free issuance history; and an Issuer-only responsive admin page.
- **Security:** the package contains signing logic but no private key. The external key must match the
  shipped public key, is read only by the main process, and is never returned/logged. Other roles,
  direct grants, and Super User are denied by the issuer IPC. Remote cross-machine installation remains
  a documented transfer/import step because the app has no authorised online transport.
- **Files:** `.beads/{interactions,issues}.jsonl`;
  `src/security/{authz/Permissions.ts,admin/UserAdminService.ts,errors/ReasonCodes.ts}`;
  `src/licensing/{LicenseTypes.ts,crypto/LicenseSignature.ts,issuer/**}`;
  `app/main/{licensing/issuerRuntime.ts,ipc/{issuer,index}.ts,preload.ts}`;
  `app/renderer/{App.tsx,routes.tsx,layout/LeftNavigation.tsx,security/{routePermissions,usePermissions}.ts,pages/admin/{LicenseIssuerPage.tsx,UserManagement.tsx,adminMessages.ts}}`;
  `scripts/verify-{authz,licensing}.mts`; `scripts/verify-e2e-rbac-gui.mjs`; licensing/AI-memory docs;
  `tools/license-issuer/README.md`.
- **Verification passed:** `npm run build`; `npm run typecheck:scripts`; `verify:authz` **92/92**;
  `verify:licensing` **183/183**; `verify:random-lifecycle` **13/13**; `verify:ipc-contract` **4/4**;
  `verify:admin-gui` **18/18**; `verify:e2e-rbac` **70/70**; `verify:e2e-licensing` **38/38**;
  `verify:source-hygiene` **9/9**; `verify:secrets` **16/16**; verifier classification **158/158**;
  `validate:offline` PASS.
- **Not run:** real-Electron issuance with a provisioned production private key and rebuilt packaged
  issuer workflow; the task intentionally had no access to production signing material. Domain issuance
  used an ephemeral key and cryptographically verified the generated file.
- **Result:** feature complete; bead closed. Ledger unchanged at **62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## 2026-08-02 - Claude Code - Release signing-key custody gate (`awkit-2l1`, still OPEN)

- **Task:** the offline-manifest private key sits in the repo's git-ignored `.release-local/`, but
  the repo lives under OneDrive, so custody extends into a cloud account. Bead is explicit: **owner
  action required; do not move or rotate signing material automatically.**
- **Scope taken:** the tooling half only. The key was **not** moved, rotated, read or copied at any
  point; its presence was confirmed by `statSync` (size/mtime) alone.
- **Implementation:** new `scripts/lib/release-key-custody.mjs` — resolution order (flag →
  `AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY` → `%LOCALAPPDATA%\SpecterStudio\release-keys` → legacy
  in-repo path, kept resolvable so its use produces a precise refusal rather than "key is missing"),
  whole-path-segment sync detection for seven providers plus the sync clients' own env vars, a
  fail-closed `assertKeyCustody`, and `redactPath` so no account name reaches a log. Wired into
  `offline-manifest-signature.mjs` for `sign` and `generate-key` only — `verify` never reads the
  private key and is untouched.
- **Deliberate consequence:** packaging now fails at the manifest-signing step on this machine until
  the owner moves the key. `verify` exits 0; `validate:offline` passes.
- **Docs:** `docs/security/RELEASE_KEY_CUSTODY.md` (owner runbook: provision-or-rotate, secure
  removal including OneDrive recycle bin and version history, re-verify, run the guard) and a
  COMMANDS.md section.
- **New verifier:** `npm run verify:release-key-custody` **39/39** — pure path/env reasoning, reads
  no key, launches nothing; registered in `verifier-classification.ts` (class `unit`, 158 scripts).
- **Mutations (each applied, run, reverted):** gate downgraded to always-allow → **5 fail**;
  substring instead of whole-segment matching → **3 fail** (false refusals for `onedriveclone`,
  `boxes`, `dropboxed`); approved location no longer preferred → **2 fail**; override accepting any
  truthy value → **1 fail**.
- **Self-inflicted defect caught:** a Python heredoc turned `\release-keys` into a literal carriage
  return inside `COMMANDS.md`, a file the roadmap dashboard parses. Found by scanning every touched
  file for control characters before commit and repaired with `String.fromCharCode`; re-scan clean.
- **Tests:** custody **39/39**; build; `typecheck:scripts`; source-hygiene **9/9**;
  verifier-classification reconciled; roadmap dashboard **135/135**; `validate:offline`;
  `node scripts/offline-manifest-signature.mjs verify` **exit 0**; `git diff --check` clean.
- **Result:** `awkit-2l1` **stays OPEN (in progress)** — three acceptance criteria are owner-only:
  provision/rotate into the approved location, securely remove the synced copy, re-verify the trust
  root. Progress and the exact remaining steps are recorded on the bead. Beads unchanged at
  **9 outstanding / 137 closed** of 146. Ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-02 - Claude Code - Recorder baselines the loaded page; verifiers test the shipped install order (`awkit-a7k`)

- **Task:** the recorder verifiers injected the init script with `page.evaluate` after `goto`, while
  production uses `context.addInitScript` (document start). The harness was testing an order the
  product never uses.
- **Product fix (the substantive half):** the at-rest baseline ran the instant the script executed,
  which under the real install order is before the page's markup is parsed. `startObservation` now
  runs on `DOMContentLoaded` (or immediately if already parsed). Before this, on every production
  recording: `absentAtBaseline` was true for the whole page, the initial parse was recorded as
  insertions with null witnesses (burning up to `INSERTION_RECORD_CAP` records at load), and
  `nearestInsertion` hit one of those on an ancestor of nearly any target — making the fail-closed
  saturation guard unreachable. Positives were unaffected because a target's own record is checked
  before any ancestor, which is why three tasks of green runs never showed it.
- **Harness fix:** `verify-recorder-hover` and `verify-recorder-ambiguity` switched to
  `context.addInitScript` (`verify-recorder-locator` already used it). New source guard `[0]` asserts
  across every recorder verifier that none injects via `page.evaluate` and all use `addInitScript`,
  with a cardinality check first so an empty scan cannot satisfy it.
- **Mutations:** deferral undone → **4 fail** (the saturation section, exactly as predicted when the
  bead was filed); one verifier reverted to post-load injection → **1 fail** naming that file.
- **Two self-inflicted defects caught in passing:** a Python heredoc mangled an escape into a literal
  control character in the new verifier source (caught by re-scanning before commit — this is what
  `verify:source-hygiene` exists for), and `new URL(...)` failed to compile because the file declares
  its own `URL` constant; switched to `fileURLToPath`.
- **Tests:** `verify:recorder-hover` **214/214** (211 + 3 source-guard, now production order);
  recorder **171/171**; ambiguity **62/62**; recorder-flow **29/29**; recorder-draft **50/50**;
  recorder-redaction **15 PASS / 0 FAIL**; REC-018 e2e **61 PASS / 0 FAIL**; Recorder GUI **166 PASS
  / 0 FAIL**; runner **89/89**; mock-site **110/110**; flow-step-mapping **111/0**; profile-store
  **18/18**; ipc-contract **4/4**; Flow Designer GUI **69/69**; catalog parity **39/39**;
  verifier-classification reconciled; source-hygiene **9/9**; roadmap dashboard **135/135**; build,
  `typecheck:scripts`, `validate:offline`, `git diff --check` pass.
- **Result:** `awkit-a7k` closed. Beads **9 outstanding / 137 closed** of 146. Ledger unchanged at
  62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-02 - Claude Code - Remote (non-adjacent) hover trigger attribution (`awkit-hmt`)

- **Task:** a hover trigger in a different subtree from what it reveals was classified `none` — no
  hover step, and a click that fails replay.
- **Finding that shaped the fix:** a remote hover that INSERTS a control has been attributed since
  `awkit-0vm` (the insertion resolver never required adjacency); only a remote hover that UNHIDES an
  existing control was refused. Same interaction, same evidence, opposite verdicts. The fix removes
  that inconsistency rather than inventing a signal.
- **Implementation:** `revealWitness` now stores `{el, since, at, cause}` instead of a bare element,
  so the reveal path has the pointer's ARRIVAL time and competing causes. New
  `resolveRemoteHoverTrigger` requires a concrete witness, `cause === "pointer"`, arrival within
  `INSERTION_CAUSAL_WINDOW_MS` of the reveal, the witness outside the revealed surface, still
  connected, still the pointer owner at click time, and a stable locator via the shared
  `buildTriggerLocator`. Chained AFTER the sibling path in both reveal shapes, so it can only turn
  `none` into `trigger`/`review` and every existing verdict is preserved.
- **Fixtures:** `.remote-trigger-j5w1` gained an observable result (`remote-click-result`) so replay
  is provable; new `.rtimer-*` negative where a timer reveals a remote control while the pointer is
  idly MOVING over an unrelated named button.
- **Mutations:** remote attribution disabled → **6 fail**; reveal-witness requirement removed →
  **2 fail**; arrival window removed → **2 fail** (attributes `Idle hover area` to a timer reveal).
  The arrival-window mutation SURVIVED THREE TIMES before the fixture was honest: the negative first
  refused on witness freshness, then on a sampling gap at 100ms intervals, then because raw
  `mouse.move` to a control below the viewport produced no pointer events at all (`since=0`).
  Diagnosed by instrumenting the resolver's null paths, not by guessing. NOT COVERED on the remote
  path: the competing-cause filter and the "witness outside the revealed surface" check (both have
  fixtures on the insertion path).
- **Tests:** `verify:recorder-hover` **211/211** (was 191/191) incl. two-fresh-page replay and
  click-alone-fails; recorder **171/171**; ambiguity **62/62**; recorder-flow **29/29**; runner
  **89/89**; mock-site **110/110**; flow-step-mapping **111/0**; profile-store **18/18**;
  ipc-contract **4/4**; Recorder GUI **166 PASS / 0 FAIL**; Flow Designer GUI **69/69**; catalog
  parity **39/39**; verifier-classification reconciled; source-hygiene **9/9**; roadmap dashboard
  **135/135**; build, `typecheck:scripts`, `validate:offline`, `git diff --check` pass.
- **Filed `awkit-a7k` (P2):** the recorder verifiers install via `page.evaluate` after load while
  production uses `context.addInitScript` at document start. Probed both orders — ordinary clicks are
  unaffected on 282- and 1807-element pages (no parse-time saturation, so `db0babd`'s fail-closed
  guard does not regress real recordings), but the harness switch gives 187/191 and shows that guard
  is largely inert in production. Not fixed here; it is a harness change, not this bead.
- **Result:** `awkit-hmt` closed. Beads **10 outstanding / 136 closed** of 146. Ledger unchanged at
  62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-02 - Claude Code - Open-shadow hover triggers persist the internal control (`awkit-0vm` reopened)

- **Task:** owner rejected the host-substitution behaviour shipped in `db0babd`. A successful fixture
  replay does not make host substitution safe: a host's action point need not lie on the internal
  control, and a listener bound to that control does not fire for a hover that never enters it.
- **Root cause of the wrong witness:** `event.target` is retargeted to the host on a window-level
  capture listener, so the pointer trail recorded hosts, not internal controls. `recordPointer` now
  uses the composed path (which correctly stops at the host for a closed root).
- **Implementation:** `buildTriggerLocator` builds the persisted trigger locator and its verdict as
  ONE object (used for both the guard and the payload). For a shadow-internal trigger it emits the
  Increment 6 shape — ordered outer-to-inner `context.shadow.hosts` + a semantic locator generated
  against the innermost root, strictly unique within it, non-positional, no XPath — resolved by the
  existing `LocatorFactory`. No new executor, no piercing selector. A host is persisted only when the
  host itself was the observed witness; otherwise unrepresentable → `needs-review` with
  `hover trigger inside open shadow root could not be represented safely` and no fallback.
- **Fixture:** nested open roots (420x180 outer, 400x160 inner) with a 90x26 trigger pinned to the
  corner and the `mouseenter` listener on the trigger, so hovering either host's action point inserts
  nothing; plus `.ins-shadow-decoy-r4k8` sharing the trigger's accessible name so the host chain is
  load-bearing, and `.insu-shadow-host-r4k8` (two nameless twins) for the unrepresentable case.
- **Proved:** capture selects the inner trigger; ordered context survives profile JSON + structured
  clone (IPC) round trips; Hover→Click succeeds on two fresh pages from the round-tripped profile;
  the primary locator is ambiguous without its host chain and resolves with it; hovering the host
  inserts nothing (the old behaviour fails); unrepresentable → needs-review with the reason on the
  step.
- **Mutations:** inner witness→host → **7 fail**; shadow context dropped → **5 fail**; host order
  reversed → **7 fail**; strict inner uniqueness removed → **5 fail** (layered behind the fallback
  guard: removing fallback alone still refuses, which is the point of the layer). The `:nth-*` regex
  on the inner locator is **NOT independently observable** — with `allowPositional: false` the
  generator marks an unresolvable inner target `quality.strategy === "fallback"` (value `button`)
  instead of emitting an `nth` chain, so the fallback guard always decides first. Kept as
  defence-in-depth and reported as uncovered rather than claimed.
- **Tests:** `verify:recorder-hover` **191/191** (was 166/166); recorder **171/171**; ambiguity
  **62/62**; recorder-flow **29/29**; runner **89/89**; mock-site **110/110**; flow-step-mapping
  **111/0**; profile-store **18/18**; ipc-contract **4/4**; Recorder GUI **166 PASS / 0 FAIL**; Flow
  Designer GUI **69/69**; catalog parity **39/39**; verifier-classification reconciled;
  source-hygiene **9/9**; roadmap dashboard **135/135**; build, `typecheck:scripts`,
  `validate:offline`, `git diff --check` pass. No BLOCKED or NOT RUN.
- **Result:** `awkit-0vm` closed again. Beads unchanged at **10 outstanding / 135 closed** of 145.
  `awkit-hmt` untouched. Ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-02 - Claude Code - Hover-inserted control attribution (`awkit-0vm`)

- **Task:** a control inserted only after a hover has no hidden-at-rest record, so the hover paths
  never saw it and the click was saved with no prerequisite. Absence is not hiddenness.
- **Implementation:** bounded insertion-evidence subsystem in `recorderInitScript.ts` — insertion
  records from the recorder's own MutationObserver (document + per-open-shadow-root observers, caps
  600 records / 64 descendants / 32 roots), pointer residence (owner + arrival time),
  `absentAtBaseline`, and navigation/click/focus competing-cause clocks. `resolveInsertedHoverTrigger`
  runs before the hidden-at-rest paths and requires observed insertion + `cause === "pointer"` + a
  concrete witness + pointer ARRIVAL within 600ms of the insertion + witness outside the inserted
  surface + still connected + still the pointer owner + a stable non-positional locator. Otherwise
  `needs-review` with a `hoverReviewReason`; the record bound fails closed to review. New optional
  `hoverInserted` / `hoverReviewReason` evidence on `RecorderTypes` and `LocatorInteractionEvidence`;
  `buildRecordedFlow` carries the reason into the step's `reviewReason`.
- **Two real defects found by the fixtures, both fixed:** a compound `:nth-of-type(...)` trigger
  passed `isStableGenerated` (new `isStableTriggerLocator`, now used by all three hover paths), and
  `hoverContainer` persisted a different generation from the one the guard validated.
- **Fixtures:** eleven new Recorder Lab scenarios (`ins-*`) — inserted sibling, inserted container,
  three-from-one-hover, re-inserted same node, open-shadow insertion; negatives for timer,
  witness-less, unrelated subtree, click-driven, positional-only and vanishing trigger; plus a flood
  that exhausts the insertion-record bound.
- **Mutations (all six required, each applied, run, reverted):** observed-insertion requirement
  removed → fails; pointer-witness removed → **4 fail**; causal window removed → **2 fail**;
  stable-locator guard removed → **5 fail**; dedup removed → **3 fail**; unrelated-mutation filtering
  removed → **2 fail**. The witness mutation survived its first two formulations (subsumed by the
  temporal checks) until section `[18b]` was added, and the dedup mutation was inert until the
  fixture re-inserted the SAME node rather than a replacement.
- **Tests:** `verify:recorder-hover` **166/166** (baseline 81/81) incl. two-fresh-page replay and a
  profile JSON round trip; recorder **171/171**; ambiguity **62/62**; recorder-flow **29/29**; runner
  **89/89**; mock-site **110/110**; flow-step-mapping **111/0**; profile-store **18/18**; IPC contract
  **4/4**; Recorder GUI **166 PASS / 0 FAIL**; Flow Designer GUI **69/69**; catalog parity **39/39**;
  verifier-classification reconciled; source-hygiene **9/9**; roadmap dashboard **135/135**; build,
  `typecheck:scripts`, `validate:offline`, `git diff --check` all pass. No BLOCKED, NOT RUN or
  INCONCLUSIVE results.
- **Result:** `awkit-0vm` closed. Beads **10 outstanding / 135 closed** of 145. `awkit-hmt` (remote
  non-adjacent triggers) deliberately untouched. Ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-02 - Claude Code - Adjacent-sibling hover trigger attribution (`awkit-vot`)

- **Task:** `.trigger:hover + .target` reveals were classified `none` — the trigger is not an ancestor
  of what it reveals, so the composed-path walk found no hidden ancestor run and emitted no hover
  step. The recorded click then failed replay because the control is hidden until the sibling is
  hovered.
- **Implementation:** new `resolveSiblingHoverTrigger` in `recorderInitScript.ts`, used when the
  ancestor walk finds no hidden run and as a fallback wherever it would return `review`. Attribution
  needs four pieces of evidence: the last pointer sample OUTSIDE the revealed surface; that sample in
  a sibling subtree of the revealed root (with action-owner promotion not escaping it); a new
  `revealWitness` map recording where the pointer was when a hidden-at-rest control was first observed
  visible (300ms window — this is what makes it causal rather than correlational); and the existing
  non-positional stability bar. No sibling evidence → previous verdict unchanged, so async
  self-reveals stay unflagged and `awkit-0vm` is untouched.
- **Fixtures:** five new Recorder Lab scenarios — positive `.sib-trigger-h3k9`; negatives for an
  unnamed span trigger, a nameless hash-class button (positional-only), and a timer reveal beside a
  hovered sibling; plus `.remote-trigger-j5w1` pinning the non-adjacent boundary.
- **Negative controls (each applied, run, reverted):** sibling attribution disabled → **9 fail**;
  reveal-witness guard removed → **2 fail** (recorder fabricates `hover "Unrelated sibling"` for a
  timer reveal); positional locators allowed → **3 fail** (an `nth-child` chain persisted as a
  trigger); adjacency requirement dropped → **2 fail** (a distant trigger attributed).
  Two of these survived the first time and drove new fixtures: `[12]`'s unnamed span is rejected
  before the stability guard is reached, and no fixture exercised adjacency at all. Both guards were
  passing vacuously until `[12b]` and `[12c]` were added.
- **Tests:** `verify:recorder-hover` **81/81** (baseline 48/48, +33 checks) incl. real-StepExecutor
  replay; recorder locator **171/171**; ambiguity **62/62**; recorder-flow **29/29**; Mock Site
  **110/110**; source-hygiene **9/9**; catalog parity **39/39**; roadmap dashboard **135/135**
  ("Sources agree"); build PASS; `typecheck:scripts` PASS; `validate:offline` PASS;
  `git diff --check` clean.
- **Result:** `awkit-vot` closed; `awkit-hmt` filed for remote (non-adjacent) triggers, the boundary
  this deliberately leaves open. Beads **11 outstanding / 134 closed** of 145 (dashboard total and
  tally pins updated). `awkit-0vm` left open. Ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-02 - Claude Code - Flow Designer hover catalog entry + Unknown-step rendering (`awkit-8lz`)

- **Task:** hover steps rendered on the canvas as "Start / Flow entry point" with the Play icon,
  because `getFlowNodeCatalogItem` returned `flowNodeCatalog[0]` for any type without a catalog
  entry and `hover` was registered in the registry only.
- **Implementation:** added the `hover` catalog entry (`MousePointer2`, "Hover", "Hover over an
  element", `requiresLocator`); replaced the entry-zero fallback with an explicit
  `unknownFlowNodeCatalogItem` (`HelpCircle`, "Unknown Step", description naming the offending type)
  plus a `console.error`, so an unrecognized type is visible as unknown instead of impersonating a
  structural Start node; exported `registeredStepTypes` from the registry as the parity counterpart.
- **New verifier:** `npm run verify:flow-node-catalog-parity` (**39/39**) — catalog↔registry in both
  directions plus the `StepType` union parsed from `FlowProfile.ts`, with cardinality/non-empty
  guards first so no set comparison can pass over an empty scan, and a source guard against the
  `?? flowNodeCatalog[0]` fallback returning. Registered in `package.json`,
  `scripts/lib/verifier-classification.ts` (class `unit`) and `docs/ai/COMMANDS.md`.
- **Negative controls (mutation-tested, all reverted):** hover catalog entry deleted → **7 fail**;
  registry-only type → **2 fail**; catalog-only type → **3 fail**; entry-zero fallback restored →
  **8 fail** (including "an unknown type is labelled Unknown Step — label=Start", the original defect).
- **Tests:** build PASS; `typecheck:scripts` PASS; catalog parity **39/39**; flow-step-mapping
  **111/0**; recorder-flow **29/29**; Flow Designer GUI **69/69**; Recorder GUI **166 PASS / 0 FAIL**;
  verifier-classification reconciled (**157** scripts); source-hygiene **9/9**; roadmap dashboard
  **135/135** ("Sources agree"); `validate:offline` PASS; `git diff --check` clean.
- **Observed once, not reproduced:** one Flow Designer GUI run reported 68/69; the failing check name
  was not captured, and five further runs (three post-change, two on a stashed pre-change rebuild)
  were all 69/69. Recorded as an unidentified intermittent, not attributed to this change.
- **Result:** `awkit-8lz` closed; beads **11 outstanding / 133 closed** of 144 (dashboard pin
  updated). `awkit-vot` and `awkit-0vm` left open. Ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-02 - Codex - COMPLETE Recorder hover action-owner repair (`awkit-3vh`)

- **Task:** take over Claude's uncommitted hover-trigger repair, reproduce its failing verifier, and
  finish the P1 action-owner/positional-locator fix without reopening the completed ambiguity epic.
- **Implementation:** promote visibility-selected wrappers to the nearest actionable owner; cover
  native controls, generic roles, labelled/tabbable/contenteditable elements, and custom-element
  hosts; generate hover triggers with positional candidates disabled; leave positional-only cases
  review-required. Extended `/recorder-lab` with positive `role=tab` owner and negative no-owner
  fixtures, plus real capture/fresh-page replay assertions. Removed the temporary debug script.
- **Tests:** initial inherited hover verifier reproduced **41 PASS / 7 FAIL**; corrected result
  **48/48**. Recorder locator **171/171**; ambiguity **62/62**; Mock Site **110/110**; build PASS;
  scripts typecheck PASS; `git diff --check` PASS.
- **Result:** `awkit-3vh` resolved. `awkit-vot`, `awkit-0vm`, and the separate open Flow Designer
  catalog defect `awkit-8lz` remain out of scope. Ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-01 - Codex - COMPLETE licensing enforcement and manifest provenance

- **Task:** close `awkit-f3l`, then `awkit-hj8`, without changing the committed dependency-manifest
  pair; preserve the separate Recorder residuals.
- **Implementation:** main-process startup/interval/focus/mutation/run-request enforcement; required
  synchronous fail-closed queue/repeat gate; transition-idempotent pending sweep and system audit;
  strict bootstrap registration; complete license status projection; BLOCKED/empty artifact verifier
  hardening; shell-free issuer and sibling TSX launches; release-only manifest version/HEAD provenance
  checks; documented committed release-artifact policy.
- **Tests:** build PASS; scripts typecheck PASS; licensing 167/167; dispatch gate 33/33; runner 89/89
  on the final isolated run; CLI-only 24/24; IPC 4/4; source hygiene 9/9; classification 156/156;
  ordinary offline validation PASS. One overlapping runner attempt lost the shared mock-site server;
  the isolated rerun passed. Strict offline validation failed exactly at the expected stale
  `sourceCommit != HEAD` release assertion.
- **Not run:** packaged licensing/walkthrough because the existing EXE predates the implementation;
  live Electron startup/timer/focus behavior was not manually exercised.
- **Tracking/result:** closed `awkit-f3l` and `awkit-hj8`; filed P1 `awkit-2l1` for owner-controlled
  signing-key relocation/rotation without recording key material. `awkit-vot` and `awkit-0vm` remain
  open; AWKIT-REC-030 remains resolved. Manifest JSON/signature bytes are unchanged. Ledger remains
  62 PASS / 3 NOT RUN / 1 BLOCKED.

---

## 2026-08-01 - Codex - COMPLETE Recorder ambiguity Increments 3/4 and epic closure

- **Task:** resume the paused `awkit-aui.3` / `.4` reconciliation, close the remaining live-review and
  positional-approval defects, run the complete gate set, and reconcile authoritative sources.
- **Implementation:** live `LocatorFactory` candidate/context validation and highlighting; pause before
  positional/unresolved commit; accessible Recorder review; reasoned exact approval binding; stale
  action/locator/context/safety invalidation; Flow Designer approval/revocation; validator/runner
  fail-closed guards; lower-resilience report/history diagnostics; Recorder Lab and GUI coverage.
- **Takeoff additions:** fixed unchanged Flow Designer saves falsely revoking approval when omitted
  `exact` normalized to `false`; preserved safety in the legacy mapping; added action/context/safety,
  unknown-field store/IPC, and report disclosure controls; fixed a repeated Recorder GUI poll race by
  waiting for the first rendered timeline before auditing its live region.
- **Tests:** build PASS; scripts typecheck PASS; Recorder 171/171; ambiguity 62/62; recorder-flow
  29/29; hover 34/34; runner 89/89; Mock Site 110/110; mapping 111/111; profile store 18/18; IPC 4/4;
  draft 50/50; authz 50/50; Recorder E2E 61/61 (18/18, 100% fidelity); Flow Designer 69/69;
  Recorder GUI 166/166; Reports live engine 21/21; Reports GUI 31/31; Reports/Settings a11y 14/0;
  classification 155/155; source hygiene 9/9; offline PASS. The first dashboard run correctly failed
  stale source counts before reconciliation; rerun recorded separately after source updates.
- **Tracking:** closed `awkit-aui.3.1`, `.3`, `.4.1`, `.4`, and epic `awkit-aui`; AWKIT-REC-030/033/034
  resolved. `awkit-vot`, `awkit-0vm`, and `awkit-hj8` remain separate. Dependency manifests untouched.

---

## 2026-08-01 - Codex - PAUSED handoff: reconcile Recorder ambiguity Increments 3/4

- **Task:** reconcile `awkit-aui.3` and `.4` against product behavior, real UI, persistence, runner
  policy, tests, Git, Beads, defects, and authoritative documentation.
- **Findings:** filed `awkit-aui.3.1` / AWKIT-REC-033 (unvalidated review choices and positional capture
  bypass) and `awkit-aui.4.1` / AWKIT-REC-034 (approval enum not bound to locator/context/action).
- **Uncommitted repair:** live `LocatorFactory` validation/highlighting; positional capture review;
  required approval reason; optional exact approval binding; stale-edit invalidation; validator/runtime
  guards; Recorder and Flow Designer review/approve/revoke UI; gated Recorder Lab fixture and real GUI
  lifecycle coverage.
- **Final focused results:** build PASS; scripts typecheck PASS; Recorder 171/171; ambiguity 60/60;
  Mock Site 110/110; Recorder GUI 166/166 with 0 NOT RUN; Flow Designer GUI 69/69; `git diff --check`
  PASS. Earlier failing iterations were corrected and are documented in `HANDOFF.md`.
- **Status:** paused before the remaining full gate set, final Graphify refresh, source reconciliation,
  acceptance matrices, commits, push, and closure decision. Working tree intentionally dirty at
  `57dfad2`; `main` and `origin/main` remain identical. Dependency manifests untouched.

---

## 2026-08-01 - Codex - Increment 6 Shadow DOM capture/replay (`awkit-aui.6`)

- **Task:** implement open/nested Shadow DOM capture and deterministic replay, honest closed-root and
  unsupported-frame review states, backward-compatible persistence, Recorder Lab scenarios, and
  mutation-sensitive real-browser verification.
- **Capture:** uses the first usable element from `event.composedPath()`; candidate uniqueness scans a
  bounded snapshot of all reachable open roots; nested stable hosts persist outer-to-inner. Shadow
  targets forbid XPath and positional fallbacks. Dynamic open roots and slotted light-DOM controls are
  classified correctly.
- **Replay:** `LocatorFactory` extends its normal context root as frame → shadow host(s) → container →
  target. `StepExecutor` remains the only action executor. Duplicate `Select` buttons replay against
  the recorded host; removing the host chain is a failing negative control.
- **Closed/frame guards:** a native-preserving `attachShadow` wrapper records closed hosts only in a
  `WeakSet`. Known closed-root and unsupported child-frame actions are review-required; preflight
  names the reason and blocks execution. Cross-origin evidence is origin/name only.
- **Compatibility:** optional shadow/evidence/review fields survive build, JSON, Flow Designer,
  structured clone/IPC, and profile storage; legacy locators remain executable.
- **Fixtures/tests:** Recorder Lab now covers unique/duplicate/nested/test-ID/dynamic/slotted/closed/
  ambiguous-host/same-origin-frame/cross-origin/traversal-cap cases. `verify:recorder` 171/171; ambiguity 59/59;
  recorder-flow 29/29; hover 34/34; runner 89/89; mock-site 110/110; mapping 105/105;
  profile-store 16/16; IPC 4/4; recorder-draft 50/50; recorder-authz 50/50; Recorder E2E
  61/61 with 18/18 (100%) production replay fidelity; Recorder GUI 152/152;
  build/typecheck/offline/source-hygiene/classification PASS.
- **Graphify:** Codex and Claude live CLI proofs queried the current 0.9.31 graph (456-node scoped
  traversal); Antigravity is recorded as owner-confirmed manual live-tool evidence.
- **Manifest:** dependency manifest JSON/signature untouched; `awkit-hj8` remains open.

## 2026-08-01 - Claude - Increment 2 reconciliation + awkit-bw9 fix (`awkit-aui.2`, AWKIT-REC-032)

- **Task:** determine the real state of `awkit-aui.2` (capture enrichment + landmark/href locator
  strategies), reconcile code/git/tests/bd, and fix the related P2 defect `awkit-bw9`.
- **Finding:** Increment 2 was implemented in commit `88ee9b0` but its bd item was left `in-progress`.
  Reconciled complete: capture enrichment (`interaction.path`/`x`/`y`/`matchIndex`), landmark scoping
  (`detectContainer`/`describeContainer`, verified by `verify:recorder` CR5), href scoping
  (`buildCandidates`/`detectContainer`, new CR7), and capture→replay (ambiguity gate 1/2/3/3b). Closed
  `awkit-aui.2` (unblocks `awkit-aui.3`, `awkit-aui.6`).
- **Root cause (bw9):** `detectContainer` set the tableRow container name from `norm(row.textContent)`,
  concatenating adjacent cells without a separator (`"Customer BetaEdit"`); `LocatorFactory` replays via
  `getByRole('row',{name})`, which matches the space-joined platform accessible name (`"Customer Beta
  Edit"`) → never resolves → timeout. The existing C3 test masked it by hand-building a partial name.
- **Fix:** new `rowAccessibleName` joins the row's direct-child cells (`td/th/[role=cell]/[role=gridcell]/
  [role=columnheader]/[role=rowheader]`) with a space (ARIA name-from-content), normalizing repeated
  whitespace. Card `hasText` scoping matches `textContent`↔`textContent` and was already self-consistent,
  so it was left unchanged (minimal diff).
- **Tests:** `verify:recorder` gains CR6 (capture → save/reload → fresh-page replay; whitespace/newline
  normalization; partial-overlap row names; ARIA `role=row` with interactive children; old no-space name
  as a failing negative control) and CR7 (href discrimination) → **135/135**. `verify:recorder-ambiguity`
  gains **[3b]** (live customer-table row replay) → **58/58** (existing 55 preserved, mutation-sensitivity
  intact).
- **Section-4 note:** a live capture with `isUnique===false` is not honestly reproducible (structural
  fallback is serial-unique); the `needs-review` mapping stays verified at the `buildRecordedFlow` layer.
- **Tests run:** build PASS; typecheck:scripts PASS; verify:recorder 135/135; verify:recorder-ambiguity
  58/58; verify:recorder-flow 26/26; verify:recorder-hover 34/34; verify:runner 89/89; verify:mock-site
  99/99; verify:verifier-classification reconciled; verify:source-hygiene 9/9; validate:offline PASS;
  verify:roadmap-dashboard Sources agree.
- **Manifest:** `resources/dependency-manifest.{json,sig}` untouched (audit `awkit-hj8` still open).
- **Files:** `src/recorder/recorderInitScript.ts`, `scripts/verify-recorder-locator.mts`,
  `scripts/verify-recorder-ambiguity.mts`, `scripts/verify-roadmap-dashboard.mjs`, `docs/ai/*`,
  `docs/testing/comprehensive-validation/DEFECTS.md`.

---

## 2026-08-01 - Claude - Increment 7: nine-point ambiguity acceptance gate (`awkit-aui.8`)

- **Task:** implement `verify:recorder-ambiguity`, the durable nine-point Recorder ambiguity/
  replayability acceptance gate, driving the real responsible layers (not fixture text).
- **Verifier:** new `scripts/verify-recorder-ambiguity.mts` — records duplicate/ambiguous/hover
  controls in bundled Chromium, then exercises `recorderInitScript` capture + locator generation,
  `buildRecordedFlow`, `FlowValidator` preflight (`validateFlowDefinition`/`hasActivePathError`/
  `executionBlockingErrorsOf`), `LocatorFactory` (approved-fallback recovery event) and `StepExecutor`,
  plus JSON/`structuredClone` round trips and the import re-validation contract. Registered in
  `package.json`, `scripts/lib/verifier-classification.ts` (real-browser) and `docs/ai/COMMANDS.md`.
- **Point 6 (zero-launch):** real `chromium.launch` counter + control — the unresolved flow's static
  preflight blocks (`locatorNeedsReview`, active-path) and 0 browsers launch; a resolved flow passes and
  launches exactly once. Mirrors the `execution.ipc.ts:267` gate with the real validator.
- **Mock-site:** added a `pos-twins` positional-approval fixture to `/recorder-lab`; relabelled its
  buttons to a benign "Pick option" (the guard treats "approve" as a dangerous keyword). README updated.
- **Result:** `verify:recorder-ambiguity` **55/55**. Mutation-tested: forcing `buildRecordedFlow` to
  drop the `needs-review` default makes points 4 and 6 fail — the suite is defect-sensitive, not vacuous.
- **Findings/tracking:** filed `awkit-bw9` (table-row container name captured without cell spacing fails
  `getByRole` replay — genuine, out-of-scope gap); Increment 5 residuals `awkit-vot`/`awkit-0vm`;
  dependency-manifest audit `awkit-hj8` (manifest NOT modified this increment). All in `KNOWN_ISSUES.md`.
- **Tests run:** build PASS; typecheck:scripts PASS; verify:recorder-ambiguity 55/55; verify:recorder-hover
  34/34; verify:recorder 119/119; verify:recorder-flow 26/26; verify:runner 89/89; verify:mock-site 99/99;
  verify:verifier-classification reconciled; verify:source-hygiene 9/9; validate:offline PASS;
  verify:roadmap-dashboard Sources agree (full results in the session summary).
- **Files:** `scripts/verify-recorder-ambiguity.mts`, `package.json`, `scripts/lib/verifier-classification.ts`,
  `mock-site/public/recorder-lab.html`, `mock-site/README.md`, `scripts/verify-recorder-flow.mts` (no
  change this increment), `docs/ai/*`, `docs/testing/comprehensive-validation/DEFECTS.md` (unchanged).

---

## 2026-08-01 - Claude - Repair Increment 5 hover replay (AWKIT-REC-031, `awkit-aui.5`)

- **Task:** repair Increment 5 — the recorded `hover` step targeted the hidden revealed surface, so
  hover-gated flows failed deterministic replay — and correct the tracking that called it complete.
- **Root cause:** trigger selection fell back to `composedPath()[1]` (the immediate parent = the
  revealed `display:none` surface) and a class heuristic never matched hyphenated names; the verifier
  asserted a selector substring and never replayed. Fresh-page replay: `locator.hover` timed out.
- **Fix (`recorderInitScript.ts`):** trusted **pointer trail** (`pointerover`/`mouseover`/throttled
  `pointermove`) + record-time first-seen (rest) visibility for interactive elements **and their
  ancestors**; new `resolveHoverTrigger` walks `composedPath()`, skips the hidden-at-rest revealed
  surface, and picks the first visible-at-rest, on-pointer-path, specific (not `html`/`body`/`main`,
  not a bare landmark), uniquely-resolvable ancestor. No immediate-parent fallback; no speculative
  re-hover. Unattributable trigger → `hoverUnresolved`; async self-reveal → no hover step.
- **Fix (`buildRecordedFlow.ts`):** inject the hover step from the trigger's full locator
  (`resolution: "resolved"`); when `hoverUnresolved`, leave the click `needs-review` and emit no hover
  step. `RecorderTypes.ts` gains `hoverUnresolved`. `StepSafetyPolicy.ts` was **not** touched — it
  already classifies `"hover"` (correcting the earlier entry's claim).
- **Verifier:** registered `verify:recorder-hover` in `package.json` (was classified + documented but
  not runnable) and rewrote it to drive the real `StepExecutor`+`LocatorFactory`: record → build →
  **replay Hover→Click on two fresh pages**, assert trigger identity, prove the old hidden-surface
  locator fails, and cover async/repeated/fast/needs-review. Mock-site gains stable test ids + async
  and no-stable-trigger fixtures.
- **Tests run:** `build` PASS; `typecheck:scripts` PASS; `verify:recorder-hover` 34/34; `verify:recorder`
  119/119; `verify:runner` 89/89 (full suite results in the session summary / CURRENT_STATE).
- **Files:** `src/recorder/recorderInitScript.ts`, `src/recorder/buildRecordedFlow.ts`,
  `src/recorder/RecorderTypes.ts`, `scripts/verify-recorder-hover.mts`, `package.json`,
  `mock-site/public/recorder-lab.html`, `docs/ai/*`, `docs/testing/comprehensive-validation/DEFECTS.md`.

---

## 2026-08-01 - Antigravity - Recorder hover-dependency capture and playback (superseded by AWKIT-REC-031 repair)

- **Task:** Implemented hover-dependency recording (Increment 5) to allow capturing interactions gated by `visibilityState`.
- **Finding:** Added `"hover"` as a valid StepType to `FlowProfile.ts`. Modified `recorderInitScript.ts` to detect elements that were originally hidden (via a first-seen `visibilityState` check) and only became visible during interaction, tagging them with `requiresHover: true` and a `hoverContainer` derived from `composedPath()`. (`StepSafetyPolicy.ts` already classified `"hover"`; it was **not** modified — original claim corrected.)
- **Implementation:** `buildRecordedFlow` injects `"hover"` steps explicitly before `"click"` actions requiring it. The runner's `StepExecutor` translates `"hover"` into `locator.hover()`.
- **Testing:** Added a hover-menu scenario to `mock-site/public/recorder-lab.html` and built `scripts/verify-recorder-hover.mts`. **Correction:** that verifier only confirmed capture + flow construction (8/8) and never replayed; a later re-review found the hover step targeted the hidden revealed surface and **failed deterministic replay** — see AWKIT-REC-031 above.
- **Files:** `src/profiles/FlowProfile.ts`, `src/recorder/recorderInitScript.ts`, `src/recorder/RecorderTypes.ts`, `src/recorder/buildRecordedFlow.ts`, `src/runner/StepExecutor.ts`, `mock-site/public/recorder-lab.html`, `scripts/verify-recorder-hover.mts`, `app/renderer/components/workflow/flowNodeRegistry.ts`, `src/testing/random/NodeCatalog.ts`, `src/validation/StepRequirements.ts`.

---

## 2026-07-31 - Claude - Recorder ambiguity/replayability defect + plan (AWKIT-REC-030, epic `awkit-aui`)

- **Task:** ran a live `youtube.com → Shorts → scroll button` record→save→replay probe using the
  Recorder's real capture engine (`recorderInitScript.ts` + `buildRecordedFlow`) and the runner's
  real `LocatorFactory.resolve`. Diagnosed a recording-to-execution reliability gap, then produced a
  full implementation plan and filed it. **No product code changed** (stop-for-review gate).
- **Finding:** the `Click Shorts` step recorded `role=link "Shorts"` with `isUnique:false,
  matchCount:2` (YouTube renders the guide entry twice; no stable testid), **saved clean**, and
  **failed at replay**. The scroll button (`role=button "Next video"`) recorded uniquely — so the gap
  is the *resolution workflow*, not the locator engine. Verified: no preflight quality rule
  (`FlowValidator` only has `missingRequiredLocator`, `:114`); ambiguity is enforced **runtime-only**
  (`StepExecutor.guardLocatorQuality` `:397`, which defers to `LocatorFactory.resolve` when
  alternatives exist); the recorder discards `composedPath()`/coords/chosen-candidate
  (`recorderInitScript.ts:1098`); `detectContainer` has no `<nav>`/landmark scope.
- **Classification (NOT an overall Recorder pass):** action capture / quality detection / strict-mode
  protection = PASS; **recorded-flow replayability = FAIL; ambiguity-resolution UX + preflight = NOT
  IMPLEMENTED**; hover = PARTIAL; shadow-DOM = PARTIAL.
- **Filed:** plan `docs/recorder-ambiguity-resolution-plan.md`; defect `AWKIT-REC-030` in
  `docs/testing/comprehensive-validation/DEFECTS.md`; `bd` epic `awkit-aui` + 7 dependency-ordered
  children (`awkit-aui.1`…`.6`, `.8`) with blocks edges — Inc1 (resolution-state schema + round-trips
  + execution preflight) is the only READY item and blocks the rest.
- **Verified:** `npm run verify:roadmap-dashboard` **135/135** (pins bumped 127→135 issues, 9→17
  outstanding, 76→83 edges after `bd export`). `npm run build` **not run** (no TS product changes).
- **Files:** `docs/recorder-ambiguity-resolution-plan.md` (new), `docs/testing/comprehensive-validation/DEFECTS.md`,
  `scripts/verify-roadmap-dashboard.mjs` (snapshot pins), `.beads/issues.jsonl` (export), `docs/ai/TASK_LOG.md`.

---

## 2026-07-30 - Claude - integrate Graphify as a project-scoped code knowledge graph (`awkit-843`)

- **Task:** install Graphify user-scoped, wire the Claude Code project integration, build the AWKIT
  graph, and add a graph-first retrieval rule that never outranks source or the required-reading docs.
- **Install:** `graphifyy` 0.9.30 (PyPI, CLI `graphify`) + the `[sql]` extra, via
  `uv tool install "graphifyy[sql]"` into an isolated user venv. `uv` itself installed with
  `python -m pip install uv` into the existing per-user Python. **No admin rights, no npm dependency,
  no change to the app runtime or packaging.** `electron-builder.json` packages only `out/**`,
  `package.json`, `resources/`, `vendor/` and the zvec native host — graphify cannot reach the
  packaged app.
- **Integration merged additively.** `graphify install --project` (non-strict) appended two
  `PreToolUse` hook-guards to `.claude/settings.json`; the existing `SessionStart` (`bd prime`) and
  `Stop` (`check-memory.mjs`) hooks are byte-identical. Guards verified **exit 0, silent,
  non-blocking** against `Grep`/`Read`/`Bash` payloads both **with and without** a graph present.
  Rewrote graphify's absolute install path in the hook command to bare `graphify` so no
  machine-specific private path is committed. `--strict` deliberately NOT used.
- **Graph:** **11264 nodes, 22960 edges, 605 communities** over **985 source files (983 of the 1141
  tracked)**, 99% `EXTRACTED` (22747) / 1% `INFERRED` (213), **0 tokens, fully offline**. Outputs:
  `graph.json`, `GRAPH_REPORT.md`, `graph.html` (aggregated — 11264 > the 5000-node viz limit).
- **`graphify update .` is the canonical BUILD, not just the refresh — and this was measured.**
  Driving the skill's pipeline by hand with no LLM key runs the AST pass only and yields a strictly
  smaller code-only graph: **7817 nodes / 19734 edges / 305 communities**. `graphify update .` adds a
  **structural Markdown pass** (headings, links, containment) and produced 11264/22960/605 from the
  same corpus with the same exclusions. Documented so nobody rebuilds the smaller graph by hand.
- **Recorded gaps, not concealed** (`--allow-partial` never used). All **158** tracked files absent
  from the graph are accounted for, bucket by bucket, in `GRAPHIFY.md`. Markdown is **structural
  only** — no semantic/LLM extraction was run (needs a Gemini key or ~13 subagents; not authorised,
  so not claimed). Not indexed at all: **`.css`** (unsupported by graphify — `global.css` and the
  whole Hologram token system are invisible) and **all 48 `mock-site/*.html`** scenario pages (0
  nodes). 41 `.json` fixtures parse to zero nodes. `graphify path` is **undirected**; ~1290 dangling
  edges point at unindexed externals.
- **Zero exclusion leaks, verified** by scanning every `source_file` in `graph.json`: nothing from
  `node_modules/`, `.beads/`, `logos/`, `vendor/`, build output or `graphify-out/`; the three big
  logs, `package-lock.json`, the signing `.pem` and `.npmrc` all absent.
- **Three corrections made mid-task:** 4 `.sql` files silently contributed nothing until the `[sql]`
  extra was installed; graphify's own vendored skill docs were being indexed into AWKIT's graph until
  `.claude/skills/graphify/` was excluded (AWKIT's *own* skills stay indexed); and the first graph
  was rebuilt via `graphify update .` once the hand-driven pipeline was found to under-index.
- **`graphify explain "window.playwrightFlowStudio"` resolves** — to the ADR at
  `docs/ai/DECISIONS.md:L337`. For the *code* contract use `graphify explain "PlaywrightFlowStudioApi"`
  → `app/main/preload.ts:L510` + the renderer `Window` interface. (On the AST-only graph the first
  form returned "No node matching"; the Markdown pass is what fixed it.)
- **`bd export` trap hit and recorded:** `bd close` followed by a plain `bd export` (which writes to
  STDOUT) left `.beads/issues.jsonl` showing `awkit-843` still open, and `verify:roadmap-dashboard`
  caught it at 133/135. Fixed with `bd export -o .beads/issues.jsonl`; the verifier's count pin was
  then moved 126 → 127 issues and 117 → 118 closed, with the reason recorded inline.
- **Files:** added `.graphifyignore`, `docs/ai/GRAPHIFY.md`, `.claude/CLAUDE.md`,
  `.claude/skills/graphify/`; modified `.claude/settings.json`, `CLAUDE.md`, `AGENTS.md`,
  `.gitignore`, `docs/ai/COMMANDS.md`, `docs/ai/CODEBASE-MEMORY-AND-BEADS.md`,
  `scripts/verify-roadmap-dashboard.mjs` (bead count pin).
  `graphify-out/` is gitignored (10 MB `graph.json`, local cost data, machine-specific paths).
- **Tests — all PASS:** `npm run build` clean; `git diff --check` clean;
  `verify:source-hygiene` 9/0; `verify:security` 39/0; `verify:verifier-classification` reconciled
  (153, no new script to register); `verify:offline-supply-chain` 22/0;
  `verify:roadmap-dashboard` **135/135**, and the live dashboard banner reads **"Sources agree"**
  (62 PASS / 3 NOT RUN / 1 BLOCKED, 13 sources, 0 stale claims).
- **NOT RUN:** `validate:offline` (packaging untouched; no packaged artifact rebuilt this session),
  `verify:runner` (no runner/orchestrator logic changed), `verify:mock-site` (no mock-site change).
- **No git hooks and no file watcher installed** — `.git/hooks/` holds only samples, no merge driver
  configured. Beads, the roadmap sources, the validation ledger and native search are all unchanged.

---

## 2026-07-30 - Claude - fix awkit-o7r: undo offered for records that cannot be undone

- **Task:** fix the regression the full single-artifact gate found in this campaign's own `fa87fc8`.
- **Root cause, stated precisely:** not the missing `afterHash`, but that **two places answered the
  same question**. `undoMigration` decided undoability from the digest; the renderer decided it from
  `!record.undoneAt`. They disagreed, so the UI offered an action main would always refuse.
- **Fix:** one predicate in main, `undoBlockedReason(record, current)`, used by **both**
  `undoMigration` (throws that sentence) and `migrationsForFlow` (reports `undoable` +
  `undoBlockedReason`). Blocks on already-undone, flow gone, `afterHash` not a current digest,
  digest mismatch, and **missing backup file** — the last previously surfaced as an uncaught
  `ENOENT` part-way through a restore. Renderer filters on `record.undoable`; preload type widened.
- **Files:** `app/main/validation/flowValidationService.ts`, `app/main/preload.ts`,
  `app/renderer/pages/FlowChartDesigner.tsx`, `scripts/verify-legacy-compat.mts`.
- **Tests:** `verify-legacy-compat` 138 -> **152/0**; `verify-validation` **125/0**; `npm run build`
  clean. **Mutation-tested** - restoring the old `!undoneAt` rule fails **6** of the new checks,
  including the exact reported case, so they are not vacuous.
- **Caught while writing the checks:** two of them were unreachable because their setup used a flow
  with no safe fixes, so `applySafeFixesToFlow` threw and an `if` silently skipped them (+10 checks
  where I had written 12). The conditional is gone; setup failure is now a hard failure.
- **Rebuilt and re-verified (same session).** Portable rebuilt from a clean tree at `53e3341` →
  `f12e84ea…`. `verify-packaged-validation` **86/1 → 87/0** (the prior failure was purely the
  freshness guard, which now reads "2 min old"). `verify:packaged-walkthrough` **25 / 0 fail /
  1 BLOCKED**: parts A–C pass in full, part D confirms the packaged fresh profile is
  `NOT_ACTIVATED` with **no** grace, enforcement **ON**, and a real run **refused** — then records
  BLOCKED for the four licensed runs because `AWKIT_PACKAGED_LICENSE_ISSUER_KEY` is not set here.
  That is the owner-specified behaviour (key confined to an authorized validation machine or CI
  runner); the gate makes no claim either way rather than skipping or passing.
- **Scope kept honest:** the single-artifact clean-machine gate was run against `f442f2c3…` and that
  record stands. `f12e84ea…` has **not** been through the clean-machine gate, and the lab VM still
  runs the older build.

---

## 2026-07-30 - Claude - clean-machine: the migration ceremony 8.7-8.11 (44 PASS / 0 FAIL)

- **Task:** finish runbook sections 8.7 through 8.11.
- **Result: all five PASS.** Preview lists `e1.conditional.operator: NotEquals -> notEquals` with
  "Errors: 1 -> 0" and writes nothing (no `validation\backups` directory existed until apply); the
  backup is written first and still holds the broken value while the live flow holds the fixed one;
  apply records `beforeHash`/`afterHash`/`skipped: []` and leaves the seeded `old-record.json`
  untouched; undo after a restart restores the flow **byte-for-byte** and keeps the backup; undo
  after a later edit is refused, naming the flow, the reason and the backup path, with the record
  left un-undone and the edit preserved.
- **Product defect found and fixed (`fa87fc8`):** `validation:migrations` had **zero renderer
  callers**, so "Undo migration" lived only in component state and did not survive a restart -
  8.10 was not executable against the shipped build. The designer now reads the durable record on
  load and re-offers the newest not-yet-undone migration, leaving the safety decision to main so
  8.11's refusal stays observable. `preload.ts` also declared the channel's type without
  `backupPath`, harmless only while nothing read it.
- **Seed fixture was wrong a third time:** the "fixable" flow set `condition = @{ source; operator;
  value }`, matching no part of `ConditionalConnectorConfig`, so it was ignored and the flow
  validated as fully Runnable with zero issues - 8.7-8.11 had nothing to act on. Measured the real
  shape against the live validator before writing it.
- **Artifact note:** because the fix had to ship to test 8.10, **8.10 and 8.11 ran against a rebuilt
  portable** (`f442f2c3…`), delivered on a fresh DVD and hash-verified on the machine by §2's own
  procedure. Everything through 8.9 pertains to the earlier artifact. Recorded, not smoothed over.
  Side benefit: 8.10's restart was an *upgrade*, so the record and backup survived replacing the app.
- **Files:** `app/renderer/pages/FlowChartDesigner.tsx`, `app/main/preload.ts`,
  `scripts/clean-machine/seed-upgrade-profile.ps1`, `scripts/clean-machine/attach-artifacts.ps1`
  (eject-before-rewrite + reuse the existing DVD drive instead of adding a duplicate), results doc,
  runbook disposition, `docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md`.
- **Beads:** `awkit-5ci` closed; `awkit-x48` filed (refusal toast leaks the IPC channel name).
- **Tests:** the five runbook checks on the VM; `npm run build` clean; `package:portable` succeeded
  (it correctly refused first, on a dirty tree). Not run: section 3.

---

## 2026-07-29 - Claude - clean-machine: the run-based checks executed on a second VM (39 PASS / 0 FAIL)

- **Task:** provision a fresh VM and finish the run-based checks (5.4, 5.8, 6.3, 8.1, 8.2).
- **Approach:** the first VM was permanently `fresh + consumed` so it could never admit a run.
  Preserved its 74 evidence files to `dist/clean-machine-evidence-vm1`, tore it down, reprovisioned,
  and seeded the upgrade profile **before first launch** - which made the install classify
  `upgraded` and opened the 14-day migration grace. Anchor confirmed
  `"installationKind": "upgraded", "consumed": false` before any UI work.
- **Result: all five PASS.** 5.4 granted off-path flow ran (`status: "passed"`) and the grant
  recorded it (`runsUnderCompatibility` 0->1, `lastRunAt` 14 ms before the run's start stamp), the
  retired FNV grant unused. 5.8/8.2 broken flow refused - *"Step Click with no locator (click)
  requires a locator"* - with no grant, no report, no instance produced. 6.3 hard-killed 4 processes
  with a 120 s wait in flight, no stranded Chromium; relaunch classified it `orphaned` + *"safe to
  re-run"*, one `startupRecovery` event, and rendered the recovery panel. 8.1 saved as **Draft**,
  still not runnable, defect untouched.
- **Files:** `scripts/clean-machine/seed-upgrade-profile.ps1` (about:blank so runs complete
  networkless; added a 120 s `seed-long-wait` flow as the 6.3 kill target),
  `scripts/clean-machine/vm-guest-click.ps1` (scroll fix), results doc, runbook disposition,
  `docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md`.
- **Two things recorded rather than glossed:** run reports carry **no** Legacy Compatibility
  attribution (it lives only on the grant record) - an observability gap, not a defect; and the draft
  save did alter the flow file (default `position` added, empty `config: {}` dropped) - attributable
  to the seed omitting layout, with the defect itself untouched.
- **Defect in my own tooling:** `vm-guest-click.ps1 -Scroll` had never worked downward and failed
  *silently* - `[uint32](-120)` throws in PowerShell instead of wrapping, the throw happened inside
  the scheduled task, and the stale marker file from the preceding move made the caller read back a
  plausible `at:x,y`. Fixed with an explicit two's-complement wrap.
- **Tests:** the five runbook checks above, executed on the VM. Not run: 8.7-8.11 (migration
  ceremony) and section 3.

---

## 2026-07-29 - Claude - clean-machine: Legacy grant lifecycle proven end to end (34 PASS / 0 FAIL)

- **Task:** add a non-UI trigger for the inventory scan and finish runbook sections 5.2 onward.
- **Product change:** "Re-scan Library" action in the Flow Library calls the already-gated
  `validation:runInventoryScan`, which had no caller anywhere. Same WORKFLOW_EDIT permission; an
  unauthenticated CLI trigger was rejected because the scan issues grants.
- **New passes (8):** 5.5, 5.6, 5.7, 5.9, 8.3, 8.4, 8.5, 8.6 - the full grant lifecycle: issue
  (sha256-bound, 30-day deadline), persist across restart, retain on description-only edit, void on
  executable edit, and re-scan without extending/reviving/duplicating.
- **Input breakthrough:** `vm-guest-click.ps1` clicks from INSIDE the guest via user32. Hyper-V's
  Msvm_SyntheticMouse never moves the pointer on this host and a VMConnect console does not help.
- **Near-miss:** the grant record is not stamped revoked on an executable edit; checking the UI
  showed the flow blocks and the pill disappears, because `evaluateGrant` derives the `edited`
  standing live. Nearly written up as a security defect.
- **Anti-tamper evidence:** the migration-grace ProgramData mirror survived every per-user profile
  wipe and kept the install classified `fresh + consumed` - the window did not reopen.
- **Still NOT EXECUTED:** 3, 5.4, 5.8, 6.3, 8.1-8.2 (all need a run; licensing blocks every run on
  this VM), 8.7-8.11 (migration ceremony UI).
- **Files:** `app/renderer/pages/FlowLibrary.tsx`, `scripts/clean-machine/*`, runbook, results doc,
  evidence, `docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md`.
- **Tests run:** verify:clean-machine-policy 28/28, verify:roadmap-dashboard 135/135,
  verify:ipc-contract 4/4, verify:authz 77/77, build + typecheck PASS.

---

## 2026-07-29 - Claude - clean-machine sections 5/6 attempted; grant lifecycle still unexecuted

- **Task:** run runbook sections 5, 6 and 8 against the offline VM.
- **Built:** `scripts/clean-machine/seed-upgrade-profile.ps1` (section 5.1 upgrade profile: 24 flows
  across valid/off-path/broken/fixable, 24 workflows, pre-hardening FNV grant, historical migration
  record), plus host-side UI driving - `vm-send-keys.ps1` and `vm-focus-app.ps1`.
- **Result: 23 PASS / 0 FAIL overall** (up from 20). New: 5.1 seeded library appears (24 saved
  workflows), 6.1 no install/no admin, 6.2 offline throughout.
- **NOT EXECUTED: 5.2-5.9, 6.3, 8.1-8.12.** `ensureInventoryScan()` has one caller - a run request in
  execution.ipc.ts - so the whole Legacy grant lifecycle is gated behind starting a real run in the
  UI. Measured at the end: 0 inventory-scan records, seeded FNV grant present and unrevoked. No claim
  made about grant retirement in either direction.
- **Why not completed:** host-side keyboard driving works (it completed first-run setup, sign-in and
  nav traversal unaided) but reaching a Run control costs one screenshot round-trip per Tab across a
  long scrolling sidebar. A guest-side UI harness would need Node and would violate constraints
  1.2-1.4, invalidating the gate.
- **Product positive, observed at 24-file scale:** unparseable profile JSON is quarantined as
  `<name>.json.corrupt-<ts>` with the parse error logged, not deleted
  (`ProfileStore.quarantineCorrupt`). User data survived intact.
- **Own bug:** the first seed used `Set-Content -Encoding utf8`, which on PowerShell 5.1 emits a BOM
  that Node's JSON.parse rejects - the trap `generate-dependency-manifest.ps1` already warns about.
  Seeder now writes BOM-free UTF-8 and clears stale quarantine.
- **Files:** `scripts/clean-machine/{seed-upgrade-profile,vm-send-keys,vm-focus-app}.ps1`,
  `CLEAN_MACHINE_VALIDATION_RUNBOOK.md`,
  `docs/testing/CLEAN_MACHINE_VALIDATION_RESULTS_2026-07-29.md`,
  `docs/testing/clean-machine-evidence/*`, `docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md`.
- **Tests run:** verify:clean-machine-policy 28/28, verify:roadmap-dashboard 135/135.
- **Result:** ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED; beads 120 / 6 outstanding / 114 closed.

---

## 2026-07-29 - Claude - clean-machine validation executed for the first time

- **Task:** run CLEAN_MACHINE_VALIDATION_RUNBOOK.md, which had never been executed.
- **Built:** `scripts/clean-machine/` - unattended Hyper-V VM provisioning (`provision-vm.ps1` +
  `autounattend.xml`), read-only artifact DVD delivery (`attach-artifacts.ps1`), the runbook driver
  (`run-runbook.ps1`), and agent-free host-side console capture (`vm-screenshot.ps1`).
- **Result: 20 PASS / 0 FAIL** across sections 1, 2, 4 and 7 on Windows 11 Pro 10.0.26100 x64 with
  zero network adapters and a standard non-administrator account. Sections 3, 5, 6, 8 NOT EXECUTED.
  The runbook is NOT claimed as PASSED; disposition is "partially executed, no failures".
- **Proved:** portable launches non-elevated and renders first-run setup with no SmartScreen block;
  NSIS installs per-user with no UAC, launches, and uninstalls cleanly; both artifact hashes verify
  on the test machine.
- **Deviations recorded:** Generation 1 BIOS VM (Hyper-V's Gen 2 UEFI refuses this ISO's boot loader
  with Secure Boot on and off, while the same ISO boots its BIOS entry first time and is provably
  sound), and Windows Setup's hardware gate relaxed with LabConfig keys.
- **Release-blocking defect fixed:** offline packaging had been impossible from a clean checkout
  since `4526244` - the dependency manifest was signed over CRLF bytes while `.gitattributes` stores
  `*.json` as LF. Fixed at the generator, pinned in `.gitattributes`. Runbook artifact hashes were
  also a week stale, which would have manufactured a false FAIL at section 2.
- **Files:** `scripts/clean-machine/*`, `scripts/generate-dependency-manifest.ps1`, `.gitattributes`,
  `CLEAN_MACHINE_VALIDATION_RUNBOOK.md`, `docs/testing/CLEAN_MACHINE_VALIDATION_RESULTS_2026-07-29.md`,
  `docs/testing/clean-machine-evidence/*`, `docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md`.
- **Tests run:** the runbook itself (20/0/3), `verify:clean-machine-policy` 28/28.
- **Result:** ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED; beads 119 / 5 outstanding / 114 closed.

---

## 2026-07-29 — Claude — packaged licensing gates: build + execute

- **Task:** build the packaged-walkthrough license path left outstanding on `awkit-1cc`, plus the
  packaged negative matrix and the packaged migration-grace scenario.
- **Built:** `scripts/helpers/packaged-license.mts` (issuer-key resolution, external mint,
  env sanitisation, store-envelope fixtures); licensing lifecycle wired into
  `verify-packaged-walkthrough.mts`; new `verify:packaged-licensing`.
- **Executed on a freshly packaged build:** walkthrough **86 PASS / 0 FAIL** with the issuer key and
  25 PASS / 0 FAIL / **1 BLOCKED** without; packaged licensing **33 PASS / 0 FAIL** with the key and
  24 PASS / 0 FAIL / **2 BLOCKED** without.
- **Defects found and fixed:** (1) offline packaging impossible from a clean checkout since
  `4526244` — manifest signed over CRLF bytes while `.gitattributes` stores `*.json` as LF;
  (2) the negative-matrix fixture builder hashed `JSON.stringify` while the store checksums
  `stableStringify`, which would have collapsed all five states into `CORRUPTED`.
- **Ordering bugs found by running it:** teardown before Parts I-J left later sessions unlicensed
  (9 cascading failures that looked like recovery bugs); teardown needs a fresh session ref after
  two restarts; the seeded grace fixture needs `allowOverwrite`.
- **Files:** `scripts/helpers/packaged-license.mts`, `scripts/verify-packaged-licensing.mts`,
  `scripts/verify-packaged-walkthrough.mts`, `scripts/generate-dependency-manifest.ps1`,
  `.gitattributes`, `resources/dependency-manifest.{json,sig}`, `package.json`,
  `scripts/lib/verifier-classification.ts`, `docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md`.
- **Tests NOT run:** the clean/offline Windows VM walkthrough (separate human gate, unchanged).
- **Result:** `awkit-1cc` closes. Ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED; beads
  119 total / 5 outstanding / 114 closed.

---

## 2026-07-29 — Claude — three owner decisions: licensing enforcement, Test Lab CLI-only, secret-store seam

- **Task:** implement the owner's decisions on `awkit-1cc`, `awkit-wza.8` and `awkit-8ri`/SET-013.
- **Licensing (`awkit-1cc`):** enforcement ON by default; `SPECTER_LICENSE_ENFORCE` removed as a
  production opt-in. Full run-gate decision table incl. active-run disposition; integrity states
  cancel not-yet-started work; evaluation faults now fail closed. One-time 14-day migration window for
  upgraded installs only. No bypass in packaged builds (`app.isPackaged`, not `isProductionOffline`).
- **Test Lab (`awkit-wza.8`):** CLI-only by architectural decision; Phase 7 closed as a decision.
  New `verify:test-lab-cli-only` guards the boundary.
- **Secret store (`awkit-8ri`/SET-013):** injectable `SecretStorageCapability` + a separate test
  composition root built to `out/test-main/` and excluded from packaging. No env override.
- **Defects found and fixed:** grace mirror was shared across profiles under `%PROGRAMDATA%`;
  `verify:random-lifecycle` had been 10/3 since RBAC v2 (`316eff3`) due to an under-stubbed fake
  `SecurityStore` hidden by an `as unknown as` cast.
- **Files:** `src/licensing/{RunGatePolicy,MigrationGrace}.ts`,
  `app/main/licensing/{licenseRuntime,migrationGraceStore}.ts`, `app/main/{main,preload,secretStore,
  secretStorageCapability}.ts`, `app/main/testing/unavailableSecretStorageRoot.ts`,
  `app/main/ipc/{execution,licensing,secrets}.ipc.ts`, `src/runner/ExecutionEngine.ts`,
  `src/testing/lifecycle/LifecycleCampaign.ts`, `app/renderer/pages/admin/LicensingPage.tsx`,
  `app/renderer/pages/admin/components/AdminUi.tsx`, `electron.vite.test-roots.config.ts`,
  `electron-builder.json`, `scripts/{verify-test-lab-cli-only,verify-secret-storage-seam}.mts`,
  `scripts/lib/{test-lab-packaging-policy,verifier-classification}.ts`,
  `scripts/{verify-licensing.mts,verify-e2e-licensing-gui.mjs,write-test-root-manifest.mjs}`,
  `scripts/lib/gui-verify-harness.mjs`, `docs/LICENSING.md`, `docs/ai/DECISIONS.md`,
  `specs/e2e/E2E-LIC.md`, validation ledger.
- **Tests run:** verify:licensing 147/147 · verify:e2e-licensing 38/38 · verify:secret-storage-seam
  30/30 · verify:test-lab-cli-only 24/24 · verify:runner 89/89 · verify:reports-live-engine 21/21 ·
  verify:random-lifecycle 13/13 · verify:authz 77/77 · verify:secrets 16/16 · verify:ipc-contract 4/4 ·
  verify:verifier-classification reconciled 152 · build + typecheck:scripts PASS.
- **Tests NOT run:** `verify:packaged-walkthrough` — it runs four real workflows in a packaged build
  where the bypass is inert by design, and the issuer-minted-license path the owner specified is not
  yet built; it would fail. Also not built: the packaged negative-case suite and the packaged
  upgrade-grace scenario. `verify:settings-runner-behaviour` not re-run (known flaky, unrelated).
- **Result:** ledger 62 PASS / 3 NOT RUN / 1 BLOCKED; beads 119 total / 6 outstanding / 113 closed.
  Packaged licensing validation is the outstanding follow-up on `awkit-1cc`.

## 2026-07-29 — Codex — global license attention and background revalidation

- **Task:** close `awkit-x13`.
- **Implemented:** permission-aware status-bar polling; attention-only mapping for every non-healthy
  license state; 15-minute and focus/visibility revalidation; keyboard-accessible navigation to
  Licensing; and isolated fixture seeding for the real Electron verifier.
- **Files:** `src/licensing/LicenseAttention.ts`, shell/status bar and token CSS, licensing
  verifiers/fixture seeder, tracker/dashboard pins, licensing guide, and AI memory docs.
- **Checks:** licensing **62/62**; real Electron licensing **23/23** across enforcement modes; build
  and script typecheck PASS; verifier leaves tracked fixtures unchanged.
- **Result:** closed. Healthy licenses add no shell noise; action-needed states are globally visible
  only to principals who can view licensing.

## 2026-07-29 — Codex — signed machine-licensing tracker reconciliation

- **Task:** reconcile open `awkit-s05` against the current repository.
- **Finding:** the full Ed25519 per-machine licensing scope was already implemented and documented:
  fingerprinting, issuer/client key separation, import/replace/revoke, tamper/clock detection,
  trusted RBAC/reauth/audit, UI, and run gating.
- **Checks:** licensing **56/56**; real Electron e2e licensing **22/22**.
- **Result:** closed the stale tracker item without duplicating production code. Hard-enforcement
  rollout and the app-wide status surface remain separate open issues.

## 2026-07-29 — Codex — Randomized Test Lab Phase 8: lifecycle campaigns

- **Task:** complete `awkit-wza.9` with combinatorial auth/RBAC/licensing coverage that reuses
  production enforcement points.
- **Implemented:** a deterministic 176-cell auth-state × grant/deny × license-status × enforcement
  matrix with seeded role/permission assignments; production `AuthorizationService` evaluation;
  a framework-agnostic license run-gate policy shared with Electron; and invariant reporting for
  any expected/actual divergence.
- **Files:** `src/testing/lifecycle/LifecycleCampaign.ts`, `src/licensing/RunGatePolicy.ts`,
  `app/main/licensing/licenseRuntime.ts`, `scripts/verify-random-lifecycle.mts`, package/verifier
  registry, tracker/dashboard pins, randomized-test plan, and AI memory docs.
- **Checks:** lifecycle **13/13** across 176 scenarios; auth **49/49**; authz **59/59**; licensing
  **56/56**; session context **11/11**; script typecheck PASS; classification **150/150**.
- **Result:** Phase 8 is closed without adding duplicate auth/licensing assertions or changing
  production licensing behavior.

## 2026-07-29 — Codex — Randomized Test Lab Phase 6: campaign reporting

- **Task:** complete `awkit-wza.7` with truthful campaign JSON/Markdown reporting.
- **Implemented:** live results now retain chronological raw capacity snapshots.
  `CampaignReportWriter` accepts raw runs, coverage, and failure metadata; computes nearest-rank
  duration percentiles and resource peaks once; groups coverage with blocked reasons; aggregates
  outcomes/failure identities/reproduction commands; and writes schema-versioned unique JSON and
  Markdown bundles. Secret canaries abort before persistence.
- **Files:** `src/testing/reporting/CampaignReportWriter.ts`,
  `scripts/verify-random-reporting.mts`, Phase 5 raw sampling, package/verifier registry,
  tracker/dashboard pins, randomized-test plan, and AI memory docs.
- **Checks:** random reporting **13/13**, including fail-closed missing failure metadata; script
  typecheck PASS.
- **Result:** Phase 6 is closed and Phase 7 is dependency-ready. The report API cannot accept
  pre-aggregated durations or resource peaks, preventing the documented aggregate-of-aggregates
  error by construction.

## 2026-07-29 — Codex — Randomized Test Lab Phase 5: real ExecutionEngine campaigns

- **Task:** complete `awkit-wza.6`: generated definitions through the real execution engine and
  local Mock Site, with capacity-derived concurrency, bounded completion polling, and decidable
  runtime invariants.
- **Implemented:** `RandomTestRunner` intersects requested concurrency with `planCapacity()` and a
  live engine snapshot, starts real execution, polls execution-scoped instances, waits for report
  and browser-resource settlement, and reports `labTimeout` outside the product status union.
  `RuntimeInvariantChecker` checks terminal/exclusive state, dependency order, waitAll coverage,
  loop bounds, cancelled settlement, baseline resource release, unique persisted records, report
  totals, and secret canaries.
- **Live proof:** generated linear and forced `isolatedPage`/`waitAll` topologies ran through the
  production branch factory in bundled Chromium against the existing local Mock Site. A
  never-terminal engine double proved timeout cancellation and capacity clamping.
- **Files:** `src/testing/runtime/*`, `scripts/verify-random-live.mts`, package/verifier registry,
  randomized-test plan, tracker/dashboard pins, and AI memory docs.
- **Checks:** random live **14/14** (including unauthorized-target refusal, upload materialization,
  and original immutability); Runner **89/89**; Mock Site **99/99**; script typecheck PASS;
  verifier classification **148/148**.
- **Result:** Phase 5 is closed; Phases 6 and 8 are dependency-ready. No Mock Site page was added
  because the registered safe fixture pool already covers the generated live topologies.

## 2026-07-29 — Codex — Randomized Test Lab Phase 4: failure artifacts, shrinking, CLI

- **Task:** complete `awkit-wza.5`, the dependency-ready Phase 4 boundary for durable randomized
  failure evidence, exact reproduction, category-preserving minimization, and npm CLI entry points.
- **Implemented:** `FailureArtifactWriter` writes unique exclusive bundles with immutable originals,
  constraints, coverage, non-identifying machine capacity, generator/schema identity, and a quoted
  reproduce command. It rejects resolved secrets and sensitive URL query parameters before writing.
  `FailureReproducer` deep-clones definitions and requires category/signature equality.
  `Shrinker` accepts only strictly smaller candidates in the prescribed flows → branches → nodes →
  concurrency → loop-bounds order. `random-test-lab.mts` provides campaign, smoke, and reproduce
  modes with both `--key value` and `--key=value` parsing.
- **Files:** `src/testing/failures/*`, `scripts/{random-test-lab,verify-random-failures}.mts`,
  `package.json`, verifier classification, randomized-test plan, and AI memory/status docs.
- **Checks:** `verify:random-failures` **17/17**; smoke **2 workflows / 4 flows**; full campaign
  **25 workflows / 59 flows**; generator **49/49**; oracle **27/27**; round-trip **26/26**;
  `typecheck:scripts` PASS; verifier classification **147/147**.
- **Result:** Phase 4 is complete; `awkit-wza.6` is unblocked. No browser/runtime behavior or
  packaging input changed, so live runner and offline-package gates were not required for this
  focused phase.

## 2026-07-28 (latest) - `awkit-4km` stream and CDP diagnostics closure (Codex)

**Task:** close the remaining WebSocket/SSE lifecycle and advanced-network-diagnostics slice after
the previously implemented `202` polling condition.

**Result:** added one canonical non-gating `streamActivity` wait shared by profiles, the runner,
review logic, and the Flow Designer. The observer arms before the action, records WebSocket/SSE
lifecycle evidence, uses Chromium CDP for request IDs/timing/redirect chains when available, and
falls back to Playwright events. Required UI outcomes remain the only completion proof. Diagnostic
records are bounded and strip query/hash; no headers, bodies, or frame payloads are retained.
Extended the offline mock site with a finite SSE scenario and verified persisted GUI configuration.

**Evidence:** waits 72/72; Flow Designer 60/60 real Electron; mapping 103/103; async review 23/23;
mock site 99/99; script typecheck PASS. Coverage includes absent-stream success with valid UI,
stream-present failure with missing UI, WebSocket and SSE lifecycle, CDP capability fallback,
request IDs/timing/redirects, and secret canaries absent from every summary/log.

## 2026-07-28 (latest) - `awkit-y24` grouped completion GUI closure (Codex)

**Task:** close the remaining GUI 11.3 evidence gap for `API success AND (rows OR empty state)`.

**Result:** the real Flow Designer configured and persisted the nested `anyOf` shape through the
preload/profile store. The runner's empty-group behavior was corrected from vacuous success to a
fail-closed diagnostic, preventing removal of all branches from recreating the original defect.

**Evidence:** Flow Designer 58/58 real Electron with screenshot; waits 58/0; mapping 102/0;
async-review 21/0; runner 89/0; mock site 96/96; combined typecheck PASS.

## 2026-07-28 (latest) - `awkit-epz` pinned offline supply chain (Codex)

**Task:** close the P1 defect where a clean checkout could silently package without Chromium and
browser acquisition floated to whichever Playwright cache happened to exist.

**Result:** pinned Playwright `1.61.0` and Chrome for Testing `149.0.7827.55` / revision `1228`;
added archive/executable/tree hashes, deterministic staging, Ed25519-signed manifest and production
startup verification, artifact provenance, redistribution notices, fail-fast packaging, a semantic
artifact comparator, and deterministic Oracle JAR generation. The redundant vendor browser mirror
is verified before packaging but excluded from the shipped payload.

**Evidence:** `verify:offline-supply-chain` 22/0; strict offline validation PASS; primary and fresh
clone portable packages PASS from the exact offline archive; 571 decompressed entries equivalent
with 0 differences; tampered archive rejected before extraction; Oracle JAR hash identical across
two builds; combined typecheck PASS. Portable size measured at 212,699,971 bytes. Clean-machine GUI
execution remains NOT EXECUTED / owner-waived non-blocking.

**Commits:** `def092c`, `ff75ee5`, `09a6044`, plus the reconciliation commit containing this entry.

## 2026-07-28 (latest) - `awkit-thg` semantic incremental indexing (Claude)

**Task:** make search results fresh without a manual rebuild — the last gap in the Zvec subsystem.

**Result:** each run is indexed as it finishes, behind a new `semantic.autoIndex` setting (default
ON, separate from `semantic.enabled`).

Four decisions worth knowing:

1. **`ExecutionEngine` got its first observer**, injected like `setSecretResolver` so `src/` still
   never imports Electron. Fires after `upsertRun` in the `finally`, for every terminal state
   including cancellation.
2. **The §14.3 guard lives in `src/runner/RunCompletionObserver.ts`, not the engine.**
   `ExecutionEngine.ts` transitively imports Electron, so a `tsx` verifier cannot load it — and "an
   indexing fault must never propagate into workflow execution" cannot rest on a comment. The guard
   is a pure function a verifier drives; a source scan asserts the engine calls through it.
3. **Locators piggyback on run completion.** A `LocatorRecoveryRecord` has no run id, so filtering by
   `updatedAt` was the alternative — and it misattributes records whenever two runs overlap.
   `LocatorFactory.writeMemory` reports each key it successfully stores; the engine accumulates per
   instance in a `Set`, which dedups within the run for free and adds no emitter to the hot path.
4. **No migration code for the new setting** — `hydrate` spreads defaults before stored settings, so
   an older settings file reads `true`. Two checks pin the default and the merge order.

**Files:** new `src/runner/RunCompletionObserver.ts`; changed `ExecutionEngine.ts`,
`LocatorFactory.ts`, `PlaywrightRunner.ts`, `SemanticMutationQueue.ts`, `SemanticIndexRuntime.ts`,
`SemanticApi.ts`, `uiSettings.ts`, `semanticService.ts`, `semanticSnapshot.ts`, `execution.ipc.ts`,
`SemanticIndexSettings.tsx`, `verify-semantic-store.mts`, `verify-semantic-queue.mts`,
`verify-semantic-ui-gui.mjs`, `verify-roadmap-dashboard.mjs`, `.beads/`, `docs/ai/`.

**Verification:** semantic-store **261/0** (was 231) · semantic-queue **80/0** (was 70) ·
semantic-ui-gui **19/19 real Electron** (was 14) · runner 89/0 · settings-e2e 151/0 · authz 59/0 ·
recorder 110/0 · semantic-policy 141/0 · semantic-rebuild 64/0 · ipc-contract 4/4 with pins unmoved
at 213/191 · source-hygiene 9/0 · classification reconciled · `verify:all-typecheck` PASS · roadmap
135/135 (bead pin 21/97 → 20/98). **Five mutations red before revert:** the observer throw escaping,
the engine bypassing the guard, the hydrate merge order reversed, the `autoIndex` gate ignored, and
the last error never cleared. **Not run:** packaging/offline gates — no packaging surface touched.

**Two things the checks caught that review would not:** my source scan for "the engine never calls
the observer directly" missed the `?.()` form — the way anyone would actually write the bypass — and
was only found by mutating the engine and watching the check stay green. And a `let seen: T | null`
assigned inside a callback narrows to `never` in TypeScript, which `tsx` runs happily and
`typecheck:scripts` rejects.

## 2026-07-28 - `awkit-0jp` semantic UI: search page + Settings index panel (Claude)

**Task:** give the semantic subsystem a product surface. It had permissions, nine IPC channels and
real data, and nothing in the app used any of it.

**Result:** a **Semantic Search** page (Build nav group, gated on `SEMANTIC_SEARCH`) with all three
query kinds on one results surface, and a **Settings → Semantic Index** panel with health, enable /
default-topK, Rebuild and Clear.

Three things worth knowing:

1. **A contract gap blocked the admin half.** Re-auth-gated channels *threw*, so the renderer could
   only distinguish "re-authenticate" from "denied" by parsing a rejected `invoke` message — which
   the contract forbids. Added `REAUTH_REQUIRED` / `NOT_AUTHORIZED` and `authorizeSemanticAction`
   (pure, injected `assert`). It catches **only** `SecurityError`; anything else rethrows.
   `branding.ipc.ts` maps every error to a reason — that part was deliberately not copied.
2. **`SemanticKinds.ts` is new.** `SemanticDocument.ts` imports `node:crypto`, so any *value* import
   of it pulls `createHash` into the renderer bundle; the first renderer import of a semantic bound
   failed the build. Kinds, the kind guard and topK bounds moved to a pure module that
   `SemanticDocument.ts` re-exports, so no existing importer changed.
3. **Two defects were found by looking at a screenshot, not by an assertion** — the kind filter
   rendered two identical "Locator" checkboxes, and the enable toggle rendered oversized because it
   lacked the app's `inline-check` class. Both fixed; a label-uniqueness check now pins the first.

**Files:** new `app/renderer/pages/{SemanticSearch,SemanticIndexSettings}.tsx`,
`app/renderer/semantic/{useSemanticQuery,useSensitiveSemanticAction,SemanticResultList,semanticMessages}`,
`src/semantic/contracts/SemanticKinds.ts`, `scripts/verify-semantic-ui-gui.mjs`; changed
`SemanticApi.ts`, `SemanticDocument.ts`, `semantic.ipc.ts`, `routes.tsx`, `routePermissions.ts`,
`LeftNavigation.tsx`, `Settings.tsx`, `global.css`, `verify-semantic-store.mts`, `verify-authz.mts`,
`verifier-classification.ts`, `package.json`, `.beads/`, `docs/ai/`.

**Verification:** `verify:semantic-ui-gui` **14/14 real Electron** (new; registered in
`verifier-classification.ts`) · `verify:semantic-store` **231/0** (was 215) · `verify:authz` **59/0**
(was 53) · `verify:settings-e2e` 151/0 · runner 89/0 · recorder 110/0 · semantic-policy 141/0 ·
semantic-rebuild 64/0 · rebuild-live 24/0 · native-contract 22/0 · queue 70/0 · security 39/0 ·
`verify:ipc-contract` 4/4 with pins unmoved at 213/191 · source-hygiene 9/0 · classification
reconciled · `verify:all-typecheck` PASS · roadmap 135/135 (bead pin moved 22/96 → 21/97).
**Four mutations went red before revert:** swallowing an unexpected error, ignoring the retry cap,
removing the route gate, duplicating a kind label.
**Not run:** packaging and offline gates — no packaging surface touched. Dark mode not exercised.

**Caught mid-task:** a JSX comment placed inside a ternary branch broke the build, and the GUI
verifier still reported 14/14 — because it ran against the previous bundle. Rebuild before believing
a GUI result.

## 2026-07-28 - handoff refreshed for the next agent (Claude)

**Task:** `/HANDOFF` — bring the takeoff note, current state and known issues in line with `main` @
`190565a` so the next agent or human can start without re-deriving the day.

**Result:** rewrote the TAKEOFF section of `HANDOFF.md` — repository state, a five-row commit table
(three feature, two reconciliation), verification measured at `190565a`, and two traps promoted into
it: the control-character escape hazard now extends to Markdown and is guarded, and `npm run build`
does not typecheck `scripts/` (the combined gate `npm run verify:all-typecheck` already existed and
is now named where it is needed). Added a new top section to `CURRENT_STATE.md` covering the
verification-surface change, **with the ledger tally in it** — omitting it is the exact defect
`9d87715` had to repair. Added the dashboard instruction that matters most: open the page, do not
only gate on it; its Parse warnings panel reports source irregularities no assertion pins.

**Files:** `docs/ai/HANDOFF.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`,
`docs/ai/TASK_LOG.md`.

**Verification:** `verify:roadmap-dashboard` 135/135 with the banner re-measured from
`buildSnapshot()` after both narrative edits — `agrees: true`, `checked: 2`, both heads at 61/4/1;
`verify:source-hygiene` 9/0 (the new Markdown scan covers every file edited here);
`node scripts/ai-memory/check-memory.mjs` PASS. **Not run:** `npm run build` and every runner,
packaging and offline gate — documentation only, no code, script or asset changed.

**Remaining work is unchanged:** `awkit-0jp` (semantic renderer surface) then `awkit-thg`
(incremental indexing). No blockers.

## 2026-07-28 - running the dashboard found two defects the verifiers could not (Claude)

**Task:** actually start `npm run roadmap` and read the rendered page, rather than trusting
`verify:roadmap-dashboard`. Two real defects surfaced immediately, both invisible to every gate.

**Result:**

1. **A literal NUL byte had been sitting in this file** (`docs/ai/TASK_LOG.md`), inside prose about
   `entityKey = sha256(kind U+0000 NFC(entityId))` — the escape-expansion trap, committed by an
   earlier session. Nothing caught it: `verify:source-hygiene` scanned only `src`/`app`/`scripts`
   and only `.ts`/`.mts`/`.tsx`, `grep` reported the file as "binary" instead of matching, and the
   dashboard's reader strips NULs and merely warns. Only the rendered page showed it. Replaced with
   the readable token, and **extended `verify:source-hygiene` to scan `docs/**/*.md`** (7 → 9
   checks, mutation-tested: a probe file with a NUL turned it red, 8/1).
2. **`npm run typecheck:scripts` was RED on `main`**, from today's `ea90491`. `npm run build`
   typechecks the app project only, so the whole day reported "build PASS" truthfully while a
   verifier script did not compile — `tsx` strips types without checking them, so the suite ran
   215/0 regardless. Fixed the cast in `verify-semantic-store.mts` by widening through `unknown`
   (runtime behaviour and every assertion unchanged).

Also removed a stale hardcoded offset in `parse-task-log.mjs`: its warning named "offset 62127",
which every append to this file silently invalidated — the NUL was actually at 102796, ~40KB away.
It now reports the count only.

**Files:** `docs/ai/TASK_LOG.md`, `docs/ai/KNOWN_ISSUES.md`, `scripts/verify-source-hygiene.mts`,
`scripts/verify-semantic-store.mts`, `tools/roadmap/lib/parse-task-log.mjs`.

**Verification:** `typecheck:scripts` PASS (was failing); `verify:source-hygiene` **9/0** (was 7/0),
mutation-tested; `verify:semantic-store` 215/0 unchanged; `verify:verifier-classification`
reconciled (no new script — an existing one was extended); `verify:roadmap-dashboard` 135/135; live
dashboard read at `127.0.0.1:4380` — banner "Sources agree" over 2 sources, parse warnings **7 → 6**.
**Not run:** `npm run build` — no app-project file changed; packaging/offline gates — untouched.

**Lesson:** the three checks that should have caught the NUL all passed, and the page did not. A
derived view is worth *opening*, not just verifying.

## 2026-07-28 - dashboard reconciliation: the TAKEOFF section had silently broken the consistency banner (Claude)

**Task:** review the day's session and commits, and confirm every Program Status dashboard source
reflects them. Docs only — no code changed.

**Result:** found one real drift and closed it. The previous session's `HANDOFF.md` TAKEOFF section
was written as a new top heading with no ledger tally, and the session ended before the check ran.
`parse-narrative.mjs` scopes to the newest `##` heading only, so the banner silently dropped from two
sources to one — `verify:roadmap-dashboard` was **132/134** at the start of this task, failing "both
narrative documents assert a tally" and "the consistency banner checked something". Added the tally
plus bead/phase counts to that section, and a note in it saying why the numbers must stay there.
Also recorded two things from the day that no source carried: the literal-control-character editing
trap (hit twice in one session) and the newest-section tally rule, both under *Repeated problems
pattern*; and the `ADMINISTRATOR_PERMISSIONS` denylist as a risky assumption.

Audited the other sources and found them already current: every commit today updated
`.beads/issues.jsonl`, `CURRENT_STATE.md` and `TASK_LOG.md`; `bd stats` (118/22/96) matches the
export; `ImplementationRoadmap.ts` has Phase E `complete`; `verify:verifier-classification` is
reconciled (144 across seven classes); `assignments.json` is empty with no stale claims. `DEFECTS.md`
and `TRACEABILITY_MATRIX.csv` were correctly untouched — nothing today was detected by a validation
case, and no requirement's coverage status changed.

**Files:** `docs/ai/HANDOFF.md`, `docs/ai/KNOWN_ISSUES.md`, `docs/ai/TASK_LOG.md`.

**Verification:** `verify:roadmap-dashboard` **135/135** (from 132/134); banner measured directly
from `buildSnapshot()` as `agrees: true | checked: 2 | staleClaims: 0`, both heads at 61/4/1;
`verify:source-hygiene` 7/0; both edited files byte-scanned for control characters (0).
**Not run:** build and the runner/packaging/offline gates — no code, script or asset changed.

**Observation, not fixed:** `TRACEABILITY_MATRIX.csv` cites `verify:recorder 97/97` on three rows
(last touched 2026-07-26); the suite now scores 110/0. Left alone deliberately — that column records
point-in-time evidence per row, and rewriting the number would misstate when it was measured.

## 2026-07-28 - `awkit-9xh` run + locator projections; similarFailures / suggestLocators (Claude)

**Task:** give the index run and locator documents so the last two plan §11 channels can work.

**Result:** `LocatorRecoveryStore.list()` added (bounded, tolerant of unparseable records);
`semanticSnapshot.ts` now projects run-summary, run-failure and locator-success alongside flows and
workflows; `semantic:similarFailures` and `semantic:suggestLocators` implemented and exposed. Run
documents are built from `RunHistoryRow` rather than `DurableRunRecord` because the row has no raw
error string and no URL — nothing to leak. Locator documents carry the winning strategy only, never
the selector or the matched element's name. Owner decision: no incremental indexing events this
round (`awkit-thg`); freshness comes from rebuild, which avoids touching the runner hot path.

**Files:** `src/runner/LocatorRecoveryStore.ts`, `app/main/semantic/semanticSnapshot.ts`,
`app/main/semantic/semanticService.ts`, `src/semantic/contracts/SemanticApi.ts`,
`app/main/ipc/semantic.ipc.ts`, `app/main/preload.ts`, `scripts/verify-semantic-store.mts`,
`scripts/verify-roadmap-dashboard.mjs`, `.beads/`, `docs/ai/`.

**Verification:** build PASS; semantic-store **215/0** (was 199); authz 53/0; semantic-rebuild 64/0;
real-host semantic-rebuild-live 24/0; ipc-contract 4/4 (213 handlers, 191 exposed); recorder 110/0;
runner 89/0; source-hygiene 7/0; roadmap 135/135. Two mutations red before revert (indexing the full
locator signature leaked the selector and the accessible name; treating non-success as failure
indexed cancelled runs). **Not run:** packaging/offline gates — neither surface touched.

**Gotcha:** writing the NUL `scopeKey` separator as a string escape made an editing tool emit a
literal NUL byte into the source, which `verify:source-hygiene` forbids. Use
`String.fromCharCode(0)` — no tool can re-expand that into a control character.

## 2026-07-28 - `awkit-c7j` semantic product surface: RBAC + service + IPC/preload (Claude)

**Task:** begin the semantic product surface — permissions, an authorized main-process service, and
the IPC/preload contract.

**Result:** five semantic permissions added per plan §10, with two owner decisions recorded rather
than assumed (both management permissions are re-auth-gated; Viewer is denied search). New pure
`SemanticApi.ts` sanitizes every renderer payload — bounded strings, clamped `topK`, structured
fields only, unknown properties dropped so no filter expression or path can be smuggled through.
Seven channels registered and exposed on `window.playwrightFlowStudio.semantic`, plus a `semantic`
group in `ui-settings.json` that gives `semanticHealth({ enabledBySetting })` a real value for the
first time. `cancelRebuild` deliberately returns `NOT_SUPPORTED`: the orchestrator has no
cancellation token and the pointer swap is irreversible, so "cancelled" would be an untrue claim.

**Files:** `src/security/authz/Permissions.ts`, `src/semantic/contracts/SemanticApi.ts` (new),
`app/main/ipc/semantic.ipc.ts` (new), `app/main/ipc/index.ts`, `app/main/preload.ts`,
`app/main/uiSettings.ts`, `app/main/semantic/semanticService.ts`, `scripts/verify-authz.mts`,
`scripts/verify-semantic-store.mts`, `scripts/verify-roadmap-dashboard.mjs`, `.beads/`, `docs/ai/`.

**Verification:** build PASS; authz **53/0** (was 40); semantic-store **199/0** (was 179);
ipc-contract 4/4; settings-e2e **151/0** (real Electron); settings-persistence 3/3; security 39/0;
semantic-policy 141/0; roadmap dashboard 135/135. Two mutations red before revert (raw-input
forwarding leaked `filter`/`collectionPath`/`generationPath`; Viewer granted search). **Not run:**
packaging/offline gates — no packaging or offline surface touched. **Not built:** similarFailures /
suggestLocators (`awkit-9xh`) and renderer UI (`awkit-0jp`).

**Gotcha:** a `bd create` whose shell pipe errored had already written the issue, so retrying created
a duplicate (`awkit-5ir`, closed as such). Check `bd list` before re-running a create that "failed".

## 2026-07-28 - `awkit-ttd` semantic index runtime bound to production (Claude)

**Task:** reconcile the last Phase 1B bead — rebuild orchestration and generation activation — and
close it only if the current state proves it.

**Result:** two of its three outstanding items were already stale (orchestrator bound to the real
generation root; `whenIdle()` had a production shutdown caller). The unnamed third was real:
`SemanticIndexRuntime` was never constructed or registered in the main process, so `semanticHealth()`
reported healthy unconditionally, every shutdown recorded as clean, and `rebuild()` had no production
entry point. Added `app/main/semantic/semanticSnapshot.ts` (authoritative flow + workflow snapshot
over `projectAndValidate`, sources injected and resolved per rebuild, unreadable store throws rather
than yielding a partial snapshot), registered the runtime in `getSemanticHostManager()` with the host
manager as transport, and had `initializeSemanticSubsystem()` reach that registrar after
reconciliation. Constructors stay inert, so startup still spawns no host. `awkit-ttd` is closed.

**Files:** `app/main/semantic/semanticSnapshot.ts` (new), `app/main/semantic/semanticService.ts`,
`scripts/verify-semantic-store.mts`, `scripts/verify-roadmap-dashboard.mjs`, `.beads/`, `docs/ai/`.

**Verification:** semantic store **179/179** (was 153); semantic rebuild **64/64**; semantic queue
**70/70**; real-host rebuild **24/24** with 68 assertions; verifier classification reconciled;
roadmap dashboard **135/135**; build PASS. Four mutations all went red before revert. The
registration guard failed its own first mutation — `setSemanticIndexRuntime(null)` in the degrade
path satisfied a call-site count — and was rewritten to assert the constructed runtime is the one
registered. **Not run:** packaging and offline gates (no packaging or offline surface touched), and
no real-Electron end-to-end run of the registration. Dashboard counts move to
**113 total / 20 outstanding / 93 closed**.

**Gotcha:** `bd close` does not refresh `.beads/issues.jsonl`, which is what
`verify:roadmap-dashboard` parses. The gate failed at 134/135 with stale counts until
`bd export -o .beads/issues.jsonl` was run.

## 2026-07-28 (latest) - `awkit-hzf` ambiguous Zvec writes reconcile by rebuild (Codex)

**Task:** define and prove the policy for a mutation whose real utility-host request times out and
may already have applied.

**Result:** timeout and host-exit write failures map to `AMBIGUOUS_MUTATION`; the queue sends them
once, abandons them, and sets `rebuildRequired`. It never blind-replays and never infers the outcome
from a late reply. The real-host harness drives a 1,500-document write past a zero deadline and also
pins the host-exit path. `awkit-hzf` is closed.

**Verification:** semantic store **153/153**; real rebuild **24/24** with 68 assertions; semantic
queue **70/70**; build and script typecheck PASS. The pre-fix and explicit disabled-mapping mutation
both produced **152/153** with three write attempts; reverted. Dashboard counts move to
**113 total / 21 outstanding / 92 closed**.

## 2026-07-28 (latest) - `awkit-9yv` real Zvec contract closed on every required layout (Codex)

**Task:** reconcile the open real-host contract bead and prove the shared store contract plus
generation lifecycle on staged, packaged, and NSIS-installed host trees.

**Result:** the existing installed matrix covered manager lifecycle and rebuild but omitted the
shared store contract. It now runs `verify:semantic-zvec-native-contract` explicitly and the
verifier guards that entry exactly once. Staged, packaged, and a fresh unelevated per-user install
all exercised the raw binding; the NSIS run then uninstalled with no host, registry, or directory
residue. `awkit-9yv` is closed.

**Verification:** staged/package native contract **22/22** with shared contract **68/68**; real
rebuild **23/23** with 62 assertions; installed native contract **21/21**, manager **35/35**, and
rebuild **23/23**. Mutation: deleting the installed-contract entry produced **21/22**, then was
reverted. `typecheck:scripts` exposed and repaired an existing `.mts` generic-arrow parse error;
`verify:workflow-sentinels` remains **12/12**. Dashboard counts move to
**113 total / 22 outstanding / 91 closed**.

## 2026-07-28 (latest) - `awkit-4a6` passive CDP trace and Instance Monitor live view (Codex)

**Task:** add a second observation-only CDP client, durable local run trace, and live browser view
without changing runner actions or weakening offline behavior.

**Result:** each browser generation can emit a capped, secret-sanitized raw NDJSON firehose,
bounded two-second screenshots, optional DOM samples, 17 predictable session buckets, and
top-navigation-bisected per-page slices. The idempotent finalizer writes `summary.json` as the
entry point. Instance Monitor exposes a permission-gated, keyboard-contained read-only modal from
the same attach, and every attach/sample/finalize failure remains fail-open. `awkit-4a6` is closed.

**Verification:** `verify:instance-monitor` **55/55**, `verify:artifacts` **23/23**,
`verify:instance-monitor-gui` **18/18**, `verify:runner` **89/89**, and build PASS. Mutation:
allowlisting `Input.dispatchMouseEvent` produced **54/55**, then was reverted. Dashboard counts
move to **113 total / 23 outstanding / 90 closed**.

## 2026-07-28 (latest) - `awkit-v4r` persisted locator winner and bounded recovery (Codex)

**Task:** stop paying for a permanently dead primary locator and recover safely when every recorded
candidate misses, without network services, utility-class matching, or silent guessing.

**Result:** the runtime-data store records one hashed JSON file per scenario/flow/step with the last
winning candidate and a class-free structural fingerprint whose business text and attribute values
are token-hashed before persistence. Later runs prefer that winner. Only
after all candidates miss and a bounded recheck, the resolver scans at most 200 visible elements,
requires a high score plus unique margin, logs the recovery and tells the user to re-record.
No-history, valid-candidate, and equal-twin paths preserve existing behavior. `awkit-v4r` is closed.

**Verification:** `verify:recorder` **110/110** and `verify:runner` **89/89**. Mutation: threshold
`0.86 → 1.01` produced **107/110** with all three recovery sentinels red; reverted. Dashboard counts
move to **113 total / 24 outstanding / 89 closed**.

## 2026-07-28 (latest) - `awkit-60w` numeric record-to-replay fidelity gate (Codex)

**Task:** turn Recorder replayability into a measured percentage over real interactions, not a
hardcoded score or URL-open smoke test.

**Result:** the REC-018 real-Electron journey records six business actions once, then replays the
persisted flow through the production engine against baseline, primary-locator-loss, and structural
DOM-drift fixtures. Score = business step IDs that agree as succeeded in both JSONL and the report /
recorded business step IDs. It prints and persists per-scenario plus aggregate metrics and enforces
**95% aggregate / 80% each**, chosen from the measured 100% first baseline.

**Verification:** `verify:recorder-e2e` **61/61**, scenarios **6/6 + 6/6 + 6/6 = 18/18 (100%)**;
`verify:mock-site` **96/96**. Mutation: removing the final stable accessible name from one drifted
email field produced structural **2/6**, aggregate **14/18 = 77.78%**, and **7 focused failures**;
reverted. Dashboard counts move to **113 total / 25 outstanding / 88 closed**.

## 2026-07-28 (latest) - `awkit-c0c` manifest and browser-payload timestamps separated (Codex)

**Task:** remove the dependency manifest's misleading single `application.builtAt` date without
inventing provenance for an already-staged browser.

**Result:** schema v2 now uses top-level `manifestGeneratedAt`; Chromium records source,
requested/installed Playwright versions, source timestamp plus basis, and a deterministic
`sha256-tree-v1` digest (308 files / 435,574,347 bytes; runtime `debug.log` explicitly excluded).
Legacy acquisition is marked unavailable, while future staging writes an acquisition sidecar.
Validators, the TypeScript reader, template, runbook, and packaging docs use the split semantics.
`awkit-c0c` is closed.

**Verification:** `npm run build` PASS; normal and strict offline validation PASS; a one-character
digest mutation made strict validation FAIL and was reverted. Dashboard counts move to
**113 total / 26 outstanding / 87 closed**.

## 2026-07-28 (latest) - `awkit-epz` fail-loud packaging half implemented; owner half remains open (Codex)

**Task:** begin dashboard backlog Tranche 2 without crossing the owner-only Chromium vendoring and
reproducibility decision.

**Result:** portable and NSIS wrappers now invoke the existing offline validator in a focused
packaging-input mode before `npm run build`. It refuses a missing or zero-byte bundled Chromium and
names the exact `resources/browsers/chromium/chrome.exe` path. `awkit-epz` remains open for its
owner-policy acceptance criteria.

**Verification:** current-input preflight PASS; missing-file mutation FAIL as expected; empty-file
mutation FAIL as expected; `npm run validate:offline` PASS; strict offline validation PASS.
Dashboard counts remain **113 total / 27 outstanding / 86 closed**.

## 2026-07-28 (latest) - `awkit-ebh` deterministic popup identity reconciled; Tranche 1 complete (Codex)

**Task:** close the fourth and final dashboard backlog Tranche 1 P1 bead by pinning one owner for
popup registration and preserving recorded plus deterministic synthetic aliases.

**Result:** the product implementation and required reversed-order/script-timer Test Lab fixtures
were already shipped in `a948cde`, `a9dedd8`, and `b6cd333`. The identity verifier now also scans
the production expected-popup paths: click and `switchToPopup` must each claim the page observed by
the context owner and may not independently register or observe it.

**Verification:** build PASS; `verify:popup-identity` **44/44**, `verify:popup` **12/12**,
`verify:popup-mock-site` **11/11**, `verify:mock-site` **94/94**, `verify:recorder` **97/97**, and
`verify:runner` **89/89**. Mutation proof: replacing the click claim with another observation
produced **43/44**, then was reverted. Dashboard source counts move to **113 total / 27 outstanding
/ 86 closed**. Packaging/offline gates were not run because no packaging surface changed.

## 2026-07-28 (latest) - `awkit-oyc` per-attempt failure evidence reconciled and pinned (Codex)

**Task:** close the third dashboard backlog Tranche 1 P1 bead by proving evidence is captured inside
each failed attempt before retry policy can trigger recovery.

**Result:** the FR-B2 product fix was already shipped in `269cd70` and hardened by `b4d2974`. The
focused verifier now records the production failure timeline and requires every `capture:n` to
precede `decide:n`, alongside its existing accumulation, error-precedence, opt-out, and
`screenshotPath` contracts.

**Verification:** `npm run verify:failure-evidence` **35/35** and
`npm run verify:failure-evidence-live` **17/17**. Mutation proof: moving `RetryPolicy.decide` ahead
of capture produced **34/35** with the exact inverted timeline, then was reverted. Dashboard source
counts move to **113 total / 28 outstanding / 85 closed**. Packaging/offline gates were not run
because no packaging surface changed.

## 2026-07-28 (latest) - `awkit-7lj` flow-library reads fail closed before authentication (Codex)

**Task:** close the second dashboard backlog Tranche 1 P1 bead without changing the Viewer role's
intentional read-only flow-page access.

**Result:** `flows:list`, `flows:get`, `flows:export`, and legacy `flow:list` now require the
sender-bound `Permission.PAGE_FLOWS`. The real-Electron authorization verifier seeds a canary flow,
proves the three canonical calls return `NOT_AUTHORIZED` before sign-in, and confirms a signed-in
Viewer can still list, get, and export that flow.

**Verification:** `npm run verify:recorder-authz` **50/50**. Mutation proof: removing the three
canonical guards produced **47/50**, then the mutation was reverted. Dashboard source counts move to
**113 total / 29 outstanding / 84 closed**. Packaging/offline gates were not run because no
packaging surface changed.

## 2026-07-28 (latest) - `awkit-cxa` shipped-fixture regression pinned and tracker closed (Codex)

**Task:** start dashboard backlog Tranche 1 with the silent Flow Designer round-trip data-loss bead.

**Result:** the designer-boundary fix was already present from commit `082cfea`; the stale bead was
closed after adding a regression that loads the shipped `mock-conditional-flow.json` fixture and
round-trips its bare condition expression through the production converters.

**Verification:** `npm run verify:flow-step-mapping` **102/102**. Mutation proof: restoring the old
`fromFlowStep` value chain produced **93/102**, including an explicit failure for the shipped
fixture, then was reverted. Dashboard source counts move to **113 total / 30 outstanding /
83 closed**. Packaging/offline gates were not run because no packaging surface changed.

## 2026-07-28 (latest) - Declared-blocked pin moved to 2; the layer check only ever tested one (Claude)

**Task:** review Codex's Phase K work, then fix what the review found.

**Review result:** all seven claimed gate counts re-run and accurate — `build` PASS,
`verify:workflow-builder` 28/28, `verify:workflow-sentinels` 12/12,
`verify:protected-login-recorder` 57/57, `verify:recorder-gui` 152/0/0 (undisturbed),
`verify:mock-site` 94/94, `verify:roadmap-dashboard` 135/135 at HEAD.

**The defect:** the *working tree* failed at **134/135**. `awkit-cey` was committed `open` while bd
held it `blocked`, and the check pinned `declaredBlocked === 1` against the two that now exist
(`awkit-7bu`, `awkit-cey`). Confirmed by stashing the uncommitted `.beads/issues.jsonl` edit — 135
at HEAD, 134 with it — then restoring.

**Resolved toward `blocked`, not away from it.** REC-022 is held by an authorized operator plus an
approved real-IdP identity; that is not expressible as a `blocks` edge, which is the same reasoning
already applied to `awkit-7bu`. So the pin moved to 2 and the bead keeps the correct status.

**It was hiding a second issue.** The check asserted the layer of `externallyBlocked[0]` only, so
the second declared-blocked issue was never validated — a fail-open that opened the moment the count
went from 1 to 2. Now `.every()`, with the count assertion beside it keeping it non-vacuous.

**Mutation-tested both halves:** the count already had live evidence (it produced the 134/135), and
flipping the layer comparison to `=== 0` produced `FAIL` before reverting.

**Files:** `scripts/verify-roadmap-dashboard.mjs`, `.beads/issues.jsonl`,
`docs/ai/{CURRENT_STATE,TASK_LOG}.md`.

## 2026-07-28 (earlier) - REC-022 narrowed to a real IdP only (Codex)

**Task:** automate every REC-022 guarantee the offline mock can express without claiming Phase K
complete, and finish the Phase E review follow-ups.

**Delivered:** `verify:protected-login-recorder` **57/57** now covers the real Recorder pause guard,
exact non-empty draft preservation under password/OTP attempts, open-but-inert detected browser,
unpause positive control, persisted-profile Auto Secure Login + Reuse Session replay, authenticated
dashboard, and no-session negative control. The session-reuse fixture derives state from
origin-scoped `localStorage`. All three new boundaries were mutation-proven to fail. REC-022 remains
`BLOCKED` only on a real authorized IdP/operator run and is tracked as P2 **`awkit-cey`**; Phase K
remains `partially-completed`.

**Phase E follow-ups:** build PASS; `verify:workflow-builder` **28/28**; shared workflow-conflict
producer/parser with round-trip sentinel; exhaustive workflow-node type map; targeted ignore for
`.codex/config.toml`; unpushed Phase E commit amended with a truthful body.

**Validation:** `npm run build`; `verify:workflow-builder` 28/28;
`verify:workflow-sentinels` 12/12; `verify:protected-login-recorder` 57/57;
`verify:recorder-gui` 152/0/0; `verify:mock-site` 94/94; `verify:roadmap-dashboard` 135/135.
`npm run ai:memory` PASS. Packaging/offline
gates not run because no such surface changed. Ledger unchanged at **61 PASS / 4 NOT RUN /
1 BLOCKED**.

## 2026-07-27 (latest) - Roadmap phases reconciled after 282 commits of drift; partially-completed status added (Claude)

**Task:** answer why Phase E still read "In progress", then correct the phase statuses.

**Root cause:** `src/roadmap/ImplementationRoadmap.ts` was last changed in the initial commit
(`c198e2e`, 2026-07-04) — **282 commits ago**. It is hand-maintained and nothing derives it, so it
went stale in silence. The giveaway was not Phase E but **Phase K, declaring Recorder Mode `pending`
/ "intentionally queued"** while the Recorder ships ranked locators, compound/tree disambiguation,
runtime self-healing, Smart Wait observation, the protected-login handoff and eight verifiers. The
dashboard was reporting the file faithfully — being derived, it cannot be fresher than its source.

**Reconciled against code, not prose:** E stays in-progress (all deliverables shipped; the one real
gap is no import-from-file UI in `ScenarioBuilder.tsx` — filed as **`awkit-d3c`**). F, G, H → complete
(fan-out, `dataDrivenConcurrent`, loops + depth-5 recursion guard are all integrated end to end).
J, K → **partially-completed**. 45% → 73%.

**New status `partially-completed`,** because neither existing value described J or K honestly: the
deliverables shipped but each retains a named gap that is not active development. J's acceptance
sentence *is* the unexecuted clean-machine walkthrough; K has REC-024 NOT RUN and REC-022
permanently blocked (`awkit-38k`). Threaded through `RoadmapStatus`, `getRoadmapSummary` (credited
**no** completion %), `getNextRoadmapPhase`, both renderers, `PHASE_STATUSES`, and `normalizePhases`
— mapped to `active`, never `done`.

**Two fail-open defects found, both the same shape.** (1) `icon()` falls back to `ICON_NODES.circle`
for an unknown name, so a status added without its icon degrades silently; new check resolves every
referenced icon name. (2) That check's **own first version was fail-open** — capturing `[a-z0-9-]+`
meant a malformed name was never collected, so mutating to `"circle-dashedX"` still passed;
`[^"]+` fixed it, mutation-verified to fail then reverted. (3) Adding a new top section to
`CURRENT_STATE.md` without a ledger tally dropped it from the consistency banner (`checked` 2 → 1)
while the banner still read "Sources agree" — `parse-narrative.mjs` reads only the newest section.
Caught by inspection, fixed by quoting the tally, and now recorded in that section.

**The browser pass caught three more that every static gate had passed.** (1) The
`.roadmap-summary-grid` edit was **dead** — the responsive block at the end of `global.css`
overrides it from a shared 8-selector list, so the base rule never applied. (2) The five cards
missed one row **by four pixels**: the shared rule's `minmax(180px, 1fr)` needs 948px against the
panel's 944px, dropping "Completion" to its own row; pulled into its own rule at 150px → five 179px
tracks, one row, still wrapping to 2x3 at 800px. (3) **`--awkit-info` had no dark value** while
accent/success/warning/danger all lighten and info's own soft/muted there already derive from
`#60a5fa` — added `--awkit-info: #60a5fa`, which **changes all 16 `var(--awkit-info)` consumers in
dark mode**, not only the new chip.

**Verified:** `npm run build` clean · `verify:roadmap-dashboard` **119 → 135 PASS / 0 FAIL** ·
`verify:verifier-classification` reconciled · `verify:source-hygiene` 7/0 · `ai:memory` passed ·
snapshot 8 complete / 1 in-progress / 2 partial / 0 pending, consistency `checked: 2`, agrees ·
live page at 127.0.0.1:4380: all 11 cards correct, J/K read "Partially completed", 5 summary cards
in one row at 1280, 2x3 at 800, no overflow, both themes symmetric with the sibling chip.
**Not done:** no screenshot — the Browser pane was not displayed so the page never composited
frames; evidence is DOM + computed styles, which does not cover pure aesthetics. The app's own
Electron Roadmap page was not launched; it shares `global.css` and the same markup.

**Files:** `src/roadmap/ImplementationRoadmap.ts`, `app/renderer/pages/{ImplementationRoadmap,Dashboard}.tsx`,
`app/renderer/styles/global.css`, `tools/roadmap/lib/{parse-roadmap-phases,normalize}.mjs`,
`tools/roadmap/public/{icons,views}.js`, `scripts/verify-roadmap-dashboard.mjs`,
`docs/ai/{CURRENT_STATE,TASK_LOG}.md`, `.beads/issues.jsonl`.

## 2026-07-27 (earlier) - awkit-7bu set to blocked; dashboard taught bd's full status taxonomy (Claude)

**Task:** fix `awkit-7bu`'s status. Its title had said `BLOCKED` since 2026-07-26 while its bd
status stayed `open`, so `bd ready` and the dashboard both offered it as startable work.

**Why the status field, not an edge.** It is blocked by two things, neither expressible as a bd
dependency: an authorized operator for SYSDBA provisioning plus an out-of-band ephemeral credential,
and the fact that `scripts/verify-oracle-mock-ui-workflow.mts` has no real-mode code path at all
(recorded in its own notes on 2026-07-26). `bd update awkit-7bu --status blocked` + a note.

**The status change exposed a latent trap in my own tool.** The dashboard accepted only
`open`/`closed` of bd's **seven** statuses and mapped everything not-closed to `open`. Since
`bd update <id> --claim` sets `in_progress`, the documented way to claim work would have made the
parser warn, failed `verify:roadmap-dashboard`, and *still* shown the claimed issue as unstarted.
Fixed across three modules:

- `parse-beads.mjs` — `KNOWN_STATUSES` is now all seven; stats gained `outstanding` and `byStatus`,
  because reporting `open` alone under-counts as soon as any other status is used.
- `normalize.mjs` — `normalizeBeadStatus`: `in_progress`/`hooked` → `active`, `blocked` → `blocked`,
  `deferred` → `deferred`, `pinned` → `open`, `closed` → `done`.
- `order.mjs` — queue = `{open, active, blocked}`; `deferred` excluded. A **deferred prerequisite now
  blocks its dependent**: the old "not in the queue means satisfied" shortcut failed OPEN in exactly
  the case that mattered. Kahn cannot drain a declared-blocked item or anything depending on it, so
  Tarjan splits the residue — an SCC is a real cycle, the rest is held from outside the graph and
  gets its own **"Blocked — not startable"** section with `layer: null` instead of being mislabelled.

**The verifier caught my own semantic change**, which is the point of it: "every blocked item has at
least one open blocker" went red, because a declared block has no edge to name. Corrected to "blocked
for a stated reason" — an edge *or* a declared status, never neither.

**Guarded: 111 -> 119 PASS / 0 FAIL.** Four new checks drive statuses with no instance in the repo
today (`in_progress` stays queued, `deferred` is excluded, a deferred prerequisite blocks, a
dependent of a declared-blocked issue is blocked and not called a cycle) using synthetic items, so
the branches are executed rather than merely present.

**Result:** ready 25 -> 24; `awkit-7bu` ranks 29 in "Blocked — not startable (1)", labelled
"declared blocked in bd". Rank stays a gapless 1..29.

**Files:** `.beads/issues.jsonl`, `tools/roadmap/lib/{parse-beads,normalize,order}.mjs`,
`tools/roadmap/public/views.js`, `scripts/verify-roadmap-dashboard.mjs`,
`docs/ai/{CURRENT_STATE,TASK_LOG}.md`.

## 2026-07-27 (earlier) - Area derivation reweighted: title beats body, position beats list order (Claude)

**Task:** fix the dashboard's area chips, which were visibly wrong on ~8 of 29 queued issues.

**Root cause.** `deriveArea` concatenated title + description into one haystack and returned the
first keyword *in the keyword table's own order*. So a passing mention anywhere in a long body
outranked the subject of the title, and the table's ordering decided everything: all five Test Lab
issues scattered across Reports/Licensing/Security, `awkit-8ri` (Settings) read as Recorder because
its body cites `verify:recorder-gui`, `awkit-az7` (Reports) as Security, `awkit-cxa` (Designer) as
Security, `awkit-4km` (async engine) as Security, `awkit-4a6` (Instance Monitor) as Packaging.

**Fix — two changes, both needed.** (1) `deriveAreaWeighted(primary, secondary, ...)`: the title
decides whenever it matches at all; the body is consulted only when the title is silent and says so
in its basis. Defects invert the scopes deliberately — the affected-file list leads, because a title
like "a control that did nothing" names nothing while its files name the engine. (2) Within a scope
the **earliest occurrence** wins, list order tiebreaking only. Needed independently: `secret`
precedes `settings` in the table, so "Settings ... unavailable secret-store GUI" filed as Security
under list order alone. Also added `instance -> Runner / engine`.

Ranks shifted because area is a sort key in the queue; priority and dependencies are untouched.

**Guarded, and the guards were checked for discrimination rather than assumed.**
`verify:roadmap-dashboard` 105 -> **111 PASS / 0 FAIL**. I reimplemented the OLD concatenation logic
and ran it against the three new fixtures: it returns Recorder / Security / Reports where the checks
demand Settings / Settings / Test Lab. A fourth asserts all five `wza` issues group under Test Lab.

**Gotcha worth knowing: the dashboard hot-reloads DATA, not its own CODE.** `POST /api/refresh` and
the 1.5s poll re-read the 13 sources, but `tools/roadmap/lib/*` is already in the Node module cache,
so the browser kept rendering the old areas until the server was restarted. Editing a source file
needs no restart; editing the tool does.

**Files:** `tools/roadmap/lib/normalize.mjs`, `scripts/verify-roadmap-dashboard.mjs`,
`docs/ai/{CURRENT_STATE,TASK_LOG}.md`.

## 2026-07-27 (earlier) - Dashboard upkeep made a standing rule; the 7/1 was flaky, it passes (Claude)

**Task:** instruct every agent to keep the Program Status dashboard current on any change, stage, or
observed/reported issue; then re-run `verify:settings-runner-behaviour` on the owner's desktop session.

**Delivered — the standing rule.** Canonical procedure in `docs/ai/DEVELOPMENT_WORKFLOW.md` § 6, with
pointers from `AGENTS.md` (a rules section + End-of-task checklist item 8), `CLAUDE.md`, `GEMINI.md`,
`docs/ai/README.md` and `tools/roadmap/README.md`. The load-bearing point everywhere: **the dashboard
is DERIVED — never edit `tools/roadmap/` to record progress.** It re-parses 13 files on a 1.5s poll,
so a page that could be edited independently of the repository is a page that can lie about it. The
rule instead maps each fact to the source that owns it, requires `blocks` edges in `bd` for real
dependencies (24 of 29 queued issues still declare none), requires claiming actively-worked items in
`assignments.json`, and ends with `verify:roadmap-dashboard` + an Overview reading "Sources agree".

**CORRECTION — `verify:settings-runner-behaviour` is flaky, not blocked. It passes: 11 PASS / 0 FAIL.**
Four runs, identical code, no rebuild: 7/1, 7/1, 7/1, **11/0**. The previous entry's conclusion — a
deterministic `@media (hover: hover) and (pointer: fine)` environment mismatch — is **withdrawn**; that
would not have produced a green run. The failing step is a timing-sensitive click on the card's
hover-revealed Run button, intercepted by `.workflow-card-hint` while the summary layer is still
cross-fading. Root cause not fully isolated. Recorded in `KNOWN_ISSUES.md` with the rule that **one
red run proves nothing — re-run it**, and that if it ever becomes persistent the fix is to drive
`:focus-within` (the ungated path at `global.css:5411`), never to weaken the assertion. This is the
suite that found `AWKIT-SET-006`.

Writing the rule immediately caught me with it: the new `CURRENT_STATE.md` section shipped without its
ledger tally, which silently drops a consistency source — trap #1 in the text I had just written.
`verify:roadmap-dashboard` failed it, and it was fixed before commit.

**Commands:** `verify:settings-runner-behaviour` **11/0** · `verify:roadmap-dashboard` 105/0 ·
`verify:verifier-classification` green (144/144) · `check-memory` passed · `build` passed ·
`typecheck:scripts` passed · `verify:source-hygiene` 7/0 · `validate:offline` passed.

**Files:** `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `tools/roadmap/README.md`,
`docs/ai/{DEVELOPMENT_WORKFLOW,README,CURRENT_STATE,HANDOFF,KNOWN_ISSUES,TASK_LOG}.md`. No code changed.

## 2026-07-27 (earlier) - Verifier classification reconciled; a 7/1 surfaced on this machine (Claude)

**Task:** resolve `verify:verifier-classification` by classifying `verify:reports-live-engine` and
`verify:settings-runner-behaviour` from what each actually executes. Scope limited to that.

**Delivered:** the gate is **GREEN — all 144 scripts classified**, no stale entries. Both are
`real-browser` (`real-browser` 48 → 50, total 142 → 144), decided independently: both hard-require
`out/main/main.js`, both `electron.launch({ args: [root] })` the built unpackaged app, both spawn the
mock site; `reports-live-engine` starts real Chromium instances (`dryRun: false`, 3 instances) and
saturates the live engine, `settings-runner-behaviour` starts a real run from the run card. `args:
[root]` rules out `packaged-application`; `integration` excludes browser/Electron by definition.
Registry metadata only — no verifier behaviour changed.

**Commands:** `verify:verifier-classification` green · `verify:reports-live-engine` **21/0** ·
`verify:settings-runner-behaviour` **7 PASS / 1 FAIL** · `build` passed · `typecheck:scripts` passed ·
`verify:source-hygiene` 7/0 · `validate:offline` passed · `verify:roadmap-dashboard` 105/0.

**The 7/1, investigated but deliberately not fixed.** `locator.click` on `button.workflow-card-run`
times out, intercepted by `.workflow-card-hint`. Reproduced 3/3 including with all other GUIs closed.
`global.css:5423` gates the `:hover` reveal behind `@media (hover: hover) and (pointer: fine)`; the
`:focus-within` equivalent at `5411` is ungated. A window not matching that media query never reveals
the button to a pointer — exactly the observed error. Not a regression: `5c2990d` touched no `app/` or
`src/` file, the markup predates it, the sibling suite hit 21/21 on the same build in the same
session, and this suite's first seven checks pass. Loosening the check to make it green was
explicitly out of scope; options are recorded in `HANDOFF.md`.

**Files:** `scripts/lib/verifier-classification.ts` (+2 entries),
`docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md`.

## 2026-07-27 (earlier) - Program Status & Roadmap dashboard, isolated in tools/roadmap (Claude)

**Task:** build a continuously-updating web page showing the roadmap, pending work, dependencies,
reported issues, implementation order and agent activity — isolated from the app, runnable on its own.

**Delivered:** `npm run roadmap` → <http://127.0.0.1:4380>; `npm run verify:roadmap-dashboard`
**105 PASS / 0 FAIL**. Eight views over 13 live-parsed sources (222 records), served by a zero-
dependency `node:http` server bound to loopback. `GET /app.css` serves `global.css` verbatim, so the
page is the app's real UI with zero token drift rather than a lookalike.

**Isolation proven, not asserted.** `tsc --noEmit --listFiles` matches **0** files under
`tools/roadmap`; `npm run build`, `typecheck:scripts`, `verify:source-hygiene` (7/0) and
`validate:offline` all pass unchanged, run before and after. `electron-builder.json` untouched.

**Five briefing assumptions were measured and found wrong** before any code was written — Node is
18.16 not 20; the assumed TASK_LOG heading regex matches 38 of 247 (a two-strategy extractor recovers
225 = 91.1%); the traceability CSV has unescaped commas so a 6-way split misaligns 3 rows; the naive
object-literal→JSON conversion throws on phase E's prose colon; and **the open dependency graph is
nearly empty** — 24 of 29 queued issues declare no dependency, which reshaped the whole design.

**Two defects found and fixed in the new code.** (1) `assignments.json` — the only file the tool asks
an agent to edit — was absent from the liveness fingerprint, so a claim would have sat unread behind
the snapshot cache until an unrelated document changed; now folded in and proven end to end. (2) The
graph's SVG edge overlay was scheduled purely on `requestAnimationFrame`, which a non-compositing tab
starves: measured 33 nodes / **0 edges**. First draw now runs on an explicit mount hook.

**One vacuous check found in my own verifier and fixed:** "every assignee comes from
assignments.json" was an `.every()` over an empty array, since the file ships with no claims — true
without testing anything. Now driven against a fixture via an injected path, and it asserts the
expired-claim branch too. Mutation-tested: three deliberate breaks each produce FAIL and exit 1.

**Files:** `tools/roadmap/**` (server, 9 parsers, normalize/link/order/agents/model, 6 public assets,
README), `scripts/verify-roadmap-dashboard.mjs`, `scripts/lib/verifier-classification.ts` (+1 entry),
`package.json` (+3 scripts), `.claude/launch.json`, `docs/ai/{CURRENT_STATE,COMMANDS,TASK_LOG}.md`.

**Not done / known:** `verify:verifier-classification` is **red on `main` and was before this task** —
`verify:reports-live-engine` and `verify:settings-runner-behaviour` from the two preceding sessions
were never registered. This change registered only its own verifier (`static-source-validation`
7 → 8, total 141 → 142, the expected delta); classifying those two is still open and is deliberately
not guessed. No screenshot evidence: the browser pane could not composite in this session, so the UI
was verified structurally (computed tokens, grid geometry, overflow, theme cycling, SSE round-trip)
rather than visually.

## 2026-07-27 - SET-008 + SET-009 closed; AWKIT-SET-006 fixed (Claude)

**Task:** close the remaining Settings cases.

**Delivered:** `npm run verify:settings-runner-behaviour` — **11 PASS / 0 FAIL**. Ledger **61 PASS /
4 NOT RUN / 1 BLOCKED**; Settings **19 PASS / 2 NOT RUN**. Every case still open across the whole
campaign is now an owner decision, not engineering work.

**Defect `AWKIT-SET-006`.** "Screenshot on failure" was offered in Settings and on every run card,
persisted in both places, and reached nothing: `RunWorkflowRequest` had no field for it and all four
artifact profiles hardcode `screenshotOnFailure: true`. A RULES.md violation (no no-op controls).
Fixed by carrying the run-level choice the way certificate trust already travels — request → instance
template → `InstanceConfig` → engine — with per-step `onFailure.screenshot` still winning and an
omitted field still meaning "artifact default". ON → OFF → ON went 4/4/4 → **4/0/4**.

**Two harness traps that each produced a wrong answer first, both now guarded in the suite:**
`executions.list()` returns every instance of the session, so polling for "some terminal instance" is
satisfied by a previous run's corpse and samples artifacts too early — it reported the defect as
*working*. And a single ON→OFF pair cannot attribute the difference to the setting, so the suite runs
ON→OFF→ON. Static reading, first measurement and corrected measurement disagreed; the disagreement is
what exposed the harness bug.

**Not closed, and why:** SET-013's GUI half needs `safeStorage.isEncryptionAvailable()` false inside
the running app; the contract is already proven by `verify:secrets` with an injected fake, but there
is no seam, and adding an env hook to `app/main/secretStore.ts` would put a test hook in a shipped
security path (the class deliberately removed from the Zvec host). Owner decision — not taken.
SET-015 is the real OS folder launch, same owner-decision class as SYS-REP-008.

**Files:** `scripts/verify-settings-runner-behaviour.mts` (new), `package.json`,
`app/renderer/pages/InstanceMonitor.tsx`, `app/main/ipc/execution.ipc.ts`,
`src/instances/{InstanceConfig,InstanceManager}.ts`, `src/runner/ExecutionEngine.ts`,
`docs/testing/comprehensive-validation/*`, `docs/ai/*`.

**Tests run:** settings-runner-behaviour 11/11, runner 89/89, artifacts 13/13, failure-evidence 34/34,
failure-screenshot-precedence 6/6, concurrency 81/81, build + typecheck:scripts clean.
**Repackaged after the `src/`+`app/` change and both packaged gates re-run: walkthrough 70/0,
packaged-validation 87/0** — so the `AWKIT-SET-006` wiring holds in the packaged app, not only the dev
tree. **Not run:** the clean/offline Windows VM walkthrough and code signing / SmartScreen.

---

## 2026-07-27 - Live-engine harness: SYS-REP-007 + SYS-REP-011 closed (Claude)

**Task:** build the live-engine harness for the two Reports cases that no seeding could reach.

**Delivered:** `npm run verify:reports-live-engine` — **21 PASS / 0 FAIL**. Ledger **59 PASS / 6 NOT
RUN / 1 BLOCKED**; Reports **14 PASS / 2 NOT RUN**, and both remaining Reports cases are the same
owner-decision OS folder launch — **no agent-actionable engineering is left in Reports**.

**How.** Starts real instances against the local mock site and drives the app into its supported
**sequential** capacity mode through the real `settings.update` IPC; the product then refuses dispatch
on its own (`active flow limit reached (1/1)`). An idle-engine negative control runs first, so neither
assertion can be satisfied by a page that renders the same thing regardless of engine state.

**Defect `AWKIT-REP-008`, found by the release half of SYS-REP-011.** `dispatchBlocked` was
`lastBlockedReason !== undefined`, cleared only by a later successful `admit()` — which never comes
once a run ends. 45 s after every instance ended, with zero active flows, the app still reported
itself throttled, in `ReportsChrome`, `telemetry:server`, `StatusBar` and `InstanceMonitor`. Fixed by
making a refusal decay (5 s; the loop re-asks every ~500 ms), chosen over clear-on-exit because that
must be remembered by every exit path. Pre-fix control 19/2 → post-fix 21/0.

**Two measured facts recorded so they are not re-derived:** env vars cannot set the concurrency caps
(settings-derived `overrides` are spread after the env values — the first run set both and still saw
`maxActiveFlows=4`), and a rendered-vs-engine comparison races by construction, so the suite polls for
agreement and prints the last disagreement rather than relaxing the comparison.

**Also fixed: a NOT RUN counted as a PASS.** `verify-reports-populated-gui`'s `notRunCheck` pushed
`pass: true`, so "158 PASS / 0 FAIL" included entries that ran nothing. Measured after the fix:
**155 PASS / 0 FAIL / 3 NOT RUN** — no check changed behaviour. (Three, not the six you get from
counting call sites; the others sit in branches this fixture does not take.)

**Files:** `scripts/verify-reports-live-engine.mts` (new), `package.json`,
`src/runner/concurrency/BackpressureController.ts`, `scripts/verify-concurrency.mts`,
`scripts/verify-reports-populated-gui.mts`, `docs/testing/comprehensive-validation/*`, `docs/ai/*`.

**Tests run:** reports-live-engine 21/21, concurrency 81/81 (was 78), runner 89/89, capacity-modes
10/10, runtime-status 15/15, telemetry 61/61, observability 65/65, durable-store 11/11,
reports-populated-gui 155/0/3, build + typecheck:scripts clean. **Repackaged after the `src/` change
and both packaged gates re-run: walkthrough 70/0, packaged-validation 87/0** — so the
`AWKIT-REP-008` fix is verified in the packaged app, not only in the dev tree.
**Not run:** the clean/offline Windows VM walkthrough (separate human gate, explicitly not claimed by
the script) and code signing / SmartScreen reputation.

---

## 2026-07-27 - Completed the interrupted handoff; a seventh unfailable check (Claude)

**Task:** finish the `/HANDOFF` the previous session was cut off during, and verify its claims at HEAD
rather than copying them forward.

**Delivered.** The recommended grep was run against a surface the previous session had not covered —
the packaged gates — and found a **seventh** instance of the unfailable-check pattern, this one in a
release gate: `verify-packaged-validation.mts` had
`check("Warnings/findings state present", statuses.some(…) || true)`. The `|| true` defeats the
condition outright; it had been green since it was written and asserted nothing.

**Fix:** precondition and assertion are now separate facts — a flow under compatibility must be
`runnable === true` **and** still report findings; an empty set is `NOT RUN`. The script gained the
`NOT RUN` third state it never had, which is the structural cause: a suite with only pass/fail pushes
a legitimately-absent precondition into the condition.

**Executed: 86 PASS / 1 FAIL**, the one failure being the script's own freshness guard refusing the
2026-07-26 package (1400 min old vs a 180-min budget). After repackaging: **87 PASS / 0 FAIL**.

**The packaged gate is current again.** `package:portable` re-run (offline validation strict-mode
PASS, Zvec host 17/17), `verify:packaged-walkthrough` **70 PASS / 0 FAIL** against the new build — the
first citable packaged result since this campaign began changing `src/` and `app/`. No non-loopback
TCP connection from any app process (Part M); NSIS sha512 matches `latest.yml` (Part L).

**Verified rather than assumed:** `verify:reports-settings-a11y` is 14 PASS / 0 FAIL at HEAD, but the
branch fixed in `cdcf8e3` is **unreachable on a fresh profile** (EmptyState → no sort headers). The
`aria-sort` contract's real coverage is in `verify:reports-populated-gui`, written as
`sortState.length > 1 && …`, which cannot pass vacuously.

**Files:** `scripts/verify-packaged-validation.mts`, `docs/ai/{HANDOFF,CURRENT_STATE,KNOWN_ISSUES,TASK_LOG}.md`,
`.beads/*.jsonl` (reconciling `awkit-59s` + `awkit-38k`, closed by the previous session).

**Tests run:** build PASS, typecheck:scripts PASS, reports-settings-a11y 14/14, check-memory PASS,
`package:portable` PASS, verify:packaged-walkthrough **70/0**, verify-packaged-validation **87/0**.
**Not run:** the clean/offline Windows VM walkthrough (separate human gate, explicitly not claimed by
the script) and code signing / SmartScreen reputation (packaging skips signing — no cert configured).

---

## 2026-07-27 - Reports block: 3 cases, 2 defects, 2 vacuous checks (Claude)

**Task:** the Reports block — the 7 `NOT RUN` System Reports cases.

**Delivered:** `verify:reports-populated-gui` **136 → 158 PASS / 0 FAIL**. Ledger **57 PASS / 8 NOT
RUN / 1 BLOCKED** (Recorder 28/0/1, Reports 12/4, Settings 17/4). SYS-REP-009, SYS-REP-010 and
SYS-REP-012 closed; SYS-REP-006 substantially advanced and its recorded blocker corrected.

**Defects.** `AWKIT-REP-006` — Failure Analytics is described as "evidence-based insights" and
`FailureBreakdown` had no evidence at all, so "12 timeouts" could not be traced to any run;
`queryFailures` already held the filtered rows and discarded them. `AWKIT-REP-007` — `dirSizeMb`
stops at 20,000 entries and returned a truncated figure presenting itself as a total.

**Two vacuous checks in the passing ledger, both short-circuiting to `true`:** `failures.recent` read
from a contract with no `recent` field (`undefined ?? []` then `length === 0 ||`), and
`chromiumMemoryMb === undefined ? realCheck : true`. Five instances of this pattern now; the tell is
a condition that can short-circuit. Grep `=== undefined ?` and `.length === 0 ||`.

**Fixture blind spot:** `runtime_capacity_snapshots` was never seeded (a different table from the
capacity *buckets* that were), so three of four Runtime Analytics cards had only ever shown `—`.

**SYS-REP-006's blocker was wrong.** A contract change was never needed: `RunDetail.run` is optional
and `JSON.stringify` omits undefined, so the absence of `run` was the signal. Asserted directly.

**Measured constraints recorded:** the durable store is sql.js (in-memory; a second connection cannot
mutate a running app), and bulk test files must go to the OS temp dir — `test-artifacts/` is inside
the user's OneDrive.

**Files:** `src/reports/TelemetryContracts.ts`, `src/runner/store/{SqliteRuntimeStore,RuntimeStore}.ts`,
`app/main/ipc/telemetry.ipc.ts`, `app/renderer/pages/{ReportsFailures,ReportsServer}.tsx`,
`scripts/verify-reports-populated-gui.mts`, `docs/testing/comprehensive-validation/*`, `docs/ai/*`.

**Tests run:** reports-populated-gui 158/158, telemetry 61/61, observability 65/65, reports 31/31,
runtime-analytics-gui 36/36, runtime-status 15/15, reports-settings-a11y 14/14, build +
typecheck:scripts clean.
**Not run:** SYS-REP-007/011 (need a live-engine harness), SYS-REP-008 + SYS-REP-006 artifact launch
(owner-decision manual), `package:portable` + `verify:packaged-walkthrough`.

---

## 2026-07-27 - REC-024: the Recorder surface is complete (Claude)

**Task:** close REC-024, the last automatable Recorder case.

**Delivered:** `verify:recorder-gui` **128 → 152 PASS / 0 FAIL / 0 NOT RUN**. Ledger **54 PASS /
11 NOT RUN / 1 BLOCKED**; **Recorder 28 PASS / 0 NOT RUN / 1 BLOCKED** — only REC-022 remains and it
needs an authorized human. The other 11 open cases are all Reports (7) and Settings (4).

**Defect `AWKIT-REC-007`.** `RecorderService` registered a `close` listener for **popups** and nothing
for the main page, the browser or the context, and `getStatus()` returns the raw `isRecording` flag
with no liveness check. Killing the recorded browser out of band left the page — which polls that
status — showing **Recording** forever, with Start, the Target URL field and both capture switches
disabled. Fixed with `attachLivenessWatch`: `page.close` + `page.crash` + `browser.disconnected` +
`context.close`, firing only on an unexpected death (supported teardowns set `isRecording = false`
first) and ignoring handles from an already-replaced session. Actions and draft are preserved.

**`page.crash` was nearly missed.** Measured: a renderer crash leaves `page.isClosed() === false` and
fires neither `close` nor `disconnected`. The two obvious events would have left the recorder stuck
behind a crashed tab — the case's own wording is "closes **or crashes**".

**Two trigger mechanisms measured as dead ends, recorded so they are not retried:** `window.close()`
is refused from an `http://` origin (as is `window.open("","_self").close()`), so an out-of-band close
of the MAIN page is unreachable from a fixture — the harness written for it was removed rather than
left looking functional; and `taskkill /T` without `/F` does not end Chromium. Working triggers: kill
the renderer, `CloseMainWindow()`, and `taskkill /T /F`.

**The controls are what made this trustworthy.** Both dead ends first presented as "the recorder
stayed in Recording", indistinguishable from the real defect, so every trigger now asserts the
targeted pids are actually gone before the product assertion runs and reports `NOT RUN` otherwise.
Process discovery diffs against a baseline (Windows recycles pids; stale `ParentProcessId`s made the
developer's own Chrome look like an orphan leak) and walks the whole descendant tree (the browser is a
**grandchild** of `app.process()`, so a direct-children query found nothing).

**Files:** `src/recorder/RecorderService.ts`, `scripts/verify-recorder-gui.mts`,
`mock-site/public/recorder-lab.html`, `docs/testing/comprehensive-validation/*`, `docs/ai/*`.

**Tests run:** recorder-gui 152/152, recorder-e2e 41/41, recorder-draft 50/50,
protected-login-recorder 45/45, recorder 97/97, recorder-flow 19/19, recorder-authz 44/44,
mock-site 90/90, `build` + `typecheck:scripts` clean.
**Not run:** `package:portable` + `verify:packaged-walkthrough` — `src/` and `app/` changed, so the
recorded 70/70 is non-citable until a repackage.

---

## 2026-07-27 - Recorder a11y: REC-013 + REC-029, 3 defects (Claude)

**Task:** close REC-013's residual keyboard semantics and REC-029, the only wholly `NOT RUN` case.

**Delivered:** `verify:recorder-gui` **103 → 128 PASS / 0 FAIL / 0 NOT RUN**. Ledger **53 PASS / 12
NOT RUN / 1 BLOCKED** (Recorder 27/1/1, Reports 9/7, Settings 17/4). Recorder has one case left
(REC-024) plus operator-blocked REC-022.

**Defects.** `AWKIT-REC-004` — the async review dialog rendered `role="dialog" aria-modal="true"`
with no focus move, no trap, no `Escape` and no focus return; `aria-modal` declares the content behind
it inert, so a keyboard user tabbing out landed in content their screen reader was told does not
exist. **Third surface with this identical defect** after `ConfirmDialog` (`AWKIT-SET-004`) and
`RunDetailDrawer` (`AWKIT-REP-004`) — each with its own markup, so none inherited the fix.
`AWKIT-REC-005` — the status pill, the page's primary state readout, was in no live region.
`AWKIT-REC-006` — the URL search box was named only by its placeholder.

**Method.** Checks were written and executed **before** the fix:
`test-artifacts/recorder-gui/2026-07-27T08-51-42-761Z/` is a real negative control at 74 PASS / 6 FAIL,
with `Tab` recorded escaping the dialog as `INPUT(ESCAPED) → BUTTON(ESCAPED) → …`. Focus is asserted
by **containment**, never by label text, because `activeElement` falls back to `<body>` whose
`textContent` holds every label on the page. Reduced motion is measured both ways (`infinite` → `1`),
since asserting only the reduced value is satisfied by an element with no animation at all.

**Two of my own premises were wrong first.** An `aria-label || textContent` accessible name reported
every `<label>`-wrapped `INPUT` as unnamed and invented two defects; and a named arrow binding inside
`page.evaluate` threw `ReferenceError: __name is not defined` (the recorded esbuild trap).

**REC-004 reclassified.** Dismissed twice as "the known intermittent Electron flake", it failed twice
consecutively. I hypothesised a stale-response race and the measurement **disproved** it
(`empty-state=1 stale rendered rows=0`): a one-shot assertion was sampling before React committed.
The check now polls and reports the rendered row count. No product change made on the wrong theory.

**Files:** `app/renderer/pages/Recorder.tsx`, `scripts/verify-recorder-gui.mts`,
`docs/testing/comprehensive-validation/{RECORDER_REPORTS_SETTINGS_TEST_CASES,DEFECTS}.md`,
`docs/ai/{CURRENT_STATE,HANDOFF,KNOWN_ISSUES,TASK_LOG}.md`.

**Tests run:** recorder-gui 128/128 (twice), recorder-e2e 41/41, mock-site 90/90,
reports-settings-a11y 14/14, `build` clean, `typecheck:scripts` clean.
**Not run:** `package:portable` + `verify:packaged-walkthrough` — this round changed
`app/renderer`, so the recorded 70/70 is non-citable until a repackage.

---

## 2026-07-27 - SET-004 mid-session half; ledger correction (Claude)

**Task:** wire up SET-004's mid-session behavioural half.

**Delivered:** `verify:recorder-gui` **100 → 103 PASS / 0 FAIL / 0 NOT RUN** — the suite now has no
unmet preconditions at all. SET-004 closes. Ledger **51 PASS / 14 NOT RUN / 1 BLOCKED**
(Recorder 25/3/1, Reports 9/7, Settings 17/4).

**Kept in `verify:recorder-gui`**, which already owns the mock site and the Recorder controls, rather
than duplicating that infrastructure into `verify:settings-e2e`.

**Method.** "The live session was unaffected" is unfalsifiable on its own, so the test uses the two
observable consequences of the capture flags. A session launched with Smart Wait capture ON and
waiting-time capture OFF reports `fixedDelay=2, waitActions=0` even after waiting-time capture is
switched on mid-recording through Settings (the only route left — the page locks its own switches),
with the persisted change asserted separately as a control. The next session on the identical fixture
reports `fixedDelay=0, waitActions=1`: both the "next session uses new values" half and the negative
control for the first assertion. `RecorderService.start` assigns both flags once, so the binding is
launch-time by construction and the timing of the change cannot matter.

**Ledger correction.** The previous entry recorded 51/14 one commit early; the true count at `fe5aa25`
was **50/15**, because SET-008 stayed `NOT RUN` for its run-form half. Closing SET-004 makes 51/14
correct now, but it was wrong when written.

**Files:** `scripts/verify-recorder-gui.mts`,
`docs/testing/comprehensive-validation/{RECORDER_REPORTS_SETTINGS_TEST_CASES,EXECUTION_RESULTS}.md`,
`docs/ai/{CURRENT_STATE,TASK_LOG,HANDOFF}.md`.

**Tests run:** `typecheck:scripts` ✓, recorder-gui **103/103**.
`REC-004 Cancel returns the page to its empty state` failed once and passed on an isolated re-run —
the known intermittent real-Electron startup flake, not a regression.

---

## 2026-07-27 - Phase 4 cont.: the remaining Settings cases (Claude)

**Task:** continue Phase 4 across the Settings surface — the eight cases still `NOT RUN`.

**Delivered:** `verify:settings-e2e` **128 → 151**. Ledger **47 → 51 PASS / 18 → 14 NOT RUN /
1 BLOCKED** (Settings 13 → 17 PASS). Closed SET-007, SET-008, SET-017, SET-020, plus SET-015's
unreadable-store half.

**One product defect: `AWKIT-SET-005`.** `checkPath` labelled an ACL-denied directory "writable"
because `access(dir, W_OK)` does not consult the directory ACL on Windows. These paths are where run
artifacts land, so the operator would have been told a folder was fine and had every artifact write
fail later. Fixed with a real write probe — the pattern `OfflineRuntimeValidator.canWrite` already
used.

**Two fixture premises were measured, and both were wrong on the first attempt:** denying the whole
`W` right also blocks `stat` (the directory reads as *missing*, not read-only, so the case is never
exercised), and `JSON.stringify` equality on the settings document compares key *order*, which
`hydrate()` changes across a restart.

**Files:** `app/main/ipc/settings.ipc.ts`, `scripts/verify-settings-e2e.mts`,
`docs/testing/comprehensive-validation/{DEFECTS,RECORDER_REPORTS_SETTINGS_TEST_CASES,EXECUTION_RESULTS}.md`,
`docs/ai/{CURRENT_STATE,TASK_LOG,HANDOFF}.md`.

**Tests run:** build ✓, `typecheck:scripts` ✓, settings-e2e **151/151**, settings-persistence 3/3,
capacity-settings-gui 12/12, reports-settings-a11y 14/14, flow-designer 56/56.

**Not run:** `package:portable` + `verify:packaged-walkthrough` (this round changed `app/main`, so the
recorded 70/70 is still not citable), `validate:offline`, `verify:runner`, clean-machine.

**Remaining in Settings (4):** SET-004 mid-session (fixture exists, verifier does not spawn the mock
site), SET-009 runner behaviour (needs a bounded real run; also owns the new-run-form half of
SET-008), SET-013 unavailable secret store (no injection seam for
`safeStorage.isEncryptionAvailable()`), SET-015 real OS folder launch (manual).

---

## 2026-07-27 - Phase 4: Reports/Settings residual submatrices (Claude)

**Task:** Phase 4 — resume the interrupted Reports/Settings submatrix work, then close what is
closable across both surfaces plus the shared Recorder fixture.

**Delivered:** `verify:reports-populated-gui` **74 → 136**, `verify:settings-e2e` **116 → 128**,
`verify:recorder-gui` **90 → 100**. Ledger **43 → 47 PASS / 22 → 18 NOT RUN / 1 BLOCKED**.
Closed SYS-REP-004, SYS-REP-005, SET-016, SET-019; REC-013, SYS-REP-010, SYS-REP-012, SET-008 and
SET-013 lost their named residual subcases.

**Two product defects, both fixed.** `AWKIT-REP-004`: the Reports run drawer was `aria-modal` with
no Escape, focus move, trap or return — same class as `AWKIT-SET-004`, which had fixed
`ConfirmDialog` but not this component. `AWKIT-REP-005`: `AnomaliesPanel` dropped recovered
anomalies, making "regressed then recovered" render identically to "never regressed".

**Three assertions were vacuous before first execution** — a focus check that `<body>` would have
satisfied, a sort check that an arbitrary ordering would have satisfied, and a button label that had
been guessed. All three are now negative-controlled or value-checked.

**New mock-site fixture** `/recorder-lab?rec013=1`, double-gated like REC-018/REC-007. The recorded
plan for it was wrong: a `fixedDelay` needs waiting-time capture **OFF**, not on
(`allowFixedDelayFallback: !captureWaitTime`), plus a genuinely quiet gap.

**Files:** `app/renderer/components/reports/RunDetailDrawer.tsx`,
`app/renderer/pages/ReportsRuntime.tsx`, `app/renderer/styles/global.css`,
`scripts/verify-reports-populated-gui.mts`, `scripts/verify-settings-e2e.mts`,
`scripts/verify-recorder-gui.mts`, `mock-site/public/recorder-lab.html`, `mock-site/README.md`,
`docs/testing/comprehensive-validation/{DEFECTS,RECORDER_REPORTS_SETTINGS_TEST_CASES,EXECUTION_RESULTS}.md`,
`docs/ai/{CURRENT_STATE,TASK_LOG,HANDOFF}.md`.

**Tests run:** build ✓, `typecheck:scripts` ✓, reports-populated-gui **136/136**, settings-e2e
**128/128**, recorder-gui **100 PASS / 0 FAIL / 1 NOT RUN**, telemetry 61/61, observability 65/65,
reports 31/31, reports-settings-a11y 14/14, mock-site 90/90, recorder 97/97.

**Not run:** `package:portable` + `verify:packaged-walkthrough` (this round changed `app/renderer`,
so the existing 70/70 is **not** citable until a repackage), `validate:offline`, `verify:runner`,
clean-machine.

**Remaining:** SYS-REP-007 live distribution and SYS-REP-011 backpressure are blocked on a
run-driving harness, not on seeding — both read live `ExecutionEngine` state. SET-004's mid-session
half now has its fixture but is not yet wired into the Settings gate.

---

## 2026-07-26 - Phase 3: persistence boundaries, the save path, Settings scope (Claude)

**Task:** Phase 3 — Recorder persistence submatrices, the save path, and the two Settings→Recorder
cases that needed the Phase 2 harness.

**Delivered:** `verify:recorder-draft` **17 → 50**, `verify:recorder-gui` **70 → 90**.
Closed REC-006, REC-010, REC-014, REC-016, REC-017, REC-023, SET-005. No new product defect.

**One production refactor, for testability.** Consecutive-fill compaction lived inside the
`__awtkit_recordAction` `exposeBinding` closure — unreachable without a browser. Extracted to
`RecorderService.recordActionFromPage(page, action)`; the binding is now a one-line adapter.
Behaviour-preservation confirmed (`verify:recorder` 97/97, `verify:recorder-e2e` 41/41,
`verify:recorder-flow` 19/19) **before** building the new checks on it.

**Boundaries that had never actually been hit.** REC-010 now asserts 499 ms, **500 ms exactly** (the
`<` vs `<=` line), 501 ms, and the 60 s cap against a 120 s pause. REC-014 covers unparseable JSON,
valid JSON of the wrong shape, and a missing file — none may throw or resurrect actions, and the URL
history must survive a corrupt draft.

**REC-017 forces a real write failure rather than mocking one:** the flows directory is replaced by a
file, so the store's own write fails. The error surfaces, the recording survives, and retrying after
restoring the directory saves exactly once. Duplicate-name behaviour (a second, distinctly-identified
flow) is asserted as *documented policy* so a later change is deliberate.

**SET-005's mid-session assertion carries a control** — that the persisted value really did change —
so "the running session was unaffected" cannot pass because nothing happened.

**Two things deliberately left NOT RUN**, both blocked on the same missing fixture: REC-013's async
review dialog, and SET-004's mid-session LIVE capture behaviour. Both need a self-driving pause
fixture that shows wait insertion following the launch-time value. Recorded, not glossed.

**Tests run:** `verify:recorder-draft` **50/50** · `verify:recorder-gui` **90 PASS / 0 FAIL / 2 NOT
RUN** · `verify:recorder` 97/97 · `verify:recorder-e2e` 41/41 · `verify:recorder-redaction` 15/15 ·
`verify:recorder-authz` 44/44 · `verify:recorder-flow` 19/19 · `verify:async-review` 21/21 ·
`tsc --noEmit` + `typecheck:scripts` + `build` PASS.

**Environment note worth keeping:** six or more real-Electron suites back-to-back on this machine
intermittently fail at window startup, and once exhausted the shell's process handles.
`verify:recorder-e2e` and `verify:recorder-redaction` both failed that way and passed on isolated
re-runs. Re-run a heavy suite alone before calling its failure a regression.

**Ledger: 29 → 22 `NOT RUN`** (counted from the case file). **43 PASS / 22 NOT RUN / 1 BLOCKED** —
Recorder 25/3/1, Reports 7/9, Settings 11/10.

---

## 2026-07-26 - Phase 2: the Recorder page finally has a GUI verifier (Claude)

**Task:** Phase 2 of the campaign — one harness for the nine Recorder GUI cases.

**Delivered:** `npm run verify:recorder-gui`, **70 PASS / 0 FAIL / 1 NOT RUN**. Closes REC-001,
REC-002, REC-003, REC-004, REC-019, REC-021, REC-025 and the teardown half of REC-024.

**`AWKIT-REC-003` (S3) found and fixed.** Start with an **empty** Target URL began a live recording
pointed at nothing — the `!url.trim()` guard is on Save URL, not Start, and `normalizeUrl("")`
returns `""`. Because the URL field disables while recording, the operator could not fix it without
cancelling. `startRecording` now refuses a blank target before any state is mutated or a browser
launched (order matters — rejecting later would leave `isRecording` already set).

**The lesson worth keeping: my check was vacuous before it was useful.** REC-003 waited for
`isRecording === false`, which is *already* true while a start is in flight — so the poll returned at
t=0 and all four invalid targets passed without being attempted. Rewritten to wait for the status
line to leave `Starting browser...`. The defect appeared the instant the check became real.

**Three of my own premises were wrong; all are now written into the case file so they are not
re-derived:**

1. `file:`/`about:`/`data:` are **deliberately permitted** targets (named in `normalizeUrl`), not
   unsupported schemes. Asserting they fail would have asserted the opposite of the design. Replaced
   with a `javascript:` pseudo-scheme, plus an `about:blank` positive control for the allowance.
2. REC-001 specifies Start *is* enabled while idle. My "Start disabled on empty URL" assertion was my
   assumption, not the spec.
3. Most early failures were UI-lag, not defects: I polled the **service** status then asserted on
   **rendered** control enablement. Added explicit UI-level waits.

**REC-013 is NOT RUN and stays that way.** The review dialog opens only for review-worthy async
activity and no self-driving fixture produces any; filed as a bead rather than asserted vacuously.
REC-024's out-of-band browser kill is likewise still unexecuted — the teardown properties around it
are covered, the crash trigger is not.

**Tests run:** `verify:recorder-gui` **70/0/1** (new) · `verify:recorder` 97/97 ·
`verify:recorder-e2e` 41/41 · `verify:recorder-redaction` 15/15 · `verify:recorder-draft` 17/17 ·
`verify:recorder-flow` 19/19 · `verify:protected-login-recorder` 45/45 · `verify:async-review` 21/21
· `verify:verifier-classification` reconciled · `build` + `typecheck:scripts` PASS.
*(One batch run reported protected-login 44/45; an isolated re-run was 45/45. Environmental
contention from six back-to-back browser suites, not a code path this change touches.)*

**Ledger: 36 → 29 `NOT RUN`** (counted from the case file, not estimated). Recorder 12 → 19 PASS.
Full tally: **36 PASS / 29 NOT RUN / 1 BLOCKED** — Recorder 19/9/1, Reports 7/9, Settings 10/11.

---

## 2026-07-26 - REC-007: a word boundary was leaking secrets (Claude)

**Task:** close REC-007, whose unexecuted part was draft/flow/log/report canary scanning.

**Found a real leak — `AWKIT-REC-002` (S2).** `SENSITIVE_FIELD_PATTERN` contains `\btoken\b` and
`\bsecret\b` and reads as correct. But `\b` needs a **non-word** character before the term, and both
dominant naming conventions supply a word one: `apiToken` (camelCase) and `api_token` (`_` is a word
character). Measured exempt: `apiToken`, `accessToken`, `refreshToken`, `api_token`, `clientSecret`,
`client_secret`, `devicePin`, `userSsn`, `cardCvv` — written verbatim into saved flows. The hole hit
every `\b`-anchored term, not just tokens; hyphenated names worked only because `-` isn't a word char.

Fixed by normalizing the haystack (split camelCase, `_` → space) rather than dropping the anchors —
dropping them redacts `shipping` and `tokenizer_label`, and over-redaction silently discards values
the user needs. Both directions asserted.

**Two things this cost, worth remembering:**

1. **Extending the shared `/recorder-lab` broke REC-018.** Adding password/OTP inputs made the whole
   page read as a protected login surface, so the detector paused every recording on it — including
   REC-018's, which went 41/41 → fail. Moved to a dedicated `/recorder-sensitive` page. "Prefer
   extending an existing page" stops applying when the addition changes the page's security
   character.
2. **I misread the same evidence twice.** `isRecording:false, actionCount:1` was the detector
   pausing; a later run showed `isRecording:true` and I concluded the detector had stopped firing —
   it was just a timing race against an 8 s settle. The fix was to assert the handoff phase
   (`handoff.phase="detected"`) instead of inferring from a status flag read at one instant.

**Tests run:** `verify:recorder-redaction` **15/15** (new) · `verify:recorder` **97/97** (was 78) ·
`verify:recorder-e2e` 41/41 · `verify:recorder-draft` 17/17 · `verify:recorder-flow` 19/19 ·
`verify:protected-login-recorder` 45/45 · `verify:mock-site` 90/90 ·
`verify:verifier-classification` reconciled · `build` PASS.

**Ledger: 37 → 36 `NOT RUN`.** Recorder 11 → 12 PASS. **Phase 1 (security/P0) is complete.**

---

## 2026-07-26 - SYS-REP-015: refusals were not recorded (Claude)

**Task:** close SYS-REP-015, whose only remaining subcase was "denied attempts are audited".

**It was a real gap, not a test gap.** `appendAudit` was wired into branding, licensing, user admin
and authentication only — never into the Reports/telemetry permission checks. Unauthorized reads
were correctly *rejected*; nothing recorded that they happened.

**Fix — `AWKIT-REP-003` (S3).** `assertSenderPermission` gained an opt-in `audit` descriptor; report
and telemetry channels pass one. Denials append a row with the channel, required permission, reason
and actor. Opt-in per channel rather than global, so polling volume stays a deliberate choice.

**Three things I had to get right, and one I nearly got wrong:**

1. **Validate the session exactly once.** Naming the actor on a denial needs the resolved user, but
   `sessions.validate()` calls `touchSession` — a second call would have let a *rejected* request
   slide the idle expiry it was just refused under. Extracted `AuthorizationService.resolveActor`;
   `requirePermission` is now defined in terms of it, so there is still one implementation.
2. **Never write a caller-supplied argument** into the log; asserted directly with the report id the
   denied call carried.
3. **Auditing never throws** — an unwritable trail must not suppress the denial.
4. **`verify:ipc-contract` caught my refactor.** Fusing telemetry registration+authorization into
   `handleReportsRead(channel, handler)` hid 18 channels from the contract verifier's static scan —
   203 → 185 handlers, 4/4 → 3/4. Its "registered but unexposed and undocumented" check would have
   failed **open**. Taught the scanner about the registrar; back to 4/4 at 203.

**One assertion of mine was wrong:** I expected an audit row for `reports:list`, but the preload's
`reports.list()` invokes `report:list` (singular). The product was right; the test was wrong.

**Tests run:** `verify:reports-populated-gui` **74/74** (was 66) · `verify:settings-e2e` 116/116 ·
`verify:e2e-rbac` 51/51 · `verify:e2e-reauth` 19/19 · `verify:reports` 31/31 · `verify:authz` 40/0 ·
`verify:auth` 49/0 · `verify:security` 39/0 · `verify:telemetry` 61/61 · `verify:observability` 65/0
· `verify:ipc-contract` 4/4 · `verify:recorder-authz` 44/0 · `tsc --noEmit`, `build`,
`typecheck:scripts` PASS.

**Ledger: 38 → 37 `NOT RUN`.** Reports 6 → 7 PASS.

---

## 2026-07-26 - REC-028: the Recorder had no authorization at all (Claude)

**Task:** begin completing the 39 `NOT RUN` cases in `RECORDER_REPORTS_SETTINGS_TEST_CASES.md`,
security and P0 first.

**Predicted from source before writing a test.** `app/main/ipc/recorder.ipc.ts` registered all 13
handlers as `async (_, …)` — the `IpcMainInvokeEvent` was discarded, so no handler could identify its
sender. Meanwhile `Permission.PAGE_RECORDER` existed and was enforced **only** in the renderer route
table. `report.ipc.ts` carried 8 `assertSenderPermission` calls and `settings.ipc.ts` 11 after their
own campaigns; the Recorder carried zero.

**Reproduced, not assumed.** New `npm run verify:recorder-authz` (real Electron, isolated profile)
probes all 11 preload-reachable `recorder:*` channels with no bound session, as a Viewer, as an
Operator, and after sign-out. Pre-fix: **3 PASS / 26 FAIL**. With **no session at all**, `saveUrl`
persisted URL history, `saveFlow` **created a real flow** (bypassing the `workflow.create` check that
`flows:create` enforces on the same store), and `start` launched and navigated a browser. The hidden
nav entry was the only thing withholding the Recorder from a Viewer.

**Fix — `AWKIT-REC-001` (S1).** Every handler now takes `event` and calls `assertSenderPermission`.
Operating the Recorder requires `page.recorder`; `saveFlow` additionally requires `workflow.create`.
Session revocation is covered for free — `assertSenderPermission` unbinds on `SESSION_EXPIRED`.
Post-fix: **44 PASS / 0 FAIL**.

**Two verifier design points that mattered.** Denials assert the *reason* (`NOT_AUTHORIZED`), not that
a promise rejected — two channels fail for unrelated business/navigation reasons and would otherwise
have read as "secure". And every mutation probe asserts the **absence of the side effect**, because
"it threw" and "it changed nothing" are different claims.

**Tests run:** `verify:recorder-authz` 44/0 · `verify:recorder-e2e` **41/41** (the authorized journey
still works end to end) · `verify:recorder` 78/0 · `verify:recorder-draft` 17/17 ·
`verify:recorder-flow` 19/19 · `verify:e2e-rbac` 51/51 · `verify:authz` 40/0 · `verify:security` 39/0
· `verify:ipc-contract` 4/4 · `verify:verifier-classification` reconciled **139** · `build` and
`typecheck:scripts` PASS.

**Ledger: 39 → 38 `NOT RUN`.** Recorder 10 → 11 PASS.

**Filed:** `awkit-7lj` — `flows:list`/`get`/`export` are unauthenticated reads in the same style
(out of REC-028's scope, recorded not silently changed); `session.ipc.ts` and `instance.ipc.ts` also
have zero sender checks. `awkit-38k` — the Recorder campaign's remaining 17 cases, which had no bead
at all while Reports and Settings did. Closed `awkit-gi2` (REC-018).

---

## 2026-07-26 - Oracle soak: the harness was measuring itself (Claude)

**Task:** investigate `awkit-q0e` (Node peak RSS growing ~5× within a soak, 2472 MB peak), then fix.

**Finding — there was never a product leak.** Two causes, both in the harness:

1. `benchmark-oracle-jdbc.mts` pushed one element into `latencies` **per query**, unbounded. Measured
   at 18.2M queries: 502 MB of live data (survives a forced GC) against a 30 MB baseline. Worse, the
   60 s sampler ran `[...latencies].sort()` **every minute** — a ~500 MB copy-and-sort per tick.
2. `process.memoryUsage().rss` is the Windows **working set**, trimmed by the OS independently of the
   process. Measured: array live → `rss=499 MB / heapUsed=470 MB`; after a `SetProcessWorkingSetSize`
   trim → `rss=5 MB` with `heapUsed` **unchanged** and the array still live. RSS fell 99 % with zero
   change in live heap — which is why `2472 → 245 MB` in 60 s never reconciled.

**Fix (`c6d4547`):** new `scripts/lib/latency-histogram.mts` (1 ms buckets to 10 s, 100 ms to 100 s,
overflow bucket, exact max; ~87 KB flat — 18.2M samples cost 0 MB) with the same nearest-rank
indexing as the old `pct()`, so historical values stay comparable. The verdict moved to `heapUsed`;
RSS is retained as a labelled diagnostic. **150 MB budget unchanged** — signal changed, tolerance
did not. Both series go into the artifact.

**Tests run:** histogram controls (equivalence vs the old `pct()` on empty/single/realistic/uniform/
36.7 s outlier/10 s boundary, documented degradations asserted directly, O(1) memory at 18.2M) — all
pass. `typecheck:scripts` PASS. **Full 30-min soak 9 PASS / 0 FAIL**: 23,458,521 queries at 13,030/s,
heap floor 11 → 8 MB (−3), peak 24 MB; RSS flat 78 → 78 MB, peak 80 MB; bridge 194 → 193 MB.

**Same workload, before vs after:** peak RSS **2472 → 80 MB**, throughput **9,746 → 13,030/s (+34 %)**,
max latency **36,727 → 4,681 ms**. The harness was burning a third of the machine on its own
accounting, and the multi-second outliers were GC pauses from the per-minute sort.

**Recorded rather than overstated:** with the harness fixed, RSS is stable enough to have carried the
verdict. `heapUsed` is still the right signal (a trim can corrupt RSS; heap cannot be trimmed), but
cause 1 was dominant — cause 2 explains why the numbers never reconciled, not why the gate broke.

**Also:** one earlier soak was killed at t+2.2m when a background process exited, and its partial run
had already overwritten the canonical artifact with a 4-minute result. Filed as `awkit-1ts` (P3).

**Files:** `scripts/lib/latency-histogram.mts` (new), `scripts/benchmark-oracle-jdbc.mts`,
`docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md`, `docs/testing/comprehensive-validation/EXECUTION_RESULTS.md`.

---

## 2026-07-26 - Packaged gate re-verified after the Recorder/Reports/Settings work (Claude)

**Task:** rebuild the portable package and re-run the packaged walkthrough, which had gone stale once
the Reports and Settings units landed.

**Why it was needed:** the staleness guard from `94c858e` refused to run, naming
`app\renderer\components\shared\ConfirmDialog.tsx` (09:52) as newer than the packaged payload
(00:09). The guard fired correctly on work it was not written for.

**Done:** `npm run package:portable` PASS (`app.asar` 03:09 → 15:08; `package-portable.ps1:3` runs
`npm run build` itself, so the bundles cannot be stale). Fixes confirmed present in
`out/main/main.js` before running the gate — `Settings failed validation` ×2, `retainKnownKeys` ×9,
`Appearance must be light` ×1, `manual-approval connector to` ×1.

**Tests run:** `npm run verify:packaged-walkthrough` **70 passed, 0 failed**, including the
`packaged payload is at least as new as src/ and app/` precondition. First packaged run covering the
whole session together: `manualApproval` routing + Reports authorization/export + Settings
authorization and main-process validation.

**Files:** `resources/dependency-manifest.json` (regenerated `builtAt`, produced by packaging, not
hand-edited), `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`,
`docs/testing/comprehensive-validation/EXECUTION_RESULTS.md`.

**Not run / still open:** `benchmark:oracle-jdbc` remains RED (`awkit-cww`); 41 of 66 focused cases
remain `NOT RUN`; `ORA-LIVE-001` still blocked and still lacks a real-mode path; the clean/offline VM
walkthrough remains a separate human gate that this script explicitly does not claim.

---

## 2026-07-26 - AWKIT-E2E-001: manualApproval connector routing (Claude)

**Task:** Phase 0-1 of the unified validation remediation brief — reproduce and fix the one confirmed
open product defect, then re-run the comprehensive campaign. Bead `awkit-3eo` (newly filed; the defect
had been tracked only in `DEFECTS.md`, never in Beads).

**Defect:** `FlowExecutor.resolveNext` had no `manualApproval` case, so a `manualHandoff` node whose
only outgoing edge was `manualApproval` dead-ended — the flow reported `passed` and End never ran. A
report could therefore claim success for a business process that stopped early.

**Fix (`src/runner/FlowExecutor.ts`):** a `manualApproval` case immediately before the
`success`/`always` fallback, gated on `stepResult.outcome === "manualContinued"` (set by
`StepExecutor` exactly when an operator continued a handoff; a cancel throws and fails the step
first). Plus a guard: routing that dead-ends at a node with an ungranted `manualApproval` edge now
finishes `failed` naming the step and skipped target, rather than `passed` — otherwise the same
silent-success symptom just relocates. `sessionCaptured` deliberately does **not** enable the edge;
`PlaywrightRunner.resolveNextFlow` (workflow level) was deliberately left unchanged.

**Regression written before the runtime change** (`scripts/verify-runner.mts`, +5 checks, 84 → 89):
exact node sequence `start,approve,approved-work,end`; approved downstream work observed in the live
DOM; cancelled handoff does not traverse; an ordinary node does not traverse; no `passed` when an
unapproved continuation is skipped. It failed 3/5 before the fix and passes 5/5 after — the two
negative controls passed both times, so the coverage is negative-controlled, not vacuous.

**Files:** `src/runner/FlowExecutor.ts`, `scripts/verify-runner.mts`, `docs/ai/CURRENT_STATE.md`,
`docs/ai/TESTING.md`, `docs/ai/TASK_LOG.md`, `docs/ai/HANDOFF.md`, and the validation package
(`DEFECTS.md`, `EXECUTION_RESULTS.md`, `READINESS_SUMMARY.md`).

**Tests run:** `verify:runner` **89/0** · `verify:comprehensive-e2e` **9 PASS / 0 FAIL** ·
`verify:concurrency` 78/0 · `verify:waits` 56/0 · `verify:popup` 12/0 · `verify:cancellation` 12/0 ·
`verify:artifacts` 13/0 · `verify:flow-step-mapping` 101/0 · `typecheck` PASS ·
`typecheck:scripts` PASS. Evidence: `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/`.

**Packaged gate closed in the same pass.** `dist/win-unpacked` predated the fix and
`scripts/verify-packaged-walkthrough.mts` had **no staleness guard**, so running it as-found would
have exercised the pre-fix bundle. Both were addressed: `package:portable` rebuilt (asar 03:09,
portable EXE 03:13), the fix confirmed present in `out/main/main.js`, and
`verify:packaged-walkthrough` re-run at **70/70** (69 + a new precondition check that refuses a
packaged tree older than `src/` or `app/`). The guard was negative-controlled — touching
`src/runner/FlowExecutor.ts` made it exit 1 with a precise STALE diagnostic, and the file was then
confirmed byte-identical to its pre-test copy and to `HEAD`.

**Not started:** Phases 2-7 of the brief — Oracle live gates (`awkit-7bu`, blocked on an authorized
operator), the three deterministic fixture packages, and the 46 `NOT RUN` Recorder/Reports/Settings
cases (`awkit-gi2` REC-018, `awkit-az7` Reports, `awkit-8ri` Settings). `AWKIT-E2E-001` itself had no
Beads record before this pass — it existed only in `DEFECTS.md`.

**Note:** commit `cbc1c59` (the unified remediation prompt) landed on `main` from another session
while this work was in progress; it touched only `docs/`, and nothing here was overwritten.

---

## 2026-07-26 - Oracle mock-UI gate re-verification + negative control (agent)

**Task:** handoff preparation — establish verified repository state and re-run the Oracle mock-UI gates.

**No source changes.** `git diff HEAD` is empty for all code, scripts, and `docs/ai/`. The Oracle
mock-UI fixture, its database-free twin, and `verify:oracle-mock-ui` were already delivered by
`cfe4594`; this pass confirmed them at `HEAD` rather than re-authoring them.

**Repo state:** branch `main`, HEAD `d43dfa6` == `origin/main` (nothing to push), tree clean except
`.beads/*.jsonl`.

**Tests run:** `verify:oracle-mock-ui` **36/36**, `verify:oracle-bridge` **32/32**, `npm run build`
PASS, `scripts/ai-memory/check-memory.mjs` PASS.

**New evidence — the suite is not vacuous.** A deliberate-drift control (one fixture country `AE` → a
non-existent `ZZ`) failed exactly two checks with precise diagnostics (option fit, and SQL↔mock
parity), then returned to 36/36 after the file was restored byte-identical. Previously the suite's two
central claims — that the SQL fixture and its DB-free twin cannot drift, and that fixture values are
still real `/form` controls — had no demonstrated failure mode.

**Not run:** real-Oracle provisioning of `SPECTER_MOCKUI` (needs an authorized operator with SYSDBA and
an out-of-band ephemeral reader password); the live-Oracle workflow case stays BLOCKED.

**Housekeeping:** bead `awkit-v8x` was opened and closed for work `cfe4594` had already delivered — a
duplicate record. `.beads/*.jsonl` is the only dirty path; reconcile before the next sync.

---

## 2026-07-26 - Recorder, Reports, and Settings remediation prompt (Codex)

**Task:** write a complete coding-agent prompt that carries forward all three focused test outcomes,
observations, defects, and open release gates.

**Delivered:** `RECORDER_REPORTS_SETTINGS_REMEDIATION_PROMPT.md`, covering the 66-case baseline,
confirmed `AWKIT-E2E-001`, exact code surfaces, deterministic fixtures, phased implementation,
security/manual-handoff boundaries, required regression commands, evidence, acceptance criteria, and
final reporting contract.

**Status rule:** the prompt treats `NOT RUN` as missing validation, not a product defect; production
changes require a reproduced failure. REC-022 remains manual/blocked unless approved human input is
provided.

---

## 2026-07-26 (latest) - Recorder, Reports, and Settings focused cases (Codex)

**Task:** add missing comprehensive cases for Recorder, System Reports, and Settings, emphasizing the
Recorder's complete user and security lifecycle.

**Delivered:** `RECORDER_REPORTS_SETTINGS_TEST_CASES.md` with 29 Recorder, 16 System Reports, and 21
Settings cases; updated the main plan, case index, traceability matrix, execution ledger, readiness
decision, current state, and handoff.

**Fresh passes:** Recorder 78/78, flow 19/19, draft 17/17, async review 21/21, protected detection
45/45, HTTPS runtime 49/49, popup identity 43/43, random round-trip 26/26; Reports GUI 31/31,
telemetry 61/61, observability 65/65; Settings persistence 3/3 (isolated root), capacity GUI 12/12,
HTTPS GUI 31/31, secrets 16/16, accent 33/33, branding 30/30, Database Drivers GUI 30/30.

**Open:** REC-018 full Recorder page record→save→reopen→production replay; populated Reports GUI
truth/drill-down/export/path authorization; Settings paths/general validation/Secrets GUI/import/
reset-data-preservation/RBAC/accessibility. Manual protected login remains `BLOCKED`.

---

## 2026-07-26 (latest) - Oracle row-driven form workflow and ExecutionEngine validation (Codex)

**Task:** finish the step left open by the mock-UI Oracle fixture: author persisted Data Source/flow/
workflow profiles, execute them against the Feature Test Lab, collect evidence, and keep the real-DB
variant credential-gated.

**Delivered:** `mock-oracle-form-cases.json`, `mock-oracle-form-flow.json`,
`mock-oracle-form-workflow.json`, and `verify-oracle-mock-ui-workflow.mts`. The verifier builds/spawns
the real Java bridge in explicit development mock mode, drives `OracleQueryService` and
`DataSourceResolver`, checks one single-flight query, verifies all 8 rows in real Chromium, exercises
stale checkbox cleanup and native required-terms blocking, and repeats all rows through the production
`ExecutionEngine` with a two-instance cap.

**Product gaps found and fixed:** scheduled `currentDataRow` was not passed to runner `currentRow`;
structured connectors could not resolve `currentRow.*`; Oracle DATE instants were incompatible with
HTML date inputs. The mock form also claimed terms were required without the HTML `required` attribute.

**Result:** Oracle campaign **7 PASS / 0 FAIL / 1 BLOCKED**. Production engine: 8 completed instances,
maximum 2 active, run report + 8 JSONL logs + 16 screenshots. Live 19c was not executed without the
operator's ephemeral credential. Evidence:
`test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/`.

**Regressions:** fixture 36/36, bridge 32/32, runner 84/84, concurrency 78/78, mock site 84/84,
taxonomy 134/134, script type-check and build PASS. The broader comprehensive campaign remains
8 PASS / 1 FAIL on the pre-existing `manualApproval` routing defect; evidence:
`test-artifacts/comprehensive-e2e/2026-07-25T22-37-55-841Z/`.

---

## 2026-07-26 (latest) - mock-UI Oracle fixture: SPECTER_MOCKUI + database-free twin (Claude)

**Task:** give Oracle a fixture that tests the *UI path*, not just type conversion — a schema whose
columns drive the Feature Test Lab form at `/form`, plus a database-free twin so it runs offline.
Bead `awkit-v8x`.

**Gap it closes:** `SPECTER_FIXTURE.AWKIT_TYPES_TEST` proves the JDBC mapper handles Oracle types. It
proves nothing about the Oracle Data Source node *driving a workflow*. `SPECTER_MOCKUI.MOCK_FORM_CASES`
(8 rows) maps 1:1 onto `/form`, so `SELECT → fill form → assert /success` is now testable.

**Two conversions the mock had to mirror rather than hardcode** (found by reading
`OracleJdbcQueryExecutor.convert`, not assumed):
1. `NUMBER(12,2)` returns `BigDecimal.toPlainString()` — a **String** like `"82500.50"`, not a JSON number.
2. `DATE` returns `Timestamp.toInstant().toString()`, which reads the timestamp in the **JVM default
   zone**. A hardcoded `"1992-04-17T00:00:00Z"` would disagree with a real DB on any non-UTC host, so
   `MockFormCasesFixture` applies the same `Timestamp`→`Instant` conversion instead.

**Files:** `scripts/oracle/local-19c-mock-ui-fixture.sql` (new), `MockFormCasesFixture.java` (new),
`MockQueryExecutor.java` (fixture branch + `fixtureResult` honoring `maxRows`/cancellation),
`scripts/verify-oracle-mock-ui.mts` (new), `package.json`, `mock-site/README.md`,
`ORACLE_JDBC_VALIDATION_GATES.md`, `COMMANDS.md`, `CURRENT_STATE.md`.

**Tests run:** `verify:oracle-mock-ui` **36/36** (builds and drives the real Java bridge),
`verify:oracle-bridge` **32/32** (generic mock shape unchanged), `npm run build` clean.
**Negative control:** flipping one fixture country to `ZZ` failed exactly 2 checks with precise
diagnostics (option fit + parity) — the checks are not vacuous.

**Not run:** the real-Oracle provisioning of `SPECTER_MOCKUI` (needs SYSDBA + an ephemeral
`SPECTER_READER` password; procedure in `ORACLE_JDBC_VALIDATION_GATES.md`), and the end-to-end
workflow itself (no flow authored yet — the fixture and both executors are the groundwork).

---

## 2026-07-25 - the orchestrator bound to the real generation runtime (Claude)

**Task:** finish Phase 1B production integration — bind `SemanticRebuildOrchestrator` to the real
generation lifecycle, define the post-activation failure policy, wire bounded shutdown, and verify
through the real host on all three layouts.

**Commit:** `27d93d1` `fix(semantic): bind the rebuild orchestrator to the real generation runtime`.

`src/semantic/SemanticIndexRuntime.ts` owns the ACTIVE store, the mutation queue and the transition
between generations. `verify:semantic-rebuild-live` (new) drives orchestrator → generation filesystem
→ `ZvecSemanticStore` → `ZvecUtilityHostManager` → `utilityProcess` → raw host → real Zvec.

**Two defects a lifecycle stub could not express — both made the production rebuild path unusable:**

1. **The rebuild path could never have run.** `createGeneration` allocates by `mkdir` without
   `recursive` (its atomic claim on the name), so every real candidate reached the host as an existing
   EMPTY directory. Measured vendor behaviour: `ZVecCreateAndOpen` throws `path validate failed` for
   *any* existing directory; `ZVecOpen` needs a real collection. So an empty directory could be
   neither created into nor opened, and populate failed every time. Fixed in the host with three
   cases and `rmdirSync` (never `rm -r`, so it can only discard a directory holding nothing). The
   contract suite missed it because it invents names whose directories do not exist.
2. **A rebuild overlapping a delete could never activate.** Post-replay validation sampled the
   snapshot and asserted presence, so a correct post-watermark delete read as corruption
   (`SEMANTIC_REBUILD_SAMPLE_MISSING`). Replay now reports touched ids/entities and validation
   excludes them — the snapshot is authoritative only for documents the delta did not change.

**Post-activation policy:** the pointer swap is irreversible, so a failure past it never reverts the
pointer and never resumes writing to the previous generation. Writes stop, the queue is preserved, a
bounded reopen runs, health reports `ACTIVE_GENERATION_OPEN_FAILED`. Enforced structurally — the queue
is retargeted onto a store that refuses every operation.

**Bounded shutdown:** `disposeSemanticSubsystem` drains queue + rebuild before stopping the host;
`main.ts` races it against 3s. A deadline miss deliberately skips `markIndexClosed` so the session
stays unclean and startup reconciles.

**Two defects in the new verifier's own fault injection** were fixed before it could be trusted: it
matched request types the store does not send (`insert`/`stats` rather than `upsert`/`count`), so both
failure arms were no-ops silently exercising a *successful* rebuild; and a second runtime over the
same root collided on `SEMANTIC_COLLECTION_ALREADY_OPEN`.

**Verified:** `build` · `tsc --noEmit` · `typecheck:scripts` · `verify:semantic-rebuild-live` **23/0**
(62 assertions) · `verify:semantic-rebuild` **64/0** · `verify:semantic-zvec-native-contract` 21/0 ·
`verify:semantic-store` 151/0 · `verify:semantic-queue` 70/0 · `verify:semantic-policy` 141/0 ·
`verify:semantic-zvec-filter` 89/0 · `verify:zvec-generation-lifecycle` 102/0 ·
`verify:zvec-generation-recovery` 134/0 · `verify:zvec-generation-concurrency` 12/0 ·
`verify:zvec-host-lifecycle` 52/0 · `verify:zvec-host-source-boundary` 22/0 ·
`verify:source-hygiene` 7/0 · `verify:verifier-classification` reconciled.

**Next:** product surface — authorized semantic service → RBAC → preload/API → projections → Settings
controls → search UI. Nothing registers a runtime yet, so shutdown has nothing to drain.

---

## 2026-07-25 - verified and committed the blocked tranche (Claude)

**Task:** continue the previous session, which ended with uncommitted, never-compiled work after its
shell tooling became unavailable. Verify it, fix what was broken, commit and push.

**Commits (pushed; `origin/main` = `67835cd`):**
`d208c64` `fix(semantic): align real utility-host store protocol` ·
`67835cd` `feat(semantic): rebuild with watermark and ordered delta replay`.

**The previously-unverified work compiled clean**, so the outage cost verification, not correctness —
with three exceptions, all found by *running* the two new verifiers for the first time:

1. **A real orchestrator bug.** Delta completeness was judged against the live journal, so a mutation
   accepted while the replay was in flight counted as unreplayed and failed the rebuild — a busy index
   could never complete one. Such a mutation is necessarily still pending (draining is paused) and
   drains against the new generation, so completeness is now judged against the captured entry set.
   Covered by a regression test that injects a write from inside the replay.
2. **A negative control asserted the wrong invariant** — it required `queue.size` to be unchanged
   across a failed rebuild, which a *correct* implementation must fail, since draining before the
   watermark is what makes the watermark meaningful.
3. **A negative control was vacuous** — the replay-failure test declared its `populated` flag inside
   `openCandidate`, so it reset on the second open and the control passed while exercising nothing.

Also corrected the native-contract suite-size floor from `>= 100` to `>= 68` (the measured full size
of `runSemanticStoreContract` with `entityOperations`); the original figure had been written before
that verifier was ever executed, and it failed a suite that had in fact run completely.

`scripts/tmp-probe-write.mts` (the temporary charset diagnostic) was deleted; its findings are
recorded in `ZvecSemanticStore.ts`.

**Verified:** `build` PASS · `tsc --noEmit` PASS · `typecheck:scripts` PASS ·
`verify:semantic-zvec-native-contract` **21/0** (real Electron `utilityProcess`, staged raw host, real
Zvec binding; shared contract suite 68/68) · `verify:semantic-rebuild` **56/0** (opened at 42/5) ·
`verify:semantic-store` **151/0** · `verify:semantic-queue` **70/0** · `verify:semantic-zvec-filter`
**89/0** · `verify:semantic-policy` **141/0** · `verify:zvec-generation-lifecycle` **102/0** ·
`verify:zvec-generation-recovery` **134/0** · `verify:zvec-generation-concurrency` **12/0** ·
`verify:zvec-host-source-boundary` **22/0**.

**Packaged validation then completed** (`5311d57`, `002e684`). A fresh portable + NSIS build:
`verify:zvec-packaged-assets` 17/17 · `verify:semantic-zvec-native-contract` **21/0 against the
packaged tree** · `verify:zvec-packaged-live` **35/0** · `verify:zvec-coexistence` 16/0 · **NSIS
installed layout 35/0**, installed per-user unelevated then uninstalled clean (host tree gone, HKCU
key cleared, no residue — machine left as found). `dependency-manifest.json` now records
`hostProtocolVersion: 2`.

Two more defects surfaced there, both the same shape as the rest of this tranche:

- **A shipped check had been vacuous since protocol v2.** `query` changed from `{ hits }` to
  `{ docs, totalMatched, ... }`; the packaged harness still read `r.hits`, and `if (r.hits === 0)
  throw` is false when `hits` is `undefined`. `ftsQueryMatches` asserted nothing for a whole protocol
  version — only its negative twin failed loudly enough to expose it (`packaged-live` 33/2 → 35/0).
  **When a reply shape changes, grep every reader of the removed field: such a check fails OPEN.**
- **`whenIdle()` was bounded in iterations but not in time**, so a wedged rebuild would have held
  shutdown open forever. Now takes a deadline (default 30s) and returns `false` when it wins. The
  first attempt `unref`'d the timer, which is backwards while the race is pending — the runtime
  exited mid-await (Node exit code 13) instead of reporting the deadline. `verify:semantic-rebuild`
  56/0 → **61/0**.

**Not run:** `validate:offline`, `verify:runner`, mock-site verifiers, signing/SmartScreen, and the
clean-machine walkthrough (optional/non-blocking by owner policy).

**Lesson worth keeping:** a verifier that has never been executed is not evidence. Both new verifiers
contained assertions wrong in the direction of *passing*.

**Next:** wire the orchestrator to a real generation root (bd `awkit-9yv` is satisfied). `whenIdle()`
still has no production shutdown caller.

---

## 2026-07-25 - derived entityKey, real-host contract verifier, rebuild orchestration (Claude)

**Task:** owner review correction to the filter work (bd `awkit-8lj`), then bd `awkit-9yv` (contract
through the real host) and bd `awkit-ttd` (rebuild orchestration).

**Commits (all pushed; `origin/main` = `a1e6bc8`):** `a1e6bc8` derived `entityKey`. Earlier the same
session: `f4f6a37`, `5f6250a`, `72e63fe`.

**⚠️ The session ended with UNCOMMITTED, UNCOMPILED work in the tree.** The host's shell-command
approval service became unavailable part-way through and did not recover, so no `tsc`, verifier, `git`
or memory-gate run was possible after that point. Nothing unverified is recorded here as passing.
**RESOLVED by the entry above** — that work is now verified and pushed as `d208c64` + `67835cd`.

**1. The refusal-based filter design had an operational gap (owner-identified, correct).** Refusing an
unrepresentable filter value is fail-closed, but it leaves a legitimate entity permanently
undeletable. Fixed by deriving `entityKey = sha256(kind U+0000 NFC(entityId))` — alphabet always
`[0-9a-f]{64}` — and matching `entityKey IN (one key per kind)`. Raw `entityId`, `revision` and
`nodeId` were removed from the filter allowlist in both the TypeScript source and the host's
independent copy. The key is factory-computed and **recomputed-and-compared** on read, so a
well-formed key belonging to another entity or kind is rejected (`INVALID_ENTITY_KEY`) rather than
allowed to delete the wrong documents.

**Negative control, which is what made the gap concrete:** with raw-`entityId` filtering restored the
contract suite fails 23 checks, and they split into both bad outcomes —
`C:\Users\name\item` → refused with `WRITE_FAILED` (undeletable), while `single'quote` →
`removed=0` (a silent no-op that reports success). The second is the worse one.

**2. Driving the store through the REAL host found three more defects the fake had concealed.** This
is the single most valuable result of the session, and it validates building the verifier at all:

- `open` returned `{generation}` while the adapter read `collectionId` → `BACKEND_UNAVAILABLE` for a
  collection that had opened fine.
- **Zvec rejects `:` in a document primary key, and AWKIT ids are `kind:component:hash` — so no
  document could ever have been written to a real index.** Every test passed because the fake used a
  `Map`, which accepts any string as a key. Fixed by deriving the backend key and keeping the AWKIT id
  in the `id` field (colons are legal in a field value; only the key is restricted).
- `fts: {}` is rejected rather than treated as match-all, so every filter-only search would have
  failed. (This third fix is UNVERIFIED — written after the outage began.)

**Lesson worth keeping: a fake that is more permissive than the real backend relocates risk rather
than reducing it.** All three defects came from the fake encoding the protocol as *intended* while the
host implemented something else. `FakeZvecHostTransport` now reproduces the binding's rejections
(key charset, explicit `null`, empty full-text clause), not just its shapes.

**3. A stale host tree silently produces a false result.** The new verifier's first run picked
`dist/win-unpacked`, which still held the protocol-v1 host, and so tested code that no longer existed.
It now refuses any tree that is not byte-identical to `native-hosts/zvec/zvec-host.cjs` — a stale tree
whose behaviour happens to match would otherwise report a confident PASS for a host never built.

**4. Rebuild orchestration (`awkit-ttd`) — written, UNVERIFIED.** Watermark + ordered delta journal:
drain, take watermark W, populate the candidate from a snapshot at W while normal mutations continue
against the active generation and are journalled, validate, pause draining, replay the post-W delta
into the candidate, revalidate, close, swap the pointer, retarget, resume, and only then clear
`rebuildRequired`. `queue.clear()` is never called on activation — that is precisely what would
discard a user's mid-rebuild changes. A journal that hits its bound refuses activation instead of
replaying a partial delta.

**Files:** `src/semantic/{ZvecSemanticStore,FakeZvecHostTransport,SemanticMutationQueue,
SemanticPolicyValidator,SemanticStore,SemanticStoreContract,InMemorySemanticStore}.ts`,
`src/semantic/contracts/{SemanticDocument,ZvecFilter}.ts`,
`src/semantic/SemanticRebuildOrchestrator.ts` (new), `native-hosts/zvec/zvec-host.cjs`,
`scripts/verify-semantic-{policy,zvec-filter,rebuild,zvec-native-contract}.mts` (last two new),
`scripts/zvec-harness/harnessMain.ts`, `scripts/lib/verifier-classification.ts`, `package.json`.
Also `scripts/tmp-probe-write.mts` — a temporary diagnostic that must be deleted.

**Tests run — at `a1e6bc8` only:** `build` PASS · `typecheck:scripts` PASS ·
`verify:semantic-zvec-filter` **89/0** (real binding) · `verify:semantic-store` **151/0** ·
`verify:semantic-policy` **141/0** · `semantic-queue` 70/0 · `source-hygiene` 7/0 ·
`zvec-host-source-boundary` 22/0 · `zvec-host-lifecycle` 52/0 · `zvec-generation-recovery` 134/0 ·
`zvec-generation-lifecycle` 102/0 · `verifier-classification` reconciled · memory gate PASS.
`verify:semantic-zvec-native-contract` reached **19/2** against the staged tree mid-session; its two
failures are the defects described above, two of which are fixed and verified and one of which is not.

**NOT run:** `npx tsc --noEmit` and every verifier after the outage; `verify:zvec-packaged-live`;
`package:portable`; the NSIS installed-layout matrix; `validate:offline`; `verify:runner`; mock-site
verifiers; `node scripts/ai-memory/check-memory.mjs` (this handoff could not execute it).

**Result:** `awkit-8lj` remains CLOSED. `awkit-9yv` is partially addressed — the contract now runs
through a real `utilityProcess` against the **staged** tree, but not against the packaged or
NSIS-installed layouts. `awkit-ttd` is implemented but unproven.

---

## 2026-07-25 (later) - Zvec typed filters, host protocol v2, entity operations (Claude)

**Task:** bd `awkit-8lj` — remove the 100-document ceiling that made `deleteByEntity`, `stats` and
`clear` refuse. **The recorded premise was wrong**, which is the main finding.

**Commits:** `f4f6a37` (typed filters, protocol v2, entity operations), `5f6250a` (exact
`totalMatched` + the contract check that proves it).

**The premise.** The previous round concluded from the vendor's TypeScript types that there was "no
scan or cursor operation" and declined to guess at the API. Reading the types was the mistake:
`deleteByFilterSync` exists, `ZvecQuery.filter` pre-filters before ranking, and the 100 cap was
AWKIT's own `Math.min(topK, 100)` in `zvec-host.cjs`. Established by executing the real binding in a
throwaway collection, not by inference. **Lesson worth keeping: when a vendor capability decides an
architectural conclusion, probe the binding — a `.d.ts` is not a capability inventory.**

**Three defects the transport fake could not catch,** because it encoded the protocol as *intended*
while the host implemented something else: (1) a `nullable` string field rejects an explicit `null`,
so `toZvecDocument`'s `?? null` would have had the real host reject every document with an absent
optional; (2) `fetch` returned bare id strings while the adapter read `.id`; (3) `SEMANTIC_SCHEMA`
used `type:` where the host reads `dataType`, hidden by an `as unknown as` cast. The fake now
reproduces the binding's rejections rather than being more permissive than it.

**Escaping — measured, not assumed.** No escaper is correct for arbitrary strings: escaping only
quotes throws a lexer error on backslash values; escaping both **silently matches nothing** (status
`ok: true`, zero rows deleted); single-quote doubling matched the *wrong document*. So filter values
are **refused** when they hold a backslash or control character, and the whole expression is built
inside the host from a typed clause list — a filter string never crosses `SemanticStore`.

**Testing notes worth keeping.**
- The pre-filter claim is asserted *with its negative control in the same run*: without the filter,
  `topk: 10` does not reach the needle ranked last of 1501; with it, the same `topk` finds it.
- **The existing `totalMatched` assertion was vacuous.** `topK: 1` over a three-document fixture
  compares "candidates fetched" against "documents matched" — the same number — so it passed with
  the defect present. Only a fixture larger than the 100-row fetch window discriminates; 130
  documents now do. Verified by negative control (reports 100, fails).
- Drift checks on the host's duplicated builder were negative-controlled individually: adding a field
  to the host allowlist, deleting the post-delete re-scan, and restoring the 100 cap each fail their
  own assertion and only that one.
- I introduced a literal NUL into a new verifier while writing a check *about* control characters —
  the trap `verify:source-hygiene` exists for. Escape sequences only.

**Files:** `native-hosts/zvec/zvec-host.cjs`, `src/semantic/contracts/ZvecFilter.ts` (new),
`src/semantic/contracts/ZvecHostProtocol.ts`, `src/semantic/ZvecSemanticStore.ts`,
`src/semantic/FakeZvecHostTransport.ts`, `src/semantic/SemanticStoreContract.ts`,
`scripts/verify-semantic-zvec-filter.mts` (new), `scripts/lib/verifier-classification.ts`,
`scripts/prepare-zvec-native-host.mjs`, `package.json`.

**Tests run:** `build` PASS - `typecheck:scripts` PASS - **`verify:semantic-zvec-filter` 63/0**
(executed against the real `@zvec/zvec`) - `verify:semantic-store` 109/0 (both implementations) -
`semantic-policy` 135/0 - `semantic-queue` 70/0 - `source-hygiene` 7/0 -
`zvec-host-source-boundary` 22/0 - `zvec-host-lifecycle` 52/0 - `zvec-generation-recovery` 134/0 -
`verify:verifier-classification` reconciled at **128** (unit 49).

**Not run:** `verify:zvec-packaged-live` and the packaged/NSIS trees (need `package:portable`),
`verify:runner`, mock-site verifiers — no runner, recorder, renderer or packaging source changed.

**Result:** `awkit-8lj` CLOSED. **Residual gap, deliberately not claimed as covered:** the host's own
code path (duplicated filter builder, two-pass exact-total query, post-delete re-scan) is asserted by
source-drift checks, never executed in a real `utilityProcess`. That proof is bd `awkit-9yv`, whose
notes now carry it.

---

## 2026-07-25 - Phase 1B review corrections (Claude)

**Task:** apply the owner's review findings. Two were privacy-affecting.

**Commits:** `f36b90e` (queue ordering), `50f4f14` (projection bypass + identity + source hygiene),
`6f39c4c` (truthful counts + runtime validation).

**1. Projection bypass (critical).** `buildValidatedDocument` took a free-form `body` that
projection never saw, so a caller could pass `JSON.stringify(entireWorkflowIncludingSecrets)` and
privacy rested entirely on redaction patterns. Pipeline is now staged and branded; only per-kind
projectors can construct a `ProjectedSemanticCandidate`, and they derive everything from allowlisted
fields. The type errors this produced in the verifier were the proof: `id` and `body` are no longer
expressible.

**2. `deleteEntity` reordering (critical).** `drain()` regrouped each batch by operation type, so
`upsert X` then `deleteEntity X` ran as `deleteEntity` then `upsert` and resurrected the document.
Fixed with sequence-ordered adjacent-run batching AND an entity-supersede sweep. **Testing note
worth keeping:** the end state alone cannot discriminate the ordering fix — the sweep removes the
conflicting upsert before drain, so restoring global regrouping still passed every end-state check.
Execution order is now asserted directly against a recording store. Negative-controlled both ways.

**3. Identity.** Workflow/flow/documentation ids embedded a revision, so two revisions were two
documents and re-indexing ACCUMULATED. Kinds now declare current-state vs historical identity; ids
carry a canonical-identity hash (guarding against `idComponent` truncation collisions) and are
computed by the factory rather than supplied by callers. The contract suite had encoded the old
policy — that assertion was itself the bug.

**4. Found while fixing: Zvec entity operations were silently wrong.** `deleteByEntity` ran a
top-K full-text query for the entity id, which need not appear in indexed content at all — so it
could match nothing and report a successful no-op. The raw host also caps `query` at 100 and returns
counts plus ten ids, not documents. Stores now declare capabilities; the adapter declares
`entityOperations:false` and throws `UNSUPPORTED_OPERATION`, and the contract asserts the refusal.
This is a documented gap, not a fix.

**5. Source hygiene.** New `verify:source-hygiene` scans all 551 TS sources for literal control
characters. Found the U+0000 in `semanticSourceHash`, one I had just introduced in the id hash
separator, and pre-existing U+0001/U+0002 in `sharedCompatibilityKey`. All now escapes;
`verify:browser-isolation` 27/27 and `verify:shared-browser-pool` 19/19 confirm no behaviour change.
The guard's first draft spelled its own pattern with literal control chars and a cleanup pass ate
them, leaving a guard that matched a plain hyphen — rewritten with escapes.

**Tests:** build PASS; `typecheck:scripts` PASS; semantic-policy 135/0; semantic-store 102/0;
semantic-queue 70/0; source-hygiene 7/0; browser-isolation 27/27; shared-browser-pool 19/19;
failure-evidence 34/0; taxonomy 127; memory gate PASS.
**Not run:** packaged/live Zvec verifiers, `verify:runner`, mock-site verifiers.

**Deliberately NOT done, tracked as P1 beads:** host scan/count/cursor to remove the 100-document
ceiling; rebuild orchestration; `verify:semantic-zvec-native-contract` against the real host.
**Phase 1B remains IN PROGRESS.**

---

## 2026-07-25 - Zvec Phase 1B: sanitisation pipeline, stores, mutation queue (Claude)

**Task:** implement Phase 1B items 1-10 on `main`, in the mandated order.

**Commits:** `097817b` (contracts + projection + redactor + policy validator), `e93b0bb` (store
interface + in-memory implementation + shared contract suite), `f59d17f` (Zvec adapter + transport
fake), this commit (serialized mutation/rebuild queue).

**Design points worth keeping:**
- **Projection before redaction, deliberately.** Redaction is a filter and leaks what it does not
  recognise; projection is a structural exclusion. Adding a field to the allowlist is a privacy
  decision, not a formatting one.
- **The brand is the enforcement.** `ValidatedSemanticDocument` uses a module-private `unique
  symbol`, so the stores and queue cannot accept anything the policy pipeline did not mint. Verified
  with a throwaway compile probe. A double assertion can still defeat it - stated in the file rather
  than overclaimed.
- **One contract suite, two implementations.** Keeping it in `src/` (not in the verifier script) is
  what let the Zvec adapter run the identical assertions. It immediately caught the adapter emitting
  a flat `"Full-text match"` while the in-memory store explained title vs content matches, i.e.
  `reasons` meant different things per backend. Fixed by extracting one shared explanation
  vocabulary; ranking WEIGHTS stay per-store, since each backend ranks differently.
- **Documents read back OUT of the index are re-validated, not cast.** The index is a file on disk;
  it is untrusted in both directions. A row failing policy is dropped rather than surfaced.
- **Queue asymmetry:** a dropped upsert is recoverable staleness (detectable via `sourceHash`); a
  dropped delete leaves content indexed that should be gone. So overflow drops the oldest UPSERT and
  never a delete, and refuses the enqueue when only deletes remain.

**All three verifiers negative-controlled** (each failed against a deliberately broken
implementation before being trusted): upsert-is-replace (append instead of replace -> "holds ONE
document, not two - 2"); delete-protection (drop oldest regardless of op -> 2 failures);
no-blind-replay (treat every failure as retryable -> "attempted exactly once - calls=4"). Also
fixed a self-inflicted vacuous assertion (`!queue.needsRebuild === false`, whose label claimed to
test delete survival but tested nothing) by pre-seeding a real delete target.

**Also fixed, pre-existing:** `verify:verifier-classification` was FAILING on `main` - Phase 1A
added twelve `verify:zvec-*` scripts plus `verify:all-typecheck` without registering them, so the
reported taxonomy total was stale at 111 and excluded the entire semantic subsystem. Now 126.

**Tests:** `npm run build` PASS; `typecheck:scripts` PASS; `verify:all-typecheck` PASS;
semantic-policy 80/0; semantic-store 93/0 (both implementations); semantic-queue 46/0;
zvec-generation-recovery 134/0; generation-lifecycle 102/0; generation-concurrency 12/0;
host-lifecycle 52/0; host-source-boundary 22/0; verifier-classification 126; memory gate PASS.
**Not run:** `verify:zvec-packaged-live` / `coexistence` (need `package:portable`), `verify:runner`,
mock-site verifiers - no runner, recorder, renderer or packaging source changed.

**Explicitly still out of scope:** renderer/preload semantic APIs, semantic IPC, automatic indexing,
UI, failure memory, locator memory, embeddings, RAG. Rebuild orchestration + parity tests remain.

---

## 2026-07-25 - Pointer-state hardening + restored type gates (Claude)

**Task:** close the remaining Phase 1A integrity gap before Phase 1B contracts build on it, and make
`typecheck:scripts` trustworthy again. Both were owner-reported.

**The defect (bd `awkit-9rd`, P1, data-destroying).** `readActivePointer()` returned `null` for
pointer-absent, unreadable, malformed-JSON, and invalid-name alike. `semanticService` passed that
`null` as `authoritativeActiveGeneration`, which reconciliation reads as "nothing is active, so
nothing is protected" - skipping the preserve-everything early return and the per-generation guard.
With metadata reporting an unclean shutdown (its default on any read failure) every generation was
deleted, including the live one. Same defect class as `4ddc773`, relocated into the pointer's own
reader: an authoritative pointer is worthless while "damaged" and "absent" share a value.

**Fix.** `readActivePointerStrict` → `ok | missing | invalid | unreadable`, validating all three
fields (`activeGeneration`, `previousGeneration`, `activatedAt`). `ReconcileOptions` now takes
`ActiveGenerationIdentity` (`known | none | unknown`) instead of `string | null`, so the collapse is
**unrepresentable** rather than discouraged; `resolveActiveIdentity()` is the single mapping and the
only thing production calls. Under `unknown`: no discard, no quarantine (it renames, which breaks a
live index just as surely), no retention trim; `activeIdentityUnknown` + `recoveryRequired` reported;
health gains `ACTIVE_POINTER_READ_FAILED`, ranked above `REBUILD_REQUIRED`. `repairMetadataFromPointer`
refuses a damaged pointer (`POINTER_UNREADABLE`) rather than reporting `notNeeded`, and
`markIndexClosed(undefined)` preserves the recorded generation instead of asserting absence. Startup
remains non-blocking.

**Negative-controlled.** Reverting *only* the identity mapping to the old collapse makes the new
suite report `survivors: none` / 3072 bytes reclaimed - the data loss reproduced. The tests are not
vacuous.

**Type gates restored - the recorded cause was wrong.** `KNOWN_ISSUES.md` blamed the edge fixtures in
`verify-branch-pairs.mts`; they were always well-formed. The type was erased by a non-generic
`byId(edges: { id: string }[])`, whose widened return broke all 16 call sites. Two files the entry
never mentioned were also red: `verify-popup-identity.mts` used `Parameters<typeof StepExecutor>` on
a **class** (a class's call signature is not its constructor signature), which silently accepted an
incomplete context - switching to `ConstructorParameters<>` exposed 7 missing required fields; and
`verify-session-context.mts` had an over-narrow `assertDenied` signature. Fixing `byId` alone would
NOT have restored the gate.

**Files:** `src/semantic/SemanticGenerationManager.ts`, `src/semantic/SemanticGenerationReconciler.ts`,
`src/semantic/contracts/SemanticHealth.ts`, `app/main/semantic/semanticService.ts`,
`scripts/verify-zvec-generation-recovery.mts`, `scripts/verify-zvec-generation-lifecycle.mts`,
`scripts/verify-branch-pairs.mts`, `scripts/verify-popup-identity.mts`,
`scripts/verify-session-context.mts`, `docs/ai/{CURRENT_STATE,KNOWN_ISSUES,TASK_LOG}.md`.

**Tests:** `npm run build` PASS; **`typecheck:scripts` PASS (first green since the randomized-test-lab
merge)**; `verify:all-typecheck` PASS; zvec-generation-recovery **134/0** (was 34);
generation-lifecycle 102/0; generation-concurrency 12/0; host-lifecycle 52/0; host-source-boundary
22/0; branch-pairs 31/0; session-context 11/11.
**Not run:** `verify:zvec-packaged-live` / `coexistence` (need `package:portable`),
`verify:popup-identity` (live Chromium; typing-only change), `verify:runner`, mock-site verifiers.

---

## 2026-07-25 - Zvec Phase 1A hardening + handoff (AI coding agent)

**Task:** Three review rounds of hardening on the Phase 1A foundation, then prepare the handoff.

**Commits:** `585c68e` (activation failure window + 5 findings), `0483f5c` (real multi-process
concurrency test, structured metadata repair, rebuild-stage classification), `4ddc773` (active
pointer authoritative during reconciliation).

**Most significant fix:** startup reconciliation derived the active generation from `metadata.json`.
Because the tolerant reader returns `activeGeneration: null, cleanShutdown: false` on ANY failure, an
unreadable metadata file made every generation look non-active and the unclean-shutdown rule deleted
them all - including the one the authoritative pointer named. `reconcileGenerations` now takes
`authoritativeActiveGeneration` as a REQUIRED parameter, and a valid pointer protects its generation
unconditionally. Confirmed by negative control: the old logic fails the new regression with the
active generation marked "discarded / orphaned by an unclean shutdown".

**Also fixed:** `repairMetadataFromPointer` used the tolerant reader, making `READ_FAILED`
unreachable (added `readMetadataStrict`); rebuild reported `POPULATE_FAILED` for nearly every
pre-commit failure (explicit stage tracking); the allocator could reissue a missing active
generation's name; the concurrency verifier used a fixed 4s delay (now a READY/GO barrier).

**Tests:** `npm run build` PASS; boundary 22/0; host-lifecycle 52/0; generation-recovery 34/0;
generation-lifecycle 102/0; generation-concurrency 12/0; packaged-live 35/0; coexistence 16/0;
`check-memory.mjs` PASS. **Not run:** `verify:runner`, `verify:popup-identity`, mock-site verifiers.

**Both new verifiers were negative-tested:** reverting the fix makes the concurrency test report 13
duplicate allocations, and makes the reconciliation regression delete the active generation. Neither
test is vacuous.

**Fixed a pre-existing memory-gate failure:** `check-memory.mjs` had been failing since `383326c`
because a TASK_LOG sentence quoted a credential-assignment example verbatim while describing masking,
which the secret scanner cannot distinguish from a real leak. Reworded the prose rather than
weakening the scanner. (Worth knowing: prose *about* secret handling trips this gate easily - describe
the pattern, do not quote it.)

**Known issue recorded:** `npm run typecheck:scripts` is red from the randomized-test-lab merge
(`verify-branch-pairs.mts` edge fixtures), so `verify:all-typecheck` is not a trustworthy gate.

---

## 2026-07-25 - Zvec Phase 1A: native-host foundation (Claude)

**Task:** Implement the Phase 1A production foundation on `main`, closing Phase 0D conditions 1-5.

**Commits:** `ccb4ede` contracts/layout/boundary verifier, `3a2ba09` host manager + restart policy
+ circuit breaker, `5b37c2b` generation reconciliation, `f0f2f76` spike-hook removal + staged
shutdown + startup reconciliation.

**New:** `src/semantic/contracts/ZvecHostProtocol.ts`, `src/semantic/SemanticGenerationLayout.ts`,
`src/semantic/ZvecHostRestartPolicy.ts`, `src/semantic/SemanticGenerationReconciler.ts`,
`app/main/semantic/ZvecUtilityHostManager.ts`, `app/main/semantic/semanticService.ts`,
`scripts/verify-zvec-host-source-boundary.mts`, `scripts/verify-zvec-host-lifecycle.mts`,
`scripts/verify-zvec-generation-recovery.mts`.

**Removed:** the `AWKIT_ZVEC_SPIKE_HOST` hook from `app/main/main.ts`, `__testAbort` from the shipped
host, and the hook-dependent spike harnesses (recoverable at
`archive/spike-zvec-phase-0-20260725`).

**Tests:** `npm run build` PASS; `package:portable` PASS; strict `validate:offline` PASS;
`verify:zvec-packaged-assets` 17/17; `verify:zvec-host-source-boundary` 20/0;
`verify:zvec-host-lifecycle` 52/0; `verify:zvec-generation-recovery` 31/0. Live packaged run: 2
seeded orphan generations reclaimed, app reached its window with no spike env vars, and quit wrote
`cleanShutdown=true` + `lastSuccessfulUpdateAt`.
**Not run:** `verify:runner`, `verify:popup-identity`, mock-site verifiers.

**Bug found by running the packaged app:** `semanticService` used `app.getPath("userData")` (roaming
`%APPDATA%`) instead of `getRuntimeDataRoot()` (`%LOCALAPPDATA%/SpecterStudio`). All unit tests
passed with the bug present because the reconciler takes its root as a parameter. Fixed and pinned by
a boundary-verifier check.

**Known gap:** removing the spike hook removed the only automated packaged live-CRUD / crash /
benchmark / coexistence coverage. Recorded in `KNOWN_ISSUES.md`.

**Blocked:** `git push origin main` still rejected (`GH013`); 44 commits are local only.

---

## 2026-07-25 - Single-branch consolidation + Zvec Phase 0 integration (Claude)

**Task:** Apply the owner's one-branch continuous-implementation directive; consolidate every branch
and worktree into `main`; preserve all Zvec Phase 0/0B/0C/0D work.

**Commits on `main`:** 5 scoped Zvec commits (raw native host, packaging boundary, packaged
verifiers, spike harnesses, evidence docs) + 4 integration merges.

**Branches consolidated:** `spike/zvec-phase-0` (ff), `feature/backend-srs-tranche-2a-popup-identity`
(merge, was draft PR #36), `feature/randomized-test-lab` (merge, 13 conflicts resolved),
`docs/browser-automation-srs` (merge), `docs/offline-packaging-beads` (merge),
`backup/chore-brand-logo-5b`, `chore/brand-logo-5b`, `backup/pr24-pre-reconstruction` (superseded;
content verified already on `main`). All tips tagged `archive/<name>-20260725`. Both worktrees removed.
`main` is now the only local branch with no extra worktrees.

**Notable conflict:** `FlowChartDesigner.tsx` - two independent refactors collided. Resolved toward
`flowProfileMapping.ts` as the single mapping module after verifying field-by-field that it preserves
the same popup/locator metadata as `flowStepMapping.ts`, and removed the stale local `toFlowProfile`
(the pre-fix version causing RT-06/RT-07).

**Tests run:** `npm run build` PASS; `verify:flow-step-mapping` 101/0;
`scripts/verify-validation.mts` 125/0; `scripts/verify-random-roundtrip.mts` 26/0.
**Not run:** `verify:runner`, `verify:popup-identity`, mock-site verifiers, `validate:offline`.

**Blocked:** `git push origin main` rejected - `GH013: Changes must be made through a pull request`.
All 39 commits are local only. Remote branches intentionally NOT deleted until `origin/main` has the
integration.

**Known gap (pre-existing, not caused by the merge):** `verify-validation.mts`,
`verify-random-roundtrip.mts`, `verify-packaged-validation.mts` are not registered in `package.json`.

---

## 2026-07-24 — Handoff preparation for Backend SRS Tranche 2A (docs only)

- **Task:** prepare the repository for the next agent/developer; no code change.
- **Done:** rewrote the top of `docs/ai/HANDOFF.md` as a single authoritative **ACTIVE HANDOFF**
  section using the repository's canonical subsection names (From/To, Timestamp, Branch / Commit,
  Active Task, Current State Summary, Completed Work, Files Changed, Commands / Tests Run, Remaining
  Work, Known Risks / Blockers, Do Not Touch Without Confirmation, Recommended Next Step, Required
  First Actions For Next Agent). Removed two now-superseded blockquotes from this session — one of
  them still documented the **old** alias format (`popup-<safe-opener>-<hash>`), which would have
  misled the next agent since review round 1 replaced it with `popup-<hash>`. Older historical
  entries, including the earlier `## Current Handoff` block, are untouched and now explicitly labeled
  as historical.
- **Checks:** `node scripts/ai-memory/check-memory.mjs` → **exit 1**, one failure:
  *"Possible Password assignment detected in memory file: docs/ai/TASK_LOG.md"*. **Pre-existing and
  not caused by this branch** — verified by running the same script on the clean primary worktree at
  `main`, which fails identically. It is a false positive: a historical Tranche 1 entry (this file)
  documents masking using a literal password-assignment example that matches the scanner's
  `/password\s*[:=]\s*.{6,}/i` rule. No credential is present. Left unfixed because it would mean
  editing a merged historical entry — flagged for owner decision. Own new wording was reworded so it
  cannot trip the same rule after a reflow.
- **Not changed:** `CURRENT_STATE.md` (no behavior, status, command, architecture, or risk change
  since the review-fix entry), and all source/test files.
- **Result:** `docs/ai/HANDOFF.md` is ready for the next agent. PR #36 remains draft and unmerged at
  `94eb9e0`; no `.beads` change, no `bd` run.

---

## 2026-07-24 — Backend SRS Tranche 2A: PR #36 review round 1 fixes (still draft, not merged)

- **Task:** fix the four correctness/security blockers from the owner's PR #36 code review. Each was
  reproduced against the branch code first; none was a false positive.
- **(1) Internal-page pending-identity race.** `markInternal` did not cancel the identity
  finalization scheduled while a branch page was `about:blank`, and the finalization callback never
  re-checked internal status — so the branch's later navigation could assign it a popup alias. Both
  defenses added. The previous test missed the race by navigating *before* observing/marking (the
  reverse of production order). The new test uses the exact production ordering **and** asserts the
  mechanism (`pendingIdentityCount()` drops at `markInternal`), because `reconcile`'s eligibility
  filter masks a missing cancellation from an outcome-only assertion — verified by a negative
  control that disables the defense.
- **(2) More than one identity owner.** `runFlowWithChildren` is recursive and installed a context
  `"page"` observer per invocation, while every `StepExecutor` built its own registry — so a popup
  opened during `Run Another Flow` was observed by both parent and child registries, and branch
  executors had a registry with no observer. Registry + single observer moved to `BrowserHolder`
  (one per BrowserContext/runtime generation), injected into parent, child, and branch executors;
  `resetForNewContext` + rebind on browser restart; observer detached at end of run. Added
  `StepExecutor.rootPage` so per-executor `switchToMainPage` / close-restore semantics survive the
  now-shared registry (a branch must return to ITS page, not the run's primary page).
- **(3) Ambiguity latched permanently.** Independent counters never reconciled when a contesting
  popup closed, was released, was claimed under a recorded alias, or became internal. Replaced with
  an **identity-bucket model**: a bucket grants its alias only while exactly one eligible page
  occupies it, and every membership change re-reconciles it.
- **(4) Sensitive material in aliases + unmasked diagnostics.** The alias embedded
  `safePathComponent(openerAlias, …)` — filesystem-safe, not secret-safe (`token-SECRET` with a
  hyphen passes straight through `maskText`). Alias is now `popup-<sha256(origin+path)[0..12]>`, a
  fixed neutral prefix that never echoes inputs; the opener is dropped from identity entirely (it
  was also timing-dependent via "currently active executor"). All identity diagnostics — reserved,
  duplicate-claim, ambiguity, and the missing-popup resolver message — run through `SecretMasker`,
  with the resolver message's stable SHAPE preserved per the SRS.
- **(5) Found by the new tests, not the review:** `observe()` was not idempotent — re-observing a
  pending page scheduled a second finalization, leaking a duplicate listener pair and timer.
- **Files:** `src/runner/runtime/PopupIdentityRegistry.ts` (rewritten around buckets + masking),
  `src/runner/PlaywrightRunner.ts` (holder-owned registry + single observer + rebind),
  `src/runner/StepExecutor.ts` (injected registry, `rootPage`, masked resolver),
  `scripts/verify-popup-identity.mts` (25 → 43 checks), `docs/ai/backend-srs-tranche-2a-scope.md`,
  `CURRENT_STATE.md`, `HANDOFF.md`, this log.
- **Tests run:** build + typecheck clean · **`verify:popup-identity` 43/43** · `verify:popup` 12/12 ·
  `verify:popup-mock-site` 11/11 · `verify:flow-step-mapping` 101/101 · `verify:runner` 84/84 ·
  `verify:recorder` 78/78 · `verify:failure-evidence` 34/34 · `verify:failure-evidence-live` 17/17 ·
  `verify:failure-screenshot-precedence` 6/6 · `verify:ipc-contract` 4/4 · `verify:security` 39/39 ·
  `verify:auth` 49/49 · `verify:authz` 40/40 · `verify:clean-machine-policy` 28/28 ·
  `verify:verifier-classification` **reconciled 111** (unchanged — checks added to an existing
  script, no new verifier).
- **Result:** all executed checks green. PR #36 remains **draft and unmerged**; additive commits
  only, no amend/rebase/force-push. No `.beads` change, no `bd` command, no release promotion,
  FR-C2 still not started.

---

## 2026-07-24 — Backend SRS Tranche 2A: FR-C1 deterministic page identity (draft PR, not merged)

- **Task:** implement Backend SRS Tranche 2A (FR-C1 popup/page identity) off `main` `5dbe25f`, with
  the `awkit-4t9` designer round-trip as a named prerequisite. FR-C2 explicitly out of scope (owner
  split it into Tranche 2B: C2.1 needs a real frame-identity design, not selector-only regression
  coverage).
- **Defect (`awkit-ebh`, reproduced live):** `PlaywrightRunner.ts:486-494` (context `"page"` handler,
  positional `popup-${counter}`) and `StepExecutor.ts:1435`/`:1460` (recorded alias) both registered
  the same popup → one `Page` under two aliases, identity by **arrival order**. Negative control
  against the new fixture: old code maps `popup-1` → *alpha* when alpha opens first and → *beta* when
  beta opens first.
- **Fix:** new `src/runner/runtime/PopupIdentityRegistry.ts` — single owner of `alias → Page` **and**
  `Page → alias`. Context `"page"` event = sole observation point; step paths **claim** the awaited
  `Page` (atomic promotion off the synthetic alias) instead of registering a second entry. Synthetic
  identity `popup-<safe-opener>-<sha256(opener+origin+normalized path) first 8 hex>` — no query
  string, no fragment; active-step-id and `window.name` deliberately excluded as timing-dependent.
  Ambiguous identity → explicit diagnostic, never a guess. Branch pages marked internal so they no
  longer consume popup aliases. `resolveStepPage` is now async (bounded settle for late-committing
  popups); its user-facing message is unchanged.
- **Prerequisite (`awkit-4t9`):** `flowStepMapping.ts` now maps `pageAlias` / `opensPopup` /
  `popupExpectation` in both directions (absent stays absent). Bead is marked closed citing `ab9f5f6`,
  which is **not** an ancestor of `main`; `.beads` left untouched.
- **Mock site (before the fix, SRS C-9):** `popup/reversed-order.html` + alpha/beta popups;
  `popup/script-timer.html` + timer popup (secret-shaped `?token=…&session=…#…`, ambiguous-pair
  control). Index 7 → 9 scenarios; README updated.
- **Files:** `src/runner/runtime/PopupIdentityRegistry.ts` (new), `src/runner/StepExecutor.ts`,
  `src/runner/PlaywrightRunner.ts`, `app/renderer/components/workflow/flowStepMapping.ts`,
  `app/renderer/components/workflow/flowDesignerTypes.ts`; tests
  `scripts/verify-popup-identity.mts` (new), `scripts/verify-popup.mts`,
  `scripts/verify-popup-mock-site.mts`, `scripts/verify-flow-step-mapping.mts`; registered in
  `package.json` + `scripts/lib/verifier-classification.ts`; 5 new mock-site pages; docs
  `docs/ai/backend-srs-tranche-2a-scope.md` (new), `CURRENT_STATE.md`, `HANDOFF.md`, `TESTING.md`,
  `mock-site/README.md`.
- **Tests run (isolated `npm ci`, Node 18.16.0 / npm 9.5.1):** `npm run build` + `typecheck` clean ·
  `verify:popup-identity` **25/25 (new)** · `verify:popup` 12/12 · `verify:popup-mock-site` 8 →
  **11/11** · `verify:flow-step-mapping` 94 → **101/101** · `verify:runner` 84/84 ·
  `verify:failure-evidence` 34/34 · `verify:failure-evidence-live` 17/17 ·
  `verify:failure-screenshot-precedence` 6/6 · `verify:ipc-contract` 4/4 · `verify:security` 39/39 ·
  `verify:auth` 49/49 · `verify:authz` 40/40 · `verify:clean-machine-policy` 28/28 ·
  `verify:verifier-classification` **reconciled 111** (110 → 111; real-browser 37 → 38).
- **Not run:** packaged-EXE / offline-bundle / clean-machine gates (no packaging or offline change in
  this tranche; clean-machine remains owner-waived non-blocking and NOT EXECUTED).
- **Result:** all executed checks green. Draft PR opened, **not merged**. No `.beads` change, no `bd`
  command, no release promotion, `main` untouched directly.

---

## 2026-07-24 — Backend SRS Tranche 1: FR-B2 immediate failure evidence (PR open, not merged)

- **Task:** resume backend SRS implementation; select and implement the next smallest coherent tranche.
- **Selected:** SRS-BAO-001 **FR-B2 (Immediate failure evidence capture)** — WS-B's highest-value item
  and a confirmed ordering defect. Deferred FR-B1 (run-root migration + §10.3 retention open question)
  and FR-A4 AC-3 (unresolved decision). Full SRS is on the planning branch `docs/browser-automation-srs`
  (`37dc67c`), unchanged; status recorded on `main` via `docs/ai/backend-srs-tranche-1-scope.md`.
- **Defect:** `FlowExecutor.executeWithRetry` captured the failure screenshot **after** the retry loop
  (only `lastResult`), so intermediate attempts got no evidence and a navigating retry erased the
  broken state first.
- **Fix:** capture moved into the loop, per failing attempt, before the retry decision/navigation
  (B2.1). New `StepExecutor.captureFailureEvidence(step,{attempt})` → screenshot + DOM + a11y + meta,
  secret-masked (FR-H1), individually bounded 5 s (B2.6), accumulated per attempt / never overwritten
  (B2.2), encoded filenames (B2.3). Original error stays primary; capture failure = secondary
  diagnostic, never throws (B2.4/B2.5). `screenshotPath` kept populated (reports back-compat). Added
  `StepEvidenceRef` + `evidence?: StepEvidenceRef[]`. **No schema migration.**
- **Deferred (documented):** console-tail + in-flight network state → FR-A2 (Tranche 5); FR-B1
  run-root + `manifest.json` + durable `evidence[]` surfacing → own tranche.
- **Files:** `src/runner/RunnerResult.ts`, `src/runner/StepExecutor.ts`, `src/runner/FlowExecutor.ts`;
  `scripts/verify-failure-evidence.mts` (new), `scripts/verify-failure-screenshot-precedence.mts`
  (adapted), `scripts/lib/verifier-classification.ts`, `package.json`, `docs/ai/backend-srs-tranche-1-scope.md`
  + CURRENT_STATE/HANDOFF/TESTING.
- **Tests:** build + typecheck clean; `verify:failure-evidence` 15/15 (new, unit);
  `verify:failure-screenshot-precedence` 6/6; `verify:runner` 84/84 (real Chromium);
  `verify:artifacts` 13/13; `verify:verifier-classification` reconciled **109** (unit 43 → 44);
  protected gates green (`security` 39 · `ipc-contract` 4 · `auth` 49 · `authz` 40 ·
  `clean-machine-policy` 28).
- **Boundaries:** no `.beads` change, no `bd`/`bd dolt push`, no release promotion, no schema migration,
  no protected gate weakened; `main` not modified directly; PR opened as **draft, not merged**.
- **PR #35 review fixes (round 2, same day):** (1) evidence now preserved onto a passing retry
  (`executeWithRetry` returned before attaching earlier failed-attempt evidence); (2) all evidence path
  components sanitized via new shared `safePathComponent` (`src/utils/pathSafety.ts`) + `isPathInside`
  confinement of each artifact path; (3) truthful page identity — a failed `resolveStepPage` labels
  evidence with the actual captured page + secondary diagnostic + new optional
  `StepEvidenceRef.requestedPageId`; (4) new real file-output verifier `verify:failure-evidence-live`
  (real Chromium + local HTTP server). Counts: `verify:failure-evidence` 15 → **29**;
  `verify:failure-evidence-live` **14/14**; verifier total 109 → **110** (unit 44, real-browser 37);
  `verify:runner` 84 · `verify:artifacts` 13 · protected gates unchanged. Still draft, not merged.
- **PR #35 review fixes (round 3, final correction pass, same day):** (1) every `StepEvidenceRef.note`
  is now masked — `StepExecutor`'s `record()` previously stored the resolver-failure diagnostic
  (embeds `step.pageAlias`) and each per-artifact capture-failure note (embeds the error message)
  unmasked; both now pass through `evidenceMasker.maskText(...)`. (2) The `FlowExecutor`
  belt-and-suspenders fallback note (when `captureFailureEvidence` itself throws) is masked too via a
  new `FlowExecutor.evidenceMasker`. (3) `safePathComponent`'s `fallback` argument is sanitized through
  the same pipeline as `raw` instead of being returned verbatim — only the hard literal `"x"` is ever
  unsanitized. (4) New regression tests: FlowExecutor-fallback note masks password/token assignments from an
  injected error; four `safePathComponent` hostile-fallback cases; a live hostile/secret-shaped
  `pageAlias` proving the resolver-failure note is masked. Counts: `verify:failure-evidence` 29 → **34**;
  `verify:failure-evidence-live` 14 → **17**; verifier taxonomy total unchanged at **110** (no new
  script); `verify:runner` 84 · `verify:artifacts` 13 · protected gates unchanged. Still draft, not
  merged — awaiting owner re-review.

---

## 2026-07-24 — Track 4: clean-machine validation policy made optional and non-blocking

- **Task:** remove only the clean-machine validation gate's ability to block release promotion, while
  keeping execution status truthful (PASSED / FAILED / NOT_EXECUTED / OWNER_WAIVED) and without weakening
  any other release gate or rewriting historical evidence.
- **Phase 1 finding:** the gate was **documentation-enforced, not code-enforced**. No release/promotion
  resolver exists in `src/` (all `promote*` symbols are workflow-instance/branch-pair logic); CI runs only
  typecheck + build; the `clean-machine-acceptance` verifier class has no npm script. So the fix is a single
  canonical policy source + a documentation-consistency verifier, not the removal of a runtime gate.
- **Branch / worktree:** `policy/clean-machine-validation-non-blocking`, isolated worktree off `origin/main`
  (`dde6703`) with an independent `npm ci` (no shared `node_modules` junction).
- **Added:** `scripts/lib/clean-machine-validation-policy.ts` — canonical policy: 4-status model +
  separated execution/policy/blocking, `resolveCleanMachineGate` blocking matrix (failed → BLOCKING;
  passed/not-executed/owner-waived → non-blocking), fail-safe throw on unknown/malformed state, canonical
  wording constant, protected-gate list, dated owner decision, truthful report renderer.
- **Added:** `scripts/verify-clean-machine-policy.mts` (`verify:clean-machine-policy`) — 10 proofs
  (matrix, fail-safe, never-rendered-as-passed, docs carry the policy, protected gates mandatory, historical
  evidence unchanged, no false PASSED claim, runbook still present). Registered in
  `scripts/lib/verifier-classification.ts` as **documentation-consistency** + `package.json`.
- **Docs:** authoritative policy banner atop `CLEAN_MACHINE_VALIDATION_RUNBOOK.md` (supersedes the
  “requires execution” framing; runbook stays usable; a FAIL still blocks), new top section in
  `CURRENT_STATE.md`, `HANDOFF.md` note, this entry. Historical NOT EXECUTED rows/banners left intact.
- **Tests:** `npm run build`, `verify:clean-machine-policy`, `verify:verifier-classification` (total
  107 → 108, documentation-consistency 0 → 1), plus protected-gate spot checks (`verify:security`,
  `verify:ipc-contract`, `verify:oracle-offline-bundle`). Results recorded in the PR.
- **Boundaries honored:** no `.beads` change, no `bd`/`bd dolt push`, no historical rewrite, no protected
  gate weakened, `backup/pr24-pre-reconstruction` and archived `a1adcc2` refs untouched.

---

## 2026-07-24 — PR #24 reconstructed: Oracle data-source RBAC + hardened live-reauth verifier

- **Task:** reconstruct the stale PR #24 (disposition NEEDS FIX) off current `main` (`b416f8c`), bringing
  `main` into alignment with the already-closed beads `awkit-b3w` + `awkit-2d8`, with **no** `.beads`/`bd`
  mutation.
- **Branch:** `reconstruct/pr24-oracle-authz-reauth` (off `main`); old tip `ec19bda` preserved as
  `backup/pr24-pre-reconstruction` (local + remote). Not a conventional rebase — the old branch carried stale
  `.beads`/docs churn and predated the verifier taxonomy.
- **Code:** `oracle:dataSources:save`/`delete`/`refreshSnapshot` now `assertSenderPermission(event,
  Permission.DATASOURCE_MANAGE)` before service lookup/existence/secrets (trusted-sender preserved inside);
  other Oracle channels unchanged. `verify:e2e-rbac` +2 Viewer Oracle-denial checks (49 → 51). New hardened
  `verify:e2e-reauth` (real-Electron, **19/19**: cancel, exactly-once, no-wrong-password-success-audit,
  no-replay, no-credential-leak) + alias + **`real-browser`** taxonomy entry (registry **107** / real-browser 36).
- **Docs:** COMMANDS / TESTING / E2E_DEFECTS / spec-step-10 + this state/handoff/log refreshed; **no** stale
  `.beads` or old AI-state content ported.
- **Files:** `app/main/ipc/oracle.ipc.ts`, `scripts/verify-e2e-rbac-gui.mjs`, `scripts/verify-e2e-reauth-gui.mjs`
  (new), `scripts/lib/verifier-classification.ts`, `package.json`, `docs/ai/{COMMANDS,TESTING,CURRENT_STATE,
  HANDOFF,TASK_LOG}.md`, `docs/testing/E2E_DEFECTS.md`, `specs/e2e/E2E-RBAC.md`. **No `.beads` files.**
- **Tests:** build ✓; e2e-rbac 51/51; e2e-reauth 19/19; ipc-contract 4/4; security 39/39; auth 49/49; auth-gui
  18/18; authz 40/40; verifier-classification 107. `verify:oracle-drivers-gui` 25/30 — five Oracle
  bridge/Java/ojdbc checks environmental/inconclusive (bridge runtime unavailable in this build), non-blocking;
  no global waiver.
- **Boundaries:** no `bd`, no `bd dolt push`, no `.beads` change; `main` not edited directly; archived `a1adcc2`
  refs untouched.

---

## 2026-07-23 (latest) — Three-branch recovery: pre-merge review + merge to `main`

- **Task:** full pre-merge review + combined integration validation of the three recovered feature PRs
  (#28 accent, #29 HTTPS, #30 branding) and the recovery-docs PR (#31), then merge the features to `main`.
- **Reviews:** PR #28 clean; **PR #29 mandatory security review passed 11/11** (context-scoped only ·
  default `false` · import can't enable · permission-gated mutation · recorder initial + persistent-context
  resume same resolved policy · retries/branches/replacement/shared contexts per-context · no process-wide
  `--ignore-certificate-errors` / Electron cert override · not in the shared-browser pool key · validating
  + bypassing contexts coexist · logs carry no URL/cookie/cert/session data · CAPTCHA/MFA/protected-login/
  handoff unchanged); PR #30 clean; PR #31 factually accurate.
- **Combined integration:** merged accent + https + branding into a throwaway validation branch — only
  **additive** conflicts in `Settings.tsx` / `package.json` / `uiSettings.ts` / `global.css` / `App.tsx`
  (`preload.ts` auto-merged), all resolved preserving every feature (no broad `--ours`/`--theirs`).
  Combined tree built clean; every feature verifier stayed green; a real-Electron coexistence check
  confirmed all three Settings cards on one page, saving one feature doesn't reset another, login applies
  both accent + logo, and defaults restore.
- **PR #30 verifier fix (`f01e4ec`, test-only):** `verify:custom-brand-logo` check #14 changed from
  "`app/main/uiSettings.ts` byte-identical to `main`" to a semantic "branding adds no branding-specific
  UiSettings field" source scan, so it stays 31/31 in a combined tree where accent / recorder-security
  legitimately modify that file. No production branding code changed.
- **Merge sequence (development integration, NOT product promotion):** #28 → `3e79b70`; #30 (updated onto
  `main`, additive conflicts resolved, verifiers re-run 31/31 · 47/47 · 30/30) → `2033424`; #29 (updated
  onto `main`, full HTTPS suite re-run — certs 49/49 · gui 31/31 · runner 82 · recorder 78 · settings 3/3
  · ipc 4/4) → `0777682`. **Final `main`: `0777682`.**
- **Boundaries kept:** `.beads/issues.jsonl` untouched (still the frozen pre-existing backend export); no
  `bd` / `bd dolt push`; PR #27 (`85df851`) untouched; archived source branches intact; release promotion
  (portable rebuild / artifact verification / clean-machine / `validate:offline`) still NOT executed.

---

## 2026-07-23 (earlier) — Three-branch feature recovery (accent / HTTPS / custom brand logo)

- **Task:** decompose the mixed commit `a1adcc2` ("branding, accent theme, and HTTPS certificate trust",
  on `chore/brand-logo-5b`) into **three independent feature branches off `main` @ `32e378e`**, verify
  each, and open three separate PRs. Not stacked; original mixed branch left intact.
- **`feature/custom-accent-gradient` @ `cf5b50f` (PR #28, ready):** finished the accent port (added the
  missing `<AccentColorSettings/>` mount + the two verifiers + package.json aliases). Accent-only.
  `verify:accent-theme` 71/71, `verify:accent-gui` 33/33, build clean. New `docs/ACCENT_COLOR.md`.
  Deferred (optional polish): the `SecurityGate.tsx` live-OS-theme-switch accent hunk.
- **`feature/https-certificate-trust` @ `ba2e887` (PR #29, DRAFT — security review):** recovered
  context-level `ignoreHTTPSErrors` on both context factories; **removed** the browser-wide
  `--ignore-certificate-errors` launch arg + `AWKIT_CERT_FALLBACK_LAUNCH_ARG` env hatch, and reverted
  `sharedCompatibilityKey`'s cert pool-key dimension. Added a source-scan **regression guard** (fails if
  a quoted `"--ignore-certificate-errors"` reappears; pinned `-spki-list` excluded). 3-way merged
  StepExecutor/RecorderService/recorder.ipc/Recorder.tsx to preserve protected-login.
  `verify:https-certificates` 49/49, `verify:https-certificates-gui` 31/31, regression `verify:runner`
  82 + `verify:recorder` 78, build clean. `docs/HTTPS_CERTIFICATE_TRUST.md` gained a security-review
  checklist.
- **`feature/custom-brand-logo` @ `11b2afa` (PR #30, ready):** recovered the Super-User custom logo
  (`src/branding/*` already met the security bar — PNG-signature validation, SVG→PNG rasterization,
  app-managed atomic store, bytes-not-paths IPC, permission/audit, data-URL-only, safe fallback).
  **Excluded** the source branch's `specter-logo.svg` replacement + `package-portable.ps1` change (shipped
  assets preserved). **Added** login-screen display (parity with the sidebar via one `getState()` read).
  New `verify:custom-brand-logo` 31/31 (maps 1:1 to the 15 acceptance cases) + `verify:branding` 47/47 +
  `verify:branding-gui` 30/30 (retargeted one accent-dependent check to the ungated "Application" card),
  build clean. New `docs/BRANDING_CUSTOM_LOGO.md`.
- **Git:** each branch = 1 feature commit + 1 focused docs commit; confirmed cleanly based on
  `origin/main` before its PR. Pushed; PRs #28/#30 ready, #29 draft. `.beads`, `bd dolt push`, release
  promotion, and the archived source branches (`chore/brand-logo-5b` + `backup/…`) left untouched.
- **Docs sync:** these canonical `docs/ai/` updates recording the recovery are committed on a docs-only
  branch `docs/feature-recovery-state-sync` off `main` (kept separate from the feature PRs #28–#30 and
  from `fix/backend-observability-tranche-0` / PR #27). `.beads/issues.jsonl` left untouched.

---

## 2026-07-23 (later; rebased onto `main` @ `9960633` 2026-07-24) — Claude (Opus 4.8) — Backend Tranche 0 (Reporting truthfulness)

- **Authorization:** owner-approved DEVELOPMENT WAIVER of the portable-rebuild / artifact-verification /
  clean-machine gates (recorded atop `CLEAN_MACHINE_VALIDATION_RUNBOOK.md`). Gates **not executed, not
  passed**; `61f6099` promotion **not completed** (release debt). Waiver authorized **Tranche 0 only**.
- **Branch:** `fix/backend-observability-tranche-0` (**PR #27, draft**). Originally branched from `main`
  @ `32e378e`; **rebased onto `main` @ `9960633`** (post-recovery) on 2026-07-24 and pushed
  (`--force-with-lease`). Four-commit history preserved; verified compatible with the merged accent/HTTPS/
  branding recovery. `.beads/issues.jsonl` carried unchanged (still the frozen cross-branch export — not
  committed, excluded from the PR).
- **awkit-5yx (screenshotOnFailure precedence):** wired the resolved artifact-profile default through
  `browserConfig.artifact.screenshotOnFailure` → `PlaywrightRunnerOptions.screenshotOnFailure` → a new
  `FlowExecutor` ctor arg (default `true`), replacing the hardcoded `?? true` at the failure-screenshot
  gate. Precedence: explicit per-step override → profile default → safe system default.
  Behaviour-preserving today (all profiles return `true`). **AC-3 NOT done** (flipping `production` to
  actually suppress contradicts the `ArtifactProfile.ts` design; needs an owner call — out of
  "precedence" scope). Regression: `scripts/verify-failure-screenshot-precedence.mts` (unit, 6/6) —
  drives the real `executeWithRetry` with a stub StepExecutor; the `(default false, no override)` case
  captures 0 and would capture 1 under the old `?? true`.
- **awkit-oei (success close reason):** added `execution-completed-cleanup` to `BrowserCloseReason`;
  `executeScenario`'s `finally` now closes with a reason that tracks the terminal (`closeReason` set to
  completed only on the passed return; failure/other keep `execution-failed-cleanup`). **Log text only**
  — verified the reason never reaches pool analytics. Regression: extended `verify-runner.mts` with two
  live assertions on `result.logs` (passed → completed-cleanup; failed-terminal → failed-cleanup);
  `verify:runner` now **84/84** (+2).
- **FR-I1 (verifier classification):** `scripts/lib/verifier-classification.ts` (registry, 7-class
  taxonomy, all **106** `verify:`/`validate:` scripts) + `scripts/verify-verifier-classification.mts`
  (reconciles against `package.json`, fails on unclassified/stale/non-taxonomy, prints **per-class
  counts** — the Tranche 0 exit criterion). Counts: 43 unit · 35 real-browser · 21 integration · 4
  static-source · 3 packaged · 0 doc-consistency · 0 clean-machine. The seven verifiers `main` gained in
  the recovery are classified by execution behavior: `accent-theme`=unit; `accent-gui`/`https-certificates`/
  `https-certificates-gui`/`branding-gui`=real-browser; `branding`/`custom-brand-logo`=integration.
  **Remaining FR-I1 depth NOT done:** I1.4 "can it actually fail?" audit + I1.2 per-file headers.
- **Files:** `src/runner/{FlowExecutor,PlaywrightRunner,ExecutionEngine}.ts`;
  `scripts/verify-failure-screenshot-precedence.mts` (new), `scripts/verify-runner.mts` (extended),
  `scripts/lib/verifier-classification.ts` (new), `scripts/verify-verifier-classification.mts` (new),
  `package.json` (+2 aliases); `CLEAN_MACHINE_VALIDATION_RUNBOOK.md`, `docs/ai/{CURRENT_STATE,TASK_LOG}.md`.
- **Tests (rebased tree):** `npm run build` clean; `verify:failure-screenshot-precedence` 6/6;
  `verify:runner` 84/84; `verify:verifier-classification` reconciled (**106**); `verify:branch-pairs`
  31/31. Recovery compatibility: `verify:accent-theme` 71/71 · `verify:accent-gui` 33/33 ·
  `verify:https-certificates` 49/49 · `verify:https-certificates-gui` 31/31 · `verify:branding` 47/47 ·
  `verify:branding-gui` 30/30 · `verify:custom-brand-logo` 31/31 · `verify:settings-persistence` 3/3 ·
  `verify:ipc-contract` 4/4. **Not run:** Oracle/packaged/stress suites (untouched surfaces). Beads left
  OPEN (`.beads` frozen — no `bd close`, no `bd dolt push`).
- **Excluded (still in force):** CDP observation, failure-evidence restructuring (`awkit-oyc`),
  `INCONCLUSIVE`/`StepExecutionStatus`, locator recovery (`awkit-v4r`). **No Tranche 1 work.**

---

## 2026-07-23 (later) — Claude (Opus 4.8) — FR-2.6 branch-pair deletion semantics + SRS reconcile

- **Task:** implement the FR-2.6 owner decision from the prior session's canvas sweep — restore the
  lone-branch-connector behavior that both editors had lost — on `feature/canvas-ux-foundation`.
- **Runtime correction (load-bearing):** the prior handoff/SRS said a lone branch connector
  "truncates the flow at run time." Traced the code — it does **not**. `flowStepMapping.toFlowStep`
  sets `FlowStep.next` to the first outgoing edge regardless of kind, and `FlowExecutor.resolveNext`
  falls back `success → always → step.next`. So a lone **conditional** routes to its target with the
  **condition ignored**; a lone **parallel** fans out and then runs the same target **again** via the
  fallback (twice). The fix targets those real behaviors.
- **Hybrid decision (owner-approved):** (a) interactive deletion auto-reverts the lone survivor to a
  normal connector; (b) existing/imported lone branches are **not** rewritten on load — they are
  reported as Save-blocking issues; (c) a lone branch **with a standard fallback** is a valid if/else
  and is exempt.
- **New shared module** `app/renderer/components/shared/branchPairs.ts` (React-free, verifier-loadable):
  `revertLoneBranchConnectors`, `incompleteBranchPairs` + message, `flowEdgeToNormal` /
  `scenarioEdgeToNormal`, `flowEdgeKind` / `scenarioEdgeKind`. Both editors' `reconcile*Branches`
  (were no-op pass-throughs) now delegate to it; both `connectorStructureIssues` validators gained
  the incomplete-pair check. Removed dead `reconcileBranchConnectors` from `connectorStyle.ts`
  (zero call sites; revert semantics moved to `branchPairs.ts`).
- **New verifier** `scripts/verify-branch-pairs.mts` (`npm run verify:branch-pairs`, **31/31**):
  both editors, both kinds — deletion reverts survivor; unrelated/normal connectors untouched;
  load never mutates; lone-with-no-fallback reported while valid if/else exempt; conversion clears
  branch-only config; runtime-safety proofs (no silent truncation, no single-branch fan-out);
  determinism + idempotence.
- **SRS reconcile (docs-only, separate commit):** `docs/SRS_CANVAS_UX.md` (2026-07-10) was
  materially stale — rewrote it against current code: React Flow → in-house engine; FR-2.6 marked
  implemented+verified; corrected dot tokens (`#c4c9d2`/`#2c3140`/`#cac5d3`, `gap={22} size={2}`),
  component renames (`SmoothEdge`/`LoopEdge`/`Background`/`graphLayout`), removed port-slotting
  assumptions, corrected the reduced-motion finding (six blocks, `!important` vs shorthand hazard),
  replaced drifted `global.css` line numbers with token/selector references. `[NEEDS REFERENCE]`
  visual markers preserved.
- **Files changed:** `app/renderer/components/shared/branchPairs.ts` (new),
  `app/renderer/components/shared/connectorStyle.ts`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/pages/ScenarioBuilder.tsx`, `scripts/verify-branch-pairs.mts` (new),
  `package.json` (+1 alias), `docs/SRS_CANVAS_UX.md`, `docs/ai/{TASK_LOG,CURRENT_STATE}.md`.
- **Commits (on `feature/canvas-ux-foundation`, not pushed):** `62aca6d` fix(canvas), `92b40b5`
  test(canvas), + docs commits for the SRS reconcile and this log entry. `.beads/issues.jsonl` left
  uncommitted (carries the prior session's cross-branch beads — splice hazard).
- **Tests:** `npm run build` clean; `verify:branch-pairs` 31/31; `verify:flow-step-mapping` 94/94;
  `verify:canvas-layout` 35/35; `verify:flow-designer` 24/24 + `verify:workflow-builder` 20/20 (real
  Electron, no console errors). **Not run:** runner/recorder/mock-site/packaging verifiers (none of
  those surfaces touched).
- **Result:** FR-2.6 closed and verified in both editors; SRS reconciled. No production behavior
  changed outside the branch-pair rule. Clean-machine gate (backend) unchanged and still blocking.

---

## 2026-07-23 — Coding agent — Browser-automation SRS, artifact regeneration, canvas current-state sweep

- **Task:** review an external browser-automation improvement summary (25 recommendations) against the
  codebase and produce an SRS; then regenerate the 0.1.0 release artifacts from `61f6099`; then
  re-validate the Canvas UX SRS against current code. No backend implementation (blocked by the
  clean-machine gate).
- **SRS** (`docs/browser-automation-srs` @ `32ed8c4`): new
  `docs/SRS_BROWSER_AUTOMATION_OBSERVABILITY.md` (SRS-BAO-001, 1185 lines). Classified the 25
  recommendations as **9 absent / 11 partial / 3 implemented / 1 rejected**, with per-requirement change
  dependencies, a §7 contract map naming the guarding verifier for each, 14 security gates, and 8
  tranches. Key grounded findings: **zero CDP usage anywhere** in `src/`/`app/` (FR-A1 would be the
  first attach path); `urlPolicy.ts` is a *scheme* allowlist that deliberately permits private networks;
  `StepExecutionStatus` has the widest blast radius of any proposed change. Cookie-entropy scanning
  **rejected** — `SessionCaptureService` never materializes cookie values, so extraction would create
  the exposure a scanner then manages.
- **Beads filed (6):** `awkit-ebh`/`awkit-oyc`/`awkit-5yx`/`awkit-oei` (defects found during the SRS
  review) and `awkit-epz`/`awkit-c0c` (packaging provenance), on two separate branches.
- **Artifact regeneration** from a detached worktree at `61f6099` + the preserved offline payload
  (Chromium 149.0.7827.55; `prepare-offline-deps.ps1` deliberately NOT run):
  **NSIS SUCCEEDED** — 373,894,726 B, SHA-256 `4df7fa64…1f1ec333`, NotSigned, Chromium verified inside
  the installer. **Portable FAILED** — 7-Zip `-mx=9` OOM on 1,177 MiB with commit charge at 31.1/31.8 GB;
  `win-unpacked` completed but is not a substitute. Evidence archived outside the repo; worktree removed.
- **Discovered:** the build is **not hermetic from Git** — `vendor/` + `resources/browsers/` +
  `resources/oracle-jdbc/` are gitignored yet copied wholesale as `extraResources`, so a clean checkout
  produces a **hollow artifact** that installs and launches but cannot drive a browser (`awkit-epz`).
  Also: installer SHA-256 equality is unachievable because `dependency-manifest.json` is regenerated
  with a fresh `builtAt` and packaged (`awkit-c0c`).
- **Corrections made to earlier claims in this session** (recorded so they are not re-derived):
  the mislabeled `execution-failed-cleanup` reason is **log text only** — `onRuntimeClosing`'s sole
  consumer discards it and pool analytics come from a different enum; the Flow Designer auto-layout
  "defect" was **already fixed**; the connector-parity "divergence" is actually **parity**, with both
  editors equally missing the invariant.
- **New verifier** `scripts/verify-canvas-layout.mts` (`verify:canvas-layout`, **35/35**) on
  `feature/canvas-ux-foundation` @ `63eef5c`. Imports the real `graphLayout.ts` and asserts **geometry**
  (bounding-box overlap on real 320×96 dimensions, clearance floors, layer order, cycle termination,
  determinism, idempotence) rather than structure. Three behaviors PINNED rather than silently changed:
  `force:true` re-positions hand-placed nodes; the stack detector buckets on an 8px **grid** so a
  boundary-straddling near-stack escapes; `graphLayout`'s `defaultWidth` (220) is narrower than the
  designer's real 320.
- **Canvas UX SRS sweep (read-only):** `docs/SRS_CANVAS_UX.md` (2026-07-10) is materially stale — the
  Workflow Builder edge "+" and the auto-layout are already implemented, components were renamed, and
  every cited `global.css` line number is wrong. **Confirmed defect:** FR-2.6 fails in **both** editors —
  `reconcileBranchConnectors` is dead code and both editors' replacements are no-op pass-throughs, so a
  lone conditional/parallel connector saves silently and truncates the flow at run time. No verifier
  covers branch reconciliation. Four `prefers-reduced-motion` blocks interact through `!important` vs
  shorthand, so consolidation would change behavior.
- **Files changed:** `docs/SRS_BROWSER_AUTOMATION_OBSERVABILITY.md` (new),
  `scripts/verify-canvas-layout.mts` (new), `package.json` (+1 alias), `.beads/issues.jsonl`,
  `docs/ai/{HANDOFF,TASK_LOG,CURRENT_STATE}.md`. **No production source modified.**
- **Tests:** `npm run build` clean; `verify:canvas-layout` 35/35; `npm ci` exit 0 on the rebuild
  worktree; NSIS packaging exit 0; portable packaging exit 1 (OOM — host limit, not a code defect).
  **Not run:** `verify:runner`, `verify:recorder`, GUI/mock-site/packaging verifiers (no runner,
  recorder, renderer, or packaging source touched).
- **Result:** SRS + sweep complete; artifacts half-regenerated. Clean-machine gate still **Not
  Executed** and still blocks backend implementation. Nothing pushed; no PRs.

---

## 2026-07-22 — Claude (Opus 4.8) — Serialization Round-Trip Hardening (extraction + executable verifier)

- **Task:** close the most dangerous verification gap — the designer's model↔node-data converters had
  **no executable round-trip coverage** because they were module-private in a `.tsx` renderer page.
  Behavior-preserving only: no schema changes, renames, migrations, UI changes, or runtime changes.
- **Extraction:** `toFlowStep`, `toNodeConfig`, `createValueSource`, `fromFlowStep` moved verbatim from
  `app/renderer/pages/FlowChartDesigner.tsx` → new `app/renderer/components/workflow/flowStepMapping.ts`
  (also exports the `FlowDesignerNode`/`FlowDesignerEdge` aliases). Every import in the new module is a
  plain non-React module or `import type` (erased), so it carries **no React runtime** and `tsx` can load
  it. Both designer call sites unchanged in behavior; 5 now-dead imports removed from the page.
- **Proof of fidelity:** `diff` of the original block (backup lines 1125–1307) against the extracted
  functions with the `export ` prefix normalized → **183 lines each side, byte-identical**. No
  stop-and-report condition triggered by the extraction itself.
- **New verifier** `scripts/verify-flow-step-mapping.mts` (`verify:flow-step-mapping`) imports the REAL
  production functions — no copied logic. **59/59.** Covers all **12** `WaitCondition` variants,
  before/afterWaits, condition ORDER, response detail (method/URL/statusRange/arming/adaptive timeout
  not recalculated), loader lifecycle, required/optional true/false/absent, all 4 completion policies +
  absent-stays-absent, UI-outcome scaffold with empty text, `minRows:0`/`minItems:0`, legacy steps
  gaining nothing, defaults for missing optionals, clone + edit, and 3 cycles for gradual drift.
- **DEFECT FOUND — bead `awkit-cxa` (P1), pre-existing:** `fromFlowStep` never reads `step.value`, so a
  step with only `value` (no `valueSource`, not `goto`) is silently emptied by one designer open+save.
  Confirmed against real shipped data (`mock-conditional-flow.json`'s `condition` expression is
  destroyed). Scan of `resources/**`: 69 steps, 1 affected today. **Not** caused by the extraction
  (byte-identical). Current behavior **pinned** by two checks; the fix is a runtime behavior change and
  was excluded from this phase by scope.
- **Files:** `flowStepMapping.ts` (new), `FlowChartDesigner.tsx` (−183 lines, +import, −5 dead imports),
  `scripts/verify-flow-step-mapping.mts` (new), `package.json`, `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`.
- **Verification:** flow-step-mapping **59/0**, waits 48/0, async-review 21/0, recorder-flow 19/19,
  recorder 78/0, runner 82/0, protected-login 26/0, protected-login-recorder 45/45, mock-site 55/55,
  ipc-contract 4/4, `tsc --noEmit` clean, `npm run build` clean.
- **NOT RUN — `verify:settings-persistence` (BLOCKED, environmental).** It launches Electron, and
  `app.requestSingleInstanceLock()` (app/main/main.ts:17) makes a second instance quit immediately. An
  AWKIT dev instance has been running since 19:20 (the user's GUI walkthrough). Unrelated to this
  change; it passed 3/3 earlier in the same session. Re-run once no AWKIT Electron instance is open.
- **Also recorded:** GUI gate result 11/12 PASS + 11.3 BLOCKED by `awkit-y24`; and two corrections to
  the earlier packaged-gate claims (the `-mx=9` OOM is intermittent, not a fixed limit — it succeeded on
  retry; and the first packaged build predated awkit-54t).

---

## 2026-07-22 — Claude (Opus 4.8) — Mock Site: async results + empty state + HTTP status fixtures

- **Task:** unblock two Electron GUI gate checks that had **no fixture at all**, and file the design gap
  found while pre-flighting that gate. Fixtures only — no runner, recorder, or serialization logic changed.
- **Why:** a pre-flight of the 12-check GUI gate found (a) `mock-site/server.mjs` had no way to return a
  non-2xx status, so "HTTP 500 is reported as a status error, not a timeout" was unrunnable, and (b) no
  page anywhere had a table/list or empty-state panel (`grep -ci "table|tbody|empty" smart-waits.html` → 0),
  so the empty-result contract was unrunnable.
- **New scenario** `/async-results` (`mock-site/public/async-results.html`): loader + exactly one outcome
  per action — three fixed invoice rows (`results-table`, rows in `tbody`), a **valid empty result**
  (HTTP 200 + zero rows → table hidden, `empty-state` visible), or a selectable HTTP error
  (`error-banner`). Controls `load-populated`, `load-empty`, `load-error`, `error-code`,
  `results-delay-ms`, `reset-async-results`; event log; bounded delays only.
- **New endpoints:** `/api/status?code=&ms=` returns an **allow-listed** status (200/201/202/204/400/401/
  403/404/409/422/429/500/502/503/504; anything else → 500). **3xx is deliberately excluded** so the
  endpoint can never act as an open redirect. `/api/results?mode=populated|empty&ms=` returns three fixed
  rows or a 200 with zero rows — both successes, differing only in UI outcome.
- **Files:** `mock-site/public/async-results.html` (new), `mock-site/server.mjs` (+2 endpoints, +1 route,
  +2 constants), `mock-site/public/index.html`, `mock-site/README.md`, `scripts/verify-mock-site.mjs`.
- **Verification:** `verify:mock-site` **55/55** (was 39/39; +16 new checks incl. an explicit assertion
  that the empty branch renders **zero** rows so `tableHasRows` genuinely fails there, and that
  `?code=302` is refused). Regression `verify:waits` 48/0, `verify:runner` 82/0, `verify:recorder` 78/0,
  `npm run build` clean.
- **Bead filed — `awkit-y24` (P2):** grouped completion composition. `FlowStep.completionMode` is one
  per-step scalar over all `afterWaits`, giving only flat AND / flat OR, so `API success AND (tableHasRows
  OR emptyStateVisible)` is **not expressible**: `resolveAnyRequired` runs `Promise.any` across every
  required condition including the armed API response, so the API resolving first satisfies the step and
  neither UI outcome is ever required. Not a regression — missing expressiveness. Blocks GUI check 11
  configuration 3.
- **Not run / limitations:** the fixtures are not yet exercised end-to-end by a runner verifier (the
  HTTP-500 path is already covered inside `verify:waits`); the GUI gate itself still requires the
  credential holder. Promotion remains **UNAPPROVED**.

---

## 2026-07-22 — Claude (Opus 4.8) — awkit-54t: Async Completion editor + Recorder review-before-save

- **Task:** the UI layer over the awkit-62o async model (bead awkit-54t). Same branch; earlier commits
  (checkpoint + 62o) untouched.
- **Shared pure module** `src/profiles/asyncCompletionReview.ts` — statically classifies a step/action's
  waits + policy as **Reliable / Needs review / Incomplete / Unsafe** with contradiction warnings
  (response with no endpoint pattern; status range inverted / 200-only; empty/non-unique locator;
  fixedDelay-only or all-optional = no completion signal; networkThenUi without an API; anyRequired
  with <2 required; required table-rows vs empty-state outcome). `reviewWait`/`reviewStepAsync`/
  `summarizeReviews`/`classLabel`. Used by BOTH the designer and the recorder.
- **Flow Designer** (`FlowNodePropertiesPanel.tsx`): the old timeout-only "Smart Waits" section is now
  a full **Async Completion** editor — completion-policy `<select>` (allRequired/networkThenUi/
  anyRequired/quietPeriod → `FlowStep.completionMode`); **+ API / + Loader / + UI outcome** add buttons
  (add missing waits, not just remove); per-condition required/optional toggle, timeout, a
  classification badge + warnings, and type-specific field editors (response method/URL/status/arm;
  loader locator/grace/completion/mustAppear; text; table/list min counts). Shown for action nodes even
  when empty.
- **Recorder** (`Recorder.tsx`): Save now opens a **review-before-save modal** (reused `.modal-*`
  system) when the recording captured async activity — per-action classification + warnings + summary
  counts; "Keep editing" / "Save to Flow Library". No async activity → saves directly.
- **Files:** `src/profiles/asyncCompletionReview.ts` (new), `scripts/verify-async-review.mts` (new) +
  `verify:async-review` script, `FlowNodePropertiesPanel.tsx`, `Recorder.tsx`, `global.css`.
- **Verification (all green):** `verify:async-review` **21/0**; regression `verify:waits` 48/0,
  `verify:recorder-flow` 19/19, `verify:runner` 82/0, `verify:recorder` 78/0, `verify:protected-login`
  26/0, `verify:protected-login-recorder` 45/45, `verify:settings-persistence` 3/3, `verify:ipc-contract`
  4/4, `verify:mock-site` 39/39, `npm run build` clean. Built renderer bundle contains the new UI.
- **Not run / limitations:** the "Test locators against the active recorded page" affordance from the
  prompt is not implemented (needs a live recorded page — deferred). GUI click-through of the editor/
  modal is behind the Electron auth gate (same manual gate as before); the interactive walkthrough is
  user-driven.

## 2026-07-22 — Claude (Opus 4.8) — awkit-62o: loader lifecycle + completion policies + consistency

- **Task:** the runtime completion-policy + loader-lifecycle follow-up (bead awkit-62o), extending the
  canonical `WaitCondition`/`beforeWaits`/`afterWaits` model — NOT a parallel field. Same branch;
  prior commits (`eabd555`, `34c9e47`, beads chore) treated as an accepted checkpoint (not amended).
- **Model (FlowProfile.ts):** `WaitConditionBase.optional?`; `loaderHidden` gains
  `appearanceGraceMs?/mustAppear?/completion?` (+ `LoaderCompletion`); `FlowStep.completionMode?`
  (+ `AsyncCompletionMode` = allRequired|anyRequired|networkThenUi|quietPeriod). All additive.
- **Two-phase loader lifecycle (StepExecutor):** appearance watch armed BEFORE the action (a late
  spinner is never skipped); after the action, wait up to `appearanceGraceMs` for it to appear, then
  for the `completion` signal (hidden/detached/aria-busy=false). Optional-never-appears passes;
  required-never-appears + never-disappears produce precise diagnostics (`formatLoaderLifecycleFailure`).
- **Completion policies (`resolveAfterWaits` dispatcher):** allRequired (default, = legacy),
  anyRequired (`Promise.any`), networkThenUi (network→loaders→UI phases), quietPeriod (request-start
  observer + no-blocking-loader). Consistency failures: API-ok-but-UI-missing, API-failed-but-UI-changed,
  loader-still-blocking (`formatConsistencyFailure`); valid empty-result states pass (engine never
  forces table rows). Optional conditions are best-effort everywhere.
- **Cancellation:** new `withCancellation` races every wait against the token; the quiet loop also
  polls `throwIfCancelled` — Stop interrupts API/loader/quiet/UI waits in <2s (verified).
- **Progress:** `emitWaiting` emits `waiting` events naming the endpoint/loader/UI condition, resolved
  timeout, and required/optional status.
- **Round-trip:** `completionMode` carried through the designer allowlist (`fromFlowStep`/`toFlowStep`
  + `FlowDesignerNodeData`); extended wait fields ride in the whole-array `afterWaits`. Recorder emits
  the lifecycle on recorded loaders (grace 1500, mustAppear false) via new `loaderAppearanceGraceMs`
  option + `asyncAwareness.loaderAppearanceGraceMs` setting (validated).
- **Files:** `FlowProfile.ts`, `StepExecutor.ts`, `smartWaitObservation.ts`, `RecorderService.ts`,
  `app/main/uiSettings.ts`, `flowDesignerTypes.ts`, `FlowChartDesigner.tsx`, `scripts/verify-waits.mts`,
  `scripts/verify-recorder-flow.mts`.
- **Verification (all green):** `verify:waits` **48/0** (loader lifecycle ×7, policies+consistency ×8,
  cancellation ×4), `verify:recorder-flow` 19/19, `verify:recorder` 78/0, `verify:runner` 82/0,
  `verify:cancellation` 12/0, `verify:protected-login` 26/0, `verify:protected-login-recorder` 45/45,
  `verify:settings-persistence` 3/3, `verify:ipc-contract` 4/4, `verify:mock-site` 39/39,
  `verify:security` 39/0, `verify:popup` 12/0, `verify:safety-policy` 17/0, `npm run build` clean.
- **Limitations:** quietPeriod window is a runtime constant (750ms), not per-step; the request-start
  observer is active-page-scoped (popup/iframe network not folded in); no Async Completion editor UI
  yet (awkit-54t) — recorded/imported `completionMode` round-trips but is not user-editable.
- **Manual gates still outstanding:** Electron GUI walkthrough + packaged/offline validation.

## 2026-07-22 — Claude (Opus 4.8) — Async Activity Awareness: status-vs-timeout + adaptive timeouts (Phase B of 2)

- **Task:** Phase B of the same prompt — extend the EXISTING `WaitCondition`/`beforeWaits`/`afterWaits`
  model (the canonical async model) rather than fork a parallel `AsyncActivityGroup`, keeping the
  fragile flow round-trip intact. Same branch. Not pushed.
- **Response status vs. timeout (the #1 named runtime bug):** `StepExecutor.buildResponseWait` matched
  on status INSIDE the `waitForResponse` predicate, so an immediate HTTP 500 never matched and became
  a misleading timeout. Refactored: match endpoint (method + urlContains) only, then
  `validateResponseStatus` throws a `ResponseStatusError` with a clear "API returned HTTP 500 for POST
  /path (expected 200–299)…" message routed through a new `formatResponseStatusFailure` (never the
  timeout formatter). Applied to both the armed-before-action path and the deferred path.
- **Adaptive dynamic bounded timeouts:** `smartWaitObservation.buildSmartWaits` now derives
  `timeoutMs = clamp(observed×multiplier + safetyMargin, min, max)` (defaults 3× / +5000 / [10000,
  300000]) for `response` + `loaderHidden` waits, exposed via new `SmartWaitBuildOptions`
  (`adaptiveTimeouts`, `minimumTimeoutMs`, `maximumTimeoutMs`, `timeoutMultiplier`,
  `timeoutSafetyMarginMs`) + exported `adaptiveTimeoutMs()`. Reason strings state the observed ms.
- **Settings:** `recorder.asyncAwareness {enabled, adaptiveTimeouts, minimumTimeoutMs,
  maximumTimeoutMs}` in `uiSettings.ts` — **deep-merged** in `hydrate`/`mergePatch` (nested block must
  not drop siblings), validated/clamped in `validateSettings` (no unlimited timeout). Threaded through
  `recorder:start` → `RecorderService.startRecording` → `attachSmartWaits`.
- **Round-trip:** async waits (incl. adaptive `timeoutMs`) copied whole-array by `buildRecordedFlow`
  and `flowProfileMapping`; new `verify:recorder-flow` assertions prove they survive JSON save.
- **Files:** `StepExecutor.ts`, `smartWaitObservation.ts`, `app/main/uiSettings.ts`,
  `app/main/ipc/recorder.ipc.ts`, `RecorderService.ts`, `scripts/verify-waits.mts`,
  `scripts/verify-recorder-locator.mts`, `scripts/verify-recorder-flow.mts`.
- **Verification (all green):** `verify:waits` 26/0 (incl. HTTP-500-is-not-a-timeout) ·
  `verify:recorder` 78/0 (incl. 6 adaptive-timeout units) · `verify:recorder-flow` 16/16 (round-trip) ·
  `verify:runner` 82/0 · `verify:settings-persistence` 3/3 · `verify:protected-login` 26/0 ·
  `verify:protected-login-recorder` 45/45 · `npm run build` clean.
- **Deferred (filed as follow-ups):** loader appearance-grace/mustAppear runtime lifecycle;
  quietPeriod/networkThenUi/allRequired/anyRequired completion policies + UI-outcome consistency
  failures; 202 job-status polling + response-field predicate; WebSocket/SSE + CDP diagnostics; Flow
  Designer "Async Completion" editor UI; Recorder review-before-save UI; context-level authoritative
  network source. Core correctness (status, adaptive bounded timeouts, arm-before-action, cancellation)
  and the canonical model + round-trip are in place.

## 2026-07-22 — Claude (Opus 4.8) — Recorder protected-login controls + SSO false-positive fix (Phase A of 2)

- **Task:** implement `AWKIT_RECORDER_PROTECTED_LOGIN_AND_ASYNC_ACTIVITY` prompt, phased & regression-safe.
  Phase A = protected-login controls; Phase B (async activity engine) to follow. Branch
  `feature/recorder-protected-login-and-async-awareness` (off main). Not pushed.
- **Root cause:** `src/security/ProtectedLoginDetector.ts` treated plain text "single sign-on" /
  "identity provider" as `reason: sso` with **no confidence level**, and the recorder auto-paused +
  closed the browser on any `detected`. Normal internal HTTPS apps containing that phrase paused.
- **Detector:** added `confidence` (`low|medium|high`) + `recommendedAction` (`continue|warn|pause`).
  Only text-only `sso` (no provider host, no DOM affordance) → low/continue; providers, CAPTCHA, MFA,
  passkey, security-check, and a detected password field all stay `pause`. Pure `classifyProtection`.
- **RecorderService:** pause now gated on `recommendedAction === "pause"` + ignore controls
  (session override, global setting, per-session loop-guard keys). `beginHandoff` now keeps the
  automation browser OPEN during the "detected" phase (closed only on manual handoff) so
  "Ignore and continue recording" (`ignoreCurrentProtectedDetection`) resumes the same page; added
  `if(!isRecording)return` guards to the `__awtkit_recordAction`/`__awtkit_recordSignal` bindings so
  nothing on a protected page is ever recorded while paused.
- **Runner:** the two auto-pause entry points in `StepExecutor.ts` (post-nav + popup) also gate on
  `recommendedAction === "pause"`; manual-handoff retry loop + explicit ManualHandoff node unchanged.
- **Settings:** `recorder.ignoreProtectedLoginDetection` (default false) in `app/main/uiSettings.ts`;
  read server-side in `recorder:start`. New IPC `recorder:ignoreProtectedDetection` + preload method.
  Settings page card with confirmation dialog (immediate persist); Recorder page "Ignore and continue
  recording" button + non-blocking session notice.
- **Mock site:** new `/mock/sso-text-app` false-positive fixture. **Files:**
  `ProtectedLoginDetector.ts`, `RecorderTypes.ts`, `RecorderService.ts`, `StepExecutor.ts`,
  `app/main/uiSettings.ts`, `app/main/ipc/recorder.ipc.ts`, `app/main/preload.ts`,
  `app/renderer/pages/{Recorder,Settings}.tsx`, `app/renderer/styles/global.css`,
  `scripts/verify-protected-login{,-recorder}.mts`, `mock-site/public/secure-login/sso-text-app.html`,
  `mock-site/README.md`.
- **Verification (all green):** `verify:protected-login` 26/0 · `verify:protected-login-recorder` 45/45
  · `verify:runner` 82/0 · `verify:mock-site` 39/39 · `verify:waits` 21/0 · `verify:recorder` 72/0 ·
  `verify:settings-persistence` 3/3 · `verify:ipc-contract` 4/4 · `npm run build` clean.
- **Not run:** clean-machine / packaged-EXE GUI walkthrough (Recorder handoff card is Electron-only —
  manual gate). Phase B (async engine) pending.

## 2026-07-19 — Claude — Fix all E2E-assessment defects (DEF-003/004/005 + OBS-001/002)

- **Task:** implement the plan to fix the open E2E-QA findings on `main` @ `0a4500f` — sender-bound
  trusted authorization, remove first-run seeding, footer nav, status labels, reauth-window override.
- **Fix A (DEF-003 / bd `awkit-64x`):** removed first-run sample seeding — `profileStores.ts`
  `seedFolder` dropped; `dataSource.ipc.ts` `ensureDefaultDataSource` + `runtimeInput.ipc.ts`
  `ensureDefaultRuntimeInputs` deleted (stores return `store.list()`). Samples stay in `resources/`
  via `seed:mock-fixtures`.
- **Fix B (DEF-004 / bd `awkit-b92`):** new `app/main/security/sessionContext.ts` — main-owned,
  sender-bound session registry (`event.sender.id → sessionRef`; bound on login/change-password/
  validate, unbound on logout/destroy/expiry, match-guarded). `assertSenderPermission(event, perm)`
  gates `execution:*` (real-run/repeat/recovery = EXECUTE; pause/resume/stop/… = STOP; dry-run open),
  flow/workflow CRUD (create/clone/import = CREATE, update = EDIT, delete = DELETE), data-source CRUD
  = DATASOURCE_MANAGE, substantive `settings.update`/reset/import = SETTINGS_EDIT. Fails closed.
  Renderer B4 gating via `usePermissions().can()` across libraries, designers, DataSource pages,
  InstanceMonitor (+ `NodeOptionsMenu`/`WorkflowRunCard` disabled props).
- **Fix C (DEF-005):** footer Settings filtered by `can(PAGE_SETTINGS)`; Help Center universal
  (`projectContract` dropped from `RoutePermissions` + the System nav group).
- **Fix D/E:** StatusBar → "Active flows/browsers" (OBS-001); `AWKIT_REAUTH_WINDOW_MS` dev/test
  override wired through `SecurityKernelOptions.reauthWindowMs` (OBS-002).
- **New files:** `app/main/security/sessionContext.ts`, `scripts/verify-session-context.mts` +
  `verify:session-context` alias.
- **Modified (main):** `profileStores.ts`, `ipc/{dataSource,runtimeInput,execution,flow,scenario,settings,
  security}.ts`, `security/{SecurityKernel,securityKernel}.ts`. **(renderer):** `LeftNavigation`,
  `routePermissions`, `StatusBar`, `WorkflowsLibrary`, `FlowLibrary`, `DataSourceManager`,
  `DataSourceEditor`, `FlowChartDesigner`, `ScenarioBuilder`, `InstanceMonitor`, `WorkflowRunCard`,
  `components/shared/NodeOptionsMenu`. **(tests):** `verify-e2e-rbac-gui.mjs`, `verify-e2e-route-sweep.mjs`.
- **Tests (all green):** build clean; `verify:session-context` 11/11; `verify:e2e-rbac` **49/49**;
  `verify:e2e-sweep` 13/13; `verify:e2e-auth` 30 · `verify:e2e-licensing` 22 · `verify:runner` 82 ·
  `verify:authz` 40 · `verify:auth` 49 · `verify:security` 39 · `verify:licensing` 56 ·
  `verify:ipc-contract` 4 · `verify:auth-gui` 18 · `verify:admin-gui` 11 · `verify:avatar` 24.
- **Beads:** closed `awkit-64x` + `awkit-b92`; filed Oracle-backend-gating (P2) + `awkit-2d8`
  (live ReauthDialog GUI, P3); `bd remember` key `sender-bound-authz`.
- **Merged to `main` via PR #22 (`79e9999`).** Residual: `oracle.ipc.ts` backend not yet gated (UI gated); live GUI ReauthDialog
  not automated (a global short reauth window would destabilize the single-launch seed flow).

---

## 2026-07-19 — Claude — E2E QA assessment: executable suites + reports (bd awkit-xyo)

- **Task:** complete the adapted full E2E QA of `main` @ `0a4500f` (prior session did discovery +
  coverage matrix + specs; this session wrote and ran the executables, healed test defects, and
  produced the reports).
- **New files:** `scripts/lib/e2e-qa-lib.mjs` (shared login/nav/admin/direct-IPC drivers),
  `scripts/verify-e2e-auth-gui.mjs`, `scripts/verify-e2e-rbac-gui.mjs`,
  `scripts/verify-e2e-licensing-gui.mjs`, `scripts/verify-e2e-route-sweep.mjs`,
  `docs/testing/E2E_EXECUTION_REPORT.md`, `docs/testing/E2E_DEFECTS.md`; 4 npm aliases (`verify:e2e-*`).
- **Modified:** `scripts/verify-auth-gui.mjs` + `scripts/verify-admin-gui.mjs` (healed stale
  post-PR-#21 selectors — E2E-DEF-001/-002), `package.json`, `docs/testing/E2E_COVERAGE_MATRIX.md`,
  `docs/ai/{CURRENT_STATE,TESTING,COMMANDS,KNOWN_ISSUES,TASK_LOG,HANDOFF}.md`.
- **Tests run (all green):** `verify:e2e-auth` 30/30 · `verify:e2e-rbac` 42/42 ·
  `verify:e2e-licensing` 22/22 · `verify:e2e-sweep` 13/13 · repaired `verify:auth-gui` 18/18 ·
  `verify:admin-gui` 11/11 · regression `verify:licensing` 56 / `verify:avatar` 24 /
  `verify:ipc-contract` 4 / `verify:authz` 40 / `verify:auth` 49. Build was green at session start;
  no production code changed.
- **Findings:** product defect bd `awkit-64x` (fresh install seeds bundled samples as real records);
  documented gaps on bd `awkit-b92` (settings/execution IPC not role-gated; footer nav unfiltered);
  2 test defects fixed. Full detail: `docs/testing/E2E_DEFECTS.md`.
- **Result:** assessment complete; external gates (packaged EXE, clean-machine VM, multi-day soak)
  remain out of scope on this host.

---

## 2026-07-19 — Claude — Admin/Licensing package: Phase 6 (validation) + Phase 7 (docs)

- **Validation:** `npm run build` (tsc + bundles) clean; `verify:licensing` 56/56; `verify:avatar` 24/24;
  real-key issuer→app E2E (VALID on this machine, MACHINE_MISMATCH elsewhere, masked serial). Security scan:
  no private-key material in tracked files or the working tree (`git grep`/grep for the PKCS8 literal =
  empty); only the **public** key in `TrustedKeys.ts`; `electron-builder.json` ships `out/**` only so
  `tools/**` (issuer) is never bundled. Bypass resistance is by construction — enforcement + RBAC live in the
  main process; renderer holds display hints only.
- **Docs:** new **`docs/LICENSING.md`** (architecture, security/threat model, user+admin guidance, developer
  reference, migration, and the Phase 6 validation matrix). `docs/ai/CURRENT_STATE.md` updated with the
  whole package. Filed follow-up beads: `awkit-1cc` (hard-enforcement rollout decision) + the global-status/
  periodic-revalidation task.
- **External gates NOT run this session (unchanged):** clean-machine offline VM walkthrough, packaged
  NSIS/portable EXE run, and the live Electron GUI walkthrough (Browser-pane preview was unavailable; UI was
  verified via Playwright screenshots against the real `global.css`). No commit/push (local-only, per request).

## 2026-07-19 — Claude — Admin/Licensing package: Phase 5 (licensing UI + trusted enforcement + RBAC)

- **RBAC:** added granular licensing permissions to `src/security/authz/Permissions.ts`
  (`license.view/export_request/import/replace/revoke/audit.view`), Super-User-only (Administrator/
  Operator/Viewer excluded — filter now drops all `license.*` + `page.license`); import/replace/revoke are
  SENSITIVE (require fresh reauth). Verified by 8 RBAC assertions in `verify:licensing`.
- **Trusted main-process runtime** `app/main/licensing/licenseRuntime.ts`: single `LicenseService` wired to
  real machine fingerprint + adaptive store (LocalAppData primary, ProgramData optional-read). Enforcement
  is **OPT-IN, default OFF** (`SPECTER_LICENSE_ENFORCE=true`) so existing/unlicensed installs are NOT
  blocked until an operator turns it on. `evaluateRunGate()` gates only REAL runs.
- **Enforcement point:** `execution.ipc.ts` `runWorkflow` — before `executionEngine.startRun` (validation/
  dry-run stay available so diagnostics/reports work). Blocked run returns `status:"licenseBlocked"` with a
  safe action message; never throws. Machine/installation check, independent of auth/RBAC.
- **IPC** `app/main/ipc/licensing.ipc.ts` (registered in `ipc/index.ts`): getStatus/revalidate/
  exportRequest/import/replace/revoke/remove — each sender-guarded, RBAC-checked (deny-by-default), sensitive
  ops reauth-gated, all audited into the shared trail (`targetType:"license"`, safe reason codes, no
  secrets). Preload `window.playwrightFlowStudio.licensing.*` added.
- **UI:** `LicensingPage.tsx` rewritten from placeholder to a full page using the shared admin kit —
  status badge + actionable guidance, masked serial, license id, local-time issued/valid-from/expiry,
  remaining, entitlements, source + conflict banner; machine code + copy + export activation request;
  import/replace/revoke/remove with reauth dialog; loading / permission-denied states. Route description
  updated (no longer "placeholder"). Licensing CSS + `toolbar-button.danger` added (tokens only).
- **Verified:** `npm run verify:licensing` = **56/56** (48 domain + 8 RBAC). `npm run build` (tsc) clean.
  Visual proof of the page (valid state) in light+dark via Playwright screenshot of the real `global.css`.
- **Deferred (noted for Phase 6/7 + beads):** app-wide non-intrusive global status banner and a periodic
  background revalidation timer (the gate already revalidates before each run); enforcement default-OFF
  rollout decision. No commit/push.

## 2026-07-19 — Claude — Admin/Licensing package: Phase 4 (licensing core, offline, per-machine)

- **New bounded context `src/licensing/*`** — independent of auth/RBAC (imports nothing from
  `src/security/*`): `LicenseTypes.ts` (schema v1, 11 statuses, entitlements, activation request, safe
  views, policy), `MachineFingerprint.ts` (SHA-256 over multiple normalised non-admin signals — Windows
  MachineGuid, cpu model/count, mem, platform, first stable MAC, hostname — tolerant of missing signals,
  confidence high/medium/limited, **no IP/hostname-alone/MAC-alone**, raw values never stored),
  `LicenseCanonical.ts` (deterministic signed-bytes + activation request), `crypto/TrustedKeys.ts` (PUBLIC
  keys only; key1 embedded), `crypto/LicenseSignature.ts` (Ed25519 verify for the app; issuer-only sign
  helper), `LicenseValidator.ts` (precedence CORRUPTED→UNSUPPORTED→INVALID_SIGNATURE→MACHINE_MISMATCH→
  REVOKED→CLOCK_INTEGRITY_WARNING→NOT_YET_VALID→EXPIRED→EXPIRING_SOON→VALID; exact-timestamp expiry),
  `store/LicenseStore.ts` (adaptive LocalAppData-primary / ProgramData-optional-read, atomic temp+rename,
  SHA-256 corruption detection, precedence + conflict flag), `LicenseService.ts` (orchestration:
  status/import/replace/revoke/remove/export, clock high-water maintenance).
- **Separate offline issuer `tools/license-issuer/`** (NOT bundled — app ships from `app/**`+`out/**`):
  `keygen.mts`, `issue-license.mts`, `README.md`. Private key sourced from an external path
  (`%LOCALAPPDATA%\SpecterStudio\issuer-keys\`) / `SPECTER_ISSUER_KEY` — never in repo/resources/.env.
- **Storage decision** implemented per user direction (bead memory `licensing-storage-decision`): per-user
  location for admin-free activation; machine binding enforced ONLY by the signed fingerprint, so a copied
  license fails MACHINE_MISMATCH regardless of directory.
- **Verified:** `npm run verify:licensing` = **48/48** (valid/invalid signature, payload modification,
  unsupported schema+algorithm, machine match/mismatch, missing-signal tolerance, exact valid-from/expiry
  boundaries, expiring-soon, revoked, corrupted storage, atomic import/replace, precedence/conflict,
  activation export). Real-key E2E (issuer signs w/ external key1 → app validates w/ embedded public key):
  VALID on this machine, MACHINE_MISMATCH elsewhere, serial masked, high-confidence 7-signal fingerprint.
  `npm run build` (tsc) clean.
- **Security posture:** public key only in app; no private key in repo/package; no IP binding; licensing
  isolated from auth/RBAC. Full threat-model/security-doc write-up deferred to Phase 7 (docs phase).
- **Not done:** Phase 5 (Licensing UI + trusted IPC enforcement + audit), Phase 6 (validation), Phase 7
  (docs). No commit/push.

## 2026-07-19 — Claude — Admin/Licensing package: Phase 2 (admin UI kit) + Phase 3 (profile avatar)

- **Phase 2 (Administration UI):** Added a shared admin UI kit `app/renderer/pages/admin/components/AdminUi.tsx`
  (`AdminPage`, `AdminBanner`, `AdminStatusBadge`, `AdminLoading`, `AdminEmpty`). One status-badge
  vocabulary (13 states: active/valid/disabled/locked/expiring/archived/not-activated/expired/revoked/
  invalid-signature/machine-mismatch/corrupted/not-yet-valid) — icon + text, theme-aware, never colour
  alone; unknown status falls back to a neutral badge with the raw text. Refactored UserManagement, Roles,
  Permissions, and AuditLog pages to compose the kit; removed the login-spinner leak into admin. Audit
  "Refresh" now publishes through the canonical `TopHeader` via `usePageChrome` instead of a card button.
  Route authorization was already enforced (`RoutePermissions` + nav filter + route-mount guard + IPC) and
  is preserved untouched. Deferred (needs live-UI verification): row-action overflow menus, table
  search/sort/pagination — current buttons still work.
- **Phase 3 (Profile avatar):** New shared, DOM-free `app/renderer/lib/initials.ts` (Unicode grapheme-aware
  via `Intl.Segmenter`): `initialsFromName`, `initialsFromIdentity` (displayName→username→email local
  part→"?"), `avatarPaletteIndex` (deterministic FNV-1a → stable colour). New `UserAvatar` (image→initials→
  "?", 6-tone deterministic palette) and `AccountMenu` (avatar + name + role trigger → popover with Sign
  out; keyboard + click-outside + origin-anchored pop, reduced-motion aware). `AppFrame` now renders the
  account menu instead of the plain name+logout. Note: `PrincipalSnapshot` has no profile-image field yet,
  so image source is wired but inactive (honest to the current model). Verifier `npm run verify:avatar`
  (`scripts/verify-avatar-initials.mts`) = **24/24** incl. MA/SK/MO/M, Arabic multi/single word, combining
  marks, whitespace/punctuation, email fallback, missing identity, deterministic palette.
- **Files:** admin: `pages/admin/components/AdminUi.tsx` (new), `UserManagement.tsx`, `RolesPage.tsx`,
  `PermissionsPage.tsx`, `AuditLogPage.tsx`; avatar: `lib/initials.ts` (new),
  `components/shared/UserAvatar.tsx` (new), `components/shared/AccountMenu.tsx` (new), `layout/AppFrame.tsx`;
  `styles/global.css`; `scripts/verify-avatar-initials.mts` (new) + `package.json` (verify:avatar).
- **Verified:** `npm run build` passes (tsc clean); `npm run verify:avatar` 24/24; visual proof via
  Playwright screenshots of the real `global.css` (admin badges/states, avatar + account menu) in light+dark.
- **Not done:** Phases 4–7 (licensing core + integration, validation, docs). No commit/push.

## 2026-07-19 — Claude — Admin/Licensing package: Phase 0 audit + Phase 1 login branding

- **Scope:** Audited the external 8-phase `specterstudio-admin-licensing-phases` package against the
  codebase, then executed Phase 1 (login-screen branding) using the `apple-design` skill for the UI work.
- **Phase 0 (audit):** Login uses a generic `Workflow` lucide glyph (not the product logo); official vector
  exists at `logos/specter-violet/export/logo.svg` (+ PNG exports); admin pages exist but share no admin
  shell (Phase 2 work); `PrincipalSnapshot` has no profile-image field (Phase 3); `LicensingPage` is a pure
  placeholder, bead `awkit-s05` already tracks it (Phases 4–5). No IP-binding / private-key-in-package
  issues exist today (nothing implemented yet).
- **Phase 1 changes:** Copied the official logo to `app/renderer/assets/brand/specter-logo.svg`; imported it
  into `LoginScreen.tsx` and rendered it as the brand mark (self-contained squircle, standalone — not in the
  accent-soft box), with an `onError` fallback to the existing `Workflow` glyph so a failed asset never
  shows a broken image. Added `.awkit-login-logo` CSS (64px, vector = sharp on high-DPI). Added
  `app/renderer/types/assets.d.ts` ambient module decl for `*.svg`/`*.png` imports.
- **Files:** `app/renderer/security/screens/LoginScreen.tsx`, `app/renderer/styles/global.css`,
  `app/renderer/types/assets.d.ts`, `app/renderer/assets/brand/specter-logo.svg` (new).
- **Verified:** `npm run build` passes (tsc --noEmit clean; logo bundled as `assets/specter-logo-*.svg`).
  Visual proof via a Playwright screenshot of the real `global.css` login card in light + dark (Browser
  pane preview was timing out). Auth behavior, AD "Coming soon" tab, lockout, and session flow unchanged.
- **Not done:** Phases 2–7 (admin UI shell, profile/avatar, licensing core + integration, full validation,
  docs) remain. No commit/push (conservative profile; awaiting direction).

## 2026-07-19 — Claude — Super User administration + RBAC authorization (Phase 3)

- **What:** built the authorization/administration layer the auth core lacked — RBAC + Super User admin +
  user management, per the design plan (Phase 3/11/12). On branch `feature/superuser-admin-rbac`.
- **Backend:** `authz/Permissions.ts` (registry + built-in SuperUser/Administrator/Operator/Viewer roles +
  effectivePermissions), `authz/AuthorizationService.ts` (requirePermission = the real deny-by-default
  boundary + requireFreshReauth 5-min window), `admin/UserAdminService.ts` (create/update/enable/disable/
  archive/reset/revoke with final-active-SU protection, protected-SU immutability, no escalation, session
  invalidation on security change, audit). Schema migration v2 (roles column + archived status);
  AuthenticationService.reauthenticate + roles/permissions in PrincipalSnapshot; SessionManager reauth
  helpers; SecurityStore list/roles/audit-read + SU counts. 9 `security:admin:*` + `security:reauth` IPC
  (authorization-enforced, schema-validated) + preload.
- **Renderer:** `usePermissions`/`RoutePermissions` gate nav + route mount (`NotAuthorized`); Super User
  Administration area — Users (CRUD + role editor + reauth modal), Roles, Permissions matrix, Audit Log,
  Licensing placeholder; token-only `.awkit-admin-*` CSS.
- **Decisions resolved:** O-1 scrypt, O-2 built-in roles, O-4 roles-only v1, O-5 fresh login; O-8 recovery
  codes deferred; licensing left as a clean placeholder (Phase 5).
- **Files:** new `src/security/{authz/Permissions,authz/AuthorizationService,admin/UserAdminService,
  ipc/SecurityAdminIpcSchema}.ts`, `app/renderer/security/{usePermissions,routePermissions,NotAuthorized}`,
  `app/renderer/pages/admin/*` (6 files), `scripts/verify-{authz,admin-gui}`; modified SecurityStore(+Schema),
  AuthenticationService, AuthTypes, ReasonCodes, SessionManager, SecurityKernel, security.ipc, preload,
  routes.tsx, LeftNavigation, App.tsx, global.css, package.json.
- **Tests:** `npm run build` clean; **verify:authz 40/40**, **verify:admin-gui 10/10** (real Electron),
  **verify:auth 49/49**. Backend committed locally (part 1); renderer + tests pending local commit (part 2).
  Follow-ups: SU recovery codes, per-user overrides/custom roles (v2), machine licensing (Phase 5), AD.

---

## 2026-07-19 — Claude — SecurityStore debounced persistence (awkit-ekd.8)

- **What:** `SecurityStore` exported + fsynced the whole DB on every mutation (login ≈ 4 full writes; the
  idle-lock heartbeat's `touchSession` wrote on every validate). Adopted `SqliteRuntimeStore`'s debounced +
  persist-on-critical-transition + flush-on-close model.
- **Criticality split:** critical/immediate = `setProvisioned`, `insertUser`, `updateUser`, `revokeSession`,
  `revokeSessionsForUser`, `revokeSessionsForUserExcept` (a provisioned/changed/revoked credential must
  survive a crash). Debounced (300 ms) = `insertSession`, `touchSession`, `appendAudit`. A critical flush
  exports the whole in-memory DB, so it sweeps up any pending debounced write; `close()` force-flushes the
  trailing write; `open()` still forces the initial schema write. Crash-before-debounce is fail-closed
  (re-login / slightly-stale idle / missing forensic row).
- **Implementation:** `persist(critical=false)` marks dirty + either flushes now (critical, awaited) or arms
  a single unref'd debounce timer; `persistNow()` → `flushDirty()` (dirty guard, atomic temp+rename, re-arm
  dirty + rethrow on failure). Added a test-only `persistWriteCountForTest()`.
- **Files:** `src/security/store/SecurityStore.ts`, `scripts/verify-auth.mts` (+4 debounce checks).
- **Tests:** `npm run build` clean; **verify:auth 49/49** (was 45), **verify:auth-gui 18/18** (real Electron,
  DPAPI + real close-on-quit), **verify:security 39/39**, **verify:single-instance 3/3**. Closes `awkit-ekd.8`.

---

## 2026-07-19 — Claude — Proactive idle-lock UI + dark-mode login pass (awkit-l6h)

- **Proactive idle lock (renderer):** `SecurityGate` now tracks user activity (pointer/keyboard/wheel/
  scroll/touch) while authenticated and locks after the idle window WITHOUT waiting for a focus/visibility
  event — returns to the login screen with a *"You were signed out after N minutes of inactivity."* notice.
  The same heartbeat, while the user is genuinely active, refreshes the server's sliding idle window
  (`validateSession`) so a continuously-used, never-blurred window isn't logged out at 30 min, and catches
  server-side invalidation. Tick/refresh cadence scale off the idle window.
- **Idle window exposed:** `SessionManager.idleTimeoutMs` getter → `SecurityKernel.getBootState().idleTimeoutMs`
  → renderer. Electron binding honors a numeric `AWKIT_SESSION_IDLE_MS` dev/test override (production keeps
  `DEFAULT_SESSION_POLICY` 30 min / 12 h).
- **Dark-mode login pass:** added `.awkit-login-notice` (info-toned, theme-aware) and a dark-mode assertion +
  screenshot to the login verifier.
- **Files:** `app/renderer/security/SecurityGate.tsx`, `app/renderer/security/screens/LoginScreen.tsx`,
  `app/renderer/styles/global.css`, `src/security/SecurityKernel.ts`, `src/security/session/SessionManager.ts`,
  `app/main/security/securityKernel.ts`, `app/main/preload.ts`, `scripts/verify-auth-gui.mjs`.
- **Tests:** `npm run build` clean; **verify:auth-gui 18/18** (was 13/13; +dark-mode, +proactive-lock via a
  4s `AWKIT_SESSION_IDLE_MS`), **verify:auth 45/45**. Screenshots `reports/security-login/login-dark.png` +
  `login-idle-locked.png` inspected. On branch `feature/proactive-idle-lock`; nothing committed yet.

---

## 2026-07-19 — Claude — Oracle Drivers GUI verifier: self-contained isolated profile + gate auth (awkit-xjv)

- **What:** `verify-oracle-drivers-gui.mjs` was the one GUI verifier the awkit-gmn shared-harness fix didn't
  resolve on its own — it launched against the developer's REAL profile (so PR #15's SecurityGate blocked
  the app shell) and depended on the real validation store. Reworked it to be self-contained + non-destructive
  like the others.
- **How:** launch on an **isolated empty `%LOCALAPPDATA%`** (`isolatedLaunchEnv`), then **copy** the
  validation stores (`java-runtimes` + `oracle-drivers`) from the source profile into it before launch. The
  copy resolves to the same ids because the Java record holds a machine-global `java.exe` path and the driver
  bundle's managed dir carries its own jar (manifest uses a **relative** `jdbcJar`). Then `signInFirstRun`
  past the SecurityGate, and reach Settings via **nav-item clicks** instead of `win.reload()` (a reload
  re-mounts the gate and drops the session — same lesson as capacity-settings); the post-save re-render is a
  nav bounce (`remountSettings`) rather than a reload. Source profile overridable via
  `AWKIT_GUI_SOURCE_LOCALAPPDATA`; a clear `exit 2` if the validation store is absent.
- **Non-destructive:** the real profile is only **read** (copied from); all writes (probe profile, sign-in,
  set-default) land in the temp profile, which `cleanup()` deletes.
- **Files:** `scripts/verify-oracle-drivers-gui.mjs` (removed the local `resolveMainWindow`/`env`, added
  seed-copy + `gotoSettings`/`remountSettings` nav helpers + first-run auth). No `src/` change.
- **Tests:** `npm run build:oracle-bridge` OK; **verify:oracle-drivers-gui 30/30 twice** (was blocked by the
  gate) — real bridge launches Java 17.0.8 + loads the real ojdbc `23.26.2.0.0` end-to-end; no temp-profile
  leftovers. Requires the Oracle validation env (real java.exe + ojdbc jar). bd `awkit-xjv` CLOSED.

---

## 2026-07-19 — Claude — Flow Designer GUI verifier: modernize stale geometry assertions (awkit-9p6)

- **What:** the 5 flow-designer geometry checks asserted the pre-Hologram **docked-column** model
  (`canvasEngineRight <= panelLeft`, `panelRight <= canvasRight`, `panelTop ≈ canvasAreaTop`, and
  engine-width-grows-on-collapse). The design is now a **floating overlay drawer** — measured the live
  geometry and rewrote them to the real invariants.
- **Measured (real Electron):** expanded drawer → `.react-flow-shell` keeps the **full canvas width**
  (1200/1696/784 == canvasWidth at 1440/1936/1024), fixed **435px** drawer floats over the right edge with
  a consistent **~1.8px** overhang past `canvasRight`, `panelTop` 2–3px below `canvasAreaTop` (below the
  action bar); collapsed rail = **48px** (CSS `calc(var(--space-5) * 2)` — resolves the bead's rail-width
  question), `bodyPaddingRight` 0 open → ~60px collapsed.
- **New assertions:** engine spans full canvas width (`|canvasEngineWidth - canvasWidth| <= 2`), drawer
  contained left + `panelRight <= canvasRight + 4`, `panelTop >= canvasAreaTop - 2`,
  `panelBottom <= canvasAreaBottom + 2`, and collapse shrinks the rail well below the open drawer width
  (`railWidth <= 96 && railWidth < panelWidth/2`). Also fixed a **races-the-animation** bug: the collapse
  measurement waited a fixed 220ms (< the 240ms `--awkit-dur-panel` glide) and sometimes read the drawer
  mid-collapse (~440px) → replaced with `waitForFunction` polling until the rail settles ≤96px.
- **Files:** `scripts/verify-flow-designer-gui.mjs` (`readInspectorGeometry` gains `bodyPaddingRight`; the
  5 checks + collapse wait rewritten). No `src/` change.
- **Tests:** `npm run build` clean; **verify:flow-designer 24/24 twice** (was 19/24). bd `awkit-9p6` CLOSED.

---

## 2026-07-19 — Claude — GUI-verifier sweep (awkit-gmn) + auth hardening (awkit-ekd.6/.7)

- **GUI-verifier sweep (bd `awkit-gmn`):** added shared harness `scripts/lib/gui-verify-harness.mjs`
  (`resolveMainWindow` splash-poll + `signInFirstRun` SecurityGate first-run + `isolatedLaunchEnv`).
  Fixed the app-shell verifiers to launch on an isolated empty `%LOCALAPPDATA%` and sign in past the
  gate: **verify:capacity-settings-gui 12/12** (nav to Settings instead of a session-dropping reload),
  **verify:instance-monitor-gui 12/12**, **verify:runtime-analytics-gui 36/36** (all four seeded states),
  **verify:workflow-builder 20/20** (seeds 2 flows + 1 workflow),
  **verify:flow-designer 19/24** (seeds 1 multi-node flow; now launches + signs in + all behaviour checks
  pass). `verify:settings-persistence` confirmed **3/3 unchanged** (pure preload IPC, never gated).
- **Residuals split out:** flow-designer's 5 remaining failures are **stale post-Hologram geometry
  assertions** (assert the old docked-column `canvasEngineRight <= panelLeft`; the design is now a floating
  overlay drawer with a `padding-right` canvas inset — global.css ~8286) → **bd `awkit-9p6`**.
  `verify-oracle-drivers-gui` needs the auth half **plus** its Oracle validation store (Java runtime +
  ojdbc bundle) seeded into an isolated profile → **bd `awkit-xjv`** (Oracle-epic GUI gate).
- **Idempotency fix (bd `awkit-7ek`, found + fixed during re-verification):** `verify-runtime-analytics-gui`
  points `LOCALAPPDATA` at persisted `.fixtures-observability/<state>` dirs, so the first run provisioned a
  Super User into `<state>/SpecterStudio/security` and a re-run (without a fresh seed) hit the login form —
  `signInFirstRun` then timed out and the walkthrough silently reported **0/4**. `walkState` now `rmSync`s
  `<state>/SpecterStudio/security` before each launch (leaving the observability fixture untouched), so every
  run is a clean first-run. Proven idempotent: **36/36 twice back-to-back with no re-seed**.
- **awkit-ekd.7 (session rotation):** `AuthenticationService.changePassword` now revokes every other active
  session for the user, keeping the current one (`SessionManager.revokeOthersForUser` →
  `SecurityStore.revokeSessionsForUserExcept`). `verify:auth` **45/45** (added 4 Session-rotation checks).
- **awkit-ekd.6 (single-instance guard):** added `app.requestSingleInstanceLock()` in `app/main/main.ts`
  (second launch focuses the running window via `second-instance` and quits before opening any window/store)
  so two processes can't race on `security.sqlite`/ui-settings per profile. New **verify:single-instance 3/3**.
- **Files:** `scripts/lib/gui-verify-harness.mjs` (new), `scripts/verify-single-instance.mjs` (new),
  `scripts/verify-{capacity-settings,instance-monitor,runtime-analytics,workflow-builder,flow-designer}-gui.mjs`,
  `scripts/verify-auth.mts`, `src/security/{auth/AuthenticationService,session/SessionManager,store/SecurityStore}.ts`,
  `app/main/main.ts`, `package.json` (verify:single-instance).
- **Tests run (all re-verified independently 2026-07-19):** build (typecheck+bundles) clean; verify:auth
  **45/45**, verify:single-instance **3/3**, verify:capacity-settings-gui **12/12**,
  verify:instance-monitor-gui **12/12**, verify:runtime-analytics-gui **36/36** (idempotent, twice),
  verify:workflow-builder **20/20**, verify:flow-designer **19/24** (5 known geometry residuals → awkit-9p6).
  Earlier session also: verify:auth-gui 13/13, verify:security 39/39, verify:secrets 16/16,
  verify:settings-persistence 3/3. **Not run:** verify:oracle-drivers-gui (awkit-xjv) and the wider
  Oracle/concurrency/packaging suites (out of scope).
- **Result:** awkit-gmn's splash/gate breakage resolved across the general verifiers; ekd.6 + ekd.7 closed;
  awkit-7ek (runtime-analytics idempotency) fixed + closed.

---

## 2026-07-18 — Claude — Oracle `verify:oracle-live` gate PASSED against real local Oracle 19c

- **Task:** Complete the unfinished Oracle JDBC driver-settings work by running the credential-gated
  `verify:oracle-live` application gate against the user's real local Oracle DB
  (`jdbc:oracle:thin:@//localhost:1521/ORCLPDB`, user `SPECTER_READER`). Branch
  `feature/oracle-jdbc-driver-settings`.
- **Driver bundle:** imported `ojdbc17.jar` (23.26.2.0.0) into the Settings-managed store via
  `scripts/oracle/import-driver-bundle.mts` → bundle `Oracle-ojdbc17-local-19c-validation`, status valid,
  JDBC-only (no UCP). Real driver loaded in an isolated bridge.
- **Fixture mismatch (decided with the user):** the downloaded pack created
  `SPECTER_FIXTURE.CUSTOMERS`(3)/`TYPE_SAMPLES`(1) with columns unlike the harness's `id`/`name`+50-row
  expectation. Chose to **provision the canonical fixture additively** rather than weaken the harness. New
  `scripts/oracle/local-19c-awkit-types-fixture.sql` (idempotent) creates `SPECTER_FIXTURE.AWKIT_TYPES_TEST`
  (204 rows), `GRANT SELECT` to `SPECTER_READER`, private synonym `SPECTER_READER.AWKIT_TYPES_TEST` **as
  SYS**; existing objects untouched. Ran via OS-auth `sqlplus` from the registered 19c home
  (`C:\Users\moham\Downloads\WINDOWS.X64_193000_db_home`; not on PATH).
- **Credential (decided with the user):** minted a strong random dev-only `SPECTER_READER` password via
  OS-auth (`ALTER USER … IDENTIFIED BY`), stored only in a user-scoped scratchpad file — never printed to
  chat/logs/history/the redacted artifact. After the run: rotated to a discarded random password + **ACCOUNT
  LOCK**, then securely overwrote+deleted the secret file. No persistent env var set.
- **Result:** `npm run verify:oracle-live` **7/7 in real mode** (testConnection, select-small, truncation,
  type-conversion, policy-blocks-dml=`SQL_POLICY_VIOLATION`, permission-or-missing-object=`DRIVER_ERROR`,
  cancellation=`CANCELLED`). Bridge `executionMode=real`, driver 23.26.2.0.0, Java 17.0.8. Redacted artifact
  `reports/oracle-validation/oracle-live.json` (gitignored). Pre-run read-only self-check also confirmed
  `SELECT` works (qualified + via synonym) and `INSERT` is blocked (ORA-01031).
- **Regression:** `npm run build` clean; `npm run verify:oracle-driver-bundle` 43/43.
- **Status:** external gate #2 (authorized read-only Oracle run) is **met**; overall release status stays
  `INTEGRATION-CANDIDATE` — UCP pooled path still unvalidated (no UCP jar), private-JRE/packaged-EXE
  walkthrough and perf/soak gates remain. **Not committed** (conservative profile; awaiting user go-ahead).
- **Files:** new `scripts/oracle/local-19c-awkit-types-fixture.sql`; docs `CURRENT_STATE`/`HANDOFF`/`TASK_LOG`
  + `ORACLE_LIVE_VALIDATION_RESUME.md`. No app source changed.

---

## 2026-07-18 — Codex — Provision and verify local Specter Oracle fixture

- **Task:** Execute the downloaded `SPECTER_ORACLE_FIXTURE_SETUP` PowerShell setup and verifier and confirm
  that every expected Oracle artifact was created.
- **Environment discovery:** local Oracle Database 19c was already running as `ORCL` with PDB `ORCLPDB`
  open read/write on port 1521. SQL*Plus was present in the registered Oracle home but absent from `PATH`;
  commands used that exact Oracle-home binary. Docker remained stopped and was not needed.
- **Setup correction:** the first run exited 1 before creating anything because the downloaded setup script
  unconditionally opened an already-open PDB (`ORA-65019`). Updated only the downloaded (non-repository)
  script's open step to query `V$PDBS` and open the PDB only when needed; the rerun exited 0.
- **Created:** open users `SPECTER_FIXTURE` and `SPECTER_READER`; valid table objects `CUSTOMERS` and
  `TYPE_SAMPLES`; valid view `V_ACTIVE_CUSTOMERS`; deterministic counts 3 customers / 1 type sample /
  2 active customers.
- **Least privilege:** `SPECTER_READER` has only `CREATE SESSION`, non-grantable `SELECT` on those three
  objects, and no roles. The supplied reader verifier exited 0 and proved `INSERT` is rejected.
- **Secrets:** both passwords were entered in local interactive PowerShell prompts; none were printed,
  persisted by Codex, or copied into repository memory.
- **Repository files:** `docs/ai/{CURRENT_STATE,HANDOFF,TASK_LOG}.md` only. The corrected downloaded script
  is outside the repository.
- **Tests run:** setup process exit 0; direct SYSDBA object/count/grant inspection exit 0; supplied
  `verify-specter-reader.ps1 -ServiceName ORCLPDB` exit 0; final sentinel-row check exit 0.
- **Not run:** application `verify:oracle-live`, build, and packaging checks; no app source or package changed.
- **Result:** downloaded fixture setup is complete and independently verified on local `ORCLPDB`.

---

## 2026-07-17 — Claude — Oracle pending-phase plan (01–12): 5 executed, 7 blocked on verified-absent artifacts

- **Task:** User supplied a 12-phase "pending implementation" plan and asked to review/validate/modify it,
  then start execution.
- **Audit:** plan is sound and correctly holds status at INTEGRATION-CANDIDATE, but is written against a
  pre-merge world. Corrections: (1) "work only against the committed Oracle feature branch" — that branch is
  merged + deleted, baseline is `main` @ `b6e473d`; (2) Phase 01 expects "rebrand/splash absent" — present
  **by design**, the rename is an Oracle dependency, so reverting would be wrong; (3) Phase 04's
  `ORACLE_RUNTIME_UNAVAILABLE` maps to the existing `DRIVER_UNAVAILABLE` wire category — not renamed for
  cosmetics; (4) Phase 07's "use real bridge/query counters" identified a **genuine gap** worth fixing now.
- **Blockers PROBED, not assumed:** `ojdbc*/ucp*.jar` absent from `~/.m2`, Downloads, Desktop; Maven Central
  unreachable (**HTTP 000**); `docker` unavailable; `AWKIT_ORACLE_LIVE_*` unset; JDK 17.0.8 present. All
  seven blocked phases fail at the same first step — acquiring the artifacts.
- **Phase 01 (done):** baseline green — build PASS, Oracle 137/137 on the listed verifiers, all three
  fail-closed layers present, docs read INTEGRATION-CANDIDATE.
- **Phase 07 (done — the real work):** rewrote `verify-oracle-lazy-resolution.mts` to drive the **real Java
  bridge process** and count actual `executeQuery` RPCs at the wire, replacing an injected stub counter.
  12 → **20 checks**. Negative proofs are the valuable ones: snapshot + unreferenced Runtime sources leave
  the Java process **never started**. Also folded in Phase 04's Required Product Behavior (runtime
  unavailable ⇒ JSON + Snapshot keep working, Runtime fails safely, no crash, no cache poisoning).
- **Phase 04 (done, 4/5):** truth-table rows proven across resolver + TS manager + Java executor selection.
  Row `packaged + valid real bundle → real executor` blocked on jars.
- **Phase 08 (done):** full regression green — Oracle **226/226**; runner 82, concurrency 78, observability
  65, recorder 72, telemetry 61/61, security 39, data-editor 27, browser-isolation 27/27, waits 21,
  safety-policy 17, recorder-draft 17/17, secrets 16, protected-login 16, locks 15, runtime-status 15,
  artifacts 13, chromium-hardening 13, recorder-flow 13/13, profile-store 13/13, cancellation 12,
  startup-recovery 10, write-queue 7/7, ipc-contract 4/4, workflow-sentinels 4/4; `validate:offline` passes
  (correctly warns Oracle not bundled). **`verify:durable-store` 9/2 is PRE-EXISTING** — fails identically
  at `dee283e` (pre-Oracle), proven in an isolated worktree; this session never touched the durable store.
  Left alone per the plan's "fix only actual regressions" rule.
- **Phase 12 (done):** report §16b + the plan's required final summary block; status stays
  **INTEGRATION-CANDIDATE**.
- **Phases 02/03/05/06/09/10/11 (blocked):** documented with the probe evidence table + per-phase unblock
  steps in `ORACLE_JDBC_VALIDATION_GATES.md`, mapped to this plan's numbering.
- **Files:** `scripts/verify-oracle-lazy-resolution.mts` (rewritten); `docs/ai/{CURRENT_STATE,TASK_LOG,
  ORACLE_JDBC_VALIDATION_GATES,ORACLE_JDBC_DATA_SOURCE_NODE_REPORT}.md`.
- **Tests run:** build PASS; Oracle 226/226 (10 verifiers); the impacted regression set above; validate:offline.
- **Not run:** real-jar compile, live Oracle suite, real UCP pooling, packaging, packaged EXE, soak — all
  externally blocked, none approximated.
- **Result:** 5 of 12 phases executed and green; 7 blocked with verified evidence. Status unchanged.

---

## 2026-07-17 — Claude — Ship it: Oracle JDBC + SpecterStudio rename + launch splash merged to `main`; AI memory refreshed

- **Task:** User asked to commit the session's work, then open/merge the PRs, then update the memory files.
- **Classification first (the tree was mixed):** the working tree held ~101 changed files spanning several
  uncommitted scopes. Audited before staging and found the "other" scope was **not** a sibling feature but a
  repo-wide rename (`WebFlow Studio`/`playwright-flow-studio` → **SpecterStudio**) that the Oracle work is
  built on (`com.specterstudio.*` packages, `com.specterstudio.app`, `%LOCALAPPDATA%/SpecterStudio/`). An
  Oracle-only commit would have left the rename half-applied, so the user chose rename + Oracle as two
  commits on one branch, with the splash/icons/nav excluded.
- **PR #11 → `main` (`476dc29`), 114 files:** `488eabf` chore(rename, 38 files, renames only) +
  `5e7977d` feat(oracle, 79 files). `git add -p` is unavailable (interactive), so the 3 files mixing scopes
  (`package.json`, `electron-builder.json`, `app/main/main.ts`) were split by staging hand-built blobs
  (`git hash-object -w` + `git update-index --cacheinfo`) — precise, and it never writes the working tree.
- **PR #12 → `main` (`b6e473d`), 33 files:** `feat(branding)` launch splash + logo/icons + `png-to-ico`
  removal, and `chore` gitignoring the superseded logo families. Stacked on the Oracle branch because these
  files already carried the rename. `logos/specter-violet/` tracked; `awkit-violet/` + duplicate top-level
  sets gitignored (scoped rule, **not** a blanket `logos/`, since specter-violet is tracked).
- **Two mistakes worth recording:** (1) I reported the #11 merge as "not landed" after fetching too early
  and reading a stale ref — `git ls-remote origin refs/heads/main` is the authoritative check. (2)
  `gh pr merge --delete-branch` **closed** stacked PR #12 instead of retargeting it; recovery hit a
  catch-22 (can't retarget a closed PR, can't reopen without its base branch) and needed the base ref
  restored from `5e7977d`, then reopen → retarget → re-delete. Using a **merge commit** (repo convention)
  rather than squash is what kept the stack cheap to fix — the Oracle SHAs stayed in `main`.
- **Found:** CI never ran on #12 — `.github/workflows/ci.yml` triggers only on `main`, so stacked PRs get
  **no checks**, and a CLEAN merge state there means "nothing blocking", not "verified". Verified locally
  instead; CI then passed on `main`. Recorded in KNOWN_ISSUES.
- **Memory refresh (this entry's second half):** FEATURES/ARCHITECTURE/DECISIONS/KNOWN_ISSUES had **zero**
  Oracle coverage; HANDOFF still claimed an uncommitted tree on `feature/smart-wait-engine` and told agents
  not to push; the report header and several CURRENT_STATE entries still said "not committed (local only)";
  DECISIONS still recorded the superseded "WebFlow Studio" rename as current. All corrected.
- **Files:** `docs/ai/{CURRENT_STATE,TASK_LOG,FEATURES,ARCHITECTURE,DECISIONS,KNOWN_ISSUES,HANDOFF,
  ORACLE_JDBC_DATA_SOURCE_NODE_REPORT}.md`; personal memory `oracle-jdbc-feature.md`, `git-pr-strategy.md`,
  `MEMORY.md`.
- **Tests run (on merged `main`):** `npm run build` clean (emits `splash.html`); Oracle **218/218** across
  10 verifiers; `verify:runner` 82/82; `verify:recorder` 72/72; GitHub Actions "Typecheck & Build" success.
- **Not run:** the four Oracle external gates (real-jar compile, authorized Oracle DB, packaged-EXE
  walkthrough, perf/soak) — unchanged, and impossible in this environment.
- **Result:** `main` at `b6e473d`, working tree clean, no open PRs. Oracle remains **INTEGRATION-CANDIDATE**
  — merging shipped the code, not the validation.

---

## 2026-07-17 — Claude — Oracle JDBC: status corrected to INTEGRATION-CANDIDATE; fail-closed production, real UCP executor, SQL hardening, validation harnesses (validation track 01–10)

- **Task:** User supplied `AWKIT_ORACLE_NEXT_REQUIRED_PHASES/` (11 docs, a 10-phase validation & release
  track) and asked to review/audit/enhance, then implement. Audited all 10 phases against the real code
  first, then implemented every phase that does not require external infrastructure.
- **Audit outcome:** the track is accurate; its central correction (status must be
  **INTEGRATION-CANDIDATE**, not PRODUCTION-CANDIDATE) is right — the real executor had never compiled
  and no authorized Oracle was ever used. Three enhancements folded in from reading the code:
  (1) Phase 01 was **more urgent than documented** — a *live* mock leak existed;
  (2) Phase 03 was mis-scoped — `OracleUcpQueryExecutor` did not exist and had to be **authored**, not
  merely "compiled"; (3) Phase 04's `WITH FUNCTION`/`WITH PROCEDURE` gap was real and confirmed.
- **Phase 01 (done):** fixed the mock leak in `app/main/oracleService.ts` (forced
  `AWKIT_ORACLE_BRIDGE_MOCK=1` on any missing driver with **no packaged guard**). Policy moved into
  `OracleRuntimeResolver` (`mockAllowed`/`requireRealDriver`, env baked into the launch spec); packaged +
  missing driver ⇒ unavailable (Snapshot unaffected); new Java `DriverUnavailableExecutor`; Java `Main`
  ignores the mock flag under `AWKIT_ORACLE_REQUIRE_REAL`; manager `requireRealDriver` handshake guard;
  `hello` gained `executionMode`/`ucpVersion`/`javaVersion`. Report corrected to INTEGRATION-CANDIDATE.
- **Phase 02 (done):** `ORACLE_JDBC_RUNTIME_MATRIX.md`, locked `scripts/oracle/oracle-runtime.manifest.json`,
  and `prepare:oracle-runtime` (offline, fail-closed, reproducible — no `generatedAt`, so checksums are
  byte-stable). `verify:oracle-runtime-prep` 20/20.
- **Phase 03 (authored + stub-compiled):** wrote the real `OracleUcpQueryExecutor`;
  `verify:oracle-bridge-real-build` stub-compiles it against the real JDK `java.sql` every run (caught a
  missing `BridgeException(category, msg, retriable)` constructor). Live real build skips until jars exist.
- **Phase 04 (done):** rejected `WITH FUNCTION`/`WITH PROCEDURE`, dblinks (`@`), `UTL_`/`DBMS_`/`OWA_`
  packages on **both** sides; `verify:oracle-sql-policy` proves TS↔Java parity over a 30-case adversarial
  corpus via the real Dispatcher. Wrote `ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md`.
- **Phases 05/07/08 (done):** `verify:oracle-live` (credential-gated, fail-closed, redacted artifact) +
  `scripts/oracle/oracle-live-fixture.sql`; `verify:oracle-lazy-resolution` 12/12 (unreferenced ⇒ 0
  queries, single-flight, per-run cache, snapshot ⇒ 0 DB); `auditOracleOfflineBundle` +
  `verify:oracle-offline-bundle`, `validate-offline-bundle.ps1` Oracle section, electron-builder secret
  exclusions.
- **Files:** new — `OracleUcpQueryExecutor.java`, `DriverUnavailableExecutor.java`,
  `src/oracle/OracleOfflineBundle.ts`, `scripts/prepare-oracle-runtime.mjs`, `scripts/oracle/*`,
  6 new verifiers, 3 new docs. Modified — `OracleRuntimeResolver`, `OracleJdbcBridgeManager`,
  `OracleBridgeProtocol`, `oracleService`, `OracleSqlPolicy` + `SqlReadOnlyPolicy.java`, `Main.java`,
  `Dispatcher.java`, `QueryExecutor.java`, `MockQueryExecutor.java`, `BridgeException.java`,
  `verify-oracle-{runtime,packaging}.mts`, `validate-offline-bundle.ps1`, `electron-builder.json`,
  `package.json`, report + plan + CURRENT_STATE.
- **Tests run:** `npm run build` clean; Oracle suite **218/218 green across 10 verifiers**
  (bridge 32, real-build 11, profiles 22, data-source 28, runtime 36, runtime-prep 20, sql-policy 30,
  packaging 19, lazy-resolution 12, offline-bundle 8) + `verify:oracle-live` skip path; regression
  `verify:runner` 82/82, `verify:security` 39/39, `verify:secrets` 16/16, `verify:ipc-contract` 4/4.
- **Not run (external gates):** real-jar compile + real Oracle suite (Phase 06 — no DB/Docker/network),
  packaged-EXE clean-machine walkthrough (Phase 09), real perf/soak (Phase 10). Procedure documented in
  `ORACLE_JDBC_VALIDATION_GATES.md`.
- **Result:** all actionable phases complete; status **INTEGRATION-CANDIDATE**. Not committed (local only).

---

## 2026-07-17 — Claude — Oracle JDBC: DS renderer UI verification, result-limit hardening, packaging checksums, final report (Phases 05, 11, 12, 14)

- **Task:** Resumed the Oracle JDBC feature from a prior session's cut-off (session limit hit mid-way
  through GUI-verifying the Phase 05 Data Source UI). Verified the build/all prior Oracle verifiers were
  still green, then completed the Phase 05 GUI verification, closed a real Phase 11 limits gap, added
  Phase 12 packaging-checksum infrastructure, and wrote the Phase 14 final report.
- **Phase 05 GUI verification:** launched `npx electron .` fresh and drove it via PowerShell Win32
  automation (no computer-use grant available for this window — see [[electron-gui-verify-workflow]]).
  Root-caused early click failures to a **DPI-awareness bug in the automation itself**
  (`SetProcessDPIAware()` doesn't persist across separate PowerShell tool invocations, so
  `GetWindowRect`/`SetCursorPos` silently flipped between logical and physical pixel spaces) — not an
  app bug. Once fixed: the "Add Oracle Source" modal opens, Name/SQL fields accept clipboard-pasted
  text, and clicking Create with no Oracle connection profile correctly shows "Select an Oracle
  connection profile." with zero DevTools console errors.
- **Phase 11 fix:** `OracleTypeConversion.ResultLimits.maxCellBytes` was declared but never enforced,
  and no caller ever passed `maxColumns`/`maxSerializedBytes` — three defensive limits were dead code.
  `enforceResultLimits` now checks per-cell byte length; `OracleQueryService` applies built-in defaults
  (200 columns / 1MB cell / 25MB serialized) even when the caller doesn't specify one.
- **Phase 12 addition:** new `src/oracle/OracleBundleChecksums.ts` (sha256 `checksums.json` validation,
  synchronous, pure) wired into `OracleRuntimeResolver`'s bundled-runtime branch — production fails
  closed on a corrupted/tampered/incomplete Oracle bundle instead of launching it. Jar/JRE vendoring
  itself remains blocked (no build-time network in this environment).
- **Phase 14:** confirmed migration needs no code (additive union, missing `type` ⇒ `jsonArray`); wrote
  `docs/ai/ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md` (17-section final report, **PRODUCTION-CANDIDATE**).
- **Files:** new `src/oracle/OracleBundleChecksums.ts`, `scripts/verify-oracle-packaging.mts`,
  `docs/ai/ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md`; modified `src/oracle/OracleTypeConversion.ts`,
  `src/oracle/OracleQueryService.ts`, `scripts/verify-oracle-runtime.mts`, `package.json`,
  `docs/ai/ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md`.
- **Tests run:** `npm run build` clean; `verify:oracle-packaging` **11/11** (new); `verify:oracle-runtime`
  **27/27** (was 22, +5 limit checks); `verify:oracle-bridge` **32/32**; `verify:oracle-profiles`
  **22/22**; `verify:oracle-data-source` **28/28**; `verify:runner` **82/82**. 120 total Oracle checks
  green, no regressions. Live Electron GUI walkthrough of the Data Source Manager (see above).
- **Not run:** real-Oracle validation, packaged-EXE rebuild, `validate:offline` Oracle-specific checks
  (all external gates — see the final report §13/§16 for exact blockers).
- **Result:** Phases 05, 11 (partial→further hardened), 12 (partial→checksum infra added), 14 all
  advanced; release status remains PRODUCTION-CANDIDATE. Not committed (local only).

## 2026-07-17 — Claude — Oracle JDBC: node + Data-Source execution wiring & snapshot capture (Phases 06, 08–10)

- **Task:** Continue the Oracle JDBC feature. Reviewed prior progress (node + panel files already
  existed; plan status table was stale), fixed a broken build, and completed the Oracle **node**
  execution wiring, the **Data-Source-side** workflow integration, and **snapshot capture**.
- **Fix:** `app/main/oracleService.ts` failed `tsc` (`Record<string,unknown>` vs `JsonScalar`). Typed
  `OracleDataSourceSnapshot.rows` as the normalized `Record<string, OracleJsonScalar>[]` (new local
  scalar type in `DataSourceProfile.ts`) — the honest snapshot contract.
- **Phase 10 (DS-side):** `resolveWorkflowDataSources` (`execution.ipc.ts`) now branches the
  `jsonArray | oracle` union — jsonArray keeps its eager path; Oracle resolves via `DataSourceResolver`
  (one per run = cache scope). Workflow-bound Oracle source materialized eagerly for `dataRows` loops.
  Added `materializeDataSourceRows` (`InstanceExecutionContext`) and used it in `FlowExecutor`
  (loop connector) + `StepExecutor` (`executeLoop`) so lazy runtime sources load on demand.
- **Phase 06 (snapshot):** `refreshOracleDataSourceSnapshot(id)` — execute once, normalize,
  atomic-persist (`store.update`), keep last-good rows on error, secret-safe error summary.
- **Phase 05 (backend):** new `OracleDataSourceBinds.resolveDataSourceBinds` (static/env/workflowInput
  only; rejects per-row/step binds); `saveOracleDataSource`/`list`/`get`/`delete` in `oracleService`;
  `oracle:dataSources:{list,get,save,delete,refreshSnapshot}` IPC (mutations sender-guarded) + preload
  `oracle.{listDataSources,getDataSource,saveDataSource,deleteDataSource,refreshSnapshot}`;
  `OracleProfileService.connectionFingerprintForId`.
- **Files:** `src/data/DataSourceProfile.ts`, `src/oracle/OracleDataSourceBinds.ts` (new),
  `src/oracle/OracleProfileService.ts`, `src/runner/InstanceExecutionContext.ts`,
  `src/runner/FlowExecutor.ts`, `src/runner/StepExecutor.ts`, `app/main/oracleService.ts`,
  `app/main/ipc/execution.ipc.ts`, `app/main/ipc/oracle.ipc.ts`, `app/main/preload.ts`,
  `scripts/verify-oracle-data-source.mts`, plus plan + CURRENT_STATE docs.
- **Tests:** `npm run build` clean; `verify:oracle-data-source` **28/28** (+8 for DS binds +
  materialization); `verify:runner` **82/82**; `verify:oracle-bridge` **32/32**,
  `verify:oracle-profiles` **22/22**, `verify:oracle-runtime` **22/22**.
- **Not run / remaining:** Phase 05 **renderer** UI (create/edit Oracle Data Sources + snapshot-refresh
  button in `DataSourceManager`); Phases 11/12/14; real-Oracle (13) + vendored-jar/packaged-EXE
  external gates. Not committed (local only).
- **Result:** Oracle node + Data Sources execute end-to-end (runtime + offline snapshot) against the
  mock bridge; build + all Oracle/runner verifiers green.

## 2026-07-16 — Claude — Oracle JDBC Data Source & Node — Phases 01–04 + 07 (foundation)

- **Task:** Review the 14-phase `AWKIT_ORACLE_JDBC_DATA_SOURCE_NODE_PHASES` plan against the real
  codebase, correct wrong assumptions, then implement. Delivered the backend/architecture foundation.
- **Phase 01 (audit):** wrote `docs/ai/ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md` (corrected architecture)
  and annotated the source `00_MASTER_OVERVIEW.md`. Key corrections proven from code: **no
  `DataSourceResolver` existed** (data sources resolve eagerly in `execution.ipc.ts`
  `resolveWorkflowDataSources` → `ResolvedDataSource`); `passwordSecretRef` = a **secret NAME** in the
  existing by-name DPAPI `SecretStore`; a "node" = a `FlowStep` `StepType` (no migration engine); the
  **runner is in the Electron main process** (no worker threads) so `OracleQueryService` owns the Java
  child process directly. Environment constraints: **build-time network blocked**, inconsistent JDKs
  (JAVA_HOME=8, PATH=17, jlink=11 → pin JDK 17), **no Docker** (real-Oracle = external gate).
- **Phase 02 (Java bridge):** new `oracle-jdbc-bridge/` module. **Zero-dependency** pure-JDK core
  (JSON codec, 4-byte length framing, dispatch + cancellation registry, read-only SQL policy,
  database-free `MockQueryExecutor`) + `Main` (stdout reserved for frames, reflective Oracle-executor
  load with mock fallback). TS `OracleJdbcBridgeManager`/`OracleBridgeProtocol` (lazy spawn, handshake,
  correlation, timeout, AbortSignal cancel, bounded restart, orphan-free dispose). Reproducible
  offline build `scripts/build-oracle-bridge.mjs` (pins `C:\Program Files\Java\jdk-17`). Oracle UCP
  executor = gated on vendored jars (external gate, like Chromium). `verify:oracle-bridge` **32/32**.
- **Phase 03 (profiles + secrets):** `OracleConnectionProfile` model (JDBC URL builder, redaction,
  pool fingerprint, validation, renderer-safe view) + pure `OracleProfileService` (CRUD, inline
  secrets → by-name `SecretStore`, testConnection via bridge, error-category→safe-message mapping).
  Main wiring `app/main/oracleService.ts`, IPC `oracle.ipc.ts` (+ preload `oracle` domain, all
  sender-guarded), quit-time bridge dispose in `main.ts`. New `oracle-profiles` runtime folder.
  Renderer never receives a secret value (`hasPassword` only). `verify:oracle-profiles` **22/22**.
- **Phase 04 (data source model + resolver):** `DataSourceProfile` widened to a backward-compatible
  `jsonArray | oracle` union (legacy profiles unchanged); `OracleDataSourceProfile` (+ binds, limits,
  runtime/snapshot). Authoritative pure `DataSourceResolver` → one normalized `ResolvedDataSource`
  contract for all types; **runtime = single-flight per-run-cached lazy loader** (failed attempts not
  cached); snapshot = stored offline rows; JSON = unchanged lazy file read. `ResolvedDataSource` gained
  optional `loadRows()`/`type`/`oracleMode`; `ValueResolver` uses the lazy loader. Query-hash +
  snapshot-staleness helpers. `verify:oracle-data-source` **20/20**.
- **Phase 07 (runtime query service):** `OracleQueryService` — the single query authority (read-only
  gate → descriptor/secret resolution → bind assembly → bridge `executeQuery` → normalize + defensive
  result limits → outer timeout, AbortSignal cancel, transient-only retry, bounded concurrency limiter,
  low-cardinality telemetry). Deterministic bind/type conversion (`OracleTypeConversion`,
  high-precision numbers as strings). `verify:oracle-runtime` **22/22**.
- **Verification:** `npm run build` **passes** (tsc + all bundles); `verify:ipc-contract` **4/4** (143
  handlers, 7 new oracle channels handled+exposed); new suites 32+22+20+22 = **96 checks green** using
  the real Java mock bridge (no database). Orphan-Java check clean. **Not done (remaining phases):**
  05 UI, 06 snapshot execution/persistence, 08/09 Oracle node, 10 workflow-seam wiring, 11 hardening,
  12 packaging/runtime resolver validation, 13 tests + real-Oracle (**external gate** — needs
  authorized DB + vendored ojdbc/ucp jars + private JRE), 14 report. Not committed (local only).

## 2026-07-16 — Claude — Splash hold-on-brief + spinner, concept-1c icon, simplified sidebar brand

- **Task:** (1) splash should play one full round then, if the app is ready, dismiss and continue; if the
  app still needs time, pause on the last/brief frame with a small bottom loader/spinner until loaded;
  (2) change the app icon to concept "1c" from `UI Samples/Application icon design/Spectr Icon.dc.html`;
  (3) in the side menu add the new app icon and simplify the brand to just the app name.
- **Splash:** `app/renderer/splash.html` now plays once to `HOLD_T = 11.70s` (the resolved brief frame) and
  freezes there instead of looping; added a bottom-right CSS spinner revealed by `window.__splashHold()`.
  `app/main/main.ts` handoff rewritten: reveal at `max(one-round, ready-to-show)` — dissolve if ready by
  round end, else `executeJavaScript` the spinner and hold until ready; `ONE_ROUND_MS = 11_800`,
  `HARD_CAP_MS = 30_000` safety net. Splash stays sandboxed/preload-free.
- **Icon:** regenerated `resources/icon-source.png`/`icon.png`/`icon.ico` from a 1c SVG (near-black squircle,
  off-white brick-form S, spectrum-edge bottom-left brick) via `scripts/generate-app-icon.mjs`.
- **Sidebar:** `app/renderer/layout/LeftNavigation.tsx` — new inline `SpecterAppIcon` SVG (1c mark, `useId`
  defs) replaces the `Workflow` brand glyph; removed the `Automation workbench` subtitle (brand = icon +
  "SpecterStudio"). Added `.brand-app-icon` to `global.css`. Footer chip / `AppFrame` wordmark untouched.
- **Verification:** `npm run build` passed. Captured the built splash's brief-frame + spinner (bundled
  Chromium), viewed `resources/icon.png`, and launched the real Electron app + screen-captured it — sidebar
  shows the new mark + "SpecterStudio" only and the splash handed off ("Electron shell: Online", "IPC
  bridge: Connected"). Browser-pane screenshots of the canvas splash timed out (infinite spinner never
  settles) — used Playwright/PowerShell capture instead.
- **Not run:** packaged EXE/NSIS rebuild (taskbar icon) + clean-machine GUI walkthrough.
- **Result:** splash finishes a round then either continues or waits with a spinner; app + taskbar identity
  use the 1c mark; sidebar brand is icon + name only.

---

## 2026-07-16 — Claude — Product rename WebFlow Studio → SpecterStudio + apply launch splash

- **Task:** apply the new Specter Studio splash at launch (already wired) and rename the app to
  **SpecterStudio** everywhere it is the product's own identity.
- **Splash:** confirmed the splash is wired into launch (`main.ts` → `createSplashWindow()` →
  `fadeOutAndClose()` on `ready-to-show`); `app/renderer/splash.html` is a second renderer entry.
- **Rename (identity/user-facing):** window/dialog/HTML titles, renderer UI (app frame, left nav, Settings),
  packaging (`electron-builder.json` `productName` + `appId com.specterstudio.app`),
  `package.json`/`package-lock.json` (`name: specterstudio`, `productName: SpecterStudio`), and all
  user-facing message strings in `app/**` + `src/**`.
- **Rename (runtime + offline chain):** `RUNTIME_DATA_FOLDER = "SpecterStudio"` → data under
  `%LOCALAPPDATA%/SpecterStudio/`; kept manifest (`resources/dependency-manifest.json`,
  `resources/offline-runtime.json`), the TS + PS validators, and the seed/verify/benchmark tooling that
  resolve the runtime folder or packaged EXE consistent with the new name.
- **Live docs:** `README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/00-project.mdc`,
  `.cursor/rules/30-storage-ipc.mdc`, and the `ci.yml` comment updated to SpecterStudio.
- **Left unchanged (intentional):** `window.playwrightFlowStudio` preload API, `--awkit-*` CSS tokens,
  `AWKIT_*` env vars / `awkitRssMb` field (functional), the manifest *schema* name, and dated historical
  records that reference the already-built `WebFlow Studio 0.1.0.exe`/`Setup` artifacts.
- **Verification:** `npm run build` passed (tsc + bundles; `splash.html` self-contained at 18.27 kB);
  `npm run validate:offline` passed (development mode) with manifest name/path checks green; consistency
  sweep confirms no residual `WebFlow Studio` in `app/`/`src/`/`scripts/`/`resources/`/config.
- **Not run:** packaged EXE/NSIS rebuild + clean-machine GUI launch walkthrough (no packaging env here).
- **Result:** the app launches with the SpecterStudio splash and presents a consistent SpecterStudio
  identity; existing installs' old `WebFlow Studio` data folder is not auto-migrated (documented).

---

## 2026-07-16 — Claude — Specter Studio launch splash (reference-recreation of SplashScreen.mp4)

- **Task:** recreate the attached `UI Samples/SplashScreen.mp4` (the "Module 151.30" flexible-logo motion
  reel) as an app-launch splash, rebranded to first word **Specter** / second word **Studio**, keeping the
  reference structure with user-supplied body copy + credits, monochrome + project violet accent, full
  13.7s multi-format loop. Named skill `exact-reference-design-recreation` is not installed; followed the
  same methodology manually.
- **Analysis:** no ffmpeg available → extracted true frames with Playwright + bundled Chromium
  (`resources/browsers/chromium/chrome.exe`). Seeking a paused encode returned identical frames (MAD 0);
  switched to play-through capture via `requestVideoFrameCallback` (137 frames, 12 fps). Built a MAD motion
  timeline + heatmap to locate every beat: intro build 0–2s, minimal grid ~3.2s, portrait ~5.4s, wide
  snap-back ~7.3s, copy fade-in ~8.4–9s, **dead-still hold 9.8–11.7s (MAD 0)**, loop wind-up 11.8–13.7s.
- **Build:** new `app/renderer/splash.html` — self-contained canvas timeline (one parametric layout:
  words/two grids/counter/tagline/paragraph/credits) interpolated through scene keyframes; grid col/row
  counts from a rounded lerp reproduce the responsive reflow; seamless loop (t=13.7167 == t=0);
  `window.__renderAt(t)` deterministic hook. Monochrome + violet glow/counter on `#0e1016`.
- **Integration:** `windowManager.ts` `createSplashWindow()` + `fadeOutAndClose()`, `createMainWindow({show})`;
  `main.ts` splash→main handoff (min 2.4s, 8s fallback, opacity fade); `electron.vite.config.ts` splash as a
  second renderer input.
- **Files:** `app/renderer/splash.html` (new); `app/main/windowManager.ts`, `app/main/main.ts`,
  `electron.vite.config.ts` (edited); `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` passed (tsc + bundles; `out/renderer/splash.html` 17.36 kB, confirmed no
  external `src`/`href` → offline-safe). Iterated by rendering my splash at the source's exact timestamps
  and diffing side-by-side until every format/beat matched. **Not run:** live packaged-EXE GUI walkthrough.
- **Result:** launch splash reproduces every animated element, the format sequence, timings, the still hold,
  and the loop; residual diffs are minor (Specter/Studio are longer than MO/DULE; copy fades out slightly
  slower in the wind-up).
- **Revision (same session, per user step-by-step feedback):** added the missing **Step-3 pivot** — the
  isolated 2×2 grid rotates 90° clockwise through the 45° diamond and settles upright (`pivotRotation(t)`,
  `drawGrid` rotates about centre); verified against the source's 3–4.8s frames (diamond at ~3.6s).
  Wordmark set to **uppercase** SPECTER/STUDIO; **text alignment fixed** (word `y` is now the baseline,
  placed just above each grid — previously overlapped the grid top); contrast tightened (crisp white
  strokes, violet glow dialed to 0.08); Format A grid set to 10×3. Rebuilt (`npm run build` passed,
  `out/renderer/splash.html` 18.27 kB) and re-compared frame-by-frame.

## 2026-07-16 — Claude — Runtime Observability final production-validation (Phases 1–6; not committed)

- **Task:** prove the observability layer production-ready via controlled A/B overhead, full 30-min soak,
  measured storage/query benchmarks, packaged-renderer UI walkthrough, admission-semantics check, and an
  evidence-based release decision. No product-code redesign; only benchmark/validation tooling + docs.
- **Phase 1 — A/B overhead** (`benchmark:observability-ab`, already run): 3A+3B, Config D, MIXED, conc 6,
  interleaved order. Honest read: per-tick cost negligible (event-loop delay P95 **+0.5 ms**, CPU +2 pts within
  noise); throughput **~1.5–2.5 %** (median −1.53 %, confounded w/ run-order drift); **RSS unresolvable** — the
  OFF config's own RSS P95 spans 180→344 MB (SD 69) ≫ the +10 MB between-config delta, so the JSON "+48 MB" is
  a median-of-reps artifact, not a real cost. `AWKIT_RUNTIME_OBSERVABILITY=0` disables only the incremental work.
- **Phase 2 — full 30-min soak** (`AWKIT_SOAK_MS=1800000`): 4661 completed / 0 failed / 0 crashes; teardown
  CLEAN; durable==live; **4666 run summaries == 4666 terminal runs**; leak-free (handles flat 51→51, RSS end≈start,
  Chromium RSS down). Found+fixed **2 soak-harness bugs** in `scripts/benchmark-engine-soak.mts` (`durableTerminalRuns`
  omitted `cancelled`→spurious MISMATCH; NaN poisoned event-loop `peak`) — validated on a 40 s re-run; neither an
  observability defect. Canonical artifact `soak-30min.json`.
- **Phase 3 — storage/query** (`benchmark:observability-storage`, 5k/25k/50k): ~465 B/run, 322 B/cap-bucket,
  237 B/anomaly; **~3.1 MB/day** uncapped (corrects the old "~1 MB/day"); retention-bounded; all cutoff boundaries
  validated. Analytics queries **tens-to-~500 ms** P95 (corrects "sub-millisecond"); aggregation-bound, not
  index-bound (EXPLAIN confirms index use); no speculative indexes added.
- **Phase 4 — admission semantics:** already the honest **rename** (queue-delay proxy; "Runtime admission delays …
  not per-workflow"; ENV tags) — confirmed in code + the live UI. No per-workflow reason attribution claimed.
- **Phase 5 — packaged-renderer UI:** new `scripts/seed-observability-fixtures.mts` (normal/empty/migration/
  high-data seeded DBs + `lastRouteId` deep-link) + `scripts/verify-runtime-analytics-gui.mjs` — real built
  Electron (`out/`) driven per state via `_electron`, all 7 IPC channels (incl. malformed inputs) exercised.
  **36/36**; panels populated (capacity/admission/anomalies), no NaN/undefined/errors; screenshots under
  `reports/browser-performance/phase5-ui-evidence/`. (dist/ EXE is pre-observability + re-package OOMs → packaged-EXE
  walkthrough is the one remaining gate.)
- **Phase 6 — report:** rewrote `RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md` (§5/10/11/12/13/15/16 + new §17
  with methods/tables/deltas). Corrected "measured-negligible overhead", "sub-millisecond queries", "~1 MB/day",
  "Experimental: none". **Decision: `PRODUCTION-CANDIDATE`** — remaining gate: fresh packaged-EXE build + walkthrough
  on a higher-memory host; provisional: anomaly thresholds (uncalibrated), precise A/B RSS figure.
- **Files:** modified `scripts/benchmark-engine-soak.mts`, `package.json` (2 script aliases), `.gitignore`,
  `docs/ai/RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md`; new `scripts/seed-observability-fixtures.mts`,
  `scripts/verify-runtime-analytics-gui.mjs`. No `src/` change.
- **Verification:** `npm run build` clean; `verify:observability` **65/65**; `verify-runtime-analytics-gui` **36/36**;
  the 3 benchmarks green. Not re-run (no product-code change): the broader runner/concurrency regression suite
  (green in the prior entry). `npm test`/`npm run lint` still do not exist.

---

## 2026-07-15 — Claude — Concurrency closing task Phases 02–06 (enforce dependency + prove durable root cause, not committed)

- **Task:** close the three remaining concurrency validation gaps — enforce the Shared-Pool → A8 dependency
  (Phase 02), PROVE the `~3822 live vs 495 durable` root cause (Phase 03), add durable-accuracy verification
  (Phase 04), audit reporting/statistics impact (Phase 05), final verification + report (Phase 06). GitHub
  intentionally not used.
- **Phase 02 (ENFORCED — this WAS a real gap):** the prior session's claim that the dependency was already
  enforced was wrong — `envBool("AWKIT_WORKLOAD_WEIGHTS", pool)` still let an explicit `=true` recreate Config C
  while the pool was OFF. Added `resolveWeightedAdmission` + `WEIGHTED_ADMISSION_REQUIRES_POOL_DIAGNOSTIC` in
  `ConcurrencyConfig.ts`; weights now resolve OFF whenever the pool is OFF (even explicit true) with one
  searchable diagnostic; enforced on the final merged values (one authoritative path). Inverted the stale
  verifier assertion. `verify:concurrency-defaults` **12/12 → 18/18**.
- **Phase 03 (PROVEN):** exact cause = `SqliteRuntimeStore.queryRunHistory` hard-clamps a page to
  `Math.min(500, …)`; the soak counted `rows` of a single `{ limit: 200000 }` page (≤500) vs a live in-memory
  counter (~3822). NOT lost/unflushed/pruned/overwritten writes — the in-memory sql.js DB is synchronous, a
  reopened on-disk store returns every row, retention (5000) never triggered (3822<5000), `instanceId` is the
  PRIMARY KEY (no collision). Reproduced at 648-vs-500 through the real engine.
- **Fix:** added `countRunsByStatus` (unbounded SQL aggregate) + `getRun` to the store; `queryOverview` counts
  now use the aggregate (was a ≤5000 materialized read — latent under-count >5000); `getTelemetryRunDetail`
  uses the keyed `getRun`; added `getTelemetryStatusCounts` + `persistDurableNow`; benchmark harness/soak now
  paginate via `readAllRunHistory` + aggregate (live-vs-durable reconciliation logged).
- **Phase 04:** `scripts/verify-durable-accuracy.mts` (`verify:durable-accuracy`) — real engine, 600 OK + 40
  fail + 40 cancelled, explicit drain. **27/27**: submitted 680 = 600+40+40; expected persisted 648 = actual
  648; clamp reproduced (500 < 648); no dup/missing IDs; disk-reopen sees all; retention deterministic.
- **Phase 05:** impact matrix — no shipped stat was wrong except the latent `queryOverview` count under-count
  (fixed to aggregate); run-history `total`, workflow/failure aggregations, Instance Monitor (live), and Live
  Report were already correct. No UI redesign.
- **Verification:** `build` ✅ · `verify:concurrency-defaults` 18/18 · `verify:telemetry` 61/61 (new Part I) ·
  `verify:durable-accuracy` 27/27 · `verify:concurrency` 78/78 · `verify:runner` 82/82 ·
  `verify:shared-browser-pool` 19/19 · `verify:browser-isolation` 27/27.
- **Files:** `src/runner/concurrency/ConcurrencyConfig.ts`, `src/runner/store/{RuntimeStore,SqliteRuntimeStore}.ts`,
  `src/reports/TelemetryContracts.ts`, `src/runner/ExecutionEngine.ts`, `scripts/benchmark/engineHarness.mts`,
  `scripts/benchmark-engine-soak.mts`, `scripts/verify-concurrency-defaults.mts`, `scripts/verify-telemetry.mts`,
  `scripts/verify-durable-accuracy.mts` (new), `package.json`, `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md`
  (§13 truth table + §14–§20), `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.

## 2026-07-15 — Claude — Headed Production Anchor (closing Phase 01, not committed)

- **Task:** run the missing headed cross-check anchoring the pool+A8 production defaults against AWKIT's real
  default headed (`activeOnly`) execution — Config A vs D, MIXED, F=6, 50 s each, real `ExecutionEngine`.
- **New:** `scripts/benchmark-engine-headed-anchor.mts` (`benchmark:engine-headed`), reuses the engine harness
  (`runStage`, headed) — no new architecture, no `chromium.launch()` per instance. Artifact
  `reports/browser-performance/headed-anchor.json`.
- **Result:** D vs A headed — throughput **+122 %** (116.6 vs 52.5/min), P95 duration **−63.5 %** (2394 vs
  6554 ms), CPU P95 **−16 %** (83.8 vs 99.7 — A's 6 dedicated headed browsers pin CPU at 99.7 %), Chromium
  procs −10.5 %, RSS peak −52 % (1065 vs 2215 MB), median RSS +4.9 % (wash); 0 failures/crashes, clean
  teardown both. **Production defaults CONFIRMED (win larger headed than headless).** No regression → no fix.
- **Files:** `scripts/benchmark-engine-headed-anchor.mts` (new), `package.json`,
  `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md` (§4a + exec summary/§10/§11), `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`.
- **Note:** master overview also lists Phase 02 (enforce pool→A8 dependency — already implemented + verified
  by `verify:concurrency-defaults` last session) and Phase 03 (root-cause the 3822-vs-495 durable count — still
  open). Not executed here; awaiting their phase files / go-ahead.

## 2026-07-15 — Claude — Apply capacity defaults + reserve-formula change + close-reason telemetry + 30-min soak (not committed)

- **Task:** four completion items on top of the capacity report — (1) flip production defaults, (2) run the
  full 30-min soak, (3) resolve the browser-recycling contradiction with exact close-reason attribution,
  (4) re-evaluate the CapacityPlanner memory reserve across machine sizes.
- **(1) Defaults:** `ConcurrencyConfig.ts` — `useSharedBrowserPool` default → **true**; `workloadWeights`
  now defaults to the resolved pool state (dependency: ON with pool, never independently; explicit env wins).
  New `verify:concurrency-defaults` (12/12) proves the two required examples + override precedence.
- **(3) Close reasons:** `SharedBrowserPool` stamps + counts an exact reason per retirement
  (CONTEXT_COUNT_RECYCLE / MEMORY_THRESHOLD / IDLE_DRAIN / UNHEALTHY / CRASH / POOL_SHUTDOWN / LAUNCH_FAILURE /
  OTHER); exposed on the snapshot. Forced-recycle smoke → CONTEXT_COUNT_RECYCLE=22, IDLE_DRAIN=3,
  MEMORY_THRESHOLD=0. Report corrected: relaunches are context-count recycling + idle drain, never memory.
- **(4) Reserve:** replay (`benchmark:capacity-reserve`) showed the old formula under-admits on big machines
  (128 GB/23 GB-free → cap 1, usable=0) by subtracting %-of-total OS+safety from already-current available.
  Changed `CapacityPlanner.planCapacity` to Model C (OS reserve = ceiling; 1024 MB baseline + bounded growth;
  safety off available). Small/pressured machines unchanged. `verify:capacity-planner` 35/35 (+anti-pathology).
- **(2) 30-min soak (Config D, MIXED, conc 6):** ≈3822 completed (~127/min), 0 failed/retries/crashes; JS heap
  flat, handles flat, browsers/contexts bounded (≤4/≤5); AWKIT RSS +55 MB native drift (bounded); 80 relaunched
  = 80 closed (CONTEXT_COUNT_RECYCLE=77, IDLE_DRAIN=3, MEMORY_THRESHOLD=0); teardown CLEAN (all orphan/stale=0).
- **Files:** `src/runner/concurrency/ConcurrencyConfig.ts`, `src/runner/concurrency/CapacityPlanner.ts`,
  `src/runner/browser/SharedBrowserPool.ts`, `scripts/benchmark-engine-soak.mts`,
  `scripts/verify-concurrency-defaults.mts` (new), `scripts/benchmark-capacity-reserve.mts` (new),
  `scripts/verify-capacity-planner.mts`, `package.json`, `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** build clean; concurrency-defaults 12/12, capacity-planner 35/35, capacity-modes 10/10,
  machine-capabilities 20/20, benchmark-planner 36/36, shared-browser-pool 19/19, browser-isolation 27/27,
  runner 82/82, concurrency 78/78, shared-browser-live 5/5.
- **Not run / risks:** clean-machine packaged GUI walkthrough with pool-ON default; lower-spec hardware; the
  new reserve model admits more on large machines (bounded by benchmark-gating + runtime backpressure).

## 2026-07-15 — Claude — Real-ExecutionEngine capacity benchmark, shared-pool race fix, Phases 6–10 (not committed)

- **Task:** activate + calibrate the shared-browser dynamic capacity through the REAL `ExecutionEngine`
  dispatch path (not the context factory), across A/B/C/D configs, MIXED workloads, machine-relative ramp,
  weight calibration, memory-formula review, browser recycling, and a sustained soak; recommend defaults.
- **Continuation:** resumed a prior session that hit its limit mid-Phase-8 — the build was broken
  (`ExecutionEngine` called `evaluateSharedBrowserMemoryRecycling` which didn't exist; `SharedBrowserPool`
  used `browser.process()` which isn't on Playwright's typed `Browser`). Completed both.
- **Real defect found + fixed:** `SharedBrowserPool.selectOrLaunch` check-then-act race over-launched browsers
  under concurrent dispatch (maxBrowsers=2,conc=6 → 6 browsers). Reserved slot atomically under the pool
  mutex; peak 6 → 2; added a regression test to `verify:shared-browser-pool` (19/19).
- **Phase 8:** memory recycling wired end-to-end (`applyMemorySamples` moving-window drain + Windows
  `BrowserProcessSampler` subtree walk + throttled engine evaluator) but **inert** — Playwright 1.61 `Browser`
  has no `process()` (verified via types + runtime), so no per-browser root PID. Kept wired + documented
  ("disable-with-evidence") rather than rebuilding the launch path.
- **Findings:** Config D (pool+weights) at F=6 vs baseline A: procs −50 %, RSS −56 %, throughput +12.7 %, P95
  duration −34 %, stable concurrency +50 % (9 vs 6, 0 failures). Weighting-alone (C) is a net negative.
  Waiting workflows use ~0 CPU despite long duration → weight seeds validated + kept; no phase-aware weighting.
  1024 MB AWKIT reserve reviewed + kept. **Recommendation: enable pool + A8 weights by default (Config D);**
  shipped defaults left unchanged pending owner sign-off.
- **Phase 9 soak (Config D, MIXED, 10 min):** 497 completed / 0 failed / 0 retries; Chromium RSS −48 %,
  AWKIT RSS flat, browsers steady 3–4; teardown CLEAN (active/leased/stale/orphan all 0). Leak-free.
- **Files:** `src/runner/browser/SharedBrowserPool.ts`, `src/runner/ExecutionEngine.ts`,
  `src/runner/browser/BrowserProcessSampler.ts` (new), `scripts/benchmark/*` + `scripts/benchmark-engine-abcd.mts`
  / `-weight-calibration.mts` / `-engine-soak.mts` (new), `scripts/verify-shared-browser-pool.mts`,
  `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md` (new), `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`,
  `docs/ai/TASK_LOG.md`, `docs/ai/HANDOFF.md`.
- **Verification:** `npm run build` clean; `verify:shared-browser-pool` 19/19, `verify:browser-isolation`
  27/27, `verify:runner` 82/82, `verify:concurrency` 78/78. Reports in `reports/browser-performance/`.
- **Not run / risks:** single machine, single run/stage, synthetic flows; heavy-class CPU undersampled;
  30-min soak not run (10-min practical); recycling unexercised (no PID on this stack); default-flag flip
  left for owner.

## 2026-07-15 — Handoff prepared (shared-browser capacity)

- Updated `docs/ai/HANDOFF.md` current handoff to the shared-browser capacity task (branch `main`, HEAD level
  with `origin/main`, working tree modified & uncommitted; prior React-Flow-removal note demoted to a preserved
  "prior session" block; earlier uncommitted sessions — canvas engine, secret store/security audit, browser
  resource optimization, custom app frame — listed as "not this task").
- Verification re-confirmed green (see the entry below). `node scripts/ai-memory/check-memory.mjs` run.
- Next agent: decide whether to commit the tree (read the git-full-cycle skill first); do not push/PR unless asked.

---

## 2026-07-15 — Claude — Shared-browser capacity: authoritative isolation resolver + launch-arg-aware compatibility key (not committed)

- **Task:** maximise stable concurrent capacity by safely sharing Chromium processes. Prove the existing
  A5 shared-pool from code + runtime first; implement only the real gaps; do not rewrite working systems.
- **Investigation (proven from code):** traced `execution.ipc → ExecutionEngine.processQueue (500 ms tick)
  → Adaptive (A7) + Backpressure + [A8 weighted] admission → isSharedEligible? contextSlot : browserSlot
  → PlaywrightRunner → BrowserContextFactory.create (persistent | A5 shared lease | dedicated isolated)`.
  Confirmed A5 leases a fresh isolated `BrowserContext` per instance on a shared `Browser`, spreads then
  packs, drops crashed browsers, recycles after N contexts, drains idle at run end. Dynamic admission
  (A7 hysteresis), workload cost (A8), machine-aware memory reserve (A2 CapacityPlanner) already exist.
- **Gap found (latent correctness bug):** the shared launch key was only `browser:headed/headless` — it
  ignored the per-instance resolved `launchArgOverrides`. With the shared pool ON **and** a non-`balanced`
  resource profile, two instances with divergent launch flags (gpu/webgl/cache / throttle drops) would
  reuse one browser configured with only the first leaser's flags. No four-class isolation taxonomy or
  decision diagnostics existed either.
- **Built:** `src/runner/browser/BrowserIsolationResolver.ts` — authoritative resolver classifying every
  instance into `SHARED_CONTEXT | DEDICATED_BROWSER | PERSISTENT_BROWSER | HANDOFF_BROWSER` with
  `{decision,value,source}` diagnostics, plus `sharedCompatibilityKey(config, launchArgOverrides)` folding
  the browser-LEVEL launch config into the key (context-level options stay isolated per context). Delimited,
  collision-safe, dependency-free; `balanced`/no-overrides → one stable key (unchanged sharing).
- **Wired:** `browserSharing.isSharedEligible` now delegates to the resolver (single source of truth, no
  drift); `BrowserContextFactory` shared launcher uses `sharedCompatibilityKey(config, launchArgOverrides)`
  so incompatible launch configs never share a process; `ExecutionEngine.runInstanceInner` logs the
  isolation class + diagnostics only when the shared pool is enabled (quiet on the default path).
- **Files:** `src/runner/browser/BrowserIsolationResolver.ts` (new), `src/runner/browser/browserSharing.ts`,
  `src/runner/BrowserContextFactory.ts`, `src/runner/ExecutionEngine.ts`, `scripts/verify-browser-isolation.mts`
  (new), `package.json`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verified (no regression):** `npm run build` clean; new `verify:browser-isolation` **27/27** (four-class
  classification, precedence, shareability, isSharedEligible parity, compat-key folds launch args but not
  context-level diffs, pool honours the key); `verify:shared-browser-pool` **18/18**, `verify:shared-browser-live`
  **5/5** (real Chromium — 4 contexts on 2 processes preserved), `verify:runner` **82/82**, `verify:concurrency`
  **78/78**, `verify:workload-weights` **53/53**, `verify:resource-routing` **42/42**, `verify:chromium-hardening`
  **13/13**, `verify:browser-resource-profile` **51/51**, `verify:adaptive-concurrency` **14/14**,
  `verify:operation-limiters` **10/10**, `verify:telemetry` **54/54**.
- **Benchmarked:** ran `benchmark:concurrency` with `AWKIT_SHARED_BROWSER_POOL=1` — found the flag is INERT
  in that harness (it `chromium.launch()`es one browser per instance, bypassing ExecutionEngine/factory/pool).
  It reported this machine's baseline: highest sustainable **7**, production-approved **5**, stop at 8 on P95
  CPU 96.5% (CPU-bound). Built + ran new `benchmark:shared-pool` (`scripts/benchmark-shared-pool.mts`) that
  drives the REAL `BrowserContextFactory` + `SharedBrowserPool` and compares Model A (browser/workflow) vs
  Model B (shared): **N=4 −37.5% procs / −27% RSS; N=8 −56% procs / −39% RSS** (headless, maxBrowsers=2),
  per-context cookie isolation held every cell. Saving is RAM+process count, not CPU.
- **Not done / risks:** shared pool stays **default OFF** (owner decision D4). A full flag-ON run *through
  ExecutionEngine dispatch* under sustained load on a clean machine + the default flip remain the gate; the
  factory+pool lease is now measured. Persistent/Handoff dedicated paths and Reuse Session / Auto Secure
  Login / Manual Handoff / popup / parallel-page behaviour are unchanged.

---

## 2026-07-15 — Claude — Browser Resource Optimization: deep benchmark evidence + throttling removed (not committed)

- **Task:** raise statistical confidence (20–30 reps), test minimized/occluded headed windows, ablate each
  optimization, build a representative workload matrix, and produce an evidence-based production recommendation.
- **Built:** `scripts/benchmark/lib.mts` (shared: stats, multi-workload server, subtree sampling, Win32
  minimize) + `benchmark-occlusion.mts` / `benchmark-ablation.mts` / `benchmark-workloads.mts` (+ npm scripts).
- **Ran:** occlusion 20 reps (5 throttle configs on a genuinely minimized window), ablation 20 reps (per-knob,
  image-heavy), workloads 15 reps (Balanced vs Low-Resource × 8 workloads). Artifacts + logs in
  `reports/browser-performance/`.
- **Findings:** background throttling gives **zero** CPU benefit for automated instances (minimize already
  floors CPU; Playwright keeps pages `visible` so timers never throttle; behaviour 100%) → **removed from
  low-resource default**. RAM win is ~all image blocking (−6% RAM / −99% net); earlier 21% was 3-rep noise;
  RAM saving is workload-dependent (~0–13%). Duration unchanged; capability overrides validated live.
- **Fix applied:** `BrowserResourceProfile.ts` low-resource `backgroundThrottling.enabled=false` (mechanism
  kept for `custom`); `verify-browser-resource-profile.mts` updated (51/51). Doc `BROWSER_RESOURCE_OPTIMIZATION.md`
  rewritten (§4/§5/§7/§9) with tables + recommendation; `.env.example` + CURRENT_STATE corrected.
- **Files:** `src/runner/browserProfile/BrowserResourceProfile.ts`, `scripts/benchmark/lib.mts`,
  `scripts/benchmark-{occlusion,ablation,workloads}.mts`, `scripts/verify-browser-resource-profile.mts`,
  `package.json`, `.env.example`, `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`, `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`, `reports/browser-performance/*`.
- **Verified (no regression):** build clean; `verify:browser-resource-profile` 51/51, `verify:runner` 82/82,
  `verify:chromium-hardening` 13/13, `verify:lean-mode` 12/12, `verify:resource-routing` 42/42,
  `verify:concurrency` 78/78, `verify:workload-weights` 53/53, `verify:telemetry` 54/54.
- **Not done / risks:** multi-instance RAM totals are a labelled linear estimate (not multi-instance-benchmarked);
  CPU is not a reliable per-instance lever (rendering-dominated); GPU/WebGL/renderer-limit stay Custom-only;
  Settings UI + unattended→low-resource auto-rule are follow-ups.

---

## 2026-07-15 — Claude — Browser Resource Optimization: per-instance Chromium profiles + resolver (not committed)

- **Task:** reduce per-instance Chromium CPU/RAM/network/disk cost while preserving workflow behaviour;
  build a safe, configurable, measurable optimization architecture (not a concurrency change).
- **Investigation:** traced the full launch lifecycle (single site = `BrowserContextFactory.create`) and
  audited the real launch args (Playwright 1.61.0 defaults + `ChromiumHardening`); found the A9
  `ResourceRoutingPolicy`/`ArtifactProfile` were env-only and never wired to `PlaywrightRunner`, with no
  unified profile / resolver. Full write-up: `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`.
- **Implemented (additive, default = today):** `src/runner/browserProfile/` — `BrowserResourceProfile.ts`
  (4 presets), `WorkflowCapabilities.ts` (capabilities only RELAX), `BrowserRuntimeConfigurationResolver.ts`
  (authoritative + per-decision diagnostics), `resolveForRun.ts`. Wired via
  `BrowserContextFactory.launchArgOverrides` (selective `ignoreDefaultArgs`, never `true`),
  `ChromiumHardening.omitBackgroundTimerThrottlePin` (re-enable background throttling for low-resource),
  `PlaywrightRunner.traceMode/resourceRouting`, `ExecutionEngine.runInstance` (resolve once/instance).
  Measurement fix: `ProcessTreeSampler` now counts `chrome-headless-shell.exe`.
- **Files:** `src/runner/browserProfile/{BrowserResourceProfile,WorkflowCapabilities,BrowserRuntimeConfigurationResolver,resolveForRun}.ts`,
  `src/runner/ChromiumHardening.ts`, `src/runner/BrowserContextFactory.ts`, `src/runner/PlaywrightRunner.ts`,
  `src/runner/ExecutionEngine.ts`, `src/runner/runtime/ProcessTreeSampler.ts`,
  `scripts/verify-browser-resource-profile.mts`, `scripts/benchmark-browser-resource.mts`, `package.json`,
  `.env.example`, `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean; `verify:browser-resource-profile` **49/49**; regression
  `verify:runner` **82/82**, `verify:chromium-hardening` **13/13**, `verify:lean-mode` **12/12**,
  `verify:resource-routing` **42/42**, `verify:concurrency` **78/78**, `verify:workload-weights` **53/53**,
  `verify:telemetry` **54/54**. Benchmark (i7-8750H/12c/16GB headless, 3 reps): low-resource vs balanced —
  network **−100% bytes / −96.8% req**, RAM **−8% avg / −9.6% peak**, navigate CPU **−20.6%**; idle CPU a
  wash (foreground headless doesn't background-throttle). Artifacts: `reports/browser-performance/`.
- **Not run / risks:** headed/occluded throttling win (display-dependent) not measured; GPU/WebGL/renderer-limit
  Custom-only pending clean-machine benchmark; Settings UI + per-workflow capability hints are follow-ups;
  low-resource-as-default is an owner decision. No packaged/offline walkthrough run (no offline-path behaviour changed).

---

## 2026-07-14 — Claude — Security hardening batch 2: residuals + defense-in-depth (not committed)

- **Task:** close the F-01/F-09 residuals and add the §13/§16 hardening; attempt `sandbox:true`.
- **F-01 residual:** global runtime root threaded into the execution context as `protectedUploadRoots`
  (`InstanceExecutionContext` + `ExecutionEngine` + `StepExecutor.assertUploadAllowed`) → uploads of
  captured browser profiles (cookies/Login Data) + durable store are now blocked.
- **F-09 residual:** `installGlobalSenderGuard()` in `app/main/ipc/index.ts` wraps every `ipcMain.handle`
  with `isTrustedSender` (covers all channels, not just the high-privilege ones).
- **Prototype pollution (§13):** `setJsonAtPath` rejects `__proto__`/`constructor`/`prototype` keys;
  `resolveJsonPath` refuses to traverse them (`TableEditing.ts`, `JsonPathResolver.ts`).
- **Smart Locator integrity (§16):** `guardLocatorQuality` fails a dangerousMutation/externalCommit step
  with a positional/fallback locator (wrong-privileged-action risk).
- **`sandbox:true`:** attempted, **reverted** — broke the ESM `preload.mjs` in a real-Electron GUI smoke
  (`verify:flow-designer` timed out on render). Needs preload→CJS migration; tracked as standalone. F-06
  `will-navigate` lockdown already removes the exploitable vector.
- **Also fixed:** a stray control byte in `StepExecutor.ts` (download-sanitizer regex) that made the file
  read as binary to ripgrep — rewritten as clean ASCII (`/[\x00-\x1f]+/`).
- **Verified:** `npm run build` clean; `verify:security` **33/33**; GUI `verify:flow-designer` **24/24**
  (no console errors, proves sender guard + IPC intact); `verify:runner` **82/82**, `verify:data-editor`
  **27/27**, `verify:ipc-contract` **4/4**.

## 2026-07-14 — Claude — Security hardening: LOW+MEDIUM+HIGH audit fixes (not committed)

- **Task:** fix the findings from `docs/security/FULL_SECURITY_AUDIT.md`, ascending severity. LOW+MEDIUM
  first; HIGH (F-01, F-03) applied after owner review chose the "recommended" approach. No commit, no GitHub.
- **HIGH fixes:** F-01 upload crown-jewels blocklist — `StepExecutor.assertUploadAllowed` refuses uploads
  inside AWKIT sessions/logs/reports/screenshots/traces (+ traversal), general user files still allowed;
  F-03 lenient bounds normalization — new `src/profiles/FlowValidation.ts` `normalizeFlowBounds` clamps
  timeouts/retries/loop iterations + caps alternatives/waits arrays + warns on duplicate ids, wired into
  `FlowExecutor.executeFlow` (keeps unknown-step-type rejection; does not reject unknown props → legacy
  flows still load). `verify:security` extended to 29/29; `verify:runner` 82/82, `verify:waits` 21/21.
  Residual P2: global session-capture profile dir not yet in the upload blocklist (needs runtime root
  threaded into the execution context).
- **New helpers:** `src/runner/urlPolicy.ts` (navigation allowlist), `src/utils/pathSafety.ts`
  (`isPathInside` confinement), `app/main/ipc/senderGuard.ts` (`assertTrustedSender`).
- **Fixes:** F-02 `assertNavigableUrl` on both `goto` sinks (blocks `file:`/`javascript:`/`chrome*`/
  `devtools:`; allows http(s)/about/data); F-04 data-source writes confined to workspace + `saveSession`
  folder confined to sessions root; F-05 `system:openPath` confined to app data folders + exe-extension
  block; F-06 `will-navigate`/`will-redirect` lockdown in `windowManager.ts`; F-07 recorder redaction
  extended to OTP/one-time-code/card/CVV/PIN/SSN/token fields; F-08 `sanitizeDownloadFileName`;
  F-09 `assertTrustedSender` on `execution:runWorkflow`, `dataSources:writeJson/createFromScratch`,
  `session:startCapture`, `system:openPath`; F-11 session capture rejects non-http(s) targets.
- **Files:** `src/runner/StepExecutor.ts`, `src/session/SessionCaptureService.ts`, `src/recorder/
  recorderInitScript.ts`, `app/main/windowManager.ts`, `app/main/ipc/{system,dataSource,execution,session}.ipc.ts`,
  + the 3 new helpers, `scripts/verify-security.mts`, `package.json` (`verify:security`).
- **Verified:** `npm run build` clean; new `verify:security` **20/20**; regression `verify:runner` **82/82**,
  `verify:recorder` **72/72**, `verify:ipc-contract` **4/4**, `verify:data-editor` **27/27**,
  `verify:waits` **21/21**, `verify:protected-login` **16/16**, `verify:protected-login-recorder` **34/34**.
- **Behaviour notes:** data-source edits to a file outside the workspace now save a workspace copy (were
  written in place); `goto`/`routeChange` to `file://` now error; `system:openPath` outside app folders
  returns a message instead of opening. Remediation status table added to the audit report.

## 2026-07-14 — Claude — Full security audit (report-only, no code changes)

- **Task:** perform an evidence-based security audit of the actual AWKIT codebase per
  `docs/security/SECURITY_AUDIT_BRIEF.md` (added from `UI Samples/Security Audit.md`). Audit-and-report
  only — no fixes applied, no commit, no GitHub interaction (per user instruction and the brief).
- **Produced:** `docs/security/FULL_SECURITY_AUDIT.md` (executive summary, threat model, architecture,
  privileged-op inventory, IPC/workflow-trust reviews, 11 findings, roadmap). Rating **C**; recommendation
  **YES WITH CONDITIONS**.
- **Key findings (all traced to current source):** F-01 arbitrary local-file upload via `uploadFile`
  `setInputFiles` unbounded path (`StepExecutor.ts:832`, HIGH); F-03 no runtime schema/bounds validation of
  workflow JSON (`FlowProfile.ts`, HIGH); F-02 no `goto` protocol allowlist (`file://` reachable, MEDIUM);
  F-04 arbitrary FS write via data-source `file`/`saveSession` folder (MEDIUM); F-05 `system:openPath`
  unrestricted (MEDIUM); F-06 no `will-navigate` guard + `sandbox:false` (MEDIUM); F-07 recorder captures
  non-password field values literally (MEDIUM).
- **Strong existing controls confirmed:** no eval/Function/vm; safe hand-written condition evaluators;
  arg-array spawn (no shell injection); http(s)-only external open; recorder password/URL redaction; no
  CAPTCHA/MFA-bypass or stealth; parameterized SQL; atomic writes + profile locks; downloads never executed.
- **Tests run:** `npm audit` (dev-only advisories, not shipped). **Not run:** live malformed-workflow repro,
  packaged-EXE signing/storage check, concurrent-session isolation stress (called out in the report).
- **No source code changed.**

## 2026-07-13 — Claude — Live-vs-history on the execution report (phase B4)

- **Task:** show a running/finished instance's elapsed vs the workflow's historical per-run avg/p95 (for
  the current machine) on the Execution Report opened from Instance Monitor. Renderer + verifier only;
  consumes the B2 channels (no IPC/preload/schema/InstanceMonitor change). Completes reporting workstream B.
- **Changed:** `app/renderer/components/instances/executionReportModel.ts` (+pure
  `compareElapsedToHistory` + `WorkflowHistoryBaseline`/`HistoryComparison` types);
  `app/renderer/components/instances/LiveExecutionReportModal.tsx` (baseline fetch via
  `telemetry.workflowComparison("all", {machineId})` with all-machines fallback; `vs history` banner line +
  tone chip + `History avg`/`History p95` stat cards + Elapsed delta hint); `app/renderer/styles/global.css`
  (`.report-history-vs`, `.report-vs-chip.tone-*`).
- **Files:** `executionReportModel.ts`, `LiveExecutionReportModal.tsx`, `global.css`,
  `scripts/verify-instance-monitor.mts`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:instance-monitor` **43/43** (+8 comparison cases);
  `verify:instance-monitor-gui` **12/12** (real 4-instance run, no renderer errors); a real-Electron capture
  with a 3-run history rendered the machine-scoped `vs history: avg 4s · p95 4s · 18% slower than avg` line
  + stat cards, 0 console errors.
- **Result:** reporting workstream B (B1–B4) complete.

## 2026-07-13 — Claude — Workflow Reports comparison UI + machine filters (phase B3)

- **Task:** surface the B1/B2 machine-aware read-model in the renderer — per-workflow comparison vs the
  previous window, trend sparklines, delta chips, and machine/mode/pool/class filters. Renderer + verifier
  only; consumes the existing B2 channels (no IPC/preload/schema change).
- **Changed:** `app/renderer/pages/ReportsWorkflows.tsx` — swapped `telemetry.workflows` →
  `telemetry.workflowComparison(range, machineFilter)`; added delta chips (goodness-colored) on
  Runs/Success/Avg/p95, a trend glyph + lazy per-row success-rate sparkline (`telemetry.workflowTrend`,
  reusing `MetricSparkline`), a machine-context caption, a Machine/Mode/Browsers/Workload filter bar
  (options from `telemetry.machines`, "This machine" from `system.capacityPreview`), and a Compare mode
  (2–4 side-by-side cards). `app/renderer/styles/global.css` — token-only classes for the above; new
  columns stay inside `.awkit-table-wrap`; `prefers-reduced-motion` honored.
- **Files:** `ReportsWorkflows.tsx`, `global.css`, `scripts/verify-reports-gui.mjs`;
  `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:reports` (GUI) **31/31** (adds filter-bar 4 selects,
  interactive filter + stable page, Compare toggle + valid state, no telemetry/undefined console errors);
  real Electron capture visually confirmed delta chips + sparkline + trend glyph with live data. Regression
  `verify:ipc-contract` **4/4**, `verify:telemetry` **54/54**.
- **Next:** B4 (optional) live-vs-history on the Instance Monitor run card. Machine-context captions stay
  blank until v3 runs accrue.

## 2026-07-13 — Claude — Machine-aware report IPC + preload (phase B2)

- **Task:** expose the B1 read-model to the renderer via IPC + preload. Additive channels; existing
  telemetry channels untouched.
- **Changed:** `app/main/ipc/telemetry.ipc.ts` (+`telemetry:workflowComparison`/`workflowTrend`/`machines`
  handlers + `trendBucketsForPreset`); `src/runner/ExecutionEngine.ts` (+`getTelemetryWorkflowComparison`/
  `getTelemetryWorkflowTrend`/`getTelemetryMachines` delegators); `app/main/preload.ts` (+`workflowComparison`/
  `workflowTrend`/`machines` bridge methods + type imports).
- **Files:** `telemetry.ipc.ts`, `ExecutionEngine.ts`, `preload.ts`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:ipc-contract` **4/4** (121 handlers / 98 exposed / 23
  backend-only — each new channel has one handler AND is exposed).
- **Next:** B3 comparison UI + machine filters (ReportsWorkflows); B4 optional live-vs-history run card.

## 2026-07-13 — Claude — Machine-aware report read-model (phase B1)

- **Task:** persist per-run machine context + add a machine-aware per-workflow comparison (current vs
  previous window) and run-over-run trend to the reporting read-model. Read-model + persistence only; no
  IPC/UI (B2/B3).
- **Schema:** migration **v3** (`RuntimeStoreSchema.ts`) — additive nullable machine-context columns on
  `runtime_runs` (machineId/cpu/mem/executionMode/browserPoolMode/configuredConcurrency/
  observedPeakConcurrency/workloadClass/capacityRecommendationAtRun) + `idx_runs_machine`; v1/v2 upgrade in
  place. `DurableRunRecord` + `upsertRun` extended.
- **Contracts (`TelemetryContracts.ts`):** `MachineRunContext`, `MachineFilter`, `WorkflowComparisonRow`
  (+previous/delta/trend/machineContext), `WorkflowTrend(Point)`, `MachineSummary`, `machineContextFromRun`;
  `RunHistoryFilter` extends `MachineFilter`.
- **Store (`SqliteRuntimeStore.ts`):** `queryWorkflowComparison` (half-open current/previous windows;
  all-time → trend "new"; deltas undefined-not-NaN), `queryWorkflowTrend`, `listRunMachines`; machine
  filters in `queryRunHistory`; shared `aggregateWorkflows`. `RuntimeStore` + `NullRuntimeStore` updated.
- **Write path:** `ExecutionEngine.setMachineRunContext` + run-start/end `upsertRun` stamping + peak-
  concurrency tracking; `capacityService.buildMachineRunContext` + `execution.ipc` push.
- **Files:** `RuntimeStoreSchema.ts`, `SqliteRuntimeStore.ts`, `RuntimeStore.ts`, `TelemetryContracts.ts`,
  `ExecutionEngine.ts`, `app/main/capacityService.ts`, `app/main/ipc/execution.ipc.ts`;
  `scripts/verify-telemetry.mts`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:telemetry` **54/54** (v1→v2→v3 in-place upgrade, comparison
  window split + delta/trend + empty→new/no-NaN, machine filtering, trend buckets, listRunMachines,
  run-history machine filters); regression `verify:runner` **82/82**.
- **Next:** B2 IPC (`telemetry:workflowComparison`/`workflowTrend`/`machines`) + preload; B3 comparison UI +
  machine filters; B4 optional live-vs-history run card.

## 2026-07-13 — Claude — Machine-relative benchmark harness (phase A10)

- **Task:** calibrate this machine's real sustainable capacity via machine-relative concurrency stages
  (scaled from the recommendation R + ceiling, not a fixed sequence), stopping at the first stage that
  trips a health stop condition; write the result into the machine profile. Heavy + opt-in.
- **New:** `src/runner/concurrency/BenchmarkPlanner.ts` (pure) — `generateBenchmarkStages`/`normalizeStages`
  (distinct ascending integers in `[1,ceiling]`), `evaluateStopConditions` (sustained/P95 CPU, free-mem
  reserve, memory %, event-loop delay, error rate, browser/renderer crashes, queue delay, latency
  regression; missing telemetry never stops), `productionApprovedCapacity` (margin below highest
  sustainable), `summarizeBenchmark` (contiguous sustainable run), `applyBenchmarkToProfile`.
  `scripts/benchmark-concurrency.mts` — heavy driver (`npm run benchmark:concurrency`) with an
  `AWKIT_BENCHMARK_PLAN_ONLY`/`--plan` dry-run; drives mock-site loops per stage, samples health, writes a
  JSON artifact + updates the machine profile.
- **Files:** the new module; `scripts/verify-benchmark-planner.mts`, `scripts/benchmark-concurrency.mts`;
  `package.json`; `.gitignore` (`.benchmark-runtime/`); `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; new `verify:benchmark-planner` **36/36**; plan-only harness smoke on
  a 12-CPU/16-GB host printed machine-relative stages (`1 → … → 12`). Not run: the full live benchmark — a
  true production cap requires a clean-machine run (external gate).
- **Next:** consume `benchmarkTestedCapacity`/`productionApprovedCapacity` in Auto + the Settings capacity
  preview; feed measured per-instance estimates back into the planner seeds; reporting workstream B.

## 2026-07-13 — Claude — Resource-reduction profiles (PR-CAP-2 phase A9)

- **Task:** per-run knobs to cut per-instance cost — Normal/Lean/Ultra-Lean request routing + formal
  Production/Balanced/Debug/Full artifact profiles. Defaults (Normal + Balanced) preserve today's exact
  behaviour; images are never blocked by default.
- **New:** `src/runner/ResourceRoutingPolicy.ts` (pure decision + context options + env loader + best-
  effort `context.route` installer) and `src/runner/artifacts/ArtifactProfile.ts` (trace/screenshot/video
  mapping).
- **Changed:** `BrowserContextFactory.ts` (resolves routing once; `buildContextOptions` folds profile
  context options into all 3 context paths; installs routing on each created context);
  `artifacts/TraceService.ts` (`loadTraceMode` falls back to the artifact profile — Balanced default =
  onFailure, unchanged; explicit `AWKIT_TRACE_MODE` still wins).
- **Files:** the two new modules; `BrowserContextFactory.ts`, `artifacts/TraceService.ts`;
  `scripts/verify-resource-routing.mts`, `scripts/verify-lean-mode.mts`; `package.json`;
  `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; new `verify:resource-routing` **42/42** + `verify:lean-mode`
  **12/12** (real Chromium: Lean aborts image, Ultra-Lean aborts image+stylesheet, DOM intact, allow-list
  rescue); regression `verify:runner` **82/82** (Normal unregressed), `verify:concurrency` **78/78**.
  Not run: a dedicated Mock Site Lean/downloads scenario (live proof uses a self-contained temp server).
- **Next:** A10 machine-relative benchmark harness; Settings UI to pick resource/artifact profiles; wire
  the artifact-profile video/screenshot fields beyond trace; optional Mock Site lean/downloads scenario.

## 2026-07-13 — Claude — Workload-aware capacity + scheduler weights (PR-CAP-2 phase A8)

- **Task:** stop treating every instance as one identical flow — weight each by real cost (persistent
  profile / headed / downloads / parallel branches / trace-video / large flows) and, when enabled, admit
  dispatch against a weighted budget instead of a raw active count. Flag-guarded OFF; flag-off unchanged.
- **New:** `src/runner/concurrency/WorkloadWeights.ts` (pure) — `extractWorkloadFeatures`,
  `computeWorkloadWeight` (additive, monotonic, clamped), `classifyWorkload` (light/medium/heavy, rounds
  UP on ambiguity), `weightedBudget` + `canAdmitWeighted` (never deadlocks an idle host),
  `buildWorkloadRecommendation` (confidence unmeasured→estimated→benchmarked), one
  `DEFAULT_WORKLOAD_WEIGHT_CONFIG` of seeds.
- **Changed:** `ConcurrencyConfig.ts` (+`workloadWeights` bool + `workloadWeightBudgetPerFlow`, both
  env-overridable; new `envFloat` helper); `ExecutionEngine.ts` (per-instance weight cache dropped on
  runner settle; dispatch-loop weighted-admission gate before slot acquisition, flag-gated).
- **Files:** the new module; `ConcurrencyConfig.ts`, `ExecutionEngine.ts`;
  `scripts/verify-workload-weights.mts`; `package.json`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; new `verify:workload-weights` **53/53**; regression
  `verify:concurrency` **78/78**, `verify:adaptive-concurrency` **14/14**, `verify:operation-limiters`
  **10/10**. Not run: live flag-ON multi-instance weighted-admission engine run (external gate).
- **Next:** A9 resource-reduction profiles (lean/artifact modes); A10 benchmark harness; surface the
  per-class recommendations in the Settings capacity preview / IPC; history-driven weight calibration.

## 2026-07-13 — Claude — Adaptive concurrency controller (PR-CAP-2 phase A7)

- **Task:** shrink the live active-flow target under real host pressure (incl. other apps) and recover
  gradually. Purely protective — no pressure means it sits at the cap (steady-state unchanged).
- **New:** `src/runner/concurrency/AdaptiveController.ts` (healthy/stable/pressure/critical classification,
  grow-slow/shrink-fast, cooldown, `[1,ceiling]` clamp, `setCeiling` jump; injected clock; pure).
- **Changed:** `ResourceSampler.ts` (+`eventLoopDelayMs` via `monitorEventLoopDelay`); `ConcurrencyConfig.ts`
  (+adaptive enable/steps/cooldown/thresholds, env-overridable); `BackpressureController.ts` (`admit` takes
  optional `effectiveMaxFlows` clamped ≤ maxActiveFlows; `snapshot` carries adaptive fields);
  `CapacitySnapshot.ts` (+`adaptiveTarget`/`adaptiveState`); `ExecutionEngine.ts` (owns controller, evaluates
  each tick with the live sample + crash count + queue depth, passes target to admit, re-seeds ceiling in
  configureConcurrency, surfaces state in getCapacitySnapshot).
- **Files:** the new module; `ResourceSampler.ts`, `ConcurrencyConfig.ts`, `BackpressureController.ts`,
  `CapacitySnapshot.ts`, `ExecutionEngine.ts`; `scripts/verify-adaptive-concurrency.mts`; `package.json`;
  `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:adaptive-concurrency` **14/14**; regression
  `verify:concurrency` **78/78**, `verify:resource-sampling` **14/14**, `verify:runtime-status` **15/15**,
  `verify:operation-limiters` 10/10, `verify:runner` **82/82**. Not run: live sustained-pressure engine run.
- **Next:** A8 workload weights, A10 benchmark harness; workstream B reports; optional monitor-strip UI for
  adaptive state.

## 2026-07-13 — Claude — Operation limiters (PR-CAP-2 phase A6)

- **Task:** stagger expensive operations so N active instances don't all launch/navigate/download/
  screenshot at once. Active by default with conservative caps; only staggers, no behavior change.
- **New:** `src/runner/concurrency/OperationLimiters.ts` (five semaphore-backed kinds + `run`/`configure`/
  `snapshot`; short-held permits released in `finally`).
- **Changed:** `ConcurrencyConfig.ts` (+5 `maxConcurrent*` fields, env-overridable);
  `BrowserContextFactory.ts` (wraps launch/persistent-launch + newContext, both shared+dedicated);
  `StepExecutor.ts` (+15th ctor param + `limitOp`; wraps 2 goto sites, `download.saveAs`, both
  screenshot calls); `PlaywrightRunner.ts` (passes limiters to both StepExecutor sites);
  `ExecutionEngine.ts` (owns/sizes limiters, passes to every runner); `app/main/ipc/execution.ipc.ts`
  (Sequential → all limiters 1).
- **Files:** the new module; `ConcurrencyConfig.ts`, `BrowserContextFactory.ts`, `StepExecutor.ts`,
  `PlaywrightRunner.ts`, `ExecutionEngine.ts`, `app/main/ipc/execution.ipc.ts`;
  `scripts/verify-operation-limiters.mts`; `package.json`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:operation-limiters` **10/10**; `verify:runner` **82/82**
  (real Chromium, wrapped ops unregressed); `verify:waits` **21/21**; `verify:concurrency` **78/78**;
  shared-pool 18/18 + live 5/5; capacity-modes 10/10. Not run: full multi-instance live spike test.
- **Next:** A7 adaptive controller, A8 weights, A10 benchmark; workstream B reports.

## 2026-07-13 — Claude — Shared Chromium browser pool (PR-CAP-3 phase A5, flag-guarded)

- **Task:** implement the plan's shared browser pool so many isolated contexts share a few Chromium
  processes. Experimental, gated by `AWKIT_SHARED_BROWSER_POOL` (default OFF); flag-off is unchanged.
- **New:** `src/runner/browser/SharedBrowserPool.ts` (lease/spread/pack/least-loaded/health/recycle/drain,
  injectable launcher), `src/runner/browser/browserSharing.ts` (`isSharedEligible`/`scenarioUsesBrowserSwap`/
  `sharedLaunchKey`).
- **Changed:** `ConcurrencyConfig.ts` (+`useSharedBrowserPool` + recycle/hard-limit fields, env-overridable);
  `BrowserWorkerPool.ts` (+`acquireContextSlot` non-semaphore context slots; snapshot counts only real
  browser slots for saturation); `BrowserContextFactory.ts` (leases from the pool for browserContext when
  supplied); `ExecutionEngine.ts` (constructs+sizes the pool, routes eligible instances to context
  slots + the pool, drains idle at run end); `PlaywrightRunner` passes the pool through via options.
- **Design:** dedicated (own browser) for persistentContext / captured session / browser-swap-node
  instances; shared for plain browserContext. Shared instances bounded by `maxActiveFlows` + the pool's
  browser cap, not `maxBrowsersPerHost`. Preserves the expected-close/crash generation logic.
- **Files:** the two new `src/runner/browser/*` modules; `ConcurrencyConfig.ts`, `BrowserWorkerPool.ts`,
  `BrowserContextFactory.ts`, `ExecutionEngine.ts`; `scripts/verify-shared-browser-pool.mts`,
  `scripts/verify-shared-browser-live.mts`; `package.json`; `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:shared-browser-pool` **18/18**; `verify:shared-browser-live`
  **5/5** (real Chromium — 4 contexts → 2 processes); flag-off parity `verify:browser-pool` **25/25**,
  `verify:concurrency` **78/78**, `verify:runner` **82/82**; `verify:capacity-modes` **10/10**. Not run:
  full flag-ON multi-instance engine run vs mock site (heavy — external/clean-machine gate).
- **Next:** live flag-ON multi-instance verification before default-on (D4); shared-browser count in the
  runtime-status gauge; A6 operation limiters, A7 adaptive controller, A8 weights, A10 benchmark.

## 2026-07-13 — Claude — Machine-aware concurrency modes (PR-CAP-1 phase A4)

- **Task:** wire the A1–A3 capacity core into real dispatch + Settings — Sequential/Auto/Manual modes.
- **Settings (`app/main/uiSettings.ts`):** extended `runtime` with `capacityMode` (default `manual`,
  back-compat), `workloadClass`, `administratorMaximumConcurrency`, `absoluteSafetyMaximum`,
  `capacitySafetyFactor`, `reservedLogicalCpuCount`; legacy files migrate on read; validation extended
  (main + renderer mirror).
- **Resolver + service:** `src/runner/concurrency/CapacityContracts.ts` (pure `resolveEffectiveConcurrency`
  + `CapacityMode`/`CapacityPreview` + `DEFAULT_UNBENCHMARKED_AUTO_CEILING`); `app/main/capacityService.ts`
  (`computeEffectiveConcurrency` for the apply seam, `previewCapacity` for the UI, detects host + refreshes
  the per-machine profile on Auto). Sequential=1/1, Manual=explicit, Auto=benchmark-or-conservative; all
  clamped to admin max + absolute ceiling.
- **Apply + IPC:** `applyRuntimeConcurrencyFromSettings()` (`app/main/ipc/execution.ipc.ts`) now maps the
  mode through `computeEffectiveConcurrency` → `ExecutionEngine.configureConcurrency`; new
  `system:capacityPreview` handler (`system.ipc.ts`) + preload `system.capacityPreview`.
- **UI:** `app/renderer/pages/Settings.tsx` Runtime Concurrency card → mode selector + live machine
  readout + Auto workload class + Manual inputs/warning + Advanced safety limits; token-only CSS in
  `global.css` (`.capacity-mode-row/.capacity-readout/.capacity-advanced`, `.form-message.warn`).
- **Files:** `app/main/uiSettings.ts`, `app/main/capacityService.ts`,
  `src/runner/concurrency/CapacityContracts.ts`, `app/main/ipc/execution.ipc.ts`,
  `app/main/ipc/system.ipc.ts`, `app/main/preload.ts`, `app/renderer/pages/Settings.tsx`,
  `app/renderer/styles/global.css`, `scripts/verify-capacity-modes.mts`,
  `scripts/verify-capacity-settings-gui.mjs`, `package.json`, `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`.
- **Verified:** `npm run build` clean; `verify:capacity-modes` **10/10**; `verify:capacity-settings-gui`
  **12/12** (real Electron, non-destructive snapshot/restore); `verify:ipc-contract` **4/4**;
  `verify:settings-persistence` **3/3**; `verify:concurrency` **78/78**. Not run: clean-machine offline
  walkthrough.
- **Next:** A5 shared browser pool (Auto maps target→maxBrowsers 1:1 until then); A6/A7/A8/A10 per plan.

## 2026-07-13 — Claude — Machine-agnostic capacity core (PR-CAP-1 phases A1–A3)

- **Task:** begin executing `docs/ai/CONCURRENCY_CAPACITY_AND_REPORTS_PLAN.md`. Landed the pure-core,
  hardware-agnostic foundation only — **no** engine/IPC/UI wiring yet, no behavior change to runs.
- **A1 — `src/runner/concurrency/MachineCapabilityDetector.ts`:** detects `MachineCapabilities` from an
  injectable `OsProbe` (never throws), a coarse capability **fingerprint** (stable across reboot +
  available-memory drift; changes on CPU count / total-RAM band / platform / OS), `capabilitiesChanged`
  with reasons, and a locally generated + atomically persisted `machineId` (`<runtimeRoot>/machine-id.json`
  — no hardware serials/MACs).
- **A2 — `src/runner/concurrency/CapacityPlanner.ts`:** pure `min(RAM, CPU, adminMax, ceiling)` planner
  with all seeds/bounds in one `CapacityTuning` object (`DEFAULT_CAPACITY_TUNING`); absolute+percentage
  reserve precedence (more-protective wins); config-driven bootstrap categories; live background-CPU input;
  measured per-instance overrides; per-workload recommendations. High RAM alone never inflates capacity.
- **A3 — `src/runner/concurrency/MachineCapacityProfileStore.ts`:** per-machine `MachineCapacityProfile`
  persisted atomically under `<runtimeRoot>/runtime/machine-profiles/<machineId>.json`; `reconcileMachineProfile`
  flags recalibration + drops stale benchmark values on hardware change while preserving the
  administrator/manual `configuredCapacity`; profiles isolated per machine.
- **Files:** the three `src/` modules above; `scripts/verify-machine-capabilities.mts`,
  `scripts/verify-capacity-planner.mts`, `scripts/verify-machine-profile.mts`; `package.json` (3 scripts);
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `tsc --noEmit` clean; `verify:machine-capabilities` **20/20**; `verify:capacity-planner`
  **29/29**; `verify:machine-profile` **15/15**. Not run: engine/GUI (no wiring yet — A4 does that).
- **Next:** A4 wires Sequential/Auto/Manual modes + capacity settings + `system:capacityPreview` IPC into
  `uiSettings.ts` / `execution.ipc.ts` / `Settings.tsx` (checkpoint before that integration).

## 2026-07-12 — Claude — Fix Flow/Workflow Designer right inspector overflowing into the toolbar

- **Task:** the right properties drawer's top edge poked above the canvas into the flush action bar
  ("overflow to the toolbar … shouldn't exceed canvas height") on the Flow Designer.
- **Root cause:** `.designer-layout.flush-layout .designer-right-drawer-slot` used a fixed
  `padding-top: calc(var(--space-5)*3 + var(--space-1))` (76px) to clear the in-canvas `.flow-action-bar`.
  That bar has `flex-wrap: wrap`; at narrower widths it wraps to ~106px, so the 76px offset left the
  drawer starting above the canvas body.
- **Change:** `DesignerCanvasLayout` now measures the live `.flow-action-bar` height (layout effect +
  `ResizeObserver`) and exposes it as `--awkit-action-bar-h` on the layout `<section>`; the drawer
  `padding-top` reads that var with the old 76px as pre-paint fallback. Serves both Flow Designer and
  Workflow Designer (shared flush layout). No markup/token changes.
- **Files changed:** `app/renderer/layout/DesignerCanvasLayout.tsx`, `app/renderer/styles/global.css`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean; ad-hoc Electron GUI check (Playwright `_electron`, window
  narrowed to force the bar to wrap to 106px) confirmed `--awkit-action-bar-h: 106px`, drawer top 170 ==
  action-bar bottom 170, drawer bottom == canvas bottom. Not run: clean-machine offline GUI walkthrough.

## 2026-07-11 — Claude — Fix false "browser crash rate high" backpressure from normal browser closes

- **Task:** diagnose why a 50-instance run showed `Crashes 5` + backpressure "pausing new dispatch" with
  ~46 instances stranded `Pending` while the host was idle, then fix it.
- **Root cause:** in `browserContext` isolation the runtime owns a real `Browser`; `PlaywrightRunner`
  closes it inside `executeScenario`'s `finally` (before returning), so `BrowserWorkerPool.releaseSlot`
  had not run yet and the `disconnected` handler scored every *normal* end-of-instance close as a crash.
  Once >3 accumulated in the 5-min window, `BackpressureController` blocked all new dispatch. (Failing
  navigations to an unreachable target merely supplied the quick completions — 5 Failed ⇒ 5 "crashes".)
- **Change:** new `onRuntimeClosing` runner option, fired in `closeRuntime` (end-of-run / cancel / Reuse
  Session swap); engine wires it to `BrowserWorkerPool.markExpectedClose(slot, generation)`; the pool's
  `disconnected` handler skips crash-counting when `expectedCloseGeneration === generation`. Genuine
  crashes (unsignalled mid-run disconnect, page `crash`, engine `browser-crash` classification) still
  count; the signal is generation-scoped so post-swap later-generation crashes still count.
- **Files changed:** `src/runner/browser/BrowserWorkerPool.ts` (`markExpectedClose` +
  `expectedCloseGeneration` slot field + guarded `disconnected` handler), `src/runner/PlaywrightRunner.ts`
  (`onRuntimeClosing` option, fired in `closeRuntime`), `src/runner/ExecutionEngine.ts` (wire the
  callback), `scripts/verify-browser-pool.mts` (Part E regression), `docs/ai/CURRENT_STATE.md`,
  `docs/ai/KNOWN_ISSUES.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean; `verify:browser-pool` 16/16 (new Part E: unexpected disconnect
  still counts, intentional teardown does not, generation-scoped); `verify:concurrency` 78/78;
  `verify:runner` 82/82. Not run: clean-machine offline GUI walkthrough (no live 50-instance repro).

## 2026-07-11 — Claude — Compound/tree locators for non-unique recorder elements

- **Task:** the Recorder saved ambiguous single-strategy locators ("matches 2 elements" warning, e.g.
  two `checkbox` controls sharing accessible name `0796713928`). Build combinations/series/trees of
  locators until exactly one element matches. Full scope (Phases 1–3), skip-noise descendant chains.
- **Change:**
  - **Phase 1 (recorder):** `compoundSelector` (meaningful features + fewest distinguishing ancestors,
    descendant combinators, utility/hashed classes rejected, frequency-ranked) + `anchoredStructural`
    (unique id/testid ancestor + positional tail), wired into `buildCandidates` before the positional
    fallback; `elementsForRole` refactored to `elementsForRoleIn` for scoped counting.
  - **Phase 2a (recorder):** prefer a readable semantic locator scoped to a stable container that
    isolates the exact element (verified in-page); new `quality.disambiguation`.
  - **Phase 2b (renderer):** carry Recorder `alternatives`/`context` through the Flow Designer
    load→save round-trip; panel shows how uniqueness was achieved.
  - **Phase 3 (runner):** deterministic self-healing (visible → enabled → in-viewport; never guess
    among equal twins) in `LocatorFactory.pickSingle`/`narrowToActionable`.
- **Files changed:** `src/recorder/recorderInitScript.ts`, `src/profiles/FlowProfile.ts`
  (`LocatorQuality.disambiguation?`), `src/runner/LocatorFactory.ts`,
  `app/renderer/components/workflow/flowDesignerTypes.ts`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx`, `mock-site/public/recorder-lab.html`,
  `mock-site/README.md`, `scripts/verify-recorder-locator.mts`, `scripts/verify-mock-site.mjs`, docs.
- **Verification:** build clean; `verify:recorder` 72/72; `verify:runner` 82/82; `verify:mock-site`
  35/35; `verify:flow-designer` 21/21; `verify:recorder-flow` 13/13; `verify:recorder-draft` 17/17.
  Not run: clean-machine offline GUI walkthrough.
- **Result:** ordinary duplicate elements now record as a unique compound/container locator (no red
  warning); legacy non-unique flows self-heal at run time when exactly one match is actionable.
  Schema back-compatible (one optional field); no IPC/preload/runner-contract/packaging change.

---

## 2026-07-11 — Codex — Flow Designer half-height canvas repair

- **Task:** fix the attached Flow Designer screenshot where the graph canvas stopped halfway down the
  window and left a large dead region below it.
- **Root cause:** an empty `.designer-right-drawer-slot` remained mounted when `rightPanel={null}`. In
  the one-column grid it became an implicit second row, splitting the 703px designer into a 347.5px
  canvas plus an empty row. A no-panel `right-collapsed` class also retained an unused 56px column.
- **Files changed:** `app/renderer/layout/DesignerCanvasLayout.tsx`,
  `scripts/verify-flow-designer-gui.mjs`, and AI memory/completion-report docs.
- **Verification:** build pass; real Electron `verify:flow-designer` 21/21; canvas performance 13/13;
  mock-site 29/29; 2048×1098 visual walkthrough measured canvas = designer = 1808×1002 with zero
  drawer slots and no console/page errors.
- **Result:** the no-inspector canvas now fills the available width and height; populated and collapsed
  inspectors retain their reserved-column behavior. No canvas engine, profile schema, persistence,
  runner, IPC, dependency, or packaging behavior changed.

---

## 2026-07-11 — Codex — Critical Flow / Workflow Designer defect closure

- **Task:** eliminate the supplied critical `originX` crash, inspector overlap/collapse defects,
  connection-dialog mismatch, and oversized Workflow Builder toolbar; validate in the built Electron GUI
  without remote Git operations.
- **Root causes:** queued pane updater read a gesture ref after pointer-up cleared it; fast node pointer-up
  read stale React drag state; Flow inspector was absolutely positioned over the canvas and its collapsed
  state was not passed to the layout; generic confirmation styling did not match the branch-link reference;
  an older, more-specific `.scenario-toolbar > div` rule forced compact toolbar groups back to grid layout.
- **Files changed:** `app/renderer/components/canvas/FlowCanvas.tsx`,
  `app/renderer/components/shared/ConfirmDialog.tsx`, `app/renderer/layout/DesignerCanvasLayout.tsx`,
  `app/renderer/pages/FlowChartDesigner.tsx`, `app/renderer/pages/ScenarioBuilder.tsx`,
  `app/renderer/styles/global.css`, `scripts/verify-flow-designer-gui.mjs`,
  `scripts/verify-workflow-builder-gui.mjs`, and AI memory/completion-report docs.
- **Verification:** `npm run build` pass; `npm run verify:flow-designer` 20/20;
  `npm run verify:workflow-builder` 20/20; `npm run verify:canvas-perf` 13/13;
  `npm run verify:mock-site` 29/29; `npm run verify:settings-persistence` 3/3.
- **Result:** real pointer pan/drag no longer crashes or loses the drop; the Flow inspector cannot cover
  canvas content and collapses to 48px; the connect dialog matches the supplied branch-link layout; the
  Workflow toolbar measures 59px in one row; canvas memoization/performance remains intact. No persistence
  schema, runner, IPC, preload, dependency, or offline-runtime behavior changed.

---

## 2026-07-11 - Claude Code - Canvas UI fix pass (9 reported issues: crash guard, insert-button, drag-connect, edge text, node size, parallel color, panel shift, toolbar, nav anim)

Renderer-only. Reference parity = local `Workflow` (flowforge) project. All verified on real Electron.

- **#8 white screen (critical):** no error boundary → any render throw blanked the window. Added
  `ErrorBoundary` around `<ActivePage>` (keyed by route) with a readable fallback + reload.
- **#1 edge "+" dead:** `.awkit-flow-nodes` (transparent, z-index 2) covered the `+` overlay and ate
  real clicks (synthetic dispatch bypassed it, so the verifier missed it). Fix: container
  `pointer-events:none` + cards `pointer-events:auto`. Confirmed with a REAL Playwright click.
- **#3 edge text clipped:** `+` split the branch label at the shared midpoint. `SmoothEdge` offsets the
  label 18px above the line when an insert button is shown.
- **#4 drag-to-connect:** engine `onNodeDragStop` → new `onNodeConnect(src,tgt)` (largest overlap at the
  final drop). Both designers show a `ConfirmDialog`, skip linked pairs, orient top→bottom, add on
  confirm. Callbacks read live nodes/edges from refs (stable → no re-render regression).
- **#5 node size:** pinned `.action-flow-node`/`.scenario-flow-node` to 320px (were content-driven).
- **#6 parallel color:** new `--awkit-connector-parallel` (teal), mapped in `connectorStyle.ts`.
- **#7 drawer covers nodes:** new animated `FlowCanvasHandle.panBy`; Flow Designer glides the graph left
  when the floating drawer opens / back on close.
- **#2 toolbar:** Workflow Builder toolbar → single low row (inline labels + `overflow-x` scroll).
- **#9 nav animation:** `.nav-group-items` → `grid-template-rows` accordion (added `-inner` wrapper).
- **Files:** `app/renderer/App.tsx`, `components/shared/ErrorBoundary.tsx` (new),
  `components/canvas/FlowCanvas.tsx`, `components/canvas/edges/SmoothEdge.tsx`,
  `components/shared/connectorStyle.ts`, `pages/ScenarioBuilder.tsx`, `pages/FlowChartDesigner.tsx`,
  `layout/LeftNavigation.tsx`, `styles/global.css`, docs.
- **Tests:** build clean; real-GUI: edge `+` real click ✓, drag start→end confirm+create ✓, no white
  screen ✓; `verify:flow-designer` 14/14, `verify:workflow-builder` 18/18, `verify:canvas-perf` 13/13
  (found+fixed a non-stable-callback perf regression via refs).

---

## 2026-07-11 - Claude Code - Workflow Builder UI repair (Add-menu Flow Logic, grouped toolbar, selection highlight, drag harness)

Focused UI functionality/organization pass on the reported Workflow Builder / Workflow Designer issues.
Renderer-only + one measurement script; no route/IPC/preload/runner/schema/packaging change.

- **Issue 3 / Add menu:** added a **Flow Logic** section (Conditional Branch · Parallel Branch · Loop)
  to the Workflow Builder contextual picker — it previously listed only Saved Flows. New
  `applyWorkflowLogic()` maps them onto the existing connector model (conditional/parallel connectors
  from the selected flow to available flows; Loop toggles the self-loop). Guards against no-selection /
  no-available-flows with a toast; never creates an invalid graph.
- **Issue 4 / toolbar:** reorganized the flat button row into labeled groups (Workflow · Add ·
  Execution · Layout · status) with `.sb-toolbar-sep` dividers; fixed the stale Auto-arrange tooltip.
- **Issue 2 / selection:** clicking a node/connector opened the drawer but never highlighted the item
  on the canvas — the pages never set `CanvasNode.selected`/`CanvasEdge.selected` (CSS existed). Fixed
  in **both** designers (selection folded into the node identity signature; `edge.selected` set).
- **Issue 1 / Part 7:** edge-follow (`DraggingEdgeLayer`) was already correct — revalidated and fixed
  `scripts/measure-large-graphs.mjs` to fit + drag the nearest visible node (was first-in-DOM, could be
  off-screen). 40/100/200/500: drag = 20 node re-renders + 1 static-edge recompute at every size.
- **Part 2:** confirmed Workflow Designer is intentionally read-only (no misleading controls) — left as-is.
- **Files:** `app/renderer/pages/ScenarioBuilder.tsx`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/styles/global.css`, `scripts/verify-workflow-builder-gui.mjs`,
  `scripts/measure-large-graphs.mjs`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Tests:** build clean; `verify:workflow-builder` 18/18 (4 new checks), `verify:flow-designer` 14/14,
  `verify:canvas-perf` 13/13, `verify:write-queue` 7/7, `verify:settings-persistence` 3/3,
  `verify:reports` 26/26, large-graph measurement green. Not run (no runtime code touched):
  runner/recorder/mock-site/waits/instance-monitor/data-editor.

---

## 2026-07-11 - Claude Code - UI performance Phase 2 (node-edit identity, edge-follow, settings safety, large graphs)

Built on Phase 1 (below). Audited Phase 1 for correctness (memoization, render probe, settings queue —
all sound; probe is opt-in/zero-retention) then closed the remaining gaps.

- **Node-edit object identity** (biggest remaining render win): `interactiveNodesForCanvas` rebuilt
  EVERY node's wrapper on any edit, so editing one node re-rendered the whole graph. New
  `components/canvas/identityMap.ts` (`mapWithIdentity`) preserves per-node output identity; applied in
  both designers. **Editing one node's name on a 40-node flow: 120 → 3 card re-renders** (only the
  edited node). Verified.
- **Edge-follow during drag** (was a migration regression — edges snapped on drop): FlowCanvas now
  tracks the live drag position (rAF-batched) and renders only the dragged node's edges in a
  `DraggingEdgeLayer` overlay; the memoized `EdgeLayer` recomputes just once at drag start (not per
  frame) and skips those edges. Connected edges follow the node; the static layer never re-routes the
  whole graph.
- **Settings persistence hardening:** extracted the queue to a testable `app/main/writeQueue.ts`
  (`createSerialQueue`: FIFO, failure-isolated, `flush()`); `writeSettings` is now **atomic**
  (temp-file + rename, Windows-safe); added `flushSettingsWrites()` wired into Electron **`before-quit`**
  (2s-bounded, no deadlock) so a last-moment edit isn't lost.
- **Large-graph glide guard:** the auto-arrange/load glide (animates `left`/`top` on every node) is
  skipped above `GLIDE_MAX_NODES` (120) so big graphs snap instead of thrashing layout.
- **Panels/listeners audit:** Node Palette picker unmounts when closed + memoized filter; Node/Connector
  Properties unmount when nothing is selected and collapse to a cheap rail; all `setInterval`/
  `ResizeObserver`/`addEventListener` sites have matching cleanup (no leaks found).
- **Measured (real Electron, 40/100/200/500 nodes):** zoom re-renders **0 at every size**; load
  ~0.30/0.48/0.70/1.23 s; save 10–45 ms; in-session Flow⇆Workflow nav ×10 leak check heap 14→14 MB,
  DOM 5645→5645 (no leak). See `scripts/measure-large-graphs.mjs`.
- **New verifiers:** `verify:write-queue` (7/7, unit), `verify:settings-persistence` (3/3, real
  Electron), `verify:canvas-perf` now 13/13 (added node-edit + edge-follow assertions).
- **Regression (all green):** build; write-queue 7/7; settings-persistence 3/3; canvas-perf 13/13;
  flow-designer 14/14; workflow-builder 14/14; reports 26/26; waits 21/21; data-editor 27/27;
  recorder 57/57; runner 82/82; instance-monitor 22/22; mock-site 29/29; ai:memory pass.
- **Not run:** clean/offline VM walkthrough (unchanged external gate).

---

## 2026-07-11 - Claude Code - Canvas UI performance pass (memoization + stable callbacks + settings queue)

- **Problem:** the in-house canvas engine re-rendered the entire node + edge tree on every
  viewport frame (pan/zoom/wheel) and on unrelated page re-renders (typing a name, save-state
  text), because `NodeContainer`/`EdgeLayer` were unmemoized and the designers passed inline
  callbacks to `<FlowCanvas>`.
- **Root causes (measured, 40-node flow):** zoom (20 wheel ticks) = **800** NodeContainer +
  **800** card + **20** EdgeLayer renders (whole graph every frame); typing 16 chars in Flow Name
  = **1280** node + **1280** card renders (inline callbacks defeated the memo).
- **Fixes (renderer + one main-process file; no schema/IPC/runner/behavior change):**
  - `FlowCanvas.tsx`: memoized `NodeContainer` (renders the node component internally instead of via
    `children`, and reads zoom from `viewportRef` instead of a prop, so viewport-only changes never
    invalidate the memo) and memoized `EdgeLayer`.
  - `FlowChartDesigner.tsx` + `ScenarioBuilder.tsx`: replaced inline `<FlowCanvas>` callbacks with
    stable `useCallback` references so unrelated page re-renders bail the memoized subtree.
  - `uiSettings.ts` (main): serialized all settings mutations through a promise queue so the many
    fire-and-forget `settings.update` calls (one per selection/zoom/toggle) can't race on
    read-modify-write or overlap file writes.
  - New opt-in `renderProbe.ts` + `scripts/verify-canvas-perf.mjs` (`npm run verify:canvas-perf`)
    regression guard.
- **After (same measurements):** zoom = **0/0/0**; typing = **0/0/0**; dragging one node re-renders
  **only that node** (20 for 20 moves, not 800) and never the edge layer during motion.
- **Verification:** `npm run build` (tsc + bundles) clean; `verify:canvas-perf` 10/10;
  `verify:flow-designer` 14/14; `verify:workflow-builder` 14/14; `verify:reports` 26/26.
- **Not run:** clean/offline VM walkthrough (unchanged external gate); runner verifiers (no runner change).

---

## 2026-07-11 - Codex - Workflow.rar full UI migration, Phases 0-6

- **Reference/discovery:** read prompt-pack files 00-19 in order; extracted relevant source from
  `Workflow.rar` to the local temp directory; SHA-256 matched
  `9b3320b609e12da1032a94d4e156389e06f0e4315bc6983e0e76b18909795946`. Mapped renderer, IPC,
  profiles, recorder, runner, settings, reports, and offline boundaries before editing.
- **Implementation:** exact 240px/64px shell rhythm and reference canvas/theme tokens; collapsible route
  groups and pre-paint theme bootstrap; shared `CanvasItemPicker` and `NodeAppendButton`; Flow Designer
  and Workflow Builder contextual blank/edge/leaf/tool-picker entry points; 400px overlay configuration
  drawers; permanent palette/definition rails unmounted; new workflows persist `Start -> End` structural
  sentinels; runtime conversion filters sentinels while legacy workflows remain unchanged.
- **Mock lab:** `/designer-lab` now documents the contextual picker/edge/leaf/drawer contract;
  mock verifier extended.
- **Evidence:** 32 route screenshots plus 6 picker/drawer state screenshots in
  `docs/ai/ui-reskin-template-plan/mockups/screenshots/workflow-migration-*`.
- **Verification:** `npm run build`; `verify:flow-designer`; `verify:workflow-builder`;
  `verify:workflow-sentinels` 4/4; `verify:mock-site` 29/29; `verify:recorder-flow` 13/13;
  `verify:recorder-draft` 17/17; `verify:recorder` 57/57; `verify:waits` 21/21;
  `verify:runner` 82/82; `verify:data-editor` 27/27; `verify:instance-monitor` 22/22;
  `verify:reports` 26/26; `validate:offline`; AI-memory checker passed.
- **Not run:** clean/offline Windows VM install/uninstall, code signing, and max-compressed packaging
  (existing external release gates; max-compression OOM is documented in KNOWN_ISSUES).

---

## 2026-07-10 - Claude - Workflow/FlowForge visual parity (framer-motion), Phases 0-5

- **Task:** Adopt the Workflow/FlowForge ("Hologram") reference style, canvas, theme, and animations
  into AWKIT. Plan: `docs/plan-workflow-visual-parity.md`. Renderer/CSS only — no runner/orchestrator,
  IPC, preload API, or profile-schema change. Key finding: the two apps are siblings (same violet
  `#7c3aed`, same `[data-theme]` theming, existing token system), so most parity pre-existed; the work
  was targeted gap-filling plus a real motion library.
- **P0 Foundation:** Added `framer-motion@11.18.2` (dep + offline `dependency-manifest` line via
  `scripts/generate-dependency-manifest.ps1`). New tokens in `styles/global.css`: `--awkit-edge`/
  `-strong`, `--awkit-shadow-node`/`-hover` (both themes, + backfilled dark `--awkit-shadow-hover`).
  New `app/renderer/lib/motion.ts` (springs, variants, `hoverTap`/`hoverLift`, `usePrefersReducedMotion`,
  `useFlowGlide`). Existing reduced-motion block already matched the reference.
- **P1 Canvas:** Added the auto-layout **glide** (`.flow-animating .react-flow__node/__edge-path`
  transitions) armed via `useFlowGlide` in FlowChartDesigner + ScenarioBuilder auto-arrange/load.
  Dotted bg, per-connector violet edges, mid-edge "+", visible ports already existed (kept; did NOT
  hide handles — AWKIT has a deliberate ConnectorPorts system).
- **P2 Nodes:** `ActionFlowNode` + `ScenarioFlowNode` → `motion.article` (nodeEnter spring mount +
  `whileHover y:-1`, reduced-motion gated); removed the old CSS `awkit-fade-in` node mount (framer owns
  it now); node elevation → `--awkit-shadow-node(-hover)`; **hover-reveal kebab** menu. Unified
  `actionNode`/`stepType` model means no separate Condition/Delay/Loop components to port. Leaf
  AppendButton deferred (functional, not visual — would violate "no fake controls").
- **P3 Chrome:** Sidebar active pill, theme toggle→`setAppearance`, page-enter, drawer/panel slide-ins,
  button press feedback all already existed. One real gap fixed: animated sidebar **collapse**
  (`transition: grid-template-columns` on `.app-shell`).
- **P4 Pages:** Card-grid **stagger** on `.page-grid` children (`awkit-card-rise`, `nth-child` delays,
  `animation-fill-mode: backwards` to preserve `.metric-card:hover` transform). Covers 7 pages.
- **Tests run:** `npm run build` ✅ (2201 modules; framer-motion bundles, renderer JS 1.29→1.54 MB).
  GUI verifiers ✅ **58/58**: `verify:flow-designer` 19/19, `verify:workflow-builder` 13/13,
  `verify:reports` 26/26 (no console errors, metric cards render under stagger).
- **Not run:** clean-machine offline GUI walkthrough (manual gate). Reduced-motion + dark-theme visual
  eyeball still worth a manual pass. **Result:** motion/style parity landed; no runtime behavior changed.

---

## 2026-07-10 - Claude - Canvas UX: auto-layout, edge "+" in Workflow Builder, motion (SRS-CANVAS-UX-001)

- **Task:** Implement `docs/SRS_CANVAS_UX.md` (Flow Designer + Workflow Builder). Renderer/CSS only —
  no runner/orchestrator, IPC, preload API, or profile-schema change (loop runtime semantics untouched).
- **1c Auto-layout:** New dependency-free layered layout `app/renderer/components/shared/graphLayout.ts`
  (`layeredLayout`/`positionsNeedLayout`/`withAutoLayout`, cycle-safe longest-path, self-loops ignored).
  Flow Designer `loadProfile` (TB) and Workflow Builder `loadWorkflowProfile` (LR) now rearrange only
  when positions are missing/stacked (fixes the `{280,120}` stack), `fitView` only then so persisted
  zoom survives normal loads. Added an "Auto-arrange" toolbar button to both editors (force layout).
- **1a Edge "+":** Wired the existing `TemplateSmoothEdge` inline "+" into Workflow Builder via a
  display-only `edgesForCanvas` map + `insertFlowOnEdge` (splices the first unused saved flow at the
  edge midpoint; toasts if none). Added display-only `showAddButton`/`onInsertNode` to `ScenarioLinkData`.
  Restyled `.template-edge-add-button` to the reference: always-visible white circle, subtle border,
  violet "+" (tokens only).
- **1d Dotted canvas:** Bumped light `--awkit-canvas-dot` `#d8d4e0`->`#c7c0d6` (dots were too faint).
- **1b Loop priority:** Added authoring help text in `ConnectionPropertiesPanel` (loop takes priority;
  continues on the Conditional exit when unsatisfied/maxed). No runner change.
- **2 Motion:** Opacity-only fade-in for `.action-flow-node`/`.scenario-flow-node`/`.react-flow__edge`
  (no transform on measured RF wrappers); `:active` press on toolbar/icon buttons. Covered by the
  existing reduced-motion neutralizer.
- **Files:** `graphLayout.ts` (new); `pages/FlowChartDesigner.tsx`, `pages/ScenarioBuilder.tsx`,
  `components/scenario/scenarioDesignerTypes.ts`, `components/workflow/ConnectionPropertiesPanel.tsx`,
  `styles/global.css`; `docs/SRS_CANVAS_UX.md` (spec, prior task).
- **Tests run:** `npm run build` OK (tsc --noEmit + electron-vite bundles, no type errors).
- **Tests not run:** `verify:runner`/`verify:mock-site` (no runner/mock-site logic changed); clean-machine
  GUI walkthrough (Electron, human/VM step) — visual conformance of connectors/branches still to eyeball.
- **Result:** Behavioral items landed; visual polish matches the supplied reference. No commit.

---

## 2026-07-09 - Claude - /HANDOFF refresh (UI re-skin complete)

- **Task:** Prepare the repo for the next agent/human after the UI/UX Hologram re-skin (Phases 01-15).
- **Changes:** Rewrote the active "Current Handoff" block in `docs/ai/HANDOFF.md` to reflect the closed
  UI re-skin (task/completed work/changed files/commands run/remaining work/risks/recommended next step),
  and reframed the older Phase 2-5.1 release-hardening detail as historical (its release gates still valid).
- **Repo state recorded:** branch `feature/smart-wait-engine` level with origin; working tree modified &
  uncommitted (`global.css`, `Recorder.tsx`, 3 designer one-liners, `AGENTS.md`, `docs/ai/{CURRENT_STATE,
  RULES,TASK_LOG,TESTING}.md`; untracked `.claude/skills/frontend-ui-ux-master/` + golden screenshots).
- **Checks:** `git status --short --branch` + `git diff --stat` inspected; `npm run ai:memory` pass.
  No secrets written to Markdown.
- **Result:** `docs/ai/HANDOFF.md` ready for the next agent. No code changed by this task; no commit.

---

## 2026-07-09 - Claude - Phase 13-15: dark/a11y verify, visual QA, handoff (UI re-skin closed)

- **Task:** Execute `13_LIGHT_DARK_MODE_AND_ACCESSIBILITY.md`, `14_VISUAL_QA_TESTING_AND_ACCEPTANCE.md`,
  `15_FINAL_IMPLEMENTATION_HANDOFF.md` in order (gap-based; audit first, no blind rewrites).
- **Phase 13 (result: no code change):** audited `[data-theme="dark"]` in `global.css` and did a
  dark-mode screenshot walkthrough — already meets standards (deep slate `#0e0d12` not black, elevated
  surfaces, off-white `#f3f1f8` text, brighter `#8b5cf6` accent, inverted canvas dots; global
  `:focus-visible` ring; semantic `<button>`s). No token edits warranted; theme persistence/OS-sync in
  `theme.tsx` untouched.
- **Phase 14 (screenshots + checklist):** captured 8 light + 8 dark golden baselines via
  `scripts/capture-ui-screenshots.mjs` → `docs/ai/ui-reskin-template-plan/mockups/screenshots/{golden,
  golden-dark}/`; added a Visual QA section (capture recipe + manual QA checklist) to
  `docs/ai/TESTING.md`. Deliberately did NOT add `toHaveScreenshot` tests (no `npm test` script;
  `@playwright/test` Node caveat; dynamic timestamps/ids → flaky) — rationale documented.
- **Phase 15 (doc sync):** `CURRENT_STATE.md` gets a "UI re-skin initiative — CLOSED" architecture
  summary (token system, `.app-shell`/`.app-main` grid, RF class/token adherence, reusable base
  components); `RULES.md` › UI gains the mandatory-token / app-shell-grid-lock / a11y rules;
  `AGENTS.md` carries the summary bullet.
- **Preserved:** all routes, IPC/preload API, runner/runtime, schema, persistence, `theme.tsx` logic,
  existing tests. Renderer used a scratchpad-only helper to toggle `appearance` for dark capture, then
  restored it to `light`; no runner tests touched.
- **Tests:** `npm run build` pass (from the Phase 09-12 pass; no source changed in 13-15 beyond docs);
  dark/light golden capture ran clean (16 shots). `verify:runner` not run (no runtime logic touched).
- **Result:** UI re-skin initiative (Phases 01-15) officially closed. No commit.

---

## 2026-07-09 - Claude - Phase 09-12 gap-based UI polish

- **Task:** Execute `09_INSTANCES_AND_WORKFLOW_CARDS.md`, `10_REPORTS_AND_ANALYTICS_UI.md`,
  `11_FORMS_TABLES_MODALS_AND_EMPTY_STATES.md`, `12_MOTION_AND_MICRO_INTERACTIONS.md` as a **gap-based
  polish** pass (audit first; only close real gaps; reuse existing tokens/classes; no parallel systems).
- **Audit:** repo already ~95% satisfies all four phases from prior re-skin passes (motion tokens,
  reduced-motion neutralizer, focus rings, modal system + `awkit-fade-in`/`awkit-pop-in` entrance,
  tokenized charts/gauges with no hardcoded hex, semantic status badges, tokenized inputs,
  uppercase primary-table headers, MetricCard/EmptyState/SkeletonCard).
- **Changes (all in `app/renderer/styles/global.css`, CSS-only):** (1) `.workflow-card:hover/:focus-within`
  gains `transform: translateY(-2px)` + `transform` in transition (Phase 09 subtle lift; transform-only,
  no grid reflow). (2) `.modal-overlay` gains `backdrop-filter: blur(3px)` (+`-webkit-`) for a blurred
  backdrop (Phase 09/11; ConfirmDialog/UnsavedChanges/LiveExecutionReportModal). (3) `.modal-dialog`
  `border-radius: 10px` → `var(--radius-lg)` (Phase 11 token alignment). (4) `.awkit-table th` gains
  `text-transform: uppercase; letter-spacing: 0.04em; background: var(--awkit-surface-soft)` to match the
  established `.wl-table`/`.instance-table` header convention (Phase 10/11 consistency).
- **Deliberately not done:** no new `.awkit-input/.awkit-select/.awkit-button` (global element rules +
  `.toolbar-button` already cover forms/buttons — would be a parallel/dead system); no rewrite of the
  duration-based reduced-motion neutralizer (intentional, working). Noted: `.workflow-run-card` selectors
  (~7615/7626) appear unused (component renders `.workflow-card`) — left as a future dead-CSS cleanup.
- **Preserved:** all routes, IPC/preload API, runner/runtime logic, state contracts, persistence, node/
  connector handles, table/card behavior. No `.tsx` or token additions/removals.
- **Tests:** `npm run build` pass (tsc --noEmit + bundles); `verify:reports` 26/26; `verify:instance-monitor`
  22/22 (both after `reset-ui-state.mjs`). `verify:runner` not run (no runner logic touched). New hover
  transform is auto-covered by the last-in-cascade reduced-motion block; all edits use theme-aware tokens.
- **Result:** Complete locally. No commit.

---

## 2026-07-09 - Codex - Execute Phase 03-08 UI prompts

- **Task:** Execute `C:\Users\moham\Downloads\03_APP_SHELL_AND_NAVIGATION.md` through
  `C:\Users\moham\Downloads\08_RECORDER_UI_REDESIGN.md` in order.
- **Changes:** Tuned shell/canvas styling in `global.css`; set React Flow dot backgrounds to
  `gap={24}` / `size={1}` in Flow Designer, Workflow Builder, and Workflow Designer; rewrote
  `Recorder.tsx` as a tokenized control-center UI with sticky controls, grouped toggles, disabled
  recording inputs, auto-scrolling action timeline, action icons/locator/value/wait details, handoff
  panel styling, inline save feedback, and restyled recorded URLs.
- **Preserved:** existing routes, IPC/preload API, recorder service, `recorder.saveFlow()` path,
  protected-login handoff handlers, node/connector handle IDs, `NodeResizer`, property-panel update
  callbacks, table logic, and drag/drop data.
- **Tests:** `npm run typecheck` pass; `npm run build` pass; `verify:flow-designer` initially timed out
  waiting for `.action-flow-node` due persisted UI state, then passed 19/19 after
  `node scripts/helpers/reset-ui-state.mjs flowChart false`; `verify:workflow-builder` 13/13 after reset;
  `verify:recorder` 57/57; `verify:recorder-flow` 13/13.
- **Result:** Complete locally. No route/IPC/schema/runner/build-process changes; no commit.

---

## 2026-07-09 - Codex - Execute Phase 01/02 UI audit and token foundation prompts

- **Task:** Execute `C:\Users\moham\Downloads\01_REPO_UI_AUDIT.md`, then
  `C:\Users\moham\Downloads\02_DESIGN_TOKENS_AND_THEME.md`.
- **Phase 01 audit:** Confirmed current source is already beyond the baseline prompt: `global.css` is the
  single tokenized stylesheet; `AppShell` uses the left-sidebar plus `.app-main` header/content/status
  grid; Flow Designer/Workflow Builder use React Flow with shared connector, template edge, and zoom
  components. No code changed during the audit portion.
- **Changes:** CSS-only token compatibility pass in `app/renderer/styles/global.css`: set
  `--radius-md` to `12px`, added `--radius-lg`, `--awkit-lavender-soft`, `--awkit-shadow-soft`, and
  `--shadow-soft`, and routed `--awkit-node-selected-bg` through the lavender token for both light and
  dark themes.
- **Tests:** `npm run build` pass; `verify:flow-designer` 19/19; `verify:workflow-builder` 13/13.
- **Result:** Complete locally. No route/IPC/schema/runner/build-process changes; no commit.

---

## 2026-07-08 - Codex - Flow/Workflow canvas dots matched to attachment

- **Task:** Make Workflow Builder and Flow Designer canvases use the attached sparse lavender dot grid.
  Renderer/UI only; no route/IPC/schema/runner automation behavior changed.
- **Changes:** Flow Designer and Workflow Builder `BackgroundVariant.Dots` now use `gap={44}` and
  `size={2.4}`. `global.css` scopes light-mode canvas tokens for those two canvas containers
  (`#f4f1f8` background, `#cac5d3` dots), makes `.react-flow__pane` transparent so the SVG background dots
  are visible, and keeps `.react-flow__background` pointer-transparent.
- **Screenshots:** Refreshed `docs/ai/ui-reskin-template-plan/mockups/screenshots/after/02-flow-designer.png`
  and `04-workflow-builder.png`; both show the wider attached-style dot field.
- **Tests:** `npm run build` pass; `verify:flow-designer` 19/19 (using stable local `login-flow`
  selection after the current `test-mock` local flow made the drag branch check flaky);
  `verify:workflow-builder` 13/13; `ai:memory` pass.
- **Result:** Complete locally. No commit. `verify:runner` not run because runtime automation logic was not
  changed.

---

## 2026-07-08 - Codex - Reverted Flow/Workflow canvas frame follow-up

- **Task:** Revert the most recent canvas-frame alignment pass at the user's request.
- **Changes:** Removed the final `global.css` override that framed `.flow-designer-body .react-flow-shell`
  and `.scenario-canvas-panel` like the Form Designer canvas. Removed the corresponding current-state and
  feature-inventory claims. Older template UI work remains untouched.
- **Tests:** `npm run build` pass; `npm run ai:memory` pass.
- **Result:** Reverted locally. No commit. GUI verifiers were not re-run because the reverted CSS block is
  gone and the previous baseline already had passing designer verifiers.

---

## 2026-07-08 — Codex — Template UI completion evidence + token/status polish

- **Task:** Implement the user-requested Hologram-style AWKIT UI completion pass using the local samples,
  prompt, and prior template work as the baseline. Renderer/UI only; no route/IPC/schema/runner automation
  behavior changed.
- **Assets:** Reviewed `UI Samples/sample_01.png`, attached matching image, local mp4 presence, and reachable
  Dribbble text pages. Fresh mp4 extraction was attempted with local Chrome + Playwright but timed out;
  `ffmpeg`/`ffprobe`, `cv2`, and PIL were unavailable. Prior extracted frames remain under
  `ui-reskin-template-plan/mockups/screenshots/template-frames/`.
- **Changes:** `global.css` light tokens aligned to the requested palette (`#f6f4f9`, `#f3f0f8`,
  `#7c3aed`), added prompt-style spacing/motion aliases, missing muted status tokens, explicit
  `html/body/#root` overflow reset, loader utility classes (`.awkit-spinner`, `.awkit-loader-dot`,
  `.loading-panel`, `.skeleton-card`, `.skeleton-shimmer`), and final panel/palette/status polish.
  `StatusBar.tsx` now polls real `executions.runtimeStatus()` instead of showing fake static chips.
  Remaining UI inline border hex in `Recorder.tsx`, `SessionsManager.tsx`, and
  `RecoverableRunsPanel.tsx` was tokenized.
- **Docs/screenshots:** Added `18_CODEX_TEMPLATE_IMPLEMENTATION_PLAN.md` and
  `19_CODEX_TEMPLATE_COMPLETION_REPORT.md`; refreshed after screenshots in
  `docs/ai/ui-reskin-template-plan/mockups/screenshots/after/`, including direct
  `05-workflow-designer.png` and optional `10-dark-flow-designer.png`.
- **Tests:** `npm run typecheck` pass; `npm run build` pass; `verify:flow-designer` 19/19;
  `verify:workflow-builder` 13/13; `verify:reports` 26/26; `verify:instance-monitor` 22/22;
  `verify:data-editor` 27/27; `verify:recorder` 57/57; `ai:memory` pass.
- **Result:** Complete locally. No commit. `verify:runner` not run because runner/runtime automation logic
  was not changed.

---

## 2026-07-07 — Claude (Opus 4.8) — Template UI final visual acceptance + hardening pass

- **Task:** Strict final acceptance/hardening of the Hologram template UI before commit. Reviewed every
  surface against `docs/01_ACTUAL_TEMPLATE_DESIGN_EXTRACTION.md` with screenshot + code evidence.
- **Fixes:** (1) floating drawer covered the flush-page action bar → `.designer-layout.flush-layout
  .designer-right-drawer-slot { top: 62px }` in `global.css`; (2) tokenized `#dfe6ef`×6/`#e2e8f0`×1
  inline borders → `var(--awkit-border)` in `Recorder.tsx` + `SessionsManager.tsx`; (3) captured a real
  Workflow Designer screenshot (route not in nav — reached via direct restore).
- **New helper:** `scripts/helpers/reset-ui-state.mjs` — verifier-only reset of `ui-settings.json`
  `lastRouteId`/`sidebarCollapsed`; proved `verify:flow-designer` state-independent (19/19 from two start
  states).
- **Proof:** `showAddButton`/`onInsertNode` absent from `src/` and `FlowEdge`; `toFlowProfile` reads
  explicit fields only → display-only edge fields never persist.
- **Files:** `global.css`, `Recorder.tsx`, `SessionsManager.tsx`, `scripts/helpers/reset-ui-state.mjs`
  (new); docs `ui-reskin-template-plan/17_FINAL_VISUAL_ACCEPTANCE_REPORT.md` (new), `CURRENT_STATE.md`,
  `TASK_LOG.md`; refreshed 8 after-screenshots.
- **Tests:** build clean; verify:flow-designer 19/19 ×2, workflow-builder 13/13, reports 26/26, recorder
  57, instance-monitor 22, data-editor 27; ai:memory pass.
- **Result:** Complete. No commit. Runtime automation behavior unchanged.

---

## 2026-07-07 — Claude (Opus 4.8) — Template UI completion pass: floating drawer / node anatomy / templateSmooth connectors / zoom pill

- **Task:** Implement the remaining Hologram-template structural details from the spec pack
  (`docs/` + `docs/files/01..15`) that the token-only + shell re-skin left out. Verified proven-missing
  via grep (no `templateSmooth`, `designer-right-drawer-slot`, `action-node-content`, `properties-body`,
  or `TemplateSmoothEdge.tsx`). Renderer visual/markup + CSS only.
- **Changes:** new `components/shared/TemplateSmoothEdge.tsx` (label pill + insert `+` + running flow);
  `connectorStyle.ts` tokenized colors + `smoothstep→templateSmooth` runtime remap (saved shape
  untouched); `ActionFlowNode.tsx` template card anatomy (icon tile/meta/type badge/title/desc/kebab);
  `FlowChartDesigner.tsx` register edge + `insertNodeOnEdge` + display-only `edgesForCanvas`;
  `ScenarioBuilder.tsx` + `WorkflowDesigner.tsx` register/use `templateSmooth`; `CanvasZoomControl.tsx`
  `canvas-zoom-button`/divider; `DesignerCanvasLayout.tsx` floating `designer-right-drawer-slot`;
  `FlowNodePropertiesPanel.tsx` + `ConnectionPropertiesPanel.tsx` drawer shell (header/tabs/body/footer,
  no fake save/test); `global.css` appended TEMPLATE COMPLETION PASS block before reduced-motion.
- **Non-persistence:** `showAddButton`/`onInsertNode` added as optional display-only fields on
  `FlowConnectionData`; `toFlowProfile` reads connector fields explicitly, so they never serialize.
- **Files:** 10 renderer files + `global.css`; docs: `ui-reskin-template-plan/16_VISUAL_GAP_CLOSURE_REPORT.md`
  (new), `CURRENT_STATE.md`, `TASK_LOG.md`.
- **Tests:** `npm run build` clean; `verify:flow-designer` 19/19, `verify:workflow-builder` 13/13,
  `verify:reports` 26/26, `verify:recorder` 57, `verify:instance-monitor` 22, `verify:data-editor` 27;
  `ai:memory` pass. 8 after-screenshots captured. Not run: `verify:runner` (no runtime/connector-runtime
  code touched — connectorStyle is renderer-only).
- **Result:** Complete. No commit (per instructions). Runtime automation behavior unchanged.

---

## 2026-07-07 — Claude (Opus 4.8) — Missing-template design pack (Phases 1–5): shell/sidebar/header structural re-skin

- **Task:** Execute the "Missing Template Design" prompt pack (`01`–`05`) — the structural template
  work the prior token-only re-skin left out. Visual/layout layer only; no route/IPC/runner/schema
  changes; `window.playwrightFlowStudio`, React Flow geometry, and the canvas no-transform rule
  preserved.
- **Phase 1 (audit):** Extracted 12 motion frames from the 3 mp4s via system Chrome over a local
  HTTP server (bundled Chromium can't decode H.264; `file://` + the "UI Samples" space fails —
  needs HTTP Range). Captured 8 live "before" shots. Wrote
  `docs/ai/ui-reskin-template-plan/15_MISSING_DESIGN_IMPLEMENTATION_REVIEW.md` (design-direction
  reconciliation: the ACTIVE target is the LIGHT Hologram template, not the stale dark-direction
  docs 00–03; gap table G1–G7). Added reusable `scripts/capture-ui-screenshots.mjs`.
- **Phase 2 (shell):** `AppShell.tsx` restructured so the **sidebar is full-height on the left** and
  the header renders only over the content (`.app-shell` → `grid-template-columns: 260px 1fr` [76px
  collapsed]; new `.app-main` holds header/content/status). Removed `.app-body`. Canvas geometry
  preserved.
- **Phase 3 (sidebar/header):** `LeftNavigation.tsx` — brand **workspace tile**, Settings moved to a
  pinned **footer utility area** (Settings + Dark Mode + non-interactive workspace identity row).
  `TopHeader.tsx` — real **"Unsaved changes" status chip** driven by `chrome.dirty` (threaded
  through `AppShell`/`App`); icon-square back button; purple primary retained. No fake data/controls.
- **Phase 4 (shared polish):** template KPI-card hover-lift (`.metric-card`) + elevated purple CTA
  (`.toolbar-button.primary`), reduced-motion-safe. (Cards/tables/forms/inputs/tabs/modals/toasts/
  empty/skeletons were already tokenized by the prior re-skin.)
- **Phase 5 (canvas/drawer/motion):** verified already delivered by the re-skin — dotted canvas,
  16px node cards + type badge + purple/lavender selection, node hover-lift, **floating** rounded
  properties drawer with float shadow + uppercase section labels, floating bottom-center zoom pill,
  reduced-motion neutralizer. No structural drawer rewrite (would risk canvas coordinate stability).
- **Files:** `app/renderer/layout/{AppShell,TopHeader,LeftNavigation}.tsx`, `app/renderer/App.tsx`,
  `app/renderer/styles/global.css`, `scripts/capture-ui-screenshots.mjs` (new),
  `docs/ai/ui-reskin-template-plan/15_*.md` (new) + before/phase2/phase3/after/template-frames shots.
- **Tests run:** `npm run build` clean (×several); `verify:flow-designer` 19/19; `verify:workflow-builder`
  13/13; `verify:reports` 26/26; `verify:instance-monitor` 22; `verify:recorder` 57/57;
  `verify:data-editor` 27/27. **Not run:** packaging/offline (untouched); clean-VM GUI walkthrough.
- **Note (pre-existing test fragility, re-confirmed):** the GUI verifiers navigate by nav **title**
  (workflow-builder, matches only when collapsed) vs **text** (flow-designer, matches only when
  expanded), so a collapsed sidebar + restored-route can time out a verifier — reset app route/collapse
  state between runs. Not caused by these changes.
- **Result:** the app shell now matches the template structurally (full-height sidebar, header over
  content, template sidebar footer, real header status chip) on top of the existing token re-skin.

---

## 2026-07-07 — Claude Fable 5 — Hologram-template UI re-skin + light/dark theme system

- **Task:** Full AWKIT UI/UX re-skin to the user-provided Hologram template (light SaaS, violet
  accent) with a real light/dark/system theme system. Visual layer only — no route/IPC/runner/
  validation changes. Template attachments reviewed directly (`UI Samples/` png + 3 mp4s; frames
  extracted with system Chrome since bundled Chromium lacks H.264).
- **Files:** `app/renderer/styles/global.css` (token system + re-skin, ~550 hex→token
  substitutions), `app/main/uiSettings.ts` (+`appearance`), `app/renderer/state/theme.tsx` (new),
  `App.tsx` (theme root + context), `LeftNavigation.tsx` (Dark Mode toggle), `Settings.tsx`
  (Appearance select), `connectorStyle.ts` (palette values only), `CanvasZoomControl.tsx`
  (bottom-center pill), `FlowChartDesigner/ScenarioBuilder/WorkflowDesigner.tsx` (dot-grid
  Background + minimap colors), inline-hex→token conversion in Recorder, SessionsManager,
  InstanceMonitor, ExecutionMonitor, ExecutionReports, WorkflowsLibrary, RecoverableRunsPanel.
- **Tests:** `npm run build` clean; `verify:flow-designer` 19/19; `verify:workflow-builder` 13/13;
  `verify:reports` 26/26; `verify:instance-monitor` 22/22; `verify:data-editor` 27/27;
  `verify:recorder` 57/57; two-theme screenshot walkthrough of 6 key pages via `_electron`.
  Not run: packaging/offline validators (no packaging change), runner suite (no runner change).
- **Result:** Both themes render correctly across shell, canvases, and pages; canvas invariants
  intact. Known gap: Settings import doesn't live-refresh the theme context.

---

## 2026-07-07 - Codex - Commit and push all project changes

- **Task:** User explicitly requested committing and pushing all current project changes on
  `feature/smart-wait-engine`.
- **Scope:** Existing local workset covering runner/concurrency stability, durable runtime/offline
  packaging hardening, recorder/session lifecycle, reports/telemetry UI, docs/plans, verifier scripts,
  and untracked project files currently visible to Git. Root `electron_test*.cjs` scratch probes were
  intentionally ignored because they contain absolute local profile paths and are not project artifacts.
- **Verification before commit:** `npm run build` pass; `npm run verify:runner` 82/82;
  `npm run verify:recorder` 57/57; `npm run verify:telemetry` 39/39; `npm run verify:reports` 26/26;
  `npm run verify:waits` 21/21; `npm run verify:mock-site` 28/28; `npm run validate:offline` pass;
  `npm run verify:concurrency` 78/78.
- **Result:** Fresh local verification passed; changes prepared for commit and push per the explicit
  Git-cycle request.

---

## 2026-07-07 — Claude (Opus 4.8) — Dark premium re-skin PLANNING pass (docs only)

- **Task:** Planning-only pass for the full-app dark premium re-skin (user pivot: light → dark
  premium SaaS; full-app scope). Reviewed the 4 Dribbble template URLs via WebFetch — **all four
  returned blocked/empty content**; proceeded per the fallback design target as instructed.
- **Audit findings:** `global.css` still has **130 distinct hex colors** vs 124 `--awkit-*` usages
  (tokens confined to the reports refactor); hotspots `#ffffff`×47, `#617089`×39, `#dfe6ef`×37,
  `#f8fafc`×29, `#eef2f7`×17, `#1769e0`×17; shared-class leverage: `.toolbar-button`×70,
  `.work-panel`×38, `.section-heading`×18; 11 TSX files with inline hex + `connectorStyle.ts`
  (light-tuned semantic colors) + `ReportsFailures.CATEGORY_COLORS`.
- **Created:** `docs/ai/ui-reskin-template-plan/` — `00_TEMPLATE_REVIEW_FINDINGS` (incl. honest
  inaccessibility record), `01_RESKIN_REVIEW_SUMMARY`, `02_SPECIFIC_SYSTEM_DESIGN` (per-class dark
  anatomy), `03_DESIGN_TOKENS_AND_GLOBAL_CSS_PLAN` (full dark token system + legacy-hex→token
  conversion table + specificity strategy: value-substitution inside existing rules),
  `04_APP_SHELL_AND_SHARED_COMPONENTS_PLAN` (21-item table), `05_PAGE_BY_PAGE_RESKIN_PLAN` (every
  route), `06_WORKFLOW_CANVAS_NODES_CONNECTORS_PLAN` (invariant-preserving; connectorStyle values-only
  edit, saved styles win), `07_MOTION_AND_ANIMATION_SYSTEM_PLAN`, `08_SIMPLIFICATION_WITHOUT_
  FUNCTIONALITY_LOSS` (iron rule + control-count diff gate), `09_BINDING_AND_DEPENDENCY_AUDIT`,
  `10_IMPLEMENTATION_PHASES` (R1–R12, stop-and-report), `11_VERIFICATION_QA_AND_REGRESSION_PLAN`
  (real package.json commands + grep gates), `12_RISK_REGISTER` (20 risks),
  `13_NEXT_IMPLEMENTATION_PROMPT` (Phase R1 prompt).
- **Application code changed:** NONE (docs only). **Tests run:** none needed (planning);
  grep audits only.
- **Result:** implementation-ready dark re-skin plan; awaiting user approval to start Phase R1.

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 13: final QA + packaging + handoff (COMPLETE, PASS)

- **Task:** Execute Phase 13 (final) of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — final
  verification sweep, packaging validation, docs, and the structured handoff report.
- **Verification (2026-07-07):** `npm run build` clean; `npm run validate:offline` pass (dev mode);
  `npm run verify:mock-site` 28/28; rebuilt `dist/win-unpacked` via `electron-builder --dir` (avoids
  the documented max-compression OOM); `npm run verify:packaged-runtime` **25/25** against the real
  rebuilt EXE (boots with all changes; durable/telemetry init + migration v2 on a fresh runtime.sqlite;
  external SQLite read OK). Plus the Phase 12 fresh runtime/store evidence (runner 82, cancellation 12,
  telemetry 39, durable-store 11, runtime-status 15) and Phase 11 UI evidence (reports 26, flow-designer
  19, workflow-builder 13).
- **Docs:** created `docs/ai/ui-reports-refactor/FINAL_REPORT.md` (pack's handoff format);
  updated `docs/ai/ARCHITECTURE.md` (Reporting & Telemetry + Design-system sections) and
  `docs/ai/FEATURES.md` (Reports & analytics section).
- **Not re-run (justified):** the 70-check `verify:packaged-walkthrough` — it exercises
  workflow-run/cancellation/recovery paths this read-only-telemetry + UI initiative doesn't touch, and
  `verify:packaged-runtime` 25/25 already proves a clean packaged boot with the changes. Standing
  pre-existing gates unchanged: max-compression signed EXEs (16 GB OOM), clean/offline VM walkthrough,
  code-signing.
- **Result:** UI/UX refactor + reports initiative (Phases 1–13) COMPLETE — implemented, verified,
  documented; additive; zero new npm deps. Nothing committed/pushed (git skipped per user).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 12: mapping/binding regression audit (PASS)

- **Task:** Execute Phase 12 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — full Section-C
  mapping/binding/dependency audit over every file changed in Phases 2–11; produce a readiness verdict.
- **Method:** concrete checks — route-id uniqueness (grep), `telemetry:*` handler↔preload channel
  parity (8/8 exact), interval/listener cleanup (grep: all cleared on unmount), dependency count
  (unchanged: 7 runtime deps / 13 devDeps, zero new), dead-component scan (`TrendDelta` unused —
  documented primitive), plus fresh runtime regression evidence.
- **Fresh evidence (2026-07-07):** `verify:telemetry` 39/39, `verify:durable-store` 11/11,
  `verify:runtime-status` 15/15, `verify:runner` 82/82, `verify:cancellation` 12/12 (execution
  semantics intact WITH telemetry writers + process sampler active — proves telemetry can't fail a
  run); plus Phase 11's `verify:flow-designer` 19/19, `verify:workflow-builder` 13/13,
  `verify:reports` 26/26, build clean.
- **Verdict (recorded in `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` §C): PASS.** All 8 audit checks
  pass; no regressions in execution/persistence/canvases; no blocking risks. Open non-blocking items:
  `TrendDelta` primitive not yet consumed, populated-data report GUI path not exercised on the empty
  dev profile, 10-min heap soak + OS reduced-motion toggle are manual gates.
- **Result:** Initiative audited PASS. Next: Phase 13 (final QA + packaging + handoff report).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 11: motion pass + reduced-motion audit

- **Task:** Execute Phase 11 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — route-content
  fade, motion-token unification, and a reduced-motion / compositor / idle-animation audit.
- **Changed:** `app/renderer/layout/AppShell.tsx` — route-content fade: `<main>` keyed by
  `activeRouteId` (re-triggers on nav) + `main-surface-animated` class applied to **non-canvas routes
  only** (CANVAS_ROUTES excluded so a mount transform never perturbs React Flow measurement).
  `app/renderer/components/reports/ReportPage.tsx` — dropped the now-redundant `awkit-page-enter`
  (fade centralized in AppShell). `app/renderer/styles/global.css` — `.main-surface-animated` shares
  the `awkit-page-enter` keyframes.
- **Audit (documented in `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` §Phase 11):** reduced motion fully
  covered (global CSS media block + `AnimatedCounter`'s `usePrefersReducedMotion`; no other JS
  animation); compositor-friendly except a bounded one-shot `.awkit-bar-fill` width transition
  (accepted); no idle always-running animations (gauge pulse only ≥85%, shimmer only while loading,
  spin only while refreshing); one-shot transitions use motion tokens.
- **Tests (2026-07-07):** `npm run build` ✅ clean; `verify:flow-designer` ✅ 19/19 and
  `verify:workflow-builder` ✅ 13/13 (the `<main>` key change is safe for canvas mount);
  `verify:reports` ✅ 26/26 (route fade doesn't break report rendering).
- **Result:** Consistent motion language + a safe route fade; reduced-motion comprehensively honored.
  Next: Phase 12 (mapping/binding regression audit — 08 §C full pass).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 10: Flow Designer / Workflow Builder visual refactor (CSS-only)

- **Task:** Execute Phase 10 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — the delicate
  designer visual polish, preserving every invariant in `03_ENHANCED_WORKFLOW_BUILDER_CANVAS_NODES.md`.
- **Scope decision:** kept it **strictly CSS-only** (edited only `app/renderer/styles/global.css`).
  Deliberately did NOT change `connectorStyle.ts` — the connector colors are semantically meaningful
  (success=green/failure=red/conditional=amber/parallel=violet); overriding with flat purple/blue
  would regress clarity and the design rule "status colors carry meaning."
- **Changed (`global.css` only):** `.action-flow-node` + `.scenario-flow-node` → token surfaces/
  border/blue accent + `--awkit-shadow-card` + box-shadow/border transition + 10px radius;
  `.selected` → purple token ring (`color-mix`) + float shadow; `.action-node-icon` → surface-inset +
  purple; `.scenario-node-order` → `--awkit-blue`. No geometry/structure/DOM/serializer changes.
- **Tests (2026-07-07):** `npm run build` ✅ clean; **`verify:flow-designer` ✅ 19/19** and
  **`verify:workflow-builder` ✅ 13/13** (all port-sibling/un-clipped/edge, loop button+port+semicircle,
  conditional-lock, and selected-only resize invariants intact with the restyled nodes — WB verifier
  needs a persisted Builder workflow selection: re-seed `selections.selectedBuilderWorkflowId` if it
  times out on an empty canvas). `verify:runner`/`verify:recorder` NOT re-run — they execute headlessly
  against the runner core and never load `global.css`; a CSS-only diff cannot affect serialization or
  recorder logic.
- **Audit:** row appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (PASS, zero persisted/
  serializer impact).
- **Result:** Designer nodes visually modernized (softer premium shadows, purple accent system) with
  every canvas invariant preserved; zero logic/serializer risk by construction. Next: Phase 11
  (motion/animation pass + reduced-motion audit).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 9: failure/success + server-performance analytics

- **Task:** Execute Phase 9 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — failure/reliability
  analytics and server/storage performance.
- **Changed (additive server channel):** `src/reports/TelemetryContracts.ts` (+`StorageUsage`/
  `ServerReport`); `app/main/ipc/telemetry.ipc.ts` (+`telemetry:server` — computed in the IPC layer
  to keep the src/ boundary: `getConfiguredPaths` + a bounded ≤20k-entry never-throwing dir walk
  cached 60s + `getRuntimeStatus` capacity/process fields); `app/main/preload.ts` (+`telemetry.server`).
- **Created:** `pages/ReportsFailures.tsx` (category donut + bar from `telemetry.failures`, top failing
  workflows, reliability ranking with flakiness `min(100, round(failureRate×60 + retryRate×40))` [≥5-run
  threshold, tooltip-documented], deterministic evidence-based insights — no AI/network);
  `pages/ReportsServer.tsx` (memory/CPU/Chromium cards + storage bar chart + availability + backpressure
  + artifacts-never-auto-deleted note). Insights/failure-grid/donut-legend/storage CSS in `global.css`.
  Routes `reportsFailures`/`reportsServer` + Reports nav group.
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer JS +19 kB); **`npm run verify:reports`
  ✅ 26/26** (real Electron: all 7 report routes render + resolve; Server Performance shows 4 cards +
  a real storage-usage section from actual dev-profile folder sizes; zero telemetry/undefined console
  errors); `verify:flow-designer` ✅ 19/19 (no canvas regression).
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Reports section complete (Overview/Workflow/Instance/Chrome/Runtime/Failure/Server +
  Run Artifacts); zero new deps. Next: Phase 10 (Flow Designer / Workflow Builder visual refactor).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 8: consumption history + concurrency analytics

- **Task:** Execute Phase 8 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — historical runtime
  + Chrome consumption trends and analytical summary, on the Phase 4 `runtimeSeries`/`processHistory`
  channels.
- **Created:** `app/renderer/components/reports/ConsumptionTimeline.tsx` (hand-rolled multi-series SVG
  line chart — shared time x-domain, y auto-scale, gaps for undefined points, aria summary,
  empty-safe); `pages/ReportsRuntime.tsx` (4 timelines: concurrency [browsers/flows/queue], host
  [memory %/CPU %], Chrome process count, Chrome memory [chromium + electron]; analytical summary:
  busiest window + peak browsers/memory/process count). Timeline CSS in `global.css` (`awkit-`
  namespaced). Route `reportsRuntime` + Reports nav group.
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer JS +11 kB); **`npm run verify:reports`
  ✅ 21/21** (real Electron: Runtime route renders + resolves to a clean empty state — dev profile has
  no in-range samples — zero telemetry/undefined console errors); `verify:flow-designer` ✅ 19/19 (no
  canvas regression). Retention sweep for both sample tables already proven by `verify:telemetry`
  Part D (unchanged, 39/39).
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Runtime/consumption history + analytics live; zero new deps. Next: Phase 9
  (failure/success + server-performance analytics).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 7: live Chrome consumption + RPM gauges

- **Task:** Execute Phase 7 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — live
  Chrome/Playwright consumption dashboard with animated RPM-style gauges, on the existing 2s
  `executions.runtimeStatus()` poll (carrying the Phase 3 `processes` sample).
- **Created:** `app/renderer/components/reports/` — `RadialGauge.tsx` (hand-rolled 180° SVG gauge,
  bands 0–60/60–85/85–100, CSS-rotated needle [reduced-motion safe], undefined→neutral "—"),
  `RpmGaugeCard.tsx` (title + mandatory source/formula tooltip + high-band pulse),
  `AvailabilityNotice.tsx` (only mentions access when the reason is access-related), `LiveProcessStrip.tsx`
  (Chrome/host stats + per-slot contexts/pages/health, NULL-tolerant), `useRuntimeStatus.ts` (2s poll,
  cleaned up on unmount, keeps last snapshot on transient error); `pages/ReportsChrome.tsx` (4 gauges:
  pool saturation / concurrency / memory pressure / CPU + process cards + strip + availability +
  backpressure banner). Gauge/notice/process-strip CSS in `global.css` (all `awkit-` namespaced).
  Route `reportsChrome` + Reports nav group.
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer JS +16 kB, CSS +2.5 kB); **`npm run
  verify:reports` ✅ 18/18** (real Electron: Chrome route renders 4 RPM gauges — idle shows pool/
  concurrency 0% and memory/CPU "—" because ResourceSampler starts on first run, i.e. the graceful
  unavailable path — process-detail section present, stable across a poll tick, zero telemetry/undefined
  console errors); `verify:flow-designer` ✅ 19/19 (no canvas regression). runtime-status logic
  untouched (consume-only), so `verify:runtime-status` not re-run.
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Live Chrome consumption dashboard with RPM gauges + graceful availability degradation;
  zero new deps. Next: Phase 8 (consumption history + concurrency analytics).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 6: workflow & instance reports + run drill-down

- **Task:** Execute Phase 6 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — per-workflow and
  per-instance report pages with run drill-down, on the Phase 4 telemetry channels.
- **Changed (additive filter):** `src/reports/TelemetryContracts.ts` (+`RunHistoryFilter`);
  `queryRunHistory(range,page,filter?)` threaded through `RuntimeStore`/`SqliteRuntimeStore`
  (parameterized scenarioId/status conditions), `ExecutionEngine`, `app/main/ipc/telemetry.ipc.ts`,
  `app/main/preload.ts`. Back-compatible (filter optional).
- **Created:** `app/renderer/components/reports/RunDetailDrawer.tsx` (run metadata + node-attempts
  table + artifact "Open folder" via `system.openPath` to the parent dir), `statusTone.ts`
  (status→StatusBadge tone + duration/time formatters); `pages/ReportsWorkflows.tsx` (client-side
  sortable per-workflow table + scenarioId-filtered recent-runs + drawer); `pages/ReportsInstances.tsx`
  (live status distribution via a 2s `executions.list()` poll cleaned up on unmount + paginated run
  history + drawer). Report table/drawer/distribution/pager CSS in `global.css` (all `awkit-`
  namespaced). Routes `reportsWorkflows`/`reportsInstances` added to `routes.tsx` + the Reports nav group.
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer JS +27 kB, CSS +4 kB); **`npm run
  verify:reports` ✅ 13/13** (real Electron: all 3 report routes render + resolve to valid states,
  Instances live-status section, zero telemetry/undefined console errors); **`npm run verify:telemetry`
  ✅ 39/39** (+scenarioId + status filter checks); `verify:flow-designer` ✅ 19/19 (no canvas regression).
  Populated-data GUI path (rows + drawer content) not exercised — dev profile has no in-range runs;
  covered by `verify:telemetry` + build-time binding types.
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Workflow + instance reports live with run drill-down; zero new deps. Next: Phase 7
  (live Chrome consumption + RPM gauges).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 5: reports nav shell + Overview dashboard

- **Task:** Execute Phase 5 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — first rendered
  report UI: Reports nav + the `app/renderer/components/reports/` scaffold + a live Overview page on
  the Phase 4 `telemetry.overview` channel.
- **Created:** `app/renderer/components/reports/` — `useTelemetryQuery.ts` (loading/error/data,
  stale-request cancel, manual refetch, no polling), `ReportPage.tsx`, `TimeRangeSelector.tsx`,
  `MetricSparkline.tsx`, `BarChart.tsx`, `DonutChart.tsx` (hand-rolled SVG/DOM, zero chart deps,
  point-capped, text/aria fallbacks); `pages/ReportsOverview.tsx` (overview metrics + live instance
  counts + runs-over-time sparkline; loading/error/store-disabled/empty/ready states);
  `scripts/verify-reports-gui.mjs` (+ `verify:reports` npm script).
- **Changed:** `app/renderer/routes.tsx` (+`reportsOverview` route/RouteId; relabel existing `reports`
  → "Run Artifacts", id unchanged), `app/renderer/layout/LeftNavigation.tsx` (new "Reports" group;
  moved `reports` out of "Run"), `app/renderer/styles/global.css` (report/chart CSS — all `awkit-`
  namespaced, reduced-motion block stays last). App.tsx needed no change — it already ignores an
  unknown `lastRouteId` and falls back to `routes[0]`.
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer JS +15 kB, CSS +3 kB for the pages/charts);
  **`npm run verify:reports` ✅ 8/8** (real Electron: nav→render, header "Reports Overview", resolves
  to a valid non-loading state — empty "No runs in this range yet" on the dev profile — 5-button range
  selector + range change + refresh, zero telemetry/undefined console errors); `verify:flow-designer`
  ✅ 19/19 (shared CSS, no canvas regression); `verify:telemetry` ✅ 37/37 (aggregate correctness).
  Real-data GUI path (populated metrics) not exercised — dev profile has no in-range runs; covered by
  `verify:telemetry` aggregates + the GUI empty→ready state machine.
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** First report page live and rendering real telemetry (empty state on a fresh profile),
  full state matrix, zero new deps. Next: Phase 6 (workflow & instance reports + run drill-down).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 4: telemetry query IPC + preload

- **Task:** Execute Phase 4 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — read-only
  `telemetry:*` query channels over the Phase 3 durable read-model, so Phase 5 report pages have a
  typed data source. Additive; existing channels untouched.
- **Created:** `src/reports/TelemetryContracts.ts` (shared read-model types + `percentile`/
  `durationStats`/`processSampleToHistoryPoint` helpers), `app/main/ipc/telemetry.ipc.ts` (7 channels;
  preset→sinceIso + bucketMs resolved server-side).
- **Changed:** `src/runner/store/RuntimeStore.ts` (+5 query methods on the interface;
  NullRuntimeStore returns empty + `storeEnabled:false`). `src/runner/store/SqliteRuntimeStore.ts`
  (queryOverview/Workflows/RunHistory/Failures/RuntimeSeries — SQL SELECT + bounded JS aggregation,
  windowed/paginated, row-capped; + `selectAll`/`rangeClause`/`statusBucket`/`buildRunsSeries`
  helpers). `src/runner/ExecutionEngine.ts` (getTelemetry* read-only delegators; run detail reuses
  run/attempts/artifacts). `app/main/ipc/index.ts` (register). `app/main/preload.ts` (typed
  `telemetry` group — additive; no global rename).
- **Tests (2026-07-07):** `npm run build` ✅ clean; **`npm run verify:telemetry` ✅ 37/37** (Phase 3's
  21 + 16 new Part G query-layer checks: overview counts/rates/duration/queue-wait, workflow grouping
  + sort, run-history pagination, failure categorization + top-workflow, runtime-series bucketing,
  deterministic range filtering, empty-DB safety, NullRuntimeStore `storeEnabled:false`);
  `verify:durable-store` ✅ 11/11; `verify:runtime-status` ✅ 15/15. Runner/concurrency NOT re-run —
  Phase 4 adds only read-only query methods + IPC/preload; execution/write paths are unchanged from
  Phase 3 (which passed runner 82 / concurrency 78 / cancellation 12) and the whole engine typechecks.
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Read-only telemetry query surface complete and typed end-to-end
  (store → engine → IPC → preload). No report pages yet. Next: Phase 5 (reports nav shell + Overview).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 3: telemetry read-model (additive)

- **Task:** Execute Phase 3 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` — additive durable
  telemetry foundation for the reports UI, without changing execution semantics.
- **Changed:** `src/runner/store/RuntimeStoreSchema.ts` (migration **v2** `reporting-extensions`:
  nullable `runtime_runs` cols scenarioName/triggerType/queueWaitMs/durationMs/retryCount/
  recoveryCount/reportCategory + new `runtime_process_samples` table + 4 read indexes; new
  `DurableProcessSampleRecord`; extended `DurableRunRecord`). `src/runner/store/SqliteRuntimeStore.ts`
  (extended `upsertRun` for v2 cols — preserved across INSERT OR REPLACE via the existing merge-read;
  new `recordProcessSample`/`listProcessSamples`/`sweepRetention` + `selectAll` helper).
  `src/runner/store/RuntimeStore.ts` (interface + NullRuntimeStore: 3 new methods).
  `src/runner/concurrency/RuntimeStatus.ts` (+`processes?: ProcessTreeSample`, additive).
  `src/runner/ExecutionEngine.ts` (run-summary writers at the existing start/end upsert seams:
  scenarioName/triggerType/queueWaitMs at start, durationMs/retryCount/reportCategory at end;
  `startProcessSampling()` gated by `AWKIT_PROCESS_SAMPLING`, persists ≤1 history row/15s; retention
  sweep on durable init). `.env.example` (+3 `AWKIT_*` reporting vars). `package.json`
  (+`verify:telemetry`). `scripts/verify-durable-store.mts` (migration-count assertions updated for v2).
- **Created:** `src/reports/ReportCategories.ts` (pure map over the existing `ErrorClass` →
  report taxonomy; no re-parsing; conservative `unknown`), `src/runner/runtime/ProcessTreeSampler.ts`
  (Windows CIM own-subtree Chromium count+memory + Electron main RSS; throttled unref'd timer;
  never-throws; `availability` full/partial/unavailable), `scripts/verify-telemetry.mts`.
- **Tests (2026-07-07):** `npm run build` ✅ clean; **`npm run verify:telemetry` ✅ 21/21** (v1→v2
  in-place upgrade on a real v1-only DB, run-summary round-trip incl. REPLACE-preservation,
  process-sample write/read, retention time+run cap keeping recoverable runs, full taxonomy mapping,
  sampler never-throws); `verify:durable-store` ✅ 11/11; `verify:runtime-status` ✅ 15/15;
  `verify:runner` ✅ 82/82; `verify:cancellation` ✅ 12/12; `verify:concurrency` ✅ 78/78.
- **Audit:** rows appended to `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` Section B (all PASS).
- **Result:** Durable telemetry read-model in place, additive, execution semantics unchanged. No IPC
  query layer or report pages yet. Next: Phase 4 (telemetry query IPC + preload typings).

---

## 2026-07-07 — Claude (Opus 4.8) — UI/UX refactor Phase 2: design-system token + primitive foundation

- **Task:** Execute Phase 2 of `docs/ai/ui-reports-refactor/09_EXECUTION_PLAN.md` (design tokens +
  shared primitives + reduced-motion). Theme locked light-first per user; git/Phase 0 skipped per user.
- **Changed:** `app/renderer/styles/global.css` — added the `--awkit-*` light-first token block after
  the existing `--space-*`/`--radius-*` root (additive; no existing rule modified), the `awkit-`
  namespaced component CSS (StatusBadge/SectionHeader/SkeletonCard/EmptyState/TrendDelta +
  `.metric-card-*` tone/trend + page-enter keyframes), and a global `prefers-reduced-motion` block
  placed last. `app/renderer/components/shared/MetricCard.tsx` — extended additively (`trend`, `tone`,
  `loading` optional props; `value` widened string→ReactNode; delegates loading to SkeletonCard).
- **Created:** `components/shared/StatusBadge.tsx`, `SectionHeader.tsx`, `SkeletonCard.tsx`,
  `EmptyState.tsx`, `TrendDelta.tsx`, `AnimatedCounter.tsx`, `usePrefersReducedMotion.ts`. All
  `awkit-` namespaced so they never collide with the existing `.status-chip`/`.badge-*`/
  `.empty-state`/`.section-heading` classes. Not yet consumed by any page (consumption begins Phase 5).
- **Tests (2026-07-07):** `npm run build` ✅ clean (renderer CSS 106→114 kB for the new rules; JS
  +~1 kB); `npm run verify:flow-designer` ✅ 19/19; `npm run verify:workflow-builder` ✅ 13/13 after
  `npm run seed:mock-fixtures` + persisting `selections.selectedBuilderWorkflowId` (the WB GUI
  verifier needs a workflow already loaded on the Builder canvas — the empty-canvas timeout is a
  persisted-state/environment dependency, confirmed NOT a regression: the failure is at the load
  precondition and no new CSS matches `.scenario-flow-node`).
- **Audit:** rows appended to `docs/ai/ui-reports-refactor/08_MAPPING_BINDING_DEPENDENCY_AUDIT.md`
  Section B (all PASS; zero persisted-data/IPC impact).
- **Result:** Design-system foundation in place, additive, no behavior change. Next: Phase 3
  (telemetry read-model — migration v2 + ReportCategories + ProcessTreeSampler + retention).

---

## 2026-07-07 — Claude (Fable 5) — UI/UX refactor + reports prompt-pack review → enhanced execution pack (docs only)

- **Task:** Review the 10-file external prompt pack (`~/Downloads/awkit-ui-reports-prompt-pack/...`)
  for the planned UI/UX refactor + reports/telemetry initiative, compare it against the real
  codebase, and produce an enhanced, path-accurate execution pack. No application code changed;
  originals preserved (they live outside the repo).
- **Created:** `docs/ai/ui-reports-refactor/` — `00_REVIEW_SUMMARY`, `01_ENHANCED_MASTER_GOAL`,
  `02_ENHANCED_DESIGN_SYSTEM_AND_MOTION`, `03_ENHANCED_WORKFLOW_BUILDER_CANVAS_NODES`,
  `04_ENHANCED_REPORTING_TELEMETRY_CONTRACT`, `05_ENHANCED_REPORTS_DASHBOARDS`,
  `06_ENHANCED_LIVE_CHROME_CONSUMPTION_RPM`, `07_ENHANCED_ANALYTICS_FAILURE_SUCCESS_SERVER`,
  `08_MAPPING_BINDING_DEPENDENCY_AUDIT` (baseline binding map + live audit table),
  `09_EXECUTION_PLAN` (14 phases, Phase 0 = land current branch work first),
  `10_IMPLEMENTATION_PHASES` (copy-paste phase prompts), `11_ACCEPTANCE_CRITERIA` (30 measurable),
  `12_VERIFICATION_AND_QA_PLAN`, `13_RISK_REGISTER` (22 risks).
- **Key corrections to the pack:** the telemetry foundation largely EXISTS (`runtime.sqlite`
  runs/node-attempts/heartbeats/capacity snapshots via `RuntimeStoreSchema.ts`; `RuntimeStatusSnapshot`
  IPC; `ResourceSampler`; `ErrorClassifier`; JSON `ConcurrentRunReport`) — re-scoped Prompt 04 to
  additive migration v2 + taxonomy mapping + retention + `ProcessTreeSampler` + windowed `telemetry:*`
  query IPC; flagged the light-vs-dark theme contradiction (decision gate before Phase 2, light-first
  recommended); zero-new-dependency chart/motion approach (hand-rolled SVG + CSS, per RULES.md);
  replaced the "admin required" process-metrics framing with an availability model; moved the fragile
  canvas visual refactor to Phase 10 (after reports stabilize); added the uncommitted-branch
  precondition (Phase 0) as the top risk.
- **Tests run:** `npm run build` ✅ clean (docs-only change; renderer bundle now reports ~1,176 kB —
  pre-existing growth, noted for the bundle-size debt). **Not run:** feature verifiers (no code touched).
- **Result:** Enhanced pack ready; Phase 1 (baseline audit) can start after Phase 0 (land current work).

## 2026-07-07 — Claude (Fable 5) — Phase 5.1 verification: Chromium no-egress hardening validated, strict-net packaged walkthrough, packaging OOM finding

- **Task:** Close the Phase 5.1 gates — validate the Chromium no-egress hardening end-to-end, prove
  the packaged-process teardown, re-run packaged + regression verification after hardening, and
  honestly document the VM/NSIS gates that need a clean machine. GitHub untouched; nothing committed.
- **Verified the hardening (no code rewrite needed — the module was already sound):** confirmed
  `PLAYWRIGHT_DISABLED_FEATURES` in `src/runner/ChromiumHardening.ts` is an exact mirror of installed
  Playwright 1.61's `disabledFeatures` (load-bearing: the `--disable-features` override is last-wins),
  and that the hardening is wired into `BrowserContextFactory` + both recorder launch paths and NOT
  into `SessionCaptureService` (user's real Chrome stays plain).
- **Changed:** `src/runner/ChromiumHardening.ts` — pinned four Playwright behavioral defaults
  (`--disable-background-timer-throttling/-hang-monitor/-popup-blocking/-prompt-on-repost`) that the
  prompt listed, so the no-egress arg set is self-contained if a future Playwright drops them
  (`--disable-popup-blocking` is load-bearing for the popup-flow feature). `scripts/package-portable.ps1`
  + `scripts/package-per-user-installer.ps1` — throw on a non-zero `electron-builder` exit (they
  previously masked a fatal pack failure and left a stale EXE). Docs: `CURRENT_STATE`, `KNOWN_ISSUES`
  (egress finding marked RESOLVED + new packaging-OOM finding), `PHASE5_OFFLINE_VM_WALKTHROUGH`,
  `TESTING`, `COMMANDS`, `ARCHITECTURE`, `HANDOFF`.
- **Tests (all ✅, 2026-07-07):** build clean; `verify:chromium-hardening` **13/13** (ONLINE — bundled
  Chromium made ZERO non-loopback connections over a 20 s idle window AND navigation to google.com/
  example.com still worked); rebuilt `dist/win-unpacked` **with hardening**; `verify:packaged-runtime`
  **25/25**; `AWKIT_WALKTHROUGH_STRICT_NET=1 verify:packaged-walkthrough` **70/70** (strict no-egress
  PASSES — Phase 5 Google-service burst eliminated; no zombie process); validate:offline pass;
  durable-store 11; durable-locks 17; cancellation 12; safety-policy 17; dynamic-origin-claims 14;
  resource-sampling 14; startup-recovery 10; concurrency 78; locks 15; browser-pool 13; watchdog 13;
  artifacts 13; runtime-status 15; runner 82; waits 21; protected-login 16; recorder 57; mock-site 28;
  stress:concurrency 13; stress:cancellation 8; stress:locks 10; stress:artifacts 7; soak:runtime 8;
  `ai:memory` pass. `npm test` / `npm run lint` still do not exist.
- **Packaging finding:** rebuilding the final single-file EXEs at 7-Zip `-mx=9` OOMs on this 16 GB
  machine (`Can't allocate required memory!`); `win-unpacked` (the shared, validated payload) rebuilt
  fine. Produced a one-off `store`-compressed **hardened** portable EXE (~1.2 GB, validation-only);
  the NSIS installer likewise needs a higher-memory (or lower-compression) machine for a shippable build.
- **Not done / remaining gates:** clean/offline Windows VM walkthrough (§3 checklist — no VM available);
  NSIS install/uninstall cycle (integrity sha512 only); code-signing (EXEs unsigned); max-compressed
  shippable EXEs. **Release-candidate decision: `PASS WITH WARNINGS`** (egress now hardened + proven;
  VM/installer/signing gates remain).

---

## 2026-07-06 — Claude — Phase 5.1 handoff update: centralized Chromium hardening + packaged-process cleanup

- **Task:** Capture the current Phase 5.1 follow-up state after implementing Chromium no-egress hardening and safer packaged-process teardown for the real Electron main.
- **Added:** `src/runner/ChromiumHardening.ts`, `scripts/helpers/packaged-process-tree.mts`, and `scripts/verify-chromium-hardening.mts`; wired the hardening into the runner/recorder launch paths and the packaged verifiers.
- **Tests:** `npm run verify:chromium-hardening` — 13/13 passed. `node scripts/ai-memory/check-memory.mjs` pending final run.
- **Remaining:** rebuild/package the EXEs with the new hardening, run the NSIS install/uninstall cycle, and perform the clean/offline Windows VM walkthrough.

---

## 2026-07-06 — Claude (Fable 5) — Phase 5 Release-Candidate Gate: packaged clean-profile walkthrough, VM checklist, full re-verification, RC decision

- **Task:** Final release-candidate validation of the freshly packaged AWKIT build (Phase 5).
  A true clean/offline Windows VM was NOT available to the agent (no Windows Sandbox/Hyper-V on
  this machine), so the phase delivers: (a) an automated packaged **clean-profile** walkthrough on
  the dev machine, (b) the human offline-VM checklist, (c) full verification-suite re-run, (d) an
  honest RC decision. Details in `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md`.
- **Added:** `scripts/verify-packaged-walkthrough.mts` + `npm run verify:packaged-walkthrough`
  (**68/68** final run) — real `dist/win-unpacked` EXE with a FRESH empty `LOCALAPPDATA`:
  first-run init (no white screen, durable init, folders, sample-only content), IPC fixture
  import, full workflow → `completed` + artifacts (JSONL/screenshot/report/flow-state), hard
  cancel → `cancelled` + Chromium tree gone + slot/locks freed, 4 instances ≤ 2 browser roots at
  OS level, recorder start/cancel, hard kill of the REAL main pid → startup recovery
  (`orphaned`/recoverable, Recoverable Runs panel renders in the real UI, markReviewed clears),
  external SQLite read, ACTUAL portable EXE first boot on a 2nd fresh profile, NSIS sha512 vs
  `latest.yml`, continuous TCP sampling (app processes loopback-only; bundled-Chromium startup
  Google burst = warn-only / strict env flag). Evidence: `dist/phase5-evidence/`.
  Also `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` (honest status + §3 human VM checklist).
- **Findings (KNOWN_ISSUES "Phase 5 packaged-walkthrough findings"):** packaged EXE spawn pid is a
  LAUNCHER STUB (kill the real main from `app.evaluate(() => process.pid)` — stub kills created
  zombie apps in early runs); orphaned Chromium self-exits when the real main dies; bundled
  Chromium emits a per-launch Google-service TCP burst (app data stays loopback; harmless
  offline; hardening follow-up noted); `runWorkflow` requires `dryRun:false`; decorated instance
  ids vs raw executionId; mock-site 127.0.0.1 vs Node-18 `localhost`→`::1` probe gotcha.
- **Tests (Phase 5J, all ✅):** build clean; validate:offline pass; packaged-runtime 24;
  packaged-walkthrough 68; durable-store 11; durable-locks 17; cancellation 12; safety-policy 17;
  dynamic-origin-claims 14; resource-sampling 14; startup-recovery 10; concurrency 78; locks 15;
  browser-pool 13; watchdog 13; artifacts 13; runtime-status 15; runner 82; waits 21;
  protected-login 16; recorder 57; mock-site 28; ai:memory pass. `npm test`/`npm run lint` do not
  exist (honest note).
- **Not done / remaining gate:** the clean/offline Windows VM walkthrough itself (§3 checklist) —
  including the NSIS install/uninstall cycle, offline-adapter startup, and manual
  protected-login/session-reuse GUI flows on a machine with real Chrome. EXEs unsigned.
- **Result:** Release candidate **PASS WITH WARNINGS** — packaged build proven functional on a
  clean user profile with loopback-only app traffic; the offline-VM human gate remains open.

---

## 2026-07-06 — Claude (Fable 5) — Phase 4 Release Hardening: sql.js packaging, runtime diagnostics, recoverable-runs UI, packaged smoke + stress verifiers, offline manifest

- **Task:** Make the Phase 3 durable runtime safe to ship in the packaged app: sql.js WASM
  packaging + offline manifest, runtime path diagnostics, actionable recoverable runs in the
  Instance Monitor, packaged-app smoke verification, deterministic stress/soak verifiers, docs.
  Full detail in `docs/ai/PHASE4_RELEASE_HARDENING.md`.
- **Added:** `src/runner/store/SqlJsLoader.ts` (explicit `sql-wasm.wasm` resolution via
  `createRequire` + `locateFile`; path exposed for diagnostics; dev/tsx/app.asar);
  `RuntimeStatusSnapshot.environment` (`RuntimeEnvironmentInfo`: appMode/runtimeRoot/sqlitePath/
  artifactsRoot/sqlJsWasmPath/durableStoreEnabled) + `appPaths.getAppMode()`;
  engine `initializeDurableRuntime` (called at startup from `registerExecutionIpc`),
  `getRecoveryDetails`, `applyRecoveryAction` (+ `RuntimeStore.listArtifacts`,
  `DurableArtifactRecord`); IPC `execution:recoveryDetails`/`execution:recoveryAction` + preload;
  `app/renderer/components/instances/RecoverableRunsPanel.tsx` (details, open artifacts, re-run
  safe runs only, mark reviewed/abandoned — dangerous runs never auto-resumed); verifiers
  `verify-packaged-runtime.mts`, `verify-stress-{concurrency,cancellation,locks,artifacts}.mts`,
  `verify-soak-runtime.mts`; `docs/ai/PHASE4_RELEASE_HARDENING.md`.
- **Changed:** `SqliteRuntimeStore` uses the loader; `electron-builder.json` explicitly ships
  `node_modules/sql.js/dist/sql-wasm.{js,wasm}`; `generate-dependency-manifest.ps1` +
  `validate-offline-bundle.ps1` + `DependencyManifest.ts` policy require the sql.js runtime/WASM
  flags (`dependencies.sqlJs` added); `execution.ipc.ts` (startup durable init +
  `resolveStorageDirs` dedupe); `InstanceMonitor.tsx` (recovery panel + refresh callback);
  engine recoverable-run filter → status `orphaned`/`failed` with note (so reviewed/abandoned
  drop out). **Fix found by stress:** `DurableLockStore.acquireExclusive` treats Windows
  EPERM/EBUSY wx-create races as contention (clean denial) instead of throwing.
- **Packaging:** manifest regenerated; `validate:offline` ✅ (dev + strict); portable EXE rebuilt
  (310 MB) + NSIS installer rebuilt (357 MB), both 2026-07-06, warm cache, no internet needed by
  the app; `verify:packaged-runtime` ✅ 24/24 (real packaged-EXE launch: appMode=packaged, durable
  store enabled, WASM from app.asar, `%LOCALAPPDATA%` paths, external SQLite read, artifacts
  writable).
- **Tests:** build ✅; new: stress:concurrency 13 ✅, stress:cancellation 8 ✅, stress:locks 10 ✅,
  stress:artifacts 7 ✅, soak:runtime 8 ✅, packaged-runtime 24 ✅. Regression: durable-store 11 ✅,
  durable-locks 17 ✅ (one flake under packaging CPU load, re-run clean — noted in KNOWN_ISSUES),
  safety-policy 17 ✅, startup-recovery 10 ✅, resource-sampling 14 ✅, locks 15 ✅, browser-pool
  13 ✅, watchdog 13 ✅, runtime-status 15 ✅, concurrency 78 ✅, artifacts 13 ✅, cancellation
  12 ✅, dynamic-origin-claims 14 ✅, runner 82 ✅, waits 21 ✅, protected-login 16 ✅, recorder
  57 ✅, mock-site ✅, ai:memory ✅. `npm test`/`npm run lint` do not exist.
- **Not run:** clean offline-VM GUI walkthrough (human gate); full workflow execution inside the
  packaged app (smoke verifier launches + inspects the runtime only); GUI verifiers
  (flow-designer/workflow-builder — no connector-canvas changes).

---

## 2026-07-06 — Claude (Fable 5) — Concurrency Phase 3: durable SQLite runtime store, cross-process locks, hard cancellation, safety metadata, dynamic origin claims, CPU sampling, startup recovery

- **Task:** Fix the Phase 2 limitations: durable runtime state (SQLite), cross-process locks,
  hard-stopping cancellation, explicit side-effect metadata (keyword heuristic → fallback only),
  mid-flow origin claim re-evaluation, CPU/memory sampling in backpressure, and app-restart
  recovery. Full design + honest trade-offs in `docs/ai/PHASE3_DURABLE_RUNTIME.md`.
- **Driver decision:** native `better-sqlite3` unusable (Node 18 verifiers vs Electron 33 Node 20
  ABI split; `node:sqlite` needs Node 22.5+) → **`sql.js` 1.13.0** (WASM SQLite, new runtime
  dependency + `@types/sql.js` dev): real SQLite file, zero native ABI, offline after install.
  Persistence = atomic-rename writes (debounced, immediate on critical transitions); cross-process
  exclusion comes from atomic-filesystem locks, not SQLite file locking.
- **Added:** `src/runner/store/` — `RuntimeStoreSchema` (10 tables, versioned migrations),
  `SqliteRuntimeStore`, `RuntimeStore` interface + `NullRuntimeStore`, `DurableLockStore`
  (wx-file exclusive locks, rank-based semaphores, fencing versions, TTL + dead-pid stale
  detection with quarantine-not-delete), `DurableLockConfig`, `AppInstance` (app instance id /
  pid liveness), `StartupRecovery` (pure policy shared by engine + verifier);
  `src/runner/concurrency/CancellationToken.ts` (token + source, CancelledError),
  `OriginClaimTracker.ts` (acquire-new-then-release-old, bounded wait, transition log),
  `ResourceSampler.ts` (system/process memory + CPU deltas, never throws);
  `FlowStep.safety`/`SideEffectLevel` schema types + `src/runner/runtime/StepSafetyPolicy.ts`
  (explicit → type defaults → keyword fallback → conservative unknown).
- **Changed:** `RetryPolicy` is metadata-first (explicit dangerous/externalCommit never retry;
  explicit-retryable overrides keywords; idempotency-key requirement enforced; infra-terminal
  classes — incl. new `cancelled` — beat everything); `ErrorClassifier` + `cancelled` class;
  `BackpressureController` + sampler thresholds (`AWKIT_MAX_SYSTEM_MEMORY_PERCENT`/
  `AWKIT_MAX_PROCESS_MEMORY_MB`/`AWKIT_MAX_CPU_PERCENT`, fresh-sample gated, sampler failures
  tolerated); `CapacitySnapshot` + sampled fields; `ProfileLockManager.acquireDurable` (memory +
  durable, both released) used by `BrowserContextFactory`; `PlaywrightRunner` cancellation
  (onCancel closes the live generation; flow loop refuses post-cancel work) + passes token/origin
  tracker to executors; `StepExecutor` throws pre-step on cancel, re-evaluates origin claims after
  successful steps, emits `sideEffectLevel`; `ExecutionEngine` — per-instance
  `CancellationTokenSource` (`stopInstance` → durable cancellation record + hard browser close +
  `cancelled` state, not failed), durable store init + startup recovery + stale-lock scan on first
  run, durable run/attempt/heartbeat/watchdog/artifact/capacity writes, durable dispatch-claim
  mirroring, origin tracker per instance, async `getRuntimeStatus` with `durableLocks` +
  `recoverableRuns`; Instance Monitor strip shows CPU/Mem/Recoverable/Stale-durable-locks.
- **Tests (new, all deterministic/local):** `verify:durable-store` 11/11, `verify:durable-locks`
  17/17 (REAL second process via spawned tsx child), `verify:cancellation` 12/12 (live Chromium:
  30s wait cancelled in seconds, profile lock freed), `verify:safety-policy` 17/17,
  `verify:dynamic-origin-claims` 14/14 (live 127.0.0.1→localhost origin change),
  `verify:resource-sampling` 14/14, `verify:startup-recovery` 10/10.
- **Regression (all green):** `npm run build` clean (sql.js externalized in the main bundle),
  `verify:concurrency` 78, `verify:locks` 15, `verify:browser-pool` 13, `verify:watchdog` 13,
  `verify:artifacts` 13, `verify:runtime-status` 15, `verify:runner` 82, `verify:waits` 21,
  `verify:protected-login` 16, `verify:recorder` 57, `ai:memory` pass, `validate:offline` pass
  (dev mode). `npm test` / `npm run lint` do not exist.
- **Behavior changes:** Stop now hard-closes the running browser (run ends `cancelled`, artifacts
  where possible); unknown custom step types are no longer auto-retried (conservative default);
  cross-origin mid-flow navigation claims the new origin (can queue/fail the step when saturated,
  env-tunable); dispatch/profile locks are cross-process durable; packaged builds must ship
  `node_modules/sql.js` (manifest regeneration + repack pending — flagged).

---

## 2026-07-06 — Claude (Fable 5) — Concurrency Phase 2: audit, hardening, traces, semaphores, runtime status UI

- **Task:** Audit the Phase 1 concurrency layer's real wiring, answer the 15 review questions
  (`docs/ai/CONCURRENCY_PHASE2_REVIEW.md`), and complete production hardening: failure traces,
  origin/account semaphores, runtime status visibility, manual-handoff heartbeat safety, and focused
  verifiers for the dangerous failure modes.
- **Audit outcome:** slot/lock release paths and manual-handoff watchdog exclusions were already correct;
  gaps found and fixed: stale heartbeat right after handoff resume, failure screenshots gated behind
  `onFailure.screenshot`, no trace capture, no per-origin/account fairness, no status surface.
- **Added:** `src/runner/artifacts/TraceService.ts` (per-step trace chunks on the context; failed steps
  save `traces/<stepId>-<ts>.zip` before anything closes, success discards; `AWKIT_TRACE_MODE`
  off/onFailure/always, armed only when the engine provides `paths.traces` so verify scripts and embedded
  runners have zero overhead); `src/runner/concurrency/DispatchClaims.ts` (origin from baseUrl/first goto,
  account from envFile) + kind-prefix semaphore capacities in `ResourceLockManager` (`origin:*` →
  `AWKIT_MAX_PER_ORIGIN` default 2, `account:*` → `AWKIT_MAX_PER_ACCOUNT` default 1; exact-key overrides);
  `src/runner/concurrency/RuntimeStatus.ts` (pure aggregation) + engine methods `getRuntimeStatus` /
  `getLockSnapshot` / `getBrowserPoolSnapshot` / `getWatchdogSnapshot`, IPC `execution:runtimeStatus`,
  preload `executions.runtimeStatus()`, and a read-only Instance Monitor status strip (browsers/flows/
  pages/queued/locks incl. stale, crash count, backpressure reason, last watchdog action; 2s poll).
- **Changed:** `ExecutionEngine` acquires origin/account claims at dispatch (saturated key → only those
  instances queue; browser slot returned) and releases them + strays in `finally`; heartbeat refreshed on
  `resumeInstance`/`retryHandoff`; node attempts now carry `tracePath` + sanitized `currentUrl`.
  `StepExecutor` wraps every step in a trace chunk and emits `tracePath`/`currentUrl` on failed events;
  `FlowExecutor` captures failure screenshots **by default** (opt-out via `onFailure.screenshot: false`;
  best-effort, never masks the step error). `WatchdogService` gained a snapshot (last scan, recent
  findings, swept locks). `ResourceLockManager.snapshot(false)` keeps expired-but-unswept leases visible
  for diagnostics. `InstanceRuntimePaths`/`InstanceExecutionContext.paths` gained `traces`.
- **Tests:** new `verify:locks` 15/15 (incl. lock release after failed `launchPersistentContext` and the
  concurrent-profile race), `verify:browser-pool` 13/13 (fake runtimes; saturation, release after
  failure/cancel, generation guards), `verify:watchdog` 13/13 (incl. manual-handoff no-false-positive),
  `verify:artifacts` 13/13 (live Chromium: failure trace zip, success discards, default screenshot,
  trace-save failure never masks error), `verify:runtime-status` 15/15. Regression: `verify:concurrency`
  78/78, `npm run build` clean, `verify:runner` 82/82, `verify:waits` 21/21, `verify:protected-login`
  16/16, `verify:recorder` 57/57, `ai:memory` pass. `npm test` / `npm run lint` do not exist in this repo.
- **Behavior changes:** failing steps now save a trace zip + screenshot by default in engine runs;
  instances sharing one origin/account queue beyond the configured caps (env-tunable).

---

## 2026-07-06 — Claude (Fable 5) — Concurrency & stability layer (locks, browser pool, backpressure, watchdog, classified retry, run artifacts)

- **Task:** Implement the local high-concurrency stability architecture: resource locks, bounded browser
  pool, backpressure/admission control, explicit runtime state machines, node-attempt records, classified
  retries with a dangerous-mutation guard, heartbeats + watchdog, and structured on-disk run artifacts —
  without breaking the existing execution path. Plan in `docs/ai/CONCURRENCY_IMPLEMENTATION_PLAN.md`.
- **New modules:** `src/runner/concurrency/` (`ResourceKey`, `Semaphore`, `ResourceLockManager` with
  exclusive/shared/semaphore modes + TTL leases + fencing versions + atomic multi-acquire + snapshot,
  `ConcurrencyConfig` with `AWKIT_*` env overrides, `BackpressureController`, `CapacitySnapshot`),
  `src/runner/browser/BrowserWorkerPool.ts` (bounded browser slots, health/crash window, capacity snapshot),
  `src/runner/runtime/` (`RuntimeStateMachine` — FlowRunStatus/NodeStatus with validated transitions,
  `NodeAttempt`(+Log), `ErrorClassifier`, `RetryPolicy`, `InstanceHeartbeat`, `WatchdogService`),
  `src/runner/artifacts/` (`RunLogger` — JSONL to `instance.paths.logs`, `RunStateArtifacts` —
  flow-state/node-attempts/capacity/locks JSON under `<instance storage>/state`),
  `src/profiles/ProfileLockManager.ts` (exclusive in-process `profile:*` lock).
- **Integrations (minimal diffs):** `BrowserContextFactory` acquires the exclusive profile lock before
  `launchPersistentContext` (released in the runtime close path — two runtimes can never share one
  `userDataDir` in-process); `FlowExecutor.executeWithRetry` is now classification-gated (transient
  navigation/timeout/locator/download errors retry with exponential backoff; submit/approve/delete/send/
  pay/confirm-looking mutations and dead browser/context/page failures never auto-retry) and isolated
  parallel branches are clamped by `maxActiveNodesPerFlow`; `PlaywrightRunner` gained an optional
  `onBrowserRuntime` hook (initial launch + every Reuse Session swap generation); `ExecutionEngine`
  acquires a pool slot per instance under backpressure admission (pool saturation / active-flow cap /
  low memory / crash rate → dispatch queued with a logged reason), tracks per-instance runner promises,
  updates `InstanceRuntimeState.runtime` (flowRunStatus/heartbeatAt/browserWorkerId — additive; UI
  `status` unchanged), folds progress events into heartbeats + JSONL log + node attempts, runs the
  `WatchdogService` (stale-heartbeat notes, orphan → failed, stale-lock sweep), and writes end-of-run
  state artifacts + releases slots/stray profile locks in `finally`.
- **Defaults (env-overridable):** maxBrowsers 2, contexts/browser 4, pages/context 2, activeFlows 4,
  nodes/flow 2, min free memory 512MB, crash window 3/5min, stale heartbeat 120s, watchdog 15s.
- **Tests:** new `npm run verify:concurrency` (78/78 — locks incl. fencing/TTL/atomicity, semaphore,
  pool saturation, backpressure reasons, classifier/retry incl. dangerous guard, state machines, node
  attempts, watchdog stale/orphan/dedupe/lock-sweep, JSONL logger, state artifacts, FlowExecutor retry
  integration with stubbed executor, live Chromium profile-lock + cleanup). Regression: `npm run build`
  clean, `verify:runner` 82/82, `verify:waits` 21/21, `ai:memory` pass.
- **Behavior changes:** instances beyond the browser cap now queue (previously unbounded Chromium
  processes); failed steps only retry for transient error classes; isolated-parallel concurrency is
  clamped by host limits (existing verifier configs unaffected at the default of 2).

---

## 2026-07-05 — Codex — Workflow protected-login handoff now captures a normal-browser session

- **Task:** Align workflow-runner protected-login handling with the intended secure-login design: when a
  protected login / human verification page is detected, close the Playwright automation browser, open normal
  Chrome/Edge at the detected login URL, wait for the user to complete login and close it, capture the session,
  relaunch Playwright with that persistent profile, and continue the workflow.
- **Root cause:** `Auto Secure Login` and recorder secure-login handoff already used `SessionCaptureService`
  + browser restart, but runner-side auto-detected Protected Login Handoff only paused for
  Continue/Retry/Cancel and did not start normal-browser session capture.
- **Fix:** `StepExecutor` now calls a protected-login capture path when `sessionService` and
  `browserRestarter` are available. The helper emits waiting progress, closes the automation browser, starts
  `manualChromeHandoff` capture at the detected/configured login URL, handles cancel/timeout/error, validates
  captured profile data, relaunches on the captured profile, marks the session used, clears pending handoff
  state, and maps session outputs. The capture wait uses `config.handoffTimeoutMs` (0 disables timeout on
  explicit Protected Login Handoff nodes) and deliberately ignores the triggering step's `timeoutMs`, so an
  auto-detected protected login after `goto` does not time out on the navigation/action timeout while the
  user is still completing login in normal Chrome/Edge. Captured handoff also returns step outcome
  `sessionCaptured` for connector routing parity with Auto Secure Login / Reuse Session. If capture services
  are unavailable, the existing manual pause behavior remains as fallback.
- **Tests:** Added `verify:runner` coverage for explicit `protectedLoginHandoff` session capture and
  auto-detected protected-login capture after `goto`, including a short-navigation-timeout regression.
  `npm run typecheck` pass; `npm run verify:runner` 82/82; `npm run build` pass;
  `npm run ai:memory` pass; `npm run verify:protected-login` 16/16.

---

## 2026-07-05 — Codex — Reuse Session browser lifecycle fixed

- **Task:** Fix the real `Smart-Rec-Chatgpt` workflow path (`Start → Auto Secure Login → Reuse Session →
  Navigate to https://chat.openai.com`) so Reuse Session does not leave stale browser/page references and
  Navigate no longer fails with `Target page, context or browser has been closed`.
- **Root cause:** `StepExecutor.runStepWithWaits` restored the pre-swap active page after `Auto Secure Login`
  / `Reuse Session`, so the next step could target an old closed page/context. Browser-swap lifecycle
  handlers and cleanup also lacked generation guards, so old-generation close/disconnect events were not
  explicitly isolated from the new persistent runtime.
- **Fix:** `PlaywrightRunner` now performs a generation-guarded two-phase persistent-context swap with
  explicit close reasons, debug close-stack traces behind `AWKIT_BROWSER_LIFECYCLE_DEBUG=1`, a swap mutex,
  live page resolution from the new context, active-executor rebinding, old-runtime close after publish, and
  post-swap liveness verification. `StepExecutor` liveness-checks before every step, preserves the new active
  page after session-swap steps, verifies swapped sessions, reports locked/open profile failures clearly, and
  treats stale recorder-generated armed response waits on successful `goto` as optional navigation hints.
  `BrowserContextFactory` checks profile lock artifacts before launch; `ExecutionEngine` avoids an unhandled
  rejection from fire-and-forget `.finally()` cleanup.
- **Files changed:** `src/runner/BrowserContextFactory.ts`, `src/runner/PlaywrightRunner.ts`,
  `src/runner/StepExecutor.ts`, `src/runner/ExecutionEngine.ts`, `scripts/verify-runner.mts`,
  `scripts/verify-waits.mts`, and AI memory docs.
- **Tests:** `npm run typecheck` pass; `npm run verify:waits` 21/21; `npm run build` pass;
  `npm run verify:runner` 79/79; `npm run verify:recorder` 57/57; `npm run ai:memory` pass.
- **Real Electron evidence:** Built app launched through Playwright `_electron`; workflow execution
  `df1f89c3-71b4-4f40-a3bd-73dcefd542fe` showed `Reuse Session` succeeded (3433 ms) and `Navigate to
  https://chat.openai.com` succeeded (30579 ms) after resuming the expected Protected Login Handoff. No
  closed-target browser lifecycle error occurred and no terminal unhandled rejection was observed.

---

## 2026-07-04 — Claude — IN PROGRESS: Reuse Session browser swap dies ~34–76ms after relaunch (UNRESOLVED)

- **Symptom:** Recorded ChatGPT workflow (`Start → Auto Secure Login → Reuse Session → Navigate`) fails.
  `Reuse Session` swaps the automation browser to `launchPersistentContext(session-8aa61a06 dir)`; diagnostics
  show `[swap] relaunched OK: 2 page(s), activePage.closed=false`, then the active page closes ~34ms later,
  the context ~58ms, and the browser disconnects ~76ms after relaunch. `Navigate` then throws
  `page.goto: Target page, context or browser has been closed`. The browser process is dying on its own
  right after Playwright connects — **only inside the running Electron app.**
- **Hypotheses DISPROVEN by direct reproduction (all four repro paths SUCCEED with the exact failing
  profile + swap sequence):** standalone Node, inside real Electron (bundled Chromium `resources/browsers/
  chromium/chrome.exe`), inside real Electron on the dev path (Playwright `chromium-1228`), and a same-dir
  persistent-context close→relaunch race. In every isolated harness the profile opens, pages stay alive, and
  `goto https://chat.openai.com` succeeds.
  - NOT a version mismatch: profile `Last Version`, bundled Chromium, and `chromium-1228` are all
    `149.0.7827.55`.
  - NOT stale lock files: profile dir has no `SingletonLock`/`SingletonCookie`/`SingletonSocket`/`lockfile`.
  - NOT "external/incompatible profile": the real-Chrome (`manualChromeHandoff`) profile reuses fine with the
    bundled Chromium. **Do NOT add a `createdBy: awkit-playwright` guard — `SessionCaptureService` captures
    every session with the user's REAL Chrome/Edge by design, so such a guard would block 100% of sessions.**
  - NOT signal teardown: `handleSIGINT/SIGTERM/SIGHUP:false` added; browser still dies.
- **What changed (hardening + diagnostics only — does NOT fix the crash):**
  - `src/runner/BrowserContextFactory.ts` — `removeStaleProfileLocks` before `launchPersistentContext`
    (best-effort); `handleSIGINT/SIGTERM/SIGHUP:false` on all launches (embed-in-Electron best practice).
  - `src/runner/PlaywrightRunner.ts` — `[swap]` diagnostics in `restartBrowser` (relaunch log + context/page
    `close` listeners with elapsed-ms) + `logMeta` helper. This is what produced the decisive timing.
  - `src/runner/StepExecutor.ts` — `assertSwappedBrowserAlive` (round-trips `page.title()` after swap) +
    `sessionProfileOpenError`; `executeReuseSession`/`executeAutoSecureLogin` wrap the swap and fail the node
    with an actionable message instead of a cryptic downstream `goto` error. (Fails cleanly; does not prevent
    the browser death.)
- **Next step (not done):** discriminate crash vs. close vs. process-exit in-app — add `page.on('crash')` +
  browser-disconnect reason to the swap path, and run the workflow once pointing `Reuse Session` at a
  brand-new profile. If a fresh profile also dies at ~76ms, the profile is conclusively ruled out and the
  cause is app-runtime-specific (something the full app does to the freshly launched browser).
- **Tests:** `npm run build` clean. `npm run verify:runner` → 76/76 (does not cover the in-app Electron swap
  that fails). Root cause still OPEN.
- **Repro scripts were temporary and deleted** (they lived under `scripts/_tmp_*`). Untracked
  `electron_test*.cjs` at repo root are pre-existing (not from this task) and were left untouched.

---

## 2026-07-04 — Claude — Recorder secure-login browser handoff (protected login/popup)

- **Task:** Detect protected login / protected popup during recording, pause + close the Playwright
  browser, hand off to the user's real Chrome for the manual login/MFA/OTP/CAPTCHA/approval, capture the
  authenticated session, insert `Auto Secure Login` + `Reuse Session` nodes, and resume recording on the
  saved session. No security bypass; no secrets captured/logged.
- **What was added:** Recorder-side detector `detectRecorderProtectedLogin` + `detectFromRecorderSignals`
  (DOM signals: password / one-time-code / recaptcha-hcaptcha-turnstile iframe / captcha+verification aria /
  passkey-webauthn; plus new text patterns OTP/verification-code/passkey/digital-signature/external-approval)
  in `ProtectedLoginDetector.ts`. `RecorderService` handoff state machine (detected → capturingSession →
  sessionCaptured → resumed/error): pause + preserve draft + `closeBrowser`, `continueWithNormalBrowser`
  (real Chrome via `SessionCaptureService.startCapture(..., "manualChromeHandoff")`), `captureSessionAndResume`
  (validate via `hasCapturedData`, insert secure nodes deduped, `launchPersistentContext` resume), and
  `cancelSecureHandoff`. Extracted shared `wireContext`. `buildRecordedFlow` serializes the secure nodes.
  Recorder UI handoff panel + always-on handoff poll. IPC/preload `recorder.getHandoff/
  continueWithNormalBrowser/captureSessionAndResume/cancelHandoff`. Mock Site `/mock/protected-login`,
  `/mock/protected-popup-login`, `/mock/protected-popup-captcha`, `/mock/protected-popup-otp`,
  `/mock/session-reuse` (+ index link) and `scripts/verify-protected-login-recorder.mts`.
- **Files changed:** `src/security/ProtectedLoginDetector.ts`, `src/recorder/RecorderService.ts`,
  `src/recorder/RecorderTypes.ts`, `src/recorder/buildRecordedFlow.ts`, `src/session/SessionProfile.ts`,
  `src/session/SessionCaptureService.ts`, `app/main/ipc/recorder.ipc.ts`, `app/main/preload.ts`,
  `app/renderer/pages/Recorder.tsx`, `mock-site/server.mjs`, `mock-site/public/secure-login/*`,
  `mock-site/public/index.html`, `mock-site/README.md`, `scripts/verify-protected-login-recorder.mts`,
  `package.json`, and `docs/ai/*`.
- **Tests run:** `npm run verify:protected-login-recorder` → 34/34, `verify:protected-login` → 16/16,
  `verify:recorder` → 57/57, `verify:recorder-draft` → 17/17, `verify:recorder-flow` → 13/13,
  `verify:mock-site` → 28/28, `verify:popup` → 12/12, `verify:runner` → 76/76, `npm run build` clean.
- **Notes / limits:** Runtime replay of the inserted nodes uses the existing Auto Secure Login / Reuse
  Session runner behavior (no new runner logic). Full GUI walkthrough (real Chrome launch + persistent-context
  resume) not driven here — logic + detection are verified via `_electron`-free scripts against the mock site.

## 2026-07-04 — Antigravity — Verified Popup Flow Handling & Mock Site Scenarios

- **Task:** Verify the Multi-Window / Popup Flow Handling implementation and expand the local Feature Test Lab with robust mock-site popup scenarios.
- **What was added:** Added 7 mock site scenarios inside `mock-site/public/popup/` to verify target blank, window.open, auto-close, multiple popups, failure cases, and smart-wait inside popups. Created automated verification suite `scripts/verify-popup-mock-site.mts`. Fixed `verify-popup.mts` server fileMap. Added `routeChange` exclusion to `runStepWithWaits` in `StepExecutor` to prevent reverting the active page back to main after a route change.
- **Files changed:** `mock-site/public/popup/*`, `mock-site/server.mjs`, `mock-site/README.md`, `scripts/verify-popup-mock-site.mts`, `scripts/verify-popup.mts`, `src/runner/StepExecutor.ts`.
- **Tests run:** `npm run verify:popup` → 12/12, `npm run verify:popup-mock-site` → 8/8, `node scripts/ai-memory/check-memory.mjs` → Passed.

## 2026-07-04 — Antigravity — Multi-Window / Popup Flow Handling

- **Task:** Implement Phase 10/11: Multi-Window / Popup Flow Handling. Allow AWKIT to record and replay workflows where clicking a link/button opens a new Chrome window, tab, or popup.
- **What was added:** `PageRegistry` introduced in `StepExecutor` to maintain mappings of `pageAlias` to Playwright `Page` objects. Added step types `switchToPopup`, `switchToMainPage`, and `closePopup`. Click actions with `opensPopup` wait for the newly spawned window and register it into the context. `LocatorFactory` and the step running routine `runStepWithWaits` now correctly route commands targeting a specific popup by temporarily mutating the active page so internal wait logic applies to the specific popup context.
- **Testing:** Added `/popup-lab` and `/popup-terms` to Mock Site. Created `scripts/verify-popup.mts`.
- **Files changed:** `src/profiles/FlowProfile.ts`, `src/runner/StepExecutor.ts`, `src/runner/PlaywrightRunner.ts`, `app/renderer/components/workflow/flowNodeCatalog.ts`, `app/renderer/components/workflow/flowNodeRegistry.ts`, `app/renderer/pages/Recorder.tsx`, `mock-site/server.mjs`, `scripts/verify-popup.mts`, and docs.
- **Tests run:** `npm run verify:popup` → 12/12, `npm run build` clean.

---

## 2026-07-04 — Codex — Agent handoff refresh

- **Task:** Refresh `docs/ai/HANDOFF.md` for transfer to the next agent/human after the local Smart Wait
  and Mock Site Feature Test Lab work.
- **Repo state captured:** branch `feature/smart-wait-engine`, latest local commit `fe1edc4`, clean before
  the handoff docs refresh, ahead of upstream by 3 local commits.
- **Files changed:** `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`.
- **Tests:** AI memory check run for the handoff refresh.

## 2026-07-04 — Codex — Mock Site Feature Test Lab and agent guidance

- **Task:** Upgrade the offline mock site into a mandatory Feature Test Lab and update agent guidance so
  future Recorder, Runner, Smart Wait, Flow Designer, Workflow Builder, Instance Monitor, locator, node,
  wait, and execution work considers mock-site scenarios.
- **What was added:** new lab index (`/`), Smart Wait/Runner scenarios (`/smart-waits`), Recorder scenarios
  (`/recorder-lab`), Designer/Workflow scenarios (`/designer-lab`), local delayed JSON endpoint
  (`/api/delay?ms=...`), `npm run verify:mock-site` (28/28), `mock-site/AGENTS.md`, and mirrored
  `mock-site-maintainer` skills for `.agents`, Claude, and Gemini.
- **Docs/guidance:** updated mock-site docs, root/adaptor agent instructions, scripts/tests local rules,
  AI architecture/testing/commands/workflow/current-state/handoff docs, and fixture docs.
- **Tests:** `npm run build` passed; `npm run verify:waits` 18/18; `npm run verify:runner` 76/76;
  `npm run verify:recorder` 57/57; `npm run verify:recorder-draft` 17/17;
  `npm run verify:flow-designer` 19/19; `npm run verify:mock-site` 28/28; AI memory check passed.

## 2026-07-04 — Codex — Smart Wait Engine remaining phases (diagnostics + UI)

- **Task:** Complete the remaining Smart Wait Engine phases after Phase 1 runner support and Phase 2
  recorder observation.
- **What was added:** Runner Smart Wait failures now include phase, sanitized current URL, condition,
  timeout, recorded reason, last observed state, and suggestion. Recorder Controls exposes a persisted
  Smart Wait toggle and recorded actions summarize captured wait types. Flow Designer save/load now
  preserves `beforeWaits`/`afterWaits`, and Node Properties shows a Smart Waits section with before/after
  grouping, condition details, timeout editing, per-wait remove, and clear-list controls. The Flow Designer
  GUI verifier now navigates by visible label instead of stale `title` text.
- **Files changed:** `src/runner/StepExecutor.ts`, `scripts/verify-waits.mts`,
  `scripts/verify-flow-designer-gui.mjs`, `app/renderer/pages/Recorder.tsx`,
  `app/renderer/pages/FlowChartDesigner.tsx`, `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx`,
  `app/renderer/components/workflow/flowDesignerTypes.ts`, `app/renderer/styles/global.css`, docs.
- **Tests:** `npm run typecheck` passed; `npm run verify:waits` 18/18; `npm run verify:runner` 76/76;
  `npm run verify:recorder` 57/57; `npm run verify:recorder-draft` 17/17; `npm run build` clean;
  `npm run verify:flow-designer` 19/19; AI memory check passed.

## 2026-07-04 — Claude Code/Codex — Smart Wait Engine Phase 2 (recorder observation)

- **Task:** Phase 2 — the recorder now observes what happens between user actions and captures
  condition-based Smart Waits, reusing the Phase 1 `WaitCondition` model. No UI controls; no
  Multi-Window/Popup or Manual Handoff work.
- **What was added:**
  - **Pure correlation core** (`src/recorder/smartWaitObservation.ts`, new): `RecordedSignal` union +
    `buildSmartWaits(signals, fromTs, toTs, opts)` — turns raw page signals from the window after the
    previous action into ranked `WaitCondition[]`. Priority response → loaderHidden → tableHasRows/
    listHasItems → toastVisible → elementEnabled → urlChanged; caps at 3; **ignores background polling**
    (a request path repeated ≥3× in the window); `fixedDelay` only as a fallback when nothing reliable
    is found (and only when `captureWaitTime` is off, to avoid double delays). Browser-free → unit-tested.
  - **In-page observer** (`src/recorder/recorderInitScript.ts`): patches `fetch`/`XMLHttpRequest`
    (method + URL **path** only — never query/headers/bodies/cookies), `history`+popstate/hashchange
    for URL changes, and a MutationObserver + 150 ms scan for loaders appearing→disappearing, toasts,
    disabled→enabled transitions, and table/list/card row-count increases. Emits safe signals via a new
    `__awtkit_recordSignal` binding. A silent baseline scan avoids emitting for pre-existing content.
  - **RecorderService** (`RecorderService.ts`): new `captureSmartWaits` option (**default on**), buffers
    signals (bounded), and on each distinct action attaches `buildSmartWaits(...)` output as `afterWaits`
    on the **previous** action. Legacy `captureWaitTime` fixed-time nodes and fill-collapsing unchanged.
  - **Settings/IPC pass-through** (`uiSettings.ts`, `recorder.ipc.ts`, `preload.ts`, `Recorder.tsx`):
    persisted `settings.recorder.captureSmartWaits` defaults ON and is passed to `RecorderService` without
    adding a new UI control.
  - **Propagation:** `RecordedAction` gains `beforeWaits`/`afterWaits` (`RecorderTypes.ts`);
    `buildRecordedFlow.ts` copies them onto the `FlowStep`.
- **Security:** only method + URL path, status range, timing, loader selectors, short (≤80 char) toast
  text, and locators are captured. No secrets/headers/bodies/cookies/tokens; `networkidle` is not used.
- **Files changed:** `src/recorder/smartWaitObservation.ts` (new), `src/recorder/recorderInitScript.ts`,
  `src/recorder/RecorderService.ts`, `src/recorder/RecorderTypes.ts`, `src/recorder/buildRecordedFlow.ts`,
  `src/profiles/FlowProfile.ts`, `app/main/uiSettings.ts`, `app/main/ipc/recorder.ipc.ts`,
  `app/main/preload.ts`, `app/renderer/pages/Recorder.tsx`, `scripts/verify-recorder-locator.mts`
  (Part D), `scripts/verify-recorder-draft.mts`, docs.
- **Tests:** `npm run verify:recorder` → **57/57** (Part D: POST/GET response, loaderHidden, card/list
  waits, toast, enabled, urlChanged path-only, polling-ignored, fixedDelay fallback on/off, and in-page
  signal emission incl. query stripped). `npm run verify:recorder-draft` → **17/17** (incl. legacy fixed
  wait with Smart Wait disabled), `npm run verify:waits` 15/15, `verify:runner` 76/76, build clean,
  check-memory passed.
- **Not done (later):** UI controls (Phase 4) — `captureSmartWaits` defaults on and has no toggle yet;
  a future Recorder UI can pass the option like `captureWaitTime`. Branch: `feature/smart-wait-engine`
  (separate local commit on top of Phase 1 `cd68ef9`).

## 2026-07-04 — Claude Code — Smart Wait Engine Phase 1 (runner execution)

- **Task:** Phase 1 of the Smart Wait Engine — condition-based waits executed by the runner. Recorder
  observation, UI, and other phases are intentionally out of scope.
- **What was added:**
  - **Types** (`src/profiles/FlowProfile.ts`): a `WaitCondition` discriminated union
    (`loaderHidden` / `elementVisible` / `elementHidden` / `elementEnabled` / `textVisible` /
    `toastVisible` / `response` / `tableHasRows` / `listHasItems` / `urlChanged` / `domStable` /
    `fixedDelay`) with locator-based conditions reusing `StepLocator`; and optional
    `beforeWaits?: WaitCondition[]` / `afterWaits?: WaitCondition[]` on `FlowStep`. Fully additive —
    steps without them, and the legacy `wait` step node, are unchanged.
  - **Runner** (`src/runner/StepExecutor.ts`): `execute` now runs a step via `runStepWithWaits`
    (`beforeWaits` → arm action-triggered `response` waits → action → await armed → `afterWaits`).
    A `response` wait with `armBeforeAction: true` is registered **before** the action (so a fast
    response isn't missed) and awaited after. Added `executeWaitCondition` + helpers
    (`buildResponseWait`, `waitForPredicate`, `waitForDomStable`, `waitLocator` reusing
    `LocatorFactory`) and clear per-wait diagnostics (`formatWaitFailure` / `describeWaitCondition` /
    `waitSuggestion`: step, wait type, condition, timeout, last observed state, suggestion).
    `networkidle` is deliberately not used as a Smart Wait strategy. The legacy `executeWait`
    (time/selector/navigation/networkIdle/textVisible) step node is untouched.
- **Files changed:** `src/profiles/FlowProfile.ts`, `src/runner/StepExecutor.ts`,
  `scripts/verify-waits.mts` (new), `package.json` (`verify:waits` script), docs.
- **Tests:** `npm run verify:waits` → **15/15** (no-waits backward compat, legacy wait node,
  beforeWaits gate, afterWaits, armed-before-action response, loaderHidden, elementEnabled,
  tableHasRows, urlChanged, fixedDelay timing, timeout diagnostics). `npm run verify:runner` → 76/76,
  `npm run verify:recorder` → 42/42 (no regressions), `npm run build` clean, check-memory passed.
- **Not done (later phases):** recorder observation of loaders/network/DOM (Phase 2), diagnostics
  polish (Phase 3), UI controls (Phase 4). Wait locators use page-rooted `LocatorFactory.create().first()`
  for now; container/frame-scoped wait locators can arrive with recorder Phase 2. Branch:
  `feature/smart-wait-engine`.

## 2026-07-04 — Claude Code — Fix .gitignore: track source dirs missing from the repo

- **Task:** Repository-integrity fix. Broad `.gitignore` directory rules meant for runtime output
  (`profiles/`, `reports/`, `instances/`, `storage/`, `data/`) also matched same-named **source**
  directories, so 32 real source files were never committed. `main` therefore could not build from a
  fresh clone (committed code imports `@src/profiles/FlowProfile`, `@src/instances/*`, `@src/reports/*`,
  `@src/storage/*`, `@src/data/*`, and `app/renderer/components/{instances,reports}/*` — all absent).
- **Root cause:** unanchored bare-directory patterns in `.gitignore` (lines ~53/61/62/64/65) match a
  directory of that name at any depth, including `src/profiles/`, `src/reports/`, etc.
- **Fix:** kept the broad rules (they still ignore genuine runtime dirs) and appended anchored
  negations re-including only the source trees: `!src/profiles/`, `!src/reports/`, `!src/instances/`,
  `!src/storage/`, `!src/data/`, `!app/renderer/components/instances/`, `!app/renderer/components/reports/`.
  Added the 32 previously-untracked source files. Sensitive patterns (`session-profiles.json`,
  `*.storageState.json`, `user-data-dir/`, `.env*`, etc.) remain ignored; no secrets/build output added
  (`SecretMasker.ts` is the masking utility, not a secret).
- **Files changed:** `.gitignore` + 32 source files under `src/profiles`, `src/reports`, `src/instances`,
  `src/storage`, `src/data`, `app/renderer/components/instances`, `app/renderer/components/reports`.
- **Verification:** `npm run build` clean, `npm run verify:runner` 76/76, `npm run verify:recorder` 42/42,
  `node scripts/ai-memory/check-memory.mjs` passed. Branch `fix/track-source-dirs-gitignore` (own PR).

## 2026-07-04 — Claude Code — Handoff prep after Smart Locator + Git Full Cycle merges

- **Task:** `/HANDOFF` — prepare the repo for the next agent/human after the stacked-PR merge cycle.
- **Repo state:** `main` at `35548e1` (PR #2 merge); both PRs merged; local merged branches deleted;
  now on a clean `feature/smart-wait-engine` branch (no feature work started). Git metadata is available
  (earlier handoffs' "not a Git repository" note is obsolete).
- **Docs updated:** rewrote `docs/ai/HANDOFF.md` (new current handoff: Smart Locator runtime delta +
  Git Full Cycle skill merged, Smart Wait Engine is the next feature; superseded 2026-07-03 connector
  content moved to Handoff History). Added the `git-full-cycle` cross-agent skill to the
  `docs/ai/CURRENT_STATE.md` AI-agent-architecture inventory.
- **Validation:** `node scripts/ai-memory/check-memory.mjs` — passed. Docs only, so
  `verify:recorder`/`verify:runner`/`build` not re-run this turn (current on `main`: 42/42, 76/76, clean).
- **Note:** Two merged remote branches (`chore/save-inflight-recorder-work`,
  `feature/smart-locator-engine`) still exist on `origin`, left pending user confirmation to delete.

## 2026-07-04 — Claude Code — Smart Locator: runtime fallback, visibility disambiguation, context scoping

- **Task:** Make the existing recorder locator engine production-ready by adding the missing runtime
  delta (the recorder already generates ranked, uniqueness-validated locators). Targeted scope from
  the Smart Locator Engine plan — no new module tree, minimal diffs.
- **What was added:**
  - **Structured locator model** (`src/profiles/FlowProfile.ts`): `StepLocator` now carries optional
    `alternatives: LocatorCandidate[]` (ranked runtime fallbacks) and `context` (container/frame
    scoping). `FlowStep.locator` points at `StepLocator`. Fully backward compatible — legacy steps set
    only the primary fields and deserialize unchanged.
  - **Runtime resolver** (`src/runner/LocatorFactory.ts`): new async `resolve(step)` builds a scoped
    root from `context` (iframe `frameLocator`, then a container resolved to its single/visible match),
    tries the primary then `alternatives` in order, and returns a **single** element per candidate —
    unique match wins, else the one *visible* match when several exist (the fix for a hidden modal
    template + visible modal). Falls back to the primary (auto-wait) when nothing is present yet, and
    throws an actionable diagnostic (per-candidate count/visibleCount + context) when genuinely
    ambiguous. Playwright is 1.49 (no `filter({ visible })`), so visibility is probed via
    `nth(i).isVisible()`. `create()` is retained for count/loop/waitFor paths.
  - **StepExecutor** (`src/runner/StepExecutor.ts`): single-target actions (click/fill/select/check/
    uncheck/radio/scroll-element/upload/download/readText/assertVisible/assert value+text/screenshot
    element) now go through `resolve(step)`; count assertions, element loops, and `waitFor` keep
    `create()`. `guardLocatorQuality` now defers to the resolver when the step has `context` or
    `alternatives` (so recoverable non-unique steps aren't pre-failed).
  - **Recorder** (`recorderInitScript.ts`, `RecorderTypes.ts`, `buildRecordedFlow.ts`): the in-page
    capture script now emits up to 3 ranked `alternatives` and a `context` — nearest **visible dialog**
    (id/testId/role, `visibleOnly`), **table row** (role=row + row text), **card/list item**
    (testId/role + `hasText`), and **iframe** (`frameLocator` selector for same-origin frames). Rows/
    cards are only scoped when the primary is not already globally unique.
- **Files changed:** `src/profiles/FlowProfile.ts`, `src/runner/LocatorFactory.ts`,
  `src/runner/StepExecutor.ts`, `src/recorder/recorderInitScript.ts`, `src/recorder/RecorderTypes.ts`,
  `src/recorder/buildRecordedFlow.ts`, `scripts/verify-recorder-locator.mts` (Part C, +15 checks),
  docs.
- **Tests:** `npm run verify:recorder` → **42/42** (new Part C: duplicate hidden+visible modal,
  visibility fallback, table-row scoping, repeated-card scoping, alternative fallback, iframe context,
  legacy backward-compat). `npm run build` clean; `npm run verify:runner` → 76/76 (no regressions).
- **Not done / limitations:** No UI changes (locator quality badge / debug candidates table / manual
  override editor) — resolver + recorder only. Closed shadow DOM and cross-origin iframes still can't
  be scoped. Feature branch: `feature/smart-locator-engine`.

## 2026-07-04 — Claude Code — Add Git Full Cycle agent skill

- **Task:** Add a reusable Git lifecycle skill teaching agents to safely inspect status, protect
  in-flight work, branch, commit, push, open PRs, handle protected `main`, and manage stacked PRs.
- **What was added:**
  - Added the Git Full Cycle skill for Claude, Codex, and Gemini as byte-identical mirrors:
    `.claude/skills/git-full-cycle/SKILL.md`, `.codex/skills/git-full-cycle/SKILL.md`,
    `.gemini/skills/git-full-cycle/SKILL.md`, plus a canonical shared copy at
    `docs/ai/skills/git-full-cycle/SKILL.md` (`.codex/` and `docs/ai/skills/` newly created).
  - Added a **Git Full Cycle Skill** reference section to the agent entry files `CLAUDE.md`,
    `AGENTS.md`, and `GEMINI.md` (existing content preserved) pointing each agent at its mirror and
    requiring the skill be read before branch/stage/commit/push/PR operations.
- **Files changed:** `.claude/skills/git-full-cycle/SKILL.md`, `.codex/skills/git-full-cycle/SKILL.md`,
  `.gemini/skills/git-full-cycle/SKILL.md`, `docs/ai/skills/git-full-cycle/SKILL.md`, `CLAUDE.md`,
  `AGENTS.md`, `GEMINI.md`, `docs/ai/TASK_LOG.md`.
- **Validation:** `node scripts/ai-memory/check-memory.mjs` (no `verify:ai-memory` npm script exists).
- **Branch:** committed on `chore/save-inflight-recorder-work` (PR #1 still open — docs/skills work
  belongs with it). No Smart Locator feature files touched; Smart Wait Engine not started; no UI
  diagnostics added.

## 2026-07-04 — Claude Code — Recorder: guarantee unique positional fallback locator

- **Task:** Recorder saved a non-unique positional locator, so runs failed with
  "the saved locator matches N elements" (reported: `css=div > div > div > div:nth-of-type(3) > div > div:nth-of-type(3) > svg` matched 6 elements).
- **Root cause:** `structuralSelector` in `src/recorder/recorderInitScript.ts` built a floating
  child-combinator chain capped at 6 levels and only added `:nth-of-type` for same-tag siblings; it
  never validated the result against the live DOM, so the path could match many sibling subtrees.
- **Fix:** Rebuilt `structuralSelector` to walk up from the element prepending one segment per
  ancestor and stop the instant the accumulated path resolves to exactly one element (`q === 1`).
  Each segment pins the node's position among ALL siblings via `:nth-child` (more disambiguating than
  `:nth-of-type`); a stable ancestor id short-circuits into an anchored unique path. This yields the
  shortest unique path and keeps the fallback flagged low-confidence. Semantic/scoped strategies are
  unchanged and still preferred first.
- **Files changed:** `src/recorder/recorderInitScript.ts` (fallback rewrite),
  `scripts/verify-recorder-locator.mts` (added regression test 4b: repeated deeply-nested
  attribute-less `<svg>` subtrees must resolve to one element).
- **Tests run:** `npm run verify:recorder` **27/27** (was 25 + 2 new); `npm run build` clean.
- **Result:** Recorded positional-fallback locators are now unique; the reported multi-match failure
  no longer occurs.

---

## 2026-07-04 — Claude Code — Instances: remove Load More, always-on two-row card scroller

- **Task:** In the Concurrent Instance Monitor, remove the "Load More workflows" button and instead always
  render every workflow card, capping the grid at two rows tall with an internal scroller when the cards
  overflow two rows.
- **Behavior now:** `visibleWorkflows = filteredWorkflows` (all cards always rendered).
  `needsScroll = filteredWorkflows.length > visibleCardCount(gridColumns, 2)`. When `needsScroll`, the grid
  gets `.is-scrolling` (`overflow-y:auto`) and an inline `maxHeight` measured from two card rows + one row
  gap (unchanged measurement logic, now gated on `needsScroll` instead of the old `cardsExpanded`). At two
  rows or fewer the grid renders at natural height with no scroller. Removed the `cardsExpanded`/`visibleRows`
  state, the `INITIAL_CARD_ROWS`/`ROWS_PER_LOAD` constants (replaced by `MAX_CARD_ROWS = 2`), the Load-More
  button, and its search-reset side effects. A "Showing all N workflows — scroll the grid" hint remains when
  scrolling is active.
- **Files changed:** `app/renderer/pages/InstanceMonitor.tsx` (logic + render),
  `app/renderer/styles/global.css` (removed orphaned `.im-load-more` button rule; refreshed a stale
  "Load More" grid comment).
- **Tests run:** `npm run build` clean; `npm run verify:instance-monitor` **22/22** (the `visibleCardCount`
  helper is still used for the two-row threshold and remains covered). Not run: GUI walkthrough of the live
  scroller (manual check outstanding).
- **Result:** Load-More button gone; two-row card scroller is always-on when cards overflow two rows.

---

## 2026-07-04 — Claude Code — AI agent architecture hardening

- **Task:** Added/completed the scalable multi-agent architecture for Cursor, Claude Code,
  Codex/Antigravity, Gemini, and future agents — without rewriting existing AI memory.
- **Baseline preserved:** `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, all existing `docs/ai/*`,
  `.claude/commands/{HANDOFF,TAKEOFF}.md`, `.claude/skills/ai-memory-maintainer`,
  `.agents/skills/{ai-memory-maintainer,agent-handoff,agent-takeoff}`, `.agents/workflows/*`,
  and `.gemini/commands/*` were left untouched.
- **Files added:** `docs/ai/README.md` (concise AI-memory index); `.cursor/rules/`
  `00-project.mdc`, `10-electron-react.mdc`, `20-playwright-runner.mdc`, `30-storage-ipc.mdc`,
  `90-safety.mdc`; `.claude/skills/` `codebase-review`, `feature-implementation`, `bug-fix`,
  `test-and-verify`, `docs-sync`, `refactor-safe`, `pr-review` (each `SKILL.md`); `.agents/skills/`
  `codebase-review`, `feature-implementation`, `bug-fix`, `test-and-verify` (tool-neutral `SKILL.md`).
- **Files changed:** `scripts/ai-memory/check-memory.mjs` — added a non-fatal `optionalFiles`
  warning pass for the new README, Cursor rules, and Claude/agent skills (required checks and
  secret scans unchanged; Cursor rules stay soft, not hard failures).
- **Verification:** `node scripts/ai-memory/check-memory.mjs` → passed required checks, exit 0,
  no warnings. `npm run build`: skipped — only AI-memory Markdown, Cursor `.mdc`, and the checker
  script changed (no app runtime/TS source touched).
- **Result:** Architecture targets 1–11 met; all optional adapter/skill files present.
- **Remaining work:** None for this task. Cursor rules are enforced softly by design.

---

## 2026-07-04 — Claude Code — Recorder wait-capture + Start/End nodes, canvas-click collapse, last-opened restore, Instances Load-More scroller, reusable saved URLs

- **Task:** Six-point AWKIT change set across Recorder, Flow Designer, Workflow Builder, and Instances.
- **Point 1 — Recorder wait-time capture:** New toggle in Recorder Controls (default OFF, persisted at
  `settings.recorder.captureWaitTime`). When ON, `RecorderService` measures think-time between distinct
  actions and inserts a `wait` action (`waitMs`) for pauses ≥ 500 ms (capped 60 s); `buildRecordedFlow`
  saves it as a fixed-time wait step (`config.waitType:"time"`, `timeoutMs`). OFF = unchanged behavior.
- **Point 2 — default Start/End nodes:** Extracted `src/recorder/buildRecordedFlow.ts` (pure). Recorded
  flows now always contain Start + End with actions between (`Start → action… → End`; `Start → End` when
  empty); Start's edge is `always`, action edges `success`; recorded start/end are de-duped.
- **Point 3 — empty-canvas collapse:** Clicking empty canvas in Flow Designer (`onPaneClick`) and Workflow
  Builder collapses the app side menu (new `navigation.collapseSidebar()`), Node Palette / Workflow
  Definition, and Node Properties / Selected Connector — collapse-only (idempotent, persisted). Node
  selection still auto-opens properties; connector selection opens the connector panel (Workflow Builder
  now expands the right panel on edge click).
- **Point 4 — last opened restore:** Already persisted (`selections.lastSelectedFlowId` /
  `selectedBuilderWorkflowId`); added stale-reference clearing so a deleted flow/workflow no longer sticks.
- **Point 5 — Instances Load More:** After Load More, the workflow-card grid renders all cards but becomes
  a two-row internal scroller (measured height + `.workflow-card-grid.is-scrolling`), so the page below
  stays put. Pre-click layout unchanged; new search resets it.
- **Point 6 — reusable saved URLs:** URL history moved out of the transient draft into its own persisted,
  deduped, canonicalized `recorder-urls.json` (survives save/cancel/restart). New `recorder:saveUrl` IPC +
  "Save URL" button; clicking a saved URL row fills the Controls URL field (`saveUrl`/click-to-fill).
- **Files changed:** `src/recorder/RecorderService.ts`, `src/recorder/RecorderTypes.ts`,
  `src/recorder/buildRecordedFlow.ts` (new), `app/main/ipc/recorder.ipc.ts`, `app/main/preload.ts`,
  `app/main/uiSettings.ts`, `app/renderer/pages/Recorder.tsx`, `FlowChartDesigner.tsx`, `ScenarioBuilder.tsx`,
  `InstanceMonitor.tsx`, `app/renderer/App.tsx`, `app/renderer/state/navigation.tsx`,
  `app/renderer/styles/global.css`. Tests: rewrote `scripts/verify-recorder-draft.mts`, added
  `scripts/verify-recorder-flow.mts` + `npm run verify:recorder-flow`.
- **Tests run:** `npm run build` clean; `verify:recorder-draft` **15/15**; `verify:recorder-flow` **13/13**;
  `verify:recorder` **25/25**; `verify:instance-monitor` **22/22**; `verify:runner` **76/76**. Not run:
  GUI walkthroughs for the canvas-collapse and Load-More scroller (manual GUI check outstanding).
- **Result:** All six points implemented; automated validation green.

---

## 2026-07-03 — Claude Code — Recorder: persist unsaved recording draft (URLs survive app close)

- **Task:** Follow-up to "why are Recorded URLs removed when the app closes?" — they were session-scoped,
  in-memory only on the `RecorderService` singleton, so closing before Save lost them. Implemented draft
  persistence so an unsaved recording (actions + URLs) survives a restart and reloads on the Recorder page.
- **How:** `RecorderService` now writes a small JSON draft (`recorder-draft.json`) under the runtime data
  root (`getRuntimeDataRoot()`, i.e. `%LOCALAPPDATA%/WebFlow Studio/`). New methods:
  `configureDraftStorage(path)` (set once by the recorder IPC at startup), `scheduleDraftPersist()`
  (debounced write, called on every recorded action/URL and dedup update), `persistDraft()`,
  `ensureDraftLoaded()` (one-time restore on startup, only when idle + empty so it never clobbers a live
  session), and `discardDraft()` (clear memory + delete file). `startRecording` replaces any old draft;
  `stopRecording` flushes a final write; `cancelRecording` discards; `saveFlow` (IPC) discards after the
  flow is written. `recorder:getActions`/`getUrls` await `ensureDraftLoaded()` so the Recorder page shows a
  restored draft on mount. Renderer `handleSave` now also clears the URL table (consistent with discard).
  URLs are masked and passwords blanked before storage, so the draft holds no secrets.
- **Files changed:** `src/recorder/RecorderService.ts`, `app/main/ipc/recorder.ipc.ts`,
  `app/renderer/pages/Recorder.tsx`. Added `scripts/verify-recorder-draft.mts` +
  `npm run verify:recorder-draft`. Docs: TASK_LOG, CURRENT_STATE, COMMANDS, TESTING, HANDOFF.
- **Tests run:** `npm run build` clean, `npm run verify:recorder-draft` **7/7** (write → restart-restore →
  discard round-trip), `npm run verify:recorder` **25/25** (unaffected).
- **Result:** Recorded URLs (and actions) now survive an app close until explicitly saved or discarded.

## 2026-07-03 — Claude Code — Fix: dropdown not closing on outside click + recorder losing un-blurred text

- **Bug 1 (dropdown):** the `SearchableSelect` combobox (Flow Designer "Saved Flow" picker + the Run-Another-
  Flow node property pickers) did not close when clicking the canvas. Root cause: its outside-click
  listener used a **bubble-phase `mousedown`**, but the React Flow pane consumes pointer events on the
  canvas, so the document listener never fired. Fix: `SearchableSelect.tsx` now listens on **`pointerdown`
  in the capture phase** (fires before any handler can stop propagation; also covers touch "tap out").
  (Workflow Builder's workflow selector is a native `<select>`, which already auto-closes.)
- **Bug 2 (recorder):** typed text was recorded only on the `change` event, which fires on **blur** — so
  text typed into a field that never lost focus (user stops recording while focused, or a SPA re-renders
  the input) was lost. Fix: `recorderInitScript.ts` now also records the value on every **`input`** event
  (live), and `RecorderService`'s `__awtkit_recordAction` binding **collapses consecutive same-field fills**
  (same page + same locator) into one action — so live capture doesn't bloat the saved flow. Password
  values are still masked in both paths.
- **Files changed:** `app/renderer/components/shared/SearchableSelect.tsx`,
  `src/recorder/recorderInitScript.ts`, `src/recorder/RecorderService.ts`. Tests extended:
  `scripts/verify-recorder-locator.mts` (added a no-blur live-typing case),
  `scripts/verify-flow-designer-gui.mjs` (added a dropdown outside-click-closes case). Docs: TASK_LOG,
  CURRENT_STATE, COMMANDS, TESTING, HANDOFF.
- **Tests run:** `npm run build` clean, `npm run verify:runner` **76/76** (unaffected),
  `npm run verify:recorder` **25/25** (incl. "live typing (no blur) records a fill" / captures the value),
  `npm run verify:flow-designer` **19/19** (incl. "Saved Flow dropdown … closes on an outside canvas
  pointerdown"). `npm run verify:workflow-builder` unaffected (last green 13/13).
- **Result:** Both reported bugs fixed and verified in the real Electron app / a real Chromium recorder run.

## 2026-07-03 — Codex — Remaining-work burn-down: runtime safeguards, handoff resume, GUI branch verification

- **Task:** Resolve the repo-verifiable items from the handoff Remaining Work: close the branch-pair
  2→1 GUI verification gap, add Workflow Builder runtime connector-structure validation, and fix the
  manual/protected-login handoff dead-end. Also rebuild current portable/NSIS packages for the offline VM
  walkthrough.
- **Connector GUI fix:** `ActionFlowNode.tsx` and `ScenarioFlowNode.tsx` now call
  `useUpdateNodeInternals(id)` when `portFlags` change; without this, dynamic branch handles rendered but
  real drag-connections could miss the new handle bounds. `scripts/verify-flow-designer-gui.mjs` now drags
  from `conditional-out-1` to create a second branch and deletes one branch to prove the survivor reverts to
  Normal.
- **Runtime validation:** `FlowDependencyResolver.validate()` mirrors Workflow Builder connector-structure
  rules for `ScenarioProfile.links` before execution: structured loop links must self-loop, multiple
  standard outgoing workflow links are blocked, and loop-controlled workflow flows may only exit via
  Conditional links.
- **Handoff resume:** `ManualHandoffController` now tracks pending promises and resolves Continue/Retry/
  Cancel. `StepExecutor` waits inside the live runner/browser; `ExecutionEngine` owns the shared controller,
  marks `waitingForManualAction` through live progress, keeps waiting instances active, exposes
  `retryHandoff`, and cancels pending handoffs on stop. `ProtectedLoginHandoffPanel` now offers Continue and
  maps Retry Detection to in-place retry instead of `repeatInstance`.
- **Files changed:** `src/orchestrator/FlowDependencyResolver.ts`, `src/runner/ManualHandoffController.ts`,
  `src/runner/StepExecutor.ts`, `src/runner/ExecutionEngine.ts`, `src/runner/RunnerProgress.ts`,
  `app/main/ipc/execution.ipc.ts`, `app/main/preload.ts`,
  `app/renderer/components/auth/ProtectedLoginHandoffPanel.tsx`,
  `app/renderer/pages/InstanceMonitor.tsx`,
  `app/renderer/components/workflow/ActionFlowNode.tsx`,
  `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `scripts/verify-runner.mts`,
  `scripts/verify-flow-designer-gui.mjs`, `resources/dependency-manifest.json`, `dist/**`, and AI docs.
- **Tests/verification:** `npx tsc --noEmit` clean; `npm run build` clean; `npm run verify:runner` **76/76**;
  `npm run verify:flow-designer` **18/18**; `npm run verify:workflow-builder` **13/13**;
  `npm run validate:offline` passed; `npm run package:portable` passed with strict offline validation;
  `npm run package:nsis` passed with strict offline validation.
- **Remaining external gate:** clean-machine offline GUI walkthrough in `docs/OFFLINE_STANDALONE_PACKAGING.md`
  still requires a separate offline Windows VM with no Node/global Playwright/global Chromium. Current
  artifacts for that walkthrough: `dist/WebFlow Studio 0.1.0.exe` and
  `dist/WebFlow Studio Setup 0.1.0.exe`.

---

## 2026-07-03 — Claude Code — /HANDOFF after connector-rules task

- **Task:** Ran `/HANDOFF` to prepare `docs/ai/HANDOFF.md` for the next agent/human after the connector
  two-port-pair rules task (entry below).
- **Repo state:** Git metadata unavailable (`git status` → "not a git repository"); changed files were
  inspected directly and are listed in `docs/ai/HANDOFF.md` → Files Changed.
- **Files changed:** `docs/ai/HANDOFF.md` (Active Task, Completed Work, Files Changed, Commands/Tests,
  Current State Summary, Remaining Work, Known Risks, Do-Not-Touch, Recommended Next Step all refreshed for
  the connector-rules task), `docs/ai/TASK_LOG.md` (this entry).
- **Verification:** `node scripts/ai-memory/check-memory.mjs` passed. No source changed, so build/GUI
  suites were not re-run (last green: build clean, `verify:runner` 70/70, `verify:flow-designer` 17/17,
  `verify:workflow-builder` 13/13).
- **Result:** `docs/ai/HANDOFF.md` is ready for the next agent. No active/blocked task remains.

## 2026-07-03 — Claude Code — Connector rules: loop panel-lock, conditional/parallel two-port pairs

- **Task:** Apply four connector rules (UI + backend) across both canvases: (1) Loop is never selectable
  from the properties panel (button-only); (2) loop has execution priority over other connector kinds;
  (3) conditional connectors are a **two-port pair** (exactly 2 same-kind right-side ports, each with its
  own aligned connector, both locked to conditional; removing one auto-reverts the survivor to Normal and
  collapses to one centered port); (4) same for parallel (both locked parallel; sequential-by-default
  execution, config kept). Confirmed the design via AskUserQuestion before building.
- **Shared model (`connectorStyle.ts` + `ConnectorPorts.tsx`):** source side is a single centered
  `normal-out` port by default; once a conditional/parallel connector leaves the node it switches to a
  **branch pair** — two same-kind ports `<kind>-out-0/1` (evenly centered), so each of the 2 connectors
  aligns to its own port (fixes the old single-shared-handle overlap where "only one connector worked").
  New: `branchSourceHandle`, `slotFromHandle`, `MAX_BRANCH_CONNECTORS=2`, `ConnectorPortFlags.sourceKind`,
  and `reconcileBranchConnectors(edges, { kindOf, slotAssign, toNormal, revertSources })` which slots each
  node's pair and reverts a lone survivor to normal.
- **Both canvases wired identically:** `onConnect` caps branch connectors at 2 + reconciles; the panel
  kind/type change reconciles; edge deletion (Delete key via a wrapped `onEdgesChange`, panel delete, and
  node deletion) reconciles with `revertSources` so a surviving lone pair-member reverts to Normal; load
  reconciles saved edges. Flow Designer `ConnectionPropertiesPanel` and the Workflow Builder inline Link
  Type panel: Loop option disabled (Rule 1), kind+type selects locked while conditional/parallel/loop, with
  explanatory helper text.
- **Backend unchanged (verified compatible):** `FlowExecutor` already runs the self-loop before parallel
  fan-out and `resolveNext` (Rule 2 satisfied), and parallel defaults to sequential shared-page execution
  (Rule 4). Branch-pair invariants are maintained by construction (the UI only exposes the current mode's
  ports), so `validateConnectorStructure`/structure-issue checks (kind-based) needed no change.
- **Files changed:** `app/renderer/components/shared/connectorStyle.ts`, `.../shared/ConnectorPorts.tsx`,
  `.../workflow/ConnectionPropertiesPanel.tsx`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/pages/ScenarioBuilder.tsx`. GUI harnesses extended: `scripts/verify-flow-designer-gui.mjs`
  (added conditional-pair checks; overlap-proof loop click). Docs: CURRENT_STATE, HANDOFF, KNOWN_ISSUES,
  this entry.
- **Tests run:** `npm run build` clean, `npm run verify:runner` 70/70, `npm run verify:flow-designer`
  **17/17** (incl. convert→2 aligned conditional ports `conditional-out-0/1` Δy=9.6, kind locked, delete
  reverts to one normal port), `npm run verify:workflow-builder` **13/13**.
- **Known gap:** the 2→1 survivor-revert (delete one of an existing pair) is verified by the reconcile
  logic + the delete-to-normal GUI path, but not by a GUI-drawn second connector (React Flow drag
  connections can't be driven headlessly). The Workflow Builder conditional-pair rendering uses the same
  shared components verified in the Flow Designer harness.

## 2026-07-03 — Claude Code — Workflow Builder connector GUI verification (closes the last loose end)

- **Task:** Narrow verification checkpoint — adapt the real-Electron GUI verification to the Workflow
  Builder canvas (the Flow Designer was already 13/13; Workflow Builder was the remaining un-walked
  surface). No new features unless a bug surfaced (none did).
- **Added:** `scripts/verify-workflow-builder-gui.mjs` + `npm run verify:workflow-builder` — launches the
  REAL built app (Playwright `_electron`, `ELECTRON_RUN_AS_NODE` cleared), navigates to the Workflow
  Builder, loads a saved workflow that has an edge (via the toolbar Workflow `<select>`), and drives the
  `.scenario-flow-node` connector UI.
- **Result: 13/13 GUI checks pass** on the user's saved workflows ("Mock — Data-Driven Workflow"): ports
  render un-clipped as card siblings (0 handles inside the `overflow:hidden` card, left/right on the node
  edges), Add Loop creates a visible edge, the top loop port becomes visible on the node's top edge, the
  loop draws as a **semicircle above** the node, the button toggles to Remove and deletes the edge (top
  port hides), and a loop node **locks its Link Type selector** (`selectDisabled=true`, conditional option
  stays enabled) — full parity with the Flow Designer.
- **Notes / gotchas found (no code changes needed):** (1) `ScenarioBuilder` starts with an empty canvas
  and loads `savedWorkflows[0]` (or the persisted selection) on mount — the script loads a workflow with
  edges via the toolbar select. (2) Loaded-workflow edge ids are the **saved link ids**, not
  `edge-<src>-<tgt>`, so the lock check gives every loopable node a self-loop (making any edge's source
  loop-controlled) and selects the remaining non-loop edge instead of parsing the source from the id.
- **Files changed:** `scripts/verify-workflow-builder-gui.mjs` (new), `package.json` (new
  `verify:workflow-builder` script). Docs: `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`,
  `docs/ai/COMMANDS.md`, `docs/ai/KNOWN_ISSUES.md`, this entry.
- **Tests run:** `npm run verify:workflow-builder` 13/13 (real Electron GUI). No source/behavior changed,
  so build/runner were not re-run (last known green: build clean, `verify:runner` 70/70,
  `verify:flow-designer` 13/13).
- **Result:** Both connector canvases (Flow Designer + Workflow Builder) are now GUI-verified in the real
  app. No bugs discovered during verification.

## 2026-07-03 — Claude Code — Fix npm run dev launch + real GUI walkthrough of Flow Designer connectors

- **Task:** Stop feature work; (1) fix the `npm run dev` Electron launch crash that blocked all prior GUI
  verification, then (2) perform a real GUI walkthrough of the Flow Designer connector UI.
- **Root cause of the "launch crash" (misdiagnosed by 3 prior sessions as a Node/Electron version
  mismatch):** the agent/sandbox environment exports **`ELECTRON_RUN_AS_NODE=1`**, which makes the
  Electron binary boot as plain Node.js — `require("electron")` returns the binary path string (no
  `app`/`BrowserWindow`), and the ESM main entry gets loaded by bare Node, producing the
  `esm/translators` `TypeError: …reading 'exports'` (and the `Node.js v20.18.3` trace = Electron's Node
  running as node). Confirmed via `env | grep -i electron`. Clearing the var lets the GUI window open.
- **Fix:** `npm run dev` now runs `node scripts/dev.mjs`, which deletes `ELECTRON_RUN_AS_NODE` from the
  child env before spawning `electron-vite dev` (no-op on normal machines). Explored switching the main
  process to CommonJS to dodge the ESM preparse, then **reverted** it — the ESM main launches fine once
  the env var is cleared, so the module format was never the problem (kept the diff minimal).
- **Real GUI walkthrough:** added `scripts/verify-flow-designer-gui.mjs` + `npm run verify:flow-designer`,
  which launches the REAL built app (Playwright `_electron`, env cleared) and drives the Flow Designer.
  **13/13 checks pass** on the user's actual saved "Chatgpt-Login-v1.1" flow / "Auto Secure Login" node:
  ports render un-clipped as card siblings (0 handles inside the `overflow:hidden` card, left/right on the
  node edges), Add Loop creates a visible edge, the top loop port becomes visible on the node's top edge,
  the loop draws as a **semicircle above** the node (pathTop < nodeTop), the button toggles to Remove and
  deletes the edge (top port hides), and a loop node **locks its outgoing connectors to Conditional** in
  the properties panel. This retroactively validates the prior loop-port UI task (previously code-only).
- **Files changed:** `package.json` (dev script → `node scripts/dev.mjs`; new `verify:flow-designer`),
  `scripts/dev.mjs` (new), `scripts/verify-flow-designer-gui.mjs` (new). Reverted mid-task (net no change):
  `electron.vite.config.ts`, `app/main/windowManager.ts`, `src/runner/BrowserContextFactory.ts`,
  `src/recorder/RecorderService.ts` (all back to original ESM/import form). Docs:
  `docs/ai/KNOWN_ISSUES.md`, `docs/ai/COMMANDS.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/HANDOFF.md`, this
  entry.
- **Tests run:** `npm run build` clean, `npm run verify:runner` 70/70, `npm run verify:flow-designer`
  13/13 (real Electron GUI), `npm run dev` launches the GUI window (4 electron.exe processes, no crash).
- **Result:** `npm run dev` fixed and root-caused; the Flow Designer connector UI is now **GUI-verified**
  in a running app — the outstanding "no GUI walkthrough" caveat from the last three tasks is cleared for
  the Flow Designer. (Workflow Builder connector UI shares the same components but was not separately
  GUI-walked this pass.)

## 2026-07-03 — Claude Code — Loop port UI fix: top loop port, semicircle self-loop, un-clip ports

- **Task:** Second GUI-driven bugfix pass on the same connector subsystem. User reported (after real GUI
  testing): (1) port/connector points render corrupted; (2) the "Add loop" button is broken — clicking it
  on `Auto Secure Login` doesn't visibly create a loop, and the loop can't be deleted; (3) a loop
  connector should attach to a **special loop port on top of the node** and draw as a **visible semicircle
  above** the node; (4) once a node has a loop, any new right-edge connector must be **Conditional only**.
- **Root causes found:** (1) The prior task added `position: relative` to `.action-flow-node` /
  `.scenario-flow-node`, which — combined with the pre-existing `overflow: hidden` — made those cards the
  offset parent for the React Flow `<Handle>` elements rendered *inside* them, so the edge-hugging handles
  (half outside the card box) were **clipped**. (2) Loop handles were invisible, co-located on the right,
  and gated behind `flags.loop` (only true *after* the edge exists → flaky attach); the self-loop arc
  bulged sideways where the node covered it, so it read as "not created / not deletable".
- **Fix:**
  - **Un-clip ports** — `ConnectorTargetPorts`/`ConnectorSourcePorts` are now rendered as *siblings* of
    the node `<article>` (in `ActionFlowNode`/`ScenarioFlowNode`), so React Flow positions them against
    the un-clipped `.react-flow__node` wrapper instead of the `overflow: hidden` card.
  - **Top loop port** — new `ConnectorLoopPort` renders a dedicated `loop-out`/`loop-in` handle pair on
    the node's **top** edge (slightly apart), always present (so the loop edge attaches immediately) but
    invisible/non-interactive until a loop exists (`.connector-port-loop.active`).
  - **Semicircle** — `SelfLoopEdge` now detects a self-loop via `source === target` (node identity, not
    coordinates) and draws a semicircle arcing **above** the node; distinct-node "curved" case unchanged.
  - **Reliable add/remove** — the node loop button is now an add/remove **toggle** (filled "active" state
    when a loop exists; `title` switches to "Remove loop connector"); `addLoop` guards against duplicates.
  - **Conditional-only on connect** — both canvases' `onConnect` now force the new connector's kind to
    `conditional` when the source node already has a self-loop (was only enforced by the properties-panel
    lock + save-time validation before).
- **Files changed:** `app/renderer/components/shared/ConnectorPorts.tsx`,
  `app/renderer/components/shared/SelfLoopEdge.tsx`, `app/renderer/components/shared/connectorStyle.ts`
  (doc comment only), `app/renderer/components/workflow/ActionFlowNode.tsx`,
  `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `app/renderer/pages/ScenarioBuilder.tsx`, `app/renderer/styles/global.css`. Docs:
  `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`, `docs/ai/HANDOFF.md`, this entry.
- **Tests run:** `npx tsc --noEmit` clean, `npm run build` clean, `npm run verify:runner` 70/70 (no
  regressions), `npm run validate:offline` passed (dev-mode warnings only). No `verify:flow-designer`
  script exists (prompt listed it speculatively). `npm run dev` still cannot launch here (Electron
  bundled-Node ESM/CJS crash — see `KNOWN_ISSUES.md`), so the **GUI walkthrough remains outstanding** —
  the rendered semicircle, top port visibility, and click/drag behavior are not visually confirmed.
- **Result:** Corrupted-port, invisible/undeletable-loop, and loop-shape bugs addressed in code and
  backend-verified. Backward compatible: loop edges keep the same `loop-out`/`loop-in` handle ids, so
  existing saved self-loops re-attach to the new top port automatically. GUI verification still pending.

## 2026-07-03 — Claude Code — Fix connector-port bugs found via manual GUI testing

- **Task:** A user manually tested the Flow Designer/Workflow Builder (the AWKIT points 1–5 connector
  work below was previously only typecheck/build-verified, never GUI-walked) and reported 3 bugs: (1)
  Loop kind connector always disabled, (2) new conditional/parallel/loop connectors' ports not
  functional + wrong position, (3) loop connector should auto-attach to its node in a circular/retry-icon
  shape. User confirmed via AskUserQuestion: loop creation should use a dedicated button (not
  drag-to-self), and extra ports should be evenly distributed centered on the node (not fixed offsets).
- **Root causes found:** (1) Loop kind was gated on `edge.source === edge.target`, achievable only by a
  fiddly manual self-drag — effectively unusable. (2) Both canvases' `onConnect` hardcoded every new
  connector to kind "normal"/linkType "success", ignoring `connection.sourceHandle`/`targetHandle`, so a
  drag from a conditional/parallel port silently created a normal connector. (3) Conditional/parallel
  ports were hardcoded to `top: 30%`/`70%` instead of centering as a group. (4) `portHandlesForKind
  ("loop")` reused the opposite-side `normal-out`/`normal-in` handles, so `SelfLoopEdge`'s same-point
  `isSelf` check never fired and a self-loop rendered as a giant arc instead of a tight circular shape.
- **Fix:** added a dedicated co-located `loop-out`/`loop-in` handle pair for loop connectors; added an
  "Add loop" button (small circular icon) on each node that creates the self-loop edge programmatically;
  added `connectorPortKindFromHandle()` so `onConnect` derives the new connector's kind from the dragged
  handle; added `portPositions(count)` to evenly space + center multi-port groups; extended
  `ConnectorPortFlags` with a `loop` flag.
- **Files changed:** `app/renderer/components/shared/connectorStyle.ts`,
  `app/renderer/components/shared/ConnectorPorts.tsx`, `app/renderer/components/workflow/
  ActionFlowNode.tsx`, `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `app/renderer/pages/
  FlowChartDesigner.tsx`, `app/renderer/pages/ScenarioBuilder.tsx`, `app/renderer/styles/global.css`.
  Docs: `docs/ai/CURRENT_STATE.md`, `docs/ai/KNOWN_ISSUES.md`, `docs/ai/HANDOFF.md`, this entry.
- **Tests run:** `npx tsc --noEmit` clean, `npm run build` clean, `npm run verify:runner` 70/70 (no
  regressions). `npm run dev` **could not run** — Electron crashes on launch with a Node ESM/CJS
  translator error before any app code runs (trace reports Electron's own bundled Node v20.18.3; system
  Node here is 18.16.0, matching `docs/ai/COMMANDS.md`) — new environment finding, logged in
  `docs/ai/KNOWN_ISSUES.md`. No manual GUI walkthrough was possible as a result — the click/drag
  interactions and rendered arc/port positions are not visually confirmed.
- **Result:** Bugs fixed in code and backend-verified; GUI walkthrough still outstanding (second
  consecutive task on this subsystem to land without one — flagged clearly in `KNOWN_ISSUES.md` and
  `HANDOFF.md`).

## 2026-07-03 — Claude Code — /HANDOFF prepared after connector structure rules task

- **Task:** Ran `/HANDOFF` to close out the AWKIT connector-structure task (points 1–5, see the entry
  directly below) and prepare `docs/ai/HANDOFF.md` for the next agent.
- **Files changed:** `docs/ai/HANDOFF.md` (filled in Current Handoff with completed work, files changed,
  commands/tests run, remaining work, known risks, recommended next step), `docs/ai/TASK_LOG.md` (this
  entry).
- **Verification:** Git metadata unavailable in this checkout (`git status`/`git diff` both fail with
  "not a git repository") — recorded in `docs/ai/HANDOFF.md` instead of git output. `node
  scripts/ai-memory/check-memory.mjs` passed.
- **Result:** `docs/ai/HANDOFF.md` is ready for the next agent. No active/blocked task remains.

## 2026-07-03 — Claude Code — Connector structure rules (AWKIT points 1–5)

- **Task:** Implement 5 connector-structure enhancements to the Flow Designer + Workflow Builder, in order:
  (1) dynamic conditional/parallel ports, (2) prevent duplicate standard outgoing connectors, (3) loop
  connectors force additional connectors to Conditional, (4) loop connectors must be self-loops
  (source === target), (5) curved/circular connector shape option.
- **Files changed:** `src/profiles/FlowProfile.ts` (circular shape, `validateConnectorStructure`),
  `src/runner/FlowExecutor.ts` (self-loop execution model + runtime structure guard),
  `app/renderer/components/shared/connectorStyle.ts` (`portHandlesForKind`, `computePortFlags`, circular
  shape default for loop), `app/renderer/components/shared/ConnectorStyleEditor.tsx` (circular option),
  `app/renderer/styles/global.css` (port + self-loop label CSS), `app/renderer/components/workflow/
  ActionFlowNode.tsx`, `app/renderer/components/workflow/flowDesignerTypes.ts` (`portFlags`),
  `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` (kind-lock UI for points 3/4),
  `app/renderer/pages/FlowChartDesigner.tsx` (ports/edgeTypes/validation/save-gating),
  `app/renderer/components/scenario/ScenarioFlowNode.tsx`, `app/renderer/components/scenario/
  scenarioDesignerTypes.ts` (`portFlags`), `app/renderer/pages/ScenarioBuilder.tsx` (ports/edgeTypes/
  validation/save-gating, `scenarioEdgeKind`), `scripts/verify-runner.mts` (self-loop test fixtures + 2 new
  structural-safeguard tests).
- **Files added:** `app/renderer/components/shared/ConnectorPorts.tsx`, `app/renderer/components/shared/
  SelfLoopEdge.tsx`.
- **Verification:** `npx tsc --noEmit` clean; `npm run build` clean; `npm run verify:runner` → 70/70 (was
  68/68 — 2 new structural-safeguard tests, 3 loop tests rewritten for the self-loop model);
  `npm run validate:offline` passed (dev-mode warnings only). `npm run verify:flow-designer` does not exist
  — not run (per `docs/ai/COMMANDS.md`).
- **Result:** All 5 points implemented on both canvases. Loop connectors are now self-loop-only at both
  save-time (UI) and run-time (`FlowExecutor`); the legacy `loopBack` edge type is explicitly exempt.
  Ports/shape are derived at render time, no `FlowEdge`/`WorkflowEdge` schema change. **Not done:** GUI
  walkthrough of the port/self-loop visuals (no dev server run in this session — see `docs/ai/
  CURRENT_STATE.md`); Workflow Builder has no runtime-engine equivalent to `FlowExecutor`, so its structural
  safeguard is UI-only (documented in `docs/ai/KNOWN_ISSUES.md`).

## 2026-07-02 — Codex — Generic agent handoff/takeoff memory workflow

- **Task:** Add automated generic handoff and takeoff workflows to the AI memory system for Claude Code,
  Codex, Gemini, Antigravity, future agents, and human developers.
- **Files added:** `docs/ai/HANDOFF.md`, `.claude/commands/HANDOFF.md`,
  `.claude/commands/TAKEOFF.md`, `.gemini/commands/HANDOFF.toml`, `.gemini/commands/TAKEOFF.toml`,
  `.agents/skills/agent-handoff/SKILL.md`, `.agents/skills/agent-takeoff/SKILL.md`,
  `.agents/workflows/HANDOFF.md`, `.agents/workflows/TAKEOFF.md`.
- **Files changed:** `AGENTS.md`, `.claude/skills/ai-memory-maintainer/SKILL.md`,
  `.agents/skills/ai-memory-maintainer/SKILL.md`, `.agents/workflows/update-memory.md`,
  `.gemini/commands/ai-memory.toml`, `scripts/ai-memory/check-memory.mjs`,
  `docs/ai/DEVELOPMENT_WORKFLOW.md`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `node scripts/ai-memory/check-memory.mjs` passed.
- **Result:** Generic handoff/takeoff workflow added; `HANDOFF.md` is now part of the required memory set.

---

## 2026-07-02 — Claude Code — True concurrent parallel branches (opt-in isolated pages)

- **Task:** Add real concurrency for parallel connectors, gated behind explicit isolation config (per the
  spec's "require explicit isolation configuration"). `sharedPage` (default) stays sequential fan-out;
  `isolatedPage` runs branches concurrently, each on its own page in the shared browser context (shared
  cookies/session, independent DOM), bounded by `maxConcurrency`.
- **Files changed:**
  - `src/profiles/FlowProfile.ts` — `ParallelConnectorConfig.isolation` (sharedPage/isolatedPage); documented `maxConcurrency`.
  - `src/runner/FlowExecutor.ts` — `IsolatedBranchExecutor`/`ParallelBranchFactory` types; `branchExecutorFactory`
    constructor arg; `executeParallelIsolated` (bounded-concurrency batches, join/fail applied to collected results).
  - `src/runner/PlaywrightRunner.ts` — provides the branch factory (new page in the shared context + its own StepExecutor, closed after).
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — Execution (isolation) selector + Max concurrency field.
- **Tests:** `scripts/verify-runner.mts` +1 (isolated concurrent branches each run on their own page). → **68/68**.
- **Verification:** `npm run build` clean; `npm run verify:runner` → 68/68; `npm run validate:offline` passes; `npm run ai:memory` ✅.
- **Semantics note:** isolated `failFast` reports failure after branches settle (no hard-abort of in-flight branches);
  `waitAny` succeeds if ≥1 branch passes.

---

## 2026-07-02 — Claude Code — Connector polish: loop data-source dropdown + live-report connector events

- **Task:** Two follow-ups after checkpoint B. (1) Loop connector `dataSource` mode: pick a specific data
  source from a dropdown (or default to the workflow data source) with an optional row-key binding; runner
  honors `LoopConnectorConfig.dataSourceId`. (2) Surface connector events in the Live Report timeline.
- **Files changed:**
  - `src/runner/FlowExecutor.ts` — `progress?` constructor arg + `emitConnectorEvent()`; emits on structured
    conditional match, parallel fan-out, loop iteration, and Auto Secure Login restart; `resolveLoopValues`
    honors `dataSourceId`.
  - `src/runner/PlaywrightRunner.ts` — passes `this.options.progress` into `FlowExecutor`.
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — `dataSources` prop; loop dataSource
    dropdown + optional row key.
  - `app/renderer/pages/FlowChartDesigner.tsx` — passes `dataSources` to the connection panel; relaxed loop
    dataSource validation (row key optional).
- **Tests:** `scripts/verify-runner.mts` +1 (connector events reach the progress reporter). → **67/67**.
- **Verification:** `npm run build` clean; `npm run verify:runner` → 67/67; `npm run validate:offline` passes;
  `npm run ai:memory` ✅.

---

## 2026-07-02 — Claude Code — Structured connector model (checkpoint B of the AWKIT connectors/sessions spec)

- **Task:** The "full structured connector replacement" the user chose: a `kind`-based connector model with
  structured Conditional/Parallel/Loop configs across types, execution engine, designer UI, validation, and tests.
  Backward compatible — legacy edges keep executing via the expression paths.
- **Files added:** `src/runner/ConnectorConditionEvaluator.ts` (operators + sourceField resolution).
- **Files changed:**
  - `src/profiles/FlowProfile.ts` — `ConnectorKind`, `ConnectorConditionOperator`, `ConnectorConditionSource`,
    `ConditionalConnectorConfig`, `ParallelConnectorConfig`, `LoopConnectorConfig`; `FlowEdge.kind/conditional/
    parallel/loop`; `connectorKind()` helper.
  - `src/runner/RunnerResult.ts` — `StepExecutionResult.errorCode`.
  - `src/runner/FlowExecutor.ts` — structured conditional routing (priority) in `resolveNext`; parallel
    join/fail modes in `executeParallelTargets`; loop-connector execution (`executeLoopConnector` +
    `resolveLoopValues`, count/staticList/dataSource/whileCondition, param injection via runtimeInputs,
    `LOOP_CONNECTOR_HARD_CAP`).
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — `FlowConnectionData` gains
    kind/conditional/parallel/loop; kind selector + per-kind property fields.
  - `app/renderer/pages/FlowChartDesigner.tsx` — `createEdge` `extra`; `toFlowProfile`/`loadProfile`
    round-trip kind + configs; `validateFlow` connector checks (expected value, variable, loop bounds,
    ambiguous same-priority conditionals).
- **Tests:** `scripts/verify-runner.mts` +8 (conditional priority, conditional no-match safe stop, parallel
  waitAny, parallel failFast, parallel collectErrors, loop count, loop staticList, loop whileCondition).
- **Verification:** `npm run build` clean; `npm run verify:runner` → **66/66**; `npm run validate:offline`
  passes; `npm run ai:memory` ✅.
- **Not done (remaining):** true concurrent parallelism (still sequential fan-out), loop over multi-node
  branches (single target node only), dataSource-loop UI dropdown (binding is a text field), reporting/runtime
  connector events, GUI walkthrough, live real-Chrome capture.

---

## 2026-07-02 — Claude Code — Session registry + node behaviors (checkpoint A of the AWKIT connectors/sessions spec)

- **Task:** First checkpoint of the larger "Auto Secure Login / Reuse Session / smart connectors" spec.
  Decisions confirmed with user: **full structured connector replacement** (deferred to checkpoint B),
  **keep `SessionCaptureService`** (dedicated automation profile dir, AWKIT sessions dir), **both** restart
  mechanisms (engine counter + loopBack edge), **phased delivery**. This checkpoint = the additive,
  lower-risk session/node behaviors.
- **Files added:** `src/session/sessionMatch.ts` (`normalizeOrigin`, `profileOrigin`, `sessionMatchesUrl`,
  `findBestSessionForUrl`).
- **Files changed:**
  - `src/session/SessionProfile.ts` — `origin`, `loginUrl`, `source` fields.
  - `src/session/SessionCaptureService.ts` — compute `origin`/`loginUrl`/`source` on capture (`startCapture`
    gains optional `source`); backfill `origin`/`source` for legacy profiles in `list()`.
  - `src/runner/RunnerResult.ts` — `StepExecutionResult.outcome` + `restartRequired`.
  - `src/runner/StepExecutor.ts` — Auto Secure Login now matches by normalized origin, tags capture source,
    sets `outcome`/`restartRequired`; Reuse Session gains **auto-detect** (origin) vs **selected** modes and
    sets `outcome`; threads `outcome`/`restartRequired` through `execute()`.
  - `src/runner/FlowExecutor.ts` — engine-level Auto Secure Login restart guard (`MAX_AUTO_LOGIN_RESTART = 1`)
    that restarts from Start on `restartRequired` and fails safely on exhaustion.
  - `src/profiles/FlowProfile.ts` — `NodeConfig.reuseSessionMode`.
  - `app/renderer/components/workflow/flowDesignerTypes.ts` — `reuseSessionMode` field + default.
  - `app/renderer/pages/FlowChartDesigner.tsx` — map `reuseSessionMode` (+ only persist `reuseSessionId` in selected mode).
  - `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx` — Reuse Session mode selector + auto-detect URL / selected dropdown.
  - `app/renderer/pages/SessionsManager.tsx` — Source column + origin subtitle + search over origin/source.
  - `.gitignore` — ignore `sessions/`, `profiles/`, `session-profiles.json`, `*.storageState.json`.
- **Tests:** `scripts/verify-runner.mts` +5 (normalized-origin match, auto-detect find, auto-detect no-match,
  engine restart-then-complete, restart-guard exhaustion). Updated the selected-mode "no id" test.
- **Verification:** `npm run build` clean; `npm run verify:runner` → **58/58**; `npm run validate:offline`
  passes; `npm run ai:memory` ✅.
- **Not yet done (later checkpoints):** full structured connector-config model (Conditional/Parallel/Loop
  configs, designer UI, validation, execution — checkpoint B), reporting/runtime events, GUI walkthrough,
  live real-Chrome capture.

---

## 2026-07-02 — Claude Code — Enhanced Connectors + Auto Secure Login + Reuse Session (Phases 1–3)

- **Task:** Three-phase feature set. Phase 1: enhanced flow connectors (new `outcome`, `loopBack`,
  `parallel` edge types + `maxLoopCount`). Phase 2: `autoSecureLogin` node (capture manual login in real
  Chrome mid-run, then resume automation). Phase 3: `reuseSession` node (load a saved session profile
  mid-run). Reviewed all three prompt specs against the live code first; the prompts' code was
  illustrative — several signatures (preload `session.*` not `sessions.*`, positional `StepExecutor`
  ctor, `resolveStepValue`) were adapted.
- **Phase 1 files changed:**
  - `src/profiles/FlowProfile.ts` — `FlowEdgeType` += `outcome`/`loopBack`/`parallel`; `FlowEdge.maxLoopCount`.
  - `src/profiles/ScenarioProfile.ts` — `ScenarioLink.type` union synced.
  - `src/runner/FlowExecutor.ts` — rewired routing: `resolveNext()` (outcome edges via `${stepResult.*}`
    scope, conditional, conditional/unconditional loopBack gated by `maxLoopCount`); loopBack-aware cycle
    guard that clears `visited` only on a taken back-edge and **falls through to success/always on
    exhaustion** (no cycle error); `executeParallelTargets()` sequential fan-out.
  - `src/runner/PlaywrightRunner.ts` — `chooseNextFlow` now checks `outcome` links before `conditional`.
  - `app/renderer/components/shared/connectorStyle.ts` — colors + animate/dash for new types.
  - `app/renderer/components/workflow/ConnectionPropertiesPanel.tsx` — new options, outcome/loopBack
    expression inputs, `maxLoopCount` input; `FlowConnectionData.maxLoopCount`.
  - `app/renderer/pages/FlowChartDesigner.tsx` — `createEdge`/`toFlowProfile` serialize `maxLoopCount`.
  - `app/renderer/pages/ScenarioBuilder.tsx` — workflow edge-type dropdown extended.
- **Phase 2–3 files changed:**
  - `src/profiles/FlowProfile.ts` — `StepType` += `autoSecureLogin`/`reuseSession`; `NodeConfig.reuseSessionId`.
  - `src/runner/StepExecutor.ts` — `BrowserRestarter` type; ctor gains positional `browserRestarter` +
    `sessionService`; public `setActivePage`; `executeAutoSecureLogin` + `executeReuseSession`.
  - `src/runner/PlaywrightRunner.ts` — mutable `BrowserHolder` + `restartBrowser` callback (close-only /
    relaunch with `persistentContext` + new `userDataDir`, re-points the live executor's page);
    `sessionService` option threaded to `StepExecutor`; save/restore active executor across child flows.
  - `src/runner/ExecutionEngine.ts` — injects `getSessionService()` into `PlaywrightRunner`.
  - `app/renderer/components/workflow/flowNodeCatalog.ts` — `autoSecureLogin` (ShieldCheck) + `reuseSession` (History).
  - `app/renderer/components/workflow/flowNodeRegistry.ts` — META + new `reuseSession` section.
  - `app/renderer/components/workflow/flowDesignerTypes.ts` — `reuseSessionId` field + default.
  - `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx` — session-list fetch + `SearchableSelect`.
  - `app/renderer/pages/FlowChartDesigner.tsx` — `reuseSessionId` in `toNodeConfig`/`fromFlowStep`.
- **Tests:** `scripts/verify-runner.mts` +9 cases (multi-conditional first-match, outcome routing,
  loopBack max=2/max=1, parallel fan-out, autoSecureLogin skip/capture, reuseSession load/missing).
- **Verification:** `npm run build` clean; `npm run verify:runner` → **53/53** (was 44); `npm run
  validate:offline` passes. Not run: clean-machine GUI walkthrough; live real-Chrome capture (mocked in tests).
- **Result:** ✅ All three phases implemented, backward compatible, offline-first preserved.

---

## 2026-07-01 — Gemini — Session Capture Browser (manual login without automation detection)

- **Task:** Implement a Session Capture Browser feature that launches the user's real system Chrome/Edge
  (not Playwright's Chromium) so they can manually log into protected sites (Google, Microsoft,
  Cloudflare-gated) without being blocked by automation detection. After login, the session is saved
  for reuse in automation runs via `launchPersistentContext`.
- **Files added:**
  - `src/session/SessionProfile.ts` — types: `SessionProfile`, `SessionCaptureStatus`, `DetectedBrowser`.
  - `src/session/SessionCaptureService.ts` — core service: system Chrome/Edge detection (Windows paths),
    named profile directory management under `%LOCALAPPDATA%/WebFlow Studio/profiles/`, browser launch
    via `child_process.spawn --user-data-dir`, process monitoring, profile CRUD + metadata persistence.
  - `app/main/ipc/session.ipc.ts` — 9 IPC handlers (`session:list/startCapture/getStatus/delete/rename/
    detectBrowser/stopCapture/getById/markUsed`) + `getSessionService()` export.
  - `app/renderer/pages/SessionsManager.tsx` — full UI: browser detection banner, capture form with
    active-capture status, saved sessions table with rename/delete/open-folder, search + pagination.
- **Files changed:**
  - `app/main/ipc/index.ts` — register `registerSessionIpc()`.
  - `app/main/preload.ts` — add `session.*` namespace to the `playwrightFlowStudio` API.
  - `src/instances/InstanceConfig.ts` — add `sessionProfileId?: string`.
  - `app/main/ipc/execution.ipc.ts` — add `sessionProfileId` to `RunWorkflowRequest`, add
    `resolveInstanceTemplate()` that resolves profiles to `userDataDir + persistentContext`.
  - `src/instances/InstanceManager.ts` — prefer template `userDataDir` over per-instance generated path.
  - `app/renderer/routes.tsx` — add `sessions` route with `KeyRound` icon.
  - `app/renderer/layout/LeftNavigation.tsx` — add `sessions` to Data nav group.
  - `docs/ai/CURRENT_STATE.md` — document the new feature.
- **Tests run:** `npm run build` ✅ (tsc --noEmit + electron-vite); `npm run verify:runner` ✅ 44/44.
- **Tests not run:** `npm run validate:offline` (no resources/ or manifest touched); clean-machine GUI
  walkthrough (human/VM step). Live capture flow requires a running Electron app.
- **Result:** Feature fully implemented. Users can capture manual login sessions from a real Chrome/Edge
  browser and reuse them in automation runs. No automation detection triggered.

---

## 2026-07-01 — Claude Code — Investigation: manual/protected-login handoff dead-ends (no code change)

- **Trigger:** User's `Chatgpt-Workflow` instance paused on a "Protected login — action required" card
  with Provider/Reason/URL = unknown/—.
- **Findings (evidence-based, no code changed):**
  - The workflow runs one flow `flow-96138dff` (`Chatgpt-Login-v1.1`): Start → goto chat.openai.com →
    click → click "Log in" → **Manual Handoff** → End. The pause is that deliberate `manualHandoff` node.
  - `PlaywrightRunner.executeScenario` returns on `manualHandoff` (`:103-104`) and its `finally` closes
    the browser (`:130-131`), so the automation browser is gone when the card appears.
  - Instance Monitor handoff card: **Retry Detection → `repeatInstance`** (full re-run in a fresh
    context), **Cancel Run → `stopInstance`**. No in-place resume exists, so the flow can never get past
    the handoff. The `manualHandoff → saveSession` pattern in `flow-0a526377` is unreachable too.
  - UX gaps: `ProtectedLoginHandoffPanel` hardcodes the "Protected login" header for plain manual
    handoffs and shows `unknown/—` with no detection detail.
- **Files changed:** docs only — `KNOWN_ISSUES.md`, `CURRENT_STATE.md`, `TASK_LOG.md`.
- **Tests run:** none (documentation-only). **Result:** confirmed bug recorded; fix (keep browser open
  across a handoff + real Continue/resume) not yet implemented — awaiting user direction.

---

## 2026-07-01 — Claude Code — Recorder generates unique, Playwright-safe locators + runner safeguard

- **Task:** Fix the Recorder so it captures unique, Playwright-safe locators instead of generic
  utility-class selectors (e.g. `div.flex.items-center.justify-center`) that fail Playwright strict mode.
- **Files added:**
  - `src/recorder/recorderInitScript.ts` — self-contained DOM capture script (`installRecorderCapture`
    + `getRecorderInitScriptContent`): ranked candidate generation (role/label/placeholder/text/testId →
    stable attributes → id → scoped → positional fallback; never utility classes), live-DOM uniqueness
    validation, `LocatorQuality` metadata, human-readable step names, password-value masking.
  - `scripts/verify-recorder-locator.mts` — live Playwright verification (23 checks).
- **Files changed:**
  - `src/profiles/FlowProfile.ts` — new `LocatorQuality` type; `FlowStep.locator` gains `exact?`/`quality?`.
  - `src/recorder/RecorderTypes.ts` — `RecordedActionLocator` gains `exact?`/`quality?`.
  - `src/recorder/RecorderService.ts` — inject shared capture script via `addInitScript({ content })`;
    removed the old inline class-list locator logic.
  - `app/main/ipc/recorder.ipc.ts` — copy `exact`/`quality` onto saved `FlowStep.locator`.
  - `src/runner/LocatorFactory.ts` — honor `locator.exact` for role/text/label/placeholder.
  - `src/runner/StepExecutor.ts` — `guardLocatorQuality` (fail non-unique steps early) +
    `friendlyLocatorError` (translate strict-mode violations; raw error stays in logs).
  - Flow Designer: `flowDesignerTypes.ts` (+`locatorExact`/`locatorQuality`), `FlowChartDesigner.tsx`
    (round-trip + flow-level validation message), `FlowNodePropertiesPanel.tsx` (quality readout, exact
    toggle, clears stale quality on manual edits, validation message), `global.css` (`.locator-quality`).
  - `package.json` (+`verify:recorder`).
- **Tests run:** `npm run build` ✅ (tsc + bundles); `npm run verify:recorder` ✅ 23/23;
  `npm run verify:runner` ✅ 44/44 (regression check after LocatorFactory/StepExecutor edits).
- **Tests not run:** `npm run validate:offline` (PowerShell packaging validation — unrelated to this
  change; no `resources/` or manifest touched); clean-machine offline GUI walkthrough (human/VM step).
- **Result:** Recorder now saves unique semantic locators with quality metadata; designer surfaces
  non-unique locators; runner fails ambiguous steps with a friendly message. Backward compatible
  (all new fields optional; legacy flows load and run unchanged).

---

## 2026-07-01 — Claude Code — Recorder auto-captures visited URLs + Recorded URLs table

- **Task:** Automatically save URLs visited during a recording session and show them in a searchable,
  paginated table at the bottom of the Recording screen.
- **Capture:** `RecorderService` listens to main-frame `framenavigated` on the initial page and any tab the
  site opens (`context.on("page")`); records `{ id, url, title?, timestamp, source, sessionId }`. Sensitive
  query values (token/access_token/refresh_token/id_token/code/password/secret/session/auth/key/api_key)
  are masked to `***` **before storage** (`maskUrl`). Consecutive identical URLs within 1.5s are deduped;
  later revisits are kept. First URL = `manual_url_entry`, others = `navigation`. Session-scoped in memory,
  like recorded actions (start/cancel clear, stop keeps).
- **Wiring:** new `recorder:getUrls` IPC + `recorder.getUrls()` preload; `RecordedUrl` type in
  `RecorderTypes.ts`.
- **UI:** `Recorder.tsx` polls `getUrls` (500ms while recording + on mount + after stop) and renders a
  "Recorded URLs" table using the system table classes (`wl-table`, `table-search`, `DataTablePagination`,
  `TableEmptyState`): columns Time / Title / URL / Source / Session / Actions (copy). Case-insensitive
  search over url/title/source/session, resets to page 1; page sizes 10/25/50/100; newest-first; long URLs
  truncate with a full-value tooltip (`table-layout: fixed`). Empty + no-match states included.
- **Preserved:** existing recorder start/stop/cancel/getActions and Save to Flow Library unchanged.
- **Tests:** `npm run build` ✅; `npm run validate:offline` ✅. No `verify:recorder` script exists. GUI
  capture flow needs manual verification (headed browser). check-memory below.

---

## 2026-07-01 - Codex - Live Execution Report process-flow UI/UX fix

- **Task:** Improve the Live Execution Report modal, especially Flows & Steps, and fix the terminal
  "Updated" counter behavior.
- **Files changed:** `app/renderer/components/instances/LiveExecutionReportModal.tsx`,
  `app/renderer/components/instances/executionReportModel.ts`, `app/renderer/styles/global.css`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/FEATURES.md`, `docs/ai/TASK_LOG.md`.
- **UI/UX:** Replaced the static step-card grid with a connected horizontal process flow, numbered nodes,
  status icons/badges, active/waiting/manual-action animation, and a real progress bar based on visible
  step statuses. Narrow layouts keep the flow horizontally scrollable.
- **Failure handling:** Failed nodes now show friendly user-facing copy in the main UI; masked technical
  error detail is available only via hover/focus tooltip.
- **Timer/polling:** Modal report polling now runs only while the instance is live, with cleanup on close
  or unmount and one delayed final fetch after terminal transition. Terminal runs show a stable final
  update timestamp instead of an endlessly increasing relative "Updated" counter.
- **Tests:** `npm run build` passed; `npm run verify:instance-monitor` passed 22/22. Runner/offline
  verification not run because no runner/orchestrator/offline behavior changed. GUI walkthrough not run.

---

## 2026-06-27 — Claude Code — True live per-flow/per-step progress for the Execution Report

- **Runner progress events:** new `src/runner/RunnerProgress.ts` (`RunnerProgressReporter`,
  `RunnerProgressEvent`, bounded `LiveExecutionSnapshot`). `StepExecutor` takes an optional 8th
  `progress` reporter and emits `running` at step start and `succeeded`/`failed`/`waitingForManualAction`
  at step end (incl. the protected-login auto-pause). Threaded via `PlaywrightRunnerOptions.progress` →
  `StepExecutor` (existing call sites/tests unaffected — param is optional).
- **Bounded live snapshot in runtime state:** `InstanceRuntimeState.liveProgress?: LiveExecutionSnapshot`.
  `ExecutionEngine.createProgressReporter` folds step events into a snapshot (current flow/step, per-step
  states, recent events) capped at 500 steps / 200 events, resolves flow labels, and writes it to the pool
  (also live-updates the table's Current Flow/Step) — so the renderer's existing 1s poll shows live
  progress. No secrets stored.
- **Renderer:** `executionReportModel.buildLiveExecutionReport` now builds **per-step** node cards +
  timeline + stats from `instance.liveProgress` while running, from the stored report once finished, and
  falls back to the coarse per-flow map otherwise. Modal shows the active step pulsing, the flow label per
  card, and a live-updating timeline (`reports.get` still enriches/loads the final report; warning kept if
  it fails).
- **Compatibility:** final report + JSONL generation and workflow execution behavior unchanged; live and
  final share the same step statuses.
- **Tests:** `npm run build` ✅, `npm run verify:runner` ✅ 44/44, `npm run verify:instance-monitor` ✅
  22/22, `npm run validate:offline` ✅. check-memory below.

---

## 2026-06-27 — Claude Code — Live human-readable Execution Report modal (replaces JSONL button)

- **Instances table button:** the Files column's Logs (open-JSONL) button is replaced with a **Live Report**
  button (Activity icon, always enabled); the Screenshots button is kept. JSONL/report file generation is
  untouched — only the user-facing button changed.
- **New components:** `app/renderer/components/instances/executionReportModel.ts` (pure adapter +
  `LiveExecutionReport` types) and `LiveExecutionReportModal.tsx` (modal reusing `.modal-overlay`).
- **Data sources (no runner change):** banner/heartbeat from the live polled `InstanceRuntimeState`
  (status, currentStep, started, elapsed, manualHandoff); per-flow node map + step stats + timeline from
  the stored report (`reports.get(executionId)` → `InstanceReport.scenarioResult.flows[].steps[]` +
  `logs[]`). Added `reports.get` to preload (existing `reports:get` IPC). The modal refreshes the report
  every 3s while open so it fills in when the run completes.
- **UI/UX:** summary banner with status pill + animated heartbeat + "Running… waiting…" activity line;
  node-map cards with status colors and a pulse animation on the active/running/waiting node; statistics
  cards (total/completed/failed/pending/running, success rate, elapsed, avg/longest step, screenshots,
  errors — unavailable metrics show "Not available"); human-readable activity timeline from masked log
  messages (never raw JSON). Loading/empty states included. CSS-only animations.
- **Tests:** `npm run build` ✅, `npm run verify:instance-monitor` ✅ 22/22, `npm run validate:offline` ✅.
  No runner/report-generation files changed. check-memory below.

---

## 2026-06-27 — Claude Code — Recorder save feedback + Node Palette search-bar layout fix

- **Recorder "Save to Flow Library" feedback:** `Recorder.tsx` now shows clear success/failure feedback —
  shared `Toast` ("Flow saved to library successfully: <name>" / "Failed to save flow to library. Please
  try again. (<detail>)") plus an inline status banner in the Save Options panel. Added an `isSaving`
  pending guard (early-return + disabled button + "Saving…" label) so duplicate clicks can't corrupt the
  save. Existing save behavior/data unchanged; backend error message surfaced safely.
- **Node Palette search bar corruption:** root cause — the expanded `.flow-node-palette` is a CSS grid with
  `grid-template-rows: auto minmax(0, 1fr)` (two rows: head + scroll), but a third child (`.palette-search`)
  was added between them, so the search input landed in the `1fr` row and stretched tall while the list
  lost its scroll row. Fixed to `grid-template-rows: auto auto minmax(0, 1fr)` (head / search / scroll).
  Filtering/clear/drag-drop behavior unchanged (CSS-only fix).
- **Tests:** `npm run build` ✅ (tsc --noEmit + bundles). No `lint`/`test` npm scripts exist. check-memory below.

---

## 2026-06-27 — Claude Code — Protected Login Handoff (detect + pause + node + UI + OAuth foundation)

- **Detector (Task 01):** `src/security/ProtectedLoginDetector.ts` — pure `detectFromSignals(url,title,body)`
  + live `detectProtectedLogin(page)`. Flags provider URLs (Google/Microsoft/Okta/Auth0/Duo) and text
  signals (Google "browser may not be secure", "couldn't sign you in", CAPTCHA/"verify you are human"/
  "just a moment", MFA/2-step/authenticator, security check). Conservative: body text only scanned when
  URL/title is suspicious → no false positives on normal pages. Never reads/returns secrets.
- **Runner pause (Task 02):** `StepExecutor` auto-runs detection after goto/click/routeChange/wait; on
  detection it pauses via `ManualHandoffController` and returns `manualHandoff` + a `HandoffInfo`
  (`src/security/ProtectedLoginHandoff.ts`). Threaded through `FlowExecutor`/`PlaywrightRunner` results;
  `ExecutionEngine.runInstance` maps `manualHandoff` → `waitingForManualAction` with the detail, and the
  queue treats waiting as run-complete (no infinite loop; report still writes).
- **Node (Task 03):** new `protectedLoginHandoff` StepType + palette item + `protectedLogin` properties
  section (provider, handoff mode, instructions, detect-first, allow-retry, timeout). Validation surfaces
  capability notes (OAuth/saved/test-session unsupported) and requires instructions for pause-and-ask.
- **UI (Task 04):** `components/auth/ProtectedLoginHandoffPanel.tsx` in the Instance Monitor shows paused
  instances with provider/reason/URL + **Cancel Run** (stopInstance) and **Retry Detection**
  (repeatInstance); saved/test/OAuth actions shown disabled-with-reason unless supported.
- **OAuth foundation (Task 05):** `src/auth/OAuthHandoffService.ts` + `app/main/ipc/auth.ipc.ts` +
  preload `auth.*`. Capability-gated (env `WFS_OAUTH_*`); uses `shell.openExternal`; no fake tokens/success.
- **Sessions (Task 06):** Load Session not implemented → "Use Saved Session"/"Use Test Session" disabled
  with clear reasons. No third-party cookie extraction.
- **Docs (Task 07):** `docs/PROTECTED_LOGIN_HANDOFF.md`.
- **Verification (Task 08):** new `npm run verify:protected-login` (16/16, pure detector) + `verify:runner`
  extended (44/44, node pauses + auto-detect doesn't pause mock pages).
- **Tests:** `npm run build` ✅, `verify:runner` ✅ 44/44, `verify:protected-login` ✅ 16/16,
  `validate:offline` ✅, `verify:instance-monitor` ✅ 22/22, check-memory below.

---

## 2026-06-27 — Claude Code — Save Session node, flow row-open, shared connectors + style, palette/dropdown search

- **Task 01 — Save Session node:** new `saveSession` StepType. `StepExecutor.saveSession` writes Playwright
  `storageState` (cookies + localStorage/origins) to `<runtimeRoot>/sessions/<name>.json` (context.paths.sessions,
  set in `ExecutionEngine.runInstance` to `<dirs.root>/sessions`). Config: `sessionName`, `sessionFolder`,
  `overwriteSession`, `captureScope` (context | origin), `maskSession`. Validates required+file-safe name,
  writable folder, no-overwrite collision; logs only the path (never cookie/token values). Catalog + registry
  `session` section + properties UI added. `verify:runner` covers it (41/41, +4).
- **Task 02 — Flows row click → Flow Designer:** `FlowLibrary` rows are `role="button"`/tabbable, click or
  Enter/Space persists `selections.lastSelectedFlowId` and `navigateTo("flowChart")`; action buttons
  `stopPropagation`. Designer already loads `lastSelectedFlowId` on mount; Back returns via route history.
- **Task 03 + 06 — shared connector visuals + style customization:** new
  `components/shared/connectorStyle.ts` (`buildConnectorVisual`, `connectorTypeColor`, presets,
  `normalizeEdgeStyle`, `hasCustomStyle`) is now the single source for edge visuals in BOTH the Flow Designer
  (`createEdge`/`updateEdgeData`) and Workflow Builder (`createScenarioEdge`/`updateEdgeData`) — so they match.
  New `EdgeVisualStyle` on `FlowEdge`/`WorkflowEdge` (color/lineStyle/thickness/shape/arrowHead) persists and
  reloads; shared `ConnectorStyleEditor` added to both Connection Properties panels with Reset-to-default.
  Legacy connectors (no style) render with type defaults.
- **Task 04 — Node Palette search:** search input in the Flow Designer palette filters by
  label/type/description/category; "No matching nodes found." empty state; clear (X) + Escape reset.
- **Task 05 — searchable dropdowns:** new `components/shared/SearchableSelect.tsx` combobox applied to the long
  selectors in node properties (JSON Data Source, Target flow) and the Saved Flow selector — filter by
  label/value/description, keeps selection, "No matching options found." empty state.
- **Tests:** `npm run build` ✅, `npm run verify:runner` ✅ 41/41, `npm run validate:offline` ✅,
  `npm run verify:instance-monitor` ✅ 22/22, `check-memory` below.

---

## 2026-06-27 — Claude Code — UI fixes: instance-table alignment, DS row-preview, nav icon, brand mark

- **Instance table column alignment:** root cause was a global `table { display:block }` rule winning over
  `.instance-table` (so `table-layout:fixed` + `<colgroup>` were ignored) plus `.instance-name-cell` using
  `display:grid` on the `<td>` itself (removing it from the column model). Fix: `.instance-table` now sets
  `display:table`; `.instance-name-cell` is a normal table-cell with block-stacked `strong`/`small`.
  Horizontal scroll still handled by `.instance-table-wrapper`.
- **Data Source Manager preview on row click:** clicking a row now previews that source
  (`DataSourceManager` `<tr onClick>` → `openPreview`), with hover/selected row styles (`.ds-row*`);
  `stopPropagation` on the root-array-path input and the actions cell so they don't trigger a preview.
- **Runtime Inputs nav icon:** changed from `PlaySquare` (duplicated with Recorder) to `FormInput` in
  `routes.tsx`.
- **Brand mark consistency:** `.brand-mark` (WFS badge) is now a 32×32 square, radius 8px, weight 800,
  subtle shadow — consistent with the design system (was 38×30).
- **Tests:** `npm run build` ✅ (CSS/markup-only + icon swap; no logic touched). check-memory below.

---

## 2026-06-27 — Claude Code — Workflow cards grid: stable 3-column layout across Load More

- **Problem:** with `auto-fit minmax(250px,1fr)` the rendered column count depended on how many cards
  existed, so clicking "Load More" could reflow the row (cards-per-row and card width changed).
- **Fix (CSS only):** `.workflow-card-grid` is now `grid-template-columns: repeat(3, minmax(0,1fr))`
  (responsive: 2 cols ≤1080px, 1 col ≤680px). Cards-per-row and dimensions stay identical before/after
  Load More. `useGridColumns` still measures 3/2/1 for the Load-More row math; card design/min-height
  unchanged.
- **Tests:** `npm run build` ✅ (`verify:instance-monitor` logic unaffected — CSS-only change).

---

## 2026-06-27 — Claude Code — Workflow cards grid UI polish (equal height, full-width, no-jump hover)

- **UI-only changes** to the Concurrent Instance Monitor workflow cards (no runner/exec/logic changes;
  `instanceCardLogic` untouched, `verify:instance-monitor` still 22/22).
- **Equal-height cards:** `.workflow-card-grid` now `align-items: stretch`; `.workflow-card` is a fixed
  `grid-template-rows: auto 1fr` with `height:100%` + `min-height:250px`; names ellipsis, descriptions
  2-line clamped.
- **More cards per row:** grid switched from `auto-fill minmax(280px)` to `auto-fit minmax(250px, 1fr)`
  so cards stretch to fill the row (no wasted right gap) and up to ~4 fit on wide screens. The
  `useGridColumns` ResizeObserver still measures the real column count for Load-More math.
- **No-height-change hover:** `WorkflowRunCard` restructured into a fixed-height body with two
  absolutely-positioned, equal-area layers (`.workflow-card-summary` / `.workflow-card-params`) that
  cross-fade on `:hover`/`:focus-within`. Card height is constant → grid never reflows. Params inputs stay
  in the DOM and tab-focusable (focus reveals the layer); a "Hover or focus to configure & run" hint shows
  on the summary.
- **Full-width search & Load More:** removed `max-width` from `.im-card-search` (now `width:100%`) and
  `.im-load-more` (now full-width button).
- **Tests:** `npm run build` ✅, `npm run verify:instance-monitor` ✅ 22/22, `npm run verify:runner` ✅
  37/37, `npm run validate:offline` ✅, `check-memory` ✅.

---

## 2026-06-27 — Claude Code — Instance Monitor cards: unit verification + repackage

- **Goal:** close repo-verifiable unknowns for the workflow-cards work (no new features).
- **Extracted pure logic:** new `src/instances/instanceCardLogic.ts` (`filterWorkflows`,
  `visibleCardCount`, `validateCardParams`, `resolveWorkflowName`); `InstanceMonitor` now imports these
  instead of inline copies (behavior unchanged).
- **Added unit verification:** `scripts/verify-instance-monitor.mts` + `npm run verify:instance-monitor`
  → **22/22 pass** (search filter, responsive visible-count incl. 4×3=12 / 3×3=9 / 2×3=6 and +2-row Load
  More, per-card validation, deleted/unknown workflow-name resolution).
- **Repackaged after the UI change:** `npm run package:portable` → `dist/WebFlow Studio 0.1.0.exe`,
  `npm run package:nsis` → `dist/WebFlow Studio Setup 0.1.0.exe` (both unsigned; test-fixtures excluded).
- **Gates:** `npm run build` ✅, `npm run verify:runner` ✅ 37/37, `npm run validate:offline` ✅,
  `node scripts/ai-memory/check-memory.mjs` ✅.
- **Still GUI/VM-only:** live multi-workflow concurrency, hover/focus reveal, responsive widths, and the
  clean offline-VM walkthrough — see the checklist in `docs/OFFLINE_STANDALONE_PACKAGING.md`.

---

## 2026-06-27 — Claude Code — Instance Monitor workflow cards grid + workflow-aware instance records

- **Workflow cards grid (primary run UX):** new `components/instances/WorkflowRunCard.tsx` + a responsive
  grid in `InstanceMonitor`. Each card shows name/description, status badge (Active/Inactive/Invalid),
  flows + connectors counts, execution mode, data source, last updated; run parameters (total runs,
  concurrent, run mode, isolation, screenshot-on-failure [disabled — per-step concept], stop-on-error,
  Run) are revealed on **hover or keyboard focus** (`:focus-within`, inputs stay in the DOM so they're
  tabbable). Per-card params are independent, seeded from `settings.execution` defaults and persisted to
  the new `settings.workflowRunCards[workflowId]`.
- **Search + Load More by rows:** case-insensitive name/description search; grid shows 3 rows initially
  and Load More reveals +2 rows. Visible count = measured grid columns × rows (`ResizeObserver` reads
  `grid-template-columns`); search resets to 3 rows; empty states for no-workflows / no-match.
- **Classic form de-emphasized:** the old dropdown run form moved into a collapsed
  "Advanced / Classic run form" `<details>`; header keeps only **Stop All**.
- **Workflow column (Task 05):** instance table gains a Workflow column (resolves
  `scenarioId` → workflow name; "Deleted workflow"/"Unknown workflow" when missing); Instance subtext now
  shows the short execution id.
- **Concurrent workflows (Task 06):** fixed an instanceId collision — `InstanceManager` now mints
  globally-unique `instanceId` (`${executionId}-i${n}`) + sets `instanceOrderNumber`/`totalInstances`, so
  two workflows running at once no longer overwrite each other in the `InstancePool`. Card params
  `isolationMode` + `stopOnError` are plumbed through `RunWorkflowRequest` → the `ConcurrentRunProfile`
  (no fake controls; screenshot-on-failure shown disabled with tooltip).
- **Controls preserved (Task 07):** Pause All/Resume All/Stop All/Clear Completed moved to a monitor-wide
  bar; per-instance Pause/Resume/Stop/Repeat/Remove and the failed-only file-button rule unchanged.
- **Tests:** `npm run build` ✅; `npm run verify:runner` ✅ 37/37; `npm run validate:offline` ✅;
  `check-memory` — see below.

---

## 2026-06-27 — Claude Code — WB resize-handle alignment, Saved Flows pagination footer, per-instance Repeat

- **Task 02 fix — resize handles aligned to node bounds:** `.scenario-flow-node` had a fixed
  `width: 260px` and no `height: 100%`, so the article didn't fill the React Flow node wrapper that
  `NodeResizer` bounds — handles floated off the visible node. Now `width/height: 100%` +
  `box-sizing: border-box` + `overflow: hidden` (mirrors `.action-flow-node`).
- **Task 04 fix — Load More always discoverable:** Saved Flows now renders a footer showing
  "Showing X of N flows" whenever any flows exist, with the **Load More** button while more remain
  (and "All flows loaded." once exhausted). Previously the button only appeared when >10 flows existed,
  so with ≤10 it looked unimplemented. Logic unchanged (10 per page).
- **Task 09 (new) — Repeat single instance:** added `executionEngine.repeatInstance(instanceId)` which
  re-runs a finished instance from a retained per-execution `RunContext` (flows/scenario/dataSources/
  dirs/runtimeInputs, stored in `startRun` and kept beyond the run). New `execution:repeatInstance` IPC +
  `executions.repeatInstance` preload. Instance Monitor controls column gains a Repeat (RefreshCw) button,
  enabled only for terminal instances; Controls column widened to 200px so 5 buttons don't overflow.
- **Tests:** `npm run build` ✅; `npm run verify:runner` ✅ 37/37; `check-memory` — see below.

---

## 2026-06-27 — Claude Code — Route Change node, WB navigation/resize/search, save toasts, instance-monitor fixes

- **Task 01 — WB double-click opens Flow Designer:** `ScenarioBuilder` `onNodeDoubleClick` persists
  `selections.lastSelectedFlowId` + `selectedBuilderWorkflowId`, then `navigation.navigateTo("flowChart")`
  (routes through the unsaved-changes guard). `FlowChartDesigner` now honors `lastSelectedFlowId` on
  mount. Header Back returns to the Workflow Builder (restores the workflow via `selectedBuilderWorkflowId`).
- **Task 02 — WB node resize:** `ScenarioFlowNode` adds a `NodeResizer` (visible only when selected);
  `ScenarioFlowNodeData` carries `width/height`; size persists via `WorkflowFlowNode.size` and restores
  on load. Defaults `SCENARIO_NODE_DEFAULT_WIDTH/HEIGHT`.
- **Task 03/04 — Saved Flows search + Load More:** case-insensitive name filter, 10 shown initially,
  "Load More" reveals +10, "All flows loaded." when exhausted, "No matching flows found." empty state;
  search resets paging.
- **Task 05 — Route Change node:** new `routeChange` StepType + `NodeConfig.{routeMode,urlMatch,routeWaitUntil}`.
  Modes: switchToUrl / switchToLatestTab / waitForNewTab / navigateCurrentPage. Runtime switches the
  active page so later steps target the new tab: `StepExecutor` now holds a mutable `activePage` +
  `setActivePage`, and `LocatorFactory.setPage` redirects locators. Palette item, properties section, and
  mode-aware validation (incl. invalid-regex) added.
- **Task 06 — mock/recorder/fixtures:** mock site gains `#openNewTabButton` (form) + `/details` page
  (`routeChangeTargetTitle/Input/Submit/Result`). `RecorderService` inserts a Route Change action when an
  interaction occurs on a different tab/page; `recorder.ipc` maps it to a `switchToLatestTab` step. Seed
  adds `mock-route-change-flow` + `mock-route-change-workflow`. `verify-runner.mts` covers Route Change.
- **Task 07 — save messages:** shared `components/shared/Toast` + `.app-toast` CSS; Flow Designer and
  Workflow Builder show "… saved successfully: <name>" / "Failed to save changes. <err>". Data Source
  Editor already had success/error banners.
- **Tasks 08–10 — Instance Monitor:** Clear Completed now removes terminal instances from the backend
  pool (`executions.removeInstance`) so the 1s poll can't re-add them; controls audited (all map to real
  `executionEngine` methods); file/artifact buttons (Logs/Screenshots) enabled ONLY for `failed` instances
  with a path, disabled for completed/others, with status-specific tooltips.
- **Tests:** `npm run build` ✅; `npm run verify:runner` ✅ 37/37 (was 31; +6 Route Change); seed ✅
  (11 flows / 4 workflows / 1 data source); `npm run validate:offline` and `check-memory` — see below.

---

## 2026-06-27 — Claude Code — Selected-node resize handles + snapshot dirty-state + mock test fixtures

- **Task 1 — resize handles only on the selected node:** `ActionFlowNode.tsx` already used
  `<NodeResizer isVisible={selected} …>`; added a CSS safety net in
  `app/renderer/styles/global.css`
  (`.react-flow__node:not(.selected) .react-flow__resize-control { display:none }`) so unselected
  nodes never render handles/lines regardless of React Flow quirks. Resize + persistence unchanged.
- **Task 2 — unsaved dialog only for real changes:** replaced the string-state `isDirty` heuristic in
  `FlowChartDesigner.tsx` and `ScenarioBuilder.tsx` with a snapshot model. `serializeFlowDoc` /
  `serializeWorkflowDoc` produce an order-independent JSON of the saveable document (id-sorted nodes/
  edges; workflow also includes execution + dataSource). `isDirty = savedSnapshot !== "" &&
  docSnapshot !== savedSnapshot`. Baseline captured on load (`pendingSnapshot` ref + effect) and reset
  on save. Removed `handleNodesChange` (React Flow's initial `dimensions` measurement was flagging
  spurious dirty); now uses `onNodesChange` directly. Selection/zoom/pan/measurement no longer mark
  dirty; node/edge/property/metadata changes do.
- **Task 3 — test-only mock fixtures:** new `scripts/seed-mock-fixtures.mjs` + `seed:mock-fixtures`
  npm script. Generates 10 flows (login, fill-form, screenshot, scroll, upload, wait, loop,
  conditional, run-another-flow, assertion-fail+recovery), 3 workflows (simple, failure-handling,
  data-driven), 1 data source (mock-users, 3 rows). Writes source fixtures to
  `resources/test-fixtures/mock-site/{flows,workflows,data-sources}/` AND seeds them into the runtime
  userData folders (data file under `data/files/` per the collision fix). All `mock-`/"Mock —"
  prefixed, do NOT auto-load on fresh install. Excluded from packaged builds
  (`electron-builder.json` → `!test-fixtures/**`). Documented in
  `resources/test-fixtures/mock-site/README.md`.
- **Tests run:** seed script ✅ (10 flows / 3 workflows / 1 data source, 14 fixture JSON files parse);
  `npm run build`, `npm run validate:offline`, `npm run verify:runner`, and
  `node scripts/ai-memory/check-memory.mjs` — see below.

---

## 2026-06-27 — Claude Code — AI memory maintenance pass (skill)

- **Task:** Run the ai-memory-maintainer procedure; sync memory with recent changes.
- **Inspected:** `scripts/` now includes `verify-data-editor.mts` and `ai-memory/check-memory.mjs`
  (plus the `ai:memory` npm scripts and skill/command scaffolds).
- **Change:** `docs/ai/ARCHITECTURE.md` — `scripts/` map updated to list `verify-data-editor.mts`
  and `ai-memory/check-memory.mjs`. (COMMANDS, FEATURES, KNOWN_ISSUES, CURRENT_STATE already current
  from the data-source editor + collision-fix + review entries above.)
- **Checker:** `node scripts/ai-memory/check-memory.mjs` → passed.
- **Result:** memory consistent with the repo; no app code changed.

---

## 2026-06-27 — Claude Code — Memory review + checker pass

- **Task:** Review repo + memory files, replace any TODO sections, run `scripts/ai-memory/check-memory.mjs`.
- **Findings:** No literal TODO/placeholder sections exist — the memory files were authored fully
  populated and are current. Skill/command scaffolds present (no checker warnings). No secrets.
- **Change:** `docs/ai/COMMANDS.md` — added the new `ai:memory` / `ai:memory:check` npm scripts.
- **Checker:** `node scripts/ai-memory/check-memory.mjs` → passed (exit 0), no failures/warnings.
- **Result:** memory layer verified accurate and consistent with the current repo.

---

## 2026-06-27 — Claude Code — Fix data-source file/profile collision (editor "not a root array")

- **Bug:** Creating a data source wrote the data file to `<dataSources>/<name>.json`, the same path
  the profile-metadata store uses (`<dataSources>/<id>.json`); `store.import` then overwrote the
  array with the profile object, so the editor showed "not a root array of objects."
- **Fix:** `app/main/ipc/dataSource.ipc.ts` — user data files now live in `<dataSources>/files/`
  (`dataFilesDir`); `resolveDataFile` redirects legacy collided files and auto-heals (seeds from
  `profile.sampleRow` when the data file is missing); `preview`/`getJsonPaths` use the resolved
  data path too.
- **Tests run:** `npm run build` ✅, `npm run verify:data-editor` ✅ 27/27, `npm run verify:runner` ✅ 31/31.
- **Result:** new data sources save/read correctly; the previously-broken "users" source reopens
  with its seed row recovered. No schema change.

---

## 2026-06-27 — Claude Code — Data Source visual JSON table editor

- **Task:** Add a visual table editor for JSON data sources (view/edit/add/delete/duplicate rows,
  add/rename/delete columns, create from scratch, save real files).
- **Files added:** `app/renderer/pages/DataSourceEditor.tsx`,
  `app/renderer/components/shared/ConfirmDialog.tsx`, `src/data/TableEditing.ts` (pure helpers),
  `scripts/verify-data-editor.mts`.
- **Files changed:** `app/main/ipc/dataSource.ipc.ts` (+`readJson`/`writeJson`/`createFromScratch`,
  resources read-only → migrate on save), `app/main/preload.ts` (3 channels),
  `app/renderer/routes.tsx` (hidden `dataSourceEditor` route), `app/renderer/pages/DataSourceManager.tsx`
  (Edit Table / Duplicate / Export actions + Create Data Source modal), `app/renderer/styles/global.css`
  (editor table styles), `package.json` (`verify:data-editor`).
- **Tests run:** `npm run build` ✅, `npm run verify:data-editor` ✅ 27/27 (incl. real file round-trip),
  `npm run verify:runner` ✅ 31/31 (no regression), `npm run validate:offline` ✅.
- **Tests not run:** live GUI of the editor (needs the running Electron app).
- **Result:** feature implemented and logic verified against real files; uses real storage, not mock.

---

## 2026-06-26 — Claude Code — Final verification of AI memory (Prompt 04)

- **Task:** Pre-commit verification of the AI-agent memory setup.
- **Checks (all pass):** all 21 required files exist (3 root + 12 `docs/ai/` + 6 local `AGENTS.md`);
  Markdown code fences balanced in every file; `CLAUDE.md`/`GEMINI.md` both import `@AGENTS.md`;
  no secret-like values; referenced paths exist (`docs/OFFLINE_STANDALONE_PACKAGING.md`,
  `docs/IMPLEMENTATION_AUDIT.md`, `IMPLEMENTATION_STATUS.md`, `.env.example`, `.gitignore`,
  `playwright.config.ts`, `mock-site/server.mjs`).
- **Issues fixed:** none required.
- **Result:** AI memory layer verified and ready to commit.

---

## 2026-06-26 — Claude Code — Add folder-specific AGENTS.md (Prompt 03)

- **Task:** Add local `AGENTS.md` rules to high-value folders.
- **Files created:** `app/main/AGENTS.md`, `app/renderer/AGENTS.md`, `src/AGENTS.md`,
  `scripts/AGENTS.md`, `tests/AGENTS.md`, `docs/AGENTS.md`.
- **Files modified:** `docs/ai/DEVELOPMENT_WORKFLOW.md` (listed local AGENTS.md locations).
- **Skipped:** `resources/`, `vendor/`, `mock-site/`, `instances/`-style leaf folders — covered by
  root + `src`/`scripts` rules; per-folder files would add noise.
- **Tests run:** none (docs-only). **Result:** local rules added; consistent with root, no conflicts.

---

## 2026-06-26 — Claude Code — Audit & correct AI memory (Prompt 02)

- **Task:** Audit the memory files for accuracy, conflicts, invented features, unverifiable
  commands, secrets, and broken paths.
- **Findings:** All cited paths exist (verified `src/orchestrator`, `src/data`, `src/storage`,
  `app/main/ipc`, runner files, components/table, mock-site, tests, playwright.config). All
  `COMMANDS.md` commands are backed by `package.json`. No secrets; no conflicting rules; CLAUDE.md
  and GEMINI.md correctly import `@AGENTS.md`.
- **Corrections:** `ARCHITECTURE.md` — completed the `orchestrator/` and `data/` file lists
  (added FlowOrchestrator, ConditionalFlowRouter, ExecutionQueue, FlowOutputRegistry, DataBinding).
- **Tests run:** none (docs-only). **Result:** memory files verified accurate.

---

## 2026-06-26 — Claude Code — Bootstrap AI agent memory structure

- **Task:** Create the shared AI-agent memory/instruction layer (Prompt 01).
- **Files created:** `CLAUDE.md`, `GEMINI.md`, and `docs/ai/`: `PROJECT_BRIEF.md`,
  `CURRENT_STATE.md`, `FEATURES.md`, `ARCHITECTURE.md`, `COMMANDS.md`, `RULES.md`,
  `KNOWN_ISSUES.md`, `TASK_LOG.md`, `DECISIONS.md`, `SECURITY.md`, `TESTING.md`,
  `DEVELOPMENT_WORKFLOW.md`.
- **Files modified:** `AGENTS.md` (rewritten from a long product spec into a concise agent hub that
  delegates detail to `docs/ai/`; spec content relocated into `ARCHITECTURE.md`/`RULES.md`/
  `FEATURES.md`/`SECURITY.md`).
- **Repository understanding:** Electron + React + TypeScript Windows desktop app (WebFlow Studio)
  for offline Playwright automation; framework-agnostic core under `src/`; JSON profile storage;
  offline packaging (portable + NSIS) with bundled Chromium; runner verified live via
  `npm run verify:runner`.
- **Tests run:** none new (documentation-only task). Prior session verified `npm run build` ✅,
  `npm run verify:runner` ✅ 31/31, `npm run validate:offline` ✅, packaging ✅.
- **Tests not run:** clean-machine offline GUI walkthrough (human/VM step, pending).
- **Result:** AI memory layer created; no application code or runtime behavior changed.
- **Notes:** Folder-specific `AGENTS.md` files (Prompt 03) and audit (Prompt 02) not yet done.

---

## 2026-07-11 — Claude Code — Node kebab menu, loop-button removal, canvas parity

- **Task:** Finish Workflow→AWKIT UI parity for the two graph editors: remove the in-node loop
  button (user req 10), make the node "…" 3-dot menu functional (req 11), and tighten canvas
  fidelity to the reference.
- **Files created:** `app/renderer/components/shared/NodeOptionsMenu.tsx` (portalled per-node
  context menu — Configure / Add·Remove loop / Delete; framer-motion `menuSpring`, Escape +
  outside-click, reduced-motion aware; portals into `#root` so click delegation + fixed
  positioning both work).
- **Files modified:**
  - `components/workflow/ActionFlowNode.tsx`, `components/scenario/ScenarioFlowNode.tsx` — removed
    the standalone `node-loop-button`; wired the kebab to `NodeOptionsMenu`. Loop create/remove now
    lives in the menu. Scenario node gained a functional kebab (it had none).
  - `components/workflow/flowDesignerTypes.ts`, `components/scenario/scenarioDesignerTypes.ts` —
    added render-only `onConfigure` / `onDeleteNode`·`onDeleteFlow` callbacks (never serialized).
  - `pages/FlowChartDesigner.tsx`, `pages/ScenarioBuilder.tsx` — wired the menu callbacks; removed
    the React Flow `Controls` (top-right) and `MiniMap` from both canvases (reference has neither —
    only the dotted grid + bottom-center glass toolbar); dropped now-dead `nodeColor`/`resolvedTheme`.
  - `styles/global.css` — deleted `.node-loop-button` rules; added `.node-options-menu` /
    `.node-options-item` styles; added scenario kebab hover-reveal + 4th grid column for the kebab.
  - `scripts/verify-flow-designer-gui.mjs`, `scripts/verify-workflow-builder-gui.mjs` — migrated the
    loop assertions from the removed button to the new kebab menu; made Workflow Builder navigation
    robust to expanded/collapsed sidebar.
- **Tests run (real Electron GUI):** `verify:flow-designer` ✅ 24/24, `verify:workflow-builder`
  ✅ 21/21, `verify:workflow-sentinels` ✅ 4/4, `npm run build` (incl. `tsc --noEmit`) ✅.
  Kebab click-through proven: "Add loop" creates the self-loop (active loop ports 0→2) and toggles
  to "Remove loop"; 0 `.node-loop-button` remain in either editor.
- **Evidence:** light + dark captures of both editors under
  `docs/ai/ui-reskin-template-plan/mockups/screenshots/`.
- **Result:** reqs 10 & 11 implemented and verified; canvas chrome now matches the reference. No
  data-model/serialization or runtime change (menu callbacks are render-only).

---

## 2026-07-11 (cont.) — Claude Code — Reference-parity canvas: vertical flow, hidden ports

- **Task (user feedback):** the graph nodes still used the old design with visible ports on both
  sides; the two editors were not the reference top→bottom canvas.
- **Files modified:**
  - `components/shared/ConnectorPorts.tsx` — moved target handles to the node's TOP edge and source
    handles to the BOTTOM edge (branch pairs fan out along the bottom). Handle **ids** are unchanged,
    so `onConnect`, `portHandlesForKind`, serialization and the runtime are untouched.
  - `styles/global.css` — `.connector-port { opacity: 0 }`: handles are hidden (reference parity)
    but stay in the DOM and connectable (drag-to-connect + programmatic edges still attach); the
    active loop port still shows.
  - `pages/ScenarioBuilder.tsx` — Workflow Builder now lays flows out **top→bottom** (was
    left-to-right): `addFlow`/`reorderFlow`/load-fallback positions are vertical and `withAutoLayout`
    /Auto-arrange use `direction: "TB"`. New workflows and Auto-arrange produce the vertical reference
    flow; existing saved layouts are still preserved on load.
  - `scripts/verify-flow-designer-gui.mjs`, `scripts/verify-workflow-builder-gui.mjs` — port-geometry
    checks updated from left/right to top/bottom; branch pair asserted horizontally separated; leaf
    append click made robust to the new vertical edge overlap.
- **Tests run (real Electron GUI):** `verify:flow-designer` ✅ 24/24, `verify:workflow-builder`
  ✅ 21/21, `tsc --noEmit` + build ✅. Drag-to-connect still verified ("Dragging second Conditional
  connector creates the missing branch").
- **Result:** both editors render the reference top→bottom canvas — clean cards, hidden handles, no
  visible side ports, vertical smooth edges with `+` insertion and label pills. No runtime/schema change.
- **Still open (user feedback):** add-step menu "Logic" options (Condition / Parallel / Loop) that
  create the branch structure from the picker — next task.

---

## 2026-07-11 (cont. 2) — Claude Code — Add-step "Logic" options (Condition / Parallel / Loop)

- **Task (user feedback):** the add-step menu was missing branch-creating logic options (conditional
  branch, parallel branch, loop). User chose reference-style auto-branching.
- **Files modified:** `pages/FlowChartDesigner.tsx`
  - Added a "Logic" group to the Node Palette picker (Condition / Parallel / Loop, listed first);
    folded the plain `condition`/`loop` node types into these so there's no duplicate lone-node entry.
  - New `applyLogic()` auto-creates the branch structure mapped to AWKIT's real connector kinds:
    Condition → a `condition` node with two conditional connectors ("If true" / "If false",
    priorities 0/1); Parallel → a two-way parallel fan-out (`parallel` edges, waitAll/failFast);
    Loop → a step carrying a self-loop `loop` connector. Handles blank / edge-insert / leaf-append
    modes and produces valid edges the runtime + validator accept.
  - `handlePickerPick` now routes `logic-*` ids to `applyLogic` and plain ids to the node factories.
- **Verifier:** `scripts/verify-flow-designer-gui.mjs` — replaced the two hidden-handle drag checks
  (drag-to-connect is not usable once handles are hidden per the reference model) with a Logic →
  Condition test that asserts the auto-created conditional pair (If true/If false) and the
  delete-one-branch revert-to-normal.
- **Tests run (real Electron GUI, ×2 each for stability):** `verify:flow-designer` ✅ 24/24,
  `verify:workflow-builder` ✅ 21/21, `verify:workflow-sentinels` ✅ 4/4,
  `verify:recorder-flow` ✅ 13/13, `tsc --noEmit` + build ✅.
- **Result:** the Flow Designer add-step menu now exposes Condition / Parallel / Loop logic options
  that auto-create the branch, matching the Workflow reference while preserving AWKIT's runtime
  connector semantics. No schema/serialization change.

---

## 2026-07-11 (cont. 3) — Claude Code — Remove React Flow: in-house canvas engine

- **Task (user):** replace the React Flow-based canvases with the *same custom UI design as the
  `Workflow` (flowforge) reference project, but without the `@xyflow/react` library*. The reference is
  itself built on React Flow, so this meant building a small in-house canvas engine and porting all
  three canvases onto it. User chose "adopt flowforge nodes as-is" (drop the extra node features) and
  "all three canvases".
- **New engine:** `app/renderer/components/canvas/` — `FlowCanvas.tsx` (pan/zoom via CSS transform,
  node drag with DOM measurement, SVG edge layer, fit-view, `useCanvas`/`useViewport`,
  `FlowCanvasHandle` ref → `fitView`/`zoomTo`/`screenToFlowPosition`, `getIntersectingNodes`),
  `geometry.ts` (faithful port of React Flow's `getSmoothStepPath`/`getViewportForBounds` math),
  `edgeComponents.tsx` + `edgeLabelContext.ts` (`BaseEdge`/`EdgeLabelRenderer` via an in-transform HTML
  overlay portal), `Background.tsx`, `CanvasZoomControl.tsx`, `state.ts`
  (`useNodesState`/`useEdgesState`/`addEdge` compat), `nodes/StepNode.tsx`, `edges/SmoothEdge.tsx`,
  `edges/LoopEdge.tsx`, `types.ts`, `index.ts`. Flow is top→bottom (edge = source-bottom → target-top;
  self-loop when source === target).
- **Canvases converted:** `pages/WorkflowDesigner.tsx` (read-only), `pages/FlowChartDesigner.tsx`,
  `pages/ScenarioBuilder.tsx` — rendering layer swapped only; save/load/validation/serialization
  unchanged. Node components rebuilt on the engine (`ActionFlowNode.tsx`, `ScenarioFlowNode.tsx`),
  keeping their flowforge-parity card CSS; loop create/remove moved to the kebab (`onToggleLoop`).
- **Shared:** `connectorStyle.ts` dropped its `@xyflow` import (`buildConnectorVisual` → engine edge
  types `smooth`/`loop`); `FlowNodePropertiesPanel.tsx` `Node` type from the engine;
  `flowDesignerTypes.ts`/`scenarioDesignerTypes.ts` gained `hasLoop`/`onToggleLoop`.
- **Deleted (React-Flow-only):** `shared/TemplateSmoothEdge.tsx`, `shared/SelfLoopEdge.tsx`,
  `shared/ConnectorPorts.tsx`, `workflow/CanvasZoomControl.tsx`. Removed the RF CSS import from
  `main.tsx` and the `@xyflow/react` dep from `package.json`. Appended engine CSS (`.awkit-flow-*`,
  `.awkit-step-node*`, `.awkit-edge-*`) to `global.css` (AWKIT has no Tailwind, so the reference's
  utility-class card design was translated to `--awkit-*` tokens).
- **Verifiers rewritten** against the new DOM: `scripts/verify-flow-designer-gui.mjs`,
  `scripts/verify-workflow-builder-gui.mjs` (dropped the removed branch-port geometry checks).
- **Behavior intentionally dropped** (per "adopt flowforge nodes as-is"): node resize, branch-port
  dragging, edge reconnect, port-drag-to-connect. Connections via `+`/append/Logic picker; loop via
  kebab. Connector kinds/config + save/validation preserved.
- **Tests run:** `tsc --noEmit` ✅ clean; `electron-vite build` ✅ clean (renderer bundle 1,589 → 1,235
  kB, ~355 kB smaller; modules 2214 → 2049); `verify:flow-designer` (real Electron GUI) ✅ 14/14;
  `verify:workflow-builder` (real Electron GUI) ✅ 14/14; `grep @xyflow app/` → none.
- **Remaining:** run `npm install` (`@xyflow/react` still in `package-lock.json` (6 refs) +
  `node_modules/`; install not run), then regenerate the offline manifest + `validate:offline`
  (`generate-dependency-manifest.ps1` still references React Flow). Optional: add flowforge-style
  drag-node-onto-node connect; prune the now-unused port helpers in `connectorStyle.ts`.

---

## 2026-07-12 — Codex — Keep Flow Designer inspector within canvas bounds

- **Task:** fix the right properties panel overflowing the Flow Designer canvas area around the toolbar.
- **Root cause:** the populated inspector was still a second outer grid column, so its entire width sat
  beyond the Flow Designer canvas/action-toolbar boundary. The first pass only fixed vertical sizing and
  left the reported horizontal overflow unchanged.
- **Files modified:** `app/renderer/styles/global.css`, `scripts/verify-flow-designer-gui.mjs`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Fix:** restored a full-width designer canvas and toolbar, positioned the drawer inside those bounds,
  and reserved an equal internal strip in the canvas body so nodes/connectors remain unobscured. The
  collapsed rail returns that strip. Added four-edge containment, toolbar alignment, usable-canvas
  non-overlap, and exact **1936×1290** viewport assertions to the real-Electron verifier.
- **Tests run:** `npm run build` ✅; `npm run verify:flow-designer` ✅ **24/24** (default, compact
  1024×768 wrapped-toolbar, and exact reported 1936×1290 geometry); `npm run verify:mock-site` ✅
  **35/35**; visually inspected the captured 1936×1290 Electron frame; AI memory check ✅.
- **Not run:** clean-machine GUI walkthrough (not needed for this focused renderer geometry regression).
- **Result:** the expanded inspector is fully contained inside the Flow Designer canvas—horizontally
  within the toolbar edge and vertically between toolbar bottom and canvas bottom—at normal and reported
  viewport sizes.

---

## 2026-07-12 — Codex — Instance bulk stop and workflow-run drill-down

- **Task:** add an Instances action that stops all pending/running work; show running workflow records
  with summary data; open a modal containing all detailed instance data when a record is selected.
- **Implementation:** `InstanceMonitor.tsx` now treats pending/queued as bulk-stoppable, confirms the
  destructive action, calls the existing backend `executions.stopAll()`, and exposes the action in the
  monitor toolbar plus compact page header. Instance rows are grouped by unique `executionId` through
  pure `summarizeWorkflowRuns` logic and rendered as active-first summary records.
- **Modal:** new `WorkflowInstancesModal.tsx` provides focus-on-open, Escape/backdrop close, workflow/run
  summary metrics, every instance's activity/runtime/timing detail, and per-instance live-report actions.
- **Mock lab:** extended `/designer-lab`, its README entry, and `verify-mock-site` with the workflow-run
  record → three-instance modal contract.
- **Files modified/added:** `app/renderer/pages/InstanceMonitor.tsx`,
  `app/renderer/components/instances/WorkflowInstancesModal.tsx`, `app/renderer/styles/global.css`,
  `src/instances/instanceCardLogic.ts`, `scripts/verify-instance-monitor.mts`,
  `scripts/verify-instance-monitor-gui.mjs`, `mock-site/public/designer-lab.html`,
  `mock-site/README.md`, `scripts/verify-mock-site.mjs`, `package.json`, and AI memory docs.
- **Verification:** `npm run build` ✅; `verify:instance-monitor` **35/35**;
  `verify:instance-monitor-gui` **12/12** (real Electron, isolated temp profile, bundled Chromium, two
  running + two queued → all cancelled); `verify:mock-site` **39/39**; light-theme modal capture visually
  inspected; no renderer console/page errors.
- **Not run:** `verify:runner` (no runner/orchestrator implementation changed; real GUI verification used
  the existing hard-cancel path); clean-machine packaged/installer walkthrough (out of scope).
- **Result:** operators can see each workflow execution at a glance, inspect every instance in one modal,
  and safely cancel all pending/running work across workflows.

## 2026-07-12 — Claude — Profile store data-integrity hardening (audit remediation Phase 1)

- **Task:** After a full codebase audit (`docs/audit/`), implement Phase 1 of the remediation plan:
  make the JSON document store crash-safe and stop it silently dropping corrupt files.
- **Change:** `src/storage/ProfileStore.ts` — atomic temp-file+rename writes (A1), an in-instance FIFO
  serialization chain for all writes/deletes (S1), corrupt-file quarantine to `.corrupt-<ts>` instead of
  silent `null` (A2), and write-new-before-delete-old id-rename in `update()` (A3). On-disk format
  unchanged; no route/IPC/preload/runner/schema/packaging change. `src/` stays app-agnostic (queue
  inlined, not imported from `app/main/writeQueue.ts`).
- **Files:** `src/storage/ProfileStore.ts`, `scripts/verify-profile-store.mts` (new),
  `package.json` (new `verify:profile-store` script), `docs/ai/CURRENT_STATE.md`,
  `docs/ai/COMMANDS.md`, `docs/audit/TECHNICAL_DEBT_REGISTER.md` (findings marked resolved).
- **Verification:** `npm run build` ✅; `verify:profile-store` **13/13** (new); `verify:data-editor`
  **27/27** (store consumer, unregressed); `verify:write-queue` 7/7; `verify:workflow-sentinels` 4/4.
- **Not run:** live/GUI verifiers, packaged/offline validators (no behavior in those paths changed).
- **Result:** flows/workflows/data-sources/reports can no longer be truncated by a crash mid-save or
  silently vanish on corruption; a corrupt file is preserved on disk and logged. Closes A1/A2/A3/S1.

## 2026-07-12 — Claude — Isolated browser teardown hardening (audit remediation Phase 2)

- **Task:** Phase 2 of the `docs/audit/` remediation plan — stop the isolated-context teardown from
  orphaning the Chromium process when `context.close()` throws (finding A4).
- **Change:** `src/runner/BrowserContextFactory.ts` — extracted `closeIsolatedRuntime(context, browser)`
  which closes the context in `try` and the browser in `finally` (failing browser close swallowed; the
  context error still propagates). The isolated `create()` close closure delegates to it. Persistent path
  unchanged (already had try/finally around the profile lease).
- **Files:** `src/runner/BrowserContextFactory.ts`, `scripts/verify-browser-pool.mts` (new Part F),
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`, `docs/audit/TECHNICAL_DEBT_REGISTER.md` (A4 resolved).
- **Verification:** `npm run build` ✅; `verify:browser-pool` **20/20** (was 16 — Part F asserts the
  browser closes even when context.close rejects, error propagation, happy path, and swallowed browser
  close error).
- **Not run:** live/GUI verifiers, packaged/offline (no behavior in those paths changed; teardown proven
  at the unit level with fakes, matching the rest of the browser-pool suite).
- **Result:** a throwing context close can no longer leak a browser process; closes A4.

## 2026-07-12 — Claude — Electron/IPC surface hygiene (audit remediation Phase 3)

- **Task:** Phase 3 of the `docs/audit/` remediation plan — close the external-open scheme hole (A5) and
  resolve the registered-but-unexposed IPC handlers (A6).
- **Change:**
  - `app/main/windowManager.ts` — `setWindowOpenHandler` opens via `shell.openExternal` only for
    `http(s)` (was any scheme); other schemes are denied. Matches `auth.ipc.ts`.
  - New `scripts/verify-ipc-contract.mts` — static guard over `app/main/ipc/*` + `preload.ts`: preload
    invokes only real handlers, no duplicate registrations, every handler is exposed or in a documented
    `BACKEND_ONLY` allowlist (23 channels), allowlist has no stale entries. Documents the dead/internal
    surface instead of deleting possibly-intended CRUD APIs, and fails on future drift.
- **Files:** `app/main/windowManager.ts`, `scripts/verify-ipc-contract.mts` (new), `package.json`
  (new `verify:ipc-contract` script), `docs/ai/CURRENT_STATE.md`, `docs/ai/COMMANDS.md`, `docs/ai/TASK_LOG.md`,
  `docs/audit/TECHNICAL_DEBT_REGISTER.md` (A5/A6 resolved).
- **Verification:** `npm run build` ✅; `verify:ipc-contract` **4/4** (117 handlers, 94 exposed, 23 backend-only).
- **Not run:** live/GUI verifiers (no UI/runtime behavior changed); external-link open is a one-line guard.
- **Result:** non-http(s) window.open can't launch an OS handler; the IPC contract is drift-guarded and
  the unexposed surface is documented. Closes A5/A6.

## 2026-07-12 — Claude — Load Session (A7) accepted as roadmap stub (audit remediation Phase 4)

- **Task:** Phase 4 of the `docs/audit/` remediation plan — resolve A7 (the "Load Session" /
  `useSavedSession` Protected Login Handoff mode surfaced as "not implemented yet").
- **Decision (owner):** leave the `useSavedSession` + `useTestSession` handoff modes as-is and document
  them as intentional roadmap stubs. They are already honestly disabled (validation note + `false`
  capability flags + disabled button) and redundant with the working `Reuse Session` /
  `Auto Secure Login` nodes. No implementation, no removal.
- **Change:** documentation only — reclassified A7 from defect to accepted/deferred in
  `docs/audit/TECHNICAL_DEBT_REGISTER.md` and `docs/audit/UNIMPLEMENTED_FEATURES.md`; noted the decision
  in `docs/ai/CURRENT_STATE.md` and here.
- **Files:** `docs/audit/TECHNICAL_DEBT_REGISTER.md`, `docs/audit/UNIMPLEMENTED_FEATURES.md`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`. No source/build change.
- **Verification:** none required (docs-only; no code touched). Build already green from Phases 1-3.
- **Result:** A7 is accepted/deferred, not open debt. Remaining audit items: A8 (bundle size),
  A9 (docs bloat), A10 (headless test tier).

## 2026-07-12 — Claude — Reports tables: full width + bounded-height scroller (UI fix)

- **Task:** User-reported Workflow Reports layout bug — tables only used the left half of each card and
  the recent-runs list grew unbounded. "Reports should fill full width and assign fixed height for each
  card with scroller."
- **Root cause:** the global `table { display: block; overflow-x: auto }` rule (for the wide Instance
  Monitor table) forced every `.awkit-table` to a block box, so `width:100%` filled the block but the
  inner columns shrank to content and clustered left.
- **Change (`app/renderer/styles/global.css`, renderer/CSS only):** `.awkit-table` now `display: table`
  so `width:100%` stretches columns to fill the card; `.awkit-report-page .awkit-table-wrap` gets
  `max-height: 46vh` + `overflow-y: auto` with a sticky `thead th`, giving each report card a bounded
  height with an internal scroller and pinned header. `.awkit-table` is reports-only (5 files), so the
  blast radius is contained.
- **Files:** `app/renderer/styles/global.css`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` ✅ (clean; the one EXIT 1 was contention from running build and the
  Electron verifier in parallel — tsc alone is clean and the solo rebuild is green);
  `npm run verify:reports` **26/26** (real Electron, all report routes render/resolve, no console errors).
- **Not run:** pixel-level width/scroll assertion (Electron GUI can't be driven in this harness's Browser
  pane, which needs the preload API) — the change is CSS-only and the GUI verifier confirms no functional
  regression on any report route.
- **Result:** report tables fill the full card width and long lists scroll inside a fixed-height card.

## 2026-07-12 — Claude — Chrome Consumption gauge distortion + idle sampling (UI/runtime fix)

- **Task:** User report on the Chrome Consumption page — Browser pool/Concurrency gauges looked distorted
  (not RPM-like), Memory/CPU gauges stuck on "sampling…", plus questions on the 2-browser / 4-flow caps.
- **Fix 1 — gauge distortion (`app/renderer/components/reports/RadialGauge.tsx`):** `bandArc` SVG arc
  sweep-flag 0 → 1. Flag 0 is unambiguous only for the full 0→100 arc (chord == diameter); the shorter
  band sub-arcs resolved to the mirrored circle centre, cusping the segments. Confirmed by rasterizing the
  exact SVG with `sharp` (flag 0 reproduced the reported distortion; flag 1 is a clean semicircle).
- **Fix 2 — idle sampling (`src/runner/ExecutionEngine.ts`):** `ResourceSampler.start()` ran only in
  `startRun`, so idle Memory/CPU gauges never sampled. `getRuntimeStatus()` now starts it idempotently
  (primes the first sample synchronously, unref'd), so system RAM shows immediately and CPU within a poll.
- **Answered (no change):** the 2/4 caps are `ConcurrencyConfig` defaults `maxBrowsersPerHost`/
  `maxActiveFlows`, env-overridable via `AWKIT_MAX_BROWSERS` / `AWKIT_MAX_ACTIVE_FLOWS`.
- **Files:** `app/renderer/components/reports/RadialGauge.tsx`, `src/runner/ExecutionEngine.ts`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` ✅; `npm run verify:reports` **26/26** (real Electron, gauges render,
  no console errors); gauge geometry proven via `sharp` raster (before/after).
- **Not run:** live pixel check inside Electron (Browser pane can't drive the Electron renderer) — the
  raster proof + GUI verifier cover geometry and non-regression.
- **Result:** gauges render as clean RPM dials; Memory/CPU are live at idle.

## 2026-07-12 — Claude — Configurable runtime concurrency caps in Settings (feature)

- **Task:** User request — expose the browser/flow host caps in the Settings UI instead of env-only, and
  make Browser pool / Concurrency gauges consistent with Memory pressure (the latter delivered by the
  earlier gauge sweep-flag fix).
- **Change:**
  - Schema: `runtime: { maxBrowsers, maxActiveFlows }` in `app/main/uiSettings.ts` (defaults 2/4; bounds
    1–16 / 1–64; hydrate/mergePatch/validate).
  - Engine: `ExecutionEngine.configureConcurrency` → `BrowserWorkerPool.reconfigure` — mutates the shared
    limits object (live `maxActiveFlows`) and rebuilds the browser-slot `Semaphore` only when idle
    (`slots.size === 0`), keeping `maxBrowsersPerHost` in sync with the live semaphore.
  - Wiring: `applyRuntimeConcurrencyFromSettings()` in `execution.ipc.ts`, called at startup, after each
    settings save/reset/import (`settings.ipc.ts`), and before each run.
  - UI: Runtime Concurrency card in `app/renderer/pages/Settings.tsx` + `.settings-card-hint` CSS.
- **Files:** `app/main/uiSettings.ts`, `src/runner/ExecutionEngine.ts`,
  `src/runner/browser/BrowserWorkerPool.ts`, `app/main/ipc/execution.ipc.ts`, `app/main/ipc/settings.ipc.ts`,
  `app/renderer/pages/Settings.tsx`, `app/renderer/styles/global.css`, `scripts/verify-browser-pool.mts`
  (Part G), `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` ✅; `verify:browser-pool` **25/25** (Part G: live flows cap + guarded
  browser-cap resize); `verify:settings-persistence` **3/3**; `verify:reports` **26/26**;
  `verify:ipc-contract` **4/4**.
- **Not run:** live Settings-page GUI walkthrough (no dedicated verifier; schema round-trip covered by
  settings-persistence; the caps→pool logic covered by browser-pool Part G).
- **Result:** users set Max browsers / Max active flows in Settings; the caps drive admission and the
  Chrome Consumption gauge denominators (applied on save + each run; browser-cap resize when idle).

## 2026-07-14 — Claude — UI/motion direction: spatial-continuity completions + type-scale migration

- **Task:** Continue implementing `docs/ui-design-and-motion-direction.md`. Phases 0–4 (foundation tokens,
  motion vocabulary, origin-aware surfaces, hover gating, canvas transforms, glass materials, a11y media
  queries) were already applied (uncommitted, from the 7 `plans/00x` motion plans + Phase-0 foundation).
  This session closed the additive "missed opportunities" and started the Phase-4 type migration.
- **Change:**
  - **Toast exit** (`components/shared/Toast.tsx`, `global.css` `.app-toast`): enter→shown→leave state
    machine; fades out along the same bottom edge via CSS transitions (not a keyframe). Removed the now
    unused `@keyframes app-toast-in`.
  - **Empty-state first-render delight** (`global.css` `.awkit-empty-state`): staggered rise
    icon→headline→hint→CTA (45ms/step, `--awkit-dur-med` ease-out), fully removed under reduced motion.
  - **Node-deletion exit** (`components/canvas/FlowCanvas.tsx`, `global.css` `.awkit-flow-node.is-exiting`):
    manual exit-tracking (no `AnimatePresence`) renders a deleted node ~150ms as a non-interactive ghost
    that fades+scales out (keyframe on the node's child; outer `translate3d` untouched). Gated on the
    `nodes` reference so pan/zoom/typing never re-render the memoized node subtree.
  - **Properties-panel glide:** confirmed already implemented (§9.1). Coordinated `panBy` deferred (needs
    cross-boundary ref threading; documented in `plans/README.md`).
  - **Type-scale migration:** 199 exact-match `font-size` literals (11/12/13/14/16/18/22px) → `--text-*`
    tokens (zero visual change). 28 off-scale one-offs left; `--leading-*`/`--tracking-*` application is a
    per-section visual follow-on.
- **Files:** `app/renderer/components/shared/Toast.tsx`, `app/renderer/components/canvas/FlowCanvas.tsx`,
  `app/renderer/styles/global.css`, `plans/README.md`, `docs/ai/TASK_LOG.md`. (CURRENT_STATE.md left
  unchanged — it tracks committed app state; this whole UI-motion body is intentionally uncommitted.)
- **Verification:** `npm run build` ✅; `verify:flow-designer` **24/24** (incl. node add/delete flows, no
  console errors); `verify:reports` **31/31**; `verify:canvas-perf` **7/10** — the 3 failures are
  pre-existing on baseline `7c4b260` (harness "no draggable node found" / seed nodeCount=3), and all
  memoization assertions (zoom/typing → 0 node/card/edge re-renders) pass before and after.
- **Not run:** clean-machine packaged GUI walkthrough; light/dark + reduced-motion visual pass (Electron
  renderer can't be driven from the Browser pane). Motion is CSS-token-driven and reduced-motion-guarded.
- **Result:** toasts, empty states, and node deletion complete their spatial loops; font sizes are
  single-sourced. Whole UI-motion body remains uncommitted for user review (per request).

## 2026-07-14 — Claude — Fix Settings › Paths & Directories button overlap (UI)

- **Task:** User reported the Browse/Reset buttons in Settings → Paths & Directories were misaligned —
  each field's Reset button overlapped the next field's path input (`ResetC:\Users\...`), last column clipped.
- **Cause:** Path fields used the shared `.settings-grid` (`auto-fit, minmax(240px,1fr)`) — too narrow for a
  long path input + Browse + Reset. Measured overflow was a constant **+80px** per field (Reset spilling
  into the neighbour's cell).
- **Change:** Scoped a `.settings-paths-grid` modifier (added to the paths grid in `Settings.tsx`):
  `minmax(340px,1fr)` tracks; `.settings-path-row` gets `align-items:center` + `flex-wrap:wrap`; input
  `flex:1 1 160px; min-width:0`; buttons `flex:0 0 auto; white-space:nowrap` so they never shrink/overflow.
- **Files:** `app/renderer/pages/Settings.tsx`, `app/renderer/styles/global.css`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` ✅. Reproduced in a faithful standalone HTML harness (real CSS + markup)
  and measured via DOM rects: BEFORE = 4 cols, **+80px** Reset overflow on every field; AFTER = 3 cols,
  **0px** overflow, no wrap. Forced a 300px cell → buttons wrap below the input (row 74px), still 0 overflow.
- **Result:** buttons align within each field; no cross-field overlap; degrades gracefully on narrow windows.

## 2026-07-14 — Claude — Custom AWKIT application frame (remove native Electron/Windows frame)

- **Task:** Remove the native OS title bar from the main window and replace it with an application-owned,
  theme-aware AWKIT title bar (brand + current area + window controls), integrated into the existing shell.
- **Main process:** `windowManager.ts` sets `frame: false` (security prefs untouched — contextIsolation on,
  nodeIntegration off) and forwards real `maximize`/`unmaximize`/`enter|leave-full-screen` to the renderer
  via `window:maximizedChanged` so the control state never drifts from the OS. New `ipc/window.ipc.ts`
  (`registerWindowIpc`, registered first in `ipc/index.ts`) exposes minimize / toggleMaximize / close /
  isMaximized, each resolving the window from `event.sender` (multi-window-safe, missing-window = no-op).
- **Preload:** added a narrowly-scoped `appWindow` domain (minimize/toggleMaximize/close/isMaximized +
  leak-free `onMaximizedChange` returning an unsubscribe). No `ipcRenderer`/`BrowserWindow`/Node exposed;
  `window.playwrightFlowStudio` identifier unchanged.
- **Renderer:** `layout/AppFrame.tsx` (thin draggable title bar; double-click toggles maximize) +
  `layout/WindowControls.tsx` (three caption buttons, inline SVG glyphs, `useWindowMaximized` seeds from
  `isMaximized()` then syncs via the event; maximize↔restore icon + aria label follow real state). `AppShell`
  now wraps the shell in `.app-window` with the frame on top.
- **Styling (`global.css`):** new `--titlebar-height: 36px`; `--shell-chrome` now includes it; `.app-shell`
  & `.left-navigation` heights adjusted; legacy `calc(100vh - 92px|132px|170px)` designer/scenario calcs
  updated to subtract the title bar. Frame + `.win-control` styling uses only design tokens; hover gated to
  fine pointers, close-hover = danger, press = instant wash (asymmetric), color-only motion (120ms ease-out).
- **Design/motion:** applied emil-design-eng + apple-design (immediate pointer-down feedback, restraint,
  theme-aware opaque material, no entrance motion on persistent chrome, interruptible CSS transitions).
  Strict `review-animations` pass: one press-immediacy finding fixed (`:active { transition:none }`) → **Approve**.
- **Files:** `app/main/windowManager.ts`, `app/main/ipc/window.ipc.ts`, `app/main/ipc/index.ts`,
  `app/main/preload.ts`, `app/renderer/layout/AppFrame.tsx`, `app/renderer/layout/WindowControls.tsx`,
  `app/renderer/layout/AppShell.tsx`, `app/renderer/styles/global.css`, `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean (tsc + 3 bundles); `verify:ipc-contract` **4/4** (125 handlers,
  the 4 new window channels have handlers, no dupes); `verify:canvas-perf` **13/13**; `verify:flow-designer`
  **24/24** (canvas fills the frame-adjusted height, panels contained, 0 console errors). Real Electron
  manual inspection (light + dark): native frame gone; maximize→restore icon sync; double-click toggle;
  minimize; close hover = red; Dashboard + Flow Designer stack cleanly under the frame; context label tracks
  the active route.
- **Not run / risks:** OS window *move* via drag confirmed by implementation (standard `-webkit-app-region:
  drag`; buttons + double-click on the region both fire) but not visually reproduced — synthetic drag input
  didn't drive the OS non-client move; no snap-layout hover flyout on the maximize button (would need a
  WM_NCHITTEST/titleBarOverlay hook). Automation browsers launched by Playwright are untouched.

## 2026-07-14 — Claude — Security follow-ups: Settings → Secrets UI (§15) + data-source read confinement verifier (§14)

- **Task:** Continue the security-audit remediation follow-ups — finish the DPAPI secret store (§15) and the
  data-source read confinement (§14). The backends were already implemented and passing (`verify:secrets`
  16/16); the gaps were the operator-facing **Settings → Secrets** UI and regression coverage for the
  data-source read guard.
- **Secret store UI (§15):** added a **Secrets** card to `Settings.tsx` — add/update by name (name pattern
  mirrored client-side as `SECRET_NAME_RE`, password-masked value input, Enter-to-add), delete-with-confirm,
  a stored-secret list (name + last-updated, no values), and a keystore-unavailable banner. Calls the existing
  name-only preload API (`window.playwrightFlowStudio.secrets.isAvailable/list/set/delete`); no channel returns
  a decrypted value. New token-only CSS (`.settings-secret-form/-list/-row`) — no hardcoded hex/px.
- **Data-source read (§14):** extracted the read-confinement decision into a pure predicate
  `isReadableDataSourceFile(runtimeRoot, dataSourcesDir, resolved)` in `src/utils/pathSafety.ts` and switched
  `dataSource.ipc.ts::assertReadableDataFile` to it (behavior unchanged: 25 MB cap + refuse runtime-internal
  files that aren't the data workspace). Added 6 regression checks to `verify-security.mts`.
- **Files:** `app/renderer/pages/Settings.tsx`, `app/renderer/styles/global.css`, `src/utils/pathSafety.ts`,
  `app/main/ipc/dataSource.ipc.ts`, `scripts/verify-security.mts`, `docs/security/FULL_SECURITY_AUDIT.md`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean (tsc + 3 bundles); `verify:security` **39/39** (+6 data-source
  read-confinement checks), `verify:secrets` **16/16**, `verify:data-editor` **27/27**, `verify:ipc-contract`
  **4/4** (129 handlers). Settings → Secrets card verified in a token-faithful standalone HTML harness (real
  `global.css`, all three states) via the Browser pane — computed styles confirm flex form, inset rows,
  right-aligned timestamps, danger banner, and **no horizontal overflow** in both light and dark themes.
- **Not run / risks:** real packaged-Electron DPAPI round-trip and the clean-machine GUI walkthrough (the
  Electron renderer can't be driven from the Browser pane; the harness proves layout only, not live IPC). The
  secret set/list/delete IPC path itself is covered by `verify:secrets`. Whole security batch remains
  uncommitted (local only) per the standing "do not push unless asked" note.

## 2026-07-14 — Claude — New Flow: name dialog + auto-open in Flow Designer

- **Task:** The Flows page **New Flow** button should pop a dialog to set the flow name, then create the
  flow and open it automatically in the Flow Designer with only a Start and End step.
- **Change:** Added reusable `app/renderer/components/shared/PromptDialog.tsx` (single-field modal:
  autofocus+select, Enter to confirm, Escape/overlay to cancel, confirm disabled until non-empty). Routed
  all three New/Create Flow triggers in `FlowLibrary.tsx` through a `namingFlow` state that opens the
  dialog. `createFlow(name)` now creates the Start→End-only flow with the entered name and calls the
  existing `openFlow(profile)` (persist `lastSelectedFlowId` + navigate to `flowChart`). Token-only CSS
  (`.modal-icon.create`, `.modal-field`) in `global.css`.
- **Files:** `app/renderer/components/shared/PromptDialog.tsx` (new), `app/renderer/pages/FlowLibrary.tsx`,
  `app/renderer/styles/global.css`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean (tsc --noEmit + main/preload/renderer bundles).
- **Not run / risks:** live Electron GUI walkthrough (Browser pane can't exercise `window.playwrightFlowStudio`
  IPC). Start/End scaffold unchanged, so no runner/verifier surface touched.

## 2026-07-14 — Claude — Workflows library + Workflow Builder header/toolbar cleanup

- **Task:** (1) header keeps only **Save** (remove New/Run); (2) disable Reload, Mode, and Parallel in the
  builder toolbar; (3) drop the **Max Parallel** column from the Workflows table; (4) remove the grey id line
  under each workflow name; (5) one line per row with full text in a title tooltip and per-row actions
  collapsed into a single "…" kebab menu; (6) **Create Workflow** opens a name modal, persists the workflow,
  then opens it in the builder; (7) the builder toolbar **New** does the same.
- **Change:** New shared factory `createBlankWorkflowProfile(name)` in `WorkflowProfile.ts` (Start→End
  scaffold, sequential defaults) — the single source both entry points use. **ScenarioBuilder.tsx:** header
  chrome trimmed to Save only; removed the now-dead `runWorkflow`; `#sb-new` and a new `namingWorkflow`
  `PromptDialog` route through `createNamedWorkflow` (create → list → `loadWorkflowProfile` → Saved); `#sb-reload`,
  Mode `<select>`, and Parallel `<input>` marked `disabled`. **WorkflowsLibrary.tsx:** removed the Max Parallel
  column (header/body/colgroup) + its adapter accessor and two filter fields; removed `<small>{id}</small>`;
  per-row action buttons replaced by a single `.wl-kebab` (`MoreVertical`) that opens the existing
  `NodeOptionsMenu` (Open in Builder / Clone / Export JSON / Delete-danger); Delete now uses `ConfirmDialog`;
  **Create Workflow** (toolbar + empty-state) opens a `PromptDialog` → `createWorkflow(name)` persists via
  `createBlankWorkflowProfile` + navigates to the builder. Token-only CSS: `.wl-table-workflows` single-line
  cells + `.wl-kebab`.
- **Files:** `src/profiles/WorkflowProfile.ts`, `app/renderer/pages/ScenarioBuilder.tsx`,
  `app/renderer/pages/WorkflowsLibrary.tsx`, `app/renderer/styles/global.css`,
  `scripts/verify-workflow-builder-gui.mjs` (New now names the workflow first), `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`.
- **Verification:** `npm run build` clean (tsc + 3 bundles). `verify:workflow-builder` **20/20** (updated
  section 3 drives the New name modal). Workflows library covered by a throwaway `_electron` walkthrough
  (**7/7**): no Max Parallel header, no id sub-line, one kebab per row opening the 4-action menu, Create
  opens the name modal, zero renderer console errors.
- **Not run / risks:** clean-machine packaged walkthrough. The `verify:workflow-builder` run now persists one
  blank "GUI New …" workflow per run (New persists by design) — cosmetic data-dir leftover only.

## 2026-07-16 — Claude — Runtime Observability & Historical Analytics (full phase set 01–09)

- **Task:** Build the production Runtime Observability & Historical Analytics layer per
  `AWKIT_RUNTIME_OBSERVABILITY_ANALYTICS_PHASES` (audit → data model → collection → per-workflow analytics →
  capacity/queue effectiveness → anomaly/regression → UI integration → retention → verification/soak/report).
- **Approach:** Extend the EXISTING durable telemetry stack (one SQLite store, one contract, one IPC surface)
  — migration v4, no second database. Reuse the existing samplers (no new polling loop). Environmental
  resource fields labelled as correlations, never per-workflow ownership.
- **Files:** `src/runner/store/RuntimeStoreSchema.ts`, `SqliteRuntimeStore.ts`, `RuntimeStore.ts`;
  new `src/reports/ObservabilityContracts.ts`, `src/reports/observabilityAggregation.ts`,
  `src/runner/runtime/RuntimeObservationCollector.ts`, `src/runner/runtime/AnomalyDetector.ts`;
  `src/runner/ExecutionEngine.ts`; `app/main/ipc/telemetry.ipc.ts`, `app/main/preload.ts`;
  `app/renderer/pages/ReportsRuntime.tsx`, `app/renderer/styles/global.css`;
  new `scripts/verify-observability.mts`, `package.json`, `scripts/verify-telemetry.mts` (v4 assertion);
  docs (`RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md`, `CURRENT_STATE.md`, `COMMANDS.md`, `.env.example`).
- **Tests run:** build clean; `verify:observability` 65/65; `verify:telemetry` 61/61; `verify:runner` 82/82;
  `verify:concurrency` 78/78; `verify:concurrency-defaults` 18/18; `verify:shared-browser-pool` 19/19;
  `verify:browser-isolation` 27/27; bounded Config-D real-engine soak (1.5 min) 299 done / 0 failed /
  teardown CLEAN / durable=live MATCH.
- **Not run / risks:** full ≥30-min production soak (documented pre-release gate); packaged-EXE walkthrough.
  Environmental attribution is correlation not ownership (labelled); capacity-window P95 is a bucketed ceiling.
- **Result:** Complete + verified; ON by default at measured-negligible overhead, bounded storage.

## 2026-07-16 — Codex — AWKIT violet application icon + valid multi-frame ICO

- **Task:** Use the supplied `logo-designer` skill and visual reference to create a premium AWKIT
  application icon using the specified indigo/violet/glass palette, preserve transparent alpha, remain
  legible at 16px, and export a Windows ICO containing every required frame.
- **Design:** explored three original SVG directions under `logos/awkit-violet/concepts/` (Orbit Flow,
  Browser Route, Reliable Path), selected Browser Route, and refined it into a bold browser frame with a
  three-node workflow and one restrained electric-blue execution point. No text, copied rosette, unrelated
  dominant color, or fine browser-control detail.
- **Assets:** added `logos/awkit-violet/preview.html`, final editable
  `iterations/iteration-1-browser-route.svg`, `export/logo.svg`, PNG exports at
  16/24/32/48/64/128/192/256/512/1024/2048px, and light/dark size-check evidence. Replaced
  `resources/icon-source.png`, `resources/icon.png`, and `resources/icon.ico`.
- **Exporter fix:** byte-level validation exposed that `png-to-ico` 2.1.0 omitted AND-mask bytes from
  ICO directory lengths/offsets. Replaced only that packing step in `scripts/generate-app-icon.mjs` with
  direct PNG-compressed ICO entries plus built-in validation of offsets, dimensions, 32-bit declaration,
  PNG signatures, and RGBA color type.
- **Verification:** `npm run icon:generate` passed; seven embedded ICO frames independently decoded at
  256/128/64/48/32/24/16px with 32-bit RGBA and transparent corners; master is 1024×1024 RGBA with 9.96%
  opaque padding; blue accent is 0.561% of opaque pixels; visual checks passed at 16–256px on light/dark
  backgrounds; `npm run build` passed; `npm run validate:offline` passed (development mode).
- **Not run:** packaged Electron/NSIS rebuild or clean-machine Windows icon-cache/taskbar walkthrough;
  those remain release-stage/manual checks and no runtime application behavior changed.
- **Result:** the repository now ships the requested AWKIT violet browser-workflow icon and a
  standards-compliant, validated multi-resolution Windows ICO.

## 2026-07-16 — Codex — Specter segmented-S Hologram application icon

- **Task:** Replace the prior browser-workflow icon direction with a premium iOS/macOS-style Specter icon:
  a front-facing 62%-canvas glass squircle, exact Hologram violet palette, and a bold geometric S made from
  separate rounded brick segments, with full 16–256px Windows legibility and a 1024px alpha master.
- **Design exploration:** used the supplied `logo-designer` skill to create three SVG concepts under
  `logos/specter-violet/concepts/`: ringed five-segment S, luminous eleven-brick S, and open-halo
  five-segment S. True-size checks eliminated the eleven-brick direction because its gaps compressed at
  16px. The ringed five-segment direction was refined with a larger S and quieter enclosure.
- **Final design:** `iterations/iteration-1-specter-ringed.svg` uses a 318×318 superellipse-style tile
  centered in a 512 viewBox (62.109%), near-black/violet glass depth, top-left sheen, a 10-unit
  lavender ring, and five off-white rounded rectangles forming the only visible S. No font/text element,
  warm hue, photographic texture, noise, or fine browser-control detail.
- **Assets:** added `logos/specter-violet/preview.html`, final/export SVG, PNGs at
  16/24/32/48/64/128/192/256/512/1024/2048px, and a light/dark size-check sheet generated from the
  actual embedded ICO frames. Replaced `resources/icon-source.png`, `resources/icon.png`, and
  `resources/icon.ico`.
- **Verification:** SVG XML/no-visible-text checks passed; `npm run icon:generate` passed; the 1024px
  master is RGBA with transparent corners; seven ICO frames independently decoded at
  256/128/64/48/32/24/16px as 32-bit RGBA with transparent corners; visual inspection passed at
  16–256px in light and dark contexts; `npm run build` passed; `npm run validate:offline` passed
  (development mode); AI memory validation passed.
- **Not run:** packaged EXE/NSIS rebuild and Windows taskbar/Explorer icon-cache walkthrough. No runtime
  logic or renderer behavior changed.
- **Result:** the application now uses the requested Specter segmented-S identity while preserving the
  hardened, validated Windows ICO pipeline.

## 2026-07-18 — Secure Login / Authorization / Machine-Licensing — PLAN ONLY (no code)
- **Agent:** Claude (Opus 4.8). **Task:** produce an implementation-ready design plan for adding secure
  authentication, RBAC authorization, Super-User administration, and per-machine signed licensing to AWKIT.
  **Explicitly planning-only — no production code created or modified.**
- **Inspected (grounding):** startup `app/main/main.ts` (splash coordinator + `passesOfflineStartupGate` = the
  pre-window init hook), state-machine router `app/renderer/App.tsx`/`routes.tsx` (no gate today → flash risk),
  IPC trust (`ipc/index.ts` global sender guard, `senderGuard.ts`, `windowManager.ts` will-navigate lockdown),
  storage (`SqliteRuntimeStore` + `RUNTIME_STORE_MIGRATIONS` + `DurableLockStore`; `JsonProfileStore`; DPAPI
  `secretStore.ts`/`SecretStore.ts`), machine identity (`MachineCapabilityDetector` — copyable random-UUID +
  hardware fingerprint), packaging (`electron-builder.json` portable+nsis, per-user, no admin), theme tokens
  (`global.css`, `AppFrame`). Noted the `auth`/`session` namespace collision (existing = automation OAuth/login
  sessions, NOT app login) → new subsystem uses `security`/`license` namespaces.
- **Deliverable:** `docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md` — 34 sections:
  exec summary, current assessment, gaps, arch, startup/routing, auth-provider abstraction (Local active / AD
  disabled-visible), virtual-user auth (scrypt), Super User, RBAC + permission registry, sessions, machine
  identity (augmented fingerprint), Ed25519 signed licenses (private key OFF client — Model 2), lifecycle,
  secure storage (sql.js `security.sqlite` + DPAPI wrap), schema+migrations, trust boundaries, IPC security,
  UI/UX, error handling, audit (hash-chained), threat model, 10-phase plan, file-by-file map, tests, migration,
  recovery, future AD, risks, acceptance, order, 10 open decisions.
- **Tests run:** none (planning task; no code). **Not done:** implementation (intentional).
- **Result:** plan committed to `docs/plans/`. Feature NOT implemented; 10 open decisions (O-1..O-10) need
  confirmation before Phase 1. Tracking bead `awkit-bn2`. Conservative git — nothing committed/pushed.

## 2026-07-18 — Machine fingerprint design spec (companion to secure-login plan §14) — PLAN ONLY
- **Agent:** Claude (Opus 4.8). Design-only; no production code. Deliverable:
  `docs/plans/MACHINE_FINGERPRINT_DESIGN.md`, cross-linked from the master plan §14.
- **Verified on the real host, non-elevated** (`IsInRole(Administrator)=False`): all four primary claims
  readable without admin — SMBIOS UUID (`Win32_ComputerSystemProduct`), BIOS serial (`Win32_BIOS`),
  MachineGuid (registry, no WMI), system disk serial (`Win32_DiskDrive` Index 0) — plus aux baseboard +
  C: volume serial. Raw values redacted/never persisted. Cost measured: registry ~0.17s, `vol` ~0.04s,
  3× CIM warm ~0.31s (cold ~0.9s) → collection must run async off the splash critical path.
- **Spec covers:** version envelope, claim model (status present/missing/restricted/placeholder/malformed),
  main-only collectors (batched CIM + cheap non-WMI paths, execFile timeout+AbortSignal, no wmic),
  normalization + placeholder denylist/heuristics, deterministic salted-hash-before-persist (raw discarded),
  weighted matching (SMBIOS .35/MachineGuid .30/disk .20/BIOS .15 + aux; bind ≥0.60 AND ≥1 strong anchor;
  degraded band 0.40–0.60), issuance trust gate (fail-closed), safe renderer contract (request code + status
  only), Crockford-base32 request code (hashes only), fail-closed + manual activation + signed admin-recovery
  token (private key stays off client), tests, privacy/VM-clone limits, 5 open decisions F-O-1..F-O-5.
- **Tests run:** none (design). **Result:** spec committed under docs/plans/. Not implemented. Conservative git.

## 2026-07-18 — Secure login trusted core (Phase 1+2 backend) IMPLEMENTED — branch feature/secure-login-auth
- **Agent:** Claude (Opus 4.8). **Epic:** awkit-ekd. **Scope chosen with user:** trusted core first
  (backend, headless-verified, no UI) on a dedicated branch.
- **Created (src/security/**):** errors/ReasonCodes, crypto/ColumnCrypto (+PassthroughColumnCrypto),
  crypto/PasswordHasher (scrypt), auth/{UsernameRules,PasswordPolicy,AuthTypes,AuthenticationProvider
  (+ActiveDirectoryProvider disabled stub),LocalVirtualUserProvider,AuthenticationService},
  session/SessionManager, store/{SecurityStoreSchema,SecurityStore} (sql.js + migrations + DPAPI-wrapped
  passwordSecret), ipc/SecurityIpcSchema (payload validators), SecurityKernel.
- **Created (app/main):** security/securityKernel.ts (safeStorage-backed ColumnCrypto singleton),
  ipc/security.ipc.ts (sender-guarded, schema-validated, fail-closed). **Modified:** ipc/index.ts
  (register), preload.ts (`.security` namespace — `playwrightFlowStudio` identifier untouched; distinct
  from automation `auth`/`session`), main.ts (dispose on quit). **Created:** scripts/verify-auth.mts;
  package.json `verify:auth`.
- **Tests run:** `npm run verify:auth` **41/41**; `npm run build` (tsc --noEmit + electron-vite) clean;
  `verify:ipc-contract` 4/4 (172 handlers, security channels exposed); `verify:secrets` 16/16,
  `verify:security` 39/39 unaffected. **Not run:** verify:runner (unrelated live runner; untouched),
  packaged-EXE (external gate), any GUI (no UI in this slice).
- **Self-review (code-review skill, high):** 5 findings. Fixed now: fail-closed try/catch on
  getBootState/getLoginOptions kernel-open failure; removed dead `instanceof InvalidPayloadError` branch.
  Deferred to beads: awkit-ekd.6 (cross-process single-writer lock + requestSingleInstanceLock),
  awkit-ekd.7 (revoke other sessions on password change), awkit-ekd.8 (debounced persistence).
- **Result:** trusted core complete + verified. **Nothing committed** (conservative git; new branch
  feature/secure-login-auth shares the working tree with the in-flight Oracle changes — security files are
  all new/isolated). Next: authorization (Phase 3) or login UI (Phase 6) per user direction.

## 2026-07-18 — Secure login UI (Phase 6) IMPLEMENTED — branch feature/secure-login-auth
- **Agent:** Claude (Opus 4.8). **Epic:** awkit-an7 (closed). Built the renderer login UI on the verified
  trusted core; user direction "build the login UI next".
- **Created (app/renderer/security/):** SecurityGate (state machine loading/unavailable/firstRun/login/
  forcedChange/authed; themes pre-auth; re-validates session on focus/visibility), LockedShell,
  SessionContext (+useSession), reasonMessages (safe reason→copy, generic fallback), components/PasswordField
  (show/hide + Caps-Lock), screens/{LoginScreen (AD disabled "Coming soon" tab, uniform errors, duplicate-submit
  guard), FirstRunSetup (one-time SU → auto sign-in), ForcedPasswordChange, SecurityUnavailable (fail-closed)}.
- **Modified:** main.tsx (render SecurityGate instead of App), layout/AppFrame.tsx (title-bar user chip +
  sign-out via SessionContext; no chip pre-auth), styles/global.css (+~280 lines `.awkit-login-*` /
  `.app-frame-session`, token-only, light/dark, reduced-motion). No IPC/preload/backend changes.
- **No-flash:** protected `<App/>` (and all routes) mount only in the `authed` state; GUI verifier asserts
  `.app-shell` is absent on every pre-auth surface.
- **Tests run:** `npm run verify:auth-gui` **13/13** real Electron (isolated temp %LOCALAPPDATA%): no-flash,
  first-run→shell, session chip+sign-out→login, AD disabled/coming-soon, re-login, 0 console errors +
  screenshots reports/security-login/{login,authed-shell}.png. `npm run build` clean; `verify:auth` 41/41;
  `verify:ipc-contract` 4/4. **Not run:** packaged EXE (external gate); dark-mode visual pass (bead awkit-l6h).
- **Follow-up bead:** awkit-l6h (proactive idle-lock activity tracking + dark-mode login screenshot assertion).
- **Result:** login flow complete and verified in the real app. **Nothing committed** (conservative git).

## 2026-07-17 — Claude — Install & integrate Codebase Memory MCP + Beads

- **Task:** Install, configure, verify, and document two persistent project-memory tools — Codebase Memory
  MCP (code-structure knowledge graph) and Beads (`bd`, task/blocker tracker) — for this repo, preserving all
  existing config/hooks/instructions and excluding generated/runtime/binary content.
- **Codebase Memory MCP (v0.9.0):** ran the official DeusData `install.ps1` (inspected first; checksum-verified
  binary → `%LOCALAPPDATA%\Programs\codebase-memory-mcp`). It auto-configured Claude Code **globally**
  (`~/.claude/.mcp.json` single entry; PreToolUse Grep/Glob augmenter + SessionStart/SubagentStart user hooks;
  `codebase-memory` skill). Set `auto_index`/`auto_watch=true`. Authored root-anchored `.cbmignore` (source dirs
  that share names with runtime dirs — `src/reports/` etc. — are kept). Indexed `--mode full` (no persistence):
  ~8,750 nodes / ~20,500 edges, 23 dirs excluded, langs TS/HTML/Java/TOML/SQL/CSS/YAML. Verified architecture,
  entry points, preload boundary, `trace_path`, and `detect_changes` (40 files → 924 impacted symbols) against
  real source (`oracle.ipc.ts` callees matched).
- **Beads (v1.1.0, Dolt embedded):** ran the official gastownhall `install.ps1` (inspected; checksum-verified
  → `%LOCALAPPDATA%\Programs\bd`, added to User PATH, `beads.exe` alias). `bd init --prefix awkit` +
  `bd setup claude` added a project `SessionStart` hook (`bd prime`) and merged a managed block into `CLAUDE.md`
  — the existing `Stop` hook (`check-memory.mjs`) and original CLAUDE.md content were preserved. Metrics off;
  JSONL auto-export on. Seeded a backlog (setup epic + real Oracle work `awkit-jz5`/`awkit-cm8`); CRUD +
  dependencies + `bd remember` verified. `bd init` made one scoped commit (`a4ce464`) of `.beads/` scaffolding.
- **Files changed:** new `.cbmignore`, `docs/ai/CODEBASE-MEMORY-AND-BEADS.md`, `.beads/**`; modified `.gitignore`,
  `CLAUDE.md`, `.claude/settings.json`. **No application source (`app/`, `src/`) changed.** Config backups saved
  to the session scratchpad.
- **Verification:** both tools' versions/config confirmed; all touched JSON + `config.yaml` parse cleanly.
- **Not run / remaining:** a one-time Claude Code **restart** is required before the `mcp__…` graph tools load
  in-session (the CLI works now). Codebase Memory config is global/machine-specific (not portable to teammates).
- **Result:** both tools installed, verified, and documented; Beads is the authoritative active-work tracker.

## 2026-07-18 — Claude (Opus 4.8) — Oracle: user-selected Java runtime + direct JDBC, remove UCP (epic awkit-kzo, WS-D..I)

- **Task:** completed the approved epic (branch `feature/oracle-jdbc-driver-settings`). WS-A/B/C were done in
  prior sessions; this session finished **WS-D → WS-I**. Model: Specter no longer bundles Java or UCP — the
  user selects a Java runtime + imports an ojdbc driver in Settings → Database Drivers; Oracle runs via direct
  JDBC (one connection per query, no pool). Full report:
  [`ORACLE_USER_SELECTED_JAVA_REMOVE_UCP_REPORT.md`](ORACLE_USER_SELECTED_JAVA_REMOVE_UCP_REPORT.md).
- **WS-D — live 7/7 + concurrency:** re-provisioned an ephemeral `SPECTER_READER` out-of-band (never printed),
  ran `verify:oracle-live` **7/7** real mode via the Settings Java-runtime+bundle path (`Local-JDK-17` 17.0.8 +
  `Oracle-ojdbc17-local-19c-validation` 23.26.2.0.0). Deterministic cancellation now uses a per-row concat+LIKE
  over a ~8.5M-row 3-way cross join (Oracle can't cardinality-shortcut it). `verify:oracle-direct-jdbc` 23/23.
- **WS-E — GUI 30/30:** new `verify:oracle-drivers-gui` (real Electron via Playwright `_electron`, resolves the
  main window past the branding splash). Both Database Drivers cards render; `testBridge` launches the bridge
  with the selected Java and loads the **real ojdbc 23.26.2.0.0**; deletion guard; no secrets; 0 console errors.
  Screenshots in `reports/oracle-validation/database-drivers-*.png`.
- **WS-F — packaging:** rewrote `prepare-oracle-runtime.mjs` + `oracle-runtime.manifest.json` to stage ONLY the
  bridge jar; `OracleOfflineBundle.ts` + `validate-offline-bundle.ps1` now **reject** a bundled JRE/driver
  (inverse of the old "driver required" gate); `.gitignore` ignores all of `resources/oracle-jdbc/`. Real
  `prepare:oracle-runtime → validate:offline` loop green ("0 optional compile jar(s)"). runtime-prep 14/14,
  offline-bundle 11/11, packaging 23/23. `electron-builder.json` unchanged (generic copy carries the bridge jar).
- **WS-G — regression:** build clean; 13 non-GUI Oracle verifiers **350/350**; cross-cutting ipc-contract 4/4,
  settings-persistence 3/3, profile-store 13/13, secrets 16/16, data-editor 27/27, concurrency 78/78,
  cancellation 12/12. Found + fixed a **pre-existing branding-splash regression** breaking `firstWindow()`-based
  GUI verifiers (filed a bd bug for the others; fixed `verify-settings-persistence.mjs`).
- **WS-H — soak:** new `benchmark:oracle-jdbc` — ≥30-min direct-JDBC soak through the live path + the app's
  `OracleQueryService` limiter; measures latency P50/P95, cancellation latency, bridge+Node RSS, teardown
  invariants; asserts no pool metrics. Redacted artifact `reports/oracle-validation/oracle-soak.json`.
- **WS-I — docs:** updated CURRENT_STATE, COMMANDS, ORACLE_JDBC_RUNTIME_MATRIX (now selection-model
  compatibility/setup), ORACLE_JDBC_VALIDATION_GATES (cleared gates), wrote the 19-section report, deleted the
  obsolete ORACLE_LIVE_VALIDATION_RESUME.md, appended this entry.
- **Tests run:** `npm run build`; all `verify:oracle-*` (350 non-GUI + live 7 + GUI 30); `validate:offline`;
  cross-cutting regression above; 30-min soak. **Not run:** packaged-EXE build (dev host OOMs on
  electron-builder) + clean-machine walkthrough; sustained real-world soak — external gates.
- **Result:** epic complete → **PRODUCTION-CANDIDATE**. Nothing committed (conservative git profile, ephemeral
  branch); handoff reports the changed-file set + proposed commit for approval.
  > **Superseded same day:** this branch was committed and merged to `main` via PR #14 (`79e20a5`) later on
  > 2026-07-18. See the audit entry below — this log entry's "nothing committed" is stale.

## 2026-07-18 — Claude Sonnet 5 — Full-stack release-readiness audit (`fullstack-webapp-testing` skill)

- **Task:** ran the `fullstack-webapp-testing` skill's audit + safe-tests + release-gate workflow against
  `main` @ `93162d6`. Full report: `test-artifacts/2026-07-18-release-readiness-audit/full-test-report.md`
  (+ `system-map.md`, `execution-summary.json` in the same folder). Tracked as beads `awkit-7s5`.
- **State correction:** the Oracle WS-D..I entry directly above, and `docs/ai/HANDOFF.md`'s "Current
  Handoff" section, both describe the Oracle driver-settings work and the Secure Login trusted-core+UI
  work as uncommitted. That changed later the same day: **both merged to `main`** — PR #14 Oracle
  (`79e20a5`) and PR #15 Secure Login (`93162d6`). Working tree is clean on `main`. `CURRENT_STATE.md` and
  `HANDOFF.md` were **not** rewritten as part of this audit (kept out of scope to avoid a rushed partial
  edit) — flagged as the top follow-up action in the report instead.
- **Safe tests executed today (fresh evidence):** `npm run build` clean (tsc + 3 bundles); `verify:ipc-
  contract` 4/4; `verify:security` 39/39; `verify:secrets` 16/16; `verify:auth` 41/41 (headless secure-login
  core); `verify:profile-store` 13/13; `verify:write-queue` 7/7; `verify:mock-site` 39/39; `verify:auth-gui`
  13/13 (real Electron); `verify:runner` 82/82 (real Chromium, core E2E). Manual read-only secret-pattern
  scan of tracked source (excl. `node_modules`/`out`/`dist`/`vendor`): 4 regex hits, all confirmed benign
  (1 `ReasonCodes.ts` constant, 3 mock/test-fixture credentials in `seed-mock-fixtures.mjs` and two Oracle
  verifier/benchmark scripts). `.env` confirmed gitignored; `.env.example` placeholder-only; no `.pem/.pfx/
  .p12/.key/id_rsa/.env` tracked in git.
- **Defect confirmed (not new — reproduced an open bug):** `verify:reports` fails (`Target page, context or
  browser has been closed` waiting for `.awkit-report-page`), reproducing `awkit-gmn` (branding-splash
  breaks `app.firstWindow()`-based GUI verifiers). Confirmed via the codebase graph that
  `resolveMainWindow()` already exists in `verify-oracle-drivers-gui.mjs`, `verify-settings-persistence.mjs`,
  and `verify-auth-gui.mjs` (all pass), but not yet in `verify-reports-gui.mjs` or (per `awkit-gmn`, not
  independently re-checked) `verify-flow-designer-gui.mjs`, `verify-workflow-builder-gui.mjs`,
  `verify-instance-monitor-gui.mjs`, `verify-capacity-settings-gui.mjs`, `verify-runtime-analytics-gui.mjs`.
- **Not run (scope/time — see report for full reasoning):** the Oracle 350+-check suite, the concurrency/
  stress/soak suite, packaging/offline validation, the 5 other "likely affected" GUI verifiers, Recorder/
  Smart-Wait/popup/canvas-perf/Chromium-hardening suites, automated accessibility scanning (none exists in
  this repo), and any destructive/load/production test (none authorized or applicable to a local
  single-user desktop app).
- **Result:** **CONDITIONAL GO** for `main` as a development/integration checkpoint (no P0/P1 found; every
  critical journey tested today passed with fresh evidence). Explicitly **not** a production-ship verdict —
  the project's own pre-existing, already-tracked external gates (clean-machine offline VM walkthrough,
  code-signed packaged EXE, Oracle live perf/soak under the new architecture) remain un-run and unchanged
  by this audit. Filed no new beads (used existing `awkit-gmn`/`awkit-ekd.6`/`awkit-ekd.7`); `awkit-7s5`
  (this audit) closed with the report as its resolution.

### 2026-07-22 — Claude Code — Session-outcomes close-out (awkit-cxa P1, awkit-y24 P2, awkit-4km C1, §8 hardening)

- **Task:** work the approved close-out plan for `SESSION_OUTCOMES_REPORT.md` (tracker:
  `SESSION_OUTCOMES_CLOSEOUT.md`), on `feature/recorder-protected-login-and-async-awareness`.
- **awkit-cxa (P1) FIXED:** designer round-trip preserves a bare `FlowStep.value` losslessly via a
  designer-only `valueSourceType: "none"` sentinel (`flowStepMapping.ts`, `flowDesignerTypes.ts`); the two
  pinned "KNOWN DEFECT" checks were inverted. Files: `flowStepMapping.ts`, `flowDesignerTypes.ts`,
  `FlowNodePropertiesPanel.tsx`, `verify-flow-step-mapping.mts`.
- **awkit-y24 (P2) IMPLEMENTED:** new `anyOf` OR-group `WaitCondition` (extends the union). Runner
  `executeWaitCondition` resolves via `Promise.any`; `clampWaits` recursion; `reviewWait` rollup; designer
  editor refactored to `(wait, update)` + "+ OR group" button + token CSS. Files: `FlowProfile.ts`,
  `StepExecutor.ts`, `FlowValidation.ts`, `asyncCompletionReview.ts`, `FlowNodePropertiesPanel.tsx`,
  `global.css`, `verify-waits.mts`, `verify-flow-step-mapping.mts`.
- **awkit-4km C1 IMPLEMENTED:** new `apiPolling` `WaitCondition` (202 → poll-to-terminal). Runner
  `resolveApiPolling` observes the page's poll responses; designer editor + "Poll" scaffold; mock-site
  `/api/job`. WS/SSE + CDP stay deferred. Files: `FlowProfile.ts`, `StepExecutor.ts`,
  `asyncCompletionReview.ts`, `FlowNodePropertiesPanel.tsx`, `mock-site/server.mjs`, `verify-waits.mts`,
  `verify-flow-step-mapping.mts`, `verify-mock-site.mjs`.
- **§8 coverage hardening:** added round-trip coverage for all 10 `valueSource` variants, compound locator
  `alternatives`/`context`, edge→`next`, config breadth, pinned multi-key-outputs limitation. This
  surfaced + **fixed** two more awkit-cxa-class drops (`generated`, `secret`).
- **Verification (all green):** `verify:flow-step-mapping` 94/0, `verify:waits` 56/0, `verify:async-review`
  21/0, `verify:recorder` 78/0, `verify:recorder-flow` 19/19, `verify:runner` 82/0, `verify:protected-login`
  26/0, `verify:protected-login-recorder` 45/45, `verify:mock-site` 58/58, `verify:ipc-contract` 4/4, `tsc`
  0, `npm run build` 0, `check-memory` pass.
- **Not run / gates:** `verify:settings-persistence` (blocked — a dev Electron instance holds the
  single-instance lock; not force-killed); packaged installer + `validate:offline` -Strict (packaging host
  gate); packaged-renderer visual paint + GUI check 11.3 walkthrough (need screen access). No commit/push
  (conservative profile — awaiting approval).
## 2026-07-21 — Claude — Randomized Automation Test Lab: Phases 1-3 + Phase 0 prerequisites (epic `awkit-wza`)

- **Task:** build the generation/oracle/round-trip layers of the randomized test lab, then take
  Phase 0 (`awkit-wza.1`).
- **Files:** new `src/testing/{random,oracle,roundtrip,fixtures}/**`, `scripts/verify-random-{generator,oracle,roundtrip}.mts`,
  `app/renderer/components/workflow/flowProfileMapping.ts`, `docs/testing/RANDOMIZED_TESTING_{ARCHITECTURE,IMPLEMENTATION_PLAN}.md`,
  `mock-site/public/{runner-lab,iframe-lab,iframe-child,index}.html`, `mock-site/server.mjs`,
  `mock-site/README.md`; modified `app/renderer/pages/FlowChartDesigner.tsx` (extraction),
  `scripts/verify-durable-store.mts` (stale assertions), `scripts/verify-mock-site.mjs`.
- **Tests run:** `npm run build` passed; `verify-random-generator` 49/49; `verify-random-oracle`
  19 passed / 1 failed (real defect `awkit-acw`); `verify-random-roundtrip` 8 passed / 15 failed by
  design; `verify:mock-site` 65/65; `verify-durable-store` 11/11 (was 10/1);
  `check-memory.mjs` passed.
- **Not run:** `verify:runner`, `validate:offline`, packaged-EXE and clean-machine gates — no runner
  or packaging behavior changed. Phase 5 (live execution) is not built, so no generated flow has yet
  been executed against a browser.
- **Result:** Phases 1-3 complete and Phase 0 complete. 15 defect issues filed under epic
  `awkit-wza`; the 13 round-trip defects are blocked on Phase 0 in Beads because the fix lands in
  the newly extracted mapping module. Two verifiers are intentionally red and must stay that way
  until their product defects are fixed.

## 2026-07-21 — Claude — Fix RT-14 value/valueSource flattening (`awkit-1w5`, also closes `awkit-ihx`)

- **Task:** the most severe round-trip defect — `fromFlowStep` collapsed `FlowStep.value` and
  `FlowStep.valueSource` into one designer string, and `createValueSource` rebuilt a typed source
  from it. `step.url` headed the recovery chain, so a `goto`'s source was overwritten by its URL.
- **Key insight:** the properties panel only authors `static` and `dynamic` (FlowNodePropertiesPanel
  line 80 collapses every other kind to "static"). The other seven kinds come from the Recorder,
  imports, or hand-edited profiles — so the designer must *preserve* them, not re-derive them.
- **Files:** `app/renderer/components/workflow/flowDesignerTypes.ts` (new `valueSourceOriginal`),
  `flowProfileMapping.ts` (`createValueSource` passes non-authorable kinds through; `fromFlowStep`
  keeps `value` as the literal only; `toFlowStep` no longer persists `url: ""`),
  `FlowNodePropertiesPanel.tsx` (read-only hint naming a preserved source),
  `src/testing/roundtrip/RoundTripDefectCatalog.ts` (RT-02 and RT-14 entries deleted),
  `scripts/verify-random-roundtrip.mts` (8 new edit-path assertions),
  `src/testing/random/RandomConfigurationGenerator.ts` (no plaintext `url` beside a secret source).
- **Tests run:** `npm run build` passed; `verify:flow-designer` 24/24 in real Electron;
  `verify-random-roundtrip` 8+15 → **17 passed / 12 failed** (still red by design, 0 unexpected new
  failures, defect shapes 46 → 35, "secret references survive the round trip" now passes);
  `verify-random-generator` 49/49; `verify-random-oracle` 19+1; `verify-durable-store` 11/11;
  `verify:mock-site` 65/65.
- **Not run:** `verify:runner`, `validate:offline` — no runner or packaging behavior changed.
- **Result:** RT-14 and RT-02 fixed and their catalog entries deleted, so a recurrence now reports
  as a regression rather than a known baseline. 11 round-trip defects remain.

## 2026-07-21 — Claude — HANDOFF prepared (Randomized Automation Test Lab)

- **Task:** prepare the repository for the next agent/human after the test-lab session.
- **Files:** `docs/ai/HANDOFF.md` (new dated block at the top: branch table, active task, completed work,
  the two intentionally-red verifiers, remaining work, risks, do-not-touch; the stale mid-file "clean main"
  status marked SUPERSEDED), `docs/ai/CURRENT_STATE.md` (RT-14/RT-02 fix + branch reality),
  `docs/ai/COMMANDS.md` (the three lab verifiers, with their expected-failure counts and the note that no
  npm aliases exist yet), `docs/ai/TASK_LOG.md` (this entry).
- **Repository state recorded:** working tree clean; `main` unchanged at `382847c`;
  `chore/brand-logo-5b` @ `a1adcc2` (owner checkpoint) and `feature/randomized-test-lab` @ `562c29b`
  (6 commits) both **local, unpushed, no PRs**.
- **Checks run:** `git status --short --branch` (clean), `git diff --stat` (empty),
  `node scripts/ai-memory/check-memory.mjs` (pass).
- **Result:** `docs/ai/HANDOFF.md` is current and agent-agnostic. No secrets, tokens or credentials were
  written to any Markdown file.

## 2026-07-21 — Claude — Test Lab Tranche 1: fix all round-trip data-loss defects (RT-01…RT-15)

- **Task:** make the Flow Designer persistence round-trip lossless — fix the 11 observed + 2 predicted
  round-trip defects catalogued by Phase 3, without weakening any assertion. First tranche of the approved
  plan (`.claude/plans/write-a-plan-to-refactored-wirth.md`), checkpoint-based rollout.
- **Approach:** the designer *preserves* fields it cannot author rather than re-deriving them (extends the
  RT-14 `valueSourceOriginal` pattern). All fixes land in the single mapping
  `app/renderer/components/workflow/flowProfileMapping.ts`.
- **Files:** `flowProfileMapping.ts` (all mappings: locator gate RT-01, popup/safety/loop/message
  pass-through RT-03/04/15, edge id+label RT-05/08, flow `meta` arg RT-06/07, `maxLoopCount` RT-11,
  section-gated `toNodeConfig` RT-09, edit-safe absent-field omission RT-10, full outputs map RT-12,
  retained dynamic ids RT-13); `flowDesignerTypes.ts` (pass-through fields + `absentOnLoad`);
  `FlowChartDesigner.tsx` (thread `flowMeta` + persisted `edge.id`, `createdAt` fallback on save);
  `RandomConfigurationGenerator.ts` (exercise RT-13 discriminator mix + RT-15 `message`/`loop`);
  `RoundTripDefectCatalog.ts` (emptied — all 13 entries deleted per its own rule; now a regression guard);
  `scripts/verify-random-roundtrip.mts` (stale "expected to fail" comments updated; +8 field-edit
  regression checks).
- **Tests run:** `verify-random-roundtrip` **26 passed / 0 failed** (was 8/15) · `verify-random-generator`
  **49/0** · `verify-random-oracle` **19/1** (intentional gap `awkit-7fm`) · `verify-durable-store`
  **11/11** · `verify:flow-designer` **24/24 real Electron** · `verify:runner` **82/0** · `npm run build`
  clean · `check-memory` pass.
- **Not run:** `validate:offline` (no packaging/offline behavior changed).
- **Beads:** closed `awkit-abi/4t9/3lq/07c/3qs/ani/7df/ao6/who/o4q/x8w` (11 observed defects).
- **Result:** the Phase-3 round trip is lossless; the intentionally-red baseline verifier is green and now
  serves as a regression guard. No assertion was tuned, skipped or weakened; no lost field was excluded.
  RT-10 was made edit-safe (a user edit to a previously-absent field is always persisted). Tranche 1
  checkpoint — paused for review before Tranche 2 (unified validation, an architectural checkpoint).


## 2026-07-21 — Claude — Test Lab Tranche 2 Stage 2a: pure Flow Validation Engine

- **Task:** build the shared `FlowValidator` (all 9 missing rules + reachability + active-path
  classification), add `verify-validation.mts`, and rewire the Phase-2 oracle so every known validation
  gap is detected. Explicitly behavior-neutral: nothing wired into save/run/import/designer/builder, no
  flow file or schema changed, no Legacy Compatibility state, no auto-fix or migration.
- **Approach:** one pure engine in `src/validation/` that *wraps* the existing
  `validateConnectorStructure` (leaving the enforced runtime gate untouched) and adds the flow-level
  rules. Reachability is a forward BFS from Start, lifted from `verify-random-generator.mts`; it drives
  both `unreachableNode` and every issue's `onActivePath` flag. The engine is verdict-free — callers
  decide blocking policy. Locator/value requirements moved into an exhaustive `Record<StepType, …>` so
  the compiler, not a reviewer, catches drift.
- **Files:** NEW `src/validation/FlowValidator.ts`, `src/validation/StepRequirements.ts`,
  `scripts/verify-validation.mts`, `docs/plans/FLOW_VALIDATION_ENGINE_DESIGN.md`; MODIFIED (test lab only)
  `src/testing/oracle/TestExecutionOracle.ts` (drives the engine, `productionEnforced` flag, 9 gaps →
  detected, `PRODUCTION_UNENFORCED_RULES`), `src/testing/random/RandomMutator.ts` (one-line-class fix,
  below), `scripts/verify-random-oracle.mts` (engine negative control, active-path section, Stage 2b
  checklist in the report). **No production runtime file was touched.**
- **Tests run:** `verify-validation` **99/0** (new) · `verify-random-oracle` **26/0** (was 19/1) ·
  `verify-random-roundtrip` **26/0** · `verify-random-generator` **49/0** · `verify:runner` **82/0** ·
  `verify:profile-store` **13/13** · `verify:ipc-contract` **4/4** · `verify:workflow-sentinels` **4/4** ·
  `npm run build` clean.
- **Not run:** `validate:offline` (no packaging/offline change), `verify:flow-designer` GUI (no renderer
  change), live GUI walkthrough.
- **Defects found:** (1) the `missingRequiredValue` mutation was a **no-op on `runFlow`** — it cleared
  `value`/`valueSource`/`url`, but the runner resolves `step.flowId ?? step.config?.targetFlowId`
  (`StepExecutor.ts:955`), so the mutated flow stayed valid and the oracle scored "correctly undetected"
  against a flow that was never broken. Fixed in the mutator so every `requiresValue` type gets a real
  defect. (2) Loop-bound cap is inconsistent in the product: `FLOW_BOUNDS.maxLoopIterations` is 10_000
  while the designer gate and `LOOP_CONNECTOR_HARD_CAP` are 1_000; the engine uses 1_000 and the
  divergence is left for Stage 2b.
- **Beads:** `awkit-lqe` (Stage 2a) closed. `awkit-7fm` and `awkit-acw` stay OPEN — detection is proven,
  production enforcement is Stage 2b.
- **Result:** Stage 2a checkpoint. Every controlled defect class is now detected by a validator, but 10 of
  those rules are engine-only; the oracle asserts that exact set so it cannot be mistaken for product
  coverage. Paused for review before Stage 2b (wiring — a real behavior change).

## 2026-07-21 — Claude — Test Lab Tranche 2 Stage 2b: wire the validation engine into production

- **Task:** make `FlowValidator` the single validation source for the run gate, designer, builder,
  library and import, per the approved Stage 2b spec. Product decisions implemented: canonical loop cap
  1,000 (`src/validation/FlowLimits.ts`; `FLOW_BOUNDS` aligned from 10,000; no silent validation clamp);
  structured connector findings (`validateConnectorStructureDetailed`, string form wraps it); test-lab
  `runFlow` generator derives `config.targetFlowId` from `flowId`.
- **Runtime gate:** `PreRunValidator` rewritten as a thin adapter — flow rules delegated to
  `validateFlowSet`, hardcoded locator list deleted (`awkit-acw`), issues carry
  `blocking/code/flowId/nodeId/edgeId/onActivePath`, `isRunBlocked` is the one policy call.
  Blocking = active-path errors + all connector-structure errors (runtime refuses those flow-wide —
  documented deviation). Scoped to scenario flows + transitive runFlow closure, fixing a pre-existing
  bug where any broken library flow blocked every run.
- **Files:** NEW `src/validation/FlowLimits.ts`; MODIFIED `src/validation/FlowValidator.ts`,
  `src/profiles/FlowProfile.ts` (detailed findings), `src/profiles/FlowValidation.ts`,
  `src/runner/FlowExecutor.ts` (cap constant only), `src/reports/PreRunValidator.ts` (rewrite),
  `app/main/ipc/execution.ipc.ts`, `app/main/ipc/flow.ipc.ts` (+import validation),
  `app/main/preload.ts`, `app/renderer/pages/FlowChartDesigner.tsx` (draft save, chip+issue panel,
  navigation, advisories), `ScenarioBuilder.tsx` (save-block removed, engine findings surfaced),
  `FlowLibrary.tsx` (Checking→derived status), `InstanceMonitor.tsx` (structured failure message),
  `Toast.tsx` (+info tone), `global.css`, test lab (`TestExecutionOracle.ts`,
  `RandomConfigurationGenerator.ts`, `ConnectorCatalog.ts`), verifiers (`verify-validation.mts` +25,
  `verify-random-oracle.mts`, `verify-random-generator.mts`, `verify-profile-store.mts` +3,
  `verify-flow-designer-gui.mjs` +13, `verify-canvas-perf.mjs` harness repair).
- **Tests run:** `verify-validation` **124/0** · `verify-random-oracle` **27/0** ·
  `verify-random-generator` **49/0** · `verify-random-roundtrip` **26/0** · `verify:runner` **82/0** ·
  `verify:flow-designer` **37/37** (real Electron: draft save, graph unchanged, chip, issue navigation,
  gate validationFailed with structured issues, scoped validation, library Checking→derived, no
  persisted verdict) · `verify:workflow-builder` **20/20** · `verify:canvas-perf` **13/13** ·
  `verify:profile-store` **16/16** · `verify:instance-monitor` **43/0** · `verify:ipc-contract` **4/4** ·
  `verify:workflow-sentinels` **4/4** · `npm run build` clean.
- **Not run:** `validate:offline` (no packaging change), packaged-EXE walkthrough.
- **Defects found:** (1) pre-existing: `validateWorkflow` validated the ENTIRE flow library, so any
  broken draft blocked every run — fixed by scoping. (2) pre-existing: `verify-canvas-perf` drove
  `firstWindow()` (now the splash, no preload) against the developer's real profile (now auth-gated) —
  repaired onto the isolated harness. (3) test-lab: generator could emit `runFlow` steps whose `flowId`
  and `config.targetFlowId` disagreed — fixed + invariant test.
- **Beads:** closed `awkit-7fm`, `awkit-acw`, `awkit-nmg`.
- **Result:** Stage 2b checkpoint. No Legacy Compatibility persistence, no auto-fix, no migration
  subsystem (all Stage 2c). Paused for review before Stage 2c.

## 2026-07-22 — Claude — Test Lab Tranche 2 Stage 2c: Legacy Compatibility + migration subsystem

- **Task:** complete the staged enforcement model — off-path errors block under the full gate unless an
  explicit, time-limited, audited Legacy Compatibility grant tolerates them; add the suggested-fix
  migration subsystem (preview, backup, confirm, report, undo) and the inventory scan.
- **Approach:** two new PURE modules so the policy is testable and shareable —
  `src/validation/LegacyCompatibility.ts` (content hash, grant standing, `effectiveVerdict`, inventory
  classification, grant planning) and `src/validation/SafeFixApplier.ts` (the only code that mutates a
  flow, restricted to an exhaustive switch of schema-migration fields). The main-process
  `FlowValidationService` owns storage and ceremony and is deliberately **electron-free** so
  `verify-legacy-compat.mts` drives the real service against temp folders.
- **Files:** NEW `src/validation/LegacyCompatibility.ts`, `src/validation/SafeFixApplier.ts`,
  `app/main/validation/flowValidationService.ts`, `app/main/validation/index.ts`,
  `app/main/ipc/validation.ipc.ts`, `scripts/verify-legacy-compat.mts`; MODIFIED
  `src/validation/FlowValidator.ts` (casing fixes for every enum family; fixed inverted field paths),
  `src/reports/PreRunValidator.ts` (grant-aware blocking + never-silent compatibility warning),
  `app/main/ipc/execution.ipc.ts` (ensureInventoryScan, grants, run auditing),
  `app/main/ipc/index.ts`, `app/main/preload.ts`, `app/renderer/pages/FlowChartDesigner.tsx`
  (validate-on-load banner, preview dialog, undo), `FlowLibrary.tsx` (IPC-sourced status + Legacy
  pill), `global.css`, `scripts/verify-validation.mts` (3 assertions retargeted to the 2c policy),
  `scripts/verify-flow-designer-gui.mjs` (+22 checks, 2 retargeted).
- **Tests run:** `verify-legacy-compat` **90/0** (new) · `verify-validation` **125/0** ·
  `verify-random-oracle` **27/0** · `verify-random-generator` **49/0** · `verify-random-roundtrip`
  **26/0** · `verify:runner` **82/0** · `verify:flow-designer` **56/56** · `verify:workflow-builder`
  **20/20** · `verify:canvas-perf` **13/13** · `verify:profile-store` **16/16** ·
  `verify:instance-monitor` **43/0** · `verify:authz` **40/0** · `verify:ipc-contract` **4/4** ·
  `verify:workflow-sentinels` **4/4** · `npm run build` clean.
- **Not run:** `validate:offline` (no packaging change), packaged-EXE walkthrough.
- **Defects found:** (1) migration ids and backup paths were `flowId.timestamp` — two migrations in the
  same millisecond collided and the second would have OVERWRITTEN the first's backup (the one artifact
  that must never be lost); ids are now uniquified. Found by the frozen test clock. (2) Stage 2a latent
  bug: `safeFix.field` was inverted between conditional and loop-condition operators — descriptive-only
  then, a silent no-op the moment an applier consumed it; both directions now pinned.
- **Beads:** closed `awkit-9xb`. Epic `awkit-wza` Tranche 2 complete.
- **Result:** Stage 2c checkpoint. Enforcement is complete and recoverable: nothing auto-fixes, nothing
  is destroyed, every exemption is explicit, time-limited, content-bound and audited.

## 2026-07-22 — Claude — Tranche 2 hardening: SHA-256 grant binding + packaged validation

- **Task:** replace the FNV-1a content hash behind Legacy Compatibility grants with SHA-256 at a
  trusted boundary; safely handle pre-hardening records; harden the inventory scan; then build a fresh
  package and validate the whole subsystem packaged, on clean and upgrade profiles. Status stays
  INTEGRATION-CANDIDATE.
- **Hash:** canonicalization stays PURE (`canonicalFlowContent` — sorted keys, dropped `undefined`,
  preserved array order, over `{version, nodes, edges}`); the digest is SHA-256 computed in
  `app/main/validation/contentDigest.ts` (`node:crypto`) and injected, so `src/` still imports no Node
  built-ins. Digests are tagged `sha256:` so stored records are self-identifying.
  `PreRunValidator.legacyCompatibility.digestFor` is required for any grant to be honored — omitting
  it fails closed.
- **Old records:** a non-current digest yields standing `legacyDigest` (never honored, distinct from
  `edited`), is revoked as `digestFormatRetired` for audit, and is **not replaced** — no deadline
  extension, no auto-created grant, and a retired record cannot be revived by re-scanning.
- **Scan hardening:** single-flight `runInventoryScan`; serialized grant writes; scan record written
  last so a failure leaves no record, no grants, and retries; the run gate applies the strict gate if
  the scan or grant store fails.
- **Files:** NEW `app/main/validation/contentDigest.ts`, `scripts/verify-packaged-validation.mts`;
  MODIFIED `src/validation/LegacyCompatibility.ts`, `src/reports/PreRunValidator.ts`,
  `app/main/validation/flowValidationService.ts`, `app/main/ipc/validation.ipc.ts`,
  `app/main/ipc/execution.ipc.ts`, `app/renderer/pages/FlowChartDesigner.tsx`,
  `scripts/verify-legacy-compat.mts` (+48), `scripts/verify-validation.mts`,
  `scripts/verify-packaged-runtime.mts` (splash-window fix), docs.
- **Package:** `dist/SpecterStudio 0.1.0.exe`, built 2026-07-22T00:32:12+03:00, 325,296,994 bytes,
  sha256 `129833754870f5fa2663efa48b979aaecaf1532831f20805a5b3f6537264c1fb`.
- **Tests run:** `verify-legacy-compat` **138/0** · `verify-packaged-validation` **87/0** (new) ·
  `verify:packaged-runtime` **25/0** (was 12/10) · `verify-validation` **125/0** ·
  `verify-random-oracle` **27/0** · generator **49/0** · roundtrip **26/0** · `verify:runner` **82/0** ·
  `verify:flow-designer` **56/56** · `verify:workflow-builder` **20/20** · `verify:canvas-perf`
  **13/13** · `verify:profile-store` **16/16** · `verify:authz` **40/0** · `verify:ipc-contract`
  **4/4** · `validate:offline -Strict` pass · `npm run build` clean.
- **Not run:** clean offline VM walkthrough (the outstanding gate), NSIS installer, sustained soak.
- **Defects found:** (1) pre-existing — `verify:packaged-runtime` used `firstWindow()`, which lands on
  the splash window that has no preload API, so 10 packaged runtime assertions had been failing;
  fixed by resolving the window that carries the preload bridge. (2) Two harness bugs in the new
  packaged suite (asserting `legacyDigest` after retirement had already made it `revoked`; picking an
  edited flow for the expiry test, where `edited` correctly outranks `expired`) — both fixed, and the
  `legacyDigest` standing is now additionally asserted pre-scan.
- **Beads:** closed `awkit-xy3`.
- **Result:** hardening checkpoint. Status remains
  `INTEGRATION-CANDIDATE — packaged validation and SHA-256 grant binding pending` per instruction;
  both named items are now done, and the remaining gate is the clean offline VM walkthrough.

## 2026-07-22 — Claude — Tranche 2 hardening checkpoint 2: status/manifest cleanup, script type gate, scale probe, installer

- **Task:** correct the status string; resolve the dependency-manifest working-tree change; close the
  `scripts/` type-check gap; add a 1,000-flow scale probe; build+validate the NSIS installer; run the
  final clean-machine environment gate before Phases 4–8.
- **Status:** corrected to `INTEGRATION-CANDIDATE — clean offline VM and installer validation pending`
  across CURRENT_STATE, the design doc and the Tranche 2 report. Committed separately (`336a3a2`).
- **Manifest:** `resources/dependency-manifest.json` is generated packaging output (buildMode/builtAt
  rewritten by every package/prep script) — restored to the committed `development-offline-prep`
  baseline, not committed. Working tree clean.
- **Script type gate (`cb13f8b`):** NEW `tsconfig.scripts.json` + `npm run typecheck:scripts` +
  `verify:all-typecheck`; found 36 real errors in never-type-checked scripts, all fixed narrowly
  (signature/CFA-only). One real src/ bug: `NullRuntimeStore` (RuntimeStore.ts) declared zero-arg
  methods its interface defines with params — aligned. NEW `build-oracle-bridge.d.mts` types the JS
  helper. Every touched verifier re-run green (runner 82/0, auth 49/0, popup 12/0, telemetry 61/0,
  operation-limiters 10/0, secrets 16/0, validation 125/0, runtime-status 15/0).
- **Scale probe (`measure-inventory-scale.mts`, 1000 flows, packaged, 9/0):** scan 4.24s, renderer
  round-trip median 4ms / worst 177ms (mild stall during 250 serial grant writes — measured, not
  thresholded), peak tree RSS 231MB, 250 grants (sha256-bound), 1 scan record; concurrent run
  requests during init all waited safely (single-flight); re-scan extended no deadline.
- **Artifacts (both NotSigned per Authenticode):** portable `dist/SpecterStudio 0.1.0.exe`
  325,296,994 B sha256 129833754870f5fa2663efa48b979aaecaf1532831f20805a5b3f6537264c1fb; NSIS
  `dist/SpecterStudio Setup 0.1.0.exe` 373,904,285 B sha256
  74950020d105af9b5f188d09a467d1ad297fbfc064b12cabe9931f1c4e6e2a5a, sha512 matches latest.yml,
  per-user/no-elevation.
- **Environment gate NOT run:** re-confirmed no clean-machine capability (WindowsSandbox.exe absent;
  Sandbox feature-enable needs elevation the non-admin agent account lacks; no provisioned guest VM).
  The clean-VM walkthrough + installer install/upgrade/uninstall lifecycle + standard-user/offline
  test remain the human gate. Added a Tranche 2 validation-subsystem checklist as
  `PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3b. The packaged validation I ran DID execute under a standard
  (non-admin) account.
- **Not run:** clean-machine walkthrough, installer install/upgrade/uninstall lifecycle, max-compressed
  distributables, signing, sustained soak.
- **Beads:** `awkit-xy3` already closed (checkpoint 1). No new bead — this is the same hardening scope.
- **Result:** Tranche 2 is **NOT** marked COMPLETE and Product is **NOT** advanced — both are
  conditioned on the environment gate passing on a genuine clean machine, which this agent environment
  cannot provide. Everything runnable here is green; the remaining gate is the documented human
  walkthrough.

## 2026-07-22 — Claude — Clean-machine validation runbook + status wording

- **Task:** produce a standalone clean-machine validation runbook for a qualifying Windows
  environment, and set the authoritative status wording. No product changes; preserve commits,
  artifacts, checksums, logs and reports unchanged.
- **Delivered:** `CLEAN_MACHINE_VALIDATION_RUNBOOK.md` (repo root, standalone) — environment/standard-
  user constraints, both artifact hashes + NotSigned status, offline setup, clean-profile and
  upgrade-profile procedures, portable + NSIS install/upgrade/uninstall checks, the full
  validation/grants/migration/backup/restart/undo scenario matrix, expected pass/fail (blockers vs
  findings), evidence-to-collect, and a result template (tester, machine, Windows version, account
  privilege, start/end, blockers, findings, final recommendation). Every clean-machine step is
  labelled **Not Executed**; the runbook makes no pass claims.
- **Status wording set** in CURRENT_STATE.md: `Tranche 2: IMPLEMENTED AND VERIFIED ON THE DEVELOPER
  MACHINE — CLEAN-MACHINE ACCEPTANCE PENDING`; `Product promotion: NOT YET APPROVED`; remaining gate =
  clean offline Windows environment validation. Prior evidence explicitly labelled developer-machine
  only, not clean-machine.
- **Not changed:** no product code; the four Tranche 2 commits and three hardening commits, the built
  artifacts, their checksums, and the historical reports/logs are unchanged.
- **Result:** checkpoint stopped as instructed. Promotion is gated on a successful runbook execution
  in a qualifying environment. Nothing pushed; no PR.

## 2026-07-26 — Codex — REC-018 real Recorder E2E gate

- **Task:** resume the comprehensive validation handoff at the decisive missing Recorder journey:
  Recorder page → browser → capture → Stop → Save → restart/reopen → production replay, then repeat
  after a Flow Designer save.
- **Implemented:** `scripts/verify-recorder-e2e.mjs` plus `verify:recorder-e2e`; isolated real Electron
  first-run/auth, bundled Chromium, rendered Recorder controls, persisted flow/workflow, full restart,
  Flow Library UI reopen, production `ExecutionEngine`, exact log/report step order, designer
  metadata comparison, second replay, timestamped screenshots/logs/reports/result ledger.
- **Honesty control:** added a local resettable `/api/rec018/*` mock-site oracle. It accepts only the
  fixed synthetic form fields. The fixture remains inert without the Recorder binding; state is reset
  after capture and before each replay, preventing the page from self-fulfilling the run assertion.
- **Result:** `verify:recorder-e2e` **41 PASS / 0 FAIL**. Evidence:
  `test-artifacts/recorder-e2e/2026-07-26T08-59-26-977Z/`.
- **Regressions:** `verify:mock-site` 90/90, `verify:recorder` 78/0, `verify:recorder-flow` 19/19,
  `verify:recorder-draft` 17/17, `typecheck:scripts` and production build PASS.
- **Preflight correction:** an initial run failed because isolated `LOCALAPPDATA` also hid the
  developer Playwright browser cache. The gate now uses the supported `PRODUCTION_OFFLINE=true`
  path and therefore validates the bundled browser used by release builds. This was a harness
  configuration issue, not a product defect.
- **Security:** no CAPTCHA/MFA/protected login was attempted or bypassed; authentication password was
  checked absent from run logs/reports. `.beads/*` remained untouched.

## 2026-07-26 — Codex — Populated System Reports gate and fixes

- **Task:** continue the comprehensive validation at System Reports with real persisted data,
  drill-down, export, authorization, path safety, reporting and evidence.
- **Pre-fix gate:** new `scripts/verify-reports-populated-gui.mts` seeded real SQLite/report stores and
  drove the real Electron renderer/preload/IPC boundary. Negative control: **44 PASS / 13 FAIL**,
  evidence `test-artifacts/reports-populated-gui/2026-07-26T09-16-20-217Z/`.
- **Defects fixed:** `AWKIT-REP-001` (S2) added sender-bound `PAGE_REPORTS` authorization to every
  telemetry/report read and `REPORT_EXPORT` to export/open; `AWKIT-REP-002` (S2) aligned Run
  Artifacts with the real stored-report contract, added trusted export/open bridges, exported the
  full stored report, and hid/denied actions for Viewer. Folder open accepts only an existing report
  id and resolves the configured folder in the main process.
- **Harness correction:** Electron blob anchors did not emit Playwright's download event. The gate
  now observes the real blob bytes and anchor filename without suppressing the click, persists those
  bytes, parses them, and checks identity/instances/redaction (`HARNESS-009`).
- **Result:** **64 PASS / 0 FAIL**, evidence
  `test-artifacts/reports-populated-gui/2026-07-26T09-30-15-417Z/`, including five screenshots,
  fixture truth, full exported JSON, and assertion ledger.
- **Regressions:** Reports 31/31, telemetry 61/61, observability 65/65, Runtime Analytics 36/36,
  real-Electron RBAC 51/51, IPC contract 4/4, type-check, script type-check and production build PASS.
  A first parallel RBAC/Runtime launch collided during Electron startup; serial reruns passed and no
  orphan process or port remained.
- **Truthful case status:** only SYS-REP-002/003 move to PASS. Partially executed report cases retain
  `NOT RUN`; actual Explorer launch, full compare/live/fault/audit/accessibility submatrices were not
  executed. Reports are 5 PASS / 11 NOT RUN; combined focused ledger is 43 NOT RUN.
- **Security:** no CAPTCHA, MFA, protected login, external site or Oracle credential was touched.
  `.beads/*` remained unstaged and unmodified by this work.

## 2026-07-26 — Codex — Settings real-Electron gate and fixes

- **Task:** continue the comprehensive validation at Settings with every section, sender-bound
  authorization, validation, paths, Secrets GUI, counts, import/export, reset/data safety,
  restart/recovery and accessibility evidence.
- **Pre-fix gate:** new `scripts/verify-settings-e2e.mts` seeded representative product data and
  synthetic secrets in a timestamped isolated profile, then drove the real Electron
  renderer/preload/main boundary. Complete negative control: **81 PASS / 33 FAIL**, evidence
  `test-artifacts/settings-e2e/2026-07-26T09-49-23-933Z/`.
- **Defects fixed:** `AWKIT-SET-001` (S2) added `PAGE_SETTINGS`/`SETTINGS_EDIT` checks to unguarded
  Settings/Secrets/folder operations; `AWKIT-SET-002` (S2) made validation authoritative on the
  main-owned write path, rejected array imports, pruned unknown fixed-schema keys and capped GUI
  import at 1 MB; `AWKIT-SET-003` (S3) stopped treating files as writable directories;
  `AWKIT-SET-004` (S3) added live error semantics plus modal focus trap/Escape/return.
- **Result:** **116 PASS / 0 FAIL**, evidence
  `test-artifacts/settings-e2e/2026-07-26T09-55-38-176Z/`, including four screenshots, exact exported
  JSON and machine-readable assertion ledger. Synthetic secret values were not printed or retained
  in the result ledger.
- **Harness corrections:** incomplete early verifier-development runs are not evidence. A 114/116
  post-fix run exposed stale-banner/timing selectors; correcting those observation points without a
  production change yielded the final 116/116.
- **Regressions:** Settings persistence 3/3, RBAC 51/51, HTTPS 31/31, capacity 12/12, accent 33/33,
  branding 30/30, Oracle Drivers 30/30, Flow Designer 56/56, Workflow Builder 20/20, secrets 16/16,
  authorization 40/40, IPC contract 4/4, type-check, script type-check and production build PASS.
- **Truthful case status:** SET-001/018 move to PASS. Settings are 9 PASS / 12 NOT RUN; combined
  focused ledger is 41 NOT RUN. Partial cases keep explicit residual picker, live runner/session,
  fault, inventory and accessibility submatrices `NOT RUN`.
- **Security:** no CAPTCHA, MFA, protected login, external site or Oracle credential was touched.
  `.beads/*` remained unstaged and unmodified by this work.

## 2026-07-27 — Codex — Phase E Workflow Builder import-from-file

- **Task:** complete `awkit-d3c`, the final Phase E gap: import workflow JSON from the Builder with
  shared validation and confirm-before-overwrite behavior in Builder, Library, and IPC.
- **Implemented:** added pure `validateWorkflowProfile` structural validation; added IPC validation,
  collision recheck/error code, and explicit `allowOverwrite`; added hidden file input, dirty-canvas
  discard confirmation, destructive collision confirmation, safe cancel/Escape behavior, and
  success load/list refresh to the Builder; aligned the Workflows Library import path.
- **Verification coverage:** `verify-workflow-sentinels.mts` now checks valid/missing-field/dangling-
  endpoint/missing-flowId/mutation cases. `verify-workflow-builder-gui.mjs` now drives real
  `setInputFiles()` and proves replacement, Cancel, Escape, different-name collision text, invalid
  file isolation, and dirty-canvas ordering by node/edge containment.
- **Files:** `src/profiles/workflowProfileValidation.ts`, `app/main/ipc/scenario.ipc.ts`,
  `app/main/preload.ts`, `app/renderer/pages/{ScenarioBuilder,WorkflowsLibrary}.tsx`,
  `scripts/verify-{workflow-sentinels,workflow-builder-gui,roadmap-dashboard}.*`,
  `src/roadmap/ImplementationRoadmap.ts`, `tools/roadmap/assignments.json`, and AI memory docs.
- **Checks:** `npm run build` PASS; `npm run verify:workflow-sentinels` **11/11**;
  `npm run verify:workflow-builder` final **28/28**; `npm run verify:roadmap-dashboard` **135/135**
  with **Sources agree**; AI memory check PASS. Two development runs caught and corrected a mojibake
  verifier literal and an early transient canvas sample; no product assertion was weakened.
- **Result:** Phase E is **complete**; roadmap is 9 complete / 0 in progress / 2 partially completed
  (**82%**). Validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**.

## 2026-07-29 — Codex — One-time Super User recovery code

- **Task:** complete `awkit-aty`: generate a show-once recovery code during first-run bootstrap and
  provide an audited login-screen reset for the protected Super User.
- **Implemented:** 128-bit ambiguity-free code generation and normalization; scrypt hashing inside
  the existing DPAPI-backed column wrapper; security-store migration v3; trusted pre-auth IPC and
  preload bridge; atomic password rotation, lockout clearing, code consumption, and full-session
  revocation; one-time acknowledgment and recovery/reset renderer surfaces.
- **Verifier compatibility:** every clean-profile GUI/package verifier now acknowledges the new
  first-run gate. The focused real Electron auth walkthrough additionally proves the code is shown
  before the shell, wrong/reused codes fail, reset succeeds, and the old password stops working.
- **Files:** `src/security/{auth,ipc,store}/`, `app/main/{ipc/security.ipc.ts,preload.ts}`,
  `app/renderer/security/`, `app/renderer/styles/global.css`, authentication/GUI/package verifier
  scripts, roadmap assignment source, and AI memory docs.
- **Checks:** auth **64/64**; auth GUI **25/25**; e2e auth **30/30**; authz **59/59**; session
  context **11/11**; security **39/39**; IPC contract **4/4**; script typecheck and production build
  PASS.
- **Result:** `awkit-aty` closed. Validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**;
  beads are **118 total / 10 outstanding / 108 closed**.

## 2026-07-29 — Codex — RBAC v2 custom roles and per-user overrides

- **Task:** complete `awkit-gsf`: admin-defined custom roles plus direct per-user permission grant/deny
  overrides without weakening the trusted authorization boundary.
- **Implemented:** security-store migration v4; custom role and permission persistence; role admin
  service; create/update/delete IPC and preload APIs; custom-role-aware authorization/principal
  snapshots; direct overrides with deny precedence; session revocation, reauth, audit, built-in-role
  immutability, and protected-SU safeguards.
- **UI:** Roles now supports custom-role CRUD, Permissions includes custom roles, and Users provides
  a tri-state Inherit/Grant/Deny access editor. Custom role names replace opaque ids in user chips;
  access/edit/delete dialogs support focus management and Escape.
- **Checks:** authz **77/77** including persistence/reopen; admin GUI **18/18**; real Electron RBAC
  **51/51**; auth **64/64**; IPC contract **4/4**; script typecheck and production build PASS.
- **Result:** `awkit-gsf` closed. Validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**;
  beads are **118 total / 9 outstanding / 109 closed**.

## 2026-07-29 — Codex — Active Directory authentication provider

- **Task:** complete `awkit-i3e` by replacing the disabled AD stub with a secure, opt-in provider
  behind the existing authentication abstraction while preserving offline-first behavior.
- **Implemented:** pinned Node-18-compatible `ldapts` with the vulnerable transitive `uuid` patched by
  a narrow override; trusted `AWKIT_AD_*` configuration; certificate-validated LDAPS/StartTLS direct
  UPN bind; pre-provisioned AWKIT-user mapping; safe invalid/outage results; selectable provider UI.
- **Session/auth protections:** migration v5 persists `authProvider`; AD sensitive-op reauth returns
  to AD; domain passwords are not persisted/logged or substituted for the local fallback hash; local
  forced-password-change remains local-provider-only; directory outages do not increment lockout.
- **Offline/security:** disabled, incomplete, plaintext-LDAP, or malformed configuration creates no
  LDAP client and causes no egress. There is no renderer configuration path, automatic account
  creation, TLS bypass, background refresh, or directory-driven privilege assignment.
- **Checks:** auth **79/79**; auth GUI **25/25**; e2e auth **30/30**; authz **77/77**; IPC contract
  **4/4**; build, script typecheck, and `validate:offline` PASS. The initial parallel Electron attempt
  collided with the intentional single-instance guard; serial reruns passed. `npm audit --omit=dev`
  confirms the introduced LDAP/UUID findings are gone; three pre-existing Vite/PostCSS findings remain.
- **Not run:** a live enterprise AD/DC with real certificates/domain policy was unavailable, so that
  environment interoperability is not claimed.
- **Result:** `awkit-i3e` closed. Validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**;
  beads are **118 total / 8 outstanding / 110 closed**.

## 2026-07-29 — Codex — Oracle persisted-workflow real mode and blocker reconciliation

- **Task:** remove the remaining local engineering gap from blocked `awkit-7bu`, then reconcile all
  outstanding tracker states so owner/manual/external work is not advertised as ready engineering.
- **Implemented:** `verify-oracle-mock-ui-workflow` now reads live configuration only when requested,
  requires the complete credential set plus explicit non-production confirmation, resolves the
  Settings-managed Java/driver path, requires real JDBC mode, and runs the same persisted Data Source,
  flow, workflow, query service, production ExecutionEngine, and Chromium campaign.
- **Fail-closed/security:** partial, invalid, missing-driver, incompatible-Java, bridge, or database
  failure never falls back to the mock executor. The password is redacted from summary, runner,
  bridge, service, and mock-site evidence; it is never printed.
- **Checks:** default database-free campaign **7 PASS / 0 FAIL / 1 BLOCKED**; script typecheck PASS.
  A complete dummy localhost live request failed as expected before execution, recorded real mode,
  did not fall back, and persisted no password canary.
- **Tracker:** the engineering-gap note on `awkit-7bu` is corrected; it remains blocked only on its
  authorized operator/credential lifecycle. `awkit-1cc`, `awkit-8ri`, `awkit-az7`, `awkit-cm8`,
  `awkit-wza.8`, and parent `awkit-wza` are now truthfully blocked instead of open/ready.
- **Result:** `bd ready` is empty. Validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**;
  beads remain **118 total / 8 outstanding / 110 closed**.

## 2026-07-30 � Antigravity � Extend Graphify graph-first retrieval to all three agents

- **Task:** Configure the same Graphify knowledge graph for Claude Code (already done), Codex, and
  Antigravity (Google Gemini). Reinstall the graphify tool venv (lost after prior install). All three
  agents now use the shared graphify-out/graph.json before broad searches.
- **Graphify version:** upgraded from 0.9.30 to 0.9.31 via uv tool install "graphifyy[sql]" --force.
- **Install commands run:**
  - graphify codex install � appended ## graphify section to AGENTS.md; created .codex/hooks.json.
  - graphify antigravity install � created .agents/rules/graphify.md, .agents/workflows/graphify.md;
    installed global skill at %USERPROFILE%\.gemini\config\skills\graphify\.
  - graphify install --platform agents � installed cross-framework skill at %USERPROFILE%\.agents\skills\graphify\.
- **Manual additions:**
  - GEMINI.md � added ## graphify � graph-first code retrieval section (parallel to CLAUDE.md).
  - .codex/config.toml � added graphify doc comment; multi_agent left commented out (Codex CLI not
    installed locally; version cannot be confirmed).
  - docs/ai/GRAPHIFY.md � updated version (0.9.31), project files table (all three agents), added �9
    multi-agent integration section.
  - docs/ai/CURRENT_STATE.md � updated graphify section header for multi-agent coverage.
- **Graph rebuild:** graphify update . � 11356 nodes (+92), 23164 edges (+204), 611 communities (+6).
  New nodes include the added Markdown instruction files and the new rule/workflow files.
- **Checks run:**
  - graphify --version ? 0.9.31 ?
  - graphify query "How does AWKIT execute a workflow?" --budget 3000 ? 327 nodes, StepExecutor,
    PlaywrightRunner.runFlowWithChildren(), FlowExecutor.executeWithRetry(), IPC contract docs ?
  - graphify explain "window.playwrightFlowStudio" ? docs/ai/DECISIONS.md L337 ?
  - graphify path "FlowProfile" "JsonProfileStore" ? 2-hop path via profileStores.ts ?
  - git diff --check ? CRLF normalization warnings only (pre-existing .gitattributes behaviour) ?
  - 
pm run build ? bundles pass (pre-existing dynamic-import warning in vite, not this task) ?
  - 
pm run verify:source-hygiene ? 9/9 ?
  - 
pm run verify:verifier-classification ? classification reconciled ?
  - 
pm run validate:offline ? bundle validation pass (no new production deps) ?
  - 
pm run verify:roadmap-dashboard ? 135/135, banner reads "Sources agree" ?
- **Not run:** 
pm run verify:runner (runner/orchestrator not changed); 
pm run verify:mock-site
  (mock-site not changed).
- **Boundaries confirmed:** no npm dependency added; no app or runner code imports graphify; no secrets
  or mutable user data in graph; all existing agent instructions preserved (additive merges only).
- **Result:** All three agents now have graph-first retrieval configured. Validation ledger unchanged
  at 62 PASS / 3 NOT RUN / 1 BLOCKED; beads unchanged.

## 2026-07-31: Implement Recorder ambiguity resolution schema + preflight (awkit-aui.1)

- **Agent:** Antigravity (Google)
- **Task:** Implement `awkit-aui.1` (Increment 1 of the Recorder ambiguity-resolution epic AWKIT-REC-030).
- **Files changed:** `src/profiles/FlowProfile.ts` (added `LocatorResolution` and metadata to `StepLocator`), `src/recorder/buildRecordedFlow.ts` (default to `needs-review` for `isUnique:false`), `src/validation/FlowValidator.ts` (added `locatorNeedsReview` rule blocking execution before launch), `app/renderer/components/workflow/flowDesignerTypes.ts` & `app/renderer/components/workflow/flowProfileMapping.ts` (round-trip DTO). Also fixed verifier tallies in `CURRENT_STATE.md`, `HANDOFF.md`, and edge counts in `verify-roadmap-dashboard.mjs`.
- **Tests run:** `npm run build` PASS, `npm run verify:runner` 89/89 PASS, `npm run verify:all-typecheck` PASS, `npm run verify:roadmap-dashboard` 135/135 PASS.
- **Result:** `awkit-aui.1` closed. Ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED; beads 135 total / 16 outstanding / 119 closed.

## 2026-08-01: Implement Recorder capture enrichment and landmark/href strategies (awkit-aui.2)

- **Agent:** Antigravity (Google)
- **Task:** Implement `awkit-aui.2` (Increment 2 of the Recorder ambiguity-resolution epic).
- **Files changed:** `src/recorder/RecorderTypes.ts` (added `interaction` field for metadata), `src/recorder/recorderInitScript.ts` (captured `composedPath()` host chain, exact pointer coordinates, and matched-candidate index. Natively integrated landmark role (`nav`/`main`/etc.) and `href`-based semantic scoping within `detectContainer`), `mock-site/public/recorder-lab.html` (added `nav-landmark` twins scenario), `scripts/verify-recorder-locator.mts` (updated assertion to allow compound/container disambiguation).
- **Tests run:** `npm run build` PASS, `npm run verify:recorder-locator` 114/114 PASS, `npm run verify-recorder-flow` 19/19 PASS, `npm run verify:all-typecheck` PASS.
- **Result:** `awkit-aui.2` closed. Ledger unchanged; beads updated.

## 2026-08-01: Implement Ambiguity UI and Positional Guard (awkit-aui.3 & 4)

- **Agent:** Antigravity (Google)
- **Task:** Implement Increments 3 (Ambiguity Resolution UI) and 4 (Positional Security Guard) for AWKIT-REC-030.
- **Files changed:** src/runner/StepExecutor.ts (added positional approval check and dangerousMutation guard), src/runner/LocatorFactory.ts (added user-approved-fallback event), scripts/verify-recorder-locator.mts (added positional guard test cases).
- **Tests run:** npm run verify:recorder-locator 119/119 PASS, npm run verify:runner 89/89 PASS, npm run verify:all-typecheck PASS.
- **Result:** Ambiguity UI and positional guards are fully enforced. Tests pass.

## 2026-08-01: Plan and start awkit-f3l; answer the awkit-hj8 manifest audit

- **Agent:** coding agent (Claude Code)
- **Task:** Resume `awkit-f3l` (licensing revalidation dispositions + verification hardening) and
  prepare `awkit-hj8` (dependency-manifest provenance audit). Planning and audit completed;
  implementation started.
- **Findings (all confirmed in source, not inferred):**
  - `cancel-pending` is discarded on revalidation — `licensing.ipc.ts:79-86` returns
    `getLicenseStatusView()`, whose `LicenseEnforcementView` (`licenseRuntime.ts:132-140`) has no
    `activeRunDisposition`. The disposition is acted on only at `execution.ipc.ts:289`, i.e. only on a
    new run request.
  - Revalidation is renderer-only (`StatusBar.tsx:75-77`) and gated on `LICENSE_VIEW`
    (`StatusBar.tsx:38-43`), so Operator/Viewer sessions never revalidate. `app/main/**` has no
    `setInterval` and no `browser-window-focus` handler.
  - `ExecutionEngine.processQueue` (`:1051-1207`) never consults licensing; `promoteQueued` (`:1098`)
    and `startPending` (`:1148`) keep advancing queued→pending→running, and `cancelPendingInstances`
    (`:1955`) deliberately will not touch a `running` instance — so a one-shot sweep cannot hold.
  - **New:** `repeatInstance` bypasses licensing entirely — `execution.ipc.ts:117-125` has no gate and
    `ExecutionEngine.ts:1991` calls `runInstance` directly, "bypassing the queue".
  - **New:** `verify-test-lab-cli-only.mts` not only exits 0 on BLOCKED (`:215`) but asserts the
    boundary holds (`:206`) from an artifact scan that never ran, and misses 0-byte file targets. The
    same exit defect exists at `verify-packaged-licensing.mts:350` and
    `verify-packaged-walkthrough.mts:1255`.
  - `packaged-license.mts:166` passes an env-supplied key path through `cmd.exe` via `shell: true`.
    Three sibling `npx tsx` sites share the pattern.
  - `awkit-hj8`: the committed manifest **verifies** (Ed25519, `node scripts/offline-manifest-signature.mjs verify`
    exits 0); `validate:offline` genuinely runs that check (`validate-offline-bundle.ps1:61-64`); no
    private key is tracked on any ref; `sourceCommit` is 17 commits behind HEAD and **nothing compares
    it to HEAD**; and **no written policy exists** for whether the pair should be committed.
- **Files changed:** `src/licensing/RunGateEnforcement.ts` (new — pure enforcement latch),
  `src/runner/DispatchGate.ts` (new — injected dispatch-veto contract), `docs/ai/HANDOFF.md`,
  `docs/ai/TASK_LOG.md`. Both new modules are inert; nothing calls them yet.
- **Tests run:** `npm run build` **PASS** (typecheck + bundles);
  `node scripts/offline-manifest-signature.mjs verify` **exit 0**.
- **Not run:** every verifier suite. No behavioral change has landed, so there is nothing for them to
  cover; `verify:licensing`, `verify:runner`, `verify:test-lab-cli-only`,
  `verify:verifier-classification`, `verify:roadmap-dashboard` and `validate:offline` remain owed.
- **Result:** `awkit-f3l` stays `IN_PROGRESS` with an approved plan recorded in `HANDOFF.md`;
  `awkit-hj8` stays open with its audit questions answered and a corrective action decided
  (document the policy + add a release-mode provenance gate; do not touch the committed pair).
  Ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED. Nothing committed or pushed.

## 2026-08-02: Add a liveness floor to the dispatch-gate shell scan

- **Agent:** coding agent (Claude Code)
- **Task:** Post-merge review of `d2df8e3` (`awkit-f3l`) found one residual vacuity hole in the new
  `verify:license-dispatch-gate` verifier.
- **Finding:** `scripts/verify-license-dispatch-gate.mts` asserted `shellTrue.length === 0` over
  `walkScripts(join(root, "scripts"))` with **no cardinality guard on the scan list**. If the walk ever
  returned empty — moved directory, changed extension filter, read error — the `shell: true` guard would
  report "no shell interpretation anywhere" while reading nothing. The sibling `appSources` scan in the
  same file is protected by accident, because its `setterOccurrences === 1` assertion fails on an empty
  list; the scripts scan had no such backstop. `scripts/verify-test-lab-cli-only.mts:81-94` already
  demonstrates the liveness pattern this was missing.
- **Files changed:** `scripts/verify-license-dispatch-gate.mts` (+8), `docs/ai/CURRENT_STATE.md`,
  `docs/ai/HANDOFF.md`, `docs/ai/TASK_LOG.md`.
- **Threshold provenance:** floor of 150 derived from a measured 224 files under `scripts/` on
  2026-08-02, recorded in the code comment so the next person raises it rather than lowering it to
  match a failure.
- **Tests run:** `verify:license-dispatch-gate` **34/34** (was 33/33); `typecheck:scripts` PASS;
  `verify:verifier-classification` reconciled (156); `verify:source-hygiene` **9/9**;
  `verify:roadmap-dashboard` **135/135**, banner "Sources agree".
- **Mutation test:** forcing the floor to `>= 99999` produced `33 passed, 1 failed` and **exit 1**,
  confirming the guard reports failure rather than decorating the summary. Reverted.
- **Not run:** packaged licensing/walkthrough suites (available EXE still predates this source);
  live Electron timer/focus/bootstrap behavior remains manual.
- **Result:** No behavioral change to the application — verifier hardening only. Ledger unchanged at
  62 PASS / 3 NOT RUN / 1 BLOCKED. `awkit-f3l` and `awkit-hj8` remain closed; `awkit-2l1` remains open.

## 2026-08-02: Sweep the other two BLOCKED verifiers for the same vacuity shape

- **Agent:** coding agent (Claude Code)
- **Task:** After hardening the dispatch-gate shell scan, check whether `verify:packaged-licensing`
  and `verify:packaged-walkthrough` share the "empty collection reads as clean" gap.
- **`verify:packaged-licensing` — CLEAN, no change.** Exit fix correct at `:376`. Its two `block()`
  calls sit in an `if/else` on issuer-key availability, so nothing is skipped past a
  collection-populating step, and the file contains zero `.every(`, `length === 0`, or
  `=== undefined ?` assertions.
- **`verify:packaged-walkthrough` — three instances found and fixed.** `sampleSystem()` (`:217`) runs
  PowerShell under `$ErrorActionPreference='SilentlyContinue'` and returns `null` on failure;
  `bundledChromeNow()` converted that `null` to `[]`, and the final sweep used
  `postSweep ? filter : []`. Affected: Part H "no bundled-Chromium processes left after clean app
  exit"; the Part I orphan-observation poll; and the closing "teardown left no zombie app or
  bundled-Chromium processes". All three passed when the process probe was blind. The orphan poll was
  the worst — it resolved `true` on the first blind poll and printed "orphaned processes self-exited"
  as a positive finding from a measurement that never happened.
- **Fix:** added `isLiveSample()` with a `SAMPLE_MIN_PROCESSES = 50` floor; `bundledChromeNow()` now
  returns `null` for an unreadable process table, matching the `-1` sentinel discipline
  `chromeRootsNow` already used; the orphan poll refuses to resolve while blind and reports
  INCONCLUSIVE; the teardown assertion requires a visible sample. Part M was already correct via
  `observer.samples >= 5` — that guard is what the rest of the file now matches.
- **Files changed:** `scripts/verify-packaged-walkthrough.mts` (+38/-10), `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`.
- **Threshold provenance:** floor of 50 measured against **291** live processes
  (`Get-CimInstance Win32_Process | Measure-Object`) on the development machine — ~5.8x margin.
- **Tests run:** `typecheck:scripts` PASS. Guard predicates exercised in isolation against blind,
  implausible-sample, clean and dirty inputs — **11/11**, confirming the blind cases now FAIL where
  they previously passed *and* that genuinely-clean cases still PASS (i.e. the guard was hardened, not
  made unconditionally red).
- **NOT RUN — OWED:** `npm run verify:packaged-walkthrough` itself. It is `packaged-application` class
  and the available EXE predates this source. The suite gains one assertion ("the orphan probe could
  read the process table"), so the next real run's total will be one higher than the last recorded
  figure; that delta is expected, not a regression. Rebuild with `npm run package:portable` and run
  the suite before citing any packaged result.
- **Result:** Verifier hardening only; no product change. Ledger unchanged at
  62 PASS / 3 NOT RUN / 1 BLOCKED. Beads unchanged.

## 2026-08-02: Rebuild the portable and run the packaged walkthrough

- **Agent:** coding agent (Claude Code)
- **Task:** Discharge the owed packaged run for the 2026-08-02 process-probe liveness fix.
- **`npm run package:portable` — PASS.** Produced `dist/SpecterStudio 0.1.2.exe` (212,841,782 bytes)
  and `dist/win-unpacked/`. Zvec host staged (17 files, 37.6 MB); Oracle bundle 41.9 KB (bridge jar
  only, expected); manifest re-signed with `ed25519:68931c5d…`; artifact provenance recorded.
- **First real execution of the `awkit-hj8` provenance gate — PASSED.** The chain's `-Strict` step
  ran after the manifest was regenerated at HEAD: `application.version` `0.1.2` == `package.json`,
  `application.sourceCommit` `549a9fff9691ecfc97f72bdf91d6d38a84edc53e` == HEAD, `sourceTreeDirty`
  false. The gate has now been seen rejecting a non-release-current manifest AND admitting a
  release-current one — both directions, not just the failing one.
- **`npm run verify:packaged-walkthrough` — 25 PASS / 0 FAIL / 1 BLOCKED, exit 1.** Matches the
  previously recorded blocked-run baseline exactly, so the liveness fix altered no existing outcome.
  Part A confirmed "packaged payload is at least as new as src/ and app/". No stray SpecterStudio or
  bundled-Chromium processes remained afterwards; evidence written to `dist/phase5-evidence/`.
- **What the run actually exercised of the liveness fix:** the Part N teardown assertion ("teardown
  left no zombie app or bundled-Chromium processes") lives in the `finally` block, so it ran on the
  blocked path and **passed with a live sample** — confirming `isLiveSample()` accepts a real process
  table rather than being too strict. Part H and Part I sit after the Part D licensing throw and were
  **skipped**; their fixes remain unexercised on a real run.
- **BLOCKED cause (expected, not a defect):** `AWKIT_PACKAGED_LICENSE_ISSUER_KEY` is unset.
  `resolveIssuerKey()` deliberately refuses to fall back to the key present at the issuer's default
  location — "do not sign with the production release key on an ordinary developer machine". The env
  var was NOT set; that is an authorized-machine decision and is entangled with open P1 `awkit-2l1`
  (key custody). Licensed packaged execution therefore remains unclaimed in either direction.
- **This run is direct evidence the BLOCKED-exit fix works:** before `d2df8e3` this same state exited
  **0**, i.e. a release gate that could not attempt licensed execution reported success.
- **Files changed:** `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`.
- **UNRESOLVED — `resources/dependency-manifest.{json,sig}` are dirty.** Packaging necessarily
  regenerated and re-signed them (now at HEAD `549a9ff`, vs the committed `fb29217`). The standing
  instruction forbids modify, regenerate, revert, AND commit; packaging forced the first two, so both
  remaining actions are prohibited and neither was taken. Left dirty for an owner decision. No
  private key material was read, copied, or recorded.
- **Result:** Owed packaged run discharged as far as this machine permits. Ledger unchanged at
  62 PASS / 3 NOT RUN / 1 BLOCKED. Beads unchanged.

## 2026-08-02: Restore the dependency manifest to the committed baseline

- **Agent:** coding agent (Claude Code)
- **Task:** Resolve the manifest pair left dirty by the packaging run in the entry above. Owner chose
  restore-to-baseline over committing the regenerated pair.
- **Action:** `git checkout -- resources/dependency-manifest.json resources/dependency-manifest.sig`,
  taken only after explicit owner instruction (the standing note forbids revert as well as commit) and
  after confirming those two paths were the ONLY dirty entries. The regenerated pair was copied to the
  session scratchpad first, so the restore is reversible without another full packaging run.
- **Post-restore verification:**
  - working tree **clean**; `git diff HEAD -- resources/` empty (byte-identical to committed)
  - `node scripts/offline-manifest-signature.mjs verify` → **exit 0**
  - file SHA-256 `76281176af…` equals `manifestSha256` recorded in the `.sig`
  - restored values: version `0.1.2`, `sourceCommit fb29217…`, generated `2026-07-31T17:51:40Z`
- **Repo and artifact now differ, correctly.** `dist/win-unpacked/resources/resources/dependency-manifest.json`
  still records `sourceCommit 549a9ff` — the built EXE was not touched by the restore, so the
  walkthrough result above remains valid and re-runnable against that artifact. The artifact describes
  the source it was built from; the repo holds the last committed baseline. This is the expected steady
  state, not drift.
- **Consequence to remember:** with the baseline restored, `validate:offline -Strict` will again fail
  its release-current provenance assertion, because `sourceCommit fb29217` is not HEAD. That is the
  designed behavior — a release build regenerates the manifest at the release commit, which every
  packaging script already does, as demonstrated by the passing `-Strict` run recorded above.
- **Files changed:** `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`. No private key material was
  read, copied, or recorded at any point.
- **Result:** Manifest disposition resolved. Ledger unchanged at 62 PASS / 3 NOT RUN / 1 BLOCKED.

## 2026-08-05: Blueprint Recovery — Phase 4 integration (LocatorFactory fast-path)

- **Agent:** coding agent (Antigravity)
- **Task:** Implement Phase 4 (integration into `LocatorFactory`) of the Element Blueprint recovery
  plan (`docs/implementation_plan.md`).
- **Action:**
  - New `src/runner/LocatorBlueprintStore.ts` — `PageBlueprint`/`ElementBlueprint`, `computePageKey`,
    `computeDocumentFingerprint`, and the atomic `FileLocatorBlueprintStore`.
  - Blueprint capture added to `recorderInitScript.ts` (`captureBlueprint`), assembled in
    `buildRecordedFlow.ts`, persisted from `recorder.ipc.ts`; additive `blueprintId` (`StepLocator`)
    and `blueprintCapture` (`RecordedActionLocator`) types.
  - `PlaywrightRunner` accepts `locatorBlueprintRoot` (wired in `ExecutionEngine.ts` as
    `join(dirs.root, "locator-blueprints")`) and instantiates `FileLocatorBlueprintStore`;
    `LocatorFactory` accepts `blueprintStore`.
  - Fast-path in `LocatorFactory.recoverLocally`: look up the page blueprint by `pageKey`, jump to the
    stored `documentOrder` via `.nth()`, accept only at a stricter 0.90 fingerprint threshold, else
    fall through to the existing 200-element scan.
- **Tests run:** `npm run build` PASS; `npm run verify:recorder-flow` PASS (29/29);
  `npm run verify:runner` PASS (89/89). NOTE: these confirm **no regression only** — no
  blueprint-specific coverage existed at this point.
- **Result:** Phase 4 wiring landed and builds clean. (The original log entry for this task was
  written with a broken text encoding — a UTF-16 block plus a mangled duplicate — and was
  de-corrupted here.)

## 2026-08-05: Blueprint Recovery — plan-conformance review, doc repair, `verify:blueprint-recovery`

- **Agent:** Claude (Opus 4.8) — asked to check the implementation against `docs/implementation_plan.md`.
- **Findings (deviations from the revised plan; all degrade safely — the fast-path always falls
  through on a miss):**
  - Blueprint runs as a **first** fast-path, not the **second** layer after the broad scan that the
    plan specified.
  - A single **exact** `.nth(documentOrder)` jump, not the neighborhood scan the plan called for, so a
    node inserted before the target shifts the index and the jump misses — undercutting the plan's
    headline scenarios (banner/sibling inserted, rows reordered).
  - Threshold raised to 0.90 and the plan's 0.08 runner-up **margin dropped**.
  - **No explicit sensitive-action refusal** in the blueprint path (relies on guarded-positional
    short-circuiting earlier, which only covers positional sensitive steps).
  - `documentFingerprint` page-variant gate is captured but **never checked** at runtime.
  - Frame keying is a **placeholder**: capture uses the frame URL/title, runtime uses the top-page
    URL/title, so framed targets never match their page key.
  - Several `ElementBlueprint` fields are dead at runtime; top-level `ancestry` is stored unhashed
    (structural `tag|role|id|testid`, not inner text).
- **Action:**
  - Repaired the encoding-corrupted `CURRENT_STATE.md` heading and this log's mangled/duplicated entry.
  - Added `scripts/verify-blueprint-recovery.mts` + the `verify:blueprint-recovery` npm script,
    registered in `scripts/lib/verifier-classification.ts` (class `integration`). It pins the
    Node-side surfaces: blueprint assembly, fingerprint hashing parity + privacy (no raw
    label/attribute/URL text persisted), page-key/document-fingerprint normalization, the 2000-element
    cap, and the atomic file store (put/get/list, no `.tmp` leak, schema + 512KB guards). It does NOT
    exercise the in-page `captureBlueprint` or the `LocatorFactory` runtime fast-path (both
    browser-only — a real-browser verifier for those remains an open follow-up).
- **Tests run:** `npm run build` PASS; `npm run verify:blueprint-recovery` PASS (42/42); mutation-checked
  by storing the raw (unhashed) fingerprint — 5 privacy/parity checks flipped to FAIL as expected.
- **Result:** Docs repaired; the assembly/store behavior now has a focused verifier. Runtime design
  gaps above remain open follow-ups (not yet filed as beads).

## 2026-08-06: Recorder competitive deep-testing — 2 defects found + fixed, new verifier

- **Agent:** Claude (Opus 4.8). **Task:** deeper testing / competitive-scenario deep-dive of the Recorder.
- **Baseline:** ran the core recorder suite. All green EXCEPT `verify:recorder` at **205/1** — a real
  regression: the blueprint Phase 4 commit (`6591c08`) made `captureBlueprint` store the raw
  `location.href` and the raw element fingerprint on the recorded draft, so the closed-shadow
  "persisted data exposes no internal node/name" gate failed (the draft embedded the closed root's
  internal name/text and, for the data: fixture, the internal method name via the URL) and every draft
  persisted full URLs (query/fragment/tokens).
- **New gate:** `scripts/verify-recorder-competitive.mts` (`verify:recorder-competitive`,
  class real-browser, **25/25**) drives the real `installRecorderCapture` and probes:
  generated/framework ids (React `:r`, Ember, GUID, CSS-module id hash), CSS-in-JS/hashed classes
  (emotion/styled/FB-atomic/CSS-module), meaningful-class usage, and native `<select>` /
  contenteditable / keyboard capture. Its first run was 23/25, surfacing a second defect.
- **Defect 2:** CSS-module hashed id (`#Header_root__2x9Yt`) and class
  (`button.Button_primary__3xKz9`) were emitted as locators — brittle across builds.
- **Fixes (`src/recorder/recorderInitScript.ts`):**
  1. `captureBlueprint` skips shadow-scoped targets (root is a `ShadowRoot`) and masks the URL to
     `origin + pathname`. Restores `verify:recorder` to 206/0 and stops the URL/PII leak in drafts.
  2. `looksGeneratedId` + `isMeaningfulClass` reject a `__`-delimited suffix containing a digit
     (CSS-module hash); pure-word BEM (`card__title`) is preserved.
- **Verification (all after the fixes):** `verify:recorder` 206/0, `verify:recorder-competitive` 25/25,
  `verify:recorder-ambiguity` 69/0, `verify:recorder-hover` 214/0, `verify:closed-shadow` 23/0,
  `verify:frame-chain` 25/0, `verify:locator-guard` 33/0, `verify:recorder-flow` 29/29,
  `verify:recorder-draft` 50/50, `verify:recorder-redaction` 15/0, `verify:blueprint-recovery` 42/42,
  `npm run build` clean. No regressions from the CSS-module rule or the blueprint guard.
- **Beads:** filed `awkit-fbq` (contenteditable typed text not captured — only the click; low pri).
  Noted on `awkit-3ut` that the closed-shadow/URL leak is fixed (frame page-key + variant gate +
  unhashed ancestry remain open).
- **Files changed:** `src/recorder/recorderInitScript.ts`, `scripts/verify-recorder-competitive.mts`
  (new), `package.json`, `scripts/lib/verifier-classification.ts`, `docs/ai/CURRENT_STATE.md`,
  `docs/ai/TASK_LOG.md`, `scripts/verify-roadmap-dashboard.mjs`, `.beads/issues.jsonl`.
- **Result:** red gate fixed, two brittleness/privacy defects closed, competitive coverage added.
  Ledger unchanged (63 PASS / 2 NOT RUN / 1 BLOCKED); tracker 167 / 9 outstanding / 158 closed.

## 2026-08-06: Recorder deep-testing round 2 — contenteditable fix + drag/ARIA/SPA probes

- **Agent:** Claude (Opus 4.8). **Task:** continue the Recorder competitive deep-dive — implement the
  contenteditable gap and push probes into drag-and-drop, custom ARIA combobox/listbox, and SPA
  client-side-navigation continuity.
- **Fix (`src/recorder/recorderInitScript.ts`):** the `input` handler now captures a contenteditable /
  rich-text editing host's text as a redaction-aware fill (`element.innerText`), not just the click.
  The input/textarea path is unchanged. Closes `awkit-fbq`.
- **New probes added to `scripts/verify-recorder-competitive.mts`** (now **32/32**):
  - E (contenteditable): asserts fill + captured text ("hello world") — proves the fix.
  - G (drag-and-drop): HTML5 draggable drag records NO action → gap, filed `awkit-dat`.
  - H (custom ARIA combobox/listbox): option click captured as a semantic `role=option` locator,
    unique — verified strength.
  - I (SPA continuity): after `pushState` + full `body.innerHTML` replacement, both the pre- and
    post-navigation clicks are captured — verified strength (delegated window listeners persist).
- **Verification (all green):** `verify:recorder-competitive` 32/32, `verify:recorder` 206/0,
  `verify:recorder-redaction` 15/0, `verify:recorder-draft` 50/50, `verify:recorder-ambiguity` 69/0,
  `verify:closed-shadow` 23/0, `npm run build` clean. No regression from the input-handler change.
- **Beads:** closed `awkit-fbq` (contenteditable, fixed); filed `awkit-dat` (drag-and-drop capture,
  low pri). Tracker: 168 / 9 outstanding / 159 closed, edges 95.
- **Files changed:** `src/recorder/recorderInitScript.ts`, `scripts/verify-recorder-competitive.mts`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`, `scripts/verify-roadmap-dashboard.mjs`,
  `.beads/issues.jsonl`.
- **Result:** one more gap closed, three competitive behaviors verified (two strengths, one new gap).
  Ledger unchanged (63 PASS / 2 NOT RUN / 1 BLOCKED).

## 2026-08-06: Drag-and-drop — new `drag` step type end-to-end (awkit-dat)

- **Agent:** Claude (Opus 4.8). **Task:** implement drag-and-drop capture + replay (the awkit-dat gap
  found in the competitive deep-dive).
- **Scope discovery:** adding a StepType ripples through several exhaustive `Record<StepType,…>` tables
  (`tsc`-enforced) and a parity verifier (`test:random:generator`) that requires the renderer
  `flowNodeCatalog` and the test-lab `NODE_CATALOG` to have the identical type set — so `drag` had to be
  added to the renderer palette too (parity-only; a full designer editor is a follow-up).
- **Implementation (10 files):**
  - `FlowProfile.ts`: `StepType += "drag"`; `FlowStep.targetLocator?` (additive).
  - `StepRequirements.ts`, `NodeCatalog.ts` (gated `missingLocalFixture`, weight 0),
    `flowNodeCatalog.ts` (+`Move` icon), `flowNodeRegistry.ts` (interaction/locator section),
    `StepSafetyPolicy.ts` (`drag` → `safeMutation`).
  - `RecorderTypes.ts`: `RecordedAction.targetLocator?`.
  - `recorderInitScript.ts`: `dragstart`/`drop`/`dragend` capture → one `drag` action with source +
    target locators (cancelled drag records nothing).
  - `buildRecordedFlow.ts`: map the drag action → `drag` step with `locator` + `targetLocator`, resolved.
  - `StepExecutor.ts`: `case "drag"` resolves both locators and `source.dragTo(target)`; throws if the
    `targetLocator` is missing.
- **Tests:** extended `verify:recorder-competitive` (scenario G: native `page.dragAndDrop` → a `drag`
  action with source + target, 35/35), `verify:recorder` (real StepExecutor replay + missing-target
  negative, 210/0), `verify:recorder-flow` (mapping + JSON round-trip, 33/33).
- **Verification (all green, no regressions):** build; `verify:validation` 125/0; `test:random:generator`
  49/0; `test:random:roundtrip` 27/0; `verify:runner` 89/0; `verify:recorder-ambiguity` 69/0;
  `verify:recorder-hover` 214/0; `verify:closed-shadow` 23/0; `verify:recorder-redaction` 15/0;
  `verify:recorder-draft` 50/0; `verify:locator-guard` 33/0.
- **Beads:** closed `awkit-dat` (core delivered); filed `awkit-3g6` (designer drop-target editor,
  mock-site sortable scenario, pointer-emulated DnD). Tracker 169 / 9 outstanding / 160 closed.
- **Result:** drag-and-drop is captured and replayed end-to-end. Ledger unchanged
  (63 PASS / 2 NOT RUN / 1 BLOCKED).

## 2026-08-06: Drag follow-ups (awkit-3g6) — mock-site lab + designer round-trip fix

- **Agent:** Claude (Opus 4.8). **Task:** work awkit-3g6 (drag follow-ups). Delivered 2 of 3 items.
- **(1) Mock-site scenario:** new `mock-site/public/drag-lab.html` — a kanban board with native HTML5
  draggable cards + column drop zones, delegated listeners on the stable `.drag-board` (Reset-safe),
  `data-testid` selectors, and a `window.__dragLab` mirror. Registered route in `server.mjs`, home link
  in `index.html`, README row. Extended `verify-mock-site.mjs` to drive a real `page.dragAndDrop` and
  assert the move + reset + re-drag (**125/0**).
- **(2) Designer round-trip DATA-LOSS FIX:** `toFlowStep`/`fromFlowStep` in BOTH
  `flowStepMapping.ts` and `flowProfileMapping.ts` map fields explicitly and dropped `targetLocator`, so
  editing+saving a recorded `drag` step silently lost its drop target. Added
  `FlowDesignerNodeData.targetLocator` and carry it verbatim in both directions (like `locatorGuard`).
  Extended `verify-flow-step-mapping.mts` with a drag round-trip test across both mappings + a non-drag
  negative (**115/0**).
- **Verification:** `npm run build` clean; `verify:mock-site` 125/0; `verify:flow-step-mapping` 115/0;
  `test:random:roundtrip` 27/0. No regressions.
- **Beads:** `awkit-3g6` kept OPEN with a progress note — remaining: interactive designer drop-target
  editor section, and pointer-emulated DnD capture. Tracker unchanged at 169 / 9 / 160.
- **Files:** `mock-site/public/drag-lab.html` (new), `mock-site/public/index.html`, `mock-site/server.mjs`,
  `mock-site/README.md`, `scripts/verify-mock-site.mjs`, `app/renderer/components/workflow/flowDesignerTypes.ts`,
  `app/renderer/components/workflow/flowStepMapping.ts`, `app/renderer/components/workflow/flowProfileMapping.ts`,
  `scripts/verify-flow-step-mapping.mts`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`, `.beads/issues.jsonl`.
- **Result:** drag fixture in the Feature Test Lab + a real designer data-loss bug fixed. Ledger
  unchanged (63 PASS / 2 NOT RUN / 1 BLOCKED).

## 2026-08-06: Drag drop-target editor in the Flow Designer (awkit-3g6)

- **Agent:** Claude (Opus 4.8). **Task:** awkit-3g6 Part 2 editor UI — a GUI editor for a drag step's
  drop target, per an explicit requirement list.
- **Implementation:**
  - `flowNodeRegistry.ts`: new `dragTarget` `PropertySection`; drag META `sections:
    ["locator","dragTarget","execution"]` + `validate` returning "Drag requires a drop-target locator."
    when `targetLocator.value` is empty.
  - `FlowNodePropertiesPanel.tsx`: `editTarget`/`clearTarget` helpers bound EXCLUSIVELY to
    `targetLocator` (clearing sets it `undefined`, never touching the source `locator*`). New
    drag-only **Drop Target** section (Strategy/Value/Accessible-Name/Match-exactly + Clear button +
    an inline `role="alert"` when the target is empty). Source section retitled **Drag Source** for
    drag nodes with a source-vs-target hint. Reuses existing token-styled classes (keyboard + focus
    inherited); no unrelated redesign.
- **Verifier:** extended `verify-flow-step-mapping.mts` (imports the real `getNodeDefinition`): drag
  round-trip through BOTH mappings, edit→re-save persists, edit/clear leave the source untouched,
  registry `validate` flags a missing target and passes with one, and the `dragTarget` section is
  drag-exclusive — **122/0**.
- **Verification (all green):** `npm run build` clean; `verify:flow-step-mapping` 122/0;
  `verify:validation` 125/0; `test:random:generator` 49/0; `test:random:roundtrip` 27/0;
  `verify:recorder-flow` 33/33. No regressions.
- **Beads:** `awkit-3g6` kept OPEN — only pointer-emulated DnD capture remains (a separate, carefully
  gated increment due to false-positive risk). Tracker unchanged at 169 / 9 / 160.
- **Files:** `app/renderer/components/workflow/flowNodeRegistry.ts`,
  `app/renderer/components/workflow/FlowNodePropertiesPanel.tsx`, `scripts/verify-flow-step-mapping.mts`,
  `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`, `.beads/issues.jsonl`.
- **Result:** a drag step's drop target is now GUI-editable, validated, and round-trip-safe. Ledger
  unchanged (63 PASS / 2 NOT RUN / 1 BLOCKED).

## 2026-08-06: Pointer-emulated drag capture — awkit-3g6 Part 3 (COMPLETE)

- **Agent:** Claude (Opus 4.8). **Task:** awkit-3g6 Part 3 — capture pointer-emulated drag-and-drop
  (react-dnd/dnd-kit/SortableJS) as a bounded gesture recognizer, per an explicit spec. Closes awkit-3g6.
- **Recognizer (`src/recorder/recorderInitScript.ts`):** primary mouse/pen `pointerdown` on a valid
  source → source locator captured via `generateForEvent` → `pointermove` past
  `DRAG_MOVE_THRESHOLD_PX` (10) while pressed → `pointerup` over a credible DISTINCT drop target
  (`document.elementFromPoint`, generated via `generate(el)`) → ONE `drag`. Never fabricates a target.
  Deduplicated with the native path (`nativeDragFired` set on native `dragstart`); suppresses the
  synthetic post-drag `click` (`suppressClickAfterDrag`). Fails closed for click+jitter, double-click,
  text selection, scroll/pan, touch, range/file/number inputs, sliders, resize, canvas, contenteditable,
  long-press, pointercancel/lostpointercapture/Escape/navigation/detach, non-primary buttons.
- **needs-review policy (`buildRecordedFlow.ts`):** ambiguous OR positional drop target → needs-review
  (both native + pointer paths); unique semantic target → resolved.
- **Fixture:** `/drag-lab` gained a pointer-driven sortable (`pointer-*` selectors); README updated.
- **Verifiers:** `verify-recorder-competitive` (+9 pointer cases + shadow-host + dedup) **50/50**;
  `verify-recorder-locator` (+pointer `StepExecutor.dragTo` replay moving the correct item) → verify:recorder
  **212/0**; `verify-mock-site` (+`page.mouse` pointer reorder/reset/second-drag) **132/132**;
  `verify-flow-step-mapping` round-trip **122/0**.
- **Mutation test (recipe):** `sed -i 's/DRAG_MOVE_THRESHOLD_PX = 10;/DRAG_MOVE_THRESHOLD_PX = 100000;/'
  src/recorder/recorderInitScript.ts` → `npx tsx scripts/verify-recorder-competitive.mts` flips the
  successful-pointer-drag checks to FAIL (42/49 then 49→50 restored); reverse the `sed` to restore. The
  threshold is also bracketed permanently by the "small movement stays a click" check.
- **Full sweep (all green, no regressions):** recorder-competitive 50, verify:recorder 212, recorder-flow
  33, mock-site 132, flow-step-mapping 122, recorder-ambiguity 69, recorder-hover 214, closed-shadow 23,
  recorder-redaction 15, recorder-draft 50, locator-guard 33, frame-chain 25, waits 72, blueprint-recovery
  42, validation 125, runner 89, source-hygiene 9, verifier-classification reconciled, test:random:generator
  49, test:random:roundtrip 27, build clean.
- **Beads:** `awkit-3g6` CLOSED (all 3 parts delivered + real replay evidence). Tracker 169 / 8 / 161.
- **Files:** `src/recorder/recorderInitScript.ts`, `src/recorder/buildRecordedFlow.ts`,
  `mock-site/public/drag-lab.html`, `mock-site/README.md`, `scripts/verify-mock-site.mjs`,
  `scripts/verify-recorder-competitive.mts`, `scripts/verify-recorder-locator.mts`,
  `scripts/verify-roadmap-dashboard.mjs`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`, `.beads/issues.jsonl`.
- **Result:** pointer-emulated drag captured + replayed, false-positives rejected, awkit-3g6 complete.
  Ledger unchanged (63 PASS / 2 NOT RUN / 1 BLOCKED).

## 2026-08-06: /HANDOFF — prepared repository for the next agent

- **Task:** produce a handoff after the drag-and-drop epic (`awkit-dat` + `awkit-3g6`) and the Recorder
  competitive deep-testing pass.
- **Git state:** `main` clean and in sync with `origin/main` at `c06c1f0`; nothing uncommitted or unpushed.
- **Updated:** `docs/ai/HANDOFF.md` (new newest-first entry: current task, completed work, changed areas,
  verification results, remaining work, risks/do-not-touch, recommended next step). `docs/ai/CURRENT_STATE.md`
  already current (pointer-capture section is the newest). Appended this `TASK_LOG.md` entry.
- **Checks:** `node scripts/ai-memory/check-memory.mjs`; `npm run verify:roadmap-dashboard` (re-run because
  the newest HANDOFF section — the ledger-tally source — changed).
- **Result:** HANDOFF is ready for the next agent. No secrets written to Markdown. Recommended next step:
  `awkit-qpv` (blueprint recovery second-layer + neighborhood scan), which with `awkit-3ut` unblocks
  `awkit-c2z`.

## 2026-08-07: Blueprint recovery second layer + neighborhood scan (awkit-qpv)

- **Agent:** Codex. **Task:** resume from the drag/Recorder handoff and implement the recommended
  `awkit-qpv` blueprint-recovery correction.
- **Implementation:** `LocatorFactory.recoverLocally()` now completes the existing broad visible scan
  first. Only when that fails does `recoverFromBlueprint()` load the page blueprint and inspect a
  bounded ±24 document-order neighborhood. Candidates use the shared hashed-fingerprint
  `similarity()` score with the existing 0.86 threshold and 0.08 runner-up margin. Captured document
  order, sibling index, same-tag index, and bounding region contribute at most a 0.03 tiebreaker;
  invisible candidates and equal twins are refused. Blueprint errors remain additive/fail-safe.
- **Coverage:** extended the real-Chromium `verify:recorder` suite with broad-first/no-store-read,
  inserted-sibling recovery beyond the 200-element broad cap, and equal-neighborhood-twin refusal.
- **Verification:** `npm run verify:recorder` **217/0**; `npm run build` PASS;
  `npm run verify:runner` **89/0**; `npm run verify:blueprint-recovery` **42/42**;
  `npm run verify:source-hygiene` **9/0**.
- **Tracking:** closed `awkit-qpv`; tracker **169 / 7 outstanding / 162 closed / 95 edges**. Ledger
  unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**. Remaining blueprint work: `awkit-3ut`,
  `awkit-utj`, and `awkit-c2z` (still blocked by `awkit-3ut`).
- **Files:** `src/runner/LocatorFactory.ts`, `scripts/verify-recorder-locator.mts`,
  `scripts/verify-roadmap-dashboard.mjs`, `.beads/issues.jsonl`, `tools/roadmap/assignments.json`,
  `docs/ai/{CURRENT_STATE,FEATURES,TASK_LOG}.md`.

## 2026-08-07: Frame-correct blueprint identity + document-variant gate (awkit-3ut)

- **Agent:** Codex. **Selection:** highest-priority dependency-ready item after `awkit-qpv`; tied at
  P2 with `awkit-utj`, but selected because it is a bug and directly blocked `awkit-c2z`.
- **Root cause:** capture keyed framed blueprints from the child URL/title plus the literal string
  `"frame"`, while runtime keyed from the top page; `documentFingerprint` was stored but ignored;
  and `ElementBlueprint.ancestry` duplicated the raw capture ancestry instead of the hashed copy.
- **Fix:** added deterministic `computeFrameKey()` parity across capture/runtime, resolved the actual
  child `Frame` before page-key computation and neighborhood scanning, activated a canonical
  tag/explicit-role histogram gate with 0.85 overlap tolerance, and reused hashed fingerprint ancestry.
  Blueprint errors and mismatched page variants remain fail-safe.
- **Coverage:** `verify:frame-chain` gained a real cross-origin framed blueprint fixture proving child
  page-key lookup, minor inserted-banner drift recovery, recovery observability, and materially
  different same-URL variant refusal. `verify:blueprint-recovery` now pins frame-digest parity,
  histogram tolerance/refusal, and top-level ancestry privacy.
- **Verification:** `verify:frame-chain` **31/0**; `verify:blueprint-recovery` **52/52**;
  `verify:recorder` **217/0**; `npm run build` PASS; `verify:runner` **89/0**;
  `verify:recorder-flow` **33/33**; `verify:source-hygiene` **9/0**; verifier classification reconciled.
- **Tracking:** closed `awkit-3ut`; tracker **169 / 6 outstanding / 163 closed / 95 edges**.
  `awkit-c2z` is now ready; ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**.
- **Files:** `src/runner/{LocatorBlueprintStore,LocatorFactory}.ts`,
  `src/recorder/buildRecordedFlow.ts`, `scripts/{verify-blueprint-recovery,verify-frame-chain,
  verify-recorder-locator}.mts`, `scripts/verify-roadmap-dashboard.mjs`, `.beads/*.jsonl`, and
  `docs/ai/{CURRENT_STATE,FEATURES,TASK_LOG}.md`.

## 2026-08-07: Real-browser blueprint capture + LocatorFactory recovery gate (awkit-c2z)

- **Agent:** Codex. **Selection:** highest-priority dependency-ready item after `awkit-3ut`.
- **Fixture:** added `/blueprint-recovery-lab`, with a same-name decoy, 205 deterministic fillers,
  inserted-sibling mutation, reset/status controls, and a below-threshold identity-drift control.
- **Verifier:** added classified real-browser command `verify:blueprint-recovery-browser`. It records
  the target through `getRecorderInitScriptContent`, assembles the browser capture through
  `buildRecordedFlow`, proves every recorded candidate misses after drift, proves no recovery without
  blueprint storage, then drives `LocatorFactory` to the intended target at measured similarity
  **0.866667**. The paired below-0.86 mutation is refused with no side effect or success event.
- **Verification:** `verify:blueprint-recovery-browser` **20/20**; `verify:mock-site` **141/141**;
  `verify:blueprint-recovery` **52/52**; `verify:recorder` **217/217**; `verify:frame-chain` **31/31**;
  `verify:runner` **89/89**; `verify:source-hygiene` **9/9**; verifier classification reconciled;
  `npm run build` PASS. `npm run typecheck:scripts` was run and remains FAIL on nine pre-existing
  errors in other verifier files; the new script was not among the diagnostics and its live run passed.
- **Tracking:** closed `awkit-c2z`; tracker **169 / 5 outstanding / 164 closed / 95 edges**. Validation
  ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**.
- **Files:** new `mock-site/public/blueprint-recovery-lab.html` and
  `scripts/verify-blueprint-recovery-browser.mts`; mock-site route/index/verifier/README; package script
  and verifier classification; roadmap count source; AI memory docs; `.beads/issues.jsonl`.

## 2026-08-07: Sensitive-action locator recovery refusal (awkit-utj)

- **Agent:** Codex. **Selection:** the sole dependency-ready item after `awkit-c2z`.
- **Reproduction:** before the fix, a Recorder-captured dangerous action still received a
  `blueprintId`/page blueprint (`verify:locator-guard` **33 passed / 2 failed**), and a real-browser
  `externalCommit` step whose recorded locator drifted read blueprint storage, recovered the moved
  target, emitted `local-recovery`, and clicked it (`verify:blueprint-recovery-browser`
  **21 passed / 3 failed**).
- **Fix:** `LocatorFactory.resolve` classifies sensitivity once and permits dangerous/external steps
  to retry only their exact recorded candidates; broad fingerprint and blueprint recovery are both
  skipped when those candidates miss. `buildRecordedFlow` assigns and persists no blueprint recovery
  reference for a sensitive captured action.
- **Verification:** `verify:locator-guard` **35/35**; `verify:blueprint-recovery-browser` **24/24**;
  `verify:blueprint-recovery` **52/52**; `verify:safety-policy` **17/17**; `verify:recorder`
  **217/217**; `verify:recorder-flow` **33/33**; `verify:runner` **89/89**; `npm run build` PASS.
  `npm run typecheck:scripts` remains FAIL on the same nine documented pre-existing diagnostics;
  no new diagnostic is attributable to this task.
- **Tracking:** closed `awkit-utj`; tracker **169 / 4 outstanding / 165 closed / 95 edges**.
  Validation ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**.
- **Files:** `src/runner/LocatorFactory.ts`, `src/recorder/buildRecordedFlow.ts`,
  `scripts/{verify-locator-guard,verify-blueprint-recovery-browser,verify-roadmap-dashboard}.m*`,
  `.beads/*.jsonl`, and `docs/ai/{ARCHITECTURE,COMMANDS,CURRENT_STATE,FEATURES,TASK_LOG,TESTING}.md`.

## 2026-08-07: Owner-decision handoff after awkit-utj

- **Agent:** Codex. **Task:** prepared the active cross-agent/owner handoff after the implementation
  queue became empty.
- **State recorded:** `main` is clean at `33a10d0`, two commits ahead of `origin/main` (`e1deff5`):
  the pre-existing release version bump and portable manifest are preserved but deliberately not
  pushed without owner direction. Tracker **169 / 4 outstanding / 165 closed / 95 edges**;
  `bd ready --json` is empty; ledger **63 PASS / 2 NOT RUN / 1 BLOCKED**.
- **Decision boundary:** the four remaining items require an owner-authorized real-IdP handoff,
  Oracle environment/credential plus real-mode decision, OS-shell launch approval, or a capable
  clean-machine/soak environment. No further implementation is authorized automatically.
- **Verification:** AI-memory check PASS after this handoff edit; prior functional verification is
  recorded in the `awkit-utj` entry immediately above.

## 2026-08-07: Nested custom-element Recorder action ownership (awkit-jce)

- **Agent:** Codex. **Fix:** semantic/native action owners now outrank decorative custom-element
  wrappers during interactive click capture; the nearest custom element remains the fallback when no
  stronger owner exists. Duplicate semantic click owners with only a positional distinction are
  recorded `needs-review` rather than silently runnable.
- **Coverage:** added the `/recorder-lab` custom-owner fixture (intentionally repeated internal
  `id="icon"` values) and classified `verify:recorder-action-owner`. Its real Chromium path is raw
  SVG leaf → injected Recorder capture → `buildRecordedFlow` → JSON save/reload → `StepExecutor`
  replay. It also covers button/custom-owner/bare-custom/duplicate-owner cases.
- **Verification:** red baseline captured `x-nav-icon` with compound CSS; after the fix,
  `verify:recorder-action-owner` **11/11**, `verify:recorder` **217/217**,
  `verify:recorder-ambiguity` **69/69**, `verify:locator-guard` **35/35**,
  `verify:safety-policy` **17/17**, `verify:mock-site` **145/145**, and verifier classification
  passed. Build was inconclusive after the 30-second tool window (main bundle compiled before cutoff).

## 2026-08-07: Deterministic Recorder Element Identity Contract (awkit-szp)

- **Agent:** Codex. **Objective:** replace selector uniqueness as the normal-action invariant with a
  versioned, deterministic identity contract while preserving sensitive fail-closed behavior.
- **Implementation:** `FlowProfile` gained optional schema-v1 element identity and interaction
  prerequisite contracts. The injected Recorder binds the actual action owner to primary/alternatives,
  ordered context, fingerprint, guard, structure, geometry, composed path, and confidence evidence.
  `buildRecordedFlow` hashes identity/guard tokens, preserves frame/page keys, and persists guards for
  normal positional actions. `LocatorFactory` now enforces those guards for every action; normal drift
  throws `TARGET_IDENTITY_CHANGED`, sensitive drift retains `SENSITIVE_TARGET_IDENTITY_CHANGED`.
- **UX/compatibility:** Recorder and Flow Designer surface identity separately from prerequisites;
  unknown hover/insertion provenance no longer reads as locator ambiguity. Designer mappings preserve
  identity, prerequisite, guard, and blueprint id. New fields are additive/optional for legacy JSON.
- **Technology decision:** retained Playwright locators plus existing composed-path, frame/shadow,
  fingerprint, and blueprint mechanisms. CDP Accessibility/DOMSnapshot and local visual matching were
  deferred/rejected for this path due experimental/version/performance/privacy cost and no measured
  acceptance gain.
- **Red/mutation evidence:** temporarily restoring the old `guard && sensitiveAction` condition made
  `verify:recorder-ambiguity` fail **67 pass / 4 fail**: no proof event, reordered twin executed, no
  identity-changed error, and the wrong lookalike was clicked. Restoring enforcement returned green;
  the final gate with bounded-performance checks is **74/74**.
- **Bounds/measurement:** the real-browser twin capture measured **1036.6 ms end-to-end** with **6
  generated candidates**; guarded resolution plus click measured **78 ms**. Container search remains
  capped at **3 segments / 240 chain evaluations**; broad fingerprint recovery at **200 elements**;
  blueprint recovery at **±24 document-order positions**, **2000 stored elements**, and a **5000-node
  document histogram**. No DOMSnapshot, CDP AX query, screenshot, or visual matcher runs, so their
  per-interaction storage/query cost is zero.
- **Focused verification:** build PASS; ambiguity **74/74**; locator guard **35/35**; action owner
  **11/11**; hover/prerequisite **222/222**; mock site **145/145**; Recorder **217/217**;
  frame chain **31/31**; closed shadow **23/23**; blueprint browser **24/24**; runner **89/89**;
  safety **17/17**; designer mapping **125/125**; recorder flow **33/33**; source hygiene **9/9**;
  classification reconciled. `typecheck:scripts` remains FAIL only on the same nine documented
  pre-existing diagnostics; this task introduced no new diagnostic. Roadmap **157/157 — Sources
  agree**; AI memory PASS; Graphify refreshed **11,954 nodes / 24,668 edges / 620 communities**.
- **Files:** `src/profiles/{FlowProfile,locatorApproval}.ts`, `src/recorder/*`,
  `src/runner/{LocatorFactory,StepExecutor,locatorFingerprint}.ts`, Flow Designer/Recorder renderer
  files, `mock-site/public/recorder-lab.html`, focused verifier scripts/classification, tracker source,
  and AI-memory documentation.
- **Commits/push:** `69b8185` (`feat(recorder): add deterministic element identity contract`) and
  `ddd50ab` (`test(recorder): verify identity contract end to end`) were pushed to `origin/main`.
