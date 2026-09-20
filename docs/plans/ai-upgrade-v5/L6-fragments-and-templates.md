# L6 — Reusable Fragments & Shared Action Templates

Shared rules, architecture and decisions: `ROADMAP.md`. Depends on L2 and L4. Core behavior is deterministic.

## Audit first (blocking)

Matrix — existing capability / reusable owner / real gap / proposed change / verifier — for: semantic indexing of
flows/workflows, flow clone/import/export, unknown-field preservation, canvas insertion + auto-arrange + history,
shared node/action configuration, data-binding placeholders, dependency/reference validation. No implementation from
assumptions.

## Deterministic features

1. **Fragments** — save a valid subgraph preserving node config, connectors, locator metadata (incl. provenance),
   waits, failure policies, binding placeholders, unknown compatible fields; never resolved secrets or
   environment-specific secret values.
2. **Action templates** — parameterized sequences with explicit required inputs; no protected-login templates.
3. **Insertion** — existing canvas/history/auto-arrange path, then binding resolution and immediate validation; undo/redo,
   save/reload, import/export.

## Intelligence

- Discovery: semantic index retrieves candidate fragments/templates first (extend Zvec projections if needed).
- AI: summary (T0) and parameter-mapping suggestion (T1). Never auto-insert or auto-bind.
- Optional automation: while editing, show a passive "similar fragment exists" hint from semantic retrieval (no model).

## Verifiers

`verify:flow-fragments` (only if no existing verifier owns it), `verify:ai-fragment-assist` (fake provider); existing
semantic, profile-store, designer/builder, history and validation gates; `npm run build`.

## Acceptance

Works with AI disabled; retrieval precedes the model; AI only summarizes/maps; fragments are validated first-class content.

## Dependency boundary (established 2026-09-20, before any implementation)

The milestone table above says L6 depends on **L2 and L4**, and the tracker encodes that as
`awkit-djnl.9` blocked by `awkit-djnl.3` (L2, **closed**) and `awkit-djnl.6` (**L4b, open**). L4b is
blocked by L1, whose runtime binding and benchmark are blocked on the owner's model acquisition, so
`bd ready` does not list L6 and must not be made to. That edge is **unchanged**, and
`awkit-djnl.9` is **not closed**.

What is nonetheless independent: the **Deterministic features** section needs L2's locator metadata
and provenance (closed) and L4a's `FlowValidator` (closed), and nothing from L4b. The ROADMAP's own
gating sentence is scoped — "AI-dependent work (L3, L4b, L5b, **AI parts of** L6) starts only after
the L1 performance go/no-go PASS" — so the deterministic core is not L1-gated. This follows the
precedent L3 already set: its model-independent sections were built while `awkit-djnl.4` stayed
`in_progress` behind L1, and it was never closed.

Scope built: deterministic features 1–3 and the blocking audit. **Not built and still dependency-
blocked:** the whole *Intelligence* section — semantic discovery of fragments (no `fragment`
document kind exists; `node-template` is a node-TYPE catalog keyed by `nodeType`, not a per-fragment
document), the T0 summary, the T1 parameter-mapping suggestion, and the passive "similar fragment
exists" hint. `AiAutonomyPolicy` already registers `fragmentSummary` (T0) and
`fragmentParameterMapping` (T1) with their ceilings, so no policy work is owed — only the feature.

## Audit first (blocking) — the matrix, verified against the code at `ffdfcbf`

