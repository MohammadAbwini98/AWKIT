/**
 * Per-node attempt records. Every executed step (node) attempt gets an explicit record with
 * ids, timing, status, and error context so failures are debuggable from run artifacts:
 * "which node, which attempt, on which worker, what happened".
 */
import type { NodeStatus } from "./RuntimeStateMachine";

export interface NodeAttempt {
  runId: string;
  flowId?: string;
  nodeId: string;
  attemptId: string;
  tryNumber: number;
  status: NodeStatus;
  workerId?: string;
  browserWorkerId?: string;
  startedAt?: string;
  heartbeatAt?: string;
  completedAt?: string;
  durationMs?: number;
  currentUrl?: string;
  error?: string;
  errorClass?: string;
  screenshotPath?: string;
  /** Failure-trace zip saved for this attempt (when trace capture is armed). */
  tracePath?: string;
  /** Side-effect classification of the step (Phase 3 safety metadata). */
  sideEffectLevel?: string;
}

/** Bounded in-memory attempt log for one run (oldest attempts dropped past the cap). */
export class NodeAttemptLog {
  private readonly attempts: NodeAttempt[] = [];
  private counter = 0;

  constructor(private readonly maxAttempts = 1000) {}

  start(input: Omit<NodeAttempt, "attemptId" | "status" | "startedAt" | "tryNumber"> & { tryNumber?: number }): NodeAttempt {
    const attempt: NodeAttempt = {
      ...input,
      tryNumber: input.tryNumber ?? 1,
      attemptId: `${input.nodeId}-a${++this.counter}`,
      status: "running",
      startedAt: new Date().toISOString()
    };
    this.attempts.push(attempt);
    if (this.attempts.length > this.maxAttempts) this.attempts.splice(0, this.attempts.length - this.maxAttempts);
    return attempt;
  }

  finish(attempt: NodeAttempt, status: NodeStatus, patch: Partial<NodeAttempt> = {}): NodeAttempt {
    attempt.status = status;
    attempt.completedAt = new Date().toISOString();
    if (attempt.startedAt) attempt.durationMs = Date.parse(attempt.completedAt) - Date.parse(attempt.startedAt);
    Object.assign(attempt, patch);
    return attempt;
  }

  heartbeat(attempt: NodeAttempt): void {
    attempt.heartbeatAt = new Date().toISOString();
  }

  list(): NodeAttempt[] {
    return [...this.attempts];
  }
}
