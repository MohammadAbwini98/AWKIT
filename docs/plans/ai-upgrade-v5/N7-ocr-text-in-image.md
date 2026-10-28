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

**N7.1a result (2026-10-26, later): GO, direct `tesseract.js-core` 6.0.0** (DECISIONS 2026-10-26, evidence
`scripts/ocr-feasibility/results/latest.json` at `cfee499`).
- The owner installed the pinned dependencies, and the lockfile is committed.
- Wrapper PASS 13/13 and core PASS 13/13.
- The core was selected under the least-integration-code rule, 71 lines vs 76.
- The first real run exposed a harness defect: the network log was pulled from a host blocked in synchronous
  recognition. It was fixed before the deciding run, with the criteria unchanged.
- The history below records the earlier blocked state.

**Earlier N7.1a status (2026-10-26): BLOCKED on dependency acquisition, an owner action.**

- **Spike** (commit `a805ca7`): `scripts/ocr-feasibility/` has its own `package.json` with exact pins. It is never
  bundled: electron-builder packages only `out/**` and the listed root files. Pins:
  - `tesseract.js` 6.0.1;
  - `tesseract.js-core` 6.0.0;
  - `@tesseract.js-data/eng` 1.0.0.

  The spike is run by `npm run benchmark:ocr-feasibility`.
- **Gates**, declared in the launcher before any candidate ran. Each candidate runs in an Electron 33
  `utilityProcess`:
  - runtime: Windows x64;
  - cold first-run init with empty cwd and cache folders, local data, and cache off;
  - recognition of three rendered fixtures;
  - memory: peak working set ≤ 400 MB, and growth ≤ 64 MB over 10 recognitions;
  - cancellation: either a cooperative cancel acknowledged within 1500 ms, or an abort by kill, with no late result
    and the next job succeeding;
  - crash and hang isolation, with the main process staying responsive;
  - network: zero attempts, enforced by a tripwire on the host thread and in worker threads, plus zero Chromium
    requests;
  - cleanup, integrity (pinned version and lockfile integrity, SHA-256 of the loaded files), and licensing
    (allowlist).
- **Selection rule:** of the candidates that pass every row, the one with the least integration code. If none
  passes, the result is NO-GO and the engine choice returns to the owner.
- **Executed:** the harness self-test, on a probe host with a fake engine, passed 10/10. It covered:
  - init, cooperative cancel, abort by kill;
  - crash detection (exit 134) and hang detection and kill;
  - late-result detection;
  - memory metrics;
  - cleanup;
  - the tripwire, which caught two host-thread attempts and one worker-thread attempt.

  Evidence: `scripts/ocr-feasibility/results/latest.json`.
- **NOT RUN:** both candidates. Their packages are not installed, and the agent's command grammar has no install
  verb. The owner runs:

  ```
  npm install --prefix scripts/ocr-feasibility --ignore-scripts --no-audit --no-fund
  ```

  then `npm run benchmark:ocr-feasibility`, and the result file records GO (with the selection) or NO-GO.
- **Integrity review (2026-10-26, second session; still no install).** The owner command was refused by the lease
  guard, and the recovery adapter authorizes only Edit/Write targets and `git add` paths, so the status is still
  BLOCKED. The harness was hardened; no gate was relaxed, and no candidate has run under either version.
  - **New mandatory `localAssets` gate.** Every module resolution and fs read of a core JS/WASM or traineddata file is
    recorded on the host thread and, through the worker shim, in worker threads. The candidate must have loaded a
    core file and a traineddata file, all from the spike folder. For the wrapper, the shim must also report that it
    loaded, which proves the worker-thread tripwire was really in place. The core flavor loaded is recorded.
  - The tripwire now also covers Electron's `net` module in the utility process.
  - **Its limit is recorded in the result:** the evidence is API interception plus Chromium request blocking, not an
    OS-level offline proof.
  - The wrapper's integration count no longer includes the measurement-only shim.
  - Each package's remote URL defaults are listed (INFO).
  - The result records that both candidates share the same fixture hashes and gated rows.
  - Harness self-test: 11/11, including the new `fileProvenance` row, which caught a worker-thread load through the
    shim.
