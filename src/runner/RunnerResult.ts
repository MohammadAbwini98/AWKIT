import type { StructuredLog } from "@src/reports/StructuredLog";
import { SecretMasker } from "@src/reports/SecretMasker";
import type { HandoffInfo } from "@src/security/ProtectedLoginHandoff";

export type StepExecutionStatus = "passed" | "failed" | "skipped" | "manualHandoff";

/** Kinds of point-in-time failure evidence captured for a failing attempt (FR-B2). */
export type StepEvidenceKind = "screenshot" | "dom" | "a11y" | "meta";

/**
 * One piece of failure evidence for a single failing attempt (SRS-BAO-001 FR-B2).
 *
 * A file-backed capture carries `path`; a capture that could not be taken (dead/hung page) carries a
 * `note` and no `path` — a **secondary diagnostic** that never replaces the step's real error (B2.5).
 * Every ref is stamped with `attempt`/`pageId`/`capturedAt` so attempt *n* is never confused with
 * *n+1* (B2.2) and the evidence is addressable (B2.3).
 */
export interface StepEvidenceRef {
  kind: StepEvidenceKind;
  /** Absolute path to the evidence file; absent when capture failed (see `note`). */
  path?: string;
  /** Zero-based failing-attempt index this evidence belongs to. */
  attempt: number;
  /** Page identity the evidence was ACTUALLY taken from (`main` or a popup alias) — never a lie. */
  pageId: string;
  /**
   * The page alias the step asked for, present only when it differs from `pageId` (e.g. a popup that
   * was unavailable, so the active page was captured instead). Absent when they match.
   */
  requestedPageId?: string;
  /** ISO timestamp of capture. */
  capturedAt: string;
  /** Secondary diagnostic when a capture could not be taken; never masks the primary error. */
  note?: string;
}

export interface StepExecutionResult {
  stepId: string;
  status: StepExecutionStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outputs: Record<string, unknown>;
  screenshotPath?: string;
  /**
   * Per-attempt failure evidence (FR-B2). Accumulated across every failing attempt of a step, in
   * order; `screenshotPath` stays populated with the *last* screenshot for report/back-compat.
   */
  evidence?: StepEvidenceRef[];
  downloadedFilePath?: string;
  /** Failure-trace zip saved for this attempt (when trace capture is armed). */
  tracePath?: string;
  error?: string;
  /** Optional machine-readable error code for conditional connector routing. */
  errorCode?: string;
  nextStepId?: string;
  /** Semantic outcome for connector routing (e.g. sessionAlreadyExists, sessionCaptured, sessionLoaded). */
  outcome?: string;
  /** Set by Auto Secure Login after a capture: the flow should restart from Start (guarded by a counter). */
  restartRequired?: boolean;
  /** Set when the step paused for a manual / protected-login handoff (no secrets). */
  manualHandoff?: HandoffInfo;
}

export interface FlowExecutionResult {
  flowId: string;
  status: "passed" | "failed" | "manualHandoff";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  steps: StepExecutionResult[];
  outputs: Record<string, unknown>;
  error?: string;
  manualHandoff?: HandoffInfo;
}

export interface ScenarioExecutionResult {
  scenarioId: string;
  executionId: string;
  instanceId: string;
  status: "passed" | "failed" | "manualHandoff";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  flows: FlowExecutionResult[];
  logs: StructuredLog[];
  error?: string;
  manualHandoff?: HandoffInfo;
}

export interface RunnerLogger {
  log(entry: StructuredLog): void;
}

export class MemoryRunnerLogger implements RunnerLogger {
  readonly entries: StructuredLog[] = [];
  private readonly masker = new SecretMasker();

  log(entry: StructuredLog): void {
    this.entries.push({
      ...entry,
      message: this.masker.maskText(entry.message),
      data: entry.data ? this.masker.maskRecord(entry.data) : undefined
    });
  }
}
