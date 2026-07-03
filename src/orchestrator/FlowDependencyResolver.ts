import type { ScenarioProfile } from "@src/profiles/ScenarioProfile";

export interface ScenarioValidationIssue {
  id: string;
  severity: "error" | "warning";
  message: string;
}

export class FlowDependencyResolver {
  validate(profile: ScenarioProfile): ScenarioValidationIssue[] {
    const issues: ScenarioValidationIssue[] = [];
    const flowIds = new Set(profile.flows.map((flow) => flow.flowId));
    const orders = new Set<number>();

    if (!profile.id.trim()) {
      issues.push({ id: "scenario-id", severity: "error", message: "Scenario ID is required." });
    }

    if (!profile.flows.length) {
      issues.push({ id: "scenario-flows", severity: "error", message: "Scenario requires at least one flow." });
    }

    if (profile.maxParallelFlows < 1) {
      issues.push({ id: "max-parallel-flows", severity: "error", message: "Max parallel flows must be at least 1." });
    }

    profile.flows.forEach((flow) => {
      if (orders.has(flow.order)) {
        issues.push({
          id: `duplicate-order-${flow.order}`,
          severity: "error",
          message: `Order ${flow.order} is assigned to more than one flow.`
        });
      }
      orders.add(flow.order);

      if (!flow.flowId.trim()) {
        issues.push({ id: `empty-flow-${flow.order}`, severity: "error", message: `Flow at order ${flow.order} is missing a flow ID.` });
      }
    });

    profile.links.forEach((link) => {
      if (!flowIds.has(link.sourceFlowId) || !flowIds.has(link.targetFlowId)) {
        issues.push({
          id: link.id,
          severity: "error",
          message: `Link ${link.id} references a flow that is not in the scenario.`
        });
      }

      if (link.sourceFlowId === link.targetFlowId && link.type !== "loop") {
        issues.push({
          id: `${link.id}-self`,
          severity: "error",
          message: `Link ${link.id} cannot target the same flow unless it is a Loop connector.`
        });
      }

      if (link.type === "conditional" && !link.condition?.expression.trim()) {
        issues.push({
          id: `${link.id}-condition`,
          severity: "error",
          message: `Conditional link ${link.id} requires an expression.`
        });
      }
    });

    issues.push(...this.validateConnectorStructure(profile));

    this.findCycles(profile).forEach((cycle) => {
      issues.push({
        id: `cycle-${cycle.join("-")}`,
        severity: "error",
        message: `Scenario flow links contain a cycle: ${cycle.join(" -> ")}.`
      });
    });

    return issues;
  }

  /**
   * Runtime mirror of the Workflow Builder connector-structure safeguards.
   * This protects execution if a saved workflow/scenario bypasses the renderer's Save gate.
   */
  private validateConnectorStructure(profile: ScenarioProfile): ScenarioValidationIssue[] {
    const issues: ScenarioValidationIssue[] = [];
    const kindOf = (type: string): "normal" | "conditional" | "parallel" | "loop" => {
      if (type === "conditional" || type === "outcome") return "conditional";
      if (type === "parallel") return "parallel";
      if (type === "loop" || type === "loopBack") return "loop";
      return "normal";
    };

    profile.links.forEach((link) => {
      if (link.type === "loop" && link.sourceFlowId !== link.targetFlowId) {
        issues.push({
          id: `${link.id}-loop-target`,
          severity: "error",
          message: `Loop link ${link.id} is invalid because it must return to the same flow.`
        });
      }
    });

    const outgoingBySource = new Map<string, typeof profile.links>();
    profile.links.forEach((link) => {
      const list = outgoingBySource.get(link.sourceFlowId) ?? [];
      list.push(link);
      outgoingBySource.set(link.sourceFlowId, list);
    });

    outgoingBySource.forEach((sourceLinks, sourceFlowId) => {
      const standard = sourceLinks.filter((link) => {
        const kind = kindOf(link.type);
        return kind !== "conditional" && kind !== "parallel";
      });
      if (standard.length > 1) {
        issues.push({
          id: `multiple-standard-${sourceFlowId}`,
          severity: "error",
          message: `Flow ${sourceFlowId} has multiple standard outgoing links; use Conditional or Parallel links for additional paths.`
        });
      }
    });

    const loopSources = new Set(
      profile.links.filter((link) => link.sourceFlowId === link.targetFlowId && kindOf(link.type) === "loop").map((link) => link.sourceFlowId)
    );
    profile.links.forEach((link) => {
      if (!loopSources.has(link.sourceFlowId) || link.sourceFlowId === link.targetFlowId) return;
      if (kindOf(link.type) !== "conditional") {
        issues.push({
          id: `${link.id}-loop-exit`,
          severity: "error",
          message: `Flow ${link.sourceFlowId} has a loop link; additional outgoing links from that flow must be Conditional.`
        });
      }
    });

    return issues;
  }

  private findCycles(profile: ScenarioProfile): string[][] {
    const graph = new Map<string, string[]>();
    const cycles: string[][] = [];

    profile.flows.forEach((flow) => graph.set(flow.flowId, []));
    profile.links.filter((link) => link.type !== "loop").forEach((link) => {
      graph.get(link.sourceFlowId)?.push(link.targetFlowId);
    });

    const visit = (flowId: string, path: string[]) => {
      if (path.includes(flowId)) {
        cycles.push([...path.slice(path.indexOf(flowId)), flowId]);
        return;
      }

      graph.get(flowId)?.forEach((nextFlowId) => visit(nextFlowId, [...path, flowId]));
    };

    graph.forEach((_, flowId) => visit(flowId, []));
    return cycles;
  }
}