- **Unproven:** the candidate hosts (`host-wrapper.cjs`, `host-core.cjs`) are syntax-checked only. The direct-core
  host uses the embind calls the wrapper's own worker makes (`SetImageFile`, `Recognize`, `GetUTF8Text`). A mismatch
  with the installed build is reported as that candidate's failure, with the available methods listed.

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
| N7.2 | Pure `decideTextAssertion` (normalize, compare, confidence and look-alike gates) and preprocessing, in `src/visual/ocr` with no I/O | DONE 2026-10-26 (`a0039e2`): `verify:ocr-decision` 203/0 with 23 mutants red. The 80/92 thresholds are uncalibrated until N7.6 |
| N7.3 | Packaging of the engine N7.1a selected (the `tesseract.js` wrapper or `tesseract.js-core`, pinned) and the `eng` data in `resources/ocr/`, manifest entries, offline validation, a dependency review | DONE 2026-10-26 (`00572f3`, `4f29564`): `verify:ocr-assets` 46/0; staged 5,968,312 bytes; `validate:offline` non-strict PASS. Strict validation of a real release moves with the packaged load to N7.1b (BLOCKED) |
| N7.4 | OCR utility host and `OcrUtilityHostManager` (lazy spawn, deadline, cancel, idle shutdown, restarts, heap cap, no network) | DONE 2026-10-26 (`d4b986a`, `3cf9abb`): `verify:ocr-host` 49/0 with the real engine in real utility processes |
| N7.5 | `assertImageText` step, validator, adapter (fifth edge), refusals, record and report block, Designer and drawer sections | `verify:ocr-runtime`, `verify:ocr-report`, `verify:visual-isolation` at 5, `verify:ocr-gui` |
| N7.6 | OCR Lab and calibration benchmark | IMPLEMENTED 2026-10-27, NOT QUALIFIED: `verify:ocr-calibration` 67/0. One qualifying session (69 launches) ran in the bundled font. **OC-10 zero-false-matched is VIOLATED** in 4 cells (`lookalike-l1` 8 of 11 trials). The campaign is stopped pending an owner decision (see § N7.6 below) |
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

Done:
- N7.1 (ratified);
- N7.1a (GO: direct tesseract.js-core);
- N7.2 (pure decision);
- N7.3 (assets);
- N7.4 (host and manager);
- N7.5 (`4a47d9e`, `9a488ab`, 2026-10-27; source build only).

N7.5 implementation decisions, recorded against OC-9 (no ratified figure changed):
- **Deadline contract.**
  - One 1500 ms deadline from the step's start.
  - An outcome that lands after it is `budget-exhausted`, judged by the wall clock, so a verdict is never recorded
    late.
  - The step settles within the deadline plus a 150 ms margin, unless synchronous main-thread work holds the timers.
  - `durationMs` is the whole operation.
- **Host start-up.**
  - The engine is prepared once every pre-capture refusal has passed, so a refused assertion never starts a host.
  - A deadline overrun answers at once and lets the host finish within a 1 s grace; past the grace the host is killed.
  - After a kill the replacement starts at once. Cancellation still kills immediately.
- **Development assets.** The development-only `AWKIT_OCR_DEV_ASSET_DIR` serves a local staging (not the Parallels
  share). Packaged builds ignore it.

### N7.6 (`awkit-vra.9.7`), 2026-10-27: IMPLEMENTED, NOT QUALIFIED, stays open

**What exists.**
- **Lab.** `/visual-intelligence/ocr?calibration=1` (the N7.5 lab, extended) renders 28 pre-declared fixtures from
  `mock-site/public/ocr-fixtures.json` in four classes: 13 supported, 8 confusable, 4 unsupported, 3 refusal. It uses
  the bundled `AwkitOcrLab` font only (`@fontsource/noto-sans` 5.3.0, OFL-1.1, integrity-pinned). Fixture identity,
  checksum and provenance are in `mock-site/README.md`.
- **Criteria.** `scripts/lib/ocr-calibration-criteria.mts` is pure and was fixed before measuring:
  - exact match = matched / all supported trials, budget-exhausted and refusals included;
  - CER = Σ edits / Σ expected characters, with an unread trial counting every character;
  - zero false `matched` among confusable trials;
  - 100 % unsupported inconclusive;
  - refusals return the expected code with zero captures;
  - the p95 is taken over the supported and confusable trials;
  - ≥ 300 complete launches over ≥ 3 sessions of one identical environment;
  - no exclusions.

  Diagnostic, cold-probe, failed, duplicated and other-environment launches never qualify.
