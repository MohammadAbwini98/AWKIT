/**
 * The Intelligent Locator status vocabulary (Phase L, L3 §10), and nothing else.
 *
 * §10 names six badges — Semantic · Guarded · AI suggestion pending proof · AI semantic
 * (capture-/replay-proven) · Suggestion rejected · Auto-promoted (revert) — and the evidence that may
 * be shown on demand behind them. This module is the one place that maps authoritative runtime facts
 * onto that vocabulary, so the Flow Designer, a verifier and any later surface read the same table
 * rather than each inventing prose.
 *
 * Four axes are kept apart on purpose, because collapsing them is how a UI comes to claim something
 * the product never established:
 *
 *   1. **Locator quality** — what the saved locator is, from L2's `classifyLocatorQuality`. It exists
 *      with no AI in the picture at all, and it is what badges Semantic and Guarded report.
 *   2. **Upgrade lifecycle** — what has happened to a proposal: proposed, proven on the page, proven
 *      on replays, refused, superseded, applied. Never derived from quality.
 *   3. **AI runtime availability** — whether a provider could run. Reported as its own line and never
 *      as a locator badge: a missing model is not a fragile locator, a Recorder fault or a failed run.
 *   4. **Authorization** — whether this apply is permitted (`promotable`/`blockedReason`, decided by
 *      the main process, plus the editor's own unsaved-changes deferral).
 *
 * The rules that keep a badge honest, each enforced by a branch below:
 *   - a proposal is never "verified" because it compiled, and never "applied" because it is eligible;
 *   - capture proof is one page, not replay eligibility; replay eligibility is not authorization;
 *   - absent evidence renders as *unavailable*, never as a passed gate;
 *   - a refusal never reads as a success, and a success never reads as an AI repair.
 *
 * Pure, renderer-safe and framework-free: no Electron, no filesystem, no clock, no Playwright.
 */

import type { AppliedLocatorUpgradeView, PendingLocatorUpgradeView } from "./contracts/AiApi";
import {
  locatorContainerChain,
  locatorFrameChain,
  type LocatorCandidate,
  type LocatorContext,
  type PendingProofEvidence
} from "../profiles/FlowProfile";
import { LOCATOR_QUALITY_CLASS_LABEL, type LocatorQualityClassification } from "../recorder/LocatorQualityClass";

/** The six badges L3 §10 defines. Nothing outside this union is a badge. */
export type LocatorBadgeId = "semantic" | "guarded" | "pending-proof" | "ai-semantic" | "rejected" | "promoted";

/**
 * Visual family. `info` is a statement of fact, `ok` an established good outcome, `warn` something
 * that needs a person, `danger` a refusal, `muted` an absence. Tone never carries meaning on its own:
 * every badge also has its own label and `data-locator-badge` id, so nothing depends on colour.
 */
export type LocatorBadgeTone = "ok" | "info" | "warn" | "danger" | "muted";

/**
 * The fine-grained lifecycle state behind the badge. Several map onto one badge — `capture-proven`
 * and `replay-partial` are both "AI semantic", because both have a real browser proof and neither is
 * applied — but each is separately derived, so a verifier (and a screen reader's user, through the
 * sentence beside it) can tell them apart without parsing prose.
 */
export type LocatorStatusStateId =
  /** A locator with no AI proposal and no AI history. */
  | "no-upgrade"
  /** A proposal exists but no browser proof ever ran for it (L3 §5 `unprovable-now`). */
  | "proposed-unproven"
  /** Proven once on the page at capture time; no replay has counted yet. */
  | "capture-proven"
  /** Replays have counted but are below the threshold on runs or on distinct data rows. */
  | "replay-partial"
  /** A replay refused the candidate. Terminal: it can never be applied. */
  | "replay-rejected"
  /** The step changed after the proposal was made, so the proposal no longer describes it. */
  | "stale"
  /** Evidence satisfies the policy and the main process would accept the apply. */
  | "eligible"
  /** Evidence satisfies the policy, but this editor has unsaved changes, so the apply is deferred. */
  | "deferred-editor-dirty"
  /** Evidence satisfies the policy, but the main process refuses this apply (`blockedReason`). */
  | "blocked"
  /** An AI upgrade is the saved locator now. */
  | "applied"
  /**
   * The step itself is one AI never changes — a sensitive action or a protected sign-in surface.
   * Reported ahead of anything about the proposal, because no amount of proof makes it applicable.
   */
  | "forbidden";

