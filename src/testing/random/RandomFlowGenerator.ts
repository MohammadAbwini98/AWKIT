/**
 * Valid-by-construction flow generation for the Randomized Automation Test Lab.
 *
 * Graphs are built from a **pattern library**, not by wiring random edges between random nodes.
 * An arbitrary random graph is overwhelmingly likely to be invalid, so a fuzzer built that way
 * spends all its time re-discovering that the validators work. Patterns instead guarantee:
 *
 *  - exactly one `start` node, with no incoming edge;
 *  - at least one reachable `end` node, with no outgoing edge;
 *  - every non-start node reachable from `start`, every non-end node with an outgoing edge;
 *  - unique node and edge ids;
 *  - no unintended cycles — the only back-edges are a bounded structured self-loop and a
 *    `maxLoopCount`-bounded legacy `loopBack`;
 *  - conformance with `validateConnectorStructure` (`src/profiles/FlowProfile.ts`):
 *      * a structured `loop` connector is always a self-loop,
 *      * at most one standard (non-conditional / non-parallel) outgoing edge per node,
 *      * a node carrying a self-loop routes every other outgoing edge as `conditional`;
 *  - conformance with the designer's advisory `validateFlow`: required locators and values are
 *    present, conditional connectors carry an expected value when their operator needs one and a
 *    variable name when their source needs one, and sibling conditionals get distinct priorities.
 *
 * The branch fan-out is capped at 2 because `MAX_BRANCH_CONNECTORS`
 * (`app/renderer/components/shared/connectorStyle.ts`) is a hard port-count cap on same-kind
 * outgoing connectors. Three-way branching is expressed by chaining two condition nodes, which is
 * what a user would have to do in the designer.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type {
  ConditionalConnectorConfig,
  ConnectorKind,
  FlowEdge,
  FlowEdgeType,
  FlowProfile,
  FlowStep,
  LoopConnectorConfig,
  ParallelConnectorConfig,
  StepType
} from "../../profiles/FlowProfile";
import type { MockPageFixture } from "../fixtures/SafeTestData";
import {
  ALL_CONDITION_OPERATORS,
  ALL_CONDITION_SOURCES,
  CONDITION_OPERATOR_CATALOG,
  CONDITION_SOURCE_CATALOG
} from "./ConnectorCatalog";
import type { CoverageTracker } from "./CoverageTracker";
import type { FlowPatternName, ResolvedGenerationConstraints } from "./GenerationConstraints";
import { actionNodeWeights } from "./GenerationConstraints";
import {
  buildStepPayload,
  pageForType,
  pageSupports,
  pickPage,
  type ConfigurationContext
} from "./RandomConfigurationGenerator";
import type { SeededRandom } from "./SeededRandom";
import type { WeightedOption } from "./SeededRandom";

export interface GeneratedFlow {
  readonly profile: FlowProfile;
  readonly pattern: FlowPatternName;
  /** The exact seed this flow was derived from — reproduces it in isolation. */
  readonly seed: string;
}

export interface FlowGenerationRequest {
  readonly flowId: string;
  readonly flowName: string;
  readonly rng: SeededRandom;
  readonly constraints: ResolvedGenerationConstraints;
  /** Flow ids a `runFlow` node may target. Never contains `flowId` itself. */
  readonly referenceableFlowIds?: readonly string[];
  readonly coverage?: CoverageTracker;
  /** Force a specific pattern instead of drawing one from `constraints.patterns`. */
  readonly pattern?: FlowPatternName;
}

/** Edge shape a pattern asks the builder for. */
interface EdgeSpec {
  /**
   * Omitted for a genuine *legacy* edge, whose kind `connectorKind()` derives from `type`.
   * This distinction is load-bearing: `validateConnectorStructure` treats an explicit
   * `kind: "loop"` as a structured self-only loop, while a legacy `loopBack` (no `kind`) is an
   * intentional cross-node back-edge and is exempt.
   */
  readonly kind?: ConnectorKind;
  readonly type: FlowEdgeType;
  readonly conditional?: ConditionalConnectorConfig;
  readonly parallel?: ParallelConnectorConfig;
  readonly loop?: LoopConnectorConfig;
  readonly maxLoopCount?: number;
  readonly label?: string;
}

class FlowGraphBuilder {
  readonly nodes: FlowStep[] = [];

  readonly edges: FlowEdge[] = [];

  private nodeCount = 0;

  private edgeCount = 0;

  constructor(private readonly flowId: string) {}