- **Harness.** `benchmark:ocr` (`scripts/benchmark-ocr.mts`, Electron main `scripts/ocr-calibration/calibrationMain.ts`)
  follows the N6.6 pattern:
  - resumable 7-minute sessions with round-robin over the six cells and a fresh Chromium per launch;
  - each trial goes through the real FlowExecutor, StepExecutor, OcrStep and N0 capture, then the production
    `OcrUtilityHostManager` and the real Tesseract host;
  - an environment fingerprint binds the fonts, fixtures, lab, pipeline sources, staged assets, policy and runtime;
  - the recognized text never leaves memory: only edit counts are stored.
- **Instrumentation.** OcrStep has an optional probe with phase marks; production passes none. The probe covers
  pre-assess, protected, target and sensitive checks, the N0 capture, preprocessing, the recognize call (engine time
  apart from queue and IPC), settlement, event-loop lag, cold and warm host, and an out-of-clock N0 screenshot and
  decode replay.

**Qualification: BLOCKED.** `npm run benchmark:ocr` refuses with exit 2 because the bundled font is not staged. The
qualifying launch count is 0 in every cell. Owner action:
`npm install --prefix mock-site/fonts-src --ignore-scripts --no-audit --no-fund`, then
`npm run prepare:ocr-lab-fonts`. After that, about 22 sessions of `npm run benchmark:ocr` are needed (about 85
launches each, 1,800 in total); `npm run benchmark:ocr-report` decides.

**Diagnostic evidence.** This is the system-font fallback, so it never qualifies.
- Two 7-minute sessions at the current fixture hash: 175 launches, 0 errors. Of these, 164 count toward the cells and
  11 are cold-host probes, reported apart.
- One earlier 8-launch smoke session ran under the previous fixture hash and is not merged.
- Environment: ARM64 Windows VM, with x64 Electron and Node under emulation.

| Cell | Launches | Exact match | CER | False matched | p50 / p95 / p99 ms |
|---|---|---|---|---|---|
| headed DPR 1 | 30 | 74.4 % | 1.17 % | 3/30 | 603 / 806 / 1401 |
| headed DPR 1.25 | 29 | 85.1 % | 1.59 % | 3/29 | 606 / 806 / 1283 |
| headed DPR 2 | 23 | 92.8 % | 0 % | 3/23 | 669 / 881 / 1109 |
| headless DPR 1 | 29 | 73.6 % | 0.47 % | 4/29 | 585 / 735 / 1146 |
| headless DPR 1.25 | 29 | 83.9 % | 0 % | 4/29 | 578 / 723 / 774 |
| headless DPR 2 | 24 | 93.1 % | 0 % | 3/24 | 669 / 898 / 959 |

In every cell, unsupported fixtures were 100 % inconclusive and refusals 100 % correct with zero captures.

**Accuracy findings.** All must be re-measured in the bundled font.
- `lookalike-l1` ("Batch l42" against an expected "Batch 142") was matched 22 of 22 times. The engine reads l as 1 at
  ≥ 92 confidence, so the look-alike gate cannot see it.
- `mixed-case` (exact) was `lookalike-uncertain` 38 of 39 times.
- `small-11` matched 12 of 42 and `small-10` 26 of 42.
- The thresholds were not tuned.

**Timing diagnosis.** p50 / p95 ms, warm host.

| Stage | p50 / p95 ms |
|---|---|
| Pre-assess | 8–10 / 16–22 |
| Protected check | 51–59 / 84–98 |
| Target and sensitive checks | 83–91 / 125–146 |
| **N0 guarded capture (dominant)** | **359–471 / 435–617** |
| Preprocessing | ≈ 1 / 2–5 |
| Recognize call | 47–61 / 105–187 |
| Engine alone | 45–57 |
| Queue and IPC | 2–3 |
| Settlement | 1–2 / 3–5 |
| Whole operation | 577–683 / 716–881 |

- The out-of-clock replay of N0's screenshot plus PNG decode costs 100–210 ms: decode is 22–24 ms at DPR 1, 35–38 ms
  at DPR 1.25 and 91–97 ms at DPR 2. That leaves about 250–300 ms of N0 guard, geometry and stillness work inside the
  capture.
