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

## H. Declared limitations — interactions the Recorder does NOT capture (3)

These are measured, not assumed, and are guarded so the gap stays loud instead of silent.

**`GAP` is not a pass.** H1 and H3 are *known-gap sentinels*: they hold only while the defect is
present. `verify:recorder-competitive` tallies them **separately** from its check count and prints
them as `GAP`, never `✓` — a headline of "58/58 passed" that quietly included two "the defect is
still here" assertions would eventually be read as "recorder pointer handling is green". The
headline is now 56/56 checks plus 2 sentinels named as such.

A sentinel that stops holding **fails the run** and says what to do: measured by suppressing the
second click of a double-click, which produced `CHANGED … Convert this sentinel into a positive
assertion and update awkit-bxyo` and exit 1. Implementation therefore cannot land without forcing
these to be rewritten as positive assertions. H2 is an ordinary check, not a sentinel: it holds
before and after the fix.

| # | Behaviour | Owner | Status |
|---|---|---|---|
| H1 | A double-click records **two click actions**, not a double-click | `verify:recorder-competitive` (section L) | **GAP** — defect present |
| H2 | No action type claims double-click semantics the runtime cannot replay | `verify:recorder-competitive` (section L) | PASS |
| H3 | A right-click records **nothing** — context menus are not captured | `verify:recorder-competitive` (section L) | **GAP** — defect present |

The Recorder installs listeners for `click`, `keydown`, `change`, `pointer*`, `drop`, `popstate`,
`hashchange`, `scroll` and `mouseover`. There is **no `dblclick` and no `contextmenu` listener**.

Measured with the real capture path (through `recordActionFromPage`, not the raw init script):

```text
double-click  page fired dblclick    → recorder stored 2 click actions
right-click   page fired contextmenu → recorder stored 0 actions
single click  (control)              → recorder stored 1 action
```

**What this costs.** Two clicks replayed with a gap between them will not reliably re-fire
`dblclick`, so a double-click-driven UI records but does not faithfully replay. A right-click is
dropped with no step and no warning — the user sees nothing recorded and is told nothing.

The section-L checks exist to make that visible, **not to bless it**. If either interaction is ever
implemented properly those checks SHOULD fail; that is the signal to update this table. The control
check (a single click records exactly one action) is what stops the two counts being satisfied by a
recorder that has stopped capturing altogether.

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
