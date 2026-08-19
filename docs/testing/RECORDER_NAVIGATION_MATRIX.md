# Recorder navigation & multi-page regression matrix

Closes the formalisation half of `awkit-9qj`, carved out of `awkit-n7n` (the Recorder hardening
brief, sections 19–20).

**What this document is.** One row per navigation/multi-page behaviour the Recorder is expected to
get right, each naming the verifier that owns it and the current status. It is a map of existing
coverage, not a to-do list — the substantive engineering closed with `awkit-n7n`.

**What it is not.** It is not a transcription of the brief's own numbering. The brief is not in the
repository, so the rows below were reconstructed from the behaviours it enumerated plus the actual
verifier inventory. Where a row's owner was found by reading a verifier's assertions, that is stated;
nothing here is marked covered on the strength of a file merely existing.

**How to use it.** Before adding a navigation test, find the row. Most already have a passing owner,
and a second test asserting the same thing in a different file is how two places to update become one
place that silently rots.

## Status vocabulary

Matches the validation ledger (`tools/roadmap/lib/parse-ledger.mjs`): **PASS**, **NOT RUN**,
**NOT APPLICABLE**. A row is PASS only if a named verifier asserts it and that verifier has been run.

---

## A. URL capture — the transition kinds (11)

| # | Behaviour | Owner | Status |
|---|---|---|---|
| A1 | The opening document navigation is recorded | `verify:recorder-navigation` | PASS |
| A2 | A full document navigation (`goto`) is recorded | `verify:recorder-navigation` | PASS |
| A3 | A **link click** navigation is recorded | `verify:recorder-navigation` (navigation lab) | PASS |
| A4 | A **form submit** navigation is recorded, with its query string | `verify:recorder-navigation` (navigation lab) | PASS |
| A5 | A **server 302 redirect** records its FINAL destination | `verify:recorder-navigation` (navigation lab) | PASS |
| A6 | The intermediate redirect hop is **not** recorded | `verify:recorder-navigation` (navigation lab) | PASS |
| A7 | `pushState` is recorded, query preserved — driven by the test | `verify:recorder-navigation` | PASS |
| A8 | `pushState` is recorded when called by the **page's own script** | `verify:recorder-navigation` (navigation lab) | PASS |
| A9 | `replaceState` is recorded, query preserved (both drivers) | `verify:recorder-navigation` (+ navigation lab) | PASS |
| A10 | A hash change is recorded and keeps its fragment (both drivers) | `verify:recorder-navigation` (+ navigation lab) | PASS |
| A11 | A hash-only move stays distinguishable from its base URL | `verify:recorder-navigation` | PASS |

Rows A3–A6 and A8 exist only because of the navigation lab: a test cannot fake a link click, a form
submit or a redirect, and an `evaluate`-injected `pushState` is a call the *test* makes. A `history`
wrap installed too late or into the wrong world would satisfy A7 and still miss every real router.

## B. De-duplication and noise (6)

| # | Behaviour | Owner | Status |
|---|---|---|---|
| B1 | Revisiting a known URL adds no duplicate record | `verify:recorder-navigation` | PASS |
| B2 | Back adds no new record when the destination was visited | `verify:recorder-navigation` (+ lab button) | PASS |
| B3 | Forward adds no new record | `verify:recorder-navigation` (+ lab button) | PASS |
| B4 | Reload adds no new record (same URL) | `verify:recorder-navigation` (+ lab button) | PASS |
| B5 | `about:blank` is never recorded | `verify:recorder-navigation` | PASS |
| B6 | The recorded set is EXACTLY the expected destinations, no extras | `verify:recorder-navigation` | PASS |

B6 is the row that keeps B1–B5 honest: every "adds no new record" check is also satisfied by a
capture path that stopped recording altogether, so the exact-set assertion is load-bearing.

## C. Navigation → flow representation (5)

