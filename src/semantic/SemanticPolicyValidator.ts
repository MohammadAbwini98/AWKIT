/**
 * The policy validator and the ONLY factory for `ValidatedSemanticDocument` (plan §9.3).
 *
 * **The compile-time guarantee.** `ValidatedSemanticDocument` carries a brand keyed on a
 * module-private `unique symbol`. That symbol is never exported, so no other module can construct
 * or cast to the branded type — TypeScript rejects `doc as ValidatedSemanticDocument` outside this
 * file (verified by a probe in `verify:semantic-policy`'s companion check). The store and the
 * mutation queue accept ONLY the branded type, so "nothing reaches the index without passing
 * projection, redaction and validation" is enforced by the type checker rather than by reviewer
 * discipline.
 *
 * Honest limit: like every TypeScript brand, a double assertion (`as unknown as`) can still defeat
 * it. The brand stops accidental and casual bypass, which is what it is for; it is not a security
 * boundary against code that is actively trying to lie. The runtime `Object.freeze` below is what
 * stops a validated document being edited after the fact.
 *
 * **Why the validator re-scans content the redactor just cleaned.** That is not redundancy, it is
 * the point: the redactor is pattern-based and can only remove what it recognises, so it is exactly
 * the component most likely to have a gap. The validator is an independent check with a different
 * failure mode — it does not try to clean anything, it refuses. A document that still looks like it
 * carries a secret is rejected outright rather than mitigated.
 *
 * **Rejection is never fatal to the originating operation** (§9.3). A workflow save or run
 * completion must succeed even if its projection is unindexable; callers receive a sanitized
 * diagnostic and bump a rejection metric.
 *
 * Framework-agnostic: no Electron, no filesystem.
 */

import {
  isSemanticDocumentKind,
  semanticIds,
  semanticSourceHash,
  SEMANTIC_SCHEMA_VERSION,
  type SemanticDocument,
  type SemanticDocumentKind
} from "./contracts/SemanticDocument";
import {
  isForbiddenField,
  SEMANTIC_PROJECTORS,
  type ProjectedSemanticCandidate
} from "./SemanticProjection";
import { SemanticRedactor } from "./SemanticRedactor";

/** Module-private brand. Deliberately NOT exported — that is what makes the factory the only source. */
declare const validatedSemanticDocument: unique symbol;

/** Deep-readonly view of the document, so a validated instance cannot be mutated after the fact. */
export type ValidatedSemanticDocument = {
  readonly [K in keyof SemanticDocument]: SemanticDocument[K] extends (infer U)[] ? readonly U[] : SemanticDocument[K];
} & { readonly [validatedSemanticDocument]: true };

export const SEMANTIC_MAX_CONTENT_LENGTH = 8000;
export const SEMANTIC_MAX_TITLE_LENGTH = 300;
export const SEMANTIC_MAX_TAGS = 32;

export type SemanticRejectionReason =
  | "UNSUPPORTED_KIND"
  | "CONTENT_TOO_LARGE"
  | "TITLE_TOO_LARGE"
  | "TOO_MANY_TAGS"
  | "PROHIBITED_FIELD_PRESENT"
  | "UNREDACTED_SECRET"
  | "MISSING_SOURCE_REFERENCE"
  | "INVALID_ID"
  | "SCHEMA_VERSION_MISMATCH"
  | "EMBEDDING_DIMENSION_MISMATCH"
  | "PROJECTION_REJECTED";

export interface SemanticRejection {
  reason: SemanticRejectionReason;
  /** Sanitized: names a field or rule, NEVER the offending value. */
  detail: string;
}

export type SemanticValidationResult =
  | { ok: true; document: ValidatedSemanticDocument }
  | { ok: false; rejections: SemanticRejection[] };

/**
 * Residual-secret detectors, run against ALREADY-REDACTED content.
 *
 * Intentionally narrower and more conservative than the redactor's rules: this fires only on shapes
 * that should be impossible after redaction. A false positive here costs one unindexed document; a
 * false negative writes a credential into a durable local index that later surfaces in search hits.
 */
