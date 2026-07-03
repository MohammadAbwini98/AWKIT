import type { ScenarioFlowReference, ScenarioProfile } from "@src/profiles/ScenarioProfile";
import { FlowDependencyResolver, type ScenarioValidationIssue } from "./FlowDependencyResolver";
import { FlowOrderResolver } from "./FlowOrderResolver";

export interface ScenarioExecutionPlanStep {
  order: number;
  flowId: string;
  required: boolean;
  dependsOn: string[];
  inputs: Record<string, string>;
  outputs: ScenarioFlowReference["outputs"];
}

export interface ScenarioExecutionPlan {
  scenarioId: string;
  executionMode: ScenarioProfile["executionMode"];
  maxParallelFlows: number;
  steps: ScenarioExecutionPlanStep[];
  validationIssues: ScenarioValidationIssue[];
}

export class ScenarioOrchestrator {
  constructor(
    private readonly dependencyResolver = new FlowDependencyResolver(),
    private readonly orderResolver = new FlowOrderResolver()
  ) {}

  resolveFlowOrder(profile: ScenarioProfile): string[] {
    return this.orderResolver.resolve(profile);
  }

  createExecutionPlan(profile: ScenarioProfile): ScenarioExecutionPlan {
    const validationIssues = this.dependencyResolver.validate(profile);
    const orderedFlowIds = this.orderResolver.resolve(profile);
    const flowById = new Map(profile.flows.map((flow) => [flow.flowId, flow]));
    const orderedFlows = orderedFlowIds.flatMap((flowId) => {
      const flow = flowById.get(flowId);
      return flow ? [flow] : [];
    });

    return {
      scenarioId: profile.id,
      executionMode: profile.executionMode,
      maxParallelFlows: profile.maxParallelFlows,
      validationIssues,
      steps: orderedFlows.map((flow) => ({
        order: flow.order,
        flowId: flow.flowId,
        required: flow.required,
        dependsOn: this.getDependencies(profile, flow.flowId),
        inputs: flow.inputs ?? {},
        outputs: flow.outputs
      }))
    };
  }

  resolveFlowInputs(flow: ScenarioFlowReference, flowOutputs: Record<string, unknown>): Record<string, unknown> {
    return Object.entries(flow.inputs ?? {}).reduce<Record<string, unknown>>((resolved, [key, expression]) => {
      resolved[key] = this.resolveOutputExpression(expression, flowOutputs);
      return resolved;
    }, {});
  }

  private getDependencies(profile: ScenarioProfile, flowId: string): string[] {
    return profile.links.filter((link) => link.targetFlowId === flowId).map((link) => link.sourceFlowId);
  }

  private resolveOutputExpression(expression: string, flowOutputs: Record<string, unknown>): unknown {
    const match = expression.match(/^\$\{outputs\.([^.]+)\.([^}]+)\}$/);
    if (!match) return expression;

    return flowOutputs[`${match[1]}.${match[2]}`] ?? "";
  }
}