- Event-loop lag reaches 88–144 ms at DPR 2.
- **Cold host** (n = 14): recognize-call p50 622 / p95 1450 ms, whole operation p50 1346 / p95 2232 ms, 3 of 14
  budget-exhausted. One trial had a 504 ms event-loop stall during the host fork. No late verdict was recorded.
- **Warm host** (n = 762): whole operation 610 / 811 ms.
- The prior figures, treated as hypotheses, came out as follows:
  - capture 650–1000 ms becomes about 360–620 ms in the harness;
  - checks 150–450 ms are confirmed at about 140–245 ms;
  - warm recognition 60–150 ms is confirmed;
  - cold start of about 1200 ms is confirmed (1346 ms p50);
  - the in-app p95 of 1510 ms is not reproduced standalone, which points to about 500 ms of app main-thread
    contention (`verify:ocr-gui` this run: p95 1664 ms, 3 of 12 budget-exhausted).
- **Emulation isolation: INCONCLUSIVE.** Both runtimes are x64 under emulation, and no native ARM64 runtime is
  available to compare. The x64 1000 ms OC-9 objective is unmeasured.

**First qualifying session in the bundled font (2026-10-27).**
- Font and session:
  - The font was staged by the owner in `d9b5af9`: Noto Sans 5.3.0, OFL-1.1. Latin sha256 `09aee806…7937d6`, Greek
    `c7c42b4b…95d0d6`, Cyrillic `05af9e70…f126ba`, `ofl.txt` `54ec7b5a…3009e1`. It is verified against the lockfile
    pin and is byte-identical to the installed package.
  - Session `2026-10-27T17-21-44-341Z-e52a5a5f`: 69 launches, 0 errors, 0 failed. Fewer launches than the diagnostic
    sessions (85–90).

| Cell | Launches | Exact match | CER | False matched | p50 / p95 / p99 ms |
|---|---|---|---|---|---|
| headed DPR 1 | 12 | 86.1 % (31/36) | 4.96 % | **2/12** | 632 / 1510 / 1519 |
| headed DPR 1.25 | 12 | 94.4 % (34/36) | 0 % | **2/12** | 662 / 978 / 1321 |
| headed DPR 2 | 10 | 93.3 % (28/30) | 0 % | 0/10 | 809 / 1231 / 1448 |
| headless DPR 1 | 11 | 93.9 % (31/33) | 0 % | **2/11** | 622 / 814 / 1352 |
| headless DPR 1.25 | 11 | 93.9 % (31/33) | 0 % | **2/11** | 602 / 803 / 884 |
| headless DPR 2 | 9 | 92.6 % (25/27) | 0 % | 0/9 | 741 / 1112 / 1348 |

In every cell, unsupported fixtures were 100 % inconclusive and refusals 100 % correct with zero captures. Every cell
is UNQUALIFIED.

- **Per fixture, codes only:**
  - `lookalike-l1`: **matched 8 of 11** (text-matched), lookalike-uncertain 3. Every other confusable fixture was
    inconclusive in every trial:
    - O0: near-miss 12/12;
    - I1: near-miss 9, budget-exhausted 1;
    - rnm: lookalike-only-difference 8/8;
    - 5S: near-miss 6/6;
    - the three near misses: near-miss throughout.
  - `mixed-case`: 13/13 matched, so the fallback-font failure was the font.
  - `small-9` (DPR ≥ 1.25): 10/10. At DPR 1 it is region-too-small 6/6, as declared.
  - `small-10`: 16/16. `small-11`: 16/16.
  - **`multiline`: 0/13** (lookalike-uncertain 8, low-confidence 5). This is a genuine supported miss in this font.
  - `plain-label` and `antialiased`: 1 budget-exhausted each.
- **Root cause of the l/1 false match: recognition, not rendering, normalisation or the decision policy.**
  - The trials are `text-matched`, so the engine returned exactly the expected text "Batch 142" for the rendered
    "Batch l42" (distance 0). With distance 0, `decideTextAssertion` has only the confidence gates left. The
    look-alike gate requires ≥ 92 on a word holding a `1/l/I` class glyph. The engine reported ≥ 92 in 8 trials, and
    below 92 in the 3 that were caught.
  - Rendering is not the cause: Noto Sans `l` is a plain stem and `1` carries a top flag.
  - Normalisation is not the cause: NFKC plus whitespace never maps `l` to `1`, and the look-alike fold is only
    consulted when distance > 1.
  - The engine's word confidence does not express the l/1 ambiguity inside a digit run. No threshold the gate can
    hold separates a confident misread from a confident correct read: both are exact strings at ≥ 92.
  - More sessions cannot fix this; repetitions only accumulate the violation.