const RESIDUAL_SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\beyJ[A-Za-z0-9._-]{10,}/, label: "jwt-like blob" },
  { pattern: /\b(?:Bearer|Basic|Digest)\s+[A-Za-z0-9._~+/=-]{8,}/i, label: "authorization scheme" },
  { pattern: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*\S/i, label: "key/value secret" },
  { pattern: /\b[a-z][a-z0-9+.-]*:\/\/\S*[?#]\S+/i, label: "url with query or fragment" },
  { pattern: /\b[A-Za-z]:\\(?:Users|Windows)\\/i, label: "absolute windows path" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "private key block" }
];

export interface SemanticPolicyOptions {
  /** Expected embedding width; a mismatch is rejected rather than silently stored (§9.3). */
  expectedEmbeddingDimension?: number;
  /** Kinds this build accepts. Defaults to every kind. */
  supportedKinds?: readonly SemanticDocumentKind[];
}

/**
 * Validate a redacted candidate and, on success, mint the branded document.
 *
 * Collects ALL failures rather than returning the first: a caller fixing a projection wants the
 * full list, and a rejection metric that only ever reports the earliest reason hides the others.
 */
export function validateSemanticDocument(
  candidate: SemanticDocument,
  options: SemanticPolicyOptions = {}
): SemanticValidationResult {
  const rejections: SemanticRejection[] = [];
  const reject = (reason: SemanticRejectionReason, detail: string): void => {
    rejections.push({ reason, detail });
  };

  if (!isSemanticDocumentKind(candidate.kind)) {
    reject("UNSUPPORTED_KIND", `kind=${String(candidate.kind).slice(0, 40)}`);
  } else if (options.supportedKinds && !options.supportedKinds.includes(candidate.kind)) {
    reject("UNSUPPORTED_KIND", `kind ${candidate.kind} is not enabled in this build`);
  }

  // Identity + source references. Without these a hit cannot be traced back to anything, which
  // makes the document unusable AND unremovable by entity.
  if (!candidate.id || !candidate.id.includes(":")) reject("INVALID_ID", "id must be a delimited deterministic id");
  if (!candidate.entityId) reject("MISSING_SOURCE_REFERENCE", "entityId");
  if (!candidate.revision) reject("MISSING_SOURCE_REFERENCE", "revision");
  if (!candidate.sourceHash) reject("MISSING_SOURCE_REFERENCE", "sourceHash");
  if (!candidate.updatedAt) reject("MISSING_SOURCE_REFERENCE", "updatedAt");

  if (candidate.schemaVersion !== SEMANTIC_SCHEMA_VERSION) {
    reject("SCHEMA_VERSION_MISMATCH", `expected ${SEMANTIC_SCHEMA_VERSION}, got ${candidate.schemaVersion}`);
  }

  if ((candidate.content?.length ?? 0) > SEMANTIC_MAX_CONTENT_LENGTH) {
    reject("CONTENT_TOO_LARGE", `${candidate.content.length} > ${SEMANTIC_MAX_CONTENT_LENGTH}`);
  }
  if ((candidate.title?.length ?? 0) > SEMANTIC_MAX_TITLE_LENGTH) {
    reject("TITLE_TOO_LARGE", `${candidate.title.length} > ${SEMANTIC_MAX_TITLE_LENGTH}`);
  }
  if ((candidate.tags?.length ?? 0) > SEMANTIC_MAX_TAGS) {
    reject("TOO_MANY_TAGS", `${candidate.tags.length} > ${SEMANTIC_MAX_TAGS}`);
  }

  // A forbidden field name appearing on the document itself means a projector bypassed the
  // allowlist and assigned it directly.
  for (const field of Object.keys(candidate)) {
    if (isForbiddenField(field)) reject("PROHIBITED_FIELD_PRESENT", field);
  }

  // The independent re-scan. Runs over every free-text surface, not just `content`.
  for (const [field, text] of [
    ["content", candidate.content],
    ["title", candidate.title],
    ["errorCategory", candidate.errorCategory ?? ""],
    ["tags", (candidate.tags ?? []).join(" ")]
  ] as const) {
    for (const { pattern, label } of RESIDUAL_SECRET_PATTERNS) {
      if (text && pattern.test(text)) reject("UNREDACTED_SECRET", `${field}: ${label}`);
    }
  }

  if (candidate.embedding && options.expectedEmbeddingDimension !== undefined) {
    if (candidate.embedding.length !== options.expectedEmbeddingDimension) {
      reject(
        "EMBEDDING_DIMENSION_MISMATCH",
        `expected ${options.expectedEmbeddingDimension}, got ${candidate.embedding.length}`
      );
    }
  }

  if (rejections.length > 0) return { ok: false, rejections };

  // Freeze before branding: the brand asserts "this passed policy", and a mutable object could be
  // edited afterwards while keeping the brand, which would make the guarantee a lie.
  const frozen = Object.freeze({
    ...candidate,
    tags: Object.freeze([...(candidate.tags ?? [])])
  });

  return { ok: true, document: frozen as unknown as ValidatedSemanticDocument };
}

/**
 * Compute the deterministic id for a candidate.
 *
 * The FACTORY owns id construction; callers never supply one. Accepting a caller-provided id and
 * merely checking it contained a `:` let a caller pick its own identity, which silently defeats
 * upsert-is-replace — two callers projecting the same entity under different ids produce two live
 * documents for one thing.
 */
function computeDocumentId(candidate: ProjectedSemanticCandidate): string {
  switch (candidate.kind) {
    case "workflow":
      return semanticIds.workflow(candidate.entityId);
    case "flow":
      return semanticIds.flow(candidate.entityId);
    case "node-template":
      return semanticIds.nodeTemplate(candidate.entityId);
    case "documentation":
      return semanticIds.documentation(candidate.entityId);
    case "locator-success":
      return semanticIds.locatorSuccess(candidate.flowId ?? "", candidate.nodeId ?? candidate.entityId);
    case "locator-failure":
      return semanticIds.locatorFailure(candidate.entityId, candidate.revision, candidate.nodeId ?? "");
    case "run-failure":
      return semanticIds.runFailure(candidate.entityId, candidate.revision, candidate.nodeId ?? "");
    case "run-summary":
      return semanticIds.runSummary(candidate.entityId);
  }
}

/**
 * The complete pipeline: (already-projected candidate) → redact → validate → brand (§9.1).
 *
 * Takes a `ProjectedSemanticCandidate`, which only `SemanticProjection`'s per-kind projectors can
 * construct. That is what closes the bypass: an earlier signature accepted a free-form `body` (plus
 * title, tags and filter fields) alongside the projected source, so a caller could pass
 * `JSON.stringify(entireWorkflowIncludingSecrets)` and projection never saw it — privacy then rested
 * entirely on redaction patterns, the exact dependency projection exists to remove.
 *
 * `validateSemanticDocument` remains exported so a caller holding an already-redacted document (a
 * rebuild replaying stored projections, or the Zvec adapter re-validating a row read back off disk)
 * can re-check it without re-running the earlier stages.
 */
export function buildValidatedDocument(
  candidate: ProjectedSemanticCandidate,
  redactor: SemanticRedactor = new SemanticRedactor(),
  options: SemanticPolicyOptions = {}
): SemanticValidationResult {
  const now = new Date().toISOString();

  // Every indexable string is redacted, including the parts the projectors assembled: projection
  // bounds WHICH fields are read, redaction cleans WHAT those fields contain. Both are required.
  const content = candidate.contentParts
    .map((part) => redactor.redactText(part))
    .filter((part) => part.length > 0)
    .join("\n")
    .slice(0, SEMANTIC_MAX_CONTENT_LENGTH);

  const document: SemanticDocument = {
    id: computeDocumentId(candidate),
    kind: candidate.kind,
    entityId: candidate.entityId,
    revision: candidate.revision,
    sourceHash: semanticSourceHash([candidate.kind, candidate.entityId, candidate.revision, content]),
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    title: redactor.redactText(candidate.title).slice(0, SEMANTIC_MAX_TITLE_LENGTH),
    content,
    tags: candidate.tags.map((t) => redactor.redactText(t)).filter(Boolean).slice(0, SEMANTIC_MAX_TAGS),
    createdAt: candidate.createdAt ?? now,
    updatedAt: candidate.updatedAt ?? now,
    workflowId: candidate.workflowId,
    flowId: candidate.flowId,
    nodeId: candidate.nodeId,
    nodeType: candidate.nodeType,
    hostname: candidate.hostname,
    outcome: candidate.outcome,
    errorCategory: candidate.errorCategory ? redactor.redactText(candidate.errorCategory) : undefined
  };

  return validateSemanticDocument(document, options);
}

/**
 * Project a raw source object for `kind`, then run the full pipeline.
 *
 * The convenience entry point for callers that hold a raw entity. It cannot bypass projection,
 * because the projector is the only thing that can produce the candidate this then consumes.
 */
export function projectAndValidate(
  kind: SemanticDocumentKind,
  source: Record<string, unknown>,
  redactor: SemanticRedactor = new SemanticRedactor(),
  options: SemanticPolicyOptions = {}
): SemanticValidationResult {
  const projected = SEMANTIC_PROJECTORS[kind]?.(source);
  if (!projected) {
    return { ok: false, rejections: [{ reason: "UNSUPPORTED_KIND", detail: `kind=${String(kind).slice(0, 40)}` }] };
  }
  if (!projected.ok) {
    return {
      ok: false,
      rejections: projected.rejections.map((r) => ({
        reason: "PROJECTION_REJECTED" as const,
        detail: `${r.reason}${r.field ? `: ${r.field}` : ""}`
      }))
    };
  }
  return buildValidatedDocument(projected.candidate, redactor, options);
}
