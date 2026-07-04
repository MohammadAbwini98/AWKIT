import type { InstanceStatus } from "./InstanceStatus";

export interface InstanceStatusChangedEvent {
  executionId: string;
  instanceId: string;
  status: InstanceStatus;
  message?: string;
}
