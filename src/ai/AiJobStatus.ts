/**
 * The one job-status contract for every long local-AI operation (Phase L, L9.1, E9), and the tracker
 * that keeps it.
 *
 * A status says what the job is doing (state, stage), how long it has been doing it (elapsed), where it
 * waits (queue position, hold reason), how much is left where that is KNOWN (determinate progress only
 * with a real denominator: bytes copied, the runtime's own load fraction), roughly how much longer it
 * will take (an ETA RANGE from measured history, with its sample count, confidence and cold or warm),
 * where it runs (the effective profile), whether it can be cancelled, and why it ended.
 *
 * Honesty rules, enforced here rather than left to each surface:
 *  - generation and prompt evaluation are indeterminate: no progress is ever stored for them, and a
 *    stage change clears any progress the previous stage had;
 *  - no percentage and no ETA is ever computed from elapsed time: the ETA comes only from `estimate`,
 *    i.e. measured history; with none the status says so (`eta: null`);
 *  - a job that runs longer than its range says it overran, it is not stretched.
 *
 * The tracker is framework-agnostic: the clock, the estimator, the history recorder and the publisher are
 * injected, so every transition runs under a virtual clock in `verify:ai-job-status`. Nothing here knows a
 * prompt, a path or a device name; a status carries codes and numbers only.
 */

import type { AiFeatureId } from "../security/authz/AiAutonomyPolicy";

/** A product feature's request, or one of the model-management operations. */
export type AiJobKind = AiFeatureId | "modelImport" | "compatibilityCheck" | "backendImport";

export type AiJobState = "queued" | "running" | "cancelling" | "completed" | "failed" | "timed-out" | "cancelled";
export const AI_TERMINAL_JOB_STATES: readonly AiJobState[] = Object.freeze(["completed", "failed", "timed-out", "cancelled"]);

export type AiJobStage =
  | "queued"
  | "compatibility-check"
  | "copy-hash"
  | "backend-probe"
  | "model-load"
  | "prompt-preparation"
  | "prompt-evaluation"
  | "generation"
  | "validation"
  | "finalization";

/** Stages whose progress can be measured: only these may ever carry `progress`. */
const MEASURABLE_STAGES: ReadonlySet<AiJobStage> = new Set(["copy-hash", "model-load"]);

/** A known denominator: bytes of a copy, or thousandths of the runtime's own load fraction. */
export interface AiJobProgress {
  done: number;
  total: number;
  unit: "bytes" | "fraction";
}

export type AiEtaConfidence = "low" | "medium" | "high";

/** What measured history says a job like this takes from the moment it starts running. */
export interface AiEtaEstimate {
  minMs: number;
  maxMs: number;
  samples: number;
  confidence: AiEtaConfidence;
}

/** The ETA a status carries: what is left of the measured range, never extrapolated from elapsed time. */
export interface AiJobEta {
  remainingMinMs: number;
  remainingMaxMs: number;
  samples: number;
  confidence: AiEtaConfidence;
  warmth: "cold" | "warm";
  /** Running past the longest measured duration: shown as such, never as a stretched estimate. */
  overrun: boolean;
}

/** Where the answer is being produced. Never a device name: `device` is only CPU or GPU. */
export interface AiJobProfile {
  modelId: string | null;
  mode: "cpu" | "gpu-offload" | "gpu-only";
  backend: "cpu" | "vulkan";
  device: "cpu" | "gpu";
  offload: string;
  /** Why a GPU mode is running on the CPU (L8a), when it is. */
  fallbackReason: string | null;
}

export interface AiJobStatus {
  /** The id the owner knows the job by (its request id, or the operation's fixed name). */
  jobId: string;
  kind: AiJobKind;
  state: AiJobState;
  stage: AiJobStage;
  /** 1-based while queued; null otherwise. */
  queuePosition: number | null;
  holdReason: string | null;
  progress: AiJobProgress | null;
  elapsedMs: number;
  /** Null while queued, before cold or warm is known, or with no measured history. */
  eta: AiJobEta | null;
  /** True once cold or warm is decided and no history exists for it (the first-run case). */
  noHistory: boolean;
  cold: boolean | null;
  profile: AiJobProfile | null;
  /** The request timeout in force, from the budget table; never an ETA. */
  budgetMs: number | null;
  cancellable: boolean;
  terminalReason: string | null;
  /** Tracker time of this snapshot, so a renderer can keep elapsed ticking between updates. */
  at: number;
}

export interface AiJobOpen {
  kind: AiJobKind;
  /** The window that asked; null for background work nobody watches. */
  owner: number | null;
  jobId: string;
  budgetMs: number | null;
  cancellable: boolean;
  state?: "queued" | "running";
  stage?: AiJobStage;
  queuePosition?: number | null;
}

export interface AiJobPatch {
  state?: "queued" | "running" | "cancelling";
  stage?: AiJobStage;
  queuePosition?: number | null;
  holdReason?: string | null;
  progress?: AiJobProgress | null;
  profile?: AiJobProfile | null;
  cold?: boolean;
  cancellable?: boolean;
  budgetMs?: number | null;
}

