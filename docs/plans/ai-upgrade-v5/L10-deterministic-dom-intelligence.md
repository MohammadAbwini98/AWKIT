# L10 — Deterministic DOM Intelligence (Scrapling)

Shared rules and global decisions: `ROADMAP.md`; the L10 decisions (DI1–DI12): `ROADMAP.md` ›
*Phase L extension (2026-09-30) — L10* and `docs/ai/DECISIONS.md`. Beads `awkit-djnl.18`.
Depends (Beads `blocks`) on closed L3 (`awkit-djnl.4`), L5a (`awkit-djnl.7`) and L7
(`awkit-djnl.10`); independent of L8a/L8b/L9 (all closed) and of the open follow-up
`awkit-djnl.15`.

**Status (2026-09-30, final): CLOSED AS NO-GO on the owner's decision.** `awkit-djnl.18` is closed.
L10.1–L10.7 below are descoped and were never started, so read them as the design of record, not as
work to pick up. Reopening needs a new owner decision on one of the two routes in the L10.0 report.
The locator defects the fixtures exposed (`awkit-epbe`) were fixed separately in `6aedad35`.

**Status (2026-09-30): L10.0 EXECUTED — locator integration NO-GO, DOM normalization
NO-GO.** Parser-only Scrapling recovered 5 targets that AWKIT's recovery missed, but only one passes
the unchanged 0.86 / 0.08 gates, and there AWKIT's own scorer also finds the target without its scan
cap. It picked a wrong element in 6 of 16 cases. Its static text leaks hidden content that the
browser's `innerText` excludes. Evidence: `evidence/L10.0-dom-intelligence-gate-2026-09-30.md`.
L10.1–L10.7 are not started. Closing L10 as NO-GO or reopening it under a changed DI5 is the
owner's decision. No product code, Python runtime or host exists; the benchmark venv is dev-only in
`.cache/`.

Registration status (2026-09-30): PLANNED — registered only, zero implementation at registration.

## Objective

L10 adds optional, replaceable, parser-only, deterministic DOM intelligence without changing
AWKIT-owned boundaries for identity, proof, redaction, evidence and execution. It has two
narrowly bounded uses only:

- **Locator-recovery candidates** — after the existing locator stack and existing recovery are
  exhausted, parser-only Scrapling may propose deterministic candidates from DOM that
  Playwright already loaded. Candidates are evidence only and must pass AWKIT's existing gates
  before Playwright acts. Scrapling never clicks, fills, navigates, submits, opens a browser,
  fetches a URL or owns a session.
- **DOM normalization for AI context** — eligible runtime DOM may be normalized into a bounded
  typed semantic context before the existing redaction/evidence/prompt pipeline feeds the
  asynchronous local AI.

Success statement: SpecterStudio still executes exclusively through Playwright. Parser-only
Scrapling is an optional local DOM-intelligence provider. Normal successful steps do not
invoke it. After existing deterministic locator recovery is exhausted, it may provide bounded
candidate evidence that still must pass AWKIT's identity/proof rules. Eligible AI jobs may
receive a bounded sanitized semantic DOM representation instead of raw markup. With the
provider or model unavailable, existing automation remains operational.

## Non-goals and hard exclusions

- No Scrapling `StealthyFetcher` or `DynamicFetcher`.
- No Scrapling browser/session management, spiders/crawlers, or background crawling.
- No proxy rotation, TLS/browser fingerprint spoofing, or anti-bot/bot-detection bypass.
- No CAPTCHA/Turnstile solving.
- No Scrapling MCP server, Scrapling Agent Skill, or remote browser/CDP features.
- No arbitrary URL fetching through the host and no second Chromium.
- No Patchright, no second Playwright runtime, and none of the extras `scrapling[fetchers]`,
  `scrapling[rag]`, `scrapling[ai]` or `scrapling[all]`.
- The `rag` extra depends on the fetcher stack, so normalization uses the parser-only surface
  plus AWKIT-owned sanitization/serialization.
- No model call on the synchronous run path.
- Protected-login, MFA, OTP, CAPTCHA, passkey and device-approval surfaces are excluded from
  both uses.

`PROJECT_BRIEF.md`: "Not a general scraper — it is for authorized automation only (no
CAPTCHA/MFA/bot-detection bypass)". L10 is DOM analysis of pages already opened by authorized
Playwright automation.

## Architecture boundary

Locator recovery stays gated by existing proof and identity; DOM intelligence only proposes
candidate evidence:

```text
Playwright
   │
   ├── existing locator/local/blueprint recovery
   │                    │
   │                    ▼
   │          optional DOM intelligence
   │          candidate evidence only
   │                    │
   │                    ▼
   │          existing AWKIT proof/identity
   │                    │
   └────────────────────┴──► Playwright executes
```

AI-context normalization feeds the existing pipeline; no model call on the run path:

