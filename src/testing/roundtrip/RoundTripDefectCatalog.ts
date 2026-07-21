/**
 * Catalog of **known** round-trip defects.
 *
 * Phase 3 of the Randomized Automation Test Lab is a discovery run, and it is expected to fail.
 * Its value is not a green check — it is the ability to answer, on every future run:
 *
 *   "Is this a defect we already know about, or did something new break?"
 *
 * That distinction is what this file provides. Every entry was read out of the source, carries the
 * exact boundary responsible, and is classified by what the loss actually costs at runtime (verified
 * against `StepExecutor`, not assumed).
 *
 * ## Rules
 *
 * - An entry here does **not** suppress an assertion. `verify-random-roundtrip.mts` still fails.
 *   Cataloguing changes how a difference is *reported*, never whether it is reported.
 * - A difference that matches no entry is an **unexpected new failure** and is reported first.
 * - When a defect is fixed, delete its entry. The verifier then flags any remaining occurrence as a
 *   regression rather than silently re-accepting it.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { DifferenceKind, DifferenceSeverity } from "./SemanticDiff";

/** Where the loss happens. Distinguishing these matters — the fixes live in different layers. */
export type PersistenceBoundary =
  /** `app/renderer/components/workflow/flowProfileMapping.ts` (designer ↔ profile). */
  | "designerMapping"
  /** `JsonProfileStore` stringify/parse (`src/storage/ProfileStore.ts`). */
  | "jsonSerialization"
  /** Recorder → flow conversion (`buildRecordedFlow.ts`). */
  | "recorderConversion";

/**
 * Whether the corpus actually demonstrates the defect.
 *
 * `observed` entries are proven by the current generator and are asserted to keep reproducing — if
 * one stops appearing it has either been fixed (delete the entry) or the generator stopped covering
 * it (a coverage regression). `predicted` entries were read out of the source but the generator
 * does not yet emit the shape that triggers them; they are documented, not asserted, so the catalog
 * never claims more than the run proves.
 */
export type DefectStatus = "observed" | "predicted";

export interface RoundTripDefect {
  readonly id: string;
  readonly title: string;
  readonly boundary: PersistenceBoundary;
  readonly status: DefectStatus;
  /**
   * Diff shapes (`differenceShape()` output) this defect explains. A shape also matches every path
   * nested beneath it, so `nodes[].config` covers `nodes[].config.waitType`; where two entries could
   * both match, the longest (most specific) shape wins.
   */
  readonly shapes: readonly string[];
  readonly kinds: readonly DifferenceKind[];
  readonly severity: DifferenceSeverity;
  /** Exact source location responsible, as `path:line`. */
  readonly owner: string;
  /** Which node types are affected, or how to derive the set. */
  readonly affectedNodeTypes: string;
  /** What the loss costs — execution behavior, security, or only editing fidelity. */
  readonly impact: string;
  readonly recommendedFix: string;
}

