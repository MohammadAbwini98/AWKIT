export interface StructuredLog {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  executionId: string;
  instanceId?: string;
  scenarioId?: string;
  flowId?: string;
  stepId?: string;
  message: string;
  data?: Record<string, unknown>;
}