```text
Eligible runtime DOM
   │
   ▼
optional parser-only DOM intelligence
   │
   ▼
bounded semantic DOM context
   │
   ▼
existing redaction/evidence/prompt pipeline
   │
   ▼
local AI asynchronously
```

## Existing owners (reuse, never duplicate)

| Capability | Current owner | L10 relationship |
|---|---|---|
| Resolution, thresholds, bounded scans, page/context gates, sensitive-action refusal | `src/runner/LocatorFactory.ts` `resolve()`: guarded-positional first (never tries `alternatives`; exact or ≥ 0.9 similarity plus preconditions; `SENSITIVE_TARGET_IDENTITY_CHANGED`; never a sibling); owns the 0.86 confidence threshold and 0.08 runner-up margin | L10 runs only after this stack is exhausted and its candidates re-enter these gates unchanged |
| Closed-shadow bridge | `src/runner/LocatorFactory.ts` | Reused as-is; no second shadow path |
| Primary + `alternatives` | `src/runner/LocatorFactory.ts` | Reused as-is; L10 comes after it |
| Remembered winner | `src/runner/LocatorRecoveryStore.ts` | Reused as-is; L10 comes after it |
| Fingerprint/blueprint recovery (non-sensitive only) | `src/runner/LocatorBlueprintStore.ts` | Reused as-is; L10 comes after it |
| Frame chain | Playwright Frame graph (`FRAME_IDENTITY_CHANGED`) via `LocatorFactory` | L10 reads only the frame this chain resolved |
| Identity and approval binding | `ElementIdentityContract`, `LocatorGuard` (`src/profiles/FlowProfile.ts`), `src/profiles/locatorApproval.ts` | Candidates pass identity, approval and staleness checks |
| Proof and promotion | L3: `pendingUpgrade` never executes; `alternatives` execute and feed the memory digest; promotion needs replay proof; false-target promotion = 0 | A proven candidate serves only the current step; it never enters `alternatives`, winner memory or promotion unless the L3 contract independently permits it |
| Scrapling-style scoring already in the tree | `src/runner/locatorFingerprint.ts` `similarity()`: partial credit when identity-bearing attribute keys survive value drift; ORDERED ancestry so a wrapper insertion keeps the parent signal; fingerprints stay privacy-hashed; `scripts/verify-blueprint-recovery.mts` covers wrapper insertion | L10.0 must beat this `similarity()` on the same cases, not just the older layers |
| Failure evidence | `src/runner/evidence/*` (bounded versioned events, `SemanticRedactor` on every string, protected-login retraction; raw evidence never semantically indexed) | Reused as-is |
| Redaction | `src/reports/SecretMasker.ts`, `src/semantic/SemanticRedactor.ts`, `SEMANTIC_PROJECTION_ALLOWLIST`, `SemanticPolicyValidator` | Reused as-is; a third redactor is forbidden |
| AI boundary | `src/ai/AiService.ts` (the one model boundary), `src/ai/AiPromptBuilder.ts`; `verify:failure-capture-overhead` and `verify:ai-fallback` prove the run path reaches no model | Normalized context feeds this pipeline asynchronously only |
| Hosts | `app/main/ai/AiUtilityHostManager.ts`, `app/main/semantic/ZvecUtilityHostManager.ts` (Electron `utilityProcess`, Node only, restart policy, fake transports); the Oracle JDBC bridge is a spawned Java child process | Lifecycle conventions reused; a Python host would be a main-owned child process, decided in L10.0 |
| Offline and install | `src/offline/DependencyManifest.ts` (signed manifest, source hygiene); mutable data only under `%LOCALAPPDATA%/SpecterStudio`, never `resources/` or `app.asar` | Any new runtime follows it (Risk-3, lease-gated) |
| Python runtime | None in the shipped product today | L10.0 decides whether and how one is introduced |
| Mock site and verifiers | `mock-site/README.md`, `scripts/lib/verifier-classification.ts` | New scenarios and verifiers register there |

## External dependency facts (Scrapling 0.4.15 as inspected when the plan was written; L10.0 re-verifies)

- License BSD-3-Clause; requires Python >= 3.10.
- Base parser deps: `lxml>=6.1.1`, `cssselect>=1.5.0`, `orjson>=3.11.8`, `tld>=0.13.2`,
  `w3lib>=2.4.1`, `typing_extensions`.
- The `fetchers` extra pulls Playwright >= 1.62.0 and Patchright >= 1.62.1; L10 forbids it.
- Adaptive matching saves tag, attributes, text, element path, parent attributes/text, sibling
  tags and child tags.
- The default SQLite adaptive store persists those raw values, so it cannot be used unchanged.

## Design decisions (D1–D11, corrected by the 2026-09-30 review)

Corrections from the 2026-09-30 review win over the original decisions where they differ.

### D1 — Capability-named provider, not a Scrapling-shaped architecture

- Business logic outside the adapter never imports Scrapling concepts.
  `ScraplingDomIntelligenceProvider` is one implementation.
