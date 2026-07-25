# Flow Validation Engine — Tranche 2 Implementation Report

**Session date:** 2026-07-21 → 2026-07-22
**Branch:** `feature/randomized-test-lab` (3 commits, **not pushed**)
**Epic:** `awkit-wza` (Randomized Automation Test Lab) · **Tranche 2 = validation**
**Design doc:** [`FLOW_VALIDATION_ENGINE_DESIGN.md`](./FLOW_VALIDATION_ENGINE_DESIGN.md)
**Status:** `INTEGRATION-CANDIDATE — clean offline VM and installer validation pending` — Stages 2a, 2b,
2c implemented and verified, plus a hardening checkpoint (SHA-256 grant binding + packaged validation,
both complete). The clean offline VM walkthrough and NSIS installer validation remain; see §12.

---

## 1. What this session set out to do

Phase 2 of the Test Lab (an earlier session) proved with mutation testing that **9 of 13 controlled
defect classes were rejected by no validator at all** (`awkit-7fm`), and that `PreRunValidator`'s
hardcoded locator-type list had silently drifted so `radio` escaped validation entirely
(`awkit-acw`). Several rules *existed* — but only inside the renderer's advisory `validateFlow`,
which was never the save gate and had no counterpart in `src/`. There was **no reachability check
anywhere** in the product.

This session built the fix in three approved, separately-committed checkpoints:

| Stage | Theme | Risk posture |
|---|---|---|
| **2a** | Pure engine + oracle rewiring | Additive, behavior-neutral |
| **2b** | Wire into run gate, designer, builder, library, import | Real behavior change |
| **2c** | Legacy Compatibility + suggested-fix migration subsystem | Enforcement completion |

Each stage was reported and explicitly approved before the next began.

---

## 2. Cumulative change

```
39 files changed, 5,371 insertions(+), 281 deletions(-)
11 new files
```

| Commit | Stage | Scope |
|---|---|---|
| `491eff0` | 2a | 11 files, +2,107 / −101 |
| `b0b1892` | 2b | 30 files, +1,314 / −295 |
| `bb6a44b` | 2c | 22 files, +2,131 / −66 |

### The validation subsystem, as built

| Module | Lines | Role |
|---|---|---|
| `src/validation/FlowValidator.ts` | 825 | The engine: 20 rules, reachability, active-path classification |
| `src/validation/LegacyCompatibility.ts` | 340 | Grant policy, canonical content form, inventory classification |
| `src/validation/SafeFixApplier.ts` | 161 | The only code that mutates a flow |
| `src/validation/StepRequirements.ts` | 95 | Exhaustive `Record<StepType, …>` requirement table |
| `src/validation/FlowLimits.ts` | 29 | Canonical numeric limits (leaf module, zero imports) |
| `app/main/validation/flowValidationService.ts` | 320 | Grant store, inventory scan, migration ceremony |
| `app/main/ipc/validation.ipc.ts` | 107 | `validation:*` channels |
| `scripts/verify-validation.mts` | 845 | 125 checks |
| `scripts/verify-legacy-compat.mts` | 505 | 90 checks |

---

## 3. Stage 2a — Pure engine (`491eff0`)

### Delivered
- **`FlowValidator.ts`** — a pure, framework-agnostic engine implementing all nine missing rules plus
  reachability (forward BFS from Start, lifted from `verify-random-generator.mts`) and per-issue
  active-path classification. Verdict-free by design: it reports, callers decide.
- **`StepRequirements.ts`** — locator/value requirements as an exhaustive `Record<StepType, …>`, so
  `tsc --noEmit` fails if a step type is added without a decision. The drift that produced
  `awkit-acw` cannot recur in this table.
- **`verify-validation.mts`** — 99 checks, every rule with **positive and negative controls**.
- Oracle rewiring: all 9 `knownGap` expectations flipped to `detected`.

### Output contract (as specified)
```ts
{ code, severity, onActivePath, flowId, nodeId?, edgeId?, message, safeFix? }
```
Deterministic ordering: rule declaration order → nodeId → edgeId → message, independent of input
order. `safeFix` is metadata only — Stage 2a never applies anything.

