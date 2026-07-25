/**
 * Multi-flow workflow generation for the Randomized Automation Test Lab.
 *
 * A workflow is a `start` sentinel → N `flowRef` nodes → `end` sentinel, wired sequentially.
 * That shape is deliberate, and narrower than the flow-level generator, for two reasons found in
 * the audit (`docs/testing/RANDOMIZED_TESTING_ARCHITECTURE.md`):
 *
 *  1. **`WorkflowEdge` has no structured connector config** (`WorkflowProfile.ts:51-61`) — there is
 *     no workflow-level conditional/parallel/loop configuration to generate. Emitting a
 *     `conditional` edge `type` here would produce a connector nothing reads.
 *  2. **`ScenarioProfile.executionMode` and `maxParallelFlows` are dead at runtime**
 *     (`ScenarioProfile.ts:24-25`). The generator still varies them so persistence and the builder
 *     UI are exercised, but the coverage tracker records them as `blocked` for the *execution*
 *     stage so no campaign can claim to have proven parallel workflow execution.
 *
 * `runFlow` nesting is capped strictly below the runner's depth-5 recursion guard, and a flow may
 * only reference flows earlier in the workflow, so a reference cycle cannot be generated.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { ScenarioProfile } from "../../profiles/ScenarioProfile";
import type { WorkflowEdge, WorkflowNode, WorkflowProfile } from "../../profiles/WorkflowProfile";
import { RUNTIME_LOOP_LIMITS } from "./ConnectorCatalog";
import type { CoverageTracker } from "./CoverageTracker";
import type { ExecutionMode, ResolvedGenerationConstraints } from "./GenerationConstraints";
import { generateFlow, type GeneratedFlow } from "./RandomFlowGenerator";
import type { SeededRandom } from "./SeededRandom";

export interface GeneratedWorkflow {
  readonly profile: WorkflowProfile;
  readonly flows: readonly GeneratedFlow[];
  readonly seed: string;
  /** The campaign-level execution mode this workflow was generated for. */
  readonly requestedExecutionMode: ExecutionMode;
}

export interface WorkflowGenerationRequest {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly rng: SeededRandom;
  readonly constraints: ResolvedGenerationConstraints;
  readonly coverage?: CoverageTracker;
}

/** `ScenarioProfile.executionMode`, which `WorkflowProfile.execution.mode` reuses. */
type WorkflowExecutionMode = ScenarioProfile["executionMode"];

function workflowExecutionMode(mode: ExecutionMode, rng: SeededRandom): WorkflowExecutionMode {
  if (mode === "sequential") return "sequential";
  if (mode === "parallel") return "parallel";
  return rng.pick<WorkflowExecutionMode>(["sequential", "parallel", "conditional"]);
}

export function generateWorkflow(request: WorkflowGenerationRequest): GeneratedWorkflow {
  const { workflowId, workflowName, rng, constraints, coverage } = request;

  const flowCount = rng.int(constraints.minFlowsPerWorkflow, constraints.maxFlowsPerWorkflow);
  const flows: GeneratedFlow[] = [];

  for (let index = 0; index < flowCount; index += 1) {
    // Only earlier flows are referenceable, so a runFlow reference cycle is unrepresentable, and
    // nesting stays strictly below the runner's depth-5 guard.
    const referenceable = flows
      .slice(0, Math.max(0, RUNTIME_LOOP_LIMITS.maxRunFlowDepth - 2))
      .map((flow) => flow.profile.id);

    flows.push(
      generateFlow({
        flowId: `${workflowId}-flow-${index}`,
        flowName: `${workflowName} — Flow ${index + 1}`,
        // Position-stable child stream: adding a flow never perturbs the ones before it, which is
        // what lets the shrinker drop a flow and keep the rest byte-identical.
        rng: rng.derive(`flow-${index}`),
        constraints,
        referenceableFlowIds: referenceable,
        ...(coverage ? { coverage } : {})
      })
    );
  }

  const nodes: WorkflowNode[] = [
    { id: `${workflowId}-start`, type: "start", alias: "Start", order: 0, position: { x: 280, y: 100 } },
    ...flows.map<WorkflowNode>((flow, index) => ({
      id: `${workflowId}-ref-${index}`,
      type: "flowRef",
      flowId: flow.profile.id,
      alias: flow.profile.name,
      order: index + 1,
      required: rng.bool(0.7),
      inputBindings: {},
      retryPolicy: { count: rng.int(0, 2), delayMs: 500 },
      failurePolicy: rng.pick(["stop", "continue"] as const),
      position: { x: 280, y: 220 + index * 160 }
    })),
    {
      id: `${workflowId}-end`,
      type: "end",
      alias: "End",
      order: flows.length + 1,
      position: { x: 280, y: 220 + flows.length * 160 }
    }
  ];

  const edges: WorkflowEdge[] = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    edges.push({
      id: `${workflowId}-edge-${index}`,
      source: (nodes[index] as WorkflowNode).id,
      target: (nodes[index + 1] as WorkflowNode).id,
      type: "always",
      label: "always"
    });
  }

  const requestedExecutionMode = rng.pick(constraints.executionModes);
  const mode = workflowExecutionMode(requestedExecutionMode, rng);
  coverage?.recordGenerated("executionMode", mode);
  if (mode === "parallel") {
    // Generated and persisted, but never proven at runtime — the field is dead in the engine.
    coverage?.block(
      "executionMode",
      "parallel",
      "ScenarioProfile.executionMode is dead at runtime (ScenarioProfile.ts:24-25) — no runtime code branches on it."
    );
  }

  const maxConcurrentInstances = rng.pick(constraints.concurrencyLevels);
  coverage?.recordGenerated("concurrencyLevel", String(maxConcurrentInstances));

  return {
    profile: {
      id: workflowId,
      name: workflowName,
      description: `Randomized workflow (seed ${rng.seed})`,
      version: 1,
      nodes,
      edges,
      runtimeInputs: [],
      execution: {
        mode,
        maxConcurrentInstances,
        stopOnRequiredFlowFailure: rng.bool(0.8)
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    flows,
    seed: rng.seed,
    requestedExecutionMode
  };
}

/** Generate a whole campaign's worth of workflows from one campaign seed. */
export function generateCampaign(
  rng: SeededRandom,
  constraints: ResolvedGenerationConstraints,
  coverage?: CoverageTracker
): GeneratedWorkflow[] {
  const workflows: GeneratedWorkflow[] = [];
  for (let index = 0; index < constraints.workflowCount; index += 1) {
    workflows.push(
      generateWorkflow({
        workflowId: `random-workflow-${index}`,
        workflowName: `Randomized Workflow ${index + 1}`,
        rng: rng.derive(`workflow-${index}`),
        constraints,
        ...(coverage ? { coverage } : {})
      })
    );
  }
  return workflows;
}
