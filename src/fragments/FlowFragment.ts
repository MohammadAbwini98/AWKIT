import type { RuntimeInputDefinition } from "@src/data/RuntimeInputDefinition";
import {
  PROTECTED_LOGIN_STEP_TYPES,
  type FlowEdge,
  type FlowStep,
  type ValueSource,
  type ValueSourceType
} from "@src/profiles/FlowProfile";
import { resolveStepSafety } from "@src/runner/runtime/StepSafetyPolicy";

/**
 * L6 — the reusable-fragment contract and its blocking audit.
 *
 * A fragment is a SUBGRAPH of an existing flow, not a flow: it has no `start`/`end`, and its edges
 * are only the ones whose both endpoints it contains. That is the whole reason it needs an audit of
 * its own — `FlowValidator` validates a runnable flow, so every fragment would fail it for reasons
 * that are not defects (no start node, no terminal path), and a fragment's real hazards (a
 * protected-login step, an input a destination cannot supply, a `runFlow` that would expand into
 * itself) are not things a flow validator is looking for.
 *
 * The audit is the ONLY authority on whether a fragment may be created or applied, and it is pure:
 * `app/main/ipc/fragment.ipc.ts` re-runs it on every request rather than trusting a renderer that
 * says a fragment was already audited.
 */

export type FlowFragmentKind = "fragment" | "template";

export interface FlowFragment {
  id: string;
  name: string;
  description?: string;
  /** `template` declares required inputs a destination must supply; `fragment` may declare none. */
  kind: FlowFragmentKind;
  version: number;
  /**
   * Whole `FlowStep` objects, copied verbatim from the source flow. Copied rather than rebuilt so
   * locator metadata, provenance, waits, failure policies, safety and any field this build does not
   * know about all survive — the same unknown-field preservation the profile store gives a flow.
   */
  nodes: FlowStep[];
  /** Edges strictly between two nodes in `nodes`. A boundary edge is dropped at capture. */
  edges: FlowEdge[];
  /**
   * The inputs this fragment requires, reusing the existing runtime-input contract rather than a
   * second parameter system. Derived from the `runtimeInput` bindings the steps already carry, and
   * re-derived by the audit, so a hand-edited declaration cannot disagree with what the steps use.
   */
  inputs: RuntimeInputDefinition[];
  createdAt?: string;
  updatedAt?: string;
}

export type FragmentAuditCode =
  // ── blocking ────────────────────────────────────────────────────────────────────────────────
  | "fragmentShapeInvalid"
  | "fragmentEmpty"
  | "duplicateNodeId"
  | "duplicateEdgeId"
  | "edgeEndpointMissing"
  | "terminalStepIncluded"
  | "protectedLoginStep"
  | "resolvedSecretValue"
  | "undeclaredInput"
  | "duplicateInputKey"
  | "recursiveFlowReference"
  | "unresolvedFlowReference"
  // ── advisory ────────────────────────────────────────────────────────────────────────────────
  | "boundaryEdgeDropped"
  | "unusedDeclaredInput"
  | "environmentSpecificBinding"
  | "dangerousMutationStep";

export type FragmentAuditSeverity = "blocking" | "advisory";

/**
 * One audit finding. It names WHERE the problem is (node, edge, input key, dotted field path) and
 * never carries the offending value: a finding about a secret binding that quoted the secret would
 * be the leak it exists to prevent.
 */
export interface FragmentAuditFinding {
  code: FragmentAuditCode;
  severity: FragmentAuditSeverity;
  message: string;
  nodeId?: string;
  edgeId?: string;
  inputKey?: string;
  /** Dotted path within the step, e.g. `config.oracle.binds[0].valueSource`. */
  field?: string;
}

export interface FragmentAuditContext {
  /**
   * The flow the fragment is being applied to. Supplied only at apply time; a `runFlow`/`loop` step
   * that targets it would expand into itself.
   */
  destinationFlowId?: string;
  /** Flow ids that exist in the library. Supplied only at apply time. */
  referenceableFlowIds?: ReadonlySet<string>;
}

const BLOCKING_CODES: ReadonlySet<FragmentAuditCode> = new Set<FragmentAuditCode>([
  "fragmentShapeInvalid",
  "fragmentEmpty",
  "duplicateNodeId",
  "duplicateEdgeId",
  "edgeEndpointMissing",
  "terminalStepIncluded",
  "protectedLoginStep",
  "resolvedSecretValue",
  "undeclaredInput",
  "duplicateInputKey",
  "recursiveFlowReference",
  "unresolvedFlowReference"
]);

