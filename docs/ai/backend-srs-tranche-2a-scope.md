# Backend SRS — Tranche 2A scope (FR-C1, Deterministic page identity)

**Date:** 2026-07-24 · **Branch:** `feature/backend-srs-tranche-2a-popup-identity` ·
**Base:** `origin/main` `5dbe25f`

**Authoritative SRS:** `SRS-BAO-001` — *Browser-Automation Observability, Evidence, and Safety
Boundary*, §3.3 (WS-C). The document lives on the planning branch `docs/browser-automation-srs`
(read at `32ed8c4`; FR-C1 text unchanged since `37dc67c`). This tranche does **not** modify that
planning branch. It records implementation status here and reproduces the acceptance criteria below.

**Tranche split.** Owner decision (2026-07-24): WS-C is split because FR-C2 cannot be satisfied by
adding regression tests around the existing selector-only behavior — C2.1 requires frame identity to
survive a *non-functional selector change*, which needs a new optional identity schema and a fallback
resolver.

- **Tranche 2A (this branch):** FR-C1 popup/page identity + the `awkit-4t9` designer round-trip
  prerequisite.
- **Tranche 2B (not started):** FR-C2 frame identity.

## Requirement traceability matrix (verified against code on `5dbe25f`, not trackers)

| AC | Requirement | Verified state before this tranche | Decision |
|---|---|---|---|
| **C1.1** | One registration mechanism owns the page registry; not two independent call sites. | **Defect.** `PlaywrightRunner.ts:486-494` (context `"page"` handler, positional `popup-${runnerPopupCounter}`) and `StepExecutor.ts:1435` (click w/ `opensPopup`) and `StepExecutor.ts:1460` (`switchToPopup`) all call `registerPopupPage` independently. | **IN SCOPE** |
| **C1.2** | Recorded `popupExpectation.popupAlias` registered under **that alias only** — never additionally under a counter key. | **Defect.** The click path does apply the recorded alias, but the context handler also registers the same `Page` under `popup-N`. Nothing reconciles the double write. | **IN SCOPE** |
| **C1.3** | Script/timer/redirect-opened popup gets **one** deterministic synthetic alias from identity-bearing attributes, not arrival order. | **Absent.** Only the positional counter exists. | **IN SCOPE** |
| **C1.4** | Invariant: one `Page` is never reachable under more than one alias; a verifier asserts registry values are distinct. | **Absent.** `pageRegistry` is a plain `Map<string, Page>` with no reverse index; `verify:popup` *replicates* dual registration as if expected (`scripts/verify-popup.mts:187-190, 237-240`). | **IN SCOPE** |
| **C1.5** | Two popups opening in reversed order across runs resolve to the same aliases in both runs. | **Fails by construction** (positional counter); untested — no mock-site scenario. | **IN SCOPE** |
| **C1.6** | A closed-and-reopened popup does not silently inherit the previous page's alias. | **Partially correct.** `registerPopupPage` already deletes on `close`, but interacts with dual registration (two keys per lifecycle) and there is no reverse-map cleanup. | **IN SCOPE** (re-verified post-fix) |
| **C1.7** | Legacy recorded aliases (`popup-1`, `popup-2`, …) continue to resolve unchanged. | **No structural risk** — `PageAlias`'s `string` arm already admits both shapes. Untested. | **IN SCOPE** (regression coverage) |
| C1.8 | Every timeline event carries `pageId`. | Depends on FR-A2 (execution timeline), Tranche 5, gated on SRS §10 open question A-1. | **EXCLUDED** — dependency does not exist |

## Included

- FR-C1.1 – C1.7 as above; defect **`awkit-ebh`**.
- **A single popup-registration owner** — `src/runner/runtime/PopupIdentityRegistry.ts`, owning both
  `alias → Page` and `Page → alias`, with the context-level `page` event as the single observation
  point. `StepExecutor`'s click / `switchToPopup` paths *correlate and claim*; they never write a
  second independent registry entry.
- **Recorded alias precedence** — observe-first-then-atomically-promote (the second design option in
  the authorization): the context handler observes every new `Page` under a provisional identity, and
  the step that awaited the same `Page` object promotes it to the recorded alias, removing the
  provisional key in the same operation.
- **Deterministic synthetic popup identity** for unrecorded popups (see algorithm + deviation below).
- **One-live-`Page` → one-alias invariant**, asserted by a verifier.
- **Order-independent popup resolution** (C1.5) and **close/reopen lifecycle** (C1.6).
- **Legacy `popup-1` / `popup-2` compatibility** (C1.7), with regression tests.
- **The missing popup-metadata designer round trip** in
  `app/renderer/components/workflow/flowStepMapping.ts` — `pageAlias`, `opensPopup`,
  `popupExpectation` (the `awkit-4t9` prerequisite; see below).
