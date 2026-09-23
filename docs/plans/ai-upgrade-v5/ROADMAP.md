# SpecterStudio Phase L — Local AI & Intelligent Automation (V5)

Status: **IN PROGRESS — L0 complete 2026-09-19; L1 built and pinned. The 4B fails its live-inference
gate. The owner gave a limited GO on the 0.8B on 2026-09-23, for on-demand explanations, locator proposals
and manual failure analysis only. That GO closes no milestone** (owner audit below; decisions ratified in
`docs/ai/DECISIONS.md`).
Roadmap Phase `L` (`in-progress`), Beads epic `awkit-djnl`.
Supersedes the external V1–V4 drafts (`SpecterStudio_AI_Upgrade_*`).
This file is the only copy of cross-cutting content (rules, architecture, autonomy policy, decisions).
Milestone files `L0`–`L7` hold only milestone-specific tasks.

## Objective

Make SpecterStudio intelligent and automated with one local, CPU-only model, without ever making the model an
authority or a dependency:

> **SpecterStudio captures, proves, and applies. AI proposes, ranks, explains, and correlates.
> Automation is event-driven and policy-tiered; every automatic change is proven, audited, and revertible.**

## Shared implementation rules (inherited by every milestone)

- Follow `AGENTS.md` / `CLAUDE.md`: work on `main`, preserve user work, truthful PASS/FAIL/BLOCKED/NOT RUN/INCONCLUSIVE,
  no retry loops on blocked gates.
- Preserve `window.playwrightFlowStudio`; respect the `app/main` / `app/renderer` / `src` boundaries.
- Offline only: no cloud API, CDN, telemetry, runtime model download, global runtimes, admin rights, or GPU requirement.
  Mutable model/cache state under `%LOCALAPPDATA%/SpecterStudio/` or configured paths, never `resources`/`app.asar`.
- Reuse existing owners (§6); no parallel locator, validation, redaction, permission, index, report, or resource system.
- Never send/persist passwords, tokens, cookies, auth headers, storage values, private keys, secret-source values,
  request bodies, or credential-bearing URLs. Protected-login surfaces never reach the model. Page text is hostile data.
- UI uses Hologram tokens from `app/renderer/styles/global.css`; keyboard, focus, reduced motion preserved.
- Confirm every command against `package.json`; register new `verify:*`/`validate:*` in
  `scripts/lib/verifier-classification.ts`; mutation-test each new verifier once green.
- Update authoritative roadmap/tracker sources only; `verify:roadmap-dashboard` must read **Sources agree**.

## Model baseline

Qwen3.5-4B · GGUF Q4_K_M · pinned llama.cpp build with confirmed Qwen3.5 support · thinking disabled ·
grammar/JSON-schema constrained decoding + runtime schema validation · one inference at a time · 4K context ceiling
(feature packets much smaller) · target envelope Windows x64 VMware ~6 vCPU / ~48 GB, no GPU.

**Model pack** ships separately from the installer (NSIS/portable limits, existing packaging memory pressure) and is
imported through Settings. A single source-controlled manifest (`src/ai/modelManifest.ts` or equivalent) pins model
version, filename, size, SHA-256, runtime compatibility, license/notice reference, capability flags. Manifest changes
ship with an app release; no online refresh in Phase L.

## Architecture — five layers, one direction of authority

```
 Evidence  ->  Intelligence  ->  Proof  ->  Autonomy Policy  ->  Apply + Audit/Undo
 (determ.)     (model, async)   (determ.)   (tier per feature)   (existing owners)
```

| Layer | Owner | Rule |
|---|---|---|
| Evidence | Recorder identity/context, run-lifetime failure collector, validator issues | deterministic, always on, bounded, redacted |
| Intelligence | one main-process `AiService` (utility/stdio host, job queue) | narrow feature APIs only; no generic prompt IPC |
| Proof | `LocatorFactory` + identity guard, `FlowValidator`, report contracts | the only source of correctness |
| Autonomy Policy | one pure module | decides observe / suggest / auto-apply / forbidden |
| Apply + Audit | existing save/lock/undo owners + `AiActionRecord` | attributable, one-click revert |

### Event-driven automation (AI never watches the app)

