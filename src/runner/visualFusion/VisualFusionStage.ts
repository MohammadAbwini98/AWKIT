import {
  FUSION_MAX_COMPETITORS,
  MEASURED_FUSION_POLICY,
  VISUAL_EVIDENCE_MAX_BYTES,
  VISUAL_EVIDENCE_VERSION,
  buildCandidateEvidence,
  captureCandidates,
  decideFusion,
  type FusionInput,
  type FusionVerdict,
  type VisualEvidence,
  type VisualResult
} from "@src/visual";
import type { FlowStep } from "@src/profiles/FlowProfile";
import type { LocatorVisualFusion, LocatorVisualPassObservation, LocatorVisualRecoveryObservation } from "../LocatorFactory";
import { VisualReferenceStore } from "./VisualReferenceStore";

/**
 * N2.5 (awkit-vra.12.5): the visual-fusion stage of locator recovery, in SHADOW mode. The ONLY runner module allowed
 * to import `src/visual` (FD-2, `verify:visual-isolation`), and only through its public index. Injected into
 * `LocatorFactory` as `LocatorFactoryOptions.visualFusion`, the way `domIntelligence` is; absent, nothing here runs.
 * Plan: docs/plans/ai-upgrade-v5/N2-dom-vision-evidence-fusion.md › Architecture.
 *
 * OBSERVES, NEVER DECIDES. It receives the DOM's final recovery winner (after the twin, container and actionability
 * vetoes) and up to three gated-out DOM competitors, captures them from ONE screenshot, asks `decideFusion` for a
 * verdict, hands it to `onVerdict` and returns it. N2.7: `LocatorFactory` copies only the returned codes and rounded
 * scores into that attempt's `recovery-trace` (`visual`); stages, winner memory and the resolved element are those of a
 * run without it (I3). In N2 the mode is fixed to `shadow` and `MEASURED_FUSION_POLICY.contradictionEnabled` is false,
 * so `effect` is always "none".
 *
 * Also refreshes the step's last-known-good reference after a passing resolve of an eligible, non-sensitive step,
 * at most once per `REFERENCE_REFRESH` (FD-9). Never throws; a failed capture only means no verdict or no refresh.
 */

/** I8 / FD-5: the whole visual cycle of one decision, screenshot to verdict. */
export const VISUAL_FUSION_BUDGET_MS = 400;

/** FD-6: the element steps whose recovery winners fusion may observe. */
const ELIGIBLE_STEPS: ReadonlySet<string> = new Set(["click", "dblclick", "contextMenu", "clickAndHold", "fill", "select", "check", "uncheck", "radio"]);

type Eligibility = FusionInput["eligibility"];
type EvidenceInput = FusionInput["winner"];

/** I9: what a shadow verdict may say about a step — verdict, reason and rounded scores; never pixels, bounds or digests. */
export interface VisualFusionVerdictRecord {
  stepId: string;
  mode: "shadow";
  layer: FusionInput["dom"]["layer"];
  eligibility: Eligibility;
  outcome: FusionVerdict["outcome"];
  reason: FusionVerdict["reason"];
  effect: FusionVerdict["effect"];
  evidence: FusionVerdict["evidence"];
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function record(stepId: string, layer: VisualFusionVerdictRecord["layer"], eligibility: Eligibility, verdict: FusionVerdict): VisualFusionVerdictRecord {
  const { winnerScore, bestCompetitorScore, visualMargin, identical } = verdict.evidence;
  const evidence: FusionVerdict["evidence"] = {};
  if (winnerScore !== undefined) evidence.winnerScore = round3(winnerScore);
  if (bestCompetitorScore !== undefined) evidence.bestCompetitorScore = round3(bestCompetitorScore);
  if (visualMargin !== undefined) evidence.visualMargin = round3(visualMargin);
  if (identical !== undefined) evidence.identical = identical;
  return { stepId, mode: "shadow", layer, eligibility, outcome: verdict.outcome, reason: verdict.reason, effect: verdict.effect, evidence };
}

export interface VisualFusionStageOptions {
  /** `<runtime root>/visual-references`. */
  folder: string;
  /** Where a shadow verdict goes. Called at most once per observed recovery; a throwing sink is ignored. */
  onVerdict?: (record: VisualFusionVerdictRecord) => void;
  budgetMs?: number;
  /** Verifier override; production builds the store from `folder`. */
  store?: VisualReferenceStore;
}

/** The evidence's own content digest, the store's change detector. */
function digestOf(value: unknown): string | null {
  const digest = (value as VisualEvidence | null)?.fingerprint?.contentDigest;
  return typeof digest === "string" ? digest : null;
}

function toInput(result: VisualResult<VisualEvidence>): EvidenceInput {
  return result.ok ? result.value : { available: false, code: result.code };
}

export function visualFusionEligibility(step: Pick<FlowStep, "type">, sensitive: boolean): Eligibility {
  if (!ELIGIBLE_STEPS.has(step.type)) return "ineligible";
  return sensitive ? "shadow-only" : "eligible";
}

export class VisualFusionStage implements LocatorVisualFusion {
  readonly mode = "shadow" as const;
  private readonly store: VisualReferenceStore;
  private readonly budgetMs: number;

