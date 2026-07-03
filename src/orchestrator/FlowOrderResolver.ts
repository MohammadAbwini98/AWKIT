import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";

export interface FlowOrderResolution {
  orderedFlowIds: string[];
  entryFlowIds: string[];
  cycles: string[][];
}

export class FlowOrderResolver {
  resolve(profile: ScenarioProfile): string[] {
    return this.resolveDetailed(profile).orderedFlowIds;
  }

  resolveDetailed(profile: ScenarioProfile): FlowOrderResolution {
    const flowIds = profile.flows.map((flow) => flow.flowId);
    const flowOrder = new Map(profile.flows.map((flow) => [flow.flowId, flow.order]));
    const graph = new Map(flowIds.map((flowId) => [flowId, [] as string[]]));
    const incoming = new Map(flowIds.map((flowId) => [flowId, 0]));

    profile.links
      .filter((link) => link.type !== "loop")
      .forEach((link) => {
        if (!graph.has(link.sourceFlowId) || !incoming.has(link.targetFlowId)) return;
        graph.get(link.sourceFlowId)!.push(link.targetFlowId);
        incoming.set(link.targetFlowId, (incoming.get(link.targetFlowId) ?? 0) + 1);
      });

    const entryFlowIds = [...incoming.entries()]
      .filter(([, count]) => count === 0)
      .map(([flowId]) => flowId)
      .sort((a, b) => (flowOrder.get(a) ?? 0) - (flowOrder.get(b) ?? 0));
    const queue = [...entryFlowIds];
    const orderedFlowIds: string[] = [];
    const incomingCounts = new Map(incoming);

    while (queue.length > 0) {
      const flowId = queue.shift()!;
      orderedFlowIds.push(flowId);

      for (const nextFlowId of graph.get(flowId) ?? []) {
        incomingCounts.set(nextFlowId, (incomingCounts.get(nextFlowId) ?? 0) - 1);
        if (incomingCounts.get(nextFlowId) === 0) {
          queue.push(nextFlowId);
          queue.sort((a, b) => (flowOrder.get(a) ?? 0) - (flowOrder.get(b) ?? 0));
        }
      }
    }

    const unresolved = flowIds.filter((flowId) => !orderedFlowIds.includes(flowId));
    return {
      orderedFlowIds: [...orderedFlowIds, ...unresolved.sort((a, b) => (flowOrder.get(a) ?? 0) - (flowOrder.get(b) ?? 0))],
      entryFlowIds,
      cycles: this.findCycles(graph)
    };
  }

  private findCycles(graph: Map<string, string[]>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (flowId: string, path: string[]) => {
      if (visiting.has(flowId)) {
        cycles.push([...path.slice(path.indexOf(flowId)), flowId]);
        return;
      }

      if (visited.has(flowId)) return;

      visiting.add(flowId);
      for (const next of graph.get(flowId) ?? []) {
        visit(next, [...path, flowId]);
      }
      visiting.delete(flowId);
      visited.add(flowId);
    };

    graph.forEach((_, flowId) => visit(flowId, []));
    return cycles;
  }
}
