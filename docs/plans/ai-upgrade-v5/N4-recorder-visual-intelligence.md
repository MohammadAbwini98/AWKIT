# N4 — Recorder Visual Intelligence

Shared rules and the Phase N boundary: `ROADMAP.md` › *Phase N — Visual Recognition and Automation* ›
*Canonical milestone map*. Epic `awkit-vra`. N4 follows N2 (`awkit-vra.12`, closed 2026-10-13, shadow-only) and N3
(`awkit-vra.4`, closed 2026-10-13, shadow-only). The tracker home for N4 is the new bead **`awkit-vra.13`**, with
children `awkit-vra.13.1`-`.13.7`. The legacy 2026-09-22 workstreams `awkit-vra.2`-`.8` are not reused.

**Status (2026-10-14): IN PROGRESS. N4.1, N4.2 and N4.3 done.** The owner approved RV-0 to RV-8 as recommended ("I approve
RV-0 to RV-8 as recommended, start N4"). That approval is recorded in `docs/ai/DECISIONS.md` (2026-10-14), and RV-1
amends the 2026-10-12 isolation decision and FD-2 there. Contract `awkit-vra-13-n4-start-1013`.

- **N4.1 `awkit-vra.13.1`: closed.**
- **N4.2 `awkit-vra.13.2`: closed.** Delivered:
  - `src/recorder/visual/RecorderVisualCapture.ts`, the only Recorder edge into `src/visual`, loaded lazily;
  - `src/recorder/visual/recorderVisualCaptureCodes.ts`, the pure contract;
  - `RecorderService.captureVisualReference` and `visualReferenceStatus`, with the in-memory pending map.

  Gates:
  - `verify:recorder-visual-capture` 78/0, with mutations M1, M2b, M3, M4 and M5 red and M2 a recorded survivor;
  - `verify:visual-isolation` 51/0, pinning two edges with the third-edge mutation red.
- **N4.3 `awkit-vra.13.3`: closed.** Contract `awkit-vra-13-3-n4-persistence-1014`. Delivered:
  - `src/runner/visualFusion/recordedVisualReferenceKey.ts`, the pure recorded namespace key: a fixed prefix plus
    `JSON.stringify([flowId, stepId, bindingDigest])`, which never holds a NUL and so never meets a runner key;
  - `buildRecordedFlow` `visualReferencesOut`, which binds a captured reference to its saved step and drops it when the
    binding changed or the saved step is ineligible or sensitive;
  - `RecorderService.draftVisualReferences` and `persistVisualReferences`, and the `recorder:saveFlow` write through
    the unchanged `VisualReferenceStore` after `store.create` and before `discardDraft`.

  A failed write is counted and logged as a fixed-text count and never fails the save. The flag off writes nothing.

  Gates:
  - `verify:recorder-visual-capture` 102/0, with mutations N1 to N7 red;
  - `verify:visual-isolation` 54/0, with the Recorder adapter's imports pinned and a planted second write path red.
- **Next:** N4.4 channel and UI and N4.5 calibration. There is still no IPC, preload, UI or runner reading of a
  recorded reference.

## Objective

Let the Recorder seed an **advisory, image-free visual reference** for a recorded element step, so that the
existing N2 shadow observation has a last-known-good appearance from the first replay rather than only after a run
that passed with shadow fusion on. That gap is recorded today: the N2 plan says records ship without visual references
until N4, and the N3 plan notes that without N4 seeding only steps that already passed with shadow fusion on have a
reference.

Concretely, and nothing wider:

> On an explicit user action, the Recorder re-proves a recorded element step's **own DOM locator** on the live page
> to exactly one visible, in-viewport element, captures that element through the existing N0 capture and N1
> fingerprint, and persists the resulting `VisualEvidence` v1 **beside the saved flow, never inside it**, bound to
> the step's locator binding digest. The Recorder shows a per-step status. Visual data never names, ranks, chooses,
> repairs or proves an element.

Success statement:

- **Feature off (the default).** Recording, locator generation, the uniqueness proof, saving, export and replay are
  exactly as today, byte for byte. No button, no channel effect, no file.
- **Feature on (`manual`).** An eligible step row offers *Capture visual reference*. A successful capture changes
  nothing about the step or its locator. On save, the reference is written beside the flow. If RV-4 is approved
  and N4.5 meets its criterion, a later replay with N2 shadow fusion on can *observe* against the recorded
  reference when it has no runtime reference yet.
- **Never.** A selector, index, coordinate, candidate, ranking or tie-break produced from pixels. A change to what
  the Recorder records. A recorded reference feeding anything but a shadow observation, including any future
  lifting of N3 enforcement. Pixels, thumbnails or fingerprints crossing IPC, entering a FlowProfile or being
  exported.

## User-visible purpose

An author records a flow and, for the steps they care about, captures how the target looked. The Recorder confirms
per step whether a visual reference was captured, refused (with the reason in words), or went stale because the
locator changed. Replays then carry visual observations in their trace from the first run. Today a newly recorded
flow has none until a shadow-enabled run passes. Nothing the user does with the feature can make a replay click
somewhere different.

## Today's baseline (as built, `86ae16da`)

| Fact | Source | Consequence for N4 |
|---|---|---|
| N0 `captureElement(page, target: Locator, opts)` never scrolls. It refuses offscreen targets and DPR/zoom mismatch, and runs `checkProtectedSurface` before and after capture | `src/visual/capture.ts` | N4 reuses it unchanged. Every N0 refusal becomes an N4 refusal code, never a retry with different options |
| N1 `VisualFingerprint`: a 16×16 luma grid, an edge grid, dHash, and `contentDigest` (sha256 of the RGBA bytes), at most 1536 bytes. `VisualEvidence` v1 is image-free, at most 4096 bytes, and adds a context fingerprint | `src/visual/fingerprint.ts`, `src/visual/index.ts` | The grids are a coarse grayscale thumbnail, which is derived screen data (see *Privacy*) |
| `src/visual/index.ts` is the only allowed entry into `src/visual` | `src/visual/index.ts` | A Recorder adapter imports only the index |
| `verify:visual-isolation` walks the execution trees (`src/runner`, `src/recorder`, `src/orchestrator`, `src/instances`, `src/session`, `app/main`) and the renderer **transitively**. Exactly one edge is allowed: `src/runner/visualFusion/VisualFusionStage.ts -> src/visual`. Three checks pin that single edge | `scripts/verify-visual-isolation.mts` lines 170, 184, 208, 213, 225 | The DECISIONS 2026-10-12 entry and FD-2 make "the Recorder never reaches `src/visual`" a proven invariant. Any Recorder capture needs an owner amendment (RV-1) |
| The N2 `VisualFusionStage` is shadow-only. It refreshes the last-known-good reference after a passing eligible, non-sensitive resolve. Eligible steps are click-like, fill, select, check, uncheck and radio. The FD-5 budget is 400 ms, shared with agreement (J9) | `src/runner/visualFusion/VisualFusionStage.ts` | The only consumer N4 may feed. N4 adds no capture at replay |
| N2 enablement: `visualFusionRoot` is set when `AWKIT_VISUAL_FUSION=shadow` or visual agreement mode is on | `src/runner/ExecutionEngine.ts:1633` | Runner consumption (N4.6) can only happen inside an already-enabled shadow stage |
| `VisualReferenceStore` is opaque (it does not import `src/visual`). It stores `<root>/visual-references/<sha256(scopeKey)>.json` as `{version:1, scopeKey, evidenceVersion, contentDigest, evidence, updatedAt}`. `get` returns found, missing, corrupt or version-mismatch. `refresh` returns written, unchanged, rate-limited (60 s), refused or failed. Writes are atomic with the EPERM retry | `src/runner/visualFusion/VisualReferenceStore.ts:100` | N4 reuses the store **unchanged** (RV-3). The Recorder can write records without a new persistence format |
| The runtime scope key is `scenarioId\0flowId\0stepId` | `src/runner/LocatorFactory.ts:1568` | The Recorder has no scenario, so recorded references need their own non-colliding namespace |
| N3 recovery is shadow-only. N3.4 and N3.5 are blocked. 28 `twins` decisions reached `agreed` in headless because headless renders identical icons with position-dependent bytes | `N3-visual-locator-recovery.md`, `N3.2-agreement-calibration.md` | N4 must not change agreement, thresholds or the enforce decision, and must not create a path that lifts N3 indirectly |
| Recorded actions arrive through the `__awtkit_recordAction` binding **after** the user's action has happened | `src/recorder/RecorderService.ts:971` | An automatic capture would record post-action state. Pre-action capture would need input interception. This is why RV-2 recommends manual capture |
| `getLivePage(alias, { allowProtected })` returns null during a protected-login handoff and after protected detection refused inspection. Only the L12.17 Super User diagnosis passes `allowProtected` | `src/recorder/RecorderService.ts:1933` | N4 calls it **without** options, so the protected boundary is inherited, not re-implemented |
| `buildRecordedStep` and `buildRecordedFlow` form the single finalizer, with side outputs such as `domReferencesOut` | `src/recorder/buildRecordedFlow.ts:117`, `:136` | Recorded references attach through one more side output. They never enter the step or the profile |
| `recorder:saveFlow` (PAGE_RECORDER + WORKFLOW_CREATE) builds the flow, creates it, then writes blueprints and L11 DOM references **beside the flow** with `Promise.allSettled` | `app/main/ipc/recorder.ipc.ts:218` | The persistence precedent N4.3 follows. A failed side write never fails the save |
| L11 `DomReferenceRecord` is bound by `bindingDigest` (a mismatch means stale), with source `recorder` or `runtime-refresh`, in `dom-references/` | `src/runner/domIntelligence/domReference.ts:25`, `:200` | The staleness precedent: a recorded visual reference is keyed by the binding digest |
| `domIntelligence:diagnose` already resolves a **draft** recorded action against the live Recorder page, through `buildRecordedStep` and `LocatorFactory` | `app/main/ipc/domIntelligence.ipc.ts:140-176` | The precedent for re-proving a recorded step on the live page without acting on it |
| `locatorBindingMatches` is the compare-and-swap guard for locator edits | `src/profiles/locatorApproval.ts:61` | A capture is dropped if the step's binding changed between capture and save |
| `src/recorder` contains no visual code (grep for `visual`: 0 matches). The Recorder UI is `app/renderer/pages/Recorder.tsx` | — | N4 is greenfield inside the Recorder |
| The mock-site labs `/visual-intelligence` (with `/frame`, `/frames`, `/popup`, `/account`, and protected injection) and `/visual-intelligence/fusion` (`vf-tool-0..3`, scenarios baseline, restyle, swap, twins, theme, drift, `wide`, `injectProtected`, `vf-offscreen-tool`) | `mock-site/` | N4 verifiers extend these labs rather than adding pages |
| Deferred N1 decisions: VC-D1 manual-only default, VC-D2 permission reuse, VC-D4 Recorder capture may scroll, VC-D5 animations, VC-D7 raw-UI-text suppression, VC-D8 budgets from measurement, VC-D10 lean profiles | N1 plan | RV-2, RV-5, RV-7 and the budgets below settle the ones N4 touches |

## Scope

- One manual capture channel for a recorded element step, gated by the existing Recorder permission.
- One Recorder visual adapter as the single new import edge into `src/visual` (if RV-1 is approved).
- An in-memory pending capture per draft action, persisted on save beside the flow through the existing
  `VisualReferenceStore`.
- A per-step status in the Recorder UI: `none`, `captured`, `stale` or `refused` with a reason code.
- Calibration of recorded (headed) baselines against replay in headed and headless (N4.5).
- If RV-4 is approved and N4.5 meets its criterion: a shadow-only runner fallback to the recorded reference when the
  runtime reference is missing (N4.6).

## Non-goals

- Automatic, per-action or event-driven capture.
- Any change to locator generation, ranking, the awkit-65g uniqueness proof, ambiguity handling, guarded-positional
  locators, Element Spy "Use in action", or the protected-login handoff.
- Coordinates, click points or any pixel-derived target.
- N3 enforcement. N3.4 and N3.5 stay blocked, and the 28 false `agreed` result stands.
- Visual failure diagnosis in reports (N5), visual assertions (N6), OCR (N7), rows and grids (N8), state recognition
  (N9) and any model (N10).
- A persisted Settings key (until N4 closes, per FD-8 and VR-8), export or import of references, and a thumbnail or
  preview of the captured pixels.
- The legacy workstreams `awkit-vra.6` and `awkit-vra.8`.

## Owners

| Area | Owner | Files (expected) |
|---|---|---|
| Recorder capture and live-page re-proof | recorder-playwright | `src/recorder/RecorderService.ts`, new `src/recorder/visual/RecorderVisualCapture.ts` |
| IPC channel, preload and the runner fallback | backend | `app/main/ipc/recorder.ipc.ts`, preload, `src/runner/visualFusion/VisualFusionStage.ts` (N4.6 only) |
| Save path and store reuse | data-persistence | `src/recorder/buildRecordedFlow.ts`, `recorder:saveFlow`, `VisualReferenceStore` (unchanged) |
| Step status UI | frontend, with ui-designer authority | `app/renderer/pages/Recorder.tsx`, `global.css` tokens |
| Protected boundary review | security (review) | — |
| Verifiers, mock-site and mutations | qa | `scripts/verify-recorder-visual-*.mts`, `scripts/verify-visual-isolation.mts`, `mock-site/` |
| Independent review | qc | — |
| Beads, state docs, dashboard | project-state | `.beads/`, `docs/ai/`, `scripts/verify-roadmap-dashboard.mjs` |

No new subsystem. The capture is N0, the fingerprint is N1, the store is the N2 store, the consumer is the N2 stage,
the save path is the L11 side-output pattern, and the live page is the L11 `getLivePage`.

## Architecture and data flow

1. **Renderer.** `Recorder.tsx` shows *Capture visual reference* on an eligible step row, only when the Recorder
   state reports the feature available. It sends the draft action id. Nothing else.
2. **Channel.** `recorder:captureVisualReference(actionId)` asserts PAGE_RECORDER (RV-5) and sanitizes the request
   to one id. It returns `{ ok: true, status }` or `{ ok: false, code, message }`, with no evidence, digest or
   pixels (RV-8).
3. **`RecorderService.captureVisualReference(actionId)`** refuses, in order, when:
   - the feature is off;
   - no recording is active, or a protected-login handoff is active;
   - the action is not found, or is not an eligible step type (RV-2);
   - the step is sensitive, which uses the same sensitivity rule N2 uses to refuse a reference refresh, any field
     the Recorder masks as a credential, OTP or secret, and any guarded-positional sensitive step;
   - `getLivePage(step.pageAlias ?? "main")` (no options) returns null;
   - the step's own locator, rebuilt through `buildRecordedStep(action)` and resolved through its frame chain,
     does not resolve to **exactly one** element.
   Otherwise it computes the binding digest from that step locator and calls the adapter.
4. **Adapter** (`src/recorder/visual/RecorderVisualCapture.ts`, the single new edge into `src/visual/index.ts`) calls
   `captureElement` with the **N2 runtime capture options unchanged** (RV-7), so recorded and runtime digests are
   comparable. N0 refuses offscreen, zoom or DPR mismatch, and protected surfaces before or after. The adapter
   returns `VisualEvidence` v1 or a refusal code, with no page mutation and no scrolling.
5. **Pending capture.** The service holds `{ evidence, bindingDigest, capturedAt }` per action id, in memory only.
   It is not in the draft, autosave or crash-recovery files. It is dropped when the action is deleted or edited, on
   "Use in action", on clear or discard, when its binding no longer matches (`locatorBindingMatches`), and when the
   recording ends without a save.
6. **Save.** `buildRecordedFlow` gains one side output, `visualReferencesOut`. It contains `{ stepId, evidence }`
   only for actions whose pending binding digest still equals the **final** step locator's digest, after pending
   upgrades. After `store.create`, `recorder:saveFlow` writes each one through `VisualReferenceStore` under the
   recorded namespace key (RV-3), inside the same `Promise.allSettled` as blueprints and DOM references. A failed
   write is counted in the save result's existing warning surface and never fails the save.
   *As built (N4.3, DECISIONS 2026-10-14):* the save result has no warning surface, so the handler logs a fixed-text
   count. The write runs after the blueprint and DOM-reference writes as its own never-rejecting call, not inside
   their `Promise.allSettled`. Each entry also carries its binding digest, and an ineligible or sensitive saved step is
   dropped as well.
7. **Replay (N4.6, conditional).** When N2 shadow is on and `store.get(runtimeKey)` is `missing`, the stage reads
   the recorded key for the same flow, step and current binding digest. A found record supplies the reference for
   the observation, and the codes-only trace records `referenceSource: "recorded"`. The stage never refreshes,
   rewrites or deletes the recorded record. Its existing refresh of the runtime key after a passing resolve is
   unchanged, so the runtime reference supersedes the recorded one from the next run. A decision whose reference
   came from the recorded namespace always has effect `none`, under every mode including any future N3 enforce.

```text
Recorder.tsx --(actionId)--> recorder:captureVisualReference [PAGE_RECORDER]
   --> RecorderService.captureVisualReference
         refusals: off / not recording / handoff / not found / not eligible / sensitive / no live page / not exactly one
   --> RecorderVisualCapture (only Recorder edge -> src/visual/index.ts)
         --> captureElement (N0: no scroll, protected before+after, conditions) --> VisualEvidence v1 (N1)
   --> pending map (memory only, bound to binding digest)
recorder:saveFlow --> buildRecordedFlow(..., { visualReferencesOut })
   --> store.create(flow)  (FlowProfile unchanged)
   --> VisualReferenceStore.refresh(recordedVisualReferenceKey(flowId, stepId, bindingDigest)) [best-effort, counted]
ExecutionEngine (N2 shadow on) --> VisualFusionStage
   runtime ref missing --> recorded ref (read-only) --> observation, effect none, trace referenceSource
```

## Persistence

- **Location:** `<root>/visual-references/`, the directory N2 already owns. There is no new folder or format.
- **Record:** the existing `VisualReferenceStore` record (`version: 1`, `evidenceVersion`, `contentDigest`,
  `evidence`, `updatedAt`). At most about 6 KB per step (at most 4096 bytes of evidence plus a wrapper).
- **Key:** a recorded namespace that cannot collide with a runtime `scenarioId\0flowId\0stepId` key, carrying the
  flow id, step id and binding digest. N4.3 proves non-collision. The exact encoding is an engineering detail.
- **Staleness:** the binding digest is in the key. A later locator edit makes the reference unreachable, which reads
  as missing, so it can never describe a different locator. This mirrors L11 `bindingDigest`.
- **Never in:** the FlowProfile, the recorder draft or autosave, flow export or import, run records, reports, or any
  IPC payload. The `VisualEvidence` docblock rule ("persisted in ONE place") stays true.
- **Lifecycle:** the files are harmless to delete, and deleting one returns that step to today's behavior.
  Orphans, such as files left after a locator edit or a flow delete, are bounded, small and inert. A sweep is out of
  scope (see *Risks*).
- **Migration:** none. Old runners never compute the recorded key, so they ignore the files.

## Privacy, security and the protected-auth boundary

- **What is stored.** The N1 grids are a 16×16 grayscale thumbnail plus edge and context grids of the element and
  its surroundings. That is derived screen data, and a button's label is coarsely present as pixels (VC-D7).
  Storage is local only, under the user's runtime root, and never leaves the machine.
- **What is never captured:**
  - any page while a protected-login handoff is active, or after protected detection refused inspection
    (`getLivePage` returns null);
  - any surface N0's `checkProtectedSurface` flags, checked before **and** after capture;
  - sensitive steps, credential, OTP or secret fields, and guarded-positional sensitive steps;
  - value-bearing steps such as fill and select (RV-2), because a post-action capture would hold a derived image of
    the typed or selected value.
- **No escalation.** The capture channel never passes `allowProtected`, never uses the L12.17 Super User protected
  diagnosis, and adds no permission (RV-5).
- **No new trust boundary.** The renderer sends an id and receives a status code. The main process never sends
  pixels, digests or fingerprints back (RV-8).
- **Session reuse and handoff are untouched.** A `Reuse Session` node and the handoff flow are not eligible steps.
  The real-Chrome handoff never involves the Recorder's automation page, so N4 cannot reach it.
- **Redaction.** Refusal messages are fixed strings. No URL, selector, label text or value is logged by the
  capture path.

## Headed and headless

Recording is headed, so recorded baselines are headed. Replays may be headless. N3.2 measured that headless
rasterizes identical icons with position-dependent bytes. N4.5 must therefore measure recorded headed baselines
against replay headed and headless, at DPR 1, 1.25 and 2, across fresh launches, on the baseline, restyle, swap,
twins, theme and drift scenarios, reporting:

- identity recall for the true target;
- false `identical` or `agreed` outcomes on swap, twins and restyle;
- the post-action effect: focus ring, hover and checked-state differences between capture time and replay time.

**Pre-agreed criterion:** with recorded baselines, no added false `agreed` relative to the N3.2 runtime-reference
results. If it is met, N4.6 may proceed. If not, **N4.6 is deferred and N4 closes recorder-only**: the recorded
references are written, but no runner reads them. This is the same fallback pattern N2 and N3 used. A
conditions mismatch (DPR or zoom) always degrades to N0's refusal or N2's conditions-changed path, never to a
comparison.

## Frames, popups and shadow roots

- **Frames:** the step's recorded frame chain is resolved exactly as the runner resolves it. A cross-origin frame
  N0 can capture is captured, and anything N0 refuses is refused with its code.
- **Popups:** the step's `pageAlias` selects the live popup page through `getLivePage`. A closed popup gives
  `no-live-page`.
- **Closed shadow:** the instrumented closed-shadow resolver (C2) is used through the normal locator path. A target
  the resolver cannot prove unique is refused.

## Offline

There are no new dependencies, network calls or remote assets. The adapter is TypeScript over the existing N0 and
N1 code (`node:crypto`, `node:zlib`). Nothing is written into `resources/` or `app.asar`. `validate:offline` is
unaffected, and N4.2 confirms that by running it once if the adapter changes any bundle boundary.

## AI independence and deterministic authority

- No model, OCR or similarity threshold is involved. Capture and fingerprinting are deterministic.
- **The DOM/Playwright locator is the only authority**, for both recording and replay. A capture only happens
  **after** the step's own locator has proven exactly one element, and the reference is bound to that locator's
  digest.
- **N3 boundary.** N4 does not touch `decideVisualAgreement`, the agreement thresholds or N3's mode resolution. A
  recorded reference can only feed a shadow observation with effect `none`, enforced by an invariant and a mutation
  (N4.6). This holds even if the owner later lifts N3.4 or N3.5. Under this plan, a recorded baseline never becomes
  execution authority.

## Backward compatibility

- FlowProfile schema, export format and the draft format are unchanged. An N4-era flow opens in an older build
  unchanged.
- Older runners ignore recorded-namespace files. Newer runners with the feature off ignore them too.
- The IPC surface gains one channel and one boolean on the Recorder state. No existing channel's request or
  response shape changes.
- The `window.playwrightFlowStudio` identifier is unchanged.

## Failure and fallback

| Condition | Result |
|---|---|
| Feature off | Channel answers `disabled`, no UI is shown, the runner never reads recorded keys |
| Not recording, handoff active, or no live page | `not-recording`, `handoff-active` or `no-live-page`, and the step status is unchanged |
| Not eligible, or sensitive | `not-eligible` or `sensitive`, and no capture is attempted |
| The step's locator does not resolve to exactly one element | `not-unique` or `not-found`. The locator is never changed and no alternative is offered |
| N0 refusal (offscreen, conditions, protected before or after, capture error) | The N0 reason passed through as a code. No scroll, retry or page change |
| Capture exceeds its deadline | `timeout`. The Recorder action queue is not delayed |
| Binding changed before save | The pending capture is dropped and the status shows `stale` |
| Store write fails at save | The save succeeds. The failure is counted and logged as fixed text (no save-warning surface exists, N4.3) |
| Record corrupt, version mismatch or missing at replay | Today's behavior: no recorded reference |

Final codes are fixed in N4.2. The rule is a fixed code and fixed text, never raw error text.

**As built (N4.2).** `src/recorder/visual/recorderVisualCaptureCodes.ts` fixes 17 codes:
`disabled`, `not-recording`, `handoff-active`, `action-not-found`, `not-eligible`, `sensitive`, `protected-surface`,
`no-live-page`, `not-unique`, `not-found`, `offscreen`, `frame-mapping-failed`, `page-closed`, `timeout`, `stale`,
`capture-unavailable` and `capture-failed`.

- `action-not-found` (the step was deleted) and `page-closed` (the page closed during the capture) were added to the
  table above.
- A masked-field target (password, one-time code, PIN, card number and similar) is refused as `sensitive`.
- An unfinished or failed protected-login scan refuses as `timeout` or `protected-surface`, never as clear.
- An unknown N0 code maps to `capture-failed`, never to a success.

## Performance budgets

- **Manual capture:** bounded by a per-capture deadline set from N4.5 measurement (VC-D8). The provisional ceiling is
  1500 ms. It runs off the recorded-action path, so the action queue and binding are never delayed.
- **Save:** at most one store write per captured step, in parallel with the existing side writes.
- **Replay (N4.6):** at most one extra `store.get` per eligible step, only when the runtime reference is missing,
  inside the shared FD-5 400 ms budget (J9). N4.5 measures it, and a budget overrun degrades to `budget-exhausted`,
  as N3 does.
- **Disk:** about 6 KB per captured step.

## Accessibility and UI

- One action per eligible step row: a real `<button>` with the accessible name "Capture visual reference for step
  *n*". Status is shown as text plus an icon, never colour alone: *No visual reference*, *Visual reference
  captured*, *Stale — locator changed*, *Not captured — reason*.
- The result is announced through a polite `aria-live` region. Focus stays on the button. The button is operable by
  keyboard and disabled with a reason while a capture is running.
- Hologram tokens only (`var(--awkit-*)`, `--space-*`, `--radius-*`, motion tokens), with reduced motion respected.
  The `.app-shell` and `.app-main` grids are unchanged.
- No thumbnail or pixel preview (RV-8).
- Hidden entirely when the feature is off.
- The GUI verifier asserts focus by containment and drives it with real `Tab`. The capture outcome is asserted from
  the live region, never from a fallback element's text.

## Owner decisions before implementation (approved as recommended, 2026-10-14)

Each decision is needed because N4 would otherwise silently change a recorded invariant. The narrowest option is
recommended. Ordinary engineering details, such as code names, key encoding, file names and verifier names, are
**not** owner decisions.

### RV-0 — Scope boundary

- **Decision:** what N4 is allowed to change.
- **Recommended:** reference seeding plus status only. Visual data never changes recording, locator generation,
  ranking, the uniqueness proof, ambiguity handling or execution. No amendment to VR-0 (as amended for N3) is
  needed.
- **Alternatives:** (a) record-time visual locator ranking or disambiguation, which conflicts with the VR-0 text and
  the awkit-65g directive; (b) a coordinate or click-point fallback, which conflicts with Phase N's DOM-first rule.
- **Consequence:** with the recommendation, nothing about the recorded flow changes, and N4 is reversible by
  deleting files. Either alternative would make pixels an authority and needs a VR-0 amendment.
- **Why needed:** "Recorder Visual Intelligence" could be read as visual locator generation. The owner must fix the
  boundary before any work.

### RV-1 — Isolation amendment

- **Decision:** whether, and how, the Recorder may reach `src/visual`.
- **Recommended:** exactly one new allowed edge, `src/recorder/visual/RecorderVisualCapture.ts -> src/visual`
  (index only). `verify:visual-isolation` then pins exactly the two approved edges for both the execution and
  renderer walks, and a mutation proves a third edge fails. The capture IPC types live in a pure contract file that
  does not import `src/visual`, so the renderer walk never meets the new edge. This amends the 2026-10-12 isolation
  decision and FD-2.
- **Alternatives:** (a) route the Recorder through the runner's `VisualFusionStage`, which couples the Recorder to
  runner internals and widens the existing edge's meaning; (b) no Recorder capture in N4, which leaves seeding
  impossible and N4 empty.
- **Consequence:** the "Recorder never reaches `src/visual`" invariant becomes "the Recorder reaches it through one
  adapter". The proof stays mechanical and mutation-tested.
- **Why needed:** the current invariant is an owner decision, and the first slice cannot exist without amending it.

### RV-2 — Trigger and eligible steps

- **Decision:** when a capture happens, and for which steps.
- **Recommended:** **manual**, per recorded element step, on the live page, after re-proving that step's own
  locator. Eligible steps are **click-like, check, uncheck and radio**. Value-bearing **fill and select are
  excluded**, because a post-action capture holds a derived image of the typed value and cannot match the
  pre-action appearance at replay.
- **Alternatives:** (a) automatic capture per recorded action, which is structurally post-action because actions
  arrive after they happen, while pre-action capture would need input interception; (b) capture from the Element Spy
  inspection only, which sees the pre-action state but would photograph the Spy's highlight overlay and covers only
  inspected elements; (c) the full N2 eligible set including fill and select.
- **Consequence:** the baseline reflects the element **at capture time**, which can differ from replay (focus ring,
  hover, checked state). Such differences cost recall, which is safe because they never create a false identity.
  N4.5 measures them. Users must capture while the step's element is still on screen.
- **Why needed:** it decides the user model, the privacy surface and the first code slice.

### RV-3 — Persistence and keying

- **Decision:** where recorded references live and what binds them.
- **Recommended:** reuse `VisualReferenceStore` **unchanged** in `visual-references/`, under a recorded namespace
  key of flow, step and binding digest. Never in the FlowProfile, draft, export or IPC.
- **Alternatives:** (a) a new L11-style record type and folder, which is a parallel format; (b) a FlowProfile field,
  which FD-4 rejected because evidence would travel with exports and IPC.
- **Consequence:** no schema change and no migration, and staleness is structural. References do not travel with an
  exported flow, so an imported flow starts with none.
- **Why needed:** it extends the FD-4 sidecar decision to a second writer, the Recorder.

### RV-4 — Runner consumption

- **Decision:** whether replay may read recorded references.
- **Recommended:** a shadow-only fallback when the runtime reference is missing and the binding digest matches. It
  never refreshes or rewrites the recorded record, the trace notes the source, and the effect is `none` under every
  mode. Gated by the N4.5 criterion, and enabled only when N2 shadow and the N4 flag are both on.
- **Alternatives:** (a) no runner consumption, which is the narrower option and is applied automatically if N4.5
  fails; (b) prefer the recorded baseline over the runtime reference, which is rejected because the runtime
  reference is newer and the same-mode capture.
- **Consequence:** observations exist from the first replay. There is no execution effect, and the N3 shadow-only
  boundary is preserved by an explicit invariant.
- **Why needed:** this is the only place N4 touches the runner, and it borders N3's blocked enforcement.

### RV-5 — Permission

- **Decision:** who may capture.
- **Recommended:** reuse **PAGE_RECORDER** for the capture channel. Saving still requires PAGE_RECORDER +
  WORKFLOW_CREATE. The channel is not re-authentication gated.
- **Alternatives:** (a) a new permission, which carries the `ADMINISTRATOR_PERMISSIONS` denylist trap (a silent
  grant unless excluded) and adds role-matrix surface; (b) also require RECORDER_ELEMENT_SPY, which ties capture to
  the Spy without reason under RV-2.
- **Consequence:** everyone who can record can capture, which matches VC-D2.
- **Why needed:** VC-D2 left permission reuse to the owner.

### RV-6 — Enablement

- **Decision:** how the feature is switched on.
- **Recommended:** environment flag `AWKIT_VISUAL_RECORDER=manual`, **default off**, with no Settings key until N4
  closes. This follows FD-8 and VR-8, because `retainKnownKeys` drops unknown Settings groups.
- **Alternatives:** (a) a Settings toggle now, which needs a persisted-shape change before the feature is proven;
  (b) always on.
- **Consequence:** invisible to users until the owner chooses to expose it, and trivially reversible.
- **Why needed:** it sets the default user experience.

### RV-7 — Geometry and motion

- **Decision:** whether the Recorder may alter the page to capture.
- **Recommended:** no. Never scroll: refuse offscreen with guidance to scroll the element into view and capture
  again. Keep the **N2 runtime capture options unchanged**, so recorded and runtime digests are comparable.
- **Alternatives:** (a) VC-D4 scroll into view, which alters the recorded page and may trigger lazy loading or
  handlers; (b) VC-D5 animations disabled, which alters the page and makes recorded pixels differ from runtime
  pixels.
- **Consequence:** some captures are refused until the user scrolls. Every capture is side-effect free.
- **Why needed:** VC-D4 and VC-D5 were deferred to the Recorder phase.

### RV-8 — UI exposure

- **Decision:** what the Recorder UI may show.
- **Recommended:** status codes and fixed text only. No pixels, thumbnail, fingerprint or digest cross IPC.
- **Alternatives:** (a) an ephemeral thumbnail, which is a new pixel IPC path and widens the privacy surface; (b) no
  UI, which leaves authors blind to refusals and staleness.
- **Consequence:** authors know what was captured, but not what it looks like.
- **Why needed:** it decides whether image data may cross the Electron boundary for the first time.

## Work breakdown

| Item | Bead | Owner | Depends on | Delivers | Acceptance |
|---|---|---|---|---|---|
| N4.1 Owner decisions | `awkit-vra.13.1` | owner | — | RV-0 to RV-8 recorded in DECISIONS, the isolation amendment, N4 authorization | DECISIONS entry. The plan's status updated |
| N4.2 Adapter and isolation | `awkit-vra.13.2` | recorder-playwright, qa | N4.1 | `RecorderVisualCapture`, `RecorderService.captureVisualReference`, the pending map, refusal codes, the isolation amendment | New `verify:recorder-visual-capture` with a mutation contract. `verify:visual-isolation` pins exactly the approved edges, with a third-edge mutation red. Build |
| N4.3 Persistence | `awkit-vra.13.3` | data-persistence, backend | N4.2 | `visualReferencesOut`, save-path writes, the recorded namespace key, binding-digest drop | FlowProfile and export byte-identical with the feature on and off. Key non-collision. Failed write never fails save. Build |
| N4.4 Channel and UI | `awkit-vra.13.4` | backend, frontend, ui-designer | N4.3 | Channel, preload, Recorder state flag, step status UI | IPC contract and both-direction role checks. GUI verifier for status, focus, live region and reduced motion. Build |
| N4.5 Calibration | `awkit-vra.13.5` | qa, recorder-playwright | N4.2 | Informational benchmark: capture cost, recorded headed against replay headed and headless, DPR 1, 1.25 and 2, fresh launches | `verify:mock-site` green. The criterion reported as met or not met |
| N4.6 Runner shadow fallback | `awkit-vra.13.6` | backend, qa | N4.3, N4.5 | The recorded-reference fallback in the N2 stage, trace source, the effect-none invariant | Runner A/B unchanged. A mutation proves a recorded reference cannot reach enforce or be refreshed. N2 and N3 suites, runner, locator-guard and recovery-provenance green. **Deferred if N4.5 fails** |
| N4.7 State, docs, closure | `awkit-vra.13.7` | project-state, qc | N4.4, N4.6 | State docs, ARCHITECTURE, DECISIONS outcome, independent QC, dashboard repin | QC approved with findings closed. Sources agree. Build |

### Dependency chain

```text
awkit-vra.12 (N2, closed) --+
                            +--> awkit-vra.13 (N4)
awkit-vra.4  (N3, closed) --+
N4.1 --> N4.2 --+--> N4.3 --+--> N4.4 ------------+
                |           |                     +--> N4.7
                +--> N4.5 --+--> N4.6 ------------+
```

N4.6 depends on both N4.3 and N4.5. If N4.5 fails its criterion, N4.6 is recorded as deferred, and N4.7 may close
N4 recorder-only.

## Verification, mutation and mock-site strategy

**Mock-site.** Extend the existing labs, not new pages:

- `/visual-intelligence` covers protected injection, frames, popup and account.
- `/visual-intelligence/fusion` covers twins, restyle, swap, theme, drift, `wide` and `vf-offscreen-tool`.

Add only what is missing, for example a stay-on-page toggle and checkbox to measure the post-action effect, and a
masked credential field to prove the refusal. Each addition gets a stable URL, title, expected behavior and
`data-testid` selectors, and is covered by `verify:mock-site`.

**New verifiers**, each registered in `scripts/lib/verifier-classification.ts`:

- `verify:recorder-visual-capture` (N4.2 and N4.3), through the real `RecorderService` on a real navigation (capture
  installs only on a real navigation, not `setContent`). It asserts:
  - an eligible unique visible element is captured;
  - each refusal code occurs on its fixture: protected before, protected after, handoff, sensitive, fill and select,
    twins as not-unique, offscreen, zoom, closed popup;
  - frame-chain capture works;
  - the page is unmodified, with scroll position and DOM digest equal before and after;
  - the persisted record is read back through `VisualReferenceStore` under the recorded key;
  - FlowProfile and export are byte-identical with the feature on and off;
  - a capture is dropped when the binding changes;
  - no IPC response carries evidence.
- A GUI verifier for the Recorder status UI (N4.4).
- `benchmark:recorder-visual-baseline`, informational (N4.5).

**Existing verifiers** that must stay green or be extended:

- `verify:visual-isolation`, extended to the exact two-edge set;
- the IPC contract and role checks in both directions (the PAGE_RECORDER role allowed and the Viewer denied);
- `verify:visual-capture`, `verify:visual-fingerprint`, `verify:visual-fusion-runtime`, `verify:visual-agreement`
  and `verify:visual-agreement-runtime`;
- `verify:runner`, `verify:locator-guard`, `verify:recovery-provenance`, `verify:twin-pool-safety`,
  `verify:mock-site` and `npm run build`.

**Mutation contracts** are written **after** running each mutation and recording its observed result. Candidates:

- skipping the post-capture protected check;
- accepting `count() > 1`;
- passing `allowProtected`;
- writing evidence into the FlowProfile;
- returning evidence over IPC;
- a third isolation edge;
- the runner refreshing a recorded record;
- a recorded-source decision reaching a non-`none` effect.

**Rules carried from earlier phases:**

- Pair every `.every()` with a cardinality assertion.
- Never use `waitForFunction(async …)` or `isVisible({ timeout })` as a wait.
- Assert the precondition before the thing it gates.
- `page.evaluate` bodies avoid named inner functions.

## Completion criteria

N4 closes when every item holds, or is truthfully recorded as deferred:

1. RV-0 to RV-8 are recorded by the owner, and N4 was authorized before any code landed.
2. `verify:visual-isolation` passes with exactly the approved edges, and its third-edge mutation is red.
3. `verify:recorder-visual-capture` passes with its mutation contract. Every protected, sensitive and handoff
   refusal is proven on a fixture.
4. No FlowProfile, draft, export, run record, report or IPC payload carries visual evidence, proven by
   byte-identity and response-shape checks.
5. The Recorder status UI passes its GUI and accessibility verifier.
6. N4.5 measurements are recorded and the criterion is reported. N4.6 is complete, or deferred with N4 closing
   recorder-only.
7. If N4.6 is complete: runner A/B decisions are unchanged, and a recorded reference provably never reaches enforce
   or gets refreshed.
8. The N2 and N3 suites, runner, locator-guard, recovery-provenance, mock-site and build pass against the final
   state.
9. Independent QC is APPROVED, with its findings closed.
10. `verify:roadmap-dashboard` reports Sources agree.

## Rollback and disable

- **Disable:** unset `AWKIT_VISUAL_RECORDER`. The UI hides, the channel answers `disabled` and the runner never
  reads recorded keys. No restart-surviving state remains active.
- **Data:** recorded-namespace files under `visual-references/` can be deleted at any time. Each step then returns
  to today's behavior.
- **Code:** revert the N4 commits. There is no schema, migration or Settings key to unwind.

## Carry-over boundaries (unchanged by N4)

- N3 stays closed shadow-only. N3.4 and N3.5 stay blocked, and the 28 false `agreed` headless-twin result stands.
- v0.1.53 release gates are untouched. Packaged licensed Parts D-J are BLOCKED on the unavailable
  `AWKIT_PACKAGED_LICENSE_ISSUER_KEY`. The clean offline Windows VM walkthrough is NOT RUN.

## Risks

| Risk | Mitigation |
|---|---|
| Post-action appearance (focus, hover, checked) differs from replay | Recall loss only, never false identity. Measured in N4.5 |
| Headless position-dependent rasterization (N3.2) | N4.5 criterion. N4.6 deferred if false `agreed` grows |
| Users capture after the element has left the page | Refusal codes with guidance. Capture is per step and repeatable |
| Orphaned recorded files after locator edits or flow deletes | Small, inert and bounded. Future sweep candidate, not in N4 |
| The stored thumbnail of a non-sensitive element contains label text | Local only, never exported or sent over IPC. Value-bearing steps excluded (RV-2) |
| Isolation amendment widens future drift | Exact-set pinning with a third-edge mutation |
