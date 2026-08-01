/**
 * Shared flow validation engine (Test Lab Tranche 2, Stage 2a).
 *
 * One pure, framework-agnostic implementation of every flow-level rule, intended to become the
 * single source of truth for the designer, persistence, the run gate, import/export and the CLI.
 * **Stage 2a wires it into nothing.** It is additive: the engine and its verifier exist and are
 * measured by the Phase-2 oracle, but no production caller has been changed yet (Stage 2b does
 * that). Nothing here mutates its input or persists anything.
 *
 * ## Why this exists
 *
 * Phase-2 mutation testing proved that 9 of 13 controlled defect classes are rejected by no
 * validator (`awkit-7fm`). Several of those rules *do* exist — but only in the renderer's advisory
 * `validateFlow` (`FlowChartDesigner.tsx`), which is not the save gate and has no `src/`
 * counterpart, so a profile that arrives by import, hand edit or IPC is never checked. And there is
 * no reachability check anywhere at the flow level.
 *
 * ## The engine is verdict-free
 *
 * It reports issues; it never decides whether a flow may run. Every issue carries
 * {@link FlowValidationIssue.onActivePath} — whether the offending node/connector is reachable from
 * Start — so a caller can apply the staged enforcement policy from the design doc (active-path
 * errors block immediately; off-path errors are Legacy-Compatibility-tolerable) without the engine
 * needing to know which caller it is serving.
 *
 * ## Fixes are described, never applied
 *
 * {@link FlowValidationIssue.safeFix} carries metadata for deterministic schema-migration fixes
 * only (enum-casing normalization, unambiguous id regeneration). The engine never applies one, and
 * never emits fix metadata for anything that could alter execution logic — adding Start/End nodes,
 * deleting unreachable nodes, guessing flow references, reconnecting connectors, replacing
 * operators, clamping loops or changing timeouts are all explicitly *not* safe.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type {
  ConditionalConnectorConfig,
  ConnectorConditionOperator,
  ConnectorConditionSource,
  FlowEdge,
  FlowProfile,
  FlowStep,
  LoopConnectorConfig,
  ParallelConnectorConfig
} from "../profiles/FlowProfile";
import { connectorKind, validateConnectorStructureDetailed } from "../profiles/FlowProfile";
import { isPositionalLocator, isValidLocatorFallbackApproval } from "../profiles/locatorApproval";
import { resolveStepSafety } from "../runner/runtime/StepSafetyPolicy";
import { isKnownStepType, stepRequirement } from "./StepRequirements";

/* ------------------------------------------------------------------ *
 * Limits
 * ------------------------------------------------------------------ */

// Stage 2b: the limits moved to the leaf module `FlowLimits.ts` so the runner, the runtime bounds
// clamp, the renderer and the test lab all read the SAME constant. Re-exported for API stability.
import { FLOW_VALIDATION_LIMITS } from "./FlowLimits";
export { FLOW_VALIDATION_LIMITS };

/* ------------------------------------------------------------------ *
 * Contract
 * ------------------------------------------------------------------ */

export type FlowValidationSeverity = "error" | "warning";

/**
 * Stable machine code for a rule. These are part of the engine's contract: they are persisted in
 * validation reports, matched by the verifier and shown in the UI from Stage 2b, so a code is
 * renamed only with a migration.
 */
export type FlowValidationCode =
  | "missingStartNode"
  | "multipleStartNodes"
  | "missingEndNode"
  | "unreachableEndNode"
  | "duplicateNodeId"
  | "duplicateEdgeId"
  | "duplicateFlowId"
  | "brokenConnectorEndpoint"
  | "unreachableNode"
  | "missingFlowReference"
  | "flowReferenceCycle"
  | "missingRequiredLocator"
  | "missingRequiredValue"
  | "invalidTimeout"
  | "invalidLoopBounds"
  | "unsupportedOperator"
  | "unsupportedConfiguration"
  | "connectorStructure"
  | "highTimeout"
  | "largeLoopBounds"
  | "locatorNeedsReview";

interface RuleSpec {
  readonly severity: FlowValidationSeverity;
  /** One line, for the rule matrix in reports and docs. */
  readonly summary: string;
}

/**
 * Every rule, in canonical order — this declaration order *is* the report's sort order, so a
 * report's shape is stable across runs and machines. Exhaustive `Record`, so `tsc --noEmit` fails
 * if a code is added without a severity.
 */
