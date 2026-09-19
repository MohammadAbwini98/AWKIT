# L2 — Deterministic Recorder & Element Spy

Shared rules, architecture and decisions: `ROADMAP.md`. Depends on L0. **No model required.**

## Goal

Strengthen deterministic authoring, make locator quality explicit, and capture the context L3 needs — without changing
the current guarded-positional behavior.

## Tasks

1. **Strategy chooser** — Default/Adaptive, Role+name, Text, Test ID, XPath (explicit opt-in, shown as low
   durability). Default behavior and legacy round trips unchanged.
2. **Quality classes** — deterministic, explainable: `strong-semantic | acceptable-semantic | guarded-positional |
   review-required`, from match/visible counts, role/name, label/placeholder/test-id stability, generated id/class
   signals, container chain, frame/shadow complexity, positional dependence, guard strength, fingerprint evidence.
   Not an AI score. This class is the L3 trigger.
3. **Preserve guarded-positional** — `buildRecordedFlow.ts` stays the single finalizer; guarded-positional remains
   `resolved`. No step becomes unresolved because a semantic locator was not unique.
4. **Upgrade context capture** — at the interaction boundary, while the target exists: target role/name/tag/type,
   candidate summaries + counts, container chain, nearby heading/label/landmark/dialog/card/row context, sibling action
   names, frame/shadow identity, page/frame key, fingerprint, **bound-value markers** (which texts came from
   `valueSource`/data/earlier input — feeds the L3 intent guard). Memory-only, short TTL, redacted; nothing raw persisted.
5. **Element Spy** — independent inspect mode (permission from L1): identity, candidates, counts, quality reasons,
   frame/shadow/container context; "Use in action" is explicit; "Find stronger locator with AI" appears once L3 exists.
   Obeys protected-login restrictions.

## Verification

Extend mock-site Recorder fixtures: repeated rows/cards/dialog controls, guarded-positional cases, re-render after
click, row removed by action, dialog closed by action, navigation after action, frames/shadow, identical twins,
data-bound row text, protected-login exclusion. Run `verify:recorder`, `verify:recorder-ambiguity`,
`verify:recorder-competitive`, `verify:recorder-action-owner`, `verify:locator-guard`, `verify:frame-chain`,
`verify:closed-shadow`, `verify:protected-login-recorder`, `verify:legacy-compat`, `verify:mock-site`, `npm run build`.

## Acceptance

- Guarded-positional behavior byte-for-byte unchanged in existing verifiers.
- Quality class visible and tested; context captured early, bounded, not persisted.
- Element Spy works independently and is permission-gated.

## Status (2026-09-19, `awkit-djnl.3`): tasks 1–5 done — L2 complete

| Task | State | Where |
|---|---|---|
| 4 Upgrade context capture | Done | `src/recorder/upgradeContext.ts`. The page script builds it inside `generateForEvent` from the exact target (role/name/tag/type, 5 candidate summaries with counts, dialog/row/card/list-item/form/landmark containers, nearest heading, up to 6 sibling action names, page key without query, open-shadow flag, in-page fingerprint); secret-bearing controls yield none and no form value is read. `RecorderService.recordActionFromPage` takes it off the action first, bounds it, adds the trusted frame depth and **bound-value markers** (field names whose text contains this step's value or an earlier fill/select value — never the value), and keeps it in a memory-only map (10 min TTL, 500 entries) read by `getUpgradeContext(actionId)`. Stripped again by `applyLocatorRecordingMode` and excluded by `buildRecordedFlow`; never in the draft, a profile, a log or a report. |
| 5 Element Spy | Done | Recorder › **Element Spy** panel (`recorder.elementSpy`, every IPC channel gated in main). Independent: **Open Element Spy** launches the same hardened Recorder browser with inspect on and recording off (`startInspection`; every capture binding early-returns, the draft is never rewritten); during a recording **Inspect** toggles the same mode. A window capture-phase blocker swallows the gesture, so the click/submit/link/popup never happens and is never recorded. Reports identity, the Recorder's own choice with its quality class and reasons, candidates with match and visible counts, container/frame (Frame-graph, trusted)/shadow context and the upgrade context. **Use in action** is explicit: only a unique, non-positional candidate, same page alias, same frame chain, outside shadow roots, on a single-target element step; the step keeps its frame chain, interaction, prerequisite and execution decision; a refusal names its reason. Protected login (page password/OTP fields, or the detector in either mode) turns inspection off, clears the result and marks the page. Result TTL 5 min. "Find stronger locator with AI" waits for L3. |

Verifiers: `verify:element-spy` **89/89** (new; real RecorderService browser on `/recorder-lab/element-spy`, IPC wiring, SSR panel,
paused-mode negative control), `verify:recorder-gui` **205/0/0** (new L2 section), `verify:recorder` **292/292**.

### Earlier status (tasks 1–3)

| Task | State | Where |
|---|---|---|
| 1 Strategy chooser | Done (`d94d1a1`) | Recorder › Locator Recording: Default, Role + name, Text, Test ID, XPath. The page emits the element's other globally unique, non-positional candidates (`recordingCandidates`, capture-only); `RecorderService` promotes the preferred one or keeps the adaptive choice with a stated warning; the adaptive primary becomes the first fallback. `RecorderService` and `buildRecordedFlow` both strip the evidence. |
| 2 Quality classes | Done (`0bcc0c8`) | `src/recorder/LocatorQualityClass.ts`: derived from the saved locator with the runtime's own `isPositionalLocator`/`hasPositionalIdentityGuard`, never persisted; coded reasons. Replaces the Recorder page's strong/medium/brittle grade; shown in the Flow Designer properties panel (`data-testid="locator-quality-class"`). |
| 3 Guarded-positional preserved | Verified | No capture, finalizer or runtime change to it; a preference cannot displace it. locator-guard 35/0, recorder-ambiguity 74/0. |
| 4 Upgrade context capture | Open | No consumer before L3 (or the Spy). |
| 5 Element Spy | Open | Permission `recorder.elementSpy` exists (L1). |

Verifiers: `verify:locator-quality-class` 35/35 (rule table with every reason code reachable, real Recorder
capture on `/recorder-lab/locator-quality` through `buildRecordedFlow`, negative control), `verify:recorder`
290/290 (Part Y: chooser), `verify:recorder-gui` 194/0/0, `verify:flow-designer` 140/140 + 16/16.
Observed: a hidden duplicate in the DOM makes the Recorder fall back to a guarded position (Apply coupon on the lab
page) — correct capture and exactly what the class flags for an L3 upgrade.
