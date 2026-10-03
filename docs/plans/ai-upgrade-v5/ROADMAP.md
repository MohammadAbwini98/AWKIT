# SpecterStudio Phase L — Local AI & Intelligent Automation (V5)

**2026-10-02 (latest): Phase L COMPLETE for its approved scope. All 15 milestones are closed, and
`awkit-djnl.15` is resolved; E2 hybrid correlation stays pending.**
- **NVIDIA: qualified.** Every qualification gate passed on a GTX 980M at the physical console.
- **CPU & RAM fallback: supported.** GPU-Offload falls back with a visible reason; GPU-Only refuses truthfully.
- **E2 hybrid physical-adapter correlation: PENDING / BLOCKED** (owner decision, `docs/ai/DECISIONS.md`).
  - It is retained in the plan, not waived and not PASS.
  - It needs a trustworthy cross-runtime identity (LUID, PCI bus or an equivalent supported API).
  - It resumes when a supported runtime can establish
    `Windows physical adapter <-> Vulkan device <-> node-llama-cpp execution device` without heuristic
    matching.
- **Closing rule.** Met as recorded under *Phase L extension (2026-09-30) — L10*.

**2026-09-30: L10 closed as NO-GO — Phase L 14 of 14 milestones closed, still IN PROGRESS
until `awkit-djnl.15` resolves.**
- **Decision.** The owner closed `awkit-djnl.18` as NO-GO on the L10.0 result. L10.1–L10.7 are
  descoped and were never started. No Scrapling, Python runtime or host ships.
- **Reopening** needs a new owner decision on one of the two routes in the L10.0 report.
- **Follow-up.** The locator defects the fixtures exposed (`awkit-epbe`, outside Phase L) are fixed in
  `6aedad35`. The gate is `verify:locator-wrong-element`.

**2026-09-30: L10.0 executed — both L10 gates NO-GO; Phase L still 13 of 14 (93%).**
- **Locator.** Parser-only Scrapling recovered 5 targets that AWKIT's recovery missed. Only one passes
  the unchanged 0.86 / 0.08 gates, and there AWKIT's own scorer also finds the target without its
  200-element scan cap. Scrapling picked a wrong element in 6 of 16 cases, including all 3 no-match
  cases.
- **Normalization.** Scrapling's static text leaks hidden content that the browser's `innerText`
  excludes.
- **Next.** L10.1–L10.7 are not started. `awkit-djnl.18` stays open until the owner closes L10 as
  NO-GO/descoped or reopens it under a changed DI5.
- **Evidence and follow-up.** Evidence: `evidence/L10.0-dom-intelligence-gate-2026-09-30.md`. The
  pre-existing locator defects the fixtures exposed are `awkit-epbe`, outside Phase L.

**2026-09-30: L10 registered — Phase L is IN PROGRESS again, 13 of 14 milestones closed
(93%).** The owner widened the scope with L10 Deterministic DOM Intelligence (Scrapling)
(`awkit-djnl.18`), planned and open with zero implementation. The percentage fell because the
scope grew from 13/13 to 13/14, not because anything regressed: L0–L9 stay closed with their
evidence. `awkit-djnl.15` stays open for NVIDIA qualification and E2 hybrid correlation. Phase L
closes only under the closing rule in *Phase L extension (2026-09-30) — L10* below, which also
records decisions DI1–DI12 (ratified in `docs/ai/DECISIONS.md`).

