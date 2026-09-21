/**
 * Idle flow health sweep (Phase L, L3 §9): the durability audit of saved flows, and the bounded queue
 * of upgrade jobs it proposes.
 *
 * Two answers, deliberately separate, because they have different costs and different audiences:
 *
 *   1. **The durability report** is free. It is `classifyLocatorQuality` over saved profiles plus the
 *      upgrade lifecycle already on each step — no model, no browser, no page, no admission needed.
 *      It is worth surfacing on its own: "41 steps, 7 guarded positional, 2 need review" answers a
 *      question a user has whether or not local AI exists on the machine.
 *   2. **The queue** is what would cost a model call, so it is gated: the sweep runs only when the host
 *      is idle by the same `decideAiAdmission` the job queue uses, and it is capped per sweep.
 *
 * There is no second scheduler and no second policy. Idleness is `decideAiAdmission`; "may this step be
 * touched at all" is `AiAutonomyPolicy` (T3 first, unconditionally); "is this locator weak" is L2's
 * `classifyLocatorQuality`. A proposal the sweep queues still goes through §3–§6 unchanged — this
 * module proposes WHAT to ask about and never what the answer is.
 *
 * Pure: no Electron, no filesystem, no clock beyond what the caller passes, no Playwright.
 */

import { decideAiAdmission, type AiAdmissionOptions, type AiAdmissionView, type AiAdmissionHoldReason } from "./AiAdmission";
import type { FlowProfile, FlowStep } from "../profiles/FlowProfile";
import { locatorBindingMatches } from "../profiles/locatorApproval";
import { classifyLocatorQuality, type LocatorQualityClass } from "../recorder/LocatorQualityClass";
import { decideAiAction, type AiPolicyConfig } from "../security/authz/AiAutonomyPolicy";

/**
 * How many upgrade jobs one sweep may queue.
 *
 * Small on purpose. A sweep is background work behind a locator that already runs, and one job costs up
 * to `LOCATOR_ATTEMPT_LIMITS.maxAttempts` model calls, each bounded by its `timeoutMs` (185 s) and measured
 * at 76–130 s on Qwen3.5-0.8B. Queueing a hundred of them because a flow is large would turn an idle-time
 * courtesy into a workload.
 */
export const LOCATOR_SWEEP_MAX_JOBS = 5;

/** Why a step was not queued. Every scanned step gets exactly one of these or is queued. */
export type LocatorSweepSkipReason =
  /** No locator to classify — a non-targeting step (navigate, wait, a data node). */
  | "NO_LOCATOR"
  /** The locator is already strong enough that a model call is not worth making (L3 §1). */
  | "NOT_WEAK"
  /** T3: a sensitive action or a protected sign-in surface. Never queued, whatever its quality. */
  | "FORBIDDEN"
  /** A candidate is already proposed for this step and is waiting on proof or on the user. */
  | "UPGRADE_PENDING"
  /** An AI upgrade is already the saved locator here. */
  | "ALREADY_UPGRADED"
  /** Eligible and weak, but the sweep's per-sweep cap was already spent. */
  | "CAP_REACHED";

export interface LocatorSweepCandidate {
  flowId: string;
  flowName: string;
  stepId: string;
  stepName: string;
  quality: LocatorQualityClass;
}

export interface LocatorSweepSkip {
  flowId: string;
  stepId: string;
  reason: LocatorSweepSkipReason;
  /** Present when the step had a classifiable locator, so a report can count by class. */
  quality?: LocatorQualityClass;
}

/**
 * The durability report. Counts and ids only — never a locator value, page text or a typed value, so
 * it can cross to the renderer and be rendered as-is.
 */
export interface LocatorDurabilityReport {
  flows: number;
  /** Steps that carry a locator at all. Steps without one are counted in `stepsWithoutLocator`. */
  steps: number;
  stepsWithoutLocator: number;
  byClass: Record<LocatorQualityClass, number>;
  /** Steps whose locator is `guarded-positional` or `review-required` — what §1 calls weak. */
  weak: number;
  /** Weak steps the policy forbids touching (T3). Counted so the report is not silently short. */
  forbidden: number;
  upgradePending: number;
  alreadyUpgraded: number;
  perFlow: Array<{ flowId: string; flowName: string; steps: number; weak: number; forbidden: number }>;
}

export type LocatorSweepResult =
  /** The host was not idle. Nothing was scanned and nothing was queued. */
  | { ran: false; reason: AiAdmissionHoldReason }
  | {
      ran: true;
      report: LocatorDurabilityReport;
      /** At most `cap` steps, in scan order. Each still goes through §3–§6 unchanged. */
      queued: LocatorSweepCandidate[];
      skipped: LocatorSweepSkip[];
      /** Weak, eligible steps the cap left for the next sweep. */
      deferred: number;
      cap: number;
    };

