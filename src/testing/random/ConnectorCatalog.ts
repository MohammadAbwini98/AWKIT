/**
 * Authoritative generation catalog for connectors (flow edges).
 *
 * Like `NodeCatalog`, every catalog here is an exhaustive `Record<…Literal, …>` so `tsc --noEmit`
 * fails if the domain model in `src/profiles/FlowProfile.ts` gains a connector kind, operator,
 * condition source, join mode, failure mode, isolation mode or loop mode that the randomizer does
 * not know how to generate.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type {
  ConnectorConditionOperator,
  ConnectorConditionSource,
  ConnectorKind,
  FlowEdgeType,
  LoopConnectorConfig,
  ParallelConnectorConfig
} from "../../profiles/FlowProfile";
import { FLOW_VALIDATION_LIMITS } from "../../validation/FlowLimits";

type JoinMode = ParallelConnectorConfig["joinMode"];
type FailMode = ParallelConnectorConfig["failMode"];
type IsolationMode = NonNullable<ParallelConnectorConfig["isolation"]>;
type LoopMode = LoopConnectorConfig["mode"];

/* ------------------------------------------------------------------ *
 * Connector kinds
 * ------------------------------------------------------------------ */

export interface ConnectorKindSpec {
  readonly kind: ConnectorKind;
  /** The legacy `FlowEdgeType` this kind serializes as (mirrors the renderer's KIND_TO_LINKTYPE). */
  readonly edgeType: FlowEdgeType;
  /** More than one outgoing connector of this kind may leave a node. */
  readonly allowsFanOut: boolean;
  /** Source and target must be the same node (self-loop). */
  readonly requiresSelfLoop: boolean;
  readonly weight: number;
  readonly note?: string;
}

export const CONNECTOR_KIND_CATALOG: Record<ConnectorKind, ConnectorKindSpec> = {
  normal: {
    kind: "normal",
    edgeType: "success",
    allowsFanOut: false,
    requiresSelfLoop: false,
    weight: 10,
    note: "validateConnectorStructure rejects >1 non-conditional/non-parallel edge per source."
  },
  conditional: {
    kind: "conditional",
    edgeType: "conditional",
    allowsFanOut: true,
    requiresSelfLoop: false,
    weight: 6
  },
  parallel: {
    kind: "parallel",
    edgeType: "parallel",
    allowsFanOut: true,
    requiresSelfLoop: false,
    weight: 4
  },
  loop: {
    kind: "loop",
    edgeType: "loop",
    allowsFanOut: false,
    requiresSelfLoop: true,
    weight: 3,
    note: "A structured loop connector whose source !== target is rejected by validateConnectorStructure."
  }
};

/**
 * Legacy edge types. These are the wire format; `kind` is the structured overlay. `connectorKind()`
 * in FlowProfile.ts maps every one of these onto a `ConnectorKind`, so the randomizer must be able
 * to emit and round-trip all nine.
 */
export const EDGE_TYPE_CATALOG: Record<FlowEdgeType, { readonly derivedKind: ConnectorKind }> = {
  success: { derivedKind: "normal" },
  failure: { derivedKind: "normal" },
  always: { derivedKind: "normal" },
  manualApproval: { derivedKind: "normal" },
  conditional: { derivedKind: "conditional" },
  outcome: { derivedKind: "conditional" },
  parallel: { derivedKind: "parallel" },
  loop: { derivedKind: "loop" },
  loopBack: { derivedKind: "loop" }
};

/* ------------------------------------------------------------------ *
 * Conditional connectors
 * ------------------------------------------------------------------ */

export interface ConditionOperatorSpec {
  readonly operator: ConnectorConditionOperator;
  /**
   * `expectedValue` must be present. Mirrors the Flow Designer's validateFlow rule, which flags an
   * empty expectedValue for every operator except always/exists/notExists/truthy/falsy.
   */
  readonly requiresExpectedValue: boolean;
  /** Operator coerces both sides with `Number()` before comparing. */
  readonly numeric: boolean;
  readonly weight: number;
}

export const CONDITION_OPERATOR_CATALOG: Record<
  ConnectorConditionOperator,
  ConditionOperatorSpec
> = {
  always: { operator: "always", requiresExpectedValue: false, numeric: false, weight: 4 },
  equals: { operator: "equals", requiresExpectedValue: true, numeric: false, weight: 8 },
  notEquals: { operator: "notEquals", requiresExpectedValue: true, numeric: false, weight: 5 },
  contains: { operator: "contains", requiresExpectedValue: true, numeric: false, weight: 6 },
  notContains: { operator: "notContains", requiresExpectedValue: true, numeric: false, weight: 4 },
  exists: { operator: "exists", requiresExpectedValue: false, numeric: false, weight: 4 },
  notExists: { operator: "notExists", requiresExpectedValue: false, numeric: false, weight: 3 },
  greaterThan: { operator: "greaterThan", requiresExpectedValue: true, numeric: true, weight: 4 },
  greaterThanOrEqual: {
    operator: "greaterThanOrEqual",
    requiresExpectedValue: true,
    numeric: true,
    weight: 3
  },
  lessThan: { operator: "lessThan", requiresExpectedValue: true, numeric: true, weight: 4 },
  lessThanOrEqual: {
    operator: "lessThanOrEqual",
    requiresExpectedValue: true,
    numeric: true,
    weight: 3
  },
  truthy: { operator: "truthy", requiresExpectedValue: false, numeric: false, weight: 3 },
  falsy: { operator: "falsy", requiresExpectedValue: false, numeric: false, weight: 3 }
};

export interface ConditionSourceSpec {
  readonly source: ConnectorConditionSource;
  /** `variableName` must be set. The designer flags variable/dataSourceValue without one. */
  readonly requiresVariableName: boolean;
  readonly weight: number;
}