export const FLOW_VALIDATION_RULES: Record<FlowValidationCode, RuleSpec> = {
  missingStartNode: { severity: "error", summary: "Flow has no Start node." },
  multipleStartNodes: { severity: "error", summary: "Flow has more than one Start node." },
  missingEndNode: { severity: "error", summary: "Flow has no End node." },
  unreachableEndNode: { severity: "error", summary: "No End node is reachable from Start." },
  duplicateNodeId: { severity: "error", summary: "Two or more nodes share one id." },
  duplicateEdgeId: { severity: "error", summary: "Two or more connectors share one id." },
  duplicateFlowId: { severity: "error", summary: "Two or more flows in the set share one id." },
  brokenConnectorEndpoint: { severity: "error", summary: "A connector endpoint names a node that does not exist." },
  unreachableNode: { severity: "error", summary: "Node cannot be reached from Start." },
  missingFlowReference: { severity: "error", summary: "A Run Another Flow step targets a flow that does not exist." },
  flowReferenceCycle: { severity: "error", summary: "Run Another Flow references form a cycle." },
  missingRequiredLocator: { severity: "error", summary: "Step type requires a locator and has none." },
  missingRequiredValue: { severity: "error", summary: "Step type requires a value and has none." },
  invalidTimeout: { severity: "error", summary: "Timeout is zero, negative or not a finite number." },
  invalidLoopBounds: { severity: "error", summary: "Loop iteration bound is outside 1…1000." },
  unsupportedOperator: { severity: "error", summary: "Condition operator is not a known operator." },
  unsupportedConfiguration: { severity: "error", summary: "A configuration literal is outside its permitted set." },
  connectorStructure: { severity: "error", summary: "Structural connector rule (wrapped validateConnectorStructure)." },
  highTimeout: { severity: "warning", summary: "Timeout is unusually high." },
  largeLoopBounds: { severity: "warning", summary: "Loop bound is large enough to make an unattended run very long." },
  locatorNeedsReview: { severity: "error", summary: "Step locator requires manual review or fallback approval before execution." }
};

const RULE_ORDER: readonly FlowValidationCode[] = Object.keys(FLOW_VALIDATION_RULES) as FlowValidationCode[];
const RULE_INDEX: ReadonlyMap<FlowValidationCode, number> = new Map(RULE_ORDER.map((code, index) => [code, index]));

/** How a described fix would change the profile. The engine never performs one. */
export type SafeFixKind =
  /** Rewrite an enum literal that differs from a legal value only by casing/separators. */
  | "normalizeEnumCasing"
  /** Assign a fresh id where no reference to the old id is ambiguous. */
  | "regenerateId";

/**
 * Metadata describing a deterministic, execution-preserving schema fix.
 *
 * Present only where the correction cannot change what the flow does. Its absence is meaningful:
 * an issue with no `safeFix` requires a human decision and must never be auto-corrected.
 */
export interface SafeFix {
  readonly kind: SafeFixKind;
  /** Dotted path of the field the fix would rewrite, relative to its node or connector. */
  readonly field: string;
  readonly from: string;
  readonly to: string;
  readonly description: string;
}

export interface FlowValidationIssue {
  readonly code: FlowValidationCode;
  readonly severity: FlowValidationSeverity;
  /**
   * Whether the offending object sits on the execution path reachable from Start.
   *
   * `true` for flow-level structural issues (they always affect execution) and for any issue whose
   * node/connector is reachable. `false` for issues on orphaned objects. When the flow has no
   * single Start node, reachability is unknowable and this is conservatively `true` — an
   * unprovable off-path claim must never be used to let a broken flow run.
   */
  readonly onActivePath: boolean;
  /** Flow the issue belongs to. Always set, so issues from a set stay attributable when merged. */
  readonly flowId: string;
  /** Node the issue anchors to, when it anchors to one. */
  readonly nodeId?: string;
  /** Connector the issue anchors to, when it anchors to one. */
  readonly edgeId?: string;
  /** For connector issues: the connector's endpoints, so the UI can highlight both (Stage 2b). */
  readonly sourceNodeId?: string;
  readonly targetNodeId?: string;
  readonly message: string;
  readonly safeFix?: SafeFix;
}

export interface FlowValidationReport {
  readonly flowId: string;
  /** Deterministically ordered: by rule declaration order, then node id, connector id, message. */
  readonly issues: readonly FlowValidationIssue[];
  /** Forward-BFS result from Start. Empty when the flow has no single Start node. */
  readonly reachableNodeIds: ReadonlySet<string>;
  /**
   * False when the flow has no single Start node, so reachability could not be computed. Callers
   * must not read "not reachable" as "off the active path" in that case.
   */
  readonly reachabilityKnown: boolean;
  readonly startNodeId?: string;
}

export interface FlowValidationContext {
  /**
   * Flow ids a `runFlow` step may target. When omitted the reference check is **skipped** — an
   * absent set means "the caller does not know the flow library", never "no flow exists".
   */
  readonly referenceableFlowIds?: ReadonlySet<string>;
}

