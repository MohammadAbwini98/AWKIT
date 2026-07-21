/**
 * Controlled mutation for negative testing (§10 of the brief).
 *
 * Each call injects **exactly one** defect into a pristine, valid-by-construction flow. That
 * one-defect rule is the whole point: a profile carrying three simultaneous defects tells you only
 * that *something* was rejected, not which rule fired. Chaos-style multi-defect mutation is a
 * separate campaign profile and is not what this module does.
 *
 * `applyMutation` returns `undefined` when the flow has no suitable target — a flow with no
 * conditional connector cannot have its operator corrupted. It never silently returns an unmutated
 * profile, because a mutation that quietly did nothing would show up as a validator that "correctly
 * accepted" a defect it never saw.
 *
 * The input profile is never modified; every mutation works on a deep clone.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { FlowEdge, FlowProfile, FlowStep, StepType } from "../../profiles/FlowProfile";
import { connectorKind } from "../../profiles/FlowProfile";
import { RUNTIME_LOOP_LIMITS } from "./ConnectorCatalog";
import { nodeSpec } from "./NodeCatalog";
import type { SeededRandom } from "./SeededRandom";

export type MutationKind =
  /** Drop the locator from a step whose type requires one. */
  | "missingRequiredLocator"
  /** Drop the value and value source from a step whose type requires one. */
  | "missingRequiredValue"
  /** Point a connector at a node id that does not exist. */
  | "invalidConnectorTarget"
  /** Set a conditional operator to a literal outside `ConnectorConditionOperator`. */
  | "unsupportedOperator"
  /** Give two nodes the same id. */
  | "duplicateNodeId"
  /** Remove every `end` node. */
  | "missingEndNode"
  /** Add a node with no incoming connector. */
  | "unreachableNode"
  /** Set a loop connector's `maxIterations` outside its permitted range. */
  | "invalidLoopLimit"
  /** Set a negative step timeout. */
  | "invalidTimeout"
  /** Point a `runFlow` step at a flow id that does not exist. */
  | "missingFlowReference"
  /** Make a structured `loop` connector span two different nodes. */
  | "structuralLoopAcrossNodes"
  /** Give one node two standard outgoing connectors. */
  | "multipleStandardOutgoing"
  /** Give a self-looping node a second, non-conditional outgoing connector. */
  | "loopNodeNonConditionalSibling";

export const ALL_MUTATION_KINDS: readonly MutationKind[] = [
  "missingRequiredLocator",
  "missingRequiredValue",
  "invalidConnectorTarget",
  "unsupportedOperator",
  "duplicateNodeId",
  "missingEndNode",
  "unreachableNode",
  "invalidLoopLimit",
  "invalidTimeout",
  "missingFlowReference",
  "structuralLoopAcrossNodes",
  "multipleStandardOutgoing",
  "loopNodeNonConditionalSibling"
];

export interface Mutation {
  readonly kind: MutationKind;
  /** Concretely what changed, for the failure artifact. */
  readonly description: string;
  /** Node or edge id the mutation was applied to. */
  readonly targetId: string;
  /**
   * Step type the mutation landed on, when it targeted a node. The oracle needs this: whether a
   * defect is detected can depend on the node type, not just the defect.
   */
  readonly targetType?: StepType;
}

export interface MutatedFlow {
  readonly profile: FlowProfile;
  readonly mutation: Mutation;
}

/** Deep clone via JSON. Round-trip losslessness for these profiles is proven by Phase 3. */
function clone(profile: FlowProfile): FlowProfile {
  return JSON.parse(JSON.stringify(profile)) as FlowProfile;
}

function firstNode(profile: FlowProfile, predicate: (step: FlowStep) => boolean): FlowStep | undefined {
  return profile.nodes.find(predicate);
}

function firstEdge(profile: FlowProfile, predicate: (edge: FlowEdge) => boolean): FlowEdge | undefined {
  return profile.edges.find(predicate);
}

/**
 * Inject one controlled defect. Returns `undefined` when this flow offers no target for that
 * mutation — the caller should try another flow rather than treat it as a pass.
 */