const VALUE_SOURCE_TYPES: ReadonlySet<string> = new Set<ValueSourceType>([
  "static",
  "dynamic",
  "json",
  "runtimeInput",
  "env",
  "flowOutput",
  "generated",
  "currentRow",
  "instanceVariable",
  "secret"
]);

/**
 * Bindings that resolve against something the DESTINATION may not have. They are not defects — a
 * fragment that reads an environment variable is a legitimate fragment — so they are advisory, and
 * the user is told which slot to check rather than being refused.
 */
const ENVIRONMENT_SPECIFIC_TYPES: ReadonlySet<string> = new Set<ValueSourceType>(["env", "json", "flowOutput"]);

/** Steps whose `flowId`/`config.targetFlowId` expands another flow at run time. */
const FLOW_EXPANDING_STEP_TYPES: ReadonlySet<string> = new Set(["runFlow", "loop"]);

/** How deep the binding walk goes. Bounded so a malformed document cannot spin the audit. */
const MAX_WALK_DEPTH = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** A `ValueSource` found somewhere inside a step, with the dotted path that reached it. */
export interface LocatedValueSource {
  source: ValueSource;
  field: string;
}

/**
 * Every `ValueSource` inside a step, found by SHAPE rather than by a list of known field names.
 *
 * Enumerating fields would already be wrong today: `step.valueSource` and `step.loop.valueSource`
 * are easy to remember, but an Oracle node's binds live at `config.oracle.binds[i].valueSource`,
 * and the next node type to carry a binding will be missed by whatever list is written here. A
 * shape walk collects permissively; the rules below judge strictly.
 */
export function collectValueSources(step: unknown, path = "", depth = 0): LocatedValueSource[] {
  if (depth > MAX_WALK_DEPTH) return [];
  if (Array.isArray(step)) {
    return step.flatMap((entry, index) => collectValueSources(entry, `${path}[${index}]`, depth + 1));
  }
  if (!isRecord(step)) return [];

  const found: LocatedValueSource[] = [];
  if (typeof step.type === "string" && VALUE_SOURCE_TYPES.has(step.type) && !("id" in step)) {
    found.push({ source: step as unknown as ValueSource, field: path || "valueSource" });
  }
  for (const [key, value] of Object.entries(step)) {
    if (key === "type") continue;
    found.push(...collectValueSources(value, path ? `${path}.${key}` : key, depth + 1));
  }
  return found;
}

/** The `runtimeInput` keys a fragment's steps actually bind. */
export function requiredInputKeys(nodes: readonly FlowStep[]): string[] {
  const keys = new Set<string>();
  for (const node of nodes) {
    for (const { source } of collectValueSources(node)) {
      if (source.type === "runtimeInput" && nonEmptyString(source.key)) keys.add(source.key);
    }
  }
  return [...keys].sort();
}

/**
 * Derive the declared-input contract from the steps. Capture uses this so a fragment's declaration
 * is never hand-written, and the audit re-derives it so a later hand edit cannot make the two
 * disagree without being caught.
 */
export function deriveFragmentInputs(nodes: readonly FlowStep[]): RuntimeInputDefinition[] {
  return requiredInputKeys(nodes).map((key) => ({ key, label: key, type: "text", required: true }));
}

function finding(
  code: FragmentAuditCode,
  message: string,
  where: Pick<FragmentAuditFinding, "nodeId" | "edgeId" | "inputKey" | "field"> = {}
): FragmentAuditFinding {
  return { code, severity: BLOCKING_CODES.has(code) ? "blocking" : "advisory", message, ...where };
}

/** Whether any finding blocks the operation. */
export function isFragmentBlocked(findings: readonly FragmentAuditFinding[]): boolean {
  return findings.some((entry) => entry.severity === "blocking");
}

export function blockingFindings(findings: readonly FragmentAuditFinding[]): FragmentAuditFinding[] {
  return findings.filter((entry) => entry.severity === "blocking");
}

/**
 * Shape check for a value arriving over IPC. Fails closed: anything that is not recognisably a
 * fragment is one blocking finding, not a thrown exception, so the caller reports it like any other
 * refusal.
 */