export interface LocatorEvidenceRow {
  /** Stable id for the fact, so a check never matches on the sentence. */
  id: string;
  label: string;
  /** Product-authored, non-sensitive. Never page text, model text, a prompt or a typed value. */
  value: string;
  /** The fact is not recorded. Rendered as unavailable — never as a gate that passed. */
  unavailable?: boolean;
}

export interface LocatorStatus {
  badge: LocatorBadgeId;
  /** The §10 badge label, with its qualifier where §10 gives one. */
  label: string;
  tone: LocatorBadgeTone;
  state: LocatorStatusStateId;
  /** One sentence stating what is true now. Never a promise about what will happen. */
  headline: string;
  /** Whether the Apply control is enabled. Main still decides the write. */
  applyOffered: boolean;
  /**
   * Whether an Apply control belongs on screen at all.
   *
   * A refusal that is "not yet" — more replays needed, the editor is dirty, the policy is off —
   * keeps a disabled control, because the action exists and the sentence beside it says what would
   * make it possible. A refusal that is "never" — rejected, stale, or a T3 step — hides it, because
   * a disabled button there advertises an action the product will never take.
   */
  applyVisible: boolean;
}

const BADGE_LABEL: Readonly<Record<LocatorBadgeId, string>> = Object.freeze({
  semantic: "Semantic",
  guarded: "Guarded",
  "pending-proof": "AI suggestion pending proof",
  "ai-semantic": "AI semantic",
  rejected: "Suggestion rejected",
  promoted: "Auto-promoted"
});

/**
 * The badge and sentence for one step.
 *
 * Order matters and encodes the §10 precedence: an applied upgrade describes the locator that is
 * actually saved, so it outranks any proposal still attached to the step; a refusal outranks the
 * proof that came before it; and with no proposal at all the badge falls back to what L2 says the
 * saved locator is. `quality` is the classification of the locator as it stands — with an applied
 * upgrade that is the promoted candidate, which is why `applied` does not read it.
 */