| # | Behaviour | Owner | Status |
|---|---|---|---|
| C1 | An **independent** navigation produces a `goto` step | `verify:recorder-navigation` | PASS |
| C2 | The opening navigation does not get a duplicate `goto` step | `verify:recorder-navigation` | PASS |
| C3 | An **action-caused** navigation gains no extra step | `verify:recorder-navigation` | PASS |
| C4 | `buildRecordedFlow` takes actions only and never sees `recordedUrls` | `verify:recorder-navigation` | PASS |
| C5 | The initial `goto` becomes the flow's single navigation step | `verify:recorder-navigation` | PASS |

C3/C4 encode the brief's preference for navigation metadata on the triggering action over redundant
Navigate steps. C4 is the boundary that is easiest to lose by accident: URL history is not replay.

## D. Action capture around navigation (6)

| # | Behaviour | Owner | Status |
|---|---|---|---|
| D1 | Per-keystroke input coalesces into one `fill` | `verify:recorder-navigation` | PASS |
| D2 | A change/blur echo after `Tab` is dropped | `verify:recorder-navigation` | PASS |
| D3 | A re-fill after a clear **click** is kept | `verify:recorder-navigation` | PASS |
| D4 | A re-fill after `Backspace` is kept | `verify:recorder-navigation` | PASS |
| D5 | An identical value on a different field is kept | `verify:recorder-navigation` | PASS |
| D6 | Capture survives an SPA route change + full DOM replacement | `verify:recorder-competitive` (section I) | PASS |

## E. Multi-tab and popup identity (6)

| # | Behaviour | Owner | Status |
|---|---|---|---|
| E1 | A popup opened by `window.open`/`target=_blank` is registered | `verify:popup` | PASS |
| E2 | Popup identity is its FINAL url, not its creation-time url | `verify:popup-identity`, `verify:popup-mock-site` (J1/J2) | PASS |
| E3 | A popup's own history changes belong to the popup, never the opener | `verify:popup-mock-site` (J3) | PASS |
| E4 | Two popups sharing a `<title>` do not collapse to one identity | `verify:popup-mock-site` (J4) | PASS |
| E5 | Open order does not decide identity (reversed order resolves alike) | `verify:popup-identity` | PASS |
| E6 | A timer-opened popup with no click still gets a stable alias | `verify:popup-identity` | PASS |

## G. Multi-page switching (4)

| # | Behaviour | Owner | Status |
|---|---|---|---|
| G1 | Three pages (opener + two popups) hold three distinct identities | `verify:popup-identity` (Suite 8b) | PASS |
| G2 | A control belonging to another page does not resolve under an alias | `verify:popup-identity` (Suite 8b) | PASS |
| G3 | Non-adjacent switching opener → second → first → opener reaches each page | `verify:popup-identity` (Suite 8b) | PASS |
| G4 | Closing one popup leaves its sibling and the opener addressable | `verify:popup-identity` (Suite 8b) | PASS |

Three pages is where identity stops being a coin flip: with two, a bug that simply picks "the other
page" still looks correct half the time. G2 and G3 are deliberately a pair — G2 proves foreign
controls do **not** resolve, G3 proves own controls **do**. Neither alone is sufficient, because a
registry that failed everything would satisfy G2 and one that resolved everything would satisfy G3.

Ordering trap worth keeping: the fixture's action buttons call `window.close()`, so checking
isolation *after* clicking a page's own control passes for free — the page is gone. Isolation runs
first, while every page is demonstrably open.

## H. Pointer gesture semantics — double-click and context menu (18)

This section used to be titled *Declared limitations*, and H1/H3 were **known-gap sentinels**:
assertions that held only while the recorder lost these two interactions. They are now ordinary
positive assertions, which is the only honest end state — a sentinel that keeps passing is a defect
that keeps shipping. The gap closed on 2026-08-19 (`awkit-bxyo`); the history is kept below because
the measurement that framed the model is still the reason the model looks the way it does.

### What was wrong, measured through the real capture path

```text
double-click  page fired dblclick    → recorder stored 2 click actions
right-click   page fired contextmenu → recorder stored 0 actions
single click  (control)              → recorder stored 1 action
```

Two clicks replayed with a gap between them do not reliably re-fire `dblclick`, so a
double-click-driven UI recorded but did not faithfully replay; a right-click was dropped with no step
and no warning.