function auditShape(candidate: unknown): { fragment: FlowFragment | null; findings: FragmentAuditFinding[] } {
  if (!isRecord(candidate)) {
    return { fragment: null, findings: [finding("fragmentShapeInvalid", "A fragment must be an object.")] };
  }
  const problems: FragmentAuditFinding[] = [];
  if (!nonEmptyString(candidate.id)) problems.push(finding("fragmentShapeInvalid", "A fragment needs a non-empty id."));
  if (!nonEmptyString(candidate.name)) problems.push(finding("fragmentShapeInvalid", "A fragment needs a non-empty name."));
  if (candidate.kind !== "fragment" && candidate.kind !== "template") {
    problems.push(finding("fragmentShapeInvalid", 'A fragment kind must be "fragment" or "template".'));
  }
  if (typeof candidate.version !== "number" || !Number.isFinite(candidate.version)) {
    problems.push(finding("fragmentShapeInvalid", "A fragment needs a numeric version."));
  }
  if (!Array.isArray(candidate.nodes)) problems.push(finding("fragmentShapeInvalid", "A fragment needs a nodes array."));
  if (!Array.isArray(candidate.edges)) problems.push(finding("fragmentShapeInvalid", "A fragment needs an edges array."));
  if (!Array.isArray(candidate.inputs)) problems.push(finding("fragmentShapeInvalid", "A fragment needs an inputs array."));
  if (problems.length > 0) return { fragment: null, findings: problems };

  const nodes = candidate.nodes as unknown[];
  for (const node of nodes) {
    if (!isRecord(node) || !nonEmptyString(node.id) || !nonEmptyString(node.type)) {
      return {
        fragment: null,
        findings: [finding("fragmentShapeInvalid", "Every fragment node needs an id and a type.")]
      };
    }
  }
  const edges = candidate.edges as unknown[];
  for (const edge of edges) {
    if (!isRecord(edge) || !nonEmptyString(edge.id) || !nonEmptyString(edge.source) || !nonEmptyString(edge.target)) {
      return {
        fragment: null,
        findings: [finding("fragmentShapeInvalid", "Every fragment edge needs an id, a source and a target.")]
      };
    }
  }
  const inputs = candidate.inputs as unknown[];
  for (const input of inputs) {
    if (!isRecord(input) || !nonEmptyString(input.key)) {
      return { fragment: null, findings: [finding("fragmentShapeInvalid", "Every declared input needs a key.")] };
    }
  }
  return { fragment: candidate as unknown as FlowFragment, findings: [] };
}

/**
 * The L6 blocking audit matrix.
 *
 * Capture-time rules run always. The three that need a destination — recursive expansion,
 * unresolved flow references and node-id collision — run only when `context` supplies one, because
 * at capture time there is no destination to be wrong about, and reporting them then would refuse
 * fragments that are perfectly valid for some other flow.
 */