  addStep(type: StepType, payload: Omit<FlowStep, "id" | "name" | "position">): FlowStep {
    const index = this.nodeCount;
    this.nodeCount += 1;
    const step: FlowStep = {
      ...payload,
      id: `${this.flowId}-n${index}`,
      type,
      name: `${type}-${index}`,
      // Deterministic layout: a readable left-to-right ladder, never random.
      position: { x: 120 + (index % 4) * 360, y: 120 + Math.floor(index / 4) * 180 }
    };
    this.nodes.push(step);
    return step;
  }

  connect(source: string, target: string, spec: EdgeSpec): FlowEdge {
    const index = this.edgeCount;
    this.edgeCount += 1;
    const edge: FlowEdge = {
      id: `${this.flowId}-e${index}`,
      source,
      target,
      type: spec.type
    };
    if (spec.kind) edge.kind = spec.kind;
    if (spec.conditional) edge.conditional = spec.conditional;
    if (spec.parallel) edge.parallel = spec.parallel;
    if (spec.loop) edge.loop = spec.loop;
    if (spec.maxLoopCount !== undefined) edge.maxLoopCount = spec.maxLoopCount;
    if (spec.label) edge.label = spec.label;
    this.edges.push(edge);
    return edge;
  }
}

interface PatternContext {
  readonly builder: FlowGraphBuilder;
  readonly rng: SeededRandom;
  readonly constraints: ResolvedGenerationConstraints;
  readonly coverage?: CoverageTracker;
  readonly actionWeights: WeightedOption<StepType>[];
  readonly referenceableFlowIds: readonly string[];
  page: MockPageFixture;
  depth: number;
}

function configContext(ctx: PatternContext): ConfigurationContext {
  const base = {
    constraints: ctx.constraints,
    rng: ctx.rng,
    page: ctx.page,
    referenceableFlowIds: ctx.referenceableFlowIds
  };
  return ctx.coverage ? { ...base, coverage: ctx.coverage } : base;
}

/** Add one action node of a weighted-random type, fully configured. */
function addAction(ctx: PatternContext, forcedType?: StepType): FlowStep {
  const type = forcedType ?? ctx.rng.pickWeighted(ctx.actionWeights);
  // A `goto` re-points the fixture page for every step that follows it, so locators stay resolvable.
  if (type === "goto") ctx.page = pickPage(ctx.rng);
  // A step needing a control the current page does not have (a <select>, a radio group) moves to a
  // page that does. Falling back to an arbitrary element would generate a locator that resolves but
  // cannot be acted on, which fails only later, in Phase 5, with a far worse diagnostic.
  else if (!pageSupports(ctx.page, type)) ctx.page = pageForType(ctx.rng, type) ?? ctx.page;
  const payload = buildStepPayload(type, configContext(ctx));
  ctx.coverage?.recordGenerated("nodeType", type);
  return ctx.builder.addStep(type, payload);
}

/** A `normal` edge, occasionally emitted in one of its legacy wire forms to cover all four. */
function normalEdgeSpec(ctx: PatternContext): EdgeSpec {
  const type = ctx.rng.pickWeighted<FlowEdgeType>([
    { value: "success", weight: 12 },
    { value: "always", weight: 3 },
    { value: "failure", weight: 2 },
    { value: "manualApproval", weight: 1 }
  ]);
  ctx.coverage?.recordGenerated("edgeType", type);
  ctx.coverage?.recordGenerated("connectorKind", "normal");
  return { kind: "normal", type };
}

/**
 * A conditional connector whose config satisfies the designer's advisory rules: an expected value
 * whenever the operator needs one, and a variable name whenever the source needs one.
 */
function conditionalEdgeSpec(ctx: PatternContext, priority: number): EdgeSpec {
  const operator = ctx.rng.pick(ALL_CONDITION_OPERATORS);
  const source = ctx.rng.pick(ALL_CONDITION_SOURCES);
  const operatorSpec = CONDITION_OPERATOR_CATALOG[operator];
  const sourceSpec = CONDITION_SOURCE_CATALOG[source];

  const conditional: ConditionalConnectorConfig = { sourceField: source, operator, priority };
  if (operatorSpec.requiresExpectedValue) {
    conditional.expectedValue = operatorSpec.numeric ? ctx.rng.int(1, 100) : ctx.rng.pick(["success", "failure", "lab-alpha"]);
  }
  if (sourceSpec.requiresVariableName) {
    conditional.variableName = `outputs.lab.${ctx.rng.pick(["status", "code", "value"])}`;
  }

  // `outcome` is the legacy wire form of a conditional connector; both derive kind "conditional".
  const type: FlowEdgeType = ctx.rng.bool(0.25) ? "outcome" : "conditional";
  ctx.coverage?.recordGenerated("edgeType", type);
  ctx.coverage?.recordGenerated("connectorKind", "conditional");
  ctx.coverage?.recordGenerated("conditionOperator", operator);
  ctx.coverage?.recordGenerated("conditionSource", source);
  return { kind: "conditional", type, conditional };
}

