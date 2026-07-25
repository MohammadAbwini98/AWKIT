/**
 * Catalog of **known** round-trip defects.
 *
 * Phase 3 of the Randomized Automation Test Lab began as a discovery run: the designer mapping lost
 * data on save, and this catalog recorded each loss so every future run could answer:
 *
 *   "Is this a defect we already know about, or did something new break?"
 *
 * ## Current state — the baseline is clean
 *
 * All thirteen catalogued defects (RT-01…RT-15) have been fixed in the designer mapping
 * (`app/renderer/components/workflow/flowProfileMapping.ts`) and their entries deleted per the rule
 * below. The corpus now round-trips **losslessly**, so the catalog is empty and serves purely as a
 * regression guard: any difference the verifier observes now matches no entry and is therefore
 * reported as an **UNEXPECTED NEW FAILURE**.
 *
 * ## Rules
 *
 * - An entry here does **not** suppress an assertion. `verify-random-roundtrip.mts` still fails on any
 *   difference. Cataloguing changes how a difference is *reported*, never whether it is reported.
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

/**
 * The catalog is empty: every round-trip defect discovered by Phase 3 has been fixed and its entry
 * deleted. Restoring an entry only makes sense if a *new* class of loss is discovered and knowingly
 * accepted as a baseline — which should be rare, and never a way to silence a regression.
 *
 * Fixed and deleted: RT-01, RT-03, RT-04, RT-05, RT-06, RT-07, RT-08, RT-09, RT-10, RT-11, RT-12
 * (observed) and RT-13, RT-15 (predicted, then exercised by the generator and confirmed lossless).
 * RT-14/RT-02 were fixed in an earlier change (value-source flattening + secret-source loss).
 */
export const KNOWN_ROUNDTRIP_DEFECTS: readonly RoundTripDefect[] = [];

/** Catalogued defects the corpus is expected to keep reproducing. */
export const OBSERVED_ROUNDTRIP_DEFECTS: readonly RoundTripDefect[] = KNOWN_ROUNDTRIP_DEFECTS.filter(
  (defect) => defect.status === "observed"
);

/**
 * The defect that explains a diff shape + kind, or `undefined` for an unexpected new failure.
 *
 * A catalog shape matches its own path and everything nested beneath it, so one entry can own a
 * whole object (`nodes[].config` covers all of its fields). Where several entries could match, the
 * **longest** matched shape wins, so a specific entry always beats a broad one. With an empty
 * catalog every difference resolves to `undefined` and is reported as an unexpected new failure.
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