export const KNOWN_ROUNDTRIP_DEFECTS: readonly RoundTripDefect[] = [
  {
    id: "RT-01",
    title: "Locator discarded from steps the node catalog does not mark `requiresLocator`",
    boundary: "designerMapping",
    status: "observed",
    shapes: ["nodes[].locator"],
    kinds: ["lost"],
    severity: "executionAffecting",
    owner: "app/renderer/components/workflow/flowProfileMapping.ts (toFlowStep) — original at app/renderer/pages/FlowChartDesigner.tsx:1138-1149",
    affectedNodeTypes:
      "Every type with `requiresLocator` falsy in flowNodeCatalog.ts that the runner can still use one for — confirmed: `wait`, `screenshot`.",
    impact:
      "Execution. `wait` with `config.waitType: \"selector\"` resolves `step.locator` (StepExecutor.ts:1524) — losing it breaks the wait. `screenshot` uses `step.locator` to capture an element (StepExecutor.ts:937) — losing it silently downgrades to a page screenshot, changing the stored artifact.",
    recommendedFix:
      "Persist `locator` whenever `data.locatorValue` is non-empty, not only when `catalogItem.requiresLocator` is true. The catalog flag is a *validation* rule (\"the user must supply one\"), not a *persistence* rule, and toFlowStep is the only place the two are conflated."
  },
  {
    id: "RT-03",
    title: "Recorder popup/window metadata discarded on designer re-save",
    boundary: "designerMapping",
    status: "observed",
    shapes: ["nodes[].pageAlias", "nodes[].opensPopup", "nodes[].popupExpectation"],
    kinds: ["lost"],
    severity: "executionAffecting",
    owner:
      "app/renderer/components/workflow/flowProfileMapping.ts — `toFlowStep` never writes these fields and `fromFlowStep` never reads them; the Recorder emits them at app/renderer/.../buildRecordedFlow.ts:84-87",
    affectedNodeTypes: "`click` (opener steps), plus every step carrying a non-`main` `pageAlias`; breaks `switchToPopup`/`closePopup`/`switchToMainPage` downstream.",
    impact:
      "Execution — this one breaks the flow outright. The opener click arms popup capture only when `step.opensPopup && step.popupExpectation` (StepExecutor.ts:719); a later `switchToPopup` throws without a `popupExpectation` (StepExecutor.ts:764), and `closePopup` throws without an alias (StepExecutor.ts:801-802). A recorded multi-window flow works until the first designer save, then fails.",
    recommendedFix:
      "Carry `pageAlias`, `opensPopup` and `popupExpectation` through `FlowDesignerNodeData` and map them in both directions. They are recorder-owned and not user-editable in the designer, so a pass-through field is sufficient — no new UI required."
  },
  {
    id: "RT-04",
    title: "Explicit step safety policy discarded on save",
    boundary: "designerMapping",
    status: "observed",
    shapes: ["nodes[].safety"],
    kinds: ["lost"],
    severity: "securityAffecting",
    owner: "app/renderer/components/workflow/flowProfileMapping.ts — `toFlowStep`/`fromFlowStep` do not map `FlowStep.safety`",
    affectedNodeTypes: "Any step carrying an explicit `StepSafetyPolicy`.",
    impact:
      "Security. `safety` is authoritative for retry decisions when present; without it the runner falls back to node-type defaults and a keyword heuristic. A step explicitly marked non-retryable (`dangerousMutation`) becomes retryable-by-heuristic after a designer save.",
    recommendedFix: "Pass `safety` through the designer node data unchanged, as with the other recorder-owned fields."
  },
  {
    id: "RT-05",
    title: "Edge identity is regenerated from source/target instead of preserved",
    boundary: "designerMapping",
    status: "observed",
    shapes: ["edges[].id"],
    kinds: ["changed"],
    severity: "executionAffecting",
    owner: "app/renderer/components/workflow/flowProfileMapping.ts — `createEdge` sets `id: `edge-${source}-${target}``",
    affectedNodeTypes: "Not node-scoped. Affects every edge; collides when two edges share a source and target.",
    impact:
      "Execution, in the collision case. Two connectors between the same pair of nodes — a legal shape for conditional and parallel fan-out — are assigned the *same* id after a load, so they are no longer distinguishable. Edge ids also appear verbatim in `validateConnectorStructure` diagnostics, so error messages stop pointing at a real connector.",
    recommendedFix: "Thread the persisted `edge.id` through `loadProfile` into `createEdge` and only synthesize an id for connectors created by user interaction."
  },
  {
    id: "RT-06",
    title: "Flow description and version are hardcoded on save, discarding the loaded values",
    boundary: "designerMapping",
    status: "observed",
    shapes: ["description", "version"],
    kinds: ["changed"],
    severity: "editingFidelity",
    owner: "app/renderer/components/workflow/flowProfileMapping.ts — `toFlowProfile` emits a literal description and `version: 1`",
    affectedNodeTypes: "Profile-level; not node-scoped.",
    impact:
      "Editing fidelity. A user-authored description is replaced by the literal \"Editable reusable flow\" on every save, and `version` is pinned to 1 — so the field cannot be used for schema evolution later.",
    recommendedFix: "Pass the loaded `description` and `version` through the designer state and emit them unchanged."
  },
  {
    id: "RT-07",
    title: "Profile timestamps dropped on save",
    boundary: "designerMapping",
    status: "observed",
    shapes: ["createdAt", "updatedAt"],
    kinds: ["lost"],
    severity: "editingFidelity",
    owner: "app/renderer/components/workflow/flowProfileMapping.ts — `toFlowProfile` emits neither field",
    affectedNodeTypes: "Profile-level; not node-scoped.",
    impact:
      "Editing fidelity, with an audit cost: a flow's creation date is lost the first time it is saved from the designer, so the library can no longer sort or report on it.",
    recommendedFix: "Preserve `createdAt` from the loaded profile and set `updatedAt` at save time in the store, not in the mapping."
  },
  {
    id: "RT-08",
    title: "Connector labels are fabricated from the connector type when absent",
    boundary: "designerMapping",
    status: "observed",
    shapes: ["edges[].label"],
    kinds: ["fabricated"],
    severity: "cosmetic",
    owner: "app/renderer/components/workflow/flowProfileMapping.ts — `createEdge` computes `label ?? linkType`",
    affectedNodeTypes: "Not node-scoped.",
    impact:
      "Cosmetic, but it makes saves non-idempotent: an unlabelled connector acquires a label equal to its type on first load, which is then persisted and shows on the canvas as if the user had typed it.",
    recommendedFix: "Keep the derived label as a render-time default; do not fold it into `edge.data.label`, which is what `toFlowProfile` persists."
  },
  {
    id: "RT-09",
    title: "`toNodeConfig` emits its full field set on every node type",
    boundary: "designerMapping",
    status: "observed",
    shapes: ["nodes[].config"],
    kinds: ["fabricated", "changed"],
    severity: "cosmetic",
    owner: "app/renderer/components/workflow/flowProfileMapping.ts — `toNodeConfig` returns ~16 always-populated fields",
    affectedNodeTypes: "All 30.",
    impact:
      "Cosmetic, with two practical costs: saved JSON is inflated with irrelevant keys (a `goto` node carries loop and scroll settings), and because absent fields are re-defaulted on load and then written back, the document is not stable across a no-op open-and-save.",
    recommendedFix: "Emit only the fields the node type uses — the function already does exactly this for `routeChange`, `saveSession`, `protectedLoginHandoff`, `reuseSession` and `oracle`; extend the same treatment to the rest."
  },
  {
    id: "RT-10",
    title: "Optional step fields are re-defaulted rather than preserved as absent",
    boundary: "designerMapping",
    status: "observed",
    shapes: ["nodes[].timeoutMs", "nodes[].retry", "nodes[].onFailure", "nodes[].size", "nodes[].description", "nodes[].next"],
    kinds: ["fabricated", "changed"],
    severity: "cosmetic",
    owner: "app/renderer/components/workflow/flowProfileMapping.ts — `fromFlowStep` applies `??` defaults which `toFlowStep` then writes back unconditionally",
    affectedNodeTypes: "All 30.",
    impact:
      "Cosmetic. An absent `timeoutMs` becomes `10000`, an absent `retry` becomes `{count: 0, delayMs: 1000}`, and an absent `description` is replaced by the node catalog's generic text. No behavior changes — these are the same values the runner would have defaulted to — but the persisted document differs from the one that was loaded, so a save always looks like an edit.",
    recommendedFix:
      "Track which fields were absent on load and omit them on save, or accept the normalization deliberately and document it. Worth deciding explicitly: the dirty-state comparison (`serializeFlowDoc`) already has to work around it."
  },
  {
    id: "RT-11",
    title: "`maxLoopCount` is only persisted for `loopBack` edges, and defaulted to 2 when absent",
    boundary: "designerMapping",
    status: "observed",
    shapes: ["edges[].maxLoopCount"],
    kinds: ["lost", "fabricated"],
    severity: "editingFidelity",
    owner: "app/renderer/components/workflow/flowProfileMapping.ts — `toFlowProfile` gates `maxLoopCount` on `linkType === \"loopBack\"`",
    affectedNodeTypes: "Not node-scoped.",
    impact:
      "Editing fidelity in both directions. Demonstrated here: a `loopBack` saved without a `maxLoopCount` silently acquires `2`, so the document changes on a no-op save. The mirror case — a `maxLoopCount` set on a non-`loopBack` connector being discarded — is read from the source but not exercised, because no product path emits one.",
    recommendedFix: "Persist `maxLoopCount` whenever it is set, and let the runtime apply its own default when it is absent."
  },
  {
    id: "RT-12",
    title: "Step `outputs` are rewritten to a single untyped key",
    boundary: "designerMapping",
    status: "observed",
    shapes: ["nodes[].outputs"],
    kinds: ["lost", "changed"],
    severity: "editingFidelity",
    owner:
      "app/renderer/components/workflow/flowProfileMapping.ts — `fromFlowStep` keeps only `Object.keys(step.outputs)[0]`, and `toFlowStep` rebuilds the map as `{ [key]: { type: \"text\" } }`",
    affectedNodeTypes: "Any step declaring outputs — in practice `readText`, `downloadFile`, `oracle`, `screenshot`.",
    impact:
      "Editing fidelity, trending on execution. The designer models outputs as a single string field, so a step declaring several outputs loses all but the first, and each surviving output's declared type is replaced by `\"text\"`. Downstream steps binding to a dropped output key resolve to nothing.",
    recommendedFix:
      "Preserve the full outputs map through the designer node data. If the UI is only ever going to edit one key, still round-trip the rest untouched rather than reconstructing the map from a single field."
  },
  {
    id: "RT-15",
    title: "Type-scoped step fields are dropped when the node type does not match",
    boundary: "designerMapping",
    status: "predicted",
    shapes: ["nodes[].selectionMode", "nodes[].flowId", "nodes[].url", "nodes[].loop", "nodes[].message"],
    kinds: ["lost", "changed"],
    severity: "editingFidelity",
    owner:
      "app/renderer/components/workflow/flowProfileMapping.ts — `toFlowStep` gates `selectionMode`/`flowId`/`url` on `data.stepType`, and `FlowStep.loop`/`message` are not mapped at all",
    affectedNodeTypes: "`selectionMode`→ non-`select`, `flowId`→ non-`runFlow`, `url`→ non-`goto`; `loop`/`message`→ all types.",
    impact:
      "Editing fidelity. Not demonstrated by the current corpus: the generator only emits these fields on the node types that keep them, which is also what the product does today. It becomes reachable for imported or hand-edited profiles.",
    recommendedFix:
      "Type-gating on save is defensible for fields the UI cannot edit for that type. `FlowStep.loop` and `message` are a different case — they are simply unmapped, so map them or document them as designer-unsupported."
  },
  {
    id: "RT-13",
    title: "Dynamic value-source fields are dropped unless their sibling discriminator matches",
    boundary: "designerMapping",
    status: "predicted",
    shapes: ["nodes[].valueSource.dataSourceId", "nodes[].valueSource.objectId"],
    kinds: ["lost"],
    severity: "editingFidelity",
    owner: "app/renderer/components/workflow/flowProfileMapping.ts — `createValueSource` gates `dataSourceId` on `dataSourceScope === \"specific\"` and `objectId` on `idMode === \"explicit\"`",
    affectedNodeTypes: "Any step with a `dynamic` value source.",
    impact:
      "Editing fidelity. Not demonstrated by the current corpus, which only generates `specific`/`explicit` bindings — the combination that keeps both fields. Reachable when a user narrows a binding back to workflow scope, or for an imported profile: the selected data source id is discarded permanently, so switching back does not restore it.",
    recommendedFix: "Retain the inactive field in the persisted source; the resolver keys off the discriminator, so carrying it is inert at run time."
  }
];