- **Proposed fail-closed correction.** This needs owner approval, because it adds a verdict rule under OC-3/OC-10.
  - Add a per-symbol gate. The host returns, codes only and never text, the per-symbol confidence and the
    second-choice margin for each glyph in a look-alike class. The decision demotes `text-matched` to
    `lookalike-uncertain` when any such glyph's margin over a class-mate is below a pre-declared floor.
  - This is not a blanket l/1/I refusal: a glyph that the engine separates confidently still matches.
  - Effect on legitimate assertions: supported fixtures that contain `1`, `l` or `I` (`plain-label`, `amount`,
    `date`, `number`, `long`, `small-10` and `small-11`) may lose matches. That must be measured before the floor is
    ratified.
  - The first step is a diagnostic-only probe, which changes no verdict: record the per-symbol margins for
    `lookalike-l1` and the supported fixtures, and check whether a separating floor exists. If none exists,
    OC-10's zero-false-matched rule cannot be met with this engine and data, and the owner decision is about scope.
    Options: declare digit runs adjacent to `l/1/I` unsupported, or accept observe-only N7 without calibrated cells.
- **The deadline defect reproduces on cold start.** 4 of 5 cold-host trials were budget-exhausted, with the whole
  operation at p50 1506 / p95 1524 ms. The verdicts stayed correct and none was late. The headed DPR 1 p95 of 1510 ms
  is that cell's natural cold first trial.
  - Warm host, n = 286: recognize call 62 / 173 ms, whole operation 652 / 1083 ms.
  - The N0 capture is still dominant at 357–539 ms p50.
  - Event-loop lag reaches a p95 of 158–192 ms in headed DPR 1 and the DPR 2 cells.
  - Emulation isolation is still INCONCLUSIVE: Electron and Node are both x64 under emulation.

**Ambiguity feasibility probe (2026-10-27, DIAGNOSTIC ONLY, owner-approved).** Probe committed before measurement in
`a7c2b64`: `benchmark:ocr-ambiguity` and `verify:ocr-ambiguity` 55/0. It changes no verdict, threshold, deadline, engine,
data, N0 or host policy, and nothing in `app/`, `src/` or `native-hosts/` reaches it.
- **Reproduction.** The qualifying session was read-only, with its SHA-256 identical before and after. It confirms
  `lookalike-l1` `text-matched` 8 of 11 (DPR 1 and 1.25), `multiline` 0 of 13, and cold-host budget-exhausted 4 of 5.
- **Pinned-engine API (tesseract.js-core 6.0.0 SIMD LSTM, as staged).**
  - Exposed: `ChoiceIterator(ResultIterator)` with `Next`, `GetUTF8Text` and `Confidence`; `WordChoiceIterator`; and
    the `lstm_choice_mode`, `lstm_choice_iterations` and `lstm_rating_coefficient` parameters (`SetVariable` true, an
    unknown name false).
  - Not exposed: `ResultIterator.GetChoiceIterator`, `GetBestLSTMSymbolChoices` and raw timesteps.
  - At mode 0 (production) every symbol has exactly 1 choice. At mode 2 every symbol has 6, with no recompile.
  - Mode 2 gave the same text and word confidences as production in 204 of 204 trials, with 0 verdict changes.
  - **API feasibility: GO.**
- **Run.** One run, `2026-10-27T19-47-45-092Z-bb9be8bb.json` in `%LOCALAPPDATA%/SpecterStudio/ocr-calibration/ambiguity`.
  - 6 launches of 7 in 488 s: one `headed-dpr1.25` launch failed to load the lab, and the 8-minute budget stopped new
    launches after a slow first launch of 148 s. Only `headed-dpr1` got a second repetition.
  - 204 trials measured. 12 were refused: `small-9` region-too-small 3 at DPR 1, and capture budget-exhausted 9 in
    the slow launch.
  - Every trial ran through the production N0 `captureElement` and `preprocessForOcr`, then in rotated order the
    production pass (mode 0, word walk), a mode 0 symbol walk and a mode 2 symbol walk; `multiline` also ran PSM 4.
