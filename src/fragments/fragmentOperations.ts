import type { FlowEdge, FlowProfile, FlowStep } from "@src/profiles/FlowProfile";

import {
  auditFragment,
  deriveFragmentInputs,
  isFragmentBlocked,
  type FlowFragment,
  type FlowFragmentKind,
  type FragmentAuditFinding
} from "./FlowFragment";

/**
 * L6 — the two deterministic operations over a fragment: capture one out of a flow, and apply one
 * into a flow.
 *
 * Both are PURE. Neither reads or writes a store, and neither mutates its inputs: a caller that
 * refuses the result leaves the source flow, the destination flow and the fragment exactly as they
 * were, which is what makes "no partial write after a blocking finding" a property of the design
 * rather than of the caller remembering to roll back. Persistence is the IPC layer's job, through
 * the existing single-writer profile store.
 */

export type FragmentResult<T> =
  | { ok: true; value: T; findings: FragmentAuditFinding[] }
  | { ok: false; findings: FragmentAuditFinding[] };

export interface CaptureFragmentRequest {
  /** The flow to take the subgraph from. Never modified. */
  flow: FlowProfile;
  /** The steps to capture, in any order. */
  nodeIds: readonly string[];
  id: string;
  name: string;
  description?: string;
  kind?: FlowFragmentKind;
  /** Injected in tests so a captured fragment is byte-comparable. */
  now?: () => string;
}

export interface ApplyFragmentRequest {
  /** The flow to insert into. Never modified — a new profile is returned. */
  flow: FlowProfile;
  /** Untrusted: re-audited here rather than assumed valid. */
  fragment: unknown;
  /** Flow ids that exist in the library, so a `runFlow` target can be resolved. */
  referenceableFlowIds?: ReadonlySet<string>;
  /** Injected in tests so generated ids are deterministic. */
  token?: () => string;
}

export interface AppliedFragment {
  flow: FlowProfile;
  /** The ids the inserted steps received, in the fragment's own node order. */
  insertedNodeIds: string[];
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * A node id that exists in neither the destination nor the batch being inserted.
 *
 * Fresh ids are what make applying the same fragment twice safe: the second application collides
 * with nothing, so it adds a second independent copy instead of overwriting the first.
 */
function freshId(base: string, taken: Set<string>, token: string): string {
  let candidate = `${base}-${token}`;
  let suffix = 2;
  while (taken.has(candidate)) candidate = `${base}-${token}-${suffix++}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Capture a subgraph as a fragment.
 *
 * Steps are deep-copied whole rather than rebuilt field by field, so locator metadata and
 * provenance, waits, failure policies, safety, popup and dialog expectations, and any field this
 * build does not know about all survive into the fragment and back out again.
 *
 * Edges are kept only when BOTH endpoints were selected. A boundary edge — one crossing into a step
 * the user did not select — is dropped, because a fragment that carried it would be referencing a
 * step it does not contain. That is reported as an advisory finding rather than silently, so the
 * user knows the selection cut a connector.
 */
export function captureFragment(request: CaptureFragmentRequest): FragmentResult<FlowFragment> {
  const { flow, nodeIds, id, name, description, kind = "fragment", now = () => new Date().toISOString() } = request;

  const selected = new Set(nodeIds);
  const missing = [...selected].filter((nodeId) => !flow.nodes.some((node) => node.id === nodeId));
  if (missing.length > 0) {
    return {
      ok: false,
      findings: missing.map((nodeId) => ({
        code: "edgeEndpointMissing" as const,
        severity: "blocking" as const,
        message: `Step "${nodeId}" is not in flow "${flow.id}".`,
        nodeId
      }))
    };
  }

  // Source order is preserved so the fragment reads the way the flow did.
  const nodes: FlowStep[] = flow.nodes.filter((node) => selected.has(node.id)).map((node) => structuredClone(node));

  const findings: FragmentAuditFinding[] = [];
  const edges: FlowEdge[] = [];
  for (const edge of flow.edges) {
    const hasSource = selected.has(edge.source);
    const hasTarget = selected.has(edge.target);
    if (hasSource && hasTarget) {
      edges.push(structuredClone(edge));
    } else if (hasSource || hasTarget) {
      findings.push({
        code: "boundaryEdgeDropped",
        severity: "advisory",
        message: `Connector "${edge.id}" crossed the edge of the selection and was not captured.`,
        edgeId: edge.id
      });
    }
  }

  const timestamp = now();
  const fragment: FlowFragment = {
    id,
    name,
    ...(description === undefined ? {} : { description }),
    kind,
    version: 1,
    nodes,
    edges,
    inputs: deriveFragmentInputs(nodes),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  findings.push(...auditFragment(fragment));
  if (isFragmentBlocked(findings)) return { ok: false, findings };
  return { ok: true, value: fragment, findings };
}

/**
 * Apply a fragment into a flow, returning the next flow.
 *
 * The whole next profile is built in memory and audited before anything is returned, so a blocking
 * finding leaves the caller with nothing to write — there is no half-inserted state to undo.
 *
 * Every inserted step gets a new id, and the fragment's internal connectors plus any `next` pointer
 * are remapped onto those new ids. Nothing in the destination is renamed, replaced or reconnected:
 * the inserted steps arrive unconnected to the existing graph, exactly as a step added from the
 * palette does, and the user wires them up.
 */
export function applyFragment(request: ApplyFragmentRequest): FragmentResult<AppliedFragment> {
  const { flow, fragment: candidate, referenceableFlowIds, token = randomToken } = request;

  const findings = auditFragment(candidate, {
    destinationFlowId: flow.id,
    ...(referenceableFlowIds === undefined ? {} : { referenceableFlowIds })
  });
  if (isFragmentBlocked(findings)) return { ok: false, findings };
  const fragment = candidate as FlowFragment;

  const takenNodeIds = new Set(flow.nodes.map((node) => node.id));
  const takenEdgeIds = new Set(flow.edges.map((edge) => edge.id));
  const batchToken = token();

  const nodeIdMap = new Map<string, string>();
  for (const node of fragment.nodes) {
    nodeIdMap.set(node.id, freshId(node.id, takenNodeIds, batchToken));
  }

  const insertedNodes: FlowStep[] = fragment.nodes.map((node) => {
    const copy = structuredClone(node);
    copy.id = nodeIdMap.get(node.id)!;
    // `next` is a step pointer like an edge is. Remap it when it points inside the fragment; drop
    // it when it points outside, because that target is not being inserted and leaving the old id
    // would make the applied flow reference a step that does not exist.
    if (copy.next !== undefined) {
      const mapped = nodeIdMap.get(copy.next);
      if (mapped === undefined) delete copy.next;
      else copy.next = mapped;
    }
    return copy;
  });

  const insertedEdges: FlowEdge[] = fragment.edges.map((edge) => {
    const copy = structuredClone(edge);
    copy.id = freshId(edge.id, takenEdgeIds, batchToken);
    copy.source = nodeIdMap.get(edge.source)!;
    copy.target = nodeIdMap.get(edge.target)!;
    return copy;
  });

  const nextFlow: FlowProfile = {
    ...flow,
    nodes: [...flow.nodes, ...insertedNodes],
    edges: [...flow.edges, ...insertedEdges]
  };

  return {
    ok: true,
    value: { flow: nextFlow, insertedNodeIds: insertedNodes.map((node) => node.id) },
    findings
  };
}
