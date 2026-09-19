# SpecterStudio Phase L — Local AI & Intelligent Automation (V5)

Status: **PLAN — not started; registered 2026-09-19** as roadmap Phase `L` (`pending`) and Beads epic
`awkit-djnl`. Supersedes the external V1–V4 drafts (`SpecterStudio_AI_Upgrade_*`).
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

- Admin may lower any feature tier; raising is capped at T2; T3 is unreachable by configuration (verified).
- **Self-demotion:** if a T2 feature's revert rate (from `AiActionRecord`) exceeds a committed threshold, the policy
  demotes it to T1 and surfaces the reason.
- Master AI switch off ⇒ every feature behaves as today.

## Global decisions (recorded in L0)

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

AI-dependent work (L3, L4b, L5b, AI parts of L6) starts only after the **L1 performance go/no-go PASS**.

## Existing owners to reuse (§6)

- Host: `app/main/semantic/ZvecUtilityHostManager.ts`, `src/semantic/ZvecHostRestartPolicy.ts`,
  `src/semantic/FakeZvecHostTransport.ts`, `SemanticApi.ts` (narrow IPC contract pattern).
- Redaction: `src/reports/SecretMasker.ts`, `src/semantic/SemanticRedactor.ts`, `src/reports/SecurityPolicy.ts`.
- Resources: `src/runner/concurrency/{WorkloadWeights,AdaptiveController,BackpressureController,MachineCapabilityDetector}.ts`.
- Permissions: `src/security/authz/Permissions.ts` (`ADMINISTRATOR_PERMISSIONS` is a denylist).
- Locators: `src/profiles/FlowProfile.ts`, `src/recorder/RecorderTypes.ts`, `src/recorder/buildRecordedFlow.ts`,
  `src/profiles/locatorApproval.ts`, `src/runner/{LocatorFactory,LocatorBlueprintStore,LocatorRecoveryStore,locatorFingerprint}.ts`.
- Validation: `src/validation/{FlowValidator,SafeFixApplier}.ts`, `src/reports/PreRunValidator.ts`,
  `app/main/validation/flowValidationService.ts`.
- Failure/reporting: `StepExecutor.captureFailureEvidence`, `src/runner/NetworkDiagnosticsObserver.ts`,
  `src/reports/{ExecutionReport,TelemetryContracts}.ts`.
- Profiles: `src/profiles/ProfileLockManager.ts`, `app/main/atomicReplace.ts`.
- Roadmap: `src/roadmap/ImplementationRoadmap.ts`.

## Stability guarantees (global acceptance)

- No model / error / busy / disabled ⇒ behavior identical to today.
- Zero model calls on the synchronous run path; a `<3s` workflow provably waits on nothing.
- Recorder never pauses; Stop/Save never waits for AI.
- False-target promotion = 0; pending candidates never execute.
- Every automatic change is audited and one-click revertible; T3 unreachable.
- One inference at a time, yielding to Playwright; every queue, cap, and retry bounded.
- No raw prompt/response persistence by default.
