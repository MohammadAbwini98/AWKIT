import type { InstanceRuntimeState } from "@src/instances/InstanceRuntimeState";
import type { InstanceStatus } from "@src/instances/InstanceStatus";

export class ConcurrentExecutionCoordinator {
  canStart(activeCount: number, maxConcurrentInstances: number): boolean {
    return activeCount < maxConcurrentInstances;
  }

  applyConcurrencyLimit(instances: InstanceRuntimeState[], maxConcurrentInstances: number): InstanceRuntimeState[] {
    let activeCount = 0;
    let queuePosition = 1;

    return instances.map((instance) => {
      if (this.isTerminal(instance.status)) return instance;

      if (activeCount < maxConcurrentInstances) {
        activeCount += 1;
        return {
          ...instance,
          status: instance.status === "queued" ? "pending" : instance.status,
          queuePosition: undefined
        };
      }

      return {
        ...instance,
        status: "queued",
        queuePosition: queuePosition++
      };
    });
  }

  startPending(instances: InstanceRuntimeState[], maxConcurrentInstances: number): InstanceRuntimeState[] {
    const activeCount = instances.filter((instance) => this.isActive(instance.status)).length;
    let availableSlots = Math.max(maxConcurrentInstances - activeCount, 0);

    return instances.map((instance) => {
      if (instance.status !== "pending" || availableSlots <= 0) return instance;
      availableSlots -= 1;
      return {
        ...instance,
        status: "running",
        startedAt: instance.startedAt ?? new Date().toISOString(),
        currentFlow: instance.currentFlow ?? "Login Flow",
        currentStep: "Starting browser context"
      };
    });
  }

  promoteQueued(instances: InstanceRuntimeState[], maxConcurrentInstances: number): InstanceRuntimeState[] {
    const activeCount = instances.filter((instance) => this.isActive(instance.status)).length;
    let availableSlots = Math.max(maxConcurrentInstances - activeCount, 0);

    return instances.map((instance) => {
      if (instance.status !== "queued" || availableSlots <= 0) return instance;
      availableSlots -= 1;
      return {
        ...instance,
        status: "pending",
        queuePosition: undefined
      };
    });
  }

  pauseAll(instances: InstanceRuntimeState[]): InstanceRuntimeState[] {
    return instances.map((instance) => (this.isActive(instance.status) ? { ...instance, status: "paused" } : instance));
  }

  resumeAll(instances: InstanceRuntimeState[]): InstanceRuntimeState[] {
    return instances.map((instance) => (instance.status === "paused" ? { ...instance, status: "running" } : instance));
  }

  stopAll(instances: InstanceRuntimeState[]): InstanceRuntimeState[] {
    return instances.map((instance) =>
      this.isTerminal(instance.status)
        ? instance
        : {
            ...instance,
            status: "cancelled",
            endedAt: new Date().toISOString()
          }
    );
  }

  private isActive(status: InstanceStatus): boolean {
    return ["starting", "running", "waitingForManualAction", "paused"].includes(status);
  }

  private isTerminal(status: InstanceStatus): boolean {
    return ["completed", "failed", "cancelled"].includes(status);
  }
}
