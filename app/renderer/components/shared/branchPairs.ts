import { buildConnectorVisual } from "./connectorStyle";
import type { CanvasEdge } from "../canvas";
import type { FlowDesignerEdge } from "../workflow/flowProfileMapping";
import type { FlowConnectionData } from "../workflow/ConnectionPropertiesPanel";
import type { ScenarioLinkData } from "../scenario/scenarioDesignerTypes";
import { connectorKind } from "@src/profiles/FlowProfile";
import type { ConnectorKind } from "@src/profiles/FlowProfile";
import { BRANCH_KINDS, outgoingBySource, type BranchConnectorKind, type BranchPairEdge } from "@src/validation/BranchPairs";

// Detection is the engine's (`@src/validation/BranchPairs`), so `FlowValidator`, the run gate and
// both canvases share one implementation. Re-exported for the existing canvas and verifier imports.
export { incompleteBranchPairs, type BranchConnectorKind, type BranchPairEdge, type IncompleteBranchPair } from "@src/validation/BranchPairs";

/**
 * Branch-connector (conditional / parallel) pair semantics, shared by the Flow Designer and the
 * Workflow Builder so both canvases enforce the SAME invariant (SRS-CANVAS-UX-001 FR-2.6).
 *
 * A conditional/parallel connector is a **pair**. When a node is left holding exactly one of them
 * the flow does not fail loudly — it misbehaves quietly:
 *
 *  - `flowStepMapping.toFlowStep` sets `FlowStep.next` to the FIRST outgoing edge's target
 *    regardless of kind, and `FlowExecutor.resolveNext` falls back `success → always → step.next`.
 *    So a lone **conditional** with no fallback routes to its own target *unconditionally* — the
 *    condition is silently ignored rather than evaluated.
 *  - A lone **parallel** with no fallback is worse: `FlowExecutor` fans the branch out, then the
 *    same `step.next` fallback sends execution into that same target again, running it twice.
 *
 * Both editors previously carried a no-op pass-through where this logic used to live (it was tied
 * to the removed two-port node model), so neither the revert nor any validation ran. This module
 * restores the semantics without the ports, and lives in its own React-free module so a verifier
 * can exercise the real functions (`scripts/verify-branch-pairs.mts`) — the same reason
 * `flowStepMapping.ts` was extracted.
 *
 * The hybrid rule this implements:
 *  - **new interactive deletions** auto-revert the surviving connector (the editor never leaves a
 *    graph it can deterministically repair) — {@link revertLoneBranchConnectors};
 *  - **existing / imported** lone branches are reported and block Save instead of being rewritten
 *    on load, so opening a profile never mutates it — {@link incompleteBranchPairs}.
 *
 * Every import here is either a plain non-React module or `import type` (erased at compile time),
 * so this module carries no React runtime.
 */

export type ScenarioDesignerEdge = CanvasEdge<ScenarioLinkData>;

/** Structured kind of a Flow Designer edge (`data.kind`, or derived from its legacy `linkType`). */
export function flowEdgeKind(edge: FlowDesignerEdge): ConnectorKind {
  return edge.data?.kind ?? connectorKind({ type: edge.data?.linkType ?? "success" });
}

/** Structured kind of a Workflow Builder link (derived from its `type` — it has no `kind` field). */
export function scenarioEdgeKind(linkType: ScenarioLinkData["linkType"] | undefined): ConnectorKind {
  return connectorKind({ type: linkType ?? "success" });
}

/**
 * Collapse a lone surviving branch connector back to a normal connector.
 *
 * Only nodes named in `revertSources` are touched — that is the caller's statement that the user
 * just deleted something attached to them (a connector, or a node that was a branch target). A
 * node with a complete pair, or one nobody edited, is returned untouched.
 *
 * The revert is unconditional for those sources: if collapsing to normal happens to breach another
 * connector rule (a second standard connector, or a loop node whose extra connectors must stay
 * Conditional), the structure validators report it and Save is blocked with an actionable message.
 * That is deliberate — a visible, repairable block beats a silently mis-routing flow.
 *
 * Returns the input array unchanged (same reference) when nothing was reverted, so the memoized
 * canvas can skip re-rendering.
 */
export function revertLoneBranchConnectors<E extends BranchPairEdge>(
  edges: E[],
  ops: {
    kindOf: (edge: E) => string;
    toNormal: (edge: E) => E;
    revertSources?: Set<string>;
  }
): E[] {
  const { revertSources } = ops;
  if (!revertSources?.size) return edges;

  const replaced = new Map<string, E>();
  outgoingBySource(edges).forEach((outgoing, source) => {
    if (!revertSources.has(source)) return;
    BRANCH_KINDS.forEach((kind) => {
      const kindEdges = outgoing.filter((edge) => ops.kindOf(edge) === kind);
      if (kindEdges.length === 1) replaced.set(kindEdges[0].id, ops.toNormal(kindEdges[0]));
    });
  });

  if (!replaced.size) return edges;
  return edges.map((edge) => replaced.get(edge.id) ?? edge);
}

/** Save-blocking message for one incomplete pair, shared so both editors read identically. */
export function incompleteBranchPairMessage(nodeLabel: string, kind: BranchConnectorKind): string {
  const label = kind === "conditional" ? "Conditional" : "Parallel";
  return `Node "${nodeLabel}" has a single ${label} connector and no other outgoing connector. A ${label} connector must be part of a pair — add the matching branch, change this connector to a standard connector, or add a fallback connector.`;
}

/**
 * Flow Designer: rewrite a branch connector as a normal (`success`) one.
 *
 * Branch-only configuration is dropped rather than carried over — a stale `conditional` operator
 * or `parallel` join mode on a normal connector is invisible in the panel but would be re-applied
 * if the connector were later promoted back to a branch. The label is reset for the same reason:
 * "If false" on a connector that no longer branches is actively misleading, and resetting it is
 * what makes the conversion visible on the canvas.
 */
export function flowEdgeToNormal(edge: FlowDesignerEdge): FlowDesignerEdge {
  const data: FlowConnectionData = {
    ...edge.data,
    linkType: "success",
    kind: "normal",
    label: "success",
    expression: "",
    conditional: undefined,
    parallel: undefined
  };
  return { ...edge, ...buildConnectorVisual("success", edge.data?.style), data, label: "success" };
}

/**
 * Workflow Builder: rewrite a branch connector as a normal (`success`) one. Workflow links carry
 * no separate `kind` field — the kind is derived from `linkType` — so rewriting the type is the
 * whole conversion, plus clearing the condition expression it routed on.
 */
export function scenarioEdgeToNormal(edge: ScenarioDesignerEdge): ScenarioDesignerEdge {
  const data: ScenarioLinkData = {
    ...edge.data,
    linkType: "success",
    label: "success",
    expression: ""
  };
  return { ...edge, ...buildConnectorVisual("success", edge.data?.style), data, label: "success" };
}