/* ------------------------------------------------------------------ *
 * Report helpers
 *
 * Standalone functions rather than methods on the report, so a report stays a plain serializable
 * object — validation reports are written to disk by the verifier and will be emitted by the CLI.
 * ------------------------------------------------------------------ */

export function errorsOf(report: FlowValidationReport): readonly FlowValidationIssue[] {
  return report.issues.filter((issue) => issue.severity === "error");
}

export function warningsOf(report: FlowValidationReport): readonly FlowValidationIssue[] {
  return report.issues.filter((issue) => issue.severity === "warning");
}

/** Errors on the reachable execution path — the set a run gate blocks on from Stage 2b. */
export function activePathErrorsOf(report: FlowValidationReport): readonly FlowValidationIssue[] {
  return report.issues.filter((issue) => issue.severity === "error" && issue.onActivePath);
}

export function hasActivePathError(report: FlowValidationReport): boolean {
  return report.issues.some((issue) => issue.severity === "error" && issue.onActivePath);
}

/** Errors that exist only off the reachable path — the Legacy-Compatibility-tolerable set (2c). */
export function offPathErrorsOf(report: FlowValidationReport): readonly FlowValidationIssue[] {
  return report.issues.filter((issue) => issue.severity === "error" && !issue.onActivePath);
}

/**
 * Whether one issue must block execution — THE blocking policy, used by the run gate, the
 * designer's Not-Runnable badge and the library status so they can never disagree.
 *
 * Blocking = an error that is on the active path, **plus** every `connectorStructure` error
 * regardless of path: `FlowExecutor` refuses to execute a flow carrying any structural connector
 * violation flow-wide (FlowExecutor.ts:69-72), so letting an off-path one through the gate would
 * only convert a clear pre-run message into an immediate runtime failure.
 *
 * Warnings never block. Off-path errors (other than connector structure) never block — they are
 * the Legacy-Compatibility-tolerable set that Stage 2c gives an explicit status.
 */
export function isExecutionBlocking(issue: FlowValidationIssue): boolean {
  if (issue.severity !== "error") return false;
  return issue.onActivePath || issue.code === "connectorStructure";
}

/** The subset of a report's issues that block execution. */
export function executionBlockingErrorsOf(report: FlowValidationReport): readonly FlowValidationIssue[] {
  return report.issues.filter(isExecutionBlocking);
}

/* ------------------------------------------------------------------ *
 * Permitted literal sets
 *
 * Exhaustive `Record`s rather than arrays: `tsc --noEmit` then fails when a union in FlowProfile.ts
 * grows without this engine being taught the new member, which is how the hardcoded list in
 * PreRunValidator.ts:55 was able to drift in the first place.
 * ------------------------------------------------------------------ */

const CONDITION_OPERATORS: Record<ConnectorConditionOperator, true> = {
  always: true,
  equals: true,
  notEquals: true,
  contains: true,
  notContains: true,
  exists: true,
  notExists: true,
  greaterThan: true,
  greaterThanOrEqual: true,
  lessThan: true,
  lessThanOrEqual: true,
  truthy: true,
  falsy: true
};

const CONDITION_SOURCES: Record<ConnectorConditionSource, true> = {
  outcome: true,
  status: true,
  errorCode: true,
  variable: true,
  dataSourceValue: true
};

const LOOP_MODES: Record<LoopConnectorConfig["mode"], true> = {
  count: true,
  staticList: true,
  dataSource: true,
  whileCondition: true
};

const JOIN_MODES: Record<ParallelConnectorConfig["joinMode"], true> = { waitAll: true, waitAny: true };
const FAIL_MODES: Record<ParallelConnectorConfig["failMode"], true> = { failFast: true, collectErrors: true };
const PARALLEL_ISOLATIONS: Record<NonNullable<ParallelConnectorConfig["isolation"]>, true> = {
  sharedPage: true,
  isolatedPage: true
};

/** Casing/separator-insensitive key, for detecting a literal that is only cosmetically wrong. */
function enumKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/** enumKey → legal literal, per enum family — powers the casing-only safe fixes (Stage 2c). */
function byEnumKey(record: Record<string, true>): ReadonlyMap<string, string> {
  return new Map(Object.keys(record).map((literal) => [enumKey(literal), literal]));
}

