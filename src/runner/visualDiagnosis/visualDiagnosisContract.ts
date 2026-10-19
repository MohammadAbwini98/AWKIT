import type { Page } from "playwright";
import type { FlowStep } from "@src/profiles/FlowProfile";
import type { ErrorClass } from "../runtime/ErrorClassifier";
import type { VisualDiagnosisRecord } from "./visualDiagnosisRecord";

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
  /**
   * N5.7 (QC finding 5): what is left of the deadline when the call starts (the lazy loader spends the rest on its first
   * load). The adapter never uses more than its own deadline.
   */
  deadlineMs?: number;
}

/**
 * VD-5: what a diagnosis may say about a step (codes, small counts and a duration), defined in the zero-import record
 * module that the report types share. N5.4: the runner hands each record to `onVisualDiagnosis`, and the engine stores
 * a sanitized copy on the instance report.
 */
export type { VisualDiagnosisRecord } from "./visualDiagnosisRecord";

/** The hook's view of the diagnosis. Settles at or before the deadline and never throws. */
export interface VisualFailureDiagnoser {
  diagnoseFinalFailure(request: VisualDiagnosisRequest): Promise<VisualDiagnosisRecord | undefined>;
}
