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

**Status:** matrix complete, missing checks added, `verify:authoring-diagnostics` 94/94 (two mutations caught),
designer advisories moved into the engine (only L2's locator-quality advisory stays in the renderer). Open follow-ups:
design-time data-source/secret reference checks (needs a library context like `referenceableFlowIds`).

## L4b — AI explanations (T0) and fix ranking (T1)

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
