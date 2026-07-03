/**
 * Evaluator for structured conditional connectors. Compares a value drawn from the
 * source node's execution result (or the flow variable scope) against an expected
 * value using a fixed operator set — no `eval`, no dynamic code.
 */
import type { ConditionalConnectorConfig } from "@src/profiles/FlowProfile";

/** The parts of a node's execution result a conditional connector can route on. */
export interface NodeOutcomeView {
  status: string;
  outcome?: string;
  outputs: Record<string, unknown>;
  errorCode?: string;
}

/** Resolves a `variable`/`dataSourceValue` path to a value (outputs/inputs scope). */
export type ConnectorScopeResolver = (path: string) => unknown;

function isTruthy(value: unknown): boolean {
  if (typeof value === "string") return !["", "false", "0", "no", "off"].includes(value.trim().toLowerCase());
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

function resolveSourceValue(cfg: ConditionalConnectorConfig, node: NodeOutcomeView, scope: ConnectorScopeResolver): unknown {
  switch (cfg.sourceField) {
    case "outcome":
      return node.outcome;
    case "status":
      return node.status;
    case "errorCode":
      return node.errorCode;
    case "variable":
    case "dataSourceValue":
      return cfg.variableName ? scope(cfg.variableName) : undefined;
    default:
      return undefined;
  }
}

/** Evaluate one conditional connector against a node result + scope. */
export function evaluateConnectorCondition(cfg: ConditionalConnectorConfig, node: NodeOutcomeView, scope: ConnectorScopeResolver): boolean {
  const actual = resolveSourceValue(cfg, node, scope);
  const expected = cfg.expectedValue;

  switch (cfg.operator) {
    case "always":
      return true;
    case "equals":
      return String(actual) === String(expected);
    case "notEquals":
      return String(actual) !== String(expected);
    case "contains":
      return String(actual ?? "").includes(String(expected ?? ""));
    case "notContains":
      return !String(actual ?? "").includes(String(expected ?? ""));
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "notExists":
      return actual === undefined || actual === null || actual === "";
    case "greaterThan":
      return Number(actual) > Number(expected);
    case "greaterThanOrEqual":
      return Number(actual) >= Number(expected);
    case "lessThan":
      return Number(actual) < Number(expected);
    case "lessThanOrEqual":
      return Number(actual) <= Number(expected);
    case "truthy":
      return isTruthy(actual);
    case "falsy":
      return !isTruthy(actual);
    default:
      return false;
  }
}
