/**
 * Process-wide `FlowValidationService` singleton (Stage 2c), wired to the real app paths, profile
 * stores and durable run history. Kept separate from the service itself so the service stays
 * electron-free and directly testable via `tsx`.
 */
import { join } from "node:path";
import { executionEngine } from "@src/runner/ExecutionEngine";
import { getRuntimePaths } from "../appPaths";
import { createFlowProfileStore, createWorkflowProfileStore } from "../profileStores";
import { FlowValidationService } from "./flowValidationService";

let instance: FlowValidationService | undefined;

export function getFlowValidationService(): FlowValidationService {
  if (!instance) {
    instance = new FlowValidationService({
      validationRoot: join(getRuntimePaths().root, "validation"),
      flowStore: createFlowProfileStore(),
      workflowStore: createWorkflowProfileStore(),
      // Successful runs power the `possible-validator-defect` classification: the validator says
      // broken, but this exact content already completed a run. Best-effort — a telemetry failure
      // must never break a scan, it just leaves the classification unknown.
      recentSuccessfulRuns: () => {
        try {
          return executionEngine
            .getTelemetryRunHistory({}, { limit: 500, offset: 0 }, { status: "success" })
            .rows.map((row) => ({ scenarioId: row.scenarioId, endedAt: row.endedAt }));
        } catch {
          return [];
        }
      }
    });
  }
  return instance;
}
