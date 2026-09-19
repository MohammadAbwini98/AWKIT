/**
 * Branch-connector (conditional / parallel) pair detection: the single implementation shared by
 * `FlowValidator` (design time, import, the run gate) and both canvases
 * (`app/renderer/components/shared/branchPairs.ts` re-exports it).
 *
 * A conditional/parallel connector is a PAIR. A node holding exactly one of them with no fallback
 * misbehaves quietly at run time: `FlowStep.next` is the first outgoing edge's target regardless of
 * kind, and `FlowExecutor.resolveNext` falls back `success → always → step.next`, so a lone
 * conditional routes to its target unconditionally and a lone parallel runs its target twice.
 *
 * Framework-agnostic and pure.
 */

/** The two connector kinds that must exist as a pair. */
export type BranchConnectorKind = "conditional" | "parallel";

export const BRANCH_KINDS: readonly BranchConnectorKind[] = ["conditional", "parallel"];

/** Minimal edge shape the pair rules read (profile edges and both canvases' edges satisfy it). */
export interface BranchPairEdge {
  id: string;
  source: string;
  target: string;
}

/** A source node left holding one half of a branch pair with nothing to fall back to. */
export interface IncompleteBranchPair {
  source: string;
  kind: BranchConnectorKind;
  edgeId: string;
}

/**
 * Outgoing edges per source node, excluding self-loops: a `loop` connector returns to its own node
 * and is never half of a branch pair.
 */
export function outgoingBySource<E extends BranchPairEdge>(edges: readonly E[]): Map<string, E[]> {
  const bySource = new Map<string, E[]>();
  edges.forEach((edge) => {
    if (edge.source === edge.target) return;
    const list = bySource.get(edge.source) ?? [];
    list.push(edge);
    bySource.set(edge.source, list);
  });
  return bySource;
}

/**
 * Branch connectors that are alone AND unrecoverable.
 *
 * A node carrying a single conditional/parallel connector plus a standard connector is deliberately
 * NOT reported: at run time that is a correct if/else, taken when it matches with `success → always`
 * catching every other case. Only a lone branch with no fallback misbehaves.
 */
export function incompleteBranchPairs<E extends BranchPairEdge>(edges: readonly E[], kindOf: (edge: E) => string): IncompleteBranchPair[] {
  const issues: IncompleteBranchPair[] = [];
  // A loop node's sole Conditional sibling is its required exit, not half of an if/else pair.
  const loopSources = new Set(edges.filter((edge) => edge.source === edge.target && kindOf(edge) === "loop").map((edge) => edge.source));
  outgoingBySource(edges).forEach((outgoing, source) => {
    if (loopSources.has(source)) return;
    if (outgoing.some((edge) => !(BRANCH_KINDS as readonly string[]).includes(kindOf(edge)))) return;
    BRANCH_KINDS.forEach((kind) => {
      const kindEdges = outgoing.filter((edge) => kindOf(edge) === kind);
      if (kindEdges.length === 1) issues.push({ source, kind, edgeId: kindEdges[0].id });
    });
  });
  return issues;
}
