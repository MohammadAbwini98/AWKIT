# N7 — Offline OCR / Text-in-Image (technical plan)

- **Status:** IN PROGRESS. OC-0 to OC-12 were **RATIFIED on 2026-10-26** (N7.1, DECISIONS 2026-10-26) in the
  final amended wording of § Owner decisions, with the sequencing clarification in § Work breakdown.
  - **N7.1b**, packaged compatibility, follows N7.3 and N7.4. It does not gate N7.2–N7.5, and it stays BLOCKED until
    the approved packaging host exists.
  - **N7.8** needs final packaged acceptance.
  - **N7.9** cannot close N7 while mandatory packaged evidence is BLOCKED or NOT RUN.
  - History: planned and amended on 2026-10-25 (OC-1 and OC-2 as the owner recommended; the final corrections to
    OC-8, OC-9, OC-10 and OC-12 and the N7.1a/N7.1b split).
- **Retained constraints:**
  - DOM-first targeting; observe-only evidence with no action selection;
  - strict protected and sensitive refusal; no captured or recognized text persisted;
  - fail-closed ambiguity; English-only first qualification;
  - no cloud, CDN, runtime download or NVIDIA requirement; CPU on the bundled Windows x64 runtime;
  - honest, measured accuracy and performance.
- **Beads:** `awkit-vra.9` (P3, in progress since 2026-10-26).
  - The ratified breakdown is filed as children:
    - N7.1 `.9.1` (closed);
    - N7.1a `.9.2`, N7.1b `.9.3`, N7.2 `.9.4`, N7.3 `.9.11`, N7.4 `.9.5`;
    - N7.5 `.9.6`, N7.6 `.9.7`, N7.7 `.9.8`, N7.8 `.9.9`, N7.9 `.9.10`.
  - They carry the dependency order in § Work breakdown.
  - Its dependency on the canonical N3 `awkit-vra.4` (closed) was added on 2026-10-25.
  - The legacy edge to `awkit-vra.3` is no longer present. The live database and the 2026-10-25 re-export show `.4` as
    its only blocker. It was removed outside the agent, and the agent made no removal attempt.
- **Builds on:** N0 capture and protected window, N1 PNG and fingerprints, N2 shadow-only evidence policy, N5
  codes-only diagnosis blocks, and N6 (sensitive-container rule, report sanitizer, calibration method, lazily loaded
  adapter edge).
- **Phase N:** in progress. This plan closes nothing.

## Objective

Read text that exists only as pixels, where the DOM has none: canvas charts, images of text, rendered PDFs in a
viewer, and icon fonts with no accessible name. Do it offline and optionally, as advisory evidence that never acts on
its own, inside the same protected boundaries as N0–N6.

## Principles (non-negotiable)

1. **DOM first.** OCR never picks an element, never makes a locator and never replaces one. It never clicks, types or
   navigates, and it never changes which element a step acts on. It reads a region that a DOM locator has already
   proven to be one visible element.
2. **Evidence, not authority.**
   - In N7, OCR output feeds an observe-only text assertion and the advisory evidence of N2 and N5 (shadow, effect
     `none`).
   - An enforcing OCR assertion is a separate future milestone, gated like N6's `awkit-vra.16` (OC-11).
3. **Offline and optional.**
   - No cloud, no runtime download, no network, and no mandatory model.
   - The engine and its language data are pinned, checksummed and bundled.
   - Disabled (the default), the product behaves exactly as today with no measurable overhead.
4. **Protected surfaces are never read.** Login, MFA, OTP, CAPTCHA, passkey, payment and other sensitive targets are
   refused before any capture, with the same rules as N6 (§ Security).
5. **Fail closed on ambiguity.** Low confidence, near misses, look-alike glyphs, more than one match, unsupported
   scripts or rotation all yield `inconclusive`, never a pass.

## Distinct from other milestones

| Milestone | What it does | Relation to N7 |
|---|---|---|
| N2 fusion / N3 agreement | Pixel evidence beside DOM evidence, veto-only and shadow | N7 may add a text-similarity signal to the same shadow observation (N7.7), effect `none` |
| N5 diagnosis | Codes-only "why did this step fail" | N7 may add codes such as `text-differs-from-label` (N7.7), with no text |
| N6 assertions | Pixel equality with an approved baseline | N7 is text equality with an author-written string, so no baseline image is needed |
| N9 screenshot state | Whole-screen state recognition | Out of scope for N7 |
| N10 local vision model | An optional model | N7 needs no model beyond the bundled OCR engine's own recognition data (OC-2) |

