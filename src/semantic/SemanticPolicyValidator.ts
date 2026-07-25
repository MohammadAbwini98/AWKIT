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
  SEMANTIC_SCHEMA_VERSION,
  type SemanticDocument,
  type SemanticDocumentKind
} from "./contracts/SemanticDocument";
import { isForbiddenField, projectForKind } from "./SemanticProjection";
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

export interface BuildDocumentInput {
  kind: SemanticDocumentKind;
  id: string;
  entityId: string;
  revision: string;
  sourceHash: string;
  title: string;
  /** Raw source fields; run through the projection allowlist, then redacted. */
  source: Record<string, unknown>;
  /** Free-text body before redaction. */
  body: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  workflowId?: string;
  flowId?: string;
  nodeId?: string;
  nodeType?: string;
  hostname?: string;
  outcome?: SemanticDocument["outcome"];
  errorCategory?: string;
}

/**
 * The complete pipeline: project → redact → validate → brand (§9.1).
 *
 * This is the intended entry point. `validateSemanticDocument` is exported separately only so a
 * caller that has already projected and redacted (the store contract suite, a rebuild replaying
 * stored projections) can re-validate without re-running the earlier stages.
 */
export function buildValidatedDocument(
  input: BuildDocumentInput,
  redactor: SemanticRedactor = new SemanticRedactor(),
  options: SemanticPolicyOptions = {}
): SemanticValidationResult {
  const projection = projectForKind(input.kind, input.source);
  if (!projection.ok) {
    return {
      ok: false,
      rejections: projection.rejections.map((r) => ({
        reason: "PROJECTION_REJECTED" as const,
        detail: `${r.reason}${r.field ? `: ${r.field}` : ""}`
      }))
    };
  }

  const redactedProjection = redactor.redactRecord(projection.projected);
  const now = new Date().toISOString();

  // Content is the redacted body plus the redacted allowlisted fields — never the raw source.
  const projectedText = Object.entries(redactedProjection)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join("\n");

  const candidate: SemanticDocument = {
    id: input.id,
    kind: input.kind,
    entityId: input.entityId,
    revision: input.revision,
    sourceHash: input.sourceHash,
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    title: redactor.redactText(input.title).slice(0, SEMANTIC_MAX_TITLE_LENGTH),
    content: `${redactor.redactText(input.body)}\n${projectedText}`.trim().slice(0, SEMANTIC_MAX_CONTENT_LENGTH),
    tags: (input.tags ?? []).map((t) => redactor.redactText(t)).filter(Boolean).slice(0, SEMANTIC_MAX_TAGS),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    workflowId: input.workflowId,
    flowId: input.flowId,
    nodeId: input.nodeId,
    nodeType: input.nodeType,
    hostname: input.hostname,
    outcome: input.outcome,
    errorCategory: input.errorCategory ? redactor.redactText(input.errorCategory) : undefined
  };

  return validateSemanticDocument(candidate, options);
}