function parallelEdgeSpec(ctx: PatternContext, config: ParallelConnectorConfig): EdgeSpec {
  ctx.coverage?.recordGenerated("edgeType", "parallel");
  ctx.coverage?.recordGenerated("connectorKind", "parallel");
  ctx.coverage?.recordGenerated("joinMode", config.joinMode);
  ctx.coverage?.recordGenerated("failMode", config.failMode);
  if (config.isolation) ctx.coverage?.recordGenerated("isolationMode", config.isolation);
  return { kind: "parallel", type: "parallel", parallel: config };
}

function loopEdgeSpec(ctx: PatternContext): EdgeSpec {
  const mode = ctx.rng.pickWeighted<LoopConnectorConfig["mode"]>([
    { value: "count", weight: 8 },
    { value: "staticList", weight: 5 },
    { value: "whileCondition", weight: 3 }
  ]);
  const loop: LoopConnectorConfig = {
    mode,
    maxIterations: ctx.rng.int(1, ctx.constraints.maxLoopIterations),
    parameterName: "labLoopValue"
  };
  if (mode === "staticList") loop.staticValues = ["lab-alpha", "lab-bravo"];
  if (mode === "whileCondition") {
    loop.condition = { sourceField: "outcome", operator: "equals", expectedValue: "success", priority: 0 };
  }
  ctx.coverage?.recordGenerated("edgeType", "loop");
  ctx.coverage?.recordGenerated("connectorKind", "loop");
  ctx.coverage?.recordGenerated("loopMode", mode);
  return { kind: "loop", type: "loop", loop };
}

/**
 * Chain `count` action nodes after `entry`. The first edge uses `firstEdge` when supplied,
 * which is how a branch body attaches to its conditional/parallel connector.
 */
function chain(ctx: PatternContext, entry: string, count: number, firstEdge?: EdgeSpec): string {
  let current = entry;
  for (let index = 0; index < count; index += 1) {
    const node = addAction(ctx);
    ctx.builder.connect(current, node.id, index === 0 && firstEdge ? firstEdge : normalEdgeSpec(ctx));
    current = node.id;
  }
  if (count === 0 && firstEdge) {
    // Caller wanted a branch edge but had no budget for a body: they must connect it themselves.
    throw new Error("chain() cannot apply firstEdge with a count of 0.");
  }
  return current;
}

/** Split a node budget across `parts`, giving every part at least 1. */
function splitBudget(total: number, parts: number): number[] {
  const each = Math.max(1, Math.floor(total / parts));
  return Array.from({ length: parts }, () => each);
}

type PatternFn = (ctx: PatternContext, entry: string, budget: number) => string;

const linear: PatternFn = (ctx, entry, budget) => chain(ctx, entry, Math.max(1, budget));

const conditionalSplit: PatternFn = (ctx, entry, budget) => {
  const branchNode = addAction(ctx, "condition");
  ctx.builder.connect(entry, branchNode.id, normalEdgeSpec(ctx));

  const bodyBudget = Math.max(2, budget - 2);
  const parts = splitBudget(bodyBudget, 2);
  const tails = parts.map((part, index) => chain(ctx, branchNode.id, part, conditionalEdgeSpec(ctx, index)));

  const join = addAction(ctx);
  for (const tail of tails) ctx.builder.connect(tail, join.id, normalEdgeSpec(ctx));
  return join.id;
};

const multiConditionBranch: PatternFn = (ctx, entry, budget) => {
  const first = addAction(ctx, "condition");
  ctx.builder.connect(entry, first.id, normalEdgeSpec(ctx));

  const second = addAction(ctx, "condition");
  // Second condition node hangs off the first branch port — this is how >2 outcomes are expressed
  // without exceeding MAX_BRANCH_CONNECTORS.
  ctx.builder.connect(first.id, second.id, conditionalEdgeSpec(ctx, 1));

  const bodyBudget = Math.max(3, budget - 4);
  const parts = splitBudget(bodyBudget, 3);
  const tails = [
    chain(ctx, first.id, parts[0] as number, conditionalEdgeSpec(ctx, 0)),
    chain(ctx, second.id, parts[1] as number, conditionalEdgeSpec(ctx, 0)),
    chain(ctx, second.id, parts[2] as number, conditionalEdgeSpec(ctx, 1))
  ];

  const join = addAction(ctx);
  for (const tail of tails) ctx.builder.connect(tail, join.id, normalEdgeSpec(ctx));
  return join.id;
};