## Today's baseline (verified 2026-10-25)

- **No OCR exists.** There is no OCR dependency in `package.json`, and nothing in `src/visual` or the runner reads
  text from pixels.
- **Capture:** `src/visual/capture.ts` `captureElement` returns an in-memory crop inside the strict protected window,
  through the N0 guard. Visual Intelligence captures run inside that window (`awkit-2het`).
- **Edges into `src/visual`:** four approved (N2.5, N4.2, N5.3, N6.4), guarded by `verify:visual-isolation`.
- **Hosts:** offline native hosts follow the utility-process pattern. Zvec (`ZvecUtilityHostManager`) and local AI
  (`AiUtilityHostManager`) are forked lazily, use correlated requests with deadlines and bounded restarts, settle on
  exit, and fail open without affecting runs.
- **Packaging:** the dependency manifest is signed, `validate:offline -Strict` runs in `package:portable`, and the
  release target is bundled Windows x64.
- **Reports:** codes-only blocks are sanitized on write and read: `visualDiagnosis` (N5) and `visualAssertions` (N6).

## Engine options (OC-1)

| Option | Offline | Bundle | Determinism | Process model | License | Fit |
|---|---|---|---|---|---|---|
| **A. Tesseract 5 compiled to WASM (`tesseract.js-core`, pinned) with bundled `eng` "fast" LSTM data** | Yes, when core, worker and language paths are local and the IndexedDB cache is off | ~3 MB core plus ~2–4 MB data per language | Byte-stable for a pinned core build and fixed parameters, single thread, one SIMD flavor | Electron `utilityProcess`, like Zvec/AI | Apache-2.0 | **Recommended** |
| B. Native Tesseract 5 executable plus Leptonica DLLs, bundled | Yes | ~30–60 MB | Stable per build | Child process per call, or a host | Apache-2.0 / BSD | Larger; native crash surface; more signing work |
| C. Windows.Media.Ocr (WinRT) | Yes | 0 | **Varies by OS build and installed language packs** | Needs a WinRT bridge | OS | Not deterministic across machines; not calibratable |
| D. PaddleOCR / ONNX through onnxruntime-node | Yes | ~15–30 MB, plus a native runtime | Stable per build | Host | Apache-2.0 | Higher accuracy, but a heavier neural model, a native runtime and a second ML stack (conflicts with "no mandatory model") |
| E. The bundled CPython DOM-intelligence runtime plus pytesseract | No: needs B anyway | — | — | — | — | Rejected: the runtime is parser-only by decision (L11) |

**Recommendation: the A family (Tesseract 5 compiled to WASM).** Whether N7 uses the supported `tesseract.js`
wrapper or direct `tesseract.js-core` is decided by the N7.1a proof, not here (amended OC-1).
- Pin one build of whichever integration N7.1a selects and one SIMD flavor, recorded in the conditions envelope.
- Bundle only English "fast" data at first (OC-3).
- Load everything from `resources/ocr/`, never a CDN. The library's default remote language-data URL and its
  IndexedDB cache are disabled, and a verifier asserts no network request (§ Acceptance).

## Architecture

```text
Runner (main process) — StepExecutor
  assertImageText step (OC-5), or an N2/N5 shadow hook (N7.7)
    -> plan: flag AWKIT_VISUAL_OCR off | observe (default off); packaged build is observe only
    -> refusals BEFORE capture: handed-off page, protected surface, sensitive target (N6 container rule),
       not exactly one visible element, unsupported region (too small, too large, clipped)
    -> lazily loaded adapter src/runner/ocr/OcrStep.ts  (proposed FIFTH src/visual edge, OC-4)
         captureElement (N0, strict protected window, in memory)
         preprocess (pure, src/visual/ocr/preprocess.ts): grayscale, scale so x-height >= 20 px, no binarize by default
         -> OcrServices.recognize(crop, {lang, psm, deadlineMs, signal})   (injected by main)
               app/main/ocr/OcrUtilityHostManager.ts  (utilityProcess, lazy, idle shutdown, bounded restarts)
                  host: the N7.1a-selected Tesseract 5 WASM integration + resources/ocr/eng.traineddata (checksummed)
         -> pure decision src/visual/ocr/decideTextAssertion.ts: normalize, compare, confidence and ambiguity gates
    -> codes-only record -> InstanceReport.ocrAssertions (sanitized like N6.7)
```