const OPERATOR_BY_ENUM_KEY = byEnumKey(CONDITION_OPERATORS);
const SOURCE_BY_ENUM_KEY = byEnumKey(CONDITION_SOURCES);
const LOOP_MODE_BY_ENUM_KEY = byEnumKey(LOOP_MODES);
const JOIN_MODE_BY_ENUM_KEY = byEnumKey(JOIN_MODES);
const FAIL_MODE_BY_ENUM_KEY = byEnumKey(FAIL_MODES);
const ISOLATION_BY_ENUM_KEY = byEnumKey(PARALLEL_ISOLATIONS);

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isPositiveFinite(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The target flow a `runFlow` step resolves to — mirrors `StepExecutor.ts:955` exactly. */
function resolveRunFlowTarget(step: FlowStep): string | undefined {
  const target = step.flowId ?? step.config?.targetFlowId;
  return isNonEmptyString(target) ? target : undefined;
}

/**
 * Whether a step satisfies its type's value requirement.
 *
 * `runFlow` is deliberately special-cased: the runner reads `flowId`/`config.targetFlowId` and
 * never `value`, so a `runFlow` with a resolvable target but no `value` is complete, not defective.
 * Mirroring the renderer's `value`-string check here would report a defect the runner does not have.
 */
function hasRequiredValue(step: FlowStep): boolean {
  if (step.type === "runFlow") return resolveRunFlowTarget(step) !== undefined;
  if (isNonEmptyString(step.value)) return true;
  if (step.valueSource !== undefined) return true;
  // A `goto` may carry its destination as `url` instead of `value`.
  return step.type === "goto" && isNonEmptyString(step.url);
}

function labelFor(step: FlowStep): string {
  return isNonEmptyString(step.name) ? step.name : step.id;
}

/* ------------------------------------------------------------------ *
 * Reachability
 * ------------------------------------------------------------------ */

/**
 * Forward BFS from the Start node — the check the product has never had at the flow level.
 *
 * Lifted from `scripts/verify-random-generator.mts`, where the same walk has been proving the
 * generated corpus fully connected across all 9 flow patterns.
 */
function reachableFrom(edges: readonly FlowEdge[], startId: string): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }
  const seen = new Set<string>([startId]);
  const queue: string[] = [startId];
  while (queue.length > 0) {
    for (const next of adjacency.get(queue.shift() as string) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/* ------------------------------------------------------------------ *
 * The engine
 * ------------------------------------------------------------------ */

class IssueCollector {
  readonly issues: FlowValidationIssue[] = [];

  constructor(
    private readonly flowId: string,
    private readonly reachable: ReadonlySet<string>,
    private readonly reachabilityKnown: boolean
  ) {}

  /** Flow-level issue: no node or connector anchor, always on the active path. */
  flow(code: FlowValidationCode, message: string): void {
    this.issues.push({ code, severity: FLOW_VALIDATION_RULES[code].severity, onActivePath: true, flowId: this.flowId, message });
  }

  node(code: FlowValidationCode, nodeId: string, message: string, safeFix?: SafeFix): void {
    this.push(code, { nodeId }, this.isActive(nodeId), message, safeFix);
  }

  /** Connector issue. A connector is on the active path when its *source* is reachable. */
  edge(code: FlowValidationCode, edge: FlowEdge, message: string, safeFix?: SafeFix): void {
    this.push(code, { edgeId: edge.id, sourceNodeId: edge.source, targetNodeId: edge.target }, this.isActive(edge.source), message, safeFix);
  }

  /** Explicitly off-path issue (only `unreachableNode`, which is off-path by definition). */
  offPathNode(code: FlowValidationCode, nodeId: string, message: string): void {
    this.push(code, { nodeId }, false, message);
  }

  private isActive(nodeId: string): boolean {
    // Unprovable is treated as active: an unverifiable off-path claim must never excuse a defect.
    return this.reachabilityKnown ? this.reachable.has(nodeId) : true;
  }

  private push(
    code: FlowValidationCode,
    anchor: { nodeId?: string; edgeId?: string; sourceNodeId?: string; targetNodeId?: string },
    onActivePath: boolean,
    message: string,
    safeFix?: SafeFix
  ): void {
    const base = {
      code,
      severity: FLOW_VALIDATION_RULES[code].severity,
      onActivePath,
      flowId: this.flowId,
      message,
      ...anchor
    };
    this.issues.push(safeFix === undefined ? base : { ...base, safeFix });
  }
}

/** Deterministic order: rule declaration order, then node id, connector id, message. */
function compareIssues(a: FlowValidationIssue, b: FlowValidationIssue): number {
  const byRule = (RULE_INDEX.get(a.code) ?? 0) - (RULE_INDEX.get(b.code) ?? 0);
  if (byRule !== 0) return byRule;
  const byNode = (a.nodeId ?? "").localeCompare(b.nodeId ?? "", "en");
  if (byNode !== 0) return byNode;
  const byEdge = (a.edgeId ?? "").localeCompare(b.edgeId ?? "", "en");
  if (byEdge !== 0) return byEdge;
  return a.message.localeCompare(b.message, "en");
}

function validateSteps(profile: FlowProfile, nodes: readonly FlowStep[], collect: IssueCollector, context: FlowValidationContext): void {
  for (const step of nodes) {
    if (!isKnownStepType(step.type)) {
      collect.node("unsupportedConfiguration", step.id, `Step ${labelFor(step)} has an unknown type "${String(step.type)}" that the runner cannot execute.`);
      continue;
    }
    const requirement = stepRequirement(step.type);

    if (requirement.requiresLocator) {
      if (step.locator === undefined) {
        collect.node("missingRequiredLocator", step.id, `Step ${labelFor(step)} (${step.type}) requires a locator.`);
      } else if (step.locator.resolution === "needs-review" || step.locator.resolution === "invalid") {
        const reason = step.locator.reviewReason ? ` (${step.locator.reviewReason})` : "";
        collect.node("locatorNeedsReview", step.id, `Step ${labelFor(step)} has an unresolved locator${reason}: it requires review or fallback approval before execution.`);
      } else if (step.locator.resolution === "user-approved-fallback" && !isValidLocatorFallbackApproval(step)) {
        collect.node("locatorNeedsReview", step.id, `Step ${labelFor(step)} has stale or incomplete positional-fallback approval: review and approve this exact locator and context again.`);
      } else if (isPositionalLocator(step.locator) && step.locator.resolution !== "user-approved-fallback") {
        collect.node("locatorNeedsReview", step.id, `Step ${labelFor(step)} uses a positional locator that has not been explicitly approved.`);
      } else if (
        isPositionalLocator(step.locator) &&
        ["dangerousMutation", "externalCommit"].includes(resolveStepSafety(step).sideEffectLevel)
      ) {
        collect.node("locatorNeedsReview", step.id, `Step ${labelFor(step)} performs a sensitive action and cannot use a positional fallback even with approval.`);
      }
    }
    if (requirement.requiresValue && !hasRequiredValue(step)) {
      collect.node("missingRequiredValue", step.id, `Step ${labelFor(step)} (${step.type}) requires a value or value source.`);
    }

    if (step.type === "runFlow" && context.referenceableFlowIds !== undefined) {
      const target = resolveRunFlowTarget(step);
      // An absent target is reported by `missingRequiredValue`; this rule is about non-resolution.
      if (target !== undefined && !context.referenceableFlowIds.has(target)) {
        collect.node("missingFlowReference", step.id, `Step ${labelFor(step)} runs flow "${target}", which does not exist.`);
      }
    }

    validateTimeouts(step, collect);
    validateStepLoopBounds(step, collect);
  }
}

function validateTimeouts(step: FlowStep, collect: IssueCollector): void {
  const check = (value: unknown, field: string): void => {
    if (value === undefined) return;
    if (!isPositiveFinite(value)) {
      collect.node(
        "invalidTimeout",
        step.id,
        `Step ${labelFor(step)} has ${field} ${String(value)}; Playwright treats a non-positive timeout as "no timeout", so the step can hang instead of failing fast.`
      );
      return;
    }
    const timeout = value as number;
    if (timeout > FLOW_VALIDATION_LIMITS.maxTimeoutMs) {
      collect.node("highTimeout", step.id, `Step ${labelFor(step)} has ${field} ${timeout}ms, above the ${FLOW_VALIDATION_LIMITS.maxTimeoutMs}ms runtime clamp — it will be reduced at run time.`);
    } else if (timeout > FLOW_VALIDATION_LIMITS.warnTimeoutMs) {
      collect.node("highTimeout", step.id, `Step ${labelFor(step)} has ${field} ${timeout}ms, which is unusually high.`);
    }
  };

  check(step.timeoutMs, "a timeout of");
  for (const [index, wait] of (step.beforeWaits ?? []).entries()) check(wait.timeoutMs, `a before-wait[${index}] timeout of`);
  for (const [index, wait] of (step.afterWaits ?? []).entries()) check(wait.timeoutMs, `an after-wait[${index}] timeout of`);
}

function validateStepLoopBounds(step: FlowStep, collect: IssueCollector): void {
  const check = (value: unknown, field: string): void => {
    if (value === undefined) return;
    if (!isPositiveFinite(value) || (value as number) > FLOW_VALIDATION_LIMITS.maxLoopIterations) {
      collect.node(
        "invalidLoopBounds",
        step.id,
        `Step ${labelFor(step)} has ${field} ${String(value)}; it must be between 1 and ${FLOW_VALIDATION_LIMITS.maxLoopIterations}.`
      );
      return;
    }
    if ((value as number) > FLOW_VALIDATION_LIMITS.warnLoopIterations) {
      collect.node("largeLoopBounds", step.id, `Step ${labelFor(step)} has ${field} ${String(value)}, which will make an unattended run very long.`);
    }
  };

  check(step.loop?.maxIterations, "a loop max-iterations of");
  check(step.config?.iterationCount, "a loop iteration count of");
  check(step.config?.maxIterations, "a loop max-iterations of");
}

/** Casing-only safe fix for an enum literal, or undefined when the literal is genuinely unknown. */
function casingFix(field: string, literal: string, legalByKey: ReadonlyMap<string, string>, noun: string): SafeFix | undefined {
  const normalized = legalByKey.get(enumKey(literal));
  return normalized === undefined
    ? undefined
    : {
        kind: "normalizeEnumCasing",
        field,
        from: literal,
        to: normalized,
        description: `"${literal}" differs from the legal ${noun} "${normalized}" only by casing or separators.`
      };
}

function validateConditional(
  conditional: ConditionalConnectorConfig,
  edge: FlowEdge,
  where: "condition" | "loop condition",
  collect: IssueCollector
): void {
  // Stage 2c note: this prefix is CONSUMED by SafeFixApplier.setEnumField — it must name the real
  // property path on the edge. (Stage 2a shipped these two inverted; harmless while the metadata
  // was descriptive-only, caught the moment an applier existed. verify-legacy-compat pins both.)
  const fieldPrefix = where === "condition" ? "conditional" : "loop.condition";

  const operator = conditional.operator as string | undefined;
  if (operator !== undefined && !(operator in CONDITION_OPERATORS)) {
    collect.edge(
      "unsupportedOperator",
      edge,
      `Connector ${edge.id} ${where} uses operator "${operator}", which is not a known operator — the condition can never match, so the branch is silently skipped.`,
      casingFix(`${fieldPrefix}.operator`, operator, OPERATOR_BY_ENUM_KEY, "operator")
    );
  }

  const source = conditional.sourceField as string | undefined;
  if (source !== undefined && !(source in CONDITION_SOURCES)) {
    collect.edge(
      "unsupportedConfiguration",
      edge,
      `Connector ${edge.id} ${where} reads from "${source}", which is not a known condition source.`,
      casingFix(`${fieldPrefix}.sourceField`, source, SOURCE_BY_ENUM_KEY, "condition source")
    );
  }
}

function validateEdges(profile: FlowProfile, edges: readonly FlowEdge[], nodeIds: ReadonlySet<string>, collect: IssueCollector): void {
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      collect.edge("brokenConnectorEndpoint", edge, `Connector ${edge.id} starts at node "${edge.source}", which does not exist.`);
    }
    if (!nodeIds.has(edge.target)) {
      collect.edge("brokenConnectorEndpoint", edge, `Connector ${edge.id} points at node "${edge.target}", which does not exist — execution walks off the graph and the branch ends silently.`);
    }

    if (edge.conditional) validateConditional(edge.conditional, edge, "condition", collect);

    if (edge.loop) {
      const mode = edge.loop.mode as string | undefined;
      if (mode !== undefined && !(mode in LOOP_MODES)) {
        collect.edge(
          "unsupportedConfiguration",
          edge,
          `Loop connector ${edge.id} uses mode "${mode}", which is not a known loop mode.`,
          casingFix("loop.mode", mode, LOOP_MODE_BY_ENUM_KEY, "loop mode")
        );
      }
      if (edge.loop.condition) validateConditional(edge.loop.condition, edge, "loop condition", collect);
      validateEdgeLoopBound(edge, edge.loop.maxIterations, "max iterations", collect);
    }
    validateEdgeLoopBound(edge, edge.maxLoopCount, "max loop count", collect);

    if (edge.parallel) {
      const { joinMode, failMode, isolation } = edge.parallel;
      if (joinMode !== undefined && !((joinMode as string) in JOIN_MODES)) {
        collect.edge(
          "unsupportedConfiguration",
          edge,
          `Parallel connector ${edge.id} uses join mode "${joinMode}", which is not a known join mode.`,
          casingFix("parallel.joinMode", joinMode as string, JOIN_MODE_BY_ENUM_KEY, "join mode")
        );
      }
      if (failMode !== undefined && !((failMode as string) in FAIL_MODES)) {
        collect.edge(
          "unsupportedConfiguration",
          edge,
          `Parallel connector ${edge.id} uses fail mode "${failMode}", which is not a known fail mode.`,
          casingFix("parallel.failMode", failMode as string, FAIL_MODE_BY_ENUM_KEY, "fail mode")
        );
      }
      if (isolation !== undefined && !((isolation as string) in PARALLEL_ISOLATIONS)) {
        collect.edge(
          "unsupportedConfiguration",
          edge,
          `Parallel connector ${edge.id} uses isolation "${isolation}", which is not a known isolation mode.`,
          casingFix("parallel.isolation", isolation as string, ISOLATION_BY_ENUM_KEY, "isolation mode")
        );
      }
    }
  }
}