- **Separability: NOT SEPARABLE, so INCONCLUSIVE for any safe threshold.** A floor is chosen on development only
  (the calibration fixtures with l, I or 1) and judged on the pre-declared confirmation set.

  | Trial minimum over l/1/I glyphs | Development false (n 4) | Development legitimate (n 51) | Confirmation false (n 14) | Confirmation legitimate (n 70) |
  |---|---|---|---|---|
  | Class margin (choice scale) | 87.2–95.1 | 42.0–95.1 (p50 92.8) | 52.1–75.2 (p50 65.3) | 35.2–95.2 (p50 91.9) |
  | Symbol confidence | 99.52–99.53 | 98.93–99.57 | 99.08–99.46 | 98.87–99.57 |
  | Word confidence | 95.4–95.9 | 92.3–96.9 | 93.6–96.2 | 92.1–96.8 |

  - Every false value lies inside the legitimate range on all four metrics, in both sets. The any-alternative margin
    equals the class margin: the runner-up is a class mate.
  - Per glyph: misread l/1 glyphs have a class-margin p50 of 87.2 (development, n 6) and 52.1 (confirmation, n 29).
    Correct glyphs have 94.1 (n 156) and 93.1 (n 265), with a minimum of 2.9. That is a tendency, not a separation.
  - Removing all 18 observed false matches needs a class-margin floor above 95.1. That demotes nearly every
    legitimate match holding 1, l or I: legitimate values top out at 95.2, and the supported match rate in this
    probe, 121 of 135, would collapse. **No candidate rule meets criteria 1 and 2 together.**
- **The false match is systematic, not one fixture.**
  - It occurs when a rendered `l` leads or sits inside a digit run: `cf-neg-item` 5 of 6, `cf-neg-batch-mid` 5 of 6,
    `cf-neg-lot` 3 of 6, `cf-neg-tag-small` 1 of 5, `lookalike-l1` 4 of 6.
  - It does not occur with `I` in a digit run, which reads as near-miss or low-confidence (`lookalike-I1`,
    `cf-neg-seat-cap`, `cf-neg-room-cap`), or with a trailing `l` (`cf-neg-unit-end`, near-miss 6 of 6).
  - Every measured cell had at least one false match, including DPR 2 in the confirmation set: 14 of 39 negatives.
- **Legitimate supported matches.** Positives holding 1, l or I matched 121 of 135.
  - The existing N7.2 look-alike gate already costs some: `cf-pos-level` 3 of 6, `cf-pos-office` 3 of 6 and
    `cf-pos-login` 2 of 5 are `lookalike-uncertain`, and dev `multiline` is 0 of 6.
- **Multiline root cause: OCR confidence on a line that starts with a lone digit. It is not segmentation, word
  boundaries, newline normalization or preprocessing.**
  - The read was exact in 6 of 6 trials, with 2 lines, 5 words and the word count right. PSM 4 gave the same codes.
  - The first two words of line 2 share one confidence per trial: 47.8 (low-confidence, 3) or 85.7–86.8 (3). The
    folded look-alike gate then needs ≥ 92 on the second word, so those 3 are `lookalike-uncertain`.
  - Controls: the same text on one line matched 6 of 6, and line 1 alone 6 of 6. Line 2 alone failed exactly like the
    fixture. The look-alike gate contributes to half the misses. Nothing in production was changed.
- **Overhead, probe host only, x64 Node under emulation.**
  - Recognize with mode 2: p50 33.1 / p95 101.6 ms, against 30.7 / 105.2 ms for production. That is about +2 ms at
    p50 and none measurable at p95.
  - The symbol walk with choices is p50 0.14 / p95 1.6 ms, against 0.08 / 0.5 ms for the word walk.
  - RSS p50 138 MiB in both, maximum 148 against 143. The WASM heap stays at 19 MiB.
  - Production is untouched, so it has zero overhead when the probe is off.
- **Smallest production correction supported: none.** A per-symbol margin gate is not supported by this evidence, and
  `lstm_choice_mode` should not be adopted in production. The owner decides scope. Options, none implemented:
  1. Keep N7 observe-only, with no calibrated cell claiming l/1 safety.
  2. Declare digit runs that hold `1` unsupported. This is a blanket l/1 rule, NOT APPROVED, and it costs most of the
     supported numeric fixtures.
  3. Approve a separate engine or data feasibility spike, outside this authorization.

