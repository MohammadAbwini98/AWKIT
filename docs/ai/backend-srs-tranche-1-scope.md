# Backend SRS — Tranche 1 scope (FR-B2, Immediate failure evidence)

**Date:** 2026-07-24 · **Branch:** `feature/backend-srs-tranche-1` · **Base:** `origin/main` `88c76ed`

**Authoritative SRS:** `SRS-BAO-001` — *Browser-Automation Observability, Evidence, and Safety
Boundary*. The full document lives on the planning branch `docs/browser-automation-srs`
(`37dc67c`); it is referenced as authoritative by `scripts/lib/verifier-classification.ts` on `main`
(FR-I1 = Tranche 0). This tranche does **not** modify that planning branch; it records
implementation status here on `main` and reproduces the requirement's acceptance criteria below.

## Requirement traceability matrix (verified against current code, not trackers)

| SRS Rec | FR | Title | Tranche | Verified current state (code) | Decision |
|---|---|---|---|---|---|
| 15 | **FR-B2** | Immediate failure evidence | 1 | **Partial — ordering defect.** `FlowExecutor.executeWithRetry` (`src/runner/FlowExecutor.ts:455-457`) captures the failure screenshot **after** the retry loop, only for `lastResult`, only when `!lastResult.screenshotPath`. Intermediate failing attempts get no evidence; a retry that navigates destroys the broken state first. Only a single screenshot is captured (no DOM/a11y). | **SELECTED** |
| 3 | FR-B1 | Addressable run-session artifact | 1 | Partial. Artifacts are written under `screenshots/<executionId>/<instanceId>/<flowId>/…` via `ScreenshotService`/`TraceService`; there is no `runId`-rooted self-describing `manifest.json` layout. | **DEFERRED** — requires the `InstanceRuntimePaths` run-root migration that "breaks all four consumers at once" (SRS FR-B1 change-deps) and B1.5 retention/purge is an unresolved open question (SRS §10.3). Broad structural change + undecided policy → out of a minimal Tranche 1. |
| 20 | FR-A4 | Detail-tiered observability | 5 | Partial. `screenshotOnFailure` precedence wired in Tranche 0 (awkit-5yx); AC-3 (`production` actually suppresses failure screenshots) contradicts `ArtifactProfile.ts` and needs an owner decision. | Out of scope (Tranche 5; unresolved decision). |
| 8 | FR-C1/C2 | Stable page/frame identity | 2 | Partial (**defect** awkit-ebh). | Out of scope (Tranche 2). |
| — | FR-A2 | Unified execution timeline (console/network events) | 5 | Absent. Needs the CDP/observation substrate (FR-A1), blocked on SRS §10 open question A-1. | Owns "console tail" + "in-flight network state" — see deferral note below. |

## Selected scope — FR-B2 (Immediate failure evidence capture)

**Requirement.** Capture failure evidence **at the moment of each failing attempt**, before any
retry, recovery, or navigation destroys the broken state; per-attempt; never masking the original
automation error.

**Acceptance criteria (from SRS-BAO-001 §3.2):**

- **B2.1** Evidence is captured inside the failing attempt's scope, not after the retry loop.
- **B2.2** Each retry attempt produces its own evidence set; attempt *n* is never overwritten by *n+1*.
- **B2.3** Evidence filenames encode run identifier, `flowId`, `stepId`, `pageId`, `attemptId`, timestamp.
- **B2.4** Each failed attempt preserves all of: original exception (primary, never replaced);
  attempt-specific evidence; trace chunk (existing `TraceService.endStep`); retry decision.
- **B2.5** Evidence-capture failure is appended as a **secondary diagnostic** and never replaces,
  masks, or reorders the original automation error.
- **B2.6** Capture is bounded — a hung page must not block the failure path indefinitely.

**Implemented evidence set (point-in-time page state):** screenshot + DOM HTML snapshot +
accessibility (aria) snapshot + page meta (URL/title). All secret-masked via `SecretMasker`; each
capture individually guarded and time-bounded.

**Explicitly deferred (documented, not silent):**
- **Console tail** and **in-flight network state** → **FR-A2 (WS-A unified execution timeline,
  Tranche 5).** These are event-stream evidence that require the observation substrate FR-A1/A2
  introduces (blocked on SRS §10 open question A-1). Point-in-time page state is captured now;
  event streams belong to the timeline work.
- **FR-B1 run-root + `manifest.json`** and durable-store surfacing of the per-attempt `evidence[]`
  (a SQLite schema migration) → their own tranche. This tranche writes evidence files to disk with
  encoded names and returns `evidence[]` on the in-memory result + a masked structured log line; it
  adds **no** schema migration.

## Affected modules

- `src/runner/RunnerResult.ts` — add `StepEvidenceRef` + `evidence?: StepEvidenceRef[]` to `StepExecutionResult`.
- `src/runner/StepExecutor.ts` — add `captureFailureEvidence(step, { attempt })` (screenshot + DOM +
  a11y + meta, bounded, masked, encoded names); keep `captureFailureScreenshot` (used by two verifiers).
- `src/runner/FlowExecutor.ts` — move capture into `executeWithRetry`'s loop, per failing attempt,
  before the retry decision; accumulate `evidence[]`; keep `screenshotPath` = last capture; remove the
  after-loop block. Precedence gate (`step.onFailure?.screenshot ?? screenshotOnFailureDefault`) preserved.

## Security impact

- Every evidence body (DOM/a11y/meta) passes `SecretMasker` before it is written. No new IPC channel,
  no new permission surface, no new environment variable. Protected-login/handoff behaviour unchanged.
