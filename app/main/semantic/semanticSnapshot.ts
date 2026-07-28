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
import type { RunHistoryRow } from "@src/reports/TelemetryContracts";
import type { LocatorRecoveryRecord, LocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import type { SemanticOutcome } from "@src/semantic/contracts/SemanticDocument";
import {
  projectAndValidate,
  type SemanticRejection,
  type ValidatedSemanticDocument
} from "@src/semantic/SemanticPolicyValidator";
import type { ProfileStore } from "@src/storage/ProfileStore";

/** Only `list()` is needed. Narrowing the dependency keeps a verifier's fakes small and honest. */
export type SemanticSnapshotSource<TProfile extends { id: string }> = Pick<ProfileStore<TProfile>, "list">;

/**
 * Most recent runs projected into the index.
 *
 * Run history grows without bound, so this is capped deliberately rather than incidentally: the
 * semantic index is a recall aid over recent work, not an archive. Raising it costs rebuild time
 * linearly.
 */
export const SEMANTIC_RUN_HISTORY_LIMIT = 500;
/** Locator memory grows with every distinct step ever resolved; same reasoning. */
export const SEMANTIC_LOCATOR_MEMORY_LIMIT = 2000;

export interface SemanticSnapshotSources {
  flows: SemanticSnapshotSource<FlowProfile>;
  workflows: SemanticSnapshotSource<WorkflowProfile>;
  /**
   * Optional. Absent sources contribute nothing rather than failing — a build without a runtime
   * store still indexes flows and workflows.
   */
  runs?: { list(limit: number): Promise<readonly RunHistoryRow[]> };
  locators?: Pick<LocatorRecoveryStore, "list">;
}

export type SemanticSnapshotKind = "flow" | "workflow" | "run-summary" | "run-failure" | "locator-success";

export interface SemanticSnapshotRejection {
  kind: SemanticSnapshotKind;
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

/**
 * Thrown when a source cannot be enumerated. Never carries a path or a vendor message.
 *
 * Only the AUTHORING sources throw. Runs and locator memory are derived, best-effort recall data:
 * losing them degrades suggestion quality, whereas losing flows or workflows would activate an index
 * that silently claims the user's automation does not exist.
 */
export class SemanticSnapshotError extends Error {
  constructor(readonly source: "flows" | "workflows") {
    super(`SNAPSHOT_SOURCE_UNREADABLE: ${source}`);
    this.name = "SemanticSnapshotError";
  }
}

/**
 * Field separator inside `LocatorRecoveryRecord.scopeKey` (see `LocatorFactory.scopeKey`).
 *
 * Built with `fromCharCode` rather than written as a literal or an escape: `verify:source-hygiene`
 * forbids literal control characters in TS sources, and an escape sequence in a string literal is
 * easy for an editing tool to silently re-expand into the very literal the guard rejects. This form
 * cannot be re-expanded.
 */
const LOCATOR_SCOPE_SEPARATOR = String.fromCharCode(0);

/**
 * Map a durable run status onto the bounded semantic outcome enum.
 *
 * Exported because incremental indexing must classify a run exactly as the rebuild snapshot does. If
 * the two ever disagreed, a run would earn a `run-failure` document from one path and not the other,
 * and `similarFailures` would return different results depending on how a document happened to be
 * indexed — a difference no user could see or explain.
 */
export function runOutcome(status: string): SemanticOutcome {
  const normalized = status.toLowerCase();
  if (normalized === "completed" || normalized === "success" || normalized === "passed") return "success";
  if (normalized === "failed" || normalized === "error") return "failure";
  if (normalized === "cancelled" || normalized === "canceled" || normalized === "stopped") return "cancelled";
  return "unknown";
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
 * The allowlisted view of a completed run (`SEMANTIC_PROJECTION_ALLOWLIST["run-summary"]`).
 *
 * Built from `RunHistoryRow`, which is deliberately the narrowest run projection AWKIT already has:
 * it carries `errorClass` but **no raw error string and no URL**. `DurableRunRecord` has both, and
 * the plan excludes them structurally because an error message routinely embeds tokens and a URL
 * embeds query parameters. Reading the narrower row means there is nothing here to leak.
 */
export function runSummarySemanticSource(run: RunHistoryRow): Record<string, unknown> {
  return {
    runId: run.instanceId,
    workflowId: run.scenarioId,
    outcome: runOutcome(run.status),
    durationMs: run.durationMs,
    updatedAt: timestamp(run.endedAt ?? run.startedAt)
  };
}

/**
 * The allowlisted view of a failed run (`SEMANTIC_PROJECTION_ALLOWLIST["run-failure"]`).
 *
 * `errorSummary` is deliberately NOT populated. The allowlist permits a redacted, bounded sentence,
 * but the only text available at this layer is the raw error, which is exactly what the projection
 * excludes. `errorClass` is the classifier's bounded label and carries the diagnostic value without
 * the payload; inventing a summary from the raw string would reintroduce the leak the allowlist
 * exists to prevent.
 */
export function runFailureSemanticSource(run: RunHistoryRow): Record<string, unknown> {
  return {
    runId: run.instanceId,
    // The execution is the attempt: `RunHistoryRow` has no retry counter, and a stable per-attempt
    // discriminator is what keeps two attempts of one run from collapsing onto the same document.
    attemptId: run.executionId,
    workflowId: run.scenarioId,
    errorCategory: run.errorClass ?? run.reportCategory,
    outcome: runOutcome(run.status),
    updatedAt: timestamp(run.endedAt ?? run.startedAt)
  };
}

/**
 * The allowlisted view of remembered locator memory (`SEMANTIC_PROJECTION_ALLOWLIST["locator-success"]`).
 *
 * **Only the winning STRATEGY is projected, never the selector or the matched text.**
 * `winningCandidateSignature` is `JSON.stringify({ strategy, value, name, exact })`, so `value` and
 * `name` are the accessible name and selector of a real element — an account number in a table row,
 * a person's name. This reads `.strategy` out of that JSON and discards the rest; the fingerprint,
 * which holds text and attributes, is not read at all.
 */
export function locatorSemanticSource(record: LocatorRecoveryRecord): Record<string, unknown> | undefined {
  // scopeKey is scenarioId + NUL + flowId + NUL + stepId (LocatorFactory.scopeKey). The separator is
  // written as an escape, never a literal control character - verify:source-hygiene enforces that.
  const [workflowId, flowId, nodeId] = record.scopeKey.split(LOCATOR_SCOPE_SEPARATOR);
  if (!workflowId || !nodeId) return undefined;

  let locatorStrategy: string | undefined;
  try {
    const parsed = JSON.parse(record.winningCandidateSignature) as { strategy?: unknown };
    if (typeof parsed.strategy === "string") locatorStrategy = parsed.strategy;
  } catch {
    return undefined;
  }
  if (!locatorStrategy) return undefined;

  return {
    workflowId,
    flowId: flowId || undefined,
    nodeId,
    locatorStrategy,
    // `source` is a two-value enum describing HOW the locator was learned, not what it matched.
    contextKind: record.source,
    updatedAt: timestamp(record.updatedAt)
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

  const project = (kind: SemanticSnapshotKind, entityId: string, source: Record<string, unknown>): void => {
    const result = projectAndValidate(kind, source);
    if (result.ok) documents.push(result.document);
    else rejected.push({ kind, entityId, reasons: result.rejections });
  };

  for (const flow of flows) project("flow", flow.id, flowSemanticSource(flow));
  for (const workflow of workflows) {
    project("workflow", workflow.id, workflowSemanticSource(workflow, flowNameById));
  }

  // Derived recall sources. Unlike the authoring stores above these degrade rather than throw: an
  // unreadable run history costs suggestion quality, whereas an unreadable flow store would activate
  // an index that claims the user's automation does not exist.
  let runs: readonly RunHistoryRow[] = [];
  if (sources.runs) {
    try {
      runs = await sources.runs.list(SEMANTIC_RUN_HISTORY_LIMIT);
    } catch {
      runs = [];
    }
  }
  for (const run of runs) {
    project("run-summary", run.instanceId, runSummarySemanticSource(run));
    // Only failures get a failure document. Projecting every run as a failure would make
    // `similarFailures` return successes, which is worse than returning nothing.
    if (runOutcome(run.status) === "failure") {
      project("run-failure", run.instanceId, runFailureSemanticSource(run));
    }
  }

  let locators: readonly LocatorRecoveryRecord[] = [];
  if (sources.locators) {
    try {
      locators = await sources.locators.list(SEMANTIC_LOCATOR_MEMORY_LIMIT);
    } catch {
      locators = [];
    }
  }
  let locatorsRead = 0;
  for (const record of locators) {
    const source = locatorSemanticSource(record);
    // An unparseable scopeKey or signature yields no document and is not a rejection: nothing was
    // wrong with the record, this layer simply cannot address it. Counting it as read would break
    // the `read - rejected === documents` identity the report promises.
    if (!source) continue;
    locatorsRead += 1;
    project("locator-success", record.scopeKey, source);
  }

  return {
    documents,
    read: flows.length + workflows.length + runs.length + runs.filter((r) => runOutcome(r.status) === "failure").length + locatorsRead,
    rejected
  };
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