/** Catalogued defects the corpus is expected to keep reproducing. */
export const OBSERVED_ROUNDTRIP_DEFECTS: readonly RoundTripDefect[] = KNOWN_ROUNDTRIP_DEFECTS.filter(
  (defect) => defect.status === "observed"
);

/**
 * The defect that explains a diff shape + kind, or `undefined` for an unexpected new failure.
 *
 * A catalog shape matches its own path and everything nested beneath it, so one entry can own a
 * whole object (`nodes[].config` covers all sixteen of its fields). Where several entries could
 * match, the **longest** matched shape wins, so a specific entry always beats a broad one —
 * `nodes[].valueSource.envKey` (RT-14) is chosen over `nodes[].valueSource` (RT-02).
 */
export function findKnownDefect(shape: string, kind: DifferenceKind): RoundTripDefect | undefined {
  let best: { defect: RoundTripDefect; length: number } | undefined;
  for (const defect of KNOWN_ROUNDTRIP_DEFECTS) {
    if (!defect.kinds.includes(kind)) continue;
    for (const candidate of defect.shapes) {
      if (shape !== candidate && !shape.startsWith(`${candidate}.`)) continue;
      if (!best || candidate.length > best.length) best = { defect, length: candidate.length };
    }
  }
  return best?.defect;
}
