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

## PR #36 review round 1 — four blockers, all fixed on this branch

The owner's code review found four correctness/security blockers in the first implementation. All
were reproduced against the code before being fixed; none was a false positive.

| # | Finding | Resolution |
|---|---|---|
| 1 | **Internal-page pending-identity race.** `markInternal` did not cancel the finalization scheduled when the page was observed as `about:blank`, and the callback never re-checked internal status — so a branch page could still be assigned a popup alias when it later navigated. The old verifier missed it by navigating *before* observing/marking (the reverse of production order). | `markInternal` now cancels the pending task, and the callback re-checks `internalPages`. Tested in the exact production order, and — because `reconcile`'s eligibility filter would otherwise hide a missing cancellation — the **mechanism** is asserted directly via `pendingIdentityCount()`. |
| 2 | **More than one identity owner.** Each `StepExecutor` built its own registry and each `runFlowWithChildren` call installed another `"page"` observer. Since that method is recursive, a child-flow popup was observed by both the parent's and the child's registry; branch executors had their own registry with no observer at all. | The registry and observer moved to the `BrowserHolder` — **one per BrowserContext / runtime generation** — and are injected into parent, child, and branch executors. Restart rebinds via `resetForNewContext`. A source guard asserts exactly one observer installation and none inside `runFlowWithChildren`. |
| 3 | **Ambiguity latched permanently.** Independent counters meant that once two identical popups contested an identity, closing/claiming/releasing one never reconciled the count — `tryResolve` kept reporting "2 live popups" with only one left. | Replaced counters with an **identity-bucket model** reconciled on every membership change. Six lifecycle transitions are now covered by tests. |
| 4 | **Aliases could expose sensitive opener text.** The alias embedded `safePathComponent(openerAlias, …)`, which is filesystem-safe but not secret-safe, so an opener named `token-…` was readable in every child alias. Several `PopupIdentityError` messages also interpolated raw aliases unmasked. | The alias is now a **fixed neutral prefix + hash** that never echoes its inputs; the opener is excluded from identity entirely (also removing a timing dependence). All identity diagnostics run through `SecretMasker`, tested with hostile aliases. |

A fifth issue was found by the new tests rather than the review: `observe()` was **not idempotent**,
so observing an already-pending page scheduled a second finalization and leaked a duplicate listener
pair and timer. It now returns early for a page whose finalization is already scheduled.

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
- **Ownership is browser-context-wide, not per-`StepExecutor`** (PR #36 review finding 2). Exactly
  one registry and one `"page"` observer exist per BrowserContext / runtime generation, owned by the
  runner's `BrowserHolder` and injected into the parent flow, every nested child flow, and every
  isolated parallel-branch executor. This matters because `runFlowWithChildren` is **recursive**:
  a registry (and observer) per invocation meant a popup opened during a `Run Another Flow` was
  observed by both the parent's and the child's registry — two identity owners for one `Page`. A
  browser restart calls `resetForNewContext` and rebinds the observer, preserving the registry
  *instance* so executors already holding a reference never end up owning a dead registry.
- **Runner-owned pages are excluded from popup identity** — an isolated parallel-branch page shares
  the context and raises the same `"page"` event. Production ordering is `observe(about:blank)` →
  `newPage()` resolves → `markInternal` → navigate, so `markInternal` **cancels** the scheduled
  identity finalization and the finalization callback re-checks internal status before assigning
  (PR #36 review finding 1).
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

## Deterministic synthetic alias — algorithm and documented deviations

Unrecorded popups (script-, timer-, redirect-opened) receive:

```text
popup-<sha256(origin + normalized pathname) first 12 hex>
```

**Identity material (stable, non-secret):** the popup's target **origin** and its **normalized
pathname**, joined with `\n` and hashed with `sha256` (the repo's established
`createHash("sha256")…slice` convention).

**The output is a fixed neutral prefix plus a hash, and never echoes its inputs.** An earlier
revision of this branch embedded the opener's alias as readable text
(`popup-<safe-opener>-<hash>`). That was wrong: a recorded alias is caller-controlled, so an opener
named `token-…`, `password-…`, or `session-customer-123` would have been visible in every child
popup's alias. `safePathComponent` makes text filesystem-safe, **not secret-safe**. The fix is
structural — only the hash may depend on identity material (PR #36 review finding 4).

**Never included:** query strings, URL fragments, credentials, tokens, cookies, session values, or
raw flow content. This is enforced by construction — only `URL.origin` and `URL.pathname` are read,
so a token in `?token=…` or `#…` is structurally unable to reach an alias or a diagnostic. Verifiers
assert this against a secret-shaped query parameter **and** against hostile opener/recorded aliases
(`token=…`, `password=…`, a Bearer token, a registered literal secret, and traversal text).

**Three deliberate deviations from the SRS's suggested material.** C1.3 suggests *"opener step id +
target URL origin"*. All three of the following are excluded because each is **timing-dependent**,
and folding any of them in would reintroduce exactly the run-to-run instability C1.5 forbids:

- **opener step id** — for a timer-opened popup, whichever step happens to be executing when the
  timer fires;
- **`window.name`** — only readable through an async `evaluate`, so identity would depend on a race;
- **opener alias** — the only synchronously available opener signal is "whichever executor is
  currently active", which varies with child-flow nesting.

A popup that *is* causally tied to a step carries a recorded `popupExpectation.popupAlias`, which
wins outright (C1.2), so none of these would change its identity anyway.

**Ambiguity is a statement about the CURRENT live set, not a latched counter.** Every observed page
is filed into an identity **bucket**; a bucket grants its public alias only while exactly **one**
eligible page occupies it (eligible = live, not runner-internal, not holding a recorded alias).
Every membership change — close, release, claim-to-recorded-alias, mark-internal — re-reconciles the
bucket. So two identical popups are reported ambiguous with a secret-masked diagnostic, and the
moment one of them closes, is claimed, or becomes internal, the survivor takes the alias
automatically (PR #36 review finding 3).

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
- **Aliases never echo caller-controlled text.** A synthetic alias is `popup-<hash>` only. This is
  the structural half of the fix; masking alone was insufficient because `SecretMasker.maskText`
  normalizes `token=…`, `password=…`, `Bearer …`, and registered literal secrets — but an opener
  alias like `token-MY_SECRET` (hyphen, not `=`) would have passed straight through it.
- **Every popup-identity diagnostic is secret-masked** at construction (reserved-alias,
  duplicate-claim, and ambiguity errors inside the registry; the missing-popup resolver message in
  `StepExecutor`). A recorded alias is flow content and can carry a token or a registered secret.
  The resolver message's SHAPE is deliberately unchanged — the SRS calls it user-facing and requires
  stability — so masking replaces only the secret values.
- **Highest-value inherited regression check:** `resolveStepPage`'s throw message and
  `captureFailureEvidence`'s `resolveDiagnostic` both depend on the registry's shape and are masked
  via `evidenceMasker.maskText` (PR #35 round 3). The registry rewrite must not weaken that masking —
  covered by re-running `verify:failure-evidence` and `verify:failure-evidence-live`.
- Remaining risk is correctness, not secret exposure: a misresolved alias means an action on the
  wrong page — which is why C1.4's invariant is asserted mechanically rather than documented.
