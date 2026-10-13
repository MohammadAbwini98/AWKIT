import {
  AGREEMENT_MAX_COMPETITORS,
  FUSION_MAX_COMPETITORS,
  MEASURED_FUSION_POLICY,
  VISUAL_EVIDENCE_MAX_BYTES,
  VISUAL_EVIDENCE_VERSION,
  buildCandidateEvidence,
  captureCandidates,
  decideFusion,
  decideVisualAgreement,
  type FusionInput,
  type FusionVerdict,
  type VisualAgreementInput,
  type VisualAgreementVerdict,
  type VisualEvidence,
  type VisualResult
} from "@src/visual";
import type { FlowStep } from "@src/profiles/FlowProfile";
import type { Page } from "playwright";
import {
  VISUAL_OBSERVATION_BUDGET_MS,
  type LocatorVisualAgreementObservation,
  type LocatorVisualFusion,
  type LocatorVisualPassObservation,
  type LocatorVisualRecoveryObservation
} from "../LocatorFactory";
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
 * at most once per `REFERENCE_REFRESH` (FD-9) — a failed attempt spends the slot too — and from a recovery winner only
 * when there was no reference or the verdict corroborated it. A handed-off page (I5, `handedOff`) is never captured.
 * Never throws; a failed capture only means no verdict or no refresh.
 *
 * N3.3 (awkit-vra.4.3): `agree` is the shadow Visual Locator Recovery observation of a local `below-threshold` refusal
 * (docs/plans/ai-upgrade-v5/N3-visual-locator-recovery.md). Still observes, never decides: N3 closed shadow-only.
 */

/**
 * I8 / FD-5: the whole visual cycle of one decision. `LocatorFactory` enforces it around the entire observation
 * (reference read, capture, verdict, refresh) and aborts `observation.signal` on expiry; the capture inside gets
 * whatever is left of it.
 */
export const VISUAL_FUSION_BUDGET_MS = VISUAL_OBSERVATION_BUDGET_MS;

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
  /**
   * I5: true while `page` is handed off to the user or guarded as a protected surface (manual action, protected-login
   * handoff, a protected step). Required, synchronous and fail-closed: a throw or anything but `false` means handed off,
   * so nothing is captured and no reference is written.
   */
  handedOff: (page: Page) => boolean;
  /** Where a shadow verdict goes. Called at most once per observed recovery; a throwing sink is ignored. */
  onVerdict?: (record: VisualFusionVerdictRecord) => void;
  budgetMs?: number;
  /** Verifier override; production builds the store from `folder`. */
  store?: VisualReferenceStore;
  /**
   * N3.3 (VR-8): the requested `AWKIT_VISUAL_RECOVERY` mode; absent (the default) means agreement is off and `agree`
   * answers nothing. N3 closed shadow-only (N3.2 fallback, N3.4 deferred), so `enforce` is decided as `shadow`: the
   * verdict's `effect` is always "none" and the step is never changed.
   */
  agreement?: "shadow" | "enforce";
  /** Where a shadow agreement verdict goes. Called at most once per observed refusal; a throwing sink is ignored. */
  onAgreement?: (record: VisualAgreementRecord) => void;
}

/** N3.3: what a shadow agreement verdict may say about a step: codes only, never pixels, bounds, digests or locators. */
export interface VisualAgreementRecord {
  stepId: string;
  mode: "shadow";
  requested: "shadow" | "enforce";
  eligibility: VisualAgreementInput["eligibility"];
  outcome: VisualAgreementVerdict["outcome"];
  reason: VisualAgreementVerdict["reason"];
  effect: VisualAgreementVerdict["effect"];
}

