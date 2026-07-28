/**
 * The authoritative document set a semantic rebuild is built from (plan §10.2).
 *
 * `SemanticRebuildOrchestrator` populates a candidate generation from this snapshot, so it answers
 * exactly one question: *every document that should exist right now*. Phase 1B indexes the two
 * durable authoring entities — flows and workflows. Run history, locator outcomes and documentation
 * are separate kinds with their own allowlists and are deliberately out of scope here.
 *
 * **A partial snapshot is worse than no snapshot.** If one store cannot be listed, this THROWS
 * rather than returning what it managed to read. The orchestrator turns that into a `SNAPSHOT_FAILED`
 * refusal which allocates nothing and never touches the active pointer, whereas a quietly-partial
 * snapshot would validate cleanly, activate, and silently drop every flow from the index — the
 * failure looking exactly like success. A per-entity rejection is different and IS tolerated: one
 * malformed flow must not cost the user their whole index, so it is dropped, counted and reported.
 *
 * Framework-agnostic on purpose: the profile stores are INJECTED, never constructed here, so this
 * module imports no Electron and a `tsx` verifier can drive it directly. `semanticService` owns the
 * Electron-bound composition.
 */

import type { FlowProfile } from "@src/profiles/FlowProfile";
import { isWorkflowFlowNode, type WorkflowProfile } from "@src/profiles/WorkflowProfile";
import {
  projectAndValidate,
  type SemanticRejection,
  type ValidatedSemanticDocument
} from "@src/semantic/SemanticPolicyValidator";
import type { ProfileStore } from "@src/storage/ProfileStore";

/** Only `list()` is needed. Narrowing the dependency keeps a verifier's fakes small and honest. */
export type SemanticSnapshotSource<TProfile extends { id: string }> = Pick<ProfileStore<TProfile>, "list">;

export interface SemanticSnapshotSources {
  flows: SemanticSnapshotSource<FlowProfile>;
  workflows: SemanticSnapshotSource<WorkflowProfile>;
}

export interface SemanticSnapshotRejection {
  kind: "flow" | "workflow";
  /** The entity's own id. Never its content — a rejection detail must not become a leak. */
  entityId: string;
  reasons: SemanticRejection[];
}

export interface SemanticSnapshotReport {
  documents: ValidatedSemanticDocument[];
  /** Entities read from the stores, before projection. `read - rejected.length === documents.length`. */
  read: number;
  rejected: SemanticSnapshotRejection[];
}

/** Thrown when a source cannot be enumerated. Never carries a path or a vendor message. */
export class SemanticSnapshotError extends Error {
  constructor(readonly source: "flows" | "workflows") {
    super(`SNAPSHOT_SOURCE_UNREADABLE: ${source}`);
    this.name = "SemanticSnapshotError";
  }
}

/** A timestamp the validator would reject is worse than none: absent means "use now". */
function timestamp(value: string | undefined): string | undefined {
  if (!value || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

/**
 * The allowlisted view of a flow (`SEMANTIC_PROJECTION_ALLOWLIST.flow`).
 *
 * Step *names* are indexable and step *values* are not — `value`, `inputValue` and friends are in
 * `SEMANTIC_FORBIDDEN_FIELDS` precisely because a recorded field carries whatever the user typed.
 * This builds the source record field by field rather than spreading the profile, so a new
 * `FlowProfile` property can never reach the projector by default.
 */
export function flowSemanticSource(flow: FlowProfile): Record<string, unknown> {
  return {
    flowId: flow.id,
    name: flow.name,
    description: flow.description,
    revision: String(flow.version),
    nodeTypes: unique(flow.nodes.map((step) => step.type)),
    stepNames: unique(flow.nodes.map((step) => step.name)),
    updatedAt: timestamp(flow.updatedAt)
  };
}

/**
 * The allowlisted view of a workflow (`SEMANTIC_PROJECTION_ALLOWLIST.workflow`).
 *
 * `flowNames` resolves referenced flows through `flowNameById` so search matches what the user sees
 * in the Flows library; a reference the map cannot resolve falls back to the node alias, which is
 * user-authored text on this workflow rather than data borrowed from elsewhere.
 */
export function workflowSemanticSource(
  workflow: WorkflowProfile,
  flowNameById: ReadonlyMap<string, string>
): Record<string, unknown> {
  const flowNames = workflow.nodes
    .filter(isWorkflowFlowNode)
    .map((node) => flowNameById.get(node.flowId) ?? node.alias);

  return {
    workflowId: workflow.id,
    name: workflow.name,
    description: workflow.description,
    revision: String(workflow.version),
    flowNames: unique(flowNames),
    nodeTypes: unique(workflow.nodes.map((node) => node.type)),
    updatedAt: timestamp(workflow.updatedAt)
  };
}

/**
 * Read both stores and project every entity. Throws only when a store is unreadable.
 *
 * Returns the full report rather than just the documents so a caller can tell "the user has no
 * flows" from "every flow was rejected" — two states that a bare document array renders identical.
 */
export async function buildSemanticSnapshot(sources: SemanticSnapshotSources): Promise<SemanticSnapshotReport> {
  let flows: FlowProfile[];
  let workflows: WorkflowProfile[];

  try {
    flows = await sources.flows.list();
  } catch {
    throw new SemanticSnapshotError("flows");
  }
  try {
    workflows = await sources.workflows.list();
  } catch {
    throw new SemanticSnapshotError("workflows");
  }

  const flowNameById = new Map(flows.map((flow) => [flow.id, flow.name]));
  const documents: ValidatedSemanticDocument[] = [];
  const rejected: SemanticSnapshotRejection[] = [];

  const project = (kind: "flow" | "workflow", entityId: string, source: Record<string, unknown>): void => {
    const result = projectAndValidate(kind, source);
    if (result.ok) documents.push(result.document);
    else rejected.push({ kind, entityId, reasons: result.rejections });
  };

  for (const flow of flows) project("flow", flow.id, flowSemanticSource(flow));
  for (const workflow of workflows) {
    project("workflow", workflow.id, workflowSemanticSource(workflow, flowNameById));
  }

  return { documents, read: flows.length + workflows.length, rejected };
}

/**
 * Adapt the report to `SemanticIndexRuntimeOptions.snapshot`.
 *
 * Takes a FACTORY, not the stores themselves. The flow and workflow folders are user-configurable in
 * Settings, so a store resolved once at registration would keep reading the folder that was
 * configured at startup — a rebuild would then index the wrong corpus and validate cleanly while
 * doing it. Resolving per snapshot picks up the current paths.
 *
 * Rejections are logged at `warn` with counts only. They are a real signal — a projector that starts
 * rejecting everything would otherwise show up as an index that simply went empty — but they are not
 * a reason to refuse the rebuild, which would let one bad profile block every good one.
 */
export function createSemanticSnapshotProvider(
  resolveSources: () => SemanticSnapshotSources,
  logger?: (level: "info" | "warn" | "error", message: string) => void
): () => Promise<readonly ValidatedSemanticDocument[]> {
  return async () => {
    const report = await buildSemanticSnapshot(resolveSources());
    if (report.rejected.length > 0) {
      const kinds = report.rejected.map((r) => r.kind);
      logger?.(
        "warn",
        `Semantic snapshot dropped ${report.rejected.length} of ${report.read} entities ` +
          `(flow: ${kinds.filter((k) => k === "flow").length}, workflow: ${kinds.filter((k) => k === "workflow").length}).`
      );
    } else {
      logger?.("info", `Semantic snapshot projected ${report.documents.length} documents.`);
    }
    return report.documents;
  };
}
