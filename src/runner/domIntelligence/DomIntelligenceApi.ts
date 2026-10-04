/**
 * The renderer ↔ main contract for L11 DOM intelligence (awkit-djnl.19). Pure: no Electron, no I/O.
 *
 * Three channels, all authorized in main:
 *   - `domIntelligence:getStatus`    (page.settings) — what Settings shows;
 *   - `domIntelligence:diagnoseStep` (page.recorder, plus page.flows for a saved flow) — the Element Spy /
 *     Designer read-only diagnosis on the Spy's live page;
 *   - `domIntelligence:checkDrift`   (page.recorder + page.flows) — L12.9, the same diagnosis for every
 *     element step of a saved flow, summarized to one status per step.
 *
 * Nothing crossing this bridge names a URL, a path, a selector to run, HTML or a provider option: a
 * diagnosis request names a saved step or a draft action, and main loads the step itself. Unknown
 * properties are dropped, so a renderer cannot smuggle anything the handler would then trust.
 */

import type { DiagnosisElement, LocatorDiagnosis } from "../LocatorFactory";
import type { DomIntelligenceStatus } from "./DomIntelligenceProvider";

export interface DomIntelligenceStatusView extends DomIntelligenceStatus {
  /** The locator recovery engine in effect for runs (`AWKIT_LOCATOR_RECOVERY_ENGINE=legacy` reverts). */
  recoveryEngine: "snapshot" | "legacy";
  /** The staged runtime ships in this build (status may still be unavailable if it cannot start). */
  runtimeShipped: boolean;
}

export type DomDiagnosisRequest = { source: "flow"; flowId: string; stepId: string } | { source: "draft"; actionId: string };

export type DomDiagnosisFailureCode = "INVALID_REQUEST" | "NO_LIVE_PAGE" | "STEP_NOT_FOUND" | "NO_LOCATOR" | "FAILED";

export type DomDiagnosisResponse =
  | { ok: true; diagnosis: LocatorDiagnosis }
  | { ok: false; code: DomDiagnosisFailureCode; message: string };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** The request with unknown properties dropped and every id bounded, or undefined. */
export function sanitizeDiagnosisRequest(value: unknown): DomDiagnosisRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.source === "flow" && typeof raw.flowId === "string" && ID.test(raw.flowId) && typeof raw.stepId === "string" && ID.test(raw.stepId)) {
    return { source: "flow", flowId: raw.flowId, stepId: raw.stepId };
  }
  if (raw.source === "draft" && typeof raw.actionId === "string" && ID.test(raw.actionId)) {
    return { source: "draft", actionId: raw.actionId };
  }
  return undefined;
}

/**
 * L12.9 pre-run drift check (`domIntelligence:checkDrift`, page.recorder + page.flows): every element step of
 * a saved flow is diagnosed read-only against the Element Spy's live page, and each gets one status.
 */
export type DomDriftRequest = { flowId: string };

export type DomDriftStatus =
  /** The saved locator finds exactly one element. */
  | "ok"
  /** The saved locator misses, but AWKIT's proof (alone or by agreement) would recover the element. */
  | "recoverable"
  /** The saved locator matches several elements. */
  | "ambiguous"
  /** The saved locator misses and nothing would recover it: the step will fail here. */
  | "drifted"
  /** The step belongs to another page, route or a protected surface: not checked on this page. */
  | "not-here";

export interface DomDriftStep {
  stepId: string;
  name: string;
  status: DomDriftStatus;
}

export type DomDriftResponse =
  | { ok: true; steps: DomDriftStep[]; checked: number; skipped: number; ms: number }
  | { ok: false; code: DomDiagnosisFailureCode; message: string };

/** At most this many steps are checked per request. */
export const DRIFT_MAX_STEPS = 200;

export function sanitizeDriftRequest(value: unknown): DomDriftRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return typeof raw.flowId === "string" && ID.test(raw.flowId) ? { flowId: raw.flowId } : undefined;
}

/** One diagnosis to one status. Pure, so the IPC and its verifier share the rule. */
export function classifyDrift(diagnosis: Pick<LocatorDiagnosis, "recorded" | "snapshot" | "provider" | "route">): DomDriftStatus {
  if (diagnosis.route === "mismatch" || diagnosis.provider.reason === "protected-surface") return "not-here";
  if (diagnosis.recorded.status === "resolved") return "ok";
  if (diagnosis.recorded.status === "ambiguous") return "ambiguous";
  if (diagnosis.recorded.status === "error") return "not-here";
  const agreed = diagnosis.provider.candidates.some((candidate) => candidate.proof === "agreed" || candidate.proof === "proven");
  return diagnosis.snapshot?.outcome === "proven" || agreed ? "recoverable" : "drifted";
}

/** Strategies the Designer's locator editor holds as plain fields (the generator never suggests xpath here). */
const EDITOR_STRATEGIES = new Set(["role", "label", "placeholder", "text", "testId", "id", "css", "tagName"]);

/**
 * The Designer's "Use this locator" gate: only for an element AWKIT's own identity proof picked, on a page
 * that is not a protected surface, with a locator the Recorder's generator proved unique on its own and the
 * editor can hold. Anything else (an unproven candidate, a container chain) stays evidence only.
 */
export function isApplicableSuggestion(
  suggestion: DiagnosisElement["locator"] | undefined,
  proven: boolean,
  protectedSurface: boolean
): suggestion is DiagnosisElement["locator"] {
  const quality = suggestion?.quality as { isUnique?: boolean; disambiguation?: string } | undefined;
  return Boolean(
    proven &&
      !protectedSurface &&
      suggestion &&
      EDITOR_STRATEGIES.has(suggestion.strategy) &&
      typeof suggestion.value === "string" &&
      suggestion.value.length > 0 &&
      quality?.isUnique === true &&
      quality.disambiguation !== "container"
  );
}

export const DIAGNOSIS_FAILURE_MESSAGES: Readonly<Record<DomDiagnosisFailureCode, string>> = {
  INVALID_REQUEST: "That diagnosis request is not valid.",
  NO_LIVE_PAGE: "Open the Element Spy on the page this step runs on, then diagnose again.",
  STEP_NOT_FOUND: "That step no longer exists.",
  NO_LOCATOR: "That step has no element locator to diagnose.",
  FAILED: "The diagnosis could not be completed on the current page."
};