/** What `estimate` and `record` are told: enough to find the latency class, nothing else. */
export interface AiJobSample {
  kind: AiJobKind;
  cold: boolean;
  profile: AiJobProfile | null;
}

export interface AiJobTrackerDeps {
  now?: () => number;
  /** Measured history for a job of this kind, warmth and profile; null when none. May be async. */
  estimate?: (sample: AiJobSample) => AiEtaEstimate | null | Promise<AiEtaEstimate | null>;
  /** A job completed: its running duration joins the history. Only `completed` jobs are recorded. */
  record?: (sample: AiJobSample, runMs: number) => void;
  publish?: (owner: number, status: AiJobStatus) => void;
  /** How long a finished job stays readable, so a late subscriber still learns its terminal reason. */
  retainMs?: number;
  maxRetained?: number;
}

interface TrackedJob {
  key: string;
  owner: number | null;
  jobId: string;
  kind: AiJobKind;
  state: AiJobState;
  stage: AiJobStage;
  queuePosition: number | null;
  holdReason: string | null;
  progress: AiJobProgress | null;
  startedAt: number;
  runningSince: number | null;
  endedAt: number | null;
  cold: boolean | null;
  estimate: AiEtaEstimate | null | "pending";
  estimateToken: number;
  /** The last estimate was asked for a known placement; only then does "no estimate" mean no history. */
  askedWithProfile: boolean;
  profile: AiJobProfile | null;
  budgetMs: number | null;
  cancellable: boolean;
  terminalReason: string | null;
}

const isTerminal = (state: AiJobState): boolean => AI_TERMINAL_JOB_STATES.includes(state);

/** A measured range is only meaningful with finite, ordered, non-negative ends and at least one sample. */
function validEstimate(value: AiEtaEstimate | null | undefined): AiEtaEstimate | null {
  if (!value) return null;
  const { minMs, maxMs, samples, confidence } = value;
  const finite = (n: number) => Number.isFinite(n) && n >= 0;
  return finite(minMs) && finite(maxMs) && minMs <= maxMs && Number.isInteger(samples) && samples >= 1 && ["low", "medium", "high"].includes(confidence)
    ? { minMs, maxMs, samples, confidence }
    : null;
}

function validProgress(progress: AiJobProgress | null | undefined): AiJobProgress | null {
  if (!progress) return null;
  const { done, total, unit } = progress;
  return Number.isFinite(done) && Number.isFinite(total) && total > 0 && done >= 0 && (unit === "bytes" || unit === "fraction")
    ? { done: Math.min(done, total), total, unit }
    : null;
}

export class AiJobTracker {
  private readonly jobs = new Map<string, TrackedJob>();
  private readonly now: () => number;