function parallelPattern(joinMode: ParallelConnectorConfig["joinMode"]): PatternFn {
  return (ctx, entry, budget) => {
    const fork = addAction(ctx);
    ctx.builder.connect(entry, fork.id, normalEdgeSpec(ctx));

    const config: ParallelConnectorConfig = {
      joinMode,
      failMode: ctx.rng.pick(["failFast", "collectErrors"] as const),
      isolation: ctx.rng.pick(["sharedPage", "isolatedPage"] as const),
      maxConcurrency: ctx.rng.int(1, 2)
    };

    const bodyBudget = Math.max(2, budget - 2);
    const parts = splitBudget(bodyBudget, 2);
    // Both branch edges carry the same parallel config — the runtime reads join/fail/isolation
    // per fan-out group, and mismatched siblings would be an authoring defect, not a test case.
    const tails = parts.map((part) => chain(ctx, fork.id, part, parallelEdgeSpec(ctx, { ...config })));

    const join = addAction(ctx);
    for (const tail of tails) ctx.builder.connect(tail, join.id, normalEdgeSpec(ctx));
    return join.id;
  };
}

const nestedBranch: PatternFn = (ctx, entry, budget) => {
  if (ctx.depth >= ctx.constraints.maxGraphDepth) return conditionalSplit(ctx, entry, budget);

  const branchNode = addAction(ctx, "condition");
  ctx.builder.connect(entry, branchNode.id, normalEdgeSpec(ctx));

  const bodyBudget = Math.max(4, budget - 2);
  const parts = splitBudget(bodyBudget, 2);

  // Left branch: a plain body. Right branch: a nested split, one level deeper.
  const leftTail = chain(ctx, branchNode.id, parts[0] as number, conditionalEdgeSpec(ctx, 0));

  const nestedEntry = addAction(ctx);
  ctx.builder.connect(branchNode.id, nestedEntry.id, conditionalEdgeSpec(ctx, 1));
  ctx.depth += 1;
  const rightTail = conditionalSplit(ctx, nestedEntry.id, parts[1] as number);
  ctx.depth -= 1;

  const join = addAction(ctx);
  ctx.builder.connect(leftTail, join.id, normalEdgeSpec(ctx));
  ctx.builder.connect(rightTail, join.id, normalEdgeSpec(ctx));
  return join.id;
};

const boundedLoop: PatternFn = (ctx, entry, budget) => {
  const loopNode = addAction(ctx);
  ctx.builder.connect(entry, loopNode.id, normalEdgeSpec(ctx));

  // Structured loop connectors must return to the same node (validateConnectorStructure).
  ctx.builder.connect(loopNode.id, loopNode.id, loopEdgeSpec(ctx));

  // A node carrying a self-loop may only route additional outgoing edges as conditional.
  const exitEntry = addAction(ctx);
  ctx.builder.connect(loopNode.id, exitEntry.id, conditionalEdgeSpec(ctx, 0));

  const remaining = Math.max(0, budget - 3);
  return remaining > 0 ? chain(ctx, exitEntry.id, remaining) : exitEntry.id;
};

const loopWithBranch: PatternFn = (ctx, entry, budget) => {
  const afterLoop = boundedLoop(ctx, entry, Math.max(3, Math.floor(budget / 2)));
  return conditionalSplit(ctx, afterLoop, Math.max(3, budget - Math.floor(budget / 2)));
};

const PATTERN_LIBRARY: Record<Exclude<FlowPatternName, "mixed">, PatternFn> = {
  linear,
  conditionalSplit,
  multiConditionBranch,
  parallelWaitAll: parallelPattern("waitAll"),
  parallelWaitAny: parallelPattern("waitAny"),
  nestedBranch,
  boundedLoop,
  loopWithBranch
};

