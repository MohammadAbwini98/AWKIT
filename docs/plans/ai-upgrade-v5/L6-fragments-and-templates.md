# L6 — Reusable Fragments & Shared Action Templates

Shared rules, architecture and decisions: `ROADMAP.md`. Depends on L2 and L4. Core behavior is deterministic.

**Status (2026-09-25): the deterministic scope is verified and `awkit-djnl.9` stays `in_progress` only
because L4b (`awkit-djnl.6`) blocks it.** The owner decided on 2026-09-25 (`docs/ai/DECISIONS.md`):
- L6 closes against its approved deterministic scope once L4b is genuinely accepted. That scope is: works
  with AI off, retrieval before the model, fragments validated as first-class content, no secrets persisted.
- The unbuilt intelligence is deferred to a dedicated follow-up bead outside Phase L, with its original
  intent and criteria unchanged (see "Deferred intelligence" below). It must not be built in Phase L
  without further authorization.

Verified on 2026-09-25 against a fresh `npm run build` at `e4a9abfd` (no L6 source changed after it):
- `verify:flow-fragments` 103/0;
- `verify:flow-fragments-gui` 53/0 in real Electron (capture and insert, undo/redo, save and read-back,
  locator and binding preservation, protected-login and IPC refusals, no console errors);
- `verify:ai-fragment-assist` 73/73 with the fake provider (discovery works with AI switched off).

The 2026-09-24 note had deferred the T1 surface under the closeout delegation; the owner's decision above
supersedes it.

## Deferred intelligence (owner decision 2026-09-25, tracked outside Phase L)

These are kept as future work, unchanged:
- **T1 parameter-mapping review.** Its host is a workflow-side insertion surface, since runtime inputs live
  on workflows. It never auto-binds and never offers a password input. The adapter and its fake-provider
  verifier already exist (`src/ai/fragmentAssist.ts`, `verify:ai-fragment-assist`).
- **Semantic fragment discovery through the Zvec index.** This is the plan's "extend Zvec projections"
  route. Retrieval stays before any model call, and the model stays optional.
- **Production fragment AI integration.** This covers the T0 summary and the T1 mapping outside the
  deterministic provider, within the autonomy ceilings `AiAutonomyPolicy` already registers.

The Phase L acceptance criteria above are not weakened. Building any of these needs the owner's GO on a
model for it.

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

> **Superseded in part (2026-09-25):** L1 is now accepted and closed (2026-09-24), so the chain "L4b is
> blocked by L1" below no longer holds. L6's one open dependency is L4b (`awkit-djnl.6`), which waits on a
> person's review. The `awkit-djnl.9` ← `awkit-djnl.6` edge is unchanged.

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

## The Intelligence section as built (2026-09-21)

Built under the conditional development authorization: `src/ai/fragmentAssist.ts`, proven by
`verify:ai-fragment-assist` (59/59, three mutations caught). `awkit-djnl.9` **stays open** — the hint
and summary surfaces were built the same day (see "The Intelligence renderer surfaces as built"), the
mapping review is not built, there is no production caller, and the milestone cannot close under that
authorization in any case.

- **Discovery is deterministic, and the plan's semantic-index route was not taken.** The spec reaches
  for the Zvec index and a new `fragment` document kind; the audit above had already recorded that no
  such kind exists and that inventing one with no consumer would be speculative. It is also not needed:
  a user's fragment library is a bounded, user-authored handful, not a corpus, so the passive
  "a similar fragment already exists" hint — which L6 explicitly marks **(no model)** — is structural
  similarity computed in-process. That is what lets the hint work with AI switched off and with no
  model pack installed, which is what *passive* ought to mean.
- **Similarity compares step SHAPE, not the user's words.** Multiset overlap of step types, so two
  authors who order a `fill` pair differently still match, and renaming every step changes nothing.
  Comparing names or locator values would make the hint depend on two people writing the same prose.
  Capped at three and stably ordered, because a hint that reshuffles while it is read is worse than none.
- **The T0 summary sends step types and input keys only.** A fragment is captured verbatim from a real
  flow, so its step names, locator values and typed values are the user's own business content and a
  summary is not worth sending them.
- **The T1 mapping proposes key pairs and binds nothing.** A password-typed workflow input is excluded
  from the request, from the prompt and from the grammar's key enum — the model is never shown a
  credential and cannot propose one — and `CREDENTIAL_TARGET` still refuses it at the parse, because a
  request is not the only way to reach a parse. Two fragment inputs can never be aliased onto one
  workflow input (that would silently make two distinct values one), and **type compatibility is
  decided by the declarations, never by how confident the answer sounds**.
- **Mutation-tested three for three:** accepting a type mismatch → 58/59; allowing the alias → 58/59;
  offering password inputs as targets → 54/59, with the second line of defence correctly firing
  `CREDENTIAL_TARGET` instead. The alias mutation also exposed a **fixture weakness**: with only one
  text input, the alias case was simultaneously a type mismatch, so the type rule shadowed the alias
  rule and it went untested. The fixture now declares two same-typed inputs so each duplicate rule
  fails alone.

**Still unbuilt:** the mapping review (below) and the production caller (the same L1-gated boundary as
L3 §7–§9, L4b and L5b).

### The Intelligence renderer surfaces as built (2026-09-21, `63d0a3cb`)

Deterministic provider only; `awkit-djnl.9` stays `in_progress` and cannot close.

- **The hint** is in the save dialog: `findSimilarFragments` over the **checked** steps' types against the
  stored library, computed in the renderer with no model, no index and no new IPC. It works with AI off;
  an unreadable library means no hint, never a blocked save.
- **The summary** is on-demand in the insert dialog (*Describe with AI*), through `ai:summarizeFragment`
  (AI_USE + PAGE_FLOWS). The renderer names the fragment; main reads the **stored** one, so a body sent by
  the renderer is never used. Labelled, cancellable, abandoned when another fragment is selected.
- **The mapping review is deliberately NOT built.** §"Required inputs are shown, never remapped" above
  still holds: runtime inputs live on workflows, so a Flow Designer mapping UI would invent a flow-level
  declaration. Its host is a workflow-side insertion surface that does not exist yet.
- **Verifiers:** `verify:ai-fragment-assist` 73/73 (a 14-check adapter section), `verify:ai-assist-gui` in
  real Electron, `verify:flow-fragments-gui` 53/53 as the dialogs' regression; mutations caught: the
  summary ignoring the AI policy, the hint computed from every step instead of the checked ones.