| Capability | Existing owner (verified) | Real gap | Change made | Verifier |
|---|---|---|---|---|
| Semantic indexing of flows/workflows | `SemanticProjection.ts`: `projectFlowDocument`, `projectWorkflowDocument`, `SEMANTIC_PROJECTION_ALLOWLIST` | No `fragment` kind. `node-template` is keyed by `nodeType` — a node-type catalog, not a fragment document, and its allowlist carries no fragment identity | **None.** Discovery is the L1-gated Intelligence section; a document kind with no consumer would be speculative | — (deferred with the milestone) |
| Flow clone / import / export | `JsonProfileStore.clone/import/export`; `flows:clone|import|export` | `import` writes unconditionally (`writeProfile`, no existence check) while `create` refuses a duplicate id. An import-shaped fragment channel would therefore be able to overwrite | Fragments are created **only** by capture from a real flow, through `create`. No blind-write import channel exists | `verify:flow-fragments` ("creating a fragment with an existing id is refused") |
| Unknown-field preservation | `JsonProfileStore` parses and re-serializes the whole document with no schema filter; `flowProfileMapping.toFlowStep` spreads `originalStep.locator` | None at the store layer — it is total | Capture deep-copies whole `FlowStep`/`FlowEdge` objects rather than rebuilding them field by field, so the guarantee carries into fragments | `verify:flow-fragments` (an unknown field survives capture, save, reload and re-save) |
| Canvas insertion + auto-arrange + history | `FlowChartDesigner.insertAndArrangeNodes` (`withAutoLayout` + `useEditorHistory` + `armLayoutGlide`); the existing paste path already inserts through it | None — it already takes a node ARRAY plus the next edges, so a multi-step fragment inserts as one transaction and one history entry | Reused as-is; `applyFragment` produces exactly that shape | existing designer/history gates |
| Shared node/action configuration | `NodeConfig` on `FlowStep.config`; `getFlowNodeCatalogItem` / `defaultNodeData` | **The real gap.** No persisted, user-authored reusable unit exists at all | New `FlowFragment` + `src/fragments/**` + a `JsonProfileStore` under the runtime root | `verify:flow-fragments` |
| Data-binding placeholders | `ValueSource` (`FlowProfile.ts`); `ValueResolver` resolves `runtimeInput` by `valueSource.key`; `RuntimeInputDefinition` | A `secret` source stores only `secretName`, so a verbatim copy is safe **by construction**; the hazard is a resolved literal sitting beside it. `env`/`json`/`flowOutput`/`dataSourceId` are environment-specific but legitimate | Required inputs reuse `RuntimeInputDefinition`, derived from the bindings the steps already carry — no second parameter system. A secret literal blocks; an environment binding is advisory | `verify:flow-fragments` §4, §6, §8 |
| Dependency / reference validation | `FlowValidator.validateFlowDefinition` (`missingFlowReference`, `duplicateFlowId`, `flowReferenceCycle`, connector structure) | It validates a **runnable flow**. Every fragment would fail it for non-defects (no start, no terminal path), and a fragment's own hazards are not what it looks for | A fragment-scoped audit for subgraph integrity; the **applied flow** is still validated by the existing validator | `verify:flow-fragments`, `verify:validation` |

### Observation recorded, not fixed here

`PROTECTED_LOGIN_STEP_TYPES` existed as **two module-private copies** — in
`src/security/authz/AiAutonomyPolicy.ts` and as `PROTECTED_STEP_TYPES` in
`src/runner/evidence/FailureEvidenceCollector.ts`. A third copy was not acceptable, so the canonical
exported set now lives in `src/profiles/FlowProfile.ts`, beside the `StepType` union that defines
those names. Collapsing the two existing copies onto it requires editing `src/security/authz/**`,
which is Risk 3 and lease-gated; the lease could not be granted in that session (see KNOWN_ISSUES),
so it is **outstanding**. Until it lands, `verify:flow-fragments` carries a drift guard that reads
both files and fails if either stops agreeing with the canonical set.

## §1–3 as built (2026-09-20)

| Part | Where |
|---|---|
| Contract + blocking audit matrix (16 codes, 12 blocking / 4 advisory) | `src/fragments/FlowFragment.ts` |
| Capture (subgraph → fragment) and apply (fragment → flow) — both pure | `src/fragments/fragmentOperations.ts` |
| Trusted boundary: 6 permission-gated channels, audit re-run on every call | `app/main/ipc/fragment.ipc.ts` |
| Store (`JsonProfileStore` under `<runtime root>/fragments`) | `app/main/profileStores.ts` |
| Renderer surface | `window.playwrightFlowStudio.fragments` (`app/main/preload.ts`) |

- **Fail-closed at the boundary, not in the renderer.** `fragments:capture` and `fragments:apply`
  re-run the audit in main. `fragments:apply` re-audits the fragment **loaded from disk** rather
  than trusting that it was valid when captured: the fragment folder is ordinary user-writable JSON,
  so "it passed once" says nothing about the bytes being read now.
- **No partial write.** `applyFragment` is pure and builds the whole next profile before returning;
  the write is one `updateWith` compare-and-swap in the flow folder's lane, and a blocking finding
  returns `undefined` from the change function, so nothing is written at all.
- **Identity.** Every applied step gets a fresh id, with internal connectors and `next` pointers
  remapped onto it; a `next` leaving the fragment is dropped rather than left dangling. Applying the
  same fragment twice therefore adds a second independent copy and can never overwrite the first.
- **Findings name a location, never a value.** A finding carries node/edge/input key and a dotted
  field path. The suite asserts that no finding anywhere quotes a secret's value *or its name*.