const mixed: PatternFn = (ctx, entry, budget) => {
  const names = Object.keys(PATTERN_LIBRARY) as Array<Exclude<FlowPatternName, "mixed">>;
  const chosen = ctx.rng.sample(names, ctx.rng.int(2, 3));
  const parts = splitBudget(budget, chosen.length);
  let current = entry;
  chosen.forEach((name, index) => {
    ctx.coverage?.recordGenerated("flowPattern", name);
    current = (PATTERN_LIBRARY[name] as PatternFn)(ctx, current, parts[index] as number);
  });
  return current;
};

/**
 * Decorate a finished graph with a legacy `loopBack` edge, which is the only remaining
 * `FlowEdgeType` the patterns do not otherwise emit.
 *
 * Legality has two parts, both load-bearing:
 *  - The edge must carry **no `kind`**. `validateConnectorStructure` treats an explicit
 *    `kind: "loop"` as a structured self-only loop and rejects it across nodes; the legacy
 *    `loopBack` *type* is exempt precisely because its kind is derived, not declared.
 *  - `connectorKind()` still derives `loop`, which counts as a *standard* outgoing edge, so the
 *    source node's other outgoing edges must all be conditional.
 *
 * Traversal is bounded by `maxLoopCount` (the runtime default is 2).
 */
function decorateWithLoopBack(ctx: PatternContext): boolean {
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of ctx.builder.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const candidates = ctx.builder.nodes.filter((node) => {
    const edges = outgoing.get(node.id) ?? [];
    return edges.length > 0 && edges.every((edge) => edge.kind === "conditional");
  });
  if (candidates.length === 0) return false;

  const source = ctx.rng.pick(candidates);
  const sourceIndex = ctx.builder.nodes.findIndex((node) => node.id === source.id);
  // Target an strictly earlier node so the edge is a genuine back-edge, and never the start node
  // (which must keep zero incoming edges).
  const earlier = ctx.builder.nodes.slice(1, sourceIndex);
  if (earlier.length === 0) return false;

  // Half are emitted without an explicit `maxLoopCount`, which is the legacy shape a hand-authored
  // or older flow carries. The runtime defaults it to 2 — and so, silently, does the designer save.
  const explicitCount = ctx.rng.bool(0.5) ? { maxLoopCount: ctx.rng.int(1, 3) } : {};
  ctx.builder.connect(source.id, ctx.rng.pick(earlier).id, {
    // No `kind` — see the legality note above.
    type: "loopBack",
    ...explicitCount
  });
  ctx.coverage?.recordGenerated("edgeType", "loopBack");
  return true;
}

export function generateFlow(request: FlowGenerationRequest): GeneratedFlow {
  const { flowId, flowName, rng, constraints, coverage } = request;
  const pattern = request.pattern ?? rng.pick(constraints.patterns);

  const builder = new FlowGraphBuilder(flowId);
  const ctx: PatternContext = {
    builder,
    rng,
    constraints,
    ...(coverage ? { coverage } : {}),
    // `runFlow` is only placeable when there is something for it to reference; otherwise it would
    // generate an empty flowId, which is a defect and belongs to the mutator instead.
    actionWeights: actionNodeWeights(constraints, {
      allowSubflow: (request.referenceableFlowIds ?? []).length > 0
    }),
    referenceableFlowIds: request.referenceableFlowIds ?? [],
    page: pickPage(rng),
    depth: 0
  };

  // start + end are reserved out of the node budget.
  const totalNodes = rng.int(constraints.minNodesPerFlow, constraints.maxNodesPerFlow);
  const budget = Math.max(1, totalNodes - 2);

  const start = builder.addStep("start", { type: "start" });
  coverage?.recordGenerated("nodeType", "start");

  const patternFn: PatternFn = pattern === "mixed" ? mixed : (PATTERN_LIBRARY[pattern] as PatternFn);
  coverage?.recordGenerated("flowPattern", pattern);
  const exit = patternFn(ctx, start.id, budget);

  const end = builder.addStep("end", { type: "end" });
  coverage?.recordGenerated("nodeType", "end");
  builder.connect(exit, end.id, normalEdgeSpec(ctx));

  // Attempted on every recorder-fidelity flow; it no-ops when the graph has no legal host node, so
  // `loopBack` coverage does not depend on an unlucky seed.
  if (constraints.recorderFidelity) decorateWithLoopBack(ctx);

  return {
    profile: {
      id: flowId,
      name: flowName,
      description: `Randomized ${pattern} flow (seed ${rng.seed})`,
      version: 1,
      nodes: builder.nodes,
      edges: builder.edges,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    pattern,
    seed: rng.seed
  };
}
