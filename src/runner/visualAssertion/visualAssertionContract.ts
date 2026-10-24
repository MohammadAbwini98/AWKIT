/**
 * The runner-side contract of N6 visual assertions (Phase N, N6.4 / awkit-vra.15.4). Plan:
 * docs/plans/ai-upgrade-v5/N6-visual-assertions.md, "Flag, step mode and build availability" and the step outcome
 * matrices, VA-0, VA-8, VA-9, VA-16.
 *
 * This module never imports `src/visual` (`verify:visual-isolation`): with the flag off, an `assertVisual` step is
 * decided here without loading the adapter. Three independent inputs decide a step, and none rewrites another:
 *
 *  - the FEATURE FLAG (`AWKIT_VISUAL_ASSERTIONS` = off | observe | enforce; default off),
 *  - the authored STEP MODE (observe | enforce),
 *  - BUILD AVAILABILITY (packaged = no enforcement at all; non-packaged = experimental, with a valid grant).
 *
 * In packaged production an authored enforce step ALWAYS fails `visual-unverified/enforce-unavailable-in-production`,
 * whatever the flag, a saved setting, an imported flow or any grant says; grants are never even read there.
 */

import { platform, release } from "node:os";

import type { Locator, Page } from "playwright";
import type { FlowStep } from "../../profiles/FlowProfile";

export type VisualAssertionFlag = "off" | "observe" | "enforce";
export type VisualAssertionAppMode = "packaged" | "dev";
export type VisualAssertionStepMode = "observe" | "enforce";
export type VisualAssertionVerdict = "passed" | "failed" | "inconclusive";
export type VisualAssertionFailureClass = "visual-mismatch" | "visual-unverified";
export type VisualGrantStatus = "valid" | "missing" | "invalidated" | "expired";

/** VA-9: the whole-assertion deadline. */
export const VISUAL_ASSERTION_DEADLINE_MS = 2000;

/** The operator flag; anything but `observe` or `enforce`, or nothing, is off. */
export function visualAssertionFlag(env: NodeJS.ProcessEnv = process.env): VisualAssertionFlag {
  const value = env.AWKIT_VISUAL_ASSERTIONS;
  return value === "observe" || value === "enforce" ? value : "off";
}

/** The `osBuild` condition and grant binding: the platform and the full OS release. */
export function visualAssertionOsBuild(): string {
  return `${platform()}-${release()}`;
}

/** The authored mode; a missing mode is observe (the safe default). The validator refuses any other value. */
export function visualAssertionStepMode(step: Pick<FlowStep, "mode">): VisualAssertionStepMode {
  return step.mode === "enforce" ? "enforce" : "observe";
}

export interface VisualAssertionPlan {
  /** Whether anything is captured at all. Flag off captures nothing. */
  evaluate: boolean;
  /** Whether the cell's grant is read. Only an enforce step, flag `enforce`, in the non-packaged build. */
  readGrant: boolean;
}

/** What to do before anything is captured. Pure. */
export function planVisualAssertion(appMode: VisualAssertionAppMode, flag: VisualAssertionFlag, stepMode: VisualAssertionStepMode): VisualAssertionPlan {
  // Packaged: an `enforce` flag value only behaves like `observe`; it can never make an enforce step run.
  const effective: VisualAssertionFlag = appMode === "packaged" && flag === "enforce" ? "observe" : flag;
  if (effective === "off") return { evaluate: false, readGrant: false };
  return { evaluate: true, readGrant: appMode === "dev" && stepMode === "enforce" && effective === "enforce" };
}

export interface VisualAssertionDecisionInput {
  appMode: VisualAssertionAppMode;
  flag: VisualAssertionFlag;
  stepMode: VisualAssertionStepMode;
  /** The N6.2 policy verdict, when anything was evaluated. */
  verdict?: { verdict: VisualAssertionVerdict; code: string };
  /** The cell's grant, read only when the plan asked for it. */
  grant?: VisualGrantStatus;
}

export interface VisualAssertionStepStatus {
  status: "passed" | "failed";
  failureClass?: VisualAssertionFailureClass;
  /** The fixed reason: a gate code or the policy's verdict code. */
  code: string;
}

const GRANT_CODES: Record<Exclude<VisualGrantStatus, "valid">, string> = {
  missing: "cell-not-qualified",
  invalidated: "grant-invalidated",
  expired: "grant-expired"
};