- Illustrative only — names final only after L10.0/L10.1:

```ts
// illustrative — names final only after L10.0/L10.1
interface DomIntelligenceProvider {
  getStatus(): Promise<DomIntelligenceStatus>;
  findRecoveryCandidates(request: DomRecoveryRequest): Promise<DomRecoveryResult>;
  normalizeForAi(request: DomNormalizationRequest): Promise<DomNormalizationResult>;
}
```

### D2 — Fail-open, no hard dependency

- If the host is unavailable, not packaged, incompatible, timed out, crashed, disabled or
  rejected by policy, SpecterStudio continues through the existing path.
- No non-AI automation feature may depend on Scrapling; host absence never blocks a run.

### D3 — Parser-only process boundary

- Finite, versioned commands only: `hello`, `health`, `save_reference`, `find_candidates`,
  `normalize_dom`, `shutdown`; the contract drops unknown properties.
- Never arbitrary Python, arbitrary commands, shell strings, URLs to fetch, file paths outside
  approved runtime/state roots, or browser-launch instructions.
- Reuses the existing host-manager conventions: restart policy, fake transport for verifiers,
  staged shutdown. An Electron `utilityProcess` runs only Node, so a Python host is a child
  process owned by main (like the Oracle JDBC bridge).
- L10.0 decides embedded CPython vs a frozen self-contained executable. It would be the first
  Python runtime in the product, so its `src/offline/**` manifest, packaging, source-hygiene
  and security slices are Risk-3 and lease-gated.

### D4 — AWKIT owns all browser I/O

- DOM enters the host only after Playwright loaded the page, for the frame the existing frame
  chain already resolved and authorized (e.g. `await frame.content()` or a more bounded
  existing capture path).
- The host never navigates and never receives a URL.

### D5 — Candidates are evidence, never authority

- A match never directly becomes a click: candidate → AWKIT locator/identity validation →
  existing proof rules → Playwright action.
- Every candidate passes the `LocatorFactory` gates unchanged: 0.86 confidence threshold, 0.08
  runner-up margin, bounded scans, page/context gates, `FRAME_IDENTITY_CHANGED` and
  `SENSITIVE_TARGET_IDENTITY_CHANGED` refusals, sensitive-action refusal, identity guard and
  approval binding. No bypass, no new threshold.
- DOM-intelligence recovery is non-sensitive only (same scope as blueprint recovery) and never
  re-routes a guarded-positional locator.
- A candidate never enters `alternatives`, `LocatorRecoveryStore` winner memory or promotion
  unless the L3 replay-proof/promotion contract independently permits it; `pendingUpgrade`
  still never executes; ambiguity fails closed.

### D6 — No model on the synchronous run path

- Scrapling may be a bounded deterministic recovery operation after a locator already failed;
  otherwise the step follows existing failure semantics and AI repair stays asynchronous.
- Every host call has a bounded timeout; timeout, crash or unavailability returns the original
  locator failure unchanged, never masked or replaced.
- `verify:failure-capture-overhead` and `verify:ai-fallback` (import-closure walks) are
  extended to cover the provider so the run path provably reaches no model through it.

### D7 — AWKIT-owned adaptive store, never Scrapling's default database

- Scrapling's default adaptive SQLite store is never used (it stores element text and
  attributes).
- Preferred: an AWKIT-controlled Scrapling `StorageSystemMixin` storing a minimized, redacted,
  bounded profile; alternative: an AWKIT-owned sidecar store reproducing the required record
  shape after sanitization.
- The store is versioned, bounded, redacted by the existing redactors, non-sensitive only,
  under `%LOCALAPPDATA%/SpecterStudio`, and prefers the hashed-fingerprint schema and the
  `LocatorBlueprintStore`/`LocatorRecoveryStore` lifecycle. It never writes into `resources/`,
  `app.asar`, the install directory or the Python package directory.

### D8 — Existing recovery stays primary; DOM intelligence is last

- Order: guarded-positional first (never tries `alternatives`, never a sibling) → closed-shadow
  bridge → primary + `alternatives` → remembered winner (`LocatorRecoveryStore`) →
  fingerprint/blueprint recovery (`LocatorBlueprintStore`, non-sensitive only) → only then DOM
  intelligence. Normal successful steps never invoke it.
- Reordering only with benchmark evidence.

### D9 — Structured, bounded normalization, not a new RAG system

- Normalization produces a bounded, typed projection, not a new index. Illustrative only —
  names final only after L10.0/L10.1:

```ts
// illustrative — names final only after L10.0/L10.1
interface SemanticDomContext {
  title?: string;
  landmarkRegions: DomRegion[];
  interactiveElements: DomInteractiveElement[];
  alerts: string[];
  forms: DomFormSummary[];
  tables: DomTableSummary[];
  visibleText?: string[];
  truncation: DomTruncationInfo;
}
```