**2026-09-29: L9 closed — Phase L reads 13 of 13 milestones closed (100%).** L9
(`awkit-djnl.13`, L9.1–L9.5) closed with QA PASS: one job-status contract pushed to the owning window,
bounded time budgets refused (never clamped) outside their committed bounds, one honest progress view
(determinate only from bytes copied or the runtime's own load fraction), and measured cold and warm ETA
ranges that survive a restart. Its packaged live evidence ran on the development machine under E11: the
real 0.8B in CPU & RAM, GPU-Offload (this machine's fallback) and GPU-Only (refused), plus the GPU
placements as mechanics on the AMD adapter; NVIDIA stays BLOCKED (`awkit-djnl.15`). Independent QC of
L8a, L8b and L9 is carried forward (`awkit-djnl.15`, `.16`, `.17`), as is the DX-0 freeze bug
(`awkit-djnl.14`).

**2026-09-28: L8a closed — Phase L reads 11 of 13 milestones closed (85%).** L8a
(`awkit-djnl.11`, L8a.0–L8a.5) closed on the owner's E11 decision: the AMD mechanics plus the
fake-host cases are its GPU evidence, and NVIDIA stays Compatible but unqualified. L8b
(`awkit-djnl.12`) and L9 (`awkit-djnl.13`) are open and not implemented.

**2026-09-27 extension: Phase L is IN PROGRESS again — 10 of 13 milestones closed (77%).**
After the closeout below, the owner widened the accepted scope with three new open milestones:
L8a hardware-adaptive inference runtime (`awkit-djnl.11`), L8b external compatible-model
registration and qualification (`awkit-djnl.12`) and L9 adaptive time budgets, progress and ETA
(`awkit-djnl.13`). The percentage fell because the scope grew, **not** because anything regressed:
L0–L7 stay closed with their original evidence. At that point nothing in L8a/L8b/L9 was implemented.
Decisions E1–E12 are in *Phase L extension (2026-09-27)* below and in `docs/ai/DECISIONS.md`.

**2026-09-27 closeout (the original ten milestones):** Phase L is **10 of 10 technical milestones closed**. L4b (`awkit-djnl.6`)
closed on frozen DX revision 4: L1.8 GO at 59,685 ms explanation cap, DX-0 through DX-5 MET,
52/52 displayed correct and actionable, 0/17, 0/18 and 0/17 undisplayed. The model selects
validator-owned, issue-specific action wording; no fallback is counted. L6 (`awkit-djnl.9`) closed
under its approved deterministic scope after 103/0, 53/0 real-Electron and 73/73 checks. The
earlier revision 2/3 failures below remain historical. L7 (`awkit-djnl.10`) passed fresh
portable and NSIS 0.1.51 packaged gates and both clean-machine local-AI runs. The licensed
walkthrough is BLOCKED on the offline issuer key; packaging human QC and the VS redistribution
statement remain external release prerequisites. Evidence:
`evidence/L4b-dx-revision-4-result-2026-09-26.md` and
`evidence/L7-fresh-package-clean-vm-2026-09-27.md`.

Historical status (superseded 2026-09-27): **IN PROGRESS — 7 of 10 milestones closed (updated 2026-09-26).** The closed ones are L0, L2, L4a
and L5a, plus L1, L3 and L5b. The last three were accepted, scope-limited, within the owner's limited GO.
The implementing agent accepted them under the owner's closeout delegation; that is not a human sign-off
(see `docs/ai/DECISIONS.md`). Still open:
- **L4b, 2026-09-26 (latest): R5 tried as DX revision 2, NOT MET; R6's 2B is L1.8 NO-GO.**
  - The owner decided in their own words: DX-3 automated, the held-out set confirmed, R5, then R6 on a qualified 2B.
  - **Revision 2** (`evidence/L4b-dx-revision-2-r5-2026-09-26.md`): DX-4 at 5/17 and 6/17, and DX-3 at 56 %
    correct and actionable, with 0 escapes.
  - **The 2B:** the explanation takes 191.7 s and 204.5 s, against the 125 s deadline. It is not pinned, and no
    run was taken on it.
  - **The blocker:** on this host, no runnable model meets both L1.8 and DX. The next step is the owner's.
- **L4b, 2026-09-26: DX NOT MET on the fresh runs.** Record: `evidence/L4b-dx-fresh-runs-2026-09-26.md`.
  - The held-out set was selected by a committed rule: 11 flows, 18 issues.
  - Two labelled runs and one held-out run were taken on DX-0.
  - **DX-4 fails:** labelled run 1 withheld 5 of 17, against a cap of 4.
  - DX-3 is PENDING: no person has read the 52 texts.
  - L4b stays open. Closing it needs an owner-authorized remedy (R5, R6 or a gate change), then a new held-out
    set, fresh runs and a person's reading.
  - The history below is unchanged.
- **L4b:** the owner authorized R1 (harness) and R2 (request) on 2026-09-25, and both are measured
  (`evidence/L4b-ai-technical-evaluation-2026-09-25-after-R1-R2.md`). R4, the deterministic display gate,
  was authorized and built the same day (`a89a14bd`, L4 › R4).
  - It withholds all 8 unsupported answers of the 34 and 2 correct restatements, and shows 24.
  - The target is **NOT MET**. Withheld answers never count, so criterion 2 reads 13/17 and 11/17.
    Criteria 1 and 4 still await a person.
  - The owner must decide whether the target measures the answers a person sees or every answer the
    model produces. R5 and R6 await the owner.
  - The one decision is set out in `evidence/L4b-decision-record-2026-09-25.md`. Its consolidated form, with
    the delivered-experience criteria DX-0 to DX-5 stated precisely, is
    `evidence/L4b-owner-decision-proposal-2026-09-25.md`.
  - The R4 mutation run, blocked earlier, is done without editing product source: 15 of 15 mutants killed.
- **L6:** its deterministic scope is verified. It is blocked only by L4b. By the owner's decision of
  2026-09-25, the unbuilt intelligence (the T1 mapping review, Zvec fragment discovery, production fragment AI)
  is deferred to a tracked follow-up outside Phase L.
- **L7:**
  - `awkit-i6ot`: the app-local Visual C++ runtime is implemented. It waits for the owner to add the VS 2022
    C++ tools and redist to the build machine, then a rebuild and the packaged gates.
    - Re-checked later on 2026-09-25, after the owner reported them installed: VS 2022 Community had the ARM
      build tools, but not `VC.Tools.x86.x64` or `VC.Redist.14.Latest`, and there was no x64 CRT folder.
    - **Resolved the same evening.** The owner installed both components, staging succeeds, and portable
      and NSIS were rebuilt, finally from clean `62aab2dc`. Every packaged gate passes, including the loader proof
      without the host's global runtime (L7 › `awkit-i6ot`).
    - It stays open only for the clean-machine VM, which needs an operator. The procedure is
      `evidence/L7-clean-machine-procedure-0.1.51.md`.
  - The licensed walkthrough (issuer key; re-checked 2026-09-25, still BLOCKED) and the clean-machine VM
    (operator).
  - Done on 2026-09-24: the performance confirmation (GO on all 8) and the engineering security evidence
    review. The latter is not an independent sign-off.
  - On 2026-09-25 an independent AI QC review of the packaging found no regression of QC-1..QC-7. Its new
    findings F1–F7 are fixed.

The limited GO (2026-09-23) covers on-demand explanations, locator proposals and manual failure analysis
only. Owner audit below; decisions ratified in `docs/ai/DECISIONS.md`.
Roadmap Phase `L` (`in-progress` since the 2026-09-30 L10 registration; `complete` from 2026-09-29
at 13/13, and `complete` for the original ten), Beads epic `awkit-djnl`.
Supersedes the external V1–V4 drafts (`SpecterStudio_AI_Upgrade_*`).
This file is the only copy of cross-cutting content (rules, architecture, autonomy policy, decisions).
Milestone files `L0`–`L10` hold only milestone-specific tasks.

## Objective

Make SpecterStudio intelligent and automated with one local, CPU-only model, without ever making the model an
authority or a dependency:

> **SpecterStudio captures, proves, and applies. AI proposes, ranks, explains, and correlates.
> Automation is event-driven and policy-tiered; every automatic change is proven, audited, and revertible.**

*Superseded in part on 2026-09-27 (E1–E4):* "one local, CPU-only model" now reads "one local model at a
time, on CPU & RAM by default, optionally offloaded to a compatible NVIDIA GPU by an administrator's
choice, from the curated packs or any compatible GGUF". The GPU is never required.

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

*Superseded in part on 2026-09-27:* the envelope's "no GPU" becomes "no GPU **required**" (E4), and
"only manifest-listed packs are accepted" becomes "curated packs are the qualified list; any compatible
GGUF may be registered" (E1, E6, E7). The manifest keeps pinning the curated packs and gains a backend
manifest for user-supplied GPU components (E3). The historical text above remains the record of what
L0–L7 were accepted against.

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
| L8a | Hardware-adaptive inference runtime (2026-09-27 extension, closed 2026-09-28) | L1, L7 | `L8a-hardware-adaptive-inference-runtime.md` | `awkit-djnl.11` |
| L8b | External compatible-model registration & qualification (extension, closed 2026-09-29) | L8a | `L8b-external-model-compatibility.md` | `awkit-djnl.12` |
| L9 | Adaptive time budgets, progress & ETA (extension, closed 2026-09-29) | L8a, L8b (acceptance) | `L9-adaptive-time-progress-eta.md` | `awkit-djnl.13` |
| L10 | Deterministic DOM intelligence (Scrapling) (2026-09-30 extension; closed NO-GO 2026-09-30 after L10.0, L10.1–L10.7 descoped) | L3, L5a, L7 | `L10-deterministic-dom-intelligence.md` | `awkit-djnl.18` |

Beads is the source of truth for order and status (`bd ready` shows what can start); L0/L1 numbers are
swapped because the first L1 was filed with an inverted `--deps` edge and the titles were exchanged.

```
L0 ─┬─ L1 ─────────┬─ L3 ──┐
    ├─ L2 ─────────┘       ├─ L6 ─┐
    ├─ L4a ── L4b (needs L1)┘      ├─ L7 ── L8a (needs L1) ─┬─ L8b ── L9
    └─ L5a ── L5b (needs L1) ──────┘                        └─────────┘

L3 + L5a + L7 ── L10 (2026-09-30 extension, planned)
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

## Phase L extension (2026-09-27) — L8a, L8b, L9

Status: **CLOSED — L8a closed 2026-09-28, L8b and L9 closed 2026-09-29.** The owner widened Phase
L's accepted scope after the 10/10 closeout. L0–L7 are not reopened, renumbered or re-evaluated; their
evidence stands. The stability guarantees above apply unchanged to every new milestone.

| ID | Milestone | Depends (Beads `blocks`) | Beads |
|---|---|---|---|
| L8a | Hardware-adaptive inference runtime (**closed 2026-09-28**, E11 decided) | closed L1, closed L7 | `awkit-djnl.11` |
| L8b | External compatible-model registration & qualification (**closed 2026-09-29**, QC carried forward) | L8a | `awkit-djnl.12` |
| L9 | Adaptive time budgets, progress & ETA UX (**closed 2026-09-29**, QC carried forward) | L8a, L8b (acceptance; L9.1 may start in parallel) | `awkit-djnl.13` |

Phase L now reads **13 of 13 milestones closed (100%)** (L8a closed 2026-09-28, L8b and L9 2026-09-29).
The epic `awkit-djnl` stays open only as the container of the carried-forward follow-ups (`.14`–`.17`).

### Owner decisions (2026-09-27; ratified in `docs/ai/DECISIONS.md`)

- **E1 — The model stays external and optional; registration copies.** No model in the installer or
  portable. The user selects a compatible GGUF in Settings → Local AI; it is **copied** into the
  app-managed model root after a disk-space preflight, hashed during the copy, with path
  confinement and tamper/replacement protection unchanged. Never a referenced path or a hard link.
  AI disabled, no model, load failure, unsupported GPU or host failure never affects a
  deterministic feature.
- **E2 — NVIDIA eligibility is capability-based, never product-based.** NVIDIA = PCI vendor ID
  0x10DE as reported by the runtime. Enumerate every adapter on the running machine (hybrid
  graphics included). Suitability comes from backend/driver compatibility, runtime-reported
  capability, usable VRAM against model + context + buffers + reserve, and current workload. No
  GPU-name table, no fixed VRAM minimum, and no claim that every NVIDIA GPU works. AMD/Intel
  adapters are detected but not enabled.
- **E3 — GPU components are user-supplied, pinned and copied; Vulkan first.** Nothing GPU ships
  in the installer. Selecting a GPU mode opens a required-components checklist; the user points to
  each component and the mode cannot activate until all validate. The llama.cpp GPU backend pack
  is checked file-by-file against a release-owned backend manifest (exact SHA-256 for the pinned
  `node-llama-cpp@3.21.1+llama.cpp@v0.4.0` build); NVIDIA CUDA DLLs, once CUDA is added, by name,
  version range and NVIDIA Authenticode signature. Components are copied into an app-managed folder
  and loaded only from there. Vulkan (driver-supplied `vulkan-1.dll`) is the first backend; CUDA is
  a later manifest entry with its own evidence. The runtime pin becomes backend-aware.
- **E4 — Three administrator-selected modes; no automatic planner.** CPU & RAM only (default,
  today's behavior), GPU-Offload (largest safe partial offload, full if it fits, bounded retry then
  CPU with a reason) and GPU-Only (every layer on the GPU or a refusal naming the shortfall; never a
  silent CPU fallback). Auto, GPU-preferred and manual layer override are dropped. Offload sizing
  uses the runtime's own VRAM measurement and fit, probed on 3.21.1, plus a bounded reserve. VRAM
  exhaustion after load demotes or unloads with its own reason and never trips the restart
  circuit as a crash. Adapter choice exists only if the runtime can pin a device.
- **E5 — Offline runtime contract.** App-local, pinned components only; no download, driver
  install, source build, CDN, cloud, admin right, global Node or global inference runtime. The
  handshake reports runtime build, backend, adapters, selected adapter, VRAM where reliable,
  requested/effective layers, fallback reason and threads, path-free. GGUF parsing and backend
  probing happen only in the utility host. Crash boundary, bounded queue, one inference at a time,
  cancel/kill-restart, idle unload, Playwright yielding and zero synchronous-path model calls are
  unchanged; `WorkloadWeights` and the yield policy are unchanged in Phase L. The ≤3 s cancel
  ceiling is re-measured on GPU.
- **E6 — Compatible is not Qualified.** Compatibility is a static header stage plus a bounded
  dynamic probe (load, one constrained generation, thinking verifiably off), both in the host.
  **Quality qualification** is keyed by model hash + runtime build + backend + offload class +
  context + KV/attention settings + feature + budget and carries across hardware; the **latency
  class** adds a hardware class and is measured locally or not claimed. One configuration never
  qualifies another. Labels: Compatible, Qualified, Compatible but unqualified, Incompatible.
  Existing 0.8B/2B/4B CPU evidence stays with its historical key. `AiActionRecord` records the
  effective profile. The licensing fingerprint is never used.
- **E7 — Trust boundary.** Accepting arbitrary GGUF files supersedes the 2026-09-19 manifest-only
  rule; threat model recorded (GGUF-parser advisories, host runs with user privileges). Keep
  `AI_MANAGE` + re-auth, add no permission, require an "unverified model" acknowledgement. Every
  `src/offline/**`, security and packaging slice is Risk-3 and lease-gated.
- **E8 — Feature time budgets.** Bounded per-feature budgets; ceilings, request timeouts, cancel
  grace and ETA ranges kept separate; admin values only within committed bounds and refused
  outside them; the historical 120/125 s values stay as closed-profile evidence; a raised timeout
  never converts an old failure into a pass.
- **E9 — Honest progress and ETA.** One job-status contract (state, queue position, stage,
  elapsed, ETA range with confidence and cold/warm, effective profile, cancel, terminal reason).
  Determinate only with a known denominator; generation indeterminate; never a percentage from
  elapsed time. ETA history is bounded non-sensitive aggregates under `%LOCALAPPDATA%`. Accessible
  progress (`aria-valuenow` only when determinate, throttled announcements, focus contract).
- **E10 — Phases M and N stay independent.** The epic-level edges `awkit-akb → awkit-djnl` and
  `awkit-vra → awkit-djnl` are removed; M1 and N1 keep their edge on closed L7. The agent lease
  guard's Beads grammar has no dependency removal, so the owner ran both `bd dep remove` commands
  on 2026-09-27; `bd ready` again lists both phase epics, M1 and N1.
- **E11 — Evidence scope: the development machine.** Phase L was accepted on the development
  machine, so L8a/L8b/L9 evidence is taken there too, on the **packaged build**. No external
  machine, clean-VM GPU run or second adapter is required. The loader-isolation proof (nothing
  resolved from PATH, a system CUDA Toolkit or the dev tree) is mandatory precisely because the
  development machine carries the most global tooling. Claims stay truthful: GPU modes are
  verified on the development machine's adapter; every other adapter is Compatible but
  unqualified until run.
  - **Decided 2026-09-28 (owner):** the development machine has no NVIDIA adapter, so L8a's GPU
    evidence is the vendor-independent mechanics proven on its AMD adapter (source and packaged
    trees) plus the fake-host cases.
  - E2 is unchanged (AMD is still not eligible), NVIDIA stays Compatible but unqualified, and nothing
    claims NVIDIA qualification. See `docs/ai/DECISIONS.md`.
- **E12 — Supersessions, appended not rewritten.** The Objective's "one local, CPU-only model",
  the Model baseline's "no GPU" and manifest-only admission, and `DECISIONS.md` 2026-09-19
  "no user override" are superseded as noted in place; the historical text stays.

### Future touchpoints (not edited by this registration)

AI settings/store/API (`src/ai/AiSettings.ts`, `AiService.ts`, `contracts/AiApi.ts`), renderer
`app/renderer/pages/LocalAiSettings.tsx`, `src/ai/contracts/AiHostProtocol.ts`,
`app/main/ai/AiUtilityHostManager.ts`, `app/main/ai/aiRuntime.ts`, `native-hosts/ai/ai-host.cjs`,
`src/offline/AiModelManifest.ts`, `src/ai/AiModelPack.ts`, `src/ai/AiAdmission.ts`,
`src/ai/AiActionRecord.ts`, `app/main/ipc/ai.ipc.ts`, `app/main/preload.ts`, the feature UIs,
`scripts/prepare-ai-native-host.mjs`, `scripts/validate-offline-bundle.ps1` and
`scripts/lib/verifier-classification.ts`. Planned verifiers are named in each milestone file and
registered only when they exist.

## Phase L extension (2026-09-30) — L10

Status: **CLOSED AS NO-GO 2026-09-30** (owner decision). L10.0 executed with locator integration
NO-GO and DOM normalization NO-GO (`evidence/L10.0-dom-intelligence-gate-2026-09-30.md`).
L10.1–L10.7 are descoped and were never started.

Registration (2026-09-30): planned, zero implementation at registration. The owner widened Phase L
after it read `complete` at 13/13 on 2026-09-29. Nothing earlier is reopened, renumbered or re-evaluated;
the stability guarantees above apply unchanged to L10.

| ID | Milestone | Depends (Beads `blocks`) | Beads |
|---|---|---|---|
| L10 | Deterministic DOM intelligence (Scrapling) (**planned**) | closed L3 (`awkit-djnl.4`), closed L5a (`awkit-djnl.7`), closed L7 (`awkit-djnl.10`) | `awkit-djnl.18` |

Phase L now reads **13 of 14 milestones closed (93%)**.

**Closing rule:** Phase L closes only when (1) `awkit-djnl.15` is resolved under its own contract
and (2) L10 closes through L10.0–L10.7 (a use that L10.0 returns NO-GO on is closed only by an
owner decision recording it descoped), unless the owner explicitly descopes either.

**Met 2026-10-02.**
- (2): L10 closed as NO-GO on 2026-09-30, and L11, registered after this rule under the same terms, closed
  on 2026-10-01.
- (1): `awkit-djnl.15`'s items are done, decided or carried forward:
  - QC done; NVIDIA qualification PASS; verify-to-load window an accepted risk; confinement mutation done;
    routing gap fixed.
  - E2 hybrid correlation carried forward as a pending capability, PENDING / BLOCKED, by the owner's
    2026-10-02 decision.
- E2 is not descoped. It stays in L8a's plan with its acceptance unchanged.

### Scope

- **Locator-recovery candidates:** after `LocatorFactory.resolve()` is exhausted
  (guarded-positional, closed shadow, primary + `alternatives`, remembered winner, blueprint
  recovery), parser-only Scrapling may propose deterministic candidates from DOM that Playwright
  already loaded. Evidence only, through the unchanged `LocatorFactory` gates, identity, approval
  and L3 proof.
- **DOM normalization for AI context:** eligible DOM becomes bounded typed context before the
  existing `SecretMasker`/`SemanticRedactor`/allowlist and `AiPromptBuilder` → asynchronous
  `AiService`.
- Full plan, hard exclusions and privacy contract: `L10-deterministic-dom-intelligence.md`.

### Owner decisions (2026-09-30; ratified in `docs/ai/DECISIONS.md`)

- **DI1** L10 is one Phase L milestone (`awkit-djnl.18`) with its workstreams in the plan file;
  Phase L reads 13/14 and is `in-progress`; closing rule above.
- **DI2** Parser-only Scrapling is optional and replaceable behind a capability-named provider
  contract; no Scrapling concept outside the adapter.
- **DI3** Playwright is the sole browser, session, navigation and action authority; the host never
  fetches, navigates or launches; HTML comes only from the frame the existing frame chain resolved.
- **DI4** Existing recovery stays primary; DOM intelligence runs only after
  `LocatorFactory.resolve()` is exhausted; normal successful steps never call it.
- **DI5** Candidate evidence only: unchanged `LocatorFactory` gates (0.86 threshold, 0.08 margin,
  page/context, frame and sensitive identity refusals), identity, approval, sensitive-action
  refusal and L3 proof/promotion; non-sensitive only; never guarded-positional; no `alternatives`,
  winner memory or promotion unless L3 permits; ambiguity fails closed.
- **DI6** No synchronous AI: no model call on the run path; normalization feeds only the
  asynchronous `AiService`; `verify:failure-capture-overhead` and `verify:ai-fallback` extend to
  the provider.
- **DI7** Hard exclusions: Scrapling fetchers (`StealthyFetcher`, `DynamicFetcher`), sessions,
  spiders/crawlers, stealth and fingerprint spoofing, proxies, CAPTCHA/Turnstile, anti-bot, MCP
  server, Agent Skill, remote browser/CDP, arbitrary fetch, Patchright, a second Playwright or
  Chromium, and the `fetchers`/`rag`/`ai`/`all` extras. SpecterStudio stays "not a general
  scraper".
- **DI8** Scrapling's default adaptive storage is rejected; an AWKIT-owned minimized, redacted,
  bounded, versioned store under `%LOCALAPPDATA%/SpecterStudio`; no third redactor.
- **DI9** Protected-login, MFA, OTP, CAPTCHA, passkey and device-approval surfaces are excluded
  from both uses, reusing the existing protected-login signals.
- **DI10** Fail-open: an absent, disabled, unavailable, timed-out or crashed provider leaves
  pre-L10 behavior with the original failure unchanged; no non-AI feature depends on it.
- **DI11** L10.0 is a blocking value and packaging gate with separate GO/NO-GO for locator
  integration and for normalization, measured against `locatorFingerprint.similarity()`; it
  chooses embedded CPython or a frozen host, run as a main-owned child process; the product's
  first Python runtime is Risk-3 and lease-gated.
- **DI12** Phases M and N stay separate in stores, provenance and authority; L10 adds no Beads
  edge to either.

### Workstreams (full plan: `L10-deterministic-dom-intelligence.md`)

- L10.0 Architecture, dependency and incremental-value gate
- L10.1 DOM intelligence provider contract and host protocol
- L10.2 Parser-only host and offline packaging
- L10.3 Privacy-safe adaptive reference lifecycle
- L10.4 Deterministic locator recovery integration
- L10.5 DOM normalization for AI evidence
- L10.6 Availability, observability and reporting
- L10.7 Acceptance, performance, security and offline closeout

### Future touchpoints (not edited by this registration)

`src/runner/{LocatorFactory,LocatorBlueprintStore,LocatorRecoveryStore,locatorFingerprint}.ts`,
`src/runner/evidence/*`, `src/ai/AiPromptBuilder.ts`, `src/semantic/SemanticRedactor.ts`, a new
capability module (proposed `src/dom-intelligence/`), a main-owned host manager (proposed
`app/main/dom-intelligence/`), `src/offline/DependencyManifest.ts`,
`scripts/validate-offline-bundle.ps1`, `mock-site/` and `scripts/lib/verifier-classification.ts`.
Planned verifiers are named in the milestone file and registered only when they exist.

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
before Phase L release confirmation. *2026-09-27:* the epic-level edge was removed (E10),
so the Phase L extension does not hold Phase M back; M1's edge on closed L7 stays.

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
Phase L epic and N1 is explicitly blocked by L7, establishing the safe integration foundation.
*2026-09-27:* the epic-level edge was removed (E10); N1's edge on closed L7 stays. No
Phase N item depends on Phase M, so the two phases remain independently implementable.

#### N1 — Visual Capture Infrastructure

- Plan automatic, manual and event-triggered screenshot capture during authorized workflow recording
  and execution.
- Include element, region, viewport and full-page capture with configurable policies and privacy
  safeguards.
- *2026-10-03:* the plan is `N1-visual-capture-infrastructure.md`. Zero implementation; implementation
  waits for the owner decisions VC-D1 to VC-D10 listed there and an explicit authorization.

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