- **Main process:** owns the host and passes only crop bytes, width, height and parameters. The host returns words,
  confidences and boxes. Raw text is held in the main process memory only for the decision, then dropped.
- **Renderer:** receives no pixels and no text from runs (OC-7). The Designer edits the authored expected text and
  options, and a Settings/Diagnostics card shows engine status only.
- **Isolation:**
  - The adapter is the only new `src/visual` edge, behind the lazy loader, and `verify:visual-isolation` moves to
    exactly five edges.
  - The host is not under `src/visual` and never imports it.
  - Nothing in the renderer, recorder or IPC reaches the host directly.

## Use in N7 (bounded)

1. **N7.5: observe-only text assertion step `assertImageText`.**
   - The author supplies the expected text and a match mode: `exact`, `contains` or `normalized`.
   - The step resolves its element through the DOM, OCRs only that element's crop, and records
     `matched | differs | inconclusive`.
   - It **never fails a step** in N7 (observe), and the packaged build is observe only.
2. **N7.7: advisory signals.**
   - **N2:** an OCR-vs-accessible-name similarity for a DOM-chosen candidate, shadow only, effect `none`.
   - **N5:** codes such as `target-text-differs-from-name` or `target-text-unreadable`, with counts and no text.
3. **Not in N7:**
   - finding elements by text in pixels;
   - recorder suggestions from OCR;
   - full-page OCR;
   - an enforcing assertion (a future milestone, OC-11).

## Security and privacy boundaries

- **Before any capture,** the same refusals as N6 apply:
  - `handoff-active`;
  - `protected-surface`, read in the strict protected window;
  - `sensitive-step`, using the N6.8 container rule: fields and labels inside the target, open shadow roots, embedded
    frames, and word-split names such as CVV, PIN, OTP, card, SSN, secret or token;
  - targets that aren't exactly one visible element.
- **Results:** a capture that becomes protected during the window is discarded, as N0 does.
- **Text handling:**
  - Recognized text is never logged, persisted, audited, exported or sent to the renderer by default.
  - Records hold codes, counts, normalized edit distance buckets and confidence buckets only.
  - Showing OCR text to an author is opt-in, Designer-only and transient (OC-7). If ratified, it needs WORKFLOW_EDIT
    and fresh re-authentication, like the N6 preview.
- **Memory:** crops and text live in memory only, and buffers are released after the decision. The host has no
  filesystem write paths and no network: the utility process is launched without network access, and a verifier
  enforces it.
- **Sensitive expected values (OC-8, amended proposal 2026-10-25).** An OCR comparison against a secret is itself
  an oracle: it reveals whether the secret is on screen. A literal `${secret.*}` check is therefore not enough. The
  expected text may be a literal or an ordinary runtime input or data-source field, and it is refused when any of
  these holds:
  - it references the secret store (`${secret.*}`) or a credential, OTP or password-typed runtime input;
  - it references a data-source field or runtime input whose name or label matches the N6.8 sensitive rule
    (password, OTP, PIN, CVV, card number, SSN, IBAN, account number, token, secret; word-split);
  - its resolved value matches a sensitive-value detector: a Luhn-valid card number, IBAN, SSN pattern, or a 4–8
    digit code in an OTP/PIN context.

  Refusal is static in the validator when the source is known at design time, and at run time (`sensitive-input`,
  inconclusive, zero captures, zero host calls) when a value resolves sensitive. The resolved value is never logged,
  audited or reported.
- **Licensing and packaging:** the engine and data are listed in the signed dependency manifest. A tampered or
  missing asset makes OCR `unavailable` (fail closed), never a download.

## Performance and resource budget (OC-9; to be measured in N7.6)

