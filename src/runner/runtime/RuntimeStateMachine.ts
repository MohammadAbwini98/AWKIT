/**
 * Explicit runtime state machines for flow runs and node attempts. The UI-facing
 * `InstanceStatus` is unchanged; these richer states live on the new optional
 * `InstanceRuntimeState.runtime` field and in run-state artifacts, so every transition
 * (including crash/orphan detection by the watchdog) is explicit and auditable.
 */

export type FlowRunStatus =
  | "queued"
  | "planning"
  | "ready"
  | "running"
  | "waitingForManualAction"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled"
  | "crashed"
  | "orphaned";

export type NodeStatus =
  | "pending"
  | "ready"
  | "leased"
  | "running"
  | "succeeded"
  | "failedRetryable"
  | "failedTerminal"
  | "skipped"
  | "compensated";

const FLOW_TRANSITIONS: Record<FlowRunStatus, FlowRunStatus[]> = {
  queued: ["planning", "ready", "running", "cancelled", "orphaned"],
  planning: ["ready", "running", "failed", "cancelled"],
  ready: ["running", "cancelled", "orphaned"],
  running: ["waitingForManualAction", "retrying", "completed", "failed", "cancelling", "cancelled", "crashed", "orphaned"],
  waitingForManualAction: ["running", "cancelling", "cancelled", "failed", "orphaned"],
  retrying: ["running", "failed", "cancelled", "crashed"],
  completed: [],
  failed: [],
  cancelling: ["cancelled", "failed"],
  cancelled: [],
  crashed: ["retrying"],
  orphaned: ["failed", "retrying"]
};

const NODE_TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  pending: ["ready", "skipped"],
  ready: ["leased", "skipped"],
  leased: ["running", "ready"],
  running: ["succeeded", "failedRetryable", "failedTerminal"],
  succeeded: [],
  failedRetryable: ["ready", "failedTerminal", "compensated"],
  failedTerminal: ["compensated"],
  skipped: [],
  compensated: []
};

export const FLOW_RUN_TERMINAL_STATUSES: ReadonlySet<FlowRunStatus> = new Set(["completed", "failed", "cancelled"]);
export const NODE_TERMINAL_STATUSES: ReadonlySet<NodeStatus> = new Set(["succeeded", "failedTerminal", "skipped", "compensated"]);

export function canTransitionFlow(from: FlowRunStatus, to: FlowRunStatus): boolean {
  return from === to || (FLOW_TRANSITIONS[from] ?? []).includes(to);
}

export function canTransitionNode(from: NodeStatus, to: NodeStatus): boolean {
  return from === to || (NODE_TRANSITIONS[from] ?? []).includes(to);
}

export interface FlowRunTransition {
  from: FlowRunStatus;
  to: FlowRunStatus;
  at: string;
  reason?: string;
}

/** Tracks one flow run's status with validated, recorded transitions. */
export class FlowRunStateMachine {
  private current: FlowRunStatus;
  readonly transitions: FlowRunTransition[] = [];

  constructor(initial: FlowRunStatus = "queued") {
    this.current = initial;
  }

  get status(): FlowRunStatus {
    return this.current;
  }

  get isTerminal(): boolean {
    return FLOW_RUN_TERMINAL_STATUSES.has(this.current);
  }

  /** Applies a transition; invalid ones are recorded as forced (never thrown mid-run) with a reason. */
  transition(to: FlowRunStatus, reason?: string): { applied: boolean; forced: boolean } {
    if (this.current === to) return { applied: false, forced: false };
    const legal = canTransitionFlow(this.current, to);
    this.transitions.push({
      from: this.current,
      to,
      at: new Date().toISOString(),
      reason: legal ? reason : `${reason ?? ""} [forced: ${this.current}→${to} is not a declared transition]`.trim()
    });
    this.current = to;
    return { applied: true, forced: !legal };
  }
}