- **Mock-site scenarios added before the production fix**, per SRS rule C-9.
- **Regression protection for FR-B2 evidence diagnostics** (PR #35): every resolver-failure note must
  remain `SecretMasker`-masked after the registry rewrite.

## Excluded

- **FR-C1.8** timeline-wide `pageId` — needs FR-A2 (Tranche 5).
- **FR-C2 frame identity** — Tranche 2B. No frame-identity schema, resolver, or claim of completion
  appears in this branch.
- **Cross-origin frame identity** — needs CDP (Tranche 5); `recorderInitScript.ts:613-629` silently
  drops frame context when `window.frameElement` throws.
- **FR-C3** stale-reference invalidation — SRS defers it until FR-A1 lifecycle events exist (Tranche 7).
- **CDP work** of any kind.
- **Runtime-store migrations** — none required (see below).
- **`.beads` reconciliation** — no `.beads/*` change, no `bd` command.
- **Release packaging or promotion.**

## Deterministic synthetic alias — algorithm and one documented deviation

Unrecorded popups (script-, timer-, redirect-opened) receive:

```text
popup-<safe-opener-alias>-<sha256(identity material) first 8 hex>
```

**Identity material (stable, non-secret):** the opener page's alias, the popup's target **origin**,
and its **normalized pathname**. Joined with `\n`, hashed with `sha256` (the repo's established
`createHash("sha256")…slice` convention), truncated to 8 hex characters. The opener alias is reduced
with the existing `safePathComponent` utility.

**Never included:** query strings, URL fragments, credentials, tokens, cookies, session values, or
raw flow content. This is enforced by construction — only `URL.origin` and `URL.pathname` are read,
so a token in `?token=…` or `#…` is structurally unable to reach an alias or a diagnostic. A verifier
asserts this against a popup URL carrying a secret-shaped query parameter.

**Deviation from the SRS's suggested material — deliberate, not an oversight.** C1.3 suggests
*"opener step id + target URL origin"*. The **opener step id is deliberately excluded** for
script/timer-opened popups: the step that happens to be executing when a timer fires is
*timing-dependent*, so folding it into the identity would reintroduce exactly the run-to-run
instability C1.5 forbids. For popups that *are* causally tied to a step, that step carries a recorded
`popupExpectation.popupAlias`, which wins outright (C1.2) — so the step id would change nothing there
either. `window.name` is excluded for the same reason: it is only readable through an async
`evaluate`, so including it would make identity depend on whether that read won a race.

**Ambiguity.** When two live popups are genuinely indistinguishable from the available stable
identity (same opener, origin, and pathname), the second does **not** receive a public alias and the
contested alias is marked ambiguous. Resolving it fails with an explicit, secret-masked ambiguity
diagnostic rather than silently targeting the wrong page. A recorded claim on that `Page` still
resolves the ambiguity by promoting it to its recorded alias.

## The `awkit-4t9` prerequisite (recorded, Beads untouched)

Bead **`awkit-4t9`** ("recorder popup/window metadata discarded on designer re-save") is marked
`status: closed` with `close_reason: "Fixed in ab9f5f6 (Test Lab Tranche 1)…"`. **`ab9f5f6` is not an
ancestor of `main`** — it exists only on the unmerged `feature/randomized-test-lab` branch.

Verified on `5dbe25f`: `flowStepMapping.ts` builds `FlowStep` field-by-field with **no** `pageAlias`,
`opensPopup`, or `popupExpectation`, and `scripts/verify-flow-step-mapping.mts` has **zero**
assertions for them. Practical effect: opening and re-saving a recorded multi-window flow in the Flow
Designer **silently discards its popup metadata** — which would strip the recorded alias that C1.2
depends on. It is therefore a prerequisite for FR-C1 having real-world value, and is fixed here.

**The Beads record is not altered** (hard boundary: no `.beads` change, no `bd` command). Its closed
status is recorded here as inaccurate against `main`; reconciling the tracker is left to the owner.

## Migration impact

**None.** `PageAlias`'s `string` arm already admits the new synthetic shape, and every
`PopupExpectation` field is optional — so no saved-flow schema change and no
`RUNTIME_STORE_MIGRATIONS` bump (SRS constraint C-8 satisfied). The designer round-trip fix adds no
new persisted field; it stops *dropping* fields that the schema already defines.

## Security notes

- Popup identity touches routing, not secret handling: no new IPC channel, no new secret path.
- Query strings and fragments are structurally excluded from aliases and diagnostics (above).
- **Highest-value inherited regression check:** `resolveStepPage`'s throw message and
  `captureFailureEvidence`'s `resolveDiagnostic` both depend on the registry's shape and are masked
  via `evidenceMasker.maskText` (PR #35 round 3). The registry rewrite must not weaken that masking —
  covered by re-running `verify:failure-evidence` and `verify:failure-evidence-live`.
- Remaining risk is correctness, not secret exposure: a misresolved alias means an action on the
  wrong page — which is why C1.4's invariant is asserted mechanically rather than documented.