| Item | Budget |
|---|---|
| Disabled overhead | Zero: the adapter is never loaded, the host is never spawned, no added step latency (asserted by `verify:ocr-runtime`) |
| Crop size | ≤ 1.0 MP after scaling; larger crops are refused (`region-too-large`), never downscaled below the x-height floor |
| Recognition deadline | 1500 ms per assertion, including capture; late results dropped (`budget-exhausted`); target p95 ≤ 1000 ms on x64 |
| Host memory | WASM heap capped (initial 64 MB, maximum 256 MB); host RSS ceiling 400 MB, which recycles the host when exceeded |
| Concurrency | One recognition at a time per host; queue bound 4 per run; excess requests are `ocr-busy` (inconclusive) |
| Host lifetime | Spawned on first use; idle shutdown after 60 s; at most 3 restarts in 5 minutes, then `ocr-unavailable` for the session |
| Cancellation | Run cancellation and the deadline abort the request; the host discards the job; no result after abort |
| Package size | ≤ 8 MB added for English only |

## Persistence

- **Flow step (additive):** `assertImageText { expectedText, match, caseSensitive?, mode: "observe" }`.
  - The expected text counts in the step content digest.
  - The validator refuses an empty or over-long text (256 characters at most), and any sensitive source per OC-8.
    The runtime refuses a value that resolves sensitive.
- **Report:** the optional `InstanceReport.ocrAssertions[]` (max 64), rebuilt from an allowlist on write and read,
  N6.7-style:
  - fields: `{version, stepId, flowId, mode, status, verdict, code, distanceBucket, confidenceBucket, charCount,
    durationMs}`;
  - never text, pixels or boxes.
- **Nothing else is persisted:** no OCR cache, no baseline and no new store. Legacy reports and flows read unchanged.

## User-facing status

- **Settings → Diagnostics, read only:** "Offline text recognition: Off / Available (English) / Unavailable — reason".
  The reason is one of `assets-missing`, `checksum-mismatch`, `host-failed`, `disabled-in-this-build`.
- **Designer:** an *Image text* section on `assertImageText`. It shows the expected text, the match mode, "Observe
  only: never fails the step", and the latest recorded verdict as text (the N6.5 pattern). It never offers an enforce
  option in N7.
- **Run-detail drawer:** a text-only *Image text* section, with no image or recognized text (N6.7 pattern).

## Determinism and accuracy (fixtures and measurement)

- **New Lab page:** a mock-site **OCR Lab** (`/visual-intelligence/ocr`) with deterministic canvas- and SVG-rendered
  text in fixed fonts bundled with the mock site (no system fonts). Fixtures:
  - plain labels, numerals and dates;
  - small 9–11 px text, low contrast, anti-aliasing, a textured background;
  - look-alike pairs (`O/0`, `l/1/I`, `rn/m`, `5/S`) and near-miss strings (edit distance 1);
  - multi-line text, mixed case, long strings;
  - unsupported cases: non-Latin script, 15° rotation, vertical text;
  - protected and sensitive variants for the refusals.
- **Calibration (N7.6), like N6.6:**
  - cells: headed and headless × DPR 1, 1.25 and 2;
  - at least 3 sessions and 300 launches per cell;
  - criteria per OC-10: on supported fixtures, exact-match rate ≥ 98 % and character error rate ≤ 1 %; on near-miss
    and look-alike fixtures, a false `matched` rate of **0**; on unsupported fixtures, `inconclusive` 100 %; p95 within
    the deadline.
  - A cell that fails stays observe-only and unlabeled; there is no tuning against the fixtures after the fact.
- **Targets, not results (amended proposal 2026-10-25).** Every accuracy, error-rate, latency, memory and size figure
  in this plan is a pre-agreed TARGET or acceptance criterion. None is a measured claim. A figure becomes a claim
  only when `benchmark:ocr` (and the N7.1a/N7.1b proofs for the budgets) has executed and recorded it. Until then
  every report says "target", and a missed target is reported as missed, never re-stated.
- **Fail-closed rules in the pure decision:**
  - any word below the confidence threshold, or a look-alike glyph in the compared span below a higher threshold,
    gives `inconclusive`;
  - edit distance 1 from the expected text gives `inconclusive`, never `matched`;
  - more than one region match for `contains` gives `inconclusive`.

