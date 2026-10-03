# N1 — Visual Capture Infrastructure

Shared rules and the Phase N boundary: `ROADMAP.md` › *Phase N — Visual Recognition and Automation*.
Beads `awkit-vra.1` (epic `awkit-vra`). Depends (Beads `blocks`) on closed L7 (`awkit-djnl.10`) only.
N2 (`awkit-vra.2`) depends on N1, and N3–N8 build on N1's capture record. Phase M is not a prerequisite.

**Status (2026-10-03): PLAN DELIVERED, zero implementation.** This document is N1's planning
deliverable, the acceptance criterion of `awkit-vra.1`. Like the Phase N registration, it authorizes no
runtime, schema, UI, dependency, model or service change. Recorder and Runner behaviour is unchanged.
Implementation starts only after the owner records the decisions in *Owner decisions before
implementation* below and authorizes N1 implementation in `docs/ai/DECISIONS.md`.

## Objective

Give Phase N one capture owner. It produces privacy-safe, bounded, confined image captures with
metadata, during authorized recording and execution, so that N2 (references), N3 (recognition), N5
(assertions and evidence) and N6 (headed and headless) consume one record shape instead of each calling
`page.screenshot`.

Success statement: with visual capture disabled, which is the default, recording and execution behave
exactly as today. That includes the existing Take Screenshot node, failure screenshots and traces. With
it enabled, a capture happens only under an explicit policy and never on a protected-authentication
surface. It is masked, bounded and confined to the screenshots root. A capture that fails or is refused
never changes a step's outcome, retry decision or recorded draft.

## Non-goals and hard exclusions

- No image matching, similarity, diffing, OCR, template matching or vision model. These belong to N3,
  N5 and N7.
- No coordinate-based interaction (N4, N6) and no change to DOM-first execution or locator proof.
- No association of captures with workflow nodes and no reference persistence. That is N2; N1 writes
  capture records only.
- No video, no desktop or operating-system screen capture, no capture of the SpecterStudio window, and
  never a capture of the user's real Chrome during a protected-login handoff.
- No new npm dependency and no image codec library. Playwright 1.61's `page.screenshot` and
  `locator.screenshot` options (`clip`, `fullPage`, `mask`, `maskColor`, `style`, `animations`, `caret`,
  `scale`, `type`) are sufficient. Re-check each option against the pinned version at implementation.
- No network, cloud or upload. Images are never sent to a model and never semantically indexed in N1.
- Never a means to observe or bypass CAPTCHA, MFA, passkey or bot detection (`PROJECT_BRIEF.md`).
- No change to the existing failure screenshots, the Take Screenshot node, traces or artifact profiles
  unless an owner decision below says so.

## Today's baseline (as built, 2026-10-03)