| Trigger (existing event) | Automatic job |
|---|---|
| Recorder finalizes guarded-positional / low-durability locator | locator semantic-upgrade proposal (L3) |
| Replay resolves a step carrying `pendingUpgrade` | deterministic replay proof, no model call (L3) |
| Run reaches terminal FAIL | deterministic cause baseline → coalesced AI analysis (L5b) |
| Persisted locator fails at runtime | deterministic recovery → AI repair proposal if still weak (L3) |
| Validator reports issues in editor | AI explanation (L4b) |
| App idle, AI enabled, no runs active | flow health sweep: durability audit of saved flows, queue upgrades (L3) |

All jobs pass through one bounded queue, register as weighted workload, yield to active Playwright work, and are
cancellable. The synchronous run path makes **zero** model calls.

## Autonomy policy (owner decision: policy-tiered)

| Tier | Meaning | Default features |
|---|---|---|
| T0 Observe | stored as labelled interpretation only | failure analysis, validation explanation, fragment summaries |
| T1 Suggest | one-click user approval | persisted-locator repair, graph fix ranking, fragment parameter mapping |
| T2 Auto-apply with proof | applied automatically, audited, one-click revert | semantic locator promotion (criteria in L3) |
| T3 Forbidden | never, regardless of configuration | protected-login; sensitive-action locator changes; graph edits outside validator-emitted `safeFix`; run status, retry, cancellation, failure policy |

- Admin may lower any feature and restore it up to its ceiling (its default tier); the global cap is T2; T3 is
  unreachable by configuration (verified). Exact T3 list: `docs/ai/DECISIONS.md` (2026-09-19).
- **Self-demotion:** if a T2 feature's revert rate (from `AiActionRecord`) exceeds a committed threshold, the policy
  demotes it to T1 and surfaces the reason.
- Master AI switch off ⇒ every feature behaves as today.

## Global decisions (recorded in L0)

Ratified 2026-09-19 in `docs/ai/DECISIONS.md`, which also records the field shapes, `AiActionRecord`,
privacy policy and model-manifest owner, and wins wherever it refines the text below.

1. **Locator AI is a semantic upgrade**, not a rescue. Guarded-positional output (`buildRecordedFlow.ts`, saved as
   `resolved`) stays runnable and authoritative until a replacement is proven.
2. **`pendingUpgrade`** is a new optional locator field that `LocatorFactory` never reads. Unproven candidates never go
   into `alternatives` (which the runner tries as fallbacks, `LocatorFactory.ts` ~L181) or into remembered-winner memory.
3. **Provenance is additive** (`locatorProvenance`), `resolvedBy: "recorder" | "user"` is not widened.
4. **Intent guard:** AI scopes that bake in bound data/recorded input values are rejected or parameterized; a scope-kind
   change (position → text) is a meaning change and cannot auto-apply.
5. **Promotion is single-writer** through the profile save path, never a side effect of a run.
6. **Failure capture is new run-lifetime infrastructure**; `NetworkDiagnosticsObserver` keeps its per-action role.
7. **Deterministic cause baseline first**; AI runs automatically only where it beats the baseline on the labelled set.
8. **Privacy:** credential masking + personal/business-data minimization; per-event/instance/run byte caps; raw
   evidence never semantically indexed by default; response-body excerpts off by default.
9. **L4b is explanation-first**; AI may only rank `safeFix` kinds the validator emits. New fix kinds are deterministic
   owner-approved changes first.

## Milestones & dependencies

| ID | Name | Depends | File | Beads |
|---|---|---|---|---|
| L0 | Decisions & roadmap registration | — | `L0-decisions-and-registration.md` | `awkit-djnl.2` |
| L1 | AI foundation, autonomy & performance gate | L0 | `L1-ai-foundation.md` | `awkit-djnl.1` |
| L2 | Deterministic Recorder & Element Spy | L0 | `L2-recorder-and-element-spy.md` | `awkit-djnl.3` |
| L3 | Intelligent locators | L1, L2 | `L3-intelligent-locators.md` | `awkit-djnl.4` |
| L4 | Authoring diagnostics (L4a determ. / L4b AI) | L0 / L1+L4a | `L4-authoring-diagnostics.md` | `.5` / `.6` |
| L5 | Failure evidence (L5a) & intelligence (L5b) | L0 / L1+L5a | `L5-failure-evidence-and-analysis.md` | `.7` / `.8` |
| L6 | Fragments & templates | L2, L4 | `L6-fragments-and-templates.md` | `awkit-djnl.9` |
| L7 | Release confirmation | L1–L6 | `L7-release-confirmation.md` | `awkit-djnl.10` |