**Engine and recognition-data spike (2026-10-28, DIAGNOSTIC ONLY, owner-approved): every candidate NO-GO.**
- **Method.**
  - Criteria are pure in `scripts/lib/ocr-engine-spike-criteria.mts`, written before measurement. `verify:ocr-engine-spike`
    is 54/0 with 10 mutants killed.
  - The holdout set (`scripts/ocr-engine-spike/holdout-fixtures.json`, 6 negatives and 10 positives) is new and was never
    tuned. The run records the SHA-256 of every declared input.
  - Every trial goes through the production N0 capture and `preprocessForOcr`, and every candidate's words through the
    unchanged `decideTextAssertion` (80/92).
  - Nothing was downloaded. The Tesseract files come from the lockfile-pinned `scripts/ocr-feasibility` install and are
    hash-verified by the spike host. The control equals the production pin byte for byte.
- **Run.** `%LOCALAPPDATA%/SpecterStudio/ocr-calibration/engine-spike/2026-10-27T22-15-44-449Z-ea622037.json`.
  12 of 12 launches: every cell twice, on a quiet host, 744 trials. Fresh hosts per launch, so 12 cold starts per
  Tesseract candidate.

| Candidate | False matched (of 252) | Supported (of 440) | Unsupported matched (of 52) | Warm p50 / p95 ms | Est. whole p95 ms | Shipped bytes | Verdict, failed gates |
|---|---|---|---|---|---|---|---|
| c0 production (simd-lstm, best_int, LSTM) | 54 | 93.6 % | 0 | 26 / 84 | 1132 | 5,949,002 | NO-GO: false matched, accuracy |
| c1 simd-lstm, standard 4.0.0 data, LSTM | 54 | 93.6 % | 0 | 26 / 85 | 1132 | 13,919,189 | NO-GO: false matched, accuracy, budget |
| c2 simd, standard data, legacy only | 4 | 25.0 % | 0 | 13 / 83 | 1131 | 14,516,573 | NO-GO: false matched, accuracy, budget |
| c3 simd, standard data, legacy + LSTM | 32 | 33.2 % | 0 | 25 / 96 | 1144 | 14,516,573 | NO-GO: false matched, accuracy, budget |
| c4 Windows.Media.Ocr (built in, en-US, no confidence) | 180 | 100 % (raw read) | 12 | 2 / 5 | 1053 | 0 (OS component) | NO-GO: false matched, unsupported, not pinned, no confidence |
| k1 c0 + legacy must agree | 12 | 92.7 % | 0 | 39 / 155 | 1203 | 20,465,575 | NO-GO: false matched, accuracy, budget |
| k2 c0 + Windows must agree | 54 | 93.6 % | 0 | 28 / 88 | 1136 | 5,949,002 | NO-GO: false matched, accuracy, not pinned |
| k3 c0 + standard LSTM must agree | 54 | 93.6 % | 0 | 52 / 170 | 1218 | 16,872,062 | NO-GO: false matched, accuracy, budget |

- **Findings.**
  - The standard data's LSTM model reproduces the pinned model exactly, in every trial, at 2.3× the size. No data
    alternative is available offline.
  - The legacy engine rarely confuses l and 1, but its confidences keep nearly every supported word below the
    look-alike threshold (25 %). Combined mode inherits both problems.
  - Windows OCR is fast and reads every supported fixture, but it "reads" the expected digit for almost every look-alike:
    180 of 252, in every class. It reads 12 of 52 unsupported fixtures, reports no confidence, and is an unpinned OS
    component. As a second reader it confirmed every one of c0's false matches, so it adds no independent check.
  - The best composite, k1, still false matches `ho-neg-box` ("Box 2O5" read as "Box 205") 12 of 12. It is also
    20.5 MB, 2.6× the budget.
  - The holdout widens the defect from l/1 to O/0: `ho-neg-box` was false matched 12 of 12 by c0, and `ho-neg-bay` 8,
    `ho-neg-pack` 4.
  - c0's supported misses are `multiline` 12, `cf-pos-office` 8, `cf-pos-login` 4 and `cf-pos-level` 4, all from the
    N7.2 gates. 98 % is unreachable for the baseline, with or without a second engine.
  - Latency is not the obstacle: every Tesseract candidate's estimate is within 1500 ms.
