# Locator Blueprint Recovery — Revised Plan

Reviewed against the AWKIT codebase at commit `df1eb145` and the current `main` branch
(latest pushed `5996ed5`). Changes from the original proposal are marked with **⚠ REVISED**.

---

## Assessment — Confirmed Accurate (Minor Corrections)

The plan's assessment of the recorder's existing capabilities is **largely accurate**. Confirmed in source:

- Ranked locator candidates with live DOM uniqueness validation — [recorderInitScript.ts](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/src/recorder/recorderInitScript.ts) `buildCandidates()` (line 668)
- Structural `:nth-child(…)` paths as fragile last resort — `structuralSelector()` (line 343)
- Accessible names and text — `accessibleName()` (line 215)
- Element fingerprints with tag, role, name, text, selected attributes, and 3-level ancestry — `computeFingerprint()` (line 546)
- Hashed fingerprints before persistence — [locatorFingerprint.ts](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/src/runner/locatorFingerprint.ts) `hashFingerprint()` (line 93)
- Identity guards on sensitive positional locators — [LocatorFactory.ts](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/src/runner/LocatorFactory.ts) `resolveGuardedPositional()` (line 267)
- Ambiguity review and user-approved fallbacks — `RecordedActionLocator.resolution` in [RecorderTypes.ts](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/src/recorder/RecorderTypes.ts)
- Nested container chains (max 3) — [FlowProfile.ts](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/src/profiles/FlowProfile.ts) `MAX_LOCATOR_CONTAINER_CHAIN` (line 156)
- Frame chains (cross-origin, nested) — `LocatorContext.frameChain` (line 145), `resolveFrameChain()` in LocatorFactory
- Open and closed shadow root chains — `LocatorShadowContext` (line 124), instrumented closed-shadow bridge

