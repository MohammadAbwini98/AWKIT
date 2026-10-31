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

/**
 * The N5 deadline fix (2026-11-01). Synchronous pixel work (N0's PNG decode, crops, fingerprints, N8 and N9 features)
 * blocks the event loop, so a deadline timer can only fire once that work yields. The hard deadline is therefore never
 * the timer's own instant: the adapter settles at a WORK BUDGET that ends this margin earlier (at most a quarter of the
 * deadline), every synchronous phase starts only behind a checkpoint that yields to timers and checks the monotonic
 * clock, and a result computed past the budget is never published (it becomes `budget-exhausted`). The margin bounds
 * the one synchronous chunk that cannot be split (a screenshot's decode inside N0).
 */
export const VISUAL_DIAGNOSIS_SETTLE_MARGIN_MS = 100;
/** A synchronous phase starts only with at least this much of the work budget left. */
export const VISUAL_DIAGNOSIS_SYNC_RESERVE_MS = 50;
/**
 * Measured cost of the synchronous pixel phases per device pixel (`benchmark:visual-sync-cost`, 2026-11-01, Windows 11
 * ARM64 running x64 Node under emulation): crop plus fingerprint reached 72 to 190 ns/px at its maximum outside one
 * isolated pause. A phase over a whole frame starts only when the budget left covers its estimate at this rate.
 */
export const VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL = 200;

/** The budget a synchronous phase over `pixels` device pixels must have left before it starts. */
export function visualDiagnosisSyncReserveMs(pixels: number): number {
  return Math.max(VISUAL_DIAGNOSIS_SYNC_RESERVE_MS, Math.ceil((Math.max(0, pixels) * VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL) / 1e6));
}

/** The work budget for a hard deadline: when the adapter settles, at or before the deadline minus its margin. */
export function visualDiagnosisWorkBudget(deadlineMs: number, marginMs = VISUAL_DIAGNOSIS_SETTLE_MARGIN_MS): number {
  return Math.max(1, Math.round(deadlineMs - Math.min(Math.max(0, marginMs), Math.floor(deadlineMs / 4))));
}

/**
 * N9 (awkit-vra.11, NS-2): `AWKIT_VISUAL_STATE=on` adds screenshot state evidence to an N5 diagnosis. It does nothing
 * unless `AWKIT_VISUAL_DIAGNOSIS=on`; anything else, or nothing, is off. Plan:
 * docs/plans/ai-upgrade-v5/N9-screenshot-state-recognition.md.
 */
export function visualStateMode(env: Record<string, string | undefined> = process.env): "on" | "off" {
  return env.AWKIT_VISUAL_STATE === "on" ? "on" : "off";
}

/**
 * N8 (awkit-vra.10, NR-3): `AWKIT_VISUAL_ROWS=on` adds row/grid evidence to an N5 diagnosis. It does nothing unless
 * `AWKIT_VISUAL_DIAGNOSIS=on`. Plan: docs/plans/ai-upgrade-v5/N8-row-grid-intelligence.md.
 */
export function visualRowsMode(env: Record<string, string | undefined> = process.env): "on" | "off" {
  return env.AWKIT_VISUAL_ROWS === "on" ? "on" : "off";
}

/** N8: the row work starts only when at least this much of the deadline is left. */
export const VISUAL_ROWS_MIN_REMAINING_MS = 150;
/** N8: the only codes row evidence may add to a diagnosis record (at most three per record). */
export const VISUAL_ROWS_CODES = [
  "rows-look-alike",
  "rows-distinct",
  "rows-mixed",
  "rows-inconclusive",
  "rows-not-examined",
  "row-association-consistent",
  "row-association-inconclusive",
  "rows-partly-examined"
] as const;

/** N9 NS-D2: the extra diagnosis budget with state recognition on (plan § 6, frozen before qualification). */
export const VISUAL_STATE_EXTRA_MS = 600;
/** N9: the second (motion) frame is taken only when at least this much of the deadline is left. */
export const VISUAL_STATE_MIN_REMAINING_MS = 200;
/** N9: the second frame is taken no sooner than this after the first. */
export const VISUAL_STATE_INTERVAL_MS = 120;
/** N9: the only codes state recognition may add to a diagnosis record (one per record). */
export const VISUAL_STATE_CODES = [
  "visual-state-loading",
  "visual-state-empty",
  "visual-state-error",
  "visual-state-ready",
  "visual-state-unknown",
  "visual-state-skipped"
] as const;
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
