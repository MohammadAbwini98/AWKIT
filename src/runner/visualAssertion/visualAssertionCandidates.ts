/**
 * Pending visual-assertion candidates (Phase N, N6.4 / N6.5; plan "Pending candidates", VA-13).
 *
 * MEMORY ONLY. A run produces a candidate when an eligible step has no usable approval (no baseline, binding
 * changed, other conditions, unreadable) after a successful guarded capture. It lives in this main-process registry,
 * never on disk, at most `max` (20) at once, for `ttlMs` (30 minutes), and is dropped at app exit.
 *
 * IMMUTABLY BOUND (frozen) to the run, the flow, the step, the flow's epoch token at capture, the step content digest,
 * the conditions, the step mode, the key generation and the run's user. Approval (N6.5) re-checks the current epoch,
 * content, key generation and existence inside the flows folder's critical section, and consumes the candidate
 * atomically: `take` removes it in the same synchronous turn that returns it, so it can be used once.
 *
 * The raw `contentDigest` and the preview pixels never leave the main process. `summaries()` is the only view meant
 * for a renderer and carries neither.
 */

import { randomBytes } from "node:crypto";

import type { VisualBaselineConditions, VisualBaselineGeometry } from "./VisualBaselineStore";

export const VISUAL_CANDIDATE_MAX = 20;
export const VISUAL_CANDIDATE_TTL_MS = 30 * 60 * 1000;

export type VisualCandidateReason = "no-baseline" | "binding-changed" | "baseline-other-conditions" | "baseline-unreadable";

export interface VisualAssertionCandidate {
  readonly candidateId: string;
  readonly executionId: string;
  readonly instanceId: string;
  readonly flowId: string;
  readonly stepId: string;
  readonly mode: "observe" | "enforce";
  readonly reason: VisualCandidateReason;
  /** The flow's epoch token read at capture (C3). */
  readonly epoch: string;
  readonly stepContentDigest: string;
  readonly conditions: Readonly<VisualBaselineConditions>;
  readonly geometry: Readonly<VisualBaselineGeometry>;
  /** The key generation at capture; 0 before the first key exists. */
  readonly keyGeneration: number;
  /** Who started the run. `unattributed` when the engine has no run identity (the approver is always recorded). */
  readonly runUser: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  /** Main process only: the N1 content digest and the image size in device pixels. */
  readonly contentDigest: string;
  readonly width: number;
  readonly height: number;
  /** Main process only: transient RGBA preview pixels (N6.5 encodes them for a re-authenticated preview). */
  readonly preview: Readonly<{ width: number; height: number; rgba: Uint8Array }>;
}

/** The renderer-safe view: no digest, no token, no pixels. */
export interface VisualCandidateSummary {
  candidateId: string;
  flowId: string;
  stepId: string;
  mode: "observe" | "enforce";
  reason: VisualCandidateReason;
  createdAt: number;
  expiresAt: number;
}

export type VisualCandidateInput = Omit<VisualAssertionCandidate, "candidateId" | "createdAt" | "expiresAt">;

export class VisualAssertionCandidates {
  private readonly entries = new Map<string, VisualAssertionCandidate>();

  constructor(private readonly options: { max?: number; ttlMs?: number; now?: () => number } = {}) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const [id, candidate] of this.entries) if (candidate.expiresAt <= now) this.entries.delete(id);
  }

  /** Add a candidate; the oldest is dropped when the registry is full. Returns its id. */
  add(input: VisualCandidateInput): string {
    this.purgeExpired();
    const max = this.options.max ?? VISUAL_CANDIDATE_MAX;
    while (this.entries.size >= max) this.entries.delete(this.entries.keys().next().value as string);
    const createdAt = this.now();
    const candidate: VisualAssertionCandidate = Object.freeze({
      ...input,
      conditions: Object.freeze({ ...input.conditions }),
      geometry: Object.freeze({ ...input.geometry }),
      preview: Object.freeze({ width: input.preview.width, height: input.preview.height, rgba: input.preview.rgba }),
      candidateId: randomBytes(16).toString("hex"),
      createdAt,
      expiresAt: createdAt + (this.options.ttlMs ?? VISUAL_CANDIDATE_TTL_MS)
    });
    this.entries.set(candidate.candidateId, candidate);
    return candidate.candidateId;
  }

  /** Read without consuming (preview). Undefined when unknown or expired. */
  peek(candidateId: string): VisualAssertionCandidate | undefined {
    this.purgeExpired();
    return this.entries.get(candidateId);
  }

  /** Consume atomically: the candidate is removed before it is returned, so a second `take` gets nothing. */
  take(candidateId: string): VisualAssertionCandidate | undefined {
    this.purgeExpired();
    const candidate = this.entries.get(candidateId);
    if (candidate) this.entries.delete(candidateId);
    return candidate;
  }

  /** Drop a candidate without approving it (reject). */
  discard(candidateId: string): boolean {
    return this.entries.delete(candidateId);
  }

  summaries(): VisualCandidateSummary[] {
    this.purgeExpired();
    return [...this.entries.values()].map(({ candidateId, flowId, stepId, mode, reason, createdAt, expiresAt }) => ({ candidateId, flowId, stepId, mode, reason, createdAt, expiresAt }));
  }

  /** Every candidate bound to a key generation older than `generation` is stale after a reset. */
  dropBelowKeyGeneration(generation: number): void {
    for (const [id, candidate] of this.entries) if (candidate.keyGeneration < generation) this.entries.delete(id);
  }

  size(): number {
    this.purgeExpired();
    return this.entries.size;
  }
}

/** The main process's one registry. */
export const visualAssertionCandidates = new VisualAssertionCandidates();
