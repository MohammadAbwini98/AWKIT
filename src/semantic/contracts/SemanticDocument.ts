/**
 * The semantic document contract (plan §7.1, §7.2) and the typed query surface (plan §12).
 *
 * This is the vendor-neutral shape everything else in the subsystem agrees on. It deliberately
 * contains NO Zvec types: the store interface is what adapts this to a vendor, and keeping the
 * domain model free of vendor detail is what makes `InMemorySemanticStore` a real implementation
 * rather than a mock.
 *
 * Two properties are load-bearing and are enforced elsewhere in the pipeline, not here:
 *
 *  1. `content` is ALREADY REDACTED by the time a document is valid. This file cannot enforce that
 *     — a plain interface accepts any string — which is exactly why `ValidatedSemanticDocument`
 *     exists and why the store accepts only that branded type.
 *  2. `id` is DETERMINISTIC. The same source entity at the same revision must always produce the
 *     same id, because "upsert is replace" depends on it: a non-deterministic id turns an update
 *     into an unbounded stream of near-duplicate documents.
 *
 * Framework-agnostic: no Electron, no filesystem, no Zvec.
 */

import { createHash } from "node:crypto";

/** Schema version of the document shape itself, independent of profile/runtime DB versions (§7.1). */
export const SEMANTIC_SCHEMA_VERSION = 1;

// Kinds and query bounds live in `SemanticKinds.ts` and are re-exported here so every existing
// importer is unchanged. They are separate because this module imports `node:crypto`, which makes it
// impossible to bundle into the renderer — see that file's header.
export {
  SEMANTIC_DEFAULT_TOP_K,
  SEMANTIC_DOCUMENT_KINDS,
  SEMANTIC_MAX_TOP_K,
  isSemanticDocumentKind,
  type SemanticDocumentKind
} from "./SemanticKinds";

import { SEMANTIC_DOCUMENT_KINDS, type SemanticDocumentKind } from "./SemanticKinds";

export type SemanticOutcome = "success" | "failure" | "cancelled" | "unknown";

/** Runtime membership list — documents are re-validated after being read back off disk. */
export const SEMANTIC_OUTCOMES: readonly SemanticOutcome[] = ["success", "failure", "cancelled", "unknown"];

/**
 * A projected, redacted, indexable view of an AWKIT entity.
 *
 * Every optional scalar is a FILTER dimension (plan §7.4/§12.2), not free-form metadata: the query
 * surface exposes exactly these, so adding an arbitrary field here without a matching filter makes
 * it dead weight in the index.
 */
export interface SemanticDocument {
  id: string;
  kind: SemanticDocumentKind;

  /**
   * The AWKIT entity this projects (workflow id, run id, relative doc path, …).
   *
   * Kept for source traceability, and deliberately unconstrained — an entity id is whatever AWKIT
   * calls the thing. It is therefore NEVER interpolated into a backend filter expression; use
   * `entityKey` for that (see below).
   */
  entityId: string;
  /**
   * `entityKey` is the FILTERABLE form of the entity identity: `sha256(kind \u0000 NFC(entityId))`,
   * so its alphabet is always `[0-9a-f]{64}`.
   *
   * It exists because a filter value must be safely representable in the backend's grammar, and a raw
   * `entityId` is not. Refusing unsafe values (a backslash, a quote, a control character) is
   * fail-closed but leaves a legitimate entity **impossible to delete from the index** — a Windows
   * path, an apostrophe in a name, or a non-ASCII identifier would be indexed and then unremovable.
   * A derived fixed-alphabet key removes the entire class of problem instead of narrowing it.
   *
   * NFC-normalized on purpose: two spellings of the same identifier that differ only by Unicode
   * composition form are the same entity, and a delete that missed the other form would be the same
   * silent-under-delete failure in a new disguise.
   *
   * Factory-computed and re-verified on read, exactly like `id` — a row whose `entityKey` does not
   * agree with its own `kind` + `entityId` is rejected rather than trusted.
   */
  entityKey: string;
  /** The SOURCE revision, never the index revision (§7.1). */
  revision: string;
  /** Detects stale projections: same source content ⇒ same hash. */
  sourceHash: string;
  schemaVersion: number;