| Capability | Owner | Facts N1 must respect |
|---|---|---|
| Take Screenshot node | `src/runner/StepExecutor.ts` `case "screenshot"` → `takeScreenshot` | Element scope (`locator.screenshot`) when the step has a locator, else the page with `fullPage` defaulting to false. File `<screenshots>/<executionId>/<instanceId>/<flowId>/<stepId>-<screenshotName or "step">.png`; output mapping `screenshotPath`. Not masked. The name and ids are not passed through `safePathComponent` (see prerequisite P1). |
| Failure evidence (FR-B2) | `StepExecutor.captureFailureEvidence`, called from `FlowExecutor.executeWithRetry` | Per failing attempt: full-page PNG, masked DOM, a11y snapshot and meta. Every path component goes through `safePathComponent` and `isPathInside`. 5 s budget per capture, the `screenshot` operation limiter, `StepEvidenceRef` (`kind`, `attempt`, `pageId`, `requestedPageId`, `capturedAt`, `note`). Governed by `step.onFailure.screenshot`, then the artifact-profile default. The PNG is not masked; the DOM text is (`evidenceMasker.maskText`). |
| Legacy per-step capture | `src/reports/ScreenshotService.ts` | Full-page PNG per step id. |
| Traces | `src/runner/artifacts/TraceService.ts` | `tracing.start({ screenshots: true, snapshots: true })`. Chunks are kept for failed steps (`onFailure`) or always (`always`). |
| Artifact profiles | `src/runner/artifacts/ArtifactProfile.ts` (`AWKIT_ARTIFACT_PROFILE`) | Every profile keeps failure screenshots on. |
| Resource profiles | `src/runner/ResourceRoutingPolicy.ts` | `lean` aborts images, media and fonts; `ultraLean` also aborts stylesheets. Both pin `deviceScaleFactor` 1. Captures under them are not visually faithful. |
| Concurrency | `src/runner/concurrency/OperationLimiters.ts` | A `screenshot` semaphore shared by all instances; `maxConcurrentScreenshots` override in `execution.ipc.ts`. |
| Storage | `app/main/storagePaths.ts` `getConfiguredPaths().screenshots` | Settings `paths.screenshotsPath`, falling back to the runtime folder under `%LOCALAPPDATA%/SpecterStudio/`. Telemetry reports the folder's size. Report retention (`ExecutionEngine` → `sweepRetention`) deletes database rows only, never these files. |
| Viewing | `app/main/ipc/system.ipc.ts` `system:openPath` | Opens files only inside SpecterStudio's data folders (`isOpenPathAllowed`) and never an executable. |
| Recorder | `src/recorder/RecorderService.ts` | Captures no images today. Protected detection (`detectRecorderProtectedLogin`, `src/security/ProtectedLoginDetector.ts`) pauses recording, preserves the draft and closes the automation browser. Flagged pages are kept in `protectedPages` and never inspected. |
| Runner protected surfaces | `PROTECTED_LOGIN_STEP_TYPES` (`src/profiles/FlowProfile.ts`), `src/runner/evidence/FailureEvidenceCollector.ts`, `uiEvidenceScript.ts` | Page-derived evidence is excluded on documents with a password or one-time-code field (`PROTECTED` selector in `uiEvidenceScript.ts`), on handed-off pages, and during protected-login, secure-login, session-reuse and manual-handoff steps. **Pixel captures do not apply this exclusion today:** failure screenshots and trace screencasts are taken regardless (decision VC-D6). |
| Settings schema | `app/main/uiSettings.ts` | `retainKnownKeys` drops unknown fixed-schema keys on load, so an older build drops a new settings group. `execution.suppressEvidenceUiText` is the Phase L raw-UI-text switch. |
| Permissions | `src/security/authz/Permissions.ts` | No capture-specific permission. `SETTINGS_EDIT`, `WORKFLOW_EDIT`, `WORKFLOW_EXECUTE`, `RECORDER_ELEMENT_SPY`, `PAGE_REPORTS` and `REPORT_EXPORT` exist. |

### Prerequisite P1 (separate defect, not part of N1)

`takeScreenshot` joins the flow-controlled `screenshotName`, the step id and the flow id into the file
path without `safePathComponent` or an `isPathInside` check, unlike `captureFailureEvidence`. A crafted
name can therefore write a PNG outside the screenshots root. It is tracked as its own fix. N1 code must
never reuse that path builder: every N1 file goes through `safePathComponent` and `isPathInside`.

## Architecture boundary

One new owner, proposed as `src/visual/capture/`. It has a pure policy core and a thin Playwright
adapter, and is called from the existing Recorder and Runner hooks. It adds no second browser owner.

```text
RecorderService (draft actions, toolbar)        FlowExecutor / StepExecutor (steps, attempts, events)
              │ trigger                                         │ trigger
              ▼                                                 ▼
        VisualCapturePolicy (pure): enabled? mode? scope? protected surface? budget? profile?
              │ allow                                           │ refuse → record with reason code, no file
              ▼
        VisualCaptureService (Playwright adapter): screenshot limiter, time budget, masks, confinement
              │
              ▼
        <screenshots>/visual/<session>/<capture>.png  +  VisualCaptureRecord (JSON, no pixels)
              │
              ▼
        later milestones: N2 references · N3 recognition · N5 assertions and report evidence
```