  constructor(private readonly deps: AiJobTrackerDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Start tracking a job under an internal key (unique while it lives). A second open replaces the first. */
  open(key: string, init: AiJobOpen): void {
    this.prune();
    const at = this.now();
    const running = init.state === "running";
    this.jobs.set(key, {
      key,
      owner: init.owner,
      jobId: init.jobId,
      kind: init.kind,
      state: init.state ?? "queued",
      stage: init.stage ?? (running ? "prompt-preparation" : "queued"),
      queuePosition: running ? null : (init.queuePosition ?? null),
      holdReason: null,
      progress: null,
      startedAt: at,
      runningSince: running ? at : null,
      endedAt: null,
      cold: null,
      estimate: null,
      estimateToken: 0,
      askedWithProfile: false,
      profile: null,
      budgetMs: init.budgetMs,
      cancellable: init.cancellable,
      terminalReason: null
    });
    this.emit(key);
  }

  update(key: string, patch: AiJobPatch): void {
    const job = this.jobs.get(key);
    if (!job || isTerminal(job.state)) return;
    if (patch.state === "running" && job.runningSince === null) job.runningSince = this.now();
    if (patch.state === "queued") {
      // Requeued (it yielded to a run): its running time so far no longer predicts the rest, and an answer
      // to the question asked before it is stale.
      job.runningSince = null;
      job.cold = null;
      job.estimate = null;
      job.estimateToken += 1;
    }
    // A cancel requested while running is not undone by a later running update.
    if (patch.state !== undefined && !(job.state === "cancelling" && patch.state === "running")) job.state = patch.state;
    if (job.state !== "queued") job.queuePosition = null;
    if (patch.queuePosition !== undefined && job.state === "queued") job.queuePosition = patch.queuePosition;
    if (patch.holdReason !== undefined) job.holdReason = patch.holdReason;
    if (patch.stage !== undefined && patch.stage !== job.stage) {
      job.stage = patch.stage;
      job.progress = null;
    }
    if (patch.progress !== undefined) job.progress = MEASURABLE_STAGES.has(job.stage) ? validProgress(patch.progress) : null;
    if (patch.profile !== undefined) job.profile = patch.profile ? { ...patch.profile } : null;
    if (patch.cancellable !== undefined) job.cancellable = patch.cancellable;
    if (patch.budgetMs !== undefined) job.budgetMs = patch.budgetMs;
    if (patch.cold !== undefined && patch.cold !== job.cold) {
      job.cold = patch.cold;
      this.requestEstimate(job);
    }
    this.emit(key);
  }

  /** End a job. Only a `completed` job with a known warmth joins the measured history. */
  close(key: string, state: "completed" | "failed" | "timed-out" | "cancelled", reason: string | null = null): void {
    const job = this.jobs.get(key);
    if (!job || isTerminal(job.state)) return;
    const at = this.now();
    job.state = state;
    job.terminalReason = reason;
    job.endedAt = at;
    job.queuePosition = null;
    job.holdReason = null;
    job.cancellable = false;
    job.progress = null;
    // A cold run that fell back from a GPU mode also spent the GPU attempt, so it is no measurement of the
    // CPU placement it is keyed under. A warm one ran on the CPU only and is.
    const fellBackCold = job.cold === true && Boolean(job.profile?.fallbackReason);
    if (state === "completed" && job.cold !== null && job.runningSince !== null && !fellBackCold) {
      try {
        this.deps.record?.({ kind: job.kind, cold: job.cold, profile: job.profile }, at - job.runningSince);
      } catch {
        // History is best-effort: a failed write never changes a job's outcome.
      }
    }
    this.emit(key);
  }

  snapshot(key: string): AiJobStatus | null {
    const job = this.jobs.get(key);
    return job ? this.view(job) : null;
  }

  /** Every job the owner can see: running and queued ones, and recently finished ones. */
  list(owner: number): AiJobStatus[] {
    this.prune();
    return [...this.jobs.values()].filter((job) => job.owner === owner).map((job) => this.view(job));
  }

  private requestEstimate(job: TrackedJob): void {
    const token = (job.estimateToken += 1);
    job.askedWithProfile = job.profile !== null;
    if (job.cold === null || !this.deps.estimate) {
      job.estimate = null;
      return;
    }
    job.estimate = "pending";
    const sample: AiJobSample = { kind: job.kind, cold: job.cold, profile: job.profile };
    const settle = (value: AiEtaEstimate | null | undefined) => {
      // A newer question (warmth changed, requeued) or a finished job ignores a late answer.
      if (job.estimateToken !== token || isTerminal(job.state)) return;
      job.estimate = validEstimate(value);
      this.emit(job.key);
    };
    try {
      const answer = this.deps.estimate(sample);
      if (answer && typeof (answer as Promise<unknown>).then === "function") {
        (answer as Promise<AiEtaEstimate | null>).then(settle, () => settle(null));
      } else {
        job.estimate = validEstimate(answer as AiEtaEstimate | null);
      }
    } catch {
      job.estimate = null;
    }
  }

  private view(job: TrackedJob): AiJobStatus {
    const at = job.endedAt ?? this.now();
    const estimate = job.estimate === "pending" ? null : job.estimate;
    let eta: AiJobEta | null = null;
    if (estimate && job.cold !== null && job.runningSince !== null && !isTerminal(job.state)) {
      const ran = at - job.runningSince;
      eta = {
        remainingMinMs: Math.max(0, estimate.minMs - ran),
        remainingMaxMs: Math.max(0, estimate.maxMs - ran),
        samples: estimate.samples,
        confidence: estimate.confidence,
        warmth: job.cold ? "cold" : "warm",
        overrun: ran > estimate.maxMs
      };
    }
    return {
      jobId: job.jobId,
      kind: job.kind,
      state: job.state,
      stage: job.stage,
      queuePosition: job.queuePosition,
      holdReason: job.holdReason,
      progress: job.progress ? { ...job.progress } : null,
      elapsedMs: at - job.startedAt,
      eta,
      // A GPU mode's first load does not know its placement yet: then nothing is claimed, not "no history".
      noHistory: job.cold !== null && job.estimate === null && job.runningSince !== null && job.askedWithProfile,
      cold: job.cold,
      profile: job.profile ? { ...job.profile } : null,
      budgetMs: job.budgetMs,
      cancellable: job.cancellable,
      terminalReason: job.terminalReason,
      at
    };
  }

  private emit(key: string): void {
    const job = this.jobs.get(key);
    if (!job || job.owner === null || !this.deps.publish) return;
    try {
      this.deps.publish(job.owner, this.view(job));
    } catch {
      // A window that went away never stops the job.
    }
  }

  private prune(): void {
    const retainMs = this.deps.retainMs ?? 60_000;
    const maxRetained = this.deps.maxRetained ?? 32;
    const now = this.now();
    const finished = [...this.jobs.values()].filter((job) => job.endedAt !== null).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    for (const job of finished) if (now - (job.endedAt ?? now) > retainMs) this.jobs.delete(job.key);
    const left = finished.filter((job) => this.jobs.has(job.key));
    for (const job of left.slice(0, Math.max(0, left.length - maxRetained))) this.jobs.delete(job.key);
  }
}

/** Sample count to confidence: one or two runs are a hint, ten a pattern. */
export function etaConfidence(samples: number): AiEtaConfidence {
  return samples >= 10 ? "high" : samples >= 3 ? "medium" : "low";
}