## Owner decisions — final matrix (RATIFIED 2026-10-26, N7.1; DECISIONS 2026-10-26)

Status key:
- **Original:** as first proposed on 2026-10-25.
- **Amended (owner recommendation):** changed on the owner's 2026-10-25 instruction (OC-1, OC-2).
- **Amended (correction):** changed by the final corrections later that day (OC-8, OC-9, OC-10, OC-12; OC-1 also
  carries the N7.1a/N7.1b split).

**All thirteen rows were ratified by the owner on 2026-10-26 in the wording below (N7.1).** The ratification also
fixed the sequencing in § Work breakdown. It authorizes only the bounded N7 implementation described here. It does
not authorize:
- production OCR enforcement;
- image-based target selection;
- cloud services or runtime downloads;
- a general-purpose AI model.

| ID | Status | Exact recommended wording | Recommendation |
|---|---|---|---|
| OC-0 | Original | "N7 delivers an observe-only `assertImageText` step and shadow-only N2/N5 text signals (effect `none`). It delivers no enforcement, no text-based target selection or locator generation, no recorder suggestion and no full-page OCR." | Ratify |
| OC-1 | Amended (owner recommendation, then correction) | "The engine family is offline Tesseract 5 compiled to WASM, run in an Electron utility process. The integration (the supported `tesseract.js` wrapper or direct `tesseract.js-core`) is chosen by the N7.1a source/runtime feasibility proof. The proof requires compatible pinned versions, an isolated runtime, locally bundled language assets with zero network requests, cancellation and CPU-only operation. Real packaged compatibility is proven separately by N7.1b on an approved release environment. The chosen integration and its evidence are recorded before N7.3 and N7.4 begin." | Ratify as amended |
| OC-2 | Amended (owner recommendation) | "`eng.traineddata` is a trained OCR recognition model (Tesseract's LSTM weights). It is an optional, fixed-function, offline inference dependency: pinned, checksummed, bundled, never downloaded, never generative and never required. The SpecterStudio automation platform operates independently and unchanged when it is absent, disabled or failing. It is not a mandatory AI model under the Phase N rules." | Ratify as amended |
| OC-3 | Original | "English only for the first qualification. Each further language needs its own owner decision and its own calibration." | Ratify |
| OC-4 | Original, kept as proposed | "A fifth approved `src/visual` edge, `src/runner/ocr/OcrStep.ts`, lazily loaded. `verify:visual-isolation` is moved to exactly five edges, and the OCR host stays outside `src/visual`." | Ratify (stays proposed until then) |
| OC-5 | Original | "A new step type `assertImageText`: an unknown step type fails closed, whereas an existing assertion type would fall through to a text check." | Ratify |
| OC-6 | Original | "Flag `AWKIT_VISUAL_OCR=off\|observe`, default off. The packaged build is observe only. Off means the adapter is never loaded and the host never spawned." | Ratify |
| OC-7 | Original | "Recognized text never leaves the main process and is never persisted, logged, audited, exported or sent to the renderer. An author-facing transient text preview is out of N7. If wanted later, it needs WORKFLOW_EDIT, fresh re-authentication and audit, as the N6.5 preview does." | Ratify |
| OC-8 | Amended (correction) | "`assertImageText` refuses any expected value that is or may be sensitive: a `${secret.*}` reference; a credential, OTP or password-typed runtime input; a runtime input or data-source field whose name or label matches the N6.8 sensitive rule (password, OTP, PIN, CVV, card number, SSN, IBAN, account number, token, secret; word-split); or a resolved value matching a sensitive-value detector (Luhn-valid card number, IBAN, SSN pattern, or a 4–8 digit code in an OTP/PIN context). Known sources are refused statically by the validator. Values that resolve sensitive are refused at run time as `sensitive-input` (inconclusive, zero captures, zero host calls). A resolved value is never logged, audited or reported." | Ratify as amended |
| OC-9 | Amended (correction) | "The resource budget in this plan is a set of TARGET gates. Each becomes a measured claim only after N7.1a, N7.1b or N7.6 has executed and recorded it. A missed target is reported as missed." | Ratify as amended |
| OC-10 | Amended (correction) | "Calibration cells and criteria as written: headed and headless × DPR 1, 1.25 and 2; at least 3 sessions and 300 launches per cell; exact-match ≥ 98 % and CER ≤ 1 % on supported fixtures; 0 false `matched` on near-miss and look-alike fixtures; 100 % `inconclusive` on unsupported fixtures; p95 within the deadline. These are acceptance criteria, not results. A failing cell stays observe-only with no relabelling and no tuning against the fixtures." | Ratify as amended |
| OC-11 | Original | "Enforcing OCR assertions are a separate future milestone, gated like `awkit-vra.16`, and are not part of N7." | Ratify |
| OC-12 | Amended (correction) | "N7.3 packages exactly the engine N7.1a selected, with its `eng` data in `resources/ocr/` and in the signed dependency manifest. `validate:offline -Strict`, N7.1b and `verify:ocr-packaged` must prove no network and no download. Packaged gates stay BLOCKED until the approved release environment exists (`verify:packaging-host` READY)." | Ratify as amended |