A capture is never on a step's decision path. The service never throws into the caller: a failure
or refusal becomes a record with a code, exactly as `captureFailureEvidence` turns a failed capture into
a secondary diagnostic.

## Capture modes

1. **Automatic** (policy-driven, at fixed lifecycle points).
   - Runner points: before the action, after a passed attempt, after a failing attempt (beside
     `captureFailureEvidence`, never replacing it), and on an assertion step's result.
   - Recorder points: after a recorded action is committed to the draft (after Smart Wait observation
     settles), and on a main-frame navigation commit.
   - The policy selects points. The default is none.
2. **Manual** (user-initiated).
   - Recorder: a Capture control in the recorder toolbar. Element scope uses the Element Spy pick
     (`RECORDER_ELEMENT_SPY`); region scope uses a drag rectangle; viewport and full page are one click.
     A capture is never recorded as a step, as with Element Spy.
   - Designer: the existing Take Screenshot node stays as it is (VC-D3).
3. **Event-triggered** (a closed list of runtime events, each with an id, debounce and per-instance
   budget): main-frame navigation committed, popup opened, dialog shown, step retry scheduled, locator
   recovery used, Smart Wait timed out, and assertion failed. Events come from the existing observers and
   the `FailureEvidenceCollector` attach lifecycle, not from new listeners on a second owner.

## Capture scopes

| Scope | Playwright primitive | Notes |
|---|---|---|
| Element | `locator.screenshot`, or `page.screenshot({ clip })` around the element's box | The element comes from the step's already-resolved locator (`LocatorFactory`), never from a new resolution path. `locator.screenshot` waits for actionability and **scrolls the element into view**, which changes page state (VC-D4). Optional padding is clamped to the viewport or page. |
| Region | `page.screenshot({ clip })` | A rectangle in page CSS pixels, recorded with its coordinate space. A region inside a child frame records the frame chain and offset only; translation is N6. |
| Viewport | `page.screenshot({ fullPage: false })` | What the user would see at the current scroll position. |
| Full page | `page.screenshot({ fullPage: true })` | Height-capped by policy. Above the cap the capture is refused (`FULL_PAGE_TOO_TALL`) rather than silently cut. The cap is measured, not invented. |

