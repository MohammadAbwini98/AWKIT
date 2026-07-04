import type { InstanceRuntimeState } from "./InstanceRuntimeState";
import type { InstanceStatus } from "./InstanceStatus";

export class InstancePool {
  private readonly instances = new Map<string, InstanceRuntimeState>();

  add(state: InstanceRuntimeState): void {
    this.instances.set(state.instanceId, state);
  }

  get(instanceId: string): InstanceRuntimeState | undefined {
    return this.instances.get(instanceId);
  }

  list(): InstanceRuntimeState[] {
    return [...this.instances.values()];
  }

  listByStatus(statuses: InstanceStatus[]): InstanceRuntimeState[] {
    const allowed = new Set(statuses);
    return this.list().filter((state) => allowed.has(state.status));
  }

  updateStatus(instanceId: string, status: InstanceStatus): InstanceRuntimeState {
    const state = this.instances.get(instanceId);
    if (!state) throw new Error(`Unknown instance: ${instanceId}`);

    const now = new Date().toISOString();
    const nextState: InstanceRuntimeState = {
      ...state,
      status,
      startedAt: status === "running" && !state.startedAt ? now : state.startedAt,
      endedAt: ["completed", "failed", "cancelled"].includes(status) ? now : state.endedAt,
      queuePosition: status === "queued" ? state.queuePosition : undefined
    };

    this.instances.set(instanceId, nextState);
    return nextState;
  }

  update(instanceId: string, update: Partial<InstanceRuntimeState>): InstanceRuntimeState {
    const state = this.instances.get(instanceId);
    if (!state) throw new Error(`Unknown instance: ${instanceId}`);

    const nextState = { ...state, ...update };
    this.instances.set(instanceId, nextState);
    return nextState;
  }

  removeCompleted(): void {
    this.listByStatus(["completed", "failed", "cancelled"]).forEach((state) => this.instances.delete(state.instanceId));
  }

  remove(instanceId: string): void {
    this.instances.delete(instanceId);
  }

  clear(): void {
    this.instances.clear();
  }
}