- No third redactor: only `SecretMasker`, `SemanticRedactor`, `SEMANTIC_PROJECTION_ALLOWLIST`
  and `SemanticPolicyValidator`.
- Normalized context is never semantically indexed by default and never persisted merely for
  normalization.

### D10 — Protected-login DOM never leaves the manual handoff boundary

- Protected-login / MFA / OTP / CAPTCHA / passkey / device-approval DOM is never sent to
  recovery or normalization; the manual handoff boundary is preserved.
- Eligibility reuses existing signals only: recorder handoff detection and L5a's per-document
  protected-login state and retraction. No second detector.

### D11 — No shadow-DOM claim; frame-chain scoped

- `page.content()` / `frame.content()` does not serialize shadow roots; normal and same-frame
  DOM are supported.
- Iframes only through the frame the existing frame chain resolved and authorized.
- Open/closed shadow keeps the current AWKIT path; no shadow-DOM claim.

Owner ratification: `docs/ai/DECISIONS.md` › 2026-09-30 (DI1–DI12).

## Workstreams and order

Workstreams L10.0–L10.7 are defined in this file; Beads tracks only the milestone
`awkit-djnl.18`.

```text
L10.0  Architecture + dependency + measured incremental-value gate
  │
  ├──────────► L10.1  Provider contract + host protocol
  │                │
  └──────────► L10.2  Parser-only host + offline packaging
                   │
          ┌────────┴─────────┐
          ▼                  ▼
L10.3 Adaptive reference   L10.5 DOM normalization
      lifecycle                  for AI evidence
          │                  │
          ▼                  │
L10.4 Locator recovery       │
      integration            │
          └────────┬─────────┘
                   ▼
             L10.6 Availability,
          observability, reporting
                   │
                   ▼
             L10.7 Acceptance,
          performance, security,
             offline closeout
```

L10.0 blocks every other workstream.

### L10.0 — Architecture, dependency and incremental-value gate

**Status:** **done 2026-09-30.** Locator integration gate: NO-GO. DOM normalization gate: NO-GO.
- The rule was pre-registered in `8072804a` and the results committed in `aad6bc62`.
- Benchmark: `npm run benchmark:dom-intelligence`. Consistency: `npm run verify:dom-intelligence-gate`
  (27/0).
- Report: `evidence/L10.0-dom-intelligence-gate-2026-09-30.md`. It covers the matrix, the
  latency/memory/footprint measurements, the license inventory, the conditional runtime choice
  (embedded CPython as a main-owned child process) and the privacy design.
- Pre-existing AWKIT locator defects surfaced by the fixtures are tracked as `awkit-epbe`.

**Goal.** Prove whether parser-only Scrapling adds deterministic value beyond the existing
`src/runner/locatorFingerprint.ts` `similarity()` (the ordered-ancestry and partial-attribute
idea over privacy-hashed fingerprints) and the older recovery layers, and freeze the narrow
architecture and runtime choice. A NO-GO on both uses is a valid outcome: L10 then closes by an
owner decision recording the NO-GO (descoped), never by building anyway.

**Work**

- Inspect `LocatorFactory`, `LocatorRecoveryStore`, `LocatorBlueprintStore`, locator
  proof/promotion and the `similarity()` baseline; reuse `scripts/verify-blueprint-recovery.mts`
  fixtures where possible.
- Focused experiment with parser-only Scrapling on captured local Mock Site HTML (no browser, no
  network) against frozen mutations: wrapper insertion, element moved within region, `id`
  removed/changed, classes changed, stable `aria-*` retained, label/text slightly changed,
  sibling insertion/reordering, duplicated visible text, wrong same-tag candidate, page-variant
  mismatch.
- Compare existing local recovery, existing blueprint recovery and Scrapling; measure
  incremental recoveries, false-candidate rate, per-call latency, memory, process startup and
  serialized input/output size.
- Inspect licenses and binary/runtime implications of Scrapling and its parser deps. Decide the
  runtime: embedded CPython or a frozen self-contained executable, run as a main-owned child
  process (an Electron `utilityProcess` runs only Node). Record the decision in
  `docs/ai/DECISIONS.md`. Ship no locator behavior in this workstream.
- It would be the first Python runtime, so the later `src/offline/**` manifest, packaging,
  source-hygiene and security slices are Risk-3 and lease-gated.

**Gate / required evidence**

- Frozen fixture set and a before/after matrix showing lift beyond `similarity()` plus the older
  layers, not only beyond the older layers.
- Latency distribution, false-match matrix, dependency/license inventory, packaging strategy and
  an adaptive-storage privacy note.
- GO for locator integration only with measurable incremental recovery on cases the existing
  layers do not solve, without unacceptable false matches or latency. Normalization continues
  only if it passes its own value/security gate. Never add redundant adaptive logic merely
  because Scrapling is available.

### L10.1 — DOM intelligence provider contract and host protocol

**Status:** planned.