export const CONDITION_SOURCE_CATALOG: Record<ConnectorConditionSource, ConditionSourceSpec> = {
  outcome: { source: "outcome", requiresVariableName: false, weight: 8 },
  status: { source: "status", requiresVariableName: false, weight: 8 },
  errorCode: { source: "errorCode", requiresVariableName: false, weight: 4 },
  variable: { source: "variable", requiresVariableName: true, weight: 6 },
  dataSourceValue: { source: "dataSourceValue", requiresVariableName: true, weight: 3 }
};

/* ------------------------------------------------------------------ *
 * Parallel connectors
 * ------------------------------------------------------------------ */

export const JOIN_MODE_CATALOG: Record<JoinMode, { readonly weight: number; readonly note: string }> =
  {
    waitAll: { weight: 6, note: "Runtime default when joinMode is absent." },
    waitAny: { weight: 4, note: "Continues after the first qualifying branch." }
  };

export const FAIL_MODE_CATALOG: Record<FailMode, { readonly weight: number; readonly note: string }> =
  {
    failFast: {
      weight: 6,
      note: "Runtime default. In isolated mode it reports failure only after branches settle — it does NOT abort in-flight work."
    },
    collectErrors: { weight: 4, note: "Aggregates every branch error before failing." }
  };

export const ISOLATION_MODE_CATALOG: Record<
  IsolationMode,
  { readonly weight: number; readonly note: string }
> = {
  sharedPage: {
    weight: 5,
    note: "Effective default. FlowExecutor runs sharedPage branches SEQUENTIALLY on the current page — it is fan-out, not true concurrency."
  },
  isolatedPage: {
    weight: 5,
    note: "Requires a branchExecutorFactory; without one FlowExecutor silently falls back to sequential."
  }
};

/* ------------------------------------------------------------------ *
 * Loop connectors
 * ------------------------------------------------------------------ */

export interface LoopModeSpec {
  readonly mode: LoopMode;
  /** `staticValues` must be non-empty. */
  readonly requiresStaticValues: boolean;
  /** `dataSourceId` must be set. */
  readonly requiresDataSource: boolean;
  /** `condition` must be set. */
  readonly requiresCondition: boolean;
  readonly weight: number;
}

export const LOOP_MODE_CATALOG: Record<LoopMode, LoopModeSpec> = {
  count: {
    mode: "count",
    requiresStaticValues: false,
    requiresDataSource: false,
    requiresCondition: false,
    weight: 8
  },
  staticList: {
    mode: "staticList",
    requiresStaticValues: true,
    requiresDataSource: false,
    requiresCondition: false,
    weight: 5
  },
  dataSource: {
    mode: "dataSource",
    requiresStaticValues: false,
    requiresDataSource: true,
    requiresCondition: false,
    weight: 2
  },
  whileCondition: {
    mode: "whileCondition",
    requiresStaticValues: false,
    requiresDataSource: false,
    requiresCondition: true,
    weight: 3
  }
};

/**
 * Hard caps the generator must never exceed. Sourced from the runtime, not invented:
 * - `FLOW_VALIDATION_LIMITS.maxLoopIterations` (src/validation/FlowLimits.ts) is the single
 *   canonical loop cap since Stage 2b — validator, designer, `LOOP_CONNECTOR_HARD_CAP` and the
 *   F-03 runtime clamp all read it.
 * - `loopBack` edges default to `maxLoopCount = 2`.
 * - Run Another Flow is guarded at a nesting depth of 5.
 *
 * The generator's own default ceiling is deliberately far below these so a runaway campaign cannot
 * wedge a machine; a campaign may raise it up to `absoluteMaxLoopIterations`.
 */
export const RUNTIME_LOOP_LIMITS = {
  /** The canonical cap: validator error threshold, designer gate and runtime truncation point. */
  absoluteMaxLoopIterations: FLOW_VALIDATION_LIMITS.maxLoopIterations,
  /** Default ceiling used when a campaign does not set one. */
  defaultMaxLoopIterations: 5,
  /** `edge.maxLoopCount` default for legacy loopBack edges. */
  defaultLoopBackCount: 2,
  /** Run Another Flow recursion guard. Generation must stay strictly below this. */
  maxRunFlowDepth: 5
} as const;

export const ALL_CONNECTOR_KINDS: readonly ConnectorKind[] = Object.keys(
  CONNECTOR_KIND_CATALOG
) as ConnectorKind[];

export const ALL_EDGE_TYPES: readonly FlowEdgeType[] = Object.keys(
  EDGE_TYPE_CATALOG
) as FlowEdgeType[];

export const ALL_CONDITION_OPERATORS: readonly ConnectorConditionOperator[] = Object.keys(
  CONDITION_OPERATOR_CATALOG
) as ConnectorConditionOperator[];

export const ALL_CONDITION_SOURCES: readonly ConnectorConditionSource[] = Object.keys(
  CONDITION_SOURCE_CATALOG
) as ConnectorConditionSource[];

export const ALL_JOIN_MODES: readonly JoinMode[] = Object.keys(JOIN_MODE_CATALOG) as JoinMode[];
export const ALL_FAIL_MODES: readonly FailMode[] = Object.keys(FAIL_MODE_CATALOG) as FailMode[];
export const ALL_ISOLATION_MODES: readonly IsolationMode[] = Object.keys(
  ISOLATION_MODE_CATALOG
) as IsolationMode[];
export const ALL_LOOP_MODES: readonly LoopMode[] = Object.keys(LOOP_MODE_CATALOG) as LoopMode[];

export type { JoinMode, FailMode, IsolationMode, LoopMode };