export function applyMutation(
  original: FlowProfile,
  kind: MutationKind,
  rng: SeededRandom
): MutatedFlow | undefined {
  const profile = clone(original);

  switch (kind) {
    case "missingRequiredLocator": {
      const target = firstNode(profile, (step) => nodeSpec(step.type).requiresLocator && step.locator !== undefined);
      if (!target) return undefined;
      delete target.locator;
      return { profile, mutation: { kind, targetId: target.id, targetType: target.type, description: `Removed the locator from ${target.type} step ${target.id}.` } };
    }

    case "missingRequiredValue": {
      const target = firstNode(profile, (step) => nodeSpec(step.type).requiresValue && step.value !== undefined);
      if (!target) return undefined;
      delete target.value;
      delete target.valueSource;
      delete target.url;
      return { profile, mutation: { kind, targetId: target.id, targetType: target.type, description: `Removed the value and value source from ${target.type} step ${target.id}.` } };
    }

    case "invalidConnectorTarget": {
      const target = firstEdge(profile, (edge) => edge.target !== edge.source);
      if (!target) return undefined;
      target.target = "node-that-does-not-exist";
      return { profile, mutation: { kind, targetId: target.id, description: `Repointed connector ${target.id} at a non-existent node.` } };
    }

    case "unsupportedOperator": {
      const target = firstEdge(profile, (edge) => edge.conditional !== undefined);
      if (!target?.conditional) return undefined;
      // Deliberately outside the union — this is the shape an imported or hand-edited JSON can carry.
      (target.conditional as { operator: string }).operator = "isDefinitelyNotAnOperator";
      return { profile, mutation: { kind, targetId: target.id, description: `Set connector ${target.id} to an operator outside ConnectorConditionOperator.` } };
    }

    case "duplicateNodeId": {
      const [, second, third] = profile.nodes;
      if (!second || !third) return undefined;
      third.id = second.id;
      return { profile, mutation: { kind, targetId: second.id, description: `Gave node ${third.type} the same id as ${second.type} (${second.id}).` } };
    }

    case "missingEndNode": {
      const ends = profile.nodes.filter((step) => step.type === "end");
      if (ends.length === 0) return undefined;
      const endIds = new Set(ends.map((step) => step.id));
      profile.nodes = profile.nodes.filter((step) => !endIds.has(step.id));
      profile.edges = profile.edges.filter((edge) => !endIds.has(edge.target) && !endIds.has(edge.source));
      return { profile, mutation: { kind, targetId: [...endIds][0] as string, description: `Removed all ${ends.length} end node(s) and their connectors.` } };
    }

    case "unreachableNode": {
      const orphan: FlowStep = {
        id: `${profile.id}-orphan`,
        type: "screenshot",
        name: "orphan",
        position: { x: 2000, y: 2000 },
        config: { screenshotName: "orphan" }
      };
      profile.nodes.push(orphan);
      return { profile, mutation: { kind, targetId: orphan.id, targetType: orphan.type, description: "Added a node with no incoming connector." } };
    }

    case "invalidLoopLimit": {
      const target = firstEdge(profile, (edge) => edge.loop !== undefined);
      if (!target?.loop) return undefined;
      // Either end of the permitted range; both are rejected by the designer's save gate.
      target.loop.maxIterations = rng.bool() ? 0 : RUNTIME_LOOP_LIMITS.absoluteMaxLoopIterations + 1;
      return { profile, mutation: { kind, targetId: target.id, description: `Set loop connector ${target.id} maxIterations to ${target.loop.maxIterations}.` } };
    }

    case "invalidTimeout": {
      const target = firstNode(profile, (step) => step.timeoutMs !== undefined);
      if (!target) return undefined;
      target.timeoutMs = -1;
      return { profile, mutation: { kind, targetId: target.id, targetType: target.type, description: `Set a negative timeout on step ${target.id}.` } };
    }

    case "missingFlowReference": {
      const target = firstNode(profile, (step) => step.type === "runFlow");
      if (!target) return undefined;
      target.flowId = "flow-that-does-not-exist";
      if (target.config) target.config.targetFlowId = "flow-that-does-not-exist";
      return { profile, mutation: { kind, targetId: target.id, targetType: target.type, description: `Pointed runFlow step ${target.id} at a non-existent flow.` } };
    }

    case "structuralLoopAcrossNodes": {
      const target = firstEdge(profile, (edge) => connectorKind(edge) === "loop" && edge.source === edge.target);
      const other = firstNode(profile, (step) => step.id !== target?.source && step.type !== "start");
      if (!target || !other) return undefined;
      target.target = other.id;
      return { profile, mutation: { kind, targetId: target.id, description: `Made structured loop connector ${target.id} span two different nodes.` } };
    }

    case "multipleStandardOutgoing": {
      const source = firstEdge(profile, (edge) => connectorKind(edge) === "normal");
      const other = firstNode(profile, (step) => step.type !== "start");
      if (!source || !other) return undefined;
      profile.edges.push({ id: `${profile.id}-mutant`, source: source.source, target: other.id, type: "success", kind: "normal" });
      return { profile, mutation: { kind, targetId: source.source, description: `Added a second standard outgoing connector to node ${source.source}.` } };
    }

    case "loopNodeNonConditionalSibling": {
      const loopEdge = firstEdge(profile, (edge) => connectorKind(edge) === "loop" && edge.source === edge.target);
      const other = firstNode(profile, (step) => step.id !== loopEdge?.source && step.type !== "start");
      if (!loopEdge || !other) return undefined;
      profile.edges.push({ id: `${profile.id}-mutant`, source: loopEdge.source, target: other.id, type: "success", kind: "normal" });
      return { profile, mutation: { kind, targetId: loopEdge.source, description: `Added a non-conditional outgoing connector to self-looping node ${loopEdge.source}.` } };
    }

    default: {
      // Exhaustiveness: adding a MutationKind without a case fails `tsc --noEmit`.
      const unreachable: never = kind;
      throw new Error(`Unhandled mutation kind: ${String(unreachable)}`);
    }
  }
}
