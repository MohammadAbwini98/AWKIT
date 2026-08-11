import type { LoopConnectorConfig } from "@src/profiles/FlowProfile";
import { FLOW_VALIDATION_LIMITS } from "@src/validation/FlowLimits";
import { materializeDataSourceRows, type InstanceExecutionContext } from "./InstanceExecutionContext";

/** Clamp an authored loop bound at the final runtime safety boundary. Validation remains authoritative. */
export function loopIterationLimit(config: LoopConnectorConfig): number {
  return Math.max(1, Math.min(config.maxIterations || 1, FLOW_VALIDATION_LIMITS.maxLoopIterations));
}

/**
 * Materialize the ordered values for a structured connector. Shared by step-level Flow execution
 * and workflow-level Flow-reference execution so count/list/data-source policy cannot drift.
 */
export async function resolveLoopConnectorValues(
  config: LoopConnectorConfig,
  context: InstanceExecutionContext,
  maxIterations = loopIterationLimit(config)
): Promise<unknown[]> {
  switch (config.mode) {
    case "staticList":
      return (config.staticValues ?? []).slice(0, maxIterations);
    case "dataSource": {
      const dataSource = config.dataSourceId ? context.dataSources?.[config.dataSourceId] : context.workflowDataSource;
      const rows = dataSource ? await materializeDataSourceRows(dataSource) : [];
      const binding = config.dataSourceBinding?.trim();
      const values = binding
        ? rows.map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>)[binding] : undefined))
        : rows;
      return values.slice(0, maxIterations);
    }
    case "count":
    case "whileCondition":
    default:
      return Array.from({ length: maxIterations }, (_, index) => index + 1);
  }
}