### Native context menu — replayability, measured 2026-08-19

Before building capture, the question that decides the model: is a **native** browser context menu
replayable? Probed in headless and headed Chromium, which agreed exactly.

```text
page-owned handler + preventDefault   contextmenu fires, handler runs  -> replayable
no preventDefault (native menu)       contextmenu fires, handler runs  -> replayable
                                      DOM node count unchanged (8)     -> menu is browser chrome
                                      NEXT ordinary click succeeded    -> nothing is poisoned
```

**The decisive line is the last one.** A synthetic right-click does not leave a blocking native menu,
so a recorded right-click cannot corrupt every step after it. That was the risk that would have made
the interaction unsafe to replay, and it does not exist — so `contextMenu` is an ordinary executable
step, not a captured-but-non-executable one. H9 re-proves that property at replay rather than
trusting the probe.

What the model must never claim is the contents of the menu: if a user physically right-clicks while
recording, whatever they choose from the OS-level menu — open link in new tab, copy, save as — is
invisible to the page, to the recorder, and to replay. **Capture the gesture, never imply the
selection.** That boundary is written into the `StepType` union itself.

Deliberately not measured: whether a *physical* right-click renders the native menu in the Recorder's
headed window. It does not move the design — the `contextmenu` listener fires either way, and the
user's selection is unobservable in both cases.

### The model

`dblclick` and `contextMenu` are **distinct `StepType`s**, matching how the repo already models
`click`/`hover`/`check`/`radio`/`drag` rather than overloading one pointer step with a `button` and a
click-count. The closed union is what forced every exhaustive map — validation, safety policy,
prerequisite trial modes, both node catalogs — to be updated rather than silently defaulting.

| # | Behaviour | Owner | Status |
|---|---|---|---|
| H1 | A double-click records **one `dblclick` action**, not two clicks | `verify:recorder-competitive` (section L) | PASS |
| H2 | The click that opened the double-click is absorbed, not left behind | `verify:recorder-competitive` (section L) | PASS |
| H3 | A right-click records **one `contextMenu` action** rather than being discarded | `verify:recorder-competitive` (section L) | PASS |
| H4 | The right-click gesture is not mistaken for an ordinary click | `verify:recorder-competitive` (section L) | PASS |
| H5 | A right-click is recorded even when the page leaves the native menu alone | `verify:recorder-competitive` (section L) | PASS |
| H6 | An ordinary single click still records exactly one click action (control) | `verify:recorder-competitive` (section L) | PASS |
| H7 | Both gestures survive conversion and a save/reload round trip with their own step types | `verify:recorder-flow` | PASS |
| H8 | Conversion never invents a double-click — two clicks stay two clicks | `verify:recorder-flow` | PASS |
| H9 | Replay produces real `dblclick` and `contextmenu` behaviour in a live browser | `verify:runner` | PASS |
| H10 | A step after a context menu still runs and takes effect | `verify:runner` | PASS |
| H11 | The PAGE ITSELF observes a real `dblclick`/`contextmenu` at capture time | `verify:recorder-competitive` (section L) | PASS |
| H12 | A right-click delivers no ordinary click to the page, at capture and at replay | `verify:recorder-competitive`, `verify:runner` | PASS |
| H13 | A replayed ordinary click fires `click` and NOT `dblclick` | `verify:runner` | PASS |
| H14 | A hover-gated pointer gesture gets its hover step injected — every gesture, not just `click` | `verify:recorder-flow` | PASS |
| H15 | A hover-gated gesture with no pinnable trigger is `needs-review`, never silently `resolved` | `verify:recorder-flow` | PASS |
| H16 | Both gestures validate as known, locator-requiring steps and stay blockable | `verify:validation` | PASS |
| H17 | The prerequisite controls ask the domain which types support a trial, never hardcode `click` | `verify:flow-step-mapping` | PASS |
| H18 | Click / Double Click / Right Click are labelled distinctly wherever a step is named | `verify:flow-node-catalog-parity` | PASS |