function validateEdgeLoopBound(edge: FlowEdge, value: number | undefined, field: string, collect: IssueCollector): void {
  if (value === undefined) return;
  if (!isPositiveFinite(value) || value > FLOW_VALIDATION_LIMITS.maxLoopIterations) {
    collect.edge(
      "invalidLoopBounds",
      edge,
      `Loop connector ${edge.id} has ${field} ${String(value)}; it must be between 1 and ${FLOW_VALIDATION_LIMITS.maxLoopIterations}. A 0 silently skips the body and an over-cap value is silently truncated at run time.`
    );
    return;
  }
  if (value > FLOW_VALIDATION_LIMITS.warnLoopIterations) {
    collect.edge("largeLoopBounds", edge, `Loop connector ${edge.id} has ${field} ${value}, which will make an unattended run very long.`);
  }
}

function validateDuplicateIds(nodes: readonly FlowStep[], edges: readonly FlowEdge[], collect: IssueCollector): void {
  const nodeCounts = new Map<string, number>();
  for (const step of nodes) nodeCounts.set(step.id, (nodeCounts.get(step.id) ?? 0) + 1);
  for (const [id, count] of nodeCounts) {
    if (count > 1) {
      // No safe fix: connectors reference node ids, so which node an edge meant is unknowable.
      collect.node("duplicateNodeId", id, `${count} nodes share the id "${id}" — connector routing and per-node run records both key off it, so routing and reporting are corrupted.`);
    }
  }

  const edgeCounts = new Map<string, number>();
  for (const edge of edges) edgeCounts.set(edge.id, (edgeCounts.get(edge.id) ?? 0) + 1);
  for (const [id, count] of edgeCounts) {
    if (count > 1) {
      const duplicate = edges.find((edge) => edge.id === id) as FlowEdge;
      collect.edge("duplicateEdgeId", duplicate, `${count} connectors share the id "${id}".`, {
        kind: "regenerateId",
        field: "id",
        from: id,
        to: `${id}-2`,
        description: "Connector ids are not referenced by anything else, so regenerating the duplicate cannot change routing."
      });
    }
  }
}