  title: string;
  /** MUST already be redacted. Enforced by the policy validator, not by this type. */
  content: string;
  tags: string[];

  workflowId?: string;
  flowId?: string;
  nodeId?: string;
  nodeType?: string;
  hostname?: string;
  outcome?: SemanticOutcome;
  errorCategory?: string;

  createdAt: string;
  updatedAt: string;

  /** Vectors are optional and unused in Phase 1B (full-text only — plan §12.1). */
  embedding?: Float32Array;
  embeddingProviderId?: string;
  embeddingVersion?: string;
}

// ── deterministic identity (§7.2) ────────────────────────────────────────────────────────────────

/**
 * Normalize one id component.
 *
 * An id is NOT a filesystem path, so this is not `safePathComponent`: the goals differ. Here the
 * requirements are that the result is stable, contains no delimiter that could forge a different
 * id, and cannot carry free text into a value that ends up in diagnostics.
 *
 * `:` is the delimiter and is therefore stripped rather than escaped — escaping would make
 * `a:b` + `c` and `a` + `b:c` distinguishable only by an escape convention that every future reader
 * would have to honour exactly.
 */
function idComponent(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "unknown";
}

/** Stable short digest, used where a component is unbounded or must not be echoed verbatim. */
export function semanticHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

/**
 * Build a deterministic document id.
 *
 * Every caller goes through here rather than concatenating strings, so the delimiter rule and the
 * component normalization cannot drift between call sites — two projections disagreeing about id
 * construction would silently create duplicate documents for one entity.
 */
export function semanticDocumentId(kind: SemanticDocumentKind, ...parts: string[]): string {
  return [kind, ...parts.map(idComponent)].join(":");
}

/**
 * Whether a kind names a CURRENT STATE or a HISTORICAL EVENT.
 *
 * This distinction decides identity, and getting it wrong breaks upsert-is-replace. Including a
 * revision in a workflow's id meant `workflow:x:1` and `workflow:x:2` were different documents, so
 * re-indexing an edited workflow ADDED a row instead of replacing one and both stayed searchable —
 * exactly the near-duplicate accumulation deterministic ids exist to prevent.
 *
 *  - current-state: one live document per logical entity. Revision changes REPLACE it.
 *  - historical: one document per event occurrence. Each is a distinct fact and must be retained.
 */
export const SEMANTIC_KIND_IDENTITY: Record<SemanticDocumentKind, "current-state" | "historical"> = {
  workflow: "current-state",
  flow: "current-state",
  "node-template": "current-state",
  documentation: "current-state",
  // A locator SUCCESS is the current best-known strategy for a node — one live answer, replaced as
  // it improves. A locator FAILURE is a thing that happened at a moment in time.
  "locator-success": "current-state",
  "locator-failure": "historical",
  "run-failure": "historical",
  "run-summary": "historical"
};

/**
 * Canonical id forms (plan §7.2), corrected for the current-state/historical split.
 *
 * Every id ends in a hash of its CANONICAL, un-normalized identity. `idComponent` lowercases,
 * collapses punctuation and truncates at 120 characters, so two genuinely different long or
 * punctuation-heavy source ids could otherwise normalize to the same document id and silently
 * overwrite each other. The readable prefix stays for diagnosability; the hash carries the
 * uniqueness.
 *
 * Free-text or unbounded inputs (locator context) are hashed rather than embedded: a document id is
 * echoed in diagnostics and hit lists, so it must never become a channel for page text.
 */
function idWithHash(kind: SemanticDocumentKind, readable: string[], canonical: string[]): string {
  return `${semanticDocumentId(kind, ...readable)}:${semanticHash(canonical.join("\u0000"))}`;
}