H6 is the control and stays: every other assertion here is about a **count**, and a count of 0 or 1
is also what a recorder that had stopped capturing altogether would produce. H8 is its mirror on the
conversion side — coalescing that was too eager would satisfy H2 while destroying ordinary clicks.

**H11–H13 exist because the recorder's own output cannot answer the question.** Asserting what the
recorder stored proves nothing about what the browser delivered: a `dblclick()` that degraded into
two spaced clicks, or a right-click the page never received, would leave every stored-action
assertion arguing about the wrong premise. The fixtures therefore observe the events themselves, and
each negative gets its own observable — a right-click that *also* landed a left click is invisible to
"the context-menu result was set", so the left-click counter is what catches it.

**H14–H15 were found by audit, not by a failing test.** The hover-prerequisite branch in
`buildRecordedFlow` was gated on `step.type === "click"`, so a hover-gated double-click or right-click
skipped both of its arms: no hover step was injected (replay ran against a still-hidden element) and
an unpinnable trigger was reported as `resolved` rather than `needs-review` — a false assurance, which
is worse than a missing warning. `click` is kept in the loop as the control: if these ever pass for
`click` alone, the gate has regressed to type-specific again.

**H17 is the same defect class in the renderer.** Both prerequisite-resolution controls were gated on
`data.stepType !== "click"` — the exact hardcoding `PREREQUISITE_TRIAL_MODES` was introduced to
replace. The effect was a permanent block: any `dblclick`, `contextMenu`, `fill` or `select` whose
prerequisite came back `unknown` showed both controls disabled, so the validator's
`interactionPrerequisiteBlocked` error had no reachable resolution in the UI.

**Replay is asserted by observable effect, not by status.** A `passed` step proves the executor did
not throw. H9 reads the fixture's own result element and its click counter, because the counter is
the discriminator: a flow that replayed two ordinary clicks would move the counter and never set the
double-click result. Mutation-tested both ways — replacing `dblclick()` with two clicks, and
`contextMenu` with an ordinary click, each fails its intended check.

## F. Frames (2)

| # | Behaviour | Owner | Status |
|---|---|---|---|
| F1 | A cross-origin frame chain is captured and replayed | `verify:frame-chain` | PASS |
| F2 | Frame identity change is refused rather than silently re-targeted | `verify:frame-chain` | PASS |

---

## Evidence: every cited verifier was run

Not inferred from the files existing — each was executed while compiling this matrix:

| Verifier | Result |
|---|---|
| `verify:recorder-navigation` | **45/45** |
| `verify:mock-site` | **161/161** |
| `verify:recorder-competitive` | **49/50** — see the note below |
| `verify:popup` | **12/12** |
| `verify:popup-identity` | **44/44** |
| `verify:popup-mock-site` | **15/15** |
| `verify:frame-chain` | **31/31** |

**About the 49/50.** The single failure is *not* row D6, whose two section-I checks both pass. It is
an unrelated drop-target check that encodes the positional expectation from before `awkit-65g`: the
recorder now returns `resolution: resolved` for a positional last-resort, by owner directive, and the
assertion still expects needs-review. It is pre-existing and provably unaffected by this work —
`verify:recorder-competitive` has no mock-site references and builds its own inline fixtures. Tracked
as `awkit-gc0g`, with the explicit instruction not to "fix" the product to satisfy a stale assertion.

## Total: 36 rows, 36 PASS

The bead estimated 34; the reconstruction came to 36 because the navigation lab split three rows that
the brief stated as one (`pushState` and `replaceState` driven by the test versus by page script, and
the redirect's final-destination and no-intermediate-hop halves). The count is reported as measured
rather than trimmed to the estimate.

## Gaps deliberately not covered here

- **Cross-origin document navigation.** The mock site is single-origin by design (offline, no external
  services). Cross-origin behaviour is exercised through the frame chain (F1) and the popup labs.
- **Real-IdP navigation** stays with the protected-login handoff and is owner-gated (`awkit-cey`);
  the Recorder must pause rather than record those surfaces, so there is nothing to assert here.

## Verification

```bash
npm run verify:recorder-navigation
```
```bash
npm run verify:mock-site
```