const WEAK: ReadonlySet<LocatorQualityClass> = new Set(["guarded-positional", "review-required"]);

const emptyByClass = (): Record<LocatorQualityClass, number> => ({
  "strong-semantic": 0,
  "acceptable-semantic": 0,
  "guarded-positional": 0,
  "review-required": 0
});

/**
 * Whether this step already has an AI proposal in flight.
 *
 * A pending candidate whose binding no longer matches the step is NOT in flight — the save boundary
 * will drop it, and the step is genuinely unproposed — so it does not shield the step from a sweep.
 */
function upgradeInFlight(step: FlowStep): boolean {
  const pending = step.locator?.pendingUpgrade;
  return pending !== undefined && locatorBindingMatches(pending.binding, step);
}

/**
 * Audit every saved flow, and queue at most `cap` upgrade jobs.
 *
 * The report is produced for every scanned step regardless of the cap, so "how durable are my flows"
 * never depends on how many jobs happened to fit. `deferred` says how many weak steps the cap left
 * behind, which is the number that tells a user whether sweeping again would find more.
 */
export function planFlowHealthSweep(input: {
  flows: readonly FlowProfile[];
  policy: AiPolicyConfig;
  /** The engine's current view. The sweep runs only if inference would be admitted right now. */
  admission: AiAdmissionView;
  admissionOptions: AiAdmissionOptions;
  cap?: number;
}): LocatorSweepResult {
  // Idle-only, by the same rule one inference obeys — not a second notion of "quiet". With
  // `yieldDuringRuns` on (the default) an active or queued run holds the sweep at `RUNS_ACTIVE`.
  const admitted = decideAiAdmission(input.admission, input.admissionOptions);
  if (!admitted.admit) return { ran: false, reason: admitted.reason };

  const cap = Math.max(0, Math.min(input.cap ?? LOCATOR_SWEEP_MAX_JOBS, LOCATOR_SWEEP_MAX_JOBS));
  const queued: LocatorSweepCandidate[] = [];
  const skipped: LocatorSweepSkip[] = [];
  const report: LocatorDurabilityReport = {
    flows: input.flows.length,
    steps: 0,
    stepsWithoutLocator: 0,
    byClass: emptyByClass(),
    weak: 0,
    forbidden: 0,
    upgradePending: 0,
    alreadyUpgraded: 0,
    perFlow: []
  };
  let deferred = 0;

  for (const flow of input.flows) {
    const perFlow = { flowId: flow.id, flowName: flow.name, steps: 0, weak: 0, forbidden: 0 };
    for (const step of flow.nodes) {
      const skip = (reason: LocatorSweepSkipReason, quality?: LocatorQualityClass): void => {
        skipped.push({ flowId: flow.id, stepId: step.id, reason, ...(quality ? { quality } : {}) });
      };
      const quality = classifyLocatorQuality(step.locator)?.class;
      if (!quality) {
        report.stepsWithoutLocator += 1;
        skip("NO_LOCATOR");
        continue;
      }
      report.steps += 1;
      report.byClass[quality] += 1;
      perFlow.steps += 1;

      // T3 FIRST and unconditionally, before weakness, before the cap and before the lifecycle — a
      // sensitive or protected-login step is excluded for what it IS, and counting it as merely
      // "not weak" or "capped" would understate how much of a flow AI will never touch.
      if (decideAiAction("locatorSemanticUpgrade", "locatorChange", { step }, { enabled: true }).decision === "forbidden") {
        report.forbidden += 1;
        if (WEAK.has(quality)) {
          report.weak += 1;
          perFlow.weak += 1;
        }
        perFlow.forbidden += 1;
        skip("FORBIDDEN", quality);
        continue;
      }
      if (step.locator?.locatorProvenance) {
        report.alreadyUpgraded += 1;
        skip("ALREADY_UPGRADED", quality);
        continue;
      }
      if (upgradeInFlight(step)) {
        report.upgradePending += 1;
        skip("UPGRADE_PENDING", quality);
        continue;
      }
      if (!WEAK.has(quality)) {
        skip("NOT_WEAK", quality);
        continue;
      }
      report.weak += 1;
      perFlow.weak += 1;
      if (queued.length >= cap) {
        deferred += 1;
        skip("CAP_REACHED", quality);
        continue;
      }
      queued.push({ flowId: flow.id, flowName: flow.name, stepId: step.id, stepName: step.name, quality });
    }
    report.perFlow.push(perFlow);
  }

  return { ran: true, report, queued, skipped, deferred, cap };
}
