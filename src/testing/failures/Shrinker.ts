import type { FlowEdge, FlowProfile, FlowStep } from "../../profiles/FlowProfile";
import { isWorkflowFlowNode, type WorkflowProfile } from "../../profiles/WorkflowProfile";
import type {
  FailureArtifact,
  FailureDefinitions,
  FailureObservation
} from "./FailureArtifactWriter";
import { isSameFailure, type FailureEvaluator } from "./FailureReproducer";

export type ShrinkStage =
  | "removeUnrelatedFlows"
  | "removeBranches"
  | "removeNonessentialNodes"
  | "reduceConcurrency"
  | "reduceLoopIterations";

export interface ShrinkStep {
  readonly stage: ShrinkStage;
  readonly description: string;
}

export interface ShrinkResult {
  readonly originalDefinitions: FailureDefinitions;
  readonly minimizedDefinitions: FailureDefinitions;
  readonly steps: readonly ShrinkStep[];
  readonly attempts: number;
}

function rebuildWorkflow(workflow: WorkflowProfile, keptFlowIds: ReadonlySet<string>): WorkflowProfile {
  const start = workflow.nodes.find((node) => node.type === "start");
  const end = workflow.nodes.find((node) => node.type === "end");
  const refs = workflow.nodes.filter(isWorkflowFlowNode).filter((node) => keptFlowIds.has(node.flowId));
  if (!start || !end) return workflow;
  const nodes = [start, ...refs, end].map((node, index) => ({ ...node, order: index }));
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `${workflow.id}-shrink-edge-${index}`,
    source: node.id,
    target: nodes[index + 1]!.id,
    type: "always" as const,
    label: "always"
  }));
  return { ...workflow, nodes, edges };
}

function reachableFromStart(flow: FlowProfile, edges: readonly FlowEdge[]): Set<string> {
  const start = flow.nodes.find((node) => node.type === "start");
  const reachable = new Set<string>(start ? [start.id] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (reachable.has(edge.source) && !reachable.has(edge.target)) {
        reachable.add(edge.target);
        changed = true;
      }
    }
  }
  return reachable;
}

function removeNode(flow: FlowProfile, node: FlowStep): FlowProfile | undefined {
  const incoming = flow.edges.filter((edge) => edge.target === node.id);
  const outgoing = flow.edges.filter((edge) => edge.source === node.id);
  if (incoming.length !== 1 || outgoing.length !== 1 || incoming[0]!.source === outgoing[0]!.target) return undefined;
  const bypass: FlowEdge = {
    ...incoming[0]!,
    id: `${incoming[0]!.id}-bypass-${node.id}`,
    target: outgoing[0]!.target
  };
  return {
    ...flow,
    nodes: flow.nodes.filter((candidate) => candidate.id !== node.id),
    edges: [...flow.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id), bypass]
  };
}

function complexity(definitions: FailureDefinitions): number {
  return (
    definitions.flows.length * 100_000 +
    definitions.workflows.reduce((sum, workflow) => sum + workflow.nodes.length * 1_000, 0) +
    definitions.flows.reduce((sum, flow) => sum + flow.nodes.length * 100 + flow.edges.length * 10, 0) +
    definitions.workflows.reduce((sum, workflow) => sum + workflow.execution.maxConcurrentInstances, 0) +
    definitions.flows.reduce(
      (sum, flow) =>
        sum +
        flow.edges.reduce(
          (edgeSum, edge) =>
            edgeSum + (edge.parallel?.maxConcurrency ?? 0) + (edge.loop?.maxIterations ?? 0) + (edge.maxLoopCount ?? 0),
          0
        ) +
        flow.nodes.reduce(
          (nodeSum, node) => nodeSum + (node.loop?.maxIterations ?? 0) + (node.config?.maxIterations ?? 0),
          0
        ),
      0
    )
  );
}