export function resolveLocatorStatus(input: {
  quality: LocatorQualityClassification | undefined;
  pending: PendingLocatorUpgradeView | undefined;
  applied: AppliedLocatorUpgradeView | undefined;
  /** This editor's own unsaved-changes state, which is fresher than any fetched view. */
  editorDirty: boolean;
}): LocatorStatus {
  const { pending, applied } = input;

  if (applied) {
    return {
      badge: "promoted",
      label: applied.tier === "T2" ? "Auto-promoted" : "AI upgrade applied",
      tone: "ok",
      state: "applied",
      headline:
        applied.tier === "T2"
          ? "A proven AI locator replaced the saved one automatically. The previous locator is kept and can be restored."
          : "A proven AI locator replaced the saved one after your approval. The previous locator is kept and can be restored.",
      applyOffered: false,
      applyVisible: false
    };
  }

  if (pending) {
    // T3 first and unconditionally, mirroring `promoteLocatorUpgrade`, which checks it before
    // evidence for the same reason: a sensitive or protected-login step is refused for WHAT IT IS.
    // The dry run reports it whatever the proposal's proof state, so a candidate attached before the
    // step became sensitive — a rename to "Delete row" is enough — can never read as merely "not
    // proven yet", which would imply that more replays would eventually make it applicable.
    if (pending.blockedReason?.startsWith("T3_") === true) {
      return {
        badge: "rejected",
        label: "Suggestion rejected",
        tone: "danger",
        state: "forbidden",
        headline: blockedHeadline(pending.blockedReason),
        applyOffered: false,
        applyVisible: false
      };
    }
    if (pending.state === "stale") {
      return {
        badge: "rejected",
        label: "Suggestion rejected",
        tone: "danger",
        state: "stale",
        headline: "This suggestion was made for an earlier version of the step, so it no longer applies and will not be used.",
        applyOffered: false,
        applyVisible: false
      };
    }
    if (pending.state === "replay-rejected") {
      return {
        badge: "rejected",
        label: "Suggestion rejected",
        tone: "danger",
        state: "replay-rejected",
        headline: "A run found this suggestion did not reach the same element, so it can never be applied.",
        applyOffered: false,
        applyVisible: false
      };
    }
    if (pending.state === "eligible") {
      // Evidence is in. Whether it may be applied is a separate question, answered by main
      // (`promotable`) and by this editor's own unsaved changes — never by the evidence itself.
      if (input.editorDirty) {
        return {
          badge: "ai-semantic",
          label: "AI semantic (replay-proven)",
          tone: "warn",
          state: "deferred-editor-dirty",
          headline: "Verified on enough runs, but this flow has unsaved changes. Save the flow, then apply it.",
          applyOffered: false,
          applyVisible: true
        };
      }
      if (pending.promotable) {
        return {
          badge: "ai-semantic",
          label: "AI semantic (replay-proven)",
          tone: "ok",
          state: "eligible",
          headline: "Verified on enough runs and ready to apply. The saved locator is still the one that runs until you apply it.",
          applyOffered: true,
          applyVisible: true
        };
      }
      return {
        badge: "ai-semantic",
        label: "AI semantic (replay-proven)",
        tone: "warn",
        state: "blocked",
        headline: blockedHeadline(pending.blockedReason),
        applyOffered: false,
        // A T3 step is never upgraded, whatever changes. Offering even a disabled control there
        // would advertise an action the product refuses by design.
        applyVisible: pending.blockedReason?.startsWith("T3_") !== true
      };
    }
    // `pending-replay`: either nothing has replayed yet, or replays are still short of the policy.
    if (pending.proof === "capture-proven") {
      const started = pending.replays > 0 || pending.dataRows > 0;
      return {
        badge: "ai-semantic",
        label: "AI semantic (capture-proven)",
        tone: "info",
        state: started ? "replay-partial" : "capture-proven",
        headline: started
          ? "Proven on the page and on some runs, but not yet on enough runs or distinct data rows to be applied. Runs keep using the saved locator."
          : "Proven once on the page, but not yet on any run. It is not applied and is never executed.",
        applyOffered: false,
        applyVisible: true
      };
    }
    return {
      badge: "pending-proof",
      label: "AI suggestion pending proof",
      tone: "info",
      state: "proposed-unproven",
      headline: "Suggested, but the target could not be checked on the page at the time. It is not applied and is never executed.",
      applyOffered: false,
      applyVisible: true
    };
  }

  const cls = input.quality?.class;
  const weak = cls === "guarded-positional" || cls === "review-required";
  return {
    badge: weak ? "guarded" : "semantic",
    label: cls ? LOCATOR_QUALITY_CLASS_LABEL[cls] : "No locator evidence",
    tone: cls ? (weak ? "warn" : "ok") : "muted",
    state: "no-upgrade",
    headline: cls
      ? weak
        ? "This locator is re-proven or reviewed before it acts. There is no AI suggestion for it."
        : "This locator targets the element by meaning. There is no AI suggestion for it."
      : "This step has no locator evidence to classify.",
    applyOffered: false,
    applyVisible: false
  };
}

/** The badge's own label, for a surface that needs the plain §10 term without the qualifier. */
export const locatorBadgeLabel = (badge: LocatorBadgeId): string => BADGE_LABEL[badge];

function blockedHeadline(reason: PendingLocatorUpgradeView["blockedReason"]): string {
  switch (reason) {
    case "EDITOR_DIRTY":
      return "Verified, but this flow has unsaved changes. Save the flow, then apply it.";
    case "POLICY_REFUSED":
      return "Verified, but local AI is not permitted to change locators with the current settings.";
    case "THRESHOLDS_PROVISIONAL":
      return "Verified, but automatic promotion is off until the proof thresholds are confirmed. You can still apply it yourself.";
    case "BASELINE_NOT_PROMOTABLE":
      return "Verified, but this locator still needs review, so an AI upgrade cannot replace it.";
    case "SUPERSEDED":
      return "A newer suggestion replaced the one this evidence was gathered for. Review the new one.";
    case "STALE":
      return "The step changed after this suggestion was verified, so it cannot be applied.";
    case "T3_SENSITIVE_STEP":
      return "AI never changes the locator of a sensitive action.";
    case "T3_PROTECTED_LOGIN":
      return "AI never changes anything on a protected sign-in surface.";
    case "T3_STEP_UNKNOWN":
      return "AI never changes a locator on a step it cannot inspect.";
    default:
      return "Verified, but it cannot be applied right now.";
  }
}