- **Timing-verifier failures (2026-10-27), independently reproduced and classified. They stay recorded as FAIL for that
  run; neither is counted as a PASS.**
  - **Rerun alone on a quiet host (2026-10-28):** `verify:ocr-host` 54/0 and `verify:ocr-runtime` 84/0. The same
    `verify:ocr-host` steps ran 4.2–4.8× slower on 10-27 (circuit 17,319 against 3,791 ms; queue 5,603 against 1,179 ms;
    idle kill 5,110 against 1,224 ms).
  - `verify:ocr-host` "prepare() … next recognition": a host that is ready has never recognized. The spike measured
    c0's first recognition at p50 290 / p95 496 ms, against warm p50 26 ms; at the measured 4.2–4.8× slowdown that is
    1.2–2.4 s against the 1000 ms bound. **Classification: environment load, product code unchanged.**
    - It also exposes a real latency fact: `prepare()` warms the host process, not the engine's first recognition.
      This bears on optimisation 2 below.
  - `verify:ocr-runtime` "late reply": the fake reader answers 2200 ms after it is called, and the check waits 1200 ms
    after the step settles (about 1510 ms). The reply is therefore seen only if the reader was called within about
    510 ms of the step start.
    - In the qualifying session the real pipeline reached `recognize-start` at p50 600 ms, and above 500 ms in 213 of
      259 warm trials.
    - **Classification: harness timing assumption (a fixed sleep), environment-triggered.** The safety assertion held:
      one record, budget-exhausted, never matched.
    - Proposed fix, not applied: wait for the late delivery with a bound instead of a fixed sleep. Nothing about the
      assertion is relaxed.
- **Recommendation: no candidate qualifies, so no production change is requested.** Keep the pinned engine. The
  formal scope amendment below goes to owner review.

**Proposed scope amendment for owner review (NOT RATIFIED; N7.6 stays open).**
1. N7 ships **observe-only, default-off, with no accuracy claim.**
   - No cell is calibrated and `calibrated` stays `false`.
   - The UI and reports keep saying observations never fail a step and are not verified accuracy.
   - OC-10 is unchanged as the bar any future qualification must meet. It is recorded as **not met** by the pinned
     engine, for a reason more data cannot change: confident l/1 and O/0 misreads inside digit runs.
2. **The full N7.6 campaign stays stopped** until a future candidate passes this spike's early gate. Zero false
   matched and ≥ 98 % supported are both required, on development, confirmation and a fresh holdout.
3. **Rerun the spike** when a candidate becomes available offline within the budget (a different engine or data under
   a new N7.1a-style feasibility approval), or if the owner amends OC-9's 8 MB budget. The criteria file is the
   contract.
4. Which N7 items close (N7.6, N7.8, Phase N) under an observe-only scope is the owner's decision. Until it is made,
   the roadmap shows N7.6 in progress and unqualified.

**Proposed optimisations, ranked by measured share.** None are implemented, and each needs a root cause and owner
approval (§7).
1. Clip the N0 element capture to the target region instead of the full viewport, and move the PNG decode off the main
   thread. This targets 250–450 ms, but changes N0 capture geometry and decoding.
2. Prewarm the OCR host when a run contains `assertImageText`, and fork it outside the step. This targets the cold
   600–1300 ms and the fork stall, but changes host start-up policy.
3. Merge the protected and target checks into one page evaluation. This targets about 50–90 ms, but touches the N7.5
   refusal sequence.
4. Reduce DPR 2 decode and event-loop lag, which follows from 1.

Remaining:
- **N7.6 stays open, and the qualification campaign is STOPPED.** OC-10's zero-false-matched rule is already
  violated in the bundled font, so further sessions cannot qualify those cells.
  - Next: an owner scope decision. The probe found the API feasible but no separating margin, and the engine/data
    spike found every candidate NO-GO. The proposed observe-only, no-claim amendment is above.
  - The other blockers, the `multiline` miss and the cold-start deadline overruns, are recorded for that decision.
  - A cell that misses stays observe-only.
- N7.7 (`.9.8`) is also dependency-ready. It is a separate advisory workstream with effect none, and OCR must never
  select an action.
- N7.1b and N7.8 stay BLOCKED until the approved packaging host exists.