Beads is the source of truth for order and status (`bd ready` shows what can start); L0/L1 numbers are
swapped because the first L1 was filed with an inverted `--deps` edge and the titles were exchanged.

```
L0 ─┬─ L1 ─────────┬─ L3 ──┐
    ├─ L2 ─────────┘       ├─ L6 ─┐
    ├─ L4a ── L4b (needs L1)┘      ├─ L7
    └─ L5a ── L5b (needs L1) ──────┘
```

AI-dependent work (L3, L4b, L5b, AI parts of L6) may be **implemented** against the deterministic
providers under the conditional development authorization of 2026-09-20
(`L1-ai-foundation.md` › *L1 status: PARTIAL PASS*), but no such milestone **closes** before the
**L1 performance go/no-go PASS**. The `blocks` edges L1 → L3 / L4b / L5b encode acceptance and stay.

## Owner audit — existing owners to reuse (§6, L0 2026-09-19)

Verified against the code at `163b8b0`. *Extend* = the owner gains the Phase L capability; *Reuse* = used
as-is; *New* = no owner exists yet.

| Capability | Current owner (verified) | Decision | Justification |
|---|---|---|---|
| Recorder finalization | `src/recorder/buildRecordedFlow.ts`: the single finalizer; guarded-positional saved `resolution: "resolved"`, `resolvedBy: "recorder"`; `forwardLocatorFields` passes unknown locator keys through and hashes only `identity`/`guard` | Extend (L2 quality class and upgrade context; L3 trigger) | Stays the single finalizer; `pendingUpgrade` may hold no raw fingerprint because unknown keys bypass the hashing boundary |
| Locator schema and quality | `StepLocator`, `LocatorQuality` (`src/profiles/FlowProfile.ts`); `RecordedActionLocator` index signature (`src/recorder/RecorderTypes.ts`) | Extend (two optional fields) | Both names are unused in `src/`, `app/` and `scripts/`; the L2 class derives from `LocatorQuality` + `guard` + `identity`, with no parallel score |
| Positional and approval predicates | `src/profiles/locatorApproval.ts`: `isPositionalLocator`, `hasPositionalIdentityGuard`, `createLocatorApprovalBinding`, `invalidateStaleLocatorApproval` | Reuse | Deliberately shared by recorder, validator, runner and executor; the binding becomes the staleness key for both new fields |
| Editor mapping and round trip | `app/renderer/components/workflow/flowProfileMapping.ts` (`toFlowStep` spreads `originalStep.locator`, then runs the save-boundary invalidation); `FlowNodePropertiesPanel.tsx` `editLocator` | Extend (drop stale AI fields by binding at the save boundary) | Unknown keys survive every save, but `editLocator` clears only the fields it maps, so stale AI fields would outlive a user edit |
| Locator resolution | `src/runner/LocatorFactory.ts` `resolve()`: guard first (never tries `alternatives`), closed shadow, primary + `alternatives`, remembered winner, fingerprint/blueprint recovery (non-sensitive only) | Unchanged; L3 adds a post-resolution proof hook | `alternatives` execute and feed the memory digest, so pending candidates stay out. `guard` applies only to a positional primary, so a replaced guarded locator cannot serve as a fallback |
| Identity and guard | `ElementIdentityContract`, `LocatorGuard` (`FlowProfile.ts`); `src/runner/locatorFingerprint.ts`; `LocatorFactory.resolveGuardedPositional` (exact or ≥ 0.9 similarity plus preconditions) | Reuse as L3 proof gate C | "Same element" is already defined; no second identity model |
| Blueprint and recovery stores | `src/runner/LocatorBlueprintStore.ts`; `src/runner/LocatorRecoveryStore.ts` (`candidatesDigest`, `winningCandidateSignature`, `source`) | Extend the recovery store (replay-proof tallies); blueprint read-only | Runtime memory with no profile write, keyed by the candidate digest that pending candidates must not change |
| Failure evidence | `StepExecutor.captureFailureEvidence` (point-in-time); `src/runner/NetworkDiagnosticsObserver.ts` (per action); **`src/runner/observation/PassiveCdpTrace.ts`** (run lifetime, on unless `AWKIT_CDP_OBSERVATION=0`; `ExecutionEngine` drives `startGeneration`/`stopGeneration`; raw NDJSON ≤ 64 MB under `<instance root>/observation`; key-based redaction) | New L5a collector on the existing generation lifecycle | `PassiveCdpTrace` was missing from the V5 owner list. Reuse its lifecycle, not its stream: the raw trace is an env-disableable forensic artifact and never an AI input. New work: UI-error init script, step correlation, bounded masked `ExecutionEvidenceEvent`, report handoff |
| Browser context and pages | `src/runner/BrowserContextFactory.ts`, `src/runner/browser/SharedBrowserPool.ts`; `src/runner/PlaywrightRunner.ts` (closed-shadow init script once per context; single context `"page"` observer) | Reuse | L5a installs its init script beside the closed-shadow bridge; no second browser owner |
| Reports, durable store, retention | `src/reports/{ExecutionReport,TelemetryContracts}.ts`; `src/runner/store/{RuntimeStoreSchema,SqliteRuntimeStore}.ts`; `sweepRetention` at engine start (24 h, 5,000 runs, 14-day buckets, 90-day anomalies; env-overridable) | Extend (optional `diagnostics` report extension) | `diagnostics` is unused in `src/reports`; old reports load unchanged; evidence follows its report's retention |
| Redaction | `src/reports/SecretMasker.ts`; `src/semantic/SemanticRedactor.ts` (composes `SecretMasker`: URLs, auth schemes, JWTs, key/value pairs, blobs, paths, emails, ids of 6+ digits, 8,000-char cap); `SEMANTIC_PROJECTION_ALLOWLIST` (`src/semantic/SemanticProjection.ts`); `src/semantic/SemanticPolicyValidator.ts` | Reuse | Allowlist → redact → rescan already exists; a third redactor is forbidden |
| Permissions | `src/security/authz/Permissions.ts` (`ADMINISTRATOR_PERMISSIONS` is `ALL_PERMISSIONS` minus a denylist; `SENSITIVE_PERMISSIONS` re-auth) | Extend (L1.5; Risk-3, lease) | Every new permission is auto-granted to Administrator unless excluded; decide each one and assert both directions |
| Concurrency | `src/runner/concurrency/{WorkloadWeights,AdaptiveController,BackpressureController,MachineCapabilityDetector}.ts`; `ExecutionEngine.getRuntimeStatus()` | Extend (one inference reservation) | `WorkloadWeights` costs browser instances only; inference joins the same weighted budget, with no second scheduler |
| Out-of-process host | `app/main/semantic/ZvecUtilityHostManager.ts`; `src/semantic/{ZvecHostRestartPolicy,FakeZvecHostTransport}.ts`; `src/semantic/contracts/SemanticApi.ts` | New `AiService` built on the same pattern | Separate process and crash domain for llama.cpp; the narrow contract drops unknown properties |
| Validation and safe fixes | `src/validation/{FlowValidator,SafeFixApplier}.ts` (applies `normalizeEnumCasing`, `regenerateId`); `src/reports/PreRunValidator.ts`; `app/main/validation/flowValidationService.ts` | Reuse | Validators stay the source of truth; `SafeFixApplier` stays the only mutation authority |
| Profile writes | `src/profiles/ProfileLockManager.ts`, `app/main/atomicReplace.ts` | Reuse (promotion, revert, audit store) | Single writer; retry-safe tmp+rename |
| Model manifest | none | New: `src/offline/AiModelManifest.ts` (release role, Risk-3) | Mirrors `DependencyManifest.ts`; see `docs/ai/DECISIONS.md` |
| Autonomy policy, audit store, locator-plan compiler | none | New under `src/ai/` (L1, L3) | No owner exists; L1 registers `src/ai/**` in the routing matrix |