/** Stands in for the best's capture while rows A1-A3 are decided without capturing anything; those rows never read it. */
const NOT_CAPTURED: VisualAgreementInput["best"] = { available: false, code: "CAPTURE_UNAVAILABLE" };

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
      const remaining = this.deadline();
      const reference = await this.reference(scopeKey);
      if (observation.signal.aborted) return undefined;
      // Without a reference the verdict is R1 `no-reference` whatever the competitors look like: capture the winner only,
      // for the refresh below.
      const competitors = reference === null ? [] : observation.competitors.slice(0, FUSION_MAX_COMPETITORS);
      // A handed-off page is refused by the capture's own I5 guard (`HANDED_OFF`), so the verdict is R2 and nothing refreshes.
      const fanout = await captureCandidates(
        observation.page,
        [{ id: "winner", target: observation.locator }, ...competitors.map((competitor, index) => ({ id: `competitor-${index}`, target: competitor.locator }))],
        { timeoutMs: remaining(), signal: observation.signal, stepType: step.type, handedOff: this.handedOff(observation.page) }
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
      // A recovery winner becomes the reference only when there was none yet or the existing one corroborated it: a
      // contested or contradicted winner must not overwrite the last-known-good look it disagreed with.
      const refreshable = reference === null || verdict.outcome === "corroborated";
      if (eligibility === "eligible" && "fingerprint" in winner && refreshable && !observation.signal.aborted) await this.store.refresh(scopeKey, winner);
      return verdictRecord;
    } catch {
      // Shadow mode: an observation that fails is simply not recorded.
      return undefined;
    }
  }

  /**
   * N3.3: the shadow visual-agreement verdict on a local `below-threshold` refusal, or undefined when agreement is off or
   * the observation failed. Rows A1-A3 are decided before anything is captured; then the DOM best and up to
   * `AGREEMENT_MAX_COMPETITORS` other candidates are captured from ONE screenshot and `decideVisualAgreement` decides.
   * SHADOW ONLY: the policy is always asked in `shadow`, so `effect` is "none". J7: never refreshes the reference.
   */
  async agree(observation: LocatorVisualAgreementObservation): Promise<VisualAgreementRecord | undefined> {
    const requested = this.options.agreement;
    if (requested !== "shadow" && requested !== "enforce") return undefined;
    try {
      const { step, sensitive, signal } = observation;      // VR-5 / J8: element steps only, never sensitive; a handed-off page is refused by the capture's own guard.
      const eligibility: VisualAgreementInput["eligibility"] = ELIGIBLE_STEPS.has(step.type) && !sensitive ? "eligible" : "ineligible";
      const base = {
        mode: "shadow" as const,
        eligibility,
        dom: { refusal: observation.refusal, best: observation.best, margin: observation.margin, competitorCount: observation.competitorCount }
      };
      let verdict = decideVisualAgreement({ ...base, reference: null, best: NOT_CAPTURED, competitors: [] });
      if (verdict.reason === "no-reference") {
        const remaining = this.deadline();
        const reference = await this.reference(observation.scopeKey);
        if (signal.aborted) return undefined;
        if (reference !== null && (reference as { available?: unknown }).available !== false) {
          const competitors = observation.competitors.slice(0, AGREEMENT_MAX_COMPETITORS);
          const fanout = await captureCandidates(
            observation.page,
            [{ id: "best", target: observation.locator }, ...competitors.map((target, index) => ({ id: `competitor-${index}`, target }))],
            { timeoutMs: remaining(), signal, stepType: step.type, handedOff: this.handedOff(observation.page) }
          );
          if (signal.aborted) return undefined;
          let best: VisualAgreementInput["best"];
          let captured: VisualAgreementInput["competitors"] = [];
          if (!fanout.ok) {
            best = { available: false, code: fanout.code };
          } else {
            const [own, ...others] = buildCandidateEvidence(fanout.value).candidates;
            best = toInput(own.evidence);            // VR-4: an offscreen or failed competitor stays in, so the policy refuses rather than ignoring it.
            captured = others.map((candidate) => toInput(candidate.evidence));
          }
          verdict = decideVisualAgreement({ ...base, reference, best, competitors: captured });
        } else {
          verdict = decideVisualAgreement({ ...base, reference, best: NOT_CAPTURED, competitors: [] });
        }
      }
      const agreementRecord: VisualAgreementRecord = {
        stepId: step.id,
        mode: "shadow",
        requested,
        eligibility,
        outcome: verdict.outcome,
        reason: verdict.reason,
        effect: verdict.effect
      };
      try {
        this.options.onAgreement?.(agreementRecord);
      } catch {
        // A sink is a recorder, not a participant.
      }
      // Deliberately no `store.refresh` here (J7): an agreement observation never writes the reference.
      return agreementRecord;
    } catch {
      // Shadow mode: an observation that fails is simply not recorded.
      return undefined;
    }
  }

  async observePass(observation: LocatorVisualPassObservation): Promise<void> {
    const { step, sensitive, scopeKey } = observation;
    // I5: a handed-off page is never captured, and does not spend the refresh slot.
    if (visualFusionEligibility(step, sensitive) !== "eligible" || !this.store.dueForRefresh(scopeKey) || this.handedOff(observation.page)) return;
    let refreshed = false;
    try {
      const fanout = await captureCandidates(observation.page, [{ id: "winner", target: observation.locator }], {
        timeoutMs: this.budgetMs,
        signal: observation.signal,
        stepType: step.type,
        handedOff: this.handedOff(observation.page)
      });
      if (!fanout.ok || observation.signal.aborted) return;
      const [own] = buildCandidateEvidence(fanout.value).candidates;
      if (own?.evidence.ok) {
        refreshed = true;
        await this.store.refresh(scopeKey, own.evidence.value);
      }
    } catch {
      // A missed refresh only leaves the previous reference in place.
    } finally {
      // A failed, refused or overrun capture still spends the slot, so a failing step is not re-captured every pass.
      if (!refreshed) this.store.holdRefresh(scopeKey);
    }
  }

  /** I5, fail-closed: only an explicit `false` lets a capture run. */
  private handedOff(page: Page): boolean {
    try {
      return this.options.handedOff(page) !== false;
    } catch {
      return true;
    }
  }

  /** Milliseconds left of this observation's budget for the capture (at least 1, so the capture's own timer still runs). */
  private deadline(): () => number {
    const end = Date.now() + this.budgetMs;
    return () => Math.max(1, end - Date.now());
  }

  /** R1/R2 input for the step's stored reference: absent or unreadable is null; another evidence version is R2. */
  private async reference(scopeKey: string): Promise<FusionInput["reference"]> {
    const read = await this.store.get(scopeKey);
    if (read.status === "found") return read.evidence as VisualEvidence;
    if (read.status === "version-mismatch") return { available: false, code: "UNSUPPORTED_FINGERPRINT_VERSION" };
    return null;
  }
}