- Original automation error is always the primary cause (B2.5); a capture failure cannot leak or
  mask it.

## Persistence / migration impact

- **None.** No SQLite schema change. `screenshotPath` continues to flow to `NodeAttempt`/durable store
  unchanged. Evidence files land under the existing `%LOCALAPPDATA%`-rooted screenshots path
  (`…/<flowId>/evidence/`); durable-store surfacing of `evidence[]` is a documented follow-up.

## Expected verifiers

- `verify:failure-evidence` (**new, unit**) — drives the real `FlowExecutor.executeWithRetry` with a
  stub `StepExecutor`; proves B2.1/B2.2/B2.4/B2.5, precedence, `screenshotPath` back-compat, the
  retry-then-success evidence-preservation contract, and `safePathComponent` sanitization.
- `verify:failure-evidence-live` (**new, real-browser**) — real Chromium + local HTTP server: proves
  the evidence **files** are written, safely named, path-confined, and secret-masked; the requested-vs-
  captured page identity; and dead-page secondary diagnostics.
- `verify:failure-screenshot-precedence` (**updated**) — adapted to the evidence path; awkit-5yx
  precedence coverage preserved.
- `verify:runner` (**regression, real Chromium**) — exercises the live capture path on failing steps.
- Registered in `scripts/lib/verifier-classification.ts` (verifier total 108 → **110**; unit 43 → 44,
  real-browser 36 → 37). Round 3 below adds checks to these same two scripts — the verifier total is
  unchanged (no new script), only their internal check counts grow.

## Review fixes (2026-07-24, round 2 — PR #35 review)

1. **Evidence preserved across a successful retry.** `executeWithRetry` returned a passing retry
   *before* attaching the evidence accumulated from earlier failed attempts. Fixed: the passing result
   now carries all prior failed-attempt evidence (order/indexes intact, nothing overwritten), no
   capture runs for the passing attempt, and `screenshotPath` stays unset on the successful result.
2. **All evidence path components sanitized.** New shared `safePathComponent(raw, fallback)` in
   `src/utils/pathSafety.ts` (strips `/`/`\`, neutralizes `..`, replaces Windows-invalid/control chars,
   guards reserved device names, bounds length with a disambiguating hash, never empty) applied to
   `executionId`/`instanceId`/`flowId`/`step.id`/page id. Each artifact path is then resolved and
   `isPathInside(evidenceRoot, …)`-confined before writing; an escape records a secondary diagnostic
   and skips the write.
3. **Truthful page identity.** When `resolveStepPage` fails, evidence is labelled with the **actual**
   captured page (via `aliasForActivePage()`), the resolver failure is kept as a secondary diagnostic,
   and the requested alias is retained in a new optional `StepEvidenceRef.requestedPageId` (back-compat)
   — never claiming a popup when it was main. Filenames encode the captured page id.
4. **Real file-output verifier added** (`verify:failure-evidence-live`, above).

## Review fixes (2026-07-24, round 3 — final correction pass)

Round 2 introduced two remaining unmasked-text paths and one under-hardened fallback, all closed here:

1. **Every `StepEvidenceRef.note` is now masked.** `StepExecutor.captureFailureEvidence`'s internal
   `record()` helper previously stored `note` verbatim — the resolver-failure diagnostic embeds
   `step.pageAlias` (flow-author-controlled) directly, and each per-artifact failure note embeds the
   underlying error's `.message`, either of which can carry a page URL's query-string token or a
   copy-pasted secret. `record()` now runs every `note` through the same `evidenceMasker.maskText(...)`
   used for the DOM/a11y/meta bodies before storing it on the ref.
2. **The `FlowExecutor` defensive fallback diagnostic is masked too.** `executeWithRetry`'s
   belt-and-suspenders `.catch` (for the case where `captureFailureEvidence` itself throws, not just an
   individual capture inside it) built its `note` from the raw error message. `FlowExecutor` gained its
   own `evidenceMasker` (`SecretMasker`) and now masks this note identically.
3. **`safePathComponent`'s `fallback` argument is sanitized, not trusted.** The fallback was previously
   returned verbatim when `raw` reduced to nothing, so a hostile/derived fallback string could itself
   become a traversal or invalid path segment. `fallback` now runs through the exact same sanitize
   pipeline as `raw`; only the hard-coded literal `"x"` is ever returned unsanitized, and only when both
   `raw` and `fallback` reduce to nothing.
4. **New tests** in `verify:failure-evidence` (unit): the `FlowExecutor` fallback note masks
   `password=`/`token=` patterns from an injected error message; four `safePathComponent` hostile-fallback
   cases (traversal, invalid-chars+separators, fully-neutralizing → hard `"x"`, reserved name). New
   tests in `verify:failure-evidence-live` (real-browser): a hostile/secret-shaped `pageAlias` produces a
   resolver-failure note that is masked (never leaks the embedded token/password raw), while the evidence
   files from that same run stay correctly labelled with the actual captured page.
5. **No behavior change to file paths, filenames, or page-identity semantics** — only diagnostic-text
   masking and fallback sanitization. `verify:failure-evidence` 29 → **34**; `verify:failure-evidence-live`
   14 → **17**. Verifier taxonomy total unchanged at **110** (no new script).

## Exclusions

No UI redesign, no packaging work, no Oracle changes, no broad refactor, no Tranche 0 rework, no
`.beads` mutation, no release-artifact rebuild, no release promotion. Clean-machine policy remains
owner-waived / non-blocking; protected release gates remain mandatory.
