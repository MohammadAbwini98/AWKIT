import type { LoopConnectorConfig } from "./FlowProfile";

export interface ScenarioFlowReference {
  order: number;
  flowId: string;
  required: boolean;
  inputs?: Record<string, string>;
  outputs?: Record<string, { fromStep: string; type: string }>;
}

export interface ScenarioLink {
  id: string;
  sourceFlowId: string;
  targetFlowId: string;
  type: "success" | "failure" | "always" | "conditional" | "outcome" | "manualApproval" | "loop" | "loopBack" | "parallel";
  label?: string;
  condition?: {
    expression: string;
  };
  /** Structured self-loop configuration shared with Flow connectors. */
  loop?: LoopConnectorConfig;
  /** Legacy cross-node loop-back traversal bound. */
  maxLoopCount?: number;
}

export interface ScenarioProfile {
  id: string;
  name: string;
  description?: string;
  executionMode: "sequential" | "conditional" | "parallel" | "loop" | "manual";
  maxParallelFlows: number;
  flows: ScenarioFlowReference[];
  links: ScenarioLink[];
  failurePolicy: {
    stopOnRequiredFlowFailure: boolean;
    continueOnOptionalFlowFailure: boolean;
    takeScreenshotOnFailure: boolean;
  };
}