### Results
- `verify-validation` **99/0** (new)
- `verify-random-oracle` **19/1 → 26/0** — first time green
- Negative control: all 54 generated flows across 9 patterns validated **completely clean**
- `verify:runner` 82/0, build clean — substantiating zero production impact

---

## 4. Stage 2b — Production wiring (`b0b1892`)

### Delivered
- **`PreRunValidator` became a thin adapter** over `validateFlowSet` — no flow rules of its own; the
  drifted hardcoded locator list was **deleted** (`awkit-acw` closed). Issues now carry
  `blocking / code / flowId / nodeId / edgeId / onActivePath`.
- **Run gate** (`execution.ipc.ts`) blocks iff `isRunBlocked(issues)`.
- **Draft model** — designer and builder saves stopped blocking on validation entirely.
- **Designer** — derived chip (`Runnable` / `N findings` / `Draft — not runnable`) opening a clickable
  issue list that navigates to the offending node/connector via structured location.
- **Library** — async `Checking…` → derived verdict, never persisted.
- **Import** — `flows:import` returns `{ profile, validation }`; parseable invalid flows import as drafts.

### Owner decisions implemented
1. **Canonical loop cap 1,000** centralized in `FlowLimits.ts`. `FLOW_BOUNDS.maxLoopIterations` was
   **10,000** — a genuine product divergence where a bound between the two was rejected by the
   designer but silently accepted and differently clamped everywhere else. All four sites now read
   one constant; duplicated literals removed and their absence asserted.
2. **Structured connector findings** — `validateConnectorStructureDetailed` became the single
   implementation; the legacy string form is a byte-identical wrapper, so the runner is untouched and
   the two can never disagree.
3. **`runFlow` generator consistency** — `config.targetFlowId` is now derived from the canonical
   `flowId`, with an invariant test.

### Blocking policy
| Finding | Blocks? |
|---|---|
| Error on the active path | Yes |
| `connectorStructure` error, any path | Yes — documented deviation¹ |
| Reachability unprovable (no single Start) | Yes (conservative) |
| Confirmed off-path error | No (Stage 2b interim posture) |
| Warning | Never |

¹ `FlowExecutor` refuses such flows flow-wide, so letting one through the gate would only convert a
clear pre-run message into an immediate runtime failure.

### Results
- `verify-validation` 99 → **124/0**
- `verify-random-oracle` **27/0** — every rule detected *and* production-enforced
- `verify:flow-designer` 24 → **37/37** real Electron
- `verify:canvas-perf` **13/13** — proving live validation caused no re-render regression

---

## 5. Stage 2c — Legacy Compatibility + migration (`bb6a44b`)

### Delivered
- **`LegacyCompatibility.ts`** (pure) — `effectiveVerdict` is the single Stage 2c decision used by the
  run gate, designer, library and IPC.
- **`SafeFixApplier.ts`** (pure) — the only code in the product that rewrites a flow.
- **`FlowValidationService`** — grant store, inventory scan, migration ceremony. Deliberately
  **electron-free** so the real service is testable via `tsx`.
- **`validation:*` IPC** — 10 channels; every mutating one requires `WORKFLOW_EDIT`.
- **UI** — validate-on-load banner, change-preview dialog, post-migration undo banner, and a distinct
  dashed `Legacy · until YYYY-MM-DD` pill in the library.

