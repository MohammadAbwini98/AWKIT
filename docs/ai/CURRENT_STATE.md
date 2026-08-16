# CURRENT_STATE

## Recorder work resolved; tranche closed with honest accounting (2026-08-16)

`awkit-n7n` and `awkit-s1c` are closed. **All substantive Recorder engineering from the hardening
brief is done, measured, and guarded.**

`awkit-s1c` closed with real coverage rather than a note: `verify:recorder-navigation` is now
**26/26**, driving `recordActionFromPage` and asserting that typing five characters records **one**
fill action, plus a non-vacuity check that the fill was recorded at all. Mutation-tested — disabling
the coalescing branch yields `5 fill(s) from 5 action(s)`. The harness trap that produced a confident
wrong finding earlier (a verifier exposing its own `__awtkit_recordAction` binding measures the RAW
init-script emission) is documented in the file so it cannot cost another session.

`awkit-n7n` closed on its substantive scope: navigation/URL capture measured and protected; popup
coverage **executed** rather than assumed (71 checks across three verifiers); §11 and §12 measured as
already correct; §9's real gap fixed (`awkit-76x`) and guarded in both directions (`awkit-rit`,
mutations 3/3). Two confident code-read theories were disproven by measurement instead of shipped.

Remaining Recorder items, both deliberate:

- **`awkit-9qj` (P3)** — the mock-site navigation lab and 34-item matrix, carved out as
  formalisation. Most matrix rows already have a passing owner; check before writing anything new.
- **`awkit-ty4` (P3)** — the redundant fill echo after focus leaves a field. Still **deliberately
  unfixed**: the obvious narrowing would break a legitimate re-fill after a Clear action, and the
  defect is idempotent noise. That reasoning has not changed.

`verify:recorder-navigation` 26/26; `verify:roadmap-dashboard` 158/158. Ledger unchanged at
**63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker: **212 total / 203 closed / 9 outstanding**.

## Step 2 implemented, measured, and REVERTED — a pre-existing flake surfaced (2026-08-16)

The deletion works and its numbers are known, but it was **reverted** rather than committed, because
validating it surfaced a flake that makes the Workflow focused suite non-deterministic.

**What was measured before reverting.** Excising the superseded `check(...)` calls by paren balancing
gave Flow 135 → 119 raw calls and Workflow 80 → 64. With both allowlists emptied and `expectedChecks`
set to **112** and **58**, the broad runs reported exactly `112 observed / 0 retired / 0 unexpected`
and `58 observed / 0 retired / 0 unexpected`. Flow's focused suite stayed **16/16**. The mechanics are
sound and the target numbers are confirmed.

**Why it was reverted.** The Workflow FOCUSED suite returned **12/13** — aborting at check 13,
"Workflow save preserves Loop configuration, authored style, and exactly one promoted Conditional
exit", so checks 14-17 never ran.

**The mis-attribution, corrected.** The first reading was that the excision had removed actions
embedded in check conditions. A full `git checkout` revert disproved it: at the unchanged commit the
suite still returns 12/13, while broad coverage is correctly back to 74/15/0. The same commit gave
**17/17** earlier in the session and **12/13** on three consecutive runs since, so it is flaky, not
caused by any working-tree change. Leading hypothesis is profile pollution across runs — several
aborted runs preceded its first appearance.

Filed as `awkit-2js` (P1 flake, blocks step 2) and `awkit-8z0` (retry recipe with the confirmed
numbers). Leaving a broken or unvalidated verifier committed would have been worse than leaving the
retired-assertion noise, so the tree is back at `c86a9ad` for these four files.

`verify:roadmap-dashboard` 158/158. Ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**.
Tracker: **211 total / 201 closed / 10 outstanding**.

## Both retired-assertion gaps closed — step 2 is finally unblocked (2026-08-16)

`awkit-3ve` is fixed, closing the second and last unreplaced intent. **Every one of the 31 retired
U-route assertions now has a replacement bound to the capsule contract.**

The new Workflow check drives the real two-way binding rather than asserting a shape: edit Max
iterations to 21 without saving, confirm the ring renders **21 on the canvas**, close the panel,
reopen Configure, and assert the editor still shows 21 and `whileCondition` with the authored While
summary intact. A revert there would silently discard a user's in-progress edit.

| Designer | Unreplaced intent | Focused suite |
|---|---|---|
| Flow | inspector-delete Undo | **16/16** (was 15) |
| Workflow | unsaved bound edit on reopen | **17/17** (was 16) |

Both run with **unexpected failures: 0**.

**Step 2 is now safe but NOT done.** Deleting the 16 Flow + 15 Workflow retired assertions from the
pre-capsule walkthroughs, dropping both allowlists, and moving `expectedChecks` 128 → 112 and
74 → 59 remains outstanding on `awkit-6be`. It is a mechanical change across two ~2,000-line files
that needs both GUI suites re-run afterwards to confirm the counts.

Honest limitation: the two new checks were **not** mutation-tested. Their non-vacuity rests on the
canvas evidence — the Workflow ring genuinely re-rendered to 21, and the Flow capsule genuinely
returned after an inspector delete — rather than on a proven ability to fail.

`verify:roadmap-dashboard` 158/158. Ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**.
Tracker: **209 total / 201 closed / 8 outstanding**.

## Workflow retired assertions audited — a SECOND unreplaced intent found (2026-08-16)

The Workflow half of the `awkit-6be` audit is done, and it found what the audit existed to find.
**Step 2 (deleting the 31 retired assertions) is still blocked — for a new reason, not the old one.**

Fifteen of the sixteen Workflow retired names map cleanly onto `WORKFLOW_LOOP_CAPSULE_CHECK_NAMES`:
default value → #1 + #5, label → #5, rendering → #1 + #6, motion → #7, shape-collapse → covered,
zoom → #9, drag → #10, two Loops → #11, reduced motion → #8 + #12, reload → #13 + #14, direct target
→ #16, reconfigure → #13 + #14, keyboard delete → #16, and "exactly one emphasized Loop exit" →
#13's "exactly one promoted Conditional exit".

**The exception is `Configure loop reopens the existing Workflow Loop with its immediate unsaved
bound edit and authored summary intact`.** Grepping the Workflow focused suite for `unsaved` returns
**zero** hits. The Flow focused suite *does* cover it (4 hits), so this is a genuine Workflow-only
gap rather than a mirror of the Flow one — which is exactly why the bead required auditing Workflow
separately instead of assuming it matched.

Filed as `awkit-3ve`. Current state of the two halves:

| Designer | Unreplaced intent | Status |
|---|---|---|
| Flow | inspector-delete Undo | **FIXED** — focused suite 16/16 |
| Workflow | unsaved bound edit on reopen | **OPEN** (`awkit-3ve`) |

Deleting all 31 now would still silently drop real coverage. The order stands: close `awkit-3ve`
first, then delete both sets, drop both allowlists, and move `expectedChecks` 128 → 112 and 74 → 59.

`verify:roadmap-dashboard` 158/158. No code changed. Ledger unchanged at
**63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker: **209 total / 200 closed / 9 outstanding**.

## Inspector-delete Undo coverage restored; retired assertions now safe to remove (2026-08-16)

Step 1 of `awkit-6be` is done. The one retired intent with no replacement — Undo restoring an
inspector-deleted Loop — is now bound to the capsule contract in the focused suite.

`verify:flow-designer` focused capsule is **16/16** (was 15/15), unexpected failures **0**. Only the
old ASSERTION was U-route-specific (it required `directionCount` and `arrowCount`); the interaction
itself is still the product’s, so it was re-bound rather than lost with the visual it used to check.
Note the inspector DELETE was never retired — only the Undo-restores-configuration assertion was — so
the gap was narrower than first stated.

**Step 2 is NOT done and the bead stays open:** deleting the 16 Flow + 15 Workflow retired assertions
from the pre-capsule walkthroughs, dropping the allowlist, and moving `expectedChecks` 128 -> 112 and
74 -> 59. It is now safe for Flow. It is NOT yet safe for Workflow — whether those 15 have a similar
unreplaced intent has still not been checked, and that check must come first.

Ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker: **208 total / 200 closed / 8
outstanding**.

## Retired U-route assertions audited — one intent has NO replacement (2026-08-16)

Asked to fix the 31 retired U-route assertions (16 Flow + 15 Workflow) that run, fail, and are
allowlisted. The intended fix was to delete them, since a permanently-failing allowlisted assertion
is worse than none — it trains people to ignore failures. **That deletion was not performed, because
the audit found the premise is not fully true.**

The 2026-08-15 handoff states the focused capsule suites "independently replace their editing,
persistence, history, access, and visual intent". Mapping the 16 Flow retired names against
`FLOW_LOOP_CAPSULE_CHECK_NAMES`, fifteen map cleanly: label → #4, path/marker rendering → #1 + #5,
motion → #6, Undo/Redo → #13, zoom → #8, drag → #9, reduced motion → #7, two Loops → #10, reload →
#13, direct target → #14 + #15, unsaved edit → #13, keyboard delete → #14.

**The exception is `Undo restores an inspector-deleted Flow Loop with its configuration`.** Grepping
`scripts/lib/verify-flow-loop-capsule-gui.mjs` for `inspector` returns **zero** hits. Inspector-
initiated deletion followed by Undo is covered nowhere. Deleting the retired assertions first would
have silently dropped the one intent that has no replacement — the exact failure this audit existed
to prevent.

Filed as `awkit-6be` with the required order: add an inspector-delete + Undo check to the focused
suite **first**, then delete the retired assertions and drop the allowlist. Not yet checked: whether
the 15 Workflow retired assertions have a similar unreplaced intent.

Meanwhile the 31 assertions remain non-binding, which is a real (if narrow) reduction in the two
designer suites' authority and should be read that way when relying on them.

`verify:roadmap-dashboard` 158/158. No code changed. Ledger unchanged at
**63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker: **208 total / 200 closed / 8 outstanding**.

## Same-named validation issues are now distinguishable (2026-08-16)

`awkit-8xx` is fixed, and this time the code-read theory survived measurement. With a **correct**
fixture — the earlier one returned 0 issues because its profile shape was wrong (`nodes` IS the
FlowStep array) — three blocked steps produce **three** issues with **three distinct `nodeId`
anchors**, but only **two distinct messages**: the two steps both named "Fill input" rendered
byte-identically.

So the reported "same warning four times" was never duplicate emission. It was four correctly
anchored, genuinely separate failures that a reader could not tell apart. Deduplicating them — the
obvious reading of the complaint — would have hidden three real defects.

`labelFor` now appends the step id **only** for names shared by more than one step in the flow, so
unique names stay clean and the common message is not taxed for a collision that usually does not
exist. The ambiguity set is computed per flow and threaded through the message-building helpers
(`validateTimeouts`, `validateStepLoopBounds`); the reference-cycle message stays plain because it
already names the flow and the target it closes the cycle through.

`verify:validation` is **139/139** (was 134). Both mutations are killed — V1 (never disambiguate)
fails 2 checks, V2 (always disambiguate) fails the "unique name stays clean" check — so the
assertions pin the precise behaviour rather than merely "an id appears somewhere".

`npm run build` PASS; `verify:roadmap-dashboard` 158/158.

**The GUI gap is now closed.** Both real-Electron designers were run against this change:
`verify:flow-designer` — focused capsule **15/15**, 128 broad observed, 16 retired U-route failures,
**0 unexpected**; `verify:workflow-builder` — focused capsule **16/16**, 74 broad observed, 15
retired, **0 unexpected**. Those retired counts match the 2026-08-15 handoff exactly, so the
validator change introduced no regression in the surfaces that render its messages.

Ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker:
**207 total / 200 closed / 7 outstanding**.

## Action-caused navigation is now guarded — the surviving mutation is dead (2026-08-16)

`awkit-rit` is fixed. The `awkit-76x` navigation contract had a proven half and an unproven half:
mutation **M1** — forcing every navigation to count as independent, so each click-caused navigation
gains a redundant `goto` — survived the entire recorder suite. That is the regression brief §9 warns
against most directly, and nothing in the repository would have caught it.

`verify:recorder-navigation` now records a **real action that causes navigation**: its own context
with the init script and the real `recordActionFromPage` wiring, a click on a link, and an assertion
that no `goto` step is added. Both preconditions are asserted too — that the click was recorded, and
that it actually navigated — so a silent failure to click or navigate cannot masquerade as "no
redundant step was added".

**24/24, and the mutation results invert:**

| Mutation | Before | Now |
|---|---|---|
| M1 — every navigation treated as independent | **SURVIVED** | **KILLED** (`goto steps 0 -> 1: click, goto`) |
| M2 — never emit a step | killed | killed |
| M3 — never mark the causal action | not tested | **KILLED** |

The diagnosis the bead asked for: the earlier harness never reached `captureUrl` because it lacked
the init-script/action wiring needed for a click to be recorded as an action at all. Building the
causal case inside the harness that provably reaches `captureUrl` — rather than debugging the one
that did not — was the shorter path.

`verify:roadmap-dashboard` 158/158. Ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**.
Tracker: **207 total / 199 closed / 8 outstanding**.


## Independent navigation now becomes a replayable step (2026-08-16)

`awkit-76x` is fixed. A recorded flow previously contained exactly ONE navigation step - the opening
`goto` - so any navigation the recorded actions could not explain left replay silently diverging
from what the user did.

`captureUrl` now distinguishes the two cases the navigation model actually has, using a **sequence
rule rather than a time window**: a navigation is action-caused when a recorded action occurred on
that page since its last navigation, and independent when none did. "Did an action happen since the
last navigation" is deterministic; "did an action happen within N milliseconds" is a race that fails
differently on a slow machine. Action-caused navigation stays implicit - the triggering action
replays it and Playwright's auto-waiting carries it - while independent navigation (address bar,
back button, a redirect landing somewhere the click did not explain) emits a `goto` step. Popup
pages are excluded because their own registration and `switchToPopup` already represent the
transition, and the session's opening navigation is excluded because the explicit start `goto`
already covers it.

`verify:recorder-navigation` is **20/20**, up from 18.

**Half of this contract is proven and half is NOT, which is worth stating plainly.** Mutation M2
(never emit a step) is killed by the new checks. Mutation M1 - forcing every navigation to count as
independent, so each one emits a redundant `goto` - **SURVIVES** the entire recorder suite
(`verify:recorder` 217, `verify:recorder-hover` 265, `verify:recorder-actions` 20, `verify:popup`
12). Nothing in the repository would catch the causal rule regressing into exactly the redundant
Navigate steps brief §9 warns against. Filed as `awkit-rit`; a first harness attempt failed because
`captureUrl` never fired in it, and that must be diagnosed before the assertion is written.

Regression suites after the change: `verify:recorder` 217/217, `verify:recorder-hover` 265/265,
`verify:recorder-actions` 20/20, `verify:popup` 12/12, `npm run build` PASS,
`verify:roadmap-dashboard` 158/158. Ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**.
Tracker: **207 total / 197 closed / 10 outstanding**.


## Event correlation and navigation dedup measured — both already correct (2026-08-16)

Brief §11 and §12 were investigated by measurement. **Neither is defective**, and no code changed.

**§11 navigation deduplication — not a defect.** A real `POST /login → 303 → /form` redirect chain
produced exactly **one** `framenavigated` event and one recorded URL. `upsertUrl` additionally
dedups identical URLs inside `URL_DEDUPE_WINDOW_MS`. §11's feared outcome — "several accidental
navigation nodes" for one transition — cannot occur here at all, because navigation never becomes
flow nodes (`awkit-76x`).

**§12 event correlation — already implemented and working.** `recordActionFromPage`
(`RecorderService.ts:1385`) collapses consecutive fills on the same field. Measured on a full login
journey: **15 raw init-script emissions → 5 recorded actions**. Typing `"alice"` emits five
per-keystroke fills and records one.

**A harness trap worth remembering.** The first measurement appeared to show a severe correlation
defect — 15 uncoalesced actions — because the harness exposed its **own** `__awtkit_recordAction`
binding and therefore measured the raw init-script emission, never reaching `recordActionFromPage`.
This is the trap already recorded in AI memory as "the harness bypasses `recordActionFromPage`", and
it produced a confident wrong finding for the third time this session. A correlation harness **must**
call `recordActionFromPage`.

One genuine low-severity residue: after focus leaves a field, a redundant `fill` echo is recorded
(`fill Username="alice"`, `press Tab`, `fill Username="alice"`), because coalescing only merges with
the *immediately* previous action. Filed as `awkit-ty4` and **deliberately not fixed** — the obvious
narrowing ("drop a fill whose value matches the last fill on that target") would break a legitimate
re-fill after a Clear action, and shipping a risky narrowing is worse than documented, idempotent
noise. Also confirmed correct-by-design: a recorded password value is empty because secret redaction
is working, not because the value was lost.

`verify:roadmap-dashboard` 158/158. No product code changed. Ledger unchanged at
**63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker: **206 total / 197 closed / 9 outstanding**.

## Popup coverage measured; recorded URLs proven separate from replay (2026-08-16)

Continuing `awkit-n7n`. Two claims that had been asserted from reading are now **executed**, and one
real gap is measured rather than theorized.

**Popup/multi-page support: measured, not assumed.** Previously called "mature" on the strength of
code reading and scenario counts. Now run: `verify:popup` **12/12**, `verify:popup-identity`
**44/44**, `verify:popup-mock-site` **15/15** — **71 checks, 0 failures**. Sections 5-7 of the
Recorder brief are substantially covered by existing work; building a parallel page registry would
duplicate it.

**Recorded URLs are history, not replay — and that boundary is now asserted.**
`buildRecordedFlow(name, actions, blueprints)` never receives `recordedUrls`, and `"goto"` is pushed
as an action exactly **once**, at recording start for the initial target URL. A recorded flow
therefore contains exactly one navigation step. `verify:recorder-navigation` grew from 15 to **18/18**
to pin this, because it is the kind of boundary that is expensive to rediscover by reading.

That design is defensible for action-caused navigation: brief §9 explicitly prefers navigation
metadata on the triggering action over a redundant Navigate step after every URL change, and
Playwright's auto-waiting carries the transition. The measured gap is §9's **third** case —
**independent navigation during recording** (the user types a URL, presses back, or an external
redirect lands elsewhere) has no representation at all, so replay diverges silently from what was
recorded. Filed as `awkit-76x` with an explicit warning not to "fix" it by emitting a Navigate step
after every URL change.

`verify:roadmap-dashboard` 158/158. No product code changed. Ledger unchanged at
**63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker: **204 total / 197 closed / 7 outstanding**.

## Navigation capture MEASURED — both audit defect theories disproven (2026-08-16)

The `awkit-n7n` audit's two code-read defect theories were wrong, and the measurement that
disproves them is now a registered verifier. **`verify:recorder-navigation` passes 15/15** driving
the real `RecorderService.attachUrlCapture` against real Chromium and the spawned mock site.

| Navigation kind | Recorded? | URL recorded |
|---|---|---|
| initial + full document navigation | **YES** | `/form`, `/login` |
| SPA `pushState` | **YES** | `/login?spa=1` — query preserved |
| SPA `replaceState` | **YES** | `/login?spa=2` — query preserved |
| `hashchange` | **YES** | `/login?spa=2#sec2` — hash preserved, distinguishable from its base |
| revisit a known URL | no new record (dedup) | — |
| back / forward / reload | no new record (destination already visited) | — |

**`awkit-39j` closed as NOT A DEFECT.** Its premise was right — the init script's `kind:"url"` signal
really does feed only the Smart Wait buffer behind `captureSmartWaits` — but the consequence was
wrong. `recordedUrls` never depended on it: `page.on("framenavigated")` *does* fire for same-document
history navigations, and `frame.url()` carries the complete URL.

**`awkit-5sw` closed as NOT A DEFECT.** `emitUrl()` really does emit `origin + pathname`, but that
value never reaches `recordedUrls`, so query and hash survive. The truncation affects only Smart
Wait attribution, where it may well be deliberate.

This is why §8 of the brief insists on measurement over assumption, and why both were filed as
code-read-only rather than asserted. `recordedUrls` is a **deduplicated visited-URL set**, not an
ordered navigation event log — back/forward/reload legitimately add nothing. Whether ordered
navigation events are needed for deterministic replay is a separate, still-open question.

`verify:recorder-navigation` is registered as `real-browser` in the classification registry;
`verify:verifier-classification` reconciles and `verify:roadmap-dashboard` is 158/158. No product
code changed. Ledger unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker:
**203 total / 197 closed / 6 outstanding**.

## Recorder multi-page / navigation audit — Phase 1 of awkit-n7n (2026-08-16)

`awkit-n7n` opens with an audit rather than construction, and the audit changes the picture
substantially. **Popup and multi-page support is mature; navigation/URL capture is the real gap.**

**Multi-page (brief §5-§7) is largely implemented and heavily exercised.** `RecorderService` keeps
per-popup alias assignment, a single async registration pipeline per popup, direct `page.on("popup")`
opener attribution held separately from the context event, and a click-attribution slot with an
explicit comment about Playwright firing the popup event *before* the originating click commits.
`FlowProfile` carries `switchToPopup` / `closePopup` / `switchToMainPage` / `PageAlias` /
`PopupExpectation`. The mock site has **24 popup scenarios**, including `url-lifecycle`,
`redirect-final`, `history-popup`, `blank-then-navigate`, `reversed-order`, `multiple` and
`same-title`. Three popup verifiers exist. Building a new page-registry architecture here would
duplicate working code.

**Navigation/URL capture is implemented but effectively unverified.** No verifier asserts recorded
URL semantics at all; the only SPA-related checks (`verify:recorder-competitive`) assert that
*clicks still record* across a route change, not that the transition is captured. There is no
navigation lab in the mock site — `smart-waits.html` is the only page touching history APIs.

Two concrete defects were found by reading the capture path. **Both are code-read evidence and are
NOT yet proven by test**, which is recorded honestly because the brief's §8 says to establish this by
measurement:

- **`awkit-39j` (P1):** the init script patches `pushState`/`replaceState` and listens to
  `popstate`/`hashchange`, emitting `signal({kind:"url"})` — but `exposeBinding("__awtkit_recordSignal")`
  pushes every signal into `this.signals` (the Smart Wait buffer) behind a `captureSmartWaits` gate
  and nothing routes `kind:"url"` into `captureUrl()`. The **only** path into `recordedUrls` is
  `page.on("framenavigated")`.
- **`awkit-5sw` (P2):** `emitUrl()` emits `location.origin + location.pathname`, discarding hash and
  query, so `#a → #b` and `?page=1 → ?page=2` emit a URL identical to the previous one and are
  likely deduplicated away by `upsertUrl`. Any fix must preserve `maskUrl`'s sensitive-query masking.

**NOT DONE:** the empirical measurement. A throwaway harness to determine which of
goto/pushState/replaceState/hashchange/back/forward/reload actually reach `recordedUrls` failed to
start the mock-site server and was abandoned rather than fudged. That measurement is the next step
and must precede any change to the capture path.

No code changed in this phase; no validation-ledger case changed. It remains
**63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker: **203 total / 195 closed / 8 outstanding**.

## Recorder prerequisite trial generalized beyond click (2026-08-16)

`awkit-5b9` fixes a real and precisely-located defect in the interaction-prerequisite model.
`supportsAutomaticPrerequisiteTrial` was `step.type === "click"`, and **both** resolution routes in
`isValidInteractionExecutionDecision` require it. So a `fill`, `select` or `check` whose prerequisite
came back `unknown` was **permanently blocked** while the validator and the UI told the user to
"Try direct action, confirm no prerequisite, or re-record it" — two of those three routes were
structurally incapable of succeeding for that step type.

The click-only restriction was not arbitrary: Playwright offers `trial: true` on pointer actions but
**not on `fill`**. So the fix supplies a real proof rather than relaxing the gate.
`PREREQUISITE_TRIAL_MODES` gives each eligible type a mode — `"pointer"` uses Playwright's own
`trial: true`; `"predicate"` proves `fill`/`select` with `waitFor({state:"visible"})` + `isEnabled()`
+ `isEditable()`, the same actionability evidence through a different API. `resolveClickTarget`
became `resolveDirectActionTarget` and is now wired into click, fill, select, check, uncheck, radio
and hover. Nothing is forced; a target that fails still refuses to run. `press` stays ineligible **by
design** — it acts through `keyboard.press` against whatever holds focus, so there is no target to
prove. The sensitive-action boundary (`dangerousMutation`/`externalCommit`) is unchanged and still
cannot be self-authorized or user-confirmed.

`verify:recorder-hover` is **265/265** (was 236); the 29 added checks produce **12 failures** against
the click-only implementation, so they bind. `verify:runner` 100/100, `verify:recorder` 217/217,
`verify:recorder-ambiguity` 74/74, `npm run build` PASS.

**Scope delivered is one tranche of a much larger brief.** Two findings from the same investigation
contradicted the brief's diagnosis and were filed rather than "fixed": the repeated validation
warning is **not** duplicate emission — every issue is anchored to a distinct `nodeId`, but the
message renders `step.name`, so several steps called "Fill input" look identical (`awkit-8xx`); and
`Tab` is **not** misclassified as fill text — `recorderInitScript` records it as a `press` step whose
`valueSource` is `{type:"static", value:"Tab"}`, which is the correct representation. Multi-tab
lifecycle, navigation/URL capture, SPA routing, navigation deduplication, the mock-site labs and the
34-item regression matrix are **NOT STARTED** and tracked as `awkit-n7n`; note that
`switchToPopup`/`closePopup`/`switchToMainPage`/`PageAlias`/`PopupExpectation` and three popup
verifiers already exist, so that tranche must begin by auditing existing coverage.

No validation-ledger case changed; it remains **63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker:
**201 total / 195 closed / 6 outstanding**.

## Gitignored paths that matter are now watched (2026-08-16)

`awkit-6ab` closes the audit's last blind spot, and auditing the repository's own `.gitignore` showed
it was hiding two real registry defects rather than only derived artifacts.

**`build/**` was release-owned and implied `packaging_change` while being fully gitignored with zero
tracked files** — the ownership entry pointed at something git could never show, so a lease over it
protected nothing observable. **`resources/**` is PROTECTED as the offline boundary, yet
`resources/browsers/` and `resources/oracle-jdbc/` are ignored subtrees** — a Risk 3 path with
invisible interiors, where swapping a bundled Chromium or dropping in a driver jar changes what ships
without touching a tracked file. Also ignored and consequential: `.env`, `.claude/settings.local.json`
(which governs whether these guards run at all), and the captured-auth files.

Enumerating every ignored path is not an option — `node_modules/` alone would make the audit
unusable — so `WATCHED_IGNORED_PATHS` is deliberately short and specific. Each entry is fingerprinted
at lease grant by mtime and size for a file, or by its direct entries' names and mtimes for a
directory, costing a handful of `stat` calls rather than a filesystem walk. `bash-audit.mjs` now
draws from two sources: `git status` for tracked paths, fingerprint comparison for these. Everything
else ignored stays unwatched by design, and that is stated rather than implied.

Demonstrated live: a write to `build/audit-probe.tmp` was reported by name while
`git status --porcelain build/` returned **0 entries**.

`verify:agent-routing` is **298/298**, **mutation-tested 7/7** here and **40/40** across all six
suites. Three of those seven initially SURVIVED, and two were genuine test gaps rather than bad
mutations: every assertion drove the pure comparator with hand-written fixture strings, so breaking
the fingerprint *producer* — dropping mtimes from directory entries, or emitting `""` instead of
`"absent"` — changed nothing. The producer is now driven against a real temp tree. Tracker:
**198 total / 194 closed / 4 outstanding**, all externally blocked and owner-gated. No
validation-ledger case changed; it remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## No-lease gap closed for Risk 3 paths (2026-08-16)

`awkit-mtt` closes the last documented hole. The guard allowed every edit when no lease was held,
because failing closed everywhere would block every task that does not use a contract — a gate that
stops all work gets removed rather than obeyed. That reasoning is right for ordinary work and wrong
for the handful of areas the repository already treats as critical.

`PROTECTED_PATHS` is **derived** from the risk model: a path is protected when what it implies is
already Risk 3. That yields exactly five — `src/licensing/**`, `src/auth/**`, `src/secrets/**`,
`src/security/**`, and `resources/**` (the offline boundary). Deriving rather than hand-listing means
a new Risk 3 flag, or one attached to a new path, extends the set automatically instead of drifting
from a second list. Ordinary paths stay unrestricted with no lease; these refuse an unclaimed write
and name the owner who should take one. `bash-audit.mjs` gets the symmetric rule: with no lease it
reports protected files that are dirty, comparing against the committed state since no baseline
exists.

Extracting `decideWrite()` from the hook's `main()` was part of the fix, not incidental. Mutation
testing showed the guard's actual judgement was untested — only its payload parser was covered — so
flipping the protected-path branch changed no assertion. P3 now kills that mutation.

`verify:agent-routing` is **277/277**, **mutation-tested 5/5** for this change and **33/33** across
all five suites. Both non-vacuity directions are pinned: an empty protected set protects nothing, and
a set equal to every path reinstates the fail-closed-everywhere behaviour this deliberately avoids.
Demonstrated live with no lease held: `src/licensing/`, `src/secrets/` and `resources/` were refused
by name while `app/renderer/App.tsx` and `src/runner/exec.ts` passed. Tracker: **197 total /
193 closed / 4 outstanding**, all externally blocked and owner-gated. No validation-ledger case
changed; it remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Bash write-lease bypass closed by filesystem audit (2026-08-16)

`awkit-c6n` closes the last documented hole in the write lease. The `PreToolUse` guard matches
`Edit|Write|NotebookEdit`, so a shell redirect, `sed -i`, `mv`, or `git checkout` never reached it.

**The obvious fix was rejected on evidence, not taste.** Matching `Bash` and scanning for `>` or
`sed -i` is wrong in both directions: it misses `python -c "open(...)"`, `tee`, `cp`, and any script
that writes, while blocking `echo "a > b"` or a commit message containing an angle bracket. A guard
with both false negatives and false positives trains people to work around it.

So `tools/agents/bash-audit.mjs` runs as a **PostToolUse** hook and observes the filesystem instead
of the intent. It asks git what is dirty and subtracts three things: the lease scope, shared write
paths, and the dirty set recorded when the lease was granted. Whatever remains was written by that
command outside the lease, whatever syntax produced it. Violations are recorded onto the lease, and
`completionBlockers()` now reads them back — detection acquires consequences at the gate rather than
being a warning to scroll past.

This is **detection, not prevention**: PostToolUse runs after the write. What changes is that an
invisible bypass becomes an immediate, attributable one. Two limits are stated rather than glossed:
gitignored paths (`out/`, `graphify-out/`) are invisible to `git status` by definition, and the
audit costs ~100ms per `Bash` call while a lease is held — nothing when none is, which is the
common case.

Running it against a real lease immediately found a defect in it: `grantLease` writes the lease file
and mirrors `assignments.json` *after* snapshotting the baseline, so taking a lease reported itself
as an out-of-lease write. `SYSTEM_BOOKKEEPING_PATHS` excludes exactly those two paths, and a check
proves the exclusion is a list rather than a shape — mutation testing showed that widening it to
"every `.json`" survived, because every other fixture was `.ts`.

`verify:agent-routing` is **256/256**, **mutation-tested 6/6** for this change and **28/28** across
all four suites. Demonstrated live: a shell redirect to `docs/ai/PROJECT_BRIEF.md` under a lease
scoped to `tools/agents/**` was reported by name, and a command that wrote nothing stayed silent.
Tracker: **196 total / 192 closed / 4 outstanding**, all externally blocked and owner-gated. No
validation-ledger case changed; it remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## package.json shared-write split removes the last measured lease friction (2026-08-16)

`awkit-dwo` closes the friction the first routed task measured: `package.json` is release-owned
because it carries the dependency graph, so adding a one-line npm script forced a full lease handoff
to the Release specialist. The path map is file-granular and the `PreToolUse` guard runs **before**
an edit, so neither can tell whether `scripts` or `dependencies` is about to change.

Rather than pretend otherwise, the two halves are split. `SHARED_WRITE_PATHS` marks `package.json`
shared for the `scripts` field, and the edit-time gate is **relaxed** for it — any lease holder may
write the file. The enforcement moved rather than disappeared: `deriveGuardedFieldChanges()` reads
the **committed** file, compares top-level keys against the working tree, and reports a change to
any non-shared field as a scope escape that blocks completion. Permissive where content is invisible,
strict where it is not.

`sharedFields` is an allow-list, so the default is **guarded**: a top-level key nobody has considered
— a future `build` block, a `workspaces` entry — is release-owned automatically rather than shared by
omission. Removals count too, since the comparison runs over the union of both key sets, and a file
that will not parse is reported as guarded rather than clean.

Demonstrated live on this task rather than only asserted: the new `agent:check-agents` script was
added to `package.json` while holding a **QA** lease, which the old model would have blocked; a
dependency edit under that same lease was then reported as a scope escape naming `release`.

`verify:agent-routing` is **242/242**, **mutation-tested 6/6** — including S2, which shares the
dependency fields and is the fail-open direction. Tracker: **195 total / 191 closed / 4 outstanding**,
all four externally blocked and owner-gated. No validation-ledger case changed; it remains
**63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Router narrows writerSequence to actual path owners (2026-08-16)

`awkit-yeh` closes the rough edge the first routed task exposed. `route()` built `writerSequence`
from every activated writer-mode agent regardless of whether it owned any of the task's paths, so
`filesystem_write_change` put persistence at the head of the lease order for a task whose only file
was `app/main/uiSettings.ts` — runtime's. The manager, being writer-mode and activated on every
task, sat in every sequence for the same reason.

The sequence is now restricted to activated writers that own at least one expected path, and the
dropped writer-mode agents are reclassified as **consultants**, which is what they actually were.
The same task now routes `runtime` alone, with persistence as a consultant.

**The fallback matters more than the narrowing.** `validate-contract.mjs` derives "does this task
change product code?" from `writerSequence.length > 0`, so a narrowing that could empty the list
would stop requiring a writer at all — failing OPEN on exactly the tasks whose paths are unmapped or
mis-declared. When the intersection is empty, or no paths are declared, the full activated-writer
list is used instead; both fallbacks err toward requiring more review, never less. A verifier check
drives an unmapped-path contract through `validateContract` and requires `writer.absent` to still
fire, and the mutation that removes the fallback is killed by it.

`verify:agent-routing` is **228/228** and the fix is **mutation-tested 4/4** (narrowing removed,
fallback removed, dropped writer discarded rather than reclassified, narrowing flag pinned false).
Tracker: **194 total / 190 closed / 4 outstanding**, all four externally blocked and owner-gated. No
validation-ledger case changed; it remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Windows settings atomic replacement hardened, routed end to end (2026-08-16)

`awkit-4qs` is closed, and it was the first task run through the deterministic routing system rather
than around it. `app/main/uiSettings.ts` wrote settings by `writeFile(tmp)` + `rename(tmp, target)`,
which is crash-safe but not contention-safe: on Windows a brief handle from antivirus, the search
indexer, or a preview pane makes `rename` fail with `EPERM`/`EBUSY`, and a single such failure
discarded the user's settings change outright.

New `app/main/atomicReplace.ts` retries **only** `EPERM`/`EBUSY`, **only** a bounded number of times
(5 attempts, 20ms linear backoff). The narrowness is the point: retrying `ENOENT`, `ENOSPC` or
`EACCES` would turn a clear immediate failure into a slow one with the same outcome, and an unbounded
retry would stall `before-quit`, which awaits the settings queue. Every terminal path removes the
temp file and rethrows the **original** errno, leaving the previous `ui-settings.json` untouched. The
persisted schema, the IPC contract, and the single-FIFO write ordering are unchanged.

`verify:write-queue` grew from 7 to **29 checks** and was **mutation-tested 5/5** — retry-everything,
unbounded retry, missing temp cleanup, a wrapped errno, and a narrowed transient set were each
introduced and each caught. `verify:settings-persistence` passes **3/3** in real Electron: 40
concurrent patches all persist, zero leftover temp files, and a last-moment update still flushes on
shutdown.

**Routing observations from the first real run.** The router classified the task Risk 2 and activated
manager, runtime, persistence, qa and qc; the lease moved runtime -> qa -> manager as a sequence,
never concurrently. Derived classification then caught a gap the contract could not have known
about: `.beads/**` was unmapped, so no specialist was answerable for the tracker export. It is now
manager-owned. Two rough edges worth recording rather than smoothing over: `writerSequence` lists
writer-mode agents activated purely by flag even when they own none of the task's paths (persistence
appeared first here but had nothing to write), and the preserved stash the handoff warned about
turned out to be **docs-only**, so it never overlapped this settings work at all.

`verify:agent-routing` is **215/215**. Tracker finishes at **193 total / 189 closed / 4 outstanding**,
and all four remaining are externally blocked owner-gated items, so nothing is ready to pick up. No
validation-ledger case changed; it remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Deterministic multi-agent routing - Phase 5 complete, model dogfooded (2026-08-16)

Phase 5 generates executable platform agent definitions from the canonical registry, closing
`awkit-bk3`. Eleven `.claude/agents/*.md` subagent definitions are rendered from
`tools/agents/routing-matrix.mjs`, each with a tool grant derived from its mode - a `read-only`
role receives no `Edit` or `Write` tool at all, so read-only is a property of the runtime rather
than a promise in prose. Codex and Gemini have no per-role agent runtime in this repository, so each
receives ONE generated adapter skill (`.{codex,gemini}/skills/agent-routing/SKILL.md`) carrying the
same roster: generate where it executes, point where it does not. All 13 outputs are byte-compared
by `verify:agent-routing`, so hand-editing any of them fails. The 12 pre-existing skills are
reconciled to roles through `ROLE_SKILLS`, and the verifier asserts no skill is orphaned and no role
cites one that is missing.

**The routing model was dogfooded on this task, and it found three real defects in itself.** The
registry carried two statements of ownership - `AGENTS[].ownsPaths`, which leases are checked
against, and `PATH_DOMAINS[].owner`, which derived classification uses - and they had drifted:
`tools/agents/**` was mapped to the Manager for classification while missing from the Manager's
`ownsPaths` entirely, so amending a lease rerouted work to the specialist who already owned it.
`app/preload.ts` and the Architect's two documents had the same disagreement. A new consistency
check now proves the two lists agree in both directions; it found the `app/preload.ts` case
immediately after being written. `.claude/**`, `.codex/**` and `.gemini/**` were unmapped
altogether, so no specialist was answerable for agent configuration.

Enforcement was also proven in the live runtime, not only against piped payloads: an edit to
`docs/ai/CURRENT_STATE.md` while holding a `release` lease scoped to `package.json` was refused by
the `PreToolUse` hook, and the amendment rerouted to the Manager rather than widening the release
lease. Measured friction, reported rather than smoothed over: adding a one-line npm script requires
a lease handoff to `release`, because `package.json` carries the dependency graph and is therefore
release-owned. That checkpoint is deliberate, but it is a real cost on small changes.

`verify:agent-routing` now passes **213/213** and is **mutation-tested 12/12**, including the four
new Phase 5 mutations (ownership drift, hand-edited generated definition, a read-only role handed
write tools, an orphaned skill). No validation-ledger case changed; it remains
**63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker finishes at **193 total / 188 closed / 5 outstanding**
with `awkit-a1u` and `awkit-bk3` both closed; the five remaining are the pre-existing owner-gated
items plus settings-only `awkit-4qs`.

## Deterministic multi-agent routing - Phases 0-4 implemented (2026-08-16)

AWKIT now has an enforced, deterministic specialist-routing system under `tools/agents/`. A reviewed
architecture proposal was checked against the repository first: five of its concrete claims were
wrong (`src/orchestration` does not exist, `DEFECTS.md` is not at the root, its evidence vocabulary
near-missed the ledger's, contracts were placed in a new `.ai/` rather than the existing
`docs/ai/tasks|contracts`), and its central claim of determinism was a prediction rather than a
measurement. Phases 0-4 implement the corrected design; Phase 5 (executable per-platform agent
definitions) is deliberately deferred until the routing model is proven on real tasks.

`tools/agents/routing-matrix.mjs` is the **single** encoding of agent ownership, activation
predicates and risk. The proposal stated those rules in three places that already disagreed, so
`docs/ai/routing/ROUTING_MATRIX.md` is now RENDERED from the registry and `verify:agent-routing`
re-renders it and compares byte-for-byte. It is a `.mjs` module rather than YAML because the
repository has no YAML parser and adding one would itself be a `new_dependency` change routed to
Architect and Release — a governance tool must not open the boundary it polices. TypeScript would
have bought nothing: `tsc --noEmit` covers only `app` and `src`, so a registry under `tools/` is not
typechecked by the build.

Classification is two-phase. `declared` drives routing before work starts; `derived` is computed
from `git diff --name-only` through the path map afterwards, and a domain in `derived` that the
contract never activated is a **scope escape** that blocks completion. Only soundly path-implied
flags are derived — editing the renderer proves it changed, never that the change was visual.

The write lease is enforced, not described. `tools/agents/lease-guard.mjs` runs as a `PreToolUse`
hook on `Edit|Write|NotebookEdit` beside the existing graphify guards and blocks out-of-scope
writes. Scope grows through `npm run agent:lease-amend`, which **re-runs routing**: adding
`src/storage/**` to a `frontend` lease releases that lease rather than widening it and names
Persistence as the next holder. There is no environment-variable bypass; emergency overrides are
logged, narrowly scoped, and force QC. Two limits are documented rather than hidden: no active lease
means edits are allowed, and `Bash` writes bypass the hook — derived classification is the backstop.

`verify:agent-routing` passes **119/119** and was **mutation-tested 8/8**. That mutation round earned
its keep: the completion gate's own vacuity guard could be deleted while the suite stayed green,
because the assertion was being satisfied by the validator's independent rule rather than the guard
it named. The check now asserts that guard's own blocker text. Registrations: the verifier is
classified `static-source-validation` (179 commands now classified), and
`docs/ai/contracts/active-lease.json` is registered in `tools/roadmap/lib/sources.mjs` as a declared
blind spot (`parsed: false` — the holder is mirrored into `assignments.json`, already the only
authoritative assignee source), taking the dashboard to **14 sources**.

Verification: `npm run build` PASS; `verify:agent-routing` 119/119; `verify:roadmap-dashboard`
158/158 with the Overview reading "Sources agree"; `verify:verifier-classification` 179 commands;
`verify:source-hygiene` 9/9; `check-memory.mjs` PASS. The write-lease hook was additionally driven
end-to-end with real payloads: in-scope allowed, out-of-scope blocked (relative and absolute),
outside-repo allowed, damaged lease blocked. No validation-ledger case changed; it remains
**63 PASS / 2 NOT RUN / 1 BLOCKED**. Tracker is **193 total / 187 closed / 6 outstanding**:
`awkit-a1u` was filed and closed for Phases 0-4, and `awkit-bk3` filed for the deferred Phase 5. The
roadmap baselines were moved from 191/186/5 accordingly.

## Restored Loop capsule-and-ring contract - implementation verified (2026-08-15)

Structured self-Loops in Flow Designer and Workflow Builder use the authoritative augmented
`7282178` capsule-and-ring topology frozen in `LOOP_VISUAL_CONTRACT.md`: one 160x20/r10 side-attached
capsule, 40/30/44 outer/main/hit radii, configured `maxIterations` centered in the ring, and one
2-second linear circular sweep. The capsule/path, concentric rings, configured value, and mode-aware
design label remain stationary. Long summaries are bounded to the 160-unit lane with ellipsis and an
exact full-text title. Reduced motion freezes only the visible sweep. Structured self-Loops
have no full-card U-route, direction-path overlay, or arrow; legacy cross-node `loopBack` remains a
separate directional return connector and runtime model.

`geometry.ts` now owns the shared capsule measurements and full collision/fit footprint. `LoopEdge`
and `FlowCanvas` consume the same constants, so side selection and fit-to-screen can no longer model
the superseded 36-unit U-route marker while rendering a 160-unit capsule. The footprint includes the
lane, 44-unit hit target, ring, label band, and padding. A real dense fixture places a connected peer
100 graph units from the owner—outside the obsolete footprint but inside the real capsule—and requires
the opposite side, full canvas containment, no node/label/insert-control overlap, and sensible
right -> left -> right recomputation when that peer is physically dragged away and back.

The canonical GUI wrappers execute all 128 Flow and 74 Workflow broad checks. Sixteen exact named
U-route-era compound assertions in each child may be non-binding; their functional intent is replaced
independently in the focused suites. The adapter requires the historical check total and complete
allow-list reachability, and rejects killed, signalled, truncated, status-2, or unexpected-failure
children. Focused real-Electron coverage requires the exact ordered 15-name Flow and 16-name Workflow
inventories and binds topology/visible layers/stacking, bounded labels, pointer/keyboard/double-click
access, 25/100/200% zoom plus pan, owner/peer drag, exact dotted/4px style, two save/reload cycles,
configuration and destructive Undo/Redo, Conditional-exit cardinality, two-Loop DOM/config/selection/
animation isolation, pixel-visible sweep motion, and single-/multiple-Loop reduced motion.

Fresh 1440x900 light/dark evidence is under
`reports/loop-capsule-verification/2026-08-15/` for both designers. All four captures were opened and
compared with `reports/loop-connector-fix/flow-central-control.png`: the dominant concentric control,
compact attachment, configured value, label clearance, current accent colors, and absence of the
rejected U-route/double animated path are visually confirmed. The focused Flow suite passes **15/15**
and the focused Workflow suite passes **16/16** on the normal Windows checkout. The full canonical
gate sequence and Program Status reconciliation are recorded in the newest `TASK_LOG.md` and handoff.
No validation-ledger case changed; it remains **63 PASS / 2 NOT RUN / 1 BLOCKED**. `awkit-6cg` was
reopened while the restored-capsule defects were active and reclosed after the canonical editors passed;
the final tracker is **191 total / 186 closed / 5 outstanding / 104 edges**. The unrelated settings-only
`awkit-4qs` remains open and unclaimed.
Graphify was refreshed from this closeout source to **12,284 nodes / 25,532 edges / 618 communities**.

The older corrective return-path sections below are retained only as implementation history and are
superseded by `LOOP_VISUAL_CONTRACT.md` plus this current section.

## SUPERSEDED: corrective U-route Loop connector closeout (2026-08-14)

Flow Designer and Workflow Builder now share a compact rounded return-path presentation for
structured self-Loops. New Loops use the existing authoritative count configuration
(`maxIterations: 3`) plus one shared dotted/4px/circular/closed-arrow visual factory; loaded styles
and configuration are never defaulted over. The path itself carries one 1.8-second linear SVG dash
animation and a static direction arrow. The former orbiting marker arc and bare numeric marker value
are removed. Reduced motion freezes the path to a readable directional segment. Canvas labels are
design summaries (`Count × N`, `For Each`, data-source name, or compact `While` condition), never a
current/total execution counter. Their geometry is anchored above the owning card rather than over its
vertical footprint, so the node layer cannot cover long While/data-source summaries.

`FlowCanvas` keeps Loop and legacy cross-node `loopBack` paths in one persistent SVG layer so node
drag changes geometry without remounting or restarting the animation timeline. The self-Loop route
and marker footprint are slightly smaller, remain behind real node cards, participate in fit bounds,
and preserve the wide invisible interaction path. Enter, Space, Delete/Backspace, pointer,
double-click, node-menu Configure/Remove, inspector deletion, Undo, and Redo are covered. Multiple
Loops retain independent ids, editor state, labels, routes, and animation elements. Legacy
`loopBack` execution remains separate, but now uses a visibly returning design-time curve and arrow.

Persistence hardening preserves all nested Loop fields (including unknown forward metadata), an
opaque Loop payload attached to legacy `loopBack`, and Workflow edge style across
Workflow -> Scenario -> Workflow conversion. Repeated Loop-exit promotion and two conversion cycles
keep exact edge ids/counts and one Conditional exit. Runtime production semantics were not changed;
the existing runner now has focused data-source Loop regression coverage.

Fresh takeoff evidence: build PASS; Flow Designer Electron GUI **128/128**; Workflow Builder Electron
GUI **74/74**, now including an isolated legacy cross-node `loopBack` return path, computed base-stroke
visibility, a hidden-path mutation control, ordinary-edge isolation, 25/100/200% zoom, and physical drag
without animation-timeline restart. The completed implementation checkpoint also recorded Flow mapping
**142/142**, Workflow conversion **20/20**, branch pairs **40/40**, runner **100/100**, validation
**134/134**, editor history **14/14**, canvas layout **35/35**, canvas performance **13/13**, Mock Site
**145/145**, source hygiene **9/9**, randomized round trip **27/27**, and verifier classification over
**178 commands**. The focused `@playwright/test` data-source Loop spec remains environmentally BLOCKED
before collection because this Node/config-loader path rejects `playwright.config.ts`; the supported
`verify:runner` path proves the same runtime behavior. `verify:all-typecheck` rebuilt the app successfully,
then remained red only on the same nine documented pre-existing script-type diagnostics outside this
Loop/test/document scope.

Four isolated 1440x900 captures under `reports/loop-connector-closeout/2026-08-14-takeoff/` were opened
and manually inspected: Flow Designer and Workflow Builder in light and dark. The return path, marker,
arrow, and full design-only labels remain clear of the owning cards in both themes. The Workflow evidence
shows both independent Loops after the inspector is collapsed, its toast dismissed, and the canvas refit.
Graphify was refreshed to **12,215 nodes / 25,379 edges / 620 communities** after the corrected source and
memory text, and Program Status reports **157/157 - Sources agree**. `awkit-6cg` is closed; the unrelated
settings retry remains open as `awkit-4qs`. Tracker: **191 total / 186 closed / 5 outstanding / 104 edges**.
Validation ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## SUPERSEDED: reference-style U-route and configured-value marker (2026-08-13)

Flow Designer and Workflow Builder now render every structured self-Loop through the same shared
`LoopEdge` as one continuous rounded return path. It leaves the real card at bottom-center, wraps around
the collision-aware left or right side, and returns at top-center. The connector stays in the SVG edge
layer below DOM cards, its fit-to-view footprint includes the full route and marker, and the live drag
overlay recomputes from graph coordinates without adding a node or persisted visual position.

A compact circular marker sits directly on the route's outer vertical segment. It reads the existing
`LoopConnectorConfig.maxIterations` and displays only that configured number; missing/non-numeric legacy
configuration leaves the marker blank instead of inventing execution progress. Changing the shared Loop
editor from 5 to 10 updates the marker immediately, and existing Flow/Workflow serialization supplies the
same value after save/reload and conversion. No runtime counter, IPC event, schema, validation, or runner
policy was added or changed.

One highlighted arc rotates around the stable marker on the existing 2-second linear, transform-only
orbit. The return path and number remain stationary. Reduced motion freezes the arc at a readable angle
while preserving the circle and value. The marker and route retain connector click/double-click and the
parent edge's Enter/Space configuration path; node-menu Configure/Remove actions remain separate.

Focused evidence: build PASS; Flow Designer Electron GUI **113/113**; Workflow Builder Electron GUI
**60/60**; Flow step mapping **137/137**; workflow sentinel/conversion **14/14**; branch-pair validation
**36/36**; canvas performance **13/13**; canvas layout **35/35**; source hygiene **9/9**. The GUI suites
cover 5 -> 10 live binding and reload, rounded geometry, direct pointer/keyboard reopening, physical drag,
25/100/200% zoom, decoded pixel motion, stationary text, reduced motion, and non-Loop isolation. Light and
dark screenshots were inspected in both editors. No mock-site fixture was added because this is an
editor-local canvas presentation with no runtime behavior. The pre-existing uncommitted `awkit-6cg`
tracker/assignment work was preserved and intentionally excluded from this UI task.

## Complete Loop connector authoring and workflow execution - awkit-pwc COMPLETE (2026-08-11)

Flow Designer and Workflow Builder now open a complete shared Loop editor when a self-loop is
created. Authors can set the fixed self target, count/static-list/data-source/while-condition mode,
maximum iterations, runtime-input parameter, delay, data-source binding, and the structured condition
used by while-condition loops. Adding a Loop to a node that already has a Standard exit converts that
exit to an explicit always-taken Conditional exit; append/drag/logic entry points preserve the same
rule, while invalid loaded Standard exits remain editable instead of being selector-locked. Removing
the Loop restores a lone exit to Standard through the existing branch reconciliation policy. Legacy
cross-node Loop Back remains separate and now exposes its expression, target, and `maxLoopCount`.

`WorkflowEdge` and `ScenarioLink` now persist `LoopConnectorConfig` and `maxLoopCount` through both
conversion directions. `PlaywrightRunner` executes workflow self-loops with the same canonical
count/list/data-source/while-condition value materialization and 1,000-iteration cap used by
`FlowExecutor`; it evaluates while conditions against the previous iteration, injects loop values into
runtime inputs, takes the Conditional exit after completion, and bounds legacy Loop Back traversals.
Missing while conditions and invalid workflow loop bounds are execution-blocking validation errors;
validation was not weakened.

Focused evidence: build PASS; Flow Designer Electron GUI **93/93**; Workflow Builder Electron GUI
**41/41**; runner **99/99**; validation **134/134**; branch-pair/loop authoring **36/36**; workflow
sentinel/conversion **14/14**. The existing mock-site routes are sufficient: designer authoring is
covered in isolated real-Electron profiles and runtime routing uses the existing local login/form lab,
so no duplicate mock-site scenario was added. Tracker **188 total / 184 closed / 4 owner-gated
outstanding / 104 edges**; validation ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Professional core-surface visual redesign - awkit-7le COMPLETE (2026-08-09)

Workflow Builder and Flow Designer now use a denser, purpose-built command rail: identity stays
visible, one domain action leads each editor, file/layout/history utilities are icon-led with intact
accessible names, validation remains derived state, and the canvas retains visual priority. Workflow
Builder also replaces two disabled form controls with a truthful read-only execution summary. All
existing commands, shortcuts, permissions, save/export behavior, canvas geometry, and persistence
contracts remain unchanged.

Administration is now table-first instead of card-heavy. The duplicate page heading is removed from
the visible hierarchy while remaining in the accessibility tree; context facts sit in a compact rail;
Users adds local search/status filtering, initials avatars, compact icon actions, and a full-width
creation strip; Roles shows concise permission previews with the complete picker retained in the
editor; Permissions and Audit Log use the available width with denser rows and stronger scan paths.
Licensing remains one operational surface. Workflows now presents a full-width library table with
flexible identifying columns. Embedded Program Status retains the canonical roadmap view renderers
and keeps its right-side view rail at supported desktop widths.

Final rendered evidence was captured and manually inspected in both themes for Workflow Builder,
Flow Designer, Users, Roles, Permissions, Audit Log, Licensing, Workflows, and Program Status at
`reports/ui-redesign/final/`. Responsive assertions cover 1024x768, 1280x800, 1440x900, and
1920x1080 where applicable. Focused evidence: build PASS; Workflow Builder **37/37**; Flow Designer
**89/89**; Administration **29/29**; Settings/Program Status **173/173**; licensing logic **183/183**;
licensing E2E **38/38**; RBAC E2E **70/70**; reports/settings accessibility **14 PASS / 0 FAIL**;
Mock Site **145/145**; source hygiene **9/9**; verifier classification reconciled. Script
typechecking retains only the same nine documented pre-existing diagnostics. Tracker **187 total /
183 closed / 4 owner-gated outstanding / 104 edges**; validation ledger remains **63 PASS / 2 NOT
RUN / 1 BLOCKED**.

## Editor, Administration, Workflows, and Program Status UI consistency - awkit-39h COMPLETE (2026-08-09)

Workflow Builder and Flow Designer now use shared `EditorCommandBar`, command-group, identity-field,
and compact history primitives while retaining their domain handlers and top-header Save/Export/Back
actions. Workflow commands are grouped into identity, files, configuration, construction, execution,
layout/history, and state; Flow Designer uses the same grammar for identity, edit, layout/history,
and derived validation state. Both bars wrap complete groups without horizontal scrolling and retain
all accessible labels, disabled states, shortcuts, and reduced-motion behavior.

Users, Roles, Permissions, Audit Log, and Licensing now compose one Administration page shell with
shared headings, descriptions, summary metrics, table/status language, loading/empty/error states,
and responsive grids. Users prioritizes the account directory beside a bounded creation panel; Roles
uses a responsive role grid and permission counts; Permissions groups the real deny-by-default model
by actual permission prefixes; Audit Log adds local search/result filters; Licensing uses the same
summary/dashboard hierarchy without changing license authority or exposing signing material.

The Workflows table now fills its usable desktop content width with flexible identifying columns and
a compact actions column. Embedded Program Status continues to render the exact canonical roadmap
view registry and snapshot through authorized offline IPC, but now keeps a distinct roadmap section
rail on the right inside the normal application shell; it still has no localhost, webview, iframe,
internet, or portable-generation dependency.

Focused evidence: build PASS; Workflow Builder **36/36**; Flow Designer **88/88**; Administration
**24/24**; Settings/Program Status **172/172**; licensing logic **183/183**; licensing E2E **38/38**;
RBAC E2E **70/70**; reports/settings accessibility **14 PASS / 0 FAIL**. Dark/light screenshots cover all five
Administration pages, Program Status, Workflows, Workflow Builder, and Flow Designer; Workflow Builder
was also captured at a 1024-wide desktop layout and Flow Designer at 1936 wide. Tracker **186 total / 182
closed / 4 owner-gated outstanding / 104 edges**; validation ledger unchanged at **63 PASS / 2 NOT
RUN / 1 BLOCKED**. Source hygiene **9/9**, verifier classification, roadmap **157/157 — Sources
agree**, AI memory, and Graphify refresh (**12,115 nodes / 25,110 edges / 612 communities**) pass.

## Super User controls, Recorder UX, session policy, and editor history - awkit-3jm COMPLETE (2026-08-08)

The Program Status dashboard is now embedded in the app from the same source/views as the standalone
dashboard, is authorized only for Super Users, omits the portable-generation control, and has no
localhost runtime dependency. Super Users can also enable bounded, rotated, redacted JSONL debug logs
and configure the persisted inactivity timeout (default 30 minutes) through separately authorized IPC.

Recorder now captures trusted keyboard shortcuts as one `press` action, filters normal typing,
auto-repeat, protected inputs, and untrusted synthetic events, and replays the canonical chords through
Playwright. Clear All and individual deletion are confirmed and dependency-aware; recorded URL rows are
fully mouse/keyboard activatable while nested controls remain isolated. Flow Designer and Workflow
Builder share bounded 50-state undo/redo with 300 ms coalescing, save-checkpoint dirty semantics,
buttons and safe shortcuts. The Unsaved Changes dialog has a trapped focus cycle, stable desktop action
alignment, narrow responsive stacking, and reduced-motion-safe behavior.

Focused green evidence: Super User controls **49/49**; settings E2E **170/170**; hotkeys **37/37**;
Recorder actions **20/20**; editor history **14/14**; Flow Designer GUI **87/87**; Workflow Builder GUI
**34/34**; Recorder hover **236/236**; Mock Site **145/145**; runner **95/95**. Nine deliberate
authorization/redaction/canonicalization/session/cleanup/history/dialog mutations each made a verifier
red and were restored. The validation ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Recorder Smart Wait causality - awkit-dl7 COMPLETE (2026-08-08)

New Recorder-inferred waits carry a versioned, privacy-safe evidence contract that separates
`required`, `optional`, and `advisory` observations. A wait may gate replay only when its transition
is bounded, attributable to the action, and (for element targets) backed by a unique high-confidence
Element Identity Contract. Trusted SPA route changes rank above nearby DOM/network observations;
page-load timers, polling, generic controls, global loaders, and unrelated list/toast changes cannot
become fatal merely because they happen after a click.

The runner skips advisory evidence, logs optional misses without failing, validates required enabled
targets by hashed identity, and reports specific wait identity/evidence codes. Legacy/manual waits
with no evidence retain their historical semantics. Real Chromium verification is **33/33** through
observer -> profile -> JSON -> StepExecutor; five deliberate mutations failed before restoration.
The validation ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Interaction prerequisite execution decisions - awkit-aek COMPLETE (2026-08-08)

Recorder output no longer converts an unknown hover/insertion prerequisite into a locator failure
when element identity is already proven. `StepLocator.executionDecision` now stores an independently
bound decision: ordinary clicks default to a Playwright actionability trial, an operator may confirm
that no prerequisite is required with a recorded reason, and blocked/sensitive actions remain
fail-closed. Legacy prerequisite-only `needs-review` records normalize to resolved identity without
silently gaining execution authority.

At runtime an automatic ordinary click performs `click({ trial: true })`, checks cancellation,
re-resolves the identity contract, and only then performs the real click. It never uses `force`.
Flow Designer shows the identity and prerequisite states separately, offers **Try direct actionability
check**, **Confirm no prerequisite**, and **Re-record prerequisite**, invalidates decisions after
material edits, and emits one prerequisite validation finding instead of duplicate locator warnings.

Focused verification: build PASS; Flow Designer GUI **72/72**; mapping **133/133**; validation
**132/132**; runner **95/95**; Recorder hover **236/236**; Recorder **217/217**; Recorder flow
**33/33**; locator guard **35/35**; safety **17/17**; source hygiene **9/9**. `typecheck:scripts`
still reports only the same nine documented pre-existing diagnostics. The validation ledger remains
**63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Deterministic Recorder Element Identity Contract - awkit-szp COMPLETE (2026-08-07)

Recorder capture now persists an additive, versioned `ElementIdentityContract` for the exact event
owner instead of treating one unique selector string as the identity invariant. The contract binds the
primary and ranked alternatives to ordered container/frame/shadow context, a hashed multi-signal
fingerprint, bounded structural/geometry evidence, composed-path evidence, and an explicit confidence
basis. Normal positional captures persist the same guarded proof previously reserved for sensitive
actions; replay refuses count, position, or fingerprint drift with `TARGET_IDENTITY_CHANGED`.
Sensitive actions retain `SENSITIVE_TARGET_IDENTITY_CHANGED` and no broad/blueprint recovery.

Interaction prerequisites are represented separately as `none`, `resolved`, or `unknown`. Saturated
insertion tracking can therefore show **Element identity: Resolved** with **Interaction prerequisite:
Unknown** and remain fail-closed for the truthful actionability reason. Flow Designer/Recorder wording,
round-trip mappings, and the `/recorder-lab` twin fixture were updated. Existing flows remain compatible
because all fields are optional. The validation ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

Focused green evidence: ambiguity **74/74**, guard **35/35**, action owner **11/11**, hover
**222/222**, mock site **145/145**, and build PASS. Removing normal guard enforcement made the
ambiguity gate fail **67 pass / 4 fail**, including a wrong-twin click after reorder; restoration
returned it to green; the final gate with explicit performance checks is **74/74**. Final broad
verification is recorded in the task log. Tracker: **173 total / 169 closed / 4 outstanding**;
roadmap **157/157 — Sources agree**. `typecheck:scripts` remains red only on the same nine documented
pre-existing diagnostics.

## Roadmap portable release base disclosure - awkit-402 COMPLETE (2026-08-07)

The local Program Status dashboard now shows the exact clean main release base beside **Generate next
portable EXE**: the 12-character commit, current application version, and calculated patch target.
The full commit remains available as a tooltip and in the confirmation dialog. This is truthful about
release sequencing: the displayed commit is the clean base; the fixed release wrapper creates the
version commit from that base before packaging. The read-only GET status now exposes only that
repository identity and version data, never command, argument, path, environment, or child output.

verify:roadmap-dashboard passes **157/157**, including the main-commit/patch-target API shape, UI
hook, and existing command-disclosure boundary. `npm run build`, `npm run verify:source-hygiene`
(**9/9**), and the AI-memory check also pass. Tracker: **172 / 4 outstanding / 168 closed / 95
edges**. The validation ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Recorder saturation provenance false positive — awkit-85s COMPLETE (2026-08-07)

Insertion-tracking saturation no longer turns a unique, high-confidence semantic locator into an
unresolved action merely because that element is outside the narrow hover visibility catalog. The
Recorder now snapshots all light-DOM elements present at its at-rest baseline in a `WeakSet`, distinct
from the hover/reveal catalog. It retains the fail-closed boundary: an action that genuinely appeared
after the baseline while insertion tracking is saturated still requires review rather than silently
losing a possible hover prerequisite.

The `/recorder-lab` flood fixture now includes the stable `role=link` **Stable next video** control,
which verifies this exact high-confidence role-locator scenario after unrelated saturation. Focused
verification passed: `verify:recorder-hover` **218/0** (including both the preserved true-insertion
review and the resolved stable-role regression), `verify:recorder` **217/0**,
`verify:recorder-ambiguity` **69/0**, `verify:mock-site` **145/0**, and
`verify:source-hygiene` **9/0**. The combined type/build run started but this environment's
30-second command-output limit ended it before a final status, so it is **INCONCLUSIVE**, not claimed
as passed. Tracker: **171 / 4 outstanding / 167 closed / 95 edges**. The validation ledger remains
**63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Nested custom-element Recorder action ownership — awkit-jce COMPLETE (2026-08-07)

Recorder click capture no longer stops at the first custom-element wrapper. `interactiveTarget` now
continues toward an explicit/native semantic action owner while retaining the nearest custom element
as a conservative fallback. This makes a click on an inner SVG of a named link/button generate from
the link/button itself, while an explicit actionable custom control still owns its action and a bare
custom control remains available when no semantic owner exists. A unique positional fallback for a
genuinely duplicate semantic **click owner** is now explicitly `needs-review`; stable container
scoping remains resolved and non-click/sensitive guarded-position behavior is unchanged.

The red browser capture selected `x-nav-icon` and emitted a medium-confidence compound CSS locator.
The new `verify:recorder-action-owner` now passes **11/11**, proving the raw SVG leaf, role/name
winner, no child selector, custom-control fallback, duplicate-owner review, flow JSON round trip, and
StepExecutor replay. Also verified: `verify:recorder` **217/217**,
`verify:recorder-ambiguity` **69/69**, `verify:locator-guard` **35/35**,
`verify:safety-policy` **17/17**, and `verify:mock-site` **145/145**. Build was started and compiled
the main bundle but exceeded the agent tool's 30-second window before a final status was returned.
Tracker: **170 / 4 outstanding / 166 closed / 95 edges**. The validation ledger remains
**63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Sensitive-action locator recovery refusal — awkit-utj COMPLETE (2026-08-07)

Sensitive `dangerousMutation` and `externalCommit` steps now remain bound to their exact recorded
locator candidates. `LocatorFactory.resolve` still permits the bounded same-candidate grace retry,
but refuses both the broad fingerprint scan and the blueprint neighborhood whenever those exact
candidates miss. Recorder flow assembly also omits `blueprintId` and page-blueprint persistence for
sensitive captured actions, so the unsafe recovery authority is absent at rest as well as enforced
at runtime.

The regression was observed before the fix: `verify:locator-guard` reported **33 passed / 2 failed**
because a sensitive recording received a blueprint, and the real-browser blueprint gate reported
**21 passed / 3 failed** after recovering and clicking a drifted target for an explicit
`externalCommit` step. After the fix: `verify:locator-guard` **35/35**,
`verify:blueprint-recovery-browser` **24/24**, `verify:blueprint-recovery` **52/52**,
`verify:safety-policy` **17/17**, `verify:recorder` **217/217**, `verify:recorder-flow` **33/33**,
`verify:runner` **89/89**, and `npm run build` passed. `typecheck:scripts` remains red only on the
same nine documented pre-existing diagnostics. `awkit-utj` is closed; tracker
**169 / 4 outstanding / 165 closed / 95 edges**. The validation ledger remains
**63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Real-browser blueprint capture + runtime recovery gate — awkit-c2z COMPLETE (2026-08-07)

Locator Blueprint recovery now has a dedicated end-to-end browser acceptance gate. The new
`/blueprint-recovery-lab` fixture places a same-name decoy early and the recorded target beyond 205
deterministic fillers. Its mutation removes every saved locator, inserts one node before the target,
and changes one of three ancestry segments. `verify:blueprint-recovery-browser` records the click
through the exact injected Recorder script, assembles the captured `PageBlueprint` through
`buildRecordedFlow`, seeds normal locator memory, proves the stale step cannot resolve without the
blueprint, then drives `LocatorFactory`'s second recovery layer to the intended target.

The browser-measured positive fingerprint is **0.866667**, directly bracketing the production 0.86
threshold; a second mutation falls below 0.86 and is refused with no click or recovery-success event.
Verified: `verify:blueprint-recovery-browser` **20/20**, `verify:mock-site` **141/141**,
`verify:blueprint-recovery` **52/52**, `verify:recorder` **217/217**, `verify:frame-chain` **31/31**,
`verify:runner` **89/89**, `verify:source-hygiene` **9/9**, verifier classification reconciled, and
`npm run build` clean. Repository-wide `typecheck:scripts` remains red on nine pre-existing errors in
other verifier files; the new verifier is not among them and executes cleanly. `awkit-c2z` is closed;
tracker **169 / 5 outstanding / 164 closed / 95 edges**. The validation ledger remains
**63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Frame-correct blueprint identity + page-variant gate — awkit-3ut COMPLETE (2026-08-07)

Blueprint recovery now uses the actual replay document identity for framed targets. Capture and
runtime share a deterministic, privacy-safe digest of the recorded outer-to-inner frame chain;
runtime resolves that chain to the real child `Frame` and computes the page key from the child URL
and title instead of the top page. The same digest is persisted as `PageBlueprint.frameKey` and
`ElementBlueprint.frameChainDigest`.

The previously unused `documentFingerprint` is now an active fail-closed page-variant gate. It
compares canonical tag/explicit-role histograms, tolerating small structural drift (such as one
inserted banner) while refusing materially different same-URL documents. The redundant top-level
`ElementBlueprint.ancestry` now reuses the hashed fingerprint ancestry, so raw structural identity
is no longer persisted there.

Real Chromium coverage proves child-frame key lookup, minor-drift framed recovery, observable local
recovery, and same-URL variant refusal. Verified: `verify:frame-chain` **31/0**,
`verify:blueprint-recovery` **52/52**, `verify:recorder` **217/0**, `verify:runner` **89/0**,
`verify:recorder-flow` **33/33**, `verify:source-hygiene` **9/0**, verifier classification reconciled,
and `npm run build` clean. `awkit-3ut` is closed; tracker
**169 / 6 outstanding / 163 closed / 95 edges**. `awkit-c2z` is now dependency-ready. The validation
ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Blueprint recovery second layer + neighborhood scan — awkit-qpv COMPLETE (2026-08-07)

Blueprint-guided locator recovery now runs only after the existing broad 200-visible-element scan
cannot identify a confident unique match. The blueprint layer searches a bounded ±24 window around
the captured `documentOrder`, scores identity with the shared `similarity()` model, restores the
standard **0.86 threshold + 0.08 runner-up margin**, and uses document order, sibling index,
same-tag index, and viewport-relative bounding region only as a capped 0.03 structural tiebreaker.
It remains fail-safe: storage/probing errors fall through, invisible candidates are ignored, and
equal lookalikes are never selected.

Real Chromium coverage in `verify:recorder` proves the broad scan wins without reading blueprint
storage, a target shifted by an inserted sibling beyond the broad scan cap is recovered from its
neighborhood, and equal neighborhood twins fail the margin. Verified: `verify:recorder` **217/0**,
`verify:runner` **89/0**, `verify:blueprint-recovery` **42/42**, `verify:source-hygiene` **9/0**, and
`npm run build` clean. `awkit-qpv` is closed; tracker **169 / 7 outstanding / 162 closed / 95 edges**.
The remaining blueprint items are `awkit-3ut`, `awkit-utj`, and `awkit-c2z` (still blocked by
`awkit-3ut`). The validation ledger is unchanged at **63 PASS / 2 NOT RUN / 1 BLOCKED**.

## Pointer-emulated drag capture — awkit-3g6 COMPLETE (2026-08-06)

The Recorder now captures pointer-emulated drag-and-drop (react-dnd / dnd-kit / SortableJS-style, which
use pointer events, not native HTML5 DnD), closing the last part of `awkit-3g6` (Parts 1 `/drag-lab` and
2 designer editor already done).

- **Bounded gesture recognizer** (`recorderInitScript.ts`): recognizes a drag ONLY on primary mouse/pen
  down on a valid source → movement past `DRAG_MOVE_THRESHOLD_PX` (10) while pressed → a credible,
  DISTINCT drop target under the release point (`elementFromPoint`, never fabricated from coordinates) →
  emits ONE `drag`. Deduplicated with the native path via `nativeDragFired`, and it suppresses the
  synthetic click the browser fires after a drag.
- **Fails closed** for: click + jitter, double-click, text selection, scroll/pan, touch, sliders/range/
  file inputs, resize handles, canvas, contenteditable, long-press, `pointercancel`/`lostpointercapture`/
  Escape/navigation/detachment, and non-primary buttons.
- **needs-review policy** (`buildRecordedFlow.ts`): an ambiguous OR positional drop target is
  `needs-review` (order-fragile) rather than silently committing to one look-alike by index. Applies to
  both the native and pointer paths.
- **Fixture**: `/drag-lab` gained a pointer-driven sortable (`pointer-sort-section`, `pointer-item-*`,
  `pointer-order`, `pointer-result`, `pointer-reset`).
- **Shadow**: supported via the light-DOM host (`elementFromPoint`). **Cross-frame**: no single-frame
  gesture forms, so it fails closed.

Verified: `verify:recorder-competitive` **50/50** (capture + every false-positive gate + shadow-host +
native/pointer dedup), `verify:recorder` **212/0** (real `StepExecutor.dragTo` pointer-sortable replay
moves the correct item; missing-target negative), `verify:mock-site` **132/132** (`page.mouse` reorder +
tiny-move-no-op + reset + second drag), `verify:flow-step-mapping` **122/0** (round-trip). The movement
threshold is mutation-tested (raising it 10 → 100000 flips the successful-drag checks to FAIL) and
bracketed by the "small movement stays a click" check. Full applicable sweep green (recorder suite,
ambiguity, hover, closed-shadow, redaction, draft, locator-guard, frame-chain, waits, blueprint-recovery,
validation, runner, source-hygiene, classification, random-generator/roundtrip) — no regressions. No
validation-ledger case changed, so the focused ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**; the
tracker stands at **169 / 8 outstanding / 161 closed**, edges **95**.


## Drag drop-target editor in the Flow Designer (awkit-3g6, 2026-08-06)

The Flow Designer can now edit a `drag` step's drop target in the GUI. `FlowNodePropertiesPanel` gained a
**Drop Target** section (new `dragTarget` `PropertySection`, shown only for `drag` nodes) bound
**exclusively** to `targetLocator`:

- Strategy / Drop-target value / Accessible Name / Match-exactly, plus a **Clear drop target** button that
  sets `targetLocator` to `undefined` and never touches the source `locator*` fields.
- The source Locator section is retitled **Drag Source** for drag nodes, with a hint distinguishing source
  from target.
- `flowNodeRegistry`'s drag `validate()` flags a missing drop target (plus an inline `role="alert"`), so an
  executable drag step cannot silently save without one.
- Reuses existing Hologram-token controls (`property-group`/`property-section`/`toolbar-button`/`inline-check`),
  so keyboard operability and focus visibility come for free; no unrelated panel redesign.

`verify:flow-step-mapping` **122/0** proves — through the REAL production mapping — that both locators survive
create → save → reload → edit → re-save, that editing/clearing the target leaves the source intact, that a
missing target is flagged, and that the section is drag-exclusive. Verified: `npm run build` clean,
`verify:validation` 125/0 and `test:random:generator` 49/0 (registry parity), `test:random:roundtrip` 27/0,
`verify:recorder-flow` 33/33 — no regressions. **Still open in `awkit-3g6`:** pointer-emulated DnD capture
(react-dnd/dnd-kit/SortableJS), kept as a separate carefully-gated increment (false-positive risk). No
validation-ledger case changed, so the focused ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**; the
tracker stands at **169 / 9 outstanding / 160 closed**, edges **95**.


## Drag follow-ups — mock-site lab + designer round-trip fix (awkit-3g6, 2026-08-06)

Two of the three `awkit-3g6` drag follow-ups landed:

- **Mock-site `/drag-lab` Feature Test Lab scenario** (`mock-site/public/drag-lab.html`): a kanban board
  with native HTML5 `draggable` cards and column drop zones; a drop moves the card and reports
  `"<card> → <column>"` in `data-testid="drag-result"`. Listeners are delegated on the stable
  `.drag-board`, so Reset never orphans them. Registered on the home index + README; `verify:mock-site`
  drives a real `page.dragAndDrop` and asserts the move + reset (**125/0**).
- **Designer round-trip data-loss fix:** the Flow Designer's `toFlowStep`/`fromFlowStep` in **both**
  `flowStepMapping.ts` and `flowProfileMapping.ts` mapped fields explicitly and dropped `targetLocator`
  — so loading a recorded `drag` step into the designer and re-saving **silently lost its drop target**.
  `targetLocator` is now carried verbatim (preserve, don't re-derive) in both directions, plus a
  `FlowDesignerNodeData.targetLocator` field. `verify:flow-step-mapping` **115/0** covers it (both
  mappings; a non-drag step gains no target).

Still open in `awkit-3g6`: an interactive designer drop-target **editor** section (a drag node can now
round-trip safely but the target is not yet GUI-editable), and pointer-emulated DnD capture
(react-dnd/dnd-kit/SortableJS). Verified: `npm run build` clean, `verify:mock-site` 125/0,
`verify:flow-step-mapping` 115/0, `test:random:roundtrip` 27/0 — no regressions. No validation-ledger
case changed, so the focused ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**; the tracker stands at
**169 / 9 outstanding / 160 closed**, edges **95**.


## Drag-and-drop capture + replay — new `drag` step type (2026-08-06)

The Recorder now captures native HTML5 drag-and-drop, and the runner replays it (`awkit-dat` closed;
enhancements → `awkit-3g6`). A new `drag` `StepType` runs end-to-end:

- **Capture** (`recorderInitScript.ts`): `dragstart`/`drop`/`dragend` listeners emit one `drag` action
  carrying the **source** locator and the **drop-target** locator (`targetLocator`). A cancelled drag
  records nothing.
- **Serialize** (`RecorderTypes.ts` `targetLocator`, `buildRecordedFlow.ts`): the drag action maps to a
  `drag` step with both `locator` (source) and `targetLocator` (target), each finalized as resolved.
- **Replay** (`StepExecutor.ts`): resolves both locators through the recovery-aware `LocatorFactory`
  and performs a native `source.dragTo(target)`. A `drag` step missing its `targetLocator` fails with a
  clear message (never a silent no-op).
- **Additive across the exhaustive catalogs** (`tsc`/parity-enforced): `StepType`, `STEP_REQUIREMENTS`,
  test-lab `NODE_CATALOG` (gated from random generation — no second-locator concept), renderer
  `flowNodeCatalog` + `flowNodeRegistry`, and `StepSafetyPolicy` (`safeMutation`).

Verified end-to-end: `verify:recorder` **210/0** (real StepExecutor replay + missing-target negative),
`verify:recorder-competitive` **35/35** (capture), `verify:recorder-flow` **33/33** (mapping +
round-trip), `verify:validation` 125/0, `test:random:generator` 49/0 (catalog↔registry parity),
`test:random:roundtrip` 27/0, `verify:runner` 89/0, plus the recorder sweep (ambiguity 69, hover 214,
closed-shadow 23, redaction 15, draft 50, locator-guard 33) and `npm run build` clean — no regressions.
Follow-ups in `awkit-3g6`: designer drop-target editor, a mock-site sortable scenario, and
pointer-emulated DnD (react-dnd/dnd-kit/SortableJS). No validation-ledger case changed, so the focused
ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**; the tracker now stands at
**169 / 9 outstanding / 160 closed**, edges **95**.


## Recorder competitive deep-testing + two fixes (2026-08-06)

Deep-tested the Recorder against adversarial/competitive scenarios. New real-browser gate
`verify:recorder-competitive` (**32/32**) drives the real capture script and proves generated/
framework identifiers and CSS-in-JS/hashed classes are never emitted as locators, custom ARIA
combobox/listbox options capture with semantic `role=option` locators, capture survives SPA
client-side navigation (`pushState` + full DOM replacement), and native `<select>`/keyboard capture
safely. Three real defects were found **and fixed** in `recorderInitScript.ts`:

- **Blueprint capture leaked closed-shadow internals + full URLs (regression from `6591c08`).**
  `captureBlueprint` stored the raw `location.href` and the raw element fingerprint on the recorded
  draft, so `verify:recorder`'s "shadow closed: persisted data exposes no internal node/name" gate went
  red (205/1) and every draft persisted full URLs (query/fragment/tokens). Fix: skip blueprint capture
  for shadow-scoped targets (it cannot resolve them at runtime anyway) and mask the URL to
  origin+pathname. `verify:recorder` is back to **206/0**.
- **CSS-module hashed id/class were used as locators.** `#Header_root__2x9Yt` and
  `button.Button_primary__3xKz9` (Next.js/CRA/Vite CSS-Modules default) were emitted verbatim — brittle
  across builds. Fix: `looksGeneratedId` and `isMeaningfulClass` now reject a `__`-delimited suffix that
  contains a digit, while pure-word BEM (`card__title`) survives.
- **Contenteditable / rich-text typed text was not captured — only the click (`awkit-fbq`, now
  closed).** The `input` handler ignored non-form editing hosts. Fix: it now captures a
  contenteditable host's text as a redaction-aware fill (`element.innerText`); `verify:recorder-competitive`
  scenario E asserts fill + text.

Regression sweep after the fixes is clean: `verify:recorder` 206/0, `verify:recorder-competitive`
32/32, `verify:recorder-ambiguity` 69/0, `verify:recorder-hover` 214/0, `verify:closed-shadow` 23/0,
`verify:frame-chain` 25/0, `verify:locator-guard` 33/0, `verify:recorder-flow` 29/29,
`verify:recorder-draft` 50/50, `verify:recorder-redaction` 15/0, `verify:blueprint-recovery` 42/42,
`npm run build` clean. One open follow-up filed: `awkit-dat` (HTML5 drag-and-drop interactions record
no action). No validation-ledger case changed, so the focused ledger remains
**63 PASS / 2 NOT RUN / 1 BLOCKED**; the tracker now stands at **168 / 9 outstanding / 159 closed**,
edges **95**.


## Blueprint Recovery — Phase 4 wiring landed (2026-08-05)

The Element Blueprint recovery system is wired into `LocatorFactory.recoverLocally` as an
additive, fail-safe second signal — it always falls through to the existing scan on any miss.
- `PlaywrightRunner` provides a `locatorBlueprintRoot` and instantiates `FileLocatorBlueprintStore`.
- `LocatorFactory` performs a fast-path check using `pageKey` + `blueprintId` (stricter 0.90
  fingerprint threshold) before the full 200-element scan; on any miss it falls through unchanged.
- Blueprints are stored under `%LOCALAPPDATA%\SpecterStudio\<runtime-root>\locator-blueprints\`.
- Covered by `verify:blueprint-recovery` (capture/assembly/page-key/store); `verify:runner` and
  `verify:recorder-flow` still green (no regression).
- **Open follow-ups (plan gaps):** blueprint runs as a *first* fast-path rather than the second
  layer the plan specified; a single exact `.nth(documentOrder)` jump (no neighborhood scan) so a
  node inserted before the target shifts the index and the jump misses; the 0.08 runner-up margin
  is dropped; no explicit sensitive-action refusal in the blueprint path; the `documentFingerprint`
  page-variant gate is captured but not checked; frame keying is a placeholder (capture uses the
  frame URL/title, runtime uses the top-page URL/title, so framed targets never match).

No validation-ledger case changed, so the focused ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.
Beads filed for the open runtime gaps — `awkit-qpv` (second-layer ordering + neighborhood scan),
`awkit-utj` (sensitive-action refusal), `awkit-3ut` (frame page-key + variant gate), `awkit-c2z`
(real-browser verifier; blocked by qpv + 3ut) — so the tracker now stands at **166 / 8 outstanding /
158 closed**, edges **95**.


## Instrumented closed-shadow resolver — epic `awkit-65g` COMPLETE (2026-08-04)

The unified guaranteed-unique-locator epic is **fully delivered and pushed**. C2 replays an interaction
whose target lives inside a **closed** shadow root (which Playwright's built-in engines cannot pierce).

- **Capture** (`recorderInitScript`): the `attachShadow` wrap installs the recorder's capture handlers
  INSIDE each closed root (a closed root retargets composedPath for outside listeners, so window only sees
  the retargeted host); the handler skips any target that is itself a closed host, so only the innermost
  listener records the true target. `captureClosedShadowChain` builds a CSS host chain + target and marks
  the locator `instrumented`/`resolved`, persisting **no internal accessible name/text** (privacy).
- **Runtime** (`src/runner/closedShadowBridge.ts`): an `addInitScript` wraps `attachShadow` (mode preserved)
  and retains closed roots in a **closure WeakMap** behind a per-process **token-gated resolver**; a
  Playwright **custom selector engine** walks the host chain (`host.shadowRoot` for open, the resolver for
  closed) and returns the target as a normal auto-waiting Locator — so `LocatorFactory.resolveClosedShadow`
  needs no StepExecutor changes. `PlaywrightRunner` installs the bridge once per run context before the
  first page. Security review: `docs/ai/security-reviews/2026-08-04-closed-shadow-c2.md`.

**Epic status:** Phases 0/A/B (guaranteed-unique + guarded-positional), C1 (cross-origin frame-chain), and
C2 (instrumented closed-shadow) are all on `origin/main`. `awkit-871` is superseded — the recorder now
auto-resolves every ambiguous/positional/frame/closed-shadow case, so no non-positional needs-review reaches
the Flow Designer. Three follow-up items (diff-level security review, extending guarded-positional to
non-click actions via a `labelContent` precondition, and a CDP fallback for pre-instrumentation closed roots)
were then implemented, **reviewed and hardened** (gate the CDP fallback behind a grace period + cap, make the
resolver write-path additive-only, escape the label selector), and a strict `fingerprintsEqual` identity check
replaced the fuzzy score that false-aborted bare inputs. Verified by the feature gates (`verify:locator-guard`
33/0 incl. a mutation-tested guarded-FILL case, `verify:closed-shadow` 23/0, `verify:recorder` 206/0,
`verify:runner` 89/0, no regressions). Committed and pushed to `origin/main` (`5996ed5`).

**Verified.** build PASS; new `verify:closed-shadow` **23/0** — MUTATION-TESTED the token gate. No
regressions: `verify:recorder` 206/0, `verify:runner` 89/0, `verify:recorder-ambiguity` 69/0,
`verify:locator-guard` 25/0, `verify:frame-chain` 25/0, `verify:mock-site` 114/114, `verify:legacy-compat`
152/0, `verify:flow-step-mapping` 111/0, `test:random:roundtrip` 27/0, `verify:source-hygiene` 9/0.

No validation-ledger case changed — focused ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**. Beads records
**162 issues / 4 outstanding / 158 closed / 93 edges** (`awkit-3zf`/`awkit-871`/`awkit-65g` closed; the 4
outstanding are owner-gated). Remaining external gates (packaged-EXE / clean-machine / live-Oracle) unchanged.

---

## Cross-origin frame-chain resolver — epic `awkit-65g` Phase C1 (2026-08-04)

A target inside one or more iframes (cross-origin and nested) is now captured and replayed
automatically. **Capture** walks the target Frame up Playwright's Frame graph (`frameElement()` is
cross-origin safe; the child document is never scripted) and persists the ordered
`LocatorContext.frameChain` with a resilient per-segment selector + parent-side identity (name/title/src).
**Runtime** (`LocatorFactory.resolveFrameChain`) resolves each boundary in its parent frame, verifies the
iframe element's identity, and descends — aborting with **`FRAME_IDENTITY_CHANGED`** (never entering a
sibling frame) if a segment is missing, ambiguous, or its identity changed. A legacy single `frame` keeps
the `frameLocator` path. The capture (`src/recorder/frameChainCapture.ts`) is shared by the RecorderService
binding and the verifier; its in-page evaluate has **no named inner functions** (esbuild `__name` gotcha).

Mock site: `/iframe-nested` (main → `#frame-outer` → `#frame-inner` → leaf) for the Feature Test Lab; the
cross-origin / duplicate / navigate / identity-change cases are the self-contained `verify:frame-chain`
(two mutually cross-origin `127.0.0.1` ports).

**Verified.** build PASS; new `verify:frame-chain` **25/0** — MUTATION-TESTED the frame identity check
(disabling it fails only the identity-refusal assertions). No regressions: `verify:recorder` 206/0,
`verify:recorder-ambiguity` 69/0, `verify:runner` 89/0, `verify:locator-guard` 25/0, `verify:mock-site`
114/114, `verify:flow-step-mapping` 111/0, `verify:source-hygiene` 9/0, classification reconciled.

Committed + pushed: `8fc9d32`. Remaining epic child: **`awkit-3zf` (C2 instrumented closed-shadow)**, OPEN.
No validation-ledger case changed — focused ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**. Beads
records **162 issues / 7 outstanding / 155 closed / 93 edges** (`awkit-y1p` closed).

---

## Recorder guarantees unique resolved locators — epic `awkit-65g` Phases 0/A/B (2026-08-04)

The Recorder now **builds nested selectors until the locator is unique and adopts a positional last-resort
as `resolved`**. It no longer pauses for an ambiguity dialog and no longer asks for positional-fallback
approval on ordinary steps — the owner directive ("no un-unique fixes or alternatives"). Delivered in three
committed phases; C1/C2 (the two platform-limit cases) remain.

- **Phase 0** (`813f46e`) — additive schema (`LocatorGuard`, `SemanticPrecondition`, relocated
  `LocatorElementFingerprint`, `LocatorContext.frameChain`, closed-shadow `instrumented`/`target`,
  `StepLocator.guard`) + a shared `src/runner/locatorFingerprint.ts` so the runner and recorder compute an
  identical fingerprint. Round-tripped through both mapping files. Behavior-preserving.
- **Phase A** (`fae1af9`) — ordinary positional locators auto-resolve and run with no review/alternatives/
  approval. `FlowValidator` + `StepExecutor.guardLocatorQuality` relaxed accordingly; the interactive
  ambiguity dialog is now vestigial for the uniqueness case.
- **Phase B** (`ecb72d2`) — a SENSITIVE step (`dangerousMutation`/`externalCommit`) whose only unique locator
  is positional auto-resolves **with a runtime identity guard**: `LocatorFactory.resolveGuardedPositional`
  re-proves the recorded target (candidate count + hashed fingerprint + preconditions) before acting and
  aborts with **`SENSITIVE_TARGET_IDENTITY_CHANGED`** on any change — never a sibling fallback. The
  wrong-privileged-action safety property is preserved without an approval prompt. Single finalizer is
  `buildRecordedFlow` (used by the live session and the harness alike).

**`awkit-871` is largely superseded**: the ambiguous/positional needs-review it was partly about no longer
reaches the Flow Designer. The only remaining non-positional needs-review cases are **closed shadow root**
and **cross-origin frame**, addressed by the two remaining epic children — **`awkit-y1p` (C1 cross-origin
frame-chain)** and **`awkit-3zf` (C2 instrumented closed-shadow)**, both OPEN and not started.

**Verified.** build PASS; new `verify:locator-guard` **25/0** (unchanged replay = fingerprint parity;
insertion/removal/identity-change → abort clicking nothing), **mutation-tested** both guards (fingerprint
check → only [8] fails; siblingCount check → only [7] fails); `verify:recorder` **206/0**;
`verify:recorder-ambiguity` **69/0**; `verify:runner` **89/0**; `verify:recorder-hover` **214/0**;
`verify:recorder-draft` **50/50**; `verify:recorder-flow` **29/29**; `verify:protected-login-recorder`
**57/57**; `verify:recorder-redaction` **15/0**; `verify:flow-step-mapping` **111/0**;
`test:random:roundtrip` **27/0**; `verify:legacy-compat` **152/0**; `verify:mock-site` **114/114**. The
packaged-EXE / clean-machine / live-Oracle gates were not run (owner/environment-gated; not required here).

No validation-ledger case changed, so the focused ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**. Beads
records **162 issues / 8 outstanding / 154 closed / 93 edges** (epic `awkit-65g` + `awkit-y1p`/`awkit-3zf`
filed).

---

## Recorder review residuals closed: popup identity, ordering, chain coverage (2026-08-04)

Three follow-ups from the `awkit-wmq` review. Writing **one** failing test for the first uncovered
two further defects that no existing gate could see.

**`awkit-45d` — identity locked to a client-side redirect.** `popupIdentityUrl` resolved on the
first meaningful commit. A server `302` never commits a document, so Scenario J2 and Part P both
passed — but `location.replace` / meta refresh **do** commit, so the alias,
`popupExpectation.urlContains` and the captured URL all took the intermediate hop. It now accepts the
**last** URL that stands unchallenged for a 250 ms quiet period, inside the existing 2 s budget.

That change then exposed two more:

- **Opener attribution could be stolen.** It read "the opener's latest click" *after* the identity
  wait, so a click made while registration was in flight won instead. Playwright fires the popup
  event during the click's default action, and the capture binding is an async round trip, so it can
  commit either side of the popup events **in either order** — neither direction alone is reliable.
  A slot is now reserved per popup and indexed under the opener as soon as the opener is known (not
  necessarily the first event: `context.on("page")` fires before `page.on("popup")`), filled by
  whichever click qualifies, and consumed on first claim. Which **page** opened the popup stays
  causal; which **click** on it is time-bounded, now explicitly and narrowly.
- **Recorded actions could be reordered.** Each binding awaited only its *own* page's registration,
  so an action on an unblocked page overtook a popup action still waiting. All actions now pass
  through one ordered pipeline — what the design called for.

**`awkit-tir`** — the `setTimeout(0)` ordering yield is gone (correctness now comes from the
reservation, not a delay), and Part Q asserts the two container-chain caps agree. The capture script
is stringified for the browser so it cannot import the shared constant; the cap exists as two
literals that can silently drift.

**`awkit-y53`** — the three missing combined-context cases: a chain inside a same-origin iframe with
an outer decoy and a frame-dropping negative; an open shadow host chain plus nested containers, where
naming the *other* host selects that host's element; and a DOM-reordered replay proving the chain is
semantic, not position-dependent. Note Playwright **pierces open shadow roots**, so omitting the host
chain does not stop resolution — that assumption was corrected rather than asserted. Fixing these
also closed a real hygiene gap: `run()` never reset `window.__hit`, and `setContent` keeps the same
window, so a step that never fired its handler read the previous case's value.

**Verified.** build PASS; `verify:recorder` **206/0**; `verify:recorder-ambiguity` **68/0**;
`verify:runner` **89/0**; `verify:recorder-hover` **214/0**; `verify:popup` **12/12**;
`verify:popup-identity` **44/44**; `verify:popup-mock-site` **15/15**;
`verify:protected-login-recorder` **57/57**; `verify:recorder-redaction` **15/0**;
`verify:recorder-draft` **50/50**; `verify:recorder-flow` **29/29**; `verify:flow-step-mapping`
**111/0**; `test:random:roundtrip` **27/0**; `verify:source-hygiene` **9/0**. Mutation-tested:
quiet period 0 restores first-commit-wins; drifting a chain cap fails the guard; folding only the
first container segment fails 10 checks including all three new combined-context cases.

**Known limitation found while answering a usage question (`awkit-871`, P1, OPEN).** A step whose
locator is `needs-review` blocks execution at preflight, but the Flow Designer can only clear that
state for **positional** locators — the approval form is gated behind `isPositionalLocator(...)`
(`FlowNodePropertiesPanel.tsx:662`). A step that is `needs-review` for any other reason (ambiguous
role+name, closed shadow root, cross-origin frame) has **no resolve affordance**: the ranked
alternatives are shown read-only with no way to adopt one. Editing the locator by hand is a trap —
`editLocator` clears `locatorQuality`, so the "matches N elements" warning disappears and the step
looks fixed, but `resolution` is untouched, so preflight still blocks. Until this is fixed, the only
path for such a step is to re-record it and resolve it in the Recorder ambiguity dialog.

No validation-ledger case changed, so the focused ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.
Beads records **159 issues / 5 outstanding / 154 closed / 93 edges**. `awkit-871` is the only OPEN
item; the other four are `blocked` on the owner (real-IdP handoff, live Oracle, packaged/clean-machine
gates, OS-shell launches) with no engineering remaining.

---

## Mock-site Scenario J: popup URL lifecycle (`awkit-f2q`, 2026-08-04)

The four popup URL-lifecycle cases that `awkit-wmq` left as verifier-local fixtures are now real
Feature Test Lab pages at `/popup/url-lifecycle.html`, reusable for manual exploration and by any
future verifier. Each case exists because the popup's URL **at creation** is not the URL that
identifies it:

- **J1** `open-blank-then-navigate` — `window.open("")` then assigns `location` 120 ms later, so the
  page genuinely exists at `about:blank` first.
- **J2** `open-redirecting-popup` — `/popup/redirect-entry.html` answers a fixed `302` to
  `/popup/redirect-final.html`. The destination is a constant, so it can never become an open
  redirect. The route **must stay ahead of the `/popup` static catch-all**, which maps any
  `/popup/*` path straight to a file and would otherwise 404 it — that ordering is the whole reason
  the first attempt failed.
- **J3** `open-history-popup` — `pushState`, hash change and `back` inside the popup, none of which
  may touch the opener's URL.
- **J4** `open-same-title-pair` — two pages sharing the exact title `Shared report title`, differing
  only by path.

The fixed redirect is mirrored in `verify:popup-mock-site`'s embedded server so both servers behave
identically. The four new tests (14–17) reset popups **on entry**: a throwing test previously never
reached its own `resetPopups()`, leaking popups into every later test — the first mutation run failed
4 tests instead of the 2 it should have, which is what exposed it.

**Verified.** build PASS; `verify:popup-mock-site` **15/15**; `verify:mock-site` **114/114**;
`verify:popup` **12/12**; `verify:popup-identity` **44/44**; `verify:recorder` **193/0**;
`verify:recorder-ambiguity` **68/0**; `verify:protected-login-recorder` **57/57**;
`verify:source-hygiene` **9/0**. Mutation-tested: opening J1 directly at its URL and repointing the
J2 redirect fail exactly tests 14 and 15, with no cascade.

No validation-ledger case changed, so the focused ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.
Beads records **155 issues / 4 outstanding / 151 closed / 93 edges**; all four outstanding items are
`blocked`.

---

## Recorder: nested container chains + causal popup capture (`awkit-wmq`, 2026-08-04)

Two Recorder correctness defects are fixed. Both changes are **additive and backward compatible** —
no saved flow changes meaning, and absent fields keep their legacy interpretation.

**Nested container scoping.** `LocatorContext.container` was singular, so a target needing two
ancestors to become unique had no representation. `LocatorContext.containers?: LocatorContainerContext[]`
(outer→inner, **max 3**, `MAX_LOCATOR_CONTAINER_CHAIN`) now carries the chain, with
`locatorContainerChain()` as the single interpretation rule (`containers` wins; else `container` is
read as a one-segment chain). `LocatorFactory.buildRoot` folds each segment strictly and reports
which segment index failed. Capture walks bounded ancestors (depth 16), validates every chain
outer→inner against the concrete clicked node, and is capped at **240 chain evaluations** per capture
so a deeply nested page cannot stall the click handler; exhausting the budget adopts no chain and
falls through to the existing review-required path. `form` and `section` joined the container types.
Preference order is unchanged: direct unique locator → one container → nested chain.

**Popup / new-tab capture.** Five located defects fixed in `RecorderService`: (1) `addInitScript`
only instrumented *future* documents, so an already-navigated popup's current document was never
instrumented — registration now verifies the `__awtkitCaptureInstalled` marker and re-applies
idempotently, and the action binding awaits the registration so an action can never be mis-tagged
`main`; (2) the popup URL was read once synchronously, so a `window.open()` popup stayed `about:blank`
and `popupExpectation.urlContains` was never populated — a bounded first-meaningful-navigation wait
now yields the identity URL and back-fills the opener; (3) opener attribution used a 3 s wall clock
instead of `page.on("popup")` — the causal opener is now primary; (4) a `pageAlias === "main"` guard
suppressed switch steps for main→popup and popup→popup — switch steps are now inserted lazily at the
first action on a new page in **both** directions, which is what makes them idempotent against the
several events announcing one transition; (5) `sourcePage.url()` was written raw into the step name
and `valueSource` — all persisted URLs are now origin+pathname only, structurally dropping query and
fragment. Aliases derive from `derivePopupAlias` (the existing runner registry — no second registry),
falling back to arrival order only when identity collides or is unavailable.

**Mock site.** New `/recorder-lab` `nested-container-scope` scenario: two regions × two repeated
order cards × one `Approve` button each. Neither ancestor disambiguates alone, so a single container
provably cannot satisfy it.

**Verified.** build PASS; `verify:recorder` **193/0**; `verify:recorder-ambiguity` **68/0**;
`verify:mock-site` **114/114**; `verify:runner` **89/0**; `verify:recorder-hover` **214/0**;
`verify:recorder-flow` **29/29**; `verify:recorder-draft` **50/50**; `verify:flow-step-mapping`
**111/0**; `test:random:roundtrip` **27/0**; `verify:legacy-compat` **152/0**; `verify:popup` **12/12**;
`verify:popup-identity` **44/44**; `verify:popup-mock-site` **11/11**; `verify:recorder-redaction`
**15/0**; `verify:protected-login-recorder` **57/57**; `verify:source-hygiene` **9/0**;
`verify:verifier-classification` reconciled. Mutation-tested: reverting the chain fold, the alias
fallback, the switch-step insertion, and all container scoping each fails the suite.

No validation-ledger case changed, so the focused ledger remains **63 PASS / 2 NOT RUN / 1 BLOCKED**.
Beads records **155 issues / 5 outstanding / 150 closed / 93 edges** (`awkit-wmq` filed and closed;
`awkit-f2q` filed for the outstanding mock-site popup fixtures).

**Not done.** The remaining plan-listed mock-site popup fixtures (`about:blank`-then-navigate,
redirect-before-interaction, popup `pushState`/hash, same-title tabs) are covered by verifier-local
fixtures and a local HTTP server inside `verify:recorder` Part P, not by mock-site pages. Tracked
separately — see `awkit-wmq` follow-up.

---

## SET-015 real runtime-folder launch passed; `awkit-hlp` closed (2026-08-04)

The Settings E2E gate now has an explicit, fail-closed OS-shell opt-in:
`AWKIT_ALLOW_OS_SHELL_LAUNCH=1`. Without it, normal verifier runs remain non-launching. With owner
approval, the verifier creates a unique isolated runtime root, proves that path is not already open,
clicks the actual rendered **Open Runtime Folder** button, and resolves Windows Explorer's live
`LocationURL` back to a filesystem path. The gate passes only when an Explorer window appears at
the exact configured runtime root; cleanup closes only that test-created exact-path window and is
also asserted.

The final owner-approved run passed **154 PASS / 0 FAIL**. An initial run passed the substantive
launch check but exposed a PowerShell statement-separator defect in the verifier's cleanup helper;
that helper was corrected, the leftover exact-path window was closed and verified absent, and the
full gate then passed cleanly. SET-015 moves to `PASS`, so Settings is now **21 PASS / 0 NOT RUN**
and the focused validation ledger is **63 PASS / 2 NOT RUN / 1 BLOCKED**. `awkit-hlp` is closed;
Beads records **153 issues / 4 outstanding / 149 closed / 93 edges**.

---

## `awkit-9yc` repaired: explicit current-user NSIS silent mode (2026-08-04)

The installed-layout drivers no longer invoke the assisted NSIS installer with ambiguous bare `/S`.
Both now use the canonical `/currentuser /S` sequence from
`scripts/lib/nsis-per-user-install.ps1`, preserving unelevated per-user installation while selecting
the install mode before silent execution. The helper also normalizes signed/unsigned process results
and treats success as exit zero **plus** an installed executable; `0xC0000005` is reported explicitly
as the observed NSIS `System.dll` access-violation regression.

Clean-VM A/B proof used the same restored Windows 11 snapshot and the same guest-hash-verified
`SpecterStudio Setup 0.1.5.exe` bytes (SHA-256
`9CE2860E3AF33BC29E606008DCD2C551F61E5B721C1551BB8A00B5E39080E2EA`). Bare `/S` reproduced
`0xC0000005`, created no installation, and emitted a fresh `System.dll` Application Error.
`/currentuser /S` exited zero, installed 576 files under the standard user's LocalAppData, created
the HKCU uninstall entry, launched ProductVersion `0.1.5.0` as `awkituser`, produced no UAC consent
process, and emitted no `System.dll` crash event. The VM was restored and powered off afterward.

`npm run verify:nsis-per-user-install` provides the exact `0xC0000005` synthetic negative control
and source guards for both drivers. The verifier passes **12/12**; script typecheck passes; all
**166** verifier commands reconcile. `awkit-9yc` is closed; Beads now records **153 issues / 5
outstanding / 148 closed / 93 edges**. The comprehensive validation ledger remains **62 PASS / 3
NOT RUN / 1 BLOCKED**.

---

## `awkit-k2s` closed after fresh NSIS installed-artifact acceptance (2026-08-03)

A fresh internally signed NSIS artifact was built from clean `main` at `8f0275b`:
`dist/SpecterStudio Setup 0.1.5.exe`, **244,286,446 bytes**, SHA-256
`9CE2860E3AF33BC29E606008DCD2C551F61E5B721C1551BB8A00B5E39080E2EA`. The first full packaging
attempt reached electron-builder but produced no installer; rerunning the exact failed
`electron-builder --win nsis` step completed, and the canonical provenance writer recorded the
artifact. Windows Authenticode remains unconfigured/NotSigned; the offline dependency manifest is
Ed25519-signed and strict validation passes.

The dedicated `AWKIT-CleanMachine` Hyper-V guest was restored from `staged-artifacts-preseed`, kept
offline, and verified the installer hash before use. The assisted per-user installer completed with
no UAC consent process, installed 576 files, and launched installed ProductVersion `0.1.5.0`. After
first-run Super User setup, Flow Library visibly rendered **New Flow** and **Re-scan Library** side by
side. Invoking **Re-scan Library** increased
`validation/inventory-scans/*.json` from **0 to 1**, and the UI reported `library re-scanned`.
`awkit-k2s` is closed. Ignored screenshots are retained under `dist/awkit-k2s-evidence/`; the guest
was restored to the staged checkpoint and powered off afterward.

A separate defect was discovered during this acceptance: bare `/S` crashed in the NSIS temporary
`System.dll`. It was subsequently repaired under `awkit-9yc` with explicit `/currentuser /S`; the
assisted installed-artifact acceptance that `awkit-k2s` required remains valid.

Verified: `npm run build` passed; `npm run verify:flow-library` **19/19** (one transient Electron
attach failure, clean retry passed); `npm run verify:release-key-custody` **58/58**; strict offline
validation passed with Zvec **17/17**; `npm run verify:packaged-runtime` **25/25**. The comprehensive
offline supply-chain verifier passed **22/22**; source hygiene **9/9**; verifier classification
reconciled all **165** commands; roadmap dashboard **156/156** with **153 issues / 7 outstanding /
146 closed / 93 edges** and Sources agree; AI-memory checks passed. The comprehensive validation
ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Release-signing key rotated; `awkit-a6a` + `awkit-2l1` closed (2026-08-03)

The prior offline-manifest release-signing private key was confirmed absent from both custody
locations with no recoverable backup (`awkit-a6a`). Owner decision: generate a fresh key rather than
continue searching. A new Ed25519 keypair was generated directly at the approved custody path
(`%LOCALAPPDATA%\SpecterStudio\release-keys\offline-manifest-private.pem`) — never at any point in
the OneDrive-synced repo tree, which also resolves `awkit-2l1` (there is nothing left to move; the
new key never existed in the synced location).

The public half was rotated in `resources/trust/offline-manifest-public.pem` — the exact path
`src/offline/SupplyChainIntegrity.ts` reads at runtime to verify the bundled manifest — and
`resources/dependency-manifest.json` was re-signed and verified against it (new key id
`ed25519:aa5b9dd8...`). `npm run verify:release-key-custody` 58/58; `npm run validate:offline` clean.
Commits `c4491ca` (rotation) plus the bead closures.

**This unblocks `awkit-k2s`'s remaining installed-artifact gate** — a signed NSIS build is now
possible again. Not yet attempted; see the `awkit-k2s` entry below for what full closure still
requires (fresh signed artifact, clean-machine install, Super User confirmation of both actions).
The comprehensive validation ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Run Detail drawer now shows Legacy Compatibility attribution (`awkit-5dn`, 2026-08-03)

Follow-up to `awkit-vbj`, which added `legacyCompatibility` to the persisted JSON execution report
but deliberately did not touch the durable SQLite store — `RunDetailDrawer.tsx` reads
`window.playwrightFlowStudio.telemetry.runDetail`, served by `ExecutionEngine.getTelemetryRunDetail`
from that store, not from the report file, so an operator reading the drawer still could not tell a
run was admitted under a grant.

**Migration v5** (`legacy-compatibility-attribution`, additive-only, `RuntimeStoreSchema.ts`) adds
`runtime_runs.legacyCompatibilityJson` — a JSON-encoded snapshot of
`ConcurrentRunProfile["legacyCompatibility"]`, written once at dispatch by `ExecutionEngine`
(`runInstanceInner`, reading `this.runContexts.get(instance.executionId)?.profile.legacyCompatibility`,
the same run context `startRun` already populates) and never re-derived later — grants expire and get
revoked, so a live join against the current grants table would misreport historical runs. `RunDetail`
already exposes the raw `DurableRunRecord`, so no IPC contract change was needed; `RunDetailDrawer.tsx`
parses the JSON and renders it with the same `.state-pill.pill-legacy` marker Flow Library already
uses for grant-tolerated flows.

Verified: `npm run build` clean; `npm run verify:telemetry` **66/66** (extended with the v5 migration
assertion, a pre-v5 row reading the new column as `undefined`, and a full round-trip proving the
snapshot survives a close/reopen and is not wiped by a later upsert that omits it — mutation-tested by
nulling the SQL bind and confirming the round-trip check fails, then reverted); `npm run
verify:run-report-compatibility` **27/27** (extended with source guards proving the engine reads the
same snapshot the report uses and writes it to the durable store, mutation-tested by changing the
conditional-spread shape and confirming the guard fails, then reverted); `npm run verify:runner`
**89/89** (unaffected — confirms the `ExecutionEngine.ts` dispatch-path edit didn't regress runner
behavior); `verify:verifier-classification` 165 verifiers reconciled (no new script, no change);
`verify:roadmap-dashboard` 156/156. Comprehensive validation ledger unchanged at **62 PASS / 3 NOT
RUN / 1 BLOCKED**.

---

## `awkit-k2s` defensive hardening implemented + verified; installed-artifact acceptance still BLOCKED (2026-08-03)

Two distinct, separate facts — do not collapse them:

**1. Source-level hardening is implemented and verified.** `FlowLibrary.tsx` now separates
`rescanCapable` (does this build's preload expose `runInventoryScan` at all) from `canRescan`
(does this user hold `WORKFLOW_EDIT`), and a new `rescanTitle()` picks one truthful reason at a
fixed priority — capability > permission > in-progress > prior failure > success — so the action is
never disabled without an explanation. Operational failures now set a `rescanError` surfaced both
in the action's title and the page status line, and the action stays rendered and re-enabled
(`finally { setRescanning(false) }`), never removed. `TopHeader.tsx` gained
`data-testid="page-action-${id}"` for deterministic selection. New verifier
`npm run verify:flow-library` (`scripts/verify-flow-library-gui.mts`, real-browser, **19/19**,
confirmed deterministic across repeated runs and mutation-tested: swapping the `rescanTitle`
priority order, stripping the catch block's own-message wiring, and injecting an `actions.filter()`
into `TopHeader` each independently made the corresponding assertion fail, then were reverted)
proves: the action always renders for both an allowed Super User and a denied Viewer
(`WORKFLOW_VIEW`, not `WORKFLOW_EDIT`); a denied Viewer sees it disabled with the permission reason
while a direct IPC probe proves **main**, not just the renderer, refuses the channel
(`SecurityError: NOT_AUTHORIZED`); and static guards confirm no layer in
`FlowLibrary -> pageChrome -> App -> AppShell -> TopHeader` filters the `actions` array (all four are
unconditional pass-throughs — this is also the diagnostic finding that permission alone cannot
explain "absent" under current source). The capability-unavailable branch is proven at the unit
level (`rescanTitle` imported directly) rather than by live bridge tampering: Electron's
`contextBridge` deep-freezes the exposed API graph by design, so a page script cannot rewrite its
own bridge surface even to test with — confirmed by two failed attempts (`delete` and reassignment
both silently no-op). `npm run build` passes; `verify:verifier-classification` reconciles
**165** registered verifiers; `verify:source-hygiene` passes 9/9. The comprehensive validation
ledger is unchanged at **62 PASS / 3 NOT RUN / 1 BLOCKED**.

**2. Installed-artifact acceptance remains pending — report as BLOCKED, not PASS.** The original
clean-machine observation (NSIS-installed build missing "Re-scan Library" while portable showed it)
is **not disproven** by this source-level work; source inspection cannot substitute for NSIS
evidence. Producing a fresh signed NSIS artifact is blocked: the release-signing key is currently
absent from both the approved and legacy custody locations — tracked separately as `awkit-a6a`
(release-custody incident, P1, OPEN), which is NOT a task this session or any agent should "fix" as
part of `awkit-k2s`. No `AWKIT_ALLOW_SYNCED_SIGNING_KEY` bypass, temporary key, or replacement
signing was used or will be. `awkit-k2s` stays **open/in-progress**; NSIS build, installed-artifact
install, and clean-machine validation are **NOT RUN** pending `awkit-a6a` resolution — never PASS.

---

## Flow Designer's Node Properties drawer insets the canvas — corrected from `awkit-9p6` (`awkit-73s`, 2026-08-03)

**Supersedes the "floating-overlay" claim recorded under `awkit-9p6` below** (measured
"~1.8px right overhang", "flow engine keeps the full canvas width"). That was never the settled
state; it was a stale read of the layout mid-transition. Confirmed by owner decision + a live
measurement: the drawer **insets** the canvas — `.react-flow-shell`'s usable width shrinks via
`padding-right` on `.flow-designer-body`, the workflow area shifts left, and the engine's right
edge sits flush against the drawer's left edge (`canvasEngineRight == panelLeft`, measured exactly
equal at three viewports) rather than running underneath it. This is the required behavior: the
drawer must reduce usable canvas width, not cover nodes or connections.

Root cause of the stale reading: `scripts/verify-flow-designer-gui.mjs` sampled geometry after a
**fixed delay** (360ms / 180ms) following the open/resize. Two independent async mechanisms move
this layout — the `.flow-designer-body` `padding-right` + `.designer-right-drawer-slot` `width` CSS
transitions (declared 240ms, but measured only ~87% complete at 500ms) and the action bar's
`ResizeObserver`-driven `--awkit-action-bar-h` (not a CSS animation, invisible to
`getAnimations()`). A fixed wait could read either a mid-transition frame (looking like "overlay")
or the settled frame (inset), which is why the compact-viewport check was reported flaky rather
than a clean fail. All three overlay-shaped assertions in `verify:flow-designer` (default open, the 1936×1290 wide
viewport, and the compact 1024×768 viewport) now wait for `Animation.finished` on the drawer
subtree, then poll geometry to a stable read, and assert the inset invariant instead. Confirmed the
new checks actually catch the regression they exist for: injecting `padding-right: 0 !important` to
simulate a return to overlay makes all three fail as designed; removing the injection restores
**72/72**, stable across four consecutive runs. The comprehensive validation ledger is unchanged at
**62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Portable releases now enforce a fresh first-run database (`2026-08-03`)

The roadmap's **Generate next portable EXE** action still packages the latest clean `main` commit as
the next patch version, but the canonical portable pipeline now runs
`verify:portable-fresh-state` after the production build and before manifest generation/signing.
The gate fails if any `.sqlite`, `.sqlite3`, `.db`, or related journal file appears in an app or
`extraResources` input tree. It also checks the builder's explicit allowlist, the writable
`%LOCALAPPDATA%/SpecterStudio` routing, and a real temporary security SQLite store.

The real-store proof starts with zero users and `provisioned=false`, creates exactly one protected
Super User through the normal bootstrap service, then proves a second bootstrap is refused. Therefore
the generated EXE contains no predefined account or application database: first launch creates a new
local database and shows owner-driven Super User setup. `verify:portable-fresh-state` passes **10/10**;
all application/script typechecks pass; verifier classification reconciles **164** registered commands
across **163** verifier files; roadmap dashboard passes **156/156**; authentication passes **79/79**;
offline validation passes. The comprehensive ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Three runnable verifiers are now registered and gate-visible (`awkit-iu7`, 2026-08-03)

`scripts/verify-legacy-compat.mts` (152 assertions), `verify-validation.mts` (125) and
`verify-packaged-validation.mts` (86) were runnable but had **no npm script**, so no gate ran them —
~300 assertions covering the validation engine and Legacy Compatibility, invisible to the project.

The reason they stayed invisible: `verify:verifier-classification` reconciled the registry against
`package.json` in both directions, but neither direction looked at the filesystem, so a verifier file
that was never registered could not be noticed. All three are now registered
(`verify:validation` = unit, `verify:legacy-compat` = integration, `verify:packaged-validation` =
packaged-application), classified, and documented in `COMMANDS.md`, and a **third reconciliation
direction** — filesystem → package.json — now fails the gate on any unreferenced
`scripts/verify-*.{mjs,mts,js,ts}`, with an empty, justification-only allowlist. Mutation-proven:
unregistering one fails both the stale-entry and the new filesystem check.

`verify:validation` **125/125** and `verify:legacy-compat` **152/152** pass via npm (direct
`npx tsx` still works). `verify:packaged-validation` is registered and runs (86 pass) but reports one
FAIL — a **freshness guard**: `dist/win-unpacked` is ~4 days stale. That is the honest
packaged-application state; making it green needs a fresh package (release work), not done here.

Verifier-classification now reconciles **163** scripts across all 162 `scripts/verify-*` files.
Roadmap dashboard **155/155**, source-hygiene **9/9**, `typecheck:scripts`, `validate:offline` and
ai-memory all pass. Beads **9 outstanding / 142 closed** of 151; ledger unchanged at **62 PASS /
3 NOT RUN / 1 BLOCKED**.

---

## Roadmap portable action now releases the next patch version (2026-08-03)

The dashboard action previously called the lower-level `package-portable.ps1`, which correctly rebuilt
the current source but deliberately retained `package.json` version `0.1.2`. Repeated clicks therefore
replaced `dist/SpecterStudio 0.1.2.exe`, making a fresh build appear to be the old release.

**Generate next portable EXE** now invokes the fixed `release-portable.ps1 -BumpType patch -Force`
workflow. It requires a clean `main`, synchronizes `package.json` and `package-lock.json`, commits only
those version files, delegates all build/sign/strict-validation work to the canonical
`package-portable.ps1`, then commits only the signed dependency-manifest pair. It no longer uses
`git add -A` or `--no-verify`, and an unexpected concurrent file change is refused rather than staged.
The browser still cannot provide a command, bump type, arguments, environment, or output path.

The status API advertises `versionPolicy: "patch"`, and live dashboard assets disable the action with
the restart instruction when an older same-route server lacks that capability. Successful artifact
reporting reads the post-release version instead of caching the server-start version. PowerShell parse,
dirty-tree refusal, Node syntax, `npm run verify:all-typecheck`, and roadmap dashboard **155/155** pass.
The comprehensive ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

The first live bump also exposed a Windows PowerShell 5.1 limitation: `ConvertFrom-Json` rejects the
empty-string root key in npm's `package-lock.json`. That attempt stopped before commit/build and its
two version edits were restored. The wrapper now reads the three version values through bundled Node
and feeds only a simple key/value object back to PowerShell, preserving lock/package synchronization
without asking PowerShell to parse the lock structure.

The corrected live release then completed: `package.json`, both package-lock version fields, Windows
`FileVersion`/`ProductVersion`, and the signed dependency manifest all report **0.1.3**. The distinct
`dist/SpecterStudio 0.1.3.exe` is **212,848,404 bytes**, SHA-256
`EA9BC94B12475537A93384E24DC96972FBD384700B0B16291E8A76F5EE81F77F`. Strict packaging passed,
the manifest signature verifies, and `verify:packaged-runtime` passes **25/25**, including launching
the packaged app and confirming `appMode: "packaged"` plus the writable durable SQLite runtime.

---

## Portable EXE generated after release-key custody repair (2026-08-03)

The owner authorized moving the offline dependency-manifest private key from the legacy repository
location inside OneDrive to the approved non-synced
`%LOCALAPPDATA%\SpecterStudio\release-keys\offline-manifest-private.pem` location. The move was
performed without reading or logging key contents, and the destination directory was restricted to
the current Windows account. `verify:release-key-custody` passes **58/58** and the manifest signature
verifies against the existing public trust root. `awkit-2l1` remains in progress only because the
owner must still remove the historical synced copy from OneDrive's online recycle bins/version
history; local tooling cannot verify that external cleanup.

`npm run package:portable` now completes from clean source commit `d646cc8`. The packaging pipeline
passed its input preflight, application build, Zvec staging (**17/17** assets checksum-verified),
manifest regeneration/signing, strict offline validation, and Electron Builder. It produced
`dist/SpecterStudio 0.1.2.exe` (**212,847,833 bytes**) with SHA-256
`95265B8907CE7FD0E4C29CB91DCE0725A938A4BFC2FFCFE54D03864C98C8C782`; artifact provenance is in
`dist/release-provenance.json`. The dependency manifest/signature pair was regenerated as the
documented committed release artifact. Windows Authenticode remains unconfigured and Electron
Builder explicitly skipped publisher signing; that is separate from the valid internal Ed25519
manifest signature.

Roadmap verification passes **153/153**, `npm run verify:all-typecheck` passes, and the comprehensive
ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**. Beads are **10 outstanding / 141 closed** of 151.

---

## Roadmap dashboard can generate a portable EXE (2026-08-03)

The local Program Status dashboard now has a persistent **Generate portable EXE** button in its
sidebar footer. After an explicit confirmation it starts the repository's existing
`scripts/package-portable.ps1` pipeline, disables duplicate starts, and reports running, success, or
failure state. A successful response names only the repo-relative `dist/SpecterStudio <version>.exe`
artifact; command output and absolute paths stay in the terminal that launched the dashboard.

The action is deliberately narrow. `POST /api/package-portable` accepts no browser-provided command,
arguments, environment, or output path; the server invokes one fixed script with `shell: false`.
Starts require a custom action header and a same-origin request, so a foreign webpage cannot submit a
plain form to trigger a build. Only one build may run at once, while the read-only status endpoint lets
the page reconnect to an in-progress build.

The version-skew failure shown after this feature first landed is fixed. Public dashboard assets update
immediately from disk, while an already-running Node process keeps its old route table; that combination
returned plain-text `Not found` from the new endpoint and the client surfaced a JSON parser exception.
Portable API responses now decode safely, a stale server shows the actionable restart instruction and
disables the button, and the SSE reconnect path rechecks the capability after `npm run roadmap` restarts.
Raw non-JSON server errors are never reflected into the page.

Verification exercises both successful and failed child-process lifecycles plus stale-server plain-text
responses without running packaging.
`npm run build` and Node syntax checks pass. The new dashboard action checks all pass; a clean-candidate
dashboard run is recorded in the task log. A real portable package was intentionally **not** generated:
the working tree already contains an unrelated modified dependency manifest that must not be overwritten,
and owner-controlled release-key custody `awkit-2l1` remains the real packaging gate.
`npm run validate:offline` currently fails with
`Dependency-manifest SHA-256 does not match its signature record` against that pre-existing dirty pair;
this task did not modify, sign, regenerate, stage, or revert either file.
The comprehensive ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Runs admitted under Legacy Compatibility are attributed in the report (`awkit-vbj`, 2026-08-03)

A workflow run that executed **only** because a flow holds a Legacy Compatibility grant reported
`passed` with nothing to say so — an offline VM check found no `legacy`, `compatib` or `grant`
token anywhere in `reports/*.json`. The audit trail existed on the grant record, which answers "how
many runs did this exemption allow" but does not help someone reading one report.

`ConcurrentRunReport.legacyCompatibility` now names each admitted flow with its **grant deadline**.
It follows the existing `security` block, which exists for the same reason: a run admitted by an
exemption must not look identical to one that passed the validator outright. The block is **absent**
on ordinary runs, so its presence is itself the attribution, and an empty grant list is omitted
rather than written as an empty block.

It is snapshotted **at admission**, not re-derived at read time. The run gate already derived the
admitted flow ids from the validation issues; it now also reads `grantsMap()` there for the
deadlines and puts the result on `ConcurrentRunProfile.legacyCompatibility`, which `ExecutionEngine`
passes into `ReportService`. Grants expire and are revoked — a historical report has to keep saying
what was true when the run started.

New `npm run verify:run-report-compatibility` is **21/21**. It asserts at the level the defect was
found: a token scan over the *serialized* report, which a field that exists but does not survive
serialization would not satisfy. Four mutations produce focused failures — report drops the block,
engine stops passing it, block written unconditionally, admission stops snapshotting grants. That
last guard first passed for the wrong reason (an unqualified `grantsMap()` match was satisfied by an
unrelated call in the same file) and was tightened to the specific assignment.

**Not covered, filed as `awkit-5dn` (P3):** the Reports run-detail drawer. It reads
`telemetry.runDetail` from the durable SQLite store rather than the report JSON, so surfacing the
attribution there needs a v5 schema migration — a different kind of change, reviewed separately.

Also green: build, `typecheck:scripts`, legacy-compat **152/152**, telemetry **61/61**, runner
**89/89**, Reports GUI **31/31**, ipc-contract **5/5**, source-hygiene **9/9**, roadmap dashboard
**135/135**. Beads are **9 outstanding / 141 closed** of 150, and the comprehensive ledger remains
**62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Issuer signing key is covered by the custody rule (`awkit-5ea`, 2026-08-02)

The rule shipped for the dependency-manifest key (`awkit-2l1`) did not cover the **issuer** key — the
one that signs licences for *other* machines. Its default under `%LOCALAPPDATA%` was fine, but
`SPECTER_ISSUER_KEY` could point anywhere, including a OneDrive folder, and nothing checked.

`src/security/keyCustody.ts` is now the canonical statement of the rule: whole-path-segment detection
for seven providers plus the sync clients' own environment variables, `evaluateKeyCustody` failing
closed, `redactKeyPath` so no account name reaches a log, and the same exact-`1`
`AWKIT_ALLOW_SYNCED_SIGNING_KEY` override. `LicenseIssuerService.loadSigningKey` evaluates it
**before** `readFile` and throws the new `ISSUER_KEY_UNSAFE_LOCATION` — a key we must not use is not
one we should open. That method is the single funnel, so `readiness()` reports it as well as
`issue()`, and the Issuer page shows a specific, actionable message rather than a fallback.

**Two implementations remain, and that is now enforced rather than hoped.** The packaging signer runs
under plain `node` and cannot import TypeScript; `allowJs` is false, so the app cannot import the
`.mjs`. `verify:release-key-custody` therefore moved to `.mts` (with a `.d.mts` for the script-side
module), imports **both**, and drives one fixture table through them — asserting identical verdicts,
identical redaction, the same provider list and the same override variable. Drift fails loudly.

`verify:release-key-custody` is **58/58** (was 39/39). Four mutations produce focused failures: the
issuer check removed; custody moved *after* the read (caught by the ordering assertion *and* by
readiness reporting `ISSUER_KEY_MISSING`); the app-side provider table dropping an entry the script
still has; the override accepting any truthy value. The issuer cases use paths that do not exist and
a placeholder trust root — **no key material was created, read, moved or rotated**.

Also green: build, `typecheck:scripts`, licensing **183/183**, authz **92/92**, admin GUI **18/18**,
e2e-licensing **38/38**, ipc-contract **5/5**, ipc-error-message **22/22**, source-hygiene **9/9**,
roadmap dashboard **135/135**, `validate:offline`; and the `awkit-2l1` release-key gate still refuses
as designed. Beads are **9 outstanding / 140 closed** of 149, and the comprehensive ledger remains
**62 PASS / 3 NOT RUN / 1 BLOCKED**.

`awkit-2l1` is unchanged and still needs owner action: the manifest key has not moved.

---

## IPC rejections no longer leak the channel name into toasts (`awkit-x48`, 2026-08-02)

Refusing an unsafe undo showed the user
`Error invoking remote method 'validation:undoMigration': Error: Flow … was edited after this
migration …` — the domain sentence was right, the transport wrapper around it was not.

Fixed once at the **single renderer-facing IPC boundary** rather than per toast. New
`app/main/ipcErrorMessage.ts` strips the preamble (anchored, so a domain sentence that quotes it is
untouched; bounded unwrapping for the nested case) and then only the **generic** `Error: ` name —
`TypeError:` and friends are preserved, because they signal a bug rather than a considered refusal.
Empty or non-`Error` rejections fall back instead of producing a blank toast. `preload.ts` gained an
`invoke()` wrapper that routes every rejection through it and keeps the original as `cause`, so the
failing channel is still available for diagnostics; all **202** call sites use it and the wrapper is
the only remaining direct `ipcRenderer.invoke`. No renderer change was needed — every invoke-backed
toast is fixed at the same time.

**Proved in the real app, not only in a unit:** `verify:flow-designer` now drives a rejected
`validation:undoMigration` through the built Electron app and asserts the renderer receives
`No migration no-such-migration for flow awkit-x48-no-such-flow.` — no channel name, non-empty
message. **72/72** (was 69/69).

New `npm run verify:ipc-error-message` is **22/22** (class `unit`). Four mutations produce focused
failures: preamble not stripped, any `*Error:` name stripped, unanchored match, and a call site
bypassing the wrapper.

**Collateral damage found and repaired:** the rename broke `verify:ipc-contract`, which parsed
preload for `ipcRenderer.invoke("channel")` and silently reported **`0 exposed, 224 backend-only`**.
It now accepts both spellings *and* carries a cardinality floor, so a pattern that stops matching
fails loudly instead of describing an empty contract. **5/5, 202 exposed.**

Also green: build, `typecheck:scripts`, `verify:auth-gui` **25/25**, `verify:admin-gui` **18/18**,
source-hygiene **9/9**, verifier-classification (**160** scripts), roadmap dashboard **135/135**,
`validate:offline`, `git diff --check`. Beads are **10 outstanding / 139 closed** of 149, and the
comprehensive ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

**Filed during this session:** `awkit-5ea` (P2 — the issuer console's `SPECTER_ISSUER_KEY` override
has no synced-folder custody check, so the rule shipped for the release key does not cover the key
that signs customer licences) and `awkit-73s` (P4 — an intermittent compact-viewport geometry check
in the Flow Designer gate: failed once, not reproduced in two re-runs, and clean HEAD passed).

---

## Singleton Issuer role and offline issuance console complete (`awkit-0tn`, 2026-08-02)

SpecterStudio now has one built-in `Issuer` role that is both exclusive (it cannot be combined with
another role) and singleton (only one stored user may hold it). The Super User can provision or
reassign that account but does not inherit its page or signing permission. The renderer route/nav and
the trusted main-process IPC independently require the exact Issuer role, so direct grants, custom
roles, DevTools calls, and Super User's normal authority cannot cross the signing-key boundary.

The new **Administration → License Issuer** page accepts the privacy-safe activation-request JSON,
shows the target request, lets the Issuer select type/duration/entitlements, requires fresh password
confirmation, and automatically saves the signed `.dat` under
`%LOCALAPPDATA%\SpecterStudio\issuer-output\`. The private Ed25519 key remains external under the issuer
workstation's `issuer-keys` directory (or the explicit key-path environment variable), is validated
against the shipped public key before use, never reaches the renderer, and is never written to audit or
history. Requests are bounded/strictly validated, output is atomic, and secret-free issuance history is
kept beside the external key.

The app remains offline: issuing for another machine automates validation/signing/output, but the `.dat`
must still be transferred back and imported on that machine. Automatic remote installation would require
a separately authorised transport/service and was not invented here.

Verification: build and script typecheck pass; `verify:authz` **92/92**; `verify:licensing` **183/183**;
random lifecycle **13/13**; IPC contract **4/4**; Super User Admin GUI **18/18**; real Electron RBAC
**70/70** (including the Issuer page, role isolation, exact-role IPC, missing-key fail-safe, and Super User
denial); real Electron licensing **38/38**; source hygiene **9/9**; secrets **16/16**; verifier
classification reconciles all **158** scripts; ordinary offline validation passes. Real-Electron signing
with a provisioned production private key was not run because that key is deliberately unavailable to
this task; the domain issuance path used an ephemeral Ed25519 key and verified the written signature.
The comprehensive ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Release signing key: custody gate shipped; the move itself is OWNER ACTION (`awkit-2l1`, 2026-08-02)

**`awkit-2l1` remains OPEN (in progress).** The tooling half is done; the custody change is not, and
by the bead's own terms must not be automated.

The offline-manifest private key is resolved by a new `scripts/lib/release-key-custody.mjs`:
explicit `--private-key` → `AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY` →
`%LOCALAPPDATA%\SpecterStudio\release-keys\offline-manifest-private.pem` (the approved default) →
the legacy in-repo `.release-local` path. Any resolution landing inside a cloud-synced tree
(OneDrive, Dropbox, Google Drive, iCloud Drive, Box, pCloud, Creative Cloud) is **refused**, matched
on whole path segments plus the sync clients' own environment variables — so `C:\work\onedriveclone`
is not mistaken for OneDrive. The gate covers `sign` and `generate-key` only; `verify` is read-only,
never touches the private key, and is unaffected. Messages redact `%LOCALAPPDATA%` / `%USERPROFILE%`
/ `$HOME`, so no account name reaches a release log. `AWKIT_ALLOW_SYNCED_SIGNING_KEY=1` (exact `1`)
is a deliberate, stderr-warned exception.

**State on this machine, unchanged by me:** the key is still at
`<repo>\.release-local\offline-manifest-private.pem`, inside the OneDrive tree. It was not moved,
rotated, read or copied. **Consequence: packaging now fails at the manifest-signing step until the
owner acts** — deliberate, because the alternative is quietly shipping releases signed from a cloud
folder. `verify` exits 0 and `validate:offline` still passes.

Owner procedure (four steps: provision or rotate → securely remove the synced copy including
OneDrive recycle bin and version history → re-verify → run the guard) is in
`docs/security/RELEASE_KEY_CUSTODY.md`.

New `npm run verify:release-key-custody` is **39/39** — pure path/env reasoning over the real module,
reading no key and launching nothing. Four mutations produce focused failures: the gate downgraded to
always-allow, substring instead of whole-segment sync matching, the approved location no longer
preferred, and the override accepting any truthy value. Build, `typecheck:scripts`, source-hygiene
**9/9**, verifier-classification (**158** scripts), roadmap dashboard **135/135**,
`validate:offline`, and `offline-manifest-signature verify` all pass. Beads are **9 outstanding /
137 closed** of 146, and the comprehensive ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Recorder baselines the loaded page, and the verifiers test the shipped install order (`awkit-a7k`, 2026-08-02)

The recorder took its at-rest baseline the instant the script ran. Production injects with
`context.addInitScript`, so that instant is **document start** — before the page's own markup is
parsed. The baseline was therefore taken against an empty document, with three consequences that
only appeared under the real install order:

- `absentAtBaseline` was true for every element on the page, so "was not there at rest" meant
  nothing;
- the entire initial parse was recorded as a stream of insertions with null witnesses, burning up to
  `INSERTION_RECORD_CAP` records before the user did anything;
- `nearestInsertion` found one of those witness-less parse records on an ancestor of almost any
  target, short-circuiting insertion attribution and making the fail-closed saturation guard
  **unreachable**.

`startObservation` now runs on `DOMContentLoaded` (or immediately if the document is already parsed),
so "at rest" means the loaded page under either install order. Positives were never affected — a
target's own record is checked before any ancestor — which is why this survived three tasks of green
runs.

The harness gap that hid it is closed too: `verify-recorder-hover` and `verify-recorder-ambiguity`
now install via `context.addInitScript` like the product (`verify-recorder-locator` already did), and
a new source guard in section `[0]` asserts across every recorder verifier that none injects with
`page.evaluate` after load and all use `addInitScript` — with a cardinality check first, since an
empty scan would satisfy it perfectly.

Both fixes are mutation-proven: undoing the deferral makes the saturation section fail (4 checks),
and reverting one verifier to post-load injection makes the source guard name that file.

`verify:recorder-hover` is **214/214** (was 211/211, +3 source-guard checks, now under the production
install order). Recorder locator **171/171**, ambiguity **62/62**, recorder-flow **29/29**,
recorder-draft **50/50**, recorder-redaction **15 PASS**, REC-018 e2e **61 PASS**, Recorder GUI
**166 PASS**, runner **89/89**, Mock Site **110/110**, flow-step-mapping **111/0**, profile-store
**18/18**, IPC contract **4/4**, Flow Designer GUI **69/69**, catalog parity **39/39**,
source-hygiene **9/9**, roadmap dashboard **135/135**; build, `typecheck:scripts` and
`validate:offline` pass. Beads are **9 outstanding / 137 closed** of 146, and the comprehensive
ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Remote (non-adjacent) hover triggers are attributed (`awkit-hmt`, 2026-08-02)

A hover trigger in a different subtree from what it reveals — neither ancestor nor sibling — is now
attributed and replayed. CSS cannot express that relationship, so these are always JS-driven.

What changed is not a new signal but the removal of an **inconsistency**: a remote hover that
*inserts* a control has been attributed since `awkit-0vm`, because the insertion resolver never
required adjacency, while a remote hover that merely *unhides* an existing control was refused —
same interaction, same evidence, opposite verdicts. `resolveRemoteHoverTrigger` gives the reveal path
the discriminator the insertion path already used: the pointer's **arrival**, not its presence. A
reveal that follows the pointer landing on the trigger within `INSERTION_CAUSAL_WINDOW_MS` is
explained by that landing; one that happens while the pointer has been sitting there is not.
`revealWitness` now records `{el, since, at, cause}` instead of a bare element, so the arrival time
and competing causes (navigation / click / focus) are available at the reveal moment.

Adjacency is still tried first — the sibling path is unchanged and short-circuits — so every existing
verdict is preserved; remote is a fallback that can only turn `none` into `trigger` or `review`.

`verify:recorder-hover` is **211/211** (was 191/191). The remote positive replays Hover → Click on
two fresh pages and proves the click alone fails. Recorder locator **171/171**, ambiguity **62/62**,
recorder-flow **29/29**, runner **89/89**, Mock Site **110/110**, flow-step-mapping **111/0**,
profile-store **18/18**, IPC contract **4/4**, Recorder GUI **166 PASS**, Flow Designer GUI
**69/69**, catalog parity **39/39**, source-hygiene **9/9**, roadmap dashboard **135/135**; build,
`typecheck:scripts` and `validate:offline` pass. Beads are **10 outstanding / 136 closed** of 146,
and the comprehensive ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

**Mutation coverage, stated exactly.** Remote attribution disabled, reveal-witness requirement
removed, and the arrival window removed each produce focused failures. The arrival-window mutation
survived three times before it was real: the negative fixture first refused on witness *freshness*,
then on a pointer sampling gap, then because raw `mouse.move` to a control below the viewport
produced no pointer events at all. The **competing-cause filter and the "witness outside the revealed
surface" check are not covered on the remote path** (both are covered on the insertion path, which
has fixtures for them); the shared `buildTriggerLocator` / broad / landmark guards are covered by the
sibling and insertion sections that exercise the same functions.

**Also found, not fixed here — `awkit-a7k` (P2).** The recorder verifiers install the init script
with `page.evaluate` *after* load, but production uses `context.addInitScript` (document start). All
211 checks therefore exercise an install order the product never uses. Measured: ordinary clicks are
unaffected under either order (282-element and synthetic 1807-element pages, controls before and
after the bulk — the per-root descendant cap prevents parse-time saturation, so the `db0babd`
fail-closed guard does **not** regress real recordings). Switching the harness gives 187/191: only
the saturation section fails, because at document start every element gets a witness-less parse
record and `nearestInsertion` finds one on an ancestor — which means that guard is largely **inert in
production**.

---

## Open-shadow hover triggers persist the INTERNAL control (`awkit-0vm` follow-up, 2026-08-02)

The insertion work in `db0babd` persisted the outer **host** as the hover trigger whenever the
observed pointer witness was inside an open shadow root. That was wrong, and a passing fixture had
hidden it: hovering a host picks an action point at the host's centre, which need not lie on the
internal control, and a listener bound to that control does not fire for a hover that never enters
it. The fixture only passed because its host was the same size as its trigger.

`buildTriggerLocator` now describes a shadow-internal trigger with the **Increment 6 model** — an
ordered outer-to-inner host chain in `context.shadow.hosts` plus a semantic locator generated against
the innermost root, strictly unique within it and non-positional — which the existing
`LocatorFactory` already walks. No new executor and no custom piercing selector. **A host locator is
persisted only when the host itself was the observed pointer witness**, never as a stand-in for an
internal trigger; when the inner trigger cannot be represented the step is `needs-review` with
`hover trigger inside open shadow root could not be represented safely` and **no executable
fallback**.

Root cause of the wrong witness: `event.target` is **retargeted to the host** on a window-level
capture listener, so the pointer trail recorded hosts instead of internal controls. `recordPointer`
now uses the composed path (which stops at the host for a closed root, correctly).

The regression fixture makes host substitution provably wrong: nested open roots where both hosts are
far larger than the trigger, the trigger is pinned to a corner, and the `mouseenter` listener is on
the trigger — so hovering either host's action point inserts nothing. A light-DOM decoy shares the
trigger's accessible name, so the ordered host chain is load-bearing rather than decorative.

`verify:recorder-hover` is **191/191** (was 166/166). Recorder locator **171/171**, ambiguity
**62/62**, recorder-flow **29/29**, runner **89/89**, Mock Site **110/110**, flow-step-mapping
**111/0**, profile-store **18/18**, IPC contract **4/4**, Recorder GUI **166 PASS**, Flow Designer
GUI **69/69**, catalog parity **39/39**, source-hygiene **9/9**, roadmap dashboard **135/135**;
build, `typecheck:scripts` and `validate:offline` pass. Beads are **10 outstanding / 135 closed** of
145, and the comprehensive ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

**Mutation coverage, stated exactly:** inner-witness→host, shadow-context dropped, host ordering
reversed and strict inner uniqueness removed each produce focused failures. The `:nth-*` regex on the
inner locator is **defence-in-depth only and not independently observable** — with
`allowPositional: false` the generator marks an unresolvable inner target `quality.strategy ===
"fallback"` (value `button`) rather than emitting an `nth` chain, so the fallback guard always
decides first. It is kept deliberately, not claimed as covered.

---

## Hover-INSERTED controls are attributed (`awkit-0vm`, 2026-08-02)

A control that does not exist at the baseline scan has no hidden-at-rest visibility record, and
**absence is not hiddenness** — `visibilityState.get(el) === false` is simply false for it, so the
hover paths never considered it and the click was saved with no prerequisite. Hover-inserted controls
now carry their own evidence.

New bounded subsystem in `recorderInitScript.ts`:

- **Insertion records** (`WeakMap`, cap 600 elements, 64 descendants per inserted root) written from
  the recorder's own MutationObserver — the document observer plus **bounded per-open-shadow-root
  observers** (cap 32), since a document-level observer cannot see a childList change inside a
  shadow root. Roots existing at install are found by the bounded open-root walk; later ones are
  queued by the `attachShadow` wrapper. First observation wins, so re-inserting the same node does
  not overwrite the causal evidence.
- **Pointer residence** — the element the pointer is on and *when it arrived*, which is the causal
  clock. Movement within one subtree continues the same residence.
- **`absentAtBaseline`** — controls first seen after the baseline scan, recorded as their own fact
  rather than inferred from a missing record.
- **Competing-cause clocks** for navigation, trusted click and focus.

`resolveInsertedHoverTrigger` runs *before* the hidden-at-rest paths and requires jointly: an
observed insertion; `cause === "pointer"`; a concrete witness; the pointer's **arrival** within 600ms
of the insertion (dwell length is not evidence — a parked pointer when a timer fires satisfies
"nearby" perfectly); the witness outside the inserted surface; still connected; still the pointer
owner as the click lands; and a stable, non-positional locator. Anything short of that is
`needs-review` carrying a **`hoverReviewReason`**, which `buildRecordedFlow` copies into the step's
`reviewReason`. Reaching the record bound **fails closed** to review rather than clearing the click.
A navigation/click/focus-caused insertion is left alone entirely — it has no hover prerequisite, so
reviewing it would be a false alarm. New optional evidence fields `hoverInserted` and
`hoverReviewReason` on the recorder interaction and `LocatorInteractionEvidence`.

Two real defects surfaced while building the fixtures and are fixed: a compound
`:nth-of-type(...)` trigger passed `isStableGenerated` (now `isStableTriggerLocator`, applied to all
three hover paths), and `hoverContainer` persisted a **different** generation from the one the
stability guard had validated — the guard proved nothing about the saved locator.

`verify:recorder-hover` is **166/166** (was 81/81), covering inserted sibling / container /
multi-node / re-inserted / open-shadow positives with two-fresh-page replay and a profile JSON round
trip, and negatives for timer, witness-less, unrelated-subtree, click-driven, positional-only and
vanishing triggers plus the fail-closed bound. All six required mutations produce focused failures.
Recorder locator **171/171**, ambiguity **62/62**, recorder-flow **29/29**, runner **89/89**, Mock
Site **110/110**, flow-step-mapping **111/0**, profile-store **18/18**, IPC contract **4/4**,
Recorder GUI **166 PASS**, Flow Designer GUI **69/69**, catalog parity **39/39**, source-hygiene
**9/9**, roadmap dashboard **135/135**; build, `typecheck:scripts` and `validate:offline` pass.
Beads are **10 outstanding / 135 closed** of 145. Ledger unchanged at **62 PASS / 3 NOT RUN /
1 BLOCKED**.

**Known boundary (unchanged):** remote, non-adjacent hover triggers stay unattributed — `awkit-hmt`.

---

## Adjacent-sibling hover triggers are attributed (`awkit-vot`, 2026-08-02)

Hover-dependency capture no longer requires the trigger to be an ANCESTOR of what it reveals.
`.trigger:hover + .target { display: block }` — where the revealed surface is the control itself, so
the composed-path walk finds no hidden ancestor run at all — was classified `none`: no hover step,
and a recorded click that silently failed replay. A new `resolveSiblingHoverTrigger` attributes these
from pointer evidence, and also runs as a fallback wherever the ancestor walk would have returned
`review`, so a sibling-driven reveal inside a wrapper that is not stably locatable is now pinned to
the real trigger instead.

Attribution requires four independent pieces of evidence, all mutation-proven load-bearing:

1. **The last pointer sample outside the revealed surface** — samples inside it are where the pointer
   went after the reveal, an effect rather than a cause.
2. **Adjacency** — that sample must sit in a sibling subtree of the revealed root, and promotion to
   an action owner must not escape it (walking out to the shared wrapper is the container guess this
   path exists to avoid).
3. **A reveal witness** — a new `revealWitness` map records where the pointer was when a
   hidden-at-rest control was *first observed visible* (the existing MutationObserver + 150ms sweep
   already runs at that moment). This is what separates a hover-caused reveal from one that merely
   happened while the pointer was parked nearby; without it the recorder attributes a timer reveal to
   an unrelated neighbouring button, which is exactly what the mutation shows.
4. **The existing non-positional stability bar** — a trigger that resolves only to an `nth-child`
   chain is a review item, never a saved locator.

Anything that satisfies the pointer evidence but fails a guard yields `needs-review`; anything with
no sibling evidence at all keeps its previous verdict, so async self-reveals stay unflagged and
`awkit-0vm` is untouched. **Known boundary:** a REMOTE reveal — trigger and target in different
subtrees — is still unattributed, because reveal-moment evidence on its own is satisfied by any hover
that coincides with any reveal anywhere on the page. That boundary is now pinned as behaviour by a
fixture and tracked as `awkit-hmt`.

`verify:recorder-hover` is **81/81** (was 48/48), including replay of the sibling hover→click through
the real `StepExecutor`/`LocatorFactory` on a fresh page and proof that the click alone fails without
the hover step. Five new Recorder Lab fixtures cover the positive, three negatives and the boundary.
Recorder locator **171/171**, ambiguity **62/62**, recorder-flow **29/29**, Mock Site **110/110**,
source-hygiene **9/9**, catalog parity **39/39**, roadmap dashboard **135/135**; build,
`typecheck:scripts` and `validate:offline` pass. Beads are **11 outstanding / 134 closed** of 145.
The comprehensive ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Flow Designer node catalog parity fixed (`awkit-8lz`, 2026-08-02)

`hover` now has its own Flow Designer catalog entry (`MousePointer2`, "Hover", "Hover over an
element", locator-required) and appears in the Node Palette. It previously rendered as a
"Start / Flow entry point" card with the Play icon, because `getFlowNodeCatalogItem` fell back to
`flowNodeCatalog[0]` for any type the catalog did not know and `hover` was registered in
`flowNodeRegistry.ts` only. That fallback is gone: an unrecognized step type now resolves to an
explicit **Unknown Step** item (`HelpCircle`, description naming the offending type) and is reported
to the console, so an unknown type can never impersonate a structural Start node. Execution was
never affected — the runner reads the registry, not the catalog.

`npm run verify:flow-node-catalog-parity` (**39/39**) locks the contract: catalog↔registry in both
directions, plus the `StepType` union parsed from `FlowProfile.ts`, with cardinality/non-empty guards
evaluated first so no set comparison can pass over an empty scan, and a source guard against the
entry-zero fallback returning. It was mutation-tested against all four regressions it exists for
(hover entry deleted, registry-only type, catalog-only type, fallback restored) and fails on each.

Flow Designer GUI is **69/69**, Recorder GUI **166 PASS / 0 FAIL**, flow-step-mapping **111/0**,
recorder-flow **29/29**, source-hygiene **9/9**, roadmap dashboard **135/135**; build,
`typecheck:scripts` and `validate:offline` pass. Beads are **11 outstanding / 133 closed** of 144.
The comprehensive ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Recorder hover action-owner promotion fixed (`awkit-3vh`, 2026-08-02)

Hover-gated capture now promotes the first visible-at-rest wrapper to its nearest actionable owner
before generating the prerequisite hover locator. The owner search covers native controls, generic
interactive roles, labelled/tabbable/contenteditable elements, and custom-element hosts. Trigger
generation disables positional candidates entirely: uniqueness through `:nth-child`/
`:nth-of-type` is not treated as stable, and a positional-only trigger leaves the click
`needs-review` rather than persisting a fragile hover step.

The Recorder Lab now proves both sides with a `role=tab` action owner above an unlabelled wrapper and
a no-owner positional negative. The real capture → `buildRecordedFlow` → `LocatorFactory`/
`StepExecutor` replay gate is **48/48**; Recorder locator **171/171**, ambiguity **62/62**, Mock Site
**110/110**, build, and scripts typecheck also pass. The separate sibling/self-toggle and
hover-inserted-control limitations `awkit-vot` / `awkit-0vm` remain open. The comprehensive ledger
remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

---

## Licensing enforcement and dependency-manifest audit complete (2026-08-01)

`awkit-f3l` and `awkit-hj8` are **CLOSED**. Main-process licensing now evaluates the run gate at
startup, every 15 minutes, on browser-window focus, on licensing mutations/revalidation, and before
new or repeated runs. A synchronous fail-closed dispatch latch is registered before the enforcement
watcher starts; startup exits visibly if registration is missing. Queue promotion checks the latch
before `queued -> pending` and again after resource acquisition, while repeat requests apply the full
new-run policy. A `cancel-pending` transition sweeps all queued/pending instances exactly once and
writes one system audit event with null actor/session identifiers; a valid revalidation immediately
clears the latch. Dispatch may retain a newly invalid state for at most the 30-second refresh ceiling
between event-driven checks.

Verifier failure semantics are hardened: CLI-only inspection refuses to assert success when any
artifact was not inspected or is empty, and all three packaged/CLI verifiers now exit nonzero for
BLOCKED as well as failed assertions. Signing-key and sibling TSX launches use direct local runtime
argv with no command shell; `scripts/dev.mjs` remains the intentional `.cmd` shim exception. The
dispatch-gate verifier's `shell: true` scan additionally asserts a **liveness floor** on the file list
it walks (2026-08-02), because `shellTrue.length === 0` is vacuously true over an empty scan — a
broken walk would otherwise report "no shell interpretation anywhere" while reading nothing. The floor
(150) was measured against 224 real files; raise it as the tree grows, never lower it to match a
failure. Mutation-tested: forcing the floor high produces `1 failed` and exit 1.

A sweep for the same vacuity shape in the other two BLOCKED verifiers (2026-08-02) found
`verify:packaged-licensing` **clean** — its `block()` calls sit in an `if/else` on key availability
and it holds no collection whose emptiness is asserted. `verify:packaged-walkthrough` had **three**
instances, all now fixed. `sampleSystem()` runs PowerShell under `$ErrorActionPreference=
'SilentlyContinue'` and returns `null` on failure, and `bundledChromeNow()` converted that `null`
into `[]` — so "no bundled-Chromium left after clean exit" (Part H), the orphan-observation poll
(Part I) and the final "teardown left no zombie processes" assertion all **passed when the probe was
blind**, the last one being the gate's closing claim. The orphan poll was worst: it resolved `true`
on its first blind poll and printed "orphaned processes self-exited" as a positive finding derived
from a measurement that never happened. `bundledChromeNow()` now returns `null` for an unreadable
process table (matching the `-1` sentinel discipline `chromeRootsNow` already used), an
`isLiveSample()` floor of **50 processes** rejects implausibly small samples, and each of the three
sites fails or reports INCONCLUSIVE rather than passing. Floor measured against **291** live
processes on the development machine. Part M's egress checks were already protected by
`observer.samples >= 5`, which is the pattern the rest of the file now follows.

The committed `resources/dependency-manifest.{json,sig}` pair remains byte-untouched. Packaging on
2026-08-02 necessarily regenerated and re-signed it at HEAD; on owner instruction it was **restored to
the committed baseline afterwards** (byte-identical to HEAD, signature re-verified, SHA-256 matching
the `.sig`), following the precedent that a packaging regeneration is not committed alongside
unrelated work. The built artifact under `dist/win-unpacked/` keeps its **own** copy recording
`sourceCommit 549a9ff` — repo and artifact differing here is correct, not drift: the artifact
describes the source it was built from, the repo holds the last committed baseline. It is valid and
self-consistent, but it is **not release-current** because `application.sourceCommit` does not equal
the current Git HEAD. Ordinary `validate:offline` continues to verify integrity; `-Strict` is the
release-only gate and additionally requires manifest app version to equal `package.json` and
`sourceCommit` to equal release HEAD. Key custody relocation/rotation outside the OneDrive-synced
workspace is tracked separately as open P1 `awkit-2l1`; no private key material was recorded.

Verification: build PASS; scripts typecheck PASS; licensing **167/167**; dispatch-gate **34/34**;
runner **89/89** in the final isolated run; CLI-only **24/24**; IPC **4/4**; source hygiene **9/9**;
verifier classification **156/156**; ordinary offline validation PASS. Strict offline validation
failed at the intended release-current provenance assertion. Packaged licensing/walkthrough suites
were not run because the available EXE predates this source; live Electron timer/focus/bootstrap
behavior was not manually exercised.

**Portable rebuilt and the walkthrough re-run against it (2026-08-02).** `npm run package:portable`
**succeeded**, producing `dist/SpecterStudio 0.1.2.exe` (212.8 MB) with `app.asar` newer than the
newest `src/`/`app/` source. The packaging chain's **`-Strict` step passed**, which is the first real
execution of the `awkit-hj8` provenance gate: the manifest was regenerated at HEAD, so
`application.version` (`0.1.2`) equalled `package.json` and `application.sourceCommit`
(`549a9ff…`) equalled HEAD, with `sourceTreeDirty: false`. That gate has now been observed in **both**
directions — rejecting the non-release-current manifest, and admitting a genuinely release-current
one.

`npm run verify:packaged-walkthrough` returned **25 PASS / 0 FAIL / 1 BLOCKED, exit 1** — identical to
the previously recorded blocked-run baseline, so the liveness fix changed no existing outcome. Two
things it confirms directly:

- **The BLOCKED-exits-nonzero fix works end to end.** Before it, this exact state exited **0**; a
  release gate that could not attempt licensed execution reported success. It now exits 1.
- **The teardown liveness guard ran and passed** — "teardown left no zombie app or bundled-Chromium
  processes" is in the `finally` block, so it executes even on the blocked path. It passed *because*
  `isLiveSample()` saw a real process table; a broken probe would now fail it instead of passing.

**Still owed:** Parts D–G/H/I never execute without `AWKIT_PACKAGED_LICENSE_ISSUER_KEY`, which
`resolveIssuerKey()` deliberately refuses to infer from the key at the default location ("do not sign
with the production release key on an ordinary developer machine"). So the Part H
"no bundled-Chromium after clean exit" and Part I orphan-poll liveness fixes remain **unexercised on a
real run**, as does packaged licensed execution generally. Those need an authorized validation machine
or CI runner. A full run there will also report **one assertion more** than a pre-2026-08-02 full run,
because Part I gained "the orphan probe could read the process table" — that delta is expected, not a
regression. The clean/offline VM walkthrough remains a separate human gate and is not claimed here. The comprehensive ledger remains **62 PASS / 3 NOT RUN / 1
BLOCKED**. Recorder residuals `awkit-vot` and `awkit-0vm` remain open; AWKIT-REC-030 remains resolved.

---

## Recorder ambiguity-resolution: epic COMPLETE after Increments 3/4 reconciliation (2026-08-01)

Reconciliation from checkpoint `57dfad2` found and repaired two contract defects in the earlier
ambiguity UX: choices could be marked resolved without live responsible-layer validation
(`awkit-aui.3.1` / AWKIT-REC-033), and positional approval was not bound to the approved locator,
context, action, and safety (`awkit-aui.4.1` / AWKIT-REC-034). All seven `awkit-aui` increments, both
defect children, and parent AWKIT-REC-030 are now closed with full regression evidence.

Current behavior: real positional/unresolved capture pauses before commit; selection and captured
scope are validated through `LocatorFactory` against frame/shadow/container context; approval requires
a reason and exact `approvedFallbackBinding`; mapping/editor changes invalidate stale authority;
preflight and runtime fail closed; non-dangerous approved use emits a reportable lower-resilience log;
sensitive positional actions remain prohibited. Recorder and Flow Designer provide accessible review,
approve, edit-invalidate, and revoke workflows.

### Increment 3 acceptance matrix

| Criterion | Evidence | Result |
|---|---|---|
| Pause before commit for real positional/unresolved capture | Recorder GUI real `?rec034=1` capture; pending action absent until decision | PASS |
| Validate candidate/scope against the live authorized target | `RecorderService` uses `LocatorFactory.locateCandidate`; invalid and positional-alternative controls | PASS |
| Cancel discards; defer remains blocked; approved/resolved persists | Recorder GUI cancel/defer/save/reload plus ambiguity preflight/replay | PASS |
| Evidence, alternatives, context, and consequence are accessible | Focus-contained `alertdialog`; keyboard trap and evidence assertions | PASS |
| Sender permission and single-active-recorder invariant remain intact | `verify:recorder-authz` 50/50 and Recorder GUI REC-025 | PASS |

### Increment 4 acceptance matrix

| Criterion | Evidence | Result |
|---|---|---|
| Approval requires a specific reason and exact binding | Recorder + Flow Designer GUI approval lifecycle | PASS |
| Binding survives unchanged frame/shadow mapping and store/IPC round trips | mapping 111/111; profile store 18/18; ambiguity point 9 | PASS |
| Locator, context, action-name, and safety edits invalidate authority | production mapping negative controls and GUI edit/reload | PASS |
| Revocation stays blocking after reload | Flow Designer GUI approve/revoke/save/reload | PASS |
| Approved non-dangerous fallback runs and is disclosed in reports/history | ambiguity point 5 + `ReportService` log assertion | PASS |
| Unapproved, stale, and sensitive positional actions are refused | validator/runner negative controls | PASS |

Full results: build PASS; scripts typecheck PASS; Recorder **171/171**; ambiguity **62/62**; Recorder
flow **29/29**; hover **34/34**; runner **89/89**; Mock Site **110/110**; Flow Designer mapping
**111/111**; profile store **18/18**; IPC **4/4**; draft **50/50**; authz **50/50**; Recorder E2E
**61/61** with **18/18 (100%)** replay fidelity; Flow Designer GUI **69/69**; Recorder GUI **166/166**;
Reports live engine **21/21**; Reports GUI **31/31**; Reports/Settings a11y **14 PASS / 0 FAIL**;
classification **155/155** reconciled; source hygiene **9/9**; offline validation PASS.

The comprehensive validation ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**.

Dependency manifests remain untouched; `awkit-vot`, `awkit-0vm`, and `awkit-hj8` stay separate.

---

## Recorder ambiguity-resolution: Increment 6 Shadow DOM capture/replay COMPLETE (2026-08-01)

Increment 6 (`awkit-aui.6`) now records the first usable `Element` from the actual
`event.composedPath()`, so controls inside reachable open shadow roots retain their inner semantic
target instead of the retargeted custom-element host. Candidate counts traverse the document plus a
bounded snapshot of recursively reachable open roots. Duplicate inner controls are scoped by the
smallest stable outer-to-inner host chain and replay through the normal
`LocatorFactory` → `StepExecutor` path. Nested open roots, role/test-ID targets, dynamically attached
roots, slotted light-DOM controls, and existing frame context are covered in the Recorder Lab.

Known closed roots are classified by a pre-page-script `attachShadow` wrapper that calls the native
method once, returns its result unchanged, and stores only the host in a `WeakSet`; no closed-root
content or object handle is retained. Their actions persist diagnostic host context plus
`resolution: "needs-review"` / `reviewReason: "closed shadow root"`, and static `FlowValidator`
preflight blocks before browser launch. Child-frame captures without a strict existing frame selector
are likewise review-required; cross-origin captures retain only safe origin/name evidence and cannot
fall through to the main document.

The schema additions are optional (`LocatorContext.shadow`, ordered shadow hosts,
`LocatorQuality.visibleMatchCount`, shadow/frame interaction evidence, and `reviewReason`). JSON,
Flow Designer, profile-store, import/export-style JSON/`structuredClone`, and IPC clone paths preserve
the fields; legacy locators remain executable. Graphify was independently proven for Codex and Claude
with live CLI queries against the current graph; Antigravity proof is recorded as owner-confirmed
manual live-tool evidence.

- Verification: build PASS; `typecheck:scripts` PASS; `verify:recorder` **171/171**;
  `verify:recorder-ambiguity` **59/59**; `verify:recorder-flow` **29/29**;
  `verify:recorder-hover` **34/34**; `verify:runner` **89/89**; `verify:mock-site` **110/110**;
  `verify:flow-step-mapping` **105/105**; `verify:profile-store` **16/16**;
  `verify:ipc-contract` **4/4**; `verify:recorder-draft` **50/50**;
  `verify:recorder-authz` **50/50**; `verify:recorder-e2e` **61/61** (18/18 replay fidelity,
  100%); `verify:recorder-gui` **152/152**; verifier classification **155/155 reconciled**;
  source hygiene **9/9**; `validate:offline` PASS.
- Comprehensive validation ledger unchanged: **62 PASS / 3 NOT RUN / 1 BLOCKED**.
- `resources/dependency-manifest.json` and `.sig` remain untouched; audit `awkit-hj8` stays separate.

## Recorder ambiguity-resolution: Increment 2 reconciled COMPLETE + awkit-bw9 fixed (2026-08-01)

Increment 2 (`awkit-aui.2`, capture enrichment + landmark/href locator strategies) was implemented in
commit `88ee9b0` but its bd item was still `in-progress`. Reconciled against code/git/tests/bd and
found **complete**; closed `awkit-aui.2` (unblocks `awkit-aui.3` and `awkit-aui.6`). Evidence:
- **Capture enrichment** — `captureInteraction` records `interaction.path` (composedPath host tags),
  `x`/`y` coords, and `matchIndex`.
- **Landmark scoping** — `detectContainer` scopes to the nearest landmark (`nav`/`main`/… or role) via
  `describeContainer` (role + accessible name). Verified by `verify:recorder` **CR5** (two `<nav>`s with
  distinct aria-labels → container-scoped unique locator, replay hits the footer link).
- **href scoping** — `buildCandidates` emits `tag[href="…"]` and `detectContainer` scopes links by href.
  Verified by new `verify:recorder` **CR7** (two same-text links, different hrefs → href-discriminated).
- Compound/container scoping for duplicates, candidate ranking/alternatives, uniqueness metadata,
  `buildRecordedFlow` preservation, and `LocatorFactory`/`StepExecutor` replay are all covered by the
  `verify:recorder-ambiguity` gate (points 1/2/3/3b) and `verify:recorder`.
- Note: the recorder-lab `landmark-twins` **fixture** (nav + a NESTED `<main>`) falls to a positional
  fallback because `getByRole('main')` is non-unique on the page; the landmark *behaviour* is verified
  by CR5's inline fixture, so this is a fixture-illustration weakness, not a code gap.

**`awkit-bw9` fixed (AWKIT-REC-032).** The tableRow container name came from `norm(row.textContent)`,
which concatenates adjacent cells with no separator (`"Customer BetaEdit"`); replay via
`getByRole('row',{name})` matches the space-joined platform accessible name (`"Customer Beta Edit"`) and
never resolved → timeout. Fixed with `rowAccessibleName` (join the row's direct-child cells with a
space, ARIA name-from-content; normalize whitespace). Card `hasText` scoping matches `textContent`
against `textContent` and was already self-consistent — deliberately unchanged. Verified by
`verify:recorder` **CR6** (capture → save/reload → fresh-page replay; whitespace/newline normalization;
partial-overlap row names; ARIA `role=row`; **old no-space name as a failing negative control**) and
`verify:recorder-ambiguity` **[3b]** (live customer-table row replay).

- Section-4 finding: a live capture with `quality.isUnique === false` is **not honestly reproducible**
  in a mock — the recorder's `structuralSelector` yields a unique positional for any resolvable DOM
  (CR4b made it serial-unique). The `needs-review` mapping stays verified at the `buildRecordedFlow`
  layer (`verify:recorder-ambiguity` point 4). See `KNOWN_ISSUES.md`.
- Verification (re-run this session): `npm run build` PASS; `typecheck:scripts` PASS; `verify:recorder`
  **135/135**; `verify:recorder-ambiguity` **58/58**; `verify:recorder-flow` **26/26**;
  `verify:recorder-hover` **34/34**; `verify:runner` **89/89**; `verify:mock-site` **99/99**;
  `verify:verifier-classification` reconciled; `verify:source-hygiene` **9/9**; `validate:offline` PASS;
  `verify:roadmap-dashboard` Sources agree. Comprehensive validation ledger unchanged: **62 PASS /
  3 NOT RUN / 1 BLOCKED**.

## Recorder ambiguity-resolution: Increment 7 — nine-point acceptance gate landed (2026-08-01)

Increment 7 (`awkit-aui.8`) is complete. New `verify:recorder-ambiguity` (registered in `package.json`,
`scripts/lib/verifier-classification.ts` as real-browser, and `docs/ai/COMMANDS.md`) is the durable
nine-point Recorder ambiguity/replayability gate. It drives the **real** responsible layers — records
duplicate/ambiguous/hover controls in bundled Chromium, then exercises `recorderInitScript` capture +
candidate/locator generation, `buildRecordedFlow`, `FlowValidator` preflight, `LocatorFactory` and
`StepExecutor`, plus plain-JSON/`structuredClone` round trips and the import re-validation contract.

- Nine points, each an independent, defect-sensitive check: (1) records the actual selected candidate;
  (2) attempts stable ancestor/context scoping first; (3) deterministic replay to the same candidate;
  (4) no-unique-locator → `needs-review`; (5) approved positional fallback executes only through the
  approved-fallback policy (unapproved refused; sensitive-step positional refused even when approved);
  (6) unresolved ambiguity fails preflight with **zero browser launches** (real launch counter + control);
  (7) resolved locator survives save/reload/edit/serialize/import-export/IPC/execution; (8) hover
  prerequisite captured + replays from a fresh page; (9) alternatives/quality/warning/uniqueness/
  resolution/approval/evidence survive round trips. Plus negative controls (unscoped 2-match refused,
  wrong-candidate rejected, hidden-surface hover fails, click-without-hover fails).
- **Result: 55/55.** Mutation-tested: breaking `buildRecordedFlow`'s `needs-review` default makes
  points 4 and 6 fail (needs-review lost → preflight passes → a browser launches), proving the suite is
  not vacuous.
- Mock-site `/recorder-lab` gained a `pos-twins` positional-approval fixture (two identical `.pos-btn`
  controls distinguished only by position; index reported via `pos-twin-result`).
- Tracked limitations recorded in `KNOWN_ISSUES.md` + `bd`: hover sibling/self-toggle (`awkit-vot`) and
  hover-inserted controls (`awkit-0vm`) residuals; a genuine table-row container-name replay gap found
  while building the gate (`awkit-bw9`, P2). Dependency-manifest audit opened as `awkit-hj8`.
- Verification (re-run this session): `npm run build` PASS; `typecheck:scripts` PASS;
  `verify:recorder-ambiguity` **55/55**; `verify:recorder-hover` **34/34**; `verify:recorder`
  **119/119**; `verify:recorder-flow` **26/26**; `verify:runner` **89/89**; `verify:mock-site`
  **99/99**; `verify:verifier-classification` reconciled; `verify:source-hygiene` **9/9**;
  `validate:offline` PASS; `verify:roadmap-dashboard` Sources agree. Comprehensive validation ledger
  unchanged by this increment: **62 PASS / 3 NOT RUN / 1 BLOCKED**.

## Recorder ambiguity-resolution: Increment 5 (Hover-Dependency Capture) repaired + replay-verified (2026-08-01)

Increment 5 (`awkit-aui.5`). **Correction:** the first cut shipped capture + flow-construction that
PASSED but deterministic **replay FAILED** — a re-review found the generated `hover` step targeted the
**hidden revealed surface** (`composedPath()[1]`, the dropdown) instead of the visible trigger, so a
fresh-page `locator.hover()` timed out and the click never became actionable. The green verifier only
asserted a selector substring, never replayed. Distinctions preserved: capture PASS, flow-construction
PASS, deterministic replay was FAIL → now FIXED. See `AWKIT-REC-031` in `DEFECTS.md`.

Repair:
- `"hover"` is a core `StepType` in `FlowProfile.ts`; `StepSafetyPolicy.ts` already classifies it
  (`UI_MUTATION_TYPES`) — it was **not** added by this increment (earlier claim corrected).
- `recorderInitScript.ts` now attributes the reveal to the element the pointer actually hovered: a
  trusted **pointer trail** (`pointerover`/`mouseover`/throttled `pointermove`), plus record-time
  first-seen (rest) visibility recorded for interactive elements **and their ancestor chain**. The new
  `resolveHoverTrigger` walks the click target's `composedPath()`, skips the contiguous run of
  hidden-at-rest ancestors (the revealed surface), and picks the first ancestor that was visible at
  rest, was on the pointer trail, is specific (not `html`/`body`/`main`, not a bare landmark), and
  resolves to a unique locator. No unconditional immediate-parent fallback; no speculative re-hovering.
- When a container was revealed on hover but no stable trigger can be attributed, the click is left
  `needs-review` (`hoverUnresolved`) rather than emitting a hover step that cannot replay. A target that
  toggles on its own (async self-reveal) produces no hover step.
- `buildRecordedFlow` injects the explicit `hover` step (carrying the trigger's full locator +
  alternatives + context, `resolution: "resolved"`) immediately before the click; `StepExecutor`
  runs `"hover"` as `locator.hover()` (an explicit node, visible in run logs/reports).
- `mock-site/public/recorder-lab.html` now has stable test ids for trigger / revealed surface /
  control / post-click result, plus async-reveal and no-stable-trigger fixtures.
- `verify:recorder-hover` was **registered in `package.json`** (previously classified + documented but
  not runnable) and rewritten to drive the real `StepExecutor` + `LocatorFactory`: it records, builds,
  and **replays Hover→Click on two fresh pages**, asserts the trigger identity, proves the old
  hidden-surface locator fails, and covers the async / repeated / fast / needs-review cases.
- Verification (re-run this session): `npm run build` PASS; `verify:recorder-hover` **34/34**;
  `verify:recorder` **119/119**; `verify:runner` **89/89** (see TASK_LOG for the full suite).
- Comprehensive validation ledger unchanged by this repair (verifier/docs work only, no ledger case
  added): **62 PASS / 3 NOT RUN / 1 BLOCKED**.

## Recorder ambiguity-resolution: Increments 3 & 4 (UI & Guard) completed (2026-08-01)

Increments 3 & 4 ( wkit-aui.3,  wkit-aui.4) are completed and merged to main.
- Built the ambiguity-resolution UI, allowing users to pause, view highlighted candidates, and select positional fallbacks or discard steps.
- Added a strict positional security guard in StepExecutor (guardLocatorQuality), which throws an error if an unapproved positional fallback is used, and absolutely blocks positional fallbacks on dangerousMutation steps (e.g. clicks or fills involving sensitive keywords like 'delete').
- The  erify-recorder-locator.mts suite was updated with tests for these guards.
- Full verification passed ( erify:recorder-locator.mts,  erify:runner,  erify:all-typecheck,  erify:roadmap-dashboard).
The validation ledger is unchanged at **62 PASS / 3 NOT RUN / 1 BLOCKED**; beads are **127 total / 4 outstanding / 118 closed**.

## Recorder ambiguity-resolution: Increment 2 (Capture Enrichment) completed (2026-08-01)

Increment 2 (`awkit-aui.2`) is completed and merged to `main`.
- `RecordedActionLocator` was enriched with `interaction` metadata (`path` tags, `x`/`y` coords, `matchIndex`).
- `recorderInitScript.ts` captures the DOM composed path, exact click coordinates, and leverages `landmark` (nav/main/etc.) and `href`-based semantic scoping inside `detectContainer` to resolve twins based on semantic regions instead of generic wrappers.
- `LocatorFactory` native fallback/recovery seamlessly supports these new strategies (`strategy: "css", value: 'a[href="..."]'` and `strategy: "css", value: "nav"`) without changes.
- The `mock-site/public/recorder-lab.html` was extended with a `nav-landmark` twins scenario, successfully tested in `verify-recorder-locator.mts` (which correctly generates a compound CSS selector or semantic container to disambiguate).
- Full verification passed (`verify:recorder-locator.mts`, `verify-recorder-flow.mts`, and `npm run verify:all-typecheck`).
The validation ledger is unchanged at **62 PASS / 3 NOT RUN / 1 BLOCKED**.

## Recorder ambiguity-resolution & replayability defect tracked (2026-07-31)

An open product defect is now tracked: **`AWKIT-REC-030`** — the Recorder can save an interactive
step whose locator it already recorded as non-unique (`quality.isUnique:false`), and the flow then
fails at replay, with no supported way to resolve it. Ambiguity is enforced **runtime-only**
(`StepExecutor`/`LocatorFactory`); there is **no preflight validation** (`FlowValidator` only checks
`missingRequiredLocator`) and **no ambiguity-resolution UX**. Corrected verdict: action capture /
quality detection / strict-mode protection = PASS, but **recorded-flow replayability = FAIL** and
**ambiguity-resolution UX + preflight = NOT IMPLEMENTED** — the Recorder is **not** an overall pass.

**Planned, not implemented** (no product code changed yet): plan at
`docs/recorder-ambiguity-resolution-plan.md`; `bd` epic `awkit-aui` with 7 dependency-ordered children
(`awkit-aui.1`…`.6`, `.8`). Inc1 (`awkit-aui.1`: resolution-state schema + round-trips + execution
preflight) is READY and blocks the rest. Details: `docs/testing/comprehensive-validation/DEFECTS.md`
and `docs/ai/HANDOFF.md`. The validation ledger is unchanged at **62 PASS / 3 NOT RUN / 1 BLOCKED**.

## Graphify code knowledge graph extended to all three agents (2026-07-30)

AWKIT now has a **second, complementary code graph** alongside the Codebase Memory MCP: Graphify
(`graphifyy` 0.9.31, CLI `graphify`), installed user-scoped via `uv` and wired into **all three
agents — Claude Code, Codex, and Antigravity (Google)**. Contract, coverage accounting and refresh
procedure: **`docs/ai/GRAPHIFY.md`**; the retrieval rule each agent follows is in its project
instruction file (`CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` respectively), and in the Antigravity
rule at `.agents/rules/graphify.md` (always-on) and skill at `.agents/skills/graphify/SKILL.md`.

**The graph is a retrieval accelerator, never an authority.** The order is: required-reading docs
first (they are **not** in the graph) → `graphify query/explain/path` before broad `Glob`/`Grep` →
`Read` the returned source files before editing or asserting anything → fall back to native search
whenever the graph is stale, incomplete or unsupported. Source code, tests, Git state and the
`docs/ai/` documents all outrank any graph edge.

**Current graph:** **11264 nodes, 22960 edges, 605 communities** over **985 source files** — 983 of
the 1141 tracked files. 99% `EXTRACTED` (22747) / 1% `INFERRED` (213), built **offline with 0 token
cost**, no API key. Refresh with `graphify update .` — **nothing refreshes it automatically**, and a
stale graph is silent. `graphify update .` is also the canonical *build*: driving the skill's
pipeline by hand without an LLM key yields a strictly smaller code-only graph (7817 nodes), because
`update` additionally runs a structural Markdown pass.

**Coverage gaps are recorded, not hidden** (`--allow-partial` was never used). All **158** tracked
files absent from the graph are accounted for. Markdown is indexed **structurally only** — headings,
links, containment; **no semantic/LLM extraction has been run** (it needs a Gemini key or ~13
subagents; the spend was not authorised, so it is not claimed). Not indexed at all: **`.css`** —
graphify has no support for it, so `app/renderer/styles/global.css` and the whole Hologram token
system are invisible — and **all 48 `mock-site/*.html` scenario pages**, which yield zero nodes.
**Use `Grep` for style-token and mock-site-scenario questions.** `.json` fixtures parse to zero
nodes. `graphify path` traverses an **undirected** graph, so a path shows connectivity, not call
direction.

**Zero exclusion leaks, verified.** A path scan of every `source_file` in `graph.json` confirms
nothing from `node_modules/`, `.beads/`, `logos/`, `vendor/`, build output or `graphify-out/` is
present, and that the three big logs, `package-lock.json`, the signing `.pem` and `.npmrc` are all
absent. No secret and no mutable user data entered the graph.

**Nothing existing was replaced or weakened.** The `graphify install --project` merge was additive:
the two new `PreToolUse` hook-guards sit beside the untouched `SessionStart` (`bd prime`) and `Stop`
(`check-memory.mjs`) hooks, and were verified to exit `0` silently with and without a graph present.
`--strict` was deliberately not used, because AWKIT's required-reading documents are not in the graph
and must be read first. **No git hooks and no file watcher were installed.** Beads, the roadmap
sources, the validation ledger, the verifiers and native search are unchanged.

**Production is untouched.** Graphify is a developer/AI tool: not an npm dependency, never imported
by app or runner code, and outside `electron-builder.json`'s packaging scope. The packaged app
depends on no Python, no `uv`, no network and no global install. `graphify-out/` is gitignored
(10 MB `graph.json`, local cost data, machine-specific absolute paths); `.graphifyignore` is tracked,
exactly as `.cbmignore` is.

Verified this task: `npm run build` clean, `git diff --check` clean, `verify:source-hygiene` 9/0,
`verify:security` 39/0, `verify:verifier-classification` reconciled, `verify:offline-supply-chain`
22/0, `verify:roadmap-dashboard` **135/135** with the live banner reading **"Sources agree"**. The
validation ledger is unchanged at **62 PASS / 3 NOT RUN / 1 BLOCKED**; beads are
**127 total / 4 outstanding / 118 closed** (`awkit-843` closed).

## Clean-machine 44 PASS / 0 FAIL; only section 3 unexecuted (2026-07-30, current)

Clean-machine validation now stands at **44 PASS / 0 FAIL**: sections 1, 2, 4, 5, 6, 7 and 8 in
full. Only **section 3** (manual offline-setup steps, subsumed by automated provisioning) is NOT
EXECUTED. Record: `docs/testing/CLEAN_MACHINE_VALIDATION_RESULTS_2026-07-29.md`.

**The migration ceremony (8.7-8.11) is proven end to end**: preview lists each schema change and
writes nothing (no `validation\backups` directory existed until apply); the backup is written first
and still holds the broken value while the live flow holds the fixed one; apply records
`beforeHash`/`afterHash`/`skipped: []` and leaves the pre-existing migration record untouched; undo
after a restart restores the flow **byte-for-byte** from the backup and keeps the backup; and undo
after a later edit is refused with a message naming the flow, the reason and the backup path.

**A real gap was found and fixed doing this** (`fa87fc8`): `validation:migrations` had **zero
renderer callers**, so the "Undo migration" affordance lived only in component state and did not
survive a restart - 8.10 was not executable against the shipped build at all. The designer now reads
the durable record on load. Because of that, **8.10 and 8.11 ran against a rebuilt portable
artifact** (`f442f2c3…`), hash-verified on the machine by §2's procedure; everything through 8.9
pertains to the earlier artifact. That also made 8.10's restart an *upgrade* - the migration record
and backup survived replacing the application itself.

**The five run-based checks (5.4, 5.8, 6.3, 8.1, 8.2) were executed on a SECOND VM.** The first VM
was permanently `fresh + consumed` and could never admit a run. The second was seeded with the
upgrade profile **before the app's first launch**, so `detectInstallationKind()` classified it
`upgraded` and opened the 14-day migration grace - which admitted runs with no licence present. That
is the owner-decided upgrade-grace path exercised on a real clean machine, as itself, with nothing
minted.

What the five checks establish: a granted off-path-only flow **runs**, and the grant records it
(`runsUnderCompatibility` 0 -> 1, `lastRunAt` 14 ms before the run's own start stamp); an
active-path-broken flow is **refused** with a specific message naming the step, and produces no
grant, no report and no instance; a hard-kill with a run in flight leaves no stranded Chromium and
resurfaces on relaunch as `orphaned` + *"safe to re-run"* with the full recovery panel; and saving an
active-path-invalid flow yields a **Draft** that is still not runnable, with the defect untouched.

**Observability gap, not a defect:** run reports carry no Legacy Compatibility attribution. 5.4's
attribution lives only on the grant record (`recordRunUnderCompatibility`), so an operator reading a
run report cannot tell the run only executed because of a compatibility grant.

**The whole Legacy Compatibility lifecycle is now evidenced on a clean offline machine.** A
pre-hardening FNV-era grant is retired (`digestFormatRetired`) and never re-granted; a newly eligible
off-path-only flow receives a `sha256:`-bound grant with a 30-day deadline and a dashed
**Legacy - until …** pill; the grant survives a full restart byte-identically; a description-only edit
retains it; an executable edit voids it (flow blocks, pill gone); and re-scanning extends no deadline,
revives no retired record and creates no duplicate grant files.

**Precise input finally worked by clicking from INSIDE the guest** - `SetCursorPos` + `mouse_event`
via user32, run as the logged-on standard user through a scheduled task (`vm-guest-click.ps1`).
Hyper-V's `Msvm_SyntheticMouse` is unusable here: it accepts `SetAbsolutePosition`, reports success,
and never moves the pointer, so the following `ClickButton` fires wherever the real cursor sits.
Opening a VMConnect console did not change that. Nothing is installed in the guest - PowerShell and
user32 are part of Windows - so constraints 1.2-1.4 still hold.

**A near-miss worth keeping.** After the executable edit the grant file still held the OLD hash with
no revocation stamp, which looked like a serious defect. It is not: `evaluateGrant` returns the
standing `edited` whenever `contentHash !== currentDigest`, so the standing is DERIVED live rather
than persisted, and the user-visible result (flow blocks, pill gone) is correct. Checking the UI
before writing it up is what caught this.

**The migration-grace anti-tamper property was demonstrated independently.** The VM's grace anchor
still reads `installationKind: "fresh", consumed: true` from the section 4 run, and it survived every
wipe of the per-user profile because the per-profile-namespaced `%PROGRAMDATA%` mirror restored it.
Deleting the per-user copy did not reopen the window. The side effect: this VM is permanently
`fresh + consumed`, so it gets no grace, is unlicensed, and every run is licence-blocked - which is
precisely why 5.4, 5.8, 6.3, 8.1 and 8.2 cannot be executed here.

The validation ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**; beads are
**120 total / 6 outstanding / 114 closed**.

## Clean-machine 26 PASS / 0 FAIL; FNV grant retirement proven on a clean machine (2026-07-29, current)

Clean-machine validation now stands at **26 PASS / 0 FAIL**: sections 1, 2, 4 and 7 in full, plus
**5.1-5.3**, **6.1-6.2** and **8.12**. Sections 3, 5.4-5.9, 6.3 and 8.1-8.11 remain **NOT EXECUTED**.
Record: `docs/testing/CLEAN_MACHINE_VALIDATION_RESULTS_2026-07-29.md`.

**New product capability.** `validation:runInventoryScan` had been permission-gated since the
validation subsystem shipped but had **no caller anywhere** - the scan only ever happened as a side
effect of a workflow run, so an operator on an upgraded install could not refresh Legacy
Compatibility classification, and runbook 5.9 ("re-run the inventory scan") was not performable. A
**Re-scan Library** action now carries the same `WORKFLOW_EDIT` permission the handler already
enforces. This makes an already-gated capability reachable; it does not add a bypass. An
unauthenticated CLI trigger was considered and rejected - the scan issues grants that let otherwise
blocked flows run, so that would have been a real privilege hole.

**Proven on the clean offline machine:** the seeded pre-hardening (FNV-era) grant is **retired, not
honoured, and not re-granted** - the grant file now carries `revokedReason: "digestFormatRetired"`
and the scan record reads `grantsRetiredLegacyDigest: 1`, `grantsIssued: 0`,
`digestAlgorithm: "sha256"`. The Flow Library shows real per-flow status across all 24 seeded flows
(**Runnable** vs **Not runnable**).

**Two fixture defects, both caught by the product.** A `goto` node needs `url` AND a `valueSource`;
`config.url` alone fails the step-requirements contract with `missingRequiredValue` on the active
path - the same contract behind defect `HARNESS-004`. And an "off-path only" flow's detached node
must be valid in itself, or the flow is blocked rather than off-path-only and no grant can ever
issue. Both fixed in the seeder.

**Why it stopped short.** Reaching the Re-scan action costs a screenshot round-trip per Tab and the
count is unstable - the table scrolls as focus moves, each row has ~4 focusables, and the sidebar
length varies with the principal's permissions. Pointer input is not usable on this host:
`Msvm_SyntheticMouse` reports success but clicks do not land where the coordinates say, because
Hyper-V's absolute pointer needs an active console session a headless driver does not have. The scan
was fired once successfully; repeating it needs a stable focus anchor or working pointer input.

The validation ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**; beads are
**120 total / 6 outstanding / 114 closed**.

## Clean-machine sections 5/6 attempted; grant lifecycle remains unexecuted (2026-07-29, current)

Clean-machine validation now stands at **23 PASS / 0 FAIL**: sections 1, 2, 4 and 7 in full, plus
**5.1** (seeded upgrade library appears) and **6.1-6.2** (no install/no admin; offline throughout).
Sections 3, 8, 5.2-5.9 and 6.3 remain **NOT EXECUTED**. Record:
`docs/testing/CLEAN_MACHINE_VALIDATION_RESULTS_2026-07-29.md`.

The section 5 upgrade profile was seeded before first launch exactly as 5.1 requires - 24 flows (20
valid, 2 off-path-only, 1 active-path-broken, 1 fixable), 24 workflows, the pre-hardening FNV-era
grant, and a historical migration record - and the app loaded all 24 workflows on a clean offline
machine.

**Why the rest is not executed, precisely.** `ensureInventoryScan()` has exactly one caller,
`execution.ipc.ts` during a run request. Launching the app does not trigger it and the renderer never
calls `validation:runInventoryScan`, so every remaining section 5 check and the grant-related section
8 checks sit behind starting a real run in the UI. Measured at the end: `inventory-scans\` holds 0
records and the seeded FNV grant is present and unrevoked - consistent with no scan. Nothing about
grant retirement is claimed in either direction.

UI is driven from the host with synthetic keyboard plus console screenshots, deliberately: a
UI-automation harness inside the guest needs Node and would violate constraints 1.2-1.4. That loop
demonstrably works - it completed first-run setup, sign-in and nav traversal - but reaching a Run
control means walking a long scrolling sidebar one Tab per screenshot round-trip, and it was not
completed. A driver limitation, not a product finding.

**A genuine product positive, observed by accident at 24-file scale.** The first seed wrote JSON with
`Set-Content -Encoding utf8`, which in PowerShell 5.1 emits a UTF-8 BOM that Node's `JSON.parse`
rejects. The application moved all 24 affected workflows to `<name>.json.corrupt-<timestamp>` and
logged the parse error rather than deleting them or failing the page
(`ProfileStore.quarantineCorrupt`). User data survived a malformed-profile encounter intact. The BOM
trap was self-inflicted and is already documented in `generate-dependency-manifest.ps1`; the seeder
now writes BOM-free UTF-8 and clears stale quarantine.

The validation ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**; beads are
**120 total / 6 outstanding / 114 closed**.

## Clean-machine validation EXECUTED for the first time (2026-07-29, current)

The offline clean-machine gate has never been executed in this project's history. It now has been,
partially: **20 PASS / 0 FAIL across sections 1, 2, 4 and 7**, with sections 3, 5, 6 and 8 **not
executed**. Full record: `docs/testing/CLEAN_MACHINE_VALIDATION_RESULTS_2026-07-29.md`.

This does **not** mark the runbook as PASSED, and it does not change the 2026-07-24 owner policy that
makes clean-machine validation optional and non-blocking. It replaces "never executed" with
"partially executed, no failures".

**What was proved.** A purpose-built Hyper-V VM running **Windows 11 Pro 10.0.26100 x64** with **no
network adapter at all**, no source tree, no Node on PATH, no pre-existing profile, and a **standard
non-administrator** auto-logged-on account:

- the **portable** artifact launches, stays up as `awkituser` (not elevated), creates its 21-folder
  runtime profile under LocalAppData, and renders the first-run setup UI with **no SmartScreen
  blocking prompt**;
- the **NSIS installer** installs per-user with **zero UAC prompts**, the installed build launches
  and shows its branded splash, and uninstall removes the installation cleanly;
- both artifacts' SHA-256 hashes verify **on the test machine**, delivered on read-only media.

New tooling under `scripts/clean-machine/` makes this repeatable: unattended VM provisioning, a
read-only artifact DVD, and a runbook driver. Evidence capture is host-side
(`Msvm_VirtualSystemManagementService` thumbnails) precisely so that **nothing is installed in the
guest to observe it** — an agent would have contaminated the cleanliness under test.

**Two recorded deviations.** The VM is Hyper-V **Generation 1**, so no UEFI/Secure Boot/TPM, and
Windows Setup's hardware gate was relaxed with `LabConfig` keys. Hyper-V's Gen 2 UEFI firmware
refuses this ISO's boot loader with Secure Boot on *and* off, with the ISO local and uncontended,
while the same ISO boots its BIOS entry first time and is provably sound (valid FAT12 UEFI image,
correct `0x55AA`). Neither deviation touches constraints 1.2-1.8 or anything an offline Electron app
depends on.

**A release-blocking defect was fixed to get here.** Offline packaging had been impossible from a
clean checkout since `4526244`: the dependency manifest was signed over CRLF bytes while
`.gitattributes` stores `*.json` as LF, so the committed manifest never matched its own signature and
`validate-offline-bundle.ps1` refused before the build. The runbook's recorded artifact hashes were
also stale by a week, which would have manufactured a false FAIL at section 2 — and by the runbook's
own blocking matrix a FAILED clean-machine run blocks release promotion. Both fixed; both artifacts
rebuilt from one clean tree.

The validation ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**; beads are
**119 total / 5 outstanding / 114 closed**.

## Packaged licensing gates built AND executed; offline packaging unblocked (2026-07-29, current)

`awkit-1cc` is complete. The packaged half that was outstanding this morning is built and has now
been **run for real** against a freshly packaged build on this machine.

`verify:packaged-walkthrough` no longer needs an exemption. It licenses the machine the way an
administrator would: reads the fingerprint through the app's own licensing IPC, mints a short-lived
license with the EXTERNAL issuer (spawned outside the packaged app, key path on argv only), imports
it through the administrator IPC, runs the four workflows to genuine `completed`, then removes the
license and confirms the machine is blocked again. Admission is asserted to be attributable to the
license, never to migration grace — the walkthrough checks `inGrace === false` on its own profile for
exactly that reason.

New `verify:packaged-licensing` covers the negative matrix in the packaged build, where no bypass
exists: `NOT_ACTIVATED`, `INVALID_SIGNATURE` and `CORRUPTED` need no key; `EXPIRED` and
`MACHINE_MISMATCH` need a real signature (the validator checks the signature before the fingerprint
and before expiry, so an unsigned attempt would collapse into `INVALID_SIGNATURE` and the matrix
would silently test one state three times). It also carries the deterministic migration-grace
scenario on its own pre-seeded upgraded profile.

**Measured, not asserted:**

| gate | with the issuer key | without it |
|---|---|---|
| `verify:packaged-walkthrough` | **86 PASS / 0 FAIL** | 25 PASS / 0 FAIL / **1 BLOCKED** |
| `verify:packaged-licensing` | **33 PASS / 0 FAIL** | 24 PASS / 0 FAIL / **2 BLOCKED** |

The BLOCKED path is real rather than theoretical: the issuer key IS present at its default location
on this machine, and both gates still refused to use it without `AWKIT_PACKAGED_LICENSE_ISSUER_KEY`
set explicitly. Presence of a key is not authorization, and neither gate ever skips or passes when it
cannot license.

**Two defects found by running it, both fixed.**

1. **Offline packaging had been impossible from a clean checkout since `4526244`.** `.gitattributes`
   declares `*.json text eol=lf`, but `generate-dependency-manifest.ps1` wrote CRLF and signed those
   bytes — so every regenerated manifest was valid locally and broken the moment it round-tripped
   through a commit. `validate-offline-bundle.ps1` runs before the build and refused on the
   mismatch, which is why `dist/win-unpacked` was stale. The generator now normalises to LF before
   signing, and the manifest/signature paths are pinned in `.gitattributes` so git never rewrites
   bytes a signature covers. Verified against the stored blob: committed bytes now hash to exactly
   what the signature records.
2. **The negative matrix would have been worthless.** Its fixture builder hashed `JSON.stringify`
   while the store checksums `stableStringify`, so every hand-written envelope loaded as `CORRUPTED`
   and three of five cases would have "passed" while testing one state repeatedly. It now calls the
   production `buildEnvelope`, so the drift cannot recur. Caught by probing before running, not by
   the suite going green.

The validation ledger remains **62 PASS / 3 NOT RUN / 1 BLOCKED**; beads are
**119 total / 5 outstanding / 114 closed**.

**Still outstanding and unchanged:** the clean/offline Windows VM walkthrough remains a separate
human gate and is NOT claimed by any of this — every number above was measured on the developer
machine.

## Three owner decisions implemented: licensing enforced, Test Lab CLI-only, secret-store seam (2026-07-29, current)

The owner decided all three items that were blocked on a product call, and all three are built.

**Licensing is enforced by default** (`awkit-1cc`). `SPECTER_LICENSE_ENFORCE` is gone as a production
opt-in. `RunGatePolicy` now carries the whole decision table: `VALID`/`EXPIRING_SOON` admit;
`NOT_ACTIVATED` and `EXPIRED` block new runs but let in-flight work finish; the seven integrity
states additionally cancel work that has not started executing (new
`ExecutionEngine.cancelPendingInstances`, deliberately narrower than `stopAll`); and a licensing
evaluation fault now fails CLOSED where it previously failed open. An installation that already held
user data before its first enforcing launch gets one **14-day** migration window; a fresh install gets
none. **A packaged build has no bypass at all** — `app.isPackaged` is consulted first and is not
env-overridable.

**The Randomized Test Lab is CLI-only by architectural decision** (`awkit-wza.8`). Phase 7 closes as a
recorded decision, not an unbuilt feature. The boundary was already true but nothing kept it true;
`verify:test-lab-cli-only` now proves no `app/**` module imports the harness, no production bundle
contains its symbols, and no route registration file declares a Test Lab surface.

**The Secrets card's unavailable-keystore state is a dependency seam, not a test hook**
(`awkit-8ri` / SET-013). An env-gated override in `secretStore.ts` was rejected as a runtime security
bypass in a shipped path. Production composes `ElectronSecretStorageCapability`; a separate test
composition root built only to `out/test-main/` (excluded from packaging) composes an unavailable one.
`configureSecretStorageCapability` throws in a packaged build, so the substitution is structurally
impossible in a shipped application.

**Two defects found on the way, both fixed.** The migration-grace mirror under `%PROGRAMDATA%` was
initially a single shared filename, which let one profile's classification decide for every user on
the machine (`fresh` wins a merge) — it is now namespaced per profile by a hash of the profile root.
And `verify:random-lifecycle` had been **10/3 since RBAC v2 (`316eff3`)**: the campaign's fake
`SecurityStore`, cast through `unknown`, never grew `listCustomRoles`/`getUserPermissionOverrides`, so
a TypeError surfaced as an "UNKNOWN" authorization denial and the suite failed for a harness reason
while looking like a product failure. Back to 13/13.

Verification run: `verify:licensing` **147/147** (was 56; mutation-tested both ways),
`verify:e2e-licensing` **38/38** real Electron across three launches, `verify:secret-storage-seam`
**30/30** real Electron A/B, `verify:test-lab-cli-only` **24/24** (mutation-tested),
`verify:runner` **89/89**, `verify:reports-live-engine` **21/21**, `verify:random-lifecycle` **13/13**,
`verify:authz` **77/77**, `verify:secrets` **16/16**, `verify:ipc-contract` **4/4**,
`verify:verifier-classification` reconciled (150 → **152**), `npm run build` and `typecheck:scripts`
PASS.

SET-013 moves `NOT RUN` → `PASS`, so the validation ledger is now
**62 PASS / 3 NOT RUN / 1 BLOCKED**; beads are **119 total / 6 outstanding / 113 closed**
(SET-015 carved out of the closed `awkit-8ri` into its own bead `awkit-hlp` so it could not vanish
into a close reason).

**Not done, and outstanding.** `verify:packaged-walkthrough` still runs four real `dryRun:false`
workflows in a PACKAGED build, where the test bypass is inert by design. Per the owner's instruction
it must mint a short-lived, fingerprint-bound license through the external issuer at test time,
import it via the real IPC, run, then remove it and confirm the state returns to blocked — and report
BLOCKED, never skip or pass, when the issuer key is absent. That path is **not built**, so the
packaged walkthrough would currently fail at its first real run. The packaged negative-case suite
(`NOT_ACTIVATED`/`EXPIRED`/`INVALID`/`MISMATCH`/`CORRUPTED`) and the deterministic packaged
upgrade-grace scenario are also not built. Tracked on `awkit-1cc`.

## No locally actionable tracker work remains; Oracle live-mode harness gap is fixed (2026-07-29, current)

All **8 outstanding** beads are now truthfully `blocked`; `bd ready` returns no items. Five were
previously open despite explicitly requiring owner decisions or external/manual execution:
licensing enforcement (`awkit-1cc`), Settings OS/secure-storage GUI evidence (`awkit-8ri`), Reports
OS launches (`awkit-az7`), external Oracle release gates (`awkit-cm8`), and the Test Lab production
UI decision (`awkit-wza.8`, with parent epic `awkit-wza`). The other two external gates remain
real-IdP handoff (`awkit-cey`) and live Oracle workflow evidence (`awkit-7bu`).

The actionable part hidden inside blocked `awkit-7bu` is complete:
`verify-oracle-mock-ui-workflow.mts` now selects an explicit real mode only when the complete
`AWKIT_ORACLE_LIVE_*` set and non-production confirmation are present. It then uses the Settings
Java/driver selections, requires the real JDBC bridge, and runs the same persisted Data Source,
flow, workflow, `OracleQueryService`, production `ExecutionEngine`, and Chromium campaign. Partial
or invalid live configuration fails closed with no mock fallback; the password is redacted from
all evidence. Default database-free evidence remains **7 PASS / 0 FAIL / 1 BLOCKED**. A dummy
local-only live request produced the expected real-mode failure with no password persisted.

`awkit-7bu` remains blocked solely on an authorized operator provisioning the fixture and supplying,
rotating, then locking the ephemeral reader credential. The validation ledger remains
**61 PASS / 4 NOT RUN / 1 BLOCKED**; beads remain **118 total / 8 outstanding / 110 closed**.

## Active Directory authentication provider is complete (2026-07-29, current)

`awkit-i3e` is closed. `ActiveDirectoryProvider` now performs direct user binds through the pinned
`ldapts` client over certificate-validated LDAPS or LDAP upgraded with StartTLS. It is disabled by
default and produces zero directory traffic unless complete trusted main-process configuration is
present. AD identities must match pre-provisioned AWKIT users, preserving local roles, custom roles,
and direct overrides without automatic account creation or group-driven privilege changes.

Security-store migration v5 records the provider on each session. AD sessions reauthenticate
sensitive operations through AD, never persist the domain password, never replace the local fallback
hash, and do not enter the local forced-password-change screen. Directory outages return a safe
provider-unavailable result with Virtual User sign-in retained as the offline fallback. The login UI
now selects any enabled provider and truthfully labels disabled AD as `Not configured`.

Verification: auth **79/79** (injected LDAPS/StartTLS transport, zero-egress, mapping, outage, password
isolation, session/reauth); real Electron auth GUI **25/25**; real Electron authentication lifecycle
**30/30**; authz **77/77**; IPC contract **4/4**; build, script typecheck, and offline validation PASS.
A live enterprise AD/DC was not available, so real certificate/domain-policy interoperability remains
an environment validation rather than a code-path claim. The validation ledger remains
**61 PASS / 4 NOT RUN / 1 BLOCKED**; beads are **118 total / 8 outstanding / 110 closed**.

## RBAC v2 custom roles and direct overrides are complete (2026-07-29, current)

`awkit-gsf` is closed. Security-store migration v4 adds persisted custom roles, role-permission maps,
and per-user grant/deny overrides. `effectivePermissions` unions built-in and custom-role grants,
applies direct grants, then applies direct denies with final precedence. Unknown role/permission ids
remain deny-by-default, while the protected Super User always retains the full registry.

Custom-role create/update/delete and user override changes are sender-bound, permission-checked,
fresh-reauth gated, audited, and schema validated. Permission changes take effect in the trusted
`AuthorizationService` immediately and revoke affected sessions; deleting a role removes its user
assignments. Built-in roles remain immutable. The Roles UI supports custom-role CRUD, the Permissions
matrix includes custom roles, and the Users access editor supports Inherit/Grant/Deny overrides with
Escape, focus trapping, and focus return.

Verification: authz **77/77**; real Electron admin GUI **18/18**; real Electron RBAC **51/51**; auth
**64/64**; IPC contract **4/4**; build and script typecheck PASS. The validation ledger remains
**61 PASS / 4 NOT RUN / 1 BLOCKED**; beads are **118 total / 9 outstanding / 109 closed**.

## Super User one-time recovery is complete (2026-07-29, current)

`awkit-aty` is closed. First-run Super User provisioning generates a 128-bit, ambiguity-free
recovery code and blocks entry to the protected shell until the user confirms it was saved. The
plaintext code is shown only in transient renderer state; the security store retains only its
scrypt hash inside the existing DPAPI-backed column wrapper.

The login screen now offers a pre-auth recovery form. A valid unused code and policy-compliant new
password atomically rotate the protected Super User credential, clear lockout state, consume the
code, and revoke every existing Super User session. Invalid, policy-rejected, successful, and reused
attempts are audited; responses remain enumeration-safe. Schema migration v3 adds the protected
recovery fields without changing the preload API identifier or the offline trust boundary.

Verification: auth **64/64**; real Electron auth GUI **25/25**; real Electron authentication
lifecycle **30/30**; authz **59/59**; session context **11/11**; security **39/39**; IPC contract
**4/4**; build and script typecheck PASS. The validation ledger remains
**61 PASS / 4 NOT RUN / 1 BLOCKED**; beads are **118 total / 10 outstanding / 108 closed**.

## Global license attention and background revalidation are complete (2026-07-29, current)

`awkit-x13` is closed. For principals with `license.view`, the global status bar reads the trusted
licensing API and renders a compact button only when the installation needs attention. `VALID`
stays silent; not-activated/expiring/not-yet-valid states use warning tone, while expired,
signature, machine, revoked, corrupted, clock, and unsupported states use danger tone. The button
opens Administration → Licensing and exposes the trusted action text through its title/accessible
name.

The status refreshes every 15 minutes and immediately when the app regains focus or visibility.
Calls remain sender-bound and permission-checked; users without licensing permission make no
licensing status request. The Electron licensing verifier now seeds only its isolated profile and
no longer rewrites tracked mock fixtures.

Verification: licensing **62/62**; real Electron e2e licensing **23/23** in enforcement-off and
enforcement-on modes; build and script typecheck PASS. The validation ledger remains
**61 PASS / 4 NOT RUN / 1 BLOCKED**; beads are **118 total / 11 outstanding / 107 closed**.

## Signed machine-licensing tracker reconciliation is complete (2026-07-29, current)

`awkit-s05` is closed as an already-delivered tracker item. The repository contains the complete
signed per-machine licensing boundary: multi-signal hashed fingerprinting, Ed25519 verification
with issuer-only private keys, activation-request export, import/replace/revoke, tamper and
clock-rollback detection, adaptive storage, Super-User RBAC/reauth/audit, and the trusted run gate.
No duplicate implementation was added.

Fresh verification: licensing domain/RBAC **56/56** and real Electron licensing GUI/run-gate
behavior **22/22**. The validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**; beads are
**118 total / 12 outstanding / 106 closed**.

## Randomized Test Lab Phase 8 lifecycle campaigns are complete (2026-07-29, current)

`awkit-wza.9` is closed. `LifecycleCampaign` deterministically covers all **176** auth-state ×
authorization-expectation × license-status × enforcement-mode cells. Each cell uses a seeded,
randomized built-in-role subset and permission while preserving complete matrix coverage. Unknown
roles are injected in a bounded subset to exercise deny-by-default behavior.

Campaign evaluation drives the real `AuthorizationService.requirePermission()` boundary with
in-memory store/session adapters. The Electron execution gate now delegates its unchanged
allow/block rule to the framework-agnostic `applyLicenseRunGatePolicy()`, which the campaign drives
directly. Authentication failure, authorization denial, or enforced non-operable licensing each
fail the combined decision closed; advisory licensing remains non-blocking.

Verification: `verify:random-lifecycle` **13/13** over 176 scenarios; auth **49/49**; authz
**59/59**; licensing **56/56**; session context **11/11**; script typecheck PASS; verifier
classification **150/150**. The validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**;
beads are **118 total / 13 outstanding / 105 closed**.

## Randomized Test Lab Phase 6 reporting is complete (2026-07-29, current)

`awkit-wza.7` is closed. `RandomTestRunner` now returns the chronological raw engine capacity
snapshots observed during each run. `CampaignReportWriter` accepts individual run results—not
pre-aggregated summaries—and writes versioned JSON plus human-readable Markdown under unique
non-overwriting `reports/random-tests/campaigns/` directories.

Reports preserve raw duration samples and compute nearest-rank P50/P90/P95/P99 directly from them;
peak browsers, contexts, pages, flows, queue depth, and process RSS come from raw capacity samples.
Coverage is grouped by dimension/key with blocked reasons intact. Outcomes, failure categories,
signatures, and deduplicated reproduction commands remain explicit. A secret canary aborts before
the report directory is allocated.

Every non-completed or invariant-failing run must have execution-linked failure metadata and a
reproduction command; contradictory reports are rejected before persistence.

Verification: `verify:random-reporting` **13/13**; `typecheck:scripts` PASS. The validation ledger
remains **61 PASS / 4 NOT RUN / 1 BLOCKED**; beads are
**118 total / 14 outstanding / 104 closed**. Phase 7 (`awkit-wza.8`) is now dependency-ready.

## Randomized Test Lab Phase 5 is complete (2026-07-29, current)

`awkit-wza.6` is closed. `RandomTestRunner` drives generated workflows through the real
`ExecutionEngine`, intersects the workflow request with `planCapacity()` and the live
`getCapacitySnapshot()` ceilings, and polls execution-scoped instances to a bounded deadline.
Because `startRun()` returns after dispatch begins, it is never treated as completion. A deadline
produces the lab-owned `labTimeout` outcome and cancels active product instances; no nonexistent
`timedOut` product status was added.

`RuntimeInvariantChecker` evaluates only persisted/observable evidence: product terminal states,
exclusive outcomes, dependency order, isolated `waitAll` coverage, loop bounds, cancellation
settlement, browser resources returning to the measured baseline, one report record per instance,
report-total parity, and secret-canary absence. The real live gate generates a linear topology and
an `isolatedPage`/`waitAll` topology, runs both in bundled Chromium against the existing local Mock
Site, and also uses a never-terminal engine double to prove the timeout boundary.
Live preparation re-enforces the authorized-host allowlist before dispatch, materializes the
documented upload fixture inside the campaign runtime root, rewrites only the execution clone, and
leaves the deterministic generated originals unchanged.

Verification: `verify:random-live` **14/14 real browser + safety contracts**; `verify:runner` **89/89**;
`verify:mock-site` **99/99**; `typecheck:scripts` PASS; verifier classification **148/148**.
The validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**; beads are
**118 total / 15 outstanding / 103 closed**. Test Lab Phases 6 and 8 are now dependency-ready.

## Randomized Test Lab Phase 4 is complete (2026-07-29, current)

`awkit-wza.5` is closed. Randomized failures now produce unique, immutable bundles under
`reports/random-tests/failures/` with the seed, generator version, original flow/workflow
definitions, resolved constraints, coverage snapshot, non-identifying machine capacity, stable
failure category/signature, and a quoted reproduction command. The writer refuses resolved secret
values and sensitive URL query parameters before any file is created; opaque `secretName`
references remain supported.

`FailureReproducer` rejects schema or generator-version drift and reports success only when the same
failure category and, when recorded, the same signature recur. `Shrinker` deep-clones the stored
definitions and accepts only strictly smaller candidates that retain that identity, in the required
order: unrelated flows, branches, nonessential nodes, concurrency, then loop bounds.

The Windows-safe CLI is available as `test:random`, `test:random:smoke`,
`test:random:generator`, `test:random:oracle`, `test:random:roundtrip`, and
`test:random:reproduce`; `verify:random-failures` is classified as an integration verifier.
Verification: failure infrastructure **17/17**, smoke **2 workflows / 4 flows**, full campaign
**25 workflows / 59 flows**, generator **49/49**, oracle **27/27**, round-trip **26/26**, script
typecheck PASS, verifier classification **147/147**. Phase 5 (`awkit-wza.6`) is now dependency-ready.
The validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**; beads are
**118 total / 16 outstanding / 102 closed**.

## Stream diagnostics and async polling are closed (2026-07-28, current)

`awkit-4km` is closed. Its earlier `apiPolling` condition already covered page-owned
`202 Accepted` polling through a bounded terminal status or JSON field. The remaining slice adds the
canonical `streamActivity` condition for WebSocket/SSE lifecycle observation. It arms before the
action but is deliberately non-gating: a required UI outcome remains the primary completion proof,
and a stream-only configuration is classified incomplete.

`NetworkDiagnosticsObserver` uses Playwright page events across browser engines and attempts a
Chromium CDP session for sanitized request IDs, timings, and redirect chains. CDP attachment is
capability-checked and fail-open to the Playwright-only path. Diagnostics retain only origin + path
and bounded numeric/opaque metadata; query strings, headers, bodies, and stream frame payloads are
never stored or logged. The Flow Designer labels the condition diagnostic-only and persists its
transport/event/matcher settings. The Feature Test Lab exposes a finite local SSE scenario at
`/async-results` + `/api/events`.

Verification: `verify:waits` **72/72** · `verify:flow-designer` **60/60 real Electron** ·
`verify:flow-step-mapping` **103/103** · `verify:async-review` **23/23** ·
`verify:mock-site` **99/99** · `typecheck:scripts` PASS. The validation ledger remains
**61 PASS / 4 NOT RUN / 1 BLOCKED**; beads are **118 total / 17 outstanding / 101 closed**.

## Grouped async completion is closed with real GUI evidence (2026-07-28, current)

`awkit-y24` is closed. A required `anyOf` wait expresses `A AND (B OR C)` under the existing
`allRequired` completion policy, so an API success cannot override a missing UI outcome. The real
Flow Designer now has measured evidence for GUI check 11.3: it configured and saved
`response(/api/results) AND (tableHasRows(#resultsTable) OR textVisible(empty state))`, and the
persisted flow retained the nested shape without flattening.

The closure audit found and fixed one edge case: an empty required OR-group used to pass vacuously.
It now fails closed and tells the user to add a completion branch. Runtime truth-table coverage proves
rows and empty-state alternatives pass, while neither outcome and an empty group fail.

Verification: `verify:flow-designer` **58/58 real Electron** · `verify:waits` **58/0** ·
`verify:flow-step-mapping` **102/0** · `verify:async-review` 21/0 · `verify:runner` 89/0 ·
`verify:mock-site` 96/96 · `verify:all-typecheck` PASS. Screenshot:
`test-artifacts/grouped-wait-gui/awkit-y24-configured.png`. The validation ledger remains
**61 PASS / 4 NOT RUN / 1 BLOCKED**; beads are **118 total / 17 outstanding / 101 closed**.

## Offline packaging inputs are pinned, signed, and clean-clone reproducible (2026-07-28, current)

`awkit-epz` is closed. Playwright is pinned to `1.61.0`; the approved Windows x64 Chrome for
Testing payload is `149.0.7827.55` / revision `1228`. The exact archive URL, size, SHA-256,
`chrome.exe` SHA-256, and deterministic 308-file tree digest live in
`resources/offline-browser-policy.json`.

Packaging now fails before or during the build if the pinned dependencies, archive, staged
resources/vendor trees, signed dependency manifest, or production startup payload are invalid.
`resources/dependency-manifest.json` has a detached Ed25519 signature; production startup verifies
the signature, approval policy, and browser executable before opening the app. There is no runtime
download fallback and no floating `npx playwright install`.

Two developer-machine portable builds and a fresh local clone built from commit `09a6044`, using
`npm ci` plus the approved offline archive, passed strict validation and produced semantically
equivalent decompressed payloads: **571 entries, 0 differences** after excluding only the generated
manifest/signature and normalizing Zvec's documented `builtAt` field. The current portable artifact
is about **202.8 MiB**; the redundant packaged `vendor/browsers` mirror is excluded. Whole-EXE hashes
remain artifact identifiers, not reproducible-build proof.

Verification: `verify:offline-supply-chain` **22/0** · `validate:offline -Strict` PASS ·
`package:portable` PASS in the primary checkout and fresh clone · clean-clone semantic comparison
**571/571 equivalent** · tampered archive rejected before extraction · deterministic Oracle bridge
hash stable across two builds · `verify:all-typecheck` PASS. The validation ledger remains
**61 PASS / 4 NOT RUN / 1 BLOCKED**; beads are **118 total / 17 outstanding / 101 closed**.
Clean-machine execution remains **NOT EXECUTED / owner-waived non-blocking**; these are
developer-machine and clean-checkout packaging results, not clean-machine GUI evidence.

## Zvec Phase 2 tranche 4 — incremental indexing; the subsystem is feature-complete (2026-07-28, current)

`awkit-thg`. Search results are no longer only as fresh as the last manual rebuild: each run is
indexed as it finishes.

**`ExecutionEngine` gained its first observer**, injected exactly like `setSecretResolver` /
`setOracleNodeRunner` so `src/` still never imports Electron. It fires in the `finally` block right
after `upsertRun` — the run is finalized there and every field exists — and for **every** terminal
state including cancellation, since a cancelled run is still worth finding, merely not a failure.

**The §14.3 guarantee lives in `src/runner/RunCompletionObserver.ts`, not in the engine.**
`ExecutionEngine.ts` transitively imports Electron through `app/main/appPaths`, so nothing in it can
be exercised by a `tsx` verifier — and "an indexing fault must never propagate into workflow
execution" is precisely the rule that must not rest on a comment. The guard is a pure function a
verifier drives directly, and a source scan asserts the engine calls through it. That scan earned its
place: mutating the engine to call the observer directly was caught, but the first version of the
scan missed the `?.()` form, which is how anyone would actually write the bypass.

**Locator freshness piggybacks on run completion; the locator hot path is untouched.** A
`LocatorRecoveryRecord` carries no run id, so "records from this run" is underivable afterwards —
filtering by `updatedAt` misattributes records whenever two runs overlap. Instead
`LocatorFactory.writeMemory` (the single write funnel) reports each scope key it successfully stores,
and the engine accumulates them per instance in a `Set`, which dedups within the run for free.

**`semantic.autoIndex`, default ON**, separate from `semantic.enabled`. Off is a supported state, not
a degraded one: records are still written and the next rebuild picks them all up, so nothing is ever
lost. **There is no migration code** — `hydrate` spreads defaults before stored settings, so a
settings file predating the key reads `true`. Two checks pin that, because otherwise the guarantee
rests on a merge direction nobody watches.

Settings → Semantic Index now shows **last indexed / last indexing error** alongside the toggle. The
queue's error text is a fixed sentence chosen from the outcome, never a store code.

Verification: `verify:semantic-store` **261/0** (was 231) · `verify:semantic-queue` **80/0** (was 70)
· `verify:semantic-ui-gui` **19/19 real Electron** (was 14) · `verify:runner` 89/0 ·
`verify:settings-e2e` 151/0 · authz 59/0 · recorder 110/0 · semantic-policy 141/0 · semantic-rebuild
64/0 · `verify:ipc-contract` 4/4, pins unmoved at 213/191 (no channel added) · `verify:all-typecheck`
PASS. **Five mutations went red before revert:** letting the observer throw escape, bypassing the
guard in the engine, reversing the hydrate merge order, ignoring the `autoIndex` gate, and never
clearing the last error. Ledger unchanged at **61 PASS / 4 NOT RUN / 1 BLOCKED**; beads 118 / 20
outstanding / 98 closed. **Not run:** packaging and offline gates — no packaging surface touched.

## Zvec Phase 2 tranche 3 — the semantic index is reachable from the product (2026-07-28)

`awkit-0jp`. Until now the subsystem had permissions, nine IPC channels and real data, and **nothing
in the app used any of it**. There is now a **Semantic Search** page in the Build nav group and a
**Settings → Semantic Index** panel.

**A contract gap had to be closed first.** `rebuild`, `clear` and `updateSettings` are re-auth gated,
but authorization *threw*, so the renderer could only tell "re-authenticate" from "denied" by parsing
the text of a rejected `invoke` — which `SemanticApi.ts` explicitly forbids. `SemanticReasonCode`
gained `REAUTH_REQUIRED` and `NOT_AUTHORIZED`, and `authorizeSemanticAction` (pure, injected `assert`)
now translates the outcome. It catches **only** `SecurityError`; anything else rethrows, because
reporting a programming fault as `NOT_AUTHORIZED` turns a crash into a plausible permission message.
`branding.ipc.ts` maps every error to a reason — that part was deliberately not copied.

**The query layer is reusable, and that is the point.** `useSemanticQuery` (all three query kinds
behind one call shape), `useSensitiveSemanticAction` (re-auth, retry **once**), `SemanticResultList`
and `semanticMessages` live in `app/renderer/semantic/`. Later beads embedding search into the
Libraries, Reports and Designers call these rather than the preload directly.

**`SemanticKinds.ts` is new and structural.** `SemanticDocument.ts` imports `node:crypto`, so **any
value imported from it drags `createHash` into the renderer bundle** — the first renderer import of a
semantic bound failed the build with `"createHash" is not exported by "__vite-browser-external"`. The
kinds, the kind guard and the topK bounds now live in a pure module that `SemanticDocument.ts`
re-exports, so every existing importer is unchanged.

Two defects were found by **looking at a screenshot**, not by an assertion: the kind filter rendered
two identical "Locator" checkboxes, and the enable toggle rendered as an oversized native checkbox
(it needed the app's `inline-check` class). Both are fixed, and `verify:semantic-store` now pins that
no two document kinds share a label.

Verification: `verify:semantic-ui-gui` **14/14 real Electron** (new — a Viewer genuinely does not see
the nav entry, 21 items without it) · `verify:semantic-store` **231/0** (was 215) · `verify:authz`
**59/0** (was 53) · `verify:settings-e2e` 151/0 · runner 89/0 · recorder 110/0 · `verify:ipc-contract`
4/4 with pins unmoved at 213/191 · `verify:all-typecheck` PASS. Four mutations went red before revert
(swallowing an unexpected error, ignoring the retry cap, removing the route gate, duplicating a
label). Ledger unchanged at **61 PASS / 4 NOT RUN / 1 BLOCKED**; beads 118 / 21 outstanding / 97
closed. **Not run:** packaging and offline gates — no packaging surface touched. Dark mode was not
exercised; the new CSS is token-only, which is the mechanism the rest of the app relies on, but that
is an inference rather than a measurement.

## Verification surface hardened; two silent gaps closed (2026-07-28)

No product behaviour changed. What changed is what the gates actually cover, and two of them were
lying by omission.

**`npm run typecheck:scripts` was RED on `main`** from `ea90491` until `190565a`. `npm run build`
typechecks the app project only; `scripts/` is a separate project (`tsconfig.scripts.json`), and
`tsx` strips types without checking them. So a verifier script did not compile while its own suite
ran 215/0 and every task entry truthfully reported "build PASS". Fixed by widening one cast through
`unknown`; no assertion changed. **Use `npm run verify:all-typecheck` after touching `scripts/`** —
it is `build` + `typecheck:scripts` and already existed.

**`verify:source-hygiene` now scans `docs/**/*.md`, not only TypeScript** — 7 → 9 checks,
mutation-tested (a probe file containing a NUL turns it red at 8/1). It previously scanned
`src`/`app`/`scripts` for `.ts`/`.mts`/`.tsx` only, which is why a literal NUL byte survived in
`docs/ai/TASK_LOG.md` across many commits: `grep` answers "Binary file matches" rather than showing
the line, and the roadmap dashboard's reader strips NULs and merely warns. Only the **rendered**
dashboard showed it. Its parse-warning message also named a hardcoded "offset 62127" that every
append to that file had invalidated — the byte was at 102796. It now reports the count only.

Both were found by opening `npm run roadmap` → <http://127.0.0.1:4380> and reading the page, after
`verify:roadmap-dashboard` reported 135/135. Treat the dashboard's **Parse warnings** panel as a
first-class signal: it reports irregularities in the sources that no assertion pins.

Ledger unchanged at **61 PASS / 4 NOT RUN / 1 BLOCKED**; beads 118 / 22 outstanding / 96 closed;
live parse warnings 7 → 6. `npm run build` not re-run — no app-project file changed.

## Zvec Phase 2 tranche 2 — run + locator projections, similarFailures / suggestLocators (2026-07-28)

`awkit-9xh`. The last two channels from plan §11 now work, because the index finally contains
documents about *runs* and *locator memory*, not just authored flows and workflows.

**Source choice is the privacy control.** Run documents are built from `RunHistoryRow`, **not**
`DurableRunRecord`. The row carries `errorClass` but no raw error string and no URL, so there is
structurally nothing to leak — `DurableRunRecord` has both, and the plan excludes them because an
error message routinely embeds tokens and a URL embeds query parameters. `errorSummary` is
deliberately left unpopulated: the allowlist permits a redacted sentence, but the only text at this
layer is the raw error, and inventing a summary from it would reintroduce exactly the leak the
allowlist prevents.

**Locator documents project only the winning strategy.** `winningCandidateSignature` is
`JSON.stringify({ strategy, value, name, exact })`, so `value` and `name` are a real element's
selector and accessible name. Only `.strategy` is read; the fingerprint, which holds text and
attributes, is not read at all. Two verifier assertions pin this and both went red under a mutation
that indexed the full signature.

Also added: `LocatorRecoveryStore.list()` (bounded; skips unparseable records rather than throwing),
a `run-failure` document only for genuinely failed runs — a cancelled run is not a failure, or
`similarFailures` would return cancellations — and bounded corpora
(`SEMANTIC_RUN_HISTORY_LIMIT` 500, `SEMANTIC_LOCATOR_MEMORY_LIMIT` 2000), because both sources grow
without bound. The two recall sources **degrade** on read failure while the authoring stores still
throw: losing run history costs suggestion quality, losing flows would activate an index claiming the
user's automation does not exist.

**Freshness comes from rebuild only.** Owner decision: no incremental indexing events this round.
`ExecutionEngine` has no event emitter, and adding one touches the runner hot path where plan §14.3
forbids exception propagation into workflow execution. Tracked as `awkit-thg`.

Verification: build PASS · `verify:semantic-store` **215/0** (was 199) · `verify:authz` 53/0 ·
`verify:semantic-rebuild` 64/0 · real-host `verify:semantic-rebuild-live` **24/0** ·
`verify:ipc-contract` 4/4 (213 handlers, 191 exposed) · `verify:recorder` 110/0 · `verify:runner`
89/0 · `verify:source-hygiene` 7/0 · roadmap dashboard 135/135. Two mutations red before revert.

**Gotcha worth remembering:** writing the NUL `scopeKey` separator as a string escape caused an
editing tool to emit a **literal NUL byte** into the source, which `verify:source-hygiene` forbids.
Fixed by deriving it as `String.fromCharCode(0)` — a form no tool can re-expand.

Dashboard source counts are **118 beads / 22 outstanding / 96 closed**. The validation ledger
remains **61 PASS / 4 NOT RUN / 1 BLOCKED**.

## Zvec Phase 2 tranche 1 — semantic product surface: RBAC + service + IPC/preload (2026-07-28)

`awkit-c7j`. The semantic subsystem is now reachable from the renderer for the first time, behind
main-process authorization.

**Permissions** (plan §10) — five added to `src/security/authz/Permissions.ts`. Two owner decisions
the plan required to be explicit rather than silent: `SEMANTIC_MANAGE_INDEX` and
`SEMANTIC_MANAGE_EMBEDDINGS` **both join `SENSITIVE_PERMISSIONS`**, so rebuild, clear and settings
changes demand a fresh re-authentication; and **Viewer does not get `SEMANTIC_SEARCH`** (deny by
default — granting later is a one-line change, revoking later is a regression). Operator gets search
plus failure similarity. Administrator inherits all five automatically, because
`ADMINISTRATOR_PERMISSIONS` is a **denylist** over `ALL_PERMISSIONS` — correct here, but it means any
future Super-User-only permission must be excluded explicitly or it is granted silently.

**Contract** — `src/semantic/contracts/SemanticApi.ts` is pure, so the IPC handler and its verifier
apply the identical rules: bounded query/filter strings, a bounded kind list, `topK` clamped to
`SEMANTIC_MAX_TOP_K`, and structured fields only. Unknown properties are **dropped**, so a renderer
cannot smuggle a Zvec filter expression or a filesystem path; a present-but-malformed filter is an
error rather than a silent drop, because discarding a constraint widens a search instead of
narrowing it. Handlers return stable reason codes — no native or vendor error crosses IPC.

**Channels** — `semantic:getStatus | search | rebuild | cancelRebuild | clear | getSettings |
updateSettings`, registered in `app/main/ipc/semantic.ipc.ts` and exposed as
`window.playwrightFlowStudio.semantic`. New `semantic` group in `ui-settings.json`
(`enabled`, `defaultTopK`), which finally gives `semanticHealth({ enabledBySetting })` a real value
instead of the hardcoded `true` it had since Phase 1A.

**`cancelRebuild` returns `NOT_SUPPORTED` and that is deliberate.** `SemanticRebuildOrchestrator` has
no cancellation token and the pointer swap is an irreversible commit point, so reporting "cancelled"
would be a claim the process cannot make. The channel exists so the contract and a future UI can be
written against a truthful answer.

Verification: build PASS · `verify:authz` **53/0** (up from 40; per-role semantic assertions) ·
`verify:semantic-store` **199/0** (up from 179) · `verify:ipc-contract` **4/4** (211 handlers, 189
exposed) · `verify:settings-e2e` **151/0** real Electron · `verify:settings-persistence` 3/3 ·
`verify:security` 39/0 · `verify:semantic-policy` 141/0 · roadmap dashboard **135/135**. Two
mutations went red before revert: forwarding raw renderer input (leaked `filter`, `collectionPath`,
`generationPath`) and granting Viewer search. A third finding came from the toolchain — the new authz
block had a `viewer` identifier collision, proving that block had never executed when first written.

Not built: `similarFailures` / `suggestLocators` (need run-failure and locator projections plus
indexing events — `awkit-9xh`) and any renderer UI (`awkit-0jp`).

Dashboard source counts are **117 beads / 22 outstanding / 95 closed**. The validation ledger
remains **61 PASS / 4 NOT RUN / 1 BLOCKED**.

## Dashboard backlog Tranche 3 — semantic index runtime bound to production (2026-07-28)

`awkit-ttd` is closed, and with it the last structural gap in Zvec Phase 1B. Two of the three items
its note listed as outstanding were already done: the orchestrator has been bound to the real
generation root through `rebuildIntoNewGeneration`, and `whenIdle()` has had a production shutdown
caller via `SemanticIndexRuntime.shutdown()` ← `disposeSemanticSubsystem()`.

The gap the note did not name was the real one. **`SemanticIndexRuntime` was never constructed or
registered in the Electron main process** — `setSemanticIndexRuntime` had zero callers and
`new SemanticIndexRuntime` appeared only in the verifier harness. Every consequence failed open:
`semanticHealth()` derived `rebuildRequired` and `activeGenerationOpenFailed` from a null runtime
and so reported healthy unconditionally, `disposeSemanticSubsystem` left `drained = true` because
there was nothing to drain and therefore recorded **every** session as a clean shutdown, and
`rebuild()` had no production entry point at all.

`app/main/semantic/semanticSnapshot.ts` now supplies the authoritative flow + workflow snapshot
through the existing `projectAndValidate` pipeline; `getSemanticHostManager()` registers the runtime
with the host manager itself as the `ZvecHostTransport`; and `initializeSemanticSubsystem()` reaches
that registrar after reconciliation. Both constructors are inert, so plan §16.1 still holds — startup
spawns no host. `ensureSemanticIndexOpen()` and `rebuildSemanticIndex()` are the production open and
rebuild entry points. Snapshot sources are resolved **per rebuild**, never captured at startup,
because the flow and workflow folders are user-configurable in Settings. An unreadable store throws
rather than returning a partial snapshot, which the orchestrator turns into `SNAPSHOT_FAILED` with
nothing allocated and the active pointer untouched.

Proof: `verify:semantic-store` **179/179** (was 153), `verify:semantic-rebuild` **64/64**,
`verify:semantic-queue` **70/70**, real-host `verify:semantic-rebuild-live` **24/24** with 68
assertions, `verify:verifier-classification` reconciled, and `npm run build` PASS. Four mutations
were run and every one went red before revert: leaking a step value into `stepNames`, deleting the
registration, degrading an unreadable source to a partial snapshot, and removing the startup
registrar call. The registration guard **failed its own first mutation** — counting
`setSemanticIndexRuntime(` call sites was satisfied by the degrade path's
`setSemanticIndexRuntime(null)` — and was rewritten to assert that the *constructed* runtime is the
one registered.

Not covered: no product surface calls the new entry points yet, because there is still no semantic
IPC, preload API or UI; that is the next phase. Production registration is proven by source-scan
guards plus the real-host lifecycle suite, not by a real-Electron end-to-end run.

Dashboard source counts are **113 beads / 20 outstanding / 93 closed**. The validation ledger
remains **61 PASS / 4 NOT RUN / 1 BLOCKED**.

## Dashboard backlog Tranche 3 — ambiguous Zvec mutation outcomes reconciled (2026-07-28, current)

`awkit-hzf` is closed. A host deadline or exit after a mutation was dispatched is now preserved by
the adapter as `AMBIGUOUS_MUTATION` instead of collapsing into retryable `WRITE_FAILED`. The mutation
queue sends that operation exactly once, abandons the queue entry, and marks the index
`rebuildRequired`. An authoritative-source rebuild is the only reconciliation path because the late
host reply may mean the mutation landed, did not land, or was still applying; timing is never used to
invent an answer.

The focused fake-transport reproduction initially made three write attempts and failed
**152/153**. With the fix it passes **153/153**. The real utility-host verifier forces a
1,500-document write past a zero-length deadline and proves one dispatch, one abandonment, no
requeue, and rebuild-required; it passes **24/24** with 68 lifecycle assertions. Host exit during a
write is also pinned to one dispatch. `verify:semantic-queue` is **70/70**, build and
`typecheck:scripts` pass. Disabling the mapping reproduced **152/153** and was reverted.

Dashboard source counts are **113 beads / 21 outstanding / 92 closed**. The validation ledger
remains **61 PASS / 4 NOT RUN / 1 BLOCKED**.

## Dashboard backlog Tranche 3 — real Zvec contract closed on all three layouts (2026-07-28, current)

`awkit-9yv` is closed. The shared `SemanticStoreContract` and scale cases now run through the real
`ZvecSemanticStore → ZvecUtilityHostManager → utilityProcess → raw host → Zvec` path on the staged
tree, packaged `win-unpacked` tree, and a freshly installed per-user NSIS tree. The installed matrix
had omitted the shared contract even though it ran lifecycle and rebuild checks; it now includes
that suite explicitly and guards its presence with an exact-one sentinel.

Current proof: staged and packaged native contract **22/22** with the shared contract **68/68**,
including more than 1,500 documents, exact counts, pre-ranking filters, replacement, deletion, and
clear. The real generation lifecycle is **23/23** with 62 internal assertions for active-generation
queries, candidate validation, crash paths, pointer activation, restart persistence, rollback, and
reconciliation. The NSIS cycle passed native contract **21/21**, manager lifecycle **35/35**, rebuild
**23/23**, then removed the host, registry key, and installation directory cleanly.

Removing the installed-contract matrix entry produced **21/22**; it was restored and the packaged
gate returned to **22/22**. Dashboard source counts are **113 beads / 22 outstanding / 91 closed**.
The validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**.

## Dashboard backlog Tranche 2 complete — passive CDP observation and local trace (2026-07-28, current)

`awkit-4a6` is closed, completing every authorized Tranche 2 engineering item. Each running browser
generation can now carry a second, fail-open CDP client restricted to an explicit observation
allowlist. It records a secret-sanitized, size-capped raw event stream, bounded two-second visual
samples, and an opt-in DOM timeline beneath the existing per-instance artifact root. Finalization
rebuilds 17 predictable session buckets plus navigation-bisected per-page slices in an idempotent
pass, with `summary.json` as the small analysis entry point.

Instance Monitor exposes the same attach as a permission-gated, read-only live browser modal with
local screenshots, trace status, keyboard focus containment, and no runner action surface.
Observation attach, sampling, or finalization failures never replace the workflow result. The
runner always stops samplers during runtime swaps, cancellation, crashes, and ordinary cleanup.

Focused proof is `verify:instance-monitor` **55/55**, `verify:artifacts` **23/23**,
`verify:instance-monitor-gui` **18/18**, and `verify:runner` **89/89**; `npm run build` passes.
Temporarily admitting `Input.dispatchMouseEvent` to the observation allowlist produced
**54/55**, then was reverted. Dashboard source counts are **113 beads / 23 outstanding /
90 closed**. The validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**.

## Dashboard backlog Tranche 2 — locator winner memory and bounded recovery complete (2026-07-28, current)

`awkit-v4r` is closed. The runner now persists the last successful recorded locator candidate per
scenario/flow/step under the configured runtime-data root and tries that candidate first on the next
run. The record also carries a bounded structural fingerprint: tag, role, accessible name/text,
selected stable attributes, and three ancestor descriptors. Text, labels, and attribute values are
token-hashed before persistence, and CSS classes are never read or stored.

Local recovery is deliberately narrower than ordinary resolution. It is available only when the
same candidate set has succeeded before, every saved candidate currently resolves to zero, and a
500 ms bounded recheck still finds nothing. It scans at most 200 visible elements, applies
step-type compatibility, requires a similarity score of at least 0.86 and a unique margin of 0.08,
and otherwise preserves the existing Playwright auto-wait path. Ambiguous twins are never guessed.
Every accepted recovery logs a warning with its score and tells the user to re-record the step.

`verify:recorder` is **110/110** and `verify:runner` is **89/89**. Raising the recovery threshold
above every possible score produced **107/110** with the three recovery sentinels red; the mutation
was reverted. Dashboard source counts are now **113 beads / 24 outstanding / 89 closed**. The
validation ledger remains **61 PASS / 4 NOT RUN / 1 BLOCKED**.

## Dashboard backlog Tranche 2 in progress — packaging fails loud and payload provenance is separate (2026-07-28, current)

The authorized fail-loud half of `awkit-epz` is implemented. Both portable and NSIS packaging
entry points now run `validate-offline-bundle.ps1 -PackagingInputsOnly` before `npm run build`.
The preflight names the exact required
`resources/browsers/chromium/chrome.exe` path and rejects both a missing file and a zero-byte file,
so packaging cannot spend time building or produce a hollow artifact when its browser input is
absent.

The current payload passes the preflight, normal `validate:offline`, and strict offline validation.
Missing-file and empty-file mutations both failed loudly. `awkit-epz` intentionally remains open:
the Chromium vendoring, version/hash provenance, and reproducibility strategy are the owner-policy
half that the dashboard backlog program reserves for the owner.

`awkit-c0c` is closed. Dependency-manifest schema v2 removes ambiguous
`application.builtAt`, adds top-level `manifestGeneratedAt`, and records browser payload source,
requested/installed Playwright versions, a source timestamp with its exact basis, and a
deterministic `sha256-tree-v1` digest over 308 files / 435,574,347 bytes. The runtime-created
`debug.log` is explicitly excluded and recorded as such. Because this existing payload predates
source capture, its source is truthfully marked `legacy staged payload; acquisition details
unavailable`; future `prepare:offline` runs write an acquisition sidecar. A one-character digest
mutation made strict validation fail and was reverted.

`awkit-60w` is closed. The real REC-018 journey now reports matched recorded business steps over
total recorded business steps for a baseline and two replay-only DOM-drift profiles. All three
six-action scenarios replay through the production ExecutionEngine and independently match the
server-side outcome: **6/6, 6/6, 6/6; aggregate 18/18 = 100%**. The measured first baseline set the
gate at **95% aggregate / 80% per scenario**: one missed action out of 18 makes the aggregate red,
while a local collapse cannot hide inside the total. Removing the email control's final stable
accessible name produced **2/6** for structural drift and **14/18 = 77.78%** aggregate; the mutation
was reverted. The focused gate is **61/61** and the full mock site is **96/96**.

Dashboard source counts are now **113 beads / 25 outstanding / 88 closed**. The validation ledger
remains **61 PASS / 4 NOT RUN / 1 BLOCKED**.

## Dashboard backlog Tranche 1 complete — four P1 beads closed (2026-07-28, current)

All four Tranche 1 P1 beads are closed. `awkit-cxa`'s product fix had already landed in `082cfea`,
but the tracker remained open. `verify:flow-step-mapping` now exercises the actual shipped
`mock-conditional-flow.json` condition through the real designer conversion pair and passes
**102/102**. Temporarily restoring the historical converter logic produced **93/102** and explicitly
lost that shipped expression; the mutation was reverted.

`awkit-7lj` now sender-binds `flows:list`, `flows:get`, `flows:export`, and the legacy `flow:list`
alias to `Permission.PAGE_FLOWS`. The real-Electron authorization gate proves all three canonical
reads fail with `NOT_AUTHORIZED` before sign-in while a signed-in Viewer retains the intended
read-only flow-library access (**50/50**). Removing the three canonical guards produced **47/50**;
the mutation was reverted.

`awkit-oyc`'s shipped FR-B2 implementation captures every failed attempt before the retry verdict,
keeps each attempt's evidence, preserves the original automation error and last `screenshotPath`,
and produces bounded, confined artifacts through the screenshot limiter. Its deterministic gate is
now **35/35** and its real-Chromium artifact gate is **17/17**. Moving the retry verdict before
capture produced **34/35**; the mutation was reverted.

`awkit-ebh`'s shipped popup registry has one BrowserContext-level observation owner. Recorded popup
steps atomically claim the observed page, deterministic synthetic aliases survive reversed open
order, and the same page never holds two public aliases. The identity gate is now **44/44**;
replacing the click path's claim with a second observation produced **43/44** and was reverted.
Popup steps are **12/12**, popup Test Lab scenarios **11/11**, the full mock site **94/94**,
Recorder **97/97**, and runner **89/89**.

The dashboard now measures **113 beads / 27 outstanding / 86 closed**. The validation ledger is
unchanged at **61 PASS / 4 NOT RUN / 1 BLOCKED**. Tranche 1 is complete; later tranches and
owner-gated items have not been started.

## Phase K REC-022 narrowed to a real IdP only (2026-07-28, current)

Phase K remains **partially-completed**. REC-024 is PASS (2026-07-27, `958f575`),
`verify:recorder-gui` is **152 PASS / 0 FAIL / 0 NOT RUN**, and `awkit-38k` is closed. REC-022 is
the single remaining blocker, now tracked explicitly as P2 bead **`awkit-cey`** with status
`blocked`: completing it requires an authorized operator and an approved test identity.

`verify:protected-login-recorder` grew to **57/57** and now automates every REC-022 guarantee the
offline mock can express. It drives the real Recorder into a detected pause with a non-empty draft,
proves the still-open automation browser is inert, proves password/OTP and direct private-action
attempts leave the draft count exactly unchanged, and proves the identical action records after
resume. The mock session page now reads an origin-scoped persisted authentication signal on load.
A production runner flow containing Auto Secure Login + Reuse Session loads that captured-profile
fixture and reaches the authenticated dashboard without login interaction; the identical flow with
its session removed fails, as does a fresh no-session dashboard assertion. Three deliberate
mutations—removing the `isRecording` guard,
removing the captured profile, and injecting a protected action—each made the focused verifier fail
before being reverted.

The Phase E follow-ups are also closed: its previously unreported `npm run build` and
`verify:workflow-builder` **28/28** gates pass; workflow conflict messages use one shared
producer/parser contract with a round-trip sentinel; workflow node kinds are exhaustively linked to
their TypeScript union; and `.codex/config.toml` is targeted in `.gitignore`. The validation ledger
is unchanged at **61 PASS / 4 NOT RUN / 1 BLOCKED** (Recorder 28/0/1, Reports 14/2, Settings 19/2).
Packaging/offline gates were not run because no packaging or offline surface changed.

**Follow-up the same day — the declared-blocked pin had to move, and it was hiding a second issue.**
`awkit-cey` was committed as `open` while bd held it `blocked`, so the working tree failed
`verify:roadmap-dashboard` at **134/135** even though HEAD passed: the check pinned
`declaredBlocked === 1` and there are now two (`awkit-7bu`, `awkit-cey`). `blocked` is the correct
status — an authorized operator plus an out-of-band prerequisite is not expressible as a `blocks`
edge — so the pin moved to 2 rather than the bead moving back. The same check asserted the layer of
`externallyBlocked[0]` **only**, so the second declared-blocked issue was never validated at all;
that is now `.every()`, kept non-vacuous by the count assertion beside it. Both halves were
mutation-tested to fail before reverting. Back to **135/135**.

## Phase E complete — Workflow Builder import-from-file (2026-07-27, current)

Phase E (Scenario Builder / Workflow Builder) is **complete**. The Workflow Builder now imports
workflow JSON through a hidden file input that the real Electron GUI gate can drive. The Library and
Builder share `validateWorkflowProfile`, and the authoritative `workflows:import` IPC repeats that
validation before persistence. Malformed documents report all structural errors and never change
storage or the canvas.

ID collisions are confirm-before-overwrite at both renderer entry points and rechecked at the IPC
boundary with `WORKFLOW_IMPORT_ID_CONFLICT`. In the Builder, dirty-canvas confirmation runs first.
Cancel or Escape at either dialog preserves storage, canvas nodes/edges, selection, and dirty state;
replacement is the only path that passes `allowOverwrite: true`. `scenario:save` keeps its intentional
overwrite behavior.

The roadmap is now **9 complete / 0 in progress / 2 partially completed (82%)**. `awkit-d3c` is
closed. Verification: `npm run build` passed, `verify:workflow-sentinels` **11/11**, and the real
Electron `verify:workflow-builder` **28/28**. The validation ledger is unchanged at
**61 PASS / 4 NOT RUN / 1 BLOCKED** (Recorder 28/0/1, Reports 14/2, Settings 19/2).

## Roadmap phases reconciled after 282 commits of drift (2026-07-27, current)

`src/roadmap/ImplementationRoadmap.ts` had **not been touched since the initial commit**
(`c198e2e`, 2026-07-04) while 282 commits landed on `main`. It is hand-maintained and nothing
derives it, so it went stale silently — most visibly declaring **Recorder Mode `pending`,
"intentionally queued"**, while the Recorder is one of the most developed features in the app
(ranked unique locators, compound/tree disambiguation, runtime self-healing, Smart Wait observation,
protected-login handoff, eight `verify:recorder-*` suites). The dashboard was reporting this
faithfully: it is derived, so it can never be fresher than its source.

Reconciled against the code, not against the old prose:

| Phase | Was | Now | Why |
|---|---|---|---|
| E Scenario / Workflow Builder | in-progress | **in-progress** | all 5 deliverables shipped; the one real gap is that `ScenarioBuilder.tsx` has no import-from-file UI (import lives only in `WorkflowsLibrary.tsx`) — now tracked as **`awkit-d3c`** |
| F Concurrent Instances | in-progress | **complete** | runner fan-out is integrated end to end; `verify:concurrency`, `verify:instance-monitor(-gui)` |
| G Data-Driven Concurrent Runs | in-progress | **complete** | `ConcurrentRunMode.dataDrivenConcurrent` wired through `execution.ipc.ts` → `InstanceManager` → Instance Monitor → `ExecutionReport`, with per-instance retry |
| H Advanced Flow Control | in-progress | **complete** | `FlowExecutor` executes loops (`mock-loop-flow`), Run Another Flow has a depth-5 recursion guard |
| J Offline Packaging | in-progress | **partially-completed** | every deliverable built; its acceptance sentence *is* the clean-machine walkthrough, never executed |
| K Recorder Mode | pending | **partially-completed** | shipped and verified; two cases open under `awkit-38k` (REC-024 NOT RUN, REC-022 permanently blocked) |

Summary moved **45% → 73%** (8 complete, 1 in progress, 2 partially completed, 0 pending).

Validation state is unchanged by this task: the ledger still measures **61 PASS / 4 NOT RUN /
1 BLOCKED** (Recorder 28/0/1, Reports 14/2, Settings 19/2). This section must keep quoting it —
`parse-narrative.mjs` reads only the *newest* section of this file, so a new head without the tally
silently drops CURRENT_STATE from the consistency banner (checked 2 → 1) while the banner still
reads "Sources agree".

**A `partially-completed` status was added** because neither existing value described J or K
honestly — the deliverables shipped, but each retains a named gap that is not active development.
"Complete" would assert an unrun check passed; "in-progress" would imply work underway that is not.
It is threaded through `RoadmapStatus`, `getRoadmapSummary` (new `partiallyCompleted`, deliberately
credited **no** completion percentage), `getNextRoadmapPhase` (in-progress → partially-completed →
pending), both renderers, `PHASE_STATUSES`, and `normalizePhases` — where it maps to `active`, never
`done`, so an unclosed phase is never counted as finished work. `verify:roadmap-dashboard`
**119 → 135 PASS / 0 FAIL**.

**Trap found while guarding it — an icon typo failed open.** `icon()` in `tools/roadmap/public/icons.js`
falls back to `ICON_NODES.circle` for an unknown name, so a status added without its icon renders a
plain circle and nothing fails. The new check resolves every icon name `views.js` references against
`icons.js`. Its **first version was itself fail-open**: capturing with `[a-z0-9-]+` meant a malformed
name simply was not collected, so a mutation to `"circle-dashedX"` still passed. Capturing `[^"]+`
fixed it — mutation-verified to fail, then reverted. The staleness above and this are the same
failure in two forms: *nothing fires when the input never enters the collection.*

**The browser pass then caught three things every static gate had passed.** All eleven cards, both
themes and two viewports were checked against the live page at `127.0.0.1:4380`:

1. **The CSS edit was dead.** `.roadmap-summary-grid` is overridden by the *responsive block at the
   end of `global.css`* ("these overrides come last so they win the cascade"), which sets it in a
   shared 8-selector list. Editing the base rule at line ~2933 changed nothing. The base rule now
   carries a NOTE saying so; the class was pulled out of the shared list into its own rule.
2. **The five cards did not fit — by four pixels.** The shared responsive rule used
   `minmax(180px, 1fr)`; 5 x 180 + 4 x 12 = 948 against the roadmap panel's 944px, so "Completion"
   dropped onto a second row alone. Its own rule at `minmax(150px, 1fr)` gives five 179px tracks in
   one row, and still wraps cleanly to 2 x 3 at 800px.
3. **`--awkit-info` had no dark value.** Accent, success, warning and danger all lighten in the dark
   block, and info's own `-soft`/`-muted` there are already derived from `#60a5fa` — the base was
   simply missed, leaving it at the light `#3b82f6` and rendering dimmer than every sibling chip on
   a dark surface. Added `--awkit-info: #60a5fa`. **This affects all 16 `var(--awkit-info)`
   consumers in dark mode, not just the new chip** — a deliberate palette completion, flag it if
   that was not wanted.

Measured after the fixes — light: `#3b82f6` on `#eaf1fe`; dark: `#60a5fa` on 13% of itself, the
same structure the `complete` chip uses in each theme. No horizontal overflow at 1280 or 800.
**Screenshots were not possible** (the Browser pane was not displayed, so the page never composited
frames); the evidence is DOM structure and computed styles, which does not cover pure aesthetics.

## Dashboard upkeep is a standing rule; classification reconciled (2026-07-27, earlier)

**Every task must now keep the Program Status dashboard current**, by updating the sources it parses
— it is derived and must never be hand-edited to record progress. Canonical procedure:
`docs/ai/DEVELOPMENT_WORKFLOW.md` § 6, echoed in `AGENTS.md` (rules + End-of-task checklist item 8),
`CLAUDE.md`, `GEMINI.md`, `docs/ai/README.md` and `tools/roadmap/README.md`. It names which source
owns which fact, requires `blocks` edges in `bd` for real dependencies, requires claiming actively-
worked items in `tools/roadmap/assignments.json`, and ends with `npm run verify:roadmap-dashboard`
plus an Overview banner reading "Sources agree".

Validation state is unchanged by this task: the ledger still measures **61 PASS / 4 NOT RUN /
1 BLOCKED** (Recorder 28/0/1, Reports 14/2, Settings 19/2).

**Area derivation was reweighted** (`tools/roadmap/lib/normalize.mjs`); `verify:roadmap-dashboard` is
now **111 PASS / 0 FAIL**. It concatenated title + description into one haystack and returned the
first keyword *in the keyword table's own order*, so a passing mention in a long body outranked the
subject of the title — all five Test Lab issues were scattered across Reports, Licensing and
Security, a Settings issue read as Recorder, and the Reports issue read as Security. Now
`deriveAreaWeighted` lets the title decide whenever it matches at all and consults the body only when
the title is silent (saying so in its basis); within a scope the **earliest occurrence** wins, with
list order as a tiebreak only — needed on its own, since `secret` precedes `settings` in the table
and "Settings … secret-store GUI" would otherwise still file as Security. Defects invert the two
scopes deliberately: the affected-file list leads, because a title like "a control that did nothing"
names nothing while its files name the engine. Six checks guard it, each verified to fail against the
old behaviour rather than merely to pass against the new.

**The dashboard hot-reloads data, not its own code.** The 1.5s poll re-reads the 13 sources, but
`tools/roadmap/lib/*` is already in the Node module cache — `POST /api/refresh` will not pick up a
code edit. Restart the server after changing the tool; changing a *source file* needs no restart.

**`awkit-7bu` is now `blocked` in `bd`, and the dashboard understands bd's full status taxonomy**;
`verify:roadmap-dashboard` is **119 PASS / 0 FAIL**. The bead's title had said `BLOCKED` since
2026-07-26 while its status stayed `open`, so every ready-work view offered it as startable. It is
not: it needs an authorized operator for SYSDBA provisioning *and* an out-of-band ephemeral
credential, and at that time `scripts/verify-oracle-mock-ui-workflow.mts` had no real-mode code
path. **Correction 2026-07-29:** the verifier path is now implemented; only the authorized
operator/credential lifecycle remains blocked. The external prerequisite is not expressible as a
dependency edge, which is why the status field remains the right home.

Fixing that exposed a **latent trap in the dashboard**: it accepted only `open`/`closed` of bd's
seven statuses and mapped everything not-closed to `open`. `bd update <id> --claim` sets
`in_progress` — so the documented way to claim work would have warned on parse, failed the gate, and
still shown the claimed issue as unstarted. Now: `in_progress`/`hooked` → `active` (queued),
`blocked` → `blocked` (queued, never ready), `deferred` → excluded, `pinned` → `open`. A **deferred
prerequisite now blocks its dependent** rather than counting as satisfied — the old "not in the
queue means done" shortcut failed open in exactly the case where it mattered most. Kahn cannot drain
a declared-blocked item or its dependents, so Tarjan separates the residue: a strongly-connected
component is a real cycle, everything else is held from outside the graph and renders in its own
**"Blocked — not startable"** section with no layer, rather than being mislabelled a cycle. Stats
gained `outstanding` and `byStatus`, because reporting `open` alone under-counts the moment any
other status is used.

## Verifier classification reconciled (2026-07-27, earlier the same day)

`npm run verify:verifier-classification` is **GREEN — all 144 `verify:`/`validate:` scripts are
classified**, no stale entries. `verify:reports-live-engine` and `verify:settings-runner-behaviour`
were the two missing ones; both are `real-browser` (`real-browser` 48 → 50, total 142 → 144).
Ledger unchanged at **61 PASS / 4 NOT RUN / 1 BLOCKED**.

Each was classified from its actual execution path, decided independently — they happened to land in
the same class, but for separately verified reasons. Both hard-require `out/main/main.js` and
`exit 1` without it, both `electron.launch({ args: [root] })` the **built, unpackaged** app, and both
spawn the mock site as a Node child. `reports-live-engine` then starts real Chromium instances
(`executions.runWorkflow({ headless: true, dryRun: false, totalInstances: 3 })`) and saturates the
live engine until dispatch is refused; `settings-runner-behaviour` starts a real run from the run
card's own Run button and asserts the failure-evidence bundles on disk change with
screenshot-on-failure ON/OFF/ON. `args: [root]` rules out `packaged-application` (that class means
`dist/win-unpacked` or the offline bundle), and `integration` excludes browser/Electron by definition.

**Executed, not assumed:** `verify:reports-live-engine` **21 PASS / 0 FAIL**.

**`verify:settings-runner-behaviour` is FLAKY, and it passes: `11 PASS / 0 FAIL`.** Four runs on
identical code with no rebuild between them — 7/1, 7/1, 7/1, **11/0**. The failing step is always a
timing-sensitive `locator.click` on `button.workflow-card-run`, intercepted by the
`.workflow-card-hint` span while the card's summary layer is still cross-fading out. The earlier
reading of this as a deterministic environment block (a `@media (hover: hover) and (pointer: fine)`
mismatch at `global.css:5423`) is **withdrawn** — that would not have produced a green run. Not a
regression: neither `5c2990d` nor `536ec52` touched `app/` or `src/`, the markup predates both, and
`verify:reports-live-engine` scored **21 PASS / 0 FAIL** on the same build in the same session.
**A single red run of this suite proves nothing — re-run it.** Recorded in `KNOWN_ISSUES.md`; not
"fixed" by loosening a check.

## Program Status & Roadmap dashboard — `tools/roadmap` (2026-07-27, earlier)

`npm run roadmap` → <http://127.0.0.1:4380>. `npm run verify:roadmap-dashboard` is **105 PASS / 0
FAIL**. `npm run build`, `typecheck:scripts`, `verify:source-hygiene` (7/0) and `validate:offline`
all pass **unchanged** — verified before and after.

Validation state is unchanged by this task: the ledger still measures **61 PASS / 4 NOT RUN /
1 BLOCKED** (Recorder 28/0/1, Reports 14/2, Settings 19/2), and the dashboard's consistency banner
confirms `HANDOFF.md` and this file both assert the same figures.

A standalone read-only web dashboard that parses the project's 13 real status sources live and
renders one picture of what is left, in what order, blocked by what, and who is on it. It is
deliberately outside the application: `tools/` sits outside `tsconfig.json`'s 4-entry `include`
allowlist and electron-builder's `files` allowlist, so `tsc --noEmit --listFiles` matches **0** files
under `tools/roadmap`. Zero new npm dependencies — pure `node:http` plus plain ES modules, following
`mock-site/server.mjs`. Full contract: `tools/roadmap/README.md`.

**Three findings the dashboard surfaced, which are about the repository rather than about it:**

1. **The open dependency graph is nearly empty.** Only 5 of 30 open issues carry a `blocks` edge. The
   *entire* open DAG is the Test Lab chain `wza.5 → wza.6 → {wza.7 → wza.8, wza.9}` — **24 of the 29
   queued issues declare no dependency at all.** The Work Queue therefore states, with the count
   computed live, that its rank is a priority sort rather than a schedule for that 83%.
2. **Beads is measurably stale against the ledger.** `awkit-8ri` claims "Settings: 4 NOT RUN" and
   `awkit-az7` claims "Reports: 7"; the ledger measures 2 and 2. Both are shown with their sources
   and flagged — never reconciled or averaged.
3. **`verify:verifier-classification` is red on `main`, and not because of this change.**
   `verify:reports-live-engine` and `verify:settings-runner-behaviour` — added in the two preceding
   sessions, the ones that found `AWKIT-REP-008` and `AWKIT-SET-006` — were never added to
   `scripts/lib/verifier-classification.ts`. This change registers only its own verifier; the
   per-class count moved `static-source-validation` **7 → 8** (total 141 → 142) exactly as expected.
   **Classifying those two remains open** — guessing a class would defeat the registry's purpose.

**Agent attribution is two structurally separate fields.** The tracker has no per-issue assignee (all
111 issues carry the same owner) and `TASK_LOG.md` records only completed work, so "who is working on
this issue" has no honest source. `Assignee` comes from `tools/roadmap/assignments.json` only (solid
chip, expiring, empty state is the literal word *Unclaimed*); *"recent activity in this area"* comes
from `TASK_LOG.md` and renders muted/dashed/italic, never as "working on". The verifier asserts no
derived attribution can set a claim state, driven against a fixture rather than the shipped empty
file — otherwise that assertion would be an `.every()` over an empty array.

**`GET /app.css` serves `app/renderer/styles/global.css` verbatim**, so the page is literally the same
UI rather than a lookalike, with permanently zero token drift. This couples the page to renderer CSS,
so the verifier guards the 19 borrowed class names; a `.roadmap-card` rename now fails loudly instead
of degrading the page silently.

### Two defects found and fixed while building it

- **`assignments.json` was invisible to the liveness fingerprint.** It is read by `agents.mjs` but is
  not a repository source, so it was absent from `WATCHED_SOURCE_IDS` — a new claim would have sat
  unread behind the snapshot cache until some *unrelated* document happened to change. The one file
  the tool asks an agent to edit was the one file it ignored. Now folded into the server fingerprint;
  proven end to end (file write → SSE push → chip renders, claimed and expired variants).
- **The dependency-graph edge overlay could never draw.** It was scheduled purely on
  `requestAnimationFrame`, which a non-compositing tab starves indefinitely — measured: 33 nodes, **0
  edges**. A graph whose edges silently never appear is indistinguishable from a graph with no edges.
  The first draw now runs on an explicit mount hook; rAF is kept only to coalesce redraws. Also fixed
  in the same area: bezier control points crossed at narrow lane gaps, and the lane grid overflowed
  its own SVG overlay so the last lane's edges were unreachable.

## SET-008 + SET-009 closed; `AWKIT-SET-006` — a control that did nothing (2026-07-27, earlier)

`npm run verify:settings-runner-behaviour` (new) is **11 PASS / 0 FAIL**. Ledger **61 PASS / 4 NOT
RUN / 1 BLOCKED**; Settings **19 PASS / 2 NOT RUN**. The two open Settings cases are **not ordinary
engineering** — see below.

### `AWKIT-SET-006` — "Screenshot on failure" never reached a run

Settings › Execution Defaults offered it, every workflow run card offered its own toggle, both
persisted — and neither reached the runner. `runWorkflowFromCard` sent `headless`, `totalInstances`,
`maxConcurrentInstances`, `isolationMode` and `stopOnError`; `RunWorkflowRequest` had **no field for
it at all**. The runner's default came from `resolveArtifactSettings()`, and all four artifact profiles
hardcode `screenshotOnFailure: true`, so failure evidence was captured unconditionally regardless of
what the user chose. The only working control was the per-step `onFailure.screenshot` in the Designer.
This is a RULES.md violation: an enabled control that does nothing.

Fixed by carrying the run-level choice exactly the way certificate trust already travels — request →
instance template → `InstanceConfig` → engine, taking precedence over the artifact-profile default.
Per-step `onFailure.screenshot` still wins over both, and an omitted field still means "artifact
default", so no existing caller changes behaviour. ON → OFF → ON went **4 / 4 / 4** before the fix and
**4 / 0 / 4** after.

### Two measurement traps, both of which produced a WRONG answer first

1. **A stale corpse satisfied the wait.** The first version polled `executions.list()` for "some
   terminal instance" — which a *previous* run's finished instance satisfies instantly. It sampled the
   artifact directory before the run under test had written anything, reported 4 → 0 → 4, and would
   have recorded this defect as *working*. It now waits for a new `executionId` and for every instance
   of that execution to end.
2. **A single ON→OFF pair cannot attribute the difference.** "No screenshot" is also what a second run
   that writes nothing for an unrelated reason produces. The suite runs **ON → OFF → ON**; the 4/0/4
   shape is what makes the setting the cause rather than run order.

Static reading said the flag was never sent; the first measurement said it worked; the corrected
measurement agreed with the static reading. **Neither reading alone was sufficient.**

### The two remaining Settings cases are owner decisions

- **SET-013** — the unavailable-secret-store *contract* is already proven by `verify:secrets`, which
  drives a real `SecretStore` with an injected `isAvailable: () => false`. The missing **GUI** half
  needs `safeStorage.isEncryptionAvailable()` to return false inside the running app. There is no
  seam, and adding an env-gated override to `app/main/secretStore.ts` would put a test hook in a
  shipped security path — the class of thing deliberately removed from the Zvec host (`__testAbort`).
  Not an agent decision.
- **SET-015** — the real OS folder launch, same owner-decision class as SYS-REP-008.

### Verification

settings-runner-behaviour 11/11, runner 89/89, artifacts 13/13, failure-evidence 34/34,
failure-screenshot-precedence 6/6, concurrency 81/81, `build` + `typecheck:scripts` clean.

**Packaged after this change, and both gates re-run:** `package:portable`, then
`verify:packaged-walkthrough` **70 PASS / 0 FAIL** and `verify-packaged-validation` **87 PASS / 0
FAIL** (`freshly built (3 min old)`). The `AWKIT-SET-006` wiring therefore holds in the packaged app —
worth having, since the fix crosses the IPC boundary the packaged build bundles.
`dependency-manifest.json`'s `builtAt` is `2026-07-27T13:16:24Z`.

## Live-engine harness — SYS-REP-007 + SYS-REP-011 closed, `AWKIT-REP-008` fixed (2026-07-27)

`npm run verify:reports-live-engine` (new) is **21 PASS / 0 FAIL**. Ledger **59 PASS / 6 NOT RUN /
1 BLOCKED**; Reports **14 PASS / 2 NOT RUN**. **No engineering work remains in Reports** — both open
cases are the same owner-decision OS folder launch.

### What the harness does that seeding cannot

Both cases read state that exists only in the main process's live `ExecutionEngine`:
`useLiveDistribution` polls `executions.list()`, and `telemetry:server` reads
`getRuntimeStatus().capacity.dispatchBlocked`. The suite starts **real** instances against the local
mock site, drives the app into its supported **sequential** capacity mode through the real
`settings.update` IPC, and lets the product refuse dispatch on its own — reason
**`active flow limit reached (1/1)`**. Nothing is injected or mocked.

- **SYS-REP-007:** the **rendered** buckets equal `executions.list()` — `{"running":1,"pending":2}` on
  both sides — with both a running and a queued bucket visible and the "3 instance(s) in the pool"
  headline agreeing with the engine total.
- **SYS-REP-011:** the notice appears on Chrome Consumption with `role="status"` and its reason,
  `telemetry:server.backpressureBlocked` is `true`, all four gauges keep rendering while throttled,
  and it **clears** on release.

An idle-engine negative control runs first (pool empty, page says so, no notice), so none of the
above can be satisfied by a page that renders the same thing regardless of engine state.

### `AWKIT-REP-008` — an idle app reported itself throttled, forever

The *release* half of SYS-REP-011 found it. `dispatchBlocked` was `lastBlockedReason !== undefined`,
and that reason was cleared **only** by a later successful `admit()`. The dispatch loop stops calling
`admit()` when its run ends, so a run that finished or was cancelled while blocked left the refusal in
place permanently: 45 s after every instance ended, with **zero active flows**, the app still reported
*"Dispatch is currently throttled by backpressure — active flow limit reached (1/1)"*. Not one page —
`ReportsChrome`, `telemetry:server`, `StatusBar` and `InstanceMonitor` all read the same stale field.

Fixed by making a refusal **decay**: `block()` timestamps itself, and the snapshot reports a block only
while it is still current (5 s). The dispatch loop re-asks about every 500 ms, so a genuine block
re-stamps itself continuously while one nobody renews lapses. A self-healing rule was chosen over
"clear it on the way out" **deliberately** — the latter must be remembered by every present and future
exit path, and this defect exists because one of them was not.

Pre-fix control **19 PASS / 2 FAIL** → post-fix **21 PASS / 0 FAIL**. Guarded by three new
injected-clock checks in `verify:concurrency` (78 → **81 PASS / 0 FAIL**).

### A NOT RUN that was being counted as a PASS

`verify-reports-populated-gui`'s `notRunCheck` pushed `pass: true`, so its headline **158 PASS / 0
FAIL** silently included every entry that had run nothing. Measured after the fix:
**155 PASS / 0 FAIL / 3 NOT RUN** — no check changed behaviour; the tally stopped lying. (Three of
the six `notRunCheck` call sites execute on this fixture; the rest sit in branches it does not take.
The count was *measured*, not derived from the number of call sites.) Same family as the
unfailable-check pattern below.

Two of those three are now proven elsewhere by the live-engine suite and say so in their own reason
strings; the third — SYS-REP-006's drawer branch for a run deleted underneath a stale row — remains
genuinely unreachable in one session.

### Verification

reports-live-engine 21/21, concurrency 81/81, runner 89/89, capacity-modes 10/10, runtime-status
15/15, telemetry 61/61, observability 65/65, durable-store 11/11, reports-populated-gui
155 PASS / 0 FAIL / 3 NOT RUN, `build` and `typecheck:scripts` clean.

**Packaged after this change, and both gates re-run:** `package:portable`, then
`verify:packaged-walkthrough` **70 PASS / 0 FAIL** and `verify-packaged-validation` **87 PASS / 0
FAIL** (`the portable EXE is freshly built (3 min old)`). The `AWKIT-REP-008` fix is therefore
verified in the **packaged** app, not only in the dev tree. `dependency-manifest.json`'s `builtAt` is
`2026-07-27T12:35:31Z` — generated by packaging, never hand-edited.

## A seventh unfailable check, this one in a release gate (2026-07-27)

`scripts/verify-packaged-validation.mts` contained
`check("Warnings/findings state present", statuses.some(…) || true)`. The trailing `|| true` defeats
the condition outright, so the check has been green since it was written without asserting anything —
in a **packaged release gate**. Seventh instance of the pattern recorded in `KNOWN_ISSUES.md`.

The fix keeps the precondition and the assertion as separate facts, so neither can stand in for the
other: a flow tolerated **under compatibility** is the fixture's runnable-yet-imperfect case, and such
a flow must be `runnable === true` *and* still report findings (`errorCount`/`warningCount` > 0). An
empty set is `NOT RUN`, not a pass. The script gained the `NOT RUN` third state it never had — having
only pass/fail is what pushed the precondition into the condition in the first place.

**Executed: 86 PASS / 1 FAIL**, the single failure being the script's own freshness guard
(`the portable EXE is freshly built (1400 min old, < 180)`) refusing the 2026-07-26 package — the
guard doing its job. After the repackage below: **87 PASS / 0 FAIL**. The rewritten check passes on a
real assertion against both packages.

**The packaged gate is current again.** `npm run package:portable` was re-run (offline bundle
validation strict-mode PASS; Zvec native host 17/17 checksum-verified) and
`verify:packaged-walkthrough` is **70 PASS / 0 FAIL** against the new build — citable again for the
first time since this campaign began changing `src/` and `app/`. Part M observed no non-loopback TCP
connection from any app process; Part L confirmed the NSIS installer sha512 matches `latest.yml`.
`resources/dependency-manifest.json`'s `builtAt` is now `2026-07-27T11:39:22Z` (generated by
packaging — never hand-edited). The clean/offline **VM** walkthrough remains a separate human gate
that the script explicitly does not claim.

**`verify:reports-settings-a11y` re-run at HEAD: 14 PASS / 0 FAIL.** Note that the branch fixed in
`cdcf8e3` is unreachable on a fresh profile — Workflow Reports renders its EmptyState, so there are no
sort headers to audit. The `aria-sort` contract's real coverage is in `verify:reports-populated-gui`,
where it is written as `sortState.length > 1 && …` and therefore cannot pass vacuously.

## Reports block — 3 cases closed, 2 defects, 2 vacuous checks (2026-07-27)

`verify:reports-populated-gui` **136 → 158 PASS / 0 FAIL**. Ledger **57 PASS / 8 NOT RUN /
1 BLOCKED**; Reports **9 → 12 PASS / 4 NOT RUN**. Closed: SYS-REP-009, SYS-REP-010, SYS-REP-012.

**`AWKIT-REP-006` — Failure Analytics had no evidence.** The page is described as "evidence-based
insights" and `FailureBreakdown` was `{total, categories, topWorkflows}`. An operator could read that
12 runs timed out and had no way to reach *which* ones. `queryFailures` already held the filtered
failed runs and discarded them; it now returns `recent`, rendered as a table that opens the existing
`RunDetailDrawer` on the run it names. Evidence is redacted **structurally** — identity, workflow,
category, timings only — asserted by inspecting the row's own keys.

**`AWKIT-REP-007` — storage sizes were silently truncated.** `dirSizeMb` stops after 20,000 entries;
the bound is correct, but the result had no way to say so, so a large folder reported a figure that
read as a total. An operator deciding whether to clean up saw a small number. Same class as
`AWKIT-SET-005`. Now reports `truncated`, and the page renders "at least N MB" plus a note.

**Two checks already in the passing ledger were vacuous, both via the same escape-hatch shape.**

1. "Only failed runs appear in the failure evidence list" read `failures.recent`, a field the
   contract **did not have** — `undefined ?? []` and then `length === 0 ||` passed it. It had never
   tested anything.
2. "An unavailable process metric renders neutral rather than a fabricated 0" was
   `chromiumMemoryMb === undefined ? realCheck : true`. The fixture always defines it, so the ternary
   returned `true` unconditionally.

That is now five instances of this pattern in the campaign. **The tell is a check whose condition can
short-circuit to `true`** — `x === undefined ? … : true`, `list.length === 0 || …`. Grep for them.
*(Two more were found afterwards — a sixth in the a11y suite and a seventh in the packaged validation
gate, taking the running total to seven. See the section at the top of this file.)*

**A third blind spot: the fixture never seeded `runtime_capacity_snapshots`** — a different table
from the capacity *buckets* it did seed (`queryRuntimeSeries` reads the former, `queryCapacityAnalytics`
the latter). Three of the four Runtime Analytics metric cards and both timelines had only ever
rendered `—`, and nothing noticed.

**SYS-REP-010's neutral-vs-zero matrix is driven through the real range selector**, not by mutating
data, so the dash is provably absence: process samples sit 40-51 min back, capacity snapshots 0-11 min
back. At 15m "Peak Chromium memory" reads `—` / "process sampling unavailable"; at 1h the same card
reads `610 MB` / "peak 4 process(es)". A co-rendered populated card proves the page is not simply
empty, and Server Performance pins the other direction — a never-created folder is a **measured** `0`.

**The 20,001-entry directory is created in the OS temp dir, never under the repo.** This suite's
profile lives beneath `test-artifacts/`, which is inside the user's OneDrive; 20,000 files there
would be pushed into cloud sync.

**SYS-REP-006's recorded reason was wrong and is corrected.** It claimed `telemetry.runDetail` cannot
distinguish an unknown id from a retained run with no attempts, and that a **contract change** was
required. `RunDetail.run` is optional and `JSON.stringify` omits undefined properties — the *absence*
of `run` was the signal all along, and `RunDetailDrawer` already branches on it. Now asserted:
`known.run=present unknown.run=absent`. No contract change was needed.

**Still open in Reports (4):** SYS-REP-007 and SYS-REP-011 need a harness that starts real
`ExecutionEngine` instances (`executions.list()` and `capacity.dispatchBlocked` are live in-memory
state no seeding can produce); SYS-REP-008's real Explorer launch and SYS-REP-006's artifact launch
are owner-decision manual checks; SYS-REP-006 also keeps a narrow defensive residual — the drawer's
missing-run branch is unreachable in one session, since retention sweeps only at engine startup and
every drawer entry point re-reads the same store. Measured: a second `SqliteRuntimeStore` connection
cannot mutate the running app, because the store is **sql.js** — in-memory, persisting by rewriting
the file.

**Verification:** reports-populated-gui 158/158, telemetry 61/61, observability 65/65, reports 31/31,
runtime-analytics-gui 36/36, runtime-status 15/15, reports-settings-a11y 14/14, `build` and
`typecheck:scripts` clean.

## REC-024 closed — the Recorder surface is complete (2026-07-27)

`verify:recorder-gui` **128 → 152 PASS / 0 FAIL / 0 NOT RUN**. Ledger **54 PASS / 11 NOT RUN /
1 BLOCKED**. **Recorder is 28 PASS / 0 NOT RUN / 1 BLOCKED** — every Recorder case that can be
automated is now executed; only REC-022 remains, and it needs an authorized human with an approved
test identity.

**`AWKIT-REC-007` — the Recorder never noticed its browser dying.** `RecorderService` registered a
`close` listener for **popups** and nothing at all for the main page, the browser or the context, and
`getStatus()` returns the raw `isRecording` flag with no liveness check. Kill the recorded browser
out of band and the page — which polls that status — kept showing **Recording** with Start, the
Target URL field and both capture switches disabled. The operator was stranded in a session whose
browser no longer existed, with Cancel as the only way out.

`attachLivenessWatch` now wires four signals, because none implies the others: `page.close`,
`page.crash`, `browser.disconnected` and `context.close` (the persistent-context resume path, where
`this.browser` is deliberately null). It fires only on an *unexpected* death — every supported
teardown sets `isRecording = false` before closing anything — and ignores handles from an
already-replaced session, so a resumed handoff cannot be killed by its predecessor's listeners.
**Actions and the draft are preserved**, which is the whole difference between this path and
`cancelRecording`.

**`page.crash` is a separate signal and was nearly missed.** Measured: a renderer crash leaves
`page.isClosed() === false` and fires **neither** `close` **nor** `disconnected`. A fix wired to the
two obvious events would have left the recorder stuck behind a crashed tab — which is the case's own
wording, "browser closes **or crashes**".

**Three mechanisms had to be measured before the test could exist, and two were dead ends:**

- **`window.close()` is refused from an `http://` origin** — the page simply stays open (`pages: 1`).
  So is `window.open("","_self").close()`. A self-close is only honoured for script-opened windows, so
  an out-of-band close of the MAIN page is not reachable from a fixture at all. The mock-site harness
  written for it was removed rather than left in place looking functional.
- **`taskkill /T` without `/F` does not end Chromium** — the browser process survived it.
- What works: kill the tab's **renderer** (crash), `CloseMainWindow()` on the browser process (window
  closed), and `taskkill /T /F` on the browser root (terminated).

**The kill must be proven to have killed something.** Both dead ends first presented as "the recorder
stayed in Recording" — indistinguishable from the real defect. Every trigger now asserts the targeted
pids are actually gone before the product assertion runs, and reports `NOT RUN` otherwise. Without
that control, two test failures would have been written up as product defects.

**Process discovery is a baseline diff, not an absolute set.** Windows recycles pids, and a process
whose real parent died keeps the stale `ParentProcessId` — several of the developer's own Chrome
processes matched this Electron instance's pid that way and looked like permanent orphan leaks. Only
pids that appear *for this recording* count. The walk covers the whole descendant tree because
`app.process()` is the `electron.exe` launcher and the browser is a **grandchild**; a direct-children
query found nothing at all, which only surfaced because the "process was located" precondition is
asserted.

**Verification:** recorder-gui 152/152, recorder-e2e 41/41, recorder-draft 50/50,
protected-login-recorder 45/45, recorder locator 97/97, recorder-flow 19/19, recorder-authz 44/44,
mock-site 90/90, `build` clean, `typecheck:scripts` clean.

## Recorder accessibility — REC-013 and REC-029 closed, 3 defects (2026-07-27)

`verify:recorder-gui` **103 → 128 PASS / 0 FAIL / 0 NOT RUN**. Ledger **51 → 53 PASS / 14 → 12 NOT
RUN / 1 BLOCKED** (Recorder 27/1/1, Reports 9/7, Settings 17/4). Recorder now has **one** case left
(REC-024's real browser crash) plus the operator-blocked REC-022.

**`AWKIT-REC-004` — the async review dialog declared `aria-modal="true"` and implemented none of it.**
No focus move, no trap, no `Escape`, no focus return. `aria-modal` tells assistive tech that
everything behind the dialog is **inert**, so a keyboard user tabbing out of it landed in content
their screen reader had been told does not exist. Measured pre-fix: focus stayed on the opener, and
`Tab` walked straight into the page behind as `INPUT(ESCAPED) → BUTTON(ESCAPED) → …`.

**This is the third surface with the identical defect.** `AWKIT-SET-004` fixed `ConfirmDialog`;
`AWKIT-REP-004` found it again in `RunDetailDrawer`; this one is inline markup in `Recorder.tsx` and
inherited nothing. The fix has been applied to a component three times and to the *concept* zero
times — there is still no guard that fails a new `aria-modal` surface lacking the contract. Recorded
in `KNOWN_ISSUES.md`.

**`AWKIT-REC-005`** — the status pill (`Idle`/`Recording`/`Ready to save`/`Manual handoff`), the
page's primary state readout, sat in no live region. The action timeline was already `aria-live`, so
*actions* were announced while the *state* was not. Both it and the transient status message are now
`role="status"`. **`AWKIT-REC-006`** — the recorded-URL search box had only a `placeholder`, which is
not an accessible name and vanishes on the first keystroke.

**The pre-fix run is the evidence, not the argument.** `test-artifacts/recorder-gui/2026-07-27T08-51-42-761Z/`
is a genuine negative control at **74 PASS / 6 FAIL**: the checks were written and executed *before*
the fix, and five of them failed in the way predicted from reading the code.

**Three test premises had to be measured, and two of my own were wrong first:**

- **Focus assertions must test CONTAINMENT, not label text.** When focus is lost `activeElement`
  falls back to `<body>`, whose `textContent` contains every button label on the page — the exact
  shape that made an equivalent Reports check pass *while the defect was present*.
- **An `aria-label || textContent` accessible name is wrong** and invented two defects that did not
  exist: it reports every `<label>`-wrapped `INPUT` as unnamed. The name is now resolved the way a
  screen reader does (`aria-label` → `aria-labelledby` → `title` → associated/wrapping `<label>` →
  text), with `placeholder` deliberately excluded.
- **Reduced motion is measured both ways round.** The pulse reads `infinite` unreduced and `1` under
  `prefers-reduced-motion`. Asserting only the reduced value is equally satisfied by an element with
  no animation at all, so the unreduced reading is the control that proves there was motion to reduce.

**REC-004's "known intermittent Electron flake" was not a flake, and not a product defect either.**
It failed twice consecutively. I hypothesised a stale-response race (the 500 ms poll's in-flight
`getActions()` overwriting `setActions([])` after the interval is torn down) — and **the measurement
disproved it**: with a polled assertion the state reads `empty-state=1 stale rendered rows=0`. The
empty state does arrive; a one-shot `count() === 1` was simply sampling before React committed, and
its empty FAIL detail is what let it be misread as a flake twice. The check now polls and reports the
rendered row count, which is what distinguishes "renderer hasn't caught up" from "stale rows on
screen". No product change was made on the disproven theory. Two consecutive green runs since.

**REC-029 covers all five states its preconditions name** — idle, recording, ready-to-save,
review-dialog, and handoff. The handoff state is audited inside the paused window SET-005 already
produces rather than by driving a second protected recording, waiting for the panel because it is fed
by a separate 800 ms `getHandoff()` poll that an instantaneous read races.

**Verification:** recorder-gui 128/128 (twice), recorder-e2e 41/41, mock-site 90/90,
reports-settings-a11y 14/14, `build` clean, `typecheck:scripts` clean.

## Settings residual submatrices — 5 more cases, `AWKIT-SET-005` (2026-07-27)

Continuation of Phase 4 across the Settings surface. **`verify:settings-e2e` 128 → 151.** Ledger
**47 → 51 PASS / 18 → 14 NOT RUN / 1 BLOCKED** (Recorder 25/3/1, Reports 9/7, Settings 17/4).
Closed: SET-007, SET-008, SET-017, SET-020 — and SET-015's unreadable-store half.

**`AWKIT-SET-005` — a read-only artifact folder was labelled "writable".** `checkPath` decided
writability with `access(path, W_OK)`, which is not a usable test for a *directory* on Windows: Node
does not consult the directory ACL, so a folder the user has been denied write access to reports
writable while a real write fails `EPERM`. These seven paths are where run artifacts land, so a wrong
label is worse than none — the operator picks the folder, Settings confirms it, and every screenshot,
log and report write fails later with nothing having warned them. Same class as `AWKIT-SET-003`, which
fixed the `isDirectory` half of this exact function and left the writability half intact.
**The correct pattern already existed in the repo** — `OfflineRuntimeValidator.canWrite` does a real
write probe. `checkPath` now does the same, with the probe file removed in a `finally`.

**Two fixture premises had to be measured rather than reasoned about, and both were wrong first.**

- **The ACL mask matters.** Denying the whole `W` right also blocks `stat`, so the directory reads as
  *missing* rather than read-only and the case under test is never exercised — the first run failed
  for the wrong reason and would have been easy to misread as the defect. `WD,AD` leaves
  `exists`/`isDirectory`/`readdir` intact while making a real write fail.
- **`JSON.stringify` equality on the settings document compares key ORDER.** `hydrate()` produces a
  different order across a restart, so a whole-document comparison reported a difference where the
  values were identical. The check is now per key and *names* the differing ones, which is what
  distinguishes a volatile key (`app.lastLaunchedAt`, `lastRouteId`) from a value that genuinely
  failed to persist.

**What the new checks are actually for, in each case:**

- **SET-017** — every prior assertion proved the import took effect in the *live* process. An import
  that updated only in-memory state would have satisfied all of them and silently reverted on next
  launch. The restart round-trip is the half that mattered.
- **SET-020** — a passing bundle proves the action *runs*, not that it can **detect** anything; a
  validator hard-wired to report success would have satisfied the old check perfectly. A genuinely
  unwritable runtime folder now flips exactly one named check, and restoring it clears the failure,
  so the result is an observation of current state rather than a latched flag.
- **SET-008** — designer propagation is driven at **two** zoom values (75 % and 150 %), because one
  would match by coincidence against the 100 % default. `flowDesignerZoomPercent` is cleared first,
  or the assertion reads the saved per-designer zoom and passes regardless of the Setting.
- **SET-015** — an unreadable store degrades to `0` while the other three keep reporting truthfully
  (a rejection that escaped would take all four down together), and restoring access returns the
  count, so the `0` is demonstrably a degradation and not a loss.

**The folder picker is stubbed in the MAIN process**, so the real `system:browseFolder` handler, its
`SETTINGS_EDIT` check and the renderer's "null means leave it alone" branch all stay under test.
Stubbing at the preload level would have skipped all three. Both branches are asserted — "unchanged
after cancel" alone is equally satisfied by a Browse button that does nothing.

Every ACL denial is registered and restored in a `finally`, and each restoration is a reported check.

**SET-004's mid-session half is closed too**, in `verify:recorder-gui` (**103 PASS / 0 FAIL / 0 NOT
RUN** — no unmet preconditions left in that suite) rather than by duplicating the mock site into the
Settings gate. It uses the two *observable* consequences of the capture flags instead of an
unfalsifiable "nothing changed": a session launched with Smart Wait capture ON and waiting-time
capture OFF reports `fixedDelay=2, waitActions=0` even after waiting-time capture is switched on
mid-recording through Settings (the only route left, since the page locks its own switches), while
the **next** session on the identical fixture reports `fixedDelay=0, waitActions=1`. That opposite
shape is simultaneously the "next session uses new values" half and the negative control for the
first assertion. `RecorderService.start` assigns both flags once, so the binding is launch-time by
construction and there is no race in when the change lands.

**Still open in Settings (3):** SET-008's new-run-form propagation and SET-009's runner-behaviour
proof (both need a bounded real run); SET-013's unavailable secret store (needs
`safeStorage.isEncryptionAvailable()` false, which has no injection seam from outside the main
process); SET-015's real OS folder launch (recorded manual check).

**Ledger correction:** the previous entry recorded **51 PASS / 14 NOT RUN**. The true count at that
commit was **50 / 15** — SET-008 stayed `NOT RUN` for its run-form half and was counted as closed by
mistake. Closing SET-004 here brings the real total to **51 PASS / 14 NOT RUN / 1 BLOCKED**
(Recorder 25/3/1, Reports 9/7, Settings 17/4), so the figure is now accurate.

## Reports/Settings residual submatrices — 6 cases, 2 defects (2026-07-27)

Phase 4 of the campaign. **`verify:reports-populated-gui` 74 → 136**, **`verify:settings-e2e`
116 → 128**, **`verify:recorder-gui` 90 → 100**. Ledger **43 → 47 PASS**, **22 → 18 NOT RUN**
(Recorder 25/3/1, Reports 9/7, Settings 13/8). Closed: SYS-REP-004, SYS-REP-005, SET-016, SET-019.

**Two real product defects, both found by a check that had never been executed.**

`AWKIT-REP-004` — `RunDetailDrawer` rendered `role="dialog" aria-modal="true"` with no Escape
handler, no focus move, no trap and no focus return. Assistive tech treats content behind an
`aria-modal` dialog as inert, so a keyboard user was stranded. Same class as `AWKIT-SET-004`, which
fixed `ConfirmDialog` but never reached this component — a fix applied to one modal surface, not to
the concept.

`AWKIT-REP-005` — `AnomaliesPanel` filtered to `state === "active"` and drove its empty state from
that list, so a regression that *recovered* rendered identically to a workflow that never regressed.
The durable layer returns `"recovered"` faithfully; the renderer discarded it. Both states now render
with their own labelled badge.

**Three checks were vacuous before they were run. This keeps being the same lesson.**

1. Focus return asserted `activeElement.textContent.includes("Details")`. When focus is lost,
   `activeElement` falls back to `<body>`, whose `textContent` contains every button label on the
   page — "Details" among them. It would have passed *exactly when the defect was present*.
   Negative-controlled: with only the focus-return line disabled it reports `activeElement=<BODY>`.
2. Column sorting asserted set-preservation plus a definite `aria-sort` — both satisfied by a column
   that reports a direction and then orders rows arbitrarily. Now asserted against the column's own
   values (`Runs` descending `20,12,2,2,2` / ascending `2,2,2,12,20`), monotonic per direction rather
   than exact-reverse, because ties are expected and a stable sort correctly breaks that symmetry.
3. REC-013's dismiss control was assumed to be "Cancel". It is **"Keep editing"**. The block had
   never executed, and timed out the first time it did.

**Storage sizing is now checked against arithmetic, not against itself** (SYS-REP-012): 1.5 MiB
written to a *sub*-folder reads back as `1.5` (so the walk recurses), the total equals the sum of its
parts, a never-created folder reports `0`, and a **real `icacls` ACL denial** applied before the app
starts excludes its 4 MiB — with the denial asserted as a precondition, so "excluded" cannot pass
because there was nothing to exclude. Restored in a `finally`, and the restoration is itself a check.
Cache behaviour uses the suite's own elapsed time rather than a dead wait: stale `3` inside the TTL,
exactly `5` after it.

**The Settings reset inventory had a real blind spot.** Sessions and driver records were never
seeded, so "Clear UI State and Reset preserve your data" was only ever asserted about the classes
that happened to be present — a destructive action that spared flows and wiped captured sessions
would have passed 116/116. They are also invisible to `settings:getStorageStats`, which counts only
flows/workflows/dataSources/reports, so the inventory reads through each store's own `list()`.

**REC-013's fixture recipe is counter-intuitive and the recorded plan for it was wrong.** The bead
proposed "Capture waiting time ON with pauses ≥ 500 ms". That *suppresses* the wait it needs:
`RecorderService` passes `allowFixedDelayFallback: !this.captureWaitTime`. The working recipe is the
inverse — Smart Wait capture ON, waiting-time capture OFF — plus a genuinely **quiet** gap, since any
fetch, DOM mutation or loader yields a reliable condition instead. The harness does not even update
its own status element between actions; that one mutation would have suppressed it.

**Two subcases are blocked on architecture, not on effort.** SYS-REP-007's live distribution and
SYS-REP-011's backpressure both read live `ExecutionEngine` state (`executions.list()` and
`getRuntimeStatus().capacity.dispatchBlocked`) that a store-seeded fixture cannot produce at all.
More seeding will never close them; a run-driving harness will. Recorded as `NOT RUN` with that
reason rather than asserted vacuously — "no instances in the pool" would have been true by
construction.

## Recorder persistence, save path and Settings scope — 7 cases (2026-07-26)

Phase 3 of the campaign. **`verify:recorder-draft` 17 → 50**, **`verify:recorder-gui` 70 → 90**.
Closed: REC-006, REC-010, REC-014, REC-016, REC-017, REC-023, SET-005.

**One small production refactor, done for testability and behaviour-preserving.** The
consecutive-fill compaction lived inside the `__awtkit_recordAction` `exposeBinding` closure, so it
was unreachable without a browser. Extracted to `RecorderService.recordActionFromPage(page, action)`;
the binding is now a one-line adapter. Confirmed unchanged by `verify:recorder` 97/97,
`verify:recorder-e2e` 41/41, `verify:recorder-flow` 19/19 before building on it.

**Boundaries that had never been hit:** REC-010 now asserts **500 ms exactly** (the `<` vs `<=` line),
499, 501, and the 60 s cap against a 120 s pause. REC-014 covers unparseable JSON, structurally valid
JSON of the wrong shape, and a missing file — none may throw, none may resurrect actions, and the URL
history must survive a corrupt draft.

**REC-017 uses a real write failure, not a mock:** the flows directory is replaced by a file so the
store's own write fails. The error surfaces, the recording stays intact, and retrying after restoring
the directory saves **exactly once**. A duplicate name creating a second distinctly-identified flow is
now asserted as *documented policy*, so changing it later is a decision rather than a silent drift.

**SET-005's mid-session check has a control.** Flipping the Setting while a session runs must not
change that session — asserted alongside a check that the persisted value really did change, so the
first assertion cannot pass vacuously.

**Ledger: 43 PASS / 22 NOT RUN / 1 BLOCKED** — Recorder 25/3/1, Reports 7/9, Settings 11/10.
Recorder is now down to REC-013, REC-024 and REC-029.

**Known flakiness worth respecting:** running six or more real-Electron suites back-to-back on this
machine intermittently fails at window startup (and once exhausted shell process handles). Both
`verify:recorder-e2e` and `verify:recorder-redaction` failed that way and passed on isolated re-runs.
Re-run a heavy suite alone before treating its failure as a regression.

## Recorder page now has a GUI verifier — 8 cases closed, `AWKIT-REC-003` (2026-07-26, current)

`verify:recorder-e2e` proved one happy path. Everything else about the page — idle enablement,
invalid targets, Stop vs Cancel, the URL history table, the false-positive ignore path, and
double-Start concurrency — had no verifier at all. New `npm run verify:recorder-gui`:
**70 PASS / 0 FAIL / 1 NOT RUN**, covering REC-001, REC-002, REC-003, REC-004, REC-019, REC-021,
REC-025 and the teardown half of REC-024.

**`AWKIT-REC-003` (S3) found and fixed:** clicking Start with an **empty** Target URL started a live
recording pointed at nothing. The `!url.trim()` guard is on **Save URL**, not Start, and
`normalizeUrl("")` returns `""` without objecting. Worse, the Target URL input disables itself while
recording, so the operator could not correct the mistake — the only exit was Cancel.
`startRecording` now refuses a blank target before any state is mutated or a browser is launched.

**The check that found it was vacuous first, and this is the reusable lesson.** The REC-003 loop
originally waited for `isRecording === false` and then asserted — but that flag is *already* false
while a start is in flight, so the poll returned at t=0 and all four invalid targets "passed"
without ever being attempted. It now waits for the status line to leave `Starting browser...`, the
observable an operator actually sees. The defect surfaced the moment the check stopped being vacuous.

**Two premises of mine were wrong and are now recorded in the case file**, so the next agent does not
re-derive them: `file:`, `about:` and `data:` are **deliberately permitted** targets (named
explicitly in `RecorderService.normalizeUrl`), so they are not "unsupported schemes"; and REC-001's
spec says Start *is* enabled while idle — the empty-target path belongs to REC-003.

**REC-013 is NOT RUN, not passed.** The async review dialog only opens when a recording contains
review-worthy async activity, and no self-driving fixture produces any yet. Tracked as a bead rather
than asserted vacuously.

## Recorder secret redaction had a word-boundary hole — `AWKIT-REC-002`, REC-007 PASS (2026-07-26, current)

`SENSITIVE_FIELD_PATTERN` in `src/recorder/recorderInitScript.ts` contains `\btoken\b` and
`\bsecret\b`, so it looked correct. It was not: `\b` needs a **non-word** character before the term,
and the two dominant field-naming conventions supply a word one — `apiToken` (camelCase) and
`api_token` (snake_case, `_` counts as a word character).

Measured: `apiToken`, `accessToken`, `refreshToken`, `api_token`, `clientSecret`, `client_secret`,
`devicePin`, `userSsn` and `cardCvv` were **all** exempt from redaction and written verbatim into
saved flows. The hole applied to every `\b`-anchored term, not just tokens. Hyphenated names worked
only by accident (`-` is not a word character).

Fixed by normalizing the haystack before the test — split camelCase, treat `_` as a separator — so
the anchors mean what they were written to mean. Deliberately **not** fixed by dropping the anchors:
that redacts `shipping` (contains "pin") and `tokenizer_label`, and an over-redacting recorder
silently discards values the user needs. `verify:recorder` (**97/97**, was 78) asserts both
directions.

New `npm run verify:recorder-redaction` (**15/15**) proves it end to end: a real Recorder session
types canaries into nine secret-shaped controls, then **every file** under the isolated data root is
scanned — actions, draft, flow JSON, URL history, handoff diagnostics, the production run's JSONL
log and the stored report. A non-sensitive value is asserted **present** in the same corpus, so the
scan cannot pass vacuously.

**New mock-site scenario: `/recorder-sensitive`** (not a `/recorder-lab` section). A page carrying
password and one-time-code inputs reads as a protected login surface, so the detector pauses it —
correct behavior that broke REC-018 when these fields briefly lived on the shared lab page. The
verifier asserts that pause (`handoff.phase="detected"`) before disabling detection for the
redaction run.

## Denied Reports/telemetry reads are now audited — `AWKIT-REP-003`, SYS-REP-015 PASS (2026-07-26, current)

Authorization on the Reports surface was already enforced; nothing recorded the refusals. A repeated
probing attempt left no trace, because `appendAudit` was wired only into branding, licensing, user
administration and authentication.

`assertSenderPermission` now takes an opt-in `audit` descriptor. Report and telemetry channels pass
one, so a denial appends an audit row naming the channel, the required permission and the actor
(none, when there is no session). `verify:reports-populated-gui` is **74/74** (was 66) and reads the
rows back through the operator-visible `AUDIT_VIEW` surface.

Three constraints worth keeping:

- **No caller-supplied argument is ever written** — asserted, so the audit log cannot be used as an
  injection sink.
- **Auditing never throws.** An unwritable trail must not suppress the denial.
- **The session is validated exactly once.** `AuthorizationService.resolveActor` was extracted so a
  denial can name its actor without a second `sessions.validate()` — that call runs `touchSession`,
  so re-running it would let a **rejected** request slide the idle expiry it was just refused under.
  `requirePermission` is now defined in terms of `resolveActor`.

Auditing is **opt-in per channel**, not global — volume on a high-frequency polling channel should be
a deliberate choice. `telemetry.ipc.ts` registers reads through `handleReportsRead(channel, handler)`,
which fuses registration with authorization. **`verify:ipc-contract` had to be taught about that
registrar:** without it, 18 telemetry channels vanished from its static scan, and its "registered but
unexposed and undocumented" check would have failed **open**. Contract is 4/4 at 203 handlers.

## Recorder IPC is authorized — `AWKIT-REC-001` fixed, REC-028 44/44 (2026-07-26)

The Recorder was the third IPC surface to get an authorization audit, and the only one that had
**none at all**. `app/main/ipc/recorder.ipc.ts` registered all 13 handlers as `async (_, …)`, so the
`IpcMainInvokeEvent` was discarded and no handler could identify its sender. `Permission.PAGE_RECORDER`
existed but was enforced only in the renderer route table.

`npm run verify:recorder-authz` (new; real Electron, isolated profile) probes every preload-reachable
`recorder:*` channel with no bound session, as a Viewer, as an Operator, and after sign-out.
**Pre-fix 3/26** — with no session at all, `saveUrl` persisted URL history, `saveFlow` created a real
flow (bypassing the `workflow.create` check `flows:create` enforces on the same store), and `start`
launched and navigated a browser. **Post-fix 44/0.**

Operating the Recorder now requires `page.recorder`; `recorder:saveFlow` additionally requires
`workflow.create`. Revocation is covered because `assertSenderPermission` unbinds the renderer on
`SESSION_EXPIRED`. `verify:recorder-e2e` remains **41/41**, so the authorized record → save →
restart → production replay journey is unaffected.

The verifier asserts the **denial reason** (`NOT_AUTHORIZED`), not merely that a call rejected — two
channels fail for unrelated business/navigation reasons and would otherwise have counted as secure —
and every mutation probe additionally asserts that nothing was persisted.

**Recorded, not fixed:** `flows:list`/`flows:get`/`flows:export` are unauthenticated reads in the
same style (bead `awkit-7lj`); `session.ipc.ts` and `instance.ipc.ts` have zero sender checks.

Focused-case ledger at the time of that change: 38 of 66 `NOT RUN`. **Current: 36 PASS / 29 NOT RUN /
1 BLOCKED** — Recorder 19/9/1, Reports 7/9, Settings 10/11.

## Packaged gate re-verified at `82c2514` — 70/70 (2026-07-26)

`npm run package:portable` was rebuilt and `npm run verify:packaged-walkthrough` re-run against it:
**70 passed, 0 failed**. This is the first packaged run that exercises the whole session's work
together — the `manualApproval` routing fix, the Reports authorization/export contract, and the
Settings authorization plus main-process validation.

The staleness guard added in `94c858e` had already refused the previous package, naming
`ConfirmDialog.tsx` as newer than the payload — the guard working on code it was not written for.
After the rebuild (`app.asar` 03:09 → 15:08) the precondition passes, and the fixes are confirmed
present in `out/main/main.js` (`Settings failed validation`, `retainKnownKeys`,
`Appearance must be light`, and the `manual-approval connector to` guard).

`resources/dependency-manifest.json` carries the regenerated `builtAt`; it is produced by packaging
and was not hand-edited. **Rule of thumb: after any `src/` or `app/` change, repackage before citing
a packaged result — the verifier will now stop you rather than let a misleading pass through.**

## Settings real-Electron gate 116/116; four defects fixed (2026-07-26)

`scripts/verify-settings-e2e.mts` is a deterministic real-Electron gate over a timestamped isolated
profile. It seeds two flows, one workflow, one data source, one stored report and synthetic secrets,
then drives every Settings section through the rendered UI, preload and sender-bound main process.

The complete pre-fix negative control was **81 PASS / 33 FAIL** and reproduced:

- **AWKIT-SET-001 (S2):** Settings metadata/UI reset/folder actions and every Secrets IPC handler
  lacked sender authorization; pre-auth and Viewer could inspect metadata and overwrite/delete
  secrets by name.
- **AWKIT-SET-002 (S2):** direct settings updates did not run authoritative validation; imports
  accepted arrays, retained unknown fixed-schema fields and had no renderer size bound.
- **AWKIT-SET-003 (S3):** path validation reported an existing writable file as a writable directory.
- **AWKIT-SET-004 (S3):** Settings errors lacked live semantics and confirmation dialogs did not trap
  or restore focus.

Reads now require `PAGE_SETTINGS`; mutations require `SETTINGS_EDIT`; all merged writes validate
before persistence; replacement rejects arrays, prunes unknown fixed-schema fields and enforces a
1 MB GUI import cap; path checks require a directory; and Settings alerts/dialogs are keyboard and
screen-reader operable.

**Final result:** `verify:settings-e2e` **116/116**, evidence
`test-artifacts/settings-e2e/2026-07-26T09-55-38-176Z/`. Regressions: Settings persistence 3/3,
real-Electron RBAC 51/51, HTTPS Settings 31/31, capacity 12/12, accent 33/33, branding 30/30,
Oracle Drivers 30/30, Flow Designer 56/56, Workflow Builder 20/20, secrets 16/16,
authorization 40/40, IPC contract 4/4, both type-checks and production build pass.

Case truth remains conservative: SET-001 and SET-018 are now PASS; Settings stand at
**9 PASS / 12 NOT RUN**. Partial results do not close cases whose picker/OS-launch,
runner/session propagation, fault variants, sessions/drivers inventory, 200% zoom, high-contrast or
complete accessibility submatrices were not executed. The combined Recorder/Reports/Settings ledger
now has **41 NOT RUN**.

## Populated Reports gate 64/64; two report defects fixed (2026-07-26, current)

`scripts/verify-reports-populated-gui.mts` is a deterministic real-Electron gate over an isolated,
timestamped profile. It seeds the real `SqliteRuntimeStore` with 32 current-window runs plus
10 previous-window rows across workflows/machines/modes/pools/workloads, exact attempts/artifacts,
capacity/admission/process/anomaly history, one valid stored report, and one corrupt sibling.

The pre-fix negative control was **44 PASS / 13 FAIL** and exposed two product defects:

- **AWKIT-REP-001 (S2):** every telemetry/report read trusted the renderer without a bound session or
  `PAGE_REPORTS`; pre-auth and no-role direct calls returned operational data.
- **AWKIT-REP-002 (S2):** Run Artifacts projected the stored report through nonexistent fields,
  could not Open, exported a lossy card, had no trusted export/open preload bridge, and showed Export
  to Viewer.

All telemetry/report reads now use sender-bound `PAGE_REPORTS`; report export/open uses
`REPORT_EXPORT`; folder open accepts only an existing report id and resolves the configured directory
in the main process. Run Artifacts consumes the real `ConcurrentRunReport`, renders
`scenarioName`/`instances.length`, exports the full permission-gated record, and hides actions without
permission.

**Final result:** `verify:reports-populated-gui` **64/64**, evidence
`test-artifacts/reports-populated-gui/2026-07-26T09-30-15-417Z/`. Regressions: Reports 31/31,
telemetry 61/61, observability 65/65, Runtime Analytics 36/36 (normal/empty/migration/high-data),
real-Electron RBAC 51/51, IPC contract 4/4, type-checks and build pass. The initial parallel
RBAC/Runtime launch collided during Electron startup; serial reruns are green and no orphan process
or port remained.

Case truth remains conservative: SYS-REP-002/003 are now PASS; populated subsets of
SYS-REP-004–012 and the authorization/path subset of SYS-REP-015 passed, but those cases remain
`NOT RUN` until every specified subcase executes. Actual Windows Explorer launch, five-workflow cap,
live/backpressure transitions, fault injection, denial-audit persistence and accessibility were not
executed. Reports stand at **5 PASS / 11 NOT RUN**; after the Settings campaign the combined focused
ledger has **41 NOT RUN**.

## REC-018 complete — real Recorder save/restart/replay gate is 41/41 (2026-07-26, current)

`scripts/verify-recorder-e2e.mjs` now proves the decisive Recorder journey in a real Electron app on
an isolated first-run profile: Recorder page → bundled Chromium → six recorded steps → Stop → Save to
Flow Library → full app restart on the same data root → visible Flow Library reopen → production
`ExecutionEngine` replay → Flow Designer open/no-op save → second production replay.

**Replay honesty is negative-controlled.** `/recorder-lab?rec018=1` remains double-gated on the query
and the Recorder-only `window.__awtkit_recordAction` binding. A resettable in-memory mock-site oracle
records only the fixed synthetic form values. The verifier resets it after capture and before each
run; because the page harness is inert during production replay, the matching server-side submission
can only be produced by the replayed `goto,fill,fill,select,check,click` sequence.

**Result:** `npm run verify:recorder-e2e` **41 PASS / 0 FAIL**. Both runs completed every node in exact
order, wrote valid JSONL logs, run reports and recovery state, reproduced the expected target values,
and excluded the authentication password from reports/logs. The designer round-trip preserved
Recorder locator/value/wait metadata and node/connector order. Evidence:
`test-artifacts/recorder-e2e/2026-07-26T08-59-26-977Z/`.

Regressions: `verify:mock-site` **90/90**, `verify:recorder` 78/0, `verify:recorder-flow` 19/19,
`verify:recorder-draft` 17/17, `typecheck:scripts` and production build pass. The first preflight
correctly exposed a harness configuration error (isolated `LOCALAPPDATA` hid the developer browser
cache); the gate now forces the supported production-offline bundled-Chromium path. No product defect
was found, and no CAPTCHA, MFA, protected login, or security control was bypassed.

## Phase 2 — Oracle local gates all green; two doc defects withdrawn (2026-07-26)

Every Oracle gate not needing a live database was re-run at `94c858e`: **13 non-GUI verifiers
350/0**, `verify:oracle-mock-ui` 36/0, `verify:oracle-drivers-gui` **30/30**,
`verify:oracle-mock-ui-workflow` **7 PASS / 0 FAIL / 1 BLOCKED**, `validate:offline` PASS.

**`benchmark:oracle-jdbc` was RED and is now 9 PASS / 0 FAIL** (`dce4204`, bd `awkit-cww` CLOSED) —
**because the statistic was fixed, not because memory behaviour improved.** See
`EXECUTION_RESULTS.md` for the full ledger. The gate keys on floor rise (min last third − min first
third) with the original 150 MB/200 MB budgets unchanged. Clean idle-host run: 18.2M queries at
9,746/s, `failures=0`, Node floor 137 → 245 MB (**+108, 72 % of budget**), bridge floor −1 MB.

Two things recorded there that contradict earlier notes in this file's history:

- the old endpoint-delta verdict was roughly right for the wrong reason — every trend statistic on
  the original series pointed the same way, harder;
- **the concurrent-load confound hypothesis is refuted** — the idle run is *worse* on every
  peak-sensitive statistic (slope +1460 vs +1106 MB, endpoint +1219 vs +651, peak 2472 vs 1872).

**`awkit-q0e` RESOLVED (`c6d4547`) — there was never a product leak.** The growth was the harness
measuring itself: `latencies` accumulated one element per query (502 MB live at 18.2M queries) and the
sampler ran `[...latencies].sort()` **every 60 seconds**, a ~500 MB copy per tick. Replaced with a
fixed-bucket histogram (18.2M samples → 0 MB). Separately, RSS on Windows is the working set and the
OS trims it independently of the process (measured: `rss` 499 → 5 MB with `heapUsed` unchanged at
470 MB), so the verdict moved to `heapUsed` with the 150 MB budget unchanged.

Full 30-min soak with the fixed harness: **9 PASS / 0 FAIL**, 23,458,521 queries at 13,030/s. Heap
floor 11 → 8 MB (**−3**), peak 24 MB; RSS flat 78 → 78 MB, peak 80 MB. Same workload before vs after:
peak RSS **2472 → 80 MB**, throughput **9,746 → 13,030/s (+34 %)**, max latency **36,727 → 4,681 ms**.
The harness was burning a third of the machine on its own accounting.

**Still open (`awkit-1ts`, P3):** `oracle-soak.json` is overwritten by any-length run, so a smoke run
silently replaces release evidence; a run with <2 samples also passes the memory invariants trivially.

Two long-standing "gates" turned out not to be defects:

- **`verify:oracle-drivers-gui` 25/30 → 30/30.** The five "environmental/inconclusive" Oracle
  bridge/Java/ojdbc checks pass once `build:oracle-bridge` + `prepare:oracle-runtime` have run. The
  cause was an unbuilt bridge in that worktree, not a product gap. No waiver needed.
- **The "0 MB packaged Oracle driver bundle warning" never existed.** `validate:offline` emits no
  Oracle warning and exits 0. The line was a bare informational `Write-Host` printed *after* every
  Oracle check passed. Measured bundle: `bridge/awkit-oracle-jdbc-bridge.jar` 40,550 B + manifest
  2,131 B + checksums 212 B = **42,893 B**, which `[math]::Round(x/1MB,1)` renders as `0 MB`. The jar
  is present and non-zero, so this is not the missing-bridge defect — it is the enforced
  user-selected-driver layout (the validator *fails* if a JRE or `lib\*.jar` is found). Fixed by
  reporting KB below 1 MB; **no driver or JRE was vendored**.

**Historical finding (corrected 2026-07-29): ORA-LIVE-001 was blocked by two things, not one.**
At this point `scripts/verify-oracle-mock-ui-workflow.mts` had no real-mode code path. That
engineering gap is now fixed; complete authorized configuration selects the real JDBC path and
fails closed otherwise. Bead `awkit-7bu` remains blocked only on the operator-controlled database
fixture and ephemeral credential lifecycle.

## AWKIT-E2E-001 fixed — comprehensive campaign is 9/9 (2026-07-26)

The one confirmed open product defect is closed (bead `awkit-3eo`). A flow-level `manualApproval`
connector was never routed: `FlowExecutor.resolveNext` had precedence for outcome, conditional,
loop-back, success, always and legacy `next`, but no `manualApproval` case, so a `manualHandoff` node
whose only outgoing edge was `manualApproval` reported `passed` while End never executed.

- **Routing fix:** `resolveNext` now selects a `manualApproval` target immediately before the
  `success`/`always` fallback, and **only** when the step reports `outcome === "manualContinued"` —
  the outcome `StepExecutor` sets exactly when an operator chose to continue. A cancel throws inside
  `waitForHandoffAction`, so a cancelled handoff fails the step and never reaches routing. It is
  deliberately not a general success edge; an ordinary node never traverses one.
- **Skipped-approval guard:** when routing dead-ends at a node whose only outgoing edge is an
  ungranted `manualApproval`, the flow finishes `failed` naming the step and the skipped target,
  instead of reporting `passed`. Without it the same silent-success symptom simply relocates.
- **Deliberately excluded:** `outcome === "sessionCaptured"` does not enable the edge (automatic
  session reuse is not an approval), and `PlaywrightRunner.resolveNextFlow` — the workflow-level
  equivalent, which already treats `manualApproval` as a continuation link — was left unchanged.
- **A node cannot carry both `success` and `manualApproval`:** both are `normal` connectors, so
  `multipleStandardOutgoing` structural validation rejects that pair before execution. Precedence
  between them is unreachable for valid persisted flows.
- **Verified:** `verify:runner` **89/0** (84 + 5 new; failed 3/5 before the fix, with both negative
  controls already passing), `verify:comprehensive-e2e` **9 PASS / 0 FAIL**, `verify:concurrency`
  78/0, `verify:waits` 56/0, `verify:popup` 12/0, `verify:cancellation` 12/0, `verify:artifacts` 13/0,
  `verify:flow-step-mapping` 101/0, `typecheck` and `typecheck:scripts` clean.
  Evidence: `test-artifacts/comprehensive-e2e/2026-07-26T00-01-06-419Z/`.
- **Packaged too:** `package:portable` was rebuilt and `verify:packaged-walkthrough` re-run against
  it — **70/70** (69 + the new staleness check below). The fix is confirmed present in the packaged
  payload (`out/main/main.js`, which electron-builder packs into `app.asar`).

### `verify:packaged-walkthrough` now refuses a stale packaged tree

The verifier drove whatever sat in `dist/win-unpacked` with **no freshness check**, so a packaged run
was only as trustworthy as whoever remembered to repackage first — a green result could describe code
no longer in the tree. Part A now refuses when the newest file under `src/` or `app/` is newer than
the packaged payload, naming the offending file and both timestamps.

Negative-controlled: touching `src/runner/FlowExecutor.ts` made it exit 1 with the STALE diagnostic;
the file was then confirmed byte-identical to its pre-test copy and to `HEAD` (the control changed
only the mtime). Same class of trap as the stale Zvec host tree in `HANDOFF.md`.

## Unified validation remediation prompt (2026-07-26, current)

`docs/testing/comprehensive-validation/FULL_VALIDATION_REMEDIATION_PROMPT.md` is the execution-ready
implementation brief for all three validation campaigns: comprehensive E2E, Oracle JDBC/row-driven
workflow, and Recorder/Reports/Settings. It carries forward the 8/1 comprehensive ledger, 7/0/1
Oracle workflow ledger, and all 66 focused page cases; separates failures from blocked/not-run
gates; prioritizes `AWKIT-E2E-001`; reconciles generic-live versus exact-workflow Oracle status and
the user-selected-driver packaging model; and requires REC-018 plus populated Reports and complete
Settings journeys.

## Recorder, System Reports, and Settings focused test cases (2026-07-26, current)

`docs/testing/comprehensive-validation/RECORDER_REPORTS_SETTINGS_TEST_CASES.md` now defines 29
Recorder cases, 16 System Reports cases, and 21 Settings cases with concrete preconditions, steps,
expected results, safety controls, and `PASS`/`BLOCKED`/`NOT RUN` status.

- Recorder component suites are green: capture/locators/Smart Waits 78/78, flow conversion 19/19,
  draft/URL persistence 17/17, async review 21/21, protected detection 45/45, HTTPS 49/49, popup
  identity 43/43, and designer/profile round-trip 26/26.
- Reports are green for empty-state GUI 31/31, populated GUI 64/64, telemetry 61/61, observability
  65/65, Runtime Analytics 36/36, and RBAC 51/51. SYS-REP-002/003 are PASS; exact residual
  drill-down/live/fault/audit/accessibility submatrices remain `NOT RUN`.
- Settings are green for persistence 3/3, capacity GUI 12/12, HTTPS GUI 31/31, accent 33/33,
  branding 30/30, secrets backend 16/16, and Database Drivers GUI 30/30. Paths, general validation,
  Secrets GUI, import/export, reset/data preservation, authorization, and accessibility remain open.
- REC-018 is now green at 41/41 with restart persistence, two production replays, Flow Designer
  metadata preservation, and evidence. Other focused Recorder cases retain their individual status;
  this pass does not infer results for cases it did not execute.

## Oracle mock-UI fixture (2026-07-26, current)

`SPECTER_MOCKUI.MOCK_FORM_CASES` is a new 8-row fixture whose columns map 1:1 onto the Feature Test Lab
form at `/form`, so the Oracle Data Source node can be tested **driving a UI workflow**
(`SELECT → fill form → assert /success`) rather than only for type conversion. Bead `awkit-v8x`.

- **Real Oracle:** `scripts/oracle/local-19c-mock-ui-fixture.sql` — schema-only owner `SPECTER_MOCKUI`,
  least-privilege `SELECT` to `SPECTER_READER`, private synonym, idempotent. **Not yet provisioned on the
  local 19c** (needs SYSDBA + an ephemeral reader password).
- **Database-free twin:** `MockFormCasesFixture` — the bridge's mock executor serves the same 8 rows for
  any statement naming `MOCK_FORM_CASES`, so the identical SQL and workflow run with no DB and no driver.
  It mirrors the real JDBC conversions (`NUMBER(12,2)` → 2-decimal **string**; `DATE` →
  `Timestamp.toInstant()`, JVM-zone dependent) rather than hardcoding values. Packaged builds still refuse
  mock mode — this changes nothing about the fail-closed rule.
- **Persisted fixtures:** `mock-oracle-form-cases.json`, `mock-oracle-form-flow.json`, and
  `mock-oracle-form-workflow.json`. The flow maps every compatible `/form` control, routes radio and
  checkbox choices from `currentRow`, captures populated/success/blocked screenshots, disables automatic
  retry on Submit, and gives the terms-declined row an explicit expected-block terminal.
- **Runtime fixes found by the end-to-end run:** `ExecutionEngine` now carries `currentDataRow` into
  `InstanceExecutionContext.currentRow`; structured flow connectors can resolve `currentRow.*`; Oracle
  DATE ISO instants are normalized for `<input type=date>`; `/form` now enforces required terms.
- **Verified:** `verify:oracle-mock-ui-workflow` **7 PASS / 0 FAIL / 1 BLOCKED** (live Oracle only),
  `verify:oracle-mock-ui` **36/36**, `verify:oracle-bridge` **32/32**, `verify:runner` **84/84**,
  `verify:concurrency` **78/78**, `verify:mock-site` **84/84**, script type-check and production build.
  Evidence: `test-artifacts/oracle-mock-ui-workflow/2026-07-25T22-36-01-353Z/`.
- **Open:** the same persisted workflow has not been run against real 19c; that requires SYSDBA
  provisioning plus the authorized ephemeral `SPECTER_READER` credential lifecycle.

## Workflow: single branch, continuous implementation (2026-07-25, current)

**Push is UNBLOCKED and `origin/main` is current** at `3128fdf`. Consolidation is complete: `main`
is the only branch locally and remotely (plus Beads' `__dolt_remote_info__` ref), no extra
worktrees, and all eight former branch tips are preserved as pushed `archive/*-20260725` tags.

`main` is the ONLY development branch. No feature/fix/chore/docs/test/spike/backup branches, no task
worktrees, no freeze-before-commit. See `docs/ai/BRANCH_AND_COMMIT_POLICY.md`.

**Consolidation done 2026-07-25:** every branch and worktree was integrated into `main` and removed;
all tips preserved as `archive/<name>-20260725` tags. `main` is the only local branch.

**Push is BLOCKED:** `origin/main` is protected - `GH013: Changes must be made through a pull
request`. All work since `5dbe25f` (39 commits) exists **locally only**. Remote branches are
deliberately NOT deleted until `origin/main` contains the integration, because a remote feature
branch may currently be the only remote copy of that work.

## Zvec semantic subsystem - Phase 1A COMPLETE (2026-07-25, current)

Zvec ships as a raw, unbundled Electron **utility-process** host via `extraResources`
(`resources/native-hosts/zvec/`), never inside `app.asar`. Phase 0-0D evidence is in
`docs/ZVEC_PHASE_0_COMPATIBILITY_REPORT.md`.

**Phase 1A landed so far:**
- `src/semantic/contracts/ZvecHostProtocol.ts` - versioned protocol, stable path-free reason codes,
  bounded timeouts, retry classification (mutations are NOT retryable after a host exit).
- `src/semantic/SemanticGenerationLayout.ts` - on-disk layout + `isConfinedGenerationPath`,
  independently duplicated in the host so an IPC gap cannot become filesystem access.
- `src/semantic/ZvecHostRestartPolicy.ts` - pure, clock-injected restart + circuit breaker.
- `src/semantic/SemanticGenerationReconciler.ts` - startup reconciliation, retention, quarantine.
- `app/main/semantic/ZvecUtilityHostManager.ts` - utilityProcess lifetime, correlated requests,
  deadlines, compatibility gate, staged shutdown.
- `app/main/semantic/semanticService.ts` - reconcile on startup, dispose on quit. **No IPC, preload
  API, renderer surface, indexing or embeddings** - those are later phases.
- `main.ts`: the Phase 0 spike hook is **REMOVED**; shutdown is now staged (semantic host closes on
  its own bounded budget before the existing settings/Oracle/security stage).
- `native-hosts/zvec/zvec-host.cjs`: the `__testAbort` crash-injection handler is **REMOVED**.

**Verifiers:** boundary 22/0, host-lifecycle 52/0, generation-recovery **134/0** (was 34; +100
damaged-pointer regression checks), generation-lifecycle 102/0, generation-concurrency 12/0,
packaged-live 35/0 (packaged AND NSIS-installed trees), coexistence 16/0.

**`npm run typecheck:scripts` and `npm run verify:all-typecheck` are GREEN again** (2026-07-25).
They had been red since the randomized-test-lab consolidation. The recorded cause was wrong — see
`KNOWN_ISSUES.md`; the real causes were a type-erasing `byId` helper, `Parameters<>` used on a class
instead of `ConstructorParameters<>`, and an over-narrow `assertDenied` signature.

**Invariants now enforced and guarded by tests:**
- The **active-generation pointer is authoritative everywhere**. Reconciliation receives it as a
  required parameter and never derives active identity from `metadata.json`; a valid pointer protects
  its generation unconditionally, whatever state metadata is in.
- **A pointer that cannot be read is not a pointer that is absent** (2026-07-25, bd `awkit-9rd`).
  `readActivePointerStrict` distinguishes `ok | missing | invalid | unreadable` and validates all
  three pointer fields; `reconcileGenerations` takes a three-state `ActiveGenerationIdentity`
  (`known | none | unknown`) rather than `string | null`. Under `unknown` nothing is discarded,
  quarantined, or retention-trimmed, `recoveryRequired` is set, and health reports
  `ACTIVE_POINTER_READ_FAILED`. Before this, a corrupt pointer read as "no active generation" and an
  unclean shutdown then deleted **every** generation including the live one.
- A rebuild never mutates the active generation; the pointer write is the commit point, and no later
  failure may delete an activated generation.
- Zvec is unreachable from the main process (not even resolvable) and ships only as `extraResources`.

**Phase 1A completion added:** `SemanticGenerationManager` (create/validate/activate/rollback with
an atomic pointer swap; a rebuild never mutates the active generation),
`contracts/SemanticHealth.ts` (seven distinct degraded reasons, `indexPath` privileged and omitted
by default), `verify:zvec-packaged-live` (manager-driven, real Electron, no production hook),
`verify:zvec-coexistence`, and installed-NSIS-layout verification.

**Verifier totals:** boundary 22/0, host-lifecycle 52/0, generation-recovery 31/0,
generation-lifecycle 56/0, packaged-live 35/0 (packaged AND installed), coexistence 16/0, installed
NSIS matrix 10/10.

**Still open:** the host is not reachable from any product surface (by design - Phase 1B+); CPU
utilisation still unmeasured (the Phase 0D sampler was invalid); Authenticode signing and
SmartScreen reputation unaddressed.

## Zvec Phase 1B - sanitisation pipeline, stores and mutation queue (2026-07-25, current)

Items 1-10 of the Phase 1B plan are implemented on `main`. Still reachable from **no product
surface** - renderer/preload APIs, semantic IPC, automatic indexing, UI, failure memory, locator
memory, embeddings and RAG remain explicitly out of scope.

**The pipeline (order is mandated - nothing may enter a queue before sanitisation exists):**
`SemanticProjection` (allowlist) -> `SemanticRedactor` -> `SemanticPolicyValidator` -> branded
`ValidatedSemanticDocument` -> `SemanticStore` -> `SemanticMutationQueue`.

- **Projection is the primary privacy control**, and it runs FIRST. Redaction is a filter (it leaks
  whatever it fails to recognise); projection is a structural exclusion (an unlisted field is never
  read). Captured input values, storage state, cookies, raw errors and full URLs are structurally
  excluded; bounded derived forms are allowlisted instead (`errorCategory` not the error text,
  `hostname` not the URL, `locatorStrategy` not the matched element text).
- **`ValidatedSemanticDocument` is branded on a module-private symbol**, so only the policy pipeline
  can mint one and the stores/queue accept nothing else - a type-checked guarantee, probe-verified.
  Honest limit: a double assertion can defeat any TS brand; `Object.freeze` covers runtime tampering.
- **The validator independently re-scans already-redacted content.** Not redundancy - the redactor is
  the component most likely to have a pattern gap, and this stage refuses rather than cleans.
- **Two store implementations run the SAME contract suite** (`SemanticStoreContract`, kept in `src/`
  for exactly that reason): `InMemorySemanticStore` (real semantics, also the degraded-mode fallback
  and rebuild parity oracle) and `ZvecSemanticStore` (the only file that knows Zvec wire shapes;
  transport injected, so it stays framework-agnostic). Running both caught a real divergence in `reasons`.
- **The queue** is serialized, coalescing, bounded, and biased against dropping deletes: a dropped
  upsert is recoverable staleness, a dropped delete leaves content indexed that should be gone. When
  only deletes are pending, enqueue is REFUSED rather than dropping one. **No blind replay** - only
  classified-retryable failures are retried, boundedly; anything else marks the index rebuild-required.

**Verifiers:** `verify:semantic-policy` 135/0, `verify:semantic-store` 102/0 (both implementations),
`verify:semantic-queue` 70/0, `verify:source-hygiene` 7/0. All negative-controlled. Taxonomy 111 -> **127**.

### Review-round corrections applied (2026-07-25)

Two defects found in review were privacy-affecting and are fixed:

1. **Projection bypass.** `buildValidatedDocument` accepted a free-form `body`, which projection
   never saw — so privacy fell back entirely on redaction patterns. The pipeline is now staged and
   branded (`raw source -> ProjectedSemanticCandidate -> ValidatedSemanticDocument`); only the
   per-kind projectors in `SemanticProjection` can construct a candidate, and they derive title,
   content, tags and every filter dimension from allowlisted fields alone.
2. **`deleteEntity` reordered behind a later upsert.** `drain()` globally regrouped batches by
   operation type, so `upsert X` then `deleteEntity X` executed as `deleteEntity` then `upsert` —
   resurrecting the document. Fixed with two independent defences: sequence-ordered adjacent-run
   batching, and `deleteEntity` cancelling pending upserts for its entity.

Also corrected: **document identity** (current-state kinds are now stable across revisions so a
re-index REPLACES; historical kinds keep per-occurrence identity — `SEMANTIC_KIND_IDENTITY`), ids
carry a canonical-identity hash against normalization/truncation collisions and are computed by the
factory; **truthful upsert counts** (`countsKnown`); **runtime field validation** (id/kind
agreement, sourceHash format, timestamps, outcome enum, hostname shape, reference consistency,
embeddings rejected unless explicitly enabled); **drain is single-flight**; queue options validated.

### Entity operations now work — the recorded blocker was wrong (2026-07-25, bd `awkit-8lj` CLOSED)

The previous round declared `deleteByEntity`, `stats` and `clear` **UNSUPPORTED** because "the host
has no scan or cursor and `query` is top-K capped at 100". **That premise was incorrect.** The cap
was AWKIT's own `Math.min(topK, 100)` inside `zvec-host.cjs`, and the vendor exposed what was needed
all along. Established by *executing* the binding rather than reading its `.d.ts`
(`verify:semantic-zvec-filter`, 63/0):

- `deleteByFilterSync` exists, so an entity delete needs no scan.
- `filter` is a **PRE-filter**, applied before ranking. Proven discriminatingly: with a filter a
  needle ranked last of 1501 is found at `topk: 10`; the unfiltered top-10 excludes it.
- `topk` is not vendor-capped (1500 requested → 1500 returned).
- `fetchSync` returns full field values, and `outputFields: []` returns ids with no fields — which is
  what lets an exact-count pass avoid materialising document bodies.

**Host protocol is now v2** (breaking: `fetch`/`query` return documents; `scan`/`count`/
`deleteByFilter` added). `capabilities.entityOperations` is `true`, so the shared contract suite runs
Zvec through the same positive assertions as the in-memory store instead of asserting a refusal.

**Filters are typed clauses; a filter STRING never crosses `SemanticStore`.** The host builds the
expression itself from a field allowlist — duplicated deliberately, as `assertConfinedPath`
duplicates `isConfinedGenerationPath` — so an IPC validation gap cannot widen a delete. The two
copies are drift-checked.

**The value rule is a refusal, not an escaper**, because measurement showed no escaper is correct:
escaping only quotes throws a lexer error on backslash values, and escaping both **silently matches
nothing** (`ok: true`, zero rows deleted — the exact silent-under-delete this subsystem refuses).
Backslash and control-character values are rejected; quotes are escaped as `\"`.

A filtered delete is verified inside the host (count → delete → re-scan) and reports
`SEMANTIC_DELETE_INCOMPLETE` rather than a successful partial. A count that hits the host's scan
bound reports `exact: false` and the adapter refuses it.

### Three defects the transport fake could not catch

The fake encoded the protocol as *intended* while the host implemented something else, so a green
suite hid all three. Each is now fixed and guarded:

1. A `nullable` STRING field **rejects an explicit `null`**, failing the whole batch.
   `toZvecDocument` wrote `?? null` for all seven optional fields, so against the real host every
   document with an absent optional — the common case — was rejected. Absence is now written by
   OMISSION. The fake now rejects nulls too: reinstating `?? null` crashes the suite before any
   `[zvec]` check runs.
2. `fetch` returned `Object.keys(...)` — bare id strings — while the adapter read `.id` off each
   row, breaking `get`, the delete presence check and the upsert insert/replace split.
3. `SEMANTIC_SCHEMA` used `type:` where the host reads `dataType`, hidden by an
   `as unknown as ZvecSafeSchema` cast; every field would have been created with
   `dataType: undefined`. The cast is gone.

`totalMatched` was also a silent undercount past 100 matches (it reported the fetch window). The host
now computes the true pre-truncation total. **The existing `topK: 1` assertion could not catch this**
— against a three-document fixture "candidates fetched" and "documents matched" are the same number,
so it passed with the defect present. A contract block indexing 130 documents now makes it
discriminating for both implementations.

**Still not covered by any verifier:** native crash isolation, real FTS ranking quality, and on-disk
durability.

---

## Zvec Phase 1B - real-host contract + rebuild orchestration (2026-07-25, current)

`main` @ **`67835cd`** (== `origin/main`).

### The store now runs against a real utility process (`d208c64`)

`verify:semantic-zvec-native-contract` drives
`ZvecSemanticStore → ZvecUtilityHostManager → utilityProcess → raw host → Zvec` in a real Electron
application process — **21/0**, with the shared contract suite passing **68/68** against the real
binding. It refuses a host tree that is not byte-identical to `native-hosts/zvec/zvec-host.cjs`
(its first ever run silently tested the stale protocol-v1 host from `dist/win-unpacked`).

It found three defects that the transport fake had concealed:

1. `open` returned `{generation}` while the adapter read `collectionId` → `BACKEND_UNAVAILABLE` for a
   collection that had opened fine.
2. **Zvec rejects `:` in a document primary key, and AWKIT ids are `kind:component:hash` — so no
   document could ever have been written to a real index.** Every test passed because the fake used a
   `Map`, which accepts any string. Accepted charset is `A-Za-z0-9 - _ . @ # + =` plus a length bound.
   The backend key is now derived (`toZvecDocumentKey = sha256(id)`) and the AWKIT id travels in the
   `id` field, where colons are legal; results always report the original id, never the hash.
3. `fts: {}` is rejected rather than treated as match-all, so every filter-only search (`text: ""`)
   would have failed. Filter-only searches now send a scalar query with an explicit match-all clause.

`FakeZvecHostTransport` enforces the real key charset and rejects an empty full-text clause, so this
class of defect cannot recur silently.

### Rebuild orchestration (`awkit-ttd`, `67835cd`)

`SemanticRebuildOrchestrator` plus a queue watermark and ordered delta journal:

    drain prior active writes → watermark W, start journalling → populate the candidate while normal
    mutations keep flowing to the ACTIVE generation and are also journalled → validate → pause
    draining, replay the post-W journal into the candidate in order, revalidate → close the
    candidate, swap the pointer, retarget, resume draining → only then clear rebuildRequired

The pointer swap is the single commit point; every pre-activation failure leaves the active pointer,
the pending queue and the journal intact. `queue.clear()` is never called on activation — that is
precisely what would discard a user's mid-rebuild changes. The journal never drops an entry: overflow
is recorded and refuses activation. Delta completeness is judged against the **captured** entry set,
because a mutation accepted during the replay is still pending and drains against the new generation.

`verify:semantic-rebuild` **56/0** (it opened at 42/5; the failures were one real orchestrator bug and
two defective negative controls — see `TASK_LOG.md`).

**Verified at `67835cd`:** `build` · `tsc --noEmit` · `typecheck:scripts` ·
`verify:semantic-zvec-native-contract` 21/0 · `verify:semantic-rebuild` 56/0 ·
`verify:semantic-store` 151/0 · `verify:semantic-queue` 70/0 · `verify:semantic-zvec-filter` 89/0 ·
`verify:semantic-policy` 141/0 · `verify:zvec-generation-lifecycle` 102/0 ·
`verify:zvec-generation-recovery` 134/0 · `verify:zvec-generation-concurrency` 12/0 ·
`verify:zvec-host-source-boundary` 22/0.

### Packaged and NSIS-installed layouts — VERIFIED (bd `awkit-9yv`)

A fresh `package:portable` + `package:installer` were built from `5311d57`:

- `verify:zvec-packaged-assets` — 17/17 checksum-verified.
- `verify:semantic-zvec-native-contract` — **21/0 against the PACKAGED tree**
  (`dist/win-unpacked`), shared contract suite 68/68. This is the proof that what *ships* satisfies
  the contract, not merely what is staged.
- `verify:zvec-packaged-live` — **35/0** (was 33/2; see the vacuous-check note below).
- `verify:zvec-coexistence` — 16/0 (Playwright workflow pass count unchanged under Zvec load).
- **NSIS installed layout** via `scripts/zvec-harness/run-installed-live.ps1` — installed per-user
  **unelevated**, host present, binding outside `app.asar`, live suite **35/0 against the installed
  tree**, then uninstalled cleanly (host tree gone, HKCU key cleared, no directory residue).

`resources/dependency-manifest.json` now records `hostProtocolVersion: 2` and the 23,458-byte v2
host, replacing the stale v1 entry. It is generated by packaging — **do not hand-edit it.**

**A shipped check had been passing vacuously since protocol v2.** `query` changed from `{ hits }` to
`{ docs, truncated, totalMatched, totalExact }`, but the packaged harness still read `r.hits`.
`if (r.hits === 0) throw` is false when `hits` is `undefined`, so `ftsQueryMatches` asserted nothing
for an entire protocol version; only its negative twin failed loudly enough to expose the drift.
Fixed in `5311d57`. **When a reply shape changes, grep every reader of the removed field — a check
reading a now-undefined field usually fails OPEN.**

**`whenIdle()` is now bounded by wall-clock** (`002e684`), not only by its 8-iteration loop: an
iteration bound does not bound time, and a wedged rebuild would have held shutdown open indefinitely.
It takes a deadline (default 30s) and returns `false` when the deadline wins.

---

## Zvec Phase 1B - the orchestrator is bound to the real generation runtime (2026-07-25, current)

`src/semantic/SemanticIndexRuntime.ts` is the production layer between the orchestrator and the real
generation lifecycle: it owns the ACTIVE store, the mutation queue, and the transition between
generations. `verify:semantic-rebuild-live` drives orchestrator → generation filesystem →
`ZvecSemanticStore` → `ZvecUtilityHostManager` → `utilityProcess` → raw host → real Zvec.

### Two defects a lifecycle stub could not express

Both made the production rebuild path unusable, and neither was reachable from the contract suite:

1. **The rebuild path could never have run.** `createGeneration` allocates by `mkdir` WITHOUT
   `recursive` — that mkdir *is* its atomic claim against two rebuilds picking the same name — so
   every real candidate reaches the host as an existing EMPTY directory. **Measured** vendor
   behaviour: `ZVecCreateAndOpen` throws `path validate failed` for *any* existing directory, and
   `ZVecOpen` needs a real collection. An empty directory could therefore be neither created into nor
   opened, and populate failed every time. The host now distinguishes three cases and removes an empty
   directory with `rmdirSync` — never `rm -r`, so it can only ever discard a directory holding nothing.
   The contract suite missed it because it invents generation names whose directories do not exist, so
   it only ever took the create path.
2. **A rebuild overlapping a delete could never activate.** Post-replay validation sampled the
   snapshot and asserted each sampled document was present, but a post-watermark delete of a
   snapshotted document is a *correct* outcome — read as corruption
   (`SEMANTIC_REBUILD_SAMPLE_MISSING`) and the rebuild refused. Deleting during a rebuild is exactly
   what the delta journal exists to support. Replay now reports the ids/entities it touched and
   validation excludes them: **the snapshot is authoritative only for documents the delta did not
   change.** The same applies to upserts, whose content is legitimately newer than the snapshot's
   `sourceHash`.

### Post-activation policy (the pointer swap is irreversible)

When activation commits but the new generation will not open, the runtime **never** reverts the
pointer and **never** resumes writing to the previous generation — that would fork the index into two
histories, one unreachable after the next restart. Writes stop, the pending queue is preserved, a
bounded reopen is attempted, and health reports `ACTIVE_GENERATION_OPEN_FAILED`. The enforcement is
structural, not a flag anyone must remember to check: the queue is retargeted onto a store that
**refuses every operation**, so a stray `drain()` cannot reach the superseded generation.

### Bounded shutdown is wired into the real Electron path

`disposeSemanticSubsystem` drains the queue and any in-flight rebuild before the host is stopped, and
`main.ts` races that stage against its own 3s ceiling. A shutdown that hits its deadline deliberately
does **not** call `markIndexClosed`, so the session stays marked unclean and startup reconciliation
finishes the job — marking it clean because the process is exiting anyway is how an interrupted write
becomes invisible.

**NOT run:** `validate:offline`, `verify:runner`, mock-site verifiers, signing/SmartScreen, and the
clean-machine walkthrough (optional/non-blocking by owner policy).

**Next:** the semantic subsystem is still reachable from **no product surface** — nothing registers a
runtime via `setSemanticIndexRuntime`, so shutdown currently has nothing to drain. That is the
authorized semantic service, RBAC, preload/API boundary, projections, Settings controls and search UI.
Phase 1B infrastructure is complete.

## Zvec Phase 0/0B/0C/0D - GO WITH CONDITIONS (2026-07-25, superseded by the section above)

Zvec ships as a raw, unbundled Electron **utility-process** host via `extraResources`
(`resources/native-hosts/zvec/`), never inside `app.asar`. Full evidence in
`docs/ZVEC_PHASE_0_COMPATIBILITY_REPORT.md`.

**Proven:** packaged + installed CRUD via `utilityProcess.fork`; per-asset SHA-256 verification of
the final package; path confinement; restart persistence across app launches; native abort contained
(exit 134 detected in 84.62 ms, app survived and still served IPC); per-user NSIS
install/launch/relaunch/uninstall without elevation; FTS p50 4.42 ms (n=1000); main-process RSS
growth +1.77 MB; real Playwright workflow 84/0 across five coexistence scenarios.

**NOT proven / open:** production restart policy + circuit breaker (deferred to Phase 1A);
generation reconciliation after unclean shutdown (5 orphaned generations / 110.8 MB observed); CPU
utilisation (sampler invalid, withheld); coexistence scenario 4 counters (inconclusive); degraded-mode
items D4-D6 (vacuous until a real semantic capability exists); signed-binary SmartScreen reputation.

**Phase 1A has NOT started.** The spike hook in `app/main/main.ts` and the `__testAbort` handler in
`native-hosts/zvec/zvec-host.cjs` are still present and MUST be removed before release.

## Backend SRS Tranche 2A — FR-C1 deterministic page identity (2026-07-24, latest) — draft PR, NOT merged

Implemented **SRS-BAO-001 FR-C1 (Deterministic page identity)** — defect **`awkit-ebh`**. Branch
`feature/backend-srs-tranche-2a-popup-identity` off `main` **`5dbe25f`** (which already contains the
merged FR-B2 / PR #35 work described in the section below). **Draft PR, not merged.**

- **The defect (live, reproduced).** Two independent call sites registered the same popup:
  `PlaywrightRunner`'s context-level `"page"` handler under a positional `popup-${counter}` key, and
  `StepExecutor`'s click / `switchToPopup` paths under the recorded alias. One `Page` was therefore
  reachable under two aliases, and identity followed **arrival order**. Measured directly against the
  new fixture: with the old code `popup-1` resolves to the *alpha* popup when opened alpha-first and
  to the *beta* popup when opened beta-first — a flow replaying in the other order silently acts on
  the wrong window.
- **The fix — ownership inversion, not deletion.** New `src/runner/runtime/PopupIdentityRegistry.ts`
  owns both directions (`alias → Page` **and** `Page → alias`). The context `"page"` event is the
  **single observation point**; step paths no longer register anything — they **claim** the `Page`
  object they awaited, which atomically promotes it from its synthetic alias to the recorded one and
  drops the synthetic key in the same operation (C1.2). Neither call site was naively removed: each
  covered a case the other did not.
- **Deterministic synthetic identity (C1.3).** Unrecorded (script/timer/redirect) popups get
  `popup-<sha256(origin + normalized path) first 12 hex>` — a fixed neutral prefix plus a hash that
  **never echoes its inputs**. Query strings and fragments are **never read**, so a `?token=…` /
  `#…` is structurally unable to reach an alias or a diagnostic. Deliberately excluded as
  timing-dependent: the **active step id**, **`window.name`**, and the **opener alias** — folding any
  in would reintroduce the run-to-run instability C1.5 forbids (rationale in the scope doc).
- **Ownership is browser-context-wide.** Exactly one registry and one `"page"` observer per
  BrowserContext / runtime generation, owned by the runner's `BrowserHolder` and injected into the
  parent flow, every nested child flow, and every parallel-branch executor. `runFlowWithChildren` is
  recursive, so a registry per `StepExecutor` gave one popup two identity owners.
- **Invariants enforced** (`main` reserved; one live `Page` ⇢ one alias; one alias ⇢ one live `Page`;
  atomic rebind; close clears **both** mappings; a closed page neither retains nor blocks its alias;
  a reopened popup may reclaim it; duplicate/ambiguous claims fail loudly). Two live popups sharing
  one identity are marked **ambiguous** — resolving fails with an explicit diagnostic instead of
  guessing.
- **Also fixed: runner-owned branch pages.** Isolated parallel-branch pages share the context and
  raise the same `"page"` event, so they were consuming popup aliases — a recorded `popup-1` could
  resolve to a branch page. They are now marked internal.
- **Prerequisite fixed — `awkit-4t9`.** `flowStepMapping.ts` carried **no** `pageAlias` /
  `opensPopup` / `popupExpectation`, so opening and re-saving a recorded multi-window flow in the
  Flow Designer **silently discarded its popup metadata** — stripping the very alias C1.2 depends on.
  Both directions now map the three fields explicitly (absent stays absent, never invented). The bead
  is marked `closed` citing `ab9f5f6`, which is **not an ancestor of `main`** (it lives only on the
  unmerged `feature/randomized-test-lab`). **`.beads` was not modified** — reconciling the tracker is
  left to the owner.
- **Mock site (added before the fix, per SRS rule C-9):** `/popup/reversed-order.html` (+ alpha/beta
  popups) and `/popup/script-timer.html` (+ timer popup) — the latter carrying a deliberately
  secret-shaped `?token=…&session=…#…` and an ambiguous-pair control. Popup lab index 7 → 9 scenarios.
- **PR #36 review round 1 (four blockers, all fixed).** (1) **Internal-page race** — `markInternal`
  now cancels the identity finalization scheduled while the page was `about:blank`, and the callback
  re-checks internal status; tested in exact production order, asserting the *mechanism* because
  `reconcile`'s eligibility filter would otherwise hide a missing cancellation. (2) **Two identity
  owners** — registry + observer moved to the `BrowserHolder`, one per context/generation, injected
  into parent/child/branch executors; restart rebinds via `resetForNewContext`; a source guard
  asserts exactly one observer installation. (3) **Latched ambiguity** — counters replaced by an
  **identity-bucket model** reconciled on every membership change (close, release, claim, mark
  internal), so a survivor takes the alias automatically. (4) **Sensitive material in aliases** —
  the readable opener prefix removed (`safePathComponent` is filesystem-safe, not secret-safe), and
  every identity diagnostic now runs through `SecretMasker`. A fifth issue the new tests caught:
  `observe()` was not idempotent and leaked a duplicate listener pair per re-observation.
- **Verification (isolated `npm ci`):** build + typecheck clean · **`verify:popup-identity` 43/43
  (new; 25 → 43 after review fixes)** · `verify:popup` 12/12 · **`verify:popup-mock-site` 8 → 11/11** ·
  **`verify:flow-step-mapping` 94 → 101/101** · `verify:runner` 84/84 · **FR-B2 masking intact:**
  `verify:failure-evidence` 34/34, `verify:failure-evidence-live` 17/17,
  `verify:failure-screenshot-precedence` 6/6 · protected gates unchanged (`verify:security` 39 ·
  `verify:ipc-contract` 4 · `verify:auth` 49 · `verify:authz` 40) · `verify:recorder` 78/78 ·
  `verify:clean-machine-policy` 28/28 · verifier taxonomy **reconciled 111** (110 → 111;
  real-browser 37 → 38).
- **Not implemented here:** **FR-C2 frame identity** (Tranche 2B — C2.1 needs a real identity schema
  and fallback resolver, not tests around the existing selector path), FR-C1.8 timeline `pageId`
  (needs FR-A2/Tranche 5), FR-C3, cross-origin frame identity, CDP. **No schema migration.** **No
  `.beads` change; no `bd` run; no release promotion.** Scope + traceability:
  `docs/ai/backend-srs-tranche-2a-scope.md`.

---

## Backend SRS Tranche 1 — FR-B2 immediate failure evidence (2026-07-24) — merged into `main` at `5dbe25f`

Implemented **SRS-BAO-001 FR-B2 (Immediate failure evidence capture)** — the highest-value item in
WS-B and a confirmed **ordering defect**. Branch `feature/backend-srs-tranche-1` off `main` `88c76ed`;
**PR open as draft, not merged.**

- **The defect:** `FlowExecutor.executeWithRetry` captured the failure screenshot **after** the retry
  loop, only for `lastResult` — so intermediate failing attempts got no evidence and a retry that
  navigated destroyed the broken state before capture, and only a single screenshot (no DOM/a11y) was
  taken.
- **The fix:** capture moved **into the retry loop**, per failing attempt, **before** the retry
  decision and any navigation (B2.1). New `StepExecutor.captureFailureEvidence(step, { attempt })`
  captures **screenshot + DOM HTML + accessibility (aria) snapshot + page meta (URL/title)**, each
  **secret-masked** (FR-H1), each **individually bounded** (5 s) so a hung page can't block the
  failure path (B2.6). Evidence is **accumulated per attempt, never overwritten** (B2.2), filenames
  encode `stepId`/`attempt`/`pageId`/timestamp (B2.3). The **original automation error stays the
  primary cause**; a capture that fails is appended as a **secondary-diagnostic note**, never masking
  the error and never throwing (B2.4/B2.5). `screenshotPath` stays populated with the last capture
  (reports back-compat). New `StepEvidenceRef` + `evidence?: StepEvidenceRef[]` on `StepExecutionResult`.
- **Deferred (documented, not silent):** **console tail + in-flight network state** → **FR-A2 (WS-A
  execution timeline, Tranche 5)** — event-stream evidence needing the observation substrate.
  **FR-B1 addressable run-root + `manifest.json`** and durable-store surfacing of `evidence[]` (a
  SQLite migration) → their own tranche (FR-B1's run-root migration is broad and its retention policy
  is SRS §10.3 open). **No schema migration in this tranche.**
- **PR #35 review fixes (round 2):** (1) **evidence preserved across a successful retry** —
  `executeWithRetry` used to return a passing retry before attaching earlier failed-attempt evidence;
  the passing result now carries all prior evidence (indexes intact, none overwritten), no capture for
  the passing attempt, `screenshotPath` unset on success. (2) **All path components sanitized** — new
  shared `safePathComponent` (`src/utils/pathSafety.ts`) applied to execution/instance/flow/step/page
  ids, then each artifact path is `isPathInside`-confined before writing. (3) **Truthful page identity**
  — a failed `resolveStepPage` labels evidence with the **actual** captured page (never the requested
  popup) + a secondary diagnostic + new optional `StepEvidenceRef.requestedPageId`. (4) **New real
  file-output verifier** `verify:failure-evidence-live`.
- **PR #35 review fixes (round 3, final correction pass):** (1) **every `StepEvidenceRef.note` is now
  masked** — `record()`'s notes (the resolver-failure diagnostic, which embeds `step.pageAlias`, and
  each per-artifact capture-failure note, which embeds the underlying error message) previously stored
  raw text that could carry a URL token or a copy-pasted secret; both now run through
  `evidenceMasker.maskText(...)` before being stored. (2) **the `FlowExecutor` defensive fallback
  diagnostic is masked too** — the belt-and-suspenders `.catch` for `captureFailureEvidence` itself
  throwing now masks its note via `FlowExecutor`'s own new `evidenceMasker`. (3) **`safePathComponent`'s
  `fallback` is sanitized, not trusted** — it now runs through the identical sanitize pipeline as `raw`;
  only the hard literal `"x"` is ever unsanitized, and only when both reduce to nothing.
- **Files:** `src/runner/RunnerResult.ts`, `src/runner/StepExecutor.ts`, `src/runner/FlowExecutor.ts`,
  `src/utils/pathSafety.ts`; tests `scripts/verify-failure-evidence.mts` +
  `scripts/verify-failure-evidence-live.mts` (real-browser) +
  `scripts/verify-failure-screenshot-precedence.mts` (adapted; awkit-5yx precedence preserved);
  registered in `scripts/lib/verifier-classification.ts` + `package.json`. Scope:
  `docs/ai/backend-srs-tranche-1-scope.md`.
- **Verification (isolated `npm ci`):** build + typecheck clean · **`verify:failure-evidence` 34/34**
  (unit; up from 29 — adds the diagnostic-leak + hostile-fallback regression cases) ·
  **`verify:failure-evidence-live` 17/17** (up from 14 — adds the resolver-failure note-masking case) ·
  `verify:failure-screenshot-precedence` 6/6 · **`verify:runner` 84/84** · `verify:artifacts` 13/13 ·
  `verify:verifier-classification` **reconciled 110** (unit 44, real-browser 37 — unchanged total, no
  new script) · protected gates unchanged (`verify:security` 39 · `verify:ipc-contract` 4 ·
  `verify:auth` 49 · `verify:authz` 40) · `verify:clean-machine-policy` 28/28.
- **No `.beads` change; no `bd` run; no release promotion.** Clean-machine policy remains
  owner-waived / non-blocking; protected release gates remain mandatory. **PR #35 remains draft**,
  awaiting owner re-review.

---

## Track 4 — clean-machine validation is optional and non-blocking (2026-07-24)

**Owner policy (Track 4).** Clean-machine validation **execution is optional and non-blocking** for
release promotion, by explicit owner decision on **2026-07-24**. Execution status stays truthful: it
is still **NOT EXECUTED** and **nothing is recorded as passed**. A failed clean-machine run — if ever
executed — **remains blocking**. This did **not** weaken any other release gate.

The gate was **documentation-enforced, not code-enforced** (verified in Phase 1: CI runs only
typecheck + build; no release/promotion resolver exists in `src/`; the `clean-machine-acceptance`
verifier class has no npm script and blocks nothing). The canonical policy now lives in one source —
`scripts/lib/clean-machine-validation-policy.ts` — enforced by `npm run verify:clean-machine-policy`
(verifier class **documentation-consistency**):

```text
Clean-machine validation is optional and non-blocking by owner policy.
Its execution status remains truthful:
- not executed remains NOT EXECUTED;
- successful execution may be recorded as PASSED;
- failed execution remains FAILED and blocking;
- an explicit owner waiver is recorded as OWNER WAIVED / NON-BLOCKING.

This policy does not waive checksum, offline-bundle, packaged-startup,
artifact-integrity, dependency-manifest, or security validation.
```

**Release-gate matrix (current):**

| Gate | Blocks promotion | Current status |
|---|---|---|
| Clean-machine validation | No — optional / waivable | **OWNER WAIVED — NON-BLOCKING** · execution **NOT EXECUTED** |
| Checksum / artifact-integrity | **Yes** | Unchanged — mandatory |
| Offline-bundle | **Yes** | Unchanged — mandatory |
| Packaged startup | **Yes** | Unchanged — mandatory |
| Dependency-manifest | **Yes** | Unchanged — mandatory |
| Security | **Yes** | Unchanged — mandatory |

**Changed (verifier total 107 → 108; documentation-consistency 0 → 1):**
`scripts/lib/clean-machine-validation-policy.ts` (canonical policy + blocking matrix + fail-safe on an
unknown/malformed state), `scripts/verify-clean-machine-policy.mts` (`verify:clean-machine-policy`, 10
proofs), registered in `verifier-classification.ts` + `package.json`. Docs: this section, the
authoritative banner atop `CLEAN_MACHINE_VALIDATION_RUNBOOK.md`, `HANDOFF.md`, `TASK_LOG.md`. **No
`.beads` change; no `bd` run.** Historical NOT EXECUTED evidence left intact.

---

## PR #24 reconstructed — Oracle data-source RBAC + live reauth verification (2026-07-24)

Reconstructed off current `main` (`b416f8c`, which now includes the merged **PR #27** backend Tranche 0 and
**PR #33** beads reconciliation — tracked `.beads/issues.jsonl` = 93 records, `awkit-5yx`/`awkit-oei` closed).
Old branch tip `ec19bda` preserved as `backup/pr24-pre-reconstruction`.

- **Oracle data-source IPC authorization (awkit-b3w).** `app/main/ipc/oracle.ipc.ts`
  `oracle:dataSources:save`/`delete`/`refreshSnapshot` require `assertSenderPermission(event,
  Permission.DATASOURCE_MANAGE)`, asserted **before** any service lookup, existence check, or secret access
  (matching the JSON `dataSources:*` surface; the trusted-sender check is preserved inside
  `assertSenderPermission`). Oracle driver / Java / bridge / packaged-mode / Settings channels are unchanged.
  Viewer direct-preload denial is proven by `verify:e2e-rbac` (**49 → 51**).
- **Live ReauthDialog verifier (awkit-2d8).** New `scripts/verify-e2e-reauth-gui.mjs` + `verify:e2e-reauth`
  alias (real-Electron), classified **`real-browser`** in the verifier registry (**107** total / **36**
  real-browser). Proves: cancel drops the held create; a wrong password applies nothing and writes **no**
  `USER_CREATE` success audit; the correct password applies it **exactly once** (no replay); no credential
  reaches console/audit. **19/19**.
- **Beads:** `awkit-b3w`/`awkit-2d8` were closed in the tracked export **before** their code reached `main`;
  this work aligns `main` with those already-closed records. **No `.beads` change; no `bd` run; no
  `bd dolt push`.**
- **Verification (isolated `npm ci`):** build ✓ · `e2e-rbac` 51/51 · `e2e-reauth` 19/19 · `ipc-contract` 4/4 ·
  `security` 39/39 · `auth` 49/49 · `auth-gui` 18/18 · `authz` 40/40 · `verifier-classification` 107.
  `verify:oracle-drivers-gui` **25/30** — the five Oracle **bridge/Java/ojdbc** checks remain
  **environmental/inconclusive** unless the bridge runtime + Java + ojdbc assets are actually available
  (non-blocking for this PR; no global waiver).

---

## Three-branch feature recovery (2026-07-23, latest) — accent / HTTPS / custom brand logo — MERGED to `main`

The mixed commit `a1adcc2` ("branding, accent theme, and HTTPS certificate trust") was decomposed into
**three independent feature branches off `main` @ `32e378e`**, each verified and opened as its own PR
(not stacked), then — after a full pre-merge review + combined integration validation — **all three
merged to `main`**. The original mixed branch `chore/brand-logo-5b` (+ backup + archive) is left intact.

- **`feature/custom-accent-gradient` (PR #28) — MERGED** (merge commit `3e79b70`) — user-selectable accent
  (solid/gradient + Specter Blue). Commands: `verify:accent-theme` (71/71), `verify:accent-gui` (33/33).
  Doc: `docs/ACCENT_COLOR.md`.
- **`feature/custom-brand-logo` (PR #30) — MERGED** (merge commit `2033424`) — Super-User custom workspace
  logo (login + sidebar), signature-validated, app-managed atomic store, permission-gated. Commands:
  `verify:custom-brand-logo` (31/31), `verify:branding` (47/47), `verify:branding-gui` (30/30). Doc:
  `docs/BRANDING_CUSTOM_LOGO.md`. Also carries a test-only fix (`f01e4ec`) making
  `verify:custom-brand-logo` check #14 integration-safe — a semantic "branding adds no field to
  UiSettings" assertion instead of "`uiSettings.ts` byte-identical to `main`".
- **`feature/https-certificate-trust` (PR #29) — MERGED** (merge commit `0777682`) — opt-in, default-OFF
  "Ignore invalid HTTPS certificates", **context-level only** (the browser-wide
  `--ignore-certificate-errors` launch arg + env hatch were dropped; a regression guard prevents its
  return). **Its mandatory security review passed 11/11.** Commands: `verify:https-certificates` (49/49),
  `verify:https-certificates-gui` (31/31). Doc: `docs/HTTPS_CERTIFICATE_TRUST.md`.

**Final `main` after the recovery merges: `0777682`** (merge order #28 → #30 → #29). Each feature branch was
updated onto the advancing `main` and its additive conflicts (`Settings.tsx` / `package.json` /
`uiSettings.ts` / `global.css` / `App.tsx` / `preload.ts`) resolved by preserving **all** feature
additions — no broad `--ours`/`--theirs`; the combined tree built clean and every feature's verifiers
stayed green.

**Release status — development integration, NOT product promotion.** `validate:offline` was inconclusive
in the isolated worktrees (bundled-browser payload absent); the portable rebuild, artifact verification,
and clean-machine validation remain **NOT executed** (release debt). `.beads/issues.jsonl` stays frozen —
no `bd dolt push`. `fix/backend-observability-tranche-0` (PR #27) was untouched by the recovery itself; it was
subsequently **rebased onto the post-recovery `main`** — see the next section.

---

## Backend Tranche 0 (2026-07-23; rebased onto `main` @ `9960633` on 2026-07-24) — Reporting truthfulness

**Owner-approved development waiver, NOT passed validation.** On 2026-07-23 the owner explicitly
waived the portable rebuild, artifact verification, and clean-machine validation prerequisites **for
continued backend development** — they were **not executed and are not passed**; `61f6099` promotion
is **not completed**; the validation work remains **release debt**. The waiver authorized Backend
Tranche 0 only. See the waiver banner atop `CLEAN_MACHINE_VALIDATION_RUNBOOK.md`.

Delivered on `fix/backend-observability-tranche-0` (**PR #27 — DRAFT**), **rebased onto `main` @ `9960633`**
(originally branched from `32e378e`; now pushed). Verified compatible with the merged accent / HTTPS /
branding recovery (PRs #28–#31 are merged): the combined tree builds clean and every recovery verifier
stays green. Release promotion is still **not completed** (see the release-status note above):

- **awkit-5yx — `screenshotOnFailure` precedence wired.** `FlowExecutor`'s failure-screenshot gate
  was hardcoded `?? true`, ignoring the resolved artifact profile. Now: explicit per-step override →
  artifact-profile default (threaded `browserConfig.artifact.screenshotOnFailure` →
  `PlaywrightRunnerOptions.screenshotOnFailure` → new `FlowExecutor` ctor arg, default `true`) → safe
  system default. **Behaviour-preserving today** (all four profiles still return `true`). Regression
  test `verify:failure-screenshot-precedence` (6/6). **Note:** the bead's AC-3 (making `production`
  actually *suppress* failure screenshots) is a config-VALUE change that contradicts the
  `ArtifactProfile.ts` "failure screenshots only (leanest)" design — NOT done here; it needs an owner
  decision and is out of the "precedence" scope.
- **awkit-oei — success cleanup no longer mislabeled.** `PlaywrightRunner.executeScenario`'s `finally`
  hardcoded `execution-failed-cleanup` on every exit. Added `execution-completed-cleanup` to the
  `BrowserCloseReason` union; a passed terminal now logs it, failure keeps the old reason. **Log text
  only** — the reason is discarded by `onRuntimeClosing`'s sole consumer and never feeds pool
  close-reason analytics (a different enum). Verified live in `verify:runner` (now 84/84, +2).
- **FR-I1 — verifier classification.** New `scripts/lib/verifier-classification.ts` classifies all
  **106** `verify:`/`validate:` scripts into the 7-class taxonomy; `verify:verifier-classification`
  reconciles it against `package.json` (fails on an unclassified/stale entry) and reports **per-class
  counts** (43 unit · 35 real-browser · 21 integration · 4 static-source · 3 packaged · 0
  doc-consistency · 0 clean-machine) — replacing the single undifferentiated total (the Tranche 0
  exit criterion). The **seven** recovery verifiers `main` gained (PRs #28–#31) are classified by their
  actual execution behavior: `accent-theme`=unit; `accent-gui`, `https-certificates`,
  `https-certificates-gui`, `branding-gui`=real-browser (Electron GUI, or live Chromium cert servers);
  `branding`, `custom-brand-logo`=integration (real `BrandingLogoStore` atomic writes on a temp dir, no
  browser). **Remaining FR-I1 depth (follow-up, not in this tranche):** the I1.4 audit proving each
  verifier can fail for its stated reason, and I1.2 per-file header back-fill.
- **Excluded (still in force):** CDP observation, failure-evidence restructuring (`awkit-oyc`),
  `INCONCLUSIVE`/`StepExecutionStatus`, locator recovery (`awkit-v4r`). **No Tranche 1 work.** The
  `production` artifact-profile `screenshotOnFailure` value is unchanged (AC-3 deferred).

Verification (rebased tree @ `main` `9960633`): `npm run build` clean; `verify:failure-screenshot-precedence`
6/6; `verify:runner` 84/84; `verify:verifier-classification` reconciled (**106 classified**);
`verify:branch-pairs` 31/31. Recovery compatibility: `verify:accent-theme` 71/71 · `verify:accent-gui` 33/33
· `verify:https-certificates` 49/49 · `verify:https-certificates-gui` 31/31 · `verify:branding` 47/47 ·
`verify:branding-gui` 30/30 · `verify:custom-brand-logo` 31/31 · `verify:settings-persistence` 3/3 ·
`verify:ipc-contract` 4/4. `.beads/issues.jsonl` excluded/frozen; no `bd dolt push`.

---

## Status summary (2026-07-23) — supersedes the 2026-07-22 block below

**Branch-state correction.** The 2026-07-22 summary below says the recorder/async work is "not pushed".
That is **stale**: `feature/recorder-protected-login-and-async-awareness` @ `61f6099` was pushed and
**merged to `main` via PR #25** (merge commit `5cef580`, a real merge — the 17 phase SHAs stay valid).
The branch is now **FROZEN** pending the clean-machine gate. Local `main` is stale at `382847c`; compare
scope against `origin/main`.

**Blocking gate — unchanged and still `Not Executed`:** `CLEAN_MACHINE_VALIDATION_RUNBOOK.md`. Merging
was integration, not promotion. **Product promotion remains UNAPPROVED.** No backend implementation may
start before it clears.

**Artifact status (2026-07-22 regeneration from `61f6099`):** NSIS installer **rebuilt and verified**
(SHA-256 `4df7fa6402c9c551ca1c6e6310a8e21c8c61a0097884b316eeca1ba41f1ec333`, Chromium 149.0.7827.55
confirmed inside the artifact). **Portable NOT produced** — 7-Zip `-mx=9` OOM on this 15.9 GB host.
Both artifacts are needed before runbook §2 can be re-pinned. Evidence archived outside the repo.

**New risk — packaging is not reproducible from source control (`awkit-epz`, P1).** `vendor/`,
`resources/browsers/`, and `resources/oracle-jdbc/` are gitignored but copied wholesale by
`electron-builder.json` as `extraResources`. A clean checkout therefore builds a **hollow artifact**
that installs and launches but has no bundled Chromium and cannot automate anything — a silent failure.
The ~832 MB payload must be transferred out-of-band; `scripts/prepare-offline-deps.ps1` must not be run
(unpinned `npx playwright install chromium`). Related: `dependency-manifest.json` is regenerated with a
fresh `builtAt` and packaged, so **installer hash equality is unachievable** even from identical inputs
(`awkit-c0c`, P2) — compare decompressed payload CRCs instead.

**New command:** `npm run verify:canvas-layout` (`scripts/verify-canvas-layout.mts`, **35/35**) —
geometry assertions over `app/renderer/components/shared/graphLayout.ts` (bounding-box overlap on real
node dimensions, clearance floors, cycle termination, determinism, idempotence). No production code
changed; the load-time auto-layout it covers was already implemented.

**New specification:** `docs/SRS_BROWSER_AUTOMATION_OBSERVABILITY.md` (SRS-BAO-001) — 25 external
recommendations reviewed against code (9 absent / 11 partial / 3 implemented / 1 rejected), with change
dependencies, security gates, and a tranche plan. **Specification only; implementation blocked by the
gate above.** Notable grounded fact: AWKIT has **zero CDP usage anywhere** today, and
`SessionCaptureService`'s "no CDP connection" invariant constrains any future observation client.

**Known-stale document:** `docs/SRS_CANVAS_UX.md` (2026-07-10) — **reconciled 2026-07-23** against
current code (React Flow → in-house engine; corrected tokens/component names; drifted `global.css`
line numbers replaced with token/selector references). `[NEEDS REFERENCE]` visual markers preserved.

**FR-2.6 branch-pair fix — DONE & VERIFIED (2026-07-23, `feature/canvas-ux-foundation`, not pushed).**
The former defect (both editors' `reconcile*Branches` were no-op pass-throughs; `reconcileBranchConnectors`
was dead code) is fixed. New shared `app/renderer/components/shared/branchPairs.ts` restores the
lone-branch-connector semantics as a **hybrid** rule: interactive deletion auto-reverts the survivor to
a normal connector; existing/imported lone branches are **Save-blocking** (not rewritten on load); a lone
branch **with a standard fallback** (valid if/else) is exempt. Correction to the earlier claim: a lone
branch does **not** truncate the flow — at run time a lone conditional routes with the condition ignored
and a lone parallel runs its target twice; the revert prevents both. Dead `reconcileBranchConnectors`
removed. Verifier `scripts/verify-branch-pairs.mts` (`npm run verify:branch-pairs`, **31/31**); build
clean; `verify:flow-step-mapping` 94/94, `verify:canvas-layout` 35/35, GUI `verify:flow-designer` 24/24 +
`verify:workflow-builder` 20/20. Commits `62aca6d` (fix) + `92b40b5` (test) + docs. `.beads/issues.jsonl`
left uncommitted (prior session's cross-branch beads — splice hazard).

---

## Status summary (2026-07-22)

Protected-login controls **implemented**; async-awareness core (HTTP status vs. timeout + adaptive
bounded timeouts) **implemented**; runtime **API/UI completion policies + loader lifecycle + consistency
checks (awkit-62o) implemented and verified**. On branch
**`feature/recorder-protected-login-and-async-awareness`** (off main, **not pushed**). Remaining:
**awkit-54t (Flow Designer Async Completion editor + Recorder review UI) implemented**; remaining
follow-up **awkit-4km** (202 job-polling, WebSocket/SSE, CDP).

**Mock Site fixtures for the GUI gate (2026-07-22):** new `/async-results` scenario + `/api/status`
(allow-listed codes, no 3xx) and `/api/results?mode=populated|empty`. These unblock two GUI-gate checks
that previously had **no fixture**: HTTP-error-vs-timeout reporting, and the empty-result contract
(HTTP 200 with zero rows → table hidden, `empty-state` visible). `verify:mock-site` **55/55**.

**Grouped completion `A AND (B OR C)` — bead `awkit-y24` (P2) IMPLEMENTED (2026-07-22, uncommitted):**
A new `anyOf` OR-group `WaitCondition` (extends the union — not a fork) passes as soon as any child
passes and fails only when all fail. As one *required* condition under `allRequired`, it expresses
`API success AND (tableHasRows OR emptyStateVisible)`, so a 200 API alone no longer satisfies a step
whose UI outcome is missing. Runner resolves it via `Promise.any` in `executeWaitCondition` (works under
every completion policy); `FlowValidation.clampWaits` recurses into children; `reviewWait` rolls up the
worst branch (so the intended rows-OR-empty config is not mislabeled a contradiction). Designer editor:
`renderWaitEditor` refactored to `(wait, update)` so it renders nested branches recursively, plus a
"+ OR group" button and token-only `.anyof-group`/`.anyof-branch` styles. `verify:waits` **52/0** (incl.
"API ok but neither branch → fails"), round-trip covered by `verify:flow-step-mapping`. Unblocks GUI
check 11 configuration 3 (the `/async-results` fixture already exposes `#resultsTable` + `empty-state`);
the manual GUI walkthrough remains.

**Async job polling — bead `awkit-4km` C1 IMPLEMENTED (2026-07-22, uncommitted):** a new `apiPolling`
`WaitCondition` for the `202 Accepted → poll a status endpoint to terminal` pattern. `resolveApiPolling`
observes the page's own repeated status responses (issues none itself) and completes on a terminal status
range or a JSON `responseField`/`terminalValues`, bounded by `maxAttempts`. Designer editor + "Poll"
scaffold; mock-site `/api/job` (deterministic 202×N → terminal, repeatable). `verify:waits` **56/0**,
`verify:mock-site` **58/58**. The later WebSocket/SSE + CDP slice is now closed; see the current
`awkit-4km` section at the top of this file.

**Serialization round-trip hardening (2026-07-22):** `toFlowStep`/`fromFlowStep` (+ their `toNodeConfig`
/`createValueSource` helpers) moved verbatim out of `pages/FlowChartDesigner.tsx` into
`components/workflow/flowStepMapping.ts` so a verifier can execute the REAL production converters.
Extraction proven behavior-preserving by diff (183 lines, byte-identical). New
`verify:flow-step-mapping` **94/94** covers all `WaitCondition` variants (incl. `anyOf` + `apiPolling`),
both wait phases, condition ordering, required/optional flags, completion policies, empty-result/falsy
preservation, legacy steps, defaults, clone/edit, 3 serialization cycles for gradual drift, and (report
§8) all 10 `valueSource` variants, compound locator `alternatives`/`context`, edge→`next`, and
representative `step.config` breadth.

**Data-loss defect — bead `awkit-cxa` (P1) FIXED (2026-07-22, uncommitted):** `fromFlowStep` now reads
`step.value` and marks the node with a designer-only `valueSourceType: "none"` sentinel;
`createValueSource` returns `undefined` for it, so `toFlowStep` re-emits `value` alone **without**
fabricating a static `valueSource`. Bare condition expressions (e.g. shipped
`mock-conditional-flow.json`) now survive a designer open+save. The two "KNOWN DEFECT" verifier checks
were inverted to assert lossless preservation, plus string/numeric/boolean/json/empty coverage. The §8
work surfaced two more drops of the same class — `generated` (`generator`) and `secret` (`secretName`)
value sources — **also fixed** the same lossless way (value chain + a `secret` branch).

**Manual gates run 2026-07-22:**
- **Offline validation — PASS** (`validate-offline-bundle.ps1 -Strict`, exit 0, "Strict mode: passed").
  Note the `validate:offline` npm alias does **not** pass `-Strict`; run the script directly for the gate.
- **Packaged build/boot — PASS (rebuilt against the final commit).** `package:portable` built the full
  app tree (`dist/win-unpacked/SpecterStudio.exe` 180 MB + bundled Chromium + `app.asar` +
  `offline-runtime.json`); the packaged binary **boots cleanly** in packaged/offline mode and **writes
  nothing into `resources/`** (content hash byte-identical across a boot). The distributable archive
  (7-Zip `-mx=9`) **succeeded** — `dist/SpecterStudio 0.1.0.exe`, 325 MB.
  **CORRECTION (supersedes the earlier entry):** the `-mx=9` step was previously recorded as a fixed
  low-RAM limit. It peaks ~3.4 GB in `7za.exe` and **completed on retry** — intermittent memory
  pressure, not a hard ceiling.
  **CORRECTION:** the original packaged build (15:16) **predated the awkit-54t commit (15:49)** and
  contained none of its UI. Packaged evidence must always be re-taken after the last feature commit.
- **Electron GUI walkthrough — 11/12 PASS, 1 BLOCKED (user-run, 2026-07-22).** Checks 1–10 and 12 pass.
  **Check 11 configuration 3 is BLOCKED** by `awkit-y24` (`API success AND (tableHasRows OR
  emptyStateVisible)` is not expressible) — BLOCKED, not FAILED. Visual confirmation that the packaged
  renderer paints was not captured by the agent (screen access declined); process-level boot verified.

**Product promotion remains unapproved** until `awkit-y24` unblocks GUI check 11.3 and a distributable
installer is produced on a build host that clears `-mx=9` reliably.

## awkit-54t — Async Completion editor + Recorder review-before-save DONE, verified (2026-07-22)

UI over the awkit-62o model. New pure module `src/profiles/asyncCompletionReview.ts` classifies waits +
policy as Reliable / Needs review / Incomplete / Unsafe (+ contradiction warnings), shared by both:
- **Flow Designer** (`FlowNodePropertiesPanel`): "Smart Waits" → **Async Completion** editor —
  completion-policy select, **+ API / + Loader / + UI outcome** add buttons, per-condition
  required/optional + timeout + classification badge + type-specific field editors.
- **Recorder** (`Recorder.tsx`): Save opens a **review-before-save modal** (per-action classification +
  warnings + summary) when async activity was captured; else saves directly.
- **Verified:** `verify:async-review` 21/0 + full regression green (waits 48, recorder-flow 19, runner
  82, recorder 78, protected-login 26/45, settings 3, ipc 4, mock-site 39), build clean.
- **Limitations:** "test locators against the live recorded page" affordance not implemented; GUI
  click-through behind the auth gate (user-driven).

## awkit-62o — loader lifecycle + completion policies + consistency DONE, verified (2026-07-22)

Extends the canonical `WaitCondition`/`beforeWaits`/`afterWaits` model (no parallel field); round-trip
preserved (designer allowlist extended for `completionMode`; wait fields ride in the arrays).
- **Loader lifecycle (StepExecutor):** appearance armed before the action → up to `appearanceGraceMs`
  for it to appear (late spinner never skipped) → `completion` signal (hidden/detached/aria-busy=false).
  Optional-never-appears passes; required-never-appears / never-disappears give precise diagnostics.
- **Completion policies:** `FlowStep.completionMode` = allRequired (default = legacy) | anyRequired |
  networkThenUi | quietPeriod. Consistency failures (API-ok-UI-missing, API-failed-UI-changed,
  loader-still-blocking); valid empty results pass (no forced table rows); optional waits best-effort.
- **Cancellation:** `withCancellation` races every wait against the token (+ cooperative quiet loop);
  Stop interrupts API/loader/quiet/UI waits in <2s. **Progress:** `waiting` events name the
  endpoint/loader/UI condition, resolved timeout, required/optional.
- **Settings:** `recorder.asyncAwareness.loaderAppearanceGraceMs` (default 1500, validated); recorder
  stamps the lifecycle (grace 1500, mustAppear false) on recorded loaders.
- **Verified:** `verify:waits` 48/0, `verify:recorder-flow` 19/19, `verify:recorder` 78/0,
  `verify:runner` 82/0, `verify:cancellation` 12/0, `verify:protected-login(-recorder)` 26/0 · 45/45,
  `verify:settings-persistence` 3/3, `verify:ipc-contract` 4/4, `verify:mock-site` 39/39,
  `verify:security` 39/0, `verify:popup` 12/0, `verify:safety-policy` 17/0, build clean.
- **Limitations:** quietPeriod window is a runtime constant (750ms); request-start observer is
  active-page-scoped; no Async Completion editor UI (awkit-54t).

## Async Activity Awareness — Phase B core DONE, verified (2026-07-22)

Same branch, extends the EXISTING `WaitCondition`/`beforeWaits`/`afterWaits` model (no parallel
`AsyncActivityGroup` fork), round-trip preserved.
- **Response status vs. timeout:** `StepExecutor.buildResponseWait` now matches endpoint only;
  `validateResponseStatus` reports an unexpected status as an HTTP-status failure (`ResponseStatusError`
  → `formatResponseStatusFailure`), never a timeout. An immediate HTTP 500 is reported as HTTP 500.
- **Adaptive bounded timeouts:** `buildSmartWaits` derives `clamp(observed×3+5000, 10000, 300000)` for
  `response`/`loaderHidden` waits (exported `adaptiveTimeoutMs`, tunable via `SmartWaitBuildOptions`).
- **Settings:** `recorder.asyncAwareness {enabled, adaptiveTimeouts, minimumTimeoutMs, maximumTimeoutMs}`
  — deep-merged in hydrate/mergePatch, validated (no unlimited timeout), threaded through `recorder:start`.
- **Verified:** `verify:waits` 26/0, `verify:recorder` 78/0, `verify:recorder-flow` 16/16,
  `verify:runner` 82/0, `verify:settings-persistence` 3/3, build clean.
- **Deferred follow-ups (not implemented):** loader appearance-grace/mustAppear runtime lifecycle;
  quietPeriod/networkThenUi/allRequired/anyRequired completion policies + UI-outcome consistency;
  202 job-polling + response-field predicate; WebSocket/SSE + CDP; Flow Designer "Async Completion"
  editor; Recorder review-before-save UI; context-level authoritative network source.

## Recorder protected-login controls + SSO false-positive fix — Phase A DONE, verified (2026-07-22)

On branch **`feature/recorder-protected-login-and-async-awareness`** (off main, **not pushed**). Phase A
of the two-part `AWKIT_RECORDER_PROTECTED_LOGIN_AND_ASYNC_ACTIVITY` prompt; Phase B (unified async
activity engine) is next.
- **Detector confidence:** `ProtectedLoginDetector.detectFromSignals`/`detectFromRecorderSignals` now
  return `confidence` (`low|medium|high`) + `recommendedAction` (`continue|warn|pause`). Text-only
  `sso` ("single sign-on"/"identity provider") with no provider host and no DOM affordance → low/
  continue (the false positive). Providers, CAPTCHA, MFA, passkey, security-check, and a detected
  password field stay `pause`. Recorder + the two runner auto-pause sites gate on `recommendedAction`.
- **Ignore controls:** `recorder.ignoreProtectedLoginDetection` setting (default false); session-level
  "Ignore and continue recording" (`RecorderService.ignoreCurrentProtectedDetection` + IPC
  `recorder:ignoreProtectedDetection`) resumes the SAME page (browser now stays open during the
  "detected" phase; capture bindings early-return while paused so nothing protected is recorded);
  per-session loop-guard keys prevent re-pausing the same ignored detection.
- **UI:** Settings → Recorder card (toggle + confirmation dialog, immediate persist); Recorder handoff
  card gained "Ignore and continue recording" (first action) + a non-blocking session notice.
- **Mock site:** `/mock/sso-text-app` false-positive fixture.
- **Verified:** `verify:protected-login` 26/0, `verify:protected-login-recorder` 45/45, `verify:runner`
  82/0, `verify:mock-site` 39/39, `verify:waits` 21/0, `verify:recorder` 72/0,
  `verify:settings-persistence` 3/3, `verify:ipc-contract` 4/4, `npm run build` clean. **Not run:**
  Electron GUI walkthrough of the handoff card (manual gate).
## Flow Validation Engine (Tranche 2) — INTEGRATION-CANDIDATE, hardened (2026-07-22, epic `awkit-wza`)

**Status (authoritative, 2026-07-22):**
- `Tranche 2: IMPLEMENTED AND VERIFIED ON THE DEVELOPER MACHINE — CLEAN-MACHINE ACCEPTANCE PENDING`
- `Product promotion: NOT YET APPROVED`
- `Remaining acceptance gate: clean offline Windows environment validation`

The two items the earlier status named — SHA-256 grant binding and packaged validation — are complete
and accepted. All source, Electron-development, packaged-runtime, portable-build, SHA-256,
authorization, migration, concurrency and 1,000-flow scale evidence is accepted **as
developer-machine evidence only**; it is explicitly **not** clean-machine evidence and does not
satisfy the remaining gate. Promotion to `Tranche 2: COMPLETE` / `Product: INTEGRATION-CANDIDATE` may
occur **only** after [`CLEAN_MACHINE_VALIDATION_RUNBOOK.md`](../../CLEAN_MACHINE_VALIDATION_RUNBOOK.md)
is executed successfully in a qualifying clean offline Windows environment. That runbook records every
clean-machine step as **Not Executed**.

- **SHA-256 grant binding.** Legacy Compatibility grants bind to
  `sha256:<64 hex>` over the flow's canonical executable content. A grant changes execution
  eligibility, so a non-cryptographic hash was not acceptable. Canonicalization stays **pure** in
  `src/validation/LegacyCompatibility.ts` (`canonicalFlowContent`); the digest is computed at the
  **trusted boundary** `app/main/validation/contentDigest.ts` (`node:crypto`) and injected — `src/`
  still imports no Node built-ins. `PreRunValidator` takes `digestFor` and **fails closed** without it.
- **Pre-hardening records are retired, never migrated.** A grant whose digest is not current-format
  gets standing `legacyDigest`, is never honored, is revoked as `digestFormatRetired` for audit, and
  is **not replaced** — so no deadline is extended and no grant appears merely because an old format
  was encountered. A retired record cannot be revived by re-scanning.
- **Scan hardening.** `runInventoryScan` is single-flight (10 concurrent callers → 1 scan, 1 grant
  set); grant writes are serialized so audit counters cannot be lost (20 parallel audit writes → 20
  recorded); the scan record is written **last**, so a storage failure leaves no scan record, issues
  no grants, and retries next call. The run gate catches scan/store failures and applies the **strict**
  gate rather than assuming exemption.
- **Fresh package validated.** `dist/SpecterStudio 0.1.0.exe` rebuilt 2026-07-22T00:32:12+03:00,
  310.2 MiB, sha256 `129833754870f5fa2663efa48b979aaecaf1532831f20805a5b3f6537264c1fb`.
  `verify:packaged-validation` **87/0** across a clean profile and an upgrade profile (60+4 flows,
  FNV-era grant, old migration record, prior run history): all ten `validation:*` channels plus their
  authorization matrix, grant creation/persistence-across-restart/invalidation/expiry, the full
  migration ceremony including undo after restart and undo refusal after a later edit, draft save,
  run blocking vs permitted legacy execution, every library state, offline posture, and clean-shutdown
  on-disk integrity. First scan of 64 flows: **334 ms**, worst renderer round-trip during it **9 ms**.
- **Verification:** `verify-legacy-compat` **138/0** · `verify-packaged-validation` **87/0** (new) ·
  `verify:packaged-runtime` **25/0** (was 12/10 — pre-existing splash-window defect, fixed) ·
  `verify-validation` **125/0** · `verify-random-oracle` **27/0** · generator **49/0** · roundtrip
  **26/0** · `verify:runner` **82/0** · `verify:flow-designer` **56/56** · `verify:workflow-builder`
  **20/20** · `verify:canvas-perf` **13/13** · `verify:profile-store` **16/16** · `verify:authz`
  **40/0** · `verify:ipc-contract` **4/4** · `validate:offline --Strict` pass · build clean.
- **Not run:** clean offline VM walkthrough (the outstanding gate), sustained soak.

### Hardening checkpoint 2 (2026-07-22) — status correction, script type gate, scale probe, installer

- **Status string corrected** to `INTEGRATION-CANDIDATE — clean offline VM and installer validation
  pending` (the two items the previous string named are complete and accepted).
- **`dependency-manifest.json` disposition:** it is generated packaging output (every package/prep
  script rewrites `buildMode`/`builtAt`), so the working-tree change from the package build was
  **restored** to the committed `development-offline-prep` baseline, not committed.
- **Script type gate** (`tsconfig.scripts.json`, `npm run typecheck:scripts`, `verify:all-typecheck`):
  the `scripts/` tree was outside `tsc`, so a deleted import only failed at `tsx` runtime. The new
  gate found and fixed **36 real errors** across scripts nobody had type-checked — including a genuine
  interface-conformance bug where `NullRuntimeStore` declared zero-arg versions of eight methods its
  own interface defines with parameters. All touched verifiers re-run green; changes are
  signature/CFA-only.
- **Scale probe** (`measure-inventory-scale.mts`, 1,000 flows, packaged): first scan **4.24 s**,
  renderer round-trip median **4 ms** / worst **177 ms** (a mild main-thread stall while 250 grant
  files write serially — measured, non-blocking), peak process-tree RSS **231 MB**, 250 grants issued
  (each its own file, all sha256-bound), 1 scan record. 8 concurrent run requests during scan init all
  waited and resolved to a real verdict (single-flight); a re-scan extended no deadline. **9/9 safety
  assertions pass; timing/memory are measurements, not thresholds.**
- **NSIS installer** built fresh: `dist/SpecterStudio Setup 0.1.0.exe`, 2026-07-22T01:40:27+03:00,
  356.6 MiB, sha256 `74950020…e2a5a`, sha512 matches `latest.yml`, per-user (no elevation). **Both the
  portable EXE and the installer are `NotSigned`** (Authenticode-verified — not claimed signed).
- **Environment gate NOT run:** re-confirmed no clean-machine capability here (no Windows Sandbox;
  feature-enable needs elevation the non-admin agent account lacks). The clean-VM walkthrough,
  installer install/upgrade/uninstall lifecycle, and true clean-machine test remain the outstanding
  human gate — `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 + the new **§3b** (Tranche 2 validation
  subsystem checklist). Tranche 2 is therefore **not** marked COMPLETE.

## Randomized Test Lab — Tranche 2 Stage 2c: Legacy Compatibility + migration subsystem (2026-07-22, epic `awkit-wza`)

**Branch `feature/randomized-test-lab`.** Tranche 2 is complete. Enforcement is now the **full gate**:
off-path errors block too, unless the flow holds an explicit, time-limited, audited **Legacy
Compatibility grant**. Suggested fixes exist, are never automatic, and are fully reversible.

- **Policy core** (`src/validation/LegacyCompatibility.ts`, pure): `effectiveVerdict` is the single
  Stage 2c decision used by the run gate, designer, library and IPC. A grant tolerates **off-path
  errors only** — it can never excuse an active-path or connector-structure error. Grants are bound to
  a **content hash** over `{version, nodes, edges}`: renaming a flow or editing its description keeps
  the grant; changing anything executable voids it instantly (`standing: "edited"`). Grants expire
  (30-day window), can be revoked (`repaired` / `migrated`), and count runs for audit. `runnable`
  remains derived — nothing is persisted onto a flow profile.
- **Inventory scan** (`app/main/validation/flowValidationService.ts`): classifies every flow as
  `valid` · `temporarily-compatible` · `immediately-blocked` · `possible-validator-defect`, and issues
  grants only to the off-path-only group. Re-scanning never re-issues or extends a deadline.
  `possible-validator-defect` = the validator rejects a flow whose exact content already completed a
  successful run after its last edit (from durable run history) — flagged for human review, never
  silently granted. `ensureInventoryScan` runs on the first gate call, so tightening validation cannot
  silently break flows that ran yesterday.
- **Suggested fixes** (`src/validation/SafeFixApplier.ts`, pure): schema migration only — enum-casing
  normalization and duplicate *connector* id regeneration. Ceremony: **preview → explicit confirm →
  untouched backup → apply → migration report → undo**. Undo restores byte-for-byte and refuses if the
  flow was edited after the migration. Duplicate *node* ids, missing locators/values, orphans, missing
  End nodes, broken endpoints, unknown operators, bad timeouts and over-cap loops all carry **no** fix.
- **UI:** designer validate-on-load banner (Legacy / warnings / not-runnable, with *Review manually*
  and *Fix N safe issues…*); a change-preview dialog listing every rewrite; an undo banner after a
  migration; the Flow Library shows a distinct dashed **"Legacy · until YYYY-MM-DD"** pill. Opening a
  legacy flow never modifies or saves it (GUI-verified).
- **New IPC:** `validation:*` (statusAll, status, meta, grants, latestScan, runInventoryScan,
  previewSafeFixes, applySafeFixes, undoMigration, migrations). Mutating channels require
  `WORKFLOW_EDIT`. 198 handlers, contract green.
- **Verification:** `verify-legacy-compat` **90/0** (new) · `verify-validation` **125/0** ·
  `verify-random-oracle` **27/0** · `verify-random-generator` **49/0** · `verify-random-roundtrip`
  **26/0** · `verify:runner` **82/0** · `verify:flow-designer` **56/56 real Electron** ·
  `verify:workflow-builder` **20/20** · `verify:canvas-perf` **13/13** · `verify:profile-store` **16/16**
  · `verify:instance-monitor` **43/0** · `verify:authz` **40/0** · `verify:ipc-contract` **4/4** ·
  `verify:workflow-sentinels` **4/4** · `npm run build` clean.
- **Defect found & fixed:** migration ids/backup paths were `flowId.timestamp`, so two migrations in
  the same millisecond collided and the second would have **overwritten the first's backup**. Ids are
  now uniquified. Also corrected a Stage 2a latent bug: the `safeFix.field` path for conditional vs
  loop-condition operators was inverted (harmless while metadata was descriptive-only; a silent no-op
  once an applier consumed it) — both directions are now pinned by tests.

## Randomized Test Lab — Tranche 2 Stage 2b: validation engine WIRED into production (2026-07-21, epic `awkit-wza`)

**Branch `feature/randomized-test-lab`.** The shared `FlowValidator` engine now drives the run gate, the
Flow Designer, the Workflow Builder, the Flow Library and `flows:import`. `awkit-7fm` (9 undetected
defect classes) and `awkit-acw` (`radio` locator drift) are **closed** — `verify-random-oracle` asserts
every rule is both detected and production-enforced (27/0).

- **Run gate:** `PreRunValidator` is a thin adapter over `validateFlowSet` — no flow rules of its own;
  the drifted hardcoded locator list is deleted. Every issue carries `blocking`, `code`, `flowId`,
  `nodeId`/`edgeId`, `onActivePath`; `execution.ipc.ts` blocks iff `isRunBlocked(issues)`. Blocking =
  active-path errors + ALL connector-structure errors (the runtime refuses those flow-wide). Warnings
  and confirmed off-path errors (orphan nodes) report but never block. Unknown reachability (no single
  Start) blocks conservatively. Validation is **scoped** to the scenario's flows + transitive `runFlow`
  closure — previously the whole library was validated and an unrelated broken draft blocked every run
  (pre-existing bug, fixed).
- **Draft model:** designer and builder saves NEVER block on validation; an invalid flow saves as a
  Draft exactly as built ("Saved as draft: N validation errors…" info toast). No `runnable` boolean is
  persisted anywhere; runnability is derived fresh per surface.
- **Designer:** the validation chip is derived (`Runnable` / `N findings` / `Draft — not runnable (N)`)
  and opens a clickable issue list — each row navigates to the offending node/connector via the issue's
  structured location. Engine rules replaced the old advisory `validateFlow`; renderer keeps only
  advisories the engine lacks (locator uniqueness, conditional config completeness, dead-end non-End
  node, ambiguous priorities). Revalidation is `useDeferredValue`-paced; `verify:canvas-perf` (13/13)
  confirms no canvas re-render regressions.
- **Library:** async derived status per flow — `Checking…` → `Runnable` / `Not runnable` / `N findings`
  — computed off-tick, never written back to the profile.
- **Import:** `flows:import` returns `{ profile, validation }`; parseable invalid flows import as
  drafts; unparseable documents still fail as document errors (distinct from validation).
- **Owner decisions:** canonical loop cap **1,000** lives in `src/validation/FlowLimits.ts`; FlowExecutor
  `LOOP_CONNECTOR_HARD_CAP`, `FLOW_BOUNDS.maxLoopIterations` (was 10,000), the test-lab catalog and the
  renderer read it. `validateConnectorStructureDetailed` (FlowProfile.ts) provides structured connector
  findings; the legacy string form wraps it byte-identically. The test-lab generator derives
  `config.targetFlowId` from the canonical `flowId` (they can no longer disagree).
- **Verification:** `verify-validation` **124/0** · `verify-random-oracle` **27/0** ·
  `verify-random-generator` **49/0** · `verify-random-roundtrip` **26/0** · `verify:runner` **82/0** ·
  `verify:flow-designer` **37/37 real Electron** (draft save, chip, navigation, gate, library Checking
  state) · `verify:workflow-builder` **20/20** · `verify:canvas-perf` **13/13** (harness repaired: it
  predated the splash window + SecurityGate; now isolated + signed-in like every other GUI verifier) ·
  `verify:profile-store` **16/16** · `verify:instance-monitor` **43/0** · `verify:ipc-contract` **4/4** ·
  `verify:workflow-sentinels` **4/4** · `npm run build` clean.
- **Not yet (Stage 2c):** Legacy Compatibility status (deadlines/audit/banner), suggested-fix
  preview/backup/undo/migration reports, inventory scan. Nothing of it was implemented early.

## Randomized Test Lab — Tranche 2 Stage 2a: pure Flow Validation Engine (2026-07-21, epic `awkit-wza`)

**Branch `feature/randomized-test-lab`.** The shared validation engine exists and every one of the 9
validation gaps Phase 2 found (`awkit-7fm`) is closed **at the engine level**. `verify-random-oracle` is
green for the first time (**26/0**, was 19/1).

**Stage 2a is additive and behavior-neutral: the engine is wired into NOTHING.** No save, run, import,
designer, builder or persistence path calls it, no flow file or schema changed, no Legacy Compatibility
state exists yet, and nothing is auto-fixed or migrated. Low-risk, not risk-free — `TestExecutionOracle`
and `RandomMutator` are shared test-lab modules, so a regression there would surface in the Test Lab
verifiers rather than in the product.

- **New engine:** `src/validation/FlowValidator.ts` (pure, framework-agnostic) — 20 rules, forward-BFS
  reachability from Start, and an `onActivePath` flag on every issue. Verdict-free: it reports, callers
  decide. `src/validation/StepRequirements.ts` holds the locator/value requirements as an exhaustive
  `Record<StepType, …>`, so `tsc --noEmit` fails if a step type is added without a decision — the drift
  that produced `awkit-acw` cannot recur there.
- **Contract:** stable rule code · severity · `onActivePath` · flow/node/connector location · human message ·
  optional `safeFix` metadata that is **described and never applied**. Output ordering is deterministic
  (rule declaration order, then node id, connector id, message) and independent of input order.
- **Wrapped, not reimplemented:** `validateConnectorStructure` stays the untouched runtime gate; the engine
  wraps it so one call returns everything.
- **Still open (Stage 2b):** 10 rules are detected by the engine but enforced by **no production caller**,
  and `PreRunValidator.ts:55` still hardcodes its drifted locator list (`radio` escapes). Both are asserted
  exactly by the oracle and reported as the "Stage 2b wiring checklist" in
  `reports/random-tests/validation-gaps.md`.
- **Verification:** `verify-validation` **99/0** (new) · `verify-random-oracle` **26/0** (was 19/1) ·
  `verify-random-roundtrip` **26/0** · `verify-random-generator` **49/0** · `verify:runner` **82/0** ·
  `verify:profile-store` **13/13** · `verify:ipc-contract` **4/4** · `verify:workflow-sentinels` **4/4** ·
  `npm run build` clean.
- **Design:** `docs/plans/FLOW_VALIDATION_ENGINE_DESIGN.md` (Stage 2b = wire into run gate + designer;
  Stage 2c = Legacy Compatibility + migration subsystem).

## Randomized Test Lab — Tranche 1: all round-trip data-loss defects FIXED (2026-07-21, epic `awkit-wza`)

**Branch `feature/randomized-test-lab`.** The Phase-3 designer round-trip is now **lossless** — the
baseline discovery verifier that was intentionally red (8 passed / 15 failed) is **green (26/0)**. All
**11 observed** round-trip defects and **2 predicted** ones were fixed in the designer mapping and their
catalog entries deleted, so any recurrence now reports as an *unexpected new failure* (a regression).

- **Owner of every fix:** `app/renderer/components/workflow/flowProfileMapping.ts` (the single designer↔
  profile mapping), plus pass-through fields on `flowDesignerTypes.ts` and metadata/edge-id threading in
  `app/renderer/pages/FlowChartDesigner.tsx`.
- **The pattern:** the designer *preserves* fields it cannot author instead of re-deriving them — the same
  approach as the earlier RT-14/RT-02 fix (`valueSourceOriginal`). New pass-throughs: `safety` (RT-04),
  popup metadata `pageAlias`/`opensPopup`/`popupExpectation` (RT-03), full `outputs` map (RT-12),
  `loop`/`message` (RT-15). Persistence-not-validation locator gate (RT-01). Persisted `edge.id` threaded
  through `createEdge` (RT-05) and authored-only edge labels (RT-08). Flow `description`/`version`/
  `createdAt`/`updatedAt` threaded via a new `toFlowProfile` `meta` arg (RT-06/RT-07). `maxLoopCount`
  persisted on any connector (RT-11). `toNodeConfig` emits only a node type's own fields, gated by the
  registry `sections` (RT-09). Absent optional fields re-omitted on a no-op save but **never** when the
  user edits them (RT-10, edit-safe). Inactive dynamic `dataSourceId`/`objectId` retained (RT-13).
- **Generator** now emits the RT-13/RT-15 shapes (mixed dynamic discriminators; `message`/`loop`), so both
  formerly-*predicted* defects are exercised and confirmed lossless.
- **Verification:** `verify-random-roundtrip` **26/0** (was 8/15; +8 new field-edit regression checks) ·
  `verify-random-generator` **49/0** · `verify-random-oracle` **19/1** (the 1 is the intentional
  validator-gap finding, `awkit-7fm`, Tranche 2) · `verify-durable-store` **11/11** · `verify:flow-designer`
  **24/24 real Electron** · `verify:runner` **82/0** · `npm run build` clean · `check-memory` pass.
- **Beads closed:** `awkit-abi` (RT-01), `awkit-4t9` (RT-03), `awkit-3lq` (RT-04), `awkit-07c` (RT-05),
  `awkit-3qs` (RT-06), `awkit-ani` (RT-07), `awkit-7df` (RT-08), `awkit-ao6` (RT-09), `awkit-who` (RT-10),
  `awkit-o4q` (RT-11), `awkit-x8w` (RT-12). RT-13/RT-15 were catalog-only predictions (no bead).
- **Next (Tranche 2 — architectural checkpoint):** unified validation engine + draft/runnable model
  (`awkit-7fm`, `awkit-acw`). Then Phases 4 (artifacts/CLI), 5 (live), 6/8.

## Randomized Automation Test Lab — Phases 1-3 + Phase 0 prerequisites (2026-07-21, epic `awkit-wza`)

**Branch `feature/randomized-test-lab`** (off `main`, 6 commits, **local — not pushed, no PR**). Additive
testing subsystem: deterministic generation, a validation oracle, and persistence round-trip discovery over
the existing engine. Separately, the owner's long-uncommitted branding/accent/HTTPS work was preserved as a
single commit on `chore/brand-logo-5b` (`a1adcc2`, 64 files, also unpushed and unreviewed here).

- **Phase 1 — generation core** (`src/testing/random/**`, `src/testing/fixtures/SafeTestData.ts`).
  Seeded PRNG with position-stable `derive()`; exhaustive `Record<Literal, ...>` catalogs so
  `tsc --noEmit` fails when a node type or connector mode is added without teaching the generator;
  a valid-by-construction pattern library (9 patterns) whose output satisfies the real
  `validateConnectorStructure`. `npx tsx scripts/verify-random-generator.mts` — **49/49**.
- **Phase 2 — validation oracle** (`src/testing/oracle/`, `RandomMutator.ts`). 13 controlled
  mutations, exactly one defect per scenario, judged against the real validators.
  `npx tsx scripts/verify-random-oracle.mts` — **19 passed, 1 failed**, the failure being a real
  product defect (`awkit-acw`). Found that **9 of 13 defect classes are rejected by no validator**
  (`awkit-7fm`) — several rules exist only in the renderer's *advisory* `validateFlow`, and there
  is no flow-level reachability check at all.
- **Phase 3 — persistence round-trip** (`src/testing/roundtrip/`). Field-level semantic diff plus a
  defect catalog. `npx tsx scripts/verify-random-roundtrip.mts` — **8 passed, 15 failed BY DESIGN**.
  JSON serialization is lossless; the designer mapping loses data in **13 catalogued ways** with
  **0 unexpected failures**. **This verifier must stay failing** until the defects are fixed; do not
  tune, skip or weaken its assertions. Worst finding (`awkit-1w5`, unpredicted): `fromFlowStep`
  flattens `value` + `valueSource` into one string and `step.url` heads the recovery chain, so a
  `goto`'s typed source is overwritten by its URL.
- **Phase 0 — prerequisites.** `flowProfileMapping.ts` is now the single source of the designer
  persistence mapping (`FlowChartDesigner.tsx` imports it; behavior-preserving). Two stale
  `verify-durable-store.mts` assertions pinned at 2 migrations now derive from
  `RUNTIME_STORE_MIGRATIONS` (4) — that verifier was silently red and is now **11/11**. Mock site
  gained `/runner-lab` (downloads, HTTP failures + `Retry-After`, fail-twice-then-succeed, multipart
  upload) and `/iframe-lab` + `/iframe-child` (same-origin interactive frame with deliberate
  top-level decoys). `uploadFile`/`downloadFile` are no longer gated in the generator.
  `npm run verify:mock-site` — **65/65**.

- **First two defects FIXED** (`awkit-1w5`/RT-14 and `awkit-ihx`/RT-02, both closed). `fromFlowStep`
  collapsed `FlowStep.value` and `FlowStep.valueSource` into one designer string with `step.url` at the head
  of the recovery chain, so a `goto`'s typed source was overwritten by its URL and `secret`/`dynamic` sources
  were dropped entirely. The properties panel only authors two of the nine kinds (`static`, `dynamic`), so
  `FlowDesignerNodeData.valueSourceOriginal` now preserves the loaded source verbatim and `createValueSource`
  reconstructs only those two, passing the rest through. Round-trip went **8 passed/15 failed →
  17 passed/12 failed**, defect shapes **46 → 35**, with 0 unexpected new failures throughout. Both catalog
  entries were deleted so any recurrence reports as a regression. `verify:flow-designer` 24/24 in real
  Electron.

**⚠️ Two verifiers are intentionally RED** (`verify-random-roundtrip` 17+12, `verify-random-oracle` 19+1) —
each failure is a filed product defect. Fix the defect and delete its catalog entry; never weaken the
assertion. Reports (gitignored) land in `reports/random-tests/`. Docs:
`docs/testing/RANDOMIZED_TESTING_*.md`.

## E2E-assessment defects FIXED — sender-bound IPC authorization + first-run seed removal (2026-07-19, later session)

Implemented the plan to close the open E2E-QA findings (bd **`awkit-64x`** + **`awkit-b92`**,
both CLOSED). **Merged to `main` @ `79e9999` via PR #22.**
- **awkit-64x (DEF-003) — first-run seeding removed:** `app/main/profileStores.ts` `seedFolder` dropped (flows +
  workflows); `dataSource.ipc.ts` `ensureDefaultDataSource` + `runtimeInput.ipc.ts` `ensureDefaultRuntimeInputs`
  deleted (stores return `store.list()`). A fresh profile now shows empty states; samples remain in `resources/`
  via `npm run seed:mock-fixtures`. `verify:e2e-sweep` flipped to assert empty states.
- **awkit-b92 (DEF-004/005) — sender-bound trusted authorization:** new `app/main/security/sessionContext.ts`
  binds `event.sender.id → sessionRef` (on login/change-password/validate; unbound on logout/destroy/expiry).
  `assertSenderPermission(event, perm)` fail-closed-gates the non-admin IPC surface — `execution:*` (EXECUTE/STOP),
  flow/workflow CRUD (CREATE/EDIT/DELETE), data-source CRUD (DATASOURCE_MANAGE), substantive `settings.update`/
  reset/import (SETTINGS_EDIT). Renderer per-action gating via `usePermissions().can()` disables Create/Edit/
  Delete/Clone/Run/Stop/Save across libraries, designers, DataSource pages, InstanceMonitor (`NodeOptionsMenu`/
  `WorkflowRunCard` gained `disabled` props). Footer nav permission-filtered (Settings hidden without
  `page.settings`; Help Center universal).
- **OBS-001/002:** StatusBar chips now read "Active flows/browsers"; `AWKIT_REAUTH_WINDOW_MS` dev/test override
  wired through `SecurityKernelOptions.reauthWindowMs`.
- **Verification (all green):** `npm run build` clean; new `verify:session-context` **11/11**; `verify:e2e-rbac`
  **49/49** (Viewer `settings.update` + real run now DENIED, footer filtered); `verify:e2e-sweep` 13/13;
  regression `verify:e2e-auth` 30 · `verify:e2e-licensing` 22 · `verify:runner` 82 · `verify:authz` 40 ·
  `verify:auth` 49 · `verify:security` 39 · `verify:licensing` 56 · `verify:ipc-contract` 4 · `verify:auth-gui`
  18 · `verify:admin-gui` 11 · `verify:avatar` 24.
- **Residual (follow-ups):** `oracle.ipc.ts` backend not yet sender-gated (its UI is gated) — bd `awkit-b3w`
  (P2); live ReauthDialog GUI automation — bd `awkit-2d8` (P3). Pattern saved: `bd remember` key
  `sender-bound-authz`.

## E2E QA assessment — auth/RBAC/licensing/route-sweep suites EXECUTED GREEN (2026-07-19, later session)

Adapted full E2E QA of `main` @ `0a4500f` (bd `awkit-xyo`; the generic web-app template was adapted to
Electron with owner approval). New assets: coverage matrix + reports under `docs/testing/`
(`E2E_COVERAGE_MATRIX.md`, `E2E_EXECUTION_REPORT.md`, `E2E_DEFECTS.md`), specs under `specs/e2e/`,
shared drivers `scripts/lib/e2e-qa-lib.mjs`, and four executable suites — `verify:e2e-auth` **30/30**,
`verify:e2e-rbac` **42/42**, `verify:e2e-licensing` **22/22**, `verify:e2e-sweep` **13/13** (all real
Electron, isolated fresh profiles). Healed two silently-broken existing suites (`verify:auth-gui` →
18/18, `verify:admin-gui` → 11/11 — stale post-PR-#21 selectors). Regression rerun green:
`verify:licensing` 56, `verify:avatar` 24, `verify:ipc-contract` 4, `verify:authz` 40, `verify:auth` 49.
**Product findings (both since FIXED — see the section above):** bd **`awkit-64x`** — fresh install
seeds bundled samples as real user records (RULES.md violation); bd **`awkit-b92`** (pre-existing) —
`settings:update`/`execution:*` IPC carry no per-role check, and the footer Settings/Help Center nav
is not permission-filtered (route guard holds). Evidence: `test-artifacts/2026-07-19-e2e-qa/`. This
assessment session changed no production code (the fixes landed in the follow-on session above).

## Admin/Licensing package — login branding, admin UI kit, profile avatar, per-machine licensing (2026-07-19)

Implements the external `specterstudio-admin-licensing-phases` (8-phase) package on branch
`feature/superuser-admin-rbac` (NOT committed). Frontend UI built with the `apple-design` skill; token-only
theming. Full write-up in **`docs/LICENSING.md`**.
- **Login branding (Phase 1):** official `specter-violet` logo (`app/renderer/assets/brand/specter-logo.svg`)
  on the login card, vector (high-DPI sharp), `onError` fallback to the built-in glyph. `LoginScreen.tsx`.
- **Admin UI kit (Phase 2):** shared `pages/admin/components/AdminUi.tsx` — `AdminPage`, `AdminBanner`,
  `AdminStatusBadge` (one 13-state vocabulary, icon+text, theme-aware), `AdminLoading`, `AdminEmpty`. All 5
  admin pages compose it; audit "Refresh" moved into the canonical `TopHeader` via `usePageChrome`. Route
  authorization was already enforced and is preserved.
- **Profile avatar (Phase 3):** `lib/initials.ts` (Unicode/`Intl.Segmenter` Teams-style initials + FNV
  deterministic palette), `components/shared/UserAvatar.tsx` + `AccountMenu.tsx`; `AppFrame` now shows the
  rounded avatar + name + role + Sign out. `verify:avatar` = 24/24.
- **Licensing core (Phase 4):** new `src/licensing/**` bounded context — Ed25519 signed licenses, multi-signal
  hashed **machine fingerprint** (no IP), 11-status validator with exact-timestamp expiry, adaptive store
  (LocalAppData primary / ProgramData optional-read, atomic + checksum), activation-request export. Separate
  offline issuer `tools/license-issuer/**` (NOT bundled; private key external). App ships **public key only**.
- **Licensing integration (Phase 5):** granular Super-User-only permissions (`license.*`), trusted
  main-process `licenseRuntime` + `licensing.ipc.ts` (RBAC + reauth + audit), preload `licensing.*`,
  full `LicensingPage.tsx` (replaces placeholder). **Enforcement is OPT-IN, default OFF**
  (`SPECTER_LICENSE_ENFORCE=true`); the run gate sits in `execution.ipc.ts` before `startRun`.
- **Verification:** `npm run build` (tsc) clean; `verify:licensing` = 56/56 (domain + RBAC); `verify:avatar`
  = 24/24; real-key issuer→app E2E (VALID here, MACHINE_MISMATCH elsewhere); no private key in repo/package.
  External gates unchanged (clean-machine offline, packaged EXE, live Electron GUI walkthrough — see
  `docs/LICENSING.md` §6).

## Super User administration + RBAC authorization IMPLEMENTED & verified (Phase 3, 2026-07-19)

Adds the authorization/administration layer on top of the auth trusted core (design plan Phase 3/11/12).
On branch `feature/superuser-admin-rbac` (NOT committed to `main`).
- **RBAC core (`src/security/authz/`):** `Permissions.ts` — the single permission registry + immutable
  built-in roles (**SuperUser / Administrator / Operator / Viewer**) + `effectivePermissions`. Decisions:
  scrypt (O-1), built-in roles only (O-2), roles-only v1 (O-4), fresh-login-after-restart (O-5);
  recovery codes were deferred at this phase and are now complete under `awkit-aty` (2026-07-29).
- **Enforcement (`AuthorizationService`) is the real boundary:** every mutating IPC handler calls
  `requirePermission(sessionRef, perm)` **after** session validation (deny-by-default); sensitive ops also
  require a fresh **re-auth within 5 min** (`requireFreshReauth`, `security:reauth`). Hiding a UI control is
  never the check — proven by tests that drive the IPC path directly.
- **User management (`UserAdminService`):** create/update/enable/disable/archive(soft-delete)/reset-password/
  revoke-sessions, with **final-active-Super-User protection**, protected-SU immutability (no delete/disable/
  demote), no privilege escalation (USER_MANAGE is SuperUser-only), **session invalidation** on disable /
  role-change / password-reset, and a full audit trail. Admin-created users are forced to change password.
- **Schema migration v2:** per-user `roles` JSON column (protected SU backfilled with `SuperUser`) + an
  `archived` status. `PrincipalSnapshot` now carries `roles` + effective `permissions` (UI hints).
- **IPC + preload:** 9 authorization-enforced, schema-validated `security:admin:*` + `security:reauth`
  handlers; `.security.admin.*` preload namespace.
- **Renderer:** `usePermissions().can()` + `RoutePermissions` gate the nav (`LeftNavigation` hides
  unpermitted items/groups) and the route mount (`App` shows `NotAuthorized` for a disallowed route).
  New **Super User Administration** area: **Users** (full CRUD + role editor + reauth modal), **Roles**,
  **Permissions** (matrix), **Audit Log**, **Licensing** (placeholder — machine licensing deferred, kept
  separate from authz). Token-only `.awkit-admin-*` CSS, light/dark.
- **Verify:** new **`verify:authz` 40/40** (permission enforcement, privilege-escalation denial, final-SU
  protection, disable/role-change/reset session revocation, reauth gating, audit) + new **`verify:admin-gui`
  10/10** (real Electron: SU sees admin nav, create user, Roles/Permissions/Audit/Licensing render, 0 console
  errors). `verify:auth` **49/49**, `npm run build` clean. Screenshot `reports/security-admin/`.
- **Remaining (follow-ups):** machine
  licensing (Phase 5); Active Directory provider; deeper per-action button gating on non-admin pages.


## Secure Login + Oracle driver-settings MERGED to `main`; release-readiness audit run (2026-07-18)

**State correction (read first):** the two entries below, and the older `HANDOFF.md` notes, describe the
Secure Login work (trusted core + login UI) and the Oracle user-selected-Java/direct-JDBC work as living on
feature branches / "NOTHING COMMITTED". **That is now stale.** Both shipped to `main` on 2026-07-18:
- **PR #14** (`79e20a5`) — Oracle: user-selected Java runtime + direct JDBC (UCP removed).
- **PR #15** (`93162d6`, current `main` HEAD) — Secure Login: trusted core + login UI.

`main` is at `93162d6`; the working tree is clean apart from this audit's own doc/tracker edits. Where the
entries below say "on branch `feature/secure-login-auth`" or "Nothing committed", read "merged to `main`".

**Release-readiness audit (`fullstack-webapp-testing` skill), decision `CONDITIONAL GO` for `main` as a
dev/integration checkpoint — explicitly NOT a production-ship verdict.** Report + evidence under
`test-artifacts/2026-07-18-release-readiness-audit/`. Fresh safe-test evidence on `93162d6`: `npm run build`
clean; `verify:ipc-contract` 4/4 (172 handlers); `verify:security` 39/39; `verify:secrets` 16/16;
`verify:auth` 41/41; `verify:auth-gui` 13/13 (real Electron); `verify:profile-store` 13/13;
`verify:write-queue` 7/7; `verify:mock-site` 39/39; `verify:runner` 82/82 (real Chromium core E2E). Manual
secret-leakage scan of tracked source clean (only mock/test fixtures + one enum constant match); `.env`
gitignored; no key/cert files tracked. No P0/P1 defects in anything tested. Un-run (scope/time, not failures):
the Oracle 350+-check suite, concurrency/stress/soak, packaging/offline validation, Recorder/Smart-Wait/
popup/canvas-perf/chromium-hardening, automated a11y (none wired in this repo), and the standing external
gates (clean-machine offline VM walkthrough, signed packaged EXE, Oracle live perf/soak) — all unchanged by
this audit.

**GUI-verifier regression fixed across the general verifiers (bd `awkit-gmn`; 2026-07-19 sweep).** Root
cause is two-part: the branding splash breaks `app.firstWindow()` (returns the bridge-less splash, which
self-closes), **and** PR #15's `SecurityGate` now gates every route — the real `<App/>` shell never mounts
pre-auth. Fixed with a shared harness `scripts/lib/gui-verify-harness.mjs` (`resolveMainWindow` +
`signInFirstRun` + `isolatedLaunchEnv`): **verify:reports 31/31** (original reference), **capacity-settings
12/12**, **instance-monitor-gui 12/12**, **runtime-analytics-gui 36/36** (all four seeded states), **workflow-builder
20/20** (seeds flows+workflow), **flow-designer 24/24** (seeds a flow; launches + signs in + every
behaviour check passes). `verify:settings-persistence` is **3/3 unchanged** (pure preload IPC, never gated).
All counts re-verified independently 2026-07-19. **flow-designer's 5 stale geometry assertions modernized
(bd `awkit-9p6`, CLOSED):** rewritten from the old docked-column model (`canvasEngineRight <= panelLeft`,
`panelRight <= canvasRight`) to the actual floating-overlay invariants — the flow engine keeps the full
canvas width and the fixed-width drawer floats over its right edge (measured: ~1.8px right overhang, panel
below the action bar, collapsed rail = 48px = CSS `calc(space-5*2)`); the collapse measurement now waits for
the 240ms glide to settle instead of racing it (was flaky at 220ms). **`verify-oracle-drivers-gui` made
self-contained + gate-threaded (bd `awkit-xjv`, CLOSED): 30/30** — now launches on an isolated empty
`%LOCALAPPDATA%`, **copies** the validation stores (`java-runtimes` + `oracle-drivers`) from the source
profile into it (machine-global `java.exe` path + the bundle's own managed jar → same ids), signs in past
the SecurityGate, and reaches Settings via nav clicks (no session-dropping reload); the real bridge still
launches Java + loads the real ojdbc driver end-to-end (`driverAvailable=true driver=23.26.2.0.0`). It only
reads the source profile, so it is non-destructive; needs `build:oracle-bridge` + the real java.exe/ojdbc
jar present (override the source with `AWKIT_GUI_SOURCE_LOCALAPPDATA`). One idempotency defect found + fixed
during re-verification (bd `awkit-7ek`,
CLOSED): `runtime-analytics-gui` uses persisted `.fixtures-observability/<state>` dirs, so a re-run left a
provisioned Super User behind and hit the login form (0/4); `walkState` now clears
`<state>/SpecterStudio/security` before each launch — proven idempotent (36/36 twice, no re-seed).

**Secure Login hardening landed (2026-07-19): `awkit-ekd.6` + `awkit-ekd.7` CLOSED.**
- **Session rotation (ekd.7):** `changePassword` now revokes every *other* active session for the user
  (keeps the current one) — `SessionManager.revokeOthersForUser` → `SecurityStore.revokeSessionsForUserExcept`.
  `verify:auth` is now **45/45** (added 4 Session-rotation checks).
- **Single-instance guard (ekd.6):** `app/main/main.ts` acquires `app.requestSingleInstanceLock()`; a second
  launch focuses the running window (`second-instance`) and quits before opening any window/store, so two
  processes can't race on `security.sqlite`/ui-settings per profile. New **verify:single-instance 3/3**.
  The finer DurableLockStore-around-writes remains optional defense-in-depth (`awkit-ekd.8` P3 still open).

## SecurityStore debounced persistence (2026-07-19, `awkit-ekd.8`)

`SecurityStore` previously exported + atomic-renamed the whole DB on **every** mutation (a login was ~4
full writes; the new idle-lock heartbeat's `touchSession` fsynced on every validate). It now mirrors
`SqliteRuntimeStore`'s **debounced + persist-on-critical-transition + flush-on-close** model:
- **Critical (immediate, awaited flush):** `setProvisioned`, `insertUser`, `updateUser`, and all three
  `revoke*` — security correctness (a provisioned/changed/revoked credential must survive a crash).
- **Debounced (300 ms, coalesced):** `insertSession`, `touchSession`, `appendAudit`. A burst collapses to
  one write; any critical flush sweeps up whatever is pending (the whole in-memory DB is exported); a
  crash before the debounce window is fail-closed (re-login / slightly-stale idle window / a missing
  forensic row). `close()` (app quit → `disposeSecurityKernel`) force-flushes the trailing write, and
  `open()` still forces the initial schema write.
- **Verify:** `verify:auth` **49/49** (+4: burst does 0 synchronous writes → coalesces to 1; critical
  revoke flushes immediately; `close()` flushes the trailing debounced write, via a test-only
  `persistWriteCountForTest()`). `verify:auth-gui` **18/18** (real Electron, DPAPI + real close-on-quit),
  `verify:security` **39/39**, `verify:single-instance` **3/3**, build clean. Closes `awkit-ekd.8`.

## Proactive idle-lock UI + dark-mode login pass (2026-07-19, `awkit-l6h`)

The login gate previously re-validated only on window focus/visibility (server idle/absolute timeouts still
enforced). It now **locks proactively on user inactivity** and passes a dark-mode visual check.
- **Renderer activity tracking (`SecurityGate`):** while authenticated, an activity heartbeat
  (pointer/keyboard/wheel/scroll/touch) drives a poll that (a) **locks after the idle window** without
  waiting for a focus event — returning to the login screen with a *"You were signed out after N minutes of
  inactivity."* notice (`.awkit-login-notice`, info-toned, theme-aware), and (b) while the user is genuinely
  active, **refreshes the server's sliding idle window** (`validateSession`) so a continuously-used,
  never-blurred window isn't logged out at the timeout, and catches server-side invalidation (absolute
  expiry, deactivation, revoke-on-password-change). Tick + refresh cadence scale off the idle window.
- **Idle window surfaced to the renderer:** `SecurityKernel.getBootState()` now returns `idleTimeoutMs`
  (from `SessionManager.idleTimeoutMs`); the Electron binding honors an optional numeric
  `AWKIT_SESSION_IDLE_MS` override (dev/test only — production uses `DEFAULT_SESSION_POLICY`, 30 min).
- **Verify:** `verify:auth-gui` **18/18** (was 13/13) — added dark-mode login (`data-theme=dark` when dark
  appearance is selected; screenshot `reports/security-login/login-dark.png`) and a real proactive-lock test
  (a 4s `AWKIT_SESSION_IDLE_MS` window → idle → bounced to login with the inactivity notice, no focus event;
  screenshot `login-idle-locked.png`). `verify:auth` **45/45**, `npm run build` clean. Files:
  `SecurityGate.tsx`, `screens/LoginScreen.tsx`, `global.css` (`.awkit-login-notice`),
  `src/security/{SecurityKernel,session/SessionManager}.ts`, `app/main/{security/securityKernel,preload}.ts`,
  `scripts/verify-auth-gui.mjs`.

## Secure Login — trusted core + login UI IMPLEMENTED & verified (real Electron); authz/licensing pending (2026-07-18)

The **login UI (Phase 6)** is now built on top of the trusted core, on branch `feature/secure-login-auth`.
`app/renderer/main.tsx` renders a new `SecurityGate` (`app/renderer/security/`) that mounts **only** the
sign-in surfaces until the trusted main process confirms a session — the real `<App/>` and every protected
route are never mounted before auth, so **protected pages cannot flash** (asserted by the GUI verifier).
Surfaces: `LockedShell` (reuses the custom `AppFrame`), `LoginScreen` (Virtual User active; **Active
Directory a disabled "Coming soon" tab**), `FirstRunSetup` (one-time Super-User provisioning → auto sign-in),
`ForcedPasswordChange`, `SecurityUnavailable` (fail-closed), `PasswordField` (show/hide + Caps-Lock),
`SessionContext` + a title-bar user chip & sign-out in `AppFrame`. Styling is token-only in `global.css`
(`.awkit-login-*`), light/dark, reduced-motion-aware, keyboard-accessible.
- **Verify:** `npm run verify:auth-gui` → **13/13 in real Electron** (isolated temp `%LOCALAPPDATA%`):
  no-flash, first-run → app shell, session chip + sign-out → login, AD disabled/coming-soon, re-login,
  zero console errors. Screenshots in `reports/security-login/`. `npm run build` + `verify:auth` (41/41) +
  `verify:ipc-contract` (4/4) green. Follow-up bead `awkit-l6h` (proactive idle-lock + dark-mode visual pass).

## Secure Login — trusted auth core IMPLEMENTED + headless-verified; UI pending (2026-07-18)

On branch `feature/secure-login-auth` (epic `awkit-ekd`), the **Phase 1+2 backend trusted core** for
local virtual-user authentication is implemented and verified headless — **no login UI yet** (deliberate:
"prove the core before the UI"). New code (all under `src/security/**` + `app/main/security/**` +
`app/main/ipc/security.ipc.ts`, distinct `security:*` IPC namespace — the existing `auth:*`/`session:*`
are automation-only and untouched):
- `SecurityStore` (sql.js + versioned migrations, single-writer atomic-rename persistence, `passwordSecret`
  column wrapped by an injected `ColumnCrypto` — Windows DPAPI `safeStorage` in main, passthrough in tests).
- scrypt password hashing (`node:crypto`, per-user salt, `timingSafeEqual`, rehash-on-login) + password
  policy + username rules.
- `AuthenticationService` (one-time first-run Super-User bootstrap, login with uniform errors, failed-login
  counting, temporary lockout, sessions with idle+absolute timeout, logout invalidation, self-service +
  forced password change, audit) + `AuthenticationProvider` abstraction (Local active; **Active Directory
  a disabled inert stub**) + `SessionManager` + `SecurityKernel` facade.
- `security.ipc.ts` (sender-guarded, schema-validated, fail-closed reason codes) + `.security` preload
  namespace; kernel lazily opened, disposed on quit.
- **Verify:** `npm run verify:auth` → **41/41** (bootstrap one-time, login success/uniform-failure, lockout,
  disabled account, sessions/logout/idle/absolute, password policy/change/forced-change, migrations,
  persistence, no-plaintext-on-disk). `npm run build` + `tsc --noEmit` clean; `verify:ipc-contract` 4/4,
  `verify:secrets`/`verify:security` unaffected.
- **Self-reviewed;** 5 findings — 2 fixed (fail-closed on kernel-open failure; dead-branch simplification),
  3 filed as follow-up beads: `awkit-ekd.6` cross-process single-writer lock (DurableLockStore +
  requestSingleInstanceLock), `awkit-ekd.7` revoke other sessions on password change, `awkit-ekd.8`
  debounced persistence.
- **Remaining (future phases):** authorization/RBAC, Super-User admin UI, machine licensing, and the login
  UI (SecurityGate/LockedShell/LoginScreen + no-flash startup integration). Design authority:

A full implementation-ready design exists at
[`docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md`](../plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md)
for adding local virtual-user authentication, RBAC authorization, Super-User administration, and per-machine
Ed25519-signed licensing — all offline, no admin, preserving packaging/theme. **No production code has been
written.** The plan reuses the `sql.js` migration framework, DPAPI `safeStorage`, the global IPC sender guard,
and Hologram tokens; it introduces new `security`/`license` IPC namespaces (the existing `auth`/`session`
namespaces are automation-only and are left untouched). Startup gains a `SecurityGate` so the login page
follows the splash with no protected-page flash. 10 open decisions (O-1..O-10) must be confirmed before Phase 1.
Tracking bead `awkit-bn2`. Not started; nothing committed.

## Oracle: user-selected Java runtime + direct JDBC, UCP removed → PRODUCTION-CANDIDATE (2026-07-18)

Epic `awkit-kzo` (branch `feature/oracle-jdbc-driver-settings`) is complete and verified. **Specter no
longer bundles Java or UCP.** The user selects a Java runtime and imports an Oracle JDBC driver in
**Settings → Database Drivers**; Oracle runs through the isolated bridge via **direct JDBC** (one
connection per query, no pool). UCP is removed entirely (ucp import rejected; `OracleUcpQueryExecutor`
deleted; no dormant path). Specter stays usable with no Java configured — non-Oracle workflows, JSON, and
Oracle **Snapshot** Data Sources need no Java. Full write-up:
[`ORACLE_USER_SELECTED_JAVA_REMOVE_UCP_REPORT.md`](ORACLE_USER_SELECTED_JAVA_REMOVE_UCP_REPORT.md).

- **Live 7/7** (`verify:oracle-live`, real Oracle 19c) via the Settings Java-runtime + driver-bundle path
  (`Local-JDK-17` Java 17.0.8 + `Oracle-ojdbc17-local-19c-validation` ojdbc17 23.26.2.0.0). Deterministic
  cancellation via a ~8.5M-row cross-join query. Ephemeral `SPECTER_READER` provisioned out-of-band + retired.
- **GUI 30/30** (`verify:oracle-drivers-gui`, real Electron): both Database Drivers cards render; **selected
  Java launches the bridge + loads the real ojdbc driver**; deletion guard; no secrets; 0 console errors.
  Screenshots under `reports/oracle-validation/`.
- **Verifiers**: 13 non-GUI Oracle suites **350/350**; `verify:oracle-direct-jdbc` 23/23, `-java-runtime`
  48/48, `-driver-bundle` 47/47, `-packaging` 23/23, `-offline-bundle` 11/11 (rejects bundled JRE/driver),
  `-runtime-prep` 14/14. `npm run build` clean; `validate:offline` clean (bridge-only bundle).
- **Regression** cross-cutting green (ipc-contract, settings-persistence, profile-store, secrets,
  data-editor, concurrency, cancellation). Found + fixed a pre-existing **branding-splash** regression that
  broke `firstWindow()`-based Electron GUI verifiers (bd bug filed for the rest).
- **Soak** ≥30 min direct-JDBC (`benchmark:oracle-jdbc`, live path): latency P50/P95, cancellation latency,
  bridge+Node RSS, teardown invariants, no pool metrics — see the report §12 + `oracle-soak.json`.
- **Packaging**: only the bridge jar is bundled (`prepare:oracle-runtime`); the offline validator now
  **rejects** any bundled JRE or driver jar. `electron-builder.json` unchanged. `.gitignore` ignores the
  whole generated `resources/oracle-jdbc/`.
- **Remaining external gates**: packaged-EXE build (dev host OOMs on `electron-builder`) + clean-machine
  walkthrough; sustained real-world soak. **Nothing committed** (conservative git profile, ephemeral branch).

## Oracle `verify:oracle-live` gate PASSED against a real local Oracle 19c (2026-07-18)

The **authorized read-only Oracle run** external gate is now met — via the existing local Oracle 19c
(not Docker). On branch `feature/oracle-jdbc-driver-settings`, `npm run verify:oracle-live` ran **7/7 in
real mode** against `jdbc:oracle:thin:@//localhost:1521/ORCLPDB` as least-privilege `SPECTER_READER`,
resolving the driver from the Settings-managed bundle (`ojdbc17.jar` 23.26.2.0.0, JDBC-only). Steps:
testConnection, select-small, truncation, type-conversion, policy-blocks-dml (`SQL_POLICY_VIOLATION`),
permission-or-missing-object (`DRIVER_ERROR`), cancellation (`CANCELLED`). Bridge `executionMode=real`,
Java 17.0.8. Redacted artifact `reports/oracle-validation/oracle-live.json` (gitignored) excludes
credentials / binds / row content.

- **Fixture mismatch resolved additively.** The harness expects `id`/`name` + 50+ rows, but the downloaded
  pack made `CUSTOMERS`(3 rows)/`TYPE_SAMPLES`(1) with different column names. Provisioned the canonical
  `SPECTER_FIXTURE.AWKIT_TYPES_TEST` (204 rows) via new `scripts/oracle/local-19c-awkit-types-fixture.sql`
  (idempotent, OS-auth `sqlplus / as sysdba`), `GRANT SELECT` + private synonym
  `SPECTER_READER.AWKIT_TYPES_TEST` created **as SYS** (reader never granted CREATE SYNONYM). Existing
  `CUSTOMERS`/`TYPE_SAMPLES`/`V_ACTIVE_CUSTOMERS` left untouched. Ran with
  `AWKIT_ORACLE_LIVE_TEST_TABLE=SPECTER_FIXTURE.AWKIT_TYPES_TEST` (schema-qualified SELECT is allowed by the
  read-only SQL policy — tokenizer splits on `.`).
- **Ephemeral credential, then retired.** Minted a strong random dev-only `SPECTER_READER` password via
  OS-auth, stored **only** in a user-scoped scratchpad file (never printed to chat/logs/history/artifact);
  used it for the single run; then rotated to a discarded random password + **ACCOUNT LOCK** and securely
  deleted the secret file. Re-running the fixture SQL `UNLOCK`s the account for a future run.
- **Regression:** `npm run build` clean (tsc + 3 bundles); `verify:oracle-driver-bundle` 43/43.
- **Status stays `INTEGRATION-CANDIDATE`.** This clears one of the four external gates. Still open: the
  **UCP pooled executor is unvalidated** (no UCP jar → the live run used the non-pooled JDBC executor,
  `ucpVersion=unavailable`); the bundled private-JRE `prepare:oracle-runtime` + **packaged-EXE clean-machine
  walkthrough**; and **real perf/soak**. Part B tooling (Docker orchestration, `import-driver-bundle.mts`,
  the `verify-oracle-live.mts` bundle wiring, and this fixture SQL) remains **uncommitted** on the branch.

## Local Oracle fixture provisioned and read-only account verified (2026-07-18)

The downloaded Specter Oracle fixture pack was run successfully against the existing local Oracle 19c
instance (`ORCLPDB`, port 1521). It created/opened `SPECTER_FIXTURE` and `SPECTER_READER`, valid
`CUSTOMERS` / `TYPE_SAMPLES` tables and `V_ACTIVE_CUSTOMERS` view, with deterministic counts 3 / 1 / 2.
Direct grant inspection confirms the reader has only `CREATE SESSION` plus non-grantable `SELECT` on the
three fixture objects and no roles; the supplied verifier also proved `INSERT` is rejected. The downloaded
setup required one external-only idempotency correction because it attempted to open an already-open PDB.
No credentials were persisted or documented. This proves the fixture pack, not yet SpecterStudio's
`verify:oracle-live` application path, so release status remains `INTEGRATION-CANDIDATE`.

## Oracle pending-phase run — 5 of 12 executed, 7 blocked on verified-absent artifacts (2026-07-17)

Ran the 12-phase "pending implementation" plan against merged `main` (`b6e473d`). **Status unchanged:
`INTEGRATION-CANDIDATE`.** Oracle now **226/226** across 10 verifiers (was 218).

- **Executed:** 01 baseline (build + verifiers green, all 3 fail-closed layers present); 04 fail-closed
  revalidation (4 of 5 truth-table rows + the plan's Required Product Behavior); **07 lazy behavior — a real
  gap the plan caught**; 08 full regression; 12 report + summary block.
- **07 is the substantive change:** the lazy suite used to count an *injected stub*. It now drives the
  **real Java bridge process** and counts actual `executeQuery` **RPCs at the wire** (12 → 20 checks). The
  strongest proofs are negative — a Snapshot source and an unreferenced Runtime source leave the Java
  process **never started** (`manager.isRunning() === false`). Also proves single-flight (3 parallel
  consumers → 1 RPC), one-query-per-run, and failed-attempt cache eviction → retry re-executes.
  It additionally covers "runtime unavailable → JSON + Snapshot keep working, Runtime fails safely with
  `DRIVER_UNAVAILABLE`, no crash".
- **Blocked (02, 03, 05, 06, 09, 10, 11) — probed, not assumed:** no `ojdbc*/ucp*.jar` anywhere
  (`~/.m2`/Downloads/Desktop), Maven Central **HTTP 000**, no Docker, no `AWKIT_ORACLE_LIVE_*` creds, no
  clean Windows box. All seven fail at the same first step — acquiring the artifacts. Evidence table +
  per-phase unblock steps in `ORACLE_JDBC_VALIDATION_GATES.md`.
- **Plan assumptions corrected, not obeyed:** it targets "the committed Oracle feature branch" (merged +
  deleted; baseline is `main`) and expects "rebrand/splash absent" (present **by design** — the rename is
  an Oracle dependency). Its `ORACLE_RUNTIME_UNAVAILABLE` token maps to the existing `DRIVER_UNAVAILABLE`
  category; not renamed for cosmetics.
- **Known non-regression:** `verify:durable-store` **9/2** (SQLite migration checks) fails **identically at
  `dee283e`**, pre-Oracle (proven in an isolated worktree). Not ours; left alone.

## Shipped to `main` — Oracle JDBC + SpecterStudio rename + launch splash (2026-07-17)

`main` is at `b6e473d`, CI green. Everything below is **merged and no longer local-only**:

- **PR #11** (`476dc29`) — `chore:` rename WebFlow Studio / playwright-flow-studio → **SpecterStudio**
  (38 files, renames only) + `feat(oracle):` the Oracle JDBC feature (79 files). The rename shipped with
  Oracle because the Oracle work is SpecterStudio-native (`com.specterstudio.*` Java packages,
  `com.specterstudio.app` appId, `%LOCALAPPDATA%/SpecterStudio/`), so shipping Oracle alone would have
  left the rename half-applied.
- **PR #12** (`b6e473d`) — `feat(branding):` launch splash (`app/renderer/splash.html`, a frameless,
  offline, canvas-only window with **no preload/node access**), the new SpecterStudio logo + regenerated
  icons (`icon-source.png` 5.1MB→51KB, `icon.png` 1.4MB→51KB, `icon.ico` 372KB→27KB), the sidebar brand
  mark, and a `generate-app-icon.mjs` rewrite that drops `png-to-ico` (its DIB writer mis-computed
  multi-frame ICO offsets — see KNOWN_ISSUES). `logos/specter-violet/` is the tracked design source of
  truth; the superseded pre-rename families are gitignored.

Verified on merged `main`: `npm run build` clean (emits `splash.html`), Oracle **218/218** across 10
verifiers, `verify:runner` 82/82, `verify:recorder` 72/72, GitHub Actions "Typecheck & Build" success.

**Release status is still `INTEGRATION-CANDIDATE`** — merging shipped the code, not the validation. The
four external gates are unchanged (see `ORACLE_JDBC_VALIDATION_GATES.md`).

> CI gotcha: `.github/workflows/ci.yml` triggers only on `push`/`pull_request` to `main`, so a **stacked**
> PR based on another branch gets **no CI at all**. PR #12 merged without CI having run on it (verified
> locally instead; CI then passed on `main`). Verify stacked PRs locally or retarget before relying on CI.

## Oracle JDBC — status corrected to INTEGRATION-CANDIDATE; fail-closed production, real UCP executor authored, SQL hardening, live/lazy/packaging harnesses (2026-07-17)

Response to a supplied 10-phase **validation & release** track (distinct numbering from the original 14
implementation phases). Its core correction: the prior `PRODUCTION-CANDIDATE` label was **over-stated** —
the real executor had never compiled and no authorized Oracle had ever been used. Release status is now
**INTEGRATION-CANDIDATE**. **218 Oracle checks green across 10 verifiers** (was 120/5); `npm run build`,
`verify:runner` 82/82, `verify:security` 39/39, `verify:secrets` 16/16, `verify:ipc-contract` 4/4 clean.

- **Fail-closed production (Phase 01) — fixed a LIVE mock leak.** `app/main/oracleService.ts` previously
  forced `AWKIT_ORACLE_BRIDGE_MOCK=1` whenever the driver jars were absent, **with no packaged-mode
  guard** — a packaged build with a driverless bundle would have silently served synthetic rows. Now
  `OracleRuntimeResolver` owns the policy (`mockAllowed`/`requireRealDriver`), baking
  `AWKIT_ORACLE_REQUIRE_REAL=1` into packaged launches and the mock only into dev; packaged + missing
  driver ⇒ **feature unavailable** (Snapshot Data Sources still work — they never launch the bridge).
  The Java bridge honors `AWKIT_ORACLE_REQUIRE_REAL` by ignoring any mock flag and selecting the new
  `DriverUnavailableExecutor` (every query → `DRIVER_UNAVAILABLE`) instead of `MockQueryExecutor`; the
  bridge manager independently rejects a non-`real` handshake (`requireRealDriver`). `hello` now reports
  `executionMode`/`ucpVersion`/`javaVersion`.
- **Real UCP executor authored (Phase 03).** `oracle-jdbc-bridge/src/main/java-oracle/.../OracleUcpQueryExecutor.java`
  now exists (it never did — a prior memory claim was false): UCP pool-per-compatibility-key, prepared
  statements, typed binds, query timeout, `Statement.cancel()` via `CancellationToken.onCancel`, result
  metadata + Oracle type conversion (precision-preserving NUMBER, ISO timestamps, capped CLOB), and safe
  ORA→category error mapping that never leaks ORA text/SQL/binds. It compiles only against vendored jars
  (external gate) but `verify:oracle-bridge-real-build` **stub-compiles it against the real JDK
  `java.sql`** on every run, so its JDBC usage stays validated. This caught a real defect: `BridgeException`
  had no `(category, message, retriable)` constructor the executor needed.
- **SQL policy hardened (Phase 04), TS↔Java parity proven.** `WITH FUNCTION`/`WITH PROCEDURE` (inline
  PL/SQL, 12c+) previously **passed** both gates — `WITH` is a legal lead keyword and `FUNCTION`/
  `PROCEDURE` weren't forbidden. Now rejected, along with database links (`@`) and `UTL_`/`DBMS_`/`OWA_`
  package calls (a read-only SELECT can still invoke a stored function → SSRF/file access).
  `verify:oracle-sql-policy` runs one 30-case adversarial corpus through the TS mirror **and** the
  authoritative Java gate (via the real Dispatcher) requiring identical decisions — including
  false-positive guards (an email in a literal is not a dblink).
- **New commands:** `prepare:oracle-runtime` (reproducible, offline, fail-closed bundle staging against a
  locked manifest — verifies sha256/arch/Java-version/licenses, builds the bridge, regenerates
  `checksums.json`; skips cleanly with no staged artifacts), `verify:oracle-{bridge-real-build,
  runtime-prep,sql-policy,live,lazy-resolution,offline-bundle}`. `verify:oracle-live` is credential-gated,
  never falls back to mock, and writes a redacted `reports/oracle-validation/oracle-live.json`.
- **Packaging (Phase 08):** `validate-offline-bundle.ps1` gained an Oracle section (checksums, layout,
  real driver required, no secrets/wallets, size report) backed by the shared `auditOracleOfflineBundle`;
  `electron-builder.json` excludes any `.env`/wallet/key under `oracle-jdbc/`.
- **New docs:** `ORACLE_JDBC_RUNTIME_MATRIX.md` (compatibility/licensing/acquisition),
  `ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md` (least-privilege account — the *primary* read-only boundary),
  `ORACLE_JDBC_VALIDATION_GATES.md` (exact procedure for the external gates).
- **External gates (unchanged, cannot run here):** vendor real `ojdbc`/`ucp` jars + a private JRE
  (build-time network blocked) → real-jar compile; authorized read-only Oracle run (Phase 06, no DB/Docker);
  packaged-EXE clean-machine walkthrough (Phase 09); real perf/soak (Phase 10). Status advances to
  PRODUCTION-CANDIDATE only after Phase 06, and PRODUCTION-READY only after 09+10.

## Oracle JDBC — DS renderer UI, defensive result limits, packaging checksums, final report (Phases 05, 11, 12, 14) (2026-07-17)

Continuation of the same-day increment below. Closes the renderer UI gap, hardens Phase 11's result
limits, adds Phase 12 checksum-validation infrastructure, and writes the Phase 14 final report. Still
database-free / mock-bridge verifiable; live JDBC + real Oracle remain external gates.

- **Phase 05 renderer UI (done, GUI-verified live):** `OracleDataSourceModal.tsx` (create/edit form —
  name/mode/description/connection-profile/SQL/binds/limits) wired into `DataSourceManager.tsx` via an
  "Add Oracle Source" toolbar button + a `oracleModal` state slot. Verified in the real Electron window
  (not just build/bundle-inclusion): modal opens, fields bind correctly, and client-side validation
  blocks `Create` with "Select an Oracle connection profile." when none exists — zero DevTools console
  errors. See [[electron-gui-verify-workflow]] for the DPI-awareness automation fix this uncovered.
- **Phase 11 hardening:** `OracleTypeConversion.enforceResultLimits` previously declared `maxCellBytes`
  in its interface but never checked it, and `OracleQueryService` never passed `maxColumns`/
  `maxSerializedBytes` from any real caller — all three were dead limits. Now `OracleQueryService`
  applies defensive built-in defaults (`DEFAULT_MAX_COLUMNS=200`, `DEFAULT_MAX_CELL_BYTES=1_000_000`,
  `DEFAULT_MAX_SERIALIZED_BYTES=25_000_000`) even when a node/Data Source doesn't set its own, and
  `enforceResultLimits` now actually walks each row's string cells against `maxCellBytes`.
- **Phase 12 packaging:** new `OracleBundleChecksums.validateOracleBundleChecksums` — reads an optional
  `resources/oracle-jdbc/checksums.json` (sha256 per bundle-relative file); absent = nothing to validate
  (lazy availability preserved), present = every file must exist and match or the bundle is rejected.
  Wired into `OracleRuntimeResolver`'s bundled-runtime branch so production **fails closed** on a
  corrupted/tampered/incomplete bundle instead of launching it. The actual jar/JRE vendoring into
  `resources/oracle-jdbc/` and the `electron-builder.json` `extraResources` entry are still not done —
  network is blocked at build time here (external gate); the validation *logic* is complete and tested
  against synthetic fixtures.
- **Phase 14:** migration needs no code — the `jsonArray | oracle` union already treats a missing
  `type` field as `jsonArray`, so pre-Oracle profile JSON on disk loads unchanged. Wrote
  [`ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md`](ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md) (17-section final
  report): ~~PRODUCTION-CANDIDATE~~ — **superseded: corrected to INTEGRATION-CANDIDATE on 2026-07-17**
  (the real executor had never compiled and no authorized Oracle was ever used); exact blockers listed
  (vendor jars/JRE, real-Oracle validation, packaged-EXE rebuild, real-latency performance check).
- **Verification:** `npm run build` clean; new `verify:oracle-packaging` **11/11**; `verify:oracle-runtime`
  **27/27** (+5: result-limit coverage); `verify:oracle-bridge` **32/32**, `verify:oracle-profiles`
  **22/22**, `verify:oracle-data-source` **28/28**, `verify:runner` **82/82** (no regression). 120 total
  Oracle checks green. (Merged to `main` 2026-07-17 via PR #11 — see the top entry.)

## Oracle JDBC — node + Data-Source execution wiring & snapshot capture (Phases 06, 08–10) (2026-07-17)

Builds on the 01–04 + 07 foundation below. The Oracle **node** (Phases 08/09) and its **workflow
execution wiring** (Phase 10) are complete, and Oracle **Data Sources** now execute end-to-end
(runtime + offline snapshot). Still database-free / mock-bridge verifiable; live JDBC + real Oracle
remain external gates.

- **Oracle node (Phases 08/09):** `oracle` `StepType` + `OracleNodeSection` panel (connection source =
  profile | Data Source, SQL, binds, return-type mapping) + `OracleNodeExecution` (bind resolve →
  runner → `OracleResultMapper`). `execution.ipc` sets the main-process node runner
  (`getOracleNodeRunner`) which owns the JDBC bridge via `OracleQueryService`.
- **Data-Source execution wiring (Phase 10, DS-side):** `resolveWorkflowDataSources` now branches on the
  discriminator — jsonArray keeps its eager file/path path; **Oracle sources resolve through
  `DataSourceResolver`** (snapshot = stored rows; runtime = single-flight per-run lazy loader backed by
  `runOracleDataSourceQuery`). A workflow-bound Oracle source is **materialized eagerly** so row-count
  loops (`dataRows`) work; `FlowExecutor`/`StepExecutor` loop consumers use the new
  `materializeDataSourceRows` helper so a lazy runtime source is loaded on demand.
- **DS bind resolution:** new `OracleDataSourceBinds.resolveDataSourceBinds` — Data-Source queries bind
  only resolution-time sources (`static` / `env` / `workflowInput`); per-row / previous-output / flow
  binds are rejected with a clear message (they belong on the node, which runs in step context).
- **Snapshot capture (Phase 06):** `refreshOracleDataSourceSnapshot(id)` executes the query once,
  normalizes to an array of JSON objects, and **atomically persists** it (`store.update` = temp+rename)
  with `queryHash` + `connectionFingerprint` for staleness; on failure it keeps the last good rows
  (offline safety) and records a **secret-safe** `error` summary (category only, never SQL/values).
- **Oracle Data-Source IPC/preload (Phase 05 backend):** `oracle:dataSources:{list,get,save,delete,
  refreshSnapshot}` (mutations sender-guarded) + preload `oracle.{listDataSources,getDataSource,
  saveDataSource,deleteDataSource,refreshSnapshot}`. `saveOracleDataSource` validates read-only SQL up
  front and preserves any existing snapshot across edits. **Renderer DS-management UI is still todo.**
- **Verification (this increment):** `npm run build` clean; `verify:oracle-data-source` **28/28**
  (+8: DS binds + `materializeDataSourceRows`); `verify:runner` **82/82**; `verify:oracle-bridge`
  **32/32**, `verify:oracle-profiles` **22/22**, `verify:oracle-runtime` **22/22**.
- **Remaining:** Phase 05 **renderer** UI (create/edit Oracle Data Sources + snapshot refresh button in
  `DataSourceManager`), 11 (extra hardening), 12 (packaging + checksum validation + `validate:offline`),
  13 (real-Oracle external gate), 14 (final report). (Merged to `main` 2026-07-17 via PR #11.)

## Oracle JDBC Data Source & Node — backend foundation (Phases 01–04 + 07) (2026-07-16)

First tranche of the Oracle JDBC feature (plan: [`ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md`](ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md)).
Adds Oracle database support via a **bundled private Java bridge** (framed JSON-RPC over stdio — no
network port), reusing AWKIT's Data Source, secret, IPC, and packaging systems. **Read-only** initial
release. All work is **offline-verifiable with a database-free mock executor**; the live JDBC path,
vendored ojdbc/ucp jars + private JRE, and real-Oracle validation are **external gates**.

- **Java bridge (`oracle-jdbc-bridge/`):** zero-dependency pure-JDK **core** (JSON codec, 4-byte
  length framing, dispatch + cancellation registry, authoritative read-only SQL policy, database-free
  `MockQueryExecutor`) compiles/runs with a **pinned JDK 17** and no network. `Main` reserves stdout
  for frames and reflectively loads the real Oracle UCP executor when jars are vendored, else falls back
  to the mock (like a dev checkout lacking Chromium). Build: `npm run build:oracle-bridge`.
- **TS bridge client (`src/oracle/`):** `OracleJdbcBridgeManager` (lazy spawn, `hello` handshake +
  protocol-version check, request correlation, per-request timeout, AbortSignal→`cancelQuery`
  propagation, bounded restart after crash, orphan-free `dispose`) + `OracleBridgeProtocol`
  (envelope/framing/error categories). Disposed on app `before-quit`.
- **Connection profiles + secrets (Phase 03):** `OracleConnectionProfile` (JDBC-URL builder,
  credential redaction, pool fingerprint, validation) + pure `OracleProfileService` (CRUD; inline
  passwords routed into the existing **by-name DPAPI `SecretStore`** as `oracle.<id>.password`;
  `testConnection` via bridge; error-category→safe-message). `app/main/oracleService.ts` +
  `ipc/oracle.ipc.ts` (7 sender-guarded channels) + preload `oracle` domain. Renderer only ever gets
  `hasPassword` — never a secret value. New `oracle-profiles` runtime folder.
- **Data Source model + resolver (Phase 04):** `DataSourceProfile` is now a backward-compatible
  `jsonArray | oracle` union (legacy profiles + all existing `dataSource.ipc` behavior unchanged).
  Authoritative pure **`DataSourceResolver`** normalizes every type to one `ResolvedDataSource`
  array-of-objects contract: JSON = unchanged lazy file read; Oracle snapshot = stored offline rows;
  Oracle **runtime = single-flight per-run-cached lazy loader** (failed attempts not cached).
  `ResolvedDataSource` gained optional `loadRows()`/`type`/`oracleMode`; `ValueResolver` honors it.
- **Runtime query service (Phase 07):** `OracleQueryService` is the **single query authority** (SQL
  gate → descriptor/secret resolution → typed binds → bridge `executeQuery` → normalize + defensive
  limits → timeout/cancel/transient-retry/bounded-concurrency/telemetry). Node executors and the
  resolver call this, never the bridge directly. Deterministic bind/type conversion keeps
  high-precision numbers as strings.
- **Verification:** `npm run build` clean (tsc + bundles); `verify:ipc-contract` **4/4** (143 handlers);
  `verify:oracle-bridge` **32/32**, `verify:oracle-profiles` **22/22**, `verify:oracle-data-source`
  **20/20**, `verify:oracle-runtime` **22/22** — all driving the **real Java mock bridge**, no DB.
  Orphan-Java check clean.
- **Remaining (not yet done):** Phase 05 (Data Source UI), 06 (snapshot execution + atomic persist),
  08/09 (Oracle node + result mapping), 10 (wire the resolver/query-service into
  `resolveWorkflowDataSources`), 11 (extra hardening/observability), 12 (packaging + `OracleRuntimeResolver`
  checksum validation + `validate:offline`), 13 (tests + **real-Oracle external gate**), 14 (final
  report). (Merged to `main` 2026-07-17 via PR #11.)

## Splash hold-on-brief + concept-1c icon + simplified sidebar brand (2026-07-16)

- **Splash launch contract (revised):** the splash now always plays exactly ONE round and settles on
  the resolved frame that shows the app brief (`HOLD_T = 11.70s` in `app/renderer/splash.html` — the reel
  no longer loops). Then `app/main/main.ts` reveals the app at `max(one-round, ready-to-show)`:
  if the main window is ready by the time the round finishes it dissolves the splash immediately; if the
  app still needs time, the splash **holds on the brief frame and shows a small bottom-right spinner**
  (`window.__splashHold()`, triggered from main via `executeJavaScript` — the splash stays preload-free)
  until `ready-to-show`. A 30s hard cap prevents any hang. Constants: `ONE_ROUND_MS = 11_800`,
  `HARD_CAP_MS = 30_000`.
- **Application icon → concept "1c" (spectral edge):** `resources/icon-source.png` / `icon.png` / `icon.ico`
  regenerated (via `scripts/generate-app-icon.mjs`) from a near-black continuous-corner squircle with an
  off-white brick-form "S" whose trailing (bottom-left) brick carries a subtle blue→violet→pink spectrum
  gradient. Matches `UI Samples/Application icon design/Spectr Icon.dc.html` id 1c. Transparent corners,
  RGBA, all seven ICO frames valid.
- **Sidebar brand simplified:** `LeftNavigation.tsx` gained an inline `SpecterAppIcon` SVG (the same 1c
  mark, `useId`-namespaced defs) that replaces the old violet `Workflow` glyph in the brand tile, and the
  `Automation workbench` subtitle was removed so the brand shows **just the app icon + "SpecterStudio"**.
  New `.brand-app-icon` rule in `global.css`. The footer workspace chip and the top `AppFrame` wordmark are
  unchanged.
- **Validation:** `npm run build` passed (tsc + bundles; `splash.html` 20.12 kB). Verified by (1) rendering
  the built splash at the brief timestamp with the spinner shown (bundled-Chromium screenshot), (2) viewing
  `resources/icon.png`, and (3) launching the real Electron app and screen-capturing the running window —
  sidebar shows the new mark + "SpecterStudio" only, and the splash handed off cleanly ("Electron shell:
  Online", "IPC bridge: Connected"). **Not run:** packaged EXE rebuild (taskbar icon) / clean-machine
  walkthrough.

## Product rename → SpecterStudio (2026-07-16)

- **What:** the product/application identity was renamed from **WebFlow Studio** to **SpecterStudio**
  everywhere it is the app's own name — window/dialog/HTML titles, renderer UI (app frame, left nav,
  Settings "Application name"), packaging (`electron-builder.json` `productName` + `appId`
  `com.specterstudio.app`), npm `name`/`productName` in `package.json`(+lock), and every user-facing
  message string in `app/**` and `src/**` (IPC guards, `ProtectedLoginDetector`, `StepExecutor`,
  `urlPolicy`, `SessionCaptureService`, `ProjectContract`).
- **Runtime data root:** `RUNTIME_DATA_FOLDER` in `app/main/appPaths.ts` is now `"SpecterStudio"`, so data
  lives under `%LOCALAPPDATA%/SpecterStudio/`. The offline chain was kept consistent: `resources/
  dependency-manifest.json` (`application.name` + all `paths`), `resources/offline-runtime.json`,
  `src/offline/DependencyManifest.ts` validator, and both PS scripts (`generate-dependency-manifest.ps1`,
  `validate-offline-bundle.ps1`) all agree on `SpecterStudio` / `%LOCALAPPDATA%/SpecterStudio`. Seed/verify
  tooling that locates the runtime folder or packaged EXE was updated to match (`seed-mock-fixtures`,
  `seed-observability-fixtures`, `reset-ui-state`, `verify-instance-monitor-gui`, `verify-settings-
  persistence`, `verify-packaged-runtime`, `verify-packaged-walkthrough`, `packaged-process-tree`,
  `benchmark/electron-stub`).
- **Deliberately NOT changed:** the `window.playwrightFlowStudio` preload API identifier (internal
  contract), the `--awkit-*` CSS design tokens, the `AWKIT_*` env-var names / `awkitRssMb` data field
  (functional identifiers — only their user-facing display labels became "SpecterStudio"), the
  `playwright-flow-studio-offline-dependency-manifest` manifest *schema* name, and dated historical records
  (DECISIONS.md rename entry, `OFFLINE_STANDALONE_PACKAGING.md` + phase walkthroughs that reference the
  already-built `WebFlow Studio 0.1.0.exe`/`Setup` artifacts). Live project-identity files were updated
  (`README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/00-project.mdc`,
  `.cursor/rules/30-storage-ipc.mdc`, `ci.yml` comment).
- **Migration note:** existing installs keep data under the old `%LOCALAPPDATA%/WebFlow Studio/` folder; the
  renamed build reads/writes the new `SpecterStudio` folder and will not auto-migrate prior data.
- **Validation:** `npm run build` passed (tsc + bundles); `npm run validate:offline` passed (development
  mode, no failures) with the manifest name/path checks satisfied. **Not run:** packaged EXE/NSIS rebuild
  (artifacts would gain the new name) and clean-machine GUI walkthrough.

## Specter Studio launch splash screen (2026-07-16)

- **What:** an offline, frameless launch splash that recreates the reference "flexible logo" motion reel
  (`UI Samples/SplashScreen.mp4`) rebranded to **Specter Studio**. New file `app/renderer/splash.html` —
  fully self-contained (inline CSS+JS, canvas-rendered, CSP `default-src 'none'`, no remote assets/fonts).
- **Animation:** a single parametric layout (two display words, two modular grids, counter, tagline, body
  paragraph, credits) driven through scene keyframes on a **13.716667s loop** matching the source's beats:
  wide 10×3 Format A → collapse to a minimal 2×2 grid (~3s) → **isolated 2×2 pivots 90° clockwise through
  the 45° diamond and settles upright while type fades (~3–4.3s)** → portrait column (~5.4s) → wide
  snap-back 8×3 (~7.3s) → resolved layout with body copy fading in (~8.4–9s) → **dead-still hold ~9.8–11.7s**
  → loop wind-up → seamless return to Format A. Grid `cols/rows` interpolate via a rounded lerp to reproduce
  the responsive cell-count reflow; `pivotRotation(t)` handles the diamond spin; each word's baseline sits
  just above its grid. `window.__renderAt(t)` exposes deterministic rendering for frame extraction/compare.
- **Look:** strict high-contrast monochrome — crisp white grid + near-white uppercase wordmark
  (**SPECTER / STUDIO**) on the Hologram near-black `#0e1016`, with a **whisper** of project violet
  (subtle top-left `rgba(124,58,237,0.08)` radial glow + violet `1.0.7` counter).
  Copy, credits (Year 2026 / Mohammad Abwini / Arab Bank — Limited / Version 1.0.7), and the
  `VISUAL AUTOMATION PLATFORM` tagline are the user-supplied Specter Studio text.
- **Integration:** `windowManager.ts` adds `createSplashWindow()` (760×570, frameless, alwaysOnTop, no
  preload/node, `backgroundColor #0e1016`) and `fadeOutAndClose()`; `createMainWindow()` gained a
  `{ show }` option. `main.ts` shows the splash, boots the main window hidden, and on `ready-to-show`
  (min 2.4s display, 8s hard fallback) shows the main window and dissolves the splash. `splash.html` is a
  second renderer input in `electron.vite.config.ts` → builds to `out/renderer/splash.html`.
- **Validation:** `npm run build` passed (tsc + bundles; splash emitted at 17.36 kB, self-contained
  verified — no external `src`/`href`). Recreation validated by extracting the source clip's real frames
  (Playwright + bundled Chromium, `requestVideoFrameCallback`) and comparing side-by-side at matched
  timestamps. **Not run:** live packaged-EXE GUI launch walkthrough (no clean-machine run here).

## AWKIT application icon refresh — Specter segmented S (2026-07-16)

- **Design:** new transparent application icon under `logos/specter-violet/`; the selected Specter mark is
  a bold five-segment geometric S inside a restrained lavender ring. The front-facing 318/512px
  (**62.109%**) squircle uses the Hologram palette (`#0e1016`, `#7c3aed`, `#8b5cf6`, `#a78bfa`,
  `#f3f1f8`, `#f3f0ff`) with top-left glass sheen, internal violet bloom, dark corner depth, and no
  visible text or unrelated hues.
- **Production assets:** `resources/icon-source.png` is the square 1024px alpha source;
  `resources/icon.png` is the generated 1024px master; `resources/icon.ico` contains 32-bit-alpha frames
  at **256/128/64/48/32/24/16px**. Editable SVG, 16–2048px PNG exports, three concept directions,
  light/dark embedded-ICO size evidence, and a preview page live in `logos/specter-violet/`.
- **Exporter hardening:** `scripts/generate-app-icon.mjs` no longer uses `png-to-ico` 2.1.0. That packer
  excluded its AND-mask bytes from ICO entry lengths/offsets, allowing later directory entries to point
  into prior frame data. The script now writes standards-compliant PNG-compressed ICO entries directly
  and validates every frame's offset, dimensions, 32-bit declaration, RGBA color type, and PNG signature
  before writing.
- **Validation:** `npm run icon:generate` passed; all seven embedded ICO frames independently decode with
  RGBA alpha and transparent corners; SVG/XML and no-visible-text checks passed; true-size visual checks
  passed at 16–256px on light and dark backgrounds; `npm run build` passed;
  `npm run validate:offline` passed (development mode).

## Runtime Observability & Historical Analytics — full phase set (2026-07-16)

Extends the EXISTING durable telemetry stack (one SQLite store, one contract, one IPC surface) with a
complete observability/analytics layer — **no second database**. Report:
[`RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md`](RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md) (16 sections).

- **Data model (migration v4 `observability-analytics`, additive/nullable):** per-run dimensions
  (`headed`/`resourceProfile`/`isolationClass`/`workloadWeight`/`pressureStateAtRun`) + per-run
  ENVIRONMENTAL observation summary (`obs*` CPU/mem/Chromium-RSS/AWKIT-RSS mean/P95 over the run window —
  correlation, NOT per-workflow ownership under a shared pool); new bounded tables `runtime_capacity_buckets`,
  `runtime_admission_buckets`, `runtime_browser_lifecycle_buckets`, `runtime_anomalies`. v1/v2/v3 upgrade in
  place; pre-v4 rows read NULL.
- **Collection (reuses the existing ProcessTreeSampler tick — no new loop):** pure
  `RuntimeObservationCollector` accumulates per-run summaries + 30s capacity buckets
  (`AWKIT_OBSERVABILITY_BUCKET_MS`); normalized admission-delay reasons recorded from the REAL dispatch loop
  (`AdmissionReason` enum, single free-text→enum mapping); browser close-reason deltas. All best-effort —
  never fails a run. Node heap added to the sample.
- **Read models (store-side, windowed):** per-workflow historical stats + trend (hour/day/week auto) +
  run-vs-history + rankings (`observabilityAggregation.ts`); capacity/queue effectiveness
  (adaptive-target & capacity utilization, admission-reason breakdown, failure-at-pressure, pool
  effectiveness) — explainable, no opaque score.
- **Anomaly/regression (deterministic, no AI — `AnomalyDetector.ts`):** run-level vs 30-day history (min 8
  runs) + regression recent-7d-vs-prev-7d (min 10/window) with configurable thresholds, info/warning/critical,
  dedup/cooldown/recovery. Fired after each run finalizes + throttled regression per workflow.
- **UI (existing Runtime Analytics page, no redesign):** live Current-runtime strip + Capacity & queue
  effectiveness panel + Anomalies panel (token-only). 7 additive `telemetry:*` IPC channels + preload.
- **Retention (per-table):** raw samples 24h; observability buckets 14d; anomalies 90d (all env-tunable).
- **Verification:** `npm run build` clean; new **`verify:observability` 65/65**; `verify:telemetry` **61/61**
  (strengthened to assert v4 in-place upgrade); regression `verify:runner` 82/82, `verify:concurrency` 78/78,
  `verify:concurrency-defaults` 18/18, `verify:shared-browser-pool` 19/19, `verify:browser-isolation` 27/27;
  bounded Config-D real-engine soak (1.5 min) 299 completed / 0 failed / teardown CLEAN / durable=live MATCH.
- **Final production-validation (2026-07-16) — decision `PRODUCTION-CANDIDATE`** (report §17): controlled A/B
  overhead (`benchmark:observability-ab`, 3A+3B) → per-tick negligible (event-loop P95 +0.5 ms), throughput
  ~1.5–2.5 %, RSS unresolvable vs drift; **full 30-min soak** (`AWKIT_SOAK_MS=1800000`) 4661 completed / 0
  failed / teardown CLEAN / 4666 run-summaries==4666 terminal / leak-free (`soak-30min.json`); **storage/query**
  (`benchmark:observability-storage`, 5k/25k/50k) ~465 B/run, ~3.1 MB/day uncapped (retention-bounded), analytics
  queries tens-to-~500 ms (NOT sub-ms), retention boundaries validated; **UI walkthrough**
  `verify:runtime-analytics-gui` **36/36** across normal/empty/migration/high-data (real `out/` Electron, 7 IPC
  channels + malformed inputs, screenshots). Corrected the report's overhead/query/storage/"Experimental: none"
  claims. Fixed 2 soak-harness accounting bugs (cancelled-run count; NaN event-loop peak). **Remaining gate:**
  fresh packaged-EXE build + walkthrough on a higher-memory host (dist/ EXE is pre-observability; re-package OOMs).

## Concurrency closing task — enforced pool→A8 dependency + proven durable root cause (2026-07-15)

Closes the three remaining concurrency validation gaps. Report: [`EXECUTION_ENGINE_CAPACITY_REPORT.md`](EXECUTION_ENGINE_CAPACITY_REPORT.md)
§13–§20. Changes are **not committed** (GitHub intentionally untouched).

- **Shared-Pool → A8 dependency now ENFORCED (`ConcurrencyConfig.ts`):** this was a genuine gap — an explicit
  `AWKIT_WORKLOAD_WEIGHTS=true` could still recreate the harmful Config C while the pool was OFF. New
  `resolveWeightedAdmission` forces weights OFF whenever the pool is OFF (even when explicitly requested) and
  emits one searchable diagnostic (`AWKIT_WORKLOAD_WEIGHTS=true ignored because Shared Browser Pool is
  disabled…`). `weights=false` while the pool is ON is still honoured. Enforced on the final merged values —
  the single place the app resolves pool/weights. `verify:concurrency-defaults` **18/18** (was 12/12).
- **Durable `~3822 vs 495` root cause PROVEN (not "likely"):** `SqliteRuntimeStore.queryRunHistory` hard-clamps
  a page to `Math.min(500, …)`; the soak counted `rows` of one `{ limit: 200000 }` page (≤500) against a live
  in-memory counter (~3822). NOT lost/unflushed/pruned/overwritten writes (in-memory sql.js is synchronous; a
  reopened on-disk store returns every row; retention 5000 never triggered; `instanceId` is the PRIMARY KEY).
- **Read-model hardened:** added `countRunsByStatus` (unbounded `GROUP BY status` aggregate) + keyed `getRun`
  to the store; `queryOverview` counts now use the aggregate (was a ≤5000 materialized read — latent under-count
  once >5000 runs land in a window); `getTelemetryRunDetail` uses `getRun`; new `getTelemetryStatusCounts` +
  `persistDurableNow`; benchmark harness/soak paginate via `readAllRunHistory` (live-vs-durable reconciliation
  logged). No UI redesign.
- **Durable accuracy verifier (`verify:durable-accuracy`, N=600):** real engine, 600 OK + 40 fail + 40 cancelled,
  explicit drain. **27/27** — submitted 680 = 600+40+40; expected persisted 648 = actual 648; clamp reproduced
  (500 < 648); no dup/missing IDs; disk-reopen sees all; retention deterministic. Artifact
  `reports/browser-performance/durable-accuracy.json`.
- **Verification:** build ✅; `verify:concurrency-defaults` 18/18, `verify:telemetry` 61/61 (new Part I),
  `verify:durable-accuracy` 27/27, `verify:concurrency` 78/78, `verify:runner` 82/82,
  `verify:shared-browser-pool` 19/19, `verify:browser-isolation` 27/27.

## Shared pool + A8 ON by default, reserve-formula change, close-reason telemetry, 30-min soak (2026-07-15)

Follow-up to the capacity benchmark below — applies the measured recommendation and resolves four completion
items. Report: [`EXECUTION_ENGINE_CAPACITY_REPORT.md`](EXECUTION_ENGINE_CAPACITY_REPORT.md).

- **Production defaults flipped (`ConcurrencyConfig.ts`):** `useSharedBrowserPool` now defaults **ON**;
  `workloadWeights` defaults to the **resolved pool state** (ON with the pool, never independently — Config C
  is harmful). Explicit `AWKIT_SHARED_BROWSER_POOL` / `AWKIT_WORKLOAD_WEIGHTS` env always win. Proven by
  `verify:concurrency-defaults` (12/12).
- **CapacityPlanner memory reserve changed (Model C):** a replay across 4–128 GB × low/med/high pressure
  (`benchmark:capacity-reserve`) showed the old formula double-counted the OS (%-of-total subtracted from
  already-current available) → a 128 GB host with 23 GB free got usable=0 / capacity 1. Now the OS reserve is
  a **ceiling** (`min(available, total−OS%)`), plus an absolute 1024 MB app baseline + a bounded machine-
  relative growth reserve + a safety cushion off available. Small/pressured machines unchanged (still floor to
  1). `verify:capacity-planner` 35/35 (added anti-pathology + `usable ≤ available` checks).
- **Browser close-reason telemetry (`SharedBrowserPool`):** every retirement is now attributed to an exact
  reason (`CONTEXT_COUNT_RECYCLE | MEMORY_THRESHOLD | IDLE_DRAIN | UNHEALTHY | CRASH | POOL_SHUTDOWN |
  LAUNCH_FAILURE | OTHER`), exposed on the snapshot as `closeReasons` + `launchFailures`. Resolves the report
  contradiction: soak relaunches are routine `CONTEXT_COUNT_RECYCLE` + `IDLE_DRAIN`, `MEMORY_THRESHOLD`=0
  (memory recycling stays inert — no PID on Playwright 1.61).
- **30-min soak (Config D, MIXED, conc 6):** ≈3822 completed (~127/min), 0 failed / 0 retries / 0 crashes;
  JS heap flat (172→170 MB), handles flat, browsers/contexts bounded (≤4/≤5); AWKIT RSS mild +55 MB native
  drift (bounded); 80 relaunched = 80 closed, all `CONTEXT_COUNT_RECYCLE`(77)+`IDLE_DRAIN`(3),
  `MEMORY_THRESHOLD`=0; teardown **CLEAN** (active/leased/stale/orphan-contexts/orphan-pages/orphan-Chromium
  all 0). Leak-free by the load-bearing signals (report §9).
- **Headed Production Anchor (Phase 01, `benchmark:engine-headed`):** headed Config A vs D at F=6, 50 s each,
  real ExecutionEngine. D beats A by **+122 % throughput** (116.6 vs 52.5/min), **−63.5 % P95 duration**
  (2394 vs 6554 ms), **−16 % CPU P95** (83.8 vs 99.7 — A pins the CPU with 6 dedicated headed browsers), and
  **−52 % RSS peak** (1065 vs 2215 MB); median Chromium RSS +4.9 % (a wash). 0 failures/crashes, teardown
  clean both. **Confirms the pool + A8 defaults — the win is larger headed than headless.**
- **Verification:** `npm run build` clean; concurrency-defaults 12/12, capacity-planner 35/35, capacity-modes
  10/10, machine-capabilities 20/20, benchmark-planner 36/36, shared-browser-pool 19/19, browser-isolation
  27/27, runner 82/82, concurrency 78/78, shared-browser-live 5/5.

## Real-ExecutionEngine capacity benchmark + shared-pool race fix + Phase 6–10 (2026-07-15)

Drove real workflow instances through the full `ExecutionEngine.startRun` dispatch path (queue → adaptive →
backpressure → weighted admission → limiters → worker pool → isolation resolver → `BrowserContextFactory` →
`SharedBrowserPool` → `PlaywrightRunner`) under sustained concurrent load — the first benchmark that exercises
the **complete production scheduler**, not just the context factory. Full write-up:
[`docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md`](EXECUTION_ENGINE_CAPACITY_REPORT.md).

- **Real defect found + fixed (SharedBrowserPool):** a check-then-act race in `selectOrLaunch` (read count →
  `await launch()` → register) over-launched browsers under concurrent dispatch (`maxBrowsers=2, conc=6` → 6
  browsers). Fixed by reserving the browser+context slot **atomically under the pool mutex**, creating the
  context outside the lock, rolling back on failure. Peak browsers 6 → 2; guarded by a new regression test.
  The prior context-factory benchmark created contexts serially and never hit it — only the real engine did.
- **A/B/C/D result (MIXED, 45 s holds):** at equal load (F=6) Config D (pool ON + A8 weights ON) vs baseline A:
  Chromium procs −50 % (10 vs 20), RSS −56 % (727 vs 1656 MB), throughput +12.7 %, P95 duration −34 %; and
  **stable concurrency +50 %** (D=9 vs A=6, 0 failures through F=9). Weighting-ALONE (C) is a net negative
  (stable drops to 3) — it only pays off *with* the pool.
- **Phase 6 weight calibration:** the WAITING workflow runs 5.3× longer than LIGHT but uses ~0 CPU and less
  RAM → the feature-based (duration-agnostic) weight correctly does not over-charge it. Weight seeds kept
  unchanged (validated, not inaccurate); phase-aware weighting deliberately NOT added (no measured value).
- **Phase 7 CapacityPlanner:** the fixed 1024 MB AWKIT reserve is correct precisely because it's absolute (app
  footprint is machine-independent) and already complemented by 20 % OS + 10 % safety percentage reserves that
  scale with the machine. Formula reviewed, documented, unchanged.
- **Phase 8 browser memory recycling:** fully wired (`SharedBrowserPool.applyMemorySamples` moving-window
  drain + `BrowserProcessSampler` Windows subtree walk + throttled engine evaluator) but **inert on this
  stack** — Playwright 1.61's launched `Browser` exposes no `process()`, so no per-browser root PID → empty
  samples → no-op. Kept wired + documented per the task's "disable-with-evidence" instruction; lights up
  unchanged if a PID-bearing launch path appears. Default path unaffected.
- **Phase 9 soak (Config D, MIXED, 10 min local):** 497 completed / 0 failed / 0 retries; Chromium RSS
  1082→558 MB (−48 %), AWKIT RSS 232→228 MB (flat), heap 125→137 MB; shared browsers steady at 3–4;
  teardown **CLEAN** (active=0, leased=0, stale=0, orphan contexts/pages=0). Leak-free under real sustained load.
- **Recommendation (Phase 10):** enable BOTH the shared pool and A8 weighted admission by default (Config D);
  never weighting-only. Shipped default flags left unchanged pending owner sign-off (one-line follow-up).
- **Verification:** `npm run build` clean; `verify:shared-browser-pool` 19/19 (new race regression),
  `verify:browser-isolation` 27/27, `verify:runner` 82/82, `verify:concurrency` 78/78.

## Shared-browser capacity — authoritative isolation resolver + launch-arg-aware compatibility key (2026-07-15)

Hardens the A5 shared Chromium pool so it can be enabled safely for higher concurrency. **No default-path
behaviour change** (shared pool stays flag-OFF; `balanced` profile → one stable compatibility key → sharing
is byte-for-byte as before). Proven from code + runtime before touching anything; A5 reused, not rewritten.

- **Traced + confirmed A5:** `execution.ipc → ExecutionEngine.processQueue (500 ms dispatch tick) →
  AdaptiveController (A7, hysteresis) + BackpressureController + [A8 weighted] admission → isSharedEligible?
  `acquireContextSlot` (virtual, bounded by `maxActiveFlows`) : `tryAcquireSlot` (real browser semaphore) →
  PlaywrightRunner → BrowserContextFactory.create`. A5 leases a **fresh isolated `BrowserContext` per
  instance** on a shared `Browser`, spreads across browsers before packing (crash isolation), drops crashed
  browsers on `disconnected`, recycles after N contexts (drain→close), `drainIdle` at run end. Dynamic
  machine-aware admission (A7), workload cost (A8), and the machine-aware memory reserve (A2 `CapacityPlanner`)
  already exist — the task's Phases 7–13 were largely present.
- **Gap fixed (latent correctness):** the shared launch key was only `browser:headed/headless`, ignoring the
  per-instance resolved `launchArgOverrides`. With the pool ON **and** a non-`balanced` profile, instances
  with divergent launch flags (gpu/webgl/cache / throttle drops) could reuse one browser carrying only the
  first leaser's flags. Now closed.
- **New (`src/runner/browser/BrowserIsolationResolver.ts`):** THE authoritative resolver — classifies every
  instance into `SHARED_CONTEXT | DEDICATED_BROWSER | PERSISTENT_BROWSER | HANDOFF_BROWSER` with a
  `{decision,value,source}` diagnostic per rule (precedence: persistent profile > mid-run browser swap >
  shared-flag > catch-all dedicated), plus `sharedCompatibilityKey(config, launchArgOverrides)` folding the
  **browser-level** launch config (headed/headless + resolved launch-arg deltas) into the key. Context-level
  options (viewport, device scale, storageState, request routing) stay isolated per `BrowserContext` and are
  deliberately excluded. Delimited + collision-safe, no hash dependency; pure/framework-agnostic.
- **Wiring:** `browserSharing.isSharedEligible` delegates to the resolver (single source of truth — the
  dispatch loop and the factory can't drift); `BrowserContextFactory` shared launcher keys on
  `sharedCompatibilityKey(config, launchArgOverrides)` so incompatible launch configs get their own process;
  `ExecutionEngine.runInstanceInner` logs the isolation class + diagnostics **only when the shared pool is
  enabled** (silent on the default path). `sharedLaunchKey` kept as a legacy human-readable diagnostic.
- **Verified (no regression):** `npm run build` clean; new `verify:browser-isolation` **27/27** (four-class
  classification, precedence, shareability, `isSharedEligible` parity, key folds launch args but NOT
  context-level diffs, pool honours the key); `verify:shared-browser-pool` **18/18**,
  `verify:shared-browser-live` **5/5** (real Chromium — 4 contexts on 2 processes preserved), `verify:runner`
  **82/82**, `verify:concurrency` **78/78**, `verify:workload-weights` **53/53**, `verify:resource-routing`
  **42/42**, `verify:chromium-hardening` **13/13**, `verify:browser-resource-profile` **51/51**,
  `verify:adaptive-concurrency` **14/14**, `verify:operation-limiters` **10/10**, `verify:telemetry` **54/54**.
- **Measured (new `benchmark:shared-pool`, drives the REAL factory + pool, headless, i7/12c/16GB):** Model A
  browser-per-workflow vs Model B shared browser + one isolated context each, subtree process/RSS medians,
  per-context cookie isolation held in every cell. Sharing kicks in above `maxBrowsers` (spread-first keeps
  ≤ N dedicated at low N): **N=4 → −37.5% processes / −27% RSS** (16→10 procs, 906→661 MB); **N=8 → −56%
  processes / −39% RSS** (32→14 procs, 1807→1108 MB). The saving is **RAM + process count**, not CPU
  (per-page render CPU is unchanged by process sharing) — so the pool raises the *memory-bound* ceiling.
- **Baseline `benchmark:concurrency` (this machine, competing load, one-browser-per-instance — flag inert
  here):** highest sustainable **7**, production-approved **5**, stop at 8 on **P95 CPU 96.5% > 95%** (i.e.
  this machine is CPU-bound, so the pool's RAM saving wouldn't lift *this* stop; it lifts RAM-bound hosts).
- **Not done / external gate:** the shared pool remains **default OFF** (owner decision D4). A full flag-ON
  run *through `ExecutionEngine` dispatch* under sustained load on a clean machine + the default flip are the
  remaining gate; the factory+pool lease itself is now measured. Reuse Session / Auto Secure Login / Manual
  Handoff / persistent-profile / popup / parallel-isolated-page behaviour is unchanged.

## Browser Resource Optimization — deep benchmark evidence + throttling removed (2026-07-15)

Follow-up to the profile/resolver work below: 20/20/15-rep experiments replaced the initial 3-rep run and
**corrected the headline**. Harness: `scripts/benchmark/lib.mts` + `benchmark-workloads.mts` /
`benchmark-ablation.mts` / `benchmark-occlusion.mts` (full mean/median/p95/max/stddev; server-side network;
Win32 subtree CPU/RAM). Details + tables in `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md` §7.

- **Occlusion (20 reps, genuinely minimized headed window + background tab):** re-enabling the 3 Playwright
  background-throttle switches (individually + combined, via selective `ignoreDefaultArgs`) gives **no CPU
  reduction** — minimizing already floors CPU at ~1.5% (compositor stops frames, rAF 60→1/s) and page timers
  never throttle because Playwright keeps automated pages `visibilityState:visible`. Behaviour 100%
  (waitForResponse/popup/click/timers). **→ Removed background throttling from the low-resource default**
  (`BrowserResourceProfile.ts` low-resource `backgroundThrottling.enabled=false`); mechanism kept for
  `custom`. Verifier updated (now asserts low-resource does NOT re-enable throttling + a Custom-throttling
  mechanism test) → `verify:browser-resource-profile` **51/51**.
- **Ablation (20 reps, image-heavy):** the profile's RAM/network win is **almost entirely image blocking**
  (−5.98% RAM, −98.95% network); fonts add ~0.7%; media/analytics/reduced-motion/SW/device-scale/throttling
  are within noise. COMBINED low-resource ≈ image-blocking alone.
- **Workload matrix (15 reps, Balanced vs Low-Resource, 8 workloads):** RAM saving is **workload-dependent**
  — image-heavy pages −7…13% (multitab −12.7%, image-heavy −7.3%, spa −4.7%), image-light ~0% (form/table).
  Network −~99% wherever sub-resources exist. **Duration unchanged; behaviour 100%** (download/popup/multitab/
  form all pass under Low-Resource — capability overrides validated live).
- **Correction:** the earlier **21% RAM was 3-rep noise**; stable figure is ~6% (image-heavy) and workload-
  dependent. The big reliable win is **network (~99%)**, not RAM/CPU.
- **Recommendation:** keep `balanced` default; use `low-resource` for unattended/image-heavy runs (safe,
  capability-guarded). Multi-instance RAM estimate ~24–45 MB/instance on image-heavy (LABELLED estimate —
  not multi-instance-benchmarked). Full 11-point recommendation in the doc §9.
- **Verified (no regression):** build clean; `verify:browser-resource-profile` 51/51, `verify:runner` 82/82,
  `verify:chromium-hardening` 13/13, `verify:lean-mode` 12/12, `verify:resource-routing` 42/42,
  `verify:concurrency` 78/78, `verify:workload-weights` 53/53, `verify:telemetry` 54/54. Artifacts in
  `reports/browser-performance/` (workloads.json, ablation.json, occlusion.json + logs).

## Browser Resource Optimization — per-instance Chromium profiles + authoritative resolver (2026-07-15)

Reduces the CPU/RAM/network/disk cost of ONE running Chromium automation instance while preserving
workflow behaviour. **Default is `balanced` == today's exact behaviour** (proven byte-for-byte); every
optimization is additive, env-gated, and relaxed by workflow capabilities so it can't break a run. See
`docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md` for the full lifecycle trace, launch audit, and benchmark.

- **New pure core (`src/runner/browserProfile/`):** `BrowserResourceProfile.ts` (declarative profile +
  4 presets: maximum-compatibility / balanced / low-resource / custom; maps blocking onto the existing
  `ResourceProfile` — no duplication), `WorkflowCapabilities.ts` (static analysis reusing
  `WorkloadWeights.extractWorkloadFeatures` — needsImages/downloads/serviceWorkers/multiplePages/…; hint
  escape hatches; capabilities only ever RELAX), `BrowserRuntimeConfigurationResolver.ts` (THE authoritative
  resolver — deterministic, records a `{setting,value,source}` diagnostic per decision, `explainResolution`),
  `resolveForRun.ts` (env entry, default balanced).
- **Wiring (default-preserving):** `BrowserContextFactory` gained `launchArgOverrides` (extra switches +
  selective `ignoreDefaultArgs`, NEVER `true`); `ChromiumHardening.buildChromiumHardeningArgs` gained
  `omitBackgroundTimerThrottlePin` so low-resource can RE-ENABLE Chromium background throttling (drops the
  pin + Playwright's 3 throttle switches); `PlaywrightRunner` threads `traceMode`/`resourceRouting`;
  `ExecutionEngine.runInstance` resolves once per instance (machine-aware) and logs non-default resolutions.
- **low-resource profile:** lean routing (image/media/font) + analytics-host URL blocking + block service
  workers + reduced motion + device-scale 1 + background throttling ON + production artifacts (trace off) +
  bounded 64 MB disk cache + page cleanup. Selected via `AWKIT_BROWSER_RESOURCE_PROFILE` (default balanced).
- **Measurement fix:** `ProcessTreeSampler` now also counts `chrome-headless-shell.exe` (Playwright's
  headless binary) — the Chrome Consumption dashboard previously undercounted headless instances.
- **Benchmark (`npm run benchmark:browser-resource`, `scripts/benchmark-browser-resource.mts`):** one
  instance, resolver-derived options, blank→navigate→idle→form, server-side network bytes + Chromium-subtree
  RAM/CPU, 3 reps. On i7-8750H/12c/16GB, low-resource vs balanced: **network −100% bytes / −96.8% req**;
  RAM **−8% avg headless**, **−21% avg headed** (headed holds decoded image bitmaps in the compositor — and
  headed is AWKIT's default run mode); navigate CPU −20.6% headless. CPU is a wash overall (rAF canvas +
  compositor dominate; a single foreground window/page is never background-throttled). Artifacts in
  `reports/browser-performance/` (+ `*.headed.json`).
- **Verified:** `npm run build` clean; new `verify:browser-resource-profile` **49/49** (balanced==today
  invariant, capability relaxations, throttle-pin toggle, mode parsing); regression `verify:runner` **82/82**,
  `verify:chromium-hardening` **13/13**, `verify:lean-mode` **12/12**, `verify:resource-routing` **42/42**,
  `verify:concurrency` **78/78**, `verify:workload-weights` **53/53**, `verify:telemetry` **54/54**.
- **Not done / follow-ups:** headed/occluded throttling win not yet measured (display-dependent);
  GPU/WebGL/renderer-limit stay Custom-only pending clean-machine benchmark; Settings UI + per-workflow
  `WorkflowProfile` capability hints (env hints exist today); adopting low-resource as default is an owner
  decision needing the headed benchmark.

## Workflows library + Workflow Builder header/toolbar cleanup (2026-07-14)

- **Create Workflow now names-then-opens (points 6/7).** Both the Workflows library **Create Workflow**
  buttons and the Workflow Builder toolbar **New** (`#sb-new`) open the shared `PromptDialog` for a name,
  then persist a Start→End workflow via the new `createBlankWorkflowProfile(name)` factory
  (`src/profiles/WorkflowProfile.ts`) and open it in the builder (library navigates with
  `selectedBuilderWorkflowId`; the builder loads it in place via `createNamedWorkflow`). One source of truth
  for the blank scaffold shared by both entry points.
- **Workflow Builder header** (`ScenarioBuilder.tsx` `usePageChrome`) now exposes **only Save** — New and
  Run removed; the dead `runWorkflow` handler was deleted. The toolbar **Reload** button, **Mode** select,
  and **Parallel** input are `disabled` (kept visible for context).
- **Workflows table** (`WorkflowsLibrary.tsx`) is one line per row: the **Max Parallel** column
  (header/body/colgroup + adapter accessor + its two advanced-filter fields) and the grey `<small>{id}</small>`
  sub-line are gone; every cell clips to one line with the full value in a `title` tooltip
  (`.wl-table-workflows` token CSS). Per-row action buttons collapsed into a single `.wl-kebab`
  (`MoreVertical`) that opens the existing `NodeOptionsMenu` — Open in Builder / Clone / Export JSON /
  Delete (danger). Delete now confirms through `ConfirmDialog` instead of the old inline Confirm/Cancel.
- **Verification:** `npm run build` clean (tsc + 3 bundles); `verify:workflow-builder` **20/20** (section 3
  updated to drive the New name modal); throwaway `_electron` Workflows-library walkthrough **7/7** (no Max
  Parallel header, no id sub-line, single kebab per row → 4-action menu, Create opens the modal, no console
  errors). `verify:workflow-builder` now leaves one blank "GUI New …" workflow per run (New persists by
  design).

## New Flow now names-then-opens in the Flow Designer (2026-07-14)

- **Change:** the **New Flow** action on the Flows page (`FlowLibrary.tsx`) no longer silently creates a
  flow literally named "New Flow" and leaves the user on the library. All three triggers (page-chrome
  action, toolbar button, empty-state button) now open a name-input dialog first.
- **Dialog:** new reusable `app/renderer/components/shared/PromptDialog.tsx` — single-field, app-styled
  modal reusing the `.modal-overlay`/`.modal-dialog` shell. Autofocuses + selects the field, Enter
  confirms, Escape/overlay cancels, and the Create button stays disabled until the name has
  non-whitespace content. Token-only CSS added (`.modal-icon.create`, `.modal-field`) — no hardcoded
  hex/px.
- **After confirm:** `createFlow(name)` creates the flow with the entered name and the unchanged
  Start→End scaffold (only a `start` and `end` node + one `always` edge), then reuses `openFlow(profile)`
  to persist `lastSelectedFlowId` and navigate to `flowChart`, so the flow opens immediately in the
  Flow Designer.
- **Verification:** `npm run build` clean (tsc + 3 bundles). Live GUI walkthrough not run (the Electron
  renderer can't be driven from the Browser pane; `window.playwrightFlowStudio` IPC is absent there).

## Security-audit hardening — all findings fixed (2026-07-14)

Full security audit (`docs/security/FULL_SECURITY_AUDIT.md`) plus remediation of every finding. **No
runtime contract/route/schema change; behavior tightened at existing sinks.** New helpers:
`src/runner/urlPolicy.ts` (navigation allowlist), `src/utils/pathSafety.ts` (`isPathInside`),
`app/main/ipc/senderGuard.ts` (`assertTrustedSender`), `src/profiles/FlowValidation.ts`
(`normalizeFlowBounds`).

- **Navigation (F-02):** `page.goto`/`routeChange` now go through `assertNavigableUrl` — `file:`/`chrome*`/
  `devtools:`/`javascript:` blocked; http(s)/about/data allowed (internal/localhost still allowed).
- **Upload (F-01):** `StepExecutor.assertUploadAllowed` blocks `setInputFiles` into AWKIT sessions/logs/
  reports/screenshots/traces (+ traversal); general user files still uploadable.
- **Workflow bounds (F-03):** `normalizeFlowBounds` clamps timeouts/retries/loop iterations + caps
  alternatives/waits arrays at `FlowExecutor.executeFlow` (lenient — legacy flows still load).
- **Filesystem (F-04/F-05):** data-source writes confined to the workspace; `saveSession` folder confined
  to the sessions root; `system:openPath` confined to app data folders + executable-extension block.
- **Electron (F-06/F-09):** `will-navigate`/`will-redirect` lockdown; `assertTrustedSender` on
  `execution:runWorkflow`, `dataSources:writeJson/createFromScratch`, `session:startCapture`,
  `system:openPath`.
- **Recorder (F-07):** value redaction extended to OTP/one-time-code/card/CVV/PIN/SSN/token fields.
- **Downloads (F-08) / session capture (F-11):** site-suggested filenames sanitized; capture rejects
  non-http(s) targets.
- **Secret store (§15):** DPAPI-backed encrypted local secret store (`src/secrets/SecretStore.ts` +
  `app/main/secretStore.ts` via Electron `safeStorage`; `secrets.ipc.ts` manages by NAME only — no channel
  returns a value). Steps reference secrets by name (`valueSource.type = "secret"`); the runner resolves them
  per-run in the main process (`ExecutionEngine.setSecretResolver` → `InstanceExecutionContext.secrets`) and
  masks the literals in logs/reports. Managed from **Settings → Secrets** (add/update/delete, keystore-
  unavailable banner). Keeps credentials out of workflow JSON and `.env`.
- **Data-source read (§14):** every JSON data-source read goes through `readJsonFileGuarded`
  (`dataSource.ipc.ts`) — a 25 MB size cap + `isReadableDataSourceFile` (`src/utils/pathSafety.ts`) that
  refuses runtime-internal files (sessions/profiles/secret store/logs/reports) while allowing external user
  files and the workspace.
- **Verified:** `npm run build` clean; `verify:security` **39/39** (incl. data-source read confinement),
  `verify:secrets` **16/16**; regression `verify:runner` **82/82**, `verify:recorder` **72/72**,
  `verify:ipc-contract` **4/4** (129 handlers), `verify:data-editor` **27/27**, `verify:waits` **21/21**,
  `verify:protected-login` **16/16** + **34/34**. Settings → Secrets card verified in a token-faithful HTML
  harness (light + dark, no horizontal overflow). (Stale note corrected 2026-07-17: this work **is**
  committed — see `c99eaea` "feat: DPAPI secret store + IPC/security-audit hardening".)
- **Residual (P2):** `assertTrustedSender` is applied globally via `installGlobalSenderGuard`; optional
  `sandbox:true` still deferred (ESM-preload-under-sandbox). Remaining audit follow-ups: code signing (§20),
  offline hash validation (§19), artifact retention (§22).

## Custom AWKIT application frame (2026-07-14)

The main window is **frameless** (`windowManager.ts` `frame: false`, security prefs unchanged) with an
application-owned title bar. `AppShell` wraps the shell in `.app-window` and renders `layout/AppFrame.tsx`
(brand mark + wordmark + active-area context, draggable via `-webkit-app-region: drag`, double-click →
maximize toggle) above `layout/WindowControls.tsx` (minimize / maximize↔restore / close; icon + aria label
follow the **real** window state). Window ops go through a minimal preload `appWindow` domain
(minimize/toggleMaximize/close/isMaximized + `onMaximizedChange`) backed by `ipc/window.ipc.ts`
(`registerWindowIpc`, sender-scoped, multi-window-safe); the main process pushes `window:maximizedChanged`
on maximize/unmaximize/full-screen so the control never drifts. Layout: `--titlebar-height: 36px` is folded
into `--shell-chrome`, and `.app-shell`/`.left-navigation`/legacy `calc(100vh - …)` designer heights subtract
it, so canvas sizing is unchanged (`verify:flow-designer` 24/24, `verify:canvas-perf` 13/13). Frame styling is
token-only, theme-aware, hover gated to fine pointers, close-hover = danger, press feedback instant
(`review-animations` → Approve). Playwright automation browsers are unaffected.


**Last updated:** 2026-07-15 (Claude — Browser Resource Optimization: per-instance Chromium profiles
(maximum-compatibility / balanced / low-resource / custom) + workflow-capability guards + one authoritative
`BrowserRuntimeConfigurationResolver`; default balanced == today; measured network −100%/RAM −8%/navigate
CPU −20.6% on low-resource. See the top section + `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`. Prior:
custom AWKIT application frame: native window frame removed,
app-owned title bar + secure window-control IPC; see the section directly below. Prior:
Concurrency Capacity plan: PR-CAP-1 [A1–A4] + shared browser
pool [A5, flag-guarded] + operation limiters [A6] + adaptive controller [A7] + workload weights
[A8, flag-guarded] + resource-reduction profiles [A9] + machine-relative benchmark harness [A10] landed.
Concurrency workstream A complete; reporting workstream B complete — B1 read-model + B2 IPC + B3
comparison UI + B4 live-vs-history run card all landed.)

## Live-vs-history on the execution report — plan phase B4 (2026-07-13)

The per-instance **Execution Report** (opened from Instance Monitor) now shows the run's elapsed time
against the workflow's historical **per-run** avg/p95, scoped to the current machine. Renderer + verifier
only — consumes the existing B2 telemetry channels; no IPC/preload/schema/InstanceMonitor change.

- **Pure helper (`components/instances/executionReportModel.ts`):** `compareElapsedToHistory(elapsedMs,
  baseline, live)` → `{ tone, label }`. Live runs (partial elapsed) only flag once over avg (`"N% over
  avg"`) and otherwise report progress (`"at N% of avg"`); finished runs report the final over/under
  (`"N% faster/slower than avg"`, `"about average"` within ±5%). Returns undefined with no usable baseline.
  New `WorkflowHistoryBaseline`/`HistoryComparison` types.
- **Modal (`components/instances/LiveExecutionReportModal.tsx`):** fetches the workflow's baseline once via
  `telemetry.workflowComparison("all", { machineId })` (machineId from `system.capacityPreview`), **falling
  back to all-machines** when the current machine has no history (e.g. only pre-v3 runs). The elapsed is
  compared apples-to-apples (single-instance elapsed vs per-run history). Shows a `vs history: avg … · p95 …`
  banner line with a tone chip (`ahead`/`behind`/`neutral`) + scope/run-count caption, and `History avg` /
  `History p95` stat cards + a delta hint on the Elapsed card.
- **Styling (`global.css`):** `.report-history-vs`, `.report-vs-chip.tone-{ahead,behind,neutral}` (token-only).
- **Verified:** `npm run build` clean; `verify:instance-monitor` **43/43** (adds 8 `compareElapsedToHistory`
  cases: no/zero baseline, live under/over avg, finished faster/slower, ±5% about-average); real Electron
  capture (3-run history) showed the machine-scoped `vs history: avg 4s · p95 4s · 18% slower than avg ·
  this machine · 3 runs` line + stat cards with **0 console errors**; `verify:instance-monitor-gui` **12/12**
  (real 4-instance run, no renderer errors).
- **Note:** the baseline is blank for a workflow with no completed runs on the current machine (and, absent
  any history at all, hidden entirely).

## Workflow Reports comparison UI + machine filters — plan phase B3 (2026-07-13)

Surfaces the B1/B2 machine-aware read-model in the renderer. Renderer + verifier only — no route, IPC,
preload, runner, or schema change (consumes the B2 channels that already existed).

- **UI (`app/renderer/pages/ReportsWorkflows.tsx`):** the Workflow Reports table now loads
  `telemetry.workflowComparison(range, machineFilter)` (was `telemetry.workflows`), so each row carries its
  **previous-window comparison**. New per-metric **delta chips** (▲/▼ vs the previous window) on Runs /
  Success / Avg / p95, colored by *goodness* (higher success = green, lower duration = green; Runs is
  neutral); a **trend glyph** (up/down/flat/`new`) beside the workflow name; a per-row **success-rate
  sparkline** (lazily queries `telemetry.workflowTrend` per workflow, reusing `MetricSparkline`); and a
  compact **machine-context caption** (mode · pool · class · cores · short machineId) under each name when
  the run carried machine context (NULL for pre-v3 runs).
- **Machine filter bar:** Machine / Mode / Browsers (pool) / Workload selects, options built from
  `telemetry.machines(range)`; a "This machine" shortcut resolved from `system.capacityPreview()`
  (`capabilities.machineId`). Filters flow into the comparison, trend, and recent-runs queries so a
  cross-machine set is never silently averaged.
- **Compare mode:** a toggle adds a checkbox column; picking 2–4 workflows renders a side-by-side card grid
  (per-workflow sparkline + Runs/Success/Avg/p95 with the same delta chips + machine context).
- **Styling (`global.css`):** new token-only classes (`.awkit-report-filters`, `.awkit-filter-field/-toggle`,
  `.awkit-delta-chip.is-{up,down,neutral}`, `.awkit-trend-{up,down,flat}`, `.awkit-trend-badge.is-new`,
  `.awkit-wf-name/-machine`, `.awkit-compare-grid/-card/-stats`, select/checkbox cells); new columns stay
  inside `.awkit-table-wrap`; `prefers-reduced-motion` honored.
- **Verified:** `npm run build` clean; `verify:reports` (GUI) **31/31** (adds filter-bar renders 4 selects,
  filter select interactive + page stable, Compare toggle present/clickable + valid post-toggle state, no
  telemetry/undefined console errors); real Electron capture visually confirmed delta chips + sparkline +
  trend glyph render with live data. Regression `verify:ipc-contract` **4/4**, `verify:telemetry` **54/54**.
- **Not yet done:** B4 (optional live-vs-history on the Instance Monitor run card). Machine-context captions
  stay blank until v3 runs accrue (historical runs predate the machine columns).

## Machine-aware report IPC + preload — plan phase B2 (2026-07-13)

Exposes the B1 read-model to the renderer. Additive channels only; existing telemetry channels untouched.

- **IPC (`telemetry.ipc.ts`):** new `telemetry:workflowComparison(preset, machineFilter?)`,
  `telemetry:workflowTrend(scenarioId, preset, machineFilter?)` (bucket count derived per preset via
  `trendBucketsForPreset`), and `telemetry:machines(preset)` → delegate to new
  `ExecutionEngine.getTelemetryWorkflowComparison` / `getTelemetryWorkflowTrend` / `getTelemetryMachines`.
- **Preload (`preload.ts`):** `telemetry.workflowComparison` / `workflowTrend` / `machines` exposed on the
  bridge; the renderer's `window.playwrightFlowStudio` type derives from the preload export automatically.
- **Verified:** `npm run build` clean; `verify:ipc-contract` **4/4** (121 handlers / 98 exposed / 23
  backend-only — the 3 new channels each have exactly one handler AND are exposed).
- **Not yet done:** B3 (Workflow Reports comparison UI + machine filters), B4 (optional live-vs-history run card).

## Machine-aware report read-model — plan phase B1 (2026-07-13)

Runs now carry their **machine context** so reports can be filtered and compared BY machine (cross-machine
runs are never silently averaged together), plus a per-workflow **current-vs-previous-window** comparison
and a **run-over-run trend**. Read-model + persistence only — no IPC/UI yet (B2/B3).

- **Migration v3 (`RuntimeStoreSchema.ts`):** additive nullable columns on `runtime_runs` — `machineId`,
  `logicalCpuCount`, `totalMemoryMb`, `availableMemoryMbAtStart`, `executionMode`, `browserPoolMode`,
  `configuredConcurrency`, `observedPeakConcurrency`, `workloadClass`, `capacityRecommendationAtRun` + an
  `idx_runs_machine` index. v1/v2 DBs upgrade in place; pre-v3 rows read the columns as `undefined`
  ("Unknown"). `DurableRunRecord` + `upsertRun` extended to persist them.
- **Contracts (`TelemetryContracts.ts`):** `MachineRunContext`, `MachineFilter`, `WorkflowComparisonRow`
  (= `WorkflowReportRow` + `previous`/`delta`/`trend`/`machineContext`), `WorkflowTrend`/`WorkflowTrendPoint`,
  `MachineSummary`; `RunHistoryFilter` now extends `MachineFilter`; `machineContextFromRun` helper.
- **Store (`SqliteRuntimeStore.ts`):** `queryWorkflowComparison(range, machineFilter?)` (half-open windows
  — current `[since, now)` vs previous `[since−len, since)`; all-time → no prior window, `trend: "new"`;
  deltas are `current − previous`, undefined not NaN when a side is missing), `queryWorkflowTrend(scenarioId,
  range, buckets, machineFilter?)`, `listRunMachines(range?)`; `queryRunHistory` honors machine/mode/pool/
  class filters. Workflow aggregation refactored into a shared `aggregateWorkflows`. `RuntimeStore`
  interface + `NullRuntimeStore` stubs added.
- **Write path (`ExecutionEngine` + `capacityService` + `execution.ipc`):** `setMachineRunContext` (pushed
  by the main process, which owns machine detection via `buildMachineRunContext`) is stamped onto each run
  at the run-start `upsertRun` seam (with live pool mode / configured cap / available memory); the run's
  peak simultaneous instance count is tracked in `processQueue` and written at run end. Best-effort — an
  unset/failed context just leaves the machine columns NULL.
- **Verified:** `npm run build` clean; `verify:telemetry` **54/54** (v1→v2→v3 in-place upgrade, machine
  columns NULL for pre-v3 rows, comparison window split + delta signs + trend + empty→`new`/no-NaN, machine
  filter scoping, trend buckets, `listRunMachines`, run-history machine/mode/class/pool filters); regression
  `verify:runner` **82/82** (run write path unregressed).
- **Follow-ups (now):** B2 IPC/preload landed (see section above). B3 (Workflow Reports comparison UI +
  machine filters), B4 (optional live-vs-history on the run card) remain.

## Machine-relative benchmark harness — plan phase A10 (2026-07-13)

## Machine-relative benchmark harness — plan phase A10 (2026-07-13)

Calibrates THIS machine's real sustainable capacity by ramping concurrency through **machine-relative
stages** (scaled from the detected recommendation `R` and safety ceiling — never a fixed 4→32 sequence),
holding each stage under real Chromium load, and stopping at the first stage that trips a health stop
condition. Heavy + **opt-in** — behind an explicit npm script, never automatic.

- **`src/runner/concurrency/BenchmarkPlanner.ts` (pure, unit-tested):** `generateBenchmarkStages(R,
  ceiling)` → distinct ascending integers in `[1, ceiling]` (ramp 0.25/0.5/0.75/1.0×R, 1.25×R overshoot,
  then gradual growth up to the ceiling; small machines run `1→2→3→4`, larger run higher — all computed);
  `evaluateStopConditions(sample, thresholds)` trips on sustained/P95 CPU, free-memory reserve, memory %,
  event-loop delay, error rate, browser/renderer crashes, queue delay, and P95-latency regression, and
  **ignores missing telemetry** (partial signals still benchmark); `productionApprovedCapacity` keeps a
  margin BELOW the highest sustainable stage; `summarizeBenchmark` takes the **contiguous** sustainable
  run (first failure ends the ramp — a later lucky pass can't inflate it); `applyBenchmarkToProfile`
  adopts the measured capacity/estimates, records the benchmark id, and clears `requiresRecalibration`.
- **`scripts/benchmark-concurrency.mts` (heavy driver, `npm run benchmark:concurrency`):** detects the
  machine, plans R + ceiling + stages, drives N concurrent mock-site navigation loops per stage, samples
  host health (`ResourceSampler`), evaluates stop conditions, writes a JSON artifact under
  `<runtimeRoot>/runtime/benchmarks/` and folds the result into the machine capacity profile
  (`benchmarkTestedCapacity`, `productionApprovedCapacity`, per-instance estimates). A
  `AWKIT_BENCHMARK_PLAN_ONLY=1` / `--plan` dry-run prints the machine + planned stages without launching
  browsers.
- **Verified:** `npm run build` clean; new `verify:benchmark-planner` **36/36** (stage scaling +
  normalization + ceiling clamp + maxStages bound, each stop threshold, missing-telemetry no-stop,
  production margin, contiguous-sustainable summary, profile application); plan-only harness smoke on a
  12-CPU/16-GB host printed machine-relative stages. **Not run: the full live benchmark — a true
  production cap requires a clean-machine run (external gate).**
- **Not yet done:** consume `benchmarkTestedCapacity`/`productionApprovedCapacity` in Auto mode + the
  Settings capacity preview; wire per-instance measured estimates back into the planner seed overrides.

## Resource-reduction profiles — plan phase A9 (2026-07-13)

Per-run knobs to cut per-instance cost without changing defaults: request-blocking **resource profiles**
(Normal / Lean / Ultra-Lean) plus formal **artifact profiles** (Production / Balanced / Debug / Full).
**Default is Normal + Balanced = today's exact behaviour** (images are NEVER blocked by default).

- **`src/runner/ResourceRoutingPolicy.ts` (pure + live-tested):** `decideRequest(resourceType, url, cfg)`
  aborts sub-resources per profile — Lean drops image/media/font, Ultra-Lean also drops stylesheet — with
  precedence URL-allow > URL-block > type-block (profile defaults ∪ extra, minus allow-list). `*`-glob URL
  matching; `resolveContextOptions` yields deterministic context options (blocked service workers, reduced
  motion, fixed device-scale, download opt-out in Ultra-Lean); `loadResourceRoutingConfig(env)` reads
  `AWKIT_RESOURCE_PROFILE` (+ allow/block-list, service-worker, downloads, device-scale, debug overrides);
  `installResourceRouting(context, cfg)` installs `context.route` only when active (best-effort — a routing
  failure lets the request proceed). Images blocked only when a Lean profile is explicitly chosen; an app
  can force-allow a needed asset by URL pattern.
- **`src/runner/artifacts/ArtifactProfile.ts` (pure):** `resolveArtifactSettings(profile)` maps Production→
  trace off, Balanced→trace onFailure (today's default), Debug→trace always, Full→trace always + video;
  all keep failure screenshots. `loadTraceMode()` now falls back to this (default Balanced → onFailure, so
  the historical default is unchanged); an explicit `AWKIT_TRACE_MODE` still wins.
- **Wiring (`BrowserContextFactory`):** resolves the routing config once (env when unset), folds the
  profile's context options into all three context paths (persistent / shared-pool / dedicated isolated)
  via `buildContextOptions`, and installs request routing on each created context. Normal profile = the
  historical `{ acceptDownloads: true, viewport }` + no `context.route`.
- **Verified:** `npm run build` clean; new `verify:resource-routing` **42/42** (decisions, precedence,
  overrides, glob, context options, env parsing, artifact mapping) + `verify:lean-mode` **12/12** (real
  Chromium: Normal loads all, Lean aborts image, Ultra-Lean aborts image+stylesheet, DOM text intact,
  allow-list rescue); regression `verify:runner` **82/82** (Normal path unregressed), `verify:concurrency`
  **78/78**.
- **Not yet done:** a dedicated Mock Site Lean/downloads scenario (the live proof uses a self-contained
  temp server); Settings UI to pick resource/artifact profiles per run; wiring the `video`/`screenshotOn
  Failure` artifact-profile fields beyond trace (trace is wired; the others are resolved but not yet
  consumed).

## Workload-aware capacity + scheduler weights — plan phase A8 (2026-07-13)

Admission stops treating every instance as one identical "flow". Each instance gets a relative **weight**
(a persistent-profile / headed / download / parallel-branch / trace-video flow costs more than a plain
isolated context), and — when enabled — dispatch is admitted against a **weighted budget**
(`maxActiveFlows × budgetPerFlow`) instead of a raw active count, so a few heavy instances weigh as much
as several light ones. **Experimental, gated by `AWKIT_WORKLOAD_WEIGHTS` (default OFF); flag-off is the
exact count-based admission as before.**

- **`src/runner/concurrency/WorkloadWeights.ts` (pure, unit-tested):** `extractWorkloadFeatures(config,
  flows, ctx)` reads static signals (headed, persistent profile, browser-swap nodes, navigation/download/
  upload/screenshot counts, full-page shot, popups, parallel branches, nested flows, loops, node count,
  trace/video); `computeWorkloadWeight` is additive from a `baseWeight` of 1.0, monotonic, clamped to
  `[base, maxWeight]`; `classifyWorkload` maps weight → `light|medium|heavy`, **rounding UP on ambiguity**
  (never under-classify a costly flow); `weightedBudget` + `canAdmitWeighted` drive admission and **never
  deadlock** (an idle host always admits ≥ 1 instance even if it alone exceeds budget). All seeds live in
  one `DEFAULT_WORKLOAD_WEIGHT_CONFIG` (configurable, superseded by measurement in A10). Weight is an
  ADMISSION concept, kept separate from the A5 physical context budget (no double counting).
  `buildWorkloadRecommendation` tags per-class recommendations `unmeasured → estimated → benchmarked`.
- **Wiring:** `ConcurrencyConfig` gained `workloadWeights` (bool, `AWKIT_WORKLOAD_WEIGHTS`, default OFF) +
  `workloadWeightBudgetPerFlow` (`AWKIT_WORKLOAD_WEIGHT_BUDGET_PER_FLOW`, default 1.0). `ExecutionEngine`
  caches a per-instance weight (`instanceWeights`, dropped when the runner settles) and, in the dispatch
  loop only when the flag is on, gates each candidate on `canAdmitWeighted(activeWeightedCost, candidate,
  budget)` before acquiring a browser/context slot; a blocked candidate stays pending and is retried next
  tick. No change to the browser-slot semaphore or the A5/A6/A7 paths.
- **Verified:** `npm run build` clean; new `verify:workload-weights` **53/53** (extraction, weight
  monotonicity + clamp, classification boundaries + round-up, budget math, admission incl. no-deadlock,
  confidence transitions); regression `verify:concurrency` **78/78**, `verify:adaptive-concurrency`
  **14/14**, `verify:operation-limiters` **10/10**.
- **Not yet done:** per-class capacity surfaced in the Settings preview / IPC (the recommendation builder
  exists but is not yet consumed by the UI); history-driven weight/class calibration (A10 benchmark feed).

## Adaptive concurrency controller — plan phase A7 (2026-07-13)

Lowers the live active-flow target under REAL host pressure (CPU / memory / event-loop delay / crash
rate — including load from OTHER apps) and recovers gradually. **Purely protective: with no pressure the
target sits at the configured cap, so steady-state behavior is unchanged** (no slow-ramp surprise).

- **`src/runner/concurrency/AdaptiveController.ts`:** maintains a target in `[1, ceiling]`; classifies
  `healthy`/`stable`/`pressure`/`critical` from an injected health sample; **grows slowly** (step 1,
  only when there is queued work AND positive healthy evidence) and **shrinks fast** (step 2) under
  critical pressure; `pressure` freezes growth; a cooldown between changes prevents oscillation.
  `setCeiling()` jumps the target to a new cap immediately (an operator reconfig is not pressure). Pure +
  unit-tested. Missing samples → hold (never grow without evidence).
- **Event-loop signal (`ResourceSampler.ts`):** added `eventLoopDelayMs` (passive `monitorEventLoopDelay`
  histogram, unref'd) to the sample — a main-thread-saturation indicator feeding pressure/critical.
- **Wiring:** `ConcurrencyConfig` gained `adaptiveConcurrency` (default ON, `AWKIT_ADAPTIVE_CONCURRENCY`)
  + grow/shrink/cooldown + healthy/critical CPU-mem-eventloop thresholds (pressure thresholds reuse the
  existing `maxCpuPercent`/`maxSystemMemoryPercent`/`minFreeMemoryMb`). `BackpressureController.admit`
  takes an optional `effectiveMaxFlows` (the adaptive target, clamped ≤ `maxActiveFlows`); `CapacitySnapshot`
  gained `adaptiveTarget`/`adaptiveState` (additive → surfaced in `getRuntimeStatus`). `ExecutionEngine`
  owns the controller, evaluates it each dispatch tick with the live sample + crash count + queue depth,
  passes the target to `admit`, and re-seeds the ceiling in `configureConcurrency`. It never touches the
  browser-slot semaphore (idle-only resize preserved).
- **Verified:** `npm run build` clean; new `verify:adaptive-concurrency` **14/14** (grow/hold/shrink,
  cooldown, `[1,ceiling]` bounds, recover-after-spike, event-loop + crash → critical, empty-queue no-grow,
  setCeiling jump, unknown-sample hold); regression `verify:concurrency` **78/78**, `verify:resource-sampling`
  **14/14**, `verify:runtime-status` **15/15**, `verify:operation-limiters` 10/10, `verify:runner` 82/82.
- **Follow-up:** Instance Monitor strip could show `adaptiveState`/`adaptiveTarget` (fields are already in
  the status; UI wiring deferred).


## Operation limiters — plan phase A6 (2026-07-13)

Independent, configurable caps on how many of each EXPENSIVE operation run at once across ALL instances,
so peak concurrency ≠ peak simultaneous spikes (the guide's "stagger expensive operations"). Active by
default (no flag) with conservative caps; adds no behavior change beyond staggering.

- **`src/runner/concurrency/OperationLimiters.ts`:** five `Semaphore`-backed kinds — `browserLaunch` (2),
  `contextCreation` (4), `navigation` (8), `download` (3), `screenshot` (2). `run(kind, fn)` holds a
  permit only around the raw Playwright call (released in `finally` — never across a wait/handoff, so no
  deadlock). `configure()` swaps a kind's semaphore; in-flight ops finish on their old instance, so a
  resize is safe any time. All caps env-overridable (`AWKIT_MAX_CONCURRENT_*`) — none machine-specific.
- **Wiring:** `ConcurrencyConfig` gained the five `maxConcurrent*` fields; `BrowserContextFactory` wraps
  `launch`/`launchPersistentContext` (browserLaunch) + `newContext` (contextCreation) for shared AND
  dedicated paths; `StepExecutor` wraps the two `goto` sites (navigation), `download.saveAs` (download),
  and both `takeScreenshot` calls (screenshot) via a `limitOp` helper (15th ctor param, threaded from
  `PlaywrightRunner` at both StepExecutor construction sites). `ExecutionEngine` owns one `OperationLimiters`,
  sizes it live in `configureConcurrency`, and passes it to every runner. **Sequential mode pins all five
  to 1** (`applyRuntimeConcurrencyFromSettings`), so parallel branches within one instance also serialize.
- **Verified:** `npm run build` clean; new `verify:operation-limiters` **10/10** (per-kind cap never
  exceeded under a 12-op burst, kind independence, finally-release on throw, live reconfigure, Sequential
  serializes); regression: `verify:runner` **82/82** (real Chromium — wrapped goto/screenshot/download
  unregressed), `verify:waits` **21/21**, `verify:concurrency` **78/78**, shared-pool 18/18 + live 5/5.


## Shared Chromium browser pool — plan phase A5 (2026-07-13, experimental, default OFF)

Lets many isolated `browserContext` instances share a few Chromium processes instead of one process per
instance. **Gated by `AWKIT_SHARED_BROWSER_POOL` (default off) → flag-off behavior is byte-for-byte
identical** (proven: browser-pool 25/25, concurrency 78/78, runner 82/82 all unregressed).

- **`src/runner/browser/SharedBrowserPool.ts`:** owns shared `Browser` objects, leases isolated
  contexts, spreads across browsers (crash isolation) up to `maxBrowsers` then packs to a hard
  per-browser context limit, selects least-loaded healthy browsers, drops+replaces crashed browsers,
  recycles a browser after N contexts (drain then close), `drainIdle`/`closeAll`, snapshot. Injectable
  launcher → unit-testable without Chromium.
- **`src/runner/browser/browserSharing.ts`:** `isSharedEligible` = flag on + `browserContext` isolation
  + no persistent profile/captured session + no browser-swap node (`autoSecureLogin`/`reuseSession`/
  `protectedLoginHandoff`). Those **dedicated** instances always keep their own browser. `sharedLaunchKey`
  keeps headed/headless on separate processes.
- **Wiring:** `ConcurrencyConfig` gained `useSharedBrowserPool` + recycle/hard-limit fields (env-overridable);
  `BrowserContextFactory` leases from the pool for the `browserContext` path when a pool is supplied;
  `BrowserWorkerPool` gained non-semaphore **context slots** (`acquireContextSlot`) so shared instances are
  bounded by `maxActiveFlows` (+ the pool's browser cap), not by `maxBrowsersPerHost`, and are excluded
  from the pool-saturation check; `ExecutionEngine` constructs one `SharedBrowserPool` (sized live in
  `configureConcurrency`), routes eligible instances to context slots + the pool, and `drainIdle`s at run
  end. `PlaywrightRunner` passes the pool through unchanged. The generation-scoped expected-close/crash
  logic is preserved (shared context close only closes the context; the browser stays warm).
- **Verified:** `npm run build` clean; new `verify:shared-browser-pool` **18/18** (packing 16→4 browsers,
  least-loaded reuse, hard-limit + exhaustion, crash health, recycle+drain, launch-key isolation,
  eligibility); new `verify:shared-browser-live` **5/5** (REAL Chromium: 4 leased contexts share exactly
  2 processes, usable, drain closes both); flag-off parity green (browser-pool/concurrency/runner).
- **Remaining (external gate / follow-ups):** a full flag-ON multi-instance run *through the engine
  dispatch* against the mock site (heavy; the clean-machine gate) is not yet done — the mechanism + factory
  lease are proven with real Chromium and flag-off is unregressed. The runtime-status "browsers X/Y" gauge
  still counts only real (dedicated) slots, not shared browsers (add shared count next). Default stays OFF
  until the live multi-instance run passes (owner decision D4).



## Machine-aware Runtime Concurrency modes — plan phase A4 (2026-07-13)

Wires the capacity core (A1–A3, below) into real dispatch + the Settings UI. This is the first slice that
**changes run behavior**: `Settings → Runtime Concurrency` now chooses **Sequential / Auto / Manual**.

- **Settings schema (`app/main/uiSettings.ts`):** `runtime` gained `capacityMode` (`manual` default for
  back-compat), `workloadClass`, `administratorMaximumConcurrency`, `absoluteSafetyMaximum` (64),
  `capacitySafetyFactor` (0.75), `reservedLogicalCpuCount` (1) alongside the legacy `maxBrowsers`/
  `maxActiveFlows`. Legacy files migrate on read (absent `capacityMode` → `manual`, old numbers preserved
  as the Manual values). Main + client validation extended.
- **Mapping (`app/main/capacityService.ts` + `src/runner/concurrency/CapacityContracts.ts`):** the pure
  `resolveEffectiveConcurrency()` turns a mode into concrete host caps — **sequential** → 1 browser / 1
  active flow (fully serializes, any machine); **manual** → the explicit numbers; **auto** → the detected
  machine's benchmark value if present else the conservative recommendation, with a pre-benchmark ceiling
  for un-benchmarked server-grade hosts (`DEFAULT_UNBENCHMARKED_AUTO_CEILING`). **Every** mode is clamped
  to the administrator max + absolute safety ceiling (Manual is never unbounded).
- **Apply seam (`app/main/ipc/execution.ipc.ts`):** `applyRuntimeConcurrencyFromSettings()` now calls
  `computeEffectiveConcurrency()` (Auto detects the host + refreshes the per-machine profile) → the same
  `ExecutionEngine.configureConcurrency` seam as before (still startup / on settings save / before each
  run; browser-slot resize still idle-only).
- **IPC (`app/main/ipc/system.ipc.ts` + `preload.ts`):** new read-only `system:capacityPreview(workloadClass?)`
  → `CapacityPreview` (machine specs, recommendation, binding constraint, category, auto vs effective
  target, recalibration flag). Does not persist the profile. `verify:ipc-contract` green (118/95/23).
- **UI (`app/renderer/pages/Settings.tsx` + `global.css`):** the Runtime Concurrency card is now a
  Sequential/Auto/Manual selector with a live "this machine" readout, Auto workload-class picker, Manual
  inputs + an "exceeds recommended" warning, and an Advanced safety-limits group. Token-only styling.
- **Verified:** `npm run build` clean; `verify:capacity-modes` **10/10**; `verify:ipc-contract` **4/4**;
  `verify:settings-persistence` **3/3**; new `verify:capacity-settings-gui` **12/12** (real Electron: live
  detection on a 12-CPU/16-GB host, all three modes end-to-end, card render, no console errors);
  `verify:concurrency` **78/78** (unregressed).
- **Not yet done (next phases):** concurrency workstream A (A1–A10) is complete; the reporting workstream
  B (B1–B4: per-workflow comparison + machine-context history) remains. A5–A10 have since landed (see
  sections above).

## Machine-agnostic capacity core — plan phases A1–A3 (2026-07-13)

First execution slice of `docs/ai/CONCURRENCY_CAPACITY_AND_REPORTS_PLAN.md`. **Pure `src/` core only —
no ExecutionEngine/IPC/renderer wiring, no run-behavior change yet.** Everything is hardware-agnostic:
capacity is detected/configured/measured, never hardcoded to any machine shape.

- **`src/runner/concurrency/MachineCapabilityDetector.ts` (A1):** `MachineCapabilities` snapshot from an
  injectable `OsProbe` (never throws); coarse capability **fingerprint** (stable across reboot and
  available-memory drift; changes on logical-CPU count / total-RAM GB band / platform / OS type);
  `capabilitiesChanged()` reasons; `loadOrCreateMachineId(runtimeRoot)` → atomic `machine-id.json`
  (locally generated UUID; no hardware serials/MACs).
- **`src/runner/concurrency/CapacityPlanner.ts` (A2):** pure `planCapacity()` = conservative
  `min(memoryEstimate, cpuEstimate, adminMax, absoluteCeiling)` after OS/AWKIT/safety reserves, reserved
  cores, and live background-CPU load; `CapacityTuning` holds every seed/bound in one place
  (`DEFAULT_CAPACITY_TUNING`); `resolveReserveMb` precedence = more-protective of absolute vs percentage;
  config-driven `bootstrapCategories`; measured per-instance overrides supersede seeds; seven distinct
  capacity terms. High RAM alone never inflates the number (stays CPU-bound). `planWorkloadCapacities()`
  gives per-class (light/medium/heavy) recommendations.
- **`src/runner/concurrency/MachineCapacityProfileStore.ts` (A3):** per-machine `MachineCapacityProfile`
  persisted atomically at `<runtimeRoot>/runtime/machine-profiles/<machineId>.json`;
  `reconcileMachineProfile()` — new machine → fresh conservative profile; same hardware → refresh but keep
  measured benchmark/estimate values + administrator `configuredCapacity`; changed hardware → flag
  `requiresRecalibration`, drop stale benchmark values, **preserve** the manual configured value; profiles
  isolated per `machineId`.
- **Verified:** `tsc --noEmit` clean; `npm run verify:machine-capabilities` **20/20**;
  `npm run verify:capacity-planner` **29/29**; `npm run verify:machine-profile` **15/15**.
- **A4 (done):** these modules are now wired into Settings/IPC/engine — see the A4 entry above.

## Runtime concurrency caps configurable in Settings (2026-07-12)

The host browser/flow caps that were env-only (`AWKIT_MAX_BROWSERS` / `AWKIT_MAX_ACTIVE_FLOWS`) are now
editable in **Settings → Runtime Concurrency** and drive the Chrome Consumption gauge denominators.

- **Schema (`app/main/uiSettings.ts`):** new `runtime: { maxBrowsers, maxActiveFlows }` section
  (defaults 2 / 4, matching `ConcurrencyConfig`); hydrate/mergePatch/validate updated (bounds: browsers
  1–16, flows 1–64).
- **Engine (`src/runner/ExecutionEngine.ts` + `src/runner/browser/BrowserWorkerPool.ts`):** new
  `ExecutionEngine.configureConcurrency(overrides)` → `BrowserWorkerPool.reconfigure(overrides)`. The
  shared `limits` object is mutated in place so `maxActiveFlows` (and other soft caps) take effect
  immediately for the next admission; the browser-slot `Semaphore` is rebuilt **only when the pool is
  idle** (`slots.size === 0`) so an in-flight release can't corrupt permits — `limits.maxBrowsersPerHost`
  never drifts from the live semaphore capacity (gauge stays honest). `src/` never reads app settings;
  the main process pushes them in.
- **Wiring (`app/main/ipc/execution.ipc.ts` + `settings.ipc.ts`):** `applyRuntimeConcurrencyFromSettings()`
  pushes the settings into the engine at **startup**, after every **settings save/reset/import**, and
  before **each run** (so a run always honours the latest caps; a browser-cap change lands when idle).
- **UI (`app/renderer/pages/Settings.tsx`):** a Runtime Concurrency card (Max browsers / Max active
  flows) with client+main validation and a hint that a live browser-count change applies when no run is
  in progress.
- **Verified:** `npm run build` clean; `verify:browser-pool` **25/25** (new Part G: live `maxActiveFlows`,
  guarded/deferred `maxBrowsers` resize); `verify:settings-persistence` **3/3**; `verify:reports` 26/26;
  `verify:ipc-contract` 4/4.

## Chrome Consumption gauges: fixed distortion + live idle sampling (2026-07-12)

Two fixes for the Chrome Consumption (reportsChrome) page.

- **RPM gauge distortion (renderer, `app/renderer/components/reports/RadialGauge.tsx`):** the colored
  band segments rendered as a cusped/distorted swoosh instead of a clean semicircle. `bandArc` used SVG
  arc **sweep-flag 0**, which is only unambiguous for the full 0→100 arc (chord === diameter → a single
  possible circle). For the shorter band sub-arcs (0–60/60–85/85–100) flag 0 resolves to the *mirrored*
  circle centre, so each segment bulged the wrong way. Changed to **sweep-flag 1** (always the top
  semicircle). Verified by rasterizing the exact SVG with `sharp`: flag 0 reproduced the reported
  distortion; flag 1 renders clean gauges (needle left at 0%, into red at 90%, neutral arc when
  unavailable).
- **Memory/CPU gauges stuck on "sampling…" (core, `src/runner/ExecutionEngine.ts`):** the
  `ResourceSampler` was started only inside `startRun`, so with no active run the system RAM/CPU gauges
  never got a sample. `getRuntimeStatus()` now calls the idempotent `this.sampler.start()` (primes the
  first sample synchronously, unref'd timer), so system RAM shows immediately and CPU within one poll
  even at idle. Process-tree metrics (Chromium count/memory) still populate during runs.
- **Gauge caps are now configurable in Settings** (see next entry) — no longer env-only.
- **Verified:** `npm run build` clean; `npm run verify:reports` **26/26** (real Electron; gauges render,
  no console errors). Gauge geometry proven via `sharp` raster comparison.

## Reports tables now fill full width + scroll inside bounded cards (2026-07-12)

Renderer/CSS-only fix (`app/renderer/styles/global.css`) for a reported Workflow Reports layout bug; no
route/IPC/runner/schema change. `.awkit-table` is used only by the reports pages/components.

- **Root cause (full-width):** the global `table { display: block; overflow-x: auto }` rule (used to make
  the wide Instance Monitor table horizontally scrollable) applied to **every** `<table>`, so `.awkit-table`
  — which sets `width: 100%` expecting a real table box — rendered as a block whose inner columns
  shrink-to-fit and cluster on the left, leaving the right half of each report card empty.
- **Fix (full-width):** `.awkit-table` now sets `display: table` (overriding the global block rule) so
  `width: 100%` actually stretches the columns to fill the card. Horizontal scroll on narrow widths is
  still handled by `.awkit-table-wrap { overflow-x: auto }`.
- **Fix (bounded height + scroller):** `.awkit-report-page .awkit-table-wrap` gets `max-height: 46vh` +
  `overflow-y: auto`, and its `thead th` is `position: sticky; top: 0`, so long run lists scroll inside a
  fixed-height card (with a pinned header) instead of pushing the page down.
- **Verified:** `npm run build` clean; `npm run verify:reports` **26/26** (real Electron — all report
  routes render/resolve, no console errors). The width/scroll is a visual CSS change; the GUI verifier
  confirms no functional regression across every report route.

## Load Session (A7) — accepted as a roadmap stub (2026-07-12)

Owner decision during audit remediation Phase 4: the Protected Login Handoff `useSavedSession`
("Load Session") and `useTestSession` modes are **kept as-is** — no code change. They are already
honestly disabled (validation note in `flowNodeRegistry.ts:167`, capability flags `false` in
`src/auth/OAuthHandoffService.ts`, disabled button in `ProtectedLoginHandoffPanel.tsx`) and are
redundant with the fully-working `Reuse Session` (persistent-profile swap) and `Auto Secure Login`
nodes. Reclassified in `docs/audit/` from a defect to an intentional roadmap stub; revisit only if
Load Session is prioritized as a real feature.

## Electron/IPC surface hygiene (2026-07-12)

Closes audit findings A5/A6 from `docs/audit/`. No route/runner/schema/packaging change; no channel was
added, removed, or re-wired — the renderer↔main contract is unchanged, only guarded.

- **A5 — external-open scheme guard:** `app/main/windowManager.ts` `setWindowOpenHandler` now opens the
  target via `shell.openExternal` **only for `http(s)`** (was: any scheme). A `file:`/other-scheme
  `window.open` is denied without launching the OS handler. Mirrors the guard already in
  `auth.ipc.ts` `openExternal`.
- **A6 — IPC contract guard:** new `npm run verify:ipc-contract`
  (`scripts/verify-ipc-contract.mts`, 4/4, static, no Electron) parses `app/main/ipc/*` +
  `app/main/preload.ts` and enforces: (1) every preload-invoked channel has a handler (no broken
  renderer→main call), (2) no channel registered twice, (3) every registered handler is either exposed
  in preload **or** in a documented `BACKEND_ONLY` allowlist, (4) the allowlist has no stale entries.
  The **23 registered-but-unexposed** channels (`instances:*`/`runtimeInputs:*` CRUD, `reports:create/
  delete/export`, legacy singular/plural `list` aliases, `scenario:get/save`) are now documented in that
  allowlist rather than deleted — they are unreachable from the renderer (no preload bridge), so this is
  a maintainability/contributor-clarity fix, and the guard fails the build if a NEW unexposed handler
  appears. Current tally: 117 handlers, 94 exposed, 23 backend-only.
- **Verified:** `npm run build` clean; `verify:ipc-contract` **4/4**.

## Isolated browser teardown no longer orphans the process (2026-07-12)

Core-only change (`src/runner/BrowserContextFactory.ts`); no route/IPC/preload/schema/packaging change,
and browser-context semantics are otherwise identical. Closes audit finding A4 from `docs/audit/`.

- **Symptom (A4):** the `browserContext`-isolation close path was `await isolatedContext.close(); await
  browser.close();` with no `try/finally`. If `context.close()` rejected (e.g. the target already
  crashed), `browser.close()` was skipped and the Chromium process leaked inside the long-running
  Electron host. The persistent-context path was already correct (try/finally around the profile lease).
- **Fix:** new exported `closeIsolatedRuntime(context, browser)` closes the context in `try` and the
  browser in `finally` (a failing `browser.close()` is swallowed so it can't mask the original context
  error, which still propagates). The isolated `create()` close closure now delegates to it.
- **Verifier:** `verify:browser-pool` Part F (now **20/20**, was 16) asserts the browser is closed when
  `context.close()` rejects, the context error still propagates, the happy path is clean, and a failing
  browser close is swallowed when the context closed cleanly.
- **Verified:** `npm run build` clean; `npm run verify:browser-pool` **20/20**.

## Profile store data-integrity hardening (2026-07-12)

## Profile store data-integrity hardening (2026-07-12)

Core-only change (`src/storage/ProfileStore.ts`); no route/IPC/preload/runner/schema/packaging change,
and the on-disk format (one JSON file per profile) is unchanged. Closes audit findings A1/A2/A3 (+S1)
from `docs/audit/`. The profile store persists **flows, workflows, data sources, reports, runtime
inputs, instances** and previously wrote non-atomically and silently dropped corrupt files — the
settings store had already been hardened, the document store had not.

- **Atomic writes (A1):** `writeProfile` now serializes to `${path}.<pid>.<ts>.<rand>.tmp` then
  `rename()`s over the target (Windows `MOVEFILE_REPLACE_EXISTING`), so a crash/power-loss mid-write can
  never truncate a saved document; on rename failure the temp file is cleaned up. Mirrors the existing
  `uiSettings.writeSettings` pattern (but self-contained — `src/` must not import `app/`).
- **Serialized mutations (S1):** every write/delete for a store instance runs through an in-instance
  FIFO promise chain, so overlapping saves to the same folder can't physically interleave.
- **Corrupt-file quarantine (A2):** a file that fails `JSON.parse` is renamed to a `.corrupt-<ts>`
  sibling (outside the `.json` scan) and logged loudly, instead of being silently returned as `null`
  and vanishing from the library. The bytes survive for recovery; the original is never destroyed.
  A missing file is still a normal "not found".
- **Crash-safe id rename (A3):** `update()` with an id change now writes the new file *before* deleting
  the old one — a crash between them leaves a recoverable duplicate, never zero files.
- **Verifier:** new `npm run verify:profile-store` (`scripts/verify-profile-store.mts`, 13/13, pure
  `tsx`, no Electron) proves atomic writes / no `.tmp` residue, 40 concurrent creates + updates,
  quarantine-not-drop with preserved bytes, and lossless id rename.
- **Verified:** `npm run build` clean; `verify:profile-store` **13/13**; `verify:data-editor` **27/27**
  (store consumer, unregressed); `verify:write-queue` 7/7; `verify:workflow-sentinels` 4/4. Not run:
  live/GUI verifiers and packaged/offline (no behavior in those paths changed).

## Instance Monitor workflow summaries and bulk stop (2026-07-12)

Renderer/monitor aggregation and verification only; the existing `execution:stopAll` IPC and hard-cancel
engine path are reused unchanged. No profile schema, runner contract, routing, or packaging change.

- **Stop Pending & Running:** the monitor toolbar now exposes an explicit destructive bulk action for
  `pending`, `queued`, `starting`, `running`, paused, and manual-handoff instances. It is enabled when any
  cancellable work exists (including pending-only batches), requires confirmation, calls the real backend
  `executions.stopAll()`, and reports the affected count. The compact page-header action uses the same path.
- **Workflow run records:** live pool rows are grouped by globally unique `executionId`, keeping concurrent
  and repeated runs of the same workflow separate. Active/attention/queued runs sort ahead of terminal
  history. Each record shows workflow identity, run status, active/pending/completed/failed counts,
  progress, total instances, and duration.
- **All-instance modal:** selecting a workflow record opens an accessible Escape/backdrop-close modal with
  total/active/pending/failed/completed/cancelled metrics and every instance's status, current flow/step,
  data row, browser/mode/isolation, timing, retries, and link to the existing live execution report.
- **Mock lab:** `/designer-lab` documents and exercises the workflow-record → all-instance-modal contract.
- **Files:** `app/renderer/pages/InstanceMonitor.tsx`,
  `app/renderer/components/instances/WorkflowInstancesModal.tsx`, `app/renderer/styles/global.css`,
  `src/instances/instanceCardLogic.ts`, `scripts/verify-instance-monitor.mts`,
  `scripts/verify-instance-monitor-gui.mjs`, mock-site docs/fixture/verifier, `package.json`.
- **Verified:** `npm run build` clean; `npm run verify:instance-monitor` **35/35**;
  `npm run verify:instance-monitor-gui` **12/12** against an isolated four-instance real Electron run
  (two running + two queued, all four cancelled); `npm run verify:mock-site` **39/39**. The real Electron
  workflow modal was captured and visually inspected in light mode.

## Flow Designer inspector canvas bounds fixed (2026-07-12)

Renderer layout only; no profile schema, routing, IPC, runner, recorder, or packaging change.

- **Symptom:** opening the Flow Designer right properties inspector placed it in a separate outer grid
  column beyond the canvas and action-toolbar right edge. The first repair only corrected its vertical
  height and did not address this horizontal overflow.
- **Fix:** the designer canvas and action toolbar now retain the full layout width. The inspector slot is
  absolutely bounded inside that canvas, below the measured action-toolbar height, while the usable node
  canvas reserves an internal strip of the same width so the inspector does not cover nodes/connectors.
  The collapsed rail uses the same contained geometry and returns the reserved canvas width.
- **Regression coverage:** the real Electron Flow Designer walkthrough asserts full four-edge inspector
  containment, full-width toolbar alignment, and non-overlap with the usable canvas at the default,
  compact **1024×768**, and reported **1936×1290** viewports.
- **Files:** `app/renderer/styles/global.css`, `scripts/verify-flow-designer-gui.mjs`.
- **Verified:** `npm run build` clean; `npm run verify:flow-designer` **24/24**;
  `npm run verify:mock-site` **35/35**; the captured 1936×1290 Electron frame visually confirms the
  panel is inside the canvas from toolbar bottom to canvas bottom.

## Backpressure crash-rate false positive fixed (2026-07-11)

Runner/orchestrator only; no route, IPC, preload, profile-schema, or packaging change.

- **Symptom:** a large concurrent run (e.g. 50 instances) stalled with `Crashes 5`, `Browsers 0/2`, and
  the banner "browser crash rate high (5 crashes in window) — pausing new dispatch" while ~46 instances
  sat `Pending` — even though CPU/memory were low. Backpressure was firing on phantom crashes.
- **Root cause:** in `browserContext` isolation (default; "Context" in the monitor) the runtime owns a
  real Playwright `Browser`, so its **normal** end-of-instance `browser.close()` emits `disconnected`.
  `PlaywrightRunner.executeScenario` closes the runtime in its own `finally` **before** returning, so the
  engine's `releaseSlot(slot)` had not run and `slot.released` was still `false` when
  `BrowserWorkerPool`'s `disconnected` handler ran — scoring every completed instance (pass or fail) as a
  crash. Past `maxRecentCrashes` (default 3, 5-min window) `BackpressureController.admit` paused all new
  dispatch. Persistent-context runs were immune (no `Browser` object).
- **Fix:** the runner announces intentional teardown via a new `onRuntimeClosing` option (fired in
  `closeRuntime` — covers end-of-run, hard cancel, and Reuse Session swap); the engine wires it to
  `BrowserWorkerPool.markExpectedClose(slot, generation)`, and the pool's `disconnected` handler skips
  crash-counting when `slot.expectedCloseGeneration === generation`. Genuine crashes still count
  (unsignalled mid-run disconnect, page `crash` event, and the engine's explicit `browser-crash`
  classification); the signal is **generation-scoped** so a real crash of a later generation after a swap
  is still counted.
- **Files:** `src/runner/browser/BrowserWorkerPool.ts`, `src/runner/PlaywrightRunner.ts`,
  `src/runner/ExecutionEngine.ts`, `scripts/verify-browser-pool.mts` (Part E regression).
- **Verified:** `npm run build` clean; `verify:browser-pool` **16/16** (new Part E); `verify:concurrency`
  **78/78**; `verify:runner` **82/82**. Not run: clean-machine offline GUI walkthrough / live 50-instance
  repro (the fix is proven at the unit-ordering level that produced the miscount).

## Compound / tree locators for non-unique elements (2026-07-11)

Recorder + runner + Flow Designer. Fixes the reported case where a recorded step showed
"Locator warning: matches 2 elements" (e.g. two `checkbox` controls sharing accessible name
`0796713928`) because the recorder only tried *single-strategy* locators and fell back to an
ambiguous `role`/positional selector. Schema is additively extended (one optional field); the runner
already resolved `css`/container/`alternatives`, so no runtime contract changed.

- **Phase 1 — compound "tree" builder** (`src/recorder/recorderInitScript.ts`): new
  `compoundSelector` combines the element's meaningful features (stable attributes + rare,
  non-utility classes, ranked by document frequency) with the **fewest distinguishing ancestors**
  (descendant combinators, skipping wrapper noise) until `count === 1` — e.g.
  `[data-testid="package-pro"] button.pkg-select`. `anchoredStructural` (nearest unique
  id/testid ancestor + positional tail) and the existing whole-document positional path remain the
  guaranteed-unique last resorts. Utility/layout classes (`flex`, `items-center`, …), state
  prefixes, and hashed css-modules/emotion/styled classes are never used.
- **Phase 2a — semantic container scoping** (`recorderInitScript.ts`): when the primary would be a
  raw compound/positional selector, a readable semantic locator (role+name/label/placeholder/text)
  scoped to a stable container that **isolates the exact element** (verified in-page against the real
  ancestor node) is preferred and saved as `context.container`. New `quality.disambiguation`
  (`compound`/`container`/`positional`) drives a neutral Node-Properties readout instead of the red
  warning; `LocatorQuality.disambiguation?` added to `src/profiles/FlowProfile.ts` (optional,
  back-compatible).
- **Phase 2b — edit-safe designer round-trip** (`app/renderer`): recorded `alternatives`/`context`
  were silently dropped when a flow was opened and re-saved in the Flow Designer. Added
  `FlowDesignerNodeData.locatorAlternatives`/`locatorContext` (`flowDesignerTypes.ts`) and threaded
  them through `fromFlowStep`/`toFlowStep` (`pages/FlowChartDesigner.tsx`). Panel
  (`components/workflow/FlowNodePropertiesPanel.tsx`) now shows "Unique · … · scoped to container /
  compound selector / positional fallback".
- **Phase 3 — runtime self-healing** (`src/runner/LocatorFactory.ts`): when a saved step matches
  several elements, `pickSingle`/`narrowToActionable` pick the single *visible* → *enabled* →
  *in-viewport* match. If two+ remain equally actionable it **does not guess** and fails with the
  existing friendly diagnostic. Heals legacy non-unique flows without re-recording. It only converts
  would-be failures into successes — it never changes which element an unambiguous step resolves to.
- **Mock site:** `/recorder-lab` gains a `duplicate-controls` scenario (two package cards with a
  shared checkbox accessible name + `Select package` button, plus a customer table repeating an
  `Edit` button per row) for compound + container reproduction.
- **Verified:** `npm run build` clean; `verify:recorder` **72/72** (adds CR1–CR4: duplicate role+name
  → unique locator + correct element; compound CSS; disabled-twin self-heal; equal-twins fail
  cleanly); `verify:runner` **82/82**; `verify:mock-site` **35/35**; `verify:flow-designer` **21/21**;
  `verify:recorder-flow` **13/13**; `verify:recorder-draft` **17/17**. Not run: clean-machine offline
  GUI walkthrough.

## Flow/Workflow Designer inspector no longer overflows the toolbar (2026-07-12)

- **Symptom:** on flush designers (Flow/Workflow), the right inspector drawer's top edge rose above the
  canvas into the in-canvas action bar when the window was narrow.
- **Root cause:** the flush drawer slot cleared the action bar with a fixed `padding-top` (~76px, a
  single-row assumption). `.flow-action-bar` wraps (`flex-wrap: wrap`), reaching ~106px at narrower
  widths, so the fixed offset was too small.
- **Fix:** `DesignerCanvasLayout` measures the live `.flow-action-bar` height (`ResizeObserver`) and sets
  `--awkit-action-bar-h` on the layout section; the drawer `padding-top` reads that var (old 76px kept as
  pre-paint fallback). Token-only, no markup changes.
- **Verified:** `npm run build` clean; Electron GUI check with the bar forced to wrap (106px) confirmed
  drawer top == action-bar bottom and drawer bottom == canvas bottom (no toolbar overflow).

## Flow Designer full-height canvas repair (2026-07-11)

- **Symptom:** with no properties inspector open, the graph canvas occupied only the upper half of the
  designer and left a large inert background below it.
- **Root cause:** `DesignerCanvasLayout` always rendered `.designer-right-drawer-slot`, even when its
  `rightPanel` was `null`. The no-panel layout has one grid column, so CSS auto-placed that empty second
  child into an implicit second row and stretched both auto rows equally. A stale `right-collapsed` class
  also reserved an unused 56px column when no panel existed.
- **Fix:** resolve the optional panel first, render the drawer slot only when a panel exists, and apply
  `right-collapsed` only to a populated panel. Default Form Designer properties remain supported when
  `rightPanel` is omitted; explicit `null` now produces a true single-child canvas layout.
- **Regression coverage:** the real Electron Flow Designer verifier clears selection and requires zero
  drawer slots plus canvas width/height equal to the complete designer rectangle.
- **Verified:** `npm run build`; `verify:flow-designer` **21/21**; `verify:canvas-perf` **13/13**;
  `verify:mock-site` **29/29**. At a 2048×1098 renderer viewport, designer and canvas both measure
  **1808×1002**, the engine reaches the bottom edge, and no renderer console errors occur.

## Critical Flow / Workflow Designer defect closure (2026-07-11)

Renderer and GUI-verifier only; no route, IPC, preload, runner, persisted-schema, or packaging change.

- **`originX` crash root-caused and fixed.** `FlowCanvas`'s pane pointer-move queued a React state
  updater that dereferenced mutable `panState.current`; pointer-up could clear the gesture before the
  updater ran. Pointer-move now captures the immutable gesture snapshot before scheduling state.
- **Fast node-drop race fixed.** Pointer-up could run before the last `setDrag` render, leaving the
  drop handler without a final position. The latest computed position now lives in the gesture ref and
  is consumed directly on pointer-up. This makes drag-to-connect independent of React commit timing.
- **Inspector no longer covers the graph.** A populated Flow Designer inspector owns a real layout
  column; the canvas viewport shrinks instead of rendering underneath it. If the selected node/edge is
  clipped by the narrower viewport, the engine pans only the required distance and restores that exact
  accommodation when the inspector closes. The collapsed state is wired to a 48px compact rail.
- **Connection confirmation matches the supplied reference.** The connect variant uses the branch icon,
  wide two-column content layout, curly-quote wording, and Cancel / Connect ordering while other shared
  confirmation dialogs retain their warning presentation.
- **Workflow toolbar is truly compact.** A legacy `.scenario-toolbar > div` selector was overriding the
  group flex layout and produced a measured 220px toolbar. The final cascade now keeps all four groups in
  one horizontally scrollable row; the real Electron measurement is 59px.
- **Verified:** `npm run build`; real Electron `verify:flow-designer` **20/20** (rapid pane lifecycle,
  hit-tested node drag, dialog geometry, inspector non-overlap and compact rail included);
  `verify:workflow-builder` **20/20**; `verify:canvas-perf` **13/13**; `verify:mock-site` **29/29**;
  `verify:settings-persistence` **3/3**. Canvas performance remains bounded: zoom = 0 node/edge
  rerenders, drag = dragged node only, static edge layer = one recomputation.

## Canvas UI fix pass — 9 reported issues (2026-07-11)

Renderer-only. No route/IPC/preload/runner/schema/packaging change. Reference for parity is the local
`Workflow` (flowforge) project. All verified on the real built Electron app.

1. **White screen (critical) — fixed.** There was **no error boundary**, so any render exception blanked
   the whole window. New `app/renderer/components/shared/ErrorBoundary.tsx` wraps `<ActivePage>` (keyed by
   route) — a crash now shows a readable fallback + Try again / Reload instead of a blank page, and logs
   the stack. This is a safety net; if a specific crash trigger is found later, fix it too.
2. **Edge insert "+" not working — fixed (real root cause).** The `.awkit-flow-nodes` container
   (`inset:0; z-index:2`, transparent) sat **above** the edge `+`/label overlay and silently ate the
   click (you could see the `+` through it). A **real** pointer click timed out; synthetic dispatch (used
   by the verifier) bypassed hit-testing, hiding the bug. Fix: `.awkit-flow-nodes { pointer-events: none }`
   + `.awkit-flow-node { pointer-events: auto }` — empty gaps let clicks reach the affordances beneath.
3. **Edge label text clipped — fixed.** The branch label and the `+` rendered at the same midpoint, so
   the `+` split the text ("If true" → "I…e"). `SmoothEdge` now offsets the label 18px above the line
   when an insert button is present.
4. **Drag-to-connect — implemented (flowforge parity).** The engine's `onNodeDragStop` now computes the
   largest-overlap node from the FINAL drop position and fires a new `onNodeConnect(source, target)`.
   Both designers show a **Connect these steps?** `ConfirmDialog`, skip already-linked pairs, orient
   top→bottom, and add the edge on confirm. Handlers read live nodes/edges from **refs** so the callback
   stays stable (else it re-creates each edit and re-renders every node wrapper — guarded by canvas-perf).
5. **Node size — fixed to 320px.** `.action-flow-node` / `.scenario-flow-node` were `width:100%` of an
   auto-width wrapper (content-driven, variable). Pinned to a fixed **320px** to match the reference.
6. **Parallel connector color — distinct.** New `--awkit-connector-parallel` (teal `#0ea5a4` light /
   `#2dd4bf` dark); `connectorStyle.ts` maps `parallel` to it (was the default violet).
7. **Right drawer covering nodes — fixed (Flow Designer).** Superseded by the critical defect closure
   above: the inspector now owns a real layout column and cannot overlay the canvas; a bounded pan reveals
   a selected item only when the resized viewport would clip it.
8. **(see #1).**
9. **Sidebar nav group animation — smoothed.** `.nav-group-items` switched from a fixed `max-height`
   (overshoots → looked abrupt) to the `grid-template-rows: 0fr→1fr` accordion (animates to exact content
   height); requires the added `.nav-group-items-inner` wrapper.

Toolbar (Issue 2 continued): the Workflow Builder toolbar is now a single low row — inline labels +
`overflow-x` scroll instead of tall wrapping.

- **Verified (real Electron):** build clean; edge `+` opens the picker on a **real** click; drag start→end
  shows the confirm dialog and creates the edge on confirm; no white screen (root renders). Regression:
  `verify:flow-designer` 14/14, `verify:workflow-builder` 18/18, `verify:canvas-perf` 13/13 (a mid-run
  perf regression from a non-stable connect callback was found and fixed via refs).

## Workflow Builder UI functionality/organization pass (2026-07-11)

## Workflow Builder UI functionality/organization pass (2026-07-11)

Renderer-only follow-up on the two node editors + one measurement script. No route/IPC/preload/
runner/schema/packaging change; saved documents and connector runtime semantics unchanged. Focus:
the reported Add-menu, toolbar, selection, and connector-drag issues in the Workflow Builder /
Workflow Designer.

- **Add menu now has a "Flow Logic" section** (`app/renderer/pages/ScenarioBuilder.tsx`): the
  contextual picker (blank right-click, edge `+`, leaf `+`, toolbar **Add**) lists **Conditional
  Branch / Parallel Branch / Loop** above **Saved Flows** — previously it only listed saved flows
  (the Flow Designer already had a Logic group; the Workflow Builder did not). These map onto AWKIT's
  existing connector kinds via new `applyWorkflowLogic()`: Conditional/Parallel branch the **selected**
  flow to up to two available saved flows with `conditional`/`parallel` connectors (labels If true/
  If false · Branch A/Branch B; the new connector opens in the drawer for editing); Loop toggles the
  node's self-loop connector (same edit as the kebab). A valid source flow is required — otherwise a
  toast guides the user and **no invalid/disconnected graph is created**.
- **Toolbar reorganized into labeled groups** (`.sb-toolbar-group` + `.sb-toolbar-sep` in `global.css`):
  **Workflow** (select · name · New · Reload · Settings · Export) │ **Add** │ **Execution** (mode ·
  parallel) │ **Layout** (Auto-arrange) │ right-aligned **status** (validation chip · save state).
  Save/Run stay in the top app header; zoom/fit stay in the canvas zoom pill (no duplicates). Stale
  Auto-arrange tooltip fixed ("top-to-bottom", matching the actual `direction: "TB"` layout).
- **On-canvas selection is now visible (both designers).** `ScenarioBuilder` and `FlowChartDesigner`
  never set `CanvasNode.selected`/`CanvasEdge.selected`, so clicking a node/connector opened the
  properties drawer but **never applied the `.selected` / `.is-selected` highlight** (the CSS existed).
  Both now fold selection into the node identity signature (so only the affected cards rebuild) and set
  `edge.selected`. Canvas-perf guard still green (editing one node = 3 card re-renders).
- **Connector-drag (Issue 1) revalidated + measurement harness fixed.** The `DraggingEdgeLayer`
  edge-follow was already correct; `scripts/measure-large-graphs.mjs` now **fits the view and drags the
  visible middle node nearest the canvas center** (was: first `n-*` in DOM order, which could be
  off-screen). Measured real Electron 40/100/200/500: drag re-renders **only the dragged node (20 for
  20 moves) and recomputes the static edge layer once** at every size (O(1) in graph size); zoom = 0
  re-renders; load 0.31/0.55/0.70/1.33 s; heap flat 21 MB (no leak, DOM 5779→5779).
- **Workflow Designer is intentionally read-only** (confirmed from code: `nodesDraggable={false}`,
  "read-only overview" copy, "Edit workflows in the Workflow Builder"). It exposes no misleading edit
  buttons and correctly has no Add menu — left as-is.
- **Verified:** `npm run build` clean; `verify:workflow-builder` **18/18** (adds Flow Logic section +
  Conditional/Parallel/Loop reachability + selection-highlight + Loop-creates-self-loop checks);
  `verify:flow-designer` 14/14; `verify:canvas-perf` 13/13; `verify:write-queue` 7/7;
  `verify:settings-persistence` 3/3; `verify:reports` 26/26; large-graph measurement green.

## UI performance — Phase 2 (2026-07-11)

## UI performance — Phase 2 (2026-07-11)

Follow-up to the Phase 1 canvas pass (below). Renderer changes plus `app/main/uiSettings.ts` +
`app/main/writeQueue.ts` + `app/main/main.ts`. No route/IPC/preload/runner/schema/packaging change;
saved documents and connector runtime semantics unchanged.

- **Node-edit re-render fix (biggest remaining win):** the designers derived the canvas node array with
  a plain `.map`, rebuilding every node's wrapper on any edit → editing one node re-rendered the whole
  graph. New `app/renderer/components/canvas/identityMap.ts` (`mapWithIdentity`) preserves per-node
  output identity (per-id cache keyed by source ref + a derived signature, pruned each pass, version-busted
  when shared callbacks change). Both designers use it. **Editing one node's name on a 40-node flow: 120 →
  3 card re-renders.**
- **Edges follow the dragged node again** (they snapped on drop after the React Flow removal): `FlowCanvas`
  tracks the live drag position (rAF-batched) and draws ONLY the dragged node's edges in a
  `DraggingEdgeLayer` overlay; the memoized `EdgeLayer` recomputes once at drag start (not per frame) and
  skips those edges. Cost is O(edges touching the dragged node), independent of graph size.
- **Settings persistence is now crash-safe and shutdown-safe:** the serial queue lives in the testable
  `app/main/writeQueue.ts` (`createSerialQueue`; FIFO, a failed write never poisons the next, `flush()`);
  `writeSettings` writes to a temp file then atomically renames over the target (Windows-safe); and
  `flushSettingsWrites()` runs on Electron `before-quit` (bounded 2s, guarded against re-entry/deadlock)
  so an edit made just before closing the window is not lost.
- **Large-graph glide guard:** the auto-arrange/load "glide" animates every node's `left`/`top`; above
  `GLIDE_MAX_NODES` (120, `app/renderer/lib/motion.ts`) it is skipped so large graphs snap instead of
  thrashing layout.
- **Measured on real Electron (40/100/200/500 nodes):** zoom re-renders **0 at every size**; load
  ~0.30/0.48/0.70/1.23 s (linear — measurement is O(N), not O(N²)); save 10–45 ms; a 10× in-session
  Flow⇆Workflow navigation leak check held heap 14→14 MB and DOM 5645→5645 (no accumulation). Tool:
  `scripts/measure-large-graphs.mjs`.
- **Regression guards added:** `npm run verify:write-queue` (7/7, unit `tsx`), `npm run
  verify:settings-persistence` (3/3, real Electron: 40 concurrent patches all persist, no leftover tmp
  files, before-quit flush), and `verify:canvas-perf` extended to 13/13 (adds node-edit-identity and
  edge-follow assertions).
- **Panels/listeners audit (no code change needed beyond the above):** the Node Palette picker unmounts
  when closed and memoizes its filter; Node/Connector Properties panels unmount when nothing is selected
  and collapse to a cheap rail; every `setInterval`/`ResizeObserver`/`addEventListener` has matching
  cleanup — no leaks found.
- **Verified:** build clean; write-queue 7/7; settings-persistence 3/3; canvas-perf 13/13;
  flow-designer 14/14; workflow-builder 14/14; reports 26/26; waits 21/21; data-editor 27/27;
  recorder 57/57; runner 82/82; instance-monitor 22/22; mock-site 29/29; ai:memory pass.

## Canvas UI performance pass (2026-07-11)

Renderer-only (plus one main-process file) optimization of the in-house canvas engine. No route,
IPC, preload API, runner/runtime, profile schema, or storage/packaging change; saved document shape
and all connector runtime semantics are unchanged.

- **Symptom:** panning, zooming, node interactions, and even typing a flow/workflow name felt laggy
  on non-trivial graphs.
- **Root cause (measured on a 40-node flow via a render probe):** the engine re-rendered **every**
  node card + edge layer on **every** viewport frame — zoom of 20 wheel ticks = 800 NodeContainer +
  800 card + 20 EdgeLayer renders — and typing 16 chars in the Flow Name field = 1280 node + 1280
  card renders. `NodeContainer`/`EdgeLayer` were unmemoized, and the designers passed inline
  callbacks to `<FlowCanvas>` (new refs every render defeated any memo).
- **Fixes:** `FlowCanvas.tsx` now memoizes `NodeContainer` (renders the node component internally,
  not via `children`, and reads zoom from `viewportRef` — so viewport-only changes never invalidate
  the memo) and `EdgeLayer`; `FlowChartDesigner.tsx` and `ScenarioBuilder.tsx` pass **stable**
  `useCallback` handlers; `app/main/uiSettings.ts` serializes all settings writes through a promise
  queue (no more racing read-modify-write on the many fire-and-forget `settings.update` calls).
- **After (same measurements):** zoom = 0/0/0, typing = 0/0/0, dragging one node re-renders only that
  node (20 for 20 moves, not 800) and never the edge layer during motion.
- **Regression guard:** opt-in `app/renderer/components/canvas/renderProbe.ts` +
  `npm run verify:canvas-perf` (`scripts/verify-canvas-perf.mjs`, 10/10) — structural (not timing)
  assertions, robust across machines.
- **Verified:** `npm run build` clean; `verify:canvas-perf` 10/10; `verify:flow-designer` 14/14;
  `verify:workflow-builder` 14/14; `verify:reports` 26/26.

## Canvas engine — React Flow removed (2026-07-11)

The three canvases no longer use React Flow (`@xyflow/react`). They render on a small **in-house canvas
engine** at `app/renderer/components/canvas/` (see `index.ts` barrel). Renderer-only change — no route,
IPC, preload API, runner/runtime, profile schema, or storage/packaging behavior changed. The saved
document shape and all connector *runtime* semantics (kinds/config, `validateConnectorStructure`,
orchestration) are unchanged; only the rendering layer was replaced.

- **Engine:** `FlowCanvas.tsx` provides viewport pan/zoom (CSS transform), node drag (position measured
  from the DOM via `ResizeObserver`), an SVG smooth-step edge layer (`geometry.ts` is a faithful port of
  React Flow's `getSmoothStepPath`/`getViewportForBounds` math), a dotted `Background`, fit-view, and
  screen↔flow mapping. `useCanvas()`/`useViewport()` hooks + a `FlowCanvasHandle` imperative ref
  (`fitView`/`zoomTo`/`screenToFlowPosition`) replace the old `useReactFlow`/`useViewport`. Edge labels
  and the insert `+` render through `BaseEdge`/`EdgeLabelRenderer` portaling into an in-transform HTML
  overlay. The flow runs **top→bottom**: every edge leaves a node's bottom-center and enters the next
  node's top-center; a self-loop is `source === target` and draws via `LoopEdge`.
- **DOM (for verifiers / future work):** node cards are `.awkit-flow-node[data-id]` (wrapping the
  existing `.action-flow-node`/`.scenario-flow-node`/`StepNode` markup); connectors are
  `g.awkit-flow-edge[data-source][data-target]` with `path.awkit-flow-edge-path`; the insert affordance
  is `.awkit-edge-add`; the pane is `.awkit-flow-canvas`. There is **no** `.react-flow__*` DOM, no
  handles/ports, and no `data-handleid`.
- **Intentionally removed** (user chose "adopt flowforge nodes as-is"): node resize (`NodeResizer`),
  branch-port dragging + the two-port branch model, edge reconnect, and port-drag-to-connect.
  Connections are made via the `+` insert / leaf append / Logic picker; loop is toggled from the node
  kebab menu. `connectorStyle.ts` still exports the old port helpers (`computePortFlags`,
  `reconcileBranchConnectors`, `portHandlesForKind`, `branchSourceHandle`, `portPositions`,
  `ConnectorPortFlags`) but they are now **unused** by the canvases (safe future cleanup).
- **Deleted files:** `shared/TemplateSmoothEdge.tsx`, `shared/SelfLoopEdge.tsx`,
  `shared/ConnectorPorts.tsx`, `workflow/CanvasZoomControl.tsx`. `@xyflow/react` removed from
  `package.json` (still present in `package-lock.json` + `node_modules` until `npm install` is run).
- **Verified:** `tsc --noEmit` clean; `electron-vite build` clean (renderer bundle 1,589 → 1,235 kB,
  ~355 kB smaller); real-Electron `verify:flow-designer` **14/14** and `verify:workflow-builder`
  **14/14** (both rewritten against the new DOM).
- **Supersedes** the renderer half of the "Structured connectors (Checkpoint B)" section below: its
  descriptions of visible ports, `useUpdateNodeInternals`, branch-pair handles, `SelfLoopEdge`, and
  `.react-flow__*` rendering are now historical. The connector *runtime* behavior it documents still holds.

## Workflow.rar UI migration (2026-07-11, Phases 0-6)

## Workflow.rar UI migration (2026-07-11, Phases 0-6)

Completed the local `AWKIT-Workflow-UI-Migration-Prompt-Pack` pass against the verified
`Workflow.rar` source (SHA-256 `9b3320b609e12da1032a94d4e156389e06f0e4315bc6983e0e76b18909795946`).
The existing Hologram reskin already covered most non-editor pages; this pass closed the remaining
structural and interaction gaps.

- **Shell:** expanded sidebar 240px, header 64px, exact reference canvas/theme tokens, collapsible
  navigation groups, and pre-paint theme bootstrap via a persisted local mirror.
- **Flow Designer:** permanent Node Palette unmounted. The shared 340px searchable picker opens from
  blank-canvas right-click, edge `+`, leaf `+`, and Add Node; all real non-sentinel catalog types remain.
  Existing node/connector forms render in the 400px overlay drawer. New empty flow state is `Start -> End`.
- **Workflow Builder:** permanent Workflow Definition/rails unmounted. The contextual picker adds real
  saved flows through blank canvas, edge insertion, leaf append, and Add Flow, retaining Load More.
  New workflows persist structural Start/End nodes plus their default edge. Flow, connector, and workflow
  settings use the overlay drawer.
- **Compatibility/runtime:** `WorkflowProfile.nodes` is a backward-compatible union of flow references
  and structural sentinels. Runtime conversion filters sentinels/boundary edges, so only real flows reach
  orchestration. Existing workflows load unchanged. IPC, preload, recorder, waits/locators, sessions,
  instances/reports, and packaging contracts are unchanged.
- **Evidence:** 32 route screenshots (8 routes x light/dark x 1600x1000/1366x768) plus light/dark picker
  and drawer states under `docs/ai/ui-reskin-template-plan/mockups/screenshots/workflow-migration-*`.
- **Verified:** build; Flow Designer 24/24; Workflow Builder 21/21; workflow sentinels 4/4;
  mock site 29/29; Recorder 57/57;
  recorder draft 17/17; recorder flow 13/13; Smart Wait 21/21; runner 82/82; data editor 27/27;
  instance monitor 22/22; Reports 26/26; offline validator pass. Final GUI counts are recorded in the
  completion report. Clean offline VM install/uninstall and code signing remain external release gates.

## Workflow/FlowForge visual parity (2026-07-10, Phases 0-5)

Renderer/CSS-only adoption of the Workflow/FlowForge ("Hologram") reference style + animations
(plan: `docs/plan-workflow-visual-parity.md`). No runner/orchestrator, IPC, preload API, or
profile-schema change. The two apps are siblings (same violet `#7c3aed`, same `[data-theme]`
theming), so most parity pre-existed — the work was targeted gaps plus a motion library.

- **framer-motion** `11.18.2` added (dep + offline manifest line). New motion primitives live in
  `app/renderer/lib/motion.ts` (springs, variants, `hoverTap`/`hoverLift`, `usePrefersReducedMotion`,
  `useFlowGlide`); all motion is reduced-motion aware (framer gated + the global CSS neutralizer).
- **Tokens:** `--awkit-edge`/`-strong`, `--awkit-shadow-node`/`-hover` added to both themes.
- **Canvas:** auto-layout **glide** (`.flow-animating`) in both node editors. Handles stay **visible**
  (AWKIT's deliberate ConnectorPorts design — not hidden like the reference).
- **Nodes:** `ActionFlowNode`/`ScenarioFlowNode` are `motion.article` (spring mount + hover-lift);
  hover-reveal kebab; elevation via the new shadow tokens. Old CSS node mount-fade removed (framer owns it).
- **Chrome:** animated sidebar collapse (`grid-template-columns` transition). Sidebar pill, theme
  toggle, page-enter, drawer slide-ins, button feedback already existed.
- **Pages:** card-grid **stagger** on `.page-grid` (`awkit-card-rise`, `backwards` fill so hover survives).
- **Verified:** `npm run build` ✅; GUI verifiers **58/58** (`verify:flow-designer` 19, `verify:workflow-builder`
  13, `verify:reports` 26). Renderer JS 1.29→1.54 MB (framer-motion DOM engine). Not run: clean-machine
  offline GUI walkthrough; manual reduced-motion/dark-theme eyeball still worthwhile.

## Canvas UX pass (2026-07-10, SRS-CANVAS-UX-001)

Renderer/CSS-only follow-up on the two node editors (spec: `docs/SRS_CANVAS_UX.md`). No runner/
orchestrator, IPC, preload, or profile-schema change; loop **runtime** semantics untouched.

- **Auto-layout (anti-stacking):** `app/renderer/components/shared/graphLayout.ts` — dependency-free
  cycle-safe layered layout. Both editors auto-arrange on load **only** when node positions are missing/
  stacked (fixes flows saved without positions collapsing onto `{280,120}`); manual layouts are preserved
  and persisted zoom survives normal loads (`fitView` runs only when a rearrange happened). A manual
  **Auto-arrange** toolbar button (TB in Flow Designer, LR in Workflow Builder) force-runs it.
- **Connector "+":** the inline midpoint add button (`TemplateSmoothEdge`) now works in **both** editors.
  Workflow Builder splices the first unused saved flow onto the clicked edge (`insertFlowOnEdge`) via a
  display-only `edgesForCanvas` map (never serialized). Button restyled to the reference art (always-
  visible white circle, subtle border, violet "+").
- **Dotted canvas:** light `--awkit-canvas-dot` darkened to `#c7c0d6` so the grid is perceptible.
- **Motion:** opacity-only mount fade for node cards + edges (never transform the measured RF wrapper),
  `:active` press on toolbar/icon buttons; all under the existing reduced-motion neutralizer.
- **Verified:** `npm run build` (tsc + bundles). Not run: `verify:runner`/mock-site (no runner change),
  clean-machine GUI walkthrough — visual conformance of branch connectors still to eyeball in-app.

## UI re-skin initiative — CLOSED (Phases 01-15, 2026-07-09)

The Hologram UI/UX re-skin initiative (downloaded prompt pack `01`–`15`) is complete. It was a
**renderer/CSS-only** program — no route, IPC, preload API (`window.playwrightFlowStudio`), runner/
runtime, profile schema, storage contract, or offline/packaging behavior was changed at any point.

**New UI/CSS architecture (for future agents):**
- **Single design-token system** in `app/renderer/styles/global.css`: a complete light token set under
  `:root`/`[data-theme="light"]` with a full `[data-theme="dark"]` override. All color/spacing/radius/
  shadow/motion resolve through tokens — `var(--awkit-*)` (surfaces, text, accent family incl.
  `--awkit-accent-rgb`, status ×soft/muted, canvas bg/dot, node, overlay, focus ring), `--space-*`,
  `--radius-{sm,md,lg,pill}`, `--awkit-shadow-{soft,card,float,hover}`, and motion
  `--awkit-motion-*`/`--awkit-dur-*`/`--awkit-ease-out`. The theme attribute is applied to `<html>` by
  `App.tsx` from the persisted `UiSettings.appearance` (`theme.tsx` context, OS-sync in system mode).
- **App shell** is a fixed grid: `.app-shell` = `260px minmax(0,1fr)` (76px collapsed) wrapping the
  full-height left `LeftNavigation` + `.app-main` (`60px 1fr 32px` → header / scrolling content /
  status bar). **Do not modify `.app-shell`/`.app-main` grids without explicit permission.**
- **React Flow** surfaces are theme-driven: dotted `BackgroundVariant.Dots` colored via
  `--awkit-canvas-dot`, RF `--xy-*` vars set for minimap/controls, node cards / connectors / floating
  config drawer / bottom zoom pill all tokenized. Visual changes to RF components must use the
  established classes/tokens in `global.css`; never animate node width/height/left/top (canvas
  coordinate + perf invariant).
- **Reusable base components** (do not build parallel systems): global `input/select/textarea`,
  `.toolbar-button` (primary/secondary + `:active`), `.awkit-table` + legacy `.wl-table`/
  `.instance-table` (uppercase muted headers, row hover), `.modal-overlay`/`.modal-dialog` (blurred
  backdrop, float shadow, `awkit-fade-in`/`awkit-pop-in` entrance), `MetricCard`, `EmptyState`,
  `SkeletonCard`, `StatusBadge`. Motion is transform/opacity-only and sits above a last-in-cascade
  `@media (prefers-reduced-motion: reduce)` neutralizer.
- **Enforced rules** (added this phase): `docs/ai/RULES.md` › UI now mandates token use (no hardcoded
  hex / arbitrary px), the app-shell-grid lock, and the a11y/focus/semantic-HTML rules; `AGENTS.md`
  carries the summary. New-component reviewers should check these.

**Phase 13 (Dark mode + a11y) — verified, no code change needed.** Audit + dark-mode screenshot
walkthrough (Dashboard, Reports, Flow Designer) confirmed the `[data-theme="dark"]` block already
meets the phase standards: deep slate `--awkit-bg #0e0d12` (not pure black), elevated surfaces
(`#16151c`→`#201f28`), off-white text `#f3f1f8` (not pure white), brighter accent `#8b5cf6`, inverted
canvas dots. Focus rings present via global `:focus-visible` (box-shadow ring alternative to
`outline`); interactive controls use semantic `<button>`. No token edits were warranted.

**Phase 14 (Visual QA) — golden snapshots captured.** 8 light + 8 dark baseline screenshots via
`scripts/capture-ui-screenshots.mjs` in
`docs/ai/ui-reskin-template-plan/mockups/screenshots/{golden,golden-dark}/`; a manual QA checklist +
the light/dark capture recipe were added to `docs/ai/TESTING.md`. No `toHaveScreenshot` regression
tests were added (no `npm test` script; `@playwright/test` Node caveat; dynamic data → flaky) —
documented rationale in TESTING.md.

**Phase 15 (Handoff/doc sync) — this entry** plus `TASK_LOG.md` consolidated entry and the new
`RULES.md`/`AGENTS.md` UI rules. Initiative officially closed; the codebase is ready for future
feature work on top of the token system.


## Phase 09-12 gap-based UI polish (2026-07-09)

Executed the downloaded `09_INSTANCES_AND_WORKFLOW_CARDS.md`, `10_REPORTS_AND_ANALYTICS_UI.md`,
`11_FORMS_TABLES_MODALS_AND_EMPTY_STATES.md`, and `12_MOTION_AND_MICRO_INTERACTIONS.md` prompts as a
**gap-based polish pass** (audit-first; close only genuine gaps; reuse existing tokens/classes; no
parallel systems). Renderer CSS-only; no route, IPC, preload API, runner/runtime, schema, state, or
persistence behavior changed. Audit found the repo already ~95% satisfies all four phases from prior
re-skin passes (motion tokens, reduced-motion neutralizer, focus-visible rings, modal overlay/dialog
with `awkit-fade-in`/`awkit-pop-in` entrance, tokenized SVG charts/gauges with no hardcoded hex,
semantic status badges, tokenized `input/select/textarea`, uppercase primary-table headers,
`MetricCard`/`EmptyState`/`SkeletonCard`).

- **Four small `global.css` edits:** `.workflow-card:hover/:focus-within` now adds
  `transform: translateY(-2px)` (Phase 09 subtle lift; transform-only, no grid reflow, reduced-motion
  snaps it); `.modal-overlay` gains `backdrop-filter: blur(3px)` for a blurred backdrop across
  ConfirmDialog / UnsavedChangesDialog / LiveExecutionReportModal (Phase 09/11); `.modal-dialog`
  radius `10px → var(--radius-lg)` (Phase 11 token alignment; `.report-modal` inherits it);
  `.awkit-table th` (report tables) now `text-transform: uppercase` + `letter-spacing` + soft-bg to
  match the established `.wl-table`/`.instance-table` header convention (Phase 10/11 consistency).
- **Deliberately not done (documented):** no new `.awkit-input/.awkit-select/.awkit-button` classes
  (global element rules + `.toolbar-button` already cover forms/buttons — adding them would be a
  parallel/dead system); no rewrite of the duration-based reduced-motion neutralizer to
  `transition:none` (existing approach is intentional and working). Noted for future cleanup: the
  `.workflow-run-card` selectors (~lines 7615/7626) appear unused — the component renders
  `.workflow-card`.
- **Verified:** `npm run build` pass (tsc --noEmit + electron-vite bundles); `verify:reports` 26/26;
  `verify:instance-monitor` 22/22 (both after `node scripts/helpers/reset-ui-state.mjs`).
  `verify:runner` not run (no runner/runtime logic touched). All edits use theme-aware tokens
  (light/dark correct); the new hover transform is auto-covered by the last-in-cascade reduced-motion
  block.

## Phase 03-08 UI execution pass (2026-07-09)

Executed the downloaded `03_APP_SHELL_AND_NAVIGATION.md` through `08_RECORDER_UI_REDESIGN.md` prompts in
order. Renderer/UI-only pass; no route, IPC, preload API, recorder service, runner, profile schema,
storage contract, dependency, or build-process behavior changed.

- **Shell/navigation:** preserved the existing `AppShell`, `LeftNavigation`, and `TopHeader` structure while
  pinning the sidebar to full viewport height, routing nav hover/active states through neutral/lavender
  tokens, and switching the bottom-center zoom pill to the tokenized soft shadow.
- **Canvas/node/inspector/library surfaces:** React Flow dot backgrounds now use the requested subtle
  `gap={24}` / `size={1}` across Flow Designer, Workflow Builder, and Workflow Designer. Existing node-card
  anatomy, connector handles, `NodeResizer`, right inspector/property panels, AI/palette search, work panels,
  tables, and empty-state behavior were preserved.
- **Recorder UI:** `Recorder.tsx` is now a tokenized, class-based control-center layout with a sticky
  recorder control bar, grouped switches, active recording status, disabled URL/flow-name inputs while
  recording, protected-login handoff panel styling, an auto-scrolling action timeline with per-action
  icon/tone/locator/value/smart-wait details, inline save feedback, and a restyled recorded-URLs section.
  Existing recorder IPC calls, polling, protected-login handoff handlers, URL history, and
  `recorder.saveFlow()` behavior were preserved.
- **Verified:** `npm run typecheck` pass; `npm run build` pass; `verify:flow-designer` 19/19 after the
  documented `node scripts/helpers/reset-ui-state.mjs flowChart false` state reset (the first raw run timed
  out waiting for `.action-flow-node` because persisted UI state opened Workflow Builder with the sidebar
  collapsed); `verify:workflow-builder` 13/13 after reset; `verify:recorder` 57/57; `verify:recorder-flow`
  13/13. `verify:runner` was not run because runner/runtime automation logic was untouched.

## Phase 01/02 UI audit + token foundation compatibility pass (2026-07-09)

Executed the downloaded `01_REPO_UI_AUDIT.md` then `02_DESIGN_TOKENS_AND_THEME.md` prompts against the
current repo state. Renderer/CSS-only follow-up; no route, IPC, schema, runner, automation, dependency,
or build-process behavior changed.

- **Phase 01 audit result:** current source is already past the original baseline prompt. `global.css` is
  a large single stylesheet with a complete Hologram-style light token block and dark override; `AppShell`
  keeps the full-height left sidebar plus `.app-main` header/content/status grid; Flow Designer,
  Workflow Builder, and Workflow Designer use React Flow `BackgroundVariant.Dots`, `Controls`, and the
  shared connector/zoom/template-edge components. This pass did not alter the existing React Flow
  background configuration.
- **Phase 02 token pass:** added the missing compatibility tokens requested by the prompt while preserving
  the existing `--awkit-*` system: `--radius-md: 12px`, new `--radius-lg: 16px`, light/dark
  `--awkit-lavender-soft`, light/dark `--awkit-shadow-soft` with `--shadow-soft` alias, and
  `--awkit-node-selected-bg` now resolves through the lavender token.
- **Verified:** `npm run build` pass; `verify:flow-designer` 19/19; `verify:workflow-builder` 13/13.
  `verify:runner` was not run because runtime automation logic was untouched.

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
