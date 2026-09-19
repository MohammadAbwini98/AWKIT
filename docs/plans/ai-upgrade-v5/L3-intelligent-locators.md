# L3 — Intelligent Locators (semantic upgrade, replay proof, auto-promotion, repair)

Shared rules, architecture and decisions: `ROADMAP.md`. Depends on L1 go/no-go PASS and L2.
**Source of truth for locator AI.**

## Goal

Automatically turn runnable-but-fragile locators into proven semantic locators, and repair failing saved locators,
without ever executing an unproven candidate or changing what a step means.

## 1. Trigger

A job is queued when a finalized locator's L2 class is `guarded-positional` or below `acceptable-semantic`, when a
saved locator fails at runtime and deterministic recovery finds no strong replacement, when the user asks from Element
Spy, or by the idle **flow health sweep**. Never for strong semantic locators. The current locator stays authoritative.

## 2. Locator plan DSL → trusted compiler

Model returns a versioned plan (no code) mapped onto existing `LocatorCandidate` + `LocatorContext.containers`:
strategies role/label/placeholder/text/test-id/approved stable id-css; XPath only under explicit policy; container
kinds dialog/tableRow/card/listItem/landmark/form/section; captured frame/shadow context only;
`MAX_LOCATOR_CONTAINER_CHAIN` respected. Reject scripts, unknown operations, invented frame access, unguarded positional.
One compiler is the only path from model output to a candidate.

## 3. Intent guard (before any proof)

Using L2 bound-value markers: reject or parameterize any scope/target text equal to a bound data value, `valueSource`
value, data-source column value, or earlier-step value. A scope-kind change (position → text) sets `meaningChange`,
which blocks auto-apply (T2 → T1).

## 4. Proof gates (deterministic)

A buildable · B unique under recorder policy · C resolves to the **same element** as the identity-proven guarded
baseline (and matches `ElementIdentityContract`/fingerprint) · D no protected-login/sensitive/guard policy weakened.

## 5. Capture-time vs replay-time

- Target still present and compatible: run A–D now → `capture-proven`.
- Target removed/re-rendered/navigated/frame changed: **`UNPROVABLE_NOW`** (not a rejection, no attempt consumed) →
  store in `locator.pendingUpgrade` (never `alternatives`; `LocatorFactory` never reads it; never enters
  remembered-winner memory).
- Replay: after the guarded baseline resolves and passes its own guard, compile the pending candidate and run A–D
  against the same element; record the result in `LocatorRecoveryStore` runtime memory. No model call, no profile write.
  If the baseline fails its guard, no proof is recorded.

## 6. Promotion (autonomy policy)

T2 auto-promotion requires all: capture-proven or replay-proven on ≥ N replays across ≥ 2 distinct data rows/contexts
(N committed after baseline); no `meaningChange`; step not sensitive; feature tier T2. Otherwise → T1 suggestion.
Promotion is a **single-writer job** through the profile save path (`ProfileLockManager`, version check, skipped while
the flow has unsaved editor changes), sets semantic primary, keeps guarded locator as fallback, writes
`locatorProvenance` + `AiActionRecord`, one-click revert.

## 7. Attempts

Max 2 synthesis attempts per job, consumed only by real rejections (malformed, unsupported, non-unique, wrong identity,
safety, intent). Structured deterministic feedback between attempts; no page dumps; no loops.

## 8. Runtime repair (T1)

Saved locator fails → existing deterministic recovery → if weak, same DSL/compiler/guard/proof against saved
identity/blueprint → before/after evidence → user approval → save/undo path → revalidate.

## 9. Flow health sweep

Idle-only, yields immediately to runs: scan saved flows for weak locators, queue upgrade jobs (capped per sweep),
surface a durability report. Proposals still go through §3–§6.

## 10. UX

Badges: Semantic · Guarded · AI suggestion pending proof · AI semantic (capture-/replay-proven) · Suggestion rejected ·
Auto-promoted (revert). Evidence on demand: original quality reason, proposed scope, proof location, match count,
identity result, retained fallback, provenance. No raw prompts or reasoning.

## Labelled quality set

Repeated row/card/dialog; generated ids/classes; section/heading scope; nested frame; shadow; identical twins
(impossible); row removed by click; dialog closes; navigation; re-render; capture-proof; replay-proof; replay-proof
failure; **data-bound row text (must not promote)**; position→text meaning change; protected-login; runtime repair.
Metrics: upgrade rate, capture/replay proof rates, rejection reasons, latency, auto-promotion revert rate,
**false-target promotion = 0**.

## Verifiers

New `verify:ai-locator-upgrade` (fake provider; must include: pending present + primary misses ⇒ pending never tried;
data-bound scope rejected; concurrent replays ⇒ one promotion write; unsaved editor ⇒ promotion deferred),
`verify:ai-locator-repair`, live `verify:ai-locator-quality-live`. Existing: recorder/locator suites from L2,
`verify:blueprint-recovery-browser`, `verify:profile-store`, `verify:runner`, `verify:mock-site`, `npm run build`.

## Acceptance

Guarded baseline always runnable; pending candidates never execute; promotion only after proof + intent guard +
policy; single-writer, audited, revertible; impossible cases stay honestly guarded; AI absence changes nothing.
