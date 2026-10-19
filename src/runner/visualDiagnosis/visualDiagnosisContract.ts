import type { Page } from "playwright";
import type { FlowStep } from "@src/profiles/FlowProfile";
import type { ErrorClass } from "../runtime/ErrorClassifier";

/**
 * N5.3 (awkit-vra.14.3): the runner-side contract of Visual Failure Diagnosis. PURE TYPES AND CONSTANTS: it imports no
 * `src/visual` code, so `FlowExecutor`, `PlaywrightRunner` and (from N5.4) the report types can share it without
 * reaching `src/visual` (`verify:visual-isolation`). Plan: docs/plans/ai-upgrade-v5/N5-visual-failure-diagnosis.md,
 * owner decisions VD-0 to VD-11 (DECISIONS.md 2026-10-19).
 */

/** VD-7: `AWKIT_VISUAL_DIAGNOSIS=on` turns the diagnosis on; anything else, or nothing, is off. */
export function visualDiagnosisMode(env: Record<string, string | undefined> = process.env): "on" | "off" {
  return env.AWKIT_VISUAL_DIAGNOSIS === "on" ? "on" : "off";
}

/** VD-8: the provisional per-failure deadline (fixed by N5.6 measurement). */
export const VISUAL_DIAGNOSIS_DEADLINE_MS = 1000;
/** VD-8: at most this many diagnoses per (execution, flow, step, failure kind); the rest record `coalesced`. */
export const VISUAL_DIAGNOSIS_SIGNATURE_CAP = 20;

/** VD-2: the failure kinds a diagnosis may describe. */
export type VisualDiagnosisFailureKind = "locator" | "timeout" | "assertion" | "other";

/**
 * VD-2: the retry policy's error class as a failure kind, or the refusal a non-diagnosable class answers. A cancelled
 * or handed-off run is never diagnosed, and a dead page or browser has nothing to look at.
 */
export function visualDiagnosisFailureKind(errorClass: ErrorClass): VisualDiagnosisFailureKind | "not-eligible" | "page-closed" {
  switch (errorClass) {
    case "locator":
      return "locator";
    case "timeout":
      return "timeout";
    case "business-rule":
      return "assertion";
    case "cancelled":
    case "manual-action-required":
    case "auth-expired":
    case "profile-locked":
      return "not-eligible";
    case "browser-crash":
    case "context-closed":
    case "page-closed":
      return "page-closed";
    default:
      return "other";
  }
}

/** What the hook hands the adapter after the final attempt failed. Nothing in it can reach the step's result. */
export interface VisualDiagnosisRequest {
  step: FlowStep;
  /** The final attempt's index (0-based). */
  attempt: number;
  errorClass: ErrorClass;
  executionId: string;
  scenarioId: string;
  flowId: string;
  /** The step's own page, or null when it is gone. Never a fallback page. */
  page: () => Promise<Page | null>;
  /** Runs one screenshot-class operation under the runner's screenshot limiter. */
  limitScreenshot: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * VD-5: what a diagnosis may say about a step: codes, small counts and a duration. No pixels, fingerprints, digests,
 * selectors, URLs, coordinates or page text. N5.3 sends it to a codes-only log sink; N5.4 stores a sanitized copy.
 */
export interface VisualDiagnosisRecord {
  version: 1;
  stepId: string;
  attempt: number;
  failureKind: VisualDiagnosisFailureKind | "none";
  outcome: "refused" | "observed";
  conditions: "none" | "different" | "unproven" | "equal-proven";
  observations: string[];
  referenceSource: "runtime" | "recorded" | "none";
  examined: number;
  domNamed: number;
  truncated: boolean;
  identicalOthers?: "1" | "2+";
  ms: number;
}

/** The hook's view of the diagnosis. Settles at or before the deadline and never throws. */
export interface VisualFailureDiagnoser {
  diagnoseFinalFailure(request: VisualDiagnosisRequest): Promise<VisualDiagnosisRecord | undefined>;
}

/** A codes-only one-line summary for the N5.3 log sink. Never page-derived text. */
export function describeVisualDiagnosis(record: VisualDiagnosisRecord): string {
  const scope = `examined ${record.examined} of ${record.domNamed}${record.truncated ? ", truncated" : ""}`;
  return `Visual diagnosis (advisory, no effect): ${record.outcome} [${record.observations.join(", ")}] conditions ${record.conditions}, reference ${record.referenceSource}, ${scope}.`;
}