## Stability guarantees (global acceptance)

- No model / error / busy / disabled ⇒ behavior identical to today.
- Zero model calls on the synchronous run path; a `<3s` workflow provably waits on nothing.
- Recorder never pauses; Stop/Save never waits for AI.
- False-target promotion = 0; pending candidates never execute.
- Every automatic change is audited and one-click revertible; T3 unreachable.
- One inference at a time, yielding to Playwright; every queue, cap, and retry bounded.
- No raw prompt/response persistence by default.

## Phase M — Optional Application Knowledge Base (AKB)

Status: **PLANNED — zero implementation progress**. Roadmap Phase `M` (`pending`), Beads epic
`awkit-akb`. Phase M follows Phase L and does not change Phase L's status or acceptance.

### Objective and non-negotiable boundary

Enable SpecterStudio to optionally use an application's authorized UI source code as a local
knowledge base for enhanced locator suggestions, failure diagnosis and expected-result
recommendations.

Providing UI source code must **never** become a prerequisite for any part of the SpecterStudio
lifecycle. Recording, workflow design, execution, sessions, data binding, assertions, failure
analysis and reporting remain fully operational without the knowledge base or an AI model. The
knowledge base is optional, offline-capable and loosely coupled to the existing architecture.

This section registers planning only. It does not authorize implementation, dependencies, schemas,
services, UI components, model integrations or runtime behavior.