export const semanticIds = {
  // ── current state: stable across revisions, so a re-index REPLACES ──
  workflow: (workflowId: string) => idWithHash("workflow", [workflowId], ["workflow", workflowId]),
  flow: (flowId: string) => idWithHash("flow", [flowId], ["flow", flowId]),
  nodeTemplate: (nodeType: string) => idWithHash("node-template", [nodeType], ["node-template", nodeType]),
  documentation: (relativePath: string) => idWithHash("documentation", [relativePath], ["documentation", relativePath]),
  locatorSuccess: (flowId: string, nodeId: string) =>
    idWithHash("locator-success", [flowId, nodeId], ["locator-success", flowId, nodeId]),

  // ── historical: each occurrence is its own document ──
  locatorFailure: (runId: string, attemptId: string, nodeId: string) =>
    idWithHash("locator-failure", [runId, nodeId], ["locator-failure", runId, attemptId, nodeId]),
  runFailure: (runId: string, attemptId: string, nodeId: string) =>
    idWithHash("run-failure", [runId, nodeId], ["run-failure", runId, attemptId, nodeId]),
  runSummary: (runId: string) => idWithHash("run-summary", [runId], ["run-summary", runId])
} as const;

/** Content digest for staleness detection. Distinct from the id: the id is stable across edits. */
/**
 * The filterable form of an entity identity: 64 lowercase hex characters, always.
 *
 * Derived rather than validated so that NO entity identity is unrepresentable in a backend filter.
 * The raw `entityId` may contain a backslash, a quote, a newline or non-ASCII text; this cannot.
 *
 * NFC normalization is part of the contract: the same identifier written in decomposed form must
 * produce the same key, or `deleteByEntity` would miss it and report success.
 *
 * `kind` participates so a key is scoped to one document kind. `deleteByEntity` therefore matches
 * across all kinds by testing the key of each, which keeps the raw id out of the expression while
 * still deleting every document projected from that entity.
 */
export function semanticEntityKey(kind: SemanticDocumentKind, entityId: string): string {
  return semanticSourceHash([kind, entityId.normalize("NFC")]);
}

/** Every key one entity identity can occupy, one per kind. Used by entity-wide deletion. */
export function semanticEntityKeysForAllKinds(entityId: string): string[] {
  return SEMANTIC_DOCUMENT_KINDS.map((kind) => semanticEntityKey(kind, entityId));
}

/** A derived key is the only shape a filter may carry for an identity. */
export function isSemanticEntityKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function semanticSourceHash(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex");
}

// ── query surface (§12.2, §12.4) ─────────────────────────────────────────────────────────────────

/** Phase 1B supports `fullText` only; the others exist so the contract does not churn later (§12.1). */
export type SemanticSearchMode = "fullText" | "vector" | "hybrid";

/**
 * A structured query.
 *
 * There is deliberately no raw filter-expression field. The store builds vendor filters internally
 * from these named dimensions, so no caller — and later, no renderer — can smuggle a vendor query
 * fragment through the boundary.
 */
export interface SemanticSearchRequest {
  text: string;
  mode?: SemanticSearchMode;
  kinds?: SemanticDocumentKind[];
  workflowId?: string;
  flowId?: string;
  nodeType?: string;
  hostname?: string;
  outcome?: SemanticOutcome;
  errorCategory?: string;
  topK?: number;
  groupBy?: "kind" | "workflowId" | "errorCategory" | "hostname";
}


/**
 * One result.
 *
 * `reasons` are human-readable and explainable by contract (§12.4): the subsystem never surfaces an
 * opaque score as certainty. `summary` is a bounded excerpt of already-redacted content.
 */
export interface SemanticSearchHit {
  documentId: string;
  kind: SemanticDocumentKind;
  entityId: string;
  title: string;
  summary: string;
  score: number;
  workflowId?: string;
  flowId?: string;
  nodeId?: string;
  hostname?: string;
  updatedAt: string;
  reasons: string[];
}

export interface SemanticSearchResult {
  hits: SemanticSearchHit[];
  /** Total matches before `topK` truncation, so a caller can say "showing 20 of 137". */
  totalMatched: number;
  mode: SemanticSearchMode;
  /** True when the query ran against a degraded or partially rebuilt index. */
  degraded: boolean;
}