/**
 * Validate one flow definition.
 *
 * Never mutates `profile`. Tolerates a malformed profile (non-array `nodes`/`edges`, unknown step
 * types, missing fields) because the profiles that most need validating are exactly the hand-edited
 * and imported ones that TypeScript never checked.
 */
export function validateFlowDefinition(profile: FlowProfile, context: FlowValidationContext = {}): FlowValidationReport {
  const nodes: readonly FlowStep[] = Array.isArray(profile.nodes) ? profile.nodes : [];
  const edges: readonly FlowEdge[] = Array.isArray(profile.edges) ? profile.edges : [];
  const flowId = profile.id;

  const startNodes = nodes.filter((step) => step.type === "start");
  const endNodes = nodes.filter((step) => step.type === "end");
  const startNodeId = startNodes.length === 1 ? (startNodes[0] as FlowStep).id : undefined;
  const reachabilityKnown = startNodeId !== undefined;
  const reachableNodeIds: ReadonlySet<string> = reachabilityKnown ? reachableFrom(edges, startNodeId) : new Set<string>();

  const collect = new IssueCollector(flowId, reachableNodeIds, reachabilityKnown);

  // ── Structure ──────────────────────────────────────────────────────────────
  if (startNodes.length === 0) collect.flow("missingStartNode", "Flow requires exactly one Start node and has none.");
  if (startNodes.length > 1) collect.flow("multipleStartNodes", `Flow requires exactly one Start node and has ${startNodes.length}; which one runs is ambiguous.`);
  if (endNodes.length === 0) {
    collect.flow("missingEndNode", "Flow requires at least one End node; without one it runs to a dead end and reports completion without reaching a terminal node.");
  } else if (reachabilityKnown && !endNodes.some((step) => reachableNodeIds.has(step.id))) {
    collect.flow("unreachableEndNode", "No End node is reachable from Start, so the flow cannot complete deterministically.");
  }

  validateDuplicateIds(nodes, edges, collect);

  const nodeIds = new Set(nodes.map((step) => step.id));
  validateEdges(profile, edges, nodeIds, collect);

  // ── Reachability ───────────────────────────────────────────────────────────
  if (reachabilityKnown) {
    for (const step of nodes) {
      if (!reachableNodeIds.has(step.id)) {
        collect.offPathNode(
          "unreachableNode",
          step.id,
          `Step ${labelFor(step)} cannot be reached from Start — it never runs, and nothing reports that at run time.`
        );
      }
    }
  }

  // ── Steps ──────────────────────────────────────────────────────────────────
  validateSteps(profile, nodes, collect, context);

  // ── Wrapped legacy gate ────────────────────────────────────────────────────
  // `validateConnectorStructureDetailed` is the existing, runtime-enforced connector gate. It is
  // wrapped rather than reimplemented so this engine cannot disagree with what the runner already
  // blocks. Since Stage 2b the findings are structured, so each issue anchors to its connector (or
  // to the over-connected node for the per-node degree rule) and classifies honestly by
  // reachability. NOTE: the run gate still blocks every `connectorStructure` error regardless of
  // path — see `isExecutionBlocking` — because the runtime refuses such flows flow-wide.
  for (const finding of validateConnectorStructureDetailed(edges as FlowEdge[])) {
    if (finding.edgeId !== undefined) {
      const anchor: FlowEdge = { id: finding.edgeId, source: finding.sourceNodeId, target: finding.targetNodeId ?? finding.sourceNodeId, type: "success" };
      collect.edge("connectorStructure", anchor, finding.message);
    } else {
      collect.node("connectorStructure", finding.sourceNodeId, finding.message);
    }
  }

  const issues = [...collect.issues].sort(compareIssues);
  return startNodeId === undefined
    ? { flowId, issues, reachableNodeIds, reachabilityKnown }
    : { flowId, issues, reachableNodeIds, reachabilityKnown, startNodeId };
}