**Goal.** A replaceable capability boundary that does not couple runner/AI code to Scrapling,
usable without an AI model. No locator runtime change in this workstream.

**Work**

- Proposed modules (names fixed only when implemented):
  `src/dom-intelligence/{DomIntelligenceProvider,DomIntelligenceContracts,DomIntelligencePolicy,NoopDomIntelligenceProvider}.ts`
  and `app/main/dom-intelligence/{DomIntelligenceHostManager,ScraplingDomIntelligenceProvider}.ts`.
- Status `available{version}` | `disabled` | `unavailable{reason}`; requests
  `DomRecoveryRequest {correlationId, originKey, pageKey, stepKey, frameKey?, html, referenceId}`,
  `DomRecoveryCandidate {candidateSelector?, structuralPath?, score, evidence}`,
  `DomNormalizationRequest {correlationId, pageKey, html, scope?}`. Every type carries a protocol
  version, size caps, validated enums, bounded lists, deterministic serialization, and no
  executable/path/url field.
- Reuse the existing host-manager conventions (restart policy, fake transport for verifiers,
  contract that drops unknown properties, staged shutdown) instead of a parallel framework;
  every call has a bounded timeout and returns the original failure unchanged on
  timeout/crash.

**Gate / required evidence**

- Contract tests for version mismatch, malformed message, oversized input/response, unknown
  operation, invalid correlation id, host unavailable, timeout, cancellation and deterministic
  no-op fallback.
- Verifiers pass on the fake transport without a real host; no runner/AI module imports
  Scrapling types.

### L10.2 — Parser-only host and offline packaging

**Status:** planned.

**Goal.** Ship the minimal deterministic parser runtime without Scrapling's browser stack, using
the packaging chosen in L10.0.

**Work**

- No global Python, no internet, only pinned parser deps; never imports fetcher/spider/MCP
  modules; never downloads, launches a browser or makes HTTP requests.
- Started and stopped by AWKIT, terminated on app shutdown, exposes only the L10.1 protocol,
  keeps mutable state under `%LOCALAPPDATA%/SpecterStudio` or configured roots, and reports a
  deterministic version/health.
- Pin the Scrapling version, exact transitive versions, hashes, license/notice metadata and the
  host/runtime version; include the runtime in the `src/offline/**` manifest and the
  source-hygiene checks (Risk-3, lease-gated).

**Gate / required evidence**

- Verifiers: parser works from supplied HTML; no network/browser launch; forbidden extras
  absent; packaged runtime works with no global Python; a missing/corrupt host gives a truthful
  `unavailable` status and the existing fallback; no orphan process.
- Dependency manifest with pinned versions, hashes and license/notice metadata; source hygiene
  covers the runtime. Clean-machine PASS is never claimed unless executed on a clean machine.

### L10.3 — Privacy-safe adaptive reference lifecycle

**Status:** planned.

**Goal.** A minimal historical element reference for matching without an uncontrolled
plaintext DOM database. Scrapling's default SQLite store is never used and no AI call is made.

**Work**

- AWKIT-owned, versioned allowlist; bounded; redacted by the existing redactors only (no third
  redactor); stored under `%LOCALAPPDATA%/SpecterStudio`; non-sensitive steps only; prefers the
  hashed-fingerprint schema. Strips `value`, passwords, tokens, cookies, auth headers,
  secret-source values, credential-bearing URLs/query strings, event-handler source, `style` and
  `script`; expiry/invalidation bound to locator approval/identity staleness; never
  protected-login.
- Prefer the `LocatorBlueprintStore`/`LocatorRecoveryStore` lifecycle and path owners; prefer
  sidecar state over schema fields; any schema field optional with unknown fields
  round-tripping; no migration unless separately approved; old workflows unchanged.
- Seed only when needed: recorder finalization with a safe resolved element, first successful
  execution with no reference, or after a material locator edit invalidated one; the exact
  trigger follows the current owners (`buildRecordedFlow` is the single recorder finalizer).
- Duplicate/concurrent saves are idempotent and atomic through the existing retry-safe
  tmp+rename helper (`src/storage/atomicReplace.ts`, EPERM/EBUSY retry), never a new writer.

**Gate / required evidence**

- Tests for a safe button/input reference, secret-bearing attributes/text, a password field,
  protected-login exclusion, stale-edit invalidation, a corrupt record, duplicate/concurrent
  save, bounded size, and workflows that predate L10.
- A privacy note confirming the allowlist, redaction by the existing redactors, the bounds, and
  that Scrapling's default record (raw attributes, text, parent attributes, parent text) is
  never persisted unchanged.

### L10.4 — Deterministic locator recovery integration

**Status:** planned. Starts only after an L10.0 GO for locator integration and L10.1–L10.3.

**Goal.** Add DOM intelligence as a final deterministic candidate source after existing local
and blueprint recovery. Candidate evidence only; existing locator and identity proof remain
authoritative.

