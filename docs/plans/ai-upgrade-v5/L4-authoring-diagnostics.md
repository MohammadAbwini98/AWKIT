# L4 — Authoring Diagnostics (L4a deterministic, L4b AI)

Shared rules, architecture and decisions: `ROADMAP.md`. L4a depends on L0; L4b on L1 go/no-go PASS + L4a.

## L4a — Deterministic diagnostics

1. Build a matrix: for each family — unreachable nodes, connector-rule violations, illegal Start/End, missing required
   bindings, missing runtime/data bindings, branch-pair violations, unsafe/unbounded cycles, malformed Loop, orphan
   nodes/edges, incompatible ports, stale resource/nested-workflow references — record existing owner
   (`FlowValidator.ts`, `PreRunValidator.ts`, `workflowProfileValidation.ts`) and layer.
2. Add only missing checks, with stable code, severity, affected IDs and safe explanation data; one rule table shared
   by design-time, pre-run and runtime.
3. One tracked `bd` task per family/owner.

### Audit matrix (2026-09-19, `awkit-djnl.5`)

`FLOW_VALIDATION_RULES` is the one rule table. The designer (`validateFlowDefinition`), import and the run gate
(`PreRunValidator` → `validateFlowSet`) read it. The runtime keeps only its connector-structure gate
(`FlowExecutor` → `validateConnectorStructure`). `workflowProfileValidation.ts` checks only the import envelope;
workflow execution semantics are owned by `FlowDependencyResolver`. **New** = added by L4a. Each new rule mirrors
what `FlowExecutor` does, and `verify:authoring-diagnostics` asserts those premises on its source.

| Family | Flow owner and code | Workflow owner | Layer | Before L4a |
|---|---|---|---|---|
| Unreachable nodes | `unreachableNode` (error, off-path) | — | design, import, gate | Reachability walked through End steps, so a step reachable only past End was missed. **New:** End-aware reachability |
| Connector rules | `connectorStructure` (wraps `validateConnectorStructureDetailed`) | `FlowDependencyResolver` structure checks | design, import, gate, runtime | Covered |
| Illegal Start/End | `missingStartNode`, `multipleStartNodes`, `missingEndNode`, `unreachableEndNode`; **New:** `connectorFromEndNode` (warning); a connector into Start is `unguardedCycle` | — | design, import, gate | Connectors out of End and into Start were unchecked |
| Missing required bindings | `missingRequiredLocator`, `missingRequiredValue`; **New:** `incompleteCondition` (warning) | conditional link without expression | design, import, gate | Condition completeness existed only as a designer advisory |
| Missing runtime/data bindings | **New:** `incompleteValueSource` (warning); PreRun JSON path (malformed: error); **New:** JSON path to a missing key (warning) | — | design, import, gate | Any value-source object satisfied the requirement; keyed sources missing their key resolve to "" |
| Branch pairs | **New:** `incompleteBranchPair` (error) via `src/validation/BranchPairs.ts` | advisory in the Workflow Builder only | design, import, gate | The Flow Designer's Save-blocking check (`connectorStructureIssues`) had no caller; the engine had no rule |
| Unsafe/unbounded cycles | **New:** `unguardedCycle` (error); `invalidLoopBounds`, `largeLoopBounds` | link cycle error | design, import, gate | Runtime threw "runtime cycle" mid-run; nothing caught it earlier |
| Malformed Loop | `invalidLoopBounds`, `unsupportedConfiguration`, loop step contract; **New:** `emptyLoopValues` (warning) | loop bound, while condition | design, import, gate | Empty static list was a designer advisory |
| Orphan nodes/edges | `unreachableNode`, `brokenConnectorEndpoint` | link to a missing flow | design, import, gate | Covered |
| Dead ends | **New:** `deadEndNode` (warning); the legacy `next` field still counts as a route | — | design, import, gate | Designer advisory only |
| Priority ties | **New:** `ambiguousConditionPriority` (warning) | — | design, import, gate | Designer advisory only |
| Incompatible ports | Retired with the two-port node model; no connector carries a port field | — | — | N/A (asserted) |
| Stale references | `missingFlowReference`, `flowReferenceCycle`, missing scenario flow reference | link to a missing flow | design, import, gate | Flows covered. Data sources and secrets fail loudly at run time with named errors; a design-time check needs library context (follow-up bead) |

**Severity rule.** A new rule is an **error** only where the runtime already fails or misroutes: `incompleteBranchPair`
(the condition is ignored, or the parallel target runs twice) and `unguardedCycle` (a runtime-cycle error when taken).
Everything else is a **warning**, so no flow that runs today is newly blocked except through a genuine defect. The End-aware
reachability can newly report steps past End as `unreachableNode`. That is off-path, so a Legacy Compatibility grant
tolerates it, and `FLOW_VALIDATOR_VERSION` 4 triggers a fresh inventory scan that issues those grants.