/* ------------------------------------------------------------------ *
 * Flow sets (nested / referenced flows)
 * ------------------------------------------------------------------ */

export interface FlowSetValidationReport {
  /** One report per input flow, in input order. */
  readonly reports: readonly FlowValidationReport[];
  readonly byFlowId: ReadonlyMap<string, FlowValidationReport>;
  /** Set-level issues (duplicate flow ids, reference cycles), deterministically ordered. */
  readonly issues: readonly FlowValidationIssue[];
}

/**
 * Validate a set of flows that can reference one another.
 *
 * Supplies `referenceableFlowIds` automatically, so a `runFlow` step is resolved against the real
 * library rather than being skipped, and adds the two rules that only exist across flows: duplicate
 * flow ids, and `runFlow` reference cycles (which the runner can only discover by hitting its
 * depth-5 recursion guard mid-run).
 */
export function validateFlowSet(profiles: readonly FlowProfile[], context: FlowValidationContext = {}): FlowSetValidationReport {
  const availableIds = new Set<string>(context.referenceableFlowIds ?? []);
  for (const profile of profiles) availableIds.add(profile.id);

  const reports = profiles.map((profile) => validateFlowDefinition(profile, { ...context, referenceableFlowIds: availableIds }));
  const byFlowId = new Map(reports.map((report) => [report.flowId, report]));

  const issues: FlowValidationIssue[] = [];

  const flowCounts = new Map<string, number>();
  for (const profile of profiles) flowCounts.set(profile.id, (flowCounts.get(profile.id) ?? 0) + 1);
  for (const [id, count] of flowCounts) {
    if (count > 1) {
      issues.push({
        code: "duplicateFlowId",
        severity: FLOW_VALIDATION_RULES.duplicateFlowId.severity,
        onActivePath: true,
        flowId: id,
        message: `${count} flows share the id "${id}"; which one a reference resolves to is ambiguous.`
      });
    }
  }

  issues.push(...detectReferenceCycles(profiles));

  return { reports, byFlowId, issues: issues.sort(compareIssues) };
}