// ── Evidence on demand (L3 §10) ─────────────────────────────────────────────────────────────────

/**
 * Why the saved locator is classified the way it is: L2's deciding reason first, then context.
 * Product-authored sentences from the quality table — never page content.
 */
export function qualityEvidence(quality: LocatorQualityClassification | undefined): LocatorEvidenceRow[] {
  if (!quality) {
    return [{ id: "quality", label: "Current locator quality", value: "No record-time evidence is stored for this locator.", unavailable: true }];
  }
  return [
    { id: "quality", label: "Current locator quality", value: LOCATOR_QUALITY_CLASS_LABEL[quality.class] },
    ...quality.reasons.map((reason, index) => ({ id: `quality-reason-${reason.code}-${index}`, label: index === 0 ? "Why" : "Also", value: reason.detail }))
  ];
}

/** A locator as one readable line. The value is a selector the user already owns, never model text. */
export function describeCandidate(candidate: LocatorCandidate): string {
  const name = candidate.name ? ` "${candidate.name}"` : "";
  return `${candidate.strategy} ${candidate.value}${name}${candidate.exact ? " (exact)" : ""}`;
}

/** Semantic containers the candidate is scoped by — the "proposed scope" of §10. */
export function describeProposedScope(context: LocatorContext | undefined): string | undefined {
  const containers = locatorContainerChain(context);
  return containers.length ? containers.map((container) => container.type).join(" → ") : undefined;
}

/**
 * Where a proof ran: the frame chain and shadow boundary. This is the part of a context a candidate
 * may never change (`locatorProof`'s own scope comparison), which is why it is reported separately
 * from the semantic containers above.
 */
export function describeProofLocation(context: LocatorContext | undefined): string {
  const frames = locatorFrameChain(context).length;
  const shadow = context?.shadow?.boundary;
  const where = frames === 0 ? "The main page" : frames === 1 ? "One iframe deep" : `${frames} iframes deep`;
  return shadow && shadow !== "none" ? `${where}, inside a ${shadow} shadow root` : where;
}

/**
 * The proposal's evidence: what it would replace, where it was proven, how many elements it matched
 * and whether it reached the same element as the baseline.
 *
 * Every fact comes from a record the trusted pipeline already wrote. Nothing here re-proves anything,
 * and an absent `proofEvidence` reports each gate as *not recorded* rather than assuming it passed:
 * the candidate may predate the field, or no browser proof may ever have run for it.
 */
export function pendingEvidence(pending: PendingLocatorUpgradeView): LocatorEvidenceRow[] {
  const rows: LocatorEvidenceRow[] = [
    { id: "current", label: "Saved locator (still in use)", value: describeCandidate(pending.current) },
    { id: "proposed", label: "Proposed locator", value: describeCandidate(pending.proposed) }
  ];
  const scope = describeProposedScope(pending.proposedContext);
  if (scope) rows.push({ id: "proposed-scope", label: "Proposed scope", value: `Inside ${scope}` });
  rows.push({ id: "proof-location", label: "Proof location", value: describeProofLocation(pending.proposedContext) });
  rows.push(...proofGateEvidence(pending.proofEvidence, pending.proof));
  rows.push({
    id: "replay",
    label: "Replay verification",
    value:
      pending.state === "replay-rejected"
        ? `Refused on a run after ${pending.replays} passing ${plural(pending.replays, "replay", "replays")}.`
        : `${pending.replays} of ${pending.minReplays} passing ${plural(pending.minReplays, "replay", "replays")}, across ${pending.dataRows} of ${pending.minDataRows} distinct data ${plural(pending.minDataRows, "row", "rows")}.`
  });
  if (pending.meaningChange) {
    rows.push({ id: "meaning-change", label: "Meaning change", value: "This changes how the step identifies its target, so it is never applied without your approval." });
  }
  rows.push({
    id: "eligibility",
    label: "Can it be applied",
    value: pending.promotable ? "Yes — the checks the application makes before writing all pass." : `No — ${pending.blockedReason ?? "not yet"}.`
  });
  rows.push({ id: "proposed-at", label: "Suggested", value: formatWhen(pending.createdAt) });
  return rows;
}