export class Shrinker {
  async shrink(artifact: FailureArtifact, evaluator: FailureEvaluator): Promise<ShrinkResult> {
    const originalDefinitions = structuredClone(artifact.definitions);
    let current = structuredClone(artifact.definitions);
    const steps: ShrinkStep[] = [];
    let attempts = 0;

    const accept = async (candidate: FailureDefinitions, stage: ShrinkStage, description: string): Promise<boolean> => {
      if (complexity(candidate) >= complexity(current)) return false;
      attempts += 1;
      const observed = await evaluator(structuredClone(candidate), structuredClone(artifact));
      if (!isSameFailure(artifact.failure, observed)) return false;
      current = structuredClone(candidate);
      steps.push({ stage, description });
      return true;
    };

    for (let index = current.flows.length - 1; index >= 0; index -= 1) {
      const removed = current.flows[index]!;
      const flows = current.flows.filter((_, candidateIndex) => candidateIndex !== index);
      const ids = new Set(flows.map((flow) => flow.id));
      await accept(
        {
          flows,
          workflows: current.workflows.map((workflow) => rebuildWorkflow(workflow, ids))
        },
        "removeUnrelatedFlows",
        `Removed flow ${removed.id}.`
      );
    }

    for (let flowIndex = 0; flowIndex < current.flows.length; flowIndex += 1) {
      let edgeIndex = current.flows[flowIndex]!.edges.length - 1;
      while (edgeIndex >= 0) {
        const flow = current.flows[flowIndex]!;
        const edge = flow.edges[edgeIndex];
        if (edge && (edge.kind === "conditional" || edge.kind === "parallel" || edge.type === "conditional" || edge.type === "parallel" || edge.type === "outcome")) {
          const edges = flow.edges.filter((_, index) => index !== edgeIndex);
          const reachable = reachableFromStart(flow, edges);
          if (flow.nodes.some((node) => node.type === "end" && reachable.has(node.id))) {
            const candidateFlow = {
              ...flow,
              nodes: flow.nodes.filter((node) => reachable.has(node.id)),
              edges: edges.filter((candidate) => reachable.has(candidate.source) && reachable.has(candidate.target))
            };
            const flows = current.flows.map((item, index) => (index === flowIndex ? candidateFlow : item));
            await accept({ ...current, flows }, "removeBranches", `Removed branch edge ${edge.id}.`);
          }
        }
        edgeIndex -= 1;
      }
    }

    for (let flowIndex = 0; flowIndex < current.flows.length; flowIndex += 1) {
      let nodeIndex = current.flows[flowIndex]!.nodes.length - 1;
      while (nodeIndex >= 0) {
        const flow = current.flows[flowIndex]!;
        const node = flow.nodes[nodeIndex];
        if (node && node.type !== "start" && node.type !== "end") {
          const candidateFlow = removeNode(flow, node);
          if (candidateFlow) {
            const flows = current.flows.map((item, index) => (index === flowIndex ? candidateFlow : item));
            await accept({ ...current, flows }, "removeNonessentialNodes", `Removed node ${node.id}.`);
          }
        }
        nodeIndex -= 1;
      }
    }

    for (let workflowIndex = 0; workflowIndex < current.workflows.length; workflowIndex += 1) {
      const workflow = current.workflows[workflowIndex]!;
      if (workflow.execution.maxConcurrentInstances > 1) {
        const workflows = current.workflows.map((item, index) =>
          index === workflowIndex
            ? { ...item, execution: { ...item.execution, maxConcurrentInstances: 1 } }
            : item
        );
        await accept({ ...current, workflows }, "reduceConcurrency", `Reduced workflow ${workflow.id} concurrency to 1.`);
      }
    }
    for (let flowIndex = 0; flowIndex < current.flows.length; flowIndex += 1) {
      const flow = current.flows[flowIndex]!;
      const reduced = {
        ...flow,
        edges: flow.edges.map((edge) =>
          edge.parallel?.maxConcurrency && edge.parallel.maxConcurrency > 1
            ? { ...edge, parallel: { ...edge.parallel, maxConcurrency: 1 } }
            : edge
        )
      };
      const flows = current.flows.map((item, index) => (index === flowIndex ? reduced : item));
      await accept({ ...current, flows }, "reduceConcurrency", `Reduced flow ${flow.id} parallel concurrency.`);
    }

    for (let flowIndex = 0; flowIndex < current.flows.length; flowIndex += 1) {
      const flow = current.flows[flowIndex]!;
      const reduced = {
        ...flow,
        nodes: flow.nodes.map((node) => ({
          ...node,
          ...(node.loop?.maxIterations && node.loop.maxIterations > 1
            ? { loop: { ...node.loop, maxIterations: 1 } }
            : {}),
          ...(node.config?.maxIterations && node.config.maxIterations > 1
            ? { config: { ...node.config, maxIterations: 1 } }
            : {})
        })),
        edges: flow.edges.map((edge) => ({
          ...edge,
          ...(edge.loop?.maxIterations && edge.loop.maxIterations > 1
            ? { loop: { ...edge.loop, maxIterations: 1 } }
            : {}),
          ...(edge.maxLoopCount && edge.maxLoopCount > 1 ? { maxLoopCount: 1 } : {})
        }))
      };
      const flows = current.flows.map((item, index) => (index === flowIndex ? reduced : item));
      await accept({ ...current, flows }, "reduceLoopIterations", `Reduced loop bounds in flow ${flow.id}.`);
    }

    return {
      originalDefinitions,
      minimizedDefinitions: structuredClone(current),
      steps,
      attempts
    };
  }
}