### Enforcement model (final)
| Finding | Blocks? |
|---|---|
| Active-path error | **Always** — no grant can override |
| Connector-structure error | **Always**, any path |
| Off-path error, **no** valid grant | **Yes** (full gate — 2b's tolerance was interim) |
| Off-path error, **valid** grant | No — tolerated, reported, announced |
| Warning | Never |

### Grants — explicit, time-limited, content-bound, audited
Bound to a **SHA-256 digest** over `{version, nodes, edges}`. Canonicalization is pure and
deterministic in `src/`; the digest itself is computed at a trusted main-process boundary
(`app/main/validation/contentDigest.ts`), because `src/` may not import `node:crypto`. Renaming a
flow or editing its description **keeps** the grant; changing anything executable voids it instantly,
*even if the app never observed the edit*. 30-day inclusive expiry. Revocation reasons `repaired` /
`migrated` / `digestFormatRetired`. Runs under a grant are counted on it.

> Originally shipped with a 64-bit FNV-1a hash. Corrected in the hardening checkpoint: a grant
> changes execution eligibility, so its content binding must be collision-resistant.

**Never silent:** the gate emits a `legacyCompatibility.*` warning naming the deadline, the library
shows the Legacy pill, and the designer shows a banner.

### Inventory scan
Four-way classification with grants issued **only** to the off-path-only group:

| Class | Meaning | Granted? |
|---|---|---|
| `valid` | No errors | n/a (existing grant revoked as `repaired`) |
| `temporarily-compatible` | Off-path errors only | **Yes** |
| `immediately-blocked` | Active-path / structural errors | Never |
| `possible-validator-defect` | Validator rejects it, but this exact content already ran successfully **after** its last edit | Never — flagged for human review |

Re-scanning never re-issues or extends a deadline. `ensureInventoryScan` fires on the first gate call,
so tightening validation cannot silently break flows that ran yesterday.

### Suggested fixes — described, previewed, reversible
**Only** enum-casing normalization and duplicate **connector** id regeneration, via an exhaustive
field switch rather than a generic path walker (a flexible path writer is exactly how a "safe" fix
ends up touching something the safety analysis never considered).

Ceremony: **preview → explicit confirm → untouched backup → apply → migration report → undo**. Undo
restores byte-for-byte and refuses when the flow was edited after the migration.

Verified to offer **no fix at all** for: missing locator, missing value, orphan node, missing End
node, broken connector endpoint, genuinely unknown operator, invalid timeout, over-cap loop bound,
and duplicate **node** ids — each left byte-identical.

### Results
- `verify-legacy-compat` **90/0** (new)
- `verify-validation` 124 → **125/0**
- `verify:flow-designer` 37 → **56/56** real Electron

---

## 6. Final test totals

| Suite | Result | Δ this session |
|---|---|---|
| `verify-legacy-compat` | **90 / 0** | new |
| `verify-validation` | **125 / 0** | new |
| `verify-random-oracle` | **27 / 0** | 19/1 → 27/0 |
| `verify-random-generator` | 49 / 0 | +1 invariant |
| `verify-random-roundtrip` | 26 / 0 | — |
| `verify:runner` (live browser) | 82 / 0 | — |
| `verify:flow-designer` (real Electron) | **56 / 56** | 24 → 56 |
| `verify:workflow-builder` (real Electron) | 20 / 20 | — |
| `verify:canvas-perf` | 13 / 13 | harness repaired |
| `verify:profile-store` | 16 / 16 | 13 → 16 |
| `verify:instance-monitor` | 43 / 0 | — |
| `verify:authz` | 40 / 0 | — |
| `verify:ipc-contract` | 4 / 4 (198 handlers) | +10 channels |
| `verify:workflow-sentinels` | 4 / 4 | — |
| `npm run build` | clean | — |

**Not run:** `validate:offline` (no packaging change), packaged-EXE walkthrough, clean-machine GUI.

### On test integrity
Five assertions were **retargeted, never weakened** — three in `verify-validation`, two in the GUI
suite — all of which encoded Stage 2b's *declared interim* posture ("off-path never blocks") that
Stage 2c deliberately changed. Each now asserts the stricter behavior **plus** the grant-tolerance
path. No deterministic failure was retried away, hidden, or reclassified as flaky.

---

## 7. Defects discovered

### In the product
1. **Whole-library run gate (pre-existing, fixed 2b).** `validateWorkflow` passed the entire flow
   library to `PreRunValidator` and blocked on any error anywhere — so one unrelated broken draft
   **blocked every workflow run**. Validation is now scoped to the scenario's flows plus the
   transitive `runFlow` closure.
2. **Loop-cap divergence (fixed 2b).** `FLOW_BOUNDS.maxLoopIterations` was 10,000 while the designer
   gate and `LOOP_CONNECTOR_HARD_CAP` were 1,000. Resolved to 1,000, centralized.
3. **Migration backup could be overwritten (fixed 2c).** Migration ids and backup paths were
   `flowId.timestamp`; two migrations in the same millisecond collided and the second would have
   overwritten the first's backup — the one artifact that must never be lost. Surfaced by a frozen
   test clock; ids are now uniquified.
4. **Inverted `safeFix.field` (Stage 2a latent, fixed 2c).** The field path for conditional vs
   loop-condition operators was swapped. Harmless while the metadata was descriptive-only; a silent
   no-op the moment an applier consumed it. *Lesson: treat "descriptive-only" metadata as untested
   until something reads it.* Both directions are now pinned.

### In the Test Lab
5. **`missingRequiredValue` was a no-op on `runFlow` (fixed 2a).** It cleared `value`/`valueSource`/
   `url`, but the runner resolves `step.flowId ?? step.config?.targetFlowId`
   ([`StepExecutor.ts:955`](../../src/runner/StepExecutor.ts)) — so the "mutated" flow stayed valid
   and the oracle scored a pass against a flow that was never broken. A mutation that silently
   injects nothing is the worst failure mode in a mutation suite.
6. **Generator could emit conflicting `runFlow` targets (fixed 2b).** `flowId` and
   `config.targetFlowId` came from two independent picks and could name different flows.
7. **`verify-canvas-perf` was doubly broken (fixed 2b).** It predated both the splash window
   (`firstWindow()` returns the splash, which has no preload API) and the SecurityGate (it drove the
   developer's real, now auth-gated profile). Repaired onto the standard isolated harness.

---

## 8. Key design decisions

- **The engine is verdict-free.** It reports; callers decide. This is what let the same engine serve
  the run gate, designer, library, import and CLI without knowing which caller it is serving.
- **Unprovable ≠ off-path.** With no single Start node, reachability is unknowable, so anchored issues
  are conservatively marked active-path. An unverifiable off-path claim must never excuse a defect.
- **Mirror the runner, not the renderer.** `runFlow` resolves `flowId ?? config.targetFlowId` and never
  reads `value`; validating it the renderer's way would invent defects that don't exist.
- **Wrap, never reimplement.** `validateConnectorStructure` stayed the enforced runtime gate; the
  engine wraps it so the two cannot disagree.
- **Detection ≠ enforcement.** Expectations carry `productionEnforced` so engine coverage can never be
  mistaken for product coverage. `PRODUCTION_UNENFORCED_RULES` is now an empty regression guard.
- **Compile-time drift guards.** Exhaustive `Record<StepType, …>` / `Record<Operator, true>` tables
  make `tsc` fail when a union grows — the mechanism that would have prevented `awkit-acw`.
- **Content hash over stored flag.** A grant keyed to content survives edits made outside the app;
  a "was unchanged" boolean would not.

---

## 9. Remaining work and risks

**Deferred (not implemented, by design):**
- The 30-day compatibility window is a constant, not yet a user setting.
- `possible-validator-defect` flows are surfaced but have no dedicated review UI.
- Dead-end non-End node is a renderer advisory; it is a candidate engine rule.
- Test Lab Phases 4–8 (failure artifacts, shrinking, CLI, live campaigns) remain open under
  `awkit-wza`.

**Residual risk:**
- The full gate (2c) is the first posture where a previously-runnable flow can be blocked by an
  *off-path* error. The inventory scan + grants are precisely the mitigation, and the scan runs
  automatically on the first gate call — but the first real-world library scan is worth watching.
- No packaged-EXE or clean-machine verification was performed this session.

---

## 10. Beads

| Bead | State | Note |
|---|---|---|
| `awkit-lqe` | ✅ closed | Stage 2a |
| `awkit-nmg` | ✅ closed | Stage 2b |
| `awkit-9xb` | ✅ closed | Stage 2c |
| `awkit-7fm` | ✅ closed | 9 undetected defect classes — all now gated |
| `awkit-acw` | ✅ closed | `radio` locator drift — hardcoded list deleted |

---

## 11. Commits (unpushed)

```
bb6a44b  feat(validation): Legacy Compatibility + suggested-fix migration subsystem (Stage 2c)
b0b1892  feat(validation): wire FlowValidator into the run gate, designer, library and import (Stage 2b)
491eff0  feat(validation): pure FlowValidator engine + verifier (Tranche 2 Stage 2a)
```

Each stage is an isolated, independently-verifiable checkpoint. Nothing has been pushed and no PR has
been opened.

---

## 12. Hardening checkpoint (2026-07-22)

Added after Tranche 2 was accepted as integration-candidate. Committed separately.

### SHA-256 grant binding
A grant changes **execution eligibility**, so binding it with a non-cryptographic hash was not
acceptable: a crafted flow could be made to collide with a granted one and inherit its exemption.

- **Canonicalization stays pure.** `canonicalFlowContent(profile)` in `src/validation/` produces the
  deterministic bytes — recursively sorted keys, dropped `undefined`, **preserved array order**
  (node/connector order is meaningful), over `{version, nodes, edges}`.
- **The digest is computed at a trusted boundary.** `app/main/validation/contentDigest.ts` uses
  `node:crypto`; `src/` still imports no Node built-ins. The value is tagged `sha256:<64 hex>` so
  stored records are self-identifying.
- **Fail closed.** `PreRunValidator` takes `digestFor`; without it — or with an untrustworthy digest —
  no grant is honored.

### Pre-hardening (FNV-era) records
Retired, never migrated or replaced:

| Behavior | Result |
|---|---|
| Honored? | Never — standing `legacyDigest`, distinct from `edited` |
| Migrated to a new digest? | No |
| Replaced by a new grant? | **No** — an old format alone never creates a grant |
| Deadline extended? | No — the original window is preserved in the audit record |
| Revivable by re-scanning? | No |
| Deleted? | No — revoked as `digestFormatRetired`, kept for audit |

### Scan hardening
Single-flight `runInventoryScan` (10 concurrent callers → 1 scan, 1 grant set); serialized grant
writes (20 parallel audit writes → 20 recorded); the scan record is written **last**, so a storage
failure leaves no record, issues no grants, and retries on the next call; the run gate applies the
**strict** gate when the scan or store fails.

### Packaged validation
Fresh package: `dist/SpecterStudio 0.1.0.exe`, 2026-07-22T00:32:12+03:00, 325,296,994 bytes
(310.2 MiB), sha256 `129833754870f5fa2663efa48b979aaecaf1532831f20805a5b3f6537264c1fb`.

`scripts/verify-packaged-validation.mts` — **87/0** on a clean profile and an upgrade profile
(60+4 flows, FNV-era grant, old migration record, prior successful run history): all ten
`validation:*` channels **and their authorization matrix** (3 mutating channels reject an
unauthenticated sender; 7 reads are ungated), grant creation / persistence-across-restart /
invalidation / expiry, the full migration ceremony including undo after restart and undo refusal
after a later edit, draft save, run blocking vs permitted legacy execution, every library state,
offline posture, and clean-shutdown on-disk integrity.

First inventory scan of 64 flows: **334 ms**, worst renderer round-trip during it **9 ms**.

### Defects found
1. **Pre-existing:** `verify:packaged-runtime` used `firstWindow()`, which lands on the splash window
   (no preload API) — 10 packaged runtime assertions had been failing. Fixed: **12/10 → 25/0**.
2. Two harness bugs in the new packaged suite (asserting `legacyDigest` after retirement had already
   made it `revoked`; picking an edited flow for the expiry test, where `edited` correctly outranks
   `expired`). Both fixed; `legacyDigest` is now additionally asserted *before* the scan retires it.

### Status
`INTEGRATION-CANDIDATE — clean offline VM and installer validation pending`. The two items the previous
status named (SHA-256 grant binding, packaged validation) are **complete**. The status now names what
actually remains: the clean **offline VM walkthrough** and **NSIS installer** validation. Green source /
Electron-dev / packaged-on-dev-machine suites are not sufficient evidence for a production-ready claim.