export function auditFragment(candidate: unknown, context: FragmentAuditContext = {}): FragmentAuditFinding[] {
  const { fragment, findings: shapeFindings } = auditShape(candidate);
  if (!fragment) return shapeFindings;

  const findings: FragmentAuditFinding[] = [];
  const { nodes, edges, inputs } = fragment;

  // ── 1. Structural integrity ────────────────────────────────────────────────────────────────
  if (nodes.length === 0) {
    findings.push(finding("fragmentEmpty", "A fragment must contain at least one step."));
  }

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      findings.push(finding("duplicateNodeId", `Two steps in this fragment share the id "${node.id}".`, { nodeId: node.id }));
    }
    nodeIds.add(node.id);
  }

  const seenEdgeIds = new Set<string>();
  for (const edge of edges) {
    if (seenEdgeIds.has(edge.id)) {
      findings.push(finding("duplicateEdgeId", `Two connectors in this fragment share the id "${edge.id}".`, { edgeId: edge.id }));
    }
    seenEdgeIds.add(edge.id);

    // An edge pointing outside the fragment is an unresolved reference: nothing in the fragment,
    // and nothing the destination knows about, can satisfy it.
    for (const end of ["source", "target"] as const) {
      if (!nodeIds.has(edge[end])) {
        findings.push(
          finding(
            "edgeEndpointMissing",
            `Connector "${edge.id}" ${end === "source" ? "starts at" : "ends at"} a step this fragment does not contain.`,
            { edgeId: edge.id, field: end }
          )
        );
      }
    }
  }

  // ── 2. Start/End belong to a flow, never to a fragment ─────────────────────────────────────
  for (const node of nodes) {
    if (node.type === "start" || node.type === "end") {
      findings.push(
        finding("terminalStepIncluded", `A fragment cannot contain the flow's ${node.type} step.`, { nodeId: node.id })
      );
    }
  }

  // ── 3. Protected login is never reusable content ───────────────────────────────────────────
  for (const node of nodes) {
    if (PROTECTED_LOGIN_STEP_TYPES.has(node.type)) {
      findings.push(
        finding("protectedLoginStep", `A ${node.type} step is a protected-login surface and cannot be made reusable.`, {
          nodeId: node.id
        })
      );
    }
  }

  // ── 4. Secrets: the NAME travels, a resolved value never does ──────────────────────────────
  // A `secret` ValueSource carries only `secretName`, so a verbatim copy is safe by construction.
  // What is NOT safe is a literal sitting beside that binding — `value` on the step, or `value` on
  // the source itself — because that is a resolved secret that would be persisted in plain text.
  for (const node of nodes) {
    for (const { source, field } of collectValueSources(node)) {
      if (source.type !== "secret") continue;
      if (nonEmptyString(source.value)) {
        findings.push(
          finding("resolvedSecretValue", "A secret binding carries a literal value, which must never be saved.", {
            nodeId: node.id,
            field: `${field}.value`
          })
        );
      }
      if (field === "valueSource" && nonEmptyString(node.value)) {
        findings.push(
          finding("resolvedSecretValue", "A step bound to a secret also carries a literal value, which must never be saved.", {
            nodeId: node.id,
            field: "value"
          })
        );
      }
    }
  }

  // ── 5. The declared-input contract must match what the steps bind ──────────────────────────
  const declared = new Set<string>();
  for (const input of inputs) {
    if (declared.has(input.key)) {
      findings.push(finding("duplicateInputKey", `Input "${input.key}" is declared twice.`, { inputKey: input.key }));
    }
    declared.add(input.key);
  }
  const used = requiredInputKeys(nodes);
  for (const key of used) {
    if (!declared.has(key)) {
      findings.push(
        finding("undeclaredInput", `A step binds runtime input "${key}", which this fragment does not declare.`, {
          inputKey: key
        })
      );
    }
  }
  for (const key of declared) {
    if (!used.includes(key)) {
      findings.push(finding("unusedDeclaredInput", `Declared input "${key}" is not used by any step.`, { inputKey: key }));
    }
  }

  // ── 6. Advisory: bindings the destination may not satisfy, and mutating actions ────────────
  for (const node of nodes) {
    for (const { source, field } of collectValueSources(node)) {
      if (ENVIRONMENT_SPECIFIC_TYPES.has(source.type)) {
        findings.push(
          finding("environmentSpecificBinding", `This step reads a "${source.type}" value that the destination may not provide.`, {
            nodeId: node.id,
            field
          })
        );
      }
      if (source.type === "dynamic" && nonEmptyString(source.dataSourceId)) {
        findings.push(
          finding("environmentSpecificBinding", "This step binds a specific data source that the destination may not have.", {
            nodeId: node.id,
            field: `${field}.dataSourceId`
          })
        );
      }
    }
    const sideEffect = resolveStepSafety(node).sideEffectLevel;
    if (sideEffect === "dangerousMutation" || sideEffect === "externalCommit") {
      findings.push(
        finding("dangerousMutationStep", "This step makes a mutating change; review it before reusing this fragment.", {
          nodeId: node.id
        })
      );
    }
  }

  // ── 7. Destination-dependent rules (apply time only) ───────────────────────────────────────
  for (const node of nodes) {
    if (!FLOW_EXPANDING_STEP_TYPES.has(node.type)) continue;
    const targets = [node.flowId, node.config?.targetFlowId].filter(nonEmptyString);
    for (const target of targets) {
      if (context.destinationFlowId !== undefined && target === context.destinationFlowId) {
        findings.push(
          finding("recursiveFlowReference", `This step runs flow "${target}", which is the flow it is being added to.`, {
            nodeId: node.id
          })
        );
      }
      if (context.referenceableFlowIds !== undefined && !context.referenceableFlowIds.has(target)) {
        findings.push(
          finding("unresolvedFlowReference", `This step runs flow "${target}", which does not exist here.`, { nodeId: node.id })
        );
      }
    }
  }

  return findings;
}