## Feasibility proofs (N7.1a source/runtime, N7.1b packaged; required by amended OC-1)

**N7.1a, source and runtime feasibility.** It runs on the development host now. A small spike kept in `scripts/` as
reproducible evidence (no product wiring, no flag, nothing shipped) answers every row below EXCEPT package
compatibility, with measured evidence.

**N7.1b, real packaged compatibility.** The "Package compatibility" row is a separate proof on a real packaged build:
the chosen engine's assets inside the 0.1.x package (ASAR and unpack rules, signed manifest, strict offline
validation), loaded by the packaged app with zero network. It stays **BLOCKED** until the approved release
environment is available (`npm run verify:packaging-host` READY; currently BLOCKED by the Visual Studio 2022 MSVC
prerequisite). N7.1a never claims it.

| Question | Pass condition |
|---|---|
| Pinned versions | One `tesseract.js` (wrapper) and one `tesseract.js-core` version run on Node in an Electron 33 `utilityProcess`, x64, with integrity hashes recorded |
| Isolated runtime | Recognition runs in the utility process only; a crash or hang there leaves the main process serving IPC |
| Local assets | Core WASM, worker script and `eng.traineddata` load from a local folder; the wrapper's remote language URL and IndexedDB cache are disabled; a request interceptor and an offline host see **zero** network requests, including first use |
| Cancellation | An abort mid-recognition ends the job; no result arrives after the abort; the next job succeeds |
| Package compatibility (N7.1b only) | On a real packaged build: the assets survive `electron-builder` ASAR/unpack rules and the signed dependency manifest; size within the OC-9 budget; the packaged app loads them with zero network |
| Wrapper vs core | Compare API surface, worker model, cancellation support and network defaults; pick the one that meets every row with the least code |
| CPU only | Runs on CPU with no GPU or NVIDIA requirement; WASM SIMD flavor fixed and recorded |

**Outcome of N7.1a:** a recorded choice (wrapper or core) with its source/runtime evidence, or a recorded failure
that returns OC-1 to the owner. N7.1b then confirms or refutes that choice in a real package. Nothing in the product
changes in either proof.

## Work breakdown (filed after ratification)

**Dependency order (ratified 2026-10-26):**

| Item | Depends on |
|---|---|
| N7.1a | N7.1 |
| N7.2 | N7.1 only. It is pure and engine-independent; no `tesseract` type or API appears in it |
| N7.3 | N7.1a (the selected engine) |
| N7.4 | N7.1a and N7.3 |
| N7.5 | N7.2 and N7.4 |
| N7.1b | N7.3 and N7.4, plus the approved packaging host. It is not a prerequisite for N7.2–N7.5 |
| N7.6 | N7.5 |
| N7.7 | N7.5 |
| N7.8 | N7.1b, N7.5 and N7.6. Final packaged OCR acceptance is mandatory |
| N7.9 | N7.6, N7.7 and N7.8. It cannot close N7 while any mandatory packaged evidence is BLOCKED or NOT RUN |