/**
 * Depth-first search over `runFlow` references. A cycle always exhausts the runner's depth-5
 * recursion guard mid-run, so it is an error rather than a warning. Flows outside `profiles` are
 * simply not traversed — a partial set can hide a cycle, but can never invent one.
 */
function detectReferenceCycles(profiles: readonly FlowProfile[]): FlowValidationIssue[] {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const issues: FlowValidationIssue[] = [];
  const reported = new Set<string>();
  const state = new Map<string, "visiting" | "done">();

  const visit = (flowId: string, stack: readonly string[]): void => {
    if (state.get(flowId) === "done") return;
    const profile = byId.get(flowId);
    if (!profile) return;

    if (state.get(flowId) === "visiting") return;
    state.set(flowId, "visiting");

    for (const step of Array.isArray(profile.nodes) ? profile.nodes : []) {
      if (step.type !== "runFlow") continue;
      const target = resolveRunFlowTarget(step);
      if (target === undefined || !byId.has(target)) continue;

      if (stack.includes(target) || target === flowId) {
        const key = `${flowId}::${step.id}`;
        if (!reported.has(key)) {
          reported.add(key);
          issues.push({
            code: "flowReferenceCycle",
            severity: FLOW_VALIDATION_RULES.flowReferenceCycle.severity,
            onActivePath: true,
            flowId,
            nodeId: step.id,
            message: `Step ${labelFor(step)} runs flow "${target}", closing the reference cycle ${[...stack, flowId, target].join(" → ")}; the runner can only stop this by exhausting its depth-5 recursion guard mid-run.`
          });
        }
        continue;
      }
      visit(target, [...stack, flowId]);
    }
    state.set(flowId, "done");
  };

  for (const profile of profiles) visit(profile.id, []);
  return issues;
}