```text
LocatorFactory.resolve()
  guarded-positional → closed shadow → primary + alternatives
  → remembered winner (LocatorRecoveryStore) → blueprint (non-sensitive only)
    │
    ├─ resolved → execute normally; DOM intelligence is never called
    │
    └─ still unresolved, non-sensitive step, not guarded-positional
          ↓
    DOM-intelligence candidate lookup (bounded timeout)
          ↓
    LocatorFactory gates + identity + approval + L3 proof, unchanged
       ┌──┴──┐
     proven  weak / ambiguous / timeout / unavailable
       │        │
    execute   original failure, unchanged
              (+ asynchronous AI only where already allowed)
```

**Requirements**

- Every candidate passes the `LocatorFactory` gates unchanged: 0.86 threshold, 0.08 runner-up
  margin, bounded scans, page and context gates, `FRAME_IDENTITY_CHANGED` and
  `SENSITIVE_TARGET_IDENTITY_CHANGED` refusals, sensitive-action refusal, identity guard and
  approval binding. Ambiguity fails closed.
- Non-sensitive steps only, like blueprint recovery; never re-routes a guarded-positional
  locator; never enters `alternatives`, `LocatorRecoveryStore` winner memory or promotion unless
  the L3 replay-proof contract independently permits it; `pendingUpgrade` still never executes.
- No AI call in synchronous recovery, no broad retry loop, a bounded host timeout; an
  unavailable or timed-out host never replaces or masks the original failure.
- Reports and logs distinguish existing locator success, local recovery, blueprint recovery,
  candidate proposed, candidate rejected and candidate proven; provenance is observable without
  exposing sensitive DOM. No closed-shadow claim.
- Iframes only through the already-resolved authorized frame. No force interaction, no
  arbitrary sleep, no hidden bypass, no protected-login processing.
- Mock Site: extend the blueprint and locator recovery scenarios with deterministic mutations
  showing at least one incremental recovery beyond the existing layers and several false-match
  and ambiguity cases that must be rejected.

**Gate / required evidence**

- Incremental recovery beyond local and blueprint recovery, plus rejection of ambiguity, a wrong
  same-tag candidate, a page-variant mismatch, a stale adaptive reference, a sensitive step, a
  disabled or unavailable host, and a host timeout.
- Existing local or blueprint success does not invoke the provider; current workflows
  unchanged; no synchronous AI invocation; no existing locator verifier weakened.
- `verify:failure-capture-overhead` and `verify:ai-fallback` extended so the run path provably
  reaches no model through the provider.

### L10.5 — DOM normalization for AI evidence

**Status:** planned. Starts only after an L10.0 GO for normalization and L10.2.

**Goal.** Parser-only DOM to bounded structured context before AI prompting, preserving
diagnostic facts while reducing prompt size.

```text
Playwright DOM of the resolved, authorized frame
     ↓
existing eligibility gate (protected-login signals, capture policy)
     ↓
parser-only DOM intelligence
     ↓
AWKIT-owned bounded normalizer
     ↓
existing SecretMasker / SemanticRedactor / allowlist / policy validator
     ↓
bounded semantic context
     ↓
existing AiPromptBuilder → AiService queue (asynchronous)
```

**Requirements**

- Parser-only; never `scrapling[rag]` (it pulls the fetcher stack).
- Only the existing redactors (`SecretMasker`, `SemanticRedactor`,
  `SEMANTIC_PROJECTION_ALLOWLIST`, `SemanticPolicyValidator`); no third redactor. If policy
  requires, strip secrets before the host AND keep the existing pre-model redaction after
  normalization; the security review decides and documents the exact boundary.
- Normalized context is never semantically indexed by default and never persisted merely for
  normalization.
- Eligibility reuses the existing protected-login signals (recorder handoff detection, L5a
  per-document protected-login state and retraction); no second detector.
- Keep: page title and heading context, landmarks and regions, forms and labels, interactive
  elements, alerts and status messages, bounded tables and lists, target-neighborhood context,
  relevant visible text.
- Exclude: scripts, styles, hidden and template content, comments, zero-width and control noise,
  password and value contents, huge SVG and path data, data blobs, irrelevant
  framework-generated attributes, full-page HTML by default.
- Every collection and string bounded with truncation metadata. Provider unavailable → the
  existing evidence path.
- Validator facts, failure-baseline facts, display-gate authority and model output authority do
  not change.

**Gate / required evidence**

- Evaluation against the existing Phase L labelled and held-out sets: prompt bytes and tokens,
  retained diagnostic facts, answer and display-gate correctness, latency, generation time,
  redaction escapes, truncation. A smaller prompt is not a success if it drops causal evidence;
  no improvement is claimed without evidence.
- Mutation tests proving the verifier catches removed redaction, removed bounds, removed
  hidden-content stripping and removed fallback.
- `verify:failure-capture-overhead` and `verify:ai-fallback` extended to the provider.

### L10.6 — Availability, observability and reporting

**Status:** planned.