Common options: PNG (lossless) by default (VC-D9); `caret: "hide"` (Playwright's default);
`animations: "allow"` by default (VC-D5) because `"disabled"` fast-forwards finite animations and fires
`transitionend`, a page-visible side effect; `scale` recorded as `"css"` or `"device"`. AWKIT's own
recorder overlay is hidden through the `style` option so that AWKIT UI never appears in a capture.

## Capture record (metadata only, no pixels)

Proposed `VisualCaptureRecord`, `schemaVersion: 1`:

```text
{ schemaVersion: 1, id,
  session: { kind: "run" | "recording", executionId?, instanceId?, recordingId? },
  flowId?, stepId?, attempt?,
  trigger: { mode: "automatic" | "manual" | "event", point?: <point id>, event?: <event id> },
  scope: "element" | "region" | "viewport" | "fullPage",
  page: { pageId, requestedPageId?, frameChain?: <frame ids>, urlTemplate },
  geometry: { viewport: { width, height }, deviceScaleFactor, scroll: { x, y },
              clip?: { x, y, width, height, space: "page-css" }, elementBox?, image: { width, height, scale } },
  render: { headless, browserVersion, reducedMotion, resourceProfile },
  masking: { masks: <count>, kinds: ("credentialField" | "secretBoundTarget" | "policySelector")[] },
  file?: { relPath, sha256, bytes, format: "png" },
  status: "captured" | "refused" | "failed", reason?: <code>, capturedAt, durationMs }
```

- It never holds page text, input values, locator values, cookies, storage state or a full URL.
  `urlTemplate` is origin plus path template with ids stripped, the Phase L privacy rule.
- Strings it does hold (`pageId`, a failure `reason`) pass through `SecretMasker`, as evidence notes do.
- `relPath` is relative to the screenshots root, never absolute.
- Records for one session are written as one JSON index with `app/main/atomicReplace.ts`. A PNG is
  written to a temporary name and renamed.
- Run captures may later be surfaced through an optional instance-report extension that older reports
  simply lack. Displaying them is N5; N1 only writes.

## Policy controls

Layers combine so that the most restrictive wins.

1. **Global (Settings, administrator):** a new `visualCapture` group with `enabled` (default false),
   allowed modes, allowed scopes, recording and execution switches, captures per instance and per run,
   bytes per run, retention, full-page height cap, format and default masks. Editing it needs
   `SETTINGS_EDIT` unless VC-D2 adds a permission.
2. **Flow (optional field):** `visualCapture?: { points, events, scope }`, absent meaning off. Editing it
   needs `WORKFLOW_EDIT`.
3. **Step (optional override):** `config.visualCapture?: { points, scope, masks }`. `off` is always
   allowed and always wins.
4. **Run:** a run card may only narrow the effective policy, never widen it.
5. **Hard refusals no policy overrides:** a protected surface (next section), an exhausted budget, a
   closed page, a path-confinement failure, a cancelled run, and a lean resource profile unless VC-D10
   allows a capture marked unfaithful.

Budgets and caps are provisional until a planned overhead verifier measures them (VC-D8). Every capture
uses the existing `screenshot` limiter and a per-capture time budget, so concurrency stays bounded by the
existing caps.

## Redaction and privacy safeguards

Text inside an image cannot be redacted after capture: `SemanticRedactor` and `SecretMasker` work on
strings. N1 therefore prevents exposure at capture time and limits where images go.

- **Pixel masks at capture time** (Playwright `mask`, solid `maskColor`, fully covering each box):
  - credential fields: the `PROTECTED` selector in `uiEvidenceScript.ts` (password, one-time-code,
    current-password, new-password) plus payment autocomplete fields (`cc-*`);
  - secret-bound targets: any element a step on the same page filled from a `secret`-source value or a
    registered run secret, tracked per page by the runner;
  - policy selectors: administrator- and step-configured locators that are always masked;
  - an optional switch to mask every text input.
- **No model and no index:** images are never sent to a model or added to the semantic index in N1.
  Changing that needs a later owner decision (N7) and an allowlist change, as the Phase L privacy policy
  already requires for raw evidence.
- **Raw-UI-text suppression:** while `execution.suppressEvidenceUiText` is on, automatic and event
  captures are refused, because pixels carry the same visible text (VC-D7).
- **Confinement:** files live under `<screenshots>/visual/…`, every component through
  `safePathComponent` and `isPathInside`. Nothing is written into `resources/` or `app.asar`.
- **Retention:** run captures live and die with their run report, the Phase L evidence rule, plus an age
  cap. Recording captures live with the draft until it is saved (N2 then decides references) or
  discarded. Because report retention deletes database rows only, N1 adds deletion for its own
  `visual/` files and never touches existing screenshots.
- **Access:** viewing uses the existing confined `system:openPath`. Run captures follow `PAGE_REPORTS`
  and export follows `REPORT_EXPORT`.
- **Residual risk, stated:** a secret rendered as ordinary page text (for example an API key shown on a
  settings page) is visible in a capture unless a policy selector masks it. Default-off and explicit
  selectors are the mitigation; N1 does not claim to detect arbitrary secrets in pixels.

## Protected-authentication boundary (hard)

A capture is refused, with a code and no file, when any of these holds:

- **Recorder:** the page is in `protectedPages`; a protected-login handoff is active in any phase; or
  detection flagged the current document. The "ignore detection" overrides for false positives do not
  re-enable capture on a document that has a credential field.
- **Runner:** the current step is in `PROTECTED_LOGIN_STEP_TYPES` or is a manual handoff; the page was
  handed off; or the document carries a credential field per the `PROTECTED` selector. This mirrors the
  Phase L evidence exclusion. Allowing masked capture on an ordinary, non-protected login page is VC-D6.
- **Any CAPTCHA, MFA, OTP, passkey or device-approval signal** from `ProtectedLoginDetector`.
- The user's real Chrome is outside the automation browser by design and is never captured.
- After `reuseSession` the authenticated application may be captured; the `reuseSession` step itself is
  excluded and storage state is never read.

Refusal codes: `PROTECTED_SURFACE`, `HANDOFF_ACTIVE`, `CREDENTIAL_FIELD_PRESENT`, `PROTECTED_STEP`,
`UI_TEXT_SUPPRESSED`, `BUDGET_EXHAUSTED`, `RESOURCE_PROFILE_UNFAITHFUL`, `FULL_PAGE_TOO_TALL`,
`ELEMENT_OFFSCREEN`, `PAGE_CLOSED`, `PATH_REFUSED`, `CANCELLED`.

## Integration points (planned, not implemented)

- **Runner.** `FlowExecutor.executeWithRetry` gains optional before, after-pass and after-fail hooks
  beside the existing `captureFailureEvidence` call. Page identity comes from the popup identity registry
  (`pageId`, `requestedPageId`), as failure evidence does. Parallel branches share the limiter. Run
  cancellation aborts a pending capture within its budget and removes its partial file. Step status,
  retry decisions and time budgets are unaffected apart from the bounded capture time, which the overhead
  verifier measures.
- **Recorder.** `RecorderService` gains a post-commit hook and a manual capture request from the
  renderer through a new IPC channel, with `assertTrustedSender` and a permission check in main. The
  capture never enters the draft as a step. Disabled, the recorded draft is byte-identical to today's.
- **Settings and designer UI.** A `visualCapture` settings group and optional flow and step fields, built
  with Hologram tokens (`docs/ai/RULES.md` › UI). No change to the `.app-shell` or `.app-main` grids.
- **Headed and headless.** Both are supported from N1. The record notes `headless`, viewport, DPR and
  scroll so N6 can normalize them. N1 makes no normalization claim.

## Compatibility

- **Persisted shapes:** optional fields only. Old settings, flows and reports load unchanged.
- **Downgrade:** an older build drops the `visualCapture` settings group (`retainKnownKeys`), so capture is
  off after a downgrade. Whether older builds keep or drop the optional flow and step fields must be
  measured before implementation (question Q1).
- **Offline and packaging:** no new dependency or runtime; data stays under `%LOCALAPPDATA%` or the
  configured screenshots path. `validate:offline` is unaffected.

## Owner decisions before implementation

| ID | Decision | Recommendation |
|---|---|---|
| VC-D1 | Defaults once the global switch is on | Manual capture only. Automatic and event capture need a flow opt-in. |
| VC-D2 | Permission model | Reuse `SETTINGS_EDIT` and `WORKFLOW_EDIT`; add no new permission unless audit requires one. |
| VC-D3 | The Take Screenshot node | Unchanged and separate. Do not migrate it in N1. |
| VC-D4 | Element scope scrolls the page | Runner: clip the visible box without scrolling, otherwise refuse `ELEMENT_OFFSCREEN`. Recorder manual capture may scroll. |
| VC-D5 | Animations | `allow` by default (no page side effect). `disabled` only for captures intended as N3 references. |
| VC-D6 | Protected boundary for existing pixel captures (failure screenshots, traces), and masked capture on non-protected credential pages | Align failure screenshots with the protected-step and handed-off-page exclusion as a separate, owner-approved behaviour change. Keep N1 refusing credential-field documents. |
| VC-D7 | Raw-UI-text suppression | Refuse automatic and event captures while it is on; manual capture shows the reason. |
| VC-D8 | Budgets and retention | Set from the measured overhead run, not chosen up front. |
| VC-D9 | Format | PNG only in N1. |
| VC-D10 | Lean resource profiles | Refuse with `RESOURCE_PROFILE_UNFAITHFUL`. |

Open question Q1: do older builds keep or drop unknown optional fields on a flow step? Measure it with a
fixture before choosing the field location.

## Implementation slices (once authorized)

Each slice is independently verifiable and leaves capture off by default.

1. **N1.1 Policy core:** pure types, policy combination, refusal codes and path planning; no Playwright.
2. **N1.2 Capture adapter:** the Playwright adapter with masks, the limiter, budgets, confinement and
   atomic records, plus the Test Lab page.
3. **N1.3 Runner hooks:** automatic and event points behind the off default.
4. **N1.4 Recorder hooks:** manual capture and automatic points, the toolbar and IPC.
5. **N1.5 Settings and designer policy UI** with RBAC.
6. **N1.6 Retention and the report-extension write path.**

## Verification plan

Planned verifiers are named here and registered in `scripts/lib/verifier-classification.ts` only when
they exist. Each needs observed negative controls (mutants killed and reverted).

- `verify:visual-capture-policy` (N1.1): policy layering, every refusal code, the protected boundary
  table, and path planning against hostile ids.
- `verify:visual-capture` (N1.2, N1.3): live against the mock site in headed and headless Chromium. Every
  scope and mode; record shape; confinement; budgets; cancellation. Masking is proved by decoding the PNG
  in the page with a canvas and asserting each masked box is uniformly `maskColor`, so no image library is
  needed.
- `verify:visual-capture-recorder` (N1.4): manual and automatic capture; the draft is unchanged with
  capture on or off; protected pages refused. `verify:protected-login-recorder` and
  `verify:recorder-redaction` stay green unchanged.
- `verify:visual-capture-overhead` (N1.3): measured per-capture cost and per-run bytes, which feed VC-D8.
- `verify:visual-capture-settings-gui` (N1.5): the settings and designer controls, RBAC and
  accessibility.
- **Disabled-state proof** (every slice): `verify:runner` keeps its pass count, `verify:failure-evidence`
  and `verify:failure-screenshot-precedence` are unchanged, and no `visual/` folder is created.
- `npm run build`, and `verify:mock-site` for the new page.

## Test Lab scenario (planned)

New page `mock-site/public/visual-capture-lab.html` (URL `/visual-capture-lab.html`) with stable
`data-testid` targets:

- fixed-size coloured tiles for element and region scope;
- a page taller than the viewport for full page;
- a CSS animation to show `animations: "allow"` has no side effect;
- a password field, a one-time-code field and a visible "token" element for masking and refusal;
- an iframe (reusing `iframe-child.html`) and a popup trigger for page identity.

The existing `secure-login/*` pages and `recorder-sensitive.html` cover the protected and masking
boundaries; N1 adds no new protected page. The page and its URL are documented in `mock-site/README.md`
when it is built.

## Acceptance for N1 implementation

- With capture off (the default), Recorder and Runner behaviour, files and reports are unchanged.
- Every mode and scope works in headed and headless Chromium against the Test Lab.
- No capture is ever taken on a protected surface, and the refusal is recorded with its code.
- Credential fields, secret-bound targets and policy selectors are masked, as proven by pixel readback.
- Every file is confined to the screenshots root; hostile ids cannot escape it.
- A capture failure or refusal never changes a step's outcome, retry or draft.
- Overhead and disk use are measured, and the budgets are set from the measurements.
- Works offline with no new dependency.

## Future touchpoints (not edited by this plan)

`src/runner/{FlowExecutor,StepExecutor}.ts`, `src/runner/concurrency/OperationLimiters.ts`,
`src/runner/evidence/*`, `src/recorder/RecorderService.ts`, `src/recorder/recorderInitScript.ts`,
`src/security/ProtectedLoginDetector.ts`, `src/profiles/FlowProfile.ts`, `app/main/uiSettings.ts`,
`app/main/storagePaths.ts`, a new IPC module under `app/main/ipc/`, the preload bridge
(`window.playwrightFlowStudio`, name unchanged), `app/renderer/pages/Settings.tsx`, the flow properties
panel, `mock-site/`, and `scripts/lib/verifier-classification.ts`.