### Planned milestones and dependencies

| ID | Planned milestone | Depends | Beads |
|---|---|---|---|
| M1 | Optional source registration and deterministic indexing | Phase L release confirmation (L7) | `awkit-akb.1` |
| M2 | Hybrid source retrieval and model compatibility | M1 | `awkit-akb.2` |
| M3 | Source-aware locator assistance | M2 | `awkit-akb.3` |
| M4 | Source-aware failure analysis | M2 | `awkit-akb.4` |
| M5 | Expected-result and assertion assistance | M2 | `awkit-akb.5` |
| M6 | Indexing lifecycle and user-facing readiness | M3, M4, M5 | `awkit-akb.6` |
| M7 | Performance, security and verification | M3, M4, M5, M6 | `awkit-akb.7` |

The Beads `blocks` edges are the source of truth for this order. The Phase M epic is also blocked by
the Phase L epic, while M1 is explicitly blocked by L7 so implementation cannot be inferred ready
before Phase L release confirmation.

#### M1 — Optional source registration and deterministic indexing

- Support authorized UI repositories larger than 300 MB.
- Plan local structural indexing, incremental updates, source-version tracking and sensitive-data
  exclusions.
- Indexing must not require AI inference.

#### M2 — Hybrid source retrieval and model compatibility

- Use deterministic structural and full-text retrieval to provide relevant source context.
- Support the existing 0.8B model for narrowly scoped tasks only where measured accuracy is
  sufficient, while preserving optional compatibility with larger models.
- Never load the entire repository into model context.

#### M3 — Source-aware locator assistance

- Plan optional locator generation, comparison and recovery using indexed source metadata.
- Validate every candidate against the actual browser.
- Preserve existing locator behavior when source knowledge is unavailable.

#### M4 — Source-aware failure analysis

- Extend the Phase L failure-analysis architecture with relevant source context, evidence
  provenance, source-version checks and evidence-backed root-cause suggestions.
- Runtime evidence and deterministic safety gates remain authoritative.

#### M5 — Expected-result and assertion assistance

- Distinguish approved business expectations, source-derived implementation behavior and actual
  runtime observations.
- Require independent validation and approval before persisting proposed assertions.

#### M6 — Indexing lifecycle and user-facing readiness

- Plan source discovery, indexing, partial readiness, ready, updating, source mismatch and error
  states.
- Allow source-aware assistance for an individual component as soon as its relevant context is
  indexed and validated.
- Provide actual progress indicators, file counters, source coverage and contextual readiness.
- Keep normal automation available throughout processing.

#### M7 — Performance, security and verification

- Plan benchmarks for repositories of at least 300 MB, indexing and retrieval performance,
  resource consumption, 0.8B model effectiveness, retrieval accuracy, failure-diagnosis accuracy,
  offline operation, source security and AI-disabled fallback.
- Do not invent benchmark results or guaranteed processing times.

## Phase N — Visual Recognition and Automation

