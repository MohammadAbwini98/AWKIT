import type { FlowProfile } from "@src/profiles/FlowProfile";

export class FlowOrchestrator {
  getStartNodeId(flow: FlowProfile): string {
    const start = flow.nodes.find((node) => node.type === "start");
    if (!start) throw new Error(`Flow ${flow.id} is missing a start node.`);
    return start.id;
  }
}