**Goal.** A diagnosable optional provider, not a user-facing automation engine: truthful status
and bounded observability without exposing sensitive data.

**Requirements**

- Status through the existing Settings / Offline Runtime / system-status owners: availability,
  provider, parser-only mode, version, browser access disabled, network access disabled, and the
  disabled or unavailable reason.
- Never expose proxy, crawler, stealth, CAPTCHA, arbitrary flags, browser configuration or remote
  fetch settings.
- Bounded counters: host starts and exits, normalization requests, candidate-recovery requests,
  candidates returned, proven and rejected, timeout and unavailable fallbacks, normalized input
  and output byte counts.
- Never log raw DOM, page text, credentials, adaptive records, prompts or secrets.
- Reports may name the provider as candidate provenance but never imply it executed the action;
  report schemas stay backward compatible.
- Any UI keeps Hologram tokens, keyboard access, focus visibility, reduced motion, light/dark and
  accent support.

**Gate / required evidence**

- Status correct for available, disabled and unavailable states with accurate reasons; no
  prohibited setting exposed.
- Counters bounded and accurate; no raw DOM or secret in logs or reports.
- Report provenance labelling and schema backward compatibility verified.
- GUI and non-GUI verification for any UI surface.

### L10.7 — Acceptance, performance, security and offline closeout

**Status:** planned.

**Goal.** Prove L10 improves intelligence without changing AWKIT's runtime guarantees. Closing
L10 does not close Phase L by itself; see *Milestone acceptance*.

**Acceptance matrix.** If L10.0 returned NO-GO for a use, that use's rows are recorded as
NO-GO/descoped by owner decision, never as PASS.

- **A — No provider:** absent, disabled, corrupt or crashed → existing flows run; with no AI
  model the locator provider still works where applicable and non-AI automation completes.
- **B — Locator:** current success never needs the provider; local and blueprint recovery stay
  primary; at least the L10.0-approved incremental cases recover; false and ambiguous candidates
  are rejected; sensitive actions keep stronger proof; no protected-login processing; no AI on
  the synchronous path.
- **C — Normalization:** size reduction measured; required failure and authoring facts retained;
  no new redaction escape; no unbounded dump; fallback when unavailable; answer-quality gates do
  not regress.
- **D — Offline and runtime:** no internet, no global Python, no extra browser, no Patchright, no
  fetcher extras, no admin, no mutable writes to the install directory, `resources/` or
  `app.asar`, truthful portable and installer manifests, clean startup and shutdown.
- **E — Performance:** host cold start, warm normalization, warm lookup, DOM-size scaling,
  concurrent runs with rare failure-triggered lookups, memory, package-size delta; the measured
  envelope is committed, with no arbitrary claims.
- **F — Security:** the protocol rejects arbitrary operations; no network, browser-launch, shell
  or arbitrary-path API; adaptive storage minimization; protected-login exclusion; log and report
  redaction; malformed host output rejected.

**Completion rule.** All production behavior implemented, regression green or truthfully
classified, package and offline evidence complete, architecture docs reflect reality, tracker,
ledger and roadmap sources agree ("Sources agree"), committed and pushed. Clean-machine gates may
be BLOCKED or NOT RUN but never PASS.

## Milestone acceptance

> With Scrapling absent or disabled, SpecterStudio behaves through the existing pre-L10
> paths. With the parser-only DOM-intelligence provider available, unresolved locator
> failures may receive bounded deterministic Scrapling candidates that still pass existing
> AWKIT identity/proof rules, and eligible AI features may receive a bounded sanitized
> semantic DOM representation. Playwright remains the sole browser executor; no Scrapling
> fetcher, crawler, stealth, proxy, CAPTCHA, anti-bot, secondary Playwright/Chromium, or
> synchronous model dependency is shipped.

L10 closes only through L10.7 (or, for a use that L10.0 returned NO-GO on, by an owner decision
recording that use as descoped). Phase L closes only when (1) the open follow-up
`awkit-djnl.15` is resolved under its own contract and (2) L10 has closed, unless the owner
explicitly descopes either. Registering L10 did not reopen or re-evaluate any closed milestone.

## Privacy contract

### Never persist

- passwords
- input values from protected/secret fields
- cookies
- `localStorage` / `sessionStorage`
- authorization headers
- bearer tokens
- API keys
- private keys
- secret-source values
- OTP / MFA / passkey / device-approval values
- request bodies
- full credential-bearing URLs
- protected-login DOM
- unbounded page HTML
- raw model prompts/responses outside existing approved stores

### Adaptive-record allowlist (AWKIT-owned, deliberately small)

- tag name
- `role`
- safe `id`
- safe `name`
- safe `type`
- safe `aria-*`
- `data-testid` or existing approved semantic test attributes
- bounded safe class tokens (never utility or hashed classes)
- bounded redacted visible text
- tag-only ancestry
- tag-only sibling/child context