Status: **NOT STARTED — zero implementation progress**. Roadmap Phase `N` (`pending`), Beads epic
`awkit-vra`. Phase N follows the Phase L release foundation, remains separate from Phase L and
Phase M, and does not change either phase's status, acceptance criteria or dependencies. Phase M is
not a prerequisite for Phase N.

### Purpose and non-negotiable boundary

Introduce optional screenshot-based recognition, visual verification and image-assisted automation
for headed and headless Chromium.

Visual recognition must remain optional throughout the SpecterStudio lifecycle. Existing Playwright
locators remain the primary interaction mechanism, and normal recording, workflow design, execution,
sessions, data binding, assertions, failure analysis and reporting remain fully operational when
visual recognition, a vision model and the existing language model are disabled or unavailable.

Phase N preserves the existing Electron, React, TypeScript and Playwright architecture; operates
offline without admin rights or global runtime dependencies; reuses the Recorder, Runner, workflow
persistence and reporting owners; and respects screenshot privacy, redaction, protected-authentication
handoff and local-data storage policies. It introduces no mandatory AI, model, cloud or external-service
dependency. This section registers planning only and does not authorize implementation, dependencies,
schemas, services, UI components, models or runtime behavior.

### Planned workstreams and dependencies

| ID | Planned workstream | Depends | Beads |
|---|---|---|---|
| N1 | Visual capture infrastructure | Phase L release confirmation (L7) | `awkit-vra.1` |
| N2 | Visual reference management | N1 | `awkit-vra.2` |
| N3 | Deterministic image recognition | N2 | `awkit-vra.3` |
| N4 | Visual locator fallback | N3 | `awkit-vra.4` |
| N5 | Visual assertions and failure evidence | N2, N3 | `awkit-vra.5` |
| N6 | Headed and headless compatibility | N3, N4, N5 | `awkit-vra.6` |
| N7 | Optional local vision assistance | N3, N5, N6 | `awkit-vra.7` |
| N8 | Integration and acceptance verification | N4, N5, N6, N7 | `awkit-vra.8` |

The Beads `blocks` edges are the source of truth for this order. The Phase N epic is blocked by the
Phase L epic and N1 is explicitly blocked by L7, establishing the safe integration foundation. No
Phase N item depends on Phase M, so the two phases remain independently implementable.

#### N1 — Visual Capture Infrastructure

- Plan automatic, manual and event-triggered screenshot capture during authorized workflow recording
  and execution.
- Include element, region, viewport and full-page capture with configurable policies and privacy
  safeguards.

#### N2 — Visual Reference Management

- Plan local persistence of visual references and their association with workflow nodes.
- Include capture metadata, viewport dimensions, device pixel ratio, frame context, image retention
  and backward-compatible workflow serialization.

#### N3 — Deterministic Image Recognition

- Plan offline image matching and visual-state recognition without requiring an AI model.
- Include template matching, visual similarity, bounded confidence handling and explicit ambiguity
  reporting.

#### N4 — Visual Locator Fallback

- Plan optional visual recognition only when existing Playwright locators cannot reliably identify an
  element.
- Preserve DOM-first execution, target verification, uniqueness checks and existing locator-proof
  requirements.
- Never accept an unverified visual match as a successful interaction.

#### N5 — Visual Assertions and Failure Evidence

- Plan screenshot-based assertions, expected visual-state verification, visual regression detection
  and screenshot evidence for failed executions.
- Integrate through the existing execution-reporting architecture.

#### N6 — Headed and Headless Compatibility

- Plan consistent recognition and execution across headed and headless Chromium.
- Include viewport normalization, browser zoom, device pixel ratio, scrolling, frame-coordinate
  translation and safe coordinate-based interaction.

#### N7 — Optional Local Vision Assistance

- Plan optional local vision-model assistance for enhanced image understanding only when an approved
  model is available.
- Keep the deterministic recognition engine functional without the vision model or existing language
  model.
- Require separate offline, security, resource, performance, licensing and quality acceptance before
  any vision model can be approved.

#### N8 — Integration and Acceptance Verification

- Plan real-browser Test Lab scenarios, Recorder/Runner integration verification, privacy and
  accessibility checks, visual-match accuracy tests and fresh packaged-artifact validation.
- Explicitly verify that normal recording and workflow execution remain functional when visual
  recognition is disabled or unavailable.