  constructor(private readonly options: VisualFusionStageOptions) {
    this.store =
      options.store ??
      new VisualReferenceStore({ folder: options.folder, evidenceVersion: VISUAL_EVIDENCE_VERSION, maxEvidenceBytes: VISUAL_EVIDENCE_MAX_BYTES, digestOf });
    this.budgetMs = options.budgetMs ?? VISUAL_FUSION_BUDGET_MS;
  }

  /** The verdict record, or undefined for an ineligible step or a failed observation. */
  async observeRecovery(observation: LocatorVisualRecoveryObservation): Promise<VisualFusionVerdictRecord | undefined> {
    try {
      const { step, sensitive, scopeKey } = observation;
      const eligibility = visualFusionEligibility(step, sensitive);
      if (eligibility === "ineligible") return undefined;
      const reference = await this.reference(scopeKey);
      // Without a reference the verdict is R1 `no-reference` whatever the competitors look like: capture the winner only,
      // for the refresh below.
      const competitors = reference === null ? [] : observation.competitors.slice(0, FUSION_MAX_COMPETITORS);
      const fanout = await captureCandidates(
        observation.page,
        [{ id: "winner", target: observation.locator }, ...competitors.map((competitor, index) => ({ id: `competitor-${index}`, target: competitor.locator }))],
        { timeoutMs: this.budgetMs, stepType: step.type, handedOff: false }
      );
      let winner: EvidenceInput;
      const kept: { score: number; evidence: EvidenceInput }[] = [];
      if (!fanout.ok) {
        winner = { available: false, code: fanout.code };
      } else {
        const [own, ...others] = buildCandidateEvidence(fanout.value).candidates;
        winner = toInput(own.evidence);
        others.forEach((candidate, index) => {
          // FD-7: competitors are compared in the viewport only; capture never scrolls one into view.
          if (!candidate.evidence.ok && candidate.evidence.code === "TARGET_OFFSCREEN") return;
          kept.push({ score: competitors[index].score, evidence: toInput(candidate.evidence) });
        });
      }
      const verdict = decideFusion(
        {
          mode: this.mode,
          eligibility,
          dom: { layer: observation.layer, winner: { score: observation.score }, competitors: kept.map(({ score }) => ({ score })), margin: observation.margin },
          reference,
          winner,
          competitors: kept.map(({ evidence }) => evidence)
        },
        MEASURED_FUSION_POLICY
      );
      const verdictRecord = record(step.id, observation.layer, eligibility, verdict);
      try {
        this.options.onVerdict?.(verdictRecord);
      } catch {
        // A sink is a recorder, not a participant.
      }
      if (eligibility === "eligible" && "fingerprint" in winner) await this.store.refresh(scopeKey, winner);
      return verdictRecord;
    } catch {
      // Shadow mode: an observation that fails is simply not recorded.
      return undefined;
    }
  }

  async observePass(observation: LocatorVisualPassObservation): Promise<void> {
    try {
      const { step, sensitive, scopeKey } = observation;
      if (visualFusionEligibility(step, sensitive) !== "eligible" || !this.store.dueForRefresh(scopeKey)) return;
      const fanout = await captureCandidates(observation.page, [{ id: "winner", target: observation.locator }], {
        timeoutMs: this.budgetMs,
        stepType: step.type,
        handedOff: false
      });
      if (!fanout.ok) return;
      const [own] = buildCandidateEvidence(fanout.value).candidates;
      if (own?.evidence.ok) await this.store.refresh(scopeKey, own.evidence.value);
    } catch {
      // A missed refresh only leaves the previous reference in place.
    }
  }

  /** R1/R2 input for the step's stored reference: absent or unreadable is null; another evidence version is R2. */
  private async reference(scopeKey: string): Promise<FusionInput["reference"]> {
    const read = await this.store.get(scopeKey);
    if (read.status === "found") return read.evidence as VisualEvidence;
    if (read.status === "version-mismatch") return { available: false, code: "UNSUPPORTED_FINGERPRINT_VERSION" };
    return null;
  }
}
