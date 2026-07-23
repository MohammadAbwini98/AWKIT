import { buildConnectorVisual } from "./connectorStyle";
import type { CanvasEdge } from "../canvas";
import type { FlowDesignerEdge } from "../workflow/flowStepMapping";
import type { FlowConnectionData } from "../workflow/ConnectionPropertiesPanel";
import type { ScenarioLinkData } from "../scenario/scenarioDesignerTypes";
import { connectorKind } from "@src/profiles/FlowProfile";
import type { ConnectorKind } from "@src/profiles/FlowProfile";

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

/** The two connector kinds that must exist as a pair. */
export type BranchConnectorKind = "conditional" | "parallel";

const BRANCH_KINDS: readonly BranchConnectorKind[] = ["conditional", "parallel"];

/** Minimal edge shape the pair rules read (both canvases' edges satisfy it). */
export interface BranchPairEdge {
  id: string;
  source: string;
  target: string;
}

/** Structured kind of a Flow Designer edge (`data.kind`, or derived from its legacy `linkType`). */
export function flowEdgeKind(edge: FlowDesignerEdge): ConnectorKind {
  return edge.data?.kind ?? connectorKind({ type: edge.data?.linkType ?? "success" });
}

/** Structured kind of a Workflow Builder link (derived from its `type` — it has no `kind` field). */
export function scenarioEdgeKind(linkType: ScenarioLinkData["linkType"] | undefined): ConnectorKind {
  return connectorKind({ type: linkType ?? "success" });
}

/**
 * Outgoing edges per source node, excluding self-loops — a `loop` connector returns to its own
 * node and is never half of a branch pair.
 */
function outgoingBySource<E extends BranchPairEdge>(edges: E[]): Map<string, E[]> {
  const bySource = new Map<string, E[]>();
  edges.forEach((edge) => {
    if (edge.source === edge.target) return;
    const list = bySource.get(edge.source) ?? [];
    list.push(edge);
    bySource.set(edge.source, list);
  });
  return bySource;
}

/** Whether a node keeps a usable route when its branch connectors are ignored. */
function hasFallbackConnector<E extends BranchPairEdge>(outgoing: E[], kindOf: (edge: E) => string): boolean {
  return outgoing.some((edge) => !(BRANCH_KINDS as readonly string[]).includes(kindOf(edge)));
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

/** A source node left holding one half of a branch pair with nothing to fall back to. */
export interface IncompleteBranchPair {
  source: string;
  kind: BranchConnectorKind;
  edgeId: string;
}

/**
 * Find branch connectors that are alone AND unrecoverable, for save-blocking validation.
 *
 * A node carrying a single conditional/parallel connector **plus** a standard connector is
 * deliberately NOT reported: at run time that evaluates as a correct if/else — the branch is taken
 * when it matches, and `FlowExecutor`'s `success → always` fallback catches every other case. Only
 * a lone branch with no fallback misbehaves, so only that is blocked.
 */
export function incompleteBranchPairs<E extends BranchPairEdge>(edges: E[], kindOf: (edge: E) => string): IncompleteBranchPair[] {
  const issues: IncompleteBranchPair[] = [];
  outgoingBySource(edges).forEach((outgoing, source) => {
    if (hasFallbackConnector(outgoing, kindOf)) return;
    BRANCH_KINDS.forEach((kind) => {
      const kindEdges = outgoing.filter((edge) => kindOf(edge) === kind);
      if (kindEdges.length === 1) issues.push({ source, kind, edgeId: kindEdges[0].id });
    });
  });
  return issues;
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
