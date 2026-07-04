export type InstanceStatus =
  | "pending"
  | "queued"
  | "starting"
  | "running"
  | "waitingForManualAction"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "stopping"
  | "cleaningUp";