| Item | Content | Gate |
|---|---|---|
| N7.1 | Ratify OC-0 to OC-12 (OC-1 and OC-2 as amended 2026-10-25) | DONE 2026-10-26: owner decision recorded in DECISIONS |
| N7.1a | Source/runtime feasibility proof (§ above): wrapper vs core, pinned versions, isolation, local assets, zero network, cancellation, CPU only | Recorded engine choice with evidence (`benchmark:ocr-feasibility`, spike in `scripts/ocr-feasibility/`) |
| N7.1b | Real packaged compatibility of the N7.1a choice, after N7.3 and N7.4 | BLOCKED until `verify:packaging-host` is READY; then a packaged proof with zero network |
| N7.2 | Pure `decideTextAssertion` (normalize, compare, confidence and look-alike gates) and preprocessing, in `src/visual/ocr` with no I/O | `verify:ocr-decision` with mutants |
| N7.3 | Packaging of the engine N7.1a selected (the `tesseract.js` wrapper or `tesseract.js-core`, pinned) and the `eng` data in `resources/ocr/`, manifest entries, offline validation, a dependency review | `validate:offline -Strict`, `verify:ocr-assets`; packaged load proven by N7.1b |
| N7.4 | OCR utility host and `OcrUtilityHostManager` (lazy spawn, deadline, cancel, idle shutdown, restarts, heap cap, no network) | `verify:ocr-host` (crash, hang, abort, memory, no-network) |
| N7.5 | `assertImageText` step, validator, adapter (fifth edge), refusals, record and report block, Designer and drawer sections | `verify:ocr-runtime`, `verify:ocr-report`, `verify:visual-isolation` at 5, `verify:ocr-gui` |
| N7.6 | OCR Lab and calibration benchmark | `benchmark:ocr`, `verify:ocr-calibration` |
| N7.7 | Shadow N2 and N5 signals, effect `none` | `verify:visual-fusion-runtime` and `verify:visual-diagnosis-runtime` extended |
| N7.8 | Packaged acceptance: observe only, no network, no download, disabled mode identical | `verify:ocr-packaged` |
| N7.9 | Independent QC and security review, then closure | APPROVED from both |

## Acceptance criteria

1. Disabled by default and byte-identical in behavior: runs, reports and exports are unchanged; the adapter is not
   loaded and the host is never spawned (`verify:ocr-runtime`, `verify:runner`).
2. No network or download at any point, including first use. The packaged run is proven by request interception and
   the host's no-network launch (`verify:ocr-packaged`, `validate:offline`).
3. Every protected, handed-off and sensitive target is refused with zero captures and zero host calls.
4. Ambiguity fails closed: zero false `matched` on near-miss and look-alike fixtures in every cell.
5. The resource budget holds: deadline, heap cap, queue bound, idle shutdown, crash and restart bounds, and
   cancellation with no late result.
6. No recognized text reaches disk, logs, the audit trail, exports or the renderer (byte scans in the report and GUI
   verifiers).
7. `verify:visual-isolation` shows exactly five approved edges, and the host is outside `src/visual`.
8. Calibration evidence is recorded per cell, with criteria met or the cell kept observe-only.
9. Fresh-context QC and security review are APPROVED.

## Rollback and disable

- `AWKIT_VISUAL_OCR=off` (the default) disables everything.
- Removing `resources/ocr/` makes OCR `unavailable` without affecting any run.
- Saved `assertImageText` steps then record `disabled` and pass. Observe never fails a step.

## Risks

- **WASM determinism across CPUs (SIMD paths):** mitigated by pinning one flavor and recording it in the conditions
  envelope; calibration is per environment.
- **UI text accuracy:** small, anti-aliased UI text is harder than documents. Mitigated by the x-height scaling floor
  and the fail-closed thresholds; cells that miss stay observe-only.
- **Hidden network in the library:** the JS wrapper fetches language data from a CDN by default. Mitigated by local
  paths only, the cache disabled, a host launched without network, and an interception test.
- **Privacy:** OCR can read anything on screen. Mitigated by DOM-scoped crops only, the sensitive and protected
  refusals, and no text persistence.
- **Scope creep toward text-based targeting:** excluded by OC-0, and a verifier asserts that no locator or action path
  consumes OCR output.

## Exact next task

N7.1 is done (ratified 2026-10-26). Next:
- N7.1a, the feasibility proof;
- N7.2, the pure decision, which needs only N7.1.

N7.3 onward waits for the N7.1a engine choice.