> [!IMPORTANT]
> **⚠ REVISED:** The plan says "Produces element fingerprints containing tag, role, name, text, selected attributes, and nearby ancestry." The existing fingerprint captures **exactly 3 ancestor levels** (not "nearby" — it's bounded), and each ancestor record includes tag, role, id, and data-testid. The `fingerprintsEqual()` function at line 120 of locatorFingerprint.ts **intentionally excludes ancestry** from exact comparison, so the plan's `ElementBlueprint.parentChain` must be aware of this design decision.

---

## Critical Codebase Finding: Existing Locator Recovery System

> [!WARNING]
> **⚠ REVISED — Major:** The proposed plan appears unaware that AWKIT **already has** a working
> per-step locator recovery system at the LocatorFactory level. This materially changes the scope
> and integration strategy.

### What already exists

| Component | Location | Function |
|---|---|---|
| `LocatorRecoveryStore` interface | [LocatorRecoveryStore.ts](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/src/runner/LocatorRecoveryStore.ts) | get/put/list recovery records |
| `FileLocatorRecoveryStore` | Same file, line 35 | Durable per-step JSON files under `locator-recovery/` |
| `LocatorRecoveryRecord` | Same file, line 10 | `{version, scopeKey, candidatesDigest, winningCandidateSignature, fingerprint, source, updatedAt}` |
| `LocatorFactory.recoverLocally()` | [LocatorFactory.ts](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/src/runner/LocatorFactory.ts) line 414 | Scan visible elements, score by fingerprint similarity, threshold + margin |
| `LocatorFactory.rememberWinner()` | Same file, line 385 | Save fingerprint on each successful resolution |
| Memory read/write/emit | Same file, lines 437–459 | Grace period, preferred-candidate reordering, recovery events |
| `RunCompletionObserver` | [RunCompletionObserver.ts](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/src/runner/RunCompletionObserver.ts) | Index which scope keys each run wrote |
| Engine wiring | [ExecutionEngine.ts](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/src/runner/ExecutionEngine.ts) line 1494 | `locatorRecoveryRoot: join(dirs.root, "locator-recovery")` |

### How the existing system works

1. **On successful resolution** of any step → fingerprint the winning element → `rememberWinner()` saves `{scopeKey, candidatesDigest, winningCandidateSignature, fingerprint}`.
2. **On next run, same step** → `readMemory()` → if digest matches, prefer the last-winning candidate first (`preferRemembered()`).
3. **If ALL candidates miss** and a prior fingerprint exists → grace wait → `recoverLocally()`: scan up to 200 visible `*:visible` elements, compute `similarity()` against the stored fingerprint, require score ≥ 0.86 and margin ≥ 0.08 over the runner-up.
4. Already stores under `%LOCALAPPDATA%/SpecterStudio/<runtime>/locator-recovery/`.
5. Atomic temp-file + rename writes.

### Existing similarity weights (locatorFingerprint.ts line 148–155)

```
tag match:          12%
role match:         18%
name similarity:    32%
text similarity:    18%
attribute match:    10%
ancestry match:     10%
```

### Consequence for the plan

The plan's "runtime resolution order" steps 5–10 and the scoring model describe a system that
**already exists in a slightly different form**. The proposed blueprint recovery is therefore
**not step 5 of a new pipeline** but an **enhancement to the existing `recoverLocally()` path**.
The plan should be restructured accordingly.

---

## Revised Runtime Resolution Order

**⚠ REVISED** to reflect the actual code path in `LocatorFactory.resolve()`:

1. Check for guarded-positional (sensitive steps) → `resolveGuardedPositional()`
2. Check for instrumented closed shadow → `resolveClosedShadow()`
3. Build scoped root (frame chain → shadow hosts → container chain)
4. Try primary locator, then ranked alternatives (with memory-preferred reordering)
5. If a candidate wins → fingerprint and remember it → return
6. If all candidates miss AND a prior fingerprint exists:
   a. Grace wait (configurable, default 500ms, max 2s)
   b. Retry all candidates
   c. If still all miss → **`recoverLocally()`** (existing) with the stored fingerprint
7. **⚠ NEW — Blueprint-enhanced recovery** (this plan's contribution):
   a. If `recoverLocally()` found no confident match AND a page blueprint exists for the current page:
   b. Load the blueprint and find the element entry matching the step's `blueprintId`
   c. Generate candidates near the stored `documentOrder` and structural position
   d. Score each candidate against the stored blueprint fingerprint (using the **existing** `similarity()` function — do not create a second scoring model)
   e. Require the same threshold (0.86) and margin (0.08) as the existing `recoverLocally()`
   f. For sensitive actions, refuse recovery entirely (the guarded-positional path in step 1 already handles those)
   g. Otherwise stop with `needs-review`; never silently select the closest candidate
8. If nothing is present yet → return primary for auto-wait (existing legacy path)
9. If ambiguous → throw diagnostic (existing)

> [!IMPORTANT]
> **⚠ REVISED — Scoring Model:** The plan proposes an independent scoring model with different weights (30% name, 25% attribute, 15% role+tag, 10% text, 10% ancestry, 5% position, 5% visual). **Do not create a second scoring model.** Use the existing `similarity()` function (which is already verified by `verify:fingerprint-parity` and mutation-tested). If positional evidence from the blueprint should be a tiebreaker, add a small additive bonus (e.g., +0.03 for same document-order region) rather than diverging the scorer.

---

## Revised `ElementBlueprint` Interface

**⚠ REVISED** to align with existing types and avoid redundancy:

```ts
interface PageBlueprint {
  schemaVersion: 1;
  pageKey: string;           // normalized page identity hash
  canonicalUrl: string;      // origin + pathname only (matches existing URL masking)
  frameKey?: string;         // frame identity for iframe targets
  capturedAtUtc: string;
  documentFingerprint: string; // structural hash for page-variant detection
  elements: ElementBlueprint[];
}

interface ElementBlueprint {
  blueprintId: string;

  // Positional evidence
  documentOrder: number;
  siblingIndex: number;
  sameTagIndex: number;

  // Structural evidence
  tag: string;
  role?: string;
  // ⚠ REVISED: Use the SAME 3-level ancestry format as LocatorElementFingerprint.ancestry
  // (tag|role|id|testid strings), not a separate BlueprintAncestor type. This keeps
  // fingerprint comparison possible through the existing similarity() function.
  ancestry: string[];        // reuse LocatorElementFingerprint.ancestry format
  frameChainDigest?: string; // hash of the frame chain for frame-scoped targets
  shadowChainDigest?: string; // hash of the shadow chain for shadow-scoped targets

  // Identity evidence — hashed the same way as LocatorElementFingerprint
  // ⚠ REVISED: Reuse the exact LocatorElementFingerprint shape so similarity() works directly
  fingerprint: LocatorElementFingerprint; // already hashed per hashFingerprint()

  // Existing locator evidence
  primaryLocatorDigest: string; // hash of the primary locator (not the locator itself)
  alternativeCount: number;     // how many alternatives existed at capture time

  // Capture state
  visible: boolean;
  enabled?: boolean;
  boundingRegion?: {
    relativeX: number;
    relativeY: number;
    relativeWidth: number;
    relativeHeight: number;
  };
}
```

> [!WARNING]
> **⚠ REVISED — Removed fields:**
> - `accessibleNameHash`, `innerTextHash`, `labelHash`, `attributeHashes` — **redundant** with the existing `LocatorElementFingerprint` which already contains all of these in hashed form via `hashFingerprint()`.
> - `primaryLocator` and `alternatives: LocatorCandidate[]` — **must not** duplicate the actual locator candidates from the flow step JSON. Store only a digest for matching. The actual locators live in the `FlowStep.locator` and `FlowStep.locator.alternatives`.
> - `structuralPath` — already derivable from `documentOrder` + `siblingIndex`, and storing CSS selectors in the blueprint creates a second locator system (which the plan's own text warns against).
> - `editable` — not present in the existing fingerprint; not needed for recovery matching.
> - `frameChain` / `shadowChain` as full objects — store only digests; the actual chain context is on the `StepLocator.context`.

---

## Revised URL/Page Identity

The `pageKey` normalization approach is sound, but **⚠ REVISED** for consistency:

- AWKIT already masks URLs to origin + pathname in the recorder (see `RecorderService` popup URL masking: "all persisted URLs are now origin+pathname only, structurally dropping query and fragment" — CURRENT_STATE.md line 237).
- The `pageKey` hash should use the same masking approach for consistency.
- The "selected non-sensitive query keys" concept is **over-engineered for the first version**. Start with origin + pathname + page title category + frame identity. Add query key selection only if the simpler identity proves insufficient in practice.

Recommended **first-version** `pageKey`:
```text
SHA-256(
  normalized origin
  + normalized pathname
  + page title (first 3 words, lowercased — enough to distinguish "Orders" from "Customers")
  + frame chain digest (empty string for main frame)
)
```

The replacement behavior described in the plan is sound:
- Same `pageKey` + frame → atomic replace
- Successful new recording → update
- Runtime navigation alone → never overwrite
- Failed/partial capture → preserve previous

---

## Revised Storage

**⚠ REVISED** to use the existing runtime data layout:

```text
%LOCALAPPDATA%\SpecterStudio\<runtime-root>\locator-blueprints\
  <page-key>.json
```

This follows the same pattern as the existing `locator-recovery/` folder (line 1494 of ExecutionEngine.ts: `join(dirs.root, "locator-recovery")`). Blueprints live as a sibling folder under the same runtime root.

> [!IMPORTANT]
> The plan correctly identifies that blueprints must NOT go in `resources/`, `app.asar`, the install directory, or workflow source folders. Confirmed this is consistent with [RULES.md](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/docs/ai/RULES.md) line 17: "Never write mutable data into `resources/`, `app.asar`, or the install directory."

Persistence properties — confirmed aligned with codebase patterns:
- Atomic temp-file + rename — **already used by `FileLocatorRecoveryStore.put()`** (line 58)
- Versioned schema (`schemaVersion: 1`)
- Maximum element count per blueprint (recommend cap at 2000)
- Maximum file size (recommend 512KB)
- LRU or age-based cleanup — new, but reasonable
- Per-file integrity hash — confirm whether needed given temp+rename atomicity
- Backward-compatible migration — standard AWKIT policy (RULES.md line 41)

---

## Revised Integration Points

### 1. `src/recorder/recorderInitScript.ts` — Blueprint Capture

**⚠ REVISED:** The plan says "Assign bounded document-order numbers." This must be done
**carefully** because `recorderInitScript.ts` is Playwright-serialized (`Function.prototype.toString()`)
and runs in the browser page context. It MUST remain self-contained.

What to add inside `installRecorderCapture()`:
- A `captureBlueprint()` function that, on each action, also collects the target element's:
  - `documentOrder` (bounded TreeWalker walk, capped at 5000 elements)
  - `siblingIndex` (reuse existing `:nth-child` logic from `structuralSelector`)
  - `sameTagIndex` (count same-tag preceding siblings)
  - `boundingRegion` (relative to viewport, from `getBoundingClientRect()`)
  - The fingerprint (reuse existing `computeFingerprint()` — **it's already in this file** at line 546)
- Report the blueprint data alongside the existing action payload via the `__awtkit_recordAction` binding

What NOT to add:
- A **separate** binding for blueprint data — use the existing binding with extended payload
- A full page scan on every click — blueprint capture should be **per-element** at capture time;
  the full page blueprint is assembled by RecorderService from accumulated per-element data

### 2. `src/recorder/RecorderTypes.ts` — Additive Types

**⚠ REVISED:** Add blueprint references **additively** to existing types:

```ts
// Add to RecordedActionLocator:
blueprintCapture?: {
  documentOrder: number;
  siblingIndex: number;
  sameTagIndex: number;
  visible: boolean;
  enabled?: boolean;
  boundingRegion?: { relativeX: number; relativeY: number; relativeWidth: number; relativeHeight: number };
};
```

Do NOT modify `RecordedAction`, `LocatorQuality`, `LocatorContext`, `LocatorCandidate`,
`LocatorGuard`, or any existing field. This is additive only.

### 3. `src/recorder/RecorderService.ts` — Blueprint Assembly & Storage

Add to `RecorderService`:
- `assemblePageBlueprint()`: Called at recording session save. Walks the accumulated per-element
  blueprint captures and builds a `PageBlueprint`.
- `computePageKey()`: Normalize the current page identity.
- Hash all fingerprint fields using the existing `hashFingerprint()` from `locatorFingerprint.ts`.
- Persist atomically to `locator-blueprints/<page-key>.json`.
- Replace existing blueprint for the same `pageKey` only after successful capture.

> [!WARNING]
> **⚠ REVISED:** The plan says this module should "Normalize page keys" and "Hash sensitive blueprint fields." The **hashing** must use the exact same `hashFingerprint()` and `hashToken()` from [locatorFingerprint.ts](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/src/runner/locatorFingerprint.ts), not a separate implementation. The `verify:fingerprint-parity` verifier asserts that capture and runtime fingerprints are computed identically — diverging here would break that invariant.

### 4. `src/runner/locatorFingerprint.ts` — No changes needed

**⚠ REVISED:** The plan says "Extend similarity only when necessary; avoid creating divergent
recorder and runner algorithms." Confirmed: **no changes to this module are needed.** The existing
`similarity()` function, `hashFingerprint()`, and `fingerprintsEqual()` are sufficient. If a
positional bonus is wanted, add it at the **call site** in `LocatorFactory.recoverLocally()`,
not in the shared function.

### 5. `src/runner/LocatorFactory.ts` — Blueprint-Enhanced Recovery

Extend the existing `recoverLocally()` method (line 414) rather than inserting a new step:

```ts
// Pseudocode for the enhancement:
private async recoverLocally(
  root: LocatorRoot,
  step: FlowStep,
  expected: LocatorElementFingerprint,
  blueprint?: PageBlueprint  // NEW optional parameter
): Promise<...> {
  // EXISTING: scan visible elements, score, threshold, margin
  // ...existing code...
  
  // NEW: if no confident match from the broad scan, and a blueprint exists,
  // try a narrower, position-guided scan
  if (!best || best.score < RECOVERY_SCORE_THRESHOLD) {
    if (blueprint) {
      const entry = blueprint.elements.find(e => e.blueprintId === step.locator?.blueprintId);
      if (entry) {
        // Scan elements near the stored documentOrder position
        // Score using the SAME similarity() function
        // Apply the same threshold and margin
      }
    }
  }
}
```

### 6. Profile Serialization — Blueprint Reference

**⚠ REVISED:** The plan correctly says "Store only a blueprint reference and the target blueprint
ID in the workflow step." Add a single optional field to `StepLocator` in `FlowProfile.ts`:

```ts
// Add to StepLocator interface:
/** Blueprint element id for page-level recovery. Absent on legacy steps. */
blueprintId?: string;
```

This is additive, backward-compatible (optional field), and does not embed the blueprint
in the flow JSON.

---

## Items Confirmed Accurate (No Changes Needed)

1. ✅ **"Do not save complete HTML"** — Aligned with existing recorder guidance and
   [RULES.md](file:///c:/Users/moham/OneDrive/Desktop/AWTKIT/docs/ai/RULES.md) offline rules.
2. ✅ **"Document order is supporting evidence, not identity"** — Correct; the existing `similarity()`
   function has no position component, and the guarded-positional system uses fingerprint equality.
3. ✅ **"Sensitive actions require exact identity or manual approval"** — Already enforced by
   `resolveGuardedPositional()` which requires `fingerprintsEqual()` for `confidence: "exact"`.
4. ✅ **"A normalized page-and-frame key controls atomic replacement"** — Sound design.
5. ✅ **"Existing fingerprint, ambiguity, frame, shadow, and guarded-positional systems remain authoritative"** — Essential.

---

## Required Tests — **⚠ REVISED**

The plan's test list is comprehensive but should be **aligned with existing verifiers**:

### Extend existing verifiers (do NOT create parallel suites)

| Existing verifier | Blueprint test cases to add |
|---|---|
| `verify:recorder` (206/0) | Blueprint capture on normal actions; per-element data included in recorded payload |
| `verify:recorder-ambiguity` (69/0) | Blueprint capture for ambiguous locators |
| `verify:locator-guard` (33/0) | Sensitive action refuses blueprint recovery; guarded-positional remains authoritative |
| `verify:runner` (89/0) | Blueprint-enhanced recovery when all candidates miss; position-guided narrowing |
| `verify:frame-chain` (25/0) | Blueprint capture for framed targets; frame-scoped page keys |
| `verify:closed-shadow` (23/0) | Blueprint capture for closed-shadow targets |
| `test:random:roundtrip` (27/0) | Blueprint reference survives serialization round-trip |
| `verify:legacy-compat` (152/0) | Pre-blueprint flows load correctly (absent `blueprintId` is harmless) |
| `verify:flow-step-mapping` (111/0) | `blueprintId` survives mapping |

### New focused verifier

| New verifier | Purpose |
|---|---|
| `verify:blueprint-recovery` | Blueprint capture, page-key normalization, position-guided recovery, threshold/margin, sensitive refusal, atomic persistence, page-variant detection, cleanup |

### Specific test scenarios (from the original plan — all valid)

- Banner inserted before the target
- Sibling inserted beside the target
- Target moved into a new wrapper
- Reordered table rows
- Duplicate buttons with identical text
- Text changed while stable attributes remain
- Stable attributes changed while label remains
- Wrong element occupying the old document position
- SPA state changes without URL changes
- Same URL under different user roles (→ different page keys via title category)
- Same-origin and cross-origin frames
- Open and closed shadow roots
- Blueprint overwrite after successful new recording
- Failed capture preserving the previous blueprint
- Sensitive action refusing uncertain recovery
- Non-sensitive action resolving only when one candidate clearly wins
- Save/reload/export/import/edit/re-save round trips
- Privacy: raw inner text and page HTML not persisted

---

## Open Questions

> [!IMPORTANT]
> 1. **Should blueprint capture run on every action or only at session-save time?** Per-action capture
>    is more accurate (the DOM may change between actions), but a final-session snapshot is simpler
>    and captures fewer privacy-sensitive intermediate states.
>
> 2. **Maximum element count:** The plan suggests a cap but does not specify one. For a 2000-element
>    blueprint at ~200 bytes per entry (hashed), the file is ~400KB — within the 512KB limit. But
>    some enterprise pages have 10,000+ DOM elements. What should the cap be?
>
> 3. **Blueprint capture budget:** The existing `recorderInitScript.ts` already caps shadow root
>    scanning at 128 roots / 10,000 elements and container chain evaluations at 240. What is the
>    acceptable budget for blueprint element scanning? A `TreeWalker` walk over 5,000 elements takes
>    ~5ms in typical browser DOMs, which seems acceptable on a per-action basis.
>
> 4. **Should the blueprint store be shared across scenarios/flows or per-scenario?** The existing
>    `locator-recovery/` is per-runtime-root and scoped by `scenarioId + flowId + stepId`. Blueprints
>    keyed by page identity are naturally shared (same page in different flows → same blueprint). Is
>    this the intended behavior?

---

## Recommendation — Revised

Proceed with **Locator Blueprint Recovery** as an **enhancement to the existing locator recovery
system**, with these constraints:

1. Semantic and stable locators remain primary (existing behavior, unchanged).
2. The existing `LocatorRecoveryStore` and `recoverLocally()` remain the first recovery layer.
3. Page blueprints are a **second recovery layer** activated only when `recoverLocally()` fails.
4. Document order is a positional hint for narrowing the scan, not identity evidence.
5. Use the **existing** `similarity()` function and thresholds — do not create a second scoring model.
6. Inner text and names are hashed via the existing `hashFingerprint()` — do not create a second hashing pipeline.
7. Sensitive actions (guarded-positional) are **excluded** from blueprint recovery entirely.
8. A normalized page-and-frame key controls atomic replacement.
9. Full raw HTML is not persisted.
10. All new types are additive and optional — existing flows, fingerprints, guards, frames, shadows,
    containers, and the recovery store remain authoritative and unchanged.