The final allowlist is owned by AWKIT policy, versioned, and never inherited implicitly from
Scrapling.

## Performance policy

```text
normal success:   Playwright → existing locator → action (no lookup)
failure recovery: existing recovery exhausted → bounded DOM-intelligence lookup
                  → AWKIT proof → action or original failure
AI request:       eligible AI evidence event → bounded DOM normalization
                  → existing prompt/redaction/model queue
```

No arbitrary sleeps and no broad retries. The Phase L guarantee that a <3 s workflow waits on
nothing stays true because normal success never calls the provider. Every limit is measured,
not assumed.

## Backward compatibility

- Existing workflows load without L10 fields.
- Prefer sidecar runtime state over schema additions.
- Any additive field is optional, and unknown fields keep round-tripping.
- Old workflows behave identically with the provider absent or disabled.
- Material locator edits invalidate stale adaptive state.
- No migration unless separately approved and necessary.

## Relationship to other phases

### Phase L

- L3, L5a, L7 and L1/`AiService` remain the governing contracts for identity, proof, evidence,
  redaction and AI boundaries; L10 adds no new proof or redaction authority.
- L8a/L8b/L9 are closed and independent; L10 does not reopen or re-evaluate them.
- `awkit-djnl.15` stays independent and open under its own contract.

### Phase M — Optional Application Knowledge Base

- Phase M (`awkit-akb`) indexes optional authorized UI source code; L10 analyzes only the
  runtime DOM of the currently loaded page.
- Stores, provenance and authority stay separate; no Beads edge between L10 and Phase M.
- A later combination stays bounded context only:

```text
Runtime DOM evidence (L10)
          +
Optional source-code knowledge (M)
          ↓
stronger bounded context
```

### Phase N — Visual Recognition

- Phase N (`awkit-vra`) is visual recognition, an independent fallback for cases the DOM cannot
  represent.
- L10 implements no visual matching; no Beads edge between L10 and Phase N.

## Proposed verifiers (not registered; names fixed only when a verifier exists)

```text
verify:dom-intelligence-contract
verify:dom-intelligence-host
verify:dom-intelligence-offline
verify:dom-intelligence-storage
verify:dom-intelligence-locator
verify:dom-intelligence-normalization
verify:dom-intelligence-gui
verify:dom-intelligence-packaged
benchmark:dom-intelligence
```

Existing checks likely relevant:

```text
npm run build
npm run typecheck:scripts
npm run verify:mock-site
npm run verify:recorder
npm run verify:locator-guard
npm run verify:blueprint-recovery
npm run verify:blueprint-recovery-browser
npm run verify:ai-locator-repair
npm run verify:ai-fallback
npm run verify:failure-capture-overhead
npm run verify:failure-cause-baseline
npm run verify:failure-evidence
npm run verify:semantic-policy
npm run verify:source-hygiene
npm run verify:native-dependencies
npm run validate:offline
npm run verify:verifier-classification
npm run verify:roadmap-dashboard
git diff --check
```

Every new `verify:*` / `validate:*` is registered in `scripts/lib/verifier-classification.ts`
when it exists. Use the repository's actual commands at implementation time.

## Open questions for L10.0

1. Does parser-only Scrapling recover any frozen mutation that `locatorFingerprint.similarity()`
   plus blueprint recovery do not, at an acceptable false-candidate rate?
2. Embedded CPython or a frozen self-contained executable: package size, cold start,
   signing/source-hygiene and maintenance cost, for the product's first Python runtime?
3. Can the adaptive reference reuse the privacy-hashed fingerprint schema, or does Scrapling's
   matcher need raw-shaped fields (then only an AWKIT sidecar with the allowlist)?
4. Is `frame.content()` serialization cost acceptable for large DOMs on the failure path, or is
   a more bounded existing capture path needed?
5. Which exact seeding trigger fits the current owners (`buildRecordedFlow` finalization, first
   success without a reference, or post-edit invalidation)?

## Review record (2026-09-30)

- Fable 5.1 (CodeCraft, read-only REVIEW, split into two packets after the single packet timed
  out) returned APPROVE WITH REQUIRED CORRECTIONS.
- Corrections folded into D1–D11 and the workstreams: `LocatorFactory` gates unchanged;
  non-sensitive only and never guarded-positional; no memory/promotion without the L3 contract;
  fail-open with the original failure preserved; frame-chain-only HTML; AWKIT-owned adaptive
  store; no third redactor; the host is a main-owned child process, not a `utilityProcess`;
  L10.0 blocking and measured against `locatorFingerprint.similarity()`; import-closure
  verifiers extended.
- Claude corrected two review statements against the code: the host cannot literally be a Node
  `utilityProcess`, and L9 is already closed, so the closing rule names only `.15` and L10.
- Plan text authored with GLM-5.3 through CodeCraft (ASK mode) and reviewed and applied by
  Claude. Source: the owner's L10 plan and registration prompt of 2026-09-30.