- **Bindings are found by shape, not by a field list.** An Oracle node's binds live at
  `config.oracle.binds[i].valueSource`; any field-enumerating implementation misses them. The walk
  collects permissively and the rules judge strictly.
- **Start/End are refused** — they belong to the destination flow, so a fragment that carried one
  would collide on insert.
- **Dangerous mutation is advisory, not blocking.** The spec forbids protected-login templates and
  says nothing about mutating steps, and refusing them would be inventing product policy.

**Verifier:** `verify:flow-fragments` **97/97** (`integration`; real `JsonProfileStore` in a temp
dir). Mutation-tested four ways: narrowing the protected-login rule to one type → 93/1; making apply
reuse the original node ids → 88/6; replacing the shape walk with a field list → 92/2 (only the
nested Oracle case). A fourth — moving `resolvedSecretValue` out of the blocking set — **survived at
94/0**, because every secret assertion checked that the code was *reported* and none checked that it
*blocked*; the suite now asserts severity per code against a declared table, and the same mutation is
caught at 95/2. Source restored; final state re-run clean.

## The Flow Designer surfaces as built (2026-09-20)

| Part | Where |
|---|---|
| Save-selection and insert-fragment dialogs | `app/renderer/components/workflow/FragmentDialogs.tsx` |
| Two permission-gated command-bar controls + handlers | `app/renderer/pages/FlowChartDesigner.tsx` |
| Styles (tokens only, both themes) | `app/renderer/styles/global.css` |

- **Capture and insert use different write paths, deliberately.** Capture calls `fragments:capture`, so
  the fragment is created in main from the **stored** flow through `create` — the only creation route,
  since no blind-write import channel exists. Insert deliberately does **not** call `fragments:apply`:
  that channel writes the stored flow, which bypasses the editor entirely, producing an insertion the
  user cannot undo and that the next save of an already-dirty document would silently overwrite.
  Insertion is an ordinary editor transaction built by the same pure `applyFragment`, so undo/redo,
  dirty state and Save are the existing mechanisms. `fragments:apply` remains the audited store-write
  path for callers that are not the editor, and the GUI suite proves it still refuses on its own.
- **A dirty editor refuses capture** and says why, because capture reads the stored flow and unsaved
  edits would not be in it. Capturing silently would produce a fragment of a graph the user is not
  looking at.
- **The selection model is the designer's own, and it is single-node.** `selectedNodeId` seeds the
  dialog; the user then checks the steps to include. No marquee multi-select was added — that is a
  canvas redesign, and the canvas was explicitly out of scope. Terminals are not offered at all, since
  the audit blocks them and a control certain to be refused is not a control.
- **Required inputs are shown, never remapped.** `runtimeInputs` live on the **workflow** profile, not
  on a flow, so there is no flow-level declaration to map onto. A mapping UI here would invent one, and
  rebinding would be precisely the silent substitution the audit exists to prevent.
- **Stale answers are dropped, not displayed.** Every async call in the library dialog carries a request
  token, so a slow audit for a previously-selected fragment — or for a flow the user has left — is
  discarded rather than shown against the wrong subject. Insert itself re-runs `applyFragment` against
  the **live** graph at click time, so the refusal a user sees is always the authoritative one.
- **The modal focus contract is the shared `useModalFocusContract` hook**, not markup copied from a
  dialog that happens to have it today. `verify:source-hygiene` enforces this for every `aria-modal`
  surface.

**Verifier:** `verify:flow-fragments-gui` **53/53** (`real-browser`, real Electron). It asserts against
the **filesystem and the canvas**, never the app's opinion of either, and every seeded fixture is audited
at seed time so a fixture that quietly stopped being what it is named for cannot void a section while
reporting green. §9 drives `fragments:apply`/`fragments:capture` over **direct IPC with no dialog open**,
because a disabled control is a courtesy and not a boundary. Mutation-tested twice: `freshId` returning
the base id → 29/31 (and the second insertion then correctly added nothing); dropping the `blocked` term
from `canInsert` → 46/47, which is what exposed the missing direct-IPC coverage that §9 now provides.

**A real regression, caught and fixed in the product.** Two labelled buttons added to the command bar
overflowed it at 1024px; `verify:flow-designer` caught the escaped control. They became
`EditorIconButton`s with the accessible name on `aria-label`, matching the utilities group — the
assertion was not relaxed. That verifier's group count is hardcoded and exact, and moved 3 → 4.

**Still L1-gated and unbuilt:** the entire *Intelligence* section. `awkit-djnl.9` stays open.