/** The step outcome matrices (both builds). Pure; the single place a verdict becomes a step status. */
export function decideVisualAssertionStepStatus(input: VisualAssertionDecisionInput): VisualAssertionStepStatus {
  const { appMode, flag, stepMode, verdict } = input;
  const plan = planVisualAssertion(appMode, flag, stepMode);
  const unverified = (code: string): VisualAssertionStepStatus => ({ status: "failed", failureClass: "visual-unverified", code });

  if (stepMode === "observe") return { status: "passed", code: plan.evaluate ? verdict?.code ?? "evaluation-unavailable" : "disabled" };

  // Enforce step.
  if (appMode === "packaged") return unverified("enforce-unavailable-in-production");
  if (flag === "off") return unverified("disabled");
  if (flag === "observe") return unverified("enforce-not-enabled");
  // Non-packaged, flag enforce: the grant first, then the verdict.
  const grant = input.grant ?? "missing";
  if (grant !== "valid") return unverified(GRANT_CODES[grant]);
  if (!verdict) return unverified("evaluation-unavailable");
  if (verdict.verdict === "passed") return { status: "passed", code: verdict.code };
  if (verdict.verdict === "failed") return { status: "failed", failureClass: "visual-mismatch", code: verdict.code };
  return unverified(verdict.code);
}

/** A failed visual assertion. `onFailure` routing reads the step error as before; the class rides as data. */
export class VisualAssertionFailure extends Error {
  readonly failureClass: VisualAssertionFailureClass;
  readonly code: string;

  constructor(failureClass: VisualAssertionFailureClass, code: string) {
    super(
      failureClass === "visual-mismatch"
        ? `Visual assertion failed (visual-mismatch/${code}): the element differs from its approved baseline.`
        : `Visual assertion unverified (visual-unverified/${code}): equality with the approved baseline was not proven.`
    );
    this.name = "VisualAssertionFailure";
    this.failureClass = failureClass;
    this.code = code;
  }
}

export interface VisualAssertionAssessRequest {
  step: FlowStep;
  flowId: string;
  executionId: string;
  instanceId: string;
  page: Page;
  /** Resolves the step's target. Called only after the handoff and protected-surface checks passed. */
  target: () => Promise<Locator>;
  /** I5, fail-closed: only an explicit `false` lets a capture run. */
  handedOff: boolean;
  /** The run's browser mode, half of the grant cell. */
  renderMode: "headed" | "headless";
  readGrant: boolean;
  deadlineMs: number;
  /** Runs the one screenshot under the run's screenshot limiter. */
  limitScreenshot: <T>(work: () => Promise<T>) => Promise<T>;
  /** The run's cancellation. */
  signal?: AbortSignal;
}

export interface VisualAssertionCell {
  renderMode: "headed" | "headless";
  devicePixelRatio: number;
}

export interface VisualAssertionAssessment {
  verdict: VisualAssertionVerdict;
  code: string;
  grant?: VisualGrantStatus;
  cell?: VisualAssertionCell;
  /** A pending, memory-only candidate was created for approval (N6.5). */
  candidateId?: string;
  durationMs: number;
}

/** The lazily loaded adapter (`VisualAssertionStep`), the fourth approved `src/visual` edge. */
export interface VisualAssertionAssessor {
  assess(request: VisualAssertionAssessRequest): Promise<VisualAssertionAssessment>;
}

/** The codes-only record of one assertion, for the report (N6.7). Never a digest, commitment, selector or image. */
export interface VisualAssertionRecord {
  stepId: string;
  flowId: string;
  mode: VisualAssertionStepMode;
  flag: VisualAssertionFlag;
  appMode: VisualAssertionAppMode;
  status: "passed" | "failed";
  failureClass?: VisualAssertionFailureClass;
  code: string;
  verdict?: VisualAssertionVerdict;
  verdictCode?: string;
  candidate: boolean;
  durationMs: number;
}

/** What the runner hands the step executor. */
export interface VisualAssertionRuntime {
  appMode: VisualAssertionAppMode;
  flag: VisualAssertionFlag;
  renderMode: "headed" | "headless";
  /** Loads the adapter on first use; never called when the flag is off. */
  assessor: () => Promise<VisualAssertionAssessor | undefined>;
  handedOff: (page: Page) => boolean;
  onRecord?: (record: VisualAssertionRecord) => void;
}