/**
 * Gates A–D as recorded. `proof` is the coarse outcome the candidate was stored with; the counts and
 * the identity verdict come from the proof record, which is optional — so this never states a match
 * count it does not have.
 */
function proofGateEvidence(evidence: PendingProofEvidence | undefined, proof: PendingLocatorUpgradeView["proof"]): LocatorEvidenceRow[] {
  if (!evidence) {
    return [
      {
        id: "proof-outcome",
        label: "Browser proof",
        value:
          proof === "capture-proven"
            ? "Proven on the page when it was suggested; the detailed gate record was not kept."
            : "The target could not be checked on the page when this was suggested.",
        unavailable: true
      },
      { id: "match-count", label: "Match count", value: "Not recorded.", unavailable: true },
      { id: "identity", label: "Original-target identity", value: "Not recorded.", unavailable: true }
    ];
  }
  const rows: LocatorEvidenceRow[] = [
    { id: "proof-outcome", label: "Browser proof", value: proof === "capture-proven" ? `Proven on the page (${evidence.code}).` : `Not checked on the page (${evidence.code}).` }
  ];
  rows.push(
    evidence.candidateMatchCount === undefined
      ? { id: "match-count", label: "Match count", value: "Not recorded.", unavailable: true }
      : {
          id: "match-count",
          label: "Match count",
          value: `The proposed locator matched ${evidence.candidateMatchCount} ${plural(evidence.candidateMatchCount, "element", "elements")}${
            evidence.baselineMatchCount === undefined ? "" : `; the saved locator matched ${evidence.baselineMatchCount}`
          }.`
        }
  );
  rows.push({
    id: "identity",
    label: "Original-target identity",
    value:
      evidence.sameElement === "pass"
        ? "The proposed locator reached the same element as the saved one."
        : evidence.sameElement === "fail"
          ? "The proposed locator reached a different element."
          : "Not checked.",
    ...(evidence.sameElement === "not-run" ? { unavailable: true } : {})
  });
  rows.push({
    id: "scope-compat",
    label: "Frame and shadow scope",
    value:
      evidence.scope === "compatible"
        ? "The proposed locator stays in the same frame and shadow scope."
        : evidence.scope === "mismatch"
          ? "The proposed locator would change the frame or shadow scope, which is refused."
          : "Not checked.",
    ...(evidence.scope === "not-checked" ? { unavailable: true } : {})
  });
  return rows;
}

/** Provenance and the retained revert target for an applied upgrade. */
export function appliedEvidence(applied: AppliedLocatorUpgradeView): LocatorEvidenceRow[] {
  return [
    {
      id: "previous",
      label: "Retained previous locator (revert target)",
      value: `${describeCandidate(applied.previous)}${applied.previousQualityClass ? ` · ${LOCATOR_QUALITY_CLASS_LABEL[applied.previousQualityClass]}` : ""}${
        applied.previousGuarded ? " · kept its identity guard" : ""
      }`
    },
    { id: "applied-at", label: "Applied", value: formatWhen(applied.appliedAt) },
    {
      id: "authorization",
      label: "Authorized by",
      value: applied.tier === "T2" ? "Automatically, on proof (T2)." : "You, after reviewing the evidence (T1)."
    },
    { id: "applied-proof", label: "Proof at apply", value: applied.proof === "replay-proven" ? "Proven on replays." : applied.proof === "capture-proven" ? "Proven at capture." : "Proven during repair." },
    { id: "source", label: "Change source", value: applied.source === "ai-repair" ? "Local AI locator repair." : "Local AI semantic upgrade." },
    { id: "model", label: "Model", value: applied.modelId },
    { id: "action", label: "Audit reference", value: applied.actionId },
    {
      id: "revertable",
      label: "Revert",
      value: applied.revertable ? "One click restores the previous locator." : "The locator was edited after this change, so it is no longer restored automatically.",
      ...(applied.revertable ? {} : { unavailable: true })
    }
  ];
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

/** A timestamp the user can read, or the raw value if it is not parseable. Never a path or a host. */
function formatWhen(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : new Date(at).toLocaleString();
}
