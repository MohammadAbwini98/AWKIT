/**
 * The renderer ↔ main contract for L11 DOM intelligence (awkit-djnl.19). Pure: no Electron, no I/O.
 *
 * Two channels, both authorized in main:
 *   - `domIntelligence:getStatus`    (page.settings) — what Settings shows;
 *   - `domIntelligence:diagnoseStep` (page.recorder, plus page.flows for a saved flow) — the Element Spy /
 *     Designer read-only diagnosis on the Spy's live page.
 *
 * Nothing crossing this bridge names a URL, a path, a selector to run, HTML or a provider option: a
 * diagnosis request names a saved step or a draft action, and main loads the step itself. Unknown
 * properties are dropped, so a renderer cannot smuggle anything the handler would then trust.
 */

import type { LocatorDiagnosis } from "../LocatorFactory";
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

export const DIAGNOSIS_FAILURE_MESSAGES: Readonly<Record<DomDiagnosisFailureCode, string>> = {
  INVALID_REQUEST: "That diagnosis request is not valid.",
  NO_LIVE_PAGE: "Open the Element Spy on the page this step runs on, then diagnose again.",
  STEP_NOT_FOUND: "That step no longer exists.",
  NO_LOCATOR: "That step has no element locator to diagnose.",
  FAILED: "The diagnosis could not be completed on the current page."
};
