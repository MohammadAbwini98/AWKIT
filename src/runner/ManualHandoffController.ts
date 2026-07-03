export interface ManualHandoffRequest {
  executionId: string;
  instanceId: string;
  scenarioId?: string;
  flowId?: string;
  stepId?: string;
  message: string;
}

export type ManualHandoffResumeAction = "continue" | "retry" | "cancel";

interface PendingManualHandoff {
  request: ManualHandoffRequest;
  promise: Promise<ManualHandoffResumeAction>;
  resolve: (action: ManualHandoffResumeAction) => void;
}

export class ManualHandoffController {
  private readonly pending = new Map<string, PendingManualHandoff>();

  pause(request: ManualHandoffRequest): void {
    const key = this.key(request.executionId, request.instanceId);
    const existing = this.pending.get(key);
    if (existing) {
      existing.request = request;
      return;
    }

    let resolve!: (action: ManualHandoffResumeAction) => void;
    const promise = new Promise<ManualHandoffResumeAction>((res) => {
      resolve = res;
    });
    this.pending.set(key, { request, promise, resolve });
  }

  resume(executionId: string, instanceId: string): void {
    this.resolve(executionId, instanceId, "continue");
  }

  retry(executionId: string, instanceId: string): void {
    this.resolve(executionId, instanceId, "retry");
  }

  cancel(executionId: string, instanceId: string): void {
    this.resolve(executionId, instanceId, "cancel");
  }

  waitForAction(executionId: string, instanceId: string): Promise<ManualHandoffResumeAction> {
    return this.pending.get(this.key(executionId, instanceId))?.promise ?? Promise.resolve("continue");
  }

  getPending(executionId: string, instanceId: string): ManualHandoffRequest | undefined {
    return this.pending.get(this.key(executionId, instanceId))?.request;
  }

  listPending(): ManualHandoffRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  private resolve(executionId: string, instanceId: string, action: ManualHandoffResumeAction): void {
    const key = this.key(executionId, instanceId);
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    pending.resolve(action);
  }

  private key(executionId: string, instanceId: string): string {
    return `${executionId}:${instanceId}`;
  }
}
