/**
 * Campaign options for the Randomized Automation Test Lab.
 *
 * Every bound here defaults *well below* the real runtime cap recorded in
 * `RUNTIME_LOOP_LIMITS` so a runaway campaign can never wedge a machine, and every value a
 * campaign can raise is clamped against an absolute ceiling in `resolveConstraints`.
 *
 * Machine capacity is deliberately NOT modelled here. Concurrency levels are a *request*; the
 * live runner (Phase 5) intersects them with `getCapacitySnapshot()` / `planCapacity()`. Nothing
 * in the lab may hardcode a core count or a memory size.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { ConnectorKind, StepType } from "../../profiles/FlowProfile";
import { RUNTIME_LOOP_LIMITS } from "./ConnectorCatalog";
import { NODE_CATALOG, type GenerationGate, type NodeRole } from "./NodeCatalog";
import type { WeightedOption } from "./SeededRandom";

/**
 * Bumped whenever generation output changes for a fixed seed. Recorded in every failure artifact
 * so a stale reproduction command fails loudly instead of silently generating a different graph.
 */
export const GENERATOR_VERSION = "1.0.0";

/** How a campaign asks for its workflows to be executed (Phase 5). */
export type ExecutionMode = "sequential" | "parallel" | "mixed";

export type BrowserMode = "headless" | "headed";

export type ArtifactPolicy = "never" | "onFailure" | "always";

/**
 * The graph shapes the generator can emit. Each is valid by construction — see
 * `RandomFlowGenerator`. Campaigns select a subset to focus coverage.
 */
export type FlowPatternName =
  | "linear"
  | "conditionalSplit"
  | "multiConditionBranch"
  | "parallelWaitAll"
  | "parallelWaitAny"
  | "nestedBranch"
  | "boundedLoop"
  | "loopWithBranch"
  | "mixed";

export const ALL_FLOW_PATTERNS: readonly FlowPatternName[] = [
  "linear",
  "conditionalSplit",
  "multiConditionBranch",
  "parallelWaitAll",
  "parallelWaitAny",
  "nestedBranch",
  "boundedLoop",
  "loopWithBranch",
  "mixed"
];

/**
 * Absolute ceilings. A campaign may tune anything below these; it may not exceed them.
 *
 * `maxNodesPerFlow` is capped low on purpose: `FlowDependencyResolver.findCycles` is a naive
 * path-DFS with no memoization, so graph size is a lab safety constraint, not just a taste call.
 */
export const CONSTRAINT_CEILINGS = {
  workflowCount: 500,
  flowsPerWorkflow: 25,
  nodesPerFlow: 120,
  graphDepth: 12,
  branches: 4,
  /** Matches the Flow Designer save gate and `LOOP_CONNECTOR_HARD_CAP`. */
  loopIterations: RUNTIME_LOOP_LIMITS.absoluteMaxLoopIterations,
  concurrency: 32,
  executionTimeoutMs: 30 * 60_000
} as const;

/** Hosts the lab will target without an explicit opt-in. Local fixtures only. */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];

/** Local Feature Test Lab default (`mock-site/server.mjs` reads `MOCK_SITE_PORT ?? 4321`). */
export const DEFAULT_BASE_URL = "http://127.0.0.1:4321";

export interface RandomTestGenerationOptions {
  seed?: string;
  workflowCount?: number;
  minFlowsPerWorkflow?: number;
  maxFlowsPerWorkflow?: number;
  minNodesPerFlow?: number;
  maxNodesPerFlow?: number;
  maxGraphDepth?: number;
  maxBranches?: number;
  maxLoopIterations?: number;
  /** 0–100. The remainder receive exactly one controlled defect (Phase 2 mutation testing). */
  validScenarioPercentage?: number;
  concurrencyLevels?: number[];
  executionModes?: ExecutionMode[];
  nodeTypeWeights?: Partial<Record<StepType, number>>;
  connectorKindWeights?: Partial<Record<ConnectorKind, number>>;
  /**
   * Opt gated node types back in. Nothing here bypasses a safety control — it only tells the
   * generator that the campaign has arranged the prerequisite (a captured session, a data source,
   * an interactive operator). `requiresHuman` types stay excluded from unattended runs.
   */
  allowedGates?: GenerationGate[];
  patterns?: FlowPatternName[];
  executionTimeoutMs?: number;
  browserMode?: BrowserMode;
  screenshotPolicy?: ArtifactPolicy;
  tracePolicy?: ArtifactPolicy;
  baseUrl?: string;
  allowedHosts?: string[];
  /**
   * Emit the metadata a Recorder-produced flow carries — popup expectations, page aliases,
   * locators on nodes that do not strictly require one, secret-backed value *references*.
   *
   * This is what makes Phase 3 round-trip testing meaningful: these are precisely the fields the
   * designer mapping is suspected of dropping. Never emits a plaintext secret — only opaque
   * references (see `RandomConfigurationGenerator`).
   */
  recorderFidelity?: boolean;
}