**Status:** **closed** as `awkit-djnl.5`: matrix complete, missing checks added,
`verify:authoring-diagnostics` 94/94 (two mutations caught), and final Flow Designer evidence 138/138 broad +
16/16 capsule. Designer advisories moved into the engine (only L2's locator-quality advisory stays in the renderer). Open follow-ups:
design-time data-source/secret reference checks (needs a library context like `referenceableFlowIds`).

## L4b — AI explanations (T0) and fix ranking (T1)

**Status (2026-09-21): the contract is BUILT** — `src/ai/authoringExplanation.ts`, proven by
`verify:ai-authoring` (55/55, three mutations caught) over the real `FlowValidator`, the real
`AiService` and the real output contract with a deterministic transport. **The renderer surface was built
the same day** (see "L4b renderer surface as built"). `awkit-djnl.6` is `in_progress`: the live quality
gate and a live-model caller are not built, and the milestone cannot close under the conditional
development authorization.

### L4b as built

- **The two rules L4b turns on are structural, not checks that could be forgotten.**
  - *AI cannot invent a fix kind* — the answer schema has **no `kind` field at all**. A ranking is a
    subset of issue **ids** the validator already emitted a `safeFix` for, so the most a model can do is
    reorder work `SafeFixApplier` was already willing to perform. A new fix kind stays what the spec
    says it is: a deterministic owner-approved change to `FlowValidator` and `SafeFixApplier` first.
  - *AI cannot name something outside the report* — issue ids are a closed `enum` in the decoding
    grammar, built from that report, and `parseAuthoringAnswer` re-checks them after decoding, because
    a grammar is one layer and L1.3 requires runtime validation as well.
- **The ranking enum is narrower than the explanation enum**, so an unfixable issue cannot even be
  decoded into a ranking; `FIX_NOT_EMITTED` is the second line for a caller that bypasses the grammar.
- **What crosses to the model:** issue codes, severities, active-path flags, generated anchor ids, the
  rule's own one-line summary from `FLOW_VALIDATION_RULES`, and each emitted fix's `kind` and `field`.
  **Never** the validator's `message` — a mutation proved it embeds the step name — and never
  `safeFix.from`/`to`, which are withheld although they are *usually* enum casing, because "usually" is
  not a contract.
- **Ids are positional (`i0`, `i1`, …) within ONE report snapshot**, and the request returns its own
  id→issue map, so a caller maps an answer back through the request rather than re-validating and
  risking drift.
- **Mutation-tested three for three:** allowing a ranking of an unemitted fix → 54/55; widening the
  ranking enum to every issue id → 54/55; sending the validator message instead of the rule summary →
  51/55 (caught by four separate privacy assertions).
- **Not built:** `verify:ai-authoring-quality-live`, and a live-model caller, for the same L1-gated reason
  as L3 §7–§9. (The renderer surface was built on 2026-09-21 — below.)

### L4b renderer surface as built (2026-09-21, `8ee425a1`)

Deterministic provider only; `awkit-djnl.6` is `in_progress` and cannot close under the conditional
authorization.

- **Where:** the Flow Designer's validation panel (`AuthoringAssist.tsx`), backed by
  `app/main/ai/aiAssist.ts#explainFlowValidation` behind `ai:explainValidation` (AI_USE + WORKFLOW_VIEW).
- **The renderer sends the open flow; main re-validates it** with the real `FlowValidator` against the
  saved library, exactly as the designer does, then reuses `buildAuthoringRequest`/`parseAuthoringAnswer`.
  No renderer string becomes prompt text.
- **States:** availability (off / unavailable), loading with Cancel (window-scoped `ai:cancelAssist`),
  **stale** (any edit withholds the answer — it is tied to the document snapshot it was asked about),
  refused (`OUTPUT_REJECTED`, none of the text shown) and AI-off (validation and fixes unaffected).
- **UX mapping:** violated rule and its row (existing) · AI explanation labelled *AI interpretation*
  under the exact finding row · available safe fix marked with its AI fix order · **Apply** is the
  unchanged preview → confirm → `SafeFixApplier` path, refused while the editor is dirty · Show on Canvas
  is the existing row navigation · Dismiss is closing the panel. The fix order shows only where the policy
  says *suggest* (T1); an administrator lowering ranking to T0 withholds it.
- **Verifiers:** `verify:ai-authoring` 85/85 (a 30-check adapter section), `verify:ai-assist-gui` in real
  Electron; mutations caught: unscoped cancel ids, ranking shown at T0, the stale guard removed.

- Input: violation codes, affected IDs with safe labels, bounded neighborhood, rule text, the `safeFix` kinds the
  validator emitted for this graph.
- Output: explanation (T0, labelled AI) and optional ranking/selection among **emitted** `safeFix` entries (T1).
  `SafeFixApplier` today supports only `normalizeEnumCasing` and duplicate-connector `regenerateId`; AI cannot add fix kinds.
- New fix kinds (e.g. reconnect orphan) = separate owner-approved deterministic change in `FlowValidator` +
  `SafeFixApplier` first, with their own simulation/preview; only then may AI rank them.
- Apply path unchanged: `flowValidationService` preview → backup → confirm → apply → undo → revalidate.

## UX

Violated rule, highlighted nodes/edges, AI explanation (labelled), available safe fix, simulated before/after counts,
Apply / Show on Canvas / Dismiss.

## Verifiers

`verify:authoring-diagnostics` (every family, Flow/Workflow parity, legacy profiles), `verify:ai-authoring`
(fake provider: unknown IDs rejected, non-emitted fix rejected), live `verify:ai-authoring-quality-live`;
existing validation, legacy-compat and profile-store gates; `npm run build`.

## Acceptance

Validators remain the single source of truth; SafeFixApplier remains the only mutation authority; AI never adds a fix
kind; explanation quality target recorded and met before release.