export interface ResolvedGenerationConstraints {
  readonly seed: string;
  readonly generatorVersion: string;
  readonly workflowCount: number;
  readonly minFlowsPerWorkflow: number;
  readonly maxFlowsPerWorkflow: number;
  readonly minNodesPerFlow: number;
  readonly maxNodesPerFlow: number;
  readonly maxGraphDepth: number;
  readonly maxBranches: number;
  readonly maxLoopIterations: number;
  readonly validScenarioPercentage: number;
  readonly concurrencyLevels: readonly number[];
  readonly executionModes: readonly ExecutionMode[];
  readonly nodeTypeWeights: Readonly<Partial<Record<StepType, number>>>;
  readonly connectorKindWeights: Readonly<Partial<Record<ConnectorKind, number>>>;
  readonly allowedGates: readonly GenerationGate[];
  readonly patterns: readonly FlowPatternName[];
  readonly executionTimeoutMs: number;
  readonly browserMode: BrowserMode;
  readonly screenshotPolicy: ArtifactPolicy;
  readonly tracePolicy: ArtifactPolicy;
  readonly baseUrl: string;
  readonly allowedHosts: readonly string[];
  readonly recorderFidelity: boolean;
}

function clampInt(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number, received ${String(value)}.`);
  }
  const rounded = Math.round(value);
  if (rounded < min) {
    throw new Error(`${label} must be >= ${min}, received ${rounded}.`);
  }
  return Math.min(rounded, max);
}

/**
 * Reject any target the campaign has not explicitly authorized.
 *
 * The lab defaults to the local mock site and refuses anything else unless the caller passes the
 * host in `allowedHosts`. This is the enforcement point referenced by the safety documentation —
 * generation itself cannot produce a `goto` outside the allowlist because every URL is built from
 * `constraints.baseUrl`.
 */
export function assertAllowedTarget(rawUrl: string, allowedHosts: readonly string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Random test target must be an absolute URL, received "${rawUrl}".`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Random test target must be http(s), received "${parsed.protocol}".`);
  }
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(
      `Random test target host "${parsed.hostname}" is not authorized. ` +
        `Allowed: ${allowedHosts.join(", ")}. Pass allowedHosts explicitly to target another host.`
    );
  }
  return parsed;
}

export function resolveConstraints(
  options: RandomTestGenerationOptions & { seed: string }
): ResolvedGenerationConstraints {
  const minFlows = clampInt(
    options.minFlowsPerWorkflow ?? 1,
    1,
    CONSTRAINT_CEILINGS.flowsPerWorkflow,
    "minFlowsPerWorkflow"
  );
  const maxFlows = clampInt(
    options.maxFlowsPerWorkflow ?? Math.max(minFlows, 3),
    1,
    CONSTRAINT_CEILINGS.flowsPerWorkflow,
    "maxFlowsPerWorkflow"
  );
  if (maxFlows < minFlows) {
    throw new Error(`maxFlowsPerWorkflow (${maxFlows}) must be >= minFlowsPerWorkflow (${minFlows}).`);
  }

  const minNodes = clampInt(
    options.minNodesPerFlow ?? 4,
    // start + one action + end is the smallest graph that exercises an edge at all.
    3,
    CONSTRAINT_CEILINGS.nodesPerFlow,
    "minNodesPerFlow"
  );
  const maxNodes = clampInt(
    options.maxNodesPerFlow ?? Math.max(minNodes, 12),
    3,
    CONSTRAINT_CEILINGS.nodesPerFlow,
    "maxNodesPerFlow"
  );
  if (maxNodes < minNodes) {
    throw new Error(`maxNodesPerFlow (${maxNodes}) must be >= minNodesPerFlow (${minNodes}).`);
  }

  const validPercentage = options.validScenarioPercentage ?? 100;
  if (!Number.isFinite(validPercentage) || validPercentage < 0 || validPercentage > 100) {
    throw new Error(`validScenarioPercentage must be within 0–100, received ${String(validPercentage)}.`);
  }

  const concurrencyLevels = (options.concurrencyLevels ?? [1, 2]).map((level, index) =>
    clampInt(level, 1, CONSTRAINT_CEILINGS.concurrency, `concurrencyLevels[${index}]`)
  );
  if (concurrencyLevels.length === 0) {
    throw new Error("concurrencyLevels must contain at least one level.");
  }

  const executionModes = options.executionModes ?? ["sequential"];
  if (executionModes.length === 0) {
    throw new Error("executionModes must contain at least one mode.");
  }

  const patterns = options.patterns ?? ALL_FLOW_PATTERNS;
  if (patterns.length === 0) {
    throw new Error("patterns must contain at least one pattern.");
  }

  const allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  // Throws before a single node is generated when the target is not authorized.
  assertAllowedTarget(baseUrl, allowedHosts);

  return {
    seed: options.seed,
    generatorVersion: GENERATOR_VERSION,
    workflowCount: clampInt(options.workflowCount ?? 1, 1, CONSTRAINT_CEILINGS.workflowCount, "workflowCount"),
    minFlowsPerWorkflow: minFlows,
    maxFlowsPerWorkflow: maxFlows,
    minNodesPerFlow: minNodes,
    maxNodesPerFlow: maxNodes,
    maxGraphDepth: clampInt(options.maxGraphDepth ?? 4, 1, CONSTRAINT_CEILINGS.graphDepth, "maxGraphDepth"),
    maxBranches: clampInt(options.maxBranches ?? 2, 1, CONSTRAINT_CEILINGS.branches, "maxBranches"),
    maxLoopIterations: clampInt(
      options.maxLoopIterations ?? RUNTIME_LOOP_LIMITS.defaultMaxLoopIterations,
      1,
      CONSTRAINT_CEILINGS.loopIterations,
      "maxLoopIterations"
    ),
    validScenarioPercentage: validPercentage,
    concurrencyLevels,
    executionModes,
    nodeTypeWeights: { ...(options.nodeTypeWeights ?? {}) },
    connectorKindWeights: { ...(options.connectorKindWeights ?? {}) },
    allowedGates: options.allowedGates ?? [],
    patterns,
    executionTimeoutMs: clampInt(
      options.executionTimeoutMs ?? 5 * 60_000,
      1_000,
      CONSTRAINT_CEILINGS.executionTimeoutMs,
      "executionTimeoutMs"
    ),
    browserMode: options.browserMode ?? "headless",
    screenshotPolicy: options.screenshotPolicy ?? "onFailure",
    tracePolicy: options.tracePolicy ?? "onFailure",
    baseUrl: baseUrl.replace(/\/+$/, ""),
    allowedHosts,
    recorderFidelity: options.recorderFidelity ?? false
  };
}

/**
 * Roles that are one-in / one-out in *graph* terms and can therefore sit anywhere in a chain.
 *
 * `loop` and `subflow` belong here even though they repeat or delegate internally: a `loop` node
 * iterates within itself and a `runFlow` node calls another flow, but neither fans out, so both
 * slot into a sequence exactly like an action. Only `start`, `terminal` and `branch` are placed by
 * the pattern library, because their edge topology is the pattern.
 */
const PLACEABLE_ROLES: readonly NodeRole[] = ["action", "loop", "subflow"];

export interface ActionWeightOptions {
  /**
   * Allow `runFlow`. Off by default: a `runFlow` with nothing to reference generates an empty
   * `flowId`, which is a *defect*, and defects belong to the mutator — never to valid-by-
   * construction generation.
   */
  readonly allowSubflow?: boolean;
}

/**
 * Node types this campaign may place inline, with their effective weights.
 *
 * A gated type contributes weight 0 unless the campaign opted its gate in — and `requiresHuman`
 * types are refused outright, because a campaign that "opts into" blocking on a human is a
 * campaign that hangs.
 */
export function actionNodeWeights(
  constraints: ResolvedGenerationConstraints,
  options: ActionWeightOptions = {}
): WeightedOption<StepType>[] {
  const result: WeightedOption<StepType>[] = [];
  for (const spec of Object.values(NODE_CATALOG)) {
    if (!PLACEABLE_ROLES.includes(spec.role)) continue;
    if (spec.role === "subflow" && options.allowSubflow !== true) continue;
    const override = constraints.nodeTypeWeights[spec.type];
    const base = override ?? spec.weight;
    if (base <= 0) continue;
    if (spec.gate === "requiresHuman") continue;
    if (spec.gate && !constraints.allowedGates.includes(spec.gate)) continue;
    result.push({ value: spec.type, weight: base });
  }
  if (result.length === 0) {
    throw new Error(
      "No action node types are generatable under these constraints — every candidate is gated or zero-weighted."
    );
  }
  return result;
}

/** Node types excluded by this campaign's gates, with the reason, for `blocked` coverage entries. */
export function blockedNodeTypes(
  constraints: ResolvedGenerationConstraints
): ReadonlyArray<{ type: StepType; reason: string }> {
  const blocked: Array<{ type: StepType; reason: string }> = [];
  for (const spec of Object.values(NODE_CATALOG)) {
    if (!spec.gate) continue;
    if (spec.gate !== "requiresHuman" && constraints.allowedGates.includes(spec.gate)) continue;
    blocked.push({
      type: spec.type,
      reason: spec.note ? `${spec.gate}: ${spec.note}` : spec.gate
    });
  }
  return blocked;
}
